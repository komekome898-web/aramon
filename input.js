let lastTouchEndTime = 0;
document.addEventListener('touchend', (e)=>{
  if(e.target.closest('#startScreen') || e.target.closest('#audioSettingsOverlay') || e.target.closest('#accountOverlay') || e.target.closest('#bagOverlay') || e.target.closest('#dailyOverlay') || e.target.closest('#loginBonusPopup') || e.target.closest('#seasonOverlay') || e.target.closest('#gachaOverlay') || e.target.closest('#skinPromoOverlay') || e.target.closest('#skinPreviewOverlay') || e.target.closest('#shopOverlay') || e.target.closest('#changelogOverlay') || e.target.closest('#rankingScreen') || e.target.closest('#myStatsScreen') || e.target.closest('#howToPlayScreen') || e.target.closest('#mastermonScreen') || e.target.closest('#resultScreen') || e.target.closest('#monsterListScreen') || e.target.closest('#adminPassScreen') || e.target.closest('#adminScreen') || e.target.closest('#lobbyScreen')) return;
  const now = performance.now();
  if(now - lastTouchEndTime <= 350) e.preventDefault();
  lastTouchEndTime = now;
}, {passive:false});
document.addEventListener('dblclick', (e)=>{
  if(e.target.closest('#startScreen') || e.target.closest('#audioSettingsOverlay') || e.target.closest('#accountOverlay') || e.target.closest('#bagOverlay') || e.target.closest('#dailyOverlay') || e.target.closest('#loginBonusPopup') || e.target.closest('#seasonOverlay') || e.target.closest('#gachaOverlay') || e.target.closest('#skinPromoOverlay') || e.target.closest('#skinPreviewOverlay') || e.target.closest('#shopOverlay') || e.target.closest('#changelogOverlay') || e.target.closest('#howToPlayScreen') || e.target.closest('#mastermonScreen') || e.target.closest('#resultScreen') || e.target.closest('#monsterListScreen') || e.target.closest('#adminPassScreen') || e.target.closest('#adminScreen') || e.target.closest('#lobbyScreen')) return;
  e.preventDefault();
});

// ===== 強制横向き(縦画面ロック)中のスクロール補助 =====
// 画面をCSSで90度回転させているため、端末によっては回転したスクロールコンテナで
// ネイティブスクロールが効きにくい。タッチ移動量を論理座標(回転後)に変換して
// 自前でscrollTop/scrollLeftを動かすことで、どの画面でも確実にスクロールできるようにする。
let forcedScrollTouch = null;
function findScrollableAncestor(el){
  while(el && el !== document.body && el.nodeType===1){
    const st = getComputedStyle(el);
    const scrollY = (st.overflowY==='auto'||st.overflowY==='scroll') && el.scrollHeight > el.clientHeight+1;
    const scrollX = (st.overflowX==='auto'||st.overflowX==='scroll') && el.scrollWidth > el.clientWidth+1;
    if(scrollY || scrollX) return el;
    el = el.parentElement;
  }
  return null;
}
document.addEventListener('touchstart', (e)=>{
  forcedScrollTouch = null;
  if(!isForcedLandscape()) return;
  if(e.target.closest('input[type=range]')) return; // スライダー操作は妨げない
  const sc = findScrollableAncestor(e.target);
  if(!sc) return;
  forcedScrollTouch = { el: sc, x: e.touches[0].clientX, y: e.touches[0].clientY };
}, {passive:true});
document.addEventListener('touchmove', (e)=>{
  if(!forcedScrollTouch || !isForcedLandscape()) return;
  const t = e.touches[0];
  const dx = t.clientX - forcedScrollTouch.x, dy = t.clientY - forcedScrollTouch.y;
  forcedScrollTouch.x = t.clientX; forcedScrollTouch.y = t.clientY;
  const d = toLogicalDelta(dx, dy);
  const el = forcedScrollTouch.el;
  if(el.scrollHeight > el.clientHeight+1) el.scrollTop -= d.y;
  if(el.scrollWidth > el.clientWidth+1) el.scrollLeft -= d.x;
  e.preventDefault(); // ネイティブの(回転前基準の)スクロールと二重にならないように
}, {passive:false});
document.addEventListener('touchend', ()=>{ forcedScrollTouch = null; }, {passive:true});

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
let joystick = { active:false, pointerId:null, nx:0, ny:0, baseX:0, baseY:0, radius:46, peakUpNy:0, scale:1 };
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
  // 画面カスタマイズでスティックを拡縮(transform:scale)している場合、
  // 画面px移動量をスティック内ローカルpxへ戻してから判定する(拡縮しても操作感を一定に保つ)
  const s = joystick.scale || 1;
  let dx = (cx-joystick.baseX)/s, dy = (cy-joystick.baseY)/s;
  const d = Math.hypot(dx,dy);
  if(d > joystick.radius){ dx = dx/d*joystick.radius; dy = dy/d*joystick.radius; }
  const logical = toLogicalDelta(dx, dy);
  joystick.nx = logical.x/joystick.radius; joystick.ny = logical.y/joystick.radius;
  // ドラッグ中に到達した「最も上」を覚えておく(離す直前に中央へ戻っても上フリックと判定できるように)
  if(joystick.ny < joystick.peakUpNy) joystick.peakUpNy = joystick.ny;
  joyKnobEl.style.transform = `translate(${logical.x}px,${logical.y}px)`;
}
joyBaseEl.addEventListener('pointerdown', (e)=>{
  e.preventDefault(); e.stopPropagation();
  if(!game.started || game.over) return;
  if(game.autoRun) setAutoRun(false); // 再度ジョイスティックに触れたらオートラン解除
  joystick.active = true; joystick.pointerId = e.pointerId; joystick.peakUpNy = 0;
  const rect = joyBaseEl.getBoundingClientRect();
  joystick.baseX = rect.left+rect.width/2; joystick.baseY = rect.top+rect.height/2;
  joystick.scale = rect.width / (joyBaseEl.offsetWidth || rect.width); // 拡縮率(正方形なので幅で算出)
  updateJoystickKnob(e.clientX, e.clientY);
});
window.addEventListener('pointermove', (e)=>{
  if(joystick.active && e.pointerId===joystick.pointerId) updateJoystickKnob(e.clientX, e.clientY);
});
// オートラン: ジョイスティックを上に2回弾く(素早く上へ倒して離す×2)と発動
// 判定を広めに: 真上ちょうどでなくても、ドラッグ中に「上向き成分がしきい値を超えた」なら上フリックとみなす。
// peakUpNy(=最も上に到達した値)基準。しきい値-0.45は真上から±約63°の広いコーンを許容する。
const AUTORUN_FLICK_NY = -0.45;   // ドラッグ中の最上到達がこれより上なら「上フリック」とみなす(広め)
const AUTORUN_FLICK_WINDOW = 750; // 1回目→2回目までの許容ms(少し長めで押しやすく)
let autoRunFlickTime = 0;
function setAutoRun(on){
  game.autoRun = !!on;
  const label = document.getElementById('autoRunLabel');
  if(label) label.classList.toggle('hidden', !on);
  if(on){
    autoRunFlickTime = 0;
    if(typeof pushToast==='function') pushToast('🏃 オートラン発動！ジョイスティックに触れると解除');
  }
}
function releaseJoystick(e){
  if(joystick.active && e.pointerId===joystick.pointerId){
    const peakUp = joystick.peakUpNy; // ドラッグ中に到達した最も上の値(離す直前の戻りに影響されない)
    joystick.active=false; joystick.nx=0; joystick.ny=0; joystick.peakUpNy=0;
    joyKnobEl.style.transform = 'translate(0,0)';
    // オートランOFF時のみ、上フリック2回連続で発動
    if(!game.autoRun && game.started && !game.over && peakUp < AUTORUN_FLICK_NY){
      const now = performance.now();
      if(now - autoRunFlickTime < AUTORUN_FLICK_WINDOW){ setAutoRun(true); }
      else autoRunFlickTime = now;
    }
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
// 技フィールド: タップで次の技へ循環。左右フリックでも切替(右=上位tier/左=下位tier、端は反対端へループ)
(function(){
  const panel = document.getElementById('movePanel');
  const MOVE_FLICK_DIST = 28; // 論理px。これ以上の横移動でフリックと判定
  let moveGesture = null;
  function changeMoveTier(dir){
    if(!player || player.moveTierUnlocked<=1) return;
    let t = player.moveTierSelected + dir;
    if(t > player.moveTierUnlocked) t = 1;                 // 右端の右フリック→左端へ
    else if(t < 1) t = player.moveTierUnlocked;            // 左端の左フリック→右端へ
    player.moveTierSelected = t;
    const newMv = SIGNATURE_MOVES[player.element][t-1];
    const nm = (typeof getMoveName==='function') ? getMoveName(newMv, player) : newMv.name;
    pushToast(`${nm} に切り替え`);
  }
  panel.addEventListener('pointerdown', (e)=>{
    e.preventDefault(); e.stopPropagation();
    if(!game.started || game.over || !player || !player.alive) return;
    moveGesture = { id:e.pointerId, x:e.clientX, y:e.clientY, moved:false };
  });
  window.addEventListener('pointermove', (e)=>{
    if(!moveGesture || e.pointerId!==moveGesture.id) return;
    if(Math.hypot(e.clientX-moveGesture.x, e.clientY-moveGesture.y) > 6) moveGesture.moved = true;
  });
  window.addEventListener('pointerup', (e)=>{
    if(!moveGesture || e.pointerId!==moveGesture.id) return;
    const rawdx = e.clientX-moveGesture.x, rawdy = e.clientY-moveGesture.y;
    // 強制横向き(回転)時も見た目どおりの左右になるよう論理座標へ変換
    const L = (typeof toLogicalDelta==='function') ? toLogicalDelta(rawdx, rawdy) : {x:rawdx, y:rawdy};
    const g = moveGesture; moveGesture = null;
    if(!game.started || game.over || !player || !player.alive) return;
    if(Math.abs(L.x) > MOVE_FLICK_DIST && Math.abs(L.x) > Math.abs(L.y)){
      changeMoveTier(L.x > 0 ? 1 : -1); // 右フリック=上位tier / 左フリック=下位tier
    } else if(!g.moved){
      changeMoveTier(1);                // タップ=従来どおり次の技へ(循環)
    }
  });
  window.addEventListener('pointercancel', (e)=>{ if(moveGesture && e.pointerId===moveGesture.id) moveGesture = null; });
})();

/* =====================================================================
   GAME FLOW
===================================================================== */
