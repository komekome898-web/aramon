/* バトルアリーナ(1チームvs1チーム・3v3=6体・1本勝負)の自動検証。
   ヘッドレスChromiumでゲーム本体(index.html)をそのまま読み込み、ソロ経路
   (startGame({arena:true}))で試合を組み立てて確認する(team_test.mjsと同じ配信サーバ+起動)。
   ゲームの遊び心地の確認ではない(それは発注者がiPhone実機で行う)。

   使い方: node tools/arena_test.mjs
   確認内容:
     1. アリーナ開始: 6体・2チーム・対面配置(チーム重心距離の実測)・
        安置が中央固定の小円(半径ARENA_ZONE_RADIUS)・アイテム少数が安置内
     2. シード付きスポーン(seededPickArenaSpawnPointsBatch)の決定性
     3. 安置: 待機→1段階の縮小→決着圏(ARENA_ZONE_END_RADIUS)で安定・圏外DPSが高め
     4. 決着: 敵チーム全滅→勝利(placement1) / 自チーム全滅→敗北(placement2)
     5. 時間切れ(ARENA_TIME_LIMIT): 生存数が多い側の勝ち・同数ならHP合計
     6. 回帰: 個人戦30体・チーム戦(3x4)でアリーナの状態が漏れていないこと */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let chromium = null;
try { ({ chromium } = await import('playwright')); }
catch {
  for(const base of ['/opt/node22/lib/node_modules/', '/usr/lib/node_modules/', '/usr/local/lib/node_modules/']){
    try { ({ chromium } = createRequire(base)('playwright')); break; } catch {}
  }
}
if(!chromium){ console.error('playwrightが見つかりません(npm i -g playwright)。'); process.exit(1); }

const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
               '.webp':'image/webp', '.mp3':'audio/mpeg', '.mp4':'video/mp4', '.webm':'video/webm' };
const server = http.createServer((req, res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if(rel === 'sw.js'){ res.writeHead(404); res.end('no sw in test'); return; }
  const file = path.resolve(ROOT, rel);
  if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r=> server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const jsErrors = [];
const page = await browser.newPage({ viewport:{ width:1200, height:560 } });
page.on('pageerror', e=> jsErrors.push(String(e)));

await page.goto(`${ORIGIN}/index.html`, { waitUntil:'load' });
await page.waitForFunction(()=> typeof startGame==='function' && typeof update==='function'
  && typeof arenaResetState==='function' && typeof killEntity==='function', null, { timeout:30000 });

const results = {};

/* リザルト画面へ進まないようにスタブへ差し替え、呼ばれた内容だけ記録する(team_test.mjsと同じ) */
await page.evaluate(()=>{
  window.__resultLog = [];
  window.showResult = (isWin, placement)=>{ window.__resultLog.push({ isWin:!!isWin, placement }); game.over = true; game.started = false; };
  window.__setupArena = ()=>{
    game.selectedElement = 'fire';
    game.selectedMap = 'wild';
    game.realMapMode = false;
    game.selectedMastermonKey = null;
    window.__resultLog = [];
    startGame({ arena:true });
    introState.active = false;   // 召喚演出は飛ばして即プレイ状態にする
  };
});

/* ===== 1. アリーナ開始: 6体・2チーム・対面配置・中央小円の安置・少数アイテム ===== */
results.arenaStart = await page.evaluate(()=>{
  window.__setupArena();
  const byTeam = new Map();
  for(const e of entities){
    if(!byTeam.has(e.teamId)) byTeam.set(e.teamId, []);
    byTeam.get(e.teamId).push(e);
  }
  // チーム重心どうしの距離(対面配置の実測。ARENA_SPAWN_GAP=600の想定)
  const centroids = [];
  for(const [,ms] of byTeam){
    centroids.push({ x: ms.reduce((s,m)=>s+m.x,0)/ms.length, y: ms.reduce((s,m)=>s+m.y,0)/ms.length });
  }
  const gap = centroids.length===2 ? Math.round(Math.hypot(centroids[0].x-centroids[1].x, centroids[0].y-centroids[1].y)) : null;
  // 同チーム内の最遠ペア(隣接スポーンの実測)
  const spread = [];
  for(const [,ms] of byTeam){
    let maxD=0;
    for(let i=0;i<ms.length;i++) for(let j=i+1;j<ms.length;j++) maxD=Math.max(maxD, dist(ms[i],ms[j]));
    spread.push(Math.round(maxD));
  }
  return {
    arenaFlag: game.arena, teamSize: game.teamSize,
    entityCount: entities.length, teamCount: byTeam.size,
    teamSizes: [...byTeam.values()].map(ms=>ms.length),
    playerTeam: player.teamId,
    centroidGap: gap,                                     // ≒ARENA_SPAWN_GAP
    intraTeamSpawnMaxDist: spread,
    zoneCentered: zoneState.center.x===ZONE_CENTER0.x && zoneState.center.y===ZONE_CENTER0.y,
    zoneRadius: zoneState.radius,                         // =ARENA_ZONE_RADIUS
    zoneToRadius: zoneState.toRadius,                     // =ARENA_ZONE_END_RADIUS(安置予測の点線)
    zoneHasNext: zoneState.hasNext,
    lootCount: lootItems.length,                          // =ARENA_LOOT_COUNT
    lootAllInZone: lootItems.every(it=> dist(it, zoneState.center) <= zoneState.radius),
    allSpawnedInZone: entities.every(e=> dist(e, zoneState.center) <= zoneState.radius),
    zoneDps: currentDps(),                                // =ARENA_ZONE_DPS(通常の序盤0より高い)
  };
});

/* ===== 2. シード付きスポーンの決定性(ソロ用と対の関数) ===== */
results.determinism = await page.evaluate(()=>{
  const a = seededPickArenaSpawnPointsBatch(makeSeededRng(20260814), 3);
  const b = seededPickArenaSpawnPointsBatch(makeSeededRng(20260814), 3);
  const c = seededPickArenaSpawnPointsBatch(makeSeededRng(999), 3);
  return {
    samePointsForSameSeed: JSON.stringify(a)===JSON.stringify(b),
    pointCount: a.length,
    differsForOtherSeed: JSON.stringify(a)!==JSON.stringify(c),
  };
});

/* ===== 3. 安置: 待機(ARENA_ZONE_HOLD_SEC)→縮小(ARENA_ZONE_SHRINK_SEC)→決着圏で安定 ===== */
results.zoneShrink = await page.evaluate(()=>{
  window.__setupArena();
  const r0 = zoneState.radius;
  // 待機明けの直前・直後
  for(let i=0;i<Math.round((ARENA_ZONE_HOLD_SEC-0.5)*60);i++) updateArenaZone(1/60);
  const stillHolding = !zoneState.shrinking && zoneState.radius===r0;
  for(let i=0;i<60;i++) updateArenaZone(1/60);
  const shrinkStarted = zoneState.shrinking;
  // 縮小完了まで回す
  for(let i=0;i<Math.round((ARENA_ZONE_SHRINK_SEC+2)*60);i++) updateArenaZone(1/60);
  const centerStayed = zoneState.center.x===ZONE_CENTER0.x && zoneState.center.y===ZONE_CENTER0.y;
  return {
    startRadius: r0, stillHolding, shrinkStarted,
    finalRadius: Math.round(zoneState.radius),      // =ARENA_ZONE_END_RADIUS
    settled: !zoneState.shrinking && !zoneState.hasNext,
    centerStayed,
    countdownAfter: zoneCountdownSeconds(),          // 縮小済みはnull(もう動かない)
  };
});

/* ===== 4a. 決着: 敵チーム全滅→勝利(placement1) ===== */
results.winByWipe = await page.evaluate(()=>{
  window.__setupArena();
  const foeTeam = entities.find(e=>e.teamId!==player.teamId).teamId;
  for(const m of entities.filter(e=>e.teamId===foeTeam)){
    for(let k=0;k<3 && m.alive;k++) killEntity(m, player);   // 1回目はダウン、2回目でとどめ
  }
  return {
    resultLog: window.__resultLog,
    foePlacement: entities.find(e=>e.teamId===foeTeam).placement,
    myTeamPlacement: entities.filter(e=>e.teamId===player.teamId).map(e=>e.placement),
    gameOver: game.over,
  };
});

/* ===== 4b. 決着: 自チーム全滅→敗北(placement2) ===== */
results.loseByWipe = await page.evaluate(()=>{
  window.__setupArena();
  const foe = entities.find(e=>e.teamId!==player.teamId);
  for(const m of entities.filter(e=>e.teamId===player.teamId)){
    for(let k=0;k<3 && m.alive;k++) killEntity(m, foe);
  }
  return { resultLog: window.__resultLog, myPlacement: player.placement, gameOver: game.over };
});

/* ===== 5a. 時間切れ: 生存数が多いチーム(3v2)の勝ち ===== */
results.timeoutByAlive = await page.evaluate(()=>{
  window.__setupArena();
  const foeTeam = entities.find(e=>e.teamId!==player.teamId).teamId;
  const victim = entities.find(e=>e.teamId===foeTeam);
  for(let k=0;k<3 && victim.alive;k++) killEntity(victim, player);   // 敵を1体だけ倒して3v2にする
  const before = window.__resultLog.length;
  matchTime = ARENA_TIME_LIMIT;   // 時間切れまで進める
  update(1/60);
  return {
    firedOnTimeout: window.__resultLog.length>before,
    resultLog: window.__resultLog,
    myTeamPlacement: entities.filter(e=>e.teamId===player.teamId).map(e=>e.placement),
    foePlacements: entities.filter(e=>e.teamId===foeTeam).map(e=>e.placement),
  };
});

/* ===== 5b. 時間切れ: 生存数が同数(3v3)ならHP合計で勝敗(敵のHPを下げる→勝ち) ===== */
results.timeoutByHp = await page.evaluate(()=>{
  window.__setupArena();
  for(const e of entities){ if(e.teamId!==player.teamId) e.hp = 5; }   // 生存数は同数のまま敵を瀕死に
  matchTime = ARENA_TIME_LIMIT;
  update(1/60);
  return { resultLog: window.__resultLog };
});

/* ===== 5c. 時間切れ: 自チームのHP合計が低ければ敗北 ===== */
results.timeoutByHpLose = await page.evaluate(()=>{
  window.__setupArena();
  for(const e of entities){ if(e.teamId===player.teamId) e.hp = 5; }
  matchTime = ARENA_TIME_LIMIT;
  update(1/60);
  return { resultLog: window.__resultLog, myPlacement: player.placement };
});

/* ===== 6. 回帰: 個人戦・チーム戦にアリーナの状態が漏れていないこと ===== */
results.regression = await page.evaluate(()=>{
  // アリーナ→個人戦(アリーナの安置・チーム状態が残らない)
  game.selectedElement='fire'; game.selectedMap='wild'; game.realMapMode=false; game.selectedMastermonKey=null;
  window.__resultLog = [];
  startGame(); introState.active=false;
  const solo = {
    arenaFlag: game.arena, entityCount: entities.length, teamSize: game.teamSize,
    zoneRadius: zoneState.radius,                 // =通常のZONE_PHASES[0].holdRadius
    zoneDps: currentDps(),                        // 個人戦の序盤は0(アリーナのDPSが漏れていない)
    lootMany: lootItems.length > 100,             // 通常どおり大量に撒かれている
  };
  for(let i=0;i<60;i++) update(1/60);             // 少し回してエラーが出ないこと
  // アリーナ→チーム戦(20チームBRの経路が変わっていない)
  startGame({ teamSize:3, teamCount:4 }); introState.active=false;
  const team = {
    arenaFlag: game.arena, entityCount: entities.length, teamSize: game.teamSize,
    teamCount: new Set(entities.map(e=>e.teamId)).size,
    zoneRadius: zoneState.radius,
  };
  for(let i=0;i<60;i++) update(1/60);
  return { solo, team };
});

results.jsErrors = jsErrors;
console.log(JSON.stringify(results, null, 2));

await browser.close();
server.close();
const s = results.arenaStart;
const ok = s.arenaFlag && s.entityCount===6 && s.teamCount===2 && s.teamSizes.every(n=>n===3)
  && s.playerTeam===0 && s.zoneCentered && s.zoneRadius===1200 && s.zoneToRadius===350
  && s.centroidGap>=400 && s.centroidGap<=800
  && s.lootCount===14 && s.lootAllInZone && s.allSpawnedInZone && s.zoneDps===10
  && results.determinism.samePointsForSameSeed && results.determinism.differsForOtherSeed
  && results.zoneShrink.stillHolding && results.zoneShrink.shrinkStarted
  && results.zoneShrink.finalRadius===350 && results.zoneShrink.settled && results.zoneShrink.centerStayed
  && results.winByWipe.resultLog.some(r=>r.isWin && r.placement===1) && results.winByWipe.foePlacement===2
  && results.loseByWipe.resultLog.some(r=>!r.isWin && r.placement===2)
  && results.timeoutByAlive.firedOnTimeout
  && results.timeoutByAlive.resultLog.some(r=>r.isWin && r.placement===1)
  && results.timeoutByAlive.foePlacements.every(p=>p===2)
  && results.timeoutByHp.resultLog.some(r=>r.isWin && r.placement===1)
  && results.timeoutByHpLose.resultLog.some(r=>!r.isWin && r.placement===2)
  && !results.regression.solo.arenaFlag && results.regression.solo.entityCount===30
  && results.regression.solo.zoneDps===0 && results.regression.solo.lootMany
  && !results.regression.team.arenaFlag && results.regression.team.entityCount===12
  && jsErrors.length===0;
console.log(ok ? '\n== 全チェックOK ==' : '\n== 失敗あり ==');
process.exit(ok ? 0 : 1);
