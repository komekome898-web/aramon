/* 初回チュートリアルの通し検査(開発用。ゲームには読み込まない)。
   遊び心地は実機で見る前提で、ここでは「最後まで進めるか」「詰まないか」
   「通常の試合に影響していないか」を数字で確かめる。

   使い方: node tools/tutorial_test.mjs
   playwright が要る(作業用ディレクトリで npm i playwright)。 */
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let chromium;
try{ ({ chromium } = await import('playwright')); }
catch{
  const { createRequire } = await import('module');
  const req = createRequire(path.join(process.cwd(), 'x.js'));
  ({ chromium } = req('playwright'));
}

const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css',
                '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
                '.mp3':'audio/mpeg', '.mp4':'video/mp4', '.webm':'video/webm' };
const server = http.createServer((req, res)=>{
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (err, buf)=>{
    if(err){ res.writeHead(404); res.end(''); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  });
});
const PORT = 8071;
await new Promise(r=> server.listen(PORT, r));

const results = [];
const ok   = (name, cond, note='')=>{
  results.push({ name, pass: !!cond, note });
  console.log(`${cond ? 'OK  ' : 'NG  '} ${name}${note ? '  … ' + note : ''}`);
};

const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport:{ width:812, height:375 }, hasTouch:true, serviceWorkers:'block' });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e=> errs.push(String(e).slice(0,200)));

// 帯の案内に出てくる「」の文字が、実際にその画面のボタンに書いてあるか。
// ボタン名を変えたのに案内が古いまま、という食い違いを検出する(2026-08-18の「出撃/バトル開始」)
const hintLabels = ()=> page.evaluate(()=>{
  const st = (typeof tutState!=='undefined' && tutState) ? TUTORIAL_STEPS[tutState.i] : null;
  if(!st) return { ok:false, missing:['ステップ不明'] };
  const terms = (st.hint || '').match(/「[^」]+」/g) || [];
  if(!terms.length) return { ok:true, missing:[] };
  const norm = (t)=> (t||'').replace(/\s+/g, '');
  let text = '';
  (st.allow || []).forEach(sel=> document.querySelectorAll(sel).forEach(el=>{
    text += norm(el.textContent);
    el.querySelectorAll('input,textarea').forEach(i=>{ text += norm(i.placeholder || ''); });
  }));
  const missing = terms.map(t=> t.slice(1,-1)).filter(t=> !text.includes(norm(t)));
  return { ok: missing.length === 0, missing, id: st.id };
});
const okHint = async ()=>{ const r = await hintLabels(); ok(`案内の文字が画面にある(${r.id||'?'})`, r.ok, (r.missing||[]).join(' / ')); };

await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil:'load' });
await page.waitForTimeout(1500);

const step   = ()=> page.evaluate(()=> (typeof tutState!=='undefined' && tutState) ? TUTORIAL_STEPS[tutState.i].id : null);
const phase  = ()=> page.evaluate(()=> (typeof tutState!=='undefined' && tutState) ? tutState.phase : null);
const shown  = (id)=> page.evaluate(i=> { const el=document.getElementById(i); return !!el && !el.classList.contains('hidden'); }, id);
const cardNext = async ()=> { await page.evaluate(()=> document.getElementById('tutorialCardNextBtn').click()); await page.waitForTimeout(350); };
// 「押せるものが1つ以上ある」= 詰んでいない
const allowedCount = ()=> page.evaluate(()=> (typeof tutorialVisibleAllowed==='function') ? tutorialVisibleAllowed().length : -1);

// ---- 1. 初回起動: タイトル→2択カード
await page.evaluate(()=> localStorage.clear());
await page.reload({ waitUntil:'load' });
await page.waitForTimeout(1800);
await page.click('#titleScreen');
await page.waitForTimeout(700);
ok('タイトル後に選択カードが出る', await shown('tutorialCard'));
ok('選択カードに「ログインする」がある', await page.evaluate(()=> !document.getElementById('tutorialCardSubBtn').classList.contains('hidden')));

// ---- 2. 「はじめる」→ 最初のステップ
await cardNext();                                  // 2択カードで「はじめる」
ok('ステップ1はモンスター選択', await step() === 'pickMonster');
await cardNext();                                  // 「まずは相棒を選ぼう」カードを閉じる
ok('帯が出ている', await shown('tutorialBand'));
ok('押せる対象がある(pickMonster)', (await allowedCount()) > 0, `allow=${await allowedCount()}`);
await okHint();

// ---- 3. ロック: 許可していないボタンは効かない(本物のタップで確かめる)
await page.click('#headerSettingsBtn', { force:true }).catch(()=>{});
await page.waitForTimeout(250);
ok('許可外のボタンは効かない(設定が開かない)', !(await shown('settingsOverlay')));

// ---- 4. モンスターを選ぶ
await page.evaluate(()=>{ game.selectedElement='fire'; updatePlayButtonsEnabled(); });
await page.waitForTimeout(500);
ok('モンスターを選ぶと次へ進む', await step() === 'match');

// ---- 5. 練習試合
await cardNext();                                  // 「1試合やってみよう」カードを閉じる
await page.waitForTimeout(300);
ok('バトル開始ボタンが押せる状態', (await allowedCount()) > 0);
await okHint();
await page.evaluate(()=> document.getElementById('joinBtn').click());
await page.waitForTimeout(1200);
const m = await page.evaluate(()=>({
  tut: game.tutorialMatch, n: entities.length,
  hold0: ZONE_PHASES[0].holdTime, shrink1: ZONE_PHASES[1].shrinkTime,
  world: WORLD.w,
  botHp: Math.round(entities.filter(e=>e!==player)[0].maxHp), myHp: Math.round(player.maxHp),
  botTotal: (()=>{ const b=entities.filter(e=>e!==player)[0]; return b.matchMm ? mastermonStatTotal(b.matchMm) : null; })(),
  // 自分はマスモン未登録なので「種族の初期値」が自分の強さ(上限の基準と同じ)
  myTotal: battleStatLimitOf(null, player.element).total,
}));
ok('練習試合として始まっている', m.tut === true);
ok('参加は10体', m.n === 10, `n=${m.n}`);
ok('安置が短くなっている', m.hold0 === 31 && m.shrink1 === 18, `hold0=${m.hold0} shrink1=${m.shrink1}`);
ok('マップが狭い', m.world < 10000, `world=${m.world}`);
ok('botのステータス合計が自分より低い', m.botTotal !== null && m.botTotal < m.myTotal, `bot=${m.botTotal} me=${m.myTotal}`);
ok('試合中は帯を出さない', !(await shown('tutorialBand')));

// 決着させる(botを全部倒す)
await page.evaluate(()=>{
  entities.filter(e=> e!==player && e.alive).forEach(e=> killEntity(e, player));
});
await page.waitForTimeout(4200);
ok('リザルトに到達', await shown('resultScreen'));
await page.waitForTimeout(500);
ok('次はマスモン登録', await step() === 'register', `step=${await step()}`);

// ---- 6. マスモン登録
await cardNext();
await page.waitForTimeout(300);
ok('登録の対象が押せる', (await allowedCount()) > 0);
await okHint();
await page.evaluate(()=>{
  document.getElementById('mastermonRegisterName').value = 'テストモン';
  document.getElementById('mastermonRegisterConfirmBtn').click();
});
await page.waitForTimeout(600);
ok('登録すると次へ進む', await step() === 'train', `step=${await step()}`);

// ---- 6b. 途中で閉じても続きから(サービスワーカーの自動リロードを想定)
await page.reload({ waitUntil:'load' });
await page.waitForTimeout(1800);
await page.click('#titleScreen');
await page.waitForTimeout(800);
ok('中断しても同じステップから再開する', await step() === 'train', `step=${await step()}`);
ok('再開時も説明カードが出る', await shown('tutorialCard'));

// ---- 7. トレーニング
await cardNext();
await page.waitForTimeout(500);
ok('トレーニング画面が開いている', await shown('mastermonScreen'));
ok('トレーニングの対象が押せる', (await allowedCount()) > 0);
await okHint();
const trainInfo = await page.evaluate(()=>{
  const menu = document.querySelector('.mm-train-btn');
  const exec = document.getElementById('mastermonExecuteTrainBtn');
  if(menu) menu.click();
  const exec2 = document.getElementById('mastermonExecuteTrainBtn');
  if(exec2) exec2.click();
  return { menu: !!menu, exec: !!exec, tab: (typeof mastermonDetailTab!=='undefined' ? mastermonDetailTab : null),
           detail: !document.getElementById('mmDetailView').classList.contains('hidden') };
});
ok('トレーニングのメニューと実行ボタンがある', trainInfo.menu && trainInfo.exec, JSON.stringify(trainInfo));
await page.waitForTimeout(600);
ok('トレーニングすると次へ進む', await step() === 'account', `step=${await step()}`);

// ---- 8. アカウント(「あとで」で飛ばせる)
ok('アカウントのカードに「あとで」がある', await page.evaluate(()=> !document.getElementById('tutorialCardSubBtn').classList.contains('hidden')));
await page.evaluate(()=> document.getElementById('tutorialCardSubBtn').click());
await page.waitForTimeout(500);
ok('「あとで」でガチャへ進む', await step() === 'gacha', `step=${await step()}`);

// ---- 9. 無料10連 + 確定スキン
const diaBefore = await page.evaluate(()=> loadWallet().dia);
await cardNext();
await page.waitForTimeout(600);
ok('ガチャ画面が開いている', await shown('gachaOverlay'));
await okHint();
await page.evaluate(()=> doGacha(10));
await page.waitForTimeout(1200);
const g = await page.evaluate(()=>({
  dia: loadWallet().dia,
  skin: loadTutorialProgress().skin,
  owned: (()=>{ const s=loadTutorialProgress().skin; return s ? isSkinOwned(s) : null; })(),
  gift: localStorage.getItem('aramon_tutorial_gift_v1'),
}));
ok('ダイヤが減っていない(無料)', g.dia === diaBefore, `${diaBefore}→${g.dia}`);
ok('確定スキンを手に入れた', g.owned === true, `skin=${g.skin}`);
ok('受け取り済みの印が立つ', g.gift === '1');
// 2回目は無料にならない
const free2 = await page.evaluate(()=> tutorialGachaIsFree(10));
ok('2回目は無料にならない', free2 === false);
await page.evaluate(()=>{ const s=loadTutorialProgress().skin; if(s) window.__tutSkin=s; });
await page.waitForTimeout(600);
ok('スキンを得たら着せ替えへ', await step() === 'dressup', `step=${await step()}`);

// ---- 10. 着せ替え
await cardNext();
await page.waitForTimeout(600);
ok('着せ替えの対象が押せる', (await allowedCount()) > 0);
// 引いたスキンのサムネをタップ → 確定ボタンが「これに着せ替える」になる(案内どおりの文字)
const picked = await page.evaluate(()=>{
  const th = document.querySelector(`.mm-skin-thumb[data-skin="${window.__tutSkin}"]`);
  if(th) th.click();
  return !!th;
});
ok('引いたスキンのサムネがある', picked);
await page.waitForTimeout(300);
await okHint();
await page.evaluate(()=>{ document.getElementById('mmSkinConfirmBtn').click(); });
await page.waitForTimeout(600);
ok('着せ替えると次へ', ['pwa','help'].includes(await step()), `step=${await step()}`);

// ---- 11. PWA案内 → ヘルプ
if(await step() === 'pwa'){ await cardNext(); await page.waitForTimeout(400); }
ok('ヘルプ案内へ', await step() === 'help', `step=${await step()}`);
await cardNext();
await page.waitForTimeout(400);
ok('ヘルプの対象が押せる', (await allowedCount()) > 0);
await okHint();
await page.evaluate(()=>{ document.getElementById('helpOverlay').classList.remove('hidden'); });
await page.waitForTimeout(400);
await page.evaluate(()=>{ document.getElementById('helpOverlay').classList.add('hidden'); });
await page.waitForTimeout(500);
ok('ヘルプを見たら最後のカードへ', await step() === 'finish', `step=${await step()}`);

// ---- 12. 完了と報酬
const before = await page.evaluate(()=>({ dia: loadWallet().dia, tk: (loadBag().freeTrainTicket||0) }));
await cardNext();
await page.waitForTimeout(600);
const after = await page.evaluate(()=>({
  dia: loadWallet().dia, tk: (loadBag().freeTrainTicket||0),
  state: loadTutorialProgress().state,
  title: !!loadTitles().unlocked['tutorial'],
  layer: document.getElementById('tutorialLayer').classList.contains('hidden'),
  lobby: !document.getElementById('startScreen').classList.contains('hidden'),
}));
ok('ダイヤをもらえた', after.dia === before.dia + 60, `${before.dia}→${after.dia}`);
ok('チケットをもらえた', after.tk === before.tk + 3, `${before.tk}→${after.tk}`);
ok('称号がついた', after.title);
ok('完了として保存された', after.state === 'done');
ok('チュートリアル層が消えた', after.layer);
ok('ロビーに戻っている', after.lobby);

// ---- 13. 2回目の起動では出ない
await page.reload({ waitUntil:'load' });
await page.waitForTimeout(1800);
await page.click('#titleScreen');
await page.waitForTimeout(700);
ok('完了後は選択カードが出ない', !(await shown('tutorialCard')));

// ---- 13b. ログイン済みの端末には出さない
const loggedInCase = await page.evaluate(()=>{
  localStorage.removeItem('aramon_tutorial_v1');
  accountState.loggedIn = true;
  tutorialMaybeStart();
  const shown = !document.getElementById('tutorialCard').classList.contains('hidden');
  accountState.loggedIn = false;
  return shown;
});
ok('ログイン済みの端末には出さない', loggedInCase === false);
// 未ログインなら(データがあっても)出す
const guestCase = await page.evaluate(()=>{
  localStorage.removeItem('aramon_tutorial_v1');
  tutorialMaybeStart();
  const shown = !document.getElementById('tutorialCard').classList.contains('hidden');
  if(typeof tutorialStop==='function') tutorialStop();
  document.getElementById('tutorialCard').classList.add('hidden');
  return shown;
});
ok('未ログインなら出る(データがあっても)', guestCase === true);

// ---- 14. 通常の試合に影響していない
const normal = await page.evaluate(()=>{
  game.selectedElement = 'fire'; game.selectedMastermonKey = null;
  startGame();
  return { tut: game.tutorialMatch, n: entities.length, hold0: ZONE_PHASES[0].holdTime, world: WORLD.w };
});
ok('通常の試合は30体', normal.n === 30, `n=${normal.n}`);
ok('通常の安置は元のまま', normal.hold0 === 61, `hold0=${normal.hold0}`);
ok('通常のマップは元のまま', normal.world >= 18000, `world=${normal.world}`);
ok('通常の試合は練習試合ではない', normal.tut === false);

ok('ページエラーなし', errs.length === 0, errs.slice(0,2).join(' / '));

await browser.close();
server.close();

const bad = results.filter(r=> !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} 合格`);
process.exit(bad.length ? 1 : 0);
