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

/* 押せる物の最小の高さ(iOSのガイドラインと同じ)。
   **studio_web.html の `button,select{ min-height:44px }` と同じ値**を二重に持っている
   (検査側が本文の CSS を読まないため)。**片方を変えたら必ず両方直す。** */
const TAP_MIN = 44;

/* 押せる物として数えるもの。**`button,select` だけでは足りない**(§指摘9) ――
   色見本・候補コマの札・パレットの升目は `onclick` を持つ div なので、
   button で絞ると「指で押す物なのに一度も測られない」ままになる。 */
const TAP_SEL = 'button,select,[onclick],[role=button]';

/* ===== パネルごとの方針(この表が正) =====
   id     … パネルの要素id
   name   … 報告に出す名前
   kind   … そのパネルが出る「登録の種類」(regKind の値)。null = どの種類でも出る
   open   … 測る前に開いておく要素id。**そのパネルの子だけ**を書く(§指摘8) ――
            別のパネルの子を書いても、その行では測られないので「測ったつもり」になる
   small  … わざと TAP_MIN より小さくしてある物のセレクタ(**理由を必ず添える**)
   noClip … 省略記号を付けてあるが**切れてはいけない**物(1b の除外の外で実測する)
   moveForm … 技パネルを「開いて直す」の姿にしてから測る({ moves })。**本物の fillMoveForm**
            へ手書きの技を流し込むので、止めた欄の断り・「(いまの値)」の長い選択肢・
            テンプレート無しの薄字が、実際に画面へ出るとおりに出る
   changelog … 更新履歴の欄を**いちばん字が多い姿**にしてから測る({ label, lines })。
            空のまま測ると、実際に画面へ出る注意文と 🔒 付きの選択肢を一度も測っていない
            ことになる。中身は本物の fillEditChangelog に作らせる(検査に文言を書き写さない) */
const PANELS = [
  /* 段階バーは画面のいちばん上に貼り付く帯。**7段が横に並びきるか**をここで見る。
     段は自分で省略記号を出すので 1b の網に掛からない ―― 切れた瞬間に ✓/! の印まで
     消えて「いまどの段階か」が読めなくなるので、noClip で実測する(§指摘3)。 */
  { id:'stageWrap',     name:'0 段階バー',     kind:null,       open:[],
    noClip:['#stageBar button'] },
  /* 「もっと前の入力に戻す」は**退避があるときだけ**出る(=ふつうは display:none)ので、
     open に挙げないと一度も測られない(§指摘32)。3つ並んだ姿がこのバーの最大の幅。 */
  { id:'draftBar',      name:'0 前回の続き',   kind:null,       open:['draftBar','draftPrevBtn'] },
  { id:'ghPanel',       name:'1 GitHub設定',   kind:null,       open:[] },
  /* 登録の種類のパネルは**種類ごとに別の姿**になる(ssrForm / assetsForm / awakenForm /
     editForm はどれも kindPanel の子)。1行にまとめていたときは editForm しか開いておらず、
     残り3つは一度も測られていなかった(§指摘8)。 */
  { id:'kindPanel',     name:'2 種類(新規)',     kind:'monster', open:[] },
  { id:'kindPanel',     name:'2 種類(SSR)',      kind:'ssr',     open:['ssrForm'] },
  { id:'kindPanel',     name:'2 種類(差し替え)', kind:'assets',  open:['assetsForm'] },
  { id:'kindPanel',     name:'2 種類(覚醒)',     kind:'awaken',  open:['awakenForm'] },
  /* 「開いて直す」は更新履歴の欄を持つ。**いちばん字が多いのは
     「同じ相手のツールの形の行が2つある日に、🔒 の付いた行を選んでいる」姿**
     ―― 注意が4つ並び、選択肢には 🔒 と本文40字が入る。 */
  { id:'kindPanel',     name:'2 種類(開いて直す)', kind:'edit',  open:['editForm','e_chWrap'],
    changelog:{ label:'ジョーカー', pick:0, lines:[
      '🆕 新モンスター「ジョーカー」が登場しました!闇の技で切り裂きます',
      'ジョーカー: HP115→120・移動速度2.9→3.1・クールタイム倍率0.9→0.8',
      'ジョーカー: デスファイナルの威力21→34・連射15→18']} },
  { id:'mediaPanel',    name:'M 専用メディア', kind:'ssrmedia', open:[] },
  { id:'walkPanel',     name:'3 歩行',         kind:'monster',
    open:['candWrap','walkDiag'],
    /* 候補16コマの札は「絵を選ぶ枠」。4列に並べて一覧できることが大事で、押しやすさより優先する。
       札は動画を読まないと出ないので、**測るために16枚ぶんの枠だけ**入れる
       (入れないとこの例外は当たる相手がおらず、書いてあるだけの設定になる)。 */
    cells:['candStrip', 16], small:['.cell'] },
  { id:'portraitPanel', name:'4 静止画',       kind:'monster',  open:[] },
  { id:'specPanel',     name:'5 仕様',         kind:'monster',  open:['editSkinBox'],
    // 色見本は**見て選ぶ物**なので例外。9列の一覧で、縦を44pxにすると3行で画面の半分を食う
    small:['.sw'] },
  { id:'movePanel',     name:'6 技',           kind:'monster',  open:[] },
  /* 「開いて直す」の技パネルは**新規登録とは別の姿**になる: 形の欄が止まって断り
     (`#tplEditNote`)が1行増え、テンプレートに無い値は「◯◯(いまの値)」という
     長い選択肢として足され、薄字も `TPL_NONE_HINT` の長い文へ変わる。
     測る姿は**本物の fillMoveForm に作らせる**(検査側に画面の文言を書き写さない)。 */
  { id:'movePanel',     name:'6 技(開いて直す)', kind:'edit', open:[],
    moveForm:{ moves:[
      { name:'ダークネイル', dmg:9, range:180, projSpeed:520, cooldown:0.35, gutsCost:0,
        icon:'🗡️', color:'#7c3aed', seStyle:'slash' },
      { name:'シャドウバースト', dmg:16, range:320, projSpeed:600, cooldown:3.2, gutsCost:12,
        icon:'💥', color:'#4c1d95', seStyle:'blast' },
      // 手書きの技(デスファイナル)。projStyle がテンプレートに無いので「テンプレート無し」になる
      { name:'デスファイナル', dmg:21, range:520, projSpeed:700, cooldown:12, gutsCost:40,
        projStyle:'scythe', aoeStyle:'', color:'#111827', seStyle:'slash',
        burst:15, burstDirs:3 },
    ]} },
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
const MEASURE = ({ panel, tapMin, tapSel })=>{
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
  const out = { over:[], small:[], overlap:[], cut:[], clip:[],
                panelH: Math.round(root.getBoundingClientRect().height) };
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
  /* 1c. **省略記号の除外の外**で見る物(§指摘3)。ellipsis を付けてある要素は 1b を
     素通りするが、段階バーの段のように「切れたら意味が失われる」物はここで実測する。 */
  for(const sel of (panel.noClip || [])){
    for(const el of root.querySelectorAll(sel)){
      if(!vis(el)) continue;
      if(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
        out.clip.push(`${name(el)}  中身${el.scrollWidth}x${el.scrollHeight} / 枠${el.clientWidth}x${el.clientHeight}`);
    }
  }
  // 2. 押せる物の大きさ。small に当たる物は「わざと小さい」ので数えない
  const taps = Array.from(root.querySelectorAll(tapSel)).filter(vis)
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
      /* 段階バーは「印(✓ / !)が出ている状態」がいちばん幅を食う。印が出た瞬間に
         切れるのでは意味が無いので、その姿にしてから測る(§指摘3)。 */
      if(panel.id === 'stageWrap')
        document.querySelectorAll('#stageBar .mk').forEach(m => m.textContent = '✓');
      /* 候補コマの札(renderCand と同じ形)。**絵を入れないと高さが 0 になる**
         (`.cell img{ width:100% }` = 高さは絵の縦横比で決まる)ので、1×1の透明PNGを入れる。 */
      /* 更新履歴の欄。**本物の fillEditChangelog に作らせる**(注意文と 🔒 を
         検査側へ書き写すと、画面の文言を変えたときに測る姿だけ古くなる)。
         渡すのは「今日のかたまりだけを持つ data.js」の形の文字列。 */
      /* 技パネルを「開いて直す」の姿にする。**本物の fillMoveForm**へ流し込むので、
         止めた欄の断りも「(いまの値)」の選択肢も画面に出るとおりになる。
         元の書き方(texts)は無いので渡さない(数字はそのまま欄へ入る)。 */
      if(panel.moveForm) fillMoveForm(panel.moveForm.moves, []);
      if(panel.changelog){
        const ymd = todayYmd();
        const block = `  { date:'${ymd}', items:[\n`
          + panel.changelog.lines.map(t=>`    { t:'${t}', g:['balance'] },\n`).join('') + '  ]},\n';
        fillEditChangelog('const UPDATE_HISTORY = [\n' + block + '];\n', panel.changelog.label);
        // 🔒 の付いた行を選んだ姿(注意が1つ増える)。人の操作ではないので印は立てない
        if(panel.changelog.pick != null){
          const sel = document.getElementById('e_chTarget');
          sel.value = String(panel.changelog.pick);
          if(sel.onchange) sel.onchange();
        }
      }
      if(panel.cells){
        const [id, n] = panel.cells, box = document.getElementById(id);
        const px = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        if(box) box.innerHTML = new Array(n).fill(0).map((_, i)=>
          `<div class="cell sel" onclick="void 0"><img src="${px}"><span class="n">${i+1}</span></div>`).join('');
      }
    }, { panel });
    const m = await page.evaluate(MEASURE, { panel, tapMin: TAP_MIN, tapSel: TAP_SEL });
    if(m.err){ errors.push(`${dev.name} / ${panel.name}: ${m.err}`); continue; }
    rows.push({ dev:dev.name, panel:panel.name, ...m });
    for(const s of m.over)    errors.push(`${dev.name} / ${panel.name}: 横へはみ出し — ${s}`);
    for(const s of m.cut)     errors.push(`${dev.name} / ${panel.name}: 中身が切れている — ${s}`);
    for(const s of m.clip)    errors.push(`${dev.name} / ${panel.name}: 切れてはいけない字が切れている — ${s}`);
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
