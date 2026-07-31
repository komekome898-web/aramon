# -*- coding: utf-8 -*-
"""
画像まわり(歩行スプライト生成 / 静止画の正規化 / 色のサンプリング /
コンタクトシート / 自動異常検出)。

依存: pillow numpy opencv-python-headless scipy imageio-ffmpeg
  pip install pillow numpy opencv-python-headless scipy imageio-ffmpeg
未導入でも import は通り、使おうとした時にだけ分かりやすく落ちる。
"""
import os, sys, colorsys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MON = os.path.join(REPO, 'monsters')
OUT = os.path.join(REPO, 'tools', 'out')

def _need_libs():
    try:
        import numpy, PIL, cv2, scipy  # noqa
    except ImportError as e:
        raise SystemExit(
            '画像処理に必要なライブラリがありません(%s)。\n'
            '  pip install pillow numpy opencv-python-headless scipy imageio-ffmpeg' % e.name)

# ------------------------------------------------------------------ 歩行スプライト
def build_walk(spec, side=None):
    """spec['walk'] の動画から <key>_walk_f1..8 / _b1..8 を作る。
       中身は既存の tools/build_walk.py をそのまま呼ぶ(積み上げた背景除去の資産を捨てない)。"""
    _need_libs()
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import build_walk as bw
    w = spec.get('walk') or {}
    key = spec['key']
    mode = w.get('mode', 'blackopen')
    knockout = w.get('knockout', 'single')
    jobs = []
    if side in (None, 'front') and w.get('front'):
        jobs.append((w['front'], f'{key}_walk_f', True))
    if side in (None, 'back') and w.get('back'):
        jobs.append((w['back'], f'{key}_walk_b', False))
    if not jobs:
        raise SystemExit('walk.front / walk.back に動画のパスを書いてください')
    for mov, prefix, front in jobs:
        if not os.path.exists(mov):
            raise SystemExit('動画が見つかりません: ' + mov)
        print(f'  {prefix} ({mode}/{knockout})')
        bw.process(mov, prefix, front, mode, knockout)
    return [p for _m, p, _f in jobs]

# ------------------------------------------------------------------ 静止画の正規化
PORTRAIT_SIZE = 512
PORTRAIT_H = 0.90      # 被写体の高さが画像の何割になるか
PORTRAIT_FEET = 0.97   # 足元を下端のどこに置くか

def normalize_portrait(src_path, out_path, size=PORTRAIT_SIZE):
    """正方形・被写体が高さの9割・足元が下端付近、の静止画に整える。
       (CLAUDE.md「新モンスター追加チェックリスト」10番の要件)"""
    _need_libs()
    import numpy as np
    from PIL import Image
    im = Image.open(src_path).convert('RGBA')
    a = np.asarray(im)[:, :, 3]
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        raise SystemExit('透過部分しかありません: ' + src_path)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    crop = im.crop((int(x0), int(y0), int(x1) + 1, int(y1) + 1))
    k = (size * PORTRAIT_H) / crop.height
    nw, nh = max(1, round(crop.width * k)), max(1, round(crop.height * k))
    if nw > size:   # 横に長い被写体は幅で収める
        k *= size / nw
        nw, nh = max(1, round(crop.width * k)), max(1, round(crop.height * k))
    crop = crop.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(crop, ((size - nw) // 2, max(0, int(size * PORTRAIT_FEET) - nh)))
    canvas.save(out_path)
    return out_path

# ------------------------------------------------------------------ 色のサンプリング
def sample_hue(img_path, window=60):
    """画像の「主役の色」の色相を返す(SKIN_CONFIG.source.hue の自動化)。
       彩度の高い画素だけを色相ヒストグラムに積み、いちばん多い山の中心を採る。
       彩度の高い画素が少なければ None(=白っぽいので source.type='light' が向く)。"""
    _need_libs()
    import numpy as np
    from PIL import Image
    im = Image.open(img_path).convert('RGBA')
    arr = np.asarray(im).astype(np.float32) / 255.0
    rgb, al = arr[:, :, :3], arr[:, :, 3]
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    v = mx
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    m = (al > 0.6) & (s > 0.35) & (v > 0.2)
    if m.sum() < arr.shape[0] * arr.shape[1] * 0.01:
        return None
    r, g, b = rgb[:, :, 0][m], rgb[:, :, 1][m], rgb[:, :, 2][m]
    mxv, mnv = np.maximum.reduce([r, g, b]), np.minimum.reduce([r, g, b])
    d = np.maximum(mxv - mnv, 1e-6)
    h = np.zeros_like(r)
    i1, i2, i3 = (mxv == r), (mxv == g), (mxv == b)
    h[i1] = ((g[i1] - b[i1]) / d[i1]) % 6
    h[i2] = (b[i2] - r[i2]) / d[i2] + 2
    h[i3] = (r[i3] - g[i3]) / d[i3] + 4
    h = (h * 60) % 360
    hist, _edges = np.histogram(h, bins=72, range=(0, 360), weights=s[m])
    # 円環なので、窓幅ぶんの移動和がいちばん大きい位置を山の中心にする
    wbins = max(1, int(round(window / 5)))
    ext = np.concatenate([hist, hist])
    sums = np.array([ext[i:i + wbins].sum() for i in range(72)])
    c = int(sums.argmax())
    return int((c * 5 + window / 2) % 360)

# ------------------------------------------------------------------ 検証
def _frames(prefix):
    return [os.path.join(MON, f'{prefix}{i}.png') for i in range(1, 9)]

def inspect_walk(key, side):
    """歩行8コマを調べ、[問題の説明] を返す。目視の負担を減らすための自動チェック。
       ・前景の面積が他コマから大きく外れる(抜けすぎ/背景残り)
       ・上端が他コマより明らかに低い(トサカ等の突起が欠けた)
       ・下20%の面積が他コマより明らかに少ない(足が欠けた)
       ・画像の縁に不透明画素が触れている(切れている/背景が残っている)"""
    _need_libs()
    import numpy as np
    from PIL import Image
    prefix = f'{key}_walk_{side}'
    files = _frames(prefix)
    miss = [f for f in files if not os.path.exists(f)]
    if miss:
        return [f'{os.path.basename(m)} がありません' for m in miss], []
    areas, tops, foots, edges = [], [], [], []
    for f in files:
        a = np.asarray(Image.open(f).convert('RGBA'))[:, :, 3]
        m = a > 40
        areas.append(int(m.sum()))
        ys, _xs = np.where(m)
        tops.append(int(ys.min()) if len(ys) else 10 ** 6)
        h = a.shape[0]
        foots.append(int(m[int(h * 0.8):, :].sum()))
        edge = bool(m[0, :].any() or m[-1, :].any() or m[:, 0].any() or m[:, -1].any())
        edges.append(edge)
    med_a = float(np.median(areas)); med_t = float(np.median(tops)); med_f = float(np.median(foots))
    bad = []
    for i in range(8):
        n = i + 1
        if med_a > 0 and abs(areas[i] - med_a) / med_a > 0.28:
            bad.append(f'{prefix}{n}: 面積が他コマと{(areas[i]-med_a)/med_a*100:+.0f}%ずれ(抜けすぎ/背景残りの疑い)')
        if tops[i] - med_t > 18:
            bad.append(f'{prefix}{n}: 上端が{tops[i]-med_t:.0f}px低い(突起・トサカが欠けた疑い)')
        if med_f > 0 and (med_f - foots[i]) / med_f > 0.4:
            bad.append(f'{prefix}{n}: 足元の面積が{(med_f-foots[i])/med_f*100:.0f}%少ない(足が欠けた疑い)')
        if edges[i]:
            bad.append(f'{prefix}{n}: 不透明な画素が画像の縁に触れています(切れ/背景残り)')
    return bad, [i + 1 for i in range(8)
                 if (med_a > 0 and abs(areas[i] - med_a) / med_a > 0.28) or tops[i] - med_t > 18
                 or (med_f > 0 and (med_f - foots[i]) / med_f > 0.4) or edges[i]]

def contact_sheet(key, out_path=None, cell=160):
    """正面8+後ろ8を1枚にまとめる。問題のあるコマは赤枠で囲む。
       これ1枚を見れば済むようにして、16コマを1つずつ開く手間を無くす。"""
    _need_libs()
    from PIL import Image, ImageDraw
    os.makedirs(OUT, exist_ok=True)
    out_path = out_path or os.path.join(OUT, f'{key}_contact.png')
    rows = []
    marks = {}
    for side in ('f', 'b'):
        _bad, idxs = inspect_walk(key, side)
        marks[side] = set(idxs)
        rows.append((side, _frames(f'{key}_walk_{side}')))
    W, H = cell * 8, cell * 2 + 22
    sheet = Image.new('RGB', (W, H), (28, 32, 40))
    d = ImageDraw.Draw(sheet)
    for r, (side, files) in enumerate(rows):
        y = r * cell + 22
        d.text((4, y - 16), f'{key}_walk_{side}1..8', fill=(200, 220, 255))
        for i, f in enumerate(files):
            if not os.path.exists(f):
                continue
            im = Image.open(f).convert('RGBA').resize((cell, cell), Image.LANCZOS)
            # 市松模様の下敷き(透過の残りが分かるように)
            bg = Image.new('RGBA', (cell, cell), (60, 66, 78, 255))
            dd = ImageDraw.Draw(bg)
            for yy in range(0, cell, 16):
                for xx in range(0, cell, 16):
                    if ((xx // 16) + (yy // 16)) % 2 == 0:
                        dd.rectangle([xx, yy, xx + 15, yy + 15], fill=(78, 84, 96, 255))
            bg.alpha_composite(im)
            sheet.paste(bg.convert('RGB'), (i * cell, y))
            col = (255, 90, 80) if (i + 1) in marks[side] else (90, 100, 120)
            d.rectangle([i * cell, y, i * cell + cell - 1, y + cell - 1], outline=col, width=3 if (i + 1) in marks[side] else 1)
            d.text((i * cell + 5, y + 3), str(i + 1), fill=(255, 255, 255))
    sheet.save(out_path)
    return out_path
