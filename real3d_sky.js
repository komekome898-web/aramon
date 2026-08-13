/* =====================================================================
   リアルマップ: 空・遠景の山並み・環境光(HDRIの代わり)

   ・空は内側を向いた大きな球。多段のグラデーション + 太陽 + 雲(3層)を
     フラグメントシェーダーで描く。雲の「濃さの分布」だけは手続き生成した
     1枚のテクスチャに焼いてある(画像ファイルは増やさない)。
   ・遠景の山並みは距離の違う4枚。稜線はリッジド多重フラクタルで、
     尾根と谷の陰影を頂点色に焼く。遠いほど空気遠近で空の色へ溶かす。
   ・環境光は「同じ空をPMREMに通したもの」。画像ファイルを増やさずPBRを成立させる

   【この空の設計】
   ・空の色・雲の量・太陽の見え方・星は、すべて data.js の REAL3D_THEMES の
     3色(skyTop/skyBot/haze)から導く。data.jsは編集できないので、
     「テーマに無い色」は必ずここでテーマ色から作る(決め打ちしない)。
   ・地平線の色は scene.fog と同じ theme.haze にそろえてある。遠景の山の足元も
     同じ色へ溶かすので、地面のフォグ→遠景→空が一本につながる。
   ・空に描く太陽の位置は real3d_common.js の SUN_DIR そのもの。影の向きと必ず一致する。
   ・雲は動かさない。real3d.js に毎フレームのフックが無いのと、静止のほうが安いため。
   ===================================================================== */
import * as THREE from './vendor/three.module.min.js';
import { R3, SUN_DIR, makeTexture } from './real3d_common.js';

const SKY_RADIUS = 9000;
const RIDGE_DIST = 4300;   // 遠景の山並みの基準距離(地形パッチの外。フォグの影響を受けない)
const CAM_H_REF  = 150;    // 遠景の陰影を焼くときに仮定するカメラ高さ(頂点色は毎試合1回しか作らない)

/* ---------------------------------------------------------------------
   テーマ色から「その空の性格」を読む
   --------------------------------------------------------------------- */
const clamp01 = (v)=> v < 0 ? 0 : (v > 1 ? 1 : v);
// 見た目の印象で判断したいので、リニアではなく sRGB のバイト値のまま扱う
const rgb8 = (hex)=> [((hex>>16)&255)/255, ((hex>>8)&255)/255, (hex&255)/255];
const lum8 = (c)=> c[0]*0.299 + c[1]*0.587 + c[2]*0.114;

/* skyTop/skyBot/haze の3色だけから、雲の量・昼らしさ・星の有無を決める。
   data.js に新しい項目を足せないので「色からその空の性格を逆算する」形にしてある。 */
function skyMood(){
  const th = R3.theme;
  const bot = rgb8(th.skyBot), hz = rgb8(th.haze);
  const lb = lum8(bot), lh = lum8(hz);
  const warm  = clamp01((bot[0]-bot[2]) * 2.2);          // 地平が赤いほど夕方/砂塵
  const day   = clamp01(lb * 1.25 - 0.12);               // 地平が明るいほど昼
  // 霞と地平の色が近い = 空一面が同じ色 = 曇り空
  const close = clamp01(1 - (Math.abs(hz[0]-bot[0]) + Math.abs(hz[1]-bot[1]) + Math.abs(hz[2]-bot[2]))/3 * 14);
  // 火山灰の空: 暖色なのに霞が暗い(明るい砂漠の霞と区別する)
  const ash   = clamp01(warm*1.3 - 0.45) * clamp01(1.6 - lh*2.0);
  const cover = clamp01(0.30 + 0.42*close + 0.40*ash);   // 雲の多さ
  // 夕暮れの空(暗くて青い)にだけ星を出す
  const stars = clamp01((bot[2]-bot[0]) * 3.5) * clamp01(1.55 - lb*2.2);
  return { warm, day, close, ash, cover, stars };
}

/* シェーダーとJS(遠景の山)の両方が使う色。テーマから毎回作り直す。 */
function buildPalette(){
  const th = R3.theme;
  const m = skyMood();
  const C = (h)=> new THREE.Color(h);
  const zenith  = C(th.skyTop);
  const lowSky  = C(th.skyBot);
  const horizon = C(th.haze);                             // scene.fog と同じ色。ここが継ぎ目になる
  const high    = lowSky.clone().lerp(zenith, 0.60);
  const below   = horizon.clone().multiplyScalar(0.84);   // 地平線より下。地面のフォグへ落とす
  // 太陽の色 = 「その空の光の色」。霞の色を最大1へ伸ばし、暖かい白へ寄せる
  const hzN = horizon.clone();
  const mx = Math.max(hzN.r, hzN.g, hzN.b) || 1;
  const sunCol = hzN.multiplyScalar(1/mx).lerp(new THREE.Color(1.0, 0.94, 0.82), 0.5 + 0.3*m.warm);
  // 太陽そのもの。暗く青い空では銀色(月に見える)、暖かい空では橙
  const disc = new THREE.Color(0.80, 0.86, 1.0).lerp(sunCol, clamp01(m.day*0.7 + m.warm*0.6))
                 .multiplyScalar(1.5 + 2.6*m.day);
  // 雲。底面は空の上の色を混ぜた影、天面は太陽の色
  const cloudDark = lowSky.clone().lerp(zenith, 0.34 + 0.22*(1-m.day)).multiplyScalar(0.80 + 0.20*m.day);
  const cloudMid  = lowSky.clone().lerp(sunCol, 0.30 + 0.28*m.day);
  const cloudLit  = sunCol.clone().multiplyScalar(0.55 + 1.05*m.day);
  const cirrus    = sunCol.clone().lerp(horizon, 0.30).multiplyScalar(0.65 + 0.75*m.day);
  return { m, zenith, high, lowSky, horizon, below, sunCol, disc, cloudDark, cloudMid, cloudLit, cirrus };
}

/* 空のグラデーション。**GLSLの skyGrad と同じ式**(遠景の山の空気遠近で使うため
   JS側にも同じものが要る)。片方を直したらもう片方も必ず直すこと。 */
function skyGradJS(pal, sinEl, out){
  const u = Math.max(sinEl, 0);
  const ss = (a,b,x)=>{ const t = clamp01((x-a)/(b-a)); return t*t*(3-2*t); };
  out.copy(pal.horizon).lerp(pal.lowSky, ss(0.0, 0.26, u));
  out.lerp(pal.high,   ss(0.16, 0.55, u));
  out.lerp(pal.zenith, ss(0.38, 1.00, u));
  if(sinEl < 0) out.lerp(pal.below, ss(0.0, 0.11, -sinEl));
  return out;
}

/* ---------------------------------------------------------------------
   雲のテクスチャ(手続き生成)
   R=主役の雲の濃さ / G=もう1層ぶんの別の濃さ / B=高層の巻雲 / A=細かい粒
   テーマに依存しない「濃さの分布」だけを焼く。量と色はシェーダーがテーマから決める。
   1度作れば全マップで使い回すので、生成はセッション中1回だけ。
   --------------------------------------------------------------------- */
const CLOUD_S = 512;
let cloudTex = null;

// 整数から決まる疑似乱数(端末が変わっても同じ模様になる)
function rnd1(i, seed){
  let s = (Math.imul(i|0, 374761393) + Math.imul(seed|0, 668265263)) >>> 0;
  s = (s ^ (s >>> 13)) >>> 0;
  s = Math.imul(s, 1274126177) >>> 0;
  return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
}

// NX×NYの乱数格子。周期がそのままタイルの周期になるので継ぎ目が出ない
function lattice(NX, NY, seed){
  const a = new Float32Array(NX*NY);
  for(let i=0;i<a.length;i++) a[i] = rnd1(i, seed);
  return a;
}
function latAt(lat, NX, NY, u, v){
  const xi = Math.floor(u), yi = Math.floor(v);
  const fx = u - xi, fy = v - yi;
  const sx = fx*fx*(3-2*fx), sy = fy*fy*(3-2*fy);
  const x0 = ((xi % NX) + NX) % NX, y0 = ((yi % NY) + NY) % NY;
  const x1 = (x0 + 1) % NX, y1 = (y0 + 1) % NY;
  const r0 = y0*NX, r1 = y1*NX;
  const a = lat[r0+x0], b = lat[r0+x1], c = lat[r1+x0], e = lat[r1+x1];
  const t = a + (b-a)*sx;
  return t + ((c + (e-c)*sx) - t) * sy;
}

/* 濃さの場を1枚作る。octs = [{nx, ny, amp}, …]。warpは低周波でUVを歪ませる量
   (まっすぐなfBmは規則的に見えるので、少し歪ませると自然な塊になる)。 */
function densityField(S, octs, seed, warp, ridged){
  const lats = octs.map((o,i)=> lattice(o.nx, o.ny, seed*97 + i*13 + 3));
  const wx = lattice(3, 3, seed*31 + 71), wy = lattice(3, 3, seed*31 + 137);
  const out = new Float32Array(S*S);
  let lo = 1e9, hi = -1e9;
  for(let y=0;y<S;y++){
    const v0 = y / S;
    for(let x=0;x<S;x++){
      const u0 = x / S;
      let uu = u0, vv = v0;
      if(warp > 0){
        uu += (latAt(wx, 3, 3, u0*3, v0*3) - 0.5) * warp;
        vv += (latAt(wy, 3, 3, u0*3, v0*3) - 0.5) * warp;
      }
      let s = 0;
      for(let o=0;o<octs.length;o++){
        const L = octs[o];
        let n = latAt(lats[o], L.nx, L.ny, uu*L.nx, vv*L.ny);
        if(ridged){ n = 1 - Math.abs(n*2 - 1); n *= n; }
        s += n * L.amp;
      }
      out[y*S+x] = s;
      if(s < lo) lo = s;
      if(s > hi) hi = s;
    }
  }
  const inv = 1 / Math.max(1e-6, hi - lo);
  for(let i=0;i<out.length;i++) out[i] = (out[i] - lo) * inv;
  return out;
}

function ensureCloudTex(){
  if(cloudTex) return cloudTex;
  const S = CLOUD_S;
  // 主役の積雲。低周波が主で、しきい値で切るとふっくらした塊になる
  // (高周波を強くすると空一面が細かい斑になって「天井のテクスチャ」に見える)
  const A = densityField(S, [
    { nx: 4, ny: 4, amp:0.56 }, { nx: 8, ny: 8, amp:0.26 }, { nx:16, ny:16, amp:0.11 },
    { nx:32, ny:32, amp:0.05 },
  ], 11, 0.16, false);
  // もう1層ぶん。同じ雲が2枚重なって見えないよう、別の種と別の粒度にする
  const B = densityField(S, [
    { nx: 3, ny: 3, amp:0.56 }, { nx: 6, ny: 6, amp:0.27 }, { nx:12, ny:12, amp:0.12 },
    { nx:24, ny:24, amp:0.05 },
  ], 29, 0.22, false);
  // 高層の巻雲。片方向へ引き伸ばした帯(細すぎると引っかき傷に見えるので緩めに)
  const Cc = densityField(S, [
    { nx: 3, ny: 8, amp:0.56 }, { nx: 6, ny:16, amp:0.28 }, { nx:12, ny:32, amp:0.12 },
  ], 47, 0.12, false);
  // 【重要】アルファには値を入れない(255固定)。canvasのアルファは実装によって
  // 乗算済みで持たれることがあり、薄い所でRGBの精度が落ちる。縁を崩す細かい粒は
  // 「Rチャンネルをうんと細かい倍率で引き直したもの」で代用する。
  cloudTex = makeTexture(S, (px)=>{
    for(let i=0;i<S*S;i++){
      px[i*4  ] = A[i]  * 255;
      px[i*4+1] = B[i]  * 255;
      px[i*4+2] = Cc[i] * 255;
      px[i*4+3] = 255;
    }
  }, false);   // 色ではなくデータなのでsRGB変換を通さない
  cloudTex.anisotropy = 4;
  return cloudTex;
}

/* ---------------------------------------------------------------------
   空(ドーム)
   --------------------------------------------------------------------- */
const SKY_VERT = `
  varying vec3 vDir;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDir = wp.xyz - cameraPosition;      // 視線そのもの(球の中心ではなくカメラから測る)
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const SKY_FRAG = `
  uniform vec3 uZenith, uHigh, uLowSky, uHorizon, uBelow;
  uniform vec3 uSunCol, uDisc, uCloudLit, uCloudMid, uCloudDark, uCirrus;
  uniform vec3 uSunDir;
  uniform vec2 uDiscCos;        // x=外側のcos, y=内側のcos(内へ行くほど明るい)
  uniform float uGain, uThr, uCover, uCirrusAmt, uStars, uGlow, uLowAmt;
  uniform sampler2D uCloud;
  varying vec3 vDir;

  float h13(vec3 p){
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  // 空のグラデーション。**JSの skyGradJS と同じ式**(遠景の山がこれに溶け込む)
  vec3 skyGrad(float t){
    float u = max(t, 0.0);
    vec3 c = mix(uHorizon, uLowSky, smoothstep(0.0, 0.26, u));
    c = mix(c, uHigh,   smoothstep(0.16, 0.55, u));
    c = mix(c, uZenith, smoothstep(0.38, 1.00, u));
    return mix(c, uBelow, smoothstep(0.0, 0.11, -t));
  }

  /* 雲の「板」に視線をぶつけた点。素直に d.xz/d.y にすると地平線で無限に発散し、
     ミップマップが一気に潰れて「雲の縁が円く切れる」。分母に下駄をはかせて
     伸びを頭打ちにする(遠近感は残しつつ、地平線ぎわでも模様が壊れない)。 */
  vec2 cloudP(vec3 d, float k){
    return d.xz * (k / (d.y * 0.90 + 0.20));
  }

  /* 雲を1層。少し高い板をもう1度引いて、その差を「上面」として光らせる = 厚みに見える。 */
  vec4 cloudLayer(vec3 d, float k, vec4 mask, float thr, float det, float lit, float sunDot, float top){
    vec2 p  = cloudP(d, k);
    vec4 tx = texture2D(uCloud, p);
    float dB = dot(tx, mask) + det;
    // top>0 のときだけ、少し高い板をもう1度引いて厚みを出す(1回ぶん節約できる)
    float dT = (top > 0.0) ? dot(texture2D(uCloud, p * 1.13), mask) + det : dB;
    float cB = smoothstep(thr, thr + 0.22, dB);
    float cT = smoothstep(thr + 0.04, thr + 0.25, dT);
    float core = smoothstep(thr + 0.09, thr + 0.46, dB);
    // 底は厚いほど暗い / 縁は光が抜けて明るい / 太陽側の上面が最も明るい
    vec3 c = mix(uCloudMid, uCloudDark, core);
    float rim = clamp(cB - core, 0.0, 1.0);
    c += uCloudLit * rim * (0.35 + 0.65 * pow(max(sunDot, 0.0), 3.0)) * lit;
    c += uCloudLit * clamp(cT - cB * 0.72, 0.0, 1.0) * 0.55 * lit * top;
    // 太陽の真横は光が透ける(縁取り)
    c += uSunCol * pow(max(sunDot, 0.0), 14.0) * (1.0 - core) * cB * 0.9 * lit;
    return vec4(c, cB);
  }

  void main(){
    vec3 d = normalize(vDir);
    float el = d.y;
    vec3 col = skyGrad(el);

    // 地平線より下は必ず地形かフォグに隠れる。太陽も雲も要らないので早く抜ける
    // (空の球は画面全体を1度塗るので、ここを削ると塗りの負荷がまるごと減る)
    if(el < -0.02){
      gl_FragColor = vec4(col * uGain, 1.0);
      return;
    }

    float sunDot = dot(d, uSunDir);
    float sd = max(sunDot, 0.0);
    // 地平線の帯。太陽の方角ほど明るく暖かい(前方散乱)
    vec3 sunAz = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
    float az = max(dot(normalize(vec3(d.x, 0.0, d.z)), sunAz), 0.0);
    float band = exp(-max(el, 0.0) * 7.0);
    col = mix(col, mix(col, uSunCol, 0.55), pow(az, 3.0) * band * uGlow);
    // 太陽まわりの光暈(2段)。空全体がうっすら明るくなるぶんと、まぶしい芯
    col += uSunCol * (pow(sd, 4.0) * 0.09 + pow(sd, 34.0) * 0.30) * uGlow;

    // 星(暗くて青い空だけ)。天頂側ほど濃い
    if(uStars > 0.005){
      vec3 sp = d * 190.0;
      vec3 fl = floor(sp);
      float r = h13(fl);
      vec2 o = vec2(h13(fl + 5.3), h13(fl + 11.7));
      float dd = length(fract(sp).xy - o);
      float st = smoothstep(0.34, 0.0, dd) * smoothstep(0.978, 0.998, r);
      col += vec3(0.85, 0.90, 1.0) * st * uStars * smoothstep(0.10, 0.55, el) * (0.4 + 0.6 * r);
    }

    // 太陽(または月)本体。SUN_DIR と同じ向きなので影の向きと必ず一致する
    float disc = smoothstep(uDiscCos.x, uDiscCos.y, sunDot);
    col = mix(col, uDisc, disc * smoothstep(-0.02, 0.06, el));

    // ---- 雲。高い層から順に重ねる(手前=低い層をあとに描く) ----
    float det = (texture2D(uCloud, cloudP(d, 2.1)).r - 0.5) * 0.10;
    float vis = smoothstep(-0.005, 0.055, el);       // 地平線より下には出さない
    float far = smoothstep(0.42, 0.03, el);          // 地平に近い雲ほど霞に溶ける

    // 巻雲。しきい値で切らず、濃さをそのまま薄い膜として重ねる(筋に見せない)
    float cir = dot(texture2D(uCloud, cloudP(d, 1.9)), vec4(0.0,0.0,1.0,0.0));
    cir = smoothstep(0.46, 1.02, cir);
    col = mix(col, uCirrus + uSunCol * pow(sd, 8.0) * 0.5, cir * uCirrusAmt * vis * (1.0 - far * 0.85));

    // 上の雲の段。下の段より小さく見えるので「層」として読める
    vec4 hi = cloudLayer(d, 1.15, vec4(0.0,1.0,0.0,0.0), uThr + 0.05, det*0.8, 0.9, sd, 0.0);
    col = mix(col, mix(hi.rgb, uHorizon, far*0.80), hi.a * uCover * 0.80 * vis);

    // 主役の段
    vec4 lo = cloudLayer(d, 0.58, vec4(1.0,0.0,0.0,0.0), uThr, det, 1.0, sd, 1.0);
    col = mix(col, mix(lo.rgb, uHorizon, far*0.86), lo.a * uCover * uLowAmt * vis);

    // 縞(バンディング)止め。滑らかなグラデーションほど段が見えるので少しだけ散らす
    col += (h13(vec3(gl_FragCoord.xy, 1.0)) - 0.5) * 0.006;
    gl_FragColor = vec4(max(col, 0.0) * uGain, 1.0);
  }`;

/* 空のuniformをテーマから作る/差し替える(メッシュは使い回す) */
function setSkyUniforms(u, forEnv){
  const p = buildPalette(), m = p.m;
  u.uZenith.value.copy(p.zenith);
  u.uHigh.value.copy(p.high);
  u.uLowSky.value.copy(p.lowSky);
  u.uHorizon.value.copy(p.horizon);
  u.uBelow.value.copy(p.below);
  u.uSunCol.value.copy(p.sunCol);
  u.uDisc.value.copy(p.disc);
  u.uCloudLit.value.copy(p.cloudLit);
  u.uCloudMid.value.copy(p.cloudMid);
  u.uCloudDark.value.copy(p.cloudDark);
  u.uCirrus.value.copy(p.cirrus);
  u.uSunDir.value.copy(SUN_DIR);
  // 太陽の見かけの大きさ。実物は0.5°だが、それでは画面上で豆粒なので誇張する。
  // 霞んだ空ほど大きくぼんやり見せる
  const r = 0.030 + 0.030 * m.close;
  u.uDiscCos.value.set(Math.cos(r * 1.5), Math.cos(r * 0.55));
  u.uThr.value      = 0.76 - 0.46 * m.cover;      // 濃さのしきい値。低いほど雲が多い
  u.uCover.value    = 0.62 + 0.38 * m.cover;      // 雲の不透明度
  u.uLowAmt.value   = 0.70 + 0.30 * m.cover;
  u.uCirrusAmt.value= 0.14 + 0.24 * (1 - m.cover);// 曇りの日は巻雲が見えない
  u.uStars.value    = m.stars;
  u.uGlow.value     = 0.55 + 0.75 * m.day;
  u.uGain.value     = forEnv ? 1.9 : 1.0;
}

/* 空: 内側を向いた大きな球。
   forEnv=true のときは環境マップ(PMREM)を作るための小さな複製。
   gainを上げて「空からの光」として使える明るさにする。                        */
export function buildSky(forEnv){
  const geo = new THREE.SphereGeometry(forEnv ? 100 : SKY_RADIUS, 32, 20);
  const uniforms = {
    uZenith:{value:new THREE.Color()}, uHigh:{value:new THREE.Color()}, uLowSky:{value:new THREE.Color()},
    uHorizon:{value:new THREE.Color()}, uBelow:{value:new THREE.Color()},
    uSunCol:{value:new THREE.Color()}, uDisc:{value:new THREE.Color()},
    uCloudLit:{value:new THREE.Color()}, uCloudMid:{value:new THREE.Color()}, uCloudDark:{value:new THREE.Color()},
    uCirrus:{value:new THREE.Color()},
    uSunDir:{value:new THREE.Vector3()}, uDiscCos:{value:new THREE.Vector2()},
    uGain:{value:1}, uThr:{value:0.5}, uCover:{value:0.8}, uCirrusAmt:{value:0.3},
    uStars:{value:0}, uGlow:{value:1}, uLowAmt:{value:0.8},
    uCloud:{value:ensureCloudTex()},
  };
  setSkyUniforms(uniforms, forEnv);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.userData.forEnv = !!forEnv;
  // 空の色はテーマで決め打ちした値なので、トーンマッピングを通さずそのまま出す
  mesh.material.toneMapped = !forEnv;
  return mesh;
}

/* 空の色をテーマに合わせて差し替える(メッシュは使い回す) */
export function applySkyTheme(sky){
  if(!sky || !sky.material || !sky.material.uniforms) return;
  setSkyUniforms(sky.material.uniforms, !!sky.userData.forEnv);
}

/* ---------------------------------------------------------------------
   遠景の山並み
   --------------------------------------------------------------------- */
/* 距離の違う4枚。実際の地形パッチ(半径3600)の外側を埋めて「世界の終わり」を隠す。
   ・稜線はリッジド多重フラクタル。尖った頂と、なだらかな鞍部が同時に出る
   ・大きなうねりを掛けて「高い連峰の塊」と「低い丘の帯」に分ける(輪に見せない)
   ・遠い層ほど高く・遠く・霞ませる。足元の色は地平線の色(=scene.fogの色)と同じ
   ・尾根と谷の陰影を頂点色に焼き、太陽の方位に向いた斜面を明るくする(切り絵回避) */
const RIDGE_LAYERS = [
  // dist: RIDGE_DISTからの倍率 / peak: 稜線の高さ / haze: 空気遠近(1で完全に霞む)
  // segs/bands: 分割数。遠い層は霞んで細部が見えないので粗くてよい
  // urep: 岩肌テクスチャを一周で何回繰り返すか(層ごとに変えて同じ模様に見せない)
  // ※見かけの高さ(peak/距離)は10〜15度に収めること。これ以上高いと空の雲を
  //   下から食ってしまい、「雲が円く切れる」ように見える。
  { dist:1.00, base:300, peak: 780, haze:0.24, segs:448, bands:10, seed:1, urep: 9 },
  { dist:1.30, base:260, peak:1250, haze:0.45, segs:384, bands: 8, seed:2, urep: 7 },
  { dist:1.62, base:220, peak:1740, haze:0.66, segs:320, bands: 7, seed:3, urep: 6 },
  { dist:1.86, base:180, peak:2200, haze:0.85, segs:256, bands: 5, seed:4, urep: 5 },
];

/* 山肌の細かい起伏。頂点だけでは(一周448分割では)足りないので、
   1枚の手続きテクスチャを画素ごとに掛けて「岩の襞」を出す。
   R=横方向の傾き(陰影) / G=尾根らしさ / B=縦方向の落ち込み(谷の暗がり)      */
let ridgeTex = null, ridgeMat = null;
function ensureRidgeTex(){
  if(ridgeTex) return ridgeTex;
  const S = 512;
  const F = densityField(S, [
    { nx: 5, ny: 5, amp:0.45 }, { nx:10, ny:10, amp:0.27 }, { nx:20, ny:20, amp:0.16 },
    { nx:40, ny:40, amp:0.09 }, { nx:80, ny:80, amp:0.05 },
  ], 137, 0.12, true);   // ridged = 尾根の筋になる
  ridgeTex = makeTexture(S, (px)=>{
    for(let y=0;y<S;y++){
      const ym = ((y-1)+S)%S, yp = (y+1)%S;
      for(let x=0;x<S;x++){
        const i = y*S + x;
        const gx = F[y*S + (x+1)%S] - F[y*S + ((x-1)+S)%S];
        const gy = F[yp*S + x] - F[ym*S + x];
        px[i*4  ] = clamp01(0.5 + gx * 5.5) * 255;
        px[i*4+1] = clamp01(F[i]) * 255;
        px[i*4+2] = clamp01(0.5 + gy * 3.0) * 255;
        px[i*4+3] = 255;
      }
    }
  }, false);
  return ridgeTex;
}

const RIDGE_VERT = `
  attribute vec3 aCol;
  attribute vec2 aDet;        // x=岩肌の見え具合(霞むほど0) / y=太陽側の符号
  varying vec3 vCol; varying vec2 vDet; varying vec2 vUvR;
  void main(){
    vCol = aCol; vDet = aDet; vUvR = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const RIDGE_FRAG = `
  uniform sampler2D uRelief;
  varying vec3 vCol; varying vec2 vDet; varying vec2 vUvR;
  void main(){
    vec3 t = texture2D(uRelief, vUvR).rgb;
    // 横の傾きで陰影(太陽側の符号を掛ける)、縦の落ち込みで谷を暗くする
    float sh = (t.r - 0.5) * 0.95 * vDet.y + (t.b - 0.5) * -0.34 + (t.g - 0.5) * 0.26;
    gl_FragColor = vec4(max(vCol * (1.0 + sh * vDet.x), 0.0), 1.0);
  }`;

// 角度aで必ず2πごとに閉じる周期ノイズ(閉じ目に段差を出さないための約束)
function vnoise1(a, N, seed){
  const x = a * (N / (Math.PI * 2));
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  const h0 = rnd1(((i % N) + N) % N, seed);
  const h1 = rnd1((((i + 1) % N) + N) % N, seed);
  return h0 + (h1 - h0) * u;
}

const RIDGE_OCT = [3, 6, 12, 24, 48, 96];
/* リッジド多重フラクタルの稜線。
   各オクターブで 1-|2n-1| を取ると尖った峰になり、次のオクターブの重みを
   「その場の高さ」で決めると、高い所だけがギザギザに、低い所はなだらかになる。 */
function ridgeProfile(a, seed){
  let sum = 0, amp = 1, w = 1, tot = 0;
  for(let o=0;o<RIDGE_OCT.length;o++){
    let n = vnoise1(a, RIDGE_OCT[o], seed*31 + o*7 + 1);
    n = 1 - Math.abs(n*2 - 1);
    n = n*n*n;                 // 尖らせる。丸いと「うねる丘」に見えて山脈にならない
    sum += n * amp * w;
    tot += amp;
    // 次のオクターブの重み。低い所も 0.35 は残す(0にすると平らな台地になり、
    // 地平線に「定規で引いた直線」が出る)
    w = 0.35 + 0.65 * Math.min(1, n * 1.8);
    amp *= 0.55;
  }
  // 山脈の塊。方角によって高い連峰と低い丘の帯に分かれる(2つ重ねて単調さを消す)
  const env = 0.16 + 0.84 * Math.pow(
    vnoise1(a, 5, seed*17 + 91) * 0.65 + vnoise1(a, 2, seed*17 + 43) * 0.35, 0.75);
  return Math.max(0, (sum / tot) * env * 2.45);
}

/* 稜線から下へ伸びる尾根と谷。高さで位相をずらすと、麓へ向かって扇状に広がる。
   周波数は頂点の分割数(最小256)で表せる範囲に留める(超えると縞に化ける)。 */
function spurField(a, t, seed){
  const s1 = a + t * 0.28, s2 = a - t * 0.46;
  return vnoise1(s1, 22,  seed*13 + 5)  * 0.40
       + vnoise1(s2, 47,  seed*13 + 9)  * 0.29
       + vnoise1(s1, 89,  seed*13 + 17) * 0.19
       + vnoise1(s2, 151, seed*13 + 23) * 0.12;
}

export function buildDistantRidge(){
  const theme = R3.theme;
  const pal = buildPalette();
  const geo = new THREE.BufferGeometry();
  const cRock = new THREE.Color(theme.ridgeRock), cFoot = new THREE.Color(theme.ridgeFoot);
  const cSnow = new THREE.Color(theme.ridgeSnow);
  const tmp = new THREE.Color(), hazeC = new THREE.Color();
  // 太陽の方位(水平成分)。この向きを向いた斜面が明るくなる
  const sunLen = Math.hypot(SUN_DIR.x, SUN_DIR.z) || 1;
  const sunAx = SUN_DIR.x/sunLen, sunAz = SUN_DIR.z/sunLen;

  let total = 0;
  for(const L of RIDGE_LAYERS) total += L.segs * L.bands * 6;
  const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2), det = new Float32Array(total * 2);
  let vi = 0;

  // 奥の層から先に積む。この網は深度を書かない(depthWrite:false)ので、
  // 手前の層をあとに描かないと遠い山が近い山を塗りつぶしてしまう
  const order = RIDGE_LAYERS.map((L,i)=>({L, li:i})).sort((a,b)=> b.L.dist - a.L.dist);
  for(const { L, li } of order){
    const R = RIDGE_DIST * L.dist;
    const dA = (Math.PI * 2) / L.segs;
    // 遠い層ほど高い山なので、雪の乗り始めを下げる
    const snowLine = Math.max(0.10, theme.snowLine - li * 0.06);
    // 暗い空(夕方・夜)は直射より空明かりのほうが強い。その日は霞を厚めにして
    // 層どうしの前後を読ませる(暗い岩+暗い空だと全部つぶれて影絵に戻ってしまう)
    const hz0 = Math.min(0.94, L.haze + (1 - pal.m.day) * 0.14);

    const push = (a, t, h, ui)=>{
      const y = -L.base + (h + L.base) * t;
      pos[vi*3] = Math.cos(a) * R; pos[vi*3+1] = y; pos[vi*3+2] = Math.sin(a) * R;

      const hNorm = Math.min(1.2, h / L.peak);
      const sp = spurField(a, t, L.seed);
      // 尾根の傾き(方位方向の微分)。太陽の方を向く斜面が明るい
      const grad = (spurField(a + dA, t, L.seed) - spurField(a - dA, t, L.seed)) / (2 * dA);
      const tanDot = -Math.sin(a) * sunAx + Math.cos(a) * sunAz;   // 接線方向の太陽成分
      const faceDot = -Math.cos(a) * sunAx - Math.sin(a) * sunAz;  // 正面(内向き)の太陽成分

      tmp.copy(cFoot).lerp(cRock, Math.min(1, t * 1.35 + 0.05));
      // 雪。高い山の上のほうに、尾根筋へ寄せて乗せる
      const snowT = Math.min(1, Math.max(0, (hNorm - snowLine) * 3.0)) *
                    Math.min(1, Math.max(0, (t - 0.58) / 0.32)) * (0.30 + 0.70 * sp);
      if(snowT > 0) tmp.lerp(cSnow, Math.min(1, snowT));
      // 陰影: ①方位による全体の明暗 ②尾根/谷の凹凸 ③谷底の落ち込み ④上ほど明るい
      let sh = 0.88 + 0.26 * faceDot;
      sh += grad * tanDot * 0.070;
      sh *= 0.84 + 0.30 * sp;
      sh *= 0.90 + 0.22 * t;
      // 遠景の山は「空全体」に照らされている。日陰の面でも真っ黒にはならない
      tmp.multiplyScalar(Math.max(0.48, sh));
      // 陽の当たる斜面はその空の光の色を拾う(決め打ちの色は使わない)
      if(sh > 1) tmp.lerp(pal.sunCol, Math.min(0.30, (sh - 1) * 0.55));

      // 空気遠近。麓ほど強く霞み、その霞の色は「そこに見える空の色」そのもの
      const sinEl = (y - CAM_H_REF) / Math.hypot(R, y - CAM_H_REF);
      skyGradJS(pal, sinEl, hazeC);
      // 麓ほど強く霞ませる = 谷に霧が溜まった見え方。層どうしの前後が読めるようになる
      const aer = Math.min(0.985, hz0 + Math.pow(1 - t, 1.4) * 0.44 * (1 - hz0));
      tmp.lerp(hazeC, aer);
      col[vi*3] = tmp.r; col[vi*3+1] = tmp.g; col[vi*3+2] = tmp.b;

      // 岩肌テクスチャ。霞んだぶんだけ薄れる(遠い山ほどのっぺりして正しい)
      // 岩肌のUV。Vを方角ごとにゆっくりずらすと、Uの繰り返しが目立たなくなる
      uvs[vi*2] = ui * (L.urep / L.segs);
      uvs[vi*2+1] = t * 0.72 + li * 0.19 + vnoise1(a, 5, L.seed*7 + 61) * 0.55;
      det[vi*2] = (1 - aer) * 0.85;
      det[vi*2+1] = Math.max(-1, Math.min(1, tanDot * 1.3));
      vi++;
    };

    for(let i=0;i<L.segs;i++){
      const a0 = i * dA, a1 = (i + 1) * dA;
      const h0 = L.peak * ridgeProfile(a0, L.seed);
      const h1 = L.peak * ridgeProfile(a1, L.seed);
      for(let b=0;b<L.bands;b++){
        // 上のバンドほど細かく刻む(稜線ぎわの陰影を出すため)
        const t0 = Math.pow(b / L.bands, 0.85), t1 = Math.pow((b + 1) / L.bands, 0.85);
        push(a0,t0,h0,i); push(a1,t0,h1,i+1); push(a1,t1,h1,i+1);
        push(a0,t0,h0,i); push(a1,t1,h1,i+1); push(a0,t1,h0,i);
      }
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aCol',     new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aDet',     new THREE.BufferAttribute(det, 2));
  // 材質は使い回す。real3d.js はマップ替えでジオメトリだけを捨てるため、
  // 毎回作ると材質(=シェーダー)が積み上がる
  if(!ridgeMat){
    ridgeMat = new THREE.ShaderMaterial({
      fog:false, depthWrite:false,
      uniforms:{ uRelief:{ value: ensureRidgeTex() } },
      vertexShader: RIDGE_VERT, fragmentShader: RIDGE_FRAG,
    });
    // 遠景の山も色を頂点に焼き込んであるので、空と同じくトーンマッピングを通さない
    ridgeMat.toneMapped = false;
  }
  const mesh = new THREE.Mesh(geo, ridgeMat);
  mesh.frustumCulled = false;
  return mesh;
}

/* 環境マップ(=HDRIの代わり)。そのマップの空をPMREMに通し、地面が空の色で
   ほんのり照らされるようにする。画像ファイルは増えない。テーマを変えたら作り直す。
   前の環境マップは呼び出し側が dispose する(戻り値を持ち回る)。            */
export function buildEnvironment(renderer, prevRT){
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const s = buildSky(true);
  envScene.add(s);
  const next = pmrem.fromScene(envScene, 0, 1, 500);
  if(prevRT) prevRT.dispose();       // 前のマップぶんを捨てる(貯めるとGPUメモリを食う)
  pmrem.dispose();
  s.geometry.dispose();
  s.material.dispose();
  return next;
}
