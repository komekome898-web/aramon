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
export const ENV_INTENSITY = 1.15;   // 空からの環境光の強さ(materialのenvMapIntensity)

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
