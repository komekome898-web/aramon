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
                                         クリティカル(威力 = 武器の critMult。mult は探検では applyDamage に
                                         opts.weakPoint:true を渡して explore.js が1か所で掛ける)。onHit は部位破壊用
       ent.bodyH                       … 当たりの背の高さ(ワールド単位)。無ければ 半径×SNIPER_BODY_H_PER_RADIUS
       ent.sniperDmgMult               … 装備などで威力を上げる倍率(無ければ1)
   ■ 視野角(倍率ズーム)の上書きは world.js の setViewZoom() 1か所。**描画1フレームの間だけ**掛けて
     sniperFrameEnd() で1へ戻す。2Dの project() と real3d / fx_gl の3Dカメラは同じ値を読む。
     ユーザーの視点設定(lookSettings.fovDeg)は書き換えない。構えのカメラ(目の位置)・揺れ・反動も
     同じく描画の間だけ camPos / camState に足して、終わったら戻す(試合の状態は汚さない)。
     例外は反動の「戻らない1割」(SNIPER_RECOIL_KEEP)だけで、これは撃つたびに実際に照準が上がる。
   ■ 3D側へは描画の間だけ window.__aramonSniperScope を渡す(スコープの窓の矩形・見ている距離)。
     real3d.js がその範囲だけ解像度を上げ、影の範囲を見ている先へ寄せ、real3d_props.js が草を視線の先へ並べる。
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
const SNIPER_TRAIL_GAP    = 45;    // 弾道の光に残す点の間隔(ワールド単位)。撃ってから今までの弧を全部残す
const SNIPER_TRAIL_MAX    = 110;
const SNIPER_AIM_STEP     = 18;    // 距離計の地形探索の刻み
const SNIPER_PREDICT_STEP = 1/90;  // 弱点表示のための弾道の先読みの刻み(秒)

const sniperView = {
  ads:false, blend:0, logMag:0, zoomKick:0,
  breathHeld:false, holding:false, breath:1, spent:false,
  amp:0, swayT:0, offYaw:0, offPitch:0,
  recoil:0, recoilV:0, recoilX:0, recoilXV:0, recoilPeak:0.01,
  shake:0, shakeAmp:0, hitStopUntil:0,
  flash:0, smoke:[], fx:[], aim:null, pred:null, lastShot:null,
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
  v.ads = false; v.blend = 0; v.logMag = 0; v.zoomKick = 0;
  v.breathHeld = false; v.holding = false; v.breath = 1; v.spent = false;
  v.amp = 0; v.offYaw = 0; v.offPitch = 0;
  v.recoil = 0; v.recoilV = 0; v.recoilX = 0; v.recoilXV = 0;
  v.shake = 0; v.hitStopUntil = 0;
  v.flash = 0; v.flashN = null; v.freezeFx = false; v.smoke.length = 0; v.fx.length = 0; v.aim = null; v.pred = null; v.lastShot = null; v.prevHeld = false;
  v.dirty = false;
  window.__aramonSniperScope = null;
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
/* 窓(スコープのレンズ)の半径。既定は画面の高さから決めるが、
   縦持ちでは右のボタン列(狙撃/DASH/FIRE)が近く、そのままだと情報の札を置く場所が無くなって
   レンズの内側に入り込む(批評)。**右のボタン列の左端 − SNIPER_SCOPE_GUTTER_PX** を窓の外側の限界にして、
   その分だけ窓を縮める(横持ちではボタンが遠いので limit のほうが大きく、既定の大きさのまま変わらない)。
   snHudRects() は sniper.js の下のほうで定義しているが function 宣言はホイストされるので呼べる。 */
function sniperApertureR(sc){
  const base = viewH * (sc.aperture > 0 ? sc.aperture : 0.3);
  if(sc.aperture <= 0) return base;   // アイアンサイトは窓の大きさの制約が無い
  const cx = viewW/2;
  let limit = Infinity;
  for(const r of snHudRects()) if(r[0] > cx) limit = Math.min(limit, r[0]);
  if(limit === Infinity) return base;
  return Math.max(viewH*SNIPER_SCOPE_MIN_R_RATIO, Math.min(base, limit - SNIPER_SCOPE_GUTTER_PX - cx));
}
function sniperHidesSelf(){ return sniperModeOn() && sniperView.blend > 0.35; }
// 頭上のHPバーを隠すか(render.js の drawMonster から)。照準の先の1体だけスコープの中の帯で見せる
function sniperHidesOverhead(){ return sniperModeOn() && sniperView.blend > 0.35; }
// 弱点命中のヒットストップ(combat.js の update が dt に掛ける)。実時間で必ず1へ戻る
function sniperTimeScale(){ return performance.now() < sniperView.hitStopUntil ? SNIPER_HITSTOP_SCALE : 1; }
/* 狙撃の命中で的が反応する(render.js の drawMonster が読む。探検だけ)。
   { x, y } = 絵を揺らす量(画面px。数px・0.25秒で収まる)、flash = 体の白の濃さ(弱く・一瞬)。
   揺れはボス担当の姿勢(exploreComputePose)の外側で足し合わせる(姿勢を上書きしない)。時計は命中の演出と同じ */
function sniperHitJolt(e){
  if(!game.explore || !e) return null;
  for(let i=sniperView.fx.length-1;i>=0;i--){
    const f = sniperView.fx[i];
    if(f.kind !== 'hit' || f.eid !== e.id || f.t >= SNIPER_HIT_JOLT_SEC) continue;
    const k = 1 - f.t / SNIPER_HIT_JOLT_SEC, A = (f.crit ? SNIPER_HIT_JOLT_PX[1] : SNIPER_HIT_JOLT_PX[0]) * k;
    const ph = f.t*62 + (f.seed || 0);
    return { x: Math.cos(ph)*A, y: (Math.sin(ph*1.3)*0.5 + 0.35)*A,
             flash: f.t < 0.07 ? (f.crit ? 0.3 : 0.2) * (1 - f.t/0.07) : 0 };
  }
  return null;
}

/* ---------- 引き金(combat.js の tryPlayerFire から毎フレーム) ----------
   構え中は FIRE = 狙撃銃の引き金。**押して(滑らせて狙い)離した瞬間に撃つ。**
   FIREを押した指を滑らせると視点が動く(fireDragAim)ので、押した瞬間に撃つと狙う暇が無い。
   タップでも「押す→離す」で1発出るので、素早く撃ちたいときも困らない。
   **ボタンから大きく外れた所で離したら撃たない**(input.js の fireReleasedOutside。撃つのをやめる逃げ道) */
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
  if(released && !(typeof fireReleasedOutside !== 'undefined' && fireReleasedOutside && !keys['f'])){
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
// いまの倍率での視野の半分(ラジアン)。倍率は描画の間しか掛かっていないので出し直す
function sniperHalfFov(){ return Math.atan(Math.tan(lookSettings.fovDeg*Math.PI/360) / Math.exp(sniperView.logMag)); }
function sniperFire(me){
  const w = sniperWeapon(me), s = me.sniper, v = sniperView;
  s.ammo -= 1; s.cycleLeft = w.cycleSec;
  // 狙点は画面の中心(照準)= 見えていた視線そのもの(揺れ・反動を含む)
  const yaw = camState.yaw + v.offYaw;
  const pitch = camState.pitch + v.offPitch;
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
  // 銃声は遠くまで届く(野生・ボスが気づく)
  if(typeof exploreMakeNoise==='function') exploreMakeNoise(me.x, me.y, SNIPER_NOISE_RANGE);
  // 撃った瞬間の距離(1秒残して見せる)
  v.lastShot = { m: v.aim && v.aim.m != null ? Math.round(v.aim.m) : null, t:0 };
  // 反動: 視野の半分に対する割合で跳ね上げる(倍率が違っても画面上の跳ね方は同じ)。
  // **1割は戻さない**(本当に照準が上がる=連射すると少しずつ上へずれる)。残り9割はばねで戻る
  const halfFov = sniperHalfFov();
  const peak = w.recoil * halfFov;
  camState.pitch = clamp(camState.pitch - peak*SNIPER_RECOIL_KEEP, camPitchMin(), CAM_PITCH_MAX);
  const W = SNIPER_RECOIL_RETURN;
  v.recoilPeak = peak;
  v.recoilV += peak * (1-SNIPER_RECOIL_KEEP) * W * Math.E;       // 臨界減衰ばねの山がちょうど peak になる初速
  v.recoilXV += (Math.random()*2-1) * peak * 0.25 * W * Math.E;
  // 撃った瞬間の2フレームの視野の弾みと画面の揺れ
  v.zoomKick = SNIPER_SHOT_ZOOM_KICK;
  v.shake = 1; v.shakeAmp = halfFov * SNIPER_SHOT_SHAKE;
  v.flash = 1; v.flashN = 0; v.flashSeed = 1 + Math.floor(Math.random()*2147483000);
  // 硝煙(窓の下の縁から湧いて上へ流れる。単位は窓の半径)
  for(let i=0;i<8;i++) v.smoke.push({ x:(Math.random()-0.5)*0.7, y:0.7+Math.random()*0.25,
    vx:(Math.random()-0.5)*0.35, vy:-0.18-Math.random()*0.22, r:0.16+Math.random()*0.14, t:0, life:0.8+Math.random()*0.6 });
  playSe('sniper', { kind:'shot', cycle:w.cycleSec });
}

/* ---------- 弾の進め方と当たり(combat.js の updateProjectiles から) ---------- */
function sniperTrailPush(p, force){
  const last = p.trail[p.trail.length-1];
  if(!force && last && p.traveled - last.d < SNIPER_TRAIL_GAP) return;
  p.trail.push({ x:p.x, y:p.y, z:p.z, d:p.traveled });
  if(p.trail.length > SNIPER_TRAIL_MAX) p.trail.shift();
}
function sniperStepProjectile(p, dt){
  const hs = Math.hypot(p.vx, p.vy);
  const n = Math.max(1, Math.min(60, Math.ceil(hs*dt / SNIPER_SUBSTEP)));
  const h = dt / n;
  const owner = getEntity(p.ownerId) || null;
  const end = (kind, hit)=>{
    sniperTrailPush(p, true);
    // 消えたあとも弧を少しのあいだ残す(スコープの中で「どこを通ったか」が読める)
    if(owner && owner === player) sniperView.fx.push({ kind:'trail', pts:p.trail.slice(), color:p.color, t:0, life:0.9 });
    if(kind === 'hit') sniperOnHit(p, hit, owner);
    else if(kind) sniperImpact(p, kind);
    return true;
  };
  for(let k=0;k<n;k++){
    const x0 = p.x, y0 = p.y, z0 = p.z;
    p.x += p.vx*h; p.y += p.vy*h; p.z += p.vz*h; p.vz -= (p.grav||0)*h; p.traveled += hs*h;
    const hit = sniperSegmentHit(p, x0, y0, z0, p.x, p.y, p.z);
    if(hit){ p.x = hit.x; p.y = hit.y; p.z = hit.z; return end('hit', hit); }
    const gz = terrainZAt(p.x, p.y);
    if(p.z <= gz){ p.z = gz; return end('ground'); }
    if(sniperHitsObstacle(p)) return end('rock');
    if(p.traveled >= p.maxRange || p.x<0 || p.x>WORLD.w || p.y<0 || p.y>WORLD.h) return end(null);
    sniperTrailPush(p);
  }
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
function sniperBodyH(e){
  /* 探検では描いている絵の高さ×今の姿勢(伏せ・転倒で縮む)を当たりの背にする。
     弱点の当たり(exploreIsWeakPointHit)と同じ関数を読むので、撃つ前の金の印・当たりの背・弱点の帯が
     必ず同じ姿勢の高さになる(ent.bodyH より先に見る=探検では一本化) */
  if(game.explore && typeof exploreBodyHeight==='function') return exploreBodyHeight(e);
  if(e.bodyH) return e.bodyH;
  return (e.radius||26) * SNIPER_BODY_H_PER_RADIUS;
}
// 高さ z の命中が弱点か(当たりの判定と撃つ前の表示の両方がここを通る)
function sniperIsWeakHit(e, z, H){
  const wp = e && e.weakPoint;
  if(!wp) return false;
  if(game.explore && typeof exploreIsWeakPointHit === 'function') return exploreIsWeakPointHit(e, z);
  const ratio = (z - (e.z||0)) / (H || sniperBodyH(e));
  return ratio >= (wp.from != null ? wp.from : SNIPER_WEAK_FROM) && ratio <= (wp.to != null ? wp.to : 1.05);
}
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
  const crit = sniperIsWeakHit(e, hit.z, hit.H);
  // 弱点の倍率(wp.mult)は探検では exploreDmgTakenMult が opts.weakPoint を見て掛ける(二重に掛けない)
  const mult = crit ? (p.critMult || 1) * (game.explore ? 1 : (wp.mult || 1)) : 1;
  const hp0 = e.hp;
  const n0 = particles.length;
  applyDamage(e, p.dmg * mult, owner, { weakPoint:crit });
  /* 数字はスコープの中で大きく出し直すので、applyDamage が出した素の数字だけ取り除く
     (回復・ガッツ削りなど記号付きの数字は残す)。出した値=確定したダメージをそのまま使う。 */
  let shown = null;
  for(let i=particles.length-1; i>=n0; i--){
    const pt = particles[i];
    if(pt && pt.type === 'text' && /^\d+$/.test(pt.text)){ shown = +pt.text; particles.splice(i,1); }
  }
  const dealt = shown != null ? shown : Math.max(0, Math.round(hp0 - e.hp));
  /* 探検: 狙撃の命中で体全体が白く飛ぶと、遠くの的が幽霊に見える(批評)。体の白は1フレームだけにして、
     光は当たった点の周りだけ(スコープの絵が出す)。hitFlash は全モード共通の描画なので、ここだけで短くする */
  if(game.explore && e.hitFlash > SNIPER_BODY_FLASH_SEC) e.hitFlash = SNIPER_BODY_FLASH_SEC;
  if(crit && typeof wp.onHit === 'function'){
    try{ wp.onHit(e, { dmg:dealt, ratio, x:hit.x, y:hit.y, z:hit.z, source:owner }); }catch(_){}
  }
  spawnHit(hit.x, hit.y, hit.z, crit ? '#ffb02e' : '#fff0d0');
  for(let i=0;i<(crit?14:6);i++){
    const a = Math.random()*Math.PI*2, sp = 60 + Math.random()*(crit?240:130);
    addParticle({ type:'spark', x:hit.x, y:hit.y, z:hit.z, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp,
                  life:0.5, maxLife:0.5, color: crit ? (i%2 ? '#ff5a3a' : '#ffd24a') : '#ffe6b8', size:2+Math.random()*3 });
  }
  if(owner && owner === player){
    if(dealt > 0) sniperView.fx.push({ kind:'hit', x:hit.x, y:hit.y, z:hit.z, dmg:dealt, crit, kill:!e.alive, t:0, life:1.25, eid:e.id, seed:Math.random()*100 });
    if(crit){
      // 弱点: 一瞬の止め(60〜80ms)と倍率の弾み
      sniperView.hitStopUntil = performance.now() + SNIPER_HITSTOP_SEC*1000;
      sniperView.zoomKick = SNIPER_CRIT_ZOOM_KICK;
    }
    playSe('sniper', { kind: crit ? 'crit' : 'hit' });
  }
}
function sniperImpact(p, kind){
  // 土粒(小さく)。土煙そのものはスコープの絵が半透明で描く(不透明な玉を並べると綿の玉に見える)
  const dust = kind === 'rock' ? '#8f887c' : '#8e7a5c';
  for(let i=0;i<10;i++){
    const a = Math.random()*Math.PI*2, sp = 40 + Math.random()*120;
    addParticle({ type:'spark', x:p.x, y:p.y, z:p.z+2+Math.random()*6, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp,
                  life:0.7, maxLife:0.7, color:dust, size:1.2+Math.random()*1.4 });
  }
  const owner = getEntity(p.ownerId);
  if(owner && owner === player){
    const grains = [];
    for(let i=0;i<36;i++){ const a = Math.random()*Math.PI*2; grains.push({ a, v:0.4 + Math.random()*1.0, up:0.5 + Math.random()*1.3, s:0.6 + Math.random()*1.0 }); }
    sniperView.fx.push({ kind:'impact', x:p.x, y:p.y, z:p.z, t:0, life:2.2, rock: kind === 'rock', grains, seed:Math.random()*10 });
  }
}

/* 構えていないときも、狙撃銃を持っていれば自機の背中に銃を斜めに背負って見せる(render.js の drawMonster から。
   探検の自分だけ。絵の足元・体の高さ=portraitLayoutFor の値で置くので、どのモンスターでも背中に来る)。
   銃床・機関部・スコープ・銃身を金属の陰影つきで描く(平らな黒い棒にしない) */
function sniperDrawSlungRifle(e, L){
  if(!e || e !== player || !sniperWeapon(e) || !L || !(L.bodyH > 0)) return;
  if(sniperHidesSelf()) return;
  const H = L.bodyH, cy = L.footY - H*0.6, len = H*0.95, ang = -0.55;
  const th = Math.max(2, H*0.05);
  ctx.save();
  ctx.translate(0, cy); ctx.rotate(ang);
  const metal = (y0, y1, c0, c1)=>{ const lg = ctx.createLinearGradient(0, y0, 0, y1); lg.addColorStop(0, c0); lg.addColorStop(1, c1); return lg; };
  ctx.lineJoin = 'round';
  // 背負い紐
  ctx.strokeStyle = 'rgba(60,42,26,0.9)'; ctx.lineWidth = th*0.45;
  ctx.beginPath(); ctx.moveTo(-len*0.3, th*0.7); ctx.quadraticCurveTo(0, th*3.2, len*0.3, th*0.7); ctx.stroke();
  // 銃床(木)
  ctx.fillStyle = metal(-th, th*1.4, '#8a5a34', '#4a2e18');
  ctx.beginPath(); ctx.moveTo(-len*0.5, -th*0.9); ctx.lineTo(-len*0.2, -th*0.6); ctx.lineTo(-len*0.2, th*0.7); ctx.lineTo(-len*0.5, th*1.4); ctx.closePath(); ctx.fill();
  // 機関部
  ctx.fillStyle = metal(-th*0.7, th*0.8, '#5c636e', '#1c1f24');
  ctx.fillRect(-len*0.2, -th*0.7, len*0.34, th*1.5);
  // スコープ
  ctx.fillStyle = metal(-th*1.9, -th*0.7, '#707885', '#20242a');
  ctx.fillRect(-len*0.16, -th*1.75, len*0.28, th*1.05);
  ctx.fillStyle = '#9fd0ff'; ctx.globalAlpha = 0.8; ctx.fillRect(len*0.115, -th*1.7, th*0.35, th*0.95); ctx.globalAlpha = 1;
  // 銃身
  ctx.fillStyle = metal(-th*0.35, th*0.35, '#6a717c', '#15171b');
  ctx.fillRect(len*0.14, -th*0.32, len*0.36, th*0.64);
  // 上面の照り
  ctx.strokeStyle = 'rgba(230,238,250,0.45)'; ctx.lineWidth = Math.max(0.6, th*0.15);
  ctx.beginPath(); ctx.moveTo(-len*0.19, -th*0.62); ctx.lineTo(len*0.48, -th*0.28); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = Math.max(0.6, th*0.12);
  ctx.strokeRect(-len*0.2, -th*0.7, len*0.34, th*1.5);
  ctx.restore();
}

/* ---------- 毎フレーム(render.js の render() の最初と最後) ---------- */
function sniperEase(t){ t = clamp(t, 0, 1); return t*t*(3-2*t); }
// なめらかな1次元ノイズ(-1〜1)。揺れの周期を読めなくするために8の字へ混ぜる
function snHash(i){ const s = Math.sin(i*127.1 + 311.7)*43758.5453; return (s - Math.floor(s))*2 - 1; }
function snNoise(t){ const i = Math.floor(t), f = t - i, u = f*f*(3-2*f); return snHash(i)*(1-u) + snHash(i+1)*u; }
function sniperFrame(){
  const now = performance.now();
  // freezeFx: 撮影ツールが演出の時計を止める(撮る瞬間の閃光・土柱・数字をそのまま写すため。ゲームからは立てない)
  const dt = sniperView.freezeFx ? 0 : (sniperView.lastMs ? Math.min(0.05, Math.max(0, (now - sniperView.lastMs)/1000)) : 0.016);
  sniperView.lastMs = now;
  sniperView.saved = null;
  window.__aramonSniperScope = null;
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
  v.zoomKick *= Math.exp(-dt*22);   // 約2フレームで消える弾み
  // 息止め(数秒で限界→使い切ると息が半分戻るまで揺れが大きい)
  v.holding = !!(v.ads && v.breathHeld && !v.spent && v.breath > 0);
  if(v.holding){
    v.breath -= dt / SNIPER_BREATH_MAX_SEC;
    if(v.breath <= 0){ v.breath = 0; v.spent = true; v.holding = false; }
  } else {
    v.breath = Math.min(1, v.breath + dt / SNIPER_BREATH_RECOVER_SEC);
    if(v.spent && v.breath >= 0.5) v.spent = false;
  }
  // 揺れ: 8の字 + なめらかなノイズ(周期を読めなくする) + 心拍の細かい揺れ(息止め中も残る)
  const base = w ? w.sway * sc.sway : 0;
  let ampT = base;
  if(v.holding) ampT *= SNIPER_BREATH_SWAY;
  else if(v.spent) ampT *= SNIPER_EXHAUST_SWAY;
  const moving = (typeof joystick === 'object' && Math.hypot(joystick.nx, joystick.ny) > 0.25) || game.autoRun;
  if(moving) ampT *= SNIPER_MOVE_SWAY_MULT;
  v.amp += (ampT - v.amp) * (1 - Math.exp(-dt*(v.holding ? 5 : 2.5)));
  v.swayT += dt;
  const T = v.swayT, ph = T * Math.PI*2 / SNIPER_SWAY_PERIOD, N = SNIPER_SWAY_NOISE;
  const e = sniperEase(v.blend);
  const sx = (1-N)*Math.sin(ph) + N*snNoise(T*0.55 + 3.1) + 0.12*Math.sin(ph*2.7 + 1.3);
  const sy = (1-N)*0.5*Math.sin(ph*2) + N*0.7*snNoise(T*0.63 + 17.9);
  const beat = (T*SNIPER_HEARTBEAT_HZ) % 1;
  const hb = Math.exp(-beat*14) * Math.sin(beat*Math.PI*9) * base * SNIPER_HEARTBEAT_AMP;
  // 反動のばね(臨界減衰。跳ね上がって戻る)と撃った瞬間の揺れ
  const W = SNIPER_RECOIL_RETURN;
  v.recoilV += (-W*W*v.recoil - 2*W*v.recoilV) * dt;  v.recoil += v.recoilV * dt;
  v.recoilXV += (-W*W*v.recoilX - 2*W*v.recoilXV) * dt;  v.recoilX += v.recoilXV * dt;
  v.shake = Math.max(0, v.shake - dt/0.12);
  const sk = v.shake*v.shake*v.shakeAmp;
  v.offYaw = (v.amp * sx) * e + v.recoilX + (Math.random()*2-1)*sk;
  v.offPitch = (v.amp * sy + hb) * e - v.recoil + (Math.random()*2-1)*sk;
  /* 発砲の閃光は**描くコマ数で数える**(時間で減らすと、重いフレームが1つ挟まるだけで一度も写らない=批評)。
     撃ってから SNIPER_FLASH_LEVELS のコマ数だけ必ず出し(最初の2コマは白い芯つき)、そのあと時間で消える */
  if(v.flashN != null && !v.freezeFx){
    if(v.flashN < SNIPER_FLASH_LEVELS.length){ v.flash = SNIPER_FLASH_LEVELS[v.flashN]; v.flashN++; }
    else { v.flashN = null; }
  }
  if(v.flashN == null) v.flash = Math.max(0, v.flash - dt*11);
  if(v.lastShot){ v.lastShot.t += dt; if(v.lastShot.t > SNIPER_SHOT_RANGE_SEC) v.lastShot = null; }
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
  setViewZoom(Math.exp(v.logMag) * (1 + v.zoomKick * e));
  // 撮影・計測用の控え: この描画で2D(FOV_V)と3D(__aramonLook.fovDeg)が読む視野角
  v.fov2d = FOV_V*180/Math.PI; v.fov3d = window.__aramonLook.fovDeg;
  v.pred = (v.blend > 0.5 && w) ? sniperPredict(w) : null;
  v.aim = (v.blend > 0.05 && w) ? sniperAimRay(w, v.pred) : null;
  // 3D側への連絡(描画の間だけ): 窓の矩形(CSS px)と見ている距離。完全に構えたときだけ窓の外を描かない
  if(v.blend > 0.05){
    const R = sniperApertureR(sc), full = v.blend >= 0.999 && sc.aperture > 0;
    const focus = v.aim && v.aim.m != null ? v.aim.m*PING_UNITS_PER_M : 1800;
    window.__aramonSniperScope = { full, x0:viewW/2 - R*1.08, y0:viewH/2 - R*1.08, x1:viewW/2 + R*1.08, y1:viewH/2 + R*1.25,
                                   w:viewW, h:viewH, focus, zoom:Math.exp(v.logMag), boost:SNIPER_SCOPE_PIXEL_BOOST, veg: full && Math.exp(v.logMag) >= SNIPER_VEG_CONE_MIN_ZOOM,
                                   yaw:camState.yaw, pitch:camState.pitch, eyeZ:camPos.z,
                                   halfFovH:Math.atan(Math.tan(FOV_V/2)*viewW/viewH), halfFovV:FOV_V/2 };
  }
  sniperSyncDom(true);
}
function sniperFrameEnd(){
  const s = sniperView.saved;
  if(s){
    camPos.x = s.x; camPos.y = s.y; camPos.z = s.z;
    camState.yaw = s.yaw; camState.pitch = s.pitch;
    sniperView.saved = null;
  }
  window.__aramonSniperScope = null;
  setViewZoom(1);
}
/* 照準の先(画面中心の視線)にある物までの距離。**照準の下にある物を測る**:
   体 → 障害物(岩・木・壁・家=弾が止まる物と同じ円柱)・補給箱 → 地形 のうち、いちばん手前。
   視線が何にも当たらない/的の頭の上を越えて遠くの地面に落ちる(=落下を見越して頭の上を狙っている)ときは、
   撃てば当たる的(弾道の先読み pred)か、照準の下の落下補正の目盛りの上にいる的の距離を出す(assist)。
   手前に壁があれば壁の距離のまま(その奥の的の距離は出さない) */
function sniperAimRay(w, pred){
  const cp = Math.cos(camState.pitch);
  const dx = Math.cos(camState.yaw)*cp, dy = Math.sin(camState.yaw)*cp, dz = -Math.sin(camState.pitch);
  const maxT = w.range / Math.max(0.2, cp);
  const below = (t)=>{ const x = camPos.x+dx*t, y = camPos.y+dy*t, z = camPos.z+dz*t;
    if(z <= terrainZAt(x, y)) return true;
    for(const v of volcanoObstacles){ if(Math.hypot(x-v.x, y-v.y) < mountainRadiusAt(v, z - getTerrainHeightAt(v.x, v.y))) return true; }
    return false; };
  let tHit = null, prevT = 0;
  for(let t=SNIPER_AIM_STEP; t<=maxT; t += (t < 800 ? SNIPER_AIM_STEP : SNIPER_AIM_STEP*2)){
    if(below(t)){ tHit = t; break; }
    prevT = t;
  }
  if(tHit != null){
    let lo = prevT, hi = tHit;
    for(let i=0;i<6;i++){ const m = (lo+hi)/2; if(below(m)) hi = m; else lo = m; }
    tHit = hi;
  }
  // 障害物と補給箱(立った円柱として。天辺を越える視線・足元より下は当たらない)
  const tObj = sniperRayObjects(dx, dy, dz, tHit != null ? tHit : maxT);
  if(tObj != null && (tHit == null || tObj < tHit)) tHit = tObj;
  const tEnd = tHit != null ? tHit : maxT;
  const eh = sniperSegmentHit({ ownerId: player ? player.id : -1, hitR:0 },
    camPos.x, camPos.y, camPos.z, camPos.x+dx*tEnd, camPos.y+dy*tEnd, camPos.z+dz*tEnd);
  if(eh) return { m: eh.t*tEnd / PING_UNITS_PER_M, ent: eh.e };
  const col = sniperColumnTarget(w, pred, tHit);
  if(col) return col;
  if(tHit != null) return { m: tHit / PING_UNITS_PER_M, ent:null };
  return { m:null, ent:null };
}
// 視線と「立った円柱」の交わり(いちばん手前の t。無ければ null)
function snRayCylinder(dx, dy, dz, x, y, r, z0, z1, tMax){
  const fx = camPos.x - x, fy = camPos.y - y;
  const a = dx*dx + dy*dy;
  if(a < 1e-9) return null;
  const b = 2*(fx*dx + fy*dy), c = fx*fx + fy*fy - r*r;
  let disc = b*b - 4*a*c;
  if(disc < 0) return null;
  disc = Math.sqrt(disc);
  const tA = Math.max(0, (-b-disc)/(2*a)), tB = Math.min(tMax, (-b+disc)/(2*a));
  if(tA > tB) return null;
  const zA = camPos.z + dz*tA, zB = camPos.z + dz*tB;
  if(zA >= z0 && zA <= z1) return tA;
  // 上(天辺)か下から入る
  if(Math.abs(zB - zA) < 1e-6) return null;
  const u = ((zA > z1 ? z1 : z0) - zA) / (zB - zA);
  return (u >= 0 && u <= 1) ? tA + (tB - tA)*u : null;
}
function sniperRayObjects(dx, dy, dz, tMax){
  let best = null;
  const hx = camPos.x + dx*tMax*0.5, hy = camPos.y + dy*tMax*0.5, reach = tMax*0.5*Math.hypot(dx, dy) + 400;
  for(const r of rocks){
    if(Math.abs(r.x - hx) > reach || Math.abs(r.y - hy) > reach) continue;
    const gz = baseTerrainHeightAt(r.x, r.y);
    const t = snRayCylinder(dx, dy, dz, r.x, r.y, r.radius, gz - 20, gz + r.height, best != null ? best : tMax);
    if(t != null && (best == null || t < best)) best = t;
  }
  if(game.explore && typeof exploreState === 'object' && exploreState.crates && typeof EXPLORE_CRATE_SIZE === 'object'){
    for(const c of exploreState.crates){
      const k = (typeof exploreCrateScale === 'function') ? exploreCrateScale(c) : 1;
      const cz = c.z != null ? c.z : baseTerrainHeightAt(c.x, c.y);
      const t = snRayCylinder(dx, dy, dz, c.x, c.y, EXPLORE_CRATE_SIZE.w*0.5*k, cz - 10, cz + (EXPLORE_CRATE_SIZE.h + EXPLORE_CRATE_SIZE.lid)*k, best != null ? best : tMax);
      if(t != null && (best == null || t < best)) best = t;
    }
  }
  return best;
}
/* 頭の上(空)を向いて落下を見越しているときの的。撃てば当たる的(先読み)を最優先し、
   無ければ照準の真下の目盛りの柱(窓の半径×0.6まで)に体が掛かっている的のうち、柱にいちばん近いもの。
   視線がその的より手前の物(壁・地面)に当たっているなら出さない(照準の下にあるのは手前の物) */
function sniperColumnTarget(w, pred, tHit){
  const lim = tHit != null ? tHit : Infinity;
  const me = player;
  if(pred && pred.ent && pred.ent.alive){
    const d = Math.hypot(pred.ent.x - camPos.x, pred.ent.y - camPos.y);
    if(d < lim) return { m: d / PING_UNITS_PER_M, ent: pred.ent, assist:true };
  }
  const sc = sniperScope(me);
  const cx = viewW/2, cy = viewH/2, R = sniperApertureR(sc);
  let best = null, bestX = Infinity;
  for(const e of entities){
    if(!e.alive || e === me || e.isPlayer) continue;
    const d = Math.hypot(e.x - camPos.x, e.y - camPos.y);
    if(d > w.range || d >= lim) continue;
    const ez = e.z || 0, H = sniperBodyH(e);
    const F = project(e.x, e.y, ez), T = project(e.x, e.y, ez + H);
    if(!F || !T) continue;
    const half = Math.max(6, (e.radius||26) * SNIPER_HIT_RADIUS_MULT * F.scale);
    const off = Math.abs(F.x - cx);
    if(off > half) continue;
    if(T.y <= cy || T.y > cy + R*0.6) continue;     // 体の天辺が照準より下・目盛りの柱の中
    if(off < bestX){ bestX = off; best = { m: d / PING_UNITS_PER_M, ent:e, assist:true }; }
  }
  return best;
}
/* 撃ったら弾がどこに当たるか(落下込みの本物の弾道を先読みする)。弱点の表示に使う。
   撃つときと同じ式で進め、同じ当たりの関数を通すので、表示と実際の当たりが食い違わない。 */
function sniperPredict(w){
  const b = sniperBallistics(w);
  const yaw = camState.yaw, slope = clamp(-Math.tan(camState.pitch) + b.zero, -AIM_SLOPE_LIMIT, AIM_SLOPE_LIMIT);
  const p = { ownerId: player.id, hitR: w.hitR };
  let x = camPos.x, y = camPos.y, z = camPos.z, vz = slope*w.speed, trav = 0;
  const vx = Math.cos(yaw)*w.speed, vy = Math.sin(yaw)*w.speed, h = SNIPER_PREDICT_STEP, step = w.speed*h;
  // 弾道の下にある岩・壁(弾が止まる物)は先に絞っておく(毎刻み全部の岩を見ない)
  const ux = Math.cos(yaw), uy = Math.sin(yaw);
  const obs = rocks.filter(r=>{ const ax = r.x - x, ay = r.y - y, al = ax*ux + ay*uy;
    return al > -r.radius && al < w.range + r.radius && Math.abs(ax*uy - ay*ux) < r.radius + (w.hitR||0) + 4; });
  while(trav < w.range){
    const x1 = x + vx*h, y1 = y + vy*h, z1 = z + vz*h;
    vz -= b.grav*h; trav += step;
    const hit = sniperSegmentHit(p, x, y, z, x1, y1, z1);
    if(hit) return { ent:hit.e, x:hit.x, y:hit.y, z:hit.z, weak: sniperIsWeakHit(hit.e, hit.z, hit.H) };
    if(z1 <= terrainZAt(x1, y1)) return null;
    for(const r of obs){
      if(Math.hypot(x1-r.x, y1-r.y) < r.radius + (w.hitR||0) && z1 < baseTerrainHeightAt(r.x, r.y) + r.height) return null;
    }
    x = x1; y = y1; z = z1;
  }
  return null;
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
  // 窓のあるスコープでは倍率と残弾を窓の中に出すので、HUDの札は隠す(アイアンは札が唯一の表示)
  const bodyWin = bodyAds && sc && sc.aperture > 0;
  if(bodyWin !== v.bodyWin){ v.bodyWin = bodyWin; document.body.classList.toggle('sniper-window', bodyWin); }
}

/* ---------- 弾道の光(render.js の drawProjectile から。2Dの世界の中に描く) ----------
   撃ってから今までの弧を全部持っていて、見た目だけ銃口(画面の右下)から出して
   SNIPER_TRACER_CONVERGE(160m)で照準の線に合流させる。スコープの中では
   「右下から伸びて照準へ吸い込まれ、先で落ちていく光の筋」に見える(当たりは本物の弾道)。 */
/* 銃口(画面の右下)から出て照準の線へ合流する見た目は、**ワールド座標でなく画面座標で寄せる**。
   以前はワールド側で小さくオフセットしてから投影していたが、近距離ではその小さな量が画面上で
   大きく見え、遠距離ではほぼ0になるため(遠近感で1/距離に効く)、合流の境目(SNIPER_TRACER_CONVERGE)で
   弧の傾きが急に変わり「途中で折れて真下へ落ちるL字」に見えていた(批評)。
   画面座標なら「固定の1点(銃口の見かけの位置)」から「本当の弾道の投影点」へ kk の割合で線形に寄せるだけなので、
   kk が滑らかに変わる限り折れ目が出ない。 */
function sniperTracerPoints(pts){
  const ax = viewW/2 + viewH*SNIPER_TRACER_ANCHOR_DX, ay = viewH/2 + viewH*SNIPER_TRACER_ANCHOR_DY;
  const out = [];
  for(const q of pts){
    const P = project(q.x, q.y, q.z);
    if(!P || P.depth <= 3) continue;
    const k = Math.max(0, 1 - (q.d||0) / SNIPER_TRACER_CONVERGE);
    const kk = k*k*(3-2*k);
    out.push({ x:P.x + (ax - P.x)*kk, y:P.y + (ay - P.y)*kk, scale:P.scale, depth:P.depth });
  }
  return out;
}
/* 光の筋の太さは**点ごとの距離**で決める(近い所ほど太く、遠い所は細い芯だけ)。
   以前は先頭の点の拡大率で全体を塗っていたので、近距離では銃口側が太い棒になった(批評)。
   スコープで覗いている間は、窓の中心から半径×SNIPER_TRACER_CLIP の内側だけに描く
   (右下の残弾の表示に被せない。弧の読みどころ=照準の周りは全部入る) */
/* 太さは画面上の拡大率(倍率込み)で決める=手前ほど太く、先ほど細い。芯は SNIPER_TRACER_CORE_PX の範囲、
   光のにじみは芯の何倍か(base は芯を1とした倍率) */
function tracerWidth(P, base){
  const core = clamp(SNIPER_TRACER_CORE_PX[1]*Math.sqrt(Math.max(0.01, P.scale)*0.9), SNIPER_TRACER_CORE_PX[0], SNIPER_TRACER_CORE_PX[1]);
  return core * base;
}
function drawTracerPath(g, sp, fade, headGlow){
  if(sp.length < 2) return;
  const head = sp[sp.length-1];
  g.save();
  const clip = sniperTracerClip();
  if(clip){
    // 窓の円の中、ただし目盛りの数字の上は描かない(偶奇規則で数字の矩形をくり抜く)
    g.beginPath(); g.arc(clip.x, clip.y, clip.r, 0, Math.PI*2);
    for(const r of (sniperView.textRects || [])) g.rect(r[0], r[1], r[2], r[3]);
    g.clip('evenodd');
  }
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round'; g.lineJoin = 'round';
  // 古い所ほど薄く(尾)。区間ごとに透明度と太さを変えて描く
  const n = sp.length;
  for(let pass=0; pass<3; pass++){
    const col = pass===0 ? '255,140,50' : (pass===1 ? '255,180,90' : '255,244,220');
    const base = pass===0 ? 3.6 : (pass===1 ? 1.8 : 1);           // にじみ / 中 / 芯
    const amax = (pass===0 ? 0.26 : (pass===1 ? 0.5 : 0.98)) * fade;
    for(let i=1;i<n;i++){
      const u = i/(n-1);
      const a = amax * (0.25 + 0.75*Math.pow(u, 1.3));
      if(a < 0.01) continue;
      g.strokeStyle = `rgba(${col},${a})`;
      g.lineWidth = Math.max(1, tracerWidth(sp[i], base));
      g.beginPath(); g.moveTo(sp[i-1].x, sp[i-1].y); g.lineTo(sp[i].x, sp[i].y); g.stroke();
    }
  }
  if(headGlow){
    const r = Math.max(2.2, tracerWidth(head, 2.6));
    const hg = g.createRadialGradient(head.x, head.y, 0, head.x, head.y, r*2.4);
    hg.addColorStop(0, `rgba(255,250,235,${0.95*fade})`); hg.addColorStop(0.35, `rgba(255,200,120,${0.55*fade})`); hg.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = hg; g.beginPath(); g.arc(head.x, head.y, r*2.4, 0, Math.PI*2); g.fill();
  }
  g.restore();
}
// スコープで覗いている間の光の筋の描き範囲(窓の中心の円)。構えていなければ null
function sniperTracerClip(){
  const v = sniperView;
  if(!sniperModeOn() || v.blend < 0.5 || !player) return null;
  const sc = sniperScope(player);
  if(sc.aperture <= 0) return null;
  return { x:viewW/2, y:viewH/2, r:sniperApertureR(sc)*SNIPER_TRACER_CLIP };
}
function drawSniperTracer(pr){
  const pts = pr.trail;
  if(!pts || pts.length < 1) return;
  const all = pts.concat([{ x:pr.x, y:pr.y, z:pr.z, d:pr.traveled }]);
  drawTracerPath(ctx, sniperTracerPoints(all), 1, true);
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
// 照明色(琥珀)。暗い空でも明るい砂地でも読めるよう、黒の縁取りと合わせて使う
const SN_AMBER = '#ffb347';
function snText(g, str, x, y, size, color, align, weight){
  g.font = `${weight || 'bold'} ${Math.round(size)}px 'Share Tech Mono', 'Rajdhani', monospace`;
  g.textAlign = align || 'left'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = Math.max(2.5, size*0.28); g.strokeStyle = 'rgba(0,0,0,0.82)';
  g.strokeText(str, x, y);
  g.fillStyle = color; g.fillText(str, x, y);
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
  v.dropPlan = null; v.textRects = [];
  const cx = viewW/2, cy = viewH/2;
  // 反動の山の強さ(0〜1)。窓は銃と一緒に沈み、鏡筒の影が窓の一部を黒く欠けさせる
  const rk = clamp(v.recoil / Math.max(1e-5, v.recoilPeak), 0, 1);
  const apR = sniperApertureR(sc);
  const W = sc.aperture > 0 ? { x:cx + FOCAL*Math.tan(v.recoilX)*0.3, y:cy + rk*apR*0.16,
                                R:apR*(0.8 + 0.2*a)*(1 - 0.05*rk), eclipse:rk } : null;
  g.save();
  g.globalAlpha = a;
  if(W) drawScopeBody(g, W, sc); else drawIronSight(g, cx, cy, a);
  // 照準(弾が飛ぶ先=画面の中心)
  if(W){ g.save(); g.beginPath(); g.arc(W.x, W.y, W.R, 0, Math.PI*2); g.clip(); }
  const aimMode = v.pred && v.pred.weak ? 'weak' : ((v.pred && v.pred.ent) || (v.aim && v.aim.ent && !v.aim.assist) ? 'body' : null);
  if(sc.reticle === 'chevron') drawReticleChevron(g, cx, cy, W, aimMode);
  else if(sc.reticle === 'mildot') drawReticleMildot(g, cx, cy, W, aimMode, w);
  else if(sc.reticle === 'bdc') drawReticleBdc(g, cx, cy, W, aimMode, w);
  drawScopeTrails(g);
  drawScopeImpacts(g);
  drawScopeSmoke(g, W || { x:cx, y:cy, R:viewH*0.45 });
  if(W){ drawMuzzleFlame(g, W); g.restore(); }
  if(W) drawLensGlass(g, W);
  drawScopeInfo(g, cx, cy, W, sc, w);
  drawScopeHits(g, cx, cy, W);
  g.restore();
}
/* 遠景の空気の霞(render.js が3Dの地面を描いた直後・モンスターを描く前に呼ぶ=ゲーム画面の2Dキャンバス)。
   地平線のまわりをテーマの霞の色で薄く包み、倍率で引き伸ばされた遠い山と空のにじみを「空気」に見せる。
   モンスターより下に塗るので、的そのものは霞まない。 */
function drawSniperHaze(){
  const v = sniperView;
  if(!sniperModeOn() || v.blend <= 0.05 || !player) return;
  const sc = sniperScope(player);
  const k = clamp((Math.exp(v.logMag) - 1.5) / 2.5, 0, 1) * sniperEase(v.blend);   // 2倍から効き始め、4倍で全部
  if(sc.aperture <= 0 || k <= 0.01) return;
  const W = { x:viewW/2, y:viewH/2, R:sniperApertureR(sc) };
  ctx.save();
  ctx.globalAlpha = k;
  ctx.beginPath(); ctx.arc(W.x, W.y, W.R*1.1, 0, Math.PI*2); ctx.clip();
  drawScopeHaze(ctx, W);
  ctx.restore();
}
function drawScopeHaze(g, W){
  const th = window.__aramonRealTheme;
  const hz = (th && typeof th.haze === 'number') ? th.haze : 0xcfc2a6;
  const rgb = `${(hz>>16)&255},${(hz>>8)&255},${hz&255}`;
  // 地平線(目の高さの遠い点)の画面上の高さ
  const far = 6000, P = project(camPos.x + Math.cos(camState.yaw)*far, camPos.y + Math.sin(camState.yaw)*far, camPos.z);
  const hy = P ? P.y : W.y;
  // 窓の中全体へは膜をかけない(手前の地面・着弾まで灰色にかすんで見えなくなる=批評)。空気は地平線の帯だけ
  // 地平線に濃い帯、その上の空へも薄く伸ばす(拡大された雲の粗い模様を空気で和らげる)
  const top = Math.min(hy - W.R*0.2, W.y - W.R*1.1), bot = hy + W.R*0.25;
  const u = (y)=> clamp((y - top) / Math.max(1, bot - top), 0, 1);
  const hg = g.createLinearGradient(0, top, 0, bot);
  // 薄く(濃いと地平線から上が一面の灰緑の壁になる=批評)。遠くの形が読める程度の空気だけ
  hg.addColorStop(0, `rgba(${rgb},0.03)`);
  hg.addColorStop(u(hy - W.R*0.3), `rgba(${rgb},0.06)`);
  hg.addColorStop(u(hy - W.R*0.02), `rgba(${rgb},0.13)`);
  hg.addColorStop(u(hy + W.R*0.1), `rgba(${rgb},0.05)`);
  hg.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = hg; g.fillRect(W.x - W.R*1.1, top, W.R*2.2, bot - top);
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
  // 4. 反動の山: 目がアイボックスから外れて、窓の上側が鏡筒の影で黒く欠ける
  if(W.eclipse > 0.02){
    g.save();
    g.beginPath(); g.arc(x, y, R, 0, Math.PI*2); g.clip();
    // 窓より少し下に中心を持つ円の外側を黒く塗る=上側が三日月形に欠ける(縁は少しぼかす)
    const k = W.eclipse, off = R*(0.32 + (1-k)*1.1);
    const eg = g.createRadialGradient(x, y + off, R*0.98, x, y + off, R*1.12);
    eg.addColorStop(0, 'rgba(1,2,4,0)'); eg.addColorStop(0.35, `rgba(1,2,4,${0.9*k})`); eg.addColorStop(1, `rgba(1,2,4,${0.98*k})`);
    g.fillStyle = eg; g.fillRect(x-R, y-R, R*2, R*2);
    g.restore();
  }
}
// レンズのガラス感: 縁の色収差・コーティングの反射・三日月の映り込み(照準より上に薄く重ねる)
function drawLensGlass(g, W){
  const { x, y, R } = W;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.lineWidth = 2.2;
  g.strokeStyle = 'rgba(255,70,40,0.22)'; g.beginPath(); g.arc(x+1.3, y+0.7, R*0.986, 0, Math.PI*2); g.stroke();
  g.strokeStyle = 'rgba(60,150,255,0.22)'; g.beginPath(); g.arc(x-1.3, y-0.7, R*0.978, 0, Math.PI*2); g.stroke();
  g.beginPath(); g.arc(x, y, R, 0, Math.PI*2); g.clip();
  const gl = g.createRadialGradient(x-R*0.45, y-R*0.52, 0, x-R*0.45, y-R*0.52, R*0.75);
  gl.addColorStop(0, 'rgba(170,215,255,0.09)'); gl.addColorStop(0.5, 'rgba(120,170,255,0.03)'); gl.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gl; g.fillRect(x-R, y-R, R*2, R*2);
  const crescent = (dx, dy, rgb, amax)=>{
    const cg = g.createLinearGradient(x - Math.sign(dx)*R, y - Math.sign(dy)*R, x + Math.sign(dx)*R*0.2, y + Math.sign(dy)*R*0.2);
    cg.addColorStop(0, `rgba(${rgb},0)`); cg.addColorStop(0.35, `rgba(${rgb},${amax})`); cg.addColorStop(1, `rgba(${rgb},0)`);
    g.beginPath(); g.arc(x, y, R*0.985, 0, Math.PI*2); g.arc(x + dx*R, y + dy*R, R*0.985, 0, Math.PI*2, true);
    g.fillStyle = cg; g.fill();
  };
  crescent(0.035, 0.045, '235,245,255', 0.16);
  crescent(-0.012, -0.016, '255,200,150', 0.05);
  g.restore();
}
/* 発砲の閃光。銃口は窓の真下(画面の外)にあるので、そこから**放射状に短い炎の筋**が窓の下側へ差し込み、
   最初の1〜2フレームだけ白く光る芯が出る。同じ瞬間、窓の縁(鏡筒の内側)全体が一瞬明るむ。
   卵形のぼやけを並べる形はやめた(批評)。筋の向きと長さは撃つたびに変える(flashSeed) */
function drawMuzzleFlame(g, W){
  const v = sniperView, f = v.flash;
  if(f <= 0.02) return;
  const { x, y, R } = W;
  const mx = x, my = y + R*1.12;                      // 銃口(窓の外の下)
  let sd = v.flashSeed || 1;
  const rnd = ()=>{ sd = (sd*16807) % 2147483647; return (sd % 10000)/10000; };
  g.save();
  g.globalCompositeOperation = 'lighter';
  // 窓の縁全体が一瞬明るむ(内側の縁の光)
  g.lineWidth = Math.max(3, R*0.05);
  g.strokeStyle = `rgba(255,196,120,${0.55*f})`;
  g.beginPath(); g.arc(x, y, R*0.975, 0, Math.PI*2); g.stroke();
  g.beginPath(); g.arc(x, y, R, 0, Math.PI*2); g.clip();
  // 放射状の炎の筋
  const N = 11;
  for(let i=0;i<N;i++){
    const ang = -Math.PI/2 + (i/(N-1) - 0.5)*1.5 + (rnd()-0.5)*0.12;
    const L = R*(0.22 + rnd()*0.32)*(0.55 + 0.45*f);
    const w0 = R*(0.018 + rnd()*0.02);
    const x1 = mx + Math.cos(ang)*R*0.14, y1 = my + Math.sin(ang)*R*0.14;
    const x2 = mx + Math.cos(ang)*(R*0.14 + L), y2 = my + Math.sin(ang)*(R*0.14 + L);
    const lg = g.createLinearGradient(x1, y1, x2, y2);
    lg.addColorStop(0, `rgba(255,245,220,${0.95*f})`); lg.addColorStop(0.4, `rgba(255,185,90,${0.7*f})`); lg.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = lg;
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    g.beginPath();
    g.moveTo(x1 + nx*w0, y1 + ny*w0);
    g.lineTo(x2, y2);
    g.lineTo(x1 - nx*w0, y1 - ny*w0);
    g.closePath(); g.fill();
  }
  // 白く光る芯(最初の1〜2フレームだけ)
  if(f > 0.62){
    const k = (f - 0.62)/0.38;
    const cg = g.createRadialGradient(mx, my, 0, mx, my, R*0.42);
    cg.addColorStop(0, `rgba(255,255,248,${0.95*k})`); cg.addColorStop(0.35, `rgba(255,236,190,${0.6*k})`); cg.addColorStop(1, 'rgba(255,190,110,0)');
    g.fillStyle = cg; g.fillRect(x - R, y + R*0.5, R*2, R*0.5);
  }
  g.restore();
}
// 照準の線(黒い線+薄い光の縁取り。明るい空でも暗い森でも読める)
function retLine(g, x0, y0, x1, y1, w){
  g.lineCap = 'butt';
  g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = w + 1.6;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.strokeStyle = 'rgba(8,9,11,0.94)'; g.lineWidth = w;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
}
function retDot(g, x, y, r){
  g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.arc(x, y, r+0.9, 0, Math.PI*2); g.fill();
  g.fillStyle = 'rgba(8,9,11,0.94)'; g.beginPath(); g.arc(x, y, r, 0, Math.PI*2); g.fill();
}
/* 発光する中心。mode: null=何も無い / 'body'=撃てば体に当たる(赤く脈打つ) /
   'weak'=撃てば弱点に当たる(金色の菱形+輪。モンハンの弱点表示の役目) */
function retGlow(g, fn, mode){
  g.save();
  g.globalCompositeOperation = 'lighter';
  const k = mode ? 0.8 + 0.2*Math.sin(performance.now()*0.018) : 0.6;
  const col = mode === 'weak' ? '#ffc93a' : (mode === 'body' ? '#ff5a3c' : '#ff3b2e');
  g.shadowColor = mode === 'weak' ? `rgba(255,190,40,${k})` : `rgba(255,60,40,${k})`; g.shadowBlur = mode ? 10 : 6;
  g.strokeStyle = g.fillStyle = col;
  fn();
  g.restore();
}
/* 弱点の印は2つに分けて出す(批評5巡目)。
   ① drawWeakOnTarget: **的の実際の頭の位置**に毎フレーム project() で投影して置く「そこが弱点」の印。
      反動・的の動きでどれだけ照準がずれても、的が画面内にいる限り必ず頭の上に乗る(浮かない)。
   ② drawDropChevron: 「今撃つと(落下込みで)当たる点」を示す小さな山形の印。弾道の先読み(v.pred)。
      以前はこの先読み点に①の菱形+輪+文字をまとめて出していたので、反動で先読みが的から外れる/消えると
      印そのものが宙に浮いて見えた。役目を分けたので①は常に的の上、②は当たり損じても的から外れて見えるだけになる */
function sniperWeakWorldPos(e){
  if(!e || !e.alive || !e.weakPoint) return null;
  const H = sniperBodyH(e);
  const from = e.weakPoint.from != null ? e.weakPoint.from : SNIPER_WEAK_FROM;
  const to = Math.min(1.05, e.weakPoint.to != null ? e.weakPoint.to : 1.05);
  return { x:e.x, y:e.y, z:(e.z||0) + H*((from+to)/2) };
}
function drawWeakOnTarget(g, s){
  const e = (sniperView.aim && sniperView.aim.ent) || (sniperView.pred && sniperView.pred.ent);
  const pos = sniperWeakWorldPos(e);
  if(!pos) return;
  const P = project(pos.x, pos.y, pos.z);
  if(!P) return;
  drawWeakMark(g, P.x, P.y, s);
}
function drawWeakMark(g, cx, cy, s){
  retGlow(g, ()=>{
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx + s, cy); g.lineTo(cx, cy + s); g.lineTo(cx - s, cy); g.closePath(); g.stroke();
    g.lineWidth = 1.4;
    g.beginPath(); g.arc(cx, cy, s*1.9, 0, Math.PI*2); g.stroke();
  }, 'weak');
  // 当たりの×印が出ている間は文字を出さない(×と重なって読めない)
  if(sniperView.fx.some(f=> f.kind === 'hit' && f.t < 0.34)) return;
  // 落下補正の目盛りの数字(200/300など)と重なると「弱点200」に読めてしまう(批評)。
  // 重なる高さなら文字を少しずつ上へ動かし、それでも空きが無ければ文字を諦める(印そのものは出す)
  const fs = 12, tw = 38, th = fs*1.35;
  let ty = cy - s*2.1, ok = false;
  for(let i=0;i<4;i++){
    const y0 = ty - fs*0.8;
    ok = (sniperView.textRects || []).every(r=> !(cx + s*2.3 < r[0]+r[2] && cx + s*2.3+tw > r[0] && y0 < r[1]+r[3] && y0+th > r[1]));
    if(ok) break;
    ty -= th;
  }
  if(ok) snText(g, '弱点', cx + s*2.3, ty, fs, '#ffd46a', 'left', 'bold');
}
// 落下を見込んだ「今撃つと当たる点」の小さな山形の印(的の実際の弱点の印とは別に出す)
function drawDropChevron(g, cx, cy, s){
  const pr = sniperView.pred;
  if(!pr || pr.x == null) return;
  const P = project(pr.x, pr.y, pr.z);
  if(!P) return;
  retGlow(g, ()=>{
    g.lineWidth = 1.6; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(P.x - s, P.y + s*0.65); g.lineTo(P.x, P.y - s*0.7); g.lineTo(P.x + s, P.y + s*0.65); g.stroke();
  }, pr.weak ? 'weak' : 'body');
}
/* 落下補正の数字の並べ方。
   ・数字は1列にまとめる(左右に振り分けると、縦持ちで左の数字が的に被る=批評)。
   ・列は右が基本。右の列に的の体が掛かっていれば左へ(的のいない側にだけ出す)。
   ・目盛りの間隔が文字の高さより狭くて区別できない数字は省く。残す順は 200・300 → 150 → 250
     (4倍では「300」と「250」が同じ高さに重なっていた)。目盛りの線そのものは全部引く。
   返り値: { side:'r'|'l', shown:Set(m), bottom:右の列のいちばん下の数字の高さ(左なら null) } */
function sniperDropPlan(marks, cx, cy, R, fs){
  const need = fs*1.2;
  const order = [...marks].sort((a, b)=> SNIPER_DROP_LABEL_ORDER.indexOf(a.m) - SNIPER_DROP_LABEL_ORDER.indexOf(b.m));
  const kept = [];
  for(const mk of order){ if(kept.every(q=> Math.abs(q.y - mk.y) >= need)) kept.push(mk); }
  const shown = new Set(kept.map(q=> q.m));
  if(!kept.length) return { side:'r', xk:SNIPER_DROP_LABEL_X, shown, dim:false, bottom:null };
  const y0 = Math.min(...kept.map(q=> q.y)) - fs*0.7, y1 = Math.max(...kept.map(q=> q.y)) + fs*0.7;
  const colW = fs*2.4;
  const rect = (side, xk)=> side === 'r' ? [cx + R*xk - 4, cx + R*xk + colW] : [cx - R*xk - colW, cx - R*xk + 4];
  const cover = (side, xk)=>{
    const [x0, x1] = rect(side, xk);
    let area = 0;
    for(const e of entities){
      if(!e.alive || e.isPlayer) continue;
      const F = project(e.x, e.y, e.z || 0), T = project(e.x, e.y, (e.z || 0) + sniperBodyH(e));
      if(!F || !T) continue;
      const hw = (e.radius || 26) * BODY_W_MAX * 0.6 * F.scale;
      const ox = Math.min(x1, F.x + hw) - Math.max(x0, F.x - hw), oy = Math.min(y1, F.y) - Math.max(y0, T.y);
      if(ox > 0 && oy > 0) area += ox*oy;
    }
    return area;
  };
  /* 数字は**いつも目盛りの右**(倍率で左右が入れ替わると読みにくい=批評)。的の体に掛かるときは薄くする */
  const xk = SNIPER_DROP_LABEL_X;
  return { side:'r', xk, shown, dim: cover('r', xk) > 0, bottom: Math.max(...kept.map(q=> q.y)) };
}
function drawDropLabel(g, plan, cx, y, R, fs, leftEnd, rightStart, text){
  const colR = cx + R*plan.xk;
  g.save();
  if(plan.dim) g.globalAlpha *= SNIPER_DROP_LABEL_DIM;
  g.setLineDash([2,3]); g.strokeStyle = 'rgba(255,179,71,0.5)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(rightStart, y); g.lineTo(colR - 4, y); g.stroke(); g.setLineDash([]);
  snText(g, text, colR, y, fs, SN_AMBER, 'left');
  g.restore();
  // 弾道の光はこの数字の上に描かない(sniper の drawTracerPath が読む)
  (sniperView.textRects || (sniperView.textRects = [])).push([colR - 2, y - fs*0.7, fs*2.6, fs*1.4]);
}
function drawReticleChevron(g, cx, cy, W, mode){
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
  }, mode === 'weak' ? 'body' : mode);
  if(mode === 'weak'){ drawDropChevron(g, cx, cy, Math.max(5, R*0.022)); drawWeakOnTarget(g, Math.max(6, R*0.03)); }
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
// 目盛りの数字の大きさは窓の半径から決める(縦持ちの小さな窓でも潰れない下限つき)
function dropLabelSize(R){ return Math.max(11, Math.min(14, R*0.045)); }
function drawReticleMildot(g, cx, cy, W, mode, w){
  const R = W.R, gap = R*0.035;
  for(const [dx, dy] of [[-1,0],[1,0],[0,1],[0,-1]]){
    retLine(g, cx + dx*R, cy + dy*R, cx + dx*R*0.5, cy + dy*R*0.5, 4);
    retLine(g, cx + dx*R*0.5, cy + dy*R*0.5, cx + dx*gap, cy + dy*gap, 1.2);
    for(let i=1;i<=4;i++) retDot(g, cx + dx*R*0.1*i, cy + dy*R*0.1*i, 1.9);
  }
  // 落下補正: 下の縦線に琥珀の短い横線、数字は右の柱寄りに揃える
  const fs = dropLabelSize(R);
  const marks = sniperDropMarks(w).filter(mk=> mk.y > cy + gap*1.5 && mk.y <= cy + R*0.48);
  const plan = sniperDropPlan(marks, cx, cy, R, fs);
  sniperView.dropPlan = plan;
  for(const mk of marks){
    const on = plan.shown.has(mk.m);
    g.strokeStyle = on ? SN_AMBER : 'rgba(255,179,71,0.55)'; g.lineWidth = on ? 1.6 : 1.1;
    const hw = R*(on ? 0.04 : 0.025);
    g.beginPath(); g.moveTo(cx - hw, mk.y); g.lineTo(cx + hw, mk.y); g.stroke();
    if(on) drawDropLabel(g, plan, cx, mk.y, R, fs, cx - R*0.05, cx + R*0.05, String(mk.m));
  }
  retGlow(g, ()=>{ g.beginPath(); g.arc(cx, cy, 2.3, 0, Math.PI*2); g.fill(); }, mode === 'weak' ? 'body' : mode);
  if(mode === 'weak'){ drawDropChevron(g, cx, cy, Math.max(5, R*0.022)); drawWeakOnTarget(g, Math.max(6, R*0.03)); }
}
function drawReticleBdc(g, cx, cy, W, mode, w){
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
  // 落下補正のはしご(距離ごとの横線+数字。実際の弾道から毎フレーム引く)。
  // 線は照明色(琥珀)で光らせ、数字は右の柱寄りの1列に揃える(暗い空でも明るい地面でも読める)
  const marks = sniperDropMarks(w);
  const fs = dropLabelSize(R);
  const plan = sniperDropPlan(marks.filter(mk=> mk.y > cy + gap*1.5 && mk.y <= cy + R*0.6), cx, cy, R, fs);
  sniperView.dropPlan = plan;
  let lastY = cy;
  marks.forEach((mk, i)=>{
    if(mk.y <= cy + gap*1.5 || mk.y > cy + R*0.6) return;
    const hw = R*(0.085 - i*0.012);
    g.save(); g.globalCompositeOperation = 'lighter';
    g.shadowColor = 'rgba(255,150,40,0.8)'; g.shadowBlur = 4;
    g.strokeStyle = SN_AMBER; g.lineWidth = 1.7;
    g.beginPath(); g.moveTo(cx - hw, mk.y); g.lineTo(cx + hw, mk.y); g.stroke();
    g.fillStyle = SN_AMBER;
    for(const s of [-1,1]){ g.beginPath(); g.arc(cx + s*(hw + 5), mk.y, 1.8, 0, Math.PI*2); g.fill(); }
    g.restore();
    if(plan.shown.has(mk.m)) drawDropLabel(g, plan, cx, mk.y, R, fs, cx - hw - 9, cx + hw + 9, String(mk.m));
    lastY = mk.y;
  });
  // 細い縦線をはしごの下まで
  retLine(g, cx, cy + gap, cx, Math.max(cy + R*0.62, lastY), 1.1);
  retGlow(g, ()=>{
    g.beginPath(); g.arc(cx, cy, 2.1, 0, Math.PI*2); g.fill();
    g.lineWidth = 1.1; g.beginPath(); g.arc(cx, cy, R*0.022 + 3, 0, Math.PI*2); g.stroke();
  }, mode === 'weak' ? 'body' : mode);
  if(mode === 'weak'){ drawDropChevron(g, cx, cy, Math.max(5, R*0.022)); drawWeakOnTarget(g, Math.max(6, R*0.03)); }
}
/* アイアンサイト: 手前にある銃そのもの。照門(くっきりした金属の輪)・照星(フードの中の柱)・機関部。
   倍率は data.js の iron.mag(1.25)がそのまま掛かり、札も「1.25×」(HUD の札に出す。空中には描かない) */
/* アイアンサイト: 手前にある銃そのもの。黒い切り絵にしないため、
   ・機関部は左の面を明るく右の面を暗く(光は左上から)、上面に細いハイライト、レールの溝に陰と照り
   ・照門は面取りした縁に光(内側の縁の左上が明るく、右下が暗い)
   ・照星は細い柱+フード、先端に集光ファイバー(発光する色の短い棒)
   倍率は data.js の iron.mag(1.25)がそのまま掛かり、札も「1.25×」(HUD の札に出す。空中には描かない) */
function drawIronSight(g, cx, cy, a){
  const H = viewH, v = sniperView;
  // 画面の縁をわずかに落とす(目の前に銃がある暗さ)
  const vg = g.createRadialGradient(cx, cy, H*0.35, cx, cy, Math.max(viewW, H)*0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.38)');
  g.fillStyle = vg; g.fillRect(0, 0, viewW, H);
  const lin = (x0, y0, x1, y1, stops)=>{ const lg = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o,c])=> lg.addColorStop(o,c)); return lg; };
  const Ri = H*0.11, Ro = H*0.158;
  const topY = cy + Ro*1.35, baseW = H*0.2, topW = H*0.045;
  // --- 機関部: 左の面(明るい)・右の面(暗い)・上面(細い照り) ---
  g.fillStyle = lin(cx - baseW, 0, cx, 0, [[0,'#2a2e35'],[1,'#4a505a']]);
  g.beginPath(); g.moveTo(cx - topW, topY); g.lineTo(cx, topY); g.lineTo(cx, H); g.lineTo(cx - baseW, H); g.closePath(); g.fill();
  g.fillStyle = lin(cx, 0, cx + baseW, 0, [[0,'#23262c'],[1,'#0d0e11']]);
  g.beginPath(); g.moveTo(cx, topY); g.lineTo(cx + topW, topY); g.lineTo(cx + baseW, H); g.lineTo(cx, H); g.closePath(); g.fill();
  // 上面(左右の面の境)の細い照り返しと、面の境の稜線
  g.fillStyle = lin(0, topY, 0, H, [[0,'rgba(215,225,240,0.55)'],[1,'rgba(215,225,240,0.10)']]);
  g.beginPath(); g.moveTo(cx - H*0.006, topY); g.lineTo(cx + H*0.004, topY); g.lineTo(cx + H*0.02, H); g.lineTo(cx - H*0.03, H); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(cx + H*0.004, topY); g.lineTo(cx + H*0.02, H); g.stroke();
  // 外側の輪郭の照り(左の面の縁)
  g.strokeStyle = 'rgba(190,200,215,0.25)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(cx - topW, topY); g.lineTo(cx - baseW, H); g.stroke();
  // レールの溝(陰の線+すぐ下の照りの線)
  for(let i=1;i<7;i++){
    const yy = topY + (H - topY)*(i/7)*(i/7);
    const hw = topW + (baseW - topW)*((yy - topY)/(H - topY));
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(cx - hw*0.32, yy); g.lineTo(cx + hw*0.32, yy); g.stroke();
    g.strokeStyle = 'rgba(200,210,225,0.18)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx - hw*0.32, yy + 1.5); g.lineTo(cx + hw*0.05, yy + 1.5); g.stroke();
  }
  // --- 照星: 銃身へ降りる台・フード・柱 ---
  const hoodR = H*0.03, hoodY = cy + hoodR*0.25;
  g.fillStyle = lin(cx - hoodR, 0, cx + hoodR, 0, [[0,'#4a505a'],[0.5,'#2a2d33'],[1,'#121317']]);
  g.beginPath(); g.moveTo(cx - hoodR*0.55, hoodY + hoodR*0.7); g.lineTo(cx + hoodR*0.55, hoodY + hoodR*0.7);
  g.lineTo(cx + hoodR*0.9, cy + Ri*1.05); g.lineTo(cx - hoodR*0.9, cy + Ri*1.05); g.closePath(); g.fill();
  g.lineWidth = Math.max(2.5, H*0.006);
  g.strokeStyle = lin(cx - hoodR, hoodY - hoodR, cx + hoodR, hoodY + hoodR, [[0,'#5a606a'],[1,'#16181c']]);
  g.beginPath(); g.arc(cx, hoodY, hoodR, Math.PI*0.08, Math.PI*0.92, true); g.stroke();
  g.strokeStyle = 'rgba(220,230,245,0.45)'; g.lineWidth = 1;
  g.beginPath(); g.arc(cx, hoodY, hoodR + 1.2, Math.PI*1.12, Math.PI*1.45); g.stroke();
  // 柱は細く(的の目を隠さない)。先の明るい点が狙点で、柱はその少し下から始まる
  const pw = Math.max(1.1, H*0.0024), dotR = Math.max(1.6, H*0.0034);
  g.fillStyle = lin(cx - pw, 0, cx + pw, 0, [[0,'#3a3f47'],[1,'#101114']]);
  g.beginPath(); g.moveTo(cx - pw*0.7, cy + dotR*1.3); g.lineTo(cx + pw*0.7, cy + dotR*1.3); g.lineTo(cx + pw*1.5, hoodY + hoodR*0.75); g.lineTo(cx - pw*1.5, hoodY + hoodR*0.75); g.closePath(); g.fill();
  // --- 照門: 手前の金属の輪。面取りした内側の縁に光、外周にも薄い照り ---
  g.save();
  // 目のすぐ前の照門はピントが合わない: 輪の縁をぼかす(同じ色の影をにじませる)
  g.shadowColor = 'rgba(14,16,20,0.85)'; g.shadowBlur = Math.max(3, H*0.012);
  g.beginPath(); g.arc(cx, cy, Ro, 0, Math.PI*2); g.arc(cx, cy, Ri, 0, Math.PI*2, true);
  g.fillStyle = lin(cx - Ro, cy - Ro, cx + Ro, cy + Ro, [[0,'#5a606a'],[0.45,'#2a2d33'],[1,'#0e0f12']]);
  g.fill();
  g.shadowBlur = 0;
  // 金属の照り返し: 外周の左上に幅のある柔らかい光、右下の縁に空の映り込み
  g.save();
  g.beginPath(); g.arc(cx, cy, Ro, 0, Math.PI*2); g.arc(cx, cy, Ri, 0, Math.PI*2, true); g.clip('evenodd');
  const sp = g.createRadialGradient(cx - Ro*0.55, cy - Ro*0.6, 0, cx - Ro*0.55, cy - Ro*0.6, Ro*0.75);
  sp.addColorStop(0, 'rgba(235,242,252,0.42)'); sp.addColorStop(0.5, 'rgba(200,212,230,0.12)'); sp.addColorStop(1, 'rgba(200,212,230,0)');
  g.fillStyle = sp; g.fillRect(cx - Ro, cy - Ro, Ro*2, Ro*2);
  const sky = g.createRadialGradient(cx + Ro*0.6, cy + Ro*0.55, 0, cx + Ro*0.6, cy + Ro*0.55, Ro*0.5);
  sky.addColorStop(0, 'rgba(150,185,220,0.18)'); sky.addColorStop(1, 'rgba(150,185,220,0)');
  g.fillStyle = sky; g.fillRect(cx - Ro, cy - Ro, Ro*2, Ro*2);
  g.restore();
  // 面取り(内側の縁の帯): 左上が明るく右下が暗い
  const bev = Math.max(3, H*0.012);
  g.lineWidth = bev;
  g.strokeStyle = lin(cx - Ri, cy - Ri, cx + Ri, cy + Ri, [[0,'rgba(235,242,252,0.8)'],[0.5,'rgba(120,128,140,0.35)'],[1,'rgba(0,0,0,0.85)']]);
  g.beginPath(); g.arc(cx, cy, Ri + bev/2, 0, Math.PI*2); g.stroke();
  // 面取りの一番内側の角に鋭い照り(左上の弧だけ)
  g.lineWidth = 1.3; g.strokeStyle = 'rgba(250,252,255,0.85)';
  g.beginPath(); g.arc(cx, cy, Ri + 0.8, Math.PI*1.02, Math.PI*1.48); g.stroke();
  g.lineWidth = 1.2; g.strokeStyle = 'rgba(215,225,240,0.35)';
  g.beginPath(); g.arc(cx, cy, Ro - 0.8, Math.PI*1.08, Math.PI*1.62); g.stroke();
  // 照門の首(輪の下から機関部へつながる細い台)
  g.fillStyle = lin(cx - Ro*0.4, 0, cx + Ro*0.4, 0, [[0,'#454a53'],[0.5,'#26292e'],[1,'#0e0f12']]);
  g.beginPath(); g.moveTo(cx - Ro*0.32, cy + Ro*0.9); g.lineTo(cx + Ro*0.32, cy + Ro*0.9);
  g.lineTo(cx + H*0.05, topY + 2); g.lineTo(cx - H*0.05, topY + 2); g.closePath(); g.fill();
  g.restore();
  // 息のゲージは照門の輪の上(黒い所)に弧で出す
  if(v.breath < 0.999 || v.holding) drawBreathArc(g, cx, cy, (Ri + Ro)/2, Math.PI*0.72, Math.PI*1.28);
  // 集光ファイバー(照星の先の発光する短い棒)。的に乗ると赤、弱点なら金
  const aimMode = v.pred && v.pred.weak ? 'weak' : ((v.pred && v.pred.ent) || (v.aim && v.aim.ent && !v.aim.assist) ? 'body' : null);
  // 先の小さな光る点(集光ファイバーの端)。的に乗ると赤、弱点なら金。にじみは点のまわりだけ
  const fc = aimMode === 'weak' ? '255,211,90' : (aimMode === 'body' ? '255,106,68' : '141,255,110');
  g.save();
  g.globalCompositeOperation = 'lighter';
  const fg = g.createRadialGradient(cx, cy, 0, cx, cy, dotR*3.2);
  fg.addColorStop(0, `rgba(${fc},0.75)`); fg.addColorStop(1, `rgba(${fc},0)`);
  g.fillStyle = fg; g.beginPath(); g.arc(cx, cy, dotR*3.2, 0, Math.PI*2); g.fill();
  g.restore();
  g.fillStyle = `rgb(${fc})`; g.beginPath(); g.arc(cx, cy, dotR, 0, Math.PI*2); g.fill();
  g.fillStyle = 'rgba(255,255,245,0.95)'; g.beginPath(); g.arc(cx - dotR*0.25, cy - dotR*0.25, dotR*0.45, 0, Math.PI*2); g.fill();
  if(aimMode === 'weak'){ drawDropChevron(g, cx, cy + 2, Math.max(4, H*0.009)); drawWeakOnTarget(g, Math.max(5, H*0.012)); }
}
function drawBreathArc(g, ox, oy, rr, a0, a1){
  const v = sniperView;
  g.save();
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 5;
  g.beginPath(); g.arc(ox, oy, rr, a0, a1); g.stroke();
  g.strokeStyle = v.spent ? '#ff6e5e' : (v.holding ? '#bfe6ff' : 'rgba(191,230,255,0.65)'); g.lineWidth = 3.5;
  g.beginPath(); g.arc(ox, oy, rr, a1 - (a1-a0)*v.breath, a1); g.stroke();
  const lx = ox + Math.cos((a0+a1)/2)*rr, ly = oy + Math.sin((a0+a1)/2)*rr;
  const label = v.spent ? '息切れ' : (v.holding ? '息止め' : '息');
  g.font = "bold 12px 'Rajdhani', sans-serif"; g.textAlign = 'right'; g.textBaseline = 'middle';
  g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.strokeText(label, lx - 8, ly);
  g.fillStyle = v.spent ? '#ff8a7a' : '#d8efff'; g.fillText(label, lx - 8, ly);
  g.restore();
}
// 弾が通った弧(当たって消えたあとも少し残す)
function drawScopeTrails(g){
  for(const f of sniperView.fx){
    if(f.kind !== 'trail') continue;
    const fade = 1 - f.t / f.life;
    drawTracerPath(g, sniperTracerPoints(f.pts), fade*fade, false);
  }
}
/* 外れた所の土煙。地面の色(テーマ)を混ぜた半透明で、ふちは完全にぼかす。
   最初に立ち上がって、横へ広がりながら沈む。細かい土粒が放物線で飛ぶ(不透明な円を並べない=綿の玉にしない) */
function sniperDustRgb(rock){
  const th = window.__aramonRealTheme || {};
  const base = rock ? (th.gravel != null ? th.gravel : 0x8d8371) : (th.low != null ? th.low : 0xa89066);
  const hz = th.haze != null ? th.haze : 0xcfc2a6;
  const mix = (c, d, t)=> Math.round(((c>>d)&255)*(1-t) + ((hz>>d)&255)*t);
  return [mix(base,16,0.35), mix(base,8,0.35), mix(base,0,0.35)];
}
function drawScopeImpacts(g){
  for(const f of sniperView.fx){
    if(f.kind !== 'impact') continue;
    const P = project(f.x, f.y, f.z);
    if(!P) continue;
    const k = f.t / f.life, t = f.t;
    const [r, gg, b] = sniperDustRgb(f.rock);
    const rgb = `${r},${gg},${b}`;
    const dark = `${Math.round(r*0.55)},${Math.round(gg*0.52)},${Math.round(b*0.48)}`;
    const mid = `${Math.round(r*0.78)},${Math.round(gg*0.75)},${Math.round(b*0.7)}`;
    /* 1) 着弾した1点から吹き上がる土煙。**地面の色を取った半透明の柔らかい玉**を、立ち上がりながら横へ広げる
          (細い線を束ねると黒い三角錐に見えた=批評)。玉はワールドの位置で置いて1つずつ project で投影する */
    const up = Math.min(1, t/0.07), fall = clamp((t - 0.2)/1.2, 0, 1);
    const rx = -Math.sin(camState.yaw), ry = Math.cos(camState.yaw);
    for(let i=0;i<9;i++){
      const side = (i - 4)/4;                                            // -1〜1(画面の左右)
      const hh = SNIPER_IMPACT_COLUMN_H * (1 - Math.abs(side)*0.6) * (0.6 + 0.4*Math.abs(snHash(f.seed*5 + i))) * up;
      const lat = side * (10 + 34*Math.sqrt(k)) + snHash(f.seed*9 + i)*4;   // 横へ広がる
      const hz = hh * (1 - fall*0.55) + fall*6;                          // 頭から崩れて沈む
      const Q = project(f.x + rx*lat, f.y + ry*lat, f.z + hz*0.6);
      if(!Q) continue;
      const rr = Math.max(SNIPER_IMPACT_VIS_MIN_PX*0.7, Math.min(90, (9 + hh*0.35 + k*26) * Q.scale * SNIPER_IMPACT_SCALE_BOOST));
      const al = 0.5 * up * Math.pow(1 - k, 1.1) * (1 - Math.abs(side)*0.3);
      const cg = g.createRadialGradient(Q.x, Q.y, 0, Q.x, Q.y, rr);
      // 芯だけ地面より少し暗い色にする(周りの土そのままの色だと地面と同化して見えない=批評)
      cg.addColorStop(0, `rgba(${mid},${al})`); cg.addColorStop(0.5, `rgba(${rgb},${al*0.55})`); cg.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = cg; g.beginPath(); g.arc(Q.x, Q.y, rr, 0, Math.PI*2); g.fill();
    }
    // 根元の少し濃い土(ふちはぼかす。黒くしない)
    {
      const hr = Math.max(SNIPER_IMPACT_VIS_MIN_PX*0.6, Math.min(40, 10*P.scale*SNIPER_IMPACT_SCALE_BOOST)) * (0.8 + k*0.8);
      const hg = g.createRadialGradient(P.x, P.y - hr*0.25, 0, P.x, P.y - hr*0.25, hr);
      hg.addColorStop(0, `rgba(${mid},${0.5*(1-k)})`); hg.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = hg; g.beginPath(); g.arc(P.x, P.y - hr*0.25, hr, 0, Math.PI*2); g.fill();
    }
    // 2) 地面を這って広がる薄い土煙(地面の上の円を投影した楕円。ふちはぼかす)
    const gr = 8 + 46*Math.sqrt(k);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, ok = true;
    for(let i=0;i<8;i++){
      const Q = project(f.x + Math.cos(i*Math.PI/4)*gr, f.y + Math.sin(i*Math.PI/4)*gr, f.z);
      if(!Q){ ok = false; break; }
      x0 = Math.min(x0, Q.x); x1 = Math.max(x1, Q.x); y0 = Math.min(y0, Q.y); y1 = Math.max(y1, Q.y);
    }
    if(ok){
      const rx = Math.max(SNIPER_IMPACT_VIS_MIN_PX*0.7, (x1 - x0)/2), ry = Math.max(SNIPER_IMPACT_VIS_MIN_PX*0.25, (y1 - y0)/2), ex = (x0 + x1)/2, ey = (y0 + y1)/2;
      const al = 0.34 * Math.pow(1 - k, 1.3);
      g.save(); g.translate(ex, ey); g.scale(1, ry/rx);
      const eg = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      eg.addColorStop(0, `rgba(${rgb},${al})`); eg.addColorStop(0.5, `rgba(${rgb},${al*0.6})`); eg.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = eg; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI*2); g.fill();
      g.restore();
    }
    // 3) 破片(土くれ・小石)。ワールドの放物線で飛ばして1個ずつ投影する
    const tt = Math.min(t, 1.1);
    for(const q of (f.grains || [])){
      const dz = q.up*260*tt - 0.5*SNIPER_IMPACT_DEBRIS_G*tt*tt;
      if(dz < -2) continue;
      const Q = project(f.x + Math.cos(q.a)*q.v*70*tt, f.y + Math.sin(q.a)*q.v*70*tt, f.z + dz);
      if(!Q) continue;
      const sz = Math.min(6, Math.max(1.6, q.s*1.7*Q.scale));
      g.fillStyle = `rgba(${dark},${0.95*(1 - k*0.6)})`;
      g.save(); g.translate(Q.x, Q.y); g.rotate(q.a*3 + tt*9*q.v);
      g.fillRect(-sz, -sz*0.7, sz*2, sz*1.4);
      g.restore();
    }
    // 4) 最初の一瞬の火花(小さく)
    if(t < 0.06){
      g.save(); g.globalCompositeOperation = 'lighter';
      const rr = Math.max(SNIPER_IMPACT_VIS_MIN_PX*0.6, 9*P.scale*SNIPER_IMPACT_SCALE_BOOST);
      const fl = g.createRadialGradient(P.x, P.y, 0, P.x, P.y, rr);
      fl.addColorStop(0, `rgba(255,236,200,${0.8*(1 - t/0.06)})`); fl.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = fl; g.beginPath(); g.arc(P.x, P.y, rr, 0, Math.PI*2); g.fill();
      g.restore();
    }
  }
}
/* 命中の×印・ダメージ数字。**数字は照準の右上(窓の半径×0.3)に固定**して、的と照準をふさがない。
   弱点は金色で大きく、弾んで出る(ヒットストップと倍率の弾みは sniperOnHit が起こす) */
function drawScopeHits(g, cx, cy, W){
  const R = W ? W.R : viewH*0.3;
  let slot = 0;
  for(let i=sniperView.fx.length-1; i>=0; i--){
    const f = sniperView.fx[i];
    if(f.kind !== 'hit') continue;
    // 当たった点の周りだけが一瞬白く光る(体全体は白く飛ばさない)
    if(f.t < 0.16){
      const P = project(f.x, f.y, f.z);
      if(P){
        const k = 1 - f.t/0.16, rr = Math.max(8, 22*Math.min(P.scale, 3)) * (0.8 + (1-k)*0.8);
        g.save(); g.globalCompositeOperation = 'lighter';
        const hg = g.createRadialGradient(P.x, P.y, 0, P.x, P.y, rr);
        hg.addColorStop(0, `rgba(255,252,238,${0.95*k})`); hg.addColorStop(0.3, f.crit ? `rgba(255,190,70,${0.6*k})` : `rgba(255,230,190,${0.5*k})`);
        hg.addColorStop(1, 'rgba(255,160,60,0)');
        g.fillStyle = hg; g.beginPath(); g.arc(P.x, P.y, rr, 0, Math.PI*2); g.fill();
        g.restore();
      }
    }
    // 当たった点から火花(弱点は金、体は白〜橙)と、体なら小さな破片が飛ぶ
    if(f.t < 0.32){
      const P = project(f.x, f.y, f.z);
      if(P){
        const prog = 0.35 + 0.65*Math.min(1, f.t/0.18), al = 1 - Math.max(0, (f.t - 0.12)/0.2);
        const L0 = Math.max(10, Math.min(46, 26*Math.sqrt(P.scale))) * (f.crit ? 1.3 : 1);
        g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
        const n = f.crit ? 14 : 10;
        for(let j=0;j<n;j++){
          const a = (j/n)*Math.PI*2 + snHash((f.seed||0) + j)*0.5;
          const len = L0 * (0.55 + 0.45*Math.abs(snHash((f.seed||0)*3 + j))) * prog;
          const x0 = P.x + Math.cos(a)*len*0.35, y0 = P.y + Math.sin(a)*len*0.35;
          const x1 = P.x + Math.cos(a)*len, y1 = P.y + Math.sin(a)*len + len*len*0.004;
          const sg = g.createLinearGradient(x0, y0, x1, y1);
          sg.addColorStop(0, f.crit ? `rgba(255,236,150,${al})` : `rgba(255,248,230,${al})`);
          sg.addColorStop(1, f.crit ? 'rgba(255,150,30,0)' : 'rgba(255,120,40,0)');
          g.strokeStyle = sg; g.lineWidth = f.crit ? 2.4 : 1.8;
          g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        }
        g.restore();
      }
    }
    // 弱点: 照準のまわりに金の輪が広がって消える(体への命中には出ない=見ただけで区別できる)
    if(f.crit && f.t < 0.45){
      const q = f.t / 0.45;
      g.save(); g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `rgba(255,200,70,${0.85*(1-q)})`; g.lineWidth = 3*(1-q) + 1;
      g.beginPath(); g.arc(cx, cy, 14 + q*R*0.22, 0, Math.PI*2); g.stroke();
      g.restore();
    }
    // ×印(照準の上)。弱点は金で太く大きい、体は白
    const mk = clamp(f.t / 0.34, 0, 1);
    if(mk < 1){
      const s = (f.crit ? 17 : 12) * (1.3 - 0.3*mk), gap = f.crit ? 7 : 5;
      g.save();
      g.globalAlpha *= 1 - mk*mk;
      g.lineCap = 'round';
      const col = f.kill ? '#ff3030' : (f.crit ? '#ffb020' : '#ffffff');
      for(const [dx, dy] of [[-1,-1],[1,-1],[-1,1],[1,1]]){
        g.strokeStyle = 'rgba(0,0,0,0.65)'; g.lineWidth = f.crit ? 5.5 : 4;
        g.beginPath(); g.moveTo(cx + dx*gap, cy + dy*gap); g.lineTo(cx + dx*(gap+s), cy + dy*(gap+s)); g.stroke();
        g.strokeStyle = col; g.lineWidth = f.crit ? 3.2 : 2.2;
        g.beginPath(); g.moveTo(cx + dx*gap, cy + dy*gap); g.lineTo(cx + dx*(gap+s), cy + dy*(gap+s)); g.stroke();
      }
      g.restore();
    }
    if(slot > 1) continue;
    const k = f.t / f.life;
    const alpha = k < 0.72 ? 1 : 1 - (k-0.72)/0.28;
    const pop = f.t < 0.14 ? 1 + (0.14 - f.t)*(f.crit ? 5 : 2.5) : 1;
    const x = cx + R*0.3, y = cy - R*0.3 + slot*R*0.2 - k*10;
    slot++;
    g.save();
    g.globalAlpha *= alpha;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const size = Math.round((f.crit ? 24*SNIPER_CRIT_NUM_SCALE : 24) * pop);   // 弱点は1.5倍
    g.font = `${size}px 'Russo One', 'Rajdhani', sans-serif`;
    g.lineJoin = 'round';
    g.lineWidth = f.crit ? 6 : 5; g.strokeStyle = f.crit ? 'rgba(110,12,0,0.95)' : 'rgba(0,0,0,0.85)';
    g.strokeText(String(f.dmg), x, y);
    if(f.crit){
      const tg = g.createLinearGradient(0, y - size, 0, y);
      tg.addColorStop(0, '#fff4a8'); tg.addColorStop(0.55, '#ffc32e'); tg.addColorStop(1, '#ff7a1a');
      g.fillStyle = tg;
    } else g.fillStyle = '#ffffff';
    g.fillText(String(f.dmg), x, y);
    if(f.crit || f.kill){
      const label = f.kill ? (f.crit ? '弱点! 撃破' : '撃破') : '弱点!';
      const lf = f.crit ? 17 : 14;
      g.font = `bold ${lf}px 'Rajdhani', sans-serif`;
      g.lineWidth = 4; g.strokeStyle = f.crit ? 'rgba(90,20,0,0.9)' : 'rgba(0,0,0,0.85)';
      g.strokeText(label, x + 2, y - size - 3);
      g.fillStyle = f.kill ? '#ff5a4a' : '#ffd24a';
      g.fillText(label, x + 2, y - size - 3);
    }
    g.restore();
  }
}
function drawScopeSmoke(g, W){
  for(const s of sniperView.smoke){
    const k = s.t / s.life;
    const x = W.x + s.x*W.R, y = W.y + s.y*W.R, r = W.R * s.r * (1 + k*1.6);
    const sg = g.createRadialGradient(x, y, 0, x, y, r);
    const kin = Math.min(1, s.t/0.05);   // 撃った瞬間にふわっと湧く(最初の数コマで濃くなる)
    const a0 = 0.42*(1-k)*(0.55 + 0.45*kin);
    sg.addColorStop(0, `rgba(205,202,198,${a0})`); sg.addColorStop(0.6, `rgba(190,188,186,${a0*0.45})`); sg.addColorStop(1, 'rgba(190,190,195,0)');
    g.fillStyle = sg; g.beginPath(); g.arc(x, y, r, 0, Math.PI*2); g.fill();
  }
}
/* 距離・照準の先の1体・撃った距離・倍率・残弾・装填・息。
   窓のあるスコープは窓の中の決まった場所と鏡筒の黒い所へ、アイアンは照準の右に小さく
   (倍率と残弾はHUDの札が出すので、アイアンでは空中に描かない) */
/* 画面のHUD(ボタン・札・地図など)の矩形。スコープの情報をレンズの外の黒い所へ置くとき、これを避ける。
   座標は #appRoot の中の論理座標(=ゲーム画面の座標)。0.5秒ごとに測り直す(毎コマDOMを読まない) */
const SN_HUD_IDS = ['topLeft','statsPanel','topRight','killFeed','movePanel','joystickBase','exploreHud','expObjPanel','expRegionCard',
  'expLootFeed','fireBtn','dashBtn','pingBtn','sniperAdsBtn','sniperAmmoChip','sniperBreathBtn','turnLeftBtn','turnRightBtn','autoRunLabel','raidHud'];
function snHudRects(){
  const v = sniperView, now = performance.now();
  if(v.hudRects && now - v.hudRectsAt < 500 && v.hudRectsW === viewW) return v.hudRects;
  const root = document.getElementById('appRoot');
  const out = [];
  for(const id of SN_HUD_IDS){
    const el = document.getElementById(id);
    if(!el || el.offsetWidth === 0 || el.offsetHeight === 0) continue;
    let hidden = false;
    for(let n=el; n && n!==document.body; n=n.parentElement){
      if(n.classList && n.classList.contains('hidden')){ hidden = true; break; }
      const cs = getComputedStyle(n);
      if(cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05){ hidden = true; break; }
    }
    if(hidden) continue;
    let x = 0, y = 0, n = el;
    while(n && n !== root){ x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    let a = 1;
    try{ const tf = getComputedStyle(el).transform; if(tf && tf !== 'none'){ const m = new DOMMatrixReadOnly(tf); a = m.m11 || 1; x += m.m41; y += m.m42; } }catch(_){}
    out.push([x, y, x + el.offsetWidth*a, y + el.offsetHeight*a]);
  }
  v.hudRects = out; v.hudRectsAt = now; v.hudRectsW = viewW;
  return out;
}
/* w×h の札を置ける場所を、**レンズの右の外の黒い列だけ**から探す(批評5巡目: 左右へ分岐すると
   撮るたびに置き場所が変わって読みにくい)。x は常に「窓の右端+隙間」の1列に固定し、
   上下だけをHUDとも先に置いた札とも重ならないようにずらす。窓の半径は sniperApertureR() が
   右のボタン列の手前で止めてあるので、この列の広さ(SNIPER_SCOPE_GUTTER_PX)はどの端末でも確保されている。
   最後まで空きが無くても、x は右の列のまま(**レンズの内側には絶対に置かない**)。 */
function snFindSlotRight(w, h, ox, oy, R, taken){
  const pad = 6, x = ox + R*1.06;
  const hit = (y0)=>{
    if(y0 < 6 || y0 + h > viewH - 6) return true;
    for(const r of snHudRects()) if(x < r[2] + pad && x + w > r[0] - pad && y0 < r[3] + pad && y0 + h > r[1] - pad) return true;
    for(const r of taken) if(x < r[2] + pad && x + w > r[0] - pad && y0 < r[3] + pad && y0 + h > r[1] - pad) return true;
    return false;
  };
  for(let k=0;k<60;k++){
    const dy = (k%2 ? 1 : -1) * Math.ceil(k/2) * 8;
    const y = clamp(oy - h*0.5 + dy, 6, viewH - h - 6);
    if(!hit(y)) return [x, y, x + w, y + h];
  }
  // どこにもぶつからない高さが無ければ、レンズの中心の高さのまま(列そのものは右の外を保つ)
  const y = clamp(oy - h*0.5, 6, viewH - h - 6);
  return [x, y, x + w, y + h];
}
// 名前を幅 cardW に収まる1行にする(縦持ちの狭い列では2行だと的に近づきすぎる。入らなければ末尾を「…」)
function snWrapName1(g, name, cardW, nfs){
  g.font = `600 ${Math.round(nfs)}px 'Share Tech Mono', 'Rajdhani', monospace`;
  const s = String(name || '');
  if(g.measureText(s).width <= cardW) return s;
  let cut = s;
  while(cut.length > 1 && g.measureText(cut + '…').width > cardW) cut = cut.slice(0, -1);
  return cut + '…';
}
/* 距離・照準の先の1体・撃った距離・倍率・残弾・装填・息。
   ・窓のあるスコープ: **レンズの中には十字線と目盛りだけ**。距離・SHOT・名前・体力・倍率・残弾は
     必ずレンズの右の外の黒い1列(snFindSlotRight。sniperApertureR() が確保した SNIPER_SCOPE_GUTTER_PX 分の
     幅)へ縦に積む。**レンズの内側へは絶対に戻さない**(批評5巡目: 前は空きが無いと窓の中へ戻していた)。
   ・アイアン: 照門の輪のすぐ下に固定(的の上に乗らない) */
function drawScopeInfo(g, cx, cy, W, sc, w){
  const v = sniperView, s = player.sniper;
  v.__dbgInfoRect = null; v.__dbgLens = null;
  if(!W){
    // アイアン: レンズが無いので元のまま照準の右下に小さく(倍率・残弾はHUDの札が出す)
    const fsm = 15;
    const dx = cx + viewH*0.17, dy = cy + viewH*0.158 + fsm*1.1;
    const m = v.aim && v.aim.m != null ? Math.round(v.aim.m) : null;
    snText(g, 'RANGE', dx, dy - fsm*0.8, Math.max(9, fsm*0.55), 'rgba(255,214,150,0.85)');
    snText(g, m != null ? `${m} m` : '--- m', dx, dy + 3, fsm, (v.aim && v.aim.ent) ? '#ff9a7a' : '#ffe9c4');
    let infoY = dy + fsm*1.2;
    if(v.lastShot && v.lastShot.m != null){
      const ka = 1 - Math.max(0, v.lastShot.t - SNIPER_SHOT_RANGE_SEC*0.7) / (SNIPER_SHOT_RANGE_SEC*0.3);
      g.save(); g.globalAlpha *= ka;
      snText(g, `SHOT ${v.lastShot.m} m`, dx, infoY, Math.max(10, fsm*0.66), SN_AMBER);
      g.restore(); infoY += fsm*0.95;
    }
    const t = v.aim && v.aim.ent && v.aim.ent.alive ? v.aim.ent : null;
    if(t){
      const nfs = Math.max(11, fsm*0.66), cardW = clamp(viewW*0.15, 96, 190);
      const name = snWrapName1(g, t.exploreName || t.name, cardW, nfs);
      snText(g, name, dx, infoY + 2, nfs, '#f3eadb', 'left', '600');
      const by = infoY + 2 + nfs*0.75, pct = clamp(t.hp / Math.max(1, t.maxHp), 0, 1), bh = 4;
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(dx - 1, by - 1, cardW*0.85 + 2, bh + 2);
      g.fillStyle = pct > 0.5 ? '#5fe07c' : (pct > 0.22 ? '#f4c430' : '#ff5d5d');
      g.fillRect(dx, by, cardW*0.85*pct, bh);
    }
    if(s.reloadLeft > 0){
      const p = 1 - s.reloadLeft / w.reloadSec, bw = viewH*0.18;
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(cx - bw/2 - 2, cy - viewH*0.06 - 2, bw + 4, 8);
      g.fillStyle = '#ffb45a'; g.fillRect(cx - bw/2, cy - viewH*0.06, bw*p, 4);
    }
    return;
  }
  const R = W.R, ox = W.x, oy = W.y;
  const m = v.aim && v.aim.m != null ? Math.round(v.aim.m) : null;
  const t = v.aim && v.aim.ent && v.aim.ent.alive ? v.aim.ent : null;
  const shot = v.lastShot && v.lastShot.m != null;
  const fsm = Math.max(13, Math.min(17, R*0.075));
  const nfs = Math.max(11, fsm*0.62);
  const fsMag = Math.max(12, Math.min(15, R*0.055));
  // 列の幅は確保した黒い列いっぱいまで(名前は1行のみ。批評: 縦持ちの狭い列で2行だと的に近づきすぎる)
  const cardW = Math.max(64, SNIPER_SCOPE_GUTTER_PX - 34);
  g.font = `${fsm}px 'Russo One', 'Rajdhani', sans-serif`;
  const wRange = g.measureText(m != null ? `${m} m` : '--- m').width;
  const nameStr = t ? snWrapName1(g, t.exploreName || t.name, cardW, nfs) : '';
  g.font = `${fsMag}px 'Russo One', 'Rajdhani', sans-serif`;
  const magTxt = sc.label || (sc.mag+'×');
  const wMag = g.measureText(magTxt).width;
  const bwMag = wMag + 8 + w.mag*8 + 18;
  const bw = Math.max(wRange, t ? cardW : 0, bwMag) + 4;
  // 縦に積む行の高さを先に合計する(息止め中の弧・「息止め」の文字は窓の左の外なので、この列とは重ならない)
  const rowGap = fsm*0.3;
  let bh = fsm*0.85 + fsm*0.7 + rowGap;              // RANGE見出し+値
  if(shot) bh += fsm*0.7 + rowGap;                    // SHOT
  if(t) bh += nfs + nfs*0.9 + rowGap;                 // 名前1行+体力帯
  bh += fsMag*1.9 + rowGap;                           // 倍率+残弾のピップ
  if(s.reloadLeft > 0) bh += 18;
  const slot = snFindSlotRight(bw + 8, bh + 8, ox, oy, R, []);
  // 検査用: 情報の枠とレンズの円(撮影ツールの --snmetrics が読む。ゲームの見た目には出ない)
  v.__dbgInfoRect = slot; v.__dbgLens = { x:ox, y:oy, r:R };
  const dx = slot[0] + 4;
  let y = slot[1] + 4 + fsm*0.85;
  snText(g, 'RANGE', dx, y - fsm*0.55, Math.max(9, fsm*0.55), 'rgba(255,214,150,0.85)');
  y += fsm*0.55;
  snText(g, m != null ? `${m} m` : '--- m', dx, y, fsm, (v.aim && v.aim.ent) ? '#ff9a7a' : '#ffe9c4');
  y += fsm*0.7 + rowGap;
  if(shot){
    const ka = 1 - Math.max(0, v.lastShot.t - SNIPER_SHOT_RANGE_SEC*0.7) / (SNIPER_SHOT_RANGE_SEC*0.3);
    g.save(); g.globalAlpha *= ka;
    snText(g, `SHOT ${v.lastShot.m} m`, dx, y, Math.max(10, fsm*0.62), SN_AMBER);
    g.restore();
    y += fsm*0.7 + rowGap;
  }
  if(t){
    snText(g, nameStr, dx, y, nfs, '#f3eadb', 'left', '600');
    y += nfs*0.75;
    const pct = clamp(t.hp / Math.max(1, t.maxHp), 0, 1), bwHp = cardW*0.9, bhHp = 4;
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(dx - 1, y - 1, bwHp + 2, bhHp + 2);
    g.fillStyle = pct > 0.5 ? '#5fe07c' : (pct > 0.22 ? '#f4c430' : '#ff5d5d');
    g.fillRect(dx, y, bwHp*pct, bhHp);
    y += bhHp + nfs*0.15 + rowGap;
  }
  // 倍率と残弾の札(1行: 「8×」+弾の柱)。装填中は下に細い帯
  snText(g, magTxt, dx, y + fsMag*0.7, fsMag, 'rgba(255,214,150,0.9)', 'left');
  const bx = dx + wMag + 8, byPip = y + fsMag*0.7;
  for(let i=0;i<w.mag;i++){
    const full = i < s.ammo && s.reloadLeft <= 0;
    g.fillStyle = full ? '#ffd79a' : 'rgba(255,255,255,0.14)';
    g.fillRect(bx + i*8, byPip - 8, 5, 16);
    if(full){ g.fillStyle = '#b07a3a'; g.fillRect(bx + i*8, byPip + 5, 5, 3); }
  }
  y += fsMag*1.1;
  if(s.reloadLeft > 0){
    const p = 1 - s.reloadLeft / w.reloadSec;
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(dx - 1, y - 1, bw - 3, 6);
    g.fillStyle = '#ffb45a'; g.fillRect(dx, y, (bw-4)*p, 4);
    snText(g, '装填中', dx, y + 14, 12, '#ffcf8a', 'left');
  } else if(s.cycleLeft > 0){
    const p = 1 - s.cycleLeft / w.cycleSec;
    g.strokeStyle = 'rgba(255,215,150,0.75)'; g.lineWidth = 2.5;
    g.beginPath(); g.arc(bx + w.mag*8 + 8, byPip, 6, -Math.PI/2, -Math.PI/2 + p*Math.PI*2); g.stroke();
  }
  // 息(窓の外=鏡筒の黒い所に弧。左側なので右の情報列とは重ならない)。止めている間と戻っている間だけ
  if(v.breath < 0.999 || v.holding) drawBreathArc(g, ox, oy, R*1.17, Math.PI*0.80, Math.PI*1.20);
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
