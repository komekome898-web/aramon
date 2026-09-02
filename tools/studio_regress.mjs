/* モンスター作成スタジオ(tools/studio_web.html)の回帰検査(開発用・ゲームには読み込まない)。

   何を守るか(設計仕様 §7):
     スタジオを改修するとき、**今すでに出ている出力を変えない**こと。
     (a) 行生成   monsters/specs/*.json すべてで buildMoves → renderRows / renderSsrRows の出力を文字列比較
     (b) 背景抜き 既知の合成画像に segment() を掛けた alpha(と、デスピルで書き換わる色)のハッシュ
     (c) 周期検出 合成した周期信号を detectPeriod() に入れて返る周期
     (d) 往復     data.js の全21体で pickEntry の取り出しが元と一致し、1項目だけ変えると
                  変わる行がその1行だけ・評価した値が意図どおり(設計仕様 §11 [11][12][13][27])
     (e) 属性     studio_web.html の onclick= 等から呼ばれる関数がすべて定義されている(§11 [17])
     (f) 技名     data.js の全技名が MOVE_AURA のキーにある(§11 [14])
     (g) 更新履歴 changelogWarnings(ツール側)と changelog_check.mjs が同じ警告を出す(§11 [39])

   使い方:
     node tools/studio_regress.mjs --update   ゴールデン(tools/_golden/)を作り直す
     node tools/studio_regress.mjs            ゴールデンと比べる(違えば終了コード1)
     node tools/studio_regress.mjs --only rows|segment|period|roundtrip|handlers|moveaura|changelog   項目を絞る

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
  const tail = ';({ELEMENTS,SIGNATURE_MOVES,SKIN_CONFIG,MOVE_AURA,MONSTER_AURA,SSR_SKIN_TIER3,SSR_SKIN_AURA,UPDATE_HISTORY,CHANGELOG_TAGS});';
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
    /* MONSTER_AURA は1行に何項目も書く表なので、行頭の錨(^  key:)では
       **行の先頭にある項目しか取れない**(取れないこと自体は今の書き戻しの対象外なので許す)。
       取れたときに位置が正しいことだけを見る。 */
    const ma = S.pickEntry(src, 'MONSTER_AURA', key);
    if(ma){
      if(src.slice(0, ma.start) + ma.valueText + src.slice(ma.end) !== src)
        fail('roundtrip', `${at('MONSTER_AURA')}の取り出し位置がずれています`);
      if(ma.valueText.replace(/'/g, '') !== base.MONSTER_AURA[key])
        fail('roundtrip', `${at('MONSTER_AURA')}の値が違います(${ma.valueText})`);
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

  notes.push(`MONSTER_AURA は行頭にある ${maReach}/${keys.length} 体だけ pickEntry で取れる(1行に複数項目を書く表のため)`);
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
  const d = evalDataJs(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8'));
  const auraKeys = new Set(Object.keys(d.MOVE_AURA));
  let n = 0;
  for(const key of Object.keys(d.SIGNATURE_MOVES)) for(const mv of d.SIGNATURE_MOVES[key]){
    n++;
    if(!auraKeys.has(mv.name)) fail('moveaura', `SIGNATURE_MOVES.${key} の「${mv.name}」が MOVE_AURA にありません`);
  }
  // SSR側は別経路。抜けていても止めないが、数だけ出しておく
  const ssrMissing = Object.keys(d.SSR_SKIN_TIER3 || {}).filter(id => !d.SSR_SKIN_AURA[id]);
  if(ssrMissing.length) fail('moveaura', `SSR_SKIN_AURA が無いSSR専用tier3: ${ssrMissing.join(', ')}`);
  return `${n}技`;
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

/* ------------------------------------------------------------ 実行 */
const done = [];
if(want('rows'))      done.push('行生成 ' + runRows());
if(want('segment'))   done.push('背景抜き ' + runSegment());
if(want('period'))    done.push('周期検出 ' + runPeriod());
if(want('roundtrip')) done.push('往復 ' + runRoundTrip());
if(want('handlers'))  done.push('属性 ' + runHandlers());
if(want('moveaura'))  done.push('技名 ' + runMoveAura());
if(want('changelog')) done.push('更新履歴 ' + runChangelog());
if(shown.length){
  console.log('往復(1項目変更)の変更行:');
  for(const s of shown) console.log('  - ' + s);
  console.log('');
}

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
