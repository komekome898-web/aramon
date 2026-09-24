/* =====================================================================
   探検フィールド(MAPS.explore)の3D: ランドマーク・人工物・巨木・溶岩と地域の空気
   real3d.js から R3.theme.explore のときだけ呼ばれる(他のマップでは何もしない)。

   ・起伏(尾根・峡谷・山)は地形そのもの(data.js の exploreRelief)。ここでは描かない。
     地形パッチの外は遠景の地形(real3d_terrain.js の buildFarTerrain)をここで足す。
   ・ランドマーク = 遠くから方向が分かる大物。位置はすべて data.js の
     EXPLORE_FIELD_LAYOUT が正(ここに座標を書かない)。
       ベースキャンプ(テント・焚き火・旗・帰還ビーコン=緑の灯火の塔と回る輪)/ 天然のアーチ岩 /
       監視塔 / 氷の尖塔 / 遺跡の大門 / 各ボスの巣 / 火山の噴煙
   ・人工物: 廃村の家・一続きの石壁(回廊)。密林の巨木(区画ごとの InstancedMesh)。
     溶岩の川(帯)・溶岩の照り返し・凍った湖の氷・火山の降る灰。
   ・当たり判定: 隠れられそうな大きさの物(テント・アーチの脚・塔・門の柱・家・石壁・巨木の幹)は
     world.js が「noMesh の山」として同じ位置に円の判定を置いている。ここで作る形は
     地面の高さでその円に収まるようにしてある(見た目と判定を一致させる)。
     判定の無い飾り(巣の骨・枝・旗・爪痕・蔦・根)は細い・低い・頭上の形だけにする(SKILLの決まり)。
   ・地域の空気: カメラの位置の地域の重みで、霞(指数型の霧)・日差しの色と強さ・空・雲・
     水辺の岸の色を毎フレーム混ぜる。離れるときは resetExplore が元へ戻す。
   ===================================================================== */
import * as THREE from './vendor/three.module.min.js';
import { ENV_INTENSITY, heightAt, hash2, tileNoise, mergeGeos,
         EXPLORE_ATMO, exploreWeights, exploreRegionColors, exploreMixColor, exploreMixNum } from './real3d_common.js';
import { applySurfaceDetail, paintGeo, cavityShade, patchTint, chipBox,
         leafGeo, doubleSided, tintTop, mixColor } from './real3d_props.js';
import { buildFarTerrain, syncFarTerrain } from './real3d_terrain.js';
import { zoneMaterial, exploreTintWater } from './real3d_water.js';
import { ensureCumulusTex } from './real3d_sky.js';

const FAR_HAZE = [0, 0];            // (互換のため残す。霞はシーンの霧)
/* 帰還ビーコン。**縦の光の柱にしない**(色つきの縦の光=落ちている品の目印、という読み方を
   崩さないため)。緑の灯火を載せた石の塔と、そのまわりを回る光の輪で見せる。 */
const BEACON_COL = 0x5cff8a;        // 足元の輪と同じ緑
const BEACON_TOWER_H = 360;         // 櫓の見張り台の上(灯火の皿)までの高さ
/* 出発地点のカメラは帰還ビーコンの方を向いて始まる(explore.js)。ビーコンが画面の真ん中をふさがないよう、
   櫓は細い脚と筋交いだけの透ける形にし、高さも控えめにする(目印の役目は頂上の灯火と回る輪が持つ) */
const PLUME_W = 1500, PLUME_H = 3600;   // 噴煙の板の大きさ

const L = ()=> window.__aramonExploreLayout;
const frac = (v)=> v - Math.floor(v);

/* ---------------------------------------------------------------------
   材質(試合をまたいで使い回す。worldGroup の作り直しで捨てられないよう shared の印)
   --------------------------------------------------------------------- */
/* 探検フィールドは霞を指数型の1本の曲線(シーンの霧)にそろえた(地面・ランドマーク・水が
   同じ距離で同じだけ霞む)。以前はここで自前の霞を掛けていたが、今はシーンの霧に任せる。 */
function farHaze(mat){ return mat; }
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
  // 帆布は1色(テントごとに少しだけ色みを変える)。下半分を別の色の帯にすると、粗い頂点の間で
  // 色がにじんで「青いグラデーション」に見えた
  const canvas = new THREE.Color(0xd9c9a0).lerp(new THREE.Color(TENT_COLS[seed % TENT_COLS.length]), 0.14);
  const dirt = new THREE.Color(0x6e5a40);
  // 屋根2枚。棟(上)から軒(下)へ張った布。支柱の間で大きくたるみ、張り綱の所で引かれたしわが寄る
  for(const sg of [1, -1]){
    const p = new THREE.PlaneGeometry(1, 1, 12, 8);
    const pp = p.attributes.position;
    for(let i=0;i<pp.count;i++){
      const u = pp.getX(i) + 0.5, v = pp.getY(i) + 0.5;        // u=長さ方向 v=0軒 1棟
      const sag = Math.sin(Math.PI*u)*Math.sin(Math.PI*v)*14 + Math.sin(Math.PI*u*4)*Math.sin(Math.PI*v)*2.5*(1 - v);
      pp.setXYZ(i, (u - 0.5)*Lh*2, 8 + v*(H - 8) - sag*0.6, sg*(Wh*(1 - v) - sag*0.5));
    }
    p.computeVertexNormals();
    const pos = p.attributes.position, col = new Float32Array(pos.count*3), c = new THREE.Color();
    for(let i=0;i<pos.count;i++){
      const y = pos.getY(i);
      // 裾だけ土はねで少し汚れる(細い範囲だけ。色の帯にしない)
      c.copy(canvas).lerp(dirt, Math.max(0, 1 - (y - 8)/22)*0.35).multiplyScalar(0.84 + 0.20*(y/H) + (hash2(i*0.37, seed)-0.5)*0.06);
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
let emblemTex = null;
function getEmblemTex(){
  if(emblemTex) return emblemTex;
  emblemTex = canvasTex(128, 128, (g, w, h)=>{
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const cx = w/2, cy = h/2;
    const glow = g.createRadialGradient(cx, cy, 8, cx, cy, 62);
    glow.addColorStop(0, 'rgba(255,255,255,0.55)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff'; g.lineWidth = 6;
    g.beginPath(); g.arc(cx, cy, 44, 0, Math.PI*2); g.stroke();
    g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, 34, 0, Math.PI*2); g.stroke();
    g.lineWidth = 5;
    g.beginPath(); g.moveTo(cx, cy - 26); g.lineTo(cx + 18, cy); g.lineTo(cx, cy + 26); g.lineTo(cx - 18, cy); g.closePath(); g.stroke();
    for(let k=0;k<8;k++){ const a = k*Math.PI/4; g.beginPath(); g.moveTo(cx + Math.cos(a)*48, cy + Math.sin(a)*48); g.lineTo(cx + Math.cos(a)*58, cy + Math.sin(a)*58); g.stroke(); }
  }, true);
  return emblemTex;
}
function beacon(group, bx, by){
  const g = new THREE.Group();
  const parts = [];
  /* 木の物見櫓(足元の判定の円に収まる4本脚)+ 見張り台 + 石の火皿。
     石の円柱だと工場の煙突に見えた(批評家の指摘)。灯火と回る輪はこの台の上に載せる */
  const H = BEACON_TOWER_H, deckY = H - 70, legB = 44, legT = 26;
  const wood = [], stone = [];
  for(const sx of [-1, 1]) for(const sz of [-1, 1]){
    // 脚は下が開いた丸太(少し内へ傾ける)
    const leg = new THREE.CylinderGeometry(7, 9.5, deckY + 26, 6);
    const lean = Math.atan2(legB - legT, deckY);
    leg.rotateZ(-sx*lean); leg.rotateX(sz*lean);
    leg.translate(sx*(legB + legT)/2, (deckY + 26)/2 - 8, sz*(legB + legT)/2);
    wood.push(leg);
  }
  // 筋交い(X)と横木を3段
  for(let k=0;k<3;k++){
    const y0 = 30 + k*(deckY - 40)/3, y1 = y0 + (deckY - 40)/3;
    const w0 = legB - (legB - legT)*(y0/deckY), w1 = legB - (legB - legT)*(y1/deckY);
    for(const [ax, az] of [[1, 0], [0, 1]]) for(const sg of [-1, 1]){
      const len = Math.hypot(w0 + w1, y1 - y0);
      for(const d of [-1, 1]){
        const br = new THREE.BoxGeometry(5, len, 5);
        br.rotateZ(d*Math.atan2(w0 + w1, y1 - y0)*(ax ? 1 : 0));
        br.rotateX(d*Math.atan2(w0 + w1, y1 - y0)*(az ? 1 : 0));
        br.translate(az*sg*(w0 + w1)/2, (y0 + y1)/2, ax*sg*(w0 + w1)/2);
        wood.push(br);
      }
      const rail = new THREE.BoxGeometry(ax ? (w1*2 + 10) : 6, 6, az ? (w1*2 + 10) : 6);
      rail.translate(az*sg*w1, y1, ax*sg*w1);
      wood.push(rail);
    }
  }
  // 見張り台(床板)と手すり
  const deck = chipBox(legT*2 + 46, 10, legT*2 + 46, 3.3, 0.03); deck.translate(0, deckY, 0); wood.push(deck);
  for(const [ax, az] of [[1, 0], [0, 1]]) for(const sg of [-1, 1]){
    const r = new THREE.BoxGeometry(ax ? legT*2 + 46 : 5, 5, az ? legT*2 + 46 : 5);
    r.translate(az*sg*(legT + 21), deckY + 34, ax*sg*(legT + 21)); wood.push(r);
    for(const t of [-1, 0, 1]){ const post = new THREE.BoxGeometry(5, 34, 5); post.translate(az*sg*(legT + 21) + ax*t*(legT + 21), deckY + 17, ax*sg*(legT + 21) + az*t*(legT + 21)); wood.push(post); }
  }
  // 石の火皿(台の真ん中)
  const bowl = new THREE.CylinderGeometry(34, 22, 24, 10, 1, false); bowl.translate(0, deckY + 17, 0); stone.push(bowl);
  const wg = mergeGeos(wood);
  paintGeo(wg, new THREE.Color(0x4a3524), new THREE.Color(0x86684a), 0, H, 0.3);
  cavityShade(wg, 0.3, 0.2);
  const wm = new THREE.Mesh(wg, woodMat()); wm.castShadow = true; g.add(wm);
  const sgm = mergeGeos(stone);
  paintGeo(sgm, new THREE.Color(0x4f4d48), new THREE.Color(0x8a847a), deckY, deckY + 30, 0.2);
  const smm = new THREE.Mesh(sgm, rockMat()); smm.castShadow = true; g.add(smm);
  // 見張り台の四方に下げた発光する紋(緑の輪と菱形。帰る場所の印)
  const emb = shared('beaconEmblem', ()=>{
    const m = new THREE.MeshBasicMaterial({ map:getEmblemTex(), color:BEACON_COL, transparent:true, blending:THREE.AdditiveBlending,
                                            depthWrite:false, side:THREE.DoubleSide, fog:false });
    m.toneMapped = false; return m;
  });
  const eg = new THREE.Group();
  for(let k=0;k<4;k++){
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), emb);
    const a = k*Math.PI/2;
    pl.position.set(Math.sin(a)*(legT + 26), deckY - 40, Math.cos(a)*(legT + 26));
    pl.rotation.y = a;
    eg.add(pl);
  }
  eg.userData.keep = true;
  g.add(eg);
  const y = deckY - 10;
  const top = y + 40;
  // 灯火(緑の炎)。加算の板を交差させ、揺らす
  const fm = shared('beaconFlame', ()=>{
    const m = new THREE.MeshBasicMaterial({ map:getFlameTex(), color:BEACON_COL, transparent:true, blending:THREE.AdditiveBlending,
                                            depthWrite:false, side:THREE.DoubleSide, fog:false });
    m.toneMapped = false; return m;
  });
  const flame = new THREE.Group();
  for(let i=0;i<3;i++){ const p = new THREE.PlaneGeometry(120, 190); p.translate(0, 80, 0); p.rotateY(i*Math.PI/3); flame.add(new THREE.Mesh(p, fm)); }
  flame.position.y = top - 20;
  flame.userData.flicker = true;
  g.add(flame);
  // 遠くから見える緑の光のにじみ(ビルボード)
  const halo = new THREE.Sprite(shared('beaconHalo', ()=>{
    const m = new THREE.SpriteMaterial({ map:getGlowTex(), color:BEACON_COL, transparent:true, opacity:0.6, blending:THREE.AdditiveBlending, depthWrite:false, fog:false });
    m.toneMapped = false; return m;
  }));
  halo.scale.set(300, 300, 1);
  halo.position.y = top + 60;
  halo.userData.keep = true;
  g.add(halo);
  // 灯火のまわりを回る光の輪(傾きの違う2本)。縦の柱ではなく「回る輪」で目印にする
  // 輪は加算にしない(明るい空の前で白く飛ぶ)。緑のまま見える普通の半透明
  const ringMat = shared('beaconSpin', ()=>{
    const m = new THREE.MeshBasicMaterial({ color:BEACON_COL, transparent:true, opacity:0.9, depthWrite:false, fog:false });
    m.toneMapped = false; return m;
  });
  const rings = [];
  for(const [r, tilt] of [[110, 0.35], [160, -0.55]]){
    const ringG = new THREE.Group();
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 7, 6, 64), ringMat);
    m.rotation.x = Math.PI/2;
    ringG.add(m);
    ringG.rotation.z = tilt;
    ringG.position.y = top + 70;
    ringG.userData.spin = true;
    g.add(ringG);
    rings.push(ringG);
  }
  // 足元に広がる光の輪(ゆっくり脈打つ)
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 48), glowMat('beaconRing', BEACON_COL, 0.55));
  ring.rotation.x = -Math.PI/2; ring.position.y = 4;
  ring.userData.pulse = true;
  g.add(ring);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), glowMat('beaconPool', BEACON_COL, 0.30, getGlowTex()));
  pool.rotation.x = -Math.PI/2; pool.position.y = 3;
  g.add(pool);
  placeAt(g, bx, by, 6);
  group.add(g);
  return { flame, rings, ring, halo };
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
  anim.banners.push(flagPole(group, C.beacon.x - 260, C.beacon.y + 60, 0.2));
  anim.banners.push(flagPole(group, C.beacon.x + 260, C.beacon.y + 60, 1.7));
  anim.banners.push(flagPole(group, C.x - 40, C.y + 640, 3.1));
}

/* ---------------------------------------------------------------------
   天然のアーチ岩(草原)。脚2本と、それをつなぐ岩の弧を1本の管で作る
   --------------------------------------------------------------------- */
function buildArch(group, lm){
  const ax = lm.a[0], ay = lm.a[1], bx = lm.b[0], by = lm.b[1];
  const ga = heightAt(ax, ay), gb = heightAt(bx, by);
  const pts = [];
  const N = 26;
  for(let i=0;i<=N;i++){
    const t = i/N;
    const s = Math.sin(Math.PI*t);
    // 端は地面の下まで埋める。上は平たい弧(sinの0.55乗)で、頂は少し片側へ寄せる(左右対称にしない)
    const lean = 0.06*Math.sin(Math.PI*t*2);
    const y = (ga*(1-t) + gb*t) - 90 + (lm.h - 40)*Math.pow(s, 0.55) + 90*Math.min(1, s*6);
    pts.push(new THREE.Vector3(ax + (bx-ax)*(t + lean*0.2), y, ay + (by-ay)*(t + lean*0.2)));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const TS = 110, RS = 22;
  const geo = new THREE.TubeGeometry(curve, TS, 1, RS, false);
  /* 断面は2:1の板(自然のアーチは岩の「ひれ」が抜けた形)。アーチの面の中の向き(normal)に
     厚く、面に垂直(binormal)に薄い。脚の足元では面の中の向き=a→b になるので、
     足元の判定(a→bに並べた2つの円)と同じ細長い形になる。                     */
  const pos = geo.attributes.position;
  const frames = curve.computeFrenetFrames(TS, false);
  const v = new THREE.Vector3();
  for(let i=0;i<=TS;i++){
    const t = i/TS;
    const c = curve.getPointAt(t);
    const s = Math.sin(Math.PI*t);
    const rad = lm.foot*(1 - 0.42*Math.pow(s, 0.7));
    for(let j=0;j<=RS;j++){
      const k = i*(RS+1) + j;
      v.set(pos.getX(k), pos.getY(k), pos.getZ(k)).sub(c).normalize();
      const nIn = v.dot(frames.normals[i]), nOut = v.dot(frames.binormals[i]);
      // 角の丸い長方形(超楕円 p=4)。丸い管に見せない: 面は平ら・角だけ欠ける
      const sq = 1/Math.pow(Math.pow(Math.abs(nIn), 4) + Math.pow(Math.abs(nOut)/0.5, 4), 0.25);
      const n = tileNoise(t*16 + 3.1, j/RS*8, 8)*0.45 + tileNoise(t*41, j/RS*16 + 1.7, 16)*0.33 + tileNoise(t*89, j/RS*32, 32)*0.22;
      const chip = Math.pow(tileNoise(t*27 + 7.7, j/RS*6, 6), 3)*0.30;
      // 地層: 水平の層ごとに少し出入りする(硬い層が張り出し、柔らかい層がえぐれる)
      const lay = c.y/68 + n*0.4, fr = lay - Math.floor(lay);
      const ledge = 0.95 + 0.07*Math.min(1, fr*5) - 0.04*(Math.floor(lay) % 2);
      const r = rad*sq*Math.min(1, 0.80 + 0.26*n - chip)*ledge;
      pos.setXYZ(k, c.x + frames.normals[i].x*nIn*r + frames.binormals[i].x*nOut*r,
                    c.y + frames.normals[i].y*nIn*r + frames.binormals[i].y*nOut*r,
                    c.z + frames.normals[i].z*nIn*r + frames.binormals[i].z*nOut*r);
    }
  }
  geo.computeVertexNormals();
  const mx = (ax+bx)/2, my = (ay+by)/2, mh = (ga+gb)/2;
  geo.translate(-mx, -mh, -my);
  // 赤みのある砂岩。水平の地層(高さで明暗と色みの縞)
  const rockLo = new THREE.Color(0x7a5a44), rockHi = new THREE.Color(0xc8a987);
  paintGeo(geo, rockLo, rockHi, -60, lm.h, 0.35);
  {
    const p2 = geo.attributes.position, c2 = geo.attributes.color;
    for(let k=0;k<p2.count;k++){
      const y = p2.getY(k);
      const band = 1 + 0.13*Math.sin(y*0.040) + 0.07*Math.sin(y*0.121 + 1.3);
      const warm = 0.5 + 0.5*Math.sin(y*0.018 + 0.7);
      c2.setXYZ(k, c2.getX(k)*band*(0.96 + warm*0.08), c2.getY(k)*band, c2.getZ(k)*band*(1.02 - warm*0.08));
    }
    c2.needsUpdate = true;
  }
  cavityShade(geo, 0.34, 0.24);
  tintTop(geo, new THREE.Color(0x5b7433), lm.h*0.80, lm.h*1.05, 0.45);
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
    // 柱頭: 3段に張り出す持ち送り + 彫りの帯(小さな石を並べた刻み)
    let cy2 = y;
    [[1.10, 26], [1.24, 30], [1.36, 22]].forEach((c, k)=>{
      const cap = chipBox(blockW*c[0], c[1], blockW*c[0], sg*5.3 + k*1.9, 0.05);
      cap.rotateY(-Math.atan2(py, px));
      cap.translate(cx, cy2 + c[1]/2, cz);
      parts.push(cap);
      cy2 += c[1];
    });
    for(let k=0;k<12;k++){
      const a = k/12*Math.PI*2, rr2 = blockW*0.62;
      const glyph = chipBox(18, 24, 10, sg*7.1 + k, 0.2);
      glyph.rotateY(-a);
      glyph.translate(cx + Math.cos(a)*rr2*Math.SQRT1_2*1.2, y - 40, cz + Math.sin(a)*rr2*Math.SQRT1_2*1.2);
      parts.push(glyph);
    }
  }
  // 楣は2つに割れている。片方は柱頭に載ったまま、もう片方は割れ口が下がって傾く
  const span = lm.half*2 + blockW*1.4;
  const yaw = -Math.atan2(py, px);
  const L1 = span*0.56, L2 = span*0.42;
  const l1 = chipBox(L1, 104, blockW*1.08, 7.7, 0.05);
  l1.rotateY(yaw); l1.translate(-px*(span/2 - L1/2), H + 110, -py*(span/2 - L1/2));
  parts.push(l1);
  const l2 = chipBox(L2, 100, blockW*1.02, 9.1, 0.06);
  l2.rotateZ(-0.10);
  l2.rotateY(yaw); l2.translate(px*(span/2 - L2/2), H + 94, py*(span/2 - L2/2));
  parts.push(l2);
  // 割れ目から落ちた破片(門の下。低い)
  for(let k=0;k<4;k++){
    const d = chipBox(40 + k*8, 26, 34, 11.3 + k, 0.3);
    d.rotateY(k*1.3);
    d.translate(px*(span*0.06 + k*24) + ax/al*(k - 1.5)*40, 13, py*(span*0.06 + k*24) + ay/al*(k - 1.5)*40);
    parts.push(d);
  }
  // 楣の上の崩れかけた飾り石
  for(let i=0;i<3;i++){
    const t = (i - 1)*0.28;
    const orn = chipBox(blockW*0.55, 70 - i*12, blockW*0.55, i*4.1, 0.12);
    orn.rotateY(-Math.atan2(py, px) + (i - 1)*0.1);
    orn.translate(px*span*t - px*span*0.12, H + 196 + 35, py*span*t - py*span*0.12);
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
  // 柱に絡みつく木の根(らせんに巻きながら地面へ降りる。細いので判定は持たない)
  const roots = [];
  for(const sg of [1, -1]){
    const cx = px*lm.half*sg, cz = py*lm.half*sg;
    const base = heightAt(lm.x + cx, lm.y + cz) - g0;
    for(let k=0;k<4;k++){
      const pts = [];
      const a0 = k*1.6 + sg;
      for(let q=0;q<=14;q++){
        const t = q/14;
        const a = a0 + t*2.6;
        // 柱の面に沿って巻き(角は少し食い込む)、足元で広がって地面へ潜る
        const rr2 = blockW*(0.60 + 0.30*Math.pow(t, 3)) + (q === 14 ? 40 : 0);
        pts.push(new THREE.Vector3(cx + Math.cos(a)*rr2, base + (1 - t)*(H*0.75) - (q === 14 ? 30 : 10), cz + Math.sin(a)*rr2));
      }
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 13 + k*2.5, 6, false);
      roots.push(tube);
    }
  }
  const rg = mergeGeos(roots);
  paintGeo(rg, new THREE.Color(0x6a5238), new THREE.Color(0xa08664), 0, H, 0.3);
  patchTint(rg, new THREE.Color(0x3f5f24), 0.45, 2.1, 0.02);
  const rm = new THREE.Mesh(rg, woodMat());
  rm.castShadow = true;
  placeAt(rm, lm.x, lm.y, 0);
  group.add(rm);
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
  const peak = L().relief.peaks.find(p=> p.id === lm.peak);
  if(!peak) return null;
  // 火口の縁の高さから立ち上げる(山は地形の起伏なので、縁の高さを実際に測る)
  const rimR = peak.r*(peak.crater ? peak.crater.r : 0.1);
  const top = Math.max(heightAt(peak.x + rimR, peak.y), heightAt(peak.x - rimR, peak.y)) - 120;
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
   氷の尖塔(凍った高地)。監視塔と被らない形で、5km先からも「青白く光る棘の束」と分かる。
   中心の大結晶+周りに傾いた結晶。面取り(稜を少し引く)と内側からの発光。
   --------------------------------------------------------------------- */
function crystalPrism(r, h, seed){
  const g = new THREE.CylinderGeometry(r*0.78, r, h*0.78, 6, 4);
  const p = g.attributes.position;
  for(let i=0;i<p.count;i++){
    const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x);
    const k = 1 - 0.06*Math.pow(Math.abs(Math.cos(a*3 + seed)), 8);
    p.setXYZ(i, x*k, p.getY(i), z*k);
  }
  g.translate(0, h*0.39, 0);
  const tip = new THREE.ConeGeometry(r*0.78, h*0.22, 6, 2);
  tip.translate(0, h*0.78 + h*0.11, 0);
  const m = mergeGeos([g, tip]);
  m.computeVertexNormals();
  return m;
}
function buildIceSpire(group, lm){
  const parts = [];
  { const c = crystalPrism(lm.foot*0.60, lm.h, 0.3); c.rotateZ(0.07); c.rotateX(-0.05); parts.push(c); }
  { const c = crystalPrism(lm.foot*0.42, lm.h*0.78, 1.7); c.rotateZ(-0.16); c.translate(lm.foot*0.30, -10, lm.foot*0.10); parts.push(c); }
  for(let i=0;i<9;i++){
    const a = i/9*Math.PI*2 + 0.4, d = lm.foot*(0.35 + hash2(i, 2.2)*0.30);
    const h = lm.h*(0.30 + hash2(i, 4.1)*0.40), r = lm.foot*(0.20 + hash2(i, 6.3)*0.16);
    const c = crystalPrism(r, h, i);
    c.rotateZ(0.30 + hash2(i, 8.8)*0.35);
    c.rotateY(-a);
    c.translate(Math.cos(a)*d, -20, Math.sin(a)*d);
    parts.push(c);
  }
  const geo = mergeGeos(parts);
  // 根元は深い青、先へ行くほど白く(光が抜ける)
  paintGeo(geo, new THREE.Color(0x1d5f8c), new THREE.Color(0xbfe9ff), 0, lm.h*1.1, 0.12);
  const mat = shared('iceSpire', ()=> new THREE.MeshStandardMaterial({
    vertexColors:true, roughness:0.20, metalness:0.05, envMapIntensity:ENV_INTENSITY*1.6,
    emissive:new THREE.Color(0x2a90d0), emissiveIntensity:0.42, flatShading:true }));
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  placeAt(m, lm.x, lm.y, 30);
  group.add(m);
  // 根元の冷気のにじみ(加算・地面すれすれ)
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(lm.foot*5, lm.foot*5), glowMat('iceGlow', 0x8fdcff, 0.28, getGlowTex()));
  glow.rotation.x = -Math.PI/2;
  glow.userData.keep = true;
  placeAt(glow, lm.x, lm.y, -6);
  group.add(glow);
}

/* ---------------------------------------------------------------------
   家(草原の廃村・凍った高地の野営地)。石の腰壁 + 木組みの上屋 + 張り出した切妻屋根。
   窓と戸口は暗い凹み、煙突を1本。当たりは world.js の2つの円(床面 w×d)。
   --------------------------------------------------------------------- */
function houseGeo(hs){
  const w = hs.w, d = hs.d, h = hs.h, sd = hs.seed;
  const stone = [], wood = [], roof = [], dark = [];
  const baseH = h*0.48;
  const rows = 4, rowH = baseH/rows;
  for(let r=0;r<rows;r++){
    for(const side of [0, 1, 2, 3]){
      const len = (side % 2 === 0) ? w : d;
      const n = Math.max(2, Math.round(len/46));
      for(let i=0;i<n;i++){
        const bw = len/n*(0.94 + hash2(i + r, side + sd)*0.1);
        const b = chipBox(bw, rowH*0.94, 18, sd + r*3.1 + i*1.7 + side, 0.14);
        const t = (i + 0.5 + (r % 2)*0.25)/n - 0.5;
        if(side === 0) b.translate(t*w, rowH*(r + 0.5), d/2);
        else if(side === 2) b.translate(t*w, rowH*(r + 0.5), -d/2);
        else { b.rotateY(Math.PI/2); b.translate((side === 1 ? 1 : -1)*w/2, rowH*(r + 0.5), t*d); }
        stone.push(b);
      }
    }
  }
  for(const [sx, sz, len, rot] of [[0, d/2, w, 0], [0, -d/2, w, 0], [w/2, 0, d, 1], [-w/2, 0, d, 1]]){
    const pnl = new THREE.BoxGeometry(len, h - baseH, 10);
    if(rot) pnl.rotateY(Math.PI/2);
    pnl.translate(sx*0.98, baseH + (h - baseH)/2, sz*0.98);
    wood.push(pnl);
  }
  for(const cx of [-1, 1]) for(const cz of [-1, 1]){
    const post = chipBox(14, h + 6, 14, cx*3 + cz, 0.04); post.translate(cx*w/2, h/2, cz*d/2); wood.push(post);
  }
  for(const cz of [-1, 1]){
    const beam = chipBox(w + 16, 12, 14, cz*5, 0.04); beam.translate(0, h, cz*d/2); wood.push(beam);
    const beam2 = chipBox(w + 12, 10, 12, cz*7, 0.04); beam2.translate(0, baseH, cz*d/2 + cz*4); wood.push(beam2);
  }
  const win = (x, y, ww, hh, z)=>{ const q = new THREE.PlaneGeometry(ww, hh); q.translate(x, y, z); dark.push(q); };
  win(0, baseH*0.45, 38, baseH*0.9, d/2 + 10);
  win(-w*0.30, baseH + (h - baseH)*0.5, 30, 30, d/2 + 6);
  win( w*0.30, baseH + (h - baseH)*0.5, 30, 30, d/2 + 6);
  { const q = new THREE.PlaneGeometry(30, 30); q.rotateY(Math.PI); q.translate(w*0.1, baseH + (h - baseH)*0.5, -d/2 - 6); dark.push(q); }
  const rise = d*0.55, over = 22;
  const slope = Math.hypot(d/2 + over, rise);
  for(const sg of [1, -1]){
    const r = new THREE.BoxGeometry(w + over*2, 9, slope);
    r.rotateX(sg*Math.atan2(rise, d/2 + over));
    r.translate(0, h + rise/2, sg*(d/2 + over)/2);
    roof.push(r);
  }
  for(const sx of [-1, 1]){
    const sh = new THREE.Shape(); sh.moveTo(-d/2, 0); sh.lineTo(d/2, 0); sh.lineTo(0, rise); sh.closePath();
    const t = new THREE.ShapeGeometry(sh); t.rotateY(sx > 0 ? Math.PI/2 : -Math.PI/2); t.translate(sx*w/2*0.99, h, 0);
    wood.push(t);
  }
  const ch = chipBox(26, rise + 50, 26, sd*2.1, 0.12); ch.translate(w*0.28, h + (rise + 50)/2, -d*0.12); stone.push(ch);
  const sg = mergeGeos(stone); paintGeo(sg, new THREE.Color(0x4f4a42), new THREE.Color(0x847c6e), 0, h, 0.35); cavityShade(sg, 0.3, 0.2);
  patchTint(sg, new THREE.Color(0x56703a), 0.35, sd, 0.03);
  const wg = mergeGeos(wood); paintGeo(wg, new THREE.Color(0x4a3524), new THREE.Color(0x7c5c3e), baseH, h + rise, 0.3);
  const rg = mergeGeos(roof); paintGeo(rg, new THREE.Color(0x5a2e22), new THREE.Color(0x8a4a30), h, h + rise, 0.3);
  if(hs.snowy) tintTop(rg, new THREE.Color(0xf1f6ff), h, h + rise, 1.4);
  const dg = mergeGeos(dark); paintSolid(dg, 0x120d09, 0);
  return { stone:sg, wood:wg, roof:rg, dark:dg };
}
function buildHouses(group, world){
  for(const v of (world.volcanoes || [])){
    const hs = v.house;
    if(!hs) continue;
    const g = houseGeo(hs);
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(g.stone, rockMat()));
    grp.add(new THREE.Mesh(g.wood, woodMat()));
    grp.add(new THREE.Mesh(g.roof, woodMat()));
    grp.add(new THREE.Mesh(g.dark, clothMat()));
    grp.children.forEach(o=>{ o.castShadow = true; o.receiveShadow = true; });
    // 長手(ローカルx)を並びの向き ang へ、正面(+z)を通りへ向ける
    placeAt(grp, hs.x, hs.y, 8);
    grp.rotation.y = -hs.ang + (hs.face > 0 ? Math.PI : 0);
    group.add(grp);
  }
}

/* ---------------------------------------------------------------------
   洞窟(尾根をくぐる近道)。地形は細い切り通し(data.js の tunnel の峠)で、その上に岩の天井を架ける。
   天井の上面は両脇の尾根の高さへつなぎ(上から見ても尾根が続いて見える)、下面は低いアーチ。
   入口と出口は岩の断面で閉じる。天井は頭上なので当たり判定は持たない(壁の円は world.js)。
   --------------------------------------------------------------------- */
const TUNNEL_ROOF_LEN = 560, TUNNEL_CEIL = 230, TUNNEL_STEP = 40, TUNNEL_U = 18;
function buildTunnels(group){
  const lay = L(), Rf = lay.relief;
  const geos = [];
  for(const rd of Rf.ridges) for(const gp of rd.gaps){
    if(typeof gp === 'string' || !gp.tunnel) continue;
    const q = lay.passes[gp.p], ax = Math.cos(gp.slot[0]), ay = Math.sin(gp.slot[0]), nx = -ay, ny = ax;
    const Wc = gp.half + gp.blend + 60, inner = gp.half + 18;
    const na = Math.round(TUNNEL_ROOF_LEN/TUNNEL_STEP);
    const P = [], I = [];
    const top = [], bot = [];
    for(let i=0;i<=na;i++){
      const a = -TUNNEL_ROOF_LEN/2 + i*TUNNEL_STEP;
      const g0 = heightAt(q[0] + ax*a, q[1] + ay*a);
      for(let j=0;j<=TUNNEL_U;j++){
        const u = -1 + 2*j/TUNNEL_U, w = u*Wc;
        const x = q[0] + ax*a + nx*w, y = q[1] + ay*a + ny*w;
        const ground = heightAt(x, y);
        // 上面: 両脇は尾根の地面へ埋め、真ん中は天井の厚み(低い所でも尾根の稜線らしく盛る)
        // 入口と出口へ向けて上面を下げ、なだらかな岩の塊にする(箱の断面にしない)
        const endK = Math.min(1, (Math.min(i, na - i)*TUNNEL_STEP)/180);
        const crest = g0 + TUNNEL_CEIL + (60 + 120*endK) + 60*(1 - Math.abs(u))*endK + 50*tileNoise(x*0.01, y*0.01, 16);
        const yt = Math.max(ground + 6, crest);
        // 下面: 切り通しの中は低いアーチ、外は地面の中へ
        const t = Math.abs(w)/inner;
        const yb = t < 1 ? g0 + TUNNEL_CEIL + 40*Math.sqrt(1 - t*t) : ground - 20;
        top.push(P.length/3); P.push(x, yt, y);
        bot.push(P.length/3); P.push(x, Math.min(yb, yt - 20), y);
      }
    }
    const S = TUNNEL_U + 1;
    for(let i=0;i<na;i++) for(let j=0;j<TUNNEL_U;j++){
      const a0 = i*S + j, b0 = a0 + S;
      I.push(top[a0], top[b0], top[a0+1], top[a0+1], top[b0], top[b0+1]);
      I.push(bot[a0], bot[a0+1], bot[b0], bot[a0+1], bot[b0+1], bot[b0]);   // 下向き(中から見上げる面)
    }
    // 入口と出口の断面(上面と下面をつなぐ)
    for(const i of [0, na]) for(let j=0;j<TUNNEL_U;j++){
      const a0 = i*S + j;
      if(i === 0) I.push(top[a0], top[a0+1], bot[a0], top[a0+1], bot[a0+1], bot[a0]);
      else I.push(top[a0], bot[a0], top[a0+1], top[a0+1], bot[a0], bot[a0+1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setIndex(I);
    geos.push(g.toNonIndexed());
  }
  if(!geos.length) return;
  const geo = mergeGeos(geos);
  // 岩のでこぼこ(同じ位置の頂点は同じだけずらす=割れ目を作らない)
  {
    const p = geo.attributes.position;
    for(let i=0;i<p.count;i++){
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n1 = tileNoise(x*0.012 + 3.1, z*0.012, 64) - 0.5, n2 = tileNoise(z*0.012 - 1.7, y*0.012, 64) - 0.5, n3 = tileNoise(y*0.012, x*0.012 + 5.3, 64) - 0.5;
      p.setXYZ(i, x + n1*38, y + n3*26, z + n2*38);
    }
  }
  geo.computeVertexNormals();
  const pos = geo.attributes.position;
  let y0 = Infinity, y1 = -Infinity;
  for(let i=0;i<pos.count;i++){ y0 = Math.min(y0, pos.getY(i)); y1 = Math.max(y1, pos.getY(i)); }
  paintGeo(geo, new THREE.Color(0x4a4438), new THREE.Color(0x8a826c), y0, y1, 0.35);
  cavityShade(geo, 0.4, 0.3);
  const m = new THREE.Mesh(geo, shared('tunnelRock', ()=> applySurfaceDetail(new THREE.MeshStandardMaterial({
    vertexColors:true, roughness:0.96, metalness:0, envMapIntensity:ENV_INTENSITY*0.8, side:THREE.DoubleSide,
  }), { scale:34, bump:0.75, macro:420, stain:0.42, crack:0.30, rough:0.30 })));
  m.castShadow = true; m.receiveShadow = true;
  group.add(m);
}

/* ---------------------------------------------------------------------
   一続きの石壁(遺跡の回廊・村の石垣)。折れ線に沿って、角を落とした石を InstancedMesh で積む
   (壁1本=描画1回)。石は大きさ・回転・色をばらつかせ、上の輪郭は列ごとに崩す。苔は下から上へ
   (石ごとの色)。足元に崩れた石、ところどころに柱(付け柱+柱頭)。抜け(openings)は world.js と同じ関数。
   同じ箱を積んだだけの壁は「立方体の積み木」に見えた(批評家の指摘)。
   --------------------------------------------------------------------- */
const WALL_BL = [48, 84], WALL_BH = [32, 46], WALL_TH = 60;   // 石の長さ・高さの幅・壁の厚み
const WALL_PIER_EVERY = 420;                                   // 付け柱の間隔(回廊=arches の壁だけ)
/* 石の形は4通り。単位の箱を分割し、角を面取りしたうえで、角ごとに違う量だけずらす
   (同じ箱の繰り返しは積み木に見えた)。面の中ほどは少しふくらませて、切り出した石の丸みを出す */
const STONE_VARIANTS = 4;
const stoneGeoCache = [];
function stoneGeo(v){
  if(stoneGeoCache[v]) return stoneGeoCache[v];
  const g = new THREE.BoxGeometry(1, 1, 1, 2, 2, 1);
  const p = g.attributes.position;
  for(let i=0;i<p.count;i++){
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ex = Math.abs(x) > 0.49, ey = Math.abs(y) > 0.49, ez = Math.abs(z) > 0.49;
    const e = (ex ? 1 : 0) + (ey ? 1 : 0) + (ez ? 1 : 0);
    const cham = e === 3 ? 0.90 : (e === 2 ? 0.955 : 1.02);           // 面の中はふくらむ
    const key = v*7.3 + (x < 0 ? 0 : 1)*1.7 + (y < 0 ? 0 : 1)*3.1 + (z < 0 ? 0 : 1)*5.3 + (Math.abs(x) < 0.25 ? 11.1 : 0);
    const jx = 1 + (hash2(key, 1.1) - 0.5)*0.14, jy = 1 + (hash2(key, 2.2) - 0.5)*0.18, jz = 1 + (hash2(key, 3.3) - 0.5)*0.12;
    p.setXYZ(i, x*cham*jx, y*cham*jy, z*cham*jz);
  }
  g.computeVertexNormals();
  const col = new Float32Array(p.count*3).fill(1);
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  stoneGeoCache[v] = g;
  return g;
}
function buildWalls(group){
  const lay = L();
  const isOpen = window.exploreWallOpen;
  const openW = lay.wallOpenW;
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  const cLo = new THREE.Color(0x6a6452), cHi = new THREE.Color(0xa8a088), moss = new THREE.Color(0x4a6630), c = new THREE.Color();
  let wi = 0;
  const all = [];   // 全部の壁の石(形の種類ごとに InstancedMesh を1つ=描画は形の数だけ)
  for(const st of lay.structures){
    if(st.kind !== 'wall') continue;
    wi++;
    const pts = st.pts.map(p=> ({ x:p[0], y:p[1] }));
    if(st.closed) pts.push(pts[0]);
    let total = 0;
    const segs = [];
    for(let i=0;i<pts.length-1;i++){ const a = pts[i], b = pts[i+1], len = Math.hypot(b.x-a.x, b.y-a.y); segs.push({ a, b, len, s0:total }); total += len; }
    const list = [];   // [x, y(上), z, 長さ, 高さ, 厚み, 向き, 傾き, 苔の強さ, 明るさ]
    const put = (x, y, z, l, h, d, yaw, tilt, mk, lum)=> list.push([x, y, z, l, h, d, yaw, tilt, mk, lum]);
    let rnd = wi*97 + 1;
    const R = ()=> hash2(rnd++, wi*3.7);
    for(const sg of segs){
      const ux = (sg.b.x - sg.a.x)/sg.len, uy = (sg.b.y - sg.a.y)/sg.len, yaw = -Math.atan2(uy, ux);
      // 列(水平方向の区切り)ごとに高さを決め、段ごとに石の継ぎ目をずらして積む
      const COL = 64;
      const nCol = Math.max(1, Math.round(sg.len/COL));
      for(let ci=0; ci<nCol; ci++){
        const s0 = sg.s0 + ci*sg.len/nCol, s1 = sg.s0 + (ci + 1)*sg.len/nCol, sMid = (s0 + s1)/2;
        const open = isOpen ? isOpen(st, sMid, total) : false;
        const qq = sMid*0.011;
        const hk = 0.55 + 0.45*(0.5 + 0.5*Math.sin(qq*1.7 + st.pts.length))*(0.7 + 0.3*Math.sin(qq*4.3));
        const crumble = Math.sin(qq*2.3 + 1.1) > 0.93 ? 0.35 : 1;
        let wallH = (st.h[0] + (st.h[1] - st.h[0])*hk)*crumble;
        wallH *= 0.82 + 0.3*R();                               // 上の輪郭を列ごとに崩す
        let archFloor = 0;
        if(open){
          if(!st.arches) continue;
          let off = openW;
          for(const f of (st.openings || [])) off = Math.min(off, Math.abs(sMid - f*total));
          const k = Math.min(1, off/(openW*0.5));
          archFloor = 150 + 70*Math.sqrt(Math.max(0, 1 - k*k));
          wallH = Math.max(wallH, archFloor + 90);
        }
        const window_ = !open && wallH > 190 && ((ci + Math.round(sg.s0/COL)) % 5 === 2);
        // 石の裏の芯(石の隙間から向こうが透けないように。少し暗い)。窓とアーチの下は空ける
        {
          const t = (sMid - sg.s0)/sg.len, x = sg.a.x + (sg.b.x - sg.a.x)*t, z = sg.a.y + (sg.b.y - sg.a.y)*t, gz = heightAt(x, z);
          const spans = open ? [[archFloor + 20, wallH - 20]] : (window_ ? [[0, 100], [175, wallH - 20]] : [[0, wallH - 20]]);
          for(const [a0, a1] of spans){
            if(a1 - a0 < 20) continue;
            put(x, gz + (a0 + a1)/2 - 10, z, (s1 - s0)*1.0, a1 - a0, WALL_TH*0.82, yaw, 0, Math.max(0, 1 - a0/220)*0.5, 0.95);
          }
        }
        let y = 0, row = 0;
        while(y < wallH - 8){
          const bh = WALL_BH[0] + (WALL_BH[1] - WALL_BH[0])*R();
          if(!(open && y < archFloor) && !(window_ && y > 100 && y < 175)){
            // この列の中に、段ごとにずらした継ぎ目で1〜2個の石
            const shift = (row % 2) ? 0.5 : 0;
            const n2 = (R() > 0.55) ? 2 : 1;
            for(let k=0;k<n2;k++){
              const f0 = (k + shift*(n2 === 1 ? 0 : 1)*0.3)/n2, f1 = (k + 1)/n2;
              const sa = s0 + (s1 - s0)*f0, sb = s0 + (s1 - s0)*f1, sm = (sa + sb)/2;
              const t = (sm - sg.s0)/sg.len;
              const x = sg.a.x + (sg.b.x - sg.a.x)*t, z = sg.a.y + (sg.b.y - sg.a.y)*t;
              const gz = heightAt(x, z);
              const len = Math.min(WALL_BL[1], Math.max(WALL_BL[0], (sb - sa)*(0.96 + R()*0.1)));
              const top = y + bh > wallH - 12;
              const tilt = top ? (R() - 0.5)*0.35 : (R() - 0.5)*0.05;   // 上の石はずれて傾く
              const off = (R() - 0.5)*(top ? 12 : 2.5);
              const mk = Math.max(0, Math.min(1, 1 - (y + bh*0.5)/220))*(0.55 + 0.4*tileNoise(x*0.004, z*0.004, 16)) + (top ? 0.25*R() : 0);
              put(x - uy*off, gz + y + bh/2 - 10, z + ux*off, len, bh*1.0, WALL_TH*(0.95 + R()*0.08), yaw + (R() - 0.5)*0.025, tilt, mk*0.85, 0.85 + R()*0.3);
            }
          }
          y += bh; row++;
        }
        // 足元の崩れた石(壁の両側。低く、傾いて半分埋まる)
        const nr = R() > 0.45 ? 1 + Math.floor(R()*2.5) : 0;
        for(let r=0;r<nr;r++){
          const side = R() > 0.5 ? 1 : -1, t = (sMid - sg.s0)/sg.len + (R() - 0.5)*0.6*COL/sg.len;
          const x = sg.a.x + (sg.b.x - sg.a.x)*t - uy*side*(WALL_TH*0.6 + 18 + R()*50);
          const z = sg.a.y + (sg.b.y - sg.a.y)*t + ux*side*(WALL_TH*0.6 + 18 + R()*50);
          const sz = 22 + R()*30;
          put(x, heightAt(x, z) + sz*0.2, z, sz*1.4, sz*0.8, sz, R()*6.28, (R() - 0.5)*0.8, 0.5 + 0.4*R(), 0.8 + R()*0.3);
        }
      }
      // 付け柱と柱頭(回廊の壁)。壁より少し高く・厚い石の柱に、張り出した柱頭を載せる
      if(st.arches){
        for(let sp = WALL_PIER_EVERY*0.5; sp < sg.len; sp += WALL_PIER_EVERY){
          const s = sg.s0 + sp;
          if(isOpen && isOpen(st, s, total)) continue;
          const x = sg.a.x + ux*sp, z = sg.a.y + uy*sp, gz = heightAt(x, z);
          const H = st.h[1]*(0.9 + 0.2*R());
          let y = 0;
          while(y < H){ const bh = 42 + R()*10; put(x, gz + y + bh/2 - 10, z, 74, bh*0.97, WALL_TH*1.5, yaw + (R() - 0.5)*0.04, 0, Math.max(0, 1 - y/240)*0.7, 0.9 + R()*0.2); y += bh; }
          put(x, gz + y + 4, z, 104, 22, WALL_TH*1.9, yaw, 0, 0.35, 1.05);          // 柱頭(張り出し)
          put(x, gz + y + 22, z, 88, 14, WALL_TH*1.7, yaw, 0, 0.45, 0.95);
        }
      }
    }
    for(const v of list) all.push(v);
  }
  if(!all.length) return;
  const buckets = [];
  for(let k=0;k<STONE_VARIANTS;k++) buckets.push([]);
  all.forEach((v, n)=> buckets[Math.floor(hash2(n, 5.9)*STONE_VARIANTS) % STONE_VARIANTS].push(v));
  buckets.forEach((list, k)=>{
    if(!list.length) return;
    const im = new THREE.InstancedMesh(stoneGeo(k), rockMat(), list.length);
    list.forEach((v, n)=>{
      e3.set(v[7], v[6], v[7]*0.4, 'YXZ');
      q.setFromEuler(e3);
      pos.set(v[0], v[1], v[2]); sc.set(v[3], v[4], v[5]);
      mtx.compose(pos, q, sc);
      im.setMatrixAt(n, mtx);
      c.copy(cLo).lerp(cHi, 0.5 + (v[9] - 1)*1.6).lerp(moss, Math.min(0.85, v[8]));
      im.setColorAt(n, c);
    });
    im.instanceMatrix.needsUpdate = true;
    if(im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    im.userData.keep = true;   // 焼き込み(bakeStatic)の対象にしない
    group.add(im);
  });
}

/* ---------------------------------------------------------------------
   密林の巨木。幹(板根付き)・樹冠・垂れる蔦を InstancedMesh で(種類ごとに描画1回)。
   樹冠は頭上900〜1400で、見上げると空をふさぐ天井になる。足元には木漏れ日の影を乗算で。
   --------------------------------------------------------------------- */
let vineTex = null, dappleTex = null;
/* 垂れる蔦の葉(手続き生成)。1本の蔓がうねり、大きさ・向き・色の違う葉が不揃いに付く。
   等間隔の丸い粒を並べると「ビーズのすだれ」に見えた。縦方向は繰り返せる(長さで伸ばさない) */
function getVineTex(){
  if(vineTex) return vineTex;
  vineTex = canvasTex(128, 512, (g, w, h)=>{
    g.clearRect(0, 0, w, h);
    const sx = (y)=> w*0.5 + Math.sin(y/h*Math.PI*2*2)*w*0.10 + Math.sin(y/h*Math.PI*2*5 + 1.3)*w*0.04;
    g.strokeStyle = 'rgba(58,78,30,1)'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(sx(0), 0);
    for(let y=4;y<=h;y+=4) g.lineTo(sx(y), y);
    g.stroke();
    let y = 6, k = 0;
    while(y < h - 6){
      const side = (k % 2) ? 1 : -1;
      const L = 16 + hash2(k, 1.7)*22, W = 7 + hash2(k, 3.1)*7;
      const ang = side*(0.5 + hash2(k, 5.3)*0.7) + Math.PI/2;
      const x = sx(y);
      const gcol = 70 + Math.floor(hash2(k, 7.7)*70), rcol = 40 + Math.floor(hash2(k, 8.8)*40);
      g.fillStyle = 'rgba(' + rcol + ',' + gcol + ',' + (25 + Math.floor(hash2(k, 9.9)*25)) + ',1)';
      g.save(); g.translate(x + side*L*0.45*Math.cos(ang - Math.PI/2), y); g.rotate(ang);
      g.beginPath(); g.ellipse(0, 0, L*0.5, W*0.5, 0, 0, Math.PI*2); g.fill();
      // 葉脈(少し明るい線)
      g.strokeStyle = 'rgba(' + (rcol + 40) + ',' + (gcol + 40) + ',60,0.8)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(-L*0.45, 0); g.lineTo(L*0.45, 0); g.stroke();
      g.restore();
      // 間隔は不揃いに。ときどき葉が固まる
      y += 7 + hash2(k, 11.1)*18 * (hash2(Math.floor(k/5), 2.2) > 0.6 ? 0.5 : 1);
      k++;
    }
    // 透けた所の色は葉の色に寄せておく(縁がにじんでも白く光らない)
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for(let q=0;q<d.length;q+=4) if(d[q+3] === 0){ d[q] = 60; d[q+1] = 95; d[q+2] = 35; }
    g.putImageData(img, 0, 0);
  }, true);
  vineTex.wrapT = THREE.RepeatWrapping;
  return vineTex;
}
function getDappleTex(){
  if(dappleTex) return dappleTex;
  dappleTex = canvasTex(256, 256, (g, w, h)=>{
    const img = g.createImageData(w, h), d = img.data;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const u = x/w - 0.5, v = y/h - 0.5, r = Math.hypot(u, v)*2;
      const n = tileNoise(x/16, y/16, 16)*0.6 + tileNoise(x/7, y/7, 37)*0.4;
      const spot = n > 0.62 ? 1 : 0.58 + (n - 0.3)*0.4;
      const edge = Math.min(1, Math.max(0, (r - 0.72)/0.28));
      const k = Math.max(0, Math.min(1, spot + edge*(1 - spot)));
      const i = (y*w + x)*4;
      d[i] = d[i+1] = d[i+2] = Math.round(k*255); d[i+3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, false);
  return dappleTex;
}
function giantTrunkGeo(){
  // 単位空間: 幹の根元の半径0.78(判定の円=1の内側)、高さ1。板根は半径1.12・高さ0.075まで
  const trunk = new THREE.CylinderGeometry(0.42, 0.78, 1, 12, 9, false);
  const p = trunk.attributes.position;
  for(let i=0;i<p.count;i++){
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = y + 0.5, a = Math.atan2(z, x);
    const groove = 1 - 0.09*Math.pow(Math.abs(Math.sin(a*5 + t*3)), 3);
    const bulge = 1 + 0.05*Math.sin(t*9 + a*2);
    const r = Math.hypot(x, z)*groove*bulge;
    p.setXYZ(i, Math.cos(a + t*0.25)*r, t, Math.sin(a + t*0.25)*r);
  }
  trunk.computeVertexNormals();
  const parts = [trunk];
  for(let k=0;k<6;k++){
    const a = k/6*Math.PI*2 + 0.3;
    const fin = new THREE.BufferGeometry();
    const h0 = 0.075, r0 = 0.62, r1 = 1.12, th = 0.05;
    const P = (r, y, s)=> [Math.cos(a)*r - Math.sin(a)*s, y, Math.sin(a)*r + Math.cos(a)*s];
    const A = P(r0, h0, -th), B = P(r0, h0, th), C = P(r1, 0, -th*0.4), D = P(r1, 0, th*0.4), E = P(r0, -0.02, -th), F = P(r0, -0.02, th);
    fin.setAttribute('position', new THREE.Float32BufferAttribute([...A, ...C, ...E, ...B, ...F, ...D, ...A, ...B, ...D, ...A, ...D, ...C], 3));
    fin.computeVertexNormals();
    parts.push(fin);
  }
  const g = mergeGeos(parts);
  paintGeo(g, new THREE.Color(0x3a2c1e), new THREE.Color(0x7a6448), 0, 1, 0.3);
  patchTint(g, new THREE.Color(0x3f6428), 0.55, 1.3, 3.0);
  return g;
}
function giantCanopyGeo(){
  // 単位空間: 半径1・中心y=0。見上げる下面が主役なので、塊を平たく広げる
  const parts = [];
  for(let i=0;i<24;i++){
    const a = i*2.399963, rr = Math.sqrt((i + 0.5)/24);
    const b = new THREE.IcosahedronGeometry(1, 0);   // 平らな面の塊(低ポリの葉叢)。細かくしても遠目は同じ
    const sz = 0.30 + hash2(i, 3.3)*0.16;
    b.scale(sz, sz*0.82, sz);
    b.translate(Math.cos(a)*rr*0.80, (hash2(i, 5.1) - 0.3)*0.40 + (1 - rr)*0.25, Math.sin(a)*rr*0.80);
    parts.push(b);
  }
  for(let k=0;k<5;k++){
    const a = k/5*Math.PI*2 + 0.5;
    const pts = [new THREE.Vector3(0, -0.9, 0), new THREE.Vector3(Math.cos(a)*0.25, -0.45, Math.sin(a)*0.25), new THREE.Vector3(Math.cos(a)*0.62, -0.05, Math.sin(a)*0.62)];
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 5, 0.05, 4, false));
  }
  const g = mergeGeos(parts);
  paintGeo(g, new THREE.Color(0x10240c), new THREE.Color(0x3f6a22), -0.35, 0.55, 0.35);
  cavityShade(g, 0.3, 0.3);
  return g;
}
/* 垂れる蔦: 枝から垂れる、曲がった帯(5枚の板をつないだ細い帯を十字に2本)。
   長さは不揃い・本数は控えめ。縦の模様は長さに合わせて繰り返す(伸ばさない) */
const VINE_N = 9, VINE_SEGS = 5, VINE_W = 0.11, VINE_TILE = 0.55;
function giantVineGeo(){
  const parts = [];
  for(let i=0;i<VINE_N;i++){
    const a = i*2.399963 + 0.4, rr = 0.30 + hash2(i, 9.1)*0.50;
    const len = 0.45 + Math.pow(hash2(i, 3.7), 1.5)*1.25;
    const bend = (hash2(i, 5.5) - 0.5)*0.35, sway = (hash2(i, 6.6) - 0.5)*0.25;
    for(const rot of [0, Math.PI/2]){
      const q = new THREE.PlaneGeometry(VINE_W, len, 1, VINE_SEGS);
      const p = q.attributes.position, uv = q.attributes.uv;
      for(let v=0; v<p.count; v++){
        const y = p.getY(v), t = 0.5 - y/len;            // 0=付け根 / 1=先
        // 付け根から先へ、重さでたわんで外へ流れる
        p.setXYZ(v, p.getX(v) + bend*t*t*len, -t*len - 0.18, sway*t*t*len);
        uv.setY(v, (1 - t)*len/VINE_TILE);
      }
      q.rotateY(a + rot);
      q.translate(Math.cos(a)*rr, 0, Math.sin(a)*rr);
      parts.push(q);
    }
  }
  const g = mergeGeos(parts);
  g.computeVertexNormals();
  return g;
}
const GIANT_CHUNK = 3000;   // 巨木を描き分ける区画の一辺
function buildGiants(group, world){
  const list = (world.volcanoes || []).filter(v=> v.giant);
  if(!list.length) return;
  const bark = shared('giantBark', ()=> applySurfaceDetail(new THREE.MeshStandardMaterial({
    vertexColors:true, roughness:0.95, metalness:0, envMapIntensity:ENV_INTENSITY*0.6 }),
    { scale:14, bump:0.6, macro:300, stain:0.22, crack:0.26, rough:0.24 }));
  const leaf = shared('giantLeaf', ()=> new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.9, metalness:0,
    envMapIntensity:ENV_INTENSITY*0.55, flatShading:true }));
  const vine = shared('giantVine', ()=> new THREE.MeshStandardMaterial({ map:getVineTex(), alphaTest:0.45, side:THREE.DoubleSide,
    roughness:0.85, metalness:0, envMapIntensity:ENV_INTENSITY*1.2 }));
  /* 区画(GIANT_CHUNK)ごとに InstancedMesh を分ける。1つにまとめると外接球が密林全体になり、
     峡谷やキャンプから見ても(影の計算でも)全部の木を描いていた。 */
  const geoT = giantTrunkGeo(), geoC = giantCanopyGeo(), geoV = giantVineGeo();
  const chunks = new Map();
  for(const v of list){
    const key = Math.floor(v.x/GIANT_CHUNK) + ',' + Math.floor(v.y/GIANT_CHUNK);
    if(!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(v);
  }
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const decal = [];
  for(const part of chunks.values()){
    const k = part.length;
    const trunkM = new THREE.InstancedMesh(geoT, bark, k);
    const canM = new THREE.InstancedMesh(geoC, leaf, k);
    const vineM = new THREE.InstancedMesh(geoV, vine, k);
    part.forEach((v, i)=>{
      const G = v.giant, H = G.h, f = G.foot;
      const gy = Math.min(heightAt(v.x - f, v.y), heightAt(v.x + f, v.y), heightAt(v.x, v.y - f), heightAt(v.x, v.y + f)) - 10;
      q.setFromAxisAngle(up, G.seed*1.7);
      pos.set(v.x, gy, v.y); sc.set(f, H, f);
      mtx.compose(pos, q, sc); trunkM.setMatrixAt(i, mtx);
      const cr = H*(0.46 + (G.seed % 1)*0.12);
      pos.set(v.x, gy + H*0.97, v.y); sc.set(cr, cr*0.62, cr);
      mtx.compose(pos, q, sc); canM.setMatrixAt(i, mtx); vineM.setMatrixAt(i, mtx);
      decal.push({ v, R:cr*1.15, ox:0.25*cr, oy:0.18*cr, rings:5, segs:20 });
    });
    [trunkM, canM, vineM].forEach(m=>{ m.instanceMatrix.needsUpdate = true; m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); });
    vineM.castShadow = false;
    group.add(trunkM, canM, vineM);
  }
  // 木漏れ日(乗算)をまとめて1枚に。樹冠の下、太陽の反対側へ少しずらす
  const P = [], UV = [], I = [];
  for(const dc of decal){
    const o = P.length/3;
    for(let r=0;r<=dc.rings;r++) for(let s2=0;s2<=dc.segs;s2++){
      const rr = dc.R*r/dc.rings, a = s2/dc.segs*Math.PI*2;
      const x = dc.v.x + dc.ox + Math.cos(a)*rr, y = dc.v.y + dc.oy + Math.sin(a)*rr;
      P.push(x, heightAt(x, y) + 2.5, y);
      UV.push(0.5 + Math.cos(a)*r/dc.rings*0.5, 0.5 + Math.sin(a)*r/dc.rings*0.5);
    }
    for(let r=0;r<dc.rings;r++) for(let s2=0;s2<dc.segs;s2++){
      const a0 = o + r*(dc.segs+1) + s2, b0 = a0 + dc.segs + 1;
      I.push(a0, b0, a0+1, a0+1, b0, b0+1);
    }
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  dg.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  dg.setIndex(I);
  faceUp(dg);
  const dm = shared('dapple', ()=>{
    const m = new THREE.MeshBasicMaterial({ map:getDappleTex(), transparent:true, blending:THREE.MultiplyBlending,
      depthWrite:false, fog:false, side:THREE.DoubleSide, polygonOffset:true, polygonOffsetFactor:-3, polygonOffsetUnits:-6 });
    m.toneMapped = false; return m;
  });
  const dmesh = new THREE.Mesh(dg, dm);
  dmesh.renderOrder = 1;
  group.add(dmesh);
}

/* ---------------------------------------------------------------------
   溶岩: 川(帯)・溜まりの光のにじみ
   --------------------------------------------------------------------- */
/* 地面に貼る面の巻き方を上向きにそろえる(下向きの三角形は片面の材質で裏から消える)。
   頂点を並べた順番に依らず、三角形ごとに法線のyを見て裏返っている物だけ入れ替える。 */
function faceUp(g){
  const ix = g.index.array, p = g.attributes.position.array;
  for(let t=0;t<ix.length;t+=3){
    const a = ix[t]*3, b = ix[t+1]*3, c = ix[t+2]*3;
    const ux = p[b]-p[a], uz = p[b+2]-p[a+2], vx = p[c]-p[a], vz = p[c+2]-p[a+2];
    if(uz*vx - ux*vz < 0){ const k = ix[t+1]; ix[t+1] = ix[t+2]; ix[t+2] = k; }
  }
  g.computeVertexNormals();
  return g;
}
/* 地面に沿わせた円盤・輪(溶岩の照り返し・地殻の縁)。中心から外へ rs[] の半径の輪を張り、
   各頂点の高さは地形の高さ+lift[]。uv は円盤の中心=0.5 から外へ(照り返しの丸いテクスチャ用) */
function drapedRing(x0, y0, R, rs, lifts, segs, wob, col){
  const P = [], UV = [], C = [], I = [];
  const n = rs.length;
  for(let r=0;r<n;r++) for(let k=0;k<=segs;k++){
    const a = k/segs*Math.PI*2;
    const w = 1 + (wob || 0)*(0.55*Math.sin(a*3 + x0*0.01) + 0.3*Math.sin(a*7 + y0*0.01) + 0.15*Math.sin(a*13));
    const rr = R*rs[r]*w, x = x0 + Math.cos(a)*rr, y = y0 + Math.sin(a)*rr;
    P.push(x, heightAt(x, y) + lifts[r], y);
    UV.push(0.5 + Math.cos(a)*rs[r]/rs[n-1]*0.5, 0.5 + Math.sin(a)*rs[r]/rs[n-1]*0.5);
    if(col) C.push(...col(r, k, x, y));
  }
  for(let r=0;r<n-1;r++) for(let k=0;k<segs;k++){
    const a0 = r*(segs+1) + k, b0 = a0 + segs + 1;
    I.push(a0, b0, a0+1, a0+1, b0, b0+1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  if(col) g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  return faceUp(g);
}
// 冷えて黒くなった溶岩の殻の色(火山の岩の色から)。縁ほど黒く、内側はわずかに赤い
const _crust = new THREE.Color(), _ember = new THREE.Color(0x6a2410);
function crustColor(t, jit){
  _crust.copy(exploreRegionColors('steep')[2]).multiplyScalar(0.55 + 0.25*jit).lerp(_ember, Math.max(0, 0.35 - t*0.5));
  return [_crust.r, _crust.g, _crust.b];
}
/* 溶岩: 川(帯)・縁の盛り上がった黒い殻・照り返し・陽炎。
   川の頂点は40単位ごとに取り直して地形の高さへ沿わせる(粗いと斜面から浮いた板に見えた) */
const LAVA_STEP = 40;
function buildLavaRiver(group, world){
  const raw = (world.lava || []).filter(z=> z.lavaRiver);
  if(raw.length < 2) return;
  const chain = [];
  for(let i=0;i<raw.length-1;i++){
    const a = raw[i], b = raw[i+1], n = Math.max(1, Math.ceil(Math.hypot(b.x-a.x, b.y-a.y)/LAVA_STEP));
    for(let k=0;k<n;k++){ const t = k/n; chain.push({ x:a.x + (b.x-a.x)*t, y:a.y + (b.y-a.y)*t, radius:a.radius + (b.radius-a.radius)*t }); }
  }
  chain.push(raw[raw.length-1]);
  const prof = [-1.34, -1.12, -0.92, -0.6, -0.3, 0, 0.3, 0.6, 0.92, 1.12, 1.34];
  // 岸: 川の外側に盛り上がった黒い殻の土手(内→外)
  const bank = [1.02, 1.10, 1.21, 1.36], bankLift = [3.0, 10, 7, 0.5];
  const P = [], Rr = [], UV = [], I = [];
  const BP = [], BC = [], BI = [];
  const C = prof.length, BN = bank.length;
  chain.forEach((p, i)=>{
    const a = chain[Math.max(0, i-1)], b = chain[Math.min(chain.length-1, i+1)];
    let dx = b.x - a.x, dy = b.y - a.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const wob = 1 + 0.10*Math.sin(i*0.37) + 0.06*Math.sin(i*1.13);
    for(let k=0;k<C;k++){
      const sK = prof[k];
      const x = p.x - dy*p.radius*sK*wob, y = p.y + dx*p.radius*sK*wob;
      P.push(x, heightAt(x, y) + 2.5, y);
      Rr.push(Math.abs(sK));
      UV.push(x/300, y/300);
    }
    for(const side of [-1, 1]) for(let k=0;k<BN;k++){
      const w2 = bank[k]*(1 + 0.12*Math.sin(i*0.61 + side*2 + k));
      const x = p.x - dy*p.radius*w2*wob*side, y = p.y + dx*p.radius*w2*wob*side;
      BP.push(x, heightAt(x, y) + bankLift[k]*(0.8 + 0.4*hash2(i, k + side)), y);
      BC.push(...crustColor(k/(BN-1), tileNoise(x*0.02, y*0.02, 64)*0.7 + hash2(i*3 + k, side)*0.3));
    }
  });
  for(let i=0;i<chain.length-1;i++){
    for(let k=0;k<C-1;k++){ const a0 = i*C + k, b0 = a0 + C; I.push(a0, b0, a0+1, a0+1, b0, b0+1); }
    for(let sd=0; sd<2; sd++) for(let k=0;k<BN-1;k++){
      const a0 = i*BN*2 + sd*BN + k, b0 = a0 + BN*2;
      BI.push(a0, b0, a0+1, a0+1, b0, b0+1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aRad', new THREE.Float32BufferAttribute(Rr, 1));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I);
  faceUp(g);
  const m = new THREE.Mesh(g, zoneMaterial('lava'));
  m.renderOrder = 1;
  group.add(m);
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(BP, 3));
  bg.setAttribute('color', new THREE.Float32BufferAttribute(BC, 3));
  bg.setIndex(BI);
  faceUp(bg);
  const bm = new THREE.Mesh(bg, rockMat());
  bm.receiveShadow = true;
  group.add(bm);
}
/* 溜まりの縁: 冷えて盛り上がった黒い殻の輪(溜まりが地面に貼った板に見えないように) */
function buildLavaRims(group, world){
  const geos = [];
  for(const z of (world.lava || [])){
    if(z.lavaRiver || z.crater) continue;
    const segs = 48;
    geos.push(drapedRing(z.x, z.y, z.radius, [0.97, 1.05, 1.15, 1.30], [2.5, 10, 7, 0.5], segs, 0.07,
      (r, k, x, y)=> crustColor(r/3, tileNoise(x*0.02, y*0.02, 64)*0.7 + hash2(k, r)*0.3)));
  }
  if(!geos.length) return;
  const m = new THREE.Mesh(mergeGeos(geos), rockMat());
  m.receiveShadow = true;
  group.add(m);
}
/* 照り返し(地面に沿わせた加算の円盤)と陽炎(溜まりの上に立つ、揺らめく薄い板) */
let hazeTex = null;
function getHazeTex(){
  if(hazeTex) return hazeTex;
  hazeTex = canvasTex(64, 128, (g, w, h)=>{
    const img = g.createImageData(w, h), d = img.data;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const u = x/w, v = y/h;
      const side = Math.sin(u*Math.PI);
      const up = Math.pow(v, 1.6);                                   // 下(地面)ほど濃い
      const wave = 0.65 + 0.35*Math.sin(v*40 + Math.sin(u*9)*2);     // 揺らめく縞
      const k = side*up*wave;
      const i = (y*w + x)*4;
      d[i] = 255*k; d[i+1] = 150*k; d[i+2] = 70*k; d[i+3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, true);
  hazeTex.wrapT = THREE.RepeatWrapping;
  return hazeTex;
}
function buildLavaGlow(group, world, anim){
  const mat = glowMat('lavaGlow', 0xff6a1e, 0.36, getGlowTex());
  const hazeMat = shared('lavaHaze', ()=>{
    const m = new THREE.MeshBasicMaterial({ map:getHazeTex(), transparent:true, opacity:0.12, blending:THREE.AdditiveBlending,
                                            depthWrite:false, side:THREE.DoubleSide, fog:false });
    m.toneMapped = false; return m;
  });
  const glow = [];
  let k = 0;
  for(const z of (world.lava || [])){
    if(z.lavaRiver && (k++ % 4) !== 0) continue;
    const r = z.radius*(z.lavaRiver ? 3.0 : 2.3);
    glow.push(drapedRing(z.x, z.y, r, [0, 0.35, 0.7, 1.0], [6, 6, 5, 4], 32, 0));
    if(z.crater) continue;
    // 陽炎: 溜まりの幅の縦の板。カメラへ向ける(噴煙と同じ扱い)
    const hw = z.radius*(z.lavaRiver ? 1.3 : 1.1), hh = 140 + z.radius*0.35;
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(hw*2, hh), hazeMat);
    pl.geometry.translate(0, hh/2, 0);
    placeAt(pl, z.x, z.y, 10);
    pl.userData.keep = true;
    group.add(pl);
    if(anim) anim.haze.push(pl);
  }
  if(glow.length){
    const gm = new THREE.Mesh(mergeGeos(glow), mat);
    gm.renderOrder = 2;
    group.add(gm);
  }
}

/* ---------------------------------------------------------------------
   凍った湖: 水面の上に、ひびの入った氷の板と白い縁を張る(凍った高地の湖だけ)
   --------------------------------------------------------------------- */
let crackTex = null;
const ICE_LIFT = 24;   // 水面(ZONE_LIFT)より上に張る。下だと水面が氷を覆って見えない
/* 氷のひび。不揃いな少数の割れ目だけ(細胞の境目を全部線にすると、六角タイルを敷いたように見えた)。
   境目ごとに乱数で描く/描かないを決め、太さも変える。下地は霜のむら */
const ICE_TILE = 1100;   // ひびの模様の一辺(ワールド単位。湖1つにほぼ1枚)
function getCrackTex(){
  if(crackTex) return crackTex;
  crackTex = canvasTex(256, 256, (g, w, h)=>{
    const img = g.createImageData(w, h), d = img.data;
    const N = 9, P = [];
    for(let i=0;i<N;i++) P.push([hash2(i, 1.1)*w, hash2(i, 2.3)*h]);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      let f1 = 1e9, f2 = 1e9, i1 = 0, i2 = 0;
      for(let q=0;q<N;q++) for(let ox=-1;ox<=1;ox++) for(let oy=-1;oy<=1;oy++){
        const dd = Math.hypot(x - P[q][0] - ox*w, y - P[q][1] - oy*h);
        if(dd < f1){ f2 = f1; i2 = i1; f1 = dd; i1 = q; } else if(dd < f2){ f2 = dd; i2 = q; }
      }
      const a = Math.min(i1, i2), b = Math.max(i1, i2);
      const on = hash2(a*13 + b, 4.4);                       // この境目を描くか
      const wid = 0.5 + hash2(a + b*7, 6.6)*1.3;
      const wob = (tileNoise(x/16, y/16, 16) - 0.5)*1.6;       // 線を少しうねらせる
      const crack = on > 0.55 ? Math.max(0, 1 - Math.abs(f2 - f1 + wob)/wid) : 0;
      const frost = tileNoise(x/32, y/32, 8)*0.6 + tileNoise(x/8, y/8, 32)*0.4;
      const i = (y*w + x)*4;
      const k = 1 - crack*0.5 - (frost - 0.5)*0.12;
      d[i] = 222*k; d[i+1] = 236*k; d[i+2] = 246*k; d[i+3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, true);
  crackTex.wrapS = crackTex.wrapT = THREE.RepeatWrapping;
  crackTex.anisotropy = 4;
  return crackTex;
}
/* 凍った湖: 水面の上に氷の板を張る(凍った高地の湖だけ)。縁はノイズで透かして雪へ溶かし、
   岸から離れるほど深い青。空は環境光の映り込み(つやのある材質)で出す */
function buildIceLakes(group, world){
  for(const z of (world.oasis || [])){
    const w = exploreWeights(z.x, z.y);
    if(w[1] < 0.5) continue;
    const rings = 10, segs = 96, P = [], C = [], UV = [], I = [];
    const EXT = 1.12;
    for(let r=0;r<=rings;r++) for(let s2=0;s2<=segs;s2++){
      const a = s2/segs*Math.PI*2;
      const t = r/rings;
      const x0 = z.x + Math.cos(a)*z.radius, y0 = z.y + Math.sin(a)*z.radius;
      // 縁の揺らぎは低い周波数+細かいノイズ(きれいな多角形にしない)
      const wob = 1 + 0.07*Math.sin(a*3 + z.x*0.001) + 0.04*Math.sin(a*7 + 1.3) + 0.05*(tileNoise(x0*0.004, y0*0.004, 16) - 0.5);
      const rr = z.radius*EXT*wob*t;
      const x = z.x + Math.cos(a)*rr, y = z.y + Math.sin(a)*rr;
      P.push(x, heightAt(x, y) + ICE_LIFT, y);
      UV.push(x/ICE_TILE, y/ICE_TILE);
      const n = tileNoise(x*0.006, y*0.006, 16) - 0.5;
      const deep = 1 - Math.min(1, Math.pow(t/0.9, 1.6));    // 中ほど深い青
      const edge = Math.pow(Math.max(0, (t - 0.72)/0.28), 1.5); // 岸ほど白く雪が吹き寄せる
      const alpha = 1 - Math.max(0, Math.min(1, (t - (0.84 + n*0.10))/0.14));
      C.push(0.22 + 0.50*(1 - deep) + edge*0.30, 0.44 + 0.38*(1 - deep) + edge*0.22, 0.76 + 0.18*(1 - deep) + edge*0.10, alpha);
    }
    for(let r=0;r<rings;r++) for(let s2=0;s2<segs;s2++){
      const a0 = r*(segs+1) + s2, b0 = a0 + segs + 1;
      I.push(a0, b0, a0+1, a0+1, b0, b0+1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    g.setIndex(I);
    faceUp(g);
    const mat = shared('ice', ()=> new THREE.MeshStandardMaterial({ name:'exIce', map:getCrackTex(), vertexColors:true, transparent:true,
      roughness:0.30, metalness:0.0, envMapIntensity:ENV_INTENSITY*1.0, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-4 }));
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = 4;
    m.receiveShadow = true;
    m.userData.keep = true;
    group.add(m);
  }
}

/* 降る灰(火山の上だけ見える)。カメラのまわりの箱の中で落とし、下へ抜けたら上へ戻す */
const ASH_N = 300, ASH_BOX = 1400;
function buildAsh(){
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(ASH_N*3);
  for(let i=0;i<ASH_N;i++){ p[i*3] = (hash2(i, 1.7) - 0.5)*ASH_BOX*2; p[i*3+1] = hash2(i, 3.1)*700; p[i*3+2] = (hash2(i, 5.3) - 0.5)*ASH_BOX*2; }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({ color:0x2e2622, size:5, sizeAttenuation:true, transparent:true, opacity:0, depthWrite:false });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

/* ---------------------------------------------------------------------
   入口(real3d.js から)
   --------------------------------------------------------------------- */
let anim = null, farTerrain = null;
export function buildExploreWorld(group, world){
  const lay = L();
  if(!lay) return;
  mergeMountains(group);
  mergeZones(group);
  anim = { flames:[], fireGlow:[], beacons:[], banners:[], plumes:[], haze:[], ash:null };
  // 地形パッチの外(マップ全体+外周の山)を覆う遠景の地面。描画1回
  farTerrain = buildFarTerrain();
  group.add(farTerrain);
  const lg = new THREE.Group();
  buildCamp(lg, anim);
  for(const lm of lay.landmarks){
    if(lm.kind === 'arch') buildArch(lg, lm);
    else if(lm.kind === 'tower') buildTower(lg, lm);
    else if(lm.kind === 'icespire') buildIceSpire(lg, lm);
    else if(lm.kind === 'gate') buildGate(lg, lm);
    else if(lm.kind === 'plume'){ const p = buildPlume(lg, lm, world); if(p) anim.plumes.push(p); }
  }
 
  for(const k of Object.keys(lay.regions)) buildNest(lg, k, lay.regions[k].nest);
  buildHouses(lg, world);
  buildWalls(lg);
  buildTunnels(lg);
  bakeStatic(lg);
  group.add(lg);
  // 焼き込まない物(InstancedMesh・加算・乗算・溶岩の帯・氷の板)
  buildGiants(group, world);
  buildLavaRiver(group, world);
  buildLavaRims(group, world);
  buildLavaGlow(group, world, anim);
  buildIceLakes(group, world);
  anim.ash = buildAsh();
  group.add(anim.ash);
}

/* 地域の空気。カメラの地域の重みで、霞(指数型の霧)・日差し・空・雲を混ぜる。
   霧は地面・山・ランドマーク・水がすべて同じ1本の曲線で霞む(探検のあいだだけ FogExp2 に差し替え、
   離れるときに元の Fog へ戻す)。空の元の色は最初のフレームで覚えておき、そこから混ぜる。 */
let baseSky = null, fogX = null, savedFog = null, sunBase = null;
const _hz = new THREE.Color(), _sun = new THREE.Color(), _tmp = new THREE.Color(), _zen = new THREE.Color();
const _low = new THREE.Color(), _ct = new THREE.Color();
const SUN_BASE = new THREE.Color(0xfff1d6);
const _cl = [0, 0, 0, 0];
const ASH_FALL = 55, ASH_DRIFT = 24;   // 灰の落ちる速さ・横に流れる速さ(単位/秒)
export function updateExplore(t, cp, ctx){
  const w = exploreWeights(cp.x, cp.y);
  exploreMixColor(exploreRegionColors('haze'), w, _hz);
  EXPLORE_ATMO.haze.value.copy(_hz);
  const scene = ctx.scene;
  if(!fogX) fogX = new THREE.FogExp2(_hz.getHex(), 0.0002);
  if(scene.fog !== fogX){ savedFog = scene.fog; scene.fog = fogX; }
  fogX.color.copy(_hz);
  // 覗き込み(スコープ)の間は霞を薄くする(遠くを狙えるように)
  const zoom = (window.__aramonLook && window.__aramonLook.zoom) || 1;
  fogX.density = exploreMixNum('fogD', w) / (isFinite(zoom) ? Math.max(1, zoom) : 1);
  if(ctx.sun){
    if(sunBase == null) sunBase = ctx.sun.intensity;
    exploreMixColor(exploreRegionColors('sun'), w, _sun);
    ctx.sun.color.copy(_sun);
    ctx.sun.intensity = sunBase*exploreMixNum('sunK', w);
  }
  // 水辺の岸の色は、その場の地域の地面から
  exploreMixColor(exploreRegionColors('low'), w, _low);
  exploreTintWater(_low);
  const u = ctx.sky && ctx.sky.material && ctx.sky.material.uniforms;
  if(u){
    if(!baseSky){
      baseSky = { low:u.uLowSky.value.clone(), glow:u.uSunCol.value.clone(),
                  mid:u.uCloudMid.value.clone(), dark:u.uCloudDark.value.clone(), lit:u.uCloudLit.value.clone(),
                  thr:u.uThr.value, cover:u.uCover.value, cir:u.uCirrusAmt.value, lowAmt:u.uLowAmt.value };
      u.uCloud2.value = ensureCumulusTex();
    }
    u.uCloudMode.value = 1;
    u.uHorizon.value.copy(_hz);
    u.uBelow.value.copy(_hz).multiplyScalar(0.84);
    u.uLowSky.value.copy(baseSky.low).lerp(_hz, 0.40);
    exploreMixColor(exploreRegionColors('sky'), w, _zen);
    u.uZenith.value.copy(_zen);
    u.uLowSky.value.lerp(_zen, 0.25);
    u.uHigh.value.copy(u.uLowSky.value).lerp(_zen, 0.60);
    u.uSunCol.value.copy(baseSky.glow).lerp(_tmp.copy(_sun), 0.35);
    // 雲: 量・厚さ・巻雲・低い雲を地域ごとに
    for(let i=0;i<4;i++) _cl[i] = exploreMixNum('clouds', w, i);
    u.uCover.value = 0.55 + 0.45*_cl[0];
    u.uThr.value = _cl[1];
    u.uCirrusAmt.value = _cl[2]*0.55;
    u.uLowAmt.value = _cl[3];
    // 火山の上空は噴煙: 雲を煤けた色へ寄せ、影の側を下から赤く照らす
    const smoke = exploreMixNum('cloud', w);
    const vk = w[2];
    _tmp.copy(_hz).multiplyScalar(0.55);
    u.uCloudMid.value.copy(baseSky.mid).lerp(_tmp, smoke);
    exploreMixColor(exploreRegionColors('cloudTint'), w, _ct);   // 雲の影の色(火山は下から赤く照らされる)
    u.uCloudDark.value.copy(baseSky.dark).lerp(_ct, Math.max(smoke, vk));
    u.uCloudLit.value.copy(baseSky.lit).lerp(_hz, smoke*0.7);
    // 樹冠の下(密林)は空がほとんど見えないので、雲を低く湿った霞へ寄せる
    u.uCloudLit.value.lerp(_hz, w[3]*0.35);
  }
  // 遠景の山並み(空のモジュールの帯)は、探検では遠景の地形が外周の山まで描くので出さない
  if(ctx.ridge) ctx.ridge.visible = false;
  syncFarTerrain();
  if(!anim) return;
  // 焚き火のゆらぎ
  for(const f of anim.flames){
    const k = 0.86 + 0.14*Math.sin(t*11.3) + 0.08*Math.sin(t*23.7 + 1.1);
    f.scale.set(1, k, 1);
    f.rotation.y = t*0.6;
  }
  for(const gl of anim.fireGlow){ if(gl) gl.material.opacity = 0.34 + 0.08*Math.sin(t*9.1) + 0.04*Math.sin(t*17.3); }
  // ビーコン: 緑の灯火が揺れ、2本の輪が逆向きに回り、足元の輪が脈打つ
  for(const b of anim.beacons){
    const k = 0.9 + 0.1*Math.sin(t*9.7) + 0.06*Math.sin(t*21.1);
    b.flame.scale.set(1, k, 1);
    b.flame.rotation.y = t*0.5;
    b.rings.forEach((r, i)=>{ r.rotation.y = t*(i ? -0.7 : 0.9); });
    const s = 120 + ((t*0.4) % 1)*220;
    b.ring.scale.set(s, s, s);
    b.ring.material.opacity = 0.55*(1 - ((t*0.4) % 1));
    const hs = 300 + 25*Math.sin(t*2.1);
    b.halo.scale.set(hs, hs, 1);
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
  // 陽炎: カメラへ向け、縞を上へ流して揺らめかせる
  if(anim.haze.length){
    getHazeTex().offset.y = -t*0.35;
    for(const h of anim.haze) h.rotation.y = Math.atan2(cp.x - h.position.x, cp.y - h.position.z);
  }
  // 降る灰: 火山の重みで濃さを変え、カメラのまわりの箱の中で回す
  const ash = anim.ash;
  if(ash){
    const vk = w[2];
    ash.visible = vk > 0.03;
    if(ash.visible){
      ash.material.opacity = Math.min(0.85, vk*1.1);
      const p = ash.geometry.attributes.position, a = p.array;
      const base = cp.z - 420, B2 = ASH_BOX*2;
      for(let i=0;i<ASH_N;i++){
        const sx = hash2(i, 1.7)*B2, sy = hash2(i, 3.1)*700, sz = hash2(i, 5.3)*B2;
        let x = sx + t*ASH_DRIFT + Math.sin(t*0.7 + i)*14 - (cp.x - ASH_BOX);
        let z = sz + t*ASH_DRIFT*0.6 - (cp.y - ASH_BOX);
        x = ((x % B2) + B2) % B2; z = ((z % B2) + B2) % B2;
        a[i*3] = cp.x - ASH_BOX + x;
        a[i*3+2] = cp.y - ASH_BOX + z;
        a[i*3+1] = base + (((sy - t*ASH_FALL) % 700) + 700) % 700;
      }
      p.needsUpdate = true;
    }
  }
}
// マップを離れるとき(real3d.js の applyTheme)に空気を元へ戻す。霧の差し替えより先に呼ばれる
export function resetExplore(ctx){
  anim = null; baseSky = null; farTerrain = null;
  if(ctx && ctx.scene && savedFog && ctx.scene.fog === fogX) ctx.scene.fog = savedFog;
  savedFog = null;
  if(ctx && ctx.sun){
    ctx.sun.color.copy(SUN_BASE);
    if(sunBase != null) ctx.sun.intensity = sunBase;
  }
  sunBase = null;
  if(ctx && ctx.ridge){
    ctx.ridge.visible = true;
    const ru = ctx.ridge.material && ctx.ridge.material.uniforms;
    if(ru && ru.uTintAmt) ru.uTintAmt.value = 0;
  }
  const u = ctx && ctx.sky && ctx.sky.material && ctx.sky.material.uniforms;
  if(u && u.uCloudMode) u.uCloudMode.value = 0;   // 空の他の値は applySkyTheme が作り直す
}
