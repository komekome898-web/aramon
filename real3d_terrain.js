/* =====================================================================
   リアルマップ: 地面(プレイヤー中心のパッチ + PBRテクスチャ)

   ・地面はPBR(MeshStandardMaterial)。色 + 法線・粗さ・AO の4枚組を手続き的に作る
   ・パッチはプレイヤー中心。動かしても頂点が同じワールド座標に乗るようスナップする
   ・高さと傾きは data.js の real3dHeightGrad()(解析微分)。法線もそこから直接作る
   ===================================================================== */
import * as THREE from './vendor/three.module.min.js';
import { R3, DEFAULT_THEME, ENV_INTENSITY, heightAt, hash2, tileNoise, fbmTile, makeTexture } from './real3d_common.js';

// ---- 見た目の調整用定数(プレイテストで触るのはここだけ) ----
export const PATCH_SIZE = 7200;  // プレイヤー中心に張る地形パッチの一辺(ワールド単位)
const PATCH_SEGS  = 144;         // パッチの分割数。細かくすると綺麗だが重くなる
const CELL = PATCH_SIZE / PATCH_SEGS;   // 頂点間隔。この単位でパッチ位置をスナップする
const TEX_TILE    = 420;         // 色テクスチャ1枚が覆うワールド単位(小さいほど細かい)
const DETAIL_TILE = 120;         // 凹凸(バンプ)テクスチャが覆うワールド単位。足元の砂利感を出す
const MACRO_TILE  = 900;         // 地面のまだら模様(砂/砂利/枯れ草)の大きさ

let terrain = null, terrainPos = null, terrainCol = null, terrainNrm = null;
let groundMaps = null;           // { map, normalMap, roughnessMap, aoMap }
let patchCX = null, patchCY = null;   // 現在のパッチ中心(スナップ済み)

export function getTerrain(){ return terrain; }
export function getGroundMaps(){ return groundMaps; }
// 次の render で必ず塗り直させる(マップ切り替え時)
export function resetPatch(){ patchCX = patchCY = null; }

/* 地面テクスチャの作り分け。crack=ひび割れ / grit=粒 / tint=色みの散らし / fine=砂目
   rough=ざらつき(PBRのroughness。小さいほどツヤが出る)                        */
const TEX_STYLES = {
  dry:      { crack:1.00, grit:1.00, tint:1.00, fine:1.00, rough:[0.72,0.96] },
  volcanic: { crack:1.30, grit:1.25, tint:0.60, fine:1.15, rough:[0.66,0.98] },
  sand:     { crack:0.15, grit:0.70, tint:0.80, fine:1.25, rough:[0.80,0.98] },
  snow:     { crack:0.00, grit:0.45, tint:0.30, fine:0.70, rough:[0.35,0.72] },
  jungle:   { crack:0.35, grit:1.10, tint:1.25, fine:1.10, rough:[0.62,0.92] },
};

/* PBRの4枚組(色/法線/粗さ/AO)をスタイルごとに1回だけ作って使い回す。
   法線・粗さ・AOは同じ「細かい高さ場」から作るので、生成は1回で済ませる。   */
const groundMapCache = {};
export function groundMapsFor(style){
  if(!groundMapCache[style]){
    const st = TEX_STYLES[style] || TEX_STYLES.dry;
    const map = buildGroundTexture(st);
    map.repeat.set(PATCH_SIZE/TEX_TILE, PATCH_SIZE/TEX_TILE);
    const detail = buildDetailMaps(st);
    [detail.normalMap, detail.roughnessMap, detail.aoMap].forEach(t=>{
      t.repeat.set(PATCH_SIZE/DETAIL_TILE, PATCH_SIZE/DETAIL_TILE);
    });
    groundMapCache[style] = { map, ...detail };
  }
  return groundMapCache[style];
}

function buildGroundTexture(st){
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  for(let y=0;y<S;y++){
    for(let x=0;x<S;x++){
      const u = x/S, v = y/S;
      // 生成は試合開始時に1回だけ。iPhoneでも待たされないようオクターブ数は抑えている
      const base = fbmTile(u, v, 8, 3);                 // 大きな濃淡(土の斑)
      const fine = tileNoise(u*48, v*48, 48);           // 細かい砂目
      // 尾根状ノイズを細い暗線として使う = 乾いた地面のひび割れ
      const ridge = 1 - Math.abs(fbmTile(u, v, 12, 2)*2 - 1);
      const crack = Math.max(0, ridge - 0.86) * 3.4 * st.crack;
      // 砂利の粒。明るい粒と暗い粒を混ぜると単調な砂に見えない
      const grit = hash2(x*1.7, y*2.3);
      let lum = 0.66 + base*0.30 + (fine-0.5)*0.13*st.fine + (grit-0.5)*0.10*st.grit - crack*0.30;
      lum = Math.max(0.35, Math.min(1, lum));
      // ほんのり色みを散らす(赤茶⇔灰)。頂点色と喧嘩しないよう振れ幅は小さく
      const tint = (tileNoise(u*5, v*5, 5) - 0.5) * st.tint;
      const r = lum*(1 + tint*0.10), gg = lum*(1 + tint*0.02), b = lum*(1 - tint*0.10);
      const i = (y*S+x)*4;
      img.data[i]   = Math.round(Math.max(0,Math.min(1,r))*255);
      img.data[i+1] = Math.round(Math.max(0,Math.min(1,gg))*255);
      img.data[i+2] = Math.round(Math.max(0,Math.min(1,b))*255);
      img.data[i+3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;   // 色として作った画像なのでsRGBと明示する
  tex.anisotropy = 4;
  return tex;
}

/* 足元の砂利・小石。法線(normalMap)・粗さ(roughnessMap)・遮蔽(aoMap)の3枚を、
   同じ「細かい高さ場」から作る。高さ場を1回だけ計算して3枚で共有するので、
   試合開始時の生成時間は従来のbumpMap1枚と大きくは変わらない。               */
const DETAIL_S = 256;
// 法線マップに焼き込む凹凸の強さ。テーマごとの強弱は normalScale(theme.bump)で調整する
const NORMAL_BAKE = 0.28;
function buildDetailMaps(st){
  // 細かい高さ場: 砂目のfBm + 小石の粒 - ひび割れの溝
  const H = new Float32Array(DETAIL_S*DETAIL_S);
  for(let y=0;y<DETAIL_S;y++){
    for(let x=0;x<DETAIL_S;x++){
      const u = x/DETAIL_S, v = y/DETAIL_S;
      const n = fbmTile(u, v, 16, 3);
      const pebble = Math.pow(tileNoise(u*32, v*32, 32), 3);
      const ridge = 1 - Math.abs(fbmTile(u, v, 12, 2)*2 - 1);
      const crack = Math.max(0, ridge - 0.86) * 3.4 * st.crack;
      H[y*DETAIL_S+x] = n*0.7 + pebble*0.55 - crack*0.6;
    }
  }
  const at = (x,y)=>H[(((y%DETAIL_S)+DETAIL_S)%DETAIL_S)*DETAIL_S + (((x%DETAIL_S)+DETAIL_S)%DETAIL_S)];
  // 法線: 高さ場の傾きをそのままRGBに入れる(接空間なのでZは常に手前向き)
  const normalMap = makeTexture(DETAIL_S, (d)=>{
    for(let y=0;y<DETAIL_S;y++){
      for(let x=0;x<DETAIL_S;x++){
        const dx = (at(x+1,y) - at(x-1,y)) * NORMAL_BAKE * DETAIL_S/64;
        const dy = (at(x,y+1) - at(x,y-1)) * NORMAL_BAKE * DETAIL_S/64;
        const len = Math.hypot(dx, dy, 1);
        const i = (y*DETAIL_S+x)*4;
        d[i]   = Math.round((-dx/len*0.5+0.5)*255);
        d[i+1] = Math.round(( dy/len*0.5+0.5)*255);
        d[i+2] = Math.round((  1/len*0.5+0.5)*255);
        d[i+3] = 255;
      }
    }
  }, false);
  // 粗さ: 出っ張った粒はわずかにツヤ、窪みはマット
  const lo = st.rough[0], hi = st.rough[1];
  const roughnessMap = makeTexture(DETAIL_S, (d)=>{
    for(let y=0;y<DETAIL_S;y++){
      for(let x=0;x<DETAIL_S;x++){
        const h = at(x,y);
        const r = lo + (hi-lo)*Math.max(0, Math.min(1, 0.55 + (0.5-h)*0.9 + (hash2(x*2.7,y*1.9)-0.5)*0.25));
        const c = Math.round(r*255), i = (y*DETAIL_S+x)*4;
        d[i]=d[i+1]=d[i+2]=c; d[i+3]=255;
      }
    }
  }, false);
  // AO: まわりより低い所を暗くする(粒の間に落ちる細かい影)
  const aoMap = makeTexture(DETAIL_S, (d)=>{
    for(let y=0;y<DETAIL_S;y++){
      for(let x=0;x<DETAIL_S;x++){
        let avg = 0;
        for(let oy=-3;oy<=3;oy+=3) for(let ox=-3;ox<=3;ox+=3) avg += at(x+ox, y+oy);
        avg /= 9;
        const occ = Math.max(0, Math.min(1, 0.82 + (at(x,y)-avg)*1.9));
        const c = Math.round((0.55 + occ*0.45)*255), i = (y*DETAIL_S+x)*4;
        d[i]=d[i+1]=d[i+2]=c; d[i+3]=255;
      }
    }
  }, false);
  return { normalMap, roughnessMap, aoMap };
}

export function buildTerrain(){
  // 平面を作ってからX-Z平面へ倒す。頂点の高さ(y)は毎回 updateTerrain で書き換える
  const geo = new THREE.PlaneGeometry(PATCH_SIZE, PATCH_SIZE, PATCH_SEGS, PATCH_SEGS);
  geo.rotateX(-Math.PI/2);
  const n = geo.attributes.position.count;
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n*3), 3));
  // UVはパッチのローカル座標そのままなので、repeatで「何単位に1回」貼るかを決める。
  // パッチ位置はCELLの倍数にスナップして動かすため、模様がワールドに固定されて見える。
  groundMaps = groundMapsFor(R3.theme.tex);
  // PBR。金属ではないので metalness は0、粗さはテクスチャに任せる。
  // theme.bump は法線の強さ(凹凸の見え方)として使う。
  const mat = new THREE.MeshStandardMaterial({
    vertexColors:true,
    map: groundMaps.map,
    normalMap: groundMaps.normalMap,
    roughnessMap: groundMaps.roughnessMap,
    aoMap: groundMaps.aoMap,
    normalScale: new THREE.Vector2(R3.theme.bump*3, R3.theme.bump*3),
    metalness: 0.0, roughness: 1.0, aoMapIntensity: 0.9,
    envMapIntensity: ENV_INTENSITY, dithering: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  // 丘が自分自身へ影を落とす(影を受ける側にもなる)
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  terrainPos = geo.attributes.position;
  terrainCol = geo.attributes.color;
  terrainNrm = geo.attributes.normal;
  terrain = mesh;
  return mesh;
}

const _c = new THREE.Color(), _cMacro = new THREE.Color();
const _cLow = new THREE.Color(DEFAULT_THEME.low), _cHigh = new THREE.Color(DEFAULT_THEME.high), _cSteep = new THREE.Color(DEFAULT_THEME.steep);
const _cGravel = new THREE.Color(DEFAULT_THEME.gravel), _cScrub = new THREE.Color(DEFAULT_THEME.scrub);
// ワールド座標で決まるまだら模様(砂/砂利/枯れ草)。同じ場所は常に同じ色になる純関数
// 内側で関数を作ると呼び出しのたびにクロージャが1個できる(2万頂点で2万個)ので外へ出す
function _macroH(x, y){ return hash2(x*1.31+7.7, y*2.17-3.3); }
function macroPatch(wx, wy){
  const u = wx/MACRO_TILE, v = wy/MACRO_TILE;
  const xi = Math.floor(u), yi = Math.floor(v);
  const xf = u-xi, yf = v-yi;
  const a = xf*xf*(3-2*xf), b = yf*yf*(3-2*yf);
  return (_macroH(xi,yi)*(1-a)+_macroH(xi+1,yi)*a)*(1-b) + (_macroH(xi,yi+1)*(1-a)+_macroH(xi+1,yi+1)*a)*b;
}

const PATCH_SNAP_CELLS = 2;              // パッチを動かす刻み(セル数)。大きいほど作り直しが減る
const PATCH_SNAP = CELL * PATCH_SNAP_CELLS;
const PATCH_VERTS = PATCH_SEGS + 1;      // 1辺の頂点数
let patchStepX = 0, patchStepZ = 0;      // 頂点1つぶんのローカル座標の刻み(符号込み)
let scratchPos = null, scratchCol = null, scratchNrm = null;
let lastPatchVerts = 0, lastPatchMs = 0, patchRebuilds = 0; // 計測用(管理者画面のパフォーマンス表示)

export function terrainStats(){
  return { patchVerts:lastPatchVerts, patchMs:lastPatchMs, patchCount:patchRebuilds };
}

/* パッチをプレイヤー位置へ動かし、頂点の高さ・色・法線を書き直す。
   ・中心を PATCH_SNAP の倍数にスナップするので、動かしても頂点が同じワールド座標に乗る
   ・パッチが k セルぶん動いただけなら、重なっている部分の値は前回とまったく同じ。
     ずらしてコピーし、新しく現れた帯だけを計算する(1セル移動なら計算量が約1/70)
   ・傾きは real3dHeightGrad() の解析微分。法線もそこから直接作るので
     computeVertexNormals()(4万三角形の走査)が丸ごと不要になる                    */
export function updateTerrain(cx, cy){
  const sx = Math.round(cx / PATCH_SNAP) * PATCH_SNAP;
  const sy = Math.round(cy / PATCH_SNAP) * PATCH_SNAP;
  if(patchCX === sx && patchCY === sy) return;
  const t0 = performance.now();
  const pos = terrainPos.array, col = terrainCol.array, nrm = terrainNrm.array;
  const V = PATCH_VERTS;
  if(!patchStepX){
    patchStepX = pos[1*3] - pos[0];               // 隣の頂点とのローカルx差
    patchStepZ = pos[V*3+2] - pos[2];             // 1行下の頂点とのローカルz差
    scratchPos = new Float32Array(pos.length);
    scratchCol = new Float32Array(col.length);
    scratchNrm = new Float32Array(nrm.length);
  }
  // 前回のパッチから何頂点ぶんずれたか(整数でなければ作り直す)
  let shiftX = 0, shiftY = 0, reuse = false;
  if(patchCX !== null && patchStepX && patchStepZ){
    const fx = (sx - patchCX) / patchStepX, fy = (sy - patchCY) / patchStepZ;
    shiftX = Math.round(fx); shiftY = Math.round(fy);
    reuse = Math.abs(fx-shiftX) < 1e-6 && Math.abs(fy-shiftY) < 1e-6
         && Math.abs(shiftX) < V && Math.abs(shiftY) < V;
  }
  if(reuse){ scratchPos.set(pos); scratchCol.set(col); scratchNrm.set(nrm); }
  patchCX = sx; patchCY = sy;
  let computed = 0;
  for(let iy=0; iy<V; iy++){
    const sIy = iy + shiftY;
    const rowOk = reuse && sIy>=0 && sIy<V;
    for(let ix=0; ix<V; ix++){
      const d = (iy*V + ix)*3;
      if(rowOk){
        const sIx = ix + shiftX;
        if(sIx>=0 && sIx<V){
          const s = (sIy*V + sIx)*3;
          pos[d+1] = scratchPos[s+1];
          col[d]=scratchCol[s]; col[d+1]=scratchCol[s+1]; col[d+2]=scratchCol[s+2];
          nrm[d]=scratchNrm[s]; nrm[d+1]=scratchNrm[s+1]; nrm[d+2]=scratchNrm[s+2];
          continue;
        }
      }
      const wx = sx + pos[d], wy = sy + pos[d+2];
      const g = window.real3dHeightGrad ? window.real3dHeightGrad(wx, wy) : null;
      const h = g ? g.h : heightAt(wx, wy);
      const gx = g ? g.gx : 0, gy = g ? g.gy : 0;
      pos[d+1] = h;
      // 法線は解析微分から直接。面の平均を取るより正確で、走査も要らない
      const inv = 1 / Math.hypot(gx, 1, gy);
      nrm[d] = -gx*inv; nrm[d+1] = inv; nrm[d+2] = -gy*inv;
      // 高さと傾斜で色を決める(テクスチャ画像を持たずに岩肌と砂を描き分ける)
      const slope = Math.min(1, Math.hypot(gx, gy) / 0.45);
      const t = Math.min(1, Math.max(0, (h + 240) / 480));
      _c.copy(_cLow).lerp(_cHigh, t);
      // 高さだけで色を決めると縞に見えるので、場所ごとのまだら(砂利・枯れ草)を混ぜる
      const mp = macroPatch(wx, wy);
      _cMacro.copy(mp < 0.5 ? _cGravel : _cScrub);
      _c.lerp(_cMacro, Math.min(0.42, Math.abs(mp-0.5)*0.84));
      _c.lerp(_cSteep, slope);   // 急斜面はむき出しの岩肌
      col[d] = _c.r; col[d+1] = _c.g; col[d+2] = _c.b;
      computed++;
    }
  }
  terrainPos.needsUpdate = true;
  terrainCol.needsUpdate = true;
  terrainNrm.needsUpdate = true;
  terrain.position.set(sx, 0, sy);
  // テクスチャの模様をワールドに固定する。これをしないとパッチと一緒に模様が動き、
  // 地面の上を滑っているように見えてしまう(uv.yは回転で反転しているので符号が逆)。
  // 色・法線・粗さ・AOの4枚すべてに同じ処理が必要(1枚でも忘れると模様が滑る)
  if(groundMaps){
    groundMaps.map.offset.set(sx / TEX_TILE, -sy / TEX_TILE);
    [groundMaps.normalMap, groundMaps.roughnessMap, groundMaps.aoMap].forEach(t=>{
      t.offset.set(sx / DETAIL_TILE, -sy / DETAIL_TILE);
    });
  }
  lastPatchVerts = computed;
  lastPatchMs = performance.now() - t0;
  patchRebuilds++;
}

/* マップが変わったときに、地面の色とテクスチャをそのテーマへ差し替える。
   地形メッシュそのものは使い回し、色(頂点カラー)とテクスチャだけ作り直す。   */
export function applyTerrainTheme(){
  const theme = R3.theme;
  _cLow.setHex(theme.low); _cHigh.setHex(theme.high); _cSteep.setHex(theme.steep);
  _cGravel.setHex(theme.gravel); _cScrub.setHex(theme.scrub);
  if(terrain){
    groundMaps = groundMapsFor(theme.tex);
    const mt = terrain.material;
    mt.map = groundMaps.map;
    mt.normalMap = groundMaps.normalMap;
    mt.roughnessMap = groundMaps.roughnessMap;
    mt.aoMap = groundMaps.aoMap;
    mt.normalScale.set(theme.bump*3, theme.bump*3);
    mt.needsUpdate = true;
  }
  resetPatch();   // 頂点カラーを塗り直させる
}
