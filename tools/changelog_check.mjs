/* 更新履歴(data.js の UPDATE_HISTORY)の書き方を検査する。
   使い方: node tools/changelog_check.mjs
   ※ ゲームは動かさない。data.js から配列の部分だけを切り出して評価する。

   ここで止めたいのは、実際に起きた汚れ:
     ・同じ日付のブロックが2つできる
     ・同じ日のうちに同じ話題を2行書く(前の行を書き直さずに足す)
     ・遊ぶ人に関係のない内部の話が混じる
   「エラー」は直すまで通らない。「注意」は人が見て判断する(まとめる/書き直す/そのままにする)。 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');

/* 配列リテラルを名前で切り出す(data.js 全体は document 等に触るので評価できない) */
function sliceArray(name){
  const head = src.indexOf(`const ${name} = [`);
  if(head < 0) throw new Error(`${name} が見つからない`);
  const start = src.indexOf('[', head);
  let depth = 0, inStr = null, i = start;
  for(; i < src.length; i++){
    const c = src[i], p = src[i-1];
    if(inStr){ if(c === inStr && p !== '\\') inStr = null; continue; }
    if(c === "'" || c === '"' || c === '`'){ inStr = c; continue; }
    if(c === '/' && src[i+1] === '/'){ i = src.indexOf('\n', i); continue; }
    if(c === '[') depth++;
    else if(c === ']'){ depth--; if(depth === 0){ i++; break; } }
  }
  return new Function(`return ${src.slice(start, i)};`)();
}

const TAGS = sliceArray('CHANGELOG_TAGS');
const HISTORY = sliceArray('UPDATE_HISTORY');
const TAG_IDS = new Set(TAGS.map(t=> t.id));

const errors = [];
const warns = [];

/* --- 形・日付 --- */
const seenDates = new Map();
let prevDate = null;
for(const [bi, b] of HISTORY.entries()){
  const at = `#${bi+1}`;
  if(!b || typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)){
    errors.push(`${at} date が YYYY-MM-DD でない: ${JSON.stringify(b && b.date)}`); continue;
  }
  if(seenDates.has(b.date)) errors.push(`${b.date} のブロックが2つある(#${seenDates.get(b.date)+1} と ${at})。1日=1ブロックにまとめる`);
  else seenDates.set(b.date, bi);
  if(prevDate && b.date > prevDate) errors.push(`${at} ${b.date} が ${prevDate} より新しい。日付は降順`);
  prevDate = b.date;

  if(!Array.isArray(b.items) || !b.items.length){ errors.push(`${b.date} に items が無い`); continue; }
  for(const [ii, it] of b.items.entries()){
    const where = `${b.date} の${ii+1}行目`;
    if(!it || typeof it.t !== 'string' || !it.t.trim()){ errors.push(`${where}: t が空`); continue; }
    if(!Array.isArray(it.g) || !it.g.length){ errors.push(`${where}: g(タグ)が無い`); continue; }
    for(const g of it.g) if(!TAG_IDS.has(g)) errors.push(`${where}: 知らないタグ '${g}'(CHANGELOG_TAGS にあるものだけ)`);
  }
}

/* --- 同じ日のうちの似た行(いま書き足している最新の日付だけ見る) ---
   過去の日付は公開済みで、似た語が並ぶのは自然(「歩行アニメーションを追加」等)。
   直すべきなのは「今日の分に、同じ話題の行を2つ作った」場合だけ。 */
/* 文字の並びではなく「出てくる言葉」で比べる。日本語は言い回しを変えると
   文字の並びがまるごと変わるので、漢字・カタカナの語で見たほうが同じ話題を拾える。

   **この判定(語の切り出し・類似度・しきい値)は tools/studio_web.html の
   changelogWarnings / changelogWords / changelogSimilarity / CHANGELOG_SIMILAR と
   二重に持っている**(スタジオは data.js を読まずに端末の中だけで判定するため)。
   直すときは必ず両方直すこと。同じ結果になることは studio_regress.mjs の (g) が毎回突き合わせる。 */
const words = (s)=> new Set(s.match(/[゠-ヿ]{2,}|[一-鿿]{2,}/g) || []);
const similarity = (a, b)=>{
  const A = words(a), B = words(b);
  if(!A.size || !B.size) return 0;
  let hit = 0; for(const x of A) if(B.has(x)) hit++;
  return hit / Math.min(A.size, B.size);
};
const SIMILAR = 0.34;
for(const b of HISTORY.slice(0, 1)){
  if(!Array.isArray(b.items)) continue;
  for(let i = 0; i < b.items.length; i++){
    for(let j = i+1; j < b.items.length; j++){
      const s = similarity(b.items[i].t, b.items[j].t);
      if(s >= SIMILAR){
        warns.push(`${b.date} の${i+1}行目と${j+1}行目が似ている(${Math.round(s*100)}%)。`
          + `同じ話題なら1行にまとめるか、古いほうを書き直す\n    ${b.items[i].t.slice(0,42)}…\n    ${b.items[j].t.slice(0,42)}…`);
      }
    }
  }
}

/* --- 遊ぶ人に関係のない言葉 ---
   **この一覧は tools/studio_web.html の CHANGELOG_INTERNAL と二重に持っている。
   語を足す・減らすときは必ず両方直す**(studio_regress.mjs の (g) が一致を検査する)。 */
const INTERNAL = ['リファクタ', 'キャッシュ', 'CACHE_NAME', 'Service Worker', 'localStorage', 'コミット',
                  'プルリク', 'リポジトリ', '関数', '変数', 'CSS', 'DOM', 'API', 'デプロイ', 'ソースコード'];
for(const b of HISTORY){
  if(!Array.isArray(b.items)) continue;
  for(const [ii, it] of b.items.entries()){
    if(typeof it.t !== 'string') continue;
    const hit = INTERNAL.filter(w=> it.t.includes(w));
    if(hit.length) warns.push(`${b.date} の${ii+1}行目に内部の言葉: ${hit.join('・')}\n    ${it.t.slice(0,42)}…`);
  }
}

const items = HISTORY.reduce((n, b)=> n + (Array.isArray(b.items) ? b.items.length : 0), 0);
console.log(`更新履歴: ${HISTORY.length}ブロック / ${items}項目(${HISTORY[HISTORY.length-1]?.date} 〜 ${HISTORY[0]?.date})`);
if(warns.length){ console.log(`\n⚠ 注意 ${warns.length}件`); for(const w of warns) console.log('  - ' + w); }
if(errors.length){ console.log(`\n✖ エラー ${errors.length}件`); for(const e of errors) console.log('  - ' + e); process.exit(1); }
console.log(warns.length ? '\nエラーなし(注意は人が見て判断する)' : '\nエラー・注意ともになし');
