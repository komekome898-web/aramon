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
     ⑦ 1世代前の退避に**読み手がいる**(§指摘20)。退避があるときだけ
        「もっと前の入力に戻す」を出す。**戻すのは入れ替え**(§指摘30) —— 戻したあと
        退避には元の下書きが入り、もう一度押すと行き来できる(黙って上書きしない)。
        今の下書きが無いときだけ「移動」になり退避は空になる(§指摘31)
     ⑧ 送信の段は**送信の失敗を先に見る**(§指摘17)。doCommit がしくじっても
        state.files は残るので、state.files を先に見ると失敗が「済」のままだった。
        **「本当に失敗した状態か」まで見る**(§指摘36) —— state.files が残っていること・
        log の1行目が「コミットに失敗しました」であることを確かめないと、
        送信が別の理由で止まっただけでも⑧が通ってしまう
     ⑨ **下書きに入らない欄を触っても捨てない**(§指摘29)。GitHubのトークンのように
        下書きと関係ない欄を1文字直しただけで前回の続きが消え、問いも一緒に消えて
        取り戻す道が無くなっていた

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

/* 「いま**今の下書きについて聞いている**か」。§指摘31 でバーは「退避だけの姿」
   (=「もっと前の入力に戻す」だけ)でも出るようになったので、draftBar の display だけでは
   問いの有無を見分けられない。問いが出ている印は「前回の続きから始める」が押せること。 */
const askShown = ()=> page.evaluate(()=>
  document.getElementById('draftBar').style.display !== 'none'
  && document.getElementById('draftRestoreBtn').style.display !== 'none');

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
/* mode は**わざと「boot が既定として当てた値」と同じ 'chroma'** にする(§波4-36)。
   一般の made() は「今と違う値」を作るので、この組(復元値=既定値)だけは通らない。
   walkSrc は made() が 'image' にするので、復元は
   「抜き方=色で抜く / 素材=画像」= 画像の既定 'auto' と食い違う組になり、
   `walkSrc` の出し分けが「まだ触っていない」と誤読して 'auto' へ戻す道が通る。 */
const FILL_FIX = { f_key:'draftmon', f_trait:'drafttrait', mode:'chroma',
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

/* ---------------------------------------------------------------- ⑧ 送信の失敗で赤くなるか
   doCommit がしくじっても state.files は残る(押し直せるように残してある)ので、
   段が state.files を先に見ていると、**一度 preflight が通ったあとの送信の失敗が
   全部「済」のまま**になっていた(§指摘17)。直したら「差分を確認する」を
   押し直して緑へ戻ることまで見る(409 = 送信先が先に進んだ、の直し方そのもの)。 */
const sendFailCase = await page.evaluate(async ()=>{
  const real = window.gh;
  // コミットの API(/git/…)だけ 409 を返す。取得(/contents/…)は今までどおり通す
  window.gh = async (p, o)=>{
    if(/\/git\//.test(p)) throw new Error('GitHub 409: Update is not a fast forward');
    return real(p, o);
  };
  await doCommit();
  window.gh = real;
  return { said: document.getElementById('log').textContent,
           files: !!state.files, sendNg: !!state.sendNg };
});
await settle();
const stageSendNg = await readStages();
const sendFailLine = (sendFailCase.said || '').split('\n')[0];
/* **「本当に送信で失敗した状態か」を先に確かめる**(§指摘36)。段が赤いことだけを見ていると、
   送信まで行かずに別の理由で止まった場合(state.files が消えて「まだ」になっただけ、
   確認の段で弾かれただけ)でも⑧が通ってしまい、見たかった「files は残るのに赤い」を見ていない。 */
if(sendFailCase.files !== true)
  errors.push('コミットに失敗したのに state.files が残っていません'
    + '(押し直せるように残す作りのはず。⑧が見たい状態になっていません)');
if(!/^コミットに失敗しました/.test(sendFailLine))
  errors.push(`コミットの失敗が log の1行目に出ていません: ${JSON.stringify(sendFailLine)}`);
if(stageSendNg[STAGE_IX.送信] !== 'ng')
  errors.push(`コミットに失敗しても「送信」の段が ${stageSendNg[STAGE_IX.送信]} です`
    + `(state.files=${sendFailCase.files} / sendNg=${sendFailCase.sendNg} / log: `
    + `${JSON.stringify(sendFailLine)})`);
// 直す = もう一度「差分を確認する」。通ったら段は緑へ戻る
await page.evaluate(async ()=> { await preflight(); });
await settle();
const stageSendBack = await readStages();
if(stageSendBack[STAGE_IX.送信] !== 'ok')
  errors.push(`確認し直しても「送信」の段が ${stageSendBack[STAGE_IX.送信]} のままです`);

/* ⑧' **確認に失敗したら「送る中身」を捨てる**(§波5-41)。preflight が途中で止まる2経路
   (取得などの例外 / 数字として読めない欄)は state.files を消していなかったので、
   一度通した**古い計画**がそのまま残り、コミットのボタンも押せるままだった
   —— 直したつもりの中身ではなく、前の中身を本番へ送れてしまう。 */
const preflightFail = await page.evaluate(async ()=>{
  const out = {};
  const real = window.gh;
  // (a) 取得で落ちる経路(catch)
  window.gh = async (p, o)=>{
    if(/\/contents\//.test(p)) throw new Error('GitHub 500: 検査');
    return real(p, o);
  };
  await preflight();
  window.gh = real;
  out.errFiles = !!state.files;
  out.errDisabled = document.getElementById('commitBtn').disabled;
  await preflight();                       // いったん通し直して「送る中身」を作り直す
  out.okFiles = !!state.files;
  // (b) 数字として読めない欄で止まる経路(bad)
  const dmg = document.getElementById('m0_dmg');
  const keep = dmg.value;
  dmg.value = 'あ';
  await preflight();
  out.badFiles = !!state.files;
  out.badDisabled = document.getElementById('commitBtn').disabled;
  dmg.value = keep;
  await preflight();                       // あとの検査のために元へ戻す
  return out;
});
await settle();
if(preflightFail.okFiles !== true)
  errors.push('⑧\' の途中で「差分を確認する」が通りません(この検査が見たい状態になっていません)');
if(preflightFail.errFiles || !preflightFail.errDisabled)
  errors.push('確認が例外で止まったのに前の「送る中身」が残っています(§波5-41): '
    + `state.files=${preflightFail.errFiles} / commitBtn.disabled=${preflightFail.errDisabled}`);
if(preflightFail.badFiles || !preflightFail.badDisabled)
  errors.push('数字として読めない欄で止めたのに前の「送る中身」が残っています(§波5-41): '
    + `state.files=${preflightFail.badFiles} / commitBtn.disabled=${preflightFail.badDisabled}`);

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
           // 「色で抜く」を戻したなら背景色の欄も出ていること(§波4-36。値だけ戻して出し分けが置いていかれる)
           chromaShown: getComputedStyle(document.getElementById('chromaWrap')).display !== 'none',
           th: document.getElementById('th').value,
           after: document.getElementById('log').textContent,
           cls: document.getElementById('log').className,
           left: localStorage.getItem(DRAFT_KEY) != null };
}, { fake: FAKE_IMAGES });

if(!restored.asked) errors.push('読み込み直しても「前回の続き」を聞かれません');
if(restored.cleanKey) errors.push(`聞く前に欄へ入れています(f_key=${restored.cleanKey})`);
if(restored.stagesBefore.slice(2).join(',') === 'ok,ok,ok,ok,ok')
  errors.push('復元する前から段階バーが「済」です(state を読んでいません)');
if(restored.key !== FILL_FIX.f_key) errors.push(`復元しても f_key が ${restored.key} です`);
/* 抜き方まわりは**下の一括の突き合わせでも見えるが、壊れたときにどこが壊れたかが
   一目で分かるように名指しで出す**(§指摘33 / §波4-36)。
   ・#mode … 「まだ既定のままか」は**画面の値**で見る(walkModeUntouched)ので、
     DRAFT_RERUN の並びには依存しない。ここが違うなら、戻した値そのものが
     どこかで既定に上書きされている
   ・#chromaWrap … 値は戻っているのに**出し分けが置いていかれる**道がある。
     戻した抜き方が boot の当てた既定と同じ値だと、`walkSrc` の出し分けが
     「まだ触っていない」と読んで 'auto' へ戻し、最後の put() は値だけ戻す(イベントが飛ばない)
   ・#th  … `mode` の出し分けは**しきい値を既定へ戻す**ので、
     「入れる → 出し分け → 入れ直す」の**最後の入れ直し(put)**が無いと消える */
if(restored.mode !== saved.want.mode)
  errors.push(`復元しても #mode が ${restored.mode} です(下書きは ${saved.want.mode}`
    + ' / 戻した抜き方が既定に上書きされていないか)');
if(restored.mode === 'chroma' && !restored.chromaShown)
  errors.push('「色で抜く」を戻したのに背景色の欄(#chromaWrap)が出ていません'
    + '(§波4-36 / 最後の put() のあとに #mode の出し分けを通しているか)');
if(String(restored.th) !== String(saved.want.th))
  errors.push(`復元しても #th(しきい値)が ${restored.th} です(下書きは ${saved.want.th}`
    + ' / 出し分けのあとに入れ直しているか)');
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

/* ---------------------------------------------------------------- ⑨ 関係ない欄では捨てない
   「触ったら前回の続きを捨てる」を**画面のどの欄でも**やっていたので(§指摘29)、
   GitHubのトークンのように下書きに入らない欄を1文字直しただけで前回の続きが消え、
   しかも問いまで引っ込むので**取り戻す道が画面から無くなっていた**。
   捨ててよいのは「下書きに入る欄を触ったとき」だけ(判定は draftFields と同じ根)。 */
await page.reload({ waitUntil:'load' });
await page.waitForFunction(()=> typeof window.boot === 'function');
const otherField = await page.evaluate(()=>{
  const asked = document.getElementById('draftBar').style.display !== 'none';
  const t = document.getElementById('tok');          // GitHubのトークン = 下書きに入らない欄
  t.value = 'github_pat_touched';
  t.dispatchEvent(new Event('input', { bubbles:true }));
  return { asked, shown: document.getElementById('draftBar').style.display !== 'none',
           left: localStorage.getItem(DRAFT_KEY) != null,
           said: document.getElementById('log').textContent };
});
await page.waitForTimeout(600);       // 400ms後の自動保存より後まで待つ(消えたのが遅れて出ないか)
const otherLeft = await page.evaluate(()=> localStorage.getItem(DRAFT_KEY) != null);
if(!otherField.asked) errors.push('⑨ の入口で「前回の続き」を聞かれていません');
if(!otherField.left || !otherLeft)
  errors.push('下書きに入らない欄(#tok)を触っただけで前回の続きが消えます(§指摘29)');
if(!otherField.shown)
  errors.push('下書きに入らない欄(#tok)を触っただけで問いが引っ込みます(§指摘29 / 取り戻す道が無くなる)');
if(/前回の入力は使わず/.test(otherField.said || ''))
  errors.push('下書きに入らない欄(#tok)を触っただけで「前回の入力は使わず…」と言います(§指摘29)');

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

/* ---------------------------------------------------------------- ⑦ もっと前の入力に戻す
   1世代の退避は置くだけで**読み手がいなかった**(§指摘20)。取り違えて打ち始めた人の
   逃げ道なので、退避があるときだけ draftBar に道を出す。
   **戻すのは「入れ替え」**(§指摘30) —— 黙って上書きしていたので、押し間違えると
   今度は**いま打ち込んだぶん**が取り戻せなくなっていた(逃げ道が次の事故を作る)。
   ここまでで 今の下書き=typedmon / 退避=①で入れたぶん(draftmon)になっている。 */
await page.reload({ waitUntil:'load' });
await page.waitForFunction(()=> typeof window.boot === 'function');
const keyOf = raw => { try{ const d = JSON.parse(raw || 'null'); return d && d.f && d.f.f_key; }catch(e){ return null; } };
const prevBack = await page.evaluate(async ()=>{
  const btn = document.getElementById('draftPrevBtn');
  const shownBefore = !!btn && btn.style.display !== 'none';
  draftRestorePrev();
  await new Promise(r => setTimeout(r, 600));      // saveDraftSoon(400ms)が新しい下書きを書くまで
  const after = { key: document.getElementById('f_key').value,
                  cur: localStorage.getItem(DRAFT_KEY), prev: localStorage.getItem(DRAFT_PREV_KEY),
                  said: document.getElementById('log').textContent,
                  /* 「もう一度押すと入れ替えて戻せます」と言った直後に、そのボタンが
                     **画面に出ているか**(§波5-38)。display だけでなく親ごと隠れていないかを見る */
                  stillShown: btn.offsetParent !== null };
  draftRestorePrev();                               // もう一度押す = 入れ替えて元へ戻る
  await new Promise(r => setTimeout(r, 600));
  return { shownBefore, ...after,
           backKey: document.getElementById('f_key').value,
           backPrev: localStorage.getItem(DRAFT_PREV_KEY) };
});
if(!prevBack.shownBefore) errors.push('退避があるのに「もっと前の入力に戻す」が出ません(§指摘20)');
if(prevBack.key !== FILL_FIX.f_key)
  errors.push(`「もっと前の入力に戻す」で戻りません(f_key=${prevBack.key} / 退避は ${FILL_FIX.f_key})`);
if(keyOf(prevBack.cur) !== FILL_FIX.f_key)
  errors.push(`戻したのに今の下書きが入れ替わっていません(f_key=${keyOf(prevBack.cur)})`);
// **入れ替え**: 戻したあと、退避には「いま入っていた下書き」が入っている(§指摘30)
if(keyOf(prevBack.prev) !== 'typedmon')
  errors.push('戻したときに、いま入っていた下書きが退避へ入りません(§指摘30 / 黙って上書きしている): '
    + `退避の f_key=${JSON.stringify(keyOf(prevBack.prev))}`);
if(!prevBack.stillShown)
  errors.push('「もう一度押すと入れ替えて戻せます」と言いながら、そのボタンが画面から消えます(§波5-38)');
if(!/1つ前として控え/.test(prevBack.said || ''))
  errors.push(`入れ替えたことを知らせません(log: ${JSON.stringify((prevBack.said||'').split('\n').slice(-2).join(' / '))})`);
// もう一度押せば行き来できる(2つを往復するだけで、どちらも失わない)
if(prevBack.backKey !== 'typedmon' || keyOf(prevBack.backPrev) !== FILL_FIX.f_key)
  errors.push(`もう一度押しても行き来できません(f_key=${prevBack.backKey} / 退避=${keyOf(prevBack.backPrev)})`);

/* ---------------------------------------------------------------- ③'' 「消えました」は本当か
   draftDismiss は「前回の続きは消えました」と言うのに下書きを消していなかった(§指摘19)。
   ふつうは次の自動保存が上書きするので気づけないが、**「登録済みを開いて直す」中は
   saveDraft が早期 return する**ので上書きすら起きず、次に開くと同じ問いがまた出る。
   種類を切り替える操作そのものが「答えずに触った」に当たるので、それで再現する。 */
await page.reload({ waitUntil:'load' });
await page.waitForFunction(()=> typeof window.boot === 'function');
const dismissed = await page.evaluate(async ()=>{
  const raw = localStorage.getItem(DRAFT_KEY);
  const asked = document.getElementById('draftBar').style.display !== 'none';
  const k = document.getElementById('regKind');
  k.value = 'edit';
  k.dispatchEvent(new Event('change', { bubbles:true }));   // 人が種類を切り替えたのと同じ
  await new Promise(r => setTimeout(r, 700));               // saveDraftSoon(400ms)より後まで待つ
  return { raw, asked, left: localStorage.getItem(DRAFT_KEY) };
});
if(!dismissed.asked) errors.push('③\'\' の入口で「前回の続き」を聞かれていません');
if(dismissed.left)
  errors.push('「前回の続きは消えました」と言ったのに下書きが残っています(§指摘19): '
    + String(dismissed.left).slice(0, 80));
await page.reload({ waitUntil:'load' });
await page.waitForFunction(()=> typeof window.boot === 'function');
const askedAgain = await askShown();
if(askedAgain) errors.push('「消えました」と言われた下書きを、次に開いてもまた聞かれます(§指摘19)');
// このあとの ③ が使う下書きを戻す(ここで見たいのは「消えること」だけ)
await page.evaluate(raw => raw && localStorage.setItem(DRAFT_KEY, raw), dismissed.raw);

/* ---------------------------------------------------------------- ③ 捨てる
   **捨てた直後こそ退避へ行く道がいちばん要る**(§指摘31)。「捨てて新しく始める」の
   押し間違いはここでしか起きないのに、バーごと閉じていたので画面から道が消えていた。
   問い(「前回の続きから始める」)は消え、退避があるなら道だけが残るのが正しい姿。 */
await page.reload({ waitUntil:'load' });
await page.waitForFunction(()=> typeof window.boot === 'function');
const discarded = await page.evaluate(()=>{
  const asked = document.getElementById('draftBar').style.display !== 'none';
  draftDiscard();
  return { asked, left: localStorage.getItem(DRAFT_KEY) != null,
           askShown: document.getElementById('draftRestoreBtn').style.display !== 'none',
           barShown: document.getElementById('draftBar').style.display !== 'none',
           prevShown: document.getElementById('draftPrevBtn').style.display !== 'none',
           prevLeft: localStorage.getItem(DRAFT_PREV_KEY) != null,
           text: document.getElementById('draftWhen').textContent };
});
if(!discarded.asked)    errors.push('2回目の読み込みで「前回の続き」を聞かれません');
if(discarded.left)      errors.push('「捨てて新しく始める」を押しても下書きが残っています');
if(discarded.askShown)  errors.push('「捨てて新しく始める」を押しても問いが消えません');
if(!discarded.prevLeft) errors.push('③ の「捨てる」で退避が作られていません(§指摘6)');
else {
  if(!discarded.barShown || !discarded.prevShown)
    errors.push('捨てた直後に「もっと前の入力に戻す」が出ません(§指摘31 / 押し間違いを取り戻せない)');
  if(!/1つ前の入力が残っています/.test(discarded.text || ''))
    errors.push(`捨てた直後の文言が違います: ${JSON.stringify(discarded.text)}`);
}

await page.reload({ waitUntil:'load' });
await page.waitForFunction(()=> typeof window.boot === 'function');
const afterDiscard = await askShown();
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
  // 問いの有無はバーの display ではなく「前回の続きから始める」で見る(退避だけの姿があるため)
  const asked = document.getElementById('draftBar').style.display !== 'none'
             && document.getElementById('draftRestoreBtn').style.display !== 'none';
  const k = document.getElementById('regKind');
  k.value = 'monster'; k.onchange();      // 新規へ切り替える
  return { asked, hp: document.getElementById('f_hp').value };
});
if(afterEdit.asked) errors.push('「開いて直す」中の入力について「前回の続き」を聞かれます');
if(afterEdit.hp !== edited.def)
  errors.push(`新規へ切り替えても HP が既定に戻りません(${afterEdit.hp} / 既定 ${edited.def})`);

/* ---------------------------------------------------------------- ⑩ 復元した抜き方は守られる
   復元は `#mode` を直に書き換えていたので、**このツールが既定として入れた印(walkModeAuto)が
   古いまま残った**(§波5-42)。動画×「色で抜く」を戻したあと画像へ切り替えると、
   applyWalkModeDefault() が「まだ既定のままだ」と誤読して画像の既定('auto')で
   上書きしてしまう。#mode へ値を入れるのは setWalkMode 1か所、が守られているかを見る。 */
await page.evaluate(()=>{
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ v:1, at:Date.now(), kind:'monster',
    f: { f_key:'dvmon', walkSrc:'video', mode:'chroma' } }));
});
await page.reload({ waitUntil:'load' });
await page.waitForFunction(()=> typeof window.boot === 'function');
const modeKept = await page.evaluate(()=>{
  draftRestore();
  const restoredMode = document.getElementById('mode').value;
  const src = document.getElementById('walkSrc');
  src.value = 'image';                                     // 人が素材を画像へ切り替えたのと同じ
  src.dispatchEvent(new Event('change', { bubbles:true }));
  return { restoredMode, after: document.getElementById('mode').value };
});
if(modeKept.restoredMode !== 'chroma')
  errors.push(`⑩ 復元した抜き方が入っていません(#mode=${modeKept.restoredMode})`);
if(modeKept.after !== 'chroma')
  errors.push('復元した抜き方が、素材を画像へ切り替えると既定で上書きされます(§波5-42): '
    + `#mode=${modeKept.after}`
    /* 復元は setWalkMode(値) で入れている(直の代入はもう無い)。それでも赤いなら、
       残っているのは setWalkMode 側 —— **すでに同じ値なら何もせず返る**ため
       `walkModeAuto` が古いまま残る。そこは班A''' が直している最中(こちらは触らない)。 */
    + '(復元側は setWalkMode 経由。setWalkMode が「同じ値なら即 return」で '
    + 'walkModeAuto を落とさないのが残りで、班A\'\'\' の修正待ち)');

await browser.close();
server.close();

if(args.includes('--json'))
  console.log(JSON.stringify({ saved: { ...saved, before:undefined }, restored: { ...restored, after:undefined } }, null, 1));
console.log('下書き(前回の続き)と段階バーの検査');
console.log(`  ① 自動保存: ${saved.raw ? saved.raw.length : 0}バイト / ${Object.keys(saved.want).length}欄`
  + '(画像なし・GitHubの設定なし)');
console.log(`  ② 復元: ${restored.askText}`);
console.log(`     差分の確認の文: ${saved.before === restored.after ? '一致' : '不一致'}`
  + `(${(saved.before||'').split('\n').length}行)`
  + ` / 抜き方 ${restored.mode}・背景色の欄は${restored.chromaShown ? '出る' : '出ない'}`);
console.log(`  ③ 答えずに打ち始めた: 問いは${typed.shown ? '出たまま' : '引っ込む'} / 保存された値 ${typed.key}`
  + ` / 退避${typed.prev ? 'あり' : 'なし'}`);
console.log(`  ⑦ もっと前の入力に戻す: 出${prevBack.shownBefore ? 'る' : 'ない'} / 戻した f_key ${prevBack.key}`
  + ` / 退避は ${keyOf(prevBack.prev)} へ入れ替え / もう一度押して ${prevBack.backKey}`);
console.log(`     打ち始めて消した後: 残り${dismissed.left ? 'あり' : 'なし'} / 次に開いて聞かれ${askedAgain ? 'る' : 'ない'}`);
console.log(`     捨てる: 残り${discarded.left ? 'あり' : 'なし'} / 次に開いて聞かれ${afterDiscard ? 'る' : 'ない'}`
  + ` / 捨てた直後の戻る道${discarded.prevShown ? 'あり' : 'なし'}`);
console.log(`  ⑨ 下書きに入らない欄(#tok): 下書き${otherLeft ? '残る' : '消えた'} / 問い${otherField.shown ? '残る' : '消えた'}`);
console.log(`  ⑧ 送信の失敗: 段は ${stageSendNg[STAGE_IX.送信]} → 確認し直して ${stageSendBack[STAGE_IX.送信]}`
  + ` / ${JSON.stringify(sendFailLine)}(state.files ${sendFailCase.files ? '残る' : '消えた'})`);
console.log(`  ④ 段階バー: 復元前 ${restored.stagesBefore.join(',')} → 用意後 ${saved.stages.join(',')}`);
console.log(`     歩行の成功直後 ${stageWalk.join(',')} / 静止画の成功直後 ${stagePortrait.join(',')}`);
console.log(`  ⑤ 他パネルが失敗したとき: ${stageOtherNg.join(',')}(送信の段は ${stageOtherNg[STAGE_IX.送信]})`);
console.log(`  ⑥ 開いて直す: 下書きに入ら${(edited.raw || editedRaw) ? 'れた' : 'ない'}`
  + ` / 新規へ切り替えた HP ${afterEdit.hp}(既定 ${edited.def})`);
console.log(`  ⑧' 確認の失敗: 例外 files=${preflightFail.errFiles}/止${preflightFail.errDisabled}`
  + ` / 赤い欄 files=${preflightFail.badFiles}/止${preflightFail.badDisabled}`);
console.log(`  ⑩ 復元した抜き方: ${modeKept.restoredMode} → 画像へ切り替えて ${modeKept.after}`);
if(errors.length){
  console.log(`\n問題が ${errors.length} 件あります:`);
  for(const e of errors) console.log('  - ' + e);
  process.exit(1);
}
console.log('すべて合格');
