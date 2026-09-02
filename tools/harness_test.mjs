/* 技プレビュー用ハーネスの成立確認(開発用・ゲームには読み込まない)。

   何を見るか(設計仕様 §4 C1 / §11 [28][35]・§7):
     ① 本物の index.html を、localStorage を差し替えた状態で起動できるか
     ② 起動〜試合開始〜発射まで進めても、**本物の保存データが1件も変わらない**か
     ③ rAF を止めずに(=動くプレビューとして)技が撃てるか — 弾が出る
     ④ スタジオと同じ道(fx_driver.js への postMessage)で技を差し替えられるか
        — zan の tier3 を burst:3 / burst:9 にして撃つと、返事の spawned が 3 / 9 になる
        **どちらも data.js の実値(zan の tier3 は7発)と違う数にしてある。**
        実値と同じ数を混ぜると「差し替えが効いていない」ときも合格してしまう。
     ⑥ **まだ data.js に無いキー**でも、defineElement → setup → override → fire で弾が出るか
        (スタジオで作りかけのモンスターを撃つ道。createMonster が ELEMENTS[key] を読む)
     ⑦ プレビューでは**安置が縮まない**か — 61秒(ZONE_PHASES[0].holdTime)を超えて回しても
        phaseIndex が 0 のまま・アイテムが湧かない・自機が生きている

   使い方:
     node tools/harness_test.mjs              index.html 側の harness=1 だけで検査(既定)
     node tools/harness_test.mjs --noshim     同上(既定と同じ。旧い呼び方)
     node tools/harness_test.mjs --shim       addInitScript でも差し替えを入れて検査
     node tools/harness_test.mjs --shot <png> 撮った画面を保存する
     node tools/harness_test.mjs --json       生の測定値も出す

   既定が「本体側だけ」なのはなぜか(§11 [35]):
     実機(iPhone Safari)で効くのは index.html の先頭インラインスクリプトであって、
     検査ツールが注入する差し替えではない。**検査は本番と同じものを通す。**
     --shim は「本体側が壊れたときに、検査の道具側が生きているか」を切り分ける用。   */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const opt  = (n, d)=>{ const i = args.indexOf('--'+n); return i>=0 && args[i+1] && !args[i+1].startsWith('--') ? args[i+1] : d; };
const flag = n => args.includes('--'+n);
/* 既定は入れない(本体側の harness=1 だけを見る)。--noshim はその既定の別名で、
   付けても外しても同じ ―― 昔の呼び方が黙って別の意味にならないように受けておく。 */
const SHIM   = flag('shim') && !flag('noshim');
const SHOT   = opt('shot', null);
const EXEC   = opt('chromium', process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium');

/* 検査で使う技。**data.js の値を当てにしない**(バランス調整で変わるため)。
   burst をこちらから2通り与えて、差し替えが効いたかを弾の本数で見る。
   **どちらも実値と違う数にする** ―― 実値(zan の tier3 は7発)を混ぜると、
   差し替えが1回も効いていなくてもその1通りが合格してしまう。 */
const TEST_EL   = 'zan';
const TEST_TIER = 3;
const BURSTS    = [3, 9];
/* まだ data.js に無いキーでのプレビュー(スタジオで作りかけのモンスター)。
   ELEMENTS にも SIGNATURE_MOVES にも無いので、defineElement を通さないと落ちる。 */
const NEW_EL    = 'studio_probe_x';
/* 安置を回してみる長さ。**phaseIndex 0 の holdTime(data.js の ZONE_PHASES = 61秒)を超える**
   ことだけが条件なので、余裕を見て70秒ぶん進める。 */
const ZONE_SEC  = 70;

// playwright の探し方は fx_shot.mjs と同じ
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
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.mp3':'audio/mpeg',
               '.mp4':'video/mp4', '.webm':'video/webm', '.wasm':'application/wasm' };
const server = http.createServer((req, res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const p = path.join(ROOT, rel);
  if(!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r=> server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: EXEC,
  args:['--no-sandbox','--use-gl=swiftshader','--mute-audio'] });
const ctx = await browser.newContext({ viewport:{ width:1280, height:720 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e=> errors.push(String(e).slice(0, 160)));

// 本物の保存データの代わり(ゲームが読むはずの鍵をいくつか置いておく)
await page.goto(`${ORIGIN}/manifest.json`, { waitUntil:'domcontentloaded' });
await page.evaluate(()=>{
  localStorage.clear();
  localStorage.setItem('aramon_player_name_v1', '本物の名前');
  localStorage.setItem('aramon_probe_marker', 'untouched');
});
const dump = ()=> JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k, localStorage.getItem(k)])));
const before = await page.evaluate(dump);

/* --shim: 検査の道具側でも差し替えを入れる(既定では入れない)。
   本体側と二重になるが、後から入るこちらは何もしない(既に差し替わっている)。 */
if(SHIM){
  await page.addInitScript(()=>{
    if(!/[?&]harness=1/.test(location.search)) return;
    const mem = new Map();
    const shim = {
      getItem: k=> mem.has(String(k)) ? mem.get(String(k)) : null,
      setItem: (k,v)=> { mem.set(String(k), String(v)); },
      removeItem: k=> { mem.delete(String(k)); },
      clear: ()=> mem.clear(),
      key: i=> Array.from(mem.keys())[i] ?? null,
      get length(){ return mem.size; },
    };
    try{ Object.defineProperty(window, 'localStorage', { value: shim, configurable:true }); }
    catch(e){ window.__harnessShimFailed = String(e); }
    window.__harnessShim = true;
  });
}

/* **harness=1 だけで開く**(netprobe=1 は付けない)。
   これで「harness=1 でも firebase を読まず Service Worker も登録しない」ことまで一緒に見る。 */
await page.goto(`${ORIGIN}/index.html?harness=1`, { waitUntil:'load' });
await page.waitForTimeout(1500);
// 差し替えが効いていれば、退避しておいた鍵はページ側から見えない
const shim = await page.evaluate(async ()=> ({
  installed: !!window.__harnessShim,
  ok: window.__harnessOk === true,
  failed: window.__harnessShimFailed || null,
  markerHidden: localStorage.getItem('aramon_probe_marker') === null,
  offline: window.__aramonOffline === true,
  /* Service Worker を**登録していない**ことを見る。controller は「まだ有効化されていない」
     ときも null なので、登録そのものを数える(0件なら登録していない)。 */
  swRegs: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : null,
}));

/* スタジオとまったく同じ駆動コードを注入する(コピーを持たない)。 */
const DRIVER = fs.readFileSync(path.join(__dirname, 'fx_driver.js'), 'utf8');
await page.evaluate(DRIVER);
await page.waitForFunction(()=> window.__fx && window.__fx.ready(), null, { timeout:30000 }).catch(()=>{});

/* ゲームを進めて技を撃つ。**スタジオが使う道(postMessage)をそのまま通す** ――
   検査だけ別経路にすると、受け口が壊れていても合格してしまう。 */
const ran = await page.evaluate(async (a)=>{
  const out = { fires:[] };
  out.fns = ['startGame','update','render','fireMove','createMonster'].map(n=> typeof window[n]);
  // driver の postMessage 受け口へ投げて返事を待つ(スタジオ側と同じ手順)
  let seq = 0;
  const ask = (msg, ms)=> new Promise((res, rej)=>{
    const id = 'h' + (++seq);
    const to = setTimeout(()=>{ window.removeEventListener('message', on); rej(new Error(msg.cmd+' の返事がありません')); }, ms || 15000);
    function on(ev){
      const d = ev.data;
      if(!d || !d.__fx || d.id !== id) return;
      clearTimeout(to); window.removeEventListener('message', on);
      d.ok ? res(d.result) : rej(new Error(d.error));
    }
    window.addEventListener('message', on);
    window.postMessage(Object.assign({ id }, msg), '*');
  });
  try{
    /* mode:'preview' = rAF を止めない・カメラを固定しない・step() を使わない。
       silent は検査では true(ヘッドレスで音は無意味。スタジオは false で本物を鳴らす)。 */
    out.setup = await ask({ cmd:'setup', element:a.el, mapKey:'wild', mode:'preview',
                            silent:true, seed:20260902, view:'front' }, 30000);
    out.vocab = await ask({ cmd:'vocab' }, 20000);
    await new Promise(r=> setTimeout(r, 800));
    out.player = !!(entities.find(e=> e.isPlayer));
    // 素の3技を土台に、tier3 の burst だけを差し替えて撃つ(2通り)
    const base = JSON.parse(JSON.stringify(SIGNATURE_MOVES[a.el]));
    for(const b of a.bursts){
      const moves = JSON.parse(JSON.stringify(base));
      moves[a.tier-1].burst = b;
      await ask({ cmd:'override', element:a.el, moves });
      // 直前の弾を消して数えやすくする(spawned は「撃った直後の総数」なので)
      projectiles.length = 0;
      const r = await ask({ cmd:'fire', tier:a.tier });
      out.fires.push({ burst:b, spawned:r.spawned, added:r.added, name:r.name, style:r.style,
                       aura:(r.name && SIGNATURE_MOVES[a.el][a.tier-1].aura) || null });
      await new Promise(r2=> setTimeout(r2, 400));
    }
    out.matchTime = +matchTime.toFixed(2);
    /* ⑦ 安置。**61秒の壁を越えて回す。** プレビューは rAF が生きているので実時間でも
       進むが、それだけだと70秒待つことになるので step() でまとめて進める
       (update(dt) を回す = updateZone / updateTrainingRange のどちらを通るかの検査そのもの)。 */
    window.__fx.step(a.zoneSec, 1/30, false);
    out.zone = await ask({ cmd:'zone' });
  }catch(e){ out.error = String(e && e.message || e).slice(0, 300); }
  return out;
}, { el:TEST_EL, tier:TEST_TIER, bursts:BURSTS, zoneSec:ZONE_SEC });

/* ⑥ **まだ data.js に無いキー**でのプレビュー。ページを開き直して(1つの iframe で
   startGame を2度呼ばない決まりに合わせる)、defineElement → setup → override → fire。 */
await page.goto(`${ORIGIN}/index.html?harness=1`, { waitUntil:'load' });
await page.waitForTimeout(1200);
await page.evaluate(DRIVER);
await page.waitForFunction(()=> window.__fx && window.__fx.ready(), null, { timeout:30000 }).catch(()=>{});
const ranNew = await page.evaluate(async (a)=>{
  const out = {};
  let seq = 0;
  const ask = (msg, ms)=> new Promise((res, rej)=>{
    const id = 'n' + (++seq);
    const to = setTimeout(()=>{ window.removeEventListener('message', on); rej(new Error(msg.cmd+' の返事がありません')); }, ms || 15000);
    function on(ev){
      const d = ev.data;
      if(!d || !d.__fx || d.id !== id) return;
      clearTimeout(to); window.removeEventListener('message', on);
      d.ok ? res(d.result) : rej(new Error(d.error));
    }
    window.addEventListener('message', on);
    window.postMessage(Object.assign({ id }, msg), '*');
  });
  try{
    out.known = !!ELEMENTS[a.el];        // 本当に「知らないキー」かを先に確かめる
    out.define = await ask({ cmd:'defineElement', key:a.el, aura:'red', def:{
      label:'けんさ用', color:'#ff6b35', dark:'#a8431d', speed:190, hp:110, trait:'' } });
    out.setup = await ask({ cmd:'setup', element:a.el, mapKey:'wild', mode:'preview',
                            silent:true, seed:20260902, view:'front' }, 30000);
    // 技はスタジオが作る形(いま画面にある3技)と同じ「素の3技」を渡す
    const moves = JSON.parse(JSON.stringify(SIGNATURE_MOVES[a.donor]));
    moves[a.tier-1].burst = a.burst;
    moves[a.tier-1].name = 'けんさの技';       // MOVE_AURA に無い名前(オーラの落ち先を見る)
    await ask({ cmd:'override', element:a.el, moves });
    projectiles.length = 0;
    out.fire = await ask({ cmd:'fire', tier:a.tier });
    out.aura = SIGNATURE_MOVES[a.el][a.tier-1].aura;
  }catch(e){ out.error = String(e && e.message || e).slice(0, 300); }
  return out;
}, { el:NEW_EL, donor:TEST_EL, tier:TEST_TIER, burst:BURSTS[1] });
if(SHOT) await page.screenshot({ path: SHOT });

// 本物の localStorage が変わっていないか(別ページで素の状態を読む)
const page2 = await ctx.newPage();
await page2.goto(`${ORIGIN}/manifest.json`, { waitUntil:'domcontentloaded' });
const after = await page2.evaluate(dump);
await browser.close(); server.close();

/* ------------------------------------------------------------ 合否 */
const A = JSON.parse(before), B = JSON.parse(after);
const changed = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter(k => A[k] !== B[k]);
const fired = ran.fires || [];
const burstOk = fired.length === BURSTS.length && fired.every((f, i)=> f.spawned === BURSTS[i]);
const vocab = ran.vocab || {};
const zone = ran.zone || {};
const nf = ranNew.fire || {};
const checks = [
  ['① 起動できた', ran.player === true && !ran.error, ran.error || (ran.player ? '' : 'プレイヤーが出ませんでした')],
  ['② 保存データ不変', changed.length === 0, changed.length ? '変わった鍵: ' + changed.join(', ') : ''],
  ['③ 差し替えが効いている', shim.ok && shim.markerHidden,
    shim.ok ? (shim.markerHidden ? '' : 'ページから本物の鍵が見えます') : '__harnessOk が false'],
  /* harness=1 は Service Worker を登録しない枝へ入る。controller で見ると
     「登録済みだがまだ有効化されていない」も見逃すので、登録の件数そのものを見る。 */
  ['③b Service Worker を登録していない', shim.swRegs === 0, `登録 ${shim.swRegs}件`],
  ['④ 技の差し替えが弾数に出た', burstOk,
    fired.length ? fired.map(f=> `burst${f.burst}→${f.spawned}発`).join(' / ') : '撃てませんでした'],
  /* SEは「鳴らせる音すべて」から選ばせるので、日本語名つきの一覧(SE_TEST_LABELS)を
     全部含んでいることまで見る。技に今使われている18件だけだと足りない。 */
  ['⑤ 語彙が取れた', (vocab.projStyles||[]).length > 0 && (vocab.aoeStyles||[]).length > 0
      && (vocab.seStyles||[]).length >= Object.keys(vocab.seLabels||{}).length
      && Object.keys(vocab.seLabels||{}).length > 40,
    `弾の形 ${(vocab.projStyles||[]).length} / 範囲の形 ${(vocab.aoeStyles||[]).length} / SE ${(vocab.seStyles||[]).length}` +
    `(うち日本語名つき ${Object.keys(vocab.seLabels||{}).length})` +
    ` / 版 ${vocab.cacheName || '(取れず)'}`],
  ['⑥ 未登録のキーでも撃てた', !ranNew.error && ranNew.known === false && nf.spawned === BURSTS[1],
    ranNew.error || `知らないキー: ${ranNew.known === false} / 名乗らせた: ${(ranNew.define||{}).ok}` +
      ` / 撃った弾 ${nf.spawned}発(狙い ${BURSTS[1]})`],
  ['⑦ 技のオーラが乗った', ranNew.aura != null,
    `差し替えた技の aura = ${ranNew.aura == null ? '(null=消えている)' : ranNew.aura}`],
  ['⑧ プレビューでは安置が縮まない', zone.zonePhase === 0 && zone.shrinking === false
      && zone.loot === 0 && zone.alive === true && (zone.matchTime||0) > 61,
    `${zone.matchTime}秒回して phase ${zone.zonePhase} / 縮小 ${zone.shrinking}` +
    ` / アイテム ${zone.loot}個 / 自機 ${zone.alive ? '生存' : '死亡'}(HP ${zone.hp})`],
];
console.log(`ハーネス検査(${SHIM ? '--shim: 検査側でも差し替え' : 'index.html の harness=1 だけ'})`);
console.log(`  差し替え: ${shim.installed ? '入った' : '入っていない'}` +
            `${shim.failed ? ' / 失敗: ' + shim.failed : ''}` +
            ` / __harnessOk: ${shim.ok} / 外へ出ない起動: ${shim.offline}` +
            ` / SWの登録 ${shim.swRegs}件`);
if(fired.length) console.log('  撃った技: ' + fired.map(f=> `${f.name}(${f.style}) burst${f.burst}→${f.spawned}発`).join(' / '));
for(const [name, ok, note] of checks) console.log(`  ${ok ? '合格' : '不合格'} ${name}${note ? ' — ' + note : ''}`);
if(errors.length) console.log('  ページの例外: ' + errors.slice(0, 5).join(' / '));
if(flag('json')) console.log(JSON.stringify({ shim, ran, ranNew, changed, errors: errors.slice(0, 5) }, null, 1));
const ng = checks.filter(c => !c[1]);
if(ng.length) process.exit(1);
console.log('  すべて合格');
