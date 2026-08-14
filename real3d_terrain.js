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

   【最重要・凹凸に出っ張りを入れない】(2026-08-13の不具合対応)
     このゲームの岩(3Dモデル)は**すべて当たり判定のある遮蔽物**で、プレイヤーは
     「隠れられる岩」と「素通りできる地面の模様」を一目で見分けられなければならない。
     地面テクスチャの小石をドーム状に陰影付けしたところ、本物の岩と区別が付かなくなった。
     そこで凹凸(out[2])の決まりを次のようにする:

       **out[2] に入れてよいのは「へこみ」だけ。出っ張る粒は色(out[0]/out[1])だけで描く。**

     ・ひび割れ・気泡の穴・風紋の谷・落ち葉の隙間 = へこみ → 凹凸に入れてよい
     ・小石・砂利・葉の粒 = 出っ張り → **凹凸に入れない。** 平らな染み(色のムラ)として描く
     情報量は色で保つ。粒ごとに明るさと色みを変えれば、立体でなくても地面は賑やかになる。
     仕上げに RELIEF_PEAK で「平均より上」を機械的に潰すので、新しいスタイルを足しても
     出っ張りが復活しない(スタイル側の書き忘れに対する保険)。
     ② 遠景マクロ(MACRO_TILE=数十メートル)
        地面全体の大きな濃淡・涸れ沢の筋。①の繰り返しを打ち消し、遠くの地面が
        一色に潰れるのを防ぐ。シェーダーで①に掛ける(下の MACRO_CHUNK)。
     ③ 頂点カラー(頂点間隔50単位)
        高さ・傾き・場所ごとの土質。①②の中間〜大きい模様を担当する。
   ===================================================================== */
import * as THREE from './vendor/three.module.min.js';
import { R3, DEFAULT_THEME, ENV_INTENSITY, heightAt, makeTexture } from './real3d_common.js';

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
const MID_AMT     = 0.45;        // ①を4.7倍に伸ばして重ねる量(タイルの繰り返し消し)
// 高さ場のうち「平均より上(=出っ張り)」を残す割合。1.0で従来どおり、0で完全に平ら。
// 地面の模様が本物の岩に見えないよう、出っ張りだけを潰す(へこみは等倍で残す)。
const RELIEF_PEAK = 0.42;

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
       out[0] 明るさ(0.8前後が「テーマ色そのまま」)
       out[1] 色み(+でtintA方向 / -でtintB方向。土の赤茶⇔苔の緑など)
       out[2] 細かい高さ(0〜1目安)。法線・粗さ・AOはここから作る
   ・relief 法線に焼く凹凸の強さ / rough 粗さの下限・上限
   ・tintA/tintB 色みのRGB方向 / macro 遠景マクロの強さ
   ・vert 頂点カラーの効き(砂利・低木・流れた跡・ざらつき)
   make() は表を1回だけ作ってから field を返す(画素ごとの表引きを避ける)。
   ===================================================================== */
const TAU = Math.PI*2;
const TEX_STYLES = {
  // 乾いた荒れ地: 砂利まじりの土に、細いひび割れが走る
  dry: {
    relief:1.30, rough:[0.62,0.98],
    tintA:[ 0.16, 0.05,-0.14], tintB:[-0.10,-0.02, 0.10],
    macro:{ amp:0.76, ridge:0.44, tint:0.20 },
    vert:{ gravel:0.62, scrub:0.52, flow:0.36, jitter:0.06 },
    make(){
      const tc = wtable(20,20, 3), tp = wtable(34,24, 11);
      const c = [0,0,0], p = [0,0,0];
      return (u,v,px,py,out)=>{
        const wu = fbmT(u,v,8,8,2,71) - 0.5, wv = fbmT(u,v,8,8,2,73) - 0.5;
        const soil = fbmT(u, v, 14, 14, 3, 5);
        worley(u*20 + wu*1.6, v*20 + wv*1.6, 20, 20, tc, c);
        // 砂利のセルは縦横で数を変えて細長くする。真円の染みは「上から見た小石」に
        // 見えてしまうので、わざと歪ませる
        worley(u*34 + wu*2.6, v*24 + wv*1.9, 34, 24, tp, p);
        // ひび割れは細く、セルごとに濃さを変える。薄い割れ目は消えて多角形が繋がるので、
        // 大きさの揃った「蛇の皮」に見えなくなる
        const cid = ih(c[2]+13, 19);
        const crack = (1 - sstep(0.0, 0.038 + cid*0.045, c[1]-c[0])) * (0.10 + soil*1.1) * cid;
        const pid = ih(p[2]+31, 9);
        // 砂利は「立体の粒」ではなく「平らな染み」。セルの中を一様に塗り、縁は細くぼかすだけ。
        // ドーム状に陰影を付けると本物の岩と見分けが付かない(2026-08-13の不具合)。
        // 大きさ・明るさ・色みを1つずつ変えるので、平らでも水玉模様にはならない。
        const on = pid > 0.40 ? 1 : 0;
        const rad = 0.20 + pid*0.34;
        const grit = (1 - sstep(rad-0.035, rad, p[0])) * on;
        const gv = ih(p[2]+77, 41) - 0.5;         // その染めの明暗(セルごとに一定)
        const g = ih(px*3+1, py*7+2);
        // 数画素まとめた平らな斑点。細かい情報量を足すが、明るさではなく色みで出す
        const fl = ih((px>>1)*2+53, (py>>1)*2+29) - 0.5;
        // 明暗の差は控えめに、色みの差は大きく取る。明暗を付けると「光が当たった球」に
        // 見えてしまうが、色みだけなら鉱物の染みに見える
        // ひび割れで区切られた板ごとに土の焼け方を変える(平らなまま情報量を足す)
        out[0] = 0.80 + (soil-0.5)*0.24 + grit*gv*0.19 - crack*0.15 + (cid-0.5)*0.07 + (g-0.5)*0.12;
        out[1] = (soil-0.5)*0.8 + grit*(pid-0.5)*2.1 + (cid-0.5)*0.55 + fl*0.30;
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
      const tc = wtable(13,13, 21), tv = wtable(46,46, 31);
      const c = [0,0,0], p = [0,0,0];
      return (u,v,px,py,out)=>{
        const wu = fbmT(u,v,8,8,2,71) - 0.5, wv = fbmT(u,v,8,8,2,73) - 0.5;
        const ash = fbmT(u, v, 12, 12, 3, 17);
        worley(u*13 + wu*1.8, v*13 + wv*1.8, 13, 13, tc, c);
        worley(u*46 + wu*3.2, v*46 + wv*3.2, 46, 46, tv, p);
        const crack = 1 - sstep(0.0, 0.10, c[1]-c[0]);   // 岩板の割れ目(太い)
        const cid = ih(c[2]+5, 23);                      // 板ごとに焼け方を変える
        // 気泡の穴は「へこみ」なので凹凸に入れてよい。縁を立てない形にする
        const pit = sstep(0.34, 0.06, p[0]) * (ih(p[2]+3, 29) > 0.30 ? 1 : 0);
        const g = ih(px*5+7, py*3+11);
        // 板ごとの焼け方(cid)は色だけ。凹凸へ入れると板が持ち上がって「転がった岩」に見える
        out[0] = 0.76 + (ash-0.5)*0.26 + (cid-0.5)*0.19 - crack*0.26 - pit*0.18 + (g-0.5)*0.15;
        out[1] = (ash-0.5)*1.0 + (cid-0.5)*0.7 - crack*0.4;
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
      const tp = wtable(36,36, 41);
      const p = [0,0,0];
      return (u,v,px,py,out)=>{
        const wu = fbmT(u,v,8,8,2,71) - 0.5, wv = fbmT(u,v,8,8,2,73) - 0.5;
        // 風紋は風上がゆるく風下が急。sinをそのまま使わず、べき乗で非対称にする
        const big = Math.sin((u*5 + v*2)*TAU + fbmT(u,v,4,4,2,23)*4.0)*0.5+0.5;
        // 大きなうねりの風上側だけ風紋が濃く出る(全面を同じ縞で埋めない)
        const ripA = 0.35 + big*1.05;
        const rip = Math.pow(Math.sin((u*32 + v*13)*TAU + fbmT(u,v,5,5,3,9)*9.0)*0.5+0.5, 1.7) * ripA;
        worley(u*36 + wu*2.2, v*36 + wv*2.2, 36, 36, tp, p);
        const pid = ih(p[2]+5, 13);
        // 砂に混じる貝殻・小石も平らな染みにする(砂は本物の岩が最も見分けにくい地面)
        const rad = 0.14 + pid*0.16;
        const grit = (1 - sstep(rad-0.03, rad, p[0])) * (pid > 0.80 ? 1 : 0);
        const g = ih(px*5+3, py*3+9);
        out[0] = 0.86 + (rip-0.45)*0.13 + (big-0.5)*0.055 + (g-0.5)*0.08 + grit*0.07;
        out[1] = (big-0.5)*0.7 + (rip-0.5)*0.35 + grit*0.8;
        // 風紋と大きなうねりだけ。粒は凹凸に入れない
        out[2] = rip*0.80 + big*0.28 + g*0.13;
      };
    },
  },
  // 雪原: 風で伸びた吹きだまりとサスツルギ(硬い雪の筋)。ひび割れは絶対に作らない
  snow: {
    relief:0.80, rough:[0.30,0.72],
    tintA:[ 0.10, 0.04,-0.06], tintB:[-0.15,-0.05, 0.16],
    macro:{ amp:0.62, ridge:0.36, tint:0.26 },
    vert:{ gravel:0.62, scrub:0.46, flow:0.34, jitter:0.04 },
    make(){
      return (u,v,px,py,out)=>{
        const drift = fbmT(u, v, 20, 5, 3, 3);                  // 風向きに伸びた吹きだまり
        const sast = 1 - Math.abs(fbmT(u, v, 30, 8, 2, 19)*2 - 1);
        const edge = sstep(0.58, 0.70, sast);                   // 風に削られた段差
        const g = ih(px*7+5, py*11+3);
        const spark = g > 0.9885 ? 1 : 0;                       // 雪面のきらめき
        out[0] = 0.82 + (drift-0.5)*0.17 + sast*0.06 + edge*0.08 + spark*0.12 + (g-0.5)*0.04;
        out[1] = -(drift-0.5)*1.3 - sast*0.35;                  // 窪みは青く沈む
        out[2] = drift*0.80 + sast*0.35 + edge*0.25;
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
      const tl = wtable(30,20, 51), tm = wtable(7,7, 61);
      const l = [0,0,0], m = [0,0,0];
      return (u,v,px,py,out)=>{
        const wu = fbmT(u,v,8,8,2,71) - 0.5, wv = fbmT(u,v,8,8,2,73) - 0.5;
        const moss = fbmT(u, v, 12, 12, 3, 27);
        // 落ち葉は一面に散らさず「たまり場」を作る。空いた所は腐葉土と苔になる
        worley(u*7 + wu*0.8, v*7 + wv*0.8, 7, 7, tm, m);
        const pile = clamp01((ih(m[2]+41, 11) - 0.30)*1.7) * (1 - m[0]*0.55);
        // セルを縦横で違う数にすると細長くなる = 丸い水玉ではなく落ち葉に見える
        worley(u*30 + wu*2.6, v*20 + wv*1.7, 30, 20, tl, l);
        const lid = ih(l[2]+7, 3);
        // 落ち葉は地面に伏せている。輪郭ははっきり出すが、盛り上げない(平らな染め)
        const rad = 0.13 + lid*0.55;
        const leaf = (1 - sstep(rad-0.04, rad, l[0])) * (lid > 1 - pile ? 1 : 0);
        const g = ih(px*3+13, py*5+1);
        out[0] = 0.90 + (moss-0.5)*0.24 + leaf*(0.10 + lid*0.16) - (1-leaf)*0.08 + (g-0.5)*0.13;
        out[1] = leaf*(0.35 + lid*1.2) - (1-leaf)*(0.45 + moss*0.55);
        // 葉の隙間(へこみ)と苔のうねりだけ。葉そのものは凹凸に入れない
        out[2] = moss*0.32 - (1-leaf)*0.16 + g*0.14;
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

  const A = st.tintA, B = st.tintB;
  let midSum = 0;
  const map = makeTexture(S, (d)=>{
    for(let i=0;i<N;i++){
      const L = lum[i], w = warm[i];
      const t = w > 0 ? A : B, aw = w > 0 ? w : -w;
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
        const n  = fbmT(wu, wv, 3, 3, 4, 101);
        const rg = 1 - Math.abs(fbmT(wu, wv, 6, 6, 3, 211)*2 - 1);
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
   uMidRef はそのテクスチャの平均輝度の逆数。掛けても全体の明るさが変わらない。 */
const MACRO_CHUNK = `
#ifdef USE_MAP
  vec2 mUv = vec2( vMapUv.x*0.7648 - vMapUv.y*0.6442, vMapUv.x*0.6442 + vMapUv.y*0.7648 ) * uMacroScale;
  diffuseColor.rgb *= mix( vec3(1.0), texture2D( uMacroMap, mUv ).rgb * 2.0, uMacroAmt );
  // マクロをさらに3倍へ引き伸ばした層。1万単位近い「地域差」になり、霞の手前まで
  // 濃淡が残る(これが無いと遠くの地面が一色の海になる)
  vec2 m2Uv = vec2( vMapUv.x*0.4067 + vMapUv.y*0.9135, vMapUv.y*0.4067 - vMapUv.x*0.9135 ) * uMacroScale * 0.31;
  diffuseColor.rgb *= mix( vec3(1.0), texture2D( uMacroMap, m2Uv ).rgb * 2.0, uMacroAmt2 );
  vec2 dUv = vec2( vMapUv.x*0.9135 + vMapUv.y*0.4068, vMapUv.y*0.9135 - vMapUv.x*0.4068 ) * uMidScale;
  float dL = dot( texture2D( map, dUv ).rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) * uMidRef;
  diffuseColor.rgb *= mix( 1.0, dL, uMidAmt );
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

export function buildTerrain(){
  // 平面を作ってからX-Z平面へ倒す。頂点の高さ(y)は毎回 updateTerrain で書き換える
  const geo = new THREE.PlaneGeometry(PATCH_SIZE, PATCH_SIZE, PATCH_SEGS, PATCH_SEGS);
  geo.rotateX(-Math.PI/2);
  const n = geo.attributes.position.count;
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n*3), 3));
  // UVはパッチのローカル座標そのままなので、repeatで「何単位に1回」貼るかを決める。
  // パッチ位置はCELLの倍数にスナップして動かすため、模様がワールドに固定されて見える。
  groundMaps = groundMapsFor(R3.theme.tex);
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
  if(reuse){ scratchPos.set(pos); scratchCol.set(col); scratchNrm.set(nrm); }
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
