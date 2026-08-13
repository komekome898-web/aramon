/* =====================================================================
   リアルマップ: 安全圏の輪と、技の地面円を3Dで描く

   【なぜ3Dで描き直すのか】
     安置線と技の地面円は2Dキャンバス(#gameCanvas)が3D(#glCanvas)の上に
     重ねて描いていたため、深度判定を受けていなかった。結果、
       ・大きな岩や山の向こうにある安置線・技エフェクトが透けて見える
       ・低い位置から丘の向こうの安置線を見ると、手前にあるように錯覚する
     という不具合が出ていた。地面に貼る輪と円を3D側へ移せば、地形・岩・木の
     深度で自然に隠れる。

   【2D版と同じ見た目を保つための決め事】
     ・色・太さ(px)・破線の間隔(px)・塗りの濃さは render.js の
       drawZoneRings / drawOneZoneRing / drawRaidTelegraph から**そのまま写した**。
       下の RING_STYLES / MARK_STYLES がその写し。**片方だけ変えないこと。**
     ・線の太さと破線の間隔は「画面上のpx」で決まる(2Dキャンバスと同じ)。
       ワールド単位の太さにすると、遠くで消え近くで帯になり別物に見える。
       → 帯の幅は頂点シェーダーで「距離 ÷ 焦点距離」から作る。
       → 破線は fwidth(1画素あたりのワールド長)で割って画面上の間隔にする。
     ・色は2Dキャンバスの見え方(sRGBそのまま)に合わせるため、トーンマッピングも
       リニア変換も通さない(toneMapped=false・生の値を書く)。空(real3d_sky.js)と
       同じ考え方。

   【地面への貼り付け方】
     ・輪は「点を1つずつ地形に沿わせた帯」。高さは real3d_common.js の heightAt()、
       傾きは window.real3dHeightGrad()(あれば)。帯の外側の頂点は傾きぶん上下させる
       ので、坂の上でも帯が地面へめり込まない。
     ・Zファイティングは real3d_water.js と同じ polygonOffset(-2,-2)+わずかな持ち上げで避ける。
       持ち上げを大きくすると足元で線が浮いて見えるので RING_LIFT は小さく保つ。

   【毎フレーム頂点を作り直さない】
     安置の輪は常に画面にある。ジオメトリは容量固定で1つずつ持ち回し、
     「輪が動いた/縮んだ/カメラが十分動いた」ときだけ頂点を書き換える(real3d_terrain.js と同じ考え方)。

   【カメラの背後】
     2D版は投影できない点をnullで残して線を切っていたが、3Dでは投影の破綻自体が起きない
     (背後の三角形はニアプレーンでクリップされる)。そのうえで、フォグで完全に霞む
     3200より外(VIEW_RANGE)は輪を作らず、手前で透明へ落として切れ目を隠す。
   ===================================================================== */
import * as THREE from './vendor/three.module.min.js';
import { heightAt } from './real3d_common.js';

/* ---- 見た目の写し(render.js と同じ値。**必ず対で直すこと**) ----
   css/width/dash/glow は render.js の drawZoneRings / drawRaidTelegraph の引数そのもの。 */
const RING_STYLES = {
  // drawOneZoneRing(zoneState.center, radius, 'rgba(244,196,48,0.85)', 4, [20,16], {blur:16,color:'rgba(244,196,48,0.6)'})
  zone:      { css:'rgba(244,196,48,0.85)', width:4, dash:[20,16], glow:{ blur:16, alpha:0.6 } },
  // 予測の輪。雪山だけ青系(白い点線が雪面と同化するため)
  next:      { css:'rgba(255,255,255,0.32)', width:2, dash:[6,9], glow:null },
  nextSnow:  { css:'rgba(80,150,255,0.8)',   width:2, dash:[6,9], glow:null },
  // strokeProjectedRing(arc, col, 4, [12,9], {blur:14, color:col}) / inner は 2, [7,7], glowなし
  mark:      { css:'#ffffff', width:4, dash:[12,9], glow:{ blur:14, alpha:1.0 } },
  markInner: { css:'#ffffff', width:2, dash:[7,7],  glow:null },
};
/* 2Dの塗り。drawRaidTelegraph は fillAlpha = blink*(soon?0.42:0.24) で塗っていた。
   呼び出し側が mark.fillAlpha を渡さなかったときの既定値(0.24と0.42の間)。 */
const MARK_FILL_RATIO = 0.28;

// ---- 調整用の定数 ----
const VIEW_RANGE  = 3400;  // これより遠い輪は作らない(フォグが完全に霞ませる3200の少し外)
const FADE_NEAR   = 2500;  // ここから透明にしはじめ
const FADE_FAR    = 3300;  // ここで完全に消える(=作らない範囲の切れ目を隠す)
const RING_STEP   = 45;    // 輪の分割間隔(ワールド単位)。地形メッシュの頂点間隔50より細かく
const RING_MAX    = 220;   // 輪1本ぶんの最大サンプル数(容量)
const RING_MIN    = 24;
const RING_LIFT   = 1.5;   // 地面からの持ち上げ。大きくすると足元で線が浮いて見える
const FILL_LIFT   = 1.0;
const MOVE_EPS    = 32;    // カメラがこれだけ動いたらサンプリング範囲を取り直す
const SHAPE_EPS   = 1.5;   // 輪の中心・半径がこれだけ変わったら作り直す(縮小中は毎フレーム相当)
const MIN_FORE    = 0.18;  // 帯を真横から見たときの太さ補正の上限(1/0.18 ≒ 5.5倍まで)
/* 帯の半幅の上限を「カメラからの距離の何倍まで」で決める。絶対値(例:90単位)で
   止めると、遠くの輪だけ画面上で細くなって2D版と見た目が変わってしまう。
   補正なしの半幅は距離の0.06倍程度なので、この上限は真横から見たときだけ効く。 */
const MAX_HALF_R  = 0.25;
const MARK_SLOTS  = 8;     // 同時に出せる技の地面円の数(レイドの予告は多くて数個)
const FILL_RINGS  = 5, FILL_SEGS = 40;   // 塗りの分割(地形に沿わせるので粗いと浮く)

/* ---- シェーダー ----
   帯(輪)は1本の折れ線を頂点シェーダーで左右へ広げて作る。広げる向き aNrm は
   地面(XZ)の中で線と直交する向きなので、帯は地面に寝たまま = 丘に正しく隠れる。 */
const RIBBON_VERT = `
  attribute float aSide;   // -1 / +1 (帯の内外)
  attribute vec2  aNrm;    // 広げる向き(地面のXZ平面。線と直交)
  attribute float aU;      // 線に沿った長さ(ワールド単位。破線の位相に使う)
  attribute float aSlope;  // aNrm方向の地面の傾き(dh/d距離)
  uniform float uFocalPx, uHalfPx, uLift, uFadeNear, uFadeFar;
  varying float vSide, vU, vFade;
  void main(){
    vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 toCam = cameraPosition - wp;
    float d = max(length(toCam), 1.0);
    vec3 vdir = toCam / d;
    vec3 n = vec3(aNrm.x, 0.0, aNrm.y);
    /* 画面上で一定の太さにする。地面に寝た帯を浅い角度で見ると縮んで細くなるので、
       視線と広げる向きのなす角ぶん(fore)だけ広げ直す(2Dの一定太さに合わせるため)。 */
    float c = dot(n, vdir);
    float fore = sqrt(max(1.0 - c*c, 0.0));
    float halfW = min(uHalfPx * d / uFocalPx / max(fore, ${MIN_FORE.toFixed(3)}), d * ${MAX_HALF_R.toFixed(3)});
    vec3 p = wp + n * (aSide * halfW);
    // 傾きぶん上下させて、坂でも帯が地面と平行に乗るようにする
    p.y += uLift + aSlope * aSide * halfW;
    vSide = aSide;
    vU = aU;
    vFade = 1.0 - smoothstep(uFadeNear, uFadeFar, d);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const RIBBON_FRAG = `
  uniform vec3 uColor;
  uniform float uAlpha, uCorePx, uHalfPx, uGlowA, uGlowPx, uDashLen, uDuty;
  varying float vSide, vU, vFade;
  void main(){
    float a = abs(vSide) * uHalfPx;              // 線の中心からの距離(画面px)
    float core = 1.0 - smoothstep(uCorePx*0.5 - 0.75, uCorePx*0.5 + 0.75, a);
    // 2Dの shadowBlur 相当のほのかな光。3Dでは同じ画素の中で作るので追加の描画コストは無い
    float halo = uGlowA * exp(-max(a - uCorePx*0.5, 0.0) / max(uGlowPx, 0.001))
               * (1.0 - smoothstep(uHalfPx*0.55, uHalfPx, a));
    float dash = 1.0;
    if(uDashLen > 0.0){
      // fwidth(vU) = 1画素あたりのワールド長。これで割ると破線の間隔が画面上で一定になる
      float w = max(fwidth(vU), 1e-5);
      float t = fract(vU / (uDashLen * w));
      float e = 1.5 / uDashLen;                  // 境界を1.5画素ぶんぼかす
      float inside = uDuty*0.5 - abs(t - uDuty*0.5);
      dash = smoothstep(-e, e, inside);
    }
    float al = clamp(core*uAlpha + halo*uAlpha, 0.0, 1.0) * dash * vFade;
    if(al < 0.004) discard;
    gl_FragColor = vec4(uColor, al);
  }`;
const FILL_VERT = `
  uniform float uFadeNear, uFadeFar;
  varying float vFade;
  void main(){
    vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
    float d = max(length(cameraPosition - wp), 1.0);
    vFade = 1.0 - smoothstep(uFadeNear, uFadeFar, d);
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;
const FILL_FRAG = `
  uniform vec3 uColor; uniform float uAlpha;
  varying float vFade;
  void main(){
    float al = uAlpha * vFade;
    if(al < 0.004) discard;
    gl_FragColor = vec4(uColor, al);
  }`;

/* 画面の大きさから決まる値は全マテリアルで共有する(同じ {value:} を参照させるので、
   1か所書き換えれば全部に効く。毎フレームのuniform更新を1回で済ませるため)。 */
const uShared = {
  uFocalPx:  { value: 900 },
  uFadeNear: { value: FADE_NEAR },
  uFadeFar:  { value: FADE_FAR },
};

/* 色は2Dキャンバスと同じ見え方にしたいので、THREE.Color(sRGB→リニア変換が入る)を
   通さず生の0〜1で持つ。'#rgb' / '#rrggbb' / 'rgb()' / 'rgba()' を読む。 */
const colorCache = new Map();
function parseColor(css){
  if(!css) css = '#ffffff';
  let c = colorCache.get(css);
  if(c) return c;
  c = { rgb: new THREE.Vector3(1,1,1), a: 1 };
  const s = String(css).trim();
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if(m){
    const v = m[1].split(',').map(t=>parseFloat(t));
    c.rgb.set((v[0]||0)/255, (v[1]||0)/255, (v[2]||0)/255);
    c.a = v.length > 3 && isFinite(v[3]) ? v[3] : 1;
  } else {
    let hex = s.replace('#','');
    if(hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    const n = parseInt(hex, 16);
    if(isFinite(n) && hex.length === 6) c.rgb.set(((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255);
  }
  colorCache.set(css, c);
  return c;
}

// 画面px系の値を持つ帯のマテリアル一覧(画素比が変わったらまとめて入れ直す)
const ribbonMats = [];
function ribbonMaterial(style){
  const col = parseColor(style.css);
  const glowPx = style.glow ? style.glow.blur * 0.45 : 0;
  const half = style.width*0.5 + (style.glow ? style.glow.blur : 1.5);
  const period = style.dash ? (style.dash[0] + style.dash[1]) : 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, uShared, {
      uColor:  { value: col.rgb.clone() },
      uAlpha:  { value: col.a },
      uCorePx: { value: style.width },
      uHalfPx: { value: half },
      uGlowA:  { value: style.glow ? style.glow.alpha : 0 },
      uGlowPx: { value: glowPx },
      uDashLen:{ value: period },
      uDuty:   { value: period ? style.dash[0]/period : 1 },
      uLift:   { value: RING_LIFT },
    }),
    vertexShader: RIBBON_VERT,
    fragmentShader: RIBBON_FRAG,
    transparent: true,
    // 深度は「読む」が「書かない」。丘や岩には隠れるが、輪同士・水面とは取り合わない
    depthTest: true, depthWrite: false,
    // 地面のすぐ上に乗るので、深度の取り合い(ちらつき)を避ける(real3d_water.js と同じ)
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });
  mat.toneMapped = false;              // 2Dキャンバスと同じ色で出す
  mat.extensions = { derivatives: true };  // fwidth(破線)。WebGL1へ落ちたときのため
  // 画面px系の値は「CSS px × 端末の画素比」で持つ。実際の代入は applyPixelScale()
  mat.userData.px = { core: style.width, half, dash: period, glow: glowPx };
  ribbonMats.push(mat);
  return mat;
}

function fillMaterial(){
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, uShared, {
      uColor: { value: new THREE.Vector3(1,1,1) },
      uAlpha: { value: 0 },
    }),
    vertexShader: FILL_VERT,
    fragmentShader: FILL_FRAG,
    transparent: true,
    depthTest: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });
  mat.toneMapped = false;
  return mat;
}

/* =====================================================================
   帯(輪): 容量固定のジオメトリを1つ持ち回し、頂点だけ書き換える
   ===================================================================== */
function makeRibbon(cap, style){
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(cap*2*3);
  const side = new Float32Array(cap*2);
  const nrm = new Float32Array(cap*2*2);
  const uu  = new Float32Array(cap*2);
  const slp = new Float32Array(cap*2);
  for(let i=0;i<cap;i++){ side[i*2] = -1; side[i*2+1] = 1; }
  const idx = new Uint16Array((cap-1)*6);
  for(let i=0;i<cap-1;i++){
    const a = i*2, o = i*6;
    idx[o]=a; idx[o+1]=a+1; idx[o+2]=a+3;
    idx[o+3]=a; idx[o+4]=a+3; idx[o+5]=a+2;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSide',    new THREE.BufferAttribute(side, 1));
  geo.setAttribute('aNrm',     new THREE.BufferAttribute(nrm, 2));
  geo.setAttribute('aU',       new THREE.BufferAttribute(uu, 1));
  geo.setAttribute('aSlope',   new THREE.BufferAttribute(slp, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.setDrawRange(0, 0);
  // 中身が毎回書き換わるので境界球は計算しない(フラスタムカリングも切る)
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const mesh = new THREE.Mesh(geo, ribbonMaterial(style));
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;      // 地形・水面(透明)より後ろに描く
  mesh.visible = false;
  return { geo, mesh, cap, pos, nrm, uu, slp, key:'', camX:1e9, camY:1e9 };
}

// 折れ線(xs,ys の先頭n点)を帯にする。closed=true のときは末尾に先頭と同じ点が入っている前提
function setRibbonPath(rb, xs, ys, n, closed){
  if(n < 2){ rb.geo.setDrawRange(0,0); rb.mesh.visible = false; return; }
  if(n > rb.cap) n = rb.cap;
  const grad = window.real3dHeightGrad;
  let acc = 0;
  for(let i=0;i<n;i++){
    const x = xs[i], y = ys[i];
    // 接線は前後の点から求める(閉じた輪は端でも巻き戻して連続にする)
    const ia = i>0 ? i-1 : (closed ? n-2 : 0);
    const ib = i<n-1 ? i+1 : (closed ? 1 : n-1);
    let tx = xs[ib]-xs[ia], ty = ys[ib]-ys[ia];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const nx = ty, ny = -tx;              // 地面の中で線と直交する向き
    let h, sl = 0;
    if(typeof grad === 'function'){
      const g = grad(x, y);               // 高さと傾きを1回で(戻り値は使い回しなので即読む)
      h = g.h; sl = g.gx*nx + g.gy*ny;
    } else h = heightAt(x, y);
    if(i > 0) acc += Math.hypot(x-xs[i-1], y-ys[i-1]);
    for(let s=0;s<2;s++){
      const k = i*2+s;
      rb.pos[k*3] = x; rb.pos[k*3+1] = h; rb.pos[k*3+2] = y;
      rb.nrm[k*2] = nx; rb.nrm[k*2+1] = ny;
      rb.uu[k] = acc; rb.slp[k] = sl;
    }
  }
  const at = rb.geo.attributes;
  at.position.needsUpdate = true; at.aNrm.needsUpdate = true;
  at.aU.needsUpdate = true; at.aSlope.needsUpdate = true;
  rb.geo.setDrawRange(0, (n-1)*6);
  rb.mesh.visible = true;
}

/* =====================================================================
   塗り(技の地面円の内側): 地形に沿った円盤/扇
   ===================================================================== */
function makeFill(){
  const V = (FILL_RINGS+1)*(FILL_SEGS+1);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(V*3);
  const idx = new Uint16Array(FILL_RINGS*FILL_SEGS*6);
  const stride = FILL_SEGS+1;
  let o = 0;
  for(let r=0;r<FILL_RINGS;r++) for(let c=0;c<FILL_SEGS;c++){
    const a = r*stride+c, b = a+1, d = a+stride, e = d+1;
    idx[o++]=a; idx[o++]=b; idx[o++]=e;
    idx[o++]=a; idx[o++]=e; idx[o++]=d;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const mesh = new THREE.Mesh(geo, fillMaterial());
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;      // 輪より先(下)に塗る
  mesh.visible = false;
  return { geo, mesh, pos };
}
// from/to は絶対角(rad)。null なら全周
function setFillDisc(fl, cx, cy, radius, from, to){
  const a0 = (from == null) ? 0 : from;
  const span = (from == null) ? Math.PI*2 : (to - from);
  const stride = FILL_SEGS+1;
  for(let r=0;r<=FILL_RINGS;r++){
    const t = r/FILL_RINGS;
    for(let c=0;c<=FILL_SEGS;c++){
      const a = a0 + span*(c/FILL_SEGS);
      const x = cx + Math.cos(a)*radius*t, y = cy + Math.sin(a)*radius*t;
      const k = (r*stride+c)*3;
      fl.pos[k] = x; fl.pos[k+1] = heightAt(x, y) + FILL_LIFT; fl.pos[k+2] = y;
    }
  }
  fl.geo.attributes.position.needsUpdate = true;
  fl.mesh.visible = true;
}

/* =====================================================================
   安全圏の輪
   ===================================================================== */
// サンプリングに使う作業用の配列(毎フレームの確保をしないため使い回す)
const sx = new Float64Array(RING_MAX), sy = new Float64Array(RING_MAX);

/* 輪のうち「カメラから VIEW_RANGE 以内」の角度範囲だけを作る。
   半径が数千あっても、実際に見える範囲だけを細かく分割できる(2D版が
   ±30度だけ高解像度で描いていたのと同じ考え方を、距離で厳密にやる)。 */
function updateRing(rb, cx, cy, radius, cam, force){
  if(!(radius > 0)){ rb.mesh.visible = false; rb.key = ''; return; }
  const dx = cam.x - cx, dy = cam.y - cy;
  const d = Math.hypot(dx, dy);
  let half;
  if(d < 1e-3){
    half = (radius <= VIEW_RANGE) ? Math.PI : -1;    // カメラが中心。全周が等距離
  } else {
    const k = (d*d + radius*radius - VIEW_RANGE*VIEW_RANGE) / (2*d*radius);
    half = (k >= 1) ? -1 : (k <= -1 ? Math.PI : Math.acos(k));
  }
  if(half < 0){ rb.mesh.visible = false; rb.key = ''; return; }   // 全部フォグの外
  // 形が変わっていない & カメラもさほど動いていないなら、前の頂点をそのまま使う
  const key = Math.round(cx/SHAPE_EPS)+'/'+Math.round(cy/SHAPE_EPS)+'/'+Math.round(radius/SHAPE_EPS);
  const moved = Math.abs(cam.x-rb.camX) > MOVE_EPS || Math.abs(cam.y-rb.camY) > MOVE_EPS;
  if(!force && !moved && key === rb.key && rb.mesh.visible) return;
  rb.key = key; rb.camX = cam.x; rb.camY = cam.y;
  const closed = half >= Math.PI - 1e-6;
  const a0 = (d < 1e-3) ? 0 : Math.atan2(dy, dx);   // カメラに一番近い境界点の方角
  const arc = 2*half*radius;
  let n = Math.round(arc/RING_STEP) + 1;
  if(n < RING_MIN) n = RING_MIN;
  if(n > rb.cap) n = rb.cap;
  for(let i=0;i<n;i++){
    const a = a0 - half + (i/(n-1))*half*2;
    sx[i] = cx + Math.cos(a)*radius;
    sy[i] = cy + Math.sin(a)*radius;
  }
  if(closed){ sx[n-1] = sx[0]; sy[n-1] = sy[0]; }
  setRibbonPath(rb, sx, sy, n, closed);
}

/* =====================================================================
   入れ物
   ===================================================================== */
let group = null;
let ringMain = null, ringNext = null, nextSnow = false;
const marks = [];      // { fill, ring, inner, key }

function ensureBuilt(){
  if(group) return;
  group = new THREE.Group();
  group.name = 'aramonZoneLayer';
  ringMain = makeRibbon(RING_MAX, RING_STYLES.zone);
  ringNext = makeRibbon(RING_MAX, RING_STYLES.next);
  group.add(ringMain.mesh, ringNext.mesh);
  for(let i=0;i<MARK_SLOTS;i++){
    const m = {
      fill:  makeFill(),
      ring:  makeRibbon(64, RING_STYLES.mark),        // 円 or 扇の輪郭
      inner: makeRibbon(40, RING_STYLES.markInner),   // 中心の小さい輪
      key: '',
    };
    group.add(m.fill.mesh, m.ring.mesh, m.inner.mesh);
    marks.push(m);
  }
}

// 予測の輪の色を差し替える(雪山だけ青系。マップ切り替えのときだけ走る)
function applyNextColor(snow){
  if(nextSnow === snow && ringNext.mesh.material.userData.inited) return;
  nextSnow = snow;
  const st = snow ? RING_STYLES.nextSnow : RING_STYLES.next;
  const c = parseColor(st.css);
  const u = ringNext.mesh.material.uniforms;
  u.uColor.value.copy(c.rgb);
  u.uAlpha.value = c.a;
  ringNext.mesh.material.userData.inited = true;
}

/* 画面px系の値(太さ・破線・焦点距離)を端末の画素比に合わせる。
   fwidth も帯の幅も「実際の画素」で効くので、CSS px の値をそのまま入れると
   Retina(画素比2)で半分の太さに見えてしまう。
   ※ 画素比の式は real3d.js の applySize()(renderer.setPixelRatio に渡す値)と同じ。 */
let lastPx = 0, lastFov = 0, lastH = 0;
function applyPixelScale(){
  const px = window.__aramonRenderScale || Math.min(window.devicePixelRatio || 1, 2);
  const fov = (window.__aramonLook && window.__aramonLook.fovDeg) || 64;
  const h = window.viewH || 720;
  if(px === lastPx && fov === lastFov && h === lastH) return;
  lastPx = px; lastFov = fov; lastH = h;
  // 焦点距離(画素) = (画面の高さ/2) / tan(縦画角/2)。2Dの project() と同じ考え方
  uShared.uFocalPx.value = (h*px*0.5) / Math.tan(fov*Math.PI/180*0.5);
  for(const m of ribbonMats){
    const p = m.userData.px;
    m.uniforms.uCorePx.value = p.core*px;
    m.uniforms.uHalfPx.value = p.half*px;
    m.uniforms.uGlowPx.value = p.glow*px;
    m.uniforms.uDashLen.value = p.dash*px;
  }
}

/* =====================================================================
   公開API
   ===================================================================== */

// シーンに1度だけ足す入れ物を作る(2回呼んでも重複しない)
export function buildZoneLayer(scene){
  ensureBuilt();
  if(scene && group.parent !== scene){
    if(group.parent) group.parent.remove(group);
    scene.add(group);
  }
  return group;
}

/* 毎フレーム。
   zone  = { center:{x,y}, radius, toCenter:{x,y}, toRadius, shrinking, hasNext, snow } または null
           (null のときは安置なし = 射撃訓練場・リアルマップ以外)
   marks = 技の地面円の配列 [{ x, y, r, color, alpha, arc:{from,to}|null, inner, fillAlpha? }, ...]
           arc は絶対角(rad, Math.atan2と同じ向き)。fillAlpha 省略時は alpha*0.28。
   camPos= window.camPos({x,y,z}) と同じもの。省略時は window.camPos を見る。       */
export function updateZoneLayer(zone, markList, camPos){
  if(!group) return;
  const cam = camPos || window.camPos;
  if(!cam){ hideAll(); return; }
  applyPixelScale();

  // ---- 安全圏 ----
  if(zone && zone.center){
    applyNextColor(!!zone.snow);
    updateRing(ringMain, zone.center.x, zone.center.y, zone.radius, cam, false);
    // 縮小中だけでなく安定中も、次の縮小先(予測)を出す(2D版と同じ条件)
    if((zone.shrinking || zone.hasNext) && zone.toCenter && zone.toRadius > 0){
      updateRing(ringNext, zone.toCenter.x, zone.toCenter.y, zone.toRadius, cam, false);
    } else { ringNext.mesh.visible = false; ringNext.key = ''; }
  } else {
    ringMain.mesh.visible = false; ringMain.key = '';
    ringNext.mesh.visible = false; ringNext.key = '';
  }

  // ---- 技の地面円 ----
  const list = markList || [];
  for(let i=0;i<marks.length;i++){
    const slot = marks[i];
    const m = i < list.length ? list[i] : null;
    if(!m || !(m.r > 0)){
      slot.fill.mesh.visible = false;
      slot.ring.mesh.visible = false;
      slot.inner.mesh.visible = false;
      slot.key = '';
      continue;
    }
    const arc = m.arc || null;
    const key = [Math.round(m.x), Math.round(m.y), Math.round(m.r),
                 arc ? Math.round(arc.from*100) : 'c', arc ? Math.round(arc.to*100) : 'c',
                 m.inner ? 1 : 0].join(',');
    if(key !== slot.key){
      slot.key = key;
      buildMark(slot, m, arc);
    }
    // 色と濃さは毎フレーム変わる(点滅)。uniformの書き換えだけで済む
    const col = parseColor(m.color || '#ff5d5d');
    const alpha = (m.alpha == null ? 1 : m.alpha) * col.a;
    const fu = slot.fill.mesh.material.uniforms;
    fu.uColor.value.copy(col.rgb);
    fu.uAlpha.value = (m.fillAlpha == null) ? alpha*MARK_FILL_RATIO : m.fillAlpha;
    for(const rb of [slot.ring, slot.inner]){
      const u = rb.mesh.material.uniforms;
      u.uColor.value.copy(col.rgb);
      u.uAlpha.value = alpha;
    }
  }
}

/* 円 or 扇の形を作る。
   ・円 : 輪郭の輪 + 塗り + (inner なら)中心の小さい輪
   ・扇 : 中心→弧→中心 をひと続きの折れ線として1本の帯で描く
          (2D版は弧を[12,9]・両側の線を[10,8]で描き分けていたが、
           見た目の差が出ないのでひと続きにしてある)                     */
function buildMark(slot, m, arc){
  const from = arc ? arc.from : 0;
  let to = arc ? arc.to : Math.PI*2;
  if(arc && to < from) to += Math.PI*2;
  const span = to - from;
  // 輪郭
  const outCap = slot.ring.cap;
  let segs = Math.round(Math.abs(span)*m.r/RING_STEP);
  segs = Math.max(12, Math.min(segs, outCap - 5));
  let n = 0;
  if(arc){
    sx[n] = m.x; sy[n] = m.y; n++;                      // 中心
    for(let i=0;i<=segs;i++){
      const a = from + span*(i/segs);
      sx[n] = m.x + Math.cos(a)*m.r; sy[n] = m.y + Math.sin(a)*m.r; n++;
    }
    sx[n] = m.x; sy[n] = m.y; n++;                      // 中心へ戻る(=閉じる)
    setRibbonPath(slot.ring, sx, sy, n, true);
  } else {
    for(let i=0;i<=segs;i++){
      const a = (i/segs)*Math.PI*2;
      sx[n] = m.x + Math.cos(a)*m.r; sy[n] = m.y + Math.sin(a)*m.r; n++;
    }
    sx[n-1] = sx[0]; sy[n-1] = sy[0];
    setRibbonPath(slot.ring, sx, sy, n, true);
  }
  // 塗り
  setFillDisc(slot.fill, m.x, m.y, m.r, arc ? from : null, arc ? to : null);
  // 中心の小さい輪(2D版と同じ 0.35 倍)
  if(m.inner){
    const ir = m.r*0.35;
    let isegs = Math.round(Math.PI*2*ir/RING_STEP);
    isegs = Math.max(12, Math.min(isegs, slot.inner.cap - 2));
    let k = 0;
    for(let i=0;i<=isegs;i++){
      const a = (i/isegs)*Math.PI*2;
      sx[k] = m.x + Math.cos(a)*ir; sy[k] = m.y + Math.sin(a)*ir; k++;
    }
    sx[k-1] = sx[0]; sy[k-1] = sy[0];
    setRibbonPath(slot.inner, sx, sy, k, true);
  } else {
    slot.inner.mesh.visible = false;
  }
}

function hideAll(){
  if(!group) return;
  ringMain.mesh.visible = false; ringMain.key = '';
  ringNext.mesh.visible = false; ringNext.key = '';
  for(const s of marks){
    s.fill.mesh.visible = false;
    s.ring.mesh.visible = false;
    s.inner.mesh.visible = false;
    s.key = '';
  }
}

/* マップ切り替え時に作り直す。
   形は毎フレーム地形から作り直すので、ここでは「前の地形で作った頂点」を無効にして
   全部隠すだけでよい(ジオメトリの容量はマップに依らないので捨てない)。 */
export function resetZoneLayer(){
  hideAll();
  nextSnow = false;
  if(ringNext) ringNext.mesh.material.userData.inited = false;
  lastPx = 0;   // 次の update で焦点距離と太さを入れ直す
}
