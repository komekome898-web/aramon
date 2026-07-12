function fireMove(attacker, target, move){
  attacker.guts = Math.max(0, attacker.guts - effectiveGutsCost(attacker, move));
  if(attacker.element==='ark' && move.tier===3){
    attacker.graceUntil = matchTime + 10;
  }
  const effDmg = effectiveMoveDmg(attacker, move);
  const effProjSpeed = effectiveProjSpeed(attacker, move);
  if(move.melee){
    if(target && target.alive){
      applyDamage(target, effDmg, attacker);
      spawnHit(target.x, target.y, target.z, move.color);
    }
    return;
  }
  if(move.lobbed){
    const d = dist(attacker, target);
    const throwDist = Math.min(d, move.range);
    const ang = angTo(attacker, target) + rand(-1,1)*(attacker.isPlayer?0.015:0.05);
    const landX = attacker.x + Math.cos(ang)*throwDist;
    const landY = attacker.y + Math.sin(ang)*throwDist;
    const flightTime = throwDist / effProjSpeed;
    projectiles.push({
      id:nextId++, ownerId:attacker.id, x:attacker.x, y:attacker.y, z:attacker.z,
      lobbed:true, startX:attacker.x, startY:attacker.y, startZ:attacker.z,
      landX, landY, arcHeight: move.arcHeight||120,
      flightTime: Math.max(0.05, flightTime), flightT:0,
      dmg:effDmg, color:move.color, hitR:move.hitR, splash:move.splash||0,
    });
    return;
  }
  const burstCount = move.burst || 1;
  const burstGap = move.burstGap || 0;
  for(let i=0;i<burstCount;i++){
    const spreadOffset = burstCount>1 ? (i-(burstCount-1)/2)*0.05 : 0;
    const ang = angTo(attacker, target) + rand(-1,1)*(attacker.isPlayer?0.02:0.07) + spreadOffset;
    projectiles.push({
      id:nextId++, ownerId:attacker.id, x:attacker.x, y:attacker.y, z:attacker.z,
      vx:Math.cos(ang)*effProjSpeed, vy:Math.sin(ang)*effProjSpeed,
      dmg:effDmg, color:move.color, hitR:move.hitR, hitW:move.hitW||0, splash:move.splash||0,
      traveled:0, maxRange:move.range, delay: i*burstGap,
    });
  }
}
function isNetworkedHuman(ent){
  return netState.mode==='multi' && (ent.isPlayer || ent.isRemoteHuman);
}
function applyDamage(target, dmg, source, opts){
  if(!target.alive) return;
  const involvesHuman = isNetworkedHuman(target) || (source && isNetworkedHuman(source));
  const isAuthoritative = (opts && opts.authoritative) || (netState.mode==='multi' && netState.isHost);

  if(involvesHuman && !isAuthoritative){
    // マルチプレイで人間が関わる場合、見た目だけ即時反映しつつ、確定計算はホストに委ねる
    spawnHit(target.x, target.y, target.z, source ? ELEMENTS[source.element].color : '#ffffff');
    spawnDmgText(target.x, target.y, target.z, Math.round(dmg));
    if(netState.mode==='multi'){
      window.__aramonReportHit(netState.roomId, {
        targetNetId: target.netPlayerId || null, targetLocalId: target.id,
        sourceNetId: source? (source.netPlayerId||null) : null, sourceLocalId: source? source.id : null,
        dmg, sourceElement: source? source.element : null, ts: Date.now(),
      });
    }
    return;
  }

  let finalDmg = dmg;
  if(target.element==='rock'){ finalDmg *= ELEMENTS.rock.dmgTakenMod; }
  if(target.element==='ark' && target.graceUntil > matchTime){ finalDmg *= 0.5; }
  if(target.burnUntil > matchTime){ finalDmg *= 1.5; }
  if(target.trainDmgTakenMult){ finalDmg *= target.trainDmgTakenMult; }
  const targetStateEff = activeStateEffects(target);
  if(targetStateEff && targetStateEff.dmgTakenMult){ finalDmg *= targetStateEff.dmgTakenMult; }
  if(source && source.alive){
    const srcEl = ELEMENTS[source.element];
    if(srcEl.dmgDealtMod){ finalDmg *= srcEl.dmgDealtMod; }
  }
  target.hp -= finalDmg; target.hitFlash = 0.18;
  spawnDmgText(target.x, target.y, target.z, Math.round(finalDmg));
  if(source && source.id!==target.id){
    target.recentAttackers[source.id] = matchTime;
  }

  if(source && source.alive && source.id!==target.id){
    source.damageDealt += finalDmg;
    if(source.element==='aqua'){
      const healed = Math.min(finalDmg*0.2, source.maxHp - source.hp);
      if(healed > 0){
        source.hp += healed;
        spawnDmgText(source.x, source.y, source.z, '+'+Math.round(healed), '#7fffa0');
      }
      if(Math.random() < 0.2){
        target.freezeUntil = matchTime + 1;
      }
    }
    if(source.element==='leaf'){
      const drained = Math.min(finalDmg*0.3, target.guts);
      if(drained > 0){
        target.guts = Math.max(0, target.guts - drained);
        spawnDmgText(target.x, target.y, target.z, '-'+Math.round(drained)+'GT', '#ff7a96');
      }
    }
    if(source.element==='ark'){
      const drained = Math.min(finalDmg*0.45, target.guts);
      if(drained > 0){
        target.guts = Math.max(0, target.guts - drained);
        spawnDmgText(target.x, target.y, target.z, '-'+Math.round(drained)+'GT', '#ff7a96');
      }
    }
    if(source.element==='fire'){
      target.burnUntil = matchTime + 10;
    }
    if(source.element==='spark'){
      target.slowUntil = matchTime + 1;
    }
    if(source.element==='warm'){
      if(!(target.poisonUntil > matchTime)){
        target.poisonTickAt = matchTime + 1;
      }
      target.poisonUntil = matchTime + 10;
      target.poisonSourceId = source.id;
    }

    // 状態変化「必死」(プラント): 与えたダメージの一部を自分のHPに還元
    const srcStateEff = activeStateEffects(source);
    if(srcStateEff && srcStateEff.lifestealPct){
      const selfHeal = Math.min(finalDmg*srcStateEff.lifestealPct, source.maxHp - source.hp);
      if(selfHeal > 0){
        source.hp += selfHeal;
        spawnDmgText(source.x, source.y, source.z, '+'+Math.round(selfHeal), '#7fffa0');
      }
    }
    // 状態変化「元気」(ウンディーネ・ライガー): 技命中時に確率で発動
    const srcSc = STATE_CHANGES[source.element];
    if(srcSc && srcSc.trigger==='onHitChance' && canTriggerState(source) && Math.random() < srcSc.triggerValue){
      activateState(source);
    }
  }

  if(target.hp<=0){ killEntity(target, source); }
}
function killEntity(victim, killer){
  if(!victim.alive) return;
  victim.alive = false;
  victim.deathAt = matchTime;
  const aliveCount = entities.filter(e=>e.alive).length + 1;
  victim.placement = aliveCount;
  spawnDeath(victim.x, victim.y, victim.z, ELEMENTS[victim.element].color);
  if(killer && entities.includes(killer) && killer.id!==victim.id){
    killer.kills += 1;
    killer.hp = Math.min(killer.maxHp, killer.hp + 50);
    killer.guts = Math.min(killer.maxGuts, killer.guts + 50);
    spawnDmgText(killer.x, killer.y, killer.z, '+50', '#7fffa0');
    spawnDmgText(killer.x, killer.y, killer.z+30, '+50GT', '#ffd9e3');
    const kfText = `${displayNameFor(killer)} が ${displayNameFor(victim)} を倒した`;
    pushKillFeed(kfText);
    const iAmInvolved = netState.mode==='multi' && ((killer.isPlayer) || (victim.isPlayer));
    if(iAmInvolved) window.__aramonPushEvent(netState.roomId, {kind:'kill', text:kfText, ts:Date.now()});
    if(killer.isPlayer) pushToast('キルボーナス！ HP+50 ガッツ+50');
    const killerSc = STATE_CHANGES[killer.element];
    if(killerSc && killerSc.trigger==='onKill' && canTriggerState(killer)){
      activateState(killer);
    }
  } else {
    const kfText = `${displayNameFor(victim)} は安全圏外で力尽きた`;
    pushKillFeed(kfText);
    if(netState.mode==='multi' && victim.isPlayer) window.__aramonPushEvent(netState.roomId, {kind:'kill', text:kfText, ts:Date.now()});
  }
  if(victim.isPlayer){ onPlayerDown(); }
  checkWin();
}
function checkWin(){
  if(netState.mode==='multi' && !netState.isHost) return; // 勝敗判定はホストのみ確定させる
  const aliveList = entities.filter(e=>e.alive);
  if(aliveList.length<=1 && !game.over){
    if(aliveList.length===1){
      aliveList[0].placement = 1;
      if(aliveList[0].isPlayer){
        onPlayerWin();
      } else if(netState.mode==='multi' && netState.isHost && hostSpectating){
        // ホストは既に敗退し観戦していた場合、他の誰かが優勝した時点で結果画面へ
        showResult(false, player.placement||2);
      }
      if(netState.mode==='multi') window.__aramonPushEvent(netState.roomId, {kind:'matchEnd', winnerNetId: aliveList[0].netPlayerId||null, winnerName: aliveList[0].name, ts:Date.now()});
    }
  }
}

/* =====================================================================
   AI
===================================================================== */
function findNearestAliveEnemy(self, range){
  let best=null, bestD=range;
  for(const e of entities){
    if(e===self || !e.alive) continue;
    if(e.z - self.z > UPWARD_BLOCK_THRESHOLD) continue;
    const d=dist(self,e); if(d<bestD){bestD=d; best=e;}
  }
  return best;
}
function countRecentAttackers(self, windowSec){
  let count = 0;
  for(const id in self.recentAttackers){
    const t = self.recentAttackers[id];
    if(matchTime - t <= windowSec){
      const atk = getEntity(Number(id));
      if(atk && atk.alive) count++;
    }
  }
  return count;
}
function findNearestHealItem(self, range, safeZoneOnly){
  let best=null, bestD=range;
  for(const it of lootItems){
    if(it.kind!=='heal') continue;
    if(safeZoneOnly && dist(it, zoneState.center) > zoneState.radius) continue;
    const d = dist(self,it);
    if(d<bestD){ bestD=d; best=it; }
  }
  return best;
}
function findNearestLoot(self, range){
  let best=null, bestD=range;
  for(const it of lootItems){ const d=dist(self,it); if(d<bestD){bestD=d; best=it;} }
  return best;
}
function updateBotAI(b, dt){
  if(b.attackTargetId){ const t=getEntity(b.attackTargetId); if(!t||!t.alive) b.attackTargetId=null; }
  b.aiTimer -= dt;
  if(b.aiTimer>0) return;
  b.aiTimer = rand(0.22,0.4);

  const outOfZone = dist(b, zoneState.center) > zoneState.radius - b.radius;
  if(outOfZone){
    b.attackTargetId=null; b.destination=null;
    b.aiTargetPoint = {x:zoneState.center.x+rand(-30,30), y:zoneState.center.y+rand(-30,30)};
    b.aiState='RETREAT'; return;
  }

  const attackerCount = countRecentAttackers(b, 2.2);
  const lowHp = b.hp < b.maxHp*0.2;
  const overwhelmed = attackerCount >= 2;

  if(lowHp || overwhelmed){
    b.attackTargetId=null;
    const healItem = findNearestHealItem(b, 900, true) || findNearestHealItem(b, 900, false);
    if(healItem){
      b.aiTargetPoint = {x:healItem.x, y:healItem.y};
      b.aiState='FLEE_HEAL'; return;
    }
    const threat = findNearestAliveEnemy(b, 500);
    if(threat){
      const away = angTo(threat,b);
      b.aiTargetPoint = { x:b.x+Math.cos(away)*300, y:b.y+Math.sin(away)*300 };
    } else {
      b.aiTargetPoint = { x: zoneState.center.x+rand(-150,150), y: zoneState.center.y+rand(-150,150) };
    }
    b.aiState='FLEE'; return;
  }

  const enemy = findNearestAliveEnemy(b, 900);
  if(enemy){ b.attackTargetId = enemy.id; b.destination=null; b.aiState='FIGHT'; return; }

  const loot = findNearestLoot(b, 750);
  if(loot){ b.attackTargetId=null; b.aiTargetPoint = {x:loot.x,y:loot.y}; b.aiState='LOOT'; return; }

  b.attackTargetId=null;
  if(!b.aiTargetPoint || dist(b,b.aiTargetPoint)<40){
    const a=rand(0,Math.PI*2), r=rand(150,480);
    let tx=b.x+Math.cos(a)*r, ty=b.y+Math.sin(a)*r;
    tx = clamp(tx, zoneState.center.x-zoneState.radius+30, zoneState.center.x+zoneState.radius-30);
    ty = clamp(ty, zoneState.center.y-zoneState.radius+30, zoneState.center.y+zoneState.radius-30);
    b.aiTargetPoint = {x:tx,y:ty};
  }
  b.aiState='WANDER';
}

/* =====================================================================
   MOVEMENT
===================================================================== */
function computeVolcanoAvoidAngle(m, target, ang){
  if(!currentMap.hasVolcano || volcanoObstacles.length===0) return ang;
  const targetDist = dist(m, target);
  let strongestPush = 0, pushSign = m.avoidDirSign || 1;
  for(const v of volcanoObstacles){
    const clearance = v.radius + m.radius + 70;
    const obDist = dist(m, v);
    if(obDist > targetDist + clearance || obDist > 2600) continue;
    const toOb = angTo(m, v);
    let diff = toOb - ang;
    while(diff > Math.PI) diff -= Math.PI*2;
    while(diff < -Math.PI) diff += Math.PI*2;
    const blockAngle = Math.atan2(clearance, Math.max(obDist,1)) + 0.25;
    if(Math.abs(diff) < blockAngle){
      const pushAmount = Math.min(1.5, (clearance/Math.max(obDist,1))*1.4);
      if(pushAmount > strongestPush){
        strongestPush = pushAmount;
        pushSign = diff >= 0 ? -1 : 1; // 障害物が進路の右にあれば左へ、左にあれば右へ迂回
      }
    }
  }
  return strongestPush > 0 ? ang + pushSign*strongestPush : ang;
}
function resolveMovement(m, dt){
  if(m.freezeUntil > matchTime) return;
  const stateEff = activeStateEffects(m);
  const baseSpeed = m.speed * (m.trainSpeedMult||1) * (stateEff && stateEff.speedMult || 1);
  const effSpeed = m.slowUntil > matchTime ? baseSpeed*0.5 : baseSpeed;
  if(m.dashTimer>0){
    m.dashTimer -= dt;
    tryMoveAxis(m, m.dashDirX*effSpeed*3.0*dt, m.dashDirY*effSpeed*3.0*dt);
    return;
  }
  if(m.isPlayer || m.isRemoteHuman){
    tryMoveAxis(m, m.inputMoveX*effSpeed*dt, m.inputMoveY*effSpeed*dt);
    const moveLen = Math.hypot(m.inputMoveX,m.inputMoveY);
    if(moveLen>0.05){ m.lastMoveX=m.inputMoveX/moveLen; m.lastMoveY=m.inputMoveY/moveLen; }
    return;
  }
  let target = null;
  let mustMove = true;
  const outOfZone = dist(m, zoneState.center) > zoneState.radius - m.radius*0.4;
  if(outOfZone){
    target = zoneState.center;
  } else if(m.attackTargetId){
    const t = getEntity(m.attackTargetId);
    if(t && t.alive){
      const mv = activeMove(m);
      const d = dist(m,t);
      if(d > mv.range*0.92){ target = {x:t.x,y:t.y}; }
      else { mustMove=false; }
      m.facingAngle = angTo(m,t);
    } else { m.attackTargetId=null; target = m.destination; }
  } else if(m.destination){
    target = m.destination;
  } else {
    target = m.aiTargetPoint;
  }
  if(mustMove && target){
    const d = dist(m,target);
    if(d < 4){
      if(m.destination===target) m.destination=null;
      if(m.aiTargetPoint===target) m.aiTargetPoint=null;
      m.stuckTimer=0; m.stuckLevel=0;
    } else {
      let ang = angTo(m,target);
      if(!m.isPlayer){
        ang = computeVolcanoAvoidAngle(m, target, ang);
        m.stuckTimer += dt;
        if(m.stuckTimer > 0.4){
          const moved = dist(m, m.stuckCheckPos);
          if(moved < m.speed*0.4*m.stuckTimer*0.35){
            m.stuckLevel = Math.min(m.stuckLevel+1, 6);
          } else {
            m.stuckLevel = Math.max(m.stuckLevel-1, 0);
          }
          m.stuckCheckPos = {x:m.x, y:m.y};
          m.stuckTimer = 0;
          if(m.stuckLevel>=2 && Math.random()<0.5) m.avoidDirSign *= -1;
        }
        if(m.stuckLevel>0){
          ang += m.avoidDirSign * Math.min(m.stuckLevel*0.35, 1.9);
        }
      }
      const mx = Math.cos(ang), my = Math.sin(ang);
      tryMoveAxis(m, mx*effSpeed*dt, my*effSpeed*dt);
      m.lastMoveX=mx; m.lastMoveY=my;
      if(!m.attackTargetId) m.facingAngle = angTo(m,target);
    }
  }
}
function separateEntities(){
  for(let i=0;i<entities.length;i++){
    const a = entities[i]; if(!a.alive) continue;
    for(let j=i+1;j<entities.length;j++){
      const b = entities[j]; if(!b.alive) continue;
      if(Math.abs(a.z-b.z) > 30) continue;
      const minD = a.radius+b.radius-4;
      const d = dist(a,b);
      if(d>0 && d<minD){
        const push = (minD-d)/2;
        const ang = angTo(b,a);
        const px=Math.cos(ang)*push, py=Math.sin(ang)*push;
        a.x+=px; a.y+=py; b.x-=px; b.y-=py;
      }
    }
  }
}
function computePlayerInput(){
  let fwd = 0, strafe = 0;
  if(keys['w']||keys['arrowup']) fwd += 1;
  if(keys['s']||keys['arrowdown']) fwd -= 1;
  if(keys['d']||keys['arrowright']) strafe += 1;
  if(keys['a']||keys['arrowleft']) strafe -= 1;
  if(joystick.active){ fwd += -joystick.ny; strafe += joystick.nx; }
  fwd = clamp(fwd,-1,1); strafe = clamp(strafe,-1,1);
  const yaw = camState.yaw;
  let mx = fwd*Math.cos(yaw) + strafe*Math.cos(yaw+Math.PI/2);
  let my = fwd*Math.sin(yaw) + strafe*Math.sin(yaw+Math.PI/2);
  const len = Math.hypot(mx,my);
  if(len>1){ mx/=len; my/=len; }
  player.inputMoveX = mx;
  player.inputMoveY = my;
  player.facingAngle = yaw;
}
function updateCamera(){
  camPos.x = player.x - Math.cos(camState.yaw)*camState.distBehind;
  camPos.y = player.y - Math.sin(camState.yaw)*camState.distBehind;
  camPos.z = player.z + camState.height;
}
function updateCameraSnap(dt){
  if(!camSnap.active) return;
  camSnap.t += dt;
  const t = clamp(camSnap.t/camSnap.duration, 0, 1);
  const eased = 1 - Math.pow(1-t, 3);
  camState.yaw = lerp(camSnap.fromYaw, camSnap.toYaw, eased);
  if(t>=1) camSnap.active=false;
}
function startCameraSnap(target){
  const desired = angTo(player, target);
  let diff = desired - camState.yaw;
  while(diff > Math.PI) diff -= Math.PI*2;
  while(diff < -Math.PI) diff += Math.PI*2;
  camSnap.active = true;
  camSnap.fromYaw = camState.yaw;
  camSnap.toYaw = camState.yaw + diff;
  camSnap.t = 0;
  camSnap.duration = 0.28;
  pushToast(`${target.name} に視点を合わせた`);
}
function turnCameraByDegrees(deg){
  camSnap.active = true;
  camSnap.fromYaw = camState.yaw;
  camSnap.toYaw = camState.yaw + deg*Math.PI/180;
  camSnap.t = 0;
  camSnap.duration = 0.18;
}

/* =====================================================================
   MAIN UPDATE
===================================================================== */
function activeStateEffects(m){
  const sc = STATE_CHANGES[m.element];
  if(!sc || !(m.stateUntil > matchTime)) return null;
  return sc.effects;
}
function canTriggerState(m){
  return !(m.stateUntil > matchTime) && !(m.stateCooldownUntil > matchTime);
}
function activateState(m){
  const sc = STATE_CHANGES[m.element];
  if(!sc) return;
  m.stateUntil = matchTime + sc.duration;
  m.stateCooldownUntil = matchTime + sc.cooldown;
  spawnDmgText(m.x, m.y, m.z, sc.name+'!', '#ff3b3b');
  if(m.isPlayer) pushToast(`${sc.name} 発動！(${sc.duration}秒間)`);
}
// HP割合・ガッツ割合による条件は継続的にチェックする必要があるため、毎フレーム呼び出す
function checkPassiveStateTriggers(m){
  const sc = STATE_CHANGES[m.element];
  if(!sc || !canTriggerState(m)) return;
  if(sc.trigger==='hpBelow' && m.maxHp>0 && (m.hp/m.maxHp) <= sc.triggerValue){
    activateState(m);
  } else if(sc.trigger==='gutsBelow' && m.maxGuts>0 && (m.guts/m.maxGuts) <= sc.triggerValue){
    activateState(m);
  }
}
function effectiveCooldown(m, mv){
  const el = ELEMENTS[m.element];
  const eff = activeStateEffects(m);
  return mv.cooldown * (el.cooldownMod || 1) * (m.trainCooldownMult || 1) * (eff && eff.cooldownMult || 1);
}
function effectiveGutsCost(m, mv){
  const eff = activeStateEffects(m);
  const scaled = mv.gutsCost * (eff && eff.gutsCostMult || 1);
  return Math.max(1, Math.round(scaled) - (m.trainGutsCostReduction || 0));
}
function effectiveProjSpeed(m, mv){
  return mv.projSpeed * (m.trainProjSpeedMult || 1);
}
function effectiveMoveDmg(m, mv){
  const eff = activeStateEffects(m);
  return mv.dmg * (m.trainDmgMult || 1) * (eff && eff.dmgMult || 1);
}
function tryFire(m){
  if(m.freezeUntil > matchTime) return;
  if(m.fireCooldown>0) return;
  if(!m.attackTargetId) return;
  const t = getEntity(m.attackTargetId);
  if(!t || !t.alive) return;
  if(t.z - m.z > UPWARD_BLOCK_THRESHOLD) return;
  if(!m.isPlayer) m.moveTierSelected = pickBestAffordableTier(m);
  const mv = activeMove(m);
  if(m.guts < effectiveGutsCost(m, mv)) return;
  const d = dist(m,t);
  if(d > mv.range) return;
  fireMove(m, t, mv);
  m.fireCooldown = effectiveCooldown(m, mv);
}
function tryPlayerFire(dt){
  if(!player.alive || player.fireCooldown>0) return;
  if(player.freezeUntil > matchTime) return;
  if(!(fireBtnHeld || keys['f'])) return;
  const mv = activeMove(player);
  if(player.guts < effectiveGutsCost(player, mv)) return;
  let aimAngle = player.facingAngle;
  if(mv.melee){
    let best=null, bestD=mv.range;
    const fx=Math.cos(player.facingAngle), fy=Math.sin(player.facingAngle);
    for(const e of entities){
      if(e===player || !e.alive) continue;
      if(e.z - player.z > UPWARD_BLOCK_THRESHOLD) continue;
      const d = dist(player,e);
      if(d>mv.range) continue;
      const dirx=(e.x-player.x)/Math.max(d,0.001), diry=(e.y-player.y)/Math.max(d,0.001);
      if(dirx*fx+diry*fy>0.55 && d<bestD){ bestD=d; best=e; }
    }
    fireMove(player, best, mv);
  } else {
    const aim = { x: player.x+Math.cos(player.facingAngle)*1000, y: player.y+Math.sin(player.facingAngle)*1000 };
    fireMove(player, aim, mv);
  }
  player.fireCooldown = effectiveCooldown(player, mv);
}
function updateProjectiles(dt){
  for(let i=projectiles.length-1;i>=0;i--){
    const p = projectiles[i];
    if(p.lobbed){
      p.flightT += dt;
      const t = clamp(p.flightT / p.flightTime, 0, 1);
      p.x = lerp(p.startX, p.landX, t);
      p.y = lerp(p.startY, p.landY, t);
      p.z = p.startZ + Math.sin(t*Math.PI)*p.arcHeight;
      if(t>=1){
        for(const e of entities){
          if(!e.alive || e.id===p.ownerId) continue;
          if(dist(p,e) < e.radius+p.splash) applyDamage(e, p.dmg, getEntity(p.ownerId));
        }
        spawnHit(p.x,p.y,0,p.color);
        spawnDeath(p.x,p.y,0,p.color);
        projectiles.splice(i,1);
      }
      continue;
    }
    if(p.delay>0){ p.delay -= dt; continue; }
    const step = Math.hypot(p.vx,p.vy)*dt;
    p.x += p.vx*dt; p.y += p.vy*dt; p.traveled += step;
    let hit=false;
    if(p.traveled >= p.maxRange) hit=true;
    if(p.x<0||p.x>WORLD.w||p.y<0||p.y>WORLD.h) hit=true;
    if(!hit){
      for(const r of rocks){
        if(p.z >= r.height) continue;
        if(Math.hypot(p.x-r.x,p.y-r.y) < r.radius+p.hitR){
          spawnHit(p.x,p.y,p.z,p.color);
          hit=true; break;
        }
      }
    }
    if(!hit){
      for(const e of entities){
        if(!e.alive || e.id===p.ownerId) continue;
        if(e.z - p.z > UPWARD_BLOCK_THRESHOLD) continue;
        let hitNow;
        if(p.hitW>p.hitR){
          const rx=e.x-p.x, ry=e.y-p.y;
          hitNow = Math.abs(rx) < e.radius+p.hitW && Math.abs(ry) < e.radius+p.hitR;
        } else {
          hitNow = dist(p,e) < e.radius+p.hitR;
        }
        if(hitNow){
          applyDamage(e, p.dmg, getEntity(p.ownerId));
          if(p.splash>0){
            for(const o of entities){
              if(o===e || !o.alive || o.id===p.ownerId) continue;
              if(o.z - p.z > UPWARD_BLOCK_THRESHOLD) continue;
              if(dist(p,o)<p.splash) applyDamage(o, p.dmg*0.6, getEntity(p.ownerId));
            }
          }
          spawnHit(e.x,e.y,e.z,p.color);
          hit=true; break;
        }
      }
    }
    if(hit) projectiles.splice(i,1);
  }
}
function updateLootPickups(){
  for(let i=lootItems.length-1;i>=0;i--){
    const it = lootItems[i];
    if(dist(it, zoneState.center) > zoneState.radius){
      lootItems.splice(i,1);
      continue;
    }
    let consumed = false;
    for(const e of entities){
      if(!e.alive) continue;
      if(dist(e,it) < e.radius+14){
        if(it.kind==='heal'){
          const hi = HEAL_ITEMS[it.type];
          if(e.hp >= e.maxHp){
            const boost = Math.round(hi.heal * 0.2);
            e.maxHp += boost;
            e.hp += boost;
            spawnDmgText(e.x, e.y, e.z, '上限+'+boost, '#ffe06b');
            if(e.isPlayer) pushToast(`${hi.name}：HP上限+${boost}`);
            consumed = true;
          } else {
            const healed = Math.min(hi.heal, e.maxHp-e.hp);
            e.hp += healed;
            spawnDmgText(e.x, e.y, e.z, '+'+Math.round(healed), '#7fffa0');
            if(e.isPlayer) pushToast(`${hi.name} で HP+${Math.round(healed)}`);
            consumed = true;
          }
        } else if(it.kind==='guts'){
          e.maxGuts += GUTS_ITEM.maxBoost;
          const restored = Math.min(GUTS_ITEM.restore, e.maxGuts-e.guts);
          e.guts = Math.min(e.maxGuts, e.guts + GUTS_ITEM.restore);
          spawnDmgText(e.x, e.y, e.z, '+'+Math.round(restored), '#ffd9e3');
          if(e.isPlayer) pushToast(`${GUTS_ITEM.name} で ガッツ上限+${GUTS_ITEM.maxBoost}・ガッツ+${Math.round(restored)}`);
          consumed = true;
        } else if(it.kind==='ticket'){
          if(e.moveTierUnlocked >= 3){
            const roll = Math.random();
            if(roll < 1/3){
              e.trainCooldownMult *= 0.93;
              spawnDmgText(e.x, e.y, e.z, '連射UP', '#9fd1ff');
              if(e.isPlayer) pushToast(`${TICKET_ITEM.name}：技の連射速度が上がった！`);
            } else if(roll < 2/3){
              e.trainGutsCostReduction += 1;
              spawnDmgText(e.x, e.y, e.z, '消費ガッツDOWN', '#9fd1ff');
              if(e.isPlayer) pushToast(`${TICKET_ITEM.name}：全技の消費ガッツが下がった！`);
            } else {
              e.trainProjSpeedMult *= 1.10;
              spawnDmgText(e.x, e.y, e.z, '弾速UP', '#9fd1ff');
              if(e.isPlayer) pushToast(`${TICKET_ITEM.name}：技の弾速が上がった！`);
            }
            consumed = true;
          } else {
            e.moveTierUnlocked = Math.min(3, e.moveTierUnlocked+1);
            e.moveTierSelected = e.moveTierUnlocked;
            const newMove = SIGNATURE_MOVES[e.element][e.moveTierUnlocked-1];
            if(e.isPlayer) pushToast(`${TICKET_ITEM.name}！「${newMove.name}」が使えるようになった`);
            consumed = true;
          }
        } else if(it.kind==='training'){
          const ti = TRAINING_ITEMS[it.type];
          if(it.type==='weight'){
            e.trainDmgMult *= 1.16;
            e.maxHp += 30; e.hp += 30;
          } else if(it.type==='meditate'){
            e.trainGutsCostReduction += 2;
            e.trainProjSpeedMult *= 1.20;
          } else if(it.type==='pool'){
            e.maxHp += 36; e.hp += 36;
            e.trainDmgTakenMult *= 0.90;
          } else if(it.type==='floor'){
            e.trainSpeedMult *= 1.12;
            e.trainCooldownMult *= 0.86;
          }
          spawnDmgText(e.x, e.y, e.z, ti.emoji+' 強化', ti.accent);
          if(e.isPlayer) pushToast(`${ti.emoji} ${ti.name}：${ti.desc}`);
          consumed = true;
        }
      }
      if(consumed) break;
    }
    if(consumed) lootItems.splice(i,1);
  }
}
function update(dt){
  matchTime += dt;
  if(game.tipTimer>0) game.tipTimer -= dt;
  updateZone(dt);
  updateCameraSnap(dt);
  computePlayerInput();

  for(const e of entities){ if(e.alive && !e.isPlayer && !e.isRemoteHuman) updateBotAI(e, dt); }
  for(const e of entities){ if(e.alive) resolveMovement(e, dt); }
  separateEntities();
  updateCamera();

  for(const e of entities){
    if(!e.alive) continue;
    if(e.fireCooldown>0) e.fireCooldown -= dt;
    if(e.dashCooldown>0) e.dashCooldown -= dt;
    if(e.hitFlash>0) e.hitFlash -= dt;
    const stateEffForGuts = activeStateEffects(e);
    if(e.guts<e.maxGuts) e.guts = Math.min(e.maxGuts, e.guts + 2*dt*(ELEMENTS[e.element].gutsRegenMod||1)*(stateEffForGuts && stateEffForGuts.gutsRegenMult || 1));
    checkPassiveStateTriggers(e);
    if(e.poisonUntil > matchTime && matchTime >= e.poisonTickAt){
      e.poisonTickAt = matchTime + 1;
      const dmg = Math.min(5, e.hp - 1);
      if(dmg > 0){
        e.hp -= dmg;
        e.hitFlash = 0.12;
        spawnDmgText(e.x, e.y, e.z, Math.round(dmg), '#c07bf0');
        const poisoner = entities.find(o=>o.id===e.poisonSourceId);
        if(poisoner && poisoner.alive && poisoner.id!==e.id){
          poisoner.damageDealt += dmg;
        }
      }
    }
    if(e.isPlayer) tryPlayerFire(dt);
    else if(!e.isRemoteHuman) tryFire(e);
  }
  updateProjectiles(dt);
  updateLootPickups();

  const dps = currentDps();
  if(dps>0){
    for(const e of entities){
      if(!e.alive) continue;
      if(dist(e, zoneState.center) > zoneState.radius){
        e.hp -= dps*dt;
        if(Math.random()<0.08) spawnDmgText(e.x, e.y, e.z, Math.round(dps), '#ff9c3d');
        if(e.hp<=0) killEntity(e, null);
      }
    }
  }

  if(lavaZones.length>0){
    for(const e of entities){
      if(!e.alive) continue;
      let inLava = false;
      for(const lz of lavaZones){
        if(Math.hypot(e.x-lz.x, e.y-lz.y) < lz.radius + e.radius*0.4){ inLava = true; break; }
      }
      if(inLava){
        const lavaDps = currentMap.lavaDps || 20;
        e.hp -= lavaDps*dt;
        if(Math.random()<0.12) spawnDmgText(e.x, e.y, e.z, Math.round(lavaDps), '#ff5a1f');
        if(e.hp<=0) killEntity(e, null);
      }
    }
  }

  for(let i=particles.length-1;i>=0;i--){
    const p = particles[i];
    p.x += p.vx*dt; p.y += p.vy*dt;
    if(p.type==='text') p.vy += 60*dt;
    p.life -= dt;
    if(p.life<=0) particles.splice(i,1);
  }

  updateHUD();
}

/* =====================================================================
   PROJECTION (lightweight 3rd-person camera)
===================================================================== */
