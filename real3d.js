/* =====================================================================
   リアルマップのWebGL描画レイヤー(Three.js)— 全体のとりまとめ

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

   【ファイル分担】このファイルは「シーンの土台と毎フレームの進行」だけを持つ。
     real3d_common.js  ノイズ/テクスチャ生成の共通部品・テーマの箱(R3)
     real3d_sky.js     空・遠景の山並み・環境光(PMREM)
     real3d_terrain.js 地面パッチとPBRテクスチャ
     real3d_water.js   海・川・オアシス・溶岩
     real3d_props.js   山と障害物(岩・木・水晶)
   ===================================================================== */
import * as THREE from './vendor/three.module.min.js';
import { R3, DEFAULT_THEME, SUN_DIR, heightAt } from './real3d_common.js';
import { buildSky, applySkyTheme, buildDistantRidge, buildEnvironment, animateSky } from './real3d_sky.js';
import { buildTerrain, updateTerrain, applyTerrainTheme, terrainStats, resetPatch } from './real3d_terrain.js';
import { buildZoneMesh, zoneMaterial, buildSeaMesh, buildRiverMesh, splitRivers,
         animateWater, lavaMats, resetDynamicLists, ZONE_LIFT } from './real3d_water.js';
import { buildMountainMesh, updateObstacles, obstacleCullDist, obstacleDrawn, resetObstacles } from './real3d_props.js';

// フォグはパッチの半分(3600)より手前で完全に霞ませる。こうしないとパッチの切れ目が見える
const FOG_NEAR = 700;
const FOG_FAR  = 3200;
const CAM_FAR  = 12000;
/* ---- PBR(物理ベース描画)の調整値 ----
   環境光は「空をそのままPMREMに通した環境マップ」(=HDRIの代わり。画像ファイルは増やさない)。
   ポストプロセス(SSAO/Bloom)は入れない。フルスクリーンのバッファを何枚も持つと
   iPhoneではメモリと帯域を大きく使うわりに、開けた地形では見た目がほとんど変わらないため。 */
// 太陽光。PBRなので従来のPhongより大きい値になる。
// 環境光(real3d_common.jsのENV_INTENSITY)を下げたぶんここで明るさを取り戻す。
// この2つの比が「日向と日陰の差」そのものなので、必ず対で調整すること。
const SUN_INTENSITY = 4.6;
const EXPOSURE      = 1.15;  // ACESフィルミックトーンマッピングの露出
const SHADOW_MAP    = 1024;  // 影の解像度。上げるとくっきりするがiPhoneでは重い
const SHADOW_HALF   = 900;   // 影を計算する範囲(この四角の中だけ影が落ちる)
const SHADOW_AHEAD  = 420;   // 影の範囲の中心をカメラの前方へずらす量

const COL_SKY_BOT = DEFAULT_THEME.skyBot;   // 初期化時のクリア色にだけ使う
const COL_HAZE    = DEFAULT_THEME.haze;

let renderer = null, scene = null, camera = null;
let terrain = null, sky = null, ridge = null, sun = null;
let envRT = null;                        // 空から作った環境マップ(PMREM)
let active = false, failed = false;

function ensureScene(){
  if(scene || failed) return !!scene;
  try{
    const cv = document.getElementById('glCanvas');
    if(!cv) { failed = true; return false; }
    renderer = new THREE.WebGLRenderer({ canvas:cv, antialias:true, alpha:false });
    renderer.setClearColor(COL_SKY_BOT, 1);
    // 色管理: テクスチャはsRGB、計算はリニア、出力はsRGB。ポストプロセスを挟まないので
    // MSAA(antialias:true)がそのまま効き、トーンマッピングもrenderer側で完結する
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = EXPOSURE;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(COL_HAZE, FOG_NEAR, FOG_FAR);
    camera = new THREE.PerspectiveCamera(64, 1, 8, CAM_FAR);
    // 空 → 遠景の山 → 地形 の順で必ず塗る。空も山も深度を書かないため、
    // 描画順が入れ替わると遠くの山が空に消される(renderOrderで固定する)
    sky = buildSky();   sky.renderOrder = -2;   scene.add(sky);
    ridge = buildDistantRidge(); ridge.renderOrder = -1; scene.add(ridge);
    terrain = buildTerrain();
    scene.add(terrain);
    // 環境光は空そのもの(HDRIの代わり)。半球ライトは環境マップが担うので置かない
    applyEnvironment();
    sun = new THREE.DirectionalLight(0xfff1d6, SUN_INTENSITY);
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    sun.shadow.camera.left = -SHADOW_HALF; sun.shadow.camera.right = SHADOW_HALF;
    sun.shadow.camera.top  =  SHADOW_HALF; sun.shadow.camera.bottom = -SHADOW_HALF;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 4200;
    /* 影のにじみ・自己影(縞)対策。
       【重要】normalBias を大きくしすぎると影が「消える」。3 にしていた頃は
       影を完全に切っても画の平均差が0.16/255しか出ない = 事実上影が無い状態だった
       (地形は起伏が緩く自己影がほとんど出ないので、地形に合わせて大きく取る必要が無い)。
       草や小石のような小さい物の接地影はこの値で決まるので、小さめにする。 */
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    scene.add(sun);
    scene.add(sun.target);
    return true;
  }catch(err){
    console.error('[aramon] WebGLの初期化に失敗しました。従来の描画にフォールバックします', err);
    failed = true; scene = null;
    return false;
  }
}

function applyEnvironment(){
  if(!renderer || !scene) return;
  envRT = buildEnvironment(renderer, envRT);
  scene.environment = envRT.texture;
}

/* ---- 大きな物(火山・雪山・森・ピラミッド)と地面のしみ(溶岩・海・川・オアシス) ----
   これらは2Dで描くと「起伏のある地面に平らな楕円が貼り付く」形になって浮くので、
   リアルマップでは3D側で地形に沿わせて描く(2D側は描画をやめる)。              */
let worldGroup = null, worldSig = '';

// 中身が変わったときだけ作り直すための署名(試合ごとに1回)
function worldSignature(w){
  if(!w) return '';
  const part = (arr)=>{
    if(!arr || !arr.length) return '0';
    const f = arr[0], l = arr[arr.length-1];
    return arr.length+':'+Math.round(f.x)+','+Math.round(f.y)+','+Math.round(l.x)+','+Math.round(l.y);
  };
  return [part(w.volcanoes), part(w.lava), part(w.sea), part(w.river), part(w.oasis), w.seaEdge?'s':'-'].join('|');
}

function buildWorldObjects(w){
  if(worldGroup){
    // 材質は種類ごとに共有しているものがあるので、共有印の無いものだけ捨てる
    worldGroup.traverse(o=>{
      if(!o.isMesh) return;
      o.geometry.dispose();
      if(!o.material.userData.shared) o.material.dispose();
    });
    scene.remove(worldGroup);
  }
  worldGroup = new THREE.Group();
  resetDynamicLists();   // 溶岩の材質・水面シェーダーの登録をやり直す
  (w.volcanoes||[]).forEach(v=> worldGroup.add(buildMountainMesh(v)));
  // オアシスは濡れた砂の縁を先に敷いてから水面を重ねる(2Dと同じ見せ方)
  (w.oasis||[]).forEach(z=>{
    worldGroup.add(buildZoneMesh(z, zoneMaterial('sand'), z.radius*1.12, ZONE_LIFT*0.6));
    worldGroup.add(buildZoneMesh(z, zoneMaterial('oasis'), z.radius, ZONE_LIFT));
  });
  // 海と川は円を並べず、1枚のつながった水面として張る
  if(w.seaEdge && (w.sea||[]).length) worldGroup.add(buildSeaMesh(w.seaEdge, (w.bounds && w.bounds.h) || 18100));
  if((w.river||[]).length) splitRivers(w.river).forEach(ch=> worldGroup.add(buildRiverMesh(ch)));
  if((w.lava||[]).length){
    const lavaMat = zoneMaterial('lava');   // 材質は全部の溶岩で共有(脈動もまとめて効く)
    lavaMats.push(lavaMat);
    w.lava.forEach(z=> worldGroup.add(buildZoneMesh(z, lavaMat, z.radius, ZONE_LIFT)));
  }
  scene.add(worldGroup);
}

function updateWorldObjects(w){
  if(!scene) return;
  const sig = worldSignature(w);
  if(sig === worldSig) return;
  worldSig = sig;
  if(!sig){ if(worldGroup){ scene.remove(worldGroup); worldGroup = null; } return; }
  buildWorldObjects(w);
}

/* マップが変わったときに、空・霞・地面の色・遠景の山をそのマップのテーマへ差し替える。
   地形メッシュそのものは使い回し、色(頂点カラー)とテクスチャだけ作り直す。   */
let appliedTheme = null;
function applyTheme(){
  if(!scene || appliedTheme === R3.theme) return;
  appliedTheme = R3.theme;
  renderer.setClearColor(R3.theme.skyBot, 1);
  scene.fog.color.setHex(R3.theme.haze);
  applySkyTheme(sky);
  applyTerrainTheme();
  applyEnvironment();   // 空の色が変わったので環境光も作り直す
  // 遠景の山は色を頂点に焼き込んでいるので作り直す(三角形数は少ないので毎試合1回で十分)
  if(ridge){
    scene.remove(ridge);
    ridge.geometry.dispose();
    ridge = buildDistantRidge();
    ridge.renderOrder = -1;
    scene.add(ridge);
  }
}

function applySize(){
  if(!renderer) return;
  const w = window.viewW || 1, h = window.viewH || 1;
  // 2Dキャンバスと同じ描画倍率を使う(world.jsが負荷に応じて動かす)
  renderer.setPixelRatio(window.__aramonRenderScale || Math.min(window.devicePixelRatio || 1, 2));
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
      R3.theme = window.__aramonRealTheme || DEFAULT_THEME;   // マップごとの見た目(data.jsのREAL3D_THEMES)
      if(!ensureScene()){ if(cv) cv.classList.add('hidden'); active = false; return false; }
      applyTheme();
      if(cv) cv.classList.remove('hidden');
      resetPatch();      // 次のrenderで作り直す
      worldSig = '';     // 山としみも作り直す(マップが変わると地面の高さが変わるため)
      resetObstacles();  // 障害物も同じ理由で作り直す
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
  // 障害物を実際に出している距離。2D側はこれより遠い障害物をくり抜かない
  obstacleCullDist,
  // 計測用: 直近の地形パッチ再計算(計算した頂点数と所要ms)と、その回数
  stats(){ return { ...terrainStats(), obst:obstacleDrawn() }; },
  // 毎フレーム、2Dの描画より先に呼ぶ。カメラは2Dのproject()と同じ値から作る。
  // obstacles には障害物の配列(world.jsのrocks)を渡す = 3Dモデルで描く。
  // world には山・地面のしみ・水晶({volcanoes, lava, sea, river, oasis, crystals})を渡す
  render(obstacles, world){
    if(!active || !scene) return false;
    const cp = window.camPos, cs = window.camState;
    if(!cp || !cs) return false;
    // 視野角は2Dのproject()(world.jsのFOV_V)と必ず同じ値にする。設定で変えられるので毎フレーム見る
    const fovDeg = (window.__aramonLook && window.__aramonLook.fovDeg) || 64;
    if(camera.fov !== fovDeg){ camera.fov = fovDeg; camera.updateProjectionMatrix(); }
    updateTerrain(cp.x, cp.y);
    updateWorldObjects(world);
    updateObstacles(scene, obstacles, world && world.crystals, cp.x, cp.y);
    const tSec = performance.now()*0.001;
    animateWater(tSec);
    animateSky(tSec);   // 雲を風で流す(空のuniformを進めるだけ)
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
    // 影の計算範囲はカメラの少し前方に置く。ワールド全体を1枚の影で覆うと
    // 解像度が足りずガビガビになるので、プレイヤー周辺だけを高い密度で覆う
    if(sun){
      const fx = cp.x + Math.cos(cs.yaw)*SHADOW_AHEAD;
      const fy = cp.y + Math.sin(cs.yaw)*SHADOW_AHEAD;
      const fz = heightAt(fx, fy);
      sun.target.position.set(fx, fz, fy);
      sun.position.set(fx + SUN_DIR.x*2200, fz + SUN_DIR.y*2200, fy + SUN_DIR.z*2200);
    }
    renderer.render(scene, camera);
    return true;
  },
};
window.__aramonReal3D = api;
