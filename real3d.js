/* =====================================================================
   リアルマップのWebGL描画レイヤー(Three.js)

   ・地面だけをWebGLで立体的に描く。モンスター・弾・技エフェクト・HUDは
     従来どおり2Dキャンバス(render.js)が上に重ねて描く。
     この分担なら既存の描画コードを一切書き換えずに済む。
   ・地面はPBR(物理ベース描画): MeshStandardMaterial に色・法線・粗さ・AOの
     4枚を貼り、空から作った環境マップ(PMREM)と太陽光で照らす。仕上げは
     ACESフィルミックトーンマッピング + sRGB出力。ポストプロセスは使わない。
   ・岩は2Dのままだが、影だけは3D側の「色を書かないダミー」が落とす(下部参照)。
   ・2Dの project() とカメラを完全に一致させてあるので、2D側が描く物の
     画面位置は3Dの地形とズレない(縦画角64°・カメラ位置・yaw/pitchを共有)。
     ただし丘の裏に隠れる遮蔽は2D側には無い(テストマップの割り切り)。
   ・地形の高さは data.js の real3dHeightAt(x,y)。当たり判定(world.jsの
     getTerrainHeightAt)と同じ関数なので、見た目と当たり判定が必ず一致する。
   ・ESモジュールなので、他のファイルからは window.__aramonReal3D 経由で呼ぶ
     (firebase.js と同じ橋渡しの形)。
   ===================================================================== */
import * as THREE from './vendor/three.module.min.js';

// ---- 見た目の調整用定数(プレイテストで触るのはここだけ) ----
const PATCH_SIZE  = 7200;  // プレイヤー中心に張る地形パッチの一辺(ワールド単位)
const PATCH_SEGS  = 144;   // パッチの分割数。細かくすると綺麗だが重くなる
// フォグはパッチの半分(3600)より手前で完全に霞ませる。こうしないとパッチの切れ目が見える
const FOG_NEAR    = 700;
const FOG_FAR     = 3200;
const RIDGE_DIST  = 5200;  // 遠景の山並みの距離(パッチの外。フォグの影響を受けない)
const SKY_RADIUS  = 9000;
const CAM_FAR     = 12000;
const SUN_DIR     = new THREE.Vector3(-0.55, 0.62, -0.38).normalize();
/* ---- PBR(物理ベース描画)の調整値 ----
   地面は MeshStandardMaterial + 手続き的な baseColor/normal/roughness/AO で描く。
   環境光は「空をそのままPMREMに通した環境マップ」(=HDRIの代わり。画像ファイルは増やさない)。
   ポストプロセス(SSAO/Bloom)は入れない。フルスクリーンのバッファを何枚も持つと
   iPhoneではメモリと帯域を大きく使うわりに、開けた地形では見た目がほとんど変わらないため。 */
const SUN_INTENSITY = 3.1;   // 太陽光。PBRなので従来のPhongより大きい値になる
const ENV_INTENSITY = 1.15;  // 空からの環境光の強さ(materialのenvMapIntensity)
const EXPOSURE      = 1.15;  // ACESフィルミックトーンマッピングの露出
const SHADOW_MAP    = 1024;  // 影の解像度。上げるとくっきりするがiPhoneでは重い
const SHADOW_HALF   = 900;   // 影を計算する範囲(この四角の中だけ影が落ちる)
const SHADOW_AHEAD  = 420;   // 影の範囲の中心をカメラの前方へずらす量
/* マップごとの見た目は data.js の REAL3D_THEMES から window.__aramonRealTheme 経由で受け取る。
   ここにあるのは受け取れなかった時の既定値(荒野相当)。色を足すときは両方に足すこと。 */
const DEFAULT_THEME = {
  tex:'dry', bump:0.30,
  skyTop:0x223652, skyBot:0x9aa8b0, haze:0xcfc2a6,
  low:0xa89066, high:0xd9c79b, steep:0x6f6152, gravel:0x8d8371, scrub:0x8a8a5c,
  ridgeRock:0x6a6a74, ridgeFoot:0x8a8072, ridgeSnow:0xe8eef6, snowLine:0.62,
};
let theme = DEFAULT_THEME;
const COL_SKY_BOT = DEFAULT_THEME.skyBot;   // 初期化時のクリア色にだけ使う
const COL_HAZE    = DEFAULT_THEME.haze;

const CELL = PATCH_SIZE / PATCH_SEGS;   // 頂点間隔。この単位でパッチ位置をスナップする
const TEX_TILE    = 420;                // 色テクスチャ1枚が覆うワールド単位(小さいほど細かい)
const DETAIL_TILE = 120;                // 凹凸(バンプ)テクスチャが覆うワールド単位。足元の砂利感を出す
const MACRO_TILE  = 900;                // 地面のまだら模様(砂/砂利/枯れ草)の大きさ

let renderer = null, scene = null, camera = null;
let terrain = null, terrainPos = null, terrainCol = null;
let groundMaps = null;                   // { map, normalMap, roughnessMap, aoMap }
let sky = null, ridge = null, sun = null;
let envRT = null;                        // 空から作った環境マップ(PMREM)
let patchCX = null, patchCY = null;      // 現在のパッチ中心(スナップ済み)
let active = false, failed = false;

function heightAt(x, y){
  return (typeof window.real3dHeightAt === 'function') ? window.real3dHeightAt(x, y) : 0;
}

/* 空: 内側を向いた大きな球に2色グラデーションを描く(テクスチャ不要)。
   forEnv=true のときは環境マップ(PMREM)を作るための小さな複製。
   gainを上げて「空からの光」として使える明るさにする。                        */
function buildSky(forEnv){
  const geo = new THREE.SphereGeometry(forEnv ? 100 : SKY_RADIUS, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top:   { value: new THREE.Color(theme.skyTop) },
      bot:   { value: new THREE.Color(theme.skyBot) },
      haze:  { value: new THREE.Color(theme.haze) },
      gain:  { value: forEnv ? 1.9 : 1.0 },
    },
    vertexShader: `
      varying float vH;
      void main(){
        vH = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 bot; uniform vec3 haze; uniform float gain;
      varying float vH;
      void main(){
        // 地平線付近はヘイズ色に寄せて、地面のフォグと自然につなぐ
        float t = clamp(vH, -1.0, 1.0);
        vec3 c = (t >= 0.0) ? mix(bot, top, pow(t, 0.7)) : mix(bot, haze, clamp(-t*3.0, 0.0, 1.0));
        gl_FragColor = vec4(c * gain, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  // 空の色はテーマで決め打ちした値なので、トーンマッピングを通さずそのまま出す
  mesh.material.toneMapped = !forEnv;
  return mesh;
}

/* 遠景の山並み。実際の地形パッチの外側を埋めて「世界の終わり」を隠す。
   ・稜線は周期の違う波を4つ重ねてギザギザにする(1本の正弦波だと作り物に見える)
   ・距離の違う層を3枚重ね、遠い層ほど霞ませて空の色に近づける(空気遠近)
   ・縦にも分割し、高度で色を変える(麓=霞んだ土 / 中腹=岩 / 頂上付近=雪)
   ・太陽の方位に向いた面を明るくして、のっぺりした影絵に見えないようにする      */
const RIDGE_LAYERS = [
  // dist: RIDGE_DISTからの倍率 / peak: 稜線の高さ / haze: 空気遠近(1で完全に霞む)
  // ※雪が乗り始める高さはマップごと(theme.snowLine)
  // 遠い層ほど高くしてある。同じ見かけの高さだと手前の山に完全に隠れてしまう
  { dist:1.00, base:260, peak: 850, haze:0.30 },
  { dist:1.42, base:220, peak:1640, haze:0.55 },
  { dist:1.95, base:180, peak:2840, haze:0.78 },
];
function ridgeProfile(a, seed){
  /* 角度の周期関数を重ねた稜線。層ごとにseedで位相をずらして同じ形を並べない。
     【重要】周波数は必ず整数にする。半端な値(4.3など)だと一周(2π)して戻ったときに
     高さが一致せず、輪の閉じ目に垂直な段差(背景の切れ目)が出る。          */
  return (
    Math.abs(Math.sin(a*2  + seed*1.7)) * 0.50 +
    Math.abs(Math.sin(a*5  + seed*2.9)) * 0.27 +
    Math.abs(Math.sin(a*9  + seed*4.1)) * 0.15 +
    Math.abs(Math.sin(a*17 + seed*5.3)) * 0.08
  );
}
function buildDistantRidge(){
  const SEGS = 168, BANDS = 4;   // 円周の分割数 / 縦の分割数(高度で色を変えるため)
  const geo = new THREE.BufferGeometry();
  const pos = [], col = [];
  const cHaze = new THREE.Color(theme.haze), cSkyBot = new THREE.Color(theme.skyBot);
  const cRock = new THREE.Color(theme.ridgeRock), cFoot = new THREE.Color(theme.ridgeFoot);
  const cSnow = new THREE.Color(theme.ridgeSnow);
  const tmp = new THREE.Color();
  // 太陽の方位(水平成分)。この向きを向いた斜面が明るくなる
  const sunLen = Math.hypot(SUN_DIR.x, SUN_DIR.z) || 1;
  const sunAx = SUN_DIR.x/sunLen, sunAz = SUN_DIR.z/sunLen;
  // 奥の層から先に積む。この網は深度を書かない(depthWrite:false)ので、
  // 手前の層をあとに描かないと遠い山が近い山を塗りつぶしてしまう
  RIDGE_LAYERS.map((L,i)=>({L, li:i})).sort((a,b)=>b.L.dist-a.L.dist).forEach(({L, li})=>{
    const R = RIDGE_DIST * L.dist;
    // 頂点の色: 高度t(0=麓, 1=その山の頂上)と、山の高さhNormで雪を乗せる
    const colorAt = (a, t, hNorm)=>{
      tmp.copy(cFoot).lerp(cRock, Math.min(1, t*1.35));
      const snowLine = Math.max(0.12, theme.snowLine - li*0.07);   // 遠い層ほど高い山なので雪が広い
      const snowT = (hNorm > snowLine) ? Math.min(1, (t - 0.72)/0.28) * Math.min(1,(hNorm-snowLine)*3.2) : 0;
      if(snowT > 0) tmp.lerp(cSnow, snowT);
      // 斜面の向きによる明暗(山は内側=カメラ側を向いている)
      const lightness = 0.82 + 0.18*(-Math.cos(a)*sunAx - Math.sin(a)*sunAz);
      tmp.multiplyScalar(lightness);
      // 空気遠近。麓ほど強く霞ませると、地表のフォグと自然につながる
      tmp.lerp(cHaze, Math.min(1, L.haze + (1-t)*0.30));
      tmp.lerp(cSkyBot, L.haze*0.25);
      return tmp;
    };
    const push = (a, t, h)=>{
      pos.push(Math.cos(a)*R, -L.base + (h + L.base)*t, Math.sin(a)*R);
      const c = colorAt(a, t, h/L.peak);
      col.push(c.r, c.g, c.b);
    };
    for(let i=0;i<SEGS;i++){
      const a0 = (i/SEGS)*Math.PI*2, a1 = ((i+1)/SEGS)*Math.PI*2;
      const h0 = L.peak*ridgeProfile(a0, li+1);
      const h1 = L.peak*ridgeProfile(a1, li+1);
      for(let b=0;b<BANDS;b++){
        const t0 = b/BANDS, t1 = (b+1)/BANDS;
        push(a0,t0,h0); push(a1,t0,h1); push(a1,t1,h1);
        push(a0,t0,h0); push(a1,t1,h1); push(a0,t1,h0);
      }
    }
  });
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col,3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors:true, fog:false, depthWrite:false }));
  mesh.frustumCulled = false;
  // 遠景の山も色を頂点に焼き込んであるので、空と同じくトーンマッピングを通さない
  mesh.material.toneMapped = false;
  return mesh;
}

/* ---- 手続き的な地面テクスチャ(画像ファイルを増やさずに質感を出す) ----
   ・色テクスチャ: 砂の濃淡 + ひび割れ + 砂利の粒。頂点色に掛け合わせるので明るめに作る
   ・凹凸テクスチャ(bumpMap): もっと細かい周期で貼り、光の当たり方で粒立ちを出す
   端末が変わっても同じ模様になるよう、疑似乱数は座標から決まる固定式にしてある。   */
const _hash = (x,y)=>{ const n = Math.sin(x*127.1 + y*311.7) * 43758.5453; return n - Math.floor(n); };
// タイル境界で継ぎ目が出ないよう周期perで折り返す値ノイズ
function tileNoise(x, y, per){
  const w = (a)=>((a%per)+per)%per;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x-xi, yf = y-yi;
  const u = xf*xf*(3-2*xf), v = yf*yf*(3-2*yf);
  const a = _hash(w(xi),   w(yi));
  const b = _hash(w(xi+1), w(yi));
  const c = _hash(w(xi),   w(yi+1));
  const e = _hash(w(xi+1), w(yi+1));
  return (a*(1-u)+b*u)*(1-v) + (c*(1-u)+e*u)*v;
}
// u,v(0〜1)を周期perのfBmで samplingする
function fbmTile(u, v, per, oct){
  let s = 0, amp = 0.5, p = per;
  for(let o=0;o<oct;o++){ s += tileNoise(u*p, v*p, p)*amp; amp *= 0.5; p *= 2; }
  return s;
}
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
function groundMapsFor(style){
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
      const grit = _hash(x*1.7, y*2.3);
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
// 画素を1枚ずつ埋めてテクスチャにする共通処理。srgb=falseはデータ(法線・粗さ・AO)用
function makeTexture(S, fill, srgb){
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
        const r = lo + (hi-lo)*Math.max(0, Math.min(1, 0.55 + (0.5-h)*0.9 + (_hash(x*2.7,y*1.9)-0.5)*0.25));
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

function buildTerrain(){
  // 平面を作ってからX-Z平面へ倒す。頂点の高さ(y)は毎回 updateTerrain で書き換える
  const geo = new THREE.PlaneGeometry(PATCH_SIZE, PATCH_SIZE, PATCH_SEGS, PATCH_SEGS);
  geo.rotateX(-Math.PI/2);
  const n = geo.attributes.position.count;
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n*3), 3));
  // UVはパッチのローカル座標そのままなので、repeatで「何単位に1回」貼るかを決める。
  // パッチ位置はCELLの倍数にスナップして動かすため、模様がワールドに固定されて見える。
  groundMaps = groundMapsFor(theme.tex);
  // PBR。金属ではないので metalness は0、粗さはテクスチャに任せる。
  // theme.bump は法線の強さ(凹凸の見え方)として使う。
  const mat = new THREE.MeshStandardMaterial({
    vertexColors:true,
    map: groundMaps.map,
    normalMap: groundMaps.normalMap,
    roughnessMap: groundMaps.roughnessMap,
    aoMap: groundMaps.aoMap,
    normalScale: new THREE.Vector2(theme.bump*3, theme.bump*3),
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
  return mesh;
}

const _c = new THREE.Color(), _cMacro = new THREE.Color();
const _cLow = new THREE.Color(DEFAULT_THEME.low), _cHigh = new THREE.Color(DEFAULT_THEME.high), _cSteep = new THREE.Color(DEFAULT_THEME.steep);
const _cGravel = new THREE.Color(DEFAULT_THEME.gravel), _cScrub = new THREE.Color(DEFAULT_THEME.scrub);
// ワールド座標で決まるまだら模様(砂/砂利/枯れ草)。同じ場所は常に同じ色になる純関数
function macroPatch(wx, wy){
  const u = wx/MACRO_TILE, v = wy/MACRO_TILE;
  const xi = Math.floor(u), yi = Math.floor(v);
  const xf = u-xi, yf = v-yi;
  const a = xf*xf*(3-2*xf), b = yf*yf*(3-2*yf);
  const h = (x,y)=>_hash(x*1.31+7.7, y*2.17-3.3);
  return (h(xi,yi)*(1-a)+h(xi+1,yi)*a)*(1-b) + (h(xi,yi+1)*(1-a)+h(xi+1,yi+1)*a)*b;
}
// パッチをプレイヤー位置へ動かし、頂点の高さと色を書き直す。
// 中心を CELL の倍数にスナップするので、動かしても頂点が同じワールド座標に乗り
// 地形が波打って見えない。
function updateTerrain(cx, cy){
  const sx = Math.round(cx / CELL) * CELL;
  const sy = Math.round(cy / CELL) * CELL;
  if(patchCX === sx && patchCY === sy) return;
  patchCX = sx; patchCY = sy;
  const arr = terrainPos.array, col = terrainCol.array;
  for(let i=0, j=0; i<terrainPos.count; i++, j+=3){
    // ローカルのx,z(=ゲームのx,y相対)からワールド座標を出して高さを引く
    const wx = sx + arr[j];
    const wy = sy + arr[j+2];
    const h = heightAt(wx, wy);
    arr[j+1] = h;
    // 高さと傾斜で色を決める(テクスチャ画像を持たずに岩肌と砂を描き分ける)
    const gx = (heightAt(wx+CELL, wy) - h) / CELL;
    const gy = (heightAt(wx, wy+CELL) - h) / CELL;
    const slope = Math.min(1, Math.hypot(gx, gy) / 0.45);
    const t = Math.min(1, Math.max(0, (h + 240) / 480));
    _c.copy(_cLow).lerp(_cHigh, t);
    // 高さだけで色を決めると縞に見えるので、場所ごとのまだら(砂利・枯れ草)を混ぜる
    const mp = macroPatch(wx, wy);
    _cMacro.copy(mp < 0.5 ? _cGravel : _cScrub);
    _c.lerp(_cMacro, Math.min(0.42, Math.abs(mp-0.5)*0.84));
    _c.lerp(_cSteep, slope);   // 急斜面はむき出しの岩肌
    col[j] = _c.r; col[j+1] = _c.g; col[j+2] = _c.b;
  }
  terrainPos.needsUpdate = true;
  terrainCol.needsUpdate = true;
  terrain.geometry.computeVertexNormals();
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
}

function ensureScene(){
  if(scene || failed) return !!scene;
  try{
    const cv = document.getElementById('glCanvas');
    if(!cv) { failed = true; return false; }
    renderer = new THREE.WebGLRenderer({ canvas:cv, antialias:true, alpha:false });
    renderer.setClearColor(COL_SKY_BOT, 1);
    // 色管理: テクスチャはsRGB、計算はリニア、出力はsRGB。ポストプロセスを挟まないので
    // MSAA(antialias:true)がそのまま効き、トーンマッピングもrenderer側で完結する
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = EXPOSURE;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(COL_HAZE, FOG_NEAR, FOG_FAR);
    camera = new THREE.PerspectiveCamera(64, 1, 8, CAM_FAR);
    // 空 → 遠景の山 → 地形 の順で必ず塗る。空も山も深度を書かないため、
    // 描画順が入れ替わると遠くの山が空に消される(renderOrderで固定する)
    sky = buildSky();   sky.renderOrder = -2;   scene.add(sky);
    ridge = buildDistantRidge(); ridge.renderOrder = -1; scene.add(ridge);
    terrain = buildTerrain();
    scene.add(terrain);
    // 環境光は空そのもの(HDRIの代わり)。半球ライトは環境マップが担うので置かない
    applyEnvironment();
    sun = new THREE.DirectionalLight(0xfff1d6, SUN_INTENSITY);
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    sun.shadow.camera.left = -SHADOW_HALF; sun.shadow.camera.right = SHADOW_HALF;
    sun.shadow.camera.top  =  SHADOW_HALF; sun.shadow.camera.bottom = -SHADOW_HALF;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 4200;
    // 影のにじみ・自己影(縞)対策。normalBiasは地形のスケールに合わせて大きめ
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 3;
    scene.add(sun);
    scene.add(sun.target);
    return true;
  }catch(err){
    console.error('[aramon] WebGLの初期化に失敗しました。従来の描画にフォールバックします', err);
    failed = true; scene = null;
    return false;
  }
}

/* ---- 大きな物(火山・雪山・森・ピラミッド)と地面のしみ(溶岩・海・川・オアシス) ----
   これらは2Dで描くと「起伏のある地面に平らな楕円が貼り付く」形になって浮くので、
   リアルマップでは3D側で地形に沿わせて描く(2D側は描画をやめる)。
   ・山は面を粗く割った円錐(flatShading)。2Dの drawSolidCone と同じ高さ・半径で作るので
     山頂の演出(火口の光・雪の輝き)は2Dのまま重ねてもズレない。
   ・地面のしみは中心から放射状に分割したリングメッシュを地形の高さに沿わせる。      */
const ZONE_SEGS = 28, ZONE_RINGS = 5;   // しみの分割数(粗いと起伏から浮く)
const ZONE_LIFT = 2.5;                  // 地面から少しだけ浮かせてZファイティングを避ける
const MOUNT_SKIRT = 120;                // 山の裾を地面へ埋める深さ(地形の凹みで隙間が出ないように)
const MOUNT_COLORS = {
  volcano: { color:0x6b452c, roughness:0.95 },
  snow:    { color:0xdfe9f6, roughness:0.55 },
  forest:  { color:0x2f5d28, roughness:0.92 },
  pyramid: { color:0xc0a068, roughness:0.80 },
};
/* 水は空をよく映すので、粗さを下げすぎる/環境光を上げすぎると白く飛んで水に見えない。
   青みを残すため roughness は少し高め、envMapIntensity は控えめにする。          */
const ZONE_MATS = {
  sea:   { color:0x134b78, roughness:0.20, opacity:0.90, env:0.75 },
  river: { color:0x1d6392, roughness:0.22, opacity:0.84, env:0.70 },
  oasis: { color:0x14719d, roughness:0.18, opacity:0.90, env:0.80 },
  sand:  { color:0x9a7a46, roughness:0.90, opacity:0.70, env:0.50 },
};
let worldGroup = null, worldSig = '', lavaMats = [];
const mountTexCache = {};
/* 山の肌。地面用に作ったテクスチャを複製して貼り、のっぺりした面を防ぐ。
   複製は画像を共有するので生成コストはかからない(repeat/offsetだけ別に持てる)。 */
function mountainTextures(){
  if(!groundMaps) return null;
  if(!mountTexCache.normalMap){
    const clone = (t, rep)=>{ const c = t.clone(); c.needsUpdate = true; c.repeat.set(rep, rep); c.offset.set(0,0); return c; };
    mountTexCache.normalMap = clone(groundMaps.normalMap, 8);
    mountTexCache.roughnessMap = clone(groundMaps.roughnessMap, 8);
  }
  return mountTexCache;
}

// 地形に沿う円盤(溶岩・水面)。ワールド座標で高さを引くのでメッシュ自体は原点に置く
function buildZoneMesh(z, mat, radius, lift){
  const geo = new THREE.RingGeometry(0.5, radius, ZONE_SEGS, ZONE_RINGS);
  geo.rotateX(-Math.PI/2);
  const pos = geo.attributes.position;
  for(let i=0;i<pos.count;i++){
    const wx = z.x + pos.getX(i), wy = z.y + pos.getZ(i);
    pos.setY(i, heightAt(wx, wy) + lift);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(z.x, 0, z.y);
  mesh.receiveShadow = true;
  return mesh;
}
function zoneMaterial(kind){
  const c = ZONE_MATS[kind];
  return new THREE.MeshStandardMaterial({
    color:c.color, roughness:c.roughness, metalness:0.0,
    transparent:true, opacity:c.opacity, envMapIntensity:c.env,
    // 地面のすぐ上に乗るので、深度の取り合い(ちらつき)を避ける
    polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2,
  });
}
// 山1つ。2Dの drawSolidCone と同じ寸法(半径 / 高さ = radius*(isMain?1.15:0.9))
function buildMountainMesh(v){
  const style = v.style || 'volcano';
  const conf = MOUNT_COLORS[style] || MOUNT_COLORS.volcano;
  const rise = v.radius * (v.isMain ? 1.15 : 0.9);
  const isPyramid = (style === 'pyramid');
  const h = rise + MOUNT_SKIRT;
  // ピラミッドは4面。底面の半対角が2D側の半辺(radius*0.82)に合うよう広げる
  const seg = isPyramid ? 4 : (v.isMain ? 30 : 18);
  const rad = isPyramid ? v.radius*0.82*Math.SQRT2 : v.radius;
  const geo = new THREE.ConeGeometry(rad, h, seg, 1, true);
  const tex = mountainTextures();
  const mat = new THREE.MeshStandardMaterial({
    color: conf.color, roughness: conf.roughness, metalness:0.0,
    normalMap: tex ? tex.normalMap : null,
    roughnessMap: tex ? tex.roughnessMap : null,
    normalScale: new THREE.Vector2(0.7, 0.7),
    flatShading:true, envMapIntensity:ENV_INTENSITY, side:THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const base = heightAt(v.x, v.y) - MOUNT_SKIRT;
  mesh.position.set(v.x, base + h/2, v.y);
  if(isPyramid) mesh.rotation.y = Math.PI/4;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
// 中身が変わったときだけ作り直すための署名(試合ごとに1回)
function worldSignature(w){
  if(!w) return '';
  const part = (arr)=>{
    if(!arr || !arr.length) return '0';
    const f = arr[0], l = arr[arr.length-1];
    return arr.length+':'+Math.round(f.x)+','+Math.round(f.y)+','+Math.round(l.x)+','+Math.round(l.y);
  };
  return [part(w.volcanoes), part(w.lava), part(w.sea), part(w.river), part(w.oasis)].join('|');
}
function buildWorldObjects(w){
  if(worldGroup){
    worldGroup.traverse(o=>{ if(o.isMesh){ o.geometry.dispose(); o.material.dispose(); } });
    scene.remove(worldGroup);
  }
  worldGroup = new THREE.Group();
  lavaMats = [];
  (w.volcanoes||[]).forEach(v=> worldGroup.add(buildMountainMesh(v)));
  // オアシスは濡れた砂の縁を先に敷いてから水面を重ねる(2Dと同じ見せ方)
  (w.oasis||[]).forEach(z=>{
    worldGroup.add(buildZoneMesh(z, zoneMaterial('sand'), z.radius*1.12, ZONE_LIFT*0.6));
    worldGroup.add(buildZoneMesh(z, zoneMaterial('oasis'), z.radius, ZONE_LIFT));
  });
  (w.sea||[]).forEach(z=> worldGroup.add(buildZoneMesh(z, zoneMaterial('sea'), z.radius, ZONE_LIFT)));
  (w.river||[]).forEach(z=> worldGroup.add(buildZoneMesh(z, zoneMaterial('river'), z.radius, ZONE_LIFT)));
  (w.lava||[]).forEach(z=>{
    // 溶岩は自ら光る。明るさは render() で脈打たせる
    const mat = new THREE.MeshStandardMaterial({
      color:0x2a0b04, roughness:0.75, metalness:0.0,
      emissive:new THREE.Color(0xff5a14), emissiveIntensity:1.5,
      polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2,
    });
    lavaMats.push(mat);
    worldGroup.add(buildZoneMesh(z, mat, z.radius, ZONE_LIFT));
  });
  scene.add(worldGroup);
}
function updateWorldObjects(w){
  if(!scene) return;
  const sig = worldSignature(w);
  if(sig === worldSig) return;
  worldSig = sig;
  if(!sig){ if(worldGroup){ scene.remove(worldGroup); worldGroup = null; } return; }
  buildWorldObjects(w);
}

/* ---- 岩の影 ----
   岩そのものは今までどおり2D(render.jsのdrawRealisticRock)で描く。3Dへ移すと
   2Dのモンスターが必ず岩の手前に描かれてしまい、岩に隠れなくなるため。
   代わりに「色を書かない影専用のダミー」だけを3Dに置き、地面に落ちる影を作る。
   ダミーは colorWrite:false / depthWrite:false なので画面には一切出ず、
   シャドウマップにだけ現れる。                                                */
const SHADOW_PROXY_MAX = 18;   // 同時に影を落とせる岩の数(近い順)
let proxyPool = null;
function ensureProxies(){
  if(proxyPool || !scene) return;
  const geo = new THREE.SphereGeometry(1, 10, 7);
  const mat = new THREE.MeshBasicMaterial({ colorWrite:false, depthWrite:false });
  proxyPool = [];
  for(let i=0;i<SHADOW_PROXY_MAX;i++){
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = false;
    m.frustumCulled = false;
    m.visible = false;
    scene.add(m);
    proxyPool.push(m);
  }
}
function updateShadowCasters(list, fx, fy){
  ensureProxies();
  if(!proxyPool) return;
  let n = 0;
  if(Array.isArray(list) && list.length){
    // 影の範囲に入っている岩を近い順に拾う(範囲外は影を計算しても見えない)
    const near = [];
    for(let i=0;i<list.length;i++){
      const r = list[i];
      const dx = r.x - fx, dy = r.y - fy;
      const lim = SHADOW_HALF + (r.radius || 0);
      const d2 = dx*dx + dy*dy;
      if(d2 <= lim*lim) near.push({ r, d2 });
    }
    near.sort((a,b)=>a.d2 - b.d2);
    for(; n < near.length && n < SHADOW_PROXY_MAX; n++){
      const r = near[n].r, m = proxyPool[n];
      const rad = r.radius || 30, h = r.height || rad*1.3;
      const isTree = (r.flavor === 'tree');
      // 木は葉の高さに丸い影、岩は本体の高さでつぶれた影
      m.position.set(r.x, heightAt(r.x, r.y) + (isTree ? h*0.85 : h*0.42), r.y);
      m.scale.set(rad*0.95, isTree ? rad*0.75 : h*0.55, rad*0.95);
      m.visible = true;
    }
  }
  for(let i=n;i<SHADOW_PROXY_MAX;i++) proxyPool[i].visible = false;
}

/* 環境マップ(=HDRIの代わり)。そのマップの空をPMREMに通し、地面が空の色で
   ほんのり照らされるようにする。画像ファイルは増えない。テーマを変えたら作り直す。 */
function applyEnvironment(){
  if(!renderer || !scene) return;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(buildSky(true));
  const next = pmrem.fromScene(envScene, 0, 1, 500);
  if(envRT) envRT.dispose();       // 前のマップぶんを捨てる(貯めるとGPUメモリを食う)
  envRT = next;
  scene.environment = envRT.texture;
  pmrem.dispose();
}

/* マップが変わったときに、空・霞・地面の色・遠景の山をそのマップのテーマへ差し替える。
   地形メッシュそのものは使い回し、色(頂点カラー)とテクスチャだけ作り直す。   */
let appliedTheme = null;
function applyTheme(){
  if(!scene || appliedTheme === theme) return;
  appliedTheme = theme;
  renderer.setClearColor(theme.skyBot, 1);
  scene.fog.color.setHex(theme.haze);
  if(sky){
    sky.material.uniforms.top.value.setHex(theme.skyTop);
    sky.material.uniforms.bot.value.setHex(theme.skyBot);
    sky.material.uniforms.haze.value.setHex(theme.haze);
  }
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
  applyEnvironment();   // 空の色が変わったので環境光も作り直す
  // 遠景の山は色を頂点に焼き込んでいるので作り直す(三角形数は少ないので毎試合1回で十分)
  if(ridge){
    scene.remove(ridge);
    ridge.geometry.dispose();
    ridge = buildDistantRidge();
    ridge.renderOrder = -1;
    scene.add(ridge);
  }
  patchCX = patchCY = null;   // 頂点カラーを塗り直させる
}

function applySize(){
  if(!renderer) return;
  const w = window.viewW || 1, h = window.viewH || 1;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, true);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

const api = {
  // マップがリアルマップかどうかで表示を切り替える。失敗時はfalseを返し、
  // 呼び出し側(render.js)は従来の2D地面を描く
  setActive(on){
    const cv = document.getElementById('glCanvas');
    if(on){
      theme = window.__aramonRealTheme || DEFAULT_THEME;   // マップごとの見た目(data.jsのREAL3D_THEMES)
      if(!ensureScene()){ if(cv) cv.classList.add('hidden'); active = false; return false; }
      applyTheme();
      if(cv) cv.classList.remove('hidden');
      patchCX = patchCY = null;   // 次のrenderで作り直す
      worldSig = '';              // 山としみも作り直す(マップが変わると地面の高さが変わるため)
      applySize();
      active = true;
      return true;
    }
    if(cv) cv.classList.add('hidden');
    active = false;
    return false;
  },
  isActive(){ return active && !!scene; },
  resize(){ if(active) applySize(); },
  // 毎フレーム、2Dの描画より先に呼ぶ。カメラは2Dのproject()と同じ値から作る。
  // shadowCasters には2Dで描く岩の配列(world.jsのrocks)を渡す = 地面に影だけ落とす。
  // world には山と地面のしみ({volcanoes, lava, sea, river, oasis})を渡す = 3Dで描く
  render(shadowCasters, world){
    if(!active || !scene) return false;
    const cp = window.camPos, cs = window.camState;
    if(!cp || !cs) return false;
    // 視野角は2Dのproject()(world.jsのFOV_V)と必ず同じ値にする。設定で変えられるので毎フレーム見る
    const fovDeg = (window.__aramonLook && window.__aramonLook.fovDeg) || 64;
    if(camera.fov !== fovDeg){ camera.fov = fovDeg; camera.updateProjectionMatrix(); }
    updateTerrain(cp.x, cp.y);
    updateWorldObjects(world);
    if(lavaMats.length){
      // 溶岩の脈動(2DのdrawLavaZonesと同じ揺らし方)
      const t = performance.now()*0.001;
      const pulse = 0.75 + 0.25*Math.sin(t*2.4);
      for(let i=0;i<lavaMats.length;i++) lavaMats[i].emissiveIntensity = 1.15 + 0.6*pulse;
    }
    // 空と遠景はカメラに追従させる。ワールドは18100単位あるので原点固定だと視界から外れる
    if(sky) sky.position.set(cp.x, 0, cp.y);
    if(ridge) ridge.position.set(cp.x, 0, cp.y);
    // ゲーム座標(x,y=地面 / z=上)→ Three(x, y=上, z)
    camera.position.set(cp.x, cp.z, cp.y);
    const cosP = Math.cos(cs.pitch), sinP = Math.sin(cs.pitch);
    camera.lookAt(
      cp.x + Math.cos(cs.yaw)*cosP*1000,
      cp.z - sinP*1000,
      cp.y + Math.sin(cs.yaw)*cosP*1000
    );
    // 影の計算範囲はカメラの少し前方に置く。ワールド全体を1枚の影で覆うと
    // 解像度が足りずガビガビになるので、プレイヤー周辺だけを高い密度で覆う
    if(sun){
      const fx = cp.x + Math.cos(cs.yaw)*SHADOW_AHEAD;
      const fy = cp.y + Math.sin(cs.yaw)*SHADOW_AHEAD;
      const fz = heightAt(fx, fy);
      sun.target.position.set(fx, fz, fy);
      sun.position.set(fx + SUN_DIR.x*2200, fz + SUN_DIR.y*2200, fy + SUN_DIR.z*2200);
      updateShadowCasters(shadowCasters, fx, fy);
    }
    renderer.render(scene, camera);
    return true;
  },
};
window.__aramonReal3D = api;
