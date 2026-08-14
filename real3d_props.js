/* =====================================================================
   リアルマップ: 立体物(山 と 障害物)と 植生(草・低木)

   ・山(火山/雪山/森/ピラミッド)は2Dの drawSolidCone と同じ寸法の円錐。
     色は「形 + 頂点カラー」で作る。画面に貼る円で演出しない(視点を変えると浮く)
   ・障害物(岩・木・水晶)は種類ごとの InstancedMesh。形の定義(全高・埋める深さ・
     2Dでくり抜く輪郭)は data.js の OBST_SHAPES 1か所を両方が読む
   ・植生(草・低木)は当たり判定を持たない飾り。障害物と同じく InstancedMesh で、
     プレイヤーのまわりだけに生やす。テーマ色から作るのでマップごとに勝手に変わる

   【当たり判定の寸法は動かせない】障害物の半径・全高(OBST_SHAPES)は render.js の
   2Dくり抜きと共有しているので、モデルは必ず「半径1・全高h」の枠に収める。
   枠より外へはみ出すと、その部分だけ奥のモンスターが障害物を透かして見えてしまう。
   そのため形を作ったら最後に fitBounds() で枠へ合わせる。
   ===================================================================== */
import * as THREE from './vendor/three.module.min.js';
import { R3, DEFAULT_THEME, ENV_INTENSITY, SUN_DIR, heightAt, hash2, tileNoise, fbmTile, makeTexture, mergeGeos } from './real3d_common.js';
import { getGroundMaps, getTerrain } from './real3d_terrain.js';
import { lavaMats } from './real3d_water.js';

/* ---------------------------------------------------------------------
   このファイルの中だけで使う小道具
   (共通ヘルパーは real3d_common.js を触らずここへ置く。他の担当と衝突しないため)
   --------------------------------------------------------------------- */

// テーマ色を THREE.Color で取り出す。テーマに無ければ既定テーマ(荒野)へ落とす
function themeColor(key){
  const t = R3.theme || DEFAULT_THEME;
  const v = (t[key] != null) ? t[key] : DEFAULT_THEME[key];
  return new THREE.Color(v);
}
function mixColor(a, b, k){ return a.clone().lerp(b, k); }

/* 樹皮の色。テーマ色だけで作ると寒色のマップで幹が灰色になり「木」に見えないので、
   木材の色を芯にして、そこへテーマの岩肌色を混ぜて場に馴染ませる。
   (決め打ちの色ではなく「木材色 + その場の色」という作り方にしてある)      */
const WOOD_CORE = new THREE.Color(0x6b5236);

/* テーマ色をそのまま使うと、暗いマップ(ジャングル・火山)で岩や葉が真っ黒に潰れる。
   色みは保ったまま明るさだけ下限へ持ち上げる。値はリニア色空間なので小さめの数字。 */
function liftColor(c, minLum){
  const l = c.r*0.30 + c.g*0.60 + c.b*0.10;
  if(l >= minLum || l <= 0.0001) return c;
  return c.multiplyScalar(minLum / l);
}
function barkColor(k){
  return mixColor(WOOD_CORE, themeColor('steep'), k == null ? 0.34 : k);
}
// 針葉樹の葉も同じ考え方。雪原のテーマ色だけで作ると白い三角形にしかならない
const NEEDLE_CORE = new THREE.Color(0x2f4a24);
/* プロップ自身の「色の個性」の芯。テーマ色だけで作ると、砂漠のサボテンが
   砂と同じ白ベージュの棒に、雪原の氷結晶がただの白い塊になり、
   遮蔽物かどうかがプレイ中に読めなくなる。色は決め打ちにせず、
   この芯へその場のテーマ色を混ぜて馴染ませる(混ぜ具合が k)。            */
const CACTUS_CORE = new THREE.Color(0x4c8f36);   // サボテンの緑
const ICE_CORE    = new THREE.Color(0x35b4d6);   // 氷・水晶の水色
/* 人工物の色の芯。自然物と違って「人が塗った/組んだ物」に見せたいので、
   テーマ色そのままではなく工業製品の色を芯にして、そこへ場の色を混ぜる。 */
const CONTAINER_PAINT = new THREE.Color(0x3f6b74);   // 褪せた塗装(海運コンテナ)
const RUST_CORE       = new THREE.Color(0x8a4a24);   // 錆

/* 円周方向に継ぎ目の出ないノイズ。角度を spokes 個の格子へ写して tileNoise を回す。
   山の縦じわ(ガリー)や貝殻の筋など「ぐるっと1周する模様」に使う。 */
function angNoise(ang, v, spokes){
  const u = (ang / (Math.PI*2)) * spokes;
  return tileNoise(((u % spokes) + spokes) % spokes, v, spokes);
}
// 尾根状ノイズ(0付近に鋭い谷)。斜面の削れ(ガリー)を作るのに使う
function angRidge(ang, v, spokes){ return 1 - Math.abs(angNoise(ang, v, spokes)*2 - 1); }

/* 尾根状ノイズの多重フラクタル(1=尾根 0=谷)。
   1-|2n-1| を重ねると稜線が鋭く谷が深い「山の形」になる。次のオクターブの重みを
   その場の高さで決めるので、高い所だけがギザギザに、低い所はなだらかになる。
   遠景の山(real3d_sky.js の ridgeProfile)と同じ考え方で、近景の山も同じ山脈に見せる。 */
const RIDGE_OCT = 3;
function ridgedFbm(ang, v, seed){
  let sum = 0, amp = 1, tot = 0, w = 1, spokes = 9;
  for(let o=0;o<RIDGE_OCT;o++){
    let n = angNoise(ang + seed*(1 + o*0.63), v*(1 + o*1.5) + seed*(0.9 + o), spokes);
    n = 1 - Math.abs(n*2 - 1);
    n = n*n;                                  // 尖らせる。丸いと「うねる丘」にしかならない
    sum += n*amp*w;
    tot += amp;
    w = 0.35 + 0.65*Math.min(1, n*1.7);       // 尾根の上にだけ次の細かい起伏を乗せる
    amp *= 0.52;
    spokes *= 2;
  }
  return sum/tot;
}

const clamp01 = (x)=> x < 0 ? 0 : (x > 1 ? 1 : x);
const smoothBand = (a, b, x)=>{ const t = clamp01((x - a) / ((b - a) || 1e-6)); return t*t*(3 - 2*t); };

/* ---- 「地面と見分けが付く色」を作るための道具 ----
   色そのものは決め打ちにできない(マップごとにテーマ色が変わる)ので、
   「地面の色との差」だけを保証する。差が足りないときだけ明るさと鮮やかさを押し広げる。 */
function lumOf(c){ return c.r*0.30 + c.g*0.60 + c.b*0.10; }
// 灰色成分から離して鮮やかにする(k>1で彩度アップ)。負の値へ落ちないよう押し戻す
function saturate(c, k){
  const g = lumOf(c);
  c.setRGB(Math.max(0, g + (c.r-g)*k), Math.max(0, g + (c.g-g)*k), Math.max(0, g + (c.b-g)*k));
  return c;
}
/* 地面(ref)との明度差を最低 minRatio 倍だけ確保する。
   暗い側へ寄せられるなら暗く、地面が暗いマップでは明るい側へ逃がす。 */
function contrastTo(c, ref, minRatio){
  const lc = lumOf(c), lr = lumOf(ref);
  if(lc <= 1e-6 || lr <= 1e-6) return c;
  const ratio = lc / lr;
  if(ratio >= minRatio || ratio <= 1/minRatio) return c;
  // 地面が明るければ暗い側、暗ければ明るい側へ。行き先の遠いほうを選ぶ
  const goDark = (ratio < 1) || (lr > 0.10);
  return c.multiplyScalar(goDark ? (lr/minRatio)/lc : (lr*minRatio)/lc);
}

/* 地面の「見た目の色」。接地影の縁をこの色に合わせると、影の外周が地面へ溶けて
   円盤の輪郭が見えなくなる。
   【テーマ色から推測してはいけない】地面の色は「頂点カラー × 地面テクスチャ」で、
   頂点カラーには砂利・低木・傾きの混ざりが乗っている。テーマ色だけで組み立てると
   マップによって最大5倍もずれ、影が真っ黒の板や明るい輪になる(実測)。
   いま実際に張られている地形パッチの頂点カラーを間引いて平均し、
   テクスチャ側の平均輝度(real3d_terrain.js の midRef = 1/平均)を掛ける。   */
/* 地面テクスチャの平均色。midRef は輝度の平均しか持っていないので、
   色みまで合わせるためにキャンバスの画素から channel ごとの平均を取る
   (テーマごとに1回。テクスチャは real3d_terrain.js が使い回す)。          */
const _texAvg = new THREE.Color(1, 1, 1);
let texAvgKey = null;
const srgbLin = (v)=> v <= 0.04045 ? v/12.92 : Math.pow((v + 0.055)/1.055, 2.4);
function groundTexAverage(){
  const maps = getGroundMaps();
  const key = (R3.theme || DEFAULT_THEME).tex || '';
  if(texAvgKey === key) return _texAvg;
  if(!maps || !maps.map || !maps.map.image) return _texAvg;
  try{
    const img = maps.map.image;
    const g = img.getContext && img.getContext('2d');
    if(!g) return _texAvg;
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for(let i=0;i<d.length;i+=16){          // 4画素に1つで十分(低周波のばらつきしかない)
      r += srgbLin(d[i]/255); gg += srgbLin(d[i+1]/255); b += srgbLin(d[i+2]/255); n++;
    }
    if(n) _texAvg.setRGB(r/n, gg/n, b/n);
    texAvgKey = key;
  }catch(e){ /* 画素を読めない環境ではテクスチャを白として扱う */ }
  return _texAvg;
}

function groundRefColor(gain){
  const texAvg = groundTexAverage();
  const c = mixColor(themeColor('low'), themeColor('high'), 0.50).lerp(themeColor('gravel'), 0.20);
  const t = getTerrain();
  const geo = t && t.geometry;
  const ca = geo && geo.attributes.color, na = geo && geo.attributes.normal;
  if(ca && na && ca.count > 64){
    /* 【平らな所だけを見る】急斜面の頂点は岩肌色(steep)へ寄っていて、
       パッチ全体を平均すると起伏の多いマップ(ジャングル・溶岩台地)で
       実際の足元より何倍も暗い色になる。物が立っているのは平らな所なので、
       法線がほぼ真上の頂点だけを数える。                                   */
    let r = 0, g = 0, b = 0, n = 0;
    const step = Math.max(1, Math.floor(ca.count/900));
    for(let i=0;i<ca.count;i+=step){
      if(na.getY(i) < 0.965) continue;
      r += ca.getX(i); g += ca.getY(i); b += ca.getZ(i); n++;
    }
    if(n > 8 && r + g + b > 1e-4) c.setRGB(r/n, g/n, b/n);
  }
  c.setRGB(c.r*texAvg.r, c.g*texAvg.g, c.b*texAvg.b);
  return c.multiplyScalar(gain == null ? 1 : gain);
}

/* プロップの色を「芯の色 + その場のテーマ色」から作り、地面との差を保証する。
   core=そのプロップの個性の色 / k=テーマ色を混ぜる強さ / sat=鮮やかさ / diff=地面との明度比 */
function plantColor(core, k, sat, diff){
  const themed = mixColor(themeColor('scrub'), themeColor('low'), 0.40);
  const c = liftColor(mixColor(core, themed, k), 0.075);
  saturate(c, sat);
  return contrastTo(c, groundRefColor(), diff);
}
// 氷・水晶。空の色をまとわせつつ、雪や砂の地面より必ず濃く出す
function crystalColor(){
  const c = mixColor(ICE_CORE, mixColor(themeColor('skyTop'), themeColor('skyBot'), 0.55), 0.42);
  saturate(c, 1.45);
  return contrastTo(liftColor(c, 0.060), groundRefColor(), 1.75);
}
/* 遮蔽になる大きな岩の色。**リアルマップに出る岩は全部これ**(飾りの小石は撒かない)。「隠れられる物」として
   一目で読める必要があるので、地面との明度差を最低 COVER_DIFF 倍だけ確保する。
   【1.42では足りない】雪原(パパス)のように地面が真っ白なマップでは、1.42倍だと
   岩が「白い地面の上の少し白い染み」にしかならず、平らな模様に見えると
   実機で report された(2026-08-14)。明るい地面ほど差が要る。          */
const COVER_DIFF = 1.85;
function coverRock(c, k){
  saturate(c, 1.12);
  return contrastTo(c, groundRefColor(), COVER_DIFF).multiplyScalar(k == null ? 1 : k);
}

/* ---- 接地影(コンタクトシャドウ) ----
   太陽高度が約38度と高いうえ影の解像度も限られるため、草のような小さい物が
   落とす影は画面上で数画素にしかならず、実質「影が無い」= 物が地面に浮いて見える。
   そこでシャドウマップに頼らず、足元へ「下にあるものを暗くするだけの円盤」を敷く。

   【なぜ乗算合成の専用メッシュなのか】
   最初はモデル本体へ円盤を溶接して描画命令を1つも増やさない作りにした。しかし
   その円盤は「地面と同じ色」で塗らないと外周が輪になって見える。ところが地面は
   MeshStandard(空の環境マップ)、植生は MeshLambert(擬似アンビエント)で
   受ける間接光がまるで違い、暗いマップでは地面のほうが3〜4.5倍明るく出る(実測)。
   色を合わせること自体が不可能なので、「下にあるものを暗くするだけ」の乗算合成に
   切り替えた。これなら地面が何色でも必ず溶ける。
   メッシュは層ごとに1つだけ(草/低木/障害物の計3つ)なので、
   物がいくつ並んでも描画命令は増えない。                                       */
const srgbToLin = (v)=> v <= 0.04045 ? v/12.92 : Math.pow((v + 0.055)/1.055, 2.4);

/* 半径1・y=0の影の円盤。頂点カラーは色ではなく「画面の明るさの倍率」。
   中心ほど暗く、縁はちょうど1(=何もしない)なので境目が出ない。
   縁の半径をばらつかせて、決め打ちの円に見えないようにする。
   rings=1 で三角形n枚の一番安い形、2 で内側に濃い部分を持つ形。
   【要注意】innerR(濃い部分の広さ)は「物の足元の太さ」より広く取ること。
   狭いと濃い所がまるごと物の下に隠れ、外へ出るのは薄い縁だけになって
   影がほとんど見えなくなる(岩でこれを踏んだ)。                            */
function shadowDiscGeo(segs, seed, core, mid, rings, innerR){
  const n = segs || 8;
  const pos = [], col = [];
  const cc = srgbToLin(core), cm = srgbToLin(mid == null ? (core + 1)/2 : mid);
  const rim = [];
  for(let i=0;i<n;i++) rim.push({ a:(i/n)*Math.PI*2 + seed*0.7,
                                  r: 0.80 + hash2(seed*3.1 + i*1.7, i*2.3)*0.40 });
  const push = (x, z, v)=>{ pos.push(x, 0, z); col.push(v, v, v); };
  const at = (p, k)=> [Math.cos(p.a)*p.r*k, Math.sin(p.a)*p.r*k];
  for(let i=0;i<n;i++){
    const p1 = rim[i], p2 = rim[(i+1)%n];
    const b1 = at(p1, 1), b2 = at(p2, 1);
    if(rings === 1){
      push(0, 0, cc); push(b1[0], b1[1], 1); push(b2[0], b2[1], 1);
      continue;
    }
    const a1 = at(p1, innerR == null ? 0.50 : innerR), a2 = at(p2, innerR == null ? 0.50 : innerR);
    push(0, 0, cc);          push(a1[0], a1[1], cm); push(a2[0], a2[1], cm);
    push(a1[0], a1[1], cm);  push(b1[0], b1[1], 1);  push(b2[0], b2[1], 1);
    push(a1[0], a1[1], cm);  push(b2[0], b2[1], 1);  push(a2[0], a2[1], cm);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

/* 影の材質。「色」ではなく「倍率」を書き込むので、
   ・トーンマッピングを通さない(通すと倍率が歪む)
   ・フォグを掛けない(霞の色を混ぜると影が明るい板になる)。遠くは頂点シェーダーで縮めて消す
   ・深度は書かない(重なっても乗算は順番に依存しないので並べ替えも要らない)        */
function shadowMaterial(fadeNear, fadeFar){
  const mat = new THREE.MeshBasicMaterial({
    vertexColors:true, transparent:true, blending:THREE.MultiplyBlending,
    depthWrite:false, fog:false, side:THREE.DoubleSide,
  });
  mat.toneMapped = false;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -4;
  applyWind(mat, 0, 0, fadeNear, fadeFar, null);
  return mat;
}

/* 塊のでこぼこ用。3方向の値ノイズを混ぜて「立体のまだら」にする。
   引数の座標は半径1の球面(-1〜1)なので、f は「球1個ぶんに何山のせるか」に近い。
   f を上げすぎると1面ごとにトゲが立って割れたガラスに見えるので、
   低い周波数へ大きな振幅、高い周波数へ小さな振幅を配る。                 */
function lumpNoise(x, y, z, f, seed){
  return tileNoise(x*f + seed*1.7, z*f + seed*2.9, 64)*0.55
       + tileNoise(y*f*1.13 + seed*3.7, x*f*0.91 + seed*5.1, 64)*0.45;
}

/* 作った形を「横半径 rMax・高さ y0〜y1」の枠へきっちり収める。
   当たり判定(半径)と2Dくり抜き(OBST_SHAPES)の寸法を絶対に超えないための最後の砦。 */
function fitBounds(geo, rMax, y0, y1){
  const pos = geo.attributes.position;
  let mr = 0, lo = Infinity, hi = -Infinity;
  for(let i=0;i<pos.count;i++){
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if(r > mr) mr = r;
    if(y < lo) lo = y;
    if(y > hi) hi = y;
  }
  const sx = rMax / (mr || 1), sy = (y1 - y0) / ((hi - lo) || 1);
  for(let i=0;i<pos.count;i++){
    pos.setXYZ(i, pos.getX(i)*sx, y0 + (pos.getY(i)-lo)*sy, pos.getZ(i)*sx);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/* 葉・草を「両面とも表」にする。
   THREE の DoubleSide は裏面で法線を反転させるので、薄い葉は裏から見た瞬間に
   真っ黒な板になる(草が黒いカードに見える原因)。面を複製して裏返し、
   両方を表として持たせたうえで法線を上向きへ寄せると、どちらから見ても
   地面と同じ光り方になって馴染む。upBlend=1 で完全に上向き。            */
function doubleSided(geo, upBlend){
  const front = geo.index ? geo.toNonIndexed() : geo;
  if(!front.attributes.normal) front.computeVertexNormals();
  const back = front.clone();
  const bp = back.attributes.position, bu = back.attributes.uv;
  const swap = (attr, i, j, n)=>{
    for(let k=0;k<n;k++){
      const a = attr.array[i*n+k];
      attr.array[i*n+k] = attr.array[j*n+k];
      attr.array[j*n+k] = a;
    }
  };
  for(let i=0;i<bp.count;i+=3){
    swap(bp, i, i+2, 3);                 // 三角形の頂点順を逆にすると裏返る
    if(bu) swap(bu, i, i+2, 2);
  }
  back.computeVertexNormals();
  const out = mergeGeos([front, back]);
  const nor = out.attributes.normal;
  if(upBlend != null){
    for(let i=0;i<nor.count;i++){
      const x = nor.getX(i)*(1-upBlend), y = nor.getY(i)*(1-upBlend) + upBlend, z = nor.getZ(i)*(1-upBlend);
      const L = Math.hypot(x, y, z) || 1;
      nor.setXYZ(i, x/L, y/L, z/L);
    }
    nor.needsUpdate = true;
  }
  return out;
}

// 葉・草の1枚。根元から先へ細くなり、先が垂れる帯。ヤシの葉・シダ・下草で使い回す
// frill を渡すと縁が波打ち、羽状(小葉が並んだシダ)の輪郭になる
function leafGeo(len, wid, droop, segs, frill){
  const s = segs || 4;
  const pos = [], uv = [], idx = [];
  for(let i=0;i<=s;i++){
    const t = i/s;
    // 根元は細く、中ほどでいちばん広く、先はまた細い(棒に見えない輪郭)
    let w = wid * Math.sin(Math.PI*Math.min(1, 0.22 + t*0.78)) * (1 - t*0.45);
    if(frill) w *= (i % 2) ? 1 : (1 - frill);
    const y = len*t - droop*t*t*len;
    pos.push(-w, y, 0,  w, y, 0);
    uv.push(0, t, 1, t);
  }
  for(let i=0;i<s;i++){
    const a = i*2;
    idx.push(a, a+1, a+2, a+1, a+3, a+2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* =====================================================================
   立体物の表面ディテール(法線・粗さのムラ・汚し)

   【なぜ要るのか】地面は色・法線・粗さの4枚を貼った物理ベース描画なのに、
   その上に立つ岩・柱・壁は「面ごとに1色」だった。光が当たっても表面が何も
   語らないので、同じ画面の中で地面だけ写実、立体物だけ低予算に見えていた。

   【なぜ三平面(トライプラナー)なのか】立体物のUVは種類ごとにバラバラ
   (球・円柱・箱・手組みの合成)で、1枚のテクスチャを貼っても継ぎ目と伸びが出る。
   そこでUVを使わず【ワールド座標】から3方向に投影して混ぜる。利点は3つ:
     ・どんな形にも同じ密度で乗る(UVを作らなくてよい)
     ・粒の大きさがワールド基準なので、大きい岩も小さい岩も同じ肌になる
     ・岩ごとに模様の当たる場所が変わる = 同じモデルの繰り返しが目立たない
   【描画命令も三角形も増えない】材質へ差し込むだけなので InstancedMesh の構成は
   元のまま。増えるのは1画素あたりのテクスチャ参照4回だけで、遠くはミップマップで
   自然に平らへ戻る(=ちらつかない)。
   ===================================================================== */
const SD_TEX = 256;
let sdTexCache = null;
/* 「肌」のテクスチャ1枚に4つの情報を詰める(色ではなくデータなので srgb=false)。
   RG=表面のかたむき(接線空間の法線xy) / B=広いムラ(色と粗さ用) / A=割れ目・目地

   【落とし穴・実測】最初は高さを入れて「画面微分から法線をひねる」方式(threeの
   bumpMapと同じ式)にした。画面微分は2×2画素ごとにしか求まらないため、凹凸を
   効かせた瞬間に岩と壁が【2〜4画素角の黒いブロック】で埋まった。
   かたむきをテクスチャ側へ焼いて素直に法線を傾ければ、1画素ごとに滑らかに出る。
   高さ場を先に作り、そこから差分でかたむきを求める(周期境界で折り返す)。      */
const SD_SLOPE = 5.0;         // かたむきを0〜255へ詰めるときの倍率
const SD_CRACK_TH = 0.88;     // 割れ目として残す稜線の高さ(上げるほど線が細くなる)
function surfaceDetailTexture(){
  if(sdTexCache) return sdTexCache;
  const S = SD_TEX;
  const hgt = new Float32Array(S*S), crk = new Float32Array(S*S), mot = new Float32Array(S*S);
  for(let y=0;y<S;y++){
    for(let x=0;x<S;x++){
      const u = x/S, v = y/S;
      const grain = fbmTile(u, v, 4, 4);       // 粒(4→32周期)。ざらついた肌の芯
      /* 割れ目: 尾根状ノイズ(1-|2n-1|)の稜線だけを残して「線」にする。
         【落とし穴・実測】fbmTile の戻り値は 0〜1 ではなく 0〜0.75 に偏っているので、
         正規化せずに 1-|2n-1| を取ると値がほぼ1に張り付き、pow で絞っても
         【面の4割が割れ目】という巨大なまだらになった(=線に見えない)。
         0〜1へ直してから、上端だけを smoothBand で切り出す。            */
      const c = fbmTile(u, v, 9, 2)/0.75;
      const cr = smoothBand(SD_CRACK_TH, 0.995, clamp01(1 - Math.abs(c*2 - 1)));
      const i = y*S + x;
      /* 割れ目のへこみは【浅く】する。深くすると線の縁でかたむきが振り切れ、
         法線が横を向いて日陰になり、岩がジグソーパズルの黒い線で埋まる(実測)。
         「深い溝」は色(A=暗く落とす)側で表現し、形は浅い段差にとどめる。   */
      hgt[i] = grain - cr*0.15;
      crk[i] = cr;
      mot[i] = fbmTile(u, v, 2, 3);            // 広いムラ(汚れ・退色)
    }
  }
  sdTexCache = makeTexture(S, (d)=>{
    const at = (x, y)=> hgt[(((y%S)+S)%S)*S + (((x%S)+S)%S)];
    for(let y=0;y<S;y++){
      for(let x=0;x<S;x++){
        const dx = (at(x+1, y) - at(x-1, y))*SD_SLOPE;
        const dy = (at(x, y+1) - at(x, y-1))*SD_SLOPE;
        const i = (y*S + x)*4;
        d[i]   = Math.round(255*clamp01(0.5 + dx*0.5));
        d[i+1] = Math.round(255*clamp01(0.5 + dy*0.5));
        d[i+2] = Math.round(255*clamp01(mot[y*S + x]*1.15));
        d[i+3] = Math.round(255*clamp01(crk[y*S + x]));
      }
    }
  }, false);
  sdTexCache.anisotropy = 4;
  return sdTexCache;
}

/* 表面ディテールを材質へ差し込む。
   scale=粒が1周する距離(ワールド単位。小さいほど細かい)
   bump =凹凸の強さ(倍率。1.0で標準の岩肌。上げすぎると暗い材質が黒く潰れる)
   macro=広いムラの大きさ / crack=割れ目の暗さ / stain=色ムラ / rough=粗さのムラ */
const SD_DEFAULT = { scale:64, bump:0.4, macro:520, stain:0.26, crack:0.28, rough:0.34 };
function applySurfaceDetail(mat, opt){
  const o = Object.assign({}, SD_DEFAULT, opt || {});
  const tex = surfaceDetailTexture();
  const key = 'aramonSD|' + [o.scale, o.bump, o.macro, o.stain, o.crack, o.rough].join(',');
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.onBeforeCompile = (sh, renderer)=>{
    if(prev) prev(sh, renderer);      // 植生は風の頂点シェーダーが先に入っている
    sh.uniforms.sdMap = { value: tex };
    sh.uniforms.sdA = { value: new THREE.Vector4(1/o.scale, o.bump, 1/o.macro, o.stain) };
    sh.uniforms.sdB = { value: new THREE.Vector2(o.crack, o.rough) };
    /* --- 頂点: ワールドの座標と法線を渡す ---
       法線は「どの向きから投影を貼るか」を決めるためだけに使う。インスタンスの
       回転が入っているので、同じモデルでも置かれた向きで模様の乗り方が変わる。 */
    sh.vertexShader = 'varying vec3 vSdW;\nvarying vec3 vSdN;\n' + sh.vertexShader;
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', [
      '#include <project_vertex>',
      'vec4 sdWp = vec4(transformed, 1.0);',
      'vec3 sdNo = objectNormal;',
      '#ifdef USE_INSTANCING',
      '  sdWp = instanceMatrix * sdWp;',
      '  sdNo = mat3(instanceMatrix) * sdNo;',
      '#endif',
      'vSdW = (modelMatrix * sdWp).xyz;',
      'vSdN = normalize(mat3(modelMatrix) * sdNo);',
    ].join('\n'));
    // --- 断片: 3方向から引いて混ぜる ---
    sh.fragmentShader = [
      'uniform sampler2D sdMap;',
      'uniform vec4 sdA;',
      'uniform vec2 sdB;',
      'varying vec3 vSdW;',
      'varying vec3 vSdN;',
      'vec3 sdGrad; float sdMot; float sdCrk;',
      '',
    ].join('\n') + sh.fragmentShader;
    sh.fragmentShader = sh.fragmentShader.replace('#include <logdepthbuf_fragment>', [
      '#include <logdepthbuf_fragment>',
      '{',
      '  vec3 sdN = normalize(vSdN);',
      '  vec3 sdW3 = pow(abs(sdN), vec3(4.0));',   // 面の向きに近い投影ほど強く混ぜる
      '  sdW3 /= max(1e-4, sdW3.x + sdW3.y + sdW3.z);',
      '  vec3 sdP = vSdW * sdA.x;',
      '  vec4 sdX = texture2D(sdMap, sdP.zy);',
      '  vec4 sdY = texture2D(sdMap, sdP.xz);',
      '  vec4 sdZ = texture2D(sdMap, sdP.xy);',
      // 各投影のかたむきを、その投影が寝ている軸へ組み直してワールドの勾配にする
      '  sdGrad = sdW3.x*vec3(0.0, sdX.g*2.0-1.0, sdX.r*2.0-1.0)',
      '         + sdW3.y*vec3(sdY.r*2.0-1.0, 0.0, sdY.g*2.0-1.0)',
      '         + sdW3.z*vec3(sdZ.r*2.0-1.0, sdZ.g*2.0-1.0, 0.0);',
      '  sdCrk = sdX.a*sdW3.x + sdY.a*sdW3.y + sdZ.a*sdW3.z;',
      // 広いムラは真上からの1枚だけ。縦の面では上下に伸びるが、それが雨だれの汚れに見える
      '  float sdMacro = texture2D(sdMap, vSdW.xz * sdA.z).b;',
      '  sdMot = (sdX.b*sdW3.x + sdY.b*sdW3.y + sdZ.b*sdW3.z)*0.60 + sdMacro*0.40;',
      '}',
    ].join('\n'));
    // 色: 広いムラで明暗を付け、割れ目・目地を暗く落とす
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', [
      '#include <color_fragment>',
      'diffuseColor.rgb *= 1.0 + (sdMot - 0.5)*sdA.w;',
      'diffuseColor.rgb *= 1.0 - sdCrk*sdB.x;',
    ].join('\n'));
    // 粗さ: 出っぱりは磨かれて少しつやが出る(MeshLambertには無いので当たらないだけ)
    sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', [
      '#include <roughnessmap_fragment>',
      'roughnessFactor = clamp(roughnessFactor*(1.0 - (sdMot - 0.5)*sdB.y), 0.05, 1.0);',
    ].join('\n'));
    /* 法線: ワールドの勾配を面に沿う成分だけ残し、視点座標系へ回してから傾ける。
       この時点の normal は視点座標系なので viewMatrix で揃える。            */
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', [
      '#include <normal_fragment_maps>',
      '{',
      '  vec3 sdG = sdGrad - vSdN*dot(vSdN, sdGrad);',
      /* かたむきに上限を付ける。【これが無いと割れ目の縁で法線が振り切れ、
         太陽の反対側を向いた画素が真っ黒になって、岩と壁が黒いススで
         覆われたように見える】(上を向いた面は勾配が丸ごと残るので特にひどい)。 */
      '  float sdL = length(sdG);',
      '  if(sdL > 0.55) sdG *= 0.55/sdL;',
      '  normal = normalize(normal - sdA.y*(viewMatrix * vec4(sdG, 0.0)).xyz);',
      '}',
    ].join('\n'));
  };
  mat.customProgramCacheKey = ()=> prevKey + key;
  return mat;
}

/* 【当たり判定と同じ形にする】山の広さの唯一の正は data.js の mountainRadiusAt()。
   移動・弾・射線・ミニマップが全部そこを見ているので、3Dの山肌もその円錐に一致させる。
   MOUNT_SKIRT と rise の式(radius*(isMain?1.15:0.9))は data.js と対になっている。
   **片方だけ変えると「見えている山肌の外なのに止められる」に戻る。必ず両方直すこと。** */
const MOUNT_SKIRT = 120;      // 山の裾を地面へ埋める深さ(地形の凹みで隙間が出ないように)
const CRATER_RATIO = 0.17;    // 火山の火口の広さ(山の半径に対する比)

/* 判定と同じ円錐の半径。zUp = 地面(山の中心の地形高さ)からの高さ。
   data.js の mountainRadiusAt() と同じ式。 */
function mountProfileR(rad, h, zUp){
  /* 【地面より下だけは円錐のまま広げる】判定は zUp<0 を 0 で止めるので、
     ここも止めると裾が垂直な壁になる。地形がへこんだ所でその壁が地上に出て、
     山の足元に「土台」が回っているように見えた(パレパレの森で発生)。
     下へ広がるぶんは判定より太いが、太いぶんには見えない壁にならない。 */
  return rad * Math.max(0, 1 - (MOUNT_SKIRT + zUp) / h);
}

/* 山肌を判定より内側へ彫ってよい量。ここが「見た目」と「当たり判定」の折り合い。
   ・裾(地面の高さ)では彫らない → 【地面での山肌の半径が判定と完全に一致する】
     プレイヤーが止められるのはこの1本の輪なので、ここが合っていれば見えない壁は出ない
     (全マップ・全サイズで実測 0.0%)。深さを変えてもこの一致は崩れない。
   ・外へは絶対に出さない(出すと今度は山にめり込んで見える)
   彫りが効くのは中腹から上だけなので、深くしても損をするのは
   「高く飛ぶ弾が谷の上で止まる」ぶんだけ。稜線の見た目を優先して深く取ってある。 */
const MOUNT_CARVE_MAX  = 0.260;   // 判定より内側へ入ってよい最大量(v.radius 比)
const MOUNT_CARVE_REL  = 0.30;    // その高さでの半径に対する上限(頂上が針にならないように)
const MOUNT_CARVE_FOOT = 0.10;    // 裾で彫りを0へ戻す区間(t=0〜これ)
const MOUNT_CARVE_VERT = 0.30;    // 彫りのうち縦へ回す割合(段の高さを不揃いにして稜線を出す)
/* ピラミッドの断面。0=正方形 1=円。角と面の半径の比が 1.41 → 1.17 になる。
   素の正方形だと角が判定の円から+16%外へ、面が-8%内へ出て、角にめり込めるうえ
   面では見た目の外なのに止められた(実測 ±21%)。角を丸めて円へ寄せ、
   PYRAMID_FIT で角と面が判定の円を等しくまたぐ大きさにする(実測 ±12%)。
   四角錐に見えたまま。**円の判定に四角錐を合わせる以上、ここは0にはできない。** */
/* 山にだけ効かせる霞の範囲。シーンの霧(700〜3200)は山には近すぎる。
   完全に切ると山だけ霞の中で浮くので、遠くではちゃんと溶かす。 */
const MOUNT_FOG_NEAR = 2600, MOUNT_FOG_FAR = 11000;
const PYRAMID_ROUND = 0.50;
const PYRAMID_FIT   = 1 / Math.sqrt(1/Math.SQRT2 * (1 - PYRAMID_ROUND) + PYRAMID_ROUND);

/* 塗り分け用の「尾根の背か谷か」(1=尾根の背 0=谷底)。

   ここは山肌の見た目を決める要で、**2つの罠の間の細い道**を通す必要がある。
   ・細かすぎると(面の刻み 周64/36・縦15/9 に近いと)隣り合う面で色が入れ替わり、
     山肌が市松模様の迷彩柄になる。
   ・粗すぎると値ノイズの格子(tileNoise は整数格子の補間)がそのまま出て、
     今度は規則正しい菱形のパッチワークに見える。9スポーク1枚で試して実際にそうなった。
   どちらも実機で report された(2026-08-14)。そこで
   ・周波数の違う2オクターブ(5と7。互いに素なので格子が重ならない)
   ・縦横で周期を変える(格子が正方形に見えない)
   ・別のノイズで入力をずらす(ドメインワープ。格子の直線を崩す)
   の3つで「面より粗く、しかし格子に見えない」場所へ収める。
   **オクターブを増やして細かくしないこと。市松に戻る。**              */
function mountainRib(ang, t, seed){
  const w = angNoise(ang + seed*4.1, t*0.8 + seed*2.3, 3) - 0.5;   // 入力のずらし
  const r1 = 1 - Math.abs(angNoise(ang + seed + w*0.9,     t*1.5 + seed*0.9, 5)*2 - 1);
  const r2 = 1 - Math.abs(angNoise(ang + seed*2.7 - w*0.7, t*3.0 + seed*1.7, 7)*2 - 1);
  return r1*0.62 + r2*0.38;
}

/* 山肌の「露岩」を画素ごとに出す。
   【なぜ頂点カラーで塗り分けないか】山の面は主峰で1枚160単位もある。そこへ
   「この面は岩・この面は雪」と塗ると色が面の形どおりのブロックになり、
   山肌がブロック塀のようなパッチワーク(迷彩柄)に見える。実機で2度 report され、
   面の法線・細かいノイズ・粗いノイズと原因を替えて何度も作り直したが、
   **面ごとに色を決めている限り必ずブロックになる**というのが結論(2026-08-14)。

   そこで分かれ目は2段構えにする:
   ・どこが岩かの大きな分布 = 頂点属性 aCoat(尾根で大・谷で小)。頂点ごとなので
     ラスタライザが面をまたいで滑らかにつなぐ。
   ・境目のギザギザ = 法線マップのかたむき。岩肌の凹凸に沿って線が乱れる。
   sdGrad / vSdN は applySurfaceDetail が用意する(**必ず先に呼ぶこと**)。   */
function applyMountainCoat(mat, rockColor, lo, hi){
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  const key = 'aramonMC|' + lo + ',' + hi;
  /* 【山だけ霞を弱める】シーンの霧は地形パッチ(半分3600)に合わせて 700〜3200 で
     切ってある。ところが山は半径1500・高さ1900もあるので、隣に立っていても
     山頂までの距離が2600を超え、山肌の8割が霞の色へ溶ける。カウレアの黒い火山が
     砂色の山に見えていたのはこれ(材質でも露岩でもなく霧だった・2026-08-14)。
     three の霧のuniformは毎フレーム renderer がシーンから書き戻すので、
     uniform を差し替えても効かない。材質側の霧を切って自前で薄く掛ける。      */
  mat.fog = false;
  mat.onBeforeCompile = (sh, renderer)=>{
    if(prev) prev(sh, renderer);
    sh.uniforms.mcRock = { value: rockColor.clone() };
    sh.uniforms.mcA = { value: new THREE.Vector2(lo, hi) };
    sh.uniforms.mcHaze = { value: new THREE.Color(R3.theme ? R3.theme.haze : DEFAULT_THEME.haze) };
    sh.uniforms.mcHazeR = { value: new THREE.Vector2(MOUNT_FOG_NEAR, MOUNT_FOG_FAR) };
    sh.vertexShader = 'attribute float aCoat;\nvarying float vCoat;\n' + sh.vertexShader;
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n  vCoat = aCoat;');
    sh.fragmentShader = 'uniform vec3 mcRock;\nuniform vec2 mcA;\nuniform vec3 mcHaze;\n'
                      + 'uniform vec2 mcHazeR;\nvarying float vCoat;\n' + sh.fragmentShader;
    // 自前の霞。three と同じ「色空間変換のあと」に掛ける
    sh.fragmentShader = sh.fragmentShader.replace('#include <colorspace_fragment>', [
      '#include <colorspace_fragment>',
      'gl_FragColor.rgb = mix(gl_FragColor.rgb, mcHaze,',
      '  smoothstep(mcHazeR.x, mcHazeR.y, distance(vSdW, cameraPosition)) * 0.85);',
    ].join('\n'));
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', [
      '#include <color_fragment>',
      '{',
      '  vec3 mcG = sdGrad - vSdN*dot(vSdN, sdGrad);',
      '  float mcL = length(mcG);',
      '  if(mcL > 0.55) mcG *= 0.55/mcL;',
      '  vec3 mcN = normalize(vSdN - 0.55*mcG);',
      // 法線マップで下向きに倒れたぶんだけ岩寄りにする。**これを主役にしないこと**
      // (法線だけから決めた版は、山肌が黒い斑点だらけのダルメシアン柄になった)
      '  float mcJ = (vSdN.y - mcN.y) * 0.45;',
      '  float mcRockK = smoothstep(mcA.x, mcA.y, vCoat + mcJ);',
      '  diffuseColor.rgb = mix(diffuseColor.rgb, mcRock, mcRockK);',
      '}',
    ].join('\n'));
  };
  mat.customProgramCacheKey = ()=> prevKey + key;
  return mat;
}

/* 山の色。高さ(0=麓 1=頂上)で麓・中腹・頂上の3色を混ぜたものが「表土」、
   rock が「露出した岩」。どちらを見せるかは高さではなく面の傾きで決める
   (急斜面=岩がむき出し / 緩斜面=雪・草・砂が乗る)。
   relief=尾根と谷の彫りの深さ(陰影用の彫りに効く。形は判定の帯 MOUNT_CARVE_MAX で頭打ち)
   rockK=露岩の濃さ
   coatLo,coatHi=露岩と表土の分かれ目(頂点属性 aCoat の 0〜1。小さいほど岩が広い)
   rockLo,rockHi,rockK=ピラミッド専用。露岩の出る面の傾き(素の四角錐の傾きからのずれ)
   ao=谷筋をどれだけ暗く沈めるか

   【雪山は「白が地」】foot/mid/top を岩色にして白を足す作りだと、雪の乗る面と
   乗らない面が入れ替わって迷彩柄になる。雪山では3色とも雪の色にし、
   **急な尾根の背にだけ rock を出す**(雪が積もれない所が黒い崖)。
   露岩は太陽4.6+ACESでも沈むよう、はっきり暗い色にすること。          */
const MOUNT_COLORS = {
  volcano: { foot:0x4a3122, mid:0x33231a, top:0x1e1611, rock:0x201510,
             rough:0.97, relief:1.15, coatLo:0.20, coatHi:0.46, ao:0.26 },
  snow:    { foot:0xa9bdd0, mid:0xd4e2ef, top:0xf6fcff, rock:0x1b212c,
             rough:0.70, relief:1.05, coatLo:0.42, coatHi:0.58, ao:0.18 },
  forest:  { foot:0x3d4c22, mid:0x2b4f1d, top:0x1a3a15, rock:0x35301f,
             rough:0.94, relief:0.95, coatLo:0.46, coatHi:0.64, ao:0.22 },
  pyramid: { foot:0x8a6f3f, mid:0xa88a54, top:0xc0a068, rock:0x6a5330,
             rough:0.86, relief:0.00, rockK:0.85, rockLo:0.12, rockHi:-0.08, ao:0.10 },
};


/* 山1つ。2Dの drawSolidCone と同じ寸法(半径 / 高さ = radius*(isMain?1.15:0.9))。
   火山の主峰だけ先端を切って火口にする。色は高さで麓→中腹→頂上を混ぜ、
   ワールド座標のノイズでまだらにする(のっぺりした一色の面を防ぐ)。          */
const _mc = new THREE.Color(), _mcTmp = new THREE.Color();
function mountainVertexColor(conf, t, mottle){
  // t: 0=麓 1=頂上
  if(t < 0.5) _mc.setHex(conf.foot).lerp(_mcTmp.setHex(conf.mid), t/0.5);
  else        _mc.setHex(conf.mid).lerp(_mcTmp.setHex(conf.top), (t-0.5)/0.5);
  _mc.multiplyScalar(0.88 + mottle*0.24);
  return _mc;
}

/* 円錐の頂点を「判定と同じ半径」へ置き直す。THREE の Cone/Cylinder が作る半径を
   そのまま使うと判定とズレる:
   ・地面より下(埋めた裾)は円錐のまま広がるので、地形がへこんだ所で
     判定の外側へ山肌が出てしまう。判定と同じく zUp=0 の半径で止める(裾は垂直)。
   ・火口のある山は上端が rad*CRATER_RATIO なので、全高にわたって判定より太い。
     火口の太さを下回る高さから上だけを火口と同じ太さにして、
     判定より外へ出る範囲を「頂上のごく近く(=誰も届かない高さ)」に閉じ込める。
   横の段(リング)の高さも割り振り直す。THREE は全高 h を等分するので、
   地面の高さ(zUp=0)はたいてい段と段の間に落ちる。そこは円錐が折れ曲がる線なので、
   段がないと面が角を斜めに突っ切り、地面での半径が判定より細くなる
   (小さい山ほどひどく、実測で 3.8% 細かった)。1段目をちょうど地面に置き、
   残りの段を見えている部分だけに使う(埋まった裾に段を割かない)。            */
function shapeToProfile(geo, rad, h, rows, craterR){
  const pos = geo.attributes.position;
  const rise = h - MOUNT_SKIRT;
  for(let i=0;i<pos.count;i++){
    const px = pos.getX(i), pz = pos.getZ(i);
    const f = clamp01((pos.getY(i) + h/2) / h);            // 0=最下段 1=最上段
    // 1段ぶんを埋めた裾に、残りを地面から頂上までに割り当てる
    const zUp = (f <= 1/rows) ? (f*rows - 1)*MOUNT_SKIRT
                              : (f - 1/rows)/(1 - 1/rows) * rise;
    const py = zUp + MOUNT_SKIRT - h/2;
    const len = Math.hypot(px, pz);
    if(len < 1e-4){ pos.setY(i, py); continue; }
    const want = Math.max(craterR, mountProfileR(rad, h, zUp));
    pos.setXYZ(i, px/len*want, py, pz/len*want);
  }
  return geo;
}

/* 山肌の彫り。ここが「完全な円錐」を「山」に変える一番の要。
   ridged noise(1-|fbm|)で尾根と谷を彫る。
   【外へは絶対に出さない・内へも入れすぎない】素の円錐が当たり判定そのものなので、
   外へ膨らませれば山にめり込んで見え、内へ削りすぎれば「山肌の外なのに止められる」。
   そこで彫りは必ず「判定の内側 MOUNT_CARVE_MAX の帯の中」だけで行い、
   裾では帯の幅を0へ落として判定とぴったり合わせる。
   縦へ落とすぶんも、その高さでの半径のズレに換算して同じ帯から払う。       */
function displaceMountain(geo, rad, h, rise, seed, conf, capT){
  const pos = geo.attributes.position;
  const rel = Math.min(1, conf.relief);      // 帯の外へ出さないので1で頭打ち
  if(rel <= 0) return geo;
  for(let i=0;i<pos.count;i++){
    const px = pos.getX(i), pz = pos.getZ(i), py = pos.getY(i);
    const r = Math.hypot(px, pz);
    if(r < 1e-4) continue;
    const ang = Math.atan2(pz, px) + Math.PI;
    const t = clamp01((py + h/2 - MOUNT_SKIRT) / rise);         // 0=麓 1=頂上
    /* 彫ってよい深さ(ワールド単位)。裾では0、上へ行くほど帯を使い切れる。
       上ほど「その高さの半径に対する割合」では深くなるので、稜線は頂上側で鋭く出る。 */
    let room = Math.min(MOUNT_CARVE_MAX*rad, MOUNT_CARVE_REL*r) * rel
             * smoothBand(0, MOUNT_CARVE_FOOT, t);
    if(capT) room *= clamp01((1 - t)/capT);                     // 火口の縁は彫らない
    const carve = 1 - ridgedFbm(ang, t*2.4, seed);              // 1=谷 0=尾根
    // 山体そのもののゆがみ(方角ごとに尾根の張り出しが違う)
    const swell = angNoise(ang + seed*0.7, t*1.3 + seed, 7);
    // 面の中の細かいザラつき。面ごとの法線と合わさって岩肌になる
    const grit = angNoise(ang*1.0 + seed*2.3, t*9.0 + seed*3.1, 48);
    // 配分の合計が1を超えないようにしてある(=帯の外へは出ない)
    const cut = room * Math.min(1, 0.62*carve*carve + 0.28*swell + 0.10*grit);
    const k = Math.max(0, 1 - cut*(1 - MOUNT_CARVE_VERT)/r);
    pos.setXYZ(i, px*k, py - cut*MOUNT_CARVE_VERT*(h/rad), pz*k);
  }
  return geo;
}

/* 陰影と色分けにだけ使う「深く彫った双子」。**判定を入れる前の彫り方をそのまま残したもの。**
   帯の中の浅い形の面法線で塗ると、尾根も谷も露岩も雪原も消えて
   「のっぺりした灰色の円錐」になる(雪山で実測: 明暗のばらつき 0.071→0.040)。
   法線は当たり判定に一切関係しないので、形は帯の中・陰影はこの双子から借りる。
   **式を上の displaceMountain へ寄せてはいけない。** 寄せた版を作ったところ、
   面の傾きが深くなって「緩斜面に雪が乗る」判定(conf.cover)が働かず、
   雪山から雪冠が丸ごと消えた。ここは見た目の基準なので昔の式が正。       */
function displaceMountainShade(geo, h, rise, seed, conf, capT){
  const pos = geo.attributes.position;
  const amp = 0.26 * conf.relief;       // 谷を内側へ削る最大量(半径比)
  const vAmp = 0.13 * conf.relief;      // 谷を下へ掘る最大量(高さ比)
  for(let i=0;i<pos.count;i++){
    const px = pos.getX(i), pz = pos.getZ(i), py = pos.getY(i);
    const r = Math.hypot(px, pz);
    if(r < 1e-4) continue;
    const ang = Math.atan2(pz, px) + Math.PI;
    const t = clamp01((py + h/2 - MOUNT_SKIRT) / rise);
    let fall = 0.10 + 0.90*Math.pow(1 - t, 1.30);
    if(capT) fall *= clamp01((1 - t)/capT);
    const carve = 1 - ridgedFbm(ang, t*2.4, seed);
    const swell = angNoise(ang + seed*0.7, t*1.3 + seed, 7);
    /* 面の中の細かいザラつき。**分割数(周64/36・縦15/9)に近い周期にしないこと。**
       48スポーク×縦9周期で振っていた頃は面の刻みと干渉して法線が1枚おきに振れ、
       山肌が三角形の市松模様に見えた。細かい肌は applySurfaceDetail が担う。 */
    const grit = angNoise(ang*1.0 + seed*2.3, t*2.6 + seed*3.1, 11);
    const k = Math.max(0.42, Math.min(1,
      1 - (amp*carve*carve + 0.11*swell*conf.relief + 0.030*grit*conf.relief) * fall));
    pos.setXYZ(i, px*k, py - vAmp*carve*carve*fall*rise, pz*k);
  }
  return geo;
}

/* ピラミッド。四角錐のままだと「UIの三角形」にしか見えないので、
   石を積んだ段(コース)を刻む。段は必ず内側へ引っ込めるので、寸法の枠は超えない。
   断面は|x|+|z|=R の正方形として作るため、分割数を上げても四角いまま
   (=面の上に風化の凹凸を乗せられる)。頂上の数段だけは滑らかな笠にする。   */
function pyramidGeo(rad, h, seed){
  const C = 20;                       // 段数
  const SEG = 24;                     // 1周の分割(4の倍数にすると角がそろう)
  const rows = C*2;
  const geo = new THREE.CylinderGeometry(0, 1, h, SEG, rows, true);
  const pos = geo.attributes.position;
  for(let i=0;i<pos.count;i++){
    const px = pos.getX(i), pz = pos.getZ(i), py = pos.getY(i);
    const tRaw = clamp01((py + h/2) / h);
    const ri = Math.round(tRaw*rows);
    const c = Math.floor(ri/2), phase = ri % 2;
    let y, rr;
    if(ri >= rows - 6){
      // 上の3段ぶんは段を付けず滑らかな笠石にする(段と滑らかの境目はぴったり繋がる)
      y = -h/2 + h*(ri/rows);
      rr = 1 - ri/rows;
    }else{
      y = -h/2 + h*((c + phase)/C);
      rr = 1 - c/C;
    }
    const ang = Math.atan2(px, pz);
    /* 断面。素の正方形(|x|+|z|=R)だと角が判定の円から+16%外へ、面が-8%内へ出る
       (実測で角にめり込め、面では見た目の外なのに止められた)。角を少し丸めて
       円へ寄せ、PYRAMID_FIT で全体を判定の円にまたがせる。四角錐には見えたまま。 */
    const sq = (1 - PYRAMID_ROUND) / (Math.abs(Math.sin(ang)) + Math.abs(Math.cos(ang)))
             + PYRAMID_ROUND;
    // 風化。段の縁が欠け、面にも浅い凹みができる(内向きのみ)
    const wear = angNoise(ang*1.0 + seed, ri*0.37 + seed*1.9, 12);
    const chip = angRidge(ang*1.0 + seed*2.1, ri*0.11 + seed, 20);
    const k = rad * rr * sq * (1 - 0.020*wear - 0.030*chip*chip*(1 - tRaw*0.5));
    const len = Math.hypot(px, pz) || 1;
    pos.setXYZ(i, px/len*k, y, pz/len*k);
  }
  return geo;
}

export function buildMountainMesh(v){
  const style = v.style || 'volcano';
  const conf = MOUNT_COLORS[style] || MOUNT_COLORS.volcano;
  const rise = v.radius * (v.isMain ? 1.15 : 0.9);
  const isPyramid = (style === 'pyramid');
  const hasCrater = (style === 'volcano' && v.isMain);
  const h = rise + MOUNT_SKIRT;
  /* 分割数。稜線のギザギザと谷筋を出すには周方向にも縦方向にも分割が要る。
     山は1マップに数十個だが三角形は数千どまりなので、上げても負荷はほとんど増えない。 */
  const seg = v.isMain ? 64 : 36;
  const rows = v.isMain ? 15 : 9;
  const rad = isPyramid ? v.radius*PYRAMID_FIT : v.radius;
  // 山ごとに違う形にするための種。volcanoObstaclesにseedは無いので位置から作る
  const seed = hash2(v.x*0.013, v.y*0.017) * 10;
  let geo, shadeGeo = null;
  if(isPyramid){
    geo = pyramidGeo(rad, h, seed);
  }else{
    // 火山は先を切った円錐にして、頂上に火口の穴を作る
    const craterR = hasCrater ? rad*CRATER_RATIO : 0;
    geo = hasCrater
      ? new THREE.CylinderGeometry(craterR, rad, h, seg, rows, true)
      : new THREE.ConeGeometry(rad, h, seg, rows, true);
    shapeToProfile(geo, rad, h, rows, craterR);   // 判定と同じ円錐へ合わせてから彫る
    const capT = hasCrater ? 0.14 : 0;
    // 陰影用の「深く彫った山」。同じ種・同じノイズなので尾根と谷の位置は形と一致する
    shadeGeo = displaceMountainShade(geo.clone(), h, rise, seed, conf, capT);
    displaceMountain(geo, rad, h, rise, seed, conf, capT);
  }
  /* 頂点カラーは【面ごと】に塗る。見えているのは面の法線なので、
     色も面の傾きで分けないと陰影と模様がずれて「グラデーションを貼った図形」に見える。
     ・急斜面 → 露出した岩(暗い)
     ・緩斜面 → 雪・草・砂(高さで決まる表土の色)
     ・谷筋   → さらに暗く沈める(空が見えない場所なので実際に暗い)          */
  geo = geo.toNonIndexed();
  /* 法線は「深く彫った山」から借りる(形は帯の中の浅いほうのまま)。
     面ごとに1つの法線を3頂点に入れるので、flatShading を切っても面は平らに見える。
     ※ flatShading:true にすると three は画素の微分から法線を作り直し、
       ここで入れた法線を丸ごと無視する。切ってあるのはそのため。            */
  if(shadeGeo){
    const sn = shadeGeo.toNonIndexed();
    sn.computeVertexNormals();         // 非indexなので面法線がそのまま入る
    geo.setAttribute('normal', sn.attributes.normal);
    shadeGeo.dispose();                // sn は法線を geo へ渡したので dispose しない
  }else{
    geo.computeVertexNormals();
  }
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const col = new Float32Array(pos.count*3);
  const coat = new Float32Array(pos.count);
  /* 露岩の色。**テーマ色を混ぜすぎないこと。** 0.40 混ぜていた頃は、雪山のテーマ色
     (明るい青灰)に引かれて #546172 まで明るくなり、太陽4.6とACESを通すと
     雪とほとんど同じ明るさになって「岩の見えない、のっぺりした白い円錐」になった。
     マップに馴染ませるのは色みだけで十分なので、混ぜるのは少しにする。      */
  const rockC = mixColor(new THREE.Color(conf.rock), themeColor('steep'), 0.15);
  const baseNy = rad / Math.hypot(rise, rad);   // 素の円錐の傾き(ピラミッド用)
  const c = new THREE.Color();
  /* 【色もマスクも「面ごと」ではなく「頂点ごと」に置く】
     面の重心で1つ決めて3頂点に同じ値を入れると、色が面の形どおりのブロックになり、
     山肌がブロック塀のようなパッチワーク(迷彩柄)に見える。実機で2度 report され、
     原因を替えて何度も作り直したが、**面ごとに色を決めている限り必ずブロックになる**
     というのが結論(2026-08-14)。頂点ごとに置けば隣の面と角の値を共有するので、
     ラスタライザが面をまたいで滑らかにつないでくれる。
     陰影(明暗)は今までどおり面ごと(法線が面ごと)なので、低ポリの表情は残る。
     **ここに面の大きさより細かいノイズを混ぜないこと**(まだらノイズも同じ罠だった)。 */
  for(let i=0; i<pos.count; i++){
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const t = clamp01((py + h/2 - MOUNT_SKIRT) / rise);
    const ang = Math.atan2(pz, px) + Math.PI;
    const rib = isPyramid ? 0.5 : mountainRib(ang, t, seed);
    coat[i] = rib;
    c.copy(mountainVertexColor(conf, t, 0.5));
    if(isPyramid){
      // ピラミッドは段の傾きそのものが形なので、面の法線で露岩を出してよい
      c.lerp(rockC, smoothBand(baseNy + conf.rockLo, baseNy + conf.rockHi,
                               Math.abs(nor.getY(i))) * conf.rockK);
    }
    // 谷筋の落ち込み。空が見えない場所なので暗い(手描きのアンビエントオクルージョン)
    c.multiplyScalar(1 - conf.ao*(1 - rib));
    col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aCoat', new THREE.BufferAttribute(coat, 1));
  /* 【落とし穴】地面用の roughnessMap をそのまま貼ると、山肌の一部が
     つやのある面になって空の色を映し込み、暗い岩の山まで白っぽく飛ぶ
     (カウレアの黒い火山が砂色に見えていた原因)。山は一様に粗い面として扱う。 */
  /* flatShading は「面ごとに1つの法線」を入れてある山では切る(上の説明のとおり、
     入れておくと three が画素の微分から法線を作り直して深い彫りの陰影を捨ててしまう)。
     ピラミッドは段そのものが形なので、これまでどおり flatShading で塗る。       */
  const mat = new THREE.MeshStandardMaterial({
    vertexColors:true, roughness: conf.rough, metalness:0.0,
    flatShading:isPyramid, envMapIntensity:ENV_INTENSITY*0.55, side:THREE.DoubleSide,
  });
  /* 山肌のディテール。地面用の法線マップを円錐のUVへ貼っていたが、山の大きさが
     半径数百〜千単位あるのに対しUVは0〜1しかなく、粒が引き伸ばされて効いていなかった。
     ワールド座標から引く方式にすると、山も足元の岩も同じ密度の肌になる。
     ピラミッドだけは石を積んだ人工物なので、粒を細かく・目地を濃くする。      */
  applySurfaceDetail(mat, isPyramid
    ? { scale:34,  bump:0.65, macro:520,  stain:0.36, crack:0.32, rough:0.30 }
    : { scale:110, bump:0.8, macro:1400, stain:0.40, crack:0.20, rough:0.28 });
  // 露岩は画素ごと(applySurfaceDetail が用意する sdGrad / vSdN を使うので必ずこの順)
  if(!isPyramid) applyMountainCoat(mat, rockC, conf.coatLo, conf.coatHi);
  const mesh = new THREE.Mesh(geo, mat);
  const base = heightAt(v.x, v.y) - MOUNT_SKIRT;
  mesh.position.set(v.x, base + h/2, v.y);
  if(isPyramid) mesh.rotation.y = Math.PI/4;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if(!hasCrater) return mesh;
  // 火口: 少しへこませた円盤。溶岩と同じ脈動で赤熱させる
  const craterMat = new THREE.MeshStandardMaterial({
    color:0x1c0a05, roughness:0.9, metalness:0.0,
    emissive:new THREE.Color(0xff4a10), emissiveIntensity:1.4,
  });
  lavaMats.push(craterMat);
  const crater = new THREE.Mesh(new THREE.CircleGeometry(rad*CRATER_RATIO*0.96, seg), craterMat);
  crater.geometry.rotateX(-Math.PI/2);
  crater.position.set(v.x, base + h - rad*0.05, v.y);
  // 火口の縁。下から見上げても「熱を持った火山」だと分かるよう、山頂の縁だけ赤熱させる。
  // 画面に貼る円ではなく山の一部なので、視点を変えても山からずれない
  const rimMat = new THREE.MeshStandardMaterial({
    color:0x2a1108, roughness:0.9, metalness:0.0,
    emissive:new THREE.Color(0xff3c08), emissiveIntensity:0.55, side:THREE.DoubleSide,
  });
  lavaMats.push(rimMat);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(rad*CRATER_RATIO*1.02, rad*CRATER_RATIO*1.12, rise*0.05, seg, 1, true), rimMat);
  rim.position.set(v.x, base + h - rise*0.025, v.y);
  const group = new THREE.Group();
  group.add(mesh); group.add(crater); group.add(rim);
  return group;
}

/* ---- 障害物(岩・木・水晶など) ----
   2Dで描いていた障害物を3Dモデルに置き換える。地形に沿って埋まり、影も落とす。
   【前後関係】3Dに移すと2Dで描くモンスター・弾は必ず障害物より手前に来てしまう。
   そこでrender.jsが「同じ輪郭を destination-out でくり抜く」ことで、その障害物より
   奥に描かれたものだけを消している。手前のものは後から普通に上へ描かれるので、
   従来の奥行きソートと同じ見え方のまま変わらない。形の定義(OBST_SHAPES)は
   data.jsに1つだけ置き、3Dモデルと2Dのくり抜きが必ず同じ寸法を見るようにしてある。
   【数】1マップに数百個あるので種類ごとにInstancedMeshへまとめ(描画命令は十数回)、
   プレイヤーの近くのぶんだけを並べ替えて使う。                                  */
const OBST_VIEW = 3300;    // これより遠い障害物は出さない(霞で見えなくなる距離)
const OBST_MAX  = 620;     // 同時に並べられる数の上限(訓練場は狭くて密なので多め)
const OBST_STEP = 200;     // プレイヤーがこの距離だけ動いたら並べ直す
const OBST_VARIANTS = 4;   // 同じ種類でも形を4通り作って「同じ岩の繰り返し」を防ぐ
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const OBST_SHAPE_FB = { h:1.2, sink:0.2 };
let obstGroup = null, obstKinds = null, obstSrc = null, obstSig = '', obstShadow = null;
let obstCX = null, obstCY = null, obstCull = OBST_VIEW, obstDrawn = 0;

export function obstacleCullDist(){ return obstCull; }
export function obstacleDrawn(){ return obstDrawn; }
export function resetObstacles(){
  obstSig = '';
  obstCull = OBST_VIEW;
  vegTheme = null;   // 植生もテーマごとに作り直す(地面の高さも色も変わるため)
}

function shapeOf(flavor){
  const t = window.__aramonObstShapes;
  return (t && (t[flavor] || t.rock)) || OBST_SHAPE_FB;
}

// モデルのローカル高さ(y0→y1)で色を塗る。mottleはワールドではなく形に乗るまだら
function paintGeo(geo, lo, hi, y0, y1, mottle){
  const pos = geo.attributes.position, n = pos.count, col = new Float32Array(n*3);
  const cA = (lo instanceof THREE.Color) ? lo : new THREE.Color(lo);
  const cB = (hi instanceof THREE.Color) ? hi : new THREE.Color(hi);
  const c = new THREE.Color();
  const amp = (mottle == null) ? 0.20 : mottle;
  for(let i=0;i<n;i++){
    const t = Math.max(0, Math.min(1, (pos.getY(i)-y0) / Math.max(0.0001, y1-y0)));
    c.copy(cA).lerp(cB, t);
    const m = 1 + (tileNoise(pos.getX(i)*2.7+11, pos.getZ(i)*2.7+7, 32) - 0.5)*amp;
    col[i*3] = c.r*m; col[i*3+1] = c.g*m; col[i*3+2] = c.b*m;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

// 上の面だけ別の色を乗せる(岩の雪・倒木の苔)。塗り済みの色に混ぜる
function tintTop(geo, hex, y0, y1, strength){
  const pos = geo.attributes.position, col = geo.attributes.color;
  if(!col) return geo;
  const w = (hex instanceof THREE.Color) ? hex : new THREE.Color(hex);
  const c = new THREE.Color();
  for(let i=0;i<pos.count;i++){
    const t = Math.max(0, Math.min(1, (pos.getY(i)-y0) / Math.max(0.0001, y1-y0)));
    const k = t*t*(0.6 + tileNoise(pos.getX(i)*3.3+3, pos.getZ(i)*3.3+5, 32)*0.8)*(strength==null?1:strength);
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(w, Math.min(1, k));
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
  return geo;
}

/* へこみを暗く、上向きの面を明るくする(手描きのアンビエントオクルージョン)。
   単色の面が「プラスチックの塊」に見える最大の原因は陰影が形の凹凸に付いていないこと。
   隣接情報を持たずに済むよう、「重心から見た向き」と法線のズレをへこみとみなす。 */
function cavityShade(geo, strength, upLight){
  const pos = geo.attributes.position, nor = geo.attributes.normal, col = geo.attributes.color;
  if(!col || !nor) return geo;
  let cx = 0, cy = 0, cz = 0;
  for(let i=0;i<pos.count;i++){ cx += pos.getX(i); cy += pos.getY(i); cz += pos.getZ(i); }
  cx /= pos.count; cy /= pos.count; cz /= pos.count;
  for(let i=0;i<pos.count;i++){
    const dx = pos.getX(i)-cx, dy = pos.getY(i)-cy, dz = pos.getZ(i)-cz;
    const L = Math.hypot(dx, dy, dz) || 1;
    const d = (dx*nor.getX(i) + dy*nor.getY(i) + dz*nor.getZ(i)) / L;   // 1=出っ張り 0以下=へこみ
    let k = 1 - strength*(1 - Math.max(0, Math.min(1, d)));
    if(upLight) k *= 1 + upLight*Math.max(0, nor.getY(i));
    col.setXYZ(i, col.getX(i)*k, col.getY(i)*k, col.getZ(i)*k);
  }
  col.needsUpdate = true;
  return geo;
}

/* 上を向いた面にまだらな苔・地衣類・砂だまりを乗せる。
   岩が「均一な材質の塊」に見えるのを崩す一番効く手。色はテーマから渡す。 */
function patchTint(geo, color, strength, seed, scale){
  const pos = geo.attributes.position, nor = geo.attributes.normal, col = geo.attributes.color;
  if(!col || !nor) return geo;
  const c = new THREE.Color(), s = scale || 2.2;
  for(let i=0;i<pos.count;i++){
    const up = Math.max(0, nor.getY(i));
    const n = tileNoise(pos.getX(i)*s + seed, pos.getZ(i)*s - seed, 32)*0.6
            + tileNoise(pos.getX(i)*s*2.7 - seed, pos.getY(i)*s*2.7 + seed, 32)*0.4;
    const k = Math.max(0, Math.min(1, (up*1.05 + n - 0.92) * 3.0)) * strength;
    if(k <= 0) continue;
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(color, k);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
  return geo;
}

/* 岩の面の細かさ。IcosahedronGeometry の detail は「1面を(detail+1)²に割る」ので、
   3 = 20×16 = 320枚、6 = 20×49 = 980枚。1マップに数百個あっても実際に画面へ出るのは
   近くの数十個(obstacleDrawn は 40〜80 程度)なので、岩本体は細かく作ってよい。
   3のままだと近くの岩で1面が15画素角になり、輪郭が六角形に見えていた。
   草・葉の塊は数が桁違いなので低いままにする。                              */
const ROCK_DETAIL = 6;

/* でこぼこの塊。半径1・底が y=0 に来るように作る(最後に fitBounds で枠へ収める)。
   3オクターブの変位で「大きなうねり → 面の割れ → 細かいザラつき」を重ね、
   さらに水平の層(strat)を入れると堆積岩(砂岩)になる。                      */
function boulderGeo(seed, flat, opt){
  const o = opt || {};
  const geo = new THREE.IcosahedronGeometry(1, o.detail == null ? 2 : o.detail);
  const pos = geo.attributes.position;
  const strat = o.strat || 0;
  const amp = (o.amp == null) ? 1 : o.amp;
  // 1) 大きなうねり。岩全体のシルエットを決める
  for(let i=0;i<pos.count;i++){
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n1 = lumpNoise(x, y, z, 1.55, seed) - 0.5;
    const n2 = lumpNoise(x, y, z, 3.30, seed+3.3) - 0.5;
    let k = 1 + (n1*0.52 + n2*0.20)*amp;
    if(strat) k *= 1 + Math.sin(y*5.5 + seed*2.1)*0.050*strat + Math.sin(y*11.3 + seed)*0.024*strat;
    k = Math.max(0.42, k);
    pos.setXYZ(i, x*k, y*k, z*k);
  }
  /* 2) 平面で切り落として角のある面を作る。ノイズの変位だけだと「じゃがいも」にしかならず、
        割れた岩の平らな面が出ない。切るだけなので半径は増えない(枠を超えない)。 */
  const cuts = (o.cuts == null) ? 4 : o.cuts;
  for(let c=0;c<cuts;c++){
    const a = hash2(seed*1.3 + c*2.7, c*1.9)*Math.PI*2;
    const b = (hash2(seed*2.9 + c*1.1, c*3.3) - 0.5)*1.5;
    const cb = Math.cos(b);
    const nx = Math.cos(a)*cb, ny = Math.sin(b), nz = Math.sin(a)*cb;
    const d = 0.70 + hash2(seed*4.1 + c, c*5.3)*0.26;
    for(let i=0;i<pos.count;i++){
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const t = x*nx + y*ny + z*nz - d;
      if(t > 0) pos.setXYZ(i, x - nx*t, y - ny*t, z - nz*t);
    }
  }
  /* 3) 細かいザラつきは切ったあとに乗せる。先に乗せると切り口で削られてしまい、
        大きな平らな面だけが残って「低ポリの宝石」に見えてしまう。 */
  for(let i=0;i<pos.count;i++){
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, y, z) || 1;
    const n3 = lumpNoise(x, y, z, 7.40, seed+7.1) - 0.5;
    const n4 = lumpNoise(x, y, z, 15.1, seed+11.7) - 0.5;
    const n5 = lumpNoise(x, y, z, 31.3, seed+17.3) - 0.5;
    const d = (n3*0.17 + n4*0.085 + n5*0.040)*amp;
    pos.setXYZ(i, x + x/r*d, y + y/r*d, z + z/r*d);
  }
  // つぶす(平たい岩)のは最後。先につぶすと切り口の角度まで寝てしまう
  if(flat !== 1) for(let i=0;i<pos.count;i++) pos.setY(i, pos.getY(i)*flat);
  geo.computeVertexNormals();
  return geo;
}

/* ---- シルエットを作り分けるための3つの操作 ----
   同じ「でこぼこの塊」を色だけ変えて並べると、数を増やすほど作り物に見える。
   丸い塊しか無いのが原因なので、稜(りょう)を立てる・割る・平たくする の3手を
   足して、1つの種類の中に【違う種類の岩】が混ざるようにする。
   どれも頂点を動かすだけなので三角形は1つも増えない。                        */

/* 稜を立てる。ang の向きへ背骨を通し、直交方向を細めて屋根形にする。 */
function crestGeo(geo, ang, narrow, rise){
  const pos = geo.attributes.position;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  for(let i=0;i<pos.count;i++){
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const along = x*ca + z*sa;          // 背骨に沿う成分
    const side  = -x*sa + z*ca;         // 背骨と直交する成分
    const s2 = side*narrow;
    const k = Math.max(0, 1 - Math.abs(side));   // 1=背骨の真上
    const ny = y + rise*k*k*(y > 0 ? 1 : 0.15);
    pos.setXYZ(i, ca*along - sa*s2, ny, sa*along + ca*s2);
  }
  geo.computeVertexNormals();
  return geo;
}

/* 割る。ang 向きの面に沿ってV字の裂け目を彫り、両側を少し押し広げる。
   塊を2つ作らずに「割れた岩」に見せるので三角形は増えない。 */
function cleaveGeo(geo, ang, width, depth, gap){
  const pos = geo.attributes.position;
  const nx = Math.cos(ang), nz = Math.sin(ang);
  for(let i=0;i<pos.count;i++){
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = x*nx + z*nz;
    const a = Math.abs(t);
    if(a >= width) continue;
    const k = 1 - a/width;
    const sg = t >= 0 ? 1 : -1;
    pos.setXYZ(i, x + nx*sg*gap*k, y - depth*k*k*Math.max(0, y), z + nz*sg*gap*k);
  }
  geo.computeVertexNormals();
  return geo;
}

/* 岩のシルエットを4通りに作り分ける。中身が「違う種類の岩」になるように分ける:
   0=丸みのある塊 / 1=稜の立った岩 / 2=割れた岩 / 3=平たい岩床(小さい塊が乗る)
   flat=全体のつぶし具合 / strat=水平の層(堆積岩)                             */
function rockSilhouette(variant, s, opt){
  const o = opt || {};
  const flat = (o.flat == null) ? 0.60 : o.flat;
  const strat = o.strat || 0;
  const D = (o.detail == null) ? ROCK_DETAIL : o.detail;
  if(variant === 1){
    const g = boulderGeo(s, flat*1.12, { detail:D, amp:0.95, cuts:7, strat });
    return crestGeo(g, s*1.7, 0.62, 0.34);
  }
  if(variant === 2){
    const g = boulderGeo(s, flat*0.95, { detail:D, amp:1.12, cuts:5, strat });
    return cleaveGeo(g, s*2.3, 0.52, 0.60, 0.09);
  }
  if(variant === 3){
    const a = boulderGeo(s, flat*0.50, { detail:D, amp:1.18, cuts:4, strat: strat || 1.1 });
    const b = boulderGeo(s + 5.7, 0.62, { detail:2, amp:1.20, cuts:3 });
    b.scale(0.46, 0.44, 0.46);
    b.translate(0.32, 0.50, -0.20);
    return mergeGeos([a, b]);
  }
  return boulderGeo(s, flat, { detail:D, amp:0.90, cuts:4, strat });
}

/* 角を1つずつ削った箱。石積みの石・板材に使う。
   まっすぐな箱を並べると「棒グラフ」に見えるが、角を不揃いにすると
   手で割った石に見える。頂点を動かすだけなので三角形は12枚のまま。          */
function chipBox(w, h, d, seed, amt){
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.attributes.position;
  const a = (amt == null) ? 0.15 : amt;
  for(let i=0;i<pos.count;i++){
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // 同じ角の頂点(面ごとに複製されている)へ必ず同じずらしを与える
    const k = seed + (x < 0 ? 0 : 1)*1.7 + (y < 0 ? 0 : 1)*3.1 + (z < 0 ? 0 : 1)*5.3;
    const f = (u)=> (hash2(k*1.3 + u, k*2.7 - u) - 0.5)*2*a;
    pos.setXYZ(i, x*(1 + f(1)), y*(1 + f(2)), z*(1 + f(3)));
  }
  g.computeVertexNormals();
  return g;
}

// 幹・柱。根元がy0、上へ伸ばす
function trunkGeo(rBot, rTop, h, y0, seg){
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg||7, 1, false);
  g.translate(0, y0 + h/2, 0);
  return g;
}

/* 木の幹。根張り(根元だけ太くする)・わずかな曲がり・樹皮の縦溝を入れる。
   まっすぐな円柱を1本立てると「茶色い棒」にしか見えないので、この3つは必ず入れる。 */
function barkTrunkGeo(rBot, rTop, h, y0, opt){
  const o = opt || {};
  const seg = o.seg || 9, rows = o.rows || 6;
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, rows, false);
  const pos = g.attributes.position;
  const lean = o.lean || 0, bend = o.bend || 0, seed = o.seed || 0;
  for(let i=0;i<pos.count;i++){
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = Math.max(0, Math.min(1, (y + h/2) / h));      // 0=根元 1=先
    const r = Math.hypot(x, z);
    let nx = x, nz = z;
    if(r > 1e-4){
      const ang = Math.atan2(z, x);
      // 根張り: 根元だけ放射状に膨らませる
      const flare = 1 + Math.pow(1-t, 3.0) * (o.flare == null ? 0.55 : o.flare)
                        * (0.55 + angNoise(ang + seed, 0.3, 7)*0.9);
      // 樹皮の縦溝
      const groove = 1 - angNoise(ang + seed*0.7, t*3.0 + seed, o.grooves || 11) * (o.groove == null ? 0.09 : o.groove);
      nx = x*flare*groove; nz = z*flare*groove;
    }
    // 曲がり(下ほど動かさない)
    const off = lean*t + bend*Math.sin(t*2.2 + seed);
    pos.setXYZ(i, nx + off, y, nz + off*0.35);
  }
  g.computeVertexNormals();
  g.translate(0, y0 + h/2, 0);
  return g;
}

// 縦の筋(柱状節理・サボテンの畝)を付ける
function ribbed(geo, count, amp){
  const pos = geo.attributes.position;
  for(let i=0;i<pos.count;i++){
    const x = pos.getX(i), z = pos.getZ(i);
    const k = 1 + Math.cos(Math.atan2(z, x)*count)*amp;
    pos.setXYZ(i, x*k, pos.getY(i), z*k);
  }
  geo.computeVertexNormals();
  return geo;
}

/* 葉のかたまり。小さな塊をたくさん散らして作る。大きな球を2〜3個置くより
   輪郭がでこぼこになり、「低ポリのボール」に見えなくなる。
   置ける範囲(rx, ry)は OBST_SHAPES の輪郭からはみ出さない値を渡すこと。 */
function canopyGeo(seed, cy, rx, ry, blobs, colLow, colHigh){
  const parts = [];
  for(let i=0;i<blobs;i++){
    const a = seed*1.7 + i*2.399963;                       // 黄金角で偏りなく散らす
    const rr = Math.sqrt((i + 0.6)/blobs);
    const px = Math.cos(a)*rx*rr*0.62;
    const pz = Math.sin(a)*rx*rr*0.62;
    const py = cy + (hash2(seed+i*1.3, i*2.7) - 0.45)*ry*0.86;
    const sz = (rx*0.40) * (0.62 + hash2(seed*2.1+i, i*3.3)*0.62);
    const g = boulderGeo(seed + i*1.9, 0.82, { detail:1, amp:1.25 });
    g.scale(sz, sz*0.92, sz);
    g.translate(px, py, pz);
    // 上ほど明るい(空の光)。塊ごとに少し色を変えて単調さを消す
    const k = 0.82 + hash2(seed*3.7+i, i*1.1)*0.36;
    paintGeo(g, mixColor(colLow, colHigh, 0.1).multiplyScalar(k),
                colHigh.clone().multiplyScalar(k), py - sz, py + sz, 0.34);
    cavityShade(g, 0.34, 0.18);
    parts.push(g);
  }
  return mergeGeos(parts);
}

/* 種類ごとの3Dモデル。すべて「当たり判定の半径=1、地面=y0」のローカル空間で作る。
   全高は data.js の OBST_SHAPES.h と揃えること(2Dのくり抜きがこの値を見る)。   */
function obstacleGeo(flavor, variant){
  const s = variant*2.7 + 1.3;
  const frac = (v)=>{ const f = v - Math.floor(v); return f; };
  const sh = shapeOf(flavor);
  switch(flavor){
    case 'sandrock': {
      /* 砂岩: 風で削れた水平の層。3通りの形(平たい塊 / 割れた台 / 重なった板)。
         色はテーマの砂利・高地色から作る(砂漠以外に出しても浮かない)が、
         【遮蔽物として一目で分かること】が要るので地面との明暗差だけは必ず確保する。 */
      const lo = coverRock(mixColor(themeColor('steep'), themeColor('gravel'), 0.35).multiplyScalar(0.85), 0.86);
      const hi = coverRock(mixColor(themeColor('high'), themeColor('gravel'), 0.45).multiplyScalar(1.12), 1.00);
      // 砂岩は全体に平たく、層(strat)を強く出す。4通りの作り分けは岩と同じ
      const g = rockSilhouette(variant, s, { flat:0.40, strat:1.8 });
      fitBounds(g, 1.00, 0, sh.h);
      paintGeo(g, lo, hi, 0, sh.h, 0.42);
      cavityShade(g, 0.32, 0.24);
      patchTint(g, hi.clone().multiplyScalar(1.35), 0.45, s*5.3, 6.0);
      // 風で吹き溜まった砂が上面と割れ目にたまる
      patchTint(g, themeColor('high').multiplyScalar(0.98), 0.30, s*1.7, 2.8);
      return g;
    }
    case 'snowrock': {
      // 雪をかぶった岩。岩肌はテーマの岩色、雪はテーマの高地色(=雪面)から。
      // 雪原では地面も岩も白くなるので、岩肌側は必ず地面より暗く落として輪郭を残す
      const lo = coverRock(liftColor(themeColor('steep').multiplyScalar(0.85), 0.016), 0.72);
      const hi = coverRock(liftColor(mixColor(themeColor('steep'), themeColor('gravel'), 0.6).multiplyScalar(1.10), 0.050), 0.92);
      const snow = themeColor('high').multiplyScalar(1.06);
      const g = rockSilhouette(variant, s, { flat:0.66, strat:0.5 });
      fitBounds(g, 1.00, 0, sh.h);
      paintGeo(g, lo, hi, 0, sh.h, 0.40);
      cavityShade(g, 0.32, 0.20);
      patchTint(g, lo.clone().multiplyScalar(0.75), 0.40, s*4.7, 6.0);
      /* 雪は上面へ積もる。**かぶせすぎないこと。**
         0.66の高さから0.95の強さで乗せていた頃は、見下ろす角度だと岩が
         「雪の白い塊」にしかならず、雪原の上では平らな模様に見えると
         実機で report された(2026-08-14)。肩から下は岩肌を残す。      */
      tintTop(g, snow, sh.h*0.80, sh.h*1.05, 0.72);
      patchTint(g, snow, 0.26, s*2.3, 1.7);
      return g;
    }
    case 'basalt': {
      /* 溶岩が固まった黒い柱(柱状節理)。太い1本のまわりに細い柱を寄せ、
         柱の頭を割って高さをばらす。足元に崩れた岩片を置くと「置き物」感が消える。 */
      const parts = [];
      const n = 4 + (variant % 3);
      for(let i=0;i<n;i++){
        const a = s*1.3 + i*2.2, d = i===0 ? 0 : 0.40;
        const rr = i===0 ? 0.46 : (0.22 + frac(i*0.41 + s)*0.10);
        const hh = i===0 ? sh.h*0.99 : (sh.h*0.42 + frac(i*0.37 + s)*sh.h*0.34);
        const c = ribbed(new THREE.CylinderGeometry(rr*0.92, rr, hh, 6, 3), 6, 0.055);
        // 柱の頭を斜めに割る
        const cp = c.attributes.position;
        for(let k=0;k<cp.count;k++){
          const y = cp.getY(k);
          if(y > hh*0.40) cp.setY(k, y - (Math.cos(Math.atan2(cp.getZ(k), cp.getX(k)) + i)*0.5 + 0.5)*hh*0.10);
        }
        c.computeVertexNormals();
        c.translate(0, hh/2 - 0.06, 0);
        c.rotateZ((i===0 ? 0.03 : 0.10) * (i%2 ? 1 : -1));
        c.translate(Math.cos(a)*d, 0, Math.sin(a)*d);
        parts.push(c);
      }
      // 崩れた岩片
      for(let i=0;i<3;i++){
        const a = s*2.1 + i*2.5;
        const r = 0.16 + frac(i*0.7+s)*0.10;
        const g = boulderGeo(s+i*2.3, 0.7, { detail:1 });
        g.scale(r, r, r);
        g.translate(Math.cos(a)*0.72, r*0.5, Math.sin(a)*0.72);
        parts.push(g);
      }
      const geo = mergeGeos(parts);
      fitBounds(geo, 1.00, 0, sh.h);
      /* 【落とし穴】玄武岩を「テーマの岩色をほぼ黒まで落とした色」で塗ると、
         アルベドが小さすぎて空の映り込み(鏡面反射)のほうが勝ち、赤い世界の中で
         1本だけ無彩色のグレーの柱に見える。黒い岩でも必ずその場の色を混ぜ、
         明るさの下限を上げておく(材質側の env も下げてある)。               */
      const lo = coverRock(liftColor(mixColor(themeColor('steep'), themeColor('scrub'), 0.22).multiplyScalar(0.72), 0.007), 0.78);
      const hi = coverRock(liftColor(mixColor(themeColor('gravel'), themeColor('haze'), 0.12).multiplyScalar(0.95), 0.018), 0.86);
      paintGeo(geo, lo, hi, 0, sh.h, 0.30);
      cavityShade(geo, 0.36, 0.26);
      return geo;
    }
    case 'deadtree': {
      /* 枯れ木。OBST_SHAPES の輪郭は幹だけなので、枝は自由に伸ばしてよい
         (枝は2Dのくり抜き対象外 = 枝の隙間から奥が見えるのが正しい)。
         幹を曲げ、枝は元から先へ細くし、さらに小枝を出して「棒に枝3本」を脱する。 */
      const parts = [ barkTrunkGeo(0.21, 0.055, sh.h*0.99, 0,
        { seg:9, rows:7, lean:0.05*(variant%2?1:-1), bend:0.035, seed:s, flare:0.75, grooves:9, groove:0.12 }) ];
      const nb = 5 + (variant % 3);
      for(let i=0;i<nb;i++){
        const y0 = sh.h*(0.40 + i*0.105) + frac(i*0.53+s)*0.06;
        const len = sh.h*(0.52 - i*0.055) * (0.8 + frac(i*0.31+s)*0.4);
        const tilt = 0.55 + frac(i*0.77+s)*0.55;
        const yaw = s*1.7 + i*2.399963;
        const r0 = 0.075 * (1 - i*0.09);
        const b = new THREE.CylinderGeometry(r0*0.30, r0, len, 5, 2);
        // 枝を少し反らせる
        const bp = b.attributes.position;
        for(let k=0;k<bp.count;k++){
          const t = (bp.getY(k) + len/2)/len;
          bp.setX(k, bp.getX(k) + t*t*len*0.10);
        }
        b.computeVertexNormals();
        b.translate(0, len/2, 0);
        b.rotateZ(tilt);
        b.rotateY(yaw);
        b.translate(0, y0, 0);
        parts.push(b);
        // 小枝(2本目の分岐)。細い線が増えると一気に枯れ木らしくなる
        if(i < 4){
          const ln2 = len*0.5;
          const b2 = new THREE.CylinderGeometry(r0*0.14, r0*0.34, ln2, 4);
          b2.translate(0, ln2/2, 0);
          b2.rotateZ(tilt + 0.5*(i%2?1:-1));
          b2.rotateY(yaw + 0.5);
          b2.translate(Math.sin(tilt)*Math.cos(yaw)*len*0.62, y0 + Math.cos(tilt)*len*0.6, Math.sin(tilt)*Math.sin(yaw)*len*0.62);
          parts.push(b2);
        }
      }
      const geo = mergeGeos(parts);
      const bark = barkColor(0.30);
      paintGeo(geo, bark.clone().multiplyScalar(0.58), bark.clone().multiplyScalar(1.30), 0, sh.h, 0.34);
      cavityShade(geo, 0.34, 0.22);
      return geo;
    }
    case 'pine': {
      /* 雪をかぶった針葉樹。円錐を3段重ねるのは輪郭が OBST_SHAPES と一致するため
         (段の位置・半径は変えられない)。その代わり縁をギザギザに欠けさせ(内向きのみ)、
         枝先を垂らして「三角形3つ」に見えないようにする。                       */
      const needleBase = liftColor(mixColor(NEEDLE_CORE, mixColor(themeColor('scrub'), themeColor('steep'), 0.45), 0.34), 0.030);
      const needleLow  = needleBase.clone().multiplyScalar(0.68);
      const needleHigh = needleBase.clone().multiplyScalar(1.30);
      const snow = themeColor('high').multiplyScalar(1.06);
      const parts = [ paintGeo(barkTrunkGeo(0.14, 0.09, 0.80, 0, { seg:7, rows:3, seed:s, flare:0.5, grooves:7 }),
                               needleLow.clone().multiplyScalar(0.75), needleLow.clone().multiplyScalar(1.15), 0, 0.80, 0.2) ];
      const bases = [0.52, 1.12, 1.72], rs = [0.98, 0.78, 0.54], hs = [1.18, 1.10, 0.98];
      for(let i=0;i<3;i++){
        const c = new THREE.ConeGeometry(rs[i], hs[i], 14, 3, true);
        const cp = c.attributes.position;
        for(let k=0;k<cp.count;k++){
          const x = cp.getX(k), y = cp.getY(k), z = cp.getZ(k);
          const r = Math.hypot(x, z);
          if(r < 1e-4) continue;
          const ang = Math.atan2(z, x);
          const t = (y + hs[i]/2) / hs[i];                    // 0=段の下端 1=段の上端
          // 内向きにだけ欠けさせる(外へ出すと輪郭とずれて奥が透ける)
          const jag = 1 - angNoise(ang + s + i*1.7, t*2.0, 14)*0.30;
          // 下の縁だけ垂らす = 枝が下がった針葉樹の形
          const droop = (t < 0.14) ? -hs[i]*0.16*(0.14 - t)/0.14 : 0;
          cp.setXYZ(k, x*jag, y + droop, z*jag);
        }
        c.computeVertexNormals();
        c.translate(0, bases[i] + hs[i]/2, 0);
        c.rotateY(s*0.9 + i*1.1);
        paintGeo(c, needleLow, needleHigh, bases[i], bases[i]+hs[i], 0.30);
        cavityShade(c, 0.30, 0.22);
        tintTop(c, snow, bases[i]+hs[i]*0.52, bases[i]+hs[i]*1.00, 0.85);
        parts.push(c);
      }
      return mergeGeos(parts);
    }
    case 'tree': {
      /* ジャングルの広葉樹。輪郭(OBST_SHAPES)は「幹の箱 + 樹冠の楕円(中心1.80/横0.90/縦0.82)」。
         樹冠はその楕円の中に小さな葉の塊を10個ほど散らして作る = 輪郭がでこぼこになる。 */
      const leafBase = liftColor(mixColor(themeColor('scrub'), themeColor('low'), 0.32), 0.075);
      const leafLow  = leafBase.clone().multiplyScalar(0.70);
      const leafHigh = leafBase.clone().multiplyScalar(1.28);
      const bark = barkColor(0.34);
      const trunkH = 1.62;
      const trunk = barkTrunkGeo(0.22, 0.12, trunkH, 0,
        { seg:9, rows:6, lean:0.045*(variant%2?1:-1), bend:0.03, seed:s, flare:0.65, grooves:10, groove:0.11 });
      paintGeo(trunk, bark.clone().multiplyScalar(0.60), bark.clone().multiplyScalar(1.20), 0, trunkH, 0.30);
      cavityShade(trunk, 0.40, 0.15);
      const parts = [trunk];
      // 樹冠へ伸びる枝(幹と葉のつなぎ目が消えて自然になる)
      for(let i=0;i<3;i++){
        const yaw = s + i*2.1, len = 0.62;
        const b = new THREE.CylinderGeometry(0.035, 0.085, len, 5);
        b.translate(0, len/2, 0);
        b.rotateZ(0.75);
        b.rotateY(yaw);
        b.translate(0, trunkH - 0.12, 0);
        paintGeo(b, bark.clone().multiplyScalar(0.60), bark.clone().multiplyScalar(1.05), trunkH-0.2, trunkH+0.5, 0.2);
        parts.push(b);
      }
      parts.push(canopyGeo(s, 1.80, 0.86, 0.78, 10 + (variant % 3), leafLow, leafHigh));
      return mergeGeos(parts);
    }
    case 'log': {
      /* 倒木。丸太の樹皮に縦の溝と割れを入れ、切り口の年輪を見せ、上面に苔を乗せる。
         輪郭は横倒しの箱なので、太さと長さは変えない。 */
      const body = new THREE.CylinderGeometry(0.27, 0.31, 1.75, 12, 4);
      const bp = body.attributes.position;
      for(let i=0;i<bp.count;i++){
        const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
        const r = Math.hypot(x, z);
        if(r < 1e-4) continue;
        const ang = Math.atan2(z, x);
        const k = 1 - angNoise(ang + s, (y+0.9)*1.6 + s, 12)*0.14;
        bp.setXYZ(i, x*k, y, z*k);
      }
      body.computeVertexNormals();
      body.rotateZ(Math.PI/2);
      body.translate(0, 0.30, 0);
      const parts = [body];
      // 折れた枝の付け根を2本
      for(let i=0;i<2;i++){
        const stub = new THREE.CylinderGeometry(0.055, 0.095, 0.42, 5);
        stub.rotateZ(0.9 - i*0.4); stub.rotateY(s + i*2.2);
        stub.translate(0.25 - i*0.55, 0.42, 0.10 - i*0.16);
        parts.push(stub);
      }
      const geo = mergeGeos(parts);
      const bark = barkColor(0.28);
      paintGeo(geo, bark.clone().multiplyScalar(0.55), bark.clone().multiplyScalar(1.25), 0, 0.62, 0.32);
      cavityShade(geo, 0.36, 0.22);
      // 苔はテーマの草色から。乾いたマップでは苔の色も乾いた色になる
      patchTint(geo, mixColor(themeColor('scrub'), themeColor('low'), 0.42), 0.70, s*1.9, 2.6);
      return geo;
    }
    case 'palm': {
      /* ヤシ。輪郭は「細い幹の箱 + 上の平たい楕円」。
         葉を平たい円錐ではなく、垂れ下がる帯(leafGeo)にして小葉の切れ込みを付ける。
         傾けすぎると2Dのくり抜き(縦の箱)が幹より太くなってしまうので控えめにする。 */
      const trunkH = 2.80;
      const trunk = barkTrunkGeo(0.17, 0.095, trunkH, 0,
        { seg:9, rows:6, lean:0.10, bend:0.05, seed:s, flare:0.60, grooves:14, groove:0.055 });
      // ヤシは葉の落ちた跡が横縞になる
      const tp = trunk.attributes.position;
      for(let i=0;i<tp.count;i++){
        const y = tp.getY(i);
        const k = 1 - Math.pow(Math.abs(Math.sin(y*7.5 + s)), 6)*0.10;
        tp.setXYZ(i, tp.getX(i)*k, y, tp.getZ(i)*k);
      }
      trunk.computeVertexNormals();
      const barkLo = barkColor(0.26).multiplyScalar(0.85);
      const barkHi = mixColor(barkColor(0.20), themeColor('high'), 0.30).multiplyScalar(1.15);
      paintGeo(trunk, barkLo, barkHi, 0, trunkH, 0.30);
      cavityShade(trunk, 0.38, 0.16);
      const parts = [trunk];
      const tx = Math.sin(0.05)*trunkH + 0.10, ty = Math.cos(0.05)*trunkH;
      const palmBase = liftColor(mixColor(themeColor('scrub'), themeColor('low'), 0.28), 0.085);
      const leafLow  = palmBase.clone().multiplyScalar(0.70);
      const leafHigh = palmBase.clone().multiplyScalar(1.26);
      const nf = 9 + (variant % 3);
      for(let i=0;i<nf;i++){
        const yaw = s + i*(Math.PI*2/nf) + hash2(i*1.7, s)*0.25;
        const len = 1.32 * (0.84 + hash2(i*2.3, s*1.9)*0.30);
        const leaf = leafGeo(len, 0.150, 0.46, 6);
        // 小葉の切れ込み: 帯を左右に細かく振って羽状に見せる
        const lp = leaf.attributes.position;
        for(let k=0;k<lp.count;k++){
          const t = Math.max(0, Math.min(1, lp.getY(k)/len));
          lp.setZ(k, lp.getZ(k) + Math.sin(t*22 + i)*0.020*(k%2 ? 1 : -1));
        }
        leaf.computeVertexNormals();
        // 中央で折って樋(とい)の形にすると、平らな板に見えない
        for(let k=0;k<lp.count;k++) lp.setZ(k, lp.getZ(k) - Math.abs(lp.getX(k))*0.55);
        leaf.computeVertexNormals();
        // 葉は薄いので裏からも見える形にしておく(裏返ると消えてしまう)
        const both = doubleSided(leaf, 0.45);
        both.rotateZ(Math.PI*0.40 + (i%3)*0.05);
        both.rotateY(yaw);
        both.translate(tx, ty - 0.05, 0);
        paintGeo(both, leafLow, leafHigh, ty-0.5, ty+0.3, 0.28);
        parts.push(both);
      }
      // 実(小さな球)。首もとに数個
      for(let i=0;i<4;i++){
        const a = s*1.3 + i*1.6;
        const nut = new THREE.IcosahedronGeometry(0.075, 0);
        nut.translate(tx + Math.cos(a)*0.13, ty - 0.16, Math.sin(a)*0.13);
        paintGeo(nut, barkLo.clone().multiplyScalar(0.9), barkHi, ty-0.25, ty-0.05, 0.15);
        parts.push(nut);
      }
      return mergeGeos(parts);
    }
    case 'shell': {
      /* 貝殻。放射状の筋を持つ扇形(ホタテ)にして、縁を波打たせ、蝶番側を持ち上げる。
         内側は明るく、外側は砂で汚れた色。ツヤは材質側(roughness低め)で出す。 */
      const g = new THREE.SphereGeometry(1, 22, 7, 0, Math.PI*2, 0, Math.PI*0.5);
      const pos = g.attributes.position;
      for(let i=0;i<pos.count;i++){
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const ang = Math.atan2(z, x);
        const r = Math.hypot(x, z);
        const rib = Math.cos(ang*11 + s);
        const k = 1 + rib*0.085;
        // 縁(r が大きい所)を波打たせる
        const wave = Math.cos(ang*11 + s)*0.055*Math.pow(r, 3);
        pos.setXYZ(i, x*k, y*0.50*(1 + rib*0.20) + wave + x*0.10, z*k);
      }
      g.computeVertexNormals();
      const lo = mixColor(themeColor('gravel'), themeColor('steep'), 0.35).multiplyScalar(1.05);
      const hi = themeColor('high').multiplyScalar(1.18);
      fitBounds(g, 1.02, 0, sh.h);
      paintGeo(g, lo, hi, 0, sh.h, 0.16);
      cavityShade(g, 0.30, 0.24);
      return g;
    }
    case 'cactus': {
      /* サボテン。畝を深くし、上下で太さを変え、刺座(白い点)の代わりに畝の稜線を
         明るくして質感を出す。腕は幹に寄せる(離すと2Dのくり抜きが広がりすぎる)。 */
      /* 【全高を表に合わせる】胴+笠の高さが 2.365 しかなく、OBST_SHAPES の 2.45 より
         0.085 低かった(2Dのくり抜きだけが上へ0.085はみ出していた)。
         笠だけ上げると胴との間に隙間ができるので、胴を伸ばして辻褄を合わせる。 */
      const capR = 0.30, capH = capR*0.55, bodyH = sh.h - capH;   // 2.45 = 胴 + 笠
      const body = ribbed(new THREE.CylinderGeometry(0.30, 0.36, bodyH, 16, 6), 9, 0.13);
      const bp = body.attributes.position;
      for(let i=0;i<bp.count;i++){
        const y = bp.getY(i);
        const k = 1 - Math.pow(Math.max(0, (y + bodyH/2)/bodyH - 0.80)/0.20, 2)*0.10;   // 先だけ細く
        bp.setXYZ(i, bp.getX(i)*k, y, bp.getZ(i)*k);
      }
      body.computeVertexNormals();
      body.translate(0, bodyH/2, 0);
      const cap = new THREE.SphereGeometry(capR, 14, 5, 0, Math.PI*2, 0, Math.PI*0.5);
      ribbed(cap, 9, 0.10);
      cap.scale(1, 0.55, 1); cap.translate(0, bodyH, 0);
      const parts = [body, cap];
      for(let i=0;i<2;i++){
        const sg = i ? -1 : 1;
        const y0 = 1.0 + i*0.34;
        const arm = ribbed(new THREE.CylinderGeometry(0.135, 0.135, 0.34, 10), 7, 0.09);
        arm.rotateZ(Math.PI/2); arm.translate(sg*0.24, y0, 0);
        const up = ribbed(new THREE.CylinderGeometry(0.125, 0.145, 0.78, 10, 3), 7, 0.10);
        up.translate(sg*0.38, y0 + 0.39, 0);
        const tip = new THREE.SphereGeometry(0.125, 10, 4, 0, Math.PI*2, 0, Math.PI*0.5);
        tip.scale(1, 0.7, 1); tip.translate(sg*0.38, y0 + 0.78, 0);
        const a = mergeGeos([arm, up, tip]);
        a.rotateY(s*1.3 + i*2.4);
        parts.push(a);
      }
      const geo = mergeGeos(parts);
      /* 色: テーマ色だけで作ると砂漠では「砂と同じ白ベージュの棒」になり、
         遮蔽物かどうかが一目で分からなくなる。サボテンの緑という個性は芯として残し、
         そこへその場の色を混ぜて馴染ませたうえで、地面との明暗差を確保する。 */
      const cacBase = plantColor(CACTUS_CORE, 0.34, 1.30, 1.70);
      const lo = cacBase.clone().multiplyScalar(0.62);
      const hi = cacBase.clone().multiplyScalar(1.24);
      paintGeo(geo, lo, hi, 0, sh.h, 0.18);
      cavityShade(geo, 0.34, 0.22);
      return geo;
    }
    case 'crystal': {
      /* 尖った水晶。1本の大きな結晶のまわりに小さい結晶を生やす。
         面を斜めに切って先端を作り、根元に砕けた欠片を置く。 */
      const parts = [];
      const n = 4 + (variant % 2);
      for(let i=0;i<n;i++){
        const a = s + i*2.399963, d = i===0 ? 0 : (0.26 + frac(i*0.4+s)*0.16);
        const hh = i===0 ? 1.82 : (0.60 + frac(i*0.5 + s)*0.72);
        const rr = i===0 ? 0.38 : (0.13 + frac(i*0.9+s)*0.13);
        const c = new THREE.CylinderGeometry(rr*0.22, rr, hh*0.72, 6, 1);
        const tipG = new THREE.ConeGeometry(rr*0.22, hh*0.28, 6);
        tipG.translate(0, hh*0.50, 0);
        const cc = mergeGeos([c, tipG]);
        cc.translate(0, hh*0.36 - 0.10, 0);
        cc.rotateZ((i===0 ? 0.04 : 0.30) * (i%2 ? 1 : -1));
        cc.rotateY(a);
        cc.translate(Math.cos(a)*d, 0, Math.sin(a)*d);
        parts.push(cc);
      }
      const geo = mergeGeos(parts);
      fitBounds(geo, 0.95, 0, sh.h);
      /* 氷・水晶。テーマ色だけで作ると雪原では「ほぼ白」になって雪岩と見分けが付かない。
         氷の水色を芯にしてその場の空色を混ぜ、雪面より必ず濃い色にする。         */
      const ice = crystalColor();
      const lo = mixColor(ice, themeColor('steep'), 0.22).multiplyScalar(0.80);
      const hi = mixColor(ice, themeColor('high'), 0.20).multiplyScalar(1.35);
      paintGeo(geo, lo, hi, 0, sh.h, 0.10);
      cavityShade(geo, 0.26, 0.30);
      return geo;
    }
    /* ---- 人工物(身を隠すための遮蔽物) ----
       当たり判定は他の障害物と同じ「半径の円」なので中には入れない。陰に隠れる塊。
       【寸法は data.js の OBST_SHAPES が正】。render.js の2Dくり抜きが同じ表を読むので、
       ここを変えたら必ず表も直すこと。fitBounds で sh.h に合わせてある。
       色は「人が作った物」に見せたいので自然物より彩度と明度の差を強く取り、
       遮蔽物として一目で分かるようにする(coverRock と同じ考え方)。          */
    case 'ruinwall': {
      /* 崩れた石壁。前は「縦に5本の板」で棒グラフに見えていたので、
         【石を1つずつ積む】形へ作り直した。段ごとに継ぎ目をずらし(=芋目地にしない)、
         上の段・端ほど石が落ちて欠ける。石はひとつずつ角を削って不揃いにする。
         箱1つは12枚しかないので、20個積んでも三角形は240枚で済む。         */
      const parts = [];
      const bw = 0.94, bh = 1.58, bt = 0.30;
      const courses = 5, perRow = 4;
      const rowH = bh/courses;
      for(let c=0;c<courses;c++){
        const stagger = (c % 2) ? 0.5 : 0;            // 段ごとに半個ずらす
        for(let i=-1;i<=perRow;i++){
          const t = (i + stagger + 0.5)/perRow - 0.5;
          if(Math.abs(t) > 0.5) continue;
          // 上の段ほど、端ほど崩れて欠けている
          /* 崩れ方。強くしすぎると石が飛び飛びになって「積んだ壁」に見えなくなる
             (最初 0.55/0.55 で作ったら、ばらばらのサイコロが並んだだけになった)。
             欠けるのは上の段と端だけ、下2段は必ず残す。                     */
          const fall = Math.pow(Math.abs(t)*2, 2.2)*0.34 + Math.max(0, c - 1)/(courses-1)*0.46;
          if(frac(s*1.9 + c*2.3 + i*0.71) < fall - 0.26) continue;
          const w = (bw*2/perRow)*(0.94 + frac(c*1.3 + i*0.37 + s)*0.10);
          const d = bt*(0.80 + frac(i*1.11 + c*0.53 + s)*0.36);
          const b = chipBox(w, rowH*0.92, d, s + c*3.1 + i*1.7, 0.16);
          b.rotateY((frac(i*0.53 + c*1.7 + s) - 0.5)*0.14);
          b.translate(t*bw*2, rowH*(c + 0.5), (frac(i*1.31 + c*0.91 + s) - 0.5)*bt*0.34);
          parts.push(b);
        }
      }
      // 崩れ落ちた石。壁のふもとに散らばると「崩れた」と読める
      for(let i=0;i<5;i++){
        const a = s*1.7 + i*1.9;
        const b = chipBox(0.30, 0.17, 0.24, s*2.7 + i*4.1, 0.26);
        b.rotateY(a); b.rotateZ((frac(i*0.61 + s) - 0.5)*0.5);
        b.translate(Math.cos(a)*bw*0.92, 0.09, Math.sin(a)*bt*1.9);
        parts.push(b);
      }
      const geo = mergeGeos(parts);
      fitBounds(geo, 1.00, 0, sh.h);
      // 石壁。地面の岩肌色を芯にして、地面より明るく振って遮蔽物として目立たせる
      const base = coverRock(mixColor(themeColor('steep'), themeColor('gravel'), 0.55), 1.06);
      paintGeo(geo, base.clone().multiplyScalar(0.74), base.clone().multiplyScalar(1.24), 0, sh.h, 0.30);
      cavityShade(geo, 0.40, 0.22);
      // 目地と風化のしみ
      patchTint(geo, base.clone().multiplyScalar(0.62), 0.34, s*3.7, 5.5);
      patchTint(geo, mixColor(themeColor('scrub'), base, 0.5).multiplyScalar(0.95), 0.26, s*1.9, 2.4);
      return geo;
    }
    case 'container': {
      /* 打ち上げられた貨物コンテナ。前は「箱の面をsinで軽く押した」だけで、
         箱の分割数が粗く波板が1周期も入っていなかった(=ただの箱に見えていた)。
         側面と屋根を【別の板として細かく分割し、台形の波板】に作り直す。
         さらに ①四隅の隅金具 ②扉の縦枠と閂(かんぬき) ③ぶつけた凹み
         を足して「工業製品が転がっている」ことが分かるようにする。          */
      const parts = [];
      const cw = 0.96, ch = 1.24, cd = 0.56;
      // 台形の波板の断面。sinより角が立って金属らしい
      const corr = (u)=>{ const t = ((u % 1) + 1) % 1;
        return (t < 0.5 ? (t < 0.25 ? t*4 : 2 - t*4) : (t < 0.75 ? -(t - 0.5)*4 : -(1 - t)*4)); };
      const WAVE = 9, AMP = 0.030;
      // 側面2枚(長手方向)。凹みは低い周波数のふくらみで作る
      for(const sz of [-1, 1]){
        const p = new THREE.PlaneGeometry(cw*2, ch, 22, 3);
        const pp = p.attributes.position;
        for(let i=0;i<pp.count;i++){
          const x = pp.getX(i), y = pp.getY(i);
          const dent = Math.exp(-Math.pow((x - (frac(s)*1.4 - 0.7))*2.2, 2))*0.055*(sz > 0 ? 1 : 0.4);
          pp.setZ(i, corr((x/(cw*2) + 0.5)*WAVE)*AMP - dent);
        }
        p.computeVertexNormals();
        p.rotateY(sz > 0 ? 0 : Math.PI);
        p.translate(0, ch/2, sz*cd);
        parts.push(p);
      }
      // 妻面(短手)。扉のある側は縦枠と閂を付ける
      for(const sx of [-1, 1]){
        const p = new THREE.PlaneGeometry(cd*2, ch, 8, 2);
        const pp = p.attributes.position;
        for(let i=0;i<pp.count;i++) pp.setZ(i, corr((pp.getX(i)/(cd*2) + 0.5)*5)*AMP*0.7);
        p.computeVertexNormals();
        p.rotateY(sx > 0 ? Math.PI/2 : -Math.PI/2);
        p.translate(sx*cw, ch/2, 0);
        parts.push(p);
      }
      // 屋根。波は長手方向に走る
      const top = new THREE.PlaneGeometry(cw*2, cd*2, 20, 2);
      const tp = top.attributes.position;
      for(let i=0;i<tp.count;i++) tp.setZ(i, corr((tp.getX(i)/(cw*2) + 0.5)*WAVE)*AMP);
      top.computeVertexNormals();
      top.rotateX(-Math.PI/2);
      top.translate(0, ch, 0);
      parts.push(top);
      // 上下の縁の桁(波板を挟む枠)
      for(const yy of [0.045, ch - 0.045]){
        for(const sz of [-1, 1]){
          const rim = new THREE.BoxGeometry(cw*2.04, 0.09, 0.07);
          rim.translate(0, yy, sz*cd);
          parts.push(rim);
        }
        for(const sx of [-1, 1]){
          const rim = new THREE.BoxGeometry(0.07, 0.09, cd*2);
          rim.translate(sx*cw, yy, 0);
          parts.push(rim);
        }
      }
      // 四隅の隅金具(コンテナと言えばこれ)
      for(const sx of [-1, 1]) for(const sz of [-1, 1]) for(const sy of [0, 1]){
        const cn = new THREE.BoxGeometry(0.17, 0.13, 0.15);
        cn.translate(sx*(cw - 0.05), sy ? ch - 0.065 : 0.065, sz*(cd - 0.04));
        parts.push(cn);
      }
      // 扉の縦枠2本と閂(かんぬき)
      for(const sx of [-0.44, 0.44]){
        const bar = new THREE.BoxGeometry(0.055, ch*0.86, 0.05);
        bar.translate(sx, ch/2, cd*1.02);
        parts.push(bar);
        const lock = new THREE.BoxGeometry(0.13, 0.09, 0.05);
        lock.translate(sx, ch*0.52, cd*1.04);
        parts.push(lock);
      }
      const geo = mergeGeos(parts);
      fitBounds(geo, 1.00, 0, sh.h);
      // 塗装が褪せた金属。テーマに馴染ませつつ、砂浜より必ず暗くして塊として読ませる
      const paint = contrastTo(mixColor(CONTAINER_PAINT, themeColor('steep'), 0.34), groundRefColor(), 1.45);
      paintGeo(geo, paint.clone().multiplyScalar(0.80), paint.clone().multiplyScalar(1.18), 0, sh.h, 0.16);
      cavityShade(geo, 0.30, 0.24);
      // 錆。上面と縁から垂れるように出す
      patchTint(geo, RUST_CORE.clone().lerp(paint, 0.30), 0.52, s*4.3, 3.1);
      return geo;
    }
    case 'ruinpillar': {
      /* 遺跡の石柱。前は「つるつるの8角柱を3本」で、遠目には煙突に見えていた。
         ①縦溝(フルーティング) ②柱を上下に積んだ継ぎ目(ドラム) ③欠けた角の土台
         ④倒れて転がった柱の輪切り を足して、石を刻んで積んだ物に見せる。       */
      const parts = [];
      const baseH = 0.34;
      // 土台は2段。上段を少し小さくして「刻んだ石」の段差を作る
      for(let k=0;k<2;k++){
        const w = 1.80 - k*0.26;
        const p = chipBox(w, baseH*0.5, w, s*1.7 + k*2.9, 0.05);
        p.translate(0, baseH*(0.25 + k*0.5), 0);
        parts.push(p);
      }
      const hs = [2.06, 1.30, 0.82], rs = [0.30, 0.22, 0.18];
      for(let i=0;i<3;i++){
        const a = s*1.3 + i*2.3, d = i===0 ? 0.06 : 0.52;
        const hh = hs[i]*(0.86 + frac(i*0.61 + s)*0.28);
        // 12角柱に縦溝を彫る。溝があるだけで「加工した石」に見える
        const c = ribbed(new THREE.CylinderGeometry(rs[i]*0.92, rs[i], hh, 12, 5), 12, 0.075);
        const cp = c.attributes.position;
        for(let k=0;k<cp.count;k++){
          const y = cp.getY(k), t = (y + hh/2)/hh;
          // ドラムの継ぎ目。3段に積んだ柱の境目をわずかにくびれさせる
          const seam = 1 - Math.pow(Math.abs(Math.sin(t*Math.PI*3)), 12)*0.055;
          cp.setXYZ(k, cp.getX(k)*seam, y, cp.getZ(k)*seam);
          if(y > hh*0.5 - 0.02){
            // 折れ口。斜めに落として「折れた柱」にする
            cp.setY(k, y - (cp.getX(k)*0.5 + 0.18)*(0.5 + frac(i + s)*0.7));
          }
        }
        c.computeVertexNormals();
        c.translate(0, hh/2 + baseH, 0);
        c.rotateY(a);
        c.translate(Math.cos(a)*d, 0, Math.sin(a)*d);
        parts.push(c);
      }
      // 倒れて転がった輪切り2つ。足元に転がると「遺跡」になる
      for(let i=0;i<2;i++){
        const a = s*2.1 + i*2.7;
        const dr = ribbed(new THREE.CylinderGeometry(0.24, 0.25, 0.30, 10, 1), 10, 0.06);
        dr.rotateZ(Math.PI/2 + (frac(i*0.7 + s) - 0.5)*0.3);
        dr.rotateY(a*1.3);
        dr.translate(Math.cos(a)*0.78, baseH*0.5 + 0.10, Math.sin(a)*0.78);
        parts.push(dr);
      }
      const geo = mergeGeos(parts);
      fitBounds(geo, 1.00, 0, sh.h);
      const base = coverRock(mixColor(themeColor('gravel'), themeColor('high'), 0.42), 1.10);
      paintGeo(geo, base.clone().multiplyScalar(0.76), base.clone().multiplyScalar(1.22), 0, sh.h, 0.22);
      cavityShade(geo, 0.38, 0.26);
      // 苔・風化。密林では緑、砂漠では砂が乗る
      patchTint(geo, mixColor(themeColor('scrub'), base, 0.40).multiplyScalar(0.92), 0.40, s*2.9, 2.8);
      return geo;
    }
    case 'hut': {
      /* 崩れかけた小屋。前は「同じ板を7枚+平らな屋根板1枚」で、板の縁が全部
         そろっていたため“作りかけの箱”に見えていた。板を1枚ずつ反らせ・欠けさせ、
         屋根も1枚板をやめて【垂木の上に屋根板を並べる】形にし、抜けた板から
         向こうが見えるようにする。木材なので角も削って割れ肌にする。         */
      const parts = [];
      const hw = 0.94, hh = 1.02, hd = 0.72;
      // 正面の板壁。上端の高さをばらし、ところどころ抜けている
      const boards = 9;
      for(let i=0;i<boards;i++){
        const t = i/(boards-1) - 0.5;
        if(frac(s*2.3 + i*0.83) < 0.16) continue;                 // 抜けた板
        const bh2 = hh*(0.62 + frac(i*0.43 + s)*0.46);
        const b = chipBox((hw*2/boards)*0.80, bh2, 0.085, s + i*1.9, 0.12);
        b.rotateZ((frac(i*0.29 + s) - 0.5)*0.09);
        b.translate(t*hw*1.92, bh2/2, hd);
        b.rotateY((frac(i*0.77 + s) - 0.5)*0.09);
        parts.push(b);
      }
      // 側面の壁2枚。上端を斜めに落として片流れの屋根と合わせる
      for(const sx of [-1, 1]){
        for(let k=0;k<3;k++){
          const zz = (k/2 - 0.5)*hd*1.7;
          const bh2 = hh*(0.98 - k*0.10)*(0.90 + frac(k*0.7 + sx + s)*0.18);
          const w = chipBox(0.085, bh2, hd*0.60, s*1.3 + k*2.7 + (sx > 0 ? 5 : 0), 0.10);
          w.translate(sx*hw, bh2/2, zz + hd*0.05);
          parts.push(w);
        }
      }
      // 垂木(たるき)2本 + その上の屋根板。抜けた板の隙間から空が見える
      for(const zz of [-hd*0.75, hd*0.75]){
        const beam = chipBox(hw*2.15, 0.075, 0.075, s*3.1 + zz, 0.08);
        beam.rotateX(0.26);
        beam.translate(0, hh + 0.10 + zz*0.13, zz);
        parts.push(beam);
      }
      const planks = 6;
      for(let i=0;i<planks;i++){
        if(frac(s*1.7 + i*1.31) < 0.20) continue;                 // 落ちた屋根板
        const t = (i + 0.5)/planks - 0.5;
        const pl = chipBox((hw*2.2/planks)*0.86, 0.065, hd*2.0, s*4.3 + i*2.1, 0.10);
        pl.rotateX(0.26);
        pl.rotateZ((frac(i*0.53 + s) - 0.5)*0.06);
        pl.translate(t*hw*2.2, hh + 0.15, -0.04);
        parts.push(pl);
      }
      // 支柱。片方は傾いて倒れかけている
      for(let i=0;i<2;i++){
        const sx = i ? 0.86 : -0.86;
        const p = chipBox(0.10, hh*1.16, 0.10, s*5.7 + i*3.3, 0.09);
        p.rotateZ(i ? 0.10 : -0.03);
        p.translate(sx, hh*0.58, -hd*0.86);
        parts.push(p);
      }
      // 落ちた板が足元に転がる
      for(let i=0;i<3;i++){
        const a = s*2.9 + i*2.2;
        const pl = chipBox(0.62, 0.055, 0.14, s*6.1 + i*1.7, 0.14);
        pl.rotateY(a);
        pl.translate(Math.cos(a)*0.72, 0.035, Math.sin(a)*0.62 + hd*0.3);
        parts.push(pl);
      }
      const geo = mergeGeos(parts);
      fitBounds(geo, 1.00, 0, sh.h);
      // 風雪で灰色になった木材。雪原で埋もれないよう地面と明度差を取る
      const wood = contrastTo(mixColor(WOOD_CORE, themeColor('steep'), 0.40), groundRefColor(), 1.55);
      paintGeo(geo, wood.clone().multiplyScalar(0.72), wood.clone().multiplyScalar(1.20), 0, sh.h, 0.34);
      cavityShade(geo, 0.42, 0.20);
      patchTint(geo, wood.clone().multiplyScalar(0.58), 0.36, s*5.1, 4.2);
      return geo;
    }
    default: {
      /* 既定の岩。荒野・火山・ジャングル・海岸に出るので色を決め打ちにすると
         その場だけ浮く。地面と同じテーマ色(岩肌=steep / 砂利=gravel)から作る。
         ただし【隠れられる物として一目で読める】ことがバトロワの要件なので、
         地面との明暗差は coverRock で必ず確保する(岩は全部「隠れられる物」)。
         形は4通り: 丸い塊 / 稜の立った岩 / 割れた岩 / 平たい岩床(rockSilhouette)。 */
      const lo = coverRock(liftColor(themeColor('steep').multiplyScalar(0.85), 0.016), 0.80);
      const hi = coverRock(liftColor(themeColor('gravel').multiplyScalar(1.30), 0.050), 1.05);
      const g = rockSilhouette(variant, s, { flat:0.62 });
      fitBounds(g, 1.00, 0, sh.h);
      paintGeo(g, lo, hi, 0, sh.h, 0.46);
      cavityShade(g, 0.34, 0.26);
      // 鉱脈のような細かい筋。三角形を増やさずに平らな面の単調さを崩す
      patchTint(g, hi.clone().multiplyScalar(1.45), 0.5, s*5.9, 6.5);
      // 上面に苔・地衣類(テーマの草色)。乾いたマップでは色も乾く
      patchTint(g, mixColor(themeColor('scrub'), themeColor('low'), 0.42).multiplyScalar(0.95), 0.34, s*2.7, 2.6);
      return g;
    }
  }
}

/* 材質は種類ごとに1つだけ作り、形の4通りで共有する。
   env(環境光の反射)を下げるのが「プラスチックに見えない」ための要。
   空の映り込みが強いと、どんなに粗くしても表面がツヤっぽくなる。
   sd は表面ディテール(applySurfaceDetail)の設定。ここが「地面と同じ情報量」の中身で、
   種類ごとに粒の細かさ・凹凸の深さ・割れ目の濃さを変える。
   flat=面ごとの平らな陰影。結晶や柱状節理は面が立っているのが正しいので残し、
   岩と人工物は平滑にして凹凸を sd 側に任せる(面が大きいと低ポリに見えるため)。 */
const OBST_MATS = {
  /* 【scale の目安】障害物の半径は30〜80ワールド単位。粒の1周(scale)はその
     1/3以下にしないと「模様が1個ぶんしか乗らない」= 何も無いのと同じになる
     (最初 scale:58 で作って砂岩がのっぺりのままだった)。 */
  rock:     { rough:0.97, env:0.55, flat:false, sd:{ scale:20, bump:0.85, macro:230, crack:0.30, stain:0.45, rough:0.38 } },
  sandrock: { rough:0.99, env:0.50, flat:false, sd:{ scale:24, bump:0.75, macro:270, crack:0.20, stain:0.48, rough:0.30 } },
  snowrock: { rough:0.80, env:0.70, flat:false, sd:{ scale:18, bump:0.7, macro:210, crack:0.18, stain:0.34, rough:0.42 } },
  // 玄武岩は暗い岩。env を上げると空の映り込みだけが残って無彩色のグレーに見える
  basalt:   { rough:0.96, env:0.22, flat:true,  sd:{ scale:13, bump:0.62, macro:160, crack:0.30, stain:0.36, rough:0.34 } },
  deadtree: { rough:0.96, env:0.45, flat:true,  sd:{ scale:9,  bump:0.45, macro:120, crack:0.20, stain:0.30, rough:0.26 } },
  pine:     { rough:0.94, env:0.55, flat:true,  sd:{ scale:16, bump:0.35, macro:200, crack:0.08, stain:0.32, rough:0.20 } },
  tree:     { rough:0.95, env:0.55, flat:true,  sd:{ scale:16, bump:0.4, macro:200, crack:0.10, stain:0.36, rough:0.20 } },
  log:      { rough:0.97, env:0.45, flat:false, sd:{ scale:11, bump:0.55, macro:140, crack:0.20, stain:0.36, rough:0.26 } },
  palm:     { rough:0.93, env:0.60, flat:true,  sd:{ scale:14, bump:0.35, macro:180, crack:0.10, stain:0.32, rough:0.20 } },
  shell:    { rough:0.34, env:1.10, flat:false, sd:{ scale:8,  bump:0.25, macro:110, crack:0.06, stain:0.24, rough:0.30 } },
  cactus:   { rough:0.82, env:0.55, flat:false, sd:{ scale:9,  bump:0.25, macro:120, crack:0.06, stain:0.26, rough:0.24 } },
  crystal:  { rough:0.26, env:0.95, flat:true,  sd:{ scale:12, bump:0.25, macro:150, crack:0.05, stain:0.20, rough:0.30 } },
  /* 人工物(遮蔽物)。石壁と柱は目地と欠けが要るので割れ目を強く、
     コンテナは錆と凹みなので粒を細かく・粗さのムラを大きくする。 */
  ruinwall:  { rough:0.95, env:0.40, flat:false, sd:{ scale:11, bump:0.68, macro:150, crack:0.34, stain:0.45, rough:0.34 } },
  container: { rough:0.66, env:0.60, flat:false, sd:{ scale:9,  bump:0.4, macro:120, crack:0.16, stain:0.48, rough:0.55 } },
  ruinpillar:{ rough:0.94, env:0.40, flat:false, sd:{ scale:10, bump:0.57, macro:140, crack:0.28, stain:0.40, rough:0.32 } },
  hut:       { rough:0.96, env:0.38, flat:false, sd:{ scale:7,  bump:0.45, macro:110, crack:0.24, stain:0.44, rough:0.28 } },
};
// 岩は少し傾けて置くと「置き物」に見えない(木・柱は立てたまま)
const OBST_TILT = { rock:0.10, sandrock:0.08, snowrock:0.10, shell:0.16, log:0.05, crystal:0.06 };
/* 接地影の広さ(当たり判定の半径=1に対する比)。
   木は幹より樹冠のほうが日を遮るので、幹の太さではなく葉の広がりに合わせる。 */
const OBST_CONTACT = {
  deadtree:0.75, pine:1.15, tree:1.20, palm:0.85, cactus:0.75,
  crystal:1.15, log:1.35, shell:1.30,
  // 人工物は底面がそのまま地面に接する箱なので、影は本体の footprint に近い広さ
  ruinwall:1.30, container:1.40, ruinpillar:1.35, hut:1.40,
};
const CONTACT_R_DEFAULT = 1.55;
const OBST_SHADOW_FADE = [2300, 3050];   // 影を縮めて消す距離(霞で障害物が消えるより手前)
// 影の濃さ(画面の明るさの倍率)。1で無変化、小さいほど濃い
const OBST_SHADOW_CORE = 0.40, OBST_SHADOW_MID = 0.54;
/* 影を落とす向き(太陽の反対側の水平成分)。真下に敷くだけだと「足元のしみ」に見えるので、
   物の高さに応じてこの向きへずらす。太陽の向きは real3d_common.js の1か所だけが正。 */
const SUN_FLAT = (()=>{ const L = Math.hypot(SUN_DIR.x, SUN_DIR.z) || 1;
                        return { x:-SUN_DIR.x/L, z:-SUN_DIR.z/L }; })();
const SHADOW_SLIP = 0.14;   // ずらす量(物の高さに対する比)

function obstacleMaterial(flavor){
  const conf = OBST_MATS[flavor] || OBST_MATS.rock;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors:true, roughness:conf.rough, metalness:0.0,
    flatShading: conf.flat !== false,
    envMapIntensity: (conf.env == null ? 1 : conf.env) * ENV_INTENSITY,
  });
  /* 表面ディテール。地面用の法線マップを貼るのをやめてこちらへ替えた。
     地面のUVをそのまま流用すると、球・円柱・箱でUVの縮尺がバラバラで
     粒の大きさが物ごとに変わってしまう(貼っても効いていなかった)。 */
  applySurfaceDetail(mat, conf.sd);
  /* 水晶だけはわずかに自ら光る。日陰へ入っても水色が残り、
     「氷の結晶」だと分かる(色はテーマ由来なのでマップごとに変わる)。 */
  if(flavor === 'crystal'){
    mat.emissive = crystalColor().multiplyScalar(0.55);
    mat.emissiveIntensity = 0.22;
  }
  return mat;
}

// 中身が変わったときだけ作り直すための署名(試合ごとに1回)
function obstacleSignature(list){
  if(!list || !list.length) return '0';
  const f = list[0], l = list[list.length-1];
  return list.length+':'+Math.round(f.x)+','+Math.round(f.y)+','+Math.round(l.x)+','+Math.round(l.y);
}

function buildObstacles(scene, list){
  if(obstGroup){
    obstGroup.traverse(o=>{ if(o.isMesh){ o.geometry.dispose(); o.material.dispose(); } });
    scene.remove(obstGroup);
  }
  obstGroup = new THREE.Group();
  obstKinds = {};
  const flavors = {};
  for(const o of list) flavors[o.flavor || 'rock'] = 1;
  for(const f in flavors){
    const mat = obstacleMaterial(f);
    const vars = [];
    for(let v=0; v<OBST_VARIANTS; v++){
      const mesh = new THREE.InstancedMesh(obstacleGeo(f, v), mat, OBST_MAX);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;   // 上限まで並べるので毎フレームの判定はしない
      mesh.count = 0;
      obstGroup.add(mesh);
      vars.push(mesh);
    }
    obstKinds[f] = vars;
  }
  /* 接地影は種類をまたいで1つのInstancedMeshにまとめる(描画命令は+1だけ)。
     岩は傾けて置くが影は傾けない。地面の高さも岩の足元4点の最小ではなく
     中心の高さを使うので、影だけは必ず地面に沿う。                          */
  obstShadow = new THREE.InstancedMesh(
    shadowDiscGeo(10, 1.7, OBST_SHADOW_CORE, OBST_SHADOW_MID, 2, 0.74),
    shadowMaterial(OBST_SHADOW_FADE[0], OBST_SHADOW_FADE[1]), OBST_MAX);
  obstShadow.frustumCulled = false;
  obstShadow.count = 0;
  obstShadow.renderOrder = 1;
  obstGroup.add(obstShadow);
  scene.add(obstGroup);
  obstCX = obstCY = null;
}

const _om = new THREE.Matrix4(), _oq = new THREE.Quaternion(), _oq2 = new THREE.Quaternion();
const _ov = new THREE.Vector3(), _os = new THREE.Vector3(), _oc = new THREE.Color();
const _tiltAxis = new THREE.Vector3();
function updateObstacleInstances(cx, cy){
  if(!obstKinds || !obstSrc) return;
  if(obstCX != null && Math.abs(cx-obstCX) + Math.abs(cy-obstCY) < OBST_STEP) return;
  obstCX = cx; obstCY = cy;
  const near = [];
  for(let i=0;i<obstSrc.length;i++){
    const o = obstSrc[i];
    const dx = o.x-cx, dy = o.y-cy, d2 = dx*dx + dy*dy;
    if(d2 <= OBST_VIEW*OBST_VIEW) near.push({ o, d2 });
  }
  near.sort((a,b)=>a.d2 - b.d2);
  // 上限で切ったときは「実際に出している距離」を2D側へ伝える(くり抜きと食い違わせない)
  obstCull = near.length > OBST_MAX ? Math.sqrt(near[OBST_MAX].d2) : OBST_VIEW;
  if(near.length > OBST_MAX) near.length = OBST_MAX;
  for(const f in obstKinds) for(const m of obstKinds[f]) m.count = 0;
  if(obstShadow) obstShadow.count = 0;
  for(let i=0;i<near.length;i++){
    const o = near[i].o;
    const flavor = o.flavor || 'rock';
    const vars = obstKinds[flavor] || obstKinds.rock;
    if(!vars) continue;
    const seed = o.seed || 0;
    const mesh = vars[Math.floor(Math.abs(seed)*4.7) % OBST_VARIANTS];
    const idx = mesh.count;
    if(idx >= OBST_MAX) continue;
    const sh = shapeOf(flavor);
    const r = o.radius || 30;
    // 坂で浮かないよう、足元4点のいちばん低い高さに合わせてから少し埋める
    const gy = Math.min(
      heightAt(o.x - r*0.7, o.y), heightAt(o.x + r*0.7, o.y),
      heightAt(o.x, o.y - r*0.7), heightAt(o.x, o.y + r*0.7)
    ) - r*sh.sink;
    _ov.set(o.x, gy, o.y);
    _oq.setFromAxisAngle(UP_AXIS, seed*1.17);
    // 岩は少し傾ける。傾けた側が地面から浮かないよう埋める深さ(sink)の範囲に収める
    const tilt = OBST_TILT[flavor] || 0;
    if(tilt){
      const ta = seed*2.9;
      _tiltAxis.set(Math.cos(ta), 0, Math.sin(ta));
      _oq2.setFromAxisAngle(_tiltAxis, (((seed*7.3) % 1) - 0.5) * 2 * tilt);
      _oq.multiply(_oq2);
    }
    const hk = 0.90 + (seed - Math.floor(seed))*0.26;   // 高さだけ個体差を付ける
    // 横も個体差を付ける。ただし当たり判定より太くしないため 1.0 を超えない
    const wx = 0.86 + ((seed*5.3) % 1)*0.14;
    const wz = 0.86 + ((seed*11.7) % 1)*0.14;
    _os.set(r*wx, r*hk, r*wz);
    _om.compose(_ov, _oq, _os);
    mesh.setMatrixAt(idx, _om);
    const tint = 0.82 + ((seed*3.1) % 1)*0.34;
    _oc.setRGB(tint, tint*(0.99 + ((seed*13.1)%1)*0.03), tint*(0.97 + ((seed*17.9)%1)*0.05));
    mesh.setColorAt(idx, _oc);
    mesh.count = idx + 1;
    // 接地影。傾きは付けず、中心の地面の高さに沿わせる
    if(obstShadow && obstShadow.count < OBST_MAX){
      const cr = ((OBST_CONTACT[flavor] == null) ? CONTACT_R_DEFAULT : OBST_CONTACT[flavor]) * r;
      const slip = r*sh.h*hk*SHADOW_SLIP;
      _ov.set(o.x + SUN_FLAT.x*slip, heightAt(o.x, o.y) + r*0.07, o.y + SUN_FLAT.z*slip);
      _oq2.setFromAxisAngle(UP_AXIS, seed*2.31);
      _os.set(cr*wx, 1, cr*wz);
      _om.compose(_ov, _oq2, _os);
      obstShadow.setMatrixAt(obstShadow.count, _om);
      obstShadow.count++;
    }
  }
  for(const f in obstKinds) for(const m of obstKinds[f]){
    m.instanceMatrix.needsUpdate = true;
    if(m.instanceColor) m.instanceColor.needsUpdate = true;
  }
  if(obstShadow) obstShadow.instanceMatrix.needsUpdate = true;
  obstDrawn = near.length;
}

/* =====================================================================
   植生(草・低木)

   ・当たり判定を持たない飾り。プレイヤーはすり抜ける
   ・プレイヤーのまわりだけに生やす。位置はワールド座標から決まる純関数なので、
     動いても草が「泳ぐ」ことはない(同じ場所には必ず同じ草が立つ)
   ・種類ごとに InstancedMesh 1つ(描画命令は合計8つ)。遠くは頂点シェーダーで
     0まで縮めて地面へ沈めるので、草の生え際の切れ目が見えない
   ・風は頂点シェーダー。草を1本ずつ動かすのではなく、instanceMatrix の位置から
     位相を作るので、CPUの計算はフレームあたり「時刻の代入」1回だけ
   ・どんな草を生やすかはテーマ(data.js の REAL3D_THEMES)から決める。
     色は scrub / low / high / gravel から作るので、雪原に緑の草は生えない
   ===================================================================== */

const WIND_DIR = { x:0.86, y:0.36 };     // 風の向き(ワールドのx,z)
const windTime = { value:0 };            // 全ての植生の材質で共有する時刻

/* 風で揺らし、遠くを縮めて消す頂点シェーダーを材質へ差し込む。
   amp=揺れ幅(モデルの高さに対する比) stiff=しなり具合 fade=縮め始め/消える距離 */
function applyWind(mat, amp, stiff, fadeNear, fadeFar, ambient){
  const key = 'aramonVeg|'+amp+'|'+stiff+'|'+fadeNear+'|'+fadeFar+'|'+(ambient?ambient.getHexString():'-');
  mat.onBeforeCompile = (sh)=>{
    sh.uniforms.uTime = windTime;
    sh.uniforms.uWind = { value: new THREE.Vector3(amp*WIND_DIR.x, amp*WIND_DIR.y, stiff) };
    sh.uniforms.uFade = { value: new THREE.Vector2(fadeNear, fadeFar) };
    sh.vertexShader = 'uniform float uTime;\nuniform vec3 uWind;\nuniform vec2 uFade;\n' + sh.vertexShader;
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', [
      '#include <begin_vertex>',
      '#ifdef USE_INSTANCING',
      '  vec3 vgO = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);',
      '#else',
      '  vec3 vgO = vec3(0.0);',
      '#endif',
      // モデルの高さは 0〜1 に正規化してあるので、y がそのまま「根元からの高さ」
      '  float vgB = clamp(transformed.y, 0.0, 1.0);',
      '  vgB = vgB * vgB * uWind.z;',
      '  float vgP = vgO.x * 0.013 + vgO.z * 0.017;',
      '  float vgS = sin(uTime * 1.6 + vgP) * 0.70 + sin(uTime * 3.7 + vgP * 2.3) * 0.30;',
      '  transformed.x += vgS * vgB * uWind.x;',
      '  transformed.z += vgS * vgB * uWind.y;',
      // 遠くは縮めて地面へ沈める(草の生え際に線が出ない)
      '  transformed *= 1.0 - smoothstep(uFade.x, uFade.y, distance(vgO.xz, cameraPosition.xz));',
      '',
    ].join('\n'));
    /* 空からの回り込み光。このシーンには環境光(アンビエントライト)が置かれておらず、
       代わりに空をPMREMへ通した環境マップを使っているが、MeshLambert はその形式の
       環境マップを読めない。読めないまま置くと日の当たらない面が真っ黒になるので、
       テーマの空色から作った一定の回り込み光をここで足す。                     */
    if(ambient){
      sh.uniforms.uAmb = { value: ambient };
      sh.fragmentShader = 'uniform vec3 uAmb;\n' + sh.fragmentShader;
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>',
        '#include <lights_fragment_end>\n  reflectedLight.indirectDiffuse += diffuseColor.rgb * uAmb;');
    }
  };
  mat.customProgramCacheKey = ()=> key;
  return mat;
}

/* 描いた絵をアルファ抜きのテクスチャにする。
   【落とし穴】Canvasの透明な画素はRGBが0(黒)なので、そのまま縮小フィルタに通すと
   葉のまわりへ黒がにじみ、遠くの草が「黒い板」に見える。透明な所のRGBを明るい色で
   埋めてから渡す。さらにミップマップを作らない: アルファまで平均されて板全体が
   アルファテストを通ってしまい、四角い板が見えるため(遠くは距離フェードで消す)。 */
function alphaCutTexture(cv){
  const g = cv.getContext('2d');
  const img = g.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  for(let i=0;i<d.length;i+=4){
    if(d[i+3] === 0){ d[i] = 235; d[i+1] = 235; d[i+2] = 235; }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/* 草の絵。画像ファイルは増やせないのでCanvasに描く。
   色は付けず明暗だけ(白〜灰)にして、実際の色は頂点カラー/インスタンスカラーで作る。 */
let grassTexCache = null;
function grassTexture(){
  if(grassTexCache) return grassTexCache;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, S, S);
  const blades = 20;
  for(let i=0;i<blades;i++){
    const t = (i + 0.5)/blades;
    const x0 = S*(0.5 + (t-0.5)*0.70) + (hash2(i*3.1, 1.7)-0.5)*S*0.05;
    const lean = (t-0.5)*2.1 + (hash2(i*1.9, 5.3)-0.5)*0.7;
    const hgt = S*(0.42 + hash2(i*2.7, 2.3)*0.56);
    const w = S*(0.020 + hash2(i*4.1, 3.9)*0.024);
    // 先を大きく曲げる。まっすぐな三角形が並ぶと「低ポリの切り絵」に見える
    const xT = x0 + lean*S*0.34;
    const yT = S - hgt;
    const grd = g.createLinearGradient(0, S, 0, yT);
    grd.addColorStop(0.0, 'rgba(232,232,232,1)');
    grd.addColorStop(0.45, 'rgba(236,236,236,1)');
    grd.addColorStop(1.0, 'rgba(255,255,255,1)');
    g.fillStyle = grd;
    // 根元も細くする。全部の葉を下端で同じ太さにすると、株元が1枚の板に塗りつぶれる
    const wb = w*0.42;
    const yB = S + S*0.02 - hash2(i*5.9, 1.1)*S*0.05;
    g.beginPath();
    g.moveTo(x0 - wb, yB);
    g.quadraticCurveTo(x0 - w*0.4 + lean*S*0.05, S - hgt*0.62, xT, yT);
    g.quadraticCurveTo(x0 + w*0.4 + lean*S*0.05, S - hgt*0.62, x0 + wb, yB);
    g.closePath();
    g.fill();
  }
  grassTexCache = alphaCutTexture(cv);
  return grassTexCache;
}

/* 草の束。板を3枚交差させる。板の向きは形の側に焼き込む(インスタンスは回さない)。
   インスタンスを回すと風の向きまで一緒に回ってしまい、風がバラバラに見えるため。 */
function grassTuftGeo(variant){
  const parts = [];
  const quads = 3;
  for(let i=0;i<quads;i++){
    const a = (i/quads)*Math.PI + variant*0.41 + hash2(variant*3.3, i*1.7)*0.6;
    const w = 0.78 + hash2(variant*5.1, i*2.9)*0.5;
    const hh = 0.70 + hash2(variant*2.3, i*4.7)*0.36;
    // 縦2分割。曲げたときに根元が残って穂先だけしなる(1分割だと株ごと傾いて見える)
    const p = new THREE.PlaneGeometry(w, hh, 1, 2);
    p.translate(0, hh*0.5, 0);
    p.rotateZ((hash2(variant*7.7, i*1.3)-0.5)*0.36);
    p.rotateY(a);
    p.translate((hash2(variant*1.1, i*6.1)-0.5)*0.24, 0, (hash2(variant*8.3, i*2.1)-0.5)*0.24);
    parts.push(p);
  }
  const geo = doubleSided(mergeGeos(parts), 1);
  fitBounds(geo, 0.55, 0, 1);
  // fitBounds が法線を作り直すので、もう一度上向きへ揃える
  const nor = geo.attributes.normal;
  for(let i=0;i<nor.count;i++) nor.setXYZ(i, 0, 1, 0);
  nor.needsUpdate = true;
  return geo;
}

/* 低木・下草の絵。草と同じく手続き的に描く。
   立体の板を並べて葉を作ると、どうしても「折り紙」に見える(面が大きく平らなため)。
   絵で葉の形を持たせて板は隠す方が、同じ三角形数でずっと植物らしくなる。
   kind: fern=羽状のシダ / twig=枯れかけた小枝 / blades=硬い細葉         */
const bushTexCache = {};
function bushTexture(kind){
  if(bushTexCache[kind]) return bushTexCache[kind];
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, S, S);
  const rnd = (i, j)=> hash2(i*1.7 + 3.1, j*2.3 - 1.9);
  // 楕円。ctx.ellipse を使わずに書く(古いWebViewでも確実に描ける)
  const blob = (x, y, rx, ry, rot, lo, hi)=>{
    g.save();
    g.translate(x, y); g.rotate(rot); g.scale(rx, ry);
    const lg = g.createLinearGradient(-1, 0, 1, 0);
    lg.addColorStop(0, 'rgba('+lo+','+lo+','+lo+',1)');
    lg.addColorStop(1, 'rgba('+hi+','+hi+','+hi+',1)');
    g.fillStyle = lg;
    g.beginPath(); g.arc(0, 0, 1, 0, Math.PI*2); g.fill();
    g.restore();
  };
  const stems = (kind === 'blades') ? 13 : (kind === 'twig' ? 9 : 7);
  for(let i=0;i<stems;i++){
    const t = (i + 0.5)/stems;
    const x0 = S*(0.5 + (t-0.5)*0.40) + (rnd(i,7)-0.5)*S*0.05;
    const lean = (t-0.5)*2.2 + (rnd(i,1)-0.5)*0.7;
    const len = S*((kind === 'blades' ? 0.68 : 0.58) + rnd(i,2)*0.36);
    const cx = x0 + lean*S*0.14, cy = S - len*0.55;
    const ex = x0 + lean*S*0.44, ey = S - len;
    const at = (u)=>[ (1-u)*(1-u)*x0 + 2*(1-u)*u*cx + u*u*ex,
                      (1-u)*(1-u)*S  + 2*(1-u)*u*cy + u*u*ey ];
    if(kind === 'blades'){
      // 硬い細葉。根元が太く先が尖る
      const w = S*(0.014 + rnd(i,3)*0.012);
      const grd = g.createLinearGradient(0, S, 0, ey);
      grd.addColorStop(0, 'rgba(190,190,190,1)');
      grd.addColorStop(1, 'rgba(255,255,255,1)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(x0 - w, S);
      g.quadraticCurveTo(cx - w*0.4, cy, ex, ey);
      g.quadraticCurveTo(cx + w*0.4, cy, x0 + w, S);
      g.closePath(); g.fill();
      continue;
    }
    // 茎
    g.strokeStyle = (kind === 'twig') ? 'rgba(196,196,196,1)' : 'rgba(186,186,186,1)';
    g.lineWidth = S*(kind === 'twig' ? 0.0075 : 0.010);
    g.beginPath(); g.moveTo(x0, S); g.quadraticCurveTo(cx, cy, ex, ey); g.stroke();
    if(kind === 'twig'){
      // 小枝を左右へ。葉はまばらに数枚だけ(枯れかけた低木)
      for(let k=2;k<=7;k++){
        const u = k/8, pt = at(u);
        const sg = (k % 2) ? 1 : -1;
        const bl = len*0.20*(1-u*0.5);
        g.lineWidth = S*0.0045;
        g.beginPath(); g.moveTo(pt[0], pt[1]);
        g.lineTo(pt[0] + sg*bl*0.8, pt[1] - bl*0.75); g.stroke();
        if(rnd(i,k) > 0.40) blob(pt[0] + sg*bl*0.8, pt[1] - bl*0.75, S*0.022, S*0.011, sg*0.8, 185, 255);
      }
      continue;
    }
    // シダ: 中肋に沿って小葉を並べる
    const steps = 10;
    for(let k=1;k<=steps;k++){
      const u = k/steps, pt = at(u);
      const w = S*0.052*(1 - u*0.72)*(0.7 + rnd(i,k)*0.6);
      const h = S*0.019*(1 - u*0.55);
      blob(pt[0] - w*0.5, pt[1], w*0.55, h, -0.75 + lean*0.3, 160, 252);
      blob(pt[0] + w*0.5, pt[1], w*0.55, h,  0.75 + lean*0.3, 160, 252);
    }
  }
  bushTexCache[kind] = alphaCutTexture(cv);
  return bushTexCache[kind];
}

/* 低木の形。草と同じ「板を交差させた束」。板の向きは形へ焼き込む(風の向きを揃えるため)。
/* 【当たり判定の無い物を「隠れられそうな物」の形にしない】
   以前は雪原と火山に kind:'lump'(雪・火山灰の塊)を撒いていた。地面が裸に
   見えないようにという意図だったが、boulderGeo で作って障害物と同じ表面ディテールを
   乗せていたので、見た目は岩そのものなのに隠れられない物が足元に100個並んでいた。
   実機で「遮蔽物と誤認するような物を描くな」と report され廃止(2026-08-14)。
   **飾りは草・枝・葉に限る。丸い塊・板・柱の形にしない。**
   地面が寂しいときは草を増やすか地面テクスチャで埋める。              */
function shrubGeo(kind, variant, colLow, colHigh){
  const parts = [];
  const quads = 4;
  for(let i=0;i<quads;i++){
    const a = (i/quads)*Math.PI + variant*0.37 + hash2(variant*2.9, i*1.3)*0.7;
    const w = 1.05 + hash2(variant*4.7, i*3.1)*0.45;
    const hh = 0.74 + hash2(variant*1.9, i*5.3)*0.32;
    const p = new THREE.PlaneGeometry(w, hh, 1, 2);
    p.translate(0, hh*0.5, 0);
    p.rotateZ((hash2(variant*6.1, i*2.7)-0.5)*0.30);
    p.rotateY(a);
    p.translate((hash2(variant*3.3, i*1.7)-0.5)*0.22, 0, (hash2(variant*7.9, i*4.3)-0.5)*0.22);
    parts.push(p);
  }
  const geo = doubleSided(mergeGeos(parts), 1);
  fitBounds(geo, 0.80, 0, 1);
  const nor = geo.attributes.normal;
  for(let i=0;i<nor.count;i++) nor.setXYZ(i, 0, 1, 0);
  nor.needsUpdate = true;
  paintGeo(geo, colLow, colHigh, -0.30, 1, 0.30);
  return geo;
}

/* 【小石は撒かない】以前は「草の生えない所でも地面が裸に見えないように」と
   飾りの小石を数百個撒いていたが、形も色も本物の岩と同じ作りだったため、
   隠れられる岩と見分けが付かず「地面の模様なのに高さがあるように見える」と
   実機で2度report された(2026-08-14)。**足元に岩に見える飾りを置かない。**
   見えている岩は必ず隠れられる本物、という状態を保つこと。           */

/* テーマ(地面テクスチャの種類)ごとの植生の内訳。
   n=出す数 view=出す半径 h=高さ(ワールド単位) patch=粗密の強さ           */
/* 【飾りは草・枝・葉だけ。丸い塊・板・柱の形にしない】
   当たり判定を持たない飾りが「隠れられそうな物」に見えると、プレイヤーは
   遮蔽物として使おうとして裏切られる。実機で2度 report され、
   ・飾りの小石(rockSilhouette で作っていた。数百個)
   ・雪・火山灰の塊(kind:'lump'。boulderGeo + 障害物と同じ表面ディテール)
   の2つを廃止した(2026-08-14)。**kind に岩の形を足さないこと。**
   地面が寂しいときは grass の数を増やすか、地面テクスチャで埋める。      */
const VEG_STYLES = {
  dry:      { grass:{ n:1250, view:900,  h:[16,32], patch:0.78, dry:0.55 },
              shrub:{ n:110,  view:1500, h:[30,62], kind:'twig' } },
  jungle:   { grass:{ n:950,  view:830,  h:[24,52], patch:0.62, dry:0.10 },
              shrub:{ n:150,  view:1450, h:[32,66], kind:'fern' } },
  sand:     { grass:{ n:430,  view:820,  h:[14,30], patch:0.90, dry:0.60 },
              shrub:{ n:85,   view:1400, h:[22,42], kind:'blades' } },
  snow:     { grass:{ n:130,  view:600,  h:[10,22], patch:0.95, dry:0.85 },
              shrub:{ n:120,  view:1350, h:[14,28], kind:'blades' } },
  volcanic: { grass:{ n:90,   view:600,  h:[10,24], patch:0.95, dry:0.80 },
              shrub:{ n:130,  view:1300, h:[14,30], kind:'twig' } },
};

const VEG_VARIANTS = 4;
const VEG_STEP = 110;        // プレイヤーがこの距離だけ動いたら生やし直す
const VEG_FILL = 0.55;       // 格子のうち実際に生やす割合(粗密の平均)
/* 地面へ沈める深さ(モデルの高さに対する比)。
   接地影の板をここへ合わせるので、placeLayer の引数と必ず同じ値を使う。 */
const VEG_SINK = { grass:0.06, shrub:0.08 };

let vegGroup = null, vegKinds = null, vegTheme = null, vegConf = null;
let vegCX = null, vegCY = null;

// 植生の色をテーマから作る。マップごとの草・低木の色はここだけで決まる
function vegColors(){
  const scrub = themeColor('scrub'), low = themeColor('low'), high = themeColor('high');
  const gravel = themeColor('gravel'), steep = themeColor('steep');
  const dry = (vegConf && vegConf.grass.dry != null) ? vegConf.grass.dry : 0.5;
  return {
    // 草・低木は「1つの基準色の明暗」で作る。別々の色を根元と穂先に置くと
    // 明暗の幅が開きすぎて、黒い株に蛍光色の穂が乗った作り物に見える
    grassBase: liftColor(mixColor(mixColor(scrub, low, 0.42), high, 0.14 + dry*0.36), 0.040),
    shrubBase: liftColor(mixColor(scrub, low, 0.40), 0.044),
  };
}

function buildVegetation(scene){
  if(vegGroup){
    vegGroup.traverse(o=>{ if(o.isMesh){ o.geometry.dispose(); o.material.dispose(); } });
    scene.remove(vegGroup);
  }
  vegGroup = new THREE.Group();
  vegKinds = {};
  const theme = R3.theme || DEFAULT_THEME;
  vegConf = VEG_STYLES[theme.tex] || VEG_STYLES.dry;
  const col = vegColors();

  const add = (name, conf, geoFn, mat, shadow, recv, shR, core, mid)=>{
    const cap = Math.ceil(conf.n * 0.75) + 8;
    const vars = [];
    for(let v=0; v<VEG_VARIANTS; v++){
      const m = new THREE.InstancedMesh(geoFn(v), mat, cap);
      m.castShadow = !!shadow;
      m.receiveShadow = !!recv;
      m.frustumCulled = false;
      m.count = 0;
      vegGroup.add(m);
      vars.push(m);
    }
    /* 接地影は形の4通りをまたいで1つのInstancedMeshにまとめる(層ごとに+1描画命令)。
       消える距離は層ごとに違うので、層ごとに1つ持つ必要がある。               */
    const sm = new THREE.InstancedMesh(
      shadowDiscGeo(6, name.length*0.9 + 1.3, core, mid, 2, 0.60),
      shadowMaterial(conf.view*0.72, conf.view), cap*VEG_VARIANTS);
    sm.frustumCulled = false;
    sm.count = 0;
    sm.renderOrder = 1;
    vegGroup.add(sm);
    vegKinds[name] = { conf, vars, cap, shadow:sm, shR };
  };

  // 草: アルファ抜きの板。透過の並べ替えを避けるため alphaTest(透明扱いにしない)
  // 空の回り込み光。テーマの空色から作るので、夕焼けの火山でも雪原でも馴染む
  const amb = mixColor(themeColor('skyBot'), themeColor('haze'), 0.5).multiplyScalar(0.88);
  const grassMat = applyWind(new THREE.MeshLambertMaterial({
    map: grassTexture(), alphaTest:0.42, transparent:false, vertexColors:true,
  }), 0.30, 1.0, vegConf.grass.view*0.72, vegConf.grass.view, amb);
  // 草は影を受ける(地面だけ影で暗くなって草が光って見えるのを防ぐ)
  add('grass', vegConf.grass, (v)=>{
    const g = grassTuftGeo(v);
    // -0.45 起点にして「根元だけ暗い」形にする(0起点だと株の半分が沈んで黒く見える)
    paintGeo(g, col.grassBase.clone().multiplyScalar(0.66), col.grassBase.clone().multiplyScalar(1.24), -0.55, 1, 0.26);
    return g;
  }, grassMat, false, true, 0.62, 0.55, 0.72);

  // 低木・シダ: 立体の葉。風は草より弱く、遠くまで出す
  const shrubMat = applyWind(new THREE.MeshLambertMaterial({
    vertexColors:true,
    map: bushTexture(vegConf.shrub.kind),
    alphaTest: 0.42, transparent:false,
  }), 0.20, 0.9, vegConf.shrub.view*0.80, vegConf.shrub.view, amb);
  const shrubBase = col.shrubBase;
  add('shrub', vegConf.shrub, (v)=> shrubGeo(vegConf.shrub.kind, v,
      shrubBase.clone().multiplyScalar(0.74), shrubBase.clone().multiplyScalar(1.26)),
      shrubMat, true, true, 0.85, 0.48, 0.66);

  scene.add(vegGroup);
  vegCX = vegCY = null;
}

/* 水・溶岩の上に草を生やさないための下調べ。
   world.js が持っている地面のしみ(グローバル)を読むだけで、書き換えはしない。
   読めない環境(単体テスト等)でも落ちないよう typeof で確かめてから触る。   */
function collectHazards(cx, cy, view){
  const out = [];
  const push = (arr, grow)=>{
    if(!arr || !arr.length) return;
    for(let i=0;i<arr.length;i++){
      const z = arr[i];
      if(!z || z.radius == null) continue;
      const r = z.radius*grow;
      const dx = z.x - cx, dy = z.y - cy, rr = r + view;
      if(dx*dx + dy*dy < rr*rr) out.push({ x:z.x, y:z.y, r2:r*r });
    }
  };
  try{
    if(typeof lavaZones   !== 'undefined') push(lavaZones,   1.30);
    if(typeof oasisZones  !== 'undefined') push(oasisZones,  1.02);
    if(typeof riverZones  !== 'undefined') push(riverZones,  1.02);
    if(typeof seaZones    !== 'undefined') push(seaZones,    1.02);
  }catch(e){ /* ワールドがまだ無いだけ。植生は次のフレームで並び直る */ }
  return out;
}
function seaEdgeOf(y){
  try{
    if(typeof currentMap === 'undefined' || !currentMap || !currentMap.hasSea) return null;
    if(typeof seaEdgeX !== 'function') return null;
    return seaEdgeX(y);
  }catch(e){ return null; }
}

// 粗密。低い周波数の重ね合わせで「草の濃い所と薄い所」を作る
function vegDensity(x, y){
  return tileNoise(x/560, y/560, 64)*0.62 + tileNoise(x/165, y/165, 64)*0.38;
}

const _vm = new THREE.Matrix4(), _vq = new THREE.Quaternion();
const _vv = new THREE.Vector3(), _vs = new THREE.Vector3(), _vc = new THREE.Color();
function placeLayer(layer, cx, cy, seedOff, rotate, sinkRatio){
  const conf = layer.conf, vars = layer.vars;
  const view = conf.view, target = conf.n;
  for(const m of vars) m.count = 0;
  if(layer.shadow) layer.shadow.count = 0;
  if(target <= 0) return;
  // 円の中に target/VEG_FILL 個の格子が入るようにマス目の大きさを決める
  const cells = target / VEG_FILL;
  const cell = Math.max(12, view * Math.sqrt(Math.PI / cells));
  const R = Math.ceil(view / cell);
  const view2 = view*view;
  /* 【重要】草を撒く範囲(view)と同じ広さで水・溶岩を集めること。
     ここに 0 を渡していたため、「カメラがその中に立っている水域」しか集まらず、
     少し離れた川の上に草と石が生えていた(トーブル海岸で発生)。 */
  const hz = collectHazards(cx, cy, view);
  const gx0 = Math.round(cx / cell), gy0 = Math.round(cy / cell);
  const hLo = conf.h[0], hSpan = conf.h[1] - conf.h[0];
  const patch = (conf.patch == null) ? 0.6 : conf.patch;
  for(let iy=-R; iy<=R; iy++){
    for(let ix=-R; ix<=R; ix++){
      const gx = gx0 + ix, gy = gy0 + iy;
      const h1 = hash2(gx*1.37 + seedOff, gy*2.71 - seedOff);
      const h2 = hash2(gx*3.11 - seedOff, gy*1.53 + seedOff);
      const wx = gx*cell + (h1 - 0.5)*cell*0.92;
      const wy = gy*cell + (h2 - 0.5)*cell*0.92;
      const dx = wx - cx, dy = wy - cy;
      const d2 = dx*dx + dy*dy;
      if(d2 > view2) continue;
      // 粗密。patch=0で一様、1で「生えている所と裸地」がはっきり分かれる
      const dens = vegDensity(wx, wy);
      const p = VEG_FILL * (1 - patch + patch*2*dens);
      if(hash2(gx*5.77 + seedOff*2, gy*7.13 - seedOff*3) > p) continue;
      // 水・溶岩の上には生やさない
      let blocked = false;
      for(let k=0;k<hz.length;k++){
        const hx = wx - hz[k].x, hy = wy - hz[k].y;
        if(hx*hx + hy*hy < hz[k].r2){ blocked = true; break; }
      }
      if(blocked) continue;
      const edge = seaEdgeOf(wy);
      if(edge != null && wx < edge + 90) continue;
      const vi = Math.floor(h1*VEG_VARIANTS*3.7) % VEG_VARIANTS;
      const mesh = vars[vi];
      const idx = mesh.count;
      if(idx >= layer.cap) continue;
      const sz = hLo + hSpan*hash2(gx*9.31 + seedOff, gy*4.19 - seedOff);
      const gh = heightAt(wx, wy);
      _vv.set(wx, gh - sz*sinkRatio, wy);
      if(rotate) _vq.setFromAxisAngle(UP_AXIS, h2*6.2831);
      else _vq.identity();
      // 横幅にも個体差。同じ形の繰り返しに見せない
      const wk = 0.72 + h2*0.62;
      _vs.set(sz*wk, sz, sz*wk);
      _vm.compose(_vv, _vq, _vs);
      mesh.setMatrixAt(idx, _vm);
      // 株ごとに明るさと色みをずらす。同じ緑が並ぶと絨毯に見える
      const t = 0.74 + h1*0.54;
      _vc.setRGB(t*(0.94 + h2*0.16), t, t*(0.88 + h1*0.16));
      mesh.setColorAt(idx, _vc);
      mesh.count = idx + 1;
      // 接地影。株を回さない層でも影だけは回して、同じ輪郭が並ばないようにする
      const sm = layer.shadow;
      if(sm && sm.count < sm.instanceMatrix.count){
        const sr = sz*wk*layer.shR;
        const slip = sz*SHADOW_SLIP;
        _vv.set(wx + SUN_FLAT.x*slip, gh + sz*0.11, wy + SUN_FLAT.z*slip);
        _vq.setFromAxisAngle(UP_AXIS, h1*6.2831);
        _vs.set(sr, 1, sr);
        _vm.compose(_vv, _vq, _vs);
        sm.setMatrixAt(sm.count, _vm);
        sm.count++;
      }
    }
  }
  for(const m of vars){
    m.instanceMatrix.needsUpdate = true;
    if(m.instanceColor) m.instanceColor.needsUpdate = true;
  }
  if(layer.shadow) layer.shadow.instanceMatrix.needsUpdate = true;
}

function updateVegetation(scene, cx, cy){
  if(vegTheme !== R3.theme || !vegGroup){
    vegTheme = R3.theme;
    buildVegetation(scene);
  }
  // 風は毎フレーム進める(CPUの仕事はこの1行だけ)
  windTime.value = performance.now()*0.001;
  if(vegCX != null && Math.abs(cx-vegCX) + Math.abs(cy-vegCY) < VEG_STEP) return;
  vegCX = cx; vegCY = cy;
  placeLayer(vegKinds.grass, cx, cy, 1.7,  false, VEG_SINK.grass);
  placeLayer(vegKinds.shrub, cx, cy, 5.3,  false, VEG_SINK.shrub);
}

export function updateObstacles(scene, rocks, crystals, cx, cy){
  if(!scene) return;
  const sig = obstacleSignature(rocks) + '/' + obstacleSignature(crystals);
  if(sig !== obstSig){
    obstSig = sig;
    // 水晶はflavorを持たないのでここで付ける(元の配列は書き換えない)
    obstSrc = (rocks || []).slice();
    for(const c of (crystals || [])) obstSrc.push({ x:c.x, y:c.y, radius:c.radius, seed:c.seed, flavor:'crystal' });
    buildObstacles(scene, obstSrc);
  }
  updateObstacleInstances(cx, cy);
  updateVegetation(scene, cx, cy);
}

// [一時デバッグ] 調査用。完了時に消すこと
export function __sdDebug(){
  const out = [];
  if(!obstKinds) return out;
  for(const f in obstKinds){
    const vs = obstKinds[f];
    const sh = shapeOf(f);
    const bounds = vs.map(m=>{
      const p = m.geometry.attributes.position;
      let r = 0, lo = Infinity, hi = -Infinity;
      for(let i=0;i<p.count;i++){
        const rr = Math.hypot(p.getX(i), p.getZ(i));
        if(rr > r) r = rr;
        const y = p.getY(i);
        if(y < lo) lo = y;
        if(y > hi) hi = y;
      }
      return { r:+r.toFixed(3), y0:+lo.toFixed(3), h:+(hi-lo).toFixed(3), dh:+(hi-lo-sh.h).toFixed(3) };
    });
    out.push({ flavor:f, tableH:sh.h,
      tris: vs.map(m=> m.geometry.attributes.position.count/3),
      counts: vs.map(m=> m.count), bounds,
      flat: vs[0].material.flatShading });
  }
  return out;
}
