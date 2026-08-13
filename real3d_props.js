/* =====================================================================
   リアルマップ: 立体物(山 と 障害物)

   ・山(火山/雪山/森/ピラミッド)は2Dの drawSolidCone と同じ寸法の円錐。
     色は「形 + 頂点カラー」で作る。画面に貼る円で演出しない(視点を変えると浮く)
   ・障害物(岩・木・水晶)は種類ごとの InstancedMesh。形の定義(全高・埋める深さ・
     2Dでくり抜く輪郭)は data.js の OBST_SHAPES 1か所を両方が読む
   ===================================================================== */
import * as THREE from './vendor/three.module.min.js';
import { R3, DEFAULT_THEME, ENV_INTENSITY, heightAt, hash2, tileNoise, mergeGeos } from './real3d_common.js';
import { getGroundMaps } from './real3d_terrain.js';
import { lavaMats } from './real3d_water.js';

const MOUNT_SKIRT = 120;      // 山の裾を地面へ埋める深さ(地形の凹みで隙間が出ないように)
const CRATER_RATIO = 0.17;    // 火山の火口の広さ(山の半径に対する比)

/* 山の色。高さ(0=麓 1=頂上)で麓・中腹・頂上の3色を混ぜる。
   これが「山頂の丸い演出」の代わりで、視点を変えても山に沿ったまま崩れない。   */
const MOUNT_COLORS = {
  volcano: { foot:0x4e3320, mid:0x36251a, top:0x1d1512, rough:0.95 },
  snow:    { foot:0x6d7d90, mid:0xb4c6da, top:0xf2f8ff, rough:0.55 },
  forest:  { foot:0x36421f, mid:0x27461c, top:0x152e12, rough:0.92 },
  pyramid: { foot:0x8a6f3f, mid:0xa88a54, top:0xc0a068, rough:0.80 },
};

/* 山の肌。地面用に作ったテクスチャを複製して貼り、のっぺりした面を防ぐ。
   複製は画像を共有するので生成コストはかからない(repeat/offsetだけ別に持てる)。 */
const mountTexCache = {};
export function mountainTextures(){
  const groundMaps = getGroundMaps();
  if(!groundMaps) return null;
  if(!mountTexCache.normalMap){
    const clone = (t, rep)=>{ const c = t.clone(); c.needsUpdate = true; c.repeat.set(rep, rep); c.offset.set(0,0); return c; };
    mountTexCache.normalMap = clone(groundMaps.normalMap, 8);
    mountTexCache.roughnessMap = clone(groundMaps.roughnessMap, 8);
  }
  return mountTexCache;
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

export function buildMountainMesh(v){
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
    const seed = hash2(v.x*0.013, v.y*0.017) * 10;
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
let obstCX = null, obstCY = null, obstCull = OBST_VIEW, obstDrawn = 0;

export function obstacleCullDist(){ return obstCull; }
export function obstacleDrawn(){ return obstDrawn; }
export function resetObstacles(){ obstSig = ''; obstCull = OBST_VIEW; }

function shapeOf(flavor){
  const t = window.__aramonObstShapes;
  return (t && (t[flavor] || t.rock)) || OBST_SHAPE_FB;
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
      const lo = new THREE.Color(R3.theme.steep || DEFAULT_THEME.steep).multiplyScalar(0.80);
      const hi = new THREE.Color(R3.theme.gravel || DEFAULT_THEME.gravel).multiplyScalar(1.30);
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

function buildObstacles(scene, list){
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
  obstDrawn = near.length;
}

export function updateObstacles(scene, rocks, crystals, cx, cy){
  if(!scene) return;
  const sig = obstacleSignature(rocks) + '/' + obstacleSignature(crystals);
  if(sig !== obstSig){
    obstSig = sig;
    // 水晶はflavorを持たないのでここで付ける(元の配列は書き換えない)
    obstSrc = (rocks || []).slice();
    for(const c of (crystals || [])) obstSrc.push({ x:c.x, y:c.y, radius:c.radius, seed:c.seed, flavor:'crystal' });
    buildObstacles(scene, obstSrc);
  }
  updateObstacleInstances(cx, cy);
}
