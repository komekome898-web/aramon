/* 探検モードの見た目をヘッドレスChromiumで撮る開発用ツール(ゲーム本体には読み込まない)。
   **ゲームの遊びを確かめるものではない。** 批評家が「探検モードがどう見えるか」を
   毎回同じ条件の画像で採点するための撮影台。

   使い方:
     node tools/explore_shot.mjs --out shots/explore            全カット × 横持ち・縦持ち
     node tools/explore_shot.mjs --out shots/x --cuts camp,wild  カットを絞る
     node tools/explore_shot.mjs --out shots/x --vps land        横持ちだけ(land / port)
     node tools/explore_shot.mjs --list                          カットの一覧を出して終わる
   その他: --seed <数>(配置の乱数。既定 20260923) / --element <属性>(出発するモンスター。既定 fire)

   出力: <out>/<cut>_<vp>.png と <out>/report.json(撮れた枚数・カメラ位置・失敗)

   撮り方の決まり(layout_test.mjs / result_shot.mjs / real3d_shot.mjs と同じ土台):
     ・ローカルにHTTPサーバを立てて index.html を開く。sw.js は404で返す(キャッシュを挟ませない)
     ・screen を viewport と同じ値にする。そうしないと縦持ちで強制横向き(#appRootの90度回転)が効かない
     ・**縦持ちは絵を回して保存する**(実機を手に持ったときに見える向きへ戻す。result_shot と同じ)
     ・試合に入ったらゲーム自身のフレームループ(requestAnimationFrame)を止め、こちらが update()/render() を
       手で回す(tools/fx_driver.js と同じ考え方)。止めないと次のフレームが置き直したカメラを上書きする
     ・波・溶岩の脈動は performance.now() で進むので、描く間だけ時刻を固定する(real3d_probe と同じ)
     ・Math.random はシード付きに差し替える(何度撮っても同じ配置)

   【カットを足すとき】下の CUTS へ1行足すだけ(後続の担当: 狙撃・ボス・HUD がここへ足す)。
     kind:'lobby'  … ロビー側の画。prep(ページ内で実行)で画面を整える
     kind:'field'  … 探検中の画。at(ページ内で実行)が { x, y, yaw, pitch, warm } を返す
                     warm = 撮る前に update() を回す秒数(野生が気づいて寄ってくる等を写すため)
     kind:'result' … 結果画面。prep で素材を拾わせてから exploreFinish を呼ぶ
   prep / at は**ページの中で**文字列から関数に戻して実行する(ゲームの変数へ直接触れる)。 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ===== カットの表(この表が正。1行足せば1カット増える) ===== */
const CUTS = [
  { name:'lobby', kind:'lobby', desc:'ロビー(プレイモード=探検・右下が「探検へ出発」)',
    prep: ()=>{ setLobbyMode('explore', { save:false }); refreshLobby(); } },
  { name:'lobby_mode', kind:'lobby', desc:'プレイモード選択で探検を選んだ状態',
    prep: ()=>{ setLobbyMode('explore', { save:false }); refreshLobby(); lobbyOpenOverlay('modePickOverlay'); } },
  { name:'camp', kind:'field', desc:'ベースキャンプの出発地点から帰還ビーコン側を見渡す',
    at: ()=>{ const s = exploreState.spawn, b = exploreState.beacon;
              return { x:s.x, y:s.y, yaw:Math.atan2(b.y-s.y, b.x-s.x), pitch:0.14, warm:0.3 }; } },
  { name:'camp_out', kind:'field', desc:'ベースキャンプから外(草原の盆地の方角)を望む',
    at: ()=>{ const s = exploreState.spawn, r = exploreRegionCircle(exploreRegion('meadow'));
              return { x:s.x, y:s.y, yaw:Math.atan2(r.y-s.y, r.x-s.x), pitch:0.08, warm:0.3 }; } },
  // 各地域: 中心の少しキャンプ寄りに立ち、地域の奥(外側)へ向かって見渡す
  ...['meadow','frost','volcano','jungle'].map(id=>({
    name:'field_'+id, kind:'field', desc:`地域「${id}」の中心付近から奥を見渡す`,
    at: new Function(`
      const reg = exploreRegion(${JSON.stringify(id)}); const c = exploreRegionCircle(reg);
      const cx = WORLD.w*EXPLORE_CAMP.xr, cy = WORLD.h*EXPLORE_CAMP.yr;
      const dir = Math.atan2(c.y-cy, c.x-cx);
      const p = clearObstaclePoint(c.x - Math.cos(dir)*c.r*0.45, c.y - Math.sin(dir)*c.r*0.45, 80);
      return { x:p.x, y:p.y, yaw:dir, pitch:0.10, warm:0.3 };`),
  })),
  { name:'wild', kind:'field', desc:'野生モンスターの近く(気づいて寄ってくるところ)',
    at: ()=>{
      const w = exploreState.wild.map(r=>getEntity(r.id)).find(e=> e && e.alive && e.exploreRegion==='meadow')
             || exploreState.wild.map(r=>getEntity(r.id)).find(e=> e && e.alive);
      if(!w) return null;
      const a = Math.atan2(exploreState.camp.y - w.y, exploreState.camp.x - w.x);   // キャンプ側から近づく
      const p = clearObstaclePoint(w.x + Math.cos(a)*520, w.y + Math.sin(a)*520, 60);
      return { x:p.x, y:p.y, yaw:Math.atan2(w.y-p.y, w.x-p.x), pitch:0.12, warm:1.2, lookAt:w.id };
    } },
  { name:'result', kind:'result', desc:'帰還(exploreFinish(\'return\'))後の結果画面',
    prep: ()=>{
      const pick = ['meadow_fiber','meadow_honey','frost_shard','volcano_heart','jungle_relic','boss_horn','apex_core'];
      pick.forEach((k, i)=> exploreGainMaterial(k, 1 + (i*2)%5, null, null));
      exploreState.kills = 12;
      matchTime = 612;
      exploreFinish('return');
    } },
  { name:'result_faint', kind:'result', desc:'力尽き3回で終わった結果画面(持ち帰り半分)',
    prep: ()=>{
      ['meadow_fiber','frost_dew','volcano_ore','jungle_vine'].forEach((k, i)=> exploreGainMaterial(k, 1 + i, null, null));
      exploreState.kills = 5; exploreState.faints = 3;
      matchTime = 431;
      exploreFinish('faint');
    } },
];

/* 撮る画面の大きさ。port は iPhone の縦持ち(=強制横向き)。保存時に横向きへ戻す */
const VIEWPORTS = {
  land: { w:1624, h:750, isMobile:false, dsf:1 },
  port: { w:375,  h:812, isMobile:true,  dsf:2 },
};

/* ===== 引数 ===== */
const args = process.argv.slice(2);
const opt = (name, def)=>{ const i = args.indexOf('--'+name); return i>=0 && args[i+1] ? args[i+1] : def; };
const flag = (name)=> args.includes('--'+name);
if(flag('list')){
  for(const c of CUTS) console.log(`${c.name.padEnd(16)} ${c.kind.padEnd(7)} ${c.desc}`);
  process.exit(0);
}
const OUT = path.resolve(opt('out', path.join(ROOT, 'shots', 'explore')));
const SEED = parseInt(opt('seed', '20260923'), 10);
const ELEMENT = opt('element', 'fire');
const cutNames = opt('cuts', '') ? opt('cuts','').split(',').map(s=>s.trim()).filter(Boolean) : CUTS.map(c=>c.name);
const vpNames  = opt('vps', '')  ? opt('vps','').split(',').map(s=>s.trim()).filter(Boolean)  : Object.keys(VIEWPORTS);
const cuts = cutNames.map(n=>{ const c = CUTS.find(x=>x.name===n); if(!c) console.warn(`知らないカット: ${n}(--list で一覧)`); return c; }).filter(Boolean);
fs.mkdirSync(OUT, { recursive:true });

/* ===== playwright(グローバルでもよい。measure_layout.mjs と同じ探し方) ===== */
let chromium = null;
try { ({ chromium } = await import('playwright')); }
catch {
  for(const b of ['/opt/node22/lib/node_modules/', '/usr/lib/node_modules/', '/usr/local/lib/node_modules/']){
    try { ({ chromium } = createRequire(b)('playwright')); break; } catch {}
  }
}
if(!chromium){ console.error('playwrightが見つかりません(npm i -g playwright)。'); process.exit(1); }

/* ESモジュール(real3d.js)は file:// から読めないので、リポジトリを配る小さなHTTPサーバを立てる */
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
               '.webp':'image/webp', '.mp3':'audio/mpeg', '.mp4':'video/mp4', '.webm':'video/webm' };
const server = http.createServer((req, res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if(rel === 'sw.js'){ res.writeHead(404); res.end('no sw in shot'); return; }
  const file = path.resolve(ROOT, rel);
  if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r=> server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: fs.existsSync('/opt/pw-browsers/chromium') && fs.statSync('/opt/pw-browsers/chromium').isFile()
    ? '/opt/pw-browsers/chromium' : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const report = { seed:SEED, element:ELEMENT, shots:[], errors:[] };

/* 横倒しの絵を「実機で見える向き」へ戻す(result_shot.mjs と同じやり方)。
   #appRoot は rotate(90deg) で描かれているので、逆向きに90度回して上書きする */
async function unrotateShot(file, w, h, dsf){
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  const p = await browser.newPage({ viewport:{ width:h, height:w }, deviceScaleFactor:dsf });
  await p.setContent(`<style>html,body{margin:0;padding:0;background:#000;overflow:hidden}`
    + `img{position:absolute;top:0;left:0;width:${w}px;height:${h}px;`
    + `transform-origin:0 0;transform:translateY(${w}px) rotate(-90deg)}</style>`
    + `<img src="${dataUrl}">`);
  await p.waitForTimeout(120);
  await p.screenshot({ path: file });
  await p.close();
}

/* ===== ページ側の道具(文字列にしてページへ入れる) ===== */
function pageTools(){
  // 決まった配置になるようシード付き乱数へ差し替える
  window.__shotSeed = (seed)=>{
    let s = (seed>>>0) || 1;
    Math.random = function(){ s = (s*1664525 + 1013904223) >>> 0; return s/4294967296; };
  };
  // 撮影に関係ない重なり(ログインボーナス・告知・チュートリアル)を閉じる
  window.__shotCloseOverlays = ()=>{
    document.querySelectorAll('.mastermon-confirm-overlay, #gachaOverlay, #textInputOverlay, #shareOverlay, #ssrPromoteOverlay, #tutorialLayer')
      .forEach(el=>{ if(el.id !== 'exploreResultOverlay') el.classList.add('hidden'); });
  };
  // 音は鳴らさない(ヘッドレスでは無意味なうえ時間を食う)
  window.__shotMute = ()=>{
    for(const k of ['playSe','bgmSetTrack','bgmUpdateBattleIntensity']){
      try{ if(typeof window[k]==='function') window[k] = function(){}; }catch(e){}
    }
  };
  /* 探検を始める。ここから先はゲーム自身のループを止め、update()/render() を手で回す */
  window.__shotStartExplore = (seed, element)=>{
    window.__shotCloseOverlays();
    window.requestAnimationFrame = function(){ return 0; };
    window.__shotSeed(seed);
    window.__shotMute();
    game.selectedElement = element; game.selectedMastermonKey = null;
    exploreStart();
    return { ok: !!game.explore, map: game.activeMapKey, wild: exploreState.wild.length,
             real3d: !!(window.__aramonReal3D), camp: exploreState.camp };
  };
  /* 1カットぶんの舞台を整える。プレイヤーを置き、warm 秒だけ時間を進め、カメラを据えて描く */
  window.__shotField = (atSrc)=>{
    const at = (new Function('return (' + atSrc + ')'))()();
    if(!at) return { ok:false, reason:'そのカットの対象が無い' };
    player.x = at.x; player.y = at.y; player.z = baseTerrainHeightAt(at.x, at.y);
    player.hp = player.maxHp; player.alive = true;
    player.exploreInvulnUntil = matchTime + 99;   // 撮影中に倒れないように(見た目には出ない)
    camState.yaw = at.yaw; camState.pitch = at.pitch;
    player.facingAngle = at.yaw;
    const steps = Math.round((at.warm || 0) * 30);
    for(let i=0;i<steps;i++){
      if(game.over) break;
      camState.yaw = at.yaw; camState.pitch = at.pitch;
      update(1/30);
      // 野生の近くを撮るときは相手を画面に入れ続ける(寄ってくるので向きを追い直す)
      if(at.lookAt!=null){ const t = getEntity(at.lookAt); if(t) at.yaw = Math.atan2(t.y-player.y, t.x-player.x); }
      player.x = at.x; player.y = at.y;
    }
    camState.yaw = at.yaw; camState.pitch = at.pitch;
    camSnap.active = false;
    updateCamera();
    const realNow = performance.now.bind(performance);
    performance.now = ()=> 1234.5;
    try{ for(let i=0;i<3;i++) render(); }
    finally{ performance.now = realNow; }
    const reg = exploreRegionAt(player.x, player.y);
    return { ok:true, x:Math.round(player.x), y:Math.round(player.y), yaw:+at.yaw.toFixed(3), pitch:at.pitch,
             region: reg ? reg.id : null, alive: entities.filter(e=>e.alive).length };
  };
}

async function shoot(page, file, vp){
  await page.screenshot({ path:file });
  if(vp.isMobile) await unrotateShot(file, vp.w, vp.h, vp.dsf);
}

for(const vpName of vpNames){
  const vp = VIEWPORTS[vpName];
  if(!vp){ console.warn(`知らない画面: ${vpName}`); continue; }
  const page = await browser.newPage({
    viewport:{ width:vp.w, height:vp.h }, screen:{ width:vp.w, height:vp.h },
    deviceScaleFactor:vp.dsf, isMobile:vp.isMobile, hasTouch:vp.isMobile,
  });
  const errs = [];
  page.on('pageerror', e=> errs.push(String(e)));
  await page.addInitScript(()=>{
    try{ localStorage.setItem('aramon_tutorial_v1', JSON.stringify({ state:'done' })); }catch(e){}
  });
  await page.goto(`${ORIGIN}/index.html`, { waitUntil:'load' });
  await page.waitForFunction(()=> typeof exploreStart==='function' && typeof setLobbyMode==='function', null, { timeout:30000 });
  await page.waitForFunction(()=>{ const t=document.getElementById('titleTapStart'); return t && !t.classList.contains('hidden'); }, null, { timeout:30000 });
  await page.evaluate(()=> document.getElementById('titleScreen').click());
  await page.waitForTimeout(700);
  // リアルマップの3D層(ESモジュール)の読み込みを待つ。来なければ2Dのまま撮る
  await page.waitForFunction(()=> !!window.__aramonReal3D, null, { timeout:20000 }).catch(()=> report.errors.push(`${vpName}: 3D層が読み込まれなかった`));
  await page.evaluate(pageTools);
  await page.evaluate((el)=>{
    game.selectedElement = el; game.selectedMastermonKey = null;
    if(typeof updatePlayButtonsEnabled==='function') updatePlayButtonsEnabled();
    if(typeof refreshLobby==='function') refreshLobby();
  }, ELEMENT);

  // ロビー側のカット(ループを止める前に撮る)
  for(const c of cuts.filter(c=>c.kind==='lobby')){
    await page.evaluate(()=> window.__shotCloseOverlays());
    await page.evaluate(`(${c.prep.toString()})()`);
    await page.waitForTimeout(600);
    const file = path.join(OUT, `${c.name}_${vpName}.png`);
    await shoot(page, file, vp);
    report.shots.push({ cut:c.name, vp:vpName, file:path.relative(ROOT, file) });
    console.log(`撮影 ${c.name}_${vpName}`);
  }
  await page.evaluate(()=> window.__shotCloseOverlays());

  // 探検の中のカット
  const fieldCuts = cuts.filter(c=>c.kind==='field');
  const resultCuts = cuts.filter(c=>c.kind==='result');
  if(fieldCuts.length || resultCuts.length){
    const st = await page.evaluate(([s, el])=> window.__shotStartExplore(s, el), [SEED, ELEMENT]);
    if(!st.ok){ report.errors.push(`${vpName}: 探検が始まらなかった`); }
    report.start = st;
    for(const c of fieldCuts){
      const info = await page.evaluate((src)=> window.__shotField(src), c.at.toString());
      if(!info || !info.ok){ report.errors.push(`${c.name}_${vpName}: ${info && info.reason || '失敗'}`); continue; }
      await page.waitForTimeout(150);
      const file = path.join(OUT, `${c.name}_${vpName}.png`);
      await shoot(page, file, vp);
      report.shots.push({ cut:c.name, vp:vpName, file:path.relative(ROOT, file), cam:info });
      console.log(`撮影 ${c.name}_${vpName}  (${info.region||'キャンプ'} / 生存${info.alive})`);
    }
    // 結果画面は1回で試合が終わるので、カットごとに探検を始め直す
    for(const c of resultCuts){
      await page.evaluate(([s, el])=> window.__shotStartExplore(s, el), [SEED, ELEMENT]);
      await page.evaluate(()=> window.__shotField(`()=>({ x:exploreState.spawn.x, y:exploreState.spawn.y, yaw:-Math.PI/2, pitch:0.14, warm:0 })`));
      await page.evaluate(`(${c.prep.toString()})()`);
      await page.waitForTimeout(500);
      const file = path.join(OUT, `${c.name}_${vpName}.png`);
      await shoot(page, file, vp);
      report.shots.push({ cut:c.name, vp:vpName, file:path.relative(ROOT, file) });
      console.log(`撮影 ${c.name}_${vpName}`);
    }
  }
  for(const e of errs) report.errors.push(`${vpName}: ${e.slice(0, 200)}`);
  await page.close();
}

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
server.close();
console.log(`\n出力: ${OUT}  (${report.shots.length}枚)`);
if(report.errors.length){
  console.log('エラー:');
  for(const e of report.errors.slice(0, 12)) console.log('  ' + e);
}
