/* スタジオ「登録済みを開いて直す」の**画面側**をヘッドレスで通す検査(開発用・ゲームには読み込まない)。

   なぜ node の回帰(tools/studio_regress.mjs の (h))と別に要るか:
     (h) は UI を通さず readExisting → editChangesFor → applyEditChanges だけを見る。
     **欄への入れ方(fillEditForm)と読み方(readEditForm)のずれはそこに映らない。**
     実際、色の欄へ「元の書き方」を入れていて、開いただけで色が引用符ごと二重になった。
     ここは本物のブラウザで studio_web.html を開き、全対象を「開く→そのまま読む」して
     **差分ゼロ**を確かめる。あわせて1体で「直す→差分を確認する」まで通す。

   何を見るか:
     ① 全21体+全SSRを開いて、入れ直しただけでは差分が0件
     ② 1体を直すと、書き戻した data.js の変わる行がその項目の行だけ
     ③ 送信前の検証(空の iframe で data.js を評価)が通り、意図した差分だけが出る
     ④ 読んだあとに data.js が他所で変わっていたら、送信直前の sha 照合が止める

   GitHub へは出さない。window.gh を差し替えて手元の data.js / ui.js / sw.js を返す。

   使い方: node tools/studio_edit_test.mjs [--only <key>] [--json]                     */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt  = (n, d)=>{ const i = args.indexOf('--'+n); return i>=0 && args[i+1] && !args[i+1].startsWith('--') ? args[i+1] : d; };
const ONLY = opt('only', null);
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

// playwright の探し方は fx_shot.mjs / harness_test.mjs と同じ
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
               '.json':'application/json', '.png':'image/png' };
const server = http.createServer((req, res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const p = path.join(ROOT, rel);
  if(!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r=> server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const files = {};
for(const f of ['data.js','ui.js','sw.js']) files[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

const browser = await chromium.launch({ executablePath: EXEC, args:['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push('ページ例外: ' + e.message));

await page.addInitScript(({ files })=>{
  window.__files = files;
  window.addEventListener('DOMContentLoaded', ()=>{
    localStorage.setItem('aramon_gh_token', 'dummy');
    // GitHub API を手元のファイルへ振り替える。__shaMoved を立てると「他所で変わった」を作れる
    window.gh = async (p)=>{
      const m = /\/contents\/([^?]+)/.exec(p);
      if(m){
        const t = window.__files[m[1]];
        if(t == null) throw new Error('404 ' + m[1]);
        const b = new TextEncoder().encode(t);
        let s = ''; for(const c of b) s += String.fromCharCode(c);
        return { content: btoa(s), sha: `sha-${m[1]}-${window.__shaMoved ? 'moved' : 'base'}` };
      }
      if(/^\/repos\/[^/]+\/[^/]+$/.test(p)) return { full_name:'test/aramon' };
      throw new Error('想定していない GitHub 呼び出し: ' + p);
    };
  });
}, { files });

await page.goto(ORIGIN + '/tools/studio_web.html', { waitUntil:'load' });
await page.waitForFunction(()=> typeof window.loadExisting === 'function');

// ---------------------------------------------------------------- ① 全対象を開く
const openAll = await page.evaluate(async (only)=>{
  document.getElementById('regKind').value = 'edit';
  document.getElementById('regKind').onchange();
  await loadElementList();
  const sel = document.getElementById('e_target');
  const targets = Array.from(sel.options).map(o=>o.value).filter(v => !only || v.endsWith(':' + only));
  const bad = [];
  for(const v of targets){
    sel.value = v; sel.onchange();
    await loadExisting();
    if(!state.edit) bad.push(`${v}: ${document.getElementById('log').textContent.split('\n').join(' / ')}`);
  }
  return { n: targets.length, bad };
}, ONLY);
for(const b of openAll.bad) errors.push('開けません — ' + b);

// ---------------------------------------------------------------- ②③ 1体を直して送信直前まで
const edited = await page.evaluate(async ()=>{
  const sel = document.getElementById('e_target');
  sel.value = 'mon:joker'; sel.onchange();
  await loadExisting();
  const before = { hp: document.getElementById('f_hp').value,
                   dmg: document.getElementById('m2_dmg').value,
                   name: document.getElementById('m2_name').value };
  document.getElementById('f_hp').value = String(+before.hp + 5);
  document.getElementById('m2_dmg').value = String(+before.dmg + 13);
  await preflight();
  const hist = document.getElementById('e_chText').value;
  /* 更新履歴を空にしてもう一度。**表の書き換えだけ**にして行の数を数えられるようにする
     (更新履歴は実行日に今日のかたまりがあるかで増える行数が変わるため)。 */
  document.getElementById('e_chText').value = '';
  await preflight();
  return { before, hist, log: document.getElementById('log').textContent,
           cls: document.getElementById('log').className,
           dataJs: state.files ? state.files.texts['data.js'] : null,
           sw: state.files ? state.files.texts['sw.js'].match(/aramon-cache-v\d+/)[0] : null };
});
if(edited.cls === 'ng') errors.push('差分の確認で止まりました:\n' + edited.log);
if(!edited.dataJs) errors.push('差分の確認で送信内容ができませんでした');
else {
  const a = files['data.js'].split('\n'), b = edited.dataJs.split('\n');
  const changed = [];
  if(a.length !== b.length) errors.push(`行の数が変わりました(${a.length} → ${b.length})`);
  for(let i = 0; i < Math.min(a.length, b.length); i++)
    if(a[i] !== b[i]) changed.push({ n:i+1, before:a[i], after:b[i] });
  const want = ['hp:115', 'dmg:21'];
  if(changed.length !== 2)
    errors.push(`書き戻しで ${changed.length} 行変わりました(2行のはず):\n` +
      changed.map(c=>`  ${c.n}行目\n   - ${c.before}\n   + ${c.after}`).join('\n'));
  else for(const w of want)
    if(!changed.some(c=> c.before.includes(w))) errors.push(`${w} の行が変わっていません`);
  if(!/^ジョーカー: /.test(edited.hist)) errors.push('更新履歴の1行ができていません: ' + edited.hist);
}

// ---------------------------------------------------------------- ④ 送信直前の sha 照合
const guard = await page.evaluate(async ()=>{
  window.__shaMoved = true;
  try{ return await state.files.guard(); }catch(e){ return 'ERR ' + e.message; }
});
if(!guard || !/他所で変わって|変わっています/.test(guard))
  errors.push('data.js が他所で変わっても送信を止めませんでした: ' + guard);

await browser.close();
server.close();

if(args.includes('--json')) console.log(JSON.stringify({ openAll, edited: { ...edited, dataJs: undefined }, guard }, null, 1));
console.log(`開いて直す(画面側)の検査`);
console.log(`  ① 開いて入れ直すだけ: ${openAll.n}件(モンスター+SSR)`);
console.log(`  ②③ ジョーカーを直す: HP${edited.before.hp}→+5 / 威力${edited.before.dmg}→+13 / ${edited.sw}`);
console.log(`      更新履歴の1行: ${edited.hist}`);
console.log(`  ④ 送信直前の sha 照合: ${guard}`);
if(errors.length){
  console.log(`\n問題が ${errors.length} 件あります:`);
  for(const e of errors) console.log('  - ' + e);
  process.exit(1);
}
console.log('すべて合格');
