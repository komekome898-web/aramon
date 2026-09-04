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
     node tools/studio_regress.mjs --only rows|segment|period|roundtrip|handlers|moveaura|changelog|edit|se   項目を絞る

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
/* ズームしているだけの入力(歩行は無い)。同じ模様が少しずつ大きくなるだけなので、
   自己相関に山は立たないが**谷は立つ** —— つまり「谷から周期を求める枝(how='dip')」を
   通る。ここが「歩行の周期あり」と判定されていたのが批評3。 */
function makeZoomGrays(n, k){
  const W = 48, out = [];
  for(let i=0;i<n;i++){
    const g = new Float32Array(W*W);
    const s = 1 + k*i/n;                                   // だんだん拡大
    for(let y=0;y<W;y++) for(let x=0;x<W;x++){
      const u = (x-24)/s + 24, v = (y-24)/s + 24;
      g[y*W+x] = 110 + 40*Math.sin(u*0.5)*Math.cos(v*0.4);
    }
    out.push(g);
  }
  return out;
}
async function runPeriod(){
  const out = {};
  for(const n of [48, 32]) for(const P of [12, 16, 20]) for(const amp of [40, 8]){
    out[`n${n}_p${P}_a${amp}`] = S.detectPeriod(makeGrays(n, P, amp), n);
  }
  // 動きがまったく無い(周期が出ない)入力も、返り値が変わらないことを見る
  out.flat_n48 = S.detectPeriod(makeGrays(48, 16, 0), 48);
  compareJson('period', path.join(GOLDEN, 'period.json'), out);

  /* --- 周期の診断(A2')。**periodDiag は detectPeriod と同じ周期を返す**のが前提。
     ここがずれると「診断は周期ありと言うのに、切り出しは周期なしで動く」ことになる。 */
  const diag = {};
  for(const n of [48, 32]) for(const P of [12, 16, 20]) for(const amp of [40, 8]){
    const g = makeGrays(n, P, amp);
    const d = S.periodDiag(g, n);
    const k = `n${n}_p${P}_a${amp}`;
    if(d.period !== out[k]) fail('period', `${k}: periodDiag の周期 ${d.period} が detectPeriod ${out[k]} と違います`);
    diag[k] = { how:d.how, peak:Math.round(d.peak*1000)/1000, peakLag:d.peakLag,
                found:S.periodFound(d) };
  }
  /* ズームだけの入力: 谷から周期を求める枝(how='dip')を通るが、強さは 0.05 しかない。
     ここを how で見ていたころは「歩行の周期が見つかりました」と言い、
     「自動」でも第2手(動きが最大の窓)へ切り替わらなかった。 */
  const zoom = S.periodDiag(makeZoomGrays(48, 1.5), 48);
  if(zoom.how !== 'dip')
    fail('period', `ズームだけの入力が谷の枝を通っていません(how=${zoom.how})。検査の入力を見直してください`);
  if(S.periodFound(zoom))
    fail('period', `ズームだけの入力を「歩行の周期あり」と判定しました(強さ ${zoom.peak})`);
  diag.zoom_n48 = { how:zoom.how, peak:Math.round(zoom.peak*1000)/1000, peakLag:zoom.peakLag,
                    found:S.periodFound(zoom) };
  /* 動きがまったく無い入力は「歩行の周期が見つからない」と言えること。
     ここが 'none' 以外を返すと、揺れているだけの動画で黙って周期を採ってしまう。 */
  const flat = S.periodDiag(makeGrays(48, 16, 0), 48);
  if(flat.how !== 'none')
    fail('period', `動きの無い入力で周期あり(${flat.how})と判定しました。歩行の周期は見つからないはずです`);
  if(flat.peak >= S.PERIOD_PEAK_MIN)
    fail('period', `動きの無い入力の周期の強さが ${flat.peak}(${S.PERIOD_PEAK_MIN} 未満のはず)`);
  diag.flat_n48 = { how:flat.how, peak:Math.round(flat.peak*1000)/1000, peakLag:flat.peakLag,
                    found:S.periodFound(flat) };
  /* 「歩行の周期があるか」を決めるのは **periodFound 1か所**で、見るのは強さだけ(§批評3)。
     how(peak / dip / none)で決めると、谷から周期を求めた枝で強さが足りなくても
     「見つかりました」になる。全ケースで「強さだけで決まっている」ことを見る。 */
  for(const [k, d] of Object.entries(diag))
    if(d.found !== (d.peak >= S.PERIOD_PEAK_MIN))
      fail('period', `${k}: periodFound が強さ以外で決まっています(強さ ${d.peak} / 判定 ${d.found})`);
  compareJson('perioddiag', path.join(GOLDEN, 'perioddiag.json'), diag);

  /* --- 「歩いていると言えるか」と「周期を信用して切ってよいか」は**別の判定**(§指摘27)。
     1つの数字で両方を決めていたころは、谷から正しい周期が取れている素材まで
     強さ不足だけで第2手へ落ち、1周期に足りない所で切って継ぎ目が飛んでいた。 */
  for(const [k, d] of [['zoom_n48', zoom], ['flat_n48', flat]].concat(
        [['peak', S.periodDiag(makeGrays(48, 16, 40), 48)]])){
    if(S.periodUsable(d) !== (d.how !== 'none'))
      fail('period', `${k}: periodUsable が how 以外で決まっています(how ${d.how})`);
  }
  // ズームだけの入力は「歩行ではない」が「周期の長さは取れている」= 2つの答えが割れる場合
  if(S.periodFound(zoom) || !S.periodUsable(zoom))
    fail('period', 'ズームだけの入力で「歩行ではないが周期は取れている」を表せていません' +
                   `(歩行 ${S.periodFound(zoom)} / 周期 ${S.periodUsable(zoom)})`);

  /* --- どちらの手で切るかは**測った動きで決める**(§指摘28)。強さでは決めない。
     人が選んだときはそのまま、周期の長さが取れていなければ第2手、
     どちらも使えるなら**並ぶ8コマの隣接差の最小が大きいほう**。 */
  const scLo = { period:{ min:2.62, avg:3.22 }, move:{ min:3.45, avg:4.13 } };  // front.webm の実測
  const scHi = { period:{ min:5.0,  avg:6.0  }, move:{ min:1.0,  avg:2.0  } };
  const strong = S.periodDiag(makeGrays(48, 16, 40), 48);
  if(!S.periodFound(strong))
    fail('period', '検査の入力が弱すぎます(強い周期のつもりの入力で periodFound が false)');
  if(S.cutHowFor('auto', strong, scLo) !== 'move')
    fail('period', '自動が、周期が強くても動きの大きい第2手を採っていません(§指摘28)');
  if(S.cutHowFor('auto', strong, scHi) !== 'period')
    fail('period', '自動が、周期のほうがよく動くのに第2手を採りました');
  if(S.cutHowFor('auto', flat, scHi) !== 'move')
    fail('period', '周期の長さが取れていない(none)のに周期で切ろうとしています(§指摘27)');
  for(const want of ['period', 'move'])
    if(S.cutHowFor(want, strong, scLo) !== want)
      fail('period', `人が「${want}」を選んだのに自動の判定で上書きしました`);

  /* --- 抜いた後の8コマの隣接差(§11 [25])。
     **同じ絵が8枚なら止める**のがここの目的。今までは黙って「問題なし」と言っていた。 */
  const W = S.DIAG_W;
  const same = [], moving = [];
  for(let k=0;k<8;k++){
    const a = new Float32Array(W*W), b = new Float32Array(W*W);
    for(let i=0;i<W*W;i++){ a[i] = 100; b[i] = 100 + 30*Math.sin(i*0.05 + k); }
    same.push(a); moving.push(b);
  }
  const dSame = S.diffStat(S.adjacentDiffs(same));
  const dMove = S.diffStat(S.adjacentDiffs(moving));
  if(dSame.min >= S.FRAME_SAME_DIFF)
    fail('period', `同じ絵8枚の隣接差が ${dSame.min}(${S.FRAME_SAME_DIFF} 未満で「同じ絵」と判定するはず)`);
  if(dMove.min < S.FRAME_SAME_DIFF)
    fail('period', `動いている8枚を「同じ絵」と判定しました(最小 ${dMove.min})`);

  /* --- 「コマが変わっていない」の判定は**2つの見方**で見る(隣 と 時間をおいて)。
     隣だけで見ると、ゆっくり動く素材(発注者のSeedance動画は隣接差 1.1〜2.8)を
     「1コマも進んでいない」と誤って弾く。止まっている動画は**どちらも0**。 */
  const mkRun = (n, f)=>{
    const out = [];
    for(let i=0;i<n;i++){ const g = new Float32Array(W*W);
      for(let j=0;j<W*W;j++) g[j] = f(i, j); out.push(g); }
    return out;
  };
  const judge = run => {
    let mv = 0, sp = 0;
    for(let i=1;i<run.length;i++){
      mv = Math.max(mv, S.grayDiff(run[i], run[i-1]));
      sp = Math.max(sp, S.grayDiff(run[i], run[0]));
    }
    return { mv, sp, stop: mv < S.MOVE_MIN_DIFF && sp < S.MOVE_SPAN_MIN_DIFF };
  };
  // ① 完全に止まっている動画 → 止める(2026-08-11 の守りが効いたまま)
  const stuck = judge(mkRun(30, (i,j)=> 100 + 20*Math.sin(j*0.05)));
  if(!stuck.stop) fail('period', `止まっている動画を通しました(隣 ${stuck.mv} / 時間 ${stuck.sp})`);
  // ② 隣は小さいが時間をおくと動く動画(AI動画) → 通す
  const slow = judge(mkRun(30, (i,j)=> 100 + 20*Math.sin(j*0.05 + i*0.02)));
  if(slow.mv >= S.MOVE_MIN_DIFF)
    fail('period', `検査用の「ゆっくり動く」入力の隣接差が大きすぎます(${slow.mv})`);
  if(slow.stop) fail('period', `ゆっくり動く動画を弾きました(隣 ${slow.mv} / 時間 ${slow.sp})`);

  /* --- 第2手(動きが最大の窓)。前半だけが動く並びで、窓が前半に来ること。 */
  const rawT = [], raw = [];
  for(let i=0;i<40;i++){
    rawT.push(i*0.1);
    const g = new Float32Array(W*W);
    for(let j=0;j<W*W;j++) g[j] = 100 + (i < 20 ? 40*Math.sin(j*0.05 + i*1.3) : 0);
    raw.push(g);
  }
  const win = S.bestMoveWindow(rawT, raw, 1.0);
  if(win.t0 > 1.1) fail('period', `動きが最大の窓が ${win.t0} 秒から(前半のはず)`);
  if(!(win.sum > 0)) fail('period', '動きが最大の窓の動き量が0です');

  /* --- 足元の影(A3)。影の無い絵では**1画素も変わらない**ことが要。 */
  const SW = 40, sImg = { width:SW, height:SW, data:new Uint8ClampedArray(SW*SW*4) };
  const sAlpha = new Uint8Array(SW*SW);
  const put = (x, y, r, g, b)=>{ const i = y*SW+x;
    sImg.data[i*4]=r; sImg.data[i*4+1]=g; sImg.data[i*4+2]=b; sImg.data[i*4+3]=255; sAlpha[i]=255; };
  // 体(明るい・彩度あり)+ 2本の脚。影はまだ置かない
  for(let y=6;y<28;y++) for(let x=14;x<26;x++) put(x, y, 230, 90, 60);
  for(let y=28;y<36;y++) for(let x=16;x<19;x++) put(x, y, 220, 80, 50);
  for(let y=28;y<36;y++) for(let x=22;x<25;x++) put(x, y, 220, 80, 50);
  const noShadow = new Uint8Array(sAlpha);
  const box0 = S.bboxOf(noShadow, SW, SW);
  if(S.dropFootShadow(sImg, noShadow, SW, SW, box0) !== 0)
    fail('period', '影の無い絵で足元の影を落としました(何も変わってはいけない)');
  if(!noShadow.every((v,i)=> v === sAlpha[i]))
    fail('period', '影の無い絵でアルファが変わりました');
  // 足元に「暗くて灰色で横長」の帯を足すと、その帯だけが消えること
  for(let y=34;y<37;y++) for(let x=8;x<32;x++) put(x, y, 45, 44, 46);
  const withShadow = new Uint8Array(sAlpha);
  const dropped = S.dropFootShadow(sImg, withShadow, SW, SW, S.bboxOf(withShadow, SW, SW));
  if(dropped <= 0) fail('period', '足元の影を落とせませんでした');
  for(let y=0;y<SW;y++) for(let x=0;x<SW;x++){
    const i = y*SW+x;
    const isShadow = (y >= 34 && y < 37 && x >= 8 && x < 32);
    if(isShadow && withShadow[i] !== 0) fail('period', `影の画素 (${x},${y}) が残っています`);
    if(!isShadow && withShadow[i] !== sAlpha[i]) fail('period', `影ではない画素 (${x},${y}) まで消しました`);
  }
  /* 影の結果の言い方(footShadowNote)。**見つからなかったときに黙らない**こと(§指摘35c) ——
     ONなのに何も起きなければ、影が無いのか検出が効いていないのかを画面から区別できない。
     文言そのものは変わりうるので、**言っているかどうか**だけを見る。 */
  if(S.footShadowNote({ px:0, split:0, found:0, n:16 }, false) !== '')
    fail('period', '「影を落とす」がOFFなのに影の話をしています');
  const noteNone = S.footShadowNote({ px:0, split:0, found:0, n:16 }, true);
  if(!noteNone || !/見つから/.test(noteNone))
    fail('period', `影が1コマも見つからなかったときに黙っています(「${noteNone}」)`);
  const noteSplit = S.footShadowNote({ px:0, split:6, found:6, n:16 }, true);
  if(!/6コマ/.test(noteSplit) || !/16コマ/.test(noteSplit))
    fail('period', `判定が割れたときに「何コマ中何コマ」を出していません(「${noteSplit}」)`);
  const noteDrop = S.footShadowNote({ px:1234, split:0, found:16, n:16 }, true);
  if(!/1234/.test(noteDrop)) fail('period', `落とした画素数を出していません(「${noteDrop}」)`);

  const real = await runRealAssets();
  return `${Object.keys(out).length}通り + 診断${Object.keys(diag).length}通り + 隣接差 + ` +
         `動きの判定 + 第2手 + 歩行かどうかと周期の使えるかを分ける + 切り方は測った動きで決める + ` +
         `足元の影 + 影の言い方4通り + ${real}`;
}

/* ------------------------------------------- (c2) 実素材(monsters/*.png)で見る3つ

   合成した絵だけでは通ってしまい、実素材で初めて出た不具合がある。

   ① **足元の影の誤爆**(§批評10): ゲームに入っている静止画は**もう整えてある**ので、
      足元の影として消える画素は1つも無いのが正。それでも illumine(479画素)・
      mocchi_ssr(2322画素)が消えていた —— 絵の下に引いてある**細い線画**が
      「暗い・灰色・横に長い」の3つに当たっていたため。
   ② **同じ歩行系列の中で判定が割れる**(§再批評26): 詰まり具合(`SHADOW_FILL`=0.35)が
      最後の分かれ目になっていたため、`iblees_ssr_walk_b1..b8` は詰まりが 0.298〜0.385 と
      閾値をまたぎ、**8コマ中6コマだけ蹄が消えて**足元合わせの基準(box.y1)が
      293〜299 で跳ねた(`phoenix_ssr_walk_b8` も1コマだけ足が消えた)。
      いまは形の条件(左右幅いっぱい・帯の上端で切れていない)で分け、さらに
      **系列でそろわなければ1コマも落とさない**(`settleFootShadow`)。
      **歩行704枚を系列ごとに通し、割れたまま落としていないことを見る。**
   ③ **透過済みPNGの素通し**(§批評1): 「自動」は抜き方を明示していないので、
      透過済みの絵はその透過をそのまま使う。素通しの印を渡し忘れていたころは
      白抜き・色抜きが当たり、**透明な所まで前景**になっていた。
   ④ **本物の落ち影がある16コマでは、全コマ落ちる**(§指摘35c): ①〜③は「落としすぎない」
      側しか見ていないので、締めすぎて**1画素も落ちなくなっても気づけなかった**。
      ゲームの絵はもう整えてあって落ち影が無いから、**焼き込んで作る**(下記)。       */
const REAL_WALK = /_walk_/;                         // 歩行コマ(影が焼き込まれている絵がある)
const REAL_SHADOW_ONE = 'illumine_walk_f1.png';     // 本物の落ち影が焼き込まれている1枚
const REAL_ALPHA_ONE  = 'joker.png';                // 素通しを見る透過済みPNG
// 再批評26で「同じ系列の中で判定が割れた」と名指しされた系列(誤爆が戻っていないかを直に見る)
const REAL_SPLIT_WAS = ['iblees_ssr_walk_b', 'phoenix_ssr_walk_b'];
const REAL_CHUNK = 16;                              // 生バイトを一度に置く枚数(1024²は1枚4MB)
/* ④ 焼き込み影を作る材料(§指摘35c)。
   ・落ち影 … 足元の帯の中の被写体幅 × `BURN_FOOT_MUL` の暗い横長の楕円を、
     被写体の**すぐ下**へ置く(AI動画の落ち影と同じ出方。被写体の画素は塗り替えない)。
     大きさは**系列で1つ**にする —— 地面は動かないので、コマごとに変えると
     「足元合わせの基準がそろうか」を見ている意味が無くなる。
   ・武器 … 上半身の高さに**画面の端まで伸びる明るい帯**を足して枠の幅を広げる。
     これで影の幅/枠の幅が 0.43〜0.63 まで落ち、**幅を「枠の幅」で比べていた作りなら
     いまのしきい値(`SHADOW_MIN_W`)でも1画素も落ちない**形になる(§指摘35a)。
     検査はそれも確かめる —— 確かめないと「張り出しのある絵」を通したつもりで
     通していない検査になる。                                                      */
const BURN_SERIES   = ['zan_walk_', 'joker_walk_'];  // 武器・外套が横へ張り出す体
const BURN_FOOT_MUL = 1.25;            // 影の幅 = 足元の帯の中の被写体幅のこの倍
const BURN_H_RATIO  = 0.05;            // 影の高さ = 被写体の高さのこの割合
const BURN_RGB      = [10, 10, 12];    // 暗い灰色(どの絵でも明るさの中央値より十分暗い)
const BURN_ARM_Y    = 0.30;            // 「武器」の高さ(被写体の上端からの割合)
const BURN_ARM_H    = 0.04;            // 「武器」の太さ(被写体の高さの割合)
const BURN_ARM_RGB  = [240, 190, 60];  // 明るく彩度がある = 影の候補にならない色
// 歩行コマの系列名(末尾の番号を落とす。iblees_ssr_walk_b3.png -> iblees_ssr_walk_b)
const walkSeriesOf = name => name.replace(/\d+\.png$/, '');
// PNG のデコードは python3(Pillow)に任せる(node 側に自前のデコーダを置かない)
function decodePngs(names, outDir){
  const py = `
import sys, os, json
from PIL import Image
root, out = sys.argv[1], sys.argv[2]
meta = {}
for name in sys.argv[3:]:
    im = Image.open(os.path.join(root, 'monsters', name)).convert('RGBA')
    meta[name] = im.size
    with open(os.path.join(out, name + '.raw'), 'wb') as f:
        f.write(im.tobytes())
print(json.dumps(meta))
`;
  const r = spawnSync('python3', ['-c', py, ROOT, outDir, ...names],
                      { encoding:'utf8', maxBuffer:1<<28 });
  if(r.status !== 0) throw new Error('python3(Pillow)でPNGを読めませんでした: ' + (r.stderr || r.error));
  return JSON.parse(r.stdout.trim().split('\n').pop());
}
async function runRealAssets(){
  const dir = path.join(ROOT, 'monsters');
  const all = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();
  const still = all.filter(f => !REAL_WALK.test(f));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio_regress-real-'));
  let checked = 0;
  try{
    // ① 静止画は1画素も消えない。枚数が多いので少しずつ生バイトへ直しては捨てる
    for(let i=0;i<still.length;i+=REAL_CHUNK){
      const chunk = still.slice(i, i+REAL_CHUNK);
      const meta = decodePngs(chunk, tmp);
      for(const name of chunk){
        const [w, h] = meta[name];
        const file = path.join(tmp, name + '.raw');
        const raw = fs.readFileSync(file);
        fs.rmSync(file, { force:true });
        const img = { width:w, height:h, data:new Uint8ClampedArray(raw) };
        const alpha = new Uint8Array(w*h);
        for(let k=0;k<w*h;k++) alpha[k] = raw[k*4+3];
        const drop = S.dropFootShadow(img, alpha, w, h, S.bboxOf(alpha, w, h));
        if(drop !== 0)
          fail('period', `${name}: 整えてある絵から足元の影として ${drop} 画素を消しました(0 のはず)`);
        checked++;
      }
    }
    /* ① の逆: 影が焼き込まれている1枚では、ちゃんと落ちる(形の条件を締めすぎていないこと)。
       **1コマだけを見る入口(`dropFootShadow`)で見る。** この絵の系列(illumine_walk_f*)は
       f1 にしか影のかたまりが出ないので、16コマの道(`settleFootShadow`)では
       「割れた」として1コマも落とさない —— それは②で見る。 */
    if(all.includes(REAL_SHADOW_ONE)){
      const meta = decodePngs([REAL_SHADOW_ONE], tmp);
      const [w, h] = meta[REAL_SHADOW_ONE];
      const raw = fs.readFileSync(path.join(tmp, REAL_SHADOW_ONE + '.raw'));
      const img = { width:w, height:h, data:new Uint8ClampedArray(raw) };
      const alpha = new Uint8Array(w*h);
      for(let k=0;k<w*h;k++) alpha[k] = raw[k*4+3];
      const drop = S.dropFootShadow(img, alpha, w, h, S.bboxOf(alpha, w, h));
      if(drop <= 0)
        fail('period', `${REAL_SHADOW_ONE}: 焼き込まれた落ち影を落とせませんでした(本物の影は落ちるはず)`);
      fs.rmSync(path.join(tmp, REAL_SHADOW_ONE + '.raw'), { force:true });
    }
    // ② 歩行704枚を**系列ごと**に通す(§再批評26c)
    const series = walkSeriesCheck(all.filter(f => REAL_WALK.test(f)), tmp);
    // ③ 透過済みPNG → 「自動」は素通し。明示した抜き方は素通しにしない
    if(all.includes(REAL_ALPHA_ONE)){
      const meta = decodePngs([REAL_ALPHA_ONE], tmp);
      const [w, h] = meta[REAL_ALPHA_ONE];
      const raw = fs.readFileSync(path.join(tmp, REAL_ALPHA_ONE + '.raw'));
      const own = new Uint8Array(w*h);
      for(let k=0;k<w*h;k++) own[k] = raw[k*4+3];
      const mk = ()=> ({ width:w, height:h, data:new Uint8ClampedArray(raw) });
      /* 「自動」は抜き方を明示していない道なので素通しする(§指摘31)。
         **素通しかどうかを決めるのは resolveAlpha 1か所**なので、検査もそこを通す。
         th/chroma は素通しに関係ないが、落とし先(blackopen)へ行ったときのために渡す。 */
      const autoSeg = { mode:'auto', th:14, chroma:null };
      const pass = await S.resolveAlpha(mk(), autoSeg);
      if(!own.every((v,i)=> v === pass[i]))
        fail('period', `${REAL_ALPHA_ONE}: 透過済みPNGが「自動」で素通しになっていません`);
      // 静止画の「自動」(歩行の設定を借りる道)も同じ結果になる
      const passP = await S.imageAlphaFor(mk(), { mode:'blackopen', th:14, chroma:null });
      if(!own.every((v,i)=> v === passP[i]))
        fail('period', `${REAL_ALPHA_ONE}: 静止画の「自動」で素通しになっていません`);
      // 人が選んだ抜き方(=批評1の壊れ方)では、透明な所まで前景になる
      const cut = await S.resolveAlpha(mk(), { mode:'white', th:20, chroma:null });
      let fgInClear = 0;
      for(let k=0;k<w*h;k++) if(own[k] === 0 && cut[k] > 0) fgInClear++;
      if(fgInClear === 0)
        fail('period', '検査の前提が崩れています(明示した抜き方でも素通しと同じ結果になりました)');
      /* makeCut が「自動」で同じ枠を返すこと。**影ONでも通す**(§指摘33) ——
         素通しの絵に足元の影の検出が当たって枠が変わってはいけない。 */
      const boxOwn = S.bboxOf(own, w, h);
      for(const shadow of [false, true]){
        const cutAuto = await S.makeCut(mk(), autoSeg, null, { shadow });
        S.settleFootShadow([cutAuto]);      // 1枚だけの系列(そろっているので落ちるなら落ちる)
        if(JSON.stringify(cutAuto.box) !== JSON.stringify(boxOwn))
          fail('period', `${REAL_ALPHA_ONE}: makeCut(自動・影${shadow?'ON':'OFF'}) の枠 ` +
                         `${JSON.stringify(cutAuto.box)} が元のアルファの枠 ` +
                         `${JSON.stringify(boxOwn)} と違います`);
      }
      fs.rmSync(path.join(tmp, REAL_ALPHA_ONE + '.raw'), { force:true });
    }
    // ④ 焼き込み影のある16コマでは全コマ落ちる(§指摘35c)
    const burnt = burntShadowCheck(tmp);
    return `静止画 ${checked}枚(影0)+ ${series} + 透過済みPNGの素通し(自動・影ON/OFF) + ${burnt}`;
  } finally { fs.rmSync(tmp, { recursive:true, force:true }); }
}

// 足元の帯の中の被写体の幅(= 落ち影の大きさの元。findFootShadow が分母に使うものと同じ見方)
function footBandWidth(alpha, w, box){
  const bh = box.y1-box.y0+1;
  const bandH = Math.max(1, Math.round(bh*S.SHADOW_BAND));
  const yTop = Math.max(box.y0, box.y1 - bandH + 1);
  let x0 = Infinity, x1 = -1;
  for(let y=yTop;y<=box.y1;y++) for(let x=box.x0;x<=box.x1;x++)
    if(alpha[y*w+x] >= 8){ if(x < x0) x0 = x; if(x > x1) x1 = x; }
  return x1 >= x0 ? x1-x0+1 : box.x1-box.x0+1;
}
// 1画素を塗る(色もアルファも入れる)
function paint(img, alpha, i, rgb){
  const p = i*4;
  img.data[p] = rgb[0]; img.data[p+1] = rgb[1]; img.data[p+2] = rgb[2]; img.data[p+3] = 255;
  alpha[i] = 255;
}
/* ④ 焼き込み影のある16コマ(§指摘35c)。見るのは4つ:
     ・**全コマ落ちる**(`settleFootShadow` が found=n・split=0・px>0)
     ・落とす前の足元は**影の底**になっている(=落とさなければ基準が影に乗る)
     ・落とした後の box.y1 が**元の絵の足元へ戻る**(コマ間でそろう)
     ・影の幅/枠の幅が `SHADOW_MIN_W` 未満(=枠の幅で比べる作りなら落ちない形を通している) */
function burntShadowCheck(tmp){
  let series = 0, frames = 0, px = 0;
  for(const key of BURN_SERIES){
    const names = [];
    for(const side of ['f','b']) for(let i=1;i<=8;i++) names.push(`${key}${side}${i}.png`);
    const missing = names.filter(n => !fs.existsSync(path.join(ROOT, 'monsters', n)));
    if(missing.length){
      fail('period', `${key}*.png が足りません(${missing.length}枚。焼き込み影の回帰が空回りしています)`);
      continue;
    }
    const meta = decodePngs(names, tmp);
    // まず素の絵を読み、影の大きさを**系列で1つ**決める(地面は動かない)
    const list = [];
    for(const name of names){
      const [w, h] = meta[name];
      const file = path.join(tmp, name + '.raw');
      const raw = fs.readFileSync(file);
      fs.rmSync(file, { force:true });
      const img = { width:w, height:h, data:new Uint8ClampedArray(raw) };
      const alpha = new Uint8Array(w*h);
      for(let k=0;k<w*h;k++) alpha[k] = raw[k*4+3];
      const box = S.bboxOf(alpha, w, h);
      list.push({ name, img, alpha, w, h, box, foot: footBandWidth(alpha, w, box) });
    }
    const sw = Math.round(Math.max(...list.map(f => f.foot)) * BURN_FOOT_MUL);
    const sh = Math.max(3, Math.round(Math.max(...list.map(f => f.box.y1-f.box.y0+1)) * BURN_H_RATIO));
    const cuts = [];
    for(const f of list){
      const { img, alpha, w, h, box } = f;
      // 落ち影(暗い横長の楕円)を被写体の**すぐ下**へ。被写体の画素は塗り替えない
      const cx = (box.x0+box.x1)/2, cy = box.y1 + sh/2;
      for(let y=Math.max(0, Math.round(cy-sh/2)); y<=Math.min(h-1, Math.round(cy+sh/2)); y++)
        for(let x=Math.max(0, Math.round(cx-sw/2)); x<=Math.min(w-1, Math.round(cx+sw/2)); x++){
          const dx = (x-cx)/(sw/2), dy = (y-cy)/(sh/2);
          if(dx*dx + dy*dy > 1) continue;
          const i = y*w+x;
          if(alpha[i] >= 8) continue;
          paint(img, alpha, i, BURN_RGB);
        }
      // 横へ張り出す「武器」(上半身の高さ・画面の端まで)
      const bh = box.y1-box.y0+1;
      const ay0 = box.y0 + Math.round(bh*BURN_ARM_Y);
      const ay1 = Math.min(h-1, ay0 + Math.max(2, Math.round(bh*BURN_ARM_H)));
      for(let y=ay0;y<=ay1;y++) for(let x=0;x<w;x++) paint(img, alpha, y*w+x, BURN_ARM_RGB);
      const nb = S.bboxOf(alpha, w, h);
      const frameW = nb.x1-nb.x0+1;
      if(!(sw < frameW*S.SHADOW_MIN_W))
        fail('period', `${f.name}: 影の幅 ${sw} が枠の幅 ${frameW} の ${S.SHADOW_MIN_W} 倍未満に` +
                       'なっていません(張り出しのある形を通せていない検査です)');
      if(!(nb.y1 > box.y1))
        fail('period', `${f.name}: 焼き込んだ影が足元より下に出ていません(検査の前提が崩れています)`);
      // makeCut と同じ持ち方(切り抜きは要らないので box と shadow だけ)
      const g = S.findFootShadow(img, alpha, w, h, nb);
      const cut = { name:f.name, box:nb, drop:0, y1Feet:box.y1, y1Burnt:nb.y1 };
      if(g) cut.shadow = { px:g.idx.length, box:g.box, gray:null, idx:g.idx };
      cuts.push(cut);
      f.img = f.alpha = null;      // 1コマずつ手放す(16コマぶんを抱えない)
    }
    const out = S.settleFootShadow(cuts);
    if(out.found !== out.n || out.split !== 0 || !(out.px > 0))
      fail('period', `${key}: 焼き込んだ落ち影を ${out.found}/${out.n}コマでしか見つけられず、` +
                     `${out.px}画素しか落としていません(全コマ落ちるはず)`);
    for(const c of cuts)
      if(c.box.y1 !== c.y1Feet)
        fail('period', `${c.name}: 影を落とした後の足元 ${c.box.y1} が元の絵の足元 ${c.y1Feet} と` +
                       `違います(落とす前は ${c.y1Burnt} = 影の底)`);
    series++; frames += cuts.length; px += out.px;
  }
  return `焼き込み影 ${frames}枚/${series}系列(全コマ落ちる・足元が影の底から元へ戻る / ${px}画素)`;
}

/* 歩行コマを**系列ごと**に通し、「1つの系列の中で判定が割れたまま落としていない」ことを見る
   (§再批評26c)。落とすかどうかを決めるのは `settleFootShadow` の1か所なので、
   検査もその関数をそのまま呼ぶ(判定を検査側に写さない)。
   見るのは3つ:
     ・系列の中で**落ちたコマと落ちないコマが混ざらない**(混ざると足元合わせの基準が跳ねる)
     ・検出が割れた系列では**1画素も落ちない**
     ・再批評で名指しされた系列(iblees / phoenix)で**誤爆が1コマも出ない**、かつ
       その系列の box.y1 が全コマでそろう                                              */
function walkSeriesCheck(names, tmp){
  const bySeries = {};
  for(const n of names) (bySeries[walkSeriesOf(n)] = bySeries[walkSeriesOf(n)] || []).push(n);
  // 名指しの系列が消えていたら黙って検査が減るので、そこで気づけるようにする
  for(const k of REAL_SPLIT_WAS)
    if(!bySeries[k]) fail('period', `${k}*.png が見つかりません(再批評26の回帰が空回りしています)`);
  let frames = 0, split = 0, dropped = 0;
  for(const [key, list] of Object.entries(bySeries)){
    const cuts = [];
    for(let i=0;i<list.length;i+=REAL_CHUNK){
      const chunk = list.slice(i, i+REAL_CHUNK);
      const meta = decodePngs(chunk, tmp);
      for(const name of chunk){
        const [w, h] = meta[name];
        const file = path.join(tmp, name + '.raw');
        const raw = fs.readFileSync(file);
        fs.rmSync(file, { force:true });
        const img = { width:w, height:h, data:new Uint8ClampedArray(raw) };
        const alpha = new Uint8Array(w*h);
        for(let k=0;k<w*h;k++) alpha[k] = raw[k*4+3];
        const box = S.bboxOf(alpha, w, h);
        // makeCut と同じ持ち方(切り抜きは要らないので box と shadow だけ)
        const f = box ? S.findFootShadow(img, alpha, w, h, box) : null;
        const cut = { name, box, drop:0 };
        if(f) cut.shadow = { px:f.idx.length, box:f.box, gray:null, idx:f.idx };
        cuts.push(cut);
        frames++;
      }
    }
    const found = cuts.filter(c => c.shadow).length;
    const out = S.settleFootShadow(cuts);
    if(found && found !== cuts.length) split++;
    dropped += out.px;
    // 系列の中で「落ちた/落ちない」が混ざっていないこと
    const on = cuts.filter(c => c.drop > 0).length;
    if(on !== 0 && on !== cuts.length)
      fail('period', `${key}: 系列 ${cuts.length}コマのうち ${on}コマだけ足元の影を落としました` +
                     '(混ざると足元合わせの基準が跳ねます)');
    if(found !== cuts.length && out.px !== 0)
      fail('period', `${key}: 判定が ${found}/${cuts.length}コマで割れているのに ${out.px}画素を落としました`);
    // 再批評で名指しされた系列は、誤爆が1コマも出ず box.y1 がそろうこと
    if(REAL_SPLIT_WAS.includes(key)){
      if(found !== 0)
        fail('period', `${key}: 誤爆が ${found}/${cuts.length}コマで戻っています(0のはず)`);
      const ys = new Set(cuts.map(c => c.box && c.box.y1));
      if(ys.size !== 1)
        fail('period', `${key}: 足元合わせの基準 box.y1 が系列の中でそろっていません` +
                       `(${[...ys].join(', ')})`);
    }
  }
  return `歩行 ${frames}枚/${Object.keys(bySeries).length}系列` +
         `(判定が割れた系列 ${split} — いずれも落とさない / 落とした画素 ${dropped})`;
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

/* ============================================================ (j) 見せ方(残り時間・失敗の言い方)

   E3/E4 で「見積もりの式」と「よくある失敗→日本語」をそれぞれ1か所へ寄せた。
   どちらも純粋な関数なので、ブラウザを起こさずここで毎回確かめる。
     ・etaText は**実測から**出す(固定値を返さない)。1件も終わっていない・
       終わっているときは黙る(嘘の残り時間を出さない)。
     ・errorText は英語の例外を必ず日本語にし、**自前の日本語はそのまま通す**。
       ここが逆になると「動画を選んでください」まで丸められて意味が消える。            */
function runWording(){
  const now = Date.now();
  // ① 実測から出ているか(同じ done/total でも、掛かった時間が倍なら残りも倍)
  const a = S.etaText(1, 5, now - 1000), b = S.etaText(1, 5, now - 2000);
  if(!/残り約4秒/.test(a)) fail('wording', `etaText(1,5,-1秒)が「${a}」です(残り約4秒のはず)`);
  if(!/残り約8秒/.test(b)) fail('wording', `etaText(1,5,-2秒)が「${b}」です(残り約8秒のはず)`);
  if(a === b) fail('wording', 'etaText が実測を見ていません(固定値になっています)');
  // ② 分まで伸びたら分で言う(44MBの取得は電波次第で分単位)
  if(!/残り約2分/.test(S.etaText(1, 3, now - 60000)))
    fail('wording', 'etaText が長い待ちを分で言いません: ' + S.etaText(1, 3, now - 60000));
  // ③ 出せないときは黙る(0件目・終わった後・時刻なし)
  for(const [d, t, st] of [[0, 8, now-1000], [8, 8, now-1000], [1, 8, 0]])
    if(S.etaText(d, t, st) !== '') fail('wording', `etaText(${d},${t}) が黙りません: ${S.etaText(d, t, st)}`);
  /* ④ 1件あたりの実測から出す道(etaByRate)も同じ式に載っている。
     **返り値そのものを見る**(§指摘13) —— 2つの呼び出しの結果を突き合わせる書き方は、
     間に1ミリ秒でも挟まると別の文字列になるので、たまに落ちる検査になっていた。 */
  if(!/残り約4秒/.test(S.etaByRate(1000, 4)))
    fail('wording', `etaByRate(1秒/件, 残り4件)が「${S.etaByRate(1000, 4)}」です(残り約4秒のはず)`);
  // ⑤ 失敗の言い方。英語は日本語へ、自前の日本語はそのまま
  const cases = [
    [new Error('GitHub 401: Bad credentials'), /トークンが切れています/],
    [new Error('GitHub 403: Resource not accessible by personal access token'), /権限/],
    /* 送りすぎの 403 は**権限の話にしない**(§指摘11)。待てば通るので、
       「権限を確かめてください」と言われると直しようのないことをさせてしまう。 */
    [new Error('GitHub 403: You have exceeded a secondary rate limit'), /1分ほど待って/],
    [new Error('GitHub 404: Not Found'), /リポジトリ名とブランチ名/],
    [new Error('GitHub 422: Update is not a fast forward'), /やり直して/],
    [new Error('Failed to fetch'), /通信できませんでした/],
    [new Error('The source image could not be decoded'), /読み取れませんでした/],
    /* `ERR_` を裸で拾っていた頃は、動画のデコード失敗まで「電波の届く所で」になっていた。
       通信の失敗として拾うのは**ブラウザのネットワークエラー名の頭**だけ(§指摘11)。 */
    [new Error('MEDIA_ERR_DECODE'), /読み取れませんでした/],
    [new Error('net::ERR_CONNECTION_RESET'), /通信できませんでした/],
    [new Error('動画を選んでください'), /^動画を選んでください$/],
    [new Error('被写体を検出できませんでした'), /^被写体を検出できませんでした$/],
    [new Error('Something totally unknown'), /うまくいきませんでした.*Something totally unknown/],
  ];
  for(const [e, re] of cases)
    if(!re.test(S.errorText(e))) fail('wording', `errorText(${e.message}) が「${S.errorText(e)}」です`);
  return `残り時間 5通り / 失敗の言い方 ${cases.length}通り`;
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

  /* 更新履歴の「書き直す行」の選び方(§指摘1)。**候補はこのツールが書いた形の行だけ。**
     changelogSimilarity の分母は短いほうの語数なので、「ジョーカー」を含む行は
     告知でも 1.00 になる。絞らないと**その日の告知(🆕・✵)を書き直して消す。** */
  const chItems = [{ t:'ザン: 威力30→40・連射5→7', g:['balance'] },
                   { t:'ジョーカー: 威力21→34', g:['balance'] }];
  if(S.editRewriteIndex(chItems, 'ジョーカー', 'ジョーカー: 威力21→50') !== 1)
    fail('edit', '同じ体の行を書き直しません');
  if(S.editRewriteIndex([chItems[0]], 'ジョーカー', 'ジョーカー: 威力21→50') !== -1)
    fail('edit', '別の体の行(ザン)を「似た行」として書き直そうとしています');
  if(S.editRewriteIndex(chItems, '', 'ジョーカー: 威力21→50') !== -1)
    fail('edit', '表示名が無いのに書き直す行を選んでいます');
  // 告知の行(🆕 新モンスター / ✵ 覚醒 / ✨)は、同じ体でも書き直さない
  const announce = [{ t:'🆕 新モンスター「ジョーカー」が登場しました!闇の技で切り裂きます', g:['feature','monster'] },
                    { t:'✵ ジョーカーに覚醒の姿が追加されました', g:['feature'] },
                    { t:'✨ ジョーカーのSSRスキンが登場しました', g:['feature'] }];
  for(let i = 0; i < announce.length; i++){
    if(S.changelogSimilarity(announce[i].t, 'ジョーカー: HP115→120') < S.CHANGELOG_SIMILAR)
      fail('edit', `検査の前提が崩れています(${announce[i].t} が似た行と判定されない)`);
    if(S.editRewritableLine(announce[i].t, 'ジョーカー'))
      fail('edit', `告知の行を書き直しの候補にしています: ${announce[i].t}`);
  }
  if(S.editRewriteIndex(announce, 'ジョーカー', 'ジョーカー: HP115→120') !== -1)
    fail('edit', '同じ体の告知の行を書き直そうとしています(その日の告知が消えます)');
  if(S.editRewriteIndex(announce.concat([{ t:'ジョーカー: 威力21→34', g:['balance'] }]),
                        'ジョーカー', 'ジョーカー: HP115→120') !== 3)
    fail('edit', '告知に混じったツールの形の行を選べていません');
  // 「表示名を含む」だけでは足りない(体の名前が本文の途中に出る行も候補にしない)
  if(S.editRewritableLine('レイドのボスにジョーカーが登場します', 'ジョーカー'))
    fail('edit', '本文の途中に表示名がある行を書き直しの候補にしています');
  /* 候補の判定は**先頭が `表示名: ` かどうかの1本**(§指摘20)。告知の行は記号で始まるので
     この1本だけで落ちる —— 先頭の記号を並べた表(CHANGELOG_ANNOUNCE)は
     この1本を通り抜けられず、**一度も効かない枝**だったので消した。
     消したことで挙動が変わっていないことを、記号側と本文側の両方から見る。 */
  if(S.editRewritableLine('🆕 ジョーカー: 新しく登場しました', 'ジョーカー'))
    fail('edit', '記号で始まる行を候補にしています(先頭が「表示名: 」ではありません)');
  if(!S.editRewritableLine('ジョーカー: 威力21→34', 'ジョーカー'))
    fail('edit', 'このツールが書いた形の行を候補から外しています');
  // 既定の選び方が読む候補の一覧(fillEditChangelog と editRewriteIndex が同じここを読む)
  if(JSON.stringify(S.editRewriteCandidates(announce, 'ジョーカー')) !== '[]')
    fail('edit', '告知しか無い日に書き直せる行があると言っています');
  const mixed = [{ t:'ザン: 威力30→40', g:['balance'] }, announce[0],
                 { t:'ジョーカー: 威力21→34', g:['balance'] },
                 { t:'ジョーカー: HP115→120', g:['balance'] }];
  if(JSON.stringify(S.editRewriteCandidates(mixed, 'ジョーカー')) !== '[2,3]')
    fail('edit', `書き直せる行の並びが違います(${JSON.stringify(S.editRewriteCandidates(mixed, 'ジョーカー'))})`);
  if(S.editRewriteCandidates(mixed, '').length)
    fail('edit', '表示名が無いのに書き直せる行があると言っています');

  /* 更新履歴の突き合わせは**項目ごとに t と g で**見る(§指摘15)。
     丸ごと JSON.stringify だと `{t,g}` と `{g,t}` の並びの違いだけで止まっていた。 */
  const hA = [{ date:'2026-09-02', items:[{ t:'あ', g:['balance'] }] }];
  const hB = [{ date:'2026-09-02', items:[{ g:['balance'], t:'あ' }] }];
  if(S.historyDiffers(hA, hB)) fail('edit', 'キーの並びが違うだけで更新履歴を「変わった」と言っています');
  if(!S.historyDiffers(hA, [{ date:'2026-09-02', items:[{ t:'い', g:['balance'] }] }]))
    fail('edit', '更新履歴の本文が変わったのに見逃しています');
  if(!S.historyDiffers(hA, [{ date:'2026-09-02', items:[{ t:'あ', g:['monster'] }] }]))
    fail('edit', '更新履歴のタグが変わったのに見逃しています');
  if(!S.historyDiffers(hA, [{ date:'2026-09-03', items:[{ t:'あ', g:['balance'] }] }]))
    fail('edit', '更新履歴の日付が変わったのに見逃しています');
  if(!S.historyDiffers(hA, hA.concat(hA)))
    fail('edit', '更新履歴の行が増えたのに見逃しています');

  /* 送るファイルは**全部**構文として読めること(§指摘11)。data.js だけを評価していた頃は、
     壊れた特性idで ui.js を壊しても「差分を確認する」が ok と言っていた。 */
  if(S.textsSyntaxError({ 'ui.js':"const A = { ok:'1' };", 'data.js':'const B = 1;' }))
    fail('edit', '正しいファイルを「読めない」と言っています');
  const broken = S.textsSyntaxError({ 'data.js':'const B = 1;', 'ui.js':"const A = { bad-id:'x' };" });
  if(!broken || !/ui\.js/.test(broken))
    fail('edit', `構文の壊れた ui.js を素通ししています(${broken})`);
  if(S.textsSyntaxError({ 'monsters/specs/x.json': '{ "a": 1 }' }))
    fail('edit', 'JSON を JS として評価しています');
  // 特性idの判定は key と同じ1つ(idOk)。裸のキーとして書き出せる形だけを通す
  for(const ng of ['bad-id', '1abc', 'Abc', 'a b', '', "a':'x'//"])
    if(S.idOk(ng)) fail('edit', `使えない特性id を通しています: ${JSON.stringify(ng)}`);
  for(const ok of ['guts', 'god_range', 'a1'])
    if(!S.idOk(ok)) fail('edit', `使える特性id を弾いています: ${ok}`);
  // 使えない形の特性idでは、正規表現を組み立てずに false を返す(ui.js を読みに行かない)
  const uiSrc = fs.readFileSync(path.join(ROOT, 'ui.js'), 'utf8');
  if(S.traitExistsIn(uiSrc, '.*') !== false)
    fail('edit', 'traitExistsIn が使えない形の特性idで真を返しています');
  /* 見出しの書き方のゆれ(§指摘21)。引用符付き・字下げ違いも「有る」と読む ——
     読み落とすと「無い」と判断して TRAIT_DESC へ2つ目の同じキーを足し、
     **後ろの説明が前を黙って上書きする**。 */
  for(const form of ["  guts: 'a',", "    guts:'a',", "  'guts': 'a',", '  "guts":"a",'])
    if(!S.traitExistsIn(`const TRAIT_DESC = {\n${form}\n};`, 'guts'))
      fail('edit', `TRAIT_DESC の見出しを読み落としています: ${form}`);
  if(S.traitExistsIn("const TRAIT_DESC = {\n  gutsy: 'a',\n};", 'guts'))
    fail('edit', 'TRAIT_DESC の別の見出し(gutsy)を guts と読んでいます');
  /* 許したぶん「同じキーが2つ」も起こりうるので、送る前に見る。
     JS としては合法なので textsSyntaxError では捕まらない種類の壊れ方。 */
  if(S.traitDescDupKeys(uiSrc).length)
    fail('edit', `いまの ui.js の TRAIT_DESC にキーの重複があります: ${S.traitDescDupKeys(uiSrc).join(' / ')}`);
  if(JSON.stringify(S.traitDescDupKeys("const TRAIT_DESC = {\n  guts: 'a',\n  'guts': 'b',\n  other: 'c',\n};"))
     !== '["guts"]')
    fail('edit', '書き方の違う同じ見出し(guts と \'guts\')を重複と見ていません');
  const dupUi = "const TRAIT_DESC = {\n  guts: 'a',\n  guts: 'b',\n};";
  if(S.textsSyntaxError({ 'ui.js': dupUi }))
    fail('edit', '重複したキーは構文としては読める前提が崩れています');
  if(!/TRAIT_DESC/.test(S.textsTraitDupError({ 'ui.js': dupUi }) || ''))
    fail('edit', '同じ特性idが2つある ui.js を素通ししています');
  if(S.textsTraitDupError({ 'ui.js': uiSrc, 'data.js':'const A = 1;' }))
    fail('edit', 'いまの ui.js を「重複あり」と言っています');
  if(S.textsTraitDupError({ 'data.js':'const A = 1;' }))
    fail('edit', 'ui.js を書き戻さない登録でも重複を見に行っています');

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
if(want('period'))    done.push('周期検出 ' + await runPeriod());
if(want('roundtrip')) done.push('往復 ' + runRoundTrip());
if(want('handlers'))  done.push('属性 ' + runHandlers());
if(want('moveaura'))  done.push('技名 ' + runMoveAura());
if(want('changelog')) done.push('更新履歴 ' + runChangelog());
if(want('edit'))      done.push('開いて直す ' + runEditRound());
if(want('se'))        done.push('SEの一覧 ' + runSe());
if(want('wording'))   done.push('見せ方 ' + runWording());
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
