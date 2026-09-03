/* Seedance など「AIで作った歩行動画」をスタジオに食わせ、受け入れが働くかを見る検査
   (開発用・ゲームには読み込まない)。

   何を見るか(設計仕様 §2 A2'・§11 A [10][22][23][25]):
     ① **2つの問いを分けて言う。** 「歩いていると言えるか」(周期の強さ)と
        「周期の長さを信用して切ってよいか」(山か谷から出ているか)は別物なので、
        強さが足りなくても周期が取れていれば「周期は取れていますが歩行とは断定できません」と出る。
        並べたコマがほぼ同じなのに「問題は見つかりませんでした」と言わない。
        **強くても「歩いている」と断定しない** —— 自己相関は歩きと揺れを区別できないので、
        画面には「周期らしさ」と出し、並べた後の隣接差と「目で確かめてください」を常に添える。
     ② その動画で **第2手(動きが最大の窓)の8コマの隣接差が、第1手(周期)より大きい**。
        さらに ②' **既定(自動)がその「よく動くほう」を実際に出している**
        (自動は両方を測って隣接差の最小が大きいほうを採る。周期の強さでは決めない)。
     ③ 診断の3段(候補16コマ / 抜いた後 / 並べた後)の数字が出る
     ④ **既定のまま(タップ0回)で抜ける** —— 動画を選んだら「背景の抜き方」は
        色で抜く(§3 B2)、背景色は外周8点から自動(A1)。検査は #mode を触らない。
     ⑤ static は、門番の文言を見る**前に**「解析コマが十分取れた」を別に確かめる
        (再生できていないのを「止まっているから弾いた」と読み違えない)。

   使い方:
     node tools/studio_video_test.mjs <動画のパス> [種類]
       種類 = walk(既定・歩行のある動画) / nomotion(ズーム・フェードだけ) / static(止まっている)
     例: node tools/studio_video_test.mjs front.webm
         node tools/studio_video_test.mjs zoom.webm nomotion
         node tools/studio_video_test.mjs static.webm static
   **種類は動画から見分けられないので引数で受ける**(「止まっているから弾いた」のか
   「端末が再生できなかったのか」は画面のエラーだけでは同じに見える)。
   動画は git に入れない素材なので、**パスを引数で受け、無ければスキップする**
   (検査を落とさない。落とすと素材を持たない人が先へ進めなくなる)。
   Chromium は H.264 を再生できないので **webm(VP9)** を渡すこと。       */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VIDEO = process.argv[2];
const KIND  = process.argv[3] || 'walk';
const KINDS = ['walk', 'nomotion', 'static'];

if(!VIDEO || !fs.existsSync(VIDEO)){
  console.log('スキップ: 動画のパスが指定されていないか、そのファイルがありません。');
  console.log('  使い方: node tools/studio_video_test.mjs <front.webm> [walk|nomotion|static]');
  console.log('  (動画は git に入れない素材です。Chromium 用に webm へ変換したものを渡してください)');
  process.exit(0);
}
if(!KINDS.includes(KIND)){
  console.error(`種類は ${KINDS.join(' / ')} のどれかです(渡された値: ${KIND})`);
  process.exit(1);
}
if(!/\.webm$/i.test(VIDEO))
  console.log('注意: Chromium は H.264(mp4)を再生できません。webm を渡してください。');

// playwright の探し方は harness_test.mjs / fx_shot.mjs と同じ
let chromium = null;
try { ({ chromium } = await import('playwright')); }
catch {
  for(const base of ['/opt/node22/lib/node_modules/', '/usr/lib/node_modules/', '/usr/local/lib/node_modules/']){
    try { ({ chromium } = createRequire(base)('playwright')); break; } catch {}
  }
  if(!chromium){ try { ({ chromium } = await import('playwright-core')); } catch {} }
}
if(!chromium){ console.error('playwrightが見つかりません(npm i -g playwright)。'); process.exit(1); }
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
               '.css':'text/css', '.json':'application/json', '.png':'image/png',
               '.webm':'video/webm', '.mp4':'video/mp4' };
const server = http.createServer((req, res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const p = path.join(ROOT, rel);
  if(!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r=> server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const launchBrowser = ()=> chromium.launch({ executablePath: EXEC,
  args:['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const failures = [];
const fail = m => failures.push(m);

/* 1回ぶんのプレビューを回し、診断と「選ばれた8コマの隣接差」を取る。
   **毎回ページを開き直す。** 同じページで動画を2度回すと、2周目の再生が
   進まないことがある(ヘッドレスの都合。実機の話ではない)。
   隣接差はスタジオ自身の関数(grayOfDrawable / adjacentDiffs / diffStat)で測るので、
   検査側に同じ計算を持たない。                                                */
/* 再生できなかったときの保険。**この検査を書いていて見つかった一番の当たり**は、
   `MOVE_MIN_DIFF`(隣り合うコマの差)だけで「動いているか」を見ていたせいで、
   発注者のSeedance動画が**通ったり弾かれたりしていた**こと(隣接差 1.1〜2.8 で境目をまたぐ)。
   時間をおいた差(`MOVE_SPAN_MIN_DIFF`)も見るようにして直っているが、
   ヘッドレスの復号が転ぶ可能性は残るので数回やり直す。                          */
const RETRY = 3;
// 「止まっている動画です」で止まったのは**期待どおり**なので、やり直さない
const STOPPED = /コマが変わっていません/;
async function runOnce(how, expectStop){
  let last = null;
  for(let i=0;i<RETRY;i++){
    last = await runAttempt(how);
    if(last.ok) return last;
    if(expectStop && STOPPED.test(last.meta || '')) return last;
    console.log(`  (${how}: ${i+1}回目は動画を再生できませんでした。やり直します)`);
    if(i === RETRY-1)
      console.log('  ※ 何度やっても再生できません。ヘッドレスの復号が追いついていない可能性が高いので、' +
                  '小さく変換した動画を渡してみてください(実機の話ではありません)。');

    await new Promise(r=> setTimeout(r, 1500));
  }
  return last;
}
async function runAttempt(how){
  /* **1回ごとにブラウザを起こし直す。** 同じブラウザで同じ動画を2度読むと
     2周目のデコードが進まず、全コマが同じ絵になる(ヘッドレスの都合。実機の話ではない)。 */
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport:{ width:900, height:1400 } });
  try{
  await page.goto(`${ORIGIN}/tools/studio_web.html`, { waitUntil:'load' });
  await page.waitForTimeout(400);
  /* 動画から作る。**「背景の抜き方」は触らない** —— 動画の既定は色で抜く(§3 B2)で、
     背景色は外周8点から自動(A1)。ここで selectOption すると、既定が壊れていても
     検査が気づけない(タップ0回で抜ける、が受け入れ条件)。 */
  await page.selectOption('#walkSrc', 'video');
  await page.selectOption('#cycleHow', how);
  await page.setInputFiles('#vidF', path.resolve(VIDEO));
  await page.waitForTimeout(1500);          // 下絵の描画と背景色の自動判定を待つ
  // 閾値は**画面の定数をそのまま読む**(検査側に同じ数字を書き写さない)
  const K = await page.evaluate(()=> ({ peakMin: PERIOD_PEAK_MIN, frameSame: FRAME_SAME_DIFF }));
  const chroma = await page.evaluate(()=> ({ rgb: state.chroma, auto: state.chromaAuto,
    mode: (document.getElementById('mode')||{}).value,
    badge: (document.getElementById('ckSwatch')||{}).textContent }));
  await page.evaluate(()=> preview('f'));
  for(let i=0;i<240;i++){
    const st = await page.evaluate(()=> ({
      done: !!(state.cand.f && state.walk.f),
      err: /ng/.test((document.getElementById('walkMeta')||{}).className || ''),
      meta: (document.getElementById('walkMeta')||{}).textContent || '' }));
    if(st.done || st.err) break;
    await page.waitForTimeout(500);
  }
  // 門番が見た数字(止まったときも読める)。「解析コマが取れたか」を文言と別に確かめる
  const probe = await page.evaluate(()=> state.probe);
  const r = await page.evaluate(async ()=>{
    const c = state.cand.f, w = state.walk.f;
    if(!c || !w) return { ok:false, meta:(document.getElementById('walkMeta')||{}).textContent };
    const gv = document.createElement('canvas'); gv.width = DIAG_W; gv.height = DIAG_W;
    const gc = gv.getContext('2d', { willReadFrequently:true });
    const grays = [];
    for(const b of w.frames){
      const im = await createImageBitmap(b);
      grays.push(grayOfDrawable(gc, im));
      if(im.close) im.close();
    }
    return { ok:true, diag:c.diag, note:c.note, issues:w.issues,
             eight: diffStat(adjacentDiffs(grays)),
             meta: (document.getElementById('walkMeta')||{}).textContent,
             diagText: (document.getElementById('walkDiag')||{}).textContent,
             diagShown: (document.getElementById('walkDiag')||{}).style.display !== 'none' };
  });
  r.chroma = chroma;
  r.K = K;
  r.probe = probe;
  return r;
  }finally{ await browser.close(); }
}

/* 止まっている動画は**門番で止まる**のが正。8コマを作ってしまったら不合格。
   ここだけは早く終わる(候補も診断も作られない)。 */
if(KIND === 'static'){
  const stop = await runOnce('auto', true);
  if(stop.ok) fail('static: 止まっている動画から8コマを作ってしまいました(門番が効いていません)');
  else {
    /* **文言を見る前に「解析コマが十分取れた」を別に確かめる**(§指摘32)。
       「止まっているから弾いた」と「そもそも再生できなかった」は、画面のエラーだけでは
       同じに見える。解析コマが取れていないなら、門番が効いた証拠にならない。 */
    const p = stop.probe;
    if(!p || !(p.rawN >= 4))
      fail(`static: 解析コマが ${p ? p.rawN : '不明'}枚しか取れていません` +
           '(動画を再生できていないので、門番が効いたかどうかを判定できません)');
    else if(!(p.gmax - p.gmin >= 3))
      fail(`static: コマが描けていません(明るさの幅 ${(p.gmax-p.gmin).toFixed(1)})。` +
           '止まっているかどうか以前に、動画が読めていません');
    else if(!STOPPED.test(stop.meta || ''))
      fail('static: 止まっている動画を別の理由で弾きました: ' + stop.meta);
    else console.log(`止まっている動画: 解析コマ ${p.rawN}枚・明るさの幅 ` +
                     `${(p.gmax-p.gmin).toFixed(1)}(=読めている)/ 動き 隣 ${p.moved.toFixed(2)}・` +
                     `時間をおいて ${p.movedSpan.toFixed(2)} → 門番で止まりました — ${stop.meta}`);
  }
  server.close();
  if(failures.length){
    console.log(`不合格 ${failures.length} 件:`);
    for(const f of failures) console.log('  - ' + f);
    process.exit(1);
  }
  console.log('AI動画の受け入れ(static): 合格(コマが変わっていない動画は8コマを作らない)');
  process.exit(0);
}

/* 「自動」で回して、**2つの問いが分かれているか**を見る(§指摘27)。
     ① 歩いていると言えるか      … 周期の強さ(`periodFound`)。画面の言い方がこれと合う
     ② 周期を信用して切ってよいか … `periodUsable`(山か谷から出ているか)
   1つの数字で両方を決めていたころは、谷から正しい周期が取れている素材まで第2手へ落ち、
   1周期に足りない所で切って継ぎ目が飛んでいた。
   **どちらの手で切るかは強さでは決めない**(§指摘28。下の ② で見る)。 */
const auto = await runOnce('auto');
if(!auto.ok) fail('自動でプレビューできませんでした: ' + auto.meta);
if(auto.chroma){
  if(auto.chroma.mode !== 'chroma')
    fail(`④ 動画の既定の抜き方が「色で抜く」ではありません(いまは ${auto.chroma.mode})`);
  if(!auto.chroma.rgb) fail('A1: 背景色が自動で決まりませんでした(タップ0回で抜けない)');
  else console.log(`背景色の自動判定: ${auto.chroma.badge}(rgb ${auto.chroma.rgb.join(',')})` +
                   ` / 抜き方の既定 ${auto.chroma.mode}`);
}
if(auto.ok){
  const K = auto.K, ap = auto.diag.period;
  const weakAuto = ap.peak < K.peakMin;      // ① 歩いていると言えるか
  const usable = ap.how !== 'none';          // ② 周期の長さを信用して切ってよいか
  /* ①と②を分けて言えているか。強さが足りないのに周期は取れている素材では
     「周期は取れていますが歩行とは断定できません」と出るのが正。 */
  if(weakAuto && usable && !/周期は取れていますが歩行とは断定できません/.test(auto.diagText || ''))
    fail(`① 周期らしさ ${ap.peak.toFixed(3)}(<${K.peakMin})で周期は ${ap.how} から取れているのに、` +
         '「周期は取れていますが歩行とは断定できません」と分けて言えていません');
  if(weakAuto && !usable && !/歩行の周期が見つかりません/.test(auto.diagText || ''))
    fail('① 山も谷も出ていないのに「歩行の周期が見つかりません」と言っていません');
  // 周期そのものが取れていないなら、比べるまでもなく第2手
  if(!usable && auto.diag.pickHow !== 'move')
    fail(`① 周期の長さが取れていない(${ap.how})のに周期で切り出しています`);
  // 「歩いている」と断定しない = 並べた後の数字と目で見る案内を**常に**添える
  if(!/8コマを目で確かめてください/.test(auto.diagText || ''))
    fail('② 「8コマを目で確かめてください」が出ていません(周期の強さで断定している)');
  if(!/並べた後の隣り合うコマの差/.test(auto.diagText || ''))
    fail('② 並べた後の隣接差(最小・平均)が常には出ていません');
  if(/歩行の周期が見つかりました/.test(auto.diagText || ''))
    fail('② 「歩行の周期が見つかりました」と断定しています(自己相関は揺れと区別できません)');
  if(weakAuto && !/AIで歩く動画を作るときの文/.test(auto.diagText || ''))
    fail('③ 周期が弱いのに定型文(A6)への案内がありません');
  /* ④ **足元の影は結果を必ず言う**(§指摘35c)。ONなのに黙ると、落ち影が無いのか
     検出が効いていないのかを画面から区別できない。この検査は #dropShadow を触らない
     (既定ON)。落ち影の無い動画では「見つからず」が出るのが正。 */
  if(auto.diag.shadowOn){
    const s = auto.diag.shadow || {};
    console.log(`足元の影: 見つかった ${s.found}/${s.n}コマ / 落とした ${s.px}画素` +
                (s.split ? `(判定が ${s.split}コマで割れたので落としていません)` : ''));
    if(!/足元の影/.test(auto.diagText || ''))
      fail('④ 「影を落とす」がONなのに、足元の影の結果が画面に出ていません');
    if(!s.px && !s.split && !/見つから/.test(auto.diagText || ''))
      fail('④ 足元の影が1コマも見つからなかったのに「見つからず」と言っていません');
  }
}

/* ズーム・フェードだけの動画はここまで。
   第1手と第2手の比べ合いは、歩いている素材でしか意味を持たない。

   **見るのは「歩いていると言わないこと」だけ。** どちらの手で切ったかは見ない ——
   切り方は測った動きで決まるようになった(§指摘28)ので、歩いていない動画でも
   周期の区間のほうがよく動くことはあり、それは間違いではない。
   周期の**長さ**が取れているか(`how`)は素材次第なので、言い方は2通りのどちらかを許す
   (どちらも「歩行とは言えない」と言っている・§指摘27)。 */
if(KIND === 'nomotion'){
  if(auto.ok){
    const p = auto.diag.period;
    console.log(`周期らしさ ${p.peak.toFixed(3)}(求め方 ${p.how}) / 切り出し方 ${auto.diag.pickHow}`);
    if(p.peak >= auto.K.peakMin)
      fail(`① 揺れ・ズームだけの動画の周期らしさが ${p.peak.toFixed(3)} で` +
           `${auto.K.peakMin} 以上あります(検査の入力を見直してください)`);
    const saysNoWalk = /歩行の周期が見つかりません/.test(auto.diagText || '') ||
                       /周期は取れていますが歩行とは断定できません/.test(auto.diagText || '');
    if(!saysNoWalk)
      fail('① 揺れ・ズームだけの動画で「歩行とは言えない」と言っていません' +
           `(周期の求め方 ${p.how})`);
    // 周期の長さが取れていないなら、比べるまでもなく第2手(§指摘27)
    if(p.how === 'none' && auto.diag.pickHow !== 'move')
      fail(`① 周期の長さが取れていない(${p.how})のに周期で切り出しています`);
  }
  server.close();
  if(failures.length){
    console.log(`不合格 ${failures.length} 件:`);
    for(const f of failures) console.log('  - ' + f);
    process.exit(1);
  }
  console.log('AI動画の受け入れ(nomotion): 合格(歩行とは言えないと言い、定型文へ案内する)');
  process.exit(0);
}

const period = await runOnce('period');   // 第1手: 見つけた周期のぶんを切り出す
if(!period.ok) fail('第1手(周期)でプレビューできませんでした: ' + period.meta);
const move = await runOnce('move');       // 第2手: 動きが最大の窓から選ぶ
if(!move.ok) fail('第2手(動きが最大の窓)でプレビューできませんでした: ' + move.meta);

if(period.ok && move.ok){
  const d = move.diag, p = d.period, K = move.K;
  console.log('--- 診断 ---');
  console.log(`  周期の強さ(山) ${p.peak.toFixed(3)}(${p.peakLag}コマ) / 谷 ${p.dip.toFixed(3)}(${p.dipLag}コマ)` +
              ` / 判定 ${p.how} / 採った周期 ${p.period}コマ`);
  console.log(`  コマ間隔 ${(d.frameDt*1000).toFixed(0)}ms / 解析コマ ${d.rawN}枚 / ` +
              `元動画の動き 隣 ${d.moved.toFixed(2)}・時間をおいて ${d.movedSpan.toFixed(2)}`);
  for(const s of d.stages)
    console.log(`  ${s.name}: 最小 ${s.min.toFixed(2)} / 平均 ${s.avg.toFixed(2)}`);
  console.log(`  揃え直しで捨てた横のぶれ ${d.alignDropPx.toFixed(1)}px / ` +
              `落とした影 ${d.shadow.px}画素(見つかった ${d.shadow.found}/${d.shadow.n}コマ)`);
  console.log(`  8コマの隣接差: 第2手 平均 ${move.eight.avg.toFixed(2)} 最小 ${move.eight.min.toFixed(2)}` +
              ` / 第1手 平均 ${period.eight.avg.toFixed(2)} 最小 ${period.eight.min.toFixed(2)}`);
  console.log('------------');

  /* ① 周期の強さを隠さずに出し、**弱ければ「見つかりません」とはっきり言う**。
     この素材で強さがどう出るかは動画次第なので、**測った強さと画面の言い方が
     食い違っていないこと**を見る(数字に合わせて言い方を変えていないか)。
     閾値は画面から読んだ K を使う(検査側に同じ数字を書き写さない)。 */
  const weak = p.peak < K.peakMin;
  const saysNone = /歩行の周期が見つかりません/.test(move.diagText || '');
  if(weak !== saysNone)
    fail(`① 周期らしさ ${p.peak.toFixed(3)} と画面の言い方が食い違っています` +
         `(「見つかりません」と出ている: ${saysNone})`);
  if(!/周期らしさ/.test(move.diagText || '')) fail('① 画面に周期らしさの数字が出ていません');
  /* 「動いているか」は隣と時間をおいた差の**2つ**で見る。隣だけだと、
     ゆっくり動く素材を「1コマも進んでいない」と誤って弾く(この素材で実際に起きていた)。 */
  if(!Number.isFinite(d.movedSpan)) fail('① 時間をおいた動きの数字が出ていません');
  if(!/時間をおいて/.test(move.diagText || '')) fail('① 画面に時間をおいた動きが出ていません');
  /* **同じような絵が並んだのに「問題は見つかりませんでした」と言わない。**
     ここが今回の核心(異常を検知できていなかった)。 */
  const flat = move.diag.stages[2].min < K.frameSame;
  if(flat && /問題は見つかりませんでした/.test(move.meta || ''))
    fail('① 並べた後のコマがほぼ同じなのに「問題は見つかりませんでした」と報告しています');

  // ② 第2手(動きが最大の窓)のほうが、第1手(周期)より8コマがよく動く
  if(!(move.eight.avg > period.eight.avg))
    fail(`② 第2手の隣接差 ${move.eight.avg.toFixed(2)} が第1手 ${period.eight.avg.toFixed(2)} を超えていません`);

  /* ②' **既定(自動)が「よく動くほう」を出す**(§11 [10] の受け入れ・§指摘28)。
     周期の強さで決めていたころは、強さが足りているこの素材で第1手を採り、
     **動きの少ないほうの8コマ**を出していた(第1手 最小 2.62 / 第2手 最小 3.45)。
     見るのは2つ: 並べた後の8コマの隣接差の最小が `FRAME_SAME_DIFF` 以上であること、
     そして**採った手が、実際に最小の大きいほうと一致している**こと。 */
  if(auto.ok){
    const better = move.eight.min > period.eight.min ? 'move' : 'period';
    console.log(`  自動が採った手: ${auto.diag.pickHow}(実測でよく動くのは ${better})` +
                ` / 自動の8コマ 平均 ${auto.eight.avg.toFixed(2)} 最小 ${auto.eight.min.toFixed(2)}`);
    if(auto.eight.min < K.frameSame)
      fail(`②' 自動で並べた8コマの隣接差の最小が ${auto.eight.min.toFixed(2)}` +
           `(${K.frameSame} 以上でないと「同じ絵が並んでいる」)`);
    if(auto.diag.pickHow !== better)
      fail(`②' 自動が ${auto.diag.pickHow} を採りましたが、よく動くのは ${better} です` +
           `(第1手 最小 ${period.eight.min.toFixed(2)} / 第2手 最小 ${move.eight.min.toFixed(2)})`);
    /* 「自動の8コマそのものが第2手ぶんの数字か」は見ない —— 回すたびに動画の復号が
       わずかに揺れるので、同じ手でも小数点以下が動く。見るべきは**採った手が正しいか**。 */
    // 判断の根拠(両方の数字)を画面へ常時出しているか
    if(!/見積もった8コマの隣接差の最小/.test(auto.diagText || ''))
      fail('②\' 第1手・第2手を測った数字が画面に出ていません(なぜその手を採ったのか分からない)');
  }

  // ③ 診断の3段が数字で出る
  if(!d.stages || d.stages.length !== 3) fail('③ 診断が3段ではありません');
  else for(const s of d.stages){
    if(!Number.isFinite(s.min) || !Number.isFinite(s.avg))
      fail(`③ 「${s.name}」の数字が出ていません`);
  }
  if(!move.diagShown) fail('③ 診断の表示が出ていません');
  for(const s of ['候補16コマ', '抜いた後', '並べた後'])
    if(!(move.diagText || '').includes(s)) fail(`③ 画面に「${s}」の行がありません`);
}

server.close();

if(failures.length){
  console.log(`不合格 ${failures.length} 件:`);
  for(const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('AI動画の受け入れ(walk): すべて合格(既定のまま抜ける / 周期らしさと言い方が一致 / ' +
            '断定せず目で確かめる案内 / 第2手のほうが動く / 自動がよく動くほうを採る / 診断3段)');
