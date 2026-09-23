/* =====================================================================
   狙撃銃とスコープ(探検モード専用)

   ■ 入口の判定は sniperModeOn() の1か所だけ。探検モード(game.explore)以外では
     ボタンも出ず、視野角もカメラも何も変わらない(下の関数はすべて最初にここを見て帰る)。
   ■ 他担当が呼ぶ入口
       sniperGive(ent, 'longbow')      … 狙撃銃を渡す(満タンの弾で。スコープは持っていれば残す)
       sniperAttachScope(ent, 'x8')    … スコープを付ける('iron'/'x2'/'x4'/'x8'。表は data.js)
       sniperResetState()              … 試合の入口で呼ぶ(exploreResetState から)。構え・倍率を全部戻す
       ent.weakPoint = { from:0.62, to:1, mult:1.5, onHit(ent, info){} }
                                       … 弱点(頭側)の約束。当たった高さ÷背の高さ が from〜to なら
                                         クリティカル(威力 = 武器の critMult × mult)。onHit は部位破壊用
       ent.bodyH                       … 当たりの背の高さ(ワールド単位)。無ければ 半径×SNIPER_BODY_H_PER_RADIUS
       ent.sniperDmgMult               … 装備などで威力を上げる倍率(無ければ1)
   ■ 視野角(倍率ズーム)の上書きは world.js の setViewZoom() 1か所。**描画1フレームの間だけ**掛けて
     sniperFrameEnd() で1へ戻す。2Dの project() と real3d / fx_gl の3Dカメラは同じ値を読む。
     ユーザーの視点設定(lookSettings.fovDeg)は書き換えない。構えのカメラ(目の位置)・揺れ・反動も
     同じく描画の間だけ camPos / camState に足して、終わったら戻す(試合の状態は汚さない)。
   ■ 弾は既存の projectiles に積む(ホスト権威・配信の形は既存の弾と同じ項目を持つ)。
     高速なので進め方と当たりだけ sniperStepProjectile() が受け持つ(combat.js の updateProjectiles から)。
     落下は既存の弾道: 重力 = projGravityFor(射程, 弾速) × 武器の drop、ゼロインは ballisticSlope。
===================================================================== */

/* 開発用デモ(統合前の確認・撮影ハーネス用)。探検モードが無くても、この試合の自機にだけ狙撃銃を持たせる。
   **持ち主(その試合の player)が変われば自動で無効**になるので、次の試合に持ち越さない。 */
let sniperDemoOwner = null;
function sniperModeOn(){
  if(typeof game !== 'object' || !game || !game.started || !player) return false;
  return !!game.explore || (sniperDemoOwner !== null && sniperDemoOwner === player);
}

const SNIPER_SUBSTEP      = 18;    // 弾を進める刻み(ワールド単位)。体(半径20〜)をすり抜けない細かさ
const SNIPER_TRAIL_KEEP   = 24;    // 光の筋に残す点の数(約3刻みごとに1点)
const SNIPER_GUN_OFFSET   = { right:7, down:9, converge:320 };   // 見た目の銃口のずれ(右・下)。この距離で照準の線へ寄る
const SNIPER_AIM_STEP     = 18;    // 距離計の地形探索の刻み

const sniperView = {
  ads:false, blend:0, logMag:0,
  breathHeld:false, holding:false, breath:1, spent:false,
  amp:0, swayT:0, offYaw:0, offPitch:0,
  recoil:0, recoilV:0, recoilX:0, recoilXV:0,
  flash:0, smoke:[], fx:[], aim:null,
  prevHeld:false, lastMs:0, saved:null, dirty:false,
  domSig:'', ringReload:-1, ringBreath:-1, bodyAds:false, canvasOn:false,
};

/* ---------- 持ち物 ---------- */
function sniperGive(ent, weaponKey){
  const w = (typeof SNIPER_WEAPONS === 'object') ? SNIPER_WEAPONS[weaponKey] : null;
  if(!ent || !w) return false;
  ent.sniper = { weapon:weaponKey, ammo:w.mag, cycleLeft:0, reloadLeft:0 };
  if(!ent.sniperScope || !SNIPER_SCOPES[ent.sniperScope]) ent.sniperScope = w.defaultScope || 'iron';
  return true;
}
function sniperAttachScope(ent, scopeKey){
  if(!ent || typeof SNIPER_SCOPES !== 'object' || !SNIPER_SCOPES[scopeKey]) return false;
  ent.sniperScope = scopeKey;
  return true;
}
function sniperWeapon(ent){ return (ent && ent.sniper && SNIPER_WEAPONS[ent.sniper.weapon]) || null; }
function sniperScope(ent){ return SNIPER_SCOPES[(ent && ent.sniperScope) || 'iron'] || SNIPER_SCOPES.iron; }
function sniperEyeZ(ent){ return (ent.z||0) + AIM_MUZZLE_Z; }   // 目の高さ=銃口の高さ(視差を出さない)

function sniperResetState(){
  const v = sniperView;
  v.ads = false; v.blend = 0; v.logMag = 0;
  v.breathHeld = false; v.holding = false; v.breath = 1; v.spent = false;
  v.amp = 0; v.offYaw = 0; v.offPitch = 0;
  v.recoil = 0; v.recoilV = 0; v.recoilX = 0; v.recoilXV = 0;
  v.flash = 0; v.smoke.length = 0; v.fx.length = 0; v.aim = null; v.prevHeld = false;
  v.dirty = false;
  if(typeof setViewZoom === 'function') setViewZoom(1);
  sniperSyncDom(false);
}

/* ---------- 操作(input.js から) ---------- */
function sniperCanAds(me){
  if(!me || !me.alive || !sniperWeapon(me)) return false;
  if(game.over) return false;
  if(typeof introState === 'object' && introState && introState.active) return false;
  if(typeof spectatingNow === 'function' && spectatingNow()) return false;
  if(typeof entityDowned === 'function' && entityDowned(me)) return false;
  return true;
}
function sniperToggleAds(){
  if(!sniperModeOn() || !sniperCanAds(player)){ sniperView.ads = false; return false; }
  sniperView.ads = !sniperView.ads;
  sniperView.prevHeld = false;   // 構えた瞬間に「離した」と数えて誤射しない
  playSe('sniper', { kind: sniperView.ads ? 'scope' : 'unscope' });
  return sniperView.ads;
}
function sniperHoldBreath(on){ sniperView.breathHeld = !!on; }
// 視点の感度の倍率(input.js の applyLookDelta から)。構えていなければ常に1
function sniperLookSensMult(){
  if(!sniperModeOn()) return 1;
  const m = Math.exp(sniperView.logMag);
  if(m <= 1.001) return 1;
  return Math.min(1, SNIPER_ADS_SENS_BASE / Math.pow(m, SNIPER_ADS_SENS_EXP));
}
function sniperHidesSelf(){ return sniperModeOn() && sniperView.blend > 0.35; }

/* ---------- 引き金(combat.js の tryPlayerFire から毎フレーム) ----------
   構え中は FIRE = 狙撃銃の引き金。**押して(滑らせて狙い)離した瞬間に撃つ。**
   FIREを押した指を滑らせると視点が動く(fireDragAim)ので、押した瞬間に撃つと狙う暇が無い。
   タップでも「押す→離す」で1発出るので、素早く撃ちたいときも困らない。 */
function sniperOwnsTrigger(dt){
  if(!sniperModeOn() || !player) return false;
  const me = player, s = me.sniper, w = sniperWeapon(me);
  if(!s || !w) return false;
  if(s.cycleLeft > 0) s.cycleLeft = Math.max(0, s.cycleLeft - dt);
  if(s.reloadLeft > 0){
    s.reloadLeft = Math.max(0, s.reloadLeft - dt);
    if(s.reloadLeft === 0) s.ammo = w.mag;
  } else if(s.ammo <= 0 && s.cycleLeft === 0 && me.alive){
    s.reloadLeft = w.reloadSec;           // 撃ち切ったら自動で装填
    playSe('sniper', { kind:'reload', dur:w.reloadSec });
  }
  if(!sniperView.ads){ sniperView.prevHeld = false; return false; }
  const held = !!(fireBtnHeld || keys['f']);
  const released = sniperView.prevHeld && !held;
  sniperView.prevHeld = held;
  if(released){
    if(sniperCanShoot(me)) sniperFire(me);
    else playSe('sniper', { kind:'dry' });
  }
  return true;
}
function sniperCanShoot(me){
  const s = me.sniper;
  if(!me.alive || !s) return false;
  if(me.freezeUntil > matchTime) return false;
  if(typeof entityDowned === 'function' && entityDowned(me)) return false;
  return s.ammo > 0 && s.cycleLeft <= 0 && s.reloadLeft <= 0;
}
// 落下の強さ(既存の弾道の重力 × 武器の drop)とゼロインの打ち上げ
function sniperBallistics(w){
  const grav = projGravityFor(w.range, w.speed) * (w.drop || 1);
  const zero = ballisticSlope(0, SNIPER_ZERO_M * PING_UNITS_PER_M, w.speed, grav);
  return { grav, zero };
}
function sniperFire(me){
  const w = sniperWeapon(me), s = me.sniper;
  s.ammo -= 1; s.cycleLeft = w.cycleSec;
  // 狙点は画面の中心(照準)= 見えていた視線そのもの(揺れ・反動を含む)
  const yaw = camState.yaw + sniperView.offYaw;
  const pitch = camState.pitch + sniperView.offPitch;
  const b = sniperBallistics(w);
  const slope = clamp(-Math.tan(pitch) + b.zero, -AIM_SLOPE_LIMIT, AIM_SLOPE_LIMIT);
  const z = sniperEyeZ(me);
  projectiles.push({
    id:nextId++, ownerId:me.id, x:me.x, y:me.y, z,
    vx:Math.cos(yaw)*w.speed, vy:Math.sin(yaw)*w.speed, vz:slope*w.speed, grav:b.grav, terrain3d:true,
    dmg:w.dmg * (me.sniperDmgMult || 1), color:w.tracer, hitR:w.hitR, splash:0,
    traveled:0, maxRange:w.range, delay:0,
    sniper:s.weapon, critMult:w.critMult, trail:[{ x:me.x, y:me.y, z, d:0 }],
  });
  // 反動: 視野の半分に対する割合で跳ね上げる(倍率が違っても画面上の跳ね方は同じ)
  // (倍率は描画の間しか掛かっていないので、いまの倍率から視野の半分を出し直す)
  const halfFov = Math.atan(Math.tan(lookSettings.fovDeg*Math.PI/360) / Math.exp(sniperView.logMag));
  const peak = w.recoil * halfFov;
  const W = SNIPER_RECOIL_RETURN;
  sniperView.recoilV += peak * W * Math.E;                       // 臨界減衰ばねの山がちょうど peak になる初速
  sniperView.recoilXV += (Math.random()*2-1) * peak * 0.25 * W * Math.E;
  sniperView.flash = 1;
  // 硝煙(窓の下から湧いて上へ流れる。単位は窓の半径)
  for(let i=0;i<6;i++) sniperView.smoke.push({ x:(Math.random()-0.5)*0.7, y:0.45+Math.random()*0.35,
    vx:(Math.random()-0.5)*0.3, vy:-0.28-Math.random()*0.25, r:0.2+Math.random()*0.16, t:0, life:0.6+Math.random()*0.4 });
  playSe('sniper', { kind:'shot', cycle:w.cycleSec });
}

/* ---------- 弾の進め方と当たり(combat.js の updateProjectiles から) ---------- */
function sniperTrailPush(p){
  p.trail.push({ x:p.x, y:p.y, z:p.z, d:p.traveled });
  if(p.trail.length > SNIPER_TRAIL_KEEP) p.trail.shift();
}
function sniperStepProjectile(p, dt){
  const hs = Math.hypot(p.vx, p.vy);
  const n = Math.max(1, Math.min(60, Math.ceil(hs*dt / SNIPER_SUBSTEP)));
  const h = dt / n;
  const owner = getEntity(p.ownerId) || null;
  for(let k=0;k<n;k++){
    const x0 = p.x, y0 = p.y, z0 = p.z;
    p.x += p.vx*h; p.y += p.vy*h; p.z += p.vz*h; p.vz -= (p.grav||0)*h; p.traveled += hs*h;
    const hit = sniperSegmentHit(p, x0, y0, z0, p.x, p.y, p.z);
    if(hit){ p.x = hit.x; p.y = hit.y; p.z = hit.z; sniperTrailPush(p); sniperOnHit(p, hit, owner); return true; }
    const gz = terrainZAt(p.x, p.y);
    if(p.z <= gz){ p.z = gz; sniperTrailPush(p); sniperImpact(p, 'ground'); return true; }
    if(sniperHitsObstacle(p)){ sniperTrailPush(p); sniperImpact(p, 'rock'); return true; }
    if(p.traveled >= p.maxRange || p.x<0 || p.x>WORLD.w || p.y<0 || p.y>WORLD.h) return true;
    if(k % 3 === 2) sniperTrailPush(p);
  }
  sniperTrailPush(p);
  return false;
}
// 岩・山(判定の式は updateProjectiles と同じ)
function sniperHitsObstacle(p){
  for(const r of rocks){
    const R = r.radius + (p.hitR||0);
    if(Math.abs(p.x-r.x) > R || Math.abs(p.y-r.y) > R) continue;
    if(p.z >= baseTerrainHeightAt(r.x, r.y) + r.height) continue;
    if(Math.hypot(p.x-r.x, p.y-r.y) < R) return true;
  }
  for(const v of volcanoObstacles){
    const vTop = getTerrainHeightAt(v.x, v.y);
    if(Math.hypot(p.x-v.x, p.y-v.y) < mountainRadiusAt(v, p.z - vTop) + (p.hitR||0)) return true;
  }
  return false;
}
function sniperBodyH(e){ return e.bodyH || (e.radius||26) * SNIPER_BODY_H_PER_RADIUS; }
/* 線分(弾の1刻み)と、立った円柱(体)の交わり。いちばん手前の1体を返す。
   上下も見るので、頭の上を越えた弾・足元の地面に刺さった弾は当たらない。 */
function sniperSegmentHit(p, x0, y0, z0, x1, y1, z1){
  let best = null;
  const dx = x1-x0, dy = y1-y0, dz = z1-z0;
  const a = dx*dx + dy*dy;
  if(a < 1e-6) return null;
  const hr = p.hitR || 0;
  for(const e of entities){
    if(!e.alive || e.id === p.ownerId) continue;
    if(typeof projTeamBlocked === 'function' && projTeamBlocked(p, e)) continue;
    const R = (e.radius||26) * SNIPER_HIT_RADIUS_MULT + hr;
    const fx = x0-e.x, fy = y0-e.y;
    const b = 2*(fx*dx + fy*dy), c = fx*fx + fy*fy - R*R;
    let disc = b*b - 4*a*c;
    if(disc < 0) continue;
    disc = Math.sqrt(disc);
    const tA = Math.max(0, (-b-disc)/(2*a)), tB = Math.min(1, (-b+disc)/(2*a));
    if(tA > tB) continue;
    const H = sniperBodyH(e), ez = e.z||0, lo = ez - hr, hi = ez + H + hr;
    const zA = z0 + dz*tA, zB = z0 + dz*tB;
    let t = null;
    if(zA >= lo && zA <= hi) t = tA;
    else {
      const d = zB - zA;
      if(Math.abs(d) > 1e-6){
        const u = (zA > hi ? (hi - zA) : (lo - zA)) / d;
        if(u >= 0 && u <= 1) t = tA + (tB-tA)*u;
      }
    }
    if(t == null) continue;
    if(!best || t < best.t) best = { t, e, H, x:x0+dx*t, y:y0+dy*t, z:z0+dz*t };
  }
  return best;
}
function sniperOnHit(p, hit, owner){
  const e = hit.e, wp = e.weakPoint;
  const ratio = clamp(((hit.z - (e.z||0)) / hit.H), 0, 1);
  const crit = !!(wp && ratio >= (wp.from != null ? wp.from : SNIPER_WEAK_FROM) && ratio <= (wp.to != null ? wp.to : 1.05));
  const mult = crit ? (p.critMult || 1) * (wp.mult || 1) : 1;
  const hp0 = e.hp;
  const n0 = particles.length;
  applyDamage(e, p.dmg * mult, owner, {});
  /* 数字はスコープの中で大きく出し直すので、applyDamage が出した素の数字だけ取り除く
     (回復・ガッツ削りなど記号付きの数字は残す)。出した値=確定したダメージをそのまま使う。 */
  let shown = null;
  for(let i=particles.length-1; i>=n0; i--){
    const pt = particles[i];
    if(pt && pt.type === 'text' && /^\d+$/.test(pt.text)){ shown = +pt.text; particles.splice(i,1); }
  }
  const dealt = shown != null ? shown : Math.max(0, Math.round(hp0 - e.hp));
  if(crit && typeof wp.onHit === 'function'){
    try{ wp.onHit(e, { dmg:dealt, ratio, x:hit.x, y:hit.y, z:hit.z, source:owner }); }catch(_){}
  }
  spawnHit(hit.x, hit.y, hit.z, crit ? '#ffb02e' : '#fff0d0');
  for(let i=0;i<(crit?12:5);i++){
    const a = Math.random()*Math.PI*2, sp = 60 + Math.random()*(crit?220:120);
    addParticle({ type:'spark', x:hit.x, y:hit.y, z:hit.z, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp,
                  life:0.45, maxLife:0.45, color: crit ? (i%2 ? '#ff5a3a' : '#ffd24a') : '#ffe6b8', size:2+Math.random()*3 });
  }
  if(owner && owner === player){
    if(dealt > 0) sniperView.fx.push({ kind:'hit', x:hit.x, y:hit.y, z:hit.z, dmg:dealt, crit, kill:!e.alive, t:0, life:1.15 });
    playSe('sniper', { kind: crit ? 'crit' : 'hit' });
  }
}
function sniperImpact(p, kind){
  const dust = kind === 'rock' ? '#b9b2a6' : '#cbb792';
  for(let i=0;i<7;i++){
    const a = Math.random()*Math.PI*2, sp = 30 + Math.random()*80;
    addParticle({ type:'spark', x:p.x, y:p.y, z:p.z+2, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp,
                  life:0.55, maxLife:0.55, color:dust, size:3+Math.random()*4 });
  }
  const owner = getEntity(p.ownerId);
  if(owner && owner === player) sniperView.fx.push({ kind:'impact', x:p.x, y:p.y, z:p.z, t:0, life:0.7, rock: kind === 'rock' });
}

/* ---------- 毎フレーム(render.js の render() の最初と最後) ---------- */
function sniperEase(t){ t = clamp(t, 0, 1); return t*t*(3-2*t); }
function sniperFrame(){
  const now = performance.now();
  const dt = sniperView.lastMs ? Math.min(0.05, Math.max(0, (now - sniperView.lastMs)/1000)) : 0.016;
  sniperView.lastMs = now;
  sniperView.saved = null;
  if(!sniperModeOn()){
    if(sniperView.dirty) sniperResetState();
    setViewZoom(1);
    return;
  }
  sniperView.dirty = true;
  const v = sniperView, me = player;
  if(!sniperCanAds(me)) v.ads = false;
  const w = sniperWeapon(me), sc = sniperScope(me);
  // 構えの進み(カメラの寄せ・窓の開き)と倍率(対数でなめらかに)
  const rate = v.ads ? 1/SNIPER_ADS_IN_SEC : 1/SNIPER_ADS_OUT_SEC;
  v.blend = clamp(v.blend + (v.ads ? 1 : -1) * rate * dt, 0, 1);
  const logT = Math.log(v.ads ? sc.mag : 1);
  v.logMag += (logT - v.logMag) * (1 - Math.exp(-dt*SNIPER_ZOOM_RATE));
  if(Math.abs(v.logMag - logT) < 0.002) v.logMag = logT;
  // 息止め(数秒で限界→使い切ると息が半分戻るまで揺れが大きい)
  v.holding = !!(v.ads && v.breathHeld && !v.spent && v.breath > 0);
  if(v.holding){
    v.breath -= dt / SNIPER_BREATH_MAX_SEC;
    if(v.breath <= 0){ v.breath = 0; v.spent = true; v.holding = false; }
  } else {
    v.breath = Math.min(1, v.breath + dt / SNIPER_BREATH_RECOVER_SEC);
    if(v.spent && v.breath >= 0.5) v.spent = false;
  }
  // 8の字の揺れ(倍率が高いほど大きい。息止めで収まり、歩くと増える)
  let ampT = w ? w.sway * sc.sway : 0;
  if(v.holding) ampT *= SNIPER_BREATH_SWAY;
  else if(v.spent) ampT *= SNIPER_EXHAUST_SWAY;
  const moving = (typeof joystick === 'object' && Math.hypot(joystick.nx, joystick.ny) > 0.25) || game.autoRun;
  if(moving) ampT *= SNIPER_MOVE_SWAY_MULT;
  v.amp += (ampT - v.amp) * (1 - Math.exp(-dt*(v.holding ? 5 : 2.5)));
  v.swayT += dt;
  const ph = v.swayT * Math.PI*2 / SNIPER_SWAY_PERIOD;
  const e = sniperEase(v.blend);
  const sx = Math.sin(ph) + 0.16*Math.sin(ph*2.7 + 1.3);
  const sy = 0.5*Math.sin(ph*2) + 0.14*Math.sin(ph*3.3 + 0.4);
  // 反動のばね(臨界減衰。跳ね上がって戻る)
  const W = SNIPER_RECOIL_RETURN;
  v.recoilV += (-W*W*v.recoil - 2*W*v.recoilV) * dt;  v.recoil += v.recoilV * dt;
  v.recoilXV += (-W*W*v.recoilX - 2*W*v.recoilXV) * dt;  v.recoilX += v.recoilXV * dt;
  v.offYaw = v.amp * sx * e + v.recoilX;
  v.offPitch = v.amp * sy * e - v.recoil;
  v.flash = Math.max(0, v.flash - dt*9);
  for(let i=v.smoke.length-1;i>=0;i--){ const s = v.smoke[i]; s.t += dt; s.x += s.vx*dt; s.y += s.vy*dt; if(s.t >= s.life) v.smoke.splice(i,1); }
  for(let i=v.fx.length-1;i>=0;i--){ v.fx[i].t += dt; if(v.fx[i].t >= v.fx[i].life) v.fx.splice(i,1); }
  // この1フレームだけカメラを構えの位置へ(描き終わったら sniperFrameEnd で戻す)
  v.saved = { x:camPos.x, y:camPos.y, z:camPos.z, yaw:camState.yaw, pitch:camState.pitch };
  if(v.blend > 0){
    const ve = (typeof currentViewEntity === 'function' && currentViewEntity()) || me;
    camPos.x += (ve.x - camPos.x) * e;
    camPos.y += (ve.y - camPos.y) * e;
    camPos.z += (sniperEyeZ(ve) - camPos.z) * e;
  }
  camState.yaw += v.offYaw;
  camState.pitch += v.offPitch;
  setViewZoom(Math.exp(v.logMag));
  // 撮影・計測用の控え: この描画で2D(FOV_V)と3D(__aramonLook.fovDeg)が読む視野角
  v.fov2d = FOV_V*180/Math.PI; v.fov3d = window.__aramonLook.fovDeg;
  v.aim =(v.blend > 0.05 && w) ? sniperAimRay(w) : null;
  sniperSyncDom(true);
}
function sniperFrameEnd(){
  const s = sniperView.saved;
  if(s){
    camPos.x = s.x; camPos.y = s.y; camPos.z = s.z;
    camState.yaw = s.yaw; camState.pitch = s.pitch;
    sniperView.saved = null;
  }
  setViewZoom(1);
}
// 照準の先(画面中心の視線)にある物までの距離。体 → 地形の順に、近いほうを採る
function sniperAimRay(w){
  const cp = Math.cos(camState.pitch);
  const dx = Math.cos(camState.yaw)*cp, dy = Math.sin(camState.yaw)*cp, dz = -Math.sin(camState.pitch);
  const maxT = w.range / Math.max(0.2, cp);
  let tHit = null, prevT = 0;
  for(let t=SNIPER_AIM_STEP; t<=maxT; t += (t < 800 ? SNIPER_AIM_STEP : SNIPER_AIM_STEP*2)){
    if(camPos.z + dz*t <= terrainZAt(camPos.x+dx*t, camPos.y+dy*t)){ tHit = t; break; }
    prevT = t;
  }
  if(tHit != null){
    let lo = prevT, hi = tHit;
    for(let i=0;i<6;i++){ const m = (lo+hi)/2; if(camPos.z + dz*m <= terrainZAt(camPos.x+dx*m, camPos.y+dy*m)) hi = m; else lo = m; }
    tHit = hi;
  }
  const tEnd = tHit != null ? tHit : maxT;
  const eh = sniperSegmentHit({ ownerId: player ? player.id : -1, hitR:0 },
    camPos.x, camPos.y, camPos.z, camPos.x+dx*tEnd, camPos.y+dy*tEnd, camPos.z+dz*tEnd);
  if(eh) return { m: eh.t*tEnd / PING_UNITS_PER_M, ent: eh.e };
  if(tHit != null) return { m: tHit / PING_UNITS_PER_M, ent:null };
  return { m:null, ent:null };
}

/* ---------- HUDのボタン(DOM。中身が変わったときだけ触る) ---------- */
const _snEl = {};
function snEl(id){ return _snEl[id] || (_snEl[id] = document.getElementById(id)); }
function sniperSyncDom(show){
  const v = sniperView, me = player;
  const w = show ? sniperWeapon(me) : null;
  const vis = !!(w && me && me.alive && !game.over);
  const s = vis ? me.sniper : null, sc = vis ? sniperScope(me) : null;
  const reloading = !!(s && s.reloadLeft > 0);
  const sig = vis ? [v.ads?1:0, s.ammo, w.mag, me.sniperScope, reloading?1:0, v.holding?1:0, v.spent?1:0].join(',') : '-';
  if(sig !== v.domSig){
    v.domSig = sig;
    const btn = snEl('sniperAdsBtn'), chip = snEl('sniperAmmoChip'), breath = snEl('sniperBreathBtn');
    if(btn){ btn.classList.toggle('hidden', !vis); btn.classList.toggle('on', vis && v.ads); btn.classList.toggle('reloading', reloading); }
    if(chip){
      chip.classList.toggle('hidden', !vis);
      chip.classList.toggle('reloading', reloading);
      if(vis){
        snEl('sniperMagText').textContent = sc.label || (sc.mag + '×');
        snEl('sniperAmmoText').textContent = reloading ? '装填中' : `${s.ammo}/${w.mag}`;
        let pips = '';
        for(let i=0;i<w.mag;i++) pips += `<i class="sn-pip${i < s.ammo ? '' : ' empty'}"></i>`;
        snEl('sniperAmmoPips').innerHTML = pips;
      }
    }
    if(breath){
      breath.classList.toggle('hidden', !(vis && v.ads));
      breath.classList.toggle('held', v.holding);
      breath.classList.toggle('spent', v.spent);
    }
  }
  if(vis){
    const pr = reloading ? 1 - s.reloadLeft / w.reloadSec : (s.cycleLeft > 0 ? 1 - s.cycleLeft / w.cycleSec : 1);
    const pq = Math.round(pr*100);
    if(pq !== v.ringReload && typeof setCooldownRing === 'function'){ v.ringReload = pq; setCooldownRing(snEl('sniperReloadRing'), pr); }
    const bq = Math.round(v.breath*100);
    if(bq !== v.ringBreath && typeof setCooldownRing === 'function'){ v.ringBreath = bq; setCooldownRing(snEl('sniperBreathRing'), v.breath); }
  }
  const bodyAds = vis && v.blend > 0.5;
  if(bodyAds !== v.bodyAds){ v.bodyAds = bodyAds; document.body.classList.toggle('sniper-ads', bodyAds); }
}

/* ---------- 弾道の光の筋(render.js の drawProjectile から。2Dの世界の中に描く) ---------- */
function drawSniperTracer(pr){
  const pts = pr.trail;
  if(!pts || pts.length < 2) return;
  const G = SNIPER_GUN_OFFSET;
  const rx = -Math.sin(camState.yaw), ry = Math.cos(camState.yaw);   // 画面の右
  const sp = [];
  for(const q of pts){
    // 見た目だけ銃口(右下)から出して、少し先で照準の線に合流させる(当たりは本物の弾道)
    const k = Math.max(0, 1 - (q.d||0) / G.converge);
    const P = project(q.x + rx*G.right*k, q.y + ry*G.right*k, q.z - G.down*k);
    if(P) sp.push(P);
  }
  if(sp.length < 2) return;
  const head = sp[sp.length-1], tail = sp[0];
  const s = Math.max(0.35, Math.min(4, head.scale));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const grad = (a0, a1, rgb)=>{
    const g = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
    g.addColorStop(0, `rgba(${rgb},${a0})`); g.addColorStop(1, `rgba(${rgb},${a1})`);
    return g;
  };
  const path = ()=>{ ctx.beginPath(); ctx.moveTo(sp[0].x, sp[0].y); for(let i=1;i<sp.length;i++) ctx.lineTo(sp[i].x, sp[i].y); };
  path(); ctx.strokeStyle = grad(0, 0.22, '255,140,50'); ctx.lineWidth = Math.max(5, 14*s); ctx.stroke();
  path(); ctx.strokeStyle = grad(0, 0.45, '255,170,80'); ctx.lineWidth = Math.max(2.5, 6*s); ctx.stroke();
  path(); ctx.strokeStyle = grad(0.05, 1, '255,240,210'); ctx.lineWidth = Math.max(1.3, 2.2*s); ctx.stroke();
  const r = Math.max(2.5, 5*s);
  const hg = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, r*2.4);
  hg.addColorStop(0, 'rgba(255,250,235,0.95)'); hg.addColorStop(0.35, 'rgba(255,200,120,0.55)'); hg.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(head.x, head.y, r*2.4, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

/* ---------- スコープの画(#sniperCanvas。技のWebGL層より上・HUDより下) ---------- */
let _snCanvas = null, _snCtx = null;
function sniperCanvas(){
  if(!_snCanvas){
    _snCanvas = document.getElementById('sniperCanvas');
    _snCtx = _snCanvas ? _snCanvas.getContext('2d') : null;
  }
  return _snCtx;
}
function drawSniperScope(){
  const g = sniperCanvas();
  if(!g) return;
  const v = sniperView;
  const show = sniperModeOn() && v.blend > 0.002 && player && sniperWeapon(player);
  if(!show){
    if(v.canvasOn){ v.canvasOn = false; _snCanvas.classList.add('hidden'); g.setTransform(1,0,0,1,0,0); g.clearRect(0,0,_snCanvas.width,_snCanvas.height); }
    return;
  }
  // 大きさはゲーム画面(#gameCanvas)と同じにする(解像度の自動調整にも追従)
  if(_snCanvas.width !== canvas.width || _snCanvas.height !== canvas.height){
    _snCanvas.width = canvas.width; _snCanvas.height = canvas.height;
  }
  if(_snCanvas.style.width !== canvas.style.width) _snCanvas.style.width = canvas.style.width;
  if(_snCanvas.style.height !== canvas.style.height) _snCanvas.style.height = canvas.style.height;
  if(!v.canvasOn){ v.canvasOn = true; _snCanvas.classList.remove('hidden'); }
  g.setTransform(dpr,0,0,dpr,0,0);
  g.clearRect(0,0,viewW,viewH);
  const me = player, w = sniperWeapon(me), sc = sniperScope(me);
  const a = sniperEase(v.blend);
  const cx = viewW/2, cy = viewH/2;
  // 窓は銃と一緒に動く: 反動で少し沈んで戻る
  const recoilPx = FOCAL * Math.tan(Math.max(0, v.recoil)) * 0.35;
  const W = sc.aperture > 0 ? { x:cx + FOCAL*Math.tan(v.recoilX)*0.3, y:cy + recoilPx, R:viewH*sc.aperture*(0.8 + 0.2*a) } : null;
  g.save();
  g.globalAlpha = a;
  if(W) drawScopeBody(g, W, sc); else drawIronSight(g, cx, cy, a);
  // 照準(弾が飛ぶ先=画面の中心)
  if(W){ g.save(); g.beginPath(); g.arc(W.x, W.y, W.R, 0, Math.PI*2); g.clip(); }
  const onTarget = !!(v.aim && v.aim.ent);
  if(sc.reticle === 'chevron') drawReticleChevron(g, cx, cy, W, onTarget);
  else if(sc.reticle === 'mildot') drawReticleMildot(g, cx, cy, W, onTarget, w);
  else if(sc.reticle === 'bdc') drawReticleBdc(g, cx, cy, W, onTarget, w);
  drawScopeHits(g, cx, cy);
  drawScopeSmoke(g, W || { x:cx, y:cy, R:viewH*0.45 });
  if(W) g.restore();
  if(W) drawLensGlass(g, W);
  drawScopeInfo(g, cx, cy, W, sc, w);
  g.restore();
}
function drawScopeBody(g, W, sc){
  const { x, y, R } = W;
  // 1. 窓の外は真っ黒(鏡筒の中)
  g.beginPath(); g.rect(0,0,viewW,viewH); g.arc(x, y, R*1.10, 0, Math.PI*2, true);
  g.fillStyle = '#020305'; g.fill();
  // 2. 鏡筒の縁(金属の暗い輪。左上がわずかに光る)
  const rim = g.createLinearGradient(x-R, y-R, x+R, y+R);
  rim.addColorStop(0, '#3a3f47'); rim.addColorStop(0.35, '#15181c'); rim.addColorStop(1, '#050608');
  g.beginPath(); g.arc(x, y, R*1.10, 0, Math.PI*2); g.arc(x, y, R, 0, Math.PI*2, true);
  g.fillStyle = rim; g.fill();
  g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.10)';
  g.beginPath(); g.arc(x, y, R*1.012, Math.PI*0.95, Math.PI*1.6); g.stroke();
  // 3. レンズの内側の周辺減光(縁ほど暗く。中心の見やすさは保つ)
  const vg = g.createRadialGradient(x, y, R*0.55, x, y, R);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(0.72, 'rgba(0,0,0,0.12)');
  vg.addColorStop(0.92, 'rgba(0,0,0,0.55)'); vg.addColorStop(1, 'rgba(0,0,0,0.92)');
  g.beginPath(); g.arc(x, y, R, 0, Math.PI*2); g.fillStyle = vg; g.fill();
}
// レンズのガラス感: 縁の色収差・コーティングの反射・グリント(照準より上に薄く重ねる)
function drawLensGlass(g, W){
  const { x, y, R } = W;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.lineWidth = 2.2;
  g.strokeStyle = 'rgba(255,70,40,0.22)'; g.beginPath(); g.arc(x+1.3, y+0.7, R*0.986, 0, Math.PI*2); g.stroke();
  g.strokeStyle = 'rgba(60,150,255,0.22)'; g.beginPath(); g.arc(x-1.3, y-0.7, R*0.978, 0, Math.PI*2); g.stroke();
  g.beginPath(); g.arc(x, y, R, 0, Math.PI*2); g.clip();
  // コーティングの淡い反射(左上に広く)
  const gl = g.createRadialGradient(x-R*0.45, y-R*0.52, 0, x-R*0.45, y-R*0.52, R*0.75);
  gl.addColorStop(0, 'rgba(170,215,255,0.10)'); gl.addColorStop(0.5, 'rgba(120,170,255,0.035)'); gl.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gl; g.fillRect(x-R, y-R, R*2, R*2);
  // 縁に沿った三日月の映り込み(ずらした2つの円の差。両端が細く消える=線に見えない)
  const crescent = (dx, dy, rgb, amax)=>{
    // 光る側(三日月の太い側 = ずらした向きの反対)から中心へ向けて薄れる
    const cg = g.createLinearGradient(x - Math.sign(dx)*R, y - Math.sign(dy)*R, x + Math.sign(dx)*R*0.2, y + Math.sign(dy)*R*0.2);
    cg.addColorStop(0, `rgba(${rgb},0)`); cg.addColorStop(0.35, `rgba(${rgb},${amax})`); cg.addColorStop(1, `rgba(${rgb},0)`);
    g.beginPath(); g.arc(x, y, R*0.985, 0, Math.PI*2); g.arc(x + dx*R, y + dy*R, R*0.985, 0, Math.PI*2, true);
    g.fillStyle = cg; g.fill();
  };
  crescent(0.035, 0.045, '235,245,255', 0.16);
  crescent(-0.012, -0.016, '255,200,150', 0.05);
  // 発砲の閃光(レンズの下側が一瞬明るむ)
  if(sniperView.flash > 0){
    const f = sniperView.flash;
    g.fillStyle = `rgba(255,228,190,${0.14*f})`; g.fillRect(x-R, y-R, R*2, R*2);
    const fg = g.createRadialGradient(x, y+R*0.95, 0, x, y+R*0.95, R*1.0);
    fg.addColorStop(0, `rgba(255,215,150,${0.85*f})`); fg.addColorStop(0.45, `rgba(255,150,60,${0.32*f})`); fg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fg; g.fillRect(x-R, y-R, R*2, R*2);
  }
  g.restore();
}
// 照準の線(黒い線+薄い光の縁取り。明るい空でも暗い森でも読める)
function retLine(g, x0, y0, x1, y1, w){
  g.lineCap = 'butt';
  g.strokeStyle = 'rgba(255,255,255,0.20)'; g.lineWidth = w + 1.6;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.strokeStyle = 'rgba(8,9,11,0.94)'; g.lineWidth = w;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
}
function retDot(g, x, y, r){
  g.fillStyle = 'rgba(255,255,255,0.20)'; g.beginPath(); g.arc(x, y, r+0.9, 0, Math.PI*2); g.fill();
  g.fillStyle = 'rgba(8,9,11,0.94)'; g.beginPath(); g.arc(x, y, r, 0, Math.PI*2); g.fill();
}
// 発光する赤い中心(的に乗ると明るく脈打つ)
function retGlow(g, fn, onTarget){
  g.save();
  g.globalCompositeOperation = 'lighter';
  const k = onTarget ? 0.8 + 0.2*Math.sin(performance.now()*0.018) : 0.6;
  g.shadowColor = `rgba(255,60,40,${k})`; g.shadowBlur = onTarget ? 10 : 6;
  g.strokeStyle = g.fillStyle = onTarget ? '#ff5a3c' : '#ff3b2e';
  fn();
  g.restore();
}
function drawReticleChevron(g, cx, cy, W, onTarget){
  const R = W.R;
  g.lineWidth = 1.3; g.strokeStyle = 'rgba(8,9,11,0.9)';
  g.beginPath(); g.arc(cx, cy, R*0.34, 0, Math.PI*2); g.stroke();
  retLine(g, cx - R, cy, cx - R*0.34, cy, 3);
  retLine(g, cx + R*0.34, cy, cx + R, cy, 3);
  retLine(g, cx, cy + R*0.34, cx, cy + R, 3);
  for(const s of [-1,1]) retLine(g, cx + s*R*0.34, cy, cx + s*R*0.24, cy, 1.4);
  retLine(g, cx, cy + R*0.34, cx, cy + R*0.24, 1.4);
  const c = R*0.05;
  retGlow(g, ()=>{
    g.lineWidth = 2.2; g.lineJoin = 'miter';
    g.beginPath(); g.moveTo(cx - c, cy + c*1.05); g.lineTo(cx, cy); g.lineTo(cx + c, cy + c*1.05); g.stroke();
  }, onTarget);
}
// 落下補正の目盛りの画面上の高さ(実際の弾道と同じ式で、この視線から project で求める)
function sniperDropMarks(w){
  const b = sniperBallistics(w);
  const out = [];
  const cpx = Math.cos(camState.yaw), cpy = Math.sin(camState.yaw), tp = Math.tan(camState.pitch);
  for(const m of SNIPER_DROP_MARKS_M){
    const d = m * PING_UNITS_PER_M;
    if(d > w.range) continue;
    const t = d / w.speed;
    const rel = b.zero*d - 0.5*b.grav*t*t;          // 視線に対する弾の高さ(下がマイナス)
    const P = project(camPos.x + cpx*d, camPos.y + cpy*d, camPos.z - tp*d + rel);
    if(P) out.push({ m, y:P.y });
  }
  return out;
}
function drawReticleMildot(g, cx, cy, W, onTarget, w){
  const R = W.R, gap = R*0.035;
  for(const [dx, dy] of [[-1,0],[1,0],[0,1],[0,-1]]){
    retLine(g, cx + dx*R, cy + dy*R, cx + dx*R*0.5, cy + dy*R*0.5, 4);
    retLine(g, cx + dx*R*0.5, cy + dy*R*0.5, cx + dx*gap, cy + dy*gap, 1.2);
    for(let i=1;i<=4;i++) retDot(g, cx + dx*R*0.1*i, cy + dy*R*0.1*i, 1.9);
  }
  // 落下補正の小さな横線(下の縦線に。数字は100m単位)
  g.font = "bold 10px 'Share Tech Mono', monospace"; g.textAlign = 'left'; g.textBaseline = 'middle';
  for(const mk of sniperDropMarks(w)){
    if(mk.y <= cy + gap*1.5 || mk.y > cy + R*0.48) continue;
    retLine(g, cx - R*0.035, mk.y, cx + R*0.035, mk.y, 1.2);
    if(mk.m % 100 === 0){ g.fillStyle = 'rgba(8,9,11,0.85)'; g.fillText(String(mk.m/100), cx + R*0.05, mk.y); }
  }
  retGlow(g, ()=>{ g.beginPath(); g.arc(cx, cy, 2.3, 0, Math.PI*2); g.fill(); }, onTarget);
}
function drawReticleBdc(g, cx, cy, W, onTarget, w){
  const R = W.R, gap = R*0.028;
  // 太い柱(外周)+細い十字
  retLine(g, cx - R, cy, cx - R*0.62, cy, 4.5);
  retLine(g, cx + R*0.62, cy, cx + R, cy, 4.5);
  retLine(g, cx, cy + R*0.62, cx, cy + R, 4.5);
  retLine(g, cx, cy - R, cx, cy - R*0.62, 4.5);
  retLine(g, cx - R*0.62, cy, cx - gap, cy, 1.1);
  retLine(g, cx + gap, cy, cx + R*0.62, cy, 1.1);
  retLine(g, cx, cy - R*0.62, cx, cy - gap, 1.1);
  // 横の風読みの目盛り
  for(let i=1;i<=5;i++) for(const s of [-1,1]) retLine(g, cx + s*R*0.1*i, cy - (i%5===0?6:3.5), cx + s*R*0.1*i, cy + (i%5===0?6:3.5), 1.1);
  // 落下補正のはしご(距離ごとの横線+数字。実際の弾道から毎フレーム引く)
  const marks = sniperDropMarks(w);
  let lastY = cy;
  g.font = "bold 11px 'Share Tech Mono', monospace"; g.textBaseline = 'middle';
  marks.forEach((mk, i)=>{
    if(mk.y <= cy + gap*1.5 || mk.y > cy + R*0.6) return;
    const hw = R*(0.085 - i*0.012);
    retLine(g, cx - hw, mk.y, cx + hw, mk.y, 1.3);
    retDot(g, cx - hw - 5, mk.y, 1.5); retDot(g, cx + hw + 5, mk.y, 1.5);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillText(String(mk.m), cx + hw + 11 + 0.8, mk.y + 0.8);
    g.fillStyle = 'rgba(10,10,12,0.95)'; g.fillText(String(mk.m), cx + hw + 11, mk.y);
    lastY = mk.y;
  });
  // 細い縦線をはしごの下まで
  retLine(g, cx, cy + gap, cx, Math.max(cy + R*0.62, lastY), 1.1);
  retGlow(g, ()=>{
    g.beginPath(); g.arc(cx, cy, 2.1, 0, Math.PI*2); g.fill();
    g.lineWidth = 1.1; g.beginPath(); g.arc(cx, cy, R*0.022 + 3, 0, Math.PI*2); g.stroke();
  }, onTarget);
}
// アイアンサイト: 照門(ぼけた輪)と照星(先端が狙点)、下に銃の影
function drawIronSight(g, cx, cy, a){
  const H = viewH;
  // 画面の縁をわずかに落とす
  const vg = g.createRadialGradient(cx, cy, H*0.35, cx, cy, Math.max(viewW, H)*0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = vg; g.fillRect(0, 0, viewW, H);
  // 銃身と機関部(ピントの外なので柔らかく)
  const bodyTop = cy + H*0.12;
  const bg = g.createLinearGradient(0, bodyTop, 0, H);
  bg.addColorStop(0, 'rgba(24,25,28,0.0)'); bg.addColorStop(0.15, 'rgba(24,25,28,0.86)'); bg.addColorStop(1, 'rgba(10,10,12,0.95)');
  g.fillStyle = bg;
  g.beginPath();
  g.moveTo(cx - H*0.035, bodyTop); g.lineTo(cx + H*0.035, bodyTop);
  g.lineTo(cx + H*0.19, H); g.lineTo(cx - H*0.19, H); g.closePath(); g.fill();
  // 銃身の上面の鈍い照り返し
  const hl = g.createLinearGradient(0, bodyTop, 0, H);
  hl.addColorStop(0, 'rgba(160,170,185,0)'); hl.addColorStop(0.3, 'rgba(160,170,185,0.10)'); hl.addColorStop(1, 'rgba(160,170,185,0.02)');
  g.fillStyle = hl;
  g.beginPath();
  g.moveTo(cx - H*0.008, bodyTop); g.lineTo(cx + H*0.008, bodyTop);
  g.lineTo(cx + H*0.05, H); g.lineTo(cx - H*0.05, H); g.closePath(); g.fill();
  // 照門(ぼけた輪)
  const Ro = H*0.17, Ri = H*0.085;
  const rg = g.createRadialGradient(cx, cy, Ri*0.85, cx, cy, Ro*1.25);
  rg.addColorStop(0, 'rgba(10,10,12,0)'); rg.addColorStop(0.12, 'rgba(10,10,12,0.88)');
  rg.addColorStop(0.7, 'rgba(10,10,12,0.9)'); rg.addColorStop(1, 'rgba(10,10,12,0)');
  g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, Ro*1.25, 0, Math.PI*2); g.fill();
  // 照星(柱の先端=狙点)と両脇の耳
  g.fillStyle = 'rgba(14,14,16,0.97)';
  const pw = Math.max(3, H*0.011);
  g.beginPath(); g.moveTo(cx - pw, cy + 1); g.lineTo(cx + pw, cy + 1); g.lineTo(cx + pw*1.8, cy + H*0.085); g.lineTo(cx - pw*1.8, cy + H*0.085); g.closePath(); g.fill();
  g.lineWidth = Math.max(2.5, H*0.008); g.strokeStyle = 'rgba(14,14,16,0.95)';
  for(const s of [-1,1]){ g.beginPath(); g.arc(cx, cy + H*0.02, H*0.04, s<0 ? Math.PI*0.62 : Math.PI*0.08, s<0 ? Math.PI*0.92 : Math.PI*0.38); g.stroke(); }
  // 集光ファイバーの点(照星の先)
  retGlow(g, ()=>{ g.beginPath(); g.arc(cx, cy + 2, Math.max(1.8, H*0.005), 0, Math.PI*2); g.fill(); }, !!(sniperView.aim && sniperView.aim.ent));
}
// 命中の×印・ダメージ数字・着弾の土煙(スコープの中で見えるように画面側に描く)
function drawScopeHits(g, cx, cy){
  const fx = sniperView.fx;
  for(const f of fx){
    const P = project(f.x, f.y, f.z);
    if(f.kind === 'impact'){
      if(!P) continue;
      const k = f.t / f.life, r = Math.max(4, 26*P.scale) * (0.4 + k*1.2);
      const gg = g.createRadialGradient(P.x, P.y, 0, P.x, P.y, r);
      const col = f.rock ? '190,186,178' : '205,186,146';
      gg.addColorStop(0, `rgba(${col},${0.55*(1-k)})`); gg.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gg; g.beginPath(); g.arc(P.x, P.y - r*0.3, r, 0, Math.PI*2); g.fill();
      continue;
    }
    // ×印(照準の上)
    const mk = clamp(f.t / 0.32, 0, 1);
    if(mk < 1){
      const s = (f.crit ? 15 : 11) * (1.25 - 0.25*mk), gap = f.crit ? 6 : 5;
      g.save();
      g.globalAlpha *= 1 - mk*mk;
      g.lineCap = 'round';
      const col = f.kill ? '#ff3030' : (f.crit ? '#ffb020' : '#ffffff');
      for(const [dx, dy] of [[-1,-1],[1,-1],[-1,1],[1,1]]){
        g.strokeStyle = 'rgba(0,0,0,0.65)'; g.lineWidth = f.crit ? 5 : 4;
        g.beginPath(); g.moveTo(cx + dx*gap, cy + dy*gap); g.lineTo(cx + dx*(gap+s), cy + dy*(gap+s)); g.stroke();
        g.strokeStyle = col; g.lineWidth = f.crit ? 3 : 2.2;
        g.beginPath(); g.moveTo(cx + dx*gap, cy + dy*gap); g.lineTo(cx + dx*(gap+s), cy + dy*(gap+s)); g.stroke();
      }
      g.restore();
    }
    // ダメージ数字(当たった所から浮き上がる。弱点はクリティカルの札と金色)
    if(!P) continue;
    const k = f.t / f.life;
    const rise = 24 + k*38, alpha = k < 0.75 ? 1 : 1 - (k-0.75)/0.25;
    const pop = f.t < 0.12 ? 1 + (0.12 - f.t)*4 : 1;
    const x = P.x + 18, y = P.y - rise;
    g.save();
    g.globalAlpha *= alpha;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const size = Math.round((f.crit ? 30 : 22) * pop);
    g.font = `${size}px 'Russo One', 'Rajdhani', sans-serif`;
    g.lineJoin = 'round';
    g.lineWidth = f.crit ? 6 : 5; g.strokeStyle = f.crit ? 'rgba(120,14,0,0.92)' : 'rgba(0,0,0,0.85)';
    g.strokeText(String(f.dmg), x, y);
    if(f.crit){
      const tg = g.createLinearGradient(0, y - size, 0, y);
      tg.addColorStop(0, '#fff4a8'); tg.addColorStop(0.55, '#ffc32e'); tg.addColorStop(1, '#ff7a1a');
      g.fillStyle = tg;
    } else g.fillStyle = '#ffffff';
    g.fillText(String(f.dmg), x, y);
    if(f.crit || f.kill){
      const label = f.kill ? (f.crit ? 'クリティカル撃破' : '撃破') : 'クリティカル';
      g.font = "bold 13px 'Rajdhani', sans-serif";
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.strokeText(label, x + 2, y - size - 2);
      g.fillStyle = f.kill ? '#ff5a4a' : '#ffd24a';
      g.fillText(label, x + 2, y - size - 2);
    }
    g.restore();
  }
}
function drawScopeSmoke(g, W){
  for(const s of sniperView.smoke){
    const k = s.t / s.life;
    const x = W.x + s.x*W.R, y = W.y + s.y*W.R, r = W.R * s.r * (1 + k*1.6);
    const sg = g.createRadialGradient(x, y, 0, x, y, r);
    sg.addColorStop(0, `rgba(200,198,196,${0.34*(1-k)})`); sg.addColorStop(0.6, `rgba(190,188,186,${0.16*(1-k)})`); sg.addColorStop(1, 'rgba(190,190,195,0)');
    g.fillStyle = sg; g.beginPath(); g.arc(x, y, r, 0, Math.PI*2); g.fill();
  }
}
// 距離・残弾・装填・倍率・息(窓の中の決まった場所に。窓の無いアイアンは照準の右下)
function drawScopeInfo(g, cx, cy, W, sc, w){
  const v = sniperView, s = player.sniper;
  const R = W ? W.R : viewH*0.3;
  const ox = W ? W.x : cx, oy = W ? W.y : cy;
  const txt = (str, x, y, font, color, align)=>{
    g.font = font; g.textAlign = align || 'left'; g.textBaseline = 'middle';
    g.lineWidth = 3; g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(str, x, y);
    g.fillStyle = color; g.fillText(str, x, y);
  };
  // 距離計
  const m = v.aim && v.aim.m != null ? Math.round(v.aim.m) : null;
  const dx = ox + R*0.42, dy = oy + R*0.14;
  txt('RANGE', dx, dy - 11, "bold 9px 'Share Tech Mono', monospace", 'rgba(255,214,150,0.8)');
  txt(m != null ? `${m} m` : '--- m', dx, dy + 4, "bold 17px 'Share Tech Mono', monospace", v.aim && v.aim.ent ? '#ff8a6a' : '#ffe9c4');
  // 倍率(左下)
  txt(sc.label || (sc.mag+'×'), ox - R*0.62, oy + R*0.52, "bold 15px 'Share Tech Mono', monospace", 'rgba(255,214,150,0.85)', 'center');
  // 残弾(右下): 弾の形の小さな柱
  const bx = ox + R*0.34, by = oy + R*0.56;
  for(let i=0;i<w.mag;i++){
    const full = i < s.ammo && s.reloadLeft <= 0;
    g.fillStyle = full ? '#ffd79a' : 'rgba(255,255,255,0.14)';
    g.fillRect(bx + i*8, by - 8, 5, 16);
    if(full){ g.fillStyle = '#b07a3a'; g.fillRect(bx + i*8, by + 5, 5, 3); }
  }
  // 装填中 / ボルトの戻り
  if(s.reloadLeft > 0){
    const p = 1 - s.reloadLeft / w.reloadSec;
    const bw = R*0.5, bxx = ox - bw/2, byy = oy + R*0.78;
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(bxx - 2, byy - 2, bw + 4, 8);
    g.fillStyle = '#ffb45a'; g.fillRect(bxx, byy, bw*p, 4);
    txt('装填中', ox, byy - 12, "bold 12px 'Rajdhani', sans-serif", '#ffcf8a', 'center');
  } else if(s.cycleLeft > 0){
    const p = 1 - s.cycleLeft / w.cycleSec;
    g.strokeStyle = 'rgba(255,215,150,0.75)'; g.lineWidth = 2.5;
    g.beginPath(); g.arc(bx + w.mag*8 + 10, by, 6, -Math.PI/2, -Math.PI/2 + p*Math.PI*2); g.stroke();
  }
  // 息(左の縁に沿った弧)。止めている間と戻っている間だけ
  if(v.breath < 0.999 || v.holding){
    const a0 = Math.PI*0.80, a1 = Math.PI*1.20, rr = R*0.9;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 5;
    g.beginPath(); g.arc(ox, oy, rr, a0, a1); g.stroke();
    g.strokeStyle = v.spent ? '#ff6e5e' : (v.holding ? '#bfe6ff' : 'rgba(191,230,255,0.6)'); g.lineWidth = 3;
    g.beginPath(); g.arc(ox, oy, rr, a1 - (a1-a0)*v.breath, a1); g.stroke();
    txt(v.spent ? '息切れ' : (v.holding ? '息止め' : '息'), ox + Math.cos(Math.PI)*rr + 14, oy, "bold 11px 'Rajdhani', sans-serif",
        v.spent ? '#ff8a7a' : '#d8efff');
  }
}

/* 開発用: 探検モードが無い状態でも、今の試合の自機に狙撃銃とスコープを持たせる(撮影ハーネス用)。
   ゲームの画面からは呼ばない。 */
window.__aramonSniperDemo = function(opts){
  const o = opts || {};
  if(typeof game !== 'object' || !game.started || !player) return { ok:false, reason:'試合中に呼んでください' };
  sniperDemoOwner = player;
  sniperGive(player, o.weapon || 'longbow');
  sniperAttachScope(player, o.scope || 'x8');
  return { ok:true, weapon:player.sniper.weapon, scope:player.sniperScope };
};
