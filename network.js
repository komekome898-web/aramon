let lastT = performance.now();

/* =====================================================================
   MULTIPLAYER MATCH LOGIC (ホスト完全権威方式)
   - 全プレイヤーが同じシードから同じ初期状態(岩・地形・ルート・ボット構成・
     全員のスポーン地点)をローカルで再現し、エンティティのid割り当ても
     全員で完全に一致する(host/非host問わず同じ順序で生成するため)
   - ホストだけが本物のシミュレーション(ボットAI・当たり判定・ダメージ・ゾーン)を
     実行し、その結果(全エンティティの位置・HP・ガッツ・状態)を高頻度で配信する
   - 非ホストは「自分の入力→自分の見た目の予測」だけをローカルで行い、
     自分以外の全エンティティ(ボットや他プレイヤー)はホストの配信値へ
     滑らかに追従表示するだけにする(自分でシミュレーションしない)
   - これにより非ホスト側での「同期ズレ」「ボットが止まって見える」を構造的に防ぐ
===================================================================== */
const INPUT_SEND_INTERVAL = 0.045;  // 自分の入力を送る間隔(秒) 約22回/秒。ホストが自分の位置を早く反映できるようにする
let lastInputSendAt = 0;
let remoteInputs = {};   // playerId -> {mx,my,facing,wantFire,wantDash,moveTierSelected}

// ===== スナップショット補間(①)＋速度外挿(②)＋ラグ補正(③)＋差分/分割配信(④) =====
// 遠隔エンティティは「一定の描画遅延」を挟んで直近2スナップショット間を線形補間する。
// これにより更新間隔のムラを吸収し、ホスト/ゲストで見た目の滑らかさを揃える。
// 時間軸はゲストローカルの受信時刻(performance.now)を使い、機体間の時計同期を不要にする。
const INTERP_DELAY_MS = 120;   // 遠隔エンティティを一定遅延で描画(publish間隔+ジッタを吸収)
const EXTRAP_CAP_MS = 180;     // スナップショット欠落時に速度で外挿する上限
const AUTH_FULL_EVERY = 8;     // 何回に1回、静的値(maxHp/train係数等)も載せた「フル」配信にするか(残りは位置等の軽量配信)
const HOST_HISTORY_CAP = 60;   // ホストの位置履歴(ラグ補正の巻き戻し用)保持スナップショット数
let guestSnapBuf = [];         // ゲスト: 補間用スナップショット {rt, seq, ents:{id:{x,y,z,f,vx,vy,alive}}}
let guestCurViewSeq = 0;       // ゲスト: 今まさに描画している(=狙いを定めている)ホストseq
let hostPosHistory = [];       // ホスト: [{seq, ents:{id:{x,y}}}] 直近のみ保持(巻き戻し用)
let authPublishSeq = 0;        // ホスト: authStateの連番
let lastPubPos = {};           // ホスト: 速度算出用 id->{x,y,t}
// 最短方向で角度を補間する(±πをまたぐズレを防ぐ)
function lerpAngleShort(a, b, t){ let d=b-a; while(d>Math.PI)d-=Math.PI*2; while(d<-Math.PI)d+=Math.PI*2; return a+d*t; }
// ホスト: あるエンティティの「lagDelaySeqスナップショット前」の位置を返す(ラグ補正の巻き戻し)
function entityRewoundPos(entId, lagDelaySeq){
  if(!hostPosHistory.length) return null;
  const back = Math.max(0, Math.min(lagDelaySeq|0, hostPosHistory.length-1));
  const snap = hostPosHistory[hostPosHistory.length-1-back];
  return snap ? snap.ents[entId] : null;
}

function seedFromString(str){
  let h = 2166136261;
  for(let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h>>>0;
}

async function beginMultiplayerMatch(){
  if(game.started || matchBeginning) return;
  matchBeginning = true;
  document.getElementById('lobbyScreen').classList.add('hidden');
  document.getElementById('resultScreen').classList.add('hidden');

  entities=[]; projectiles=[]; lootItems=[]; particles=[]; areaEffects=[]; nextId=1;
  matchTime=0; game.over=false; game.tipTimer=7; hostSpectating=false; spectateTargetId=null; lastGutsWarnAt=-Infinity;
  camState.yaw = 0; camState.pitch = 0.27;
  camSnap.active = false;
  monsterScreenPos.clear();
  Object.keys(keys).forEach(k=>keys[k]=false);
  fireBtnHeld=false; joystick.active=false; joystick.nx=0; joystick.ny=0;
  if(typeof setAutoRun==='function') setAutoRun(false); // 試合開始時はオートラン解除
  joyKnobEl.style.transform='translate(0,0)';
  remoteInputs = {}; processedHitKeys.clear(); authPublishTimer=0;
  pendingRemoteFireEvents.length = 0; processedFireEventKeys.clear();
  processedLootEventKeys.clear();
  // 補間/ラグ補正の状態をリセット
  guestSnapBuf = []; guestCurViewSeq = 0; hostPosHistory = []; authPublishSeq = 0; lastPubPos = {};

  // 部屋のシードと確定参加者リストを決定/取得
  // ホストが「試合開始が確定した瞬間の参加者一覧」を1回だけ書き込み、非ホストはそれだけを読む(誰も新規にgetしない)
  let seed, fixedPlayers, mapKey, hostMastermonBots, sharedWorld = null;
  if(netState.isHost){
    seed = (Date.now() ^ Math.floor(Math.random()*0xffffffff)) >>> 0;
    fixedPlayers = netState.humanPlayers || {};
    if(!fixedPlayers[netState.myPlayerId]){
      const mySkin = (typeof getEquippedSkin==='function') ? getEquippedSkin(game.selectedElement) : null;
      fixedPlayers = { ...fixedPlayers, [netState.myPlayerId]: { name:'名無しのモンスター', element: game.selectedElement, skin: mySkin||null } };
    }
    mapKey = (typeof resolveMapKey==='function') ? resolveMapKey() : (game.selectedMap || 'wild'); // 'ランダム'選択時は実マップを確定
    // ホストが持っているマスモンのうち、今使っているもの以外からランダムに選んでbot候補にする。
    const ownMastermons = loadMastermons();
    const candidateKeys = Object.keys(ownMastermons).filter(k=>k!==game.selectedMastermonKey);
    const shuffledCandidates = shuffle(candidateKeys);
    hostMastermonBots = shuffledCandidates.map(k=>{
      const mm = ownMastermons[k];
      const skin = (typeof getEquippedSkin==='function') ? getEquippedSkin(k) : null;
      return { key:k, name:mm.name, element:mm.element, stats:mm.stats, level:mm.level||1, skin: skin||null };
    });
  } else {
    console.log('[aramon] NON-HOST: waiting for seed+world...');
    const result = await window.__aramonWaitForRoomSeed(netState.roomId, 12000);
    if(result){
      seed = result.seed;
      fixedPlayers = result.fixedPlayers;
      mapKey = result.mapKey || 'wild';
      hostMastermonBots = result.hostMastermonBots || [];
      sharedWorld = result.world || null; // ホストが生成した障害物(あれば正として使う)
    } else {
      // タイムアウト時のみ、やむを得ずローカルの直近スナップショットで代用する
      seed = seedFromString(netState.roomId);
      fixedPlayers = netState.humanPlayers || {};
      mapKey = game.selectedMap || 'wild';
      hostMastermonBots = [];
      console.warn('[aramon] NON-HOST: TIMEOUT, falling back to local snapshot', seed, fixedPlayers);
    }
  }
  netState.humanPlayers = fixedPlayers;
  game.activeMapKey = MAPS[mapKey] ? mapKey : 'wild';
  currentMap = MAPS[mapKey] || MAPS.wild;

  applyWorldScale(MULTI_MAP_SCALE); // マルチプレイは少人数想定のため、ソロより一回り狭いマップにする

  // サブシステムごとに独立した派生rngを使う。こうすることで、ある生成の消費数が
  // 環境差でズレても他(スポーン/アイテム/装飾)まで連鎖して崩れない。
  const deriveRng = (salt)=> makeSeededRng((Math.imul(seed>>>0, 2654435761) ^ (salt>>>0)) >>> 0);
  const rng      = makeSeededRng(seed); // bot名/属性/枠決定用(host/guestで一致)
  const obRng    = deriveRng(0xA1);     // 障害物生成(ホスト or フォールバック)
  const decorRng = deriveRng(0xD2);     // 地形装飾(見た目のみ)
  const spawnRng = deriveRng(0x53);     // スポーン地点
  const lootRng  = deriveRng(0x7C);     // アイテム

  initZone();
  if(sharedWorld){
    // ゲスト: ホストが生成・配信した障害物をそのまま反映(座標一致で見えない岩ハマりを防ぐ)
    applyWorldFromSync(sharedWorld, obRng);
  } else {
    // ホスト、またはworld未受信のフォールバック: シードから生成
    seededGenVolcanoAndLava(obRng);
    seededGenWater(obRng);
    seededGenOasisZones(obRng);
    seededGenRocks(obRng);
    seededGenCrystals(obRng);
  }
  seededGenTerrain(decorRng);

  // ホストは生成した障害物一式を含めてシード等を配信する(ゲストはこれを正とする)
  if(netState.isHost){
    const worldData = packWorldForSync();
    console.log('[aramon] HOST: publishing seed+world', seed, mapKey);
    await window.__aramonSetRoomSeed(netState.roomId, seed, fixedPlayers, mapKey, hostMastermonBots, worldData);
  }

  // 参加している人間プレイヤーの一覧を「IDの文字列順」で確定させる(全員が同じ順序で処理するため)
  const humanList = Object.keys(fixedPlayers||{}).map(id=>({ id, ...fixedPlayers[id] }));
  if(!humanList.find(h=>h.id===netState.myPlayerId)){
    const mySkin = (typeof getEquippedSkin==='function') ? getEquippedSkin(game.selectedElement) : null;
    humanList.push({ id:netState.myPlayerId, name:'名無しのモンスター', element: game.selectedElement, skin: mySkin||null });
  }
  humanList.sort((a,b)=> a.id<b.id?-1:(a.id>b.id?1:0));

  const usedSlots = humanList.length;
  const botCount = Math.max(0, netState.capacity - usedSlots);
  const totalEntityCount = usedSlots + botCount;
  const spawnPoints = seededPickSpawnPointsBatch(spawnRng, totalEntityCount);

  let idCounter = 1;
  let spawnIdx = 0;
  for(const h of humanList){
    const sp = spawnPoints[spawnIdx++];
    const isMe = h.id===netState.myPlayerId;
    const ent = createMonster(h.element||'fire', isMe, h.name||'プレイヤー', { id: idCounter++, spawnPoint: sp });
    ent.netPlayerId = h.id;
    if(h.mmLevel) ent.mastermonLevel = h.mmLevel; // マスモン使用者は撃破時のEXPボーナス対象
    if(h.skin) ent.skinId = h.skin;               // 相手の着せ替えスキンを反映
    if(isMe){ ent.isPlayer = true; player = ent; }
    else { ent.isPlayer=false; ent.isRemoteHuman=true; }
    entities.push(ent);
  }

  const names = seededShuffle(rng, BOT_NAMES);
  const botElements = seededShuffle(rng, Object.keys(ELEMENTS));
  // ホストのマスモン候補を、どのbot枠に登場させるかも共有シードで決める(host/guest間で必ず一致させるため)
  const mastermonBotCount = Math.min((hostMastermonBots||[]).length, botCount);
  const slotOrder = seededShuffle(rng, Array.from({length:botCount}, (_,i)=>i));
  const slotToMastermon = new Map();
  for(let j=0;j<mastermonBotCount;j++){ slotToMastermon.set(slotOrder[j], hostMastermonBots[j]); }
  for(let i=0;i<botCount;i++){
    const sp = spawnPoints[spawnIdx++];
    const mmDef = slotToMastermon.get(i);
    if(mmDef){
      const ent = createMonster(mmDef.element, false, mmDef.name, { id: idCounter++, spawnPoint: sp });
      applyMastermonStatsToEntity(ent, mmDef);
      ent.isMastermonBot = true;
      ent.mastermonLevel = mmDef.level||1;
      if(mmDef.skin) ent.skinId = mmDef.skin;     // マスモンbotの着せ替えスキンを反映
      entities.push(ent);
    } else {
      const elKey = botElements[i % botElements.length];
      const nm = names[i % names.length] + (i>=names.length?'Ⅱ':'');
      entities.push(createMonster(elKey, false, nm, { id: idCounter++, spawnPoint: sp }));
    }
  }

  // マップ面積が縮んだ分だけアイテムの湧き数も比例して減らす
  const multiLootCount = Math.round(420 * MULTI_MAP_SCALE * MULTI_MAP_SCALE);
  seededSpawnLoot(lootRng, multiLootCount, ZONE_CENTER0, ZONE_PHASES[0].holdRadius*0.95);
  seededSpawnOasisBonusLoot(lootRng);
  updateCamera();

  window.__aramonWatchInputs(netState.roomId, (players)=>{
    netState.humanPlayers = players||{};
    for(const id in players){
      if(id===netState.myPlayerId) continue;
      if(players[id] && players[id].input) remoteInputs[id] = players[id].input;
    }
  });
  window.__aramonWatchEvents(netState.roomId, (evt)=>{
    // キルフィードはキル発生元(常にホスト)がkillEntity()で即座に一度表示済みなので、
    // 自分が送ったイベントがそのまま自分にも返ってくるホスト側では二重表示しない。
    // ゲスト側はこのイベント経由でしか受け取らないため、これで両者とも1回だけになる。
    if(evt && evt.kind==='kill' && evt.text && !netState.isHost) pushKillFeed(evt.text);
    if(evt && evt.kind==='matchEnd' && !game.over){
      if(player && player.netPlayerId===evt.winnerNetId && player.alive){
        onPlayerWin();
      } else if(player && player.netPlayerId!==evt.winnerNetId){
        // 自分は勝者ではない側。通常はhostが即時配信するauthStateのhp/alive更新で
        // 自然に結果画面へ移るが、通信の遅延等でそれが届かない場合に備えて、
        // 少し待っても試合が終わっていなければここで確実に終わらせる
        // (ゲスト側が生き残ったまま延々と試合が終わらないのを防ぐ保険)
        setTimeout(()=>{
          if(!game.over){ showResult(false, player.placement || (entities.filter(e=>e.alive).length+1)); }
        }, 500);
      }
    }
  });

  if(netState.isHost){
    window.__aramonWatchHitsAsHost(netState.roomId, (hitKey, hit)=>{
      if(processedHitKeys.has(hitKey)) return;
      processedHitKeys.add(hitKey);
      processHitAsHost(hit);
    });
    window.__aramonWatchFireEvents(netState.roomId, (evtKey, evt)=>{
      if(processedFireEventKeys.has(evtKey)) return;
      processedFireEventKeys.add(evtKey);
      pendingRemoteFireEvents.push(evt);
    });
  }
  window.__aramonWatchAuthState(netState.roomId, (authState)=>{
    if(authState && !netState.isHost) applyAuthState(authState);
  });
  if(!netState.isHost){
    window.__aramonWatchShotEvents(netState.roomId, (evtKey, evt)=>{
      spawnVisualShotFromEvent(evt);
    });
    window.__aramonWatchLootEvents(netState.roomId, (evtKey, evt)=>{
      if(processedLootEventKeys.has(evtKey)) return;
      processedLootEventKeys.add(evtKey);
      applyLootEventLocally(evt);
    });
  }

  document.getElementById('startScreen').classList.add('hidden');
  if(typeof applyHudLayout==='function') applyHudLayout(); // カスタマイズしたHUD配置を反映
  game.started=true;
  beginSummonIntro();   // 5秒の召喚演出 → 演出後に本戦開始(バトル開始SE/BGM)
}

// 他プレイヤーの入力を、対応するローカルエンティティに反映する
function applyRemoteInputsLocally(){
  for(const id in remoteInputs){
    if(id===netState.myPlayerId) continue;
    const ent = entities.find(e=>e.netPlayerId===id);
    if(!ent || !ent.alive) continue;
    const inp = remoteInputs[id];
    if(!inp) continue;
    ent.inputMoveX = clamp(inp.mx||0,-1,1);
    ent.inputMoveY = clamp(inp.my||0,-1,1);
    ent.facingAngle = typeof inp.facing==='number' ? inp.facing : ent.facingAngle;
    if(typeof inp.moveTierSelected==='number') ent.moveTierSelected = inp.moveTierSelected;
  }
}
// ホスト専用: 非ホストから届いた「1回発射しました」イベントを、届いた分だけ正確に処理する
const pendingRemoteFireEvents = [];
const processedFireEventKeys = new Set();
function processRemoteFireEvents(){
  while(pendingRemoteFireEvents.length){
    const evt = pendingRemoteFireEvents.shift();
    const ent = entities.find(e=>e.netPlayerId===evt.sourceNetId);
    if(!ent || !ent.alive) continue;
    ent.facingAngle = evt.facing;
    if(typeof evt.moveTier==='number') ent.moveTierSelected = evt.moveTier;
    const mv = activeMove(ent);
    if(ent.guts < effectiveGutsCost(ent, mv)) continue;
    // ③ ラグ補正: ゲストが撃った瞬間の自分の位置(fx,fy)から発射し、
    //   ゲストが見ていたホストseq(viewSeq)からの遅延ぶん、敵位置を巻き戻して当てる。
    const hasLagComp = (typeof evt.fx==='number' && typeof evt.fy==='number');
    const lagDelaySeq = (typeof evt.viewSeq==='number')
      ? Math.max(0, Math.min(HOST_HISTORY_CAP-1, authPublishSeq - evt.viewSeq)) : 0;
    const savedX=ent.x, savedY=ent.y;
    if(hasLagComp){ ent.x=evt.fx; ent.y=evt.fy; }
    let targetPoint;
    if(mv.melee){
      let best=null, bestD=mv.range;
      const dfx=Math.cos(ent.facingAngle), dfy=Math.sin(ent.facingAngle);
      for(const e2 of entities){
        if(e2===ent || !e2.alive) continue;
        if(e2.z - ent.z > UPWARD_BLOCK_THRESHOLD) continue;
        const rp = (hasLagComp && entityRewoundPos(e2.id, lagDelaySeq)) || e2; // 巻き戻し位置で判定
        const d = Math.hypot(rp.x-ent.x, rp.y-ent.y);
        if(d>mv.range) continue;
        const dirx=(rp.x-ent.x)/Math.max(d,0.001), diry=(rp.y-ent.y)/Math.max(d,0.001);
        if(dirx*dfx+diry*dfy>0.55 && d<bestD){ bestD=d; best=e2; }
      }
      targetPoint = best;
    } else {
      targetPoint = { x: ent.x+Math.cos(ent.facingAngle)*1000, y: ent.y+Math.sin(ent.facingAngle)*1000 };
    }
    const projBefore = projectiles.length;
    fireMove(ent, targetPoint, mv);
    ent.fireCooldown = effectiveCooldown(ent, mv);
    if(hasLagComp){
      ent.x=savedX; ent.y=savedY;
      // 生成された飛び道具に遅延量を刻む。飛翔中の当たり判定を「一定遅延の敵位置」で行う(combat.js)
      for(let k=projBefore; k<projectiles.length; k++) projectiles[k].lagDelaySeq = lagDelaySeq;
    }
  }
}

function sendLocalInputIfMultiplayer(now){
  if(netState.mode!=='multi' || !netState.roomId) return;
  if(now-lastInputSendAt >= INPUT_SEND_INTERVAL*1000){
    lastInputSendAt = now;
    window.__aramonSendInput(netState.roomId, {
      mx: player? player.inputMoveX:0,
      my: player? player.inputMoveY:0,
      facing: player? player.facingAngle:0,
      moveTierSelected: player? player.moveTierSelected:1,
    });
  }
}

// 自分が実際に1回発射した瞬間だけ、単発イベントとして送信する
// (ホストはこれを見て、非ホストの発射をシミュレーションに反映する)
function sendFireEventIfMultiplayer(aimAngle, mv){
  if(netState.mode!=='multi' || !netState.roomId || netState.isHost) return;
  window.__aramonSendFireEvent(netState.roomId, {
    sourceNetId: netState.myPlayerId,
    facing: aimAngle,
    moveTier: player.moveTierSelected,
    // ③ ラグ補正用: 撃った瞬間の自分の位置(予測=正確)と、その時見ていたホストseq
    fx: Math.round(player.x), fy: Math.round(player.y),
    viewSeq: guestCurViewSeq,
    ts: Date.now(),
  });
}

// 非ホスト専用: ダメージ・ガッツの確定計算はホストに任せつつ、
// クールダウン管理と「発射しました」イベント送信、体感のための見た目の弾だけを担当する
function tryNonHostPlayerFireVisual(dt){
  if(!player.alive || player.fireCooldown>0) return;
  if(!(fireBtnHeld || keys['f'])) return;
  const mv = activeMove(player);
  if(player.guts < effectiveGutsCost(player, mv)){ warnGutsShortage(); return; }
  const aimAngle = player.facingAngle;

  // クールダウン・見た目のガッツ消費だけローカルで進める(実値はホストのauthStateで上書きされる)
  player.fireCooldown = effectiveCooldown(player, mv);
  player.guts = Math.max(0, player.guts - effectiveGutsCost(player, mv));
  const effProjSpeed = effectiveProjSpeed(player, mv);
  const hbMult = ELEMENTS[player.element].hitboxMult || 1;
  const sp = moveSeName(mv, player); // tier3技の専用SE(無ければnull。ゼウス等のスキン専用SEも反映)
  // combat.jsのfireMoveと同じ見た目情報(スタイル・オーラ色・SSR色替え)を付与し、
  // ゲスト自身のtier3エフェクトがホストと同じ見た目で描画されるようにする
  const moveAura = (typeof getMoveAura==='function') ? getMoveAura(mv, player) : (mv.aura||null);
  const effColor = (typeof getMoveEffectColor==='function') ? getMoveEffectColor(mv, player) : mv.color;
  const auraTint = (mv.tier===3 && effColor !== mv.color) ? effColor : null;

  if(mv.aoeShape){
    const width = (mv.rectWidth||mv.beamWidth||mv.zigzagWidth||0) * hbMult;
    const fillSpeed = Math.max(200, effProjSpeed||900);
    const beamRanges = mv.aoeShape==='beams'
      ? Array.from({length:mv.beamCount||3}, (_,b)=>{
          const spread=(mv.beamSpreadDeg||40)*Math.PI/180, count=mv.beamCount||3;
          const off=count>1 ? (b/(count-1)-0.5)*spread : 0;
          return raycastObstacleDistance(player.x, player.y, aimAngle+off, mv.range);
        })
      : undefined;
    const reach = beamRanges ? Math.max(...beamRanges) : raycastObstacleDistance(player.x, player.y, aimAngle, mv.range);
    const life = 0.18 + reach/fillSpeed + 0.25;
    areaEffects.push({
      id:nextId++, ownerId:player.id, kind:mv.aoeShape, x:player.x, y:player.y, z:player.z,
      angle:aimAngle, color:effColor, range: beamRanges ? mv.range : reach, width,
      fanAngleDeg:mv.fanAngleDeg||45, beamCount:mv.beamCount||3, beamSpreadDeg:mv.beamSpreadDeg||40,
      beamRanges, fillSpeed, telegraphTime:0.18,
      spawnAt:matchTime, life, style:mv.aoeStyle||null, moveAura, auraTint,
    });
    playSe(sp || 'fire', sp ? { dur: life } : { kind:'aoe', dur: life });
  } else if(mv.lobbed){
    const throwDist = mv.range;
    const landX = player.x + Math.cos(aimAngle)*throwDist;
    const landY = player.y + Math.sin(aimAngle)*throwDist;
    const flightTime = throwDist / effProjSpeed;
    projectiles.push({
      x:player.x, y:player.y, z:player.z,
      lobbed:true, startX:player.x, startY:player.y, startZ:player.z,
      landX, landY, arcHeight: mv.arcHeight||120,
      flightTime: Math.max(0.05, flightTime), flightT:0,
      color:effColor, hitR:mv.hitR*hbMult, hitW:0, visualOnly:true, icon:mv.icon, shape:mv.shape,
      projStyle:mv.projStyle||null, moveAura,
    });
    playSe(sp || 'fire', sp ? { dur: Math.max(0.05, flightTime) } : { kind:'single' });
  } else if(mv.multiOrb){
    // ゴッドライジング等: 赤青黄緑の光球を放射線状に。見た目専用(当たり判定はホスト)
    const colors = mv.multiOrb;
    const orbAuras = mv.orbAuras || [];
    const n = colors.length;
    const spread = (mv.orbSpreadDeg||9)*Math.PI/180;
    for(let i=0;i<n;i++){
      const off = n>1 ? ((i-(n-1)/2)/(n-1))*spread : 0;
      const ang = aimAngle + off;
      projectiles.push({
        x:player.x, y:player.y, z:player.z,
        vx:Math.cos(ang)*effProjSpeed, vy:Math.sin(ang)*effProjSpeed,
        color:colors[i], hitR:(mv.hitR||24)*hbMult, hitW:0,
        traveled:0, maxRange:mv.range, delay:0, visualOnly:true,
        projStyle:'godorb', orbColor:colors[i], moveAura: orbAuras[i] || moveAura, matchAura: moveAura,
        ownerId: player.id,
      });
    }
    playSe(sp || 'fire', sp ? { dur: mv.range/effProjSpeed } : { kind:'single' });
  } else if(!mv.melee){
    const burstCount = mv.burst || 1;
    const burstGap = mv.burstGap || 0;
    for(let i=0;i<burstCount;i++){
      const spreadOffset = burstCount>1 ? (i-(burstCount-1)/2)*0.05 : 0;
      const ang = aimAngle + spreadOffset;
      projectiles.push({
        x:player.x, y:player.y, z:player.z,
        vx:Math.cos(ang)*effProjSpeed, vy:Math.sin(ang)*effProjSpeed,
        color:effColor, hitR:mv.hitR*hbMult, hitW:(mv.hitW||0)*hbMult,
        traveled:0, maxRange:mv.range, delay: i*burstGap, visualOnly:true, icon:mv.icon, shape:mv.shape,
        projStyle:mv.projStyle||null, moveAura, auraTint,
        growWithDistance: mv.growWithDistance||false, baseHitR: mv.hitR*hbMult, burstIndex:i,
        ownerId: player.id,
      });
    }
    playSe(sp || 'fire', sp ? { dur: mv.range/effProjSpeed } : { kind: mv.burst ? 'burst' : 'single' });
  } else {
    spawnHit(player.x + Math.cos(aimAngle)*mv.range*0.5, player.y + Math.sin(aimAngle)*mv.range*0.5, player.z, effColor);
    playSe('fire', { kind:'single' });
  }

  sendFireEventIfMultiplayer(aimAngle, mv);
}

// ===== ホスト専用: 命中報告を確定計算し、authStateとして配信 =====
const processedHitKeys = new Set();
let authPublishTimer = 0;
let authPublishInFlight = false;
const AUTH_PUBLISH_INTERVAL = 0.05; // 約20回/秒。高頻度配信+クライアント側補間で滑らかさを両立する

function processHitAsHost(hit){
  if(!hit) return;
  const target = entities.find(e=>
    (hit.targetNetId && e.netPlayerId===hit.targetNetId) || (!hit.targetNetId && e.id===hit.targetLocalId)
  );
  const source = hit.sourceNetId ? entities.find(e=>e.netPlayerId===hit.sourceNetId)
                 : (hit.sourceLocalId!=null ? entities.find(e=>e.id===hit.sourceLocalId) : null);
  if(!target || !target.alive) return;
  applyDamage(target, hit.dmg, source||null, {authoritative:true, moveAura: hit.moveAura||null, matchAura: hit.matchAura||null});
}

// 全エンティティ(ボット含む)を id(全クライアント共通の決定的な採番) をキーに配信する。
// 以前は netPlayerId を持つ人間プレイヤーしか配信していなかったため、非ホスト側でボットが
// 一切動かず止まって見える不具合の直接の原因になっていた。
// ホスト専用: 新しく発生した弾/範囲攻撃を検知し、取りこぼしのないイベントとして全員に配信する。
// (authStateのような周期上書き配信だと、寿命の短い弾は次の配信までに消えてしまい
//  「相手の弾が見えない」原因になるため、発生の瞬間を専用チャンネルで確実に届ける)
let lastBroadcastProjIds = new Set();
let lastBroadcastAeIds = new Set();
function broadcastNewShotsAsHost(){
  const curProjIds = new Set();
  for(const p of projectiles){
    if(p.id==null) continue;
    curProjIds.add(p.id);
    if(lastBroadcastProjIds.has(p.id)) continue;
    const owner = p.ownerId!=null ? entities.find(e=>e.id===p.ownerId) : null;
    window.__aramonPushShotEvent(netState.roomId, {
      type:'proj', sourceNetId: (owner && owner.netPlayerId) || null, ownerId: p.ownerId!=null ? p.ownerId : null,
      x:Math.round(p.x), y:Math.round(p.y), z:Math.round(p.z||0),
      vx:p.vx||0, vy:p.vy||0, color:p.color, hitR:p.hitR, hitW:p.hitW||0,
      maxRange:p.maxRange||0, icon:p.icon||null, shape:p.shape||null,
      projStyle:p.projStyle||null, orbColor:p.orbColor||null, auraTint:p.auraTint||null, moveAura:p.moveAura||null,
      lobbed:!!p.lobbed, landX:p.landX||0, landY:p.landY||0, arcHeight:p.arcHeight||0, flightTime:p.flightTime||0,
    });
  }
  lastBroadcastProjIds = curProjIds;

  const curAeIds = new Set();
  for(const ae of areaEffects){
    if(ae.id==null) continue;
    curAeIds.add(ae.id);
    if(lastBroadcastAeIds.has(ae.id)) continue;
    const owner = ae.ownerId!=null ? entities.find(e=>e.id===ae.ownerId) : null;
    window.__aramonPushShotEvent(netState.roomId, {
      type:'aoe', sourceNetId: (owner && owner.netPlayerId) || null,
      kind:ae.kind, x:Math.round(ae.x), y:Math.round(ae.y), angle:ae.angle, color:ae.color,
      range:ae.range, width:ae.width, fanAngleDeg:ae.fanAngleDeg, beamCount:ae.beamCount,
      beamSpreadDeg:ae.beamSpreadDeg, life:ae.life, fillSpeed:ae.fillSpeed, telegraphTime:ae.telegraphTime,
      beamRanges:ae.beamRanges||null, style:ae.style||null, auraTint:ae.auraTint||null, moveAura:ae.moveAura||null,
    });
  }
  lastBroadcastAeIds = curAeIds;
}
// 非ホスト専用: ホストから届いたアイテムの出現/取得イベントを、自分のlootItems配列にも反映する
const processedLootEventKeys = new Set();
function applyLootEventLocally(evt){
  if(!evt) return;
  if(evt.evtType==='pickup'){
    const idx = lootItems.findIndex(it=>it.id===evt.id);
    if(idx>=0) lootItems.splice(idx,1);
    // 自分(ゲスト)が拾った場合はSEを鳴らす(ホスト側updateでは自分のSEが鳴らないため)
    if(evt.by && evt.by===netState.myPlayerId) playSe(evt.kind==='training' ? 'train' : 'pickup');
  } else if(evt.evtType==='spawn'){
    if(!lootItems.find(it=>it.id===evt.id)){
      lootItems.push({ id:evt.id, kind:evt.kind, type:evt.itemType, x:evt.x, y:evt.y, bob:evt.bob||0 });
    }
  }
}
// 非ホスト専用: ホストから届いた発生イベントを、見た目専用の弾/範囲攻撃として即座に再現する
// (当たり判定・ダメージはホストのauthStateで届くHP側が正なので、ここでは一切計算しない)
function spawnVisualShotFromEvent(evt){
  if(!evt) return;
  // 自分が撃った弾は既にローカルで即座に描画済みなので、ホストからのエコーで二重に描画しない
  if(evt.sourceNetId && evt.sourceNetId===netState.myPlayerId) return;
  if(evt.type==='proj'){
    if(evt.lobbed){
      projectiles.push({
        x:evt.x, y:evt.y, z:evt.z, lobbed:true, startX:evt.x, startY:evt.y, startZ:evt.z,
        landX:evt.landX, landY:evt.landY, arcHeight:evt.arcHeight||120,
        flightTime:Math.max(0.05, evt.flightTime||1), flightT:0,
        color:evt.color, hitR:evt.hitR, hitW:0, visualOnly:true, icon:evt.icon||undefined, shape:evt.shape||undefined,
        projStyle:evt.projStyle||null, moveAura:evt.moveAura||null,
      });
    } else {
      projectiles.push({
        x:evt.x, y:evt.y, z:evt.z, vx:evt.vx, vy:evt.vy,
        color:evt.color, hitR:evt.hitR, hitW:evt.hitW||0,
        traveled:0, maxRange:evt.maxRange||2000, delay:0, visualOnly:true, icon:evt.icon||undefined, shape:evt.shape||undefined,
        projStyle:evt.projStyle||null, orbColor:evt.orbColor||undefined, auraTint:evt.auraTint||null, moveAura:evt.moveAura||null,
        ownerId: evt.ownerId!=null ? evt.ownerId : null,
      });
    }
  } else if(evt.type==='aoe'){
    areaEffects.push({
      hostId:null, kind:evt.kind, x:evt.x, y:evt.y, angle:evt.angle, color:evt.color,
      range:evt.range, width:evt.width, fanAngleDeg:evt.fanAngleDeg, beamCount:evt.beamCount,
      beamSpreadDeg:evt.beamSpreadDeg, spawnAt:matchTime, life:evt.life,
      fillSpeed:evt.fillSpeed||900, telegraphTime:evt.telegraphTime||0.18, beamRanges:evt.beamRanges||undefined,
      style:evt.style||null, auraTint:evt.auraTint||null, moveAura:evt.moveAura||null,
    });
  }
}

function buildAuthStatePayload(){
  authPublishSeq++;
  const seq = authPublishSeq;
  const full = (seq % AUTH_FULL_EVERY === 0); // ④ たまに静的値も載せる「フル」配信、それ以外は位置等の軽量配信
  const nowT = matchTime;                     // ② 速度算出の時刻基準(ホストのmatchTime秒)
  const payload = { seq, full, zone:{
    cx: Math.round(zoneState.center.x), cy: Math.round(zoneState.center.y),
    r: Math.round(zoneState.radius), phase: zoneState.phaseIndex, shrinking: zoneState.shrinking,
    tcx: Math.round(zoneState.toCenter.x), tcy: Math.round(zoneState.toCenter.y),
    tr: Math.round(zoneState.toRadius), hasNext: !!zoneState.hasNext,
  }, aliveCount: entities.filter(e=>e.alive).length, entities: [] };
  const hist = {}; // ③ ラグ補正用の位置履歴
  for(const e of entities){
    // ② 前回配信位置との差分から速度(px/秒)を求め、ゲストの外挿に使う
    const prev = lastPubPos[e.id];
    let vx=0, vy=0;
    if(prev){ const dtp = nowT - prev.t; if(dtp > 0.0001){ vx=(e.x-prev.x)/dtp; vy=(e.y-prev.y)/dtp; } }
    lastPubPos[e.id] = { x:e.x, y:e.y, t:nowT };
    hist[e.id] = { x: Math.round(e.x), y: Math.round(e.y) };
    // 毎tick載せる「ホット」フィールド(位置・向き・速度・HP・ガッツ・生存・キル等)
    const o = {
      id: e.id,
      x: Math.round(e.x), y: Math.round(e.y), z: Math.round(e.z||0),
      f: Math.round((e.facingAngle||0)*1000)/1000,
      vx: Math.round(vx*10)/10, vy: Math.round(vy*10)/10,
      hp: Math.round(e.hp), guts: Math.round(e.guts),
      alive: e.alive, kills: e.kills, damageDealt: Math.round(e.damageDealt),
      placement: e.placement||null,
    };
    // ④ フル配信の時だけ載せる「コールド」フィールド(ほぼ静的・低頻度で十分)
    if(full){
      o.maxHp = e.maxHp; o.maxGuts = e.maxGuts;
      o.moveTierUnlocked = e.moveTierUnlocked; o.moveTierSelected = e.moveTierSelected;
      o.trainCooldownMult = e.trainCooldownMult; o.trainGutsCostReduction = e.trainGutsCostReduction;
      o.trainProjSpeedMult = e.trainProjSpeedMult; o.trainDmgMult = e.trainDmgMult;
      o.trainDmgTakenMult = e.trainDmgTakenMult; o.trainSpeedMult = e.trainSpeedMult;
      o.stateUntil = e.stateUntil; o.stateCooldownUntil = e.stateCooldownUntil;
      o.dashCooldown = Math.round((e.dashCooldown||0)*100)/100;
    }
    payload.entities.push(o);
  }
  hostPosHistory.push({ seq, ents: hist });
  if(hostPosHistory.length > HOST_HISTORY_CAP) hostPosHistory.shift();
  return payload;
}

// 非ホスト側: 自分以外の全エンティティはホストの値へ「補間目標」を更新するだけにし、
// 実際の座標移動は毎フレームのlerpで滑らかに追従させる(loop()内で処理)。
// 自分自身は入力予測を活かしつつ、大きくズレた時だけ軽く補正する。
function applyAuthState(authState){
  if(!authState) return;
  if(authState.zone){
    zoneState.center.x = authState.zone.cx;
    zoneState.center.y = authState.zone.cy;
    zoneState.radius = authState.zone.r;
    zoneState.phaseIndex = authState.zone.phase;
    zoneState.shrinking = authState.zone.shrinking;
    if(typeof authState.zone.tcx === 'number'){
      zoneState.toCenter.x = authState.zone.tcx;
      zoneState.toCenter.y = authState.zone.tcy;
      zoneState.toRadius = authState.zone.tr;
      zoneState.hasNext = !!authState.zone.hasNext;
    }
  }
  const list = Array.isArray(authState.entities) ? authState.entities : [];
  const snapEnts = {}; // ① このスナップショットの位置(自分以外)を補間バッファへ
  for(const a of list){
    const ent = entities.find(e=>e.id===a.id);
    if(!ent) continue;
    if(ent.isPlayer){
      // 自分の位置はローカル予測を優先しつつ、常にごく僅かにホスト値へ寄せて収束させる
      // (閾値を超えたら一気に補正する方式だと、ラグ時に位置が飛んでピクつく原因になっていた)
      const driftDist = Math.hypot(ent.x-a.x, ent.y-a.y);
      if(driftDist > 260){
        ent.x=a.x; ent.y=a.y; // 壁抜け等で大きくズレた時だけ即補正
      } else {
        ent.netSelfTargetX = a.x; ent.netSelfTargetY = a.y;
      }
    } else {
      // 自分以外は位置を即書きせず、補間(interpolateRemoteEntities)で滑らかに動かす。
      // 初回だけは位置が無いので即座に配置しておく。
      if(typeof ent.x!=='number' || typeof ent.y!=='number'){ ent.x=a.x; ent.y=a.y; ent.z=a.z; ent.facingAngle=a.f; }
    }
    // 位置以外の権威フィールドは受信時に即反映する(補間しない)
    ent.hp = a.hp; ent.guts = a.guts;
    if(typeof a.maxHp==='number') ent.maxHp = a.maxHp;
    if(typeof a.maxGuts==='number') ent.maxGuts = a.maxGuts;
    ent.kills = a.kills; ent.damageDealt = a.damageDealt;
    if(a.placement!=null) ent.placement = a.placement;
    // moveTierSelectedは「今どの技を使うか」というプレイヤー自身の選択なので、
    // 自分自身の分だけはホストの(1往復遅れた)値で上書きしない(タップしてもすぐ元に戻る
    // チラつきの原因だった)。ボット・他プレイヤーの表示用には引き続き反映する
    if(!ent.isPlayer && typeof a.moveTierSelected==='number') ent.moveTierSelected = a.moveTierSelected;
    if(typeof a.dashCooldown==='number') ent.dashCooldown = a.dashCooldown;
    if(typeof a.trainCooldownMult==='number') ent.trainCooldownMult = a.trainCooldownMult;
    if(typeof a.trainGutsCostReduction==='number') ent.trainGutsCostReduction = a.trainGutsCostReduction;
    if(typeof a.trainProjSpeedMult==='number') ent.trainProjSpeedMult = a.trainProjSpeedMult;
    if(typeof a.trainDmgMult==='number') ent.trainDmgMult = a.trainDmgMult;
    if(typeof a.trainDmgTakenMult==='number') ent.trainDmgTakenMult = a.trainDmgTakenMult;
    if(typeof a.trainSpeedMult==='number') ent.trainSpeedMult = a.trainSpeedMult;
    if(typeof a.stateUntil==='number') ent.stateUntil = a.stateUntil;
    if(typeof a.stateCooldownUntil==='number') ent.stateCooldownUntil = a.stateCooldownUntil;
    if(typeof a.moveTierUnlocked==='number' && a.moveTierUnlocked>ent.moveTierUnlocked){
      ent.moveTierUnlocked = a.moveTierUnlocked;
      if(ent.isPlayer && ent.moveTierSelected < ent.moveTierUnlocked) ent.moveTierSelected = ent.moveTierUnlocked;
    }
    if(ent.alive && !a.alive){
      ent.alive = false; ent.hp = 0;
      if(ent.isPlayer && !game.over) onPlayerDown();
    }
    if(!ent.isPlayer){
      snapEnts[a.id] = { x:a.x, y:a.y, z:a.z||0, f:a.f, vx:a.vx||0, vy:a.vy||0, alive:a.alive };
    }
  }
  // ① 受信時刻(ローカル)付きでスナップショットをバッファに積む
  guestSnapBuf.push({ rt: performance.now(), seq: authState.seq||0, ents: snapEnts });
  const cutoff = performance.now() - 1500;
  while(guestSnapBuf.length>2 && guestSnapBuf[0].rt < cutoff) guestSnapBuf.shift();
}
// ① 遠隔エンティティを「一定遅延の描画時刻」で直近2スナップショット間を補間(欠落時は②速度で外挿)
function interpolateRemoteEntities(){
  const buf = guestSnapBuf;
  if(buf.length===0) return;
  const renderT = performance.now() - INTERP_DELAY_MS;
  let s0=null, s1=null;
  for(let i=buf.length-1;i>=0;i--){
    if(buf[i].rt <= renderT){ s0=buf[i]; s1=buf[i+1]||null; break; }
  }
  if(!s0){ s0=buf[0]; s1=buf[1]||null; } // 描画時刻がバッファ最古より前 → 最古で代用
  guestCurViewSeq = s0.seq||0;            // ③ 今狙いを定めているホストseqを記録(発射イベントで送る)
  for(const e of entities){
    if(e===player || !e.alive) continue;
    const a0 = s0.ents[e.id];
    if(!a0) continue;
    if(s1 && s1.ents[e.id]){
      const a1 = s1.ents[e.id];
      const span = s1.rt - s0.rt;
      const alpha = span>0 ? clamp((renderT - s0.rt)/span, 0, 1) : 0;
      e.x = lerp(a0.x, a1.x, alpha); e.y = lerp(a0.y, a1.y, alpha);
      e.z = lerp(a0.z, a1.z, alpha); e.facingAngle = lerpAngleShort(a0.f, a1.f, alpha);
    } else {
      // 最新スナップより先(欠落/遅延) → 速度で短時間だけ外挿
      const ahead = Math.min(EXTRAP_CAP_MS, Math.max(0, renderT - s0.rt)) / 1000;
      e.x = a0.x + a0.vx*ahead; e.y = a0.y + a0.vy*ahead; e.z = a0.z; e.facingAngle = a0.f;
    }
  }
}


function loop(now){
  const dt = Math.min(0.05, (now-lastT)/1000);
  lastT = now;

  if(game.started && !game.over){
    if(introState.active){
      // 召喚演出中はmatchTimeを進めず、視点操作と演出のみ行う(ホスト/ゲスト共通)
      updateSummonIntro(dt);
    } else if(netState.mode!=='multi'){
      update(dt);
    } else if(netState.isHost){
      applyRemoteInputsLocally();
      processRemoteFireEvents();
      update(dt);
      broadcastNewShotsAsHost();
      sendLocalInputIfMultiplayer(now);
      authPublishTimer += dt;
      if(authPublishTimer >= AUTH_PUBLISH_INTERVAL && !authPublishInFlight){
        authPublishTimer = 0;
        authPublishInFlight = true;
        window.__aramonPublishAuthState(netState.roomId, buildAuthStatePayload())
          .catch(()=>{})
          .finally(()=>{ authPublishInFlight = false; });
      }
    } else {
      // 非ホスト: ダメージ・ガッツ・キル・ゾーン等の確定計算は一切行わず、
      // 自分の移動だけをローカルで滑らかに再現し、残りはホストからのauthState配信に委ねる
      updateCameraSnap(dt);
      computePlayerInput();
      if(player && player.alive){
        resolveMovement(player, dt);
        if(typeof player.netSelfTargetX==='number'){
          // ローカル予測を優先し、ホスト権威位置との差が小さいうちは補正しない(ラバーバンド防止)。
          // 障害物が同期されたので通常移動では差が小さく、ここを抑えるとゲストの操作が軽くなる。
          // 差が大きい時(衝突/ノックバック/大きなラグ)だけ差に応じて素早く寄せて破綻を防ぐ。
          const dx = player.netSelfTargetX - player.x, dy = player.netSelfTargetY - player.y;
          const d = Math.hypot(dx, dy);
          if(d > 110){
            const t = Math.min(1, dt*10);          // 大きくズレたら一気に
            player.x = lerp(player.x, player.netSelfTargetX, t);
            player.y = lerp(player.y, player.netSelfTargetY, t);
          } else if(d > 26){
            const t = Math.min(0.18, dt*1.8);      // 中程度は緩やかに
            player.x = lerp(player.x, player.netSelfTargetX, t);
            player.y = lerp(player.y, player.netSelfTargetY, t);
          } // d<=26 はローカル予測を信頼して補正しない
        }
      }
      for(const e of entities){
        if(!e.alive) continue;
        if(e.fireCooldown>0) e.fireCooldown -= dt;
        if(e.dashCooldown>0) e.dashCooldown -= dt;
        if(e.hitFlash>0) e.hitFlash -= dt;
      }
      interpolateRemoteEntities(); // ①② 自分以外は補間バッファから描画時刻の位置を再構成
      tryNonHostPlayerFireVisual(dt);
      // 自分が撃った見た目専用の弾だけをローカルで移動させる(当たり判定はホストが確定する)
      for(let i=projectiles.length-1;i>=0;i--){
        const p = projectiles[i];
        if(!p.visualOnly) continue;
        if(p.lobbed){
          p.flightT += dt;
          const t = clamp(p.flightT / p.flightTime, 0, 1);
          p.x = lerp(p.startX, p.landX, t);
          p.y = lerp(p.startY, p.landY, t);
          p.z = p.startZ + Math.sin(t*Math.PI)*p.arcHeight;
          if(t>=1){
            spawnHit(p.x,p.y,0,p.color);
            projectiles.splice(i,1);
          }
          continue;
        }
        if(p.delay>0){ p.delay -= dt; continue; }
        const step = Math.hypot(p.vx,p.vy)*dt;
        p.x += p.vx*dt; p.y += p.vy*dt; p.traveled += step;
        let visualHit = p.traveled >= p.maxRange;
        if(!visualHit){
          // 当たり判定・ダメージ計算はホストのauthState/hit報告が正なので、ここでは一切計算しない。
          // ただし見た目上は接触した瞬間に消さないと、弾が体を貫通していくように見えてしまうため、
          // 見た目専用の当たり「らしさ」判定だけをローカルで行う
          for(const e of entities){
            if(!e.alive || e.id===p.ownerId) continue;
            if(dist(p,e) < e.radius+(p.hitR||0)){ visualHit=true; spawnHit(e.x,e.y,e.z,p.color); break; }
          }
        }
        if(visualHit) projectiles.splice(i,1);
      }
      updateCamera();
      matchTime += dt;
      if(game.tipTimer>0) game.tipTimer -= dt;
      for(let i=particles.length-1;i>=0;i--){
        const p = particles[i];
        p.x += p.vx*dt; p.y += p.vy*dt;
        if(p.type==='text') p.vy += 60*dt;
        p.life -= dt;
        if(p.life<=0) particles.splice(i,1);
      }
      for(let i=areaEffects.length-1;i>=0;i--){
        if(matchTime - areaEffects[i].spawnAt > areaEffects[i].life) areaEffects.splice(i,1);
      }
      updateHUD();
      sendLocalInputIfMultiplayer(now);
    }
  }

  if(game.started) render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

