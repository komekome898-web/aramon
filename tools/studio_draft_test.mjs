/* スタジオの「入力の下書き(前回の続き)」と「段階バー」をヘッドレスで通す検査
   (開発用・ゲームには読み込まない)。

   なぜ node の回帰(tools/studio_regress.mjs)と別に要るか:
     下書きは **欄への入れ方と読み方**の話なので、本物のブラウザで
     「入れる → 読み込み直す → 戻す」をやらないと確かめられない。
     studio_edit_test.mjs と同じ流儀(GitHubへは出さず、手元のファイルを返す)。

   何を見るか:
     ① 入力すると localStorage(aramon_studio_draft_v1)へ自動で溜まる。
        **絵・動画は入らない**(容量)・**GitHubのトークンは別管理のまま**入らない
     ② 保存 → 読み込み直す → 復元 で、**preflight の出す文が1文字も変わらない**
        (設計仕様 §11 [29] E2 の受け入れ条件そのもの)
     ③ 「捨てて新しく始める」を押すと下書きが消え、次に開いても聞かれない
     ④ 段階バーが state.* を読んで 未 → 済 へ変わる(新しい状態を持っていない)

   使い方: node tools/studio_draft_test.mjs [--json]                              */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
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

// GitHub API を手元のファイルへ振り替える(studio_edit_test.mjs と同じ作り)
await page.addInitScript(({ files })=>{
  window.__files = files;
  window.addEventListener('DOMContentLoaded', ()=>{
    localStorage.setItem('aramon_gh_token', 'dummy');
    window.gh = async (p)=>{
      const m = /\/contents\/([^?]+)/.exec(p);
      if(m){
        const t = window.__files[m[1]];
        if(t == null) throw new Error('404 ' + m[1]);
        const b = new TextEncoder().encode(t);
        let s = ''; for(const c of b) s += String.fromCharCode(c);
        return { content: btoa(s), sha: `sha-${m[1]}` };
      }
      if(/^\/repos\/[^/]+\/[^/]+$/.test(p)) return { full_name:'test/aramon' };
      throw new Error('想定していない GitHub 呼び出し: ' + p);
    };
  });
}, { files });

/* 差分の確認(preflight)まで進めるには絵が要る。**絵の中身は比べないので**
   1×1の透明PNGを16枚+2枚として入れておく(下書きが戻したいのは欄の値だけ)。 */
const FAKE_IMAGES = `
  window.__fakeImages = async function(){
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const blob = await new Promise(r=> c.toBlob(r, 'image/png'));
    const frames = new Array(8).fill(blob), issues = new Array(8).fill(null);
    state.walk.f = { frames, issues, urls:[] };
    state.walk.b = { frames, issues, urls:[] };
    state.portraits = { icon: blob, player: blob };
  };`;

// 下書きに入るはずの欄(登録の種類・仕様・技・色・抜き方)を一通り書き換える
const FILL = {
  f_key:'draftmon', f_label:'ドラフトモン', f_trait:'drafttrait', f_traitDesc:'検査用の特性です',
  f_color:'#123456', f_dark:'#0a1b2c', f_accent:'#fedcba',
  f_hp:'123', f_speed:'234',
  m0_name:'ドラフト突き', m1_name:'ドラフト弾', m2_name:'ドラフト大技',
  m2_dmg:'77', m2_range:'1234',
  mode:'white', pmode:'black', cycleHow:'move', alignMode:'foot',
};

await page.goto(ORIGIN + '/tools/studio_web.html', { waitUntil:'load' });
await page.waitForFunction(()=> typeof window.boot === 'function');

// ---------------------------------------------------------------- ① 溜まる / 入らない物
const saved = await page.evaluate(async ({ fill, fake })=>{
  eval(fake);
  // 差し替えた gh で接続し直す(boot の中の接続は本物の api.github.com へ出るので当てにしない)
  await saveToken();
  for(const [id, v] of Object.entries(fill)){
    const el = document.getElementById(id);
    el.value = v;
    el.dispatchEvent(new Event('change', { bubbles:true }));
  }
  saveDraft();                       // 打ち終わりを待たずにその場で書く(検査なので)
  await window.__fakeImages();
  await preflight();
  return { raw: localStorage.getItem(DRAFT_KEY),
           before: document.getElementById('log').textContent,
           cls: document.getElementById('log').className,
           stages: Array.from(document.getElementById('stageBar').children).map(b=> b.className) };
}, { fill: FILL, fake: FAKE_IMAGES });

if(!saved.raw) errors.push('入力しても下書きが保存されません');
else {
  const d = JSON.parse(saved.raw);
  for(const [id, v] of Object.entries(FILL))
    if(String(d.f[id]) !== String(v)) errors.push(`下書きに ${id} が入っていません(${JSON.stringify(d.f[id])})`);
  // 絵・動画は入れない(容量。file 欄はそもそも値を戻せない)
  if(/data:image|base64/.test(saved.raw)) errors.push('下書きに画像が入っています(localStorage に入れてはいけません)');
  if(saved.raw.length > 20000) errors.push(`下書きが大きすぎます(${saved.raw.length}バイト)`);
  // GitHub の設定は別管理(aramon_gh_*)のまま
  for(const id of ['tok','repo','branch'])
    if(id in d.f) errors.push(`下書きに GitHub の設定 ${id} が入っています(別管理のはず)`);
  // 「どれを開くか」は GitHub から読み直さないと中身が入らないので入れない
  for(const id of ['e_target','a_target','aw_base'])
    if(id in d.f) errors.push(`下書きに ${id} が入っています(読み直しが要る項目のはず)`);
}
if(saved.cls === 'ng') errors.push('差分の確認で止まりました:\n' + saved.before);

/* ④ 段階バーは state.* を読んでいるか。
   絵を入れて差分の確認まで通したので、7段すべてが「済」になっているはず。 */
if(saved.stages.join(',') !== 'ok,ok,ok,ok,ok,ok,ok')
  errors.push(`段階バーが全部「済」になりません: ${saved.stages.join(',')}`);

// ---------------------------------------------------------------- ② 読み込み直して復元
await page.reload({ waitUntil:'load' });
await page.waitForFunction(()=> typeof window.boot === 'function');

const restored = await page.evaluate(async ({ fake })=>{
  eval(fake);
  const asked = document.getElementById('draftBar').style.display !== 'none';
  const askText = document.getElementById('draftWhen').textContent;
  // 復元する前は、まっさらな欄に戻っている(=聞かずに勝手に入れていない)
  const cleanKey = document.getElementById('f_key').value;
  const stagesBefore = Array.from(document.getElementById('stageBar').children).map(b=> b.className);
  draftRestore();
  await window.__fakeImages();
  await preflight();
  return { asked, askText, cleanKey, stagesBefore,
           key: document.getElementById('f_key').value,
           mode: document.getElementById('mode').value,
           after: document.getElementById('log').textContent,
           cls: document.getElementById('log').className,
           left: localStorage.getItem(DRAFT_KEY) != null };
}, { fake: FAKE_IMAGES });

if(!restored.asked) errors.push('読み込み直しても「前回の続き」を聞かれません');
if(restored.cleanKey) errors.push(`聞く前に欄へ入れています(f_key=${restored.cleanKey})`);
if(restored.stagesBefore.slice(2).join(',') === 'ok,ok,ok,ok,ok')
  errors.push('復元する前から段階バーが「済」です(state を読んでいません)');
if(restored.key !== FILL.f_key) errors.push(`復元しても f_key が ${restored.key} です`);
if(restored.mode !== FILL.mode) errors.push(`復元しても抜き方が ${restored.mode} です`);
if(restored.cls === 'ng') errors.push('復元後の差分の確認で止まりました:\n' + restored.after);
if(saved.before !== restored.after){
  const a = (saved.before||'').split('\n'), b = (restored.after||'').split('\n');
  const diff = [];
  for(let i = 0; i < Math.max(a.length, b.length); i++)
    if(a[i] !== b[i]) diff.push(`  ${i+1}行目\n   前: ${a[i]}\n   後: ${b[i]}`);
  errors.push('復元しても差分の確認の文が一致しません(E2の受け入れ条件):\n' + diff.slice(0, 6).join('\n'));
}

/* ---------------------------------------------------------------- ③' 答えずに打ち始めたら
   問いを出したまま保存を止め続けると、打ち込んだぶんが1文字も残らない。
   打ち始めた時点で問いは引っ込め、その入力から保存を再開する。 */
await page.reload({ waitUntil:'load' });
await page.waitForFunction(()=> typeof window.boot === 'function');
const typed = await page.evaluate(()=>{
  const asked = document.getElementById('draftBar').style.display !== 'none';
  const el = document.getElementById('f_key');
  el.value = 'typedmon';
  el.dispatchEvent(new Event('input', { bubbles:true }));
  const shown = document.getElementById('draftBar').style.display !== 'none';
  saveDraft();
  const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
  return { asked, shown, key: d.f && d.f.f_key };
});
if(!typed.asked) errors.push('打ち始める前に「前回の続き」を聞かれていません');
if(typed.shown)  errors.push('問いを出したまま打ち始めても問いが引っ込みません');
if(typed.key !== 'typedmon')
  errors.push(`問いに答えずに打った入力が保存されません(${JSON.stringify(typed.key)})`);

// ---------------------------------------------------------------- ③ 捨てる
await page.reload({ waitUntil:'load' });
await page.waitForFunction(()=> typeof window.boot === 'function');
const discarded = await page.evaluate(()=>{
  const asked = document.getElementById('draftBar').style.display !== 'none';
  draftDiscard();
  return { asked, left: localStorage.getItem(DRAFT_KEY) != null,
           shown: document.getElementById('draftBar').style.display !== 'none' };
});
if(!discarded.asked) errors.push('2回目の読み込みで「前回の続き」を聞かれません');
if(discarded.left)   errors.push('「捨てて新しく始める」を押しても下書きが残っています');
if(discarded.shown)  errors.push('「捨てて新しく始める」を押しても問いが消えません');

await page.reload({ waitUntil:'load' });
await page.waitForFunction(()=> typeof window.boot === 'function');
const afterDiscard = await page.evaluate(()=> document.getElementById('draftBar').style.display !== 'none');
if(afterDiscard) errors.push('捨てたあとにも「前回の続き」を聞かれます');

await browser.close();
server.close();

if(args.includes('--json'))
  console.log(JSON.stringify({ saved: { ...saved, before:undefined }, restored: { ...restored, after:undefined } }, null, 1));
console.log('下書き(前回の続き)と段階バーの検査');
console.log(`  ① 自動保存: ${saved.raw ? saved.raw.length : 0}バイト(画像なし・GitHubの設定なし)`);
console.log(`  ② 復元: ${restored.askText}`);
console.log(`     差分の確認の文: ${saved.before === restored.after ? '一致' : '不一致'}`
  + `(${(saved.before||'').split('\n').length}行)`);
console.log(`  ③ 答えずに打ち始めた: 問いは${typed.shown ? '出たまま' : '引っ込む'} / 保存された値 ${typed.key}`);
console.log(`     捨てる: 残り${discarded.left ? 'あり' : 'なし'} / 次に開いて聞かれ${afterDiscard ? 'る' : 'ない'}`);
console.log(`  ④ 段階バー: 復元前 ${restored.stagesBefore.join(',')} → 用意後 ${saved.stages.join(',')}`);
if(errors.length){
  console.log(`\n問題が ${errors.length} 件あります:`);
  for(const e of errors) console.log('  - ' + e);
  process.exit(1);
}
console.log('すべて合格');
