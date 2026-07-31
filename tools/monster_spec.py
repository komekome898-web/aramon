# -*- coding: utf-8 -*-
"""
モンスター仕様(monsters/specs/<key>.json)の読み込み・検証・技テンプレート展開。

・標準ライブラリだけで動く(画像処理は monster_art.py 側)。
・「技はテンプレートを選ぶだけ」にすることで、コードを書かずに既存の立体エフェクトが
  そのまま乗るようにしてある(CLAUDE.md「技エフェクトの立体化」参照)。
"""
import json, os, re

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC_DIR = os.path.join(REPO, 'monsters', 'specs')

AURAS = ('red', 'blue', 'yellow', 'green', 'white', 'black')
RANKS = ('S', 'A', 'B', 'C', 'D', 'E')
STAT_KEYS = ('life', 'power', 'wisdom', 'accuracy', 'evasion', 'vitality')

# ---------------------------------------------------------------- 技テンプレート
# tier1/tier2 は「絵文字を選ぶ」だけ。REAL_ICON_FX に載っている絵文字なら
# リアルな弾エフェクトが自動で付く(表に無ければ光の弾へフォールバック)。
MOVE_T1 = dict(tier=1, range=700, dmg=24, cooldown=0.85, gutsCost=8,
               projSpeed=520, hitR=12, splash=70)
MOVE_T2 = dict(tier=2, range=1400, dmg=13, cooldown=1.05, gutsCost=16,
               projSpeed=500, hitR=7, burst=3, burstGap=0.1)

# tier3 は「形」を選ぶ。すべて既存の描画経路に乗るので新しいコードは要らない。
TIER3_TEMPLATES = {
    # 範囲技(aoeShape)
    'fan':     dict(tier=3, dmg=55, cooldown=2.1, gutsCost=24, aoeShape='fan',
                    range=800, fanAngleDeg=45, aoeStyle='inferno'),   # 炎の扇
    'wave':    dict(tier=3, dmg=47, cooldown=2.0, gutsCost=24, aoeShape='rect',
                    range=1000, rectWidth=220, aoeStyle='lava'),      # 炎の壁が前進
    'crystal': dict(tier=3, dmg=42, cooldown=1.9, gutsCost=24, aoeShape='rect',
                    range=900, rectWidth=260, aoeStyle='crystal'),    # 結晶が降ってせり上がる
    'beam':    dict(tier=3, dmg=46, cooldown=2.1, gutsCost=24, aoeShape='rect',
                    range=1000, rectWidth=120, projSpeed=1400, aoeStyle='sakura'),  # 光の筒
    'river':   dict(tier=3, dmg=48, cooldown=2.1, gutsCost=24, aoeShape='rect',
                    range=2200, rectWidth=160, aoeStyle='galaxy'),    # 宙を走る星の川
    'beams3':  dict(tier=3, dmg=44, cooldown=2.2, gutsCost=24, aoeShape='beams',
                    range=1200, beamWidth=100, beamCount=3, beamSpreadDeg=40, aoeStyle='flower'),
    'thunder': dict(tier=3, dmg=40, cooldown=1.9, gutsCost=24, aoeShape='zigzag',
                    range=1400, zigzagWidth=110, aoeStyle='thunder'), # 空から落雷
    'psychic': dict(tier=3, dmg=45, cooldown=2.0, gutsCost=24, aoeShape='fanZigzag',
                    range=1300, fanAngleDeg=30, aoeStyle='psychic'),  # 弧を描く念力の壁
    # 単発弾(projStyle)
    'orb':     dict(tier=3, dmg=20, cooldown=2.3, gutsCost=24, range=1500,
                    projSpeed=640, hitR=28, splash=0, projStyle='voidOrb', icon='🔮',
                    blast=dict(radius=330, dmg=60, expandTime=0.5)),  # 着弾でドーム爆風
    'tornado': dict(tier=3, dmg=62, cooldown=2.4, gutsCost=24, range=1600,
                    projSpeed=520, hitR=34, splash=60, projStyle='tornado', growWithDistance=True),
    'sword':   dict(tier=3, dmg=58, cooldown=2.0, gutsCost=24, range=1850,
                    projSpeed=560, hitR=30, splash=55, shape='triangle', projStyle='holy'),
    'shell':   dict(tier=3, dmg=56, cooldown=2.1, gutsCost=24, range=1750,
                    projSpeed=500, hitR=34, splash=58, shape='sphere', projStyle='shell'),
    'crescent':dict(tier=3, dmg=21, cooldown=2.0, gutsCost=24, range=1340,
                    projSpeed=820, hitR=22, burst=5, burstGap=0.09, projStyle='crescent'),
    'spear':   dict(tier=3, dmg=22, cooldown=2.2, gutsCost=24, range=1350,
                    projSpeed=1150, hitR=34, burst=3, burstGap=0.12, burstSpread=0.11,
                    projStyle='seaSpear',
                    blast=dict(radius=325, dmg=26, expandTime=0.5)),
}

class SpecError(Exception):
    pass

def spec_path(key):
    return os.path.join(SPEC_DIR, key + '.json')

def load_spec(key_or_path):
    p = key_or_path if key_or_path.endswith('.json') else spec_path(key_or_path)
    if not os.path.exists(p):
        raise SpecError('仕様ファイルが見つかりません: ' + p)
    with open(p, encoding='utf-8') as f:
        spec = json.load(f)
    spec.setdefault('key', os.path.splitext(os.path.basename(p))[0])
    validate_spec(spec)
    return spec

def _need(spec, k):
    if k not in spec or spec[k] in (None, ''):
        raise SpecError('必須項目がありません: ' + k)
    return spec[k]

HEX_RE = re.compile(r'^#[0-9a-fA-F]{6}$')

def validate_spec(spec):
    key = _need(spec, 'key')
    if not re.match(r'^[a-z][a-z0-9_]*$', key):
        raise SpecError('key は英小文字で始まる英数字にしてください: ' + key)
    for k in ('label', 'color', 'dark', 'trait', 'traitDesc', 'aura'):
        _need(spec, k)
    for k in ('color', 'dark', 'accent'):
        v = spec.get(k)
        if v and not HEX_RE.match(v):
            raise SpecError(f'{k} は #rrggbb 形式にしてください: {v}')
    if spec['aura'] not in AURAS:
        raise SpecError('aura は %s のいずれか: %s' % ('/'.join(AURAS), spec['aura']))
    ap = spec.get('aptitude') or {}
    for k in STAT_KEYS:
        if ap.get(k) not in RANKS:
            raise SpecError(f'aptitude.{k} は {"/".join(RANKS)} のいずれかが必要です')
    moves = spec.get('moves') or []
    if len(moves) != 3:
        raise SpecError('moves はちょうど3つ(tier1/2/3)にしてください')
    for i, mv in enumerate(moves):
        if not mv.get('name'):
            raise SpecError(f'moves[{i}].name がありません')
    if moves[2].get('template') not in TIER3_TEMPLATES:
        raise SpecError('moves[2].template は %s のいずれか' % '/'.join(sorted(TIER3_TEMPLATES)))
    sk = spec.get('skin') or {}
    if sk.get('colors') and len(sk['colors']) != 5:
        raise SpecError('skin.colors は5色にしてください')
    return spec

# ------------------------------------------------------------ 技オブジェクト生成
def build_moves(spec):
    """spec の moves[] を、SIGNATURE_MOVES に入れる3つの技オブジェクトへ展開する。
       テンプレートの値は spec 側の同名キーで上書きできる。"""
    key = spec['key']
    color = spec['color']
    t3col = spec.get('tier3Color') or spec.get('accent') or color
    out = []
    for i, mv in enumerate(spec['moves']):
        if i == 0:
            base = dict(MOVE_T1); base['color'] = color
            if mv.get('icon'): base['icon'] = mv['icon']
        elif i == 1:
            base = dict(MOVE_T2); base['color'] = color
            if mv.get('icon'): base['icon'] = mv['icon']
        else:
            base = dict(TIER3_TEMPLATES[mv['template']]); base['color'] = t3col
        base['name'] = mv['name']
        for k, v in mv.items():
            if k in ('template',):
                continue
            base[k] = v
        # blast の色は技色に合わせる(指定があればそちらを優先)
        if isinstance(base.get('blast'), dict):
            base['blast'].setdefault('color', base['color'])
        out.append(base)
    # tier順を保証
    out[0]['tier'], out[1]['tier'], out[2]['tier'] = 1, 2, 3
    for mv in out:
        mv.pop('key', None)
    return out

# ------------------------------------------------------------ JS リテラル化
def js_str(s):
    return "'" + str(s).replace('\\', '\\\\').replace("'", "\\'") + "'"

def js_num(v):
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, float):
        s = ('%g' % v)
        return s
    return str(v)

_JS_ORDER = ['name', 'tier', 'color', 'range', 'dmg', 'cooldown', 'gutsCost', 'projSpeed',
             'hitR', 'hitW', 'splash', 'burst', 'burstGap', 'burstSpread', 'icon', 'shape',
             'projStyle', 'aoeShape', 'aoeStyle', 'rectWidth', 'beamWidth', 'zigzagWidth',
             'fanAngleDeg', 'beamCount', 'beamSpreadDeg', 'seStyle', 'growWithDistance',
             'gutsDrainRatio', 'melee', 'blast']

def js_value(v):
    if isinstance(v, dict):
        return '{ ' + ', '.join(f'{k}:{js_value(x)}' for k, x in v.items()) + ' }'
    if isinstance(v, list):
        return '[' + ','.join(js_value(x) for x in v) + ']'
    if isinstance(v, str):
        return js_str(v)
    return js_num(v)

def js_move(mv):
    keys = [k for k in _JS_ORDER if k in mv] + [k for k in mv if k not in _JS_ORDER]
    return '{ ' + ', '.join(f'{k}:{js_value(mv[k])}' for k in keys) + ' }'
