/* 未定義の識別子(どのスコープからも解決できない名前)を探す検査。開発用でゲームには読み込まない。

   使い方: node tools/undef_check.mjs
   acorn が要る(グローバル、または ARAMON_TOOL_MODULES=<node_modulesの場所> で渡す)。
   見つからないときは黙って何もせず終わる(通常の作業を止めないため)。

   ── なぜ要るか ─────────────────────────────────────────────
   2026-08-23、「部屋を作る」が必ず失敗した。原因は firebase.js で
     window.__aramonCreateRoom = async function(..., mapPick){ return createRoomInner(..., sub); }
     async function createRoomInner(..., sub){ ... mapPick: mapPick||null ... }   ← mapPick を受け取っていない
   という**引数の渡し忘れ**。ESモジュールは常に strict なので `mapPick` の参照は ReferenceError になる。
   `node --check` は構文しか見ないのでこの型の事故を必ず素通しする。**そこを塞ぐのがこの検査。**

   ── 何を見るか ─────────────────────────────────────────────
   ・識別子の参照を1つずつ、その場所のスコープから外側へ順にたどって解決できるか調べる。
     「外側の関数に同じ名前の引数がある」ことを**宣言済みとみなさない**(上の事故を見逃した理由がそれ)。
   ・classic script(index.html が <script src> で読むもの)は互いにグローバルを共有するので、
     **全ファイルのトップレベル宣言と window.X = … を先に集めてから**照合する。集めないと誤検知だらけになる。
   ・index.html の中に直接書いてあるスクリプトも同じように読む(そこで定義された関数を他が呼ぶため)。
   ・sw.js は Service Worker、tools/ は Node なので、それぞれの環境の名前を足して見る。       */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let acorn = null;
try { acorn = await import('acorn'); }
catch {
  // lobby_layout_test.mjs と同じ探し方。ARAMON_TOOL_MODULES で場所を渡すこともできる
  const bases = [process.env.ARAMON_TOOL_MODULES, '/opt/node22/lib/node_modules/',
                 '/usr/lib/node_modules/', '/usr/local/lib/node_modules/'].filter(Boolean)
                 .map((p)=> p.endsWith('/') ? p : p + '/');
  for(const b of bases){ try { acorn = createRequire(b)('acorn'); break; } catch {} }
}
if(!acorn){
  console.log('acorn が見つからないので未定義チェックは省略しました(npm i -g acorn か ARAMON_TOOL_MODULES=… )。');
  process.exit(0);
}
const parse = acorn.parse || acorn.default.parse;

/* ===== 環境ごとの「元からある名前」=====
   ここに無いものを足したいときは、**その環境の実物にある名前だけ**を足すこと。
   迷ったら足さずに指摘として見る(黙って通すより、1行増えるほうが安い)。 */
const ES_GLOBALS = `
Object Function Array Number Boolean String Symbol Date RegExp Error EvalError RangeError ReferenceError
SyntaxError TypeError URIError AggregateError JSON Math Map Set WeakMap WeakSet WeakRef FinalizationRegistry
Promise Proxy Reflect ArrayBuffer SharedArrayBuffer DataView Int8Array Uint8Array Uint8ClampedArray Int16Array
Uint16Array Int32Array Uint32Array Float32Array Float64Array BigInt BigInt64Array BigUint64Array Atomics
Intl globalThis NaN Infinity undefined eval isNaN isFinite parseInt parseFloat encodeURI encodeURIComponent
decodeURI decodeURIComponent escape unescape structuredClone queueMicrotask console arguments`.split(/\s+/);

const DOM_GLOBALS = `
window document navigator location history screen alert confirm prompt localStorage sessionStorage indexedDB
setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame requestIdleCallback
fetch Request Response Headers FormData URL URLSearchParams Blob File FileReader AbortController AbortSignal
Image Audio Video HTMLElement HTMLCanvasElement HTMLImageElement HTMLInputElement Element Node NodeList Text
Event CustomEvent PointerEvent MouseEvent TouchEvent KeyboardEvent WheelEvent MessageEvent ErrorEvent
CanvasRenderingContext2D Path2D ImageData OffscreenCanvas createImageBitmap matchMedia getComputedStyle
devicePixelRatio innerWidth innerHeight visualViewport performance crypto atob btoa TextEncoder TextDecoder
WebGLRenderingContext WebGL2RenderingContext AudioContext webkitAudioContext OscillatorNode GainNode
MediaRecorder MediaStream RTCPeerConnection RTCSessionDescription RTCIceCandidate WebSocket EventSource
IntersectionObserver ResizeObserver MutationObserver customElements DOMParser XMLHttpRequest
speechSynthesis SpeechSynthesisUtterance Notification ServiceWorker ServiceWorkerRegistration
CSS CSSStyleDeclaration DocumentFragment ShadowRoot Range Selection Worker SharedWorker BroadcastChannel
DOMMatrix DOMMatrixReadOnly DOMPoint DOMRect DOMRectReadOnly WakeLock ImageBitmap
open close scrollTo scrollBy print top parent self frames name status onerror`.split(/\s+/);

const SW_GLOBALS = `self caches clients skipWaiting registration importScripts FetchEvent ExtendableEvent
addEventListener removeEventListener fetch Response Request Headers Cache CacheStorage URL`.split(/\s+/);

const NODE_GLOBALS = `process Buffer __dirname __filename require module exports global setImmediate
clearImmediate TextEncoder TextDecoder URL URLSearchParams fetch AbortController`.split(/\s+/);

/* 外から差し込まれる名前(このリポジトリのどこにも宣言が無いが、実行時には存在する)。
   **黙って足さない。** 何が差し込むのかを必ず書く。 */
const INJECTED = {
  __netProbe:      '計測ハーネス(tools/net_probe.html)が親フレームから入れる。使う側は必ず window.__netProbe で確認してから読む',
  __netProbeInput: '同上(外部から操作を流し込むための入口)',
  __netProbeSeed:  '同上(乱数の種を固定するため)',
};

/* ===== 調べるファイル =====
   vendor/ は外部ライブラリなので見ない。tools/ は開発用だが、ここも壊れると気づけないので見る。 */
const SKIP_DIRS = new Set(['vendor', 'node_modules', '.git', 'monsters', 'images', 'audio', 'video', 'guide']);
function listJs(dir, out = []){
  for(const name of fs.readdirSync(dir)){
    // 隠しディレクトリ(.git / .claude の作業用コピーなど)は見ない
    if(name.startsWith('.') || SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if(st.isDirectory()){ listJs(p, out); continue; }
    if(/\.m?js$/.test(name)) out.push(p);
  }
  return out;
}

/* ===== 1ファイルを読む =====
   classic script として解析し、通らなければ ES モジュールとして解析し直す
   (import/export はモジュールでしか書けないので、これで種類が確実に分かれる)。 */
function parseSource(code, label){
  for(const sourceType of ['script', 'module']){
    try{
      const ast = parse(code, { ecmaVersion:'latest', sourceType, locations:true, allowHashBang:true });
      return { ast, sourceType };
    }catch(err){ if(sourceType === 'module') throw new Error(`${label}: 解析できません — ${err.message}`); }
  }
}

/* ===== スコープ =====
   kind: 'global'(classic scriptが共有する外側) / 'module' / 'function' / 'block' / 'class' */
function makeScope(kind, parent){
  return { kind, parent, names:new Set(), isFunc: kind==='function' || kind==='module' || kind==='global' };
}
function declare(scope, name){ if(name) scope.names.add(name); }

// 分割代入・省略値・残余をたどって「束縛される名前」を全部出す
function patternNames(node, out = []){
  if(!node) return out;
  switch(node.type){
    case 'Identifier': out.push(node.name); break;
    case 'ObjectPattern': for(const p of node.properties) patternNames(p.type==='RestElement' ? p : p.value, out); break;
    case 'ArrayPattern': for(const e of node.elements) patternNames(e, out); break;
    case 'AssignmentPattern': patternNames(node.left, out); break;
    case 'RestElement': patternNames(node.argument, out); break;
    case 'Property': patternNames(node.value, out); break;
    default: break;
  }
  return out;
}

// 子ノードを順に返す(参照として見てはいけない場所はここで落とす)
const SKIP_KEYS = {
  MemberExpression: (n)=> n.computed ? [] : ['property'],
  Property: (n)=> n.computed ? [] : ['key'],
  MethodDefinition: (n)=> n.computed ? [] : ['key'],
  PropertyDefinition: (n)=> n.computed ? [] : ['key'],
  LabeledStatement: ()=> ['label'],
  BreakStatement: ()=> ['label'],
  ContinueStatement: ()=> ['label'],
  ImportSpecifier: ()=> ['imported'],
  ExportSpecifier: ()=> ['exported'],
  MetaProperty: ()=> ['meta','property'],
};
function children(node){
  const skip = SKIP_KEYS[node.type] ? SKIP_KEYS[node.type](node) : [];
  const out = [];
  for(const key of Object.keys(node)){
    if(key==='type' || key==='loc' || key==='start' || key==='end' || key==='range') continue;
    if(skip.includes(key)) continue;
    const v = node[key];
    if(Array.isArray(v)){ for(const c of v) if(c && typeof c.type === 'string') out.push(c); }
    else if(v && typeof v.type === 'string') out.push(v);
  }
  return out;
}

const isFunc = (n)=> n && (n.type==='FunctionDeclaration' || n.type==='FunctionExpression' || n.type==='ArrowFunctionExpression');

/* var と関数宣言を、その関数スコープへ引き上げる。
   **入れ子の関数の中には入らない**(そちらは自分の関数スコープを持つ)。 */
function hoistVars(node, scope){
  for(const c of children(node)){
    if(isFunc(c)){
      // 入れ子の関数宣言は「名前だけ」外側に見える(sloppyのブロック内関数も含め、緩めに登録する)
      if(c.type==='FunctionDeclaration' && c.id) declare(scope, c.id.name);
      continue;
    }
    if(c.type==='ClassDeclaration' || c.type==='ClassExpression') continue;
    if(c.type==='VariableDeclaration' && c.kind==='var'){
      for(const d of c.declarations) for(const n of patternNames(d.id)) declare(scope, n);
    }
    hoistVars(c, scope);
  }
}
// そのブロックに直接ぶら下がる let / const / class / function を登録する
function hoistBlock(body, scope){
  for(const st of body || []){
    if(!st) continue;
    if(st.type==='VariableDeclaration' && st.kind!=='var'){
      for(const d of st.declarations) for(const n of patternNames(d.id)) declare(scope, n);
    } else if(st.type==='ClassDeclaration' && st.id){ declare(scope, st.id.name); }
    else if(st.type==='FunctionDeclaration' && st.id){ declare(scope, st.id.name); }
    else if(st.type==='ImportDeclaration'){
      for(const sp of st.specifiers) declare(scope, sp.local.name);
    } else if(st.type==='ExportNamedDeclaration' && st.declaration){ hoistBlock([st.declaration], scope); }
    else if(st.type==='ExportDefaultDeclaration' && st.declaration && st.declaration.id){ declare(scope, st.declaration.id.name); }
  }
}

/* ファイルを1つ調べる。onRef(name, node) で参照を1つずつ渡す(解決できたかは呼ぶ側が持つ集合で決める) */
function walkFile(ast, sourceType, topScope, onUnresolved, resolvedBy){
  const rootKind = sourceType==='module' ? 'module' : 'block';   // classic script のトップレベルは共有の global の内側
  const root = makeScope(rootKind, topScope);
  if(rootKind==='block') root.isFunc = true;   // var もここに載る(共有globalは別に集めてある)
  hoistBlock(ast.body, root);
  hoistVars(ast, root);

  const resolve = (name, scope)=>{
    for(let s = scope; s; s = s.parent) if(s.names.has(name)) return true;
    return resolvedBy.has(name);
  };

  const visit = (node, scope)=>{
    if(!node) return;
    switch(node.type){
      case 'Identifier':
        if(!resolve(node.name, scope)) onUnresolved(node.name, node);
        return;
      /* `typeof X` は X が無くても落ちない**唯一の**書き方で、「あるかどうか調べる」ための正しい形。
         ここを指摘すると、機能があるかを調べているだけの箇所が全部引っかかる。 */
      case 'UnaryExpression':
        if(node.operator === 'typeof' && node.argument.type === 'Identifier') return;
        visit(node.argument, scope);
        return;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': {
        const fs2 = makeScope('function', scope);
        if(node.type==='FunctionExpression' && node.id) declare(fs2, node.id.name);
        declare(fs2, 'arguments');
        // 既定値の式は関数スコープの中で評価される(先の引数を参照できる)
        for(const p of node.params){ for(const n of patternNames(p)) declare(fs2, n); }
        for(const p of node.params) visit(p, fs2);
        if(node.body.type === 'BlockStatement'){
          hoistBlock(node.body.body, fs2);
          hoistVars(node.body, fs2);
          for(const st of node.body.body) visit(st, fs2);
        } else visit(node.body, fs2);
        return;
      }
      case 'ClassDeclaration': case 'ClassExpression': {
        const cs = makeScope('class', scope);
        if(node.id) declare(cs, node.id.name);
        if(node.superClass) visit(node.superClass, cs);
        visit(node.body, cs);
        return;
      }
      case 'BlockStatement': {
        const bs = makeScope('block', scope);
        hoistBlock(node.body, bs);
        for(const st of node.body) visit(st, bs);
        return;
      }
      case 'StaticBlock': {
        const bs = makeScope('block', scope);
        hoistBlock(node.body, bs);
        for(const st of node.body) visit(st, bs);
        return;
      }
      case 'SwitchStatement': {
        visit(node.discriminant, scope);
        const bs = makeScope('block', scope);
        for(const c of node.cases) hoistBlock(c.consequent, bs);
        for(const c of node.cases){ if(c.test) visit(c.test, bs); for(const st of c.consequent) visit(st, bs); }
        return;
      }
      case 'ForStatement': {
        const bs = makeScope('block', scope);
        if(node.init && node.init.type==='VariableDeclaration' && node.init.kind!=='var') hoistBlock([node.init], bs);
        for(const k of ['init','test','update','body']) if(node[k]) visit(node[k], bs);
        return;
      }
      case 'ForInStatement': case 'ForOfStatement': {
        const bs = makeScope('block', scope);
        if(node.left.type==='VariableDeclaration' && node.left.kind!=='var') hoistBlock([node.left], bs);
        visit(node.right, bs); visit(node.left, bs); visit(node.body, bs);
        return;
      }
      case 'CatchClause': {
        const bs = makeScope('block', scope);
        if(node.param) for(const n of patternNames(node.param)) declare(bs, n);
        hoistBlock(node.body.body, bs);
        for(const st of node.body.body) visit(st, bs);
        return;
      }
      case 'VariableDeclarator': {
        // 左辺は宣言なので参照として数えない。既定値・初期化式だけを見る
        if(node.id.type !== 'Identifier') visitPatternDefaults(node.id, scope);
        if(node.init) visit(node.init, scope);
        return;
      }
      default: break;
    }
    for(const c of children(node)) visit(c, scope);
  };
  // 分割代入の中の「既定値の式」と「計算されたキー」は参照
  const visitPatternDefaults = (node, scope)=>{
    if(!node) return;
    switch(node.type){
      case 'AssignmentPattern': visitPatternDefaults(node.left, scope); visit(node.right, scope); return;
      case 'ObjectPattern':
        for(const p of node.properties){
          if(p.type==='RestElement'){ visitPatternDefaults(p.argument, scope); continue; }
          if(p.computed) visit(p.key, scope);
          visitPatternDefaults(p.value, scope);
        }
        return;
      case 'ArrayPattern': for(const e of node.elements) visitPatternDefaults(e, scope); return;
      case 'RestElement': visitPatternDefaults(node.argument, scope); return;
      default: return;
    }
  };

  for(const st of ast.body) visit(st, root);
}

/* ===== index.html の中に直接書いてあるスクリプトも取り出す ===== */
function inlineScripts(html){
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while((m = re.exec(html))){
    const attrs = m[1] || '';
    if(/\bsrc\s*=/.test(attrs)) continue;              // 外部ファイルは別途読む
    const line = html.slice(0, m.index).split('\n').length;
    out.push({ code: m[2], line, module: /type\s*=\s*["']module["']/.test(attrs) });
  }
  return out;
}

/* ===== 全ファイルのトップレベル宣言と window.X = … を集める ===== */
function collectGlobals(ast, into, opts){
  const isModule = opts.sourceType === 'module';
  if(!isModule) hoistBlock(ast.body, { names:into });    // トップレベルの let/const/class/function
  if(!isModule) hoistVars(ast, { names:into });          // トップレベルの var
  // window.X = … / globalThis.X = … / self.X = … はどこに書いてあってもグローバルを作る
  const scan = (node)=>{
    if(node.type==='AssignmentExpression' && node.left.type==='MemberExpression' && !node.left.computed){
      const o = node.left.object;
      if(o.type==='Identifier' && (o.name==='window' || o.name==='globalThis' || o.name==='self')){
        into.add(node.left.property.name);
      }
    }
    /* 【宣言なしの代入を「グローバルを作った」と見なさない】sloppy mode では実際に作られてしまうが、
       それを認めると **打ち間違いの代入がそのまま正しい名前として通ってしまう**(検査の意味が消える)。
       ここでは数えないので、そういう箇所は下で普通に指摘として出る。 */
    for(const c of children(node)) scan(c);
  };
  scan(ast);
}

// ---------------------------------------------------------------------------
/* コマンドラインでファイルを渡すと、**そのファイルだけを報告する**(グローバルはリポジトリ全体から集める)。
   この検査そのものが効いていることを、わざと壊した版で確かめるために使う。
   例: node tools/undef_check.mjs /tmp/firebase_broken.js */
const TARGETS = process.argv.slice(2).filter((a)=> !a.startsWith('-'));

const files = listJs(ROOT).sort();
const sources = [];
for(const f of files){
  const rel = path.relative(ROOT, f);
  const code = fs.readFileSync(f, 'utf8');
  const { ast, sourceType } = parseSource(code, rel);
  const env = rel === 'sw.js' ? 'sw' : (rel.startsWith('tools' + path.sep) ? 'node' : 'web');
  sources.push({ rel, ast, sourceType, env });
}
const htmlPath = path.join(ROOT, 'index.html');
if(fs.existsSync(htmlPath)){
  const html = fs.readFileSync(htmlPath, 'utf8');
  for(const s of inlineScripts(html)){
    const label = `index.html:${s.line}`;
    const { ast, sourceType } = parseSource(s.code, label);
    sources.push({ rel: label, ast, sourceType: s.module ? 'module' : sourceType, env:'web', lineBase: s.line - 1 });
  }
}

const shared = new Set([...ES_GLOBALS, ...DOM_GLOBALS, ...Object.keys(INJECTED)]);
for(const s of sources){
  // classic script どうしはグローバルを共有する。モジュールは共有しないが window.X = … だけは効く
  collectGlobals(s.ast, shared, { sourceType: s.sourceType, label: s.rel });
}

// 検証用に渡されたファイルは、グローバルを集め終えたあとで足す(その中身は共有の材料にしない)
const extra = [];
for(const t of TARGETS){
  const p = path.resolve(t);
  const { ast, sourceType } = parseSource(fs.readFileSync(p, 'utf8'), t);
  extra.push({ rel:t, ast, sourceType, env:'web' });
}
const checkList = extra.length ? extra : sources;

const findings = [];
for(const s of checkList){
  const env = new Set(shared);
  if(s.env === 'sw') for(const n of SW_GLOBALS) env.add(n);
  if(s.env === 'node') for(const n of NODE_GLOBALS) env.add(n);
  const top = makeScope('global', null);
  walkFile(s.ast, s.sourceType, top, (name, node)=>{
    findings.push({ file:s.rel, line:(s.lineBase||0) + node.loc.start.line, name });
  }, env);
}

// 同じ名前が同じファイルで何度も出るので、名前×ファイルでまとめる(最初の行を代表に出す)
const grouped = new Map();
for(const f of findings){
  const k = `${f.file} ${f.name}`;
  if(!grouped.has(k)) grouped.set(k, { ...f, n:0 });
  grouped.get(k).n++;
}
const list = [...grouped.values()].sort((a,b)=> a.file.localeCompare(b.file) || a.line - b.line);

console.log(extra.length
  ? `未定義チェック(指定された${extra.length}ファイルのみ。グローバルはリポジトリ全体から収集)`
  : `未定義チェック: ${sources.length}個のスクリプト(${files.length}ファイル + index.html内)`);
console.log('  ※ 外から差し込まれる名前として通しているもの: ' + Object.keys(INJECTED).join(', '));
if(!list.length){ console.log('\n== どのスコープからも解決できない識別子は 0 件 =='); process.exit(0); }
console.log(`\n== 解決できない識別子 ${list.length}件 ==`);
for(const f of list) console.log(`  ${f.file}:${f.line}  ${f.name}${f.n>1 ? `  (計${f.n}か所)` : ''}`);
process.exit(1);
