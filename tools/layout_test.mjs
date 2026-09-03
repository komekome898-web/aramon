/* 画面レイアウトの契約を機械で守るテスト(開発用。ゲームには読み込まない)。

   画面はボタンを足すたびに壊れてきた。2026-08-15にはロビーの出撃ボタンが20pxまで潰れて
   文字が消え、2026-08-26には横向きで起動したロビーの左メニューが右へあふれ、
   マスモンのトレーニング画面では「丈夫さ」が実行ボタンの下敷きになっていた。
   **数字の詰め直しではなく構造で止める**と決めたので、その構造が守られていることを
   ここで毎回確かめる。対象はロビーだけでなく、下の PANELS に並べた全画面。

   使い方: node tools/layout_test.mjs

   【画面の3原則】(CLAUDE.md「全画面に効く決まり」と同じもの。ここが実行版)
     R1 箱は画面から決める … 外枠の大きさは使える場所から決める。中身の合計で決めない。
     R2 スクロールするのは「読む物」だけ … 一覧・本文は送ってよい。**操作(ボタン)と
        見出しはスクロールの外**に置く。sticky で中身の上へ貼らない
        (貼ると、入りきらない行が黙ってボタンの下に隠れる)。
     R3 足りないときに削る順番を決めておく … 操作 > 情報 > 飾り。
        決めていない画面は作らない(決めていないと、足りなくなった瞬間に
        「潰れる/切れる/はみ出す」のどれかが必ず起きる)。

   確かめること(発注者が出した3条件と1対1):
     1. 見切れない  … 画面の要素が1つも #appRoot の外へ出ない
     2. 押しやすい  … 操作できる物はすべて --tap-* の下限以上の実寸で描かれる
     2b.文字が見えている … 画面の中の文字が1つも「縦に切れる/横に切れる」になっていない
                       (ボタン単位ではなく文字を持つ要素すべてを見る)。
                       **字の大きさそのものは検査しない** ―― 小さいのは多くの場合
                       レイアウトを守るための設計判断で、不具合ではない。
     2c.はみ出さない … ボタンの中身がボタンの箱の中に収まっている。タイルは
                       overflow:hidden を外してある(角の通知ドットが切れるため)ので、
                       隠さない代わりにここで確かめる
     3. 重ならない  … 同じ列の中で操作できる物どうしが重ならない
     4. 端末と持ち方… 縦持ち(強制横向き)4・実横持ち2・タブレット1・縦を削られた状態3 の計10通り
     5. **これから起きうることを実際に起こす** … ボタンを9個足した状態と、
        画面の文字をすべて長くした状態でも 1〜3 が成り立つ。
        箱の大きさが中身で決まっていたらここで必ず壊れるので、
        「箱が先・中身は箱から」の作りになっていることの証明になる。
        ロビーはスクロールさせないので、**どの枠もスクロールが出ていないこと**も見る。
     6. 画面ごとの方針 … 下の PANELS に並べた画面を1つずつ開いて 1〜3 と R2 を見る。 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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
  if(rel === 'sw.js'){ res.writeHead(404); res.end('no sw in test'); return; }
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

/* 端末と持ち方。screen も同じ値にしないと updateForceLandscapeMode() の
   「小さい画面か」の判定が偽になり、強制横向き(#appRootの90度回転)が効かないまま測ってしまう。 */
const DEVICES = [
  { name:'iPhone SE 縦持ち',   w:375,  h:667 },
  { name:'iPhone 12 縦持ち',   w:390,  h:844 },
  { name:'iPhone 11 縦持ち',   w:414,  h:896 },
  { name:'iPhone 15PM 縦持ち', w:430,  h:932 },
  { name:'iPhone SE 横持ち',   w:667,  h:375 },
  { name:'iPhone 12 横持ち',   w:844,  h:390 },
  { name:'iPad 縦持ち',        w:768,  h:1024 },
  /* 【縦を削られた状態】iOSはPWAを横向きで起動した直後、まだ縦持ちのセーフエリアを
     返すことがあり、そのぶん20〜50px低い画面でレイアウトが確定する。
     ここが**あと数px足りない**だけで左メニューが横へ広がり、中央が潰れていた
     (2026-08-26 実機報告)。境界の前後をまたぐ3つを常時見る。 */
  { name:'横持ち・縦-20px',    w:667,  h:355, short:true },
  { name:'横持ち・縦-35px',    w:667,  h:340, short:true },
  { name:'横持ち・縦-55px',    w:667,  h:320, short:true },
];
// プレイモードで右列の中身が変わる(部屋のボタンの有無)ので全部見る
const MODES = [
  { name:'シングル30人', mode:'single', sub:'br30' },
  { name:'マルチPvP',    mode:'single', sub:'pvp4' },
  { name:'チーム戦20',   mode:'team',   sub:'br20' },
  { name:'アリーナ',     mode:'team',   sub:'arena' },
  { name:'レイド',       mode:'raid',   sub:null },
];

/* #startScreen 以外の3画面。中身の出方で壊れ方が変わるので、それぞれ「起きうる姿」を並べる。
   scrollIds = スクロールが出ていないか見る枠(パネル本体と、その中身の箱)。 */
const SCREENS = [
  { id:'lobbyScreen',    name:'待機部屋', variants:['host','guest','few'], scrollIds:['lobbyScreen','lobbyInner'] },
  { id:'roomListScreen', name:'部屋一覧', variants:['few','many','empty'], scrollIds:['roomListScreen','roomListInner'] },
  /* 【リザルトは2ページ×2列】-p2 付きは resultGoPage(1) で2枚目へ切り替えてから測る
     (1枚目・2枚目の両方を必ず見る。出ていない側のページは visibility:hidden なので
      検査の対象から自然に外れる)。

     **スクロールしてよいのは台帳の行(#rsLedgerRows)とバッジ棚(#resultBadges)だけ。**
     それ以外の枠に送れる余地が出たら失敗にする ―― ここが長らく `scrollIds:[]` で、
     リザルトのスクロールを1件も見ていなかった。以前は fitResultScreen() が
     入り切らない中身を transform:scale で丸ごと縮めており、transform は寸法を変えないので
     scrollHeight が縮む前のままになって誤検知したが、**2列化で縮小そのものが
     発火しなくなった**(33場面で0件)ので、素直に測れるようになった。 */
  { id:'resultScreen',   name:'リザルト', variants:['plain','full','plain-p2','full-p2','raid','register','team','lose'],
    scrollIds:['resultInner','rsHero','rsPerf','rsLedger','rsProgress','resultActions'] },
];

/* ===== 画面ごとの方針(この表が正) =====
   **画面を1つ足したら、ここへ1行足す。** 足さなければ検査されない = 次に壊れる画面になる。

   id      … 画面/オーバーレイの DOM id
   name    … 落ちたときに出す名前
   open    … 開き方。順に実行する
                { btn:'…' }        そのidのボタンを押す(実際の導線をそのまま辿る)
                { call:['fn',…引数] } その名前の関数を呼ぶ(ボタンが無い画面用)
                { sel:'…', idx:n } そのセレクタのn番目を押す(タブの切り替え)
   noScroll… **スクロールしてはいけない枠**のid。ここに挙げた枠に送れる余地が出たら失敗。
             枠の中の一覧・本文はスクロールしてよい(挙げない)。R2そのもの。 */
const PANELS = [
  { id:'shopOverlay',       name:'ショップ',       open:[{btn:'openShopBtn'}], noScroll:['shopOverlay'] },
  { id:'shopOverlay',       name:'ショップ(交換)', open:[{btn:'openShopBtn'},{sel:'.shop-tab',idx:2}], noScroll:['shopOverlay'] },
  { id:'bagOverlay',        name:'バッグ',         open:[{btn:'openBagBtn'}], noScroll:['bagOverlay'] },
  { id:'bagOverlay',        name:'バッグ(称号)',   open:[{btn:'openBagBtn'},{sel:'.bag-tab',idx:1}], noScroll:['bagOverlay'] },
  { id:'galleryOverlay',    name:'ギャラリー',     open:[{btn:'openGalleryBtn'}], noScroll:['galleryOverlay'] },
  { id:'missionOverlay',    name:'ミッション',     open:[{btn:'openMissionBtn'}], noScroll:['missionOverlay'] },
  { id:'missionOverlay',    name:'ミッション(シーズン)', open:[{btn:'openMissionBtn'},{sel:'.mission-tab',idx:1}], noScroll:['missionOverlay'] },
  { id:'missionOverlay',    name:'ミッション(累計)', open:[{btn:'openMissionBtn'},{sel:'.mission-tab',idx:2}], noScroll:['missionOverlay'] },
  { id:'expeditionOverlay', name:'遠征',           open:[{btn:'openExpeditionBtn'}], noScroll:['expeditionOverlay'] },
  { id:'changelogOverlay',  name:'更新履歴',       open:[{btn:'changelogBtn'}], noScroll:['changelogOverlay'] },
  { id:'helpOverlay',       name:'ヘルプ',         open:[{btn:'headerHelpBtn'}], noScroll:['helpOverlay'] },
  { id:'settingsOverlay',   name:'設定',           open:[{btn:'headerSettingsBtn'}], noScroll:['settingsOverlay'] },
  { id:'audioSettingsOverlay', name:'音量設定',    open:[{btn:'headerSettingsBtn'},{btn:'audioSettingsBtn'}], noScroll:['audioSettingsOverlay'] },
  { id:'lookSettingsOverlay',  name:'視点設定',    open:[{btn:'headerSettingsBtn'},{btn:'lookSettingsBtn'}], noScroll:['lookSettingsOverlay'] },
  { id:'howToPlayScreen',   name:'遊び方ガイド',   open:[{btn:'headerSettingsBtn'},{btn:'howToPlayBtn'}], noScroll:[] },
  { id:'rankingScreen',     name:'ランキング',     open:[{call:['openRankingScreen']}], noScroll:[] },
  { id:'myStatsScreen',     name:'マイ記録',       open:[{call:['openMyStatsScreen']}], noScroll:[] },
  /* チーム戦タブは項目が違う(K/Dの代わりに平均キル・勝率の見出しが長い)ので別に見る */
  { id:'myStatsScreen',     name:'マイ記録(チーム戦)', open:[{call:['openMyStatsScreen']},{sel:'.mystat-mode-tab',idx:2}], noScroll:[] },
  { id:'monsterListScreen', name:'モンスター一覧', open:[{call:['openMonsterListScreen']}], noScroll:[] },
  /* るすばん報告: 一覧(#ghostNewsList)だけがスクロールする作りなので、overlay本体は送れてはいけない */
  { id:'ghostNewsOverlay',  name:'るすばん報告',   open:[{call:['openGhostNewsOverlay']}], noScroll:['ghostNewsOverlay'] },
  /* レイド入口。「部屋を作る」の2行化(注釈付き)で .raid-actions が見切れないかを見る。
     開き方は __raidTestOpen(上で定義)。中身の一覧(#raidScroll)だけがスクロールしてよい。 */
  { id:'raidOverlay',       name:'レイド入口',     open:[{call:['__raidTestOpen']}], noScroll:['raidOverlay'] },
  /* マスモン詳細の4タブ。**丈夫さが実行ボタンの下敷きになっていた画面**(2026-08-26)。
     タブごとに中身の作りが違うので4つとも見る。 */
  { id:'mastermonScreen', name:'マスモン詳細(詳細情報)', open:[{call:['openMastermonScreen']},{call:['openMastermonDetail','suezo']},{call:['mmOpenTab','info']}], noScroll:['mastermonDetailPanel'] },
  { id:'mastermonScreen', name:'マスモン詳細(トレーニング)', open:[{call:['openMastermonScreen']},{call:['openMastermonDetail','suezo']},{call:['mmOpenTab','training']}], noScroll:['mastermonDetailPanel'] },
  { id:'mastermonScreen', name:'マスモン詳細(編集)', open:[{call:['openMastermonScreen']},{call:['openMastermonDetail','suezo']},{call:['mmOpenTab','edit']}], noScroll:['mastermonDetailPanel'] },
  { id:'mastermonScreen', name:'マスモン詳細(着せ替え)', open:[{call:['openMastermonScreen']},{call:['openMastermonDetail','suezo']},{call:['mmOpenTab','dressup']}], noScroll:['mastermonDetailPanel'] },
  { id:'mastermonScreen', name:'マスモン詳細(あゆみ)', open:[{call:['openMastermonScreen']},{call:['openMastermonDetail','suezo']},{call:['mmOpenTab','ayumi']}], noScroll:['mastermonDetailPanel'] },
];

/* ===== 例外リスト(意図的に許しているもの) =====
   検査を厳しくすると、これまで素通りしていた既存の作りが落ちる。**黙って基準を下げない**で、
   ここへ「何を・どの画面で・なぜ許すのか」を書いて残す。直したらこの行を消す。
   kind/label/id はすべて満たしたときだけ許可(広く効きすぎないように3つで絞る)。
   ※ ここに載っているのは「直さなくてよい」ではなく「**別の担当のファイルなので今は直せない**」。
      実行のたびに一覧で出るので、放っておいても見えなくならない。 */
const KNOWN = [
  /* いまは空。**空であることに意味がある** ―― ここが空なら「見えている画面はすべて基準を満たす」。
     直せない物が出たら、消すのではなく理由付きで足すこと(実行のたびに一覧へ出る)。

     ※ 2026-08-26、ここに「ロビー以外の画面の文字サイズ」を載せていたが、
        **検査の側が間違っていた**ので、例外ではなく検査そのものを外した。
        文字の小ささは不具合ではない(レイアウトを守るための設計判断)。 */
];

const failures = [];
const knownHits = [];
const notes = [];
/* 同じ物が端末×モードのぶんだけ並ぶと、40件の頭打ちで**別の不具合が見えなくなる**。
   「どの要素が・何件で落ちたか」を1行にまとめた索引も出す(直す順番を決めるのに使う)。 */
const findingIndex = new Map();
const STRESS_N = 3;   // 素の状態 / ボタン+9個 / 文字を長く

/* detail を書くと、指摘の本文(「〇〇が2px外」など)にも当てて絞り込める。
   書かなければ従来どおり kind/label/id の3つで判定する。 */
const knownFor = (kind, label, id, detail)=>
  KNOWN.find(k=> k.kind===kind && k.label.test(label) && k.id.test(id)
                 && (!k.detail || k.detail.test(String(detail||''))));
/* 見つかったものを「本当の失敗」と「例外として許したもの」へ振り分ける。
   3画面ぶん同じ書き方を繰り返さないよう、判定はここ1か所にまとめる。 */
function pushFindings(label, r){
  const emit = (kind, items, key, fmt)=>{
    if(!items || !items.length) return;
    const hot = [];
    for(const x of items){
      const k = knownFor(kind, label, String(key(x)), fmt(x));
      if(k){ knownHits.push(`[${kind}] ${label} — ${fmt(x)}  ※許可: ${k.why}`); continue; }
      hot.push(x);
      const ik = `[${kind}] ${fmt(x)}`;
      findingIndex.set(ik, (findingIndex.get(ik) || 0) + 1);
    }
    if(hot.length) failures.push(`[${kind}] ${label} — ${hot.slice(0,4).map(fmt).join(' / ')}`);
  };
  emit('見切れ', r.outside, x=>x.id, x=>`${x.id}が${x.over}px外`);
  emit('押せる大きさが足りない', r.tooSmall, x=>x.id, x=>`${x.id} ${x.got}px < ${x.floor}px`);
  emit('中身がはみ出す', r.spill, x=>x.id, x=>`${x.id} が${x.out}px外`);
  emit('文字が切れる', r.clipped, x=>x.id, x=>`${x.id}(${x.why})`);
  emit('重なり', r.overlap, x=>`${x.a}×${x.b}`, x=>`${x.a}×${x.b} ${x.px}px`);
  emit('スクロール発生', r.scrolls, x=>x.id, x=>`${x.id}が+${x.d}px`);
  emit('操作がスクロールの中で貼り付いている', r.sticky, x=>x.id, x=>`${x.id}(${x.box}の中)`);
  emit('素のままのボタン', r.rawBtn, x=>x.id, x=>`${x.id}(見た目が当たっていない)`);
  if(r.primary && r.primary.length !== 1){
    failures.push(`[主役の操作が${r.primary.length}個] ${label} — ${r.primary.length? r.primary.join(' / ') : '塗りのボタンが1つも無い'}`);
    const ik = `[主役の操作が${r.primary.length}個] 塗りのボタンがちょうど1つでない`;
    findingIndex.set(ik, (findingIndex.get(ik) || 0) + 1);
  }
  if(r.spread){
    failures.push(`[左メニューが横へ広がった] ${label} — ${r.spread.cols}列(縦${r.spread.leftH}pxあり、2列に要るのは${r.spread.need}px)`);
    const ik = '[左メニューが横へ広がった] 縦は足りているのに列が増えた';
    findingIndex.set(ik, (findingIndex.get(ik) || 0) + 1);
  }
  if(r.order && r.order.length){
    failures.push(`[並び順] ${label} — ${r.order.slice(0,3).map(x=>`${x.id} は${x.want}のはずが${x.got}`).join(' / ')}`);
  }
}

for(const dev of DEVICES){
  const page = await browser.newPage({
    viewport:{ width:dev.w, height:dev.h }, screen:{ width:dev.w, height:dev.h },
    deviceScaleFactor:2, isMobile:true, hasTouch:true,
  });
  const jsErrors = [];
  page.on('pageerror', e=> jsErrors.push(String(e)));
  /* マスモン詳細を測るには育成済みの子が1体要る。チュートリアルは済み扱いにして
     案内カードを出さない(出ると全画面を覆って測定にならない)。 */
  await page.addInitScript(()=>{
    try{
      localStorage.setItem('aramon_tutorial_v1', JSON.stringify({ state:'done' }));
      localStorage.setItem('aramon_mastermons_v1', JSON.stringify({
        suezo:{ element:'suezo', name:'テスト', level:23, exp:0, tickets:3,
                stats:{ life:90, power:110, wisdom:150, accuracy:130, evasion:90, vitality:90 } },
      }));
    }catch(e){}
  });
  await page.goto(`${ORIGIN}/index.html`, { waitUntil:'load' });
  await page.waitForFunction(()=> typeof setLobbyMode==='function' && typeof refreshLobby==='function', null, { timeout:30000 });
  await page.waitForFunction(()=>{ const t=document.getElementById('titleTapStart'); return t && !t.classList.contains('hidden'); }, null, { timeout:30000 });
  await page.evaluate(()=> document.getElementById('titleScreen').click());
  await page.waitForTimeout(700);

  // ロビーの検査関数をページ側へ入れる(回転しているので座標の扱いに注意)
  await page.evaluate(()=>{
    document.querySelectorAll('.mastermon-confirm-overlay:not(.hidden)').forEach(o=>o.classList.add('hidden'));
    document.getElementById('titleScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');

    /* 押せる物の下限。CSSの --tap-* と**同じ値をここに書かない**で、実際の変数を読む
       (片方だけ変えて食い違うのを防ぐ)。 */
    window.__tap = (name)=> parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-'+name)) || 0;
    window.__floorFor = (el)=>{
      if(el.id==='joinBtn' || el.id==='createRoomBtn' || el.id==='findRoomBtn') return window.__tap('main');
      if(el.classList.contains('lobby-side-btn') || el.classList.contains('lobby-pick-btn')) return window.__tap('pick');
      if(el.classList.contains('lobby-emote-btn')) return 34;
      /* 待機部屋・部屋一覧・リザルトの押せる物。個別の決まりが無いので、
         「押せる物には最小の高さ」の一般則の下限(--tap-pick)をそのまま当てる。
         ここが空いていたせいで「解散」「部屋を抜ける」が28pxで並んでいた。 */
      if(el.closest('#lobbyScreen, #roomListScreen, #resultScreen')) return window.__tap('pick');
      return 0;   // バナー等の「押せるが大きさの決まりが無い」物は対象外
    };
    /* 【文字の大きさは検査しない】(2026-08-26 発注者判断)
       一時期ここに下限(10px)を置いていたが、**それは検査の越権だった。**
       この検査が守るのはレイアウト ―― 隠れる・切れる・重なる・はみ出す・送れてしまう。
       文字が小さいのは、**そのレイアウトを守るために意図してそうしている**ことが多く、
       小ささを不具合として挙げると「直す」=字を大きくする=行が伸びる=画面が崩れる、
       という**この検査が防ぎたかったことを起こさせる**方向へ働く。
       読みやすさは実機を見た人が決めること。機械は「読めるか」ではなく
       「**その字が箱の中に収まって見えているか**」だけを見る(下の 縦に切れる/横に切れる)。 */
    window.__auditScreen = (screenId)=>{
      const root = document.getElementById('appRoot');
      const rb = root.getBoundingClientRect();
      const screenEl = document.getElementById(screenId);
      const vis = (el)=>{
        const s = getComputedStyle(el);
        if(s.display==='none' || s.visibility==='hidden' || s.opacity==='0') return false;
        const r = el.getBoundingClientRect();
        return r.width>0 && r.height>0;
      };
      const outside = [], tooSmall = [], overlap = [];
      /* 中がスクロールする箱(部屋一覧の行など)の中身は、いま画面の外にあっても指で送れば読める。
         「外へ出ている」「切れている」と数えるのは**箱そのもの**の役目にして、中身は数えない。
         その箱がスクロールしてよい場所なのかは、別に測るスクロール量(__scrollOf)で見る。
         ロビー(#startScreen)にはスクロールする箱が1つも無いので、この除外は効かない。 */
      const scrollBoxUp = (el, axis)=>{
        for(let p = el.parentElement; p && p !== screenEl.parentElement; p = p.parentElement){
          const s = getComputedStyle(p);
          if(axis==='y' && /(auto|scroll)/.test(s.overflowY) && p.scrollHeight - p.clientHeight > 2) return p;
          if(axis==='x' && /(auto|scroll)/.test(s.overflowX) && p.scrollWidth - p.clientWidth > 2) return p;
        }
        return null;
      };
      const inScrollBox = (el)=> !!(scrollBoxUp(el,'y') || scrollBoxUp(el,'x'));
      // 祖先に「切る箱」があるか(overflow が visible でない = そこから外へは描かれない)
      const clippedUp = (el)=>{
        for(let p = el.parentElement; p && p !== screenEl.parentElement; p = p.parentElement){
          const s = getComputedStyle(p);
          if(s.overflowY !== 'visible' || s.overflowX !== 'visible') return true;
        }
        return false;
      };
      /* 1. #appRoot の外へ出ていないか。#appRoot は90度回っているが、子も同じ変換を
            受けるので外接矩形どうしの比較でそのまま判定できる(90度なので軸は入れ替わるだけ)。 */
      for(const el of screenEl.querySelectorAll('*')){
        if(!vis(el)) continue;
        const s = getComputedStyle(el);
        if(s.position==='fixed') continue;
        if(inScrollBox(el)) continue;
        /* 枠に切られている物は、枠の外へは1pxも描かれない。**枠のほうを見ればよい**
           (枠自身もこのループで別に測っている)。ここを見ていなかったので、
           カードの上を横切る光(.ml-card-shine)のように「わざと枠より大きく作って
           overflow:hidden で切る」飾りが、毎回「190px外へ出ている」と報告されていた。 */
        if(clippedUp(el)) continue;
        const r = el.getBoundingClientRect();
        const over = Math.max(rb.left-r.left, r.right-rb.right, rb.top-r.top, r.bottom-rb.bottom);
        if(over > 1) outside.push({ id: el.id || el.className.toString().slice(0,40), over: Math.round(over) });
      }
      /* 2. 押せる物が下限より小さく描かれていないか(実寸で見る) */
      const controls = [...screenEl.querySelectorAll('button')].filter(vis);
      for(const el of controls){
        const floor = window.__floorFor(el);
        if(!floor) continue;
        const r = el.getBoundingClientRect();
        // 回転しているので「縦」は幅か高さのどちらか。小さい方が押しやすさを決める短辺
        const short = Math.min(r.width, r.height);
        if(short + 0.5 < floor) tooSmall.push({ id: el.id || el.className.toString().slice(0,40), got: Math.round(short*10)/10, floor });
      }
      /* 2d. **素のままのボタンが混じっていないか。**
            見た目をIDの列挙で当てている場所へボタンを足すと、その列挙から漏れて
            ブラウザ既定の灰色いボタンがそのまま出る(2026-08-28 リザルトの
            「詳細 ›」「‹ もどる」で実際に起きた)。目で気づくまで分からないので機械で見る。
            判定は**枠線の描き方**: 素のボタンだけが outset(スタイルを当てれば必ず変わる)。 */
      const rawBtn = [];
      for(const el of screenEl.querySelectorAll('button')){
        if(!vis(el)) continue;
        const bs = getComputedStyle(el);
        if(bs.borderTopStyle === 'outset' || bs.borderBottomStyle === 'outset'){
          rawBtn.push({ id: el.id || el.className.toString().trim().split(/\s+/)[0] || el.textContent.trim().slice(0,12) });
        }
      }
      /* 2b. **画面の中の文字が1つでも読めなくなっていないか。**
            ボタン単位の当て物ではなく、ロビーの中で「自分で文字を持っている要素」を
            すべて見る。読めなくなり方は次の3つしかない:
              ・縦に切れる  … 箱より中身が高い(overflow:hidden で上下が消える)
              ・横に切れる  … 「…」を出さない作りなのに幅が足りない
            実機で起きた不具合(ラベルが半分消える/吹き出しが潰れる)をそのまま言い表したもので、
            どこに何を足しても同じ基準で効く。
            **字の大きさそのものは見ない**(上の「文字の大きさは検査しない」を参照)。 */
      const clipped = [];
      const hasOwnText = (el)=> [...el.childNodes].some(n=> n.nodeType===3 && n.textContent.trim());
      /* 測るのは**文字そのもの**(Range で実際の文字の矩形を取る)。
         scrollWidth/scrollHeight は絶対配置の飾り(角のNEWバッジ等)や擬似要素まで
         数えてしまい、文字は無事なのに引っかかる/その逆も起きるので使わない。 */
      const textRectOf = (el)=>{
        let box = null;
        for(const n of el.childNodes){
          if(n.nodeType!==3 || !n.textContent.trim()) continue;
          const rg = document.createRange(); rg.selectNodeContents(n);
          const r = rg.getBoundingClientRect();
          if(!(r.width>0 && r.height>0)) continue;
          box = box ? { top:Math.min(box.top,r.top), left:Math.min(box.left,r.left),
                        bottom:Math.max(box.bottom,r.bottom), right:Math.max(box.right,r.right) } : r;
        }
        return box;
      };
      for(const el of screenEl.querySelectorAll('*')){
        if(!vis(el) || !hasOwnText(el)) continue;
        const s2 = getComputedStyle(el);
        const id = el.id || el.className.toString().trim().split(/\s+/)[0] || el.tagName;
        const t = textRectOf(el);
        if(!t) continue;
        // 文字を切る箱(overflow が visible でない祖先)まで遡って、その中に収まっているか見る
        let box = el;
        while(box && box!==screenEl){
          const bs = getComputedStyle(box);
          if(bs.overflowY!=='visible' || bs.overflowX!=='visible') break;
          box = box.parentElement;
        }
        if(!box || box===screenEl) continue;   // どこにも切る箱が無いなら切れようがない
        const bs = getComputedStyle(box);
        const br2 = box.getBoundingClientRect();
        const cut = {
          top:    br2.top    + parseFloat(bs.borderTopWidth)    - t.top,
          bottom: t.bottom - (br2.bottom - parseFloat(bs.borderBottomWidth)),
          left:   br2.left   + parseFloat(bs.borderLeftWidth)   - t.left,
          right:  t.right  - (br2.right  - parseFloat(bs.borderRightWidth)),
        };
        // 「…」を出す作りなら横のあふれは想定内(切れても読める形で終わる)
        const ellipsis = s2.textOverflow==='ellipsis' && s2.whiteSpace==='nowrap';
        /* 【強制横向きでは画面の縦横が入れ替わる】#appRoot が90度回っているので、
           画面座標の上下は**文字にとっての左右**になる。ここを取り違えると、
           「…」で切るつもりの横のあふれを「縦に切れている」と誤って報告する。 */
        const rot = document.documentElement.classList.contains('force-landscape');
        const dy = rot ? Math.max(cut.left, cut.right) : Math.max(cut.top, cut.bottom);
        const dx = rot ? Math.max(cut.top, cut.bottom) : Math.max(cut.left, cut.right);
        /* 箱がその向きにスクロールするなら「切れている」ではなく「送れば読める」。
           dy/dx は文字にとっての縦横で、overflowY/scrollHeight も同じ座標系(回転は見た目だけ)。 */
        const boxScrollY = /(auto|scroll)/.test(bs.overflowY) && box.scrollHeight - box.clientHeight > 2;
        const boxScrollX = /(auto|scroll)/.test(bs.overflowX) && box.scrollWidth - box.clientWidth > 2;
        if(!boxScrollY && dy > 1.5) clipped.push({ id, why:`縦に${dy.toFixed(1)}px切れる` });
        else if(!ellipsis && !boxScrollX && dx > 1.5) clipped.push({ id, why:`横に${dx.toFixed(1)}px切れる` });
      }
      /* 2c. ボタンの中身がボタンの箱に収まっているか。
            タイルは overflow:hidden を**わざと外している**(付けると角の通知ドットが
            切れるうえ、入っていないことが目に見えなくなる)。隠さない代わりに、
            はみ出していないことをここで確かめる。
            角の通知ドット・待機バッジは**わざと外へ出す飾り**なので数えない。 */
      const spill = [];
      const DECOR = ['notif-dot','lobby-wait-badge','raid-soon-pop','multi-xp-pop'];
      for(const el of controls){
        const br3 = el.getBoundingClientRect();
        for(const t of el.children){
          if(!vis(t)) continue;
          if(getComputedStyle(t).position==='absolute') continue;
          if(DECOR.some(c=> t.classList.contains(c))) continue;
          const tr = t.getBoundingClientRect();
          const out = Math.max(br3.top-tr.top, tr.bottom-br3.bottom, br3.left-tr.left, tr.right-br3.right);
          if(out > 1.5){
            spill.push({ id:(el.id||'?')+' > '+(t.className.toString().slice(0,22)||t.tagName), out:Math.round(out) });
            break;
          }
        }
      }
      /* 3. 同じ親の中で押せる物どうしが重なっていないか */
      const byParent = new Map();
      for(const el of controls){
        const p = el.parentElement;
        if(!byParent.has(p)) byParent.set(p, []);
        byParent.get(p).push(el);
      }
      for(const [p, list] of byParent){
        for(let i=0;i<list.length;i++) for(let j=i+1;j<list.length;j++){
          const a = list[i].getBoundingClientRect(), b = list[j].getBoundingClientRect();
          const ox = Math.min(a.right,b.right) - Math.max(a.left,b.left);
          const oy = Math.min(a.bottom,b.bottom) - Math.max(a.top,b.top);
          if(ox > 1 && oy > 1){
            overlap.push({ a:list[i].id||list[i].className.toString().slice(0,24),
                           b:list[j].id||list[j].className.toString().slice(0,24),
                           px: Math.round(Math.min(ox,oy)) });
          }
        }
      }
      /* 4. 【親が違っても重なる物は見る】上の3は「同じ親の中」しか比べていないので、
         枠の外に置いてある物との重なりを素通ししていた。
         2026-08-23、あとから出た更新タイルがSSRバナー(グリッドの兄弟)の下へ27.2px潜り、
         押せるのに見えない状態になったのを、この検査が無いせいで取り逃がしている。
         メニューのタイルは「枠から出たら必ず何かに潜る」ので、枠の外の相手とも比べる。 */
      const gridTiles = [...document.querySelectorAll('#lobbyMenuGrid > *')]
        .filter(el=> getComputedStyle(el).display !== 'none');
      for(const outsider of ['lobbyBanner', 'lobbyRankPanel', 'lobbyActionArea']){
        const o = document.getElementById(outsider);
        if(!o || getComputedStyle(o).display === 'none') continue;
        const ob = o.getBoundingClientRect();
        if(!(ob.width > 0 && ob.height > 0)) continue;
        for(const t of gridTiles){
          const a = t.getBoundingClientRect();
          const ox = Math.min(a.right, ob.right) - Math.max(a.left, ob.left);
          const oy = Math.min(a.bottom, ob.bottom) - Math.max(a.top, ob.top);
          if(ox > 1 && oy > 1){
            overlap.push({ a: t.id || t.className.toString().slice(0,24),
                           b: outsider, px: Math.round(Math.min(ox, oy)) });
          }
        }
      }
      return { outside, tooSmall, clipped, spill, overlap, rawBtn };
    };
    /* スクロール量を測る。ロビーは「スクロールさせない」決まりなので、どの枠にも出てはいけない。
       待機部屋・部屋一覧のパネルは overflow-y:auto だが、**画面ぶんスクロールするのは作りの失敗**
       (第3弾で待機画面が2.14画面ぶん出ていた)なので、同じ物差しで測って出す。 */
    /* 【主役の操作がちょうど1つあるか】
       リザルトでは「塗りつぶしたボタン」が**その画面で一番大事な操作**を表す約束にしてある。
       ところがこれは目で見るまで分からず、実際に2回とも見た目の指定の**強さ比べ**で壊れた:
         ・ボタン全体への指定が個別の指定より強く、金が一度も当たらず**0個**になった
         ・登録待ちの画面で金が**3つ**並び、答えるべき操作が一番弱かった
       どちらも「指定は書いてあるのに効いていない」ので、CSSを読んでも気付けない。
       **描かれた結果**(塗りがあるか)を数えて、0個でも2個以上でも落とす。
       塗りの判定は「背景に絵(グラデ)がある」か「背景色が透けていない(α≧0.5)」。
       控えめなボタンは α=0.06〜0.08 なので、両者ははっきり分かれる。 */
    window.__primaryActions = ()=>{
      /* vis は __auditScreen の中のローカルなのでここからは見えない。同じ判定を持つ */
      const seen = (el)=>{
        const s = getComputedStyle(el);
        if(s.display==='none' || s.visibility==='hidden' || s.opacity==='0') return false;
        const r = el.getBoundingClientRect();
        return r.width>0 && r.height>0;
      };
      /* 【主役はボタンとは限らない】負けの画面では順位そのもの(#resultRank)を塗って
         主役にし、操作バーは全部枠だけにしてある。ボタンだけ数えると 0個 と出るので、
         **順位も同じ物差しで数える。** 勝ちの順位は塗りではなく光る文字なので数に入らない。 */
      const boxes = ['resultActions','mastermonRegisterPrompt'];
      const cand = [];
      { const rk = document.getElementById('resultRank'); if(rk && seen(rk)) cand.push(rk); }
      const out = [];
      for(const bid of boxes){
        const box = document.getElementById(bid);
        if(!box || !seen(box)) continue;
        for(const b of box.querySelectorAll('button')) cand.push(b);
      }
      {
        for(const b of cand){
          if(!seen(b)) continue;
          /* 【シェアだけは数えない】共有の印は世の中で見慣れた顔(白地に黒のマーク)が
             決まっていて、発注者の指定で勝敗にもトーンにも左右されない固定色にしてある。
             操作の主役ではなく「決まった顔を持つ物」なので、塗りの数え上げから外す。
             ここを外さないと、2枚目が常に「主役が2つ」で落ちる。 */
          if(b.id === 'shareResultBtn') continue;
          const cs = getComputedStyle(b);
          const hasArt = cs.backgroundImage && cs.backgroundImage !== 'none';
          const m = (cs.backgroundColor||'').match(/rgba?\(([^)]+)\)/);
          const a = m ? (m[1].split(',')[3] !== undefined ? parseFloat(m[1].split(',')[3]) : 1) : 0;
          if(hasArt || a >= 0.5) out.push(b.id || b.textContent.trim().slice(0,10));
        }
      }
      return out;
    };
    window.__scrollOf = (ids)=>{
      const sc = (id)=>{ const el=document.getElementById(id); return el ? el.scrollHeight-el.clientHeight : -1; };
      const out = [];
      for(const id of ids){
        /* 3px以上を「スクロールが出た」とみなす。scrollHeight/clientHeight は整数に
           丸められるため、要素の位置が小数だと中身が収まっていても1〜2px差が出る。 */
        const d = sc(id); if(d > 2) out.push({ id, d });
      }
      return out;
    };
    window.__auditLobby = ()=>{
      const base = window.__auditScreen('startScreen');
      const screenEl = document.getElementById('startScreen');
      const vis = (el)=>{
        const s = getComputedStyle(el);
        if(s.display==='none' || s.visibility==='hidden' || s.opacity==='0') return false;
        const r = el.getBoundingClientRect();
        return r.width>0 && r.height>0;
      };
      /* ロビーはスクロールさせない決まりなので、どの枠にもスクロールが出てはいけない。
         **本当に画面の外へ出たかは outside(小数のまま比較)が見ている。** */
      const scrolls = window.__scrollOf(['lobbyLeft','lobbyMenuGrid','lobbyRight','lobbyRightTop','lobbyCenter','lobbyActionArea','startScreen']);
      const cols = (()=>{ const g=document.getElementById('lobbyMenuGrid');
        return g ? getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length : 0; })();
      /* 並び順: DOMの並び(画面で読む順)どおりに、2個ずつ同じ行の左右へ入っているか。
         入りきらない組が右のブロックへ回るのは正しい姿なので、ブロック内で見る。 */
      const grid = document.getElementById('lobbyMenuGrid');
      const order = [];
      if(grid){
        const vis2 = [...grid.children].filter(vis);
        const rows = parseInt(getComputedStyle(grid).getPropertyValue('--menu-rows')) || 0;
        vis2.forEach((el,i)=>{
          const pair = Math.floor(i/2), inPair = i%2, block = Math.floor(pair/rows||0);
          const want = { row: (pair % (rows||1)) + 1, col: block*2 + inPair + 1 };
          const got = { row: parseInt(el.style.gridRow), col: parseInt(el.style.gridColumn) };
          if(got.row!==want.row || got.col!==want.col){
            order.push({ id: el.id, want:`${want.row},${want.col}`, got:`${got.row},${got.col}` });
          }
        });
      }
      /* 【横へ広げてよいのは、縦にどうやっても入らないときだけ】
         左メニューが2列を超えて広がると、そのぶん中央が細くなり、
         タイトルと案内文が「…」で切れる(2026-08-26 実機報告)。
         「…」は許した切り方なので文字の検査では捕まらない。**ここで別に見る。**

         判定はゲーム側の決まりをそのまま置く: 押せる高さ(--tap-pick)と行間の下限で
         1ブロック(2列)に全部入る高さがあるなら、列は2でなければならない。
         入る高さは**バナーを引っ込めたぶきも含めて**数える(ゲーム側も同じ順で削る)。 */
      const spread = (()=>{
        const g = document.getElementById('lobbyMenuGrid');
        const left = document.getElementById('lobbyLeft');
        if(!g || !left) return null;
        const lcs = getComputedStyle(left), gcs = getComputedStyle(g);
        const leftH = left.clientHeight - (parseFloat(lcs.paddingTop)||0) - (parseFloat(lcs.paddingBottom)||0);
        const gridPad = (parseFloat(gcs.paddingTop)||0) + (parseFloat(gcs.paddingBottom)||0);
        const tap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-pick')) || 44;
        const n = [...g.children].filter(vis).length;
        const pairs = Math.ceil(n/2) || 1;
        const need = pairs*tap + (pairs-1)*2 + gridPad;   // 行間の下限は2px(ui.js と同じ)
        if(leftH < need) return null;                     // 本当に入らない = 横へ逃がしてよい
        return cols > 2 ? { cols, need:Math.round(need), leftH:Math.round(leftH) } : null;
      })();
      return { ...base, scrolls, menuCols: cols, order, spread };
    };

    /* ===== PANELS(画面ごとの方針)を測るための道具 ===== */
    /* 画面は1つだけ出す。前の画面が残ったまま測ると、隠れている物まで数えてしまう。 */
    window.__closePanels = ()=>{
      document.querySelectorAll('.mastermon-confirm-overlay, .resultScreen, #gachaOverlay, #lobbyScreen, #roomListScreen, #textInputOverlay')
        .forEach(o=> o.classList.add('hidden'));
      document.getElementById('startScreen').classList.remove('hidden');
    };
    /* 表に書いた手順どおりに開く。**実際の導線(ボタンを押す)をそのまま辿る**ので、
       「開く関数は直したが導線は古いまま」を素通りしない。 */
    window.__openPanel = async (steps)=>{
      window.__closePanels();
      for(const s of steps){
        if(s.btn){ const b = document.getElementById(s.btn); if(b) b.click(); }
        else if(s.call){ const f = window[s.call[0]]; if(typeof f==='function') await f(...s.call.slice(1)); }
        else if(s.sel){ const t = document.querySelectorAll(s.sel)[s.idx||0]; if(t) t.click(); }
        await new Promise(r=> requestAnimationFrame(r));
      }
      // 出るときの動きが終わってから測る(秒数で待つと機械の速さで結果が変わる)
      const finite = document.getAnimations().filter(a=>{
        const it = a.effect && a.effect.getTiming && a.effect.getTiming().iterations;
        return it !== Infinity;
      }).map(a=> a.finished.catch(()=>{}));
      await Promise.race([ Promise.all(finite), new Promise(r=> setTimeout(r, 800)) ]);
      await new Promise(r=> requestAnimationFrame(()=> requestAnimationFrame(r)));
    };
    /* レイド入口(#raidOverlay)専用の開き方。実際の導線(openRaidBtn→raidGuardReady)は
       開催期間・モンスター選択済みかどうかで弾かれ、実行日によって開けたり開けなかったり
       するため測定が安定しない。ここではその前提だけ整えて openRaidOverlay() を直接呼ぶ
       (中身の組み立て自体は本物の renderRaidOverlay を通るので画面としては本物と同じ)。 */
    window.__raidTestOpen = async ()=>{
      if(!game.selectedElement) game.selectedElement = 'dullahan';
      if(typeof openRaidOverlay==='function') await openRaidOverlay();
    };
    /* 【R2の検査】操作がスクロールの中で貼り付いていないか。
       スクロールする箱の中に position:sticky/fixed の押せる物があると、
       入りきらない中身が**黙ってその下に隠れる**(2026-08-26 マスモンのトレーニング画面で、
       6行目の「丈夫さ」がトレ実行ボタンの下敷きになっていた)。
       ボタンはスクロールの外へ出す ―― 重ねない作りなら隠れようがない。 */
    window.__stickyControls = (screenId)=>{
      const root = document.getElementById(screenId);
      if(!root) return [];
      const out = [];
      for(const el of root.querySelectorAll('*')){
        const s = getComputedStyle(el);
        if(s.display==='none' || s.visibility==='hidden') continue;
        if(s.position!=='sticky' && s.position!=='fixed') continue;
        const isCtl = el.tagName==='BUTTON' || el.querySelector('button') || el.getAttribute('role')==='button';
        if(!isCtl) continue;
        for(let p = el.parentElement; p && p!==root.parentElement; p = p.parentElement){
          const ps = getComputedStyle(p);
          if(/(auto|scroll)/.test(ps.overflowY) && p.scrollHeight - p.clientHeight > 2){
            out.push({ id: el.id || el.className.toString().trim().split(/\s+/)[0] || el.tagName,
                       box: p.id || p.className.toString().trim().split(/\s+/)[0] || p.tagName });
            break;
          }
        }
      }
      return out;
    };
    /* 5. 「これから起きうること」を実際に起こして、それでも壊れないかを見る。
          ・増やす … 左メニューへ9個(右列は増やさないのが決まりなので注入しない)
          ・伸ばす … 画面の文字をすべて長くする。**箱の大きさが中身で決まっていたら
                     ここで必ず壊れる**ので、直したはずの向き(箱→中身)の証明になる。 */
    const LONG = 'とてもながいなまえのこうもく';
    window.__injectStress = (kind)=>{
      /* 既定で hidden のタイル(レイド)を出す。**「あとから出る物」を必ず見る**ための組。
         更新タイルは2026-08-23に撤去したので、いまはレイドだけが対象。
         同じ形の物を足したらここへ1行足すこと(枠の外との重なりを下の4で見ている)。 */
      if(kind==='raidTile'){
        const raid = document.getElementById('openRaidBtn');
        if(raid) raid.classList.remove('hidden');
        if(typeof updateLobbyMenuRows==='function') updateLobbyMenuRows();
        return;
      }
      if(kind==='future'){
        const grid = document.getElementById('lobbyMenuGrid');
        for(let i=0;i<9;i++){
          const b = document.createElement('button');
          b.className = 'lobby-side-btn'; b.dataset.stress = '1';
          b.innerHTML = `<span class="lobby-side-icon">🆕</span><span class="lobby-side-label">新機能${i+1}</span>`;
          grid.appendChild(b);
        }
      } else if(kind==='long'){
        for(const sel of ['.lobby-side-label','.lobby-pick-value','.lobby-pick-label',
                          '.season-ssr-pop','.raid-gacha-pop','#lobbyMonsterName','#lobbyMonsterTapHint',
                          '#pickMonsterNotice','.lobby-banner-name','.lrp-name','.lrp-next','.join-label']){
          document.querySelectorAll(sel).forEach(el=>{
            if(el.dataset.orig==null) el.dataset.orig = el.textContent;
            el.textContent = LONG + LONG;
          });
        }
      }
    };
    window.__clearStress = ()=>{
      // 出しっぱなしにすると次のケースへ持ち越して結果が混ざる
      const raid = document.getElementById('openRaidBtn');
      if(raid) raid.classList.add('hidden');
      if(typeof updateLobbyMenuRows==='function') updateLobbyMenuRows();
      document.querySelectorAll('[data-stress]').forEach(e=>e.remove());
      document.querySelectorAll('[data-orig]').forEach(e=>{ e.textContent = e.dataset.orig; delete e.dataset.orig; });
    };

    /* ===== #startScreen 以外の3画面 =====
       待機部屋(#lobbyScreen)・部屋一覧(#roomListScreen)・リザルト(#resultScreen)は
       #startScreen の**兄弟**なので、走査対象を #startScreen に固定していたこれまでの作りでは
       1度も見ていなかった。「待機画面が2.14画面ぶんスクロールする」「ボタンが36pxしかない」が
       残っていたのはこの穴のせい。
       中身は雛形を手で書かず、**ui.js の描画関数へ通す**(renderLobbyPlayerList /
       refreshRoomList / fitResultScreen)。そうしないと画面を直したときにここだけ古い形で残る。 */
    const SCREEN_IDS = ['startScreen','lobbyScreen','roomListScreen','resultScreen'];
    const LONG_NAME = 'とてもながいなまえのプレイヤー';
    window.__showOnly = (id)=>{
      for(const s of SCREEN_IDS){ const el=document.getElementById(s); if(el) el.classList.add('hidden'); }
      if(id) document.getElementById(id).classList.remove('hidden');
    };
    window.__fillLobbyScreen = (variant)=>{
      window.__showOnly('lobbyScreen');
      netState.raid = false;
      netState.capacity = 8;
      netState.hostId = 'p0';
      netState.isHost = (variant !== 'guest');
      netState.myPlayerId = netState.isHost ? 'p0' : 'p1';
      const names = ['ホストのひと', LONG_NAME, 'くろねこ', 'ゆうしゃ', 'まもの', 'せんし', 'まほうつかい', 'りゅうき'];
      const n = (variant === 'few') ? 2 : names.length;
      netState.humanPlayers = {};
      for(let i=0;i<n;i++) netState.humanPlayers['p'+i] = { name: names[i], element:'dullahan' };
      renderLobbyPlayerList();
      updateLobbyWaitState();
      showLobbyButtonsForRole();
      document.getElementById('lobbyCountdown').textContent = 'まもなく開始… 5';
    };
    window.__fillRoomList = async (variant)=>{
      window.__showOnly('roomListScreen');
      const cnt = variant==='empty' ? 0 : (variant==='many' ? 8 : 3);
      const rooms = [];
      for(let i=0;i<cnt;i++) rooms.push({
        roomId:'r'+i, lobbyKey:'k'+i, hostName: i===1 ? LONG_NAME : ('プレイヤー'+(i+1)),
        capacity:8, count:(i%8)+1, teamSize: (i%2)?2:1, sub: (i%3===0)?'br20':null, mapPick:'random',
      });
      // 通信の口だけ差し替えて、一覧の描画は本物(refreshRoomList)に任せる
      window.__aramonListOpenRooms = async ()=> rooms;
      window.__aramonNetFailed = ()=> false;
      roomListSig = '';
      document.getElementById('roomListTitle').textContent = 'チーム戦の部屋を探す';
      await refreshRoomList();
    };
    window.__fillResult = (variant)=>{
      // 「-p2」付きは2枚目(数字と導線)へ切り替えて測る
      const page2 = /-p2$/.test(variant);
      variant = variant.replace(/-p2$/, '');
      window.__showOnly('resultScreen');
      /* 【中身は実物と同じ経路で作る】以前ここは #resultRank へ直接「#1」と書くだけで、
         **setResultPlacement() を1度も通していなかった。** そのせいで検査の間だけ
         #resultScreen に data-rankcard が付かず、見出しが旧サイズ(46px)のまま測られ、
         順位の札(#rsRankCard)は前の状態のまま残っていた ―― 実機と撮影は新サイズ。
         「合格したのに壊れている」を3回生んだのと同じ穴なので、**判定を持つ関数を通す**。
         見出しの文言も showResultNow / raidShowResult と同じ言葉にそろえる。 */
      document.getElementById('resultRank').textContent = 'WINNER';
      document.getElementById('resultSub').textContent = '生き残った！今夜はモン勝ちだ！';
      document.getElementById('statKills').textContent = '12';
      document.getElementById('statDamage').textContent = '18,420';
      document.getElementById('statTime').textContent = '12:34';
      document.getElementById('statStreak').textContent = '3';
      document.getElementById('statHp').textContent = '18%';
      document.getElementById('scoreSubmitStatus').textContent = 'スコアを送信しました';
      document.getElementById('resultCurrencyLine').textContent = '💰 320 コイン ／ 💎 4 ジェム を獲得';
      document.getElementById('resultMonsterIcon').src = 'monsters/phoenix.png';
      /* 出す物の組み合わせは場面ごとに決める。**「全部出す(full)」だけでは足りない** ――
         レイドは操作バーの中身が入れ替わり、登録の対話は帯が1本増え、
         チーム戦は小隊の行が増える。どれも縦の使い方が変わるので、別々に見る。 */
      const SHOW = {
        plain:    { death:0, hl:0, squad:0, badges:0, mmInfo:0, reg:0, raid:0 },
        full:     { death:1, hl:1, squad:1, badges:1, mmInfo:1, reg:1, raid:0 },
        lose:     { death:1, hl:0, squad:0, badges:1, mmInfo:1, reg:0, raid:0 },
        team:     { death:0, hl:1, squad:1, badges:1, mmInfo:1, reg:0, raid:0 },
        register: { death:1, hl:0, squad:0, badges:0, mmInfo:0, reg:1, raid:0 },
        raid:     { death:0, hl:0, squad:0, badges:1, mmInfo:1, reg:0, raid:1 },
      };
      const on = SHOW[variant] || SHOW.plain;
      const scr = document.getElementById('resultScreen');
      scr.className = 'resultScreen ' + ((variant === 'lose' || variant === 'register') ? 'lose' : 'win');
      scr.dataset.tone = (variant === 'lose' || variant === 'register') ? 'lose' : 'win';
      if(variant === 'lose' || variant === 'register'){
        document.getElementById('resultRank').textContent = '敗北';
        document.getElementById('resultSub').textContent = '';
      }
      if(variant === 'raid'){
        document.getElementById('resultRank').textContent = '討伐成功';
        document.getElementById('resultSub').textContent = '自己ベスト更新！';
      }
      /* 順位の札(と、それに連動する見出しの級・色)は **setResultPlacement() が唯一の入口**。
         レイドだけ順位が無いので null を渡して札ごと畳む ―― 札が出る場面と出ない場面の
         両方を、実機とまったく同じ姿で測る。チーム戦は順位がチーム単位(母数もチーム数)。 */
      if(typeof setResultPlacement === 'function'){
        const lost = (variant === 'lose' || variant === 'register');
        if(variant === 'raid') setResultPlacement(null);
        else if(on.squad) setResultPlacement({ placement: lost?3:1, total:3, team:true });
        else setResultPlacement({ placement: lost?7:1, total:7 });
      }
      const put = (id, want, html)=>{
        const el = document.getElementById(id); if(!el) return;
        el.classList.toggle('hidden', !want);
        if(want && html != null) el.innerHTML = html;
      };
      put('resultDeathCause', on.death, `⚔ ${LONG_NAME} に倒された`);
      put('resultHighlight', on.hl, '🔥 自己ベスト更新！ 12キル');
      put('resultSquadInfo', on.squad, `<div>小隊: あなた 12撃破 ／ ${LONG_NAME} 3撃破 ／ なかま ダウン</div>`);
      put('resultBadges', on.badges, '<span class="result-badge season">🎫 シーズン +12 SP</span><span class="result-badge">🏆 自己ベスト更新</span>');
      put('mastermonResultInfo', on.mmInfo, '<div>マスモン「ほのお」が Lv12 → Lv13 になりました</div>');
      put('mastermonRegisterPrompt', on.reg, null);   // 中に入力欄とボタンがあるので中身は書き換えない
      if(typeof setResultButtonsForRaid==='function') setResultButtonsForRaid(!!on.raid);
      if(typeof resultGoPage==='function') resultGoPage(page2 ? 1 : 0, { instant:true });
      /* 【演出を必ず終わらせてから測る】入場の演出は要素を opacity:0 から出すが、
         下の vis() は opacity==='0' を不可視として飛ばす。演出を走らせないまま測ると
         **台帳もバッジも「見えていない要素」として検査対象から丸ごと消える**
         ―― 合格したのに壊れている、が起きる。ここで最後まで進めた姿にする。 */
      if(typeof playResultSequence==='function') playResultSequence();
      if(typeof playResultPage2Sequence==='function' && page2) playResultPage2Sequence();
      if(typeof finishResultSequence==='function') finishResultSequence();
      if(typeof fitResultScreen==='function') fitResultScreen();
    };
  });

  /* 【既定で hidden の物が「あとから出る」場合を必ず見る】
     2026-08-23、あとから出たタイルがバナーの下に27.2px潜って見えなくなった。
     既存の「将来+9個」は最初から見えているタイルを増やすだけなので、この形を素通ししていた。
     ・update    = 更新タイルが出た(11枚)
     ・raidUpd   = レイド開催中 + 更新タイル(12枚)
     ・lateUpd   = **寸法が測れない間に出た**(今回の原因そのもの)。
                   updateLobbyMenuRows() は測れないと黙って返るので、升目の割り当てだけが
                   古いまま残り、あとから出たタイルが存在しない行へ置かれて枠の外へ出た。 */
  const STRESS = [ {k:null, t:''}, {k:'future', t:' / 将来+9個'}, {k:'long', t:' / 文字を長く'} ];
  for(const m of MODES){
    for(const withMonster of [false, true]){
      for(const st of STRESS){
        /* 縦を削られた端末では「将来+9個」を重ねない。**起きうることの掛け算をしない**
           ―― 縦不足は実際に起きること、+9個はまだ起きていないこと。両方を同時に
           満たす形(19個を320pxに、押せる高さを割らず、スクロールもさせず)は
           そもそも存在しないので、テストを通すために基準を下げる羽目になる。
           +9個は通常の高さの端末4種で見ている。 */
        if(dev.short && st.k==='future') continue;
        const label = `${dev.name} / ${m.name} / ${withMonster?'モンスター選択済':'未選択'}${st.t}`;
        const r = await page.evaluate(async (o)=>{
          window.__clearStress();
          game.selectedElement = o.withMonster ? 'dullahan' : null;
          game.selectedMastermonKey = null;
          setLobbyMode(o.mode, { save:false });
          if(o.sub) setLobbySubMode(o.sub, { save:false });
          updatePlayButtonsEnabled();
          refreshLobby();
          if(o.stress){ window.__injectStress(o.stress); updateLobbyMenuRows(); }
          await new Promise(r=> requestAnimationFrame(()=> requestAnimationFrame(r)));
          return window.__auditLobby();
        }, { mode:m.mode, sub:m.sub, withMonster, stress: st.k });

        pushFindings(label, r);
        if(st.k) notes.push(`${label}: メニュー${r.menuCols}列・縦は伸びず・切れ0`);
      }
    }
  }

  /* ===== 既定で hidden のタイルが「あとから出る」場合 =====
     2026-08-23、あとから出たタイルがSSRバナーの下へ27.2px潜って見えなくなった。
     既存の「+9個」は最初から見えているタイルを増やすだけなので、この形を素通ししていた。
     モードにも選択の有無にも依存しないので**端末ごとに1回だけ**回す。 */
  {
    const label = `${dev.name} / レイドタイルがあとから出る`;
    const r = await page.evaluate(async ()=>{
      window.__clearStress();
      game.selectedElement = 'dullahan';
      setLobbyMode('single', { save:false });
      refreshLobby();
      window.__injectStress('raidTile');
      await new Promise(r=> setTimeout(r, 450));
      await new Promise(r=> requestAnimationFrame(()=> requestAnimationFrame(r)));
      const base = window.__auditLobby();
      const raid = document.getElementById('openRaidBtn');
      base.shown = !!(raid && !raid.classList.contains('hidden'));
      return base;
    });
    pushFindings(label, r);
    if(!r.shown) failures.push(`[タイルが出ていない] ${label}`);
    console.log(`  ${label}: タイル${r.shown?'あり':'なし'}・メニュー${r.menuCols}列・重なり${r.overlap.length}件`);
  }
  await page.evaluate(()=> window.__clearStress());

  /* ===== 待機部屋 / 部屋一覧 / リザルト =====
     ロビー本体と同じ物差し(見切れ/押しやすさ/文字/はみ出し/重なり/スクロール)で見る。
     端末ごとに 3+3+2 = 8通り。ページの用意が一番重い処理なので、同じページを使い回す。 */
  for(const s of SCREENS){
    for(const v of s.variants){
      const label = `${dev.name} / ${s.name}(${v})`;
      const r = await page.evaluate(async (o)=>{
        if(o.id==='lobbyScreen') window.__fillLobbyScreen(o.v);
        else if(o.id==='roomListScreen') await window.__fillRoomList(o.v);
        else window.__fillResult(o.v);
        /* パネルはスライドして出るので、**動き終わってから**測る。
           秒数で待つと機械の速さで結果が変わる(同じコードで2px/3pxと揺れ、対象端末まで変わった)。
           【必ず終わる物だけを待つ】通知ドットやTAP STARTは infinite なので finished が
           永久に解決しない。iterations が有限の物だけに絞り、さらに保険で1秒で打ち切る
           (待ち損ねても最後のrAF2回で救えるが、無限に止まるのは避ける)。 */
        const finite = document.getAnimations().filter(a=>{
          const it = a.effect && a.effect.getTiming && a.effect.getTiming().iterations;
          return it !== Infinity;
        }).map(a=> a.finished.catch(()=>{}));
        await Promise.race([ Promise.all(finite), new Promise(r=> setTimeout(r, 1000)) ]);
        await new Promise(r=> requestAnimationFrame(()=> requestAnimationFrame(r)));
        const base = window.__auditScreen(o.id);
        base.scrolls = window.__scrollOf(o.scrollIds);
        if(o.id === 'resultScreen') base.primary = window.__primaryActions();
        return base;
      }, { id:s.id, v, scrollIds:s.scrollIds });
      pushFindings(label, r);
    }
  }
  await page.evaluate(()=> window.__showOnly('startScreen'));   // 状態を残さずロビーへ戻す

  /* ===== 画面ごとの方針(PANELS)を1つずつ開いて測る =====
     ロビーと同じ物差しに、R2(操作がスクロールの中で貼り付いていないか)を足して見る。 */
  for(const p of PANELS){
    const label = `${dev.name} / ${p.name}`;
    const r = await page.evaluate(async (o)=>{
      await window.__openPanel(o.open);
      const base = window.__auditScreen(o.id);
      base.scrolls = window.__scrollOf(o.noScroll);
      base.sticky = window.__stickyControls(o.id);
      return base;
    }, { id:p.id, open:p.open, noScroll:p.noScroll });
    pushFindings(label, r);
  }
  await page.evaluate(()=> window.__closePanels());

  if(jsErrors.length) failures.push(`[JSエラー] ${dev.name} — ${jsErrors[0].slice(0,160)}`);
  await page.close();
}

await browser.close();
server.close();

const SCREEN_CASES = SCREENS.reduce((n,s)=> n + s.variants.length, 0);
console.log(`検査: ${DEVICES.length}端末 × (${MODES.length}モード × 選択有無2 × 負荷${STRESS_N}種`
  + ` + 別画面${SCREEN_CASES}通り + 画面ごとの方針${PANELS.length}通り)`
  + ` = ${DEVICES.length*(MODES.length*2*STRESS_N + SCREEN_CASES + PANELS.length)}通り`);
// LOBBY_TEST_ALL=1 を付けると省略せず全部出す(直す前の棚卸しに使う)
const SHOW_ALL = !!process.env.LOBBY_TEST_ALL;
if(knownHits.length){
  console.log('\n--- 例外として許しているもの(直したらKNOWNの行を消す。LOBBY_TEST_ALL=1 で全件) ---');
  const seen = new Set();
  for(const h of knownHits){
    const k = SHOW_ALL ? h : h.replace(/^(\[[^\]]+\]) [^/]+\//, '$1 ');   // 端末名の違いは1件にまとめる
    if(seen.has(k)) continue; seen.add(k);
    if(SHOW_ALL || seen.size <= 8) console.log('  ' + k);
  }
  if(!SHOW_ALL && seen.size > 8) console.log(`  …ほか${seen.size - 8}種`);
  console.log(`  … のべ${knownHits.length}件(LOBBY_TEST_ALL=1 で全件)`);
}
if(notes.length){
  console.log('\n--- 「増えても壊れない」の確認(スクロールへ逃げた例) ---');
  for(const n of notes.slice(0,4)) console.log('  ' + n);
  console.log(`  … 全${notes.length}件`);
}
if(failures.length){
  console.log('\n== 失敗 ==');
  const max = SHOW_ALL ? failures.length : 40;
  for(const f of failures.slice(0,max)) console.log('  ' + f);
  if(failures.length>max) console.log(`  … 他${failures.length-max}件(LOBBY_TEST_ALL=1 で全部出る)`);
  // 同じ物が端末×モードのぶん並ぶので、要素ごとにまとめた索引も出す(頭打ちで隠れないように)
  console.log('\n-- 落ちた物の索引(件数の多い順) --');
  for(const [k,n] of [...findingIndex.entries()].sort((a,b)=> b[1]-a[1])) console.log(`  ${n}件  ${k}`);
  process.exit(1);
}
console.log(knownHits.length
  ? `\n== 全チェックOK(構造は基準どおり)。ただし例外として許している指摘が のべ${knownHits.length}件ある ==`
  : '\n== 全チェックOK(見切れ0 / 文字切れ0 / 重なり0。例外もなし) ==');
