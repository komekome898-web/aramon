function project(wx, wy, wz){
  const tx = wx-camPos.x, ty = wy-camPos.y, tz=(wz||0)-camPos.z;
  const depthFlat = tx*Math.cos(camState.yaw) + ty*Math.sin(camState.yaw);
  const lateral   = -tx*Math.sin(camState.yaw) + ty*Math.cos(camState.yaw);
  const camDepth = depthFlat*Math.cos(camState.pitch) - tz*Math.sin(camState.pitch);
  if(camDepth < 1) return null;
  const camVert = depthFlat*Math.sin(camState.pitch) + tz*Math.cos(camState.pitch);
  const scale = clamp(FOCAL/camDepth, 0, 6);
  return { x: viewW/2 + lateral*scale, y: viewH/2 - camVert*scale, scale, depth: camDepth };
}

/* =====================================================================
   RENDER - shapes
===================================================================== */
/* =====================================================================
   スキン(着せ替え): モンスター画像のメイン色部分だけを実行時に色置換する。
   事前生成した画像を持たず、ベース画像から生成してキャッシュする(SSRのみ専用画像)。
===================================================================== */
const _skinCanvasCache = {};   // key -> HTMLCanvasElement
const _skinDataUrlCache = {};  // key -> dataURL(string)
function _imgW(img){ return img.naturalWidth || img.width || 1; }
function _imgH(img){ return img.naturalHeight || img.height || 1; }
// ベース画像のメイン色部分を colorId の色に置換した canvas を返す
function recolorToCanvas(baseImg, element, colorId, maxSize){
  let w=_imgW(baseImg), h=_imgH(baseImg);
  if(maxSize && Math.max(w,h)>maxSize){ const s=maxSize/Math.max(w,h); w=Math.round(w*s); h=Math.round(h*s); }
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const cx=c.getContext('2d'); cx.drawImage(baseImg,0,0,w,h);
  const info = monsterMainInfo(element);
  const id=cx.getImageData(0,0,w,h); const d=id.data;
  const hueDist=(a,b)=>{ let x=Math.abs(a-b)%360; return x>180?360-x:x; };
  for(let i=0;i<d.length;i+=4){
    if(d[i+3]<8) continue;
    const [h1,s1,l1]=rgbToHsl(d[i],d[i+1],d[i+2]);
    let wgt=0;
    if(info.type==='chroma'){
      const hueW = 1 - Math.min(1, hueDist(h1, info.hue)/(info.window||55));
      // 彩度の低い(=指示色に近い淡い)箇所も拾えるようフロアを下げる
      const satW = Math.min(1, Math.max(0,(s1-0.06))/0.16);
      wgt = hueW*satW;
    } else if(info.type==='dark'){
      wgt = Math.min(1, Math.max(0,(0.45-l1)/0.35)) * (1-Math.min(1,s1/0.5));
    } else { // light
      wgt = Math.min(1, Math.max(0,(l1-0.55)/0.35)) * (1-Math.min(1,s1/0.45));
    }
    if(wgt<=0.01) continue;
    let nr,ng,nb;
    // ブラック/ホワイトは彩度をほぼ抜いて無彩色寄りにする(暗い赤/淡い青にならないように)
    if(colorId==='black'){ [nr,ng,nb]=hslToRgb(h1, s1*0.06, l1*0.20); }
    else if(colorId==='white'){ [nr,ng,nb]=hslToRgb(h1, s1*0.05, Math.min(0.97, 0.76+l1*0.22)); }
    else {
      const Ht=SKIN_TARGET_HUE[colorId]; let ns=Math.max(s1,0.5), nl=l1;
      if(info.type==='light'){ ns=Math.max(s1,0.55); nl=clamp(l1*0.7+0.12, 0.3, 0.8); }
      if(colorId==='yellow') nl=Math.min(0.82, nl*1.05+0.06);
      [nr,ng,nb]=hslToRgb(Ht, ns, nl);
    }
    d[i]  =Math.round(d[i]*(1-wgt)+nr*wgt);
    d[i+1]=Math.round(d[i+1]*(1-wgt)+ng*wgt);
    d[i+2]=Math.round(d[i+2]*(1-wgt)+nb*wgt);
  }
  cx.putImageData(id,0,0);
  return c;
}
// 色スキンの canvas を返す(view: 'icon'|'player')。ベース未ロードなら null
function skinnedColorCanvas(element, colorId, view){
  const key = `${element}:${colorId}:${view}`;
  if(_skinCanvasCache[key]) return _skinCanvasCache[key];
  let base = view==='player' ? playerMonsterImages[element] : monsterImages[element];
  if(!imgIsReady(base)) base = monsterImages[element];      // playerが無ければiconで代用
  if(!imgIsReady(base)) return null;
  // アイコン用途は軽量化のため縮小して色置換(DOM表示・カタログ用)
  const c = recolorToCanvas(base, element, colorId, view==='icon' ? 200 : 0);
  _skinCanvasCache[key]=c;
  return c;
}
// skinId から表示用画像(canvas/Image)を返す。view: 'icon'|'player'
function skinnedImage(skinId, view){
  if(!skinId) return null;
  if(SSR_SKINS[skinId]){
    const s=SSR_SKINS[skinId];
    const img = view==='player' ? ssrSkinImages[s.playerImg] : ssrSkinImages[s.iconImg];
    if(imgIsReady(img)) return img;
    const alt = ssrSkinImages[s.iconImg];
    return imgIsReady(alt) ? alt : null;
  }
  const m = skinMeta(skinId);
  return skinnedColorCanvas(m.element, m.colorId, view);
}
// DOM(<img>)用: skinId のアイコンを dataURL で返す(キャッシュ)。未生成なら null
function skinnedIconDataUrl(skinId){
  if(!skinId) return null;
  if(_skinDataUrlCache[skinId]) return _skinDataUrlCache[skinId];
  const img = skinnedImage(skinId, 'icon');
  if(!img) return null;
  let url;
  if(img instanceof HTMLCanvasElement) url = img.toDataURL('image/png');
  else {
    const c=document.createElement('canvas'); c.width=_imgW(img); c.height=_imgH(img);
    c.getContext('2d').drawImage(img,0,0); url=c.toDataURL('image/png');
  }
  _skinDataUrlCache[skinId]=url;
  return url;
}
// DOM用: skinId の試合中(後ろ姿)を dataURL で返す(キャッシュ)。未生成なら null
function skinnedPlayerDataUrl(skinId){
  if(!skinId) return null;
  const key = 'P:'+skinId;
  if(_skinDataUrlCache[key]) return _skinDataUrlCache[key];
  const img = skinnedImage(skinId, 'player');
  if(!img) return null;
  let url;
  if(img instanceof HTMLCanvasElement) url = img.toDataURL('image/png');
  else {
    const c=document.createElement('canvas'); c.width=_imgW(img); c.height=_imgH(img);
    c.getContext('2d').drawImage(img,0,0); url=c.toDataURL('image/png');
  }
  _skinDataUrlCache[key]=url;
  return url;
}
// エンティティに装備中スキンがあればその表示画像を返す。
// ・自分(操作キャラ)は後ろ姿(player)、それ以外(相手/マスモンbot)は正面(icon)を使う
//   (通常描画も自分だけ_player画像・他は正面画像を使うのに合わせる)
function skinnedImageForEntity(entity){
  if(!entity) return null;
  if(entity.isPlayer){
    const skinId = (typeof getEquippedSkin==='function') ? getEquippedSkin(entity.element) : null;
    if(!skinId) return null;
    return skinnedImage(skinId, 'player');
  }
  if(entity.skinId) return skinnedImage(entity.skinId, 'icon');
  return null;
}

// 画像の白シルエット(被弾フラッシュ用)をオフスクリーンに一度だけ作ってキャッシュする。
// (円形クリップを廃したため、矩形の白fillでは背景まで白くなってしまう。
//  画像のアルファ形状に沿って白くするためにこの手法を使う)
const _whiteMaskCache = new WeakMap();
function whiteMaskFor(img){
  const w = _imgW(img), h = _imgH(img);
  const cached = _whiteMaskCache.get(img);
  if(cached && cached.w===w && cached.h===h) return cached.canvas;
  const c = document.createElement('canvas'); c.width=w; c.height=h;
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  cx.globalCompositeOperation = 'source-in';
  cx.fillStyle = '#fff'; cx.fillRect(0,0,w,h);
  _whiteMaskCache.set(img, { canvas:c, w, h });
  return c;
}
function drawMonsterPortrait(e, img, flash){
  const r = e.radius;
  // 丸めクリップ・縁取りは廃止し、モンスター画像をそのまま(透過付きで)描画する
  const iw = _imgW(img), ih = _imgH(img);
  const scale = Math.max((r*2)/iw, (r*2)/ih);
  const dw = iw*scale, dh = ih*scale;
  ctx.drawImage(img, -dw/2, -dh/2, dw, dh);
  if(flash){
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.drawImage(whiteMaskFor(img), -dw/2, -dh/2, dw, dh);
    ctx.restore();
  }
}
function drawMonsterShape(e, color, dark){
  const r = e.radius;
  ctx.fillStyle = color; ctx.strokeStyle = dark; ctx.lineWidth = 2.5;
  switch(e.element){
    case 'fire': {
      ctx.fillStyle='#a8431d';
      [-1,1].forEach(side=>{
        ctx.beginPath();
        ctx.ellipse(side*r*0.95, r*0.55, r*0.32, r*0.5, side*0.3, 0, Math.PI*2);
        ctx.fill();
        ctx.strokeStyle=dark; ctx.lineWidth=2; ctx.stroke();
      });
      ctx.fillStyle=color;
      ctx.beginPath(); ctx.arc(0,r*0.08,r*1.02,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=dark; ctx.lineWidth=2.5; ctx.stroke();
      ctx.fillStyle='#ffb347';
      ctx.beginPath(); ctx.ellipse(0,r*0.32,r*0.62,r*0.5,0,0,Math.PI*2); ctx.fill();
      [-1,1].forEach(side=>{
        ctx.strokeStyle='rgba(160,60,20,0.45)'; ctx.lineWidth=2.5;
        ctx.beginPath();
        ctx.moveTo(side*r*0.18, r*0.0); ctx.lineTo(side*r*0.5, r*0.7);
        ctx.stroke();
      });
      ctx.fillStyle='#7a4a2e';
      ctx.beginPath();
      ctx.moveTo(-r*0.58,-r*0.55);
      ctx.lineTo(-r*0.3,-r*1.15);
      ctx.lineTo(0,-r*0.68);
      ctx.lineTo(r*0.3,-r*1.15);
      ctx.lineTo(r*0.58,-r*0.55);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle=dark; ctx.lineWidth=2; ctx.stroke();
      break;
    }
    case 'aqua': {
      ctx.beginPath();
      ctx.moveTo(0,-r*1.35);
      ctx.quadraticCurveTo(r*1.05,-r*0.2, r*0.85, r*0.35);
      ctx.arc(0, r*0.35, r*0.85, 0.0, Math.PI, false);
      ctx.quadraticCurveTo(-r*1.05,-r*0.2, 0,-r*1.35);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'leaf': {
      ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle=color;
      [[-1,-0.15],[1,-0.15]].forEach(([dx,dy])=>{
        ctx.beginPath();
        ctx.ellipse(dx*r*1.15, dy*r, r*0.55, r*0.28, dx*0.5, 0, Math.PI*2);
        ctx.fill(); ctx.stroke();
      });
      break;
    }
    case 'spark': {
      ctx.beginPath();
      for(let i=0;i<8;i++){
        const a = (i/8)*Math.PI*2;
        const rr = i%2===0 ? r*1.05 : r*0.72;
        const px=Math.cos(a)*rr, py=Math.sin(a)*rr;
        if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'rock': {
      ctx.beginPath();
      for(let i=0;i<6;i++){
        const a = -Math.PI/2 + i*(Math.PI/3);
        const px=Math.cos(a)*r*1.08, py=Math.sin(a)*r*1.08;
        if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'phoenix': {
      const accent = ELEMENTS.phoenix.accent;
      ctx.save();
      ctx.shadowBlur = 16; ctx.shadowColor = color;

      for(let i=-1;i<=1;i++){
        const a = Math.PI/2 + i*0.46;
        const baseA1 = a-0.14, baseA2 = a+0.14;
        ctx.beginPath();
        ctx.moveTo(Math.cos(baseA1)*r*0.7, Math.sin(baseA1)*r*0.7);
        ctx.lineTo(Math.cos(a)*r*1.9, Math.sin(a)*r*1.9);
        ctx.lineTo(Math.cos(baseA2)*r*0.7, Math.sin(baseA2)*r*0.7);
        ctx.closePath();
        ctx.fillStyle = color; ctx.fill();
        ctx.strokeStyle = accent; ctx.lineWidth=1.6; ctx.stroke();
      }
      [-1,1].forEach(side=>{
        for(let i=0;i<2;i++){
          const baseAng = side*Math.PI/2 + side*(0.25+i*0.5);
          const b1 = baseAng-0.16, b2 = baseAng+0.16;
          ctx.beginPath();
          ctx.moveTo(Math.cos(b1)*r*0.55, Math.sin(b1)*r*0.55);
          ctx.lineTo(Math.cos(baseAng)*r*(1.55-i*0.35), Math.sin(baseAng)*r*(1.55-i*0.35));
          ctx.lineTo(Math.cos(b2)*r*0.55, Math.sin(b2)*r*0.55);
          ctx.closePath();
          ctx.fillStyle = color; ctx.fill();
          ctx.strokeStyle = accent; ctx.lineWidth=1.6; ctx.stroke();
        }
      });

      ctx.beginPath();
      ctx.ellipse(0, r*0.08, r*0.78, r*0.95, 0, 0, Math.PI*2);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth=2.5; ctx.stroke();

      ctx.beginPath();
      ctx.ellipse(0, r*0.18, r*0.42, r*0.5, 0, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,244,200,0.55)'; ctx.fill();

      const spikeCount = 5;
      for(let i=0;i<spikeCount;i++){
        const t = (i/(spikeCount-1))-0.5;
        const baseAng = -Math.PI/2 + t*0.95;
        const spikeLen = r*(1.25 + (1-Math.abs(t)*2)*0.55);
        const bx1 = Math.cos(baseAng-0.09)*r*0.78, by1 = Math.sin(baseAng-0.09)*r*0.78;
        const bx2 = Math.cos(baseAng+0.09)*r*0.78, by2 = Math.sin(baseAng+0.09)*r*0.78;
        const tx = Math.cos(baseAng)*spikeLen, ty = Math.sin(baseAng)*spikeLen;
        ctx.beginPath();
        ctx.moveTo(bx1,by1); ctx.lineTo(tx,ty); ctx.lineTo(bx2,by2); ctx.closePath();
        ctx.fillStyle = accent; ctx.fill();
        ctx.strokeStyle = dark; ctx.lineWidth=1.4; ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(-r*0.16,-r*0.78); ctx.lineTo(0,-r*1.0); ctx.lineTo(r*0.16,-r*0.78);
      ctx.closePath();
      ctx.fillStyle = dark; ctx.fill();

      for(let i=-1;i<=1;i++){
        const wx = i*r*0.32;
        const wobble = Math.sin(matchTime*4+i*2)*r*0.08;
        ctx.beginPath();
        ctx.moveTo(wx-r*0.12, r*0.88);
        ctx.lineTo(wx+wobble, r*1.35);
        ctx.lineTo(wx+r*0.12, r*0.88);
        ctx.closePath();
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = accent;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      for(let i=0;i<4;i++){
        const a2 = matchTime*1.3 + i*(Math.PI/2);
        const ex = Math.cos(a2)*r*1.7, ey = Math.sin(a2*1.3)*r*1.0 - r*0.3;
        const emberAlpha = 0.45+0.45*Math.sin(matchTime*3+i*2);
        ctx.beginPath();
        ctx.arc(ex,ey, r*0.07, 0, Math.PI*2);
        ctx.fillStyle = `rgba(255,214,106,${emberAlpha})`;
        ctx.fill();
      }
      break;
    }
    case 'ark': {
      const accent = ELEMENTS.ark.accent;
      ctx.save();
      ctx.shadowBlur = 14; ctx.shadowColor = accent;

      // 光輪
      ctx.beginPath();
      ctx.arc(0,-r*1.05,r*0.62,0,Math.PI*2);
      ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.stroke();

      // 翼
      [-1,1].forEach(side=>{
        ctx.beginPath();
        ctx.moveTo(side*r*0.25, -r*0.1);
        ctx.quadraticCurveTo(side*r*1.5, -r*0.6, side*r*1.7, r*0.15);
        ctx.quadraticCurveTo(side*r*1.1, r*0.05, side*r*0.35, r*0.4);
        ctx.closePath();
        ctx.fillStyle = color; ctx.fill();
        ctx.strokeStyle = dark; ctx.lineWidth = 1.6; ctx.stroke();
      });

      // 本体
      ctx.beginPath(); ctx.arc(0,0,r*0.85,0,Math.PI*2);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 2.5; ctx.stroke();

      ctx.restore();
      break;
    }
    case 'warm': {
      ctx.save();
      // 体節(丸を連ねた胴体)
      for(let i=2;i>=0;i--){
        const rr = r*(0.62+i*0.18);
        const oy = i*r*0.18;
        ctx.beginPath(); ctx.arc(0, oy, rr, 0, Math.PI*2);
        ctx.fillStyle = i===0 ? color : dark; ctx.fill();
        ctx.strokeStyle = dark; ctx.lineWidth = 2; ctx.stroke();
      }
      // 目
      [-1,1].forEach(side=>{
        ctx.beginPath(); ctx.arc(side*r*0.32,-r*0.15,r*0.13,0,Math.PI*2);
        ctx.fillStyle='#1a1020'; ctx.fill();
      });
      // 毒のしずく
      ctx.globalAlpha = 0.6+0.2*Math.sin(matchTime*4);
      ctx.beginPath(); ctx.arc(0, r*0.85, r*0.16, 0, Math.PI*2);
      ctx.fillStyle = '#c07bf0'; ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
      break;
    }
    case 'illumine': {
      const accent = ELEMENTS.illumine.accent;
      ctx.save();
      // 黒い刃のようなシルエット
      ctx.beginPath();
      ctx.moveTo(0,-r*1.1);
      ctx.lineTo(r*0.55,-r*0.1);
      ctx.lineTo(r*0.32,r*0.9);
      ctx.lineTo(-r*0.32,r*0.9);
      ctx.lineTo(-r*0.55,-r*0.1);
      ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = accent; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath(); ctx.arc(0,-r*0.15,r*0.18,0,Math.PI*2);
      ctx.fillStyle = accent; ctx.shadowBlur=10; ctx.shadowColor=accent; ctx.fill();
      ctx.restore();
      break;
    }
    case 'fox': {
      ctx.save();
      // 白い狐顔のシルエット(三角の耳+丸い顔)
      ctx.beginPath();
      ctx.moveTo(-r*0.85,-r*0.55); ctx.lineTo(-r*0.35,-r*1.05); ctx.lineTo(-r*0.15,-r*0.35); ctx.closePath();
      ctx.moveTo(r*0.85,-r*0.55); ctx.lineTo(r*0.35,-r*1.05); ctx.lineTo(r*0.15,-r*0.35); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0,0,r*0.78,r*0.7,0,0,Math.PI*2);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,r*0.1); ctx.lineTo(-r*0.18,r*0.42); ctx.lineTo(r*0.18,r*0.42); ctx.closePath();
      ctx.fillStyle = dark; ctx.fill();
      ctx.restore();
      break;
    }
    case 'mocchi': {
      ctx.beginPath(); ctx.ellipse(0,r*0.05,r*1.05,r*0.95,0,0,Math.PI*2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.ellipse(-r*0.32,-r*0.32,r*0.28,r*0.18,-0.4,0,Math.PI*2); ctx.fill();
      ctx.fillStyle=dark;
      [-1,1].forEach(s=>{ ctx.beginPath(); ctx.arc(s*r*0.22,-r*0.05,r*0.07,0,Math.PI*2); ctx.fill(); });
      break;
    }
    case 'suezo': {
      ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#ffffff';
      [-1,1].forEach(s=>{ ctx.beginPath(); ctx.arc(s*r*0.4,-r*0.15,r*0.3,0,Math.PI*2); ctx.fill(); });
      ctx.fillStyle='#10131a';
      [-1,1].forEach(s=>{ ctx.beginPath(); ctx.arc(s*r*0.4,-r*0.1,r*0.15,0,Math.PI*2); ctx.fill(); });
      break;
    }
  }
}
function drawElementBadge(e){
  const r=e.radius;
  ctx.save(); ctx.translate(0,-r*1.05);
  ctx.beginPath(); ctx.arc(0,0,r*0.32,0,Math.PI*2);
  ctx.fillStyle='#0c1118'; ctx.fill();
  ctx.strokeStyle=ELEMENTS[e.element].color; ctx.lineWidth=1.6; ctx.stroke();
  ctx.fillStyle=ELEMENTS[e.element].color;
  const s=r*0.16;
  switch(e.element){
    case 'fire': ctx.beginPath(); ctx.moveTo(0,-s); ctx.lineTo(s*0.8,s*0.7); ctx.lineTo(-s*0.8,s*0.7); ctx.closePath(); ctx.fill(); break;
    case 'aqua': ctx.beginPath(); ctx.moveTo(0,-s); ctx.quadraticCurveTo(s*0.9,s*0.5,0,s); ctx.quadraticCurveTo(-s*0.9,s*0.5,0,-s); ctx.fill(); break;
    case 'leaf': ctx.beginPath(); ctx.ellipse(0,0,s*0.95,s*0.45,0.6,0,Math.PI*2); ctx.fill(); break;
    case 'spark': ctx.beginPath(); ctx.moveTo(-s*0.3,-s); ctx.lineTo(s*0.5,-s*0.1); ctx.lineTo(0,0); ctx.lineTo(s*0.4,s); ctx.lineTo(-s*0.5,s*0.1); ctx.lineTo(0,0); ctx.closePath(); ctx.fill(); break;
    case 'rock': ctx.beginPath(); ctx.moveTo(0,-s); ctx.lineTo(s*0.8,0); ctx.lineTo(0,s); ctx.lineTo(-s*0.8,0); ctx.closePath(); ctx.fill(); break;
    case 'phoenix':
      ctx.beginPath(); ctx.moveTo(0,-s*1.1); ctx.lineTo(s*0.85,s*0.35); ctx.lineTo(s*0.15,s*0.15); ctx.lineTo(0,s*0.9); ctx.lineTo(-s*0.15,s*0.15); ctx.lineTo(-s*0.85,s*0.35); ctx.closePath(); ctx.fill();
      break;
  }
  ctx.restore();
}
function drawMonster(e,p){
  const el = ELEMENTS[e.element];
  // 召喚演出中: せり上がりはせず、光が収束するにつれてその場で姿を現す
  if(introState.active){
    const reveal = summonRevealAlpha();
    if(reveal <= 0) return; // まだ光に隠れている
  }
  ctx.save();
  if(introState.active) ctx.globalAlpha = summonRevealAlpha();
  ctx.translate(p.x, p.y);
  ctx.scale(p.scale,p.scale);
  ctx.translate(0,-e.radius*0.85);

  ctx.beginPath(); ctx.ellipse(0, e.radius*0.7, e.radius*0.9, e.radius*0.4, 0,0,Math.PI*2);
  ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fill();

  if(e.dashTimer>0){
    ctx.save(); ctx.globalAlpha=0.35;
    ctx.translate(-e.dashDirX*16,-e.dashDirY*16);
    const dashImg = getDisplayImage(e);
    if(dashImg){
      drawMonsterPortrait(e, dashImg);
    } else {
      drawMonsterShape(e, el.color, el.dark);
    }
    ctx.restore();
  }

  const displayImg = getDisplayImage(e);
  if(displayImg){
    drawMonsterPortrait(e, displayImg, e.hitFlash>0);
    drawElementBadge(e);
  } else {
    drawMonsterShape(e, e.hitFlash>0?'#ffffff':el.color, el.dark);
    drawElementBadge(e);

    if(e.element==='fire'){
      const eo = e.radius*0.36;
      ctx.save();
      ctx.shadowBlur=8; ctx.shadowColor='#ffd76a';
      ctx.strokeStyle = e.hitFlash>0 ? '#10131a' : '#ffd76a';
      ctx.lineWidth = e.radius*0.13; ctx.lineCap='round';
      [-1,1].forEach(s=>{
        ctx.beginPath();
        ctx.arc(s*eo, -e.radius*0.05, e.radius*0.22, Math.PI*0.15, Math.PI*0.85);
        ctx.stroke();
      });
      ctx.restore();
      ctx.strokeStyle='#10131a'; ctx.lineWidth=e.radius*0.1; ctx.lineCap='round';
      ctx.beginPath();
      ctx.arc(0, e.radius*0.32, e.radius*0.42, 0.15*Math.PI, 0.85*Math.PI);
      ctx.stroke();
    } else {
      ctx.fillStyle='#fff';
      const eyeOff = e.radius*0.32;
      [-1,1].forEach(s=>{ ctx.beginPath(); ctx.arc(s*eyeOff,-e.radius*0.05,e.radius*0.16,0,Math.PI*2); ctx.fill(); });
      ctx.fillStyle='#10131a';
      [-1,1].forEach(s=>{ ctx.beginPath(); ctx.arc(s*eyeOff+Math.cos(e.facingAngle)*2,-e.radius*0.05+Math.sin(e.facingAngle)*2,e.radius*0.07,0,Math.PI*2); ctx.fill(); });
    }
  }

  const mv = activeMove(e);
  ctx.beginPath(); ctx.arc(e.radius*0.7,e.radius*0.7,5,0,Math.PI*2);
  ctx.fillStyle=mv.color; ctx.fill(); ctx.strokeStyle='#10131a'; ctx.lineWidth=1.4; ctx.stroke();

  if(e.burnUntil > matchTime){
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.3*Math.sin(matchTime*8);
    ctx.strokeStyle = '#ff6b35'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0,0, e.radius*1.15, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }
  if(e.slowUntil > matchTime){
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#7fa0ff'; ctx.lineWidth = 2; ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.arc(0,0, e.radius*1.3, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }
  if(e.freezeUntil > matchTime){
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = '#bfe9ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0,0, e.radius*1.2, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }
  if(e.poisonUntil > matchTime){
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.25*Math.sin(matchTime*5);
    ctx.strokeStyle = '#9b5fd1'; ctx.lineWidth = 2.5; ctx.setLineDash([2,5]);
    ctx.beginPath(); ctx.arc(0,0, e.radius*1.42, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }

  if(e.isMastermonBot){
    ctx.save();
    const pulse = 0.55 + 0.35*Math.sin(matchTime*4);
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = '#ffd76a';
    ctx.lineWidth = 2.6;
    ctx.shadowBlur = 16; ctx.shadowColor = '#ffe9a8';
    ctx.beginPath(); ctx.arc(0,0, e.radius*1.55, 0, Math.PI*2); ctx.stroke();
    ctx.globalAlpha = pulse*0.6;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0,0, e.radius*1.75, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }

  const barW = e.radius*2.1;
  const hpPct = clamp(e.hp/e.maxHp,0,1);
  ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(-barW/2, -e.radius*1.55-9, barW, 6);
  ctx.fillStyle = hpPct>0.5?'#5fe07c':(hpPct>0.22?'#f4c430':'#ff5d5d');
  ctx.fillRect(-barW/2, -e.radius*1.55-9, barW*hpPct, 6);

  if(e.stateUntil > matchTime){
    const sc = STATE_CHANGES[e.element];
    if(sc){
      ctx.save();
      const pulse = 0.6 + 0.25*Math.sin(matchTime*6);
      ctx.globalAlpha = pulse;
      ctx.font = `bold 12px 'Rajdhani', sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(255,60,60,0.95)';
      ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(255,0,0,0.8)';
      ctx.fillText(sc.name, 0, -e.radius*1.55-27);
      ctx.restore();
    }
  }

  if(!e.isPlayer && dist(e,player)<700){
    ctx.font="11px 'Rajdhani', sans-serif";
    ctx.fillStyle = e.isMastermonBot ? '#ffd76a' : 'rgba(230,230,220,0.85)';
    ctx.textAlign='center';
    if(e.isMastermonBot){ ctx.shadowBlur=6; ctx.shadowColor='#ffb703'; }
    ctx.fillText((e.isMastermonBot?'★ ':'')+displayNameFor(e), 0, -e.radius*1.55-13);
  }
  ctx.restore();
}
function drawLootItem(it,p){
  ctx.save();
  ctx.translate(p.x,p.y);
  ctx.scale(p.scale,p.scale);
  if(it.kind==='heal'){
    const hi = HEAL_ITEMS[it.type];
    const sz = hi.size;
    const bob = Math.sin(matchTime*2.4+it.bob)*2.5;
    ctx.translate(0,-9*sz+bob);
    ctx.shadowBlur=10; ctx.shadowColor=hi.accent;
    ctx.fillStyle=hi.color; ctx.strokeStyle='rgba(0,0,0,0.45)'; ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.ellipse(0, 2*sz, 5*sz, 7*sz, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillRect(-1.6*sz, -7*sz, 3.2*sz, 5*sz); ctx.strokeRect(-1.6*sz, -7*sz, 3.2*sz, 5*sz);
    ctx.fillStyle=hi.accent;
    ctx.fillRect(-2.2*sz, -9*sz, 4.4*sz, 2.4*sz); ctx.strokeRect(-2.2*sz, -9*sz, 4.4*sz, 2.4*sz);
    ctx.fillStyle='rgba(255,255,255,0.3)';
    ctx.beginPath(); ctx.ellipse(-2*sz, 1*sz, 1.2*sz, 4*sz, 0,0,Math.PI*2); ctx.fill();
    ctx.shadowBlur=0;
    if(dist(it,player)<160){
      ctx.font="10px 'Rajdhani', sans-serif"; ctx.fillStyle='rgba(230,230,220,0.9)'; ctx.textAlign='center';
      ctx.fillText(`${hi.name} (+${hi.heal})`, 0, -13*sz);
    }
  } else if(it.kind==='ticket'){
    const bob = Math.sin(matchTime*2.4+it.bob)*2.5;
    ctx.translate(0,-8+bob);
    ctx.shadowBlur=10; ctx.shadowColor=TICKET_ITEM.accent;
    ctx.fillStyle = TICKET_ITEM.color;
    ctx.fillRect(-8,-5,16,10);
    ctx.strokeStyle='rgba(0,0,0,0.4)'; ctx.lineWidth=1.2;
    ctx.strokeRect(-8,-5,16,10);
    ctx.setLineDash([2,2]);
    ctx.beginPath(); ctx.moveTo(0,-5); ctx.lineTo(0,5);
    ctx.strokeStyle='rgba(60,60,60,0.5)'; ctx.lineWidth=1; ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle='#2a5d80'; ctx.font="bold 7px 'Rajdhani', sans-serif"; ctx.textAlign='center';
    ctx.fillText('特訓', -4, 1.5);
    ctx.shadowBlur=0;
    if(dist(it,player)<160){
      ctx.font="10px 'Rajdhani', sans-serif"; ctx.fillStyle='rgba(230,230,220,0.9)'; ctx.textAlign='center';
      ctx.fillText(TICKET_ITEM.name, 0, -14);
    }
  } else if(it.kind==='guts'){
    const bob = Math.sin(matchTime*2.4+it.bob)*2.5;
    ctx.translate(0,-8+bob);
    ctx.shadowBlur=10; ctx.shadowColor=GUTS_ITEM.accent;
    ctx.fillStyle = GUTS_ITEM.color;
    ctx.beginPath(); ctx.ellipse(0,0,7,4.5,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.4)'; ctx.lineWidth=1.2; ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,0.6)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(-9,-3); ctx.lineTo(-6,0); ctx.lineTo(-9,3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(9,-3); ctx.lineTo(6,0); ctx.lineTo(9,3); ctx.stroke();
    ctx.shadowBlur=0;
    if(dist(it,player)<160){
      ctx.font="10px 'Rajdhani', sans-serif"; ctx.fillStyle='rgba(230,230,220,0.9)'; ctx.textAlign='center';
      ctx.fillText(GUTS_ITEM.name, 0, -14);
    }
  } else if(it.kind==='training'){
    const ti = TRAINING_ITEMS[it.type];
    const bob = Math.sin(matchTime*2.4+it.bob)*3.5;
    ctx.translate(0,-16+bob);
    const spin = 0.7+0.3*Math.sin(matchTime*3+it.bob);
    ctx.shadowBlur = 22*spin; ctx.shadowColor = ti.accent;
    ctx.beginPath(); ctx.arc(0,0,18,0,Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill();
    ctx.strokeStyle = ti.accent; ctx.lineWidth = 2; ctx.stroke();
    ctx.font="24px sans-serif"; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(ti.emoji, 0, 1);
    ctx.shadowBlur=0;
    if(dist(it,player)<200){
      ctx.font="10px 'Rajdhani', sans-serif"; ctx.fillStyle=ti.accent; ctx.textAlign='center'; ctx.textBaseline='alphabetic';
      ctx.fillText(`${ti.name}（${ti.desc}）`, 0, -26);
    }
  }
  ctx.restore();
}
function drawProjectile(pr,p){
  ctx.save();
  ctx.translate(p.x,p.y);
  ctx.scale(p.scale,p.scale);

  if(pr.projStyle==='tornado'){
    // 竜巻アタック(ゴーレム): 回転する渦を段積みで描く(上ほど広い漏斗型)
    const r = (pr.hitR||14);
    const spin = matchTime*9;
    if(!renderHeavyLoad){ ctx.shadowBlur=16; ctx.shadowColor='#d8c49a'; }
    for(let k=0;k<4;k++){
      const ky = -k*r*0.42;
      const kw = r*(0.55 + k*0.3);
      ctx.beginPath();
      ctx.ellipse(Math.sin(spin+k*1.3)*r*0.12, ky, kw, kw*0.34, 0, 0, Math.PI*2);
      ctx.fillStyle = k%2 ? '#b39a72' : '#8f775a';
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(Math.sin(spin+k*1.3)*r*0.12, ky, kw, kw*0.34, 0, spin+k, spin+k+Math.PI*1.2);
      ctx.stroke();
    }
    // 巻き上げられた破片
    for(let d=0;d<4;d++){
      const a = spin*1.4 + d*(Math.PI/2);
      const rr = r*(0.7+0.3*Math.sin(spin+d));
      ctx.beginPath();
      ctx.arc(Math.cos(a)*rr, -r*0.6 + Math.sin(a)*rr*0.3, 2.6, 0, Math.PI*2);
      ctx.fillStyle = '#e8dcc0'; ctx.globalAlpha = 0.9; ctx.fill();
    }
    ctx.restore();
    return;
  }
  if(pr.projStyle==='holy'){
    // 天の慈悲(アーク): 黄金の聖剣+回転する光輪と光条
    const r = (pr.hitR||14)*1.3;
    const travelAngle = (pr.vx!=null && pr.vy!=null) ? Math.atan2(pr.vy,pr.vx) : 0;
    const spin = matchTime*2.2;
    if(!renderHeavyLoad){ ctx.shadowBlur=18; ctx.shadowColor='#ffe9a8'; }
    ctx.save();
    ctx.rotate(spin);
    ctx.strokeStyle='rgba(255,233,168,0.8)'; ctx.lineWidth=2.2;
    ctx.beginPath(); ctx.arc(0,0,r*1.5,0,Math.PI*2); ctx.stroke();
    ctx.globalAlpha=0.75;
    for(let i=0;i<4;i++){
      const a=i*(Math.PI/2);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a)*r*1.5, Math.sin(a)*r*1.5);
      ctx.lineTo(Math.cos(a)*r*2.15, Math.sin(a)*r*2.15);
      ctx.stroke();
    }
    ctx.restore();
    ctx.rotate(travelAngle-camState.yaw);
    ctx.beginPath();
    ctx.moveTo(r*1.5,0); ctx.lineTo(-r*0.7,-r*0.85); ctx.lineTo(-r*0.35,0); ctx.lineTo(-r*0.7,r*0.85);
    ctx.closePath();
    ctx.fillStyle='#ffe9a8'; ctx.fill();
    ctx.strokeStyle='#ffffff'; ctx.lineWidth=2; ctx.stroke();
    ctx.restore();
    return;
  }
  if(pr.projStyle==='shell'){
    // シェルアタック(ワーム): 回転する黄色い発光球+周囲に毒紫の電撃(ビリビリ)
    const r = (pr.hitR||14)*1.1;
    const spin = matchTime*8;
    if(!renderHeavyLoad){ ctx.shadowBlur=18; ctx.shadowColor='#ffd93d'; }
    // 本体: 黄色く発光する球
    const grad = ctx.createRadialGradient(-r*0.25,-r*0.25,r*0.1, 0,0,r);
    grad.addColorStop(0,'#fffbe0');
    grad.addColorStop(0.45,'#ffd93d');
    grad.addColorStop(1,'#e8a00c');
    ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2);
    ctx.fillStyle=grad; ctx.fill();
    // 回転を見せる明るい帯(3本の楕円バンドを回す)
    ctx.strokeStyle='rgba(255,255,255,0.6)'; ctx.lineWidth=2;
    for(let i=0;i<3;i++){
      const a = spin + i*(Math.PI*2/3);
      ctx.beginPath(); ctx.ellipse(0,0,r*0.92,r*0.32,a,0,Math.PI*2); ctx.stroke();
    }
    ctx.shadowBlur=0;
    // 周囲の毒紫ビリビリ: フレームごとに形が変わる稲妻アーク
    const jseed = Math.floor(matchTime*16);
    ctx.lineCap='round'; ctx.lineJoin='round';
    for(let k=0;k<4;k++){
      const baseA = fxHash01(jseed*13+k*7)*Math.PI*2;
      const arcSpan = 0.9 + fxHash01(jseed*29+k*11)*0.9;
      const segs = 5;
      ctx.beginPath();
      for(let s=0;s<=segs;s++){
        const a = baseA + arcSpan*(s/segs);
        const rr = r*1.4 + (fxHash01(jseed*37+k*17+s*5)-0.5)*r*0.7;
        const px=Math.cos(a)*rr, py=Math.sin(a)*rr;
        if(s===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.globalAlpha=0.5; ctx.strokeStyle='#8b2fc9'; ctx.lineWidth=4.5; ctx.stroke();
      ctx.globalAlpha=0.9; ctx.strokeStyle='#d9a3ff'; ctx.lineWidth=2; ctx.stroke();
    }
    ctx.globalAlpha=1;
    ctx.restore();
    return;
  }
  if(pr.projStyle==='requiem'){
    // レクイエムエンド(イルミネ): 黒よりの紫を基調にした3形態の投擲武器
    // (1発目=クナイ / 2発目=トゲトゲの球体 / 3発目=手裏剣)が回転しながら進む
    const r = (pr.hitR||14)*1.3;
    const DARK='#1d0b2e', MID='#3a1560', EDGE='#8b46c9', HILITE='#c98bff';
    if(!renderHeavyLoad){ ctx.shadowBlur=16; ctx.shadowColor=EDGE; }
    const spin = matchTime*11 + (pr.id||0);
    ctx.rotate(spin);
    ctx.lineJoin='round';
    const form = (pr.burstIndex||0) % 3;
    if(form===0){
      // クナイ: 細長い刃+柄+尾のリング
      ctx.beginPath();
      ctx.moveTo(r*1.9,0); ctx.lineTo(r*0.15,-r*0.5); ctx.lineTo(r*0.15,r*0.5);
      ctx.closePath();
      ctx.fillStyle=MID; ctx.fill();
      ctx.strokeStyle=EDGE; ctx.lineWidth=1.6; ctx.stroke();
      ctx.fillStyle=DARK;
      ctx.fillRect(-r*0.95, -r*0.18, r*1.1, r*0.36);
      ctx.strokeStyle=EDGE; ctx.lineWidth=1.2; ctx.strokeRect(-r*0.95, -r*0.18, r*1.1, r*0.36);
      ctx.beginPath(); ctx.arc(-r*1.3,0,r*0.4,0,Math.PI*2);
      ctx.strokeStyle=HILITE; ctx.lineWidth=1.8; ctx.stroke();
      ctx.strokeStyle='rgba(255,255,255,0.7)'; ctx.lineWidth=1.1;
      ctx.beginPath(); ctx.moveTo(r*1.7,0); ctx.lineTo(r*0.3,0); ctx.stroke();
    } else if(form===1){
      // トゲトゲの球体: 芯の球+放射状のトゲ
      ctx.fillStyle=MID; ctx.strokeStyle=EDGE; ctx.lineWidth=1.4;
      for(let k=0;k<8;k++){
        const a = k*(Math.PI/4);
        ctx.save(); ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(r*1.45,0); ctx.lineTo(r*0.55,-r*0.3); ctx.lineTo(r*0.55,r*0.3);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      const grad = ctx.createRadialGradient(-r*0.2,-r*0.2,r*0.1, 0,0,r*0.85);
      grad.addColorStop(0,MID); grad.addColorStop(1,DARK);
      ctx.beginPath(); ctx.arc(0,0,r*0.85,0,Math.PI*2);
      ctx.fillStyle=grad; ctx.fill();
      ctx.strokeStyle=EDGE; ctx.lineWidth=1.6; ctx.stroke();
      ctx.beginPath(); ctx.arc(-r*0.25,-r*0.25,r*0.3,0,Math.PI*2);
      ctx.fillStyle='rgba(201,139,255,0.35)'; ctx.fill();
    } else {
      // 手裏剣: 4枚刃の星形+中心の穴
      ctx.beginPath();
      for(let k=0;k<4;k++){
        const a = k*(Math.PI/2);
        const ia = a + Math.PI/4;
        const ox=Math.cos(a)*r*1.7, oy=Math.sin(a)*r*1.7;
        const ix=Math.cos(ia)*r*0.5, iy=Math.sin(ia)*r*0.5;
        if(k===0) ctx.moveTo(ox,oy); else ctx.lineTo(ox,oy);
        ctx.lineTo(ix,iy);
      }
      ctx.closePath();
      ctx.fillStyle=DARK; ctx.fill();
      ctx.strokeStyle=EDGE; ctx.lineWidth=1.6; ctx.stroke();
      ctx.beginPath(); ctx.arc(0,0,r*0.28,0,Math.PI*2);
      ctx.strokeStyle=HILITE; ctx.lineWidth=1.8; ctx.stroke();
    }
    // 回転の残光: 紫のうっすらした円弧
    ctx.globalAlpha=0.3;
    ctx.beginPath(); ctx.arc(0,0,r*1.55, spin*2, spin*2+Math.PI*0.9);
    ctx.strokeStyle=HILITE; ctx.lineWidth=2; ctx.stroke();
    ctx.globalAlpha=1;
    ctx.restore();
    return;
  }

  if(pr.shape==='triangle'){
    if(!renderHeavyLoad){ ctx.shadowBlur=14; ctx.shadowColor=pr.color; }
    const travelAngle = (pr.vx!=null && pr.vy!=null) ? Math.atan2(pr.vy,pr.vx) : 0;
    ctx.rotate(travelAngle-camState.yaw);
    const r = (pr.hitR||14)*1.3;
    ctx.beginPath();
    ctx.moveTo(r*1.4,0);
    ctx.lineTo(-r*0.7,-r*0.9);
    ctx.lineTo(-r*0.7,r*0.9);
    ctx.closePath();
    ctx.fillStyle = pr.color; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
  } else if(pr.shape==='sphere'){
    const spin = matchTime*6;
    if(!renderHeavyLoad){ ctx.shadowBlur=14; ctx.shadowColor=pr.color; }
    const r = (pr.hitR||14)*1.2;
    ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2);
    ctx.fillStyle = pr.color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2;
    for(let i=0;i<3;i++){
      const a = spin + i*(Math.PI*2/3);
      ctx.beginPath();
      ctx.ellipse(0,0,r,r*0.35,a,0,Math.PI*2);
      ctx.stroke();
    }
  } else if(pr.icon){
    if(!renderHeavyLoad){ ctx.shadowBlur=8; ctx.shadowColor=pr.color; }
    ctx.font = `${Math.round((pr.hitR||10)*1.8)}px sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(pr.icon, 0, 1);
  } else {
    if(!renderHeavyLoad){ ctx.shadowBlur=10; ctx.shadowColor=pr.color; }
    ctx.fillStyle=pr.color;
    ctx.beginPath();
    if(pr.hitW>pr.hitR){
      ctx.rotate(-camState.yaw);
      ctx.ellipse(0,0,pr.hitW*0.8,pr.hitR*0.8,0,0,Math.PI*2);
    } else {
      ctx.arc(0,0,pr.hitR,0,Math.PI*2);
    }
    ctx.fill();
  }
  ctx.restore();
}
function drawParticle(pt,p){
  const a = clamp(pt.life/pt.maxLife,0,1);
  ctx.save();
  ctx.translate(p.x,p.y);
  if(pt.type==='text'){
    ctx.scale(p.scale,p.scale);
    ctx.font="bold 13px 'Share Tech Mono', monospace";
    ctx.fillStyle = pt.color; ctx.globalAlpha=a; ctx.textAlign='center';
    ctx.fillText(pt.text, 0,0);
  } else {
    ctx.beginPath(); ctx.arc(0,0,Math.max(0.5,pt.size*a*p.scale),0,Math.PI*2);
    ctx.fillStyle=pt.color; ctx.globalAlpha=a; ctx.fill();
  }
  ctx.restore();
}
function rockFlavorColors(flavor){
  if(flavor==='snowrock') return { fill:'#7c8a99', stroke:'#4a5666' };
  if(flavor==='sandrock') return { fill:'#a68a5c', stroke:'#6b5636' };
  return { fill:'#5a6470', stroke:'#33394a' };
}
function drawTreeObstacle(rock){
  const r = rock.radius;
  ctx.beginPath(); ctx.ellipse(0, r*0.15, r*0.95, r*0.3, 0,0,Math.PI*2);
  ctx.fillStyle='rgba(0,0,0,0.28)'; ctx.fill();
  ctx.translate(0,-r*0.9);
  ctx.fillStyle='#4a3420';
  ctx.fillRect(-r*0.12, r*0.15, r*0.24, r*0.95);
  ctx.beginPath(); ctx.ellipse(0,-r*0.25, r*0.85, r*0.72, 0,0,Math.PI*2);
  ctx.fillStyle='#2e6b2f'; ctx.fill();
  ctx.beginPath(); ctx.ellipse(-r*0.2,-r*0.5, r*0.48, r*0.42, 0,0,Math.PI*2);
  ctx.fillStyle='#3a8a3c'; ctx.fill();
}
function drawShellObstacle(rock){
  const r = rock.radius;
  // 影を貝殻の底辺(y=0)の直下に敷き、本体を持ち上げない(浮いて見える不具合の修正)
  ctx.beginPath(); ctx.ellipse(0, r*0.08, r*1.0, r*0.26, 0,0,Math.PI*2);
  ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fill();
  const pts=7;
  ctx.beginPath();
  for(let i=0;i<=pts;i++){
    const a = Math.PI*(i/pts);
    const px = Math.cos(a)*r, py = -Math.sin(a)*r*0.8;
    if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
  }
  ctx.closePath();
  ctx.fillStyle='#f0dcc0'; ctx.strokeStyle='#c9a67a'; ctx.lineWidth=2;
  ctx.fill(); ctx.stroke();
  for(let i=1;i<pts;i++){
    const a = Math.PI*(i/pts);
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.lineTo(Math.cos(a)*r, -Math.sin(a)*r*0.8);
    ctx.strokeStyle='rgba(180,140,100,0.5)'; ctx.lineWidth=1;
    ctx.stroke();
  }
}
function drawRock(rock,p){
  const r = rock.radius;
  const flavor = rock.flavor||'rock';
  ctx.save();
  ctx.translate(p.x,p.y);
  ctx.scale(p.scale,p.scale);
  if(flavor==='tree'){ drawTreeObstacle(rock); ctx.restore(); return; }
  if(flavor==='shell'){ drawShellObstacle(rock); ctx.restore(); return; }
  ctx.translate(0,-r*0.55);
  ctx.beginPath(); ctx.ellipse(0, r*0.6, r*1.1, r*0.32, 0,0,Math.PI*2);
  ctx.fillStyle='rgba(0,0,0,0.3)'; ctx.fill();
  const colors = rockFlavorColors(flavor);
  ctx.fillStyle=colors.fill; ctx.strokeStyle=colors.stroke; ctx.lineWidth=2.5;
  ctx.beginPath();
  const pts=8;
  for(let i=0;i<pts;i++){
    const a=(i/pts)*Math.PI*2;
    const rr = r*(0.78+0.22*Math.sin(a*2.3+rock.seed));
    const px=Math.cos(a)*rr, py=Math.sin(a)*rr*0.85;
    if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(-r*0.22,-r*0.28,r*0.32,r*0.2,0.3,0,Math.PI*2);
  ctx.fillStyle='rgba(255,255,255,0.1)'; ctx.fill();
  if(flavor==='snowrock'){
    ctx.beginPath(); ctx.ellipse(0,-r*0.35,r*0.55,r*0.28,0,Math.PI,Math.PI*2);
    ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.fill();
  }
  ctx.restore();
}
function drawCrystal(c,p){
  const r = c.radius;
  ctx.save();
  ctx.translate(p.x,p.y);
  ctx.scale(p.scale,p.scale);
  // 底の頂点が影(接地点)に触れる高さまでしか持ち上げない(浮いて見える不具合の修正)
  ctx.translate(0,-r*0.2);
  ctx.beginPath(); ctx.ellipse(0, r*0.2, r*1.0, r*0.3, 0,0,Math.PI*2);
  ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fill();
  const pts = 6;
  ctx.beginPath();
  for(let i=0;i<pts;i++){
    const a = (i/pts)*Math.PI*2 + c.seed;
    const rr = r*(i%2===0 ? 1.0 : 0.45);
    const px = Math.cos(a)*rr, py = Math.sin(a)*rr*0.7 - r*(i%2===0 ? 0.9 : 0.1);
    if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
  }
  ctx.closePath();
  ctx.fillStyle='rgba(200,235,255,0.85)';
  ctx.strokeStyle='rgba(140,200,235,0.95)'; ctx.lineWidth=2;
  ctx.shadowBlur=14; ctx.shadowColor='rgba(180,230,255,0.8)';
  ctx.fill(); ctx.stroke();
  ctx.shadowBlur=0;
  ctx.restore();
}
function rampCorners(b){
  const rw = (b.rampSide===0||b.rampSide===1) ? b.hw*0.9 : b.hd*0.9;
  if(b.rampSide===0){
    const nearY=b.cy+b.hd, farY=nearY+b.rampLen;
    return { nearA:{x:b.cx-rw,y:nearY,z:b.wallH}, nearB:{x:b.cx+rw,y:nearY,z:b.wallH}, farA:{x:b.cx-rw,y:farY,z:0}, farB:{x:b.cx+rw,y:farY,z:0} };
  }
  if(b.rampSide===1){
    const nearY=b.cy-b.hd, farY=nearY-b.rampLen;
    return { nearA:{x:b.cx-rw,y:nearY,z:b.wallH}, nearB:{x:b.cx+rw,y:nearY,z:b.wallH}, farA:{x:b.cx-rw,y:farY,z:0}, farB:{x:b.cx+rw,y:farY,z:0} };
  }
  if(b.rampSide===2){
    const nearX=b.cx+b.hw, farX=nearX+b.rampLen;
    return { nearA:{x:nearX,y:b.cy-rw,z:b.wallH}, nearB:{x:nearX,y:b.cy+rw,z:b.wallH}, farA:{x:farX,y:b.cy-rw,z:0}, farB:{x:farX,y:b.cy+rw,z:0} };
  }
  const nearX=b.cx-b.hw, farX=nearX-b.rampLen;
  return { nearA:{x:nearX,y:b.cy-rw,z:b.wallH}, nearB:{x:nearX,y:b.cy+rw,z:b.wallH}, farA:{x:farX,y:b.cy-rw,z:0}, farB:{x:farX,y:b.cy+rw,z:0} };
}
function drawRamp(b){
  const c = rampCorners(b);
  const pNA=project(c.nearA.x,c.nearA.y,c.nearA.z), pNB=project(c.nearB.x,c.nearB.y,c.nearB.z);
  const pFA=project(c.farA.x,c.farA.y,c.farA.z), pFB=project(c.farB.x,c.farB.y,c.farB.z);
  if(!pNA||!pNB||!pFA||!pFB) return;
  ctx.beginPath();
  ctx.moveTo(pFA.x,pFA.y); ctx.lineTo(pFB.x,pFB.y); ctx.lineTo(pNB.x,pNB.y); ctx.lineTo(pNA.x,pNA.y); ctx.closePath();
  ctx.fillStyle='#7d8aa0'; ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,0.3)'; ctx.lineWidth=1.5; ctx.stroke();
  ctx.strokeStyle='rgba(0,0,0,0.18)'; ctx.lineWidth=1;
  for(let i=1;i<5;i++){
    const t=i/5;
    const a={x:lerp(c.nearA.x,c.farA.x,t), y:lerp(c.nearA.y,c.farA.y,t), z:lerp(c.nearA.z,c.farA.z,t)};
    const bb={x:lerp(c.nearB.x,c.farB.x,t), y:lerp(c.nearB.y,c.farB.y,t), z:lerp(c.nearB.z,c.farB.z,t)};
    const pa=project(a.x,a.y,a.z), pb=project(bb.x,bb.y,bb.z);
    if(pa&&pb){ ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.stroke(); }
  }
}
function drawBuilding(b){
  const showEast = camPos.x > b.cx + b.hw*0.2;
  const showWest = camPos.x < b.cx - b.hw*0.2;
  const showSouth = camPos.y > b.cy + b.hd*0.2;
  const showNorth = camPos.y < b.cy - b.hd*0.2;
  const c = {
    nw:{x:b.cx-b.hw,y:b.cy-b.hd}, ne:{x:b.cx+b.hw,y:b.cy-b.hd},
    se:{x:b.cx+b.hw,y:b.cy+b.hd}, sw:{x:b.cx-b.hw,y:b.cy+b.hd},
  };
  function wallPoly(c1,c2,shade){
    const p1t=project(c1.x,c1.y,b.wallH), p2t=project(c2.x,c2.y,b.wallH);
    const p1b=project(c1.x,c1.y,0), p2b=project(c2.x,c2.y,0);
    if(!p1t||!p2t||!p1b||!p2b) return;
    ctx.beginPath();
    ctx.moveTo(p1b.x,p1b.y); ctx.lineTo(p2b.x,p2b.y); ctx.lineTo(p2t.x,p2t.y); ctx.lineTo(p1t.x,p1t.y); ctx.closePath();
    ctx.fillStyle=shade; ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.35)'; ctx.lineWidth=1.5; ctx.stroke();
  }
  if(showSouth) wallPoly(c.sw, c.se, '#4a5566');
  if(showNorth) wallPoly(c.nw, c.ne, '#4a5566');
  if(showEast)  wallPoly(c.ne, c.se, '#546073');
  if(showWest)  wallPoly(c.nw, c.sw, '#546073');

  const rp = [c.nw,c.ne,c.se,c.sw].map(pt=>project(pt.x,pt.y,b.wallH));
  if(rp.every(pt=>pt)){
    ctx.beginPath();
    ctx.moveTo(rp[0].x,rp[0].y);
    for(let i=1;i<rp.length;i++) ctx.lineTo(rp[i].x,rp[i].y);
    ctx.closePath();
    ctx.fillStyle='#6b7790'; ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.3)'; ctx.lineWidth=1.5; ctx.stroke();
  }
  drawRamp(b);
}
function projectCircleRing(center, radius, segments){
  const pts = [];
  for(let i=0;i<=segments;i++){
    const a = (i/segments)*Math.PI*2;
    const p = project(center.x+Math.cos(a)*radius, center.y+Math.sin(a)*radius, 0);
    if(p) pts.push(p);
  }
  return pts;
}
function strokeProjectedRing(pts, strokeStyle, lineWidth, dash, glow){
  if(pts.length<3) return;
  ctx.save();
  ctx.setLineDash(dash||[]);
  ctx.lineWidth=lineWidth;
  if(glow){ ctx.shadowBlur=glow.blur; ctx.shadowColor=glow.color; }
  ctx.strokeStyle=strokeStyle;
  ctx.beginPath();
  ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
  ctx.stroke();
  ctx.restore();
}
const ZONE_HUGE_RADIUS_THRESHOLD = 3200; // これより大きい半径の円は、プレイヤー付近だけ高解像度サンプリングする
// 巨大な安全圏の円をそのまま360度分投影すると、プレイヤー付近以外の遠い点まで巻き込んで
// 破綻していた。半径が大きい場合は、プレイヤー最寄りの境界点を中心にした狭い角度範囲だけを
// 高解像度でサンプリングすることで、実際の円弧として綺麗に(かつ安全に)描画する。
function projectCircleArcLocal(center, radius, segments, windowRad){
  const centerAngle = angTo(center, player); // 中心から見てプレイヤー方向 = 最寄りの境界点の方角
  const pts = [];
  for(let i=0;i<=segments;i++){
    const a = centerAngle - windowRad + (i/segments)*windowRad*2;
    const p = project(center.x+Math.cos(a)*radius, center.y+Math.sin(a)*radius, 0);
    if(p) pts.push(p);
  }
  return pts;
}
function drawZoneRings(){
  const ZONE_RENDER_THRESHOLD = 4000; // これより境界から離れていれば描画不要
  drawOneZoneRing(zoneState.center, zoneState.radius, 'rgba(244,196,48,0.85)', 4, [20,16], {blur:16,color:'rgba(244,196,48,0.6)'}, ZONE_RENDER_THRESHOLD);
  // 縮小中だけでなく安定中も、次の縮小先(予測)を同じ点線スタイルで表示する。
  // 雪山マップでは白い点線が雪面と同化して見えないため青系に変える。
  if(zoneState.shrinking || zoneState.hasNext){
    const predColor = currentMap.mountainStyle==='snow' ? 'rgba(80,150,255,0.8)' : 'rgba(255,255,255,0.32)';
    drawOneZoneRing(zoneState.toCenter, zoneState.toRadius, predColor, 2, [6,9], null, ZONE_RENDER_THRESHOLD);
  }
}
function drawOneZoneRing(center, radius, strokeStyle, lineWidth, dash, glow, threshold){
  const distToEdge = Math.abs(dist(player, center) - radius);
  if(distToEdge >= threshold) return;
  if(radius > ZONE_HUGE_RADIUS_THRESHOLD){
    const ring = projectCircleArcLocal(center, radius, 60, Math.PI/6); // 中心±30度だけを高解像度サンプリング
    strokeProjectedRing(ring, strokeStyle, lineWidth, dash, glow);
  } else {
    const ring = projectCircleRing(center, radius, 90);
    strokeProjectedRing(ring, strokeStyle, lineWidth, dash, glow);
  }
}
function drawSkyAndGround(){
  const horizonY = clamp(viewH/2 - FOCAL*Math.tan(camState.pitch), -40, viewH+40);
  const sky = ctx.createLinearGradient(0,0,0,Math.max(horizonY,1));
  sky.addColorStop(0,'#05070d'); sky.addColorStop(1,'#0d1726');
  ctx.fillStyle = sky;
  ctx.fillRect(0,0,viewW, Math.max(horizonY,0));
  ctx.fillStyle = currentMap.groundColor || '#142433';
  ctx.fillRect(0, Math.max(horizonY,0), viewW, viewH-Math.max(horizonY,0));
}
function drawTerrainDecor(){
  for(const d of terrainDecor){
    if(Math.abs(d.x-player.x)>1000 || Math.abs(d.y-player.y)>1000) continue;
    const p = project(d.x,d.y,0);
    if(!p || p.x<-40||p.x>viewW+40||p.y<-40||p.y>viewH+40) continue;
    ctx.beginPath(); ctx.ellipse(p.x,p.y, d.r*p.scale, d.r*p.scale*0.4, 0,0,Math.PI*2);
    ctx.fillStyle = d.shade==='dark' ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.06)';
    ctx.fill();
  }
}
function drawDangerVignette(){
  const d = dist(player, zoneState.center);
  const outside = d > zoneState.radius;
  ctx.save();
  if(outside){
    const t = clamp((d-zoneState.radius)/150, 0, 1);
    const pulse = 0.5+0.5*Math.sin(matchTime*4);
    const alpha = clamp(0.10 + 0.16*t + 0.08*pulse*t, 0, 0.5);
    const grad = ctx.createRadialGradient(viewW/2,viewH/2, Math.min(viewW,viewH)*0.2, viewW/2,viewH/2, Math.max(viewW,viewH)*0.75);
    grad.addColorStop(0,'rgba(200,80,0,0)');
    grad.addColorStop(1, `rgba(255,90,20,${alpha})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,viewW,viewH);
  } else {
    // 内側でも境界に近づくにつれて、じわじわ強くなる警告ビネット(黄〜橙)を出す。
    // 視線方向に依存しないので、いきなり安置外になって驚くことがない。
    const distToEdge = zoneState.radius - d;
    const WARN_RANGE = 1000;
    if(distToEdge < WARN_RANGE){
      const t = clamp(1-(distToEdge/WARN_RANGE), 0, 1);
      const pulse = 0.5+0.5*Math.sin(matchTime*2.6);
      const alpha = clamp(0.05*t*t + 0.05*pulse*t*t, 0, 0.22);
      const grad = ctx.createRadialGradient(viewW/2,viewH/2, Math.min(viewW,viewH)*0.25, viewW/2,viewH/2, Math.max(viewW,viewH)*0.75);
      grad.addColorStop(0,'rgba(244,196,48,0)');
      grad.addColorStop(1, `rgba(244,196,48,${alpha})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0,0,viewW,viewH);
    }
  }
  ctx.restore();
}
// 安全圏の中心方向を指すコンパス矢印。視点の向きに関係なく常に正しい方向を示すため、
// 地面の塗り分けに頼らずに「どちらが安置内か」を確実に伝えられる。
function drawZoneCompass(){
  const d = dist(player, zoneState.center);
  const outside = d > zoneState.radius;
  const distToEdge = Math.abs(d - zoneState.radius);
  if(!outside && distToEdge > 3000) return; // 十分安全な時は非表示

  const bearingWorld = angTo(player, zoneState.center);
  const bearingScreen = bearingWorld - camState.yaw;
  const cx = viewW/2, cy = 70, r = 24;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2);
  ctx.fillStyle = outside ? 'rgba(255,60,20,0.22)' : 'rgba(244,196,48,0.14)';
  ctx.fill();
  ctx.strokeStyle = outside ? 'rgba(255,110,50,0.9)' : 'rgba(244,196,48,0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.rotate(bearingScreen);
  ctx.beginPath();
  ctx.moveTo(0,-r*0.75);
  ctx.lineTo(-r*0.38, r*0.3);
  ctx.lineTo(0, r*0.08);
  ctx.lineTo(r*0.38, r*0.3);
  ctx.closePath();
  ctx.fillStyle = outside ? '#ff4a1f' : '#f4c430';
  ctx.shadowBlur = 10; ctx.shadowColor = outside ? 'rgba(255,60,20,0.9)' : 'rgba(244,196,48,0.7)';
  ctx.fill();
  ctx.restore();

  if(outside){
    ctx.save();
    ctx.font = "bold 11px 'Rajdhani', sans-serif";
    ctx.fillStyle = '#ff9c5a'; ctx.textAlign = 'center';
    ctx.fillText(`安置まで ${Math.round(distToEdge)}m`, cx, cy+r+15);
    ctx.restore();
  }
}
function fanOutlinePoints(x,y,angle,range,halfAngleRad,segs){
  const center = project(x,y,0);
  if(!center) return null;
  const pts = [center];
  for(let i=0;i<=segs;i++){
    const a = angle - halfAngleRad + (i/segs)*halfAngleRad*2;
    const pp = project(x+Math.cos(a)*range, y+Math.sin(a)*range, 0);
    if(pp) pts.push(pp);
  }
  return pts.length>=3 ? pts : null;
}
function rectOutlinePoints(x,y,angle,range,halfWidth){
  const fx=Math.cos(angle), fy=Math.sin(angle);
  const rx=-Math.sin(angle), ry=Math.cos(angle);
  const corners = [
    {x:x+rx*halfWidth, y:y+ry*halfWidth},
    {x:x-rx*halfWidth, y:y-ry*halfWidth},
    {x:x-rx*halfWidth+fx*range, y:y-ry*halfWidth+fy*range},
    {x:x+rx*halfWidth+fx*range, y:y+ry*halfWidth+fy*range},
  ];
  const pts = corners.map(c=>project(c.x,c.y,0)).filter(Boolean);
  return pts.length>=3 ? pts : null;
}
function strokeDashedShape(pts, color, alpha){
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.setLineDash([10,8]);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}
function fillShape(pts, color, alpha){
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.shadowBlur=18; ctx.shadowColor=color;
  ctx.fill();
  ctx.restore();
}
// 溶岩流のように波打つ帯を、焦茶(外)→赤(中)→オレンジ(芯)の3層のポリゴンで地面に沿って描画する
function drawLavaWaveEffect(ae, fillDist, fadeAlpha, inTelegraph){
  const outline = rectOutlinePoints(ae.x, ae.y, ae.angle, ae.range, ae.width/2);
  if(outline) strokeDashedShape(outline, '#ff8a3d', 0.5*fadeAlpha);
  if(inTelegraph) return;
  const curReach = Math.min(ae.range, fillDist);
  if(curReach<=2) return;

  const fx=Math.cos(ae.angle), fy=Math.sin(ae.angle);
  const rx=-Math.sin(ae.angle), ry=Math.cos(ae.angle);
  const segs = Math.max(8, Math.round(18*(curReach/Math.max(ae.range,1))));
  const t = matchTime*2.6;

  // 世界座標でうねる帯状ポリゴンを作る(各頂点を個別に地面(z=0)へ投影するため、遠近感が正しく付く)
  function buildBandPoints(halfWidthFrac){
    const top=[], bot=[];
    for(let i=0;i<=segs;i++){
      const along = curReach*(i/segs);
      const wobble = Math.sin(along*0.018+t)*ae.width*0.22 + Math.sin(along*0.05-t*1.7)*ae.width*0.1;
      const hw = ae.width*halfWidthFrac*0.5;
      const cx = ae.x+fx*along+rx*wobble, cy = ae.y+fy*along+ry*wobble;
      const tp = project(cx+rx*hw, cy+ry*hw, 0);
      const bp = project(cx-rx*hw, cy-ry*hw, 0);
      if(tp) top.push(tp);
      if(bp) bot.push(bp);
    }
    if(top.length<2 || bot.length<2) return null;
    return top.concat(bot.reverse());
  }

  const outer = buildBandPoints(0.95);
  const mid   = buildBandPoints(0.6);
  const core  = buildBandPoints(0.28);
  if(outer) fillShape(outer, '#3a1710', 0.55*fadeAlpha);
  if(mid)   fillShape(mid,   '#c9291a', 0.7*fadeAlpha);
  if(core)  fillShape(core,  '#ff9a3d', 0.9*fadeAlpha);
}

/* ---------- Tier3技の専用エフェクト(ヒノトリの溶岩流と同じ多層バンド方式) ---------- */
// エフェクトごとに決定的な乱数を得る(毎フレーム同じ配置で揺らぎだけ動かすため)
function fxHash01(x){ const s = Math.sin(x)*43758.5453; return s - Math.floor(s); }

// 地面上の1点に煌めき(星・花びら・結晶・火の粉)を描く
function drawGroundSpark(p, kind, color, alpha, seed){
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(p.scale, p.scale);
  ctx.globalAlpha = Math.min(1, alpha);
  if(kind==='star'){
    const s = 7 + fxHash01(seed*3.7)*5;
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(-s,0); ctx.lineTo(s,0);
    ctx.moveTo(0,-s); ctx.lineTo(0,s);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0,0,2.2,0,Math.PI*2); ctx.fillStyle='#ffffff'; ctx.fill();
  } else if(kind==='petal'){
    const rot = fxHash01(seed*7.1)*Math.PI + matchTime*0.8;
    ctx.rotate(rot);
    ctx.beginPath(); ctx.ellipse(0,0,6.5,3.6,0,0,Math.PI*2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.75)'; ctx.lineWidth=1; ctx.stroke();
  } else if(kind==='diamond'){
    const s = 5.5 + fxHash01(seed*5.3)*4;
    ctx.rotate(Math.PI/4 + fxHash01(seed*9.9)*0.6);
    ctx.beginPath(); ctx.rect(-s/2,-s/2,s,s);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.85)'; ctx.lineWidth=1.2; ctx.stroke();
  } else { // ember
    const s = 2 + fxHash01(seed*4.9)*2.5;
    ctx.beginPath(); ctx.arc(0,0,s,0,Math.PI*2);
    ctx.fillStyle = color;
    ctx.shadowBlur = 10; ctx.shadowColor = color;
    ctx.fill();
  }
  ctx.restore();
}

// 帯(rect)の内側に煌めきをばらまく
function drawBandSparkles(ae, curReach, fadeAlpha, kind, color){
  if(renderHeavyLoad) return;
  const fx=Math.cos(ae.angle), fy=Math.sin(ae.angle);
  const rx=-Math.sin(ae.angle), ry=Math.cos(ae.angle);
  const n = Math.min(16, Math.round(curReach/90)+5);
  for(let i=0;i<n;i++){
    const h1 = fxHash01(ae.id*13.37 + i*7.77);
    const h2 = fxHash01(ae.id*3.19 + i*13.31);
    const along = curReach * ((i + h1) / n);
    const lateral = (h2*2-1) * ae.width*0.34;
    const p = project(ae.x+fx*along+rx*lateral, ae.y+fy*along+ry*lateral, 0);
    if(!p) continue;
    const tw = 0.45 + 0.55*Math.sin(matchTime*5.5 + i*2.399 + ae.id);
    if(tw <= 0.1) continue;
    drawGroundSpark(p, kind, color, fadeAlpha*tw, ae.id + i);
  }
}

// 多層バンドの色構成(ヒノトリの溶岩流のフォーマットを他の技に展開)
const AOE_BAND_STYLES = {
  crystal: { outline:'#7fe8e0', layers:[['#0d3f52',0.5],['#3dccc7',0.65],['#d9fffb',0.85]], spark:['diamond','#eafffd'] },
  galaxy:  { outline:'#cdd9ff', layers:[['#232a5c',0.55],['#6f8dff',0.6],['#ffffff',0.85]], spark:['star','#ffffff'] },
  sakura:  { outline:'#ffb3d9', layers:[['#8a2f5c',0.5],['#ff5fb0',0.65],['#ffe3f2',0.85]], spark:['petal','#ffc6e2'] },
};

// クリスタル/天の川/桜: うねる多層バンド+煌めき
function drawStyledWaveEffect(ae, fillDist, fadeAlpha, inTelegraph){
  const st = AOE_BAND_STYLES[ae.style];
  const outline = rectOutlinePoints(ae.x, ae.y, ae.angle, ae.range, ae.width/2);
  if(outline) strokeDashedShape(outline, st.outline, 0.5*fadeAlpha);
  if(inTelegraph) return;
  const curReach = Math.min(ae.range, fillDist);
  if(curReach<=2) return;

  const fx=Math.cos(ae.angle), fy=Math.sin(ae.angle);
  const rx=-Math.sin(ae.angle), ry=Math.cos(ae.angle);
  const segs = Math.max(8, Math.round(18*(curReach/Math.max(ae.range,1))));
  const t = matchTime*2.6;
  function buildBandPoints(halfWidthFrac){
    const top=[], bot=[];
    for(let i=0;i<=segs;i++){
      const along = curReach*(i/segs);
      const wobble = Math.sin(along*0.018+t)*ae.width*0.22 + Math.sin(along*0.05-t*1.7)*ae.width*0.1;
      const hw = ae.width*halfWidthFrac*0.5;
      const cx = ae.x+fx*along+rx*wobble, cy = ae.y+fy*along+ry*wobble;
      const tp = project(cx+rx*hw, cy+ry*hw, 0);
      const bp = project(cx-rx*hw, cy-ry*hw, 0);
      if(tp) top.push(tp);
      if(bp) bot.push(bp);
    }
    if(top.length<2 || bot.length<2) return null;
    return top.concat(bot.reverse());
  }
  const fracs = [0.95, 0.6, 0.28];
  for(let li=0; li<3; li++){
    const pts = buildBandPoints(fracs[li]);
    if(pts) fillShape(pts, st.layers[li][0], st.layers[li][1]*fadeAlpha);
  }
  drawBandSparkles(ae, curReach, fadeAlpha, st.spark[0], st.spark[1]);
}

// インフェルノ(ドラゴン): 炎の舌がゆらめく3層の扇+火の粉
function drawInfernoFanEffect(ae, fillDist, fadeAlpha, inTelegraph){
  const half = (ae.fanAngleDeg||45)*Math.PI/360;
  const outline = fanOutlinePoints(ae.x, ae.y, ae.angle, ae.range, half, 16);
  if(outline) strokeDashedShape(outline, '#ffb35c', 0.55*fadeAlpha);
  if(inTelegraph) return;
  const curReach = Math.min(ae.range, fillDist);
  if(curReach<=2) return;
  const t = matchTime*3.2;
  function flamePts(frac, wobAmp){
    const steps = 20;
    const apex = project(ae.x, ae.y, 0);
    if(!apex) return null;
    const arr=[apex];
    for(let i=0;i<=steps;i++){
      const a = ae.angle - half + (2*half)*(i/steps);
      const wob = 1 + wobAmp*Math.sin(i*1.9 + t) + wobAmp*0.6*Math.sin(i*3.7 - t*1.6);
      const r = curReach*frac*wob;
      const p = project(ae.x+Math.cos(a)*r, ae.y+Math.sin(a)*r, 0);
      if(p) arr.push(p);
    }
    return arr.length>=3 ? arr : null;
  }
  const o = flamePts(1.0, 0.05), m = flamePts(0.76, 0.09), c = flamePts(0.48, 0.13);
  if(o) fillShape(o, '#5a120a', 0.55*fadeAlpha);
  if(m) fillShape(m, '#e8432a', 0.7*fadeAlpha);
  if(c) fillShape(c, '#ffd23d', 0.85*fadeAlpha);
  if(!renderHeavyLoad){
    const n = 10;
    for(let i=0;i<n;i++){
      const h1 = fxHash01(ae.id*11.3 + i*5.7), h2 = fxHash01(ae.id*7.7 + i*3.1);
      const a = ae.angle + (h1*2-1)*half*0.9;
      const rr = curReach * (0.25 + 0.7*h2);
      const rise = 20 + 40*fxHash01(i*2.2 + Math.floor(matchTime*2));
      const p = project(ae.x+Math.cos(a)*rr, ae.y+Math.sin(a)*rr, rise*(0.5+0.5*Math.sin(matchTime*4+i)));
      if(!p) continue;
      const tw = 0.4 + 0.6*Math.sin(matchTime*7 + i*2.1);
      if(tw>0.15) drawGroundSpark(p, 'ember', '#ffd76a', fadeAlpha*tw, ae.id+i);
    }
  }
}

// 超雷撃(ライガー): 毎フレーム震える本物の稲妻(グロー+白い芯+枝分かれ)
function drawThunderBoltEffect(ae, fillDist, fadeAlpha, inTelegraph){
  const outlineRect = rectOutlinePoints(ae.x, ae.y, ae.angle, ae.range, (ae.width||110)/2);
  if(outlineRect) strokeDashedShape(outlineRect, ae.color, 0.4*fadeAlpha);
  if(inTelegraph) return;
  const curReach = Math.min(ae.range, fillDist);
  if(curReach<=2) return;
  const amp = (ae.width||110)*0.5;
  const fx=Math.cos(ae.angle), fy=Math.sin(ae.angle);
  const rx=-Math.sin(ae.angle), ry=Math.cos(ae.angle);
  const jseed = Math.floor(matchTime*16); // 稲妻の形を毎フレーム震わせる
  const segs = Math.max(4, Math.round(10*(curReach/Math.max(ae.range,1))));
  const pts = [];
  const world = [];
  for(let i=0;i<=segs;i++){
    const along = curReach*(i/segs);
    const lateral = (i===0||i===segs) ? 0 : (fxHash01(jseed*31.7 + i*17.3 + ae.id)*2-1)*amp;
    const wx = ae.x+fx*along+rx*lateral, wy = ae.y+fy*along+ry*lateral;
    world.push([wx,wy]);
    const pp = project(wx, wy, 0);
    if(pp) pts.push(pp);
  }
  if(pts.length<2) return;
  const flick = 0.7 + 0.3*Math.sin(matchTime*42);
  function strokePts(list, color, lw, alpha, blur){
    if(list.length<2) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha*fadeAlpha*flick);
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    if(blur && !renderHeavyLoad){ ctx.shadowBlur=blur; ctx.shadowColor=ae.color; }
    ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(list[0].x, list[0].y);
    for(let i=1;i<list.length;i++) ctx.lineTo(list[i].x, list[i].y);
    ctx.stroke();
    ctx.restore();
  }
  strokePts(pts, ae.color, 14, 0.28, 26); // 外側グロー
  strokePts(pts, ae.color, 6, 0.85, 18);  // 本体
  strokePts(pts, '#ffffff', 2.2, 0.95, 0); // 白い芯
  // 枝分かれ: 中間の頂点からランダムに短い枝を伸ばす
  for(let b=0;b<3;b++){
    const vi = 1 + Math.floor(fxHash01(jseed*7.7 + b*29.1 + ae.id)* (Math.max(1,segs-2)));
    if(vi>=world.length) continue;
    const [wx,wy] = world[vi];
    const ba = ae.angle + (fxHash01(jseed*3.3+b*11.1)*2-1)*1.2;
    const bl = amp*(0.8+fxHash01(jseed*5.5+b*13.7));
    const p1 = project(wx, wy, 0);
    const p2 = project(wx+Math.cos(ba)*bl, wy+Math.sin(ba)*bl, 0);
    if(p1&&p2){ strokePts([p1,p2], ae.color, 3.5, 0.7, 12); strokePts([p1,p2], '#ffffff', 1.4, 0.8, 0); }
  }
}

// サイコキネシス(スエゾー): 位相のずれた3本の念力波+白い芯
function drawPsychicWaveEffect(ae, fillDist, fadeAlpha, inTelegraph){
  const half = (ae.fanAngleDeg||30)*Math.PI/360;
  const outline = fanOutlinePoints(ae.x, ae.y, ae.angle, ae.range, half, 16);
  if(outline) strokeDashedShape(outline, ae.color, 0.5*fadeAlpha);
  if(inTelegraph) return;
  const curReach = Math.min(ae.range, fillDist);
  if(curReach<=2) return;
  const segs = Math.max(8, Math.round(18*(curReach/Math.max(ae.range,1))));
  const t = matchTime*3;
  const fx=Math.cos(ae.angle), fy=Math.sin(ae.angle);
  const rx=-Math.sin(ae.angle), ry=Math.cos(ae.angle);
  for(let w=0;w<3;w++){
    const phase = w*2.09;
    const pts = [];
    for(let i=0;i<=segs;i++){
      const along = curReach*(i/segs);
      const maxLat = along*Math.tan(half)*0.85;
      const lateral = Math.sin(along*0.02 + t + phase)*maxLat;
      const pp = project(ae.x+fx*along+rx*lateral, ae.y+fy*along+ry*lateral, 0);
      if(pp) pts.push(pp);
    }
    if(pts.length<2) continue;
    ctx.save();
    ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.globalAlpha = Math.min(1, (w===1?0.9:0.55)*fadeAlpha);
    ctx.strokeStyle = ae.color; ctx.lineWidth = w===1 ? 8 : 5;
    if(!renderHeavyLoad){ ctx.shadowBlur=22; ctx.shadowColor=ae.color; }
    ctx.beginPath();
    ctx.moveTo(pts[0].x,pts[0].y);
    for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
    ctx.stroke();
    if(w===1){
      ctx.globalAlpha = Math.min(1, 0.9*fadeAlpha);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.4; ctx.shadowBlur=0;
      ctx.stroke();
    }
    ctx.restore();
  }
}

// フラワービーム(プラント): 3層のビーム+舞う花びら
function drawFlowerBeamsEffect(ae, fillDist, fadeAlpha, inTelegraph){
  const count = ae.beamCount||3;
  const spread = (ae.beamSpreadDeg||40)*Math.PI/180;
  const ranges = ae.beamRanges || Array.from({length:count}, ()=>ae.range);
  for(let b=0;b<count;b++){
    const a = ae.angle + (count>1 ? (b/(count-1)-0.5)*spread : 0);
    const outline = rectOutlinePoints(ae.x, ae.y, a, ranges[b], ae.width/2);
    if(outline) strokeDashedShape(outline, '#b9f07a', 0.45*fadeAlpha);
    if(inTelegraph) continue;
    const curReach = Math.min(ranges[b], fillDist);
    if(curReach<=2) continue;
    const layers = [[1.0,'#2e5c17',0.5],[0.6,'#8fe33f',0.62],[0.3,'#eaffd0',0.82]];
    for(const [frac,color,alpha] of layers){
      const pts = rectOutlinePoints(ae.x, ae.y, a, curReach, ae.width*frac/2);
      if(pts) fillShape(pts, color, alpha*fadeAlpha);
    }
    if(!renderHeavyLoad){
      const fx=Math.cos(a), fy=Math.sin(a);
      const rxb=-Math.sin(a), ryb=Math.cos(a);
      const n = Math.min(8, Math.round(curReach/140)+3);
      for(let i=0;i<n;i++){
        const h1 = fxHash01(ae.id*9.1 + b*31.7 + i*7.3);
        const h2 = fxHash01(ae.id*5.3 + b*17.9 + i*11.7);
        const along = curReach*((i+h1)/n);
        const lateral = (h2*2-1)*ae.width*0.55;
        const p = project(ae.x+fx*along+rxb*lateral, ae.y+fy*along+ryb*lateral, 12+18*h1);
        if(!p) continue;
        const tw = 0.5+0.5*Math.sin(matchTime*5+i*2.2+b*1.3);
        if(tw>0.15) drawGroundSpark(p, 'petal', '#ffb7d5', fadeAlpha*tw, ae.id+b*10+i);
      }
    }
  }
}
function drawAreaEffects(){
  for(const ae of areaEffects){
    const elapsed = matchTime - ae.spawnAt;
    if(elapsed > ae.life) continue;
    const telegraphTime = ae.telegraphTime||0.18;
    const fillSpeed = ae.fillSpeed||900;
    const inTelegraph = elapsed <= telegraphTime;
    const fillDist = Math.max(0, elapsed - telegraphTime) * fillSpeed;
    const fadeStart = ae.life - 0.2;
    const fadeAlpha = elapsed>fadeStart ? clamp(1-((elapsed-fadeStart)/0.2), 0, 1) : 1;

    if(ae.kind==='beams'){
      if(ae.style==='flower'){
        drawFlowerBeamsEffect(ae, fillDist, fadeAlpha, inTelegraph);
        continue;
      }
      const count = ae.beamCount||3;
      const spread = (ae.beamSpreadDeg||40)*Math.PI/180;
      const ranges = ae.beamRanges || Array.from({length:count}, ()=>ae.range);
      for(let b=0;b<count;b++){
        const a = ae.angle + (count>1 ? (b/(count-1)-0.5)*spread : 0);
        const outline = rectOutlinePoints(ae.x, ae.y, a, ranges[b], ae.width/2);
        if(outline) strokeDashedShape(outline, ae.color, 0.5*fadeAlpha);
        if(!inTelegraph){
          const curReach = Math.min(ranges[b], fillDist);
          if(curReach>2){
            const fillPts = rectOutlinePoints(ae.x, ae.y, a, curReach, ae.width/2);
            if(fillPts) fillShape(fillPts, ae.color, 0.5*fadeAlpha);
          }
        }
      }
    } else if(ae.kind==='fan'){
      if(ae.style==='inferno'){
        drawInfernoFanEffect(ae, fillDist, fadeAlpha, inTelegraph);
        continue;
      }
      const half = (ae.fanAngleDeg||45)*Math.PI/360;
      const outline = fanOutlinePoints(ae.x, ae.y, ae.angle, ae.range, half, 16);
      if(outline) strokeDashedShape(outline, ae.color, 0.55*fadeAlpha);
      if(!inTelegraph){
        const curReach = Math.min(ae.range, fillDist);
        if(curReach>2){
          const fillPts = fanOutlinePoints(ae.x, ae.y, ae.angle, curReach, half, 16);
          if(fillPts) fillShape(fillPts, ae.color, 0.5*fadeAlpha);
        }
      }
    } else if(ae.kind==='rect'){
      if(ae.style==='lava'){
        drawLavaWaveEffect(ae, fillDist, fadeAlpha, inTelegraph);
      } else if(AOE_BAND_STYLES[ae.style]){
        drawStyledWaveEffect(ae, fillDist, fadeAlpha, inTelegraph);
      } else {
        const outline = rectOutlinePoints(ae.x, ae.y, ae.angle, ae.range, ae.width/2);
        if(outline) strokeDashedShape(outline, ae.color, 0.55*fadeAlpha);
        if(!inTelegraph){
          const curReach = Math.min(ae.range, fillDist);
          if(curReach>2){
            const fillPts = rectOutlinePoints(ae.x, ae.y, ae.angle, curReach, ae.width/2);
            if(fillPts) fillShape(fillPts, ae.color, 0.5*fadeAlpha);
          }
        }
      }
    } else if(ae.kind==='zigzag'){
      if(ae.style==='thunder'){
        drawThunderBoltEffect(ae, fillDist, fadeAlpha, inTelegraph);
        continue;
      }
      const outlineRect = rectOutlinePoints(ae.x, ae.y, ae.angle, ae.range, (ae.width||110)/2);
      if(outlineRect) strokeDashedShape(outlineRect, ae.color, 0.4*fadeAlpha);
      if(!inTelegraph){
        const curReach = Math.min(ae.range, fillDist);
        const segs = Math.max(2, Math.round(8*(curReach/Math.max(ae.range,1))));
        const amp = (ae.width||110)*0.5;
        const fx=Math.cos(ae.angle), fy=Math.sin(ae.angle);
        const rx=-Math.sin(ae.angle), ry=Math.cos(ae.angle);
        const pts = [];
        for(let i=0;i<=segs;i++){
          const along = curReach*(i/Math.max(segs,1));
          const lateral = (i%2===0?1:-1)*amp*(i===0||i===segs?0.3:1);
          const pp = project(ae.x+fx*along+rx*lateral, ae.y+fy*along+ry*lateral, 0);
          if(pp) pts.push(pp);
        }
        if(pts.length>=2){
          ctx.save();
          ctx.globalAlpha = Math.min(1, 0.8*fadeAlpha);
          ctx.strokeStyle = ae.color; ctx.lineWidth = 6;
          ctx.shadowBlur=20; ctx.shadowColor=ae.color;
          ctx.lineJoin='round'; ctx.lineCap='round';
          ctx.beginPath();
          ctx.moveTo(pts[0].x,pts[0].y);
          for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
          ctx.stroke();
          ctx.restore();
        }
      }
    } else if(ae.kind==='fanZigzag'){
      if(ae.style==='psychic'){
        drawPsychicWaveEffect(ae, fillDist, fadeAlpha, inTelegraph);
        continue;
      }
      const half = (ae.fanAngleDeg||30)*Math.PI/360;
      const outline = fanOutlinePoints(ae.x, ae.y, ae.angle, ae.range, half, 16);
      if(outline) strokeDashedShape(outline, ae.color, 0.5*fadeAlpha);
      if(!inTelegraph){
        const curReach = Math.min(ae.range, fillDist);
        if(curReach>2){
          const segs = Math.max(6, Math.round(16*(curReach/Math.max(ae.range,1))));
          const t = matchTime*3;
          const fx=Math.cos(ae.angle), fy=Math.sin(ae.angle);
          const rx=-Math.sin(ae.angle), ry=Math.cos(ae.angle);
          const pts = [];
          for(let i=0;i<=segs;i++){
            const along = curReach*(i/segs);
            const maxLat = along*Math.tan(half)*0.85;
            const lateral = Math.sin(along*0.02+t)*maxLat;
            const pp = project(ae.x+fx*along+rx*lateral, ae.y+fy*along+ry*lateral, 0);
            if(pp) pts.push(pp);
          }
          if(pts.length>=2){
            ctx.save();
            ctx.globalAlpha = Math.min(1, 0.85*fadeAlpha);
            ctx.strokeStyle = ae.color; ctx.lineWidth = 7;
            if(!renderHeavyLoad){ ctx.shadowBlur=22; ctx.shadowColor=ae.color; }
            ctx.lineJoin='round'; ctx.lineCap='round';
            ctx.beginPath();
            ctx.moveTo(pts[0].x,pts[0].y);
            for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
            ctx.stroke();
            ctx.restore();
          }
        }
      }
    }
  }
}
function drawLandingMarkers(){
  for(const p of projectiles){
    if(!p.lobbed) continue;
    const t = clamp(p.flightT / p.flightTime, 0, 1);
    const proj = project(p.landX, p.landY, 0);
    if(!proj) continue;
    const fade = 0.25 + 0.35*t;
    ctx.save();
    ctx.translate(proj.x, proj.y);
    ctx.scale(proj.scale, proj.scale);
    ctx.beginPath();
    ctx.ellipse(0,0, p.splash*0.9, p.splash*0.4, 0, 0, Math.PI*2);
    ctx.strokeStyle = p.color; ctx.globalAlpha = fade; ctx.lineWidth=3; ctx.setLineDash([8,6]);
    ctx.stroke();
    ctx.restore();
  }
}
function drawWaterZones(){
  if(seaZones.length===0 && riverZones.length===0 && oasisZones.length===0) return;
  const draw = (z, fill, stroke)=>{
    if(Math.abs(z.x-player.x)>2400 || Math.abs(z.y-player.y)>2400) return;
    const pts = projectCircleRing(z, z.radius, 22);
    if(pts.length<3) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x,pts[0].y);
    for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if(stroke){ ctx.strokeStyle = stroke; ctx.lineWidth=1.5; ctx.stroke(); }
  };
  ctx.save();
  for(const sz of seaZones) draw(sz, 'rgba(40,110,175,0.72)', 'rgba(140,200,230,0.25)');
  for(const rz of riverZones) draw(rz, 'rgba(70,150,205,0.62)', 'rgba(160,215,235,0.3)');
  // オアシス:砂に囲まれた青い水たまりだとひと目でわかるよう、外側に濡れた砂の縁を足してから水面を描く
  for(const oz of oasisZones){
    draw({ x:oz.x, y:oz.y, radius: oz.radius*1.12 }, 'rgba(150,120,70,0.55)', null);
    draw({ x:oz.x, y:oz.y, radius: oz.radius }, 'rgba(50,140,195,0.82)', 'rgba(170,225,245,0.55)');
  }
  ctx.restore();
}
function drawLavaZones(){
  if(lavaZones.length===0) return;
  for(const lz of lavaZones){
    const pts = projectCircleRing(lz, lz.radius, 40);
    if(pts.length<3) continue;
    ctx.save();
    const pulse = 0.75 + 0.25*Math.sin(matchTime*2.4 + lz.x*0.01);
    ctx.shadowBlur = 22; ctx.shadowColor = 'rgba(255,90,20,0.8)';
    ctx.beginPath();
    ctx.moveTo(pts[0].x,pts[0].y);
    for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
    ctx.closePath();
    ctx.fillStyle = `rgba(255,${Math.round(70+30*pulse)},20,0.85)`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255,220,120,${0.5+0.3*pulse})`; ctx.lineWidth=2.5;
    ctx.stroke();
    ctx.restore();
  }
}
function terraceColor(style, shade){
  if(style==='snow'){
    // 白〜薄い水色の雪山
    return `rgb(${Math.round(190+50*shade)},${Math.round(205+45*shade)},${Math.round(220+30*shade)})`;
  }
  if(style==='forest'){
    // 深緑〜明るい緑の森
    return `rgb(${Math.round(20+40*shade)},${Math.round(60+90*shade)},${Math.round(25+35*shade)})`;
  }
  // volcano(デフォルト): 焦げた茶〜赤茶の山肌
  return `rgb(${Math.round(70+90*shade)},${Math.round(46+58*shade)},${Math.round(30+38*shade)})`;
}
function drawPyramidComplex(group,p){
  const main = group.find(v=>v.isMain) || group[0];
  const mainP = project(main.x, main.y, 0);
  if(!mainP) return;
  ctx.save();
  const r = mainP.scale*main.radius;
  const h = r*1.3;
  ctx.translate(mainP.x, mainP.y);
  // 土台(菱形の縁)を描いて奥行きを持たせる。volcanoの隆起表現と同じく、
  // 接地ライン(y=0)より下には何も描かない(=地面にめり込んで見えないようにする)
  const sideY = -r*0.14, backY = -r*0.24;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-r, sideY);
  ctx.lineTo(0, backY);
  ctx.lineTo(r, sideY);
  ctx.closePath();
  ctx.fillStyle = '#8a6a3a';
  ctx.fill();
  // 左面(影)
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -h);
  ctx.lineTo(-r, sideY);
  ctx.closePath();
  ctx.fillStyle = '#b89a58';
  ctx.fill();
  // 右面(日向)
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -h);
  ctx.lineTo(r, sideY);
  ctx.closePath();
  ctx.fillStyle = '#e0c988';
  ctx.fill();
  ctx.strokeStyle='rgba(70,50,20,0.6)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(-r,sideY); ctx.lineTo(0,-h); ctx.lineTo(r,sideY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0,-h); ctx.lineTo(0,0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-r,sideY); ctx.lineTo(0,backY); ctx.lineTo(r,sideY); ctx.stroke();
  ctx.restore();
}
// 火山1つ分(主峰+複数の裾野の隆起)をまとめて1つの立体として描画する。
// 個別に奥行きソートすると隙間から背景が見えてしまう(透けて見える)ため、
// 必ずこの関数の中で複合体としてまとめて描画する。
// style('volcano'/'snow'/'forest')に応じて色と山頂の演出を切り替える。ピラミッドは形状自体が違うため別関数に分岐する。
function drawVolcanoComplex(group,p){
  const style = (group.find(v=>v.isMain)||group[0]).style || 'volcano';
  if(style==='pyramid'){ drawPyramidComplex(group,p); return; }
  ctx.save();
  ctx.globalAlpha = 1;

  const main = group.find(v=>v.isMain) || group[0];
  const mainP = project(main.x, main.y, 0);
  if(!mainP){ ctx.restore(); return; }

  // 各隆起(主峰含む)を、奥から手前の順で描く(主峰は最後=一番手前)
  const sorted = [...group].sort((a,b)=> (a.isMain?1:0) - (b.isMain?1:0));

  for(const v of sorted){
    const pp = project(v.x, v.y, 0);
    if(!pp) continue;
    const r = pp.scale * v.radius;
    const riseH = r * (v.isMain ? 1.15 : 0.9); // 地面からの盛り上がりの高さ(疑似的な3D隆起)

    ctx.save();
    ctx.translate(pp.x, pp.y);

    // 山肌を裾野から山頂へ向けて何段かのテラスとして描き、隆起している質感を出す。
    // 楕円の下半分を描くと接地点より下に膨らんで見えてしまうため、上半分(ドーム状)だけ描く
    const terraces = v.isMain ? 5 : 3;
    for(let t=terraces; t>=0; t--){
      const tt = t/terraces; // 1=裾野, 0=山頂
      const rr = r*(0.28+0.72*tt);
      const ry = rr*0.60;
      const yOff = -riseH*(1-tt);
      const shade = 0.16 + tt*0.30; // 山頂ほど明るく
      ctx.beginPath(); ctx.ellipse(0, yOff, rr, ry, 0, Math.PI, Math.PI*2);
      ctx.fillStyle = terraceColor(style, shade);
      ctx.fill();
    }

    if(v.isMain){
      if(style==='snow'){
        const glow = 0.6+0.25*Math.sin(matchTime*1.2);
        ctx.beginPath(); ctx.ellipse(0,-riseH, r*0.24, r*0.15, 0, 0, Math.PI*2);
        ctx.fillStyle = `rgba(255,255,255,${0.75+0.2*glow})`;
        ctx.shadowBlur=16; ctx.shadowColor='rgba(210,235,255,0.9)';
        ctx.fill();
        ctx.shadowBlur=0;
      } else if(style==='forest'){
        // 木々の茂みを頂上付近に足して密度感を出す
        for(let i=0;i<5;i++){
          const a = (i/5)*Math.PI*2;
          const cx2 = r*0.35*Math.cos(a), cy2 = -riseH*0.85 + r*0.15*Math.sin(a);
          ctx.beginPath(); ctx.ellipse(cx2, cy2, r*0.22, r*0.16, 0,0,Math.PI*2);
          ctx.fillStyle = 'rgba(20,60,25,0.55)';
          ctx.fill();
        }
      } else {
        const glow = 0.6+0.3*Math.sin(matchTime*1.6);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, -riseH, r*0.30, r*0.19, 0, 0, Math.PI*2); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(0,-riseH, r*0.26, r*0.16, 0, 0, Math.PI*2);
        ctx.fillStyle = `rgb(${Math.round(200+30*glow)},${Math.round(70+30*glow)},20)`;
        ctx.shadowBlur=22; ctx.shadowColor='rgba(255,110,30,0.95)';
        ctx.fill();
        ctx.shadowBlur=0;
      }
    }
    ctx.restore();
  }
  ctx.restore();
}
let renderHeavyLoad = false;
function render(){
  ctx.clearRect(0,0,viewW,viewH);
  // 序盤など弾/エフェクトが同時に多い時は重い影描画(shadowBlur)を間引いて負荷を下げる
  renderHeavyLoad = (projectiles.length + particles.length) > 22;
  drawSkyAndGround();
  drawWaterZones();
  drawLavaZones();
  drawTerrainDecor();
  drawZoneRings();
  drawLandingMarkers();
  drawAreaEffects();
  if(introState.active) drawSummonIntro();

  const drawables = [];
  for(const b of buildings){ const p = project(b.cx,b.cy,b.wallH*0.5); if(p) drawables.push({kind:'building', obj:b, p}); }
  for(const r of rocks){ const p = project(r.x,r.y,0); if(p) drawables.push({kind:'rock', obj:r, p}); }
  for(const c of crystalObstacles){ const p = project(c.x,c.y,0); if(p) drawables.push({kind:'crystal', obj:c, p}); }
  const volcanoGroups = new Map();
  for(const v of volcanoObstacles){
    const gid = v.complexId||0;
    if(!volcanoGroups.has(gid)) volcanoGroups.set(gid, []);
    volcanoGroups.get(gid).push(v);
  }
  for(const group of volcanoGroups.values()){
    const main = group.find(v=>v.isMain) || group[0];
    const p = project(main.x, main.y, 0);
    if(p) drawables.push({kind:'volcano', obj:group, p});
  }
  for(const it of lootItems){ const p = project(it.x,it.y,0); if(p) drawables.push({kind:'loot', obj:it, p}); }
  for(const pr of projectiles){ const p = project(pr.x,pr.y,pr.z+20); if(p) drawables.push({kind:'proj', obj:pr, p}); }
  for(const e of entities){ if(!e.alive) continue; const p = project(e.x,e.y,e.z); if(p){ drawables.push({kind:'mon', obj:e, p}); if(!e.isPlayer) monsterScreenPos.set(e.id, {x:p.x,y:p.y,scale:p.scale}); } }
  for(const pt of particles){ const p = project(pt.x,pt.y, (pt.z||0)+(pt.type==='text'?42:16)); if(p) drawables.push({kind:'fx', obj:pt, p}); }

  drawables.sort((a,b)=>b.p.depth-a.p.depth);
  // 巨大なオブジェクト(火山など)は近づくほど画面上の投影位置が大きくブレるため、
  // 固定150pxの余白だけでは実際は画面内に見えているのに誤ってカリングされてしまう。
  // オブジェクトの見た目上の半径(ワールド半径×投影スケール)ぶん余白を広げて判定する。
  const cullMarginFor = (d)=>{
    let r = 0;
    if(d.kind==='volcano'){ for(const v of d.obj){ if(v.radius>r) r=v.radius; } }
    else if(d.kind==='rock' || d.kind==='crystal'){ r = d.obj.radius||0; }
    return 150 + r*d.p.scale*1.2;
  };
  for(const d of drawables){
    const m = cullMarginFor(d);
    if(d.p.x<-m||d.p.x>viewW+m||d.p.y<-m||d.p.y>viewH+m) continue;
    if(d.kind==='loot') drawLootItem(d.obj,d.p);
    else if(d.kind==='proj') drawProjectile(d.obj,d.p);
    else if(d.kind==='volcano') drawVolcanoComplex(d.obj,d.p);
    else if(d.kind==='mon') drawMonster(d.obj,d.p);
    else if(d.kind==='rock') drawRock(d.obj,d.p);
    else if(d.kind==='crystal') drawCrystal(d.obj,d.p);
    else if(d.kind==='building') drawBuilding(d.obj);
    else drawParticle(d.obj,d.p);
  }
  if(introState.active) drawSummonIntroFront();
  drawDangerVignette();
  drawZoneCompass();
  if(introState.active) drawSummonCountdown();
  renderMinimap();
}
// 召喚演出の各フェーズ進行度(elapsed秒基準)
function summonPhases(){
  const elapsed = introState.duration - introState.timer;
  return {
    elapsed,
    diskGrow:  clamp(elapsed/0.7, 0, 1),                       // 円盤石が現れる
    fallProg:  clamp((elapsed-0.45)/0.8, 0, 1),                // 光の柱が天から落ちる
    landed:    elapsed >= 1.25,
    narrow:    clamp((elapsed-1.6)/2.8, 0, 1),                 // 周りから中心へ収束
    endFade:   1 - clamp((elapsed-4.4)/0.6, 0, 1),
  };
}
// モンスターの出現アルファ(光が収束するにつれて姿を現す)
function summonRevealAlpha(){
  if(!introState.active) return 1;
  const elapsed = introState.duration - introState.timer;
  return clamp((elapsed - 1.5)/2.4, 0, 1);
}
// 召喚演出(モンスターの背面): 円盤石・落下する光の柱・虹色のオーラ・足元リング
function drawSummonIntro(){
  const ph = summonPhases();
  const t = performance.now()/1000;
  const diskReady = imgIsReady(summonDiskImg);
  for(const e of entities){
    if(!e.alive) continue;
    const pg = project(e.x, e.y, 0);
    if(!pg) continue;
    if(pg.x<-240||pg.x>viewW+240||pg.y<-240||pg.y>viewH+240) continue;
    const topH = e.radius*8;
    const pTop = project(e.x, e.y, topH);
    const topY = pTop ? pTop.y : pg.y - topH*pg.scale;
    // --- 円盤石(地面に伏せて平たく描画) ---
    if(diskReady && ph.diskGrow>0){
      const dw = e.radius*6.8*pg.scale*ph.diskGrow;
      const dh = dw*0.5;
      ctx.save();
      ctx.globalAlpha = (0.5 + 0.45*ph.diskGrow) * (0.5 + 0.5*ph.endFade);
      ctx.shadowBlur = 26*pg.scale; ctx.shadowColor = 'rgba(255,222,150,0.9)';
      ctx.drawImage(summonDiskImg, pg.x-dw/2, pg.y-dh/2, dw, dh);
      ctx.restore();
    }
    // --- 天から落ちてくる光の柱(先端が円盤石へ降りる) ---
    if(ph.fallProg>0 && !ph.landed){
      const botY = lerp(topY, pg.y, ph.fallProg);   // 先端(下端)が降下
      const halfW = e.radius*1.7*pg.scale;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const grad = ctx.createLinearGradient(0, topY, 0, botY);
      grad.addColorStop(0.0, 'rgba(255,255,255,0.0)');
      grad.addColorStop(0.7, 'rgba(230,240,255,0.55)');
      grad.addColorStop(1.0, 'rgba(255,255,255,0.95)');
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(pg.x - halfW*0.5, topY);
      ctx.lineTo(pg.x + halfW*0.5, topY);
      ctx.lineTo(pg.x + halfW, botY);
      ctx.lineTo(pg.x - halfW, botY);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // --- 着地後: 虹色のオーラ(周りから中心へ収束) ---
    if(ph.landed && ph.endFade>0){
      const spread = (1 - ph.narrow);                // 収束で幅が縮む
      const halfW = e.radius*2.4*pg.scale*(0.25 + 0.75*spread);
      const flick = 1 + 0.07*Math.sin(t*18 + e.id);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const grad = ctx.createLinearGradient(0, pg.y, 0, topY);
      grad.addColorStop(0.0, 'rgba(255,255,255,0.85)');
      grad.addColorStop(0.18, 'rgba(255,90,90,0.5)');
      grad.addColorStop(0.38, 'rgba(255,210,70,0.5)');
      grad.addColorStop(0.58, 'rgba(90,235,120,0.45)');
      grad.addColorStop(0.78, 'rgba(85,165,255,0.45)');
      grad.addColorStop(1.0, 'rgba(190,110,255,0.0)');
      ctx.globalAlpha = (0.35 + 0.35*spread) * ph.endFade;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(pg.x - halfW*1.15*flick, pg.y);
      ctx.lineTo(pg.x + halfW*1.15*flick, pg.y);
      ctx.lineTo(pg.x + halfW*0.5, topY);
      ctx.lineTo(pg.x - halfW*0.5, topY);
      ctx.closePath(); ctx.fill();
      // 足元の発光リング
      ctx.globalAlpha = 0.4*ph.endFade;
      ctx.beginPath();
      ctx.ellipse(pg.x, pg.y, e.radius*3*pg.scale*(0.6+0.4*spread), e.radius*1.2*pg.scale*(0.6+0.4*spread), 0, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,240,200,0.5)';
      ctx.fill();
      ctx.restore();
    }
  }
}
// 召喚演出(モンスターの前面): モンスターを覆う白い光芯が中心へ細く収束し姿を現す
function drawSummonIntroFront(){
  const ph = summonPhases();
  if(!ph.landed || ph.narrow>=1) return;
  const t = performance.now()/1000;
  for(const e of entities){
    if(!e.alive) continue;
    const pg = project(e.x, e.y, 0);
    if(!pg) continue;
    if(pg.x<-240||pg.x>viewW+240||pg.y<-240||pg.y>viewH+240) continue;
    const topH = e.radius*8;
    const pTop = project(e.x, e.y, topH);
    const topY = pTop ? pTop.y : pg.y - topH*pg.scale;
    // 覆う幅(モンスターを隠す)→中心の細い芯へ。収束とともにアルファも落として綺麗に消す
    const wideHalf = e.radius*1.75*pg.scale;
    const thinHalf = e.radius*0.12*pg.scale;
    const halfW = lerp(wideHalf, thinHalf, ph.narrow);
    const appear = clamp((ph.elapsed - (SUMMON_IMPACT_AT-0.15))/0.25, 0, 1);
    const alpha = 0.9 * (1 - ph.narrow) * appear * ph.endFade;
    if(alpha<=0.01) continue;
    const flick = 1 + 0.06*Math.sin(t*24 + e.id);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const grad = ctx.createLinearGradient(0, pg.y, 0, topY);
    grad.addColorStop(0.0, 'rgba(255,255,255,0.98)');
    grad.addColorStop(0.55,'rgba(255,255,255,0.85)');
    grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    ctx.globalAlpha = alpha;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(pg.x - halfW*flick, pg.y);
    ctx.lineTo(pg.x + halfW*flick, pg.y);
    ctx.lineTo(pg.x + halfW*0.35, topY);
    ctx.lineTo(pg.x - halfW*0.35, topY);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
// 召喚演出: 中央のカウントダウン数字
function drawSummonCountdown(){
  const n = Math.max(1, Math.ceil(introState.timer));
  const frac = introState.timer - Math.floor(introState.timer); // 秒内の進み具合(1→0)
  const scale = 1 + Math.max(0, frac-0.7)*1.3;                   // 数字が変わった瞬間に大きくポップ
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold 22px 'Rajdhani', sans-serif`;
  ctx.fillStyle = 'rgba(255,240,205,0.92)';
  ctx.shadowBlur = 12; ctx.shadowColor = 'rgba(255,180,80,0.9)';
  ctx.fillText('召 喚', viewW/2, viewH*0.16);
  ctx.font = `bold ${Math.round(66*scale)}px 'Rajdhani', sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.shadowBlur = 22; ctx.shadowColor = 'rgba(120,200,255,0.95)';
  ctx.fillText(String(n), viewW/2, viewH*0.31);
  ctx.restore();
}
function renderMinimap(){
  const w = miniCanvas.width, h = miniCanvas.height;
  miniCtx.clearRect(0,0,w,h);
  miniCtx.fillStyle='rgba(11,19,32,0.5)'; miniCtx.fillRect(0,0,w,h);
  const scale = w/WORLD.w;
  miniCtx.save();
  miniCtx.beginPath(); miniCtx.arc(w/2,h/2,w/2-2,0,Math.PI*2); miniCtx.clip();
  miniCtx.beginPath();
  miniCtx.arc(zoneState.center.x*scale, zoneState.center.y*scale, zoneState.radius*scale, 0, Math.PI*2);
  miniCtx.strokeStyle='rgba(244,196,48,0.85)'; miniCtx.lineWidth=2; miniCtx.stroke();
  // 次回の安置予測(縮小中は縮小先)を点線で表示。雪山マップでは白い山と被らない青系にする
  if(zoneState.shrinking || zoneState.hasNext){
    miniCtx.save();
    miniCtx.beginPath();
    miniCtx.arc(zoneState.toCenter.x*scale, zoneState.toCenter.y*scale, zoneState.toRadius*scale, 0, Math.PI*2);
    miniCtx.setLineDash([3,3]);
    miniCtx.strokeStyle = currentMap.mountainStyle==='snow' ? 'rgba(80,150,255,0.95)' : 'rgba(255,255,255,0.8)';
    miniCtx.lineWidth=1.4;
    miniCtx.stroke();
    miniCtx.restore();
  }
  for(const sz of seaZones){
    miniCtx.beginPath();
    miniCtx.arc(sz.x*scale, sz.y*scale, Math.max(1.5, sz.radius*scale), 0, Math.PI*2);
    miniCtx.fillStyle = 'rgba(40,110,170,0.7)'; miniCtx.fill();
  }
  for(const rz of riverZones){
    miniCtx.beginPath();
    miniCtx.arc(rz.x*scale, rz.y*scale, Math.max(1.5, rz.radius*scale), 0, Math.PI*2);
    miniCtx.fillStyle = 'rgba(60,140,200,0.65)'; miniCtx.fill();
  }
  for(const oz of oasisZones){
    miniCtx.beginPath();
    miniCtx.arc(oz.x*scale, oz.y*scale, Math.max(2, oz.radius*scale), 0, Math.PI*2);
    miniCtx.fillStyle = 'rgba(80,170,220,0.55)'; miniCtx.fill();
  }
  for(const v of volcanoObstacles){
    const col = v.style==='snow' ? 'rgba(210,230,245,0.9)' : v.style==='forest' ? 'rgba(40,110,50,0.9)' : v.style==='pyramid' ? 'rgba(210,180,120,0.9)' : 'rgba(90,58,42,0.9)';
    miniCtx.beginPath();
    miniCtx.arc(v.x*scale, v.y*scale, Math.max(2, v.radius*scale), 0, Math.PI*2);
    miniCtx.fillStyle = col; miniCtx.fill();
  }
  for(const lz of lavaZones){
    const r = Math.max(1.5, lz.radius*scale);
    miniCtx.beginPath();
    miniCtx.arc(lz.x*scale, lz.y*scale, r, 0, Math.PI*2);
    miniCtx.fillStyle = 'rgba(120,20,10,0.85)';
    miniCtx.fill();
    miniCtx.save();
    miniCtx.setLineDash([2,2]);
    miniCtx.strokeStyle = 'rgba(255,200,40,0.95)';
    miniCtx.lineWidth = 1.2;
    miniCtx.stroke();
    miniCtx.restore();
  }
  for(const e of entities){
    if(!e.alive) continue;
    miniCtx.beginPath();
    miniCtx.arc(e.x*scale, e.y*scale, e.isPlayer?3.4:2.2, 0, Math.PI*2);
    miniCtx.fillStyle = e.isPlayer ? '#ffffff' : (ELEMENTS[e.element].accent || ELEMENTS[e.element].color);
    miniCtx.fill();
  }
  const px=player.x*scale, py=player.y*scale, yaw=camState.yaw;
  miniCtx.beginPath();
  miniCtx.moveTo(px,py);
  miniCtx.lineTo(px+Math.cos(yaw)*12, py+Math.sin(yaw)*12);
  miniCtx.strokeStyle='rgba(255,255,255,0.9)'; miniCtx.lineWidth=2; miniCtx.stroke();
  miniCtx.restore();
}

/* =====================================================================
   HUD
===================================================================== */
const CD_RING_CIRC = 2*Math.PI*46; // SVG上の半径46に合わせた円周
function setCooldownRing(el, progress){
  if(!el) return;
  const p = clamp(progress, 0, 1);
  el.style.strokeDasharray = `${CD_RING_CIRC}`;
  el.style.strokeDashoffset = `${CD_RING_CIRC * (1-p)}`;
}
function updateHUD(){
  if(!player) return;
  const el = ELEMENTS[player.element];
  // ランキング表示名(名前入力欄)をそのままHUDに表示する
  document.getElementById('hudName').textContent =
    (typeof getDisplayNameFromInput==='function') ? getDisplayNameFromInput() : (player.name||'プレイヤー');
  // トレーニングアイテムで得たバフの累積(初期値から変化したものだけを列挙)
  {
    const tb = [];
    if(player.trainDmgMult && Math.abs(player.trainDmgMult-1)>0.001) tb.push(`技ダメ×${player.trainDmgMult.toFixed(2)}`);
    if(player.trainDmgTakenMult && Math.abs(player.trainDmgTakenMult-1)>0.001) tb.push(`被ダメ×${player.trainDmgTakenMult.toFixed(2)}`);
    if(player.trainSpeedMult && Math.abs(player.trainSpeedMult-1)>0.001) tb.push(`移動×${player.trainSpeedMult.toFixed(2)}`);
    if(player.trainCooldownMult && Math.abs(player.trainCooldownMult-1)>0.001) tb.push(`連射×${(1/player.trainCooldownMult).toFixed(2)}`);
    if(player.trainProjSpeedMult && Math.abs(player.trainProjSpeedMult-1)>0.001) tb.push(`弾速×${player.trainProjSpeedMult.toFixed(2)}`);
    if(player.trainGutsCostReduction) tb.push(`消費ガッツ-${player.trainGutsCostReduction}`);
    if(player.trainMaxHpBonus) tb.push(`最大HP+${player.trainMaxHpBonus}`);
    document.getElementById('trainBuffsLine').textContent = tb.join('・');
  }
  document.getElementById('hudElTag').textContent = el.label;
  document.documentElement.style.setProperty('--accent', el.color);
  const hpPct = clamp(player.hp/player.maxHp,0,1)*100;
  document.getElementById('hpFill').style.width = hpPct+'%';
  document.getElementById('hpFill').style.background = hpPct>50?'linear-gradient(90deg,#6bff8e,#2fd35a)':(hpPct>22?'linear-gradient(90deg,#ffe06b,#f4c430)':'linear-gradient(90deg,#ff8a8a,#ff5d5d)');
  document.getElementById('hpNum').textContent = `${Math.max(0,Math.round(player.hp))} / ${player.maxHp}`;

  const gutsPct = clamp(player.guts/player.maxGuts,0,1)*100;
  document.getElementById('gutsFill').style.width = gutsPct+'%';
  document.getElementById('gutsNum').textContent = `${Math.max(0,Math.round(player.guts))} / ${player.maxGuts}`;

  const stateSc = STATE_CHANGES[player.element];
  const stateCdFillEl = document.getElementById('stateCdFill');
  const stateCdLabelEl = document.getElementById('stateCdLabel');
  if(stateSc){
    if(player.stateUntil > matchTime){
      stateCdFillEl.style.width = '100%';
      stateCdFillEl.style.background = 'linear-gradient(90deg,#ff6b6b,#ff2b2b)';
      stateCdLabelEl.textContent = `${stateSc.name} 発動中 残り${Math.ceil(player.stateUntil-matchTime)}秒`;
    } else if(player.stateCooldownUntil > matchTime){
      const cdPct = clamp(1-((player.stateCooldownUntil-matchTime)/stateSc.cooldown),0,1)*100;
      stateCdFillEl.style.width = cdPct+'%';
      stateCdFillEl.style.background = 'linear-gradient(90deg,#8a5a5a,#c96b6b)';
      stateCdLabelEl.textContent = `${stateSc.name} クールタイム残り${Math.ceil(player.stateCooldownUntil-matchTime)}秒`;
    } else {
      stateCdFillEl.style.width = '100%';
      stateCdFillEl.style.background = 'linear-gradient(90deg,#ffd76b,#ffb020)';
      stateCdLabelEl.textContent = `${stateSc.name} 発動可能`;
    }
  }

  const statusEl = document.getElementById('statusIcons');
  let statusHtml = '';
  if(player.burnUntil > matchTime) statusHtml += `<span class="status-pill burn">やけど</span>`;
  if(player.slowUntil > matchTime) statusHtml += `<span class="status-pill slow">鈍足</span>`;
  if(player.freezeUntil > matchTime) statusHtml += `<span class="status-pill freeze">こおり</span>`;
  if(player.poisonUntil > matchTime) statusHtml += `<span class="status-pill poison">どく</span>`;
  statusEl.innerHTML = statusHtml;

  const aliveCount = entities.filter(e=>e.alive).length;
  document.getElementById('aliveNum').textContent = aliveCount;
  bgmUpdateBattleIntensity(aliveCount); // 残り人数で試合BGMの盛り上がりを切替
  document.getElementById('zoneStatus').textContent = zoneLabel();
  const countdown = zoneCountdownSeconds();
  document.getElementById('zoneCountdown').textContent = countdown===null ? '--:--' : fmtTime(countdown);
  document.getElementById('killCountNum').textContent = player.kills;
  document.getElementById('damageDealtNum').textContent = Math.round(player.damageDealt);
  document.getElementById('matchClock').textContent = fmtTime(matchTime);

  const mv = activeMove(player);
  document.getElementById('moveName').textContent = mv.name;
  document.documentElement.style.setProperty('--moveColor', mv.color);
  document.getElementById('gutsCostLabel').textContent = `ガッツ消費 ${effectiveGutsCost(player, mv)}`;
  for(let t=1;t<=3;t++){
    const dot = document.querySelector(`.tier-dot[data-tier="${t}"]`);
    dot.classList.toggle('unlocked', t<=player.moveTierUnlocked);
    dot.classList.toggle('selected', t===player.moveTierSelected);
  }
  document.getElementById('moveIcon').innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="${mv.color}"/></svg>`;

  // 召喚演出中は操作説明を出さない(演出に被って勿体無いため)。
  // 演出中はupdate()が回らずtipTimerが減らないので、演出後にフル秒数だけ表示される。
  document.getElementById('tipBox').style.opacity = (!introState.active && game.tipTimer>0) ? '1':'0';

  const fireMax = effectiveCooldown(player, mv);
  const fireProgress = fireMax>0 ? clamp(1 - player.fireCooldown/fireMax, 0, 1) : 1;
  setCooldownRing(document.getElementById('fireCdRing'), fireProgress);

  const dashProgress = clamp(1 - player.dashCooldown/DASH_COOLDOWN_MAX, 0, 1);
  setCooldownRing(document.getElementById('dashCdRing'), dashProgress);

  let lockOn=false;
  if(player.alive){
    const fx=Math.cos(player.facingAngle), fy=Math.sin(player.facingAngle);
    for(const e of entities){
      if(e===player||!e.alive) continue;
      if(e.z - player.z > UPWARD_BLOCK_THRESHOLD) continue;
      const d=dist(player,e); if(d>mv.range) continue;
      const dirx=(e.x-player.x)/Math.max(d,0.001), diry=(e.y-player.y)/Math.max(d,0.001);
      if(dirx*fx+diry*fy>0.9){ lockOn=true; break; }
    }
  }
  document.getElementById('crosshair').classList.toggle('lock', lockOn);
}

/* =====================================================================
   INPUT
===================================================================== */
document.addEventListener('touchmove', (e)=>{
  if(e.target.closest('#startScreen') || e.target.closest('#audioSettingsOverlay') || e.target.closest('#accountOverlay') || e.target.closest('#bagOverlay') || e.target.closest('#gachaOverlay') || e.target.closest('#skinPromoOverlay') || e.target.closest('#shopOverlay') || e.target.closest('#rankingScreen') || e.target.closest('#myStatsScreen') || e.target.closest('#howToPlayScreen') || e.target.closest('#mastermonScreen') || e.target.closest('#resultScreen') || e.target.closest('#monsterListScreen') || e.target.closest('#adminPassScreen') || e.target.closest('#adminScreen') || e.target.closest('#lobbyScreen')) return;
  e.preventDefault();
}, {passive:false});
document.addEventListener('gesturestart', (e)=>{ e.preventDefault(); });
document.addEventListener('gesturechange', (e)=>{ e.preventDefault(); });
document.addEventListener('gestureend', (e)=>{ e.preventDefault(); });

