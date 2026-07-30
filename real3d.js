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
   ・山は面を粗く割った円錐(flatShading)。火口・雪・木々は2Dの円を重ねるのではなく、
     形(火山は先を切って火口を作る)と頂点カラー(高さで色を変える)で表現する。
   ・地面のしみは中心から放射状に分割したリングメッシュを地形の高さに沿わせる。
     UVはワールド座標から作るので、1組のテクスチャを全部のしみで共有できる。      */
const ZONE_SEGS = 28, ZONE_RINGS = 5;   // しみの分割数(粗いと起伏から浮く)
const ZONE_LIFT = 2.5;                  // 地面から少しだけ浮かせてZファイティングを避ける
const ZONE_UV_TILE = 300;               // しみのテクスチャが1周するワールド単位
const MOUNT_SKIRT = 120;                // 山の裾を地面へ埋める深さ(地形の凹みで隙間が出ないように)
const CRATER_RATIO = 0.17;              // 火山の火口の広さ(山の半径に対する比)
/* 山の色。高さ(0=麓 1=頂上)で麓・中腹・頂上の3色を混ぜる。
   これが「山頂の丸い演出」の代わりで、視点を変えても山に沿ったまま崩れない。   */
const MOUNT_COLORS = {
  volcano: { foot:0x4e3320, mid:0x36251a, top:0x1d1512, rough:0.95 },
  snow:    { foot:0x6d7d90, mid:0xb4c6da, top:0xf2f8ff, rough:0.55 },
  forest:  { foot:0x36421f, mid:0x27461c, top:0x152e12, rough:0.92 },
  pyramid: { foot:0x8a6f3f, mid:0xa88a54, top:0xc0a068, rough:0.80 },
};
/* 水は空をよく映すので、粗さを下げすぎる/環境光を上げすぎると白く飛んで水に見えない。
   青みを残すため roughness は少し高め、envMapIntensity は控えめにする。          */
const ZONE_MATS = {
  sea:   { color:0x0e3f68, roughness:0.20, opacity:0.92, env:0.55 },
  river: { color:0x1d6392, roughness:0.22, opacity:0.84, env:0.70 },
  oasis: { color:0x14719d, roughness:0.18, opacity:0.90, env:0.80 },
  sand:  { color:0x9a7a46, roughness:0.90, opacity:0.70, env:0.50 },
};
let worldGroup = null, worldSig = '', lavaMats = [];
const mountTexCache = {};
let zoneTex = null, zoneMatCache = null;
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

/* 溶岩と水面のテクスチャ。ここも画像ファイルは持たず手続き的に作る。
   ・溶岩: 冷えた黒い地殻 + 割れ目だけが光る(emissiveMap)。割れ目から法線も作る
   ・水面: さざ波の法線マップ。offsetを毎フレーム流して水が動いて見えるようにする   */
function buildZoneTextures(){
  if(zoneTex) return zoneTex;
  const S = 256;
  // 地殻の高さ場(尾根ノイズの谷が割れ目になる)
  const H = new Float32Array(S*S), CR = new Float32Array(S*S);
  for(let y=0;y<S;y++){
    for(let x=0;x<S;x++){
      const u = x/S, v = y/S;
      const plate = fbmTile(u, v, 6, 3);
      const ridge = 1 - Math.abs(fbmTile(u, v, 9, 2)*2 - 1);
      const crack = Math.max(0, ridge - 0.72) * 3.6;      // 0=地殻 1=割れ目の中心
      H[y*S+x] = plate*0.8 - crack*0.9;
      CR[y*S+x] = Math.min(1, crack);
    }
  }
  const at = (A,x,y)=>A[(((y%S)+S)%S)*S + (((x%S)+S)%S)];
  const lavaColor = makeTexture(S, (d)=>{
    for(let y=0;y<S;y++) for(let x=0;x<S;x++){
      const c = CR[y*S+x], h = H[y*S+x];
      // 冷えた地殻は黒〜焦げ茶、割れ目に近いほど赤熱する
      const r = 0.10 + h*0.10 + c*0.85, g = 0.06 + h*0.05 + c*0.30, b = 0.05 + h*0.04 + c*0.06;
      const i = (y*S+x)*4;
      d[i]   = Math.round(Math.max(0,Math.min(1,r))*255);
      d[i+1] = Math.round(Math.max(0,Math.min(1,g))*255);
      d[i+2] = Math.round(Math.max(0,Math.min(1,b))*255);
      d[i+3] = 255;
    }
  }, true);
  const lavaGlow = makeTexture(S, (d)=>{
    for(let y=0;y<S;y++) for(let x=0;x<S;x++){
      const c = Math.pow(CR[y*S+x], 0.7);
      const i = (y*S+x)*4;
      d[i]   = Math.round(c*255);          // 割れ目だけが光る
      d[i+1] = Math.round(c*c*150);
      d[i+2] = Math.round(c*c*c*40);
      d[i+3] = 255;
    }
  }, true);
  const lavaNormal = makeTexture(S, (d)=>{
    for(let y=0;y<S;y++) for(let x=0;x<S;x++){
      const dx = (at(H,x+1,y)-at(H,x-1,y))*2.2, dy = (at(H,x,y+1)-at(H,x,y-1))*2.2;
      const len = Math.hypot(dx,dy,1), i=(y*S+x)*4;
      d[i]   = Math.round((-dx/len*0.5+0.5)*255);
      d[i+1] = Math.round(( dy/len*0.5+0.5)*255);
      d[i+2] = Math.round((  1/len*0.5+0.5)*255);
      d[i+3] = 255;
    }
  }, false);
  // さざ波: 向きの違う波を重ねた高さ場から法線を作る
  const W = 128;
  const waterNormal = makeTexture(W, (d)=>{
    const wave = (u,v)=> Math.sin((u*6.0 + v*2.0)*Math.PI*2)*0.5
                       + Math.sin((u*-3.0 + v*7.0)*Math.PI*2)*0.35
                       + fbmTile(u, v, 8, 2)*0.8;
    for(let y=0;y<W;y++) for(let x=0;x<W;x++){
      const u=x/W, v=y/W, e=1/W;
      const dx = (wave(u+e,v)-wave(u-e,v))*0.9, dy = (wave(u,v+e)-wave(u,v-e))*0.9;
      const len = Math.hypot(dx,dy,1), i=(y*W+x)*4;
      d[i]   = Math.round((-dx/len*0.5+0.5)*255);
      d[i+1] = Math.round(( dy/len*0.5+0.5)*255);
      d[i+2] = Math.round((  1/len*0.5+0.5)*255);
      d[i+3] = 255;
    }
  }, false);
  waterNormal.repeat.set(2.5, 2.5);
  waterNormal.anisotropy = 8;   // 水面は浅い角度で見るので、上げないと模様が干渉して縞になる
  zoneTex = { lavaColor, lavaGlow, lavaNormal, waterNormal };
  return zoneTex;
}
// 地形に沿う円盤(溶岩・水面)。ワールド座標で高さとUVを決めるのでメッシュ自体は原点に置く
function buildZoneMesh(z, mat, radius, lift){
  const geo = new THREE.RingGeometry(0.5, radius, ZONE_SEGS, ZONE_RINGS);
  geo.rotateX(-Math.PI/2);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for(let i=0;i<pos.count;i++){
    const wx = z.x + pos.getX(i), wy = z.y + pos.getZ(i);
    pos.setY(i, heightAt(wx, wy) + lift);
    // UVをワールド座標から作ると、大きさの違うしみでも模様の細かさが揃い、
    // テクスチャを1組だけ作って全部で共有できる(複製するとGPUメモリを食う)
    uv.setXY(i, wx/ZONE_UV_TILE, wy/ZONE_UV_TILE);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(z.x, 0, z.y);
  mesh.receiveShadow = true;
  return mesh;
}
// しみの材質は種類ごとに1つだけ作って共有する
function zoneMaterial(kind){
  if(!zoneMatCache){
    const tex = buildZoneTextures();
    const water = (c)=> new THREE.MeshStandardMaterial({
      color:c.color, roughness:c.roughness, metalness:0.0,
      normalMap: tex.waterNormal, normalScale: new THREE.Vector2(0.45, 0.45),
      transparent:true, opacity:c.opacity, envMapIntensity:c.env,
      // 地面のすぐ上に乗るので、深度の取り合い(ちらつき)を避ける
      polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2,
    });
    const sandConf = ZONE_MATS.sand;
    const sandNormal = groundMaps ? groundMaps.normalMap.clone() : null;
    if(sandNormal){ sandNormal.needsUpdate = true; sandNormal.repeat.set(1,1); sandNormal.offset.set(0,0); }
    zoneMatCache = {
      sea: water(ZONE_MATS.sea), river: water(ZONE_MATS.river), oasis: water(ZONE_MATS.oasis),
      sand: new THREE.MeshStandardMaterial({
        color:sandConf.color, roughness:sandConf.roughness, metalness:0.0,
        normalMap:sandNormal, normalScale:new THREE.Vector2(0.6,0.6),
        transparent:true, opacity:sandConf.opacity, envMapIntensity:sandConf.env,
        polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2,
      }),
      // 溶岩: 黒い地殻の割れ目だけが光る。明るさは render() で脈打たせる
      lava: new THREE.MeshStandardMaterial({
        map: tex.lavaColor, normalMap: tex.lavaNormal, normalScale:new THREE.Vector2(1.1,1.1),
        emissiveMap: tex.lavaGlow, emissive:new THREE.Color(0xffffff), emissiveIntensity:1.4,
        roughness:0.85, metalness:0.0,
        polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2,
      }),
    };
  }
  Object.values(zoneMatCache).forEach(m=>{ m.userData.shared = true; });
  return zoneMatCache[kind];
}
/* ---- 海と川(1枚のつながった水面) ----
   円を並べて表現すると輪郭が数珠つなぎに見えるので、海は「海岸線(seaEdgeX)の沖側」、
   川は「円の連なりを芯にしたリボン」として1枚の面を張る。
   ・海面の高さは海岸線上の地形の平均。沖は深い水、岸に近づくほど地面に沿う浅瀬になる
   ・波と流れは頂点シェーダーで動かす(CPUは毎フレーム何もしない)
     - 海: 岸(aShore=1)へ向かって進む波。波頭と岸ぎわが白く泡立つ
     - 川: aFlowの向きへ模様が流れる
   ・材質は地面と同じ MeshStandardMaterial(PBR)。質感を地面と揃えるため作りは変えない */
const SEA_COLS = 22;          // 沖→岸の分割数
const SEA_ROW_STEP = 220;     // 海岸線に沿う分割の間隔
const SEA_EXTENT = 4200;      // 海岸線から沖へどこまで水面を張るか
const SEA_LIFT = 4;           // 地面に沿う浅瀬ぶんの持ち上げ
const RIVER_SPLIT_DIST = 700; // これ以上離れていたら別の川とみなす
const RIVER_CROSS = 5;        // 川の断面の分割数(少ないと泡が川幅いっぱいに広がる)
let waterMat = null, waterShaders = [];

function waterMaterial(){
  if(waterMat) return waterMat;
  const tex = buildZoneTextures();
  waterMat = new THREE.MeshStandardMaterial({
    color: ZONE_MATS.sea.color, roughness: ZONE_MATS.sea.roughness, metalness: 0.0,
    normalMap: tex.waterNormal, normalScale: new THREE.Vector2(0.5, 0.5),
    transparent: true, opacity: ZONE_MATS.sea.opacity, envMapIntensity: ZONE_MATS.sea.env,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    // 手で組んだ帯なので三角形の表裏が揃わない。水面は裏からも見えてよいので両面にする
    side: THREE.DoubleSide,
  });
  waterMat.userData.shared = true;
  waterMat.onBeforeCompile = (shader)=>{
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aShore;    // 0=沖/川の中央  1=岸/川岸
        attribute vec2 aFlow;      // 川の流れる向き(海は0,0)
        uniform float uTime;
        varying float vShore;
        varying float vCrest;
        varying vec2 vFlow;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float crest = 0.0;
        if(dot(aFlow, aFlow) < 0.01){
          // 海: 岸に向かって進むうねり。岸に近いほど波長を詰めて崩れる波にする
          // 波の線が定規で引いたように真っ直ぐにならないよう、岸に沿ってうねらせ、
          // 周期の違う波を重ねる
          float ph = aShore*26.0 - uTime*1.8 + sin(position.z*0.0035)*0.9 + sin(position.z*0.0011)*0.6;
          crest = (sin(ph)*0.5 + 0.5)*0.72 + (sin(ph*0.41 + 1.7)*0.5 + 0.5)*0.28;
          transformed.y += (crest - 0.5) * 7.0 * (0.35 + aShore*0.65) * (1.0 - aShore*aShore*0.55);
        } else {
          // 川: 流れる向きへ小さなさざ波が進む
          float ph = dot(position.xz, aFlow)*0.045 - uTime*3.4;
          crest = sin(ph) * 0.5 + 0.5;
          transformed.y += (crest - 0.5) * 1.6 * (1.0 - aShore*0.7);
        }
        vShore = aShore; vCrest = crest; vFlow = aFlow;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        varying float vShore;
        varying float vCrest;
        varying vec2 vFlow;`)
      // 法線マップを流れ/波の向きへ動かして、水面が止まって見えないようにする
      .replace('#include <normal_fragment_maps>', `
        #ifdef USE_NORMALMAP
          vec2 flowUv = vNormalMapUv;
          if(dot(vFlow, vFlow) < 0.01) flowUv += vec2(0.0, uTime*0.035);
          else flowUv += vFlow * (uTime*0.11);
          vec3 mapN = texture2D( normalMap, flowUv ).xyz * 2.0 - 1.0;
          mapN.xy *= normalScale;
          normal = normalize( tbn * mapN );
        #endif`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // 泡は「岸ぎわの細い帯」と「海で寄せる波の帯」の2つ。広く白くしない
        float bankFoam = smoothstep(0.88, 1.0, vShore) * (0.45 + 0.55*vCrest);
        float washFoam = (dot(vFlow, vFlow) < 0.01)
          ? smoothstep(0.55, 1.0, vShore) * smoothstep(0.72, 1.0, vCrest)
          : 0.0;
        float foam = clamp(max(bankFoam, washFoam), 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.96, 1.0), foam*0.8);
        // 浅い所ほど透けさせると、水際が硬い線に見えない
        diffuseColor.a *= mix(1.0, 0.5, smoothstep(0.8, 1.0, vShore));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.85, foam);`);
    waterShaders.push(shader);
  };
  return waterMat;
}
// 頂点配列から水面メッシュを組む(位置・法線はワールド座標そのまま)
function buildWaterMesh(pos, shore, flow, index){
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1));
  geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
  geo.setIndex(index);
  // UVはワールド座標から作る(しみと同じ考え方。1組のテクスチャを共有できる)
  const uv = new Float32Array((pos.length/3)*2);
  for(let i=0, j=0; i<pos.length; i+=3, j+=2){
    uv[j] = pos[i]/ZONE_UV_TILE; uv[j+1] = pos[i+2]/ZONE_UV_TILE;
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  // 三角形の向きによって法線が下を向くことがあるので、必ず上向きに揃える
  const nrm = geo.attributes.normal;
  for(let i=0;i<nrm.count;i++){
    if(nrm.getY(i) < 0) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
  }
  nrm.needsUpdate = true;
  const mesh = new THREE.Mesh(geo, waterMaterial());
  mesh.receiveShadow = true;
  return mesh;
}
/* 海。海岸線 seaEdgeX(y) の沖側に、岸に沿った格子を張る。
   列(u)が 0=沖 1=岸 なので、そのまま波の進む向きと泡の位置に使える。      */
function buildSeaMesh(edgeFn, worldH){
  const y0 = -600, y1 = worldH + 600;
  const rows = Math.max(2, Math.round((y1-y0)/SEA_ROW_STEP));
  /* 海面の高さは行(y)ごとに決める。全体で1つの平均にすると、地形の起伏(±130ほど)に
     負けて水面が地面に埋もれ、ほとんど水に見えなくなる。
     沖の地形を数点サンプルし、その上位あたりを水面にすることで大半が水没する。   */
  const levelAt = (y)=>{
    const edge = edgeFn(y);
    const samples = [];
    for(let k=1;k<=6;k++) samples.push(heightAt(edge - SEA_EXTENT*(k/7), y));
    samples.sort((a,b)=>a-b);
    return samples[Math.min(samples.length-1, Math.round(samples.length*0.75))] + 8;
  };
  const pos = [], shore = [], flow = [], index = [];
  for(let r=0;r<=rows;r++){
    const y = y0 + (y1-y0)*(r/rows);
    const edge = edgeFn(y);
    // 水面が縦に波打たないよう、前後の行と平均して滑らかにする
    const level = (levelAt(y - SEA_ROW_STEP) + levelAt(y)*2 + levelAt(y + SEA_ROW_STEP)) / 4;
    for(let c=0;c<=SEA_COLS;c++){
      const u = c/SEA_COLS;                       // 0=沖 1=岸
      const x = edge - SEA_EXTENT*Math.pow(1-u, 1.7);   // 岸に近いほど細かく
      const g = heightAt(x, y) + SEA_LIFT;
      // 沖は水平な海面。岸ぎわだけ地面へ寄せて、水際に段差が立たないようにする
      const t = Math.max(0, Math.min(1, (u - 0.82)/0.18));
      const smooth = t*t*(3-2*t);
      pos.push(x, Math.max(g, level*(1-smooth) + g*smooth), y);
      shore.push(u);
      flow.push(0, 0);
    }
  }
  const stride = SEA_COLS + 1;
  for(let r=0;r<rows;r++){
    for(let c=0;c<SEA_COLS;c++){
      const a = r*stride + c, b = a+1, d = a+stride, e = d+1;
      index.push(a, d, b, b, d, e);
    }
  }
  return buildWaterMesh(pos, shore, flow, index);
}
/* 川。円の連なりを芯にしてリボンを張る(円そのものは描かない)。
   円は生成順に並んでいるので、離れすぎた所で別の川に切り分ける。          */
function splitRivers(zones){
  const rivers = [];
  let cur = null;
  for(let i=0;i<zones.length;i++){
    const z = zones[i];
    if(!cur || Math.hypot(z.x-cur[cur.length-1].x, z.y-cur[cur.length-1].y) > RIVER_SPLIT_DIST){
      cur = []; rivers.push(cur);
    }
    cur.push(z);
  }
  return rivers.filter(r=>r.length >= 2);
}
function buildRiverMesh(chain){
  const pos = [], shore = [], flow = [], index = [];
  const N = chain.length;
  for(let i=0;i<N;i++){
    const p = chain[i];
    const a = chain[Math.max(0,i-1)], b = chain[Math.min(N-1,i+1)];
    let dx = b.x-a.x, dy = b.y-a.y;
    const len = Math.hypot(dx,dy) || 1;
    dx/=len; dy/=len;                       // 流れる向き(海の方へ)
    const nx = -dy, ny = dx;                // 川幅の向き
    const w = p.radius*1.05;
    // 断面は5点。泡が川幅の半分まで広がらないよう、岸ぎわだけaShoreを高くする
    for(let k=0;k<RIVER_CROSS;k++){
      const s = -1 + 2*k/(RIVER_CROSS-1);
      const x = p.x + nx*w*s, y = p.y + ny*w*s;
      pos.push(x, heightAt(x,y) + SEA_LIFT*0.6, y);
      shore.push(Math.pow(Math.abs(s), 2.2));   // 0=中央 1=岸
      flow.push(dx, dy);
    }
  }
  for(let i=0;i<N-1;i++){
    const a = i*RIVER_CROSS, b = (i+1)*RIVER_CROSS;
    for(let k=0;k<RIVER_CROSS-1;k++){
      index.push(a+k, b+k, a+k+1, a+k+1, b+k, b+k+1);
    }
  }
  return buildWaterMesh(pos, shore, flow, index);
}

/* 山1つ。2Dの drawSolidCone と同じ寸法(半径 / 高さ = radius*(isMain?1.15:0.9))。
   火山の主峰だけ先端を切って火口にする。色は高さで麓→中腹→頂上を混ぜ、
   ワールド座標のノイズでまだらにする(のっぺりした一色の面を防ぐ)。          */
const _mc = new THREE.Color(), _mcTmp = new THREE.Color();
function mountainVertexColor(conf, t, mottle){
  // t: 0=麓 1=頂上
  if(t < 0.5) _mc.setHex(conf.foot).lerp(_mcTmp.setHex(conf.mid), t/0.5);
  else        _mc.setHex(conf.mid).lerp(_mcTmp.setHex(conf.top), (t-0.5)/0.5);
  _mc.multiplyScalar(0.88 + mottle*0.24);
  return _mc;
}
function buildMountainMesh(v){
  const style = v.style || 'volcano';
  const conf = MOUNT_COLORS[style] || MOUNT_COLORS.volcano;
  const rise = v.radius * (v.isMain ? 1.15 : 0.9);
  const isPyramid = (style === 'pyramid');
  const hasCrater = (style === 'volcano' && v.isMain);
  const h = rise + MOUNT_SKIRT;
  // ピラミッドは4面。底面の半対角が2D側の半辺(radius*0.82)に合うよう広げる
  const seg = isPyramid ? 4 : (v.isMain ? 30 : 18);
  const rad = isPyramid ? v.radius*0.82*Math.SQRT2 : v.radius;
  // 火山は先を切った円錐にして、頂上に火口の穴を作る
  const geo = hasCrater
    ? new THREE.CylinderGeometry(rad*CRATER_RATIO, rad, h, seg, 3, true)
    : new THREE.ConeGeometry(rad, h, seg, 3, true);
  const pos = geo.attributes.position;
  /* 側面を内側にだけ少しへこませて、きれいすぎる円錐に見えないようにする。
     外へ膨らませると当たり判定(半径)の外に山肌が出て、山にめり込んで見えるので
     必ず内向き(k<=1)にする。ピラミッドは形が崩れるので凹ませない。          */
  if(!isPyramid){
    // 山ごとに違う形にするための種。volcanoObstaclesにseedは無いので位置から作る
    const seed = _hash(v.x*0.013, v.y*0.017) * 10;
    for(let i=0;i<pos.count;i++){
      const px = pos.getX(i), pz = pos.getZ(i), py = pos.getY(i);
      const r = Math.hypot(px, pz);
      if(r < 1) continue;
      const ang = Math.atan2(pz, px) + Math.PI;
      const n = tileNoise(ang*2.2 + seed*0.7, (py + h/2)/h*3.5, 32);
      const k = 1 - 0.11*n;
      pos.setXYZ(i, px*k, py, pz*k);
    }
  }
  // 頂点カラー(高さ + ワールド座標のまだら)
  const col = new Float32Array(pos.count*3);
  for(let i=0;i<pos.count;i++){
    const localY = pos.getY(i);
    const t = Math.max(0, Math.min(1, (localY + h/2 - MOUNT_SKIRT) / rise));
    const wx = v.x + pos.getX(i), wz = v.y + pos.getZ(i);
    const mottle = tileNoise(wx/220, wz/220, 64);
    const c = mountainVertexColor(conf, t, mottle);
    col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const tex = mountainTextures();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors:true, roughness: conf.rough, metalness:0.0,
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
  if(!hasCrater) return mesh;
  // 火口: 少しへこませた円盤。溶岩と同じ脈動で赤熱させる
  const craterMat = new THREE.MeshStandardMaterial({
    color:0x1c0a05, roughness:0.9, metalness:0.0,
    emissive:new THREE.Color(0xff4a10), emissiveIntensity:1.4,
  });
  lavaMats.push(craterMat);
  const crater = new THREE.Mesh(new THREE.CircleGeometry(rad*CRATER_RATIO*0.96, seg), craterMat);
  crater.geometry.rotateX(-Math.PI/2);
  crater.position.set(v.x, base + h - rad*0.05, v.y);
  // 火口の縁。下から見上げても「熱を持った火山」だと分かるよう、山頂の縁だけ赤熱させる。
  // 画面に貼る円ではなく山の一部なので、視点を変えても山からずれない
  const rimMat = new THREE.MeshStandardMaterial({
    color:0x2a1108, roughness:0.9, metalness:0.0,
    emissive:new THREE.Color(0xff3c08), emissiveIntensity:0.55, side:THREE.DoubleSide,
  });
  lavaMats.push(rimMat);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(rad*CRATER_RATIO*1.02, rad*CRATER_RATIO*1.12, rise*0.05, seg, 1, true), rimMat);
  rim.position.set(v.x, base + h - rise*0.025, v.y);
  const group = new THREE.Group();
  group.add(mesh); group.add(crater); group.add(rim);
  return group;
}
// 中身が変わったときだけ作り直すための署名(試合ごとに1回)
function worldSignature(w){
  if(!w) return '';
  const part = (arr)=>{
    if(!arr || !arr.length) return '0';
    const f = arr[0], l = arr[arr.length-1];
    return arr.length+':'+Math.round(f.x)+','+Math.round(f.y)+','+Math.round(l.x)+','+Math.round(l.y);
  };
  return [part(w.volcanoes), part(w.lava), part(w.sea), part(w.river), part(w.oasis), w.seaEdge?'s':'-'].join('|');
}
function buildWorldObjects(w){
  if(worldGroup){
    // 材質は種類ごとに共有しているものがあるので、共有印の無いものだけ捨てる
    worldGroup.traverse(o=>{
      if(!o.isMesh) return;
      o.geometry.dispose();
      if(!o.material.userData.shared) o.material.dispose();
    });
    scene.remove(worldGroup);
  }
  worldGroup = new THREE.Group();
  lavaMats = [];
  waterShaders = [];
  (w.volcanoes||[]).forEach(v=> worldGroup.add(buildMountainMesh(v)));
  // オアシスは濡れた砂の縁を先に敷いてから水面を重ねる(2Dと同じ見せ方)
  (w.oasis||[]).forEach(z=>{
    worldGroup.add(buildZoneMesh(z, zoneMaterial('sand'), z.radius*1.12, ZONE_LIFT*0.6));
    worldGroup.add(buildZoneMesh(z, zoneMaterial('oasis'), z.radius, ZONE_LIFT));
  });
  // 海と川は円を並べず、1枚のつながった水面として張る
  if(w.seaEdge && (w.sea||[]).length) worldGroup.add(buildSeaMesh(w.seaEdge, (w.bounds && w.bounds.h) || 18100));
  if((w.river||[]).length) splitRivers(w.river).forEach(ch=> worldGroup.add(buildRiverMesh(ch)));
  if((w.lava||[]).length){
    const lavaMat = zoneMaterial('lava');   // 材質は全部の溶岩で共有(脈動もまとめて効く)
    lavaMats.push(lavaMat);
    w.lava.forEach(z=> worldGroup.add(buildZoneMesh(z, lavaMat, z.radius, ZONE_LIFT)));
  }
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

/* ---- 障害物(岩・木・水晶など) ----
   2Dで描いていた障害物を3Dモデルに置き換える。地形に沿って埋まり、影も落とす。
   【前後関係】3Dに移すと2Dで描くモンスター・弾は必ず障害物より手前に来てしまう。
   そこでrender.jsが「同じ輪郭を destination-out でくり抜く」ことで、その障害物より
   奥に描かれたものだけを消している。手前のものは後から普通に上へ描かれるので、
   従来の奥行きソートと同じ見え方のまま変わらない。形の定義(OBST_SHAPES)は
   data.jsに1つだけ置き、3Dモデルと2Dのくり抜きが必ず同じ寸法を見るようにしてある。
   【数】1マップに数百個あるので種類ごとにInstancedMeshへまとめ(描画命令は十数回)、
   プレイヤーの近くのぶんだけを並べ替えて使う。                                  */
const OBST_VIEW = 3300;    // これより遠い障害物は出さない(霞で見えなくなる距離)
const OBST_MAX  = 620;     // 同時に並べられる数の上限(訓練場は狭くて密なので多め)
const OBST_STEP = 200;     // プレイヤーがこの距離だけ動いたら並べ直す
const OBST_VARIANTS = 3;   // 同じ種類でも形を3通り作って「同じ岩の繰り返し」を防ぐ
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const OBST_SHAPE_FB = { h:1.2, sink:0.2 };
let obstGroup = null, obstKinds = null, obstSrc = null, obstSig = '';
let obstCX = null, obstCY = null, obstCull = OBST_VIEW;

function shapeOf(flavor){
  const t = window.__aramonObstShapes;
  return (t && (t[flavor] || t.rock)) || OBST_SHAPE_FB;
}
/* 小さなモデルを1つのジオメトリにまとめる(three本体にmergeGeometriesは無い)。
   一度も描いていないジオメトリはGPU資源を持たないのでdisposeは不要。          */
function mergeGeos(list){
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
// モデルのローカル高さ(y0→y1)で色を塗る。mottleはワールドではなく形に乗るまだら
function paintGeo(geo, lo, hi, y0, y1, mottle){
  const pos = geo.attributes.position, n = pos.count, col = new Float32Array(n*3);
  const cA = new THREE.Color(lo), cB = new THREE.Color(hi), c = new THREE.Color();
  const amp = (mottle == null) ? 0.20 : mottle;
  for(let i=0;i<n;i++){
    const t = Math.max(0, Math.min(1, (pos.getY(i)-y0) / Math.max(0.0001, y1-y0)));
    c.copy(cA).lerp(cB, t);
    const m = 1 + (tileNoise(pos.getX(i)*2.7+11, pos.getZ(i)*2.7+7, 32) - 0.5)*amp;
    col[i*3] = c.r*m; col[i*3+1] = c.g*m; col[i*3+2] = c.b*m;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}
// 上の面だけ別の色を乗せる(岩の雪・倒木の苔)。塗り済みの色に混ぜる
function tintTop(geo, hex, y0, y1, strength){
  const pos = geo.attributes.position, col = geo.attributes.color;
  if(!col) return geo;
  const w = new THREE.Color(hex), c = new THREE.Color();
  for(let i=0;i<pos.count;i++){
    const t = Math.max(0, Math.min(1, (pos.getY(i)-y0) / Math.max(0.0001, y1-y0)));
    const k = t*t*(0.6 + tileNoise(pos.getX(i)*3.3+3, pos.getZ(i)*3.3+5, 32)*0.8)*(strength==null?1:strength);
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(w, Math.min(1, k));
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
  return geo;
}
// でこぼこの塊。半径1・底が地面(y=0)より少し下に来るように置く
function boulderGeo(seed, flat){
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  for(let i=0;i<pos.count;i++){
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = tileNoise(x*1.7+seed*3.1, z*1.7+seed*1.9, 32)*0.6
            + tileNoise(y*2.9+seed*2.3, x*2.9+seed*4.7, 32)*0.4;
    const k = 0.72 + n*0.56;   // 振れ幅を大きくして「丸い塊」ではなく角のある岩にする
    pos.setXYZ(i, x*k, y*k*flat, z*k);
  }
  geo.computeVertexNormals();
  geo.translate(0, flat*0.94, 0);
  return geo;
}
// 幹・柱。根元がy0、上へ伸ばす
function trunkGeo(rBot, rTop, h, y0, seg){
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg||7, 1, false);
  g.translate(0, y0 + h/2, 0);
  return g;
}
// 縦の筋(柱状節理・サボテンの畝)を付ける
function ribbed(geo, count, amp){
  const pos = geo.attributes.position;
  for(let i=0;i<pos.count;i++){
    const x = pos.getX(i), z = pos.getZ(i);
    const k = 1 + Math.cos(Math.atan2(z, x)*count)*amp;
    pos.setXYZ(i, x*k, pos.getY(i), z*k);
  }
  geo.computeVertexNormals();
  return geo;
}
/* 種類ごとの3Dモデル。すべて「当たり判定の半径=1、地面=y0」のローカル空間で作る。
   全高は data.js の OBST_SHAPES.h と揃えること(2Dのくり抜きがこの値を見る)。   */
function obstacleGeo(flavor, variant){
  const s = variant*2.7 + 1.3;
  const frac = (v)=>{ const f = v - Math.floor(v); return f; };
  switch(flavor){
    case 'sandrock':
      // 砂岩: 平たく、風で削れた層の色が出る
      return paintGeo(boulderGeo(s, 0.42), 0x7a6140, 0xdcc08a, 0, 0.9, 0.34);
    case 'snowrock':
      // 雪をかぶった岩
      return tintTop(paintGeo(boulderGeo(s, 0.58), 0x55606f, 0x8593a6, 0, 1.24, 0.30), 0xf6fbff, 0.62, 1.15, 1.0);
    case 'basalt': {
      // 溶岩が固まった黒い柱(柱状節理)。太い1本のまわりに細い柱を寄せる
      const parts = [];
      const n = 3 + (variant % 2);
      for(let i=0;i<n;i++){
        const a = s*1.3 + i*2.2, d = i===0 ? 0 : 0.42;
        const rr = i===0 ? 0.48 : 0.30;
        const hh = i===0 ? 2.05 : (1.05 + frac(i*0.37 + s)*0.65);
        const c = ribbed(new THREE.CylinderGeometry(rr*0.90, rr, hh, 6), 6, 0.05);
        c.translate(0, hh/2 - 0.06, 0);
        c.rotateZ((i===0 ? 0.03 : 0.11) * (i%2 ? 1 : -1));
        c.translate(Math.cos(a)*d, 0, Math.sin(a)*d);
        parts.push(c);
      }
      return paintGeo(mergeGeos(parts), 0x0d0b0a, 0x2c231c, 0, 2.05, 0.26);
    }
    case 'deadtree': {
      // 枯れ木: 葉の無い幹と数本の枝
      const parts = [ trunkGeo(0.21, 0.09, 2.25, 0, 7) ];
      const ys = [1.05, 1.40, 1.72, 1.98], ls = [1.00, 0.88, 0.76, 0.60], ts = [0.95, 0.82, 0.70, 0.55];
      for(let i=0;i<4;i++){
        const b = new THREE.CylinderGeometry(0.045, 0.115, ls[i], 5);
        b.translate(0, ls[i]/2, 0);
        b.rotateZ(ts[i] * (i%2 ? 1 : -1));
        b.rotateY(s*1.7 + i*1.9);
        b.translate(0, ys[i], 0);
        parts.push(b);
      }
      return paintGeo(mergeGeos(parts), 0x3a2c1e, 0x7a6650, 0, 2.55, 0.24);
    }
    case 'pine': {
      // 雪をかぶった針葉樹。段ごとに上へ行くほど白くする
      const parts = [ paintGeo(trunkGeo(0.14, 0.10, 0.78, 0, 6), 0x3a2a1c, 0x584232, 0, 0.78) ];
      const bases = [0.52, 1.12, 1.72], rs = [0.98, 0.78, 0.54], hs = [1.18, 1.10, 0.98];
      for(let i=0;i<3;i++){
        const c = ribbed(new THREE.ConeGeometry(rs[i], hs[i], 9), 9, 0.07);
        c.translate(0, bases[i] + hs[i]/2, 0);
        paintGeo(c, 0x1b3a1c, 0x2f5c2a, bases[i], bases[i]+hs[i], 0.26);
        tintTop(c, 0xf2f9ff, bases[i]+hs[i]*0.35, bases[i]+hs[i]*0.95, 1.15);
        parts.push(c);
      }
      return mergeGeos(parts);
    }
    case 'tree': {
      // ジャングルの広葉樹。幹 + 重ねた葉の塊
      const parts = [ paintGeo(trunkGeo(0.23, 0.15, 1.5, 0, 7), 0x40301f, 0x6b5136, 0, 1.5) ];
      const put = [[0, 1.88, 0, 0.78], [0.40, 1.55, 0.16, 0.50], [-0.34, 1.62, -0.28, 0.52]];
      for(let i=0;i<put.length;i++){
        const [px, py, pz, rr] = put[i];
        const g = boulderGeo(s + i*1.6, 0.92);
        g.scale(rr, rr, rr);
        g.translate(px, py - rr*0.86, pz);
        paintGeo(g, 0x1c4a1a, 0x53913a, py-rr, py+rr, 0.30);
        parts.push(g);
      }
      return mergeGeos(parts);
    }
    case 'log': {
      // 倒木。地面に横たわり、上面に苔が乗る
      const body = new THREE.CylinderGeometry(0.27, 0.31, 1.75, 9);
      body.rotateZ(Math.PI/2);
      body.translate(0, 0.30, 0);
      const stub = new THREE.CylinderGeometry(0.07, 0.09, 0.45, 5);
      stub.rotateZ(0.9); stub.rotateY(s);
      stub.translate(0.25, 0.42, 0.10);
      const geo = paintGeo(mergeGeos([body, stub]), 0x3d2c1c, 0x6d5738, 0, 0.62, 0.28);
      return tintTop(geo, 0x4c6b28, 0.34, 0.62, 1.1);
    }
    case 'palm': {
      // ヤシ。少し傾いた幹と放射状の葉
      // 傾けすぎると2Dのくり抜き(縦の箱)が幹より太くなってしまうので控えめにする
      const trunk = trunkGeo(0.17, 0.10, 2.8, 0, 7);
      trunk.rotateZ(0.05);
      paintGeo(trunk, 0x60492c, 0xa08a5e, 0, 2.8, 0.30);
      const parts = [trunk];
      const tx = Math.sin(0.05)*2.8, ty = Math.cos(0.05)*2.8;
      // 葉は数を増やして幅も持たせる(まばらだと2Dのくり抜き(楕円)と食い違う)
      for(let i=0;i<9;i++){
        const leaf = new THREE.ConeGeometry(0.26, 1.30, 4);
        leaf.scale(1, 1, 0.45);
        leaf.translate(0, 0.63, 0);
        leaf.rotateZ(Math.PI*0.44 + (i%3)*0.09);   // 横へ倒して先を垂らす
        leaf.rotateY(s + i*(Math.PI*2/9));
        leaf.translate(tx, ty - 0.08, 0);
        paintGeo(leaf, 0x24541f, 0x4a8a32, ty-0.6, ty+0.5, 0.26);
        parts.push(leaf);
      }
      return mergeGeos(parts);
    }
    case 'shell': {
      // 貝殻。放射状の筋を入れた低いドーム
      const g = new THREE.SphereGeometry(1, 14, 5, 0, Math.PI*2, 0, Math.PI*0.5);
      const pos = g.attributes.position;
      for(let i=0;i<pos.count;i++){
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const rib = Math.cos(Math.atan2(z, x)*9 + s);
        const k = 1 + rib*0.055;
        pos.setXYZ(i, x*k, y*0.50*(1 + rib*0.12), z*k);
      }
      g.computeVertexNormals();
      return paintGeo(g, 0xd9b184, 0xf6e7cd, 0, 0.56, 0.16);
    }
    case 'cactus': {
      // サボテン。畝のある柱と2本の腕
      const body = ribbed(new THREE.CylinderGeometry(0.32, 0.36, 2.2, 12), 8, 0.10);
      body.translate(0, 1.1, 0);
      const cap = new THREE.SphereGeometry(0.32, 10, 3, 0, Math.PI*2, 0, Math.PI*0.5);
      cap.scale(1, 0.6, 1); cap.translate(0, 2.2, 0);
      const parts = [body, cap];
      for(let i=0;i<2;i++){
        const sg = i ? -1 : 1;
        const y0 = 1.0 + i*0.34;
        // 腕は幹に寄せる(離すと2Dのくり抜きが腕のない所まで広がってしまう)
        const arm = new THREE.CylinderGeometry(0.14, 0.14, 0.34, 8);
        arm.rotateZ(Math.PI/2); arm.translate(sg*0.24, y0, 0);
        const up = new THREE.CylinderGeometry(0.13, 0.145, 0.78, 8);
        up.translate(sg*0.38, y0 + 0.39, 0);
        const tip = new THREE.SphereGeometry(0.13, 8, 4, 0, Math.PI*2, 0, Math.PI*0.5);
        tip.scale(1, 0.7, 1); tip.translate(sg*0.38, y0 + 0.78, 0);
        const a = mergeGeos([arm, up, tip]);
        a.rotateY(s*1.3 + i*2.4);
        parts.push(a);
      }
      return paintGeo(mergeGeos(parts), 0x24471f, 0x4e7d3c, 0, 2.45, 0.18);
    }
    case 'crystal': {
      // 尖った水晶。太い1本のまわりに小さい結晶を生やす
      const parts = [];
      for(let i=0;i<3;i++){
        const a = s + i*2.1, d = i===0 ? 0 : 0.34;
        const hh = i===0 ? 1.82 : (0.85 + frac(i*0.5 + s)*0.55);
        const rr = i===0 ? 0.40 : 0.25;
        const c = new THREE.ConeGeometry(rr, hh, 6);
        c.translate(0, hh/2 - 0.12, 0);
        c.rotateZ((i===0 ? 0.05 : 0.24) * (i%2 ? 1 : -1));
        c.translate(Math.cos(a)*d, 0, Math.sin(a)*d);
        parts.push(c);
      }
      return paintGeo(mergeGeos(parts), 0x1f5c8e, 0x8fd0ee, 0, 1.85, 0.10);
    }
    default: {
      /* 既定の岩。荒野・火山・ジャングル・海岸に出るので色を決め打ちにすると
         その場だけ浮く。地面と同じテーマ色(岩肌=steep / 砂利=gravel)から作る。 */
      const lo = new THREE.Color(theme.steep || DEFAULT_THEME.steep).multiplyScalar(0.80);
      const hi = new THREE.Color(theme.gravel || DEFAULT_THEME.gravel).multiplyScalar(1.30);
      return paintGeo(boulderGeo(s, 0.58), lo.getHex(), hi.getHex(), 0, 1.24, 0.28);
    }
  }
}
/* 材質は種類ごとに1つだけ作り、形の3通りで共有する。
   tex は山と同じ肌テクスチャ(法線)の強さ。木や葉には貼らない(粒が浮くだけ)。 */
const OBST_MATS = {
  rock:     { rough:0.93, tex:1.0 },
  sandrock: { rough:0.96, tex:1.0 },
  snowrock: { rough:0.70, tex:0.7 },
  basalt:   { rough:0.86, tex:1.2 },
  deadtree: { rough:0.94 },
  pine:     { rough:0.90 },
  tree:     { rough:0.92 },
  log:      { rough:0.95, tex:0.7 },
  palm:     { rough:0.90 },
  shell:    { rough:0.38 },
  cactus:   { rough:0.78 },
  crystal:  { rough:0.16, env:1.3 },
};
function obstacleMaterial(flavor){
  const conf = OBST_MATS[flavor] || OBST_MATS.rock;
  const tex = conf.tex ? mountainTextures() : null;
  return new THREE.MeshStandardMaterial({
    vertexColors:true, roughness:conf.rough, metalness:0.0,
    normalMap: tex ? tex.normalMap : null,
    normalScale: new THREE.Vector2(conf.tex||1, conf.tex||1),
    flatShading:true,
    envMapIntensity: conf.env || ENV_INTENSITY,
  });
}
// 中身が変わったときだけ作り直すための署名(試合ごとに1回)
function obstacleSignature(list){
  if(!list || !list.length) return '0';
  const f = list[0], l = list[list.length-1];
  return list.length+':'+Math.round(f.x)+','+Math.round(f.y)+','+Math.round(l.x)+','+Math.round(l.y);
}
function buildObstacles(list){
  if(obstGroup){
    obstGroup.traverse(o=>{ if(o.isMesh){ o.geometry.dispose(); o.material.dispose(); } });
    scene.remove(obstGroup);
  }
  obstGroup = new THREE.Group();
  obstKinds = {};
  const flavors = {};
  for(const o of list) flavors[o.flavor || 'rock'] = 1;
  for(const f in flavors){
    const mat = obstacleMaterial(f);
    const vars = [];
    for(let v=0; v<OBST_VARIANTS; v++){
      const mesh = new THREE.InstancedMesh(obstacleGeo(f, v), mat, OBST_MAX);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;   // 上限まで並べるので毎フレームの判定はしない
      mesh.count = 0;
      obstGroup.add(mesh);
      vars.push(mesh);
    }
    obstKinds[f] = vars;
  }
  scene.add(obstGroup);
  obstCX = obstCY = null;
}
const _om = new THREE.Matrix4(), _oq = new THREE.Quaternion();
const _ov = new THREE.Vector3(), _os = new THREE.Vector3(), _oc = new THREE.Color();
function updateObstacleInstances(cx, cy){
  if(!obstKinds || !obstSrc) return;
  if(obstCX != null && Math.abs(cx-obstCX) + Math.abs(cy-obstCY) < OBST_STEP) return;
  obstCX = cx; obstCY = cy;
  const near = [];
  for(let i=0;i<obstSrc.length;i++){
    const o = obstSrc[i];
    const dx = o.x-cx, dy = o.y-cy, d2 = dx*dx + dy*dy;
    if(d2 <= OBST_VIEW*OBST_VIEW) near.push({ o, d2 });
  }
  near.sort((a,b)=>a.d2 - b.d2);
  // 上限で切ったときは「実際に出している距離」を2D側へ伝える(くり抜きと食い違わせない)
  obstCull = near.length > OBST_MAX ? Math.sqrt(near[OBST_MAX].d2) : OBST_VIEW;
  if(near.length > OBST_MAX) near.length = OBST_MAX;
  for(const f in obstKinds) for(const m of obstKinds[f]) m.count = 0;
  for(let i=0;i<near.length;i++){
    const o = near[i].o;
    const vars = obstKinds[o.flavor || 'rock'] || obstKinds.rock;
    if(!vars) continue;
    const seed = o.seed || 0;
    const mesh = vars[Math.floor(Math.abs(seed)*3.7) % OBST_VARIANTS];
    const idx = mesh.count;
    if(idx >= OBST_MAX) continue;
    const sh = shapeOf(o.flavor);
    const r = o.radius || 30;
    // 坂で浮かないよう、足元4点のいちばん低い高さに合わせてから少し埋める
    const gy = Math.min(
      heightAt(o.x - r*0.7, o.y), heightAt(o.x + r*0.7, o.y),
      heightAt(o.x, o.y - r*0.7), heightAt(o.x, o.y + r*0.7)
    ) - r*sh.sink;
    _ov.set(o.x, gy, o.y);
    _oq.setFromAxisAngle(UP_AXIS, seed*1.17);
    const hk = 0.90 + (seed - Math.floor(seed))*0.26;   // 高さだけ個体差を付ける
    _os.set(r, r*hk, r);
    _om.compose(_ov, _oq, _os);
    mesh.setMatrixAt(idx, _om);
    const tint = 0.86 + ((seed*3.1) % 1)*0.28;
    _oc.setRGB(tint, tint*0.995, tint*0.985);
    mesh.setColorAt(idx, _oc);
    mesh.count = idx + 1;
  }
  for(const f in obstKinds) for(const m of obstKinds[f]){
    m.instanceMatrix.needsUpdate = true;
    if(m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}
function updateObstacles(rocks, crystals, cx, cy){
  if(!scene) return;
  const sig = obstacleSignature(rocks) + '/' + obstacleSignature(crystals);
  if(sig !== obstSig){
    obstSig = sig;
    // 水晶はflavorを持たないのでここで付ける(元の配列は書き換えない)
    obstSrc = (rocks || []).slice();
    for(const c of (crystals || [])) obstSrc.push({ x:c.x, y:c.y, radius:c.radius, seed:c.seed, flavor:'crystal' });
    buildObstacles(obstSrc);
  }
  updateObstacleInstances(cx, cy);
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
      obstSig = '';               // 障害物も同じ理由で作り直す
      obstCull = OBST_VIEW;
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
  // 障害物を実際に出している距離。2D側はこれより遠い障害物をくり抜かない
  obstacleCullDist(){ return obstCull; },
  // 毎フレーム、2Dの描画より先に呼ぶ。カメラは2Dのproject()と同じ値から作る。
  // obstacles には障害物の配列(world.jsのrocks)を渡す = 3Dモデルで描く。
  // world には山・地面のしみ・水晶({volcanoes, lava, sea, river, oasis, crystals})を渡す
  render(obstacles, world){
    if(!active || !scene) return false;
    const cp = window.camPos, cs = window.camState;
    if(!cp || !cs) return false;
    // 視野角は2Dのproject()(world.jsのFOV_V)と必ず同じ値にする。設定で変えられるので毎フレーム見る
    const fovDeg = (window.__aramonLook && window.__aramonLook.fovDeg) || 64;
    if(camera.fov !== fovDeg){ camera.fov = fovDeg; camera.updateProjectionMatrix(); }
    updateTerrain(cp.x, cp.y);
    updateWorldObjects(world);
    updateObstacles(obstacles, world && world.crystals, cp.x, cp.y);
    if(waterShaders.length){
      const t = performance.now()*0.001;
      for(let i=0;i<waterShaders.length;i++) waterShaders[i].uniforms.uTime.value = t;
    }
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
    }
    renderer.render(scene, camera);
    return true;
  },
};
window.__aramonReal3D = api;
