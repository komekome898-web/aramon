/* スタジオ「登録済みを開いて直す」の**画面側**をヘッドレスで通す検査(開発用・ゲームには読み込まない)。

   なぜ node の回帰(tools/studio_regress.mjs の (h))と別に要るか:
     (h) は UI を通さず readExisting → editChangesFor → applyEditChanges だけを見る。
     **欄への入れ方(fillEditForm)と読み方(readEditForm)のずれはそこに映らない。**
     実際、色の欄へ「元の書き方」を入れていて、開いただけで色が引用符ごと二重になった。
     ここは本物のブラウザで studio_web.html を開き、全対象を「開く→そのまま読む」して
     **差分ゼロ**を確かめる。あわせて1体で「直す→差分を確認する」まで通す。

   何を見るか:
     ① 全21体+全SSRを開いて、入れ直しただけでは差分が0件
     ② 1体を直すと、書き戻した data.js の変わる行が**その2行で、中身も期待どおり**(文字列で見る)
     ③ 送信前の検証(空の iframe で data.js を評価)が通り、意図した差分だけが出る
     ④ 読んだあとに data.js が他所で変わっていたら、送信直前の sha 照合が止める
     ⑤ 開いた直後の技3が**いまの技そのもの**(「撃ってみる」が別の技を撃たない)
     ⑥ 開いて直す → 新規モンスターへ切り替えると、欄が既定へ戻る(collectSpec が元どおり)
     ⑦ 同じ日に**別の体**の行があるとき、その行を書き直さない(書き足しになり、元の行が残る)
     ⑧ 特性idを変えたら新規登録と同じ判定を通り、ui.js も書き戻す(その sha も照合する)
     ①の中で: 覚醒スキンの tier3 は元スキンから継承なので書けない

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
  window.__baseData = files['data.js'];      // ⑦で差し込む前の素の data.js(⑧で戻す)
  window.addEventListener('DOMContentLoaded', ()=>{
    localStorage.setItem('aramon_gh_token', 'dummy');
    /* GitHub API を手元のファイルへ振り替える。
       __shaMoved で全ファイル / __shaMovedFiles で1ファイルだけ「他所で変わった」を作れる
       (送信直前の照合が data.js だけでなく**書き戻す全ファイル**を見ているかを確かめるため)。 */
    window.gh = async (p)=>{
      const m = /\/contents\/([^?]+)/.exec(p);
      if(m){
        const t = window.__files[m[1]];
        if(t == null) throw new Error('404 ' + m[1]);
        const b = new TextEncoder().encode(t);
        let s = ''; for(const c of b) s += String.fromCharCode(c);
        const moved = window.__shaMoved || (window.__shaMovedFiles || []).indexOf(m[1]) >= 0;
        return { content: btoa(s), sha: `sha-${m[1]}-${moved ? 'moved' : 'base'}` };
      }
      if(/^\/repos\/[^/]+\/[^/]+$/.test(p)) return { full_name:'test/aramon' };
      throw new Error('想定していない GitHub 呼び出し: ' + p);
    };
  });
}, { files });

await page.goto(ORIGIN + '/tools/studio_web.html', { waitUntil:'load' });
await page.waitForFunction(()=> typeof window.loadExisting === 'function');

/* 切り替え前の collectSpec()(⑥ の比べる相手)。
   **「開いて直す」に入る前**の、まっさらな新規モンスターの欄の姿。 */
const specBefore = await page.evaluate(()=> JSON.stringify(collectSpec()));

// ---------------------------------------------------------------- ① 全対象を開く
const openAll = await page.evaluate(async (only)=>{
  document.getElementById('regKind').value = 'edit';
  document.getElementById('regKind').onchange();
  await loadElementList();
  const sel = document.getElementById('e_target');
  const targets = Array.from(sel.options).map(o=>o.value).filter(v => !only || v.endsWith(':' + only));
  const bad = [], awaken = [];
  for(const v of targets){
    sel.value = v; sel.onchange();
    await loadExisting();
    if(!state.edit){ bad.push(`${v}: ${document.getElementById('log').textContent.split('\n').join(' / ')}`); continue; }
    /* 覚醒スキン(awakenOf 付き)の tier3 は元スキンから継承する。
       書けてしまうと SSR_SKIN_TIER3 に覚醒idの行ができて継承が切れる。 */
    if(state.edit.kind === 'ssr' && state.edit.cur.ssr && state.edit.cur.ssr.awakenOf)
      awaken.push({ id: state.edit.key,
                    name: document.getElementById('s_t3name').disabled,
                    mult: document.getElementById('s_t3mult').disabled,
                    note: document.getElementById('s_t3InheritNote').style.display !== 'none' });
  }
  return { n: targets.length, bad, awaken };
}, ONLY);
for(const b of openAll.bad) errors.push('開けません — ' + b);
if(!ONLY && !openAll.awaken.length) errors.push('覚醒スキンが1つも一覧にありません(⑧を確かめられていません)');
for(const a of openAll.awaken)
  if(!a.name || !a.mult || !a.note)
    errors.push(`覚醒スキン ${a.id} の tier3 の欄が書ける状態です`
      + `(技名 disabled=${a.name} / 倍率 disabled=${a.mult} / 継承の断り=${a.note})`);

// ---------------------------------------------------------------- ②③⑤ 1体を直して送信直前まで
const edited = await page.evaluate(async ()=>{
  const sel = document.getElementById('e_target');
  sel.value = 'mon:joker'; sel.onchange();
  await loadExisting();
  /* ⑤ 読み込んだ直後に、「撃ってみる」が読む欄をそのまま焼いてみる。
     f_key が空・形が既定(fan)のままだと、ザンのインフェルノを撃っていた。 */
  const fired = { key: document.getElementById('f_key').value.trim(),
                  tpl: document.getElementById('m2_tpl').value,
                  move: buildMoves(collectSpec())[2],
                  // data.js から読んだ本物。読み込みを断られたとき(自己点検)は null
                  cur: state.edit ? state.edit.cur.moves[2] : null };
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
  return { before, hist, fired, log: document.getElementById('log').textContent,
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
  /* **変わった2行の中身そのものを文字列で見る。** 行数だけを数えていると、
     「引用符ごと二重に書いた」ような壊れ方(行数は同じ)を素通りさせる。
     見るのは「元の1か所だけが新しい値に置き換わったか」= 元の行の該当箇所を
     置換した文字列と一致するか。 */
  const want = [{ from:'hp:115', to:'hp:120' }, { from:'dmg:21', to:'dmg:34' }];
  if(changed.length !== 2)
    errors.push(`書き戻しで ${changed.length} 行変わりました(2行のはず):\n` +
      changed.map(c=>`  ${c.n}行目\n   - ${c.before}\n   + ${c.after}`).join('\n'));
  else for(const w of want){
    const c = changed.find(x => x.before.includes(w.from));
    if(!c){ errors.push(`${w.from} の行が変わっていません`); continue; }
    const expect = c.before.replace(w.from, w.to);
    if(c.after !== expect)
      errors.push(`${w.from} → ${w.to} の行が期待どおりではありません\n`
        + `   期待: ${expect}\n   実際: ${c.after}`);
  }
  if(!/^ジョーカー: /.test(edited.hist)) errors.push('更新履歴の1行ができていません: ' + edited.hist);
}

/* ⑤ 開いた直後に「撃ってみる」が焼く技3が、data.js の技そのものか。
   f_key が空だとザンで撃ち、形が既定(fan)のままだと扇の範囲技になっていた。 */
{
  const mv = edited.fired.move || {}, cur = edited.fired.cur || {};
  if(edited.fired.key !== 'joker')
    errors.push(`開いても key の欄が joker になりません(${JSON.stringify(edited.fired.key)})。`
      + '「撃ってみる」が別のモンスターで撃ちます');
  // 名指しの3つ(デスファイナルの特徴)
  const wantMove = { burst:15, burstDirs:3, projStyle:'scythe' };
  for(const k of Object.keys(wantMove))
    if(mv[k] !== wantMove[k])
      errors.push(`開いた直後の技3の ${k} が ${JSON.stringify(mv[k])} です`
        + `(デスファイナルの ${JSON.stringify(wantMove[k])} のはず)`);
  /* 読み込んだ技と**丸ごと**突き合わせる(ツールに正解を書き写さない)。
     テンプレートが混ざると、こちらに無いキー(aoeShape・fanAngleDeg)が増え、
     あるキー(icon)が消える。 */
  for(const k of Object.keys(cur))
    if(JSON.stringify(mv[k]) !== JSON.stringify(cur[k]))
      errors.push(`焼いた技3の ${k} が ${JSON.stringify(mv[k])} です(data.js は ${JSON.stringify(cur[k])})`);
  for(const k of Object.keys(mv))
    if(!(k in cur)) errors.push(`焼いた技3に data.js に無いキー ${k}(${JSON.stringify(mv[k])})が増えています`);
}

// ---------------------------------------------------------------- ④ 送信直前の sha 照合
const guard = await page.evaluate(async ()=>{
  window.__shaMoved = true;
  try{ return await state.files.guard(); }catch(e){ return 'ERR ' + e.message; }
});
if(!guard || !/他所で変わって|変わっています/.test(guard))
  errors.push('data.js が他所で変わっても送信を止めませんでした: ' + guard);

/* ---------------------------------------------------------------- ⑥ 欄が既定へ戻る
   「開いて直す」は仕様パネル・技パネルを使い回すので、入れた値が残ったまま
   新規モンスターへ切り替えると、その体の数字がそのまま登録されてしまう。 */
const switched = await page.evaluate(()=>{
  const kind = document.getElementById('regKind');
  kind.value = 'monster'; kind.onchange();
  return { spec: JSON.stringify(collectSpec()),
           tpl: document.getElementById('m2_tpl').value,
           key: document.getElementById('f_key').value,
           t3mult: document.getElementById('s_t3mult').disabled,
           adhoc: document.querySelectorAll('option[data-adhoc]').length };
});
if(switched.spec !== specBefore)
  errors.push('新規モンスターへ切り替えても欄が戻りません(開いて直すで入れた値が残ります):\n'
    + `   切替前: ${specBefore}\n   切替後: ${switched.spec}`);
if(switched.t3mult) errors.push('SSRの威力倍率の欄が止まったままです(disabled が戻っていません)');
if(switched.adhoc)  errors.push(`開いて直すで足した選択肢が ${switched.adhoc} 個残っています`);

/* ---------------------------------------------------------------- ⑦ 別の体の行を消さない
   同じ日に別のモンスターの行があるとき、「威力」が共通なだけでその行を
   書き直してしまうと、その体の告知が黙って消える。
   **ここは似ていると判定される組み合わせを選ぶ**(そうでないと、判定を外しても
   「書き足す」になって検査が通ってしまう)。「ザン: 威力30→40」と
   「ジョーカー: デスファイナルの威力21→34」は共通の言葉が「威力」だけでも 50%。 */
const OTHER = 'ザン: 威力30→40';
const changelog = await page.evaluate(async ({ other })=>{
  window.__shaMoved = false;
  // 今日のかたまりに「別の体の行」だけがある data.js を作って読み直させる
  const ymd = todayYmd();
  const block = `  { date:'${ymd}', items:[\n    { t:'${other}', g:['balance'] },\n  ]},\n`;
  window.__files['data.js'] = window.__files['data.js']
    .replace('const UPDATE_HISTORY = [\n', 'const UPDATE_HISTORY = [\n' + block);
  const kind = document.getElementById('regKind');
  kind.value = 'edit'; kind.onchange();
  const sel = document.getElementById('e_target');
  sel.value = 'mon:joker'; sel.onchange();
  await loadExisting();
  const dmg = document.getElementById('m2_dmg');       // 「威力」を含む1行になるように直す
  dmg.value = String(+dmg.value + 7);
  await preflight();
  const text = state.files ? state.files.texts['data.js'] : null;
  return { mode: document.getElementById('e_chMode').value,
           hist: document.getElementById('e_chText').value,
           cls: document.getElementById('log').className,
           log: document.getElementById('log').textContent,
           items: text ? JSON.stringify(updateHistoryItems(text, ymd)) : null };
}, { other: OTHER });
if(changelog.cls === 'ng') errors.push('別の体の行があるときに差分の確認で止まりました:\n' + changelog.log);
if(changelog.mode !== 'append')
  errors.push(`別の体の行しか無いのに「${changelog.mode}」を選びました(書き足すはず)`);
if(!changelog.items || !changelog.items.includes(OTHER))
  errors.push(`別の体の行(${OTHER})が消えました: ${changelog.items}`);
if(!changelog.items || !changelog.items.includes('ジョーカー'))
  errors.push(`ジョーカーの行が入っていません: ${changelog.items}`);

/* ---------------------------------------------------------------- ⑧ 特性idを変える
   新規登録と同じ判定(traitExistsIn)を通す。ui.js の TRAIT_DESC に無い特性idなら
   説明が要り、書いたら ui.js へ1行足す。**書き戻すファイルが増えたら sha もそのぶん見る。** */
const trait = await page.evaluate(async ()=>{
  window.__shaMoved = false; window.__shaMovedFiles = [];
  // 今日のかたまりを足した data.js のままだと⑦の行が混ざるので、素の data.js へ戻す
  window.__files['data.js'] = window.__baseData;
  const kind = document.getElementById('regKind');
  kind.value = 'edit'; kind.onchange();
  const sel = document.getElementById('e_target');
  sel.value = 'mon:joker'; sel.onchange();
  await loadExisting();
  document.getElementById('f_trait').value = 'testtrait';
  document.getElementById('f_traitDesc').value = '';
  await preflight();
  const stopped = { cls: document.getElementById('log').className,
                    log: document.getElementById('log').textContent };
  // 説明を書けば通り、ui.js が送信ファイルに増える
  document.getElementById('f_traitDesc').value = '検査用の特性です';
  await preflight();
  const ok = { cls: document.getElementById('log').className,
               log: document.getElementById('log').textContent,
               files: state.files ? Object.keys(state.files.texts).sort() : null,
               ui: state.files ? state.files.texts['ui.js'] : null };
  // ui.js だけが他所で変わっていたら止まるか(data.js は動かさない)
  window.__shaMovedFiles = ['ui.js'];
  ok.guard = state.files ? await state.files.guard() : 'ERR プランがありません';
  return { stopped, ok };
});
if(trait.stopped.cls !== 'ng' || !/TRAIT_DESC/.test(trait.stopped.log))
  errors.push('説明の無い新しい特性idでも送信しようとしました:\n' + trait.stopped.log);
if(trait.ok.cls === 'ng') errors.push('説明を書いても通りませんでした:\n' + trait.ok.log);
if(JSON.stringify(trait.ok.files) !== '["data.js","sw.js","ui.js"]')
  errors.push(`特性idを変えたのに送信ファイルが ${JSON.stringify(trait.ok.files)} です`);
if(trait.ok.ui && !/^  testtrait:\s+'検査用の特性です', \/\*@joker\*\/$/m.test(trait.ok.ui))
  errors.push('ui.js の TRAIT_DESC へ新規登録と同じ形の1行が入っていません');
if(!trait.ok.guard || !/ui\.js が他所で変わって/.test(trait.ok.guard))
  errors.push('ui.js が他所で変わっても送信を止めませんでした: ' + trait.ok.guard);

await browser.close();
server.close();

if(args.includes('--json')) console.log(JSON.stringify({ openAll, edited: { ...edited, dataJs: undefined }, guard, switched, changelog, trait: { ...trait, ok: { ...trait.ok, ui: undefined } } }, null, 1));
console.log(`開いて直す(画面側)の検査`);
console.log(`  ① 開いて入れ直すだけ: ${openAll.n}件(モンスター+SSR)`
  + ` / 覚醒スキン ${openAll.awaken.length}件は tier3 を書けない`);
console.log(`  ②③ ジョーカーを直す: HP${edited.before.hp}→+5 / 威力${edited.before.dmg}→+13 / ${edited.sw}`);
console.log(`      更新履歴の1行: ${edited.hist}`);
console.log(`  ④ 送信直前の sha 照合: ${guard}`);
console.log(`  ⑤ 開いた直後の技3: 形=${JSON.stringify(edited.fired.tpl)} / key=${edited.fired.key}`
  + ` / burst=${edited.fired.move.burst} burstDirs=${edited.fired.move.burstDirs} projStyle=${edited.fired.move.projStyle}`);
console.log(`  ⑥ 新規モンスターへ切り替え: 欄は既定へ${switched.spec === specBefore ? '戻った' : '戻っていない'}`);
console.log(`  ⑦ 同じ日に別の体の行: ${changelog.mode} / ${changelog.items}`);
console.log(`  ⑧ 特性idを変える: 説明が無いと止まる / 書けば ${JSON.stringify(trait.ok.files)} を送る`);
console.log(`      ui.js だけ他所で変わったとき: ${trait.ok.guard}`);
if(errors.length){
  console.log(`\n問題が ${errors.length} 件あります:`);
  for(const e of errors) console.log('  - ' + e);
  process.exit(1);
}
console.log('すべて合格');
