/* リアルマップ(real3d.js)の見た目をヘッドレスChromiumで撮る開発用ツール。
   ゲームの遊びを確かめるものではなく、「地形・空・水・障害物がどう見えるか」を
   毎回同じ条件で画像に落として比較するためのもの(ゲーム本体には読み込まない)。

   使い方:
     node tools/real3d_shot.mjs --out shots/base            全マップ×全カット
     node tools/real3d_shot.mjs --out shots/x --maps wild   マップを絞る
     node tools/real3d_shot.mjs --out shots/x --poses wide,ground --bench

   出力: <out>/<map>_<pose>.png と <out>/report.json(生成数・fps・失敗)

   playwright は入っていればグローバルでもよい(measure_layout.mjs と同じ探し方)。 */
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
if(!chromium){
  console.error('playwrightが見つかりません(npm i -g playwright)。');
  process.exit(1);
}

const args = process.argv.slice(2);
const opt = (name, def)=>{ const i = args.indexOf('--'+name); return i>=0 && args[i+1] ? args[i+1] : def; };
const flag = (name)=> args.includes('--'+name);

const OUT = path.resolve(opt('out', path.join(ROOT, 'shots', 'latest')));
const W = parseInt(opt('w', '1624'), 10);
const H = parseInt(opt('h', '750'), 10);
const SEED = parseInt(opt('seed', '20260813'), 10);

/* 撮るマップ。通常マップのキーに _real を付けたものがリアルマップ。 */
const ALL_MAPS = ['wild', 'kaurea', 'papas', 'palepale', 'toble', 'mandy'];

/* カット。ゲーム中に実際に見える画づくり(三人称・カメラ高90)で、
   地面の質感 / 空と遠景 / 水 / 障害物 がそれぞれ主役になるように選んである。 */
const ALL_POSES = {
  // 開けた場所を水平に見渡す。地形の起伏と遠景の山、全体の色調が見える基本カット
  wide:    { at:null, yaw:0.6, pitch:0.10 },
  // 足元を見下ろす。地面テクスチャの解像感・法線・タイリングの粗が出る
  ground:  { at:null, yaw:2.1, pitch:0.52 },
  // 見上げる。空のグラデーション・霞・遠景の稜線の作りが出る
  sky:     { at:null, yaw:3.6, pitch:-0.34 },
  // 山を望む(火山/雪山/森/ピラミッド)
  mount:   { feature:'volcano', offset:[-1500, -1100], pitch:0.02 },
  // 水辺(海→川→オアシスの順に、そのマップにあるものを撮る)
  sea:     { feature:'sea',   offset:[900, 200], pitch:0.12 },
  river:   { feature:'river', offset:[-500, -420], pitch:0.16 },
  oasis:   { feature:'oasis', offset:[-620, -520], pitch:0.14 },
  lava:    { feature:'lava',  offset:[-700, -600], pitch:0.10 },
  // 障害物(岩・木など)に寄る
  props:   { feature:'rock',  offset:[-330, -260], pitch:0.18 },
};

const maps  = (opt('maps', '')  ? opt('maps','').split(',')  : ALL_MAPS).map(s=>s.trim()).filter(Boolean);
const poses = (opt('poses', '') ? opt('poses','').split(',') : Object.keys(ALL_POSES)).map(s=>s.trim()).filter(Boolean);

fs.mkdirSync(OUT, { recursive:true });

/* ESモジュール(real3d.js)は file:// から読めないので、リポジトリを配る小さなHTTPサーバを立てる。
   依存を増やさないよう node の http だけで書く(ゲーム本体には無関係)。 */
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
               '.webp':'image/webp', '.mp3':'audio/mpeg', '.mp4':'video/mp4', '.webm':'video/webm' };
const server = http.createServer((req, res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
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
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const errors = [];
const report = { seed:SEED, size:[W,H], shots:[], errors:[], bench:{} };

/* マップごとにページを作り直す。1つのページを使い回すと、マップの数だけ
   WebGLコンテキストが積み上がって上限に当たり、途中から真っ白/読み込み待ちで
   止まる(植生を足して1シーンが重くなってから実際に起きた)。            */
let page = null;
async function freshPage(){
  if(page) await page.close();
  page = await browser.newPage({ viewport:{ width:W, height:H }, deviceScaleFactor:1 });
  page.on('pageerror', e=> errors.push(String(e)));
  page.on('console', m=>{ if(m.type()==='error') errors.push('console: '+m.text()); });
  return page;
}

for(const base of maps){
  const mapKey = base + '_real';
  await freshPage();
  await page.goto(`${ORIGIN}/tools/real3d_probe.html`, { waitUntil:'load' });
  await page.waitForFunction(()=> window.__probeModuleReady && window.__probe, null, { timeout:30000 });
  const setup = await page.evaluate(([k, w, h, seed])=> window.__probe.setup({ mapKey:k, w, h, seed }), [mapKey, W, H, SEED]);
  if(!setup.ok){
    report.errors.push(`${mapKey}: setActive に失敗(WebGL初期化不可)`);
    continue;
  }
  for(const name of poses){
    const pose = ALL_POSES[name];
    if(!pose) continue;
    const info = await page.evaluate((p)=> window.__probe.shoot(p), pose);
    if(!info || !info.ok) continue;    // そのマップに無い見どころ
    const file = path.join(OUT, `${base}_${name}.png`);
    await page.screenshot({ path:file, clip:{ x:0, y:0, width:W, height:H } });
    report.shots.push({ map:base, pose:name, file:path.relative(ROOT, file), cam:info });
    process.stdout.write(`撮影 ${base}_${name}\n`);
  }
  if(flag('bench')){
    const ms = await page.evaluate(()=> window.__probe.bench(40));
    report.bench[base] = { ms:+ms.toFixed(2), fps:+(1000/ms).toFixed(1), stats: await page.evaluate(()=> window.__probe.stats()) };
  }
}
report.errors.push(...errors);
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
server.close();

console.log(`\n出力: ${OUT}  (${report.shots.length}枚)`);
if(report.errors.length){
  console.log('エラー:');
  for(const e of report.errors.slice(0, 12)) console.log('  ' + e);
}
if(Object.keys(report.bench).length) console.log('bench:', JSON.stringify(report.bench));
