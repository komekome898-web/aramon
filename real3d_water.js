/* =====================================================================
   リアルマップ: 水と溶岩(地面のしみ)

   ・海と川は円を並べず1枚のつながった水面として張る(円のままだと数珠つなぎに見える)
   ・波と流れは頂点シェーダー(onBeforeCompile)で動かす。CPUは毎フレーム uTime を渡すだけ
   ・溶岩は「黒い地殻 + 割れ目だけ光る emissiveMap」。脈動は lavaMats をまとめて動かす
   ===================================================================== */
import * as THREE from './vendor/three.module.min.js';
import { heightAt, fbmTile, makeTexture } from './real3d_common.js';
import { getGroundMaps } from './real3d_terrain.js';

export const ZONE_SEGS = 28, ZONE_RINGS = 5;   // しみの分割数(粗いと起伏から浮く)
export const ZONE_LIFT = 2.5;                  // 地面から少しだけ浮かせてZファイティングを避ける
const ZONE_UV_TILE = 300;                      // しみのテクスチャが1周するワールド単位

/* 水は空をよく映すので、粗さを下げすぎる/環境光を上げすぎると白く飛んで水に見えない。
   青みを残すため roughness は少し高め、envMapIntensity は控えめにする。          */
const ZONE_MATS = {
  sea:   { color:0x0e3f68, roughness:0.20, opacity:0.92, env:0.55 },
  river: { color:0x1d6392, roughness:0.22, opacity:0.84, env:0.70 },
  oasis: { color:0x14719d, roughness:0.18, opacity:0.90, env:0.80 },
  sand:  { color:0x9a7a46, roughness:0.90, opacity:0.70, env:0.50 },
};

/* 溶岩の材質(火口・縁も同じ配列に入れる)と、水面シェーダー。
   どちらも毎フレーム動かすので、作り直しのたびに中身を空にして詰め直す。
   【重要】配列そのものを作り直さない(import した側が古い配列を掴んでしまう)。 */
export const lavaMats = [];
export const waterShaders = [];
export function resetDynamicLists(){ lavaMats.length = 0; waterShaders.length = 0; }

let zoneTex = null, zoneMatCache = null;

/* 溶岩と水面のテクスチャ。ここも画像ファイルは持たず手続き的に作る。
   ・溶岩: 冷えた黒い地殻 + 割れ目だけが光る(emissiveMap)。割れ目から法線も作る
   ・水面: さざ波の法線マップ。offsetを毎フレーム流して水が動いて見えるようにする   */
export function buildZoneTextures(){
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
export function buildZoneMesh(z, mat, radius, lift){
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
export function zoneMaterial(kind){
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
    const groundMaps = getGroundMaps();
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
let waterMat = null;

export function waterMaterial(){
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
export function buildSeaMesh(edgeFn, worldH){
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
export function splitRivers(zones){
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

export function buildRiverMesh(chain){
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

/* 毎フレームの動き。水面の時刻を進め、溶岩を脈打たせる。 */
export function animateWater(t){
  for(let i=0;i<waterShaders.length;i++) waterShaders[i].uniforms.uTime.value = t;
  if(lavaMats.length){
    // 溶岩の脈動(2DのdrawLavaZonesと同じ揺らし方)
    const pulse = 0.75 + 0.25*Math.sin(t*2.4);
    for(let i=0;i<lavaMats.length;i++) lavaMats[i].emissiveIntensity = 1.15 + 0.6*pulse;
  }
}
