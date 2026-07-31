#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
モンスター作成スタジオ(開発用のローカルGUI / ゲームには読み込まれない)。

  python3 tools/monster_studio.py            # http://127.0.0.1:8777 を開く
  python3 tools/monster_studio.py --port 9000

できること:
  ・仕様(monsters/specs/<key>.json)をフォームで編集して保存
  ・歩行動画の背景透過モードを切り替えながら8コマをその場でプレビュー(目視確認がそのまま作業画面)
  ・問題のあるコマを自動で赤く印付け(面積のずれ/突起の欠け/足の欠け/縁への接触)
  ・書き出し → 静止画の整形 → data.js/ui.js への登録 → 検証 までボタンで実行

重い処理(ffmpeg・背景除去・量子化)は既存の tools/build_walk.py をそのまま呼ぶので、
モンスターごとに積み上げた背景除去の資産を捨てずにGUIだけ足している。
サーバは標準ライブラリのみ。画像処理を使う操作の時だけ pillow/numpy/cv2/scipy が要る。
"""
import argparse, base64, io, json, os, sys, subprocess, threading, traceback
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
REPO = os.path.dirname(HERE)
import monster_spec as MS
import monster_code as MC

_lock = threading.Lock()

def _abs(p):
    return p if os.path.isabs(p) else os.path.join(REPO, p)

def _png_b64(pil):
    b = io.BytesIO(); pil.save(b, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()

# ------------------------------------------------------------------ API 本体
def api_specs():
    os.makedirs(MS.SPEC_DIR, exist_ok=True)
    return {'keys': sorted(f[:-5] for f in os.listdir(MS.SPEC_DIR) if f.endswith('.json'))}

def api_spec(key):
    p = MS.spec_path(key)
    if not os.path.exists(p):
        return {'error': '仕様がありません: ' + key}
    with open(p, encoding='utf-8') as f:
        return {'spec': json.load(f)}

def api_save(body):
    spec = body.get('spec') or {}
    key = spec.get('key')
    if not key:
        return {'error': 'key がありません'}
    try:
        MS.validate_spec(spec)
    except MS.SpecError as e:
        return {'error': str(e)}
    os.makedirs(MS.SPEC_DIR, exist_ok=True)
    with open(MS.spec_path(key), 'w', encoding='utf-8') as f:
        json.dump(spec, f, ensure_ascii=False, indent=2)
    return {'ok': True, 'path': os.path.relpath(MS.spec_path(key), REPO)}

def api_preview(body):
    """動画から8コマを作って返す(保存はしない)。モード切替の当たりを付けるための機能。"""
    import build_walk as bw
    import monster_art as MA
    MA._need_libs()
    mov = _abs(body.get('video') or '')
    if not os.path.exists(mov):
        return {'error': '動画が見つかりません: ' + mov}
    prefix = 'preview_' + (body.get('key') or 'tmp') + ('_f' if body.get('front') else '_b')
    with _lock:
        imgs, meta = bw.build_frames(mov, prefix, bool(body.get('front')),
                                     body.get('mode', 'blackopen'),
                                     body.get('knockout', 'single'), cache=True)
    if not imgs:
        return {'error': 'フレームが足りません'}
    return {'frames': [_png_b64(i) for i in imgs],
            'meta': {k: (list(v) if isinstance(v, list) else v) for k, v in meta.items()},
            'issues': _issues_from_images(imgs)}

def _issues_from_images(imgs):
    """プレビュー画像そのものから問題コマを見つける(monster_art.inspect_walk と同じ考え方)。"""
    import numpy as np
    areas, tops, foots, edges = [], [], [], []
    for im in imgs:
        a = np.asarray(im.convert('RGBA'))[:, :, 3]
        m = a > 40
        areas.append(int(m.sum()))
        ys, _xs = np.where(m)
        tops.append(int(ys.min()) if len(ys) else 10 ** 6)
        foots.append(int(m[int(a.shape[0] * 0.8):, :].sum()))
        edges.append(bool(m[0, :].any() or m[-1, :].any() or m[:, 0].any() or m[:, -1].any()))
    med_a = float(np.median(areas)); med_t = float(np.median(tops)); med_f = float(np.median(foots))
    out = []
    for i in range(len(imgs)):
        why = []
        if med_a > 0 and abs(areas[i] - med_a) / med_a > 0.28:
            why.append('面積が%+.0f%%ずれ' % ((areas[i] - med_a) / med_a * 100))
        if tops[i] - med_t > 18:
            why.append('上端が%dpx低い(突起の欠け)' % (tops[i] - med_t))
        if med_f > 0 and (med_f - foots[i]) / med_f > 0.4:
            why.append('足元が%.0f%%少ない' % ((med_f - foots[i]) / med_f * 100))
        if edges[i]:
            why.append('画像の縁に接触')
        out.append('/'.join(why))
    return out

def api_build_walk(body):
    import monster_art as MA
    spec = MS.load_spec(body['key'])
    w = dict(spec.get('walk') or {})
    for k in ('mode', 'knockout'):
        if body.get(k):
            w[k] = body[k]
    spec = dict(spec, walk=dict(w, front=_abs(w.get('front', '')), back=_abs(w.get('back', ''))))
    with _lock:
        MA.build_walk(spec, side=body.get('side'))
    return {'ok': True}

def api_portraits(body):
    import monster_art as MA
    spec = MS.load_spec(body['key'])
    imgs = spec.get('images') or {}
    done = []
    for src, dst in ((imgs.get('icon'), spec['key'] + '.png'),
                     (imgs.get('player') or imgs.get('icon'), spec['key'] + '_player.png')):
        if not src:
            continue
        MA.normalize_portrait(_abs(src), os.path.join(REPO, 'monsters', dst))
        done.append(dst)
    hue = None
    icon = os.path.join(REPO, 'monsters', spec['key'] + '.png')
    if os.path.exists(icon):
        hue = MA.sample_hue(icon, ((spec.get('skin') or {}).get('source') or {}).get('window', 60))
    return {'ok': True, 'files': done, 'hue': hue}

def api_contact(key):
    import monster_art as MA
    return {'image': _png_b64(__import__('PIL.Image', fromlist=['Image']).open(MA.contact_sheet(key)))}

def api_register(body):
    spec = MS.load_spec(body['key'])
    dry = bool(body.get('dryRun'))
    if MC.already_registered(spec['key']) and not dry:
        return {'error': 'すでに登録済みです(やり直すなら「登録を取り消す」)'}
    moves = MS.build_moves(spec)
    rows = MC.render_rows(spec, moves)
    text = []
    for name, _fn in MC.TABLES:
        if name in rows:
            text.append(f'--- {name} ({MC.TABLE_FILE[name]})')
            for ln in rows[name]:
                text += ['+' + s for s in ln.split('\n')]
    if not dry:
        MC.apply_rows(rows)
    return {'ok': True, 'diff': '\n'.join(text), 'dryRun': dry}

def api_revert(body):
    n = MC.revert(body['key'])
    return {'ok': True, 'removed': n}

def api_check(body):
    out = []
    r = subprocess.run([sys.executable, os.path.join(HERE, 'check_monsters.py')],
                       capture_output=True, text=True)
    out.append(r.stdout.strip())
    for fn in ('data.js', 'ui.js'):
        c = subprocess.run(['node', '--check', os.path.join(REPO, fn)], capture_output=True, text=True)
        out.append(('○ ' if c.returncode == 0 else '× ') + fn + ' 構文' + (('\n' + c.stderr) if c.returncode else ''))
    return {'ok': r.returncode == 0, 'text': '\n'.join(out)}

def api_meta():
    """UIのプルダウンに出す選択肢(コード側の実体から作るのでズレない)。"""
    icons = []
    try:
        with open(os.path.join(REPO, 'render.js'), encoding='utf-8') as f:
            t = f.read()
        i = t.find('const REAL_ICON_FX = {')
        if i > 0:
            import re
            body = t[i:t.find('};', i)]
            icons = re.findall(r"'([^']+)'\s*:\s*fxIcon", body)
    except Exception:
        pass
    return {'templates': sorted(MS.TIER3_TEMPLATES), 'icons': icons,
            'auras': list(MS.AURAS), 'ranks': list(MS.RANKS), 'stats': list(MS.STAT_KEYS),
            'modes': ['blackopen', 'black', 'white', 'grass'],
            'knockouts': ['single', 'gentle', 'hard', 'hardgentle', 'phoenixcut']}

ROUTES_GET = {
    '/api/specs': lambda q: api_specs(),
    '/api/spec': lambda q: api_spec(q.get('key', [''])[0]),
    '/api/meta': lambda q: api_meta(),
    '/api/contact': lambda q: api_contact(q.get('key', [''])[0]),
}
ROUTES_POST = {
    '/api/save': api_save,
    '/api/preview': api_preview,
    '/api/buildwalk': api_build_walk,
    '/api/portraits': api_portraits,
    '/api/register': api_register,
    '/api/revert': api_revert,
    '/api/check': api_check,
}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype='application/json; charset=utf-8'):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path in ('/', '/index.html'):
            with open(os.path.join(HERE, 'studio.html'), 'rb') as f:
                return self._send(200, f.read(), 'text/html; charset=utf-8')
        fn = ROUTES_GET.get(u.path)
        if not fn:
            return self._send(404, {'error': 'not found'})
        try:
            return self._send(200, fn(parse_qs(u.query)))
        except SystemExit as e:
            return self._send(200, {'error': str(e)})
        except Exception:
            return self._send(200, {'error': traceback.format_exc(limit=3)})

    def do_POST(self):
        u = urlparse(self.path)
        fn = ROUTES_POST.get(u.path)
        if not fn:
            return self._send(404, {'error': 'not found'})
        n = int(self.headers.get('Content-Length') or 0)
        try:
            body = json.loads(self.rfile.read(n) or b'{}')
        except Exception:
            body = {}
        try:
            return self._send(200, fn(body))
        except SystemExit as e:
            return self._send(200, {'error': str(e)})
        except Exception:
            return self._send(200, {'error': traceback.format_exc(limit=3)})

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8777)
    a = ap.parse_args()
    srv = ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    print(f'モンスター作成スタジオ: http://127.0.0.1:{a.port}  (Ctrl+C で終了)')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\n終了しました')

if __name__ == '__main__':
    main()
