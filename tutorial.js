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
  if(!tutState.review){
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
function tutorialAdvance(){
  if(!tutState) return;
  tutorialClearSpot();
  tutState.i++;
  if(tutState.i >= TUTORIAL_STEPS.length){
    if(tutState.review){ tutorialStop(); return; }
    tutorialFinish(); return;
  }
  if(typeof playSe === 'function') playSe('pickup');
  tutorialEnterStep();
}
function tutorialTick(){
  if(!tutState) return;
  const st = tutorialCurrentStep();
  if(!st) return;
  if(tutState.phase !== 'band') return;
  // 試合中は帯を出さない(画面を邪魔しない)。ロックも tutorialGate 側で外れる
  const inMatch = game.started && !game.over;
  document.getElementById('tutorialBand').classList.toggle('hidden', inMatch);
  if(inMatch){ tutorialClearSpot(); }
  else {
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
  document.getElementById('tutorialBandStep').textContent = `${tutState.i + 1}/${TUTORIAL_STEPS.length}`;
  document.getElementById('tutorialBandText').textContent = st.hint || '';
  band.classList.remove('hidden');
  document.getElementById('tutorialLayer').classList.remove('hidden');
}
function tutorialBandHide(){
  const band = document.getElementById('tutorialBand');
  if(band) band.classList.add('hidden');
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
