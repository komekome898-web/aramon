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
// 巨大な静止オブジェクト(火山・ピラミッド・建物)専用の投影。
// 通常のprojectは基準点(足元中心)がカメラ近平面を少しでも越えるとnullを返すため、
// 至近で視点を回すと本体はまだ画面内なのに丸ごと消えたり、投影位置が跳ねて見える不具合があった。
// ・オブジェクトの手前端(半径ぶんの余裕)がまだ前方にある間は消さない
// ・カメラに寄りすぎた時はdepthを下限でクランプし、スケール暴走・位置の跳ねを抑える
function projectObstacle(wx, wy, wz, objRadius){
  const tx = wx-camPos.x, ty = wy-camPos.y, tz=(wz||0)-camPos.z;
  const depthFlat = tx*Math.cos(camState.yaw) + ty*Math.sin(camState.yaw);
  const lateral   = -tx*Math.sin(camState.yaw) + ty*Math.cos(camState.yaw);
  // 手前端すら背後(=完全にカメラの後ろ)なら描かない。半径ぶんは前方判定に余裕を持たせる。
  if(depthFlat + (objRadius||0) < 1) return null;
  let camDepth = depthFlat*Math.cos(camState.pitch) - tz*Math.sin(camState.pitch);
  const OBSTACLE_MIN_DEPTH = 80; // これ未満はクランプ(スケールは頭打ち・位置は横移動のみで安定)
  if(camDepth < OBSTACLE_MIN_DEPTH) camDepth = OBSTACLE_MIN_DEPTH;
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
      // キュービ等の白い部分。淡いクリーム(わずかに色味あり)も広く拾い、
      // 色替えがハッキリ乗るよう明度しきい値を下げ彩度ペナルティを緩める。
      wgt = Math.min(1, Math.max(0,(l1-0.48)/0.34)) * (1-Math.min(1,s1/0.78));
    }
    if(wgt<=0.01) continue;
    let nr,ng,nb, ww=wgt;
    if(colorId==='black' || colorId==='white'){
      // ブラック/ホワイトは「主要部だけ」を無彩色でハッキリ塗る。彩度は完全に抜く。
      if(info.type==='chroma'){
        // 色相で主要部を判定する monster: 淡く一致する箇所(脚・ハイライト等)まで
        // 暗く/白くすると他の色替えと違う場所が変わって見える&中間の重みで元色が
        // 残り濁る(暗い赤/淡い青)。→ 重みを主要部に絞る(smoothstep)。
        const t=Math.max(0,Math.min(1,(wgt-0.30)/0.30)); ww=t*t*(3-2*t);
      } else {
        // 明度で主要部を判定する monster(キュービ/イルミネ)は主要部が広く
        // テクスチャの濃淡で重みがばらつくため、絞るとまだら化する。ベタ塗りに
        // 近づくよう重みを大きく底上げして滑らかに塗る。
        ww=Math.min(1, wgt*2.4);
      }
      if(ww<=0.01) continue;
      if(colorId==='black'){ [nr,ng,nb]=hslToRgb(0, 0, clamp(l1*0.20, 0.02, 0.20)); } // 濃い黒(陰影のみ残す)
      else               { [nr,ng,nb]=hslToRgb(0, 0, clamp(0.84+l1*0.13, 0.84, 0.98)); } // 明るい白
    } else {
      const Ht=SKIN_TARGET_HUE[colorId]; let ns=Math.max(s1,0.5), nl=l1;
      if(info.type==='light'){ ns=Math.max(s1,0.9); nl=clamp(l1*0.5+0.05, 0.32, 0.58); } // キュービ等:淡くせずハッキリ発色
      if(colorId==='yellow') nl=Math.min(0.82, nl*1.05+0.06);
      [nr,ng,nb]=hslToRgb(Ht, ns, nl);
    }
    d[i]  =Math.round(d[i]*(1-ww)+nr*ww);
    d[i+1]=Math.round(d[i+1]*(1-ww)+ng*ww);
    d[i+2]=Math.round(d[i+2]*(1-ww)+nb*ww);
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
// SSRスキンは手描き画像そのままなので、事前ロードが間に合っていなくても
// ファイルのURLを返せば<img>としては正しく表示できる。
// canvasへ描く用途は skinnedImage() 側なので、ここはDOM専用の保険。
// (事前ロードの取りこぼしや読み込み待ちで、カタログ・バッグ・着せ替えが
//  素のモンスターにフォールバックしてしまうのを防ぐ)
function ssrSkinFileUrl(skinId, view){
  const s = SSR_SKINS[skinId];
  if(!s) return null;
  const name = (view==='player' && s.playerImg) ? s.playerImg : s.iconImg;
  return name ? imgSrcFor(`monsters/${name}`) : null;
}
// DOM(<img>)用: skinId のアイコンを dataURL で返す(キャッシュ)。未生成なら null
function skinnedIconDataUrl(skinId){
  if(!skinId) return null;
  if(_skinDataUrlCache[skinId]) return _skinDataUrlCache[skinId];
  const img = skinnedImage(skinId, 'icon');
  if(!img) return ssrSkinFileUrl(skinId, 'icon');
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
  if(!img) return ssrSkinFileUrl(skinId, 'player');
  let url;
  if(img instanceof HTMLCanvasElement) url = img.toDataURL('image/png');
  else {
    const c=document.createElement('canvas'); c.width=_imgW(img); c.height=_imgH(img);
    c.getContext('2d').drawImage(img,0,0); url=c.toDataURL('image/png');
  }
  _skinDataUrlCache[key]=url;
  return url;
}
// DOM用: skinId の歩行8コマを dataURL 配列で返す(キャッシュ)。view: 'front'|'back'
// スキンプレビューで歩行モーションを再生するために使う。歩行コマが未用意/未ロードなら null
// (呼び出し側は従来の静止画にフォールバックする)。
// 指定モンスターの歩行コマをdataURL配列で返す。スキン未装備なら素のコマを使う。
// 未ロード/歩行コマ未対応なら null(呼び側は静止画にフォールバックする)
function monsterWalkFrameDataUrls(elementKey, skinId, view){
  if(skinId) return skinWalkFrameDataUrls(skinId, view);
  if(typeof WALK_ANIM==='undefined') return null;
  const reg = WALK_ANIM[elementKey];
  const set = reg && reg.base;
  const frames = (view==='back') ? (set && set.back) : (set && set.front);
  if(!frames || !_framesReady(frames)) return null;
  const key = `W:base:${elementKey}:${view}`;
  if(_skinDataUrlCache[key]) return _skinDataUrlCache[key];
  const urls = frames.map(img=>{
    const c = document.createElement('canvas');
    c.width = _imgW(img); c.height = _imgH(img);
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/png');
  });
  _skinDataUrlCache[key] = urls;
  return urls;
}
function skinWalkFrameDataUrls(skinId, view){
  if(!skinId || typeof WALK_ANIM==='undefined') return null;
  const m = (typeof skinMeta==='function') ? skinMeta(skinId) : null;
  if(!m) return null;
  const reg = WALK_ANIM[m.element];
  if(!reg) return null;
  const useSsr = !!(reg.ssr && reg.ssr.skinId===skinId);
  if(m.kind==='ssr' && !useSsr) return null; // 歩行コマ未提供のSSRスキンは静止画のまま
  const set = useSsr ? reg.ssr : reg.base;
  const frames = (view==='back') ? (set && set.back) : (set && set.front);
  if(!frames || !_framesReady(frames)) return null;
  const key = `W:${skinId}:${view}`;
  if(_skinDataUrlCache[key]) return _skinDataUrlCache[key];
  const urls = frames.map(img=>{
    // SSR専用コマは再着色しない。色スキンは各コマを装備色に再着色する。
    let src = img;
    if(!useSsr && m.kind==='color' && typeof recolorToCanvas==='function'){
      src = recolorToCanvas(img, m.element, m.colorId, 0) || img;
    }
    if(src instanceof HTMLCanvasElement) return src.toDataURL('image/png');
    const c=document.createElement('canvas'); c.width=_imgW(src); c.height=_imgH(src);
    c.getContext('2d').drawImage(src,0,0); return c.toDataURL('image/png');
  });
  _skinDataUrlCache[key]=urls;
  return urls;
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
  } else {
    drawMonsterShape(e, e.hitFlash>0?'#ffffff':el.color, el.dark);

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
      // バトルの邪魔にならないよう、半透明・小さめでHPゲージのすぐ上に出す。
      // 発動直後(stateFlashUntil)だけ「!」付きで少し強く光らせて気づけるようにする
      const flashing = e.stateFlashUntil > matchTime;
      ctx.save();
      ctx.globalAlpha = flashing ? (0.66 + 0.22*Math.sin(matchTime*14)) : (0.34 + 0.10*Math.sin(matchTime*6));
      ctx.font = `bold 10px 'Rajdhani', sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(255,70,70,0.95)';
      ctx.shadowBlur = flashing ? 7 : 3; ctx.shadowColor = 'rgba(255,0,0,0.75)';
      ctx.fillText(flashing ? sc.name+'!' : sc.name, 0, -e.radius*1.55-13);
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
// ビリビリ(電撃アーク)の[暗い色, 明るい色]を返す。装備スキンの差し色(auraTint)があれば
// その色基調にする(ちょこの「ヴァニッシュ」= 球体とドームは黒のままアークだけ赤)。
function arcColorsFor(tint){
  if(!tint) return ['#3a1560', '#8b46c9']; // 既定: ビッグバンの紫
  return [_mixHex(tint, '#000000', 0.55), tint];
}
function _mixHex(a, b, t){
  const [r1,g1,b1] = hexToRgb(a), [r2,g2,b2] = hexToRgb(b);
  const m = (x,y)=> Math.round(x + (y-x)*t);
  return '#' + [m(r1,r2), m(g1,g2), m(b1,b2)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
/* =====================================================================
   リアルマップの弾エフェクト(絵文字の置き換え)
   ・通常マップで絵文字(🔥💧⚡️…)を出している技だけを、リアルマップでは
     その技に合った実体のあるエフェクトに差し替える。
   ・読む値は通常マップと同じ pr.color / pr.hitR / 進行方向なので、
     技の性能(威力の見た目=hitR、色)を変えれば2D/3Dの両方に効く。
   ・すでに専用の見た目を持つ技(projStyle/shape)には触らない。
===================================================================== */
// 絵文字の異体字セレクタと肌色modifierを落として引く(👊🏻と👊🏿を同じ扱いにする)
function fxIconKey(icon){ return String(icon).replace(/[️\u{1F3FB}-\u{1F3FF}]/gu, ''); }
// 進行方向を「画面上での向き」に直す。長い弾はこれを使わないと奥へ撃った時に横倒しに見える
function fxProjScreenAngle(pr){
  const ta = (pr.vx!=null && pr.vy!=null) ? Math.atan2(pr.vy, pr.vx) : 0;
  let sa = ta - camState.yaw;
  const pA = project(pr.x, pr.y, pr.z);
  const pB = project(pr.x + Math.cos(ta)*80, pr.y + Math.sin(ta)*80, pr.z);
  if(pA && pB){
    const dx = pB.x-pA.x, dy = pB.y-pA.y;
    if(Math.hypot(dx,dy) > 0.5) sa = Math.atan2(dy, dx);
  }
  return sa;
}
function fxStrokePath(pts, color, w, alpha, blur){
  if(pts.length<2) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineJoin='round'; ctx.lineCap='round';
  if(blur && !renderHeavyLoad){ ctx.shadowBlur = blur; ctx.shadowColor = color; }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();
}
// 火の玉(ファイア/ファイアブレス/火炎砲)
// 炎は「くすんだ煙 → 技色 → 白熱の芯」の3層を加算合成で重ねて作る。
// 平らな色を塗り重ねると安っぽく見えるので、必ずグラデーションと乱れた輪郭で描く
function fxIconFire(pr, r){
  const col = pr.color || '#ff6b35';
  const ramp = fx3dFireRamp(col);
  const seed = (pr.id||0);
  const ang = fxProjScreenAngle(pr);
  ctx.save();
  ctx.rotate(ang);
  // 後ろへ長く伸びる炎の尾。3枚を長さ・太さ・揺れの速さを変えて重ねる
  for(let k=0;k<3;k++){
    const len = r*(4.2 - k*1.05), w = r*(1.15 - k*0.3);
    const segs = 7;
    const up=[], dn=[];
    for(let i=0;i<=segs;i++){
      const f = i/segs;                                  // 0=先頭 1=尾の先
      const x = r*0.6 - len*f;
      const wob = Math.sin(matchTime*(16+k*6) + seed + f*5.2 + k*2.1)*r*0.42*f
                + Math.sin(matchTime*(27+k*4) + seed*1.7 + f*9.1)*r*0.16*f;
      const hw = w*Math.pow(1-f, 0.55)*(1 + 0.22*Math.sin(f*8 + matchTime*13 + k));
      up.push({ x, y: wob - hw });
      dn.push({ x, y: wob + hw });
    }
    const g = ctx.createLinearGradient(r*0.6, 0, r*0.6-len, 0);
    if(k===0){      g.addColorStop(0, ramp.body); g.addColorStop(0.45, ramp.smoke); g.addColorStop(1, _hexA(ramp.smoke, 0)); }
    else if(k===1){ g.addColorStop(0, ramp.hot);  g.addColorStop(0.5,  ramp.body);  g.addColorStop(1, _hexA(ramp.body, 0)); }
    else {          g.addColorStop(0, ramp.core); g.addColorStop(0.45, ramp.hot);   g.addColorStop(1, _hexA(ramp.hot, 0)); }
    ctx.save();
    ctx.globalAlpha = k===0 ? 0.55 : 0.7;
    if(k>0) ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.moveTo(up[0].x, up[0].y);
    for(let i=1;i<up.length;i++) ctx.lineTo(up[i].x, up[i].y);
    for(let i=dn.length-1;i>=0;i--) ctx.lineTo(dn[i].x, dn[i].y);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  // 火球本体: 外側の熱の輝き → 技色 → 白熱の芯(すべて加算)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 1 + 0.08*Math.sin(matchTime*17 + seed);
  const halo = ctx.createRadialGradient(0,0, r*0.2, 0,0, r*2.1*pulse);
  halo.addColorStop(0, _hexA(ramp.hot, 0.55));
  halo.addColorStop(1, _hexA(ramp.body, 0));
  ctx.beginPath(); ctx.arc(0,0, r*2.1*pulse, 0, Math.PI*2);
  ctx.fillStyle = halo; ctx.fill();
  const body = ctx.createRadialGradient(-r*0.2,-r*0.2, r*0.05, 0,0, r*1.2*pulse);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.3, ramp.core);
  body.addColorStop(0.62, ramp.hot);
  body.addColorStop(1, _hexA(ramp.body, 0.15));
  ctx.beginPath(); ctx.arc(0,0, r*1.2*pulse, 0, Math.PI*2);
  ctx.fillStyle = body; ctx.fill();
  // 舞い上がる火の粉
  for(let k=0;k<5;k++){
    const t = ((matchTime*1.8 + k*0.21 + seed*0.13) % 1);
    const a = matchTime*4 + k*1.9 + seed;
    const er = r*0.14*(1-t*0.7);
    ctx.beginPath();
    ctx.arc(Math.cos(a)*r*(1.2+t*0.8) - r*t*1.6, -r*(0.9 + t*1.8), er, 0, Math.PI*2);
    ctx.fillStyle = _hexA(ramp.core, 0.9*(1-t));
    ctx.fill();
  }
  ctx.restore();
}
/* 以下の弾はどれも同じ作り方でリアルに寄せている:
   ①平らな塗りを使わず、必ずグラデーション(球なら放射・面なら線形)で陰影を付ける
   ②光っている部分(炎・電気・水の反射・魔力)は加算合成(lighter)で重ねる
   ③進行方向は fxProjScreenAngle()、回るものは matchTime から作る                */
// 加算合成で光の暈(かさ)を敷く。弾の周りの空気が光っているように見せる
function fxHalo(r, col, a){
  if(renderHeavyLoad) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(0,0, r*0.25, 0,0, r);
  g.addColorStop(0, _hexA(col, a));
  g.addColorStop(1, _hexA(col, 0));
  ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2);
  ctx.fillStyle = g; ctx.fill();
  ctx.restore();
}
// 水球(水風船/アクアウェイブ/ツバはき)
function fxIconWater(pr, r){
  const col = pr.color || '#3dccc7';
  const deep = _mixHex(col, '#00203f', 0.6);
  ctx.save();
  ctx.rotate(fxProjScreenAngle(pr));
  for(let k=0;k<6;k++){                       // 後ろに散る水滴(だんだん小さく薄く)
    const t = (k+1)/6;
    const rr = r*(0.5-0.06*k);
    const px = -r*(1.2+t*2.4), py = Math.sin(matchTime*16+k*1.7)*r*0.4;
    const g = ctx.createRadialGradient(px-rr*0.3, py-rr*0.3, rr*0.1, px, py, rr);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.5, col);
    g.addColorStop(1, _hexA(deep, 0.2));
    ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI*2);
    ctx.globalAlpha = 0.7*(1-t*0.75); ctx.fillStyle = g; ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  const wob = Math.sin(matchTime*13 + (pr.id||0))*0.16;
  ctx.save();
  ctx.scale(1+wob, 1-wob);                    // 表面張力で揺れる水の玉
  // 本体: 中は透けて、縁が濃く見える(水越しに背景が沈んで見える感じ)
  const g = ctx.createRadialGradient(-r*0.3,-r*0.35, r*0.05, 0,0, r*1.08);
  g.addColorStop(0, _hexA(col, 0.35));
  g.addColorStop(0.55, _hexA(col, 0.6));
  g.addColorStop(0.88, _hexA(deep, 0.85));
  g.addColorStop(1, _hexA(col, 0.5));
  ctx.beginPath(); ctx.arc(0,0,r*1.05,0,Math.PI*2); ctx.fillStyle = g; ctx.fill();
  ctx.save();                                  // 縁の反射光
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath(); ctx.arc(0,0,r*1.0, Math.PI*0.2, Math.PI*0.9);
  ctx.strokeStyle = _hexA('#ffffff', 0.55); ctx.lineWidth = r*0.16; ctx.stroke();
  ctx.restore();
  ctx.restore();
  ctx.save();                                  // 白いハイライト(光源の映り込み)
  ctx.globalCompositeOperation = 'lighter';
  const hg = ctx.createRadialGradient(-r*0.35,-r*0.42, 0, -r*0.35,-r*0.42, r*0.45);
  hg.addColorStop(0, 'rgba(255,255,255,0.95)');
  hg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath(); ctx.ellipse(-r*0.35,-r*0.42, r*0.42, r*0.26, -0.6, 0, Math.PI*2);
  ctx.fillStyle = hg; ctx.fill();
  ctx.restore();
}
// 種(種/種マシンガン): 回転する種+葉
function fxIconSeed(pr, r){
  const col = pr.color || '#7fb236';
  const dark = _mixHex(col, '#12240a', 0.55);
  ctx.rotate(matchTime*13 + (pr.id||0));
  for(let k=0;k<2;k++){
    ctx.save(); ctx.rotate(k*Math.PI);
    const g = ctx.createLinearGradient(r*0.2, -r*0.5, r*1.8, r*0.3);
    g.addColorStop(0, _mixHex(col, '#ffffff', 0.35));
    g.addColorStop(0.6, col);
    g.addColorStop(1, dark);
    ctx.beginPath();
    ctx.moveTo(r*0.2, 0);
    ctx.quadraticCurveTo(r*1.4, -r*0.8, r*2.0, 0);
    ctx.quadraticCurveTo(r*1.4,  r*0.35, r*0.2, 0);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = _hexA(dark, 0.9); ctx.lineWidth = 1.1; ctx.stroke();
    ctx.beginPath();                              // 葉脈
    ctx.moveTo(r*0.3, -r*0.02); ctx.quadraticCurveTo(r*1.2, -r*0.24, r*1.95, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }
  const g = ctx.createRadialGradient(-r*0.3,-r*0.3, r*0.05, 0,0, r*0.9);
  g.addColorStop(0,'#e0c390'); g.addColorStop(0.6,'#9a7038'); g.addColorStop(1,'#4a3014');
  ctx.beginPath(); ctx.ellipse(0,0, r*0.85, r*0.62, 0, 0, Math.PI*2);
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(40,26,8,0.9)'; ctx.lineWidth = 1.3; ctx.stroke();
}
// 稲妻(かみなり/雷撃): 進行方向へ伸びる折れ線+枝
function fxIconBolt(pr, r){
  const col = pr.color || '#f4c430';
  ctx.rotate(fxProjScreenAngle(pr));
  const seed = Math.floor(matchTime*30) + (pr.id||0);
  const N = 6, len = r*3.6;
  const pts = [];
  for(let i=0;i<=N;i++){
    const f = i/N;
    const y = (i===0||i===N) ? 0 : (fxHash01(seed*7.3 + i*3.7)*2-1)*r*0.9;
    pts.push({ x: -len*(1-f) + r*1.3*f, y });
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';   // 加算で「光っている」電気に見せる
  fxStrokePath(pts, col, r*0.6, 0.35, 22);
  fxStrokePath(pts, col, r*0.28, 0.9, 14);
  fxStrokePath(pts, '#ffffff', r*0.11, 1, 0);
  for(let b=0;b<2;b++){                        // 枝分かれ
    const vi = 2 + Math.floor(fxHash01(seed*5.1 + b*17.3)*(N-2));
    const p0 = pts[Math.min(vi, N)];
    const a = (fxHash01(seed*11.7 + b*3.9)*2-1)*1.3;
    const l = r*(1.0 + fxHash01(seed*2.3 + b*9.1));
    const br = [p0, { x:p0.x + Math.cos(a)*l, y:p0.y + Math.sin(a)*l }];
    fxStrokePath(br, col, r*0.16, 0.7, 12);
    fxStrokePath(br, '#ffffff', r*0.06, 0.85, 0);
  }
  if(!renderHeavyLoad){ ctx.shadowBlur = 20; ctx.shadowColor = col; }
  const hg = ctx.createRadialGradient(r*1.3, 0, 0, r*1.3, 0, r*0.9);
  hg.addColorStop(0, 'rgba(255,255,255,0.95)');
  hg.addColorStop(0.45, _hexA(col, 0.7));
  hg.addColorStop(1, _hexA(col, 0));
  ctx.beginPath(); ctx.arc(r*1.3, 0, r*0.9, 0, Math.PI*2);
  ctx.fillStyle = hg; ctx.fill();
  ctx.restore();
}
// ロケットパンチ: 岩の拳+後方の噴射炎
function fxIconFist(pr, r){
  const col = pr.color || '#a98a68';
  const sh = auraShades(col);
  const ramp = fx3dFireRamp('#ff8a3d');
  ctx.rotate(fxProjScreenAngle(pr));
  const jet = r*(2.6 + 0.7*Math.sin(matchTime*28));
  ctx.save();                                    // 噴射炎(加算で本物の炎に寄せる)
  ctx.globalCompositeOperation = 'lighter';
  const jg = ctx.createLinearGradient(-r*0.8, 0, -jet, 0);
  jg.addColorStop(0, ramp.core); jg.addColorStop(0.4, ramp.hot); jg.addColorStop(1, _hexA(ramp.body, 0));
  ctx.beginPath();
  ctx.moveTo(-r*0.8, -r*0.62);
  ctx.quadraticCurveTo(-jet*0.55, -r*0.3, -jet, 0);
  ctx.quadraticCurveTo(-jet*0.55,  r*0.3, -r*0.8, r*0.62);
  ctx.closePath();
  ctx.fillStyle = jg; ctx.globalAlpha = 0.9; ctx.fill();
  ctx.restore();
  const g = ctx.createLinearGradient(0, -r, 0, r);   // 岩肌の陰影(上から光)
  g.addColorStop(0, _mixHex(col, '#ffffff', 0.4));
  g.addColorStop(0.45, col);
  g.addColorStop(1, sh.dark);
  ctx.beginPath();
  ctx.moveTo(-r*0.85, -r*0.85);
  ctx.lineTo(r*0.55, -r*0.9);
  ctx.quadraticCurveTo(r*1.15, 0, r*0.55, r*0.9);
  ctx.lineTo(-r*0.85, r*0.85);
  ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = sh.dark; ctx.lineWidth = 1.8; ctx.stroke();
  for(let k=0;k<4;k++){                              // 指の関節(球状に陰影を付ける)
    const ky = -r*0.62 + k*r*0.42;
    const kg = ctx.createRadialGradient(r*0.48, ky-r*0.08, r*0.03, r*0.55, ky, r*0.26);
    kg.addColorStop(0, _mixHex(col, '#ffffff', 0.6));
    kg.addColorStop(1, sh.dark);
    ctx.beginPath(); ctx.arc(r*0.55, ky, r*0.24, 0, Math.PI*2);
    ctx.fillStyle = kg; ctx.fill();
  }
  ctx.beginPath(); ctx.ellipse(-r*0.15, r*0.62, r*0.34, r*0.2, 0.5, 0, Math.PI*2);
  ctx.fillStyle = sh.mid; ctx.fill();               // 親指
  ctx.strokeStyle = sh.dark; ctx.lineWidth = 1.2; ctx.stroke();
  for(let k=0;k<3;k++){                              // 岩肌のひび
    const h = fxHash01((pr.id||0)*3.7 + k*11.3);
    ctx.beginPath();
    ctx.moveTo(-r*0.7 + h*r*0.8, -r*0.7 + k*r*0.55);
    ctx.lineTo(-r*0.3 + h*r*0.9, -r*0.4 + k*r*0.55);
    ctx.strokeStyle = _hexA(sh.dark, 0.7); ctx.lineWidth = 1; ctx.stroke();
  }
}
// 掌打(掌打/もんた): 手のひら+前方に広がる衝撃の輪
function fxIconPalm(pr, r){
  const col = pr.color || '#a98a68';
  const sh = auraShades(col);
  ctx.rotate(fxProjScreenAngle(pr));
  ctx.save();                                       // 押し出される空気の輪
  ctx.globalCompositeOperation = 'lighter';
  for(let k=0;k<3;k++){
    const t = ((matchTime*2.4 + k/3) % 1);
    ctx.beginPath();
    ctx.ellipse(r*(0.9 + t*1.8), 0, r*0.22, r*(0.9 + t*0.9), 0, 0, Math.PI*2);
    ctx.strokeStyle = _hexA(sh.bright, 0.55*(1-t)); ctx.lineWidth = r*0.16; ctx.stroke();
  }
  ctx.restore();
  const g = ctx.createRadialGradient(-r*0.3,-r*0.4, r*0.05, 0, 0, r*1.1);
  g.addColorStop(0, _mixHex(col, '#ffffff', 0.5));
  g.addColorStop(0.6, col);
  g.addColorStop(1, sh.dark);
  ctx.beginPath(); ctx.ellipse(-r*0.1, 0, r*0.9, r*1.0, 0, 0, Math.PI*2);
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = sh.dark; ctx.lineWidth = 1.8; ctx.stroke();
  for(let k=0;k<4;k++){                              // 指
    const fy = -r*0.66 + k*r*0.44;
    const fg = ctx.createLinearGradient(r*0.4, fy-r*0.2, r*1.05, fy+r*0.2);
    fg.addColorStop(0, _mixHex(col, '#ffffff', 0.55));
    fg.addColorStop(1, sh.mid);
    ctx.beginPath(); ctx.ellipse(r*0.72, fy, r*0.34, r*0.19, 0, 0, Math.PI*2);
    ctx.fillStyle = fg; ctx.fill();
    ctx.strokeStyle = sh.dark; ctx.lineWidth = 1.1; ctx.stroke();
  }
  ctx.beginPath(); ctx.ellipse(-r*0.2, r*0.95, r*0.36, r*0.2, 0.6, 0, Math.PI*2);
  ctx.fillStyle = sh.mid; ctx.fill();
  ctx.strokeStyle = sh.dark; ctx.lineWidth = 1.1; ctx.stroke();
}
// 刃(ヴェノムエッジ/ソニックナイフ/アサルトアロー): 回転する短剣+斬光
function fxIconBlade(pr, r){
  const col = pr.color || '#8b2fc9';
  const sh = auraShades(col);
  const spin = matchTime*14 + (pr.id||0);
  ctx.rotate(spin);
  ctx.save();                                        // 回転の残光
  ctx.globalCompositeOperation = 'lighter';
  const tg = ctx.createLinearGradient(-r*1.9, 0, r*1.9, 0);
  tg.addColorStop(0, _hexA(col, 0));
  tg.addColorStop(1, _hexA(sh.bright, 0.5));
  ctx.beginPath(); ctx.arc(0,0, r*1.9, 0, Math.PI*1.15);
  ctx.strokeStyle = tg; ctx.lineWidth = r*0.26; ctx.stroke();
  ctx.restore();
  // 刃: 峰から刃先へ向かう金属のグラデーション(白い筋を入れて鋼に見せる)
  const g = ctx.createLinearGradient(0, -r*0.45, 0, r*0.45);
  g.addColorStop(0, sh.dark);
  g.addColorStop(0.38, '#ffffff');
  g.addColorStop(0.55, sh.bright);
  g.addColorStop(1, sh.mid);
  ctx.beginPath();
  ctx.moveTo(r*2.1, 0); ctx.lineTo(r*0.2, -r*0.45); ctx.lineTo(r*0.2, r*0.45);
  ctx.closePath(); ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = sh.outline; ctx.lineWidth = 1.3; ctx.stroke();
  ctx.save();                                        // 刃先の光沢が流れる
  ctx.globalCompositeOperation = 'lighter';
  const shine = (Math.sin(spin*0.7)*0.5+0.5);
  ctx.beginPath();
  ctx.moveTo(r*(0.4+1.5*shine), -r*0.06); ctx.lineTo(r*(0.7+1.3*shine), 0); ctx.lineTo(r*(0.4+1.5*shine), r*0.06);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
  ctx.restore();
  ctx.beginPath();                                   // 鍔
  ctx.moveTo(r*0.16, -r*0.7); ctx.lineTo(r*0.36, -r*0.7);
  ctx.lineTo(r*0.36, r*0.7); ctx.lineTo(r*0.16, r*0.7);
  ctx.closePath(); ctx.fillStyle = sh.dark; ctx.fill();
  const hg = ctx.createLinearGradient(0, -r*0.2, 0, r*0.2);   // 柄
  hg.addColorStop(0, sh.mid); hg.addColorStop(1, sh.dark);
  ctx.beginPath();
  ctx.moveTo(-r*1.1, -r*0.2); ctx.lineTo(r*0.2, -r*0.2);
  ctx.lineTo(r*0.2, r*0.2); ctx.lineTo(-r*1.1, r*0.2);
  ctx.closePath(); ctx.fillStyle = hg; ctx.fill();
  ctx.strokeStyle = sh.outline; ctx.lineWidth = 1; ctx.stroke();
}
// 光の矢(熾天の剣): 進行方向を向いた黄金の矢
function fxIconArrow(pr, r){
  const col = pr.color || '#ffe9a8';
  const sh = auraShades(col);
  ctx.rotate(fxProjScreenAngle(pr));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const tail = ctx.createLinearGradient(-r*3.4, 0, r*0.5, 0);   // 尾を引く光
  tail.addColorStop(0, _hexA(col, 0));
  tail.addColorStop(1, _hexA(sh.bright, 0.8));
  ctx.beginPath();
  ctx.moveTo(-r*3.4, 0); ctx.lineTo(-r*0.4, -r*0.3); ctx.lineTo(-r*0.4, r*0.3);
  ctx.closePath(); ctx.fillStyle = tail; ctx.fill();
  ctx.restore();
  const sg = ctx.createLinearGradient(0, -r*0.13, 0, r*0.13);   // 矢柄
  sg.addColorStop(0, sh.bright); sg.addColorStop(1, sh.mid);
  ctx.beginPath();
  ctx.moveTo(-r*1.2, -r*0.13); ctx.lineTo(r*0.9, -r*0.13);
  ctx.lineTo(r*0.9, r*0.13); ctx.lineTo(-r*1.2, r*0.13);
  ctx.closePath(); ctx.fillStyle = sg; ctx.fill();
  const hg = ctx.createLinearGradient(r*0.7, -r*0.62, r*2.2, r*0.62);  // 鏃
  hg.addColorStop(0, '#ffffff'); hg.addColorStop(0.5, sh.bright); hg.addColorStop(1, col);
  ctx.beginPath();
  ctx.moveTo(r*2.2, 0); ctx.lineTo(r*0.7, -r*0.62); ctx.lineTo(r*1.0, 0); ctx.lineTo(r*0.7, r*0.62);
  ctx.closePath(); ctx.fillStyle = hg; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.3; ctx.stroke();
  for(let k=-1;k<=1;k+=2){                                       // 矢羽
    const fg = ctx.createLinearGradient(-r*1.2, 0, -r*2.0, k*r*0.6);
    fg.addColorStop(0, sh.bright); fg.addColorStop(1, _hexA(col, 0.25));
    ctx.beginPath();
    ctx.moveTo(-r*1.2, 0); ctx.lineTo(-r*2.0, k*r*0.6); ctx.lineTo(-r*0.7, k*r*0.16);
    ctx.closePath(); ctx.fillStyle = fg; ctx.fill();
  }
  fxHalo(r*2.2, col, 0.3);
}
// 毒ガス(毒ガス/毒噴射): 湧き上がる濃い霧の塊
function fxIconGas(pr, r){
  const col = pr.color || '#9b5fd1';
  const sh = auraShades(col);
  const seed = (pr.id||0);
  // 平らな円を並べるとシャボン玉に見えるので、縁がぼける放射グラデーションで雲にする
  for(let k=0;k<6;k++){
    const a = matchTime*1.6 + k*(Math.PI*2/6) + seed;
    const dist = r*(0.5 + 0.22*Math.sin(matchTime*2.6 + k*1.7));
    const px = Math.cos(a)*dist, py = Math.sin(a)*dist*0.85;
    const rr = r*(0.85 + 0.28*Math.sin(matchTime*3.1 + k*2.3));
    const g = ctx.createRadialGradient(px, py, 0, px, py, rr);
    g.addColorStop(0, _hexA(k%2 ? col : sh.bright, 0.5));
    g.addColorStop(0.55, _hexA(sh.dark, 0.34));
    g.addColorStop(1, _hexA(sh.dark, 0));
    ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI*2);
    ctx.fillStyle = g; ctx.fill();
  }
  const cg = ctx.createRadialGradient(0,0,0, 0,0, r*0.95);       // 濃い芯
  cg.addColorStop(0, _hexA(sh.bright, 0.75));
  cg.addColorStop(0.6, _hexA(col, 0.5));
  cg.addColorStop(1, _hexA(col, 0));
  ctx.beginPath(); ctx.arc(0,0, r*0.95, 0, Math.PI*2);
  ctx.fillStyle = cg; ctx.fill();
  for(let k=0;k<3;k++){                                          // 立ちのぼる泡
    const t = ((matchTime*1.4 + k/3 + seed*0.11) % 1);
    const br = r*0.17*(1-t*0.5);
    ctx.beginPath();
    ctx.arc(Math.sin(matchTime*3+k*2)*r*0.5, -r*(0.8 + t*1.5), br, 0, Math.PI*2);
    ctx.fillStyle = _hexA(sh.spark, 0.55*(1-t)); ctx.fill();
  }
}
// 花びら(さくらふぶき): 渦を巻く花びらの塊
function fxIconPetals(pr, r){
  const col = pr.color || '#ff8fc4';
  const sh = auraShades(col);
  fxHalo(r*2.0, col, 0.3);
  for(let k=0;k<7;k++){
    const a = matchTime*5.5 + k*(Math.PI*2/7) + (pr.id||0);
    const rr = r*(0.5 + 0.4*Math.sin(matchTime*4 + k*1.3));
    const tilt = Math.sin(matchTime*6 + k*2.1);        // 裏返りを厚みの変化で見せる
    ctx.save();
    ctx.translate(Math.cos(a)*rr, Math.sin(a)*rr*0.75);
    ctx.rotate(a*1.4);
    const g = ctx.createLinearGradient(-r*0.55, 0, r*0.55, 0);
    g.addColorStop(0, sh.bright);
    g.addColorStop(0.5, col);
    g.addColorStop(1, _mixHex(col, '#8a2f5c', 0.45));
    ctx.beginPath();
    ctx.ellipse(0, 0, r*0.55, r*0.3*Math.max(0.25, Math.abs(tilt)), 0, 0, Math.PI*2);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const cg = ctx.createRadialGradient(0,0,0, 0,0, r*0.5);
  cg.addColorStop(0, 'rgba(255,255,255,0.9)');
  cg.addColorStop(1, _hexA(col, 0));
  ctx.beginPath(); ctx.arc(0,0,r*0.5,0,Math.PI*2);
  ctx.fillStyle = cg; ctx.fill();
  ctx.restore();
}
// ハート(キッス): 光るハート+後ろに続く小さなハート
function fxIconHeart(pr, r){
  const col = pr.color || '#ff4d6d';
  const sh = auraShades(col);
  const heart = (s)=>{
    ctx.beginPath();
    ctx.moveTo(0, s*0.95);
    ctx.bezierCurveTo(-s*1.35, s*0.05, -s*0.62, -s*1.05, 0, -s*0.32);
    ctx.bezierCurveTo(s*0.62, -s*1.05, s*1.35, s*0.05, 0, s*0.95);
    ctx.closePath();
  };
  ctx.save();
  ctx.rotate(fxProjScreenAngle(pr));
  for(let k=0;k<3;k++){                              // 後を追う小さなハート
    ctx.save();
    ctx.translate(-r*(1.4 + k*1.0), Math.sin(matchTime*8 + k*1.6)*r*0.5);
    ctx.rotate(-Math.PI/2);
    heart(r*(0.42 - k*0.09));
    ctx.globalAlpha = 0.5 - k*0.13; ctx.fillStyle = col; ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  fxHalo(r*2.2, col, 0.4);
  const pulse = 1 + 0.12*Math.sin(matchTime*11 + (pr.id||0));
  ctx.save();
  ctx.scale(pulse, pulse);
  heart(r*1.15);
  const g = ctx.createRadialGradient(-r*0.35,-r*0.45, r*0.05, 0,0, r*1.4);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.32, sh.bright);
  g.addColorStop(0.75, col);
  g.addColorStop(1, _mixHex(col, '#3a0010', 0.5));
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = _hexA(sh.outline, 0.9); ctx.lineWidth = 1.3; ctx.stroke();
  ctx.save();                                        // 表面の照り
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath(); ctx.ellipse(-r*0.4,-r*0.42, r*0.26, r*0.15, -0.5, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
  ctx.restore();
  ctx.restore();
}
// 斬撃(しっぽふり): 進行方向へ振り抜く三日月の斬り跡
function fxIconSlash(pr, r){
  const col = pr.color || '#ffe9a8';
  const sh = auraShades(col);
  ctx.rotate(fxProjScreenAngle(pr) + Math.sin(matchTime*10 + (pr.id||0))*0.12);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // 三日月の内側(刃筋)が明るく、外へ向かって消えていくグラデーション
  const g = ctx.createRadialGradient(-r*0.5, 0, r*1.5, -r*0.5, 0, r*2.4);
  g.addColorStop(0, _hexA(sh.bright, 0.85));
  g.addColorStop(0.55, _hexA(col, 0.6));
  g.addColorStop(1, _hexA(col, 0));
  ctx.beginPath();
  ctx.arc(-r*0.5, 0, r*1.9, -Math.PI*0.42, Math.PI*0.42, false);
  ctx.arc(-r*1.5, 0, r*2.35, Math.PI*0.32, -Math.PI*0.32, true);
  ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.beginPath();                                    // 刃筋の白い芯
  ctx.arc(-r*0.5, 0, r*1.74, -Math.PI*0.36, Math.PI*0.36, false);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = r*0.14; ctx.stroke();
  ctx.beginPath();                                    // 外へ散る余韻
  ctx.arc(-r*0.5, 0, r*2.08, -Math.PI*0.28, Math.PI*0.28, false);
  ctx.strokeStyle = _hexA(sh.bright, 0.5); ctx.lineWidth = r*0.07; ctx.stroke();
  ctx.restore();
}
// 既定: 光の弾(表にない絵文字が来てもリアルマップでは絵文字を出さない)
function fxIconEnergy(pr, r){
  const col = pr.color || '#ffffff';
  const sh = auraShades(col);
  ctx.save();
  ctx.rotate(fxProjScreenAngle(pr));
  const tail = ctx.createLinearGradient(-r*3, 0, 0, 0);
  tail.addColorStop(0, 'rgba(255,255,255,0)'); tail.addColorStop(1, col);
  ctx.beginPath();
  ctx.moveTo(-r*3, 0); ctx.lineTo(-r*0.3, -r*0.6); ctx.lineTo(-r*0.3, r*0.6);
  ctx.closePath(); ctx.fillStyle = tail; ctx.globalAlpha = 0.7; ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
  fxHalo(r*2.2, col, 0.45);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(-r*0.25,-r*0.25, r*0.05, 0,0, r*1.1);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.4, sh.bright);
  g.addColorStop(1, _hexA(col, 0.2));
  ctx.beginPath(); ctx.arc(0,0,r*1.05,0,Math.PI*2); ctx.fillStyle = g; ctx.fill();
  ctx.restore();
}
// 絵文字 → リアルマップでの見た目
const REAL_ICON_FX = {
  '🔥': fxIconFire,
  '💧': fxIconWater,
  '🍃': fxIconSeed,
  '⚡': fxIconBolt,
  '👊': fxIconFist,
  '🤚': fxIconPalm,
  '🖐': fxIconPalm,
  '🗡': fxIconBlade,
  '🏹': fxIconArrow,
  '☠': fxIconGas,
  '🌸': fxIconPetals,
  '💋': fxIconHeart,
  '🌱': fxIconSlash,
};
function drawProjectile(pr,p){
  ctx.save();
  ctx.translate(p.x,p.y);
  ctx.scale(p.scale,p.scale);

  // リアルマップでは絵文字の弾をその技に合った実体のあるエフェクトに差し替える。
  // 専用の見た目を持つ技(projStyle/shape)は対象外なので、条件は2Dの絵文字分岐と同じ。
  if(pr.icon && !pr.projStyle && !pr.shape && real3dFx()){
    const fn = REAL_ICON_FX[fxIconKey(pr.icon)] || fxIconEnergy;
    fn(pr, Math.max(7, (pr.hitR||12)*1.15));
    ctx.restore();
    return;
  }

  if(pr.projStyle==='godorb'){
    // ゴッドライジング(ガリ): 各色に発光する球+ビリビリの電撃アーク
    const col = pr.orbColor || pr.color || '#ffffff';
    const r = (pr.hitR||24);
    if(!renderHeavyLoad){ ctx.shadowBlur=22; ctx.shadowColor=col; }
    const grad = ctx.createRadialGradient(-r*0.25,-r*0.25,r*0.1, 0,0,r);
    grad.addColorStop(0,'#ffffff');
    grad.addColorStop(0.4, col);
    grad.addColorStop(1, col);
    ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fillStyle=grad; ctx.fill();
    ctx.shadowBlur=0;
    // 周囲のビリビリ(電撃アーク)
    const jseed = Math.floor(matchTime*18) + (pr.id||0);
    ctx.lineCap='round'; ctx.lineJoin='round';
    for(let k=0;k<4;k++){
      const baseA = fxHash01(jseed*13+k*7)*Math.PI*2;
      const arcSpan = 0.8 + fxHash01(jseed*29+k*11)*0.9;
      const segs=5; ctx.beginPath();
      for(let s=0;s<=segs;s++){
        const a=baseA+arcSpan*(s/segs);
        const rr=r*1.35+(fxHash01(jseed*37+k*17+s*5)-0.5)*r*0.6;
        const px=Math.cos(a)*rr, py=Math.sin(a)*rr;
        if(s===0)ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.globalAlpha=0.5; ctx.strokeStyle=col; ctx.lineWidth=4; ctx.stroke();
      ctx.globalAlpha=0.95; ctx.strokeStyle='#ffffff'; ctx.lineWidth=1.6; ctx.stroke();
    }
    ctx.globalAlpha=1;
    ctx.restore();
    return;
  }
  if(pr.projStyle==='voidOrb'){
    // ビッグバン(ピクシー): 黒く発光する球+周囲に黒いビリビリ(電撃アーク)
    const col = pr.color || '#14121c';
    const r = (pr.hitR||24);
    if(!renderHeavyLoad){ ctx.shadowBlur=20; ctx.shadowColor='#6b2fa8'; }
    const grad = ctx.createRadialGradient(-r*0.25,-r*0.25,r*0.1, 0,0,r);
    grad.addColorStop(0,'#3a2050');
    grad.addColorStop(0.5, col);
    grad.addColorStop(1, '#000000');
    ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fillStyle=grad; ctx.fill();
    ctx.shadowBlur=0;
    // 周囲のビリビリ(電撃アーク)。既定は黒紫、装備スキンの差し色があればその色に
    const [arcDim, arcLit] = arcColorsFor(pr.auraTint);
    const jseed = Math.floor(matchTime*18) + (pr.id||0);
    ctx.lineCap='round'; ctx.lineJoin='round';
    for(let k=0;k<4;k++){
      const baseA = fxHash01(jseed*13+k*7)*Math.PI*2;
      const arcSpan = 0.8 + fxHash01(jseed*29+k*11)*0.9;
      const segs=5; ctx.beginPath();
      for(let s=0;s<=segs;s++){
        const a=baseA+arcSpan*(s/segs);
        const rr=r*1.35+(fxHash01(jseed*37+k*17+s*5)-0.5)*r*0.6;
        const px=Math.cos(a)*rr, py=Math.sin(a)*rr;
        if(s===0)ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.globalAlpha=0.55; ctx.strokeStyle=arcDim; ctx.lineWidth=4; ctx.stroke();
      ctx.globalAlpha=0.9; ctx.strokeStyle=arcLit; ctx.lineWidth=1.6; ctx.stroke();
    }
    ctx.globalAlpha=1;
    ctx.restore();
    return;
  }
  if(pr.projStyle==='crescent'){
    // ダークホウスト(ザン): 回転する黒い三日月型の斬撃
    const r = (pr.hitR||20)*1.6;
    const spin = matchTime*15 + (pr.id||0);
    if(!renderHeavyLoad){ ctx.shadowBlur=12; ctx.shadowColor='#7a80a8'; }
    ctx.rotate(spin);
    // 三日月: 外円の弧から、少しずらした内円の弧で刳り抜いた形
    const R=r, R2=r*1.02, off=r*0.62;
    ctx.beginPath();
    ctx.arc(0, 0, R, Math.PI*0.55, Math.PI*1.45, false);
    ctx.arc(off, 0, R2, Math.PI*1.28, Math.PI*0.72, true);
    ctx.closePath();
    ctx.fillStyle='#14151d'; ctx.fill();
    ctx.strokeStyle='rgba(160,170,210,0.9)'; ctx.lineWidth=2; ctx.stroke();
    // 刃の内縁の鋭い光沢
    ctx.beginPath();
    ctx.arc(0,0,R*0.9, Math.PI*0.62, Math.PI*1.38, false);
    ctx.strokeStyle='rgba(210,220,255,0.75)'; ctx.lineWidth=1.4; ctx.stroke();
    ctx.restore();
    return;
  }
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
    // 天の慈悲(アーク): 黄金の聖剣+回転する光輪と光条 (SSR装備時は装備オーラ色基調に)
    const sh = pr.auraTint ? auraShades(pr.auraTint) : null;
    const glow = sh ? sh.bright : '#ffe9a8';
    const blade = sh ? sh.mid : '#ffe9a8';
    const edge = sh ? sh.outline : '#ffffff';
    const r = (pr.hitR||14)*1.3;
    const travelAngle = (pr.vx!=null && pr.vy!=null) ? Math.atan2(pr.vy,pr.vx) : 0;
    const spin = matchTime*2.2;
    if(!renderHeavyLoad){ ctx.shadowBlur=18; ctx.shadowColor=glow; }
    ctx.save();
    ctx.rotate(spin);
    ctx.strokeStyle=glow; ctx.globalAlpha=0.8; ctx.lineWidth=2.2;
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
    ctx.fillStyle=blade; ctx.fill();
    ctx.strokeStyle=edge; ctx.lineWidth=2; ctx.stroke();
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
  if(pr.projStyle==='seaSpear'){
    // アムピトリテ(ペルセポネ): 大きな三叉の槍。進行方向を向き、白い芯+オーラ色の刃で光る。
    // 色は pr.color(=装備オーラ色)なので、スキンのオーラを変えればそのまま追従する。
    const col = pr.color || '#3d7dff';
    const r = (pr.hitR||30)*1.25;
    // 進行方向を「画面上での向き」に直して回転させる。
    // 他の弾と同じ (travelAngle - camState.yaw) だと、カメラの奥へ撃ったときに
    // 長い槍が画面右向き=横倒しに見えてしまう(短い弾では目立たないが槍は目立つ)。
    // 進行方向へ少し進んだ点を投影し、画面上の差分から角度を取れば奥行きも正しく向く。
    const travelAngle = (pr.vx!=null && pr.vy!=null) ? Math.atan2(pr.vy,pr.vx) : 0;
    let screenAngle = travelAngle - camState.yaw;
    const pA = project(pr.x, pr.y, pr.z);
    const pB = project(pr.x + Math.cos(travelAngle)*80, pr.y + Math.sin(travelAngle)*80, pr.z);
    if(pA && pB){
      const dx = pB.x - pA.x, dy = pB.y - pA.y;
      if(Math.hypot(dx,dy) > 0.5) screenAngle = Math.atan2(dy, dx);
    }
    ctx.rotate(screenAngle);
    if(!renderHeavyLoad){ ctx.shadowBlur=24; ctx.shadowColor=col; }
    ctx.lineJoin='round'; ctx.lineCap='round';
    // 後方へ伸びる水の尾
    const tail = ctx.createLinearGradient(-r*2.6,0, -r*0.4,0);
    tail.addColorStop(0,'rgba(255,255,255,0)');
    tail.addColorStop(1, col);
    ctx.beginPath();
    ctx.moveTo(-r*2.6, 0); ctx.lineTo(-r*0.4, -r*0.34); ctx.lineTo(-r*0.4, r*0.34);
    ctx.closePath(); ctx.fillStyle=tail; ctx.globalAlpha=0.75; ctx.fill(); ctx.globalAlpha=1;
    // 柄
    ctx.beginPath();
    ctx.moveTo(-r*1.5, -r*0.11); ctx.lineTo(r*0.45, -r*0.11);
    ctx.lineTo(r*0.45, r*0.11); ctx.lineTo(-r*1.5, r*0.11);
    ctx.closePath(); ctx.fillStyle=col; ctx.fill();
    // 三叉の穂先(中央が長い)
    const prong = (off, len)=>{
      ctx.beginPath();
      ctx.moveTo(r*len, off*0.35);
      ctx.lineTo(r*0.5, off - Math.sign(off||1)*r*0.06);
      ctx.lineTo(r*0.5, off + Math.sign(off||1)*r*0.16);
      ctx.closePath();
      ctx.fillStyle=col; ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,0.85)'; ctx.lineWidth=1.6; ctx.stroke();
    };
    prong(-r*0.72, 1.55);
    prong( r*0.72, 1.55);
    // 中央の刃(白い芯を入れて鋭く見せる)
    ctx.beginPath();
    ctx.moveTo(r*2.15, 0); ctx.lineTo(r*0.35, -r*0.3); ctx.lineTo(r*0.35, r*0.3);
    ctx.closePath(); ctx.fillStyle=col; ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.lineWidth=1.8; ctx.stroke();
    ctx.shadowBlur=0;
    ctx.beginPath();
    ctx.moveTo(r*1.85, 0); ctx.lineTo(r*0.55, -r*0.1); ctx.lineTo(r*0.55, r*0.1);
    ctx.closePath(); ctx.fillStyle='rgba(255,255,255,0.92)'; ctx.fill();
    // 根元の球(杖の宝珠)
    const g = ctx.createRadialGradient(-r*0.85,-r*0.1,r*0.05, -r*0.75,0,r*0.4);
    g.addColorStop(0,'#ffffff'); g.addColorStop(1,col);
    ctx.beginPath(); ctx.arc(-r*0.75,0,r*0.34,0,Math.PI*2);
    ctx.fillStyle=g; ctx.fill();
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
    ctx.textAlign='center'; ctx.globalAlpha=a;
    if(pt.big){
      // オーラ有利/不利の被弾ダメージは大きく縁取りして強調
      ctx.font="bold 20px 'Share Tech Mono', monospace";
      ctx.lineWidth=4; ctx.strokeStyle='rgba(0,0,0,0.85)'; ctx.strokeText(pt.text, 0,0);
      ctx.fillStyle = pt.color; ctx.fillText(pt.text, 0,0);
    } else {
      ctx.font="bold 13px 'Share Tech Mono', monospace";
      ctx.fillStyle = pt.color; ctx.fillText(pt.text, 0,0);
    }
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
/* リアルマップ(テスト)用の岩。WebGL地形と同じ向きの太陽で陰影を付け、面と粒感で
   立体的に見せる。通常マップの岩(この下のdrawRock後半)には一切影響しない。 */
const REAL_ROCK_SUN = { x:-0.55, y:-0.38 };   // real3d.jsのSUN_DIRと同じ向き(ゲーム座標)
const REAL_ROCK_DETAIL_PX = 14;               // 画面上でこれより小さい岩は細部を描かない(負荷対策)
// 岩の色(リアルマップ用)。マップの岩の種類に合わせる
const REAL_ROCK_COLORS = {
  rock:     ['#c6b697','#8c7f68','#484137'],
  sandrock: ['#e0c894','#b39a68','#6a5738'],
  snowrock: ['#ffffff','#c3d2e0','#7d8b9c'],
};
function drawRealisticRock(rock, r, screenR){
  const seed = rock.seed || 0;
  const pal = REAL_ROCK_COLORS[rock.flavor] || REAL_ROCK_COLORS.rock;
  const rnd = (i)=>{ const n = Math.sin((seed+1.7)*12.9898 + i*78.233)*43758.5453; return n - Math.floor(n); };
  // 太陽の向きを画面の左右に変換する(カメラを回すと光の当たる側も入れ替わる)
  const lit = clamp((-REAL_ROCK_SUN.x*Math.sin(camState.yaw) + REAL_ROCK_SUN.y*Math.cos(camState.yaw))/0.67, -1, 1);
  const h = r*1.12, cy = -h*0.5;
  // 接地影は光の反対側へ伸ばす
  ctx.beginPath(); ctx.ellipse(-lit*r*0.3, -r*0.02, r*1.12, r*0.32, 0,0,Math.PI*2);
  ctx.fillStyle='rgba(26,20,13,0.36)'; ctx.fill();
  const N = 9, pts = [];
  for(let i=0;i<N;i++){
    const a = (i/N)*Math.PI*2 + seed*0.31;
    const k = 0.74 + 0.34*rnd(i);
    pts.push({ x:Math.cos(a)*r*k, y:cy + Math.sin(a)*h*0.5*k, a });
  }
  const path = ()=>{ ctx.beginPath(); pts.forEach((q,i)=>{ if(i===0) ctx.moveTo(q.x,q.y); else ctx.lineTo(q.x,q.y); }); ctx.closePath(); };
  const g = ctx.createLinearGradient(lit*r, cy-h*0.55, -lit*r, cy+h*0.6);
  g.addColorStop(0,   pal[0]);
  g.addColorStop(0.45, pal[1]);
  g.addColorStop(1,   pal[2]);
  path(); ctx.fillStyle=g; ctx.fill();
  if(screenR >= REAL_ROCK_DETAIL_PX){
    // 光の当たる面と陰の面を1枚ずつ重ねて、丸い塊ではなく多面体に見せる
    const litAng = Math.atan2(-0.8, lit || 0.001);
    const facet = (baseAng, style)=>{
      let idx = 0, best = 9;
      for(let i=0;i<N;i++){
        let d = Math.abs(((pts[i].a - baseAng + Math.PI*3)%(Math.PI*2)) - Math.PI);
        if(d < best){ best = d; idx = i; }
      }
      ctx.beginPath();
      for(let k=-1;k<=1;k++){
        const q = pts[(idx+k+N)%N];
        if(k===-1) ctx.moveTo(q.x*0.98, q.y*0.98); else ctx.lineTo(q.x*0.98, q.y*0.98);
      }
      ctx.lineTo(0, cy); ctx.closePath();
      ctx.fillStyle = style; ctx.fill();
    };
    facet(litAng, 'rgba(255,246,224,0.20)');
    facet(litAng + Math.PI, 'rgba(20,15,10,0.22)');
    // 粒感(小石と欠け)
    for(let i=0;i<7;i++){
      const a = rnd(i+20)*Math.PI*2, rr = Math.sqrt(rnd(i+30))*0.72;
      const px = Math.cos(a)*r*rr, py = cy + Math.sin(a)*h*0.5*rr;
      ctx.beginPath(); ctx.arc(px, py, r*(0.035+0.045*rnd(i+40)), 0, Math.PI*2);
      ctx.fillStyle = (i%2 ? 'rgba(255,250,235,0.14)' : 'rgba(25,19,12,0.18)');
      ctx.fill();
    }
    // ひび割れ
    ctx.beginPath();
    ctx.moveTo(-r*0.5, cy - h*0.1);
    ctx.lineTo(-r*0.1, cy + h*0.08*(rnd(5)-0.5)*4);
    ctx.lineTo(r*0.45, cy - h*0.16);
    ctx.strokeStyle='rgba(30,23,15,0.35)'; ctx.lineWidth=Math.max(1, r*0.035); ctx.stroke();
  }
  path();
  ctx.strokeStyle='rgba(34,27,18,0.55)'; ctx.lineWidth=Math.max(1, r*0.045); ctx.stroke();
}
function drawRock(rock,p){
  const r = rock.radius;
  const flavor = rock.flavor||'rock';
  ctx.save();
  ctx.translate(p.x,p.y);
  ctx.scale(p.scale,p.scale);
  // 木の仲間はまとめて木として描く(リアルマップ専用の種類はWebGL失敗時にここへ来る)
  if(flavor==='tree'||flavor==='pine'||flavor==='deadtree'||flavor==='palm'){ drawTreeObstacle(rock); ctx.restore(); return; }
  if(flavor==='shell'){ drawShellObstacle(rock); ctx.restore(); return; }
  if(currentMap && currentMap.real3d){ drawRealisticRock(rock, r, r*p.scale); ctx.restore(); return; }
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
    const p1b=projectGround(c1.x,c1.y), p2b=projectGround(c2.x,c2.y);
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
// 地面に貼り付く円は、地形の高さに沿わせる。
// groundZAt() はリアルマップ(テスト)以外では常に0を返すので、他マップの見た目は変わらない。
function groundZAt(x,y){
  return (typeof baseTerrainHeightAt==='function') ? baseTerrainHeightAt(x,y) : 0;
}
// 地面に接する物(岩・水晶・アイテム・範囲技・円盤石など)の投影。
// リアルマップ(テスト)では地形の高さに乗せる。他マップでは groundZAt が0なので従来どおり。
function projectGround(x,y){ return project(x, y, groundZAt(x,y)); }
/* 安全圏の円は「カメラの後ろに回り込む部分」を必ず持つ。投影できない点を詰めて
   つなぐと、円の左端と右端が1本の直線で結ばれ、遠くにあるはずの安置線が
   目の前を横切っているように見えてしまう(リアルマップで顕著。地面に高低差が
   あると、その直線が画面の中央付近に来るため)。
   ・投影できない点/近すぎる点は null を入れて「線の切れ目」として残す
   ・切れ目と、画面上で飛びすぎた区間では線をつなぎ直す                        */
const RING_MIN_DEPTH = 140;    // これより近い円周上の点は投影が暴れるので描かない
function projectRingPoint(wx, wy){
  const p = project(wx, wy, groundZAt(wx,wy));
  return (p && p.depth > RING_MIN_DEPTH) ? p : null;
}
function projectCircleRing(center, radius, segments){
  const pts = [];
  for(let i=0;i<=segments;i++){
    const a = (i/segments)*Math.PI*2;
    pts.push(projectRingPoint(center.x+Math.cos(a)*radius, center.y+Math.sin(a)*radius));
  }
  return pts;
}
function strokeProjectedRing(pts, strokeStyle, lineWidth, dash, glow){
  if(pts.filter(Boolean).length<3) return;
  const maxStep = Math.max(viewW, viewH)*1.2; // これ以上飛ぶ区間は円弧ではなく破綻した線
  ctx.save();
  ctx.setLineDash(dash||[]);
  ctx.lineWidth=lineWidth;
  if(glow){ ctx.shadowBlur=glow.blur; ctx.shadowColor=glow.color; }
  ctx.strokeStyle=strokeStyle;
  ctx.beginPath();
  let prev = null;
  for(const p of pts){
    if(!p){ prev = null; continue; }
    if(prev && Math.hypot(p.x-prev.x, p.y-prev.y) <= maxStep) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
    prev = p;
  }
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
    pts.push(projectRingPoint(center.x+Math.cos(a)*radius, center.y+Math.sin(a)*radius));
  }
  return pts;
}
function drawZoneRings(){
  if(game.trainingRange) return; // 射撃訓練場は安置なし
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
    const p = projectGround(d.x,d.y);
    if(!p || p.x<-40||p.x>viewW+40||p.y<-40||p.y>viewH+40) continue;
    ctx.beginPath(); ctx.ellipse(p.x,p.y, d.r*p.scale, d.r*p.scale*0.4, 0,0,Math.PI*2);
    ctx.fillStyle = d.shade==='dark' ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.06)';
    ctx.fill();
  }
}
function drawDangerVignette(){
  if(game.trainingRange) return; // 射撃訓練場は安置なし
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
  if(game.trainingRange) return; // 射撃訓練場は安置なし
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
  const center = projectGround(x,y);
  if(!center) return null;
  const pts = [center];
  for(let i=0;i<=segs;i++){
    const a = angle - halfAngleRad + (i/segs)*halfAngleRad*2;
    const pp = projectGround(x+Math.cos(a)*range, y+Math.sin(a)*range);
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
  const pts = corners.map(c=>projectGround(c.x,c.y)).filter(Boolean);
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
// aura色(hex)から陰影3層+outline/sparkを生成(SSR tier3の色替え用)。RGB線形ミックスで彩度を問わない
function _clip8(v){ return Math.max(0,Math.min(255,Math.round(v))); }
function _rgbToHex(a){ return '#'+a.map(v=>_clip8(v).toString(16).padStart(2,'0')).join(''); }
function _mixHex(hex, target, amt){ const a=hexToRgb(hex), b=hexToRgb(target); return _rgbToHex([a[0]+(b[0]-a[0])*amt, a[1]+(b[1]-a[1])*amt, a[2]+(b[2]-a[2])*amt]); }
function auraShades(hex){
  return {
    outline: _mixHex(hex,'#ffffff',0.35),
    dark:    _mixHex(hex,'#000000',0.6),
    mid:     _mixHex(hex,'#000000',0.12),
    bright:  _mixHex(hex,'#ffffff',0.55),
    spark:   _mixHex(hex,'#ffffff',0.7),
  };
}
function drawLavaWaveEffect(ae, fillDist, fadeAlpha, inTelegraph){
  const sh = ae.auraTint ? auraShades(ae.auraTint) : null; // SSR tier3で色替え
  const outline = rectOutlinePoints(ae.x, ae.y, ae.angle, ae.range, ae.width/2);
  if(outline) strokeDashedShape(outline, sh?sh.outline:'#ff8a3d', 0.5*fadeAlpha);
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
      const tp = projectGround(cx+rx*hw, cy+ry*hw);
      const bp = projectGround(cx-rx*hw, cy-ry*hw);
      if(tp) top.push(tp);
      if(bp) bot.push(bp);
    }
    if(top.length<2 || bot.length<2) return null;
    return top.concat(bot.reverse());
  }

  const outer = buildBandPoints(0.95);
  const mid   = buildBandPoints(0.6);
  const core  = buildBandPoints(0.28);
  if(outer) fillShape(outer, sh?sh.dark:'#3a1710', 0.55*fadeAlpha);
  if(mid)   fillShape(mid,   sh?sh.mid:'#c9291a',  0.7*fadeAlpha);
  if(core)  fillShape(core,  sh?sh.bright:'#ff9a3d', 0.9*fadeAlpha);
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
    const p = projectGround(ae.x+fx*along+rx*lateral, ae.y+fy*along+ry*lateral);
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
  let st = AOE_BAND_STYLES[ae.style];
  if(ae.auraTint){ const sh=auraShades(ae.auraTint); st = { outline:sh.outline, layers:[[sh.dark,0.55],[sh.mid,0.6],[sh.bright,0.85]], spark:[st.spark[0], sh.spark] }; }
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
      const tp = projectGround(cx+rx*hw, cy+ry*hw);
      const bp = projectGround(cx-rx*hw, cy-ry*hw);
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
    const apex = projectGround(ae.x, ae.y);
    if(!apex) return null;
    const arr=[apex];
    for(let i=0;i<=steps;i++){
      const a = ae.angle - half + (2*half)*(i/steps);
      const wob = 1 + wobAmp*Math.sin(i*1.9 + t) + wobAmp*0.6*Math.sin(i*3.7 - t*1.6);
      const r = curReach*frac*wob;
      const p = projectGround(ae.x+Math.cos(a)*r, ae.y+Math.sin(a)*r);
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
    const pp = projectGround(wx, wy);
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
    const p1 = projectGround(wx, wy);
    const p2 = projectGround(wx+Math.cos(ba)*bl, wy+Math.sin(ba)*bl);
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
      const pp = projectGround(ae.x+fx*along+rx*lateral, ae.y+fy*along+ry*lateral);
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
/* =====================================================================
   リアルマップの立体エフェクト(範囲技)
   ・読む値は通常マップとまったく同じ(range/width/fanAngleDeg/color/curReach)。
     ここは「同じ技を立体的に描き直す」だけなので、技の性能をいじれば
     2D(通常マップ)にも3D(リアルマップ)にも同じように効く。
   ・入口は drawSingleAreaEffect 先頭の real3dFx() 1か所。通常マップでは一切通らない。
   ・柱・弧・ドームの各点は project(x, y, 地面の高さ+dz) で個別に投影する。
     画面上で楕円や矩形を決め打ちしないので、坂の上でも地面から生えて見える
     (この決まりは地面に貼る円と同じ。扁平率を固定すると浮いて見える)。
===================================================================== */
// 高さの基準は「モンスターの背丈」。ここを変えると範囲技の背の高さがまとめて変わる
// (drawMonsterは足元から radius*1.85 ぶんの高さに絵を描くので、radius22なら約50)
const FX3D_MON_H      = 52;
const FX3D_FLAME_H    = FX3D_MON_H;         // 炎の高さ
const FX3D_FLAME_N    = 15;                 // 1つの範囲技に立てる炎の数(増やすと重い)
const FX3D_FLAME_R    = 30;                 // 炎1つの根元の太さ
const FX3D_SPIKE_H    = FX3D_MON_H*1.15;    // 結晶の柱の高さ
const FX3D_SPIKE_N    = 11;                 // 結晶の柱の本数
const FX3D_RAIN_H     = 900;                // 降ってくる結晶の初期高度
const FX3D_WALL_H     = FX3D_MON_H;         // 念力の壁の高さ
const FX3D_DOME_H     = FX3D_MON_H;         // 爆風ドームの高さ(横の広さは技の範囲そのまま)
const FX3D_BEAM_Z     = 40;                 // ビームの芯の高さ(胴のあたり)
const FX3D_BOLT_SKY   = 820;                // 落雷が始まる高さ(雷だけは背を低くしない)
const FX3D_BOLT_N     = 5;                  // 1回の雷で空から落とす本数
const FX3D_RING_SEGS  = 30;                 // 輪・弧のサンプル数
const FX3D_AREA_ALPHA = 0.58;               // 範囲技の透け具合(小さいほど後ろが見える)
const FX3D_DOME_ALPHA = 1.0;                // 爆風ドームだけは濃いまま残す

function real3dFx(){ return typeof isReal3dMap==='function' && isReal3dMap(); }

// 投影済みの点列を塗る/なぞる(shadowBlurは重い端末では自動で切る)
function fx3dFill(pts, color, alpha, blur){
  if(!pts || pts.length<3 || alpha<=0.01) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = color;
  if(blur && !renderHeavyLoad){ ctx.shadowBlur = blur; ctx.shadowColor = color; }
  ctx.fill();
  ctx.restore();
}
function fx3dStroke(pts, color, width, alpha, blur, closed){
  if(!pts || pts.length<2 || alpha<=0.01) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.lineJoin='round'; ctx.lineCap='round';
  if(blur && !renderHeavyLoad){ ctx.shadowBlur = blur; ctx.shadowColor = color; }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
  if(closed) ctx.closePath();
  ctx.stroke();
  ctx.restore();
}
// 地面の高さ+dz の点を投影する。gz を渡せる場所では渡して地形サンプルを省く
function fx3dPoint(x, y, dz, gz){ return project(x, y, (gz!=null?gz:groundZAt(x,y)) + dz); }
// 高さdzの位置に張る輪(ドームの横輪・衝撃波)
function fx3dRingPts(cx, cy, radius, dz, segs){
  const pts=[];
  const n = segs||FX3D_RING_SEGS;
  for(let i=0;i<n;i++){
    const a=(i/n)*Math.PI*2;
    const wx=cx+Math.cos(a)*radius, wy=cy+Math.sin(a)*radius;
    const p=fx3dPoint(wx, wy, dz);
    if(p) pts.push(p);
  }
  return pts.length>=3 ? pts : null;
}
// hex色を透明度つきの rgba() にする(グラデーションの端を透明にするのに使う)
function _hexA(hex, a){ const c = hexToRgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
// 炎の色段階。技の色から作るので、SSRスキンで色が変わっても青い炎・黒い炎になる
function fx3dFireRamp(col){
  return {
    smoke: _mixHex(col, '#160603', 0.72),
    body:  col,
    hot:   _mixHex(col, '#ffc24a', 0.6),
    core:  _mixHex(col, '#fffbe0', 0.85),
  };
}
/* 炎1つ。外側=くすんだ赤い煙 / 中=技色 / 芯=白熱、の3枚の舌を重ねる。
   ・舌の輪郭は上へいくほど細くゆらぐ(平らな三角形にしない)
   ・下から上へ「白熱→技色→透明」のグラデーションを掛ける(炎の温度差)
   ・内側2枚は加算合成(lighter)なので、重なった所が本物の炎のように白く輝く
   ・段ごとに投影するので坂の上でもきちんと地面から生えて見える                */
function fx3dFlame(x, y, gz, h, rBase, seed, fade, ramp){
  const N = 7;
  const base = fx3dPoint(x, y, 0, gz);
  const top  = fx3dPoint(x, y, h*1.1, gz);
  if(!base || !top) return;
  for(let k=0;k<3;k++){
    const hk  = h*(1 - k*0.2);
    const wk  = rBase*(1 - k*0.3);
    const spd = 5.2 + k*1.7;
    const left=[], right=[];
    let ok = true;
    for(let i=0;i<=N;i++){
      const f = i/N;
      const wob = Math.sin(matchTime*spd + seed*1.7 + f*4.2 + k*2.1)*rBase*0.5*f
                + Math.sin(matchTime*spd*1.7 + seed*3.1 + f*7.5)*rBase*0.2*f;
      const p = fx3dPoint(x + wob, y + wob*0.65, hk*f, gz);
      if(!p){ ok=false; break; }
      const flick = 1 + 0.24*Math.sin(f*9 + matchTime*11 + seed);
      const hw = wk*Math.pow(1-f, 0.6)*flick*p.scale;
      left.push({x:p.x-hw, y:p.y});
      right.push({x:p.x+hw, y:p.y});
    }
    if(!ok) continue;
    const pts = left.concat(right.reverse());
    const g = ctx.createLinearGradient(base.x, base.y, top.x, top.y);
    if(k===0){
      g.addColorStop(0, ramp.body); g.addColorStop(0.5, ramp.smoke); g.addColorStop(1, _hexA(ramp.smoke, 0));
    } else if(k===1){
      g.addColorStop(0, ramp.hot); g.addColorStop(0.55, ramp.body); g.addColorStop(1, _hexA(ramp.body, 0));
    } else {
      g.addColorStop(0, ramp.core); g.addColorStop(0.5, ramp.hot); g.addColorStop(1, _hexA(ramp.hot, 0));
    }
    ctx.save();
    ctx.globalAlpha = (k===0 ? 0.5 : 0.6)*fade;
    if(k>0) ctx.globalCompositeOperation = 'lighter';   // 加算で重なりを白熱させる
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }
}
// 炎の根元の照り返し(地面が赤く光る)。炎そのものより広く、薄く敷く
function fx3dFireGlow(x, y, gz, r, col, fade){
  if(renderHeavyLoad) return;
  const p = fx3dPoint(x, y, 2, gz);
  if(!p) return;
  const rr = r*p.scale;
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
  g.addColorStop(0, _hexA(col, 0.55));
  g.addColorStop(1, _hexA(col, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = fade;
  ctx.beginPath(); ctx.ellipse(p.x, p.y, rr, rr*0.3, 0, 0, Math.PI*2);
  ctx.fillStyle = g; ctx.fill();
  ctx.restore();
}
/* ビーム(筒)。ビーム系の技はすべてこれ1つで描き、違うのは色だけにする。
   ・断面の半径 = 技の当たり幅の半分。真後ろから見るとちょうど円になる
   ・輪郭は「画面上の進行方向に対して垂直」へ膨らませる(画面の上下に固定しない)。
     こうしないと坂の下へ撃った時や真上から見た時に筒がねじれて見える
   ・断面方向のグラデーション(縁=薄い技色 / 芯=白)で丸みを出す
   ・加算合成なので重なるほど明るくなり、光の筒に見える                       */
function fx3dBeamTube(ox, oy, angle, reach, radius, col, fade){
  const segs = 16;
  const dz = Math.max(FX3D_BEAM_Z, radius*0.92);   // 地面へめり込ませない
  const pts = [];
  for(let i=0;i<=segs;i++){
    const along = reach*(i/segs);
    const p = fx3dPoint(ox+Math.cos(angle)*along, oy+Math.sin(angle)*along, dz);
    if(p) pts.push(p);
  }
  if(pts.length<2) return;
  // 各点での「画面上の垂直方向」(前後の区間の向きを平均する)
  const nrm = [];
  for(let i=0;i<pts.length;i++){
    const a = pts[Math.max(0,i-1)], b = pts[Math.min(pts.length-1,i+1)];
    let dx = b.x-a.x, dy = b.y-a.y;
    const len = Math.hypot(dx,dy);
    if(len < 0.001){ dx=1; dy=0; } else { dx/=len; dy/=len; }
    nrm.push({ x:-dy, y:dx, r:radius*pts[i].scale });
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = fade;
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i], b=pts[i+1], na=nrm[i], nb=nrm[i+1];
    const q = [
      { x:a.x+na.x*na.r, y:a.y+na.y*na.r },
      { x:b.x+nb.x*nb.r, y:b.y+nb.y*nb.r },
      { x:b.x-nb.x*nb.r, y:b.y-nb.y*nb.r },
      { x:a.x-na.x*na.r, y:a.y-na.y*na.r },
    ];
    const mx=(a.x+b.x)/2, my=(a.y+b.y)/2, mr=(na.r+nb.r)/2, mnx=(na.x+nb.x)/2, mny=(na.y+nb.y)/2;
    const g = ctx.createLinearGradient(mx-mnx*mr, my-mny*mr, mx+mnx*mr, my+mny*mr);
    g.addColorStop(0,    _hexA(col, 0.10));
    g.addColorStop(0.3,  _hexA(col, 0.55));
    g.addColorStop(0.5,  'rgba(255,255,255,0.92)');
    g.addColorStop(0.7,  _hexA(col, 0.55));
    g.addColorStop(1,    _hexA(col, 0.10));
    ctx.beginPath();
    ctx.moveTo(q[0].x,q[0].y); ctx.lineTo(q[1].x,q[1].y); ctx.lineTo(q[2].x,q[2].y); ctx.lineTo(q[3].x,q[3].y);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
  }
  // 両端の断面(真後ろ・真正面から見たときに円として見える)
  for(const [p, boost] of [[pts[0], 1.0], [pts[pts.length-1], 1.15]]){
    const rr = radius*p.scale*boost;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.45, _hexA(col, 0.6));
    g.addColorStop(1, _hexA(col, 0));
    ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI*2);
    ctx.fillStyle = g; ctx.fill();
  }
  ctx.restore();
}
// 地面から生える尖った柱(結晶・氷柱)
function fx3dSpike(x, y, gz, h, rBase, col, fade){
  const apex = fx3dPoint(x, y, h, gz);
  const base = fx3dPoint(x, y, 0, gz);
  if(!apex || !base) return;
  const sh = auraShades(col);
  const r = rBase*base.scale;
  const g = ctx.createLinearGradient(base.x, base.y, apex.x, apex.y);
  g.addColorStop(0, _hexA(sh.dark, 0.85));
  g.addColorStop(0.55, _hexA(col, 0.7));
  g.addColorStop(1, _hexA(sh.bright, 0.5));
  fx3dFill([{x:base.x-r,y:base.y},{x:base.x+r,y:base.y},apex], g, fade, 0);
  // 光を受けている面(片側だけ明るくして立体に見せる)
  fx3dFill([{x:base.x-r*0.5,y:base.y},{x:base.x+r*0.15,y:base.y},apex], _hexA(sh.bright, 0.55), fade, 10);
  fx3dStroke([{x:base.x-r,y:base.y},apex,{x:base.x+r,y:base.y}], sh.outline, 1.4, 0.6*fade, 8);
}
// 空から地面へ落ちる稲妻。上ほど大きく振れる折れ線を3層で描く
function fx3dBoltDown(x, y, topZ, color, seed, fade){
  const N = 9;
  const gz = groundZAt(x,y);
  const pts=[];
  for(let i=0;i<=N;i++){
    const f = i/N;                       // 0=空 1=地面
    const jitter = (1-f)*topZ*0.075;
    const ox = (fxHash01(seed*13.1 + i*7.7)*2-1)*jitter;
    const oy = (fxHash01(seed*29.3 + i*3.3)*2-1)*jitter;
    const p = fx3dPoint(x+ox, y+oy, topZ*(1-f), gz);
    if(p) pts.push(p);
  }
  if(pts.length<2) return;
  fx3dStroke(pts, color, 13, 0.3*fade, 26);
  fx3dStroke(pts, color, 5.5, 0.85*fade, 18);
  fx3dStroke(pts, '#ffffff', 2, 0.95*fade, 0);
}

/* ---------- 種類ごとの立体エフェクト ---------- */

// 扇(インフェルノ): 地面の焦げ跡+ゆらめく炎の火炎放射
function fx3dFlameFan(ae, curReach, fade){
  const half = (ae.fanAngleDeg||45)*Math.PI/360;
  const col = ae.auraTint || ae.color;
  const ramp = fx3dFireRamp(col);
  const scorch = fanOutlinePoints(ae.x, ae.y, ae.angle, curReach, half, 16);
  if(scorch) fx3dFill(scorch, ramp.smoke, 0.42*fade, 0);
  const cols = [];
  for(let i=0;i<FX3D_FLAME_N;i++){
    const h1 = fxHash01(ae.id*11.3 + i*5.7), h2 = fxHash01(ae.id*7.7 + i*3.1), h3 = fxHash01(ae.id*4.1 + i*9.3);
    const a = ae.angle + (h1*2-1)*half*0.95;
    const rr = curReach*(0.12 + 0.88*h2);
    const x = ae.x+Math.cos(a)*rr, y = ae.y+Math.sin(a)*rr;
    // 手前(術者側)ほど高い炎にして、噴き出している向きを見せる
    const h = FX3D_FLAME_H*(0.65 + 0.6*h3)*(1 - 0.25*(rr/Math.max(curReach,1)));
    const p = fx3dPoint(x, y, 0);
    cols.push({ x, y, gz:groundZAt(x,y), h, seed:i+ae.id, depth:p?p.depth:0 });
  }
  cols.sort((a,b)=>b.depth-a.depth);   // 奥から手前へ重ねる
  for(const c of cols){
    fx3dFireGlow(c.x, c.y, c.gz, FX3D_FLAME_R*2.4, ramp.hot, fade*0.5);
    fx3dFlame(c.x, c.y, c.gz, c.h, FX3D_FLAME_R, c.seed, fade, ramp);
  }
  if(!renderHeavyLoad){
    for(let i=0;i<8;i++){
      const h1 = fxHash01(ae.id*3.3 + i*7.1), h2 = fxHash01(ae.id*9.7 + i*2.9);
      const a = ae.angle + (h1*2-1)*half;
      const rr = curReach*(0.2 + 0.75*h2);
      const rise = FX3D_FLAME_H*(0.7 + 1.1*((matchTime*0.9 + h1) % 1));
      const p = fx3dPoint(ae.x+Math.cos(a)*rr, ae.y+Math.sin(a)*rr, rise);
      if(p) drawGroundSpark(p, 'ember', ramp.core, fade*0.8, ae.id+i);
    }
  }
}
// 帯(ファイアウェーブ): 先端に炎の壁、後方に低い残り火
function fx3dFireWave(ae, curReach, fade){
  const col = ae.auraTint || ae.color;
  const ramp = fx3dFireRamp(col);
  const band = rectOutlinePoints(ae.x, ae.y, ae.angle, curReach, ae.width/2);
  if(band) fx3dFill(band, ramp.smoke, 0.42*fade, 0);
  const fx=Math.cos(ae.angle), fy=Math.sin(ae.angle);
  const rx=-Math.sin(ae.angle), ry=Math.cos(ae.angle);
  const cols = [];
  const push=(along, lateral, h, seed)=>{
    const x = ae.x+fx*along+rx*lateral, y = ae.y+fy*along+ry*lateral;
    const p = fx3dPoint(x, y, 0);
    cols.push({ x, y, gz:groundZAt(x,y), h, seed, depth:p?p.depth:0 });
  };
  const wallN = 7;
  for(let i=0;i<wallN;i++){                       // 先端の炎の壁
    const lat = (i/(wallN-1)-0.5)*ae.width*0.92;
    push(curReach - ae.width*0.12, lat, FX3D_FLAME_H*(1.0+0.25*fxHash01(ae.id+i*3.7)), ae.id+i);
  }
  for(let i=0;i<FX3D_FLAME_N;i++){                // 後方の残り火
    const h1 = fxHash01(ae.id*5.1 + i*7.3), h2 = fxHash01(ae.id*2.7 + i*11.9);
    push(curReach*(0.05+0.8*h1), (h2*2-1)*ae.width*0.42, FX3D_FLAME_H*(0.4+0.4*h2), ae.id+i*3);
  }
  cols.sort((a,b)=>b.depth-a.depth);
  for(const c of cols){
    fx3dFireGlow(c.x, c.y, c.gz, FX3D_FLAME_R*2.2, ramp.hot, fade*0.5);
    fx3dFlame(c.x, c.y, c.gz, c.h, FX3D_FLAME_R*0.9, c.seed, fade, ramp);
  }
}
// 帯(クリスタルレイン): 空から結晶が降り、地面から結晶の柱がせり上がる
function fx3dCrystalRain(ae, curReach, fade, progress){
  const col = ae.auraTint || ae.color;
  const sh = auraShades(col);
  const band = rectOutlinePoints(ae.x, ae.y, ae.angle, curReach, ae.width/2);
  if(band) fx3dFill(band, sh.dark, 0.32*fade, 0);
  const fx=Math.cos(ae.angle), fy=Math.sin(ae.angle);
  const rx=-Math.sin(ae.angle), ry=Math.cos(ae.angle);
  for(let i=0;i<FX3D_SPIKE_N;i++){
    const h1 = fxHash01(ae.id*6.1 + i*4.3), h2 = fxHash01(ae.id*8.9 + i*2.1);
    const along = curReach*((i+h1)/FX3D_SPIKE_N);
    const lat = (h2*2-1)*ae.width*0.44;
    const x = ae.x+fx*along+rx*lat, y = ae.y+fy*along+ry*lat;
    const grow = clamp((progress - h1*0.25)*3.2, 0, 1);   // せり上がる
    if(grow<=0.02) continue;
    fx3dSpike(x, y, groundZAt(x,y), FX3D_SPIKE_H*(0.65+0.5*h2)*grow, 20+12*h1, col, fade);
  }
  if(renderHeavyLoad) return;
  for(let i=0;i<10;i++){                                   // 降ってくる結晶
    const h1 = fxHash01(ae.id*3.7 + i*9.1), h2 = fxHash01(ae.id*7.3 + i*5.9);
    const along = curReach*h1, lat = (h2*2-1)*ae.width*0.48;
    const phase = (matchTime*1.7 + h1*3.1 + i*0.37) % 1;
    const p = fx3dPoint(ae.x+fx*along+rx*lat, ae.y+fy*along+ry*lat, FX3D_RAIN_H*(1-phase)*(1-phase));
    if(p) drawGroundSpark(p, 'diamond', sh.spark, fade*(0.4+0.6*phase), ae.id+i);
  }
}
// 帯(モッチ砲・ラガモッチ砲・熱視線・天河天翔): ビームは色以外すべて共通の見た目
function fx3dRectBeam(ae, curReach, fade){
  const col = ae.auraTint || ae.color;
  fx3dBeamTube(ae.x, ae.y, ae.angle, curReach, ae.width/2, col, fade);
}
// ビーム3本(フラワービーム): 同じビームを3本ぶん
function fx3dFlowerBeams(ae, fillDist, fade, inTelegraph){
  const count = ae.beamCount||3;
  const spread = (ae.beamSpreadDeg||40)*Math.PI/180;
  const ranges = ae.beamRanges || Array.from({length:count}, ()=>ae.range);
  const col = ae.auraTint || ae.color;
  const outlineCol = auraShades(col).outline;
  for(let b=0;b<count;b++){
    const a = ae.angle + (count>1 ? (b/(count-1)-0.5)*spread : 0);
    const outline = rectOutlinePoints(ae.x, ae.y, a, ranges[b], ae.width/2);
    if(outline) strokeDashedShape(outline, outlineCol, 0.4*fade);
    if(inTelegraph) continue;
    const curReach = Math.min(ranges[b], fillDist);
    if(curReach<=2) continue;
    fx3dBeamTube(ae.x, ae.y, a, curReach, ae.width/2, col, fade);
  }
}
// ジグザグ(超雷撃・ホーリーサンダー・ライトニング): 空から落ちる本物の落雷にする
// (雷だけは「高さをモンスターに合わせる」対象外。空から落ちてこそ雷なので)
function fx3dThunder(ae, curReach, fade){
  const amp = (ae.width||110)*0.5;
  const fx=Math.cos(ae.angle), fy=Math.sin(ae.angle);
  const rx=-Math.sin(ae.angle), ry=Math.cos(ae.angle);
  const jseed = Math.floor(matchTime*16);          // 稲妻の形を毎フレーム震わせる
  const flick = 0.7 + 0.3*Math.sin(matchTime*42);
  const segs = Math.max(4, Math.round(10*(curReach/Math.max(ae.range,1))));
  const ground = [], world = [];
  for(let i=0;i<=segs;i++){
    const along = curReach*(i/segs);
    const lateral = (i===0||i===segs) ? 0 : (fxHash01(jseed*31.7 + i*17.3 + ae.id)*2-1)*amp;
    const wx = ae.x+fx*along+rx*lateral, wy = ae.y+fy*along+ry*lateral;
    world.push([wx,wy]);
    const p = fx3dPoint(wx, wy, 3);
    if(p) ground.push(p);
  }
  // 地面を走る電流(ダメージ範囲がどこを通ったか分かるように残す)
  fx3dStroke(ground, ae.color, 9, 0.35*fade*flick, 22);
  fx3dStroke(ground, '#ffffff', 2, 0.8*fade*flick, 0);
  // 空から落ちる雷本体
  const step = Math.max(1, Math.floor(world.length/FX3D_BOLT_N));
  for(let i=step; i<world.length; i+=step){
    const [wx,wy] = world[i];
    fx3dBoltDown(wx, wy, FX3D_BOLT_SKY, ae.color, jseed*0.37 + i*3.1 + ae.id, fade*flick);
    const flash = fx3dRingPts(wx, wy, amp*0.75, 2, 14);
    if(flash) fx3dFill(flash, '#ffffff', 0.3*fade*flick, 24);
  }
}
// 扇のジグザグ(サイコキネシス): 弧を描く念力の壁が押し寄せる
function fx3dPsychicWall(ae, curReach, fade){
  const half = (ae.fanAngleDeg||30)*Math.PI/360;
  const col = ae.auraTint || ae.color;
  const sh = auraShades(col);
  const segs = 14;
  for(let w=0;w<3;w++){
    // 3枚の壁が時間差で外へ進む(位相をずらして波に見せる)。
    // 技の発動時刻を基準にするので、1枚目は必ず術者の側から出る
    const phase = (((matchTime - ae.spawnAt)*1.5 + w/3) % 1);
    const d = curReach*(0.25 + 0.75*phase);
    if(d<=4) continue;
    const wallFade = fade*(1-phase*0.55);
    const h = FX3D_WALL_H*(0.75+0.4*(1-phase));
    const low=[], high=[];
    let base=null, topP=null;
    for(let i=0;i<=segs;i++){
      const a = ae.angle - half + (2*half)*(i/segs);
      const wx = ae.x+Math.cos(a)*d, wy = ae.y+Math.sin(a)*d;
      const gz = groundZAt(wx,wy);
      const lp = fx3dPoint(wx, wy, 2, gz);
      const hp = fx3dPoint(wx, wy, h + Math.sin(i*1.7 + matchTime*4)*h*0.12, gz);
      if(lp && hp){ low.push(lp); high.push(hp); if(!base){ base=lp; topP=hp; } }
    }
    if(low.length<2 || !base) continue;
    // 上へ向かって薄くなる壁(念力の膜)
    const g = ctx.createLinearGradient(base.x, base.y, topP.x, topP.y);
    g.addColorStop(0, _hexA(sh.bright, 0.5));
    g.addColorStop(1, _hexA(col, 0));
    fx3dFill(low.concat(high.reverse()), g, wallFade, 0);
    fx3dStroke(high, '#ffffff', 2.2, 0.6*wallFade, 12);
    fx3dStroke(low, sh.bright, 2.6, 0.5*wallFade, 10);
  }
}
/* 円(ビッグバン・ヴァニッシュ・レクイエムエンドの爆風)
   ・横の広さは判定と同じ curReach、高さはモンスターの背丈ぶんに抑える
   ・中身の詰まった球に見せるため、上へ積む輪を「濃いまま」重ねる
     (薄くすると地面の色が透けて煙にしか見えない)                          */
function fx3dDomeBurst(ae, curReach, fade){
  const R = curReach;
  const H = Math.min(FX3D_DOME_H, R);
  const col = ae.auraTint || ae.color || '#ffffff';
  const sh = auraShades(col);
  const rings = 6;
  // 下から上へ、輪を重ねて塊にする。上の輪ほど明るくして丸みを出す
  for(let k=0;k<=rings;k++){
    const th = (k/rings)*(Math.PI/2);
    const ring = fx3dRingPts(ae.x, ae.y, R*Math.cos(th), 2 + H*Math.sin(th));
    if(!ring) continue;
    const t = k/rings;
    fx3dFill(ring, _mixHex(col, sh.bright, t*0.55), (0.34 - t*0.1)*fade, 0);
  }
  // 縁と稜線(ドームの形をはっきりさせる)
  const rim = fx3dRingPts(ae.x, ae.y, R, 2);
  if(rim) fx3dStroke(rim, sh.bright, 3.5, 0.9*fade, 20, true);
  for(let m=0;m<8;m++){
    const a = (m/8)*Math.PI*2;
    const arc=[];
    for(let i=0;i<=8;i++){
      const th = (i/8)*(Math.PI/2);
      const rr = R*Math.cos(th);
      const p = fx3dPoint(ae.x+Math.cos(a)*rr, ae.y+Math.sin(a)*rr, 2 + H*Math.sin(th));
      if(p) arc.push(p);
    }
    fx3dStroke(arc, sh.bright, 1.6, 0.4*fade, 8);
  }
  const apex = fx3dPoint(ae.x, ae.y, H + 4);
  if(apex){
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.8*fade);
    ctx.globalCompositeOperation = 'lighter';
    const rr = Math.max(4, 26*apex.scale);
    const g = ctx.createRadialGradient(apex.x, apex.y, 0, apex.x, apex.y, rr);
    g.addColorStop(0, _hexA(sh.spark, 0.9));
    g.addColorStop(1, _hexA(col, 0));
    ctx.beginPath(); ctx.arc(apex.x, apex.y, rr, 0, Math.PI*2);
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
  }
}
// リアルマップでの範囲技の描画。ここで描いたらtrueを返し、2Dの描画は行わない
function drawReal3dAreaEffect(ae, fillDist, fadeAlpha, inTelegraph){
  // 爆風ドームだけは濃いまま、それ以外は半透明にして技以外を見やすくする
  const fade = fadeAlpha * (ae.kind==='circle' ? FX3D_DOME_ALPHA : FX3D_AREA_ALPHA);
  if(ae.kind==='beams'){
    fx3dFlowerBeams(ae, fillDist, fade, inTelegraph);
    return true;
  }
  // 予告(最大範囲)は通常マップと同じ点線。判定範囲がどこかを必ず見せる
  if(ae.kind==='circle'){
    const ring = fx3dRingPts(ae.x, ae.y, ae.range, 2);
    if(ring) strokeDashedShape(ring, '#000000', 0.45*fadeAlpha);
  } else if(ae.kind==='fan' || ae.kind==='fanZigzag'){
    const half = (ae.fanAngleDeg||45)*Math.PI/360;
    const outline = fanOutlinePoints(ae.x, ae.y, ae.angle, ae.range, half, 16);
    if(outline) strokeDashedShape(outline, ae.color, 0.5*fadeAlpha);
  } else {
    const outline = rectOutlinePoints(ae.x, ae.y, ae.angle, ae.range, (ae.width||110)/2);
    if(outline) strokeDashedShape(outline, ae.color, 0.45*fadeAlpha);
  }
  if(inTelegraph) return true;
  // 描画の広がりは判定と同じ curReach を使う(見栄えで縮めない)
  const curReach = Math.min(ae.range, fillDist);
  if(curReach<=2) return true;
  const progress = clamp(curReach/Math.max(ae.range,1), 0, 1);
  if(ae.kind==='fan')            fx3dFlameFan(ae, curReach, fade);
  else if(ae.kind==='zigzag')    fx3dThunder(ae, curReach, fade);
  else if(ae.kind==='fanZigzag') fx3dPsychicWall(ae, curReach, fade);
  else if(ae.kind==='circle')    fx3dDomeBurst(ae, curReach, fade);
  else if(ae.kind==='rect'){
    if(ae.style==='crystal')   fx3dCrystalRain(ae, curReach, fade, progress);
    else if(ae.style==='lava') fx3dFireWave(ae, curReach, fade);
    else                       fx3dRectBeam(ae, curReach, fade);   // モッチ砲/天河天翔/熱視線
  } else return false;
  return true;
}
function drawAreaEffects(){
  for(const ae of areaEffects) drawSingleAreaEffect(ae);
}
function drawSingleAreaEffect(ae){
    const elapsed = matchTime - ae.spawnAt;
    if(elapsed > ae.life) return;
    const telegraphTime = ae.telegraphTime||0.18;
    const fillSpeed = ae.fillSpeed||900;
    const inTelegraph = elapsed <= telegraphTime;
    const fillDist = Math.max(0, elapsed - telegraphTime) * fillSpeed;
    const fadeStart = ae.life - 0.2;
    const fadeAlpha = elapsed>fadeStart ? clamp(1-((elapsed-fadeStart)/0.2), 0, 1) : 1;

    // リアルマップだけ立体エフェクトに差し替える(判定・数値は通常マップと同じものを読む)
    if(real3dFx() && drawReal3dAreaEffect(ae, fillDist, fadeAlpha, inTelegraph)) return;

    if(ae.kind==='beams'){
      if(ae.style==='flower'){
        drawFlowerBeamsEffect(ae, fillDist, fadeAlpha, inTelegraph);
        return;
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
        return;
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
        return;
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
          const pp = projectGround(ae.x+fx*along+rx*lateral, ae.y+fy*along+ry*lateral);
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
        return;
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
            const pp = projectGround(ae.x+fx*along+rx*lateral, ae.y+fy*along+ry*lateral);
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
    } else if(ae.kind==='circle'){
      drawDomeBurstEffect(ae, fillDist, fadeAlpha, inTelegraph);
    }
}
// 地面(z=0)の円周をワールド座標でサンプルして投影する。画面上の楕円を決め打ちせず
// 実際のカメラ投影に従わせることで、円がきちんと地面に貼り付いて見える。
function groundCirclePoints(cx, cy, radius, segs){
  const pts = [];
  for(let i=0;i<segs;i++){
    const a = (i/segs)*Math.PI*2;
    const wx = cx+Math.cos(a)*radius, wy = cy+Math.sin(a)*radius;
    const p = project(wx, wy, groundZAt(wx,wy));
    if(p) pts.push(p);
  }
  return pts.length>=3 ? pts : null;
}
// 円形に広がるドーム状の爆発エフェクト(ビッグバン等)
function drawDomeBurstEffect(ae, fillDist, fadeAlpha, inTelegraph){
  const center = projectGround(ae.x, ae.y);
  if(!center) return;
  const maxR = ae.range;
  // 最大範囲の予告(実際のダメージ判定と同じ半径の地面円)
  const outline = groundCirclePoints(ae.x, ae.y, maxR, 40);
  if(outline) strokeDashedShape(outline, '#000000', 0.45*fadeAlpha);
  if(inTelegraph) return;

  const curReach = Math.min(maxR, fillDist); // ダメージ判定の半径そのもの(hitTestと同じcurReach)
  if(curReach<=2) return;
  const ring = groundCirclePoints(ae.x, ae.y, curReach, 40);
  if(!ring) return;
  const apex = project(ae.x, ae.y, curReach); // ドーム頂点も実際に投影して高さを求める
  const s = center.scale;

  // 地面円の画面上の広がり(左右端)からドームの横半径を求める
  let minX=Infinity, maxX=-Infinity;
  for(const p of ring){ if(p.x<minX) minX=p.x; if(p.x>maxX) maxX=p.x; }
  const halfW = Math.max(2, (maxX-minX)/2);
  const domeH = apex ? Math.max(2, center.y - apex.y) : halfW*0.8;

  ctx.save();
  // 1) 地面に貼り付いた円(ダメージ判定そのもの)
  ctx.globalAlpha = 0.55*fadeAlpha;
  ctx.beginPath();
  ctx.moveTo(ring[0].x, ring[0].y);
  for(let i=1;i<ring.length;i++) ctx.lineTo(ring[i].x, ring[i].y);
  ctx.closePath();
  ctx.fillStyle = '#0a0a0d';
  ctx.fill();

  // 2) ドーム本体: 地面円の上に乗る半球(上半分の球体)
  ctx.globalAlpha = 0.7*fadeAlpha;
  const g = ctx.createRadialGradient(center.x, center.y-domeH*0.3, 0, center.x, center.y-domeH*0.1, Math.max(halfW,domeH)*1.05);
  g.addColorStop(0, '#3a3a44');
  g.addColorStop(0.55, ae.color);
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, halfW, domeH, 0, Math.PI, Math.PI*2, false);
  ctx.closePath();
  ctx.fill();

  // 3) 地面との接地ライン(ダメージ判定円の輪郭そのもの)
  ctx.globalAlpha = 0.9*fadeAlpha;
  ctx.strokeStyle = '#0a0a0d'; ctx.lineWidth = 3*s;
  ctx.beginPath();
  ctx.moveTo(ring[0].x, ring[0].y);
  for(let i=1;i<ring.length;i++) ctx.lineTo(ring[i].x, ring[i].y);
  ctx.closePath();
  ctx.stroke();

  // 4) 外周の衝撃波リング(視認性のための淡いハイライト)
  ctx.globalAlpha = 0.55*fadeAlpha;
  ctx.strokeStyle = '#6b6b78'; ctx.lineWidth = 3*s;
  if(!renderHeavyLoad){ ctx.shadowBlur=20; ctx.shadowColor=ae.color; }
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, halfW, domeH, 0, Math.PI, Math.PI*2, false);
  ctx.stroke();
  ctx.shadowBlur=0;

  // 5) 発射時の球体と同じビリビリ電撃アークをドームの縁に沿わせる(差し色があればその色)
  const [arcDim, arcLit] = arcColorsFor(ae.auraTint);
  const jseed = Math.floor(matchTime*18) + (ae.id||0);
  ctx.lineCap='round'; ctx.lineJoin='round';
  for(let k=0;k<6;k++){
    const baseA = Math.PI + fxHash01(jseed*13+k*7)*Math.PI; // 上半分(ドームのアーチ)側
    const arcSpan = 0.5 + fxHash01(jseed*29+k*11)*0.6;
    const segs=5; ctx.beginPath();
    for(let n=0;n<=segs;n++){
      const a = baseA + arcSpan*(n/segs);
      const rr = 1 + (fxHash01(jseed*37+k*17+n*5)-0.5)*0.22;
      const px = center.x + Math.cos(a)*halfW*rr;
      const py = center.y + Math.sin(a)*domeH*rr;
      if(n===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    }
    ctx.globalAlpha=0.55*fadeAlpha; ctx.strokeStyle=arcDim; ctx.lineWidth=4*s; ctx.stroke();
    ctx.globalAlpha=0.9*fadeAlpha;  ctx.strokeStyle=arcLit; ctx.lineWidth=1.6*s; ctx.stroke();
  }
  ctx.restore();
}
function drawLandingMarkers(){
  for(const p of projectiles){
    if(!p.lobbed) continue;
    const t = clamp(p.flightT / p.flightTime, 0, 1);
    const proj = projectGround(p.landX, p.landY);
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
    // 塗りつぶしなので投影できない点は詰めてつなぐ(線と違い、切ると水面に穴が空く)
    const pts = projectCircleRing(z, z.radius, 22).filter(Boolean);
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
    const pts = projectCircleRing(lz, lz.radius, 40).filter(Boolean); // 塗りつぶしなので詰めてつなぐ
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
// 円錐(火山)の面ごとの色。light=0.35(影)〜1.0(日向)。世界固定の光で面を陰影付けする
function coneFacetColor(style, light){
  if(style==='snow')   return `rgb(${Math.round(150+95*light)},${Math.round(175+75*light)},${Math.round(200+50*light)})`;
  if(style==='forest') return `rgb(${Math.round(18+55*light)},${Math.round(48+105*light)},${Math.round(22+45*light)})`;
  return `rgb(${Math.round(52+130*light)},${Math.round(34+82*light)},${Math.round(22+56*light)})`; // volcano
}
// 火山1つ分を「本当の3D円錐」として面(ファセット)分割して描く。
// ・底面の円周を等分した各点を世界座標で投影し、隣同士＋山頂で三角形の面を作る
// ・面は奥→手前に塗り、凸形状の隠面を成立させる(билборドではなく実体)
// ・陰影は「世界に固定した光の向き」で面ごとに決めるため、視点を回すと日向/影の面が
//   入れ替わり、地面に固定された立体を回り込んでいるように見える(=泳がない)
function drawSolidCone(v, style){
  const worldRise = v.radius * (v.isMain ? 1.15 : 0.9);
  // リアルマップでは足元の地面の高さから積み上げる(groundZAtは通常マップでは0)
  const apex = project(v.x, v.y, groundZAt(v.x, v.y) + worldRise);
  if(!apex) return null;
  const N = v.isMain ? 30 : 18;
  const ring = [];
  for(let i=0;i<=N;i++){
    const a = (i/N)*Math.PI*2;
    ring.push(projectGround(v.x+Math.cos(a)*v.radius, v.y+Math.sin(a)*v.radius));
  }
  const LX = 0.55, LY = -0.83; // 世界固定の光の向き(北西からの日差し)
  const facets = [];
  for(let i=0;i<N;i++){
    const p1 = ring[i], p2 = ring[i+1];
    if(!p1 || !p2) continue;
    const mid = ((i+0.5)/N)*Math.PI*2;
    const light = 0.35 + 0.65*Math.max(0, Math.cos(mid)*LX + Math.sin(mid)*LY);
    facets.push({ p1, p2, light, depth:(p1.depth+p2.depth)/2 });
  }
  facets.sort((a,b)=> b.depth - a.depth); // 奥の面から塗る
  for(const f of facets){
    ctx.beginPath();
    ctx.moveTo(f.p1.x, f.p1.y); ctx.lineTo(f.p2.x, f.p2.y); ctx.lineTo(apex.x, apex.y); ctx.closePath();
    ctx.fillStyle = coneFacetColor(style, f.light);
    ctx.fill();
  }
  return apex;
}
function drawPyramidComplex(group,p){
  const main = group.find(v=>v.isMain) || group[0];
  // 正方形の底面4隅と頂点を「本当の世界座標/高さ」で投影し、真の立体ピラミッドとして描く。
  // これにより視点を動かしても地面に固定されたまま(以前はスクリーン上に頂点を一定量ずらす
  // 疑似表現だったため、視点移動でピラミッドが泳いで見えた)。
  const s = main.radius * 0.82;            // 底面の半辺(当たり半径に対する見た目の広がり)
  const worldH = main.radius * 1.35;       // 頂点の世界高さ
  const cx = main.x, cy = main.y;
  const cornersW = [
    {x:cx-s, y:cy-s}, {x:cx+s, y:cy-s}, {x:cx+s, y:cy+s}, {x:cx-s, y:cy+s},
  ];
  const bp = cornersW.map(c=>projectGround(c.x, c.y));
  const apex = project(cx, cy, groundZAt(cx, cy) + worldH);
  if(bp.some(pt=>!pt) || !apex) return;    // 至近等で投影できない場合は描かない(群カリングで別途担保)
  ctx.save();
  // 光の向き(日向/影)を底辺の向きで決める。奥→手前の順に面を塗って凸形状の隠面を成立させる
  const lightDir = {x:0.45, y:-0.89};
  const faces = [];
  for(let i=0;i<4;i++){
    const a = bp[i], b = bp[(i+1)%4];
    const wa = cornersW[i], wb = cornersW[(i+1)%4];
    let nx = (wa.x+wb.x)/2 - cx, ny = (wa.y+wb.y)/2 - cy;
    const nl = Math.hypot(nx,ny)||1; nx/=nl; ny/=nl;
    const light = 0.5 + 0.5*Math.max(0, nx*lightDir.x + ny*lightDir.y);
    faces.push({ a, b, light, depth:(a.depth+b.depth)/2 });
  }
  faces.sort((f,g)=> g.depth - f.depth); // 奥の面から描く
  for(const f of faces){
    ctx.beginPath();
    ctx.moveTo(f.a.x, f.a.y); ctx.lineTo(f.b.x, f.b.y); ctx.lineTo(apex.x, apex.y); ctx.closePath();
    const base = 120 + 120*f.light;
    ctx.fillStyle = `rgb(${Math.round(base)},${Math.round(base*0.82)},${Math.round(base*0.5)})`;
    ctx.fill();
    ctx.strokeStyle='rgba(70,50,20,0.55)'; ctx.lineWidth=1.5; ctx.stroke();
  }
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
  const mainP = projectGround(main.x, main.y);
  if(!mainP){ ctx.restore(); return; }

  // 各隆起(主峰含む)を、奥から手前の順で描く(主峰は最後=一番手前)
  const sorted = [...group].sort((a,b)=> (a.isMain?1:0) - (b.isMain?1:0));

  for(const v of sorted){
    // 実体の3D円錐として面分割描画(billboardをやめ、視点移動で泳がないようにする)。
    // ※リアルマップではこの関数自体を呼ばない(山も山頂の演出もWebGL側が描く)
    const peakP = drawSolidCone(v, style);

    if(v.isMain){
      if(peakP){
        const r = peakP.scale * v.radius;
        if(style==='snow'){
          const glow = 0.6+0.25*Math.sin(matchTime*1.2);
          ctx.beginPath(); ctx.ellipse(peakP.x, peakP.y, r*0.24, r*0.15, 0, 0, Math.PI*2);
          ctx.fillStyle = `rgba(255,255,255,${0.75+0.2*glow})`;
          ctx.shadowBlur=16; ctx.shadowColor='rgba(210,235,255,0.9)';
          ctx.fill();
          ctx.shadowBlur=0;
        } else if(style==='forest'){
          // 木々の茂みを頂上付近に足して密度感を出す(頂上少し下の高さに配置)
          const cluster = project(v.x, v.y, groundZAt(v.x,v.y) + v.radius*0.9*0.85) || peakP;
          for(let i=0;i<5;i++){
            const a = (i/5)*Math.PI*2;
            const cx2 = cluster.x + r*0.35*Math.cos(a), cy2 = cluster.y + r*0.15*Math.sin(a);
            ctx.beginPath(); ctx.ellipse(cx2, cy2, r*0.22, r*0.16, 0,0,Math.PI*2);
            ctx.fillStyle = 'rgba(20,60,25,0.55)';
            ctx.fill();
          }
        } else {
          const glow = 0.6+0.3*Math.sin(matchTime*1.6);
          ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(peakP.x, peakP.y, r*0.30, r*0.19, 0, 0, Math.PI*2); ctx.stroke();
          ctx.beginPath(); ctx.ellipse(peakP.x, peakP.y, r*0.26, r*0.16, 0, 0, Math.PI*2);
          ctx.fillStyle = `rgb(${Math.round(200+30*glow)},${Math.round(70+30*glow)},20)`;
          ctx.shadowBlur=22; ctx.shadowColor='rgba(255,110,30,0.95)';
          ctx.fill();
          ctx.shadowBlur=0;
        }
      }
    }
  }
  ctx.restore();
}
let renderHeavyLoad = false;
// 3Dレイヤーが地面を描いているか(リアルマップ)。山・しみの描き分けと遮蔽判定に使う
let real3dActive = false;
/* リアルマップでは山を3Dで描くので、2Dで描くモンスター・弾・アイテムは山より必ず
   手前に描かれてしまう。そのままだと山の裏の相手が透けて見えるため、カメラから対象
   までの線が山(円錐)の内側を通るかを調べ、通るなら描かない
   (=従来の奥行きソートと同じ見え方に戻す)。                                      */
const MOUNT_OCCLUDE_STEPS = 10;
let mountOccluders = [];
function prepareMountainOccluders(){
  mountOccluders.length = 0;
  if(!real3dActive) return;
  for(const v of volcanoObstacles){
    mountOccluders.push({
      x:v.x, y:v.y, r:v.radius,
      rise: v.radius * (v.isMain ? 1.15 : 0.9),
      baseZ: groundZAt(v.x, v.y),
      camDist: Math.hypot(v.x-camPos.x, v.y-camPos.y),
    });
  }
}
/* リアルマップでは3Dの山が奥行きを持つのに対し、2Dで描く建物は距離に関係なく
   そのまま重なるため、遠くの小さな建物が手前の山の上に乗って見える。
   遠い建物は描かない(境目が目立たないよう手前から徐々に薄くする)。
   岩・木・水晶は3Dモデルになったのでこの処理は要らない(奥行きで正しく隠れる)。 */
const OBSTACLE_VIEW_DIST = 2300;   // これより遠い建物は描かない
const OBSTACLE_FADE_DIST = 1750;   // ここから薄くしていく
function obstacleFade(x, y){
  if(!real3dActive) return 1;
  const d = Math.hypot(x-camPos.x, y-camPos.y);
  if(d <= OBSTACLE_FADE_DIST) return 1;
  if(d >= OBSTACLE_VIEW_DIST) return 0;
  return 1 - (d-OBSTACLE_FADE_DIST)/(OBSTACLE_VIEW_DIST-OBSTACLE_FADE_DIST);
}
/* ---- リアルマップの障害物(3Dで描く) ----
   岩・木・水晶などはreal3d.jsが3Dモデルで描く。2D側は「同じ輪郭を destination-out で
   くり抜く」だけにする。くり抜くと、その障害物より前(=奥)に描かれたものだけが消えて
   3Dの障害物が見え、後(=手前)に描かれるものはそのまま上に乗る。つまりモンスターや技の
   前後関係は従来の奥行きソートのままで変わらない。
   輪郭の寸法はdata.jsのOBST_SHAPES(3Dモデルと共通)を使う。**隠れる範囲が実物と
   ずれないよう、3D側の置き方をそのまま再現すること**:
   ・地面へ埋める深さ(sink)を引いた位置がモデルの原点。ここを外すと全体が上へずれ、
     障害物より高い所まで消えてしまう
   ・高さの個体差(hk)は3D側と同じ式でseedから作る
   ・接地高さは3D側と同じ「足元4点のいちばん低い高さ」を使う(坂でずれないため) */
const OBST_ERASE_PAD = 1.02;
function obstShapeOf(o, fallbackFlavor){
  const t = (typeof OBST_SHAPES!=='undefined') ? OBST_SHAPES : null;
  const key = o.flavor || fallbackFlavor || 'rock';
  return (t && (t[key] || t.rock)) || { h:1.3, sink:0.2, sil:[[0.5,1.1,0.66]] };
}
function obstacleCullDist(){
  const api = window.__aramonReal3D;
  return (api && api.obstacleCullDist) ? api.obstacleCullDist() : 3300;
}
// リアルマップでは3D側が出している距離までを対象にする(出していない物をくり抜かない)
function obstacleVisible(x, y){
  if(!real3dActive) return 1;
  return Math.hypot(x-camPos.x, y-camPos.y) <= obstacleCullDist() ? 1 : 0;
}
// 3D側と同じ「足元4点のいちばん低い高さ」。岩は動かないので一度計算したら覚えておく
function obstacleBaseZ(o){
  if(o._obz === undefined){
    const r = o.radius || 30;
    o._obz = Math.min(
      groundZAt(o.x - r*0.7, o.y), groundZAt(o.x + r*0.7, o.y),
      groundZAt(o.x, o.y - r*0.7), groundZAt(o.x, o.y + r*0.7)
    );
  }
  return o._obz;
}
function eraseObstacle(o, p, fallbackFlavor){
  const sh = obstShapeOf(o, fallbackFlavor);
  const r = o.radius || 30;
  const seed = o.seed || 0;
  const hk = 0.90 + (seed - Math.floor(seed))*0.26;   // 3D側の高さの個体差と同じ式
  const baseZ = obstacleBaseZ(o) - r*sh.sink;         // モデルの原点(地面より少し下)
  // 高さは決め打ちの縮尺ではなく実際に投影して求める(近くの高い木ほど差が出る)
  const pBot = project(o.x, o.y, baseZ) || p;
  const pTop = project(o.x, o.y, baseZ + r*sh.h*hk);
  if(!pBot || !pTop) return;
  const hPx = pBot.y - pTop.y;
  // モデルのローカル高さ(0=原点 h=天辺)と横方向のずれから画面上の点を出す
  const ptX = (ly, lx)=>{
    const f = ly/sh.h;
    return pBot.x + (pTop.x-pBot.x)*f + lx*r*(pBot.scale + (pTop.scale-pBot.scale)*f)*OBST_ERASE_PAD;
  };
  const ptY = (ly)=> pBot.y + (pTop.y-pBot.y)*(ly/sh.h);
  // 1フレームに何十回も通るので save/restore は使わず必要な状態だけ戻す
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  ctx.beginPath();
  for(const s of sh.sil){
    const cy = s[0], rx = s[1], ry = s[2], type = s[3]||0;
    const rxTop = (s[4] != null) ? s[4] : rx;   // 箱の上端の太さ(幹は上ほど細い)
    const lo = cy - ry, hi = cy + ry;
    /* 【重要】部分パスの回り方は全部そろえる。ctx.ellipse(0→2π)と逆回りの多角形を
       同じパスに入れると、重なった所が非ゼロ規則で穴になり、そこだけ消し残る
       (幹と葉が重なる木で実際に出た)。多角形は右下→左下→左上→右上で回す。   */
    if(type === 1){          // 箱(幹・柱)。上下で幅が変わるよう両端を別々に投影する
      ctx.moveTo(ptX(lo, rx), ptY(lo));
      ctx.lineTo(ptX(lo,-rx), ptY(lo));
      ctx.lineTo(ptX(hi,-rxTop), ptY(hi));
      ctx.lineTo(ptX(hi, rxTop), ptY(hi));
      ctx.closePath();
    } else if(type === 2){   // 三角(円錐)
      ctx.moveTo(ptX(lo, rx), ptY(lo));
      ctx.lineTo(ptX(lo,-rx), ptY(lo));
      ctx.lineTo(ptX(hi, 0),  ptY(hi));
      ctx.closePath();
    } else {                 // 楕円(丸い塊)
      const ex = ptX(cy, rx) - ptX(cy, 0);
      const ey = Math.abs(ry*hPx/sh.h)*OBST_ERASE_PAD;
      ctx.moveTo(ptX(cy,0)+ex, ptY(cy));   // 楕円ごとに独立した部分パスにする
      ctx.ellipse(ptX(cy,0), ptY(cy), Math.max(0.5,ex), Math.max(0.5,ey), 0, 0, Math.PI*2);
    }
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = prevAlpha;
}
function occludedByMountain(x, y, z){
  if(!mountOccluders.length) return false;
  const dx = x-camPos.x, dy = y-camPos.y, dz = z-camPos.z;
  const targetDist = Math.hypot(dx, dy);
  for(const m of mountOccluders){
    // 対象より奥にある山は遮れない(手前の山だけ調べる)
    if(m.camDist > targetDist + m.r) continue;
    for(let i=1;i<=MOUNT_OCCLUDE_STEPS;i++){
      const t = i/(MOUNT_OCCLUDE_STEPS+1);
      const d = Math.hypot(camPos.x+dx*t-m.x, camPos.y+dy*t-m.y);
      if(d >= m.r) continue;
      if(camPos.z+dz*t < m.baseZ + m.rise*(1 - d/m.r)) return true;
    }
  }
  return false;
}
function render(){
  ctx.clearRect(0,0,viewW,viewH);
  // 序盤など弾/エフェクトが同時に多い時は重い影描画(shadowBlur)を間引いて負荷を下げる
  renderHeavyLoad = (projectiles.length + particles.length) > 22;
  // リアルマップ(テスト)では地面をWebGL(real3d.js)が描くので、2D側は空・地面・
  // 地面の装飾を描かずに透かす。初期化に失敗した場合はfalseが返るので従来描画に戻る
  // 障害物(岩・木・水晶など)も3D側が描く。2D側は同じ輪郭をくり抜くだけ(eraseObstacle)。
  // 山と地面のしみ(溶岩・海・川・オアシス)は3D側が地形に沿わせて描く
  const gl3d = !!(window.__aramonReal3D && window.__aramonReal3D.render(rocks, {
    volcanoes: volcanoObstacles, lava: lavaZones, sea: seaZones, river: riverZones, oasis: oasisZones,
    crystals: crystalObstacles,
    // 海は円の集合ではなく海岸線の式そのものから水面を張る(seaEdgeXはworld.jsの純関数)
    seaEdge: (currentMap && currentMap.hasSea) ? seaEdgeX : null,
    bounds: { w: WORLD.w, h: WORLD.h },
  }));
  real3dActive = gl3d;
  prepareMountainOccluders();
  if(!gl3d){
    drawSkyAndGround();
    // しみは起伏に沿わせる必要があるためリアルマップでは3D側が描く
    drawWaterZones();
    drawLavaZones();
  }
  if(!gl3d) drawTerrainDecor();
  drawZoneRings();
  drawLandingMarkers();
  if(introState.active) drawSummonIntro();

  const drawables = [];
  for(const ae of areaEffects){ const p = projectGround(ae.x,ae.y); if(p) drawables.push({kind:'ae', obj:ae, p}); } // 建物・岩等の大きな障害物と正しく前後関係が付くよう、他のdrawablesと同じ深度ソートに乗せる
  for(const b of buildings){
    const bFade = obstacleFade(b.cx, b.cy);
    if(bFade <= 0) continue;
    const bRad = Math.hypot(b.hw||0, b.hd||0) + (b.rampLen||0); // 建物の外接半径(ランプ含む)
    const p = projectObstacle(b.cx,b.cy,b.wallH*0.5, bRad);
    if(p) drawables.push({kind:'building', obj:b, p, fade:bFade});
  }
  for(const r of rocks){
    const fade = obstacleVisible(r.x, r.y, (r.height||r.radius)*0.5);
    if(fade <= 0) continue;
    const p = projectGround(r.x,r.y); if(p) drawables.push({kind:'rock', obj:r, p, fade});
  }
  for(const c of crystalObstacles){
    const fade = obstacleVisible(c.x, c.y, (c.height||c.radius)*0.5);
    if(fade <= 0) continue;
    const p = projectGround(c.x,c.y); if(p) drawables.push({kind:'crystal', obj:c, p, fade});
  }
  const volcanoGroups = new Map();
  for(const v of volcanoObstacles){
    const gid = v.complexId||0;
    if(!volcanoGroups.has(gid)) volcanoGroups.set(gid, []);
    volcanoGroups.get(gid).push(v);
  }
  // リアルマップでは山は3Dが描く(2Dの山頂の円は山に沿わず浮くので出さない)
  if(!real3dActive) for(const group of volcanoGroups.values()){
    const main = group.find(v=>v.isMain) || group[0];
    let gRad = 0; for(const v of group){ if(v.radius>gRad) gRad = v.radius; } // 複合火山の最大半径
    const p = projectObstacle(main.x, main.y, groundZAt(main.x, main.y), gRad);
    if(p) drawables.push({kind:'volcano', obj:group, p});
  }
  // predictedPickup: マルチのゲストが「拾った」と先読みして消したアイテム(ホストの確定待ち)
  for(const it of lootItems){ if(it.predictedPickup != null || it.respawnAt > matchTime) continue; if(occludedByMountain(it.x, it.y, it.z||0)) continue; const p = project(it.x,it.y,it.z||0); if(p) drawables.push({kind:'loot', obj:it, p}); }
  for(const pr of projectiles){ if(occludedByMountain(pr.x, pr.y, pr.z+20)) continue; const p = project(pr.x,pr.y,pr.z+20); if(p) drawables.push({kind:'proj', obj:pr, p}); }
  for(const e of entities){ if(!e.alive) continue; const p = project(e.x,e.y,e.z); if(p){ // 自分だけは山に隠さない(カメラが山にめり込んだ時に自機が消えるのを防ぐ)
    if(e.isPlayer || !occludedByMountain(e.x, e.y, (e.z||0)+(e.radius||26))) drawables.push({kind:'mon', obj:e, p}); if(!e.isPlayer) monsterScreenPos.set(e.id, {x:p.x,y:p.y,scale:p.scale}); } }
  for(const pt of particles){ const p = project(pt.x,pt.y, (pt.z||0)+(pt.type==='text'?42:16)); if(p) drawables.push({kind:'fx', obj:pt, p}); }

  drawables.sort((a,b)=>b.p.depth-a.p.depth);
  // 巨大なオブジェクト(火山など)は近づくほど画面上の投影位置が大きくブレるため、
  // 固定150pxの余白だけでは実際は画面内に見えているのに誤ってカリングされてしまう。
  // オブジェクトの見た目上の半径(ワールド半径×投影スケール)ぶん余白を広げて判定する。
  const cullMarginFor = (d)=>{
    let r = 0;
    if(d.kind==='volcano'){ for(const v of d.obj){ if(v.radius>r) r=v.radius; } }
    // 3Dの障害物は木のように背が高いものがある。足元が画面外でも上は見えるので高さぶん広げる
    else if(d.kind==='rock' || d.kind==='crystal'){ r = (d.obj.radius||0) * (real3dActive ? obstShapeOf(d.obj, d.kind).h : 1); }
    else if(d.kind==='ae'){ r = d.obj.range||0; } // 発生地点(自分の足元)が画面外でも、射程が長い技は画面内まで届くため
    return 150 + r*d.p.scale*1.2;
  };
  for(const d of drawables){
    const m = cullMarginFor(d);
    if(d.p.x<-m||d.p.x>viewW+m||d.p.y<-m||d.p.y>viewH+m) continue;
    const faded = (d.fade != null && d.fade < 1);
    if(faded) ctx.globalAlpha = d.fade;
    if(d.kind==='loot') drawLootItem(d.obj,d.p);
    else if(d.kind==='proj') drawProjectile(d.obj,d.p);
    else if(d.kind==='volcano') drawVolcanoComplex(d.obj,d.p);
    else if(d.kind==='mon') drawMonster(d.obj,d.p);
    // リアルマップの障害物は3Dが描くので、2Dは輪郭をくり抜くだけ
    else if(d.kind==='rock'){ if(real3dActive) eraseObstacle(d.obj,d.p); else drawRock(d.obj,d.p); }
    else if(d.kind==='crystal'){ if(real3dActive) eraseObstacle(d.obj,d.p,'crystal'); else drawCrystal(d.obj,d.p); }
    else if(d.kind==='building') drawBuilding(d.obj);
    else if(d.kind==='ae') drawSingleAreaEffect(d.obj);
    else drawParticle(d.obj,d.p);
    if(faded) ctx.globalAlpha = 1;
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
    const pg = project(e.x, e.y, e.z||0);
    if(!pg) continue;
    if(pg.x<-240||pg.x>viewW+240||pg.y<-240||pg.y>viewH+240) continue;
    const topH = (e.z||0) + e.radius*8;
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
    const pg = project(e.x, e.y, e.z||0);
    if(!pg) continue;
    if(pg.x<-240||pg.x>viewW+240||pg.y<-240||pg.y>viewH+240) continue;
    const topH = (e.z||0) + e.radius*8;
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
  // HUD左上バーの色はモンスター本来の色ではなくオーラ色(スキンによる変化を考慮)
  const playerAura = (typeof getMonsterAura==='function') ? getMonsterAura(player) : null;
  const accentColor = (playerAura && typeof auraColorHex==='function') ? auraColorHex(playerAura) : el.color;
  document.documentElement.style.setProperty('--accent', accentColor);
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

  // 装備スキンでtier3が専用技に変わる場合は解決後の技を表示する(技名・消費ガッツが変わる)
  let mv = activeMove(player);
  if(typeof skinTier3Move==='function') mv = skinTier3Move(mv, player);
  // 技フィールドのマーク/テーマ色は、その技のオーラ色にする(tier3は装備SSRで一致技に変わる)
  const mvAura = (typeof getMoveAura==='function') ? getMoveAura(mv, player) : mv.aura;
  const moveMarkColor = (mvAura && typeof auraColorHex==='function') ? auraColorHex(mvAura) : mv.color;
  document.getElementById('moveName').textContent = (typeof getMoveName==='function') ? getMoveName(mv, player) : mv.name;
  document.documentElement.style.setProperty('--moveColor', moveMarkColor);
  document.getElementById('gutsCostLabel').textContent = `ガッツ消費 ${effectiveGutsCost(player, mv)}`;
  const tierMoves = SIGNATURE_MOVES[player.element];
  for(let t=1;t<=3;t++){
    const dot = document.querySelector(`.tier-dot[data-tier="${t}"]`);
    const tierMove = tierMoves[t-1];
    const tierAura = (typeof getMoveAura==='function') ? getMoveAura(tierMove, player) : tierMove.aura;
    const tierColor = (tierAura && typeof auraColorHex==='function') ? auraColorHex(tierAura) : moveMarkColor;
    dot.style.setProperty('--dotColor', tierColor);
    dot.classList.toggle('unlocked', t<=player.moveTierUnlocked);
    dot.classList.toggle('selected', t===player.moveTierSelected);
  }
  document.getElementById('moveIcon').innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="${moveMarkColor}"/></svg>`;

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
      if(e.z - player.z > (typeof upwardBlockLimit==='function' ? upwardBlockLimit() : UPWARD_BLOCK_THRESHOLD)) continue;
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
  if(e.target.closest('#titleScreen') || e.target.closest('#startScreen') || e.target.closest('#settingsOverlay') || e.target.closest('#myPageOverlay') || e.target.closest('#helpOverlay') || e.target.closest('#helpImageOverlay') || e.target.closest('#monsterPickOverlay') || e.target.closest('#mapPickOverlay') || e.target.closest('#modePickOverlay') || e.target.closest('#audioSettingsOverlay') || e.target.closest('#accountOverlay') || e.target.closest('#bagOverlay') || e.target.closest('#dailyOverlay') || e.target.closest('#loginBonusPopup') || e.target.closest('#seasonOverlay') || e.target.closest('#gachaOverlay') || e.target.closest('#skinPromoOverlay') || e.target.closest('#skinPreviewOverlay') || e.target.closest('#shopOverlay') || e.target.closest('#changelogOverlay') || e.target.closest('#rankingScreen') || e.target.closest('#myStatsScreen') || e.target.closest('#howToPlayScreen') || e.target.closest('#mastermonScreen') || e.target.closest('#resultScreen') || e.target.closest('#monsterListScreen') || e.target.closest('#adminPassScreen') || e.target.closest('#adminScreen') || e.target.closest('#lobbyScreen') || e.target.closest('#roomListScreen') || e.target.closest('#spectateBar') || e.target.closest('#rangeBar') || e.target.closest('#lookSettingsOverlay') || e.target.closest('#textInputOverlay')) return;
  e.preventDefault();
}, {passive:false});
document.addEventListener('gesturestart', (e)=>{ e.preventDefault(); });
document.addEventListener('gesturechange', (e)=>{ e.preventDefault(); });
document.addEventListener('gestureend', (e)=>{ e.preventDefault(); });

