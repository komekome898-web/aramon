/* チーム戦にゴースト(他の人が育てたマスモン)を混ぜたときの検証。
   使い方: node tools/ghost_team_test.mjs

   ゲーム本体(index.html)をそのまま読み込み、**Firebaseの入口だけを差し替えて**
   「ホストが組んだ試合」と「ゲストが組んだ試合」を別々のページで作り、突き合わせる。

   ここで見たいのは1点だけ ―― **ホストとゲストで試合の中身が1つも食い違わないこと。**
   ゴーストは各自が引きに行くと相手も強さもバラバラになるので、ホストが選んで
   部屋のシードに載せて配る形にしてある。その仕組みが効いているかを、
   **ゲスト側のゴーストの持ち合わせを空にした状態**で確かめる(空でも同じ相手が出れば、
   ホストの配信だけで組み立てられている証拠)。
   あわせて、ゴーストが**人間のいるチームに入っていない**(=誰から見ても敵)ことも見る。

   遊び心地の確認ではない(それは発注者がiPhone実機で行う)。 */
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
  // team_test.mjs と同じ探し方。ARAMON_TOOL_MODULES で場所を渡すこともできる
  for(const base of [process.env.ARAMON_TOOL_MODULES, '/opt/node22/lib/node_modules/',
                     '/usr/lib/node_modules/', '/usr/local/lib/node_modules/']){
    if(!base) continue;
    try { ({ chromium } = createRequire(base.endsWith('/')?base:base+'/')('playwright')); break; } catch {}
  }
}
if(!chromium){ console.error('playwrightが見つかりません(npm i -g playwright)。'); process.exit(1); }

const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
               '.webp':'image/webp', '.mp3':'audio/mpeg', '.m4a':'audio/mp4', '.mp4':'video/mp4', '.webm':'video/webm' };
const server = http.createServer((req, res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if(rel === 'sw.js'){ res.writeHead(404); res.end('no sw in test'); return; }   // 読み込み直しでテストが壊れる
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

/* 1試合を組み立てて、できたエンティティの一覧を返す。
   ホスト役は自分でシードを作って「配信」し(published に控える)、
   ゲスト役はその中身だけを受け取って同じ試合を組む ―― 本番とまったく同じ経路。 */
async function buildMatch({ asHost, meta, ghosts }){
  const page = await browser.newPage({ viewport:{width:844,height:390}, deviceScaleFactor:1, isMobile:true, hasTouch:true });
  const errs = [];
  page.on('pageerror', e=> errs.push(String(e).slice(0,160)));
  await page.addInitScript(()=>{
    try{ localStorage.setItem('aramon_tutorial_v1', JSON.stringify({state:'done',step:'finish',gachaUsed:true})); }catch(e){}
  });
  await page.goto(`${ORIGIN}/index.html`, { waitUntil:'load' });
  await page.waitForFunction(()=> typeof beginMultiplayerMatchInner==='function', null, { timeout:30000 });
  const out = await page.evaluate(async ({asHost, meta, ghosts})=>{
    window.requestAnimationFrame = function(){ return 0; };   // ループは回さない(組み立てだけを見る)
    for(const k of ['playSe','playBgm','stopBgm','playMoveSe']){ if(typeof window[k]==='function') window[k]=function(){}; }
    // --- 通信の入口を差し替える(実際の通信はしない) ---
    let published = null;
    window.__aramonSetRoomSeed = async (roomId, seed, fixedPlayers, mapKey, hostMastermonBots, world, teamSize, sub, ghostBots)=>{
      published = { seed, fixedPlayers, mapKey, hostMastermonBots:hostMastermonBots||[], world, teamSize, sub, ghostBots:ghostBots||[] };
    };
    window.__aramonWaitForRoomSeed = async ()=> meta;
    const noop = ()=>{};
    ['__aramonWatchInputs','__aramonWatchEvents','__aramonWatchHitsAsHost','__aramonWatchFireEvents',
     '__aramonWatchAuthState','__aramonWatchShotEvents','__aramonWatchLootEvents'].forEach(k=> window[k]=noop);
    window.__aramonClearMatchListeners = noop;
    window.__aramonClearRoomTransient = async ()=>{};
    window.__aramonPublishState = async ()=>{}; window.__aramonPushEvent = async ()=>{};
    window.__aramonCleanupLobbyEntry = noop;
    window.NetTransport = null;
    // 他の人のマスモン(ゴースト)の持ち合わせ。ゲスト役は空で渡す
    ghostCache.at = Date.now(); ghostCache.list = ghosts;
    // 自分のマスモンを1体だけ用意して選んでおく
    const mm = { name:'テスト', element:'fire', level:40, exp:0,
                 stats:{ life:300, power:300, wisdom:300, accuracy:300, evasion:300, vitality:300 } };
    localStorage.setItem('aramon_mastermons_v1', JSON.stringify({ fire: mm }));
    game.selectedElement='fire'; game.selectedMastermonKey='fire'; game.selectedMap='wild'; game.realMapMode=false;
    // 部屋: 3人1組×20チーム(=60体)。人間はホストとゲストの2人で同じ小隊
    netState.mode='multi'; netState.roomId='TEST'; netState.isHost=!!asHost;
    netState.myPlayerId = asHost ? 'aaaa' : 'bbbb';
    netState.hostId = 'aaaa';
    netState.capacity = 60; netState.teamSize = 3; netState.sub = 'br20'; netState.raid = false;
    netState.humanPlayers = { aaaa:{ name:'ホスト', element:'fire', skin:null, mm:null, mmLevel:40 },
                              bbbb:{ name:'ゲスト', element:'aqua', skin:null, mm:null, mmLevel:40 } };
    game.started = false; matchBeginning = false;
    await beginMultiplayerMatchInner();
    const list = entities.map(e=>({ id:e.id, el:e.element, name:e.name, team:e.teamId,
      ghost:e.ghostOwner||null, mmBot:!!e.isMastermonBot, hp:Math.round(e.maxHp),
      x:Math.round(e.x), y:Math.round(e.y) }));
    return { list, published };
  }, { asHost, meta, ghosts });
  await page.close();
  return { ...out, errs };
}

// 3人ぶんのゴースト(持ち主が別々)。同じ人から2体出さない決まりも一緒に効く
const GHOSTS = [
  { key:'k1', owner:'たろう', list:[{ name:'ゴーストA', element:'aqua',  level:42, stats:{life:280,power:280,wisdom:280,accuracy:280,evasion:280,vitality:280}, apt:{}, rebirth:0, skin:null }] },
  { key:'k2', owner:'はなこ', list:[{ name:'ゴーストB', element:'leaf',  level:38, stats:{life:260,power:260,wisdom:260,accuracy:260,evasion:260,vitality:260}, apt:{}, rebirth:0, skin:null }] },
  { key:'k3', owner:'じろう', list:[{ name:'ゴーストC', element:'spark', level:45, stats:{life:300,power:300,wisdom:300,accuracy:300,evasion:300,vitality:300}, apt:{}, rebirth:0, skin:null }] },
];

const host = await buildMatch({ asHost:true, meta:null, ghosts:GHOSTS });
if(host.errs.length) console.log('ホスト側のエラー:', host.errs.join(' / '));
const meta = host.published;
console.log(`ホストが配ったゴースト: ${meta.ghostBots.length}体  [${meta.ghostBots.map(g=>`${g.owner}の${g.name}`).join(', ')}]`);

// ゲストは**ゴーストの持ち合わせを空**にして、ホストの配信だけで同じ試合を組む
const guest = await buildMatch({ asHost:false, meta, ghosts:[] });
if(guest.errs.length) console.log('ゲスト側のエラー:', guest.errs.join(' / '));

const H = host.list, G = guest.list;
let diff = 0;
if(H.length !== G.length){ console.log(`⚠ 体数が違う ホスト${H.length} / ゲスト${G.length}`); diff++; }
for(let i=0;i<Math.min(H.length,G.length);i++){
  for(const k of ['id','el','name','team','ghost','mmBot','hp','x','y']){
    if(String(H[i][k]) !== String(G[i][k])){
      if(diff < 6) console.log(`⚠ ${i}体目の${k}が違う: ${H[i][k]} / ${G[i][k]}`);
      diff++;
    }
  }
}
const ghostEnts = H.filter(e=> e.ghost);
const humanTeams = new Set(H.filter(e=> e.name==='ホスト' || e.name==='ゲスト').map(e=>e.team));
const onHumanTeam = ghostEnts.filter(e=> humanTeams.has(e.team));
console.log(`ゴーストの参戦: ${ghostEnts.length}体  [${ghostEnts.map(e=>`${e.ghost}の${e.name}(部隊${e.team})`).join(', ')}]`);
console.log(`人間のいる部隊: ${[...humanTeams].join(',')} / そこへ入ったゴースト: ${onHumanTeam.length}体`);
console.log(`総勢: ${H.length}体 / 部隊数: ${new Set(H.map(e=>e.team)).size}`);

const ok = diff===0 && ghostEnts.length===meta.ghostBots.length && ghostEnts.length>0
        && onHumanTeam.length===0 && !host.errs.length && !guest.errs.length;
console.log(ok ? '\n== ホストとゲストで完全に一致・ゴーストは全員が敵チーム =='
               : `\n⚠ 不一致 ${diff}件(ゴースト${ghostEnts.length}体・味方側${onHumanTeam.length}体)`);
await browser.close();
server.close();
process.exit(ok ? 0 : 1);
