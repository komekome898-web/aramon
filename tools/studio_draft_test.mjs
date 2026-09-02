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
     ④ 段階バーが state.* を読んで 未 → 済 へ変わる(新しい状態を持っていない)。
        **useFrames / buildPortraits の直後に log() を挟まず読む** —— 段の出し直しを
        log() の中だけに載せていたので、歩行・静止画の成功経路(log を通らない)では
        済にならなかった(§指摘1)。
     ⑤ 送信の段は**送信の結果だけ**を見る。#log は全画面共通なので、歩行や静止画の
        失敗で赤くなった log を読むと送信段まで赤くなっていた(§指摘2)。
     ⑥ 「登録済みを開いて直す」中の入力は下書きに入らない・戻さない(§指摘5)。
        相手(e_target)は GitHubから読み直さないと中身が入らないので欄だけ戻しても嘘になり、
        しかも state.editFilled が立たないまま値が残るので、新規へ切り替えても既定に戻らない。

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

/* 本物の絵。④で **useFrames / buildPortraits を実際に通す**ために要る
   (state へ直に入れてしまうと、成功経路が段階バーを出し直すかどうかを見られない)。
   白背景・中央に色の付いた体 —— 抜き方は「白背景」で通る。 */
const REAL_IMAGES = `
  window.__png = async function(i){
    const c = document.createElement('canvas'); c.width = c.height = 200;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 200, 200);
    g.fillStyle = '#3355cc'; g.fillRect(70 + i*4, 30, 60, 140);   // コマごとに横へずらす
    g.fillStyle = '#cc4433'; g.fillRect(80 + i*4, 40, 40, 40);
    return await new Promise(r=> c.toBlob(r, 'image/png'));
  };
  window.__frames8 = async function(){
    const out = []; for(let i = 0; i < 8; i++) out.push(await window.__png(i));
    return out;
  };`;

// 段階バーの並び(STAGES と同じ順)。読むときに番号を数え間違えないように名前で引く
const STAGE_IX = { 接続:0, 種類:1, 歩行:2, 静止:3, 仕様:4, 技:5, 送信:6 };
const readStages = ()=> page.evaluate(()=>
  Array.from(document.getElementById('stageBar').children).map(b => b.className));
/* 段の出し直しは**1フレームに1回**へ束ねてある(§指摘12)ので、読む前に1フレーム待つ。
   待つのは読み手の都合で、束ねた側の遅れは人の目には見えない。 */
const settle = ()=> page.waitForTimeout(150);

/* 埋める値は **draftFields() から作る**(§指摘14)。手で並べた表にしていると、
   欄を足したときに検査の目が届かない欄が黙って増える。型ごとに「今と違う値」を作り、
   形の決まっている欄(key・特性id・色)だけ FILL_FIX で上書きする。
   FILL_SKIP は「選ぶと**別の欄の中身を上書きする**」欄(下書き側の DRAFT_RERUN と同じ理由)。 */
const FILL_FIX = { f_key:'draftmon', f_trait:'drafttrait',
                   f_color:'#123456', f_dark:'#0a1b2c', f_accent:'#fedcba' };
const FILL_SKIP = ['regKind', 'f_scPreset'];

/* boot() は **差し替え前の本物の gh** で api.github.com を叩く(差し替えは DOMContentLoaded)。
   外へ出られると結果がいつ返るか分からず、接続の段が揺れる。**必ずその場で失敗させて**、
   このあと検査が自分で呼ぶ saveToken() の結果だけが残るようにする。 */
await page.route('**://api.github.com/**', r => r.abort());

await page.goto(ORIGIN + '/tools/studio_web.html', { waitUntil:'load' });
await page.waitForFunction(()=> typeof window.boot === 'function');

/* ---------------------------------------------------------------- ④ 段階バー(成功経路)
   歩行と静止画は **log() を通らずに終わる**。段の出し直しを log() の中だけに載せていたので、
   8コマができても静止画が整っても段は「未」のままだった(§指摘1)。 */
await page.evaluate(async ({ real })=>{
  eval(real);
  const frames = await window.__frames8();
  // ここから読み終わるまで log() を呼ばない(呼ぶと段が出し直されて、この検査が意味を失う)
  await useFrames('f', frames, '検査');
  await useFrames('b', frames, '検査');
}, { real: REAL_IMAGES });
await settle();
const stageWalk = await readStages();
if(stageWalk[STAGE_IX.歩行] !== 'ok')
  errors.push(`useFrames のあとも「歩行」の段が ${stageWalk[STAGE_IX.歩行]} です(段の出し直しが log 頼み)`);

const portraitNote = await page.evaluate(async ()=>{
  const blob = await window.__png(0);
  const dt = new window.DataTransfer();
  dt.items.add(new File([blob], 'icon.png', { type:'image/png' }));
  document.getElementById('imgIcon').files = dt.files;
  document.getElementById('pmode').value = 'white';   // モデル(44MB)を取りに行かせない
  await buildPortraits();
  return document.getElementById('portraitMeta').textContent;
});
await settle();
const stagePortrait = await readStages();
if(stagePortrait[STAGE_IX.静止] !== 'ok')
  errors.push(`buildPortraits のあとも「静止」の段が ${stagePortrait[STAGE_IX.静止]} です`
    + `(その場の表示: ${portraitNote})`);

/* ---------------------------------------------------------------- ⑤ 送信の段は送信だけを見る
   #log は全画面共通なので、歩行の失敗を log(…,'ng') で出すと送信段まで赤くなっていた。 */
await page.evaluate(()=> log('歩行でしくじりました(検査)', 'ng'));
await settle();
const stageOtherNg = await readStages();
if(stageOtherNg[STAGE_IX.送信] === 'ng')
  errors.push('他のパネルの失敗で「送信」の段が赤くなります(#log の色を段に使っている)');

// ---------------------------------------------------------------- ① 溜まる / 入らない物
await page.reload({ waitUntil:'load' });
await page.waitForFunction(()=> typeof window.boot === 'function');

const saved = await page.evaluate(async ({ fake, fix, skip })=>{
  eval(fake);
  // 差し替えた gh で接続し直す(boot の中の接続は本物の api.github.com へ出るので当てにしない)
  await saveToken();
  /* 型ごとに「今と違う値」を作る。**range のように丸められる欄がある**ので、
     入れたあとに欄から読み直した値を「入っているべき値」にする。 */
  const made = el =>{
    if(fix[el.id] !== undefined) return fix[el.id];
    if(el.type === 'checkbox') return !el.checked;
    if(el.tagName === 'SELECT'){
      const o = Array.from(el.options).map(x => x.value);
      const v = o.find(x => x !== el.value);
      return v === undefined ? el.value : v;
    }
    if(el.type === 'color') return '#123456';
    if(el.type === 'number' || el.type === 'range' || el.inputMode === 'decimal'){
      const step = +(el.step || 1) || 1;
      const cur = el.value !== '' ? +el.value : (el.placeholder !== '' ? +el.placeholder : 0);
      let n = Math.round(((isNaN(cur) ? 0 : cur) + step) * 100) / 100;
      if(el.max !== '' && n > +el.max) n = el.min !== '' ? +el.min : 0;
      return String(n);
    }
    if(/^#[0-9a-fA-F]{3,8}$/.test(el.value || el.placeholder || '')) return '#123456';
    return 'ど' + el.id;
  };
  for(const el of draftFields()){
    if(skip.indexOf(el.id) >= 0) continue;
    const v = made(el);
    if(el.type === 'checkbox') el.checked = !!v; else el.value = v;
    el.dispatchEvent(new Event('change', { bubbles:true }));
  }
  // 欄から読み直した姿が「下書きに入っているべき値」
  const want = {};
  for(const el of draftFields()) want[el.id] = el.type === 'checkbox' ? !!el.checked : el.value;
  saveDraft();                       // 打ち終わりを待たずにその場で書く(検査なので)
  await window.__fakeImages();
  await preflight();
  return { raw: localStorage.getItem(DRAFT_KEY), want,
           before: document.getElementById('log').textContent,
           cls: document.getElementById('log').className };
}, { fake: FAKE_IMAGES, fix: FILL_FIX, skip: FILL_SKIP });
await settle();
saved.stages = await readStages();

if(!saved.raw) errors.push('入力しても下書きが保存されません');
else {
  const d = JSON.parse(saved.raw);
  const missing = Object.keys(saved.want).filter(k => String(d.f[k]) !== String(saved.want[k]));
  if(missing.length)
    errors.push(`下書きに入っていない(値が違う)欄が ${missing.length} 件: `
      + missing.slice(0, 8).map(k => `${k}=${JSON.stringify(d.f[k])}(欄は ${JSON.stringify(saved.want[k])})`).join(' / '));
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
  const now = {};
  for(const el of draftFields()) now[el.id] = el.type === 'checkbox' ? !!el.checked : el.value;
  await window.__fakeImages();
  await preflight();
  return { asked, askText, cleanKey, stagesBefore, now,
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
if(restored.key !== FILL_FIX.f_key) errors.push(`復元しても f_key が ${restored.key} です`);
{
  const back = Object.keys(saved.want).filter(k => String(restored.now[k]) !== String(saved.want[k]));
  if(back.length)
    errors.push(`復元しても元に戻らない欄が ${back.length} 件: `
      + back.slice(0, 8).map(k => `${k}=${JSON.stringify(restored.now[k])}(入れたのは ${JSON.stringify(saved.want[k])})`).join(' / '));
}
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
   打ち始めた時点で問いは引っ込め、その入力から保存を再開する。
   **黙って捨てない** —— 何が起きたかを log に出し、1世代だけ別キーへ退避する(§指摘6)。 */
await page.reload({ waitUntil:'load' });
await page.waitForFunction(()=> typeof window.boot === 'function');
const typed = await page.evaluate(()=>{
  const asked = document.getElementById('draftBar').style.display !== 'none';
  const el = document.getElementById('f_key');
  el.value = 'typedmon';
  el.dispatchEvent(new Event('input', { bubbles:true }));
  const shown = document.getElementById('draftBar').style.display !== 'none';
  const said = document.getElementById('log').textContent;
  const prev = localStorage.getItem(DRAFT_PREV_KEY);
  saveDraft();
  const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
  return { asked, shown, said, prev, key: d.f && d.f.f_key };
});
if(!typed.asked) errors.push('打ち始める前に「前回の続き」を聞かれていません');
if(typed.shown)  errors.push('問いを出したまま打ち始めても問いが引っ込みません');
if(typed.key !== 'typedmon')
  errors.push(`問いに答えずに打った入力が保存されません(${JSON.stringify(typed.key)})`);
if(!/前回の入力は使わず/.test(typed.said || ''))
  errors.push(`前回の下書きを捨てたことを知らせません(log: ${JSON.stringify(typed.said)})`);
if(!typed.prev) errors.push('捨てる前の下書きが1世代も退避されていません');

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

/* ---------------------------------------------------------------- ⑥ 開いて直すは対象外
   相手(e_target)を戻せない以上、欄だけ戻しても嘘になる。しかも欄に値が残ったまま
   state.editFilled が立たないので、新規へ切り替えても既定へ戻らなくなる(§指摘5)。 */
const edited = await page.evaluate(()=>{
  localStorage.removeItem(DRAFT_KEY);
  const k = document.getElementById('regKind');
  k.value = 'edit'; k.onchange();
  const hp = document.getElementById('f_hp'), def = hp.value;
  hp.value = '777';
  hp.dispatchEvent(new Event('input', { bubbles:true }));
  saveDraft();
  return { def, raw: localStorage.getItem(DRAFT_KEY) };
});
await page.waitForTimeout(600);      // saveDraftSoon(400ms)が後から書かないことも見る
const editedRaw = await page.evaluate(()=> localStorage.getItem(DRAFT_KEY));
if(edited.raw || editedRaw)
  errors.push(`「開いて直す」中の入力が下書きに入っています: ${String(edited.raw || editedRaw).slice(0, 120)}`);

await page.reload({ waitUntil:'load' });
await page.waitForFunction(()=> typeof window.boot === 'function');
const afterEdit = await page.evaluate(()=>{
  const asked = document.getElementById('draftBar').style.display !== 'none';
  const k = document.getElementById('regKind');
  k.value = 'monster'; k.onchange();      // 新規へ切り替える
  return { asked, hp: document.getElementById('f_hp').value };
});
if(afterEdit.asked) errors.push('「開いて直す」中の入力について「前回の続き」を聞かれます');
if(afterEdit.hp !== edited.def)
  errors.push(`新規へ切り替えても HP が既定に戻りません(${afterEdit.hp} / 既定 ${edited.def})`);

await browser.close();
server.close();

if(args.includes('--json'))
  console.log(JSON.stringify({ saved: { ...saved, before:undefined }, restored: { ...restored, after:undefined } }, null, 1));
console.log('下書き(前回の続き)と段階バーの検査');
console.log(`  ① 自動保存: ${saved.raw ? saved.raw.length : 0}バイト / ${Object.keys(saved.want).length}欄`
  + '(画像なし・GitHubの設定なし)');
console.log(`  ② 復元: ${restored.askText}`);
console.log(`     差分の確認の文: ${saved.before === restored.after ? '一致' : '不一致'}`
  + `(${(saved.before||'').split('\n').length}行)`);
console.log(`  ③ 答えずに打ち始めた: 問いは${typed.shown ? '出たまま' : '引っ込む'} / 保存された値 ${typed.key}`
  + ` / 退避${typed.prev ? 'あり' : 'なし'}`);
console.log(`     捨てる: 残り${discarded.left ? 'あり' : 'なし'} / 次に開いて聞かれ${afterDiscard ? 'る' : 'ない'}`);
console.log(`  ④ 段階バー: 復元前 ${restored.stagesBefore.join(',')} → 用意後 ${saved.stages.join(',')}`);
console.log(`     歩行の成功直後 ${stageWalk.join(',')} / 静止画の成功直後 ${stagePortrait.join(',')}`);
console.log(`  ⑤ 他パネルが失敗したとき: ${stageOtherNg.join(',')}(送信の段は ${stageOtherNg[STAGE_IX.送信]})`);
console.log(`  ⑥ 開いて直す: 下書きに入ら${(edited.raw || editedRaw) ? 'れた' : 'ない'}`
  + ` / 新規へ切り替えた HP ${afterEdit.hp}(既定 ${edited.def})`);
if(errors.length){
  console.log(`\n問題が ${errors.length} 件あります:`);
  for(const e of errors) console.log('  - ' + e);
  process.exit(1);
}
console.log('すべて合格');
