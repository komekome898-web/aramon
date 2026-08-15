/* 技エフェクトをヘッドレスChromiumで決まった条件でコマ撮りする開発用ツール。
   ゲーム本体には読み込まない(tools/以下は本番に含めない)。

   なぜ要るか:
     技エフェクトの良し悪しは数字では判定できない。「撃った瞬間・伸びきり・着弾・余韻」を
     毎回まったく同じ条件で画像に落とせて初めて、前後の比較と第三者の批評ができる。

   使い方:
     node tools/fx_shot.mjs --out shots/fx_base                 全属性×tier1-3
     node tools/fx_shot.mjs --out shots/x --moves fire:3,aqua:3 技を絞る
     node tools/fx_shot.mjs --out shots/x --map wild_real       リアルマップで撮る
     node tools/fx_shot.mjs --out shots/x --frames 0.06,0.2,0.5 撮る時刻(発射からの秒)
     node tools/fx_shot.mjs --out shots/x --contact             着弾の瞬間だけを撮る
     node tools/fx_shot.mjs --out shots/x --sheet               1技を1枚の連番シートにまとめる

   出力: <out>/<element>_t<tier>_<秒>.png と <out>/report.json

   決まりごと:
     ・Math.random をシード付きに差し替えるので、何度撮っても同じ絵になる
     ・update(dt) を固定dtで手回しする(実時間に依存しない)
     ・カメラは技ごとに固定。技の見え方以外の差が画に出ないようにする       */
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
  if(!chromium){
    try { ({ chromium } = await import('playwright-core')); } catch {}
  }
}
if(!chromium){ console.error('playwrightが見つかりません(npm i -g playwright)。'); process.exit(1); }

const args = process.argv.slice(2);
const opt  = (n, d)=>{ const i = args.indexOf('--'+n); return i>=0 && args[i+1] && !args[i+1].startsWith('--') ? args[i+1] : d; };
const flag = (n)=> args.includes('--'+n);

const OUT   = path.resolve(opt('out', path.join(ROOT, 'shots', 'fx')));
const W     = parseInt(opt('w', '1280'), 10);
const H     = parseInt(opt('h', '600'), 10);
const SEED  = parseInt(opt('seed', '20260815'), 10);
const MAP   = opt('map', 'wild');
const EXEC  = opt('chromium', process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium');
const FRAMES = (opt('frames', '0.05,0.18,0.38,0.7')).split(',').map(Number).filter(n=>!isNaN(n));
/* --crop 720x420 : 画面中央のこの大きさだけを切り出す。
   技は画面の中央付近で起きるので、切り出したほうが批評家が形を判定できる
   (全景のままだと技が数十pxにしかならず、「良いか悪いか」を見られない)。 */
const CROP = (()=>{
  const v = opt('crop', '');
  if(!v) return null;
  const m = v.match(/^(\d+)[x,](\d+)$/);
  return m ? { w: parseInt(m[1],10), h: parseInt(m[2],10) } : null;
})();

/* 撮る技。element:tier の並び。省略時は全属性の全tier。 */
const MOVES = opt('moves', '');

fs.mkdirSync(OUT, { recursive:true });

/* ---- リポジトリを配る小さなHTTPサーバ(ESモジュールは file:// から読めない) ---- */
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
               '.webp':'image/webp', '.mp3':'audio/mpeg', '.mp4':'video/mp4', '.webm':'video/webm' };
const server = http.createServer((req, res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
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
  executablePath: fs.existsSync(EXEC) ? EXEC : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
         '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

/* ページ側で動く駆動コード。index.html をそのまま読ませ、ゲーム本体の関数を直接呼ぶ
   (撮影用にワールドや技を作り直さない = 実際の見た目と必ず一致する)。          */
const DRIVER = `(function(){
  function seedRandom(seed){
    let s = (seed>>>0) || 1;
    Math.random = function(){ s = (s*1664525 + 1013904223) >>> 0; return s/4294967296; };
  }
  // 音は鳴らさない(ヘッドレスでは無意味なうえ、AudioContextの生成で時間を食う)
  function muteAudio(){
    try{ window.playSe = function(){}; window.playBgm = function(){}; }catch(e){}
    for(const k of ['playSe','playBgm','stopBgm','playMoveSe']){
      try{ if(typeof window[k] === 'function') window[k] = function(){}; }catch(e){}
    }
  }
  const api = {};
  api.ready = function(){
    return typeof startGame === 'function' && typeof update === 'function'
        && typeof render === 'function' && typeof fireMove === 'function';
  };
  /* 試合を1つ立ち上げ、撮影に邪魔な要素(他のbot・安置ダメージ・HUD)を外す。
     プレイヤーと的1体だけの、毎回同じ舞台を作る。                        */
  api.setup = function(o){
    seedRandom(o.seed);
    muteAudio();
    game.selectedElement = o.element || 'fire';
    game.selectedMastermonKey = null;
    game.selectedMap = (o.mapKey||'wild').replace(/_real$/,'');
    game.realMapMode = /_real$/.test(o.mapKey||'');
    startGame({});
    // 召喚演出(5秒のカウントダウン)は撮影の邪魔なので即座に終わらせる。
    // 消さないとプレイヤーがまだ降下中で、技が円盤石の上から出る。
    if(typeof endSummonIntro === 'function') endSummonIntro();
    if(typeof introState !== 'undefined' && introState){ introState.active = false; introState.timer = 0; }
    // botを全部消し、決まった位置に的を1体だけ置く
    const me = player;
    entities.length = 0;
    entities.push(me);
    me.x = WORLD.w*0.5; me.y = WORLD.h*0.5;
    me.z = (typeof groundZAt==='function') ? groundZAt(me.x, me.y) : 0;
    me.facingAngle = 0; me.hp = me.maxHp; me.guts = me.maxGuts;
    me.alive = true; me.fireCooldown = 0;
    const tgt = createMonster('rock', false, 'まと', { spawnPoint:{ x: me.x + (o.targetDist||760), y: me.y } });
    tgt.x = me.x + (o.targetDist||760); tgt.y = me.y;
    tgt.z = (typeof groundZAt==='function') ? groundZAt(tgt.x, tgt.y) : 0;
    tgt.hp = 99999; tgt.maxHp = 99999; tgt.alive = true;
    tgt.fireCooldown = 9999;          // 的は撃ち返さない
    entities.push(tgt);
    // 安置を十分大きく取り、縮小ダメージが画に混ざらないようにする
    if(typeof zoneState !== 'undefined' && zoneState){
      zoneState.center = { x: me.x, y: me.y };
      zoneState.radius = 99999; zoneState.toRadius = 99999;
      zoneState.shrinking = false; zoneState.hasNext = false;
    }
    lootItems.length = 0; projectiles.length = 0; areaEffects.length = 0; particles.length = 0;
    matchTime = 0;
    // カメラを技が正面に見える位置へ固定する
    camState.yaw = 0;
    camState.pitch = (o.pitch==null) ? 0.16 : o.pitch;
    if(typeof updateCamera === 'function') updateCamera();
    camPos.x = me.x - Math.cos(camState.yaw)*camState.distBehind;
    camPos.y = me.y - Math.sin(camState.yaw)*camState.distBehind;
    camPos.z = me.z + camState.height;
    api._me = me; api._tgt = tgt;
    return { ok:true, x:me.x, y:me.y, map:game.activeMapKey, el:me.element };
  };
  /* 指定tierの技を1発撃つ。撃つのは「プレイヤー本人が撃つ」経路そのもの。 */
  api.fire = function(tier){
    const me = api._me;
    me.moveTierSelected = tier;
    const mv = activeMove(me);
    me.guts = me.maxGuts;
    const aim = mv.melee ? api._tgt
              : { x: me.x + Math.cos(me.facingAngle)*2000, y: me.y + Math.sin(me.facingAngle)*2000 };
    fireMove(me, mv.melee ? api._tgt : aim, mv);
    me.fireCooldown = 9999;   // 連射させない(1発だけを見る)
    return { name: mv.name, tier: mv.tier, aoe: mv.aoeShape||null, style: mv.aoeStyle||mv.projStyle||null };
  };
  /* 固定dtで時間を進める。撃ち返し・再発射は止めてあるので毎回同じ絵になる。 */
  api.step = function(seconds, dt){
    const d = dt || (1/60);
    let n = Math.max(0, Math.round(seconds/d));
    for(let i=0;i<n;i++){
      api._me.guts = api._me.maxGuts;
      update(d);
    }
    return matchTime;
  };
  api.draw = function(){ render(); return { proj: projectiles.length, ae: areaEffects.length, part: particles.length }; };
  /* 画面を「試合中」だけにする。タイトル画面は起動演出のあいだ全面を覆っており、
     タップで消える作りなので startGame() を呼んでも自動では消えない。   */
  api.hideHud = function(){
    for(const id of ['titleScreen','startScreen','resultScreen','lobbyScreen','roomListScreen',
                     'howToPlayScreen','mastermonScreen','monsterListScreen','myStatsScreen',
                     'rankingScreen','adminPassScreen','adminScreen']){
      const el = document.getElementById(id); if(el) el.style.display = 'none';
    }
    const hud = document.getElementById('hud'); if(hud) hud.style.opacity = '0';
    for(const id of ['joystick','fireBtn','dashBtn','crosshair','minimapWrap','tipBox','pingBtn',
                     'rangeBar','rangeHint','squadPanel','killFeed','statusIcons']){
      const el = document.getElementById(id); if(el) el.style.display = 'none';
    }
  };
  window.__fx = api;
})();`;

const ALL_ELEMENTS = ['fire','aqua','leaf','spark','rock','phoenix','ark','warm','illumine','fox','god','zan',
                      'pixie','dullahan','hum','ogre','mocchi','suezo'];

// --moves fire:3,aqua:1  /  --moves fire  (全tier)
function parseMoves(spec, known){
  if(!spec) return known.flatMap(e=> [1,2,3].map(t=> ({ el:e, tier:t })));
  const out = [];
  for(const part of spec.split(',')){
    const [el, t] = part.split(':');
    if(!el) continue;
    if(t) out.push({ el:el.trim(), tier: parseInt(t,10) });
    else [1,2,3].forEach(tt=> out.push({ el:el.trim(), tier:tt }));
  }
  return out;
}

const report = { seed:SEED, map:MAP, size:[W,H], frames:FRAMES, shots:[], errors:[] };
const errors = [];

let page = null;
async function freshPage(){
  if(page) await page.close().catch(()=>{});
  const ctx = await browser.newContext({ viewport:{ width:W, height:H }, deviceScaleFactor:1,
                                         serviceWorkers:'block' });
  page = await ctx.newPage();
  page.on('pageerror', e=> errors.push('PAGEERR '+String(e).split('\n')[0]));
  page.on('console', m=>{ if(m.type()==='error') errors.push('CONSOLE '+m.text().slice(0,160)); });
  // 外部(フォント・Firebase)はヘッドレスでは繋がらない。待ち時間を作らないよう即座に切る
  await page.route('**://fonts.googleapis.com/**', r=> r.abort());
  await page.route('**://fonts.gstatic.com/**',   r=> r.abort());
  await page.route('**://www.gstatic.com/**',     r=> r.abort());
  await page.goto(`${ORIGIN}/index.html`, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(()=> typeof window.startGame === 'function'
    || (typeof startGame === 'function'), null, { timeout:30000 }).catch(()=>{});
  await page.evaluate(DRIVER);
  await page.waitForFunction(()=> window.__fx && window.__fx.ready(), null, { timeout:30000 });
  return page;
}

const targets = parseMoves(MOVES, ALL_ELEMENTS);
// 属性ごとにページを作り直す。1ページの使い回しはWebGLコンテキストが積み上がって落ちる
const byElement = new Map();
for(const t of targets){
  if(!byElement.has(t.el)) byElement.set(t.el, []);
  byElement.get(t.el).push(t.tier);
}

for(const [el, tiers] of byElement){
  for(const tier of tiers){
    try {
      await freshPage();
      const setup = await page.evaluate(([e,m,s])=> window.__fx.setup({ element:e, mapKey:m, seed:s }), [el, MAP, SEED]);
      if(!setup || !setup.ok){ errors.push(`${el}:t${tier} setup失敗`); continue; }
      await page.evaluate(()=> window.__fx.hideHud());
      const info = await page.evaluate((t)=> window.__fx.fire(t), tier);
      let prev = 0;
      for(const at of FRAMES){
        await page.evaluate(([dtSec])=> window.__fx.step(dtSec), [Math.max(0, at - prev)]);
        prev = at;
        const counts = await page.evaluate(()=> window.__fx.draw());
        const file = path.join(OUT, `${el}_t${tier}_${String(at).replace('.','p')}.png`);
        const clip = CROP
          ? { x: Math.max(0, (W-CROP.w)/2|0), y: Math.max(0, (H-CROP.h)/2|0),
              width: Math.min(W, CROP.w), height: Math.min(H, CROP.h) }
          : { x:0, y:0, width:W, height:H };
        await page.screenshot({ path:file, clip });
        report.shots.push({ el, tier, at, move:info.name, style:info.style, counts,
                            file: path.relative(ROOT, file) });
      }
      process.stdout.write(`撮影 ${el} t${tier} ${info.name}\n`);
    } catch(e){
      errors.push(`${el}:t${tier} ${String(e).split('\n')[0]}`);
    }
  }
}

/* --sheet: 1つの技のコマを横1列に並べた1枚を作る。
   批評家に渡すのはこれ。バラのPNGだと「立ち上がり→伸び→着弾→余韻」という
   時間の流れが判定できず、静止画1枚の印象だけで採点されてしまう。          */
if(flag('sheet') && report.shots.length){
  const byMove = new Map();
  for(const s of report.shots){
    const k = `${s.el}_t${s.tier}`;
    if(!byMove.has(k)) byMove.set(k, []);
    byMove.get(k).push(s);
  }
  const sheetPage = await browser.newPage({ viewport:{ width: 1200, height: 400 } });
  for(const [key, shots] of byMove){
    shots.sort((a,b)=> a.at - b.at);
    // 画像はbase64で埋め込む。--out がリポジトリの外(一時ディレクトリ)でも必ず出るようにする
    const cells = shots.map(s=>{
      const abs = path.resolve(ROOT, s.file);
      const b64 = fs.existsSync(abs) ? fs.readFileSync(abs).toString('base64') : '';
      return `<figure><img src="data:image/png;base64,${b64}"><figcaption>${s.at}s</figcaption></figure>`;
    }).join('');
    const html = `<meta charset="utf-8"><style>
      body{margin:0;background:#05070c;color:#e9e6dc;font-family:'Noto Sans JP',sans-serif;padding:14px 16px}
      h2{font-size:15px;margin:0 0 10px;color:#f4c430}
      .row{display:flex;gap:8px}
      figure{margin:0;flex:1 1 0}
      img{width:100%;display:block;border:1px solid rgba(255,255,255,.12)}
      figcaption{font-size:10px;color:#8d97a8;margin-top:3px;text-align:center}
      #wrap{display:inline-block}
      </style><div id="wrap"><h2>${key} — ${shots[0].move}${shots[0].style?' ('+shots[0].style+')':''}</h2>
      <div class="row">${cells}</div></div>`;
    await sheetPage.setContent(html);
    await sheetPage.waitForFunction(()=>[...document.images].every(i=>i.complete), null, { timeout:15000 }).catch(()=>{});
    const el = await sheetPage.$('#wrap');
    await el.screenshot({ path: path.join(OUT, `sheet_${key}.png`) });
  }
  await sheetPage.close();
}

report.errors = errors;
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
server.close();

console.log(`\n出力: ${OUT}  (${report.shots.length}枚)`);
if(errors.length){
  console.log('エラー:');
  for(const e of errors.slice(0, 15)) console.log('  ' + e);
}
