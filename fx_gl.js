/* =====================================================================
   技エフェクトのWebGL層(Three.js)
   ---------------------------------------------------------------------
   何をするファイルか:
     技の「粒・軌跡・地面の輪・グロー」をGPUで描く。2Dキャンバスに描いている
     技の芯(炎の柱・ビームの筒・爆風ドーム)は**そのまま残す**。この層はその上に
     加算で乗るだけなので、WebGLが使えない端末でも技が消えない。

   なぜ別キャンバスか:
     ・real3d.js のWebGL(#glCanvas)は**リアルマップでしか動かない**。技は全マップに
       出るので、地形とは別のキャンバス(#fxCanvas)を2Dの上に重ねる。
     ・#fxCanvas は premultipliedAlpha:true で「色>0 / アルファ=0」を出す。
       ブラウザの通常合成が dst = src + dst*(1-0) になる = **ページ側でも加算合成**。
       mix-blend-mode を使わずに済むので、iOSの回転(#appRootの90度)と喧嘩しない。

   カメラ:
     real3d.js とまったく同じ規約。ワールド(x,y,z) → Three(x, z, y)。
     視野角は world.js の FOV_V を毎フレーム読む(設定で変えられるため)。
     **ここを2Dの project() と合わせておかないと、粒だけが技の芯からずれる。**

   使い方(render.js から):
     FxGl.begin()                     … フレームの最初
     FxGl.emit({...}) / burst / trail … 技ごとの発注(combat.js/render.jsから)
     FxGl.render()                    … 2Dの描画が終わったあとに1回

   決まりごと:
     ・**色は決め打ちしない。** 呼び出し側が技の色(auraTint込み)を渡す。
     ・**粒はGPUで動かす。** CPUは発生時に1回書き込むだけ(iPhoneでのCPU負荷を避ける)。
     ・**負荷で見た目を削らない**(発注者方針)。減らすのは解像度と粒の上限だけ。
===================================================================== */
import * as THREE from './vendor/three.module.min.js';


/* 加算合成の指定。
   【重要】THREE.AdditiveBlending は src*srcAlpha + dst なので、
   このファイルのように**アルファ0で色だけ出す**作りでは全部0になって何も出ない。
   RGBは One/One の素の加算、アルファは Zero/One で0のまま据え置く
   (キャンバスのアルファを0に保つことで、ページ側でも加算合成になる。冒頭の説明を参照)。 */
function additiveBlend(mat){
  mat.blending        = THREE.CustomBlending;
  mat.blendEquation   = THREE.AddEquation;
  mat.blendSrc        = THREE.OneFactor;
  mat.blendDst        = THREE.OneFactor;
  mat.blendEquationAlpha = THREE.AddEquation;
  mat.blendSrcAlpha   = THREE.ZeroFactor;
  mat.blendDstAlpha   = THREE.OneFactor;
  return mat;
}


/* 属性バッファのうち「今フレームで書いた範囲」だけを転送する指定。
   【three r160の落とし穴】`attr.updateRange = {...}` は**読み取り専用**になっており、
   代入すると TypeError で落ちる。r160では clearUpdateRanges()/addUpdateRange() を使う。
   範囲を何も足さなければ全体が転送されるので、古い版でも安全に動く。 */
function setUpdateRange(attr, offset, count){
  attr.needsUpdate = true;
  if(typeof attr.clearUpdateRanges === 'function' && typeof attr.addUpdateRange === 'function'){
    attr.clearUpdateRanges();
    if(count > 0) attr.addUpdateRange(offset, count);
  }
}

/* ---- 上限。1ドローコールに収める数。iPhoneでの実測に合わせて動かす ---- */
const MAX_PARTICLES = 4096;   // 同時に生きられる粒
const MAX_RIBBONS   = 48;     // 同時に引ける軌跡(24では4色の球+乱戦で奪い合った)
const RIBBON_SEGS   = 20;     // 軌跡1本の節の数(太→細)
const MAX_DECALS    = 32;     // 地面に貼る輪

let renderer = null, scene = null, camera = null;
let active = false, failed = false;
let clock0 = 0;               // 秒。matchTime とは独立に進める(演出は実時間で動く)

/* =====================================================================
   粒(GPUインスタンス)
   1つのクアッドを MAX_PARTICLES 個インスタンス描画する。位置・速度・加速度・
   乱流の係数を属性で持たせ、**頂点シェーダの中で時間から位置を出す**。
   CPUは発生の瞬間に1回書くだけなので、毎フレームの転送が要らない。
===================================================================== */
const P = {
  mesh:null, geo:null, mat:null,
  head:0,                      // 次に書き込むリング位置
  attr:{},                     // InstancedBufferAttribute の束
  live:0,
};

/* RawShaderMaterial は Three の組み込み uniform/attribute を注入しないので、
   使うものは自分で宣言する(ShaderMaterial に替えると余計な注入で重くなる)。 */
const PARTICLE_VS = `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
attribute vec3 position;    // クアッドの角(-0.5..0.5)
attribute vec3  aPos0;      // 発生位置(ワールド)
attribute vec3  aVel;       // 初速
attribute vec3  aAcc;       // 加速度(重力・上昇気流)
attribute vec4  aColor;     // rgb=色 / a=最大の明るさ
attribute vec4  aTime;      // x=発生時刻 y=寿命 z=開始サイズ w=終了サイズ
attribute vec4  aTurb;      // x=乱流の強さ y=乱流の周期 z=個体シード w=回転速度
attribute float aHot;       // 芯の白熱量 0..1。0=白く光らない(煙・土ぼこり)
uniform float uTime;
uniform vec2  uViewport;
varying vec4  vColor;
varying vec2  vUv;
varying float vAge;
varying float vHot;

/* 乱流。curlノイズの代わりに、位置と個体シードから作った三角関数の渦を使う。
   本物のcurlより安いうえ、粒ごとに違う軌道を描くので「二次運動」に十分見える。 */
vec3 swirl(vec3 p, float t, float seed){
  float a = p.x*0.013 + seed*6.283;
  float b = p.z*0.013 + seed*3.117;
  float c = p.y*0.011 + t*0.7;
  return vec3(
    sin(a + c) + 0.5*sin(2.0*b - c),
    cos(b*1.3 - c*0.8) * 0.6,
    cos(a*0.9 + c*1.2) + 0.5*sin(2.0*a + c)
  );
}

void main(){
  float age = uTime - aTime.x;
  float life = max(aTime.y, 0.0001);
  float t01 = age / life;
  vAge = t01;
  // 生きていない粒は完全に潰して描かせない(discardより安い)
  if(age < 0.0 || t01 > 1.0){
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vColor = vec4(0.0);
    vUv = vec2(0.0);
    vHot = 0.0;
    return;
  }
  vec3 pos = aPos0 + aVel*age + 0.5*aAcc*age*age;
  pos += swirl(pos, uTime*aTurb.y, aTurb.z) * aTurb.x * age;

  // ワールド(x,y,z) → Three(x, z, y)。real3d.js と同じ規約
  vec4 mv = modelViewMatrix * vec4(pos.x, pos.z, pos.y, 1.0);

  // ビルボード。クアッドの角(position.xy = ±0.5)をビュー空間で広げる
  float size = mix(aTime.z, aTime.w, t01);
  float rot = aTurb.w * age + aTurb.z * 6.283;
  float cr = cos(rot), sr = sin(rot);
  vec2 corner = vec2(position.x*cr - position.y*sr, position.x*sr + position.y*cr);
  mv.xy += corner * size;

  gl_Position = projectionMatrix * mv;

  /* 明るさの時間変化: 速く立ち上がり、ゆっくり減衰する(採点表7)。
     立ち上がりは寿命の8%で最大に達し、そこから滑らかに落ちる。        */
  float rise = smoothstep(0.0, 0.08, t01);
  float fall = 1.0 - smoothstep(0.25, 1.0, t01);
  vColor = vec4(aColor.rgb, aColor.a * rise * fall);
  vHot = aHot;
  vUv = position.xy + 0.5;
}
`;

const PARTICLE_FS = `
precision highp float;
varying vec4 vColor;
varying vec2 vUv;
varying float vAge;
varying float vHot;
void main(){
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d) * 4.0;          // 中心0 → 縁1
  if(r2 > 1.0) discard;
  float r = sqrt(r2);
  /* 加算3層(採点表2)を1枚の粒の中で作る:
     芯 = 白熱(色を白へ寄せる) / 中間 = 属性色 / 縁 = 暗く落ちる。
     これがあるので、粒が重なるほど中心が白飛びして「光」に見える。      */
  float core  = pow(1.0 - r, 6.0);
  float body  = pow(1.0 - r, 2.0);
  float edge  = (1.0 - r);
  /* 芯の白熱は vHot で切れるようにする。
     【なぜ必要か】ここを常時 0.85 にしていたため、**どんな色の粒も中心が白く光り、
     土ぼこり・煙・岩の破片まで発光して見えていた**(岩が雪に見えた)。
     光り物は vHot=1、煙や土は vHot=0 で使う。 */
  vec3 col = vColor.rgb * (body*0.9 + edge*0.25) + vec3(1.0) * core * 0.85 * vHot;
  float a = vColor.a * (body + core*0.6*vHot + body*0.3*(1.0-vHot));
  // アルファは0のまま出す(ページ側で加算合成される。ファイル冒頭の説明を参照)
  gl_FragColor = vec4(col * a, 0.0);
}
`;

function buildParticles(){
  const geo = new THREE.InstancedBufferGeometry();
  // 1つのクアッド(-0.5..0.5)。インスタンスごとにビュー空間で広げる
  geo.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.5,-0.5,0,  0.5,-0.5,0,  0.5,0.5,0,  -0.5,0.5,0], 3));
  geo.setIndex([0,1,2, 0,2,3]);

  const mk = (name, size)=>{
    const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES*size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, a);
    P.attr[name] = a;
    return a;
  };
  mk('aPos0', 3); mk('aVel', 3); mk('aAcc', 3);
  mk('aColor', 4); mk('aTime', 4); mk('aTurb', 4); mk('aHot', 1);
  // 全部「寿命切れ」の状態から始める(発生時刻を大きく負にする)
  const t = P.attr.aTime.array;
  for(let i=0;i<MAX_PARTICLES;i++){ t[i*4] = -1e9; t[i*4+1] = 0.001; }

  const mat = new THREE.RawShaderMaterial({
    vertexShader: PARTICLE_VS,
    fragmentShader: PARTICLE_FS,
    uniforms: { uTime:{ value:0 }, uViewport:{ value:new THREE.Vector2(1,1) } },
    transparent: true,
    depthTest: false,        // 2Dキャンバスの上に重ねるので深度は持たない
    depthWrite: false,
  });
  additiveBlend(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;   // 位置はシェーダで決まるのでCPU側の判定は当たらない
  mesh.renderOrder = 10;
  P.geo = geo; P.mat = mat; P.mesh = mesh;
  return mesh;
}

/* 粒を1つ発生させる。リングバッファなので上限を超えると古いものから上書きされる
   (「出さない」より「一番古いものを捨てる」ほうが、密度の落ち方が自然)。      */
function emitOne(o){
  const i = P.head; P.head = (P.head + 1) % MAX_PARTICLES;
  const a = P.attr;
  const i3 = i*3, i4 = i*4;
  a.aPos0.array[i3]   = o.x;   a.aPos0.array[i3+1] = o.y;   a.aPos0.array[i3+2] = o.z||0;
  a.aVel.array[i3]    = o.vx||0; a.aVel.array[i3+1] = o.vy||0; a.aVel.array[i3+2] = o.vz||0;
  a.aAcc.array[i3]    = o.ax||0; a.aAcc.array[i3+1] = o.ay||0; a.aAcc.array[i3+2] = (o.az==null? -260 : o.az);
  a.aColor.array[i4]  = o.r;   a.aColor.array[i4+1] = o.g;   a.aColor.array[i4+2] = o.b;
  a.aColor.array[i4+3]= (o.bright==null ? 1 : o.bright);
  // delay を足すと「その秒数だけ待ってから生まれる」。シェーダは age<0 の粒を描かないので、
  // 吸い込んでから弾ける、落ちてから砕ける、のような時間差を1回の呼び出しで書ける
  a.aTime.array[i4]   = clock0 + (o.delay || 0);
  a.aTime.array[i4+1] = o.life || 0.6;
  a.aTime.array[i4+2] = o.size0 || 8;
  a.aTime.array[i4+3] = (o.size1==null ? (o.size0||8)*0.25 : o.size1);
  a.aTurb.array[i4]   = o.turb || 0;
  a.aTurb.array[i4+1] = o.turbFreq || 1;
  a.aTurb.array[i4+2] = o.seed==null ? Math.random() : o.seed;
  a.aTurb.array[i4+3] = o.spin || 0;
  // 既定は光る。煙・土ぼこりを出すときだけ hot:0 を渡す
  a.aHot.array[i] = (o.hot == null ? 1 : o.hot);
  /* 書き込んだリング位置の範囲を覚えておく。**全4096個を毎フレーム転送しない。**
     粒は発生の瞬間だけCPUが書き、あとはシェーダが時間から位置を出すので、
     転送が要るのは「このフレームで新しく生まれたぶん」だけ。           */
  if(P.lo == null || i < P.lo) P.lo = i;
  if(P.hi == null || i > P.hi) P.hi = i;
  P.dirty = true;
}

/* =====================================================================
   軌跡(リボン)
   節を後ろへずらしながら太→細の帯を張る。粒の列では速度が読めないため、
   動く物には必ずこれを付ける(採点表3)。
===================================================================== */
const R = { mesh:null, geo:null, mat:null, lanes:[], pos:null, col:null };

function buildRibbons(){
  const geo = new THREE.BufferGeometry();
  const quads = MAX_RIBBONS * (RIBBON_SEGS-1);
  const pos = new Float32Array(quads * 4 * 3);
  const col = new Float32Array(quads * 4 * 4);
  const idx = new Uint16Array(quads * 6);
  for(let q=0;q<quads;q++){
    const v = q*4, o = q*6;
    idx[o]=v; idx[o+1]=v+1; idx[o+2]=v+2;
    idx[o+3]=v; idx[o+4]=v+2; idx[o+5]=v+3;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color',    new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const mat = additiveBlend(new THREE.MeshBasicMaterial({
    vertexColors:true, transparent:true,
    depthTest:false, depthWrite:false, side:THREE.DoubleSide,
  }));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  R.geo = geo; R.mat = mat; R.mesh = mesh; R.pos = pos; R.col = col;
  for(let i=0;i<MAX_RIBBONS;i++) R.lanes.push({ key:null, pts:[], color:[1,1,1], width:10, usedAt:-1e9 });
  return mesh;
}

// key ごとに1本の帯を持つ。毎フレーム現在位置を渡すと、後ろへ節が伸びる
function trailPoint(key, x, y, z, o){
  let lane = R.lanes.find(l=> l.key === key);
  if(!lane){
    // 空きが無ければ一番長く使われていない帯を奪う
    lane = R.lanes.find(l=> l.key === null)
        || R.lanes.reduce((a,b)=> a.usedAt <= b.usedAt ? a : b);
    lane.key = key; lane.pts.length = 0;
  }
  lane.usedAt = clock0;
  lane.color = o.color || [1,1,1];
  lane.width = o.width || 12;
  lane.bright = o.bright==null ? 1 : o.bright;
  /* 先端をどれだけ白へ寄せるか。0で色そのまま、1で真っ白。
     【なぜ指定させるか】ここを 0.8 固定にしていたため、**どんな色を渡しても
     軌跡の先端3割が白くなり、全属性の弾が「白い棒」に見えていた。**
     属性側は色の粒を余計に撒いて相殺していた(粒の無駄遣い)。 */
  lane.whiten = o.whiten==null ? 0.55 : o.whiten;
  lane.pts.push(x, y, z);
  if(lane.pts.length > RIBBON_SEGS*3) lane.pts.splice(0, lane.pts.length - RIBBON_SEGS*3);
}

/* 帯の頂点を作る。カメラから見て「進行方向に垂直」な向きへ太らせる。
   画面上の太さを固定せず、ワールドの幅で持つ(遠いほど細くなる=遠近が合う)。 */
const _tmpA = new THREE.Vector3(), _tmpB = new THREE.Vector3(), _tmpC = new THREE.Vector3();
function updateRibbonGeometry(camWorld){
  const pos = R.pos, col = R.col;
  let q = 0;
  const maxQ = MAX_RIBBONS * (RIBBON_SEGS-1);
  for(const lane of R.lanes){
    if(!lane.key) continue;
    // 0.35秒使われなかった帯は消す(技が終わったのに残り続けるのを防ぐ)
    if(clock0 - lane.usedAt > 0.35){ lane.key = null; lane.pts.length = 0; continue; }
    const n = lane.pts.length/3;
    if(n < 2) continue;
    for(let s=0; s<n-1 && q<maxQ; s++, q++){
      const i0 = s*3, i1 = (s+1)*3;
      _tmpA.set(lane.pts[i0], lane.pts[i0+2], lane.pts[i0+1]);       // ワールド→Three
      _tmpB.set(lane.pts[i1], lane.pts[i1+2], lane.pts[i1+1]);
      _tmpC.subVectors(_tmpB, _tmpA);                                 // 進行方向
      const toCam = _tmpA.clone().sub(camWorld);
      const side = _tmpC.clone().cross(toCam).normalize();
      // 末端ほど細くする(先細り)。s=0が一番古い節
      const w0 = lane.width * ((s)   /(n-1)) * 0.5;
      const w1 = lane.width * ((s+1) /(n-1)) * 0.5;
      const v = q*4*3;
      pos[v+0]=_tmpA.x - side.x*w0; pos[v+1]=_tmpA.y - side.y*w0; pos[v+2]=_tmpA.z - side.z*w0;
      pos[v+3]=_tmpA.x + side.x*w0; pos[v+4]=_tmpA.y + side.y*w0; pos[v+5]=_tmpA.z + side.z*w0;
      pos[v+6]=_tmpB.x + side.x*w1; pos[v+7]=_tmpB.y + side.y*w1; pos[v+8]=_tmpB.z + side.z*w1;
      pos[v+9]=_tmpB.x - side.x*w1; pos[v+10]=_tmpB.y - side.y*w1; pos[v+11]=_tmpB.z - side.z*w1;
      const c = q*4*4;
      /* 濃さ。**0.55は濃すぎた。** 帯は節が重なって加算されるので、1枚を濃くすると
         先端が必ず白へ飽和し、どんな色を渡しても「白いサーチライト」になる
         (実際に fire_t1 でそうなった)。1枚を薄くして、重なりで濃さを出す。 */
      const a0 = lane.bright * (s/(n-1)) * 0.30;
      const a1 = lane.bright * ((s+1)/(n-1)) * 0.30;
      // 先端(新しい節)ほど白熱へ寄せる = 芯が明るく見える
      const hot0 = Math.pow(s/(n-1), 3), hot1 = Math.pow((s+1)/(n-1), 3);
      const wh = lane.whiten;
      for(let k=0;k<4;k++){
        const hot = (k===0||k===1) ? hot0 : hot1;
        const a   = (k===0||k===1) ? a0   : a1;
        col[c+k*4+0] = (lane.color[0] + (1-lane.color[0])*hot*wh) * a;
        col[c+k*4+1] = (lane.color[1] + (1-lane.color[1])*hot*wh) * a;
        col[c+k*4+2] = (lane.color[2] + (1-lane.color[2])*hot*wh) * a;
        col[c+k*4+3] = 0;   // ページ側で加算合成(冒頭の説明を参照)
      }
    }
  }
  /* **使った範囲だけを描き、使った範囲だけを転送する。**
     以前は毎フレーム全クアッド(48本×19節)をゼロで埋めて丸ごと転送していた。
     生きている帯が2〜3本でも同じ量を送るので、実戦(帯18本)で数十msを
     ここで使っていた。描画範囲を絞れば潰す必要も無くなる。            */
  R.geo.setDrawRange(0, q*6);
  setUpdateRange(R.geo.attributes.position, 0, q*4*3);
  setUpdateRange(R.geo.attributes.color,    0, q*4*4);
}

/* =====================================================================
   地面に貼る輪(デカール)
   衝撃波・魔法陣。**地面の高さを1点ずつ拾ってリングを張る**ので、
   坂の上でも地面に貼り付いて見える(画面上の楕円を決め打ちしない)。
===================================================================== */
const D = { list:[], mesh:null, geo:null, mat:null, pos:null, col:null, SEGS:40 };

function buildDecals(){
  const geo = new THREE.BufferGeometry();
  const quads = MAX_DECALS * D.SEGS;
  const pos = new Float32Array(quads*4*3);
  const col = new Float32Array(quads*4*4);
  const idx = new Uint16Array(quads*6);
  for(let q=0;q<quads;q++){
    const v=q*4, o=q*6;
    idx[o]=v; idx[o+1]=v+1; idx[o+2]=v+2; idx[o+3]=v; idx[o+4]=v+2; idx[o+5]=v+3;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color',    new THREE.BufferAttribute(col,4).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(new THREE.BufferAttribute(idx,1));
  const mat = additiveBlend(new THREE.MeshBasicMaterial({ vertexColors:true, transparent:true,
    depthTest:false, depthWrite:false, side:THREE.DoubleSide }));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  D.geo=geo; D.mat=mat; D.mesh=mesh; D.pos=pos; D.col=col;
  return mesh;
}

// 広がる輪を1つ足す。r0→r1 へ life 秒かけて広がる
function addRing(o){
  if(D.list.length >= MAX_DECALS) D.list.shift();
  D.list.push({
    x:o.x, y:o.y, r0:o.r0||10, r1:o.r1||200, life:o.life||0.5, born:clock0,
    color:o.color||[1,1,1], width:o.width||18, bright:o.bright==null?1:o.bright,
  });
}

function updateDecalGeometry(){
  const pos=D.pos, col=D.col;
  const groundZ = (typeof window.groundZAt === 'function') ? window.groundZAt : ()=>0;
  let q=0;
  const maxQ = MAX_DECALS*D.SEGS;
  for(let i=D.list.length-1;i>=0;i--){
    const d = D.list[i];
    const t = (clock0 - d.born)/d.life;
    if(t >= 1 || t < 0){ D.list.splice(i,1); continue; }
    // 速く広がってゆっくり消える(採点表7)
    const ease = 1 - Math.pow(1-t, 3);
    const rad = d.r0 + (d.r1-d.r0)*ease;
    const a = d.bright * (1-t) * (1-t);
    const halfW = d.width * (0.35 + 0.65*(1-t));
    for(let s=0; s<D.SEGS && q<maxQ; s++, q++){
      const a0 = (s/D.SEGS)*Math.PI*2, a1 = ((s+1)/D.SEGS)*Math.PI*2;
      const c0=Math.cos(a0), s0=Math.sin(a0), c1=Math.cos(a1), s1=Math.sin(a1);
      const pts = [
        [d.x+c0*(rad-halfW), d.y+s0*(rad-halfW)],
        [d.x+c0*(rad+halfW), d.y+s0*(rad+halfW)],
        [d.x+c1*(rad+halfW), d.y+s1*(rad+halfW)],
        [d.x+c1*(rad-halfW), d.y+s1*(rad-halfW)],
      ];
      const v=q*4*3, cc=q*4*4;
      for(let k=0;k<4;k++){
        const gx=pts[k][0], gy=pts[k][1];
        // 地面の高さを1点ずつ拾う。ここを定数にすると坂で輪が地面から浮く
        pos[v+k*3+0]=gx; pos[v+k*3+1]=groundZ(gx,gy)+2; pos[v+k*3+2]=gy;
        const inner = (k===0||k===3);
        const ka = a * (inner ? 0.5 : 1.0);
        col[cc+k*4+0]=d.color[0]*ka; col[cc+k*4+1]=d.color[1]*ka; col[cc+k*4+2]=d.color[2]*ka;
        col[cc+k*4+3]=0;
      }
    }
  }
  // 輪も同じ。生きている輪のぶんだけ描いて、そのぶんだけ転送する
  D.geo.setDrawRange(0, q*6);
  setUpdateRange(D.geo.attributes.position, 0, q*4*3);
  setUpdateRange(D.geo.attributes.color,    0, q*4*4);
}

/* =====================================================================
   初期化・毎フレーム
===================================================================== */
function ensureScene(){
  if(scene || failed) return !!scene;
  try{
    const cv = document.getElementById('fxCanvas');
    if(!cv){ failed = true; return false; }
    renderer = new THREE.WebGLRenderer({ canvas:cv, antialias:false, alpha:true,
                                         premultipliedAlpha:true });
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    // トーンマッピングは掛けない。この層は「光の足し算」なので、
    // 掛けると芯の白飛び(採点表2)が潰れて、光っているように見えなくなる
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(64, 1, 8, 14000);
    scene.add(buildParticles());
    scene.add(buildRibbons());
    scene.add(buildDecals());
    return true;
  }catch(err){
    console.error('[aramon] 技エフェクトのWebGL初期化に失敗。2Dの芯だけで描きます', err);
    failed = true; scene = null;
    return false;
  }
}

/* この層の描画解像度を2D側より落とす倍率。
   【なぜ効くか】この層が描くのは**光の足し算だけ**で、粒も軌跡もぼんやりした
   低い周波数の絵しか持たない。輪郭の鋭さを担っているのは2D側の芯(炎の柱・ビームの筒)
   なので、こちらを0.7倍で描いて引き伸ばしても**見た目はほとんど変わらない**。
   一方で塗る画素は半分になる。加算合成の大きな粒は塗りつぶし律速なので、ここが一番効く。
   **「負荷でエフェクトを削らない/同じ見た目のまま安くする」という方針そのもの。**
   1にすると等倍。実機で粗く見えるようなら上げる。                              */
let FX_RES_SCALE = 0.7;

function applySize(){
  if(!renderer) return;
  const w = window.viewW || 1, h = window.viewH || 1;
  const base = window.__aramonRenderScale || Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(base * FX_RES_SCALE);
  renderer.setSize(w, h, true);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
}

const _camWorld = new THREE.Vector3();

const api = {
  setActive(on){
    const cv = document.getElementById('fxCanvas');
    if(on){
      if(!ensureScene()){ if(cv) cv.classList.add('hidden'); active=false; return false; }
      if(cv) cv.classList.remove('hidden');
      applySize();
      active = true;
      return true;
    }
    if(cv) cv.classList.add('hidden');
    active = false;
    return false;
  },
  isActive(){ return active && !!scene; },
  resize(){ if(active) applySize(); },
  // 計測用: 描画倍率を変えて比べる(本番から呼ぶものではない)
  setResScale(v){ FX_RES_SCALE = Math.max(0.25, Math.min(2, v||0.7)); applySize(); },

  /* フレームの最初。dt は実時間(秒)。**matchTime ではない**:
     演出は試合の一時停止中でも自然に減衰してほしいため。 */
  begin(dt){
    clock0 += Math.min(Math.max(dt||0.016, 0), 0.1);
  },

  // ---- 発注API(technique側から呼ぶ) ----
  emit: emitOne,
  burst(o){
    const n = o.count || 12;
    for(let i=0;i<n;i++){
      const a  = (o.angle==null ? Math.random()*Math.PI*2 : o.angle + (Math.random()-0.5)*(o.spread||Math.PI*2));
      const el = (o.elev==null ? Math.random()*0.9 : o.elev + (Math.random()-0.5)*(o.elevSpread||0.6));
      const sp = (o.speed||140) * (0.5 + Math.random());
      emitOne({
        x:o.x + (Math.random()-0.5)*(o.jitter||0),
        y:o.y + (Math.random()-0.5)*(o.jitter||0),
        z:(o.z||0) + Math.random()*(o.jitterZ||0),
        vx:Math.cos(a)*Math.cos(el)*sp, vy:Math.sin(a)*Math.cos(el)*sp, vz:Math.sin(el)*sp,
        ax:o.ax||0, ay:o.ay||0, az:(o.az==null? -260 : o.az),
        r:o.r, g:o.g, b:o.b, bright:o.bright,
        life:(o.life||0.6)*(0.6+Math.random()*0.8),
        size0:(o.size0||10)*(0.7+Math.random()*0.6), size1:o.size1,
        turb:o.turb||0, turbFreq:o.turbFreq||1, spin:o.spin||0,
        delay:o.delay||0, hot:o.hot,
      });
    }
  },
  trail: trailPoint,
  ring: addRing,
  /* 画面側の演出。実体は render.js(カメラそのものを揺らすので2Dの芯とWebGL層が
     必ず一緒に動く)。ここは技側から呼べる窓口を出すだけ。
     amount は 0..1、x,y を渡すとプレイヤーからの距離で自動的に弱まる。 */
  shake(amount, x, y){ if(typeof window.fxPunch === 'function') window.fxPunch(amount, x, y); },
  flash(amount){ if(typeof window.fxFlashAdd === 'function') window.fxFlashAdd(amount); },

  /* 2Dの描画が終わったあとに1回。カメラは2Dの project() と同じ値から作る。 */
  render(){
    if(!active || !scene) return false;
    const cp = window.camPos, cs = window.camState;
    if(!cp || !cs) return false;
    const fovDeg = (window.FOV_V ? window.FOV_V*180/Math.PI : 64);
    if(Math.abs(camera.fov - fovDeg) > 0.01){ camera.fov = fovDeg; camera.updateProjectionMatrix(); }
    camera.position.set(cp.x, cp.z, cp.y);
    const cosP = Math.cos(cs.pitch), sinP = Math.sin(cs.pitch);
    camera.lookAt(
      cp.x + Math.cos(cs.yaw)*cosP*1000,
      cp.z - sinP*1000,
      cp.y + Math.sin(cs.yaw)*cosP*1000
    );
    _camWorld.set(cp.x, cp.z, cp.y);
    P.mat.uniforms.uTime.value = clock0;
    if(P.dirty){
      /* リングバッファなので、書いた範囲が末尾から先頭へ回り込むことがある。
         その回だけは全部送る(回り込みは4096個に1回しか起きない)。 */
      const wrapped = (P.lo === 0 && P.hi === MAX_PARTICLES-1);
      for(const k in P.attr){
        const at = P.attr[k];
        if(wrapped) setUpdateRange(at, 0, 0);            // 範囲を足さない=全体を送る
        else        setUpdateRange(at, P.lo*at.itemSize, (P.hi - P.lo + 1)*at.itemSize);
      }
      P.dirty = false; P.lo = null; P.hi = null;
    }
    updateRibbonGeometry(_camWorld);
    updateDecalGeometry();
    renderer.render(scene, camera);
    return true;
  },

  // 計測用
  stats(){ return { particles: MAX_PARTICLES, ribbons: R.lanes.filter(l=>l.key).length, decals: D.list.length }; },
  /* **この層の描画だけ**にかかる時間(ms)。フレーム全体を測ると2Dの描画と混ざり、
     他のプロセスの負荷でも数字が動いて「層を足したら速くなった」のような
     嘘の差が出る(実際に出た)。中央値を返すので単発の外れ値に強い。 */
  benchSelf(n){
    if(!active || !scene) return null;
    const N = n || 40;
    /* **GPUの終わりまで待ってから時計を止める。**
       renderer.render() は命令を積むだけで戻るので、待たずに測ると
       どの解像度でも同じ 0.3ms しか出ず、塗りつぶしの重さが一切見えない
       (実際にそうなった)。1画素だけ読み戻すとGPUの完了まで同期する。 */
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    const t = [];
    for(let i=0;i<N+8;i++){
      const t0 = performance.now();
      api.render();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if(i >= 8) t.push(performance.now() - t0);   // 最初の8回は暖機ぶんで捨てる
    }
    t.sort((a,b)=>a-b);
    return { ms:+t[t.length>>1].toFixed(2), min:+t[0].toFixed(2), max:+t[t.length-1].toFixed(2),
             scale: FX_RES_SCALE, ...api.stats() };
  },
};

window.__aramonFxGl = api;
