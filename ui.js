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
        <img src="${imgSrcFor(`monsters/${mmData.element}`)}" data-ext-idx="0" alt="${el.label}" onerror="handleMonsterImgError(this, 'monsters/${mmData.element}')">
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
const ACCOUNT_SYNC_KEYS = ['aramon_mastermons_v1','aramon_local_stats_v1','aramon_player_name_v1','aramon_wallet_v1','aramon_bag_v1'];
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
  document.getElementById('walletGold').textContent = `🪙 ${w.gold}`;
  document.getElementById('walletDia').textContent = `💎 ${w.dia}`;
  const btn = document.getElementById('accountLoginBtn');
  if(accountState.loggedIn){
    btn.textContent = `👤 ${accountState.name}`;
    btn.classList.add('logged-in');
  } else {
    btn.textContent = '👤 ログイン / アカウント作成';
    btn.classList.remove('logged-in');
  }
  // ログイン中はランキング表示名の入力欄を隠す(アカウント名を表示名として使う)
  document.getElementById('playerNameLabel').classList.toggle('hidden', accountState.loggedIn);
  document.getElementById('playerNameInput').classList.toggle('hidden', accountState.loggedIn);
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
    } else if(String(acc.pass) === pass){
      // ログイン: サーバーのデータを取り込む
      accountState.loggedIn = true; accountState.name = acc.name; accountState.key = key; accountState.pass = pass;
      saveAccountCreds({ name: acc.name, key, pass });
      applyAccountData(acc.data);
      applyAccountNameAsDisplayName(acc.name);
      updateAccountBar();
      accountShowMsg('ログインしました！', true);
      pushToast(`おかえりなさい、${acc.name}！`);
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
  bagSelectedItem = null;
  renderBag();
  document.getElementById('bagTargetWrap').classList.add('hidden');
  document.getElementById('bagOverlay').classList.remove('hidden');
});
document.getElementById('closeBagBtn').addEventListener('click', ()=>{
  document.getElementById('bagOverlay').classList.add('hidden');
});
document.getElementById('bagTargetCancelBtn').addEventListener('click', ()=>{
  document.getElementById('bagTargetWrap').classList.add('hidden');
});
function renderBag(){
  const bag = loadBag();
  const gridEl = document.getElementById('bagIconGrid');
  const keys = Object.keys(PLAYER_ITEMS).filter(k=>bag[k]>0);
  if(keys.length===0){
    gridEl.innerHTML = '<div class="bag-empty">アイテムはありません。ガチャやショップで手に入れよう！</div>';
    renderBagDesc();
    return;
  }
  // 説明フィールドに表示中のアイテムが無くなったら選択解除
  if(bagSelectedItem && !(bag[bagSelectedItem]>0)) bagSelectedItem = null;
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
      bagSelectedItem = (bagSelectedItem===b.dataset.key) ? null : b.dataset.key;
      renderBag();
      // 右側のマスモン選択が開いているときは、選択中アイテムに合わせて右側も切り替える
      // (対象マスモンの選択は維持。アイテム選択を解除したら右側を閉じる)
      const wrap = document.getElementById('bagTargetWrap');
      if(!wrap.classList.contains('hidden')){
        if(bagSelectedItem){
          bagPicker.itemKey = bagSelectedItem;
          renderBagTargetList();
        } else {
          wrap.classList.add('hidden');
        }
      }
    });
  });
  renderBagDesc();
}
// 画面下部の説明フィールド: 選択中アイテムの名前・効果・使うボタンを表示
function renderBagDesc(){
  const empty = document.getElementById('bagDescEmpty');
  const content = document.getElementById('bagDescContent');
  if(!bagSelectedItem || !PLAYER_ITEMS[bagSelectedItem]){
    empty.classList.remove('hidden');
    content.classList.add('hidden');
    return;
  }
  const it = PLAYER_ITEMS[bagSelectedItem];
  empty.classList.add('hidden');
  content.classList.remove('hidden');
  document.getElementById('bagDescIcon').textContent = it.icon;
  document.getElementById('bagDescName').textContent = it.name;
  document.getElementById('bagDescText').textContent = playerItemDesc(bagSelectedItem);
}
document.getElementById('bagDescUseBtn').addEventListener('click', ()=>{
  if(bagSelectedItem) openBagTargetPicker(bagSelectedItem);
});
// マスモン選択(トレーニングと同じく「選択→使用」の2段階)。選択中はアイテムの効果をプレビュー表示する
let bagPicker = { itemKey:null, targetKey:null };
function openBagTargetPicker(itemKey){
  const keys = Object.keys(loadMastermons());
  if(keys.length===0){ pushToast('マスモンがいません。先にマスモン登録しよう！'); return; }
  bagPicker = { itemKey, targetKey:null };
  renderBagTargetList();
  document.getElementById('bagTargetWrap').classList.remove('hidden');
}
function renderBagTargetList(){
  const data = loadMastermons();
  const it = PLAYER_ITEMS[bagPicker.itemKey];
  // ステータスの実は対象ステータスのプレビュー差分を作り、マスモン画面と同じステータスバーで表示
  const preview = it.stat ? { [it.stat]: STAT_SEED_GAIN } : null;
  const pick = document.getElementById('bagTargetList');
  pick.innerHTML = Object.keys(data).map(k=>{
    const mm = data[k];
    const active = k===bagPicker.targetKey;
    const statsBarHtml = buildMastermonStatsColHtml(mm, APTITUDE[k], preview);
    const extra =
      bagPicker.itemKey==='freeTrainTicket' ? `<div class="bt-extra">🎫 トレチケ ${mm.tickets||0}→${(mm.tickets||0)+1}枚</div>` :
      bagPicker.itemKey==='moveTicket' ? `<div class="bt-extra">⚔️ 技強化ストック ${mm.nextMoveBoost||0}→${(mm.nextMoveBoost||0)+1}</div>` : '';
    return `
    <button class="bag-target-btn ${active?'active':''}" data-key="${k}">
      <span class="bt-head">
        <img src="${imgSrcFor(`monsters/${k}`)}" data-ext-idx="0" alt="${ELEMENTS[k].label}" onerror="handleMonsterImgError(this, 'monsters/${k}')">
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
  useBagItem(bagPicker.itemKey, bagPicker.targetKey);
});
function useBagItem(itemKey, mmKey){
  const bag = loadBag();
  if(!(bag[itemKey]>0)) return;
  const data = loadMastermons();
  const mm = data[mmKey];
  const it = PLAYER_ITEMS[itemKey];
  if(!mm || !it) return;
  let resultText;
  if(it.stat){
    const before = mm.stats[it.stat];
    mm.stats[it.stat] = mastermonClampStat(before + STAT_SEED_GAIN);
    const gained = mm.stats[it.stat] - before;
    resultText = `${mm.name}の${MASTERMON_STATS.find(s=>s.key===it.stat).label}+${gained}`;
    if(gained<=0) resultText = `${mm.name}のステータスは上限です(アイテムは消費されました)`;
  } else if(itemKey==='freeTrainTicket'){
    mm.tickets = (mm.tickets||0) + 1;
    resultText = `${mm.name}のトレーニングチケット+1(🎫${mm.tickets}枚)`;
  } else if(itemKey==='moveTicket'){
    mm.nextMoveBoost = (mm.nextMoveBoost||0) + 1;
    resultText = `${mm.name}は次の試合を技tier2解放で開始！(${mm.nextMoveBoost}回分)`;
  }
  bag[itemKey]--;
  if(bag[itemKey]<=0) delete bag[itemKey];
  saveBag(bag);
  saveMastermons(data);
  playSe('train');
  pushToast(resultText);
  document.getElementById('bagTargetWrap').classList.add('hidden');
  renderBag();
  renderSelectorCards();
}

// ===== ガチャ =====
function updateGachaWallet(){
  const w = loadWallet();
  document.getElementById('gachaGold').textContent = `🪙 ${w.gold}`;
  document.getElementById('gachaDia').textContent = `💎 ${w.dia}`;
}
document.getElementById('openGachaBtn').addEventListener('click', ()=>{
  updateGachaWallet();
  document.getElementById('gachaSingleCost').textContent = `💎 ${GACHA_COST_DIA_SINGLE}`;
  document.getElementById('gachaTenCost').textContent = `💎 ${GACHA_COST_DIA_TEN}`;
  document.getElementById('gachaResult').innerHTML = 'ガチャを回してアイテムを手に入れよう！';
  document.getElementById('gachaOverlay').classList.remove('hidden');
});
document.getElementById('closeGachaBtn').addEventListener('click', ()=>{
  document.getElementById('gachaOverlay').classList.add('hidden');
});
function doGacha(count){
  const cost = count===10 ? GACHA_COST_DIA_TEN : GACHA_COST_DIA_SINGLE;
  const w = loadWallet();
  if(w.dia < cost){ pushToast('ダイヤが足りません'); return; }
  w.dia -= cost;
  saveWallet(w);
  const results = [];
  for(let i=0;i<count;i++){
    const k = gachaRoll(GACHA_POOL);
    addBagItem(k, 1);
    results.push(k);
  }
  if(count===1){
    const it = PLAYER_ITEMS[results[0]];
    document.getElementById('gachaResult').innerHTML = `
      <span class="gacha-result-icon">${it.icon}</span>
      <div>${it.name} を手に入れた！</div>
      <div class="gacha-result-desc">${playerItemDesc(results[0])}</div>`;
  } else {
    document.getElementById('gachaResult').innerHTML = `
      <div class="gacha-ten-grid">${results.map(k=>`
        <span class="gacha-ten-item">${PLAYER_ITEMS[k].icon}<span>${PLAYER_ITEMS[k].name}</span></span>`).join('')}
      </div>`;
  }
  playSe('train');
  updateGachaWallet();
  updateAccountBar();
}
document.getElementById('gachaSingleBtn').addEventListener('click', ()=>doGacha(1));
document.getElementById('gachaTenBtn').addEventListener('click', ()=>doGacha(10));

// ===== ショップ(ゴールドでアイテム購入) =====
function renderShop(){
  const w = loadWallet();
  document.getElementById('shopGold').textContent = `🪙 ${w.gold}`;
  const listEl = document.getElementById('shopList');
  listEl.innerHTML = SHOP_ITEMS.map(([k, price])=>{
    const it = PLAYER_ITEMS[k];
    return `
    <div class="bag-item">
      <span class="bag-item-icon">${it.icon}</span>
      <span class="bag-item-text">
        <span class="bag-item-name">${it.name}</span>
        <span class="bag-item-desc">${playerItemDesc(k)}</span>
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
function updateMapPreview(){
  const map = MAPS[game.selectedMap] || MAPS.wild;
  const imgEl = document.getElementById('mapPreviewImage');
  const iconEl = document.getElementById('mapPreviewIcon');
  const nameEl = document.getElementById('mapPreviewName');
  const descEl = document.getElementById('mapPreviewDesc');
  if(!imgEl) return;
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
    game.selectedMap = MAPS[tab.dataset.map] ? tab.dataset.map : 'wild';
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
    result = await window.__aramonCreateRoom(netState.capacity, displayName, game.selectedElement, currentMastermonLevel());
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
  const result = await window.__aramonJoinRoom(roomId, lobbyKey, displayName, game.selectedElement, currentMastermonLevel());
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
    result = await window.__aramonFindOrCreateRoom(netState.capacity, displayName, game.selectedElement);
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
  joyKnobEl.style.transform='translate(0,0)';
  currentMap = MAPS[game.selectedMap] || MAPS.wild;
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
  pushToast('バトル開始！');
  playSe('jakiin');
  bgmSetTrack('battle');
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
  // リザルトSE(勝利=ファンファーレ/それ以外=悲しげ)を鳴らし、鳴り終わってから通常BGMへ
  bgmSetTrack(null);
  playSe(isWin ? 'fanfare' : 'sad');
  setTimeout(()=>{ if(!game.started) bgmSetTrack('title'); }, isWin ? 3800 : 3000);
  document.getElementById('resultScreen').className = 'resultScreen ' + (isWin?'win':'lose');
  document.getElementById('resultRank').textContent = isWin ? 'WINNER' : ('#'+placement);
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
    iconEl.dataset.variant = 'normal';
    iconEl.dataset.extIdx = '0';
    iconEl.dataset.basePath = `monsters/${player.element}`;
    iconEl.src = imgSrcFor(iconEl.dataset.basePath);
  }
  document.getElementById('resultScreen').classList.remove('hidden');
  recordMatchResult(player.element, player.kills, Math.round(player.damageDealt), !!isWin, netState.mode==='multi' ? 'multi' : 'solo');
  handleMastermonPostMatch(isWin);
  submitScoreToRanking(isWin, placement);
  logMatchForAdmin();
}
function logMatchForAdmin(){
  if(!window.__aramonLogMatch){ console.warn('logMatchForAdmin: __aramonLogMatch not ready, skipped'); return; }
  const rawName = (document.getElementById('playerNameInput').value||'').trim();
  const name = rawName ? rawName.slice(0,12) : '名無しのモンスター';
  const mapKey = game.selectedMap || 'wild';
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
  window.__aramonSubmitScore({
    name,
    element: player.element,
    elementLabel: ELEMENTS[player.element].label,
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
        <img src="${imgSrcFor(`monsters/${key}`)}" data-ext-idx="0" alt="${el.label}" onerror="handleMonsterImgError(this, 'monsters/${key}')">
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
  const statsColHtml = buildMastermonStatsColHtml(mm, apt, preview);

  const TAB_TITLES = { info:'詳細情報', moves:'技一覧', training:'トレーニング', edit:'マスモン編集' };
  let contentHtml;
  if(mastermonDetailTab==='info') contentHtml = buildMastermonInfoHtml(key, mm, el);
  else if(mastermonDetailTab==='moves') contentHtml = buildMastermonMovesHtml(key);
  else if(mastermonDetailTab==='training') contentHtml = buildMastermonTrainingHtml(mm);
  else if(mastermonDetailTab==='edit') contentHtml = buildMastermonEditHtml(mm);
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
        renderMastermonDetail(key);
      });
    });
    return;
  }

  panel.querySelector('.mm-back-btn').addEventListener('click', ()=>{
    mastermonDetailTab = null;
    mastermonSelectedTraining = null;
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
  return `
    <div class="mastermon-menu-body">
      <button class="mm-menu-btn" data-tab="info">
        <span class="mm-menu-btn-icon">📊</span>
        <span class="mm-menu-btn-label">詳細情報</span>
      </button>
      <button class="mm-menu-btn" data-tab="moves">
        <span class="mm-menu-btn-icon">⚔️</span>
        <span class="mm-menu-btn-label">技一覧</span>
      </button>
      <button class="mm-menu-btn" data-tab="training">
        <span class="mm-menu-btn-icon">💪</span>
        <span class="mm-menu-btn-label">トレーニング</span>
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
    // combat.js の fireMove() と同じ計算: 範囲攻撃(aoeShape)は projSpeed が無くても
    // 予告表示の後、この速度でダメージ範囲が塗り広がっていく(瞬間発動ではない)
    const isAoe = !!mv.aoeShape;
    const speedVal = isAoe ? Math.max(200, mv.projSpeed||900) : mv.projSpeed;
    const speedText = isAoe ? `範囲拡大速度 ${speedVal}` : `弾速 ${speedVal}`;
    return `
    <div class="mm-move-card">
      <div class="mm-move-tier-badge">TIER<br>${mv.tier}</div>
      <div class="mm-move-info">
        <div class="mm-move-name">${mv.name}<span class="mm-move-icon">${icon}</span></div>
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
      let resultText = `${mm.name} EXP+${result.expGain}`;
      if(killExpBonus>0) resultText += `(うちマスモン撃破ボーナス+${killExpBonus})`;
      if(result.levelsGained>0) resultText += ` Lv.${mm.level}に上昇！トレーニングチケット+${result.levelsGained}`;
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
    const iconHtml = r.element ? `<img class="rank-icon" src="${imgSrcFor(`monsters/${r.element}`)}" data-ext-idx="0" alt="" onerror="handleMonsterImgError(this, 'monsters/${r.element}')">` : '';
    const mmHtml = r.mastermonName ? `<span class="rank-mastermon">『${r.mastermonName}』</span>` : '';
    return `<div class="rank-row${crown?' rank-row-top':''}">${crownHtml}<span class="rk">#${rank}</span>${iconHtml}${mmHtml}<span class="rn">${nm}</span><span class="rv">${val}</span></div>`;
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
    <div class="mystat-box"><div class="ml">最高キル数</div><div class="mv">${stats.bestKills||0}</div></div>
    <div class="mystat-box"><div class="ml">K/D</div><div class="mv">${derived.kd.toFixed(2)}</div></div>
    <div class="mystat-box"><div class="ml">最高ダメージ</div><div class="mv">${stats.bestDamage||0}</div></div>
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
      <span class="ev-line">最高キル　${es.bestKills||0}</span>
      <span class="ev-line">最高ダメージ　${es.bestDamage||0}</span>
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
async function openAdminScreen(){
  document.getElementById('adminScreen').classList.remove('hidden');
  document.getElementById('adminTotalMatches').textContent = '読み込み中…';
  document.getElementById('adminPlayerList').innerHTML = '';
  document.getElementById('adminMapCount').textContent = '';
  document.getElementById('adminMonsterCount').textContent = '';
  const logs = await fetchAdminMatchLogs(true);
  populateAdminPeriodFilter(logs);
  renderAdminData();
}
document.getElementById('closeAdminBtn').addEventListener('click', ()=>{
  document.getElementById('adminScreen').classList.add('hidden');
  document.querySelectorAll('#adminScreen .custom-select-menu').forEach(m=>m.classList.add('hidden'));
  document.getElementById('startScreen').classList.remove('hidden');
});

/* =====================================================================
   LOOP
===================================================================== */
