/* =====================================================================
   リアルマップ: 地面(プレイヤー中心のパッチ + PBRテクスチャ)

   ・地面はPBR(MeshStandardMaterial)。色 + 法線・粗さ・AO の4枚組を手続き的に作る
   ・パッチはプレイヤー中心。動かしても頂点が同じワールド座標に乗るようスナップする
   ・高さと傾きは data.js の real3dHeightGrad()(解析微分)。法線もそこから直接作る

   【地面の質感は3つの層を重ねて作る】1つでも欠けると、近くはのっぺり・遠くは一色になる。
     ① 近景タイル(DETAIL_TILE=近く数メートル)
        色・法線・粗さ・AOの4枚。砂利/風紋/落ち葉などの「粒」を担当する。
        4枚とも**同じ高さ場**から作るので、粒の色と凹凸と影が必ず一致する。
        大きな模様はわざと入れない(入れるとタイルの升目が見えるため)。

   【最重要・地面の模様を「物」に見せない】(2026-08-13 / 08-14の不具合対応)
     このゲームの岩(3Dモデル)は**すべて当たり判定のある遮蔽物**で、プレイヤーは
     「隠れられる岩」と「素通りできる地面の模様」を一目で見分けられなければならない。
     人間の目は次の3つのどれかが揃うと、平らな模様でも「そこに物がある」と読む。
     地面テクスチャは**3つとも作らない**。

       ①岩と同じくらいの大きさ  岩は直径44〜144単位(world.js genRocks の半径22〜72)。
         地面の模様は LUMA_GRAIN(=明るさが変わってよい最大の大きさ)より大きくしない。
       ②片側が明るく反対側が暗い  = 球の陰影。**大きい模様を明るさ(out[0])で描かない。**
         大きい模様は色み(out[1])で描く。tintA/tintB は輝度が動かないよう自動で中和する
         (neutralTint)ので、色みはいくら強くしても陰影には見えない。
         明るさで描いてよいのは LUMA_GRAIN より細かい模様だけ(highPassLum が保証する)。
       ③縁の立った閉じた形  丸い染みは上から見た小石に見える。中心からなだらかに
         薄れる染み・一方向へ伸びた筋にする。**sstep で縁を作らない。**

     out[2](凹凸)に入れてよいのは「へこみ」だけ。出っ張る粒は色だけで描く。
     ・ひび割れ・気泡の穴・風紋の谷・落ち葉の隙間 = へこみ → 凹凸に入れてよい
     ・小石・砂利・葉の粒 = 出っ張り → **凹凸に入れない**
     仕上げに機械的な保険を2つ掛けてあるので、新しいスタイルを足しても事故りにくい:
     RELIEF_PEAK(平均より上の凹凸を潰す)と highPassLum(大きな明暗を削る)。
     ② 遠景マクロ(MACRO_TILE=数十メートル)
        地面全体の大きな濃淡・涸れ沢の筋。①の繰り返しを打ち消し、遠くの地面が
        一色に潰れるのを防ぐ。シェーダーで①に掛ける(下の MACRO_CHUNK)。
     ③ 頂点カラー(頂点間隔50単位)
        高さ・傾き・場所ごとの土質。①②の中間〜大きい模様を担当する。
   ===================================================================== */
import * as THREE from './vendor/three.module.min.js';
import { R3, DEFAULT_THEME, ENV_INTENSITY, heightAt, makeTexture,
         EXPLORE_KEYS, isExplore, exploreWeights, exploreTrail } from './real3d_common.js';

// ---- 見た目の調整用定数(プレイテストで触るのはここだけ) ----
export const PATCH_SIZE = 7200;  // プレイヤー中心に張る地形パッチの一辺(ワールド単位)
const PATCH_SEGS  = 144;         // パッチの分割数。細かくすると綺麗だが重くなる
const CELL = PATCH_SIZE / PATCH_SEGS;   // 頂点間隔。この単位でパッチ位置をスナップする
const DETAIL_TILE = 150;         // ①近景タイルが覆うワールド単位(小さいほど足元が細かい)
const MACRO_TILE  = 2400;        // ②遠景マクロが覆うワールド単位
const DETAIL_S    = 512;         // ①の画素数。色・法線・粗さ・AOで共通
const MACRO_S     = 256;         // ②の画素数。中身が低周波なので小さくてよい
const NORMAL_GAIN = 3.0;         // 法線の強さ = theme.bump * これ
const MACRO_AMT   = 0.85;        // ②の効き具合(0で無効)
const MACRO_AMT2  = 0.55;        // ②をさらに3倍へ伸ばした層(地域差)の効き具合
const MID_AMT     = 0.32;        // ①を4.7倍に伸ばして重ねる量(タイルの繰り返し消し・色みだけ)
// 高さ場のうち「平均より上(=出っ張り)」を残す割合。1.0で従来どおり、0で完全に平ら。
// 地面の模様が本物の岩に見えないよう、出っ張りだけを潰す(へこみは等倍で残す)。
const RELIEF_PEAK = 0.42;
// 明るさが変わってよい最大の大きさ(ワールド単位)。岩は直径44〜144単位なので、
// その半分より小さくする。これより大きい明暗は highPassLum が LUMA_LOW_KEEP まで削る。
// 大きな明暗を残すと、平らな模様でも「岩の陰影」に見えて隠れられる物と紛れる。
const LUMA_GRAIN    = 11;
const LUMA_LOW_KEEP = 0.16;
const TINT_KNEE     = 0.18;      // 色みの頭打ち。0で頭打ちなし

let terrain = null, terrainPos = null, terrainCol = null, terrainNrm = null;
let groundMaps = null;           // { map, normalMap, roughnessMap, aoMap, macroMap }
let patchCX = null, patchCY = null;   // 現在のパッチ中心(スナップ済み)

export function getTerrain(){ return terrain; }
export function getGroundMaps(){ return groundMaps; }
// 次の render で必ず塗り直させる(マップ切り替え時)
export function resetPatch(){ patchCX = patchCY = null; }

/* =====================================================================
   手続き的ノイズ(このファイル専用)

   共通の hash2 は Math.sin を使うため、1画素あたり数十回呼ぶと生成が待たされる。
   ここでは整数ビット演算のハッシュを使う(三角関数なしで数倍速い)。
   real3d_common.js には足さない(他の担当者と衝突するため、ローカルに置く)。
   ===================================================================== */
function ih(x, y){
  let n = (Math.imul(x|0, 374761393) + Math.imul(y|0, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) | 0;
  n = n ^ (n >>> 16);
  return (n >>> 0) * 2.3283064365386963e-10;   // 0〜1
}
const clamp01 = (t)=> t < 0 ? 0 : (t > 1 ? 1 : t);
// sRGBの明るさをリニアへ。テクスチャの平均輝度を測るときに使う
const srgbLin = (c)=> c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
function sstep(a, b, x){ const t = clamp01((x-a)/(b-a)); return t*t*(3-2*t); }

/* タイルの継ぎ目が出ない値ノイズ。x方向とy方向で周期を変えられる
   (風で伸びた雪の吹きだまりなど、方向のある模様に使う)。          */
function vnoise(x, y, pX, pY, salt){
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x-xi, yf = y-yi;
  const u = xf*xf*(3-2*xf), v = yf*yf*(3-2*yf);
  let x0 = xi % pX; if(x0 < 0) x0 += pX;
  let y0 = yi % pY; if(y0 < 0) y0 += pY;
  const x1 = x0+1 === pX ? 0 : x0+1;
  const y1 = y0+1 === pY ? 0 : y0+1;
  const s = salt*7919;
  const a = ih(x0+s, y0), b = ih(x1+s, y0), c = ih(x0+s, y1), d = ih(x1+s, y1);
  const ab = a + (b-a)*u, cd = c + (d-c)*u;
  return ab + (cd-ab)*v;
}
/* u,v(0〜1)を pX×pY 分割の fBm で読む。返り値は 0〜1 に正規化済み。
   ドメインワープ(uを別のノイズでずらす)をしても、ずらす側が同じ周期なら
   タイル性は保たれる。マクロ模様はこれを使って有機的な形にしている。   */
function fbmT(u, v, pX, pY, oct, salt){
  let s = 0, amp = 0.5, tot = 0, f = 1;
  for(let o=0;o<oct;o++){
    s += vnoise(u*pX*f, v*pY*f, pX*f, pY*f, salt+o*13) * amp;
    tot += amp; amp *= 0.5; f *= 2;
  }
  return s/tot;
}

/* セルノイズ(ボロノイ)。ひび割れ・砂利・落ち葉のように「粒が並ぶ」模様を作る。
   点の位置は先に表へ作っておく(画素ごとにハッシュを回すと生成が待たされる)。
   ・pX と pY を別々に持てる = 縦横に伸びたセル(落ち葉など)が作れる
   ・呼ぶ側は座標を fbm でゆがめてから渡すこと。等間隔のまま渡すと、
     どのスタイルも「規則正しい蜂の巣」に見えてしまう(実際にそうなった)
   out[0]=最寄りまでの距離 out[1]=2番目 out[2]=最寄りセルの番号                */
const wtCache = {};
function wtable(pX, pY, salt){
  const key = pX + 'x' + pY + '|' + salt;
  let t = wtCache[key];
  if(!t){
    t = new Float32Array(pX*pY*2);
    for(let y=0;y<pY;y++) for(let x=0;x<pX;x++){
      const i = (y*pX+x)*2;
      t[i]   = x + 0.06 + ih(x+salt*131, y+salt*17)*0.88;
      t[i+1] = y + 0.06 + ih(x+salt*131+911, y+salt*17+733)*0.88;
    }
    wtCache[key] = t;
  }
  return t;
}
function worley(px, py, pX, pY, tbl, out){
  const xi = Math.floor(px), yi = Math.floor(py);
  let f1 = 1e9, f2 = 1e9, id = 0;
  for(let oy=-1;oy<=1;oy++){
    const cy = yi+oy;
    let wy = cy; if(wy < 0) wy += pY; else if(wy >= pY) wy -= pY;
    const back = cy - wy;
    for(let ox=-1;ox<=1;ox++){
      const cx = xi+ox;
      let wx = cx; if(wx < 0) wx += pX; else if(wx >= pX) wx -= pX;
      const k = (wy*pX+wx)*2;
      const dx = tbl[k] + (cx - wx) - px, dy = tbl[k+1] + back - py;
      const d = dx*dx + dy*dy;
      if(d < f1){ f2 = f1; f1 = d; id = wy*pX+wx; }
      else if(d < f2){ f2 = d; }
    }
  }
  out[0] = Math.sqrt(f1); out[1] = Math.sqrt(f2); out[2] = id;
}

/* =====================================================================
   地面テクスチャの作り分け(5種)

   ここへ1行足せば、そのマップの地面は自動でその見た目になる。
   ・field(u,v,px,py,out) 1画素ぶんの値を返す純関数
       out[0] 明るさ(0.8前後が「テーマ色そのまま」)。**小さい模様にだけ使う。**
              大きな明暗は highPassLum が削るので、書いても消えるだけ
       out[1] 色み(+でtintA方向 / -でtintB方向。土の赤茶⇔苔の緑など)。
              輝度は動かないので大きな模様に使ってよい(色みは陰影に見えない)
       out[2] 細かい高さ(0〜1目安)。法線・粗さ・AOはここから作る。へこみだけ
   ・relief 法線に焼く凹凸の強さ / rough 粗さの下限・上限
   ・tintA/tintB 色みのRGB方向 / macro 遠景マクロの強さ
   ・vert 頂点カラーの効き(砂利・低木・流れた跡・ざらつき)
   make() は表を1回だけ作ってから field を返す(画素ごとの表引きを避ける)。

   【模様の大きさの目安】タイル1枚 = DETAIL_TILE(150)ワールド単位。
   セル数 n の模様は 150/n 単位になる。岩は直径44〜144単位なので、
   **セル数は必ず20以上**(= 7.5単位以下)にすること。20を下回ると岩に見え始める。
   ===================================================================== */
const TAU = Math.PI*2;
/* 中心からなだらかに薄れる染み。**縁を立てない**ための共通の形。
   1 - sstep(r-w, r, d) のような「平らな円板+細い縁」は、どれだけ平らに塗っても
   上から見た小石に見える(2026-08-14の不具合)。ここでは中心が1・半径で0で、
   両端とも傾きが0になる落ち方にする(=どこにも縁が立たない染み)。            */
function smudge(d, r){ const t = 1 - clamp01(d/r); return t*t*(3-2*t); }
const TEX_STYLES = {
  // 乾いた荒れ地: 細かい砂利の色ムラに、細いひび割れが走る
  // セル数を20台→30〜50台へ上げてある(模様1つが5単位以下 = 岩の1/9)
  dry: {
    relief:1.30, rough:[0.62,0.98],
    tintA:[ 0.16, 0.05,-0.14], tintB:[-0.10,-0.02, 0.10],
    macro:{ amp:0.76, ridge:0.44, tint:0.20 },
    vert:{ gravel:0.62, scrub:0.52, flow:0.36, jitter:0.06 },
    make(){
      const tc = wtable(30,30, 3), tp = wtable(52,38, 11);
      const c = [0,0,0], p = [0,0,0];
      return (u,v,px,py,out)=>{
        const wu = fbmT(u,v,12,12,2,71) - 0.5, wv = fbmT(u,v,12,12,2,73) - 0.5;
        const soil = fbmT(u, v, 26, 20, 3, 5);            // 5.8 × 7.5単位の土質ムラ
        worley(u*30 + wu*2.0, v*30 + wv*2.0, 30, 30, tc, c);
        worley(u*52 + wu*3.4, v*38 + wv*2.5, 52, 38, tp, p);
        // ひび割れは細く、セルごとに濃さを変える。薄い割れ目は消えて多角形が繋がるので、
        // 大きさの揃った「蛇の皮」に見えなくなる
        const cid = ih(c[2]+13, 19);
        const crack = (1 - sstep(0.0, 0.030 + cid*0.036, c[1]-c[0])) * (0.10 + soil*1.1) * cid;
        const pid = ih(p[2]+31, 9);
        // 砂利は「色みだけの染み」。輪郭を作らず中心から薄れる(smudge)ので、
        // 平らに塗っても縁が立たない = 上から見た小石にならない
        const grit = smudge(p[0], 0.30 + pid*0.26) * (pid > 0.38 ? 1 : 0);
        const g = ih(px*3+1, py*7+2);
        // 数画素まとめた平らな斑点。細かい情報量を足すが、明るさではなく色みで出す
        const fl = ih((px>>1)*2+53, (py>>1)*2+29) - 0.5;
        // 風に舐められた砂の筋(横へ長く伸ばす)。塊にならないよう縦横比を6倍取る
        const streak = fbmT(u, v, 14, 74, 1, 97) - 0.5;
        // 明るさは細かい模様にだけ使う(いちばん粗い soil でも5.8単位 = 岩の1/8)
        out[0] = 0.80 + (soil-0.5)*0.20 - crack*0.16 + (g-0.5)*0.13 + grit*(pid-0.5)*0.10;
        out[1] = (soil-0.5)*0.8 + grit*(pid-0.5)*1.9 + (cid-0.5)*0.55 + streak*0.55 + fl*0.30;
        // 凹凸はひび割れ(へこみ)と土のうねりだけ。砂利は一切入れない
        out[2] = soil*0.30 - crack*0.70 + g*0.16;
      };
    },
  },
  // 冷えた溶岩の殻: 黒い岩板がひび割れ、表面に気泡の穴があく
  volcanic: {
    relief:1.25, rough:[0.58,1.00],
    tintA:[ 0.26, 0.06,-0.24], tintB:[-0.14,-0.06, 0.14],
    macro:{ amp:0.82, ridge:0.50, tint:0.24 },
    vert:{ gravel:0.66, scrub:0.34, flow:0.44, jitter:0.07 },
    make(){
      // 板は13セル(11.5単位=小岩と同じ)だと1枚が転がった岩に見えた。26セル(5.8単位)へ
      const tc = wtable(26,26, 21), tv = wtable(64,64, 31);
      const c = [0,0,0], p = [0,0,0];
      return (u,v,px,py,out)=>{
        const wu = fbmT(u,v,12,12,2,71) - 0.5, wv = fbmT(u,v,12,12,2,73) - 0.5;
        const ash = fbmT(u, v, 24, 24, 3, 17);
        worley(u*26 + wu*2.4, v*26 + wv*2.4, 26, 26, tc, c);
        worley(u*64 + wu*4.0, v*64 + wv*4.0, 64, 64, tv, p);
        const crack = 1 - sstep(0.0, 0.11, c[1]-c[0]);   // 岩板の割れ目(太い)
        const cid = ih(c[2]+5, 23);                      // 板ごとに焼け方を変える
        // 気泡の穴は「へこみ」なので凹凸に入れてよい。縁を立てない形にする
        const pit = smudge(p[0], 0.34) * (ih(p[2]+3, 29) > 0.30 ? 1 : 0);
        const g = ih(px*5+7, py*3+11);
        // 溶けて流れた筋。板の並びを一方向へ引きずり、塊の集まりに見せない
        const flow = fbmT(u, v, 16, 80, 1, 137) - 0.5;
        // 板は5.8単位まで小さくしてあるので、板ごとの焼け方(cid)は明るさに出してよい
        out[0] = 0.76 + (ash-0.5)*0.22 + (cid-0.5)*0.16 - crack*0.24 - pit*0.14 + (g-0.5)*0.16;
        out[1] = (ash-0.5)*1.0 + (cid-0.5)*0.7 + flow*0.5 - crack*0.4;
        // 割れ目は彫るが、板が1枚ずつ浮いて見えない深さに留める
        out[2] = ash*0.30 - crack*0.55 - pit*0.40 + g*0.16;
      };
    },
  },
  // 砂: 風紋が主役。ひび割れは作らない
  // 風紋の波数は整数にすること。半端な値にするとタイルの継ぎ目で位相が飛び、
  // 地面に斜めの直線が何本も走る(実際に出た)。
  sand: {
    relief:0.85, rough:[0.78,1.00],
    tintA:[ 0.16, 0.05,-0.18], tintB:[-0.10,-0.02, 0.12],
    macro:{ amp:0.62, ridge:0.34, tint:0.17 },
    vert:{ gravel:0.40, scrub:0.32, flow:0.24, jitter:0.05 },
    make(){
      const tp = wtable(52,40, 41);
      const p = [0,0,0];
      return (u,v,px,py,out)=>{
        const wu = fbmT(u,v,12,12,2,71) - 0.5, wv = fbmT(u,v,12,12,2,73) - 0.5;
        // 風紋のまとまり。波数5(=28単位)は小岩と同じ大きさだったので11(=13単位)へ
        const big = Math.sin((u*11 + v*4)*TAU + fbmT(u,v,6,6,2,23)*4.0)*0.5+0.5;
        // 大きなうねりの風上側だけ風紋が濃く出る(全面を同じ縞で埋めない)
        const ripA = 0.35 + big*1.05;
        const rip = Math.pow(Math.sin((u*38 + v*15)*TAU + fbmT(u,v,7,7,3,9)*9.0)*0.5+0.5, 1.7) * ripA;
        worley(u*52 + wu*3.2, v*40 + wv*2.6, 52, 40, tp, p);
        const pid = ih(p[2]+5, 13);
        // 砂に混じる貝殻・小石も輪郭のない染みにする(砂は本物の岩が最も見分けにくい地面)
        const grit = smudge(p[0], 0.20 + pid*0.16) * (pid > 0.72 ? 1 : 0);
        const g = ih(px*5+3, py*3+9);
        // 風紋は3.9単位・うねりは13単位。どちらも岩よりずっと小さいので明るさに出してよい
        out[0] = 0.86 + (rip-0.45)*0.13 + (big-0.5)*0.055 + (g-0.5)*0.08 + grit*0.06;
        out[1] = (big-0.5)*0.55 + (rip-0.5)*0.30 + grit*(0.6 + pid*0.5);
        // 風紋と大きなうねりだけ。粒は凹凸に入れない
        out[2] = rip*0.80 + big*0.28 + g*0.13;
      };
    },
  },
  /* 雪原: 風に流された細い筋だけで作る。ひび割れも塊も絶対に作らない。
     【この地面が一番の要注意】雪は元の色が真っ白なので、少しでも暗い染みを置くと
     そこだけが「雪をかぶった岩」に見える(実機で2回報告あり)。決まりは3つ:
       ・模様は必ず一方向へ6倍以上伸ばす(塊を作らない)
       ・明るさはほぼ動かさない。窪みは「暗く」ではなく「青く」する
       ・段差(sstep)を作らない。縁が立つと氷の塊に見える                    */
  snow: {
    relief:0.55, rough:[0.30,0.72],
    // 暖色側(tintA)は雪が黄ばんで見えるので、ほぼ無色に近づけてある
    tintA:[ 0.05, 0.03,-0.01], tintB:[-0.15,-0.05, 0.16],
    macro:{ amp:0.62, ridge:0.36, tint:0.26 },
    vert:{ gravel:0.62, scrub:0.46, flow:0.34, jitter:0.04 },
    make(){
      return (u,v,px,py,out)=>{
        // 風の筋。u方向2.5単位 × v方向15単位 = 縦横比6:1(前は7.5×30単位の「塊」だった)
        const s1 = fbmT(u, v, 60, 10, 2, 3);
        const s2 = fbmT(u, v, 128, 26, 2, 19);   // さらに細い吹き跡(1.2×5.8単位)
        const groove = 1 - Math.abs(s1*2 - 1);   // 筋の谷。へこみなので凹凸に入れてよい
        const g = ih(px*7+5, py*11+3);
        const spark = g > 0.9885 ? 1 : 0;        // 雪面のきらめき(1画素)
        // 明るさに出してよいのは細い筋だけ。**雪は少しでも暗い染みが「岩」に見える**ので、
        // 振幅は他のスタイルの半分に留め、残りは色み(青)で見せる
        out[0] = 0.84 + (s1-0.5)*0.075 + (s2-0.5)*0.045 + spark*0.12 + (g-0.5)*0.05 - groove*0.03;
        out[1] = -(s1-0.5)*1.25 - (s2-0.5)*0.5;   // 窪みは空を映して青く、稜は白く
        // out[2](法線・粗さ・AOの元)は前は0.55/0.25で、風筋のV字(groove)がそのまま
        // 深い凹凸になり、坂に貼ると縦に伸びたハイライトの筋に見えた(2026-09-24)。
        // 色み(out[1])はそのまま残し、凹凸だけ弱める(見た目の風筋は色で分かる)
        out[2] = -groove*0.16 - (s2-0.5)*0.08;
      };
    },
  },
  // 密林の地面: 細長い落ち葉 + 苔の塊 + 黒い腐葉土
  jungle: {
    relief:1.05, rough:[0.52,0.94],
    tintA:[ 0.55,-0.25,-0.30], tintB:[-0.30, 0.14,-0.26],
    macro:{ amp:0.74, ridge:0.38, tint:0.34 },
    vert:{ gravel:0.56, scrub:0.72, flow:0.32, jitter:0.06 },
    make(){
      // 落ち葉のたまり場は7セル(21単位=小岩と同じ)だと茂みの塊に見えた。16セル(9.4単位)へ
      const tl = wtable(44,30, 51), tm = wtable(16,16, 61);
      const l = [0,0,0], m = [0,0,0];
      return (u,v,px,py,out)=>{
        const wu = fbmT(u,v,12,12,2,71) - 0.5, wv = fbmT(u,v,12,12,2,73) - 0.5;
        const moss = fbmT(u, v, 22, 22, 3, 27);
        // 落ち葉は一面に散らさず「たまり場」を作る。空いた所は腐葉土と苔になる
        worley(u*16 + wu*1.4, v*16 + wv*1.4, 16, 16, tm, m);
        const pile = clamp01((ih(m[2]+41, 11) - 0.30)*1.7) * (1 - m[0]*0.55);
        // セルを縦横で違う数にすると細長くなる = 丸い水玉ではなく落ち葉に見える
        worley(u*44 + wu*3.4, v*30 + wv*2.3, 44, 30, tl, l);
        const lid = ih(l[2]+7, 3);
        // 落ち葉は3.4×5単位。輪郭を立てず中心から薄れる染めにして、葉1枚が
        // 「地面に置かれた物」に見えないようにする
        const leaf = smudge(l[0], 0.26 + lid*0.58) * (lid > 1 - pile ? 1 : 0);
        const g = ih(px*3+13, py*5+1);
        out[0] = 0.90 + (moss-0.5)*0.22 + leaf*(0.10 + lid*0.18) - (1-leaf)*0.08 + (g-0.5)*0.14;
        out[1] = leaf*(0.50 + lid*1.6) - (1-leaf)*(0.45 + moss*0.55);
        // 葉の隙間(へこみ)と苔のうねりだけ。葉そのものは凹凸に入れない
        out[2] = moss*0.32 - (1-leaf)*0.16 + g*0.14;
      };
    },
  },
  /* 草原(探検フィールドの草原の盆地・ベースキャンプ)。短い芝と土の地面。
     芝の葉は「細い筋」(1本が2単位以下)で明るさに出し、芝の濃い所・薄い所・
     クローバーの群れは色み(out[1])だけで描く(塊を明るさで描かない決まり)。
     筋の周波数は整数にすること(タイルの継ぎ目で位相が飛ぶ)。              */
  meadow: {
    relief:1.00, rough:[0.66,0.98],
    tintA:[-0.06, 0.20,-0.22], tintB:[ 0.22, 0.02,-0.16],
    macro:{ amp:0.64, ridge:0.30, tint:0.22 },
    vert:{ gravel:0.30, scrub:0.70, flow:0.24, jitter:0.05 },
    make(){
      const tc = wtable(40,40, 81);
      const c = [0,0,0];
      return (u,v,px,py,out)=>{
        const wu = fbmT(u,v,12,12,2,71) - 0.5, wv = fbmT(u,v,12,12,2,73) - 0.5;
        const turf = fbmT(u, v, 24, 24, 3, 83);
        /* 芝の葉は「規則的な波」で描かない(sinの縞は遠目に砂の風紋に見えた)。
           縦横で周期の違う細かい値ノイズ(1本0.6×3単位)を2向き重ねて、倒れた葉の筋にする */
        const bA = fbmT(u + wu*0.02, v, 240, 48, 2, 91);
        const bB = fbmT(u, v + wv*0.02, 56, 250, 2, 97);
        const blade = Math.max(bA, bB);
        worley(u*40 + wu*3.0, v*40 + wv*3.0, 40, 40, tc, c);
        const cid = ih(c[2]+7, 5);
        const clover = smudge(c[0], 0.36) * (cid > 0.62 ? 1 : 0);
        const g = ih(px*3+5, py*5+7);
        out[0] = 0.82 + (blade - 0.5)*0.22 + (g-0.5)*0.10 + (turf-0.5)*0.08;
        out[1] = (turf-0.5)*1.3 + clover*(0.5 + cid*0.7) + (blade-0.5)*0.9 + wu*0.4;
        // 葉と葉の間(暗い所)をへこみにする
        out[2] = (blade - 0.5)*0.30 + turf*0.22 + g*0.10;
      };
    },
  },
};

/* PBRの4枚組(色/法線/粗さ/AO)+ 遠景マクロを、スタイルごとに1回だけ作って使い回す。
   色と凹凸は同じ高さ場から作るので、粒の見た目が必ず一致する。          */
const groundMapCache = {};
export function groundMapsFor(style){
  if(!groundMapCache[style]){
    const st = TEX_STYLES[style] || TEX_STYLES.dry;
    const maps = buildGroundMaps(st);
    // ①近景タイルは4枚とも同じ world 単位で貼る(色と凹凸をぴったり重ねるため)
    const rep = PATCH_SIZE/DETAIL_TILE;
    [maps.map, maps.normalMap, maps.roughnessMap, maps.aoMap].forEach(t=> t.repeat.set(rep, rep));
    maps.map.anisotropy = 8;          // 浅い角度で地面が溶けるのを防ぐ(足元の見えに一番効く)
    maps.normalMap.anisotropy = 8;
    maps.roughnessMap.anisotropy = 4;
    maps.aoMap.anisotropy = 4;
    // AOはUVの2枚目(uv1)が既定。地形メッシュはuvを1枚しか持たないので0番を使わせる
    maps.aoMap.channel = 0;
    groundMapCache[style] = maps;
  }
  return groundMapCache[style];
}

/* 色みの向き(tintA/tintB)から輝度成分を抜く。
   色みを強くしても明るさが動かなくなるので、「片側が明るく反対側が暗い=球」に
   見える手がかりを作らずに、模様の情報量だけを増やせる。            */
const LUMA_W = [0.2126, 0.7152, 0.0722];
const neutralTintCache = new WeakMap();
function neutralTint(t){
  let n = neutralTintCache.get(t);
  if(!n){
    const l = LUMA_W[0]*t[0] + LUMA_W[1]*t[1] + LUMA_W[2]*t[2];
    n = [t[0]-l, t[1]-l, t[2]-l];
    neutralTintCache.set(t, n);
  }
  return n;
}

/* 巻き付き(タイル)のまま横→縦に走らせる箱ぼかし。走査和なので半径に依らず O(N)。
   2回掛けて三角フィルタにする(1回だと四角い跡が残る)。                */
function boxBlurWrap(src, dst, S, r){
  const w = 1/(2*r+1);
  for(let y=0;y<S;y++){                       // 横
    const o = y*S;
    let sum = 0;
    for(let k=-r;k<=r;k++) sum += src[o + ((k%S)+S)%S];
    for(let x=0;x<S;x++){
      dst[o+x] = sum*w;
      sum += src[o + ((x+r+1)%S)] - src[o + (((x-r)%S)+S)%S];
    }
  }
  for(let x=0;x<S;x++){                       // 縦(dstを読んでdstへ書くので列を退避)
    let sum = 0;
    for(let k=-r;k<=r;k++) sum += dst[((((k%S)+S)%S))*S + x];
    for(let y=0;y<S;y++){
      blurCol[y] = sum*w;
      sum += dst[((y+r+1)%S)*S + x] - dst[((((y-r)%S)+S)%S)*S + x];
    }
    for(let y=0;y<S;y++) dst[y*S+x] = blurCol[y];
  }
}
let blurCol = null, scratchBlur = null, scratchBlur2 = null;
/* 明るさの「大きなうねり」を削る(2026-08-14の不具合対応の保険)。
   ぼかした版(=大きな模様だけ)を LUMA_LOW_KEEP まで縮め、細かい差はそのまま残す。
   これで岩と同じ大きさの明暗がテクスチャに残らなくなる。スタイル側が明るさで
   模様を描いてしまっても効く。大きな濃淡は②遠景マクロ(数百単位)が担当する。 */
function highPassLum(lum, S){
  const radPx = Math.round(LUMA_GRAIN / DETAIL_TILE * S);
  if(radPx < 2 || radPx*2+1 >= S) return;
  const N = S*S;
  // 探検フィールドは小さい画素数(EX_S)でも呼ぶので、大きさが変わったら作り直す
  if(!scratchBlur || scratchBlur.length !== N){ scratchBlur = new Float32Array(N); scratchBlur2 = new Float32Array(N); blurCol = new Float32Array(S); }
  boxBlurWrap(lum, scratchBlur, S, radPx);
  boxBlurWrap(scratchBlur, scratchBlur2, S, radPx);
  let mean = 0;
  for(let i=0;i<N;i++) mean += lum[i];
  mean /= N;
  for(let i=0;i<N;i++){
    const low = scratchBlur2[i];
    lum[i] = mean + (low-mean)*LUMA_LOW_KEEP + (lum[i]-low);
  }
}

/* 1回の走査で「明るさ・色み・高さ」を全画素ぶん求め、そこから4枚を作る。
   同じ場を共有するので、テクスチャを4枚別々に作るより速く、しかも噛み合う。 */
let scratchLum = null, scratchWarm = null, scratchHgt = null;
function buildGroundMaps(st){
  const S = DETAIL_S, N = S*S;
  if(!scratchLum){ scratchLum = new Float32Array(N); scratchWarm = new Float32Array(N); scratchHgt = new Float32Array(N); }
  const lum = scratchLum, warm = scratchWarm, hgt = scratchHgt;
  const field = st.make();
  const out = [0,0,0];
  let hMin = 1e9, hMax = -1e9;
  for(let y=0;y<S;y++){
    const v = y/S;
    for(let x=0;x<S;x++){
      field(x/S, v, x, y, out);
      const i = y*S+x;
      lum[i] = out[0]; warm[i] = out[1];
      const h = out[2];
      hgt[i] = h;
      if(h < hMin) hMin = h;
      if(h > hMax) hMax = h;
    }
  }
  // 高さ場を0〜1へ正規化しておく(スタイルごとに値の幅が違うため)
  const hs = 1/Math.max(1e-4, hMax-hMin);
  let hSum = 0;
  for(let i=0;i<N;i++){ const h = (hgt[i]-hMin)*hs; hgt[i] = h; hSum += h; }
  // 出っ張り潰し。平均より上だけを RELIEF_PEAK 倍に縮め、へこみは等倍で残す。
  // これで「地面から粒が生えている」形が法線・AO・粗さのどれにも焼かれなくなる
  // (スタイル側が out[2] に出っ張りを入れてしまっても効く保険)。
  if(RELIEF_PEAK < 1){
    const mean = hSum/N;
    for(let i=0;i<N;i++){ const h = hgt[i]; if(h > mean) hgt[i] = mean + (h-mean)*RELIEF_PEAK; }
  }

  // 明るさから「岩と同じ大きさのうねり」を削る(保険。上の【最重要】を参照)
  highPassLum(lum, S);

  // 色みの向きは輝度中立にしてから使う。色みで模様を描いても陰影に見えない
  const A = neutralTint(st.tintA), B = neutralTint(st.tintB);
  let midSum = 0;
  const map = makeTexture(S, (d)=>{
    for(let i=0;i<N;i++){
      const L = lum[i], w = warm[i];
      const t = w > 0 ? A : B, a0 = w > 0 ? w : -w;
      // 色みの効きは頭打ちさせる。小さい所は素通りで、強い所だけ緩やかに詰まる。
      // 詰めないと channel が1.0に張り付き、色みのはずが「暗い染み」に化ける
      const aw = a0/(1 + a0*TINT_KNEE);
      const r = clamp01(L*(1 + aw*t[0])), g = clamp01(L*(1 + aw*t[1])), b = clamp01(L*(1 + aw*t[2]));
      const j = i*4;
      d[j]   = Math.round(r*255);
      d[j+1] = Math.round(g*255);
      d[j+2] = Math.round(b*255);
      d[j+3] = 255;
      // シェーダーで掛け直すときの基準にする平均輝度(sRGB→リニアに直してから平均)
      midSum += 0.2126*srgbLin(r) + 0.7152*srgbLin(g) + 0.0722*srgbLin(b);
    }
  }, true);
  const midRef = 1 / Math.max(0.02, midSum/N);

  const at = (x,y)=>{
    let ax = x % S; if(ax < 0) ax += S;
    let ay = y % S; if(ay < 0) ay += S;
    return hgt[ay*S+ax];
  };
  // 法線: 高さ場の傾きをそのままRGBに入れる(接空間なのでZは常に手前向き)
  const bake = 0.20 * st.relief * S/64;
  const normalMap = makeTexture(S, (d)=>{
    for(let y=0;y<S;y++){
      for(let x=0;x<S;x++){
        const dx = (at(x+1,y) - at(x-1,y)) * bake;
        const dy = (at(x,y+1) - at(x,y-1)) * bake;
        const len = Math.hypot(dx, dy, 1);
        const i = (y*S+x)*4;
        d[i]   = Math.round((-dx/len*0.5+0.5)*255);
        d[i+1] = Math.round(( dy/len*0.5+0.5)*255);
        d[i+2] = Math.round((  1/len*0.5+0.5)*255);
        d[i+3] = 255;
      }
    }
  }, false);
  // 粗さ: 出っ張った粒はわずかにツヤ、窪みはマット
  const lo = st.rough[0], hi = st.rough[1];
  const roughnessMap = makeTexture(S, (d)=>{
    for(let y=0;y<S;y++){
      for(let x=0;x<S;x++){
        const i = y*S+x;
        const r = lo + (hi-lo)*clamp01(0.55 + (0.5-hgt[i])*0.9 + (ih(x*2+3, y*3+5)-0.5)*0.25);
        const c = Math.round(r*255), j = i*4;
        d[j]=d[j+1]=d[j+2]=c; d[j+3]=255;
      }
    }
  }, false);
  // AO: まわりより低い所を暗くする(粒の間に落ちる細かい影)
  const aoMap = makeTexture(S, (d)=>{
    for(let y=0;y<S;y++){
      for(let x=0;x<S;x++){
        let avg = 0;
        for(let oy=-6;oy<=6;oy+=6) for(let ox=-6;ox<=6;ox+=6) avg += at(x+ox, y+oy);
        avg /= 9;
        const occ = clamp01(0.80 + (at(x,y)-avg)*2.2);
        const c = Math.round((0.58 + occ*0.42)*255), j = (y*S+x)*4;
        d[j]=d[j+1]=d[j+2]=c; d[j+3]=255;
      }
    }
  }, false);

  return { map, normalMap, roughnessMap, aoMap, macroMap: buildMacroMap(st), midRef };
}

/* ②遠景マクロ。①のタイル(150単位)より1桁大きい模様だけを持つ薄い掛け算の層。
   ドメインワープした fBm(大きな土質の分布)と尾根状ノイズ(涸れ沢・踏み跡の筋)。
   0.5を中央値にして、シェーダー側で ×2 して掛ける = 0.5なら素通り。
   色として作らない(NoColorSpace)。sRGBにすると中央値が素通りにならない。   */
function buildMacroMap(st){
  const S = MACRO_S, m = st.macro;
  const tex = makeTexture(S, (d)=>{
    for(let y=0;y<S;y++){
      const v = y/S;
      for(let x=0;x<S;x++){
        const u = x/S;
        const wu = u + (fbmT(u, v, 4, 4, 2, 307)-0.5)*0.20;
        const wv = v + (fbmT(u, v, 4, 4, 2, 401)-0.5)*0.20;
        // オクターブを増やしすぎない。3x3を4段回すと最後の段が100単位(=中くらいの岩と
        // 同じ大きさ)の明暗になり、遠目に石が転がって見える。ここは「数百単位」だけ持つ
        const n  = fbmT(wu, wv, 3, 3, 3, 101);
        const rg = 1 - Math.abs(fbmT(wu, wv, 5, 5, 2, 211)*2 - 1);
        const L = 0.5 + (n-0.5)*m.amp + (rg-0.62)*m.ridge;
        const t = (fbmT(u, v, 2, 2, 2, 503)-0.5)*m.tint;
        const i = (y*S+x)*4;
        d[i]   = Math.round(clamp01(L*(1+t*0.9))*255);
        d[i+1] = Math.round(clamp01(L*(1+t*0.1))*255);
        d[i+2] = Math.round(clamp01(L*(1-t*0.9))*255);
        d[i+3] = 255;
      }
    }
  }, false);
  tex.anisotropy = 4;
  return tex;
}

/* ②を地面のシェーダーへ差し込む。MeshStandardMaterial をそのまま使い、
   拡散色を求めた直後に「大きな濃淡」を掛けるだけ(数行)。
   vMapUv は①のタイル座標なので、MACRO比を掛ければワールドに固定されたまま
   1桁大きい模様になる。少し回して①と模様が揃わないようにしている。      */
const MACRO_PARS = `
uniform sampler2D uMacroMap;
uniform float uMacroScale;
uniform float uMacroAmt;
uniform float uMacroAmt2;
uniform float uMidScale;
uniform float uMidRef;
uniform float uMidAmt;
`;
/* 近景タイル(①)を4.7倍に引き伸ばして、もう一度うっすら掛ける。
   150単位の模様に700単位の模様が重なるので、周期が両者の最小公倍数まで伸び、
   同じ絵の繰り返しが目に付かなくなる(タイル1枚を細かく作るより効く)。

   【この層は色みだけを掛ける】(2026-08-14の不具合対応)
   前は輝度(dL)を掛けていたので、①の細かい模様が4.7倍(=35〜700単位)の
   「明暗の塊」になって地面に散った。岩と同じ大きさの明暗なので、実機では
   平らなはずの模様が岩と見分けられなくなった。
   いまは輝度で割って色みだけを取り出す(=明るさは1のまま色だけ回る)。
   繰り返し消しの効果は残り、塊状の陰影だけが消える。                        */
const MACRO_CHUNK = `
#ifdef USE_MAP
  vec2 mUv = vec2( vMapUv.x*0.7648 - vMapUv.y*0.6442, vMapUv.x*0.6442 + vMapUv.y*0.7648 ) * uMacroScale;
  diffuseColor.rgb *= mix( vec3(1.0), texture2D( uMacroMap, mUv ).rgb * 2.0, uMacroAmt );
  // マクロをさらに3倍へ引き伸ばした層。1万単位近い「地域差」になり、霞の手前まで
  // 濃淡が残る(これが無いと遠くの地面が一色の海になる)
  vec2 m2Uv = vec2( vMapUv.x*0.4067 + vMapUv.y*0.9135, vMapUv.y*0.4067 - vMapUv.x*0.9135 ) * uMacroScale * 0.31;
  diffuseColor.rgb *= mix( vec3(1.0), texture2D( uMacroMap, m2Uv ).rgb * 2.0, uMacroAmt2 );
  vec2 dUv = vec2( vMapUv.x*0.9135 + vMapUv.y*0.4068, vMapUv.y*0.9135 - vMapUv.x*0.4068 ) * uMidScale;
  vec3 dC = texture2D( map, dUv ).rgb;
  float dL = max( dot( dC, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 );
  diffuseColor.rgb *= mix( vec3(1.0), dC / dL, uMidAmt );
#endif
`;
// uniform の中身は使い回す(材質を作り直しても、テーマ差し替えで値を入れ直せる)
const macroUniforms = {
  uMacroMap:   { value:null },
  uMacroScale: { value:DETAIL_TILE/MACRO_TILE },
  uMacroAmt:   { value:MACRO_AMT },
  uMacroAmt2:  { value:MACRO_AMT2 },
  uMidScale:   { value:0.213 },
  uMidRef:     { value:1 },
  uMidAmt:     { value:MID_AMT },
};
function attachMacro(mat){
  mat.onBeforeCompile = (shader)=>{
    for(const k in macroUniforms) shader.uniforms[k] = macroUniforms[k];
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>' + MACRO_PARS)
      .replace('#include <map_fragment>', '#include <map_fragment>' + MACRO_CHUNK);
  };
  mat.customProgramCacheKey = ()=> 'aramonGroundMacro';
}

/* =====================================================================
   探検フィールド: 地域ごとに地面の質感を変える(R3.theme.explore のときだけ)
   ・4地域ぶんの近景タイル(草原/雪/溶岩の殻/密林)を1回で作り、チャンネルに詰める
       lum  RGBA = 各地域の明るさ / tint RGBA = 各地域の色み
       nA   RG=地域0の法線 BA=地域1 / nB RG=地域2 BA=地域3
   ・どの地域の模様をどれだけ出すかは頂点属性 aExW(4つの重み。キャンプは草原に含める)。
     頂点ごとなのでラスタライザが面をまたいで滑らかにつなぐ(=境目が線にならない)
   ・画素数は EX_S(256)。1地域あたり通常の1/4なので、4地域でも通常マップ1枚ぶんの生成時間
   ・他のマップの材質(stdMat)には一切触らない。テーマが変わったら材質ごと差し替える
   ===================================================================== */
const EX_S = 256;
const EX_STYLES = ['meadow', 'snow', 'volcanic', 'jungle'];   // aExW の x,y,z,w の順
let exMaps = null, exMat = null, stdMat = null;
let terrainExW = null, scratchExW = null;

function dataTex(data, S){
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.flipY = true;               // キャンバスのテクスチャと同じ向き(法線の緑の符号をそろえる)
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
function buildExploreMaps(){
  if(exMaps) return exMaps;
  const S = EX_S, N = S*S;
  const lum = new Uint8Array(N*4), tint = new Uint8Array(N*4);
  const nA = new Uint8Array(N*4), nB = new Uint8Array(N*4);
  const L = new Float32Array(N), Wm = new Float32Array(N), H = new Float32Array(N);
  const out = [0,0,0];
  const tA = [], tB = [], rough = [];
  let compat = null;
  EX_STYLES.forEach((name, ch)=>{
    const st = TEX_STYLES[name];
    const field = st.make();
    let hMin = 1e9, hMax = -1e9;
    for(let y=0;y<S;y++) for(let x=0;x<S;x++){
      field(x/S, y/S, x*2, y*2, out);      // 画素番号は512画素のときと同じ粒になるよう2倍
      const i = y*S + x;
      L[i] = out[0]; Wm[i] = out[1]; H[i] = out[2];
      if(out[2] < hMin) hMin = out[2];
      if(out[2] > hMax) hMax = out[2];
    }
    const hs = 1/Math.max(1e-4, hMax-hMin);
    let hSum = 0;
    for(let i=0;i<N;i++){ H[i] = (H[i]-hMin)*hs; hSum += H[i]; }
    const mean = hSum/N;
    for(let i=0;i<N;i++){ if(H[i] > mean) H[i] = mean + (H[i]-mean)*RELIEF_PEAK; }
    highPassLum(L, S);
    const bake = 0.20 * st.relief * S/64 * 2;   // 512画素のときと同じ傾きになるよう画素が粗いぶん倍
    const at = (x, y)=> H[(((y%S)+S)%S)*S + (((x%S)+S)%S)];
    const nArr = ch < 2 ? nA : nB, o = (ch % 2) * 2;
    for(let y=0;y<S;y++) for(let x=0;x<S;x++){
      const i = y*S + x, j = i*4;
      lum[j+ch]  = Math.round(clamp01(L[i])*255);
      tint[j+ch] = Math.round(clamp01(Wm[i]*0.25 + 0.5)*255);
      const dx = (at(x+1,y) - at(x-1,y))*bake, dy = (at(x,y+1) - at(x,y-1))*bake;
      const len = Math.hypot(dx, dy, 1);
      nArr[j+o]   = Math.round((-dx/len*0.5 + 0.5)*255);
      nArr[j+o+1] = Math.round(( dy/len*0.5 + 0.5)*255);
    }
    tA.push(new THREE.Vector3(...neutralTint(st.tintA)));
    tB.push(new THREE.Vector3(...neutralTint(st.tintB)));
    rough.push((st.rough[0] + st.rough[1])*0.5);
    /* 地面の色を読む他の担当(障害物の色の基準・水辺の濡れた砂)向けに、
       草原のぶんだけ従来と同じ形(キャンバスのテクスチャ)でも持っておく。 */
    if(ch === 0){
      const A = neutralTint(st.tintA), B = neutralTint(st.tintB);
      let midSum = 0;
      const map = makeTexture(S, (d)=>{
        for(let i=0;i<N;i++){
          const w = Wm[i], t = w > 0 ? A : B, a0 = Math.abs(w), aw = a0/(1 + a0*TINT_KNEE);
          const r = clamp01(L[i]*(1 + aw*t[0])), g = clamp01(L[i]*(1 + aw*t[1])), b = clamp01(L[i]*(1 + aw*t[2]));
          d[i*4] = r*255; d[i*4+1] = g*255; d[i*4+2] = b*255; d[i*4+3] = 255;
          midSum += 0.2126*srgbLin(r) + 0.7152*srgbLin(g) + 0.0722*srgbLin(b);
        }
      }, true);
      const normalMap = makeTexture(S, (d)=>{
        for(let i=0;i<N;i++){ d[i*4] = nA[i*4]; d[i*4+1] = nA[i*4+1]; d[i*4+2] = 240; d[i*4+3] = 255; }
      }, false);
      compat = { map, normalMap, roughnessMap:map, aoMap:map, midRef: 1/Math.max(0.02, midSum/N) };
    }
  });
  exMaps = {
    lum: dataTex(lum, S), tint: dataTex(tint, S), nA: dataTex(nA, S), nB: dataTex(nB, S),
    macro: buildMacroMap(TEX_STYLES.meadow), tA, tB,
    rough: new THREE.Vector4(rough[0], rough[1], rough[2], rough[3]),
    compat,
  };
  exMaps.compat.macroMap = exMaps.macro;
  const rep = PATCH_SIZE/DETAIL_TILE;
  [exMaps.lum, exMaps.tint, exMaps.nA, exMaps.nB].forEach(t=> t.repeat.set(rep, rep));
  return exMaps;
}

const EX_PARS = `
uniform sampler2D uExTint;
uniform sampler2D uExNB;
uniform vec3 uExTA[4];
uniform vec3 uExTB[4];
uniform vec4 uExRough;
uniform sampler2D uExMacro;
uniform float uExMacroScale;
varying vec4 vExW;
varying vec3 vExP;
varying vec3 vExN;
uniform vec4 uExSnowAlt;
uniform vec3 uExSnowCol;
uniform vec3 uExSteep[4];
vec4 exL;
float exRk, exSn, exSlopeG;
vec3 exRockT;
vec3 exRegion(float L, float w, vec3 ta, vec3 tb){
  vec3 t = (w > 0.0) ? ta : tb;
  float a0 = abs(w);
  float aw = a0 / (1.0 + a0*0.18);
  vec3 c = clamp(L*(1.0 + aw*t), 0.0, 1.0);
  return pow(c, vec3(2.2));   // 値はsRGBで持っているのでリニアへ
}
`;
/* 地域ごとの近景タイルを重みで混ぜる(map_fragment の置き換え)。
   遠景マクロは通常マップと同じ式(MACRO_CHUNK の前半)。 */
const EX_MAP_CHUNK = `
#ifdef USE_MAP
{
  exL = texture2D(map, vMapUv);
  vec4 exT = (texture2D(uExTint, vMapUv) - 0.5) * 4.0;
  vec3 exC = exRegion(exL.r, exT.r, uExTA[0], uExTB[0]) * vExW.x
           + exRegion(exL.g, exT.g, uExTA[1], uExTB[1]) * vExW.y
           + exRegion(exL.b, exT.b, uExTA[2], uExTB[2]) * vExW.z
           + exRegion(exL.a, exT.a, uExTA[3], uExTB[3]) * vExW.w;
  /* 地面のタイル(map)は上から見た平地むけに、風の吹き筋など**縦横比の違う**模様を
     焼き込んでいる(雪=u方向2.5・v方向15単位)。平地では正しく見えるが、この模様のまま
     急斜面(崖・急な丘)に貼ると、筋の向きが画面の縦とほぼ揃って「縦に引き伸ばした模様」に
     見える(2026-09-24 saddle/frost/canyon)。急斜面ではLを均してから混ぜ、筋を弱める */
  {
    float exFlat = 1.0 - smoothstep(0.10, 0.34, 1.0 - clamp(vExN.y, 0.0, 1.0));
    if(exFlat < 0.999){
      vec3 exCFlat = exRegion(0.86, exT.r, uExTA[0], uExTB[0]) * vExW.x
                   + exRegion(0.86, exT.g, uExTA[1], uExTB[1]) * vExW.y
                   + exRegion(0.86, exT.b, uExTA[2], uExTB[2]) * vExW.z
                   + exRegion(0.86, exT.a, uExTA[3], uExTB[3]) * vExW.w;
      exC = mix(exCFlat, exC, exFlat);
    }
  }
  /* 急斜面(崖・尾根の岩肌)と雪は**画素ごと**に決める(頂点色で塗ると、粗い三角形の
     境目がそのまま出てノコギリ歯の模様になった)。傾き+低周波ノイズで境目を揺らす。
     岩は横から投影した岩の粒(溶岩の殻のチャンネル)に水平の地層の縞を足す(三方向投影の横2面) */
  {
    vec3 an = abs(vExN);
    // 大小2つのノイズを混ぜる(1つだけだと13000単位に1回しか揺れず、境目が等高線のまま=点線に見えた)
    float exNzLo = texture2D(uExMacro, vExP.xz * 0.00085).r - 0.5;
    float exNzHi = texture2D(uExMacro, vExP.xz * 0.0052 + 11.0).r - 0.5;
    float exNz = exNzLo*0.7 + exNzHi*0.3;
    float exSlope = 1.0 - clamp(vExN.y, 0.0, 1.0);
    exSlopeG = exSlope;   // EX_NORMAL_CHUNK(このあと実行される)へ渡す
    // 緩い丘(exploreRelief最大傾斜0.17≈exSlope0.06)では岩を出さない。本物の崖・尾根だけ岩肌にする
    exRk = smoothstep(0.38, 0.78, exSlope + exNz * 0.14);
    exRockT = vec3(0.0);
    if(exRk > 0.002){   // 岩の粒は岩肌の所だけ読む(平地では読まない)
      // 面の向きで(Z,Y)/(X,Y)を選ぶ。法線がX方向を向く壁=面はZ-Y平面に沿うのでZ,Yで投影する
      // (取り違えると、動かない片方の軸だけで縦に引き伸ばした模様になる。canyon/frostの縦筋の原因)
      float rx = texture2D(map, vExP.zy / 150.0).b, rz = texture2D(map, vExP.xy / 150.0).b;
      float rk = mix(rx, rz, an.x / (an.x + an.z + 1e-4));
      float band = 0.90 + 0.10*sin(vExP.y*0.058 + exNzLo*5.0) * (0.4 + 0.6*exNzHi);
      exRockT = vec3(pow(rk, 2.2)) * band * 1.18;
    }
    float exAlt = dot(vExW, uExSnowAlt);
    // 雪の境目は広めにぼかし、低周波のノイズで大きく揺らす(三角形の形にも、地域の境の等高線にもならないように)
    exSn = smoothstep(exAlt - 260.0, exAlt + 520.0, vExP.y + exNz * 640.0)
         * (1.0 - smoothstep(0.30, 0.68, exSlope + exNz * 0.20));
  }
  diffuseColor.rgb *= exC;
  vec2 mUv = vec2( vMapUv.x*0.7648 - vMapUv.y*0.6442, vMapUv.x*0.6442 + vMapUv.y*0.7648 ) * uExMacroScale;
  diffuseColor.rgb *= mix( vec3(1.0), texture2D( uExMacro, mUv ).rgb * 2.0, ${MACRO_AMT.toFixed(2)} );
  vec2 m2Uv = vec2( vMapUv.x*0.4067 + vMapUv.y*0.9135, vMapUv.y*0.4067 - vMapUv.x*0.9135 ) * uExMacroScale * 0.31;
  diffuseColor.rgb *= mix( vec3(1.0), texture2D( uExMacro, m2Uv ).rgb * 2.0, ${MACRO_AMT2.toFixed(2)} );
}
#endif
`;
const EX_NORMAL_CHUNK = `
#if defined( USE_NORMALMAP_TANGENTSPACE )
{
  vec4 exNa = texture2D( normalMap, vNormalMapUv );
  vec4 exNb = texture2D( uExNB, vNormalMapUv );
  vec2 exXY = (exNa.rg*2.0 - 1.0)*vExW.x + (exNa.ba*2.0 - 1.0)*vExW.y
            + (exNb.rg*2.0 - 1.0)*vExW.z + (exNb.ba*2.0 - 1.0)*vExW.w;
  // 法線マップは常に真上からのUV(vNormalMapUv)で作っているので、世界の傾き(exSlopeG)
  // ではなく「今のカメラから見てその面がどれだけ斜めか」で強さを落とす必要がある
  // (傾きが緩い丘でも、近くからほぼ横に見ると同じ縞が出た。2026-09-24)。
  // normalはここではまだ「幾何形状そのものの法線」(このチャンクが書き換える前)
  float exFace = abs(dot(normalize(vViewPosition), normal));
  exXY *= smoothstep(0.05, 0.45, exFace);
  vec3 mapN = normalize( vec3( exXY * normalScale, 1.0 ) );
  normal = normalize( tbn * mapN );
}
#endif
`;
function buildExploreMaterial(){
  const m = buildExploreMaps();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors:true, map: m.lum, normalMap: m.nA,
    // 探検フィールドは通常マップより起伏が急な地形(尾根・崖・段丘)が多く、真上からのUVで
    // 作った法線マップをそのまま貼ると、斜めから見た面に縦に伸びたハイライトの縞が出た
    // (2026-09-24。特に雪の風筋パターンで目立った)。EX_NORMAL_CHUNK の視線角フェードと
    // 合わせ、地の強さそのものも通常マップの0.15倍に抑える
    normalScale: new THREE.Vector2(R3.theme.bump*NORMAL_GAIN*0.15, R3.theme.bump*NORMAL_GAIN*0.15),
    metalness:0.0, roughness:1.0, envMapIntensity: ENV_INTENSITY, dithering:true,
  });
  const uni = {
    uExTint:{ value:m.tint }, uExNB:{ value:m.nB },
    uExTA:{ value:m.tA }, uExTB:{ value:m.tB }, uExRough:{ value:m.rough },
    uExMacro:{ value:m.macro }, uExMacroScale:{ value:DETAIL_TILE/MACRO_TILE },
    uExSnowAlt:{ value:new THREE.Vector4() }, uExSnowCol:{ value:new THREE.Color() },
    uExSteep:{ value:[new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()] },
  };
  {
    // 雪の高さ・岩の色は地域ごと(aExW の順。キャンプは草原に含める)。雪の無い地域は十分高い値にする
    const pal = explorePalette(), alt = (i)=> Math.min(9000, pal[i].snowAlt);
    uni.uExSnowAlt.value.set(alt(0), alt(1), alt(2), alt(3));
    uni.uExSnowCol.value.copy(pal.snow);
    for(let i=0;i<4;i++) uni.uExSteep.value[i].copy(pal[i].steep);
  }
  mat.onBeforeCompile = (sh)=>{
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aExW;\nvarying vec4 vExW;\nvarying vec3 vExP;\nvarying vec3 vExN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvExW = aExW;\nvExP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvExN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>' + EX_PARS)
      .replace('#include <map_fragment>', EX_MAP_CHUNK)
      .replace('#include <normal_fragment_maps>', EX_NORMAL_CHUNK)
      // 岩と雪は頂点色ではなく画素で塗る(上の EX_MAP_CHUNK で決めた exRk / exSn)
      .replace('#include <color_fragment>', [
        '#include <color_fragment>',
        'vec3 exRockC = uExSteep[0]*vExW.x + uExSteep[1]*vExW.y + uExSteep[2]*vExW.z + uExSteep[3]*vExW.w;',
        'diffuseColor.rgb = mix(diffuseColor.rgb, exRockC * exRockT, exRk);',
        'diffuseColor.rgb = mix(diffuseColor.rgb, uExSnowCol * (0.62 + 0.30*dot(exL, vExW)), exSn);',
      ].join('\n'))
      // 粗さは地域ごと。明るい粒ほど少しつやが出る
      .replace('#include <roughnessmap_fragment>',
               'float roughnessFactor = clamp(dot(vExW, uExRough) * (1.08 - 0.16*dot(exL, vExW)), 0.2, 1.0);');
  };
  mat.customProgramCacheKey = ()=> 'aramonGroundExplore';
  return mat;
}
// 地域ごとの頂点色の材料(テーマの regions から1回だけ作る)
let exPal = null, exPalTheme = null;
function explorePalette(){
  if(exPalTheme === R3.theme && exPal) return exPal;
  exPalTheme = R3.theme;
  const th = R3.theme;
  exPal = EXPLORE_KEYS.map(k=>{
    const r = th.regions[k];
    const st = TEX_STYLES[r.tex] || TEX_STYLES.meadow;
    return { low:new THREE.Color(r.low), high:new THREE.Color(r.high), steep:new THREE.Color(r.steep),
             gravel:new THREE.Color(r.gravel), scrub:new THREE.Color(r.scrub), vert:st.vert,
             grass:new THREE.Color(r.grass).multiplyScalar(0.62), grassK:0.62*((r.veg && r.veg.grass) || 0),
             snowAlt:(r.snowAlt != null) ? r.snowAlt : 1e9, strata:r.strata || 0 };
  });
  exPal.trail = new THREE.Color(th.regions.camp.gravel).multiplyScalar(0.9);
  exPal.snow = new THREE.Color(0xeaf1fa);
  // 遠景の山の方角ごとの色(火山=玄武岩と溶岩の照り返し / 密林=森)。地域の岩・草の色から作る
  exPal.basalt = new THREE.Color(th.regions.volcano.steep).multiplyScalar(0.9);
  exPal.ember = new THREE.Color(th.regions.volcano.haze).lerp(new THREE.Color(0xff5a1e), 0.35);   // 溶岩の光の色(温度の色なのでテーマに依らない)
  exPal.forest = new THREE.Color(th.regions.jungle.low).lerp(new THREE.Color(th.regions.jungle.grass), 0.35);
  return exPal;
}

export function buildTerrain(){
  // 平面を作ってからX-Z平面へ倒す。頂点の高さ(y)は毎回 updateTerrain で書き換える
  const geo = new THREE.PlaneGeometry(PATCH_SIZE, PATCH_SIZE, PATCH_SEGS, PATCH_SEGS);
  geo.rotateX(-Math.PI/2);
  const n = geo.attributes.position.count;
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n*3), 3));
  // UVはパッチのローカル座標そのままなので、repeatで「何単位に1回」貼るかを決める。
  // パッチ位置はCELLの倍数にスナップして動かすため、模様がワールドに固定されて見える。
  // 探検フィールドで初めて作るときは、使わない通常の4枚組(512画素)を作らない
  groundMaps = isExplore() ? buildExploreMaps().compat : groundMapsFor(R3.theme.tex);
  macroUniforms.uMacroMap.value = groundMaps.macroMap;
  macroUniforms.uMidRef.value = groundMaps.midRef;
  vert = (TEX_STYLES[R3.theme.tex] || TEX_STYLES.dry).vert;
  // PBR。金属ではないので metalness は0、粗さはテクスチャに任せる。
  // theme.bump は法線の強さ(凹凸の見え方)として使う。
  const mat = new THREE.MeshStandardMaterial({
    vertexColors:true,
    map: groundMaps.map,
    normalMap: groundMaps.normalMap,
    roughnessMap: groundMaps.roughnessMap,
    aoMap: groundMaps.aoMap,
    normalScale: new THREE.Vector2(R3.theme.bump*NORMAL_GAIN, R3.theme.bump*NORMAL_GAIN),
    metalness: 0.0, roughness: 1.0, aoMapIntensity: 0.85,
    envMapIntensity: ENV_INTENSITY, dithering: true,
  });
  attachMacro(mat);
  stdMat = mat;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  // 丘が自分自身へ影を落とす(影を受ける側にもなる)
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  terrainPos = geo.attributes.position;
  terrainCol = geo.attributes.color;
  terrainNrm = geo.attributes.normal;
  terrain = mesh;
  return mesh;
}

/* =====================================================================
   ③頂点カラー(頂点間隔50単位)

   高さ・傾きだけで塗ると縞に見えるので、ワールド座標で決まる「土質の分布」を混ぜる。
   ・大(BIOME_L) 土と砂利の大きな入れ替わり。遠景で読める模様の主役
   ・中(BIOME_M) 低木・枯れ草のまだら
   ・筋(BIOME_F) 斜面を下る向きへ伸ばした尾根状ノイズ = 雨で流れた跡
       座標を勾配(gx,gy)ぶんずらすと、模様が坂に沿って伸びる。
   すべて整数ハッシュの値ノイズなので、同じ場所は必ず同じ色になる(純関数)。
   ===================================================================== */
const _c = new THREE.Color(), _cTmp = new THREE.Color();
const _cLow = new THREE.Color(DEFAULT_THEME.low), _cHigh = new THREE.Color(DEFAULT_THEME.high), _cSteep = new THREE.Color(DEFAULT_THEME.steep);
const _cGravel = new THREE.Color(DEFAULT_THEME.gravel), _cScrub = new THREE.Color(DEFAULT_THEME.scrub);
const BIOME_L = 1250, BIOME_M = 430, BIOME_F = 260;
const FLOW_WARP = 900;      // 勾配で座標をずらす量。大きいほど筋が坂に強く沿う
let vert = TEX_STYLES.dry.vert;

// ワールド座標の値ノイズ(タイルしない)。頂点ごとに呼ぶので三角関数は使わない
function vnW(x, y, salt){
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x-xi, yf = y-yi;
  const u = xf*xf*(3-2*xf), v = yf*yf*(3-2*yf);
  const a = ih(xi+salt, yi), b = ih(xi+1+salt, yi), c = ih(xi+salt, yi+1), d = ih(xi+1+salt, yi+1);
  const ab = a + (b-a)*u, cd = c + (d-c)*u;
  return ab + (cd-ab)*v;
}
function fbmW(x, y, oct, salt){
  let s = 0, amp = 0.5, tot = 0, f = 1;
  for(let o=0;o<oct;o++){ s += vnW(x*f, y*f, salt+o*37)*amp; tot += amp; amp *= 0.5; f *= 2; }
  return s/tot;
}

const PATCH_SNAP_CELLS = 2;              // パッチを動かす刻み(セル数)。大きいほど作り直しが減る
const PATCH_SNAP = CELL * PATCH_SNAP_CELLS;
const PATCH_VERTS = PATCH_SEGS + 1;      // 1辺の頂点数
let patchStepX = 0, patchStepZ = 0;      // 頂点1つぶんのローカル座標の刻み(符号込み)
let scratchPos = null, scratchCol = null, scratchNrm = null;
let lastPatchVerts = 0, lastPatchMs = 0, patchRebuilds = 0; // 計測用(管理者画面のパフォーマンス表示)

export function terrainStats(){
  return { patchVerts:lastPatchVerts, patchMs:lastPatchMs, patchCount:patchRebuilds };
}

/* パッチをプレイヤー位置へ動かし、頂点の高さ・色・法線を書き直す。
   ・中心を PATCH_SNAP の倍数にスナップするので、動かしても頂点が同じワールド座標に乗る
   ・パッチが k セルぶん動いただけなら、重なっている部分の値は前回とまったく同じ。
     ずらしてコピーし、新しく現れた帯だけを計算する(1セル移動なら計算量が約1/70)
   ・傾きは real3dHeightGrad() の解析微分。法線もそこから直接作るので
     computeVertexNormals()(4万三角形の走査)が丸ごと不要になる                    */
export function updateTerrain(cx, cy){
  const sx = Math.round(cx / PATCH_SNAP) * PATCH_SNAP;
  const sy = Math.round(cy / PATCH_SNAP) * PATCH_SNAP;
  if(patchCX === sx && patchCY === sy) return;
  const t0 = performance.now();
  const pos = terrainPos.array, col = terrainCol.array, nrm = terrainNrm.array;
  const V = PATCH_VERTS;
  if(!patchStepX){
    patchStepX = pos[1*3] - pos[0];               // 隣の頂点とのローカルx差
    patchStepZ = pos[V*3+2] - pos[2];             // 1行下の頂点とのローカルz差
    scratchPos = new Float32Array(pos.length);
    scratchCol = new Float32Array(col.length);
    scratchNrm = new Float32Array(nrm.length);
  }
  // 前回のパッチから何頂点ぶんずれたか(整数でなければ作り直す)
  let shiftX = 0, shiftY = 0, reuse = false;
  if(patchCX !== null && patchStepX && patchStepZ){
    const fx = (sx - patchCX) / patchStepX, fy = (sy - patchCY) / patchStepZ;
    shiftX = Math.round(fx); shiftY = Math.round(fy);
    reuse = Math.abs(fx-shiftX) < 1e-6 && Math.abs(fy-shiftY) < 1e-6
         && Math.abs(shiftX) < V && Math.abs(shiftY) < V;
  }
  const ex = isExplore() && terrainExW;
  const exw = ex ? terrainExW.array : null;
  const pal = ex ? explorePalette() : null;
  if(reuse){
    scratchPos.set(pos); scratchCol.set(col); scratchNrm.set(nrm);
    if(ex){ if(!scratchExW) scratchExW = new Float32Array(exw.length); scratchExW.set(exw); }
  }
  patchCX = sx; patchCY = sy;
  const vGravel = vert.gravel, vScrub = vert.scrub, vFlow = vert.flow, vJit = vert.jitter;
  let computed = 0;
  for(let iy=0; iy<V; iy++){
    const sIy = iy + shiftY;
    const rowOk = reuse && sIy>=0 && sIy<V;
    for(let ix=0; ix<V; ix++){
      const d = (iy*V + ix)*3;
      if(rowOk){
        const sIx = ix + shiftX;
        if(sIx>=0 && sIx<V){
          const s = (sIy*V + sIx)*3;
          pos[d+1] = scratchPos[s+1];
          col[d]=scratchCol[s]; col[d+1]=scratchCol[s+1]; col[d+2]=scratchCol[s+2];
          nrm[d]=scratchNrm[s]; nrm[d+1]=scratchNrm[s+1]; nrm[d+2]=scratchNrm[s+2];
          if(ex){ const a = (d/3)*4, b = (s/3)*4;
                  exw[a]=scratchExW[b]; exw[a+1]=scratchExW[b+1]; exw[a+2]=scratchExW[b+2]; exw[a+3]=scratchExW[b+3]; }
          continue;
        }
      }
      const wx = sx + pos[d], wy = sy + pos[d+2];
      const g = window.real3dHeightGrad ? window.real3dHeightGrad(wx, wy) : null;
      const h = g ? g.h : heightAt(wx, wy);
      const gx = g ? g.gx : 0, gy = g ? g.gy : 0;
      pos[d+1] = h;
      // 法線は解析微分から直接。面の平均を取るより正確で、走査も要らない
      const inv = 1 / Math.hypot(gx, 1, gy);
      nrm[d] = -gx*inv; nrm[d+1] = inv; nrm[d+2] = -gy*inv;
      // --- ここから色 ---
      const slope = Math.min(1, Math.hypot(gx, gy) / 0.45);
      const t = clamp01((h + 240) / 480);
      _c.copy(_cLow).lerp(_cHigh, t);
      // 大きな土質の分布(遠景で読める主役)
      const nb = fbmW(wx/BIOME_L, wy/BIOME_L, 2, 3);
      // 中くらいのまだら(低木・枯れ草)
      const nm = fbmW(wx/BIOME_M + 11.3, wy/BIOME_M - 7.1, 2, 71);
      // 斜面を下る向きへ伸ばした筋(雨で流れた跡)
      const nf = vnW((wx + gx*FLOW_WARP)/BIOME_F, (wy + gy*FLOW_WARP)/BIOME_F, 131);
      const flow = 1 - Math.abs(nf*2 - 1);
      if(ex){
        exploreVertexColor(pal, wx, wy, h, gx, gy, nb, nm, flow, exw, (d/3)*4);
        col[d] = _c.r; col[d+1] = _c.g; col[d+2] = _c.b;
        computed++;
        continue;
      }
      _c.lerp(_cTmp.copy(_cGravel), sstep(0.42, 0.72, nb) * vGravel);
      _c.lerp(_cTmp.copy(_cScrub), sstep(0.40, 0.70, nm) * (1 - slope*0.8) * vScrub);
      // 筋は暗く沈める + 全体をわずかにばらつかせて、のっぺりした面を作らない
      const jit = (ih(Math.floor(wx*0.02), Math.floor(wy*0.02)) - 0.5) * vJit;
      _c.multiplyScalar(1 - flow*flow*vFlow*0.75 + (nb-0.5)*0.26 + (nm-0.5)*0.10 + jit);
      _c.lerp(_cTmp.copy(_cSteep), slope);   // 急斜面はむき出しの岩肌
      col[d] = _c.r; col[d+1] = _c.g; col[d+2] = _c.b;
      computed++;
    }
  }
  terrainPos.needsUpdate = true;
  terrainCol.needsUpdate = true;
  terrainNrm.needsUpdate = true;
  if(ex){
    terrainExW.needsUpdate = true;
    const ox = sx / DETAIL_TILE, oy = -sy / DETAIL_TILE;
    exMaps.lum.offset.set(ox, oy); exMaps.tint.offset.set(ox, oy);
    exMaps.nA.offset.set(ox, oy);  exMaps.nB.offset.set(ox, oy);
  }
  terrain.position.set(sx, 0, sy);
  // テクスチャの模様をワールドに固定する。これをしないとパッチと一緒に模様が動き、
  // 地面の上を滑っているように見えてしまう(uv.yは回転で反転しているので符号が逆)。
  // ②遠景マクロは vMapUv から作るので、この4枚を直せば一緒に付いてくる
  if(groundMaps){
    const ox = sx / DETAIL_TILE, oy = -sy / DETAIL_TILE;
    groundMaps.map.offset.set(ox, oy);
    groundMaps.normalMap.offset.set(ox, oy);
    groundMaps.roughnessMap.offset.set(ox, oy);
    groundMaps.aoMap.offset.set(ox, oy);
  }
  lastPatchVerts = computed;
  lastPatchMs = performance.now() - t0;
  patchRebuilds++;
}

/* マップが変わったときに、地面の色とテクスチャをそのテーマへ差し替える。
   地形メッシュそのものは使い回し、色(頂点カラー)とテクスチャだけ作り直す。   */
export function applyTerrainTheme(){
  const theme = R3.theme;
  _cLow.setHex(theme.low); _cHigh.setHex(theme.high); _cSteep.setHex(theme.steep);
  _cGravel.setHex(theme.gravel); _cScrub.setHex(theme.scrub);
  const st = TEX_STYLES[theme.tex] || TEX_STYLES.dry;
  vert = st.vert;
  /* 探検フィールドは材質ごと差し替える(通常の材質 stdMat には触らないので、
     他のマップへ戻ったときは元の見た目のまま)。 */
  if(terrain && isExplore()){
    if(!exMat) exMat = buildExploreMaterial();
    if(!terrainExW){
      terrainExW = new THREE.Float32BufferAttribute(new Float32Array(terrainPos.count*4), 4);
      terrain.geometry.setAttribute('aExW', terrainExW);
    }
    groundMaps = exMaps.compat;       // 障害物の色の基準・濡れた砂はこの形で地面を読む
    macroUniforms.uMacroMap.value = groundMaps.macroMap;
    terrain.material = exMat;
    resetPatch();
    return;
  }
  if(terrain && stdMat && terrain.material !== stdMat) terrain.material = stdMat;
  if(terrain){
    groundMaps = groundMapsFor(theme.tex);
    macroUniforms.uMacroMap.value = groundMaps.macroMap;
    macroUniforms.uMidRef.value = groundMaps.midRef;
    const mt = terrain.material;
    mt.map = groundMaps.map;
    mt.normalMap = groundMaps.normalMap;
    mt.roughnessMap = groundMaps.roughnessMap;
    mt.aoMap = groundMaps.aoMap;
    mt.normalScale.set(theme.bump*NORMAL_GAIN, theme.bump*NORMAL_GAIN);
    mt.needsUpdate = true;
  }
  resetPatch();   // 頂点カラーを塗り直させる
}

/* 探検フィールドの頂点色。地域ごとに「その地域の色で、通常と同じ塗り方」をして重みで混ぜる。
   ノイズ(nb/nm/flow)は地域をまたいで共通なので、境目で模様が切れない。
   結果は _c に入れ、地域の重み(テクスチャの混ぜ具合)を exw[o..o+3] へ書く。 */
/* 岩と雪は画素で塗る(近景=EX_MAP_CHUNK / 遠景=buildFarTerrain)。ここでは下地の色だけを作り、
   その場の地域の岩の色と雪の高さを _exSteep / _exSnowAlt に置く(遠景が頂点属性にする) */
const _exSteep = new THREE.Color();
let _exSnowAlt = 9000;
function exploreVertexColor(pal, wx, wy, h, gx, gy, nb, nm, flow, exw, o){
  const w = exploreWeights(wx, wy);
  const jit0 = ih(Math.floor(wx*0.02), Math.floor(wy*0.02)) - 0.5;
  const gm = Math.hypot(gx, gy);
  // 探検フィールドは尾根・崖が高く急なので、岩肌になる傾きを通常より高く取る
  const rockK = sstep(0.42, 1.05, gm);
  const t = clamp01((h + 240) / 700);
  _c.setRGB(0, 0, 0);
  _exSteep.setRGB(0, 0, 0); _exSnowAlt = 0;
  for(let r=0;r<5;r++){
    const k = w[r];
    if(k < 0.002) continue;
    const P = pal[r], V = P.vert;
    _cTmp.copy(P.low).lerp(P.high, t);
    _cTmp.lerp(P.gravel, sstep(0.42, 0.72, nb) * V.gravel);
    _cTmp.lerp(P.scrub, sstep(0.40, 0.70, nm) * (1 - rockK) * V.scrub);
    _cTmp.multiplyScalar(1 - flow*flow*V.flow*0.75 + (nb-0.5)*0.26 + (nm-0.5)*0.10 + jit0*V.jitter);
    // 草が茂っている色(草の株が途切れた先の遠くの地面も、茂った色に見えるように)
    if(P.grassK > 0) _cTmp.lerp(P.grass, P.grassK*(1 - rockK)*(0.55 + 0.45*nm));
    // 岩肌。地層の縞(高さで明暗)を乗せる
    // 岩肌の色(地層の縞つき)と雪の高さは、画素で塗るほうへ渡す(頂点で塗るとノコギリ歯になる)
    _cRock.copy(P.steep).multiplyScalar(1 + P.strata*(0.20*Math.sin(h*0.055 + nb*4) + 0.08*Math.sin(h*0.17)));
    _exSteep.r += _cRock.r*k; _exSteep.g += _cRock.g*k; _exSteep.b += _cRock.b*k;
    _exSnowAlt += Math.min(9000, P.snowAlt)*k;
    _c.r += _cTmp.r*k; _c.g += _cTmp.g*k; _c.b += _cTmp.b*k;
  }
  /* 遠景(地形パッチの外)の高い山は方角(地域)で塗り分ける。全方位が同じ白い雪山に見えた。
     火山の側=黒い玄武岩に下から赤い照り返し / 密林の側=森に覆われた緑。雪は凍った高地(と草原の頂)だけ */
  if(!exw && h > 250){
    const k = sstep(250, 750, h);
    if(w[2] > 0.01){
      _cTmp.copy(pal.basalt).multiplyScalar(0.85 + 0.3*nb).lerp(pal.ember, (1 - sstep(300, 1100, h))*0.55);
      _c.lerp(_cTmp, k*w[2]);
    }
    if(w[3] > 0.01){
      _cTmp.copy(pal.forest).multiplyScalar(0.8 + 0.4*nm);
      _c.lerp(_cTmp, k*w[3]*(1 - 0.5*sstep(1.0, 1.8, gm)));
    }
  }
  // 踏み分け道: 草が剥げて土が出た帯(緩斜面だけ。急斜面は岩肌のまま)
  const tr = exploreTrail(wx, wy);
  if(tr > 0){
    const k = tr * 0.72 * (1 - rockK);
    _cTmp.copy(pal.trail).multiplyScalar(0.92 + (nm-0.5)*0.3);
    _c.lerp(_cTmp, k);
  }
  if(exw){ exw[o] = w[0] + w[4]; exw[o+1] = w[1]; exw[o+2] = w[2]; exw[o+3] = w[3]; }
}
const _cRock = new THREE.Color();

/* =====================================================================
   探検フィールドの遠景地形(マップ全体+外側の縁の山を1枚・描画1回)
   地形パッチ(プレイヤーのまわり7200四方)の外を埋める。これが無いと約3.6km先で地面が途切れ、
   白い霞の上に山が浮いて見えた(批評家の指摘)。高さと色はパッチと同じ関数から作る。
   パッチと重なる内側は断片シェーダーで捨てる(二重に描いてちらつかせない)。
   ===================================================================== */
const FAR_ORG = -9000, FAR_SIZE = 36100, FAR_SEGS = 144;
let farMesh = null;
const farUni = { uPatch:{ value:new THREE.Vector3(0, 0, 0) } };
export function buildFarTerrain(){
  if(farMesh){ farMesh.geometry.dispose(); }
  const pal = explorePalette();
  const geo = new THREE.PlaneGeometry(FAR_SIZE, FAR_SIZE, FAR_SEGS, FAR_SEGS);
  geo.rotateX(-Math.PI/2);
  geo.translate(FAR_ORG + FAR_SIZE/2, 0, FAR_ORG + FAR_SIZE/2);
  const pos = geo.attributes.position, n = pos.count;
  const col = new Float32Array(n*3), nor = geo.attributes.normal;
  const stp = new Float32Array(n*4);   // 岩の色(rgb)と雪の高さ(a)
  for(let i=0;i<n;i++){
    const wx = pos.getX(i), wy = pos.getZ(i);
    const g = window.real3dHeightGrad ? window.real3dHeightGrad(wx, wy) : { h:heightAt(wx, wy), gx:0, gy:0 };
    const h = g.h, gx = g.gx, gy = g.gy;
    pos.setY(i, h);
    const inv = 1/Math.hypot(gx, 1, gy);
    nor.setXYZ(i, -gx*inv, inv, -gy*inv);
    const nb = fbmW(wx/BIOME_L, wy/BIOME_L, 2, 3);
    const nm = fbmW(wx/BIOME_M + 11.3, wy/BIOME_M - 7.1, 2, 71);
    exploreVertexColor(pal, wx, wy, h, gx, gy, nb, nm, 0.3, null, 0);
    // 近景は地面テクスチャ(明るさ0.6前後)が掛かるので、遠景の色もその分だけ落としてそろえる
    col[i*3] = _c.r*0.62; col[i*3+1] = _c.g*0.62; col[i*3+2] = _c.b*0.62;
    stp[i*4] = _exSteep.r*0.62; stp[i*4+1] = _exSteep.g*0.62; stp[i*4+2] = _exSteep.b*0.62; stp[i*4+3] = _exSnowAlt;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aFarRock', new THREE.Float32BufferAttribute(stp, 4));
  const mat = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.96, metalness:0,
                                               envMapIntensity:ENV_INTENSITY, polygonOffset:true,
                                               polygonOffsetFactor:2, polygonOffsetUnits:4 });
  const ex = buildExploreMaps();
  mat.onBeforeCompile = (sh)=>{
    sh.uniforms.uPatch = farUni.uPatch;
    sh.uniforms.uFarMacro = { value: ex.macro };
    sh.uniforms.uFarSnow = { value: pal.snow.clone().multiplyScalar(0.62) };
    sh.vertexShader = 'attribute vec4 aFarRock;\nvarying vec4 vFarRock;\nvarying vec3 vFarW;\nvarying vec3 vFarN;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n  vFarW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vFarN = normalize(mat3(modelMatrix) * objectNormal);\n  vFarRock = aFarRock;');
    sh.fragmentShader = 'uniform vec3 uPatch;\nuniform sampler2D uFarMacro;\nuniform vec3 uFarSnow;\nvarying vec3 vFarW;\nvarying vec3 vFarN;\nvarying vec4 vFarRock;\n' + sh.fragmentShader
      .replace('#include <clipping_planes_fragment>', [
        '#include <clipping_planes_fragment>',
        'if(abs(vFarW.x - uPatch.x) < uPatch.z && abs(vFarW.z - uPatch.y) < uPatch.z) discard;',
      ].join('\n'))
      .replace('#include <color_fragment>', [
        '#include <color_fragment>',
        'diffuseColor.rgb *= mix(vec3(1.0), texture2D(uFarMacro, vFarW.xz / 2400.0).rgb * 2.0, 0.55);',
        // 近景(EX_MAP_CHUNK)と同じ決め方(しきい値も同じ値。両方直す)。傾き+2段のノイズで岩と雪の境目を揺らす
        'float fNzLo = texture2D(uFarMacro, vFarW.xz * 0.00085).r - 0.5;',
        'float fNzHi = texture2D(uFarMacro, vFarW.xz * 0.0052 + 11.0).r - 0.5;',
        'float fNz = fNzLo*0.7 + fNzHi*0.3;',
        'float fSl = 1.0 - clamp(normalize(vFarN).y, 0.0, 1.0);',
        'float fBand = 0.90 + 0.10*sin(vFarW.y*0.058 + fNzLo*5.0) * (0.4 + 0.6*fNzHi);',
        'diffuseColor.rgb = mix(diffuseColor.rgb, vFarRock.rgb * fBand, smoothstep(0.38, 0.78, fSl + fNz*0.14));',
        'float fSn = smoothstep(vFarRock.a - 260.0, vFarRock.a + 520.0, vFarW.y + fNz*640.0) * (1.0 - smoothstep(0.30, 0.68, fSl + fNz*0.20));',
        'diffuseColor.rgb = mix(diffuseColor.rgb, uFarSnow, fSn);',
      ].join('\n'));
  };
  mat.customProgramCacheKey = ()=> 'aramonFarTerrain';
  farMesh = new THREE.Mesh(geo, mat);
  farMesh.frustumCulled = false;
  farMesh.receiveShadow = false;
  farMesh.castShadow = false;
  farMesh.renderOrder = -0.5;
  return farMesh;
}
// 遠景地形が捨てる範囲(=いま地形パッチが覆っている四角)を毎フレーム渡す
export function syncFarTerrain(){
  if(patchCX == null) return;
  farUni.uPatch.value.set(patchCX, patchCY, PATCH_SIZE/2 - 120);
}
