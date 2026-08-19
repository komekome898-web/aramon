let entities = [];
let rocks = [];
let volcanoObstacles = [];
let lavaZones = [];
let crystalObstacles = [];
let riverZones = [];
let seaZones = [];
let oasisZones = [];
let currentMap = MAPS.wild;
let projectiles = [];
let areaEffects = [];
let pendingAoeCasts = []; // AoE技(aoeShape)でburst>1のときの2発目以降の発射待ちキュー(ピクシー「ライトニング」等)
let lootItems = [];
let particles = [];
let terrainDecor = [];
let nextId = 1;
let player = null;
let matchTime = 0;
let zoneState = null;
let game = { started:false, over:false, tipTimer:7, selectedElement:null, selectedMap:'random', realMapMode:false, autoRun:false, trainingRange:false, raid:false,
             teamSize:1,     // 1=個人戦(従来どおり)。2以上でチーム戦。書くのは teamResetState()/assignTeams()(combat.js)だけ
             arena:false,    // バトルアリーナ(3v3・1本勝負)中か。書くのは arenaResetState()(combat.js)と試合開始の各入口だけ
             tutorialMatch:false }; // チュートリアルの練習試合中か。書くのは startGame() だけ(体数・マップ・安置・botの強さがここで変わる)

/* 視点操作の設定(視野角・左右/上下の感度)。射撃訓練場の「視点設定」から変更でき、
   バトルにもそのまま反映される。値の保存はui.js(localStorage)、視野角はreal3d.jsが
   window.__aramonLook から読んで3D側のカメラにも同じ角度を設定する。          */
const LOOK_DEFAULTS = { fovDeg:64, sensX:0.0045, sensY:0.0018 };
const LOOK_LIMITS   = { fovDeg:[45,85], sensX:[0.0015,0.0090], sensY:[0.0006,0.0045] };
let lookSettings = { ...LOOK_DEFAULTS };
window.__aramonLook = lookSettings;
let FOV_V = LOOK_DEFAULTS.fovDeg*Math.PI/180;
let FOCAL = 600;
// 設定を変えたら必ず呼ぶ(視野角→FOCAL。3D側は毎フレームwindow.__aramonLookを見る)
function applyLookSettings(){
  FOV_V = lookSettings.fovDeg*Math.PI/180;
  recomputeFocal();
}
// TPS視点のカメラ配置。distBehindを小さくすると自分のモンスターが大きく見える。
// heightを下げると画面内で上に動くので、寄せたぶんを打ち消して自分のモンスターの
// 画面上の位置(足元Y)と地平線の高さを従来どおりに保っている(見た目だけ約1.35倍)。
// 数値を変えたら、足元が下の技フィールドに隠れないかを確認すること。
const CAM_DIST_BEHIND = 145; // 以前は190
const CAM_HEIGHT      = 90;  // 以前は120
let camState = { yaw:0, pitch:0.27, height:CAM_HEIGHT, distBehind:CAM_DIST_BEHIND };
// 視点の上下の可動範囲。pitchが大きいほど下を向く(0.05でほぼ水平)。
// リアルマップは弾が視線方向へ飛ぶので、遠くや丘の上をねらえるよう空側(マイナス)まで振れる。
// 通常マップは従来どおりの範囲を維持する(弾道も水平のまま変わらない)。
const CAM_PITCH_MIN        = 0.05;
const CAM_PITCH_MIN_REAL3D = -0.42;
const CAM_PITCH_MAX        = 0.55;
function camPitchMin(){ return (currentMap && currentMap.real3d) ? CAM_PITCH_MIN_REAL3D : CAM_PITCH_MIN; }
// 試合開始時の視点角度。リアルマップは弾が視線方向へ飛ぶため、既定では遠くをねらえる角度から始める
const CAM_PITCH_START        = 0.27;
const CAM_PITCH_START_REAL3D = 0.15;
function applyStartPitchForMap(){
  camState.pitch = (currentMap && currentMap.real3d) ? CAM_PITCH_START_REAL3D : CAM_PITCH_START;
}
let camPos = { x:0, y:0, z:0 };
// real3d.js(ESモジュール)からカメラを読むための橋渡し。参照を渡すので中身は常に最新
window.camPos = camPos; window.camState = camState;
let camSnap = { active:false, fromYaw:0, toYaw:0, t:0, duration:0.28 };
// 召喚演出(試合開始時の5秒カウントダウン)。この間は視点操作のみ可能で、
// matchTime・状態変化クールタイム・ゾーン等は一切進行しない(演出後に本戦開始)。
const SUMMON_INTRO_DURATION = 5;
let introState = { active:false, timer:0, duration:SUMMON_INTRO_DURATION, chupiinPlayed:false, shuwaaPlayed:false, impactDone:false };
let monsterScreenPos = new Map();
function recomputeFocal(){ FOCAL = (viewH/2) / Math.tan(FOV_V/2); }

function getEntity(id){ return entities.find(e=>e.id===id); }

/* =====================================================================
   CANVAS SETUP
===================================================================== */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const miniCanvas = document.getElementById('minimapCanvas');
const miniCtx = miniCanvas.getContext('2d');
/* 描画解像度。端末の実解像度(最大2倍)を上限に、重いときだけ自動で下げる。
   ・上限を変えないので、余裕のある端末の見た目は今までと同じ
   ・フレーム時間を見て render.js の updateRenderScale() が renderScale を動かす */
const DPR_MAX = Math.min(window.devicePixelRatio||1, 2);
const DPR_MIN = Math.max(1, DPR_MAX*0.55);   // これ以上は下げない(文字がにじむため)
let renderScale = DPR_MAX;
let dpr = renderScale;
window.__aramonRenderScale = renderScale;
// 描画解像度を変える(レイアウトは変えないのでキャンバスの実ピクセル数だけが変わる)
function setRenderScale(s){
  const v = Math.max(DPR_MIN, Math.min(DPR_MAX, s));
  if(Math.abs(v - renderScale) < 0.02) return false;
  renderScale = v; dpr = v;
  window.__aramonRenderScale = v;
  resize();
  return true;
}
let viewW=window.innerWidth, viewH=window.innerHeight;

// ===== 強制横向き表示(向きロック中でも横向きでプレイできるようにするCSS回転トリック) =====
// スマホ・小型タブレットが縦長(portrait)のときは、#appRootをCSSで90度回転させて
// 横向きの画面として描画する。実際のブラウザviewportは縦長のままなので、
// キャンバスサイズや各種ポインタ座標は「回転後の論理座標」に変換して使う必要がある。
const FORCE_LANDSCAPE_MAX_SIDE = 1000; // このサイズ以下の小画面のみ対象(PC・タブレットの縦長は対象外)
const appRootEl = document.getElementById('appRoot');
// 向きの判定はメディアクエリで行う。実測pxは起動直後に確定していないことがあり、
// その値で判定すると「縦持ちで起動したのに強制横向きが効かない」状態のまま固定されてしまう。
const _mqPortrait = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;
/* ソフトキーボードで縮んだ visualViewport を「画面の大きさ」として採らないための下限。
   iOSはキーボードを出すと visualViewport だけが縮み、レイアウトviewport(innerHeight)は
   変わらない。アドレスバーぶんの差は1割程度、キーボードは横向きで画面の4〜6割を占めるので
   3/4を境にすれば取り違えない。 */
const VV_KEYBOARD_RATIO = 0.75;
function getRealViewportSize(){
  const vv = window.visualViewport;
  const iw = window.innerWidth || 0, ih = window.innerHeight || 0;
  let w = vv ? vv.width : 0, h = vv ? vv.height : 0;
  /* 【キーボードで縮んだ値をレイアウトに使わない】これを採ると --vh が小さいまま
     焼き付き、キーボードを閉じても戻らない(「マスモンの名前を変えたあとキャラが
     小さくなり、モンスター選択のポップアップが途切れる」として2度報告された)。
     ポップアップを開いている間 resize() を素通りさせる対策だけでは足りなかった:
     閉じた瞬間に呼び直す resize() が、まだ閉じ切っていないキーボードの寸法を拾っていた。
     **ここで採らないようにすれば、いつ resize() が走っても縮んだ値は入らない。** */
  if(h > 0 && ih > 0 && h < ih*VV_KEYBOARD_RATIO) h = ih;
  if(w > 0 && iw > 0 && w < iw*VV_KEYBOARD_RATIO) w = iw;
  // 起動直後は visualViewport が 0 や未確定値を返すことがあるので順にフォールバックする
  if(!(w > 0) || !(h > 0)){ w = iw; h = ih; }
  if(!(w > 0) || !(h > 0)){ w = document.documentElement.clientWidth; h = document.documentElement.clientHeight; }
  return { w: w || 1, h: h || 1 };
}
// #appRootの回転前サイズ・位置をpx実測値で直接指定する。
// vw/vhだとモバイルブラウザのアドレスバー表示/非表示等で実際のviewportとズレて
// 画面の両端が見切れることがあるため、必ずgetRealViewportSize()と同じ値を使う。
function applyAppRootTransform(forced, real){
  if(!appRootEl) return;
  if(forced){
    appRootEl.style.width = real.h + 'px';
    appRootEl.style.height = real.w + 'px';
    appRootEl.style.left = real.w + 'px';
    appRootEl.style.top = '0px';
  } else {
    appRootEl.style.width = '';
    appRootEl.style.height = '';
    appRootEl.style.left = '';
    appRootEl.style.top = '';
  }
  // レイアウトで使う--vw/--vhも、回転後の論理サイズに合わせて更新する
  // (生のvw/vh単位は常に実際の縦向きviewport基準になってしまい、
  //  マスモン画面などの min(94vw,900px) 系レイアウトがズレる原因になるため)
  const logicalW = forced ? real.h : real.w;
  const logicalH = forced ? real.w : real.h;
  document.documentElement.style.setProperty('--vw', (logicalW/100)+'px');
  document.documentElement.style.setProperty('--vh', (logicalH/100)+'px');
  // 旧 @media (max-width:520px) の代わり。判定は「実画面の幅」で、旧メディアクエリと
  // 同じ条件をそのまま再現している(HUDの寸法はこの条件で調整済みなので変えない)。
  // クラスにしておけば、強制横向きで --vw/--vh とメディアクエリの基準が食い違う問題に
  // 巻き込まれず、JS側から意図した基準で切り替えられる。
  document.documentElement.classList.toggle('narrow-screen', real.w <= 520);
}
function updateForceLandscapeMode(){
  const real = getRealViewportSize();
  // 向きはメディアクエリを優先(実測pxはアドレスバーやキーボードで揺れる)
  const isPortrait = _mqPortrait ? _mqPortrait.matches : (real.h > real.w);
  // 画面の長辺は screen も見る。実測が未確定でも端末サイズで判定できるようにする
  const sw = (window.screen && window.screen.width) || 0;
  const sh = (window.screen && window.screen.height) || 0;
  const longSide = Math.max(sw, sh, real.w, real.h);
  const isSmallScreen = longSide <= FORCE_LANDSCAPE_MAX_SIDE;
  const shouldForce = isPortrait && isSmallScreen;
  document.documentElement.classList.toggle('force-landscape', shouldForce);
  applyAppRootTransform(shouldForce, real);
  return shouldForce;
}
function isForcedLandscape(){
  return document.documentElement.classList.contains('force-landscape');
}
// 実際のポインタ座標(縦向きの実画面上の座標)を、回転補正した論理(横向き)座標へ変換
function toLogicalPoint(clientX, clientY){
  if(!isForcedLandscape()) return { x:clientX, y:clientY };
  const real = getRealViewportSize();
  return { x: clientY, y: real.w - clientX };
}
// 実際のポインタ移動量(縦向きの実画面上のdx,dy)を、回転補正した論理(横向き)の移動量へ変換
function toLogicalDelta(dx, dy){
  if(!isForcedLandscape()) return { x:dx, y:dy };
  return { x: dy, y: -dx };
}

function getViewportSize(){
  const forced = updateForceLandscapeMode();
  const real = getRealViewportSize();
  if(forced) return { w: real.h, h: real.w };
  return real;
}
function resize(){
  /* 文字入力ポップアップ(#textInputOverlay)を開いている間はレイアウトを作り直さない。
     iOSはソフトキーボードの開閉でvisualViewportが縮む/戻るたびにresizeイベントが飛び、
     特に横向きでは縮み幅が大きいため、そのままレイアウトへ反映すると画面全体が縮んで
     見える不具合になる(マスモン編集で名前を変えると画面が崩れる、として報告があった)。
     ポップアップはどのみち画面を覆うので、開いている間は前の寸法のまま固定してよい。
     閉じた瞬間(input.jsのcloseTextInputPopup)に必ずresize()を呼び直して復元する
     ("キーボードを閉じたのにvisualViewport.resizeが来ない"iOSの取りこぼしにも頼らない)。 */
  const kbOverlay = document.getElementById('textInputOverlay');
  if(kbOverlay && !kbOverlay.classList.contains('hidden')) return;
  const vp = getViewportSize();   // ここで向きの判定と html.force-landscape の付け外しも行われる
  viewW = vp.w; viewH = vp.h;
  // キャンバス側で失敗しても、向きの判定だけは必ず済んでいる状態にする
  try{
    canvas.width = viewW*dpr; canvas.height = viewH*dpr;
    canvas.style.width = viewW+'px'; canvas.style.height = viewH+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    recomputeFocal();
    // ESモジュール(real3d.js)からはトップレベルのletが見えないのでwindowに出す
    window.viewW = viewW; window.viewH = viewH;
    if(window.__aramonReal3D) window.__aramonReal3D.resize();
    if(window.__aramonFxGl) window.__aramonFxGl.resize();
    // HUD配置(割合保存)を新しいサイズへ再反映。ただし編集中は触らない。
    if(typeof applyHudLayout==='function' && !document.documentElement.classList.contains('hud-editing')) applyHudLayout();
    // リザルトを開いたまま向きが変わると縦幅が変わるので、収まり具合を測り直す
    if(typeof fitResultScreen==='function') fitResultScreen();
    // ロビーの左メニューは「画面に入る行数」で組んでいるので、高さが変わったら組み直す
    if(typeof updateLobbyMenuRows==='function') updateLobbyMenuRows();
  }catch(err){ console.error('[aramon] resize失敗', err); }
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', ()=>{
  resize();
  setTimeout(resize, 60);
  setTimeout(resize, 250);
  setTimeout(resize, 500);
});
if(window.visualViewport){
  window.visualViewport.addEventListener('resize', resize);
}
// 向きの変化をメディアクエリでも拾う(iOSのorientationchangeは取りこぼすことがある)
if(_mqPortrait){
  if(_mqPortrait.addEventListener) _mqPortrait.addEventListener('change', resize);
  else if(_mqPortrait.addListener) _mqPortrait.addListener(resize);
}
// 起動直後はviewportが確定していないことがあるため、読み込み完了と数回のタイマーで必ず再判定する
// (これが無いと「縦持ちで起動したときだけ強制横向きが効かない」状態が残る)
['DOMContentLoaded','load','pageshow'].forEach(ev=> window.addEventListener(ev, resize));
[50, 150, 400, 900, 2000].forEach(ms=> setTimeout(resize, ms));
resize();

/* =====================================================================
   ZONE
===================================================================== */
/* レイドの安置。闘技場そのものが狭いので、外周ぎりぎりから始めて制限時間いっぱいで
   中心近くまでゆっくり縮める。逃げ場が減っていくぶん、後半ほど被弾しやすくなる。 */
function initRaidZone(){
  const cx = WORLD.w/2, cy = WORLD.h/2;
  const r0 = Math.min(WORLD.w, WORLD.h)/2 - RAID_ARENA_MARGIN;
  zoneState = {
    phaseIndex:0, timer:0, shrinking:true, hasNext:false,
    center:{x:cx,y:cy}, radius:r0,
    fromCenter:{x:cx,y:cy}, fromRadius:r0,
    toCenter:{x:cx,y:cy}, toRadius:r0*0.42,
  };
}
// レイドの安置の進み具合。時間に対して線形に縮めるだけ(フェーズを持たない)
function updateRaidZone(dt){
  zoneState.timer += dt;
  const t = clamp(matchTime/RAID_TIME_LIMIT, 0, 1);
  zoneState.radius = lerp(zoneState.fromRadius, zoneState.toRadius, t);
}
/* バトルアリーナの安置。既存マップの中央に最初から小さく固定し、
   開始 ARENA_ZONE_HOLD_SEC 秒後から1段階だけゆっくり決着圏へ縮める。中心は動かさない。
   縮小先(toCenter/toRadius)を最初から入れておくので、安置予測の点線が開始直後から出る。
   マルチではホストのzoneStateがそのまま同期されるので、ゲスト側の追加処理は要らない。 */
function initArenaZone(){
  const c = { x: ZONE_CENTER0.x, y: ZONE_CENTER0.y };
  zoneState = {
    phaseIndex:0, timer:0, shrinking:false, hasNext:true,
    center:{...c}, radius: ARENA_ZONE_RADIUS,
    fromCenter:{...c}, fromRadius: ARENA_ZONE_RADIUS,
    toCenter:{...c}, toRadius: ARENA_ZONE_END_RADIUS,
  };
}
// アリーナの安置の進み具合。待機→1段階の縮小→安定(それ以降は動かない)
function updateArenaZone(dt){
  zoneState.timer += dt;
  if(zoneState.shrinking){
    const t = clamp(zoneState.timer/ARENA_ZONE_SHRINK_SEC, 0, 1);
    const e = 1-Math.pow(1-t,2);
    zoneState.radius = lerp(zoneState.fromRadius, zoneState.toRadius, e);
    if(t>=1){ zoneState.shrinking=false; zoneState.hasNext=false; zoneState.timer=0; }
  } else if(zoneState.hasNext && zoneState.timer >= ARENA_ZONE_HOLD_SEC){
    zoneState.fromRadius = zoneState.radius;
    zoneState.shrinking = true;
    zoneState.timer = 0;
    pushToast('安全圏が縮小を開始した！');
  }
}
function initZone(){
  zoneState = {
    phaseIndex:0, timer:0, shrinking:false, hasNext:false,
    center:{...ZONE_CENTER0}, radius: ZONE_PHASES[0].holdRadius,
    fromCenter:{...ZONE_CENTER0}, fromRadius: ZONE_PHASES[0].holdRadius,
    toCenter:{...ZONE_CENTER0}, toRadius: ZONE_PHASES[0].holdRadius,
  };
  prepareNextZoneTarget();
}
// 安定フェーズに入った時点で次の縮小先を先に決めておく。
// これにより安定中から次回の安置予測(toCenter/toRadius)を点線で表示でき、
// 縮小開始時(advanceZonePhase)はこの事前決定値をそのまま使う。
function prepareNextZoneTarget(){
  const nextIndex = zoneState.phaseIndex+1;
  if(nextIndex >= ZONE_PHASES.length){ zoneState.hasNext = false; return; }
  zoneState.toCenter = pickZoneTarget(zoneState.center, zoneState.radius, ZONE_PHASES[nextIndex].holdRadius);
  zoneState.toRadius = ZONE_PHASES[nextIndex].holdRadius;
  zoneState.hasNext = true;
}
function pickZoneTarget(prevCenter, prevRadius, nextRadius){
  const maxOff = Math.max(0, prevRadius - nextRadius);
  for(let tries=0; tries<20; tries++){
    const a = rand(0, Math.PI*2), d = rand(0, maxOff*0.75);
    let x = prevCenter.x + Math.cos(a)*d;
    let y = prevCenter.y + Math.sin(a)*d;
    x = clamp(x, nextRadius+40, WORLD.w-nextRadius-40);
    y = clamp(y, nextRadius+40, WORLD.h-nextRadius-40);
    if(currentMap.hasVolcano){
      let insideAny = false;
      for(const v of volcanoObstacles){
        if(!v.isMain) continue;
        if(Math.hypot(x-v.x, y-v.y) < mountainGroundRadius(v) + nextRadius*0.5 + 300){ insideAny = true; break; }
      }
      if(insideAny) continue;
    }
    if(currentMap.hasSea && isInSea(x, y, nextRadius*0.4)) continue;
    return {x,y};
  }
  // 回避に失敗した場合はそのまま返す(無限ループ防止)
  const a = rand(0, Math.PI*2), d = rand(0, maxOff*0.75);
  let x = clamp(prevCenter.x + Math.cos(a)*d, nextRadius+40, WORLD.w-nextRadius-40);
  let y = clamp(prevCenter.y + Math.sin(a)*d, nextRadius+40, WORLD.h-nextRadius-40);
  return {x,y};
}
function advanceZonePhase(){
  const newIndex = zoneState.phaseIndex+1;
  if(newIndex >= ZONE_PHASES.length) return false;
  zoneState.fromCenter = {...zoneState.center};
  zoneState.fromRadius = zoneState.radius;
  // 縮小先は安定フェーズ開始時に事前決定済み(prepareNextZoneTarget)。未決定なら念のためここで決める
  if(!zoneState.hasNext){
    zoneState.toCenter = pickZoneTarget(zoneState.center, zoneState.radius, ZONE_PHASES[newIndex].holdRadius);
    zoneState.toRadius = ZONE_PHASES[newIndex].holdRadius;
  }
  zoneState.phaseIndex = newIndex;
  zoneState.timer = 0;
  zoneState.shrinking = true;
  const beforeCount = lootItems.length;
  spawnLoot(Math.round(30 * mutSpawnMultSafe()), zoneState.toCenter, zoneState.toRadius*0.8);
  // マルチプレイではこの関数はホストでしか呼ばれないため、新規に生成したアイテムを
  // ゲスト側にも見えるよう明示的に配信する(ゲストはロビー開始時の初期アイテムしか
  // 自前生成しておらず、以降host側だけで増える分は届けないと見えないままになる)
  if(netState.mode==='multi' && netState.isHost){
    for(let i=beforeCount;i<lootItems.length;i++){
      const it = lootItems[i];
      window.__aramonPushLootEvent(netState.roomId, {
        evtType:'spawn', id:it.id, kind:it.kind, itemType:it.type, x:Math.round(it.x), y:Math.round(it.y), bob:it.bob,
      });
    }
  }
  pushToast('安全圏が縮小を開始した！');
  return true;
}
function updateZone(dt){
  zoneState.timer += dt;
  const ph = ZONE_PHASES[zoneState.phaseIndex];
  if(zoneState.phaseIndex===0){
    if(zoneState.timer >= ph.holdTime) advanceZonePhase();
    return;
  }
  if(zoneState.shrinking){
    const t = clamp(zoneState.timer/ph.shrinkTime, 0, 1);
    const e = 1-Math.pow(1-t,2);
    zoneState.center.x = lerp(zoneState.fromCenter.x, zoneState.toCenter.x, e);
    zoneState.center.y = lerp(zoneState.fromCenter.y, zoneState.toCenter.y, e);
    zoneState.radius = lerp(zoneState.fromRadius, zoneState.toRadius, e);
    if(t>=1){ zoneState.shrinking=false; zoneState.timer=0; prepareNextZoneTarget(); }
  } else {
    if(zoneState.timer >= ph.holdTime){ advanceZonePhase(); }
  }
}
// アリーナはフェーズ表を使わず常に一定の圏外ダメージ(通常の序盤より高め=逃げ回り防止)
function currentDps(){
  if(game.arena) return ARENA_ZONE_DPS;
  return ZONE_PHASES[zoneState.phaseIndex].dps;
}
function zoneLabel(){
  // アリーナはフェーズを持たないので、shrinking/hasNextだけで状態を言う
  // (どちらもマルチのauthStateで同期済みなのでゲストでも正しく出る)
  // アリーナはBRの語彙を使わない(「安全圏:待機中」は1本勝負では冗長で誤解を生む=批評指摘)
  if(game.arena) return zoneState.shrinking ? '決着圏へ縮小中' : (zoneState.hasNext ? '決着圏まで' : '決着圏');
  if(zoneState.phaseIndex===0) return '安全圏：待機中';
  return zoneState.shrinking ? '安全圏：縮小中' : '安全圏：安定';
}
// 次の収縮(または現在の収縮が終わるまで)の残り秒数。もう収縮しない最終フェーズでは null を返す
function zoneCountdownSeconds(){
  if(game.arena){
    if(zoneState.shrinking) return Math.max(0, ARENA_ZONE_SHRINK_SEC - zoneState.timer);
    if(zoneState.hasNext) return Math.max(0, ARENA_ZONE_HOLD_SEC - zoneState.timer);
    return null;   // 縮小済み。以後は動かない
  }
  const ph = ZONE_PHASES[zoneState.phaseIndex];
  if(zoneState.shrinking){
    return Math.max(0, ph.shrinkTime - zoneState.timer);
  }
  if(zoneState.phaseIndex >= ZONE_PHASES.length-1) return null;
  return Math.max(0, ph.holdTime - zoneState.timer);
}

/* =====================================================================
   ENTITY FACTORY
===================================================================== */
// 「地面そのもの」の高さ。リアルマップでは起伏を返す。
// 岩・水晶の当たり判定が「登っているか」を見るときの基準にもなる
function baseTerrainHeightAt(x,y){
  return (currentMap && currentMap.real3d && typeof real3dHeightAt==='function') ? real3dHeightAt(x,y) : 0;
}
function getTerrainHeightAt(x,y){
  return baseTerrainHeightAt(x,y);
}
function blockedByHeight(m,x,y){
  return getTerrainHeightAt(x,y) > m.z + CLIMB_TOLERANCE;
}
function blockedByRock(m,x,y){
  // 建物の上に登っているときだけ岩をすり抜ける。起伏で z が上がっても効くよう地面基準で見る
  if(m.z > baseTerrainHeightAt(m.x,m.y) + 25) return false;
  for(const r of rocks){
    if(Math.hypot(x-r.x, y-r.y) < r.radius+m.radius) return true;
  }
  return false;
}
function blockedByVolcano(m,x,y){
  /* 火山(雪山/森/ピラミッド含む)は高さに関係なく(飛び越え不可)常にブロックする。
     広さは mountainGroundRadius() を使う。v.radius をそのまま使うと、裾を地面へ
     埋めてあるぶん見えている山肌より外側で止まり「見えない壁」になる。 */
  for(const v of volcanoObstacles){
    if(Math.hypot(x-v.x, y-v.y) < mountainGroundRadius(v)+m.radius) return true;
  }
  return false;
}
function blockedByCrystal(m,x,y){
  if(m.z > baseTerrainHeightAt(m.x,m.y) + 25) return false;
  for(const c of crystalObstacles){
    if(Math.hypot(x-c.x, y-c.y) < c.radius+m.radius) return true;
  }
  return false;
}
function blockedAt(m,x,y){
  return blockedByHeight(m,x,y) || blockedByRock(m,x,y) || blockedByVolcano(m,x,y) || blockedByCrystal(m,x,y);
}
// 目標地点(tx,ty)でmをブロックする円形障害物について、現在位置から見た外向きの合成法線を返す。
// (法線を現在位置基準で取ることで、接線すべり後も円の外側に留まりやすくする)
function obstacleNormalAt(m,tx,ty){
  let nx=0, ny=0;
  const add=(cx,cy,r)=>{ if(Math.hypot(tx-cx,ty-cy) < r+m.radius){ const ox=m.x-cx, oy=m.y-cy; const d=Math.hypot(ox,oy)||0.0001; nx+=ox/d; ny+=oy/d; } };
  if(m.z<=25){ for(const rk of rocks) add(rk.x,rk.y,rk.radius); }
  for(const v of volcanoObstacles) add(v.x,v.y,mountainGroundRadius(v));
  if(m.z<=25){ for(const c of crystalObstacles) add(c.x,c.y,c.radius); }
  const nl=Math.hypot(nx,ny);
  if(nl<0.0001) return null;
  return {x:nx/nl, y:ny/nl};
}
// 円形障害物にめり込んでいたら境界の外へ少しずつ押し出す(ノックバックや押し合いでのハマり防止)
function depenetrateObstacles(m){
  let ox=0, oy=0, depth=0;
  const consider=(cx,cy,r)=>{ const ddx=m.x-cx, ddy=m.y-cy; const d=Math.hypot(ddx,ddy)||0.0001; const pen=(r+m.radius)-d; if(pen>depth){ depth=pen; ox=ddx/d; oy=ddy/d; } };
  if(m.z<=25){ for(const rk of rocks) consider(rk.x,rk.y,rk.radius); }
  for(const v of volcanoObstacles) consider(v.x,v.y,mountainGroundRadius(v));
  if(m.z<=25){ for(const c of crystalObstacles) consider(c.x,c.y,c.radius); }
  if(depth>0.5){
    const step = Math.min(depth, Math.max(6, m.radius)); // 一気にワープさせない
    m.x = clamp(m.x + ox*step, m.radius, WORLD.w-m.radius);
    m.y = clamp(m.y + oy*step, m.radius, WORLD.h-m.radius);
  }
}
/* 【最後の安全弁】このフレームで「めり込みの解消をまだ通していない」エンティティを押し出す。
   めり込みを直しているのは tryMoveAxis の冒頭1か所だけなので、**動かなかった者は永久に
   埋まったまま**になる。実際に起きていたのは次の2つ:
     ・botは射程内の相手を撃っている間 mustMove=false で tryMoveAxis を呼ばない
       (岩の中に立ったまま撃ち続ける=「障害物の中で動かない敵」)
     ・separateEntities() は座標を直接足し引きするので、押し合いで岩の中へ入れてしまう
   毎フレーム全員を走査すると岩(最大800個)の総当たりが1回増えるので、
   **必要な者だけ**(tryMoveAxisを通らなかった/押し合いで動かされた)に絞る。
   レイドボスは除く: 予告中に動くと予告の輪と実際の攻撃位置がずれる。 */
function depenetrateStuckEntities(){
  for(const e of entities){
    if(!e.alive || !e.needsDepenetrate) continue;
    e.needsDepenetrate = false;
    if(e.isRaidBoss) continue;
    const px = e.x, py = e.y;
    depenetrateObstacles(e);
    if(e.x!==px || e.y!==py) e.z = getTerrainHeightAt(e.x, e.y);
  }
}
function tryMoveAxis(m, dx, dy){
  // まず現在位置のめり込みを解消(高さブロックには影響しない)
  depenetrateObstacles(m);
  m.needsDepenetrate = false;   // ここを通った者は解消済み(depenetrateStuckEntitiesが二度手間をしない)
  const fullX = clamp(m.x+dx, m.radius, WORLD.w-m.radius);
  const fullY = clamp(m.y+dy, m.radius, WORLD.h-m.radius);
  if(!blockedAt(m,fullX,fullY)){
    m.x = fullX; m.y = fullY;
    m.z = getTerrainHeightAt(m.x, m.y);
    return;
  }
  // 円形障害物への接触時は、法線方向(内向き)成分を除いた「接線すべり」でなめらかに回り込む。
  // 斜めに突っ込むと縦横スライドの両方が塞がれて動けなくなる=スタックの主因を解消する。
  const n = obstacleNormalAt(m, fullX, fullY);
  if(n){
    const dot = dx*n.x + dy*n.y;
    const sx = dx - dot*n.x, sy = dy - dot*n.y; // 接線成分だけ残す
    if(sx!==0 || sy!==0){
      const sfx = clamp(m.x+sx, m.radius, WORLD.w-m.radius);
      const sfy = clamp(m.y+sy, m.radius, WORLD.h-m.radius);
      if(!blockedAt(m,sfx,sfy)){ m.x=sfx; m.y=sfy; m.z=getTerrainHeightAt(m.x,m.y); return; }
    }
  }
  // フォールバック: 従来の縦横スライド
  const onlyX = clamp(m.x+dx, m.radius, WORLD.w-m.radius);
  if(!blockedAt(m,onlyX,m.y)) m.x = onlyX;
  const onlyY = clamp(m.y+dy, m.radius, WORLD.h-m.radius);
  if(!blockedAt(m,m.x,onlyY)) m.y = onlyY;
  m.z = getTerrainHeightAt(m.x, m.y);
}
const MIN_SPAWN_SEPARATION = 500;
// ===== 海/川(水域) =====
// 海はワールド左端に沿った波打つ境界線として、川は右側から海へ流れる帯状の円チェーンとして表現する。
// 座標(x,y)から境界線を求める部分は純粋な数式なので、シード無しでもホスト/ゲスト間で常に一致する。
function seaEdgeX(y){
  if(!currentMap.hasSea) return -Infinity;
  const base = WORLD.w*(currentMap.seaWidthRatio||0.14);
  // マップの丸い外周に沿うように弧を描く湾。上下端ほど深く、縦方向の中央ほど浅くなる
  // (以前は中央が深い向きだったが、逆向きにして中央付近の可動域を広く保つ)
  const R = WORLD.h/2;
  const dy = clamp(y - R, -R, R);
  const bulge = 1 - Math.sqrt(Math.max(0, R*R - dy*dy)) / R; // 0(中央)〜1(上下端)
  return base + bulge*(WORLD.w*0.22) + Math.sin(y*0.0025+1.3)*40;
}
function isInSea(x,y,margin){
  if(!currentMap.hasSea) return false;
  return x < seaEdgeX(y) + (margin||0);
}
function isInRiverZones(x,y,margin){
  for(const rz of riverZones){ if(Math.hypot(x-rz.x,y-rz.y) < rz.radius+(margin||0)) return true; }
  return false;
}
function isInWater(x,y,margin){
  if(isInSea(x,y,margin)) return true;
  if(currentMap.hasRiver && isInRiverZones(x,y,margin)) return true;
  return false;
}
function isInOasisZone(x,y){
  if(!currentMap.hasOasis) return false;
  for(const oz of oasisZones){ if(Math.hypot(x-oz.x,y-oz.y) < oz.radius) return true; }
  return false;
}
// 地形による移動速度倍率(海/川/オアシスの中では移動が遅くなる)
function terrainSpeedMult(x,y){
  if(isInWater(x,y)) return WATER_SPEED_MULT;
  if(isInOasisZone(x,y)) return OASIS_SPEED_MULT;
  return 1;
}
function isOnHazard(x,y,margin){
  for(const v of volcanoObstacles){ if(Math.hypot(x-v.x,y-v.y) < mountainGroundRadius(v)+margin) return true; }
  for(const lz of lavaZones){ if(Math.hypot(x-lz.x,y-lz.y) < lz.radius+margin) return true; }
  if(isInWater(x,y,margin)) return true;
  return false;
}
function pickSpawnPoint(){
  const R = ZONE_PHASES[0].holdRadius*0.85;
  for(let tries=0; tries<60; tries++){
    // r=R*sqrt(u) にすることで円内に均等な密度で分布させる(単純なrand(0,R)は中心に偏る)
    const a = rand(0,Math.PI*2), r = R*Math.sqrt(rand(0,1));
    const x = ZONE_CENTER0.x+Math.cos(a)*r, y = ZONE_CENTER0.y+Math.sin(a)*r;
    if(isOnHazard(x,y,60)) continue;
    let onRock=false;
    for(const rk of rocks){ if(Math.hypot(x-rk.x,y-rk.y) < rk.radius+40){ onRock=true; break; } }
    if(onRock) continue;
    let tooCloseToOther=false;
    for(const e of entities){
      if(Math.hypot(x-e.x,y-e.y) < MIN_SPAWN_SEPARATION){ tooCloseToOther=true; break; }
    }
    if(tooCloseToOther) continue;
    return {x,y};
  }
  const a = rand(0,Math.PI*2), r = R*Math.sqrt(rand(0,1));
  return {x: ZONE_CENTER0.x+Math.cos(a)*r, y: ZONE_CENTER0.y+Math.sin(a)*r};
}
// n体分のスポーン地点を、安置内で角度方向にできるだけ均等に割り振って生成する。
// (1体ずつ完全ランダムに決めると、距離が近くなったり中心付近に偏ったりしやすいため、
//  まず円周をn等分した担当角度を割り当ててから、その範囲内でランダム性を持たせる)
function pickSpawnPointsBatch(n){
  const R = ZONE_PHASES[0].holdRadius*0.85;
  const angleStep = (Math.PI*2)/n;
  const angleOffset = rand(0, angleStep); // 毎回同じ並びにならないよう全体をランダム回転
  const points = [];
  for(let i=0;i<n;i++){
    const baseAngle = angleOffset + angleStep*i;
    let placed = null;
    for(let tries=0; tries<40 && !placed; tries++){
      const a = baseAngle + rand(-angleStep*0.4, angleStep*0.4);
      const r = R*Math.sqrt(rand(0,1));
      const x = ZONE_CENTER0.x+Math.cos(a)*r, y = ZONE_CENTER0.y+Math.sin(a)*r;
      if(isOnHazard(x,y,60)) continue;
      let onRock=false;
      for(const rk of rocks){ if(Math.hypot(x-rk.x,y-rk.y) < rk.radius+40){ onRock=true; break; } }
      if(onRock) continue;
      let tooClose=false;
      for(const p of points){ if(Math.hypot(x-p.x,y-p.y) < MIN_SPAWN_SEPARATION){ tooClose=true; break; } }
      if(tooClose) continue;
      placed = {x,y};
    }
    if(!placed){
      // 分離条件を満たす場所が見つからない場合は、担当角度の中心付近に妥協して配置する
      const r = R*0.6;
      placed = {x: ZONE_CENTER0.x+Math.cos(baseAngle)*r, y: ZONE_CENTER0.y+Math.sin(baseAngle)*r};
    }
    points.push(placed);
  }
  return points;
}
/* ===== チーム戦用スポーン =====
   チームごとに1つのアンカーを従来のバッチ関数で均等配置し、同チームのメンバーを
   アンカーの周りに隣接して並べる。返り値は「チーム0のメンバー…チーム1のメンバー…」の
   平坦な配列(エンティティ生成順=チーム割当順と同じ並び)。
   **ソロ用(pickTeamSpawnPointsBatch)とシード付き(seededPickTeamSpawnPointsBatch)は対。
   直すときは必ず両方直す**(spawnLoot/seededSpawnLootと同じ決まり)。 */
function teamPointsAroundAnchors(anchors, teamSize, rnd){
  const points = [];
  for(const an of anchors){
    for(let j=0;j<teamSize;j++){
      let placed = null;
      for(let tries=0; tries<24 && !placed; tries++){
        const a = (j/teamSize)*Math.PI*2 + rnd()*0.8;
        const d = TEAM_SPAWN_SPREAD*(0.6+rnd()*0.8);
        const x = an.x+Math.cos(a)*d, y = an.y+Math.sin(a)*d;
        // **岩・水晶も必ず見る。** isOnHazard が見るのは火山・溶岩・水だけなので、
        // ここだけ抜けていて**チーム戦のメンバーが岩の中に湧いていた**(個人戦の
        // pickSpawnPoint / pickSpawnPointsBatch は同じ +40 の余白で岩を避けている)
        if(isOnHazard(x,y,40) || isNearRock(x,y,40) || isNearCrystal(x,y,40)) continue;
        placed = {x,y};
      }
      // 置き場が見つからなければアンカーのすぐ横に妥協して置く(重なりはseparateEntitiesが直す)
      points.push(placed || { x:an.x + j*30, y:an.y });
    }
  }
  return points;
}
function pickTeamSpawnPointsBatch(teamCount, teamSize){
  return teamPointsAroundAnchors(pickSpawnPointsBatch(teamCount), teamSize, Math.random);
}
function seededPickTeamSpawnPointsBatch(rng, teamCount, teamSize){
  return teamPointsAroundAnchors(seededPickSpawnPointsBatch(rng, teamCount), teamSize, rng);
}
/* ===== バトルアリーナ用スポーン =====
   2チームのアンカーを安置中心を挟んで対面(距離ARENA_SPAWN_GAP)に置き、チーム内は
   既存のteamPointsAroundAnchorsで隣接させる。対面の軸は試合ごとにランダム
   (シード付きなら両側で一致する)。返り値は「チーム0の3体→チーム1の3体」の平坦な配列。
   **ソロ用(pickArenaSpawnPointsBatch)とシード付き(seededPickArenaSpawnPointsBatch)は対。
   直すときは必ず両方直す**(pickTeamSpawnPointsBatchと同じ決まり)。 */
function arenaTeamAnchors(rnd){
  /* 対面の軸を選ぶ。**両側とも障害物から離れている軸を選ぶ**まで振り直す
     (アンカーそのものが岩や火山の中だと、その周りに並べる3体が丸ごと埋まる)。
     余白はメンバーの散らばり(TEAM_SPAWN_SPREAD)ぶんを見込んで広めに取る。 */
  const clearance = TEAM_SPAWN_SPREAD + 60;
  const anchorsAt = (a)=>{
    const dx = Math.cos(a)*ARENA_SPAWN_GAP/2, dy = Math.sin(a)*ARENA_SPAWN_GAP/2;
    return [
      { x: ZONE_CENTER0.x+dx, y: ZONE_CENTER0.y+dy },
      { x: ZONE_CENTER0.x-dx, y: ZONE_CENTER0.y-dy },
    ];
  };
  const clear = (p)=> !isOnHazard(p.x,p.y,clearance) && !isNearRock(p.x,p.y,clearance) && !isNearCrystal(p.x,p.y,clearance);
  let last = null;
  for(let tries=0; tries<24; tries++){
    last = anchorsAt(rnd()*Math.PI*2);
    if(last.every(clear)) return last;
  }
  return last;   // どこも空いていなければ最後の候補で妥協する(埋まりはdepenetrateStuckEntitiesが外す)
}
function pickArenaSpawnPointsBatch(teamSize){
  return teamPointsAroundAnchors(arenaTeamAnchors(Math.random), teamSize, Math.random);
}
function seededPickArenaSpawnPointsBatch(rng, teamSize){
  return teamPointsAroundAnchors(arenaTeamAnchors(rng), teamSize, rng);
}
function createMonster(elementKey, isPlayer, name, overrides){
  const el = ELEMENTS[elementKey];
  const sp = (overrides && overrides.spawnPoint) ? overrides.spawnPoint : pickSpawnPoint();
  const useId = (overrides && overrides.id!=null) ? overrides.id : nextId++;
  return {
    id: useId, isPlayer, element: elementKey, name,
    // リアルマップ(テスト)では生成時点から地形の高さに乗せる(最初の移動計算まで埋まる/浮くのを防ぐ)
    x: sp.x, y: sp.y, z: baseTerrainHeightAt(sp.x, sp.y),
    radius: elementKey==='rock'?25:(elementKey==='spark'?19:(elementKey==='phoenix'?21:22)),
    speed: el.speed * (el.speedMod||1), hp: el.hp, maxHp: el.hp,
    guts:100, maxGuts:100, moveTierUnlocked:1, moveTierSelected:1,
    destination:null, attackTargetId:null,
    fireCooldown:0, dashCooldown:0, dashTimer:0, dashDirX:0, dashDirY:-1,
    facingAngle:-Math.PI/2, hitFlash:0,
    alive:true, placement:null, kills:0, deathAt:0, damageDealt:0,
    aiState:'WANDER', aiTimer:rand(0,0.3), aiTargetPoint:null,
    lastMoveX:0, lastMoveY:-1, inputMoveX:0, inputMoveY:0,
    burnUntil:0, slowUntil:0, graceUntil:0, freezeUntil:0, poisonUntil:0, poisonTickAt:0, poisonSourceId:null,
    pulledUntil:0, pulledX:0, pulledY:0, pulledSpeed:0, // 「羅生門」等に吸い込まれている間の強制移動先(combat.jsのresolveMovement)
    trainCooldownMult:1, trainGutsCostReduction:0, trainProjSpeedMult:1, trainDmgMult:1, trainDmgTakenMult:1, trainSpeedMult:1, trainMaxHpBonus:0,
    /* マスモンの倍率。**マスモンを連れていないbotでも必ず持たせる。**
       未定義のまま authState のフル配信に載ると、Realtime Database が
       undefined を理由に**配信まるごと**を拒否していた(2026-08-15に修正)。
       値の意味は applyMastermonStatsToEntity が入れ直す倍率と同じで、1=補正なし。 */
    mastermonDmgDealtMult:1, mastermonDmgTakenMult:1, mastermonGutsRegenMult:1, mastermonCooldownMult:1,
    mastermonKillExpBonus:0,
    matchTrainLog:[],   // デス円盤石: 試合中に確定したトレーニングカードの履歴(エンティティは試合ごとに作り直すのでここで必ず空になる)
    stateUntil:0, stateCooldownUntil: (STATE_CHANGES[elementKey] ? STATE_CHANGES[elementKey].cooldown/2 : 0),
    stuckCheckPos:{x:sp.x,y:sp.y}, stuckTimer:0, stuckLevel:0, avoidDirSign:1,
    recentAttackers:{},
    // チーム戦(combat.jsのassignTeamsが割り当てる)。null=個人戦=従来どおり
    teamId:null, downed:false, downedUntil:0, reviveProgress:0,
    downedByKillerId:null,   // チーム戦: 自分をダウンさせた相手のid(killEntityがキル数・キルボーナスの帰属に使う)
    needsDepenetrate:false,   // このフレームにめり込みの点検が要るか(depenetrateStuckEntities)
  };
}
function activeMove(m){
  return SIGNATURE_MOVES[m.element][m.moveTierSelected-1];
}
function pickBestAffordableTier(m){
  for(let t=m.moveTierUnlocked; t>=1; t--){
    const mv = SIGNATURE_MOVES[m.element][t-1];
    const cost = Math.max(1, mv.gutsCost - (m.trainGutsCostReduction||0));
    if(m.guts >= cost) return t;
  }
  return 1;
}

/* =====================================================================
   WORLD CONTENT: terrain + loot
===================================================================== */
function genTerrain(){
  terrainDecor = [];
  const count = currentMap.decorCount;
  let guard=0;
  const guardMax = count*12;
  while(terrainDecor.length<count && guard<guardMax){
    guard++;
    const x = rand(40,WORLD.w-40), y = rand(40,WORLD.h-40);
    if(isOnHazard(x,y,70)) continue;
    terrainDecor.push({ x, y, r: rand(5,16), shade: Math.random()<0.5 ? 'dark':'light' });
  }
}
// 火山ごとに一意なIDを振り、描画側でまとめて1つの塊として扱えるようにする
function genVolcanoAndLava(){
  volcanoObstacles = [];
  lavaZones = [];
  if(!currentMap.hasVolcano) return;
  const style = currentMap.mountainStyle||'volcano';
  // レイドは火口を1つだけ、ボスの真後ろに置く(見上げると必ず背後に火山が入る)
  const sites = game.raid ? [RAID_VOLCANO_SITE] : currentMap.volcanoSites;
  let complexId = 0;
  for(const site of sites){
    complexId++;
    const cx = WORLD.w*site.xr, cy = WORLD.h*site.yr;
    const radius = site.radius;
    volcanoObstacles.push({ x:cx, y:cy, radius, isMain:true, complexId, style });
    for(let i=0;i<site.peakBumps;i++){
      const a = (i/site.peakBumps)*Math.PI*2 + rand(-0.15,0.15);
      const d = radius*rand(0.55,0.85);
      volcanoObstacles.push({ x:cx+Math.cos(a)*d, y:cy+Math.sin(a)*d, radius: radius*rand(0.25,0.4), complexId, style });
    }
    for(let i=0;i<currentMap.lavaRingPerVolcano;i++){
      const a = (i/currentMap.lavaRingPerVolcano)*Math.PI*2 + rand(-0.2,0.2);
      const d = currentMap.lavaRingRadius*rand(0.85,1.15);
      lavaZones.push({ x:cx+Math.cos(a)*d, y:cy+Math.sin(a)*d, radius: rand(220,340) });
    }
  }
  for(let i=0;i<currentMap.lavaPoolCount;i++){
    const a = rand(0,Math.PI*2), d = rand(1200, WORLD.w*0.42);
    const site = currentMap.volcanoSites[Math.floor(rand(0,currentMap.volcanoSites.length))];
    const baseX = WORLD.w*site.xr, baseY = WORLD.h*site.yr;
    const x = clamp(baseX+Math.cos(a)*d, 400, WORLD.w-400);
    const y = clamp(baseY+Math.sin(a)*d, 400, WORLD.h-400);
    lavaZones.push({ x, y, radius: rand(160,260) });
  }
}
// マップごとの岩の見た目バリエーション(雪岩/木/貝殻/砂岩など)を重み付きで抽選する。
// リアルマップは3Dモデルで描くので、そのマップに合った専用の内訳(realObstacles)を使う
function rockFlavorTable(){
  if(currentMap.real3d && currentMap.realObstacles) return currentMap.realObstacles;
  return currentMap.rockFlavors || [{ type:'rock', w:1 }];
}
function pickRockFlavor(){
  const flavors = rockFlavorTable();
  const total = flavors.reduce((s,f)=>s+f.w,0);
  let r = Math.random()*total;
  for(const f of flavors){ if(r<f.w) return f.type; r-=f.w; }
  return flavors[flavors.length-1].type;
}
function seededPickRockFlavor(rng){
  const flavors = rockFlavorTable();
  const total = flavors.reduce((s,f)=>s+f.w,0);
  let r = rng()*total;
  for(const f of flavors){ if(r<f.w) return f.type; r-=f.w; }
  return flavors[flavors.length-1].type;
}
function genRocks(){
  rocks = [];
  const count = currentMap.rockCount;
  let guard=0;
  while(rocks.length<count && guard<count*50){
    guard++;
    const rr = Math.random();
    const radius = rr<0.5 ? rand(22,34) : (rr<0.85 ? rand(34,52) : rand(52,72));
    const x = rand(80,WORLD.w-80), y = rand(80,WORLD.h-80);
    if(isOnHazard(x,y,radius+220)) continue;
    rocks.push({ id:nextId++, x, y, radius, height:radius*1.3, seed:rand(0,10), flavor:pickRockFlavor() });
  }
  for(let pass=0; pass<3; pass++){
    for(let i=0;i<rocks.length;i++){
      for(let j=i+1;j<rocks.length;j++){
        const a=rocks[i], b=rocks[j];
        const minD = a.radius+b.radius+20;
        const d = Math.hypot(a.x-b.x,a.y-b.y);
        if(d>0 && d<minD){
          const push=(minD-d)/2, ang=Math.atan2(b.y-a.y,b.x-a.x);
          a.x-=Math.cos(ang)*push; a.y-=Math.sin(ang)*push;
          b.x+=Math.cos(ang)*push; b.y+=Math.sin(ang)*push;
        }
      }
    }
  }
}
/* 落ちているアイテムの中身を1個決める。乱数の出どころだけを差し替えられるようにして、
   ソロ(Math.random)とマルチ(共有シードのrng)で同じ式を使う。
   通常マップとレイドの違いは lootMix() の表だけで、ここは分岐しない。
   ※マルチでは分岐によってrngを消費する回数が変わるため、ホストとゲストで lootMix() が
     同じ表を返すこと(=撒く前に game.raid が両側で揃っていること)が前提。 */
function pickLootFrom(rnd){
  const m = lootMix();
  const r = rnd();
  if(r < m.heal){
    const r2 = rnd();
    const type = r2<0.5 ? 'oilS' : (r2<0.85 ? 'oilM' : 'oilL');
    return { kind:'heal', type };
  }
  if(r < m.ticket) return { kind:'ticket', type:'ticket' };
  if(r < m.guts) return { kind:'guts', type:'guts' };
  const type = TRAINING_TYPES[Math.floor(rnd()*TRAINING_TYPES.length)];
  return { kind:'training', type };
}
function pickLootKindAndType(){ return pickLootFrom(Math.random); }
function isNearRock(x, y, margin){
  for(const r of rocks){
    if(Math.hypot(x-r.x, y-r.y) < r.radius+margin) return true;
  }
  return false;
}
function isNearCrystal(x, y, margin){
  for(const c of crystalObstacles){
    if(Math.hypot(x-c.x, y-c.y) < c.radius+margin) return true;
  }
  return false;
}
function spawnLoot(n, center, radius){
  for(let i=0;i<n;i++){
    const pick = pickLootKindAndType();
    let x, y, guard=0;
    do{
      // r=radius*sqrt(u) にすることで円内に均等な密度で分布させる(単純なrand(0,radius)は中心に偏る)
      const a = rand(0,Math.PI*2), d = radius*Math.sqrt(rand(0,1));
      x = center.x+Math.cos(a)*d; y = center.y+Math.sin(a)*d;
      guard++;
    } while((isNearRock(x,y,45) || isNearCrystal(x,y,45) || isOnHazard(x,y,45)) && guard<20);
    lootItems.push({ id: nextId++, kind: pick.kind, type: pick.type, x, y, z: baseTerrainHeightAt(x,y), bob: rand(0,Math.PI*2) });
  }
}

// 静的な1点を円形障害物(岩/火山/水晶)の外側 margin ぶんへ寄せる(spawnLoot同様の「拾えない位置に置かない」対策)。
// depenetrateObstaclesと違い1フレームで一気に解消してよい(動いているキャラのワープ防止が要らないため)。
// 複数の障害物が重なる位置も想定し、深い方から順に数回押し出す。
function clearObstaclePoint(x, y, margin){
  for(let iter=0; iter<4; iter++){
    let ox=0, oy=0, depth=0;
    const consider=(cx,cy,r)=>{
      const rr = r + margin;
      const ddx=x-cx, ddy=y-cy; const d=Math.hypot(ddx,ddy)||0.0001;
      const pen = rr - d;
      if(pen>depth){ depth=pen; ox=ddx/d; oy=ddy/d; }
    };
    for(const rk of rocks) consider(rk.x, rk.y, rk.radius);
    for(const v of volcanoObstacles) consider(v.x, v.y, mountainGroundRadius(v));
    for(const c of crystalObstacles) consider(c.x, c.y, c.radius);
    if(depth<=0) break;
    x += ox*depth; y += oy*depth;
  }
  return { x: clamp(x, 0, WORLD.w), y: clamp(y, 0, WORLD.h) };
}
/* ===== デス円盤石(kind:'deathDisc') =====
   倒された者が試合中に確定したトレーニング強化(matchTrainLog)を石の円盤として落とす。
   **ソロもマルチのホストもこの1つを通る**(killEntityから呼ばれる。ゲストへの見た目は
   ここから既存のlootEvent(spawn)で配信する)。動的生成のみなのでシード付きの対関数は無い。 */
function spawnDeathDisc(victim){
  if(game.raid || game.trainingRange) return null;   // レイド・射撃訓練場では出さない
  const log = victim.matchTrainLog;
  if(!log || !log.length) return null;
  const keys = log.slice(-DEATH_DISC_MAX_ITEMS);     // 新しい方から最大 DEATH_DISC_MAX_ITEMS 件
  // 【スタック対策】倒れた場所が岩・火山・水晶に埋まっていると、誰も拾える距離まで
  // 近づけず円盤石が永久に取れなくなる(2026-08-19)。spawnLootの障害物除けと同じ考え方で
  // 落下地点を外側へ逃がす。マージンは拾える距離(e.radius+14)より確実に広く取る
  const drop = clearObstaclePoint(victim.x, victim.y, DEATH_DISC_DROP_CLEAR_MARGIN);
  const it = {
    id: nextId++, kind:'deathDisc', type:null, keys,
    owner: (typeof displayNameFor==='function') ? displayNameFor(victim) : victim.name,
    ownerTeamId: (victim.teamId!=null) ? victim.teamId : null,   // 敵味方の色分け用(見る側のチームと比較)
    x: drop.x, y: drop.y, z: baseTerrainHeightAt(drop.x, drop.y), bob: rand(0,Math.PI*2),
  };
  lootItems.push(it);
  if(netState.mode==='multi' && netState.isHost && window.__aramonPushLootEvent){
    window.__aramonPushLootEvent(netState.roomId, {
      evtType:'spawn', id:it.id, kind:it.kind, itemType:null, x:Math.round(it.x), y:Math.round(it.y), bob:it.bob,
      keys: it.keys, owner: it.owner || null,   // Firebaseはundefined不可。中身と持ち主名はゲストの表示用
      tid: (it.ownerTeamId!=null) ? it.ownerTeamId : null,   // 敵味方の色分け用
    });
  }
  return it;
}

// ===== マルチプレイ用: シード付き決定論的初期化 =====
function seededPickLootKindAndType(rng){ return pickLootFrom(rng); }
function seededSpawnLoot(rng, n, center, radius){
  for(let i=0;i<n;i++){
    const pick = seededPickLootKindAndType(rng);
    let x, y, guard=0;
    do{
      // r=radius*sqrt(u) にすることで円内に均等な密度で分布させる(単純なrand(0,radius)は中心に偏る)
      const a = seededRand(rng,0,Math.PI*2), d = radius*Math.sqrt(seededRand(rng,0,1));
      x = center.x+Math.cos(a)*d; y = center.y+Math.sin(a)*d;
      guard++;
    } while((isNearRock(x,y,45) || isNearCrystal(x,y,45) || isOnHazard(x,y,45)) && guard<20);
    lootItems.push({ id: nextId++, kind: pick.kind, type: pick.type, x, y, z: baseTerrainHeightAt(x,y), bob: seededRand(rng,0,Math.PI*2) });
  }
}
function seededGenVolcanoAndLava(rng){
  volcanoObstacles = [];
  lavaZones = [];
  if(!currentMap.hasVolcano) return;
  const style = currentMap.mountainStyle||'volcano';
  let complexId = 0;
  for(const site of currentMap.volcanoSites){
    complexId++;
    const cx = WORLD.w*site.xr, cy = WORLD.h*site.yr;
    const radius = site.radius;
    volcanoObstacles.push({ x:cx, y:cy, radius, isMain:true, complexId, style });
    for(let i=0;i<site.peakBumps;i++){
      const a = (i/site.peakBumps)*Math.PI*2 + seededRand(rng,-0.15,0.15);
      const d = radius*seededRand(rng,0.55,0.85);
      volcanoObstacles.push({ x:cx+Math.cos(a)*d, y:cy+Math.sin(a)*d, radius: radius*seededRand(rng,0.25,0.4), complexId, style });
    }
    for(let i=0;i<currentMap.lavaRingPerVolcano;i++){
      const a = (i/currentMap.lavaRingPerVolcano)*Math.PI*2 + seededRand(rng,-0.2,0.2);
      const d = currentMap.lavaRingRadius*seededRand(rng,0.85,1.15);
      lavaZones.push({ x:cx+Math.cos(a)*d, y:cy+Math.sin(a)*d, radius: seededRand(rng,220,340) });
    }
  }
  for(let i=0;i<currentMap.lavaPoolCount;i++){
    const a = seededRand(rng,0,Math.PI*2), d = seededRand(rng,1200, WORLD.w*0.42);
    const site = currentMap.volcanoSites[Math.floor(seededRand(rng,0,currentMap.volcanoSites.length))];
    const baseX = WORLD.w*site.xr, baseY = WORLD.h*site.yr;
    const x = clamp(baseX+Math.cos(a)*d, 400, WORLD.w-400);
    const y = clamp(baseY+Math.sin(a)*d, 400, WORLD.h-400);
    lavaZones.push({ x, y, radius: seededRand(rng,160,260) });
  }
}
function seededGenRocks(rng){
  rocks = [];
  const count = Math.round(currentMap.rockCount * (worldDensityScale||1));
  let guard=0;
  while(rocks.length<count && guard<count*50){
    guard++;
    const rr = rng();
    const radius = rr<0.5 ? seededRand(rng,22,34) : (rr<0.85 ? seededRand(rng,34,52) : seededRand(rng,52,72));
    const x = seededRand(rng,80,WORLD.w-80), y = seededRand(rng,80,WORLD.h-80);
    if(isOnHazard(x,y,radius+220)) continue;
    rocks.push({ id:nextId++, x, y, radius, height:radius*1.3, seed:seededRand(rng,0,10), flavor:seededPickRockFlavor(rng) });
  }
  for(let pass=0; pass<3; pass++){
    for(let i=0;i<rocks.length;i++){
      for(let j=i+1;j<rocks.length;j++){
        const a=rocks[i], b=rocks[j];
        const minD = a.radius+b.radius+20;
        const d = Math.hypot(a.x-b.x,a.y-b.y);
        if(d>0 && d<minD){
          const push=(minD-d)/2, ang=Math.atan2(b.y-a.y,b.x-a.x);
          a.x-=Math.cos(ang)*push; a.y-=Math.sin(ang)*push;
          b.x+=Math.cos(ang)*push; b.y+=Math.sin(ang)*push;
        }
      }
    }
  }
}
function seededGenTerrain(rng){
  terrainDecor = [];
  const count = Math.round(currentMap.decorCount * (worldDensityScale||1));
  for(let i=0;i<count;i++){
    const x = seededRand(rng,40,WORLD.w-40), y = seededRand(rng,40,WORLD.h-40);
    if(isOnHazard(x,y,70)) continue;
    terrainDecor.push({ x, y, r: seededRand(rng,5,16), shade: rng()<0.5 ? 'dark':'light' });
  }
}
// ===== 尖った水晶(雪山マップの障害物) =====
function genCrystals(){
  crystalObstacles = [];
  if(!currentMap.hasCrystals) return;
  const count = Math.round((currentMap.crystalCount||0) * (worldDensityScale||1));
  let guard=0;
  while(crystalObstacles.length<count && guard<count*50){
    guard++;
    const radius = rand(16,38);
    const x = rand(80,WORLD.w-80), y = rand(80,WORLD.h-80);
    if(isOnHazard(x,y,radius+180)) continue;
    if(isNearRock(x,y,radius+25)) continue;
    let tooClose=false;
    for(const c of crystalObstacles){ if(Math.hypot(x-c.x,y-c.y) < c.radius+radius+18){ tooClose=true; break; } }
    if(tooClose) continue;
    crystalObstacles.push({ id:nextId++, x, y, radius, height:radius*1.8, seed:rand(0,10) });
  }
}
function seededGenCrystals(rng){
  crystalObstacles = [];
  if(!currentMap.hasCrystals) return;
  const count = Math.round((currentMap.crystalCount||0) * (worldDensityScale||1));
  let guard=0;
  while(crystalObstacles.length<count && guard<count*50){
    guard++;
    const radius = seededRand(rng,16,38);
    const x = seededRand(rng,80,WORLD.w-80), y = seededRand(rng,80,WORLD.h-80);
    if(isOnHazard(x,y,radius+180)) continue;
    if(isNearRock(x,y,radius+25)) continue;
    let tooClose=false;
    for(const c of crystalObstacles){ if(Math.hypot(x-c.x,y-c.y) < c.radius+radius+18){ tooClose=true; break; } }
    if(tooClose) continue;
    crystalObstacles.push({ id:nextId++, x, y, radius, height:radius*1.8, seed:seededRand(rng,0,10) });
  }
}
// ===== 海/川(水域)の生成 =====
// 海は海岸線(seaEdgeXの純粋な数式)に沿って大きな円を並べて描画用に敷き詰める。
// 川は右側の適当な地点から、うねりながら海岸線まで流れる円の連なりとして生成する。
function genSeaZones(){
  seaZones = [];
  if(!currentMap.hasSea) return;
  const step = 260;
  const circleRadius = 520;
  for(let y=-200; y<=WORLD.h+200; y+=step){
    const edge = seaEdgeX(y);
    // 海岸線(edge)から世界の左端(x=0)より少し先まで円を敷き詰め、砂地が覗く隙間をなくす
    for(let x=edge-260; x>-circleRadius*1.4; x-=circleRadius*0.72){
      seaZones.push({ x, y, radius:circleRadius });
    }
  }
}
function genRiverZones(){
  riverZones = [];
  if(!currentMap.hasRiver) return;
  const n = Math.max(1, Math.round((currentMap.riverCount||0) * Math.sqrt(worldDensityScale||1)));
  const baseWidth = currentMap.riverWidth||220;
  // 複数の川が交差/重複しないよう、縦方向をn個の帯に分けて1本ずつ配置する
  const bandTop = WORLD.h*0.08, bandBottom = WORLD.h*0.92;
  const bandHeight = (bandBottom-bandTop)/n;
  for(let i=0;i<n;i++){
    const wobbleFreq = rand(0.0006,0.0014);
    const wobbleAmp = Math.min(420, bandHeight*0.32);
    const wobblePhase = rand(0,Math.PI*2);
    const margin = wobbleAmp + baseWidth*0.7;
    const bandLo = bandTop + bandHeight*i + margin;
    const bandHi = bandTop + bandHeight*(i+1) - margin;
    const startY = bandLo < bandHi ? rand(bandLo, bandHi) : bandTop + bandHeight*(i+0.5);
    let x = WORLD.w*0.94;
    let steps = 0;
    while(x > seaEdgeX(clamp(startY,60,WORLD.h-60))-40 && steps<400){
      const y = clamp(startY + Math.sin(x*wobbleFreq+wobblePhase)*wobbleAmp, 60, WORLD.h-60);
      const width = baseWidth*rand(0.8,1.15);
      riverZones.push({ x, y, radius: width/2 });
      x -= rand(140,220);
      steps++;
    }
  }
}
function seededGenSeaZones(){
  // 海岸線は純粋な数式のみで決まるため、シード無しの関数と共通でよい
  genSeaZones();
}
function seededGenRiverZones(rng){
  riverZones = [];
  if(!currentMap.hasRiver) return;
  const n = Math.max(1, Math.round((currentMap.riverCount||0) * Math.sqrt(worldDensityScale||1)));
  const baseWidth = currentMap.riverWidth||220;
  // 複数の川が交差/重複しないよう、縦方向をn個の帯に分けて1本ずつ配置する
  const bandTop = WORLD.h*0.08, bandBottom = WORLD.h*0.92;
  const bandHeight = (bandBottom-bandTop)/n;
  for(let i=0;i<n;i++){
    const wobbleFreq = seededRand(rng,0.0006,0.0014);
    const wobbleAmp = Math.min(420, bandHeight*0.32);
    const wobblePhase = seededRand(rng,0,Math.PI*2);
    const margin = wobbleAmp + baseWidth*0.7;
    const bandLo = bandTop + bandHeight*i + margin;
    const bandHi = bandTop + bandHeight*(i+1) - margin;
    const startY = bandLo < bandHi ? seededRand(rng,bandLo,bandHi) : bandTop + bandHeight*(i+0.5);
    let x = WORLD.w*0.94;
    let steps = 0;
    while(x > seaEdgeX(clamp(startY,60,WORLD.h-60))-40 && steps<400){
      const y = clamp(startY + Math.sin(x*wobbleFreq+wobblePhase)*wobbleAmp, 60, WORLD.h-60);
      const width = baseWidth*seededRand(rng,0.8,1.15);
      riverZones.push({ x, y, radius: width/2 });
      x -= seededRand(rng,140,220);
      steps++;
    }
  }
}
function genWater(){
  genSeaZones();
  genRiverZones();
}
function seededGenWater(rng){
  seededGenSeaZones();
  seededGenRiverZones(rng);
}
// ===== オアシス(砂漠マップの水たまり) =====
function genOasisZones(){
  oasisZones = [];
  if(!currentMap.hasOasis) return;
  const n = Math.max(1, Math.round((currentMap.oasisCount||0) * (worldDensityScale||1)));
  const radius = currentMap.oasisRadius||400;
  // マップ中心寄りに出現させる(端には出さない)
  const marginX = Math.max(radius+200, WORLD.w*0.24);
  const marginY = Math.max(radius+200, WORLD.h*0.24);
  let guard=0;
  while(oasisZones.length<n && guard<n*40){
    guard++;
    const x = rand(marginX, WORLD.w-marginX), y = rand(marginY, WORLD.h-marginY);
    let nearMountain=false;
    for(const v of volcanoObstacles){ if(v.isMain && Math.hypot(x-v.x,y-v.y) < v.radius+radius+400){ nearMountain=true; break; } }
    if(nearMountain) continue;
    let tooClose=false;
    for(const o of oasisZones){ if(Math.hypot(x-o.x,y-o.y) < (o.radius+radius)*1.3){ tooClose=true; break; } }
    if(tooClose) continue;
    oasisZones.push({ x, y, radius });
  }
}
function seededGenOasisZones(rng){
  oasisZones = [];
  if(!currentMap.hasOasis) return;
  const n = Math.max(1, Math.round((currentMap.oasisCount||0) * (worldDensityScale||1)));
  const radius = currentMap.oasisRadius||400;
  // マップ中心寄りに出現させる(端には出さない)
  const marginX = Math.max(radius+200, WORLD.w*0.24);
  const marginY = Math.max(radius+200, WORLD.h*0.24);
  let guard=0;
  while(oasisZones.length<n && guard<n*40){
    guard++;
    const x = seededRand(rng,marginX, WORLD.w-marginX), y = seededRand(rng,marginY, WORLD.h-marginY);
    let nearMountain=false;
    for(const v of volcanoObstacles){ if(v.isMain && Math.hypot(x-v.x,y-v.y) < v.radius+radius+400){ nearMountain=true; break; } }
    if(nearMountain) continue;
    let tooClose=false;
    for(const o of oasisZones){ if(Math.hypot(x-o.x,y-o.y) < (o.radius+radius)*1.3){ tooClose=true; break; } }
    if(tooClose) continue;
    oasisZones.push({ x, y, radius });
  }
}
// オアシスの周りはアイテムが湧きやすいので、通常の湧き処理の後に追加でこれを呼ぶ
function spawnOasisBonusLoot(){
  if(!currentMap.hasOasis) return;
  for(const oz of oasisZones){ spawnLoot(Math.round(7 * mutSpawnMultSafe()), oz, oz.radius*1.4); }
}
function seededSpawnOasisBonusLoot(rng){
  if(!currentMap.hasOasis) return;
  for(const oz of oasisZones){ seededSpawnLoot(rng, Math.round(7 * mutSpawnMultSafe()), oz, oz.radius*1.4); }
}
// ミューテーター「スポーンアイテム数1.5倍」の倍率(非公開中/未定義時は1)
function mutSpawnMultSafe(){ return (typeof mutatorSpawnMult==='function') ? mutatorSpawnMult() : 1; }
// ===== マルチプレイ用: ホストが生成した障害物をゲストへ配信して同一化する =====
// (シード再生成に頼るとタイムアウト時の別シードや環境差で食い違い、見えない岩に
//  ハマる/岩の上にスポーンして動けない等が起きるため、ホストの結果を正とする)
function packWorldForSync(){
  const flat = arr => { const o=[]; for(const z of arr){ o.push(Math.round(z.x),Math.round(z.y),Math.round(z.radius)); } return o; };
  const vol = []; for(const v of volcanoObstacles){ vol.push(Math.round(v.x),Math.round(v.y),Math.round(v.radius), v.isMain?1:0, v.complexId||0); }
  return {
    rk: flat(rocks), cr: flat(crystalObstacles), vo: vol,
    lv: flat(lavaZones), se: flat(seaZones), ri: flat(riverZones), oa: flat(oasisZones),
    st: currentMap.mountainStyle || 'volcano',
  };
}
// 配信された障害物を反映する。座標は配信値をそのまま使い、岩/水晶の見た目(seed/flavor)だけ
// 派生rngでローカルに決める(当たり判定に影響しない装飾差のみ許容)
function applyWorldFromSync(d, cosmeticRng){
  const unflat = a => { const o=[]; for(let i=0;i+2<a.length;i+=3){ o.push({ x:a[i], y:a[i+1], radius:a[i+2] }); } return o; };
  rocks = [];
  for(let i=0;i+2<(d.rk||[]).length;i+=3){ const radius=d.rk[i+2]; rocks.push({ id:nextId++, x:d.rk[i], y:d.rk[i+1], radius, height:radius*1.3, seed:seededRand(cosmeticRng,0,10), flavor:seededPickRockFlavor(cosmeticRng) }); }
  crystalObstacles = [];
  for(let i=0;i+2<(d.cr||[]).length;i+=3){ const radius=d.cr[i+2]; crystalObstacles.push({ id:nextId++, x:d.cr[i], y:d.cr[i+1], radius, height:radius*1.8, seed:seededRand(cosmeticRng,0,10) }); }
  volcanoObstacles = [];
  const st = d.st || 'volcano';
  for(let i=0;i+4<(d.vo||[]).length;i+=5){ volcanoObstacles.push({ x:d.vo[i], y:d.vo[i+1], radius:d.vo[i+2], isMain:!!d.vo[i+3], complexId:d.vo[i+4], style:st }); }
  lavaZones = unflat(d.lv||[]); seaZones = unflat(d.se||[]); riverZones = unflat(d.ri||[]); oasisZones = unflat(d.oa||[]);
}
// マルチプレイ用: n体分のスポーン地点を角度方向にできるだけ均等に割り振って生成する(シード付き)
function seededPickSpawnPointsBatch(rng, n){
  const R = ZONE_PHASES[0].holdRadius*0.85;
  const angleStep = (Math.PI*2)/n;
  const angleOffset = seededRand(rng,0,angleStep);
  const points = [];
  for(let i=0;i<n;i++){
    const baseAngle = angleOffset + angleStep*i;
    let placed = null;
    for(let tries=0; tries<40 && !placed; tries++){
      const a = baseAngle + seededRand(rng,-angleStep*0.4, angleStep*0.4);
      const r = R*Math.sqrt(seededRand(rng,0,1));
      const x = ZONE_CENTER0.x+Math.cos(a)*r, y = ZONE_CENTER0.y+Math.sin(a)*r;
      if(isOnHazard(x,y,60)) continue;
      let onRock=false;
      for(const rk of rocks){ if(Math.hypot(x-rk.x,y-rk.y) < rk.radius+40){ onRock=true; break; } }
      if(onRock) continue;
      let tooClose=false;
      for(const p of points){ if(Math.hypot(x-p.x,y-p.y) < MIN_SPAWN_SEPARATION){ tooClose=true; break; } }
      if(tooClose) continue;
      placed = {x,y};
    }
    if(!placed){
      const r = R*0.6;
      placed = {x: ZONE_CENTER0.x+Math.cos(baseAngle)*r, y: ZONE_CENTER0.y+Math.sin(baseAngle)*r};
    }
    points.push(placed);
  }
  return points;
}

/* =====================================================================
   PARTICLES / FX
===================================================================== */
function addParticle(p){ particles.push(Object.assign({life:1,maxLife:1,vx:0,vy:0,size:4,z:0}, p)); }
function spawnHit(x,y,z,color){ for(let i=0;i<5;i++){ const a=rand(0,Math.PI*2), sp=rand(40,140); addParticle({type:'spark',x,y,z,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:0.35,maxLife:0.35,color,size:rand(2,4)}); } }
function spawnDeath(x,y,z,color){ for(let i=0;i<14;i++){ const a=rand(0,Math.PI*2), sp=rand(60,220); addParticle({type:'spark',x,y,z,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:0.6,maxLife:0.6,color,size:rand(3,6)}); } }
/* 【数字の共有スタッカー】数字が近くに重なると全部読めなくなる(批評指摘)。
   「直前の1点」を覚える方式では別の対象・別の種類(与ダメ/GT/回復)の数字と
   衝突したままだったので、**生きている数字パーティクル全部**と突き合わせて、
   重なる間は上へ積み・ときどき左右へ逃がす。種別・対象を問わず1か所で効く。
   数字は多くても同時に数枚なので全走査でも安い。 */
function dmgTextFreeSpot(x, y, z){
  let ox = 0, oz = 0, tries = 0;
  const clash = ()=> particles.some(pt=> pt.type==='text' && pt.life > 0.12
    && Math.hypot(pt.x-(x+ox), pt.y-y) < 55 && Math.abs((pt.z||0)-(z+oz)) < 26);
  while(tries < 6 && clash()){
    tries++;
    // 上と左右を交互に使う(上ばかりに積むと画面上端で見切れる)
    if(tries % 2 === 1) ox = (ox <= 0 ? Math.abs(ox)+34 : -ox);
    else oz += 26;
  }
  return { x: x+ox, z: z+oz };
}
function spawnDmgText(x,y,z,val,color,big){
  const spot = dmgTextFreeSpot(x, y, z||0);
  addParticle({type:'text',x:spot.x,y,z:spot.z,vx:rand(-10,10),vy:-50,
    life:big?0.85:0.7,maxLife:big?0.85:0.7,color:color||'#fff',text:String(val),big:!!big});
}
/* ゲストの予測ダメージ数字(見た目専用)。ホスト確定の実数字と見分けが付くよう
   小さく半透明で描かれる(render.jsのdrawParticleがpredを見る)。値は概算でよい */
function spawnPredDmgText(x,y,z,val){
  const spot = dmgTextFreeSpot(x, y, z||0);   // 予測数字も同じスタッカーを通す
  addParticle({type:'text',x:spot.x,y,z:spot.z,vx:rand(-8,8),vy:-42,life:0.5,maxLife:0.5,color:'#ffeec8',text:String(Math.round(val)),pred:true});
}

function displayNameFor(ent){
  if(!ent) return '';
  if(netState && netState.mode==='multi' && ent.netPlayerId && ent.netPlayerId===netState.hostId){
    return `${ent.name}（ホスト）`;
  }
  return ent.name;
}

/* =====================================================================
   KILL FEED / TOAST
===================================================================== */
function pushKillFeed(text){
  const feed = document.getElementById('killFeed');
  const div = document.createElement('div');
  div.className='kf-item'; div.textContent=text;
  feed.appendChild(div);
  /* 表示は3行まで。375px高の端末では4行目がFIREボタンに被る(批評指摘)。
     古い行から落とす(荒野行動と同じく、フィードは「直近の戦況」だけを流す) */
  while(feed.children.length>3) feed.removeChild(feed.firstChild);
  setTimeout(()=>{ div.style.transition='opacity .5s'; div.style.opacity='0'; setTimeout(()=>div.remove(),520); }, 4200);
}
let toastTimer=null;
function pushToast(text){
  const el = document.getElementById('toast');
  el.textContent = text; el.style.opacity='1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ el.style.opacity='0'; }, 1600);
}
// FIREを押したがガッツ不足で技が撃てなかった時、左下のガッツゲージを一瞬強調する
function flashGutsGauge(){
  const el = document.getElementById('gutsTrack');
  if(!el) return;
  el.classList.remove('guts-warn');
  void el.offsetWidth; // 再生中に連打された時もアニメーションを最初から再生し直すためのリフロー
  el.classList.add('guts-warn');
}
// 上のトースト/ゲージ強調は連打・長押しで毎フレーム呼ばれると鬱陶しいので、一定間隔だけ許可する
let lastGutsWarnAt = -Infinity;
function warnGutsShortage(){
  if(matchTime - lastGutsWarnAt < 0.8) return;
  lastGutsWarnAt = matchTime;
  pushToast('ガッツ不足！');
  flashGutsGauge();
  playSe('noGuts');
}

/* =====================================================================
   COMBAT
===================================================================== */
