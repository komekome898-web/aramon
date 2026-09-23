/* =====================================================================
   探検モード(内部名 explore)― モードの進行
   ・ロビーのプレイモード「探検」→ 出発ボタン → exploreStart()。1人用(部屋は使わない)
   ・広いフィールド(MAPS.explore)を歩き回り、野生モンスターを倒して素材を集め、
     ベースキャンプの帰還ビーコンで持ち帰る。安置は無い。代わりに制限時間と力尽き回数で終わる
   ・**既存の「遠征」(放置で報酬が来る仕組み)とは別物。名前を混ぜない。**

   【分岐の入口は game.explore 1つ】(game.raid と同じ方式)
     ・全部の試合の入口(startGame / startShootingRange / raidStart / network.js の試合開始)の
       冒頭で exploreResetState() を呼ぶ。これを忘れると、探検の次に始めた通常の試合で
       game.explore が立ったままになり、勝敗判定が止まって試合が終わらなくなる
     ・既存の関数に足した分岐はすべて「if(game.explore) …」の早期分岐:
         combat.js  update()            … 安置の代わりに updateExplore(dt)
                    checkWin()          … 探検は通常の勝利判定で終わらない
                    killEntity()        … プレイヤーは死なずに exploreOnPlayerFaint へ(力尽き→キャンプで復活)
                    applyDamage()       … exploreDamageBlocked(復活直後の無敵・プレイヤー以外どうしの同士討ち無し)
                    updateBotAI()       … 野生(isExploreWild)は exploreWildAI
                    updateKillLeader()  … キルリーダーは出さない
         render.js  real3dの地面円       … exploreGroundMarks(ボスの大技の予告・帰還ビーコンの輪)
         ui.js      ロビーの入口 / 途中で抜ける / 結果画面(exploreShowResult / exploreExit)
     ・game.explore は world.js の game に初期値を置いていない(undefined=偽)。書くのは
       exploreResetState() と exploreStart() だけ

   【後続の担当が使う口】(段2: 野生AI・ボス・補給箱・HUD)
     exploreState.wild    … [{ id, region, element, homeX, homeY, respawnAt, dropped, pack, leader }] 野生の台帳
     exploreState.packs   … [{ id, region, element, homeX, homeY }] 群れ(縄張り)の台帳
     exploreState.bosses  … [{ id, bossId, region, nestX, nestY, engaged, broken, defeated }] ボスの台帳
                            (中身の状態は getEntity(id) の exState / exRage / exBroken / exPending を読む)
     exploreState.crates  … 補給箱の台帳 / exploreState.drops … 落ちている探検の品(どちらも explore_loot.js)
     exploreState.bag     … { 素材キー: 個数 } 今回拾った素材(持ち帰る前)
     exploreState.camp / spawn / beacon … ベースキャンプの中心・出発(復活)地点・帰還ビーコン
     exploreGainMaterial(key, n, x, y) … 素材を拾う入口(通知まで出す)。ボス・補給箱もここを呼ぶ
     exploreDropLoot(ent, table)       … 倒した/壊した相手から素材を弾けさせる入口(ルート担当が見た目を差し替える)
     exploreBossNest(regionId)         … ボスの巣の位置(フィールド担当の EXPLORE_FIELD_LAYOUT があればそちらが正)
     exploreBossEngaged(boss) / exploreBossDisengaged(boss, reason) … ボス戦の始まり/終わり(HUD・音担当が拾う)
     exploreMakeNoise(x, y, range)     … 音を立てる(射撃は自動で呼ばれる。狙撃銃の発砲音もここへ)
     exploreIsWeakPointHit(ent, z)     … 高さ z の命中が弱点か(狙撃担当が使う。ent.weakPoint の約束は data.js)
     updateExplore(dt)    … 毎フレーム(combat.js の update() から)。段2の処理はここへぶら下げる

   【段2で combat.js / render.js に足した早期分岐】(すべて game.explore か探検専用の印でしか通らない)
     combat.js  update()           … dt *= exploreTimeScale()(ボス討伐の瞬間の間)
                updateBotAI()      … 眠っている個体(exploreAsleep)は考えない / ボスは exploreBossAI
                resolveMovement()  … 眠っている個体は動かない / 野生とボスの歩き方は exploreResolveMove
                tryFire()          … 眠っている個体は撃たない
                applyDamage()      … exploreDmgTakenMult(弱点・転倒・眠り)と exploreOnDamaged(気づき・部位破壊)
                killEntity()       … ボスは exploreOnBossFelled(倒れる演出→消える)
                projHeightHits()   … 背の高い相手(ent.hitHeight。探検のボスだけが持つ)は頭まで当たる
     render.js  drawMonster()      … exploreLying(転倒・討伐で横倒し)/ ボスは頭上のHPと名前を出さない /
                                     exploreDrawMonsterUnder・Tint・Marks(オーラ・怒りの色・頭上の「!」「?」)
                render()           … exploreDrawScreen(ボスのHPバー・名前の札・咆哮・討伐完了・弾ける素材)
   ===================================================================== */

/* MAPS.explore はフィールド担当が data.js に作る。まだ無いとき(または読み込み順の都合)に備えて、
   荒野のリアル版を写した**最小の仮定義**をここで用意する。
   どちらの場合も exploreOnly を必ず立てる ―― isSelectableMap() がこの印で通常の抽選から外すので、
   「ランダム+リアルマップ」で探検のフィールドが当たることは無い(レイドの竜の火口で実際に起きた事故)。 */
(function ensureExploreMap(){
  if(typeof MAPS === 'undefined') return;
  if(!MAPS.explore){
    const base = MAPS['wild'+REAL_MAP_SUFFIX] || MAPS.wild;
    MAPS.explore = { ...base, key:'explore', label:'探検フィールド', previewIcon:'🧭',
      desc:'4つの地域とベースキャンプからなる探検モード専用のフィールド。' };
  }
  MAPS.explore.exploreOnly = true;
})();

function exploreEmptyState(){
  return {
    camp:null, spawn:null, beacon:null,
    beaconHold:0, beaconInside:false,
    faints:0, kills:0, bossKills:0,
    bag:{},
    wild:[], packs:[], bosses:[], crates:[],
    drops:[],           // 落ちている探検の品(補給箱・野生・ボスから。explore_loot.js)
    lootFx:[],          // 箱が開いた・品が落ちたときの地面の輪(explore_loot.js)
    fx:[],              // 弾ける素材のかけら(exploreDropLoot が積み、exploreDrawScreen が描く)
    banners:[],         // 画面の札(ボスの名前・怒り・部位破壊・討伐完了)
    slowmo:null,        // ボス討伐の瞬間の間(実時間で進む。exploreTimeScale)
    lastPlayerCd:0,     // プレイヤーの技の待ち時間(増えた=撃った=音を立てた)
    engagedBossId:null, // いま戦っているボス(exploreBossEngaged が入れる。HUD・音が読む)
    endsAt:0,
    finished:null,      // 終わったときの集計(exploreFinish が入れる。結果画面と撮影ハーネスが読む)
    hudSig:'',          // HUDの文字を書き換えるのは中身が変わったときだけ
  };
}
let exploreState = exploreEmptyState();

/* 探検の状態を初期値へ戻す。**試合を始める全経路の冒頭で必ず呼ぶ**(raidResetState の横)。 */
function exploreResetState(){
  game.explore = false;
  exploreState = exploreEmptyState();
  if(typeof sniperResetState==='function') sniperResetState();   // 狙撃の構え・倍率を持ち越さない
  const hudEl = document.getElementById('exploreHud');
  if(hudEl) hudEl.classList.add('hidden');
  const el = document.getElementById('hud');
  if(el) el.classList.remove('explore-mode');
  const ov = document.getElementById('exploreResultOverlay');
  if(ov) ov.classList.add('hidden');
  exploreLootReset();        // 拾った通知の行を消す(explore_loot.js)
}

// 出発するモンスターの名前(マスモンならその名前)
function explorePlayerName(){
  if(game.selectedMastermonKey){
    const mm = loadMastermons()[game.selectedMastermonKey];
    if(mm && mm.name) return mm.name;
  }
  return (typeof getDisplayNameFromInput==='function' && getDisplayNameFromInput()) || 'あなた';
}

/* 探検を始める。骨組みはレイド(raidStart)・射撃訓練場と同じ並び。 */
function exploreStart(){
  if(typeof resetMatchFinishAnim==='function') resetMatchFinishAnim();
  entities=[]; projectiles=[]; lootItems=[]; particles=[]; areaEffects=[]; pendingAoeCasts=[]; nextId=1;
  resetTrainCards();   // トレーニングカードの表示と待ち行列を必ず空にする(前の試合ぶんを持ち越さない)
  matchTime=0; game.over=false; game.tipTimer=0; lastGutsWarnAt=-Infinity;
  hostSpectating=false; spectateTargetId=null;
  /* 探検は部屋を使わないので netState はソロ扱い。lobbyMode は 'explore' のまま残るので、
     終わってロビーへ戻れば(exploreExit → syncNetStateToLobbyMode)選択は探検に残る。 */
  netState.mode='solo';
  netState.raid=false;
  introState.active=false;   // 召喚演出は挟まない(ベースキャンプから歩いて出発する)
  camState.yaw=0; camSnap.active=false;
  monsterScreenPos.clear();
  Object.keys(keys).forEach(k=>keys[k]=false);
  fireBtnHeld=false; joystick.active=false; joystick.nx=0; joystick.ny=0;
  if(typeof setAutoRun==='function') setAutoRun(false);
  joyKnobEl.style.transform='translate(0,0)';

  raidResetState();
  teamResetState();
  arenaResetState();
  exploreResetState();       // いったん初期化してから立て直す
  game.trainingRange=false; game.tutorialMatch=false; game.arena=false;
  game.explore=true;
  game.activeMapKey='explore';
  currentMap=MAPS.explore;
  applyStartPitchForMap();
  applyReal3DLayer();
  applyFxGlLayer(true);
  applyWorldScale(EXPLORE_WORLD_SCALE);
  initZone();
  exploreDisableZone();
  /* フィールドの生成はフィールド担当(world.js の exploreGenWorld)。まだ無ければ通常の生成で代わりにする。
     window 経由で見るのは、まだ定義が無い版でも未定義チェック(tools/undef_check.mjs)を通すため */
  if(typeof window.exploreGenWorld==='function') window.exploreGenWorld();
  else { genVolcanoAndLava(); genWater(); genOasisZones(); genRocks(); genCrystals(); genTerrain(); }
  exploreSetupCamp();

  player = createMonster(game.selectedElement, true, explorePlayerName(), { spawnPoint: exploreState.spawn });
  applyMastermonToPlayer();
  // 工房で作った装備の効果(explore_loot.js)。**探検の開始時だけ**掛ける=PvPの力関係は変えない
  exploreApplyGear(player);
  // 探検は狩りのモード。最初から全部の技を使える(レイドと同じ扱い)
  player.moveTierUnlocked = 3;
  player.moveTierSelected = 1;
  entities.push(player);

  exploreSpawnBosses();      // 巣を先に決める(野生の縄張りを巣から離すため)
  exploreSpawnWild();
  exploreSpawnLoot();
  exploreState.endsAt = EXPLORE_TIME_LIMIT;

  // 最初は帰還ビーコン(=キャンプの中心側)を向いて立つ。帰る場所が最初に目に入る
  camState.yaw = angTo(exploreState.spawn, exploreState.beacon);
  player.facingAngle = camState.yaw;
  updateCamera();

  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('resultScreen').classList.add('hidden');
  const hudEl = document.getElementById('hud');
  if(hudEl) hudEl.classList.add('explore-mode');
  const ehud = document.getElementById('exploreHud');
  if(ehud) ehud.classList.remove('hidden');
  if(typeof applyHudLayout==='function') applyHudLayout();
  game.started = true;
  bgmSetTrack('battle');
  pushToast('🧭 探検開始！ 素材を集めて、キャンプの帰還ビーコンで持ち帰ろう');
}

/* 安置は使わない。射撃訓練場と同じく「ワールド全体より大きい輪」にして縮めない。
   輪は3D側・コンパスとも「遠すぎるものは描かない」ので、画面には何も出ない。 */
function exploreDisableZone(){
  zoneState.radius = WORLD.w*3;
  zoneState.fromRadius = zoneState.toRadius = zoneState.radius;
  zoneState.shrinking = false; zoneState.hasNext = false;
}

// ベースキャンプ・出発地点・帰還ビーコンを決める(位置の正は data.js の EXPLORE_CAMP)
function exploreSetupCamp(){
  const cx = WORLD.w*EXPLORE_CAMP.xr, cy = WORLD.h*EXPLORE_CAMP.yr;
  exploreState.camp = { x:cx, y:cy, r:EXPLORE_CAMP.radius };
  // フィールド生成がまだ無いとき(仮のフィールド)だけ、キャンプの中の岩・水晶を取り除く。
  // exploreGenWorld があるときはキャンプの作りごと向こうの担当なので触らない
  if(typeof window.exploreGenWorld!=='function'){
    rocks = rocks.filter(r=> Math.hypot(r.x-cx, r.y-cy) > EXPLORE_CAMP.radius + r.radius);
    crystalObstacles = crystalObstacles.filter(c=> Math.hypot(c.x-cx, c.y-cy) > EXPLORE_CAMP.radius + c.radius);
  }
  const sp = clearObstaclePoint(cx + EXPLORE_CAMP_SPAWN_OFFSET.dx, cy + EXPLORE_CAMP_SPAWN_OFFSET.dy, 60);
  exploreState.spawn = { x:sp.x, y:sp.y };
  exploreState.beacon = { x: cx + EXPLORE_BEACON_OFFSET.dx, y: cy + EXPLORE_BEACON_OFFSET.dy, r: EXPLORE_BEACON_RADIUS };
}

/* ルートを置く。主役は補給箱(explore_loot.js。開けると中身が弾けて光の柱が立つ)。
   それとは別に、通常の試合と同じ回復・ガッツ(spawnLoot)を少しだけ地面に撒く(箱の間の小さなご褒美) */
function exploreSpawnLoot(){
  const c = exploreState.camp;
  spawnLoot(EXPLORE_CAMP_LOOT_COUNT, { x:c.x, y:c.y }, c.r*1.6);
  for(const reg of EXPLORE_REGIONS){
    const rc = exploreRegionCircle(reg);
    spawnLoot(EXPLORE_REGION_LOOT_COUNT, { x:rc.x, y:rc.y }, rc.r*0.9);
  }
  exploreSpawnCrates();
}

/* =====================================================================
   野生モンスター(群れ・気づき・縄張り)
   ・群れ = リーダー1体+取り巻き(同じ種)。取り巻きはリーダーの周りの持ち場に寄り添って動く
   ・状態(b.exState):
       'wander' うろつく/立ち止まる  'alert' 気づいた瞬間に睨む(「!」)  'chase' 追う・技を撃つ
       'watch'  おとなしい種が様子を見る(「?」)  'flee' 逃げる  'return' 縄張りへ戻る(戻る間は回復)
   ・気づき(b.exAware 0〜1): 視界の扇+距離で上がり、1で「!」。0〜1の間は頭上に「?」。
     射撃の音(exploreMakeNoise)は視界の外でも届く。群れの1体が気づくと仲間も少し遅れて気づく
   ・判断は updateBotAI の間引き(0.22〜0.4秒ごと)で exploreWildAI が、歩き方は毎フレーム
     exploreResolveMove(combat.js の resolveMovement から)が受け持つ(普段はゆっくり歩く・距離を保つ等)
   ・遠い個体は眠らせる(b.exploreAsleep。combat.js の updateBotAI / resolveMovement / tryFire が見て止まる)
   ===================================================================== */
// 縄張りの中心を1つ選ぶ(地域の円の中・キャンプの外・障害物の外・巣と他の縄張りから離す)
function explorePickWildHome(rc, avoid){
  const camp = exploreState.camp;
  let p = null;
  for(let guard=0; guard<40; guard++){
    const a = rand(0, Math.PI*2), d = rc.r*0.85*Math.sqrt(rand(0,1));
    const x = clamp(rc.x + Math.cos(a)*d, 300, WORLD.w-300), y = clamp(rc.y + Math.sin(a)*d, 300, WORLD.h-300);
    if(camp && Math.hypot(x-camp.x, y-camp.y) < camp.r + 400) continue;
    if(typeof isOnHazard==='function' && isOnHazard(x, y, 80)) continue;
    if(guard < 30 && avoid.some(q=> Math.hypot(x-q.x, y-q.y) < q.r)) continue;
    p = { x, y }; break;
  }
  if(!p) p = { x:rc.x, y:rc.y };
  return clearObstaclePoint(p.x, p.y, 60);
}
function exploreMakeWild(elKey, reg, home, leader, packId){
  const el = ELEMENTS[elKey];
  const label = el ? el.label : elKey;
  const e = createMonster(elKey, false, leader ? `群れの長 ${label}` : `野生の${label}`, { spawnPoint:home });
  e.isExploreWild = true;
  e.exploreRegion = reg.id;
  e.exPackId = packId;
  e.exLeader = !!leader;
  e.homeX = home.x; e.homeY = home.y;
  // 危険度★で強さを段階化(体力・威力・速さ・使える技の段)。リーダーは一回り大きく硬い
  const dg = EXPLORE_WILD_DANGER[reg.danger] || EXPLORE_WILD_DANGER[1];
  const lm = leader ? EXPLORE_WILD_LEADER : null;
  e.maxHp = Math.round(e.maxHp * dg.hp * (lm ? lm.hp : 1)); e.hp = e.maxHp;
  e.mastermonDmgDealtMult = dg.dmg * (lm ? lm.dmg : 1);
  e.speed *= dg.speed;
  if(lm) e.radius = Math.round(e.radius * lm.radius);
  e.moveTierUnlocked = dg.tier;
  e.facingAngle = rand(0, Math.PI*2);
  e.exStrafeSign = Math.random() < 0.5 ? -1 : 1;
  exploreWildResetMind(e);
  return e;
}
// 気持ちを初期値へ(湧いた直後・湧き直し)
function exploreWildResetMind(e){
  e.exState = 'wander';
  e.exAware = 0; e.exAlertAt = -99; e.exAlertUntil = 0;
  e.exProvoked = false; e.exCallAt = null; e.exIgnoreUntil = 0;
  e.exChaseLostAt = null; e.exFleeUntil = 0; e.exThinkAt = null;
  e.exRestUntil = matchTime + rand(0, EXPLORE_WILD_REST_SEC.max);
  e.attackTargetId = null; e.aiTargetPoint = null; e.destination = null;
}
function exploreSpawnWild(){
  const avoid = exploreState.bosses.map(b=> ({ x:b.nestX, y:b.nestY, r:EXPLORE_BOSS_NEST_RADIUS + 500 }));
  let packId = 0;
  for(const reg of EXPLORE_REGIONS){
    const rc = exploreRegionCircle(reg);
    for(let k=0; k<EXPLORE_WILD_PACKS_PER_REGION; k++){
      const elKey = reg.wild[(k + randInt(0, reg.wild.length-1)) % reg.wild.length];
      if(!ELEMENTS[elKey]) continue;
      const home = explorePickWildHome(rc, avoid);
      avoid.push({ x:home.x, y:home.y, r:900 });   // 次の群れは離して置く
      packId++;
      exploreState.packs.push({ id:packId, region:reg.id, element:elKey, homeX:home.x, homeY:home.y });
      const size = randInt(EXPLORE_WILD_PACK_SIZE.min, EXPLORE_WILD_PACK_SIZE.max);
      for(let i=0; i<size; i++){
        const leader = i === 0;
        // 取り巻きはリーダーの周りの持ち場(角度と距離)を1つずつ持つ
        const slotA = leader ? 0 : (i/(size-1))*Math.PI*2 + rand(-0.4, 0.4);
        const slotD = leader ? 0 : EXPLORE_WILD_PACK_SPREAD*rand(0.6, 1.1);
        const at = clearObstaclePoint(home.x + Math.cos(slotA)*slotD, home.y + Math.sin(slotA)*slotD, 40);
        const e = exploreMakeWild(elKey, reg, at, leader, packId);
        e.homeX = home.x; e.homeY = home.y;   // 縄張りは群れで1つ
        e.exSlotA = slotA; e.exSlotD = slotD;
        entities.push(e);
        exploreState.wild.push({ id:e.id, region:reg.id, element:elKey, homeX:home.x, homeY:home.y,
                                 respawnAt:0, dropped:false, pack:packId, leader });
      }
    }
  }
}
// 同じ群れの生きている仲間(自分を除く)
function exploreWildPackMates(b){
  const out = [];
  for(const w of exploreState.wild){
    if(w.pack !== b.exPackId || w.id === b.id) continue;
    const o = getEntity(w.id);
    if(o && o.alive) out.push(o);
  }
  return out;
}
// 群れの今のリーダー(元のリーダーが倒れていれば、生きている最初の仲間が代わりに率いる)
function exploreWildLeader(b){
  let first = null;
  for(const w of exploreState.wild){
    if(w.pack !== b.exPackId) continue;
    const o = getEntity(w.id);
    if(!o || !o.alive) continue;
    if(o.exLeader) return o;
    if(!first) first = o;
  }
  return first;
}
// 視界の扇+距離+遮る物。背後でも NEAR_SENSE の内側なら気配で分かる
function exploreWildSees(b, p, d){
  if(d < EXPLORE_WILD_NEAR_SENSE) return true;
  if(d > EXPLORE_WILD_SIGHT_RANGE) return false;
  const ang = angTo(b, p);
  if(Math.abs(angleDiff(ang, b.facingAngle)) > EXPLORE_WILD_SIGHT_DEG*Math.PI/360) return false;
  return raycastObstacleDistance(b.x, b.y, ang, d) >= d - 30;
}
// 気づいた瞬間(「!」)。立ち止まって睨み、群れの仲間へ伝える
function exploreWildAlert(b, p, pause){
  const now = matchTime;
  b.exState = 'alert';
  b.exAware = 1;
  b.exAlertAt = now;
  b.exAlertUntil = now + (pause != null ? pause : EXPLORE_WILD_ALERT_PAUSE);
  b.exploreNoticedAt = now;
  b.exCallAt = null;
  b.facingAngle = angTo(b, p);
  b.attackTargetId = null; b.aiTargetPoint = null;
  for(const o of exploreWildPackMates(b)){
    if(b.exProvoked) o.exProvoked = true;
    if((o.exState === 'wander' || o.exState === 'watch') && o.exCallAt == null)
      o.exCallAt = now + rand(EXPLORE_WILD_PACK_CALL.min, EXPLORE_WILD_PACK_CALL.max);
  }
}
function exploreWildStartReturn(b){
  b.exState = 'return';
  b.exAware = 0; b.exCallAt = null; b.exChaseLostAt = null;
  b.attackTargetId = null; b.destination = null;
  b.aiTargetPoint = { x: b.homeX + rand(-80, 80), y: b.homeY + rand(-80, 80) };
}
function exploreWildCalm(b){
  b.exState = 'wander';
  b.exAware = 0; b.exProvoked = false; b.exCallAt = null;
  b.exIgnoreUntil = matchTime + EXPLORE_WILD_RETURN_CALM_SEC;
  b.aiTargetPoint = null;
  b.exRestUntil = matchTime + rand(EXPLORE_WILD_REST_SEC.min, EXPLORE_WILD_REST_SEC.max);
}
// うろつく。リーダー(または一匹)は縄張りの中を歩いては立ち止まり、取り巻きはリーダーの周りの持ち場へ寄る
function exploreWildWander(b){
  const now = matchTime;
  b.attackTargetId = null;
  const leader = exploreWildLeader(b);
  if(leader && leader !== b){
    const tx = leader.x + Math.cos(b.exSlotA + leader.facingAngle*0.3)*b.exSlotD;
    const ty = leader.y + Math.sin(b.exSlotA + leader.facingAngle*0.3)*b.exSlotD;
    if(!b.aiTargetPoint || Math.hypot(b.aiTargetPoint.x - tx, b.aiTargetPoint.y - ty) > 70) b.aiTargetPoint = { x:tx, y:ty };
    else if(dist(b, b.aiTargetPoint) < 30 && Math.random() < 0.12) b.facingAngle += rand(-0.9, 0.9);   // 草を食むように向きを変える
    return;
  }
  if(b.aiTargetPoint && dist(b, b.aiTargetPoint) > 40) return;
  if(b.aiTargetPoint){
    b.aiTargetPoint = null;
    b.exRestUntil = now + rand(EXPLORE_WILD_REST_SEC.min, EXPLORE_WILD_REST_SEC.max);
  }
  if(now < b.exRestUntil){
    if(Math.random() < 0.15) b.facingAngle += rand(-1.1, 1.1);   // 立ち止まって辺りを見回す(視界の扇も動く)
    return;
  }
  for(let guard=0; guard<8; guard++){
    const a = rand(0, Math.PI*2), r = rand(80, EXPLORE_WILD_WANDER);
    const x = clamp(b.homeX + Math.cos(a)*r, 60, WORLD.w-60), y = clamp(b.homeY + Math.sin(a)*r, 60, WORLD.h-60);
    if(typeof isOnHazard==='function' && isOnHazard(x, y, 40)) continue;
    b.aiTargetPoint = { x, y };
    break;
  }
}
/* 野生の判断(combat.js の updateBotAI が isExploreWild のときだけ呼ぶ。0.22〜0.4秒ごと) */
function exploreWildAI(b){
  const now = matchTime;
  const dtAi = b.exThinkAt == null ? 0.3 : Math.min(0.6, now - b.exThinkAt);
  b.exThinkAt = now;
  const nat = exploreWildNature(b.element);
  const dHome = Math.hypot(b.x - b.homeX, b.y - b.homeY);
  const p = player;
  const pOk = !!(p && p.alive && !(p.exploreInvulnUntil > now));

  // 縄張りへ戻る途中は何にも気づかない(戻りきってから落ち着く)
  if(b.exState === 'return'){
    if(dHome < EXPLORE_WILD_WANDER*0.6) exploreWildCalm(b);
    else { b.attackTargetId = null; return; }
  }
  if(dHome > EXPLORE_WILD_LEASH){ exploreWildStartReturn(b); return; }
  if(b.exState === 'flee'){
    b.attackTargetId = null;
    if(now >= b.exFleeUntil) exploreWildStartReturn(b);
    return;
  }
  // 弱ると逃げる種(戦っている最中だけ)
  if(nat.fleeHp > 0 && b.hp < b.maxHp*nat.fleeHp && (b.exState === 'chase' || b.exState === 'alert')){
    b.exState = 'flee'; b.exFleeUntil = now + EXPLORE_WILD_FLEE_SEC;
    b.attackTargetId = null; b.aiTargetPoint = null;
    return;
  }
  const hostile = nat.temper === 'aggressive' || b.exProvoked;

  // ---- 気づき ----
  if(b.exState !== 'chase' && b.exState !== 'alert'){
    const d = pOk ? dist(b, p) : Infinity;
    const canNotice = pOk && now >= b.exIgnoreUntil;
    if(canNotice && exploreWildSees(b, p, d)){
      const near = 1 - clamp(d / EXPLORE_WILD_SIGHT_RANGE, 0, 1);
      b.exAware += dtAi / EXPLORE_WILD_NOTICE_SEC * (1 + near*near*3);
    } else {
      b.exAware -= dtAi / EXPLORE_WILD_FORGET_SEC;
    }
    if(canNotice && b.exCallAt != null && now >= b.exCallAt){ b.exAware = 1; b.exCallAt = null; }
    b.exAware = clamp(b.exAware, 0, 1);
    if(b.exAware >= 1 && canNotice){
      if(hostile){ exploreWildAlert(b, p); return; }
      b.exState = 'watch';   // おとなしい種: 見つめるだけで襲わない
    } else if(b.exState === 'watch' && b.exAware < 0.35){
      b.exState = 'wander';
    }
  }

  switch(b.exState){
    case 'alert':
      b.attackTargetId = null;
      if(pOk) b.facingAngle = angTo(b, p);
      if(now >= b.exAlertUntil){
        if(pOk){ b.exState = 'chase'; b.attackTargetId = p.id; b.destination = null; b.exChaseLostAt = null; }
        else exploreWildCalm(b);
      }
      return;
    case 'chase': {
      if(!pOk){ exploreWildCalm(b); return; }
      if(dist(b, p) > EXPLORE_WILD_CHASE_RANGE){
        if(b.exChaseLostAt == null) b.exChaseLostAt = now;
        else if(now - b.exChaseLostAt > EXPLORE_WILD_LOSE_SEC){
          // 見失った: 「?」を出しながら縄張りへ戻る
          exploreWildStartReturn(b);
          b.exAware = 0.6;
          return;
        }
      } else b.exChaseLostAt = null;
      b.attackTargetId = p.id; b.destination = null;
      return;
    }
    case 'watch':
      b.attackTargetId = null; b.aiTargetPoint = null;
      if(pOk) b.facingAngle = angTo(b, p);
      return;
    default:
      b.exState = 'wander';
      exploreWildWander(b);
  }
}
/* 音を立てる(プレイヤーの射撃は exploreUpdateWild が自動で呼ぶ。狙撃銃の発砲音もここへ)。
   好戦的な種・怒らせた群れは音の方へ気づき、おとなしい種は音のした方を振り向く。
   眠っているボスは巣の近くの音で目を覚ます。 */
function exploreMakeNoise(x, y, range){
  if(!game.explore || game.over) return;
  const now = matchTime;
  for(const w of exploreState.wild){
    const e = getEntity(w.id);
    if(!e || !e.alive || e.exploreAsleep) continue;
    if(e.exState === 'chase' || e.exState === 'alert' || e.exState === 'flee' || e.exState === 'return') continue;
    if(now < e.exIgnoreUntil) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if(d > range) continue;
    e.facingAngle = Math.atan2(y - e.y, x - e.x);
    const nat = exploreWildNature(e.element);
    if(nat.temper === 'aggressive' || e.exProvoked){
      if(e.exCallAt == null) e.exCallAt = now + rand(0.1, 0.35) + d/range*0.4;
    } else {
      e.exAware = Math.max(e.exAware, 0.6);
    }
  }
  for(const rec of exploreState.bosses){
    const b = getEntity(rec.id);
    if(!b || !b.alive) continue;
    if((b.exState === 'dormant' || b.exState === 'home') && Math.hypot(b.x - x, b.y - y) < EXPLORE_BOSS_ENGAGE_RANGE*1.4)
      exploreBossStartRoar(b, 'intro');
  }
}
/* 1歩進む(野生・ボスの共通)。岩・山を避ける角度と、引っかかったときの迂回は
   combat.js の resolveMovement と同じ考え方(stuckTimer / stuckLevel / avoidDirSign をそのまま使う) */
function exploreStep(m, ang, spd, dt){
  if(!(spd > 0)) return;
  const far = { x: m.x + Math.cos(ang)*600, y: m.y + Math.sin(ang)*600 };
  let a = computeObstacleAvoidAngle(m, far, ang);
  m.stuckTimer += dt;
  if(m.stuckTimer > 0.4){
    const moved = dist(m, m.stuckCheckPos);
    if(moved < spd*0.4*m.stuckTimer*0.35) m.stuckLevel = Math.min(m.stuckLevel+1, 6);
    else m.stuckLevel = Math.max(m.stuckLevel-1, 0);
    m.stuckCheckPos = { x:m.x, y:m.y };
    m.stuckTimer = 0;
    if(m.stuckLevel >= 2 && Math.random() < 0.5) m.avoidDirSign *= -1;
    // うろつきで詰まったら目的地を捨てる(次の判断で選び直す)
    if(m.stuckLevel >= 4 && m.exState === 'wander') m.aiTargetPoint = null;
  }
  if(m.stuckLevel > 0) a += m.avoidDirSign * Math.min(m.stuckLevel*0.35, 1.9);
  const mx = Math.cos(a), my = Math.sin(a);
  tryMoveAxis(m, mx*spd*dt, my*spd*dt);
  m.lastMoveX = mx; m.lastMoveY = my;
}
/* 歩き方(combat.js の resolveMovement から毎フレーム。探検の野生・ボスだけ)。
   true を返すと通常の歩き方をしない。effSpeed は地形・状態変化を掛けた後の速さ。 */
function exploreResolveMove(m, dt, effSpeed){
  if(m.isExploreBoss) return exploreBossMove(m, dt, effSpeed);
  if(!m.isExploreWild) return false;
  const now = matchTime;
  const st = m.exState;
  const p = player;
  if(st === 'alert' || st === 'watch'){
    if(p) m.facingAngle = angTo(m, p);
    return true;   // 立ち止まって睨む/見つめる
  }
  if(st === 'flee'){
    if(!p) return true;
    const away = angTo(p, m);
    exploreStep(m, away, effSpeed*EXPLORE_WILD_FLEE_SPEED, dt);
    m.facingAngle = away;
    return true;
  }
  if(st === 'chase'){
    const t = getEntity(m.attackTargetId);
    if(!t || !t.alive) return true;
    const mv = activeMove(m);
    const nat = exploreWildNature(m.element);
    const keep = Math.max(m.radius + t.radius + 30, mv.range * (EXPLORE_WILD_KEEP_DIST[nat.style] || 0.7));
    const d = dist(m, t);
    const toT = angTo(m, t);
    if(d > keep + 60) exploreStep(m, toT, effSpeed, dt);
    else if(nat.style === 'kite' && d < keep - 110) exploreStep(m, toT + Math.PI, effSpeed*0.8, dt);   // 下がって間合いを保つ
    else {
      // 間合いの中では横へ回り込む(棒立ちにしない)。ときどき向きを変える
      if(now >= (m.exStrafeFlipAt || 0)){ m.exStrafeSign = -(m.exStrafeSign || 1); m.exStrafeFlipAt = now + rand(1.2, 2.8); }
      exploreStep(m, toT + m.exStrafeSign*Math.PI/2, effSpeed*0.42, dt);
    }
    m.facingAngle = toT;
    return true;
  }
  // うろつく / 戻る: 目的地へゆっくり(戻るときと、群れから離れた取り巻きは速め)
  const tp = m.aiTargetPoint;
  if(!tp) return true;
  const d = dist(m, tp);
  if(d < 6) return true;
  let mult = st === 'return' ? 0.85 : EXPLORE_WILD_WANDER_SPEED;
  if(st === 'wander' && !m.exLeader && d > EXPLORE_WILD_PACK_SPREAD*2) mult = 0.75;
  const ang = angTo(m, tp);
  exploreStep(m, ang, Math.min(effSpeed*mult, d/Math.max(dt, 1e-3)), dt);
  m.facingAngle = ang;
  return true;
}
// 倒された野生の後始末(落とし物)と湧き直し・遠い個体を眠らせる・音
function exploreUpdateWild(dt){
  const now = matchTime;
  const p = player;
  // プレイヤーが技を撃った(待ち時間が増えた)= 音を立てた
  if(p && p.alive){
    if(p.fireCooldown > exploreState.lastPlayerCd + 1e-3) exploreMakeNoise(p.x, p.y, EXPLORE_WILD_HEAR_RANGE);
    exploreState.lastPlayerCd = p.fireCooldown;
  }
  for(const w of exploreState.wild){
    const e = getEntity(w.id);
    if(!e) continue;
    if(e.alive){
      // 遠い個体は眠らせる(境目で寝起きを繰り返さないよう、起きる距離は少し内側)
      const d = p ? Math.hypot(e.x - p.x, e.y - p.y) : 0;
      if(e.exploreAsleep){ if(d < EXPLORE_WILD_ACTIVE_RADIUS - EXPLORE_WILD_SLEEP_HYST) e.exploreAsleep = false; }
      else if(d > EXPLORE_WILD_ACTIVE_RADIUS && e.exState !== 'chase') e.exploreAsleep = true;
      if(e.exploreAsleep) continue;
      // 技を撃てずに棒立ちにならないよう、野生だけガッツを多めに戻す
      if(e.guts < e.maxGuts) e.guts = Math.min(e.maxGuts, e.guts + EXPLORE_WILD_GUTS_REGEN*dt);
      // 縄張りへ戻る間は回復する
      if(e.exState === 'return' && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp*EXPLORE_WILD_RETURN_REGEN*dt);
      continue;
    }
    if(!w.dropped){
      w.dropped = true;
      w.respawnAt = now + EXPLORE_WILD_RESPAWN_SEC;
      // 倒したのが自分なら素材が弾ける
      if(p && e.lastAttackerId === p.id){
        exploreState.kills++;
        exploreDropLoot(e, exploreDropTable(e, 'kill'));
      }
      continue;
    }
    if(now < w.respawnAt) continue;
    if(!exploreRespawnHidden(w.homeX, w.homeY)) continue;
    const at = clearObstaclePoint(w.homeX + Math.cos(e.exSlotA||0)*(e.exSlotD||0), w.homeY + Math.sin(e.exSlotA||0)*(e.exSlotD||0), 40);
    e.alive = true;
    e.hp = e.maxHp; e.guts = e.maxGuts;
    e.x = at.x; e.y = at.y; e.z = baseTerrainHeightAt(e.x, e.y);
    e.hitFlash = 0;
    e.burnUntil = e.slowUntil = e.freezeUntil = e.poisonUntil = 0; e.pulledUntil = 0;
    e.lastAttackerId = null; e.recentAttackers = {};
    e.exploreAsleep = false;
    exploreWildResetMind(e);
    w.dropped = false;
  }
}
// 湧き直してよい場所か(プレイヤーから十分遠い、または見ていない方角・山の陰)
function exploreRespawnHidden(x, y){
  const p = player;
  if(!p) return true;
  const d = Math.hypot(x - p.x, y - p.y);
  if(d < EXPLORE_WILD_RESPAWN_HIDE) return false;
  if(d >= EXPLORE_WILD_RESPAWN_SEEN) return true;
  const inFront = Math.abs(angleDiff(Math.atan2(y - p.y, x - p.x), camState.yaw)) < 1.2;
  if(!inFront) return true;
  return typeof occludedByMountain==='function' && occludedByMountain(x, y, baseTerrainHeightAt(x, y) + 60);
}

/* =====================================================================
   ボス(地域ボス3体+頂点ボス1体。表は data.js の EXPLORE_BOSSES)
   ・状態(b.exState):
       'dormant' 巣でうろつく → 'roar' 咆哮(名前の札・画面揺れ)→ 'fight' 追う・大技
       'stagger' 部位破壊で転倒 / 'flee' 足を引きずって巣へ / 'sleep' 巣で眠って回復
       'home'    諦めて巣へ戻る / 'dying' 倒れた(討伐の演出。そのあと姿が消える)
   ・大技は 予告(b.exPending.marks = 地面の印)→ 発動 の2段。レイドの raidBeginBossAttack /
     raidFireBossAttack と同じ形の範囲攻撃(areaEffect)を出すが、**レイドの関数は触らずに探検用に
     分けてある**(レイドの挙動を変えない)。違いは メテオが時間差で落ちる・突進がある・怒りで速くなる。
   ・判断も歩き方も毎フレーム exploreUpdateBosses / exploreBossMove が持つ(updateBotAI は exploreBossAI で素通り)
   ===================================================================== */
function exploreBossDef(b){ return b ? EXPLORE_BOSSES.find(d=> d.id === b.exBossId) || null : null; }
/* ボスの巣。**フィールド担当の配置表(EXPLORE_FIELD_LAYOUT)に巣があればそちらが正**。
   読む形は bossNests[地域id] または regions[地域id].bossNest で、{x,y} か {xr,yr}(ワールド比)、r/rr は任意。
   無ければ地域の中心から「キャンプと反対側」へ地域の半径×EXPLORE_BOSS_NEST_OFFSET ずらした所。 */
/* EXPLORE_FIELD_LAYOUT はフィールド担当が data.js に const で置く予定(まだ無い版でも落ちないように)。
   const は window に載らないので、グローバルの名前を文字列で引く(未定義チェックも通る)。
   統合でこの表が入ったら、ここを直接の参照に書き換えてよい。 */
const _exploreFieldLayoutGetter = new Function("return (typeof EXPLORE_FIELD_LAYOUT !== 'undefined') ? EXPLORE_FIELD_LAYOUT : null;");
function exploreBossNest(regionId){
  const L = _exploreFieldLayoutGetter();
  if(L){
    const n = (L.bossNests && L.bossNests[regionId]) || (L.regions && L.regions[regionId] && L.regions[regionId].bossNest) || null;
    if(n && n.x != null && n.y != null) return { x:n.x, y:n.y, r:n.r || EXPLORE_BOSS_NEST_RADIUS, fromLayout:true };
    if(n && n.xr != null && n.yr != null)
      return { x:WORLD.w*n.xr, y:WORLD.h*n.yr, r: n.r || (n.rr ? WORLD.w*n.rr : EXPLORE_BOSS_NEST_RADIUS), fromLayout:true };
  }
  const reg = exploreRegion(regionId);
  if(!reg) return null;
  const c = exploreRegionCircle(reg);
  const a = Math.atan2(c.y - WORLD.h*EXPLORE_CAMP.yr, c.x - WORLD.w*EXPLORE_CAMP.xr);
  return { x: c.x + Math.cos(a)*c.r*EXPLORE_BOSS_NEST_OFFSET, y: c.y + Math.sin(a)*c.r*EXPLORE_BOSS_NEST_OFFSET,
           r: EXPLORE_BOSS_NEST_RADIUS, fromLayout:false };
}
/* 体の高さ(ワールド単位)。drawMonster が描く絵の高さ(2×半径×BODY_H_RATIO×描画倍率)と同じ式。
   弱点(weakPoint)の高さの基準で、狙撃担当もここを読む。 */
function exploreBodyHeight(ent){
  if(!ent) return 0;
  const ds = (typeof entityDrawScale==='function') ? entityDrawScale(ent) : 1;
  return 2 * ent.radius * BODY_H_RATIO * (ds || 1);
}
// 高さ z(ワールド)で当たった命中が弱点か。ent.weakPoint が無ければ常に false
function exploreIsWeakPointHit(ent, z){
  const wp = ent && ent.weakPoint;
  if(!wp) return false;
  const h = exploreBodyHeight(ent), base = ent.z || 0;
  return z >= base + wp.from*h && z <= base + wp.to*h;
}
function exploreSpawnBosses(){
  for(const def of EXPLORE_BOSSES){
    if(!ELEMENTS[def.element]) continue;
    const nest = exploreBossNest(def.region);
    if(!nest) continue;
    // 仮のフィールド(配置表に巣が無い)だけ、巣の中の岩・水晶を取り除いて巨体が歩ける広場にする
    if(!nest.fromLayout){
      rocks = rocks.filter(r=> Math.hypot(r.x-nest.x, r.y-nest.y) > nest.r + r.radius);
      crystalObstacles = crystalObstacles.filter(c=> Math.hypot(c.x-nest.x, c.y-nest.y) > nest.r + c.radius);
    }
    const sp = clearObstaclePoint(nest.x, nest.y, def.radius + 40);
    const b = createMonster(def.element, false, def.name, { spawnPoint:sp });
    b.isExploreBoss = true;
    b.exBossId = def.id;
    b.exploreRegion = def.region;
    b.skinId = def.skinId;        // 見た目は既存のSSRスキン(歩行コマもそのスキンのもの)
    b.radius = def.radius;
    b.speed = def.speed;
    b.maxHp = def.hp; b.hp = b.maxHp;
    b.guts = 0; b.maxGuts = 0;    // ボスは技をガッツで撃たない(大技は専用の予告→発動)
    b.moveTierUnlocked = 1;
    b.exNestX = sp.x; b.exNestY = sp.y; b.exNestR = nest.r;
    b.weakPoint = { ...EXPLORE_BOSS_WEAK_POINT };   // 狙撃担当との約束(data.js の EXPLORE_BOSS_WEAK_POINT)
    b.hitHeight = exploreBodyHeight(b) + 10;       // 頭まで弾が当たる(combat.js の projHeightHits)
    b.exState = 'dormant'; b.exStateUntil = 0;
    b.exRage = false; b.exFled = false; b.exBroken = false; b.exBreakDmg = 0;
    b.exPending = null; b.exCharge = null; b.exNextAttackAt = 0; b.exLastMove = null;
    b.exploreLying = false; b.exHpLag = 1; b.exRestUntil = 0;
    b.facingAngle = rand(0, Math.PI*2);
    entities.push(b);
    exploreState.bosses.push({ id:b.id, bossId:def.id, region:def.region, nestX:sp.x, nestY:sp.y,
                               engaged:false, broken:false, defeated:false });
  }
}
function exploreBossRecord(b){ return exploreState.bosses.find(r=> r.id === b.id) || null; }
// updateBotAI から(間引きの判断は使わない。全部 exploreUpdateBosses が毎フレーム見る)
function exploreBossAI(b){ b.attackTargetId = null; b.destination = null; }

/* ボス戦が始まった(登場の咆哮の瞬間)。**HUD・音担当はここに足す**(ボス戦BGMへの切替など)。 */
function exploreBossEngaged(boss){
  const rec = exploreBossRecord(boss);
  if(rec) rec.engaged = true;
  exploreState.engagedBossId = boss.id;
  exploreState.hudSig = '';
}
/* ボス戦が終わった。reason = 'defeated'(討伐) / 'lost'(離れて諦めた) / 'fled'(巣へ逃げた) */
function exploreBossDisengaged(boss, reason){
  const rec = exploreBossRecord(boss);
  if(rec && reason !== 'fled') rec.engaged = false;
  if(exploreState.engagedBossId === boss.id && reason !== 'fled') exploreState.engagedBossId = null;
  exploreState.hudSig = '';
}

// 咆哮。kind = 'intro'(登場。名前の札)/ 'rage'(怒り)/ 'wake'(眠りから覚めた)
function exploreBossStartRoar(b, kind){
  const now = matchTime;
  const def = exploreBossDef(b);
  b.exState = 'roar';
  b.exRoarKind = kind;
  b.exRoarAt = now;
  b.exStateUntil = now + (kind === 'intro' ? EXPLORE_BOSS_ROAR_SEC : EXPLORE_BOSS_RAGE_ROAR_SEC);
  b.exPending = null; b.exCharge = null; b.moveWithMoveUntil = 0;
  b.exploreLying = false;
  b.exploreAsleep = false;
  b.aiTargetPoint = null;
  if(player) b.facingAngle = angTo(b, player);
  playSe('fireRoar');
  if(kind === 'rage') playSe('godRising');
  // 近くで咆哮を浴びると耳をふさぐ(短い鈍足)
  if(player && dist(b, player) < EXPLORE_BOSS_ROAR_SLOW_RANGE)
    player.slowUntil = Math.max(player.slowUntil || 0, now + EXPLORE_BOSS_ROAR_SLOW_SEC);
  if(kind === 'intro'){
    exploreBanner('plate', { bossId:b.id, name:def.name, title:def.title, apex:!!def.apex, color:def.color, dur:3.4 });
    exploreBossEngaged(b);
  } else if(kind === 'rage'){
    exploreBanner('rage', { text:`${def.name}が怒り状態になった！`, color:'#ff4a3a', dur:2.0 });
  }
  exploreFxRoar(b, kind);
}
// 大技を選ぶ(相手との距離で出せる技に絞り、同じ技の連発は選ばれにくくする)
function exploreBossPickMove(b, def, d){
  d = Math.max(0, d - b.radius);   // 距離は体の縁から測る(data.js の EXPLORE_BOSS_MOVES の決まり)
  const pool = [];
  for(const k of def.moves){
    const mv = EXPLORE_BOSS_MOVES[k];
    if(!mv || (mv.rageOnly && !b.exRage)) continue;
    if(mv.minDist != null && d < mv.minDist) continue;
    if(mv.maxDist != null && d > mv.maxDist) continue;
    pool.push({ k, mv, w: (mv.w || 1) * (k === b.exLastMove ? 0.35 : 1) });
  }
  if(!pool.length) return null;
  let r = Math.random() * pool.reduce((s, o)=> s + o.w, 0);
  for(const o of pool){ r -= o.w; if(r <= 0) return o; }
  return pool[pool.length-1];
}
// 予告を出す(地面の印)。実際の範囲攻撃は exploreBossTickPending が時間になったら出す。
// forceKey は撮影ハーネス用(技を決め打ちする)。ふだんは渡さない
function exploreBossBeginAttack(b, def, t, forceKey){
  const now = matchTime;
  const d = dist(b, t);
  const pick = (forceKey && EXPLORE_BOSS_MOVES[forceKey]) ? { k:forceKey, mv:EXPLORE_BOSS_MOVES[forceKey] } : exploreBossPickMove(b, def, d);
  if(!pick) return false;
  const mv = pick.mv;
  const rage = b.exRage ? EXPLORE_BOSS_RAGE : null;
  const tele = mv.telegraph * (rage ? rage.telegraph : 1);
  const color = mv.color || def.color;
  const marks = [];
  let charge = null;
  if(mv.shape === 'fan'){
    const ang = angTo(b, t);
    b.facingAngle = ang;
    marks.push({ x:b.x, y:b.y, r:mv.range + b.radius, angle:ang, fanDeg:mv.fanAngleDeg, fireAt:now+tele });
  } else if(mv.shape === 'circle'){
    marks.push({ x:b.x, y:b.y, r:mv.range + b.radius, fireAt:now+tele });
  } else if(mv.shape === 'meteor'){
    for(let i=0; i<(mv.count||1); i++){
      // 1発目は足元、残りは周りへ散らす。時間差で順に落ちる
      const a = rand(0, Math.PI*2), s = i === 0 ? rand(0, 50) : rand(mv.spread*0.35, mv.spread);
      marks.push({ x:t.x + Math.cos(a)*s, y:t.y + Math.sin(a)*s, r:mv.range, fireAt: now + tele + i*(mv.stagger||0) });
    }
  } else if(mv.shape === 'charge'){
    const ang = angTo(b, t);
    b.facingAngle = ang;
    const len = Math.max(260, Math.min(mv.length, raycastObstacleDistance(b.x, b.y, ang, mv.length) - b.radius*0.6));
    // 予告は通り道に並ぶ円(体の幅)。突進は体ごと動くので、当たり判定はこの帯と同じ幅になる
    const n = clamp(Math.round(len / (b.radius*1.4)), 3, 6);
    for(let i=1; i<=n; i++){
      const f = i/n;
      marks.push({ x:b.x + Math.cos(ang)*len*f, y:b.y + Math.sin(ang)*len*f, r:b.radius + 26, fireAt:now+tele });
    }
    charge = { ang, len };
  }
  b.exPending = { key:pick.k, mv, marks, color, charge, startAt:now, fireAt:now+tele,
                  dmg: mv.dmg * (def.dmg || 1) * (rage ? rage.dmg : 1) };
  b.exLastMove = pick.k;
  playSe(mv.rageOnly ? 'godRising' : 'spin');
  return true;
}
// 範囲攻撃を1つ出す(当たり判定・描画は既存の areaEffect の仕組みに乗る)
function exploreBossSpawnAe(b, pend, kind, x, y, angle, range){
  const ae = {
    id:nextId++, ownerId:b.id, kind, x, y, z:0, angle: angle || 0,
    dmg: pend.dmg, color: pend.color, range, width:0,
    fanAngleDeg: pend.mv.fanAngleDeg || 45, beamCount:0, beamSpreadDeg:0,
    fillSpeed: Math.max(700, range/0.5), telegraphTime:0,
    spawnAt: matchTime, hitIds:new Set(), resolved:false,
    style:null, bindSec:0, moveAura:null, auraTint: pend.color,
    knockDist: pend.mv.knock || 0, knockSec:0.3,
    exploreBossAttack:true,
  };
  ae.life = range/ae.fillSpeed + 0.35;
  areaEffects.push(ae);
  return ae;
}
// 予告の消化。メテオは印ごとに時間差で、それ以外は一斉に発動する
function exploreBossTickPending(b, def){
  const pend = b.exPending;
  if(!pend) return;
  const now = matchTime;
  let done = false;
  if(pend.mv.shape === 'meteor'){
    for(const m of pend.marks){
      if(m.fired || now < m.fireAt) continue;
      m.fired = true;
      exploreBossSpawnAe(b, pend, 'circle', m.x, m.y, 0, m.r);
      exploreFxImpact(m.x, m.y, pend.color, m.r);
    }
    done = pend.marks.every(m=> m.fired);
    if(done) playSe('fire');
  } else if(now >= pend.fireAt){
    const m0 = pend.marks[0];
    if(pend.mv.shape === 'fan') exploreBossSpawnAe(b, pend, 'fan', m0.x, m0.y, m0.angle, m0.r);
    else if(pend.mv.shape === 'circle'){ exploreBossSpawnAe(b, pend, 'circle', m0.x, m0.y, 0, m0.r); exploreFxImpact(m0.x, m0.y, pend.color, m0.r); }
    else if(pend.mv.shape === 'charge') exploreBossStartCharge(b, pend);
    playSe(pend.mv.shape === 'charge' ? 'whoosh' : (pend.mv.rageOnly ? 'beam' : 'fire'));
    done = true;
  }
  if(!done) return;
  const gap = rand(def.gap[0], def.gap[1]) * (b.exRage ? EXPLORE_BOSS_RAGE.gap : 1);
  b.exNextAttackAt = now + gap + (b.exCharge ? Math.max(0, b.exCharge.until - now) : 0);
  b.exPending = null;
}
// 突進。体ごと一直線に走る(移動は既存の moveWithMove の仕組み)。触れたら1回だけ当たって弾き飛ばす
function exploreBossStartCharge(b, pend){
  const c = pend.charge;
  const spd = pend.mv.speed * (b.exRage ? EXPLORE_BOSS_RAGE.speed : 1);
  const dur = c.len / spd;
  b.moveWithMoveUntil = matchTime + dur;
  b.moveWithMoveDirX = Math.cos(c.ang); b.moveWithMoveDirY = Math.sin(c.ang);
  b.moveWithMoveSpeed = spd;
  b.exCharge = { until: matchTime + dur, hit:false, dmg:pend.dmg, knock:pend.mv.knock || 0, ang:c.ang, color:pend.color, dustAt:0 };
}
function exploreBossTickCharge(b){
  const c = b.exCharge;
  if(!c) return;
  const now = matchTime;
  if(now >= c.until){ b.exCharge = null; return; }
  const p = player;
  if(!c.hit && p && p.alive && dist(b, p) < b.radius + p.radius + 14){
    c.hit = true;
    applyDamage(p, c.dmg, b, {});
    // 進行方向の横へ弾き飛ばす(轢かれたように)
    const side = Math.sign(-Math.sin(c.ang)*(p.x-b.x) + Math.cos(c.ang)*(p.y-b.y)) || 1;
    const ka = c.ang + side*Math.PI/2*0.7;
    p.pulledUntil = now + 0.3;
    p.pulledX = p.x + Math.cos(ka)*c.knock; p.pulledY = p.y + Math.sin(ka)*c.knock;
    p.pulledSpeed = c.knock/0.3;
    if(typeof fxPunch==='function') fxPunch(0.8);
  }
  if(now >= c.dustAt){ c.dustAt = now + 0.06; exploreFxDust(b, c.color); }
}
// 部位破壊(弱点への蓄積が閾値を越えた)。印・追加の素材・転倒
function exploreBossBreakPart(b, def){
  b.exBroken = true;
  const rec = exploreBossRecord(b);
  if(rec) rec.broken = true;
  exploreBanner('break', { text:`部位破壊！ ${def.partName}`, color:'#ffd35a', dur:2.0 });
  pushKillFeed(`${def.name} の${def.partName}を破壊した`);
  playSe('iceCrack'); playSe('jakiin');
  exploreFxBreak(b, def.color);
  exploreDropLoot(b, exploreDropTable(b, 'break'));
  exploreBossTopple(b);
}
// 転倒(ひるみ)。横倒しになって大技を中断する
function exploreBossTopple(b){
  b.exState = 'stagger';
  b.exStateUntil = matchTime + EXPLORE_BOSS_TOPPLE_SEC;
  b.exPending = null; b.exCharge = null; b.moveWithMoveUntil = 0;
  b.exploreLying = true;
}
// 倒れた(combat.js の killEntity から。ボスは死なずにここへ来て、倒れる演出のあと消える)
function exploreOnBossFelled(b, killer){
  if(b.exState === 'dying') return;
  const def = exploreBossDef(b);
  const now = matchTime;
  b.hp = 0;
  b.exState = 'dying';
  b.exStateUntil = now + EXPLORE_BOSS_DYING_SEC;
  b.exPending = null; b.exCharge = null; b.moveWithMoveUntil = 0;
  b.exploreLying = true;
  const rec = exploreBossRecord(b);
  if(rec) rec.defeated = true;
  exploreState.bossKills++;
  // スローモーション風の間(実時間で進む。update() の dt に exploreTimeScale() が掛かる)
  exploreState.slowmo = { t0: performance.now() };
  exploreBanner('hunt', { name:def ? def.name : b.name, apex: !!(def && def.apex), color: def ? def.color : '#ffd35a', dur:4.2 });
  pushKillFeed(`${def ? def.name : b.name} を討伐した`);
  playSe('kill'); playSe('fanfare');
  exploreFxFelled(b, def ? def.color : '#ffd35a');
  exploreDropLoot(b, exploreDropTable(b, 'kill'));
  exploreBossDisengaged(b, 'defeated');
}
// 毎フレームのボスの進行
function exploreUpdateBosses(dt){
  const now = matchTime;
  const p = player;
  const pOk = !!(p && p.alive && !(p.exploreInvulnUntil > now));
  for(const rec of exploreState.bosses){
    const b = getEntity(rec.id);
    if(!b || !b.alive) continue;
    const def = exploreBossDef(b);
    if(!def) continue;
    if(b.exState === 'dying'){
      if(now >= b.exStateUntil){
        b.alive = false; b.exploreLying = false;
        spawnDeath(b.x, b.y, b.z, def.color);
        exploreFxVanish(b, def.color);
      }
      continue;
    }
    const d = p ? dist(b, p) : Infinity;
    // 巣でうろついている遠いボスは眠らせる(戦いの最中は眠らせない)
    const idle = b.exState === 'dormant' || b.exState === 'sleep';
    if(b.exploreAsleep){ if(!idle || d < EXPLORE_WILD_ACTIVE_RADIUS - EXPLORE_WILD_SLEEP_HYST) b.exploreAsleep = false; }
    else if(idle && d > EXPLORE_WILD_ACTIVE_RADIUS) b.exploreAsleep = true;
    if(b.exploreAsleep) continue;
    // ボスは凍らない・引き寄せられない(巨体。レイドのボスと同じ扱い)
    b.freezeUntil = 0; b.pulledUntil = 0;
    b.guts = 0; b.maxGuts = 0; b.attackTargetId = null;
    b.hitHeight = exploreBodyHeight(b) + 10;
    b.exHpLag = Math.max(b.hp/b.maxHp, (b.exHpLag || 1) - dt*0.35);   // HPバーの遅れて減る帯
    exploreBossTickCharge(b);
    const nestD = Math.hypot(b.x - b.exNestX, b.y - b.exNestY);
    const playerFarFromNest = !pOk || Math.hypot(p.x - b.exNestX, p.y - b.exNestY) > EXPLORE_BOSS_LEASH;
    switch(b.exState){
      case 'dormant':
        if(pOk && d < EXPLORE_BOSS_ENGAGE_RANGE){ exploreBossStartRoar(b, 'intro'); break; }
        // 巣の中をゆっくり歩き回る
        if(!b.aiTargetPoint || dist(b, b.aiTargetPoint) < 30){
          if(b.aiTargetPoint){ b.aiTargetPoint = null; b.exRestUntil = now + rand(3, 7); }
          else if(now >= b.exRestUntil){
            const a = rand(0, Math.PI*2), r = rand(80, b.exNestR*0.5);
            b.aiTargetPoint = { x: b.exNestX + Math.cos(a)*r, y: b.exNestY + Math.sin(a)*r };
          }
        }
        break;
      case 'roar': {
        // 咆哮の間は画面が揺れる(近いほど強い。長い揺れは短い揺れを重ねて作る)
        const k = 1 - clamp((now - b.exRoarAt) / Math.max(0.1, b.exStateUntil - b.exRoarAt), 0, 1);
        const near = 1 - clamp(d / 2600, 0, 1);
        if(typeof fxPunch==='function' && near > 0) fxPunch((0.25 + 0.45*k) * near);
        if(now >= b.exStateUntil){
          b.exState = 'fight';
          b.exNextAttackAt = now + (b.exRoarKind === 'intro' ? 0.6 : 0.3);
        }
        break;
      }
      case 'fight':
        if(playerFarFromNest){
          b.exState = 'home'; b.exPending = null; b.exCharge = null; b.moveWithMoveUntil = 0;
          exploreBossDisengaged(b, 'lost');
          break;
        }
        if(!b.exPending && !b.exCharge){
          if(!b.exFled && b.hp < b.maxHp*EXPLORE_BOSS_FLEE_HP){
            b.exFled = true; b.exState = 'flee';
            exploreBanner('info', { text:`${def.name}は足を引きずって巣へ逃げていく！`, color:'#ffe08a', dur:2.2 });
            exploreBossDisengaged(b, 'fled');
            break;
          }
          if(!b.exRage && b.hp < b.maxHp*EXPLORE_BOSS_RAGE_HP){ b.exRage = true; exploreBossStartRoar(b, 'rage'); break; }
          if(now >= b.exNextAttackAt && d < 1700){
            if(!exploreBossBeginAttack(b, def, p)) b.exNextAttackAt = now + 0.5;
          }
        }
        exploreBossTickPending(b, def);
        break;
      case 'stagger':
        if(now >= b.exStateUntil){
          b.exploreLying = false;
          b.exState = 'fight';
          b.exNextAttackAt = now + 0.8;
        }
        break;
      case 'flee':
        if(nestD < 90){
          b.exState = 'sleep';
          b.exStateUntil = now + EXPLORE_BOSS_SLEEP_SEC;
          b.exSleepHit = false;
          b.exploreLying = true;
        }
        break;
      case 'sleep':
        b.hp = Math.min(b.maxHp, b.hp + b.maxHp*EXPLORE_BOSS_SLEEP_HEAL/EXPLORE_BOSS_SLEEP_SEC*dt);
        if(now >= b.exStateUntil){
          b.exploreLying = false;
          if(pOk && d < EXPLORE_BOSS_ENGAGE_RANGE) exploreBossStartRoar(b, 'wake');
          else b.exState = 'dormant';
        }
        break;
      case 'home':
        if(b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + b.maxHp*EXPLORE_BOSS_HOME_REGEN*dt);
        if(pOk && !playerFarFromNest && d < EXPLORE_BOSS_ENGAGE_RANGE){ exploreBossStartRoar(b, 'wake'); exploreBossEngaged(b); break; }
        if(nestD < 90) b.exState = 'dormant';
        break;
    }
    if(b.exRage) exploreFxRage(b, dt);
  }
}
// ボスの歩き方(exploreResolveMove から)。予告中・咆哮中・転倒中・眠り中は動かない
function exploreBossMove(b, dt, effSpeed){
  const st = b.exState;
  const p = player;
  if(b.exPending || st === 'roar' || st === 'stagger' || st === 'sleep' || st === 'dying'){
    if(st === 'roar' && p) b.facingAngle = angTo(b, p);
    return true;
  }
  const now = matchTime;
  const rage = b.exRage ? EXPLORE_BOSS_RAGE.speed : 1;
  if(st === 'fight'){
    if(!p) return true;
    const d = dist(b, p), toP = angTo(b, p);
    const want = b.radius + 280;
    if(d > want + 80) exploreStep(b, toP, effSpeed*rage, dt);
    else {
      if(now >= (b.exStrafeFlipAt || 0)){ b.exStrafeSign = -(b.exStrafeSign || 1); b.exStrafeFlipAt = now + rand(2, 4); }
      exploreStep(b, toP + b.exStrafeSign*Math.PI/2, effSpeed*0.3*rage, dt);
    }
    b.facingAngle = toP;
    return true;
  }
  let tp = null, spd = effSpeed;
  if(st === 'flee'){
    tp = { x:b.exNestX, y:b.exNestY };
    // 足を引きずる: 遅いうえに、踏み出す/止まるの拍がある
    spd = effSpeed * EXPLORE_BOSS_LIMP_SPEED * (0.3 + 0.7*Math.abs(Math.sin(now*3.4)));
  } else if(st === 'home'){
    tp = { x:b.exNestX, y:b.exNestY };
  } else if(st === 'dormant'){
    tp = b.aiTargetPoint; spd = effSpeed*0.3;
  }
  if(!tp) return true;
  const d = dist(b, tp);
  if(d < 8) return true;
  const ang = angTo(b, tp);
  exploreStep(b, ang, Math.min(spd, d/Math.max(dt, 1e-3)), dt);
  b.facingAngle = ang;
  return true;
}

/* ===== 被弾の出入口(combat.js の applyDamage から) ===== */
/* 受けるダメージの倍率(applyDamage が HP を減らす直前に掛ける。探検以外では呼ばれない)。
   ・弱点: opts.weakPoint が真で相手が weakPoint を持つ → weakPoint.mult(**倍率はここ1か所だけで掛ける**)
   ・眠っているボスへの最初の一撃 → EXPLORE_BOSS_SLEEP_DMG_MULT / 転倒中 → EXPLORE_BOSS_TOPPLE_DMG_MULT */
function exploreDmgTakenMult(target, source, opts){
  let k = 1;
  if(opts && opts.weakPoint && target.weakPoint) k *= target.weakPoint.mult || 1;
  if(target.isExploreBoss){
    if(target.exState === 'sleep' && !target.exSleepHit) k *= EXPLORE_BOSS_SLEEP_DMG_MULT;
    else if(target.exploreLying && target.exState === 'stagger') k *= EXPLORE_BOSS_TOPPLE_DMG_MULT;
  }
  return k;
}
/* HPが減った直後(applyDamage から)。気づき・怒らせる・起こす・部位破壊の蓄積 */
function exploreOnDamaged(target, dmg, source, opts){
  if(!game.explore || !source || source === target) return;
  const byPlayer = !!source.isPlayer;
  if(target.isExploreWild && byPlayer){
    target.exploreAsleep = false;
    target.exProvoked = true;
    if(target.exState !== 'chase' && target.exState !== 'alert' && target.exState !== 'flee' && target.exState !== 'return')
      exploreWildAlert(target, source, 0.25);
    else if(target.exState === 'return'){ exploreWildAlert(target, source, 0.2); }   // 戻る途中でも撃たれたら振り返る
    for(const o of exploreWildPackMates(target)){
      o.exProvoked = true;
      o.exploreAsleep = false;
      if(o.exState !== 'chase' && o.exState !== 'alert' && o.exCallAt == null) o.exCallAt = matchTime + rand(0.15, 0.45);
    }
    return;
  }
  if(target.isExploreBoss && byPlayer && target.exState !== 'dying'){
    const def = exploreBossDef(target);
    target.exploreAsleep = false;
    const weak = !!(opts && opts.weakPoint);
    if(weak) spawnDmgText(target.x, target.y, (target.z||0) + exploreBodyHeight(target)*0.85, '弱点！', '#ffd35a', true);
    if(!target.exBroken && def){
      target.exBreakDmg += dmg * (weak ? 1 : EXPLORE_BOSS_BREAK_BODY_RATIO);
      if(target.exBreakDmg >= def.breakRatio * target.maxHp && target.hp > 0){ exploreBossBreakPart(target, def); return; }
    }
    if(target.exState === 'dormant' || target.exState === 'home') exploreBossStartRoar(target, target.exState === 'home' ? 'wake' : 'intro');
    else if(target.exState === 'sleep'){ target.exSleepHit = true; exploreBossStartRoar(target, 'wake'); exploreBossEngaged(target); }
  }
}

/* ダメージを通さない場面(combat.js の applyDamage から。弾・範囲技・爆風すべてに効く)
   ・復活直後の無敵(EXPLORE_RESPAWN_INVULN_SEC)
   ・野生どうし・ボスどうし・野生とボスの同士討ち(プレイヤー以外どうしは当たらない。
     流れ弾やボスの大技で野生が減って素材が消えるのを防ぐ)
   ・倒れたボス(討伐の演出の間) */
function exploreDamageBlocked(target, source){
  if(!game.explore) return false;
  if(target.isPlayer && target.exploreInvulnUntil > matchTime) return true;
  if(target.isExploreBoss && target.exState === 'dying') return true;
  if(source && source !== target && !source.isPlayer && !target.isPlayer) return true;
  return false;
}
// 討伐の瞬間の間(1=通常)。実時間で進むので、試合の時間を遅くしても必ず戻る
function exploreTimeScale(){
  const s = exploreState.slowmo;
  if(!s) return 1;
  const S = EXPLORE_BOSS_KILL_SLOWMO;
  const t = (performance.now() - s.t0) / 1000;
  if(t < S.holdSec) return S.scale;
  if(t < S.holdSec + S.easeSec) return S.scale + (1 - S.scale) * ((t - S.holdSec) / S.easeSec);
  exploreState.slowmo = null;
  return 1;
}

/* =====================================================================
   落とし物(倒した/壊した相手から素材が弾ける)
   **何を落とすかは data.js の exploreDropTable / EXPLORE_DROP_TABLES、落とす処理はこの関数1つ。**
   ルート担当が見た目(光の柱・拾う動き)を差し替えるときはここだけを直す。
   素材は地面へ弾けて落ち、レア度の光の柱が立つ(explore_loot.js の exploreSpawnDrop)。拾いに行くと入手。
   遠くから狙撃で倒しても、光の柱を目印に取りに行ける(APEX)。火花(fx_gl)だけはここで出す。
   ===================================================================== */
function exploreDropLoot(ent, table){
  if(!ent || !table || !game.explore || game.over) return [];
  const list = exploreRollDropTable(table);
  const big = !!ent.isExploreBoss;
  const z0 = big ? exploreBodyHeight(ent)*0.5 : 30;
  list.forEach((it, i)=>{
    const a = rand(0, Math.PI*2);
    const r0 = big ? ent.radius*0.9 : 30, r1 = big ? ent.radius*1.9 : 110;
    if(typeof exploreSpawnDrop==='function'){
      exploreSpawnDrop(ent.x, ent.y, it.key, null, { n:it.n, fromZ:z0, dist:[r0, r1], delay:i*0.06, angle:a });
    } else {
      exploreGainMaterial(it.key, it.n, ent.x + Math.cos(a)*r0, ent.y + Math.sin(a)*r0);
    }
    exploreSpawnMaterialBurst(ent, it.key, z0, i*0.05);
  });
  return list;
}
// 弾けた瞬間の火花(素材の色)。拾う品そのものは exploreSpawnDrop が地面に落とす
function exploreSpawnMaterialBurst(ent, key, z0, delay){
  const fx = window.__aramonFxGl;
  if(!(fx && fx.isActive && fx.isActive())) return;
  const big = !!ent.isExploreBoss;
  const c = exploreRgb(exploreMaterialColor(key));
  fx.burst({ x:ent.x, y:ent.y, z:(ent.z || 0) + z0, count: big ? 14 : 6, speed: big ? 320 : 180, elev:0.9, elevSpread:0.8,
             r:c[0], g:c[1], b:c[2], bright:1.2, life:0.7, size0: big ? 14 : 9, az:-420, delay:delay||0 });
}
function exploreUpdateFx(dt){
  const list = exploreState.fx;
  const p = player;
  for(let i=list.length-1; i>=0; i--){
    const f = list[i];
    f.t += dt;
    if(f.t < 0) continue;
    if(f.t > f.life){ list.splice(i, 1); continue; }
    const home = f.t > f.life*0.62;   // 最後はプレイヤーへ吸い込まれる
    if(home && p){
      const k = Math.min(1, dt*9);
      f.x += (p.x - f.x)*k; f.y += (p.y - f.y)*k; f.z += ((p.z||0) + 40 - f.z)*k;
      continue;
    }
    f.x += f.vx*dt; f.y += f.vy*dt; f.z += f.vz*dt;
    f.vz -= 1500*dt;
    const g = baseTerrainHeightAt(f.x, f.y) + 8;
    if(f.z < g){
      f.z = g;
      if(!f.bounced){ f.bounced = true; f.vz = Math.abs(f.vz)*0.35; f.vx *= 0.5; f.vy *= 0.5; }
      else { f.vz = 0; f.vx *= 0.8; f.vy *= 0.8; }
    }
  }
}

/* ===== 画面の札(ボスの名前・怒り・部位破壊・討伐完了)。描くのは exploreDrawBanners ===== */
function exploreBanner(kind, o){
  const list = exploreState.banners;
  // 同じ種類の札は差し替える(重ねて読めなくしない)。小さい札(怒り・部位破壊・逃走)は同じ場所なので1枚だけ
  const small = (k)=> k !== 'plate' && k !== 'hunt';
  for(let i=list.length-1; i>=0; i--) if(list[i].kind === kind || (small(kind) && small(list[i].kind))) list.splice(i, 1);
  list.push({ kind, t0:matchTime, dur:o.dur || 2, ...o });
}

/* ===== WebGL層(fx_gl.js)への演出。層が無い端末では何もしない(2Dの札と揺れだけで成立する) ===== */
// 2色を混ぜる(t=0で a、1で b)。#rrggbb どうしのみ
function exploreMixHex(a, b, t){
  const A = exploreRgb(a), B = exploreRgb(b);
  const h = (v)=> Math.round(clamp(v, 0, 1)*255).toString(16).padStart(2, '0');
  return '#' + h(A[0] + (B[0]-A[0])*t) + h(A[1] + (B[1]-A[1])*t) + h(A[2] + (B[2]-A[2])*t);
}
function exploreRgb(hex){
  const h = (typeof hex === 'string' && hex[0] === '#' && hex.length >= 7) ? hex : '#ffffff';
  return [parseInt(h.slice(1,3),16)/255, parseInt(h.slice(3,5),16)/255, parseInt(h.slice(5,7),16)/255];
}
function exploreFxLayer(){
  const fx = window.__aramonFxGl;
  return (fx && fx.isActive && fx.isActive()) ? fx : null;
}
function exploreFxRoar(b, kind){
  const fx = exploreFxLayer();
  if(!fx) return;
  const def = exploreBossDef(b);
  const c = exploreRgb(kind === 'rage' ? '#ff3a2a' : (def ? def.color : '#fff1d0'));
  const head = (b.z||0) + exploreBodyHeight(b)*0.8;
  for(let i=0; i<3; i++) fx.ring({ x:b.x, y:b.y, r0:b.radius*1.1, r1:b.radius*(2.6 + i*1.1), life:0.7 + i*0.25, color:c, width:12, bright:0.55 });
  if(fx.distort) for(let i=0; i<3; i++) fx.distort({ x:b.x, y:b.y, z:head, radius:b.radius*(2.2 + i), life:0.6 + i*0.2, strength:0.02, kind:'shock' });
  fx.burst({ x:b.x, y:b.y, z:(b.z||0) + 10, count:26, speed:260, elev:0.25, elevSpread:0.3, jitter:b.radius,
             r:0.55, g:0.48, b:0.40, bright:0.6, life:1.1, size0:34, az:-60, hot:0, turb:30 });
}
function exploreFxImpact(x, y, color, r){
  const fx = exploreFxLayer();
  if(!fx) return;
  const c = exploreRgb(color);
  const z = baseTerrainHeightAt(x, y);
  fx.burst({ x, y, z:z+10, count:18, speed:Math.max(200, r*1.3), elev:1.0, elevSpread:0.6, r:c[0], g:c[1], b:c[2], bright:1.1, life:0.8, size0:18 });
  fx.burst({ x, y, z:z+5, count:10, speed:160, elev:0.3, jitter:r*0.6, r:0.45, g:0.40, b:0.34, bright:0.5, life:1.2, size0:40, hot:0, az:-40, turb:20 });
}
function exploreFxDust(b, color){
  const fx = exploreFxLayer();
  if(!fx) return;
  fx.burst({ x:b.x - Math.cos(b.facingAngle)*b.radius*0.6, y:b.y - Math.sin(b.facingAngle)*b.radius*0.6, z:(b.z||0)+8,
             count:4, speed:120, elev:0.4, jitter:b.radius*0.8, r:0.55, g:0.5, b:0.42, bright:0.55, life:0.9, size0:44, hot:0, az:-30, turb:24 });
}
function exploreFxBreak(b, color){
  const fx = exploreFxLayer();
  if(!fx) return;
  const head = (b.z||0) + exploreBodyHeight(b)*0.85;
  const c = exploreRgb('#ffd35a');
  fx.burst({ x:b.x, y:b.y, z:head, count:34, speed:420, elev:0.6, elevSpread:1.4, r:c[0], g:c[1], b:c[2], bright:1.5, life:0.9, size0:16, stretch:0.5 });
  const c2 = exploreRgb(color);
  fx.burst({ x:b.x, y:b.y, z:head, count:16, speed:300, elev:0.8, elevSpread:1.2, r:c2[0], g:c2[1], b:c2[2], bright:0.9, life:1.2, size0:22, az:-700, hot:0 });
  if(typeof fxFlashAdd==='function') fxFlashAdd(0.6);
}
function exploreFxFelled(b, color){
  const fx = exploreFxLayer();
  if(typeof fxFlashAdd==='function') fxFlashAdd(1);
  if(!fx) return;
  const c = exploreRgb(color), g = exploreRgb('#ffd35a');
  const mid = (b.z||0) + exploreBodyHeight(b)*0.5;
  fx.burst({ x:b.x, y:b.y, z:mid, count:48, speed:560, elev:0.7, elevSpread:1.6, r:g[0], g:g[1], b:g[2], bright:1.1, life:1.3, size0:14, stretch:0.4 });
  fx.burst({ x:b.x, y:b.y, z:mid, count:24, speed:360, elev:0.6, elevSpread:1.4, r:c[0], g:c[1], b:c[2], bright:0.7, life:1.5, size0:20 });
  for(let i=0; i<2; i++) fx.ring({ x:b.x, y:b.y, r0:b.radius*1.1, r1:b.radius*(2.8 + i*1.4), life:0.9 + i*0.3, color:g, width:12, bright:0.6 });
}
function exploreFxVanish(b, color){
  const fx = exploreFxLayer();
  if(!fx) return;
  fx.burst({ x:b.x, y:b.y, z:(b.z||0)+20, count:36, speed:160, elev:0.9, elevSpread:0.5, jitter:b.radius*1.2,
             r:0.7, g:0.66, b:0.6, bright:0.5, life:1.8, size0:60, hot:0, az:40, turb:40 });
}
// 怒り中: 赤い火の粉が体から立ちのぼる(間引いて出す)
function exploreFxRage(b, dt){
  const fx = exploreFxLayer();
  if(!fx) return;
  b.exEmberAcc = (b.exEmberAcc || 0) + dt;
  if(b.exEmberAcc < 0.08) return;
  b.exEmberAcc = 0;
  const h = exploreBodyHeight(b);
  fx.burst({ x:b.x, y:b.y, z:(b.z||0) + h*0.3, count:3, speed:60, elev:1.3, elevSpread:0.4, jitter:b.radius*1.2, jitterZ:h*0.6,
             r:1.0, g:0.22, b:0.12, bright:1.2, life:1.1, size0:10, az:160, turb:30 });
}

/* =====================================================================
   描画(最低限。HUD担当が磨く前提で関数ごとに分けてある)
   ・頭上の「!」「?」・眠り・転倒の印 … exploreDrawMonsterMarks(render.js の drawMonster から)
   ・怒りの赤いオーラ / 赤い色味       … exploreDrawMonsterUnder / exploreDrawMonsterTint(同上)
   ・ボスのHPバー・名前の札・咆哮の文字・討伐完了・弾ける素材 … exploreDrawScreen(render.js の render から)
   ===================================================================== */
// 足元のオーラ(drawMonster の座標系=体の中心付近が原点、ワールド単位)
function exploreDrawMonsterUnder(e, uiMult){
  if(!e.isExploreBoss || !e.exRage || e.exState === 'dying') return;
  const pulse = 0.55 + 0.3*Math.sin(matchTime*6);
  // 体の輪郭に沿った赤いオーラ(絵の形の赤を少し大きく、ぼかして後ろに敷く)
  const img = (typeof getDisplayImage==='function') ? getDisplayImage(e) : null;
  if(img && !e.exploreLying){
    const L = portraitLayoutFor(e, img);
    const need = Math.max(L.dw, L.dh) * _monDrawScale * (typeof dpr!=='undefined' ? dpr : 1);
    const tint = exploreTintSprite(scaledSpriteFor(img, need), '#ff2a14');
    if(tint){
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const k = 1.07 + 0.03*Math.sin(matchTime*9);
      for(let i=0; i<2; i++){
        ctx.globalAlpha = (i ? 0.28 : 0.45) * pulse;
        const kk = i ? k*1.06 : k;
        ctx.drawImage(tint, -L.dw*kk/2, L.dy - L.dh*kk/2, L.dw*kk, L.dh*kk);   // 絵の中心を基準に広げる
      }
      ctx.restore();
    }
  }
  const rx = e.radius*1.5*uiMult, ry = e.radius*0.55*uiMult;
  ctx.save();
  ctx.translate(0, e.radius*0.7);
  ctx.scale(1, ry/rx);
  const g = ctx.createRadialGradient(0, 0, rx*0.2, 0, 0, rx);
  g.addColorStop(0, `rgba(255,60,40,${0.55*pulse})`);
  g.addColorStop(1, 'rgba(255,40,20,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}
// 怒り中の赤い色味(絵の形に合わせた赤を乗算で重ねる)。縮小版ごとに1回だけ作ってキャッシュする
const _exploreTintCache = new WeakMap();
function exploreTintSprite(spr, color){
  let byColor = _exploreTintCache.get(spr);
  if(!byColor){ byColor = {}; _exploreTintCache.set(spr, byColor); }
  if(byColor[color]) return byColor[color];
  const w = spr.width || spr.naturalWidth, h = spr.height || spr.naturalHeight;
  if(!w || !h) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(spr, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  byColor[color] = c;
  return c;
}
function exploreDrawMonsterTint(e, img, L){
  if(!e.isExploreBoss || !e.exRage || !img || !L || e.exState === 'dying') return;
  const need = Math.max(L.dw, L.dh) * _monDrawScale * (typeof dpr!=='undefined' ? dpr : 1);
  const spr = scaledSpriteFor(img, need);
  const tint = exploreTintSprite(spr, '#ff3a2a');
  if(!tint) return;
  ctx.save();
  ctx.globalAlpha = 0.5 + 0.12*Math.sin(matchTime*6);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(tint, -L.dw/2, -L.dh/2+L.dy, L.dw, L.dh);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.10 + 0.06*Math.sin(matchTime*6);
  ctx.drawImage(tint, -L.dw/2, -L.dh/2+L.dy, L.dw, L.dh);
  ctx.restore();
}
// 頭上の印。画面上の大きさは距離によらず一定(遠くの群れの「!」も読める)
function exploreDrawMonsterMarks(e, barY, uiMult){
  if(!game.explore || !e.alive) return;
  const now = matchTime;
  const s = Math.max(0.01, _monDrawScale);
  let mark = null;
  if(e.isExploreWild){
    const alertAge = now - (e.exAlertAt || -99);
    if(alertAge >= 0 && alertAge < EXPLORE_WILD_ALERT_SHOW) mark = { kind:'!', age:alertAge };
    else if(e.exState === 'flee') mark = { kind:'flee' };
    else if(e.exState === 'watch') mark = { kind:'?', fill:1, calm:true };
    else if((e.exState === 'wander' || e.exState === 'return') && e.exAware > 0.03) mark = { kind:'?', fill:e.exAware };
  } else if(e.isExploreBoss){
    if(e.exState === 'sleep') mark = { kind:'zzz' };
    else if(e.exState === 'stagger') mark = { kind:'dizzy' };
    else if(e.exState === 'flee') mark = { kind:'limp' };
  }
  if(e.isExploreBoss && e.exBroken && !e.exploreLying) exploreDrawBrokenMark(e, uiMult);
  if(!mark) return;
  const topY = e.isExploreBoss ? -(exploreBodyHeight(e)*(e.exploreLying ? 0.3 : 0.9)) : (barY - 22);
  ctx.save();
  ctx.translate(0, topY);
  ctx.scale(1/s, 1/s);            // ここから先は画面の画素
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  if(mark.kind === '!'){
    // 気づいた: 赤い丸の札に白い「!」(はじけるように出て、少し跳ねる)
    const pop = mark.age < 0.16 ? 1 + (1 - mark.age/0.16)*0.8 : 1;
    const fade = mark.age > EXPLORE_WILD_ALERT_SHOW - 0.3 ? (EXPLORE_WILD_ALERT_SHOW - mark.age)/0.3 : 1;
    ctx.globalAlpha = fade;
    ctx.translate(0, -16 - Math.abs(Math.sin(now*8))*3);
    ctx.scale(pop, pop);
    exploreBadge(13, '#ff3b30', '#b3120a');
    ctx.font = "bold 19px 'Russo One', sans-serif";
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('!', 0, 1);
  } else if(mark.kind === '?'){
    // 気づきかけ: 黒い丸の札に「?」と、気づくまでの進みの輪
    ctx.translate(0, -16);
    ctx.globalAlpha = mark.calm ? 0.9 : 0.65 + 0.35*mark.fill;
    exploreBadge(12, 'rgba(20,24,32,0.85)', 'rgba(0,0,0,0.9)');
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.strokeStyle = mark.calm ? '#9fdcff' : '#ffd23c';
    ctx.beginPath(); ctx.arc(0, 0, 12, -Math.PI/2, -Math.PI/2 + Math.PI*2*clamp(mark.fill, 0, 1)); ctx.stroke();
    ctx.font = "bold 16px 'Russo One', sans-serif";
    ctx.textBaseline = 'middle';
    ctx.fillStyle = mark.calm ? '#e6f6ff' : '#ffe27a';
    ctx.fillText('?', 0, 1);
  } else if(mark.kind === 'flee'){
    ctx.font = "bold 18px sans-serif";
    ctx.fillText('💦', 10, -4 - Math.abs(Math.sin(now*10))*4);
  } else if(mark.kind === 'zzz'){
    ctx.font = "bold 20px 'Russo One', sans-serif";
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,30,0.7)';
    for(let i=0;i<3;i++){
      const ph = (now*0.7 + i/3) % 1;
      ctx.globalAlpha = Math.sin(ph*Math.PI);
      const x = 18 + ph*26, y = -ph*40, sz = 0.7 + ph*0.6;
      ctx.save(); ctx.translate(x, y); ctx.scale(sz, sz);
      ctx.strokeText('Z', 0, 0); ctx.fillStyle = '#cfe0ff'; ctx.fillText('Z', 0, 0);
      ctx.restore();
    }
  } else if(mark.kind === 'dizzy'){
    // 転倒: 頭の周りを星が回る
    for(let i=0;i<4;i++){
      const a = now*4 + i*Math.PI/2;
      const x = Math.cos(a)*34, y = Math.sin(a)*9 + 8;
      ctx.globalAlpha = y > 8 ? 1 : 0.6;
      ctx.font = "bold 18px sans-serif";
      ctx.fillStyle = '#ffe45a';
      ctx.fillText('★', x, y);
    }
  } else if(mark.kind === 'limp'){
    ctx.font = "bold 13px 'Rajdhani', sans-serif";
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText('足を引きずっている', 0, 0);
    ctx.fillStyle = '#ffe08a'; ctx.fillText('足を引きずっている', 0, 0);
  }
  ctx.restore();
}
// 頭上の丸い札(画面の画素で描く)
function exploreBadge(r, fill, edge){
  ctx.save();
  if(!renderHeavyLoad){ ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(0,0,0,0.6)'; }
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.stroke();
  ctx.lineWidth = 1; ctx.strokeStyle = edge;
  ctx.beginPath(); ctx.arc(0, 0, r+1.6, 0, Math.PI*2); ctx.stroke();
  ctx.restore();
}
// 部位破壊の印(頭のあたりにひびの光)
function exploreDrawBrokenMark(e, uiMult){
  const h = exploreBodyHeight(e);
  ctx.save();
  ctx.translate(e.radius*0.1, -h*0.62);
  const k = e.radius/100;
  ctx.globalAlpha = 0.75 + 0.2*Math.sin(matchTime*5);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const path = [[-22,-18],[-8,-6],[-14,4],[4,10],[-2,22],[18,30]];
  ctx.strokeStyle = 'rgba(30,10,0,0.85)'; ctx.lineWidth = 7*k;
  ctx.beginPath(); path.forEach(([x,y],i)=>{ if(i) ctx.lineTo(x*k, y*k); else ctx.moveTo(x*k, y*k); }); ctx.stroke();
  ctx.strokeStyle = '#ffd35a'; ctx.lineWidth = 2.6*k;
  if(!renderHeavyLoad){ ctx.shadowBlur = 10; ctx.shadowColor = '#ffb020'; }
  ctx.beginPath(); path.forEach(([x,y],i)=>{ if(i) ctx.lineTo(x*k, y*k); else ctx.moveTo(x*k, y*k); }); ctx.stroke();
  ctx.restore();
}
// 画面の上に重ねる物(render.js の render() から。探検以外では何もしない)
function exploreDrawScreen(){
  if(!game.explore) return;
  exploreDrawMaterialFx();
  exploreDrawRoarText();
  exploreDrawBossHud();
  exploreDrawBanners();
}
function exploreDrawMaterialFx(){
  const list = exploreState.fx;
  if(!list.length) return;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for(const f of list){
    if(f.t < 0) continue;
    const p = project(f.x, f.y, f.z);
    if(!p) continue;
    const a = f.t > f.life - 0.15 ? Math.max(0, (f.life - f.t)/0.15) : 1;
    const sz = clamp(p.scale*22, 10, 30);
    ctx.globalAlpha = a;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz*1.3);
    g.addColorStop(0, f.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, sz*1.3, 0, Math.PI*2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = `${Math.round(sz)}px sans-serif`;
    ctx.fillText(f.icon, p.x, p.y);
  }
  ctx.restore();
}
// 咆哮の文字(ボスの頭の上で震える)
function exploreDrawRoarText(){
  for(const rec of exploreState.bosses){
    const b = getEntity(rec.id);
    if(!b || !b.alive || b.exState !== 'roar') continue;
    // 頭の右上に出す(真上だと画面上部の札・HPバーと重なる)
    const p = project(b.x, b.y, (b.z||0) + exploreBodyHeight(b)*0.88);
    if(!p) continue;
    const age = matchTime - b.exRoarAt, dur = Math.max(0.1, b.exStateUntil - b.exRoarAt);
    const a = age < 0.12 ? age/0.12 : (age > dur - 0.35 ? Math.max(0, (dur - age)/0.35) : 1);
    const rage = b.exRoarKind === 'rage';
    const sz = clamp(p.scale*70, 26, 64) * (age < 0.15 ? 1.4 - age/0.15*0.4 : 1);
    ctx.save();
    ctx.globalAlpha = a;
    const tx = Math.min(p.x + b.radius*p.scale*0.9 + sz*1.6, viewW - sz*3.4);   // 画面の右端で切れない
    const ty = Math.max(p.y, 150 + sz*0.5);                                      // 上端のHUD帯・HPバー・札の下
    ctx.translate(tx + rand(-4, 4), ty + rand(-4, 4));
    ctx.rotate(-0.08);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `italic bold ${Math.round(sz)}px 'Russo One', sans-serif`;
    const text = rage ? 'ガアァァッ!!' : 'グオオオオッ!!';
    ctx.lineWidth = Math.max(4, sz*0.14); ctx.strokeStyle = rage ? 'rgba(60,0,0,0.95)' : 'rgba(20,12,0,0.9)';
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = rage ? '#ff4a3a' : '#fff1d0';
    if(!renderHeavyLoad){ ctx.shadowBlur = 18; ctx.shadowColor = rage ? 'rgba(255,40,20,0.9)' : 'rgba(255,200,120,0.8)'; }
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}
// 画面上に出すボス(戦っている最中で、いちばん近いもの)
function exploreFocusBoss(){
  let best = null, bestD = Infinity;
  for(const rec of exploreState.bosses){
    const b = getEntity(rec.id);
    if(!b || !b.alive || !rec.engaged) continue;
    if(b.exState === 'dormant' || b.exState === 'home') continue;
    const d = player ? dist(b, player) : 0;
    if(d < EXPLORE_BOSS_HP_BAR_RANGE && d < bestD){ best = b; bestD = d; }
  }
  return best;
}
function exploreRoundRect(x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y); ctx.arcTo(x+w, y, x+w, y+h, r); ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r); ctx.arcTo(x, y, x+w, y, r); ctx.closePath();
}
// ボスのHPバー(画面上部の中央。探検のHUD帯の下)
function exploreDrawBossHud(){
  const b = exploreFocusBoss();
  if(!b) return;
  const def = exploreBossDef(b);
  if(!def) return;
  // 名前の札が出ている間は重ねない
  if(exploreState.banners.some(bn=> bn.kind === 'plate' && matchTime - bn.t0 < bn.dur - 0.4)) return;
  const w = clamp(viewW*0.4, 280, 600), x = (viewW - w)/2, y = 80;   // 探検のHUD帯(上端の時間・地域)の下
  const hpR = clamp(b.hp/b.maxHp, 0, 1), lag = clamp(b.exHpLag || hpR, hpR, 1);
  ctx.save();
  // 名前
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = "bold 11px 'Rajdhani', sans-serif";
  ctx.fillStyle = 'rgba(235,225,200,0.85)';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(def.title, x + 2, y - 18); ctx.fillText(def.title, x + 2, y - 18);
  ctx.font = "bold 17px 'Russo One', sans-serif";
  const nameText = (def.apex ? '👑 ' : '') + def.name;
  ctx.lineWidth = 4; ctx.strokeText(nameText, x + 2, y - 3);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(nameText, x + 2, y - 3);
  // 状態の札(右寄せ)
  const chips = [];
  if(b.exRage) chips.push({ t:'怒り', c:'#ff4a3a' });
  if(b.exBroken) chips.push({ t:'部位破壊', c:'#ffc93c' });
  if(b.exState === 'flee') chips.push({ t:'瀕死', c:'#ffe08a' });
  if(b.exState === 'sleep') chips.push({ t:'睡眠', c:'#9fc4ff' });
  if(b.exState === 'stagger') chips.push({ t:'転倒', c:'#ffe45a' });
  let cx = x + w;
  ctx.font = "bold 11px 'Rajdhani', sans-serif";
  for(const ch of chips){
    const tw = ctx.measureText(ch.t).width + 12;
    cx -= tw;
    exploreRoundRect(cx, y - 17, tw, 16, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
    ctx.strokeStyle = ch.c; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = ch.c; ctx.textAlign = 'center';
    ctx.fillText(ch.t, cx + tw/2, y - 5);
    ctx.textAlign = 'left';
    cx -= 5;
  }
  // バー
  const bh = 11;
  exploreRoundRect(x - 2, y + 2, w + 4, bh + 4, 4);
  ctx.fillStyle = 'rgba(8,10,16,0.78)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = 'rgba(255,238,190,0.8)';     // 遅れて減る帯
  ctx.fillRect(x, y + 4, w*lag, bh);
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  const base = b.exRage ? '#ff3a2a' : def.color;
  grad.addColorStop(0, exploreMixHex(base, '#000000', 0.35)); grad.addColorStop(1, exploreMixHex(base, '#ffffff', 0.2));
  ctx.fillStyle = grad;
  ctx.fillRect(x, y + 4, w*hpR, bh);
  // 怒り(50%)と逃走(20%)の目安の刻み
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  for(const t of [EXPLORE_BOSS_RAGE_HP, EXPLORE_BOSS_FLEE_HP]) ctx.fillRect(x + w*t - 1, y + 4, 2, bh);
  // 予告中の大技の名前
  if(b.exPending){
    const blink = 0.55 + 0.45*Math.abs(Math.sin(matchTime*9));
    ctx.globalAlpha = blink;
    ctx.textAlign = 'center';
    ctx.font = "bold 14px 'Rajdhani', sans-serif";
    const t = `⚠ ${b.exPending.mv.name}`;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(t, viewW/2, y + bh + 22);
    ctx.fillStyle = '#ffcf5a'; ctx.fillText(t, viewW/2, y + bh + 22);
  }
  ctx.restore();
}
// 画面の札(名前の札・怒り・部位破壊・逃走・討伐完了)
function exploreDrawBanners(){
  const list = exploreState.banners;
  for(let i=list.length-1; i>=0; i--) if(matchTime - list[i].t0 > list[i].dur) list.splice(i, 1);
  for(const bn of list){
    const age = matchTime - bn.t0;
    const a = age < 0.2 ? age/0.2 : (age > bn.dur - 0.45 ? Math.max(0, (bn.dur - age)/0.45) : 1);
    if(bn.kind === 'plate' || bn.kind === 'hunt') exploreDrawBigBanner(bn, age, a);
    else exploreDrawSmallBanner(bn, age, a);
  }
}
/* 大きい札。
   ・名前の札(plate): 画面の左寄り・縦の中ほど(MHの登場ムービーの名前と同じ置き方)。
     中央に置くとボス本体と咆哮の文字を隠す(撮影で確認)
   ・討伐完了(hunt): 画面の上寄りの中央。ボス本体の上で弾ける光(WebGL層は2Dより手前に重なる)を避ける */
function exploreDrawBigBanner(bn, age, a){
  const hunt = bn.kind === 'hunt';
  const slide = age < 0.3 ? (1 - age/0.3) : 0;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textBaseline = 'middle';
  if(hunt){
    const cy = Math.max(120, viewH*0.21), bandH = 82;
    const g = ctx.createLinearGradient(0, 0, viewW, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.22, 'rgba(10,8,4,0.74)');
    g.addColorStop(0.78, 'rgba(10,8,4,0.74)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, cy - bandH/2, viewW, bandH);
    const lg = ctx.createLinearGradient(0, 0, viewW, 0);
    lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(0.5, '#ffd35a'); lg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, cy - bandH/2, viewW, 2);
    ctx.fillRect(0, cy + bandH/2 - 2, viewW, 2);
    ctx.textAlign = 'center';
    const pop = age < 0.18 ? 1.35 - age/0.18*0.35 : 1;
    ctx.save();
    ctx.translate(viewW/2, cy - 8);
    ctx.scale(pop, pop);
    ctx.font = "bold 44px 'Russo One', sans-serif";
    ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(40,20,0,0.92)';
    ctx.strokeText('討伐完了', 0, 0);
    const tg = ctx.createLinearGradient(0, -24, 0, 20);
    tg.addColorStop(0, '#fff6c8'); tg.addColorStop(0.5, '#ffd35a'); tg.addColorStop(1, '#d88a1a');
    ctx.fillStyle = tg;
    if(!renderHeavyLoad){ ctx.shadowBlur = 20; ctx.shadowColor = 'rgba(255,190,60,0.85)'; }
    ctx.fillText('討伐完了', 0, 0);
    ctx.restore();
    ctx.font = "bold 15px 'Rajdhani', sans-serif";
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    const sub = `${bn.apex ? '頂点の主 ' : ''}${bn.name} を討伐した`;
    ctx.strokeText(sub, viewW/2, cy + 26);
    ctx.fillStyle = 'rgba(248,242,226,0.96)';
    ctx.fillText(sub, viewW/2, cy + 26);
  } else {
    const cy = viewH*0.54, bandH = 98;   // 左上の自分の欄・左下のスティックの間
    const x0 = Math.max(18, viewW*0.05) - slide*80;
    const bandW = Math.min(viewW*0.62, 620);
    const g = ctx.createLinearGradient(0, 0, bandW, 0);
    g.addColorStop(0, 'rgba(6,6,10,0.80)'); g.addColorStop(0.6, 'rgba(6,6,10,0.55)'); g.addColorStop(1, 'rgba(6,6,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, cy - bandH/2, bandW, bandH);
    const col = bn.color || '#ffd35a';
    ctx.fillStyle = col;
    ctx.fillRect(x0 - 10, cy - bandH/2 + 14, 4, bandH - 28);   // 左の縦線(ボスの色)
    ctx.textAlign = 'left';
    ctx.font = "bold 14px 'Rajdhani', sans-serif";
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(bn.title, x0, cy - 30);
    ctx.fillStyle = col;
    ctx.fillText(bn.title, x0, cy - 30);
    ctx.font = "bold 42px 'Russo One', sans-serif";
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.strokeText(bn.name, x0, cy + 4);
    ctx.fillStyle = '#ffffff';
    if(!renderHeavyLoad){ ctx.shadowBlur = 16; ctx.shadowColor = col; }
    ctx.fillText(bn.name, x0, cy + 4);
    ctx.shadowBlur = 0;
    ctx.font = "bold 13px 'Rajdhani', sans-serif";
    const tag = bn.apex ? '頂点ボス 出現' : '大型モンスター 出現';
    ctx.strokeText(tag, x0, cy + 36);
    ctx.fillStyle = bn.apex ? '#ffd35a' : 'rgba(235,230,215,0.92)';
    ctx.fillText(tag, x0, cy + 36);
  }
  ctx.restore();
}
function exploreDrawSmallBanner(bn, age, a){
  // ボスのHPバー(と予告の技名)が出ていればその下、無ければ上端のHUD帯の下。
  // 縦持ち(画面の縦が375)でもボスの体を隠しすぎないよう、小さく細い札にする
  const y = exploreFocusBoss() ? 128 : 92;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = "bold 15px 'Russo One', sans-serif";
  const pop = age < 0.15 ? 1.2 - age/0.15*0.2 : 1;
  ctx.translate(viewW/2, y);
  ctx.scale(pop, pop);
  const tw = ctx.measureText(bn.text).width + 28;
  exploreRoundRect(-tw/2, -13, tw, 26, 7);
  ctx.fillStyle = 'rgba(8,8,12,0.66)'; ctx.fill();
  ctx.strokeStyle = bn.color || '#ffd35a'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(bn.text, 0, 1);
  ctx.fillStyle = bn.color || '#ffd35a';
  ctx.fillText(bn.text, 0, 1);
  ctx.restore();
}

/* 力尽きた(killEntity から。プレイヤーは死なずにここへ来る)。
   上限に達していなければベースキャンプで復活(HP全快・短い無敵)、達したら終了。 */
function exploreOnPlayerFaint(p, killer){
  if(game.over) return;
  exploreState.faints++;
  spawnDeath(p.x, p.y, p.z, ELEMENTS[p.element].color);
  const who = (killer && killer !== p) ? displayNameFor(killer) : null;
  pushKillFeed(`${displayNameFor(p)} は力尽きた${who ? `（${who}）` : ''}`);
  if(exploreState.faints >= EXPLORE_MAX_FAINTS){
    p.hp = 0;
    exploreFinish('faint');
    return;
  }
  const sp = exploreState.spawn;
  p.hp = p.maxHp; p.guts = p.maxGuts;
  p.x = sp.x; p.y = sp.y; p.z = baseTerrainHeightAt(sp.x, sp.y);
  p.burnUntil = p.slowUntil = p.freezeUntil = p.poisonUntil = 0;
  p.pulledUntil = 0; p.dashTimer = 0; p.moveWithMoveUntil = 0; p.hitFlash = 0;
  p.exploreInvulnUntil = matchTime + EXPLORE_RESPAWN_INVULN_SEC;
  // 追っていた野生は見失って縄張りへ戻る(キャンプまで追いかけてこない)。ボスは巣へ戻る
  for(const e of entities){
    if(e.isExploreWild && e.alive && (e.exState === 'chase' || e.exState === 'alert')) exploreWildStartReturn(e);
    if(e.isExploreBoss && e.alive && (e.exState === 'fight' || e.exState === 'roar')){
      e.exState = 'home'; e.exPending = null; e.exCharge = null; e.moveWithMoveUntil = 0;
      exploreBossDisengaged(e, 'lost');
    }
  }
  updateCamera();
  playSe('sad');
  pushToast(`💫 力尽きた… ベースキャンプへ運ばれた（あと${EXPLORE_MAX_FAINTS - exploreState.faints}回で探検終了）`);
}

/* 素材を拾う入口。野生・ボス・補給箱のどこから拾ってもここを通す(数え方と通知を1か所にする)。
   x,y を渡すとその場に素材名が浮かぶ(レア度の色)。 */
function exploreGainMaterial(key, n, x, y){
  const m = EXPLORE_MATERIALS[key];
  if(!m || !game.explore || game.over) return false;
  const cnt = Math.max(1, Math.floor(n || 1));
  exploreState.bag[key] = (exploreState.bag[key] || 0) + cnt;
  const col = exploreMaterialColor(key);
  if(x != null && y != null) spawnDmgText(x, y, baseTerrainHeightAt(x, y) + 30, `${m.icon} ${m.name}×${cnt}`, col, m.rarity !== 'common');
  // 通知は画面左に積み上がるレア度色の行(explore_loot.js)。金は特別な音と光
  exploreLootNotify(key, cnt);
  exploreLootPickupSe(m.rarity);
  exploreState.hudSig = '';
  return true;
}
// 今の所持数(持ち帰る前)
function exploreBagCount(){
  let n = 0;
  for(const k in exploreState.bag) n += exploreState.bag[k];
  return n;
}

/* 帰還ビーコン。輪の中に EXPLORE_BEACON_HOLD_SEC 秒とどまると帰還(持ち帰り全部)。
   出ると進みは早めに戻る(通りがかりで帰還しないように)。 */
function exploreUpdateBeacon(dt){
  const b = exploreState.beacon;
  if(!b || !player || !player.alive) return;
  const inside = matchTime >= EXPLORE_BEACON_ARM_SEC && dist(player, b) < b.r;
  if(inside){
    if(!exploreState.beaconInside) pushToast(`🛰️ 帰還ビーコン：${EXPLORE_BEACON_HOLD_SEC}秒とどまると持ち帰って帰還します`);
    exploreState.beaconHold += dt;
    if(exploreState.beaconHold >= EXPLORE_BEACON_HOLD_SEC){ exploreFinish('return'); return; }
  } else {
    exploreState.beaconHold = Math.max(0, exploreState.beaconHold - dt*2);
  }
  exploreState.beaconInside = inside;
}
/* 地面の印(real3d の地面円。render.js がレイドの予告円と同じ口で渡す)。
   ボスの大技の予告を先に、帰還ビーコンの輪を後に積む(3D側の枠は8つまで。予告を優先する)。
   予告の見え方(点滅・塗りの濃さ)は render.js の raidTelegraphMarks と揃えてある。 */
function exploreGroundMarks(){
  if(!game.explore) return null;
  const out = [];
  for(const rec of exploreState.bosses){
    const bo = getEntity(rec.id);
    const pend = bo && bo.alive ? bo.exPending : null;
    if(!pend) continue;
    // 予告はボスの色(スキン・地域の色)のまま、塗りを濃くして地面の色に紛れないようにする
    // (赤へ寄せると青いボスの予告が薄桃色になって、かえって読めなくなった)
    const col = pend.color || '#ff5d5d';
    for(const m of pend.marks){
      if(m.fired) continue;
      const left = Math.max(0, m.fireAt - matchTime);
      const soon = left < 0.5;
      const blink = 0.45 + 0.45*Math.abs(Math.sin(matchTime*(soon ? 18 : 9)));
      const half = (m.fanDeg != null) ? (m.fanDeg*Math.PI/180)/2 : 0;
      out.push({ x:m.x, y:m.y, r:m.r, color:col, alpha:0.55 + 0.45*blink, fillAlpha: (soon ? 0.36 : 0.22) + blink*0.2,
                 arc: (m.fanDeg != null) ? { from:m.angle-half, to:m.angle+half } : null,
                 inner: m.fanDeg == null && pend.mv.shape !== 'charge' });
    }
  }
  const b = exploreState.beacon;
  if(b){
    const prog = Math.min(1, exploreState.beaconHold / EXPLORE_BEACON_HOLD_SEC);
    const pulse = 0.55 + 0.35*Math.abs(Math.sin(matchTime*2.4));
    const col = '#7dffb0';
    out.push({ x:b.x, y:b.y, r:b.r, color:col, alpha:pulse, fillAlpha:0.10 + prog*0.45, inner:true });
    if(prog > 0) out.push({ x:b.x, y:b.y, r:Math.max(8, b.r*prog), color:col, alpha:0.9, fillAlpha:0.25, inner:false });
  }
  return out.length ? out : null;
}

/* 最小のHUD(残り時間・力尽き・所持数・帰還の進み・今いる地域)。HUD担当(段2)が作り直す前提。
   文字は中身が変わったときだけ書き換える(毎フレームのDOM更新を避ける)。 */
function exploreUpdateHud(){
  const el = document.getElementById('exploreHud');
  if(!el) return;
  const left = Math.max(0, exploreState.endsAt - matchTime);
  const reg = player ? exploreRegionAt(player.x, player.y) : null;
  const where = reg ? `${reg.icon} ${reg.name} ${'★'.repeat(reg.danger)}` : '⛺ ベースキャンプ周辺';
  const hold = exploreState.beaconInside ? Math.max(0, EXPLORE_BEACON_HOLD_SEC - exploreState.beaconHold) : null;
  const sig = [Math.ceil(left), exploreState.faints, exploreBagCount(), where, hold==null ? '' : hold.toFixed(1)].join('|');
  if(sig === exploreState.hudSig) return;
  exploreState.hudSig = sig;
  const set = (id, t)=>{ const n = document.getElementById(id); if(n) n.textContent = t; };
  set('exploreHudTime', fmtTime(left));
  set('exploreHudFaint', `💫 ${exploreState.faints}/${EXPLORE_MAX_FAINTS}`);
  set('exploreHudBag', `🎒 ${exploreBagCount()}`);
  set('exploreHudWhere', hold==null ? where : `🛰️ 帰還まで ${hold.toFixed(1)}秒`);
  el.classList.toggle('is-low', left <= 60);
}

// 毎フレームの進行(combat.js の update() から。安置の update の代わり)
function updateExplore(dt){
  if(!game.explore || game.over) return;
  exploreUpdateWild(dt);
  exploreUpdateBosses(dt);
  exploreUpdateFx(dt);
  exploreLootUpdate(dt);     // 補給箱を開ける・品が落ちる・拾う(explore_loot.js)
  exploreUpdateBeacon(dt);
  if(game.over) return;
  exploreUpdateHud();
  checkExploreEnd();
}
// 終了判定(時間切れ)。力尽きの上限は exploreOnPlayerFaint、帰還は exploreUpdateBeacon が見る
function checkExploreEnd(){
  if(!game.explore || game.over) return;
  if(matchTime >= exploreState.endsAt) exploreFinish('timeup');
}

/* 終了。持ち帰る素材を決めて、バッグ/保管とゴールドへ入れてから結果画面を出す。
   reason = 'return'(帰還ビーコン・全部) / 'faint'(力尽き上限) / 'timeup'(時間切れ) / 'abandon'(途中で抜けた)
   帰還以外は EXPLORE_FAIL_KEEP_RATIO(素材ごとに切り捨て)。 */
function exploreFinish(reason){
  if(!game.explore || game.over) return;
  game.over = true;
  game.started = false;
  if(typeof joinInProgress!=='undefined') joinInProgress = false;
  if(typeof setAutoRun==='function') setAutoRun(false);
  fireBtnHeld = false;
  const full = reason === 'return';
  const ratio = full ? 1 : EXPLORE_FAIL_KEEP_RATIO;
  const rarOrder = (k)=>{ const m = EXPLORE_MATERIALS[k]; return (m && EXPLORE_RARITY[m.rarity]) ? EXPLORE_RARITY[m.rarity].order : 0; };
  const items = Object.keys(exploreState.bag)
    .filter(k=> EXPLORE_MATERIALS[k] && exploreState.bag[k] > 0)
    .map(k=>{
      const got = exploreState.bag[k];
      const kept = full ? got : Math.floor(got*ratio);
      return { key:k, got, kept, lost:got-kept, toBag: EXPLORE_MATERIALS[k].toBag || null };
    })
    .sort((a,b)=> rarOrder(b.key) - rarOrder(a.key) || b.kept - a.kept);
  // 行き先へ入れる。バッグの品(toBag)に換わる物と、探検専用の保管に入る物
  let rarityGold = 0;
  for(const it of items){
    if(it.kept <= 0) continue;
    if(it.toBag && typeof PLAYER_ITEMS!=='undefined' && PLAYER_ITEMS[it.toBag]) addBagItem(it.toBag, it.kept);
    else addExploreStash(it.key, it.kept);
    rarityGold += it.kept * (EXPLORE_GOLD_PER_RARITY[EXPLORE_MATERIALS[it.key].rarity] || 0);
  }
  const goldRows = [
    { label:'探検の参加', gold:EXPLORE_GOLD_BASE },
    { label:`野生を倒した(${exploreState.kills}体)`, gold:exploreState.kills*EXPLORE_GOLD_PER_KILL },
    { label:'持ち帰った素材', gold:rarityGold },
  ];
  if(full) goldRows.push({ label:'帰還ボーナス', gold:EXPLORE_GOLD_RETURN_BONUS });
  const gold = goldRows.reduce((s,r)=> s + r.gold, 0);
  if(gold > 0) addWallet(gold, 0);
  if(typeof updateAccountBar==='function') updateAccountBar();
  exploreState.finished = {
    reason, full, ratio, items, gold, goldRows,
    timeSec: Math.min(matchTime, EXPLORE_TIME_LIMIT),
    kills: exploreState.kills, faints: exploreState.faints,
  };
  const ehud = document.getElementById('exploreHud');
  if(ehud) ehud.classList.add('hidden');
  bgmSetTrack(null);
  playSe(full ? ((typeof skinWinSeName==='function' && skinWinSeName(player)) || 'fanfare') : 'sad');
  setTimeout(()=>{
    if(game.started) return;
    if(typeof bgmDesiredTrack==='function' && bgmDesiredTrack()!==null) return;
    bgmSetTrack('title');
  }, full ? 3800 : 3000);
  if(typeof exploreShowResult==='function') exploreShowResult(exploreState.finished);
}
