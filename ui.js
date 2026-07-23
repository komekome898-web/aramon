const TRAIT_DESC = {
  burn:       '攻撃命中で相手をやけど状態に(10秒間 被ダメ1.5倍)',
  lifesteal:  '与えたダメージの20%分HP回復。技命中で20%の確率で相手を1秒間こおり状態に(行動不能)',
  gutsdrain:  '与えたダメージの30%分 相手のガッツを削る。ガッツ回復速度1.5倍・技の連射速度1.5倍・技の威力0.8倍',
  slow:       '技命中で相手を1秒間 移動速度半分に',
  golem:      '被ダメ0.8倍・与ダメ1.2倍',
  haste:      '技の連射速度1.5倍',
  grace:      '与えたダメージの45%分 相手のガッツを削る。天の慈悲(tier3)発動後10秒間 被ダメ0.5倍',
  poison:     '技命中で相手をどく状態に(10秒間 1秒毎に5ダメージ、どくではHPは1残る)',
  bighitbox:  '技の当たり判定が1.5倍大きい',
  soft:       '被ダメ0.8倍',
  gutsbreak:  '与えたダメージの40%分 相手のガッツを削る',
  godrange:   '全ての技の射程が長い・技の消費ガッツ-12.5%',
};
function stateTriggerText(sc){
  return {
    hpBelow: `HPが${Math.round(sc.triggerValue*100)}%以下で発動`,
    gutsBelow: `ガッツが${Math.round(sc.triggerValue*100)}%以下で発動`,
    onHitChance: `技命中時${Math.round(sc.triggerValue*100)}%の確率で発動`,
    onHitTakenChance: `技を受けた時${Math.round(sc.triggerValue*100)}%の確率で発動`,
    onKill: `撃破時に発動`,
  }[sc.trigger] || '';
}
function stateDurationText(sc){
  return `効果時間${sc.duration}秒間・クールタイム${sc.cooldown}秒`;
}
game.selectedMastermonKey = null;

function buildMonsterGrid(){
  const grid = document.getElementById('monsterGrid');
  grid.innerHTML = `
    <div class="monster-card selector-card" id="mastermonSelectCard"></div>
    <div class="monster-card selector-card" id="monsterListSelectCard"></div>
  `;
  document.getElementById('mastermonSelectCard').addEventListener('click', ()=>openMastermonScreen(false));
  document.getElementById('monsterListSelectCard').addEventListener('click', openMonsterListScreen);
  buildMonsterListScreenGrid();
  renderSelectorCards();
}

// そのモンスターに装備中のスキンがあればスキンアイコン(dataURL)、無ければ通常画像で <img> を返す
function equippedIconImgTag(element, altLabel){
  if(typeof getEquippedSkin==='function'){
    const sk = getEquippedSkin(element);
    if(sk){ const url = skinnedIconDataUrl(sk); if(url) return `<img src="${url}" alt="${altLabel||''}">`; }
  }
  return `<img src="${imgSrcFor(`monsters/${element}`)}" data-ext-idx="0" alt="${altLabel||''}" onerror="handleMonsterImgError(this, 'monsters/${element}')">`;
}
function renderSelectorCards(){
  const mmCard = document.getElementById('mastermonSelectCard');
  const mmData = game.selectedMastermonKey ? loadMastermons()[game.selectedMastermonKey] : null;
  if(mmData){
    const el = ELEMENTS[mmData.element];
    const mults = mastermonEffectMults(mmData);
    const effHp = Math.round(el.hp*mults.lifeMult);
    const effSpeed = Math.round(el.speed*(el.speedMod||1)*mults.speedMult);
    mmCard.classList.add('selected');
    mmCard.style.setProperty('--accent', el.accent || el.color);
    mmCard.innerHTML = `
      <div class="m-swatch" style="background:radial-gradient(circle at 35% 30%, ${el.color}, ${el.dark})">
        ${equippedIconImgTag(mmData.element, el.label)}
      </div>
      <div class="m-name">${mmData.name}<span class="m-name-sub">(${el.label})</span></div>
      <div class="m-stat">Lv.${mmData.level}　HP ${effHp}<br>速さ ${effSpeed}</div>
      <div class="m-trait">マスモンから選ぶ</div>`;
  } else {
    mmCard.classList.remove('selected');
    mmCard.style.removeProperty('--accent');
    mmCard.innerHTML = `
      <div class="m-swatch mastermon-entry-swatch">★</div>
      <div class="m-name">マスモンから選ぶ</div>
      <div class="m-stat" id="mastermonEntryCount">登録数 0</div>
      <div class="m-trait">育てたマスモンで参戦できます</div>`;
    updateMastermonEntryCount();
  }

  const listCard = document.getElementById('monsterListSelectCard');
  if(game.selectedElement && !game.selectedMastermonKey){
    const el = ELEMENTS[game.selectedElement];
    listCard.classList.add('selected');
    listCard.style.setProperty('--accent', el.accent || el.color);
    listCard.innerHTML = `
      <div class="m-swatch" style="background:radial-gradient(circle at 35% 30%, ${el.color}, ${el.dark})">
        <img src="${imgSrcFor(`monsters/${game.selectedElement}`)}" data-ext-idx="0" alt="${el.label}" onerror="handleMonsterImgError(this, 'monsters/${game.selectedElement}')">
      </div>
      <div class="m-name">${el.label}</div>
      <div class="m-stat">HP ${el.hp}<br>速さ ${Math.round(el.speed*(el.speedMod||1))}</div>
      <div class="m-trait">モンスター一覧から選ぶ</div>`;
  } else {
    listCard.classList.remove('selected');
    listCard.style.removeProperty('--accent');
    listCard.innerHTML = `
      <div class="m-swatch monsterlist-entry-swatch">🐾</div>
      <div class="m-name">モンスター一覧から選ぶ</div>
      <div class="m-stat">${Object.keys(ELEMENTS).length}体から選択</div>
      <div class="m-trait">お気に入りのモンスターで参戦</div>`;
  }
}

function buildMonsterListScreenGrid(){
  const grid = document.getElementById('monsterListGrid');
  grid.innerHTML = '';
  Object.keys(ELEMENTS).forEach(key=>{
    const el = ELEMENTS[key];
    const card = document.createElement('div');
    card.className = 'monster-card' + (game.selectedElement===key && !game.selectedMastermonKey ? ' selected' : '');
    card.style.setProperty('--accent', el.accent || el.color);
    card.innerHTML = `
      <div class="m-swatch" style="background:radial-gradient(circle at 35% 30%, ${el.color}, ${el.dark})">
        <img src="${imgSrcFor(`monsters/${key}`)}" data-ext-idx="0" alt="${el.label}" onerror="handleMonsterImgError(this, 'monsters/${key}')">
      </div>
      <div class="m-name">${el.label}</div>
      <div class="m-stat">HP ${el.hp}<br>速さ ${Math.round(el.speed*(el.speedMod||1))}</div>
      <div class="m-trait">${TRAIT_DESC[el.trait]}${moveBonusEffectText(key) ? `<br>${moveBonusEffectText(key)}` : ''}</div>`;
    card.addEventListener('click', ()=>{
      game.selectedElement = key;
      game.selectedMastermonKey = null;
      updatePlayButtonsEnabled();
      document.getElementById('monsterListScreen').classList.add('hidden');
      document.getElementById('startScreen').classList.remove('hidden');
      renderSelectorCards();
    });
    grid.appendChild(card);
  });
}
function openMonsterListScreen(){
  buildMonsterListScreenGrid();
  document.getElementById('monsterListScreen').classList.remove('hidden');
  document.getElementById('startScreen').classList.add('hidden');
}
document.getElementById('closeMonsterListBtn').addEventListener('click', ()=>{
  document.getElementById('monsterListScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
});
function updateMastermonEntryCount(){
  const countEl = document.getElementById('mastermonEntryCount');
  if(!countEl) return;
  const n = Object.keys(loadMastermons()).length;
  countEl.textContent = `登録数 ${n}`;
}
function describeStateEffectsText(effects){
  const parts = [];
  if(effects.dmgMult) parts.push(`技ダメ${effects.dmgMult}倍`);
  if(effects.gutsRegenMult) parts.push(`ガッツ回復${effects.gutsRegenMult}倍`);
  if(effects.cooldownMult){
    const atkSpeed = Math.round((1/effects.cooldownMult)*10)/10;
    parts.push(`連射${atkSpeed}倍`);
  }
  if(effects.gutsCostMult) parts.push(`消費ガッツ${effects.gutsCostMult}倍`);
  if(effects.speedMult) parts.push(`移動${effects.speedMult}倍`);
  if(effects.dmgTakenMult!=null) parts.push(`被ダメ${effects.dmgTakenMult}倍`);
  if(effects.lifestealPct) parts.push(`与ダメの${Math.round(effects.lifestealPct*100)}%自己回復`);
  return parts.join('・');
}
function buildHowtoLists(){
  const itemsEl = document.getElementById('howtoItems');
  if(itemsEl){
    const cards = [];
    HEAL_TYPES.forEach(type=>{
      const hi = HEAL_ITEMS[type];
      cards.push(`
        <div class="howto-item-card">
          <div class="howto-item-icon" style="background:${hi.color};">🧴</div>
          <div class="howto-item-text"><div class="howto-item-name">${hi.name}</div><div class="howto-item-effect">HP+${hi.heal}</div></div>
        </div>`);
    });
    cards.push(`
      <div class="howto-item-card">
        <div class="howto-item-icon" style="background:${TICKET_ITEM.color};">🎫</div>
        <div class="howto-item-text"><div class="howto-item-name">${TICKET_ITEM.name}</div><div class="howto-item-effect">技を強化(tier3後はランダムで永続強化)</div></div>
      </div>`);
    cards.push(`
      <div class="howto-item-card">
        <div class="howto-item-icon" style="background:${GUTS_ITEM.color};">🍬</div>
        <div class="howto-item-text"><div class="howto-item-name">${GUTS_ITEM.name}</div><div class="howto-item-effect">ガッツ+${GUTS_ITEM.restore}・上限+${GUTS_ITEM.maxBoost}</div></div>
      </div>`);
    TRAINING_TYPES.forEach(type=>{
      const ti = TRAINING_ITEMS[type];
      cards.push(`
        <div class="howto-item-card">
          <div class="howto-item-icon" style="background:${ti.color};">${ti.emoji}</div>
          <div class="howto-item-text"><div class="howto-item-name">${ti.name}(低確率)</div><div class="howto-item-effect">${ti.desc}</div></div>
        </div>`);
    });
    itemsEl.innerHTML = cards.join('');
  }

  const statesEl = document.getElementById('howtoStates');
  if(statesEl){
    const cards = Object.keys(ELEMENTS).map(key=>{
      const el = ELEMENTS[key];
      const sc = STATE_CHANGES[key];
      if(!sc) return '';
      return `
        <div class="howto-state-card">
          <div class="howto-state-icon">
            <img src="${imgSrcFor(`monsters/${key}`)}" data-ext-idx="0" alt="${el.label}" onerror="handleMonsterImgError(this, 'monsters/${key}')">
          </div>
          <div class="howto-state-text">
            <div class="howto-state-name">${el.label}：${sc.name}</div>
            <div class="howto-state-trigger">${stateTriggerText(sc)}</div>
            <div class="howto-state-duration">${stateDurationText(sc)}</div>
            <div class="howto-state-effect">${describeStateEffectsText(sc.effects)}</div>
          </div>
        </div>`;
    });
    statesEl.innerHTML = cards.join('');
  }
}
buildMonsterGrid();
buildHowtoLists();

// ===== 音量設定(BGM/SE) =====
function syncAudioSliders(){
  document.getElementById('bgmVolSlider').value = Math.round(audioSettings.bgm*100);
  document.getElementById('seVolSlider').value = Math.round(audioSettings.se*100);
  document.getElementById('bgmVolVal').textContent = Math.round(audioSettings.bgm*100);
  document.getElementById('seVolVal').textContent = Math.round(audioSettings.se*100);
}
document.getElementById('audioSettingsBtn').addEventListener('click', ()=>{
  syncAudioSliders();
  document.getElementById('audioSettingsOverlay').classList.remove('hidden');
});
document.getElementById('closeAudioSettingsBtn').addEventListener('click', ()=>{
  document.getElementById('audioSettingsOverlay').classList.add('hidden');
  saveAudioSettings();
});
document.getElementById('bgmVolSlider').addEventListener('input', (e)=>{
  audioSettings.bgm = (+e.target.value)/100;
  document.getElementById('bgmVolVal').textContent = e.target.value;
  applyAudioVolumes();
});
document.getElementById('bgmVolSlider').addEventListener('change', ()=>saveAudioSettings());
document.getElementById('seVolSlider').addEventListener('input', (e)=>{
  audioSettings.se = (+e.target.value)/100;
  document.getElementById('seVolVal').textContent = e.target.value;
  applyAudioVolumes();
});
document.getElementById('seVolSlider').addEventListener('change', ()=>{ saveAudioSettings(); playSe('pickup'); }); // 音量確認用に試し鳴らし
// ±ボタンで1ずつ調整
function nudgeVolume(key, delta){
  const v = Math.min(100, Math.max(0, Math.round(audioSettings[key]*100) + delta));
  audioSettings[key] = v/100;
  applyAudioVolumes();
  saveAudioSettings();
  syncAudioSliders();
}
document.getElementById('bgmVolMinus').addEventListener('click', ()=>nudgeVolume('bgm', -1));
document.getElementById('bgmVolPlus').addEventListener('click', ()=>nudgeVolume('bgm', +1));
document.getElementById('seVolMinus').addEventListener('click', ()=>nudgeVolume('se', -1));
document.getElementById('seVolPlus').addEventListener('click', ()=>nudgeVolume('se', +1));

// ===== プレイヤーアカウント(名前+パスコードでログイン・サーバー同期) =====
const ACCOUNT_CRED_KEY = 'aramon_account_v1';        // 自動ログイン用の認証情報
const ACCOUNT_LOCAL_TS_KEY = 'aramon_account_ts_v1'; // ローカルデータの最終更新時刻
// サーバーに同期するlocalStorageキー(音量などの端末固有設定は同期しない)。
// ※このコードはPLAYER_NAME_KEY等の宣言より前に実行されるため、キー名は文字列で直接指定する
const ACCOUNT_SYNC_KEYS = ['aramon_mastermons_v1','aramon_local_stats_v1','aramon_player_name_v1','aramon_wallet_v1','aramon_bag_v1','aramon_skins_v1','aramon_catalogs_v1','aramon_gachacount_v1','aramon_promo_skingacha_v1','aramon_titles_v1','aramon_daily_v1','aramon_season_v1'];
const accountState = { loggedIn:false, name:null, key:null, pass:null, syncTimer:null };

function loadAccountCreds(){ try{ return JSON.parse(localStorage.getItem(ACCOUNT_CRED_KEY)); }catch(err){ return null; } }
function saveAccountCreds(c){ try{ localStorage.setItem(ACCOUNT_CRED_KEY, JSON.stringify(c)); }catch(err){} }

function collectAccountData(){
  const out = {};
  for(const k of ACCOUNT_SYNC_KEYS){
    const v = localStorage.getItem(k);
    if(v!=null) out[k] = v;
  }
  return out;
}
function applyAccountData(d){
  if(!d) return;
  for(const k of ACCOUNT_SYNC_KEYS){
    if(d[k]!=null){ try{ localStorage.setItem(k, d[k]); }catch(err){} }
  }
  const savedName = localStorage.getItem('aramon_player_name_v1');
  if(savedName!=null) document.getElementById('playerNameInput').value = savedName;
  renderSelectorCards();
  updateAccountBar();
}
// ローカルデータが更新された時に呼ばれる。ログイン中ならデバウンスしてサーバーへ送信
function accountMarkDirty(){
  try{ localStorage.setItem(ACCOUNT_LOCAL_TS_KEY, String(Date.now())); }catch(err){}
  updateAccountBar();
  if(!accountState.loggedIn) return;
  clearTimeout(accountState.syncTimer);
  accountState.syncTimer = setTimeout(accountSyncNow, 3000);
}
async function accountSyncNow(){
  if(!accountState.loggedIn || !window.__aramonUpdateAccountData) return;
  try{ await window.__aramonUpdateAccountData(accountState.key, collectAccountData()); }catch(err){}
}
function updateAccountBar(){
  const w = loadWallet();
  // 上部ヘッダー: アカウント名・ゴールド・ダイヤ
  document.getElementById('headerAccountName').textContent = accountState.loggedIn ? accountState.name : 'ゲスト';
  document.getElementById('headerGold').textContent = `🪙 ${w.gold}`;
  document.getElementById('headerDia').textContent = `💎 ${w.dia}`;
  const btn = document.getElementById('accountLoginBtn');
  const slot = document.getElementById('headerAccountBtnSlot');
  const bar = document.getElementById('accountBar');
  if(accountState.loggedIn){
    // ログイン中はアカウントボタンをヘッダーのプレイヤー名の横へ移動(コンパクト表示)
    btn.textContent = '👤 アカウント';
    btn.classList.add('logged-in');
    if(slot && btn.parentElement !== slot) slot.appendChild(btn);
  } else {
    // 未ログイン時はトップのボタン群の先頭(音量設定の上)へ戻す
    btn.textContent = '👤 ログイン / アカウント作成';
    btn.classList.remove('logged-in');
    if(bar && btn.parentElement !== bar) bar.insertBefore(btn, bar.firstChild);
  }
  // ログイン中はランキング表示名の入力欄を隠す(アカウント名を表示名として使う)
  document.getElementById('playerNameLabel').classList.toggle('hidden', accountState.loggedIn);
  document.getElementById('playerNameInput').classList.toggle('hidden', accountState.loggedIn);
  if(typeof updateHeaderTitle==='function') updateHeaderTitle();
}
// アカウント名をランキング表示名として反映する(入力欄は非表示でも値は参照される)
function applyAccountNameAsDisplayName(name){
  document.getElementById('playerNameInput').value = name;
  try{ localStorage.setItem('aramon_player_name_v1', name); }catch(err){}
}
function accountShowMsg(text, ok){
  const el = document.getElementById('accountMsg');
  el.textContent = text;
  el.classList.toggle('ok', !!ok);
  el.classList.remove('hidden');
}
document.getElementById('accountLoginBtn').addEventListener('click', ()=>{
  document.getElementById('accountNameInput').value = accountState.name || document.getElementById('playerNameInput').value.trim();
  document.getElementById('accountPassInput').value = '';
  document.getElementById('accountMsg').classList.add('hidden');
  document.getElementById('accountLogoutBtn').classList.toggle('hidden', !accountState.loggedIn);
  document.getElementById('accountOverlay').classList.remove('hidden');
});
document.getElementById('accountCancelBtn').addEventListener('click', ()=>{
  document.getElementById('accountOverlay').classList.add('hidden');
});
document.getElementById('accountLogoutBtn').addEventListener('click', ()=>{
  accountState.loggedIn = false; accountState.name = null; accountState.key = null; accountState.pass = null;
  try{ localStorage.removeItem(ACCOUNT_CRED_KEY); }catch(err){}
  document.getElementById('accountOverlay').classList.add('hidden');
  updateAccountBar();
  pushToast('ログアウトしました');
});
document.getElementById('accountSubmitBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('accountNameInput').value.trim();
  const pass = document.getElementById('accountPassInput').value.trim();
  if(!name){ accountShowMsg('プレイヤー名を入力してください'); return; }
  if(!/^\d{4}$/.test(pass)){ accountShowMsg('パスコードは4桁の数字で入力してください'); return; }
  if(!window.__aramonGetAccount){ accountShowMsg('通信の準備中です。少し待ってからもう一度お試しください'); return; }
  const key = window.__aramonAccountKey(name);
  accountShowMsg('確認中…', true);
  try{
    const acc = await window.__aramonGetAccount(key);
    if(!acc){
      // 新規作成: 現在のローカルデータをサーバーに保存
      // 名前入力欄もアカウント名に合わせておく(ランキング表示名と一致させる)
      document.getElementById('playerNameInput').value = name;
      try{ localStorage.setItem('aramon_player_name_v1', name); }catch(err){}
      await window.__aramonSetAccount(key, {
        name, pass, createdAt: Date.now(), updatedAt: Date.now(), data: collectAccountData(),
      });
      accountState.loggedIn = true; accountState.name = name; accountState.key = key; accountState.pass = pass;
      saveAccountCreds({ name, key, pass });
      updateAccountBar();
      accountShowMsg('アカウントを作成しました！今後は自動でログインします', true);
      pushToast(`ようこそ、${name}！`);
      promoOryouResetIfNeeded(name);
      maybeShowSkinGachaPromo();
    } else if(String(acc.pass) === pass){
      // ログイン: サーバーのデータを取り込む
      accountState.loggedIn = true; accountState.name = acc.name; accountState.key = key; accountState.pass = pass;
      saveAccountCreds({ name: acc.name, key, pass });
      applyAccountData(acc.data);
      applyAccountNameAsDisplayName(acc.name);
      updateAccountBar();
      accountShowMsg('ログインしました！', true);
      pushToast(`おかえりなさい、${acc.name}！`);
      promoOryouResetIfNeeded(acc.name);
      maybeShowSkinGachaPromo();
    } else {
      // 名前の重複検知: 別人のアカウントが存在する
      accountShowMsg('この名前は既に使われています。別の名前に変えるか、心当たりがあれば正しいパスコードを入力してください');
    }
  }catch(err){
    accountShowMsg('通信に失敗しました。電波の良いところでもう一度お試しください');
  }
});
// 自動ログイン: 保存済みの認証情報でサーバーと同期(Firebase読み込み完了までリトライ)
// アプリ更新(controllerchangeでのリロード)直後はfirebase.js(module)やCDNの読み込みが
// 遅れることがあるため、リトライ回数を十分に確保する。
(function accountAutoLogin(){
  const creds = loadAccountCreds();
  if(!creds || !creds.key) return;
  // 認証情報がある時点で、通信完了前でもログイン済みとしてUIを更新しておく
  // (これをしないと、データ取得が遅い/失敗したときにログアウト状態に見えてしまう)
  accountState.loggedIn = true; accountState.name = creds.name; accountState.key = creds.key; accountState.pass = creds.pass;
  applyAccountNameAsDisplayName(creds.name);
  updateAccountBar();
  let tries = 0;
  const attempt = async ()=>{
    if(!window.__aramonGetAccount){
      if(++tries < 240) setTimeout(attempt, 500); // 最大約2分リトライ
      return;
    }
    try{
      const acc = await window.__aramonGetAccount(creds.key);
      if(acc && String(acc.pass) === String(creds.pass)){
        accountState.name = acc.name;
        const localTs = +(localStorage.getItem(ACCOUNT_LOCAL_TS_KEY)||0);
        if((acc.updatedAt||0) >= localTs){
          try{ applyAccountData(acc.data); }catch(e){} // サーバーの方が新しい→取り込む(失敗してもログイン状態は維持)
        } else {
          accountMarkDirty(); // ローカルの方が新しい(オフラインでプレイ等)→サーバーへ送る
        }
        applyAccountNameAsDisplayName(acc.name);
        updateAccountBar();
        promoOryouResetIfNeeded(acc.name);
        maybeShowSkinGachaPromo();   // ログイン中アカウントに記念ダイヤ+ポップアップ(一度だけ)
      } else if(acc && String(acc.pass) !== String(creds.pass)){
        // パスコードが変更された等でサーバーと不一致→ログイン解除
        accountState.loggedIn = false; accountState.key = null; accountState.pass = null;
        updateAccountBar();
      }
      // acc が取得できなかった(通信失敗・一時的にnull)場合は、端末の認証情報を信じてログイン状態を維持
    }catch(err){}
  };
  attempt();
})();

// ===== バッグ =====
let bagSelectedItem = null; // 説明フィールドに表示中のアイテムキー
document.getElementById('openBagBtn').addEventListener('click', ()=>{
  bagSelectedItem = null;   // renderBagで先頭アイテムを自動選択→一覧+ゲージが最初から表示
  renderBag();
  bagShowTab('item'); // 開くたびアイテムタブから
  document.getElementById('bagOverlay').classList.remove('hidden');
});
// バッグのタブ切替(アイテム / スキン / 称号)
function bagShowTab(tab){
  document.querySelectorAll('.bag-tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===tab));
  document.getElementById('bagItemPane').classList.toggle('hidden', tab!=='item');
  document.getElementById('bagSkinPane').classList.toggle('hidden', tab!=='skin');
  document.getElementById('bagTitlePane').classList.toggle('hidden', tab!=='title');
  if(tab==='skin') renderBagSkins();
  else if(tab==='title') renderBagTitles();
}
// 称号一覧(獲得済みを上に、未獲得は解放条件を表示。タップで装着トグル)
function renderBagTitles(){
  const grid = document.getElementById('bagTitleGrid');
  if(!grid || typeof TITLES==='undefined') return;
  if(typeof checkTitleUnlocks==='function') checkTitleUnlocks(); // 開いた時点の実績を反映(SSR所持/全属性など)
  const t = loadTitles();
  const hint = document.getElementById('bagTitleHint');
  const eqCount = (t.equipped||[]).length;
  if(hint){
    const cnt = TITLES.filter(d=>t.unlocked[d.id]).length;
    hint.textContent = `獲得 ${cnt} / ${TITLES.length}　タップで装着(もう一度で外す・最大${TITLE_EQUIP_MAX}つ ${eqCount}/${TITLE_EQUIP_MAX})。装着中はアイコンが名前の横に表示されます。`;
  }
  const list = TITLES.slice().sort((a,b)=>{
    const ua = t.unlocked[a.id]?0:1, ub = t.unlocked[b.id]?0:1;
    return ua-ub; // 獲得済みを先頭へ(同順はカタログ順維持)
  });
  grid.innerHTML = list.map(def=>{
    const owned = !!t.unlocked[def.id];
    const eq = owned && (t.equipped||[]).includes(def.id);
    return `<button class="bag-title-cell ${owned?'owned':'locked'} ${eq?'equipped':''}" data-title="${def.id}" ${owned?'':'disabled'}>
      <span class="bag-title-emoji">${owned?def.emoji:'🔒'}</span>
      <span class="bag-title-name">${owned?def.name:'？？？'}</span>
      <span class="bag-title-cond">${titleCondText(def)}</span>
      ${eq?'<span class="bag-title-eqbadge">装着中</span>':''}
    </button>`;
  }).join('');
  grid.querySelectorAll('.bag-title-cell.owned').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.dataset.title;
      const tt = loadTitles();
      const arr = tt.equipped || [];
      const idx = arr.indexOf(id);
      if(idx>=0){ arr.splice(idx,1); } // 装着解除
      else if(arr.length < TITLE_EQUIP_MAX){ arr.push(id); } // 装着
      else { if(typeof pushToast==='function') pushToast(`称号は最大${TITLE_EQUIP_MAX}つまで装着できます`); return; }
      tt.equipped = arr;
      saveTitles(tt);
      renderBagTitles();
      updateHeaderTitle();
    });
  });
}
// 装着中の称号(最大3つ)をトップヘッダーのプレイヤー名の横にアイコンのみで表示
function updateHeaderTitle(){
  const chip = document.getElementById('headerTitleChip');
  if(!chip || typeof loadTitles!=='function') return;
  const t = loadTitles();
  const ids = t.equipped || [];
  const emojis = ids.map(id=> TITLES_BY_ID[id] ? TITLES_BY_ID[id].emoji : '').filter(Boolean);
  if(emojis.length){ chip.textContent = emojis.join(''); chip.classList.remove('hidden'); }
  else { chip.textContent = ''; chip.classList.add('hidden'); }
}
document.querySelectorAll('.bag-tab').forEach(tab=>{
  tab.addEventListener('click', ()=> bagShowTab(tab.dataset.tab));
});
// ===== スキンのプレビュー(正面=アイコン / 後ろ姿=試合中)を大きく表示 =====
// バッグ・ガチャ結果・カタログ・シーズン報酬など、スキンをタップしたら共通で開く
let skinPreviewSelect = null; // カタログからのプレビュー時のみ「選ぶ」ボタンのコールバックを保持
function skinPreviewSrc(skinId, view){
  const url = view==='back' ? skinnedPlayerDataUrl(skinId) : skinnedIconDataUrl(skinId);
  if(url) return url;
  // フォールバック: 画像がまだdataURL化されていない場合、SSRは元ファイルを直接読む
  if(SSR_SKINS[skinId]){ const s = SSR_SKINS[skinId]; return `monsters/${view==='back'? s.playerImg : s.iconImg}.png`; }
  return '';
}
function showSkinPreview(skinId, opts){
  opts = opts || {};
  const m = skinMeta(skinId);
  if(!m) return;
  document.getElementById('skinPreviewName').textContent = m.name;
  const rarEl = document.getElementById('skinPreviewRar');
  rarEl.textContent = m.rarity; rarEl.className = 'skin-preview-rar rar-'+m.rarity;
  document.getElementById('skinPreviewFront').src = skinPreviewSrc(skinId, 'front');
  document.getElementById('skinPreviewBack').src = skinPreviewSrc(skinId, 'back');
  const selBtn = document.getElementById('skinPreviewSelectBtn');
  if(opts.selectable){ selBtn.classList.remove('hidden'); skinPreviewSelect = opts.onSelect || null; }
  else { selBtn.classList.add('hidden'); skinPreviewSelect = null; }
  document.getElementById('skinPreviewOverlay').classList.remove('hidden');
}
document.getElementById('skinPreviewCloseBtn').addEventListener('click', ()=>{
  document.getElementById('skinPreviewOverlay').classList.add('hidden'); skinPreviewSelect = null;
});
document.getElementById('skinPreviewSelectBtn').addEventListener('click', ()=>{
  const fn = skinPreviewSelect; skinPreviewSelect = null;
  document.getElementById('skinPreviewOverlay').classList.add('hidden');
  if(fn) fn();
});

// 所持スキン一覧(レアリティ順)
function renderBagSkins(){
  const grid = document.getElementById('bagSkinGrid');
  const owned = loadSkins().owned;
  const ids = Object.keys(owned).filter(id=>owned[id] && skinMeta(id));
  if(ids.length===0){
    grid.innerHTML = '<div class="bag-skin-empty">所持しているスキンはありません。ガチャで手に入れよう！</div>';
    return;
  }
  // 並び順: レアリティ(SSR→SR)を優先しつつ、同レアリティ内は種族順→色順で並べる
  const elemOrder = Object.keys(ELEMENTS);
  const colOrder = (typeof SKIN_COLOR_ORDER!=='undefined') ? SKIN_COLOR_ORDER : [];
  ids.sort((a,b)=>{
    const ma=skinMeta(a), mb=skinMeta(b);
    const rr = (RARITY_RANK[mb.rarity]||0)-(RARITY_RANK[ma.rarity]||0);
    if(rr!==0) return rr;
    const ea=elemOrder.indexOf(ma.element), eb=elemOrder.indexOf(mb.element);
    if(ea!==eb) return ea-eb;
    return colOrder.indexOf(ma.colorId||'') - colOrder.indexOf(mb.colorId||'');
  });
  grid.innerHTML = ids.map(id=>{
    const m = skinMeta(id);
    const url = skinnedIconDataUrl(id);
    const img = url ? `<img src="${url}" alt="">` : `<span class="gacha-cell-emoji">✨</span>`;
    return `<div class="bag-skin-cell" data-skin="${id}">${img}<span class="bag-skin-rar rar-${m.rarity}">${m.rarity}</span><span class="bag-skin-name">${m.name}</span></div>`;
  }).join('');
  grid.querySelectorAll('.bag-skin-cell').forEach(cell=>{
    cell.addEventListener('click', ()=> showSkinPreview(cell.dataset.skin));
  });
}
document.getElementById('closeBagBtn').addEventListener('click', ()=>{
  document.getElementById('bagOverlay').classList.add('hidden');
});
let bagUseQty = 1;
let bagPicker = { itemKey:null, targetKey:null };
function renderBag(){
  const bag = loadBag();
  const gridEl = document.getElementById('bagIconGrid');
  const keys = Object.keys(PLAYER_ITEMS).filter(k=>bag[k]>0);
  if(keys.length===0){
    gridEl.innerHTML = '<div class="bag-empty">アイテムはありません。ガチャやショップで手に入れよう！</div>';
    bagSelectedItem = null;
    renderBagDesc();
    return;
  }
  // 表示中のアイテムが無くなったら選択解除。未選択なら先頭を自動選択(最初から選択済み表示)
  if(bagSelectedItem && !(bag[bagSelectedItem]>0)) bagSelectedItem = null;
  if(!bagSelectedItem) bagSelectedItem = keys[0];
  gridEl.innerHTML = keys.map(k=>{
    const it = PLAYER_ITEMS[k];
    const active = k===bagSelectedItem;
    return `
    <button class="bag-icon-cell ${active?'active':''}" data-key="${k}">
      <span class="bag-icon-emoji">${it.icon}</span>
      <span class="bag-icon-count">×${bag[k]}</span>
    </button>`;
  }).join('');
  gridEl.querySelectorAll('.bag-icon-cell').forEach(b=>{
    b.addEventListener('click', ()=>{
      if(bagSelectedItem===b.dataset.key) return; // 常に何か選択された状態を維持
      bagSelectedItem = b.dataset.key;
      renderBag();
    });
  });
  renderBagDesc();
}
// 選択中アイテムの説明+個数ゲージ+対象マスモン一覧を常に表示する
function renderBagDesc(){
  const empty = document.getElementById('bagDescEmpty');
  const content = document.getElementById('bagDescContent');
  const wrap = document.getElementById('bagTargetWrap');
  if(!bagSelectedItem || !PLAYER_ITEMS[bagSelectedItem]){
    empty.classList.remove('hidden');
    content.classList.add('hidden');
    wrap.classList.add('hidden');
    return;
  }
  const it = PLAYER_ITEMS[bagSelectedItem];
  empty.classList.add('hidden');
  content.classList.remove('hidden');
  document.getElementById('bagDescIcon').textContent = it.icon;
  document.getElementById('bagDescName').textContent = it.name;
  document.getElementById('bagDescText').textContent = playerItemDesc(bagSelectedItem);
  // 個数ゲージ: 最低1・最大=所持数。アイテムを切り替えたら1にリセット
  const owned = loadBag()[bagSelectedItem] || 0;
  bagUseQty = 1;
  const slider = document.getElementById('bagQtySlider');
  slider.max = Math.max(1, owned); slider.value = 1;
  document.getElementById('bagQtyVal').textContent = '1';
  // 対象マスモン一覧を最初から表示(使うボタンを廃止)
  bagPicker = { itemKey: bagSelectedItem, targetKey:null };
  renderBagTargetList();
  wrap.classList.remove('hidden');
}
function setBagQty(v){
  const slider = document.getElementById('bagQtySlider');
  const max = +slider.max || 1;
  bagUseQty = Math.max(1, Math.min(max, Math.round(v)||1));
  slider.value = bagUseQty;
  document.getElementById('bagQtyVal').textContent = bagUseQty;
  // 右側マスモンのプレビュー(ステータス差分・チケット枚数)を個数に合わせて更新
  const wrap = document.getElementById('bagTargetWrap');
  if(wrap && !wrap.classList.contains('hidden')) renderBagTargetList();
}
document.getElementById('bagQtyMinus').addEventListener('click', ()=>setBagQty(bagUseQty-1));
document.getElementById('bagQtyPlus').addEventListener('click', ()=>setBagQty(bagUseQty+1));
document.getElementById('bagQtySlider').addEventListener('input', (e)=>setBagQty(+e.target.value));
function renderBagTargetList(){
  const data = loadMastermons();
  const pick = document.getElementById('bagTargetList');
  const keys = Object.keys(data);
  if(keys.length===0){
    pick.innerHTML = '<div class="bag-empty">マスモンがいません。先にマスモン登録しよう！</div>';
    document.getElementById('bagUseConfirmBtn').disabled = true;
    return;
  }
  const it = PLAYER_ITEMS[bagPicker.itemKey];
  const qty = bagUseQty || 1;
  // ステータスの実は対象ステータスのプレビュー差分(個数分)を作り、マスモン画面と同じステータスバーで表示
  const preview = it.stat ? { [it.stat]: STAT_SEED_GAIN * qty } : null;
  pick.innerHTML = keys.map(k=>{
    const mm = data[k];
    const active = k===bagPicker.targetKey;
    const statsBarHtml = buildMastermonStatsColHtml(mm, APTITUDE[k], preview);
    const extra =
      bagPicker.itemKey==='freeTrainTicket' ? `<div class="bt-extra">🎫 トレチケ ${mm.tickets||0}→${(mm.tickets||0)+qty}枚</div>` :
      bagPicker.itemKey==='moveTicket' ? `<div class="bt-extra">⚔️ 技強化ストック ${mm.nextMoveBoost||0}→${(mm.nextMoveBoost||0)+qty}</div>` : '';
    return `
    <button class="bag-target-btn ${active?'active':''}" data-key="${k}">
      <span class="bt-head">
        ${equippedIconImgTag(k, ELEMENTS[k].label)}
        ${mm.name}(${ELEMENTS[k].label}) Lv.${mm.level}
      </span>
      ${statsBarHtml}
      ${extra}
    </button>`;
  }).join('');
  pick.querySelectorAll('.bag-target-btn').forEach(b=>{
    b.addEventListener('click', ()=>{
      bagPicker.targetKey = (bagPicker.targetKey===b.dataset.key) ? null : b.dataset.key;
      renderBagTargetList();
    });
  });
  document.getElementById('bagUseConfirmBtn').disabled = !bagPicker.targetKey;
}
document.getElementById('bagUseConfirmBtn').addEventListener('click', ()=>{
  if(!bagPicker.itemKey || !bagPicker.targetKey) return;
  useBagItem(bagPicker.itemKey, bagPicker.targetKey, bagUseQty);
});
function useBagItem(itemKey, mmKey, qty){
  const bag = loadBag();
  qty = Math.max(1, Math.min(Math.round(qty)||1, bag[itemKey]||0));
  if(qty<=0) return;
  const data = loadMastermons();
  const mm = data[mmKey];
  const it = PLAYER_ITEMS[itemKey];
  if(!mm || !it) return;
  let resultText;
  if(it.stat){
    const before = mm.stats[it.stat];
    for(let i=0;i<qty;i++) mm.stats[it.stat] = mastermonClampStat(mm.stats[it.stat] + STAT_SEED_GAIN);
    const gained = mm.stats[it.stat] - before;
    resultText = `${mm.name}の${MASTERMON_STATS.find(s=>s.key===it.stat).label}+${gained}`;
    if(gained<=0) resultText = `${mm.name}のステータスは上限です(アイテムは消費されました)`;
  } else if(itemKey==='freeTrainTicket'){
    mm.tickets = (mm.tickets||0) + qty;
    resultText = `${mm.name}のトレーニングチケット+${qty}(🎫${mm.tickets}枚)`;
  } else if(itemKey==='moveTicket'){
    mm.nextMoveBoost = (mm.nextMoveBoost||0) + qty;
    resultText = `${mm.name}は次の試合を技tier2解放で開始！(${mm.nextMoveBoost}回分)`;
  }
  bag[itemKey] -= qty;
  if(bag[itemKey]<=0) delete bag[itemKey];
  saveBag(bag);
  saveMastermons(data);
  playSe('train');
  pushToast(resultText);
  renderBag(); // 消費後に再描画(残っていれば一覧+ゲージを再表示、0なら別アイテムへ)
  renderSelectorCards();
}

// ===== ガチャ(スキンガチャ・全画面) =====
const RARITY_RANK = { N:0, R:1, SR:2, SSR:3 };
function updateGachaWallet(){
  const w = loadWallet();
  document.getElementById('gachaDia').textContent = `💎 ${w.dia}`;
}
function rarityCssColor(rarity, now){
  if(rarity==='SSR'){ const h=((now||0)*0.12)%360; return `hsl(${h},90%,63%)`; }
  return RARITIES[rarity].color;
}
// --- ガチャカウンター(ゲージ・カタログ) ---
function updateGachaCounterUI(){
  const c = loadGachaCount();
  document.getElementById('gachaCountNum').textContent = `${c.count} / ${GACHA_SSR_CATALOG_AT}`;
  document.getElementById('gachaGaugeFill').style.width = `${Math.min(100, c.count/GACHA_SSR_CATALOG_AT*100)}%`;
  document.querySelectorAll('.gacha-milestone').forEach(m=>{
    const at = +m.dataset.at;
    m.classList.toggle('reached', c.count>=at);
  });
  const cats = loadCatalogs();
  const row = document.getElementById('gachaCatalogRow');
  let html='';
  if(cats.sr>0) html += `<button class="gacha-catalog-btn sr" data-cat="sr">🎫 SRスキンカタログ ×${cats.sr}</button>`;
  if(cats.ssr>0) html += `<button class="gacha-catalog-btn ssr" data-cat="ssr">🎫 SSRスキンカタログ ×${cats.ssr}</button>`;
  row.innerHTML = html;
  row.querySelectorAll('.gacha-catalog-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> openCatalogModal(btn.dataset.cat));
  });
}
// カウンターを進め、100/200到達でカタログ付与。200で1周してリセット
function incrementGachaCount(n){
  const c = loadGachaCount(); const granted=[];
  for(let i=0;i<n;i++){
    c.count++;
    if(!c.sr && c.count>=GACHA_SR_CATALOG_AT){ c.sr=true; addCatalog('sr',1); granted.push('sr'); }
    if(!c.ssr && c.count>=GACHA_SSR_CATALOG_AT){ addCatalog('ssr',1); granted.push('ssr'); c.count=0; c.sr=false; c.ssr=false; }
  }
  saveGachaCount(c);
  return granted;
}
// ===== スキンガチャ実装記念ポップアップ =====
// このバージョン以降にログインしたアカウントに一度だけ、ダイヤ500個付与+誘導ポップアップ
const SKIN_PROMO_KEY = 'aramon_promo_skingacha_v1';       // 受け取り済み(アカウント同期)
const SKIN_PROMO_PENDING_KEY = 'aramon_promo_pending_v1'; // 未確認=表示中(端末ローカル。SW自動リロードをまたいで残す)
const SKIN_PROMO_DIA = 500;
function showSkinPromoPopup(){
  const el = document.getElementById('skinPromoOverlay');
  if(el) el.classList.remove('hidden');
}
function dismissSkinPromoPopup(){
  try{ localStorage.removeItem(SKIN_PROMO_PENDING_KEY); }catch(e){}
  const el = document.getElementById('skinPromoOverlay');
  if(el) el.classList.add('hidden');
}
// 確認用: おりょうのアカウントは端末ごとに一度だけ記念フラグをリセットして再表示させる
function promoOryouResetIfNeeded(name){
  if(name !== 'おりょう') return;
  if(localStorage.getItem('aramon_promo_oryou_reset_v1')==='1') return;
  try{
    localStorage.setItem('aramon_promo_oryou_reset_v1','1');
    localStorage.removeItem(SKIN_PROMO_KEY); // 受け取り済みフラグを消す→再び付与+表示される
  }catch(e){}
}
function openGachaScreen(){
  updateGachaWallet();
  document.getElementById('gachaSingleCost').textContent = `💎 ${GACHA_COST_DIA_SINGLE}`;
  document.getElementById('gachaTenCost').textContent = `💎 ${GACHA_COST_DIA_TEN}`;
  document.getElementById('gachaResult').classList.add('hidden');
  document.getElementById('gachaRatesModal').classList.add('hidden');
  document.getElementById('gachaCatalogModal').classList.add('hidden');
  document.getElementById('gachaButtons').style.visibility='visible';
  updateGachaCounterUI();
  document.getElementById('gachaOverlay').classList.remove('hidden');
  gachaAnimStart('idle');
}
function maybeShowSkinGachaPromo(){
  if(!accountState.loggedIn) return;                       // ログイン中のアカウントのみ
  if(localStorage.getItem(SKIN_PROMO_KEY)==='1') return;    // 既に受け取り済みなら出さない
  try{ localStorage.setItem(SKIN_PROMO_KEY,'1'); }catch(e){}
  try{ localStorage.setItem(SKIN_PROMO_PENDING_KEY,'1'); }catch(e){} // ボタンを押すまで表示を維持
  addWallet(0, SKIN_PROMO_DIA);                             // ダイヤ500個付与(saveWalletがsync予約)
  accountMarkDirty();                                       // フラグもサーバーへ同期
  updateAccountBar();
  showSkinPromoPopup();
  pushToast(`スキンガチャ実装記念！ 💎+${SKIN_PROMO_DIA}`);
}
document.getElementById('skinPromoCloseBtn').addEventListener('click', ()=>{
  dismissSkinPromoPopup();
});
document.getElementById('skinPromoGachaBtn').addEventListener('click', ()=>{
  dismissSkinPromoPopup();
  openGachaScreen();
});
// SW自動リロード等で消えても、未確認(保留中)なら起動時に再表示する
if(localStorage.getItem(SKIN_PROMO_PENDING_KEY)==='1') showSkinPromoPopup();

document.getElementById('openGachaBtn').addEventListener('click', openGachaScreen);
document.getElementById('closeGachaBtn').addEventListener('click', ()=>{
  gachaAnimStop();
  document.getElementById('gachaOverlay').classList.add('hidden');
});

// --- ガチャ演出(canvas): 円盤石が回り→光の柱→レアリティ色の球体 ---
const gachaAnim = { raf:null, phase:'idle', t0:0, results:[], count:1, orbs:[], onReveal:null };
function gachaCanvasSize(){
  const cv = document.getElementById('gachaCanvas');
  const f = document.getElementById('gachaField');
  const w = f.clientWidth, h = f.clientHeight;
  if(cv.width!==w) cv.width=w;
  if(cv.height!==h) cv.height=h;
  return { cv, w, h };
}
function gachaAnimStart(phase){
  gachaAnim.phase = phase;
  gachaAnim.t0 = performance.now();
  if(!gachaAnim.raf) gachaAnim.raf = requestAnimationFrame(gachaAnimFrame);
}
function gachaAnimStop(){
  if(gachaAnim.raf){ cancelAnimationFrame(gachaAnim.raf); gachaAnim.raf=null; }
}
function gachaAnimFrame(now){
  const { cv, w, h } = gachaCanvasSize();
  const g = cv.getContext('2d');
  g.clearRect(0,0,w,h);
  const cx=w/2, cy=h*0.46;
  const diskR = Math.min(w,h)*0.20;
  const elapsed = (now - gachaAnim.t0)/1000;
  const topR = gachaAnim.results.length ? gachaAnim.results.reduce((a,r)=>RARITY_RANK[r.rarity]>RARITY_RANK[a]?r.rarity:a,'N') : 'N';
  const drawDisk = (ang, glow, glowColor)=>{
    // 厚みを焼き込んだ立体円盤石を回転描画する(厚みも一緒に回る)。顔の中心=画像中心。
    g.save(); g.translate(cx,cy);
    if(glow>0){ g.shadowBlur=40*glow; g.shadowColor=glowColor||'#fff'; }
    g.rotate(ang);
    if(imgIsReady(summonDiskThickImg)){
      const S = diskR*2.2; // 顔の直径が diskR*2 相当になるよう全体を拡縮
      g.drawImage(summonDiskThickImg, -S/2, -S/2, S, S);
    } else if(imgIsReady(summonDiskImg)){
      g.drawImage(summonDiskImg, -diskR, -diskR*0.62, diskR*2, diskR*1.24); // フォールバック(平ら)
    } else {
      g.beginPath(); g.ellipse(0,0,diskR,diskR*0.62,0,0,Math.PI*2); g.fillStyle='#c98d5a'; g.fill();
    }
    g.restore();
  };
  if(gachaAnim.phase==='idle'){
    // 白く光る円盤石
    const pulse = 0.4+0.3*Math.sin(now/380);
    drawDisk(0, pulse, '#ffffff');
    // 時計回りの回転矢印
    g.save(); g.translate(cx,cy);
    const ar = diskR*1.42, a0 = (now/600)%(Math.PI*2);
    g.strokeStyle='rgba(255,230,150,0.9)'; g.lineWidth=5; g.lineCap='round';
    g.beginPath(); g.arc(0,0,ar, a0, a0+Math.PI*1.4); g.stroke();
    const ae=a0+Math.PI*1.4, ax=Math.cos(ae)*ar, ay=Math.sin(ae)*ar;
    g.translate(ax,ay); g.rotate(ae+Math.PI/2);
    g.fillStyle='rgba(255,230,150,0.95)'; g.beginPath(); g.moveTo(0,-11); g.lineTo(9,6); g.lineTo(-9,6); g.closePath(); g.fill();
    g.restore();
    // 「回せ！」
    g.save(); g.textAlign='center'; g.font=`bold ${Math.round(Math.min(w,h)*0.09)}px 'Rajdhani',sans-serif`;
    g.fillStyle='#fff'; g.shadowBlur=14; g.shadowColor='rgba(255,200,80,0.9)';
    g.fillText('回せ！', cx, cy - diskR*1.9);
    g.restore();
  } else if(gachaAnim.phase==='spin'){
    // 加速回転しながらレアリティ色に光る(回転時間は従来の倍)
    const p = Math.min(1, elapsed/2.4);
    const ang = (elapsed*elapsed)*7;
    drawDisk(ang, 0.5+p, rarityCssColor(topR, now));
    if(elapsed>=2.4){ buildGachaOrbs(w,h,cx,cy,diskR); gachaAnimStart('rain'); }
  } else if(gachaAnim.phase==='rain'){
    // 各レアリティ色の光の柱を1本ずつ順番に落とし、消えると球体が残る
    const n = gachaAnim.orbs.length;
    const stagger = n>1 ? 0.16 : 0;
    const fallDur = 0.42, hold = 0.55;
    drawDisk(12, 0.5, rarityCssColor(topR, now));
    for(let i=0;i<n;i++){
      const o = gachaAnim.orbs[i];
      const local = elapsed - i*stagger;
      if(local < 0) continue;
      const col = rarityCssColor(o.rarity, now + o.seed*90);
      const fallP = Math.min(1, local/fallDur);
      if(fallP < 1){
        // 落ちてくる光の柱(その球体の位置へ)
        const topY = 0, lead = lerp(topY, o.y, fallP), halfW = o.r*1.5;
        g.save(); g.globalCompositeOperation='lighter';
        const grad=g.createLinearGradient(0,topY,0,lead);
        grad.addColorStop(0,'rgba(255,255,255,0)'); grad.addColorStop(0.65,col); grad.addColorStop(1,'#ffffff');
        g.fillStyle=grad; g.globalAlpha=0.9;
        g.beginPath(); g.moveTo(o.x-halfW*0.5,topY); g.lineTo(o.x+halfW*0.5,topY); g.lineTo(o.x+halfW,lead); g.lineTo(o.x-halfW,lead); g.closePath(); g.fill();
        g.restore();
      } else {
        // 柱が消えて球体が残る(出現直後は少し弾む)
        const pop = Math.min(1,(local-fallDur)/0.18);
        const rr = o.r*(0.7+0.3*pop);
        g.save(); g.shadowBlur=26; g.shadowColor=col;
        const rg=g.createRadialGradient(o.x,o.y,rr*0.1,o.x,o.y,rr);
        rg.addColorStop(0,'#ffffff'); rg.addColorStop(0.5,col); rg.addColorStop(1,'rgba(0,0,0,0)');
        g.fillStyle=rg; g.beginPath(); g.arc(o.x,o.y,rr,0,Math.PI*2); g.fill();
        g.restore();
      }
    }
    const total = (n-1)*stagger + fallDur + hold;
    if(elapsed>=total && gachaAnim.onReveal){ const cb=gachaAnim.onReveal; gachaAnim.onReveal=null; cb(); }
  }
  if(gachaAnim.raf) gachaAnim.raf = requestAnimationFrame(gachaAnimFrame);
}
function buildGachaOrbs(w,h,cx,cy,diskR){
  const n = gachaAnim.count;
  gachaAnim.orbs = [];
  if(n===1){
    const r = Math.min(w,h)*0.14;
    gachaAnim.orbs.push({ x:cx, y:cy-diskR*0.1, r, rarity:gachaAnim.results[0].rarity, seed:0 });
  } else {
    // 10連は画面の横幅いっぱいを使い、玉体も大きくする(5列×2行)
    const cols = 5;
    const marginX = w*0.05;
    const cellW = (w - marginX*2) / cols;
    const r = Math.min(cellW*0.44, h*0.15);   // セル幅と高さから大きめの半径を決める
    const rowGap = r*2.3;
    const rows = Math.ceil(n/cols);
    const gridH = (rows-1)*rowGap;
    const y0 = cy - diskR*0.15 - gridH*0.35;
    for(let i=0;i<n;i++){
      const col=i%cols, rowi=Math.floor(i/cols);
      gachaAnim.orbs.push({ x: marginX + cellW*(col+0.5), y: y0 + rowi*rowGap, r, rarity:gachaAnim.results[i].rarity, seed:i });
    }
  }
}

function doGacha(count){
  if(gachaAnim.phase!=='idle') return; // 演出中は無効
  const cost = count===10 ? GACHA_COST_DIA_TEN : GACHA_COST_DIA_SINGLE;
  const w = loadWallet();
  if(w.dia < cost){ pushToast('ダイヤが足りません'); return; }
  w.dia -= cost; saveWallet(w);
  // 抽選
  const results = [];
  for(let i=0;i<count;i++){
    const guaranteed = (count===10 && i===count-1); // 10連の10個目はSR以上確定
    const roll = gachaRollOne(guaranteed);
    let dup = false, diaGain = 0;
    if(roll.kind==='item'){
      addBagItem(roll.key,1);
    } else {
      if(isSkinOwned(roll.skinId)){ dup=true; diaGain=(roll.rarity==='SSR'?DUP_SSR_DIA:DUP_SKIN_DIA); addWallet(0, diaGain); }
      else ownSkin(roll.skinId);
    }
    results.push({ ...roll, dup, diaGain });
  }
  const granted = incrementGachaCount(count);
  gachaAnim.results = results; gachaAnim.count = count;
  // 演出開始
  document.getElementById('gachaButtons').style.visibility='hidden';
  document.getElementById('gachaResult').classList.add('hidden');
  playSe('chupiin');
  setTimeout(()=>playSe('shuwaa'), 2400); // 円盤石の回転(2.4秒)後、光の柱が降り始めるタイミング
  gachaAnim.onReveal = ()=>{
    // SSRが出ていたら、結果一覧の前に虹色の獲得演出を挟む(複数なら順番に)
    const ssrIds = results.filter(r=>r.kind==='skin' && r.rarity==='SSR').map(r=>r.skinId);
    if(ssrIds.length) runSsrRevealsThen(ssrIds, ()=> showGachaResults(results, granted));
    else showGachaResults(results, granted);
  };
  gachaAnimStart('spin');
}
// ===== SSR獲得演出(虹色の全画面リビール) =====
let ssrRevealContinue = null;
function showSsrReveal(skinId, onContinue){
  const ov = document.getElementById('ssrRevealOverlay');
  const m = skinMeta(skinId);
  const url = skinnedIconDataUrl(skinId);
  document.getElementById('ssrRevealIcon').src = url || '';
  document.getElementById('ssrRevealText').textContent = `SSR ${m.name} 獲得！`;
  ov.classList.remove('hidden');
  ov.classList.remove('play'); void ov.offsetWidth; ov.classList.add('play'); // ループアニメーションを再スタート
  // 内蔵の大当たり音声をスキップまでループ再生
  if(typeof startSsrJackpotLoop==='function') startSsrJackpotLoop();
  ssrRevealContinue = ()=>{
    ssrRevealContinue = null;
    if(typeof stopSsrJackpotLoop==='function') stopSsrJackpotLoop();
    ov.classList.add('hidden'); ov.classList.remove('play');
    if(onContinue) onContinue();
  };
}
function runSsrRevealsThen(skinIds, done){
  let i=0;
  const step=()=>{ if(i>=skinIds.length){ done(); return; } showSsrReveal(skinIds[i++], step); };
  step();
}
document.getElementById('ssrRevealSkip').addEventListener('click', (e)=>{ e.stopPropagation(); if(ssrRevealContinue) ssrRevealContinue(); });
document.getElementById('ssrRevealOverlay').addEventListener('click', ()=>{ if(ssrRevealContinue) ssrRevealContinue(); });
function skinCellInner(skinId){
  const url = skinnedIconDataUrl(skinId);
  if(url) return `<img src="${url}" alt="">`;
  const m = skinMeta(skinId);
  return `<span class="gacha-cell-emoji">✨</span>`;
}
function showGachaResults(results, granted){
  const cells = results.map(r=>{
    let inner, rarCls, name, dup='';
    if(r.kind==='item'){
      const it=PLAYER_ITEMS[r.key];
      inner=`<span class="gacha-cell-emoji">${it.icon}</span>`;
      rarCls=r.rarity.toLowerCase(); name=it.name;
    } else {
      const m=skinMeta(r.skinId);
      inner=skinCellInner(r.skinId);
      rarCls=r.rarity.toLowerCase(); name=m.name;
      if(r.dup) dup=`<span class="gacha-dup-dia">💎${r.diaGain}</span>`;
    }
    const skinAttr = r.kind==='skin' ? ` data-skin="${r.skinId}"` : '';
    return `<div class="gacha-cell ${rarCls}"${skinAttr}>
      <span class="gacha-rar-tag rar-${r.rarity}">${r.rarity}</span>${dup}
      ${inner}<span class="gacha-cell-name">${name}</span></div>`;
  }).join('');
  const cols = results.length>1 ? 5 : 1;
  let grantMsg='';
  if(granted.includes('sr')) grantMsg += `<div class="rar-SR" style="font-weight:700;">SRスキンカタログを獲得！</div>`;
  if(granted.includes('ssr')) grantMsg += `<div class="rar-SSR" style="font-weight:700;">SSRスキンカタログを獲得！</div>`;
  const res = document.getElementById('gachaResult');
  res.innerHTML = `<div class="gacha-result-grid" style="grid-template-columns:repeat(${cols},1fr)">${cells}</div>
    ${grantMsg}<div class="gacha-result-tap">タップで閉じる</div>`;
  res.classList.remove('hidden');
  playSe('jakiin');
  updateGachaWallet(); updateAccountBar(); updateGachaCounterUI();
  // スキンのセルをタップしたら正面/後ろ姿のプレビューを開く(結果を閉じない)
  res.querySelectorAll('.gacha-cell[data-skin]').forEach(cell=>{
    cell.addEventListener('click', (e)=>{ e.stopPropagation(); showSkinPreview(cell.dataset.skin); });
  });
  res.onclick = ()=>{
    res.classList.add('hidden'); res.onclick=null;
    document.getElementById('gachaButtons').style.visibility='visible';
    gachaAnim.results=[]; gachaAnim.orbs=[];
    gachaAnimStart('idle');
  };
}
document.getElementById('gachaSingleBtn').addEventListener('click', ()=>doGacha(1));
document.getElementById('gachaTenBtn').addEventListener('click', ()=>doGacha(10));

// --- 提供割合モーダル ---
document.getElementById('gachaRatesBtn').addEventListener('click', ()=>{
  const rows = gachaRateTable();
  const fmt = p=>{ const r=Math.round(p); if(Math.abs(p-r)<0.005) return r+'%'; return (p>=1? p.toFixed(1): p.toFixed(2))+'%'; };
  const html = rows.map(row=>{
    const R = RARITIES[row.rarity];
    const items = row.items.map(it=>`<div class="gacha-rate-item"><span>${it.label}</span><span class="pct">${fmt(it.pct)}</span></div>`).join('');
    return `<div class="gacha-rate-rar"><span class="rar-${row.rarity}">${R.label}</span><span style="font-size:11px;color:var(--ink-dim)">${R.jp}</span><span class="pct">${R.rate}%</span></div>${items}`;
  }).join('');
  const note = `<div class="gacha-rate-note">10連ガチャの10連目はSR以上確定(SR ${GUARANTEED_SLOT_RATES.SR}% / SSR ${GUARANTEED_SLOT_RATES.SSR}%)</div>`;
  document.getElementById('gachaRatesBody').innerHTML = html + note;
  document.getElementById('gachaRatesModal').classList.remove('hidden');
});
document.getElementById('gachaRatesCloseBtn').addEventListener('click', ()=>{
  document.getElementById('gachaRatesModal').classList.add('hidden');
});

// --- スキンカタログ選択モーダル ---
let catalogPick = null, catalogKind = null;
function openCatalogModal(kind){
  catalogKind = kind; catalogPick = null;
  document.getElementById('gachaCatalogTitle').textContent = kind==='ssr' ? 'SSR/SRスキンを選ぶ' : 'SRスキン(色違い)を選ぶ';
  // SSRカタログではSSRスキンに加えてSRスキン(色違い)も選べるようにする
  const ids = kind==='ssr' ? [...gachaSsrSkinIds(), ...allColorSkinIds()] : allColorSkinIds();
  const grid = document.getElementById('gachaCatalogGrid');
  grid.innerHTML = ids.map(id=>{
    const m = skinMeta(id); const owned = isSkinOwned(id);
    const url = skinnedIconDataUrl(id);
    const img = url ? `<img src="${url}" alt="">` : `<span class="gacha-cell-emoji">✨</span>`;
    return `<div class="gacha-cat-cell ${owned?'owned':''}" data-id="${id}">
      ${img}<span class="cat-name">${m.name}</span>${owned?'<span class="cat-owned-tag">所持</span>':''}</div>`;
  }).join('');
  grid.querySelectorAll('.gacha-cat-cell').forEach(cell=>{
    const id = cell.dataset.id;
    const owned = cell.classList.contains('owned');
    cell.addEventListener('click', ()=>{
      // タップで正面/後ろ姿のプレビューを表示。未所持なら「このスキンを選ぶ」ボタンで選択できる
      showSkinPreview(id, owned ? {} : { selectable:true, onSelect:()=>{
        grid.querySelectorAll('.gacha-cat-cell').forEach(c=>c.classList.remove('selected'));
        cell.classList.add('selected'); catalogPick = id;
        document.getElementById('gachaCatalogConfirmBtn').disabled = false;
      }});
    });
  });
  document.getElementById('gachaCatalogConfirmBtn').disabled = true;
  document.getElementById('gachaCatalogModal').classList.remove('hidden');
}
document.getElementById('gachaCatalogCancelBtn').addEventListener('click', ()=>{
  document.getElementById('gachaCatalogModal').classList.add('hidden');
});
document.getElementById('gachaCatalogConfirmBtn').addEventListener('click', ()=>{
  if(!catalogPick || !catalogKind) return;
  const cats = loadCatalogs();
  if((cats[catalogKind]||0) <= 0){ pushToast('カタログがありません'); return; }
  const pickedId = catalogPick;
  const meta = skinMeta(pickedId);
  ownSkin(pickedId);
  cats[catalogKind] -= 1; saveCatalogs(cats);
  document.getElementById('gachaCatalogModal').classList.add('hidden');
  updateGachaCounterUI();
  if(meta.rarity==='SSR'){
    // SSRを選んだ時も虹色の獲得演出を出す
    showSsrReveal(pickedId, ()=> pushToast(`${meta.name} を獲得！`));
  } else {
    playSe('pickup');
    pushToast(`${meta.name} を獲得！`);
  }
});

// ===== ショップ(ゴールドでアイテム購入) =====
function renderShop(){
  const w = loadWallet();
  document.getElementById('shopGold').textContent = `🪙 ${w.gold}`;
  const bag = loadBag();
  const listEl = document.getElementById('shopList');
  listEl.innerHTML = SHOP_ITEMS.map(([k, price])=>{
    const it = PLAYER_ITEMS[k];
    const owned = bag[k] || 0;
    return `
    <div class="bag-item">
      <span class="bag-item-icon">${it.icon}</span>
      <span class="bag-item-text">
        <span class="bag-item-name">${it.name}</span>
        <span class="bag-item-desc">${playerItemDesc(k)}</span>
        <span class="shop-item-owned">所持数 ${owned}</span>
      </span>
      <button class="bag-use-btn shop-buy-btn" data-key="${k}" data-price="${price}" ${w.gold<price?'disabled':''}>🪙${price}</button>
    </div>`;
  }).join('');
  listEl.querySelectorAll('.shop-buy-btn').forEach(b=>{
    b.addEventListener('click', ()=>buyShopItem(b.dataset.key, +b.dataset.price));
  });
}
function buyShopItem(itemKey, price){
  const w = loadWallet();
  if(w.gold < price){ pushToast('ゴールドが足りません'); return; }
  w.gold -= price;
  saveWallet(w);
  addBagItem(itemKey, 1);
  playSe('pickup');
  pushToast(`${PLAYER_ITEMS[itemKey].name} を購入した！`);
  renderShop();
  updateAccountBar();
}
// 管理者画面: 動作確認用のダイヤ付与(この端末のウォレットに加算→ログイン中なら自動同期)
document.getElementById('adminGrantDiaBtn').addEventListener('click', ()=>{
  addWallet(0, 500);
  updateAccountBar();
  pushToast('💎 ダイヤを500個付与しました');
});
document.getElementById('openShopBtn').addEventListener('click', ()=>{
  renderShop();
  document.getElementById('shopOverlay').classList.remove('hidden');
});
document.getElementById('closeShopBtn').addEventListener('click', ()=>{
  document.getElementById('shopOverlay').classList.add('hidden');
});
updateAccountBar();
if(typeof dailyCheckLogin==='function') dailyCheckLogin(); // 起動時にログインボーナス＆ミッション更新
if(typeof updateSeasonBadge==='function') updateSeasonBadge(); // シーズンの受取可能ドット

document.getElementById('howToPlayBtn').addEventListener('click', ()=>{
  document.getElementById('howToPlayScreen').classList.remove('hidden');
  document.getElementById('startScreen').classList.add('hidden');
});
document.getElementById('closeHowToPlayBtn').addEventListener('click', ()=>{
  document.getElementById('howToPlayScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
});

const PLAYER_NAME_KEY = 'aramon_player_name_v1';
(function restorePlayerName(){
  try{
    const saved = localStorage.getItem(PLAYER_NAME_KEY);
    if(saved) document.getElementById('playerNameInput').value = saved;
  }catch(err){}
})();
document.getElementById('playerNameInput').addEventListener('input', (e)=>{
  try{ localStorage.setItem(PLAYER_NAME_KEY, e.target.value); }catch(err){}
  accountMarkDirty();
});

const INVERT_PITCH_KEY = 'aramon_invert_pitch_v1';
let invertPitchY = false;
(function restoreInvertPitch(){
  try{ invertPitchY = localStorage.getItem(INVERT_PITCH_KEY) === '1'; }catch(err){}
  document.getElementById('invertPitchToggle').setAttribute('aria-checked', invertPitchY ? 'true' : 'false');
})();
document.getElementById('invertPitchToggle').addEventListener('click', ()=>{
  invertPitchY = !invertPitchY;
  document.getElementById('invertPitchToggle').setAttribute('aria-checked', invertPitchY ? 'true' : 'false');
  try{ localStorage.setItem(INVERT_PITCH_KEY, invertPitchY ? '1' : '0'); }catch(err){}
});

/* =====================================================================
   MULTIPLAYER STATE
===================================================================== */
const netState = {
  mode:'solo', capacity:3, roomId:null, isHost:false, myPlayerId:null, hostId:null,
  humanPlayers:{}, lobbyPollTimer:null, matchStarting:false, cancelled:false,
};
let hostSpectating = false;
let matchBeginning = false; // beginMultiplayerMatchの多重起動防止フラグ

document.querySelectorAll('.mode-tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.mode-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    netState.mode = tab.dataset.mode==='multi' ? 'multi' : 'solo';
    document.getElementById('multiOptions').classList.toggle('hidden', netState.mode!=='multi');
    document.getElementById('joinBtn').classList.toggle('hidden', netState.mode==='multi');
  });
});
// game.selectedMap が 'random' の場合は実在マップからランダムに1つ選ぶ
function resolveMapKey(){
  if(game.selectedMap && game.selectedMap!=='random' && MAPS[game.selectedMap]) return game.selectedMap;
  const keys = Object.keys(MAPS);
  return keys[Math.floor(Math.random()*keys.length)];
}
function updateMapPreview(){
  const imgEl = document.getElementById('mapPreviewImage');
  const iconEl = document.getElementById('mapPreviewIcon');
  const nameEl = document.getElementById('mapPreviewName');
  const descEl = document.getElementById('mapPreviewDesc');
  if(!imgEl) return;
  if(game.selectedMap==='random'){
    imgEl.style.background = 'linear-gradient(135deg, #4a3a6a, #1a1030)';
    iconEl.textContent = '🎲';
    nameEl.textContent = 'ランダム';
    descEl.textContent = '全てのマップからランダムで選ばれる。ドキドキ';
    return;
  }
  const map = MAPS[game.selectedMap] || MAPS.wild;
  const colors = map.previewColors || [map.groundColor||'#333', map.groundColor||'#111'];
  imgEl.style.background = `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`;
  iconEl.textContent = map.previewIcon || '🗺️';
  nameEl.textContent = map.label;
  descEl.textContent = map.desc || '';
}
document.querySelectorAll('.map-tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.map-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    const key = tab.dataset.map;
    game.selectedMap = (key==='random' || MAPS[key]) ? key : 'wild';
    updateMapPreview();
  });
});
updateMapPreview();
document.querySelectorAll('.cap-tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.cap-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    netState.capacity = Number(tab.dataset.cap)||3;
  });
});

function renderLobbyPlayerList(){
  const listEl = document.getElementById('lobbyPlayerList');
  const rows = [];
  const human = netState.humanPlayers || {};
  const humanIds = Object.keys(human);
  humanIds.forEach(id=>{
    const p = human[id];
    const hostTag = id===netState.hostId ? '（ホスト）' : '';
    rows.push(`<div class="lobby-player-row"><span class="lp-dot"></span><span>${p.name||'名無しのモンスター'}${hostTag}（${ELEMENTS[p.element]?.label||'?'}）${id===netState.myPlayerId?'（あなた）':''}</span></div>`);
  });
  const botCount = Math.max(0, netState.capacity - humanIds.length);
  for(let i=0;i<botCount;i++){
    rows.push(`<div class="lobby-player-row is-bot"><span class="lp-dot"></span><span>Bot 待機枠</span></div>`);
  }
  listEl.innerHTML = rows.join('');
  document.getElementById('lobbySubText').textContent = `${humanIds.length} / ${netState.capacity} 人が参加中`;
}

// ホストが「スタート」を押した後の3秒カウントダウンの状態。
// hostCountdownSnapshotが非nullの間は「カウント中」を意味し、この間に参加者が
// 減った場合はcancelHostCountdown()で開始を取り消す。
let hostCountdownTimer = null;
let hostCountdownSnapshot = null;
let guestCountdownTimer = null;

function showLobbyButtonsForRole(){
  document.getElementById('lobbyCancelBtn').classList.add('hidden');
  document.getElementById('lobbyHostBtnRow').classList.toggle('hidden', !netState.isHost);
  document.getElementById('lobbyGuestLeaveBtn').classList.toggle('hidden', !!netState.isHost);
}

function resetLobbyCountdownDisplay(){
  document.getElementById('lobbyCountdown').textContent='';
  if(guestCountdownTimer){ clearInterval(guestCountdownTimer); guestCountdownTimer=null; }
}

function startLobbyCountdownDisplay(startAt){
  resetLobbyCountdownDisplay();
  const tick = ()=>{
    const remain = Math.max(0, Math.ceil((startAt-Date.now())/1000));
    document.getElementById('lobbyCountdown').textContent = remain>0 ? `まもなく開始… ${remain}` : 'まもなく開始…';
  };
  tick();
  guestCountdownTimer = setInterval(tick, 250);
}

function cancelHostCountdown(reason){
  if(hostCountdownTimer){ clearTimeout(hostCountdownTimer); hostCountdownTimer=null; }
  hostCountdownSnapshot = null;
  resetLobbyCountdownDisplay();
  document.getElementById('lobbySubText').textContent='他のプレイヤーを待っています。準備ができたら「スタート」を押してください';
  if(netState.roomId) window.__aramonCancelRoomStarting(netState.roomId);
  if(reason) pushToast(reason);
}

async function handleRoomDisbanded(){
  matchBeginning = false;
  resetLobbyCountdownDisplay();
  document.getElementById('lobbyScreen').classList.add('hidden');
  pushToast('ホストが部屋を解散しました');
  joinInProgress = false;
  updatePlayButtonsEnabled();
  await openFindRoomScreen();
}

function enterLobbyForRoom(){
  document.getElementById('lobbyScreen').classList.remove('hidden');
  resetLobbyCountdownDisplay();
  document.getElementById('lobbyPlayerList').innerHTML='';
  hostCountdownTimer=null; hostCountdownSnapshot=null;
  showLobbyButtonsForRole();

  window.__aramonWatchRoomPlayers(netState.roomId, (players)=>{
    netState.humanPlayers = players||{};
    renderLobbyPlayerList();
    // ホストのスタートカウント中に参加者が抜けた場合は開始をキャンセルする
    if(netState.isHost && hostCountdownSnapshot){
      const stillHere = hostCountdownSnapshot.every(id => players && players[id]);
      if(!stillHere) cancelHostCountdown('参加者が退出したため開始をキャンセルしました');
    }
  });

  if(netState.isHost){
    document.getElementById('lobbySubText').textContent='他のプレイヤーを待っています。準備ができたら「スタート」を押してください';
  } else {
    document.getElementById('lobbySubText').textContent='ホストが試合を開始するのを待っています…';
    window.__aramonWatchRoomMeta(netState.roomId, (meta)=>{
      if(!meta){
        if(!game.started && !matchBeginning) handleRoomDisbanded();
        return;
      }
      if(meta.hostId){ netState.hostId = meta.hostId; renderLobbyPlayerList(); }
      if(typeof meta.capacity==='number'){ netState.capacity = meta.capacity; }
      if(meta.status==='starting' && meta.startAt && !matchBeginning){
        startLobbyCountdownDisplay(meta.startAt);
      } else if(meta.status==='waiting'){
        resetLobbyCountdownDisplay();
        document.getElementById('lobbySubText').textContent='ホストが試合を開始するのを待っています…';
      } else if(meta.status==='playing' && !game.started && !matchBeginning){
        beginMultiplayerMatch();
      }
    });
  }
}

function getDisplayNameFromInput(){
  const rawName = (document.getElementById('playerNameInput').value||'').trim();
  return rawName ? rawName.slice(0,12) : '名無しのモンスター';
}

// マスモンで参戦する場合、そのレベルを部屋の自分のプレイヤー情報に載せる
// (倒した相手がレベルに応じたEXPボーナスを得るために使う)
function currentMastermonLevel(){
  if(!game.selectedMastermonKey) return null;
  const mm = loadMastermons()[game.selectedMastermonKey];
  return mm ? (mm.level||1) : null;
}
// 今参戦するモンスターに装備中のスキンID(マルチプレイで相手にも見せるため送る)
function currentEquippedSkinId(){
  if(!game.selectedElement || typeof getEquippedSkin!=='function') return null;
  return getEquippedSkin(game.selectedElement) || null;
}
async function createRoomFlow(){
  if(!window.__aramonCreateRoom){
    pushToast('通信機能が利用できません。1人でプレイに切り替えます');
    startGame();
    return;
  }
  netState.cancelled = false;
  matchBeginning = false;
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('lobbySubText').textContent='部屋を作成中…';
  document.getElementById('lobbyScreen').classList.remove('hidden');
  document.getElementById('lobbyPlayerList').innerHTML='';
  document.getElementById('lobbyCountdown').textContent='';
  document.getElementById('lobbyHostBtnRow').classList.add('hidden');
  document.getElementById('lobbyGuestLeaveBtn').classList.add('hidden');
  document.getElementById('lobbyCancelBtn').classList.remove('hidden');

  const displayName = getDisplayNameFromInput();
  let result;
  try{
    result = await window.__aramonCreateRoom(netState.capacity, displayName, game.selectedElement, currentMastermonLevel(), currentEquippedSkinId());
  }catch(err){
    console.error(err);
    pushToast('部屋の作成に失敗しました。1人でプレイに切り替えます');
    document.getElementById('lobbyScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
    startGame();
    return;
  }
  if(netState.cancelled) return;

  netState.roomId = result.roomId;
  netState.isHost = true;
  netState.myPlayerId = result.myPlayerId;
  netState.hostId = netState.myPlayerId;

  enterLobbyForRoom();
}

async function openFindRoomScreen(){
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('roomListScreen').classList.remove('hidden');
  await refreshRoomList();
}
async function refreshRoomList(){
  const listEl = document.getElementById('roomListItems');
  const subEl = document.getElementById('roomListSubText');
  subEl.textContent = '募集中の部屋を検索中…';
  listEl.innerHTML = '<div class="rank-empty">検索中…</div>';
  if(!window.__aramonListOpenRooms){
    listEl.innerHTML = '<div class="rank-empty">通信機能が利用できません</div>';
    subEl.textContent = '';
    return;
  }
  const rooms = await window.__aramonListOpenRooms();
  if(!rooms.length){
    listEl.innerHTML = '<div class="rank-empty">現在募集中の部屋はありません</div>';
    subEl.textContent = '部屋が見つかりませんでした';
    return;
  }
  subEl.textContent = `${rooms.length}件の部屋が見つかりました`;
  listEl.innerHTML = rooms.map(r=>`
    <div class="room-row" data-room-id="${r.roomId}" data-lobby-key="${r.lobbyKey}">
      <div>
        <div class="rm-host">${r.hostName}の部屋</div>
        <div class="rm-sub">定員 ${r.capacity}人</div>
      </div>
      <div class="rm-count">${r.count} / ${r.capacity}</div>
    </div>
  `).join('');
  listEl.querySelectorAll('.room-row').forEach(row=>{
    row.addEventListener('click', ()=>joinSelectedRoom(row.dataset.roomId, row.dataset.lobbyKey));
  });
}
async function joinSelectedRoom(roomId, lobbyKey){
  if(!window.__aramonJoinRoom){
    pushToast('通信機能が利用できません');
    return;
  }
  const displayName = getDisplayNameFromInput();
  const result = await window.__aramonJoinRoom(roomId, lobbyKey, displayName, game.selectedElement, currentMastermonLevel(), currentEquippedSkinId());
  if(!result.ok){
    pushToast(result.reason||'参加に失敗しました');
    await refreshRoomList();
    return;
  }
  netState.cancelled = false;
  matchBeginning = false;
  netState.roomId = result.roomId;
  netState.isHost = false;
  netState.myPlayerId = result.myPlayerId;
  if(result.capacity) netState.capacity = result.capacity;

  document.getElementById('roomListScreen').classList.add('hidden');
  document.getElementById('lobbySubText').textContent='ホストが試合を開始するのを待っています…';
  enterLobbyForRoom();
}

async function startMatchmaking(){
  if(!window.__aramonFindOrCreateRoom){
    pushToast('通信機能が利用できません。1人でプレイに切り替えます');
    startGame();
    return;
  }
  netState.cancelled = false;
  matchBeginning = false;
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('lobbyScreen').classList.remove('hidden');
  document.getElementById('lobbyCountdown').textContent='';
  document.getElementById('lobbySubText').textContent='部屋を検索中…';
  document.getElementById('lobbyPlayerList').innerHTML='';

  const rawName = (document.getElementById('playerNameInput').value||'').trim();
  const displayName = rawName ? rawName.slice(0,12) : '名無しのモンスター';

  let result;
  try{
    result = await window.__aramonFindOrCreateRoom(netState.capacity, displayName, game.selectedElement, currentEquippedSkinId());
  }catch(err){
    console.error(err);
    pushToast('マッチング失敗。1人でプレイに切り替えます');
    document.getElementById('lobbyScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
    startGame();
    return;
  }
  if(netState.cancelled) return;

  netState.roomId = result.roomId;
  netState.isHost = result.isHost;
  netState.myPlayerId = result.myPlayerId;
  if(netState.isHost) netState.hostId = netState.myPlayerId;

  enterLobbyForRoom();
}

document.getElementById('lobbyStartBtn').addEventListener('click', async ()=>{
  if(hostCountdownSnapshot) return; // カウント中の多重押下防止
  hostCountdownSnapshot = Object.keys(netState.humanPlayers||{});
  const startAt = Date.now() + 3000;
  netState.matchStarting = false;
  await window.__aramonSetRoomStarting(netState.roomId, startAt);
  startLobbyCountdownDisplay(startAt);
  hostCountdownTimer = setTimeout(async ()=>{
    hostCountdownTimer = null;
    if(!hostCountdownSnapshot) return; // 途中でキャンセル済み
    hostCountdownSnapshot = null;
    netState.matchStarting = true;
    await window.__aramonSetRoomStatus(netState.roomId, 'playing');
    window.__aramonCleanupLobbyEntry();
    beginMultiplayerMatch();
  }, 3000);
});

document.getElementById('lobbyDisbandBtn').addEventListener('click', async ()=>{
  if(hostCountdownTimer){ clearTimeout(hostCountdownTimer); hostCountdownTimer=null; }
  hostCountdownSnapshot = null;
  resetLobbyCountdownDisplay();
  const roomId = netState.roomId;
  const lobbyEntryId = window.__aramonLobbyEntryId;
  document.getElementById('lobbyScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
  joinInProgress = false;
  updatePlayButtonsEnabled();
  netState.roomId=null; netState.isHost=false; netState.humanPlayers={}; netState.hostId=null;
  matchBeginning = false;
  if(roomId){
    await window.__aramonLeaveRoom(roomId); // 自分のリスナー解除+players登録解除
    await window.__aramonDisbandRoom(roomId, lobbyEntryId); // 部屋自体を削除
  }
});

document.getElementById('lobbyGuestLeaveBtn').addEventListener('click', async ()=>{
  netState.cancelled = true;
  resetLobbyCountdownDisplay();
  joinInProgress = false;
  updatePlayButtonsEnabled();
  if(netState.roomId) await window.__aramonLeaveRoom(netState.roomId);
  document.getElementById('lobbyScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
});

document.getElementById('lobbyCancelBtn').addEventListener('click', async ()=>{
  netState.cancelled = true;
  joinInProgress = false;
  updatePlayButtonsEnabled();
  if(netState.roomId){
    await window.__aramonLeaveRoom(netState.roomId);
    await window.__aramonCleanupLobbyEntry();
  }
  document.getElementById('lobbyScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
});

function startGame(){
  entities=[]; projectiles=[]; lootItems=[]; particles=[]; areaEffects=[]; nextId=1;
  matchTime=0; game.over=false; game.tipTimer=7; lastGutsWarnAt=-Infinity;
  camState.yaw = 0; camState.pitch = 0.27;
  camSnap.active = false;
  monsterScreenPos.clear();
  Object.keys(keys).forEach(k=>keys[k]=false);
  fireBtnHeld=false; joystick.active=false; joystick.nx=0; joystick.ny=0;
  if(typeof setAutoRun==='function') setAutoRun(false); // 試合開始時はオートラン解除
  joyKnobEl.style.transform='translate(0,0)';
  game.activeMapKey = resolveMapKey();   // 'ランダム'選択時はここで実マップを確定
  currentMap = MAPS[game.activeMapKey] || MAPS.wild;
  applyWorldScale(1);
  initZone();
  genVolcanoAndLava();
  genWater();
  genOasisZones();
  genRocks();
  genCrystals();
  genTerrain();

  let playerDisplayName = 'プレイヤー';
  if(game.selectedMastermonKey){
    const mmData = loadMastermons()[game.selectedMastermonKey];
    if(mmData) playerDisplayName = mmData.name;
  }
  const totalEntityCount = 30;
  const spawnPoints = pickSpawnPointsBatch(totalEntityCount);
  player = createMonster(game.selectedElement, true, playerDisplayName, { spawnPoint: spawnPoints[0] });
  applyMastermonToPlayer();
  entities.push(player);
  const names = shuffle(BOT_NAMES);
  const botElements = shuffle(Object.keys(ELEMENTS));
  for(let i=0;i<29;i++){
    const elKey = botElements[i % botElements.length];
    entities.push(createMonster(elKey, false, names[i % names.length]+ (i>=names.length?'Ⅱ':''), { spawnPoint: spawnPoints[i+1] }));
  }
  spawnLoot(420, ZONE_CENTER0, ZONE_PHASES[0].holdRadius*0.95);
  spawnOasisBonusLoot();
  updateCamera();

  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('resultScreen').classList.add('hidden');
  game.started=true;
  beginSummonIntro();   // 5秒の召喚演出 → 演出後に本戦開始(バトル開始SE/BGM)
}
let joinInProgress = false;
// モンスター(またはマスモン)が選択されていない状態では、ソロの「バトルに参加する」だけでなく
// マルチプレイの「部屋を作る」「部屋を探す」もクリックできないようにする
// (未選択のままマルチプレイに入れてしまう不具合の修正)
function updatePlayButtonsEnabled(){
  const enabled = !!game.selectedElement;
  document.getElementById('joinBtn').disabled = !enabled;
  document.getElementById('createRoomBtn').disabled = !enabled;
  document.getElementById('findRoomBtn').disabled = !enabled;
  document.getElementById('pickMonsterNotice').classList.toggle('hidden', enabled);
}
document.getElementById('joinBtn').addEventListener('click', ()=>{
  if(joinInProgress) return;
  joinInProgress = true;
  document.getElementById('joinBtn').disabled = true;
  requestFullscreenSafe();
  requestOrientationLockSafe();
  startGame();
});
document.getElementById('createRoomBtn').addEventListener('click', ()=>{
  if(joinInProgress) return;
  if(!game.selectedElement){ pushToast('先にモンスターを選択してください'); return; }
  joinInProgress = true;
  requestFullscreenSafe();
  requestOrientationLockSafe();
  createRoomFlow();
});
document.getElementById('findRoomBtn').addEventListener('click', ()=>{
  if(joinInProgress) return;
  if(!game.selectedElement){ pushToast('先にモンスターを選択してください'); return; }
  joinInProgress = true;
  requestFullscreenSafe();
  requestOrientationLockSafe();
  openFindRoomScreen();
});
document.getElementById('roomListRefreshBtn').addEventListener('click', ()=>{ refreshRoomList(); });
document.getElementById('roomListCancelBtn').addEventListener('click', ()=>{
  joinInProgress = false;
  document.getElementById('roomListScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
});

function showResult(isWin, placement){
  if(game.over) return;
  game.over=true;
  game.started=false;
  joinInProgress = false;
  if(typeof setAutoRun==='function') setAutoRun(false); // 試合終了でオートラン解除
  // リザルトSE(勝利=ファンファーレ/それ以外=悲しげ)を鳴らし、鳴り終わってから通常BGMへ
  bgmSetTrack(null);
  playSe(isWin ? 'fanfare' : 'sad');
  setTimeout(()=>{ if(!game.started) bgmSetTrack('title'); }, isWin ? 3800 : 3000);
  document.getElementById('resultScreen').className = 'resultScreen ' + (isWin?'win':'lose');
  document.getElementById('resultRank').textContent = isWin ? '👑 WINNER' : ('#'+placement);
  document.getElementById('resultSub').textContent = isWin ? '生き残った！今夜はモン勝ちだ！' : '撃破された';
  document.getElementById('statKills').textContent = player.kills;
  document.getElementById('statDamage').textContent = Math.round(player.damageDealt);
  document.getElementById('statTime').textContent = fmtTime(player.deathAt||matchTime);
  // ゴールド/ダイヤ報酬(経験値と一緒に入手。game.overガードにより1試合1回だけ)
  {
    const isMultiMatch = netState.mode==='multi';
    const goldGain = Math.round((GOLD_MATCH_BASE + player.kills*GOLD_PER_KILL + (isWin?GOLD_CHAMPION_BONUS:0)) * (isMultiMatch?GOLD_MULTI_MULT:1));
    const diaGain = DIA_MATCH_BASE + (isWin?DIA_CHAMPION_BONUS:0);
    addWallet(goldGain, diaGain);
    document.getElementById('resultCurrencyLine').textContent = `報酬　🪙 +${goldGain}　💎 +${diaGain}`;
    updateAccountBar();
  }
  const iconEl = document.getElementById('resultMonsterIcon');
  if(iconEl){
    const el = ELEMENTS[player.element];
    iconEl.alt = el ? el.label : '';
    iconEl.style.display = '';
    // 装備中スキンがあればそのアイコンを反映する
    const sk = (typeof getEquippedSkin==='function') ? getEquippedSkin(player.element) : null;
    const skUrl = sk && (typeof skinnedIconDataUrl==='function') ? skinnedIconDataUrl(sk) : null;
    if(skUrl){
      iconEl.dataset.variant = 'skin';
      iconEl.src = skUrl;
    } else {
      iconEl.dataset.variant = 'normal';
      iconEl.dataset.extIdx = '0';
      iconEl.dataset.basePath = `monsters/${player.element}`;
      iconEl.src = imgSrcFor(iconEl.dataset.basePath);
    }
  }
  document.getElementById('resultScreen').classList.remove('hidden');
  // 自己ベスト更新の検出用に、記録前のベストを控えておく
  const _preCum = titlesCumulativeStats();
  const _prevBestKills = _preCum.bestKills, _prevBestDamage = _preCum.bestDamage;
  recordMatchResult(player.element, player.kills, Math.round(player.damageDealt), !!isWin, netState.mode==='multi' ? 'multi' : 'solo');
  const _newTitles = (typeof checkTitleUnlocks==='function') ? checkTitleUnlocks() : [];
  if(typeof dailyOnMatchEnd==='function') dailyOnMatchEnd({ kills: player.kills, isWin: !!isWin });
  const _seasonSp = (typeof seasonOnMatchEnd==='function') ? seasonOnMatchEnd({ kills: player.kills, damage: Math.round(player.damageDealt), isWin: !!isWin }) : 0;
  renderResultBadges({
    kills: player.kills, damage: Math.round(player.damageDealt),
    prevBestKills: _prevBestKills, prevBestDamage: _prevBestDamage, newTitles: _newTitles, seasonSp: _seasonSp,
  });
  handleMastermonPostMatch(isWin);
  submitScoreToRanking(isWin, placement);
  logMatchForAdmin();
}
// リザルトの自己ベスト更新バッジ＆獲得称号バッジを描画する
function renderResultBadges(o){
  const el = document.getElementById('resultBadges');
  if(!el) return;
  const badges = [];
  let rainbow = false; // 自己ベスト更新 or 称号獲得(=虹色バッジ)が出たか
  if(o.seasonSp>0) badges.push(`<span class="result-badge season">🎫 シーズン +${o.seasonSp} SP</span>`);
  if(o.kills>0 && o.kills > o.prevBestKills){ badges.push(`<span class="result-badge best">🏆 自己ベスト キル数 ${o.kills}!</span>`); rainbow = true; }
  if(o.damage>0 && o.damage > o.prevBestDamage){ badges.push(`<span class="result-badge best">🏆 自己ベスト ダメージ ${o.damage}!</span>`); rainbow = true; }
  for(const t of (o.newTitles||[])){ badges.push(`<span class="result-badge title">🎖️ 称号獲得「${t.emoji} ${t.name}」</span>`); rainbow = true; }
  el.innerHTML = badges.join('');
  el.classList.toggle('hidden', badges.length===0);
  // 虹色バッジ(自己ベスト更新/称号獲得)が出たら、SSR獲得と同じSEを2回鳴らす
  if(rainbow && typeof playSsrJackpotOnce==='function'){
    playSsrJackpotOnce();
    setTimeout(()=>{ if(typeof playSsrJackpotOnce==='function') playSsrJackpotOnce(); }, 700);
  }
}
function logMatchForAdmin(){
  if(!window.__aramonLogMatch){ console.warn('logMatchForAdmin: __aramonLogMatch not ready, skipped'); return; }
  const rawName = (document.getElementById('playerNameInput').value||'').trim();
  const name = rawName ? rawName.slice(0,12) : '名無しのモンスター';
  const mapKey = (game.activeMapKey && MAPS[game.activeMapKey]) ? game.activeMapKey : (MAPS[game.selectedMap] ? game.selectedMap : 'wild');
  const map = MAPS[mapKey] || MAPS.wild;
  const elementKey = player.element;
  const el = ELEMENTS[elementKey];
  window.__aramonLogMatch({
    name,
    map: mapKey,
    mapLabel: map.label,
    element: elementKey,
    elementLabel: el ? el.label : elementKey,
    mode: netState.mode==='multi' ? 'multi' : 'solo',
    ts: Date.now(),
  });
}
/* =====================================================================
   LOCAL STATS (localStorage)
===================================================================== */
const LOCAL_STATS_KEY = 'aramon_local_stats_v1';
function defaultModeStats(){
  const byElement = {};
  Object.keys(ELEMENTS).forEach(key=>{
    byElement[key] = { bestDamage:0, bestKills:0, matches:0 };
  });
  return {
    totalMatches:0, totalWins:0, totalKills:0, totalDamage:0,
    bestDamage:0, bestKills:0,
    byElement,
  };
}
function defaultLocalStats(){
  return { solo: defaultModeStats(), multi: defaultModeStats() };
}
function loadLocalStats(){
  try{
    const raw = localStorage.getItem(LOCAL_STATS_KEY);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    if(!parsed) return null;
    // 旧フォーマット(ソロ/マルチ分離前)は、これまでの記録をまるごとソロ側へ引き継ぐ形で移行する
    if(!parsed.solo && !parsed.multi && typeof parsed.totalMatches==='number'){
      const migrated = { solo: parsed, multi: defaultModeStats() };
      saveLocalStats(migrated);
      return migrated;
    }
    if(!parsed.solo) parsed.solo = defaultModeStats();
    if(!parsed.multi) parsed.multi = defaultModeStats();
    return parsed;
  }catch(err){ return null; }
}
function saveLocalStats(stats){
  try{ localStorage.setItem(LOCAL_STATS_KEY, JSON.stringify(stats)); }catch(err){}
  accountMarkDirty();
}
function recordMatchResult(elementKey, kills, damage, isWin, mode){
  let stats = loadLocalStats();
  if(!stats) stats = defaultLocalStats();
  const modeKey = mode==='multi' ? 'multi' : 'solo';
  if(!stats[modeKey]) stats[modeKey] = defaultModeStats();
  const ms = stats[modeKey];
  if(!ms.byElement) ms.byElement = {};
  if(!ms.byElement[elementKey]) ms.byElement[elementKey] = { bestDamage:0, bestKills:0, matches:0 };

  ms.totalMatches = (ms.totalMatches||0) + 1;
  ms.totalWins = (ms.totalWins||0) + (isWin?1:0);
  ms.totalKills = (ms.totalKills||0) + kills;
  ms.totalDamage = (ms.totalDamage||0) + damage;
  ms.bestDamage = Math.max(ms.bestDamage||0, damage);
  ms.bestKills = Math.max(ms.bestKills||0, kills);

  const es = ms.byElement[elementKey];
  es.matches = (es.matches||0) + 1;
  es.bestDamage = Math.max(es.bestDamage||0, damage);
  es.bestKills = Math.max(es.bestKills||0, kills);

  saveLocalStats(stats);
  return stats;
}
function computeDerivedStats(stats){
  const deaths = Math.max(0, (stats.totalMatches||0) - (stats.totalWins||0));
  const kd = deaths>0 ? (stats.totalKills||0)/deaths : (stats.totalKills||0);
  const avgDamage = (stats.totalMatches||0)>0 ? (stats.totalDamage||0)/stats.totalMatches : 0;
  return { deaths, kd, avgDamage };
}

/* =====================================================================
   称号(タイトル)の解放判定
===================================================================== */
// solo+multiを合算した通算値と、1試合の自己ベストをまとめる
function titlesCumulativeStats(){
  const s = loadLocalStats() || defaultLocalStats();
  const modes = ['solo','multi'];
  let wins=0, matches=0, kills=0, damage=0, bestKills=0, bestDamage=0;
  const elemPlayed = new Set();
  for(const m of modes){
    const ms = s[m]; if(!ms) continue;
    wins += ms.totalWins||0; matches += ms.totalMatches||0;
    kills += ms.totalKills||0; damage += ms.totalDamage||0;
    bestKills = Math.max(bestKills, ms.bestKills||0);
    bestDamage = Math.max(bestDamage, ms.bestDamage||0);
    const be = ms.byElement||{};
    Object.keys(be).forEach(k=>{ if((be[k].matches||0)>0) elemPlayed.add(k); });
  }
  return { wins, matches, kills, damage, bestKills, bestDamage, elemPlayed };
}
function ownsAnySsr(){
  try{
    const owned = loadSkins().owned || {};
    return Object.keys(owned).some(id=>{ if(!owned[id]) return false; const m=skinMeta(id); return m && m.rarity==='SSR'; });
  }catch(e){ return false; }
}
function titleConditionMet(t, cum){
  switch(t.type){
    case 'matchKills':  return cum.bestKills  >= t.n;
    case 'matchDamage': return cum.bestDamage >= t.n;
    case 'wins':        return cum.wins   >= t.n;
    case 'matches':     return cum.matches >= t.n;
    case 'totalKills':  return cum.kills   >= t.n;
    case 'totalDamage': return cum.damage  >= t.n;
    case 'ssr':         return ownsAnySsr();
    case 'allElem':     return Object.keys(ELEMENTS).every(k=> cum.elemPlayed.has(k));
    default:            return false;
  }
}
// 現在の実績で解放できる称号を解放し、新しく解放したものの配列を返す
function checkTitleUnlocks(){
  if(typeof TITLES==='undefined') return [];
  const cum = titlesCumulativeStats();
  const t = loadTitles();
  const newly = [];
  for(const def of TITLES){
    if(t.unlocked[def.id]) continue;
    if(titleConditionMet(def, cum)){ t.unlocked[def.id] = Date.now(); newly.push(def); }
  }
  if(newly.length){ saveTitles(t); }
  return newly;
}

/* =====================================================================
   デイリー: ログインボーナス＋ミッション
===================================================================== */
function dailyEnsureMissions(d){
  const today = dailyTodayStr();
  if(d.missionDate !== today){
    d.missionDate = today;
    d.missions = {};
    DAILY_MISSIONS.forEach(m=>{ d.missions[m.id] = { progress:0, claimed:false }; });
    return true;
  }
  // 定義追加に備えて欠けているミッションを補完
  DAILY_MISSIONS.forEach(m=>{ if(!d.missions[m.id]) d.missions[m.id] = { progress:0, claimed:false }; });
  return false;
}
// 起動時: 新しい日ならログインボーナス付与＆ミッション更新
function dailyCheckLogin(){
  if(typeof loadDaily!=='function') return;
  const d = loadDaily();
  const today = dailyTodayStr();
  let granted = null;
  if(d.lastLoginDate !== today){
    d.loginDay = ((d.loginDay||0) % 7) + 1; // 1..7でループ
    d.lastLoginDate = today;
    const reward = LOGIN_BONUS[d.loginDay];
    grantReward(reward);
    granted = { day:d.loginDay, reward };
  }
  dailyEnsureMissions(d);
  saveDaily(d);
  if(granted) showLoginBonusPopup(granted);
  updateDailyBadge();
  updateAccountBar();
}
// 試合終了時に呼ぶ: ミッション進捗を加算
function dailyOnMatchEnd(ctx){
  if(typeof loadDaily!=='function') return;
  const d = loadDaily();
  dailyEnsureMissions(d);
  for(const m of DAILY_MISSIONS){
    const st = d.missions[m.id]; if(!st || st.claimed) { /* 受取済でも進捗は進めてよいがcap不要 */ }
    if(!st) continue;
    if(m.track==='play') st.progress += 1;
    else if(m.track==='kill') st.progress += (ctx.kills||0);
    else if(m.track==='win') st.progress += (ctx.isWin?1:0);
  }
  saveDaily(d);
  updateDailyBadge();
}
function showLoginBonusPopup(g){
  const dayEl = document.getElementById('loginBonusDay');
  const rewEl = document.getElementById('loginBonusReward');
  const pop = document.getElementById('loginBonusPopup');
  if(!dayEl || !rewEl || !pop) return;
  dayEl.textContent = `Day ${g.day} / 7`;
  rewEl.textContent = rewardText(g.reward);
  pop.classList.remove('hidden');
}
function updateDailyBadge(){
  const dot = document.getElementById('dailyDot');
  if(!dot || typeof loadDaily!=='function') return;
  const d = loadDaily();
  dailyEnsureMissions(d);
  const claimable = DAILY_MISSIONS.some(m=>{ const st=d.missions[m.id]; return st && st.progress>=m.target && !st.claimed; });
  dot.classList.toggle('hidden', !claimable);
}
function renderDailyLoginTrack(){
  const el = document.getElementById('dailyLoginTrack');
  if(!el) return;
  const d = loadDaily();
  el.innerHTML = [1,2,3,4,5,6,7].map(day=>{
    const isToday = day===d.loginDay;
    const got = day<=(d.loginDay||0); // 今サイクルで受取済み(簡易表示)
    return `<div class="daily-day ${isToday?'today':''} ${got?'got':''}">
      <div class="daily-day-label">Day ${day}</div>
      <div class="daily-day-reward">${rewardText(LOGIN_BONUS[day])}</div>
      ${isToday?'<div class="daily-day-badge">本日</div>':(got?'<div class="daily-day-check">✓</div>':'')}
    </div>`;
  }).join('');
}
function renderDailyMissions(){
  const el = document.getElementById('dailyMissionList');
  if(!el) return;
  const d = loadDaily();
  dailyEnsureMissions(d);
  saveDaily(d);
  el.innerHTML = DAILY_MISSIONS.map(m=>{
    const st = d.missions[m.id] || { progress:0, claimed:false };
    const done = st.progress>=m.target;
    const pct = Math.min(100, Math.round(st.progress/m.target*100));
    let action;
    if(st.claimed) action = `<span class="daily-claimed">受取済</span>`;
    else if(done) action = `<button class="daily-claim-btn" data-m="${m.id}">受け取る</button>`;
    else action = `<span class="daily-progress-num">${Math.min(st.progress,m.target)} / ${m.target}</span>`;
    return `<div class="daily-mission ${done&&!st.claimed?'ready':''}">
      <div class="daily-mission-info">
        <div class="daily-mission-name">${m.name}</div>
        <div class="daily-bar"><div class="daily-bar-fill" style="width:${pct}%"></div></div>
        <div class="daily-mission-reward">報酬 ${rewardText(m.reward)}</div>
      </div>
      <div class="daily-mission-action">${action}</div>
    </div>`;
  }).join('');
  el.querySelectorAll('.daily-claim-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const m = DAILY_MISSIONS.find(x=>x.id===btn.dataset.m);
      const dd = loadDaily();
      const st = dd.missions[m.id];
      if(st && st.progress>=m.target && !st.claimed){
        st.claimed = true;
        grantReward(m.reward);
        saveDaily(dd);
        renderDailyMissions();
        updateDailyBadge();
        updateAccountBar();
        if(typeof pushToast==='function') pushToast(`報酬 ${rewardText(m.reward)} を受け取った！`);
      }
    });
  });
}
document.getElementById('openDailyBtn').addEventListener('click', ()=>{
  renderDailyLoginTrack();
  renderDailyMissions();
  document.getElementById('dailyOverlay').classList.remove('hidden');
});
document.getElementById('closeDailyBtn').addEventListener('click', ()=>{
  document.getElementById('dailyOverlay').classList.add('hidden');
});
document.getElementById('loginBonusOkBtn').addEventListener('click', ()=>{
  document.getElementById('loginBonusPopup').classList.add('hidden');
  updateAccountBar();
});

/* =====================================================================
   シーズンパス
===================================================================== */
// 試合終了時に呼ぶ: SP加算。加算量を返す(リザルト表示用)
function seasonOnMatchEnd(ctx){
  if(typeof loadSeason!=='function') return 0;
  const gain = seasonSpForMatch(ctx.kills, ctx.damage, ctx.isWin);
  const s = loadSeason();
  s.sp += gain;
  saveSeason(s);
  updateSeasonBadge();
  return gain;
}
function updateSeasonBadge(){
  const dot = document.getElementById('seasonDot');
  if(!dot || typeof loadSeason!=='function') return;
  const s = loadSeason();
  const tier = seasonTierForSp(s.sp);
  let claimable = false;
  for(let t=1;t<=tier;t++){ if(!s.claimed[t]){ claimable = true; break; } }
  dot.classList.toggle('hidden', !claimable);
}
function seasonClaim(t){
  const s = loadSeason();
  if(seasonTierForSp(s.sp) >= t && !s.claimed[t]){
    s.claimed[t] = true;
    const reward = SEASON_REWARDS[t-1];
    grantReward(reward);
    saveSeason(s);
    renderSeasonOverlay();
    updateSeasonBadge();
    updateAccountBar();
    // 限定SSRスキンはSSR獲得演出(虹色リビール)を出す
    if(reward && reward.skin && typeof showSsrReveal==='function'){
      showSsrReveal(reward.skin, ()=>{ if(typeof pushToast==='function') pushToast(`${skinMeta(reward.skin).name} を獲得！`); });
    } else if(typeof pushToast==='function'){
      pushToast(`Tier ${t} 報酬 ${rewardText(reward)} を受け取った！`);
    }
  }
}
function renderSeasonOverlay(){
  const s = loadSeason();
  const tier = seasonTierForSp(s.sp);
  const spInTier = s.sp - tier*SEASON_SP_PER_TIER;
  const atMax = tier>=SEASON_MAX_TIER;
  const spEl = document.getElementById('seasonSpText');
  const tierEl = document.getElementById('seasonTierText');
  const barEl = document.getElementById('seasonProgFill');
  const nextEl = document.getElementById('seasonNextText');
  if(spEl) spEl.textContent = `${s.sp} SP`;
  if(tierEl) tierEl.textContent = `Tier ${tier} / ${SEASON_MAX_TIER}`;
  if(barEl) barEl.style.width = (atMax ? 100 : Math.round(spInTier/SEASON_SP_PER_TIER*100)) + '%';
  if(nextEl) nextEl.textContent = atMax ? '最大Tier到達！' : `次のTierまで ${SEASON_SP_PER_TIER - spInTier} SP`;
  const track = document.getElementById('seasonTrack');
  if(track){
    track.innerHTML = SEASON_REWARDS.map((r,i)=>{
      const t = i+1;
      const reached = tier>=t;
      const claimed = !!s.claimed[t];
      const milestone = (t%5===0);
      let action;
      if(claimed) action = `<span class="season-claimed">受取済</span>`;
      else if(reached) action = `<button class="season-claim-btn" data-t="${t}">受け取る</button>`;
      else action = `<span class="season-locked">🔒</span>`;
      // 限定SSRスキン報酬は虹色背景のアイコンで表示(タップで正面/後ろ姿プレビュー)
      const rewardMid = r.skin
        ? `<div class="season-skin-reward" data-skin="${r.skin}"><img class="season-skin-img" src="${skinPreviewSrc(r.skin,'front')}" alt=""><span class="season-skin-name">${skinMeta(r.skin).name}</span></div>`
        : `<div class="season-tier-reward">${rewardText(r)}</div>`;
      return `<div class="season-tier ${reached&&!claimed?'ready':''} ${milestone?'milestone':''} ${r.skin?'season-tier-final':''}">
        <div class="season-tier-num">T${t}</div>
        ${rewardMid}
        <div class="season-tier-action">${action}</div>
      </div>`;
    }).join('');
    track.querySelectorAll('.season-claim-btn').forEach(btn=>{
      btn.addEventListener('click', ()=> seasonClaim(parseInt(btn.dataset.t,10)));
    });
    track.querySelectorAll('.season-skin-reward[data-skin]').forEach(el=>{
      el.addEventListener('click', ()=> showSkinPreview(el.dataset.skin));
    });
  }
}
document.getElementById('openSeasonBtn').addEventListener('click', ()=>{
  renderSeasonOverlay();
  document.getElementById('seasonOverlay').classList.remove('hidden');
});
document.getElementById('closeSeasonBtn').addEventListener('click', ()=>{
  document.getElementById('seasonOverlay').classList.add('hidden');
});

function submitScoreToRanking(isWin, placement){
  const statusEl = document.getElementById('scoreSubmitStatus');
  if(!window.__aramonSubmitScore){ statusEl.textContent=''; return; }
  const rawName = (document.getElementById('playerNameInput').value||'').trim();
  const name = rawName ? rawName.slice(0,12) : '名無しのモンスター';
  let mastermonName = null;
  let mastermonLevel = null;
  if(game.selectedMastermonKey){
    const mm = loadMastermons()[game.selectedMastermonKey];
    if(mm){ mastermonName = mm.name; mastermonLevel = mm.level; }
  }
  statusEl.textContent = 'ランキングに送信中…';
  const equippedSkin = (typeof getEquippedSkin==='function') ? (getEquippedSkin(player.element) || null) : null;
  window.__aramonSubmitScore({
    name,
    element: player.element,
    elementLabel: ELEMENTS[player.element].label,
    skin: equippedSkin,               // その試合で装備していたスキン(ランキングアイコンに反映)
    mastermonName,
    mastermonLevel,
    kills: player.kills,
    damage: Math.round(player.damageDealt),
    placement: isWin ? 1 : placement,
    isWin: !!isWin,
    time: Math.round(player.deathAt||matchTime),
    ts: Date.now(),
  }).then(ok=>{
    statusEl.textContent = ok ? 'ランキングに記録しました' : 'ランキング送信に失敗しました';
  });
}
/* =====================================================================
   マスモン(マスターモンスター) UI
===================================================================== */
let mastermonDetailKey = null;
let mastermonSelectedTraining = null;
let mastermonDetailTab = null; // null=メニュー / 'info' / 'moves' / 'training' / 'edit'

let mastermonOpenedFrom = 'title';
function openMastermonScreen(fromResult){
  const data = loadMastermons();
  const keys = Object.keys(data);
  const noticeEl = document.getElementById('mastermonNotice');
  if(keys.length===0){
    noticeEl.textContent = 'マスモンがいません。チャンピオンを取ってマスモン登録しよう！';
    noticeEl.classList.remove('hidden');
    clearTimeout(mastermonNoticeTimer);
    mastermonNoticeTimer = setTimeout(()=>noticeEl.classList.add('hidden'), 3200);
    return;
  }
  noticeEl.classList.add('hidden');
  mastermonOpenedFrom = fromResult ? 'result' : 'title';
  if(!mastermonDetailKey || !data[mastermonDetailKey]) mastermonDetailKey = keys[0];
  mastermonSelectedTraining = null;
  mastermonDetailTab = null;
  renderMastermonList();
  renderMastermonDetail(mastermonDetailKey);
  document.getElementById('mastermonScreen').classList.remove('hidden');
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('resultScreen').classList.add('hidden');
}
let mastermonNoticeTimer = null;
document.getElementById('closeMastermonBtn').addEventListener('click', ()=>{
  document.getElementById('mastermonScreen').classList.add('hidden');
  if(mastermonOpenedFrom==='result'){
    document.getElementById('resultScreen').classList.remove('hidden');
  } else {
    document.getElementById('startScreen').classList.remove('hidden');
  }
});
document.getElementById('viewMastermonBtn').addEventListener('click', ()=>openMastermonScreen(true));
// フッター右端の「マスモン編集」ボタン → 編集画面(名前変更・削除)を開く
document.getElementById('mastermonEditBtn').addEventListener('click', ()=>{
  if(!mastermonDetailKey) return;
  mastermonDetailTab = 'edit';
  mastermonSelectedTraining = null;
  renderMastermonDetail(mastermonDetailKey);
});

let mastermonPendingDeleteKey = null;
document.getElementById('mastermonDeleteNoBtn').addEventListener('click', ()=>{
  document.getElementById('mastermonDeleteConfirm').classList.add('hidden');
  mastermonPendingDeleteKey = null;
});
document.getElementById('mastermonDeleteYesBtn').addEventListener('click', ()=>{
  if(!mastermonPendingDeleteKey) return;
  const deletedKey = mastermonPendingDeleteKey;
  deleteMastermon(deletedKey);
  mastermonPendingDeleteKey = null;
  document.getElementById('mastermonDeleteConfirm').classList.add('hidden');
  if(game.selectedMastermonKey===deletedKey){
    game.selectedMastermonKey = null;
    game.selectedElement = null;
    updatePlayButtonsEnabled();
  }
  renderSelectorCards();
  pushToast('マスモンを削除しました');
  const remaining = Object.keys(loadMastermons());
  if(remaining.length===0){
    document.getElementById('mastermonScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
    return;
  }
  if(mastermonDetailKey===deletedKey) mastermonDetailKey = remaining[0];
  mastermonSelectedTraining = null;
  mastermonDetailTab = null;
  renderMastermonList();
  renderMastermonDetail(mastermonDetailKey);
});

function renderMastermonList(){
  const data = loadMastermons();
  const listEl = document.getElementById('mastermonList');
  const keys = Object.keys(data);
  listEl.innerHTML = keys.map(key=>{
    const mm = data[key];
    const el = ELEMENTS[key];
    const active = key===mastermonDetailKey;
    const iconHtml = `
      <div class="mastermon-list-icon" style="background:radial-gradient(circle at 35% 30%, ${el.color}, ${el.dark})">
        ${equippedIconImgTag(key, el.label)}
      </div>`;
    if(active){
      const expNeed = mastermonExpToNext(mm.level);
      const expPct = mm.level>=MASTERMON_LEVEL_CAP ? 100 : Math.round(mm.exp/expNeed*100);
      return `
        <div class="mastermon-list-item active" data-key="${key}">
          ${iconHtml}
          <div class="mastermon-list-text">
            <div class="mastermon-list-name">${mm.name}<span class="mastermon-list-species">(${el.label})</span></div>
            <div class="mastermon-list-sub">Lv.${mm.level} <span class="mm-ticket-count">🎫${mm.tickets}</span></div>
            <div class="mm-exp-track small"><div class="mm-exp-fill" style="width:${expPct}%;"></div></div>
            <div class="mm-exp-label">${mm.level>=MASTERMON_LEVEL_CAP ? 'MAX LEVEL' : `EXP ${mm.exp} / ${expNeed}`}</div>
          </div>
        </div>`;
    }
    return `
      <div class="mastermon-list-item" data-key="${key}">
        ${iconHtml}
        <div class="mastermon-list-text">
          <div class="mastermon-list-name">${mm.name}</div>
          <div class="mastermon-list-sub">${el.label}・Lv.${mm.level}</div>
        </div>
      </div>`;
  }).join('');
  listEl.querySelectorAll('.mastermon-list-item').forEach(item=>{
    item.addEventListener('click', ()=>{
      if(item.dataset.key===mastermonDetailKey) return;
      mastermonDetailKey = item.dataset.key;
      mastermonPreviewSkin = null; // 切替先マスモンの装備中スキンをプレビュー初期値に(前のが残らないように)
      // 表示中のタブ(詳細情報/技一覧/トレーニング)は維持したまま、内容だけ切り替える
      renderMastermonList();
      renderMastermonDetail(mastermonDetailKey);
    });
  });
}

function renderMastermonDetail(key){
  const data = loadMastermons();
  const mm = data[key];
  const el = ELEMENTS[key];
  const apt = APTITUDE[key];
  const panel = document.getElementById('mastermonDetailPanel');
  panel.classList.remove('hidden');

  // フッターの参戦ボタンは常設なので、選択中のマスモンに応じてハンドラを差し替える
  document.getElementById('mastermonUseBtn').onclick = ()=>{
    game.selectedElement = key;
    game.selectedMastermonKey = key;
    updatePlayButtonsEnabled();
    document.getElementById('mastermonScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
    renderSelectorCards();
    pushToast(`${mm.name} で参戦準備完了`);
  };

  // 再描画でDOMが作り直されるとスクロール位置が失われるため、事前に保存しておく
  const prevStatsCol = panel.querySelector('.mastermon-detail-statscol');
  const prevContent = panel.querySelector('.mm-subview-content');
  const savedStatsScroll = prevStatsCol ? prevStatsCol.scrollTop : 0;
  const savedContentScroll = prevContent ? prevContent.scrollTop : 0;

  const preview = (mastermonDetailTab==='training' && mastermonSelectedTraining) ? previewMastermonTraining(mm, mastermonSelectedTraining) : null;
  // 着せ替え画面のみステータス列を表示しない(プレビューを大きく取るため)
  const statsColHtml = (mastermonDetailTab==='dressup') ? '' : buildMastermonStatsColHtml(mm, apt, preview);

  const TAB_TITLES = { info:'詳細情報', moves:'技一覧', training:'トレーニング', edit:'マスモン編集', dressup:'着せ替え' };
  let contentHtml;
  if(mastermonDetailTab==='info') contentHtml = buildMastermonInfoHtml(key, mm, el);
  else if(mastermonDetailTab==='moves') contentHtml = buildMastermonMovesHtml(key);
  else if(mastermonDetailTab==='training') contentHtml = buildMastermonTrainingHtml(mm);
  else if(mastermonDetailTab==='edit') contentHtml = buildMastermonEditHtml(mm);
  else if(mastermonDetailTab==='dressup') contentHtml = buildMastermonSkinHtml(key);
  else contentHtml = buildMastermonMenuHtml();

  // トレーニング画面では実行ボタンを戻るボタンの左(ヘッダー内)に置く
  const trainExecBtnHtml = mastermonDetailTab==='training' ? `
      <button id="mastermonExecuteTrainBtn" class="mastermon-execute-btn mm-header-exec-btn" ${(!mastermonSelectedTraining||mm.tickets<=0)?'disabled':''}>トレ実行🎫${mm.tickets}枚</button>` : '';
  const headerHtml = mastermonDetailTab ? `
    <div class="mm-subview-header">
      <div class="mm-subview-title">${TAB_TITLES[mastermonDetailTab]}</div>
      ${trainExecBtnHtml}
      <button class="mm-back-btn">← 戻る</button>
    </div>` : '';

  panel.innerHTML = `
    <div class="mastermon-detail-body">
      ${statsColHtml}
      <div class="mastermon-detail-maincol">
        ${headerHtml}
        <div class="mm-subview-content">${contentHtml}</div>
      </div>
    </div>`;

  const statsColEl = panel.querySelector('.mastermon-detail-statscol');
  const contentEl = panel.querySelector('.mm-subview-content');
  if(statsColEl) statsColEl.scrollTop = savedStatsScroll;
  if(contentEl) contentEl.scrollTop = savedContentScroll;

  if(!mastermonDetailTab){
    panel.querySelectorAll('.mm-menu-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        mastermonDetailTab = btn.dataset.tab;
        if(btn.dataset.tab==='dressup') mastermonPreviewSkin = null; // 装備中を初期プレビューに
        renderMastermonDetail(key);
      });
    });
    return;
  }

  panel.querySelector('.mm-back-btn').addEventListener('click', ()=>{
    mastermonDetailTab = null;
    mastermonSelectedTraining = null;
    mastermonPreviewSkin = null;
    renderMastermonDetail(key);
  });

  if(mastermonDetailTab==='edit'){
    document.getElementById('mastermonRenameBtn').addEventListener('click', ()=>{
      const newName = document.getElementById('mastermonRenameInput').value.trim();
      if(!newName){ pushToast('名前を入力してください'); return; }
      mm.name = newName;
      data[key] = mm;
      saveMastermons(data);
      renderMastermonList();
      renderSelectorCards();
      renderMastermonDetail(key);
      pushToast('名前を変更しました');
    });
    document.getElementById('mastermonEditDeleteBtn').addEventListener('click', ()=>{
      mastermonPendingDeleteKey = key;
      document.getElementById('mastermonDeleteText').textContent = `${mm.name}とお別れします。いいですか？`;
      document.getElementById('mastermonDeleteConfirm').classList.remove('hidden');
    });
  }

  if(mastermonDetailTab==='training'){
    panel.querySelectorAll('.mm-train-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        mastermonSelectedTraining = (mastermonSelectedTraining===btn.dataset.key) ? null : btn.dataset.key;
        renderMastermonDetail(key);
      });
    });
    document.getElementById('mastermonExecuteTrainBtn').addEventListener('click', ()=>{
      if(!mastermonSelectedTraining) return;
      const changes = applyMastermonTraining(mm, mastermonSelectedTraining);
      if(!changes) return;
      data[key] = mm;
      saveMastermons(data);
      const parts = Object.keys(changes).map(k=>{
        const label = MASTERMON_STATS.find(s=>s.key===k).label;
        const v = changes[k];
        return `${label}${v>0?'+':''}${v}`;
      });
      pushToast(`トレーニング結果: ${parts.join(' / ')}`);
      playSe('train');
      mastermonSelectedTraining = null;
      renderMastermonList();
      renderMastermonDetail(key);
    });
  }

  if(mastermonDetailTab==='dressup'){
    panel.querySelectorAll('.mm-skin-thumb').forEach(thumb=>{
      thumb.addEventListener('click', ()=>{
        mastermonPreviewSkin = thumb.dataset.skin; // '' はデフォルト(nullにするとデフォルト選択が未初期化扱いになり戻せない)
        renderMastermonDetail(key);
      });
    });
    const confirmBtn = document.getElementById('mmSkinConfirmBtn');
    if(confirmBtn) confirmBtn.addEventListener('click', ()=>{
      setEquippedSkin(key, mastermonPreviewSkin || null);
      renderMastermonList();
      renderSelectorCards();
      renderMastermonDetail(key);
      pushToast(mastermonPreviewSkin ? 'スキンを着せ替えました' : 'デフォルトに戻しました');
      playSe('pickup');
    });
  }
}

// 「着せ替え」画面: 大きなプレビュー + 所持スキンのサムネイル行(ステータスは非表示)
let mastermonPreviewSkin = null; // null=このマスモンのプレビュー未初期化
function skinPreviewImgTag(element, skinId){
  // skinId が null/'' ならデフォルト(素のアイコン画像)
  if(!skinId){ return `<img src="${imgSrcFor(`monsters/${element}`)}" onerror="handleMonsterImgError(this,'monsters/${element}')" alt="">`; }
  const url = skinnedIconDataUrl(skinId);
  if(url) return `<img src="${url}" alt="">`;
  return `<img src="${imgSrcFor(`monsters/${element}`)}" onerror="handleMonsterImgError(this,'monsters/${element}')" alt="">`;
}
// 後ろ姿(試合中の姿)プレビュー
function skinBackImgTag(element, skinId){
  if(!skinId){ return `<img src="${imgSrcFor(`monsters/${element}_player`)}" data-ext-idx="0" onerror="handleMonsterImgError(this,'monsters/${element}_player')" alt="">`; }
  const url = skinnedPlayerDataUrl(skinId);
  if(url) return `<img src="${url}" alt="">`;
  return `<img src="${imgSrcFor(`monsters/${element}_player`)}" data-ext-idx="0" onerror="handleMonsterImgError(this,'monsters/${element}_player')" alt="">`;
}
function buildMastermonSkinHtml(key){
  const owned = ownedSkinsForElement(key);       // 所持スキンID一覧
  const equipped = getEquippedSkin(key);
  // 画面を開くたびに装備中スキンをプレビュー初期値にする
  if(mastermonPreviewSkin === null) mastermonPreviewSkin = equipped || '';
  const previewSkin = mastermonPreviewSkin || null;
  const previewName = previewSkin ? skinMeta(previewSkin).name : `${ELEMENTS[key].label}(デフォルト)`;
  // デフォルト + 所持スキンのサムネイル(左側の縦一覧)
  const thumbs = [{ id:'', cls:'' }].concat(owned.map(id=>({ id, cls: skinMeta(id).rarity==='SSR'?'ssr':'' })));
  const listHtml = thumbs.map(t=>{
    const sel = ((mastermonPreviewSkin||'')===t.id) ? 'selected' : '';
    const eq = ((equipped||'')===t.id) ? 'equipped' : '';
    return `<div class="mm-skin-thumb ${t.cls} ${sel} ${eq}" data-skin="${t.id}">${skinPreviewImgTag(key, t.id||null)}</div>`;
  }).join('');
  const isEquippedNow = ((equipped||'')===(mastermonPreviewSkin||''));
  return `
    <div class="mm-skin-body2">
      <div class="mm-skin-list">${listHtml}</div>
      <div class="mm-skin-main">
        <div class="mm-skin-previews">
          <div class="mm-skin-prev"><span class="mm-skin-prev-label">正面</span>${skinPreviewImgTag(key, previewSkin)}</div>
          <div class="mm-skin-prev"><span class="mm-skin-prev-label">後ろ</span>${skinBackImgTag(key, previewSkin)}</div>
        </div>
        <div class="mm-skin-preview-name">${previewName}</div>
        <button id="mmSkinConfirmBtn" class="mm-skin-confirm" ${isEquippedNow?'disabled':''}>${isEquippedNow?'着用中':'これに着せ替える'}</button>
      </div>
    </div>`;
}

// ステータス(ライフ・ちから等)バー: メニュー/詳細情報/技一覧/トレーニングの全画面で共通表示
function buildMastermonStatsColHtml(mm, apt, preview){
  const statsHtml = MASTERMON_STATS.map(s=>{
    const v = mm.stats[s.key];
    const delta = preview ? preview[s.key] : null;
    const resultVal = delta ? mastermonClampStat(v + delta) : v;
    const pct = Math.round(resultVal/MASTERMON_STAT_CAP*100);
    const deltaHtml = delta ? `<span class="mm-stat-delta ${delta>0?'up':'down'}">(${delta>0?'+':''}${delta})</span>` : '';
    const aptGrade = apt[s.key];
    return `
      <div class="mm-stat-row">
        <div class="mm-stat-toprow">
          <span class="mm-stat-name">${s.label}<span class="mm-stat-apt-badge apt-${aptGrade}">${aptGrade}</span></span>
          <span class="mm-stat-val">${resultVal}${deltaHtml}</span>
        </div>
        <div class="mm-stat-track"><div class="mm-stat-fill" style="width:${pct}%; background:${s.color};"></div></div>
      </div>`;
  }).join('');
  return `<div class="mastermon-detail-statscol"><div class="mm-stats-wrap">${statsHtml}</div></div>`;
}

// メニュー画面: 詳細情報 / 技一覧 / トレーニング の3ボタン
// 「マスモン編集」画面: 名前変更と削除
function buildMastermonEditHtml(mm){
  const safeName = String(mm.name).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  return `
    <div class="mm-edit-body">
      <div style="width:100%;">
        <div class="mm-edit-label">名前の変更</div>
        <div class="mm-edit-row">
          <input type="text" id="mastermonRenameInput" maxlength="10" value="${safeName}" placeholder="マスモンの名前">
          <button id="mastermonRenameBtn" class="mm-edit-rename-btn">名前を変更</button>
        </div>
      </div>
      <button id="mastermonEditDeleteBtn" class="mastermon-delete-btn">マスモンを削除</button>
    </div>`;
}

function buildMastermonMenuHtml(){
  // 2列表示。並び順: トレーニング・着せ替え / 技一覧・詳細情報
  return `
    <div class="mastermon-menu-body">
      <button class="mm-menu-btn" data-tab="training">
        <span class="mm-menu-btn-icon">💪</span>
        <span class="mm-menu-btn-label">トレーニング</span>
      </button>
      <button class="mm-menu-btn" data-tab="dressup">
        <span class="mm-menu-btn-icon">👕</span>
        <span class="mm-menu-btn-label">着せ替え</span>
      </button>
      <button class="mm-menu-btn" data-tab="moves">
        <span class="mm-menu-btn-icon">⚔️</span>
        <span class="mm-menu-btn-label">技一覧</span>
      </button>
      <button class="mm-menu-btn" data-tab="info">
        <span class="mm-menu-btn-icon">📊</span>
        <span class="mm-menu-btn-label">詳細情報</span>
      </button>
    </div>`;
}

function mmFmtMult(v){ return `×${(Math.round(v*100)/100).toFixed(2)}`; }

// 「詳細情報」画面: ステータス倍率・特性・状態変化を縦一列に表示
function buildMastermonInfoHtml(key, mm, el){
  const mults = mastermonEffectMults(mm);
  const effHp = Math.round(el.hp*mults.lifeMult);
  const effSpeed = Math.round(el.speed*(el.speedMod||1)*mults.speedMult);
  const fireRateMult = 1/mults.cooldownMult;
  const dashDistance = Math.round((DASH_REF_SPEED*DASH_REF_SPEED*DASH_SPEED_MULT/Math.max(effSpeed,1))*DASH_DURATION);
  const sc = STATE_CHANGES[key];

  // mastermonStatFactor()はステータス100で1.0(=無補正)を返すため、1.0を基準に上昇/下降を判定する。
  // 被ダメ倍率だけは値が低いほど良い(被ダメが減る)ので判定を反転させる。
  const mmMultColorClass = (mult, invert)=>{
    if(Math.abs(mult-1) < 0.001) return '';
    const isUp = mult > 1;
    const good = invert ? !isUp : isUp;
    return good ? 'mm-info-val-up' : 'mm-info-val-down';
  };

  const statRows = [
    { label:'HP', val: effHp, cls: mmMultColorClass(mults.lifeMult, false) },
    { label:'移動速度', val: effSpeed, cls: mmMultColorClass(mults.speedMult, false) },
    { label:'ダッシュ距離', val: dashDistance, cls: mmMultColorClass(1/mults.speedMult, false) },
    { label:'技ダメ倍率', val: mmFmtMult(mults.dmgDealtMult), cls: mmMultColorClass(mults.dmgDealtMult, false) },
    { label:'被ダメ倍率', val: mmFmtMult(mults.dmgTakenMult), cls: mmMultColorClass(mults.dmgTakenMult, true) },
    { label:'連射速度倍率', val: mmFmtMult(fireRateMult), cls: mmMultColorClass(fireRateMult, false) },
    { label:'ガッツ回復速度倍率', val: mmFmtMult(mults.gutsRegenMult), cls: mmMultColorClass(mults.gutsRegenMult, false) },
  ].map(r=>`
    <div class="mm-info-row">
      <span class="mm-info-label">${r.label}</span>
      <span class="mm-info-val ${r.cls}">${r.val}</span>
    </div>`).join('');

  const stateHtml = sc ? `
    <div class="mm-info-state-card">
      <div class="mm-info-state-name">${sc.name}</div>
      <div class="mm-info-state-line">発動条件：${stateTriggerText(sc)}</div>
      <div class="mm-info-state-line">${stateDurationText(sc)}</div>
      <div class="mm-info-state-line">効果：${describeStateEffectsText(sc.effects)}</div>
    </div>` : '';

  return `
    <div class="mastermon-info-col-single">
      <div class="mm-info-col-title">ステータス倍率</div>
      ${statRows}
      <div class="mm-info-col-title" style="margin-top:14px;">特性</div>
      <div class="mm-info-trait">${TRAIT_DESC[el.trait]}</div>
      <div class="mm-info-col-title" style="margin-top:14px;">状態変化</div>
      ${stateHtml}
    </div>`;
}

// 技の見た目(aoe形状・連射・爆風など)から、簡易な特徴テキストを組み立てる
function describeMoveFeatureText(mv){
  const parts = [];
  if(mv.aoeShape==='fan') parts.push(`扇状(${mv.fanAngleDeg}°)に攻撃`);
  else if(mv.aoeShape==='rect') parts.push(`幅${mv.rectWidth}の直線状に攻撃`);
  else if(mv.aoeShape==='beams') parts.push(`${mv.beamCount}方向のビームで攻撃`);
  else if(mv.aoeShape==='zigzag') parts.push(`ジグザグ状(幅${mv.zigzagWidth})に攻撃`);
  else if(mv.aoeShape==='fanZigzag') parts.push('扇状かつジグザグに攻撃');
  if(mv.burst) parts.push(`${mv.burst}連射`);
  if(mv.splash) parts.push(`着弾時に半径${mv.splash}へ爆風`);
  if(mv.growWithDistance) parts.push('飛距離が長いほど威力上昇');
  if(mv.selfSpeedBuffOnHit) parts.push(`命中時 自分の移動速度${WARM_SHELL_SPEED_BUFF_MULT}倍(${WARM_SHELL_SPEED_BUFF_DURATION}秒間)`);
  if(mv.multiOrb) parts.push('赤青黄緑のオーラ球体を発射');
  if(!parts.length) parts.push('単体に直撃');
  return parts.join('・');
}

// 技に付随する特殊効果(ワームtier3の命中時スピードバフ等)の一言説明。無ければ空文字
function moveBonusEffectText(key){
  const mv = (SIGNATURE_MOVES[key]||[]).find(m=>m.selfSpeedBuffOnHit);
  if(!mv) return '';
  return `「${mv.name}」命中時 移動速度${WARM_SHELL_SPEED_BUFF_MULT}倍(${WARM_SHELL_SPEED_BUFF_DURATION}秒)`;
}

// 「技一覧」画面: tier毎の技情報(アイコン・威力・消費ガッツ・CT・弾速・射程・特徴)
function buildMastermonMovesHtml(key){
  const moves = SIGNATURE_MOVES[key] || [];
  const fallbackIcon = (moves.find(m=>m.icon) || {}).icon || '✨';
  const movesHtml = moves.map(mv=>{
    const icon = mv.icon || fallbackIcon;
    // 技アイコンは該当オーラのアイコンを表示(tier3は装備SSRスキンで一致技に変わる)
    const dispAura = (typeof getMoveAura==='function') ? getMoveAura(mv, {element:key, isPlayer:true}) : mv.aura;
    const auraIcon = (dispAura && typeof AURA_EMOJI!=='undefined') ? AURA_EMOJI[dispAura] : icon;
    // combat.js の fireMove() と同じ計算: 範囲攻撃(aoeShape)は projSpeed が無くても
    // 予告表示の後、この速度でダメージ範囲が塗り広がっていく(瞬間発動ではない)
    const isAoe = !!mv.aoeShape;
    const speedVal = isAoe ? Math.max(200, mv.projSpeed||900) : mv.projSpeed;
    const speedText = isAoe ? `範囲拡大速度 ${speedVal}` : `弾速 ${speedVal}`;
    return `
    <div class="mm-move-card">
      <div class="mm-move-tier-badge">TIER<br>${mv.tier}</div>
      <div class="mm-move-info">
        <div class="mm-move-name">${mv.name}<span class="mm-move-icon">${auraIcon}</span></div>
        <div class="mm-move-stats">
          <span>威力 ${mv.dmg}</span>
          <span>消費ガッツ ${mv.gutsCost}</span>
          <span>CT ${mv.cooldown}秒</span>
          <span>${speedText}</span>
          <span>射程 ${mv.range}</span>
        </div>
        <div class="mm-move-feature">${describeMoveFeatureText(mv)}</div>
      </div>
    </div>`;
  }).join('');
  return `<div class="mm-moves-list">${movesHtml}</div>`;
}

// 「トレーニング」画面: 従来のトレーニング一覧と同じ内容(ステータスバーは共通の左カラムに表示)
function buildMastermonTrainingHtml(mm){
  const trainingHtml = TRAINING_MENU.map(t=>`
    <button class="mm-train-btn ${t.key===mastermonSelectedTraining?'active':''}" data-key="${t.key}">
      <span class="mm-train-name">${t.label}</span>
    </button>`).join('');

  const legendHtml = MASTERMON_STATS.map(s=>
    `<div class="mm-stat-desc-row"><b style="color:${s.color}">${s.label}</b>：${s.desc}</div>`
  ).join('');

  return `
    <div class="mastermon-detail-traincol">
      <div class="mm-train-title">トレーニング(選択で変動値をプレビュー)</div>
      <div class="mm-train-grid">${trainingHtml}</div>
      <div class="mm-stat-desc-title">ステータス説明</div>
      <div class="mm-stat-desc-wrap">${legendHtml}</div>
    </div>`;
}

// マスモンのステータス倍率を任意のエンティティに適用する(プレイヤー本人にも、マルチプレイの
// マスモンbotにも共通で使う)
function applyMastermonStatsToEntity(ent, mm){
  if(!ent || !mm) return;
  const mults = mastermonEffectMults(mm);
  ent.maxHp = Math.round(ent.maxHp * mults.lifeMult);
  ent.hp = ent.maxHp;
  ent.speed = ent.speed * mults.speedMult;
  ent.mastermonDmgDealtMult = mults.dmgDealtMult;
  ent.mastermonDmgTakenMult = mults.dmgTakenMult;
  ent.mastermonGutsRegenMult = mults.gutsRegenMult;
  ent.mastermonCooldownMult = mults.cooldownMult;
}
// バトル開始時、選択中のマスモンのステータス倍率をプレイヤーに適用
function applyMastermonToPlayer(){
  if(!game.selectedMastermonKey) return;
  const data = loadMastermons();
  const mm = data[game.selectedMastermonKey];
  applyMastermonStatsToEntity(player, mm);
  // 技強化チケット: ストックがあれば1つ消費して技tier2解放でスタート
  if(mm && mm.nextMoveBoost > 0){
    player.moveTierUnlocked = Math.max(player.moveTierUnlocked||1, 2);
    player.moveTierSelected = 2;
    mm.nextMoveBoost--;
    saveMastermons(data);
    pushToast('⚔️ 技強化チケット発動！技tier2解放でスタート');
  }
}

// 試合終了後：マスモン使用時はEXP付与、未登録の種族でチャンピオンを取った場合は登録を促す
function handleMastermonPostMatch(isWin){
  const infoEl = document.getElementById('mastermonResultInfo');
  const registerEl = document.getElementById('mastermonRegisterPrompt');
  infoEl.classList.add('hidden');
  registerEl.classList.add('hidden');

  if(game.selectedMastermonKey){
    const data = loadMastermons();
    const mm = data[game.selectedMastermonKey];
    if(mm){
      const killExpBonus = Math.round(player.mastermonKillExpBonus||0);
      const result = awardMastermonExp(mm, {
        kills: player.kills, damage: Math.round(player.damageDealt),
        survivalSec: Math.round(player.deathAt||matchTime), champion: !!isWin,
        xpMult: netState.mode==='multi' ? 5 : 1, // マルチプレイは獲得経験値5倍
        bonusExp: killExpBonus, // マスモン撃破ボーナス(相手レベル×係数の積み立て)
      });
      saveMastermons(data);
      let resultText;
      if(result.goldGain>0){
        // レベル上限に達したマスモンは経験値の代わりにゴールドを獲得
        addWallet(result.goldGain, 0);
        updateAccountBar();
        resultText = `${mm.name} は最高レベル！ EXPの代わりに 🪙+${result.goldGain}`;
      } else {
        resultText = `${mm.name} EXP+${result.expGain}`;
        if(killExpBonus>0) resultText += `(うちマスモン撃破ボーナス+${killExpBonus})`;
        if(result.levelsGained>0) resultText += ` Lv.${mm.level}に上昇！トレーニングチケット+${result.levelsGained}`;
      }
      infoEl.textContent = resultText;
      infoEl.classList.remove('hidden');
    }
    return;
  }

  {
    const data = loadMastermons();
    if(!data[player.element]){
      registerEl.classList.remove('hidden');
      registerEl.dataset.element = player.element;
      document.getElementById('mastermonRegisterName').value = '';
      // 登録した瞬間にこの試合の経験値を付与できるよう、成績を控えておく。
      // これをしないと「新規モンスターで試合→登録」した試合の経験値が消えてしまう。
      pendingRegisterMatchStats = {
        kills: player.kills, damage: Math.round(player.damageDealt),
        survivalSec: Math.round(player.deathAt||matchTime), champion: !!isWin,
        xpMult: netState.mode==='multi' ? 5 : 1,
        bonusExp: Math.round(player.mastermonKillExpBonus||0),
      };
    }
  }
}
let pendingRegisterMatchStats = null;
document.getElementById('mastermonRegisterConfirmBtn').addEventListener('click', ()=>{
  const registerEl = document.getElementById('mastermonRegisterPrompt');
  const elementKey = registerEl.dataset.element;
  if(!elementKey) return;
  const name = document.getElementById('mastermonRegisterName').value;
  const data = loadMastermons();
  data[elementKey] = createMastermon(elementKey, name);
  // 登録した試合の経験値をその場で付与し、リザルトにも表示する
  let toastExpText = '';
  if(pendingRegisterMatchStats){
    const mm = data[elementKey];
    const result = awardMastermonExp(mm, pendingRegisterMatchStats);
    pendingRegisterMatchStats = null;
    toastExpText = ` EXP+${result.expGain}`;
    let infoText = `${mm.name} EXP+${result.expGain}`;
    if(result.levelsGained>0) infoText += ` Lv.${mm.level}に上昇！トレーニングチケット+${result.levelsGained}`;
    const infoEl = document.getElementById('mastermonResultInfo');
    infoEl.textContent = infoText;
    infoEl.classList.remove('hidden');
  }
  saveMastermons(data);
  // そのまま再戦しても経験値が入るように、登録と同時にこのマスモンを選択状態にする
  game.selectedElement = elementKey;
  game.selectedMastermonKey = elementKey;
  updatePlayButtonsEnabled();
  // 登録直後に「マスモン」画面を開いた時、今登録したばかりのマスモンが表示されるようにする。
  // これをしないと、既に他のマスモンを登録済みの場合に古い選択(mastermonDetailKey)が
  // 残ったままとなり、「このマスモンで参戦する」を押しても新しく登録した方ではなく
  // 別のマスモンが選ばれてしまい、狙った試合で経験値が入らないように見える不具合があった。
  mastermonDetailKey = elementKey;
  registerEl.classList.add('hidden');
  renderSelectorCards();
  pushToast('マスモンに登録しました！' + toastExpText);
});
document.getElementById('mastermonRegisterSkipBtn').addEventListener('click', ()=>{
  pendingRegisterMatchStats = null;
  document.getElementById('mastermonRegisterPrompt').classList.add('hidden');
});
function onPlayerDown(){
  if(netState.mode==='multi' && netState.isHost){
    hostSpectating = true;
    pushToast('あなたは敗退しました。試合の決着まで観戦します');
    return;
  }
  showResult(false, player.placement||entities.filter(e=>e.alive).length+1);
}
function onPlayerWin(){ showResult(true, 1); }

document.getElementById('replayBtn').addEventListener('click', async ()=>{
  document.getElementById('resultScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
  document.getElementById('killFeed').innerHTML='';
  game.started=false;
  joinInProgress = false;
  updatePlayButtonsEnabled();
  renderSelectorCards();
  if(netState.mode==='multi' && netState.roomId){
    await window.__aramonLeaveRoom(netState.roomId);
    netState.roomId=null; netState.isHost=false; netState.humanPlayers={}; netState.hostId=null;
    hostCountdownTimer && clearTimeout(hostCountdownTimer);
    hostCountdownTimer=null; hostCountdownSnapshot=null;
    netState.matchStarting=false; hostSpectating=false; matchBeginning=false;
  }
});

let currentRankingMode = 'kills';
let currentRankingMonster = 'all';
let rankingOpenedFrom = 'result';
function populateRankingMonsterFilter(){
  const wrap = document.getElementById('rankingMonsterFilterWrap');
  const btn = document.getElementById('rankingMonsterFilterBtn');
  const menu = document.getElementById('rankingMonsterFilterMenu');
  if(!wrap || wrap.dataset.built) return;
  wrap.dataset.built = '1';
  const options = [{ value:'all', label:'総合(全モンスター)' }]
    .concat(Object.keys(ELEMENTS).map(key=>({ value:key, label:ELEMENTS[key].label })));
  menu.innerHTML = options.map(o=>`<div class="custom-select-item${o.value==='all'?' active':''}" data-value="${o.value}">${o.label}</div>`).join('');
  const closeMenu = ()=>menu.classList.add('hidden');
  btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    menu.classList.toggle('hidden');
  });
  menu.querySelectorAll('.custom-select-item').forEach(item=>{
    item.addEventListener('click', (e)=>{
      e.stopPropagation();
      menu.querySelectorAll('.custom-select-item').forEach(i=>i.classList.remove('active'));
      item.classList.add('active');
      currentRankingMonster = item.dataset.value;
      btn.textContent = item.textContent;
      closeMenu();
      loadRankingList(currentRankingMode);
    });
  });
  document.addEventListener('click', (e)=>{
    if(!wrap.contains(e.target)) closeMenu();
  });
}
async function openRankingScreen(fromTitle){
  rankingOpenedFrom = fromTitle ? 'title' : 'result';
  populateRankingMonsterFilter();
  document.getElementById('rankingScreen').classList.remove('hidden');
  document.getElementById('resultScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.add('hidden');
  await loadRankingList(currentRankingMode);
}
const RANK_CROWN = { 1:{ color:'#ffd700', glow:'rgba(255,215,0,0.7)' }, 2:{ color:'#dfe6ee', glow:'rgba(223,230,238,0.6)' }, 3:{ color:'#cd7f32', glow:'rgba(205,127,50,0.6)' } };
// ある値(キル/ダメージ)で満たせる最上位の称号を返す
function highestTitleOf(type, value){
  if(typeof TITLES==='undefined') return null;
  let best = null;
  for(const t of TITLES){ if(t.type===type && (value||0)>=t.n){ if(!best || t.n>best.n) best = t; } }
  return best;
}
// 単一の記録値が満たす最上位称号をアイコンで返す(マイ記録用)
function statTitleChip(type, value){
  const t = highestTitleOf(type, value);
  return t ? `<span class="rank-title-chip" title="${t.name}（${titleCondText(t)}）">${t.emoji}</span>` : '';
}
// ランキングの記録が満たす称号(最上位のキル称号＋ダメージ称号)をアイコンで表示
function recordTitleBadgesHtml(r){
  const chips = [];
  const kt = highestTitleOf('matchKills', r.kills||0);
  const dt = highestTitleOf('matchDamage', r.damage||0);
  if(kt) chips.push(`<span class="rank-title-chip" title="${kt.name}（${titleCondText(kt)}）">${kt.emoji}</span>`);
  if(dt) chips.push(`<span class="rank-title-chip" title="${dt.name}（${titleCondText(dt)}）">${dt.emoji}</span>`);
  return chips.length ? `<span class="rank-titles">${chips.join('')}</span>` : '';
}
async function loadRankingList(mode){
  const listEl = document.getElementById('rankingList');
  listEl.innerHTML = '<div class="rank-empty">読み込み中…</div>';
  if(!window.__aramonFetchRanking){
    listEl.innerHTML = '<div class="rank-empty">ランキング機能が利用できません</div>';
    return;
  }
  const field = mode; // kills / damage / mastermonLevel いずれもFirebase側で索引済み
  const fetchCount = currentRankingMonster==='all' ? 50 : 300;
  const rows = await window.__aramonFetchRanking(field, fetchCount);
  if(!rows){
    listEl.innerHTML = '<div class="rank-empty">読み込みに失敗しました</div>';
    return;
  }
  let filtered = currentRankingMonster==='all' ? rows : rows.filter(r=>r.element===currentRankingMonster);
  if(mode==='mastermonLevel'){
    filtered = filtered.filter(r=>r.mastermonName).sort((a,b)=>(b.mastermonLevel||0)-(a.mastermonLevel||0));
  }
  const top = filtered.slice(0,50);
  if(top.length===0){
    listEl.innerHTML = '<div class="rank-empty">まだ記録がありません</div>';
    return;
  }
  listEl.innerHTML = top.map((r,i)=>{
    const val = mode==='mastermonLevel' ? `Lv.${r.mastermonLevel||0}` : (mode==='kills' ? (r.kills||0) : (r.damage||0));
    const nm = (r.name||'名無しのモンスター');
    const rank = i+1;
    const crown = RANK_CROWN[rank];
    const crownHtml = crown ? `<span class="rank-crown" style="color:${crown.color}; text-shadow:0 0 8px ${crown.glow};">👑</span>` : '';
    // 記録時に装備していたスキンがあればそのアイコンを表示(なければ通常のモンスター画像)
    let iconHtml = '';
    if(r.element){
      const skinUrl = r.skin && typeof skinnedIconDataUrl==='function' ? skinnedIconDataUrl(r.skin) : null;
      iconHtml = skinUrl
        ? `<img class="rank-icon" src="${skinUrl}" alt="">`
        : `<img class="rank-icon" src="${imgSrcFor(`monsters/${r.element}`)}" data-ext-idx="0" alt="" onerror="handleMonsterImgError(this, 'monsters/${r.element}')">`;
    }
    const mmHtml = r.mastermonName ? `<span class="rank-mastermon">『${r.mastermonName}』</span>` : '';
    const titleHtml = (typeof recordTitleBadgesHtml==='function') ? recordTitleBadgesHtml(r) : '';
    return `<div class="rank-row${crown?' rank-row-top':''}">${crownHtml}<span class="rk">#${rank}</span>${iconHtml}${mmHtml}<span class="rn">${nm}</span>${titleHtml}<span class="rv">${val}</span></div>`;
  }).join('');
}
document.getElementById('viewRankingBtn').addEventListener('click', ()=>openRankingScreen(false));
document.getElementById('titleRankingBtn').addEventListener('click', ()=>openRankingScreen(true));
document.getElementById('closeRankingBtn').addEventListener('click', ()=>{
  document.getElementById('rankingScreen').classList.add('hidden');
  const menu = document.getElementById('rankingMonsterFilterMenu');
  if(menu) menu.classList.add('hidden');
  if(rankingOpenedFrom==='title'){
    document.getElementById('startScreen').classList.remove('hidden');
  } else {
    document.getElementById('resultScreen').classList.remove('hidden');
  }
});
document.querySelectorAll('.rank-tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.rank-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    const m = tab.dataset.mode;
    currentRankingMode = (m==='damage' || m==='mastermonLevel') ? m : 'kills';
    loadRankingList(currentRankingMode);
  });
});

let myStatsOpenedFrom = 'result';
let myStatsModeTab = 'solo';
function openMyStatsScreen(fromTitle){
  myStatsOpenedFrom = fromTitle ? 'title' : 'result';
  document.getElementById('myStatsScreen').classList.remove('hidden');
  document.getElementById('resultScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.add('hidden');
  renderMyStats();
}
document.querySelectorAll('.mystat-mode-tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.mystat-mode-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    myStatsModeTab = tab.dataset.mode;
    renderMyStats();
  });
});
function renderMyStats(){
  const allStats = loadLocalStats() || defaultLocalStats();
  const stats = allStats[myStatsModeTab] || defaultModeStats();
  const derived = computeDerivedStats(stats);
  const overallEl = document.getElementById('myStatsOverall');
  overallEl.innerHTML = `
    <div class="mystat-box"><div class="ml">通算マッチ数</div><div class="mv">${stats.totalMatches||0}</div></div>
    <div class="mystat-box"><div class="ml">通算勝利数</div><div class="mv">${stats.totalWins||0}</div></div>
    <div class="mystat-box"><div class="ml">最高キル数</div><div class="mv">${stats.bestKills||0} ${statTitleChip('matchKills', stats.bestKills||0)}</div></div>
    <div class="mystat-box"><div class="ml">K/D</div><div class="mv">${derived.kd.toFixed(2)}</div></div>
    <div class="mystat-box"><div class="ml">最高ダメージ</div><div class="mv">${stats.bestDamage||0} ${statTitleChip('matchDamage', stats.bestDamage||0)}</div></div>
    <div class="mystat-box"><div class="ml">平均ダメージ</div><div class="mv">${Math.round(derived.avgDamage)}</div></div>
  `;
  const byElEl = document.getElementById('myStatsByElement');
  if(!stats.totalMatches){
    byElEl.innerHTML = '<div class="rank-empty">まだ記録がありません。1試合プレイすると記録されます</div>';
    return;
  }
  const ownMastermons = loadMastermons();
  const rows = Object.keys(ELEMENTS).map(key=>{
    const el = ELEMENTS[key];
    const es = (stats.byElement && stats.byElement[key]) || { bestDamage:0, bestKills:0, matches:0 };
    const mm = ownMastermons[key];
    const mmLine = mm ? `<span class="en-mastermon">★ ${mm.name} Lv.${mm.level}</span>` : '';
    return `<div class="mystat-elem-row">
      <img class="ei" src="${imgSrcFor(`monsters/${key}`)}" data-ext-idx="0" alt="" onerror="handleMonsterImgError(this, 'monsters/${key}')">
      <span class="en">${el.label}</span>
      ${mmLine}
      <span class="ev-line">使用回数　${es.matches||0}回</span>
      <span class="ev-line">最高キル　${es.bestKills||0} ${statTitleChip('matchKills', es.bestKills||0)}</span>
      <span class="ev-line">最高ダメージ　${es.bestDamage||0} ${statTitleChip('matchDamage', es.bestDamage||0)}</span>
    </div>`;
  });
  byElEl.innerHTML = rows.join('');
}
document.getElementById('viewMyStatsBtn').addEventListener('click', ()=>openMyStatsScreen(false));
document.getElementById('titleMyStatsBtn').addEventListener('click', ()=>openMyStatsScreen(true));
document.getElementById('closeMyStatsBtn').addEventListener('click', ()=>{
  document.getElementById('myStatsScreen').classList.add('hidden');
  if(myStatsOpenedFrom==='title'){
    document.getElementById('startScreen').classList.remove('hidden');
  } else {
    document.getElementById('resultScreen').classList.remove('hidden');
  }
});

/* =====================================================================
   管理者画面
===================================================================== */
const ADMIN_PASSWORD = '0008';
const ADMIN_EXCLUDE_NAME = 'おりょう';
let adminPassInput = '';
let adminMatchLogsCache = null;
let adminSelectedPeriod = 'all';
let adminSelectedMap = null;
let adminSelectedMonster = null;

function updateAdminPassDots(){
  const dots = document.querySelectorAll('#adminPassDots .admin-pass-dot');
  dots.forEach((d,i)=> d.classList.toggle('filled', i < adminPassInput.length));
}

document.getElementById('adminEntryBtn').addEventListener('click', ()=>{
  adminPassInput = '';
  updateAdminPassDots();
  document.getElementById('adminPassError').classList.add('hidden');
  document.getElementById('adminPassScreen').classList.remove('hidden');
  document.getElementById('startScreen').classList.add('hidden');
});
document.getElementById('adminPassCancelBtn').addEventListener('click', ()=>{
  document.getElementById('adminPassScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
});
function adminPassFail(){
  document.getElementById('adminPassError').classList.remove('hidden');
  setTimeout(()=>{
    document.getElementById('adminPassScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
  }, 700);
}
document.querySelectorAll('#adminPassKeypad button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const k = btn.dataset.k;
    if(document.getElementById('adminPassError').classList.contains('hidden')===false) return;
    if(k==='clear'){ adminPassInput=''; }
    else if(k==='back'){ adminPassInput = adminPassInput.slice(0,-1); }
    else if(adminPassInput.length<4){ adminPassInput += k; }
    updateAdminPassDots();
    if(adminPassInput.length===4){
      if(adminPassInput===ADMIN_PASSWORD){
        document.getElementById('adminPassScreen').classList.add('hidden');
        openAdminScreen();
      } else {
        adminPassFail();
      }
    }
  });
});

let adminFetchFailed = false;
async function fetchAdminMatchLogs(force){
  if(adminMatchLogsCache && !force) return adminMatchLogsCache;
  adminFetchFailed = false;
  if(!window.__aramonFetchMatchLogs){ adminMatchLogsCache = []; return adminMatchLogsCache; }
  const rows = await window.__aramonFetchMatchLogs();
  if(rows===null){
    // nullは「本当にデータが0件」ではなく「取得自体に失敗した」ことを示す
    // (Firebaseの読み取り権限がmatchLogsパスに無い場合など)。0件と混同しないよう区別する。
    adminFetchFailed = true;
    adminMatchLogsCache = [];
    return adminMatchLogsCache;
  }
  adminMatchLogsCache = rows.filter(r=> r && r.name !== ADMIN_EXCLUDE_NAME);
  return adminMatchLogsCache;
}
function adminMonthKeyOf(ts){
  const d = new Date(ts||0);
  return `${d.getFullYear()}年${String(d.getMonth()+1).padStart(2,'0')}月`;
}
function adminFilterByPeriod(logs, period){
  if(period==='all') return logs;
  return logs.filter(r=> adminMonthKeyOf(r.ts)===period);
}
// 汎用の自前ドロップダウン(マップ/モンスター選択用)。呼ばれるたびに選択肢を作り直すので、
// トグル用のクリックリスナーだけdataset.boundで一度きり登録する。
function renderAdminSelectFilter(wrapId, btnId, menuId, options, selectedValue, onSelect){
  const wrap = document.getElementById(wrapId);
  const btn = document.getElementById(btnId);
  const menu = document.getElementById(menuId);
  const selectedOpt = options.find(o=>o.value===selectedValue) || options[0];
  btn.textContent = selectedOpt ? selectedOpt.label : '';
  menu.innerHTML = options.map(o=>`<div class="custom-select-item${o.value===selectedValue?' active':''}" data-value="${o.value}">${o.label}</div>`).join('');
  if(!wrap.dataset.bound){
    wrap.dataset.bound = '1';
    btn.addEventListener('click', (e)=>{ e.stopPropagation(); menu.classList.toggle('hidden'); });
    document.addEventListener('click', (e)=>{ if(!wrap.contains(e.target)) menu.classList.add('hidden'); });
  }
  menu.querySelectorAll('.custom-select-item').forEach(item=>{
    item.onclick = (e)=>{
      e.stopPropagation();
      menu.classList.add('hidden');
      onSelect(item.dataset.value);
    };
  });
}
function populateAdminPeriodFilter(logs){
  const months = Array.from(new Set(logs.map(r=>adminMonthKeyOf(r.ts)))).sort().reverse();
  const options = [{ value:'all', label:'全期間' }].concat(months.map(m=>({ value:m, label:m })));
  if(!options.find(o=>o.value===adminSelectedPeriod)) adminSelectedPeriod = 'all';
  renderAdminSelectFilter('adminPeriodFilterWrap','adminPeriodFilterBtn','adminPeriodFilterMenu', options, adminSelectedPeriod, (val)=>{
    adminSelectedPeriod = val;
    renderAdminData();
  });
}
function renderAdminData(){
  if(adminFetchFailed){
    document.getElementById('adminTotalMatches').textContent = '取得に失敗しました(Firebaseの読み取り権限をご確認ください)';
    document.getElementById('adminTotalMatches').classList.add('admin-total-line-error');
    document.getElementById('adminPlayerList').innerHTML = '<div class="rank-empty">読み込みエラーのため表示できません</div>';
    document.getElementById('adminMapCount').textContent = '';
    document.getElementById('adminMonsterCount').textContent = '';
    return;
  }
  document.getElementById('adminTotalMatches').classList.remove('admin-total-line-error');
  const logs = adminMatchLogsCache || [];
  const filtered = adminFilterByPeriod(logs, adminSelectedPeriod);

  document.getElementById('adminTotalMatches').textContent = `合計プレイ回数　${filtered.length}回`;

  const byPlayer = {};
  filtered.forEach(r=>{
    const nm = r.name || '名無しのモンスター';
    byPlayer[nm] = (byPlayer[nm]||0) + 1;
  });
  const playerRows = Object.entries(byPlayer).sort((a,b)=> b[1]-a[1]);
  const playerListEl = document.getElementById('adminPlayerList');
  playerListEl.innerHTML = playerRows.length ? playerRows.map(([nm,cnt],i)=>
    `<div class="admin-row"><span class="admin-row-rank">#${i+1}</span><span class="admin-row-name">${nm}</span><span class="admin-row-count">${cnt}回</span></div>`
  ).join('') : '<div class="rank-empty">記録がありません</div>';

  if(!adminSelectedMap || !MAPS[adminSelectedMap]) adminSelectedMap = Object.keys(MAPS)[0];
  renderAdminSelectFilter('adminMapFilterWrap','adminMapFilterBtn','adminMapFilterMenu',
    Object.keys(MAPS).map(k=>({ value:k, label:MAPS[k].label })), adminSelectedMap, (val)=>{
      adminSelectedMap = val;
      renderAdminData();
    });
  const mapCount = filtered.filter(r=> r.map===adminSelectedMap).length;
  document.getElementById('adminMapCount').textContent = `${MAPS[adminSelectedMap].label}　${mapCount}回`;

  if(!adminSelectedMonster || !ELEMENTS[adminSelectedMonster]) adminSelectedMonster = Object.keys(ELEMENTS)[0];
  renderAdminSelectFilter('adminMonsterFilterWrap','adminMonsterFilterBtn','adminMonsterFilterMenu',
    Object.keys(ELEMENTS).map(k=>({ value:k, label:ELEMENTS[k].label })), adminSelectedMonster, (val)=>{
      adminSelectedMonster = val;
      renderAdminData();
    });
  const monsterCount = filtered.filter(r=> r.element===adminSelectedMonster).length;
  document.getElementById('adminMonsterCount').textContent = `${ELEMENTS[adminSelectedMonster].label}　${monsterCount}回`;
}
// 管理者画面: SE確認グリッド(全SEをタップで再生)
const SE_TEST_LABELS = {
  tap:'ボタン ポン', jakiin:'開始/状態変化 ジャキーン', train:'トレーニング ポワポワ', pickup:'取得 ピュイン',
  fire:'技発射 バァン', hitTaken:'被弾 ドスッ', noGuts:'ガッツ不足 ピピピ', fireRoar:'炎 ボオオオ',
  iceCrack:'氷 パリパリ', tornado:'竜巻 ゴオオオ', spin:'回転 シュルル', beam:'ビーム', whoosh:'風切り シュン',
  bell:'鐘 リンリン', chupiin:'召喚・柱 チュピーン', shuwaa:'召喚・収束 シュワァー', kill:'撃破 ズバシュ',
  fanfare:'勝利ファンファーレ', sad:'敗北', godRising:'ゴッドライジング 運命', ssrJackpot:'SSR大当たり', zashu:'ダークホウスト ズバシュ×5',
};
function renderAdminSeGrid(){
  const grid = document.getElementById('adminSeGrid');
  if(!grid || typeof SE_DEFS==='undefined') return;
  const names = Object.keys(SE_DEFS);
  grid.innerHTML = names.map(n=>`<button class="admin-se-btn" data-se="${n}">🔊 ${SE_TEST_LABELS[n]||n}</button>`).join('');
  grid.querySelectorAll('.admin-se-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const n = btn.dataset.se;
      // aoe系はdurを渡すと本来の長さで鳴る。fireは単発指定。
      if(n==='fire') playSe('fire', {kind:'single'});
      else playSe(n, {dur:1.6});
    });
  });
}
// 管理者画面: BGM確認グリッド
const BGM_TEST_ITEMS = [
  { id:'title',  label:'🎵 タイトル(牧場)' },
  { id:'battle0',label:'🎵 試合中・序盤' },
  { id:'battle1',label:'🎵 試合中・中盤' },
  { id:'battle2',label:'🎵 試合中・終盤' },
  { id:'final5', label:'🎵 残り5人以下(決戦・動画音源)' },
  { id:'stop',   label:'⏹ 停止' },
];
function adminPlayBgm(id){
  if(typeof audioInit==='function') audioInit();
  if(id==='stop'){ if(typeof bgmSetTrack==='function') bgmSetTrack(null); return; }
  if(id==='title'){ if(typeof bgmSetTrack==='function') bgmSetTrack('title'); return; }
  const lv = { battle0:0, battle1:1, battle2:2, final5:3 }[id];
  if(typeof bgmSetIntensity==='function') bgmSetIntensity(lv);
  if(typeof bgmSetTrack==='function') bgmSetTrack('battle');
}
function renderAdminBgmGrid(){
  const grid = document.getElementById('adminBgmGrid');
  if(!grid) return;
  grid.innerHTML = BGM_TEST_ITEMS.map(it=>`<button class="admin-se-btn" data-bgm="${it.id}">${it.label}</button>`).join('');
  grid.querySelectorAll('.admin-se-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> adminPlayBgm(btn.dataset.bgm));
  });
}
// 管理者画面: 音声確認タブ内のサブタブ切替(SE / BGM)
function adminShowSeSubtab(sub){
  document.querySelectorAll('.admin-subtab').forEach(t=>t.classList.toggle('active', t.dataset.subtab===sub));
  document.getElementById('adminSeSubPane').classList.toggle('hidden', sub!=='se');
  document.getElementById('adminBgmSubPane').classList.toggle('hidden', sub!=='bgm');
  if(sub!=='bgm' && typeof bgmSetTrack==='function') bgmSetTrack('title'); // BGMサブタブを離れたらテストBGMを止めてタイトルへ
}
document.querySelectorAll('.admin-subtab').forEach(t=> t.addEventListener('click', ()=>adminShowSeSubtab(t.dataset.subtab)));
// 管理者画面のタブ切替(プレイ状況 / 音声確認)
function adminShowTab(tab){
  document.querySelectorAll('.admin-tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===tab));
  document.getElementById('adminStatsPane').classList.toggle('hidden', tab!=='stats');
  document.getElementById('adminSePane').classList.toggle('hidden', tab!=='se');
  if(tab!=='se' && typeof bgmSetTrack==='function') bgmSetTrack('title'); // 音声確認タブを離れたらテストBGMを止める
}
document.querySelectorAll('.admin-tab').forEach(t=> t.addEventListener('click', ()=>adminShowTab(t.dataset.tab)));
async function openAdminScreen(){
  document.getElementById('adminScreen').classList.remove('hidden');
  adminShowTab('stats'); // デフォルトはプレイ状況
  document.getElementById('adminTotalMatches').textContent = '読み込み中…';
  document.getElementById('adminPlayerList').innerHTML = '';
  document.getElementById('adminMapCount').textContent = '';
  document.getElementById('adminMonsterCount').textContent = '';
  renderAdminSeGrid();
  renderAdminBgmGrid();
  adminShowSeSubtab('se'); // 音声確認タブ内はデフォルトでSE
  const logs = await fetchAdminMatchLogs(true);
  populateAdminPeriodFilter(logs);
  renderAdminData();
}
document.getElementById('closeAdminBtn').addEventListener('click', ()=>{
  document.getElementById('adminScreen').classList.add('hidden');
  document.querySelectorAll('#adminScreen .custom-select-menu').forEach(m=>m.classList.add('hidden'));
  if(typeof bgmSetTrack==='function') bgmSetTrack('title'); // テストBGMを止めてトップのタイトルBGMへ
  document.getElementById('startScreen').classList.remove('hidden');
});

/* =====================================================================
   LOOP
===================================================================== */
