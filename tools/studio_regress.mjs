/* モンスター作成スタジオ(tools/studio_web.html)の回帰検査(開発用・ゲームには読み込まない)。

   何を守るか(設計仕様 §7):
     スタジオを改修するとき、**今すでに出ている出力を変えない**こと。
     (a) 行生成   monsters/specs/*.json すべてで buildMoves → renderRows / renderSsrRows の出力を文字列比較
     (b) 背景抜き 既知の合成画像に segment() を掛けた alpha(と、デスピルで書き換わる色)のハッシュ
     (c) 周期検出 合成した周期信号を detectPeriod() に入れて返る周期
     (d) 往復     data.js の全21体で pickEntry の取り出しが元と一致し、1項目だけ変えると
                  変わる行がその1行だけ・評価した値が意図どおり(設計仕様 §11 [11][12][13][27])
     (e) 属性     studio_web.html の onclick= 等から呼ばれる関数がすべて定義されている(§11 [17])
     (f) 技名     data.js の全技名が MOVE_AURA のキーにあり、pickEntry で取れる(§11 [14])
     (g) 更新履歴 changelogWarnings(ツール側)と changelog_check.mjs が同じ警告を出す(§11 [39])
     (h) 開いて直す 全21体+全SSRを「開く→1項目だけ変える→書き戻す」で、変わる行がその行だけ・
                  評価した値が意図どおり・意図しない差分がゼロ(§5 D・§11 D [27])
     (i) SE       combat.js の MOVE_SE_BY_STYLE の値と data.js の seStyle が全部
                  スタジオの SE_FALLBACK に入っている(二重に持っている一覧のずれ)

   使い方:
     node tools/studio_regress.mjs --update   ゴールデン(tools/_golden/)を作り直す
     node tools/studio_regress.mjs            ゴールデンと比べる(違えば終了コード1)
     node tools/studio_regress.mjs --only rows|segment|model|period|roundtrip|handlers|moveaura|changelog|edit|se   項目を絞る

   決まりごと:
     ・ゴールデンは生成物だが**比較の相手なので git で追跡する**(.gitignore に入れない)。
     ・合成画像は monsters/*.png から**乱数を使わずに**作る。PNG のデコードは python3(Pillow)に任せ、
       RGBA の生バイトを受け取る(node 側に自前のデコーダを置かない)。                    */
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadStudio } from './studio_load.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT   = path.resolve(__dirname, '..');
const GOLDEN = path.join(__dirname, '_golden');

const args   = process.argv.slice(2);
const UPDATE = args.includes('--update');
const SHOW   = args.includes('--diff');       // (d) の必須ケースの変更行を実際に並べる
const ONLY   = (()=>{ const i = args.indexOf('--only'); return i >= 0 ? args[i+1] : null; })();
const want   = name => !ONLY || ONLY === name;

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
const failures = [];
const notes = [];
const fail = (item, msg) => failures.push(`${item}: ${msg}`);

const S = loadStudio();
if(S.__missing.length) notes.push('studio_web.html に無かった名前(OPTIONAL): ' + S.__missing.join(', '));

/* 保存してあるゴールデンと文字列で比べる。--update のときは書く。 */
function compare(item, file, text){
  if(UPDATE){
    fs.mkdirSync(path.dirname(file), { recursive:true });
    fs.writeFileSync(file, text);
    return true;
  }
  if(!fs.existsSync(file)){
    fail(item, `ゴールデンがありません(${path.relative(ROOT, file)})。--update で作ってください`);
    return false;
  }
  const old = fs.readFileSync(file, 'utf8');
  if(old === text) return true;
  fail(item, 'ゴールデンと違います\n' + firstDiff(old, text));
  return false;
}
function firstDiff(a, b){
  const A = a.split('\n'), B = b.split('\n');
  for(let i=0; i<Math.max(A.length, B.length); i++){
    if(A[i] !== B[i])
      return `    ${i+1}行目\n      ゴールデン: ${A[i] === undefined ? '(無し)' : A[i]}\n      いま      : ${B[i] === undefined ? '(無し)' : B[i]}`;
  }
  return '    (行の数だけが違います)';
}
// ゴールデンの側にあって今は作られなかったもの(spec を消したときに気づけるように)
function checkExtra(item, dir, made){
  if(UPDATE || !fs.existsSync(dir)) return;
  for(const f of fs.readdirSync(dir))
    if(!made.has(f)) fail(item, `もう作られないゴールデンが残っています: ${path.relative(ROOT, path.join(dir, f))}`);
}

/* ------------------------------------------------------------ (a) 行生成 */
function runRows(){
  const dir = path.join(ROOT, 'monsters', 'specs');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const madeMon = new Set(), madeSsr = new Set();
  let n = 0;
  for(const f of files){
    const spec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if(spec.key){
      // traitExists=false 固定。true 側は「TRAIT_DESC を出さない」だけの分岐なので入力を2倍にしない
      let out;
      try { const moves = S.buildMoves(spec); out = { moves, rows: S.renderRows(spec, moves, false) }; }
      catch(e){ fail('rows', `${f} で例外: ${e.message}`); continue; }
      madeMon.add(spec.key + '.json'); n++;
      compare('rows/' + spec.key, path.join(GOLDEN, 'rows', spec.key + '.json'), JSON.stringify(out, null, 1) + '\n');
    } else if(spec.id){
      if(!S.renderSsrRows){ notes.push('renderSsrRows が無いので SSR の行は検査しません'); continue; }
      let rows;
      try { rows = S.renderSsrRows(spec); }
      catch(e){ fail('rows', `${f} で例外: ${e.message}`); continue; }
      madeSsr.add(spec.id + '.json'); n++;
      compare('rows/' + spec.id, path.join(GOLDEN, 'rows_ssr', spec.id + '.json'), JSON.stringify(rows, null, 1) + '\n');
    } else {
      fail('rows', `${f} に key も id もありません`);
    }
  }
  checkExtra('rows', path.join(GOLDEN, 'rows'), madeMon);
  checkExtra('rows', path.join(GOLDEN, 'rows_ssr'), madeSsr);
  return `${n}件`;
}

/* ------------------------------------------------------------ (b) 背景抜き */
const SEG_SIZE = 160;                       // 合成画像の一辺(px)
const SEG_IMAGES = ['joker', 'zan_ssr', 'narga'];
const SEG_BACKS = { black:[0,0,0], white:[255,255,255], green:[0,255,0] };
// 検査の入力値。UI の既定値と同じである必要はない(ここは「決まった入力」であることだけが要る)
const SEG_CASES = [['blackopen', 14], ['black', 14], ['white', 20], ['chroma', 60]];
/* **縁が半透明の1枚**(素通しの枝を通すための入力・§指摘22)。
   `<name>_<bg>_soft.raw` は RGB が `<name>_<bg>.raw` と1bitも同じで、アルファだけが
   元の絵の透過を持つ。segment() はアルファを見ないので (b) のハッシュは opaque 側と一致し、
   (b2) では「明示した抜き方は入ってきた透過に負けない」ことを見るのに使う。 */
const SEG_SOFT_IN = { name:'joker', bg:'white' };
const softKey = `${SEG_SOFT_IN.name}_${SEG_SOFT_IN.bg}_soft`;

// PNG は python3(Pillow)にデコードさせ、RGBA の生バイトで受け取る
function composeInputs(outDir){
  const py = `
import sys, os
from PIL import Image
root, out, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
backs = {'black':(0,0,0), 'white':(255,255,255), 'green':(0,255,0)}
for name in sys.argv[4:]:
    im = Image.open(os.path.join(root, 'monsters', name + '.png')).convert('RGBA')
    im = im.resize((size, size), Image.NEAREST)   # 乱数も補間の揺れも入れない
    for bg, rgb in backs.items():
        base = Image.new('RGBA', (size, size), rgb + (255,))
        flat = Image.alpha_composite(base, im)
        with open(os.path.join(out, name + '_' + bg + '.raw'), 'wb') as f:
            f.write(flat.tobytes())
        # 縁が半透明の1枚: 色は同じまま、アルファだけ元の絵の透過を残す
        soft = flat.copy()
        soft.putalpha(im.getchannel('A'))
        with open(os.path.join(out, name + '_' + bg + '_soft.raw'), 'wb') as f:
            f.write(soft.tobytes())
print('ok')
`;
  const r = spawnSync('python3', ['-c', py, ROOT, outDir, String(SEG_SIZE), ...SEG_IMAGES], { encoding:'utf8' });
  if(r.status !== 0) throw new Error('python3(Pillow)で合成画像を作れませんでした: ' + (r.stderr || r.error));
}

// 1つの入力に SEG_CASES を掛けてゴールデンへ入れる(opaque 版と soft 版で同じ手順を使う)
function segCases(out, key, raw, bg){
  out[`${key}.input`] = sha(raw);
  for(const [mode, th] of SEG_CASES){
    // segment() は img.data も書き換える(デスピル)ので、毎回作り直した入れ物を渡す
    const img = { width:SEG_SIZE, height:SEG_SIZE, data:new Uint8ClampedArray(raw) };
    const chroma = mode === 'chroma' ? SEG_BACKS[bg] : null;
    const alpha = S.segment(img, mode, th, chroma);
    const box = S.bboxOf(alpha, SEG_SIZE, SEG_SIZE, 40);
    let opaque = 0, soft = 0;
    for(const v of alpha){ if(v === 255) opaque++; else if(v > 0) soft++; }
    out[`${key}.${mode}`] = {
      alpha: sha(Buffer.from(alpha.buffer, alpha.byteOffset, alpha.length)),
      rgba:  sha(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length)),
      opaque, soft, box,
    };
  }
}
function runSegment(){
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio_regress-'));
  const out = {};
  try {
    composeInputs(tmp);
    for(const name of SEG_IMAGES) for(const bg of Object.keys(SEG_BACKS))
      segCases(out, `${name}_${bg}`, fs.readFileSync(path.join(tmp, `${name}_${bg}.raw`)), bg);
    // 縁が半透明の1枚。RGB が同じなので、既存36通りと同じ結果になるのが正しい
    segCases(out, softKey, fs.readFileSync(path.join(tmp, softKey + '.raw')), SEG_SOFT_IN.bg);
  } finally { fs.rmSync(tmp, { recursive:true, force:true }); }
  compareJson('segment', path.join(GOLDEN, 'segment.json'), out);
  return `${SEG_IMAGES.length}枚 × ${Object.keys(SEG_BACKS).length}背景 × ${SEG_CASES.length}通り + 縁が半透明の1枚`;
}

/* ------------------------------------------------- (b2) モデル経路の骨組み
   モデル本体(44MB・推論)はブラウザでしか動かないので、node では
   **「モデルを使わないときの道が今までと同じか」**と**モデル専用の後処理**だけを見る。
   推論そのものの精度は tools/studio_model_test.mjs(ヘッドレスChromium)で測る。   */
async function runModel(){
  const out = {};
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio_regress-model-'));
  const mk = raw => ({ width:SEG_SIZE, height:SEG_SIZE, data:new Uint8ClampedArray(raw) });
  const eq = (a, b) => a.length === b.length && a.every((v,i)=> v === b[i]);
  try{
    composeInputs(tmp);
    // ① resolveAlpha に通しても JS の抜き方の出力が1bitも変わらないこと(呼び分けを1か所へ寄せた)
    for(const name of SEG_IMAGES) for(const bg of Object.keys(SEG_BACKS)){
      const raw = fs.readFileSync(path.join(tmp, `${name}_${bg}.raw`));
      for(const [mode, th] of SEG_CASES){
        const chroma = mode === 'chroma' ? SEG_BACKS[bg] : null;
        const a1 = S.segment(mk(raw), mode, th, chroma);
        const a2 = await S.resolveAlpha(mk(raw), { mode, th, chroma });
        if(!eq(a1, a2)) fail('model', `resolveAlpha が segment と違う結果を返しました(${name}_${bg}.${mode})`);
        // 透過が無い絵は「自動」(imageAlphaFor 経由)でも素通しにならず、同じ結果になる
        const a3 = await S.resolveAlpha(mk(raw), { mode, th, chroma, auto:true });
        if(!eq(a1, a3)) fail('model', `自動でも同じ結果になりません(${name}_${bg}.${mode})`);
      }
    }
    /* ② 縁が半透明の絵。**明示した抜き方は素通しに負けない**(§指摘22)。
       ここが素通しになっていた頃は white/chroma が262144画素=全面前景で返っていた。 */
    const rawSoft = fs.readFileSync(path.join(tmp, softKey + '.raw'));
    const own = new Uint8Array(SEG_SIZE*SEG_SIZE);
    let trans = 0;
    for(let i=0;i<own.length;i++){ own[i] = rawSoft[i*4+3]; if(own[i] < 250) trans++; }
    out.softTransparentPct = Math.round(trans/own.length*1000)/10;   // 素通しの判定を超えている入力か
    for(const [mode, th] of SEG_CASES){
      const chroma = mode === 'chroma' ? SEG_BACKS[SEG_SOFT_IN.bg] : null;
      const js  = S.segment(mk(rawSoft), mode, th, chroma);
      const got = await S.resolveAlpha(mk(rawSoft), { mode, th, chroma });
      if(!eq(js, got))  fail('model', `縁が半透明の絵で ${mode} が素通しに負けました(明示指定は必ず抜く)`);
      if(eq(got, own))  fail('model', `${mode} が画像の透過をそのまま返しました(明示指定は必ず抜く)`);
    }
    // 明示していない道(モデル・自動)だけが素通しする
    for(const seg of [{ mode:'model' }, { mode:'auto' }, { mode:'white', auto:true }]){
      const got = await S.resolveAlpha(mk(rawSoft), Object.assign({ th:20, chroma:null }, seg));
      if(!eq(got, own))
        fail('model', `${JSON.stringify(seg)} で透過済みの絵を素通ししていません(モデルへ44MBを取りに行く道)`);
    }
  } finally { fs.rmSync(tmp, { recursive:true, force:true }); }
  /* ② keepMajor: 体から切り離された武器・尻尾を残す。
     16x16 の中に「大きな塊(6x6=36)」と「小さな塊(2x2=4・最大の11%)」を置くと、
     keepLargest は小さい方を消し、keepMajor(8%)は残す。 */
  const W = 16, fg = new Uint8Array(W*W);
  for(let y=2;y<8;y++) for(let x=2;x<8;x++) fg[y*W+x] = 1;      // 本体
  for(let y=12;y<14;y++) for(let x=12;x<14;x++) fg[y*W+x] = 1;  // 切り離された武器
  const sum = m => m.reduce((a,b)=>a+b, 0);
  out.keepLargest = sum(S.keepLargest(new Uint8Array(fg), W, W));
  out.keepMajor   = sum(S.keepMajor(new Uint8Array(fg), W, W, S.MODEL_KEEP_RATIO));
  if(out.keepLargest !== 36) fail('model', `keepLargest が本体だけを残していません(${out.keepLargest})`);
  if(out.keepMajor !== 40)   fail('model', `keepMajor が切り離された部分を残していません(${out.keepMajor})`);
  // ④ 取得先とモデルの入力の大きさは1か所で持つ(検査側に写さず、読むだけ)
  out.src = S.MODEL_SRC; out.input = S.MODEL_INPUT; out.fallback = S.MODEL_FALLBACK;
  /* ⑤ 端末内の置き場の名前は sw.js と studio_web.html に**二重に持っている**(§指摘29)。
     ずれると SW の activate が「知らないキャッシュ」としてモデルを消し、
     ゲームを更新するたびに44MBを取り直すことになる。両方から抜いて突き合わせる。 */
  const swName = (/STUDIO_MODEL_CACHE\s*=\s*'([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8')) || [])[1];
  if(swName !== S.MODEL_CACHE)
    fail('model', `sw.js の STUDIO_MODEL_CACHE(${swName})と studio_web.html の MODEL_CACHE(${S.MODEL_CACHE})が違います`);
  out.cache = S.MODEL_CACHE;
  compareJson('model', path.join(GOLDEN, 'model.json'), out);
  return `resolveAlpha の一致 ${SEG_IMAGES.length*Object.keys(SEG_BACKS).length*SEG_CASES.length*2}通り`
       + ` / 縁が半透明 ${SEG_CASES.length+3}通り / keepMajor / キャッシュ名`;
}

/* ------------------------------------------------------------ (c) 周期検出 */
// 48x48 の解析コマを n 枚。下の帯(脚のあたり)だけが周期 P で動き、全体はゆっくり明るくなる(ドリフト)
function makeGrays(n, P, amp){
  const W = 48, grays = [];
  for(let i=0;i<n;i++){
    const g = new Float32Array(W*W);
    const phase = Math.sin(2*Math.PI*i/P);
    for(let y=0;y<W;y++) for(let x=0;x<W;x++){
      const drift = 30*i/n;                                  // ゆっくりした明るさの変化
      const bandY = y / W;
      const wave = bandY > 0.5 ? amp*Math.sin(2*Math.PI*(x/9) + 3*phase) : 0;
      g[y*W+x] = 110 + drift + wave + 12*Math.sin(x*0.7 + y*0.4);   // 素の模様(動かない)
    }
    grays.push(g);
  }
  return grays;
}
function runPeriod(){
  const out = {};
  for(const n of [48, 32]) for(const P of [12, 16, 20]) for(const amp of [40, 8]){
    out[`n${n}_p${P}_a${amp}`] = S.detectPeriod(makeGrays(n, P, amp), n);
  }
  // 動きがまったく無い(周期が出ない)入力も、返り値が変わらないことを見る
  out.flat_n48 = S.detectPeriod(makeGrays(48, 16, 0), 48);
  compareJson('period', path.join(GOLDEN, 'period.json'), out);
  return `${Object.keys(out).length}通り`;
}

/* どの項目がどう違うかを短く出す(項目ごとの表になっているゴールデン用) */
function compareJson(item, file, obj){
  const text = JSON.stringify(obj, null, 1) + '\n';
  if(UPDATE){
    fs.mkdirSync(path.dirname(file), { recursive:true });
    fs.writeFileSync(file, text);
    return;
  }
  if(!fs.existsSync(file)){
    fail(item, `ゴールデンがありません(${path.relative(ROOT, file)})。--update で作ってください`);
    return;
  }
  const old = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  for(const k of new Set([...Object.keys(old), ...Object.keys(obj)])){
    const a = JSON.stringify(old[k]), b = JSON.stringify(obj[k]);
    if(a !== b){ n++; fail(item, `${k}\n      ゴールデン: ${a}\n      いま      : ${b}`); }
  }
  if(!n && old !== obj && JSON.stringify(old) !== JSON.stringify(obj))
    fail(item, 'ゴールデンと違います(並び順)');
}

/* ============================================================ (d) 往復と1項目変更

   守りたいこと(設計仕様 §5 D4・§11 [11][12][13][27]):
     ・登録済みを開いて直すとき、**触った項目だけ**が変わる。
       行内コメント・未知のキー・並び順が消えたら、それは失敗。
     ・書き戻した data.js が本当に評価でき、その値が意図どおりになる。
   なぜ「変わった行が1行だけ」で見るか:
     行を作り直す実装(正規表現で行ごと置換)だと、値が1つ変わっただけでも
     コメントや空白が落ちて何行も動く。1行だけという条件がそれを機械的に弾く。 */

/* data.js を丸ごと評価して表を取り出す。
   ゲーム本体のファイルなので DOM を触る。**最小のスタブで足りる**ことを確かめてある。 */
function evalDataJs(text, label){
  const s = { console: { log(){}, warn(){}, error(){} }, Math, JSON, Date, RegExp };
  s.window = s; s.self = s; s.globalThis = s;
  s.document = {
    getElementById: ()=> null,
    createElement: ()=> ({ getContext: ()=> ({}), style:{}, appendChild(){}, setAttribute(){} }),
    querySelector: ()=> null, querySelectorAll: ()=> [],
    addEventListener(){}, body:{ appendChild(){} },
  };
  s.Image = class { constructor(){ this.src=''; this.width=0; this.height=0; } addEventListener(){} };
  s.localStorage = { getItem: ()=> null, setItem(){}, removeItem(){} };
  s.navigator = { userAgent:'studio_regress' };
  s.location = { href:'', search:'', origin:'null' };
  s.setTimeout = ()=> 0; s.clearTimeout = ()=> {};
  s.requestAnimationFrame = ()=> 0;
  s.performance = { now: ()=> 0 };
  const tail = ';({ELEMENTS,SIGNATURE_MOVES,SKIN_CONFIG,MOVE_AURA,MONSTER_AURA,SSR_SKINS,SSR_SKIN_TIER3,SSR_SKIN_AURA,UPDATE_HISTORY,CHANGELOG_TAGS});';
  try { return vm.runInContext(text + '\n' + tail, vm.createContext(s), { filename: label || 'data.js' }); }
  catch(e){ throw new Error(`data.js の評価に失敗(${label || '元'}): ${e && e.message}`); }
}

// 行単位の差分(git diff 相当)。行数が変わったらそれ自体を差分として返す
function changedLines(a, b){
  const A = a.split('\n'), B = b.split('\n');
  if(A.length !== B.length) return [{ n:0, before:`(${A.length}行)`, after:`(${B.length}行)` }];
  const out = [];
  for(let i=0;i<A.length;i++) if(A[i] !== B[i]) out.push({ n:i+1, before:A[i], after:B[i] });
  return out;
}
// 変えた1か所を元に戻したうえで全体を比べる(意図した差分以外がゼロであることの確認)
function sameExcept(base, now, undo){
  const copy = JSON.parse(JSON.stringify(now));
  undo(copy);
  return JSON.stringify(copy) === JSON.stringify(base);
}

// この5つは「これが通らないと方式ごと駄目」という必須ケース(設計仕様 §11 [27])
const MUST = {
  fire:    '技の中にコメント行',
  rock:    '閉じ括弧と同じ行から始まるコメント',
  phoenix: 'cooldownMod:1/1.5(式で書かれた値)',
  zan:     '未知キー burstSpreadRandom',
  joker:   '未知キー burstDirs・projVisR',
  mocchi:  'SKIN_CONFIG の source:{…}',
};
const shown = [];

function runRoundTrip(){
  const file = path.join(ROOT, 'data.js');
  const src = fs.readFileSync(file, 'utf8');
  const base = evalDataJs(src);
  const keys = Object.keys(base.ELEMENTS);
  if(keys.length < 21) fail('roundtrip', `ELEMENTS が ${keys.length} 体しかありません(21体以上のはず)`);
  let maReach = 0;

  for(const key of keys){
    const note = MUST[key] ? `(必須ケース: ${MUST[key]})` : '';
    const at = (what)=> `${key}${note} の${what}`;

    /* ① 何も変えずに取り出す → 取り出した範囲を戻すと元の1文字も動かない */
    for(const table of ['ELEMENTS', 'SIGNATURE_MOVES', 'SKIN_CONFIG']){
      const e = S.pickEntry(src, table, key);
      if(!e){ fail('roundtrip', `${at(table)}が pickEntry で取れません`); continue; }
      if(src.slice(0, e.start) + e.valueText + src.slice(e.end) !== src)
        fail('roundtrip', `${at(table)}の取り出し位置がずれています`);
    }
    /* MONSTER_AURA は1行に何項目も書く表。錨を「行頭 または `,`/`{` の直後」へ広げたので
       **21体すべて**取れるはず(取れないのは錨が狭まった=書き戻しが届かなくなった証拠)。 */
    const ma = S.pickEntry(src, 'MONSTER_AURA', key);
    if(!ma) fail('roundtrip', `${at('MONSTER_AURA')}が pickEntry で取れません(1行に複数項目を書く表の錨)`);
    else {
      if(src.slice(0, ma.start) + ma.valueText + src.slice(ma.end) !== src)
        fail('roundtrip', `${at('MONSTER_AURA')}の取り出し位置がずれています`);
      if(ma.valueText.replace(/'/g, '') !== base.MONSTER_AURA[key])
        fail('roundtrip', `${at('MONSTER_AURA')}の値が違います(${ma.valueText})`);
      if(src.slice(ma.keyStart, ma.keyEnd).replace(/'/g, '') !== key)
        fail('roundtrip', `${at('MONSTER_AURA')}の見出しの範囲がずれています(${src.slice(ma.keyStart, ma.keyEnd)})`);
      maReach++;
    }
    // 値を「今と同じ文字列」で置き換えても1文字も動かない(範囲の当て方の確認)
    for(const [table, field] of [['ELEMENTS','hp'], ['SKIN_CONFIG','source'], ['SKIN_CONFIG','colors']]){
      const e = S.pickEntry(src, table, key);
      if(!e) continue;
      const f = S.findFieldInObject(src, e.start, e.end, field);
      if(!f){ fail('roundtrip', `${at(table + '.' + field)}が見つかりません`); continue; }
      const same = S.replaceField(src, table, key, field, src.slice(f.valueStart, f.valueEnd));
      if(same !== src) fail('roundtrip', `${at(table + '.' + field)}を同じ値で置き換えたのに文字が動きました`);
    }

    /* ② ELEMENTS の hp を +1 */
    const hp = base.ELEMENTS[key].hp;
    const t1 = S.replaceField(src, 'ELEMENTS', key, 'hp', S.jsNum(hp + 1));
    const d1 = changedLines(src, t1);
    if(d1.length !== 1) fail('roundtrip', `${at('hp')}を+1したのに ${d1.length} 行変わりました`);
    else if(SHOW) shown.push(`${key} ELEMENTS.hp ${hp}→${hp+1}  ${d1[0].n}行目\n      - ${d1[0].before}\n      + ${d1[0].after}`);
    const v1 = evalDataJs(t1, `${key}/hp`);
    if(v1.ELEMENTS[key].hp !== hp + 1)
      fail('roundtrip', `${at('hp')}が ${hp+1} になっていません(${v1.ELEMENTS[key].hp})`);
    if(!sameExcept(base.ELEMENTS, v1.ELEMENTS, o=>{ o[key].hp = hp; }))
      fail('roundtrip', `${at('hp')}以外の ELEMENTS まで変わりました`);

    /* ③ SIGNATURE_MOVES の tier3(3番目)の dmg を +1 */
    const moves = base.SIGNATURE_MOVES[key];
    if(!moves || moves.length < 3){ fail('roundtrip', `${key} の技が3つありません`); continue; }
    const dmg = moves[2].dmg;
    const t2 = S.replaceMoveField(src, key, 2, 'dmg', S.jsNum(dmg + 1));
    const d2 = changedLines(src, t2);
    if(d2.length !== 1) fail('roundtrip', `${at('tier3 dmg')}を+1したのに ${d2.length} 行変わりました`);
    else if(SHOW) shown.push(`${key} SIGNATURE_MOVES[2].dmg ${dmg}→${dmg+1}  ${d2[0].n}行目\n      - ${d2[0].before}\n      + ${d2[0].after}`);
    const v2 = evalDataJs(t2, `${key}/dmg`);
    if(v2.SIGNATURE_MOVES[key][2].dmg !== dmg + 1)
      fail('roundtrip', `${at('tier3 dmg')}が ${dmg+1} になっていません(${v2.SIGNATURE_MOVES[key][2].dmg})`);
    if(!sameExcept(base.SIGNATURE_MOVES, v2.SIGNATURE_MOVES, o=>{ o[key][2].dmg = dmg; }))
      fail('roundtrip', `${at('tier3 dmg')}以外の技まで変わりました`);

    /* ④ SKIN_CONFIG に無いキーを足す(末尾へ足す経路。行末コメントが残るか) */
    const t3 = S.replaceField(src, 'SKIN_CONFIG', key, 'note', S.jsStr('検査'));
    const d3 = changedLines(src, t3);
    if(d3.length !== 1) fail('roundtrip', `${at('SKIN_CONFIG.note')}を足したのに ${d3.length} 行変わりました`);
    else {
      const tail = /\/\/[^\n]*$/.exec(d3[0].before);       // 行末コメント(例 「// ピンクの部分」)
      if(tail && !d3[0].after.endsWith(tail[0]))
        fail('roundtrip', `${at('SKIN_CONFIG.note')}で行末コメントが消えました`);
      if(SHOW) shown.push(`${key} SKIN_CONFIG.note 追加  ${d3[0].n}行目\n      - ${d3[0].before}\n      + ${d3[0].after}`);
    }
    const v3 = evalDataJs(t3, `${key}/note`);
    if(v3.SKIN_CONFIG[key].note !== '検査')
      fail('roundtrip', `${at('SKIN_CONFIG.note')}が読み戻せません`);
    if(!sameExcept(base.SKIN_CONFIG, v3.SKIN_CONFIG, o=>{ delete o[key].note; }))
      fail('roundtrip', `${at('SKIN_CONFIG.note')}以外の色スキン設定まで変わりました`);
  }

  /* コメント行を掴んでいないこと。data.js の EMOTE_FRAMES は
     `  // 例: guts_ssr: { … },` の1行だけを持つ空の表(実例)。 */
  if(S.pickEntry(src, 'EMOTE_FRAMES', 'guts_ssr') !== null)
    fail('roundtrip', 'EMOTE_FRAMES のコメント行(// 例: guts_ssr: …)を項目として掴んでいます');
  if(maReach !== keys.length)
    fail('roundtrip', `MONSTER_AURA から取れたのは ${maReach}/${keys.length} 体です(全部取れないと書き戻しが届きません)`);

  /* 末尾へ追加する経路: 最後の項目のうしろに行コメントがあると、後ろ向きに空白だけ飛ばす
     作りでは**コメント本文の末尾へ挿してしまい、足した項目が消える**(構文は通る)。
     ここで小さな実例を通して、足したキーが本当に評価結果へ出ることを見る。 */
  for(const [obj, why] of [['{ x:1, // メモ\n  }', '最後の項目のうしろに行コメント'],
                           ['{ x:1 /* 中 */ }',   '最後の項目のうしろにブロックコメント'],
                           ['{ x:1, }',           '末尾カンマあり'],
                           ['{ }',                '空のオブジェクト']]){
    const t = S.replaceFieldInObject(obj, 0, obj.length, 'y', '2');
    let v = null;
    try{ v = vm.runInNewContext('(' + t + ')'); }catch(e){ fail('roundtrip', `追加経路(${why})で構文が壊れました: ${t}`); continue; }
    if(v.y !== 2) fail('roundtrip', `追加経路(${why})で足したキーが評価に出ません: ${JSON.stringify(t)}`);
    if(obj.includes('x:1') && v.x !== 1)
      fail('roundtrip', `追加経路(${why})で元のキーが消えました: ${JSON.stringify(t)}`);
    for(const c of ['// メモ', '/* 中 */'])
      if(obj.includes(c) && !t.includes(c))
        fail('roundtrip', `追加経路(${why})でコメント「${c}」が消えました: ${JSON.stringify(t)}`);
  }
  // 引用符付きのキーを見つけられること(見つけられないと同じキーが2つ並ぶ)
  const q = "{ 'dmg':1, b:2 }";
  if(S.replaceFieldInObject(q, 0, q.length, 'dmg', '9') !== "{ 'dmg':9, b:2 }")
    fail('roundtrip', `引用符付きのキー('dmg':1)を書き換えられません: ${S.replaceFieldInObject(q, 0, q.length, 'dmg', '9')}`);

  /* 入れ子の同名キーを掴まないこと。**錨②(`,`/`{` の直後)にも深さの検査が要る。**
     錨②は1行に何項目も書く表(MONSTER_AURA / MOVE_AURA)のために足したものだが、
     深さを見ないと `blast:{ dmg:26 }` の dmg を「表の項目 dmg」として掴む。
     ①行頭の錨で取れない書き方(全部1行)にして、②だけが働く形で確かめる。 */
  const nested = "const NEST = { a:{ blast:{ dmg:1 } }, dmg:'top' };\n";
  const hitNest = S.pickEntry(nested, 'NEST', 'dmg');
  if(!hitNest) fail('roundtrip', '錨②: 表の直下の dmg を取れません(深さの検査が強すぎます)');
  else if(hitNest.valueText !== "'top'")
    fail('roundtrip', `錨②: 入れ子(blast:{ dmg })を掴んでいます(${hitNest.valueText})`);
  // 表の直下に無いなら「無い」と答える(入れ子で代用しない)
  const onlyNested = "const NEST2 = { a:{ blast:{ dmg:1 } } };\n";
  if(S.pickEntry(onlyNested, 'NEST2', 'dmg') !== null)
    fail('roundtrip', '錨②: 入れ子の中にしかない dmg を表の項目として掴んでいます');
  // 深さ数え(entryDepthAt)そのもの: コメント/文字列の中は -1
  const depthSrc = "{ a:{ b:1 }, c:2 }";
  if(S.entryDepthAt(depthSrc, 0, depthSrc.indexOf('b:')) !== 2)
    fail('roundtrip', 'entryDepthAt: 入れ子の深さが 2 になりません');
  if(S.entryDepthAt(depthSrc, 0, depthSrc.indexOf('c:')) !== 1)
    fail('roundtrip', 'entryDepthAt: 直下の深さが 1 になりません');
  const deadSrc = "{ a:1, /* c:2 */ d:3 }";
  if(S.entryDepthAt(deadSrc, 0, deadSrc.indexOf('c:')) !== -1)
    fail('roundtrip', 'entryDepthAt: コメントの中を -1 と答えません');

  return `${keys.length}体 × 4通り`;
}

/* ============================================================ (e) HTML属性から呼ばれる名前

   なぜ要るか(設計仕様 §11 [17]): onclick="doCommit()" は HTML の属性なので、
   関数を消したり名前を変えても JS の側では何も起きず、**押した瞬間に初めて壊れる**。 */
const HANDLER_ATTRS = new Set(['onclick','onchange','oninput','onsubmit','onkeydown','onkeyup',
  'onkeypress','onload','onerror','onfocus','onblur','ondblclick','oncontextmenu','onwheel','onscroll',
  'onmousedown','onmouseup','onmousemove','onpointerdown','onpointerup','onpointermove',
  'ontouchstart','ontouchmove','ontouchend','onpaste','oncopy','oncut']);

function handlerNames(html){
  const names = new Map();                       // 名前 → どの属性から
  for(const m of html.matchAll(/\s(on[a-z]+)\s*=\s*(["'])([\s\S]*?)\2/g)){
    if(!HANDLER_ATTRS.has(m[1])) continue;       // content= のような紛れを弾く
    const body = m[3];
    for(const c of body.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)){
      if(body[c.index-1] === '.') continue;      // this.foo() のようなメソッド呼び出し
      if(!names.has(c[1])) names.set(c[1], `${m[1]}="${body.slice(0,40)}"`);
    }
  }
  return names;
}
function runHandlers(){
  const html = fs.readFileSync(S.__file, 'utf8');
  const names = handlerNames(html);
  if(!names.size){ fail('handlers', 'onclick= 等が1つも見つかりません(集め方が壊れていませんか)'); return '0個'; }
  const probe = loadStudio({ extra: [...names.keys()] });
  for(const n of probe.__missingExtra)
    fail('handlers', `HTML の ${names.get(n)} が呼ぶ ${n}() が定義されていません`);
  return `${names.size}個`;
}

/* ============================================================ (f) 技名とオーラ

   なぜ要るか(設計仕様 §11 [14]): 技のオーラは**技名で引く**ので、
   技名を変えて MOVE_AURA を直し忘れると、その技のオーラが黙って消える。
   ※ SSR専用tier3(SSR_SKIN_TIER3)の技名はここに入らないのが正しい。
      装備中のオーラは SSR_SKIN_AURA から来る(data.js の getMoveAura / skinTier3Aura)。 */
function runMoveAura(){
  const src = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
  const d = evalDataJs(src);
  const auraKeys = new Set(Object.keys(d.MOVE_AURA));
  let n = 0, reach = 0;
  for(const key of Object.keys(d.SIGNATURE_MOVES)) for(const mv of d.SIGNATURE_MOVES[key]){
    n++;
    if(!auraKeys.has(mv.name)) fail('moveaura', `SIGNATURE_MOVES.${key} の「${mv.name}」が MOVE_AURA にありません`);
    /* 技名を変えたら MOVE_AURA の見出しも書き換える(§11 [14])。**書き換えるには
       まず取れないといけない。** MOVE_AURA は1行3項目・キーが引用符付きなので、
       錨が行頭だけだと 1/3 しか届かない。全部の技名で取れることをここで見る。 */
    const e = S.pickEntry(src, 'MOVE_AURA', mv.name);
    if(!e) fail('moveaura', `MOVE_AURA の「${mv.name}」が pickEntry で取れません(見出しを書き換えられない)`);
    else if(src.slice(e.keyStart, e.keyEnd) !== `'${mv.name}'`)
      fail('moveaura', `MOVE_AURA の「${mv.name}」の見出しの範囲がずれています(${src.slice(e.keyStart, e.keyEnd)})`);
    else reach++;
  }
  if(reach !== n) fail('moveaura', `MOVE_AURA から取れたのは ${reach}/${n} 技です`);
  // SSR側は別経路。抜けていても止めないが、数だけ出しておく
  const ssrMissing = Object.keys(d.SSR_SKIN_TIER3 || {}).filter(id => !d.SSR_SKIN_AURA[id]);
  if(ssrMissing.length) fail('moveaura', `SSR_SKIN_AURA が無いSSR専用tier3: ${ssrMissing.join(', ')}`);
  return `${n}技`;
}

/* ============================================================ (i) SEの一覧のずれ

   スタジオの SE_FALLBACK は、combat.js の MOVE_SE_BY_STYLE と ui.js の SE_TEST_LABELS を
   **二重に持っている**箇所(プレビューを開く前でもSEを選べるようにするため)。
   ゲーム側に音を足してこちらへ足し忘れると、その音は技パネルの選択肢に一生出てこない。
   最低限「技が実際に鳴らす音」= MOVE_SE_BY_STYLE の値 + data.js の seStyle は全部入れる。 */
function runSe(){
  const combat = fs.readFileSync(path.join(ROOT, 'combat.js'), 'utf8');
  const i = combat.indexOf('const MOVE_SE_BY_STYLE');
  const open = combat.indexOf('{', i);
  if(i < 0 || open < 0){ fail('se', 'combat.js に MOVE_SE_BY_STYLE が見つかりません'); return '—'; }
  const table = new Function('return ' + combat.slice(open, S.scanValue(combat, open)))();
  const d = evalDataJs(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8'));
  const need = new Set(Object.values(table));
  for(const key of Object.keys(d.SIGNATURE_MOVES))
    for(const mv of d.SIGNATURE_MOVES[key]) if(mv && mv.seStyle) need.add(mv.seStyle);
  const have = new Set(S.SE_FALLBACK);
  for(const se of need) if(!have.has(se))
    fail('se', `SE「${se}」がスタジオの SE_FALLBACK にありません(ゲーム側にだけある)`);
  return `${need.size}種`;
}

/* ============================================================ (g) 更新履歴の注意2判定

   studio_web.html の changelogWarnings は tools/changelog_check.mjs と**二重に持つ**箇所
   (設計仕様 §11 [39])。ここで同じ data.js に対して同じ警告が出ることを毎回突き合わせる。
   突き合わせるのは「どの行が・なぜ」だけ(文面はそれぞれの画面に合わせてよい)。 */
// changelog_check.mjs の「注意」から、どの行がなぜ警告されたかだけを取り出す(文面は比べない)
function warnKeysOf(stdout){
  const out = [];
  for(const line of String(stdout || '').split('\n')){
    let m = /^\s*-\s*(\d{4}-\d{2}-\d{2}) の(\d+)行目と(\d+)行目が似ている\((\d+)%\)/.exec(line);
    if(m){ out.push(`similar ${m[1]} ${m[2]} ${m[3]} ${m[4]}`); continue; }
    m = /^\s*-\s*(\d{4}-\d{2}-\d{2}) の(\d+)行目に内部の言葉: (.+)$/.exec(line);
    if(m) out.push(`internal ${m[1]} ${m[2]} ${m[3].trim()}`);
  }
  return out;
}
// ツール側(studio_web.html の changelogWarnings)で同じ並びを作る
// changelog_check の順:「似た行」は最新の日付のブロックだけ → そのあと全ブロックの「内部の言葉」
function warnKeysFromTool(H){
  const out = [];
  for(const w of S.changelogWarnings(H[0].items, { internal:false }))
    out.push(`similar ${H[0].date} ${w.i} ${w.j} ${w.percent}`);
  for(const b of H) for(const w of S.changelogWarnings(b.items, { similar:false }))
    out.push(`internal ${b.date} ${w.i} ${w.words.join('・')}`);
  return out;
}
/* changelog_check.mjs は ROOT/data.js を読む作りなので、差し替えた data.js で走らせたいときは
   一時フォルダに同じ形(tmp/tools/changelog_check.mjs と tmp/data.js)を作って呼ぶ。 */
function runCheckOn(dataText){
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio_regress-cl-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tools'));
    fs.copyFileSync(path.join(__dirname, 'changelog_check.mjs'), path.join(tmp, 'tools', 'changelog_check.mjs'));
    fs.writeFileSync(path.join(tmp, 'data.js'), dataText);
    return spawnSync(process.execPath, [path.join(tmp, 'tools', 'changelog_check.mjs')], { encoding:'utf8' });
  } finally { fs.rmSync(tmp, { recursive:true, force:true }); }
}
/* 警告が出る状態でも一致するかを見るための、合成した1日ぶん。
   ・1行目と2行目 = 同じ話題(似た行として拾われるはず)
   ・3行目 = 内部の言葉(キャッシュ・リファクタ)
   日付は未来にして「最新の日付のブロック」になるようにする。 */
const CHANGELOG_PROBE = `  { date:'2099-12-31', items:[
    { t:'安全圏の縮小が全体的にゆっくりになりました', g:['balance'] },
    { t:'安全圏の縮小の速さをさらに調整しました', g:['balance'] },
    { t:'キャッシュの持ち方をリファクタしました', g:['general'] },
  ]},
`;
function runChangelog(){
  const src = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
  let n = 0;
  // ① 今の data.js そのまま
  const r0 = spawnSync(process.execPath, [path.join(__dirname, 'changelog_check.mjs')], { encoding:'utf8' });
  if(r0.status !== 0){ fail('changelog', 'changelog_check.mjs がエラーで終わりました:\n' + (r0.stdout || r0.stderr)); return '—'; }
  const H0 = evalDataJs(src).UPDATE_HISTORY;
  const a0 = warnKeysOf(r0.stdout), b0 = warnKeysFromTool(H0);
  if(a0.join('\n') !== b0.join('\n'))
    fail('changelog', '今の data.js で changelog_check とツール側の警告が違います'
      + `\n      changelog_check: ${JSON.stringify(a0)}\n      studio_web     : ${JSON.stringify(b0)}`);
  n += a0.length;

  /* ② わざと警告が出る1日ぶんを足した data.js。
     ①だけだと「両方とも0件」で通ってしまい、判定が同じかどうかを見たことにならない。 */
  const probeSrc = src.replace('const UPDATE_HISTORY = [\n', 'const UPDATE_HISTORY = [\n' + CHANGELOG_PROBE);
  if(probeSrc === src){ fail('changelog', 'UPDATE_HISTORY の書き出しが見つかりません(検査用の差し込みができない)'); return '—'; }
  const r1 = runCheckOn(probeSrc);
  if(r1.status !== 0){ fail('changelog', '検査用の data.js で changelog_check がエラーになりました:\n' + (r1.stdout || r1.stderr)); return '—'; }
  const H1 = evalDataJs(probeSrc, '検査用 data.js').UPDATE_HISTORY;
  const a1 = warnKeysOf(r1.stdout), b1 = warnKeysFromTool(H1);
  if(!a1.length) fail('changelog', '検査用の1日ぶんで警告が1件も出ませんでした(判定を比べられていない)');
  if(a1.join('\n') !== b1.join('\n'))
    fail('changelog', '検査用の data.js で changelog_check とツール側の警告が違います'
      + `\n      changelog_check: ${JSON.stringify(a1)}\n      studio_web     : ${JSON.stringify(b1)}`);

  return `${H0.length}ブロック(今:注意${n}件 / 検査用:注意${a1.length}件で一致)`;
}

/* ============================================================ (h) 開いて直す(機能D)

   何を守るか(設計仕様 §5 D・§11 D [27]):
     登録済みを開いて **1項目だけ**直したとき、変わる行がその1行だけで、評価した値が
     意図どおりで、それ以外の差分がゼロであること。**UI を通さない** —— 実装の3つ
     (readExisting → editChangesFor → applyEditChanges)をそのまま呼ぶ。
   必須ケース(§11 [27]): fire(技の中のコメント行)/ rock(閉じ括弧と同じ行のコメント)/
     phoenix(1/1.5 の式)/ zan・joker(未知キー)/ mocchi(SKIN_CONFIG の source:{…})/
     技名を変えたら MOVE_AURA の見出しも変わる。                                   */

// 評価した data.js から、突き合わせに使う表だけを JSON で取り出す
function tablesJson(v){
  const o = {};
  for(const t of S.EDIT_VERIFY_TABLES) o[t] = v[t];
  return JSON.parse(JSON.stringify(o));
}
/* 「読み取った値をそのまま欄へ入れ直した状態」の next を作る。
   何も触らなければ差分ゼロ、というのがこの機能の土台なので、ここを起点に1項目だけ動かす。 */
function formLike(cur){
  const pick = (src, fields)=>{ const o = {}; for(const f of fields) o[f] = (src || {})[f]; return o; };
  if(cur.kind === 'ssr')
    return { kind:'ssr', key:cur.key,
             ssr: pick(cur.ssr, S.EDIT_SSR_FIELDS.map(f=>f.field)),
             aura: cur.aura,
             tier3: cur.tier3 ? { name:cur.tier3.name, dmgMult:cur.tier3.dmgMult } : {} };
  return { kind:'monster', key:cur.key,
           elements: pick(cur.elements, S.EDIT_ELEMENT_FIELDS.map(f=>f.field)),
           aura: cur.aura,
           moves: (cur.moves || []).map((mv, i)=>{
             const o = pick(mv, S.EDIT_MOVE_KEYS[i] || []);
             o.name = mv.name;
             if(i === S.MOVE_BLAST_TIER && mv.blast){ o.blastRadius = mv.blast.radius; o.blastDmg = mv.blast.dmg; }
             return o;
           }),
           skin: { colors: (cur.skin.colors || []).slice(), source: cur.skin.source } };
}
const shownEdit = [];
/* 1件ぶんの「開く→直す→書き戻す」を通し、変わった行数・評価した値・意図しない差分を見る。 */
function editCase(label, src, baseTables, changes, wantLines, checkValue){
  if(!changes.length){ fail('edit', `${label}: 変更が1件も作られませんでした`); return null; }
  let text;
  try{ text = S.applyEditChanges(src, changes); }
  catch(e){ fail('edit', `${label}: 書き戻しで例外 — ${e.message}`); return null; }
  const d = changedLines(src, text);
  if(d.length !== wantLines) fail('edit', `${label}: 変わった行が ${d.length} 行(${wantLines}行のはず)`);
  else if(SHOW) for(const one of d) shownEdit.push(`${label}  ${one.n}行目\n      - ${one.before}\n      + ${one.after}`);
  let now;
  try{ now = evalDataJs(text, label); }
  catch(e){ fail('edit', `${label}: 書き戻した data.js を評価できません — ${e.message}`); return null; }
  const want = S.editExpectedPaths(changes);
  const diffs = S.jsonDiffPaths(baseTables, tablesJson(now));
  const un = diffs.filter(x => !want.some(w => x.path === w || x.path.indexOf(w + '.') === 0));
  if(un.length) fail('edit', `${label}: 意図しない差分 — ` + un.slice(0,4).map(x=>x.path).join(', '));
  if(!diffs.length) fail('edit', `${label}: 評価しても値が変わっていません`);
  const why = checkValue && checkValue(now, text);
  if(why) fail('edit', `${label}: ${why}`);
  return { text, now };
}

function runEditRound(){
  const src = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
  const base = evalDataJs(src);
  const baseTables = tablesJson(base);
  // 走査器が扱えない書き方(正規表現リテラル・テンプレートリテラル)が入っていないこと
  for(const t of S.EDIT_VERIFY_TABLES){
    const risk = S.tableScanRisk(src, t);
    if(risk) fail('edit', `${risk} — 走査器はこの書き方を扱えません(scanValue の注釈)`);
  }

  const keys = Object.keys(base.ELEMENTS);
  let n = 0;
  for(const key of keys){
    const note = MUST[key] ? `(必須: ${MUST[key]})` : '';
    const cur = S.readExisting(src, 'monster', key);
    if(cur.unknown.length) fail('edit', `${key}${note}: 読めなかった表 ${cur.unknown.join(' / ')}`);
    if(cur.risk.length)    fail('edit', `${key}${note}: ${cur.risk.join(' / ')}`);
    // 読み取った値(pickEntry + new Function)が、data.js を丸ごと評価したものと一致する
    if(JSON.stringify(cur.elements) !== JSON.stringify(base.ELEMENTS[key]))
      fail('edit', `${key}${note}: ELEMENTS の読み取りが data.js の評価と違います`);
    if(cur.aura !== base.MONSTER_AURA[key])
      fail('edit', `${key}${note}: MONSTER_AURA の読み取りが違います(${cur.aura})`);
    if(cur.moves.length !== 3) fail('edit', `${key}${note}: 技が3つ読めません(${cur.moves.length})`);

    // ① 読んだ値をそのまま入れ直したら差分ゼロ(=触らなければ1文字も動かない)
    const same = S.editChangesFor(cur, formLike(cur));
    if(same.length)
      fail('edit', `${key}${note}: 何も触っていないのに ${same.length} 件の差分が出ました(`
        + same.map(c=>c.jp).join(', ') + ')');

    // ② ELEMENTS の hp を +1
    let next = formLike(cur);
    next.elements.hp = cur.elements.hp + 1;
    editCase(`${key}${note} ELEMENTS.hp`, src, baseTables, S.editChangesFor(cur, next), 1,
      now => now.ELEMENTS[key].hp === cur.elements.hp + 1 ? null : `hp が ${now.ELEMENTS[key].hp} です`);
    n++;

    /* ③ tier3 の威力を +1。fire は技の中にコメント行、rock は閉じ括弧と同じ行から
       コメントが始まる。zan・joker はツールが知らないキーを持つ。全部そのまま残るはず。 */
    next = formLike(cur);
    next.moves[2].dmg = cur.moves[2].dmg + 1;
    editCase(`${key}${note} 技3の威力`, src, baseTables, S.editChangesFor(cur, next), 1,
      (now, text) => {
        if(now.SIGNATURE_MOVES[key][2].dmg !== cur.moves[2].dmg + 1) return '威力が入っていません';
        // 未知のキーが消えていないこと(zan の burstSpreadRandom / joker の burstDirs・projVisR)
        for(const k of Object.keys(cur.moves[2]))
          if(now.SIGNATURE_MOVES[key][2][k] === undefined) return `技3の ${k} が消えました`;
        return null;
      });
    n++;

    // ④ 色スキンの塗り替える部分(mocchi は source:{…} が必須ケース)
    next = formLike(cur);
    next.skin = { colors: next.skin.colors.slice(),
                  source: Object.assign({}, cur.skin.source,
                            cur.skin.source.type === 'chroma' ? { window: (cur.skin.source.window || 55) + 1 }
                                                              : { type:'chroma', hue:0, window:55 }) };
    editCase(`${key}${note} SKIN_CONFIG.source`, src, baseTables, S.editChangesFor(cur, next), 1,
      now => now.SKIN_CONFIG[key].source.window === next.skin.source.window ? null : '色相の幅が入っていません');
    n++;

    // ⑤ オーラ(1行に複数項目を書く表。錨を広げていないとここで落ちる)
    next = formLike(cur);
    next.aura = (cur.aura === 'red') ? 'blue' : 'red';
    editCase(`${key}${note} MONSTER_AURA`, src, baseTables, S.editChangesFor(cur, next), 1,
      now => now.MONSTER_AURA[key] === next.aura ? null : `オーラが ${now.MONSTER_AURA[key]} です`);
    n++;

    /* ⑥ 技名を変える。**SIGNATURE_MOVES と MOVE_AURA の2行**が変わり、
       その技のオーラ(技名で引く)が消えないこと。 */
    next = formLike(cur);
    const oldName = cur.moves[0].name, newName = oldName + 'X';
    next.moves[0].name = newName;
    const ch6 = S.editChangesFor(cur, next);
    if(!ch6.some(c => c.op === 'renameKey'))
      fail('edit', `${key}${note}: 技名を変えたのに MOVE_AURA の見出しを直していません`);
    editCase(`${key}${note} 技1の技名`, src, baseTables, ch6, 2, now => {
      if(now.SIGNATURE_MOVES[key][0].name !== newName) return '技名が入っていません';
      if(now.MOVE_AURA[newName] !== base.MOVE_AURA[oldName]) return 'MOVE_AURA に新しい技名がありません';
      if(now.MOVE_AURA[oldName] !== undefined) return 'MOVE_AURA に古い技名が残っています';
      if(now.SIGNATURE_MOVES[key][0].aura !== base.SIGNATURE_MOVES[key][0].aura) return '技のオーラが変わりました';
      return null;
    });
    n++;
  }

  /* SSRスキンも同じ道で開いて直せる(表示名・オーラ・専用tier3)。
     SSR_SKIN_AURA の先頭は1行に4項目あるので、ここでも広げた錨が要る。 */
  const ssrIds = Object.keys(base.SSR_SKINS);
  for(const id of ssrIds){
    const cur = S.readExisting(src, 'ssr', id);
    if(cur.unknown.length) fail('edit', `${id}: 読めなかった表 ${cur.unknown.join(' / ')}`);
    if(S.editChangesFor(cur, formLike(cur)).length)
      fail('edit', `${id}: 何も触っていないのに差分が出ました`);
    let next = formLike(cur);
    next.ssr.name = cur.ssr.name + '改';
    editCase(`${id} SSR_SKINS.name`, src, baseTables, S.editChangesFor(cur, next), 1,
      now => now.SSR_SKINS[id].name === next.ssr.name ? null : '表示名が入っていません');
    next = formLike(cur);
    next.aura = (cur.aura === 'red') ? 'blue' : 'red';
    editCase(`${id} SSR_SKIN_AURA`, src, baseTables, S.editChangesFor(cur, next), 1,
      now => now.SSR_SKIN_AURA[id] === next.aura ? null : `オーラが ${now.SSR_SKIN_AURA[id]} です`);
    n += 2;
  }

  /* 更新履歴: 今日のかたまりの1行を**書き直す**(書き足さない)。
     日付は実行日によって有る/無いが変わるので、検査用の1日ぶんを差し込んで確かめる。 */
  const ymd = S.todayYmd();
  const probe = `  { date:'${ymd}', items:[\n    { t:'検査用の行', g:['balance'] },\n  ]},\n`;
  const withDay = src.replace('const UPDATE_HISTORY = [\n', 'const UPDATE_HISTORY = [\n' + probe);
  const items = S.updateHistoryItems(withDay, ymd);
  if(!items || items.length !== 1) fail('edit', '更新履歴の今日のかたまりを読めません');
  else {
    const r = S.rewriteUpdateHistory(withDay, ymd, 0, 'ジョーカー: 威力21→34', ['balance','monster']);
    const d = changedLines(withDay, r.text);
    if(d.length !== 1) fail('edit', `更新履歴の書き直しで ${d.length} 行変わりました(1行のはず)`);
    const got = (S.updateHistoryItems(r.text, ymd) || [])[0];
    if(!got || got.t !== 'ジョーカー: 威力21→34' || JSON.stringify(got.g) !== '["balance","monster"]')
      fail('edit', `更新履歴の書き直しが入っていません(${JSON.stringify(got)})`);
  }
  // 更新履歴の1行は「性能の数字」からしか作らない(見た目だけの変更では作らない)
  const line = S.editHistoryLine('ジョーカー', [
    { perf:true, histJp:'威力', before:21, after:34 },
    { perf:true, histJp:'連射', before:5,  after:7 },
    { perf:false, histJp:'エフェクト色', before:'#000', after:'#fff' }]);
  if(!line || line.text !== 'ジョーカー: 威力21→34・連射5→7')
    fail('edit', `更新履歴の1行の作り方が違います(${line && line.text})`);
  if(JSON.stringify(line && line.tags) !== '["balance"]')
    fail('edit', `数字だけ変えたときのタグが balance ではありません(${JSON.stringify(line && line.tags)})`);
  if(S.editHistoryLine('ジョーカー', [{ perf:false, histJp:'色', before:'a', after:'b' }]) !== null)
    fail('edit', '見た目だけの変更でも更新履歴の行を作っています');
  // オーラ(見た目)だけの変更では行を作らない。オーラは perf:false なのでここに落ちる
  if(S.editHistoryLine('ジョーカー', [{ op:'entry', perf:false, jp:'オーラ', before:'black', after:'red' }]) !== null)
    fail('edit', 'オーラ(見た目)だけの変更で更新履歴の行を作っています');
  // 技名を変えたら monster / 数字なら balance / **両方なら両方**
  const tagsOf = ch => JSON.stringify((S.editHistoryLine('X', ch) || {}).tags);
  if(tagsOf([{ rename:true, before:'A', after:'B' }]) !== '["monster"]')
    fail('edit', `技名の変更のタグが monster ではありません(${tagsOf([{ rename:true, before:'A', after:'B' }])})`);
  const both = [{ rename:true, before:'A', after:'B' }, { perf:true, histJp:'威力', before:1, after:2 }];
  if(tagsOf(both) !== '["monster","balance"]')
    fail('edit', `技名と数字の両方を変えたときのタグが両方になりません(${tagsOf(both)})`);

  /* 更新履歴の「書き直す行」の選び方(§指摘1)。**同じ表示名を含む行だけが候補。**
     「威力」が共通なだけで別の体の行を書き直すと、その体の告知が消える。 */
  const chItems = [{ t:'ザン: 威力30→40・連射5→7', g:['balance'] },
                   { t:'ジョーカー: 威力21→34', g:['balance'] }];
  if(S.editRewriteIndex(chItems, 'ジョーカー', 'ジョーカー: 威力21→50') !== 1)
    fail('edit', '同じ体の行を書き直しません');
  if(S.editRewriteIndex([chItems[0]], 'ジョーカー', 'ジョーカー: 威力21→50') !== -1)
    fail('edit', '別の体の行(ザン)を「似た行」として書き直そうとしています');
  if(S.editRewriteIndex(chItems, '', 'ジョーカー: 威力21→50') !== -1)
    fail('edit', '表示名が無いのに書き直す行を選んでいます');

  /* 「意図した差分がすべて出ているか」の判定(§指摘4)。
     出ていない/値が違うときに、それを見落とさないこと。 */
  const chg = [{ op:'field', table:'ELEMENTS', key:'joker', field:'hp', jp:'HP', after:120 }];
  const tbl = { ELEMENTS:{ joker:{ hp:120 } } };
  if(S.editMissingChanges(chg, [{ path:'ELEMENTS.joker.hp', before:115, after:120 }], tbl).length)
    fail('edit', '意図どおりの差分を「出ていない」と言っています');
  if(!S.editMissingChanges(chg, [], tbl).length)
    fail('edit', '差分が1件も出ていないのに見逃しています');
  if(!S.editMissingChanges(chg, [{ path:'ELEMENTS.joker.hp', before:115, after:999 }],
                           { ELEMENTS:{ joker:{ hp:999 } } }).length)
    fail('edit', '意図と違う値になっているのに見逃しています');

  /* 更新履歴の「意図した姿」の作り方(§指摘4)。addUpdateHistory と同じ置き場所になること。 */
  const H = [{ date:'2026-09-02', items:[{ t:'古い行', g:['balance'] }] }];
  const app = S.editExpectedHistory(H, { ymd:'2026-09-02', rewrite:false, index:0, text:'新', tags:['balance'] });
  if(JSON.stringify(app[0].items.map(x=>x.t)) !== '["新","古い行"]')
    fail('edit', `更新履歴の「書き足す」の置き場所が違います(${JSON.stringify(app[0].items)})`);
  const rw = S.editExpectedHistory(H, { ymd:'2026-09-02', rewrite:true, index:0, text:'新', tags:['balance'] });
  if(JSON.stringify(rw[0].items.map(x=>x.t)) !== '["新"]')
    fail('edit', `更新履歴の「書き直す」の当て方が違います(${JSON.stringify(rw[0].items)})`);
  const nb = S.editExpectedHistory(H, { ymd:'2026-09-03', rewrite:false, index:0, text:'新', tags:['balance'] });
  if(nb.length !== 2 || nb[0].date !== '2026-09-03')
    fail('edit', '今日のかたまりが無いときに一番上へ作りません');
  if(JSON.stringify(S.editExpectedHistory(H, null)) !== JSON.stringify(H))
    fail('edit', '更新履歴を触らないときに履歴が変わっています');

  /* tier3 の「形」の逆引き(§指摘2)。projStyle / aoeStyle から1つに決まること。
     デスファイナル(projStyle:'scythe')はどのテンプレートにも当てはまらない。 */
  for(const k of Object.keys(S.TIER3))
    if(S.tier3TemplateOf(S.TIER3[k]) !== k)
      fail('edit', `tier3 の形の逆引きが ${k} で ${S.tier3TemplateOf(S.TIER3[k])} になります`);
  if(S.tier3TemplateOf(base.SIGNATURE_MOVES.joker[2]) !== null)
    fail('edit', 'デスファイナル(scythe)にテンプレートを当ててしまっています');
  if(S.tier3TemplateOf(base.SIGNATURE_MOVES.zan[2]) !== 'crescent')
    fail('edit', `ザンの tier3 の形が crescent になりません(${S.tier3TemplateOf(base.SIGNATURE_MOVES.zan[2])})`);

  return `${keys.length}体 × 5通り + SSR ${ssrIds.length}体 × 2通り(${n}件)`;
}

/* ------------------------------------------------------------ 実行 */
const done = [];
if(want('rows'))      done.push('行生成 ' + runRows());
if(want('segment'))   done.push('背景抜き ' + runSegment());
if(want('model'))     done.push('モデル経路 ' + await runModel());
if(want('period'))    done.push('周期検出 ' + runPeriod());
if(want('roundtrip')) done.push('往復 ' + runRoundTrip());
if(want('handlers'))  done.push('属性 ' + runHandlers());
if(want('moveaura'))  done.push('技名 ' + runMoveAura());
if(want('changelog')) done.push('更新履歴 ' + runChangelog());
if(want('edit'))      done.push('開いて直す ' + runEditRound());
if(want('se'))        done.push('SEの一覧 ' + runSe());
if(shownEdit.length){
  console.log('開いて直す(1項目変更)の変更行:');
  for(const s of shownEdit) console.log('  - ' + s);
  console.log('');
}
if(shown.length){
  console.log('往復(1項目変更)の変更行:');
  for(const s of shown) console.log('  - ' + s);
  console.log('');
}

for(const n of notes) console.log('注意: ' + n);
if(UPDATE){
  console.log('ゴールデンを作りました: ' + done.join(' / '));
  console.log('置き場所: ' + path.relative(ROOT, GOLDEN));
}
/* diffJson と compare で同じ項目を二重に出すので、同じ行はまとめる。
   **--update でもここは必ず通す。** ゴールデン以外の判定(往復・属性・技名・更新履歴・
   keepMajor など、比較の相手を持たない本物の不合格)は --update と関係なく起きるのに、
   以前は --update だと何も見ずに exit 0 していた。ゴールデンは書いたうえで、落ちる(§指摘7)。 */
const uniq = [...new Set(failures)];
if(uniq.length){
  console.log(`違いが ${uniq.length} 件あります:`);
  for(const f of uniq) console.log('  - ' + f);
  process.exit(1);
}
console.log(UPDATE ? 'ゴールデン以外の判定はすべて通りました'
                   : 'スタジオ回帰検査: 変化なし(' + done.join(' / ') + ')');
