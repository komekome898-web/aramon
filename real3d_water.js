/* =====================================================================
   リアルマップ: 水(海・川・オアシス)と溶岩

   【水の作り】本物の反射パス(平面反射・屈折)はiPhoneでは重すぎるので使わない。
     代わりに次の5つを重ねて「水に見える」ところまで持っていく。
       1. 深さで色が変わる  … 頂点に「水の厚み(aDepth)」を持たせ、浅い=明るい緑青
                              深い=暗い青、へ連続で変える。厚み0で完全に透明にする
                              ので、水際が硬い線にならない
       2. 空を映す          … scene.environment(空をPMREMに通したもの)+フレネル。
                              浅い角度ほど不透明になり、空の色が乗る
       3. 波が動く          … 頂点シェーダーのうねり(海は岸へ寄せる/川は流れる)
       4. 岸で泡立つ        … 波の位相で寄せ引きする泡。ノイズで縁を崩すので線にならない
       5. 遠くはなめらかに   … 距離で細かい法線を落とす。これをやらないと遠くの水面が
                              縞(モアレ)になる。前の版はここが無くて縞模様に見えていた

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
const LAVA_RIM_EXTRA = 1.34;   // 溶岩の外へどこまで熱の帯を描くか(当たり判定の半径の倍率)
const WET_RING_INNER = 0.78;   // 濡れた砂を張り始める半径(内側は水に隠れるので張らない)

/* 水の見た目の基準値。深さの単位はワールド座標(=当たり判定と同じ尺度)。 */
const DEPTH_SCALE  = 22;   // これだけ深ければ「深い水の色」になる
const RIVER_DEPTH  = 26;   // 川の中央の見かけの深さ
const OASIS_DEPTH  = 40;   // オアシスの中央の見かけの深さ
const FOAM_DEPTH   = '26.0';  // これより浅い所が泡立ちうる(広すぎると牛乳に見える)
const WATER_ROUGH_NEAR = 0.260;   // 近くは鏡のように空を映す
const WATER_ROUGH_FAR  = 0.360;   // 遠くはわざと粗くする(ちらつき止め)
const DETAIL_NEAR = 420, DETAIL_FAR = 2300;   // 細かい波の法線が消えるまでの距離

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
  uFoam:     { value: new THREE.Color(0xeef6ff) },   // 泡
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
   寄せる。浅い水は水底(theme.low)の色を混ぜて「底が透けている」ようにする。   */
let themeApplied = null;
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
  sky.getHSL(hsl);
  const hue = mixHue(hsl.h, 0.525, 0.74);          // 空の色相を残しつつ青緑へ
  U.uDeep.value.setHSL(hue, 0.86, 0.130);
  U.uShallow.value.setHSL(mixHue(hue, 0.455, 0.45), 0.70, 0.42);
  U.uShallow.value.lerp(new THREE.Color(th.low), 0.15);   // 浅い所は水底が透ける
  U.uFoam.value.setHex(th.haze).lerp(new THREE.Color(0xffffff), 0.74);
  // 溶岩の地殻はそのマップの岩の色から。光る色は温度の色なのでマップに依らない
  LU.uCrustCol.value.setHex(th.steep).multiplyScalar(1.9);
  // 濡れた砂(オアシスの縁)も地面の色から作る
  if(zoneMatCache && zoneMatCache.sand) zoneMatCache.sand.color.setHex(th.low).multiplyScalar(0.55);
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
    // 細かさと向きの違う2枚を流す。1枚だとテクスチャの継ぎ目が模様として見える
    vec4 tA = texture2D(normalMap, (wxz + fl * (uTime * 30.0)) * 0.0135);
    vec4 tB = texture2D(normalMap, (wxz - fl * (uTime * 11.0)) * 0.0046 + vec2(0.37, 0.11));
    vec2 nxy = (tA.xy*2.0 - 1.0)*0.85 + (tB.xy*2.0 - 1.0)*1.15;
    vec3 mapN = normalize(vec3(nxy, 1.0));
    mapN.xy *= normalScale * (0.30 + 0.70*det);
    normal = normalize( tbn * mapN );

    // ---- 深さで色が変わる ----
    /* 水際の等高線をノイズで崩す。これをやらないと、水と地面の境目が
       メッシュの三角形どおりの直線になって「切り抜いた紙」に見える。
       海は頂点間隔が数百単位あるので大きく崩す必要がある。川・オアシスは
       メッシュが細かいので、崩しすぎると水がしみのように見える。         */
    float nz = tA.z*0.45 + tB.z*0.55;
    float wobAmp = (vKind < 0.5) ? 20.0 : 4.0;
    float wd = max(0.0, vDepth - (tB.z - 0.45)*wobAmp - (tA.z - 0.45)*4.0);
    float dep  = clamp(wd / ${DEPTH_SCALE}.0, 0.0, 1.0);
    float depC = dep*dep*0.55 + dep*0.45;
    vec3 body  = mix(uShallow, uDeep, depC);
    // 波の谷は薄く見える(光が抜ける)。うねりに合わせて明暗が出ると水らしくなる
    body *= 0.86 + 0.28*vCrest;

    // ---- 泡 ----
    // 浅い所ほど泡立ちやすくし、そこへ波の位相を足す。こうすると「岸と平行に
    // 白い帯が寄せてきて引く」= 打ち寄せる波になる。深い所は波頭だけが白い。
    // 海は打ち寄せる波が広く泡立つ。川・オアシスは岸ぎわだけ
    float foamDepth = (vKind < 0.5) ? ${FOAM_DEPTH} : 9.0;
    float shallow = 1.0 - clamp(wd / foamDepth, 0.0, 1.0);
    float wash = smoothstep(0.40, 0.78, shallow*0.75 + (vCrest - 0.5)*0.85);
    float shoreFoam = wash * (0.40 + 0.65*nz);
    // 波頭の白(海だけ)
    float caps = (vKind < 0.5)
      ? smoothstep(0.82, 1.0, vCrest) * smoothstep(0.45, 0.92, nz) * 0.75
      : 0.0;
    float foam = clamp(max(shoreFoam, caps), 0.0, 1.0) * (0.35 + 0.65*det);
    diffuseColor.rgb = mix(body, uFoam, foam);

    // ---- 空を映す(フレネル)----
    vec3 V = normalize(vViewPosition);
    float fres = pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 5.0);
    // 水際は薄いので透ける。深いほど・浅い角度ほど不透明になり空が映る
    float base = 0.94 * smoothstep(0.0, 0.52, dep);
    float a = mix(base, 0.985, fres * smoothstep(0.0, 0.12, dep));
    /* 水面のメッシュはここで終わり、という縁(aShore=1)で必ず透明へ抜く。
       泡は水際ほど濃いので、これが無いとメッシュの外周そのものが白い直線になって
       「切り抜いた紙」に見える。ノイズを足して縁をギザギザにする。          */
    float shEdge = vShore + (tA.z - 0.45)*0.06;
    float edgeAt = (vKind < 0.5) ? 0.88 : ((vKind < 1.5) ? 0.84 : 0.94);
    float edgeFade = 1.0 - smoothstep(edgeAt, 1.0, shEdge);
    diffuseColor.a = clamp(max(a, foam*0.90), 0.0, 1.0) * edgeFade;

    // ---- 粗さ(遠いほど粗く=ちらつき止め / 泡はざらざら)----
    roughnessFactor = mix(${WATER_ROUGH_NEAR}, ${WATER_ROUGH_FAR}, 1.0 - det);
    roughnessFactor = mix(roughnessFactor, 0.78, foam);

    // ---- 太陽のきらめき ----
    vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
    // pow(x, 256) を二乗8回で作る(powより安い。見た目は変わらない)
    float sp = max(dot(normal, normalize(sunV + V)), 0.0);
    sp *= sp; sp *= sp; sp *= sp; sp *= sp; sp *= sp; sp *= sp; sp *= sp; sp *= sp;
    totalEmissiveRadiance += uSunCol * sp * 0.6 * det * (1.0 - foam);
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
    // 空(PMREM)をよく映すように少し強めにする。色そのものはシェーダーで決める
    envMapIntensity: 0.50,
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
          transformed.y += crest * 9.0 * (0.25 + grow) * die;
        } else if(aKind < 1.5){
          // 川: 流れる向きへ小さなさざ波が進む
          float ph = dot(wp0, aFlow)*0.055 - uTime*3.0;
          crest = sin(ph)*0.6 + sin(ph*2.3 + wp0.x*0.010)*0.4;
          transformed.y += crest * 1.4 * (1.0 - aShore*0.85);
        } else {
          // オアシス: 風で寄る細かい波
          float ph = dot(wp0, aFlow)*0.050 - uTime*1.7;
          crest = sin(ph)*0.65 + sin(ph*1.9 + 2.0)*0.35;
          transformed.y += crest * 1.0 * (1.0 - aShore*0.80);
        }
        vShore = aShore; vDepth = aDepth; vKind = aKind; vFlow = aFlow;
        vCrest = crest*0.5 + 0.5;
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam;
        uniform vec3 uSunDir; uniform vec3 uSunCol;
        varying float vShore; varying float vDepth; varying float vKind; varying float vCrest;
        varying vec2  vFlow;  varying vec3  vWorldPos;`)
      .replace('#include <normal_fragment_maps>', WATER_FRAG);
    waterShaders.push(shader);
  };
  return waterMat;
}

/* =====================================================================
   しみ(オアシスの水・濡れた砂・溶岩)の円盤
   ===================================================================== */

/* 地形に沿う円盤。ワールド座標で高さを決めるのでメッシュ自体は原点に置く。
   縁は角度でゆらす(真円は作り物に見える)。rad = 0(中心)〜1(縁)。      */
function buildDisc(radius, lift, cx, cy, wobble, extend, inner, rings){
  const segs = ZONE_SEGS;
  const s1 = h2(cx*0.013, cy*0.017)*6.283, s2 = h2(cx*0.031, cy*0.007)*6.283, s3 = h2(cx*0.005, cy*0.023)*6.283;
  const wob = (a)=> Math.sin(a*3+s1)*0.5 + Math.sin(a*5+s2)*0.3 + Math.sin(a*8+s3)*0.2;   // -1〜1
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
  const wobble  = isLava ? ZONE_WOBBLE*0.6 : ZONE_WOBBLE;
  /* 濡れた砂は水の外側にしか見えないので、円盤ではなく輪として張る。
     中身まで張ると水の下でもう一枚ぶん塗ることになり、砂漠マップ(オアシス6個)で
     そのまま描画時間に効いてしまう。                                        */
  const inner = isWet ? WET_RING_INNER : 0;
  const rings = isWet ? 3 : ZONE_RINGS;
  const d = buildDisc(radius, lift, z.x, z.y, wobble, extend, inner, rings);
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
      depth[i] = OASIS_DEPTH * (1 - Math.pow(t, 1.7));
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
    // 濡れた砂(オアシスの縁)。色はテーマの地面から作り、外へ向かって透明に乾かす
    const sand = new THREE.MeshStandardMaterial({
      color: new THREE.Color(th ? th.low : 0x9a7a46).multiplyScalar(0.55),
      roughness: 0.62, metalness: 0.0,
      normalMap: sandNormal, normalScale: new THREE.Vector2(0.6, 0.6),
      transparent: true, opacity: 1.0, envMapIntensity: 0.55,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    sand.userData.zoneKind = 'wet';
    sand.onBeforeCompile = (shader)=>{
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aRad;
          varying float vRad;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vRad = aRad;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vRad;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          // 水際ほど濡れて暗く、外へ行くほど乾いて薄くなる(硬い輪にしない)
          diffuseColor.rgb *= mix(0.72, 1.12, smoothstep(0.80, 1.0, vRad));
          diffuseColor.a *= smoothstep(0.79, 0.86, vRad) * (1.0 - smoothstep(0.88, 1.0, vRad));`);
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
const RIVER_CROSS = 7;        // 川の断面の分割数(少ないと泡が川幅いっぱいに広がる)

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
  }
  const stride = SEA_COLS + 1;
  for(let r=0;r<rows;r++){
    for(let c=0;c<SEA_COLS;c++){
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
      const s = -1 + 2*k/(RIVER_CROSS-1);
      const sa = Math.abs(s);
      const x = p.x + nx*w*s, y = p.y + ny*w*s;
      pos.push(x, heightAt(x,y) + SEA_LIFT*0.6, y);
      shore.push(Math.pow(sa, 2.2));                       // 0=中央 1=岸
      depth.push(RIVER_DEPTH * (1 - Math.pow(sa, 1.6)));   // 中央ほど深い(見かけ)
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
