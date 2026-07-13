let lastT = performance.now();

/* =====================================================================
   MULTIPLAYER MATCH LOGIC (全員並行実行方式)
   - 全プレイヤーが同じシードから同じ初期状態(岩・地形・ルート・ボット構成・
     全員のスポーン地点)をローカルで再現する
   - 各自は「自分の入力」だけを高頻度で送信し、他人のエンティティは
     受け取った入力を使って各自のローカルでシミュレーションする
   - ホスト/非ホストという役割の違いは、部屋作成時のシード決定にしか残らない
===================================================================== */
const INPUT_SEND_INTERVAL = 0.06;   // 自分の入力を送る間隔(秒) 約16回/秒
let lastInputSendAt = 0;
let remoteInputs = {};   // playerId -> {mx,my,facing,wantFire,wantDash,moveTierSelected}

function seedFromString(str){
  let h = 2166136261;
  for(let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h>>>0;
}

async function beginMultiplayerMatch(){
  if(game.started || matchBeginning) return;
  matchBeginning = true;
  document.getElementById('lobbyScreen').classList.add('hidden');
  document.getElementById('resultScreen').classList.add('hidden');

  entities=[]; projectiles=[]; lootItems=[]; particles=[]; areaEffects=[]; nextId=1;
  matchTime=0; game.over=false; game.tipTimer=7; hostSpectating=false;
  camState.yaw = 0; camState.pitch = 0.27;
  camSnap.active = false;
  monsterScreenPos.clear();
  Object.keys(keys).forEach(k=>keys[k]=false);
  fireBtnHeld=false; joystick.active=false; joystick.nx=0; joystick.ny=0;
  joyKnobEl.style.transform='translate(0,0)';
  remoteInputs = {}; processedHitKeys.clear(); authPublishTimer=0;
  pendingRemoteFireEvents.length = 0; processedFireEventKeys.clear();

  // 部屋のシードと確定参加者リストを決定/取得
  // ホストが「試合開始が確定した瞬間の参加者一覧」を1回だけ書き込み、非ホストはそれだけを読む(誰も新規にgetしない)
  let seed, fixedPlayers, mapKey;
  if(netState.isHost){
    seed = (Date.now() ^ Math.floor(Math.random()*0xffffffff)) >>> 0;
    fixedPlayers = netState.humanPlayers || {};
    if(!fixedPlayers[netState.myPlayerId]){
      fixedPlayers = { ...fixedPlayers, [netState.myPlayerId]: { name:'名無しのモンスター', element: game.selectedElement } };
    }
    mapKey = game.selectedMap || 'wild';
    console.log('[aramon] HOST: publishing seed+fixedPlayers+mapKey', seed, fixedPlayers, mapKey);
    await window.__aramonSetRoomSeed(netState.roomId, seed, fixedPlayers, mapKey);
  } else {
    console.log('[aramon] NON-HOST: waiting for seed+fixedPlayers...');
    const result = await window.__aramonWaitForRoomSeed(netState.roomId, 10000);
    if(result){
      seed = result.seed;
      fixedPlayers = result.fixedPlayers;
      mapKey = result.mapKey || 'wild';
      console.log('[aramon] NON-HOST: received seed+fixedPlayers+mapKey', seed, fixedPlayers, mapKey);
    } else {
      // タイムアウト時のみ、やむを得ずローカルの直近スナップショットで代用する
      seed = seedFromString(netState.roomId);
      fixedPlayers = netState.humanPlayers || {};
      mapKey = game.selectedMap || 'wild';
      console.warn('[aramon] NON-HOST: TIMEOUT, falling back to local snapshot', seed, fixedPlayers);
    }
  }
  netState.humanPlayers = fixedPlayers;
  currentMap = MAPS[mapKey] || MAPS.wild;
  console.log('[aramon] final fixedPlayers used for this match:', JSON.stringify(fixedPlayers));

  const rng = makeSeededRng(seed);

  initZone();
  seededGenVolcanoAndLava(rng);
  seededGenRocks(rng);
  seededGenTerrain(rng);

  // 参加している人間プレイヤーの一覧を「IDの文字列順」で確定させる(全員が同じ順序で処理するため)
  const humanList = Object.keys(fixedPlayers||{}).map(id=>({ id, ...fixedPlayers[id] }));
  if(!humanList.find(h=>h.id===netState.myPlayerId)){
    humanList.push({ id:netState.myPlayerId, name:'名無しのモンスター', element: game.selectedElement });
  }
  humanList.sort((a,b)=> a.id<b.id?-1:(a.id>b.id?1:0));

  let idCounter = 1;
  for(const h of humanList){
    const sp = seededPickSpawnPoint(rng);
    const isMe = h.id===netState.myPlayerId;
    const ent = createMonster(h.element||'fire', isMe, h.name||'プレイヤー', { id: idCounter++, spawnPoint: sp });
    ent.netPlayerId = h.id;
    if(isMe){ ent.isPlayer = true; player = ent; }
    else { ent.isPlayer=false; ent.isRemoteHuman=true; }
    entities.push(ent);
  }

  const usedSlots = humanList.length;
  const botCount = Math.max(0, netState.capacity - usedSlots);
  const names = seededShuffle(rng, BOT_NAMES);
  const botElements = seededShuffle(rng, Object.keys(ELEMENTS));
  for(let i=0;i<botCount;i++){
    const elKey = botElements[i % botElements.length];
    const sp = seededPickSpawnPoint(rng);
    const nm = names[i % names.length] + (i>=names.length?'Ⅱ':'');
    entities.push(createMonster(elKey, false, nm, { id: idCounter++, spawnPoint: sp }));
  }

  seededSpawnLoot(rng, 420, ZONE_CENTER0, ZONE_PHASES[0].holdRadius*0.95);
  updateCamera();

  window.__aramonWatchInputs(netState.roomId, (players)=>{
    netState.humanPlayers = players||{};
    for(const id in players){
      if(id===netState.myPlayerId) continue;
      if(players[id] && players[id].input) remoteInputs[id] = players[id].input;
    }
  });
  window.__aramonWatchEvents(netState.roomId, (evt)=>{
    if(evt && evt.kind==='kill' && evt.text) pushKillFeed(evt.text);
    if(evt && evt.kind==='matchEnd' && !game.over){
      if(player && player.netPlayerId===evt.winnerNetId && player.alive){ onPlayerWin(); }
    }
  });

  if(netState.isHost){
    window.__aramonWatchHitsAsHost(netState.roomId, (hitKey, hit)=>{
      if(processedHitKeys.has(hitKey)) return;
      processedHitKeys.add(hitKey);
      processHitAsHost(hit);
    });
    window.__aramonWatchFireEvents(netState.roomId, (evtKey, evt)=>{
      if(processedFireEventKeys.has(evtKey)) return;
      processedFireEventKeys.add(evtKey);
      pendingRemoteFireEvents.push(evt);
    });
  }
  window.__aramonWatchAuthState(netState.roomId, (authState)=>{
    if(authState) applyAuthState(authState);
  });

  document.getElementById('startScreen').classList.add('hidden');
  game.started=true;
  pushToast('バトル開始！（マルチプレイ）');
}

// 他プレイヤーの入力を、対応するローカルエンティティに反映する
function applyRemoteInputsLocally(){
  for(const id in remoteInputs){
    if(id===netState.myPlayerId) continue;
    const ent = entities.find(e=>e.netPlayerId===id);
    if(!ent || !ent.alive) continue;
    const inp = remoteInputs[id];
    if(!inp) continue;
    ent.inputMoveX = clamp(inp.mx||0,-1,1);
    ent.inputMoveY = clamp(inp.my||0,-1,1);
    ent.facingAngle = typeof inp.facing==='number' ? inp.facing : ent.facingAngle;
    if(typeof inp.moveTierSelected==='number') ent.moveTierSelected = inp.moveTierSelected;
  }
}
// ホスト専用: 非ホストから届いた「1回発射しました」イベントを、届いた分だけ正確に処理する
const pendingRemoteFireEvents = [];
const processedFireEventKeys = new Set();
function processRemoteFireEvents(){
  while(pendingRemoteFireEvents.length){
    const evt = pendingRemoteFireEvents.shift();
    const ent = entities.find(e=>e.netPlayerId===evt.sourceNetId);
    if(!ent || !ent.alive) continue;
    ent.facingAngle = evt.facing;
    if(typeof evt.moveTier==='number') ent.moveTierSelected = evt.moveTier;
    const mv = activeMove(ent);
    if(ent.guts < effectiveGutsCost(ent, mv)) continue;
    let targetPoint;
    if(mv.melee){
      let best=null, bestD=mv.range;
      const fx=Math.cos(ent.facingAngle), fy=Math.sin(ent.facingAngle);
      for(const e2 of entities){
        if(e2===ent || !e2.alive) continue;
        if(e2.z - ent.z > UPWARD_BLOCK_THRESHOLD) continue;
        const d = dist(ent,e2);
        if(d>mv.range) continue;
        const dirx=(e2.x-ent.x)/Math.max(d,0.001), diry=(e2.y-ent.y)/Math.max(d,0.001);
        if(dirx*fx+diry*fy>0.55 && d<bestD){ bestD=d; best=e2; }
      }
      targetPoint = best;
    } else {
      targetPoint = { x: ent.x+Math.cos(ent.facingAngle)*1000, y: ent.y+Math.sin(ent.facingAngle)*1000 };
    }
    fireMove(ent, targetPoint, mv);
    ent.fireCooldown = effectiveCooldown(ent, mv);
  }
}

function sendLocalInputIfMultiplayer(now){
  if(netState.mode!=='multi' || !netState.roomId) return;
  if(now-lastInputSendAt >= INPUT_SEND_INTERVAL*1000){
    lastInputSendAt = now;
    window.__aramonSendInput(netState.roomId, {
      mx: player? player.inputMoveX:0,
      my: player? player.inputMoveY:0,
      facing: player? player.facingAngle:0,
      moveTierSelected: player? player.moveTierSelected:1,
    });
  }
}

// 自分が実際に1回発射した瞬間だけ、単発イベントとして送信する
// (ホストはこれを見て、非ホストの発射をシミュレーションに反映する)
function sendFireEventIfMultiplayer(aimAngle, mv){
  if(netState.mode!=='multi' || !netState.roomId || netState.isHost) return;
  window.__aramonSendFireEvent(netState.roomId, {
    sourceNetId: netState.myPlayerId,
    facing: aimAngle,
    moveTier: player.moveTierSelected,
    ts: Date.now(),
  });
}

// 非ホスト専用: ダメージ・ガッツの確定計算はホストに任せつつ、
// クールダウン管理と「発射しました」イベント送信、体感のための見た目の弾だけを担当する
function tryNonHostPlayerFireVisual(dt){
  if(!player.alive || player.fireCooldown>0) return;
  if(!(fireBtnHeld || keys['f'])) return;
  const mv = activeMove(player);
  if(player.guts < effectiveGutsCost(player, mv)) return;
  const aimAngle = player.facingAngle;

  // クールダウン・見た目のガッツ消費だけローカルで進める(実値はホストのauthStateで上書きされる)
  player.fireCooldown = effectiveCooldown(player, mv);
  player.guts = Math.max(0, player.guts - effectiveGutsCost(player, mv));
  const effProjSpeed = effectiveProjSpeed(player, mv);

  if(mv.aoeShape){
    const width = mv.rectWidth||mv.beamWidth||mv.zigzagWidth||0;
    const fillSpeed = Math.max(200, effProjSpeed||900);
    const beamRanges = mv.aoeShape==='beams' ? Array.from({length:mv.beamCount||3}, ()=>mv.range) : undefined;
    const life = 0.18 + (beamRanges ? Math.max(...beamRanges) : mv.range)/fillSpeed + 0.25;
    areaEffects.push({
      id:nextId++, ownerId:player.id, kind:mv.aoeShape, x:player.x, y:player.y, z:player.z,
      angle:aimAngle, color:mv.color, range:mv.range, width,
      fanAngleDeg:mv.fanAngleDeg||45, beamCount:mv.beamCount||3, beamSpreadDeg:mv.beamSpreadDeg||40,
      beamRanges, fillSpeed, telegraphTime:0.18,
      spawnAt:matchTime, life,
    });
  } else if(mv.lobbed){
    const throwDist = mv.range;
    const landX = player.x + Math.cos(aimAngle)*throwDist;
    const landY = player.y + Math.sin(aimAngle)*throwDist;
    const flightTime = throwDist / effProjSpeed;
    projectiles.push({
      x:player.x, y:player.y, z:player.z,
      lobbed:true, startX:player.x, startY:player.y, startZ:player.z,
      landX, landY, arcHeight: mv.arcHeight||120,
      flightTime: Math.max(0.05, flightTime), flightT:0,
      color:mv.color, hitR:mv.hitR, hitW:0, visualOnly:true, icon:mv.icon, shape:mv.shape,
    });
  } else if(!mv.melee){
    const burstCount = mv.burst || 1;
    const burstGap = mv.burstGap || 0;
    for(let i=0;i<burstCount;i++){
      const spreadOffset = burstCount>1 ? (i-(burstCount-1)/2)*0.05 : 0;
      const ang = aimAngle + spreadOffset;
      projectiles.push({
        x:player.x, y:player.y, z:player.z,
        vx:Math.cos(ang)*effProjSpeed, vy:Math.sin(ang)*effProjSpeed,
        color:mv.color, hitR:mv.hitR, hitW:mv.hitW||0,
        traveled:0, maxRange:mv.range, delay: i*burstGap, visualOnly:true, icon:mv.icon, shape:mv.shape,
      });
    }
  } else {
    spawnHit(player.x + Math.cos(aimAngle)*mv.range*0.5, player.y + Math.sin(aimAngle)*mv.range*0.5, player.z, mv.color);
  }

  sendFireEventIfMultiplayer(aimAngle, mv);
}

// ===== ホスト専用: 命中報告を確定計算し、authStateとして配信 =====
const processedHitKeys = new Set();
let authPublishTimer = 0;
const AUTH_PUBLISH_INTERVAL = 0.02;

function processHitAsHost(hit){
  if(!hit) return;
  const target = entities.find(e=>
    (hit.targetNetId && e.netPlayerId===hit.targetNetId) || (!hit.targetNetId && e.id===hit.targetLocalId)
  );
  const source = hit.sourceNetId ? entities.find(e=>e.netPlayerId===hit.sourceNetId)
                 : (hit.sourceLocalId!=null ? entities.find(e=>e.id===hit.sourceLocalId) : null);
  if(!target || !target.alive) return;
  applyDamage(target, hit.dmg, source||null, {authoritative:true});
}

function buildAuthStatePayload(){
  const payload = { players:{}, zone:{
    cx: Math.round(zoneState.center.x), cy: Math.round(zoneState.center.y),
    r: Math.round(zoneState.radius), phase: zoneState.phaseIndex, shrinking: zoneState.shrinking,
  }, aliveCount: entities.filter(e=>e.alive).length, projectiles: [] };
  for(const e of entities){
    if(!e.netPlayerId) continue;
    payload.players[e.netPlayerId] = {
      hp: Math.round(e.hp), maxHp: e.maxHp, guts: Math.round(e.guts), maxGuts: e.maxGuts,
      alive: e.alive, kills: e.kills, damageDealt: Math.round(e.damageDealt),
      x: Math.round(e.x), y: Math.round(e.y), moveTierUnlocked: e.moveTierUnlocked,
      trainCooldownMult: e.trainCooldownMult, trainGutsCostReduction: e.trainGutsCostReduction,
      trainProjSpeedMult: e.trainProjSpeedMult, trainDmgMult: e.trainDmgMult,
      trainDmgTakenMult: e.trainDmgTakenMult, trainSpeedMult: e.trainSpeedMult,
      stateUntil: e.stateUntil, stateCooldownUntil: e.stateCooldownUntil,
    };
  }
  for(const p of projectiles){
    payload.projectiles.push({
      x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z||0),
      c: p.color, r: p.hitR, w: p.hitW||0, icon: p.icon||null, shape: p.shape||null,
    });
  }
  payload.areaEffects = areaEffects.map(ae=>({
    id: ae.id, kind: ae.kind, x: Math.round(ae.x), y: Math.round(ae.y), angle: ae.angle, c: ae.color,
    range: ae.range, width: ae.width, fanAngleDeg: ae.fanAngleDeg, beamCount: ae.beamCount,
    beamSpreadDeg: ae.beamSpreadDeg, life: ae.life, fillSpeed: ae.fillSpeed, telegraphTime: ae.telegraphTime,
    beamRanges: ae.beamRanges||null,
  }));
  return payload;
}

function applyAuthState(authState){
  if(!authState) return;
  if(authState.zone){
    zoneState.center.x = authState.zone.cx;
    zoneState.center.y = authState.zone.cy;
    zoneState.radius = authState.zone.r;
    zoneState.phaseIndex = authState.zone.phase;
    zoneState.shrinking = authState.zone.shrinking;
  }
  const players = authState.players || {};
  for(const netId in players){
    const a = players[netId];
    const ent = entities.find(e=>e.netPlayerId===netId);
    if(!ent) continue;
    ent.hp = a.hp; ent.maxHp = a.maxHp; ent.guts = a.guts; ent.maxGuts = a.maxGuts;
    ent.kills = a.kills; ent.damageDealt = a.damageDealt;
    if(typeof a.trainCooldownMult==='number') ent.trainCooldownMult = a.trainCooldownMult;
    if(typeof a.trainGutsCostReduction==='number') ent.trainGutsCostReduction = a.trainGutsCostReduction;
    if(typeof a.trainProjSpeedMult==='number') ent.trainProjSpeedMult = a.trainProjSpeedMult;
    if(typeof a.trainDmgMult==='number') ent.trainDmgMult = a.trainDmgMult;
    if(typeof a.trainDmgTakenMult==='number') ent.trainDmgTakenMult = a.trainDmgTakenMult;
    if(typeof a.trainSpeedMult==='number') ent.trainSpeedMult = a.trainSpeedMult;
    if(typeof a.stateUntil==='number') ent.stateUntil = a.stateUntil;
    if(typeof a.stateCooldownUntil==='number') ent.stateCooldownUntil = a.stateCooldownUntil;
    if(typeof a.moveTierUnlocked==='number' && a.moveTierUnlocked>ent.moveTierUnlocked){
      ent.moveTierUnlocked = a.moveTierUnlocked;
      if(ent.isPlayer && ent.moveTierSelected < ent.moveTierUnlocked) ent.moveTierSelected = ent.moveTierUnlocked;
    }
    if(ent.alive && !a.alive){
      ent.alive = false; ent.hp = 0;
      if(ent.isPlayer && !game.over) onPlayerDown();
    }
    // 位置は大きくズレた時だけ補正(通常はローカル計算を優先し滑らかさを保つ)
    if(!ent.isPlayer && Math.hypot(ent.x-a.x, ent.y-a.y) > 400){ ent.x=a.x; ent.y=a.y; }
  }
  if(Array.isArray(authState.projectiles)){
    const localVisualOnly = projectiles.filter(p=>p.visualOnly);
    const hostProjectiles = authState.projectiles.map(p=>({ x:p.x, y:p.y, z:p.z, color:p.c, hitR:p.r, hitW:p.w||0, icon:p.icon||undefined, shape:p.shape||undefined }));
    projectiles = hostProjectiles.concat(localVisualOnly);
  }
  if(Array.isArray(authState.areaEffects)){
    const seenIds = new Set(areaEffects.filter(ae=>ae.hostId!=null).map(ae=>ae.hostId));
    for(const ae of authState.areaEffects){
      if(seenIds.has(ae.id)) continue;
      areaEffects.push({
        hostId: ae.id, kind: ae.kind, x: ae.x, y: ae.y, angle: ae.angle, color: ae.c,
        range: ae.range, width: ae.width, fanAngleDeg: ae.fanAngleDeg, beamCount: ae.beamCount,
        beamSpreadDeg: ae.beamSpreadDeg, spawnAt: matchTime, life: ae.life,
        fillSpeed: ae.fillSpeed||900, telegraphTime: ae.telegraphTime||0.18, beamRanges: ae.beamRanges||undefined,
      });
    }
  }
}


function loop(now){
  const dt = Math.min(0.05, (now-lastT)/1000);
  lastT = now;

  if(game.started && !game.over){
    if(netState.mode!=='multi'){
      update(dt);
    } else if(netState.isHost){
      applyRemoteInputsLocally();
      processRemoteFireEvents();
      update(dt);
      sendLocalInputIfMultiplayer(now);
      authPublishTimer += dt;
      if(authPublishTimer >= AUTH_PUBLISH_INTERVAL){
        authPublishTimer = 0;
        window.__aramonPublishAuthState(netState.roomId, buildAuthStatePayload());
      }
    } else {
      // 非ホスト: ダメージ・ガッツ・キル・ゾーン等の確定計算は一切行わず、
      // 自分の移動だけをローカルで滑らかに再現し、残りはホストからのauthState配信に委ねる
      updateCameraSnap(dt);
      computePlayerInput();
      if(player && player.alive) resolveMovement(player, dt);
      for(const e of entities){
        if(!e.alive) continue;
        if(e.fireCooldown>0) e.fireCooldown -= dt;
        if(e.dashCooldown>0) e.dashCooldown -= dt;
        if(e.hitFlash>0) e.hitFlash -= dt;
      }
      tryNonHostPlayerFireVisual(dt);
      // 自分が撃った見た目専用の弾だけをローカルで移動させる(当たり判定はホストが確定する)
      for(let i=projectiles.length-1;i>=0;i--){
        const p = projectiles[i];
        if(!p.visualOnly) continue;
        if(p.lobbed){
          p.flightT += dt;
          const t = clamp(p.flightT / p.flightTime, 0, 1);
          p.x = lerp(p.startX, p.landX, t);
          p.y = lerp(p.startY, p.landY, t);
          p.z = p.startZ + Math.sin(t*Math.PI)*p.arcHeight;
          if(t>=1){
            spawnHit(p.x,p.y,0,p.color);
            projectiles.splice(i,1);
          }
          continue;
        }
        if(p.delay>0){ p.delay -= dt; continue; }
        const step = Math.hypot(p.vx,p.vy)*dt;
        p.x += p.vx*dt; p.y += p.vy*dt; p.traveled += step;
        if(p.traveled >= p.maxRange) projectiles.splice(i,1);
      }
      updateCamera();
      matchTime += dt;
      if(game.tipTimer>0) game.tipTimer -= dt;
      for(let i=particles.length-1;i>=0;i--){
        const p = particles[i];
        p.x += p.vx*dt; p.y += p.vy*dt;
        if(p.type==='text') p.vy += 60*dt;
        p.life -= dt;
        if(p.life<=0) particles.splice(i,1);
      }
      for(let i=areaEffects.length-1;i>=0;i--){
        if(matchTime - areaEffects[i].spawnAt > areaEffects[i].life) areaEffects.splice(i,1);
      }
      updateHUD();
      sendLocalInputIfMultiplayer(now);
    }
  }

  if(game.started) render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

