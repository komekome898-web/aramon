/* ピン(シグナル)+キルリーダーの自動検証。
   ヘッドレスChromiumでゲーム本体(index.html)をそのまま読み込み、ソロのチーム戦経路で確認する
   (team_test.mjs と同じ配信サーバ+起動方法)。ゲームの遊び心地の確認ではない(それは発注者がiPhone実機で行う)。

   使い方: node tools/ping_test.mjs
   確認内容:
     1. チーム戦でピンボタンが表示され、押下1回で照準先の敵に敵ピン(対象・種別・寿命)
     2. 敵がいない方向へは移動ピン(照準方向・射程PING_RANGE以内)
     3. 連打しても最新1個だけ(上書き)
     4. 期限切れ・対象死亡でピンが消える
     5. 個人戦ではボタン非表示+sendPingが何もしない
     6. キルリーダーの導出(2キル以上・最多)と交代時のフィード行
     7. スクリーンショット(敵ピン/移動ピン/キルリーダー👑/ミニマップ)を /tmp/ping/ へ
     8. 縦持ち3サイズ(375x667/375x812/414x896)でピンボタンが他の操作UIと重ならない実測 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHOT_DIR = '/tmp/ping';
fs.mkdirSync(SHOT_DIR, { recursive: true });

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

let failCount = 0;
function check(name, ok, detail){
  console.log(`${ok ? '✅' : '❌'} ${name}${detail!=null ? ` — ${detail}` : ''}`);
  if(!ok) failCount++;
}

async function openGame(viewport){
  const page = await browser.newPage({ viewport });
  const jsErrors = [];
  page.on('pageerror', e=> jsErrors.push(String(e).slice(0,160)));
  await page.goto(`${ORIGIN}/index.html`, { waitUntil:'load' });
  await page.waitForFunction(()=> typeof startGame==='function' && typeof sendPing==='function', null, { timeout: 30000 });
  // タイトルを抜けてポップアップ(ログインボーナス等)を閉じる(mode_e2eと同じ前例手順)
  await page.waitForFunction(()=>{ const t=document.getElementById('titleTapStart'); return t && !t.classList.contains('hidden'); }, null, { timeout: 30000 });
  await page.evaluate(()=> document.getElementById('titleScreen').click());
  await page.waitForTimeout(900);
  await page.evaluate(()=>{ for(let i=0;i<4;i++) document.querySelectorAll('button').forEach(b=>{ if(/受け取る|閉じる|OK|スキップ/.test(b.textContent||'') && b.offsetParent) b.click(); }); });
  return { page, jsErrors };
}
// ソロのチーム戦(3人1組)を組み立て、演出を飛ばして即プレイ状態にする
async function startTeamMatch(page){
  await page.evaluate(()=>{
    game.selectedElement = 'fire'; game.selectedMap = 'wild'; game.realMapMode = false;
    game.selectedMastermonKey = null;
    startGame({ teamSize: 3 });
    introState.active = false;
  });
  await page.waitForTimeout(350);   // updateHUDが数フレーム回ってボタン表示が確定するのを待つ
}

/* ===== 1〜6: 機能検証(横持ちビューポート) ===== */
{
  const { page, jsErrors } = await openGame({ width: 812, height: 375 });
  await startTeamMatch(page);

  // 1. ボタン表示+敵ピン
  const r1 = await page.evaluate(()=>{
    const btn = document.getElementById('pingBtn');
    const visibleBefore = !btn.classList.contains('hidden');
    // 照準の先(500先・角度0)に敵を置く。他の敵は全部後ろへ退避して探索対象を1体に絞る
    const enemies = entities.filter(e=> e!==player && e.alive && !sameTeam(player, e));
    player.facingAngle = 0;
    for(const e of enemies){ e.x = player.x - 2000; e.y = player.y; }
    const target = enemies[0];
    target.x = player.x + 500; target.y = player.y + 40;   // 角度arctan(40/500)≒0.08rad < PING_ENEMY_SEARCH_ANGLE
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const pg = teamPings.get(player.id);
    return { visibleBefore, size: teamPings.size,
      kind: pg && pg.kind, targetId: pg && pg.targetId, wantTarget: target.id,
      life: pg && Math.round((pg.expireAt - matchTime)*10)/10,
      feed: document.getElementById('killFeed').innerText };
  });
  check('チーム戦でピンボタンが表示される', r1.visibleBefore);
  check('押下1回で敵ピン(kind=enemy)', r1.kind==='enemy', `kind=${r1.kind}`);
  check('敵ピンの対象=照準先の敵', r1.targetId===r1.wantTarget, `target=${r1.targetId} want=${r1.wantTarget}`);
  check(`敵ピンの寿命=PING_LIFETIME_SEC`, r1.life===6, `残り${r1.life}s`);
  check('フィードに「敵発見！」', /敵発見/.test(r1.feed), JSON.stringify(r1.feed.slice(0,60)));
  // 敵ピンが画面に出ている状態(旗+ミニマップの点滅点)
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOT_DIR}/enemy_ping.png` });
  const miniBox = await page.locator('#minimapWrap').boundingBox();
  if(miniBox) await page.screenshot({ path: `${SHOT_DIR}/minimap_enemy_ping.png`, clip: miniBox });

  // 2. 敵がいない方向→移動ピン / 3. 連打で最新1個
  const r2 = await page.evaluate(()=>{
    for(const e of entities){ if(e!==player && e.alive && !sameTeam(player, e)){ e.x = player.x - 2000; e.y = player.y; } }
    player.facingAngle = 0;   // 前方(x+)には誰もいない
    const btn = document.getElementById('pingBtn');
    for(let i=0;i<5;i++) btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));   // 連打
    const pg = teamPings.get(player.id);
    return { size: teamPings.size, kind: pg && pg.kind,
      dx: pg && Math.round(pg.x - player.x), dy: pg && Math.round(pg.y - player.y),
      feed: document.getElementById('killFeed').innerText };
  });
  check('敵がいない方向は移動ピン(kind=move)', r2.kind==='move', `kind=${r2.kind}`);
  check(`移動ピンは照準方向・PING_RANGE(700)以内`, r2.dx>0 && r2.dx<=700 && Math.abs(r2.dy)<=1, `dx=${r2.dx} dy=${r2.dy}`);
  check('連打しても最新1個だけ(上書き)', r2.size===1, `size=${r2.size}`);
  check('フィードに「ここへ！」', /ここへ/.test(r2.feed));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOT_DIR}/move_ping.png` });
  const miniBox2 = await page.locator('#minimapWrap').boundingBox();
  if(miniBox2) await page.screenshot({ path: `${SHOT_DIR}/minimap_move_ping.png`, clip: miniBox2 });

  // 4. 期限切れ+対象死亡で消える
  const r4 = await page.evaluate(()=>{
    const pg = teamPings.get(player.id);
    pg.expireAt = matchTime - 0.01;   // 期限を過去にして掃除されることを確認
    prunePings();
    const expired = teamPings.size===0;
    // 敵ピンを打ち直し、対象を倒すと消えることを確認
    const enemy = entities.find(e=> e!==player && e.alive && !sameTeam(player, e));
    player.facingAngle = 0; enemy.x = player.x + 400; enemy.y = player.y;
    sendPing();
    const wasEnemy = teamPings.get(player.id) && teamPings.get(player.id).kind==='enemy';
    enemy.alive = false;
    prunePings();
    const goneOnDeath = teamPings.size===0;
    enemy.alive = true;
    return { expired, wasEnemy, goneOnDeath };
  });
  check('期限切れで消える', r4.expired);
  check('対象が倒されると敵ピンが消える', r4.wasEnemy && r4.goneOnDeath);

  // 5. キルリーダー: 導出+交代フィード+👑スクショ
  /* 試合は実時間で進んでいてbotが勝手にキルを稼ぐため、検証は1回のevaluate内(=フレームを
     またがない)で「全員0キル→a2キル→b3キル」を作って原子的に確認する。 */
  const r5 = await page.evaluate(()=>{
    for(const e of entities) e.kills = 0;
    updateKillLeader();   // リーダー不在の状態に揃える
    const bots = entities.filter(e=> e!==player && e.alive && !sameTeam(player, e));
    const a = bots[0], b = bots[1];
    document.getElementById('killFeed').innerHTML = '';
    a.kills = 2; updateKillLeader();
    const first = { id: killLeaderCurId, want: a.id, feed: document.getElementById('killFeed').innerText };
    b.kills = 3; updateKillLeader();
    const second = { id: killLeaderCurId, want: b.id, feed: document.getElementById('killFeed').innerText };
    // 👑が名前に付く(drawMonsterの★と同じ作法)ことをisKillLeaderで確認し、画面にも出す。
    // スクショまでの間にbotへ抜かれないようキル数を大きくしておく(表示確認用)
    b.kills = 99;
    b.x = player.x + Math.cos(camState.yaw)*300; b.y = player.y + Math.sin(camState.yaw)*300; b.z = 0;
    return { first, second, isLeaderB: isKillLeader(b), isLeaderA: isKillLeader(a), bName: b.name };
  });
  check('2キルでキルリーダーになる', r5.first.id===r5.first.want && /キルリーダー/.test(r5.first.feed), r5.first.feed.slice(0,60));
  check('キル数が上回ると交代+フィード行', r5.second.id===r5.second.want && /キルリーダー/.test(r5.second.feed));
  check('isKillLeaderの判定(新リーダーのみtrue)', r5.isLeaderB && !r5.isLeaderA);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOT_DIR}/kill_leader.png` });

  // 0キルに戻すとリーダー不在に戻る(導出のみ・フィードは出ない)
  const r5b = await page.evaluate(()=>{
    for(const e of entities) e.kills = 0;
    updateKillLeader();
    return { id: killLeaderCurId };
  });
  check('全員2キル未満ならリーダー不在', r5b.id===null, `id=${r5b.id}`);

  // 6. 個人戦: ボタン非表示+sendPingが何もしない+リーダー印は個人戦でも出る(導出のみ確認)
  await page.evaluate(()=>{ game.started=false; game.over=true; });
  await page.evaluate(()=>{ startGame(); introState.active = false; });
  await page.waitForTimeout(350);
  const r6 = await page.evaluate(()=>{
    const btn = document.getElementById('pingBtn');
    sendPing();   // 個人戦では何も起きないはず
    for(const e of entities) e.kills = 0;   // botが稼いだ分をリセットして決定的にする
    const solo = entities.filter(e=> e!==player && e.alive);
    solo[0].kills = 2; updateKillLeader();
    return { hidden: btn.classList.contains('hidden'), pings: teamPings.size,
      leader: killLeaderCurId===solo[0].id };
  });
  check('個人戦ではピンボタン非表示', r6.hidden);
  check('個人戦ではsendPingが何もしない', r6.pings===0, `size=${r6.pings}`);
  check('キルリーダーは個人戦でも導出される', r6.leader);

  check('JSエラーなし(機能検証)', jsErrors.length===0, jsErrors.join(' / ') || undefined);
  await page.close();
}

/* ===== 8: 縦持ち3サイズ+横持ちでピンボタンが他の操作UIと重ならない実測 =====
   横持ち(812x375)も測る: DASHの真上に置いた初版はキルフィード3行目と重なった。 */
for(const [w,h] of [[375,667],[375,812],[414,896],[812,375]]){
  const { page, jsErrors } = await openGame({ width: w, height: h });
  await startTeamMatch(page);
  await page.evaluate(()=>{ for(let i=0;i<3;i++) pushKillFeed('重なり実測用のフィード行 '+i); });  // フィードが伸びた状態で測る
  const m = await page.evaluate(()=>{
    const ids = ['pingBtn','fireBtn','dashBtn','turnLeftBtn','turnRightBtn','joystickBase','movePanel','killFeed','trainCardBar','minimapWrap'];
    const rect = (id)=>{ const el=document.getElementById(id); if(!el || el.classList.contains('hidden') || !el.offsetParent) return null;
      const r=el.getBoundingClientRect(); return { id, x:r.x, y:r.y, w:r.width, h:r.height }; };
    const rs = ids.map(rect).filter(Boolean);
    const ping = rs.find(r=>r.id==='pingBtn');
    const app = document.getElementById('appRoot').getBoundingClientRect();
    const overlaps = [];
    if(ping){
      for(const r of rs){
        if(r.id==='pingBtn') continue;
        const ox = Math.max(0, Math.min(ping.x+ping.w, r.x+r.w) - Math.max(ping.x, r.x));
        const oy = Math.max(0, Math.min(ping.y+ping.h, r.y+r.h) - Math.max(ping.y, r.y));
        if(ox>0 && oy>0) overlaps.push(`${r.id}(${Math.round(ox)}x${Math.round(oy)})`);
      }
    }
    const inApp = ping && ping.x>=app.x-1 && ping.y>=app.y-1 &&
      ping.x+ping.w<=app.x+app.width+1 && ping.y+ping.h<=app.y+app.height+1;
    const fs = ping ? getComputedStyle(document.querySelector('#pingBtn .btn-label')).fontSize : null;
    return { ping: ping && { x:Math.round(ping.x), y:Math.round(ping.y), w:Math.round(ping.w), h:Math.round(ping.h) },
      overlaps, inApp, fontSize: fs, narrow: document.documentElement.classList.contains('narrow-screen') };
  });
  check(`${w}x${h}: ピンボタン表示+重なりなし+#appRoot内`,
    !!m.ping && m.overlaps.length===0 && m.inApp,
    `pos=${JSON.stringify(m.ping)} narrow=${m.narrow} overlap=[${m.overlaps.join(',')}]`);
  check(`${w}x${h}: JSエラーなし`, jsErrors.length===0, jsErrors.join(' / ') || undefined);
  if(w===375 && h===667) await page.screenshot({ path: `${SHOT_DIR}/portrait_375x667.png` });
  if(w===812) await page.screenshot({ path: `${SHOT_DIR}/landscape_812x375.png` });
  await page.close();
}

await browser.close();
server.close();
console.log(failCount===0 ? '\n全チェック合格' : `\n${failCount}件失敗`);
process.exit(failCount===0 ? 0 : 1);
