/* =====================================================================
   リアルマップ共通(real3d_*.js が全部これを読む)

   ・手続き的なノイズとテクスチャ生成のヘルパー
   ・現在のテーマ(マップごとの見た目)を持つ共有オブジェクト R3
   ・地形の高さ(data.js の real3dHeightAt)への入口

   【重要】ここは「どのモジュールからも読まれる葉」なので、他の real3d_*.js を
   import しないこと(循環参照になる)。
   ===================================================================== */
import * as THREE from './vendor/three.module.min.js';

// 太陽の向き(空・遠景の山・影で共有する)
export const SUN_DIR = new THREE.Vector3(-0.55, 0.62, -0.38).normalize();
/* 空からの環境光の強さ(materialのenvMapIntensity)。
   【重要】ここを上げすぎると影が消える。1.15だった頃は、影を完全に切っても
   画の平均差が0.16/255しか出ない = 事実上影が無い状態だった(環境光が
   影の中まで回り込んで、日向と日陰の差が無くなるため)。
   太陽(SUN_INTENSITY)との比で「日向と日陰の差」が決まるので、対で調整すること。 */
export const ENV_INTENSITY = 0.55;

/* マップごとの見た目は data.js の REAL3D_THEMES から window.__aramonRealTheme 経由で受け取る。
   ここにあるのは受け取れなかった時の既定値(荒野相当)。色を足すときは両方に足すこと。 */
export const DEFAULT_THEME = {
  tex:'dry', bump:0.30,
  skyTop:0x223652, skyBot:0x9aa8b0, haze:0xcfc2a6,
  low:0xa89066, high:0xd9c79b, steep:0x6f6152, gravel:0x8d8371, scrub:0x8a8a5c,
  ridgeRock:0x6a6a74, ridgeFoot:0x8a8072, ridgeSnow:0xe8eef6, snowLine:0.62,
};

/* 現在のテーマを入れておく共有の箱。各モジュールは R3.theme を「毎回読む」ことで
   マップ切り替えに追従する(import した値を変数へ写し取らないこと)。 */
export const R3 = { theme: DEFAULT_THEME };

export function heightAt(x, y){
  return (typeof window.real3dHeightAt === 'function') ? window.real3dHeightAt(x, y) : 0;
}

/* ---- 探検フィールドの地域ブレンド ----
   「1マップ1テーマ」の例外。R3.theme.explore が立っているときだけ使う(分岐はこの印の1か所)。
   地域の重みは data.js の exploreRegionWeights(ワールド座標の純関数)。ここはその入口と、
   テーマの regions から「重みで混ぜた色」を作る道具だけを持つ。 */
export const EXPLORE_KEYS = ['meadow', 'frost', 'volcano', 'jungle', 'camp'];   // 重みの配列の順番
/* 探検フィールドの「いま立っている地域の空気」。real3d_explore.js が毎フレーム
   カメラ位置の地域の重みから作り、山の霞(real3d_props.js)がこの uniform を共有して読む。 */
export const EXPLORE_ATMO = { haze: { value: new THREE.Color(0xc3d2d4) } };
export function isExplore(){ return !!(R3.theme && R3.theme.explore); }
const _noW = [0, 0, 0, 0, 1];
// 地域の重み [草原, 凍った高地, 火山, 密林, キャンプ](合計1)。配列は使い回し
export function exploreWeights(x, y){
  return (typeof window.exploreRegionWeights === 'function') ? window.exploreRegionWeights(x, y) : _noW;
}
/* テーマの regions[key][field] を THREE.Color の配列(EXPLORE_KEYS の順)にしておく。
   テーマごとに1回だけ作る(毎フレーム作らない)。                            */
const _regionColorCache = new Map();
export function exploreRegionColors(field){
  const th = R3.theme;
  let per = _regionColorCache.get(th);
  if(!per){ per = {}; _regionColorCache.set(th, per); }
  if(!per[field]){
    per[field] = EXPLORE_KEYS.map(k=>{
      const r = th.regions && th.regions[k];
      const v = (r && r[field] != null) ? r[field] : th[field];
      return Array.isArray(v) ? new THREE.Color(v[0], v[1], v[2]) : new THREE.Color(v != null ? v : 0xffffff);
    });
  }
  return per[field];
}
// 重みで混ぜた色を out へ(配列は exploreRegionColors の形。掛け率の配列 rock なども同じように混ぜる)
export function exploreMixColor(list, w, out){
  out.setRGB(0, 0, 0);
  for(let i=0;i<5;i++){
    const c = list[i], k = w[i];
    if(k <= 1e-4) continue;
    out.r += c.r*k; out.g += c.g*k; out.b += c.b*k;
  }
  return out;
}
/* 踏み分け道(設計図の paths)。土の道を地面の色に焼き、道の上には草を生やさない。
   折れ線を線分の配列にして1回だけ持つ。exploreTrail(x,y) は 0(道の外)〜1(道の真ん中)。
   道の幅は場所ごとに少し揺らして、定規で引いた帯に見せない。                  */
let _trailSegs = null, _trailLayout = null;
function trailSegs(){
  const L = window.__aramonExploreLayout;
  if(!L) return [];
  if(_trailLayout === L) return _trailSegs;
  _trailLayout = L; _trailSegs = [];
  const pt = (p)=> (typeof p === 'string') ? { x:L.passes[p][0], y:L.passes[p][1] } : { x:p[0], y:p[1] };
  for(const path of L.paths){
    const pts = path.pts.map(pt);
    for(let i=0;i<pts.length-1;i++){
      const a = pts[i], b = pts[i+1];
      const vx = b.x-a.x, vy = b.y-a.y;
      _trailSegs.push({ ax:a.x, ay:a.y, vx, vy, l2:(vx*vx + vy*vy) || 1, w:path.w,
                        x0:Math.min(a.x,b.x) - path.w*1.6, x1:Math.max(a.x,b.x) + path.w*1.6,
                        y0:Math.min(a.y,b.y) - path.w*1.6, y1:Math.max(a.y,b.y) + path.w*1.6 });
    }
  }
  return _trailSegs;
}
export function exploreTrail(x, y){
  const segs = trailSegs();
  let best = 0;
  for(let i=0;i<segs.length;i++){
    const s = segs[i];
    if(x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) continue;
    const t = Math.max(0, Math.min(1, ((x-s.ax)*s.vx + (y-s.ay)*s.vy)/s.l2));
    const dx = x - (s.ax + s.vx*t), dy = y - (s.ay + s.vy*t);
    const w = s.w * (0.78 + 0.22*Math.sin(x*0.0061 + y*0.0047) + 0.12*Math.sin(x*0.017 - y*0.013));
    const d = Math.sqrt(dx*dx + dy*dy) / w;
    if(d < 1){ const k = 1 - d*d*(3 - 2*d); if(k > best) best = k; }
  }
  return best;
}
// regions[key][field] の数値を重みで混ぜる(field が配列なら idx 番目)
export function exploreMixNum(field, w, idx){
  const th = R3.theme;
  let s = 0;
  for(let i=0;i<5;i++){
    if(w[i] <= 1e-4) continue;
    const r = th.regions[EXPLORE_KEYS[i]];
    const v = (idx == null) ? r[field] : r[field][idx];
    s += v*w[i];
  }
  return s;
}

/* ---- 手続き的なノイズ(画像ファイルを増やさずに質感を出すための材料) ----
   端末が変わっても同じ模様になるよう、疑似乱数は座標から決まる固定式にしてある。 */
export const hash2 = (x,y)=>{ const n = Math.sin(x*127.1 + y*311.7) * 43758.5453; return n - Math.floor(n); };

// タイル境界で継ぎ目が出ないよう周期perで折り返す値ノイズ
export function tileNoise(x, y, per){
  const w = (a)=>((a%per)+per)%per;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x-xi, yf = y-yi;
  const u = xf*xf*(3-2*xf), v = yf*yf*(3-2*yf);
  const a = hash2(w(xi),   w(yi));
  const b = hash2(w(xi+1), w(yi));
  const c = hash2(w(xi),   w(yi+1));
  const e = hash2(w(xi+1), w(yi+1));
  return (a*(1-u)+b*u)*(1-v) + (c*(1-u)+e*u)*v;
}

// u,v(0〜1)を周期perのfBmで samplingする
export function fbmTile(u, v, per, oct){
  let s = 0, amp = 0.5, p = per;
  for(let o=0;o<oct;o++){ s += tileNoise(u*p, v*p, p)*amp; amp *= 0.5; p *= 2; }
  return s;
}

/* 画素を1枚ずつ埋めてテクスチャにする共通処理。
   srgb=true は「色」、false は「データ」(法線・粗さ・AO)。取り違えると色が沈む。 */
export function makeTexture(S, fill, srgb){
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  fill(img.data, S);
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 2;
  return tex;
}

/* 小さなモデルを1つのジオメトリにまとめる(three本体にmergeGeometriesは無い)。
   一度も描いていないジオメトリはGPU資源を持たないのでdisposeは不要。          */
export function mergeGeos(list){
  const parts = list.map(g=>{
    if(!g.attributes.normal) g.computeVertexNormals();
    return g.index ? g.toNonIndexed() : g;
  });
  let n = 0;
  for(const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n*3), nor = new Float32Array(n*3), col = new Float32Array(n*3), uv = new Float32Array(n*2);
  let o = 0;
  for(const g of parts){
    const p = g.attributes.position;
    pos.set(p.array, o*3);
    if(g.attributes.normal) nor.set(g.attributes.normal.array, o*3);
    if(g.attributes.color) col.set(g.attributes.color.array, o*3);
    else col.fill(1, o*3, (o+p.count)*3);
    if(g.attributes.uv) uv.set(g.attributes.uv.array, o*2);
    o += p.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}
