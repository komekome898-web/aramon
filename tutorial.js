/* =====================================================================
   初回チュートリアル(新規プレイヤーの離脱防止。発注者指示 2026-08-18)

   **順番・文言・完了条件は data.js の TUTORIAL_STEPS 1つ。** ここは進行役だけ。
   ステップ名で分岐する switch を**書かない**(表に1行足せば増える形を守る)。

   考え方:
   ・既存の画面遷移コードには手を入れず、**外から観測する**。完了判定は250msごとに
     表の done() を見るだけ(ボタンのハンドラを書き換えない)。
   ・「次に押すもの以外を押せなくする」のは **capture段のクリック濾過**で行う。
     e.target.closest() しか使わないので、**強制横向きで画面が90度回っていても効く**
     (座標を持つ穴あきマスクは使わない)。
   ・**必ず1つは押せる**ようにする(カードは常に押せる / 入場時の検算 / 空振り3回で復帰)。
   ===================================================================== */

const TUTORIAL_KEY = 'aramon_tutorial_v1';            // 進捗。**端末ごと**(ACCOUNT_SYNC_KEYSに入れない)
const TUTORIAL_GIFT_KEY = 'aramon_tutorial_gift_v1';  // 無料10連を受け取り済み。**こちらはアカウント同期する**
const TUT_TICK_MS = 250;      // 完了判定を見にいく間隔
const TUT_STUCK_MS = 1500;    // 押せるものが1つも無い状態がこれだけ続いたら復帰カード
const TUT_NUDGE_LIMIT = 3;    // 押せない所を続けて叩いた回数の上限
/* 練習試合の中で出す帯の居場所。
   既定(style.css)の bottom は画面のいちばん下で、試合中は技パネル(#movePanel)と重なる。
   空いているのは「技パネルの上 〜 操作ヒント #tipBox の下」の帯だけ(実測で35px)。
   **数字を二重に持たないため、技パネルの実物の位置から毎回決める。**
   割合(--vh)で置くと縦320pxの端末だけ技パネルに刺さるので、ここはHUDと同じpxで扱う
   (#movePanel/#tipBox/#fireBtn も style.css では px 指定)。 */
const TUT_BAND_CLEAR_PX = 1;      // 上下のすき間。空きが29pxしかない端末があるので1pxしか取れない
const TUT_BAND_FALLBACK_PX = 96;  // 実物が測れないときの位置(実測 技パネルの上端93+3)
const TUT_BAND_MIN_PX = 60;       // 画面カスタマイズで技パネルを動かされても、この範囲から出さない
const TUT_BAND_H_PX = 28;         // 帯の高さ(隠れていて測れないときの見込み)

// ステップ間で受け渡す一時値(トレーニング前のステータス、着せ替え前のスキンなど)
const tutorialVars = {};
// 実行中だけ入る。{ i, phase:'card'|'band', entered, nudges, bandAt, review }
let tutState = null;
let tutTimer = null;

/* ===== 進捗の保存(端末ごと) ===== */
function loadTutorialProgress(){
  try{ return JSON.parse(localStorage.getItem(TUTORIAL_KEY)) || { state:'none' }; }
  catch(err){ return { state:'none' }; }
}
function saveTutorialProgress(p){
  try{ localStorage.setItem(TUTORIAL_KEY, JSON.stringify(p)); }catch(err){}
}
function tutorialIsDone(){ return loadTutorialProgress().state === 'done'; }
// 実行中(=画面を固めている)か。**見返しモード(review)は固めない**
function tutorialActive(){ return !!tutState && !tutState.review; }
function tutorialCurrentStep(){ return tutState ? TUTORIAL_STEPS[tutState.i] : null; }
function tutorialAtStep(id){ const s = tutorialCurrentStep(); return !!s && s.id === id && tutorialActive(); }
// チュートリアル中はログインボーナス等のポップアップを後回しにする(保留は消えない)
function tutorialBlocksPopups(){ return !!tutState; }
// ホーム画面から起動しているか(PWA案内を出すかの判断だけに使う)
function tutorialIsStandalone(){
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

/* ===== 入口。タイトルをタップしてロビーが出た直後に呼ばれる ===== */
function tutorialMaybeStart(){
  if(typeof TUTORIAL_STEPS === 'undefined') return;
  const p = loadTutorialProgress();
  if(p.state === 'done' || p.state === 'declined') return;
  if(p.state === 'running'){ tutorialBegin(p.step); return; }   // 中断していたら続きから
  if(accountState.loggedIn) return;                             // ログイン済みの端末には出さない
  tutorialShowChoice();
}

/* 最初の2択。ここだけは表に載せず、進捗も持たない(まだ始まっていないため) */
function tutorialShowChoice(){
  tutorialCardShow({
    title: 'ようこそ、荒野モン動へ',
    body: 'はじめての方には、遊び方をひと通り案内します(3分ほど)。\nアカウントをお持ちの方は、ログインすると続きから遊べます。',
    next: 'はじめる',
    sub: 'ログインする',
  }, ()=>{                       // はじめる
    const p = loadTutorialProgress();
    p.state = 'running'; p.step = TUTORIAL_STEPS[0].id; saveTutorialProgress(p);
    tutorialBegin(p.step);
  }, ()=>{                       // ログインする
    tutorialOpenAccount();
    // ログイン/作成に成功したら tutorialOnAccount() が呼ばれる。閉じられたらもう一度出す
    tutorialWatchAccountClose();
  });
}
function tutorialWatchAccountClose(){
  const ov = document.getElementById('accountOverlay');
  const timer = setInterval(()=>{
    if(!ov || ov.classList.contains('hidden')){
      clearInterval(timer);
      if(accountState.loggedIn) return;                 // 成功→ tutorialOnAccount が処理済み
      if(loadTutorialProgress().state !== 'none') return;
      tutorialShowChoice();                             // やめたらもう一度2択へ
    }
  }, 300);
}

/* ===== 進行 ===== */
function tutorialBegin(stepId){
  if(tutState) return;
  let i = TUTORIAL_STEPS.findIndex(s=>s.id === stepId);
  if(i < 0) i = 0;
  /* 保険: 練習試合の中の段から始めようとしたら、その手前の「試合を始める段」まで戻す。
     試合が動いていないところで試合中の案内を出しても何も起きないため。
     (通常は inMatch の段を保存しないので、ここへ来るのは古い保存を読んだときだけ) */
  while(i > 0 && TUTORIAL_STEPS[i].inMatch) i--;
  tutState = { i, phase:'card', entered:false, nudges:0, bandAt:0, review:false };
  document.getElementById('tutorialLayer').classList.remove('hidden');
  tutorialEnterStep();
  if(tutTimer) clearInterval(tutTimer);
  tutTimer = setInterval(tutorialTick, TUT_TICK_MS);
}
// 今のステップに入る。飛ばす条件を満たしていたら次へ送る
function tutorialEnterStep(){
  const st = tutorialCurrentStep();
  if(!st){ tutorialFinish(); return; }
  /* 進捗の保存。**練習試合の中の段は保存しない**(p.step は「試合」の段のまま残る)。
     試合の途中で閉じられたら、次に開いたときは試合のやり直しから再開するのが正しいため。 */
  if(!tutState.review && !st.inMatch){
    const p = loadTutorialProgress();
    p.step = st.id; saveTutorialProgress(p);
  }
  if(!tutState.review && typeof st.skipIf === 'function'){
    let skip = false;
    try{ skip = !!st.skipIf(); }catch(err){}
    if(skip){ tutorialAdvance(); return; }
  }
  tutState.phase = 'card'; tutState.entered = false; tutState.nudges = 0;
  tutorialBandHide();
  if(st.card){
    tutorialCardShow({ title: st.card.title, body: st.card.body, img: st.card.img,
                       next: (st.id === 'finish' ? '受け取る' : '次へ'),
                       sub: (st.optional && !tutState.review) ? 'あとで' : null },
      ()=> tutorialAfterCard(st),
      (st.optional && !tutState.review) ? ()=> tutorialAdvance() : null);
  } else {
    tutorialAfterCard(st);
  }
}
// カードを閉じたあと。前準備(enter)を走らせ、操作の帯を出す
function tutorialAfterCard(st){
  if(tutState.review){ tutorialAdvance(); return; }
  if(st.id === 'finish'){ tutorialFinish(); return; }
  if(typeof st.enter === 'function' && !tutState.entered){
    tutState.entered = true;
    try{ st.enter(); }catch(err){ console.warn('[tutorial] enter失敗', st.id, err); }
  }
  if(typeof st.done !== 'function'){ tutorialAdvance(); return; }  // 説明だけのステップ
  tutState.phase = 'band'; tutState.bandAt = performance.now();
  tutorialBandShow(st);
}
/* 次のステップへ。opts.silent=true のときは進んだ音を鳴らさない
   (試合が終わって残りの案内をまとめて畳むときに、同じ音が連打されるのを防ぐ) */
function tutorialAdvance(opts){
  if(!tutState) return;
  const st = tutorialCurrentStep();
  if(st && typeof st.leave === 'function'){
    try{ st.leave(); }catch(err){ console.warn('[tutorial] leave失敗', st.id, err); }
  }
  tutorialClearSpot();
  tutState.i++;
  if(tutState.i >= TUTORIAL_STEPS.length){
    if(tutState.review){ tutorialStop(); return; }
    tutorialFinish(); return;
  }
  if(!(opts && opts.silent) && typeof playSe === 'function') playSe('pickup');
  tutorialEnterStep();
}
function tutorialTick(){
  if(!tutState) return;
  const st = tutorialCurrentStep();
  if(!st) return;
  if(tutState.phase !== 'band') return;
  if(st.inMatch){ tutorialTickInMatch(st); return; }
  // 試合中は帯を出さない(画面を邪魔しない)。ロックも tutorialGate 側で外れる
  const inMatch = tutorialMatchLive();
  document.getElementById('tutorialBand').classList.toggle('hidden', inMatch);
  if(inMatch){ tutorialClearSpot(); }
  else {
    tutorialBandPlace(false);
    tutorialMarkSpot(st);
    // 押せるものが1つも無いまま固まっていないか(詰み防止)
    if(tutorialVisibleAllowed().length === 0){
      if(performance.now() - tutState.bandAt > TUT_STUCK_MS) tutorialRecover();
    } else {
      tutState.bandAt = performance.now();
    }
  }
  let done = false;
  try{ done = !!st.done(); }catch(err){}
  if(done) tutorialAdvance();
}

/* ===== 練習試合の中の案内(表の inMatch) =====
   **試合は止まらない。** だからここでは
   ・画面をロックしない(tutorialGate は試合中そのまま素通りする)
   ・カードを出さない(表側で card を持たせない)
   ・帯と光る印だけを出し、読める最低時間(TUT_MATCH_READ_SEC)は必ず残す
   進めなくなる事故を防ぐ保険は3つ:
   ① done() を満たす ② limitSec 秒たつ ③ 倒された/試合が終わった → 残りは黙って畳む
   ③で畳んだあとは limitSec を持たない matchEnd に落ちて、リザルトが出るまでそこで待つ
   (試合の上へ次の説明カードが出ないようにするため)。 */
function tutorialMatchLive(){ return !!(game.started && !game.over); }
// もう操作の練習ができない状態(倒された・観戦に入った・試合が終わった)
function tutorialMatchPracticeOver(){
  if(!tutorialMatchLive()) return true;
  if(typeof player === 'undefined' || !player || !player.alive) return true;
  if(typeof spectatingNow === 'function' && spectatingNow()) return true;
  return false;
}
function tutorialBandSec(){ return tutState ? (performance.now() - tutState.bandAt) / 1000 : 0; }
function tutorialTickInMatch(st){
  const live = tutorialMatchLive();
  const show = live && !!st.hint;
  const band = document.getElementById('tutorialBand');
  if(band) band.classList.toggle('hidden', !show);
  if(show){ tutorialBandPlace(true); tutorialMarkSpot(st); }
  else { tutorialClearSpot(); }
  if(st.limitSec){
    if(tutorialMatchPracticeOver()){ tutorialAdvance({ silent:true }); return; }   // 保険③
    if(tutorialBandSec() > st.limitSec){ tutorialAdvance({ silent:true }); return; }  // 保険②
  }
  let done = false;
  try{ done = !!st.done(); }catch(err){}
  // 先に条件を満たしていても、帯が一瞬で消えないように読む時間だけは残す
  if(done && (!st.hint || tutorialBandSec() >= TUT_MATCH_READ_SEC)) tutorialAdvance();
}
// 進めなくなったとき。ここに落ちても必ず先へ行ける
function tutorialRecover(){
  const st = tutorialCurrentStep();
  tutState.phase = 'card';
  tutorialBandHide();
  tutorialCardShow({ title:'ここは飛ばします', body:'うまく進められませんでした。次の案内へ進みます。', next:'次へ' },
    ()=>{ tutorialAdvance(); }, null);
  console.warn('[tutorial] 押せる対象が見つからないので飛ばした', st && st.id);
}
function tutorialStop(){
  if(tutTimer){ clearInterval(tutTimer); tutTimer = null; }
  tutState = null;
  tutorialClearSpot();
  tutorialBandHide();
  tutorialCardHide();
  document.getElementById('tutorialLayer').classList.add('hidden');
}
// 完了。プレゼントを渡してから閉じる
function tutorialFinish(){
  const review = !!(tutState && tutState.review);
  if(!review){
    const p = loadTutorialProgress();
    p.state = 'done'; p.step = null; saveTutorialProgress(p);
    if(typeof addWallet === 'function') addWallet(0, TUTORIAL_REWARD.dia);
    (TUTORIAL_REWARD.items || []).forEach(it=>{ if(typeof addBagItem === 'function') addBagItem(it.key, it.n); });
    if(typeof checkTitleUnlocks === 'function') checkTitleUnlocks();
    if(typeof updateAccountBar === 'function') updateAccountBar();
    if(typeof pushToast === 'function'){
      const items = (TUTORIAL_REWARD.items || []).map(it=>`${PLAYER_ITEMS[it.key] ? PLAYER_ITEMS[it.key].name : it.key}×${it.n}`).join('・');
      pushToast(`チュートリアル完了！ 💎${TUTORIAL_REWARD.dia}${items ? ' と ' + items : ''} を受け取りました`);
    }
    if(typeof accountMarkDirty === 'function') accountMarkDirty();
  }
  tutorialStop();
  tutorialBackToLobby();
  // 後回しにしていたポップアップをここで出す
  if(typeof maybeFlushPendingPromoPopups === 'function') maybeFlushPendingPromoPopups();
  if(typeof flushPendingLoginBonusPopup === 'function') flushPendingLoginBonusPopup();
}

/* ===== カード(節目の全画面説明) ===== */
let tutCardNext = null, tutCardSub = null;
function tutorialCardShow(o, onNext, onSub){
  const layer = document.getElementById('tutorialLayer');
  const card  = document.getElementById('tutorialCard');
  if(!layer || !card) return;
  layer.classList.remove('hidden');
  document.getElementById('tutorialCardTitle').textContent = o.title || '';
  document.getElementById('tutorialCardText').textContent = o.body || '';
  const img = document.getElementById('tutorialCardImg');
  if(o.img){ img.src = o.img; img.classList.remove('hidden'); } else { img.classList.add('hidden'); img.removeAttribute('src'); }
  const nextBtn = document.getElementById('tutorialCardNextBtn');
  const subBtn  = document.getElementById('tutorialCardSubBtn');
  nextBtn.textContent = o.next || '次へ';
  subBtn.textContent = o.sub || '';
  subBtn.classList.toggle('hidden', !o.sub);
  tutCardNext = onNext || null; tutCardSub = onSub || null;
  card.classList.remove('hidden');
}
function tutorialCardHide(){
  const card = document.getElementById('tutorialCard');
  if(card) card.classList.add('hidden');
  tutCardNext = null; tutCardSub = null;
}

/* ===== 帯(操作中の指示) ===== */
function tutorialBandShow(st){
  const band = document.getElementById('tutorialBand');
  if(!band) return;
  document.getElementById('tutorialBandStep').textContent = tutorialStepCounter();
  document.getElementById('tutorialBandText').textContent = st.hint || '';
  tutorialBandPlace(!!st.inMatch);
  band.classList.toggle('hidden', !!st.inMatch && !st.hint);   // 帯の中身が無い段(matchEnd)は出さない
  document.getElementById('tutorialLayer').classList.remove('hidden');
}
function tutorialBandHide(){
  const band = document.getElementById('tutorialBand');
  if(band) band.classList.add('hidden');
  tutorialBandPlace(false);   // 試合中に寄せた位置を必ず元へ返す
}
/* 帯の居場所。試合中だけ技パネルの上へ寄せる(重なると技の切り替えが見えなくなる)。
   位置を持っているのは style.css なので、**戻すときは空文字にして元の指定へ返す。** */
function tutorialBandPlace(inMatch){
  const band = document.getElementById('tutorialBand');
  if(!band) return;
  if(!inMatch){ band.style.bottom = ''; return; }
  let px = TUT_BAND_FALLBACK_PX;
  const mp = document.getElementById('movePanel');
  const hud = document.getElementById('hud');
  if(mp && hud && mp.offsetParent !== null && hud.offsetHeight){
    px = (hud.offsetHeight - mp.offsetTop) + TUT_BAND_CLEAR_PX;   // 技パネルの「上端」より上へ
    // 操作ヒント(#tipBox)の下にも収める。**上下とも実物から決めるので数字を持たない**
    const tip = document.getElementById('tipBox');
    if(tip && tip.offsetParent !== null){
      const tipBottom = hud.offsetHeight - (tip.offsetTop + tip.offsetHeight);
      px = Math.min(px, tipBottom - (band.offsetHeight || TUT_BAND_H_PX) - TUT_BAND_CLEAR_PX);
    }
    // 画面カスタマイズで技パネルを上下へ動かされても、帯は下半分に留める
    px = Math.max(TUT_BAND_MIN_PX, Math.min(px, Math.round(hud.offsetHeight * 0.5)));
  }
  band.style.bottom = px + 'px';
}
/* 帯の「n/N」。**練習試合の中の案内は数に入れない。**
   段数が急に増えたように見えると「まだこんなにあるのか」と閉じられてしまうため、
   試合中の案内は直前の「試合」の段と同じ番号のまま出す。 */
function tutorialStepCounter(){
  const total = TUTORIAL_STEPS.filter(s=> !s.inMatch).length;
  let n = 0;
  for(let i = 0; i <= tutState.i && i < TUTORIAL_STEPS.length; i++){ if(!TUTORIAL_STEPS[i].inMatch) n++; }
  return `${Math.max(1, n)}/${total}`;
}
// 押せない所を叩いたときに帯を揺らす(何度も続いたら復帰カードを出す)
function tutorialNudge(){
  const band = document.getElementById('tutorialBand');
  if(band && !band.classList.contains('hidden')){
    band.classList.remove('tut-shake'); void band.offsetWidth; band.classList.add('tut-shake');
  }
  tutState.nudges++;
  if(tutState.nudges >= TUT_NUDGE_LIMIT) tutorialRecover();
}

/* ===== 光らせる ===== */
function tutorialClearSpot(){
  document.querySelectorAll('.tut-spot').forEach(el=> el.classList.remove('tut-spot'));
}
/* 対象は innerHTML で作り直されることがあるので、毎回セレクタから引き直して付け直す。
   位置ではなく**要素そのもの**に付けるので、回転しても必ず合う。 */
function tutorialMarkSpot(st){
  const sel = (st.allow || [])[0];
  const el = sel ? document.querySelector(sel) : null;
  const want = (el && el.offsetParent !== null) ? el : null;
  document.querySelectorAll('.tut-spot').forEach(x=>{ if(x !== want) x.classList.remove('tut-spot'); });
  if(want) want.classList.add('tut-spot');
}
// 今さわってよくて、実際に画面に出ている要素
function tutorialVisibleAllowed(){
  const st = tutorialCurrentStep();
  if(!st) return [];
  const out = [];
  (st.allow || []).forEach(sel=>{
    document.querySelectorAll(sel).forEach(el=>{
      if(el.offsetParent !== null && !el.disabled) out.push(el);
    });
  });
  return out;
}

/* ===== 押せるものを絞る(capture段の濾過) =====
   **座標を一切見ない。** DOMの親子関係だけで判断するので強制横向きでも効く。
   許可した要素のクリックは既存のハンドラへそのまま届く(既存の挙動は変えない)。 */
function tutorialGate(e){
  if(!tutorialActive()) return;
  if(!e.isTrusted) return;                       // こちらから出した click は通す
  if(game.started && !game.over) return;         // 試合中は操作を邪魔しない
  if(tutState.phase === 'card'){
    if(e.target.closest('#tutorialLayer')) return;
  } else {
    const st = tutorialCurrentStep();
    const allow = ['#tutorialLayer'].concat((st && st.allow) || []);
    for(const sel of allow){ if(sel && e.target.closest(sel)) return; }
  }
  e.stopPropagation();
  e.preventDefault();
  if(e.type === 'click') tutorialNudge();
}
document.addEventListener('pointerdown', tutorialGate, true);
document.addEventListener('click', tutorialGate, true);

/* ===== 表(TUTORIAL_STEPS)から呼ばれる小道具 ===== */
function tutorialMastermonKey(){
  const data = (typeof loadMastermons === 'function') ? loadMastermons() : {};
  const p = loadTutorialProgress();
  if(p.element && data[p.element]) return p.element;
  if(game.selectedMastermonKey && data[game.selectedMastermonKey]) return game.selectedMastermonKey;
  if(game.selectedElement && data[game.selectedElement]) return game.selectedElement;
  const keys = Object.keys(data);
  return keys.length ? keys[0] : null;
}
function tutorialRememberElement(){
  const k = tutorialMastermonKey();
  if(!k) return;
  const p = loadTutorialProgress();
  if(p.element !== k){ p.element = k; saveTutorialProgress(p); }
}
function tutorialOpenTraining(){
  tutorialRememberElement();
  const k = tutorialMastermonKey();
  if(!k) return;
  tutorialVars.trainBase = mastermonStatTotal(loadMastermons()[k]);
  mastermonDetailKey = k;
  openMastermonScreen(false);
  openMastermonDetail(k, null);
  mmOpenTab('training');
}
function tutorialTrainDone(){
  const k = tutorialMastermonKey();
  if(!k) return true;
  const mm = loadMastermons()[k];
  if(!mm) return true;
  return mastermonStatTotal(mm) > (tutorialVars.trainBase || 0);
}
/* ロビーの「出撃」から入った試合を練習試合にするかどうか。**判断はこの1か所** */
function tutorialWantsShortMatch(){ return tutorialAtStep('match'); }
/* 練習試合の前に、ロビーの選択を「シングル(30人バトロワ)」へ寄せる。
   前回チーム戦やレイドを選んだままだと、練習試合が別のモードで始まってしまう。 */
function tutorialSetSoloMode(){
  if(typeof setLobbyMode === 'function') setLobbyMode('single');
  if(typeof setLobbySubMode === 'function') setLobbySubMode('br30');
}
/* ===== 練習試合の中の案内が見る「今の状態」 =====
   **新しい状態変数を増やさない。** 見るのは既にある camState / player / zoneState /
   fireBtnHeld だけで、ステップ間の控えは tutorialVars に置く(トレーニングと同じ流儀)。 */
function tutorialMarkYaw(){
  tutorialVars.yaw0 = (typeof camState !== 'undefined' && camState) ? camState.yaw : 0;
}
// 控えた向きから th ラジアン以上回ったか
function tutorialYawMoved(th){
  if(typeof camState === 'undefined' || !camState) return true;   // 読めないなら止めない
  return Math.abs(camState.yaw - (tutorialVars.yaw0 || 0)) >= th;
}
/* 「FIREを押したまま滑らせて狙う」。専用の印は作らず、
   **FIREを押している間に向きが変わったか**だけを見る(離している間は基準を取り直す)。 */
function tutorialFireAimDone(){
  if(typeof fireBtnHeld === 'undefined') return true;
  if(!fireBtnHeld){ tutorialMarkYaw(); return false; }
  return tutorialYawMoved(TUT_AIM_YAW_RAD);
}
function tutorialMarkMoveTier(){
  tutorialVars.tier0 = (typeof player !== 'undefined' && player) ? player.moveTierSelected : 1;
}
/* 技のこと。試合の始めは tier1 しか無く、修行チケットを拾って初めて切り替えられる。
   だから**拾えた**か**自分で切り替えた**かのどちらでも「分かった」と見なす。 */
function tutorialMoveTierDone(){
  if(typeof player === 'undefined' || !player) return true;
  if((player.moveTierUnlocked || 1) > 1) return true;
  return player.moveTierSelected !== (tutorialVars.tier0 || 1);
}
// 安置の中にいるか。**判定式は render.js / combat.js と同じ**(中心からの距離と半径だけ)
function tutorialInZoneDone(){
  if(typeof zoneState === 'undefined' || !zoneState) return true;
  if(typeof player === 'undefined' || !player) return true;
  return dist(player, zoneState.center) <= zoneState.radius;
}
function tutorialMarkGuts(){ tutorialVars.gutsLow = null; }
/* ガッツは「切れても待てば戻る」と気づいてもらう段。
   いちばん低かった値を覚えておき、そこから戻り始めたら次へ(満タンのままなら即次へ)。 */
function tutorialGutsDone(){
  if(typeof player === 'undefined' || !player || !player.maxGuts) return true;
  const g = player.guts;
  tutorialVars.gutsLow = (tutorialVars.gutsLow == null) ? g : Math.min(tutorialVars.gutsLow, g);
  if(g >= player.maxGuts) return true;
  return g > tutorialVars.gutsLow + TUT_GUTS_REGAIN;
}
/* 「開いて見た」で終わる段(遠征・プレイモード)。ヘルプ(tutorialHelpDone)と同じ作りで、
   **開いている間は false・閉じたら true**。中で何かを実行させると、
   遠征なら相棒が何時間も出払い、マルチなら部屋を立てて放置になるのでそこまではさせない。 */
function tutorialSeenOverlayDone(varKey, ids){
  const open = ids.some(id=>{ const el = document.getElementById(id); return !!el && !el.classList.contains('hidden'); });
  if(open){ tutorialVars[varKey] = true; return false; }
  return !!tutorialVars[varKey];
}
function tutorialExpeditionDone(){ return tutorialSeenOverlayDone('expSeen', ['expeditionOverlay', 'expeditionPickOverlay']); }
function tutorialModePickDone(){ return tutorialSeenOverlayDone('modeSeen', ['modePickOverlay']); }
function tutorialOpenAccount(){
  const btn = document.getElementById('accountLoginBtn');
  if(btn) btn.click();   // 既存の「開く」処理をそのまま使う(合成clickなので濾過は素通り)
}
/* アカウントの作成/ログインに成功したとき ui.js から呼ばれる。
   **既存アカウントへのログインは、ローカルのデータがサーバーの内容で置き換わる。**
   途中まで進めた分が消えるので、その場合はチュートリアルを終わりにしてロビーへ返す。 */
function tutorialOnAccount(kind){
  if(!tutState) {
    if(loadTutorialProgress().state === 'none'){
      const p = loadTutorialProgress(); p.state = 'declined'; saveTutorialProgress(p);
    }
    return;
  }
  if(kind === 'login'){
    const p = loadTutorialProgress();
    p.state = 'done'; p.step = null; saveTutorialProgress(p);
    tutorialStop();
    tutorialBackToLobby();
    if(typeof pushToast === 'function') pushToast('おかえりなさい！ 続きから遊べます');
  }
  // 新規作成のときは、そのステップの done() が true になるので何もしなくてよい
}
function tutorialOpenGacha(){
  tutorialRememberElement();
  openGachaScreen();
  setGachaMode('skin');   // レイド開催中はレイドタブで開くので、スキンへ戻す
}
/* 初回10連だけ無料。**読んだ瞬間に受け取り済みにする**(二度は無い) */
function tutorialGachaIsFree(count){
  if(count !== 10) return false;
  if(!tutorialAtStep('gacha')) return false;
  if(localStorage.getItem(TUTORIAL_GIFT_KEY) === '1') return false;
  try{ localStorage.setItem(TUTORIAL_GIFT_KEY, '1'); }catch(err){}
  tutorialVars.rig = tutorialRiggedSkinId();
  if(typeof accountMarkDirty === 'function') accountMarkDirty();
  return true;
}
/* 確定で出すスキン。登録したマスモンの色スキン(未所持を優先)。
   全色すでに持っていたら細工しない(null を返す=通常抽選のまま)。 */
function tutorialRiggedSkinId(){
  const el = tutorialMastermonKey() || game.selectedElement;
  if(!el || typeof monsterSkinColors !== 'function') return null;
  const all = monsterSkinColors(el).map(c=> colorSkinId(el, c.id != null ? c.id : c));
  const fresh = all.filter(id=> !isSkinOwned(id));
  const pool = fresh.length ? fresh : all;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}
/* 10連の最後の1枠だけ差し替える。ここは付与も演出も結果表示もこの roll しか見ないので、
   差し替えるだけで全部そろう。使ったら消して二度は効かせない。 */
function tutorialRigGachaRoll(roll, index, count){
  if(!tutorialVars.rig) return roll;
  if(index !== count - 1) return roll;
  const skinId = tutorialVars.rig;
  tutorialVars.rig = null;
  const p = loadTutorialProgress();
  p.skin = skinId; saveTutorialProgress(p);
  return { rarity:'SR', kind:'skin', skinId };
}
function tutorialGachaDone(){
  const p = loadTutorialProgress();
  if(p.skin) return isSkinOwned(p.skin);
  return localStorage.getItem(TUTORIAL_GIFT_KEY) === '1';   // 細工なしで引いた場合
}
function tutorialOpenDressup(){
  const k = tutorialMastermonKey();
  if(!k) return;
  tutorialVars.dressBase = getEquippedSkin(k) || null;
  mastermonDetailKey = k;
  openMastermonScreen(false);
  openMastermonDetail(k, null);
  mmOpenTab('dressup');
}
function tutorialDressupDone(){
  const k = tutorialMastermonKey();
  if(!k) return true;
  const now = getEquippedSkin(k) || null;
  const p = loadTutorialProgress();
  if(p.skin && now === p.skin) return true;
  return now !== (tutorialVars.dressBase || null);
}
function tutorialHelpDone(){
  const help = document.getElementById('helpOverlay');
  const img  = document.getElementById('helpImageOverlay');
  const open = (help && !help.classList.contains('hidden')) || (img && !img.classList.contains('hidden'));
  if(open){ tutorialVars.helpSeen = true; return false; }
  return !!tutorialVars.helpSeen;
}
// 開いている画面を閉じてロビーへ戻す(次の案内をロビーで出したいとき)
function tutorialBackToLobby(){
  if(typeof mmCarousel !== 'undefined' && mmCarousel && typeof mmCarousel.stopAnim === 'function') mmCarousel.stopAnim();
  ['mastermonScreen','resultScreen','monsterListScreen','gachaOverlay','accountOverlay','myPageOverlay']
    .forEach(id=>{ const el = document.getElementById(id); if(el) el.classList.add('hidden'); });
  const start = document.getElementById('startScreen');
  if(start) start.classList.remove('hidden');
}

/* ===== ヘルプの「はじめての説明をもう一度」 =====
   **説明カードを順に見せるだけ。**画面は固めず、報酬もガチャの細工も走らない。 */
function tutorialReplayCards(){
  if(tutState) return;
  const first = TUTORIAL_STEPS.findIndex(s=> !!s.card);
  if(first < 0) return;
  tutState = { i:first, phase:'card', entered:true, nudges:0, bandAt:0, review:true };
  document.getElementById('tutorialLayer').classList.remove('hidden');
  tutorialReplayShow();
}
function tutorialReplayShow(){
  while(tutState && tutState.i < TUTORIAL_STEPS.length && !TUTORIAL_STEPS[tutState.i].card) tutState.i++;
  if(!tutState || tutState.i >= TUTORIAL_STEPS.length){ tutorialStop(); return; }
  const st = TUTORIAL_STEPS[tutState.i];
  tutorialCardShow({ title:st.card.title, body:st.card.body, img:st.card.img, next:'次へ' },
    ()=>{ tutState.i++; tutorialReplayShow(); }, null);
}

/* ===== ボタンの結線 ===== */
(function tutorialBindUi(){
  const next = document.getElementById('tutorialCardNextBtn');
  const sub  = document.getElementById('tutorialCardSubBtn');
  if(next) next.addEventListener('click', ()=>{ const f = tutCardNext; tutorialCardHide(); if(f) f(); });
  if(sub)  sub.addEventListener('click',  ()=>{ const f = tutCardSub;  tutorialCardHide(); if(f) f(); });
  const replay = document.getElementById('helpReplayTutorialBtn');
  if(replay) replay.addEventListener('click', ()=>{
    document.getElementById('helpOverlay').classList.add('hidden');
    tutorialReplayCards();
  });
})();

/* ===== はじめてその画面を開いたときの1枚カード(FIRST_VISIT_CARDS) =====
   チュートリアル本編に全部の遊びを詰めると長くてやめてしまうので、
   **その画面を初めて開いたときに1枚だけ**説明を出す(遠征・マルチは本編で教えるので表に無い)。
   ・**画面ごとの分岐はここに書かない。** 対応は data.js の FIRST_VISIT_CARDS が正で、1行足せば増える
   ・capture段で見るだけ。既存のハンドラは書き換えないので、押したボタンは普段どおり動く
   ・本編の最中(tutState)は出さない。カードの取り合いになる
   ・e.isTrusted を見るのは、チュートリアルやツールが投げる合成クリックで出さないため */
document.addEventListener('click', (e)=>{
  if(!e.isTrusted || tutState) return;
  if(typeof tutorialIsDone==='function' && !tutorialIsDone()) return;
  if(typeof firstVisitCardForTarget!=='function') return;
  const c = firstVisitCardForTarget(e.target);
  if(!c) return;
  markFirstVisitSeen(c.id);
  // 画面が開いてから重ねる(先に出すと、開いた画面がカードの上に来る)
  setTimeout(()=>{ tutorialCardShow({ title:c.title, body:c.body, next:'わかった' }, ()=>{}, null); }, 350);
}, true);
