#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
モンスター登録の検査(CLAUDE.md「新モンスター追加チェックリスト」の機械化)。

ELEMENTS に載っている全モンスターについて、必要な表と画像が揃っているかを見る。
1つでも欠けると実際に不具合になるので、追加作業の最後に必ず通す。

  python3 tools/check_monsters.py          # 検査して結果を出す(問題があれば終了コード1)
  python3 tools/check_monsters.py -v       # 揃っているものも一覧表示

標準ライブラリだけで動く。
"""
import os, re, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 表名 -> (ファイル, キーの探し方)  'key' = `foo:` 形式 / 'moveName' = 技名で引く
TABLES = [
    ('ELEMENTS',        'data.js'),
    ('WALK_ANIM',       'data.js'),
    ('SIGNATURE_MOVES', 'data.js'),
    ('MONSTER_AURA',    'data.js'),
    ('STATE_CHANGES',   'data.js'),
    ('APTITUDE',        'data.js'),
    ('SKIN_CONFIG',     'data.js'),
]
# 欠けても致命的ではないもの(警告どまり)
OPTIONAL = {'WALK_ANIM', 'STATE_CHANGES'}

def read(fn):
    with open(os.path.join(REPO, fn), encoding='utf-8') as f:
        return f.read()

def table_body(text, name):
    """`const NAME = {` から、行頭の `};` までを返す。"""
    m = re.search(r'^const %s\s*=\s*\{' % re.escape(name), text, re.M)
    if not m:
        return None
    end = text.find('\n};', m.end())
    return text[m.end():end] if end > 0 else text[m.end():]

def top_keys(body):
    """インデント2の `key:` を拾う(ネストした内側の項目は拾わない)。"""
    return set(re.findall(r'^  ([A-Za-z_][A-Za-z0-9_]*)\s*:', body, re.M))

# 1行に複数のキーを並べている表(MONSTER_AURA など)は行頭では拾えない
FLAT_TABLES = {'MONSTER_AURA'}
def has_key(name, body, key):
    if name in FLAT_TABLES:
        return re.search(r'(^|[\s,{])%s\s*:' % re.escape(key), body, re.M) is not None
    return key in top_keys(body)

def main(argv):
    verbose = '-v' in argv
    data, ui = read('data.js'), read('ui.js')
    src = {'data.js': data, 'ui.js': ui}

    el_body = table_body(data, 'ELEMENTS')
    if el_body is None:
        print('ELEMENTS が見つかりません'); return 1
    monsters = sorted(top_keys(el_body))

    bodies = {}
    for name, fn in TABLES:
        b = table_body(src[fn], name)
        if b is None:
            print(f'× 表 {name} が {fn} に見つかりません'); return 1
        bodies[name] = b

    # TRAIT_DESC は trait 名で引くので別扱い
    trait_body = table_body(ui, 'TRAIT_DESC')
    traits = top_keys(trait_body) if trait_body else set()
    # 技名 -> MOVE_AURA
    move_aura_body = table_body(data, 'MOVE_AURA') or ''
    aura_names = set(re.findall(r"'([^']+)'\s*:", move_aura_body))

    problems, warns = [], []
    for key in monsters:
        miss, wmiss = [], []
        for name, _fn in TABLES:
            if name == 'ELEMENTS':
                continue
            if not has_key(name, bodies[name], key):
                (wmiss if name in OPTIONAL else miss).append(name)
        # trait
        mt = re.search(r"^  %s\s*:.*?trait\s*:\s*'([^']+)'" % re.escape(key), el_body, re.M | re.S)
        trait = mt.group(1) if mt else None
        if trait and trait not in traits:
            miss.append(f'TRAIT_DESC[{trait}]')
        # 技名がすべて MOVE_AURA にあるか
        sm = table_body(data, 'SIGNATURE_MOVES') or ''
        blk = re.search(r"^  %s\s*:\s*\[(.*?)^  \]," % re.escape(key), sm, re.M | re.S)
        if blk:
            for nm in re.findall(r"name\s*:\s*'([^']+)'", blk.group(1)):
                if nm not in aura_names:
                    miss.append(f'MOVE_AURA[{nm}]')
        # 画像
        for suffix in ('', '_player'):
            hit = any(os.path.exists(os.path.join(REPO, 'monsters', f'{key}{suffix}.{e}'))
                      for e in ('png', 'PNG', 'Png'))
            if not hit:
                miss.append(f'monsters/{key}{suffix}.png')
        # 歩行コマの実体
        if has_key('WALK_ANIM', bodies['WALK_ANIM'], key):
            for side in ('f', 'b'):
                lack = [i for i in range(1, 9)
                        if not os.path.exists(os.path.join(REPO, 'monsters', f'{key}_walk_{side}{i}.png'))]
                if lack:
                    miss.append(f'{key}_walk_{side}{lack[0]}..{lack[-1]}.png ({len(lack)}枚)')
        if miss:
            problems.append((key, miss))
        elif wmiss:
            warns.append((key, wmiss))
        elif verbose:
            print(f'○ {key}')

    for key, wmiss in warns:
        print(f'△ {key}: 任意項目なし ({", ".join(wmiss)})')
    for key, miss in problems:
        print(f'× {key}: {", ".join(miss)}')
    print(f'--- モンスター {len(monsters)}体 / 不足あり {len(problems)}体')
    return 1 if problems else 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
