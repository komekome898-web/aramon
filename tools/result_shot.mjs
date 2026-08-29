/* リザルト画面の撮影(批評エージェント用。開発用でゲームには読み込まない)。

   リザルトを全面刷新するにあたり、**人(批評エージェント)が目で見て採点する**ための
   スクリーンショットを機械的に揃える。layout_test.mjs が「見切れ・押しやすさ・重なり」を
   数字で見るのに対して、こちらは**絵をそのまま出す**のが役目。

   使い方:
     node tools/result_shot.mjs [--out <dir>] [--only <variant>] [--delay <ms>]
       --out    出力先(既定は下の DEFAULT_OUT)
       --only   1つの場面だけ撮る(win / lose / top3 / register / team / raid / full / lose-p2)
       --delay  画面を出してから撮るまでの待ち(既定 1200ms)。
                **刷新後は演出(ずらして出す・数字が回る・バーが伸びる)が入るので、
                「演出が終わった状態」を撮るためのつまみ。** 短くすれば途中も撮れる。

   撮り方の決まり(layout_test.mjs と同じ土台。ずれると別の画面を撮ってしまう):
     ・ローカルにHTTPサーバを立てて index.html を開く。sw.js は404で返す(キャッシュを挟ませない)
     ・chromium は /opt/pw-browsers/chromium
     ・screen を viewport と同じ値にしないと updateForceLandscapeMode() の判定が偽になり、
       **強制横向き(#appRootの90度回転)が効かないまま**撮れてしまう
     ・タイトル画面は #titleScreen をクリックして消す。チュートリアルの案内カード
       (.mastermon-confirm-overlay)も消す(出ていると全画面を覆う)
     ・**縦持ちの端末は絵を回して保存する。** 縦持ちの実機では #appRoot が90度回って
       描かれる(html.force-landscape)ので、そのまま撮ると横倒しの絵になり、
       批評家は「読めない絵」を採点することになる。**実機を手に持ったときに見える向き**へ
       戻してから保存する(回すのは絵だけで、寸法も収まりも変わらない)。

   中身の作り方: **ui.js の本物の関数(showResultNow / raidShowResult / renderResultBadges /
   createMonster / assignTeams …)を通す。** DOMへ雛形を手書きすると、画面を直したときに
   ここだけ古い形で残り、批評家が「今は無い画面」を採点することになる。
   こちらが用意するのは**入力(試合の状態)だけ**にする。

   場面(variant)を1つ足したら VARIANTS へ1行足す。 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = '/tmp/claude-0/-home-user-aramon/5c45e27f-bec5-581b-a334-5ea195940d60/scratchpad/rs';

/* ===== 引数 ===== */
const argv = process.argv.slice(2);
const argOf = (name, def)=>{
  const i = argv.indexOf(name);
  return (i >= 0 && argv[i+1] != null) ? argv[i+1] : def;
};
const OUT_DIR = path.resolve(argOf('--out', DEFAULT_OUT));
const ONLY = argOf('--only', null);
const DELAY = Math.max(0, parseInt(argOf('--delay', '1200'), 10) || 0);

/* ===== 端末(3種) =====
   slug はファイル名に使うので英数字だけ。name は報告に出す日本語。 */
const DEVICES = [
  { name:'iPhone SE 縦持ち',   slug:'se-portrait',      w:375, h:667 },
  { name:'iPhone 12 横持ち',   slug:'ip12-landscape',   w:844, h:390 },
  { name:'横持ち・縦-55px',    slug:'landscape-short',  w:667, h:320 },
];

/* ===== 場面(8つ) =====
   pages … 撮るページ。[0,1] の場面はファイル名に -p1 / -p2 が付く。 */
const VARIANTS = [
  { key:'win',      pages:[0,1], desc:'勝利・報酬・EXP・バッジあり' },
  { key:'lose',     pages:[0],   desc:'敗北・死因あり・ハイライトなし' },
  { key:'top3',     pages:[0],   desc:'#3・ハイライトあり' },
  { key:'register', pages:[0],   desc:'マスモン登録の対話が出ている状態' },
  { key:'team',     pages:[0,1], desc:'チーム戦・小隊3人・勝利' },
  { key:'raid',     pages:[0],   desc:'レイドのリザルト' },
  { key:'full',     pages:[0,1], desc:'出るものを全部出した最大状態' },
  { key:'lose-p2',  pages:[1],   desc:'敗北の2ページ目' },
];

let chromium = null;
try { ({ chromium } = await import('playwright')); }
catch {
  for(const b of ['/opt/node22/lib/node_modules/', '/usr/lib/node_modules/', '/usr/local/lib/node_modules/']){
    try { ({ chromium } = createRequire(b)('playwright')); break; } catch {}
  }
}
if(!chromium){ console.error('playwrightが見つかりません(npm i -g playwright)。'); process.exit(1); }

const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
               '.webp':'image/webp', '.mp3':'audio/mpeg', '.mp4':'video/mp4', '.webm':'video/webm' };
const server = http.createServer((req, res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if(rel === 'sw.js'){ res.writeHead(404); res.end('no sw in shot'); return; }
  const file = path.resolve(ROOT, rel);
  if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r=> server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});

/* =====================================================================
   ページ側: 試合の状態を作って**本物のリザルト表示関数**を呼ぶ

   ここで用意するのは「試合の結果」だけ。画面の中身は showResultNow / raidShowResult が
   いつもどおり組み立てる(刷新後は新しい演出もそのまま走る)。
===================================================================== */
function buildResultShot(o){
  const V = o.variant;
  const base = V.replace(/-p2$/, '');          // lose-p2 は lose と同じ試合の2ページ目
  const LONG = o.longName;
  const ELEM = 'phoenix';
  const notes = [];
  try{
    /* 1. 他の画面をすべてしまう(リザルトだけを撮る) */
    for(const id of ['titleScreen','startScreen','lobbyScreen','roomListScreen','hud',
                     'hudCustomizeBar','matchFinishOverlay','spectateBar','raidHud']){
      const el = document.getElementById(id); if(el) el.classList.add('hidden');
    }
    document.querySelectorAll('.mastermon-confirm-overlay:not(.hidden), #gachaOverlay:not(.hidden), '
      + '#textInputOverlay:not(.hidden), #shareOverlay:not(.hidden), #ssrPromoteOverlay:not(.hidden)')
      .forEach(el=> el.classList.add('hidden'));

    /* 2. 試合の状態。**エンティティは createMonster で作る**(手書きの雛形にしない) */
    if(typeof teamResetState === 'function') teamResetState();
    game.over = false; game.started = false;
    game.raid = (base === 'raid');
    game.arena = false; game.trainingRange = false; game.tutorialMatch = false;
    game.selectedElement = ELEM;
    netState.mode = 'single'; netState.roomId = null; netState.raid = game.raid;
    entities = []; projectiles = []; areaEffects = []; particles = []; lootItems = [];
    zoneState = null; lavaZones = [];
    matchTime = 754;                                   // 生存時間 12:34
    const spawn = { x: WORLD.w/2, y: WORLD.h/2 };
    const mk = (el, name, isPlayer)=> createMonster(el, !!isPlayer, name, { spawnPoint: spawn });

    const longName = (base === 'full');
    /* 小隊の行は名前のうしろへ「(あなた)」を付けるので、名前そのものは別の言葉にする */
    player = mk(ELEM, longName ? LONG : 'プレイヤー', true);
    entities.push(player);
    const mates = [ mk('dullahan', longName ? LONG : 'くろねこ', false),
                    mk('suezo',    'ゆうしゃ', false) ];
    entities.push(...mates);
    for(const nm of ['まもの','せんし','まほうつかい','りゅうき']) entities.push(mk('rock', nm, false));

    /* 通信の口だけ差し替える。**文言は書かない** ―― こうすると2枚目の送信状態の行は
       本物の submitScoreToRanking が書く(ここで文を書くと、直したときに古い文が残る)。 */
    window.__aramonSubmitScore = async ()=> true;

    player.kills = 12;
    player.damageDealt = 18420;
    player.hp = Math.round(player.maxHp * 0.18);
    player.mastermonKillExpBonus = 40;
    /* 戦績の「連続撃破」は combat.js が killEntity のたびに積む記録から出る。
       ここは試合を回さずに結果だけ作るので、**同じ入れ物へ倒した時刻を入れておく**
       (入れないと、撃破数12なのに連続撃破0という実機では起きない絵が撮れる)。
       下の並びは「10秒(KILL_STREAK_WINDOW_SEC)の幅に3つ入る山が最大」= 連続撃破3。 */
    if(typeof playerKillTimes !== 'undefined'){
      playerKillTimes.length = 0;
      for(const s of [40, 96, 100, 104, 240, 300, 480, 700]) playerKillTimes.push(s);
    }

    /* 3. マスモン。登録の対話を出す場面だけ「まだ登録が無い」状態にする */
    if(base === 'register'){
      saveMastermons({});
      game.selectedMastermonKey = null;
    } else {
      const data = loadMastermons();
      if(!data[ELEM]) data[ELEM] = createMastermon(ELEM, longName ? LONG : 'ほのお');
      data[ELEM].level = 12; data[ELEM].exp = 0;
      saveMastermons(data);
      game.selectedMastermonKey = ELEM;
    }

    /* 4. 場面ごとの結果。**判定に必要な値だけ**を入れて、あとは本物の関数に任せる */
    let isWin = true, placement = 1;
    if(base === 'lose'){
      /* 死因あり・ハイライトなし。ハイライトは「自己ベスト更新」で出るので、
         **先に本物の recordMatchResult で高い自己ベストを入れて**出ない状態を作る。 */
      recordMatchResult(ELEM, 99, 999999, false, 'solo');
      isWin = false; placement = 7;
      player.kills = 2; player.damageDealt = 3120;
      // 倒されて終わった試合はHPが残らない(戦績の「残りHP」は 0% になるのが実機の姿)
      player.hp = 0;
      /* 倒した時刻も2キルぶんに入れ替える。上の既定(12キル)のままだと連続撃破が3になり、
         **この場面の狙い(ハイライトが出ていない姿)が壊れる。** */
      if(typeof playerKillTimes !== 'undefined'){ playerKillTimes.length = 0; playerKillTimes.push(600, 740); }
      player.alive = false; player.deathAt = 754;
      player.lastAttackerId = mates[0].id;             // 「⚔ 〇〇 に倒された」の1行が出る条件
      player.lastAttackerAt = 752;
    } else if(base === 'top3'){
      isWin = false; placement = 3;
      player.alive = false; player.deathAt = 754;      // 攻撃者は入れない(死因の行は出ない)
    } else if(base === 'team' || base === 'full'){
      /* チーム戦。小隊は assignTeams(本物)が entities の並びから作る = 先頭3体が自分の小隊 */
      assignTeams(3);
      mates[1].alive = false;
      if(base === 'full'){
        isWin = false; placement = 2;                  // 死因の行も出す(縦が一番伸びる姿)
        player.alive = false; player.deathAt = 754;
        player.lastAttackerId = mates[0].id; player.lastAttackerAt = 752;
      }
    }

    /* 5. 表示。**ここから先は本物の画面** */
    if(base === 'raid'){
      raidShowResult(true, 128450, 96000);             // 討伐成功・自己ベスト更新
    } else {
      showResultNow(isWin, placement);
    }

    /* 6. full だけ「出るものを全部」に寄せる。
          バッジは本物の renderResultBadges に渡す値で6枚出す(畳まれない上限)。
          登録の対話は本来EXPの行と同時には出ないが、**縦が一番伸びる姿**を見たいので両方出す。 */
    if(base === 'full'){
      renderResultBadges({
        kills: player.kills, damage: Math.round(player.damageDealt),
        prevBestKills: 3, prevBestDamage: 1200,
        prevElemBestKills: 0, prevElemBestDamage: 0,
        rank: { delta: 18, promoted: true, after: { icon:'🥈', name:'シルバーⅡ' } },
        newTitles: [{ id:'tk100', emoji:'🌀', name:'百人斬り' }],
        elemNewTitles: [], seasonSp: 12,
        elementLabel: (ELEMENTS[ELEM] ? ELEMENTS[ELEM].label : ELEM),
      });
      const reg = document.getElementById('mastermonRegisterPrompt');
      if(reg){ reg.dataset.element = ELEM; reg.classList.remove('hidden'); }
      notes.push('登録の対話とEXPの行を同時に出している(最大状態を見るため)');
      if(typeof fitResultScreen === 'function') fitResultScreen();
    }
    return { ok:true, notes };
  }catch(err){
    return { ok:false, notes, error: String(err && err.stack || err) };
  }
}

/* #resultInner に transform:scale が掛かっているか = fitResultScreen() が発火したか。
   **刷新後はこれが全部「なし」になるのが目標**(縮小は設計の負け)。 */
function readFitScale(){
  const inner = document.getElementById('resultInner');
  if(!inner) return null;
  const tr = getComputedStyle(inner).transform;
  if(!tr || tr === 'none') return null;
  const m = tr.match(/matrix\(([^)]+)\)/);
  if(!m) return null;
  const a = parseFloat(m[1].split(',')[0]);
  return (isFinite(a) && Math.abs(a - 1) > 0.001) ? Math.round(a*1000)/1000 : null;
}

/* 横倒しの絵を「実機で見える向き」へ戻す。
   #appRoot は rotate(90deg) で描かれているので、逆向きに90度回して上書きする。
   画像処理の外部ライブラリを増やしたくないので、chromiumに1枚描かせて撮り直す
   (deviceScaleFactor も元と同じなので画素数は変わらない)。 */
async function unrotateShot(file, w, h, dsf){
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  const p = await browser.newPage({ viewport:{ width:h, height:w }, deviceScaleFactor:dsf });
  await p.setContent(`<style>html,body{margin:0;padding:0;background:#000;overflow:hidden}`
    + `img{position:absolute;top:0;left:0;width:${w}px;height:${h}px;`
    + `transform-origin:0 0;transform:translateY(${w}px) rotate(-90deg)}</style>`
    + `<img src="${dataUrl}">`);
  await p.waitForTimeout(120);
  await p.screenshot({ path: file });
  await p.close();
}

/* ===== 撮影 ===== */
fs.mkdirSync(OUT_DIR, { recursive: true });
const targets = ONLY ? VARIANTS.filter(v=> v.key === ONLY) : VARIANTS;
if(!targets.length){
  console.error(`--only ${ONLY} は場面の一覧にありません(${VARIANTS.map(v=>v.key).join(' / ')})`);
  process.exit(1);
}
const shots = [];    // { file, variant, page, device, scale }
const problems = [];
const noteSet = new Map();   // 場面 → 断り書き(端末3種で同じ物が3回出るのでまとめる)

for(const dev of DEVICES){
  for(const v of targets){
    /* 場面ごとにページを作り直す。**前の場面の記録(自己ベスト・段位・シーズン)を持ち越さない**
       ―― 持ち越すとバッジの出方が場面の順番で変わり、同じ絵が撮れなくなる。 */
    const page = await browser.newPage({
      viewport:{ width:dev.w, height:dev.h }, screen:{ width:dev.w, height:dev.h },
      deviceScaleFactor:2, isMobile:true, hasTouch:true,
    });
    const jsErrors = [];
    page.on('pageerror', e=> jsErrors.push(String(e)));
    await page.addInitScript(()=>{
      // チュートリアルの案内カードが出ると全画面を覆うので済み扱いにする
      try{ localStorage.setItem('aramon_tutorial_v1', JSON.stringify({ state:'done' })); }catch(e){}
    });
    await page.goto(`${ORIGIN}/index.html`, { waitUntil:'load' });
    await page.waitForFunction(()=> typeof showResultNow==='function' && typeof createMonster==='function',
                               null, { timeout:30000 });
    await page.waitForFunction(()=>{ const t=document.getElementById('titleTapStart'); return t && !t.classList.contains('hidden'); },
                               null, { timeout:30000 });
    await page.evaluate(()=> document.getElementById('titleScreen').click());
    await page.waitForTimeout(600);

    const built = await page.evaluate(buildResultShot, { variant: v.key, longName:'とてもながいなまえのプレイヤー' });
    if(!built.ok) problems.push(`[組み立てで失敗] ${v.key} / ${dev.name} — ${built.error.split('\n')[0]}`);
    for(const n of (built.notes || [])) noteSet.set(`${v.key}: ${n}`, true);

    // 演出が終わってから撮る(刷新後はここに新しい時間が入る)
    await page.waitForTimeout(DELAY);
    // 縦持ちの端末か(#appRootが90度回っているか)。回っているなら保存時に戻す
    const rotated = await page.evaluate(()=> document.documentElement.classList.contains('force-landscape'));

    for(const pg of v.pages){
      await page.evaluate((i)=>{
        if(typeof resultGoPage === 'function') resultGoPage(i, { instant:true });
        if(typeof fitResultScreen === 'function') fitResultScreen();
      }, pg);
      await page.waitForTimeout(260);
      const scale = await page.evaluate(readFitScale);
      const suffix = (v.pages.length > 1) ? `-p${pg+1}` : '';
      const file = path.join(OUT_DIR, `${v.key}${suffix}__${dev.slug}.png`);
      await page.screenshot({ path: file });
      if(rotated) await unrotateShot(file, dev.w, dev.h, 2);
      shots.push({ file, variant: v.key + suffix, device: dev.name, desc: v.desc, scale });
    }
    if(jsErrors.length) problems.push(`[JSエラー] ${v.key} / ${dev.name} — ${jsErrors[0].slice(0,160)}`);
    await page.close();
  }
}

await browser.close();
server.close();

/* ===== 報告 ===== */
console.log(`撮影: ${shots.length}枚(場面${targets.length} × 端末${DEVICES.length}・待ち${DELAY}ms)`);
console.log(`出力先: ${OUT_DIR}`);
for(const s of shots) console.log(`  ${s.file}  … ${s.desc}(${s.device})`);
const shrunk = shots.filter(s=> s.scale != null);
console.log('\n-- 縮小(fitResultScreen の transform:scale)--');
if(!shrunk.length){
  console.log('  なし(どの場面も縮まずに収まっている)');
} else {
  for(const s of shrunk) console.log(`  ${s.variant} / ${s.device}: ×${s.scale}`);
  console.log(`  … ${shrunk.length}/${shots.length}枚で縮小が発火(刷新後はここが0になるのが目標)`);
}
if(noteSet.size){
  console.log('\n-- 撮るために手を入れた所(絵を見る人への断り)--');
  for(const n of noteSet.keys()) console.log('  ' + n);
}
if(problems.length){
  console.log('\n== 気づいたこと ==');
  for(const p of problems) console.log('  ' + p);
}
