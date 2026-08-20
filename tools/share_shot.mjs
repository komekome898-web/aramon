/* シェアカードの見た目を確認する開発用ツール(ゲームには読み込まない)。
   全種類のカードをPNGに書き出す。**デザインを変えたら必ずこれで全種類を見る。**

   使い方: node tools/share_shot.mjs [--out <出力先>]

   ・実物と同じ経路で描く(ページを開いて render.js の shareCardCanvas(spec) を呼ぶ)
   ・**フォントは遮断しない。** 実機と同じ書体で確認したいため(fx_shot.mjs は遮断している)
   ・spec は ui.js の生成関数と同じ形を手で用意する(試合をせずに全種類を出すため)      */
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const argAt = (name, def)=>{ const i = process.argv.indexOf('--'+name); return i>=0 && process.argv[i+1] ? process.argv[i+1] : def; };
const OUT = path.resolve(argAt('out', path.join(ROOT, 'tools', '_share_preview')));

let chromium;
try{ ({ chromium } = await import('playwright')); }
catch{
  const { createRequire } = await import('module');
  const req = createRequire(path.join(process.cwd(), 'x.js'));
  ({ chromium } = req('playwright'));
}

const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css',
                '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
                '.mp3':'audio/mpeg', '.mp4':'video/mp4', '.webm':'video/webm', '.woff2':'font/woff2' };
const server = http.createServer((req, res)=>{
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (err, buf)=>{
    if(err){ res.writeHead(404); res.end(''); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise(r=> server.listen(0, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + server.address().port;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  // ローカルサーバは必ず直結する(bypassを書かないと自前の127.0.0.1までプロキシへ行って失敗する)
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined,
});
// ignoreHTTPSErrors: 社内プロキシの中間CAをブラウザが信頼していないため(Webフォントを通したい)
const ctx = await browser.newContext({ viewport:{ width:1280, height:760 }, deviceScaleFactor:1,
                                       serviceWorkers:'block', ignoreHTTPSErrors:true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e=> errs.push(String(e).slice(0,160)));
await page.route('**://*.firebaseio.com/**', r=> r.abort());
await page.goto(ORIGIN + '/index.html', { waitUntil:'domcontentloaded' });
await page.waitForFunction(()=> typeof shareCardCanvas === 'function' && typeof ELEMENTS !== 'undefined', null, { timeout: 60000 });
await page.waitForTimeout(2500);   // モンスター画像とWebフォントの読み込み待ち
await page.evaluate(()=> document.fonts && document.fonts.ready);

// 出す種類。ui.js の各 build*Share が作る spec と同じ形にする
const shots = await page.evaluate(async ()=>{
  const A = (typeof SHARE_ACCENT!=='undefined') ? SHARE_ACCENT : {};
  const art = (el, skin)=> (typeof shareArtImage==='function') ? shareArtImage(el, skin) : null;
  const mmBars = ()=> MASTERMON_STATS.map((s, i)=>({
    label: s.label, rank: ['S','A','B','C','D','E'][i], value: [742, 613, 588, 470, 355, 690][i],
    max: 999, color: s.color }));
  const list = [
    ['01_勝利', { ...(A.win||{}), player:'おりょう', headline:'👑 CHAMPION', sub:'30人バトルロイヤルで優勝',
      image: art('fire', null), imageLabel:'ドラゴン',
      rows:[{label:'順位',value:'1位'},{label:'キル',value:'7'},{label:'ダメージ',value:'2,480'}],
      chips:['荒野マップ','シングル'] }],
    ['02_敗北', { ...(A.lose||{}), player:'おりょう', headline:'4位', sub:'あと少しで優勝だった',
      image: art('spark', null), imageLabel:'ライガー',
      rows:[{label:'順位',value:'4位'},{label:'キル',value:'3'},{label:'ダメージ',value:'1,120'}],
      chips:['雪原マップ','チーム戦'] }],
    ['03_レイド', { ...(A.raid||{}), player:'おりょう', headline:'🐉 レイドボスを討伐！', sub:'不死のゾッドを撃破',
      image: art('fire', 'zod_ssr'), imageLabel:'不死のゾッド',
      rows:[{label:'与ダメージ',value:'18,640'},{label:'順位',value:'2位'},{label:'討伐',value:'成功'}],
      chips:['レイド','3人チーム'] }],
    ['04_マスモン', { ...(A.mm||{}), player:'おりょう', headline:'ドラ次郎', sub:'Lv.100 ★★★ ドラゴン',
      image: art('fire', 'fire:blue'), imageLabel:'ドラ次郎',
      bars: mmBars(), chips:['転生3回','覚醒済み'] }],
    ['05_SSRスキン', { ...(A.ssr||{}), player:'おりょう', headline:'SSR 北大路さつキジン 獲得！', sub:'キジン のスキン',
      image: (typeof skinnedImage==='function') ? skinnedImage('satsuki_ssr','icon') : null, imageLabel:'北大路さつキジン',
      foil:'ssr', rows:[{label:'レアリティ',value:'SSR'},{label:'モンスター',value:'キジン'},
                        {label:'専用技',value:(typeof skinTier3Def==='function' && skinTier3Def('satsuki_ssr')||{}).name||'—'}],
      chips:['スキンガチャ'] }],
    ['06_SRスキン', { ...(A.ssr||{}), player:'おりょう', headline:'SR ドラゴン(青) 獲得！', sub:'ドラゴン のスキン',
      image: (typeof skinnedImage==='function') ? skinnedImage('fire:blue','icon') : null, imageLabel:'ドラゴン(青)',
      rows:[{label:'レアリティ',value:'SR'},{label:'モンスター',value:'ドラゴン'}], chips:['スキンガチャ'] }],
    ['07_ランキング', { ...(A.win||{}), player:'おりょう', headline:'ランキング 3位', sub:'シングル30人バトロワ',
      image: art('illumine', null), imageLabel:'イルミネ',
      rows:[{label:'順位',value:'3位'},{label:'RP',value:'1,842'},{label:'段位',value:'ダイヤ'}],
      chips:['シーズン1'] }],
    ['08_長い値', { ...(A.win||{}), player:'なまえがとてもながいひと', headline:'👑 CHAMPION 完全勝利',
      sub:'これは長いサブタイトルのテスト用の文章です', image: art('rock', null), imageLabel:'ものすごくながいマスモンの名前',
      rows:[{label:'与えたダメージ',value:'128,640'},{label:'キル',value:'27'},{label:'順位',value:'1位'},{label:'生存',value:'18分'}],
      chips:['とてもながいチップ名','ふたつめ','みっつめ'] }],
  ];
  const out = [];
  for(const [name, spec] of list){
    const t0 = performance.now();
    const c = shareCardCanvas(spec);
    const ms = performance.now() - t0;
    out.push({ name, ms: Math.round(ms*10)/10, data: c.toDataURL('image/png') });
  }
  return out;
});

for(const s of shots){
  fs.writeFileSync(path.join(OUT, s.name + '.png'), Buffer.from(s.data.split(',')[1], 'base64'));
  console.log(`${s.name}.png  (描画 ${s.ms}ms)`);
}
console.log('\n出力先: ' + OUT);
if(errs.length) console.log('ページエラー: ' + errs.slice(0,3).join(' / '));
await browser.close();
server.close();
