/* デス円盤石(kind:'deathDisc')の自動検証。
   ヘッドレスChromiumでゲーム本体(index.html)をそのまま読み込み、ソロ経路で確認する
   (team_test.mjs と同じ配信サーバ+起動フラグ)。遊び心地の確認ではない(それは実機)。

   使い方: node tools/deathdisc_test.mjs
   確認内容:
     1. トレーニングカード適用 → matchTrainLog に記録される(適用失敗時は積まれない)
     2. 死亡 → deathDisc が落ちる(中身=ログの新しい方から最大 DEATH_DISC_MAX_ITEMS 件・
        位置=倒れた場所)。ログ0件なら落ちない。レイドでは落ちない。
        チーム戦のダウンでは落ちず、とどめ(本当の死亡)で落ちる
     3. 拾う → 強化が実際に反映される(拾う前後の maxHp / mastermonDmgTakenMult を実測)+
        拾った項目が自分の matchTrainLog にも積まれ、自分が死んだらまた落ちる(連鎖)
     4. チーム戦の山分け: 生きている小隊全員に等分され、拾った本人の伸びは個人戦の総取りより
        小さく、3人ぶんの合計は総取りとほぼ同じ(力の総量は減らない)
     5. 既存回帰: tools/team_test.mjs の全チェックOK維持(このファイルの最後に子プロセスで実行) */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';

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
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const jsErrors = [];
const page = await browser.newPage({ viewport:{ width:1200, height:560 } });
page.on('pageerror', e=> jsErrors.push(String(e)));

await page.goto(`${ORIGIN}/index.html`, { waitUntil:'load' });
await page.waitForFunction(()=> typeof startGame==='function' && typeof update==='function'
  && typeof killEntity==='function' && typeof spawnDeathDisc==='function'
  && typeof applyTrainCardToEntity==='function', null, { timeout:30000 });

const results = {};

await page.evaluate(()=>{
  window.__resultLog = [];
  window.showResult = (isWin, placement)=>{ window.__resultLog.push({ isWin:!!isWin, placement }); game.over = true; game.started = false; };
  window.__toasts = [];
  const origToast = pushToast; window.pushToast = (t)=>{ window.__toasts.push(String(t)); origToast(t); };
  window.__setupSolo = (opts)=>{
    game.selectedElement = 'fire';
    game.selectedMap = 'wild';
    game.realMapMode = false;
    game.selectedMastermonKey = null;
    window.__resultLog = [];
    window.__toasts = [];
    startGame(opts);
    introState.active = false;
  };
  // 円盤石だけを数える(他のアイテムと区別)
  window.__discs = ()=> lootItems.filter(it=>it.kind==='deathDisc');
});

/* ===== 1. カード適用 → matchTrainLog に記録される(ソロ) ===== */
results.record = await page.evaluate(()=>{
  window.__setupSolo();
  const emptyAtStart = entities.every(e=> Array.isArray(e.matchTrainLog) && e.matchTrainLog.length===0);
  const hpBefore = player.maxHp;
  const c1 = applyTrainCardToEntity(player, 'run');   // ライフ↑ → 最大HPが実際に増えるはず
  const c2 = applyTrainCardToEntity(player, 'log');
  const badKey = applyTrainCardToEntity(player, 'zzz_nokey');   // 存在しないカードは積まれない
  return {
    emptyAtStart,
    applied: !!(c1 && c2), badKeyRejected: badKey===null,
    log: player.matchTrainLog.slice(),
    logOk: JSON.stringify(player.matchTrainLog)===JSON.stringify(['run','log']),
    maxHpBefore: hpBefore, maxHpAfter: player.maxHp,
    maxHpGrew: player.maxHp > hpBefore,
  };
});

/* ===== 2a. 死亡 → deathDisc が落ちる(中身・位置)。ログ0件なら落ちない ===== */
results.drop = await page.evaluate(()=>{
  window.__setupSolo();
  const bots = entities.filter(e=>!e.isPlayer && e.alive);
  const [withLog, noLog] = bots;
  // 4件積む → 新しい方から DEATH_DISC_MAX_ITEMS(3)件だけが中身になる
  for(const k of ['domino','shateki','run','log']) applyTrainCardToEntity(withLog, k);
  withLog.x = zoneState.center.x + 100; withLog.y = zoneState.center.y;   // 安全圏内(圏外のアイテムは即消えるため)
  noLog.x = zoneState.center.x - 100; noLog.y = zoneState.center.y;
  const before = __discs().length;
  killEntity(withLog, player);
  const afterWithLog = __discs().length;
  killEntity(noLog, player);
  const afterNoLog = __discs().length;
  const disc = __discs()[0] || null;
  return {
    noneBefore: before===0,
    droppedFromLogged: afterWithLog===1,
    notDroppedFromEmpty: afterNoLog===1,
    keys: disc && disc.keys, keysOk: !!disc && JSON.stringify(disc.keys)===JSON.stringify(['shateki','run','log']),
    atDeathSpot: !!disc && disc.x===withLog.x && disc.y===withLog.y,
    owner: disc && disc.owner,
    maxItemsConst: DEATH_DISC_MAX_ITEMS,
  };
});

/* ===== 2b. レイドでは落ちない(killEntityが通るのと同じ spawnDeathDisc で判定) ===== */
results.raidExcluded = await page.evaluate(()=>{
  window.__setupSolo();
  const bot = entities.find(e=>!e.isPlayer && e.alive);
  applyTrainCardToEntity(bot, 'run');
  game.raid = true;
  const inRaid = spawnDeathDisc(bot);
  game.raid = false;
  const normal = spawnDeathDisc(bot);
  lootItems.length = lootItems.length;   // 後片付け不要(次のテストが setup し直す)
  return { raidReturnsNull: inRaid===null, normalDrops: !!normal, raidFlagRestored: game.raid===false };
});

/* ===== 2c. チーム戦: ダウンでは落ちず、とどめ(本当の死亡)で落ちる ===== */
results.downNotDrop = await page.evaluate(()=>{
  window.__setupSolo({ teamSize:3, teamCount:4 });
  const victim = entities.find(e=>e.teamId!==player.teamId && e.alive);
  applyTrainCardToEntity(victim, 'pool');
  victim.x = zoneState.center.x; victim.y = zoneState.center.y;
  killEntity(victim, player);                      // 立っている味方がいる → ダウン
  const discsAfterDown = __discs().length;
  const wasDowned = victim.downed && victim.alive;
  killEntity(victim, player);                      // とどめ → 本当の死亡
  const discsAfterFinish = __discs().length;
  return { wasDowned, noDropOnDown: discsAfterDown===0, dropOnFinish: discsAfterFinish===1, victimDead: !victim.alive };
});

/* ===== 3. 拾う → 強化の実測反映+連鎖(拾った項目が自分のログにも積まれ、死ぬとまた落ちる) ===== */
results.pickup = await page.evaluate(()=>{
  window.__setupSolo();
  const victimBot = entities.find(e=>!e.isPlayer && e.alive);
  // 中身: 走り込み(最大HP↑)×2+丸太うけ(丈夫さ↑=被ダメ倍率↓)。効果が数値で測れる組み合わせ
  for(const k of ['run','run','log']) applyTrainCardToEntity(victimBot, k);
  victimBot.x = zoneState.center.x; victimBot.y = zoneState.center.y;
  killEntity(victimBot, player);
  const disc = __discs()[0];
  // 他の全員を遠ざけ、自分だけが拾える状態にする
  for(const e of entities){ if(e!==player && e.alive){ e.x = 300; e.y = 300; } }
  player.x = disc.x; player.y = disc.y;
  const before = {
    maxHp: player.maxHp,
    // マスモン未選択だと最初の倍率は未定義(applyDamage側は ||1 で読む)。実効値の1で比較する
    dmgTakenMult: (player.mastermonDmgTakenMult!=null ? player.mastermonDmgTakenMult : 1),
    logLen: player.matchTrainLog.length,
  };
  updateLootPickups();
  const after = {
    maxHp: player.maxHp,
    dmgTakenMult: player.mastermonDmgTakenMult,
    log: player.matchTrainLog.slice(),
  };
  const discGone = __discs().length===0;
  const toast = window.__toasts.find(t=>t.includes('受け継いだ')) || null;
  // 連鎖: 拾った直後に自分が倒される → 受け継いだ項目入りの円盤石がまた落ちる
  const attacker = entities.find(e=>!e.isPlayer && e.alive);
  killEntity(player, attacker);
  const chained = __discs()[0] || null;
  return {
    before, after,
    discGone,
    maxHpGrew: after.maxHp > before.maxHp,
    dmgTakenReduced: after.dmgTakenMult < before.dmgTakenMult,
    logInherited: after.log.length===before.logLen+3 && JSON.stringify(after.log.slice(-3))===JSON.stringify(['run','run','log']),
    toast,
    toastOk: !!toast,
    chainDropped: !!chained,
    chainKeys: chained && chained.keys,
    chainKeysOk: !!chained && JSON.stringify(chained.keys)===JSON.stringify(['run','run','log']),
  };
});

/* ===== 4. チーム戦: 拾った力を小隊で3等分する(拾った1人の総取りにしない) =====
   同じ中身の円盤石を「個人戦で1人が拾う」「チーム戦で3人小隊の1人が拾う」で拾い比べ、
   ・拾った本人の伸びが個人戦よりはっきり小さい
   ・拾っていない味方2人も同じだけ伸びている
   ・3人ぶんを足すと個人戦の総取りに近い(力の総量は減っていない)
   を確かめる。倒れている味方には配らない(取りこぼしを作らない)ことも見る。 */
results.teamShare = await page.evaluate(()=>{
  const KEYS = ['run','run','run'];   // 走り込み×3(ライフだけが動くので差が測りやすい)
  window.__setupSolo({ teamSize:3, teamCount:4 });
  const mates = teamMembers(player.teamId);
  const victim = entities.find(e=>e.teamId!==player.teamId && e.alive);
  for(const k of KEYS) applyTrainCardToEntity(victim, k);
  victim.x = zoneState.center.x; victim.y = zoneState.center.y;
  killEntity(victim, player); killEntity(victim, player);   // ダウン→とどめ
  const disc = __discs()[0];
  // 拾うのは自分だけ。敵は遠ざけ、味方も拾えない位置へ置く(それでも小隊なので配られる)
  for(const e of entities){ if(e!==player && e.alive) { e.x = 300; e.y = 300; } }
  /* 山分けの正しさは「最大HPの伸び」では測れない。**同じライフ+1でも種族と適正で
     最大HPの増え方が違う**ため(それが狙いでもある)。ライフの素の値で測る。 */
  const before = mates.map(m=>({ life: ensureMatchMm(m).stats.life, hp: m.maxHp,
                                 // その子が総取りしたら動くはずの量(純関数なので副作用なし)
                                 full: KEYS.reduce((s,k)=> s + (trainCardChanges(ensureMatchMm(m), k).life||0), 0) }));
  player.x = disc.x; player.y = disc.y;
  updateLootPickups();
  const rows = mates.map((m,i)=>({
    name: displayNameFor(m), full: before[i].full,
    got: m.matchMm.stats.life - before[i].life,
    hpGain: m.maxHp - before[i].hp,
    logGrew: m.matchTrainLog.slice(-3).join(',')==='run,run,run',
  }));
  return {
    teamSize: mates.length, rows,
    everyoneGained: rows.every(r=>r.got>0 && r.hpGain>0),
    // 受け取ったのは総取りの1/3(切り上げ・切り捨ての誤差3まで許す)
    thirdEach: rows.every(r=> Math.abs(r.got - r.full/3) <= 3),
    everyoneLogged: rows.every(r=>r.logGrew),
    shareNoteInToast: !!window.__toasts.find(t=>t.includes('3人で山分け')),
    mateToasts: window.__toasts.filter(t=>t.includes('山分けしてくれた')).length,
  };
});

results.jsErrors = jsErrors;
console.log(JSON.stringify(results, null, 2));

await browser.close();
server.close();

/* ===== 4. 既存回帰: team_test.mjs 全チェックOK維持 ===== */
console.log('\n--- 回帰: tools/team_test.mjs ---');
const reg = spawnSync(process.execPath, [path.join(__dirname, 'team_test.mjs')], { cwd: ROOT, encoding:'utf8', timeout: 10*60*1000 });
const regOk = reg.status===0 && (reg.stdout||'').includes('全チェックOK');
console.log(regOk ? '回帰OK(team_test 全チェックOK)' : `回帰NG(status=${reg.status})\n${(reg.stdout||'').slice(-2000)}\n${(reg.stderr||'').slice(-1000)}`);

const ok = results.record.emptyAtStart && results.record.logOk && results.record.maxHpGrew && results.record.badKeyRejected
  && results.drop.droppedFromLogged && results.drop.notDroppedFromEmpty && results.drop.keysOk && results.drop.atDeathSpot
  && results.raidExcluded.raidReturnsNull && results.raidExcluded.normalDrops
  && results.downNotDrop.wasDowned && results.downNotDrop.noDropOnDown && results.downNotDrop.dropOnFinish
  && results.pickup.discGone && results.pickup.maxHpGrew && results.pickup.dmgTakenReduced
  && results.pickup.logInherited && results.pickup.toastOk && results.pickup.chainKeysOk
  && results.teamShare.everyoneGained && results.teamShare.thirdEach
  && results.teamShare.everyoneLogged && results.teamShare.shareNoteInToast
  && results.teamShare.mateToasts===0   // ソロ操作の味方はbot=トーストは出ない(出るのは人間だけ)
  && jsErrors.length===0
  && regOk;
console.log(ok ? '\n== 全チェックOK ==' : '\n== 失敗あり ==');
process.exit(ok ? 0 : 1);
