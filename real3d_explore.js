/* =====================================================================
   探検フィールド(MAPS.explore)の3D: ランドマークと地域の空気
   real3d.js から R3.theme.explore のときだけ呼ばれる(他のマップでは何もしない)。

   ・ランドマーク = 遠くから方向が分かる大物。位置はすべて data.js の
     EXPLORE_FIELD_LAYOUT が正(ここに座標を書かない)。
       ベースキャンプ(テント・焚き火・旗・帰還ビーコンの光の柱)/ 天然のアーチ岩 /
       監視塔 / 遺跡の大門 / 各ボスの巣(骨・爪痕・巣材)/ 火山の噴煙
   ・当たり判定: 隠れられそうな大きさの物(テント・アーチの脚・塔の土台・門の柱)は
     world.js が「noMesh の山」として同じ位置に円の判定を置いている。ここで作る形は
     地面の高さでその円に収まるようにしてある(見た目と判定を一致させる)。
     判定の無い飾り(巣の骨・枝・旗・爪痕)は細い・低い形だけにする(SKILLの決まり)。
   ・地域の空気: カメラの位置の地域の重みで、霞の色と距離・日差しの色・空の地平の色を
     毎フレーム混ぜる。山の霞(real3d_props.js)は EXPLORE_ATMO を共有して追従する。
   ・山は「種類×区画(MOUNT_CHUNK)」ごとに1つのメッシュへまとめる(探検は山が100個を超えるので
     描画命令を抑える。区画に分けるのは、視野の外の山を丸ごと描かないようにするため)。
   ===================================================================== */
import * as THREE from './vendor/three.module.min.js';
import { ENV_INTENSITY, heightAt, hash2, tileNoise, mergeGeos,
         EXPLORE_ATMO, exploreWeights, exploreRegionColors, exploreMixColor, exploreMixNum } from './real3d_common.js';
import { applySurfaceDetail, paintGeo, cavityShade, patchTint, chipBox,
         leafGeo, doubleSided, tintTop, mixColor } from './real3d_props.js';

const FAR_HAZE = [2400, 11000];     // ランドマークに掛ける霞(山と同じく自前で薄く掛ける)
const BEACON_H = 2600;              // 帰還ビーコンの光の柱の高さ
const BEACON_COL = 0x55ffd6;        // 光の柱の色(ルートのレア度の白青紫金と被らない青緑)
const PLUME_W = 1500, PLUME_H = 3600;   // 噴煙の板の大きさ

const L = ()=> window.__aramonExploreLayout;
const frac = (v)=> v - Math.floor(v);

/* ---------------------------------------------------------------------
   材質(試合をまたいで使い回す。worldGroup の作り直しで捨てられないよう shared の印)
   --------------------------------------------------------------------- */
function farHaze(mat, near, far){
  mat.fog = false;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.onBeforeCompile = (sh, r)=>{
    if(prev) prev(sh, r);
    sh.uniforms.uFarHaze = EXPLORE_ATMO.haze;
    sh.uniforms.uFarR = { value: new THREE.Vector2(near, far) };
    sh.vertexShader = 'varying vec3 vFhW;\n' + sh.vertexShader.replace('#include <project_vertex>', [
      '#include <project_vertex>',
      '{ vec4 fhw = vec4(transformed, 1.0);',
      '#ifdef USE_INSTANCING',
      '  fhw = instanceMatrix * fhw;',
      '#endif',
      '  vFhW = (modelMatrix * fhw).xyz; }',
    ].join('\n'));
    sh.fragmentShader = 'uniform vec3 uFarHaze;\nuniform vec2 uFarR;\nvarying vec3 vFhW;\n'
      + sh.fragmentShader.replace('#include <colorspace_fragment>', [
        '#include <colorspace_fragment>',
        'gl_FragColor.rgb = mix(gl_FragColor.rgb, uFarHaze, smoothstep(uFarR.x, uFarR.y, distance(vFhW, cameraPosition)) * 0.85);',
      ].join('\n'));
  };
  mat.customProgramCacheKey = ()=> prevKey + '|fh' + near + ',' + far;
  return mat;
}
const matCache = {};
function shared(key, make){
  if(!matCache[key]){ matCache[key] = make(); matCache[key].userData.shared = true; }
  return matCache[key];
}
// 岩(アーチ・門・塔の土台)。表面ディテールは障害物と同じ仕組み
const rockMat = ()=> shared('rock', ()=> farHaze(applySurfaceDetail(new THREE.MeshStandardMaterial({
  vertexColors:true, roughness:0.95, metalness:0, envMapIntensity:ENV_INTENSITY*0.9,
}), { scale:34, bump:0.75, macro:420, stain:0.42, crack:0.30, rough:0.30 }), FAR_HAZE[0], FAR_HAZE[1]));
const woodMat = ()=> shared('wood', ()=> farHaze(applySurfaceDetail(new THREE.MeshStandardMaterial({
  vertexColors:true, roughness:0.93, metalness:0, envMapIntensity:ENV_INTENSITY*0.45,
}), { scale:8, bump:0.45, macro:110, stain:0.40, crack:0.24, rough:0.28 }), FAR_HAZE[0], FAR_HAZE[1]));
const clothMat = ()=> shared('cloth', ()=> farHaze(new THREE.MeshStandardMaterial({
  vertexColors:true, roughness:0.88, metalness:0, envMapIntensity:ENV_INTENSITY*0.6, side:THREE.DoubleSide,
}), FAR_HAZE[0], FAR_HAZE[1]));
const boneMat = ()=> shared('bone', ()=> farHaze(applySurfaceDetail(new THREE.MeshStandardMaterial({
  vertexColors:true, roughness:0.78, metalness:0, envMapIntensity:ENV_INTENSITY*0.7,
}), { scale:10, bump:0.35, macro:140, stain:0.36, crack:0.20, rough:0.30 }), FAR_HAZE[0], FAR_HAZE[1]));
// 葉は環境光(空)を受ける材質にする。Lambertは環境マップを読めず、逆光の蔦が真っ黒な棒になる
const leafMat = ()=> shared('leaf', ()=> farHaze(new THREE.MeshStandardMaterial({
  vertexColors:true, side:THREE.DoubleSide, roughness:0.85, metalness:0, envMapIntensity:ENV_INTENSITY*1.4 }),
  FAR_HAZE[0], FAR_HAZE[1]));
/* 地面に焼く暗がり(爪痕・焚き火の焦げ)。下の地面を暗くするだけの乗算なので、地面が何色でも溶ける */
const decalMat = ()=> shared('decal', ()=>{
  const m = new THREE.MeshBasicMaterial({ vertexColors:true, transparent:true, blending:THREE.MultiplyBlending,
                                          depthWrite:false, fog:false, side:THREE.DoubleSide });
  m.toneMapped = false; m.polygonOffset = true; m.polygonOffsetFactor = -3; m.polygonOffsetUnits = -6;
  return m;
});
// 光る物(焚き火・ビーコンの光・地面の照り返し)。加算で重ねる
function glowMat(key, color, opacity, map){
  return shared(key, ()=>{
    const m = new THREE.MeshBasicMaterial({ color, transparent:true, opacity, blending:THREE.AdditiveBlending,
                                            depthWrite:false, fog:false, side:THREE.DoubleSide, map:map || null });
    m.toneMapped = false;
    return m;
  });
}

/* ---------------------------------------------------------------------
   手続きテクスチャ(画像ファイルは増やさない)
   --------------------------------------------------------------------- */
let flameTex = null, smokeTex = null, glowTex = null, bannerTex = null;
function canvasTex(w, h, draw, srgb){
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}
// 炎。下が白熱・上が赤く細る舌を数本。加算なので黒=透明
function getFlameTex(){
  if(flameTex) return flameTex;
  flameTex = canvasTex(64, 128, (g, w, h)=>{
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    for(let i=0;i<5;i++){
      const cx = w*(0.5 + (hash2(i, 3.1) - 0.5)*0.35), top = h*(0.08 + hash2(i, 7.7)*0.3);
      const grd = g.createRadialGradient(cx, h*0.86, 2, cx, h*0.62, h*0.62);
      grd.addColorStop(0.0, 'rgba(255,240,190,0.9)');
      grd.addColorStop(0.25, 'rgba(255,170,60,0.7)');
      grd.addColorStop(0.6, 'rgba(210,60,10,0.35)');
      grd.addColorStop(1.0, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(cx - w*0.26, h);
      g.quadraticCurveTo(cx - w*0.30, h*0.55, cx, top);
      g.quadraticCurveTo(cx + w*0.30, h*0.55, cx + w*0.26, h);
      g.fill();
    }
  }, true);
  return flameTex;
}
// 丸い光のにじみ(焚き火の照り返し・ビーコンの足元)
function getGlowTex(){
  if(glowTex) return glowTex;
  glowTex = canvasTex(128, 128, (g, w, h)=>{
    const grd = g.createRadialGradient(w/2, h/2, 0, w/2, h/2, w/2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, true);
  return glowTex;
}
/* 噴煙。縦に繰り返せる煙の濃淡(アルファ)。上へ流すので縦方向にタイルさせる */
function getSmokeTex(){
  if(smokeTex) return smokeTex;
  smokeTex = canvasTex(128, 256, (g, w, h)=>{
    const img = g.createImageData(w, h), d = img.data;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const u = x/w, v = y/h;
      // 横は中央ほど濃い柱、縦は周期的なもこもこ
      const n = tileNoise(u*6, v*12, 12)*0.55 + tileNoise(u*13, v*25, 25)*0.30 + tileNoise(u*27, v*50, 50)*0.15;
      const col = Math.exp(-Math.pow((u - 0.5 + (tileNoise(1.3, v*4, 4) - 0.5)*0.25)/0.23, 2));
      const a = Math.max(0, Math.min(1, (n*1.35 - 0.38) * col * 1.6));
      const i = (y*w + x)*4;
      const c = 150 + n*105;
      d[i] = c; d[i+1] = c*0.97; d[i+2] = c*0.95; d[i+3] = a*255;
    }
    g.putImageData(img, 0, 0);
  }, true);
  smokeTex.wrapS = THREE.ClampToEdgeWrapping;
  smokeTex.wrapT = THREE.RepeatWrapping;
  return smokeTex;
}
// 探検団の旗(紋章)。色つき
function getBannerTex(){
  if(bannerTex) return bannerTex;
  bannerTex = canvasTex(64, 128, (g, w, h)=>{
    g.fillStyle = '#a3242c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8c35a'; g.fillRect(0, 0, w, 8); g.fillRect(0, h-26, w, 5);
    // 燕尾の切れ込み(下端)は透明にする
    g.clearRect(w*0.35, h-16, w*0.30, 16);
    g.beginPath(); g.moveTo(w*0.35, h-16); g.lineTo(w*0.5, h-2); g.lineTo(w*0.65, h-16); g.fillStyle = '#a3242c'; g.fill();
    // 紋章: 羅針盤の星
    g.fillStyle = '#f2d77a';
    g.translate(w/2, h*0.42);
    for(let k=0;k<4;k++){
      g.beginPath(); g.moveTo(0, -22); g.lineTo(6, 0); g.lineTo(0, 6); g.lineTo(-6, 0); g.closePath(); g.fill();
      g.rotate(Math.PI/2);
    }
    g.beginPath(); g.arc(0, 0, 5, 0, Math.PI*2); g.fillStyle = '#a3242c'; g.fill();
  }, true);
  return bannerTex;
}

/* ---------------------------------------------------------------------
   形の小道具
   --------------------------------------------------------------------- */
// ワールド座標(x,y=地面)へ置く。原点は足元の地面の高さ
function placeAt(obj, x, y, sink){
  obj.position.set(x, heightAt(x, y) - (sink || 0), y);
  return obj;
}
function paintSolid(geo, hex, mottle){
  const c = (hex instanceof THREE.Color) ? hex : new THREE.Color(hex);
  const pos = geo.attributes.position;
  let lo = Infinity, hi = -Infinity;
  for(let i=0;i<pos.count;i++){ const y = pos.getY(i); if(y < lo) lo = y; if(y > hi) hi = y; }
  return paintGeo(geo, c.clone().multiplyScalar(0.82), c.clone().multiplyScalar(1.10), lo, hi, mottle == null ? 0.2 : mottle);
}
// 頂点を「岩らしく」ゆがめる(外へ出すぶんは上限つき)
function roughen(geo, amp, f, seed){
  const pos = geo.attributes.position;
  for(let i=0;i<pos.count;i++){
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = tileNoise(x*f + seed, z*f - seed*1.7, 64)*0.6 + tileNoise(y*f*1.3 + seed*2.1, x*f*0.9, 64)*0.4 - 0.5;
    const r = Math.hypot(x, z) || 1;
    pos.setXYZ(i, x + x/r*n*amp, y + n*amp*0.35, z + z/r*n*amp);
  }
  geo.computeVertexNormals();
  return geo;
}

/* ---------------------------------------------------------------------
   ベースキャンプ
   --------------------------------------------------------------------- */
const TENT_COLS = [0xb04a3c, 0x3f6aa0, 0x4f7a3a, 0xc27a2a];
function tentGeo(seed){
  const Lh = 92, Wh = 76, H = 128;       // 半分の長さ・半分の幅・高さ(足元の判定の円105に収まる)
  const parts = [];
  const canvas = new THREE.Color(0xd9c9a0), stripe = new THREE.Color(TENT_COLS[seed % TENT_COLS.length]);
  // 屋根2枚。棟(上)から軒(下)へ張った布で、支柱の間でわずかにたるむ
  for(const sg of [1, -1]){
    const p = new THREE.PlaneGeometry(1, 1, 8, 5);
    const pp = p.attributes.position;
    for(let i=0;i<pp.count;i++){
      const u = pp.getX(i) + 0.5, v = pp.getY(i) + 0.5;        // u=長さ方向 v=0軒 1棟
      const sag = Math.sin(Math.PI*u)*Math.sin(Math.PI*v)*6;
      pp.setXYZ(i, (u - 0.5)*Lh*2, 8 + v*(H - 8) - sag*0.6, sg*(Wh*(1 - v) - sag*0.5));
    }
    p.computeVertexNormals();
    const pos = p.attributes.position, col = new Float32Array(pos.count*3), c = new THREE.Color();
    for(let i=0;i<pos.count;i++){
      const y = pos.getY(i);
      c.copy(y < 34 ? stripe : canvas).multiplyScalar(0.80 + 0.26*(y/H) + (hash2(i*0.37, seed)-0.5)*0.06);
      col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
    }
    p.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    parts.push(p);
  }
  // 妻面: 奥は布、手前は開いた入口(暗い中+めくった布)
  for(const sx of [-1, 1]){
    const shape = new THREE.Shape();
    shape.moveTo(-Wh, 8); shape.lineTo(Wh, 8); shape.lineTo(0, H); shape.closePath();
    const tri = new THREE.ShapeGeometry(shape);
    tri.rotateY(Math.PI/2);
    tri.translate(sx*Lh, 0, 0);
    paintSolid(tri, sx > 0 ? new THREE.Color(0x1d1812) : canvas.clone().multiplyScalar(0.9), 0.1);
    parts.push(tri);
    if(sx > 0){
      // めくった入口の布(三角が外へ開く)
      for(const sz of [1, -1]){
        const fl = new THREE.Shape();
        fl.moveTo(0, 8); fl.lineTo(sz*Wh*0.9, 10); fl.lineTo(0, H*0.95); fl.closePath();
        const f = new THREE.ShapeGeometry(fl);
        f.rotateY(Math.PI/2 + sz*0.55);
        f.translate(Lh + 2, 0, 0);
        paintSolid(f, canvas, 0.1);
        parts.push(f);
      }
    }
  }
  // 支柱と棟木
  for(const sx of [-1, 1]){
    const pole = new THREE.CylinderGeometry(2.6, 3.2, H + 16, 5); pole.translate(sx*(Lh + 3), (H + 16)/2, 0);
    paintSolid(pole, 0x5a4330); parts.push(pole);
  }
  const ridge = new THREE.CylinderGeometry(2.2, 2.2, Lh*2 + 12, 5); ridge.rotateZ(Math.PI/2); ridge.translate(0, H + 2, 0);
  paintSolid(ridge, 0x5a4330); parts.push(ridge);
  // 張り綱(細い線)
  for(const sx of [-1, 1]) for(const sz of [-1, 1]){
    const a = new THREE.Vector3(sx*Lh*0.8, 10, sz*Wh), b = new THREE.Vector3(sx*Lh*1.12, 0, sz*(Wh + 26));
    const len = a.distanceTo(b);
    const rope = new THREE.CylinderGeometry(0.8, 0.8, len, 3);
    rope.translate(0, len/2, 0);
    rope.lookAt(b.clone().sub(a));
    rope.rotateX(Math.PI/2);
    rope.translate(b.x, b.y, b.z);
    paintSolid(rope, 0xb8a888, 0); parts.push(rope);
  }
  return mergeGeos(parts);
}
function campfire(group){
  const parts = [];
  // 石の輪
  for(let i=0;i<11;i++){
    const a = i/11*Math.PI*2;
    const s = chipBox(17, 12, 14, i*1.7 + 3, 0.22);
    s.rotateY(-a); s.translate(Math.cos(a)*40, 6, Math.sin(a)*40);
    parts.push(s);
  }
  const stones = mergeGeos(parts);
  paintGeo(stones, new THREE.Color(0x4a4640), new THREE.Color(0x7a746a), 0, 14, 0.3);
  cavityShade(stones, 0.3, 0.2);
  group.add(new THREE.Mesh(stones, rockMat()));
  // 薪を組んだ三角錐
  const logs = [];
  for(let i=0;i<5;i++){
    const a = i/5*Math.PI*2 + 0.3;
    const l = new THREE.CylinderGeometry(2.8, 3.6, 46, 6);
    l.translate(0, 23, 0); l.rotateZ(0.62); l.rotateY(-a);
    l.translate(Math.cos(a)*18, 0, Math.sin(a)*18);
    logs.push(l);
  }
  const lg = mergeGeos(logs);
  paintGeo(lg, new THREE.Color(0x1c130c), new THREE.Color(0x5a3a22), 0, 30, 0.2);
  group.add(new THREE.Mesh(lg, woodMat()));
  // 炎(交差した板2枚を加算で)。毎フレーム高さを揺らす
  const fm = glowMat('flame', 0xffffff, 0.95, getFlameTex());
  const flame = new THREE.Group();
  for(let i=0;i<3;i++){
    const p = new THREE.PlaneGeometry(44, 88);
    p.translate(0, 40, 0);
    p.rotateY(i*Math.PI/3);
    flame.add(new THREE.Mesh(p, fm));
  }
  flame.position.y = 4;
  flame.userData.flicker = true;
  group.add(flame);
  // 地面の照り返し(加算のにじみ)
  const gl = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), glowMat('fireGlow', 0xff8a3a, 0.40, getGlowTex()));
  gl.rotation.x = -Math.PI/2; gl.position.y = 3;
  gl.userData.flickerGlow = true;
  group.add(gl);
  return flame;
}
function flagPole(group, x, y, seed){
  const g = new THREE.Group();
  const H = 360;
  const pole = new THREE.CylinderGeometry(3, 4.5, H, 6); pole.translate(0, H/2, 0);
  paintSolid(pole, 0x4a3828);
  const bar = new THREE.CylinderGeometry(2, 2, 90, 5); bar.rotateZ(Math.PI/2); bar.translate(38, H - 12, 0);
  paintSolid(bar, 0x4a3828);
  g.add(new THREE.Mesh(mergeGeos([pole, bar]), woodMat()));
  const cloth = new THREE.PlaneGeometry(76, 150, 4, 8);
  cloth.translate(38, H - 12 - 75, 0);
  const pp = cloth.attributes.position;
  const col = new Float32Array(pp.count*3).fill(1);
  cloth.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = shared('banner', ()=> farHaze(new THREE.MeshStandardMaterial({
    map:getBannerTex(), vertexColors:true, side:THREE.DoubleSide, roughness:0.9, metalness:0, alphaTest:0.4,
    envMapIntensity:ENV_INTENSITY*0.7 }), FAR_HAZE[0], FAR_HAZE[1]));
  const banner = new THREE.Mesh(cloth, m);
  banner.userData.sway = seed;
  g.add(banner);
  placeAt(g, x, y, 4);
  g.rotation.y = seed*1.3;
  group.add(g);
  return banner;
}
/* 帰還ビーコン。石の台座 + 浮かぶ結晶 + 空まで届く光の柱。
   光の柱はどこからでも見える目印なので霞を掛けない(山の向こうは深度で隠れる)。 */
function beacon(group, bx, by){
  const g = new THREE.Group();
  const parts = [];
  const rs = [70, 58, 46];
  for(let i=0;i<3;i++){
    const c = new THREE.CylinderGeometry(rs[i]*0.94, rs[i], 20, 8);
    roughen(c, 3, 0.06, i + 1.3);
    c.translate(0, 10 + i*20, 0);
    parts.push(c);
  }
  const ped = mergeGeos(parts);
  paintGeo(ped, new THREE.Color(0x5b5a58), new THREE.Color(0x9b968c), 0, 60, 0.3);
  cavityShade(ped, 0.35, 0.2);
  g.add(new THREE.Mesh(ped, rockMat()));
  // 結晶(自ら光る)
  const crys = new THREE.Mesh(new THREE.OctahedronGeometry(30, 0),
    shared('beaconCrystal', ()=> new THREE.MeshStandardMaterial({ color:0x9ffff0, emissive:new THREE.Color(BEACON_COL),
      emissiveIntensity:1.6, roughness:0.25, metalness:0.1 })));
  crys.scale.set(1, 1.9, 1);
  crys.position.y = 128;
  crys.userData.spin = true;
  g.add(crys);
  // 光の柱。中心が明るく縁と上が薄れる(視線と面の向きで濃さを変える)
  const beamMat = shared('beam', ()=> new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, fog:false,
    uniforms:{ uCol:{ value:new THREE.Color(BEACON_COL) }, uTime:{ value:0 } },
    vertexShader:`varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 wp = modelMatrix*vec4(position,1.0);
        vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader:`uniform vec3 uCol; uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
        float h = pow(1.0 - vUv.y, 1.6);
        float band = 0.82 + 0.18*sin(vUv.y*60.0 - uTime*3.0);
        gl_FragColor = vec4(uCol * (0.35 + 1.6*f) * h * band, 1.0); }`,
  }));
  beamMat.toneMapped = false;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(26, 40, BEACON_H, 16, 1, true), beamMat);
  beam.position.y = BEACON_H/2 + 60;
  beam.userData.beam = true;
  g.add(beam);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(9, 14, BEACON_H*0.85, 10, 1, true), beamMat);
  core.position.y = BEACON_H*0.425 + 60;
  g.add(core);
  // 足元に広がる光の輪(ゆっくり脈打つ)
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 48), glowMat('beaconRing', BEACON_COL, 0.55));
  ring.rotation.x = -Math.PI/2; ring.position.y = 4;
  ring.userData.pulse = true;
  g.add(ring);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), glowMat('beaconPool', BEACON_COL, 0.32, getGlowTex()));
  pool.rotation.x = -Math.PI/2; pool.position.y = 3;
  g.add(pool);
  placeAt(g, bx, by, 6);
  group.add(g);
  return { crys, ring, beam: beamMat };
}
function buildCamp(group, anim){
  const C = L().camp;
  const tentM = clothMat();
  for(const p of C.props){
    const x = C.x + p.dx, y = C.y + p.dy;
    if(p.kind === 'tent'){
      const m = new THREE.Mesh(tentGeo(Math.round(frac(p.rot*7.1)*10)), tentM);
      placeAt(m, x, y, 3);
      m.rotation.y = p.rot;
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    }else if(p.kind === 'fire'){
      const g = new THREE.Group();
      anim.flames.push(campfire(g));
      anim.fireGlow.push(g.children.find(o=> o.userData.flickerGlow));
      placeAt(g, x, y, 2);
      group.add(g);
    }
  }
  const b = beacon(group, C.beacon.x, C.beacon.y);
  anim.beacons.push(b);
  // 旗はビーコンの左右と入口に(細い竿と布なので判定は持たせない)
  anim.banners.push(flagPole(group, C.beacon.x - 190, C.beacon.y - 40, 0.2));
  anim.banners.push(flagPole(group, C.beacon.x + 190, C.beacon.y - 40, 1.7));
  anim.banners.push(flagPole(group, C.x - 40, C.y + 640, 3.1));
}

/* ---------------------------------------------------------------------
   天然のアーチ岩(草原)。脚2本と、それをつなぐ岩の弧を1本の管で作る
   --------------------------------------------------------------------- */
function buildArch(group, lm){
  const ax = lm.a[0], ay = lm.a[1], bx = lm.b[0], by = lm.b[1];
  const ga = heightAt(ax, ay), gb = heightAt(bx, by);
  const pts = [];
  const N = 22;
  for(let i=0;i<=N;i++){
    const t = i/N;
    // 端は地面の下まで埋める。上は少し平たい弧(sinの0.7乗)
    const s = Math.sin(Math.PI*t);
    const y = (ga*(1-t) + gb*t) - 70 + (lm.h - 60)*Math.pow(s, 0.62) + 70*Math.min(1, s*6);
    pts.push(new THREE.Vector3(ax + (bx-ax)*t, y, ay + (by-ay)*t));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const TS = 96, RS = 20;
  const geo = new THREE.TubeGeometry(curve, TS, 1, RS, false);
  // 管の太さ: 脚は判定の半径(foot)ちょうど、頂上は細い。岩肌のでこぼこは内向きだけ
  const pos = geo.attributes.position;
  const frames = curve.computeFrenetFrames(TS, false);
  for(let i=0;i<=TS;i++){
    const t = i/TS;
    const c = curve.getPointAt(t);
    const s = Math.sin(Math.PI*t);
    const rad = lm.foot*(1 - 0.26*Math.pow(s, 0.8));
    for(let j=0;j<=RS;j++){
      const k = i*(RS+1) + j;
      const v = new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).sub(c).normalize();
      const n = tileNoise(t*18 + 3.1, j/RS*8, 8)*0.50 + tileNoise(t*47, j/RS*16 + 1.7, 16)*0.30 + tileNoise(t*97, j/RS*32, 32)*0.20;
      // 横(左右)に平たくして板状の弧(自然のアーチは岩の板が抜けた形)。岩肌は大きく欠けさせる
      const flat = 1 - 0.34*Math.abs(v.dot(frames.binormals[i]));
      const chip = Math.pow(tileNoise(t*29 + 7.7, j/RS*6, 6), 3)*0.28;
      const r = rad*flat*Math.min(1, 0.64 + 0.44*n - chip);   // 判定の円(foot)より外へは出さない
      pos.setXYZ(k, c.x + v.x*r, c.y + v.y*r, c.z + v.z*r);
    }
  }
  geo.computeVertexNormals();
  // 局所座標へ(アーチの中点を原点に)
  const mx = (ax+bx)/2, my = (ay+by)/2, mh = (ga+gb)/2;
  geo.translate(-mx, -mh, -my);
  // 草原の岩山と同じ系統の、日に焼けた灰褐色の砂岩
  const rockLo = new THREE.Color(0x6a5e4c), rockHi = new THREE.Color(0xb3a58a);
  paintGeo(geo, rockLo, rockHi, -60, lm.h, 0.40);
  // 砂岩の地層(高さで明暗の縞)。水平の縞が入ると「積もった岩が削られた」ように読める
  {
    const p2 = geo.attributes.position, c2 = geo.attributes.color;
    for(let k=0;k<p2.count;k++){
      const y = p2.getY(k);
      const band = 1 + 0.10*Math.sin(y*0.045) + 0.06*Math.sin(y*0.113 + 1.3);
      c2.setXYZ(k, c2.getX(k)*band, c2.getY(k)*band*0.99, c2.getZ(k)*band*0.97);
    }
    c2.needsUpdate = true;
  }
  cavityShade(geo, 0.34, 0.24);
  patchTint(geo, new THREE.Color(0x3d3a33), 0.35, 4.1, 0.012);
  // 上を向いた面には草(草原の岩山と同じ)
  tintTop(geo, new THREE.Color(0x56702e), lm.h*0.55, lm.h*1.05, 0.55);
  const m = new THREE.Mesh(geo, rockMat());
  m.position.set(mx, mh, my);
  m.castShadow = true; m.receiveShadow = true;
  group.add(m);
}

/* ---------------------------------------------------------------------
   監視塔(草原・凍った高地)。石の土台(判定の円)の上に木の櫓と見張り台
   --------------------------------------------------------------------- */
function buildTower(group, lm){
  const snowy = (lm.region === 'frost');
  const g = new THREE.Group();
  const H = lm.h, base = 150, deck = H - 150;
  // 土台(判定の円 foot に地面の高さで一致)
  const b = new THREE.CylinderGeometry(lm.foot*0.80, lm.foot, base, 8, 3);
  roughen(b, 5, 0.05, 2.3);
  b.translate(0, base/2 - 10, 0);
  const stoneLo = new THREE.Color(0x4e4b44), stoneHi = new THREE.Color(0x8f887a);
  paintGeo(b, stoneLo, stoneHi, -10, base, 0.35);
  cavityShade(b, 0.36, 0.2);
  if(snowy) tintTop(b, new THREE.Color(0xe8f0fa), base*0.8, base, 0.9);
  const bm = new THREE.Mesh(b, rockMat()); bm.castShadow = true; bm.receiveShadow = true;
  g.add(bm);
  // 櫓の脚・筋交い・見張り台・手すり・屋根・梯子
  const wood = [], woodLo = new THREE.Color(0x3a2a1c), woodHi = new THREE.Color(0x7a5a3a);
  const R = lm.foot*0.55;
  for(let i=0;i<4;i++){
    const a = Math.PI/4 + i*Math.PI/2;
    const leg = chipBox(15, deck - base + 30, 15, i*2.1, 0.04);
    leg.translate(0, (deck - base + 30)/2, 0);
    leg.rotateZ(0.04*(i%2 ? 1 : -1));
    leg.translate(Math.cos(a)*R, base - 20, Math.sin(a)*R);
    wood.push(leg);
    // 筋交い(2段)
    for(let k=0;k<2;k++){
      const a2 = a + Math.PI/2;
      const len = R*Math.SQRT2*1.05;
      const br = chipBox(len, 8, 8, i*3.3 + k, 0.05);
      br.rotateZ(k ? 0.55 : -0.55);
      br.rotateY(-(a + a2)/2 - Math.PI/2);
      const mx = (Math.cos(a) + Math.cos(a2))/2*R, mz = (Math.sin(a) + Math.sin(a2))/2*R;
      br.translate(mx, base + (deck - base)*(0.3 + k*0.4), mz);
      wood.push(br);
    }
  }
  const floor = chipBox(R*2 + 90, 14, R*2 + 90, 4.4, 0.03); floor.translate(0, deck, 0); wood.push(floor);
  for(let i=0;i<4;i++){
    const rail = chipBox(R*2 + 90, 7, 7, i + 9.1, 0.04);
    rail.translate(0, deck + 42, (R + 45)); rail.rotateY(i*Math.PI/2); wood.push(rail);
    const post = chipBox(9, 50, 9, i + 5.3, 0.04);
    post.translate(R + 42, deck + 25, R + 42); post.rotateY(i*Math.PI/2); wood.push(post);
  }
  for(let i=0;i<4;i++){
    const a = Math.PI/4 + i*Math.PI/2;
    const p = chipBox(9, 95, 9, i*1.9 + 2, 0.03);
    p.translate(Math.cos(a)*(R + 40), deck + 50, Math.sin(a)*(R + 40)); wood.push(p);
  }
  // 梯子
  for(const sx of [-1, 1]){
    const rail = chipBox(6, deck - base + 60, 6, sx + 7.7, 0.02);
    rail.translate(sx*18, (deck - base + 60)/2 + base - 30, R + 32); rail.rotateX(-0.12); wood.push(rail);
  }
  for(let k=0;k<9;k++){
    const r = chipBox(40, 4, 5, k*0.7, 0.02);
    r.translate(0, base + k*(deck - base)/9, R + 32 + (k/9)*-25); wood.push(r);
  }
  const wg = mergeGeos(wood);
  paintGeo(wg, woodLo, woodHi, base, deck + 60, 0.3);
  cavityShade(wg, 0.32, 0.18);
  const wm = new THREE.Mesh(wg, woodMat()); wm.castShadow = true;
  g.add(wm);
  // 屋根(四角錐の板葺き)。凍った高地は雪が乗る
  const roof = new THREE.ConeGeometry(R + 95, H - deck - 55, 4, 2, true);
  roof.rotateY(Math.PI/4);
  roof.translate(0, deck + 100 + (H - deck - 55)/2, 0);
  paintGeo(roof, new THREE.Color(0x4a2e22), new THREE.Color(0x7a4a32), deck + 100, H, 0.3);
  if(snowy) tintTop(roof, new THREE.Color(0xf0f6ff), deck + 100, H, 1.3);
  const rm = new THREE.Mesh(roof, clothMat()); rm.castShadow = true;
  g.add(rm);
  placeAt(g, lm.x, lm.y, 6);
  group.add(g);
  return g;
}

/* ---------------------------------------------------------------------
   遺跡の大門(密林)。石を積んだ柱2本と、その上に渡した巨石の楣(まぐさ)
   --------------------------------------------------------------------- */
function buildGate(group, lm){
  const ax = lm.toward[0]-lm.x, ay = lm.toward[1]-lm.y, al = Math.hypot(ax, ay) || 1;
  const px = -ay/al, py = ax/al;          // 柱の並ぶ向き(門の幅方向)
  const g0 = heightAt(lm.x, lm.y);
  const parts = [];
  const blockW = lm.foot*1.40;            // 角柱の対角 = 判定の円の直径 に収める
  const H = lm.h - 110;
  for(const sg of [1, -1]){
    const cx = px*lm.half*sg, cz = py*lm.half*sg;
    const cy = heightAt(lm.x + cx, lm.y + cz) - g0;
    let y = cy - 30;
    const n = 5;
    for(let i=0;i<n;i++){
      const hh = (H + 30)/n;
      const w = blockW*(1 - i*0.035);
      const b = chipBox(w, hh*0.96, w, sg*3.1 + i*1.7, 0.08);
      b.rotateY((hash2(i, sg) - 0.5)*0.08 - Math.atan2(py, px));
      b.translate(cx + (hash2(i*2, sg)-0.5)*6, y + hh/2, cz + (hash2(i*3, sg)-0.5)*6);
      parts.push(b);
      y += hh;
    }
    // 柱頭
    const cap = chipBox(blockW*1.25, 44, blockW*1.25, sg*5.3, 0.06);
    cap.rotateY(-Math.atan2(py, px));
    cap.translate(cx, y + 22, cz);
    parts.push(cap);
  }
  // 楣。片方の端が少し欠けて下がっている
  const span = lm.half*2 + blockW*1.3;
  const lintel = chipBox(span, 96, blockW*1.05, 7.7, 0.05);
  const lp = lintel.attributes.position;
  for(let i=0;i<lp.count;i++){ const x = lp.getX(i); if(x > span*0.38 && lp.getY(i) > 0) lp.setY(i, lp.getY(i) - 26); }
  lintel.computeVertexNormals();
  lintel.rotateZ(0.025);
  lintel.rotateY(-Math.atan2(py, px));
  lintel.translate(0, H + 44 + 48, 0);
  parts.push(lintel);
  // 楣の上の崩れかけた飾り石
  for(let i=0;i<3;i++){
    const t = (i - 1)*0.28;
    const orn = chipBox(blockW*0.55, 70 - i*12, blockW*0.55, i*4.1, 0.12);
    orn.rotateY(-Math.atan2(py, px) + (i - 1)*0.1);
    orn.translate(px*span*t, H + 140 + 35, py*span*t);
    parts.push(orn);
  }
  const geo = mergeGeos(parts);
  // 風化した石灰岩。密林の暗さに沈まないよう明るめにして、苔は上を向いた所だけ
  const lo = new THREE.Color(0x857d64), hi = new THREE.Color(0xcfc6a6);
  paintGeo(geo, lo, hi, 0, lm.h, 0.35);
  cavityShade(geo, 0.34, 0.26);
  patchTint(geo, new THREE.Color(0x5d7a34), 0.55, 5.3, 0.02);
  patchTint(geo, new THREE.Color(0x6a6552), 0.30, 1.9, 0.05);
  const m = new THREE.Mesh(geo, rockMat());
  m.castShadow = true; m.receiveShadow = true;
  placeAt(m, lm.x, lm.y, 0);
  group.add(m);
  // 楣から垂れる蔦(細い葉の帯。判定は無いが細いので隠れられる形ではない)
  const vines = [];
  for(let i=0;i<14;i++){
    const t = (hash2(i, 1.3) - 0.5)*0.9;
    const len = 90 + hash2(i, 2.9)*230;
    const v = leafGeo(len, 7 + hash2(i, 4.4)*6, 0.05, 8, 0.5);
    v.rotateX(Math.PI);                     // 下へ垂らす
    v.rotateY(-Math.atan2(py, px) + (hash2(i, 5.5) - 0.5)*0.6);
    v.translate(px*span*t + ax/al*(blockW*0.55)*(i%2 ? 1 : -1), H + 44, py*span*t + ay/al*(blockW*0.55)*(i%2 ? 1 : -1));
    vines.push(doubleSided(v, 0.3));
  }
  const vg = mergeGeos(vines);
  paintGeo(vg, new THREE.Color(0x3d6a22), new THREE.Color(0x7aa83c), H - 300, H + 44, 0.3);
  const vm = new THREE.Mesh(vg, leafMat());
  placeAt(vm, lm.x, lm.y, 0);
  group.add(vm);
}

/* ---------------------------------------------------------------------
   ボスの巣。枝を編んだ低い輪・大きな肋骨・散らばった骨・地面の爪痕
   どれも判定は無いので、細い(骨・枝)か低い(巣材・骨片)形だけにする
   --------------------------------------------------------------------- */
function buildNest(group, key, n){
  const g = new THREE.Group();
  const R = n.r;
  const tint = exploreMixColor(exploreRegionColors('rock'), exploreWeights(n.x, n.y), new THREE.Color());
  // 巣材: 枝を寝かせて輪に積む(高さ30以下)
  const sticks = [];
  const NS = 90;
  for(let i=0;i<NS;i++){
    const a = i/NS*Math.PI*2 + hash2(i, 1.1)*0.3;
    const rr = R*(0.40 + hash2(i, 2.2)*0.16);
    const len = 70 + hash2(i, 3.3)*110;
    const s = new THREE.CylinderGeometry(2.2, 3.4, len, 4);
    s.rotateZ(Math.PI/2 + (hash2(i, 4.4) - 0.5)*0.35);
    s.rotateY(-a + Math.PI/2 + (hash2(i, 5.5) - 0.5)*1.2);
    s.translate(Math.cos(a)*rr, 5 + hash2(i, 6.6)*20, Math.sin(a)*rr);
    sticks.push(s);
  }
  const sg = mergeGeos(sticks);
  const stickC = new THREE.Color(0x5a4430).multiply(tint);
  paintGeo(sg, stickC.clone().multiplyScalar(0.6), stickC.clone().multiplyScalar(1.25), 0, 30, 0.35);
  g.add(new THREE.Mesh(sg, woodMat()));
  // 肋骨の籠(巣の片側)。細い弧なので陰に隠れられる形ではない
  const cage = [];
  const bAng = hash2(n.x*0.001, n.y*0.001)*Math.PI*2;
  for(let i=0;i<7;i++){
    const off = (i - 3)*44;
    const hgt = 170 + (3 - Math.abs(i - 3))*30;
    for(const side of [1, -1]){
      const pts = [];
      for(let k=0;k<=8;k++){
        const t = k/8;
        pts.push(new THREE.Vector3(side*(28 + Math.sin(t*Math.PI*0.9)*95), Math.sin(t*Math.PI*0.5)*hgt - 10, off));
      }
      cage.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 5.5 - Math.abs(i-3)*0.4, 5, false));
    }
  }
  const spinePts = [];
  for(let k=0;k<=10;k++) spinePts.push(new THREE.Vector3(0, 8 + Math.sin(k*0.9)*4, (k - 5)*40));
  cage.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(spinePts), 20, 10, 6, false));
  const cg = mergeGeos(cage);
  cg.rotateY(-bAng);
  cg.translate(Math.cos(bAng)*R*0.55, 0, Math.sin(bAng)*R*0.55);
  const bones = [cg];
  // 牙(巨大な弧を2本、籠の反対側に)。根元が太く先が尖る
  for(const s of [1, -1]){
    const tp = [];
    for(let k=0;k<=8;k++){ const t = k/8; tp.push(new THREE.Vector3(s*(60 + t*40), Math.sin(t*1.4)*150, t*t*90)); }
    const curve = new THREE.CatmullRomCurve3(tp);
    const tusk = new THREE.TubeGeometry(curve, 12, 1, 6, false);
    const pp = tusk.attributes.position;
    for(let i=0;i<pp.count;i++){
      const t = Math.floor(i/7)/12;
      const c = curve.getPointAt(Math.min(1, t));
      const v = new THREE.Vector3(pp.getX(i), pp.getY(i), pp.getZ(i)).sub(c).multiplyScalar(14*(1 - t*0.92));
      pp.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
    }
    tusk.computeVertexNormals();
    tusk.rotateY(-bAng - Math.PI/2);
    tusk.translate(-Math.cos(bAng)*R*0.45, 0, -Math.sin(bAng)*R*0.45);
    bones.push(tusk);
  }
  // 骨片(低い)
  for(let i=0;i<24;i++){
    const a = hash2(i, 7.1)*Math.PI*2, rr = R*(0.15 + hash2(i, 8.2)*0.75);
    const b = new THREE.CylinderGeometry(3.2, 3.2, 26 + hash2(i, 9.3)*34, 5);
    b.rotateZ(Math.PI/2); b.rotateY(hash2(i, 10.4)*Math.PI*2);
    b.translate(Math.cos(a)*rr, 4, Math.sin(a)*rr);
    bones.push(b);
  }
  const bg = mergeGeos(bones);
  const bone = new THREE.Color(0xd8ccb0).multiply(mixColor(tint, new THREE.Color(1,1,1), 0.55));
  paintGeo(bg, bone.clone().multiplyScalar(0.62), bone.clone().multiplyScalar(1.08), 0, 220, 0.3);
  cavityShade(bg, 0.3, 0.2);
  const bm = new THREE.Mesh(bg, boneMat());
  bm.castShadow = true;
  g.add(bm);
  // 爪痕: 3本ずつの暗い筋を地面に焼く(乗算)。地形に沿わせるため頂点ごとに高さを取る
  const marks = [];
  for(let s=0;s<4;s++){
    const a = s*1.6 + hash2(s, n.x*0.001)*0.8;
    const cx = Math.cos(a)*R*0.95, cz = Math.sin(a)*R*0.95;
    const dir = a + Math.PI/2 + (hash2(s, 3.3) - 0.5)*0.8;
    for(let k=0;k<3;k++){
      const off = (k - 1)*20;
      const len = 150 + hash2(s, k)*60;
      const seg = 10;
      const pos = [], col = [];
      for(let q=0;q<=seg;q++){
        const t = q/seg;
        const w = 7*Math.sin(Math.PI*Math.min(1, t*1.15));
        const along = (t - 0.5)*len;
        const ox = Math.cos(dir)*along - Math.sin(dir)*(off + Math.sin(t*3)*6);
        const oz = Math.sin(dir)*along + Math.cos(dir)*(off + Math.sin(t*3)*6);
        for(const sd of [-1, 1]){
          const x = cx + ox - Math.sin(dir)*w*sd, z = cz + oz + Math.cos(dir)*w*sd;
          pos.push(x, heightAt(n.x + x, n.y + z) - heightAt(n.x, n.y) + 1.5, z);
          const v = 0.42 + 0.58*(1 - Math.sin(Math.PI*t));
          col.push(v, v*0.97, v*0.95);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const idx = [];
      for(let q=0;q<seg;q++){ const a0 = q*2; idx.push(a0, a0+1, a0+2, a0+1, a0+3, a0+2); }
      geo.setIndex(idx);
      marks.push(geo);
    }
  }
  const md = new THREE.Mesh(mergeGeos(marks), decalMat());
  md.renderOrder = 1;
  g.add(md);
  placeAt(g, n.x, n.y, 0);
  g.userData.nest = key;
  group.add(g);
}

/* ---------------------------------------------------------------------
   火山の噴煙。火口の上に立つ板をカメラの方へ向け(縦軸だけ回す)、煙を上へ流す
   --------------------------------------------------------------------- */
function buildPlume(group, lm, world){
  const peak = (world.volcanoes || []).find(v=> v.peakId === lm.peak);
  if(!peak) return null;
  const rise = window.mountainRiseOf ? window.mountainRiseOf(peak) : peak.radius*(peak.isMain ? 1.15 : 0.9);
  const top = heightAt(peak.x, peak.y) + rise - 40;
  const g = new THREE.Group();
  const mat = shared('plume', ()=>{
    const m = new THREE.MeshBasicMaterial({ map:getSmokeTex(), transparent:true, depthWrite:false, vertexColors:true,
                                            side:THREE.DoubleSide, fog:false });
    return farHaze(m, 7000, 26000);
  });
  const layers = [];
  for(let i=0;i<3;i++){
    const w = PLUME_W*(1 - i*0.18), h = PLUME_H*(1 - i*0.1);
    const p = new THREE.PlaneGeometry(w, h, 1, 8);
    p.translate(0, h/2, 0);
    // 下は溶岩の照り返しで赤く、上は灰色に抜ける
    const pp = p.attributes.position, col = new Float32Array(pp.count*3);
    for(let k=0;k<pp.count;k++){
      const t = pp.getY(k)/h;
      const glow = Math.max(0, 1 - t*4.5);
      col[k*3]   = 0.13 + glow*0.9;
      col[k*3+1] = 0.12 + glow*0.28;
      col[k*3+2] = 0.12 + glow*0.06;
    }
    p.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    // 板ごとに煙の模様をずらすため、UVを横にずらす
    const uv = p.attributes.uv;
    for(let k=0;k<uv.count;k++) uv.setY(k, uv.getY(k)*(1.6 + i*0.3) + i*0.37);
    const m = new THREE.Mesh(p, mat);
    m.position.set((i - 1)*160, 0, (i - 1)*-120);
    m.renderOrder = 4 + i;
    layers.push(m);
    g.add(m);
  }
  g.position.set(peak.x, top, peak.y);
  group.add(g);
  return g;
}

/* ---------------------------------------------------------------------
   山をまとめる(同じ種類・火口なしの山を1つのメッシュへ)。
   材質は種類ごとに同じ中身(色の芯はテーマから・霞は EXPLORE_ATMO を共有)なので、
   先頭の1つを残して使い回す。描画命令が「山の数」から「種類の数」へ減る。
   --------------------------------------------------------------------- */
const MOUNT_CHUNK = 6100;   // まとめる区画の一辺(3×3区画)。区画ごとに視野外なら描かない(影の計算も)
function mergeMountains(group){
  const byStyle = new Map();
  for(const o of group.children){
    if(!o.isMesh || !o.userData.mountStyle) continue;
    const key = o.userData.mountStyle + '|' + Math.floor(o.position.x/MOUNT_CHUNK) + ',' + Math.floor(o.position.z/MOUNT_CHUNK);
    if(!byStyle.has(key)) byStyle.set(key, []);
    byStyle.get(key).push(o);
  }
  for(const [key, list] of byStyle){
    const style = list[0].userData.mountStyle;
    if(list.length < 2) continue;
    let n = 0;
    for(const m of list) n += m.geometry.attributes.position.count;
    const pos = new Float32Array(n*3), nor = new Float32Array(n*3), col = new Float32Array(n*3), coat = new Float32Array(n);
    let o = 0;
    for(const m of list){
      const g = m.geometry, p = g.attributes.position, c = p.count;
      const px = m.position.x, py = m.position.y, pz = m.position.z;
      for(let i=0;i<c;i++){
        pos[(o+i)*3] = p.getX(i) + px; pos[(o+i)*3+1] = p.getY(i) + py; pos[(o+i)*3+2] = p.getZ(i) + pz;
      }
      nor.set(g.attributes.normal.array, o*3);
      col.set(g.attributes.color.array, o*3);
      coat.set(g.attributes.aCoat.array, o);
      o += c;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aCoat', new THREE.BufferAttribute(coat, 1));
    geo.computeBoundingSphere();
    const merged = new THREE.Mesh(geo, list[0].material);
    merged.castShadow = true; merged.receiveShadow = true;
    merged.userData.mountStyle = style;
    for(let i=0;i<list.length;i++){
      group.remove(list[i]);
      list[i].geometry.dispose();
      if(i > 0) list[i].material.dispose();
    }
    group.add(merged);
  }
}

/* 地面のしみ(溶岩・湖・川・濡れた砂)を材質ごとにまとめる。材質は種類ごとに共有されていて、
   頂点はワールド座標のまま(位置は原点)なので、同じ属性の組のものは頂点をつなぐだけでよい。 */
function mergeZones(group){
  const buckets = new Map();
  for(const o of group.children){
    if(!o.isMesh || o.userData.mountStyle || !o.material.userData.shared || !o.geometry.index) continue;
    if(o.position.lengthSq() > 0) continue;
    const names = Object.keys(o.geometry.attributes).sort().join(',');
    const key = o.material.uuid + '|' + names + '|' + o.renderOrder;
    if(!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  }
  for(const list of buckets.values()){
    if(list.length < 2) continue;
    const names = Object.keys(list[0].geometry.attributes);
    let nv = 0, ni = 0;
    for(const m of list){ nv += m.geometry.attributes.position.count; ni += m.geometry.index.count; }
    const geo = new THREE.BufferGeometry();
    for(const n of names){
      const a0 = list[0].geometry.attributes[n], arr = new Float32Array(nv*a0.itemSize);
      let o = 0;
      for(const m of list){ const a = m.geometry.attributes[n]; arr.set(a.array, o); o += a.array.length; }
      geo.setAttribute(n, new THREE.BufferAttribute(arr, a0.itemSize));
    }
    const idx = new Uint32Array(ni);
    let io = 0, vo = 0;
    for(const m of list){
      const ix = m.geometry.index.array;
      for(let i=0;i<ix.length;i++) idx[io+i] = ix[i] + vo;
      io += ix.length; vo += m.geometry.attributes.position.count;
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    const merged = new THREE.Mesh(geo, list[0].material);
    merged.renderOrder = list[0].renderOrder;
    merged.receiveShadow = list[0].receiveShadow;
    for(const m of list){ group.remove(m); m.geometry.dispose(); }
    group.add(merged);
  }
}

/* 動かないランドマークの部品を「材質×区画」ごとに1つのメッシュへ焼き込む。
   テント・柱・骨・枝…と部品が多く、そのままだとキャンプだけで描画命令が100を超えた(実測)。
   動く物(炎・結晶・光の輪・旗・噴煙・光の柱)は userData で印を付けて残す。 */
const ANIM_KEYS = ['flicker', 'flickerGlow', 'spin', 'pulse', 'beam', 'sway', 'keep'];
function bakeStatic(root){
  root.updateMatrixWorld(true);
  const buckets = new Map();
  const isAnim = (o)=>{ for(let p=o; p && p !== root; p = p.parent){ for(const k of ANIM_KEYS) if(p.userData[k] != null) return true; } return false; };
  const list = [];
  root.traverse(o=>{ if(o.isMesh && !isAnim(o) && !o.material.transparent) list.push(o); });
  for(const m of list){
    const wp = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld);
    const key = m.material.uuid + '|' + Math.floor(wp.x/MOUNT_CHUNK) + ',' + Math.floor(wp.z/MOUNT_CHUNK);
    if(!buckets.has(key)) buckets.set(key, { mat:m.material, geos:[], shadow:false });
    const b = buckets.get(key);
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    b.geos.push(g);
    b.shadow = b.shadow || m.castShadow;
    m.parent.remove(m);
    m.geometry.dispose();
  }
  const out = new THREE.Group();
  for(const b of buckets.values()){
    const mesh = new THREE.Mesh(mergeGeos(b.geos), b.mat);
    mesh.castShadow = b.shadow; mesh.receiveShadow = true;
    out.add(mesh);
  }
  root.add(out);
}

/* ---------------------------------------------------------------------
   入口(real3d.js から)
   --------------------------------------------------------------------- */
let anim = null;
export function buildExploreWorld(group, world){
  const lay = L();
  if(!lay) return;
  mergeMountains(group);
  mergeZones(group);
  anim = { flames:[], fireGlow:[], beacons:[], banners:[], plumes:[] };
  const lg = new THREE.Group();
  buildCamp(lg, anim);
  for(const lm of lay.landmarks){
    if(lm.kind === 'arch') buildArch(lg, lm);
    else if(lm.kind === 'tower') buildTower(lg, lm);
    else if(lm.kind === 'gate') buildGate(lg, lm);
    else if(lm.kind === 'plume'){ const p = buildPlume(lg, lm, world); if(p) anim.plumes.push(p); }
  }
  for(const k of Object.keys(lay.regions)) buildNest(lg, k, lay.regions[k].nest);
  bakeStatic(lg);
  group.add(lg);
}

/* 地域の空気。カメラの地域の重みで、霞・日差し・空の地平の色を混ぜる。
   空の元の色(テーマから作った値)は最初のフレームで覚えておき、そこから混ぜる。 */
let baseSky = null;
const _hz = new THREE.Color(), _sun = new THREE.Color(), _tmp = new THREE.Color(), _zen = new THREE.Color();
const SUN_BASE = new THREE.Color(0xfff1d6);
export function updateExplore(t, cp, ctx){
  const w = exploreWeights(cp.x, cp.y);
  exploreMixColor(exploreRegionColors('haze'), w, _hz);
  EXPLORE_ATMO.haze.value.copy(_hz);
  const fog = ctx.scene.fog;
  fog.color.copy(_hz);
  fog.near = exploreMixNum('fog', w, 0);
  fog.far  = exploreMixNum('fog', w, 1);
  if(ctx.sun){
    exploreMixColor(exploreRegionColors('sun'), w, _sun);
    ctx.sun.color.copy(_sun);
  }
  const u = ctx.sky && ctx.sky.material && ctx.sky.material.uniforms;
  if(u){
    if(!baseSky) baseSky = { low:u.uLowSky.value.clone(), glow:u.uSunCol.value.clone(),
                             mid:u.uCloudMid.value.clone(), dark:u.uCloudDark.value.clone(), lit:u.uCloudLit.value.clone() };
    u.uHorizon.value.copy(_hz);
    u.uBelow.value.copy(_hz).multiplyScalar(0.84);
    u.uLowSky.value.copy(baseSky.low).lerp(_hz, 0.40);
    exploreMixColor(exploreRegionColors('sky'), w, _zen);
    u.uZenith.value.copy(_zen);
    u.uHigh.value.copy(u.uLowSky.value).lerp(_zen, 0.60);
    u.uSunCol.value.copy(baseSky.glow).lerp(_tmp.copy(_sun), 0.35);
    // 火山の上空は噴煙で雲が煤ける(雲の色を霞の暗い色へ寄せる)
    const smoke = exploreMixNum('cloud', w);
    _tmp.copy(_hz).multiplyScalar(0.55);
    u.uCloudMid.value.copy(baseSky.mid).lerp(_tmp, smoke);
    u.uCloudDark.value.copy(baseSky.dark).lerp(_tmp.multiplyScalar(0.6), smoke);
    u.uCloudLit.value.copy(baseSky.lit).lerp(_hz, smoke*0.7);
  }
  // 遠景の山並み(空のモジュールが1回だけ焼いた色)も、その地域の空気へ寄せる
  const ru = ctx.ridge && ctx.ridge.material && ctx.ridge.material.uniforms;
  if(ru && ru.uTint){
    ru.uTint.value.copy(_hz);
    ru.uTintAmt.value = exploreMixNum('ridgeHaze', w);
  }
  if(!anim) return;
  // 焚き火のゆらぎ
  for(const f of anim.flames){
    const k = 0.86 + 0.14*Math.sin(t*11.3) + 0.08*Math.sin(t*23.7 + 1.1);
    f.scale.set(1, k, 1);
    f.rotation.y = t*0.6;
  }
  for(const gl of anim.fireGlow){ if(gl) gl.material.opacity = 0.34 + 0.08*Math.sin(t*9.1) + 0.04*Math.sin(t*17.3); }
  // ビーコン
  for(const b of anim.beacons){
    b.crys.rotation.y = t*0.9;
    b.crys.position.y = 128 + Math.sin(t*1.7)*8;
    const s = 60 + ((t*0.45) % 1)*260;
    b.ring.scale.set(s, s, s);
    b.ring.material.opacity = 0.55*(1 - ((t*0.45) % 1));
    b.beam.uniforms.uTime.value = t;
  }
  for(const bn of anim.banners){
    bn.rotation.y = Math.sin(t*1.3 + bn.userData.sway*3)*0.22;
  }
  // 噴煙: カメラの方を向け(縦軸だけ)、模様を上へ流す
  const st = getSmokeTex();
  st.offset.y = -t*0.012;
  for(const p of anim.plumes){
    p.rotation.y = Math.atan2(cp.x - p.position.x, cp.y - p.position.z);
  }
}
// マップを離れるとき(real3d.js の applyTheme)に空気を元へ戻す
export function resetExplore(ctx){
  anim = null; baseSky = null;
  if(ctx && ctx.sun) ctx.sun.color.copy(SUN_BASE);
  const ru = ctx && ctx.ridge && ctx.ridge.material && ctx.ridge.material.uniforms;
  if(ru && ru.uTintAmt) ru.uTintAmt.value = 0;
}
