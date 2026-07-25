#!/usr/bin/env python3
# ============================================================================
# 歩行スプライト生成ツール(開発用 / ゲーム実行時には読み込まれない)
# 動画 -> 1歩行ループを8コマに分割 -> 320px・256色の透過PNG(正面/後ろ)。
# 依存: imageio-ffmpeg, pillow, numpy, scipy, opencv-python-headless
#   (未導入なら: pip install imageio-ffmpeg pillow numpy scipy opencv-python-headless)
#
# 使い方: 下部の JOBS / MOV / PARAMS(_PHX相当)を対象モンスターに合わせて編集し、
#   python3 tools/build_walk.py [job_key ...]   (引数省略で全JOB実行)
#   例: python3 tools/build_walk.py p1 p2        (特定JOBのみ)
#
# ★セッション依存の絶対パスを必ず更新すること:
#   - W       : 作業用tmpディレクトリ(フレーム展開先)
#   - OUTDIR  : 出力先(通常 <repo>/monsters)
#   - MOV{}   : 各動画の絶対パス(発注者アップロードは /root/.claude/uploads/... に入る)
#
# セグメンテーションのモード(背景/被写体で使い分け。CLAUDE.md「バトル歩行アニメ」節参照):
#   white_alpha    : 白背景(隅から連結する白のみ透過。内側の白い毛は残す)
#   grabcut_alpha  : 淡い草/金背景。knockout= single/gentle/hard/hardgentle
#   phoenixcut_alpha: 鳥(炎/羽が背景色に近い)。彩度/明度/背景色距離で本体抽出+足を明示追加
#   black_alpha(mode='black')    : 純黒背景。隅から連結する黒のみ透過(内側の黒い毛/羽/影は残す)。
#                                   本体に黒い部位がある(ゼウス/タマモノマエ/アーク/イブリース等)場合に使う。
#   black_alpha(mode='blackopen'): 同上だが、輪郭に囲まれた黒(腕と胴の隙間等)も背景として抜く。
#                                   本体に黒い部位が無い場合(ウンディーネ/ドラゴン/プラント/ゴーレム等)に使う。
#                                   本体に黒い部位があるモンスターにこれを使うと、その部位ごと透過してしまうので注意。
#
# ★採用前に全16コマ(正面8+後ろ8)を1コマずつ目視し、トサカ等の突起・足が欠けない/
#   足元の地面が透過している ことを必ず確認する(過去に鳥系で何度も手戻りした)。
# ============================================================================
import os, sys, glob, subprocess, math
import numpy as np
from PIL import Image
import cv2
from scipy import ndimage

FF = subprocess.check_output(['python3','-c','import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).decode().strip()
W = '/home/claude/aramon/scratchpad/sz'
OUTDIR = '/home/claude/aramon/aramon-main/monsters'
TARGET_H = 250
CANVAS = 320
FEET_Y = 0.94  # feet baseline at 94% of canvas height

def extract_all(mov, outd):
    os.makedirs(outd, exist_ok=True)
    for f in glob.glob(f'{outd}/*.png'): os.remove(f)
    subprocess.run([FF,'-i',mov,'-vf','fps=60',f'{outd}/a%03d.png','-y'],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return sorted(glob.glob(f'{outd}/a*.png'))

def detect_period(files):
    # downsample grayscale stack, autocorrelation of frame差分energy over lag
    small = []
    for f in files:
        im = Image.open(f).convert('L').resize((48,48))
        small.append(np.asarray(im, dtype=np.float32))
    arr = np.stack(small)                 # (N,48,48)
    arr -= arr.mean(axis=0, keepdims=True)
    flat = arr.reshape(len(files), -1)
    n = len(files)
    ac = np.zeros(n)
    for lag in range(n):
        a = flat[:n-lag]; b = flat[lag:]
        ac[lag] = (a*b).sum()/max(1,(n-lag))
    ac /= ac[0] + 1e-9
    # find first strong peak after a dip
    lo = max(6, int(n*0.2))
    hi = min(n-1, int(n*0.95))
    if hi <= lo: return n-1
    seg = ac[lo:hi]
    peak = lo + int(np.argmax(seg))
    return peak

def _largest(f):
    lbl, num = ndimage.label(f)
    if num >= 1:
        sizes = ndimage.sum(np.ones_like(lbl), lbl, range(1, num+1))
        keep = int(np.argmax(sizes)) + 1
        f = (lbl == keep).astype(np.uint8)
    return f

def _fill_small_holes(fg):
    h, w = fg.shape
    filled = ndimage.binary_fill_holes(fg)
    holes = filled & (fg==0)
    hl, hn = ndimage.label(holes)
    if hn > 0:
        thresh = 0.008 * h * w
        for i in range(1, hn+1):
            m = (hl == i)
            if m.sum() < thresh: fg[m] = 1
    return fg

def white_alpha(bgr):
    # 白背景用: 隅からつながる白のみ背景にする(内部の白い毛は残す)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.int32)
    minc = rgb.min(axis=2); maxc = rgb.max(axis=2)
    nearwhite = (minc > 236) & ((maxc-minc) < 20)
    lbl, num = ndimage.label(nearwhite.astype(np.uint8))
    border = set(np.unique(np.concatenate([lbl[0,:], lbl[-1,:], lbl[:,0], lbl[:,-1]])))
    border.discard(0)
    bgmask = np.isin(lbl, list(border))
    fg = (~bgmask).astype(np.uint8)
    fg = _largest(fg)
    fg = _fill_small_holes(fg)
    fg = cv2.erode(fg, np.ones((2,2),np.uint8), iterations=1)  # 白フリンジを1px削る
    alpha = (fg*255).astype(np.uint8)
    alpha = cv2.GaussianBlur(alpha, (3,3), 0)
    return alpha

def black_alpha(bgr, T=14, keep_enclosed=True):
    # 純黒背景用(白背景版の反転): 隅からつながる黒のみ背景にする(内部の黒い毛/影は残す)。
    # keep_enclosed=False: 本体に黒い部位が無いモンスター用。輪郭に囲まれた黒(腕と胴の隙間・
    # 花と茎の隙間等から覗く背景)も背景として抜く(そうしないと隙間が黒い塊として残ってしまう)。
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.int32)
    maxc = rgb.max(axis=2)
    nearblack = (maxc < T)
    if keep_enclosed:
        lbl, num = ndimage.label(nearblack.astype(np.uint8))
        border = set(np.unique(np.concatenate([lbl[0,:], lbl[-1,:], lbl[:,0], lbl[:,-1]])))
        border.discard(0)
        bgmask = np.isin(lbl, list(border))
    else:
        bgmask = nearblack
    fg = (~bgmask).astype(np.uint8)
    fg = _largest(fg)
    # keep_enclosed=Falseは隙間を意図的に穴のまま残すため、小穴埋めはしない
    if keep_enclosed: fg = _fill_small_holes(fg)
    alpha = (fg*255).astype(np.uint8)
    alpha = cv2.GaussianBlur(alpha, (3,3), 0)
    return alpha

def birdcut_alpha(bgr, T=58, ck=7):
    # 淡い金背景から色距離で前景を取り出す。トサカ(細い毛)〜かぎ爪まで色が背景と
    # はっきり違う「鳥本体」を残し、足元の淡いオーラ/地面/舞う粒子を透過する。
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
    h, w = rgb.shape[:2]
    b = 18
    ring = np.concatenate([rgb[:b,:,:].reshape(-1,3), rgb[-b:,:,:].reshape(-1,3),
                           rgb[:,:b,:].reshape(-1,3), rgb[:,-b:,:].reshape(-1,3)])[::5].astype(np.float32)
    crit = (cv2.TERM_CRITERIA_EPS+cv2.TERM_CRITERIA_MAX_ITER, 12, 1.0)
    _, _, centers = cv2.kmeans(ring, 6, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    flat = rgb.reshape(-1,3)
    mind = np.full(flat.shape[0], 1e9, np.float32)
    for c in centers:
        mind = np.minimum(mind, np.sqrt(((flat-c)**2).sum(axis=1)))
    fg = (mind > T).reshape(h, w).astype(np.uint8)
    # close で近接する前景の島を橋渡し(炎/羽の明部で断片化するのを防ぐ)→塗りつぶしで中抜け解消
    # (open は細いトサカを消すので使わない)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((ck,ck),np.uint8))
    fg = _largest(fg)                                   # 本体だけ残す(舞う粒子を落とす)
    fg = ndimage.binary_fill_holes(fg).astype(np.uint8) # 体内(炎の明部等)は中抜けさせない
    alpha = (fg*255).astype(np.uint8)
    alpha = cv2.GaussianBlur(alpha, (3,3), 0)
    return alpha

def _fill_small_frac(fg, frac=0.02):
    h,w = fg.shape; filled = ndimage.binary_fill_holes(fg); holes = filled & (fg==0)
    hl,hn = ndimage.label(holes)
    if hn>0:
        th = frac*h*w
        for i in range(1,hn+1):
            m = (hl==i)
            if m.sum() < th: fg[m] = 1
    return fg

def phoenixcut_alpha(bgr, satT=0.46, distT=62, fill='full', warm_trim=False):
    # フェニックス/ヒノトリ用。彩度・明度・背景色距離で「鳥本体+炎/羽」を抽出し、
    # 足元の淡い地面/オーラは色で除去、かぎ爪の足(暗色)は明示追加+縦closeで本体につなぎ、
    # トサカ(上端中央)を明示復元する。全フレームでトサカ・足が欠けないよう設計。
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
    h, w = rgb.shape[:2]
    b = 18
    ring = np.concatenate([rgb[:b,:,:].reshape(-1,3), rgb[-b:,:,:].reshape(-1,3),
                           rgb[:,:b,:].reshape(-1,3), rgb[:,-b:,:].reshape(-1,3)])[::5].astype(np.float32)
    crit = (cv2.TERM_CRITERIA_EPS+cv2.TERM_CRITERIA_MAX_ITER, 12, 1.0)
    _, _, centers = cv2.kmeans(ring, 6, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    flat = rgb.reshape(-1,3); mind = np.full(flat.shape[0], 1e9, np.float32)
    for c in centers: mind = np.minimum(mind, np.sqrt(((flat-c)**2).sum(1)))
    dist = mind.reshape(h, w)
    mx = rgb.max(2); mn = rgb.min(2); val = mx/255.0; sat = (mx-mn)/(mx+1e-6)
    fg = ((sat>satT)|(val<0.45)|(dist>distT)).astype(np.uint8)
    # 足元の淡い地面/オーラ(明るく低彩度で背景色に近い)を色で除去(暗い足・彩度高い炎は残す)
    ground = (dist<40) & (val>0.60) & (sat<0.42)
    greg = np.zeros((h,w), bool); greg[int(h*0.55):,:] = True
    fg[ground & greg] = 0
    # かぎ爪の足(暗色)を明示追加: 下部中央の暗い画素のみ
    feet = np.zeros((h,w), np.uint8)
    fx0,fx1 = int(w*0.28), int(w*0.72); fy0 = int(h*0.70)
    feet[fy0:,fx0:fx1] = (val[fy0:,fx0:fx1] < 0.45).astype(np.uint8)
    fg = ((fg>0)|(feet>0)).astype(np.uint8)
    # 縦closeで足を本体につなぐ(中央下部のみ→側面/上部に棒状ノイズを出さない)
    vc = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((85,3),np.uint8))
    reg = np.zeros((h,w), np.uint8); reg[int(h*0.50):, int(w*0.30):int(w*0.70)] = 1
    fg = ((fg>0)|((vc>0)&(reg>0))).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((7,7),np.uint8))
    fg = _largest(fg)
    fg = ndimage.binary_fill_holes(fg).astype(np.uint8) if fill=='full' else _fill_small_frac(fg)
    fg = _largest(fg)
    # トサカ明示復元: 上端中央の細い帯で背景でない画素を足す
    crest = np.zeros((h,w), np.uint8)
    x0,x1 = int(w*0.43), int(w*0.57); y1 = int(h*0.32)
    crest[:y1,x0:x1] = (dist[:y1,x0:x1] > 24).astype(np.uint8)
    fg = ((fg>0)|(crest>0)).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((5,5),np.uint8))
    fg = _largest(fg)
    fg = ndimage.binary_fill_holes(fg).astype(np.uint8) if fill=='full' else _fill_small_frac(fg)
    # 最終: 下部の「背景色に近く明るい」画素を除去(塗りつぶしで復活した地面/淡いオーラ)
    goldish = (dist<45) & (val>0.55)
    greg2 = np.zeros((h,w), bool); greg2[int(h*0.60):,:] = True
    fg[goldish & greg2 & (val>=0.42)] = 0
    if warm_trim:
        # 青い鳥は黄/緑を持たない。下部の暖色(黄緑=地面/草)を除去(暗い足は残す)
        warm = (rgb[:,:,1] > rgb[:,:,2]+15) & (rgb[:,:,0] > rgb[:,:,2]) & (val>0.55)
        wreg = np.zeros((h,w), bool); wreg[int(h*0.55):,:] = True
        fg[warm & wreg] = 0
    alpha = (fg*255).astype(np.uint8)
    alpha = cv2.GaussianBlur(alpha, (3,3), 0)
    return alpha

def grabcut_alpha(bgr, knockout='single'):
    h, w = bgr.shape[:2]
    bgd = np.zeros((1,65), np.float64); fgd = np.zeros((1,65), np.float64)
    if knockout in ('hard','hardgentle'):
        # 不均一な背景(金色ボケ等): 縁リングを「確定背景」として色モデルを学習させ、
        # 内側のボケも背景に分類させる(白い毛を誤除去しない)
        mask = np.full((h,w), cv2.GC_PR_BGD, np.uint8)
        bm = int(min(h,w)*0.06)
        mask[:bm,:]=cv2.GC_BGD; mask[-bm:,:]=cv2.GC_BGD; mask[:,:bm]=cv2.GC_BGD; mask[:,-bm:]=cv2.GC_BGD
        # 上端中央はトサカ(細い毛)が伸びるので確定背景にしない
        mask[:bm, int(w*0.42):int(w*0.58)] = cv2.GC_PR_BGD
        mask[int(h*0.10):int(h*0.98), int(w*0.26):int(w*0.74)] = cv2.GC_PR_FGD
        # トサカを残すため中央の細い縦帯を前景寄りにする
        mask[int(h*0.02):int(h*0.13), int(w*0.46):int(w*0.54)] = cv2.GC_PR_FGD
        try:
            cv2.grabCut(bgr, mask, None, bgd, fgd, 8, cv2.GC_INIT_WITH_MASK)
        except Exception:
            pass
    else:
        mask = np.zeros((h,w), np.uint8)
        m = int(min(h,w)*0.06)
        rect = (m, m, w-2*m, h-2*m)
        try:
            cv2.grabCut(bgr, mask, rect, bgd, fgd, 6, cv2.GC_INIT_WITH_RECT)
        except Exception:
            pass
    fg = np.where((mask==cv2.GC_FGD)|(mask==cv2.GC_PR_FGD), 1, 0).astype(np.uint8)
    fg = _largest(fg)
    if knockout == 'hardgentle':
        # 足元の淡いオーラ/地面を透過する: 縁リングの明るい代表色に近い画素を除去。
        # (フェニックスは暗色を持たないので明部クラスタ限定の除去でも本体は守られる)
        rgbk = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
        b2 = 18
        ring = np.concatenate([rgbk[:b2,:,:].reshape(-1,3), rgbk[-b2:,:,:].reshape(-1,3),
                               rgbk[:,:b2,:].reshape(-1,3), rgbk[:,-b2:,:].reshape(-1,3)])[::5].astype(np.float32)
        crit = (cv2.TERM_CRITERIA_EPS+cv2.TERM_CRITERIA_MAX_ITER, 12, 1.0)
        _, _, centers = cv2.kmeans(ring, 6, None, crit, 3, cv2.KMEANS_PP_CENTERS)
        flatk = rgbk.reshape(-1,3)
        mindk = np.full(flatk.shape[0], 1e9, np.float32)
        for c in centers:
            if c.mean() < 150: continue
            mindk = np.minimum(mindk, np.sqrt(((flatk-c)**2).sum(axis=1)))
        fg[(mindk < 52).reshape(fg.shape)] = 0
        fg = _largest(fg)
        # 体内(炎の明部等)は中抜けさせない。足元オーラは下方向に開いた領域なので埋まらない。
        fg = ndimage.binary_fill_holes(fg).astype(np.uint8)
    else:
        # fill only SMALL enclosed holes; leave the big concave gap (脚の間の背景) transparent
        fg = _fill_small_holes(fg)
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
        # 単一背景色(隅の中央値)から一定距離内を除去(脚間の草等の薄い残り)
        cs = np.concatenate([rgb[:14,:14].reshape(-1,3), rgb[:14,-14:].reshape(-1,3),
                             rgb[-14:,:14].reshape(-1,3), rgb[-14:,-14:].reshape(-1,3)])
        bgc = np.median(cs, axis=0)
        dist = np.sqrt(((rgb-bgc)**2).sum(axis=2))
        fg[dist < 44] = 0
    if knockout not in ('gentle','hardgentle'):
        # open で細い橋を切り微細ノイズを除去 → largest で透かし等の離れた残りを落とす
        # (gentle系は細い足=スエゾーの一本足/鳥の脚 を消さないよう open/2度目largestを行わない)
        fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3,3),np.uint8))
        fg = _largest(fg)
    alpha = (fg*255).astype(np.uint8)
    alpha = cv2.GaussianBlur(alpha, (3,3), 0)
    return alpha

def process(mov, prefix, front, mode='grass', knockout='single'):
    tag = prefix
    outd = f'{W}/_raw_{tag}'
    files = extract_all(mov, outd)
    if len(files) < 8:
        print('  too few frames', len(files)); return
    period = detect_period(files)
    # choose 8 frames evenly across one period starting a bit in
    start = max(0, int(len(files)*0.02))
    idxs = [min(len(files)-1, start + round(period*k/8.0)) for k in range(8)]
    sel = [files[i] for i in idxs]
    _BIRD = {'birdcut':(58,7), 'birdcutb':(42,11)}
    _PHX = {  # satT, distT, fill, warm_trim
      'phoenix_o':(0.46,64,'full',False),   # ヒノトリ 正面/後ろ
      'phoenix_bf':(0.42,46,'small',True),  # フェニックス 正面(脚の間を透過)
      'phoenix_bb':(0.42,46,'full',True),   # フェニックス 後ろ(尾は塗りつぶし)
    }
    if mode=='white': segfn = lambda bgr: white_alpha(bgr)
    elif mode=='black': segfn = lambda bgr: black_alpha(bgr)
    elif mode=='blackopen': segfn = lambda bgr: black_alpha(bgr, keep_enclosed=False)
    elif knockout in _PHX:
        sT,dT,fl,wt = _PHX[knockout]; segfn = lambda bgr: phoenixcut_alpha(bgr, sT, dT, fl, wt)
    elif knockout=='phoenixcut': segfn = lambda bgr: phoenixcut_alpha(bgr)
    elif knockout in _BIRD:
        T,ck = _BIRD[knockout]; segfn = lambda bgr: birdcut_alpha(bgr, T, ck)
    else: segfn = lambda bgr: grabcut_alpha(bgr, knockout)
    # segment
    rgbs = []; alphas = []; bboxes = []
    for f in sel:
        im = Image.open(f).convert('RGB')
        bgr = cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2BGR)
        a = segfn(bgr)
        ys, xs = np.where(a > 40)
        if len(xs)==0:
            bboxes.append(None); rgbs.append(np.asarray(im)); alphas.append(a); continue
        bboxes.append((xs.min(), xs.max(), ys.min(), ys.max()))
        rgbs.append(np.asarray(im)); alphas.append(a)
    heights = [ (b[3]-b[2]) for b in bboxes if b ]
    medh = float(np.median(heights))
    scale = TARGET_H / medh
    os.makedirs(f'{W}/_out_{tag}', exist_ok=True)
    for k in range(8):
        b = bboxes[k]
        rgb = rgbs[k]; a = alphas[k]
        rgba = np.dstack([rgb, a])
        pim = Image.fromarray(rgba, 'RGBA')
        if b is None:
            canvas = Image.new('RGBA',(CANVAS,CANVAS),(0,0,0,0))
        else:
            x0,x1,y0,y1 = b
            crop = pim.crop((x0, y0, x1+1, y1+1))
            nw = max(1,int(round(crop.width*scale))); nh = max(1,int(round(crop.height*scale)))
            crop = crop.resize((nw,nh), Image.LANCZOS)
            canvas = Image.new('RGBA',(CANVAS,CANVAS),(0,0,0,0))
            cx = (CANVAS - nw)//2
            feet = int(CANVAS*FEET_Y)
            cy = feet - nh
            canvas.alpha_composite(crop, (cx, max(0,cy)))
        # quantize to 256 colors preserving alpha
        q = canvas.convert('RGBA').quantize(colors=256, method=Image.FASTOCTREE)
        out = f'{OUTDIR}/{prefix}{k+1}.png'
        q.save(out)
    print(f'  {prefix}: period={period} idxs={idxs} medh={medh:.0f} scale={scale:.2f} -> 8 frames')

JOBS = [
    ('v1','suezo_walk_f', True,  'grass', 'gentle'),
    ('v2','suezo_walk_b', False, 'grass', 'gentle'),
    ('v3','zan_walk_f',   True,  'grass', 'single'),
    ('v4','zan_walk_b',   False, 'grass', 'single'),
    ('w1','fox_walk_f',   True,  'white', 'single'),
    ('w2','fox_walk_b',   False, 'white', 'single'),
    ('w3','spark_walk_f', True,  'grass', 'hard'),
    ('w4','spark_walk_b', False, 'grass', 'hard'),
    # 2026-07-25: 発注者が黒背景の新素材動画を再提供したため、白フェニックス系のみ
    # 複雑な色距離ヒューリスティック(phoenix_o/phoenix_bf/phoenix_bb)から素材動画に
    # あわせて blackopen(純黒背景+隙間も抜く)に更新。JOBキー(p1-p4)は維持。
    ('p1','phoenix_walk_f',     True,  'blackopen', 'single'),
    ('p2','phoenix_walk_b',     False, 'blackopen', 'single'),
    ('p3','phoenix_ssr_walk_f', True,  'blackopen', 'single'),
    ('p4','phoenix_ssr_walk_b', False, 'blackopen', 'single'),
    ('z1','zeus_ssr_walk_f',    True,  'black', 'single'),
    ('z2','zeus_ssr_walk_b',    False, 'black', 'single'),
    ('t1','tamamo_ssr_walk_f',  True,  'black', 'single'),
    ('t2','tamamo_ssr_walk_b',  False, 'black', 'single'),
    ('a1','ark_walk_f',         True,  'black', 'single'),
    ('a2','ark_walk_b',         False, 'black', 'single'),
    ('i1','iblees_ssr_walk_f',  True,  'black', 'single'),
    ('i2','iblees_ssr_walk_b',  False, 'black', 'single'),
    ('u1','aqua_walk_f',        True,  'blackopen', 'single'),
    ('u2','aqua_walk_b',        False, 'blackopen', 'single'),
    ('d1','fire_walk_f',        True,  'blackopen', 'single'),
    ('d2','fire_walk_b',        False, 'blackopen', 'single'),
    ('l1','leaf_walk_f',        True,  'blackopen', 'single'),
    ('l2','leaf_walk_b',        False, 'blackopen', 'single'),
    ('r1','rock_walk_f',        True,  'blackopen', 'single'),
    ('r2','rock_walk_b',        False, 'blackopen', 'single'),
    # 2026-07-25: イルミネ/ワーム追加。イルミネは白背景(white)、ワームは黒背景+
    # 本体に黒い部位が無い(blackopen)。
    ('m1','illumine_walk_f',    True,  'white',     'single'),
    ('m2','illumine_walk_b',    False, 'white',     'single'),
    ('n1','warm_walk_f',        True,  'blackopen', 'single'),
    ('n2','warm_walk_b',        False, 'blackopen', 'single'),
]
U='/root/.claude/uploads/2dcee4de-18cc-599b-9320-655c57e78387'
U2='/root/.claude/uploads/18073022-2206-5ef7-b9d6-78426f00390e'
U3='/home/claude/aramon/scratchpad/src_videos'
MOV = {
 'v1':f'{U}/8de170af-ScreenRecording_07242026_183303_1.mov',
 'v2':f'{U}/211b4e0f-ScreenRecording_07242026_183329_1.mov',
 'v3':f'{U}/57e9955b-ScreenRecording_07242026_183053_1.mov',
 'v4':f'{U}/66c3602d-ScreenRecording_07242026_183114_1.mov',
 'w1':f'{U}/265c397f-copy_95FC2A5047014489B442E93F7DE255BB.mov',
 'w2':f'{U}/8d04354c-copy_871584B2039645C59E1932303E9A970C.mov',
 'w3':f'{U}/cad5ac54-copy_1ECF1D47FC4D49699AD28323943D12E3.mov',
 'w4':f'{U}/ea840f47-copy_29DFF430DBAB4A9C915955298324E253.mov',
 'p1':f'{U2}/15af49b8-_________072516_Full_HD_1080p.mp4',
 'p2':f'{U2}/7c20f29c-_________072517_Full_HD_1080p.mp4',
 'p3':f'{U2}/f2f433c1-_________0725_Full_HD_1080p.mp4',
 'p4':f'{U2}/6e83361a-_________07251_Full_HD_1080p.mp4',
 'z1':f'{U2}/e4a52144-_________07256_Full_HD_1080p.mp4',
 'z2':f'{U2}/5c8b44e1-_________07257_Full_HD_1080p.mp4',
 't1':f'{U2}/634ef545-_________072518_Full_HD_1080p.mp4',
 't2':f'{U2}/cbb79517-_________072519_Full_HD_1080p.mp4',
 'a1':f'{U2}/c2e24ef4-_________07258_Full_HD_1080p.mp4',
 'a2':f'{U2}/9c797abb-_________07259_Full_HD_1080p.mp4',
 'i1':f'{U2}/8400516c-_________072520_Full_HD_1080p.mp4',
 'i2':f'{U2}/4e92e389-_________072521_Full_HD_1080p.mp4',
 'u1':f'{U2}/63faab44-_________07252_Full_HD_1080p.mp4',
 'u2':f'{U2}/c13595ec-_________07253_Full_HD_1080p.mp4',
 'd1':f'{U2}/5440c89f-_________07254_Full_HD_1080p.mp4',
 'd2':f'{U2}/9ababe1c-_________07255_Full_HD_1080p.mp4',
 'l1':f'{U2}/39c55a7c-_________072510_Full_HD_1080p.mp4',
 'l2':f'{U2}/22ca86ab-_________072511_Full_HD_1080p.mp4',
 'r1':f'{U2}/a99064e1-_________072512_Full_HD_1080p.mp4',
 'r2':f'{U2}/4d81ddde-_________072513_Full_HD_1080p.mp4',
 'm1':f'{U3}/illumine_front.mp4',
 'm2':f'{U3}/illumine_back.mp4',
 'n1':f'{U3}/warm_front.mp4',
 'n2':f'{U3}/warm_back.mp4',
}
import sys
only = set(sys.argv[1:])
for vk, prefix, front, mode, knockout in JOBS:
    if only and vk not in only and prefix not in only: continue
    print('==', prefix, f'({mode}/{knockout})')
    process(MOV[vk], prefix, front, mode, knockout)
print('DONE')
