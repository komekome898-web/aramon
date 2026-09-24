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
                applyDamage()      … exploreResolveHit(命中の高さ opts.hitZ で弱点を判定・数字を当たった高さに)/
                                     exploreDmgTakenMult(弱点・転倒・眠り)と exploreOnDamaged(気づき・部位破壊)
                killEntity()       … ボスは exploreOnBossFelled(倒れる演出→消える)
                projHeightHits()   … 背の高い相手(ent.hitHeight。探検のボスだけが持つ)は頭まで当たる
                updateProjectiles()… 直撃の applyDamage に hitZ(弾の高さ)を渡す
     render.js  drawMonster()      … exploreBeginPose(転倒で潰れて傾く・崩れ落ちる・足を引きずる・草を食む。回転しない)/
                                     ボスは頭上のHPと名前を出さない・群れの取り巻きは名前無し /
                                     exploreDrawMonsterUnder・Tint・Marks(足元の輪・輪郭の光・怒りの目・頭上の「!」「?」)
                render()           … exploreCineFrame(登場の寄り。setViewZoom)/
                                     exploreDrawScreen(黒帯・落ちてくる岩・ボスのHPバー・名前の札・咆哮・討伐完了)
                showHitMarker()    … 弱点命中は×印の色を替える(hm-weak)
     real3d_zone.js 地面の印 … outline / solid / progress / rect(探検のボスの予告だけが使う。省略時は従来どおり)
     公開: exploreBossScreenRect(b) … ボスの画面上の矩形(HUD担当が札をボスの外へ逃がすのに使う)
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
    rawClock:0,         // スローモーションの影響を受けない時計(討伐完了の札・視点演出・弱点の数字。updateExplore が進める)
    shards:[],          // 部位破壊で飛ぶ体の破片(exploreBossBreakPart が積む)
    pops:[],            // 弱点命中の数字(照準の近く。exploreWeakPop)
    wildNear:false,     // プレイヤーの近くに起きている野生がいる(補給箱の札を後回しにする)
    card:null,          // 全画面の札(出発・力尽き・終了。explore_loot.js)。ボスの視点演出(cine)とは別の箱
    cine:null,          // ボス登場の視点演出(向き直り・寄り・黒帯。exploreUpdateCine / exploreCineFrame)
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
  document.body.classList.remove('explore-cine');   // ボス登場の暗転を持ち越さない
  exploreHudReset();         // 目標パネル・全体地図を隠し、ミニマップの解像度を戻す(explore_hud.js)
}

// 出発するモンスターの名前(マスモンならその名前)
function explorePlayerName(){
  if(game.selectedMastermonKey){
    const mm = loadMastermons()[game.selectedMastermonKey];
    if(mm && mm.name) return mm.name;
  }
  // 名前を入れていないとき(「名無しのモンスター」)は種族名で出る。探検は1人なので呼び名はそれで足りる
  const raw = (document.getElementById('playerNameInput') || {}).value;
  if(raw && String(raw).trim()) return String(raw).trim().slice(0, 12);
  const el = ELEMENTS[game.selectedElement];
  return el ? el.label : 'あなた';
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
  exploreHudStart();         // 方位バー・目標パネル(explore_hud.js)
  game.started = true;
  bgmSetTrack('explore');    // 探検の曲(地域の環境曲・ボス戦。audio.js)。通常の試合の曲は使わない
  // 出発の見せ場: 「探検開始」の札(目標と制限時間)を出し、カメラがキャンプを回る(explore_loot.js)
  exploreIntroStart();
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
  /* 帰還ビーコンの位置の正はフィールドの配置表(光の柱が立っている所)。柱には足元の当たり(foot)が
     あって中心には立てないので、輪は柱の足元の外側に EXPLORE_BEACON_RADIUS だけ広げる */
  const bc = (typeof EXPLORE_FIELD_LAYOUT!=='undefined' && EXPLORE_FIELD_LAYOUT.camp && EXPLORE_FIELD_LAYOUT.camp.beacon) || null;
  exploreState.beacon = bc
    ? { x: bc.x*WORLD.w/WORLD_BASE_SIZE, y: bc.y*WORLD.h/WORLD_BASE_SIZE, r: (bc.foot||0) + EXPLORE_BEACON_RADIUS }
    : { x: cx + EXPLORE_BEACON_OFFSET.dx, y: cy + EXPLORE_BEACON_OFFSET.dy, r: EXPLORE_BEACON_RADIUS };
}

/* ルートを置く。主役は補給箱(explore_loot.js。開けると中身が弾けて光の柱が立つ)。
   それとは別に、回復・ガッツを少しだけ地面に置く(箱の間の小さなご褒美)。**箱の中身と同じ見せ方**
   (光の柱とレア度。exploreScatterGroundLoot)にそろえる。通常の試合の spawnLoot は使わない */
function exploreSpawnLoot(){
  const c = exploreState.camp;
  exploreScatterGroundLoot(EXPLORE_CAMP_LOOT_COUNT, c.x, c.y, c.r*1.6, null);
  for(const reg of EXPLORE_REGIONS){
    const rc = exploreRegionCircle(reg);
    exploreScatterGroundLoot(EXPLORE_REGION_LOOT_COUNT, rc.x, rc.y, rc.r*0.9, reg.id);
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
  if(p === player && typeof exploreHudOnSpotted === 'function') exploreHudOnSpotted(b);   // 気づかれた音(explore_hud.js)
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
  let near = false;
  for(const w of exploreState.wild){
    const e = getEntity(w.id);
    if(!e) continue;
    if(e.alive && !e.exploreAsleep && p && Math.hypot(e.x - p.x, e.y - p.y) < EXPLORE_WILD_NEAR_LABEL) near = true;
    if(e.alive && e.exState === 'flee' && now >= (e.exDustAt || 0)){ e.exDustAt = now + 0.08; exploreFxFleeDust(e); }
    if(e.alive){
      // 遠い個体は眠らせる(境目で寝起きを繰り返さないよう、起きる距離は少し内側)
      const d = p ? Math.hypot(e.x - p.x, e.y - p.y) : 0;
      if(e.exploreAsleep){ if(d < EXPLORE_WILD_ACTIVE_RADIUS - EXPLORE_WILD_SLEEP_HYST) e.exploreAsleep = false; }
      else if(d > EXPLORE_WILD_ACTIVE_RADIUS && e.exState !== 'chase') e.exploreAsleep = true;
      if(e.exploreAsleep) continue;
      // 今の歩く速さ(姿勢の判定用。止まって草を食む/歩く)
      const mvd = Math.hypot(e.x - (e.exLastX != null ? e.exLastX : e.x), e.y - (e.exLastY != null ? e.exLastY : e.y));
      e.exLastX = e.x; e.exLastY = e.y;
      e.exSpd = (e.exSpd || 0)*0.8 + (mvd/Math.max(dt, 1e-3))*0.2;
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
  exploreState.wildNear = near;
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
    const n = (L.bossNests && L.bossNests[regionId]) || (L.regions && L.regions[regionId] && (L.regions[regionId].nest || L.regions[regionId].bossNest)) || null;
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
/* 体の高さ(ワールド単位)。**正は render.js の portraitLayoutFor(e, img).bodyH**(=画面に描いている絵の体の高さ)。
   ここで式を持ち直さない: 翼の広い絵は BODY_W_MAX の幅の上限で縮めて描かれるので、
   「2×半径×BODY_H_RATIO×描画倍率」だと見た目より高くなり、弱点の当たりが頭より上に浮いていた(約1.6倍。狙撃の批評で発覚)。
   弱点(weakPoint)・弾の当たる背(ent.hitHeight / projHeightHits)・狙撃(sniperBodyH)はすべてここを読む。
   絵がまだ読み込まれていないとき(描かれていない間)だけ、幅の上限を掛ける前の値を目安にする。
   同じフレームの中では1回だけ測る(当たり判定で何度も呼ばれるため)。 */
function exploreBodyHeight(ent){
  if(!ent) return 0;
  // 姿勢(転倒で潰れる・眠りで伏せる・溜めで縮む・崩れ落ちる)の縦の縮みと傾きも当たりの背に掛ける。
  // 掛けないと、潰れて低くなった絵の上の何も無い所に弱点が浮く(狙撃の批評で「見た目の約1.6倍」)
  const pose = exploreComputePose(ent);
  const k = pose ? pose.sy * Math.cos(pose.tilt || 0) : 1;
  return exploreBodyHeightRaw(ent) * k;
}
/* 立った姿勢の絵の体の高さ。姿勢の変形の**内側**で描く物(怒りの目・部位破壊の欠け)はこちらを使う
   (変形が絵と一緒に掛かるので、姿勢ぶんを二重に掛けない) */
function exploreBodyHeightRaw(ent){
  if(!ent) return 0;
  if(ent._exBodyHT === matchTime && ent._exBodyH > 0) return ent._exBodyH;
  let h = 0;
  const img = (typeof getDisplayImage==='function') ? getDisplayImage(ent) : null;
  if(img && typeof portraitLayoutFor==='function'){
    const L = portraitLayoutFor(ent, img);
    if(L && L.bodyH > 0) h = L.bodyH;
  }
  if(!(h > 0)){
    const ds = (typeof entityDrawScale==='function') ? entityDrawScale(ent) : 1;
    h = 2 * ent.radius * BODY_H_RATIO * (ds || 1);
  }
  ent._exBodyHT = matchTime; ent._exBodyH = h;
  return h;
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
    // 巣の中で平らな所に立たせる(尾根の上に立つと見上げても顔がHUDの裏に入る=批評指摘)
    const sp = exploreFlatSpot(nest.x, nest.y, nest.r*0.6, def.radius);
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
// 巣の中(中心から r 以内)で、体の大きさの範囲の高さの差がいちばん小さく、低い所
function exploreFlatSpot(cx, cy, r, rad){
  const H = (x, y)=> getTerrainHeightAt(x, y);
  const score = (x, y)=>{
    const h0 = H(x, y);
    let dev = 0;
    for(let k=0; k<8; k++){
      const a = k/8*Math.PI*2;
      dev = Math.max(dev, Math.abs(H(x + Math.cos(a)*rad*1.5, y + Math.sin(a)*rad*1.5) - h0));
    }
    return dev + h0*0.15;
  };
  let best = clearObstaclePoint(cx, cy, rad + 40), bs = score(best.x, best.y);
  for(let i=0; i<EXPLORE_BOSS_FLAT_TRIES; i++){
    const a = i*2.399963, d = r*Math.sqrt((i + 0.5)/EXPLORE_BOSS_FLAT_TRIES);
    const p = clearObstaclePoint(cx + Math.cos(a)*d, cy + Math.sin(a)*d, rad + 40);
    const sc = score(p.x, p.y);
    if(sc < bs){ bs = sc; best = p; }
  }
  return best;
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
  // 咆哮の声はボスごと(data.js の EXPLORE_BOSSES の roar。合成は audio.js の exploreRoar)
  if(def && def.roar) playSe('exploreRoar', { ...def.roar, rage: kind === 'rage' });
  else playSe('fireRoar');
  if(kind === 'rage') playSe('godRising');
  // 近くで咆哮を浴びると耳をふさぐ(短い鈍足)
  if(player && dist(b, player) < EXPLORE_BOSS_ROAR_SLOW_RANGE)
    player.slowUntil = Math.max(player.slowUntil || 0, now + EXPLORE_BOSS_ROAR_SLOW_SEC);
  if(kind === 'intro'){
    exploreBanner('plate', { bossId:b.id, name:def.name, title:def.title, apex:!!def.apex, color:def.color, dur:3.4 });
    exploreBossEngaged(b);
    // 視点演出: ボスへ向き直り(背後で咆哮されても必ず見える)・寄り・黒帯・操作ボタンを暗く
    exploreStartCine(b, 'intro');
  } else if(kind === 'rage'){
    exploreBanner('rage', { text:`${def.name}が怒り状態になった！`, color:'#ff4a3a', dur:2.0 });
    exploreStartCine(b, 'rage');   // 咆哮の瞬間だけ少し寄る(黒帯・HUDを消す演出はしない)
    exploreFxBreath(b);
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
/* 方向のある大技(ブレスの扇・突進の帯)の予告が尾根を越えて画面の空へ抜けて見える問題(批評指摘)への対策。
   攻撃の向きへ地形の高さを追跡し、地形なりに登っている間は伸ばしたまま(そこは実際に当たる場所)、
   尾根を越えて視線が切れる(登り基準の見え方より大きく下がる)距離で予告を止める。 */
const EXPLORE_TELEGRAPH_SIGHT_STEP = 40;
const EXPLORE_TELEGRAPH_SIGHT_DROP = 18;   // これより「尾根の向こう」へ下ったら、そこで切る
function exploreTerrainSightRange(x0, y0, z0, angle, maxRange){
  const cs = Math.cos(angle), sn = Math.sin(angle);
  let maxSlope = 0, limit = maxRange;
  for(let d = EXPLORE_TELEGRAPH_SIGHT_STEP; d <= maxRange; d += EXPLORE_TELEGRAPH_SIGHT_STEP){
    const h = baseTerrainHeightAt(x0 + cs*d, y0 + sn*d) - z0;
    const slope = h / d;
    if(slope >= maxSlope - 1e-4){ maxSlope = Math.max(maxSlope, slope); continue; }
    if(maxSlope*d - h > EXPLORE_TELEGRAPH_SIGHT_DROP){ limit = d; break; }
  }
  return Math.max(80, limit);
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
    /* 予告が尾根を越えて空へ抜けて見える問題への対策(批評指摘): 視線が切れる距離までで止める。
       中心だけで測ると、扇の片側の縁がその内側で尾根に当たっていても伸びたままになり、
       描画側(3D)の深度で切られて「欠けて」見えた。両端の縁でも測り、狭い方を扇全体に使う
       (どの辺も、実際に地面が見えている範囲の内側にしか描かれないことを保証する)。 */
    const half = (mv.fanAngleDeg*Math.PI/180)/2;
    const sightR = Math.min(
      exploreTerrainSightRange(b.x, b.y, b.z||0, ang, mv.range),
      exploreTerrainSightRange(b.x, b.y, b.z||0, ang - half, mv.range),
      exploreTerrainSightRange(b.x, b.y, b.z||0, ang + half, mv.range)
    );
    marks.push({ x:b.x, y:b.y, r:Math.min(mv.range, sightR) + b.radius, angle:ang, fanDeg:mv.fanAngleDeg, fireAt:now+tele });
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
    const sightR = exploreTerrainSightRange(b.x, b.y, b.z||0, ang, mv.length);
    const len = Math.max(260, Math.min(mv.length, sightR, raycastObstacleDistance(b.x, b.y, ang, mv.length) - b.radius*0.6));
    // 予告は通り道の帯1枚(体の幅)。突進は体ごと動くので、当たり判定はこの帯と同じ幅になる
    marks.push({ x:b.x, y:b.y, r:len, rect:{ angle:ang, len: len + b.radius, halfW: b.radius + 26 }, fireAt:now+tele });
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
  exploreSpawnShard(b);
  exploreDropLoot(b, exploreDropTable(b, 'break'));
  exploreBossTopple(b);
}
// 転倒(ひるみ)。横倒しになって大技を中断する
function exploreBossTopple(b){
  b.exState = 'stagger';
  b.exStateUntil = matchTime + EXPLORE_BOSS_TOPPLE_SEC;
  b.exPending = null; b.exCharge = null; b.moveWithMoveUntil = 0;
  b.exploreLying = true;
  b.exPoseAt = matchTime;
  b.exTiltSign = Math.random() < 0.5 ? -1 : 1;
  // 足元に土煙の輪と地面の揺れ(巨体が崩れた重さ)
  exploreFxGroundSlam(b, 1);
  if(typeof fxPunch==='function' && player) fxPunch(0.75 * (1 - clamp(dist(b, player)/2600, 0, 1)));
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
  b.exPoseAt = now;
  b.exTiltSign = Math.random() < 0.5 ? -1 : 1;
  pushKillFeed(`${def ? def.name : b.name} を討伐した`);
  playSe('kill');
  // 討伐のファンファーレは曲の側で鳴らす(ボス戦の曲を止めて、終わったら地域の曲へ戻る。audio.js)
  if(typeof bgmExploreFanfare === 'function') bgmExploreFanfare(!!(def && def.apex)); else playSe('fanfare');
  exploreFxFelled(b, def ? def.color : '#ffd35a');
  exploreFxGroundSlam(b, 1.3);
  // 落とし物はスローの影響を受けずに(実時間で)すぐ跳ねる。獲得した物は討伐完了の札の下に並べる
  const got = exploreDropLoot(b, exploreDropTable(b, 'kill'), { realTime:true });
  // 崩れ落ちる瞬間を画面の中央で見せる(登場と同じ視点演出)。討伐完了の札は崩れ終わってから(exploreUpdateBosses)
  b.exHuntItems = got; b.exHuntShown = false;
  exploreStartCine(b, 'hunt');
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
      if(!b.exHuntDust && now - (b.exPoseAt || now) >= 0.75){
        b.exHuntDust = true;
        // 倒れた体が地面を打つ所(倒れた向きの横)に土煙と揺れ
        const side = (b.exTiltSign || 1), ax = -Math.sin(camState.yaw)*side, ay = Math.cos(camState.yaw)*side;
        exploreFxGroundSlam({ x:b.x + ax*b.radius*1.2, y:b.y + ay*b.radius*1.2, z:b.z, radius:b.radius }, 1.2);
        if(typeof fxPunch==='function') fxPunch(0.7);
      }
      if(!b.exHuntShown && now - (b.exPoseAt || now) >= 0.8){
        b.exHuntShown = true;
        exploreBanner('hunt', { name:def.name, apex:!!def.apex, color:def.color, dur:4.2, items:b.exHuntItems || [] });
      }
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
    // 怒り中: 一歩ごとに画面が小さく揺れ、口元から白い息を吐く
    const moved = Math.hypot(b.x - (b.exLastX != null ? b.exLastX : b.x), b.y - (b.exLastY != null ? b.exLastY : b.y));
    b.exLastX = b.x; b.exLastY = b.y;
    if(b.exRage && b.alive && b.exState !== 'dying'){
      exploreFxRage(b, dt);
      const near = 1 - clamp(d / 2400, 0, 1);
      b.exStepAcc = (b.exStepAcc || 0) + moved;
      if(b.exStepAcc > b.radius*0.9){
        b.exStepAcc = 0;
        if(typeof fxPunch==='function' && near > 0) fxPunch(EXPLORE_BOSS_RAGE_STEP_SHAKE*near);
        exploreFxDust(b, def.color);
      }
      if(now >= (b.exBreathAt || 0)){
        b.exBreathAt = now + EXPLORE_BOSS_BREATH_EVERY*rand(0.8, 1.2);
        exploreFxBreath(b);
      }
    }
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


/* ===== 第3周: 戦いの山場を画面に出す(弱点の数字・部位破壊の破片・技名・野生の頭上の整理) ===== */
const EXPLORE_WILD_NEAR_LABEL = 900;   // この距離に起きている野生がいる間は補給箱の札を後回しにする
// 視点演出の間、カメラとボスの間にある障害物か(render.js がボスの絵を上に重ねて見せる)
function exploreCineSeeThrough(o){
  const c = exploreState.cine;
  if(!c || !o) return false;
  const b = getEntity(c.bossId);
  if(!b) return false;
  const dx = b.x - camPos.x, dy = b.y - camPos.y, L2 = dx*dx + dy*dy;
  if(L2 < 1) return false;
  const t = ((o.x - camPos.x)*dx + (o.y - camPos.y)*dy) / L2;
  if(t <= 0 || t >= 1) return false;
  const px = camPos.x + dx*t, py = camPos.y + dy*t;
  return Math.hypot(o.x - px, o.y - py) < (o.radius || 0) + b.radius*1.6;
}
// 補給箱の札を後回しにするか(explore_loot.js から)
function exploreWildNear(){ return !!(game.explore && exploreState.wildNear); }
// 野生の頭上のゲージは戦っているときだけ(render.js の drawMonster から)
function exploreWildShowsBar(e){
  return e.exState === 'chase' || e.exState === 'alert' || e.exState === 'flee' || e.hp < e.maxHp - 0.5;
}
// 野生の名前は「群れの長」の「!」が出ている間だけ
// 野生の名前は render.js では描かない(群れの長の名札は exploreDrawMonsterMarks が印と縦にずらして描く)
function exploreWildShowsName(e){ return false; }
// 野生の頭上のゲージの高さ(drawMonster の座標系)。描いている絵の頭のすぐ上
function exploreWildBarY(e){ return exploreFootY(e) - exploreBodyHeightRaw(e) - 8; }
// 画面の左右のどちらへ動いているか(+1=右)。逃げる姿勢の傾きの向き
function exploreScreenLat(e){
  const mx = e.lastMoveX || 0, my = e.lastMoveY || 0;
  return -mx*Math.sin(camState.yaw) + my*Math.cos(camState.yaw);
}
// ボス戦の間、そのボスの縄張りの中の光の柱を薄くする(explore_loot.js の柱から)
function exploreBossFightFade(x, y){
  if(!game.explore || exploreState.engagedBossId == null) return 1;
  const b = getEntity(exploreState.engagedBossId);
  if(!b || !b.alive) return 1;
  const R = Math.max(EXPLORE_BOSS_ENGAGE_RANGE, (b.exNestR || 0) + 900);
  return Math.hypot(x - b.x, y - b.y) < R ? EXPLORE_BOSS_FIGHT_PILLAR_A : 1;
}
// 落ちている物の名前(render.js の drawLootItem)。ボス戦の間は画面上で小さく(11px前後)出す
function exploreLootLabelPx(p, base){
  if(exploreState.engagedBossId == null || !p) return base;
  return Math.min(base, 11 / Math.max(0.01, p.scale));
}
// 逃げる野生の足元の土煙
// 逃げる野生の足元から後ろへ流れる茶色の土煙(2Dの粒。加算の層は暗い色を出せないので使わない)
// 大きさの違う土の粒が後ろへ流れ、広がりながら薄れて消える(exploreDrawFleeFx が描く)
function exploreFxFleeDust(e){
  const bx = -(e.lastMoveX || 0), by = -(e.lastMoveY || 0);
  const list = exploreState.puffs || (exploreState.puffs = []);
  for(let i=0; i<2; i++){
    const sp = rand(40, 110);
    list.push({ x:e.x + bx*e.radius*0.5 + rand(-10, 10), y:e.y + by*e.radius*0.5 + rand(-10, 10), z:(e.z||0) + 4,
      vx: bx*sp + rand(-25, 25), vy: by*sp + rand(-25, 25), r0: rand(4, 10), r1: rand(18, 34), t:0, life: rand(0.5, 0.8),
      c: Math.random() < 0.5 ? '120,95,68' : '150,122,88' });
  }
  if(list.length > 90) list.splice(0, list.length - 90);
}
// 逃げる野生のスピード線と土の粒。怒りの画面の縁の赤み
function exploreDrawFleeFx(){
  const list = exploreState.puffs;
  const dt = 1/60;
  if(list && list.length){
    ctx.save();
    for(let i=list.length-1; i>=0; i--){
      const p = list[i];
      p.t += dt; p.x += p.vx*dt; p.y += p.vy*dt; p.vx *= 0.94; p.vy *= 0.94; p.z += 12*dt;
      if(p.t >= p.life){ list.splice(i, 1); continue; }
      const q = project(p.x, p.y, p.z);
      if(!q) continue;
      const k = p.t/p.life;
      const rr = (p.r0 + (p.r1 - p.r0)*Math.sqrt(k)) * q.scale;
      const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, rr);
      g.addColorStop(0, `rgba(${p.c},${0.55*(1-k)})`); g.addColorStop(1, `rgba(${p.c},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(q.x, q.y, rr, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
  // スピード線: 画面上の動きの向きの逆(後ろ)へ、体の縁から伸びる白い線
  for(const w of exploreState.wild){
    const e = getEntity(w.id);
    if(!e || !e.alive || e.exState !== 'flee' || e.exploreAsleep) continue;
    const a = project(e.x, e.y, (e.z||0) + e.radius*0.8), b = project(e.x + (e.lastMoveX||0)*60, e.y + (e.lastMoveY||0)*60, (e.z||0) + e.radius*0.8);
    if(!a || !b || a.depth > 2600) continue;
    let dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    if(L > 0.5){ dx /= L; dy /= L; }
    // 画面の奥・手前へ逃げる(横の動きが小さい)ときは、傾きと同じ左右の向きへ流す(縦の線は雨に見える)
    if(L <= 0.5 || Math.abs(dx) < 0.5){ const sd = exploreScreenLat(e) >= 0 ? 1 : -1; dx = sd*0.94; dy = -0.34; }
    const nx = -dy, ny = dx, R = e.radius*1.1*a.scale;
    ctx.save();
    ctx.lineCap = 'round';
    for(let j=-2; j<=2; j++){
      const ph = (matchTime*6 + j*0.37 + e.id) % 1;
      const ox = a.x + nx*j*R*0.4 - dx*R*(0.7 + ph*0.4), oy = a.y + ny*j*R*0.4 - dy*R*(0.7 + ph*0.4);
      const len = R*(1.3 + 0.7*Math.abs(Math.sin(j*1.7)));
      ctx.globalAlpha = 0.9*(1 - ph*0.5);
      ctx.strokeStyle = 'rgba(30,22,14,0.6)'; ctx.lineWidth = 4.6;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox - dx*len, oy - dy*len); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox - dx*len, oy - dy*len); ctx.stroke();
    }
    ctx.restore();
  }
}
// 怒り中のボスと戦っている間: 画面の縁がゆっくり赤く脈打つ
function exploreDrawRageEdge(){
  if(exploreState.engagedBossId == null) return;
  const b = getEntity(exploreState.engagedBossId);
  if(!b || !b.alive || !b.exRage || b.exState === 'dying') return;
  const R = Math.max(viewW, viewH)*0.72;
  const pulse = 0.55 + 0.45*Math.abs(Math.sin(matchTime*2.6));
  ctx.save();
  const g = ctx.createRadialGradient(viewW/2, viewH/2, R*0.45, viewW/2, viewH/2, R);
  g.addColorStop(0, 'rgba(160,0,0,0)'); g.addColorStop(0.6, `rgba(170,8,0,${0.18*pulse})`); g.addColorStop(1, `rgba(150,0,0,${0.5*pulse})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.restore();
}
/* 弱点命中の数字(combat.js の applyDamage から)。照準の右上に、画面の画素で固定サイズの金の数字と「弱点！」。
   狙撃のスコープで構えている間は狙撃側(sniper.js)が照準の右上に出すので、こちらは出さない */
function exploreWeakPop(target, dmg, source){
  if(!source || !source.isPlayer) return;
  if(document.body.classList.contains('sniper-ads') || (typeof sniperView === 'object' && sniperView && sniperView.ads)) return;
  // 本体を一瞬白く光らせて数字と組にする(狙撃は当たった点だけ光らせるのでここを通らない)
  target.exWeakFlashAt = exploreState.rawClock;
  /* 頭に火花(黄と白)。以前はここが大きく明るすぎて、顔の位置に重なると
     輪郭が見えなくなるほどの白い塊になっていた(批評指摘。本体の白フラッシュを
     絞ってもここが支配的で改善しなかった)。粒を小さく・数を減らし、明るさも抑える。 */
  const fx = exploreFxLayer();
  if(fx){
    const hz = (target.z||0) + exploreBodyHeight(target)*0.85;
    fx.burst({ x:target.x, y:target.y, z:hz, count:14, speed:380, elev:0.3, elevSpread:1.4, r:1, g:0.86, b:0.3, bright:0.9, life:0.4, size0:6, stretch:0.6 });
    fx.burst({ x:target.x, y:target.y, z:hz, count:5, speed:220, elev:0.5, elevSpread:1.2, r:1, g:1, b:1, bright:0.85, life:0.26, size0:6 });
  }
  exploreState.pops.push({ dmg: Math.round(dmg), raw0: exploreState.rawClock, id: target.id });
  if(exploreState.pops.length > 3) exploreState.pops.shift();
}
function exploreDrawWeakPops(){
  const list = exploreState.pops;
  const W = EXPLORE_WEAK_POP;
  for(let i=list.length-1; i>=0; i--) if(exploreState.rawClock - list[i].raw0 > W.sec) list.splice(i, 1);
  if(!list.length) return;
  // 位置は当たったボスの頭の右(頭の高さ = ボスが立つ地面 b.z + 体の高さ)。画面上部のHUDより下・画面の中に収める
  const band = (typeof exploreHudBand === 'function') ? exploreHudBand() : null;
  const topLimit = Math.max(EXPLORE_MARK_TOP_PX, band ? band.bottom + 60 : 0) + 20;
  const last = list[list.length-1];
  const tb = getEntity(last.id);
  let cx = viewW/2 + W.dx, cy = viewH/2 + W.dy;
  const tw = W.px*3.2, th = W.px*1.6;
  if(tb){
    const R = exploreBossScreenRect(tb);
    if(R){
      /* 頭の高さに出す。上部のHUDの下に潜る所は避け、頭の右→左→HUDの下 の順に空いている所へ
         (縦持ちでは頭の真横がHUDの帯より外に出るので、下へ押し下げずに頭の高さのまま出せる) */
      const hy = R.top + R.h*0.2;
      const obs = (typeof exploreHudObstacles === 'function') ? exploreHudObstacles().slice() : [];
      if(band) obs.push({ x:band.x, y:0, w:band.w, h:topLimit });
      const free = (x, y)=> x >= 6 && x + tw <= viewW - 6 && y - th >= 4 && !obs.some(o=> x < o.x + o.w && x + tw > o.x && y - th < o.y + o.h && y > o.y)
                            && !exploreHitsAimZone(x, y - th, tw, th);
      const cands = [[R.x + R.w + 8, hy], [R.x - 8 - tw, hy], [R.cx + R.w*0.28, Math.max(hy, topLimit)]];
      const pick = cands.find(([x, y])=> free(x, y)) || cands[2];
      cx = pick[0]; cy = pick[1];
    }
  }
  cx = clamp(cx, 6, viewW - tw - 6); cy = clamp(cy, th + 4, viewH - 170);
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  list.forEach((pp, i)=>{
    const age = exploreState.rawClock - pp.raw0;
    const idx = list.length - 1 - i;               // 新しいものほど下(照準の近く)
    const a = age > W.sec - 0.3 ? Math.max(0, (W.sec - age)/0.3) : 1;
    const pop = age < 0.12 ? 1.5 - age/0.12*0.5 : 1;
    const y = cy - idx*(W.px + 8) - age*14;
    ctx.save();
    ctx.globalAlpha = a * (idx ? 0.6 : 1);
    ctx.translate(cx, y);
    ctx.scale(pop, pop);
    ctx.font = "bold 13px 'Russo One', sans-serif";
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(40,10,0,0.9)';
    ctx.strokeText('弱点！', 2, -W.px*0.85); ctx.fillStyle = '#ff5a3a'; ctx.fillText('弱点！', 2, -W.px*0.85);
    ctx.font = `bold ${W.px}px 'Russo One', sans-serif`;
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(40,20,0,0.92)';
    ctx.strokeText(String(pp.dmg), 0, 0);
    const g = ctx.createLinearGradient(0, -W.px, 0, 4);
    g.addColorStop(0, '#fff6c8'); g.addColorStop(0.55, '#ffd23c'); g.addColorStop(1, '#e08a10');
    ctx.fillStyle = g;
    if(!renderHeavyLoad){ ctx.shadowBlur = 14; ctx.shadowColor = 'rgba(255,170,40,0.9)'; }
    ctx.fillText(String(pp.dmg), 0, 0);
    ctx.restore();
  });
  ctx.restore();
  // 照準に黄色の弱点用の×印(0.35秒)。画面の中心=照準
  const age0 = exploreState.rawClock - last.raw0;
  if(age0 < 0.35 && !document.body.classList.contains('explore-cine')){
    const k = 1 - age0/0.35, s = 16 + 10*(1 - k);
    ctx.save();
    ctx.translate(viewW/2, viewH/2);
    ctx.globalAlpha = k;
    ctx.lineCap = 'round';
    for(const [w, c] of [[7, 'rgba(60,30,0,0.85)'], [3.5, '#ffd23c']]){
      ctx.strokeStyle = c; ctx.lineWidth = w;
      ctx.beginPath();
      for(const [dx, dy] of [[-1,-1],[1,-1],[1,1],[-1,1]]){ ctx.moveTo(dx*s*0.45, dy*s*0.45); ctx.lineTo(dx*s, dy*s); }
      ctx.stroke();
    }
    ctx.restore();
  }
}
// ボスの体に当てた数字: 白・画面の画素で固定の大きさ(遠くのボスでも読める)
function exploreBodyPop(target, z, dmg){
  spawnDmgText(target.x, target.y, z, Math.round(dmg), '#ffffff', true);
  const pt = particles[particles.length - 1];
  if(pt && pt.type === 'text') pt.fixedPx = EXPLORE_BODY_POP_PX;
}
// 照準の周り(画面の中心)の範囲に矩形がかかるか。叫び・技名・数字の文字はここを避ける
function exploreHitsAimZone(x, y, w, h){
  const A = EXPLORE_AIM_CLEAR, ax = viewW/2 - A.w/2, ay = viewH/2 - A.h/2;
  return x < ax + A.w && x + w > ax && y < ay + A.h && y + h > ay;
}
// 自分(自機)の画面上の矩形
function explorePlayerRect(){
  if(!player) return null;
  const f = project(player.x, player.y, player.z || 0), t = project(player.x, player.y, (player.z || 0) + player.radius*2.2);
  if(!f || !t) return null;
  const w = player.radius*2.6*f.scale;
  return { x:f.x - w/2, y:t.y, w, h:f.y - t.y };
}
// 部位破壊の破片: 弱点の高さ(頭)の絵を切り出した1枚が、回りながら飛んで地面で跳ねる
function exploreSpawnShard(b){
  const img = (typeof getDisplayImage === 'function') ? getDisplayImage(b) : null;
  if(!img) return;
  const h = exploreBodyHeightRaw(b);
  // 欠ける形(exploreNotchGeom)で絵を切り出した小さな1枚を作る(体の絵はそのまま残る)
  const L = portraitLayoutFor(b, img), N = exploreNotchGeom(b);
  const lx0 = N.cx - N.hw, ly0 = N.top, lw = N.hw*2, lh = N.bot - N.top;
  const toImg = (x, y)=> [(x + L.dw/2)/L.scale, (y + L.dh/2 - L.dy)/L.scale];
  const S = 2;   // 切り出す解像度(ワールド1あたりの画素)
  const cv = document.createElement('canvas');
  cv.width = Math.max(4, Math.round(lw*S)); cv.height = Math.max(4, Math.round(lh*S));
  const g = cv.getContext('2d');
  g.beginPath();
  N.pts.forEach((q, i)=>{ const [x, y] = N.P(q); const px = (x - lx0)*S, py = (y - ly0)*S; if(i) g.lineTo(px, py); else g.moveTo(px, py); });
  g.lineTo(cv.width, 0); g.lineTo(0, 0); g.closePath();
  g.save(); g.clip();
  const [ix0, iy0] = toImg(lx0, ly0), [ix1, iy1] = toImg(lx0 + lw, ly0 + lh);
  try{ g.drawImage(img, ix0, iy0, ix1 - ix0, iy1 - iy0, 0, 0, cv.width, cv.height); }catch(err){}
  g.restore();
  // 割れ口(下の縁)を赤熱の線で
  g.beginPath();
  N.pts.forEach((q, i)=>{ const [x, y] = N.P(q); const px = (x - lx0)*S, py = (y - ly0)*S; if(i) g.lineTo(px, py); else g.moveTo(px, py); });
  g.strokeStyle = '#ffb040'; g.lineWidth = 3; g.stroke();
  // 画面の横〜手前へ低く飛ぶ(上へ高く飛ばすと画面上部のコンパスの裏に入る=批評指摘)
  const side = Math.random() < 0.5 ? 1 : -1;
  const a = camState.yaw + Math.PI + side*rand(0.35, 0.6);   // カメラ側(画面の下)へ斜めに
  exploreState.shards.push({ img:cv, cut:true, lw, lh, bossId:b.id, w: lw, x:b.x, y:b.y, z:(b.z||0) + h*0.95,
    vx:Math.cos(a)*rand(520, 620), vy:Math.sin(a)*rand(520, 620), vz:rand(-60, 20),
    rot:0, vr:rand(7, 11)*(Math.random()<0.5?-1:1), t:0, life:2.6, bounced:false });
}
function exploreUpdateShards(dt){
  const list = exploreState.shards;
  for(let i=list.length-1; i>=0; i--){
    const s = list[i];
    s.t += dt;
    if(s.t > s.life){ list.splice(i, 1); continue; }
    s.x += s.vx*dt; s.y += s.vy*dt; s.z += s.vz*dt; s.vz -= 1400*dt; s.rot += s.vr*dt;
    const g = baseTerrainHeightAt(s.x, s.y) + 10;
    if(s.z < g){
      s.z = g;
      if(!s.bounced){ s.bounced = true; s.vz = Math.abs(s.vz)*0.4; s.vx *= 0.45; s.vy *= 0.45; s.vr *= 0.5; exploreFxShardHit(s); }
      else { s.vz = 0; s.vx *= 0.85; s.vy *= 0.85; s.vr *= 0.8; }
    }
  }
}
function exploreFxShardHit(s){
  const fx = exploreFxLayer();
  if(!fx) return;
  fx.burst({ x:s.x, y:s.y, z:s.z, count:10, speed:180, elev:0.6, r:1.0, g:0.72, b:0.3, bright:1.1, life:0.5, size0:10 });
}
function exploreDrawShards(){
  const list = exploreState.shards;
  if(!list.length) return;
  for(const s of list){
    const P = project(s.x, s.y, s.z);
    if(!P) continue;
    const dw = s.lw * P.scale, dh = s.lh * P.scale;
    const a = s.t > s.life - 0.5 ? Math.max(0, (s.life - s.t)/0.5) : 1;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(P.x, P.y - dh*0.3);
    ctx.rotate(s.rot);
    if(!renderHeavyLoad){ ctx.shadowBlur = 12; ctx.shadowColor = 'rgba(255,140,40,0.9)'; }
    try{ ctx.drawImage(s.img, -dw/2, -dh/2, dw, dh); }catch(err){}
    ctx.restore();
  }
}
// 予告中の技名をボスの足元付近に大きく(何が来るかを地面の印と同じ所で読めるように)
function exploreDrawMoveName(){
  for(const rec of exploreState.bosses){
    const b = getEntity(rec.id);
    const pd = b && b.alive ? b.exPending : null;
    if(!pd) continue;
    const f = project(b.x, b.y, b.z || 0);
    if(!f) continue;
    const def = exploreBossDef(b);
    const k = clamp((matchTime - pd.startAt) / Math.max(0.05, pd.fireAt - pd.startAt), 0, 1);
    ctx.save();
    ctx.font = "italic bold 28px 'Russo One', sans-serif";
    const t = `${pd.mv.name}！`;
    const tw = ctx.measureText(t).width + 12, th = 36;
    let x = clamp(f.x, 120, viewW - 120), y = clamp(f.y + 30, EXPLORE_MARK_TOP_PX + 30, viewH - 150);
    // 照準の周りと自分に重ねない: 当たるなら横へ(ボスのいる側)ずらす
    const pr = explorePlayerRect();
    const hitP = (cx, cy)=> pr && cx - tw/2 < pr.x + pr.w && cx + tw/2 > pr.x && cy - th/2 < pr.y + pr.h && cy + th/2 > pr.y;
    if(exploreHitsAimZone(x - tw/2, y - th/2, tw, th) || hitP(x, y)){
      const side = f.x >= viewW/2 ? 1 : -1;
      x = viewW/2 + side*(EXPLORE_AIM_CLEAR.w/2 + tw/2 + 10);
      if(hitP(x, y)) x = viewW/2 + side*(Math.max(EXPLORE_AIM_CLEAR.w/2, pr.w/2) + tw/2 + 16);
    }
    const pop = k < 0.08 ? 1.4 - k/0.08*0.4 : 1;
    ctx.translate(x, y);
    ctx.scale(pop, pop);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(20,6,0,0.92)'; ctx.strokeText(t, 0, 0);
    ctx.fillStyle = exploreMixHex((def && def.color) || '#ffcf5a', '#ffffff', 0.35);
    if(!renderHeavyLoad){ ctx.shadowBlur = 14; ctx.shadowColor = (def && def.color) || '#ff8a3a'; }
    ctx.fillText(t, 0, 0);
    ctx.restore();
  }
}

/* ===== 被弾の出入口(combat.js の applyDamage から) ===== */
/* 命中の高さで弱点かを決める(applyDamage の入口。探検以外では呼ばれない)。
   ・opts.hitZ = 当たった高さ(弾の z。combat.js の直撃が渡す)。無ければ範囲技とみなして体の高さ×0.5
   ・opts.weakPoint が既に決まっていれば(狙撃は自分で判定する)そのまま使う
   ・opts.dmgZ = ダメージの数字を出す高さ(当たった所。今までは足元に出ていた)
   返すのは写し(呼び出し側の opts は書き換えない) */
function exploreResolveHit(target, source, opts){
  if(!target || !target.isExploreBoss) return opts;
  const o = opts ? { ...opts } : {};
  const h = exploreBodyHeight(target), base = target.z || 0;
  const z = (o.hitZ != null) ? o.hitZ : base + h*0.5;
  o.dmgZ = clamp(z, base + 10, base + h);
  if(o.weakPoint === undefined){
    o.weakPoint = exploreIsWeakPointHit(target, z);
    if(o.weakPoint) o.weakAuto = true;
  }
  return o;
}
/* 予告の色。地面との明るさの差が EXPLORE_TELEGRAPH.minContrast 未満なら、
   暗い地面では白へ、明るい地面(雪)では赤へ寄せる。地面の明るさは地域の色(REAL3D_THEMES)から */
function exploreLum(hex){ const c = exploreRgb(hex); return 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2]; }
function exploreGroundLum(regionId){
  const th = (typeof REAL3D_THEMES !== 'undefined' && REAL3D_THEMES.explore && REAL3D_THEMES.explore.regions)
    ? REAL3D_THEMES.explore.regions[regionId] : null;
  if(!th) return 0.35;
  const toL = (n)=> 0.2126*((n>>16)&255)/255 + 0.7152*((n>>8)&255)/255 + 0.0722*(n&255)/255;
  return (toL(th.low) + toL(th.high)) / 2;
}
function exploreTelegraphColor(color, regionId){
  const T = EXPLORE_TELEGRAPH;
  const gl = exploreGroundLum(regionId);
  if(Math.abs(exploreLum(color) - gl) >= T.minContrast) return color;
  return gl > 0.5 ? exploreMixHex(color, T.towardDark, T.pushDark) : exploreMixHex(color, T.towardLight, T.pushLight);
}
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
    // 弱点の数字と「弱点！」は照準の近くに出す(combat.js → exploreWeakPop)。技の弾で頭に当てたら別の音
    if(weak && opts.weakAuto) playSe('sniper', { kind:'crit' });
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
// s.S があればその間の長さ(力尽きた瞬間の一瞬のスロー EXPLORE_FAINT_SLOWMO)。無ければボス討伐の間
function exploreTimeScale(){
  const s = exploreState.slowmo;
  let k = 1;
  if(s){
    const S = s.S || EXPLORE_BOSS_KILL_SLOWMO;
    const t = (performance.now() - s.t0) / 1000;
    if(t < S.holdSec) k = S.scale;
    else if(t < S.holdSec + S.easeSec) k = S.scale + (1 - S.scale) * ((t - S.holdSec) / S.easeSec);
    else exploreState.slowmo = null;
  }
  exploreState.timeScaleNow = k;   // 実時間の時計(rawClock)が割り戻す値
  return k;
}

/* =====================================================================
   落とし物(倒した/壊した相手から素材が弾ける)
   **何を落とすかは data.js の exploreDropTable / EXPLORE_DROP_TABLES、落とす処理はこの関数1つ。**
   ルート担当が見た目(光の柱・拾う動き)を差し替えるときはここだけを直す。
   素材は地面へ弾けて落ち、レア度の光の柱が立つ(explore_loot.js の exploreSpawnDrop)。拾いに行くと入手。
   遠くから狙撃で倒しても、光の柱を目印に取りに行ける(APEX)。火花(fx_gl)だけはここで出す。
   ===================================================================== */
function exploreDropLoot(ent, table, opts){
  if(!ent || !table || !game.explore || game.over) return [];
  const list = exploreRollDropTable(table);
  const big = !!ent.isExploreBoss;
  const z0 = big ? exploreBodyHeight(ent)*0.5 : 30;
  /* realTime: 討伐のスローモーション中でも実時間の速さで跳ねさせる。品の飛ぶ時間は試合の時間で
     決まっている(explore_loot.js)ので、スローの倍率ぶん短くしておけば画面上は普段の速さになる */
  const k = (opts && opts.realTime && exploreState.slowmo) ? EXPLORE_BOSS_KILL_SLOWMO.scale : 1;
  const now = matchTime;
  list.forEach((it, i)=>{
    const a = rand(0, Math.PI*2);
    const r0 = big ? ent.radius*0.9 : 30, r1 = big ? ent.radius*1.9 : 110;
    if(typeof exploreSpawnDrop==='function'){
      const d = exploreSpawnDrop(ent.x, ent.y, it.key, null, { n:it.n, fromZ:z0, dist:[r0, r1], delay:i*0.06, angle:a });
      if(d && k !== 1){
        const born = now + (d.bornAt - now)*k;
        d.landAt = born + (d.landAt - d.bornAt)*k;
        d.bornAt = born;
      }
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
  list.push({ kind, t0:matchTime, raw0:exploreState.rawClock, dur:o.dur || 2, ...o });
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
  /* fx.ring は地面の高さへ1点ずつ沿わせる共通の輪(他の技とも共有)なので、
     急な斜面では輪の遠い側だけ大きく持ち上がり「V字に地面を這う」ように見えていた
     (批評指摘)。咆哮はここだけ、地形に沿わせない「ボスの周りに留まる粒子の輪」に置き換える。 */
  for(let i=0; i<3; i++){
    fx.burst({ x:b.x, y:b.y, z:(b.z||0) + 8 + i*6, count:14, speed:220 + i*60, elev:0.02, elevSpread:0.12,
               jitter:b.radius*0.3, r:c[0], g:c[1], b:c[2], bright:0.65, life:0.5 + i*0.15, size0:20, az:-30, hot:0 });
  }
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
  // 閃光は見出しの文字を白く飛ばさないよう控えめに、上ではなく横へ散らす
  fx.burst({ x:b.x, y:b.y, z:head, count:22, speed:380, elev:-0.1, elevSpread:0.8, r:c[0], g:c[1], b:c[2], bright:0.85, life:0.8, size0:12, stretch:0.5 });
  const c2 = exploreRgb(color);
  fx.burst({ x:b.x, y:b.y, z:head, count:16, speed:300, elev:0.1, elevSpread:0.9, r:c2[0], g:c2[1], b:c2[2], bright:0.7, life:1.2, size0:22, az:-700, hot:0 });
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
// 巨体が崩れた・倒れた: 足元の土煙の輪
function exploreFxGroundSlam(b, k){
  const fx = exploreFxLayer();
  if(!fx) return;
  const dust = [0.58, 0.5, 0.4];
  fx.ring({ x:b.x, y:b.y, r0:b.radius*0.7, r1:b.radius*2.6*k, life:0.9, color:dust, width:22, bright:0.45 });
  fx.ring({ x:b.x, y:b.y, r0:b.radius*0.5, r1:b.radius*1.7*k, life:0.6, color:dust, width:14, bright:0.35 });
  fx.burst({ x:b.x, y:b.y, z:(b.z||0) + 12, count:Math.round(30*k), speed:260, elev:0.25, elevSpread:0.3, jitter:b.radius*1.3,
             r:dust[0], g:dust[1], b:dust[2], bright:0.55, life:1.4, size0:70, hot:0, az:30, turb:40 });
}
// 怒り中: 口元から白い息(煙)を吐く
function exploreFxBreath(b){
  const fx = exploreFxLayer();
  if(!fx) return;
  const h = exploreBodyHeight(b);
  const fa = b.facingAngle;
  fx.burst({ x:b.x + Math.cos(fa)*b.radius*0.4, y:b.y + Math.sin(fa)*b.radius*0.4, z:(b.z||0) + h*0.72,
             count:18, angle:fa, spread:0.5, elev:0.1, elevSpread:0.3, speed:190, jitter:b.radius*0.12,
             r:0.95, g:0.93, b:0.92, bright:0.75, life:1.4, size0:50, size1:110, hot:0, az:50, turb:26, delaySpread:0.35 });
  // 口元の赤熱(息の芯。遠くからでも「吐いている」と分かる)
  fx.burst({ x:b.x + Math.cos(fa)*b.radius*0.45, y:b.y + Math.sin(fa)*b.radius*0.45, z:(b.z||0) + h*0.72,
             count:8, angle:fa, spread:0.35, elev:0.05, elevSpread:0.2, speed:240, r:1, g:0.45, b:0.15, bright:1.1, life:0.5, size0:26 });
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
/* ---- 描画の座標の決まり ----
   drawMonster の座標系は「足元の投影点から上へ 0.85×半径 ずらした所が原点、単位はワールド」。
   足元は y = +0.85×半径、高さ z(足元から)の点は y = 0.85×半径 − z。 */
function exploreFootY(e){ return e.radius*0.85; }
/* 足元より下(絵より先)に描く物(render.js の drawMonster から)。
   ・野生: 敵の赤い輪(自分と同じ種でも一目で敵と分かる)。群れの長は金の二重の輪
   ・ボス: 輪郭の外側の光(常時はボスの色。怒り中は赤黒い光)+足元の赤い熱 */
function exploreDrawMonsterUnder(e, uiMult, p){
  if(!e.alive) return;
  if(e.isPlayer){ exploreDrawGearAura(e, p); return; }   // 自分: 着けている装備のセットの色のオーラと足元の紋章(explore_loot.js)
  // 足元の輪は気づいて向かってくる個体だけ(全員に付けると盤上の駒に見える=批評指摘)
  if(e.isExploreWild && p && (e.exState === 'chase' || e.exState === 'alert')) exploreDrawFootRing(e, p);
  if(e.isExploreBoss && e.exState === 'dying'){
    // 崩れ落ちる影。横倒しになった体の向き(tilt)に合わせて伸ばす(丸い影のままだと板が浮いて見える)
    const pose = exploreComputePose(e) || { tilt:0 };
    const fy = exploreFootY(e);
    ctx.save();
    ctx.translate(0, fy*0.7);
    ctx.rotate(pose.tilt || 0);
    const sr = e.radius*1.15;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, sr);
    g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(0.7, 'rgba(0,0,0,0.28)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, sr, sr*0.36, 0, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    return;
  }
  if(!e.isExploreBoss || e.exState === 'stagger' || e.exState === 'sleep') return;
  const def = exploreBossDef(e);
  const img = (typeof getDisplayImage==='function') ? getDisplayImage(e) : null;
  if(!img) return;
  const L = portraitLayoutFor(e, img);
  const need = Math.max(L.dw, L.dh) * _monDrawScale * (typeof dpr!=='undefined' ? dpr : 1);
  const spr = scaledSpriteFor(img, need);
  const draw = (tint, k, alpha, op)=>{
    if(!tint) return;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    ctx.drawImage(tint, -L.dw*k/2, L.dy - L.dh*k/2, L.dw*k, L.dh*k);   // 絵の中心を基準に広げる
  };
  ctx.save();
  /* 縁取り・発光は本体と同じ位置・同じ大きさで描く(本体を描く変換をそのまま使う)。
     溜め(構え)の姿勢は縮み・反り・傾きを付けるため、ここで姿勢を掛けないと本体だけが
     ずれて動き、光だけが元の位置に残る「二重に見える」不具合になる(批評指摘)。 */
  const underPose = exploreComputePose(e);
  if(underPose){
    const fy = exploreFootY(e);
    ctx.translate(underPose.shx || 0, fy + (underPose.bob || 0));
    if(underPose.tilt) ctx.rotate(underPose.tilt);
    ctx.scale(underPose.sx, underPose.sy);
    ctx.translate(0, -fy);
  }
  if(e.exRage){
    // 赤黒い光: 暗い赤の縁を大きめに敷き、その内側に明るい赤を足す(体の色は変えない)
    const pulse = 0.7 + 0.3*Math.sin(matchTime*7);
    // 太い赤黒の光: 外側ほど暗く大きく重ね、内側に明るい赤(体の色は変えない)
    draw(exploreTintSprite(spr, '#1a0000'), 1.2 + 0.03*Math.sin(matchTime*9), 0.5, 'source-over');
    draw(exploreTintSprite(spr, '#5a0000'), 1.13, 0.6, 'source-over');
    // 弱点ヒットの白フラッシュ・火花と重なると顔の周りがさらに明るくなりすぎていた(批評指摘)ので少し弱める
    draw(exploreTintSprite(spr, '#ff2410'), 1.08, 0.55*pulse, 'lighter');
    draw(exploreTintSprite(spr, '#ff6a2a'), 1.04, 0.3*pulse, 'lighter');
  } else if(def){
    // 常時: ボスの色の輪郭の光(同じスキンを着たプレイヤーの「巨大な自分」に見せない)
    draw(exploreTintSprite(spr, def.color), 1.05, 0.40 + 0.08*Math.sin(matchTime*2.2), 'lighter');
  }
  ctx.restore();
  if(e.exRage){
    const rx = e.radius*1.5*uiMult, ry = e.radius*0.55*uiMult;
    const pulse = 0.55 + 0.3*Math.sin(matchTime*6);
    ctx.save();
    ctx.translate(0, e.radius*0.7);
    ctx.scale(1, ry/rx);
    const g = ctx.createRadialGradient(0, 0, rx*0.2, 0, 0, rx);
    g.addColorStop(0, `rgba(255,50,30,${0.5*pulse})`);
    g.addColorStop(1, 'rgba(255,40,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }
}
// 野生の足元の輪。地面の円は1点ずつ投影する(画面上の楕円を決め打ちしない)
const EXPLORE_RING_SEG = 20;
function exploreDrawFootRing(e, p){
  const s = Math.max(0.01, p.scale);
  const fy = exploreFootY(e);
  const z = e.z || 0;
  const ring = (rad)=>{
    ctx.beginPath();
    let first = true;
    for(let i=0; i<=EXPLORE_RING_SEG; i++){
      const a = i/EXPLORE_RING_SEG*Math.PI*2;
      const q = project(e.x + Math.cos(a)*rad, e.y + Math.sin(a)*rad, z);
      if(!q){ first = true; continue; }
      const lx = (q.x - p.x)/s, ly = (q.y - p.y)/s + fy;   // 足元の投影点 p が y=fy
      if(first){ ctx.moveTo(lx, ly); first = false; } else ctx.lineTo(lx, ly);
    }
  };
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = 'rgba(30,0,0,0.5)'; ctx.lineWidth = 3.5/s;
  ring(e.radius*1.1); ctx.stroke();
  ctx.strokeStyle = e.exLeader ? '#ffc94a' : 'rgba(255,70,55,0.9)'; ctx.lineWidth = 1.8/s;
  ring(e.radius*1.1); ctx.stroke();
  ctx.restore();
}
// 絵の形の単色の影絵(光・色味に使う)。縮小版ごとに1回だけ作ってキャッシュする
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
/* 絵の直後に重ねる物(姿勢の変形の内側。render.js の drawMonster から)。
   ・ボス: 常時の色味(ボスの色を薄く乗算)/ 討伐で崩れ落ちたあと色が抜ける / 怒り中は赤い目の光と尾 */
function exploreDrawMonsterTint(e, img, L){
  if(e.isPlayer){ explorePlayerTint(e, img, L); exploreDrawWornOnPlayer(e, 'front'); return; }   // 自分: 力尽きて色が抜ける・着けた装備を体に重ねる(explore_loot.js)
  if(!e.isExploreBoss || !img || !L) return;
  const def = exploreBossDef(e);
  const need = Math.max(L.dw, L.dh) * _monDrawScale * (typeof dpr!=='undefined' ? dpr : 1);
  const spr = scaledSpriteFor(img, need);
  ctx.save();
  if(def){
    const t = exploreTintSprite(spr, exploreMixHex(def.color, '#ffffff', 0.45));
    if(t){ ctx.globalAlpha = 0.38; ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(t, -L.dw/2, -L.dh/2+L.dy, L.dw, L.dh); }
  }
  if(e.exState === 'dying'){
    // 崩れ落ち(0.8秒)のあと、色が抜けていく
    const k = clamp((matchTime - (e.exPoseAt || matchTime) - 0.8) / 1.2, 0, 1);
    const g = exploreTintSprite(spr, '#808080');
    if(g && k > 0){
      ctx.globalCompositeOperation = 'saturation'; ctx.globalAlpha = k;
      ctx.drawImage(g, -L.dw/2, -L.dh/2+L.dy, L.dw, L.dh);
      ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.45*k;
      ctx.drawImage(g, -L.dw/2, -L.dh/2+L.dy, L.dw, L.dh);
    }
  }
  /* 技で弱点に当てた瞬間: 本体が一瞬白く光る(exploreWeakPop と組)。
     render.js の一般のヒット白フラッシュ(e.hitFlash)と同時に重なると足し合わさって
     頭が真っ白に飛び、顔が消えて見えた(批評指摘)ので、上限を下げて輪郭が残るようにする。 */
  const wf = exploreState.rawClock - (e.exWeakFlashAt != null ? e.exWeakFlashAt : -9);
  if(wf >= 0 && wf < 0.12 && typeof whiteMaskFor === 'function'){
    // 純白で上塗り(加算だと下の色味が残って桃色がかって見えた)
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.14*(1 - wf/0.12);
    ctx.drawImage(whiteMaskFor(spr), -L.dw/2, -L.dh/2+L.dy, L.dw, L.dh);
  }
  // 溜めの間は体の色が脈打つ(放つ直前ほど速く・強く)
  if(e.exPending && e.exState === 'fight' && def){
    const pd = e.exPending;
    const k = clamp((matchTime - pd.startAt) / Math.max(0.05, pd.fireAt - pd.startAt), 0, 1);
    const g = exploreTintSprite(spr, def.color);   // 技の色(突進の赤など)で白い体が桃色に染まらないようボスの色で
    if(g){
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (0.12 + 0.38*k) * (0.55 + 0.45*Math.sin(matchTime*(8 + 22*k)));
      ctx.drawImage(g, -L.dw/2, -L.dh/2+L.dy, L.dw, L.dh);
    }
  }
  ctx.restore();
  if(e.exBroken) exploreDrawBrokenNotch(e);
  if(e.exRage && e.exState !== 'dying') exploreDrawRageEyes(e);
}
/* 部位破壊の後の欠け。弱点の高さ(頭)の絵を削り取り(下の3D地面が見える)、割れた縁を描く。
   姿勢の変形の内側で描くので、倒れている間も体と一緒に動く */
function exploreDrawBrokenNotch(e){
  const h = exploreBodyHeightRaw(e);
  const N = exploreNotchGeom(e);
  const top = N.top, pts = N.pts, P = N.P, cx = N.cx;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  pts.forEach((q, i)=>{ const [x, y] = P(q); if(i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.lineTo(P([0.5,0])[0], top - h*0.2); ctx.lineTo(P([-0.5,0])[0], top - h*0.2);
  ctx.closePath(); ctx.fill();
  // 割れた縁は体の絵の上にだけ(source-atop。欠けの外の空に線が浮かない)
  ctx.globalCompositeOperation = 'source-atop';
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((q, i)=>{ const [x, y] = P(q); if(i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  // 断面: 太い赤黒の縁(内側の肉)+ 暗い輪郭 + 赤熱した細い線
  // 断面は小さく: 暗い輪郭+赤熱した細い線だけ(太い線は胸の前の稲妻に見えた=批評指摘)
  ctx.strokeStyle = 'rgba(25,8,4,0.95)'; ctx.lineWidth = N.hw*0.22; ctx.stroke();
  ctx.strokeStyle = '#ffb040'; ctx.lineWidth = N.hw*0.08;
  ctx.globalAlpha = 0.75 + 0.25*Math.sin(matchTime*6);
  if(!renderHeavyLoad){ ctx.shadowBlur = 10; ctx.shadowColor = '#ff7a20'; }
  ctx.stroke();
  ctx.restore();
}
/* 部位破壊で欠ける所(頭の上端・幅の3割ほど)。欠けの描画と飛ぶ破片が同じ形を読む(drawMonster の座標) */
const EXPLORE_NOTCH_PTS = [[-0.5,0],[-0.38,0.45],[-0.46,0.7],[-0.16,0.62],[-0.12,1],[0.1,0.7],[0.3,0.92],[0.34,0.5],[0.5,0.35],[0.44,0]];
function exploreNotchGeom(e){
  const h = exploreBodyHeightRaw(e), fy = exploreFootY(e), r = e.radius;
  const img = (typeof getDisplayImage === 'function') ? getDisplayImage(e) : null;
  const L = img && typeof portraitLayoutFor === 'function' ? portraitLayoutFor(e, img) : null;
  const bb = img && typeof opaqueBBoxFor === 'function' ? opaqueBBoxFor(img) : null;
  const pk = img ? exploreHeadPeak(img) : null;
  let cx, top, hw;
  if(L && bb && pk){
    // 絵の頭のてっぺん(中央付近で一番高い不透明な点)に合わせる。翼の先ではなく角のあたり
    cx = -L.dw/2 + pk.ix*L.scale;
    top = -L.dh/2 + L.dy + pk.iy*L.scale;
    hw = bb.w*L.scale*0.15;   // 幅は体の3割
  } else {
    cx = r*0.12; top = fy - h; hw = r*BODY_W_MAX*0.3;
  }
  top -= hw*0.08;
  const bot = top + hw*0.95;
  const P = (q)=> [cx + q[0]*hw, top + (bot - top)*q[1]];
  return { top, bot, cx, hw, P, pts:EXPLORE_NOTCH_PTS };
}
// 絵の頭のてっぺん(不透明な体の幅の中央4割で一番高い所。角・とさかが並ぶならその中心)。絵ごとに1回だけ測る
const _exploreHeadPeakCache = new WeakMap();
function exploreHeadPeak(img){
  if(_exploreHeadPeakCache.has(img)) return _exploreHeadPeakCache.get(img);
  let res = null;
  try{
    const bb = opaqueBBoxFor(img);
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const k = Math.min(1, 160/Math.max(iw, ih)), mw = Math.max(1, Math.round(iw*k)), mh = Math.max(1, Math.round(ih*k));
    const c = document.createElement('canvas'); c.width = mw; c.height = mh;
    const g = c.getContext('2d', { willReadFrequently:true });
    g.drawImage(img, 0, 0, mw, mh);
    const d = g.getImageData(0, 0, mw, mh).data;
    const x0 = Math.floor((bb.x0 + bb.w*0.3)*k), x1 = Math.ceil((bb.x0 + bb.w*0.7)*k);
    const tops = [];
    for(let x=x0; x<x1; x++){
      let y = 0;
      while(y < mh && d[(y*mw + x)*4 + 3] <= 100) y++;
      tops.push([x, y]);
    }
    const minY = Math.min(...tops.map(t=> t[1]));
    const near = tops.filter(t=> t[1] <= minY + bb.h*k*0.06);
    const ax = near.reduce((a, t)=> a + t[0], 0) / Math.max(1, near.length);
    if(minY < mh) res = { ix: (ax + 0.5)/k, iy: minY/k };
  }catch(err){ res = null; }
  _exploreHeadPeakCache.set(img, res);
  return res;
}
// 怒りの目: 弱点の高さに赤い光点2つと、動きと逆へ流れる光の尾(こちらを向いているときだけ)
function exploreDrawRageEyes(e){
  if(Math.cos(e.facingAngle - camState.yaw) > 0.35) return;   // 背を向けている
  const h = exploreBodyHeightRaw(e), wp = e.weakPoint || EXPLORE_BOSS_WEAK_POINT;
  const ey = exploreFootY(e) - h*((wp.from + wp.to)/2 + 0.02);
  const ex = e.radius*0.13;
  // 動きの向き(画面の左右)。止まっていれば尾は上へ揺らめく
  const lat = -(e._mwDirX||0)*Math.sin(camState.yaw) + (e._mwDirY||0)*Math.cos(camState.yaw);
  const moving = (e._mwSpeed||0) > 20;
  const tx = moving ? -Math.sign(lat)*e.radius*0.9 : Math.sin(matchTime*5)*e.radius*0.1;
  const ty = moving ? -e.radius*0.08 : -e.radius*0.5;
  const flick = 0.8 + 0.2*Math.sin(matchTime*23);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for(const sx of [-ex, ex]){
    const g = ctx.createLinearGradient(sx, ey, sx + tx, ey + ty);
    g.addColorStop(0, 'rgba(255,60,40,0.9)'); g.addColorStop(1, 'rgba(255,20,0,0)');
    ctx.strokeStyle = g; ctx.lineWidth = e.radius*0.07; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sx, ey); ctx.quadraticCurveTo(sx + tx*0.5, ey + ty*0.2, sx + tx, ey + ty); ctx.stroke();
    const r = e.radius*0.075*flick;
    const rg = ctx.createRadialGradient(sx, ey, 0, sx, ey, r*2.2);
    rg.addColorStop(0, 'rgba(255,255,230,1)'); rg.addColorStop(0.25, 'rgba(255,60,40,0.95)'); rg.addColorStop(1, 'rgba(255,0,0,0)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(sx, ey, r*2.2, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();
}
/* 姿勢(render.js の drawMonster が絵を描く直前に呼ぶ。true を返したら save 済みで、絵のあと restore される)。
   回転の板にしない: 足元を軸に「縦に潰す・傾ける・上下に揺らす」だけで倒れ方を見せる。
   ・ボスの転倒: 縦0.55倍に潰れて沈み、10〜20°傾いてぐらぐら揺れる(ひるみ)
   ・ボスの討伐: 縦1→0.4へ0.8秒で崩れ落ち、最後に薄れて消える
   ・ボスの眠り: 低く伏せて、ゆっくり息をする / 逃走: 片側へ傾いて上下する(足を引きずる)
   ・野生の逃走: 左右に傾いて跳ねる / うろつきの立ち止まり: 頭を下げて草を食む(縦0.9倍) */
function exploreBeginPose(e){
  const P = exploreComputePose(e);
  if(!P){
    if(e && e.isPlayer) exploreDrawWornOnPlayer(e, 'behind');   // 自分: 着けた武器(前向きは体の後ろ)。explore_loot.js
    return false;
  }
  ctx.save();
  const fy = exploreFootY(e);
  ctx.translate(P.shx, fy + P.bob);
  if(P.tilt) ctx.rotate(P.tilt);
  ctx.scale(P.sx, P.sy);
  ctx.translate(0, -fy);
  if(P.alpha < 1) ctx.globalAlpha *= P.alpha;
  if(e.isPlayer) exploreDrawWornOnPlayer(e, 'behind');
  return true;
}
/* 「目玉系」の野生(スエゾー等)は体がしずく形+目1つで、飾りの少なさゆえ立ち止まると
   地図のピン(目印)にしか見えない(批評指摘)。画像そのものは変えず、絶えずぴょこぴょこ
   跳ねさせて「生き物」に見せる。他の種は歩行アニメ等で既に動きがあるため対象にしない。 */
const EXPLORE_PIN_LOOK_WILD = ['suezo'];
// 姿勢の値だけを返す(描画と当たりの背の両方が読む。null = 立った姿勢のまま)
function exploreComputePose(e){
  if(e && e.isPlayer && game.explore) return explorePlayerPose(e);   // 自分: 力尽きて倒れる/キャンプで起き上がる(explore_loot.js)
  if(!e || !(e.isExploreBoss || e.isExploreWild) || !e.alive) return null;
  const now = matchTime, r = e.radius;
  let sy = 1, sx = 1, tilt = 0, bob = 0, alpha = 1, shx = 0;
  const st = e.exState;
  if(e.isExploreBoss){
    const t = now - (e.exPoseAt || now), sign = e.exTiltSign || 1;
    if(e.exPending && st === 'fight'){
      // 溜め: 縮みながら後ろへ反り、放つ直前に膨らんで前へ(ボスが静止したまま地面だけ光らないように)
      const pd = e.exPending;
      const k = clamp((now - pd.startAt) / Math.max(0.05, pd.fireAt - pd.startAt), 0, 1);
      // 構え: 大きく沈んで後ろへ反り(力を溜める)、放つ直前に伸び上がって前へ(モンハンの「構え」)
      if(k < 0.75){ const q = k/0.75; sy = 1 - 0.22*q; sx = 1 + 0.12*q; tilt = -sign*0.2*q; bob = r*0.04*q; }
      else { const q = (k - 0.75)/0.25; sy = 0.78 + 0.34*q; sx = 1.12 - 0.16*q; tilt = sign*(-0.2 + 0.3*q); bob = -r*0.12*q; }
      tilt += Math.sin(now*40)*0.02*k;   // 力んで細かく震える
    } else if(st === 'stagger'){
      const w = clamp(t/0.22, 0, 1) * clamp((e.exStateUntil - now)/0.35, 0, 1);
      // 部位破壊のひるみ: 体ごと大きくのけぞり(頭が後ろへ)、ぐらぐら揺れる。潰しは控えめ
      sy = 1 - (1 - EXPLORE_BOSS_TOPPLE_SQUASH)*w + 0.03*Math.sin(t*13)*w;
      sx = 1 + 0.04*w;
      tilt = -sign*(0.3 + 0.08*Math.sin(t*7))*w;
      bob = -(0.1 + Math.abs(Math.sin(t*7))*0.06)*r*w;   // 打たれて体が浮く
      shx = Math.sin(t*31)*r*0.035*w;                           // 打たれて震える
    } else if(st === 'dying'){
      /* 崩れ落ち: 横倒し(体の軸を90°近くまで倒し、地面に沿わせる)+着地の弾み+わずかな潰れ。
         回転だけ(1周目)は紙の切り抜きに、潰しだけ(2周目)は立ち姿を押しつぶした板に見えた
         (どちらも批評指摘)。回転と軽い潰しを両方使い、着地でわずかに弾んで重さを出す。
         影は exploreDrawMonsterUnder が体の向きに合わせて別に描く。 */
      const k = clamp(t/0.7, 0, 1), ek = 1 - (1-k)*(1-k);
      const land = t > 0.7 ? Math.exp(-(t-0.7)*8)*Math.sin((t-0.7)*24)*0.04 : 0;
      tilt = sign*(1.48*ek + land);   // 90°近くまで倒す(1.48rad≈85°)
      sy = 1 - 0.16*ek; sx = 1 + 0.12*ek;   // 倒れる重さで少しだけ潰れる(潰しは主役にしない)
      // 倒した絵の一番下が地面(足元の高さ)に乗るよう持ち上げる(翼の先が地面へ潜らないように)
      bob = -exploreLowestAfterPose(e, sx, sy, tilt);
      alpha = clamp((e.exStateUntil - now)/0.7, 0, 1);
    } else if(st === 'sleep'){
      sy = 0.6 + 0.02*Math.sin(now*1.6); sx = 1.08; tilt = 0.1;
    } else if(st === 'flee'){
      const ph = now*3.4;
      tilt = 0.12 + 0.09*Math.sin(ph);
      bob = -Math.abs(Math.sin(ph))*r*0.07;
      sy = 0.94 + 0.05*Math.abs(Math.sin(ph));
    } else return null;
  } else {
    if(st === 'flee'){
      // 逃げる向き(画面の左右)へ前のめりに傾き、跳ねながら走る
      const ph = now*11 + e.id;
      const lat = exploreScreenLat(e);
      tilt = (lat >= 0 ? 1 : -1)*0.42 + 0.08*Math.sin(ph);
      bob = -Math.abs(Math.sin(ph))*r*0.4;
      sy = 0.92 + 0.1*Math.abs(Math.sin(ph));
      // 後ろ向きの歩行コマが無い種(正面の1枚絵)は、逃げる向きへ左右反転して「背を向けて駆ける」横顔にする
      if(typeof WALK_ANIM === 'undefined' || !WALK_ANIM[e.element]) sx = (lat >= 0 ? -1 : 1);
    } else if(EXPLORE_PIN_LOOK_WILD.includes(e.element) && (st === 'wander' || st === 'watch') && (e.exSpd || 0) < 12){
      /* 目玉系はうろつき・見つめ中、途切れず「縦に伸びて少し浮く」瞬間を繰り返す(止まって
         見えない)。前回は縮めて跳ねさせたが、影も濃く・大きくした結果「刺さったピン」に
         近い見え方になった(批評指摘)ので、縮めではなく伸び+浮きにし、影は控えめに戻す。 */
      const ph = (now + e.id*0.53) % 1.2;
      const rise = Math.sin(ph/1.2*Math.PI);   // 0→1→0
      sy = 1 + 0.16*rise; sx = 1 - 0.07*rise;
      bob = -rise*r*0.16;
      tilt = 0.04*Math.sin(now*2.2 + e.id);
    } else if(st === 'wander' && (e.exSpd || 0) < 12){
      const ph = (now + e.id*0.37) % 3.4;
      const down = ph < 1.4 ? Math.sin(ph/1.4*Math.PI) : 0;
      if(down <= 0.01) return null;
      sy = 1 - 0.1*down;
      tilt = 0.07*down*((e.id % 2) ? 1 : -1);
    } else return null;
  }
  return { sx, sy, tilt, bob, shx, alpha };
}
// 姿勢(縮み sx,sy と傾き tilt)を掛けた後の、絵の体の一番下の点(足元の軸からの下向きの距離。drawMonster の座標)
function exploreLowestAfterPose(e, sx, sy, tilt){
  const img = (typeof getDisplayImage==='function') ? getDisplayImage(e) : null;
  if(!img || typeof portraitLayoutFor !== 'function') return 0;
  const L = portraitLayoutFor(e, img), bb = opaqueBBoxFor(img);
  if(!L || !bb) return 0;
  const fy = exploreFootY(e);
  const x0 = -L.dw/2 + bb.x0*L.scale, x1 = -L.dw/2 + bb.x1*L.scale;
  const y0 = -L.dh/2 + L.dy + bb.y0*L.scale - fy, y1 = -L.dh/2 + L.dy + bb.y1*L.scale - fy;
  const s = Math.sin(tilt), c = Math.cos(tilt);
  let m = -Infinity;
  for(const x of [x0, x1]) for(const y of [y0, y1]) m = Math.max(m, x*sx*s + y*sy*c);
  return m;
}
/* ボスの画面上の矩形(頭と足を project で投影)。HUD担当が札・文字をボスの外へ逃がすのに使う。
   { x, y, w, h, cx, top, bottom } を画面の画素で返す。画面の後ろ・投影できないときは null */
function exploreBossScreenRect(b){
  if(!b || !b.alive) return null;
  const h = exploreBodyHeight(b);
  const f = project(b.x, b.y, b.z || 0), t = project(b.x, b.y, (b.z || 0) + h);
  if(!f || !t) return null;
  const w = b.radius * 2 * BODY_W_MAX * 0.7 * f.scale;
  return { x: f.x - w/2, y: t.y, w, h: f.y - t.y, cx: f.x, top: t.y, bottom: f.y };
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
  if(!mark) return;
  const lowPose = e.exState === 'stagger' || e.exState === 'sleep';
  // ボスの高さは姿勢(潰れ・伏せ)込みの今の背(exploreBodyHeight)。星は体の上の方、他は頭の上
  let topY = e.isExploreBoss ? -(exploreBodyHeight(e)*(lowPose ? 0.75 : 0.9)) : (barY - 22);
  // 転倒の星は上部の札・HPバーの帯(画面の上から EXPLORE_MARK_TOP_PX)に重ねない。重なるなら体の前へ下げる
  if(mark && mark.kind === 'dizzy'){
    const q = project(e.x, e.y, (e.z||0) + exploreFootY(e) - topY);
    if(q && q.y < EXPLORE_MARK_TOP_PX) topY += (EXPLORE_MARK_TOP_PX - q.y) / s;
  }
  // 群れの長の名札(気づいた「!」の間だけ)。画面の画素で最低12px、印の上に縦にずらして置く
  const nameUp = (e.isExploreWild && e.exLeader && mark && mark.kind === '!');
  const bodyPx = exploreBodyHeight(e) * s;
  const mk = e.isExploreBoss ? 1 : clamp(bodyPx / 58, 0.8, 1.15);   // 下限0.8(遠くでも印は読める大きさ)
  ctx.save();
  ctx.translate(0, topY);
  ctx.scale(1/s, 1/s);            // ここから先は画面の画素
  if(nameUp){
    const label = displayNameFor(e);
    ctx.save();
    ctx.font = `bold ${EXPLORE_WILD_NAME_PX}px 'Rajdhani', sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    const ny = -16 - 13*mk - 10;
    ctx.strokeText(label, 0, ny); ctx.fillStyle = '#ffd35a'; ctx.fillText(label, 0, ny);
    ctx.restore();
  }
  ctx.scale(mk, mk);
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
    ctx.fillText('💦', 12, 10 - Math.abs(Math.sin(now*10))*4);   // 頭のすぐ上(横)
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
const EXPLORE_MARK_TOP_PX = 170;   // 画面の上からこの高さまでは上部の帯・札・HPバーがある
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
// 画面の上に重ねる物(render.js の render() から。探検以外では何もしない)
function exploreDrawScreen(){
  if(!game.explore) return;
  exploreDrawRageEdge();
  exploreDrawMeteors();
  exploreDrawShards();
  exploreDrawFleeFx();
  exploreDrawMoveName();
  exploreDrawCineBars();
  exploreHudFrame();          // 方位バー・全体地図(explore_hud.js。DOMのキャンバスへ描く)
  exploreDrawWeakPops();
  exploreDrawMaterialFx();
  exploreDrawBossHud();
  // 名前の札(plate)を咆哮の文字より先に描く。咆哮の文字側がこの札の矩形を避けられるように
  // する(先に文字を描くと札が後から覆って「文字が帯の裏に隠れる」ことになっていた=批評指摘)
  exploreDrawBanners();
  exploreDrawRoarText();
  exploreCineDraw();   // 出発・力尽き・終了の全画面の札(explore_loot.js)
}
// 地面に1点ずつ投影した影の円
function exploreDrawGroundShadow(x, y, z, r, a){
  ctx.save();
  ctx.beginPath();
  let ok = false;
  for(let j=0; j<=18; j++){
    const t = j/18*Math.PI*2;
    const q = project(x + Math.cos(t)*r, y + Math.sin(t)*r, z + 2);
    if(!q) continue;
    if(!ok){ ctx.moveTo(q.x, q.y); ok = true; } else ctx.lineTo(q.x, q.y);
  }
  if(ok){ ctx.fillStyle = `rgba(10,5,0,${a})`; ctx.fill(); }
  ctx.restore();
}
// 岩の落ち始めの高さ: EXPLORE_METEOR_FALL_H 以下で、投影が画面上部のHUDより下に来る最大の高さ
function exploreMeteorStartH(x, y, zg){
  const band = (typeof exploreHudBand === 'function') ? exploreHudBand() : null;
  const top = Math.max(EXPLORE_MARK_TOP_PX, band ? band.bottom + 40 : 0);
  let lo = 60, hi = EXPLORE_METEOR_FALL_H;
  const ok = (h)=>{ const q = project(x, y, zg + 30 + h); return q && q.y >= top; };
  if(ok(hi)) return hi;
  for(let i=0; i<8; i++){ const mid = (lo + hi)/2; if(ok(mid)) lo = mid; else hi = mid; }
  return lo;
}
// 流星群・岩石落としの予告の間、上空から岩が落ちてくる(光の筋+岩+だんだん濃く大きくなる影)
function exploreDrawMeteors(){
  const now = matchTime;
  for(const rec of exploreState.bosses){
    const b = getEntity(rec.id);
    const pend = b && b.alive ? b.exPending : null;
    if(!pend || pend.mv.shape !== 'meteor') continue;
    const col = pend.color || '#ff8a3a';
    // 岩は「次に落ちる1つ」だけ(地面の印の縮む輪とセット)。他は影だけ
    let nextM = null;
    for(const m of pend.marks) if(!m.fired && (!nextM || m.fireAt < nextM.fireAt)) nextM = m;
    pend.marks.forEach((m, i)=>{
      if(m.fired) return;
      const k = clamp((now - pend.startAt) / Math.max(0.05, m.fireAt - pend.startAt), 0, 1);
      if(m !== nextM){
        // 次以外: 落下地点の影だけ(だんだん濃く)
        exploreDrawGroundShadow(m.x, m.y, baseTerrainHeightAt(m.x, m.y), m.r*(0.25 + 0.35*k), 0.08 + 0.22*k);
        return;
      }
      const zg = baseTerrainHeightAt(m.x, m.y);
      // 影(地面に1点ずつ投影した円。落ちてくるほど濃く・大きく)
      const sr = m.r*(0.15 + 0.45*k);
      ctx.save();
      ctx.beginPath();
      let ok = false;
      for(let j=0; j<=18; j++){
        const a = j/18*Math.PI*2;
        const q = project(m.x + Math.cos(a)*sr, m.y + Math.sin(a)*sr, zg + 2);
        if(!q) continue;
        if(!ok){ ctx.moveTo(q.x, q.y); ok = true; } else ctx.lineTo(q.x, q.y);
      }
      if(ok){ ctx.fillStyle = `rgba(10,5,0,${0.2 + 0.5*k})`; ctx.fill(); }
      // 岩(少し斜めに落ちる)と光の筋
      const fall = Math.pow(1 - k, 1.5);
      // 真上から落とす。落ち始めの高さは「その上空が画面に入る高さ」(上部のHUDの下)まで下げる。
      // 足元近くの印は真上が画面の外になるので、固定の高さだと岩が見えないまま落ちていた
      const H0 = exploreMeteorStartH(m.x, m.y, zg);
      const rx = m.x, ry = m.y, rz = zg + 30 + H0*fall;
      const tf = Math.pow(1 - Math.max(0, k - 0.12), 1.5);
      const tx = m.x, ty = m.y, tz = zg + 30 + H0*tf + H0*0.35;
      const P = project(rx, ry, rz), T = project(tx, ty, tz);
      // 落下地点と岩を縦の線でつなぐ(どこへ落ちるかが一目で分かる)
      const G = project(m.x, m.y, zg + 2);
      if(P && G){
        ctx.save();
        ctx.setLineDash([6, 6]); ctx.lineDashOffset = -now*60;
        ctx.strokeStyle = 'rgba(255,230,190,0.85)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(G.x, G.y); ctx.lineTo(P.x, P.y); ctx.stroke();
        ctx.restore();
      }
      if(P && T){
        const rad = clamp(46*P.scale, 3, 26);
        const vis = 1;   // 落ち始めの高さを画面に入る所に選んであるので、最初から見せる
        if(vis > 0){
          ctx.globalAlpha = vis;
          // 火の尾(外側は橙、芯は白熱)
          ctx.globalCompositeOperation = 'lighter';
          ctx.lineCap = 'round';
          const g = ctx.createLinearGradient(T.x, T.y, P.x, P.y);
          g.addColorStop(0, 'rgba(255,90,20,0)'); g.addColorStop(0.6, 'rgba(255,110,30,0.7)'); g.addColorStop(1, '#ffb040');
          ctx.strokeStyle = g; ctx.lineWidth = rad*1.7;
          ctx.beginPath(); ctx.moveTo(T.x, T.y); ctx.lineTo(P.x, P.y); ctx.stroke();
          const g2 = ctx.createLinearGradient(T.x, T.y, P.x, P.y);
          g2.addColorStop(0, 'rgba(255,240,200,0)'); g2.addColorStop(1, '#fff2c8');
          ctx.strokeStyle = g2; ctx.lineWidth = rad*0.5;
          ctx.beginPath(); ctx.moveTo(T.x, T.y); ctx.lineTo(P.x, P.y); ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
          // ごつごつした岩(形は印ごとに固定)。回りながら落ちる
          ctx.save();
          ctx.translate(P.x, P.y);
          ctx.rotate(now*5 + i);
          ctx.beginPath();
          for(let j=0; j<9; j++){
            const aa = j/9*Math.PI*2;
            const rr = rad*(0.72 + 0.28*Math.abs(Math.sin(i*12.9898 + j*78.233)));
            const px = Math.cos(aa)*rr, py = Math.sin(aa)*rr;
            if(j) ctx.lineTo(px, py); else ctx.moveTo(px, py);
          }
          ctx.closePath();
          const rg = ctx.createRadialGradient(-rad*0.3, -rad*0.3, rad*0.1, 0, 0, rad);
          rg.addColorStop(0, '#7a5a42'); rg.addColorStop(0.6, '#3a2418'); rg.addColorStop(1, '#140a06');
          ctx.fillStyle = rg; ctx.fill();
          ctx.lineWidth = Math.max(1.5, rad*0.16); ctx.strokeStyle = '#ff8a30';
          if(!renderHeavyLoad){ ctx.shadowBlur = 10; ctx.shadowColor = '#ff6a10'; }
          ctx.stroke();
          ctx.shadowBlur = 0;
          // 陰影: 光の当たる面(左上)と、暗い割れ目(ごつごつ)。下半分は赤熱
          ctx.fillStyle = 'rgba(190,150,120,0.55)';
          ctx.beginPath(); ctx.moveTo(-rad*0.62, -rad*0.1); ctx.lineTo(-rad*0.35, -rad*0.6); ctx.lineTo(rad*0.05, -rad*0.66); ctx.lineTo(-rad*0.1, -rad*0.22); ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(255,120,30,0.55)';
          ctx.beginPath(); ctx.moveTo(-rad*0.5, rad*0.35); ctx.lineTo(rad*0.1, rad*0.7); ctx.lineTo(rad*0.6, rad*0.3); ctx.lineTo(rad*0.2, rad*0.2); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(10,4,2,0.9)'; ctx.lineWidth = Math.max(1, rad*0.08);
          ctx.beginPath(); ctx.moveTo(-rad*0.2, -rad*0.4); ctx.lineTo(rad*0.05, 0); ctx.lineTo(-rad*0.15, rad*0.35);
          ctx.moveTo(rad*0.05, 0); ctx.lineTo(rad*0.45, -rad*0.15); ctx.stroke();
          ctx.restore();
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
    });
  }
}
// 登場の視点演出(咆哮 intro)。ボスへ向き直る・寄る・黒帯・操作ボタンを暗く(毎フレーム updateExplore から)
/* 視点演出を始める。kind = 'intro'(登場。EXPLORE_BOSS_CINE)/ 'hunt'(討伐。EXPLORE_BOSS_HUNT_CINE)。
   時間はスローモーションの影響を受けない rawClock で測る(討伐のスロー中も普段の速さで向き直る) */
function exploreCineParams(c){ return (c && c.kind === 'hunt') ? EXPLORE_BOSS_HUNT_CINE : (c && c.kind === 'rage') ? EXPLORE_BOSS_RAGE_CINE : EXPLORE_BOSS_CINE; }
function exploreStartCine(b, kind){
  if(!player) return;
  if(exploreState.cine && exploreState.cine.kind !== 'rage' && kind === 'rage') return;   // 登場・討伐の演出中は上書きしない
  exploreState.cine = { bossId:b.id, kind, t0:exploreState.rawClock, yaw0:camState.yaw, pitch0:camState.pitch };
  if(kind !== 'rage') document.body.classList.add('explore-cine');
}
function exploreUpdateCine(){
  const c = exploreState.cine;
  if(!c) return;
  const C = exploreCineParams(c);
  const t = exploreState.rawClock - c.t0;
  const b = getEntity(c.bossId);
  if(t >= C.dimSec) document.body.classList.remove('explore-cine');
  if(!b || !player || t > Math.max(C.zoomSec, C.dimSec) + 0.3){
    exploreState.cine = null;
    document.body.classList.remove('explore-cine');
    return;
  }
  if(C.noPitch) return;   // 怒りの寄りは視点を動かさない(寄りだけ exploreCineFrame が掛ける)
  // 背後で咆哮されても必ず見えるよう、turnSec でボスへ向き直る(その後はプレイヤーの操作に返す)
  if(t <= C.turnSec + 0.05){
    const e = sniperEaseLocal(t / C.turnSec);
    camState.yaw = c.yaw0 + angleDiff(angTo(player, b), c.yaw0) * e;
  }
  // 寄っている間は巨体が頭まで入るよう見上げ、寄りが終わったら元の角度へ戻す
  const h = exploreBodyHeight(b);
  const look = -Math.atan2((b.z || 0) + h*(C.lookZ != null ? C.lookZ : 0.5) - camPos.z, Math.max(200, Math.hypot(b.x - camPos.x, b.y - camPos.y)));
  // 見上げの上限は camPitchMin() まで許す(-0.3 止まりだと巨体の頭がHUDに食い込んだ=批評指摘)
  const pT = clamp(Math.min(look, c.pitch0), camPitchMin(), 0.5);
  if(t <= C.zoomSec){
    camState.pitch = c.pitch0 + (pT - c.pitch0) * sniperEaseLocal(t / C.turnSec);
  } else if(t <= C.zoomSec + 0.3){
    camState.pitch = pT + (c.pitch0 - pT) * sniperEaseLocal((t - C.zoomSec) / 0.3);
  }
}
/* 探検のフィールドは尾根・峡谷の壁が地面の高さそのもの(exploreRelief)なので、肩越しのカメラが
   背後の崖に埋まると画面が霞の色一色になる。プレイヤー→カメラの線の上の地面より
   EXPLORE_CAM_CLEARANCE だけ上にカメラを持ち上げる(上げは速く・戻しはゆっくり)。
   カメラ位置は2Dの project() と3Dの両方が読むので、ここで直せば両方そろう。 */
/* ボス戦の視点の補正(updateCamera から exploreCameraClearance の先頭で)。
   ・討伐の視点演出: ボスから少し離れた、間に障害物の無い所へカメラを置く(EXPLORE_BOSS_HUNT_CAM)
   ・ボスと戦っている間: ボスの頭が画面上部のHUDの下端+margin より上に出たら、見上げて引く */
function exploreBossCamera(v, dt){
  const c = exploreState.cine;
  if(c && c.kind === 'hunt'){
    const b = getEntity(c.bossId);
    if(b){
      const C = EXPLORE_BOSS_HUNT_CINE, K = EXPLORE_BOSS_HUNT_CAM;
      const t = exploreState.rawClock - c.t0, dur = Math.max(C.zoomSec, C.dimSec);
      const e = t < 0.35 ? sniperEaseLocal(t/0.35) : (t > dur - 0.3 ? sniperEaseLocal((dur - t)/0.3) : 1);
      if(!c.camAt){
        const D = b.radius*K.dist + K.extra, base = angTo(b, v);
        let pick = null;
        for(const off of K.tries){
          const a = base + off;
          if(raycastObstacleDistance(b.x, b.y, a, D) >= D - 5){ pick = a; break; }
        }
        if(pick == null) pick = base;
        c.camAt = { x: b.x + Math.cos(pick)*D, y: b.y + Math.sin(pick)*D };
      }
      const gx = c.camAt.x, gy = c.camAt.y;
      const gz = getTerrainHeightAt(gx, gy) + camState.height + b.radius*K.rise;
      camPos.x += (gx - camPos.x)*e; camPos.y += (gy - camPos.y)*e; camPos.z += (gz - camPos.z)*e;
      if(e > 0){
        const yawT = Math.atan2(b.y - camPos.y, b.x - camPos.x);
        const h = exploreBodyHeight(b), hd = Math.max(200, Math.hypot(b.x - camPos.x, b.y - camPos.y));
        camState.yaw = yawT;
        camState.pitch = -Math.atan2((b.z || 0) + h*0.45 - camPos.z, hd);
      }
      return;
    }
  }
  if((c && c.kind !== 'rage') || exploreState.engagedBossId == null || (typeof sniperView === 'object' && sniperView && sniperView.blend > 0.02)){
    exploreState.camBack = 0; return;
  }
  const b = getEntity(exploreState.engagedBossId);
  if(!b || !b.alive || b.exState === 'dying' || dist(b, v) > EXPLORE_BOSS_HP_BAR_RANGE){ exploreState.camBack = 0; return; }
  const F = EXPLORE_BOSS_FRAME;
  // 方位バーだけでなく、ボス自身の名前・HPバーの帯の下端も避ける
  // (方位バーの下端だけで測っていたため、その下にあるボスの帯に頭がなお食い込んでいた=批評指摘)
  const limit = (typeof exploreBossHudBottom === 'function' ? exploreBossHudBottom() : 60) + F.margin;
  // 今の引き(前のフレームの値)を掛けた位置で頭の高さを測る
  const back = exploreState.camBack || 0;
  camPos.x -= Math.cos(camState.yaw)*back; camPos.y -= Math.sin(camState.yaw)*back;
  const q = project(b.x, b.y, (b.z||0) + exploreBodyHeight(b));
  const k = clamp((dt || 1/60), 0, 0.1);
  if(q && q.y < limit){
    // 頭が上に出ている: 見上げる(pitch を下げる)+ 少し引く
    const over = (limit - q.y) / Math.max(1, viewH);
    camState.pitch = Math.max(camPitchMin(), camState.pitch - Math.min(F.pitchMax, over*2.2)*F.pitchRate*k);
    exploreState.camBack = Math.min(F.backMax, back + F.backMax*F.backRate*k);
  } else if(back > 0){
    exploreState.camBack = Math.max(0, back - F.backMax*0.5*k);
  }
}
function exploreCameraClearance(v, dt){
  exploreBossCamera(v, dt);
  let need = -Infinity;
  for(const t of EXPLORE_CAM_SAMPLES){
    const x = v.x + (camPos.x - v.x)*t, y = v.y + (camPos.y - v.y)*t;
    need = Math.max(need, getTerrainHeightAt(x, y) + EXPLORE_CAM_CLEARANCE);
  }
  const lift = Math.max(0, need - camPos.z);
  const cur = exploreState.camLift || 0;
  // 上げるときは足りない分をその場で満たす(補間の途中で埋まらない)。下げるときだけゆっくり戻す
  exploreState.camLift = lift > cur ? lift : cur + (lift - cur)*clamp((dt || 1/60)*EXPLORE_CAM_LIFT_DOWN, 0, 1);
  camPos.z += exploreState.camLift;
}
function sniperEaseLocal(t){ t = clamp(t, 0, 1); return t*t*(3 - 2*t); }
// 描画の直前(render.js。狙撃の構えの後)。寄りは setViewZoom の1か所の入口で、構え中は狙撃を優先する
function exploreCineFrame(){
  const c = exploreState.cine;
  if(!c) return;
  if(typeof sniperView === 'object' && sniperView && sniperView.blend > 0.02) return;
  const C = exploreCineParams(c);
  const t = exploreState.rawClock - c.t0;
  if(t < 0 || t > C.zoomSec) return;
  const e = t < 0.3 ? sniperEaseLocal(t/0.3) : (t > C.zoomSec - 0.4 ? sniperEaseLocal((C.zoomSec - t)/0.4) : 1);
  setViewZoom(1 + (C.zoom - 1)*e);
}
// 上下の黒帯
function exploreDrawCineBars(){
  const c = exploreState.cine;
  if(!c) return;
  const C = exploreCineParams(c);
  const t = exploreState.rawClock - c.t0, end = C.dimSec;
  const e = t < 0.2 ? t/0.2 : (t > end - 0.3 ? Math.max(0, (end - t)/0.3) : 1);
  if(e <= 0) return;
  const h = viewH*C.bar*e;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, viewW, h);
  ctx.fillRect(0, viewH - h, viewW, h);
  ctx.restore();
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
/* =====================================================================
   ボス戦のHUD(HPバー・名前の札・咆哮の文字・画面の札)の置き方
   ・横は上部中央の帯(方位バーと同じ幅。explore_hud.js の exploreHudBand)に合わせる。px の決め打ちで置かない
   ・縦が足りないときに削る順(R3): 称号の行を消し、名前とバーを1行にまとめ、バーを細くする
     (境目は data.js の EXPLORE_BOSS_HUD.fullMinH)。大きい札は画面の縦に合わせて縮める
   ・札・咆哮の文字は**ボスの画面上の矩形(exploreBossRect)の外へ逃がす**。縦持ちで本体を隠さないため
   ===================================================================== */
// 咆哮の文字。ボスの矩形の右(入らなければ左、それも無理なら足元の下)に出して震わせる
// 咆哮の文字の今の画面上の矩形(小さい札=怒り等がこの上に重なって隠さないよう exploreDrawSmallBanner が読む)
let _exploreRoarBoxes = [];
// 名前の札(plate)の今の画面上の矩形(咆哮の文字がこれに重ならないよう exploreDrawRoarText が読む)
let _explorePlateBoxes = [];
function exploreDrawRoarText(){
  _exploreRoarBoxes = [];
  // 狙撃スコープを覗いている間は出さない(倍率で大きくなった文字がスコープの表示に重なり、窓の縁で切れる。狙撃担当)
  if(typeof sniperHidesOverhead === 'function' && sniperHidesOverhead()) return;
  for(const rec of exploreState.bosses){
    const b = getEntity(rec.id);
    if(!b || !b.alive || b.exState !== 'roar') continue;
    const r = exploreBossRect(b);
    if(!r) continue;
    const age = matchTime - b.exRoarAt, dur = Math.max(0.1, b.exStateUntil - b.exRoarAt);
    const a = age < 0.12 ? age/0.12 : (age > dur - 0.35 ? Math.max(0, (dur - age)/0.35) : 1);
    const rage = b.exRoarKind === 'rage';
    const text = rage ? 'ガアァァッ!!' : 'グオオオオッ!!';
    const pop = age < 0.15 ? 1.4 - age/0.15*0.4 : 1;
    // 名前の札(plate)にも重ねない(重ねると札が後で覆って文字の下半分が暗く隠れて見えた=批評指摘)
    const blocks = exploreHudObstacles().concat(_explorePlateBoxes);
    const pr = explorePlayerRect();
    const A = EXPLORE_AIM_CLEAR;
    ctx.save();
    // 置き場所: ボスの右→左→照準の右→照準の左→ボスの下。入らなければ文字を小さくしてもう一度。
    // 照準の周り・自分・HUDには重ねない(重ねると狙えない=批評指摘)
    let tx = 0, yy = 0, sz = 0, found = false;
    // 縦持ちでHUDの帯が高いと topY が viewH*0.62 を超え、範囲が逆転してどの候補も入らなくなっていた
    // (咆哮の文字そのものが出ない=批評指摘)。topY 自体を画面の中ほどまでに必ず収める。
    let fallback = null;
    for(const shrink of [1, 0.8, 0.62, 0.48]){
      sz = clamp(viewH*0.085, 20, 60) * shrink;
      ctx.font = `italic bold ${Math.round(sz*pop)}px 'Russo One', sans-serif`;
      const tw = ctx.measureText(text).width / pop, th = sz*1.1;
      const topY = Math.min(exploreBossHudBottom() + th*0.6, viewH*0.5);
      const ty = clamp(r.y + r.h*0.3, topY, viewH*0.62);
      const fits = (cx, cy)=>{
        const box = { x:cx - tw/2, y:cy - th/2, w:tw, h:th };
        return box.x >= 6 && box.x + box.w <= viewW - 6 && box.y >= 4 && box.y + box.h <= viewH - 6
          && !exploreRectsHit(box, r, 4) && !blocks.some(o=> exploreRectsHit(box, o, 2))
          && !exploreHitsAimZone(box.x, box.y, box.w, box.h) && !(pr && exploreRectsHit(box, pr, 4));
      };
      const cands = [[r.x + r.w + 14 + tw/2, ty], [r.x - 14 - tw/2, ty],
                     [viewW/2 + A.w/2 + 10 + tw/2, ty], [viewW/2 - A.w/2 - 10 - tw/2, ty],
                     [viewW/2 + A.w/2 + 10 + tw/2, viewH/2 - A.h/2 - th*0.6], [viewW/2 - A.w/2 - 10 - tw/2, viewH/2 - A.h/2 - th*0.6],
                     [clamp(r.x + r.w/2, tw/2 + 6, viewW - tw/2 - 6), Math.min(viewH*0.7, r.y + r.h + th*0.7)]];
      if(!fallback) fallback = { tx:clamp(cands[6][0], tw/2 + 6, viewW - tw/2 - 6), yy:clamp(cands[6][1], th/2 + 4, viewH - th/2 - 6), sz };
      const c = cands.find(([x, y])=> fits(x, y));
      if(c){ [tx, yy] = c; found = true; break; }
    }
    // どこにも重ならない置き場が無い一瞬は、それでも「出ない」より「ボスの下へ重ねて出す」を選ぶ
    // (縦持ちでHUDが多く、丁度の空きが無いまま一撃分の咆哮が丸ごと消えていた=批評指摘)
    if(!found){ tx = fallback.tx; yy = fallback.yy; sz = fallback.sz; }
    ctx.font = `italic bold ${Math.round(sz*pop)}px 'Russo One', sans-serif`;
    {
      const tw2 = ctx.measureText(text).width, th2 = sz*1.1;
      _exploreRoarBoxes.push({ x:tx - tw2/2, y:yy - th2/2, w:tw2, h:th2 });
    }
    ctx.globalAlpha = a;
    ctx.translate(tx + rand(-4, 4), yy + rand(-4, 4));
    ctx.rotate(-0.08);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
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
/* ボスの帯(方位バーの真下の1行)の寸法と描き方は explore_hud.js(exploreHudBossGeom / exploreHudBossBand)。
   #hud の中のキャンバスへ描くので、流星などワールドの演出より必ず手前に出る(第2周の指摘3)。 */
function exploreBossHudGeom(b){ return exploreHudBossGeom(b); }
// 札・文字を置くときの上端(ボスの帯が出ていればその下、無ければ方位バーの下)
function exploreBossHudBottom(){
  const b = exploreFocusBoss();
  return b ? Math.max(exploreHudBossGeom(b).bottom, exploreHudBand().bottom) : exploreHudBand().bottom;
}
function exploreDrawBossHud(){ exploreHudBossBand(); }
// 画面の札(名前の札・怒り・部位破壊・逃走・討伐完了)
function exploreDrawBanners(){
  _explorePlateBoxes = [];
  const list = exploreState.banners;
  // 討伐完了はスローモーション中も普段の速さで動く(実時間に近い rawClock で測る)
  const ageOf = (bn)=> bn.kind === 'hunt' ? exploreState.rawClock - bn.raw0 : matchTime - bn.t0;
  for(let i=list.length-1; i>=0; i--) if(ageOf(list[i]) > list[i].dur) list.splice(i, 1);
  for(const bn of list){
    const age = ageOf(bn);
    const a = age < 0.2 ? age/0.2 : (age > bn.dur - 0.45 ? Math.max(0, (bn.dur - age)/0.45) : 1);
    if(bn.kind === 'plate' || bn.kind === 'hunt') exploreDrawBigBanner(bn, age, a);
    else exploreDrawSmallBanner(bn, age, a);
  }
}
// 札のボス(名前の札・討伐完了はその札のボス、小さい札は戦っているボス)の画面上の矩形
function exploreBannerBossRect(bn){
  const b = (bn && bn.bossId != null) ? getEntity(bn.bossId) : null;
  return exploreBossRect(b || exploreFocusBoss() || exploreLastFelledBoss());
}
// 討伐の札のとき、倒れているボス(dying)
function exploreLastFelledBoss(){
  for(const rec of exploreState.bosses){ const b = getEntity(rec.id); if(b && b.alive && b.exState === 'dying') return b; }
  return null;
}
// 候補の中心 y から、ボスの矩形・HUDの欄に重ならない最初のものを選ぶ。どれも重なるなら先頭
/* 候補の中心 y から、ボスの矩形・HUDの欄(自分の欄・ミニマップ・目標パネル・下の操作系)に重ならない最初のものを選ぶ。
   候補が全部だめなら、方位バーの下から画面の下まで 6px ずつ探す → それでも無ければボスとの重なりだけは許す → 先頭 */
function exploreBannerPick(cands, bw, bh, cx, r){
  const blocks = exploreHudObstacles();
  const top = exploreHudBand().bottom + 4;
  const ok = (cy, withBoss)=>{
    const box = { x:cx - bw/2, y:cy - bh/2, w:bw, h:bh };
    if(box.y < top || box.y + box.h > viewH) return false;
    if(withBoss && r && exploreRectsHit(box, r, 6)) return false;
    return !blocks.some(o=> exploreRectsHit(box, o, 2));
  };
  for(const cy of cands) if(ok(cy, true)) return cy;
  for(let cy = top + bh/2; cy + bh/2 <= viewH; cy += 6) if(ok(cy, true)) return cy;
  for(const cy of cands) if(ok(cy, false)) return cy;
  for(let cy = top + bh/2; cy + bh/2 <= viewH; cy += 6) if(ok(cy, false)) return cy;
  return cands[0];
}
/* 大きい札。画面の縦に合わせて縮める(R3: 札を小さく)。ボスの矩形に重なるなら置き場を変える
   ・名前の札(plate): 画面の左寄り・縦の中ほど(MHの登場ムービーの名前と同じ置き方)
   ・討伐完了(hunt): 画面の上寄りの中央(ボス本体の上で弾ける光を避ける) */
function exploreDrawBigBanner(bn, age, a){
  const hunt = bn.kind === 'hunt';
  const slide = age < 0.3 ? (1 - age/0.3) : 0;
  const k = clamp(viewH/560, 0.66, 1);
  const r = exploreBannerBossRect(bn);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textBaseline = 'middle';
  if(hunt){
    const items = (bn.items || []).slice(0, 8);
    // 細い帯。視点演出の黒帯のすぐ下(崩れ落ちたボスを画面の中央に残す)
    const bandH = 54, extra = items.length ? 32 : 0, totalH = bandH + extra;
    const topLimit = viewH*EXPLORE_BOSS_HUNT_CINE.bar + 14;
    let cy = Math.max(96, viewH*EXPLORE_BOSS_HUNT_CINE.bar + 38);
    /* ボスにかからない位置へ(縦持ちで帯がボスを丸ごと隠していた=批評指摘): ボスの矩形の上に
       空きがあればそこへ、無ければボスの下へ。どちらも入らなければ元の位置のまま(重なりは許容)。 */
    if(r){
      if(r.y - topLimit >= totalH/2 + 6) cy = topLimit + totalH/2;
      else if(viewH - (r.y + r.h) >= totalH/2 + 16) cy = r.y + r.h + totalH/2 + 12;
    }
    const g = ctx.createLinearGradient(0, 0, viewW, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.22, 'rgba(10,8,4,0.74)');
    g.addColorStop(0.78, 'rgba(10,8,4,0.74)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, cy - bandH/2, viewW, bandH + extra);
    const lg = ctx.createLinearGradient(0, 0, viewW, 0);
    lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(0.5, '#ffd35a'); lg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, cy - bandH/2, viewW, 2);
    ctx.fillRect(0, cy + bandH/2 - 2 + extra, viewW, 2);
    ctx.textAlign = 'center';
    const pop = age < 0.18 ? 1.35 - age/0.18*0.35 : 1;
    ctx.save();
    ctx.translate(viewW/2, cy - 6);
    ctx.scale(pop, pop);
    ctx.font = "bold 32px 'Russo One', sans-serif";
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(40,20,0,0.92)';
    ctx.strokeText('討伐完了', 0, 0);
    const tg = ctx.createLinearGradient(0, -18, 0, 14);
    tg.addColorStop(0, '#fff6c8'); tg.addColorStop(0.5, '#ffd35a'); tg.addColorStop(1, '#d88a1a');
    ctx.fillStyle = tg;
    if(!renderHeavyLoad){ ctx.shadowBlur = 20; ctx.shadowColor = 'rgba(255,190,60,0.85)'; }
    ctx.fillText('討伐完了', 0, 0);
    ctx.restore();
    ctx.font = "bold 13px 'Rajdhani', sans-serif";
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    const sub = `${bn.apex ? '頂点の主 ' : ''}${bn.name} を討伐した`;
    ctx.strokeText(sub, viewW/2, cy + 17);
    ctx.fillStyle = 'rgba(248,242,226,0.96)';
    ctx.fillText(sub, viewW/2, cy + 17);
    // 獲得: 素材のアイコン×数(レア度の色)。1つずつ順に出る
    if(items.length) exploreDrawGainRow(items, viewW/2, cy + 44, age);
  } else {
    const bandH = 98*k;
    const bandW = Math.min(viewW*0.62, 620*k);
    const x0 = Math.max(18, viewW*0.05) - slide*80;
    // 左の自分の欄・左下のスティックの間。ボスに重なるならボスの下、それも無理なら上寄り
    const cy = exploreBannerPick([viewH*0.54, r ? r.y + r.h + bandH/2 + 6 : viewH*0.54, viewH*0.42], bandW, bandH, bandW/2, r);
    // 咆哮の文字がこの札に重ならないよう覚えておく(exploreDrawRoarText が読む。批評指摘)
    _explorePlateBoxes.push({ x:0, y:cy - bandH/2, w:bandW, h:bandH });
    const g = ctx.createLinearGradient(0, 0, bandW, 0);
    g.addColorStop(0, 'rgba(6,6,10,0.80)'); g.addColorStop(0.6, 'rgba(6,6,10,0.55)'); g.addColorStop(1, 'rgba(6,6,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, cy - bandH/2, bandW, bandH);
    const col = bn.color || '#ffd35a';
    ctx.fillStyle = col;
    ctx.fillRect(x0 - 10, cy - bandH/2 + 14*k, 4, bandH - 28*k);   // 左の縦線(ボスの色)
    ctx.textAlign = 'left';
    ctx.font = `bold ${Math.round(14*k)}px 'Rajdhani', sans-serif`;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(bn.title, x0, cy - 30*k);
    ctx.fillStyle = col;
    ctx.fillText(bn.title, x0, cy - 30*k);
    ctx.font = `bold ${Math.round(42*k)}px 'Russo One', sans-serif`;
    ctx.lineWidth = 6*k; ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.strokeText(bn.name, x0, cy + 4*k);
    ctx.fillStyle = '#ffffff';
    if(!renderHeavyLoad){ ctx.shadowBlur = 16; ctx.shadowColor = col; }
    ctx.fillText(bn.name, x0, cy + 4*k);
    ctx.shadowBlur = 0;
    ctx.font = `bold ${Math.round(13*k)}px 'Rajdhani', sans-serif`;
    const tag = bn.apex ? '頂点ボス 出現' : '大型モンスター 出現';
    ctx.strokeText(tag, x0, cy + 36*k);
    ctx.fillStyle = bn.apex ? '#ffd35a' : 'rgba(235,230,215,0.92)';
    ctx.fillText(tag, x0, cy + 36*k);
  }
  ctx.restore();
}
// 討伐完了の札の下の「獲得」の行。レア度の色の枠に素材のアイコンと数
function exploreDrawGainRow(items, cx, y, age){
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.font = "bold 13px 'Rajdhani', sans-serif";
  const label = '獲得';
  const lw = ctx.measureText(label).width + 10;
  const cell = 58, gap = 6;
  const total = lw + items.length*(cell + gap);
  let x = cx - total/2;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,232,170,0.95)';
  ctx.fillText(label, x, y);
  x += lw;
  items.forEach((it, i)=>{
    const m = EXPLORE_MATERIALS[it.key];
    if(!m) return;
    const t = age - 0.25 - i*0.09;          // 1つずつはじけるように出る
    if(t < 0) return;
    const pop = t < 0.14 ? 1.3 - t/0.14*0.3 : 1;
    const col = exploreMaterialColor(it.key);
    ctx.save();
    ctx.translate(x + cell/2, y);
    ctx.scale(pop, pop);
    exploreRoundRect(-cell/2, -14, cell, 28, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
    if(!renderHeavyLoad && m.rarity !== 'common'){ ctx.shadowBlur = 10; ctx.shadowColor = col; ctx.stroke(); ctx.shadowBlur = 0; }
    ctx.textAlign = 'center';
    ctx.font = "17px sans-serif";
    ctx.fillText(m.icon, -11, 1);
    ctx.font = "bold 13px 'Rajdhani', sans-serif";
    ctx.fillStyle = col;
    ctx.fillText('×' + it.n, 14, 1);
    ctx.restore();
    x += cell + gap;
  });
  ctx.restore();
}
/* 小さい札(怒り・部位破壊・逃走)。ボスのHUDの下の中央 → ボスに重なるなら帯の中で左右へずらす →
   それも無理ならボスの足元の下。縦が低い画面では一回り小さくする */
function exploreDrawSmallBanner(bn, age, a){
  const k = clamp(viewH/560, 0.8, 1);
  ctx.save();
  ctx.font = `bold ${Math.round(15*k)}px 'Russo One', sans-serif`;
  const tw = ctx.measureText(bn.text).width + 28*k, th = 26*k;
  const r = exploreBannerBossRect(bn);
  const band = exploreHudBand();
  const y0 = exploreBossHudBottom() + th/2 + 6;
  // 咆哮の文字(exploreDrawRoarText。この帯より先に描く)にも重ねない。
  // 重ねて隠すと「怒り状態になった」の帯の真後ろに叫びの文字が隠れて読めなくなる(批評指摘)
  const blocks = exploreHudObstacles().concat(_exploreRoarBoxes);
  const ok = (cx, cy)=>{
    const box = { x:cx - tw/2, y:cy - th/2, w:tw, h:th };
    return box.x >= 4 && box.x + box.w <= viewW - 4 && !(r && exploreRectsHit(box, r, 6)) && !blocks.some(o=> exploreRectsHit(box, o, 2));
  };
  let cx = viewW/2, cy = y0;
  if(!ok(cx, cy) && r){
    const left = r.x - 10 - tw/2, right = r.x + r.w + 10 + tw/2;
    if(ok(left, cy) && left - tw/2 >= band.x - 4) cx = left;
    else if(ok(right, cy) && right + tw/2 <= band.x + band.w + 4) cx = right;
    else if(ok(viewW/2, r.y + r.h + th/2 + 8)) cy = r.y + r.h + th/2 + 8;
    else if(ok(viewW/2, y0 + th + 10)) cy = y0 + th + 10;   // なお重なるなら、もう1段下へ(咆哮の文字の下)
  }
  ctx.globalAlpha = a;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const pop = age < 0.15 ? 1.2 - age/0.15*0.2 : 1;
  ctx.translate(cx, cy);
  ctx.scale(pop, pop);
  exploreRoundRect(-tw/2, -th/2, tw, th, 7*k);
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
  /* 見せ場(モンハンの猫車): 「力尽きた n/3」の札 → 暗転 → キャンプで明転。
     札の間はその場で倒れたまま動けず(exploreAsleep)、暗転しきった瞬間に exploreFaintRespawn がキャンプへ運ぶ。
     札と暗転は explore_loot.js(exploreFaintStart / exploreCineDraw) */
  p.hp = 1;
  p.exploreAsleep = true;
  p.exploreInvulnUntil = matchTime + EXPLORE_FAINT_SEQ.fall + EXPLORE_FAINT_SEQ.card + EXPLORE_FAINT_SEQ.fadeOut + EXPLORE_FAINT_SEQ.black + EXPLORE_RESPAWN_INVULN_SEC;
  exploreFaintStart();
  playSe('sad');
}
// 暗転しきったところでキャンプへ運ぶ(explore_loot.js の力尽きの演出から呼ぶ)
function exploreFaintRespawn(p){
  if(!p || game.over) return;
  const sp = exploreState.spawn;
  p.exploreAsleep = false;
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
  // 帰還ビーコンの方を向いて起き上がる(キャンプに戻ったことが一目で分かる)
  camState.yaw = angTo(sp, exploreState.beacon); p.facingAngle = camState.yaw;
  updateCamera();
  pushToast(`💫 ベースキャンプへ運ばれた（あと${EXPLORE_MAX_FAINTS - exploreState.faints}回で探検終了）`);
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
    /* 予告の見え方:
       ・暗い太い外縁+明るい内線の2重線(outline / solid)。どんな地面の上でも縁が読める
       ・地面との明るさの差が足りなければ白(暗い地面)か赤(明るい地面)へ寄せる(exploreTelegraphColor)
       ・塗りは中心から縁へ満ちる(progress = 予告の進み)。満ちきった瞬間に当たる */
    // 突進の帯は色を明るい方へ寄せない(白・桃色に見えて危険に見えなかった=批評指摘)
    const col = pend.mv.pattern === 'arrows' ? (pend.color || '#c8101c') : exploreTelegraphColor(pend.color || '#ff5d5d', bo.exploreRegion);
    // 流星群・岩石落としは「次に落ちる1つ」だけ明るく縁取り、他は輪郭無しの薄い塗りだけ
    let next = null;
    if(pend.mv.shape === 'meteor') for(const m of pend.marks) if(!m.fired && (!next || m.fireAt < next.fireAt)) next = m;
    for(const m of pend.marks){
      if(m.fired) continue;
      if(next && m !== next){
        const t0 = pend.startAt, prog = clamp((matchTime - t0) / Math.max(0.05, m.fireAt - t0), 0, 1);
        out.push({ x:m.x, y:m.y, r:m.r, color:col, alpha:0.5, fillAlpha:0.2, noRing:true, progress:prog, arc:null, inner:false, nearFade:EXPLORE_TELEGRAPH_NEAR });
        continue;
      }
      const t0 = m.startAt != null ? m.startAt : pend.startAt;
      const prog = clamp((matchTime - t0) / Math.max(0.05, m.fireAt - t0), 0, 1);
      const soon = prog > 0.8;
      const blink = soon ? 0.75 + 0.25*Math.abs(Math.sin(matchTime*18)) : 1;
      const half = (m.fanDeg != null) ? (m.fanDeg*Math.PI/180)/2 : 0;
      // 次に落ちる流星: 残り時間を示す、縁から中心へ縮む内側の輪
      if(next && m === next) out.push({ x:m.x, y:m.y, r:Math.max(12, m.r*(1 - prog)), color:'#ffffff', alpha:0.95, fillAlpha:0,
                                        solid:true, arc:null, inner:false });
      out.push({ x:m.x, y:m.y, r:m.r, color:col, alpha:blink, fillAlpha: pend.mv.pattern === 'arrows' ? 0.75 : 0.45, nearFade: pend.mv.pattern === 'arrows' ? EXPLORE_TELEGRAPH_NEAR_BAND : EXPLORE_TELEGRAPH_NEAR,
                 outline:EXPLORE_TELEGRAPH.outline, solid:true, progress: pend.mv.pattern === 'arrows' ? null : prog, rect:m.rect || null,
                 arrows: pend.mv.pattern === 'arrows',
                 arc: (m.fanDeg != null) ? { from:m.angle-half, to:m.angle+half } : null,
                 inner:false });
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

/* HUD(方位バー・目標パネル・地域の札)は explore_hud.js の exploreUpdateHud が持つ(updateExplore から毎フレーム)。 */

// 毎フレームの進行(combat.js の update() から。安置の update の代わり)
function updateExplore(dt){
  if(!game.explore || game.over) return;
  exploreState.rawClock += dt / (exploreState.timeScaleNow || 1);
  exploreUpdateWild(dt);
  exploreUpdateBosses(dt);
  exploreUpdateCine();
  exploreUpdateFx(dt);
  exploreUpdateShards(dt);
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
      // 力尽き/時間切れは半分。ただし種類ごとに最低 EXPLORE_FAIL_KEEP_MIN 個は残す(1個しか無い素材を0にしない)
      const kept = full ? got : Math.min(got, Math.max(EXPLORE_FAIL_KEEP_MIN, Math.floor(got*ratio)));
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
    // 記録(報酬画面の左): 狩ったボス・部位破壊・開けた箱・いちばん良かったレア度
    bosses: exploreState.bosses.filter(r=> r.defeated).map(r=> r.bossId),
    breaks: exploreState.bosses.filter(r=> r.broken).length,
    crates: exploreState.crates.filter(c=> c.opened).length,
    best: exploreBestRarity(items),
    element: player ? player.element : game.selectedElement,
    name: player ? player.name : '',
    gear: (player && player.exploreGear) ? { ...player.exploreGear.equip } : {},   // 着て出た装備(報酬画面でモンスターの横に並べる)
  };
  const ehud = document.getElementById('exploreHud');
  if(ehud) ehud.classList.add('hidden');
  exploreHudHide();
  if(typeof exploreSaveLast==='function') exploreSaveLast(exploreState.finished);
  /* 帰還成功は探検の曲のファンファーレ(audio.js の bgmExploreFanfare。地域の曲の上で鳴り、終わると静まる)。
     専用の勝利SEを持つスキンはそのSE。失敗は曲を止めて 'sad' */
  const skinWin = full && typeof skinWinSeName==='function' ? skinWinSeName(player) : null;
  if(full && !skinWin && typeof bgmExploreFanfare==='function' && bgmState.current==='explore') bgmExploreFanfare(true);
  else { bgmSetTrack(null); playSe(full ? (skinWin || 'fanfare') : 'sad'); }
  setTimeout(()=>{
    if(game.started) return;
    if(typeof bgmDesiredTrack==='function' && bgmDesiredTrack()!==null) return;
    bgmSetTrack('title');
  }, full ? 4800 : 3000);   // 帰還はファンファーレ(約4.5秒)を鳴らし切ってからタイトルの曲へ
  /* すぐ報酬画面にせず、フィールドで「帰還成功」などの札を EXPLORE_OUTRO_SEC だけ見せる(explore_loot.js)。
     その間は描画だけ続ける(game.started を立てたまま・game.over で進行は止まっている) */
  game.started = true;
  exploreOutroStart(reason, ()=>{
    game.started = false;
    if(typeof exploreShowResult==='function') exploreShowResult(exploreState.finished);
  });
}
