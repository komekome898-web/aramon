const TRAIT_DESC = {
  burn:       '攻撃命中で相手をやけど状態に(10秒間 与ダメ0.8倍)',
  lifesteal:  '与えたダメージの20%分HP回復',
  gutsdrain:  '与えたダメージの30%分 相手のガッツを削る',
  slow:       '技命中で相手を1秒間 移動速度半分に',
  golem:      '移動0.8倍・被ダメ0.8倍・与ダメ1.2倍',
  haste:      '技の連射速度1.5倍',
  grace:      '与えたダメージの45%分 相手のガッツを削る。天の慈悲(tier3)発動後10秒間 被ダメ0.5倍',
};
function buildMonsterGrid(){
  const grid = document.getElementById('monsterGrid');
  grid.innerHTML='';
  Object.keys(ELEMENTS).forEach(key=>{
    const el = ELEMENTS[key];
    const card = document.createElement('div');
    card.className='monster-card';
    card.style.setProperty('--accent', el.color);
    card.innerHTML = `
      <div class="m-swatch" style="background:radial-gradient(circle at 35% 30%, ${el.color}, ${el.dark})">
        <img src="monsters/${key}.png" alt="${el.label}" onerror="this.remove()">
      </div>
      <div class="m-name">${el.label}</div>
      <div class="m-stat">HP ${el.hp}<br>速さ ${Math.round(el.speed*(el.speedMod||1))}</div>
      <div class="m-trait">${TRAIT_DESC[el.trait]}</div>`;
    card.addEventListener('click', ()=>{
      document.querySelectorAll('.monster-card').forEach(c=>c.classList.remove('selected'));
      card.classList.add('selected');
      game.selectedElement = key;
      document.getElementById('joinBtn').disabled=false;
    });
    grid.appendChild(card);
  });
}
buildMonsterGrid();

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
  entities=[]; projectiles=[]; lootItems=[]; particles=[]; nextId=1;
  matchTime=0; game.over=false; game.tipTimer=7;
  camState.yaw = 0; camState.pitch = 0.27;
  camSnap.active = false;
  monsterScreenPos.clear();
  Object.keys(keys).forEach(k=>keys[k]=false);
  fireBtnHeld=false; joystick.active=false; joystick.nx=0; joystick.ny=0;
  joyKnobEl.style.transform='translate(0,0)';
  initZone();
  genRocks();
  genTerrain();

  player = createMonster(game.selectedElement, true, 'プレイヤー');
  entities.push(player);
  const names = shuffle(BOT_NAMES);
  const botElements = shuffle(Object.keys(ELEMENTS));
  for(let i=0;i<19;i++){
    const elKey = botElements[i % botElements.length];
    entities.push(createMonster(elKey, false, names[i % names.length]+ (i>=names.length?'Ⅱ':'')));
  }
  spawnLoot(138, ZONE_CENTER0, ZONE_PHASES[0].holdRadius*0.95);
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
  document.getElementById('resultScreen').className = 'resultScreen ' + (isWin?'win':'lose');
  document.getElementById('resultRank').textContent = isWin ? 'WINNER' : ('#'+placement);
  document.getElementById('resultSub').textContent = isWin ? '生き残った！今夜はモン勝ちだ！' : '撃破された';
  document.getElementById('statKills').textContent = player.kills;
  document.getElementById('statDamage').textContent = Math.round(player.damageDealt);
  document.getElementById('statTime').textContent = fmtTime(player.deathAt||matchTime);
  document.getElementById('resultScreen').classList.remove('hidden');
  recordMatchResult(player.element, player.kills, Math.round(player.damageDealt), !!isWin);
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
  statusEl.textContent = 'ランキングに送信中…';
  window.__aramonSubmitScore({
    name,
    element: player.element,
    elementLabel: ELEMENTS[player.element].label,
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
  if(netState.mode==='multi' && netState.roomId){
    await window.__aramonLeaveRoom(netState.roomId);
    netState.roomId=null; netState.isHost=false; netState.humanPlayers={}; netState.hostId=null;
    countdownStarted=false; netState.matchStarting=false; hostSpectating=false; matchBeginning=false;
  }
});

let currentRankingMode = 'kills';
let rankingOpenedFrom = 'result';
async function openRankingScreen(fromTitle){
  rankingOpenedFrom = fromTitle ? 'title' : 'result';
  document.getElementById('rankingScreen').classList.remove('hidden');
  document.getElementById('resultScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.add('hidden');
  await loadRankingList(currentRankingMode);
}
async function loadRankingList(mode){
  const listEl = document.getElementById('rankingList');
  listEl.innerHTML = '<div class="rank-empty">読み込み中…</div>';
  if(!window.__aramonFetchRanking){
    listEl.innerHTML = '<div class="rank-empty">ランキング機能が利用できません</div>';
    return;
  }
  const field = mode==='kills' ? 'kills' : 'damage';
  const rows = await window.__aramonFetchRanking(field, 50);
  if(!rows){
    listEl.innerHTML = '<div class="rank-empty">読み込みに失敗しました</div>';
    return;
  }
  if(rows.length===0){
    listEl.innerHTML = '<div class="rank-empty">まだ記録がありません</div>';
    return;
  }
  listEl.innerHTML = rows.map((r,i)=>{
    const val = mode==='kills' ? (r.kills||0) : (r.damage||0);
    const nm = (r.name||'名無しのモンスター');
    return `<div class="rank-row"><span class="rk">#${i+1}</span><span class="rn">${nm}（${r.elementLabel||''}）</span><span class="rv">${val}</span></div>`;
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
    currentRankingMode = tab.dataset.mode==='damage' ? 'damage' : 'kills';
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
      <img class="ei" src="monsters/${key}.png" alt="" onerror="this.remove()">
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
