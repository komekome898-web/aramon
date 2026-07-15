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
};
function stateTriggerText(sc){
  return {
    hpBelow: `HPが${Math.round(sc.triggerValue*100)}%以下で発動`,
    gutsBelow: `ガッツが${Math.round(sc.triggerValue*100)}%以下で発動`,
    onHitChance: `技命中時${Math.round(sc.triggerValue*100)}%の確率で発動`,
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
      <div class="m-trait">${TRAIT_DESC[el.trait]}</div>`;
    card.addEventListener('click', ()=>{
      game.selectedElement = key;
      game.selectedMastermonKey = null;
      document.getElementById('joinBtn').disabled = false;
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
document.querySelectorAll('.map-tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.map-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    game.selectedMap = tab.dataset.map==='kaurea' ? 'kaurea' : 'wild';
  });
});
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

function enterLobbyForRoom(){
  document.getElementById('lobbyScreen').classList.remove('hidden');
  document.getElementById('lobbyCountdown').textContent='';
  document.getElementById('lobbyPlayerList').innerHTML='';

  window.__aramonWatchRoomPlayers(netState.roomId, (players)=>{
    netState.humanPlayers = players||{};
    renderLobbyPlayerList();
    if(netState.isHost) maybeStartCountdown();
  });

  if(netState.isHost){
    document.getElementById('lobbySubText').textContent='他のプレイヤーを待っています…';
  } else {
    document.getElementById('lobbySubText').textContent='ホストが試合を開始するのを待っています…';
    window.__aramonWatchRoomMeta(netState.roomId, (meta)=>{
      if(meta && meta.hostId){ netState.hostId = meta.hostId; renderLobbyPlayerList(); }
      if(meta && typeof meta.capacity==='number'){ netState.capacity = meta.capacity; }
      if(meta && meta.status==='playing' && !game.started && !matchBeginning){
        beginMultiplayerMatch();
      }
    });
  }
}

function getDisplayNameFromInput(){
  const rawName = (document.getElementById('playerNameInput').value||'').trim();
  return rawName ? rawName.slice(0,12) : '名無しのモンスター';
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

  const displayName = getDisplayNameFromInput();
  let result;
  try{
    result = await window.__aramonCreateRoom(netState.capacity, displayName, game.selectedElement);
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
  const result = await window.__aramonJoinRoom(roomId, lobbyKey, displayName, game.selectedElement);
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

let countdownStarted = false;
function maybeStartCountdown(){
  if(countdownStarted || netState.matchStarting) return;
  const humanCount = Object.keys(netState.humanPlayers||{}).length;
  if(humanCount < 1) return;
  countdownStarted = true;
  let remaining = humanCount>=netState.capacity ? 3 : 12;
  const tick = ()=>{
    if(netState.cancelled) return;
    document.getElementById('lobbyCountdown').textContent = `まもなく開始… ${remaining}`;
    if(remaining<=0){
      netState.matchStarting = true;
      window.__aramonSetRoomStatus(netState.roomId, 'playing');
      window.__aramonCleanupLobbyEntry();
      beginMultiplayerMatch();
      return;
    }
    remaining--;
    setTimeout(tick, 1000);
  };
  tick();
}

document.getElementById('lobbyCancelBtn').addEventListener('click', async ()=>{
  netState.cancelled = true;
  countdownStarted = false;
  joinInProgress = false;
  document.getElementById('joinBtn').disabled = false;
  if(netState.roomId){
    await window.__aramonLeaveRoom(netState.roomId);
    await window.__aramonCleanupLobbyEntry();
  }
  document.getElementById('lobbyScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
});

function startGame(){
  entities=[]; projectiles=[]; lootItems=[]; particles=[]; areaEffects=[]; nextId=1;
  matchTime=0; game.over=false; game.tipTimer=7;
  camState.yaw = 0; camState.pitch = 0.27;
  camSnap.active = false;
  monsterScreenPos.clear();
  Object.keys(keys).forEach(k=>keys[k]=false);
  fireBtnHeld=false; joystick.active=false; joystick.nx=0; joystick.ny=0;
  joyKnobEl.style.transform='translate(0,0)';
  currentMap = MAPS[game.selectedMap] || MAPS.wild;
  initZone();
  genVolcanoAndLava();
  genRocks();
  genTerrain();

  let playerDisplayName = 'プレイヤー';
  if(game.selectedMastermonKey){
    const mmData = loadMastermons()[game.selectedMastermonKey];
    if(mmData) playerDisplayName = mmData.name;
  }
  player = createMonster(game.selectedElement, true, playerDisplayName);
  applyMastermonToPlayer();
  entities.push(player);
  const names = shuffle(BOT_NAMES);
  const botElements = shuffle(Object.keys(ELEMENTS));
  for(let i=0;i<29;i++){
    const elKey = botElements[i % botElements.length];
    entities.push(createMonster(elKey, false, names[i % names.length]+ (i>=names.length?'Ⅱ':'')));
  }
  spawnLoot(420, ZONE_CENTER0, ZONE_PHASES[0].holdRadius*0.95);
  updateCamera();

  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('resultScreen').classList.add('hidden');
  game.started=true;
  pushToast('バトル開始！');
}
let joinInProgress = false;
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
  joinInProgress = true;
  requestFullscreenSafe();
  requestOrientationLockSafe();
  createRoomFlow();
});
document.getElementById('findRoomBtn').addEventListener('click', ()=>{
  if(joinInProgress) return;
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
  document.getElementById('resultScreen').className = 'resultScreen ' + (isWin?'win':'lose');
  document.getElementById('resultRank').textContent = isWin ? 'WINNER' : ('#'+placement);
  document.getElementById('resultSub').textContent = isWin ? '生き残った！今夜はモン勝ちだ！' : '撃破された';
  document.getElementById('statKills').textContent = player.kills;
  document.getElementById('statDamage').textContent = Math.round(player.damageDealt);
  document.getElementById('statTime').textContent = fmtTime(player.deathAt||matchTime);
  const iconEl = document.getElementById('resultMonsterIcon');
  if(iconEl){
    const el = ELEMENTS[player.element];
    iconEl.alt = el ? el.label : '';
    iconEl.style.display = '';
    iconEl.dataset.variant = 'player';
    iconEl.dataset.extIdx = '0';
    iconEl.dataset.basePath = `monsters/${player.element}_player`;
    iconEl.src = imgSrcFor(iconEl.dataset.basePath);
  }
  document.getElementById('resultScreen').classList.remove('hidden');
  recordMatchResult(player.element, player.kills, Math.round(player.damageDealt), !!isWin);
  handleMastermonPostMatch(isWin);
  submitScoreToRanking(isWin, placement);
}
/* =====================================================================
   LOCAL STATS (localStorage)
===================================================================== */
const LOCAL_STATS_KEY = 'aramon_local_stats_v1';
function loadLocalStats(){
  try{
    const raw = localStorage.getItem(LOCAL_STATS_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(err){ return null; }
}
function defaultLocalStats(){
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
function saveLocalStats(stats){
  try{ localStorage.setItem(LOCAL_STATS_KEY, JSON.stringify(stats)); }catch(err){}
}
function recordMatchResult(elementKey, kills, damage, isWin){
  let stats = loadLocalStats();
  if(!stats) stats = defaultLocalStats();
  if(!stats.byElement) stats.byElement = {};
  if(!stats.byElement[elementKey]) stats.byElement[elementKey] = { bestDamage:0, bestKills:0, matches:0 };

  stats.totalMatches = (stats.totalMatches||0) + 1;
  stats.totalWins = (stats.totalWins||0) + (isWin?1:0);
  stats.totalKills = (stats.totalKills||0) + kills;
  stats.totalDamage = (stats.totalDamage||0) + damage;
  stats.bestDamage = Math.max(stats.bestDamage||0, damage);
  stats.bestKills = Math.max(stats.bestKills||0, kills);

  const es = stats.byElement[elementKey];
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
    document.getElementById('joinBtn').disabled = true;
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
      mastermonSelectedTraining = null;
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

  // 再描画でDOMが作り直されるとスクロール位置が失われるため、事前に保存しておく
  const prevStatsCol = panel.querySelector('.mastermon-detail-statscol');
  const prevTrainCol = panel.querySelector('.mastermon-detail-traincol');
  const savedStatsScroll = prevStatsCol ? prevStatsCol.scrollTop : 0;
  const savedTrainScroll = prevTrainCol ? prevTrainCol.scrollTop : 0;

  const preview = mastermonSelectedTraining ? previewMastermonTraining(mm, mastermonSelectedTraining) : null;

  const statsHtml = MASTERMON_STATS.map(s=>{
    const v = mm.stats[s.key];
    const pct = Math.round(v/MASTERMON_STAT_CAP*100);
    const delta = preview ? preview[s.key] : null;
    const deltaHtml = delta ? `<span class="mm-stat-delta ${delta>0?'up':'down'}">(${delta>0?'+':''}${delta})</span>` : '';
    const aptGrade = apt[s.key];
    return `
      <div class="mm-stat-row">
        <div class="mm-stat-toprow">
          <span class="mm-stat-name">${s.label}<span class="mm-stat-apt-badge apt-${aptGrade}">${aptGrade}</span></span>
          <span class="mm-stat-val">${v}${deltaHtml}</span>
        </div>
        <div class="mm-stat-track"><div class="mm-stat-fill" style="width:${pct}%; background:${s.color};"></div></div>
      </div>`;
  }).join('');

  const legendHtml = MASTERMON_STATS.map(s=>
    `<div class="mm-stat-desc-row"><b style="color:${s.color}">${s.label}</b>：${s.desc}</div>`
  ).join('');

  const trainingHtml = TRAINING_MENU.map(t=>`
    <button class="mm-train-btn ${t.key===mastermonSelectedTraining?'active':''}" data-key="${t.key}">
      <span class="mm-train-name">${t.label}</span>
    </button>`).join('');

  panel.innerHTML = `
    <div class="mastermon-detail-body">
      <div class="mastermon-detail-statscol">
        <div class="mm-stats-wrap">${statsHtml}</div>
      </div>
      <div class="mastermon-detail-traincol">
        <div class="mm-train-title">トレーニング(選択で変動値をプレビュー)</div>
        <div class="mm-train-grid">${trainingHtml}</div>
        <button id="mastermonExecuteTrainBtn" class="mastermon-execute-btn" ${(!mastermonSelectedTraining||mm.tickets<=0)?'disabled':''}>
          トレーニングを実行(チケット${mm.tickets}枚所持)
        </button>
        <div class="mm-stat-desc-title">ステータス説明</div>
        <div class="mm-stat-desc-wrap">${legendHtml}</div>
      </div>
    </div>
  `;
  panel.querySelector('.mastermon-detail-statscol').scrollTop = savedStatsScroll;
  panel.querySelector('.mastermon-detail-traincol').scrollTop = savedTrainScroll;

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
    mastermonSelectedTraining = null;
    renderMastermonList();
    renderMastermonDetail(key);
  });
  // フッターの参戦/削除ボタンは常設なので、選択中のマスモンに応じてハンドラを差し替える
  document.getElementById('mastermonDeleteBtn').onclick = ()=>{
    mastermonPendingDeleteKey = key;
    document.getElementById('mastermonDeleteText').textContent = `${mm.name}とお別れします。いいですか？`;
    document.getElementById('mastermonDeleteConfirm').classList.remove('hidden');
  };
  document.getElementById('mastermonUseBtn').onclick = ()=>{
    game.selectedElement = key;
    game.selectedMastermonKey = key;
    document.getElementById('joinBtn').disabled = false;
    document.getElementById('mastermonScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
    renderSelectorCards();
    pushToast(`${mm.name} で参戦準備完了`);
  };
}

// バトル開始時、選択中のマスモンのステータス倍率をプレイヤーに適用
function applyMastermonToPlayer(){
  if(!game.selectedMastermonKey) return;
  const data = loadMastermons();
  const mm = data[game.selectedMastermonKey];
  if(!mm || !player) return;
  const mults = mastermonEffectMults(mm);
  player.maxHp = Math.round(player.maxHp * mults.lifeMult);
  player.hp = player.maxHp;
  player.speed = player.speed * mults.speedMult;
  player.mastermonDmgDealtMult = mults.dmgDealtMult;
  player.mastermonDmgTakenMult = mults.dmgTakenMult;
  player.mastermonGutsRegenMult = mults.gutsRegenMult;
  player.mastermonCooldownMult = mults.cooldownMult;
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
      const result = awardMastermonExp(mm, {
        kills: player.kills, damage: Math.round(player.damageDealt),
        survivalSec: Math.round(player.deathAt||matchTime), champion: !!isWin,
      });
      saveMastermons(data);
      infoEl.textContent = result.levelsGained>0
        ? `${mm.name} EXP+${result.expGain}(Lv.${mm.level}に上昇！トレーニングチケット+${result.levelsGained})`
        : `${mm.name} EXP+${result.expGain}`;
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
    }
  }
}
document.getElementById('mastermonRegisterConfirmBtn').addEventListener('click', ()=>{
  const registerEl = document.getElementById('mastermonRegisterPrompt');
  const elementKey = registerEl.dataset.element;
  if(!elementKey) return;
  const name = document.getElementById('mastermonRegisterName').value;
  const data = loadMastermons();
  data[elementKey] = createMastermon(elementKey, name);
  saveMastermons(data);
  registerEl.classList.add('hidden');
  renderSelectorCards();
  pushToast('マスモンに登録しました！');
});
document.getElementById('mastermonRegisterSkipBtn').addEventListener('click', ()=>{
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
  document.getElementById('joinBtn').disabled = false;
  renderSelectorCards();
  if(netState.mode==='multi' && netState.roomId){
    await window.__aramonLeaveRoom(netState.roomId);
    netState.roomId=null; netState.isHost=false; netState.humanPlayers={}; netState.hostId=null;
    countdownStarted=false; netState.matchStarting=false; hostSpectating=false; matchBeginning=false;
  }
});

let currentRankingMode = 'kills';
let currentRankingMonster = 'all';
let rankingOpenedFrom = 'result';
function populateRankingMonsterFilter(){
  const sel = document.getElementById('rankingMonsterFilter');
  if(!sel || sel.dataset.built) return;
  sel.dataset.built = '1';
  let opts = `<option value="all">総合(全モンスター)</option>`;
  Object.keys(ELEMENTS).forEach(key=>{
    opts += `<option value="${key}">${ELEMENTS[key].label}</option>`;
  });
  sel.innerHTML = opts;
  sel.addEventListener('change', ()=>{
    currentRankingMonster = sel.value;
    loadRankingList(currentRankingMode);
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
function openMyStatsScreen(fromTitle){
  myStatsOpenedFrom = fromTitle ? 'title' : 'result';
  document.getElementById('myStatsScreen').classList.remove('hidden');
  document.getElementById('resultScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.add('hidden');
  renderMyStats();
}
function renderMyStats(){
  const stats = loadLocalStats() || defaultLocalStats();
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
  const rows = Object.keys(ELEMENTS).map(key=>{
    const el = ELEMENTS[key];
    const es = (stats.byElement && stats.byElement[key]) || { bestDamage:0, bestKills:0, matches:0 };
    return `<div class="mystat-elem-row">
      <img class="ei" src="${imgSrcFor(`monsters/${key}`)}" data-ext-idx="0" alt="" onerror="handleMonsterImgError(this, 'monsters/${key}')">
      <span class="en">${el.label}</span>
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
   LOOP
===================================================================== */
