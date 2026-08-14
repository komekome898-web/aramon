/* net_transport.js(WebRTC DataChannel)の自動テストランナー。
   tools/rtc_test.html をヘッドレスChromiumで開き、同一ページ内に作った
   ホスト/ゲスト2つのTransportを直結させて
     ① シグナリング往復→接続確立
     ② fast/reliable両チャンネルの送受信(両方向)
     ③ 片側closeでのフォールバック(降格)コールバック発火
   を確認する。実Firebaseには一切つながない(シグナリングはページ内スタブ)。

   使い方: node tools/rtc_test.mjs           既定で3回連続実行(全回パスで終了コード0)
           node tools/rtc_test.mjs --runs 5

   playwright/配信サーバの構えは tools/real3d_shot.mjs と同じ。 */
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
const RUNS = parseInt(opt('runs', '3'), 10);

/* リポジトリを配る小さなHTTPサーバ(file://だとページ内scriptの読み込みが面倒なため) */
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript' };
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

/* このコンテナのChromium。mDNS隠蔽を切らないとローカルホスト同士のICE候補が解決できない */
const EXEC = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  ...(fs.existsSync(EXEC) ? { executablePath: EXEC } : {}),
  args: [
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-features=WebRtcHideLocalIpsWithMdns',
  ],
});

let allOk = true;
for(let run=1; run<=RUNS; run++){
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', e=> consoleErrors.push(String(e)));
  page.on('console', m=>{ if(m.type()==='error') consoleErrors.push('console: '+m.text()); });
  await page.goto(`${ORIGIN}/tools/rtc_test.html`, { waitUntil:'load' });
  let res = null;
  try{
    await page.waitForFunction(()=> window.__rtcTestResults, null, { timeout: 40000 });
    res = await page.evaluate(()=> window.__rtcTestResults);
  }catch(err){
    res = { ok:false, tests:{}, errors:['ページがタイムアウト: '+err.message] };
  }
  const t = res.tests || {};
  const mark = (b)=> b ? 'PASS' : 'FAIL';
  console.log(`--- run ${run}/${RUNS} ---`);
  console.log(`  ① 接続確立            : ${mark(t.connect)}`);
  console.log(`  ② fast/reliable送受信 : ${mark(t.channels)}`);
  console.log(`  ③ フォールバック      : ${mark(t.fallback)}`);
  if(!res.ok){
    allOk = false;
    for(const e of (res.errors||[])) console.log('  エラー: ' + e);
    for(const e of consoleErrors.slice(0,5)) console.log('  ページ: ' + e);
  }
  await page.close();
}

await browser.close();
server.close();
console.log(allOk ? `\n${RUNS}回連続 全項目パス` : '\n失敗あり');
process.exit(allOk ? 0 : 1);
