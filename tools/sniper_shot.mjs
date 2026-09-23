/* 狙撃銃とスコープ(sniper.js)の見た目をヘッドレスChromiumで撮る開発用ツール。
   ゲームの遊びを確かめるものではなく、「構え・スコープの画・揺れ・命中の手応えがどう見えるか」を
   毎回同じ条件で画像に落として比べるためのもの(ゲーム本体には読み込まない)。

   使い方:
     PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/sniper_shot.mjs --out shots/sniper
     node tools/sniper_shot.mjs --out shots/sniper --map wild --sizes 1624x750,375x812 --shots hud,x8

   撮るもの(--shots で絞れる):
     hud    … 構えていない普段のHUD(狙撃ボタン・残弾と倍率の札)
     iron / x2 / x4 / x8 … それぞれのスコープで遠くの的を覗いた構え
     breath … 8倍で息を止めている最中(息のゲージ)
     muzzle … 撃った瞬間(反動の跳ね上がり・閃光・硝煙)
     target … 8倍で250m先の的の頭に落下補正して撃ち、命中した直後(クリティカル・数字)
     tracer … 撃った直後の弾道の光の筋
   375x812 のような縦長は「縦持ち=強制横向き」(#appRoot が90度回る)で撮れる。

   出力: <out>/<size>_<shot>.png と <out>/report.json */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
if(!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

let chromium = null;
try { ({ chromium } = await import('playwright')); }
catch {
  for(const base of ['/opt/node22/lib/node_modules/', '/usr/lib/node_modules/', '/usr/local/lib/node_modules/']){
    try { ({ chromium } = createRequire(base)('playwright')); break; } catch {}
  }
}
if(!chromium){ console.error('playwrightが見つかりません(npm i -g playwright)。'); process.exit(1); }

const args = process.argv.slice(2);
const opt = (name, def)=>{ const i = args.indexOf('--'+name); return i>=0 && args[i+1] ? args[i+1] : def; };
const OUT = path.resolve(opt('out', path.join(ROOT, 'shots', 'sniper')));
const MAP = opt('map', 'wild');
const SEED = parseInt(opt('seed', '20260923'), 10);
const SIZES = opt('sizes', '1624x750,375x667,375x812,414x896').split(',').map(s=> s.split('x').map(Number));
const SHOTS = opt('shots', 'hud,iron,x2,x4,x8,breath,muzzle,tracer,target').split(',').map(s=>s.trim()).filter(Boolean);
fs.mkdirSync(OUT, { recursive:true });

const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
               '.webp':'image/webp', '.mp3':'audio/mpeg', '.mp4':'video/mp4', '.webm':'video/webm', '.svg':'image/svg+xml' };
const server = http.createServer((req, res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r=> server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});

/* ページの中で動かす舞台づくり。試合を1つ立ち上げ、開けた場所に自機を置き、
   視線の通る向きに的(bot)を3体(150m / 250m / 320m)並べる。ゲーム自身のフレームループは止め、
   こちらから render() を呼んで撮る(手で作った状態を次のフレームが上書きしないように)。 */
const STAGE = `(function(){
  const api = {};
  api.setup = function(o){
    let s = (o.seed>>>0)||1;
    Math.random = function(){ s = (s*1664525 + 1013904223)>>>0; return s/4294967296; };
    window.requestAnimationFrame = function(){ return 0; };
    for(const k of ['playSe','playBgm','stopBgm','bgmSetTrack']){ try{ if(typeof window[k]==='function') window[k] = function(){}; }catch(e){} }
    window.updateBotAI = function(){};
    game.selectedElement = 'fire';
    game.selectedMastermonKey = null;
    game.selectedMap = o.map; game.realMapMode = true;
    startGame({});
    if(typeof endSummonIntro === 'function') endSummonIntro();
    introState.active = false; introState.timer = 0;
    for(const id of ['titleScreen','startScreen','resultScreen','lobbyScreen','roomListScreen','howToPlayScreen',
                     'mastermonScreen','monsterListScreen','myStatsScreen','rankingScreen','adminPassScreen','adminScreen']){
      const el = document.getElementById(id); if(el) el.style.display = 'none';
    }
    const me = player;
    entities.length = 0; entities.push(me);
    const gz = (x,y)=> getTerrainHeightAt(x,y);
    const clearAt = (x,y,r)=>{
      if(x<700||y<700||x>WORLD.w-700||y>WORLD.h-700) return false;
      for(const q of rocks) if(Math.hypot(x-q.x,y-q.y) < q.radius + r) return false;
      for(const v of volcanoObstacles) if(Math.hypot(x-v.x,y-v.y) < (v.radius||0) + r + 200) return false;
      for(const z of (lavaZones||[]).concat(seaZones||[], riverZones||[], oasisZones||[])) if(Math.hypot(x-z.x,y-z.y) < (z.radius||z.r||0) + r) return false;
      return true;
    };
    // 視線(目の高さ→的の胸)が地形に遮られないか
    const losClear = (x0,y0,z0,x1,y1,z1)=>{
      const n = 60;
      for(let i=1;i<n;i++){ const t=i/n; if(z0+(z1-z0)*t < gz(x0+(x1-x0)*t, y0+(y1-y0)*t) + 6) return false; }
      for(const q of rocks){
        const dx=x1-x0, dy=y1-y0, L=Math.hypot(dx,dy); const t=clamp(((q.x-x0)*dx+(q.y-y0)*dy)/(L*L),0,1);
        if(Math.hypot(x0+dx*t-q.x, y0+dy*t-q.y) < q.radius+30) return false;
      }
      return true;
    };
    const DISTS = [1500, 2500, 3200];
    let best = null;
    for(let ring=0; ring<=16 && !best; ring++){
      for(let k=0;k<12 && !best;k++){
        const a0=(k/12)*Math.PI*2, d0=ring*420;
        const x = WORLD.w*0.5 + Math.cos(a0)*d0, y = WORLD.h*0.5 + Math.sin(a0)*d0;
        if(!clearAt(x,y,300)) continue;
        for(let j=0;j<24;j++){
          const a=(j/24)*Math.PI*2, eyeZ = gz(x,y)+AIM_MUZZLE_Z;
          let ok = true;
          for(const d of DISTS){
            const tx=x+Math.cos(a)*d, ty=y+Math.sin(a)*d;
            if(!clearAt(tx,ty,80)){ ok=false; break; }
            if(!losClear(x,y,eyeZ, tx,ty, gz(tx,ty)+40)){ ok=false; break; }
          }
          if(ok){ best={x,y,a}; break; }
        }
      }
    }
    if(!best) best = { x:WORLD.w*0.5, y:WORLD.h*0.5, a:0 };
    me.x = best.x; me.y = best.y; me.z = gz(me.x, me.y); me.facingAngle = best.a;
    me.hp = me.maxHp; me.alive = true;
    const els = ['rock','aqua','mocchi'];
    api.tgts = DISTS.map((d,i)=>{
      const tx = me.x+Math.cos(best.a+(i-1)*0.018)*d, ty = me.y+Math.sin(best.a+(i-1)*0.018)*d;
      const t = createMonster(els[i] in ELEMENTS ? els[i] : 'fire', false, ['まと150','まと250','まと320'][i], { spawnPoint:{x:tx,y:ty} });
      t.x=tx; t.y=ty; t.z=gz(tx,ty); t.hp=t.maxHp=9999; t.alive=true; t.fireCooldown=9999;
      t.weakPoint = { from:0.6 };   // 頭側の弱点(ボス担当が付ける形と同じ)
      entities.push(t);
      return t;
    });
    zoneState.center = { x:me.x, y:me.y }; zoneState.radius = 99999; zoneState.toRadius = 99999; zoneState.shrinking=false; zoneState.hasNext=false;
    lootItems.length = 0; projectiles.length = 0; areaEffects.length = 0; particles.length = 0;
    camState.yaw = best.a; camState.pitch = 0.1;
    const r = window.__aramonSniperDemo({ weapon:'longbow', scope:'x8' });
    return { ok: !!(r && r.ok), at:[Math.round(me.x), Math.round(me.y)], yaw:+best.a.toFixed(2), vw:viewW, vh:viewH,
             forced: document.documentElement.classList.contains('force-landscape') };
  };
  // 的の高さ ratio(0=足元〜1=頭のてっぺん)を照準の中心に置く(落下補正なし=視線そのもの)
  api.aimAt = function(i, ratio){
    const t = api.tgts[i], me = player;
    const H = sniperBodyH(t), eyeZ = me.z + AIM_MUZZLE_Z;
    const d = Math.hypot(t.x-me.x, t.y-me.y);
    camState.yaw = Math.atan2(t.y-me.y, t.x-me.x);
    camState.pitch = -Math.atan2((t.z + H*ratio) - eyeZ, d);
    return d;
  };
  // 落下を見越して、弾がちょうど的の ratio の高さに届く向きへ(はしごの目盛りで狙った状態)
  api.aimBallistic = function(i, ratio){
    const t = api.tgts[i], me = player, w = SNIPER_WEAPONS[player.sniper.weapon];
    const b = sniperBallistics(w), H = sniperBodyH(t), eyeZ = me.z + AIM_MUZZLE_Z;
    const d = Math.hypot(t.x-me.x, t.y-me.y), tt = d / w.speed;
    const slope = ((t.z + H*ratio) - eyeZ + 0.5*b.grav*tt*tt) / d;
    camState.yaw = Math.atan2(t.y-me.y, t.x-me.x);
    camState.pitch = Math.atan(b.zero - slope);
    return d;
  };
  api.scope = function(key, ads, swayT, amp){
    sniperAttachScope(player, key);
    sniperView.ads = !!ads; sniperView.blend = ads ? 1 : 0;
    sniperView.logMag = ads ? Math.log(SNIPER_SCOPES[key].mag) : 0;
    sniperView.swayT = swayT||0;
    const w = SNIPER_WEAPONS[player.sniper.weapon];
    sniperView.amp = (amp!=null) ? amp : w.sway * SNIPER_SCOPES[key].sway;
    sniperView.breath = 1; sniperView.spent = false; sniperView.breathHeld = false; sniperView.holding = false;
    sniperView.recoil = sniperView.recoilV = sniperView.recoilX = sniperView.recoilXV = 0;
    sniperView.fx.length = 0; sniperView.smoke.length = 0; sniperView.flash = 0;
    projectiles.length = 0; particles.length = 0;
    player.sniper.ammo = SNIPER_WEAPONS[player.sniper.weapon].mag - (api.shotsFired||0);
    player.sniper.cycleLeft = 0; player.sniper.reloadLeft = 0;
  };
  api.draw = function(dtMs){
    updateCamera(0);
    sniperView.lastMs = performance.now() - (dtMs||0);   // dtMs を渡すとその時間だけ揺れ・反動・閃光が進む
    render();
    // 描画の最中に2Dと3Dが読んだ視野角(一致していること)。描き終わると倍率は1へ戻る
    return { mag:+Math.exp(sniperView.logMag).toFixed(2), fov2d:+(sniperView.fov2d||0).toFixed(3), fov3d:+(sniperView.fov3d||0).toFixed(3),
             after:+(window.__aramonLook.fovDeg).toFixed(2), aim: sniperView.aim ? { m: sniperView.aim.m && Math.round(sniperView.aim.m), ent: sniperView.aim.ent ? sniperView.aim.ent.name : null } : null };
  };
  // 実際に撃って弾を進める(update を回す。的はAIを止めてあるので動かない)
  api.fireAndStep = function(sec, stopAtHit){
    sniperFire(player);
    const n = Math.round(sec*60);
    let hit = null;
    for(let i=0;i<n;i++){
      update(1/60);
      if(stopAtHit && sniperView.fx.length){ hit = sniperView.fx[0]; break; }
    }
    return { hit: hit ? { dmg:hit.dmg, crit:hit.crit, kind:hit.kind } : null, proj: projectiles.length };
  };
  /* HUDの実寸(強制横向きでは画面の縦横が入れ替わるので、#appRoot の中の論理座標へ直して比べる)。
     狙撃のボタン・札が他の操作と重なっていないか / #appRoot の外へ出ていないかを数字で返す。 */
  api.rects = function(){
    const root = document.getElementById('appRoot').getBoundingClientRect();
    const forced = document.documentElement.classList.contains('force-landscape');
    const L = (r)=> forced
      ? { x: r.top - root.top, y: root.right - r.right, w: r.height, h: r.width }
      : { x: r.left - root.left, y: r.top - root.top, w: r.width, h: r.height };
    const ids = ['sniperAdsBtn','sniperAmmoChip','sniperBreathBtn','fireBtn','dashBtn','turnLeftBtn','turnRightBtn',
                 'joystickBase','movePanel','killFeed','minimapWrap','hpPanel','trainCardBar'];
    const out = {}, vis = {};
    for(const id of ids){
      const el = document.getElementById(id); if(!el) continue;
      const cs = getComputedStyle(el);
      if(el.classList.contains('hidden') || cs.display==='none' || cs.visibility==='hidden') continue;
      const r = el.getBoundingClientRect(); if(!r.width) continue;
      vis[id] = L(r); out[id] = Object.fromEntries(Object.entries(vis[id]).map(([k,v])=>[k,Math.round(v)]));
    }
    const W = forced ? root.height : root.width, H = forced ? root.width : root.height;
    const over = [], outside = [];
    const mine = ['sniperAdsBtn','sniperAmmoChip','sniperBreathBtn'];
    for(const a of mine){
      const A = vis[a]; if(!A) continue;
      if(A.x < -0.5 || A.y < -0.5 || A.x+A.w > W+0.5 || A.y+A.h > H+0.5) outside.push(a);
      for(const b of Object.keys(vis)){
        if(a===b || (mine.includes(b) && b < a)) continue;
        const B = vis[b];
        const ix = Math.min(A.x+A.w, B.x+B.w) - Math.max(A.x, B.x), iy = Math.min(A.y+A.h, B.y+B.h) - Math.max(A.y, B.y);
        if(ix > 0.5 && iy > 0.5) over.push(a+'×'+b+' '+Math.round(ix)+'x'+Math.round(iy));
      }
    }
    return { forced, app:[Math.round(W), Math.round(H)], over, outside, rects:out };
  };
  api.state = function(){ return { ammo: player.sniper.ammo, breath: sniperView.breath, holding: sniperView.holding, fx: sniperView.fx.map(f=>f.kind) }; };
  window.__snShot = api;
})();`;

const report = { seed:SEED, map:MAP, shots:[], errors:[] };
for(const [W, H] of SIZES){
  const ctx = await browser.newContext({ viewport:{ width:W, height:H }, screen:{ width:W, height:H }, deviceScaleFactor:1, serviceWorkers:'block' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.on('pageerror', e=> report.errors.push(`${W}x${H} PAGEERR ${String(e).split('\n')[0]}`));
  page.on('console', m=>{ if(m.type()==='error') report.errors.push(`${W}x${H} CONSOLE ${m.text().slice(0,160)}`); });
  await page.route('**://fonts.googleapis.com/**', r=> r.abort());
  await page.route('**://fonts.gstatic.com/**',   r=> r.abort());
  await page.route('**://www.gstatic.com/**',     r=> r.abort());
  await page.goto(`${ORIGIN}/index.html?harness=1`, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(()=> typeof startGame === 'function' && typeof sniperFrame === 'function', null, { timeout:30000 });
  await page.waitForTimeout(1500);
  await page.evaluate(STAGE);
  const setup = await page.evaluate(([m, s])=> window.__snShot.setup({ map:m, seed:s }), [MAP, SEED]);
  report.shots.push({ size:`${W}x${H}`, setup });
  await page.waitForFunction(()=> window.__aramonReal3D && window.__aramonReal3D.isActive && window.__aramonReal3D.isActive(), null, { timeout:30000 }).catch(()=>{});
  // 捨てコマ(最初の数回は地形の生成と2Dの初回で黒くなる)
  for(let i=0;i<3;i++){ await page.evaluate(()=> window.__snShot.draw()); await page.waitForTimeout(150); }
  const tag = `${W}x${H}`;
  const shoot = async (name, fn, dtMs)=>{
    if(!SHOTS.includes(name)) return;
    const info = await page.evaluate(fn);
    await page.evaluate(()=> window.__snShot.draw());
    await page.waitForTimeout(120);
    const d = await page.evaluate((ms)=> window.__snShot.draw(ms), dtMs||0);
    await page.waitForTimeout(80);
    const file = path.join(OUT, `${tag}_${name}.png`);
    await page.screenshot({ path:file });
    const rects = await page.evaluate(()=> window.__snShot.rects());
    report.shots.push({ size:tag, shot:name, file:path.relative(ROOT, file), info, draw:d, hud:rects });
    console.log(`撮影 ${tag}_${name}`, JSON.stringify(d), `重なり${rects.over.length} はみ出し${rects.outside.length}`,
                rects.over.concat(rects.outside).join(' / '));
  };
  await shoot('hud',    ()=>{ const s=window.__snShot; s.scope('x8', false); s.aimAt(0, 0.5); camState.pitch = 0.12; return null; });
  await shoot('iron',   ()=>{ const s=window.__snShot; s.scope('iron', true, 0.3); return s.aimAt(0, 0.7); });
  await shoot('x2',     ()=>{ const s=window.__snShot; s.scope('x2', true, 0.3); return s.aimAt(0, 0.7); });
  await shoot('x4',     ()=>{ const s=window.__snShot; s.scope('x4', true, 0.9); return s.aimAt(1, 0.7); });
  await shoot('x8',     ()=>{ const s=window.__snShot; s.scope('x8', true, 1.6); return s.aimAt(1, 0.7); });
  await shoot('breath', ()=>{ const s=window.__snShot; s.scope('x8', true, 1.6, 0.0003);
                               sniperView.breathHeld = true; sniperView.holding = true; sniperView.breath = 0.55; return s.aimAt(2, 0.75); });
  // 撃った瞬間(45ms後): 反動で跳ね上がった視界・レンズ下の閃光・硝煙
  await shoot('muzzle', ()=>{ const s=window.__snShot; s.scope('x8', true, 0, 0); s.aimBallistic(1, 0.82);
                               sniperFire(player); for(let i=0;i<3;i++) update(1/60); return s.state(); }, 45);
  await shoot('tracer', ()=>{ const s=window.__snShot; s.scope('x8', true, 0, 0); s.aimBallistic(2, 0.8);
                               sniperFire(player); for(let i=0;i<34;i++) update(1/60);
                               sniperView.flash = 0; sniperView.smoke.forEach(q=> q.t = Math.min(q.life*0.8, q.t + 0.4)); return s.state(); });
  // 250mの的の頭へ、はしごの目盛りで落下を見越して撃った直後(当たりの数字が浮き始めたところ)
  await shoot('target', ()=>{ const s=window.__snShot; s.scope('x8', true, 0, 0); s.aimBallistic(1, 0.82);
                               const r = s.fireAndStep(1.4, true); for(let i=0;i<9;i++) update(1/60);
                               sniperView.fx.forEach(f=> f.t += 0.15); sniperView.flash = 0; sniperView.smoke.length = 0; return r; });
  await ctx.close();
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
server.close();
console.log(`\n出力: ${OUT}`);
if(report.errors.length){ console.log('エラー:'); for(const e of report.errors.slice(0, 15)) console.log('  ' + e); }
