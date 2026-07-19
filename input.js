let lastTouchEndTime = 0;
document.addEventListener('touchend', (e)=>{
  if(e.target.closest('#startScreen') || e.target.closest('#rankingScreen') || e.target.closest('#myStatsScreen') || e.target.closest('#howToPlayScreen') || e.target.closest('#mastermonScreen') || e.target.closest('#resultScreen') || e.target.closest('#monsterListScreen') || e.target.closest('#adminPassScreen') || e.target.closest('#adminScreen') || e.target.closest('#lobbyScreen')) return;
  const now = performance.now();
  if(now - lastTouchEndTime <= 350) e.preventDefault();
  lastTouchEndTime = now;
}, {passive:false});
document.addEventListener('dblclick', (e)=>{
  if(e.target.closest('#startScreen') || e.target.closest('#howToPlayScreen') || e.target.closest('#mastermonScreen') || e.target.closest('#resultScreen') || e.target.closest('#monsterListScreen') || e.target.closest('#adminPassScreen') || e.target.closest('#adminScreen') || e.target.closest('#lobbyScreen')) return;
  e.preventDefault();
});

function isFullscreenNow(){
  return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
}
function requestFullscreenSafe(){
  if(isFullscreenNow()) return;
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if(!fn) return;
  try{
    const p = fn.call(el);
    if(p && p.catch) p.catch(()=>{});
  }catch(err){}
}
function requestOrientationLockSafe(){
  try{
    if(screen.orientation && screen.orientation.lock){
      screen.orientation.lock('landscape').catch(()=>{});
    } else if(screen.lockOrientation){
      screen.lockOrientation('landscape');
    } else if(screen.mozLockOrientation){
      screen.mozLockOrientation('landscape');
    } else if(screen.msLockOrientation){
      screen.msLockOrientation('landscape');
    }
  }catch(err){}
}
['fullscreenchange','webkitfullscreenchange','mozfullscreenchange','MSFullscreenChange'].forEach(evt=>{
  document.addEventListener(evt, ()=>{
    resize();
    if(isFullscreenNow()) requestOrientationLockSafe();
    setTimeout(resize, 60);
    setTimeout(resize, 250);
    setTimeout(resize, 500);
  });
});

const keys = {};
let fireBtnHeld = false;
let joystick = { active:false, pointerId:null, nx:0, ny:0, baseX:0, baseY:0, radius:46 };
let lookDrag = { active:false, pointerId:null, lastX:0, lastY:0 };

window.addEventListener('keydown', (e)=>{
  const k = e.key.toLowerCase();
  keys[k] = true;
  if(k===' '){ e.preventDefault(); if(game.started && !game.over) tryDash(player); }
});
window.addEventListener('keyup', (e)=>{ keys[e.key.toLowerCase()] = false; });

let tapTrack = { pointerId:null, startX:0, startY:0, startTime:0, moved:false };

function handleEnemyTap(sx,sy){
  let best=null, bestD=Infinity;
  for(const [id,sp] of monsterScreenPos){
    const ent = getEntity(id);
    if(!ent || !ent.alive || ent.isPlayer) continue;
    const rTap = Math.max(30, ent.radius*sp.scale*1.4);
    const d = Math.hypot(sx-sp.x, sy-sp.y);
    if(d < rTap && d < bestD){ bestD=d; best=ent; }
  }
  if(best) startCameraSnap(best);
}

canvas.addEventListener('pointerdown', (e)=>{
  if(!game.started || game.over) return;
  lookDrag.active = true; lookDrag.pointerId = e.pointerId;
  lookDrag.lastX = e.clientX; lookDrag.lastY = e.clientY;
  tapTrack.pointerId = e.pointerId;
  tapTrack.startX = e.clientX; tapTrack.startY = e.clientY;
  tapTrack.startTime = performance.now();
  tapTrack.moved = false;
});
window.addEventListener('pointermove', (e)=>{
  if(!lookDrag.active || e.pointerId!==lookDrag.pointerId) return;
  camSnap.active = false;
  const dx = e.clientX-lookDrag.lastX, dy = e.clientY-lookDrag.lastY;
  lookDrag.lastX = e.clientX; lookDrag.lastY = e.clientY;
  const logical = toLogicalDelta(dx, dy);
  camState.yaw += logical.x*0.0045;
  camState.pitch = clamp(camState.pitch + (invertPitchY ? logical.y : -logical.y)*0.0025, 0.05, 0.55);
  if(Math.hypot(e.clientX-tapTrack.startX, e.clientY-tapTrack.startY) > 10) tapTrack.moved = true;
});
window.addEventListener('pointerup', (e)=>{
  if(e.pointerId!==lookDrag.pointerId) return;
  lookDrag.active=false;
  const elapsed = performance.now()-tapTrack.startTime;
  if(!tapTrack.moved && elapsed < 300 && e.pointerId===tapTrack.pointerId){
    const p = toLogicalPoint(e.clientX, e.clientY);
    handleEnemyTap(p.x, p.y);
  }
});
window.addEventListener('pointercancel', (e)=>{ if(e.pointerId===lookDrag.pointerId) lookDrag.active=false; });

const joyBaseEl = document.getElementById('joystickBase');
const joyKnobEl = document.getElementById('joystickKnob');
function updateJoystickKnob(cx,cy){
  let dx = cx-joystick.baseX, dy = cy-joystick.baseY;
  const d = Math.hypot(dx,dy);
  if(d > joystick.radius){ dx = dx/d*joystick.radius; dy = dy/d*joystick.radius; }
  const logical = toLogicalDelta(dx, dy);
  joystick.nx = logical.x/joystick.radius; joystick.ny = logical.y/joystick.radius;
  joyKnobEl.style.transform = `translate(${logical.x}px,${logical.y}px)`;
}
joyBaseEl.addEventListener('pointerdown', (e)=>{
  e.preventDefault(); e.stopPropagation();
  if(!game.started || game.over) return;
  joystick.active = true; joystick.pointerId = e.pointerId;
  const rect = joyBaseEl.getBoundingClientRect();
  joystick.baseX = rect.left+rect.width/2; joystick.baseY = rect.top+rect.height/2;
  updateJoystickKnob(e.clientX, e.clientY);
});
window.addEventListener('pointermove', (e)=>{
  if(joystick.active && e.pointerId===joystick.pointerId) updateJoystickKnob(e.clientX, e.clientY);
});
function releaseJoystick(e){
  if(joystick.active && e.pointerId===joystick.pointerId){
    joystick.active=false; joystick.nx=0; joystick.ny=0;
    joyKnobEl.style.transform = 'translate(0,0)';
  }
}
window.addEventListener('pointerup', releaseJoystick);
window.addEventListener('pointercancel', releaseJoystick);

const fireBtnEl = document.getElementById('fireBtn');
fireBtnEl.addEventListener('pointerdown', (e)=>{ e.preventDefault(); e.stopPropagation(); fireBtnHeld=true; });
fireBtnEl.addEventListener('pointerup', ()=>{ fireBtnHeld=false; });
fireBtnEl.addEventListener('pointercancel', ()=>{ fireBtnHeld=false; });
fireBtnEl.addEventListener('pointerleave', ()=>{ fireBtnHeld=false; });

function tryDash(m){
  if(!m.alive || m.dashCooldown>0) return;
  let dx=m.lastMoveX, dy=m.lastMoveY;
  if(Math.hypot(dx,dy)<0.1){ dx=Math.cos(m.facingAngle); dy=Math.sin(m.facingAngle); }
  const len = Math.hypot(dx,dy)||1;
  m.dashDirX=dx/len; m.dashDirY=dy/len;
  m.dashTimer=DASH_DURATION; m.dashCooldown=DASH_COOLDOWN_MAX;
}
document.getElementById('dashBtn').addEventListener('pointerdown', (e)=>{
  e.preventDefault(); e.stopPropagation();
  if(game.started && !game.over) tryDash(player);
});
document.getElementById('turnLeftBtn').addEventListener('pointerdown', (e)=>{
  e.preventDefault(); e.stopPropagation();
  if(game.started && !game.over) turnCameraByDegrees(-90);
});
document.getElementById('turnRightBtn').addEventListener('pointerdown', (e)=>{
  e.preventDefault(); e.stopPropagation();
  if(game.started && !game.over) turnCameraByDegrees(90);
});
document.getElementById('movePanel').addEventListener('pointerdown', (e)=>{
  e.preventDefault(); e.stopPropagation();
  if(!game.started || game.over || !player || !player.alive) return;
  if(player.moveTierUnlocked<=1) return;
  player.moveTierSelected = player.moveTierSelected>=player.moveTierUnlocked ? 1 : player.moveTierSelected+1;
  const newMv = SIGNATURE_MOVES[player.element][player.moveTierSelected-1];
  pushToast(`${newMv.name} に切り替え`);
});

/* =====================================================================
   GAME FLOW
===================================================================== */
