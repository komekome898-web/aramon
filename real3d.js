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

const CELL = PATCH_SIZE / PATCH_SEGS;   // 頂点間隔。この単位でパッチ位置をスナップする
const TEX_TILE = 420;                   // 地面テクスチャ1枚が覆うワールド単位(小さいほど細かい)

let renderer = null, scene = null, camera = null;
let terrain = null, terrainPos = null, terrainCol = null;
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

// 遠景の山並み。実際の地形パッチの外側を埋めて「世界の終わり」を隠す
function buildDistantRidge(){
  const R = RIDGE_DIST, SEGS = 96;
  const geo = new THREE.BufferGeometry();
  const pos = [], col = [];
  const c1 = new THREE.Color(0x747a8c), c2 = new THREE.Color(COL_HAZE);
  for(let i=0;i<SEGS;i++){
    const a0 = (i/SEGS)*Math.PI*2, a1 = ((i+1)/SEGS)*Math.PI*2;
    const h0 = 420 + Math.abs(Math.sin(a0*3.1))*520 + Math.abs(Math.cos(a0*1.7))*260;
    const h1 = 420 + Math.abs(Math.sin(a1*3.1))*520 + Math.abs(Math.cos(a1*1.7))*260;
    const x0 = Math.cos(a0)*R, z0 = Math.sin(a0)*R;
    const x1 = Math.cos(a1)*R, z1 = Math.sin(a1)*R;
    pos.push(x0,-200,z0,  x1,-200,z1,  x1,h1,z1);
    pos.push(x0,-200,z0,  x1,h1,z1,   x0,h0,z0);
    for(const c of [c2,c2,c1,c2,c1,c1]) col.push(c.r,c.g,c.b);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col,3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors:true, fog:false, depthWrite:false }));
  mesh.frustumCulled = false;
  return mesh;
}

// 砂・岩肌の質感を出す手続き的なテクスチャ。画像ファイルを増やさずに済ませる。
// 値ノイズを4オクターブ重ねたグレースケールを、頂点色に掛け合わせて使う。
function buildGroundTexture(){
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  // 決まった疑似乱数(端末が変わっても同じ模様になるように)
  const rnd = (x,y)=>{
    const n = Math.sin(x*127.1 + y*311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const smooth = (x,y,per)=>{
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x-xi, yf = y-yi;
    const u = xf*xf*(3-2*xf), v = yf*yf*(3-2*yf);
    const w = (a,b)=>((a%per)+per)%per;   // タイル境界で継ぎ目が出ないよう周期化
    const a = rnd(w(xi,per),   w(yi,per));
    const b = rnd(w(xi+1,per), w(yi,per));
    const c = rnd(w(xi,per),   w(yi+1,per));
    const e = rnd(w(xi+1,per), w(yi+1,per));
    return (a*(1-u)+b*u)*(1-v) + (c*(1-u)+e*u)*v;
  };
  for(let y=0;y<S;y++){
    for(let x=0;x<S;x++){
      let v = 0, amp = 0.5, per = 8;
      for(let o=0;o<4;o++){
        v += smooth(x/S*per, y/S*per, per) * amp;
        amp *= 0.5; per *= 2;
      }
      // 砂目が細かく見えるよう、ざらつきを少し足す
      v = v*0.86 + rnd(x*1.7, y*2.3)*0.14;
      const c = Math.round(150 + v*105);   // 150〜255。頂点色に掛けるので明るめに寄せる
      const i = (y*S+x)*4;
      img.data[i]=c; img.data[i+1]=c; img.data[i+2]=c; img.data[i+3]=255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
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
  const tex = buildGroundTexture();
  tex.repeat.set(PATCH_SIZE/TEX_TILE, PATCH_SIZE/TEX_TILE);
  const mat = new THREE.MeshLambertMaterial({ vertexColors:true, map:tex });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  terrainPos = geo.attributes.position;
  terrainCol = geo.attributes.color;
  return mesh;
}

const _c = new THREE.Color();
const _cLow = new THREE.Color(COL_LOW), _cHigh = new THREE.Color(COL_HIGH), _cSteep = new THREE.Color(COL_STEEP);
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
    _c.copy(_cLow).lerp(_cHigh, t).lerp(_cSteep, slope);
    col[j] = _c.r; col[j+1] = _c.g; col[j+2] = _c.b;
  }
  terrainPos.needsUpdate = true;
  terrainCol.needsUpdate = true;
  terrain.geometry.computeVertexNormals();
  terrain.position.set(sx, 0, sy);
  // テクスチャの模様をワールドに固定する。これをしないとパッチと一緒に模様が動き、
  // 地面の上を滑っているように見えてしまう(uv.yは回転で反転しているので符号が逆)
  const tex = terrain.material.map;
  if(tex) tex.offset.set(sx / TEX_TILE, -sy / TEX_TILE);
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
    sky = buildSky();   scene.add(sky);
    ridge = buildDistantRidge(); scene.add(ridge);
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
