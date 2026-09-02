/* tools/studio_web.html の中の関数を node から呼べるようにするローダ(開発用・ゲームには読み込まない)。

   なぜ要るか:
     スタジオは HTML 1枚に全部入っている。中の `renderRows` / `buildMoves` / `segment` /
     `detectPeriod` は「出力を変えない」ことを守りたい所なのに、ブラウザを起こさないと
     1行も呼べなかった。ここで <script> を抜き出して node の vm で評価し、関数だけを取り出す。

   使い方:
     import { loadStudio } from './studio_load.mjs';
     const S = loadStudio();
     S.renderRows(spec, S.buildMoves(spec), false);
     S.segment({ width, height, data: new Uint8ClampedArray(w*h*4) }, 'chroma', 60, [0,255,0]);

   決まりごと:
     ・DOM は最小のスタブ。`$(id)` は **HTML に実在する id** にだけ「要素風の入れ物」を返し、
       無い id には本物と同じく null を返す(存在しない id を掴んでいる箇所をここで見つけられる)。
     ・`boot()` は呼ばない(トップレベルの `boot();` の1行だけを読み飛ばす)。
       それ以外のトップレベルの副作用(`addEventListener` の登録)はスタブが黙って吸う。
     ・fetch / XMLHttpRequest は必ず投げる。検査が知らないうちに外へ出ないようにするため。
     ・**取り出せなかった名前は黙って undefined にしない。** REQUIRED は例外にし、
       OPTIONAL(将来消える予定の関数)は戻り値の `__missing` に名前を残す。            */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STUDIO_HTML = path.join(__dirname, 'studio_web.html');

/* 取り出す名前。REQUIRED が1つでも欠けたらエラーで止める。 */
const REQUIRED = [
  // 行の生成(9表への書き出し)
  'renderRows', 'buildMoves', 'jsMove', 'jsStr', 'jsNum', 'jsValue', 'pad', 'scTriggerValue',
  'traitOnHitOf', 'applyRows', 'revertRows', 'traitExistsIn', 'addUpdateHistory', 'todayYmd',
  'bumpCache', 'capLobbyBanners',
  // 背景の抜き方
  'segment', 'keyDistance', 'segLowThreshold', 'despillInPlace', 'keepLargest', 'dropSpecks',
  'fillSmallHoles', 'borderConnected', 'label4', 'blur3', 'min3', 'erode2', 'dilate2', 'bboxOf',
  'cornerRgbs', 'cornerRgb', 'cornerHint', 'tightenEdge', 'SEG_EDGE_MIN',
  // 背景の抜き方(モデル)。呼び分けは resolveAlpha 1か所
  'segmentModel', 'resolveAlpha', 'imageAlphaFor', 'keepMajor', 'releaseSegmentModel',
  'MODEL_SRC', 'MODEL_CACHE', 'MODEL_INPUT', 'MODEL_FG_MIN', 'MODEL_KEEP_RATIO', 'MODEL_FALLBACK',
  // 動画・周期
  'detectPeriod', 'grayDiff',
  // data.js を読む側
  'pickObjText', 'pickStr', 'pickNum', 'numExpr', 'parseSkinMedia', 'parseStateChanges',
  'skinMediaRange', 'removeSkinMediaEntry',
  // 値の走査器(登録済みを開いて直す・書き戻しの土台。置換はすべてここを通る)
  'skipDeadAt', 'inDeadZone', 'skipGapAt', 'scanValue', 'pickEntry',
  'findFieldInObject', 'replaceFieldInObject', 'replaceField', 'moveObjectRange', 'replaceMoveField',
  // 更新履歴の注意2判定(changelog_check.mjs と二重に持つ)
  'changelogWarnings', 'changelogWords', 'changelogSimilarity',
  'CHANGELOG_SIMILAR', 'CHANGELOG_INTERNAL',
  // 定数(検査側で二重に持たないため、必ずここから読む)
  'MOVE_T1', 'MOVE_T2', 'TIER3', 'JS_ORDER', 'TABLES', 'TABLE_FILE',
  'SEG_SOFT', 'SEG_SPECK', 'ANALYZE_N', 'CAND_N', 'WORK_H', 'CANVAS', 'TARGET_H', 'FEET_Y',
  'WALK_FRAME_DUR', 'PERIOD_BAND', 'PERIOD_PEAK_MIN', 'PERIOD_DIP_MAX', 'MOVE_MIN_DIFF',
  'ICONS', 'AURAS', 'RANKS', 'STATS', 'SKIN_COLOR_ORDER', 'SC_TRIGGERS', 'SC_EFFECTS',
  'MEDIA_ITEMS', 'state',
];
/* 将来の改修(設計仕様 §2 A5 の「1枚の絵から動かす」削除)で消える予定のもの。
   欠けても止めないが、戻り値の `__missing` に名前が残る。 */
const OPTIONAL = [
  'renderSsrRows', 'applySsrWalk', 'applyRaidConsts', 'skinMediaLines',
  'fitScale', 'sampleHue', 'chamferDist', 'detectParts', 'protrusionsAt', 'partMotion',
  'MOT', 'PART_SCALES', 'PART_MIN_ELONG', 'RIG_GROW', 'RIG_PATCH', 'BORDER_INSETS',
  'TPL_HINT', 'AWAKEN_FX_DEFAULT', 'TRAIT_ON_HIT_KEYS',
];

/* --------------------------------------------------------------- DOM スタブ */
function styleStub(){
  return new Proxy({}, { get:(t,k)=> (k in t ? t[k] : ''), set:(t,k,v)=>{ t[k]=v; return true; } });
}
function elementStub(id, doc){
  const el = {
    id, tagName:'DIV', value:'', textContent:'', innerHTML:'', innerText:'', className:'',
    checked:false, disabled:false, files:null, src:'', width:0, height:0,
    style: styleStub(), dataset:{}, children:[], parentNode:null,
    classList:{ add(){}, remove(){}, toggle(){}, contains:()=>false },
    addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true; },
    appendChild(c){ el.children.push(c); return c; }, removeChild(){}, insertAdjacentHTML(){},
    setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){}, focus(){}, blur(){}, click(){},
    scrollIntoView(){}, closest(){ return null; },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    getBoundingClientRect(){ return { x:0, y:0, top:0, left:0, right:0, bottom:0, width:0, height:0 }; },
    getContext(){ return doc.__ctx2d(); },
    toBlob(cb){ cb && cb(null); }, toDataURL(){ return 'data:,'; },
  };
  return el;
}
function ctx2dStub(){
  const noop = ()=>{};
  return {
    canvas:null, globalAlpha:1, globalCompositeOperation:'source-over', fillStyle:'#000',
    strokeStyle:'#000', lineWidth:1, filter:'none', font:'', textAlign:'left', textBaseline:'top',
    imageSmoothingEnabled:true, shadowBlur:0, shadowColor:'transparent',
    save:noop, restore:noop, translate:noop, rotate:noop, scale:noop, transform:noop, setTransform:noop,
    beginPath:noop, closePath:noop, moveTo:noop, lineTo:noop, arc:noop, rect:noop, ellipse:noop,
    fill:noop, stroke:noop, clip:noop, fillRect:noop, clearRect:noop, strokeRect:noop, fillText:noop,
    drawImage:noop, putImageData:noop,
    createImageData:(w,h)=> ({ width:w, height:h, data:new Uint8ClampedArray(w*h*4) }),
    getImageData:(x,y,w,h)=> ({ width:w, height:h, data:new Uint8ClampedArray(w*h*4) }),
    createLinearGradient:()=> ({ addColorStop:noop }),
    createRadialGradient:()=> ({ addColorStop:noop }),
    measureText:()=> ({ width:0 }),
  };
}
// HTML に書かれている id を集める(存在しない id を掴んでいたら null が返って露見する)
function idsIn(html){
  const out = new Set();
  for(const m of html.matchAll(/\bid="([^"]+)"/g)) out.add(m[1]);
  return out;
}
function makeDocument(ids){
  const cache = new Map();
  const doc = {
    __ctx2d: ctx2dStub,
    getElementById(id){
      id = String(id);
      if(!ids.has(id)) return null;             // 本物と同じ。存在しない id は null
      if(!cache.has(id)) cache.set(id, elementStub(id, doc));
      return cache.get(id);
    },
    createElement(tag){ return elementStub('', doc, tag); },
    createElementNS(){ return elementStub('', doc); },
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    addEventListener(){}, removeEventListener(){},
    __ids: ids, __cache: cache,
  };
  doc.body = elementStub('body', doc);
  doc.head = elementStub('head', doc);
  doc.documentElement = elementStub('html', doc);
  return doc;
}
function memStorage(){
  const mem = new Map();
  return {
    getItem: k => mem.has(String(k)) ? mem.get(String(k)) : null,
    setItem: (k,v)=> { mem.set(String(k), String(v)); },
    removeItem: k => { mem.delete(String(k)); },
    clear: ()=> mem.clear(),
    key: i => Array.from(mem.keys())[i] ?? null,
    get length(){ return mem.size; },
  };
}
function netBlocked(name){
  return (...a)=> { throw new Error(`studio_load: ${name} は検査では使えません(引数: ${JSON.stringify(a[0] ?? null)})`); };
}

/* --------------------------------------------------------------- 本体 */
export function extractScript(html){
  const m = /<script>([\s\S]*?)<\/script>/.exec(html);
  if(!m) throw new Error('studio_load: studio_web.html に <script> が見つかりません');
  if(/<script[ >]/.test(html.slice(m.index + m[0].length)))
    throw new Error('studio_load: <script> が2つ以上あります。抜き出す規則を見直してください');
  return m[1];
}
// トップレベルの `boot();` の1行だけを読み飛ばす(画面の組み立ては検査に要らない)
export function stripBoot(src){
  const rx = /^boot\(\);[ \t]*$/m;
  if(!rx.test(src)) throw new Error('studio_load: トップレベルの boot(); が見つかりません(呼び出し方が変わった?)');
  return src.replace(rx, '/* studio_load: boot() は呼ばない */');
}

export function loadStudio(opt = {}){
  const file = opt.file || STUDIO_HTML;
  const html = fs.readFileSync(file, 'utf8');
  const src  = stripBoot(extractScript(html));

  const document = makeDocument(idsIn(html));
  const sandbox = {
    document,
    localStorage: memStorage(),
    sessionStorage: memStorage(),
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    queueMicrotask,
    requestAnimationFrame: cb => setTimeout(()=> cb(Date.now()), 0),
    cancelAnimationFrame: id => clearTimeout(id),
    performance: { now: ()=> Date.now() },
    navigator: { userAgent:'studio_load', mediaDevices:{}, clipboard:{} },
    location: { href:'file://studio_web.html', search:'', origin:'null' },
    fetch: netBlocked('fetch'),
    XMLHttpRequest: function(){ throw new Error('studio_load: XMLHttpRequest は検査では使えません'); },
    alert(){}, confirm(){ return false; }, prompt(){ return null; },
    atob: s => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: s => Buffer.from(String(s), 'binary').toString('base64'),
    URL, URLSearchParams, TextEncoder, TextDecoder, Blob: globalThis.Blob,
    Image: class ImageStub { constructor(){ this.src=''; this.width=0; this.height=0; }
                             addEventListener(){} removeEventListener(){} },
    ImageData: class ImageDataStub {
      constructor(a, b, c){
        if(typeof a === 'number'){ this.width=a; this.height=b; this.data=new Uint8ClampedArray(a*b*4); }
        else { this.data=a; this.width=b; this.height=c ?? (a.length/4/b); }
      } },
    FileReader: class FileReaderStub { readAsDataURL(){} readAsArrayBuffer(){} addEventListener(){} },
    MediaRecorder: function(){ throw new Error('studio_load: MediaRecorder は検査では使えません'); },
    AudioContext: function(){ throw new Error('studio_load: AudioContext は検査では使えません'); },
    createImageBitmap: netBlocked('createImageBitmap'),
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  /* opt.extra = 「あるかどうかを知りたいだけ」の名前(欠けても止めない)。
     HTML の onclick= 等から呼ばれる関数が本当に定義されているかを検査するために使う
     (名前は HTML から集めるので、REQUIRED に固定で書けない)。 */
  const extra = (opt.extra || []).filter(n => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n));
  const names = REQUIRED.concat(OPTIONAL, extra);
  // 名前を1つずつ「あれば入れる」形で集める(未定義でも ReferenceError にならないように)
  const collect = names.map(n =>
    `  try{ __picked[${JSON.stringify(n)}] = ${n}; }catch(e){}`).join('\n');
  const script = `${src}\n;var __picked = {};\n(function(){\n${collect}\n})();\n__picked;`;

  let picked;
  try { picked = vm.runInContext(script, ctx, { filename: file, displayErrors: true }); }
  catch(e){ throw new Error(`studio_load: studio_web.html の評価に失敗しました — ${e && e.message}`); }

  const missingReq = REQUIRED.filter(n => picked[n] === undefined);
  if(missingReq.length)
    throw new Error('studio_load: 取り出せなかった名前があります(REQUIRED): ' + missingReq.join(', '));
  const missingOpt = OPTIONAL.filter(n => picked[n] === undefined);

  const out = {};
  for(const n of names) if(picked[n] !== undefined) out[n] = picked[n];
  out.__missing = missingOpt;   // OPTIONAL のうち今の studio_web.html に無かった名前
  out.__missingExtra = extra.filter(n => picked[n] === undefined);   // opt.extra のうち定義が無かった名前
  out.__file = file;
  out.__document = document;    // 検査から $() の掴んだ要素を覗きたいとき用
  out.__sandbox = sandbox;
  return out;
}

/* ImageData 互換の入れ物。`segment()` は width/height/data しか見ないので、これで足りる。 */
export function mkImageData(w, h, fill){
  const data = new Uint8ClampedArray(w*h*4);
  if(fill) for(let i=0;i<w*h;i++){ const p=i*4;
    data[p]=fill[0]; data[p+1]=fill[1]; data[p+2]=fill[2]; data[p+3]=fill[3]==null?255:fill[3]; }
  return { width:w, height:h, data };
}

// 単体で叩いたときは取り出せた名前を並べる: node tools/studio_load.mjs
if(process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))){
  const S = loadStudio();
  const got = Object.keys(S).filter(k => !k.startsWith('__'));
  console.log(`studio_web.html から ${got.length} 個を取り出しました`);
  console.log(got.join(' '));
  if(S.__missing.length) console.log('OPTIONAL で見つからなかったもの: ' + S.__missing.join(', '));
}
