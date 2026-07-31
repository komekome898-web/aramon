#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
モンスターを1コマンドで追加する(開発用 / ゲームには読み込まれない)。

  python3 tools/monster_add.py <key>                # 全部やる
  python3 tools/monster_add.py <key> --dry-run      # 何も書かずに、入る差分を表示
  python3 tools/monster_add.py <key> --only code    # sprites / portraits / code / check から選ぶ
  python3 tools/monster_add.py <key> --revert       # 登録を全部取り消す
  python3 tools/monster_add.py --list               # 仕様ファイルの一覧

やること:
  1. sprites   : 動画 -> 歩行8コマ×2(既存の build_walk.py を呼ぶ)
  2. portraits : monsters/<key>.png と <key>_player.png を規定の形に整える
  3. code      : data.js / ui.js の9つの表へ登録行を追記(目印 <<AUTO:表名>> の直前)
  4. check     : 歩行コマの自動検査 + コンタクトシート出力 + check_monsters.py

仕様は monsters/specs/<key>.json。書き方は monsters/specs/_example.json を参照。
"""
import argparse, os, sys, json, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
REPO = os.path.dirname(HERE)

import monster_spec as MS
import monster_code as MC

STEPS = ('sprites', 'portraits', 'code', 'check')

def _rel(p):
    return p if os.path.isabs(p) else os.path.join(REPO, p)

def do_sprites(spec):
    import monster_art as MA
    print('[1/4] 歩行スプライト')
    w = spec.get('walk') or {}
    if not (w.get('front') and w.get('back')):
        print('  walk が未指定なのでスキップ'); return
    spec = dict(spec)
    spec['walk'] = dict(w, front=_rel(w['front']), back=_rel(w['back']))
    MA.build_walk(spec)

def do_portraits(spec):
    import monster_art as MA
    print('[2/4] 静止画')
    key = spec['key']
    imgs = spec.get('images') or {}
    pairs = [(imgs.get('icon'), f'{key}.png'), (imgs.get('player') or imgs.get('icon'), f'{key}_player.png')]
    for src, dst in pairs:
        if not src:
            print(f'  images.icon が無いので {dst} はスキップ'); continue
        s = _rel(src)
        if not os.path.exists(s):
            raise SystemExit('画像が見つかりません: ' + s)
        out = os.path.join(REPO, 'monsters', dst)
        MA.normalize_portrait(s, out)
        print('  ->', os.path.relpath(out, REPO))

def resolve_hue(spec):
    """skin.source.hue が null なら実画像から色相をサンプリングして埋める。"""
    sk = spec.get('skin') or {}
    src = sk.get('source') or {}
    if src.get('type') != 'chroma' or src.get('hue') is not None:
        return spec
    icon = os.path.join(REPO, 'monsters', spec['key'] + '.png')
    if not os.path.exists(icon):
        print('  (色相の自動サンプリングは静止画が出来てから)'); return spec
    import monster_art as MA
    hue = MA.sample_hue(icon, src.get('window', 60))
    spec = json.loads(json.dumps(spec))
    if hue is None:
        spec['skin']['source'] = {'type': 'light'}
        print('  彩度の高い部分が少ないので source.type=light にしました')
    else:
        spec['skin']['source']['hue'] = hue
        print(f'  色相を自動サンプリング: hue={hue}')
    return spec

def do_code(spec, dry_run=False):
    print('[3/4] data.js / ui.js への登録')
    key = spec['key']
    if MC.already_registered(key):
        print(f'  {key} は登録済みです(やり直すなら --revert)'); return
    spec = resolve_hue(spec)
    moves = MS.build_moves(spec)
    rows = MC.render_rows(spec, moves)
    for name in [n for n, _f in MC.TABLES if n in rows]:
        print(f'  --- {name} ({MC.TABLE_FILE[name]})')
        for ln in rows[name]:
            for sub in ln.split('\n'):
                print('   +' + sub)
    if dry_run:
        print('  (--dry-run なので書き込みませんでした)'); return
    MC.apply_rows(rows)
    print('  書き込みました')

def do_check(spec):
    print('[4/4] 検証')
    key = spec['key']
    ok = True
    try:
        import monster_art as MA
        for side in ('f', 'b'):
            bad, _idx = MA.inspect_walk(key, side)
            for b in bad:
                print('  ! ' + b); ok = False
        sheet = MA.contact_sheet(key)
        print('  コンタクトシート:', os.path.relpath(sheet, REPO))
        print('  ★このシート1枚を見て、突起・足の欠けと背景残りが無いことを確認してください')
    except SystemExit as e:
        print('  (画像検査はスキップ)', e)
    r = subprocess.run([sys.executable, os.path.join(HERE, 'check_monsters.py')],
                       capture_output=True, text=True)
    sys.stdout.write(r.stdout)
    if r.returncode != 0:
        ok = False
    for fn in ('data.js', 'ui.js'):
        c = subprocess.run(['node', '--check', os.path.join(REPO, fn)], capture_output=True, text=True)
        if c.returncode != 0:
            print(f'  × {fn} の構文エラー:\n{c.stderr}'); ok = False
        else:
            print(f'  ○ {fn} 構文OK')
    return ok

def main():
    ap = argparse.ArgumentParser(description='モンスターを1コマンドで追加する')
    ap.add_argument('key', nargs='?', help='monsters/specs/<key>.json の <key>')
    ap.add_argument('--dry-run', action='store_true', help='書き込まずに差分だけ表示')
    ap.add_argument('--revert', action='store_true', help='登録を取り消す')
    ap.add_argument('--only', choices=STEPS, action='append', help='この工程だけ実行(複数可)')
    ap.add_argument('--list', action='store_true', help='仕様ファイルの一覧')
    a = ap.parse_args()

    if a.list:
        if not os.path.isdir(MS.SPEC_DIR):
            print('仕様ディレクトリがありません:', MS.SPEC_DIR); return 0
        for f in sorted(os.listdir(MS.SPEC_DIR)):
            if f.endswith('.json'):
                print(' ', f[:-5])
        return 0
    if not a.key:
        ap.print_help(); return 2

    if a.revert:
        n = MC.revert(a.key, dry_run=a.dry_run)
        if not n:
            print(f'{a.key} の登録行は見つかりませんでした')
        for fn, cnt in n.items():
            print(f'{fn}: {cnt}か所を削除' + ('(--dry-run)' if a.dry_run else ''))
        if not a.dry_run:
            for fn in ('data.js', 'ui.js'):
                c = subprocess.run(['node', '--check', os.path.join(REPO, fn)], capture_output=True, text=True)
                print(f'  {"○" if c.returncode==0 else "×"} {fn} 構文チェック')
        return 0

    spec = MS.load_spec(a.key)
    steps = a.only or list(STEPS)
    print(f'== {spec["key"]} / {spec["label"]} ==')
    if 'sprites' in steps and not a.dry_run:
        do_sprites(spec)
    if 'portraits' in steps and not a.dry_run:
        do_portraits(spec)
    if 'code' in steps:
        do_code(spec, dry_run=a.dry_run)
    if 'check' in steps and not a.dry_run:
        ok = do_check(spec)
        if not ok:
            print('\n不足や警告があります。上の内容を確認してください。')
            return 1
    print('\n完了。sw.js の CACHE_NAME を1つ上げてコミットしてください。')
    return 0

if __name__ == '__main__':
    sys.exit(main())
