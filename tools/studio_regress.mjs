/* モンスター作成スタジオ(tools/studio_web.html)の回帰検査(開発用・ゲームには読み込まない)。

   何を守るか(設計仕様 §7):
     スタジオを改修するとき、**今すでに出ている出力を変えない**こと。
     (a) 行生成   monsters/specs/*.json すべてで buildMoves → renderRows / renderSsrRows の出力を文字列比較
     (b) 背景抜き 既知の合成画像に segment() を掛けた alpha(と、デスピルで書き換わる色)のハッシュ
     (c) 周期検出 合成した周期信号を detectPeriod() に入れて返る周期

   使い方:
     node tools/studio_regress.mjs --update   ゴールデン(tools/_golden/)を作り直す
     node tools/studio_regress.mjs            ゴールデンと比べる(違えば終了コード1)
     node tools/studio_regress.mjs --only rows|segment|period   項目を絞る

   決まりごと:
     ・ゴールデンは生成物だが**比較の相手なので git で追跡する**(.gitignore に入れない)。
     ・合成画像は monsters/*.png から**乱数を使わずに**作る。PNG のデコードは python3(Pillow)に任せ、
       RGBA の生バイトを受け取る(node 側に自前のデコーダを置かない)。                    */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadStudio } from './studio_load.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT   = path.resolve(__dirname, '..');
const GOLDEN = path.join(__dirname, '_golden');

const args   = process.argv.slice(2);
const UPDATE = args.includes('--update');
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
        with open(os.path.join(out, name + '_' + bg + '.raw'), 'wb') as f:
            f.write(Image.alpha_composite(base, im).tobytes())
print('ok')
`;
  const r = spawnSync('python3', ['-c', py, ROOT, outDir, String(SEG_SIZE), ...SEG_IMAGES], { encoding:'utf8' });
  if(r.status !== 0) throw new Error('python3(Pillow)で合成画像を作れませんでした: ' + (r.stderr || r.error));
}

function runSegment(){
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio_regress-'));
  const out = {};
  try {
    composeInputs(tmp);
    for(const name of SEG_IMAGES) for(const bg of Object.keys(SEG_BACKS)){
      const raw = fs.readFileSync(path.join(tmp, `${name}_${bg}.raw`));
      out[`${name}_${bg}.input`] = sha(raw);
      for(const [mode, th] of SEG_CASES){
        // segment() は img.data も書き換える(デスピル)ので、毎回作り直した入れ物を渡す
        const img = { width:SEG_SIZE, height:SEG_SIZE, data:new Uint8ClampedArray(raw) };
        const chroma = mode === 'chroma' ? SEG_BACKS[bg] : null;
        const alpha = S.segment(img, mode, th, chroma);
        const box = S.bboxOf(alpha, SEG_SIZE, SEG_SIZE, 40);
        let opaque = 0, soft = 0;
        for(const v of alpha){ if(v === 255) opaque++; else if(v > 0) soft++; }
        out[`${name}_${bg}.${mode}`] = {
          alpha: sha(Buffer.from(alpha.buffer, alpha.byteOffset, alpha.length)),
          rgba:  sha(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length)),
          opaque, soft, box,
        };
      }
    }
  } finally { fs.rmSync(tmp, { recursive:true, force:true }); }
  compareJson('segment', path.join(GOLDEN, 'segment.json'), out);
  return `${SEG_IMAGES.length}枚 × ${Object.keys(SEG_BACKS).length}背景 × ${SEG_CASES.length}通り`;
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

/* ------------------------------------------------------------ 実行 */
const done = [];
if(want('rows'))    done.push('行生成 ' + runRows());
if(want('segment')) done.push('背景抜き ' + runSegment());
if(want('period'))  done.push('周期検出 ' + runPeriod());

for(const n of notes) console.log('注意: ' + n);
if(UPDATE){
  console.log('ゴールデンを作りました: ' + done.join(' / '));
  console.log('置き場所: ' + path.relative(ROOT, GOLDEN));
  process.exit(0);
}
// diffJson と compare で同じ項目を二重に出すので、同じ行はまとめる
const uniq = [...new Set(failures)];
if(uniq.length){
  console.log(`違いが ${uniq.length} 件あります:`);
  for(const f of uniq) console.log('  - ' + f);
  process.exit(1);
}
console.log('スタジオ回帰検査: 変化なし(' + done.join(' / ') + ')');
