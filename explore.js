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
                    applyDamage()       … exploreDamageBlocked(復活直後の無敵・野生どうしの同士討ち無し)
                    updateBotAI()       … 野生(isExploreWild)は exploreWildAI
                    updateKillLeader()  … キルリーダーは出さない
         render.js  real3dの地面円       … exploreGroundMarks(帰還ビーコンの輪)
         ui.js      ロビーの入口 / 途中で抜ける / 結果画面(exploreShowResult / exploreExit)
     ・game.explore は world.js の game に初期値を置いていない(undefined=偽)。書くのは
       exploreResetState() と exploreStart() だけ

   【後続の担当が使う口】(段2: 野生AI・ボス・補給箱・HUD)
     exploreState.wild    … [{ id, region, element, homeX, homeY, respawnAt, dropped }] 野生の台帳
     exploreState.bosses  … [] ボスの台帳(段2が作る)
     exploreState.crates  … [] 補給箱の台帳(段2が作る)
     exploreState.bag     … { 素材キー: 個数 } 今回拾った素材(持ち帰る前)
     exploreState.camp / spawn / beacon … ベースキャンプの中心・出発(復活)地点・帰還ビーコン
     exploreGainMaterial(key, n, x, y) … 素材を拾う入口(通知まで出す)。ボス・補給箱もここを呼ぶ
     exploreSpawnWild()   … 野生の仮配置(段2で置き換える前提で関数を分けてある)
     exploreWildAI(b)     … 野生の仮AI(同上)
     updateExplore(dt)    … 毎フレーム(combat.js の update() から)。段2の処理はここへぶら下げる
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
    faints:0, kills:0,
    bag:{},
    wild:[], bosses:[], crates:[],
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
  const hudEl = document.getElementById('exploreHud');
  if(hudEl) hudEl.classList.add('hidden');
  const el = document.getElementById('hud');
  if(el) el.classList.remove('explore-mode');
  const ov = document.getElementById('exploreResultOverlay');
  if(ov) ov.classList.add('hidden');
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
  // 探検は狩りのモード。最初から全部の技を使える(レイドと同じ扱い)
  player.moveTierUnlocked = 3;
  player.moveTierSelected = 1;
  entities.push(player);

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

/* 回復・ガッツを撒く(仮。段2の補給箱が入るまでの繋ぎ)。通常の試合と同じ spawnLoot を使う */
function exploreSpawnLoot(){
  const c = exploreState.camp;
  spawnLoot(EXPLORE_CAMP_LOOT_COUNT, { x:c.x, y:c.y }, c.r*1.6);
  for(const reg of EXPLORE_REGIONS){
    const rc = exploreRegionCircle(reg);
    spawnLoot(EXPLORE_REGION_LOOT_COUNT, { x:rc.x, y:rc.y }, rc.r*0.9);
  }
}

/* ===== 野生モンスター(仮) =====
   段2(野生AIとボス)で置き換わる前提。置き場所・作り方・AI・落とし物を関数ごとに分けてある。 */
// 縄張りの中心を1つ選ぶ(地域の円の中・キャンプの外・障害物の外)
function explorePickWildHome(rc){
  const camp = exploreState.camp;
  let p = null;
  for(let guard=0; guard<24; guard++){
    const a = rand(0, Math.PI*2), d = rc.r*0.8*Math.sqrt(rand(0,1));
    const x = clamp(rc.x + Math.cos(a)*d, 200, WORLD.w-200), y = clamp(rc.y + Math.sin(a)*d, 200, WORLD.h-200);
    if(camp && Math.hypot(x-camp.x, y-camp.y) < camp.r + 400) continue;
    if(typeof isOnHazard==='function' && isOnHazard(x, y, 60)) continue;
    p = { x, y }; break;
  }
  if(!p) p = { x:rc.x, y:rc.y };
  return clearObstaclePoint(p.x, p.y, 60);
}
function exploreMakeWild(elKey, reg, home){
  const el = ELEMENTS[elKey];
  const e = createMonster(elKey, false, `野生の${el ? el.label : elKey}`, { spawnPoint:home });
  e.isExploreWild = true;
  e.exploreRegion = reg.id;
  e.homeX = home.x; e.homeY = home.y;
  // 危険度★で強さを上げる(体力と使える技の段)
  const hpMult = 1 + (reg.danger-1)*EXPLORE_WILD_HP_PER_DANGER;
  e.maxHp = Math.round(e.maxHp*hpMult); e.hp = e.maxHp;
  e.moveTierUnlocked = Math.min(3, Math.max(1, reg.danger-1));
  e.facingAngle = rand(0, Math.PI*2);
  return e;
}
function exploreSpawnWild(){
  for(const reg of EXPLORE_REGIONS){
    const rc = exploreRegionCircle(reg);
    for(let i=0;i<EXPLORE_WILD_PER_REGION;i++){
      const elKey = reg.wild[i % reg.wild.length];
      if(!ELEMENTS[elKey]) continue;
      const home = explorePickWildHome(rc);
      const e = exploreMakeWild(elKey, reg, home);
      entities.push(e);
      exploreState.wild.push({ id:e.id, region:reg.id, element:elKey, homeX:home.x, homeY:home.y, respawnAt:0, dropped:false });
    }
  }
}
/* 野生の仮AI(combat.js の updateBotAI が isExploreWild のときだけ呼ぶ)。
   うろつく → 近づくと気づいて襲う → 縄張りから離れすぎたら戻る。
   動き・攻撃は通常のbotと同じ仕組み(attackTargetId / aiTargetPoint)に乗せるだけ。 */
function exploreWildAI(b){
  const home = { x:b.homeX, y:b.homeY };
  const dHome = dist(b, home);
  // 縄張りから出すぎた: 追うのをやめて戻る(戻りきるまで振り向かない)
  if(dHome > EXPLORE_WILD_LEASH || (b.exploreReturning && dHome > EXPLORE_WILD_WANDER)){
    b.exploreReturning = true;
    b.attackTargetId = null; b.destination = null;
    if(!b.aiTargetPoint || dist(b.aiTargetPoint, home) > 80) b.aiTargetPoint = { x:home.x+rand(-60,60), y:home.y+rand(-60,60) };
    b.aiState = 'RETURN';
    return;
  }
  b.exploreReturning = false;
  const p = player;
  const pOk = p && p.alive && !(p.exploreInvulnUntil > matchTime);
  if(pOk){
    const chasing = b.attackTargetId === p.id;
    const range = chasing ? EXPLORE_WILD_CHASE_RANGE : EXPLORE_WILD_AGGRO_RANGE;
    if(dist(b, p) < range){
      if(!chasing) b.exploreNoticedAt = matchTime;   // 気づいた瞬間(頭上の「!」は段2がこれを読む)
      b.attackTargetId = p.id; b.destination = null;
      b.aiState = 'FIGHT';
      return;
    }
  }
  b.attackTargetId = null;
  if(!b.aiTargetPoint || dist(b, b.aiTargetPoint) < 40 || dist(b.aiTargetPoint, home) > EXPLORE_WILD_WANDER){
    const a = rand(0, Math.PI*2), r = rand(80, EXPLORE_WILD_WANDER);
    b.aiTargetPoint = { x: clamp(home.x+Math.cos(a)*r, 60, WORLD.w-60), y: clamp(home.y+Math.sin(a)*r, 60, WORLD.h-60) };
  }
  b.aiState = 'WANDER';
}
// 倒された野生の後始末(落とし物)と湧き直し
function exploreUpdateWild(dt){
  for(const w of exploreState.wild){
    const e = getEntity(w.id);
    if(!e) continue;
    if(e.alive){
      // 技を撃てずに棒立ちにならないよう、野生だけガッツを多めに戻す
      if(e.guts < e.maxGuts) e.guts = Math.min(e.maxGuts, e.guts + EXPLORE_WILD_GUTS_REGEN*dt);
      continue;
    }
    if(!w.dropped){
      w.dropped = true;
      w.respawnAt = matchTime + EXPLORE_WILD_RESPAWN_SEC;
      // 倒したのが自分なら素材を落とす(仮。段2で落とし物の演出と表に置き換わる)
      if(player && e.lastAttackerId === player.id){
        exploreState.kills++;
        const key = exploreRollWildDrop(w.region);
        if(key) exploreGainMaterial(key, 1, e.x, e.y);
      }
      continue;
    }
    if(matchTime < w.respawnAt) continue;
    // 目の前で湧かせない
    if(player && Math.hypot(player.x-w.homeX, player.y-w.homeY) < EXPLORE_WILD_RESPAWN_HIDE) continue;
    e.alive = true;
    e.hp = e.maxHp; e.guts = e.maxGuts;
    e.x = w.homeX; e.y = w.homeY; e.z = baseTerrainHeightAt(e.x, e.y);
    e.hitFlash = 0; e.aiTargetPoint = null; e.attackTargetId = null; e.destination = null;
    e.burnUntil = e.slowUntil = e.freezeUntil = e.poisonUntil = 0; e.pulledUntil = 0;
    e.lastAttackerId = null; e.recentAttackers = {};
    e.exploreReturning = false;
    w.dropped = false;
  }
}

/* ダメージを通さない場面(combat.js の applyDamage から。弾・範囲技・爆風すべてに効く)
   ・復活直後の無敵(EXPLORE_RESPAWN_INVULN_SEC)
   ・野生どうしの同士討ち(流れ弾で野生が減って素材が消えるのを防ぐ) */
function exploreDamageBlocked(target, source){
  if(!game.explore) return false;
  if(target.isPlayer && target.exploreInvulnUntil > matchTime) return true;
  if(source && source !== target && !source.isPlayer && !target.isPlayer) return true;
  return false;
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
  // 追っていた野生は見失う(キャンプまで追いかけてこない)
  for(const e of entities){ if(e.isExploreWild && e.attackTargetId === p.id){ e.attackTargetId = null; e.aiTargetPoint = null; } }
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
  const rar = EXPLORE_RARITY[m.rarity];
  pushToast(`${m.icon} ${m.name} ×${cnt} を手に入れた（${rar ? rar.label : ''}）`);
  playSe('pickup');
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
// ビーコンの輪(real3d の地面円。render.js がレイドの予告円と同じ口で渡す)
function exploreGroundMarks(){
  if(!game.explore || !exploreState.beacon) return null;
  const b = exploreState.beacon;
  const prog = Math.min(1, exploreState.beaconHold / EXPLORE_BEACON_HOLD_SEC);
  const pulse = 0.55 + 0.35*Math.abs(Math.sin(matchTime*2.4));
  const col = '#7dffb0';
  const out = [{ x:b.x, y:b.y, r:b.r, color:col, alpha:pulse, fillAlpha:0.10 + prog*0.45, inner:true }];
  if(prog > 0) out.push({ x:b.x, y:b.y, r:Math.max(8, b.r*prog), color:col, alpha:0.9, fillAlpha:0.25, inner:false });
  return out;
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
