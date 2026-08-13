/* =====================================================================
   リアルマップ: 水(海・川・オアシス)と溶岩

   【水の作り】本物の反射パス(平面反射・屈折)はiPhoneでは重すぎるので使わない。
     代わりに次の6つを重ねて「水に見える」ところまで持っていく。
       1. 深さで色が変わる  … 頂点に「水の厚み(aDepth)」を持たせ、光が吸われて
                              いく式(1-exp(-厚み/L))で 濡れた底 → 明るい緑青 →
                              暗い青 と連続で変える
       2. 水際が線にならない … 厚み0へ向けて透明に抜き、さらに「その瞬間の水深」を
                              波の寄せ引き(vCrest)と大きなノイズでずらす。
                              水際の線が時間で動き、場所でギザギザに崩れる
       3. 岸で泡立つ        … 水際をまたぐ帯。内側(水中)へ長く、外側(濡れた砂)へ
                              短く伸ばし、ノイズでちぎる
       4. 空を映す          … scene.environment(空をPMREMに通したもの)をフレネルで
                              乗せる。乗せたぶん水そのものの色は暗くする(足すだけだと
                              白く飛ぶ)
       5. 濡れた地面        … 海と川は水面メッシュを水際の外へ少しだけ延ばし、
                              aDepth を負の値にして「濡れて暗い地面」を描く。
                              波が寄せるとここまで水が乗る(=波打ち際)
       6. 遠くはなめらかに   … 距離で細かい法線を落とす。これが無いと遠景の水面が縞になる

   【前の版が画に出ていなかった理由】(同じ穴に落ちないように残す)
     ・THREE.Color の setHSL/getHSL は既定でリニア色空間として扱う。
       setHSL(h, s, 0.13) は「暗い水」のつもりでも実際は sRGB でいう明度0.4の中間色。
       深い水も浅い水も明るく持ち上がり、照明とトーンマッピングを通って
       同じ淡い水色に潰れていた。**色を人の感覚で書くときは SRGBColorSpace を渡す。**
     ・深さの尺度が小さすぎた(川の中央26に対し「深い」の基準が22)。
       水面のほぼ全面で深さが振り切れ、階調が最外周の1マスにしか出ていなかった。
     ・濡れた砂の輪(オアシス)は半径の 0.87〜0.88 倍に出ていた。水の縁は 0.893 倍
       なので、輪はまるごと水の下に隠れて一度も見えていなかった。

   【溶岩】黒い地殻の割れ目だけが光る。割れ目は場所ごとに位相をずらして脈打ち、
     縁は「冷えた岩 → じわっと熱を持つ地面」へ透明で溶かし込む(硬い楕円にしない)。

   【約束】水面の高さの決め方(heightAt + lift、海はlevelAt)は当たり判定と対になって
     いるので変えない。見た目は色・泡・反射だけで作る。
   ===================================================================== */
import * as THREE from './vendor/three.module.min.js';
import { heightAt, makeTexture, R3, SUN_DIR } from './real3d_common.js';
import { getGroundMaps } from './real3d_terrain.js';

export const ZONE_SEGS = 36, ZONE_RINGS = 6;   // しみの分割数(粗いと起伏から浮き、縁が多角形に見える)
export const ZONE_LIFT = 2.5;                  // 地面から少しだけ浮かせてZファイティングを避ける
const ZONE_UV_TILE = 300;                      // しみのUVが1周するワールド単位(接空間の向きを決めるだけ)

/* しみの縁は真円だと作り物に見えるので、角度でゆらす。
   ・水は内側にだけへこませる(当たり判定の円からはみ出させない)
   ・溶岩は当たり判定の円までを溶岩、その外側を「熱を持った地面」にする      */
const ZONE_WOBBLE = 0.10;
const WATER_WOBBLE = 0.22;     // 水のしみ(オアシス)は真円に見えないよう強めに崩す
const WATER_SEGS = 48;         // 水のしみの円周分割(縁の崩れを細かい波まで出すため多め)
const WATER_RINGS = 9;         // 水のしみの半径分割(浅瀬の階調をここで作る)
const LAVA_RIM_EXTRA = 1.34;   // 溶岩の外へどこまで熱の帯を描くか(当たり判定の半径の倍率)
const WET_RING_INNER = 0.78;   // 濡れた砂を張り始める半径(内側は水に隠れるので張らない)

/* 水の見た目の基準値。深さの単位はワールド座標(=当たり判定と同じ尺度)。
   【重要】水面のほとんどで深さが振り切れると階調が出ない。実際に出る深さ
   (海の沖=30〜95 / 川の中央=30 / オアシスの中央=44)より大きめに取ること。 */
const SHALLOW_SCALE = '6.0';    // これだけの厚みで水底が見えなくなる(浅瀬の緑青)
const DEEP_SCALE    = '17.0';   // これだけの厚みで「深い水の色」になりきる
const ALPHA_SCALE   = '5.0';    // これだけの厚みでほぼ不透明になる(=水際のぼかし幅)
const RIVER_DEPTH  = 30;   // 川の中央の見かけの深さ
const OASIS_DEPTH  = 44;   // オアシスの中央の見かけの深さ
const WATER_ROUGH_NEAR = 0.260;   // 近くは鏡のように空を映す
const WATER_ROUGH_FAR  = 0.400;   // 遠くはわざと粗くする(ちらつき止め)
/* 空の映り込みの上限と、照明で持ち上がるぶんの引き算。
   この2つが「目線の高さで水面が白く飛ぶ / 深さの色が消える」を決める勘所。 */
const REFLECT_MAX    = '0.20';
const WATER_LIT_GAIN = '0.86';
const WATER_ENV_INT  = 0.40;      // 環境光(拡散)の強さ。映り込みは材質側を切ってシェーダーで作る
const DETAIL_NEAR = 420, DETAIL_FAR = 2300;   // 細かい波の法線が消えるまでの距離

/* 濡れた地面(水際の外)。海と川は水面メッシュをここまで延ばし、aDepth を
   「水面より上の高さ(負)」として持たせる。数字は深さと同じ単位。 */
const WET_SPAN = 11;           // これだけ水面より上へ行くと完全に乾いた地面
const SEA_WET_BAND = 230;      // 海の波打ち際の外へ濡れた砂を張る幅(ワールド単位)
const SEA_WET_COLS = 4;
const RIVER_WET_OUT = 0.30;    // 川幅の何倍ぶん外まで濡れた岸を張るか

/* 溶岩の材質(縁も同じ配列に入れる)と、水面シェーダー。
   【重要】配列そのものを作り直さない(import した側が古い配列を掴んでしまう)。 */
export const lavaMats = [];
export const waterShaders = [];

/* 毎フレーム動かす値は「1組のuniformオブジェクト」を全材質で共有する。
   こうしておくと、材質を作り直さないマップ切り替えでも時計が止まらない
   (前の版は resetDynamicLists で登録を捨てたきり詰め直せず、2マップ目から
   波が止まっていた)。 */
const U = {
  uTime:     { value: 0 },
  uDeep:     { value: new THREE.Color(0x08283f) },   // 深い水(テーマから作り直す)
  uShallow:  { value: new THREE.Color(0x3f9fb0) },   // 浅い水
  uBed:      { value: new THREE.Color(0x6b6050) },   // 水底(浅い所で透けて見える)
  uWet:      { value: new THREE.Color(0x554a38) },   // 水際の外の濡れた地面
  uFoam:     { value: new THREE.Color(0xeef6ff) },   // 泡
  uSkyHi:    { value: new THREE.Color(0x24344f) },   // 環境マップが無いときの映り込み(天頂)
  uSkyLo:    { value: new THREE.Color(0x8b9aab) },   // 同(地平)
  uSunDir:   { value: SUN_DIR.clone() },
  uSunCol:   { value: new THREE.Color(0xfff1d6) },
};
const LU = {
  uTime:     U.uTime,
  uBreath:   { value: 1 },                           // 全体のゆっくりした呼吸
  uCrustCol: { value: new THREE.Color(0x2a2320) },   // 冷えた地殻(テーマの岩色から)
  uHot:      { value: new THREE.Color(0xfff0b4) },   // 割れ目の芯(高温)
  uMid:      { value: new THREE.Color(0xff7a1c) },   // 溶けた岩
  uDark:     { value: new THREE.Color(0x7d1a04) },   // 冷えかけ
};

export function resetDynamicLists(){
  // 溶岩の材質は real3d.js が毎試合詰め直す。シェーダーの登録は材質と1対1で
  // 使い回すものなので、ここでは捨てない(捨てると時計が止まる)
  lavaMats.length = 0;
}

let zoneTex = null, zoneMatCache = null;

/* ---- 手続き的なノイズ(画像ファイルは増やさない) ----
   real3d_common.js の tileNoise は縦横で同じ周期しか作れないので、
   縦横で違う細かさにできるものをこのファイル内に持つ(共通側は触らない)。 */
const h2 = (x, y)=>{ const n = Math.sin(x*127.1 + y*311.7) * 43758.5453; return n - Math.floor(n); };
function vnoise(x, y, px, py){
  const wx = (a)=>((a%px)+px)%px, wy = (a)=>((a%py)+py)%py;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x-xi, yf = y-yi;
  const u = xf*xf*(3-2*xf), v = yf*yf*(3-2*yf);
  const a = h2(wx(xi),   wy(yi)),   b = h2(wx(xi+1), wy(yi));
  const c = h2(wx(xi),   wy(yi+1)), e = h2(wx(xi+1), wy(yi+1));
  return (a*(1-u)+b*u)*(1-v) + (c*(1-u)+e*u)*v;
}
function fbm2(u, v, px, py, oct, seed){
  let s = 0, amp = 0.5, fx = px, fy = py;
  for(let o=0;o<oct;o++){ s += vnoise(u*fx + seed*7.3, v*fy + seed*3.1, fx, fy)*amp; amp *= 0.5; fx *= 2; fy *= 2; }
  return s;
}
// 尾根ノイズ(1に近いほど尾根=溶岩では割れ目)
const ridge2 = (u,v,px,py,oct,seed)=> 1 - Math.abs(fbm2(u,v,px,py,oct,seed)*2 - 1);

/* 溶岩と水面のテクスチャ。
   ・水面 waterNormal : R,G=さざ波の法線xy / B=泡のちぎれ具合(ノイズ)
       ※ノイズをアルファに入れてはいけない。canvasは内部で乗算済みアルファなので
         アルファを下げるとRGB(法線)が壊れる。空いている青チャンネルに入れる。
   ・溶岩 lavaData    : R,G=地殻の法線xy / B=割れ目の強さ
   ・溶岩 lavaCrust   : 冷えた地殻の色                                        */
export function buildZoneTextures(){
  if(zoneTex) return zoneTex;

  // ---- 水面 ----
  const W = 256;
  const waterNormal = makeTexture(W, (d)=>{
    const hgt = new Float32Array(W*W), nz = new Float32Array(W*W);
    for(let y=0;y<W;y++) for(let x=0;x<W;x++){
      const u = x/W, v = y/W;
      // うねりの向きが1つだと縞に見えるので、細かさの違う層を重ねる
      hgt[y*W+x] = fbm2(u, v, 6, 5, 5, 0)*1.0 + fbm2(u, v, 17, 19, 3, 1)*0.35;
      // 泡のちぎれ具合。コントラストを強くして「白い塊」がまばらに出るようにする
      nz[y*W+x] = Math.pow(Math.min(1, Math.max(0, fbm2(u, v, 5, 5, 4, 2)*1.35 - 0.15)), 1.6);
    }
    const at = (A,x,y)=>A[(((y%W)+W)%W)*W + (((x%W)+W)%W)];
    for(let y=0;y<W;y++) for(let x=0;x<W;x++){
      const dx = (at(hgt,x+1,y)-at(hgt,x-1,y))*7.0, dy = (at(hgt,x,y+1)-at(hgt,x,y-1))*7.0;
      const len = Math.hypot(dx,dy,1), i=(y*W+x)*4;
      d[i]   = Math.round((-dx/len*0.5+0.5)*255);
      d[i+1] = Math.round(( dy/len*0.5+0.5)*255);
      d[i+2] = Math.round(nz[y*W+x]*255);
      d[i+3] = 255;
    }
  }, false);
  waterNormal.anisotropy = 8;   // 浅い角度で見るので、上げないと模様が干渉して縞になる

  // ---- 溶岩 ----
  const S = 256;
  const H = new Float32Array(S*S), CR = new Float32Array(S*S), PL = new Float32Array(S*S);
  for(let y=0;y<S;y++) for(let x=0;x<S;x++){
    const u = x/S, v = y/S;
    // 大きな板(プレート)がゆっくり割れている、という作り。
    // 太い割れ目と細い割れ目を別々に作って重ねると、溶岩らしい網目になる
    const plate  = fbm2(u, v, 3, 3, 4, 0);
    const bigCr  = Math.max(0, ridge2(u, v, 4, 4, 3, 1) - 0.66) * 3.0;
    const fineCr = Math.max(0, ridge2(u, v, 11, 11, 3, 2) - 0.76) * 2.4;
    const crack  = Math.min(1, bigCr*1.0 + fineCr*0.55);
    PL[y*S+x] = plate;
    CR[y*S+x] = crack;
    // 地殻は割れ目に向かって落ち込む(=割れ目に影が入る)
    H[y*S+x] = plate*0.9 + fbm2(u, v, 23, 23, 2, 3)*0.25 - crack*1.15;
  }
  const at = (A,x,y)=>A[(((y%S)+S)%S)*S + (((x%S)+S)%S)];
  const lavaData = makeTexture(S, (d)=>{
    for(let y=0;y<S;y++) for(let x=0;x<S;x++){
      const dx = (at(H,x+1,y)-at(H,x-1,y))*4.5, dy = (at(H,x,y+1)-at(H,x,y-1))*4.5;
      const len = Math.hypot(dx,dy,1), i=(y*S+x)*4;
      d[i]   = Math.round((-dx/len*0.5+0.5)*255);
      d[i+1] = Math.round(( dy/len*0.5+0.5)*255);
      d[i+2] = Math.round(Math.min(1, CR[y*S+x])*255);
      d[i+3] = 255;
    }
  }, false);
  const lavaCrust = makeTexture(S, (d)=>{
    for(let y=0;y<S;y++) for(let x=0;x<S;x++){
      // 冷えた地殻。板ごとに明るさが少し違い、粒立ちがある
      const p = PL[y*S+x], g = h2(x*0.37, y*0.71);
      const t = 0.55 + p*0.75 + g*0.18;
      const i = (y*S+x)*4;
      d[i]   = Math.round(Math.min(1, t*0.42)*255);
      d[i+1] = Math.round(Math.min(1, t*0.34)*255);
      d[i+2] = Math.round(Math.min(1, t*0.30)*255);
      d[i+3] = 255;
    }
  }, true);
  lavaData.anisotropy = 4;

  zoneTex = { waterNormal, lavaData, lavaCrust };
  return zoneTex;
}

/* ---- テーマから水・溶岩の色を作る ----
   決め打ちすると空と喧嘩するので、色相は空(skyTop)から受け取り、水らしい青緑へ
   寄せる。浅い水は水底(theme.low)の色を混ぜて「底が透けている」ようにする。

   【重要】setHSL/getHSL は第4引数を省略するとリニア色空間として扱われる。
   人の感覚で「明度0.10の暗い水」と書きたいので、必ず SRGB を渡すこと。
   ここを省略していたせいで、深い水も浅い水も明るく持ち上がって同じ色に潰れ、
   「均一なシアンの帯」に見えていた。                                       */
let themeApplied = null;
const SRGB = THREE.SRGBColorSpace;
function mixHue(a, b, t){
  let d = b - a;
  if(d >  0.5) d -= 1;
  if(d < -0.5) d += 1;
  let h = a + d*t;
  return h - Math.floor(h);
}
function syncTheme(){
  const th = R3.theme;
  if(!th || themeApplied === th) return;
  themeApplied = th;
  const sky = new THREE.Color(th.skyTop), hsl = {};
  sky.getHSL(hsl, SRGB);
  const hue = mixHue(hsl.h, 0.525, 0.74);          // 空の色相を残しつつ青緑へ
  U.uDeep.value.setHSL(hue, 0.84, 0.070, SRGB);                       // 深い所はしっかり暗く
  U.uShallow.value.setHSL(mixHue(hue, 0.455, 0.50), 0.68, 0.42, SRGB); // 浅い所は明るい緑青
  // 水底(=浅い所で透けて見える濡れた地面)。地面の色を暗くして水の色を少し混ぜる
  U.uBed.value.setHex(th.low, SRGB).multiplyScalar(0.62).lerp(U.uShallow.value, 0.34);
  // 水際の外の濡れた地面。乾いた地面より暗く、彩度は地面のまま
  U.uWet.value.setHex(th.low, SRGB).multiplyScalar(0.42);
  U.uFoam.value.setHex(th.haze, SRGB).lerp(new THREE.Color(0xffffff), 0.74);
  // 環境マップが使えないときの映り込み用(空の色そのもの)
  U.uSkyHi.value.setHex(th.skyTop, SRGB);
  U.uSkyLo.value.setHex(th.skyBot, SRGB);
  // 溶岩の地殻はそのマップの岩の色から。光る色は温度の色なのでマップに依らない
  LU.uCrustCol.value.setHex(th.steep).multiplyScalar(1.9);
  // 濡れた砂(オアシスの縁)も地面の色から作る
  if(zoneMatCache && zoneMatCache.sand) zoneMatCache.sand.color.copy(U.uWet.value).multiplyScalar(1.25);
}

/* =====================================================================
   水面の材質(海・川・オアシスで1つを共有)
   ===================================================================== */
let waterMat = null;

/* 水面の断片シェーダー本体。<normal_fragment_maps> を丸ごと置き換えて、
   法線・色・泡・透明度・粗さ・きらめきをまとめて決める(chunkを何度も
   差し替えるより読みやすく、テクスチャの読み出しも2回で済む)。          */
const WATER_FRAG = `
  #ifdef USE_NORMALMAP
    vec2 wxz = vWorldPos.xz;
    float viewDist = length(vViewPosition);
    // 遠いほど細かい波を消す。これが無いと遠景の水面がモアレ(縞)になる
    float det = 1.0 - smoothstep(${DETAIL_NEAR}.0, ${DETAIL_FAR}.0, viewDist);
    vec2 fl = vFlow;

    // 種類ごとの効き具合。海は打ち寄せる波が大きく、川・オアシスは小さい
    float kSea   = 1.0 - step(0.5, vKind);
    float kRiver = step(0.5, vKind) - step(1.5, vKind);
    float kOas   = step(1.5, vKind);

    // 細かさと向きの違う3枚を流す。1枚だとテクスチャの継ぎ目が模様として見える
    vec4 tA = texture2D(normalMap, (wxz + fl * (uTime * 30.0)) * 0.0135);
    vec4 tB = texture2D(normalMap, (wxz - fl * (uTime * 11.0)) * 0.0046 + vec2(0.37, 0.11));
    // 大きくゆっくり動く層。水際の線を崩すのと、泡のまだらに使う
    vec4 tC = texture2D(normalMap, (wxz + fl * (uTime *  4.0)) * 0.0013 + vec2(0.61, 0.29));

    /* ---- その瞬間の水深 ----
       vDepth は静かなときの水の厚み(負の値は水面より上=濡れた地面)。
       ここへ波の寄せ引き(vCrest)と大きなノイズを足したものを実際の水深として使う。
       こうすると水際の線が「時間で寄せて引き」「場所でギザギザに崩れ」、
       メッシュの三角形どおりの直線=養生テープにならない。

       ゆらぎの大きさはその水の深さに見合う量にする。川やオアシスは水際から
       中央までが数十単位しかないので、海と同じ量を揺らすと水面のほとんどが
       水際あつかいになり、一面が泡(牛乳)になる。                         */
    float wobA = kSea*7.0 + kRiver*3.0 + kOas*3.4;
    float wob = (tC.z - 0.5) * 2.0 * wobA
              + ((tA.z - 0.5) * 0.9 + (tB.z - 0.5) * 1.1) * (0.25 + 0.16*wobA);
    float run = (vCrest - 0.5) * (kSea*7.0 + kRiver*2.0 + kOas*1.8);
    float wl  = vDepth + run + wob;
    float wd  = max(0.0, wl);                          // 水の厚み
    float dry = clamp(-wl * (1.0/${WET_SPAN}.0), 0.0, 1.0);   // 0=水際 1=乾いた地面

    // ---- 法線(濡れた地面の上ではさざ波を消す)----
    vec2 nxy = (tA.xy*2.0 - 1.0)*0.85 + (tB.xy*2.0 - 1.0)*1.15;
    vec3 mapN = normalize(vec3(nxy, 1.0));
    mapN.xy *= normalScale * (0.30 + 0.70*det) * (1.0 - 0.92*dry);
    normal = normalize( tbn * mapN );

    /* ---- 深さで色が変わる ----
       水中を進むほど光が吸われる、という形(1-exp(-厚み/L))にする。
       こうすると浅い所の階調が細かく、深い所は飽和して落ち着く。
       ・厚み0付近 … 濡れた底の色(砂・泥が透けて見える)
       ・少し深い  … 明るい緑青
       ・深い      … 暗い青                                                */
    float tBed  = 1.0 - exp(-wd * (1.0/${SHALLOW_SCALE}));
    float tDeep = 1.0 - exp(-wd * (1.0/${DEEP_SCALE}));
    vec3 body = mix(uBed, uShallow, tBed);
    body = mix(body, uDeep, tDeep);
    // 波の谷は薄く見える(光が抜ける)。うねりに合わせて明暗が出ると水らしくなる
    body *= 0.86 + 0.28*vCrest;
    // 水際の外は「濡れて暗い地面」。水の色とは連続につなぐ
    vec3 col = mix(uWet, body, smoothstep(0.0, 1.6, wd));

    /* ---- 泡 ----
       水際をまたぐ帯を作る。内側(水の中)へ長く、外側(濡れた地面)へ短く伸ばすと
       「打ち寄せて砂の上を走り、引いていく」形になる。ノイズでちぎって線にしない。 */
    float nz = tA.z*0.58 + tB.z*0.27 + tC.z*0.15;
    /* 帯の幅は「深さの単位」で書くが、深さが何ワールド単位で変わるかは水ごとに
       まるで違う(海の浜=0.04/単位 に対し 川=0.2/単位)。川とオアシスは
       同じ数字だと帯が数ピクセルになって見えないので、太めに取る。          */
    float foamIn  = kSea*8.0 + kRiver*7.0 + kOas*3.4;
    float foamOut = kSea*3.0 + kRiver*3.5 + kOas*1.6;
    // 池は波が立たないので泡も控えめ(海=打ち寄せる / 川=岸を洗う / 池=にじむ)
    float foamGain = kSea*1.0 + kRiver*0.88 + kOas*0.60;
    // 水際(wl=0)で濃く、内へも外へも抜ける
    float band = smoothstep(-foamOut, -foamOut*0.20, wl)
               * (1.0 - smoothstep(foamIn*0.12, foamIn, wl));
    // ノイズで完全に切れる所を作る。薄く一様にかけると霧のような白い膜になる
    float shoreFoam = band * clamp((nz - 0.13 + 0.16*band) * 3.4, 0.0, 1.0) * foamGain;
    // 波頭の白(海だけ)
    float caps = kSea * smoothstep(0.80, 1.0, vCrest) * smoothstep(0.45, 0.92, nz) * 0.8;
    float foam = clamp(max(shoreFoam, caps), 0.0, 1.0) * (0.30 + 0.70*det);
    col = mix(col, uFoam, foam);

    /* ---- 空を映す(フレネル)----
       正面から見た水はほとんど映らず、浅い角度(=遠く・目線の高さ)ほど空が映る。

       【白飛びさせないための決め事】
       ・映り込みは足すだけでなく、そのぶん水そのものの色を必ず暗くする。
       ・映り込みの上限を REFLECT_MAX で止める。物理どおり浅い角度で1.0まで
         上げると、目線の高さから見た水面が一面の空の色(=白)になり、
         せっかくの深さの色が全部消える。
       ・MeshStandardMaterial 自身も環境マップの映り込みを持っている。二重に
         乗ると白く飛ぶので、材質側の envMapIntensity は低くしてここで作る。 */
    vec3 V = normalize(vViewPosition);
    float fres = pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 5.0);
    float F = min(0.02 + 0.80*fres, ${REFLECT_MAX}) * (1.0 - foam) * (1.0 - dry)
              * smoothstep(0.0, 1.2, wd);
    vec3 skyR;
    #ifdef USE_ENVMAP
      // 空をPMREMに通した環境マップ。envMapIntensityで割って素の空の明るさへ戻す
      skyR = getIBLRadiance(V, normal, mix(0.06, 0.32, 1.0 - det)) / max(envMapIntensity, 0.001);
    #else
      vec3 rw = inverseTransformDirection(reflect(-V, normal), viewMatrix);
      skyR = mix(uSkyLo, uSkyHi, clamp(rw.y*1.7, 0.0, 1.0));
    #endif
    skyR = min(skyR, vec3(2.2));
    /* 太陽(SUN_INTENSITY=4.6)と環境光で、水の色はそのままだと1.2〜1.5倍に
       持ち上がる。水は「暗い所が暗いまま見える」ことが命なので、そのぶんを
       見越して下げる。濡れた地面は地面の一部なので下げない。               */
    float lit = mix(1.0, ${WATER_LIT_GAIN}, smoothstep(0.0, 1.6, wd));
    diffuseColor.rgb = col * (1.0 - F) * lit;
    totalEmissiveRadiance += skyR * F;

    /* ---- 透明度 ----
       厚み0で完全に透明。ここが水際のぼかしそのものなので、メッシュの縁を
       別に隠す細工は要らない(水面メッシュは必ず厚み0の所で land と接する)。 */
    float wa = 1.0 - exp(-wd * (1.0/${ALPHA_SCALE}));
    wa = mix(wa*0.94, 0.995, fres * smoothstep(0.0, 3.0, wd));
    /* 濡れた地面。【重要】水の中(dry=0)では必ず0にすること。ここを
       (1-dry)^2 だけにしていると水面じゅうで下限0.8の不透明度がかかり、
       せっかく厚み0へ透明に抜いた水際がまた硬い線に戻る。                */
    float wetA = smoothstep(0.0, 0.10, dry) * (1.0 - dry) * (1.0 - dry) * 0.85;
    diffuseColor.a = clamp(max(max(wa, wetA), foam*0.92), 0.0, 1.0);

    // ---- 粗さ(遠いほど粗く=ちらつき止め / 泡と濡れた地面はざらざら)----
    roughnessFactor = mix(${WATER_ROUGH_NEAR}, ${WATER_ROUGH_FAR}, 1.0 - det);
    roughnessFactor = mix(roughnessFactor, 0.80, foam);
    roughnessFactor = mix(roughnessFactor, 0.95, dry);

    // ---- 太陽のきらめき ----
    vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
    // pow(x, 256) を二乗8回で作る(powより安い。見た目は変わらない)
    float sp = max(dot(normal, normalize(sunV + V)), 0.0);
    sp *= sp; sp *= sp; sp *= sp; sp *= sp; sp *= sp; sp *= sp; sp *= sp; sp *= sp;
    totalEmissiveRadiance += uSunCol * sp * 0.60 * det * (1.0 - foam) * (1.0 - dry)
                             * smoothstep(0.0, 1.0, wd);
  #endif
`;

export function waterMaterial(){
  syncTheme();
  if(waterMat) return waterMat;
  const tex = buildZoneTextures();
  waterMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: WATER_ROUGH_NEAR, metalness: 0.0,
    normalMap: tex.waterNormal, normalScale: new THREE.Vector2(0.50, 0.50),
    transparent: true, opacity: 1.0,
    /* 材質自身の映り込みは低く抑える。MeshStandardMaterial の環境反射は浅い角度で
       ほぼ全反射まで上がるので、そのままだと目線の高さで水面が空の色に飛ぶ。
       映り込みはシェーダー側(フレネル+REFLECT_MAX)で作る。               */
    envMapIntensity: WATER_ENV_INT,
    // 地面のすぐ上に乗るので、深度の取り合い(ちらつき)を避ける
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    // 手で組んだ帯なので三角形の表裏が揃わない。水面は裏からも見えてよい
    side: THREE.DoubleSide,
  });
  waterMat.userData.shared = true;
  waterMat.userData.zoneKind = 'water';
  waterMat.onBeforeCompile = (shader)=>{
    Object.assign(shader.uniforms, U);   // 時計と色は全材質で1組を共有する
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aShore;   // 0=沖/川の中央  1=岸ぎわ
        attribute float aDepth;   // 水の厚み(ワールド単位)
        attribute float aKind;    // 0=海 1=川 2=オアシス
        attribute vec2  aFlow;    // 波・流れの向き
        uniform float uTime;
        varying float vShore; varying float vDepth; varying float vKind; varying float vCrest;
        varying vec2  vFlow;  varying vec3  vWorldPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec2 wp0 = (modelMatrix * vec4(transformed, 1.0)).xz;
        float crest = 0.0;
        /* 波で動かしてよいのは「水がある所」だけ。浅い所や水際の外(aDepth<=0)まで
           動かすと、水面が地面を突き抜けて板が浮いて見える。                */
        float sub = smoothstep(0.0, 6.0, aDepth);
        if(aKind < 0.5){
          /* 海: 岸へ寄せるうねり。波の線が定規で引いたように真っ直ぐにならないよう、
             岸に沿って位相をうねらせ、周期の違う波を3つ重ねる。
             岸に近づくほど波が育ち、water lineの直前で崩れて消える。          */
          float ph = aShore*22.0 - uTime*1.5 + sin(wp0.y*0.0030)*1.2 + sin(wp0.y*0.0011 + 2.0)*0.8;
          float w1 = sin(ph);
          float w2 = sin(ph*0.47 + sin(wp0.y*0.0018)*1.6 + 1.1);
          float w3 = sin(ph*2.90 - wp0.y*0.0042);
          crest = w1*0.55 + w2*0.30 + w3*0.15;
          float grow = smoothstep(0.05, 0.86, aShore);
          float die  = 1.0 - smoothstep(0.90, 1.00, aShore);
          transformed.y += crest * 9.0 * (0.25 + grow) * die * sub;
        } else if(aKind < 1.5){
          // 川: 流れる向きへ小さなさざ波が進む
          float ph = dot(wp0, aFlow)*0.055 - uTime*3.0;
          crest = sin(ph)*0.6 + sin(ph*2.3 + wp0.x*0.010)*0.4;
          transformed.y += crest * 1.4 * (1.0 - aShore*0.85) * sub;
        } else {
          // オアシス: 風で寄る細かい波
          float ph = dot(wp0, aFlow)*0.050 - uTime*1.7;
          crest = sin(ph)*0.65 + sin(ph*1.9 + 2.0)*0.35;
          transformed.y += crest * 1.0 * (1.0 - aShore*0.80) * sub;
        }
        vShore = aShore; vDepth = aDepth; vKind = aKind; vFlow = aFlow;
        vCrest = crest*0.5 + 0.5;
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uBed;
        uniform vec3 uWet;  uniform vec3 uFoam;
        uniform vec3 uSkyHi; uniform vec3 uSkyLo;
        uniform vec3 uSunDir; uniform vec3 uSunCol;
        varying float vShore; varying float vDepth; varying float vKind; varying float vCrest;
        varying vec2  vFlow;  varying vec3  vWorldPos;`)
      .replace('#include <normal_fragment_maps>', WATER_FRAG)
      /* MeshStandardMaterial 自身の鏡面反射(太陽のハイライトと環境マップの映り込み)を
         止める。これは浅い角度でほぼ全反射まで上がるので、こちらのフレネルと二重に
         乗って「目線の高さで水面が真っ白」になっていた。水の映り込みと太陽のきらめきは
         WATER_FRAG が作るので、材質側は消してよい(拡散光と環境光は残る)。      */
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.specularColor = vec3(0.0);
        material.specularF90 = 0.0;`);
    waterShaders.push(shader);
  };
  return waterMat;
}

/* =====================================================================
   しみ(オアシスの水・濡れた砂・溶岩)の円盤
   ===================================================================== */

/* 地形に沿う円盤。ワールド座標で高さを決めるのでメッシュ自体は原点に置く。
   縁は角度でゆらす(真円は作り物に見える)。rad = 0(中心)〜1(縁)。      */
function buildDisc(radius, lift, cx, cy, wobble, extend, inner, rings, segs){
  segs = segs || ZONE_SEGS;
  const s1 = h2(cx*0.013, cy*0.017)*6.283, s2 = h2(cx*0.031, cy*0.007)*6.283, s3 = h2(cx*0.005, cy*0.023)*6.283;
  const s4 = h2(cx*0.019, cy*0.011)*6.283, s5 = h2(cx*0.007, cy*0.037)*6.283;
  /* -1〜1。低い周波数だけだと「へこんだ丸」に見えるので、高い周波数まで足して
     入り江と岬が交互に出るようにする(オアシスが真円のリングに見えない条件)。 */
  const wob = (a)=> Math.sin(a*3+s1)*0.42 + Math.sin(a*5+s2)*0.26 + Math.sin(a*8+s3)*0.16
                  + Math.sin(a*13+s4)*0.10 + Math.sin(a*21+s5)*0.06;
  const pos = [], rad = [], index = [];
  for(let r=0;r<=rings;r++){
    const t = inner + (1 - inner)*(r/rings);   // inner=0なら 0(中心)〜1(縁)
    for(let c=0;c<=segs;c++){
      const a = (c/segs)*Math.PI*2;
      // 縁だけをゆらす。水は内側にしかへこませない(当たり判定の円からはみ出さない)
      const k = 1 - wobble*(0.5 + 0.5*wob(a))*t*t;
      const rr = radius * extend * Math.max(0.02, t) * k;
      const x = cx + Math.cos(a)*rr, y = cy + Math.sin(a)*rr;
      pos.push(x, heightAt(x, y) + lift, y);
      rad.push(t * extend);
    }
  }
  const stride = segs + 1;
  for(let r=0;r<rings;r++){
    for(let c=0;c<segs;c++){
      const a = r*stride + c, b = a+1, d = a+stride, e = d+1;
      // 【重要】この巻き方だと法線が上を向く。逆にすると面が下を向き、
      // 片面描画の材質(溶岩・濡れた砂)が裏面カリングで丸ごと消える
      index.push(a, b, e, a, e, d);
    }
  }
  return { pos, rad, index };
}

// 円盤の共通後処理(UVと法線)
function finishDisc(geo, pos){
  const uv = new Float32Array((pos.length/3)*2);
  for(let i=0, j=0; i<pos.length; i+=3, j+=2){
    uv[j] = pos[i]/ZONE_UV_TILE; uv[j+1] = pos[i+2]/ZONE_UV_TILE;
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
}

export function buildZoneMesh(z, mat, radius, lift){
  const kind = (mat.userData && mat.userData.zoneKind) || 'wet';
  const isLava  = (kind === 'lava');
  const isWater = (kind === 'water');
  const isWet   = (kind === 'wet');
  const extend  = isLava ? LAVA_RIM_EXTRA : 1.0;
  // 水と、その外の濡れた砂の輪は同じ崩し方にする(ずれると輪だけ真円に見える)
  const wobble  = isLava ? ZONE_WOBBLE*0.6 : ((isWater || isWet) ? WATER_WOBBLE : ZONE_WOBBLE);
  /* 濡れた砂は水の外側にしか見えないので、円盤ではなく輪として張る。
     中身まで張ると水の下でもう一枚ぶん塗ることになり、砂漠マップ(オアシス6個)で
     そのまま描画時間に効いてしまう。                                        */
  const inner = isWet ? WET_RING_INNER : 0;
  const rings = isWet ? 4 : (isWater ? WATER_RINGS : ZONE_RINGS);
  const segs  = isWater ? WATER_SEGS : ZONE_SEGS;
  const d = buildDisc(radius, lift, z.x, z.y, wobble, extend, inner, rings, segs);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
  geo.setAttribute('aRad', new THREE.Float32BufferAttribute(d.rad, 1));
  geo.setIndex(d.index);
  if(isWater){
    // オアシスも海・川と同じ水面シェーダーで描く(深さ・泡・反射が同じ理屈で効く)
    const n = d.rad.length;
    const shore = new Float32Array(n), depth = new Float32Array(n), knd = new Float32Array(n), flow = new Float32Array(n*2);
    // 風向き(池ごとに固定)。さざ波の流れる向きに使う
    const ang = h2(z.x*0.011, z.y*0.019)*Math.PI*2;
    const fx = Math.cos(ang), fy = Math.sin(ang);
    for(let i=0;i<n;i++){
      const t = d.rad[i];
      shore[i] = t;
      /* お椀型(中央が深く、縁へ向かって浅い棚が広がる)。
         t^1.7 のように縁だけ急に浅くすると、深さの階調が最外周の1マスに潰れて
         「均一な水色の円盤」に見える。1-t^2 なら縁の手前から連続で浅くなる。 */
      depth[i] = OASIS_DEPTH * (1 - t*t);
      knd[i] = 2;
      flow[i*2] = fx; flow[i*2+1] = fy;
    }
    geo.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1));
    geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
    geo.setAttribute('aKind',  new THREE.Float32BufferAttribute(knd, 1));
    geo.setAttribute('aFlow',  new THREE.Float32BufferAttribute(flow, 2));
  }
  finishDisc(geo, d.pos);
  const mesh = new THREE.Mesh(geo, mat);
  /* 水面と溶岩は影を受け取らない。柔らかい影(PCFSoft)は画素ごとに何度も
     シャドウマップを引くので、画面いっぱいに広がる水面では一番高くつく。
     水は空を映して光っている面、溶岩は自分で光っている面なので、影が落ちなくても
     おかしく見えない(濡れた砂は地面の一部なので受け取ったままにする)。   */
  mesh.receiveShadow = isWet;
  // 濡れた砂 → 水 の順に必ず塗る(半透明どうしは距離が同じで順番が定まらないため)
  mesh.renderOrder = isWater ? 3 : (isLava ? 1 : 2);
  return mesh;
}

/* =====================================================================
   しみの材質
   ===================================================================== */

/* 溶岩。冷えた黒い地殻の割れ目だけが光り、割れ目は場所ごとに位相をずらして脈打つ。
   当たり判定の円(aRad=1)までが溶岩、その外側は「熱を持った地面」として透明に溶かす。 */
const LAVA_FRAG = `
  #ifdef USE_NORMALMAP
    vec2 wxz = vWorldPos.xz;
    // 地殻はゆっくり流れる。細かさの違う2枚を別の速さで流すと「板が動いている」ように見える
    vec2 uvA = (wxz + vec2( 4.0, -3.0) * uTime) * 0.0060;
    vec2 uvB = (wxz + vec2(-2.5,  1.6) * uTime) * 0.0165 + vec2(0.23, 0.61);
    vec4 dA = texture2D(normalMap, uvA);
    vec4 dB = texture2D(normalMap, uvB);
    vec2 nxy = (dA.xy*2.0 - 1.0)*1.15 + (dB.xy*2.0 - 1.0)*0.55;
    vec3 mapN = normalize(vec3(nxy, 1.0));
    mapN.xy *= normalScale;
    normal = normalize( tbn * mapN );

    // 割れ目。大小2枚の濃い方を採ると網目が途切れずにつながる。
    // しきい値を上げて「光るのは割れ目だけ / 大半は黒い板」にする
    float crackRaw = max(dA.z, dB.z*0.80);
    float crack = smoothstep(0.26, 0.92, crackRaw);
    // 場所ごとに位相をずらした脈動(全体が同時に明滅すると作り物に見える)
    float pulse  = 0.62 + 0.38*sin(uTime*1.9 + wxz.x*0.0075 + wxz.y*0.0061);
    float pulse2 = 0.75 + 0.25*sin(uTime*0.7 - wxz.x*0.0021 + 1.7);
    // 中ほどまで熱く、縁(vRad=1)の手前で急に冷える
    float hot = 1.0 - smoothstep(0.55, 0.98, vRad);
    float heat = clamp(crack * (0.20 + 0.80*hot) * pulse * pulse2 * uBreath, 0.0, 1.0);

    // 冷えた地殻の色。テクスチャは明るさのばらつきだけを持ち、色はテーマの岩から
    float cv = texture2D(uCrust, uvA).r;
    vec3 crust = uCrustCol * (0.50 + 1.40*cv);
    // 割れ目は 暗い赤 → 溶けた橙 → 白熱 と段階的に上がる
    vec3 glow  = mix(uDark, uMid, smoothstep(0.05, 0.55, heat));
    glow = mix(glow, uHot, smoothstep(0.62, 1.0, heat));
    diffuseColor.rgb = mix(crust, glow*0.35, smoothstep(0.02, 0.35, heat));
    totalEmissiveRadiance += glow * smoothstep(0.03, 0.9, heat) * 2.3;

    // 縁の熱。溶岩の外側は「焼けた地面」。のっぺりした赤い輪にならないよう、
    // 割れ目のノイズで濃淡を付けてから透明へ抜く
    float rim = smoothstep(1.0, ${LAVA_RIM_EXTRA.toFixed(2)}, vRad);
    diffuseColor.rgb = mix(diffuseColor.rgb, crust*0.70, rim);
    float rimHeat = smoothstep(0.86, 1.06, vRad) * (1.0 - rim) * (0.25 + 1.10*crackRaw);
    totalEmissiveRadiance += uDark * rimHeat * 1.15 * pulse;
    // 縁をノイズで崩して硬い楕円にしない
    float edge = vRad + (dB.z - 0.35)*0.14 + (dA.z - 0.45)*0.08;
    diffuseColor.a = 1.0 - smoothstep(${(LAVA_RIM_EXTRA-0.30).toFixed(2)}, ${LAVA_RIM_EXTRA.toFixed(2)}, edge);
    roughnessFactor = mix(0.92, 0.42, heat);
  #endif
`;

// しみの材質は種類ごとに1つだけ作って共有する
export function zoneMaterial(kind){
  syncTheme();
  if(!zoneMatCache){
    const tex = buildZoneTextures();
    const th = R3.theme;
    const groundMaps = getGroundMaps();
    const sandNormal = groundMaps ? groundMaps.normalMap.clone() : null;
    if(sandNormal){ sandNormal.needsUpdate = true; sandNormal.repeat.set(1,1); sandNormal.offset.set(0,0); }
    /* 濡れた砂(オアシスの縁)。色はテーマの地面から作り、外へ向かって透明に乾かす。

       【重要】この輪は real3d.js から「水の半径 × 1.12」で張られる。つまり
       水際は vRad = 1/1.12 = 0.893 で、そこより内側はすべて水の下に隠れる。
       前の版は濃い所を 0.86〜0.88 に置いていたので、輪はまるごと水に隠れて
       一度も画に出ていなかった(=水際に濡れた砂が無い、という指摘の正体)。
       濃い所は必ず 0.893 より外に置くこと。                                   */
    const sand = new THREE.MeshStandardMaterial({
      color: new THREE.Color(th ? th.low : 0x9a7a46).multiplyScalar(0.42),
      roughness: 0.72, metalness: 0.0,
      normalMap: sandNormal, normalScale: new THREE.Vector2(0.6, 0.6),
      transparent: true, opacity: 1.0, envMapIntensity: 0.55,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    sand.userData.zoneKind = 'wet';
    sand.onBeforeCompile = (shader)=>{
      shader.uniforms.uNoise = { value: tex.waterNormal };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aRad;
          varying float vRad; varying vec3 vWetPos;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vRad = aRad;
          vWetPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uNoise;
          varying float vRad; varying vec3 vWetPos;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          /* 水際(0.893)のすぐ外がいちばん濡れていて、外へ行くほど乾いて薄くなる。
             縁をノイズでずらして、硬い輪(真円の線)にしない。            */
          float wn = texture2D(uNoise, vWetPos.xz * 0.0022).z;
          float e = vRad + (wn - 0.5)*0.105;
          diffuseColor.rgb *= mix(1.0, 1.55, smoothstep(0.90, 1.02, e));
          diffuseColor.a *= smoothstep(0.878, 0.910, e) * (1.0 - smoothstep(0.925, 1.02, e)) * 0.9;`);
    };

    const lava = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.9, metalness: 0.0,
      normalMap: tex.lavaData, normalScale: new THREE.Vector2(1.25, 1.25),
      // 光る量はシェーダーが totalEmissiveRadiance へ足す。materialのemissiveは黒のまま
      emissive: new THREE.Color(0x000000),
      transparent: true, opacity: 1.0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    lava.userData.zoneKind = 'lava';
    lava.onBeforeCompile = (shader)=>{
      Object.assign(shader.uniforms, LU);
      shader.uniforms.uCrust = { value: tex.lavaCrust };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aRad;
          varying float vRad; varying vec3 vWorldPos;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vRad = aRad;
          vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform float uBreath;
          uniform sampler2D uCrust;
          uniform vec3 uCrustCol; uniform vec3 uHot; uniform vec3 uMid; uniform vec3 uDark;
          varying float vRad; varying vec3 vWorldPos;`)
        .replace('#include <normal_fragment_maps>', LAVA_FRAG);
    };

    const water = waterMaterial();
    zoneMatCache = { sea: water, river: water, oasis: water, sand, lava };
  }
  Object.values(zoneMatCache).forEach(m=>{ m.userData.shared = true; });
  return zoneMatCache[kind];
}

/* =====================================================================
   海と川(1枚のつながった水面)

   円を並べて表現すると輪郭が数珠つなぎに見えるので、海は「海岸線(seaEdgeX)の
   沖側」、川は「円の連なりを芯にしたリボン」として1枚の面を張る。
   ===================================================================== */
const SEA_COLS = 30;          // 沖→岸の分割数(岸ぎわを細かくする)
const SEA_ROW_STEP = 170;     // 海岸線に沿う分割の間隔
const SEA_EXTENT = 4200;      // 海岸線から沖へどこまで水面を張るか
const SEA_LIFT = 4;           // 地面に沿う浅瀬ぶんの持ち上げ
const RIVER_SPLIT_DIST = 700; // これ以上離れていたら別の川とみなす
/* 川の断面。|s|<=1 が水、その外は濡れた岸。
   分割が粗いと深さの階調が最外周の1マスに潰れて「均一な水色の帯」になるので、
   中央から岸へ向けて詰めて取る。                                            */
const RIVER_PROFILE = [-1.30, -1.14, -1.0, -0.86, -0.70, -0.52, -0.32, 0.0,
                        0.32, 0.52, 0.70, 0.86, 1.0, 1.14, 1.30];
const RIVER_CROSS = RIVER_PROFILE.length;

// 頂点配列から水面メッシュを組む(位置・法線はワールド座標そのまま)
function buildWaterMesh(pos, shore, depth, kind, flow, index){
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  geo.setAttribute('aKind',  new THREE.Float32BufferAttribute(kind, 1));
  geo.setAttribute('aFlow',  new THREE.Float32BufferAttribute(flow, 2));
  geo.setIndex(index);
  // UVはワールド座標から作る(しみと同じ考え方。接空間の向きを揃えるために要る)
  const uv = new Float32Array((pos.length/3)*2);
  for(let i=0, j=0; i<pos.length; i+=3, j+=2){
    uv[j] = pos[i]/ZONE_UV_TILE; uv[j+1] = pos[i+2]/ZONE_UV_TILE;
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  // 三角形の向きによって法線が下を向くことがあるので、必ず上向きに揃える
  const nrm = geo.attributes.normal;
  for(let i=0;i<nrm.count;i++){
    if(nrm.getY(i) < 0) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
  }
  nrm.needsUpdate = true;
  const mesh = new THREE.Mesh(geo, waterMaterial());
  mesh.receiveShadow = true;
  mesh.renderOrder = 3;
  return mesh;
}

/* 海。海岸線 seaEdgeX(y) の沖側に、岸に沿った格子を張る。
   列(u)が 0=沖 1=岸 なので、そのまま波の進む向きと泡の位置に使える。

   【海面の高さ】当たり判定 isInSea(world.js) は `x < seaEdgeX(y)` の2D判定で高さを
   見ない。つまり「海岸線より沖はすべて海」なので、見た目もそこを水で覆っていないと
   当たり判定とズレる。前の版は沖の地形だけをサンプルして高さを決めていたため、
   海面が浜より低く落ちて海が水たまりのように見える行が多かった(=ズレていた)。
   ここでは波打ち際(海岸線)の地面を基準にし、沖の起伏に合わせて持ち上げる。
   持ち上げ幅には上限を置く(上げすぎると水際が崖になる)。                    */
const SEA_MIN_DEPTH = 30;   // 沖はこれだけ深くする(浅いままだと沖まで水色で「海」に見えない)
const SEA_MAX_RISE  = 95;   // 海面が浜より高くなってよい上限
export function buildSeaMesh(edgeFn, worldH){
  const y0 = -600, y1 = worldH + 600;
  const rows = Math.max(2, Math.round((y1-y0)/SEA_ROW_STEP));
  const levelAt = (y)=>{
    const edge = edgeFn(y);
    // 波打ち際の地面(ここが水面と地面の交わる所になる)
    let shoreG = 0;
    for(let k=0;k<3;k++) shoreG += heightAt(edge - k*130, y);
    shoreG /= 3;
    // 沖の起伏。これより低いと沖の丘が水面から突き出て海に見えない
    const samples = [];
    for(let k=1;k<=6;k++) samples.push(heightAt(edge - SEA_EXTENT*(k/7), y));
    samples.sort((a,b)=>a-b);
    const off = samples[Math.round((samples.length-1)*0.8)];
    return shoreG + Math.max(SEA_MIN_DEPTH, Math.min(SEA_MAX_RISE, off + 6 - shoreG));
  };
  const pos = [], shore = [], depth = [], kind = [], flow = [], index = [];
  for(let r=0;r<=rows;r++){
    const y = y0 + (y1-y0)*(r/rows);
    const edge = edgeFn(y);
    // 水面が縦に波打たないよう、前後の行と平均して滑らかにする
    const level = (levelAt(y - SEA_ROW_STEP) + levelAt(y)*2 + levelAt(y + SEA_ROW_STEP)) / 4;
    for(let c=0;c<=SEA_COLS;c++){
      const u = c/SEA_COLS;                       // 0=沖 1=岸
      const x = edge - SEA_EXTENT*Math.pow(1-u, 1.7);   // 岸に近いほど細かく
      const gr = heightAt(x, y);
      const g = gr + SEA_LIFT;
      // 沖は水平な海面。岸ぎわだけ地面へ寄せて、水際に段差が立たないようにする。
      // 寄せ始める所を沖寄りにすると、遠浅の帯(明るい水色)が広く出て砂浜らしくなる
      const t = Math.max(0, Math.min(1, (u - 0.62)/0.38));
      const smooth = t*t*(3-2*t);
      const surf = Math.max(g, level*(1-smooth) + g*smooth);
      pos.push(x, surf, y);
      shore.push(u);
      // 水の厚み。0になる所(=水面が地面に接する所)で完全に透明になり、水際が線にならない
      depth.push(Math.max(0, surf - SEA_LIFT - gr));
      kind.push(0);
      flow.push(1, 0);   // 岸は+x側。波はこの向きへ寄せる
    }
    /* ---- 波打ち際の外(濡れた砂)----
       地面テクスチャは触れないので、水面メッシュを浜側へ少しだけ延ばして
       「濡れて暗い砂」を重ねる。aDepth を負(=水面より上の高さ)にすると、
       シェーダー側が水ではなく濡れた地面として描く。波が寄せるとここまで
       水と泡が乗るので、水際が動いて見える。                              */
    for(let k=1;k<=SEA_WET_COLS;k++){
      const kk = k/SEA_WET_COLS;
      const x = edge + SEA_WET_BAND*Math.pow(kk, 1.5);
      const gr = heightAt(x, y);
      // 水際の持ち上げ(SEA_LIFT)から地面へなだらかに降ろす。段差を作らない
      pos.push(x, gr + SEA_LIFT*(1-kk)*0.75 + 0.7, y);
      shore.push(1);
      depth.push(-WET_SPAN*kk);
      kind.push(0);
      flow.push(1, 0);
    }
  }
  const stride = SEA_COLS + 1 + SEA_WET_COLS;
  for(let r=0;r<rows;r++){
    for(let c=0;c<stride-1;c++){
      const a = r*stride + c, b = a+1, d = a+stride, e = d+1;
      index.push(a, d, b, b, d, e);
    }
  }
  return buildWaterMesh(pos, shore, depth, kind, flow, index);
}

/* 川。円の連なりを芯にしてリボンを張る(円そのものは描かない)。
   円は生成順に並んでいるので、離れすぎた所で別の川に切り分ける。          */
export function splitRivers(zones){
  const rivers = [];
  let cur = null;
  for(let i=0;i<zones.length;i++){
    const z = zones[i];
    if(!cur || Math.hypot(z.x-cur[cur.length-1].x, z.y-cur[cur.length-1].y) > RIVER_SPLIT_DIST){
      cur = []; rivers.push(cur);
    }
    cur.push(z);
  }
  return rivers.filter(r=>r.length >= 2);
}

export function buildRiverMesh(chain){
  const pos = [], shore = [], depth = [], kind = [], flow = [], index = [];
  const N = chain.length;
  for(let i=0;i<N;i++){
    const p = chain[i];
    const a = chain[Math.max(0,i-1)], b = chain[Math.min(N-1,i+1)];
    let dx = b.x-a.x, dy = b.y-a.y;
    const len = Math.hypot(dx,dy) || 1;
    dx/=len; dy/=len;                       // 流れる向き(海の方へ)
    const nx = -dy, ny = dx;                // 川幅の向き
    const w = p.radius*1.05;
    for(let k=0;k<RIVER_CROSS;k++){
      const s = RIVER_PROFILE[k];
      const sa = Math.abs(s);
      const x = p.x + nx*w*s, y = p.y + ny*w*s;
      const gr = heightAt(x, y);
      if(sa <= 1){
        pos.push(x, gr + SEA_LIFT*0.6, y);
        shore.push(sa*sa);                       // 0=中央 1=岸
        depth.push(RIVER_DEPTH * (1 - sa*sa));   // 中央ほど深い(見かけ)
      }else{
        // 岸の外の濡れた土。aDepth を負にして「水面より上」を表す
        const kk = (sa - 1)/RIVER_WET_OUT;
        pos.push(x, gr + SEA_LIFT*0.6*(1-kk)*0.7 + 0.5, y);
        shore.push(1);
        depth.push(-WET_SPAN*kk);
      }
      kind.push(1);
      flow.push(dx, dy);
    }
  }
  for(let i=0;i<N-1;i++){
    const a = i*RIVER_CROSS, b = (i+1)*RIVER_CROSS;
    for(let k=0;k<RIVER_CROSS-1;k++){
      index.push(a+k, b+k, a+k+1, a+k+1, b+k, b+k+1);
    }
  }
  return buildWaterMesh(pos, shore, depth, kind, flow, index);
}

/* 毎フレームの動き。共有uniformの時計を進めるだけ(重い処理を置かない)。 */
export function animateWater(t){
  U.uTime.value = t;
  // 溶岩の脈動はシェーダー側(場所ごとに位相をずらす)。ここは全体の呼吸だけ
  if(lavaMats.length) LU.uBreath.value = 1.0 + 0.12*Math.sin(t*0.9);
}
