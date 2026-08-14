/* チーム戦の土台(teamId・ダウン→蘇生・全滅・チーム順位・bot小隊行動)の自動検証。
   ヘッドレスChromiumでゲーム本体(index.html)をそのまま読み込み、ソロ経路で
   試合を組み立てて確認する(real3d_shot.mjs と同じ配信サーバ+起動フラグ)。
   ゲームの遊び心地の確認ではない(それは発注者がiPhone実機で行う)。

   使い方: node tools/team_test.mjs
   確認内容:
     1. チーム割当・チームスポーンが決定的(シード付き関数が同じ入力で同じ出力)
     2. ソロのチーム戦(3人1組×4チーム=12体): 割当規則・隣接スポーン・
        同チームへのダメージ0・ダウン→botの自動蘇生・出血死・
        1チーム残しの決着とチーム順位
     3. 個人戦(従来の30体)の挙動が変わっていないこと
     4. 3人1組×20チーム=60体で60秒回してJSエラーゼロ+update()の所要時間計測 */
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
  // Service Workerは配らない(controllerchange→reloadでテストの実行文脈が壊れるため)
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
const jsErrors = [];        // 実際に投げられたJS例外(これが0であることが合格条件)
const resourceNoise = [];   // 読み込み失敗など(テスト環境ではFirebase CDN等が落ちるのは正常)
const page = await browser.newPage({ viewport:{ width:1200, height:560 } });
page.on('pageerror', e=> jsErrors.push(String(e)));
page.on('console', m=>{ if(m.type()==='error') resourceNoise.push('console: '+m.text()); });

await page.goto(`${ORIGIN}/index.html`, { waitUntil:'load' });
await page.waitForFunction(()=> typeof startGame==='function' && typeof update==='function'
  && typeof assignTeams==='function' && typeof killEntity==='function', null, { timeout:30000 });

const results = {};

/* リザルト画面へ進まないようにスタブへ差し替え、呼ばれた内容だけ記録する
   (リザルトの表示・報酬は本テストの対象外。関数宣言なので再代入できる) */
await page.evaluate(()=>{
  window.__resultLog = [];
  window.showResult = (isWin, placement)=>{ window.__resultLog.push({ isWin:!!isWin, placement }); game.over = true; game.started = false; };
  window.__setupSolo = (opts)=>{
    game.selectedElement = 'fire';
    game.selectedMap = 'wild';
    game.realMapMode = false;
    game.selectedMastermonKey = null;
    window.__resultLog = [];
    startGame(opts);
    introState.active = false;   // 召喚演出は飛ばして即プレイ状態にする
  };
});

/* ===== 1. 決定性: シード付きチームスポーンと割当規則 ===== */
results.determinism = await page.evaluate(()=>{
  window.__setupSolo({ teamSize:3, teamCount:4 });   // WORLD/rocks等を実試合と同じ状態にしてから測る
  const a = seededPickTeamSpawnPointsBatch(makeSeededRng(20260814), 20, 3);
  const b = seededPickTeamSpawnPointsBatch(makeSeededRng(20260814), 20, 3);
  const c = seededPickTeamSpawnPointsBatch(makeSeededRng(999), 20, 3);
  return {
    samePointsForSameSeed: JSON.stringify(a)===JSON.stringify(b),
    pointCount: a.length,
    differsForOtherSeed: JSON.stringify(a)!==JSON.stringify(c),
  };
});

/* ===== 2a. チーム割当・隣接スポーン(3人1組×4チーム=12体) ===== */
results.teamAssign = await page.evaluate(()=>{
  window.__setupSolo({ teamSize:3, teamCount:4 });
  const byTeam = new Map();
  for(const e of entities){
    if(!byTeam.has(e.teamId)) byTeam.set(e.teamId, []);
    byTeam.get(e.teamId).push(e);
  }
  let consecutive = true, sizesOk = true;
  const spawnSpread = [];
  for(const [tid, ms] of byTeam){
    if(ms.length!==3) sizesOk = false;
    const ids = ms.map(m=>m.id).sort((x,y)=>x-y);
    for(let i=1;i<ids.length;i++) if(ids[i]!==ids[i-1]+1) consecutive = false;
    let maxD = 0;
    for(let i=0;i<ms.length;i++) for(let j=i+1;j<ms.length;j++) maxD = Math.max(maxD, dist(ms[i], ms[j]));
    spawnSpread.push(Math.round(maxD));
  }
  return {
    entityCount: entities.length, teamSize: game.teamSize, teamCount: byTeam.size,
    playerTeam: player.teamId, sizesOk, idsConsecutive: consecutive,
    intraTeamSpawnMaxDist: spawnSpread,   // 同チームの最遠ペア距離(隣接スポーンの実測)
  };
});

/* ===== 2b. フレンドリーファイア無し ===== */
results.friendlyFire = await page.evaluate(()=>{
  const mate  = entities.find(e=>e!==player && e.teamId===player.teamId);
  const enemy = entities.find(e=>e.teamId!==player.teamId);
  const mateHp = mate.hp, mateGuts = mate.guts, enemyHp = enemy.hp;
  applyDamage(mate, 50, player, {});                       // 直接ダメージ
  applyDamage(mate, 50, player, { gutsDrain: 0.5 });       // ガッツ削り付き
  applyDamage(enemy, 50, player, {});
  return {
    mateHpUnchanged: mate.hp===mateHp,
    mateGutsUnchanged: mate.guts===mateGuts,
    mateNoBurn: !(mate.burnUntil > matchTime),             // 状態異常(やけど)も付かない
    enemyDamaged: enemy.hp < enemyHp,
  };
});

/* ===== 2c. ダウン→botの自動蘇生 ===== */
results.downRevive = await page.evaluate(()=>{
  window.__setupSolo({ teamSize:3, teamCount:4 });
  const cx = WORLD.w/2, cy = WORLD.h/2;
  const team2 = entities.filter(e=>e.teamId===2);
  const [m1, m2, m3] = team2;
  // 検証しやすいように配置: m1の近く(蘇生半径の外・追従距離内)にm2、少し離してm3
  m1.x=cx; m1.y=cy; m2.x=cx+150; m2.y=cy; m3.x=cx+220; m3.y=cy+60;
  // 他のチームは遠くへ(戦闘で邪魔されないように)
  for(const e of entities){ if(e.teamId!==2){ e.x = 200; e.y = 200; e.aiTargetPoint=null; e.attackTargetId=null; } }
  const attacker = entities.find(e=>e.teamId===3);
  const downFeed = [];
  const origFeed = pushKillFeed; window.pushKillFeed = (t)=>{ downFeed.push(t); origFeed(t); };
  applyDamage(m1, m1.hp + 9999, attacker, {});
  const downedNow = { alive: m1.alive, downed: m1.downed, hpPositive: m1.hp > 0,
                      feedSaysDown: downFeed.some(t=>t.includes('ダウン')) };
  // botの小隊行動: m2/m3が蘇生に向かい、半径80に2.5秒とどまると復活(HP40%)するはず
  let revived = false, sawProgress = 0, botStateSeen = new Set();
  for(let i=0;i<60*12 && !revived;i++){
    update(1/60);
    sawProgress = Math.max(sawProgress, m1.reviveProgress||0);
    for(const m of [m2,m3]) botStateSeen.add(m.aiState);
    if(m1.alive && !m1.downed) revived = true;
  }
  window.pushKillFeed = origFeed;
  return {
    downedNow, revived,
    maxReviveProgressSeen: Math.round(sawProgress*100)/100,
    revivedHpRatio: revived ? Math.round(m1.hp/m1.maxHp*100)/100 : null,
    botWentToRevive: botStateSeen.has('REVIVE'),
  };
});

/* ===== 2d. 出血死(蘇生が来なければタイマー切れで死亡) ===== */
results.bleedOut = await page.evaluate(()=>{
  window.__setupSolo({ teamSize:3, teamCount:4 });
  const team1 = entities.filter(e=>e.teamId===1);
  const victim = team1[0];
  // 仲間を蘇生探索距離(1600)の外へ置いて蘇生させない
  team1[1].x = 200; team1[1].y = 200; team1[2].x = 300; team1[2].y = 200;
  victim.x = WORLD.w-300; victim.y = WORLD.h-300;
  for(const e of entities){ if(e.teamId!==1){ e.x=400; e.y=400; e.attackTargetId=null; } }
  const attacker = entities.find(e=>e.teamId===0);
  applyDamage(victim, victim.hp+9999, attacker, {});
  const wasDowned = victim.downed && victim.alive;
  victim.downedUntil = matchTime + 0.5;   // 出血タイマーを縮めて待つ(実際は30秒)
  for(let i=0;i<90;i++) update(1/60);
  return { wasDowned, deadAfterTimer: !victim.alive };
});

/* ===== 2e. 決着: 1チーム残しで勝敗・チーム順位(全滅チームは同順位) ===== */
results.teamWin = await page.evaluate(()=>{
  window.__setupSolo({ teamSize:3, teamCount:4 });
  const wipeTeam = (tid)=>{
    for(const m of entities.filter(e=>e.teamId===tid)){
      for(let k=0;k<3 && m.alive;k++) killEntity(m, player);   // 1回目はダウン、2回目でとどめ
    }
  };
  wipeTeam(1);   // 最初の全滅 → 4位
  const t1Place = entities.filter(e=>e.teamId===1).map(e=>e.placement);
  wipeTeam(2);   // 次 → 3位
  wipeTeam(3);   // 最後 → 2位、自チームが勝ち残り → 全員1位
  return {
    team1AllSamePlacement: t1Place.every(p=>p===t1Place[0]),
    team1Placement: t1Place[0],
    team2Placement: entities.find(e=>e.teamId===2).placement,
    team3Placement: entities.find(e=>e.teamId===3).placement,
    myTeamPlacement: entities.filter(e=>e.teamId===player.teamId).map(e=>e.placement),
    resultLog: window.__resultLog,
    gameOver: game.over,
  };
});

/* ===== 3. 個人戦(現行)の無変化確認 ===== */
results.soloRegression = await page.evaluate(()=>{
  window.__setupSolo();       // 引数なし=従来どおり
  const base = {
    entityCount: entities.length,
    teamSize: game.teamSize,
    allTeamIdNull: entities.every(e=>e.teamId===null),
  };
  // 5秒ぶん普通に回しつつ、比較用のupdate所要時間(30体の基準値)も取る
  let n=0, total=0;
  for(let i=0;i<60*5;i++){ const t0=performance.now(); update(1/60); n++; total += performance.now()-t0; }
  const avgUpdateMs30 = Math.round(total/n*1000)/1000;
  const noDownEver = entities.every(e=>!e.downed);
  // 敵を全部倒す: ダウンを経ずに一撃で死ぬこと・順位が従来どおり付くことを確認
  let downHappened = false;
  const bots = entities.filter(e=>!e.isPlayer);
  for(const b of bots){
    if(!b.alive) continue;
    killEntity(b, player);
    if(b.alive) downHappened = true;   // 個人戦でダウンが起きたら異常
  }
  const lastBot = bots.filter(b=>b.placement===2);
  return {
    ...base, noDownEver, downHappened, avgUpdateMs30,
    playerPlacement: player.placement,
    somebodyGotSecond: lastBot.length===1,
    resultLog: window.__resultLog,
  };
});

/* ===== 4. 60体(3人1組×20チーム)で60秒: JSエラーと1フレームのupdate時間 ===== */
results.load60 = await page.evaluate(()=>{
  window.__setupSolo({ teamSize:3, teamCount:20 });
  const counts = {
    entityCount: entities.length,
    teamCount: new Set(entities.map(e=>e.teamId)).size,
  };
  // どこが重いかの内訳(updateの中の主要関数をその場でラップして計測)
  const prof = {};
  const wrap = (name)=>{
    const orig = window[name];
    if(typeof orig!=='function') return;
    prof[name] = 0;
    window[name] = function(...args){ const t0=performance.now(); const r = orig.apply(this, args); prof[name] += performance.now()-t0; return r; };
  };
  ['updateBotAI','resolveMovement','separateEntities','updateProjectiles','updateLootPickups',
   'updateAreaEffects','updateTeamStates','updateHUD'].forEach(wrap);
  const samples = [];
  let total=0, max=0;
  const frames = 60*60;   // 60秒ぶん(1/60秒刻み)。自チーム全滅で決着が付いても回し続けてエラーを見る
  for(let i=0;i<frames;i++){
    const t0 = performance.now();
    update(1/60);
    const ms = performance.now() - t0;
    samples.push(ms); total += ms; if(ms>max) max = ms;
  }
  samples.sort((a,b)=>a-b);
  const p = (q)=> Math.round(samples[Math.min(samples.length-1, Math.floor(samples.length*q))]*100)/100;
  const breakdown = {};
  for(const k in prof) breakdown[k] = Math.round(prof[k]/frames*1000)/1000;  // 1フレームあたりms
  const downs = entities.filter(e=>e.downed).length;
  const deadTeams = counts.teamCount - new Set(entities.filter(e=>e.alive).map(e=>e.teamId)).size;
  return {
    ...counts, framesRun: frames,
    avgUpdateMs: Math.round(total/frames*1000)/1000,
    p50UpdateMs: p(0.5), p95UpdateMs: p(0.95), maxUpdateMs: Math.round(max*100)/100,
    breakdownAvgMsPerFrame: breakdown,
    matchDecided: game.over,
    downedNowCount: downs, wipedTeamCount: deadTeams,
    aliveCount: entities.filter(e=>e.alive).length,
    projectileCount: projectiles.length, lootCount: lootItems.length, particleCount: particles.length,
  };
});

results.jsErrors = jsErrors;
results.resourceNoise = resourceNoise;
console.log(JSON.stringify(results, null, 2));

await browser.close();
server.close();
const ok = results.determinism.samePointsForSameSeed
  && results.teamAssign.sizesOk && results.teamAssign.idsConsecutive
  && results.friendlyFire.mateHpUnchanged && results.friendlyFire.enemyDamaged
  && results.downRevive.revived && results.bleedOut.deadAfterTimer
  && results.teamWin.resultLog.some(r=>r.isWin && r.placement===1)
  && results.soloRegression.entityCount===30 && !results.soloRegression.downHappened
  && jsErrors.length===0;
console.log(ok ? '\n== 全チェックOK ==' : '\n== 失敗あり ==');
process.exit(ok ? 0 : 1);
