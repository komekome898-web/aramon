let entities = [];
let buildings = [];
let rocks = [];
let volcanoObstacles = [];
let lavaZones = [];
let currentMap = MAPS.wild;
let projectiles = [];
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

function getViewportSize(){
  if(window.visualViewport){
    return { w: window.visualViewport.width, h: window.visualViewport.height };
  }
  return { w: window.innerWidth, h: window.innerHeight };
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
  spawnLoot(30, zoneState.toCenter, zoneState.toRadius*0.8);
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
  // 火山は高さに関係なく(飛び越え不可)常にブロックする
  for(const v of volcanoObstacles){
    if(Math.hypot(x-v.x, y-v.y) < v.radius+m.radius) return true;
  }
  return false;
}
function tryMoveAxis(m, dx, dy){
  const fullX = clamp(m.x+dx, m.radius, WORLD.w-m.radius);
  const fullY = clamp(m.y+dy, m.radius, WORLD.h-m.radius);
  if(!blockedByHeight(m,fullX,fullY) && !blockedByRock(m,fullX,fullY) && !blockedByVolcano(m,fullX,fullY)){
    m.x = fullX; m.y = fullY;
    m.z = getTerrainHeightAt(m.x, m.y);
    return;
  }
  const onlyX = clamp(m.x+dx, m.radius, WORLD.w-m.radius);
  if(!blockedByHeight(m,onlyX,m.y) && !blockedByRock(m,onlyX,m.y) && !blockedByVolcano(m,onlyX,m.y)) m.x = onlyX;
  const onlyY = clamp(m.y+dy, m.radius, WORLD.h-m.radius);
  if(!blockedByHeight(m,m.x,onlyY) && !blockedByRock(m,m.x,onlyY) && !blockedByVolcano(m,m.x,onlyY)) m.y = onlyY;
  m.z = getTerrainHeightAt(m.x, m.y);
}
const MIN_SPAWN_SEPARATION = 500;
function isOnHazard(x,y,margin){
  for(const v of volcanoObstacles){ if(Math.hypot(x-v.x,y-v.y) < v.radius+margin) return true; }
  for(const lz of lavaZones){ if(Math.hypot(x-lz.x,y-lz.y) < lz.radius+margin) return true; }
  return false;
}
function pickSpawnPoint(){
  for(let tries=0; tries<60; tries++){
    const a = rand(0,Math.PI*2), r = rand(0, ZONE_PHASES[0].holdRadius*0.85);
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
  const a = rand(0,Math.PI*2), r = rand(0, ZONE_PHASES[0].holdRadius*0.85);
  return {x: ZONE_CENTER0.x+Math.cos(a)*r, y: ZONE_CENTER0.y+Math.sin(a)*r};
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
  let complexId = 0;
  for(const site of currentMap.volcanoSites){
    complexId++;
    const cx = WORLD.w*site.xr, cy = WORLD.h*site.yr;
    const radius = site.radius;
    volcanoObstacles.push({ x:cx, y:cy, radius, isMain:true, complexId });
    for(let i=0;i<site.peakBumps;i++){
      const a = (i/site.peakBumps)*Math.PI*2 + rand(-0.15,0.15);
      const d = radius*rand(0.55,0.85);
      volcanoObstacles.push({ x:cx+Math.cos(a)*d, y:cy+Math.sin(a)*d, radius: radius*rand(0.25,0.4), complexId });
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
    rocks.push({ id:nextId++, x, y, radius, height:radius*1.3, seed:rand(0,10) });
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
      const a = rand(0,Math.PI*2), d = rand(0,radius);
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
      const a = seededRand(rng,0,Math.PI*2), d = seededRand(rng,0,radius);
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
  let complexId = 0;
  for(const site of currentMap.volcanoSites){
    complexId++;
    const cx = WORLD.w*site.xr, cy = WORLD.h*site.yr;
    const radius = site.radius;
    volcanoObstacles.push({ x:cx, y:cy, radius, isMain:true, complexId });
    for(let i=0;i<site.peakBumps;i++){
      const a = (i/site.peakBumps)*Math.PI*2 + seededRand(rng,-0.15,0.15);
      const d = radius*seededRand(rng,0.55,0.85);
      volcanoObstacles.push({ x:cx+Math.cos(a)*d, y:cy+Math.sin(a)*d, radius: radius*seededRand(rng,0.25,0.4), complexId });
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
  const count = currentMap.rockCount;
  let guard=0;
  while(rocks.length<count && guard<count*50){
    guard++;
    const rr = rng();
    const radius = rr<0.5 ? seededRand(rng,22,34) : (rr<0.85 ? seededRand(rng,34,52) : seededRand(rng,52,72));
    const x = seededRand(rng,80,WORLD.w-80), y = seededRand(rng,80,WORLD.h-80);
    if(isOnHazard(x,y,radius+220)) continue;
    rocks.push({ id:nextId++, x, y, radius, height:radius*1.3, seed:seededRand(rng,0,10) });
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
  const count = currentMap.decorCount;
  for(let i=0;i<count;i++){
    const x = seededRand(rng,40,WORLD.w-40), y = seededRand(rng,40,WORLD.h-40);
    if(isOnHazard(x,y,70)) continue;
    terrainDecor.push({ x, y, r: seededRand(rng,5,16), shade: rng()<0.5 ? 'dark':'light' });
  }
}
function seededPickSpawnPoint(rng){
  for(let tries=0; tries<60; tries++){
    const a = seededRand(rng,0,Math.PI*2), r = seededRand(rng,0, ZONE_PHASES[0].holdRadius*0.85);
    const x = ZONE_CENTER0.x+Math.cos(a)*r, y = ZONE_CENTER0.y+Math.sin(a)*r;
    if(isOnHazard(x,y,60)) continue;
    let onRock=false;
    for(const rk of rocks){ if(Math.hypot(x-rk.x,y-rk.y) < rk.radius+40){ onRock=true; break; } }
    if(onRock) continue;
    return {x,y};
  }
  const a = seededRand(rng,0,Math.PI*2), r = seededRand(rng,0, ZONE_PHASES[0].holdRadius*0.85);
  return {x: ZONE_CENTER0.x+Math.cos(a)*r, y: ZONE_CENTER0.y+Math.sin(a)*r};
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

/* =====================================================================
   COMBAT
===================================================================== */
