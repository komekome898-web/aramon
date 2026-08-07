/* 画面のスクロール量と見切れを測る開発用ツール(ゲームには読み込まない)。
   「スクロールが多い」「文字が切れている」という指摘に、勘ではなく数字で答えるためのもの。

   使い方:
     node tools/measure_layout.mjs <断片HTML> [--box <セレクタ>] [--sizes 667x375,812x375] [--shot 出力.png] [--css style.cssの場所]

   断片HTMLは中身のマークアップだけでよい(style.cssはこのツールが読み込む)。
   style.cssの :root が --vw/--vh を 1vw/1vh で定義しているので、実機と同じ値で測れる。

   --box はスクロールする枠。省略時はいちばん背の高いスクロール要素を自動で選ぶ。

   出すもの:
     ・スクロール総高 / 表示高 / 何画面ぶんか
     ・枠直下の子要素ごとの高さ(どこが場所を食っているか)
     ・見切れている要素の数(scrollWidth > clientWidth)
     ・横方向へのはみ出しの有無

   playwrightが要る。無ければ入れてから実行する:
     npm i playwright   (このリポジトリには入れない。作業用の別ディレクトリで)
   ゲーム本体の動作確認は今までどおり実機で行う。これは寸法を測るだけのツール。 */
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const fixture = args.find(a => !a.startsWith('--'));
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
if(!fixture){
  console.error('使い方: node tools/measure_layout.mjs <断片HTML> [--box <セレクタ>] [--sizes 667x375,812x375] [--shot 出力.png]');
  process.exit(1);
}

let chromium;
try{ ({ chromium } = await import('playwright')); }
catch{
  console.error('playwrightが見つかりません。作業用ディレクトリで `npm i playwright` してから実行してください。');
  console.error('(このリポジトリにはnode_modulesを置かないこと)');
  process.exit(1);
}

// 既定はこのツールの1つ上(=リポジトリ直下)のstyle.css。
// playwrightを入れた別ディレクトリから動かすときは --css で渡す。
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const css = fs.readFileSync(opt('css', path.join(root, 'style.css')), 'utf8');
const body = fs.readFileSync(fixture, 'utf8');
const sizes = opt('sizes', '667x375,812x375').split(',').map(s => s.split('x').map(Number));
const boxSel = opt('box', null);
const shot = opt('shot', null);

// 実機と同じ条件になるよう style.css をそのまま当てる。
// html,body が position:fixed なので、枠の外側にラッパーは挟まない。
const page = `<!doctype html><meta charset="utf-8"><style>${css}</style>${body}`;
const tmp = path.join(path.dirname(path.resolve(fixture)), '.measure_layout.tmp.html');
fs.writeFileSync(tmp, page);

/* Chromiumの場所。playwrightが自前で持っていない環境用に、
   --exe / 環境変数 CHROMIUM_PATH / よくある置き場 の順で探す。 */
const exe = opt('exe', process.env.CHROMIUM_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
try{
  for(const [w, h] of sizes){
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const errors = [];
    p.on('pageerror', e => errors.push(String(e)));
    await p.goto('file://' + tmp);
    await p.waitForTimeout(250);   // 画像の読み込み待ち
    const m = await p.evaluate((sel) => {
      const scrollables = [...document.querySelectorAll('*')].filter(el => {
        const st = getComputedStyle(el);
        return /auto|scroll/.test(st.overflowY) && el.scrollHeight > 0;
      });
      const box = sel ? document.querySelector(sel)
                      : scrollables.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if(!box) return { err: 'スクロールする枠が見つかりません(--box で指定してください)' };
      /* 本当に切れているものだけを拾う。overflowがvisibleの要素は、はみ出していても
         描画はされている(レイドの帯のように、わざと隣までせり出す作りもある)。
         切り捨てが起きるのは hidden / clip のときだけ。 */
      const clipped = [...box.querySelectorAll('*')]
        .filter(el => {
          if(el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1) return false;
          const st = getComputedStyle(el);
          return /hidden|clip/.test(st.overflowX) || /hidden|clip/.test(st.overflowY);
        })
        .map(el => (el.className || el.tagName) + ' « ' + (el.textContent || '').trim().slice(0, 20));
      return {
        sel: box.id ? '#' + box.id : (box.className.split(' ')[0] || box.tagName),
        scrollH: box.scrollHeight, viewH: box.clientHeight,
        screens: (box.scrollHeight / box.clientHeight).toFixed(2),
        overflowX: box.scrollWidth > box.clientWidth + 1,
        parts: [...box.children].map(el => ({
          name: (el.className || '').split(' ')[0] || el.id || el.tagName,
          h: Math.round(el.getBoundingClientRect().height),
          txt: (el.textContent || '').trim().slice(0, 18),
        })).sort((a, b) => b.h - a.h),
        clipped,
      };
    }, boxSel);

    console.log(`\n■ ${w}x${h}`);
    if(m.err){ console.log('  ' + m.err); await p.close(); continue; }
    console.log(`  枠 ${m.sel}  総高${m.scrollH} / 表示${m.viewH} = ${m.screens}画面ぶん`
      + `  横はみ出し:${m.overflowX ? 'あり(NG)' : 'なし'}`);
    console.log('  高さの内訳(大きい順。ここを削るとスクロールが減る)');
    for(const r of m.parts) console.log(`    ${String(r.h).padStart(4)}px  ${r.name.padEnd(22)} ${r.txt}`);
    if(m.clipped.length){
      console.log(`  ⚠ 見切れ ${m.clipped.length}件`);
      for(const c of m.clipped.slice(0, 8)) console.log('    ' + c);
    } else {
      console.log('  見切れ なし');
    }
    if(errors.length) console.log('  ⚠ ページ内エラー: ' + errors[0]);
    if(shot && w === sizes[0][0]) await p.screenshot({ path: shot });
    await p.close();
  }
} finally {
  await browser.close();
  fs.unlinkSync(tmp);
}
