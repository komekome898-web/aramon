/* 技プレビュー用ハーネスの成立確認(開発用・ゲームには読み込まない)。

   何を見るか(設計仕様 §4 C1・§7):
     ① 本物の index.html を、localStorage を差し替えた状態で起動できるか
     ② 起動〜試合開始〜発射まで進めても、**本物の保存データが1件も変わらない**か
     ③ rAF を止めずに(=動くプレビューとして)技が撃てるか — 弾が出る

   使い方:
     node tools/harness_test.mjs              addInitScript で localStorage を差し替えて検査
     node tools/harness_test.mjs --noshim     差し替えを入れずに検査(index.html 側の harness=1 を見る)
     node tools/harness_test.mjs --shot <png> 撮った画面を保存する
     node tools/harness_test.mjs --json       生の測定値も出す

   --noshim について:
     いまは差し替えをこのファイルの addInitScript が入れている。将来 index.html の
     最初の <script> より前に harness=1 の枝が入ったら、addInitScript は要らなくなる。
     その日に「本体側だけで成立しているか」を確かめるための経路が --noshim。
     本体側にまだ枝が無いうちは②が落ちる(それが正しい結果)。                        */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const opt  = (n, d)=>{ const i = args.indexOf('--'+n); return i>=0 && args[i+1] && !args[i+1].startsWith('--') ? args[i+1] : d; };
const flag = n => args.includes('--'+n);
const NOSHIM = flag('noshim');
const SHOT   = opt('shot', null);
const EXEC   = opt('chromium', process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium');

// playwright の探し方は fx_shot.mjs と同じ
let chromium = null;
try { ({ chromium } = await import('playwright')); }
catch {
  for(const base of ['/opt/node22/lib/node_modules/', '/usr/lib/node_modules/', '/usr/local/lib/node_modules/']){
    try { ({ chromium } = createRequire(base)('playwright')); break; } catch {}
  }
  if(!chromium){ try { ({ chromium } = await import('playwright-core')); } catch {} }
}
if(!chromium){ console.error('playwrightが見つかりません(npm i -g playwright)。'); process.exit(1); }

const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.mp3':'audio/mpeg',
               '.mp4':'video/mp4', '.webm':'video/webm', '.wasm':'application/wasm' };
const server = http.createServer((req, res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const p = path.join(ROOT, rel);
  if(!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r=> server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: EXEC, args:['--no-sandbox','--use-gl=swiftshader'] });
const ctx = await browser.newContext({ viewport:{ width:1280, height:720 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e=> errors.push(String(e).slice(0, 160)));

// 本物の保存データの代わり(ゲームが読むはずの鍵をいくつか置いておく)
await page.goto(`${ORIGIN}/manifest.json`, { waitUntil:'domcontentloaded' });
await page.evaluate(()=>{
  localStorage.clear();
  localStorage.setItem('aramon_player_name_v1', '本物の名前');
  localStorage.setItem('aramon_probe_marker', 'untouched');
});
const dump = ()=> JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k, localStorage.getItem(k)])));
const before = await page.evaluate(dump);

/* ハーネス本体: 最初のスクリプトより前で localStorage をメモリ上の入れ物へ差し替える。
   --noshim ではこれを入れない(index.html 側の harness=1 の枝だけで成立するかを見る)。 */
if(!NOSHIM){
  await page.addInitScript(()=>{
    if(!/[?&]harness=1/.test(location.search)) return;
    const mem = new Map();
    const shim = {
      getItem: k=> mem.has(String(k)) ? mem.get(String(k)) : null,
      setItem: (k,v)=> { mem.set(String(k), String(v)); },
      removeItem: k=> { mem.delete(String(k)); },
      clear: ()=> mem.clear(),
      key: i=> Array.from(mem.keys())[i] ?? null,
      get length(){ return mem.size; },
    };
    try{ Object.defineProperty(window, 'localStorage', { value: shim, configurable:true }); }
    catch(e){ window.__harnessShimFailed = String(e); }
    window.__harnessShim = true;
  });
}

await page.goto(`${ORIGIN}/index.html?netprobe=1&harness=1`, { waitUntil:'load' });
await page.waitForTimeout(1500);
// 差し替えが効いていれば、退避しておいた鍵はページ側から見えない
const shim = await page.evaluate(()=> ({
  installed: !!window.__harnessShim,
  failed: window.__harnessShimFailed || null,
  markerHidden: localStorage.getItem('aramon_probe_marker') === null,
}));

// ゲームを進める: 属性を選び、試合を始め、技を撃つ(fx_shot と同じ関数を直接呼ぶ。rAF は止めない)
const ran = await page.evaluate(async ()=>{
  const out = {};
  out.fns = ['startGame','update','render','fireMove','createMonster'].map(n=> typeof window[n]);
  try{
    game.selectedElement = 'zan'; game.selectedMastermonKey = null;
    game.selectedMap = 'wild'; game.realMapMode = false;
    startGame({});
    await new Promise(r=> setTimeout(r, 1200));
    const me = entities.find(e=>e.isPlayer);
    out.player = !!me;
    // 撃つ側の技をその場で差し替える(保存していない編集をプレビューする経路)
    SIGNATURE_MOVES.zan[2].burst = 15;
    me.moveTierSelected = 3; me.moveTierUnlocked = 3; me.guts = me.maxGuts; me.fireCooldown = 0;
    const mv = activeMove(me);
    const n0 = projectiles.length;
    fireMove(me, { x: me.x + Math.cos(me.facingAngle)*2000, y: me.y + Math.sin(me.facingAngle)*2000 }, mv);
    await new Promise(r=> setTimeout(r, 900));
    out.projectilesSpawned = projectiles.length - n0;
    out.matchTime = +matchTime.toFixed(2);
  }catch(e){ out.error = String(e).slice(0, 200); }
  return out;
});
if(SHOT) await page.screenshot({ path: SHOT });

// 本物の localStorage が変わっていないか(別ページで素の状態を読む)
const page2 = await ctx.newPage();
await page2.goto(`${ORIGIN}/manifest.json`, { waitUntil:'domcontentloaded' });
const after = await page2.evaluate(dump);
await browser.close(); server.close();

/* ------------------------------------------------------------ 合否 */
const A = JSON.parse(before), B = JSON.parse(after);
const changed = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter(k => A[k] !== B[k]);
const checks = [
  ['① 起動できた', ran.player === true && !ran.error, ran.error || (ran.player ? '' : 'プレイヤーが出ませんでした')],
  ['② 保存データ不変', changed.length === 0, changed.length ? '変わった鍵: ' + changed.join(', ') : ''],
  ['③ 発射で弾が出た', (ran.projectilesSpawned || 0) > 0, `出た弾: ${ran.projectilesSpawned}`],
];
console.log(`ハーネス検査(${NOSHIM ? '--noshim: index.html 側の harness=1 を見る' : 'addInitScript で差し替え'})`);
console.log(`  localStorage の差し替え: ${shim.installed ? '入れた' : '入れていない'}` +
            `${shim.failed ? ' / 失敗: ' + shim.failed : ''} / ページから本物が見える: ${shim.markerHidden ? 'いいえ' : 'はい'}`);
for(const [name, ok, note] of checks) console.log(`  ${ok ? '合格' : '不合格'} ${name}${note ? ' — ' + note : ''}`);
if(errors.length) console.log('  ページの例外: ' + errors.slice(0, 5).join(' / '));
if(flag('json')) console.log(JSON.stringify({ shim, ran, changed, errors: errors.slice(0, 5) }, null, 1));
const ng = checks.filter(c => !c[1]);
if(ng.length){
  if(NOSHIM && changed.length)
    console.log('  ※ --noshim は index.html 側に harness=1 の枝が入るまで②が落ちます(想定どおり)');
  process.exit(1);
}
console.log('  すべて合格');
