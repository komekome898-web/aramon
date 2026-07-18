let entities = [];
let buildings = [];
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
let lootItems = [];
let particles = [];
let terrainDecor = [];
let nextId = 1;
let player = null;
let matchTime = 0;
let zoneState = null;
let game = { started:false, over:false, tipTimer:7, selectedElement:null, selectedMap:'wild' };

const FOV_V = 64*Math.PI/180;
let FOCAL = 600;
let camState = { yaw:0, pitch:0.27, height:120, distBehind:190 };
let camPos = { x:0, y:0, z:0 };
let camSnap = { active:false, fromYaw:0, toYaw:0, t:0, duration:0.28 };
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
let dpr = Math.min(window.devicePixelRatio||1, 2);
let viewW=window.innerWidth, viewH=window.innerHeight;

// ===== 強制横向き表示(向きロック中でも横向きでプレイできるようにするCSS回転トリック) =====
// スマホ・小型タブレットが縦長(portrait)のときは、#appRootをCSSで90度回転させて
// 横向きの画面として描画する。実際のブラウザviewportは縦長のままなので、
// キャンバスサイズや各種ポインタ座標は「回転後の論理座標」に変換して使う必要がある。
const FORCE_LANDSCAPE_MAX_SIDE = 932; // このサイズ以下の小画面のみ対象(PCの縦長ウィンドウ等は対象外)
const appRootEl = document.getElementById('appRoot');
function getRealViewportSize(){
  if(window.visualViewport){
    return { w: window.visualViewport.width, h: window.visualViewport.height };
  }
  return { w: window.innerWidth, h: window.innerHeight };
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
}
function updateForceLandscapeMode(){
  const real = getRealViewportSize();
  const isPortrait = real.h > real.w;
  const isSmallScreen = Math.max(real.w, real.h) <= FORCE_LANDSCAPE_MAX_SIDE;
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
  const vp = getViewportSize();
  viewW = vp.w; viewH = vp.h;
  canvas.width = viewW*dpr; canvas.height = viewH*dpr;
  canvas.style.width = viewW+'px'; canvas.style.height = viewH+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  recomputeFocal();
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
resize();

/* =====================================================================
   ZONE
===================================================================== */
function initZone(){
  zoneState = {
    phaseIndex:0, timer:0, shrinking:false,
    center:{...ZONE_CENTER0}, radius: ZONE_PHASES[0].holdRadius,
    fromCenter:{...ZONE_CENTER0}, fromRadius: ZONE_PHASES[0].holdRadius,
    toCenter:{...ZONE_CENTER0}, toRadius: ZONE_PHASES[0].holdRadius,
  };
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
        if(Math.hypot(x-v.x, y-v.y) < v.radius + nextRadius*0.5 + 300){ insideAny = true; break; }
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
  zoneState.toCenter = pickZoneTarget(zoneState.center, zoneState.radius, ZONE_PHASES[newIndex].holdRadius);
  zoneState.toRadius = ZONE_PHASES[newIndex].holdRadius;
  zoneState.phaseIndex = newIndex;
  zoneState.timer = 0;
  zoneState.shrinking = true;
  const beforeCount = lootItems.length;
  spawnLoot(30, zoneState.toCenter, zoneState.toRadius*0.8);
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
    if(t>=1){ zoneState.shrinking=false; zoneState.timer=0; }
  } else {
    if(zoneState.timer >= ph.holdTime){ advanceZonePhase(); }
  }
}
function currentDps(){ return ZONE_PHASES[zoneState.phaseIndex].dps; }
function zoneLabel(){
  if(zoneState.phaseIndex===0) return '安全圏：待機中';
  return zoneState.shrinking ? '安全圏：縮小中' : '安全圏：安定';
}
// 次の収縮(または現在の収縮が終わるまで)の残り秒数。もう収縮しない最終フェーズでは null を返す
function zoneCountdownSeconds(){
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
function rampHeightAt(b, x, y){
  if(b.rampSide===0){
    const rw=b.hw*0.9, nearY=b.cy+b.hd, farY=nearY+b.rampLen;
    if(Math.abs(x-b.cx)>rw || y<nearY || y>farY) return null;
    return lerp(b.wallH,0,(y-nearY)/(farY-nearY));
  }
  if(b.rampSide===1){
    const rw=b.hw*0.9, nearY=b.cy-b.hd, farY=nearY-b.rampLen;
    if(Math.abs(x-b.cx)>rw || y>nearY || y<farY) return null;
    return lerp(b.wallH,0,(nearY-y)/(nearY-farY));
  }
  if(b.rampSide===2){
    const rw=b.hd*0.9, nearX=b.cx+b.hw, farX=nearX+b.rampLen;
    if(Math.abs(y-b.cy)>rw || x<nearX || x>farX) return null;
    return lerp(b.wallH,0,(x-nearX)/(farX-nearX));
  }
  const rw=b.hd*0.9, nearX=b.cx-b.hw, farX=nearX-b.rampLen;
  if(Math.abs(y-b.cy)>rw || x>nearX || x<farX) return null;
  return lerp(b.wallH,0,(nearX-x)/(nearX-farX));
}
function isInsideFootprint(b,x,y){
  return Math.abs(x-b.cx)<=b.hw && Math.abs(y-b.cy)<=b.hd;
}
function getTerrainHeightAt(x,y){
  for(const b of buildings){
    const r = rampHeightAt(b,x,y);
    if(r!==null) return r;
    if(isInsideFootprint(b,x,y)) return b.wallH;
  }
  return 0;
}
function blockedByHeight(m,x,y){
  return getTerrainHeightAt(x,y) > m.z + CLIMB_TOLERANCE;
}
function blockedByRock(m,x,y){
  if(m.z > 25) return false;
  for(const r of rocks){
    if(Math.hypot(x-r.x, y-r.y) < r.radius+m.radius) return true;
  }
  return false;
}
function blockedByVolcano(m,x,y){
  // 火山(雪山/森/ピラミッド含む)は高さに関係なく(飛び越え不可)常にブロックする
  for(const v of volcanoObstacles){
    if(Math.hypot(x-v.x, y-v.y) < v.radius+m.radius) return true;
  }
  return false;
}
function blockedByCrystal(m,x,y){
  if(m.z > 25) return false;
  for(const c of crystalObstacles){
    if(Math.hypot(x-c.x, y-c.y) < c.radius+m.radius) return true;
  }
  return false;
}
function tryMoveAxis(m, dx, dy){
  const fullX = clamp(m.x+dx, m.radius, WORLD.w-m.radius);
  const fullY = clamp(m.y+dy, m.radius, WORLD.h-m.radius);
  if(!blockedByHeight(m,fullX,fullY) && !blockedByRock(m,fullX,fullY) && !blockedByVolcano(m,fullX,fullY) && !blockedByCrystal(m,fullX,fullY)){
    m.x = fullX; m.y = fullY;
    m.z = getTerrainHeightAt(m.x, m.y);
    return;
  }
  const onlyX = clamp(m.x+dx, m.radius, WORLD.w-m.radius);
  if(!blockedByHeight(m,onlyX,m.y) && !blockedByRock(m,onlyX,m.y) && !blockedByVolcano(m,onlyX,m.y) && !blockedByCrystal(m,onlyX,m.y)) m.x = onlyX;
  const onlyY = clamp(m.y+dy, m.radius, WORLD.h-m.radius);
  if(!blockedByHeight(m,m.x,onlyY) && !blockedByRock(m,m.x,onlyY) && !blockedByVolcano(m,m.x,onlyY) && !blockedByCrystal(m,m.x,onlyY)) m.y = onlyY;
  m.z = getTerrainHeightAt(m.x, m.y);
}
const MIN_SPAWN_SEPARATION = 500;
// ===== 海/川(水域) =====
// 海はワールド左端に沿った波打つ境界線として、川は右側から海へ流れる帯状の円チェーンとして表現する。
// 座標(x,y)から境界線を求める部分は純粋な数式なので、シード無しでもホスト/ゲスト間で常に一致する。
function seaEdgeX(y){
  if(!currentMap.hasSea) return -Infinity;
  const base = WORLD.w*(currentMap.seaWidthRatio||0.14);
  return base + Math.sin(y*0.0009)*220 + Math.sin(y*0.0025+1.3)*90;
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
  for(const v of volcanoObstacles){ if(Math.hypot(x-v.x,y-v.y) < v.radius+margin) return true; }
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
    if(buildingBlocks(x,y,30)) continue;
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
      if(buildingBlocks(x,y,30)) continue;
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
function createMonster(elementKey, isPlayer, name, overrides){
  const el = ELEMENTS[elementKey];
  const sp = (overrides && overrides.spawnPoint) ? overrides.spawnPoint : pickSpawnPoint();
  const useId = (overrides && overrides.id!=null) ? overrides.id : nextId++;
  return {
    id: useId, isPlayer, element: elementKey, name,
    x: sp.x, y: sp.y, z:0,
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
    trainCooldownMult:1, trainGutsCostReduction:0, trainProjSpeedMult:1, trainDmgMult:1, trainDmgTakenMult:1, trainSpeedMult:1,
    stateUntil:0, stateCooldownUntil: (STATE_CHANGES[elementKey] ? STATE_CHANGES[elementKey].cooldown/2 : 0),
    stuckCheckPos:{x:sp.x,y:sp.y}, stuckTimer:0, stuckLevel:0, avoidDirSign:1,
    recentAttackers:{},
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
    if(buildingBlocks(x,y,10)) continue;
    if(isOnHazard(x,y,70)) continue;
    terrainDecor.push({ x, y, r: rand(5,16), shade: Math.random()<0.5 ? 'dark':'light' });
  }
}
function buildingBlocks(x,y,margin){
  for(const b of buildings){
    const m = Math.max(b.hw,b.hd)+b.rampLen+margin+30;
    if(Math.abs(x-b.cx)<m && Math.abs(y-b.cy)<m) return true;
  }
  return false;
}
// 火山ごとに一意なIDを振り、描画側でまとめて1つの塊として扱えるようにする
function genVolcanoAndLava(){
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
function genBuildings(){
  buildings = [];
  const count = 21;
  let attempts=0;
  while(buildings.length<count && attempts<900){
    attempts++;
    const hw = rand(70,110), hd = rand(70,110);
    const cx = rand(hw+200, WORLD.w-hw-200);
    const cy = rand(hd+200, WORLD.h-hd-200);
    let tooClose=false;
    for(const b of buildings){
      if(Math.hypot(cx-b.cx,cy-b.cy) < (hw+hd+b.hw+b.hd)*0.65+260){ tooClose=true; break; }
    }
    if(tooClose) continue;
    buildings.push({
      id:nextId++, cx, cy, hw, hd,
      wallH: rand(115,150),
      rampLen: rand(110,150),
      rampSide: randInt(0,3),
    });
  }
}
// マップごとの岩の見た目バリエーション(雪岩/木/貝殻/砂岩など)を重み付きで抽選する
function pickRockFlavor(){
  const flavors = currentMap.rockFlavors || [{ type:'rock', w:1 }];
  const total = flavors.reduce((s,f)=>s+f.w,0);
  let r = Math.random()*total;
  for(const f of flavors){ if(r<f.w) return f.type; r-=f.w; }
  return flavors[flavors.length-1].type;
}
function seededPickRockFlavor(rng){
  const flavors = currentMap.rockFlavors || [{ type:'rock', w:1 }];
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
    if(buildingBlocks(x,y,radius)) continue;
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
function pickLootKindAndType(){
  const r = Math.random();
  if(r < 0.35){
    const r2 = Math.random();
    const type = r2<0.5 ? 'oilS' : (r2<0.85 ? 'oilM' : 'oilL');
    return { kind:'heal', type };
  }
  if(r < 0.62) return { kind:'ticket', type:'ticket' };
  if(r < 0.92) return { kind:'guts', type:'guts' };
  const type = TRAINING_TYPES[Math.floor(Math.random()*TRAINING_TYPES.length)];
  return { kind:'training', type };
}
function isNearRock(x, y, margin){
  for(const r of rocks){
    if(Math.hypot(x-r.x, y-r.y) < r.radius+margin) return true;
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
    } while((isNearRock(x,y,45) || isOnHazard(x,y,45)) && guard<20);
    lootItems.push({ id: nextId++, kind: pick.kind, type: pick.type, x, y, bob: rand(0,Math.PI*2) });
  }
}

// ===== マルチプレイ用: シード付き決定論的初期化 =====
function seededPickLootKindAndType(rng){
  const r = rng();
  if(r < 0.35){
    const r2 = rng();
    const type = r2<0.5 ? 'oilS' : (r2<0.85 ? 'oilM' : 'oilL');
    return { kind:'heal', type };
  }
  if(r < 0.62) return { kind:'ticket', type:'ticket' };
  if(r < 0.92) return { kind:'guts', type:'guts' };
  const type = TRAINING_TYPES[Math.floor(rng()*TRAINING_TYPES.length)];
  return { kind:'training', type };
}
function seededSpawnLoot(rng, n, center, radius){
  for(let i=0;i<n;i++){
    const pick = seededPickLootKindAndType(rng);
    let x, y, guard=0;
    do{
      // r=radius*sqrt(u) にすることで円内に均等な密度で分布させる(単純なrand(0,radius)は中心に偏る)
      const a = seededRand(rng,0,Math.PI*2), d = radius*Math.sqrt(seededRand(rng,0,1));
      x = center.x+Math.cos(a)*d; y = center.y+Math.sin(a)*d;
      guard++;
    } while((isNearRock(x,y,45) || isOnHazard(x,y,45)) && guard<20);
    lootItems.push({ id: nextId++, kind: pick.kind, type: pick.type, x, y, bob: seededRand(rng,0,Math.PI*2) });
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
  for(let y=-200; y<=WORLD.h+200; y+=step){
    const edge = seaEdgeX(y);
    seaZones.push({ x: edge-260, y, radius:520 });
  }
}
function genRiverZones(){
  riverZones = [];
  if(!currentMap.hasRiver) return;
  const n = Math.max(1, Math.round((currentMap.riverCount||0) * Math.sqrt(worldDensityScale||1)));
  const baseWidth = currentMap.riverWidth||220;
  for(let i=0;i<n;i++){
    const startY = rand(WORLD.h*0.08, WORLD.h*0.92);
    const wobbleFreq = rand(0.0006,0.0014);
    const wobbleAmp = rand(180,420);
    const wobblePhase = rand(0,Math.PI*2);
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
  for(let i=0;i<n;i++){
    const startY = seededRand(rng,WORLD.h*0.08, WORLD.h*0.92);
    const wobbleFreq = seededRand(rng,0.0006,0.0014);
    const wobbleAmp = seededRand(rng,180,420);
    const wobblePhase = seededRand(rng,0,Math.PI*2);
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
  let guard=0;
  while(oasisZones.length<n && guard<n*40){
    guard++;
    const x = rand(radius+200, WORLD.w-radius-200), y = rand(radius+200, WORLD.h-radius-200);
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
  let guard=0;
  while(oasisZones.length<n && guard<n*40){
    guard++;
    const x = seededRand(rng,radius+200, WORLD.w-radius-200), y = seededRand(rng,radius+200, WORLD.h-radius-200);
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
  for(const oz of oasisZones){ spawnLoot(7, oz, oz.radius*1.4); }
}
function seededSpawnOasisBonusLoot(rng){
  if(!currentMap.hasOasis) return;
  for(const oz of oasisZones){ seededSpawnLoot(rng, 7, oz, oz.radius*1.4); }
}
function seededPickSpawnPoint(rng){
  const R = ZONE_PHASES[0].holdRadius*0.85;
  for(let tries=0; tries<60; tries++){
    // r=R*sqrt(u) にすることで円内に均等な密度で分布させる(単純なrand(0,R)は中心に偏る)
    const a = seededRand(rng,0,Math.PI*2), r = R*Math.sqrt(seededRand(rng,0,1));
    const x = ZONE_CENTER0.x+Math.cos(a)*r, y = ZONE_CENTER0.y+Math.sin(a)*r;
    if(isOnHazard(x,y,60)) continue;
    let onRock=false;
    for(const rk of rocks){ if(Math.hypot(x-rk.x,y-rk.y) < rk.radius+40){ onRock=true; break; } }
    if(onRock) continue;
    return {x,y};
  }
  const a = seededRand(rng,0,Math.PI*2), r = R*Math.sqrt(seededRand(rng,0,1));
  return {x: ZONE_CENTER0.x+Math.cos(a)*r, y: ZONE_CENTER0.y+Math.sin(a)*r};
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
function spawnDmgText(x,y,z,val,color){ addParticle({type:'text',x,y,z,vx:rand(-10,10),vy:-50,life:0.7,maxLife:0.7,color:color||'#fff',text:String(val)}); }

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
  while(feed.children.length>5) feed.removeChild(feed.firstChild);
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
}

/* =====================================================================
   COMBAT
===================================================================== */
