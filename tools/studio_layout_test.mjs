/* モンスター作成スタジオ(tools/studio_web.html)を **iPhone の縦持ち**で測る検査
   (開発用・ゲームには読み込まない)。

   なぜ要るか:
     スタジオは発注者が iPhone だけで使う道具なのに、寸法を一度も測っていなかった。
     ゲーム本体には tools/layout_test.mjs があるが、あちらは #appRoot(強制横向き)の作りが
     前提で、素の縦スクロールで積むスタジオには当たらない。**同じ流儀の簡易版**をここに置く。

   確かめること(発注者が iPhone で困る順):
     1. 横へはみ出さない … 画面幅の外へ出る要素が1つも無い(横スクロールが出ない)
     2. 押しやすい       … ボタン・選択欄が TAP_MIN(44px)以上の実寸で描かれる
     3. 重ならない       … 押せる物どうしが重ならない
   端末は 375x667 / 375x812 / 414x896 の**縦持ち**。スタジオは強制横向きをしないので、
   ここが実際に出る画面そのもの。

   下の PANELS が「どのパネルをどの状態で開いて測るか」の表。
   **パネルを1つ足したらこの表へ1行足す。** 足さないパネルは測られない=次に壊れる所になる。

   使い方: node tools/studio_layout_test.mjs [--json] [--only <パネルid>]                */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (n, d)=>{ const i = args.indexOf('--'+n); return i>=0 && args[i+1] && !args[i+1].startsWith('--') ? args[i+1] : d; };
const ONLY = opt('only', null);
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

let chromium = null;
try { ({ chromium } = await import('playwright')); }
catch {
  for(const base of ['/opt/node22/lib/node_modules/', '/usr/lib/node_modules/', '/usr/local/lib/node_modules/']){
    try { ({ chromium } = createRequire(base)('playwright')); break; } catch {}
  }
  if(!chromium){ try { ({ chromium } = await import('playwright-core')); } catch {} }
}
if(!chromium){ console.error('playwrightが見つかりません(npm i -g playwright)。'); process.exit(1); }

/* 端末。**縦持ちだけ**を見る(発注者は iPhone を縦に持ってスタジオを使う)。 */
const DEVICES = [
  { name:'iPhone SE 縦持ち', w:375, h:667 },
  { name:'iPhone X 縦持ち',  w:375, h:812 },
  { name:'iPhone XR 縦持ち', w:414, h:896 },
];

const TAP_MIN = 44;   // 押せる物の最小の高さ(iOSのガイドラインと同じ)

/* ===== パネルごとの方針(この表が正) =====
   id    … パネルの要素id
   name  … 報告に出す名前
   kind  … そのパネルが出る「登録の種類」(regKind の値)。null = どの種類でも出る
   open  … 測る前に開いておく要素id(データが無いと出ない箱。中身が空でも寸法は測れる)
   small … わざと TAP_MIN より小さくしてある物のセレクタ(**理由を必ず添える**) */
const PANELS = [
  // 段階バーは画面のいちばん上に貼り付く帯。**7段が横に並びきるか**をここで見る
  { id:'stageWrap',     name:'0 段階バー',     kind:null,       open:[] },
  { id:'draftBar',      name:'0 前回の続き',   kind:null,       open:['draftBar'] },
  { id:'ghPanel',       name:'1 GitHub設定',   kind:null,       open:[] },
  { id:'kindPanel',     name:'2 登録の種類',   kind:null,       open:['editForm','e_chWrap'] },
  { id:'mediaPanel',    name:'M 専用メディア', kind:'ssrmedia', open:[] },
  { id:'walkPanel',     name:'3 歩行',         kind:'monster',
    open:['candWrap','walkDiag','modelAbortWrap','walkModelTime'],
    // 候補16コマの札は「絵を選ぶ枠」。4列に並べて一覧できることが大事で、押しやすさより優先する
    small:['.cell'] },
  { id:'portraitPanel', name:'4 静止画',       kind:'monster',  open:[] },
  { id:'specPanel',     name:'5 仕様',         kind:'monster',
    open:['ssrForm','assetsForm','awakenForm','editSkinBox'],
    // 色見本は9列の一覧。縦を44pxにすると3行で画面の半分を食うので、幅(9列)で押しやすさを稼ぐ
    small:['.sw'] },
  { id:'movePanel',     name:'6 技',           kind:'monster',  open:[] },
  { id:'sendPanel',     name:'7 送信',         kind:null,       open:[] },
];

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

const browser = await chromium.launch({ executablePath: EXEC, args:['--no-sandbox'] });
const errors = [], rows = [];

/* 1画面ぶんの測定。ブラウザの中で完結させる(戻すのは数字と名前だけ)。 */
const MEASURE = ({ panel, tapMin })=>{
  const root = document.getElementById(panel.id);
  if(!root) return { err:`パネル ${panel.id} が見つかりません` };
  const vis = el =>{
    const st = getComputedStyle(el);
    if(st.display === 'none' || st.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const name = el =>{
    const t = (el.textContent || el.value || '').trim().slice(0, 18);
    return (el.id ? '#'+el.id : (el.className || el.tagName)) + (t ? ' « '+t : '');
  };
  const W = document.documentElement.clientWidth;
  const out = { over:[], small:[], overlap:[], cut:[], panelH: Math.round(root.getBoundingClientRect().height) };
  // 1. 横へのはみ出し(パネルの中の全要素)
  for(const el of root.querySelectorAll('*')){
    if(!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if(r.right > W + 1 || r.left < -1)
      out.over.push(`${name(el)}  左${Math.round(r.left)}〜右${Math.round(r.right)} / 画面${W}`);
  }
  /* 1b. 文字が切れていないか。**切ってよいのは「自分で省略記号を出す要素」だけ**
     (段階バーの段はそれ。それ以外で hidden に入りきらない字は黙って消えている)。 */
  for(const el of root.querySelectorAll('*')){
    if(!vis(el)) continue;
    // 文字を打つ欄は指で中身を送れる(切れているのではなく、そういう作り)
    if(/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) continue;
    const st = getComputedStyle(el);
    if(!/hidden|clip/.test(st.overflowX) && !/hidden|clip/.test(st.overflowY)) continue;
    if(st.textOverflow === 'ellipsis') continue;
    if(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      out.cut.push(`${name(el)}  中身${el.scrollWidth}x${el.scrollHeight} / 枠${el.clientWidth}x${el.clientHeight}`);
  }
  // 2. 押せる物の大きさ。small に当たる物は「わざと小さい」ので数えない
  const taps = Array.from(root.querySelectorAll('button,select')).filter(vis)
    .filter(el => !(panel.small || []).some(sel => el.matches(sel)));
  for(const el of taps){
    const r = el.getBoundingClientRect();
    if(r.height < tapMin - 0.5) out.small.push(`${name(el)}  高さ${r.height.toFixed(1)}px`);
  }
  // 3. 押せる物どうしの重なり
  for(let i=0;i<taps.length;i++) for(let j=i+1;j<taps.length;j++){
    if(taps[i].contains(taps[j]) || taps[j].contains(taps[i])) continue;
    const a = taps[i].getBoundingClientRect(), b = taps[j].getBoundingClientRect();
    const w = Math.min(a.right,b.right) - Math.max(a.left,b.left);
    const h = Math.min(a.bottom,b.bottom) - Math.max(a.top,b.top);
    if(w > 2 && h > 2) out.overlap.push(`${name(taps[i])} × ${name(taps[j])}`);
  }
  out.taps = taps.length;
  return out;
};

for(const dev of DEVICES){
  const page = await browser.newPage({ viewport:{ width:dev.w, height:dev.h }, deviceScaleFactor:2 });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(ORIGIN + '/tools/studio_web.html', { waitUntil:'load' });
  await page.waitForFunction(()=> typeof window.boot === 'function');

  for(const panel of PANELS){
    if(ONLY && panel.id !== ONLY) continue;
    // 「登録の種類」を切り替えてそのパネルを出し、データが無いと出ない箱も開く
    await page.evaluate(({ panel })=>{
      const kind = document.getElementById('regKind');
      kind.value = panel.kind || 'monster';
      kind.onchange();
      document.getElementById(panel.id).style.display = 'block';
      for(const id of panel.open || []){ const e = document.getElementById(id); if(e) e.style.display = 'block'; }
      document.querySelectorAll('details').forEach(d => d.open = true);
    }, { panel });
    const m = await page.evaluate(MEASURE, { panel, tapMin: TAP_MIN });
    if(m.err){ errors.push(`${dev.name} / ${panel.name}: ${m.err}`); continue; }
    rows.push({ dev:dev.name, panel:panel.name, ...m });
    for(const s of m.over)    errors.push(`${dev.name} / ${panel.name}: 横へはみ出し — ${s}`);
    for(const s of m.cut)     errors.push(`${dev.name} / ${panel.name}: 中身が切れている — ${s}`);
    for(const s of m.small)   errors.push(`${dev.name} / ${panel.name}: 押しにくい(${TAP_MIN}px未満) — ${s}`);
    for(const s of m.overlap) errors.push(`${dev.name} / ${panel.name}: 重なり — ${s}`);
  }
  // ページ全体の横スクロール(パネルの外=ヘッダーや段階バーのはみ出しもここで出る)
  const doc = await page.evaluate(()=>({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  if(doc.sw > doc.cw + 1)
    errors.push(`${dev.name}: ページ全体が横へスクロールします(中身${doc.sw} / 画面${doc.cw})`);
  for(const e of pageErrors) errors.push(`${dev.name}: ページ例外 — ${e}`);
  await page.close();
}

await browser.close();
server.close();

if(args.includes('--json')) console.log(JSON.stringify(rows, null, 1));
console.log(`スタジオの画面(iPhone 縦持ち ${DEVICES.length}端末 × ${PANELS.length}パネル)`);
for(const dev of DEVICES){
  const mine = rows.filter(r => r.dev === dev.name);
  if(mine.length) console.log(`  ${dev.name}: ` + mine.map(r => `${r.panel} ${r.panelH}px(押せる物${r.taps})`).join(' / '));
}
if(errors.length){
  console.log(`\n問題が ${errors.length} 件あります:`);
  for(const e of errors) console.log('  - ' + e);
  process.exit(1);
}
console.log('横はみ出し・押しにくさ・重なり いずれも 0 件');
