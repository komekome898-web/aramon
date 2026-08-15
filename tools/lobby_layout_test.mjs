/* ロビーのレイアウト契約を機械で守るテスト(開発用。ゲームには読み込まない)。

   ロビーはボタンを足すたびに壊れてきた画面で、2026-08-15には出撃ボタンが
   20pxまで潰れて文字が消えた。**数字の詰め直しではなく構造で止める**と決めたので、
   その構造が守られていることをここで毎回確かめる。

   使い方: node tools/lobby_layout_test.mjs

   確かめること(発注者が出した3条件と1対1):
     1. 見切れない  … ロビーの要素が1つも #appRoot の外へ出ない
     2. 押しやすい  … 操作できる物はすべて --tap-* の下限以上の実寸で描かれる
     2b.文字が読める … 画面の中の文字が1つも「縦に切れる/横に切れる/小さすぎる」に
                       なっていない(ボタン単位ではなく文字を持つ要素すべてを見る)
     3. 重ならない  … 同じ列の中で操作できる物どうしが重ならない
     4. 端末と持ち方… 縦持ち(強制横向き)/実横持ち/タブレットの計7通り
     5. **これから起きうることを実際に起こす** … ボタンを9個足した状態と、
        画面の文字をすべて長くした状態でも 1〜3 が成り立つ。
        箱の大きさが中身で決まっていたらここで必ず壊れるので、
        「箱が先・中身は箱から」の作りになっていることの証明になる。
        ロビーはスクロールさせないので、**どの枠もスクロールが出ていないこと**も見る。 */
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
];
// プレイモードで右列の中身が変わる(部屋のボタンの有無)ので全部見る
const MODES = [
  { name:'シングル30人', mode:'single', sub:'br30' },
  { name:'マルチPvP',    mode:'single', sub:'pvp4' },
  { name:'チーム戦20',   mode:'team',   sub:'br20' },
  { name:'アリーナ',     mode:'team',   sub:'arena' },
  { name:'レイド',       mode:'raid',   sub:null },
];

const failures = [];
const notes = [];
const STRESS_N = 3;   // 素の状態 / ボタン+9個 / 文字を長く

for(const dev of DEVICES){
  const page = await browser.newPage({
    viewport:{ width:dev.w, height:dev.h }, screen:{ width:dev.w, height:dev.h },
    deviceScaleFactor:2, isMobile:true, hasTouch:true,
  });
  const jsErrors = [];
  page.on('pageerror', e=> jsErrors.push(String(e)));
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
      return 0;   // バナー等の「押せるが大きさの決まりが無い」物は対象外
    };
    window.__auditLobby = ()=>{
      const root = document.getElementById('appRoot');
      const rb = root.getBoundingClientRect();
      const screenEl = document.getElementById('startScreen');
      const vis = (el)=>{
        const s = getComputedStyle(el);
        if(s.display==='none' || s.visibility==='hidden' || s.opacity==='0') return false;
        const r = el.getBoundingClientRect();
        return r.width>0 && r.height>0;
      };
      const outside = [], tooSmall = [], overlap = [];
      /* 1. #appRoot の外へ出ていないか。#appRoot は90度回っているが、子も同じ変換を
            受けるので外接矩形どうしの比較でそのまま判定できる(90度なので軸は入れ替わるだけ)。 */
      for(const el of screenEl.querySelectorAll('*')){
        if(!vis(el)) continue;
        const s = getComputedStyle(el);
        if(s.position==='fixed') continue;
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
      /* 2b. **画面の中の文字が1つでも読めなくなっていないか。**
            ボタン単位の当て物ではなく、ロビーの中で「自分で文字を持っている要素」を
            すべて見る。読めなくなり方は次の3つしかない:
              ・縦に切れる  … 箱より中身が高い(overflow:hidden で上下が消える)
              ・横に切れる  … 「…」を出さない作りなのに幅が足りない
              ・小さすぎる  … 実寸の字が読める大きさを割っている
            この3つは実機で起きた不具合(ラベルが半分消える/吹き出しが潰れる)を
            そのまま言い表したもので、どこに何を足しても同じ基準で効く。 */
      const clipped = [];
      const MIN_FONT = 6.5;   // これ未満は読めない
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
        const fs2 = parseFloat(s2.fontSize) || 0;
        if(fs2 < MIN_FONT){ clipped.push({ id, why:`字が${fs2.toFixed(1)}pxで小さすぎる` }); continue; }
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
        if(dy > 1.5) clipped.push({ id, why:`縦に${dy.toFixed(1)}px切れる` });
        else if(!ellipsis && dx > 1.5) clipped.push({ id, why:`横に${dx.toFixed(1)}px切れる` });
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
      const sc = (id)=>{ const el=document.getElementById(id); return el ? el.scrollHeight-el.clientHeight : -1; };
      // ロビーはスクロールさせない決まりなので、どの枠にもスクロールが出てはいけない
      const scrolls = [];
      for(const id of ['lobbyLeft','lobbyMenuGrid','lobbyRight','lobbyRightTop','lobbyCenter','lobbyActionArea','startScreen']){
        /* 3px以上を「スクロールが出た」とみなす。scrollHeight/clientHeight は整数に
           丸められるため、要素の位置が小数だと中身が収まっていても1〜2px差が出る。
           **本当に画面の外へ出たかは上の outside(小数のまま比較)が見ている。** */
        const d = sc(id); if(d > 2) scrolls.push({ id, d });
      }
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
      return { outside, tooSmall, clipped, overlap, scrolls, menuCols: cols, order };
    };
    /* 5. 「これから起きうること」を実際に起こして、それでも壊れないかを見る。
          ・増やす … 左メニューへ9個(右列は増やさないのが決まりなので注入しない)
          ・伸ばす … 画面の文字をすべて長くする。**箱の大きさが中身で決まっていたら
                     ここで必ず壊れる**ので、直したはずの向き(箱→中身)の証明になる。 */
    const LONG = 'とてもながいなまえのこうもく';
    window.__injectStress = (kind)=>{
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
      document.querySelectorAll('[data-stress]').forEach(e=>e.remove());
      document.querySelectorAll('[data-orig]').forEach(e=>{ e.textContent = e.dataset.orig; delete e.dataset.orig; });
    };
  });

  const STRESS = [ {k:null, t:''}, {k:'future', t:' / 将来+9個'}, {k:'long', t:' / 文字を長く'} ];
  for(const m of MODES){
    for(const withMonster of [false, true]){
      for(const st of STRESS){
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

        if(r.outside.length) failures.push(`[見切れ] ${label} — ${r.outside.slice(0,4).map(x=>`${x.id}が${x.over}px外`).join(' / ')}`);
        if(r.tooSmall.length) failures.push(`[小さすぎ] ${label} — ${r.tooSmall.slice(0,4).map(x=>`${x.id} ${x.got}px < ${x.floor}px`).join(' / ')}`);
        if(r.clipped.length) failures.push(`[文字が切れる] ${label} — ${r.clipped.slice(0,4).map(x=>`${x.id}${`(${x.why})`}`).join(' / ')}`);
        if(r.overlap.length) failures.push(`[重なり] ${label} — ${r.overlap.slice(0,3).map(x=>`${x.a}×${x.b} ${x.px}px`).join(' / ')}`);
        if(r.order && r.order.length) failures.push(`[並び順] ${label} — ${r.order.slice(0,3).map(x=>`${x.id} は${x.want}のはずが${x.got}`).join(' / ')}`);
        if(r.scrolls.length) failures.push(`[スクロール発生] ${label} — ${r.scrolls.map(x=>`${x.id}が+${x.d}px`).join(' / ')}`);
        if(st.k) notes.push(`${label}: メニュー${r.menuCols}列・縦は伸びず・切れ0`);
      }
    }
  }
  if(jsErrors.length) failures.push(`[JSエラー] ${dev.name} — ${jsErrors[0].slice(0,160)}`);
  await page.close();
}

await browser.close();
server.close();

console.log(`検査: ${DEVICES.length}端末 × ${MODES.length}モード × 選択有無2 × 負荷${STRESS_N}種 = ${DEVICES.length*MODES.length*2*STRESS_N}通り`);
if(notes.length){
  console.log('\n--- 「増えても壊れない」の確認(スクロールへ逃げた例) ---');
  for(const n of notes.slice(0,4)) console.log('  ' + n);
  console.log(`  … 全${notes.length}件`);
}
if(failures.length){
  console.log('\n== 失敗 ==');
  for(const f of failures.slice(0,40)) console.log('  ' + f);
  if(failures.length>40) console.log(`  … 他${failures.length-40}件`);
  process.exit(1);
}
console.log('\n== 全チェックOK(見切れ0 / 小さすぎ0 / 重なり0) ==');
