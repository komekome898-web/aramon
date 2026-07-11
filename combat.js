function fireMove(attacker, target, move){
  attacker.guts = Math.max(0, attacker.guts - move.gutsCost);
  if(attacker.element==='ark' && move.tier===3){
    attacker.graceUntil = matchTime + 10;
  }
  if(move.melee){
    if(target && target.alive){
      applyDamage(target, move.dmg, attacker);
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
    const flightTime = throwDist / move.projSpeed;
    projectiles.push({
      id:nextId++, ownerId:attacker.id, x:attacker.x, y:attacker.y, z:attacker.z,
      lobbed:true, startX:attacker.x, startY:attacker.y, startZ:attacker.z,
      landX, landY, arcHeight: move.arcHeight||120,
      flightTime: Math.max(0.05, flightTime), flightT:0,
      dmg:move.dmg, color:move.color, hitR:move.hitR, splash:move.splash||0,
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
      vx:Math.cos(ang)*move.projSpeed, vy:Math.sin(ang)*move.projSpeed,
      dmg:move.dmg, color:move.color, hitR:move.hitR, hitW:move.hitW||0, splash:move.splash||0,
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
  if(source && source.alive){
    if(source.element==='rock'){ finalDmg *= ELEMENTS.rock.dmgDealtMod; }
    if(source.burnUntil > matchTime){ finalDmg *= 0.8; }
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
function resolveMovement(m, dt){
  const effSpeed = m.slowUntil > matchTime ? m.speed*0.5 : m.speed;
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
function effectiveCooldown(m, mv){
  const el = ELEMENTS[m.element];
  return mv.cooldown * (el.cooldownMod || 1);
}
function tryFire(m){
  if(m.fireCooldown>0) return;
  if(!m.attackTargetId) return;
  const t = getEntity(m.attackTargetId);
  if(!t || !t.alive) return;
  if(t.z - m.z > UPWARD_BLOCK_THRESHOLD) return;
  if(!m.isPlayer) m.moveTierSelected = pickBestAffordableTier(m);
  const mv = activeMove(m);
  if(m.guts < mv.gutsCost) return;
  const d = dist(m,t);
  if(d > mv.range) return;
  fireMove(m, t, mv);
  m.fireCooldown = effectiveCooldown(m, mv);
}
function tryPlayerFire(dt){
  if(!player.alive || player.fireCooldown>0) return;
  if(!(fireBtnHeld || keys['f'])) return;
  const mv = activeMove(player);
  if(player.guts < mv.gutsCost) return;
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
          if(e.moveTierUnlocked >= 3) continue;
          e.moveTierUnlocked = Math.min(3, e.moveTierUnlocked+1);
          e.moveTierSelected = e.moveTierUnlocked;
          const newMove = SIGNATURE_MOVES[e.element][e.moveTierUnlocked-1];
          if(e.isPlayer) pushToast(`${TICKET_ITEM.name}！「${newMove.name}」が使えるようになった`);
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
    if(e.guts<e.maxGuts) e.guts = Math.min(e.maxGuts, e.guts + 2*dt);
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
