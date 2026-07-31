# -*- coding: utf-8 -*-
"""
data.js / ui.js の各表へ、新モンスターの行を機械的に追記・削除する。

・挿入位置は表の末尾にある `// <<AUTO:表名>>` の直前。
  波かっこの対応を自前で数えると壊れやすいので、目印方式にしてある。
・すべての表を1回のトランザクションで書き、途中で失敗したら何も書かない。
・標準ライブラリだけで動く。
"""
import os, re
from monster_spec import js_str, js_value, js_move, build_moves

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 表名 -> (ファイル, その表を持つファイル内での説明)
TABLES = [
    ('ELEMENTS',        'data.js'),
    ('WALK_ANIM',       'data.js'),
    ('SIGNATURE_MOVES', 'data.js'),
    ('MONSTER_AURA',    'data.js'),
    ('MOVE_AURA',       'data.js'),
    ('STATE_CHANGES',   'data.js'),
    ('APTITUDE',        'data.js'),
    ('SKIN_CONFIG',     'data.js'),
    ('TRAIT_DESC',      'ui.js'),
]
TABLE_FILE = dict(TABLES)

def anchor_re(name):
    return re.compile(r'^[ \t]*// <<AUTO:%s>>.*$' % re.escape(name), re.M)

def _pad(key, width=9):
    return (key + ':').ljust(width)

# ------------------------------------------------------------------ 行の組み立て
def render_rows(spec, moves):
    """表名 -> 追記する行(複数行可)の辞書を返す。全行に `/*key*/` の目印を付け、
       revert のときにこの目印で行を特定して消す。"""
    k = spec['key']
    mark = '/*@%s*/' % k
    el = [f"label:{js_str(spec['label'])}", f"color:{js_str(spec['color'])}",
          f"dark:{js_str(spec['dark'])}"]
    if spec.get('accent'):
        el.append(f"accent:{js_str(spec['accent'])}")
    el.append(f"speed:{spec.get('speed', 190)}")
    if spec.get('speedMod'):
        el.append(f"speedMod:{spec['speedMod']}")
    el.append(f"hp:{spec.get('hp', 120)}")
    el.append(f"trait:{js_str(spec['trait'])}")
    for opt in ('cooldownMod', 'dmgDealtMod', 'dmgTakenMod', 'gutsRegenMod', 'hitboxMult'):
        if spec.get(opt):
            el.append(f"{opt}:{spec[opt]}")
    rows = {}
    rows['ELEMENTS'] = ['  %s{ %s }, %s' % (_pad(k), ', '.join(el), mark)]

    walk = spec.get('walk') or {}
    if walk.get('front') and walk.get('back'):
        rows['WALK_ANIM'] = [
            '  %s{ %s' % (_pad(k), mark),
            "    base: { front:_loadWalk('%s_walk_f'), back:_loadWalk('%s_walk_b') }," % (k, k),
            '  },',
        ]

    mv = ',\n'.join('    ' + js_move(m) for m in moves)
    rows['SIGNATURE_MOVES'] = ['  %s[ %s' % (_pad(k), mark), mv, '  ],']

    rows['MONSTER_AURA'] = ["  %s%s, %s" % (_pad(k), js_str(spec['aura']), mark)]

    ma = ','.join("%s:%s" % (js_str(m['name']), js_str(spec.get('moveAura') or spec['aura']))
                  for m in moves)
    rows['MOVE_AURA'] = ['  %s %s' % (ma + ',', mark)]

    st = spec.get('stateChange')
    if st:
        eff = ', '.join(f'{a}:{js_value(b)}' for a, b in (st.get('effects') or {}).items())
        rows['STATE_CHANGES'] = [
            '  %s{ %s' % (_pad(k), mark),
            "    name:%s, duration:%s, cooldown:%s, trigger:%s, triggerValue:%s," % (
                js_str(st.get('name', '覚醒')), st.get('duration', 20), st.get('cooldown', 90),
                js_str(st.get('trigger', 'hpBelow')), st.get('triggerValue', 0.4)),
            '    effects:{ %s },' % eff,
            '  },',
        ]

    ap = spec['aptitude']
    rows['APTITUDE'] = ['  %s{ life:%s, power:%s, wisdom:%s, accuracy:%s, evasion:%s, vitality:%s }, %s' % (
        _pad(k), js_str(ap['life']), js_str(ap['power']), js_str(ap['wisdom']),
        js_str(ap['accuracy']), js_str(ap['evasion']), js_str(ap['vitality']), mark)]

    sk = spec.get('skin') or {}
    colors = sk.get('colors') or ['black', 'white', 'blue', 'yellow', 'green']
    src = sk.get('source') or {'type': 'light'}
    if src.get('type') == 'chroma':
        srcjs = "{type:'chroma', hue:%d, window:%d}" % (int(src.get('hue', 0)), int(src.get('window', 60)))
    else:
        srcjs = "{type:'light'}"
    note = ('   // ' + sk['note']) if sk.get('note') else ''
    rows['SKIN_CONFIG'] = ['  %s{ colors:[%s], source:%s }, %s%s' % (
        _pad(k), ','.join(js_str(c) for c in colors), srcjs, mark, note)]

    # 特性は既存モンスターと共有することがある(burn/haste など)。
    # すでに TRAIT_DESC にある特性なら重複キーを作らない
    if not trait_exists(spec['trait']):
        rows['TRAIT_DESC'] = ['  %s%s, %s' % (
            (spec['trait'] + ':').ljust(12), js_str(spec['traitDesc']), mark)]
    return rows

def trait_exists(trait):
    _p, t = _read('ui.js')
    m = re.search(r'^const TRAIT_DESC\s*=\s*\{', t, re.M)
    if not m:
        return False
    end = t.find('\n};', m.end())
    body = t[m.end():end if end > 0 else len(t)]
    return re.search(r'^  %s\s*:' % re.escape(trait), body, re.M) is not None

# ------------------------------------------------------------------ 挿入・削除
def _read(fn):
    p = os.path.join(REPO, fn)
    with open(p, encoding='utf-8') as f:
        return p, f.read()

def apply_rows(rows, dry_run=False):
    """rows(表名->行リスト)を各ファイルへ挿入する。戻り値は {ファイル: 新しい中身}。"""
    bufs = {}
    for name, lines in rows.items():
        fn = TABLE_FILE[name]
        if fn not in bufs:
            bufs[fn] = _read(fn)[1]
        rx = anchor_re(name)
        m = rx.search(bufs[fn])
        if not m:
            raise RuntimeError(f'{fn} に目印 <<AUTO:{name}>> が見つかりません')
        ins = '\n'.join(lines) + '\n'
        bufs[fn] = bufs[fn][:m.start()] + ins + bufs[fn][m.start():]
    if not dry_run:
        for fn, text in bufs.items():
            with open(os.path.join(REPO, fn), 'w', encoding='utf-8') as f:
                f.write(text)
    return bufs

def already_registered(key):
    """どれか1つでも登録済みなら True(重複追加を防ぐ)。"""
    p, t = _read('data.js')
    return ('/*@%s*/' % key) in t

def revert(key, dry_run=False):
    """/*@key*/ の目印が付いた行(と、その行が開いたブロック)を取り除く。"""
    mark = '/*@%s*/' % key
    changed = {}
    for fn in sorted(set(TABLE_FILE.values())):
        p, text = _read(fn)
        lines = text.split('\n')
        out, i, removed = [], 0, 0
        while i < len(lines):
            if mark in lines[i]:
                removed += 1
                # 目印の行が `{` や `[` で終わっていたら、対応する閉じ行まで捨てる
                depth = lines[i].count('{') + lines[i].count('[') - lines[i].count('}') - lines[i].count(']')
                i += 1
                while depth > 0 and i < len(lines):
                    depth += lines[i].count('{') + lines[i].count('[') - lines[i].count('}') - lines[i].count(']')
                    i += 1
                continue
            out.append(lines[i]); i += 1
        if removed:
            changed[fn] = ('\n'.join(out), removed)
    if not dry_run:
        for fn, (text, _n) in changed.items():
            with open(os.path.join(REPO, fn), 'w', encoding='utf-8') as f:
                f.write(text)
    return {fn: n for fn, (_t, n) in changed.items()}
