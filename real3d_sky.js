/* =====================================================================
   リアルマップ: 空・遠景の山並み・環境光(HDRIの代わり)

   ・空は内側を向いた大きな球に描くグラデーション(テクスチャを持たない)
   ・遠景の山並みは距離の違う3枚。空気遠近で遠いほど霞ませる
   ・環境光は「同じ空をPMREMに通したもの」。画像ファイルを増やさずにPBRを成立させる
   ===================================================================== */
import * as THREE from './vendor/three.module.min.js';
import { R3, SUN_DIR } from './real3d_common.js';

const SKY_RADIUS = 9000;
const RIDGE_DIST = 5200;   // 遠景の山並みの距離(地形パッチの外。フォグの影響を受けない)

/* 空: 内側を向いた大きな球に2色グラデーションを描く(テクスチャ不要)。
   forEnv=true のときは環境マップ(PMREM)を作るための小さな複製。
   gainを上げて「空からの光」として使える明るさにする。                        */
export function buildSky(forEnv){
  const theme = R3.theme;
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

/* 空の色をテーマに合わせて差し替える(メッシュは使い回す) */
export function applySkyTheme(sky){
  if(!sky) return;
  const theme = R3.theme;
  sky.material.uniforms.top.value.setHex(theme.skyTop);
  sky.material.uniforms.bot.value.setHex(theme.skyBot);
  sky.material.uniforms.haze.value.setHex(theme.haze);
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

export function buildDistantRidge(){
  const theme = R3.theme;
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

/* 環境マップ(=HDRIの代わり)。そのマップの空をPMREMに通し、地面が空の色で
   ほんのり照らされるようにする。画像ファイルは増えない。テーマを変えたら作り直す。
   前の環境マップは呼び出し側が dispose する(戻り値を持ち回る)。            */
export function buildEnvironment(renderer, prevRT){
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(buildSky(true));
  const next = pmrem.fromScene(envScene, 0, 1, 500);
  if(prevRT) prevRT.dispose();       // 前のマップぶんを捨てる(貯めるとGPUメモリを食う)
  pmrem.dispose();
  return next;
}
