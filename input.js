// ===== 長押しでの選択・コンテキストメニューを全画面で抑止 =====
// CSS(user-select:none / -webkit-touch-callout:none)と合わせて二重に止める。
// 入力欄(名前・パスコード)は文字を選択・編集できるよう除外する。
function isTextEntry(el){ return !!(el && el.closest && el.closest('input, textarea')); }
/* シェア画像も除外する。**共有シートが使えない端末では長押し保存が唯一の手段**で、
   ここで止めると保存メニューが出ない(style.cssの -webkit-touch-callout もセットで解除してある)。 */
function isSharePreview(el){ return !!(el && el.id === 'sharePreviewImg'); }
document.addEventListener('contextmenu', (e)=>{ if(!isTextEntry(e.target) && !isSharePreview(e.target)) e.preventDefault(); });
document.addEventListener('selectstart', (e)=>{ if(!isTextEntry(e.target) && !isSharePreview(e.target)) e.preventDefault(); });

let lastTouchEndTime = 0;
document.addEventListener('touchend', (e)=>{
  if(scrollLockExempt(e.target)) return;   // world.js の SCROLL_LOCK_EXEMPT_IDS が正
  const now = performance.now();
  if(now - lastTouchEndTime <= 350) e.preventDefault();
  lastTouchEndTime = now;
}, {passive:false});
document.addEventListener('dblclick', (e)=>{
  if(scrollLockExempt(e.target)) return;   // world.js の SCROLL_LOCK_EXEMPT_IDS が正
  e.preventDefault();
});

/* ===== タップの視覚フィードバック(波紋) =====
   どこを押したのか分かるように、指を置いた位置へ小さな波紋を1つ出して消す。
   ・試合中の操作(#hudのジョイスティック/FIRE/DASH と、視点を動かす#gameCanvas)では出さない。
     指が出しっぱなしになるうえ、操作の邪魔になるため。
     ボタンの押し込み(縮む)はCSSの button:active 側が担当する。
   ・#appRootは縦持ちのとき90度回転しているので、波紋は回転の外(body直下)へ置き、
     画面座標(clientX/clientY)をそのまま使う。こうすれば持ち方に関係なく指の下に出る。
   ・pointer-events:none・アニメ終了で自分を消す ので、他のタップ判定には一切触れない。 */
const TAP_RIPPLE_MS = 450;
function spawnTapRipple(x, y){
  const d = document.createElement('div');
  d.className = 'tap-ripple';
  d.style.left = x + 'px';
  d.style.top  = y + 'px';
  document.body.appendChild(d);
  setTimeout(()=>{ if(d.parentNode) d.parentNode.removeChild(d); }, TAP_RIPPLE_MS);
}
document.addEventListener('pointerdown', (e)=>{
  if(e.pointerType==='mouse' && e.button!==0) return;
  const t = e.target;
  if(t && t.closest && (t.closest('#hud') || t.id==='gameCanvas')) return;
  spawnTapRipple(e.clientX, e.clientY);
}, { passive:true, capture:true });

// ===== 文字入力は共通ポップアップで行う =====
// iOSのソフトキーボードは実画面の下側を覆う。強制横向き(#appRootを90度回転)では
// それがアプリの右側にあたるため、画面のどこに入力欄を置いても隠れることがある。
// そこで元の入力欄は readonly にしてキーボードを出さず、タップされたら
// キーボードに邪魔されない位置のポップアップで入力し、確定時に元の欄へ書き戻す。
// document への委譲なので、動的に作られる入力欄(マスモンの名前変更など)にも自動で効く。
const KB_SKIP_TYPES = ['range','checkbox','radio','button','submit','reset','color','file'];
function isKeyboardInput(el){
  if(!el || !el.tagName) return false;
  if(el.tagName==='TEXTAREA') return true;
  if(el.tagName!=='INPUT') return false;
  return KB_SKIP_TYPES.indexOf((el.type||'text').toLowerCase()) < 0;
}
let textInputTarget = null;
// ポップアップの見出し: data-kb-title → 直前のラベル要素 → placeholder の順で決める
function textInputTitleFor(el){
  if(el.dataset && el.dataset.kbTitle) return el.dataset.kbTitle;
  const prev = el.previousElementSibling;
  const label = prev && prev.textContent ? prev.textContent.trim() : '';
  if(label && label.length<=20) return label;   // 長い説明文は見出しにしない
  return el.placeholder || '入力';
}
function openTextInputPopup(el){
  const ov = document.getElementById('textInputOverlay');
  const field = document.getElementById('textInputField');
  if(!ov || !field) return;
  textInputTarget = el;
  document.getElementById('textInputTitle').textContent = textInputTitleFor(el);
  // 元の入力欄の入力条件(桁数・種別・IME)をそのまま引き継ぐ
  field.type = el.type==='tel' || el.type==='number' ? 'tel' : 'text';
  if(el.maxLength && el.maxLength>0) field.maxLength = el.maxLength; else field.removeAttribute('maxlength');
  if(el.getAttribute('inputmode')) field.setAttribute('inputmode', el.getAttribute('inputmode')); else field.removeAttribute('inputmode');
  if(el.getAttribute('pattern')) field.setAttribute('pattern', el.getAttribute('pattern')); else field.removeAttribute('pattern');
  field.placeholder = el.placeholder || '';
  field.value = el.value || '';
  ov.classList.remove('hidden');
  // タップ(ユーザー操作)と同じターンでfocusしないとiOSはキーボードを出さない
  field.focus();
  try{ field.setSelectionRange(field.value.length, field.value.length); }catch(e){}
}
function closeTextInputPopup(commit){
  const ov = document.getElementById('textInputOverlay');
  const field = document.getElementById('textInputField');
  if(!ov) return;
  const el = textInputTarget;
  textInputTarget = null;
  if(commit && el){
    el.value = field.value;
    // 値を見ている既存のハンドラ(保存や表示更新)が動くようにイベントを流す
    el.dispatchEvent(new Event('input', { bubbles:true }));
    el.dispatchEvent(new Event('change', { bubbles:true }));
  }
  field.blur();
  ov.classList.add('hidden');
  /* 開いている間はresize()を素通りさせていた(world.js)ので、閉じた直後に必ず作り直す。
     OS側のvisualViewport.resizeイベントの発火に頼らない(閉じても来ないことがある)。
     **同期の1回だけでは足りない。** iOSのキーボードは閉じ終わるまで0.3秒ほどかかり、
     その間 visualViewport はまだ縮んでいるので、1回だけだと縮んだ寸法を焼き付けていた
     (向きの変化と同じやり方で、落ち着くまで何度か呼び直す)。 */
  if(typeof resize==='function'){
    resize();
    [60, 250, 500, 900].forEach(ms=> setTimeout(resize, ms));
  }
}
// 入力欄にフォーカスが来たら、その場では編集させずポップアップへ回す
document.addEventListener('focusin', (e)=>{
  const el = e.target;
  if(!isKeyboardInput(el)) return;
  if(el.id==='textInputField') return;          // ポップアップ自身は対象外
  el.readOnly = true;                            // 以降このinputは直接キーボードを出さない
  el.blur();
  openTextInputPopup(el);
}, true);
{
  const ok = document.getElementById('textInputOkBtn');
  const cancel = document.getElementById('textInputCancelBtn');
  const ov = document.getElementById('textInputOverlay');
  const field = document.getElementById('textInputField');
  if(ok) ok.addEventListener('click', ()=> closeTextInputPopup(true));
  if(cancel) cancel.addEventListener('click', ()=> closeTextInputPopup(false));
  // 背景(暗い部分)をタップしたらキャンセル。枠の中は閉じない
  if(ov) ov.addEventListener('click', (e)=>{ if(e.target===ov) closeTextInputPopup(false); });
  if(field) field.addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){ e.preventDefault(); closeTextInputPopup(true); }
    else if(e.key==='Escape'){ e.preventDefault(); closeTextInputPopup(false); }
  });
}

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
let joystick = { active:false, pointerId:null, nx:0, ny:0, baseX:0, baseY:0, radius:46, peakUpNy:0, scale:1, downAt:0 };
let lookDrag = { active:false, pointerId:null, lastX:0, lastY:0 };

/* 視点を回す計算は**ここ1か所だけ**。#gameCanvasのドラッグと、FIREボタンを押した指の
   ドラッグ(FIREを滑らせて狙う)が同じ式を使う。感度・上下反転・可動範囲の正はここにしかない。
   dx,dyは実画面上の移動量。**必ず両軸をtoLogicalDeltaへ渡す** ── 強制横向きでは縦横が
   入れ替わるので、片方の軸だけ渡すともう一方が0になって動かなくなる。 */
function applyLookDelta(dx, dy){
  const logical = toLogicalDelta(dx, dy);
  // 感度は視点設定(world.jsのlookSettings。設定 → 視点設定 から変更できる)
  camState.yaw += logical.x*lookSettings.sensX;
  // 上下の可動範囲はマップ依存(リアルマップだけ空側へ広い。world.jsのcamPitchMin)
  camState.pitch = clamp(camState.pitch + (invertPitchY ? logical.y : -logical.y)*lookSettings.sensY, camPitchMin(), CAM_PITCH_MAX);
}

window.addEventListener('keydown', (e)=>{
  const k = e.key.toLowerCase();
  keys[k] = true;
  if(k===' '){ e.preventDefault(); if(game.started && !game.over) tryDash(player); }
});
window.addEventListener('keyup', (e)=>{ keys[e.key.toLowerCase()] = false; });

let tapTrack = { pointerId:null, startX:0, startY:0, startTime:0, moved:false };

function handleEnemyTap(sx,sy){
  if(typeof spectatingNow==='function' && spectatingNow()) return; // 観戦中はタップでの視点操作を無効化(自動追従を優先)
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
  /* 【マルチタッチ 2026-08-22】視点は**先に掴んだ指**が最後まで持つ。
     #hudはpointer-events:noneなので、左親指がジョイスティックの円から外れた瞬間
     そのタッチはcanvasへ届く。以前は無条件にpointerIdを上書きしていたため、
     カメラ操作が後から触れた指へ乗り移り、その指を離した時点でactive=falseになって
     「右親指は着いているのにカメラが完全に止まる」状態になっていた。
     tapTrack(敵タップ)も同じ指のぶんだけ記録する(別の指の座標が混ざると誤タップになる)。 */
  if(lookDrag.active) return;
  lookDrag.active = true; lookDrag.pointerId = e.pointerId;
  lookDrag.lastX = e.clientX; lookDrag.lastY = e.clientY;
  // 掴んだ指がcanvasの外(HUDのボタンの上など)へ滑ってもmove/upが届き続けるようにする
  try{ canvas.setPointerCapture(e.pointerId); }catch(_){}
  tapTrack.pointerId = e.pointerId;
  tapTrack.startX = e.clientX; tapTrack.startY = e.clientY;
  tapTrack.startTime = performance.now();
  tapTrack.moved = false;
});
// 視点の指を手放す(次の指が掴めるようIDも空ける。IDを残すと同じIDが再利用されたとき誤作動する)
function releaseLookDrag(pointerId){
  lookDrag.active = false; lookDrag.pointerId = null;
  try{ if(canvas.hasPointerCapture && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId); }catch(_){}
}
window.addEventListener('pointermove', (e)=>{
  if(!lookDrag.active || e.pointerId!==lookDrag.pointerId) return;
  if(Math.hypot(e.clientX-tapTrack.startX, e.clientY-tapTrack.startY) > 10) tapTrack.moved = true;
  // 【観戦カメラ修正 2026-08-19】観戦中は自分でドラッグ操作しない(見ている本体の向きへ自動追従。combat.jsのupdateCamera)。
  // タップ位置の記録だけは続け(スワイプ扱いでタップ判定を弾くため)、視点操作だけ止める。
  if(typeof spectatingNow==='function' && spectatingNow()) { lookDrag.lastX=e.clientX; lookDrag.lastY=e.clientY; return; }
  camSnap.active = false;
  const dx = e.clientX-lookDrag.lastX, dy = e.clientY-lookDrag.lastY;
  lookDrag.lastX = e.clientX; lookDrag.lastY = e.clientY;
  applyLookDelta(dx, dy);
});
window.addEventListener('pointerup', (e)=>{
  if(e.pointerId!==lookDrag.pointerId) return;
  releaseLookDrag(e.pointerId);
  const elapsed = performance.now()-tapTrack.startTime;
  if(!tapTrack.moved && elapsed < 300 && e.pointerId===tapTrack.pointerId){
    const p = toLogicalPoint(e.clientX, e.clientY);
    handleEnemyTap(p.x, p.y);
  }
});
window.addEventListener('pointercancel', (e)=>{ if(e.pointerId===lookDrag.pointerId) releaseLookDrag(e.pointerId); });
// 捕まえた指をOS都合で失ったとき(画面回転・要素の入れ替えなど)の保険。
// 掴んだままだと次の指がずっと弾かれ、カメラが二度と動かなくなる
canvas.addEventListener('lostpointercapture', (e)=>{ if(e.pointerId===lookDrag.pointerId) releaseLookDrag(e.pointerId); });

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
  joystick.downAt = performance.now();   // オートランの「弾く」判定に使う(長く倒していたら弾きではない)
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
/* 【触っていた時間の上限】「弾く」は素早い操作なので、触れてから離すまでがこれより長い
   ドラッグは弾きとして数えない。これが無いと**前へ歩いて離す**だけで1回ぶんに数えられ、
   すぐまた前へ歩いた瞬間にオートランが点いてしまう(意図しない発動として報告あり)。 */
const AUTORUN_FLICK_MAX_HOLD = 300;
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
    const now = performance.now();
    const flicked = (now - joystick.downAt) <= AUTORUN_FLICK_MAX_HOLD; // 長く倒していた=移動操作なので数えない
    joystick.active=false; joystick.nx=0; joystick.ny=0; joystick.peakUpNy=0; joystick.downAt=0;
    joyKnobEl.style.transform = 'translate(0,0)';
    // オートランOFF時のみ、上フリック2回連続で発動
    if(!game.autoRun && game.started && !game.over && flicked && peakUp < AUTORUN_FLICK_NY){
      if(now - autoRunFlickTime < AUTORUN_FLICK_WINDOW){ setAutoRun(true); }
      else autoRunFlickTime = now;
    }
  }
}
window.addEventListener('pointerup', releaseJoystick);
window.addEventListener('pointercancel', releaseJoystick);

const fireBtnEl = document.getElementById('fireBtn');
/* FIREを押した指を最後まで追いかける。
   ・以前はpointerleaveでfireBtnHeld=falseにしていたので、**押したまま少し動くと発射が止まっていた**
     (ボタンは狭い画面で78px・画面は被弾で揺れる・親指は必ず動く)。leaveでの解除は廃止し、
     pointerup/pointercancel だけで離す。押した瞬間にsetPointerCaptureで指を捕まえ、
     ボタンの外へ滑ってもイベントを取りこぼさないようにする。
   ・pointermove: そのまま滑らせると視点が動く(右親指1本で「撃つ+狙う」が完結する)。
     設定 lookSettings.fireDragAim でON/OFF、既定ON。OFFなら撃つだけで視点は動かない。 */
let fireDrag = { pointerId:null, lastX:0, lastY:0 };
fireBtnEl.addEventListener('pointerdown', (e)=>{
  e.preventDefault(); e.stopPropagation();
  fireBtnHeld = true;
  fireDrag.pointerId = e.pointerId; fireDrag.lastX = e.clientX; fireDrag.lastY = e.clientY;
  try{ fireBtnEl.setPointerCapture(e.pointerId); }catch(_){}
});
/* move/up は**windowで受ける**(ジョイスティック・視点ドラッグと同じ作り)。
   捕まえた指のイベントはFIREボタンからwindowまで上がってくるので取りこぼさず、
   万一setPointerCaptureが効かない環境でも指を追える。ボタン側にも重ねて付けると
   同じイベントを2回処理して視点が倍速で回るので、**listenerはwindow側だけ**にする。 */
window.addEventListener('pointermove', (e)=>{
  if(e.pointerId !== fireDrag.pointerId) return;   // FIREを押している指以外は無視
  const dx = e.clientX-fireDrag.lastX, dy = e.clientY-fireDrag.lastY;
  fireDrag.lastX = e.clientX; fireDrag.lastY = e.clientY;
  if(!lookSettings.fireDragAim) return;            // 設定でOFFなら「押しっぱなしで撃つ」だけ
  if(!game.started || game.over) return;
  // 観戦中は見ている本体の向きへ自動追従する(canvas側のドラッグと同じ扱い)
  if(typeof spectatingNow==='function' && spectatingNow()) return;
  camSnap.active = false;                          // 自分で狙い始めたら敵タップのスナップは解除
  applyLookDelta(dx, dy);
});
/* 離す。捕まえた指と同じIDのときだけ効かせる ── IDを見ないと、離した直後に
   遅れて届くlostpointercaptureが「次に押した指」のfireBtnHeldまで落としてしまう。 */
function releaseFireBtn(e){
  if(e.pointerId !== fireDrag.pointerId) return;
  fireBtnHeld = false;
  fireDrag.pointerId = null;
  try{ if(fireBtnEl.hasPointerCapture && fireBtnEl.hasPointerCapture(e.pointerId)) fireBtnEl.releasePointerCapture(e.pointerId); }catch(_){}
}
window.addEventListener('pointerup', releaseFireBtn);
window.addEventListener('pointercancel', releaseFireBtn);
// OS都合で指を失ったときの保険(画面回転・要素の入れ替えなど)。掴んだままだと撃ちっぱなしになる
fireBtnEl.addEventListener('lostpointercapture', releaseFireBtn);

/* =====================================================================
   画面から離れて戻ったとき(スリープ・着信・アプリ切替)

   ・**押しっぱなしを必ず解除する。** iOSは離脱時に指のイベントを最後まで届けないことがある。
     pointercancel が来る端末では上の release* が効くが、来ない端末では来ない。
     来なかった場合、戻ってきた瞬間から勝手に前進し続ける・撃ち続ける状態で復帰する。
     見えなくなった時点で全部「離した」状態へ戻す ── 押し直せばよいだけなので
     間違って解除したときの損は小さく、解除し損ねたときの損だけが大きい。
   ・解除は**上で使っている release*() をそのまま使う**(捕まえた指の解放や後始末が
     1か所に書いてあるので、ここで同じことを書き直さない)。
===================================================================== */
function releaseAllHeldInputs(){
  // FIRE(押しっぱなし発射 + 滑らせて狙う)
  if(fireDrag.pointerId !== null) releaseFireBtn({ pointerId: fireDrag.pointerId });
  fireBtnHeld = false;                       // 指のIDが残っていない経路(キー操作など)の保険
  // 視点ドラッグ。掴んだままだと次の指がずっと弾かれ、カメラが二度と動かない
  if(lookDrag.active || lookDrag.pointerId !== null) releaseLookDrag(lookDrag.pointerId);
  /* ジョイスティック。**releaseJoystick() は通さない** ── あれは「上へ弾いた」判定を含むので、
     中断をまたいで通すと戻った瞬間にオートランが点くことがある。ここでは値だけ戻す。 */
  joystick.active = false; joystick.pointerId = null;
  joystick.nx = 0; joystick.ny = 0; joystick.peakUpNy = 0; joystick.downAt = 0;
  if(joyKnobEl) joyKnobEl.style.transform = 'translate(0,0)';
  autoRunFlickTime = 0;                      // 中断をまたいだ2回目の弾きは数えない
  // オートラン(走り続けたまま戻ってこないように、離れた時点で切る)
  if(typeof game === 'object' && game.autoRun) setAutoRun(false);
  // キーボード: PCで他の窓へ移ると keyup が届かず押しっぱなしになる
  for(const k in keys) keys[k] = false;
}

/* ===== 試合中は画面を消させない(Wake Lock) =====
   長い試合は「見ている時間」のほうが長いので、自動ロックで画面が落ちてそのまま倒される。
   試合中だけロックを取り、離れたら解放・戻ったら取り直す。
   **取れない端末では何もしない**(未対応・拒否のどちらも例外を握りつぶすだけで、
   これまでとまったく同じ動きになる)。 */
const WAKE_LOCK_CHECK_MS = 4000;   // 試合の開始/終了を拾う見張りの間隔(4秒に1回の分岐だけ)
const WAKE_LOCK_MAX_FAIL = 3;      // 断られ続ける端末に何度も頼まない
let wakeLockSentinel = null;
let wakeLockFails = 0;
function wantWakeLock(){
  return document.visibilityState === 'visible'
      && typeof game === 'object' && !!game.started && !game.over;
}
function requestWakeLockIfPlaying(){
  if(!(navigator.wakeLock && navigator.wakeLock.request)) return;   // 未対応の端末では何もしない
  if(wakeLockSentinel || wakeLockFails >= WAKE_LOCK_MAX_FAIL) return;
  if(!wantWakeLock()) return;
  navigator.wakeLock.request('screen').then((s)=>{
    wakeLockSentinel = s; wakeLockFails = 0;
    // 画面が隠れるとOSが勝手に解放する。参照を捨てて、戻ったときに取り直せるようにする
    if(s.addEventListener) s.addEventListener('release', ()=>{ if(wakeLockSentinel === s) wakeLockSentinel = null; });
  }).catch(()=>{ wakeLockFails++; });
}
function releaseWakeLock(){
  const s = wakeLockSentinel; wakeLockSentinel = null;
  if(!s || !s.release) return;
  try{ const p = s.release(); if(p && p.catch) p.catch(()=>{}); }catch(_){}
}
setInterval(()=>{
  if(wantWakeLock()) requestWakeLockIfPlaying();
  else if(wakeLockSentinel) releaseWakeLock();
}, WAKE_LOCK_CHECK_MS);

document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible'){ requestWakeLockIfPlaying(); return; }
  releaseAllHeldInputs();
  releaseWakeLock();
});
/* PCや一部のAndroidは、別の窓へ移っても visibilitychange が来ない。
   blur でも同じ後始末をする(押しっぱなしの解除は何度やっても害が無い)。 */
window.addEventListener('blur', releaseAllHeldInputs);
// ホーム画面へ戻る・タブを捨てる(iOSはこの経路しか来ないことがある)
window.addEventListener('pagehide', ()=>{ releaseAllHeldInputs(); releaseWakeLock(); });

// ダッシュを実際に開始する(向きの決め方をホスト/ゲストで完全に同じにするため関数に分けてある。
// マルチではホストが applyRemoteInputsLocally からこれを呼んでゲストのダッシュを再現する)。
// 発動できない条件もここ1か所にまとめ、実際に始まったときだけtrueを返す
function startEntityDash(m){
  if(typeof entityDowned==='function' && entityDowned(m)) return false;   // ダウン中(チーム戦)はダッシュ不可
  /* 凍結中はここで弾く。resolveMovement(combat.js)が凍結中は冒頭でreturnして
     dashTimerを減らさないので、以前は押した瞬間にクールタイムだけ焼かれ、
     解凍した瞬間に「押した時の向き」へ勝手に飛び出していた。 */
  if(m.freezeUntil > matchTime) return false;
  let dx=m.lastMoveX, dy=m.lastMoveY;
  if(Math.hypot(dx,dy)<0.1){ dx=Math.cos(m.facingAngle); dy=Math.sin(m.facingAngle); }
  const len = Math.hypot(dx,dy)||1;
  m.dashDirX=dx/len; m.dashDirY=dy/len;
  m.dashTimer=DASH_DURATION; m.dashCooldown=DASH_COOLDOWN_MAX;
  m.lastDashAt = matchTime; // 位置の突き合わせでダッシュ直後を判別するのに使う
  return true;
}
function tryDash(m){
  if(!m.alive || m.dashCooldown>0) return;
  if(!startEntityDash(m)) return;   // 不発のときはクールタイムも焼かない・ホストへも伝えない
  // マルチのゲストは「ダッシュした」ことをホストへ伝える(入力にdashSeqとして載る)。
  // 伝えないとホスト側は通常移動のまま計算し、ダッシュぶんが誤差になって引き戻される。
  if(m.isPlayer && typeof noteLocalDash==='function') noteLocalDash();
}
document.getElementById('dashBtn').addEventListener('pointerdown', (e)=>{
  e.preventDefault(); e.stopPropagation();
  if(game.started && !game.over) tryDash(player);
});
// ピン(チーム系モードのみ表示): ボタン1押しで照準方向の敵/地点へピンを打つ(2タップ以内が絶対条件)
document.getElementById('pingBtn').addEventListener('pointerdown', (e)=>{
  e.preventDefault(); e.stopPropagation();
  if(game.started && !game.over && typeof sendPing==='function') sendPing();
});
/* ミニマップのタップで縮尺を切り替える(近距離ズーム ⇔ 全体表示。描画側はrender.jsのtoggleMinimapZoom)。
   全世界固定の縮尺では1px≒151ワールド単位で、交戦距離の敵が全部自分の点に重なっていた。
   stopPropagationしないと、この指がそのままcanvasの視点ドラッグを掴んでしまう */
document.getElementById('minimapWrap').addEventListener('pointerdown', (e)=>{
  e.preventDefault(); e.stopPropagation();
  if(typeof toggleMinimapZoom==='function') toggleMinimapZoom();
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
