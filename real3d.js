/* =====================================================================
   リアルマップ(テスト)のWebGL描画レイヤー(Three.js)

   ・地面だけをWebGLで立体的に描く。モンスター・弾・技エフェクト・HUDは
     従来どおり2Dキャンバス(render.js)が上に重ねて描く。
     この分担なら既存の描画コードを一切書き換えずに済む。
   ・2Dの project() とカメラを完全に一致させてあるので、2D側が描く物の
     画面位置は3Dの地形とズレない(縦画角64°・カメラ位置・yaw/pitchを共有)。
     ただし丘の裏に隠れる遮蔽は2D側には無い(テストマップの割り切り)。
   ・地形の高さは data.js の real3dHeightAt(x,y)。当たり判定(world.jsの
     getTerrainHeightAt)と同じ関数なので、見た目と当たり判定が必ず一致する。
   ・ESモジュールなので、他のファイルからは window.__aramonReal3D 経由で呼ぶ
     (firebase.js と同じ橋渡しの形)。
   ===================================================================== */
import * as THREE from './vendor/three.module.min.js';

// ---- 見た目の調整用定数(プレイテストで触るのはここだけ) ----
const PATCH_SIZE  = 7200;  // プレイヤー中心に張る地形パッチの一辺(ワールド単位)
const PATCH_SEGS  = 144;   // パッチの分割数。細かくすると綺麗だが重くなる
// フォグはパッチの半分(3600)より手前で完全に霞ませる。こうしないとパッチの切れ目が見える
const FOG_NEAR    = 700;
const FOG_FAR     = 3200;
const RIDGE_DIST  = 5200;  // 遠景の山並みの距離(パッチの外。フォグの影響を受けない)
const SKY_RADIUS  = 9000;
const CAM_FAR     = 12000;
const SUN_DIR     = new THREE.Vector3(-0.55, 0.62, -0.38).normalize();
const COL_SKY_TOP = 0x223652;
const COL_SKY_BOT = 0x9aa8b0;
const COL_HAZE    = 0xcfc2a6;
const COL_LOW     = 0xa89066;   // 低地(やや湿った土)
const COL_HIGH    = 0xd9c79b;   // 高地(乾いた明るい砂)
const COL_STEEP   = 0x6f6152;   // 急斜面(むき出しの岩肌)
const COL_GRAVEL  = 0x8d8371;   // 砂利まじりの地面(まだら模様用)
const COL_SCRUB   = 0x8a8a5c;   // 乾いた草地(まだら模様用)

const CELL = PATCH_SIZE / PATCH_SEGS;   // 頂点間隔。この単位でパッチ位置をスナップする
const TEX_TILE    = 420;                // 色テクスチャ1枚が覆うワールド単位(小さいほど細かい)
const DETAIL_TILE = 105;                // 凹凸(バンプ)テクスチャが覆うワールド単位。足元の砂利感を出す
const BUMP_SCALE  = 0.3;                // 凹凸の強さ。上げるとザラつくが不自然になりやすい
const MACRO_TILE  = 900;                // 地面のまだら模様(砂/砂利/枯れ草)の大きさ

let renderer = null, scene = null, camera = null;
let terrain = null, terrainPos = null, terrainCol = null;
let groundTex = null, detailTex = null;
let sky = null, ridge = null;
let patchCX = null, patchCY = null;      // 現在のパッチ中心(スナップ済み)
let active = false, failed = false;

function heightAt(x, y){
  return (typeof window.real3dHeightAt === 'function') ? window.real3dHeightAt(x, y) : 0;
}

// 空: 内側を向いた大きな球に2色グラデーションを描く(テクスチャ不要)
function buildSky(){
  const geo = new THREE.SphereGeometry(SKY_RADIUS, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top:   { value: new THREE.Color(COL_SKY_TOP) },
      bot:   { value: new THREE.Color(COL_SKY_BOT) },
      haze:  { value: new THREE.Color(COL_HAZE) },
    },
    vertexShader: `
      varying float vH;
      void main(){
        vH = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 bot; uniform vec3 haze;
      varying float vH;
      void main(){
        // 地平線付近はヘイズ色に寄せて、地面のフォグと自然につなぐ
        float t = clamp(vH, -1.0, 1.0);
        vec3 c = (t >= 0.0) ? mix(bot, top, pow(t, 0.7)) : mix(bot, haze, clamp(-t*3.0, 0.0, 1.0));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

/* 遠景の山並み。実際の地形パッチの外側を埋めて「世界の終わり」を隠す。
   ・稜線は周期の違う波を4つ重ねてギザギザにする(1本の正弦波だと作り物に見える)
   ・距離の違う層を3枚重ね、遠い層ほど霞ませて空の色に近づける(空気遠近)
   ・縦にも分割し、高度で色を変える(麓=霞んだ土 / 中腹=岩 / 頂上付近=雪)
   ・太陽の方位に向いた面を明るくして、のっぺりした影絵に見えないようにする      */
const RIDGE_LAYERS = [
  // dist: RIDGE_DISTからの倍率 / peak: 稜線の高さ / haze: 空気遠近(1で完全に霞む)
  // 遠い層ほど高くしてある。同じ見かけの高さだと手前の山に完全に隠れてしまう
  { dist:1.00, base:260, peak: 850, haze:0.30, snow:0.62 },
  { dist:1.42, base:220, peak:1640, haze:0.55, snow:0.55 },
  { dist:1.95, base:180, peak:2840, haze:0.78, snow:0.46 },
];
const COL_RIDGE_ROCK = 0x6a6a74;   // 岩肌
const COL_RIDGE_FOOT = 0x8a8072;   // 麓(手前の地面に近い色)
const COL_RIDGE_SNOW = 0xe8eef6;   // 冠雪
function ridgeProfile(a, seed){
  // 角度の周期関数を重ねた稜線。層ごとにseedで位相をずらして同じ形を並べない
  return (
    Math.abs(Math.sin(a*2.0  + seed*1.7)) * 0.50 +
    Math.abs(Math.sin(a*4.3  + seed*2.9)) * 0.27 +
    Math.abs(Math.sin(a*9.1  + seed*4.1)) * 0.15 +
    Math.abs(Math.sin(a*17.3 + seed*5.3)) * 0.08
  );
}
function buildDistantRidge(){
  const SEGS = 168, BANDS = 4;   // 円周の分割数 / 縦の分割数(高度で色を変えるため)
  const geo = new THREE.BufferGeometry();
  const pos = [], col = [];
  const cHaze = new THREE.Color(COL_HAZE), cSkyBot = new THREE.Color(COL_SKY_BOT);
  const cRock = new THREE.Color(COL_RIDGE_ROCK), cFoot = new THREE.Color(COL_RIDGE_FOOT);
  const cSnow = new THREE.Color(COL_RIDGE_SNOW);
  const tmp = new THREE.Color();
  // 太陽の方位(水平成分)。この向きを向いた斜面が明るくなる
  const sunLen = Math.hypot(SUN_DIR.x, SUN_DIR.z) || 1;
  const sunAx = SUN_DIR.x/sunLen, sunAz = SUN_DIR.z/sunLen;
  // 奥の層から先に積む。この網は深度を書かない(depthWrite:false)ので、
  // 手前の層をあとに描かないと遠い山が近い山を塗りつぶしてしまう
  RIDGE_LAYERS.map((L,i)=>({L, li:i})).sort((a,b)=>b.L.dist-a.L.dist).forEach(({L, li})=>{
    const R = RIDGE_DIST * L.dist;
    // 頂点の色: 高度t(0=麓, 1=その山の頂上)と、山の高さhNormで雪を乗せる
    const colorAt = (a, t, hNorm)=>{
      tmp.copy(cFoot).lerp(cRock, Math.min(1, t*1.35));
      const snowT = (hNorm > L.snow) ? Math.min(1, (t - 0.72)/0.28) * Math.min(1,(hNorm-L.snow)*3.2) : 0;
      if(snowT > 0) tmp.lerp(cSnow, snowT);
      // 斜面の向きによる明暗(山は内側=カメラ側を向いている)
      const lightness = 0.82 + 0.18*(-Math.cos(a)*sunAx - Math.sin(a)*sunAz);
      tmp.multiplyScalar(lightness);
      // 空気遠近。麓ほど強く霞ませると、地表のフォグと自然につながる
      tmp.lerp(cHaze, Math.min(1, L.haze + (1-t)*0.30));
      tmp.lerp(cSkyBot, L.haze*0.25);
      return tmp;
    };
    const push = (a, t, h)=>{
      pos.push(Math.cos(a)*R, -L.base + (h + L.base)*t, Math.sin(a)*R);
      const c = colorAt(a, t, h/L.peak);
      col.push(c.r, c.g, c.b);
    };
    for(let i=0;i<SEGS;i++){
      const a0 = (i/SEGS)*Math.PI*2, a1 = ((i+1)/SEGS)*Math.PI*2;
      const h0 = L.peak*ridgeProfile(a0, li+1);
      const h1 = L.peak*ridgeProfile(a1, li+1);
      for(let b=0;b<BANDS;b++){
        const t0 = b/BANDS, t1 = (b+1)/BANDS;
        push(a0,t0,h0); push(a1,t0,h1); push(a1,t1,h1);
        push(a0,t0,h0); push(a1,t1,h1); push(a0,t1,h0);
      }
    }
  });
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col,3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors:true, fog:false, depthWrite:false }));
  mesh.frustumCulled = false;
  return mesh;
}

/* ---- 手続き的な地面テクスチャ(画像ファイルを増やさずに質感を出す) ----
   ・色テクスチャ: 砂の濃淡 + ひび割れ + 砂利の粒。頂点色に掛け合わせるので明るめに作る
   ・凹凸テクスチャ(bumpMap): もっと細かい周期で貼り、光の当たり方で粒立ちを出す
   端末が変わっても同じ模様になるよう、疑似乱数は座標から決まる固定式にしてある。   */
const _hash = (x,y)=>{ const n = Math.sin(x*127.1 + y*311.7) * 43758.5453; return n - Math.floor(n); };
// タイル境界で継ぎ目が出ないよう周期perで折り返す値ノイズ
function tileNoise(x, y, per){
  const w = (a)=>((a%per)+per)%per;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x-xi, yf = y-yi;
  const u = xf*xf*(3-2*xf), v = yf*yf*(3-2*yf);
  const a = _hash(w(xi),   w(yi));
  const b = _hash(w(xi+1), w(yi));
  const c = _hash(w(xi),   w(yi+1));
  const e = _hash(w(xi+1), w(yi+1));
  return (a*(1-u)+b*u)*(1-v) + (c*(1-u)+e*u)*v;
}
// u,v(0〜1)を周期perのfBmで samplingする
function fbmTile(u, v, per, oct){
  let s = 0, amp = 0.5, p = per;
  for(let o=0;o<oct;o++){ s += tileNoise(u*p, v*p, p)*amp; amp *= 0.5; p *= 2; }
  return s;
}
function buildGroundTexture(){
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  for(let y=0;y<S;y++){
    for(let x=0;x<S;x++){
      const u = x/S, v = y/S;
      // 生成は試合開始時に1回だけ。iPhoneでも待たされないようオクターブ数は抑えている
      const base = fbmTile(u, v, 8, 3);                 // 大きな濃淡(土の斑)
      const fine = tileNoise(u*48, v*48, 48);           // 細かい砂目
      // 尾根状ノイズを細い暗線として使う = 乾いた地面のひび割れ
      const ridge = 1 - Math.abs(fbmTile(u, v, 12, 2)*2 - 1);
      const crack = Math.max(0, ridge - 0.86) * 3.4;
      // 砂利の粒。明るい粒と暗い粒を混ぜると単調な砂に見えない
      const grit = _hash(x*1.7, y*2.3);
      let lum = 0.66 + base*0.30 + (fine-0.5)*0.13 + (grit-0.5)*0.10 - crack*0.30;
      lum = Math.max(0.35, Math.min(1, lum));
      // ほんのり色みを散らす(赤茶⇔灰)。頂点色と喧嘩しないよう振れ幅は小さく
      const tint = tileNoise(u*5, v*5, 5) - 0.5;
      const r = lum*(1 + tint*0.10), gg = lum*(1 + tint*0.02), b = lum*(1 - tint*0.10);
      const i = (y*S+x)*4;
      img.data[i]   = Math.round(Math.max(0,Math.min(1,r))*255);
      img.data[i+1] = Math.round(Math.max(0,Math.min(1,gg))*255);
      img.data[i+2] = Math.round(Math.max(0,Math.min(1,b))*255);
      img.data[i+3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
// 足元の砂利・小石の凹凸。色テクスチャより細かい周期で貼り、陰影だけを作る
function buildDetailBumpTexture(){
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  for(let y=0;y<S;y++){
    for(let x=0;x<S;x++){
      const u = x/S, v = y/S;
      const n = fbmTile(u, v, 16, 2);
      const pebble = Math.pow(tileNoise(u*32, v*32, 32), 3); // 粒の立ち上がり(小石)
      const c = Math.round(Math.max(0, Math.min(1, n*0.72 + pebble*0.5 + _hash(x*3.1,y*1.3)*0.08))*255);
      const i = (y*S+x)*4;
      img.data[i]=c; img.data[i+1]=c; img.data[i+2]=c; img.data[i+3]=255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 2;
  return tex;
}

function buildTerrain(){
  // 平面を作ってからX-Z平面へ倒す。頂点の高さ(y)は毎回 updateTerrain で書き換える
  const geo = new THREE.PlaneGeometry(PATCH_SIZE, PATCH_SIZE, PATCH_SEGS, PATCH_SEGS);
  geo.rotateX(-Math.PI/2);
  const n = geo.attributes.position.count;
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n*3), 3));
  // UVはパッチのローカル座標そのままなので、repeatで「何単位に1回」貼るかを決める。
  // パッチ位置はCELLの倍数にスナップして動かすため、模様がワールドに固定されて見える。
  groundTex = buildGroundTexture();
  groundTex.repeat.set(PATCH_SIZE/TEX_TILE, PATCH_SIZE/TEX_TILE);
  detailTex = buildDetailBumpTexture();
  detailTex.repeat.set(PATCH_SIZE/DETAIL_TILE, PATCH_SIZE/DETAIL_TILE);
  // Phongの弱い反射で、太陽に対して地面がわずかに照り返す(砂の質感)。
  // 光沢を強くするとプラスチックに見えるので shininess は低く、specularは暗く保つ
  const mat = new THREE.MeshPhongMaterial({
    vertexColors:true, map:groundTex,
    bumpMap:detailTex, bumpScale:BUMP_SCALE,
    shininess:2, specular:new THREE.Color(0x0e0c09),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  terrainPos = geo.attributes.position;
  terrainCol = geo.attributes.color;
  return mesh;
}

const _c = new THREE.Color(), _cMacro = new THREE.Color();
const _cLow = new THREE.Color(COL_LOW), _cHigh = new THREE.Color(COL_HIGH), _cSteep = new THREE.Color(COL_STEEP);
const _cGravel = new THREE.Color(COL_GRAVEL), _cScrub = new THREE.Color(COL_SCRUB);
// ワールド座標で決まるまだら模様(砂/砂利/枯れ草)。同じ場所は常に同じ色になる純関数
function macroPatch(wx, wy){
  const u = wx/MACRO_TILE, v = wy/MACRO_TILE;
  const xi = Math.floor(u), yi = Math.floor(v);
  const xf = u-xi, yf = v-yi;
  const a = xf*xf*(3-2*xf), b = yf*yf*(3-2*yf);
  const h = (x,y)=>_hash(x*1.31+7.7, y*2.17-3.3);
  return (h(xi,yi)*(1-a)+h(xi+1,yi)*a)*(1-b) + (h(xi,yi+1)*(1-a)+h(xi+1,yi+1)*a)*b;
}
// パッチをプレイヤー位置へ動かし、頂点の高さと色を書き直す。
// 中心を CELL の倍数にスナップするので、動かしても頂点が同じワールド座標に乗り
// 地形が波打って見えない。
function updateTerrain(cx, cy){
  const sx = Math.round(cx / CELL) * CELL;
  const sy = Math.round(cy / CELL) * CELL;
  if(patchCX === sx && patchCY === sy) return;
  patchCX = sx; patchCY = sy;
  const arr = terrainPos.array, col = terrainCol.array;
  for(let i=0, j=0; i<terrainPos.count; i++, j+=3){
    // ローカルのx,z(=ゲームのx,y相対)からワールド座標を出して高さを引く
    const wx = sx + arr[j];
    const wy = sy + arr[j+2];
    const h = heightAt(wx, wy);
    arr[j+1] = h;
    // 高さと傾斜で色を決める(テクスチャ画像を持たずに岩肌と砂を描き分ける)
    const gx = (heightAt(wx+CELL, wy) - h) / CELL;
    const gy = (heightAt(wx, wy+CELL) - h) / CELL;
    const slope = Math.min(1, Math.hypot(gx, gy) / 0.45);
    const t = Math.min(1, Math.max(0, (h + 240) / 480));
    _c.copy(_cLow).lerp(_cHigh, t);
    // 高さだけで色を決めると縞に見えるので、場所ごとのまだら(砂利・枯れ草)を混ぜる
    const mp = macroPatch(wx, wy);
    _cMacro.copy(mp < 0.5 ? _cGravel : _cScrub);
    _c.lerp(_cMacro, Math.min(0.42, Math.abs(mp-0.5)*0.84));
    _c.lerp(_cSteep, slope);   // 急斜面はむき出しの岩肌
    col[j] = _c.r; col[j+1] = _c.g; col[j+2] = _c.b;
  }
  terrainPos.needsUpdate = true;
  terrainCol.needsUpdate = true;
  terrain.geometry.computeVertexNormals();
  terrain.position.set(sx, 0, sy);
  // テクスチャの模様をワールドに固定する。これをしないとパッチと一緒に模様が動き、
  // 地面の上を滑っているように見えてしまう(uv.yは回転で反転しているので符号が逆)
  if(groundTex) groundTex.offset.set(sx / TEX_TILE, -sy / TEX_TILE);
  if(detailTex) detailTex.offset.set(sx / DETAIL_TILE, -sy / DETAIL_TILE);
}

function ensureScene(){
  if(scene || failed) return !!scene;
  try{
    const cv = document.getElementById('glCanvas');
    if(!cv) { failed = true; return false; }
    renderer = new THREE.WebGLRenderer({ canvas:cv, antialias:false, alpha:false });
    renderer.setClearColor(COL_SKY_BOT, 1);
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(COL_HAZE, FOG_NEAR, FOG_FAR);
    camera = new THREE.PerspectiveCamera(64, 1, 8, CAM_FAR);
    // 空 → 遠景の山 → 地形 の順で必ず塗る。空も山も深度を書かないため、
    // 描画順が入れ替わると遠くの山が空に消される(renderOrderで固定する)
    sky = buildSky();   sky.renderOrder = -2;   scene.add(sky);
    ridge = buildDistantRidge(); ridge.renderOrder = -1; scene.add(ridge);
    terrain = buildTerrain();
    scene.add(terrain);
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.55);
    sun.position.copy(SUN_DIR);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x6b5a3e, 0.62));
    return true;
  }catch(err){
    console.error('[aramon] WebGLの初期化に失敗しました。従来の描画にフォールバックします', err);
    failed = true; scene = null;
    return false;
  }
}

function applySize(){
  if(!renderer) return;
  const w = window.viewW || 1, h = window.viewH || 1;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, true);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

const api = {
  // マップがリアルマップかどうかで表示を切り替える。失敗時はfalseを返し、
  // 呼び出し側(render.js)は従来の2D地面を描く
  setActive(on){
    const cv = document.getElementById('glCanvas');
    if(on){
      if(!ensureScene()){ if(cv) cv.classList.add('hidden'); active = false; return false; }
      if(cv) cv.classList.remove('hidden');
      patchCX = patchCY = null;   // 次のrenderで作り直す
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
  // 毎フレーム、2Dの描画より先に呼ぶ。カメラは2Dのproject()と同じ値から作る
  render(){
    if(!active || !scene) return false;
    const cp = window.camPos, cs = window.camState;
    if(!cp || !cs) return false;
    updateTerrain(cp.x, cp.y);
    // 空と遠景はカメラに追従させる。ワールドは18100単位あるので原点固定だと視界から外れる
    if(sky) sky.position.set(cp.x, 0, cp.y);
    if(ridge) ridge.position.set(cp.x, 0, cp.y);
    // ゲーム座標(x,y=地面 / z=上)→ Three(x, y=上, z)
    camera.position.set(cp.x, cp.z, cp.y);
    const cosP = Math.cos(cs.pitch), sinP = Math.sin(cs.pitch);
    camera.lookAt(
      cp.x + Math.cos(cs.yaw)*cosP*1000,
      cp.z - sinP*1000,
      cp.y + Math.sin(cs.yaw)*cosP*1000
    );
    renderer.render(scene, camera);
    return true;
  },
};
window.__aramonReal3D = api;
