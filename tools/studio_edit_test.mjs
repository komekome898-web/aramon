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
     ⑤ 開いた直後の3技が**いまの技そのもの**(「撃ってみる」が別の技を撃たない)。**全モンスター**を
        buildMoves(collectSpec()) と data.js の技で丸ごと突き合わせる
     ⑥ 開いて直す → 新規モンスターへ切り替えると、欄が既定へ戻る(collectSpec が元どおり)
     ⑥b 種類を往復しても、覚醒の「継承の断り」が新規SSR登録に残らず、
        **開いたスキンの素体・状態変化のプリセットが新規登録へ混ざらない**(嘘の案内も出ない)
     ⑦ 更新履歴の書き直す行: 別の体の行と**同じ体の告知の行**は書き直さない(書き足す)/
        ツールが書いた形の同じ体の行は書き直す(行が増えない)/
        **見た目だけの変更 + 本文を手書き**でも告知の行が残る(既定は書き足し)/
        同じ相手の行が2つある日は**どの行が書き変わったか**を見る(既定の行だけが新しい値)/
        人が選び直した行を機械が上書きしない / 同点は先頭を選ぶ /
        表示名を付け替えたら新しい名前で1行書く
     ⑧ 特性idを変えたら新規登録と同じ判定を通り、ui.js も書き戻す(その sha も照合する)。
        使えない形の特性id(bad-id)では止まる
     ⑨ 「形」の欄は表示専用(選び直しても保存内容は変えられないため)。止まった欄では
        「人が選び直した」印を立てない
     ⑩ 足した選択肢(いまの値・テンプレート無し)を次の体へ持ち越さない
     ⑪ 「テンプレート無し」でも土台は読み込んだ技(TIER3[''] が引けず空にならない)
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
  const bad = [], awaken = [], fired = [];
  for(const v of targets){
    sel.value = v; sel.onchange();
    await loadExisting();
    if(!state.edit){ bad.push(`${v}: ${document.getElementById('log').textContent.split('\n').join(' / ')}`); continue; }
    /* ⑤ 開いた直後に「撃ってみる」が焼く3技を控える(全モンスター)。
       焼くのは画面の欄そのもの(buildMoves(collectSpec()))なので、
       これが data.js の技と違えば**別の中身の技を撃っている**ことになる。 */
    if(state.edit.kind === 'monster'){
      /* 足した選択肢(いまの値・テンプレート無し)を欄ごとに数える。
         **前の体のぶんを消していないと、開くたびに積み上がる。** */
      const adhoc = {};
      document.querySelectorAll('option[data-adhoc]').forEach(o=>{
        const id = (o.parentElement && o.parentElement.id) || '?';
        adhoc[id] = (adhoc[id] || 0) + 1;
      });
      fired.push({ key: state.edit.key,
                   formKey: document.getElementById('f_key').value.trim(),
                   tpl: document.getElementById('m2_tpl').value,
                   // 形の欄は「いまの技に近い形」の表示だけ(選び直しは新規登録のみ)
                   tplDisabled: document.getElementById('m2_tpl').disabled,
                   adhoc,
                   baked: buildMoves(collectSpec()),
                   cur: state.edit.cur.moves });
    }
    /* 覚醒スキン(awakenOf 付き)の tier3 は元スキンから継承する。
       書けてしまうと SSR_SKIN_TIER3 に覚醒idの行ができて継承が切れる。 */
    if(state.edit.kind === 'ssr' && state.edit.cur.ssr && state.edit.cur.ssr.awakenOf)
      awaken.push({ id: state.edit.key,
                    baseId: state.edit.cur.ssr.awakenOf,
                    name: document.getElementById('s_t3name').disabled,
                    mult: document.getElementById('s_t3mult').disabled,
                    note: document.getElementById('s_t3InheritNote').style.display !== 'none',
                    noteText: document.getElementById('s_t3InheritNote').textContent });
  }
  return { n: targets.length, bad, awaken, fired };
}, ONLY);
for(const b of openAll.bad) errors.push('開けません — ' + b);
if(!ONLY && !openAll.awaken.length) errors.push('覚醒スキンが1つも一覧にありません(⑧を確かめられていません)');
for(const a of openAll.awaken){
  if(!a.name || !a.mult || !a.note)
    errors.push(`覚醒スキン ${a.id} の tier3 の欄が書ける状態です`
      + `(技名 disabled=${a.name} / 倍率 disabled=${a.mult} / 継承の断り=${a.note})`);
  /* 断りの文面は**表示名**で書く。生のid(guts_ssr)がそのまま出ていたら、
     読む人にはどのスキンのことか分からない。 */
  if(a.noteText && a.noteText.indexOf(a.baseId) >= 0)
    errors.push(`覚醒スキン ${a.id} の継承の断りに生のid(${a.baseId})が出ています: ${a.noteText}`);
}

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
  /* ⑨ 止めた欄では「人が形を選び直した」印を立てない。本物の change を投げて確かめる
     ―― 印が立つと moveBaseInfo が読み込んだ技をテンプレートで置き換えてしまう。 */
  const tplSel = document.getElementById('m2_tpl');
  tplSel.dispatchEvent(new Event('change', { bubbles:true }));
  const tplEvent = { picked: tplPickedByHuman, fromLoaded: moveBaseInfo(2).fromLoaded };
  /* ⑪ 「テンプレート無し(いまの技のまま)」= TIER3 に無い名前。印が立ったままだと
     土台が空になるので、moveBaseInfo が印を落として読み込んだ技へ戻す(最後の受け)。 */
  tplPickedByHuman = true;
  const info = moveBaseInfo(2, '');
  const tplNone = { fromLoaded: info.fromLoaded, dmg: info.base && info.base.dmg,
                    picked: tplPickedByHuman };
  tplPickedByHuman = false;
  /* 止めた欄には**止めた理由**を出す(灰色の欄だけでは「壊れている」と読まれる)。 */
  const noteEl = document.getElementById('tplEditNote');
  return { before, hist, fired, tplEvent, tplNone,
           tplDisabled: tplSel.disabled,
           tplNote: { shown: !!noteEl && noteEl.style.display !== 'none',
                      text: noteEl ? noteEl.textContent : '' },
           log: document.getElementById('log').textContent,
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
if(!edited.tplDisabled) errors.push('ジョーカーを開いても「形」の欄が選び直せます(表示専用のはず)');
if(!edited.tplNote.shown || !/形は変えられません/.test(edited.tplNote.text))
  errors.push('「形」の欄を止めた理由がその場に出ていません: '
    + `${edited.tplNote.shown ? '' : '(非表示)'}${JSON.stringify(edited.tplNote.text)}`);
if(edited.tplEvent.picked)
  errors.push('止まっている「形」の欄で change を受けて「人が選び直した」印を立てています');
if(!edited.tplEvent.fromLoaded)
  errors.push('形の欄の change だけで技の土台がテンプレートへ移りました(読み込んだ技のはず)');
/* ⑪ テンプレート無しでは読み込んだ技が土台に戻る。デスファイナルの威力(data.js の値)が
   そのまま出ていれば土台は開いた技(空の土台なら undefined になる)。 */
if(!edited.tplNone.fromLoaded || edited.tplNone.picked)
  errors.push('「テンプレート無し」を選ぶと土台が空になります'
    + `(読み込んだ技=${edited.tplNone.fromLoaded} / 印=${edited.tplNone.picked})`);
if(edited.tplNone.dmg !== (edited.fired.cur || {}).dmg)
  errors.push(`「テンプレート無し」の土台の威力が ${edited.tplNone.dmg} です`
    + `(data.js は ${(edited.fired.cur || {}).dmg})`);

/* ⑤ 開いた直後に「撃ってみる」が焼く技が、data.js の技そのものか(**全モンスター**)。
   f_key が空だとザンで撃ち、tier3 の「形」の逆引きが当たると土台がテンプレートに
   すり替わって、欄の無いキー(endBlast / pierce / selfSpeedBuffOnHit / burstSideStep /
   rectWidth / zigzagWidth / icon …)がテンプレートの値に化けていた(21体中15体で逆引きが当たる)。
   だから**丸ごと**突き合わせる(ツールに正解を書き写さない)。 */
{
  /* 比べ方: `aura` は「撃ってみる」が別に渡すので見ない(driver の override の auras)。
     色は欄を通ると小文字になるだけなので、#RRGGBB は小文字にそろえてから比べる。 */
  const norm = v => {
    if(typeof v === 'string') return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v.toLowerCase() : v;
    if(Array.isArray(v)) return v.map(norm);
    if(v && typeof v === 'object'){ const o = {}; for(const k of Object.keys(v).sort()) o[k] = norm(v[k]); return o; }
    return v;
  };
  const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
  const jp = ['技1','技2','技3'];
  for(const f of openAll.fired){
    if(f.formKey !== f.key)
      errors.push(`${f.key}: 開いても key の欄が ${JSON.stringify(f.formKey)} です。`
        + '「撃ってみる」が別のモンスターで撃ちます');
    for(let i = 0; i < 3; i++){
      const mv = f.baked[i] || {}, cur = f.cur[i] || {};
      for(const k of Object.keys(cur)){
        if(k === 'aura') continue;
        if(!same(mv[k], cur[k]))
          errors.push(`${f.key} の${jp[i]}: 焼いた ${k} が ${JSON.stringify(mv[k])} です`
            + `(data.js は ${JSON.stringify(cur[k])})`);
      }
      for(const k of Object.keys(mv))
        if(k !== 'aura' && !(k in cur))
          errors.push(`${f.key} の${jp[i]}: data.js に無いキー ${k}(${JSON.stringify(mv[k])})が増えています`);
    }
  }
  /* ⑨ 形(テンプレート)の欄は**表示専用**。aoeShape は EDIT_MOVE_KEYS に無く欄も持たないので、
     形を選び直しても保存内容は変わらない —— 止めていないと「撃ってみる」だけが
     テンプレートの技に変わり、**撃った物と保存される物が食い違う**。 */
  for(const f of openAll.fired)
    if(!f.tplDisabled)
      errors.push(`${f.key}: 開いて直すのに「形」の欄が選び直せます(保存内容は変えられないので表示専用のはず)`);
  /* ⑩ 「いまの値」「テンプレート無し」の選択肢を**次の体へ持ち越さない**。
     消していないと、開くたびに前の体の値(scythe など)が一覧に積み上がる。 */
  for(const f of openAll.fired)
    for(const id of Object.keys(f.adhoc))
      if(f.adhoc[id] > 1)
        errors.push(`${f.key} を開いたとき ${id} に足した選択肢が ${f.adhoc[id]} 個あります`
          + '(1つ以下のはず。前の体のぶんが残っています)');
  // 名指しの3つ(デスファイナルの特徴)。逆引きが当たらない技の代表として残す
  const mvJ = edited.fired.move || {};
  const wantMove = { burst:15, burstDirs:3, projStyle:'scythe' };
  for(const k of Object.keys(wantMove))
    if(mvJ[k] !== wantMove[k])
      errors.push(`開いた直後の技3の ${k} が ${JSON.stringify(mvJ[k])} です`
        + `(デスファイナルの ${JSON.stringify(wantMove[k])} のはず)`);
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
  /* 数字として読めない値を残したまま切り替える。値は '' に戻るのに赤い印だけが
     居残ると、段階バーの技の段が「!」で固まる(段も送信も moveInputErrors を読む)。 */
  document.getElementById('m2_dmg').value = 'あ';
  const marked0 = !!moveInputErrors();
  kind.value = 'monster'; kind.onchange();
  /* **計算し直す前**の姿を先に見る(moveInputErrors は collectSpec を通すので、
     先に呼ぶと居残りをその場で消してしまい、検査が素通りする)。 */
  const bad = { marked0, marked: document.querySelectorAll('.badnum').length,
                cached: moveBadFields.size, dmg: document.getElementById('m2_dmg').value };
  bad.stageNg = !!moveInputErrors();
  return { bad,
           spec: JSON.stringify(collectSpec()),
           tpl: document.getElementById('m2_tpl').value,
           tplDisabled: document.getElementById('m2_tpl').disabled,
           key: document.getElementById('f_key').value,
           t3mult: document.getElementById('s_t3mult').disabled,
           // 「開いて直す」でだけ出す注記は、新規登録の画面に残ってはいけない
           tplNote: document.getElementById('tplEditNote').style.display !== 'none',
           adhoc: document.querySelectorAll('option[data-adhoc]').length };
});
if(switched.spec !== specBefore)
  errors.push('新規モンスターへ切り替えても欄が戻りません(開いて直すで入れた値が残ります):\n'
    + `   切替前: ${specBefore}\n   切替後: ${switched.spec}`);
if(switched.t3mult) errors.push('SSRの威力倍率の欄が止まったままです(disabled が戻っていません)');
if(switched.adhoc)  errors.push(`開いて直すで足した選択肢が ${switched.adhoc} 個残っています`);
// 新規登録では形を選び直せる(表示専用にするのは「開いて直す」だけ)
if(switched.tplDisabled)
  errors.push('新規モンスターへ切り替えても「形」の欄が止まったままです(選び直せません)');
if(switched.tplNote)
  errors.push('新規モンスターの画面に「形は変えられません」の断りが残っています');
{
  const b = switched.bad;
  if(!b.marked0) errors.push('検査の前提が崩れています(読めない値を入れても赤くなりません)');
  if(b.dmg !== '') errors.push(`切り替えても技の欄の値が残っています: ${JSON.stringify(b.dmg)}`);
  if(b.marked || b.cached)
    errors.push('切り替えても「数字として読めない」の赤い印が残っています'
      + `(赤い欄 ${b.marked}個 / 覚えている欄 ${b.cached}個)`);
  if(b.stageNg)
    errors.push('切り替えたのに「読めない欄がある」と言い続けています(段階バーの技の段が「!」で固まります)');
}

/* ---------------------------------------------------------------- ⑥b 種類を往復する
   ・覚醒スキンを開いて出した「継承の断り」は、新規SSR登録の画面に残ってはいけない。
     **表示の有無は captureFormDefaults が撮れない**(撮るのは value/checked/disabled だけ)ので、
     戻す一覧(EDIT_ONLY_NOTES)に入っていないと、覚醒でもないスキンの画面に断りが出る。
   ・**開いたスキンの素体を新規SSR登録へ持ち越さない。** 「撮った時点で選べる中身が
     0個だった select は戻さない」という規則を持っていたころは、接続後に中身ができる
     select(s_element・f_scPreset)が丸ごと戻らず、開いたスキンの素体がそのまま
     新規登録の欄に残っていた(= 別の素体でSSRスキンを登録できてしまう)。
     いまは**全 select を戻し**、撮った値が今の選択肢に無ければ先頭(見出し)へ寄せる。
   ・そのうえで、案内の文が**嘘にならない**こと。一覧は出ているのだから
     「先にGitHubへ接続すると一覧が出ます」と言ってはいけない(選び忘れているだけ)。
   ・「開いて直す」へ戻ったときも、相手の一覧(e_target)は選ばれた状態に落ちる
     (selectedIndex=-1 =「画面には残って見えるのに読むと空」を作らない)。 */
const roundTrip = await page.evaluate(async (awakenId)=>{
  const kind = document.getElementById('regKind'), sel = document.getElementById('e_target');
  const elSel = document.getElementById('s_element'), scSel = document.getElementById('f_scPreset');
  kind.value = 'edit'; kind.onchange();
  sel.value = 'ssr:' + awakenId; sel.onchange();
  await loadExisting();
  /* 状態変化のプリセットも「接続後に中身ができる select」。既定へ戻るかを見るために、
     いま選べる中で既定('' = つけない)と違うものを選んでおく。 */
  const scOther = Array.from(scSel.options).map(o=>o.value).find(v => v && v !== 'custom');
  if(scOther) scSel.value = scOther;
  const opened = { note: document.getElementById('s_t3InheritNote').style.display !== 'none',
                   target: sel.value, element: elSel.value, sc: scSel.value };
  kind.value = 'ssr'; kind.onchange();                 // 新規SSR登録へ
  /* 実際に登録しようとしたときの言い方を見る。**id を先に埋める** ――
     validateSsr は id → 素体 の順に見るので、埋めないと素体まで進まず
     「嘘の案内」の検査が一度も効かない。 */
  document.getElementById('s_id').value = 'testmon_ssr';
  const asSsr = { note: document.getElementById('s_t3InheritNote').style.display !== 'none',
                  element: { value: elSel.value, index: elSel.selectedIndex, n: elSel.options.length },
                  collected: collectSsr().element,
                  sc: { value: scSel.value, index: scSel.selectedIndex, n: scSel.options.length },
                  ng: validateSsr(collectSsr()) };
  kind.value = 'edit'; kind.onchange();                // 開いて直すへ戻る
  return { opened, asSsr,
           back: { value: sel.value, index: sel.selectedIndex, n: sel.options.length } };
}, (openAll.awaken[0] || {}).id);
if(!roundTrip.opened.note)
  errors.push('覚醒スキンを開いても継承の断りが出ていません(⑥bの前提が崩れています)');
if(roundTrip.asSsr.note)
  errors.push('新規SSR登録の画面に、覚醒スキンの「継承の断り」が残っています');
if(roundTrip.back.index < 0)
  errors.push('種類を往復すると、直す相手の欄がどれも選ばれていない状態になります'
    + `(選択 ${roundTrip.back.index} / 選択肢 ${roundTrip.back.n}個)`);
{
  const e = roundTrip.asSsr.element;
  // 前提: 開いたときには素体が入っていた(入っていなければ「混ざる」を確かめられない)
  if(!roundTrip.opened.element)
    errors.push('覚醒スキンを開いても素体の欄が空です(⑥bの前提が崩れています)');
  if(e.index < 0)
    errors.push(`素体の欄がどれも選ばれていない状態です(選択 ${e.index} / 選択肢 ${e.n}個)`);
  /* **開いたスキンの素体が新規SSR登録へ混ざらない。** 戻したあとは見出し(空)。 */
  if(roundTrip.asSsr.collected !== '')
    errors.push('開いて直す → 新規SSR登録と進むと、開いたスキンの素体が残ります: '
      + JSON.stringify(roundTrip.asSsr.collected));
  // 一覧は出ているのだから「先にGitHubへ接続すると…」は嘘
  if(roundTrip.asSsr.ng && /接続/.test(roundTrip.asSsr.ng))
    errors.push('素体の一覧は出ているのに、接続を促す嘘の案内が出ます: ' + roundTrip.asSsr.ng);
  if(!/素体を選んでください/.test(roundTrip.asSsr.ng || ''))
    errors.push('素体が空なのに「素体を選んでください」と言いません: ' + roundTrip.asSsr.ng);
}
{
  const sc = roundTrip.asSsr.sc;
  if(!roundTrip.opened.sc)
    errors.push('状態変化のプリセットに選べる中身がありません(⑥bの前提が崩れています)');
  if(sc.value !== '')
    errors.push('開いて直す → 新規SSR登録と進むと、状態変化のプリセットが既定へ戻りません: '
      + `${JSON.stringify(sc.value)}(既定は "")`);
}

/* ---------------------------------------------------------------- ⑦ 書き直す行の選び方
   同じ日の行のうち、書き直してよいのは**このツールが書いた形の、その体の行**だけ。
   ・別のモンスターの行を書き直すと、その体の告知が黙って消える。
     **似ていると判定される組み合わせを選ぶ**(そうでないと、判定を外しても
     「書き足す」になって検査が通ってしまう)。「ザン: 威力30→40」と
     「ジョーカー: デスファイナルの威力21→28」は共通の言葉が「威力」だけでも 50%。
   ・**同じ体の告知の行(🆕・✵)はもっと危ない** —— changelogSimilarity の分母は
     短いほうの語数なので「ジョーカー」を含むだけで 100% になり、既定で消えていた。
   ・逆に、ツールが書いた形の行は**書き直す**(2行あると古いほうが嘘になる)。 */
const OTHER = 'ザン: 威力30→40';
const PROMO = '🆕 新モンスター「ジョーカー」が登場しました!闇の技で切り裂きます';
const AWAKE = '✵ ジョーカーに覚醒の姿が追加されました';
const TOOL_LINE = 'ジョーカー: HP115→118';
const TOOL_LINE2 = 'ジョーカー: 威力21→28';
// 見た目だけの変更で人が手書きする本文(自動では入らない)
const HAND_LINE = 'ジョーカー: 技のオーラの色を変えました';
const changelog = await page.evaluate(async ({ cases })=>{
  window.__shaMoved = false;
  const ymd = todayYmd();
  /* 今日のかたまりを差し替えて、ジョーカーの1項目を直し、差分を確認するところまで。
     素の data.js から作り直すので、前の回の行が混ざらない。
     **どの欄を直すかで自動の1行の言葉数が変わり、似ている度合いも変わる**ので、
     場合ごとに指定する(威力=「威力」を含む3語 / HP=「ジョーカー」1語)。 */
  const run = async (c)=>{
    const block = `  { date:'${ymd}', items:[\n`
      + c.lines.map(t=>`    { t:'${t}', g:['balance'] },\n`).join('') + '  ]},\n';
    window.__files['data.js'] = window.__baseData
      .replace('const UPDATE_HISTORY = [\n', 'const UPDATE_HISTORY = [\n' + block);
    const kind = document.getElementById('regKind');
    kind.value = 'edit'; kind.onchange();
    const sel = document.getElementById('e_target');
    sel.value = 'mon:joker'; sel.onchange();
    await loadExisting();
    const el = document.getElementById(c.field);
    /* 見た目だけの変更(オーラ)は数字を足せないので、いまと違う選択肢を選ぶ。 */
    if(c.pick){
      const other = Array.from(el.options).map(o=>o.value).find(v => v && v !== el.value);
      el.value = other;
    } else if(c.set != null) el.value = c.set;      // 文字の欄(表示名の付け替え)
    else el.value = String(+el.value + c.add);
    // 本文を手で書く道(自動で入らない=見た目だけの変更でも、人は履歴を書ける)
    const mode0 = document.getElementById('e_chMode').value;
    const target0 = document.getElementById('e_chTarget').value;
    /* 人が「書き直す行」を選び直す道。**本物の change イベントを投げる** ――
       `.onchange()` の直呼びではプログラムからの入れ直しと区別が付かない
       (印を立てるのは addEventListener 側)。 */
    if(c.pickTarget != null){
      const ts = document.getElementById('e_chTarget');
      ts.value = String(c.pickTarget);
      ts.dispatchEvent(new Event('change', { bubbles:true }));
    }
    if(c.hist != null) document.getElementById('e_chText').value = c.hist;
    await preflight();
    const text = state.files ? state.files.texts['data.js'] : null;
    return { mode: document.getElementById('e_chMode').value, mode0, target0,
             target: document.getElementById('e_chTarget').value,
             note: document.getElementById('e_chNote').textContent,
             opts: Array.from(document.getElementById('e_chTarget').options).map(o=>o.textContent),
             hist: document.getElementById('e_chText').value,
             cls: document.getElementById('log').className,
             log: document.getElementById('log').textContent,
             items: text ? JSON.stringify(updateHistoryItems(text, ymd)) : null };
  };
  const out = {};
  for(const k of Object.keys(cases)) out[k] = await run(cases[k]);
  return out;
}, { cases: {
  // 別の体の行(「威力」だけが共通で 50% 似ている)
  other:    { lines:[OTHER], field:'m2_dmg', add:7 },
  /* 同じ体の告知の行。**1語しかない本文と比べると 100% 似ている**ので、
     候補を絞っていないと既定でこの行が書き直され、告知が消える。 */
  announce: { lines:[PROMO, AWAKE, OTHER], field:'f_hp', add:5 },
  // ツールが書いた形の同じ体の行(これは書き直す)
  tool:     { lines:[PROMO, OTHER, TOOL_LINE], field:'f_hp', add:5 },
  /* **見た目だけの変更 + 本文を手で書く。** 自動の本文が作られない道なので、
     planEdit の「初回の選び直し」を通らない。既定が「書き直す・1行目」だと、
     今日の1行目(🆕 の告知)を黙って消してしまう。 */
  look:     { lines:[PROMO, OTHER], field:'f_aura', pick:true, hist:HAND_LINE },
  /* 同じ相手のツールの形の行が2つある日(どちらを直すかは人にしか決められない)。
     **1行目も3行目も「ジョーカー」を含むので、自動の本文との似ている度合いは同点 1.00。**
     機械が選び直すと同点の勝ち方しだいで**既定と違う行**が消える。 */
  twoLines: { lines:[TOOL_LINE, OTHER, TOOL_LINE2], field:'f_hp', add:5 },
  /* 人が「書き直す行」を選び直した日。候補は2行目だけなので、機械に任せると
     2行目へ戻される。**人の選択(1行目)を上書きしない**ことを見る。 */
  humanPick:{ lines:[PROMO, TOOL_LINE], field:'f_hp', add:5, pickTarget:0 },
  /* 表示名を付け替えた日。履歴は**新しい名前**で書き、改名そのものも本文へ入れる
     (旧名のままだと、遊ぶ人には「もうゲームに無い名前」の行になる)。 */
  rename:   { lines:[OTHER], field:'f_label', set:'ジョーカーX' },
} });
// ⑦-1 別の体の行は書き直さない(書き足しになり、その体の行が残る)
{
  const c = changelog.other;
  if(c.cls === 'ng') errors.push('別の体の行があるときに差分の確認で止まりました:\n' + c.log);
  if(c.mode !== 'append') errors.push(`別の体の行しか無いのに「${c.mode}」を選びました(書き足すはず)`);
  if(!c.items || !c.items.includes(OTHER)) errors.push(`別の体の行(${OTHER})が消えました: ${c.items}`);
  if(!c.items || !c.items.includes('威力21→28')) errors.push(`ジョーカーの行が入っていません: ${c.items}`);
}
// ⑦-2 同じ体でも**告知の行**は書き直さない。元の3行は全部残り、4行になる
{
  const c = changelog.announce;
  if(c.cls === 'ng') errors.push('告知の行があるときに差分の確認で止まりました:\n' + c.log);
  if(c.mode !== 'append') errors.push(`書き直せる行が無いのに「${c.mode}」を選びました(書き足すはず)`);
  for(const t of [PROMO, AWAKE, OTHER])
    if(!c.items || !c.items.includes(t)) errors.push(`書き直してはいけない行が消えました(${t}): ${c.items}`);
  if(!c.items || !c.items.includes('HP115→120')) errors.push(`ジョーカーの行が書き足されていません: ${c.items}`);
  if(c.items && JSON.parse(c.items).length !== 4)
    errors.push(`告知の行があるときに行数が合いません(4行のはず): ${c.items}`);
}
// ⑦-3 ツールが書いた形の同じ体の行があれば、それを**書き直す**(行は増えない)
{
  const c = changelog.tool;
  if(c.cls === 'ng') errors.push('ツールの形の行があるときに差分の確認で止まりました:\n' + c.log);
  if(c.mode !== 'rewrite')
    errors.push(`ツールが書いた同じ体の行があるのに「${c.mode}」を選びました(書き直すはず)`);
  if(!c.items || c.items.includes(TOOL_LINE))
    errors.push(`古い行(${TOOL_LINE})が書き直されずに残っています: ${c.items}`);
  if(!c.items || !c.items.includes('HP115→120')) errors.push(`書き直した行が入っていません: ${c.items}`);
  for(const t of [OTHER, PROMO])
    if(!c.items || !c.items.includes(t)) errors.push(`書き直しで別の行まで消えました(${t}): ${c.items}`);
  if(c.items && JSON.parse(c.items).length !== 3)
    errors.push(`書き直したのに行が増減しました: ${c.items}`);
}

/* ⑦-4 **見た目だけの変更 + 本文を手書き。** 自動の本文が作られないので planEdit の
   選び直しを通らない ―― 既定が「書き直す・1行目」だと、その日の告知(🆕)が消える。
   既定は「このツールが書いた形のその相手の行があればそれ、無ければ書き足す」。 */
{
  const c = changelog.look;
  if(c.cls === 'ng') errors.push('見た目だけの変更で差分の確認が止まりました:\n' + c.log);
  if(c.mode0 !== 'append')
    errors.push(`読み込んだ直後の既定が「${c.mode0}」です(書き直せる行が無いので書き足すはず)`);
  if(c.mode !== 'append') errors.push(`書き直せる行が無いのに「${c.mode}」で送ろうとしました`);
  for(const t of [PROMO, OTHER])
    if(!c.items || !c.items.includes(t)) errors.push(`手書きの本文が別の行を消しました(${t}): ${c.items}`);
  if(!c.items || !c.items.includes(HAND_LINE))
    errors.push(`手書きの本文が入っていません: ${c.items}`);
  if(c.items && JSON.parse(c.items).length !== 3)
    errors.push(`見た目だけの変更で行数が合いません(3行のはず): ${c.items}`);
  // 書き直してよくない行には印を付ける(人が選ぶときの手がかり)
  if(!c.opts.every(t => /🔒/.test(t)))
    errors.push(`書き直せない行に印が付いていません: ${JSON.stringify(c.opts)}`);
}
/* ⑦-5 同じ日に同じ相手のツールの形の行が2つある日。
   **見るのは「どの行が書き変わったか」。** 行数と注意文だけを数えていたころは、
   planEdit の選び直しが**既定と違う行**(似ている度合いが同点で後ろが勝つ)を選んでも
   検査は緑のままだった —— 実際には3行目「ジョーカー: 威力21→28」が消え、
   1行目「ジョーカー: HP115→118」が古い値のまま残っていた。
   正しい姿: 読み込み時に決めた既定(候補の先頭=1行目)が書き変わり、3行目はそのまま。 */
{
  const c = changelog.twoLines;
  const items = c.items ? JSON.parse(c.items) : null;
  if(c.cls === 'ng') errors.push('同じ相手の行が2つあるときに差分の確認が止まりました:\n' + c.log);
  if(!/2 つあります|2つあります/.test(c.note))
    errors.push('同じ相手の行が2つあるのに、どちらを直すかの注意が出ていません: ' + c.note);
  if(c.mode !== 'rewrite') errors.push(`ツールの形の行が2つあるのに「${c.mode}」を選びました`);
  if(c.target !== c.target0)
    errors.push('同じ相手の行が2つある日に、押しただけで書き直す行が変わりました'
      + `(${c.target0}行目 → ${c.target}行目)。どちらを直すかは人が選ぶ`);
  if(!items || items.length !== 3)
    errors.push(`2行あるうち1行を書き直したのに行数が変わりました: ${c.items}`);
  else {
    // 選んだ行(既定=1行目)だけが新しい値になる
    if(items[0].t !== 'ジョーカー: HP115→120')
      errors.push(`選んだ1行目が書き変わっていません: ${JSON.stringify(items[0].t)}`);
    if(items[1].t !== OTHER) errors.push(`別の体の行が変わりました: ${JSON.stringify(items[1].t)}`);
    // 選んでいない同じ相手の行は**そのまま残る**(ここが消えていたのが今回の壊れ方)
    if(items[2].t !== TOOL_LINE2)
      errors.push(`選んでいない3行目(${TOOL_LINE2})が書き変わりました: ${JSON.stringify(items[2].t)}`);
    // 直した行が古い値のまま居残っていないか(1行目が書き変わっていれば起きない)
    if(c.items.includes(TOOL_LINE))
      errors.push(`直したはずの行が古い値(${TOOL_LINE})のまま残っています: ${c.items}`);
  }
}
/* ⑦-6 人が「書き直す行」を選び直したら、planEdit はそれを上書きしない。
   候補(🔒の付かない行)は2行目だけなので、機械に任せると2行目へ戻る。
   人が1行目(🔒 付き=告知)をあえて選んだのなら、**その行を**書き直す
   (消えることは注意文で知らせてある)。 */
{
  const c = changelog.humanPick;
  const items = c.items ? JSON.parse(c.items) : null;
  if(c.cls === 'ng') errors.push('人が行を選び直したときに差分の確認が止まりました:\n' + c.log);
  if(c.target !== '0')
    errors.push(`人が選んだ行(1行目)が ${c.target}行目 に上書きされました`);
  if(!/🔒/.test(c.note))
    errors.push('🔒 の付いた行を選んでいるのに注意が出ていません: ' + c.note);
  if(!items || items.length !== 2)
    errors.push(`選んだ行を書き直したのに行数が変わりました: ${c.items}`);
  else {
    if(items[0].t !== 'ジョーカー: HP115→120')
      errors.push(`人が選んだ1行目が書き変わっていません: ${JSON.stringify(items[0].t)}`);
    if(items[1].t !== TOOL_LINE)
      errors.push(`選んでいない2行目が書き変わりました: ${JSON.stringify(items[1].t)}`);
  }
}
/* ⑦-7 同点のときの向きを**既定(fillEditChangelog)と揃える**。
   どちらも「候補の先頭」を選ぶ。逆向きだと、押した瞬間に既定と違う行へ移る。 */
const tieIndex = await page.evaluate(({ lines, label, text })=>
  editRewriteIndex(lines.map(t=>({ t, g:['balance'] })), label, text),
  { lines:[TOOL_LINE, OTHER, TOOL_LINE2], label:'ジョーカー', text:'ジョーカー: HP115→120' });
if(tieIndex !== 0)
  errors.push(`似ている度合いが同点のとき ${tieIndex}番目を選びました(先頭=0のはず)`);
/* ⑦-9 「書き直す行」の選択肢は**本文をそのまま**見出しに出すので HTML エスケープする。
   `<b>` のような並びが本文に混ざると、エスケープしていない側では見出しから消える
   (最悪は選択肢そのものが壊れて行が選べなくなる)。 */
const escOpts = await page.evaluate(()=>{
  const lines = ['ジョーカー: <b>威力</b>21→34', 'ザン: HP100→110'];
  const block = `  { date:'${todayYmd()}', items:[\n`
    + lines.map(t=>`    { t:'${t}', g:['balance'] },\n`).join('') + '  ]},\n';
  fillEditChangelog('const UPDATE_HISTORY = [\n' + block + '];\n', 'ジョーカー');
  return Array.from(document.getElementById('e_chTarget').options).map(o=>o.textContent);
});
if(escOpts.length !== 2 || !escOpts[0].includes('<b>威力</b>'))
  errors.push(`選択肢の見出しが HTML として読まれています: ${JSON.stringify(escOpts)}`);
/* ⑦-8 表示名を付け替えたときの1行。**新しい名前で書き、改名も本文に入れる。**
   載せる項目が「性能の数字と技名」だけだった頃は、改名が履歴に一言も出ず、
   出たとしても主語が旧名のままだった。タグは monster。 */
{
  const c = changelog.rename;
  const items = c.items ? JSON.parse(c.items) : null;
  if(c.cls === 'ng') errors.push('表示名を変えたときに差分の確認が止まりました:\n' + c.log);
  if(!/^ジョーカーX: /.test(c.hist))
    errors.push(`改名の1行が新しい名前で始まっていません: ${JSON.stringify(c.hist)}`);
  if(!c.hist.includes('名前が「ジョーカー」から「ジョーカーX」へ'))
    errors.push(`改名の1行に「◯◯から△△へ」がありません: ${JSON.stringify(c.hist)}`);
  const line = items && items.find(it => /^ジョーカーX: /.test(it.t));
  if(!line) errors.push(`改名の行が更新履歴に入っていません: ${c.items}`);
  else if((line.g || []).indexOf('monster') < 0)
    errors.push(`改名の行のタグが ${JSON.stringify(line.g)} です(monster のはず)`);
}

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
  /* 使えない形の特性id。**裸のキーとして ui.js へ書き出す**ので、通すと
     `bad-id:'…'` という構文エラーの ui.js を送れてしまう(前は preflight が ok と言った)。 */
  document.getElementById('f_trait').value = 'bad-id';
  document.getElementById('f_traitDesc').value = '検査用の特性です';
  await preflight();
  const badId = { cls: document.getElementById('log').className,
                  log: document.getElementById('log').textContent,
                  files: state.files ? Object.keys(state.files.texts) : null,
                  commit: document.getElementById('commitBtn').disabled };
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
  return { badId, stopped, ok };
});
if(trait.badId.cls !== 'ng' || !/特性id/.test(trait.badId.log))
  errors.push('使えない形の特性id(bad-id)でも送信しようとしました:\n' + trait.badId.log);
if(trait.badId.files) errors.push(`使えない特性idで送信内容ができました: ${JSON.stringify(trait.badId.files)}`);
if(trait.badId.commit === false) errors.push('使えない特性idなのに「この内容でコミット」が押せます');
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
console.log(`  ⑤ 開いた直後の3技が data.js と一致: ${openAll.fired.length}体`
  + `(形の逆引きが当たる体 ${openAll.fired.filter(f=>f.tpl).length}体を含む)`);
console.log(`     ジョーカー: 形=${JSON.stringify(edited.fired.tpl)} / key=${edited.fired.key}`
  + ` / burst=${edited.fired.move.burst} burstDirs=${edited.fired.move.burstDirs} projStyle=${edited.fired.move.projStyle}`);
console.log(`  ⑥ 新規モンスターへ切り替え: 欄は既定へ${switched.spec === specBefore ? '戻った' : '戻っていない'}`);
console.log(`  ⑥b 種類を往復: 継承の断りは新規SSRで${roundTrip.asSsr.note ? '残る' : '消える'}`
  + ` / 素体 ${JSON.stringify(roundTrip.opened.element)}→${JSON.stringify(roundTrip.asSsr.collected)}`
  + ` / 状態変化 ${JSON.stringify(roundTrip.opened.sc)}→${JSON.stringify(roundTrip.asSsr.sc.value)}`
  + ` / 案内「${roundTrip.asSsr.ng}」`);
console.log(`  ⑦ 別の体の行: ${changelog.other.mode} / 同じ体の告知: ${changelog.announce.mode}`
  + ` / ツールの形の行: ${changelog.tool.mode}`
  + ` / 見た目だけ+手書き: ${changelog.look.mode0}→${changelog.look.mode}`
  + ` / 同じ相手が2行: ${changelog.twoLines.mode}(${changelog.twoLines.target0}行目のまま`
  + `${changelog.twoLines.target === changelog.twoLines.target0 ? '' : ` → ${changelog.twoLines.target}行目へ移った`})`
  + ` / 人が選び直した行: ${changelog.humanPick.target}(選んだのは 0)`
  + ` / 同点の選び方: ${tieIndex}番目`);
console.log(`     告知のとき: ${changelog.announce.items}`);
console.log(`     書き直したとき: ${changelog.tool.items}`);
console.log(`     見た目だけ+手書きのとき: ${changelog.look.items}`);
console.log(`     同じ相手が2行のとき: ${changelog.twoLines.items}`);
console.log(`     同じ相手が2行のときの注意: ${changelog.twoLines.note}`);
console.log(`     人が行を選び直したとき: ${changelog.humanPick.items}`);
console.log(`     表示名を付け替えたとき: ${changelog.rename.hist}`);
console.log(`  ⑨⑩⑪ 形の欄=${edited.tplDisabled ? '表示専用' : '選び直せる'}`
  + ` / 断り「${edited.tplNote.text}」(新規登録では${switched.tplNote ? '残る' : '消える'})`
  + ` / change で印は${edited.tplEvent.picked ? '立つ' : '立たない'}`
  + ` / テンプレート無しの土台=${edited.tplNone.fromLoaded ? '読み込んだ技' : '空'}`
  + ` / 足した選択肢の最大 ${Math.max(0, ...openAll.fired.map(f=>Math.max(0, ...Object.values(f.adhoc))))}個`);
console.log(`  ⑧ 特性idを変える: bad-id は止まる / 説明が無いと止まる / 書けば ${JSON.stringify(trait.ok.files)} を送る`);
console.log(`      ui.js だけ他所で変わったとき: ${trait.ok.guard}`);
if(errors.length){
  console.log(`\n問題が ${errors.length} 件あります:`);
  for(const e of errors) console.log('  - ' + e);
  process.exit(1);
}
console.log('すべて合格');
