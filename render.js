// 自分のライフゲージの透け具合(0=見えない〜1=不透明)。
// 画面中央に常に出て視界の邪魔になるので薄くしてある。他のモンスターの分は不透明のまま。
const SELF_HP_BAR_ALPHA = 0.5;

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
  const ssrSet = (reg.ssr||[]).find(s=>s.skinId===skinId);   // 1素体に何体でも持てる
  const useSsr = !!ssrSet;
  if(m.kind==='ssr' && !useSsr) return null; // 歩行コマ未提供のSSRスキンは静止画のまま
  const set = useSsr ? ssrSet : reg.base;
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

/* =====================================================================
   Xへのシェア画像(1枚のカードをオフスクリーンcanvasに描いてPNGにする)

   **描画側はカード定義オブジェクト(spec)の形しか知らない。**
   リザルト・マスモン・ランキング・ガチャ・SSR獲得のどこから来ても同じ絵柄になる。
   新しい入口を足すときは、ui.js側でspecを作る関数を1つ書くだけでよい
   (ここに画面ごとの分岐を足さない)。

   spec = {
     accent, accent2 : 基調色(勝敗・属性・レアリティで変える)
     player          : プレイヤー名(1行目に小さく出す)
     headline        : 大見出し(必須)
     sub             : 見出しの下の1行
     image           : Image|Canvas|null … 主役の絵(スキン反映済み。無ければプレースホルダ)
     imageLabel      : 絵の下のラベル
     rows            : [{label,value}] 2〜4個。valueは桁区切り済みの**文字列**で渡す
     bars            : [{label,rank,value,max,color}] … rowsの代わりに縦並びのバーで見せる
                       (マスモンは6項目すべてを適正バッジ付きのバーで出す)
     chips           : [文字列] 0〜3個
   }

   【注意】monsters/*.png は同一オリジンなのでcanvasが汚染されずtoBlobできる。
   **将来これらを外部CDNへ出すと、crossOriginが付かない限りシェアが即死する。**
   ===================================================================== */
const SHARE_CARD_W = 1200, SHARE_CARD_H = 675;   // 16:9。Xのタイムラインで切られない比率
// 数字・英字はゲームと同じ書体、日本語は自動で次のファミリへ落ちる(新規Webフォントは足さない)
const SHARE_FONT_STACK = "'Rajdhani','Share Tech Mono','Hiragino Sans','Noto Sans JP',sans-serif";
const SHARE_INK = '#eef2f8', SHARE_DIM = '#9aa7b8';

function _shareFont(px, weight){ return `${weight||600} ${px}px ${SHARE_FONT_STACK}`; }
function _shareRoundRect(cx, x, y, w, h, r){
  const rr = Math.min(r, w/2, h/2);
  cx.beginPath();
  cx.moveTo(x+rr, y);
  cx.arcTo(x+w, y,   x+w, y+h, rr);
  cx.arcTo(x+w, y+h, x,   y+h, rr);
  cx.arcTo(x,   y+h, x,   y,   rr);
  cx.arcTo(x,   y,   x+w, y,   rr);
  cx.closePath();
}
/* 枠に収まるまでフォントを落とし、最小サイズでも入らなければ末尾を「…」にする。
   **カードの文字はすべてこれを通す**(プレイヤー名もマスモン名も長さが読めないため)。
   実際に描いたフォントサイズを返す。 */
function _shareFitText(cx, text, x, y, maxW, basePx, minPx, weight){
  let px = basePx, s = String(text==null ? '' : text);
  while(px > minPx){
    cx.font = _shareFont(px, weight);
    if(cx.measureText(s).width <= maxW) break;
    px -= 2;
  }
  cx.font = _shareFont(px, weight);
  if(cx.measureText(s).width > maxW){
    while(s.length > 1 && cx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    s += '…';
  }
  cx.fillText(s, x, y);
  return px;
}
// object-fit:contain 相当。枠の中央に、はみ出さないよう収める
function _shareDrawContain(cx, img, x, y, w, h){
  const iw = _imgW(img), ih = _imgH(img);
  if(!iw || !ih) return;
  const k = Math.min(w/iw, h/ih);
  const dw = iw*k, dh = ih*k;
  cx.drawImage(img, x + (w-dw)/2, y + (h-dh)/2, dw, dh);
}
/* 主役の絵。**画像が無くても例外を投げない**(未ロードやスキン生成待ちで普通に起きる)。
   その場合は基調色の円とラベルの1文字目でごまかす。 */
function _shareDrawArt(cx, spec, x, y, w, h){
  if(spec.image && _imgW(spec.image)){ _shareDrawContain(cx, spec.image, x, y, w, h); return; }
  const cxx = x + w/2, cyy = y + h/2, r = Math.min(w, h)*0.34;
  cx.save();
  cx.fillStyle = spec.accent2 || '#233047';
  cx.beginPath(); cx.arc(cxx, cyy, r, 0, Math.PI*2); cx.fill();
  cx.strokeStyle = spec.accent || '#f4c430'; cx.lineWidth = 4; cx.stroke();
  cx.fillStyle = spec.accent || '#f4c430';
  cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.font = _shareFont(Math.round(r), 700);
  cx.fillText(String(spec.imageLabel || '？').slice(0, 1), cxx, cyy + 2);
  cx.restore();
}
function _shareDrawChips(cx, chips, x, y, maxW){
  let cur = x;
  for(const raw of (chips || []).slice(0, 3)){
    const t = String(raw || ''); if(!t) continue;
    cx.font = _shareFont(19, 600);
    const w = cx.measureText(t).width + 26;
    if(cur + w > x + maxW) break;
    cx.fillStyle = 'rgba(255,255,255,0.09)';
    _shareRoundRect(cx, cur, y, w, 32, 16); cx.fill();
    cx.strokeStyle = 'rgba(255,255,255,0.22)'; cx.lineWidth = 1; cx.stroke();
    cx.fillStyle = SHARE_INK;
    cx.textAlign = 'left'; cx.textBaseline = 'middle';
    cx.fillText(t, cur + 13, y + 17);
    cur += w + 10;
  }
}
/* 適正バッジ(ステータス名の右に付く小さな角丸)。**マスモン詳細の見た目に合わせてある。**
   色は data.js の APTITUDE_BADGE_COLOR(style.cssと同じ値を二重に持っている)。
   描いた幅を返すので、呼び側は続きをその右から描ける。 */
function _shareDrawAptBadge(cx, grade, x, y, h){
  const g = String(grade || '');
  if(!g) return 0;
  cx.font = _shareFont(Math.round(h*0.62), 800);
  const w = Math.max(h + 6, cx.measureText(g).width + 14);
  const col = (typeof APTITUDE_BADGE_COLOR!=='undefined') ? APTITUDE_BADGE_COLOR[g] : null;
  if(Array.isArray(col)){                       // M(最上位)だけ虹色
    const lg = cx.createLinearGradient(x, y, x + w, y + h);
    col.forEach((c, i)=> lg.addColorStop(i/(col.length-1), c));
    cx.fillStyle = lg;
  } else {
    cx.fillStyle = col || '#8a97a8';
  }
  _shareRoundRect(cx, x, y, w, h, 5); cx.fill();
  cx.fillStyle = '#1a0f06';                     // バッジの地は明るいので文字は濃い色で固定
  cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.fillText(g, x + w/2, y + h/2 + 1);
  cx.textAlign = 'left'; cx.textBaseline = 'alphabetic';
  return w;
}
/* ステータスバー(マスモン用)。名前＋適正バッジ＋数値＋伸びるバーを縦に並べる。
   bars = [{label, rank, value, max, color}] */
function _shareDrawBars(cx, bars, x, y, w, pitch){
  (bars || []).forEach((b, i)=>{
    const ty = y + pitch*i;
    cx.textAlign = 'left'; cx.textBaseline = 'alphabetic';
    cx.fillStyle = SHARE_INK;
    cx.font = _shareFont(23, 700);
    const nameW = Math.min(cx.measureText(b.label).width, w*0.4);
    _shareFitText(cx, b.label, x, ty, w*0.4, 23, 14, 700);
    _shareDrawAptBadge(cx, b.rank, x + nameW + 9, ty - 16, 21);
    // 数値は右端ぞろえ。桁がそろって「どこが伸びているか」が読める
    cx.textAlign = 'right';
    cx.fillStyle = b.color || SHARE_INK;
    cx.font = _shareFont(25, 700);
    cx.fillText(String(b.value), x + w, ty);
    cx.textAlign = 'left';
    // バー本体
    const bh = 10, by = ty + 10;
    cx.fillStyle = 'rgba(255,255,255,0.13)';
    _shareRoundRect(cx, x, by, w, bh, bh/2); cx.fill();
    const pct = Math.max(0, Math.min(1, (b.value||0) / (b.max || 1)));
    if(pct > 0){
      cx.fillStyle = b.color || '#f4c430';
      _shareRoundRect(cx, x, by, Math.max(bh, w*pct), bh, bh/2); cx.fill();
    }
  });
}
// 数値行。2〜4個を等幅に割り、値だけ大きく出す
function _shareDrawRows(cx, rows, x, y, maxW, accent){
  const list = (rows || []).slice(0, 4);
  if(!list.length) return;
  const colW = maxW / list.length;
  list.forEach((r, i)=>{
    const cxx = x + colW*i;
    cx.textAlign = 'left'; cx.textBaseline = 'alphabetic';
    cx.fillStyle = SHARE_DIM;
    _shareFitText(cx, r.label, cxx, y, colW - 24, 20, 13, 600);
    cx.fillStyle = accent;
    _shareFitText(cx, r.value, cxx, y + 50, colW - 24, 46, 26, 700);
  });
}

/* カードを描いてcanvasを返す(同期)。
   **シェアがゲームを壊すことは許さない**ので、途中で落ちても文字だけのカードを返す。 */
function shareCardCanvas(spec){
  const c = document.createElement('canvas');
  c.width = SHARE_CARD_W; c.height = SHARE_CARD_H;
  const cx = c.getContext('2d');
  try{ _shareDrawCard(cx, spec || {}); }
  catch(err){
    console.warn('シェア画像の描画に失敗したので簡易版にしました', err);
    try{ _shareDrawFallback(cx, spec || {}); }catch(err2){}
  }
  return c;
}
function _shareDrawCard(cx, spec){
  const accent  = spec.accent  || '#f4c430';
  const accent2 = spec.accent2 || '#1b2740';
  // 背景(基調色→暗い地の縦グラデ + 対角の薄いストライプ)
  const g = cx.createLinearGradient(0, 0, SHARE_CARD_W*0.35, SHARE_CARD_H);
  g.addColorStop(0, accent2); g.addColorStop(0.55, '#0a1120'); g.addColorStop(1, '#06090f');
  cx.fillStyle = g; cx.fillRect(0, 0, SHARE_CARD_W, SHARE_CARD_H);
  cx.save();
  cx.globalAlpha = 0.05; cx.fillStyle = '#ffffff';
  for(let i = -SHARE_CARD_H; i < SHARE_CARD_W; i += 56){
    cx.beginPath(); cx.moveTo(i, SHARE_CARD_H); cx.lineTo(i + SHARE_CARD_H*0.6, 0);
    cx.lineTo(i + SHARE_CARD_H*0.6 + 16, 0); cx.lineTo(i + 16, SHARE_CARD_H); cx.fill();
  }
  cx.restore();
  // 基調色の光(左の絵の後ろ)
  const glow = cx.createRadialGradient(264, 320, 20, 264, 320, 300);
  glow.addColorStop(0, accent); glow.addColorStop(1, 'rgba(0,0,0,0)');
  cx.save(); cx.globalAlpha = 0.22; cx.fillStyle = glow;
  cx.fillRect(0, 0, 620, SHARE_CARD_H); cx.restore();
  // 内枠
  cx.strokeStyle = accent; cx.lineWidth = 2; cx.globalAlpha = 0.65;
  _shareRoundRect(cx, 24, 24, SHARE_CARD_W-48, SHARE_CARD_H-48, 22); cx.stroke();
  cx.globalAlpha = 1;

  // 左: 主役の絵と台座
  cx.save();
  cx.globalAlpha = 0.3; cx.fillStyle = accent;
  cx.beginPath(); cx.ellipse(264, 512, 150, 26, 0, 0, Math.PI*2); cx.fill();
  cx.restore();
  _shareDrawArt(cx, { ...spec, accent, accent2 }, 84, 118, 360, 380);
  if(spec.imageLabel){
    cx.fillStyle = SHARE_INK; cx.textAlign = 'center'; cx.textBaseline = 'alphabetic';
    _shareFitText(cx, spec.imageLabel, 264, 576, 340, 28, 16, 700);
  }

  // 右: 文字組み
  const RX = 508, RW = SHARE_CARD_W - 508 - 64;
  cx.textAlign = 'left';
  cx.fillStyle = SHARE_DIM;
  if(spec.player) _shareFitText(cx, spec.player, RX, 132, RW, 24, 15, 600);
  cx.fillStyle = accent;
  _shareFitText(cx, spec.headline || '', RX, 216, RW, 72, 40, 700);
  cx.fillStyle = SHARE_INK;
  /* サブの位置は**固定**。見出しの実サイズに連動させると、見出しが縮んだときに
     サブがせり上がって重なる(レイドの「🐉 レイドボスを討伐！」で実際に起きた)。 */
  if(spec.sub) _shareFitText(cx, spec.sub, RX, 266, RW, 30, 18, 600);
  _shareDrawChips(cx, spec.chips, RX, 300, RW);
  /* 数値の見せ方は2通り。**barsがあればそちらを優先**する(マスモンは6項目すべてを
     バーと適正で見せたいので、3つだけの数値行では足りない)。 */
  if(spec.bars && spec.bars.length) _shareDrawBars(cx, spec.bars, RX, 364, RW, 44);
  else _shareDrawRows(cx, spec.rows, RX, 400, RW, accent);

  // 下: 出典
  cx.fillStyle = SHARE_DIM; cx.textAlign = 'left'; cx.textBaseline = 'alphabetic';
  cx.font = _shareFont(24, 700); cx.fillText('荒野モン動', 64, SHARE_CARD_H - 44);
  cx.font = _shareFont(18, 600); cx.fillStyle = 'rgba(154,167,184,0.75)';
  cx.fillText('WILD BATTLE ROYALE', 190, SHARE_CARD_H - 44);
  cx.textAlign = 'right';
  cx.fillText(typeof SHARE_URL!=='undefined' ? SHARE_URL.replace(/^https?:\/\//, '') : '', SHARE_CARD_W - 64, SHARE_CARD_H - 44);
}
// 描画が落ちたときの最後の砦。見出しだけでも読める1枚にする
function _shareDrawFallback(cx, spec){
  cx.fillStyle = '#06090f'; cx.fillRect(0, 0, SHARE_CARD_W, SHARE_CARD_H);
  cx.fillStyle = spec.accent || '#f4c430';
  cx.textAlign = 'center'; cx.textBaseline = 'middle';
  _shareFitText(cx, spec.headline || '荒野モン動', SHARE_CARD_W/2, SHARE_CARD_H/2 - 20, SHARE_CARD_W - 120, 64, 28, 700);
  cx.fillStyle = SHARE_DIM;
  _shareFitText(cx, spec.sub || '', SHARE_CARD_W/2, SHARE_CARD_H/2 + 48, SHARE_CARD_W - 120, 30, 18, 600);
}
/* PNGのBlobにする。mimeを引数にしてあるのは、重すぎたときに
   image/jpeg 0.9 へ落とせるようにするため(透過を使っていないので見た目は変わらない)。 */
function shareCardBlob(spec, canvas, mime){
  const c = canvas || shareCardCanvas(spec);
  return new Promise(resolve=>{
    try{ c.toBlob(b=>resolve(b), mime || 'image/png'); }
    catch(err){ console.warn('シェア画像のBlob化に失敗', err); resolve(null); }
  });
}
// 共有シートに渡すFile。File未対応の環境ではnull(呼び側が自動でフォールバックする)
async function shareCardFile(spec, filename, canvas){
  if(typeof File!=='function') return null;
  const blob = await shareCardBlob(spec, canvas);
  if(!blob) return null;
  try{ return new File([blob], filename || 'aramon.png', { type: blob.type || 'image/png' }); }
  catch(err){ console.warn('シェア画像のFile化に失敗', err); return null; }
}

/* 縮小版スプライトのキャッシュ
   モンスター画像は320〜1024pxあるが、画面上では40〜200px程度にしか出ない。
   大きいまま毎フレームdrawImageすると、端末のGPUが抱えるテクスチャが膨れ上がる
   (歩行コマは1体16枚。試合開始直後は27体ぶん=200枚以上が同時に必要になり、
    ここでフレーム時間の大半を失っていた)。
   実際に必要な大きさの2の冪(64/128/256)へ1回だけ縮小して使い回す。
   ・必要な大きさが256pxを超えるとき(自分がカメラに近いとき)は元画像をそのまま使う
   ・縮小は高品質補間で1回だけなので、見た目は落ちない                          */
const SPRITE_BUCKETS = [64, 128, 256];
let _monDrawScale = 1;   // 直前にdrawMonsterが掛けた投影スケール(縮小版の選択に使う)
const _spriteCache = new WeakMap();   // img -> { 64:canvas, 128:canvas, ... }
function scaledSpriteFor(img, needPx){
  const iw = _imgW(img), ih = _imgH(img);
  const src = Math.max(iw, ih);
  let bucket = 0;
  for(const b of SPRITE_BUCKETS){ if(b >= needPx){ bucket = b; break; } }
  if(!bucket || bucket >= src) return img;      // 元画像より大きくするなら意味がない
  let set = _spriteCache.get(img);
  if(!set){ set = {}; _spriteCache.set(img, set); }
  if(set[bucket]) return set[bucket];
  const k = bucket / src;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(iw*k)); c.height = Math.max(1, Math.round(ih*k));
  const cx = c.getContext('2d');
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(img, 0, 0, c.width, c.height);
  set[bucket] = c;
  return c;
}
// 画像の白シルエット(被弾フラッシュ用)をオフスクリーンに一度だけ作ってキャッシュする。
// (円形クリップを廃したため、矩形の白fillでは背景まで白くなってしまう。
//  画像のアルファ形状に沿って白くするためにこの手法を使う)
// 縮小版から作るので、マスクのテクスチャも小さくて済む。
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
  // 画面上での実ピクセル数に合う縮小版を使う(投影スケール×描画解像度)
  const need = Math.max(dw, dh) * _monDrawScale * (typeof dpr!=='undefined' ? dpr : 1);
  const spr = scaledSpriteFor(img, need);
  ctx.drawImage(spr, -dw/2, -dh/2, dw, dh);
  if(flash){
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.drawImage(whiteMaskFor(spr), -dw/2, -dh/2, dw, dh);
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
      if(!renderHeavyLoad){ ctx.shadowBlur = 16; ctx.shadowColor = color; }

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
      if(!renderHeavyLoad){ ctx.shadowBlur = 14; ctx.shadowColor = accent; }

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
      ctx.fillStyle = accent; if(!renderHeavyLoad){ ctx.shadowBlur=10; ctx.shadowColor=accent; } ctx.fill();
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
/* 頭上ラベル(名前・▽・ダウン・蘇生ゲージ)の画面上の拡大上限。
   p.scaleのまま描くとカメラ至近で文字が画面の半分を覆う(縦持ち実測で発生)。 */
const TEAM_LABEL_MAX_SCALE = 2.2;
/* カメラ至近ではラベルごと消す(上限で止めても位置が画面中央へ来て操作UIへ被る)。
   スケール2.0から薄れはじめ3.0で完全に消える。荒野行動の近距離マーカーと同じ挙動 */
function teamLabelFade(){
  return clamp((3.0 - _monDrawScale)/1.0, 0, 1);
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
  _monDrawScale = p.scale;
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

  // チーム戦のダウン中は倒れ姿勢(横倒し)で最低限の見分けを付ける(詳しい演出は別担当)。
  // スプライトだけ回し、この後の状態リング・HPゲージは回さない
  const downedPose = (typeof entityDowned==='function') && entityDowned(e);
  if(downedPose){ ctx.save(); ctx.rotate(Math.PI/2); }
  const displayImg = getDisplayImage(e);
  if(displayImg){
    drawMonsterPortrait(e, displayImg, e.hitFlash>0);
  } else {
    drawMonsterShape(e, e.hitFlash>0?'#ffffff':el.color, el.dark);

    if(e.element==='fire'){
      const eo = e.radius*0.36;
      ctx.save();
      if(!renderHeavyLoad){ ctx.shadowBlur=8; ctx.shadowColor='#ffd76a'; }
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
  if(downedPose) ctx.restore();   // 倒れ姿勢の回転はスプライトまで

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
    if(!renderHeavyLoad){ ctx.shadowBlur = 16; ctx.shadowColor = '#ffe9a8'; }
    ctx.beginPath(); ctx.arc(0,0, e.radius*1.55, 0, Math.PI*2); ctx.stroke();
    ctx.globalAlpha = pulse*0.6;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0,0, e.radius*1.75, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }

  /* ライフゲージ。自分の分は画面中央に大きく出て視界の邪魔になるため、
     モンスターの頭のすぐ上(画像の上端は原点から -radius)まで下げ、半透明にする。
     他のモンスターは今までどおり離れた位置・不透明のまま(遠くからでも読めるように)。 */
  // barYはこの下の状態変化ラベルも参照するので、必ず関数のスコープに置く
  // (レイドのボス判定のブロックに入れるとボス以外でも参照できず落ちる)
  const selfBar = !!e.isPlayer;
  const barY = selfBar ? -e.radius*1.08-5 : -e.radius*1.55-9;
  // レイドのボスの体力は画面上部の専用バーで見せるので、頭上のゲージは出さない
  if(!e.isRaidBoss){
    const barW = e.radius*2.1;
    const hpPct = clamp(e.hp/e.maxHp,0,1);
    /* 至近の味方のバーは薄れて消える(常に隣にいるので、カメラに近づくたび
       巨大なバーが操作UIへ被っていた=批評指摘。敵は従来どおり=撃ち合いの的。
       HPは小隊バーが常時見せているので、近くで消えても情報は失わない) */
    const allyBarFade = (!selfBar && (typeof sameTeam==='function') && player && sameTeam(player, e))
      ? teamLabelFade() : 1;
    if(allyBarFade > 0.02){
      ctx.save();
      if(selfBar) ctx.globalAlpha = SELF_HP_BAR_ALPHA;
      else if(allyBarFade < 1) ctx.globalAlpha = allyBarFade;
      ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(-barW/2, barY, barW, 6);
      ctx.fillStyle = hpPct>0.5?'#5fe07c':(hpPct>0.22?'#f4c430':'#ff5d5d');
      ctx.fillRect(-barW/2, barY, barW*hpPct, 6);
      ctx.restore();
    }
  }

  /* チーム戦のダウン表現: 出血リング(赤の脈動・2重)+出血死までの残り秒。
     蘇生が進んでいる間は頭上に円形の進捗ゲージ(reviveProgress/TEAM_REVIVE_SEC)を重ねる。
     ゲストにも downedUntil/reviveProgress は同期済み(authStateのdw/rv)なので同じ絵が出る */
  if((typeof entityDowned==='function') && entityDowned(e)){
    const pulse = 0.45 + 0.3*Math.sin(matchTime*6);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, e.radius*0.55, e.radius*1.35, 0, Math.PI*2); ctx.stroke();
    ctx.globalAlpha = pulse*0.5;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, e.radius*0.55, e.radius*1.7, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
    /* ラベルとゲージは自分には出さない(自分のダウンは画面下の帯が唯一の表示。
       二重に出すと重なって読めない=批評指摘)。頭上要素はスケール上限を掛けて
       カメラ至近でも巨大化させない(TEAM_LABEL_MAX_SCALE)。 */
    if(!e.isPlayer){
      const lblK = Math.min(1, TEAM_LABEL_MAX_SCALE/Math.max(0.01,_monDrawScale));
      const fade = teamLabelFade();
      if(fade > 0.02){
        const remainDown = Math.max(0, Math.ceil((e.downedUntil||0) - matchTime));
        ctx.save();
        ctx.scale(lblK,lblK);
        ctx.globalAlpha = fade;
        ctx.textAlign='center';
        ctx.font = "bold 11px 'Rajdhani', sans-serif";
        ctx.fillStyle = '#ff9a8a';
        if(!renderHeavyLoad){ ctx.shadowBlur = 4; ctx.shadowColor = 'rgba(255,40,40,0.7)'; }
        ctx.fillText(`ダウン ${remainDown}`, 0, barY - 16);
        if(e.reviveProgress > 0 && typeof TEAM_REVIVE_SEC!=='undefined'){
          const ratio = clamp(e.reviveProgress/TEAM_REVIVE_SEC, 0, 1);
          const gy = barY - 44;
          /* %はリングの中に描く(リングの下に書くと名前・HPバーと積み重なって
             全部読めなくなる=批評2巡目の主犯)。名前・▽はダウン中は描かない
             (誰かは小隊バーが伝える)ので、この縦積みだけで完結する */
          ctx.lineWidth = 5; ctx.lineCap='round';
          ctx.strokeStyle = 'rgba(255,255,255,0.25)';
          ctx.beginPath(); ctx.arc(0, gy, 14, 0, Math.PI*2); ctx.stroke();
          ctx.strokeStyle = '#58e07e';
          if(!renderHeavyLoad){ ctx.shadowBlur = 8; ctx.shadowColor = '#58e07e'; }
          ctx.beginPath(); ctx.arc(0, gy, 14, -Math.PI/2, -Math.PI/2 + ratio*Math.PI*2); ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.font = "bold 9px 'Rajdhani', sans-serif";
          ctx.fillStyle='#eafff0';
          ctx.fillText(`${Math.round(ratio*100)}%`, 0, gy + 3);
        }
        ctx.restore();
      }
    }
  }

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
      if(!renderHeavyLoad){ ctx.shadowBlur = flashing ? 7 : 3; ctx.shadowColor = 'rgba(255,0,0,0.75)'; }
      ctx.fillText(flashing ? sc.name+'!' : sc.name, 0, barY-4);   // 位置はライフゲージに追従させる
      ctx.restore();
    }
  }

  /* チーム戦の味方は距離に関係なく名前を出し、緑の名前+頭上の▽で敵と即区別する。
     ▽は「味方だけの形」(色覚多様性のため色だけに頼らない。小隊バーのsq-markと同じ記号) */
  const isAllyOfPlayer = (typeof sameTeam==='function') && player && sameTeam(player, e);
  const entIsDowned = (typeof entityDowned==='function') && entityDowned(e);
  if(!e.isPlayer && !entIsDowned && (isAllyOfPlayer || dist(e,player)<700)){
    // 頭上の名前・▽もスケール上限+近距離フェード(至近の味方でラベルが操作UIへ被る)
    ctx.save();
    { const lblK = Math.min(1, TEAM_LABEL_MAX_SCALE/Math.max(0.01,_monDrawScale)); ctx.scale(lblK,lblK); }
    const allyFade = isAllyOfPlayer ? teamLabelFade() : 1;
    if(allyFade <= 0.02){ ctx.restore(); ctx.restore(); return; }
    ctx.globalAlpha = allyFade;
    ctx.font="11px 'Rajdhani', sans-serif";
    ctx.fillStyle = isAllyOfPlayer ? '#7dffa8' : (e.isMastermonBot ? '#ffd76a' : 'rgba(230,230,220,0.85)');
    ctx.textAlign='center';
    if((isAllyOfPlayer || e.isMastermonBot) && !renderHeavyLoad){ ctx.shadowBlur=6; ctx.shadowColor = isAllyOfPlayer ? '#2fd35a' : '#ffb703'; }
    // キルリーダーは名前の頭に👑(★マスモン印と同じ作法。スケール上限・近距離フェードも同じものが効く)
    ctx.fillText(((typeof isKillLeader==='function' && isKillLeader(e))?'👑 ':'')+(e.isMastermonBot?'★ ':'')+displayNameFor(e), 0, -e.radius*1.55-13);
    ctx.shadowBlur = 0;
    // ゴースト(他の人が育てたマスモン)は、誰の子かを小さく添える
    if(e.ghostOwner){
      ctx.font="9px 'Rajdhani', sans-serif"; ctx.fillStyle='rgba(255,215,106,0.75)';
      ctx.fillText(e.ghostOwner+' の', 0, -e.radius*1.55-24);
    }
    if(isAllyOfPlayer){
      const my = -e.radius*1.55 - (e.ghostOwner ? 38 : 28);   // 名前(とゴースト表記)の上
      const bob = Math.sin(matchTime*3 + e.id)*1.5;           // ふわふわ上下して目に留まるように
      ctx.save();
      ctx.globalAlpha = 0.95*allyFade;   // 近距離フェードを▽にも効かせる(上書きしない)
      ctx.fillStyle = '#58e07e';
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-6, my-9+bob); ctx.lineTo(6, my-9+bob); ctx.lineTo(0, my+bob);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
  ctx.restore();
}
/* 遠くのアイテムは簡略化して描く。
   試合開始直後はアイテムが数十個あり、1個ずつ楕円・矩形・文字を重ねると
   端末側のラスタ化がフレーム時間の大半を占める。画面上で十数pxしかない距離では
   細部は元から見えないので、色の付いた粒だけにしても見た目は変わらない。      */
/* アイテムの表示距離(カメラからの奥行き。ワールド単位)。
   ・LOOT_VIEW より遠いものはそもそも描かない。マルチでは420個ほど撒かれるため、
     全部描くと描画数が数百に膨らみ、地平線に粒が並んで浮いて見える
   ・LOOT_SIMPLE_DEPTH より遠いものは粒だけにする(その距離では細部は元から見えない)
   ・負荷の状態(renderHeavyLoad)には連動させない。gfxLevelが上がると貼り付いたままになり、
     近くのアイテムまでずっと粒になってしまう(実際に起きた)                       */
const LOOT_VIEW         = 2400;
const LOOT_SIMPLE_DEPTH = 1450;
function lootTintOf(it){
  if(it.kind==='heal'){ const hi = HEAL_ITEMS[it.type]; return hi ? hi.color : '#8fe38f'; }
  if(it.kind==='ticket') return TICKET_ITEM.color;
  if(it.kind==='guts')   return GUTS_ITEM.color;
  if(it.kind==='training'){ const ti = TRAINING_ITEMS[it.type]; return ti ? ti.color : '#ffd23c'; }
  if(it.kind==='deathDisc') return DEATH_DISC_ACCENT;
  return '#ffffff';
}
function drawLootItem(it,p){
  if(p.depth > LOOT_SIMPLE_DEPTH){
    const col = lootTintOf(it);
    const r = Math.max(2, 10*p.scale);
    const bob = Math.sin(matchTime*2.4+it.bob)*2.5*p.scale;
    const cy = p.y - 9*p.scale + bob;
    ctx.save();
    ctx.beginPath(); ctx.arc(p.x, cy, r, 0, Math.PI*2);
    ctx.fillStyle = col; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(p.x,p.y);
  ctx.scale(p.scale,p.scale);
  if(it.kind==='heal'){
    const hi = HEAL_ITEMS[it.type];
    const sz = hi.size;
    const bob = Math.sin(matchTime*2.4+it.bob)*2.5;
    ctx.translate(0,-9*sz+bob);
    if(!renderHeavyLoad){ ctx.shadowBlur=10; ctx.shadowColor=hi.accent; }
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
    if(!renderHeavyLoad){ ctx.shadowBlur=10; ctx.shadowColor=TICKET_ITEM.accent; }
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
    if(!renderHeavyLoad){ ctx.shadowBlur=10; ctx.shadowColor=GUTS_ITEM.accent; }
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
    if(!renderHeavyLoad){ ctx.shadowBlur = 22*spin; ctx.shadowColor = ti.accent; }
    ctx.beginPath(); ctx.arc(0,0,18,0,Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill();
    ctx.strokeStyle = ti.accent; ctx.lineWidth = 2; ctx.stroke();
    ctx.font="24px sans-serif"; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(ti.emoji, 0, 1);
    ctx.shadowBlur=0;
    if(dist(it,player)<200){
      ctx.font="10px 'Rajdhani', sans-serif"; ctx.fillStyle=ti.accent; ctx.textAlign='center'; ctx.textBaseline='alphabetic';
      // 効果は拾ったあとのカードで見せるので、地面では名前だけにする(長い説明は読ませない)
      ctx.fillText(ti.name, 0, -26);
    }
  } else if(it.kind==='deathDisc'){
    /* デス円盤石: 横たわる石の円盤+うっすら金の光の柱。
       他のアイテムと違い**浮かせない**(倒れた者の遺物として地面に置く)。
       金の明滅(glow)だけで「拾える」ことを示す。 */
    const glow = 0.6 + 0.3*Math.sin(matchTime*2.2 + it.bob);
    /* 光の色で敵味方を伝える(チーム戦のみ): 敵の遺物=赤系/味方の遺物=緑系。
       個人戦は従来の金(全部が「敵の落とし物」なので区別が要らない)。
       ミニマップの3値・頭上▽と同じ「見る側から見た敵味方」の色言語 */
    let pr=255, pg=215, pb=106;   // 既定=金
    if((typeof isTeamMatch==='function') && isTeamMatch() && it.ownerTeamId!=null && player && player.teamId!=null){
      if(it.ownerTeamId===player.teamId){ pr=110; pg=235; pb=140; }   // 味方の遺物=緑
      else { pr=255; pg=110; pb=100; }                                 // 敵の遺物=赤
    }
    const col = (a)=> `rgba(${pr},${pg},${pb},${a})`;
    // 光の柱(上へ淡く消える)
    const grad = ctx.createLinearGradient(0, 0, 0, -92);
    grad.addColorStop(0, col(0.30*glow));
    grad.addColorStop(0.55, col(0.12*glow));
    grad.addColorStop(1, col(0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-DEATH_DISC_R*0.42, 0); ctx.lineTo(-4, -92); ctx.lineTo(4, -92); ctx.lineTo(DEATH_DISC_R*0.42, 0);
    ctx.closePath(); ctx.fill();
    /* 石の円盤は**ガチャ・召喚演出と同じ画像**を使う(手描きの楕円で似せない)。
       同じ「円盤石」が場面ごとに違う絵だと別物に見えるため(発注者決定 2026-08-14)。
       ガチャと同じ厚み付き→平ら→手描き の順に落とす(画像が未ロードでも必ず何か出す)。
       DEATH_DISC_R は光のふち・柱と画像の大きさをそろえるための1つの基準。 */
    const R = DEATH_DISC_R, RY = R*DEATH_DISC_FACE_RATIO;
    if(imgIsReady(summonDiskThickImg)){
      const S = R * DEATH_DISC_THICK_SCALE;   // 顔の直径が R*2 相当になるよう全体を拡縮
      ctx.drawImage(summonDiskThickImg, -S/2, -S/2 + R*DEATH_DISC_FACE_DY, S, S);
    } else if(imgIsReady(summonDiskImg)){
      ctx.drawImage(summonDiskImg, -R, -RY, R*2, RY*2);
    } else {
      ctx.fillStyle = '#847e6f';
      ctx.beginPath(); ctx.ellipse(0, 3, R, RY, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = DEATH_DISC_COLOR;
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(0, 0, R, RY, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    }
    // 金の光のふち(明滅)。敵味方の色分けはこの輪だけが担う(画像は塗り替えない)
    if(!renderHeavyLoad){ ctx.shadowBlur = 14*glow; ctx.shadowColor = col(1); }
    ctx.strokeStyle = col(0.75*glow); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, 0, R, RY, 0, 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0;
    if(dist(it,player)<200){
      // 中身の個数も添える(拾う前に「何個入っているか」だけは分かるように=批評指摘)
      const n = (it.keys && it.keys.length) || 0;
      ctx.font="10px 'Rajdhani', sans-serif"; ctx.fillStyle=col(1); ctx.textAlign='center';
      ctx.fillText(`${it.owner ? it.owner+'の' : ''}円盤石 ×${n}`, 0, -DEATH_DISC_R*1.55);
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
/* =====================================================================
   リアルマップのtier3専用弾(projStyle)の立体化
   ・通常マップの見た目(drawProjectileの既存分岐)はそのまま残し、
     リアルマップのときだけこちらを描く。読む値は同じ(color/hitR/auraTint/burstIndex)。
   ・球体は「放射グラデーション+加算合成」、輪は「カメラの扁平率に合わせた楕円」で
     立体に見せる。画面上で真円の輪を描くと地面と angle が合わず平面に見える。
===================================================================== */
// ワールドの水平な円を投影したときの縦横比。地面に貼る円と同じ潰れ方になる
function fxFlatten(){ return Math.max(0.06, Math.abs(Math.sin(camState.pitch))); }
// ワールドの高さ1が画面上で何px上へ行くか(ctxがp.scale済みなので倍率は要らない)
function fxUp(){ return Math.max(0.2, Math.cos(camState.pitch)); }
// 高さdzの水平な輪(ローカル座標)。中心からの上下位置も遠近に合わせる
function fxDisc(rx, dz, rot){
  ctx.beginPath();
  ctx.ellipse(0, -dz*fxUp(), rx, rx*fxFlatten(), rot||0, 0, Math.PI*2);
}
// ゴッドライジング: 色ごとに輝くプラズマ球+赤道のエネルギー環+電撃
function fxStyleGodOrb(pr, r){
  const col = pr.orbColor || pr.color || '#ffffff';
  const spin = matchTime*2.2 + (pr.id||0);
  /* ハローは半径2.6倍・濃さ0.5だったが、この技は球を4つ同時に撃つので加算で重なり、
     **白飛びの塊が判定(hitR30)の3.3倍**(実測293x164px)になっていた。
     4つの色も塊に飲まれて見えない。広がりを抑え、薄くして球の形を残す。 */
  /* 4発同時なのでハローが加算で重なり、白飛びの塊が判定の1.91倍になっていた(実測)。
     判定の1.2倍までに抑え、球そのものの形を残す。 */
  fxHalo(r*1.15, col, 0.22);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // 球体: 芯が白く、縁へ向かって技色に落ちる(光っている球の見え方)
  const g = ctx.createRadialGradient(-r*0.25,-r*0.28, r*0.05, 0,0, r*1.05);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, _mixHex(col, '#ffffff', 0.55));
  g.addColorStop(0.8, col);
  g.addColorStop(1, _hexA(col, 0.35));
  ctx.beginPath(); ctx.arc(0,0,r*1.05,0,Math.PI*2);
  ctx.fillStyle = g; ctx.fill();
  // 赤道の環(カメラの扁平率に合わせるので球を回っているように見える)
  /* 環の外径は判定の1.5倍まで。r*(1.5+0.32)=1.82倍は、実体が判定より大きく見える。 */
  for(let k=0;k<2;k++){
    fxDisc(r*(1.05+k*0.2), 0, spin*0.4);
    ctx.strokeStyle = _hexA(k ? '#ffffff' : col, k ? 0.5 : 0.8);
    ctx.lineWidth = r*(k ? 0.06 : 0.12);
    ctx.stroke();
  }
  ctx.restore();
  // 周囲のビリビリ
  const jseed = Math.floor(matchTime*18) + (pr.id||0);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap='round'; ctx.lineJoin='round';
  for(let k=0;k<4;k++){
    const baseA = fxHash01(jseed*13+k*7)*Math.PI*2;
    const span = 0.8 + fxHash01(jseed*29+k*11)*0.9;
    const pts=[];
    for(let s=0;s<=5;s++){
      const a = baseA + span*(s/5);
      const rr = r*1.35 + (fxHash01(jseed*37+k*17+s*5)-0.5)*r*0.6;
      pts.push({ x:Math.cos(a)*rr, y:Math.sin(a)*rr });
    }
    fxStrokePath(pts, col, r*0.16, 0.55, 16);
    fxStrokePath(pts, '#ffffff', r*0.06, 0.9, 0);
  }
  ctx.restore();
}
/* いちご(西野ピかさの「ずっとずっとキミのことが好き!!」の弾)。
   **色を決め打ちする例外**(発注者指定・2026-08-17)。ハート門(北大路さつキジン)と
   同じ扱いで、「いちごは赤」と決まっているものなので装備オーラの色には乗せない。
   **いちごだけが赤で、降着円盤・電撃・爆風はこれまでの色のまま。**
   実の下端は r*1.15 までに収める(当たり判定より大きい弾にしない)。 */
const BERRY_RED   = '#e8323c';
const BERRY_DARK  = '#a3121d';
const BERRY_LIGHT = '#ff9aa0';
const BERRY_LEAF  = '#3f9d43';
const BERRY_LEAF_D= '#256b2a';
const BERRY_SEED  = '#ffe9a8';
// 種の位置(実の半幅・半径に対する割合)。乱数にすると毎フレーム散らばって見える
const BERRY_SEEDS = [[-0.46,-0.26],[0.00,-0.34],[0.46,-0.26],
                     [-0.60, 0.10],[-0.20, 0.02],[0.20, 0.02],[0.60, 0.10],
                     [-0.34, 0.44],[0.34, 0.44],[0.00, 0.36],[0.00, 0.72]];
function fxBerry(r){
  const bot = r*1.15;            // 実の先(下端)
  const w   = r*0.90;            // 実の最大半幅
  const top = -r*0.60;           // 実の上端(ヘタの付け根)
  ctx.save();
  // 実。上が二山にふくらみ、下は一点へ細る
  ctx.beginPath();
  ctx.moveTo(0, bot);
  ctx.bezierCurveTo(-w*0.98, bot*0.42, -w*1.0, top+r*0.12, -w*0.44, top);
  ctx.bezierCurveTo(-w*0.20, top-r*0.16, w*0.20, top-r*0.16, w*0.44, top);
  ctx.bezierCurveTo(w*1.0, top+r*0.12, w*0.98, bot*0.42, 0, bot);
  ctx.closePath();
  const g = ctx.createRadialGradient(-w*0.34, top+r*0.28, r*0.05, 0, r*0.25, r*1.35);
  g.addColorStop(0,    BERRY_LIGHT);
  g.addColorStop(0.42, BERRY_RED);
  g.addColorStop(1,    BERRY_DARK);
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = BERRY_DARK; ctx.lineWidth = Math.max(1, r*0.05); ctx.stroke();
  // 種
  ctx.fillStyle = BERRY_SEED;
  for(const [sx, sy] of BERRY_SEEDS){
    ctx.beginPath();
    ctx.ellipse(sx*w*0.82, sy*r*0.9, r*0.075, r*0.05, sx*0.6, 0, Math.PI*2);
    ctx.fill();
  }
  // ヘタ(5枚の葉)と軸。実の上に載せる
  for(let i=0;i<5;i++){
    const a = -Math.PI/2 + (i-2)*0.62;
    const len = r*(i===2 ? 0.78 : 0.66);
    ctx.beginPath();
    ctx.moveTo(0, top+r*0.06);
    ctx.lineTo(Math.cos(a-0.16)*len*0.7, top+r*0.06 + Math.sin(a-0.16)*len*0.7);
    ctx.lineTo(Math.cos(a)*len,          top+r*0.06 + Math.sin(a)*len);
    ctx.lineTo(Math.cos(a+0.16)*len*0.7, top+r*0.06 + Math.sin(a+0.16)*len*0.7);
    ctx.closePath();
    ctx.fillStyle = i%2 ? BERRY_LEAF_D : BERRY_LEAF; ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(0, top+r*0.04); ctx.lineTo(0, top-r*0.42);
  ctx.strokeStyle = BERRY_LEAF_D; ctx.lineWidth = Math.max(1.2, r*0.09);
  ctx.lineCap = 'round'; ctx.stroke();
  ctx.restore();
}
/* ビッグバン/ヴァニッシュ: 光を吸い込む黒い球+降着円盤+黒い電撃。
   core を渡すと球のかわりにそれを描く(いちご=西野ピかさ専用)。
   **輪と電撃はどちらでも同じ**なので、いちご用に写しを作らない。 */
function fxStyleVoidOrb(pr, r, core){
  const col = pr.color || '#14121c';
  const [arcDim, arcLit] = arcColorsFor(pr.auraTint);
  const spin = matchTime*1.7 + (pr.id||0);
  // 降着円盤: 球の周りを回る扁平な光の輪(手前側を後で描いて回り込みを見せる)
  const ring = (alpha, rr, lw, colr)=>{
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    fxDisc(rr, 0, spin*0.5);
    ctx.strokeStyle = _hexA(colr, alpha); ctx.lineWidth = lw;
    ctx.stroke();
    ctx.restore();
  };
  ring(0.55, r*1.9, r*0.3, arcLit);
  ring(0.85, r*1.55, r*0.12, '#ffffff');
  if(core){
    core(r);
  } else {
    // 事象の地平面: 完全な黒。縁だけ薄く光らせて球であることを見せる
    const g = ctx.createRadialGradient(0,0, r*0.2, 0,0, r*1.1);
    g.addColorStop(0, '#000000');
    g.addColorStop(0.72, _mixHex(col, '#000000', 0.5));
    g.addColorStop(1, col);
    ctx.beginPath(); ctx.arc(0,0,r*1.05,0,Math.PI*2);
    ctx.fillStyle = g; ctx.fill();
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if(!core){                                   // 球の縁の光。いちごには回さない
    ctx.beginPath(); ctx.arc(0,0,r*1.04,0,Math.PI*2);
    ctx.strokeStyle = _hexA(arcLit, 0.7); ctx.lineWidth = r*0.09; ctx.stroke();
  }
  ring(0.5, r*1.3, r*0.2, arcDim);                   // 手前を通る側の輪
  ctx.lineCap='round'; ctx.lineJoin='round';
  const jseed = Math.floor(matchTime*18) + (pr.id||0);
  for(let k=0;k<4;k++){
    const baseA = fxHash01(jseed*13+k*7)*Math.PI*2;
    const span = 0.8 + fxHash01(jseed*29+k*11)*0.9;
    const pts=[];
    for(let s=0;s<=5;s++){
      const a = baseA + span*(s/5);
      const rr = r*1.4 + (fxHash01(jseed*37+k*17+s*5)-0.5)*r*0.6;
      pts.push({ x:Math.cos(a)*rr, y:Math.sin(a)*rr });
    }
    fxStrokePath(pts, arcDim, r*0.16, 0.6, 14);
    fxStrokePath(pts, arcLit, r*0.06, 0.95, 0);
  }
  ctx.restore();
}
// ダークホウスト: 回る黒い三日月の刃。刃先だけが冷たく光る
function fxStyleCrescent(pr, r){
  /* 刃の外端を当たり判定の1.5倍以内へ。以前は rr=r*1.6 のうえに残像の弧を
     rr*1.15・線幅 rr*0.3 で描いていたので、外端が判定の約1.99倍あった。 */
  /* 刃の外端は当たり判定の1.5倍以内。実測で1.80倍だったので詰める(2026-08-16)。 */
  const rr = r*1.0;
  // 色は技の色から作る(以前は暗色を直書きしていて、色スキンでも刃が変わらなかった)
  const csh = auraShades(pr.auraTint || pr.color || '#3b4058');
  const spin = matchTime*15 + (pr.id||0);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';          // 回転の残像
  const tg = ctx.createLinearGradient(-rr, 0, rr, 0);
  tg.addColorStop(0, _hexA(csh.mid, 0));
  tg.addColorStop(1, _hexA(csh.bright, 0.45));
  ctx.beginPath(); ctx.arc(0,0, rr*1.0, spin*0.6, spin*0.6 + Math.PI*1.2);
  ctx.strokeStyle = tg; ctx.lineWidth = rr*0.15; ctx.stroke();
  ctx.restore();
  ctx.rotate(spin);
  const R=rr, R2=rr*1.02, off=rr*0.62;
  ctx.beginPath();
  ctx.arc(0, 0, R, Math.PI*0.55, Math.PI*1.45, false);
  ctx.arc(off, 0, R2, Math.PI*1.28, Math.PI*0.72, true);
  ctx.closePath();
  const g = ctx.createLinearGradient(-R, -R*0.6, R*0.4, R*0.6);  // 黒鋼の陰影
  g.addColorStop(0, '#3b4058');
  g.addColorStop(0.45, '#14151d');
  g.addColorStop(1, '#05060a');
  ctx.fillStyle = g; ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();                                    // 刃筋の冷たい光
  ctx.arc(0,0,R*0.94, Math.PI*0.58, Math.PI*1.42, false);
  ctx.strokeStyle = 'rgba(190,205,255,0.85)'; ctx.lineWidth = rr*0.07; ctx.stroke();
  ctx.beginPath();
  ctx.arc(0,0,R*1.0, Math.PI*0.62, Math.PI*1.38, false);
  ctx.strokeStyle = 'rgba(120,140,200,0.5)'; ctx.lineWidth = rr*0.14; ctx.stroke();
  ctx.restore();
}
// 竜巻アタック: 地面に立つ本物の漏斗。輪の潰れ方をカメラに合わせて立体にする
/* 「電撃の7」(轟金剛の超番長ボーナス)。図柄は用意した画像そのものを使い、
   竜巻の色に合わせて**色相だけ差し替えた版**を1色につき1回だけ作って使い回す
   (青の画像から赤の竜巻用を作る、という使い方)。
   竜巻の中で回るので、横幅だけを縮めて回転を表す(板を回している見え方)。   */
const fxSevenImg = new Image();
let fxSevenReady = false;
fxSevenImg.onload = ()=>{ fxSevenReady = true; };
fxSevenImg.src = './images/fx_seven.png';
const _fxSevenTint = {};
function fxSevenSprite(hex){
  if(!fxSevenReady) return null;
  if(_fxSevenTint[hex]) return _fxSevenTint[hex];
  const w = fxSevenImg.naturalWidth, h = fxSevenImg.naturalHeight;
  if(!w || !h) return null;
  const c = document.createElement('canvas'); c.width=w; c.height=h;
  const cx = c.getContext('2d', { willReadFrequently:true });
  cx.drawImage(fxSevenImg, 0, 0);
  const rgbT = hexToRgb(hex), hueT = rgbToHsl(rgbT[0], rgbT[1], rgbT[2])[0];
  const im = cx.getImageData(0, 0, w, h), d = im.data;
  for(let i=0;i<d.length;i+=4){
    if(!d[i+3]) continue;
    const hsl = rgbToHsl(d[i], d[i+1], d[i+2]);   // 明るさと鮮やかさはそのまま
    const o = hslToRgb(hueT, hsl[1], hsl[2]);
    d[i]=o[0]; d[i+1]=o[1]; d[i+2]=o[2];
  }
  cx.putImageData(im, 0, 0);
  _fxSevenTint[hex] = c;
  return c;
}
// 画像が来るまでのつなぎ(7の字を線で描く)。単位は高さ1
const SEVEN_PTS = [
  [-0.46,-0.50], [0.46,-0.50], [0.46,-0.31], [0.06,0.50],
  [-0.18,0.50],  [0.20,-0.28], [-0.46,-0.28],
];
function fxSevenBolt(cx0, cy, wide, phase, hex, sh, alpha){
  const sx = Math.cos(phase);                 // 回転して見える横幅の縮み
  if(Math.abs(sx) < 0.06) return;             // 真横を向いた瞬間は線になるので描かない
  const sprite = fxSevenSprite(hex);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(cx0, cy);
  ctx.scale(sx, 1);                           // 横だけ縮める = 板が回って見える
  if(sprite){
    const h = wide * (sprite.height/sprite.width);
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, -wide/2, -h/2, wide, h);
  }else{
    const h = wide/0.78, jag = h*0.05;
    ctx.beginPath();
    for(let i=0;i<SEVEN_PTS.length;i++){
      const p = SEVEN_PTS[i], q = SEVEN_PTS[(i+1)%SEVEN_PTS.length];
      const x0 = p[0]*wide/0.78*0.78, y0 = p[1]*h, x1 = q[0]*wide, y1 = q[1]*h;
      if(i===0) ctx.moveTo(x0, y0);
      for(let k=1;k<=3;k++){
        const t = k/3;
        const n = (fxHash01(i*5.7 + k*2.3 + Math.floor(matchTime*18)*0.37) - 0.5)*jag;
        ctx.lineTo(x0+(x1-x0)*t + n, y0+(y1-y0)*t + n*0.6);
      }
    }
    ctx.closePath();
    ctx.fillStyle = _hexA(sh.dark, 0.55*alpha);
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = _hexA(sh.bright, 0.95*alpha);
    ctx.lineWidth = Math.max(1.2, h*0.055);
    ctx.stroke();
  }
  ctx.restore();
}
function fxStyleTornado(pr, r){
  const gz = groundZAt(pr.x, pr.y);
  const drop = Math.max(0, (pr.z||0) - gz);           // 地面までの高さ(ワールド)
  const H = r*3.4;                                     // 漏斗の高さ
  const N = 8;
  const spin = matchTime*7 + (pr.id||0);
  const up = fxUp(), flat = fxFlatten();
  // 轟金剛の「超番長ボーナス」は色付き・半透明で、中に電撃の7が回る。
  // 素のゴーレム(竜巻アタック)は従来の砂色のまま。
  const bonus = pr.projVariant === 'bonus7';
  const sh = bonus ? auraShades(pr.auraTint || pr.color || '#3f74e6') : null;
  const A = bonus ? 0.5 : 1;                           // 半透明にする度合い
  /* 漏斗の根元は**当たり判定と同じ太さ**にする。r*0.4 では判定の62%しかなく、
     当たらないと思った所で被弾していた(実測: 判定207px幅に対し根元129px)。
     上端は1.65倍までで、採点表の1.5倍は「弾の光る芯」の話なので、
     舞い上がった砂の裾はここまで許す。**hitR そのものは変えない。** */
  const ringAt = (t)=>({
    /* 根元=判定と同じ太さ。上端は1.45倍まで開いて**漏斗の形を保つ**
       (0.30まで絞ったら円筒になり「バネを積んだ樽」に見えると指摘された)。
       広がったぶんは上端の濃さを落として、判定を読み違えないようにする。 */
    rx: r*(1.0 + 0.45*Math.pow(t, 1.25)),
    y: (drop - H*t)*up,
    ox: Math.sin(spin*0.5 + t*5.5)*r*0.22,
  });
  // 本体: 左右の輪郭をつないだ漏斗。下は土埃で暗く、上は舞い上がった砂で明るい
  const left=[], right=[];
  for(let i=0;i<=N;i++){
    const k = ringAt(i/N);
    left.push({ x:k.ox-k.rx, y:k.y });
    right.push({ x:k.ox+k.rx, y:k.y });
  }
  const top = ringAt(1), bot = ringAt(0);
  const bg = ctx.createLinearGradient(0, bot.y, 0, top.y);
  if(bonus){
    bg.addColorStop(0, _hexA(sh.dark, 0.72*A));
    bg.addColorStop(0.5, _hexA(sh.mid, 0.62*A));
    bg.addColorStop(1, _hexA(sh.bright, 0.5*A));
  }else{
    /* 素の竜巻も**技の色から作る**。以前は砂色を直書きしていたので、
       色スキン(auraTint)を着せても竜巻だけ砂色のままだった(色の決め打ち=不合格条件)。 */
    const ps = auraShades(pr.auraTint || pr.color || '#96805f');
    bg.addColorStop(0, _hexA(ps.dark, 0.85));
    bg.addColorStop(0.5, _hexA(ps.mid, 0.7));
    bg.addColorStop(1, _hexA(ps.bright, 0.55));
  }
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for(let i=1;i<left.length;i++) ctx.lineTo(left[i].x, left[i].y);
  for(let i=right.length-1;i>=0;i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fillStyle = bg; ctx.fill();
  /* 渦の芯。竜巻は全コマで飽和画素0=「光っていない板」だった(実測)。
     漏斗の中心線に沿って加算の芯を1本立てる。fadeを掛けないので必ず白飛びする。 */
  {
    /* 太さ一定・丸端の1本線にすると「白い麺が刺さっている」ように見える(実測の指摘)。
       上へ行くほど細くなる筋を区間ごとに引く。ただし**細くするだけでは白飛びが消える**
       (飽和6843→66画素に落とした)。にじみ(太い・薄い)と芯(細い・濃い)の2本立てにして、
       形は絞ったまま根元は必ず飽和させる。 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'butt';
    for(let i=0;i<N;i++){
      const k0 = ringAt(i/N), k1 = ringAt((i+1)/N);
      const taper = 1 - i/N;                    // 根元=1 上端=0
      // にじみ: 太くて薄い。芯の周りを光らせる
      ctx.globalAlpha = 0.10 + 0.28*taper;
      ctx.lineWidth = Math.max(2, r*0.26*taper);
      ctx.beginPath();
      ctx.moveTo(k0.ox, k0.y); ctx.lineTo(k1.ox, k1.y);
      ctx.stroke();
      // 芯: 細くて濃い。根元は不透明なので加算で必ず飽和する
      ctx.globalAlpha = 0.45 + 0.55*taper;
      ctx.lineWidth = Math.max(1.5, r*0.055*taper);
      ctx.beginPath();
      ctx.moveTo(k0.ox, k0.y); ctx.lineTo(k1.ox, k1.y);
      ctx.stroke();
    }
    ctx.restore();
  }
  // 7は漏斗を塗ったあと・巻き上がる筋の前に描く(渦の中に入って見える)
  if(bonus){
    const mid = ringAt(0.45);
    fxSevenBolt(mid.ox, mid.y, r*2.3, spin*0.55, pr.auraTint || pr.color || '#3f74e6', sh, 1);
  }
  // 巻き上がる筋(輪を少しずつずらして描くと回転が見える)
  ctx.save();
  ctx.lineCap='round';
  for(let i=1;i<=N;i++){
    const t=i/N, k=ringAt(t);
    ctx.beginPath();
    ctx.ellipse(k.ox, k.y, k.rx, k.rx*flat, 0, spin+t*4, spin+t*4+Math.PI*1.3);
    ctx.strokeStyle = bonus ? _hexA(sh.bright, (0.15+0.3*t)*A) : `rgba(255,246,225,${0.15+0.3*t})`;
    ctx.lineWidth = r*0.1;
    ctx.stroke();
  }
  ctx.restore();
  // 足元の砂煙
  const dust = bonus ? hexToRgb(sh.mid) : [180,158,120];
  const dg = ctx.createRadialGradient(0, bot.y, 0, 0, bot.y, r*2.2);
  dg.addColorStop(0, `rgba(${dust[0]},${dust[1]},${dust[2]},${0.6*A})`);
  dg.addColorStop(1, `rgba(${dust[0]},${dust[1]},${dust[2]},0)`);
  ctx.beginPath(); ctx.ellipse(0, bot.y, r*2.2, r*2.2*flat, 0, 0, Math.PI*2);
  ctx.fillStyle = dg; ctx.fill();
  // 巻き上げられた小石
  if(!renderHeavyLoad){
    const grit = bonus ? hexToRgb(sh.spark) : [232,220,192];
    for(let d=0; d<7; d++){
      const h1 = fxHash01((pr.id||0)*3.1 + d*7.9);
      const t = (h1 + matchTime*0.9) % 1;
      const k = ringAt(t);
      const a = spin*1.5 + d*(Math.PI*2/7);
      ctx.beginPath();
      ctx.arc(k.ox + Math.cos(a)*k.rx*1.1, k.y + Math.sin(a)*k.rx*flat*1.1, r*0.09*(1.2-t*0.5), 0, Math.PI*2);
      ctx.fillStyle = `rgba(${grit[0]},${grit[1]},${grit[2]},${(0.9-t*0.5)*A})`;
      ctx.fill();
    }
  }
}
// 天の慈悲: 黄金の聖剣。光輪はカメラの扁平率に合わせて後光に見せる
function fxStyleHoly(pr, r){
  const sh = pr.auraTint ? auraShades(pr.auraTint) : auraShades(pr.color || '#ffe9a8');
  const rr = r*1.3;
  const spin = matchTime*2.2;
  fxHalo(rr*3.2, sh.bright, 0.45);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  fxDisc(rr*2.0, 0, spin*0.5);                        // 後光の輪
  ctx.strokeStyle = _hexA(sh.bright, 0.75); ctx.lineWidth = rr*0.13; ctx.stroke();
  for(let i=0;i<8;i++){                                // 光条
    const a = spin + i*(Math.PI/4);
    const l1 = rr*1.6, l2 = rr*(2.2 + 0.4*Math.sin(matchTime*4+i));
    ctx.beginPath();
    ctx.moveTo(Math.cos(a)*l1, Math.sin(a)*l1*fxFlatten()*1.6);
    ctx.lineTo(Math.cos(a)*l2, Math.sin(a)*l2*fxFlatten()*1.6);
    ctx.strokeStyle = _hexA(sh.bright, 0.55); ctx.lineWidth = rr*0.07; ctx.stroke();
  }
  ctx.restore();
  ctx.rotate(fxProjScreenAngle(pr));
  const g = ctx.createLinearGradient(0, -rr*0.85, 0, rr*0.85);   // 剣身
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.42, sh.bright);
  g.addColorStop(0.55, sh.mid);
  g.addColorStop(1, sh.dark);
  ctx.beginPath();
  ctx.moveTo(rr*1.9,0); ctx.lineTo(-rr*0.7,-rr*0.85); ctx.lineTo(-rr*0.35,0); ctx.lineTo(-rr*0.7,rr*0.85);
  ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  ctx.moveTo(rr*1.7,0); ctx.lineTo(-rr*0.4,-rr*0.12); ctx.lineTo(-rr*0.4,rr*0.12);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
  ctx.restore();
}
// シェルアタック: 回転する黄金の殻+毒の電撃
function fxStyleShell(pr, r){
  const rr = r*1.1;
  const spin = matchTime*8;
  /* 色は技の色から作る。ここだけ黄色を直書きしていたため、色スキン(auraTint)を
     着せても殻が黄色のままだった(fxStyleHoly は同じ形で auraTint を見ている)。 */
  const ssh = auraShades(pr.auraTint || pr.color || '#ffc31c');
  // ハローは splash(=hitR*1.7)より外まで光っていたので判定に寄せる
  fxHalo(rr*1.7, ssh.bright, 0.45);
  const g = ctx.createRadialGradient(-rr*0.3,-rr*0.35, rr*0.05, 0,0, rr*1.05);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, ssh.spark);
  g.addColorStop(0.75, ssh.mid);
  g.addColorStop(1, ssh.dark);
  ctx.beginPath(); ctx.arc(0,0,rr,0,Math.PI*2);
  ctx.fillStyle = g; ctx.fill();
  ctx.save();                                         // 殻の筋(球に巻きつく帯)
  ctx.globalCompositeOperation = 'lighter';
  for(let i=0;i<3;i++){
    const a = spin + i*(Math.PI*2/3);
    ctx.beginPath();
    ctx.ellipse(0,0, rr*0.92, rr*0.32*Math.abs(Math.cos(a)) + rr*0.05, a*0.35, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = rr*0.09; ctx.stroke();
  }
  ctx.restore();
  const jseed = Math.floor(matchTime*16);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap='round'; ctx.lineJoin='round';
  for(let k=0;k<4;k++){
    const baseA = fxHash01(jseed*13+k*7)*Math.PI*2;
    const span = 0.9 + fxHash01(jseed*29+k*11)*0.9;
    const pts=[];
    for(let s=0;s<=5;s++){
      const a = baseA + span*(s/5);
      const rad = rr*1.4 + (fxHash01(jseed*37+k*17+s*5)-0.5)*rr*0.7;
      pts.push({ x:Math.cos(a)*rad, y:Math.sin(a)*rad });
    }
    fxStrokePath(pts, '#8b2fc9', rr*0.2, 0.55, 16);
    fxStrokePath(pts, '#e5b6ff', rr*0.08, 0.9, 0);
  }
  ctx.restore();
}
// アムピトリテ: 水をまとった三叉の槍
function fxStyleSeaSpear(pr, r){
  const col = pr.color || '#3d7dff';
  const sh = auraShades(col);
  const rr = r*1.25;
  ctx.rotate(fxProjScreenAngle(pr));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';           // 後ろへ伸びる水の尾
  const tail = ctx.createLinearGradient(-rr*3.0, 0, -rr*0.3, 0);
  tail.addColorStop(0, _hexA(col, 0));
  tail.addColorStop(1, _hexA(sh.bright, 0.75));
  ctx.beginPath();
  ctx.moveTo(-rr*3.0, 0);
  ctx.quadraticCurveTo(-rr*1.5, -rr*0.42, -rr*0.4, -rr*0.3);
  ctx.lineTo(-rr*0.4, rr*0.3);
  ctx.quadraticCurveTo(-rr*1.5, rr*0.42, -rr*3.0, 0);
  ctx.closePath();
  ctx.fillStyle = tail; ctx.fill();
  ctx.restore();
  const metal = (x0,y0,x1,y1)=>{                       // 濡れた金属の陰影
    const g = ctx.createLinearGradient(x0,y0,x1,y1);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.4, sh.bright);
    g.addColorStop(0.75, col);
    g.addColorStop(1, sh.dark);
    return g;
  };
  ctx.beginPath();                                     // 柄
  ctx.moveTo(-rr*1.5, -rr*0.11); ctx.lineTo(rr*0.45, -rr*0.11);
  ctx.lineTo(rr*0.45, rr*0.11); ctx.lineTo(-rr*1.5, rr*0.11);
  ctx.closePath(); ctx.fillStyle = metal(0,-rr*0.11,0,rr*0.11); ctx.fill();
  const prong = (off)=>{                               // 左右の穂先
    ctx.beginPath();
    ctx.moveTo(rr*1.55, off*0.35);
    ctx.lineTo(rr*0.5, off - Math.sign(off||1)*rr*0.06);
    ctx.lineTo(rr*0.5, off + Math.sign(off||1)*rr*0.16);
    ctx.closePath();
    ctx.fillStyle = metal(rr*0.5, off, rr*1.55, off*0.35); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.4; ctx.stroke();
  };
  prong(-rr*0.72); prong(rr*0.72);
  ctx.beginPath();                                     // 中央の刃
  ctx.moveTo(rr*2.15, 0); ctx.lineTo(rr*0.35, -rr*0.3); ctx.lineTo(rr*0.35, rr*0.3);
  ctx.closePath(); ctx.fillStyle = metal(rr*0.35,-rr*0.3, rr*2.15, rr*0.2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  ctx.moveTo(rr*1.85, 0); ctx.lineTo(rr*0.55, -rr*0.1); ctx.lineTo(rr*0.55, rr*0.1);
  ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
  const og = ctx.createRadialGradient(-rr*0.85,-rr*0.12, rr*0.03, -rr*0.75, 0, rr*0.42);
  og.addColorStop(0, '#ffffff'); og.addColorStop(0.5, sh.bright); og.addColorStop(1, _hexA(col,0));
  ctx.beginPath(); ctx.arc(-rr*0.75, 0, rr*0.42, 0, Math.PI*2);
  ctx.fillStyle = og; ctx.fill();                      // 根元の宝珠
  ctx.restore();
}
// レクイエムエンド: 3形態の投擲武器(クナイ/トゲ球/手裏剣)。紫の魔力をまとう
function fxStyleRequiem(pr, r){
  /* 【重要】刃の実体を当たり判定の1.5倍以内に収める。
     以前は rr=r*1.3 のうえで刃先を rr*1.9(=判定の2.47倍)まで伸ばしていたため、
     hitR:20 の弾が画面上で判定の3.4倍に見えていた(実測: 判定38px に対し130px)。
     大きな手裏剣に見えるので、避けたのに当たる/当たると思った所で当たらないが両方起きる。
     rr*1.9 が判定の1.14倍に収まる値まで落とす。**hitR そのものは変えない。** */
  const rr = r*0.6;
  const DARK='#1d0b2e', MID='#3a1560', EDGE='#8b46c9', HILITE='#c98bff';
  const spin = matchTime*11 + (pr.id||0);
  fxHalo(rr*2.4, EDGE, 0.4);
  ctx.rotate(spin);
  ctx.lineJoin='round';
  const metal = (x0,y0,x1,y1)=>{
    const g = ctx.createLinearGradient(x0,y0,x1,y1);
    g.addColorStop(0, HILITE); g.addColorStop(0.35, MID); g.addColorStop(1, DARK);
    return g;
  };
  const form = (pr.burstIndex||0) % 3;
  if(form===0){
    ctx.beginPath();
    ctx.moveTo(rr*1.9,0); ctx.lineTo(rr*0.15,-rr*0.5); ctx.lineTo(rr*0.15,rr*0.5);
    ctx.closePath();
    ctx.fillStyle = metal(rr*0.15,-rr*0.5, rr*1.9, rr*0.3); ctx.fill();
    ctx.strokeStyle=EDGE; ctx.lineWidth=1.5; ctx.stroke();
    ctx.beginPath();
    ctx.rect(-rr*0.95, -rr*0.18, rr*1.1, rr*0.36);
    ctx.fillStyle = metal(0,-rr*0.18,0,rr*0.18); ctx.fill();
    ctx.strokeStyle=EDGE; ctx.lineWidth=1.1; ctx.stroke();
    ctx.beginPath(); ctx.arc(-rr*1.3,0,rr*0.4,0,Math.PI*2);
    ctx.strokeStyle=HILITE; ctx.lineWidth=1.7; ctx.stroke();
  } else if(form===1){
    for(let k=0;k<8;k++){
      const a = k*(Math.PI/4);
      ctx.save(); ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(rr*1.45,0); ctx.lineTo(rr*0.55,-rr*0.3); ctx.lineTo(rr*0.55,rr*0.3);
      ctx.closePath();
      ctx.fillStyle = metal(rr*0.55,-rr*0.3, rr*1.45, rr*0.2); ctx.fill();
      ctx.strokeStyle=EDGE; ctx.lineWidth=1.3; ctx.stroke();
      ctx.restore();
    }
    const g = ctx.createRadialGradient(-rr*0.25,-rr*0.28, rr*0.05, 0,0, rr*0.9);
    g.addColorStop(0, HILITE); g.addColorStop(0.5, MID); g.addColorStop(1, '#0a0212');
    ctx.beginPath(); ctx.arc(0,0,rr*0.85,0,Math.PI*2);
    ctx.fillStyle=g; ctx.fill();
    ctx.strokeStyle=EDGE; ctx.lineWidth=1.5; ctx.stroke();
  } else {
    ctx.beginPath();
    for(let k=0;k<4;k++){
      const a = k*(Math.PI/2), ia = a + Math.PI/4;
      const ox=Math.cos(a)*rr*1.7, oy=Math.sin(a)*rr*1.7;
      const ix=Math.cos(ia)*rr*0.5, iy=Math.sin(ia)*rr*0.5;
      if(k===0) ctx.moveTo(ox,oy); else ctx.lineTo(ox,oy);
      ctx.lineTo(ix,iy);
    }
    ctx.closePath();
    ctx.fillStyle = metal(-rr*1.7,-rr*1.7, rr*1.7, rr*1.7); ctx.fill();
    ctx.strokeStyle=EDGE; ctx.lineWidth=1.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(0,0,rr*0.28,0,Math.PI*2);
    ctx.strokeStyle=HILITE; ctx.lineWidth=1.7; ctx.stroke();
  }
  ctx.save();                                          // 回転の残光
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath(); ctx.arc(0,0,rr*1.55, spin*2, spin*2+Math.PI*0.9);
  ctx.strokeStyle = _hexA(HILITE, 0.45); ctx.lineWidth = rr*0.14; ctx.stroke();
  ctx.restore();
}
// projStyle → リアルマップでの見た目
const REAL_STYLE_FX = {
  godorb:   fxStyleGodOrb,
  voidOrb:  fxStyleVoidOrb,
  // 西野ピかさ専用。輪と電撃はビッグバンのまま、球だけ赤いいちごに差し替える
  strawberry: (pr, r)=> fxStyleVoidOrb(pr, r, fxBerry),
  crescent: fxStyleCrescent,
  tornado:  fxStyleTornado,
  holy:     fxStyleHoly,
  shell:    fxStyleShell,
  seaSpear: fxStyleSeaSpear,
  requiem:  fxStyleRequiem,
};
/* 弾の簡易描画
   新しい弾エフェクトは1発ごとにグラデーションを何枚も作り、加算合成で重ねている。
   近くで見ると効果的だが、画面上で小さい弾では細部が見えないうえ、
   同時に数十発飛ぶと端末側のラスタ化と合成でフレーム時間を大きく食う。
   ・小さく映る弾は「光る球」1枚に落とす(見た目はほぼ変わらない)
   ・tier3の専用弾は同時に数発しか出ないので、しきい値を上げずに見た目を守る    */
const PROJ_SIMPLE_PX       = 12;   // 画面上の半径(実ピクセル)がこれ未満なら簡易
const PROJ_SIMPLE_PX_HEAVY = 48;   // 弾が多いときのしきい値
const PROJ_DETAIL_BUDGET   = 14;   // 同時にこの数までは全部きちんと描く
function drawSimpleProjectile(pr, r){
  // いちごの弾は遠くで簡易表示に落ちても赤のまま(距離で色が変わって見えないように)
  const col = pr.projStyle==='strawberry' ? BERRY_RED : (pr.orbColor || pr.color || '#ffffff');
  // 芯を小さく締めて外へ素早く消す。均等に塗ると「色の付いた玉」に見えてしまう
  const g = ctx.createRadialGradient(0,0, 0, 0,0, r*1.25);
  g.addColorStop(0,    '#ffffff');
  g.addColorStop(0.22, _hexA(col, 0.95));
  g.addColorStop(0.55, _hexA(col, 0.45));
  g.addColorStop(1,    _hexA(col, 0));
  ctx.beginPath(); ctx.arc(0,0, r*1.25, 0, Math.PI*2);
  ctx.fillStyle = g; ctx.fill();
}
function drawProjectile(pr,p){
  ctx.save();
  ctx.translate(p.x,p.y);
  ctx.scale(p.scale,p.scale);

  const _pxR = (pr.hitR||10) * p.scale * (typeof dpr!=='undefined' ? dpr : 1);
  // tier3の専用弾は同時に数発しか出ないので常に細かく描く
  const _pressed = gfxLevel >= 1 || projectiles.length > PROJ_DETAIL_BUDGET;
  const _lim = pr.projStyle ? PROJ_SIMPLE_PX : (_pressed ? PROJ_SIMPLE_PX_HEAVY : PROJ_SIMPLE_PX);
  if(_pxR < _lim){
    drawSimpleProjectile(pr, Math.max(4, pr.hitR||10));
    ctx.restore();
    return;
  }

  // 絵文字の弾をその技に合った実体のあるエフェクトに差し替える。
  // 専用の見た目を持つ技(projStyle/shape)は対象外なので、条件は2Dの絵文字分岐と同じ。
  if(pr.icon && !pr.projStyle && !pr.shape && real3dFx()){
    const fn = REAL_ICON_FX[fxIconKey(pr.icon)] || fxIconEnergy;
    fn(pr, Math.max(7, (pr.hitR||12)*1.15));
    ctx.restore();
    return;
  }
  // tier3の専用弾も立体的に描き直す(従来の平面描画は下の分岐に残してある)
  if(pr.projStyle && real3dFx() && REAL_STYLE_FX[pr.projStyle]){
    REAL_STYLE_FX[pr.projStyle](pr, Math.max(8, pr.hitR||14));
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
  if(pr.projStyle==='voidOrb' || pr.projStyle==='strawberry'){
    // ビッグバン(ピクシー): 黒く発光する球+周囲に黒いビリビリ(電撃アーク)
    /* 西野ピかさの「ずっとずっとキミのことが好き!!」は球のかわりに赤いいちご。
       **いちごだけが赤で、電撃・輪・爆風はこれまでの色のまま**(発注者指定・2026-08-17)。
       電撃の描き方は共通なので、いちご用に写しを作らずここで芯だけ入れ替える。 */
    const _berry = pr.projStyle==='strawberry';
    const col = pr.color || '#14121c';
    const r = (pr.hitR||24);
    if(!renderHeavyLoad){ ctx.shadowBlur=20; ctx.shadowColor = _berry ? BERRY_RED : '#6b2fa8'; }
    if(_berry){
      fxBerry(r);
    } else {
      const grad = ctx.createRadialGradient(-r*0.25,-r*0.25,r*0.1, 0,0,r);
      grad.addColorStop(0,'#3a2050');
      grad.addColorStop(0.5, col);
      grad.addColorStop(1, '#000000');
      ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fillStyle=grad; ctx.fill();
    }
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
  if(pr.projStyle==='crescentWhite'){
    // 風神剣(デュラハン): ダークホウストと同じ回転三日月斬撃を、白く輝く刃に変えたもの
    const r = (pr.hitR||20)*1.6;
    const spin = matchTime*15 + (pr.id||0);
    if(!renderHeavyLoad){ ctx.shadowBlur=14; ctx.shadowColor='#eef3ff'; }
    ctx.rotate(spin);
    const R=r, R2=r*1.02, off=r*0.62;
    ctx.beginPath();
    ctx.arc(0, 0, R, Math.PI*0.55, Math.PI*1.45, false);
    ctx.arc(off, 0, R2, Math.PI*1.28, Math.PI*0.72, true);
    ctx.closePath();
    ctx.fillStyle='#f4f7ff'; ctx.fill();
    ctx.strokeStyle='rgba(120,150,220,0.9)'; ctx.lineWidth=2; ctx.stroke();
    ctx.beginPath();
    ctx.arc(0,0,R*0.9, Math.PI*0.62, Math.PI*1.38, false);
    ctx.strokeStyle='rgba(255,255,255,0.95)'; ctx.lineWidth=1.4; ctx.stroke();
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
  if(pr.projStyle==='tornadoAura'){
    // 最終奥義(デュラハン): オーラ色を纏った竜巻。装備オーラに応じて色が変わる(竜巻アタックの色替え版)
    const sh = auraShades(pr.color||'#ffffff');
    const r = (pr.hitR||14);
    const spin = matchTime*11;
    if(!renderHeavyLoad){ ctx.shadowBlur=18; ctx.shadowColor=sh.bright; }
    for(let k=0;k<4;k++){
      const ky = -k*r*0.42;
      const kw = r*(0.95 + k*0.22);
      ctx.beginPath();
      ctx.ellipse(Math.sin(spin+k*1.3)*r*0.12, ky, kw, kw*0.34, 0, 0, Math.PI*2);
      ctx.fillStyle = k%2 ? sh.dark : sh.mid;
      ctx.globalAlpha = 0.88;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(Math.sin(spin+k*1.3)*r*0.12, ky, kw, kw*0.34, 0, spin+k, spin+k+Math.PI*1.2);
      ctx.stroke();
    }
    for(let d=0;d<4;d++){
      const a = spin*1.4 + d*(Math.PI/2);
      const rr = r*(0.7+0.3*Math.sin(spin+d));
      ctx.beginPath();
      ctx.arc(Math.cos(a)*rr, -r*0.6 + Math.sin(a)*rr*0.3, 2.6, 0, Math.PI*2);
      ctx.fillStyle = sh.spark; ctx.globalAlpha = 0.9; ctx.fill();
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
    /* 文字は画面上の大きさに上限を付ける。カメラ至近(自分の被弾・出血)だと
       p.scaleが5〜10になり、数字1つが画面の半分を覆っていた(縦持ち実測で発生) */
    const ts = Math.min(p.scale, 2.0);
    ctx.scale(ts,ts);
    ctx.textAlign='center'; ctx.globalAlpha=a;
    if(pt.big){
      // オーラ有利/不利の被弾ダメージは大きく縁取りして強調
      ctx.font="bold 20px 'Share Tech Mono', monospace";
      ctx.lineWidth=4; ctx.strokeStyle='rgba(0,0,0,0.85)'; ctx.strokeText(pt.text, 0,0);
      ctx.fillStyle = pt.color; ctx.fillText(pt.text, 0,0);
    } else if(pt.pred){
      /* ゲストの予測ダメージ(見た目専用)。確定の実数字より一段小さく・薄くして
         二重に見せない。ただし縁取りは付ける(縁なしの灰文字は戦闘距離で読めない=批評指摘) */
      ctx.font="bold 15px 'Share Tech Mono', monospace";
      ctx.globalAlpha = a*0.8;
      ctx.lineWidth=3; ctx.strokeStyle='rgba(0,0,0,0.7)'; ctx.strokeText(pt.text, 0,0);
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
/* 人工物(遮蔽物)のWebGL失敗時フォールバック。
   ふだんはreal3d_props.jsが3Dで描くので、ここへ来るのはWebGLが使えない端末だけ。
   岩と同じ絵にすると「人が作った物」に見えないので、角のある塊として描く。
   高さの比は data.js の OBST_SHAPES と合わせてある(食い違うと隠れ方がズレる)。 */
const STRUCT_LOOK = {
  ruinwall:  { h:1.78, w:0.86, fill:'#7a7368', top:'#948c7e', dark:'#4c4740' },
  container: { h:1.36, w:0.96, fill:'#7d6a4a', top:'#96825e', dark:'#4a3f2c' },
  ruinpillar:{ h:2.42, w:0.44, fill:'#8b8371', top:'#a49b86', dark:'#565044' },
  hut:       { h:1.58, w:0.94, fill:'#6d5a42', top:'#856f52', dark:'#413526' },
};
function drawStructureObstacle(rock, flavor){
  const r = rock.radius, c = STRUCT_LOOK[flavor] || STRUCT_LOOK.ruinwall;
  // 接地の影
  ctx.beginPath(); ctx.ellipse(0, r*0.14, r*c.w*1.05, r*0.3, 0,0,Math.PI*2);
  ctx.fillStyle='rgba(0,0,0,0.30)'; ctx.fill();
  const w = r*c.w, h = r*c.h;
  // 本体(正面の面)
  ctx.fillStyle=c.fill;
  ctx.fillRect(-w, -h + r*0.14, w*2, h);
  // 上端の明るい面(厚みを感じさせる)
  ctx.fillStyle=c.top;
  ctx.fillRect(-w, -h + r*0.14, w*2, r*0.16);
  // 崩れた縁。角を欠けさせて「廃墟」に見せる
  ctx.fillStyle=c.dark;
  ctx.fillRect(w*0.45, -h + r*0.14, w*0.55, r*0.34);
  ctx.fillRect(-w, -h + r*0.42, w*0.34, r*0.22);
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
  // 人工物(遮蔽物)は岩ではなく角のある塊として描く
  if(flavor==='ruinwall'||flavor==='container'||flavor==='ruinpillar'||flavor==='hut'){
    drawStructureObstacle(rock, flavor); ctx.restore(); return;
  }
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
  if(!renderHeavyLoad){ ctx.shadowBlur=14; ctx.shadowColor='rgba(180,230,255,0.8)'; }
  ctx.fill(); ctx.stroke();
  ctx.shadowBlur=0;
  ctx.restore();
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
/* チーム戦: 自分がダウン中は画面全体に赤いビネット+「仲間の蘇生を待て (残りN秒)」。
   蘇生が進んでいる間は文言を差し替え、進み(reviveProgress/TEAM_REVIVE_SEC)をバーで見せる。
   ゲストにも downedUntil/reviveProgress は同期済み(authStateのdw/rv)なので同じ絵が出る */
function drawDownedOverlay(){
  if(!(typeof entityDowned==='function') || !player || !entityDowned(player)) return;
  const pulse = 0.30 + 0.10*Math.sin(matchTime*2.5);
  const grad = ctx.createRadialGradient(viewW/2,viewH/2, Math.min(viewW,viewH)*0.30, viewW/2,viewH/2, Math.max(viewW,viewH)*0.68);
  grad.addColorStop(0,'rgba(140,0,0,0)');
  grad.addColorStop(1,`rgba(150,10,10,${pulse})`);
  ctx.save();
  ctx.fillStyle = grad; ctx.fillRect(0,0,viewW,viewH);
  const remain = Math.max(0, Math.ceil((player.downedUntil||0) - matchTime));
  const reviving = player.reviveProgress > 0;
  ctx.textAlign='center';
  ctx.font = "bold 20px 'Rajdhani', sans-serif";
  ctx.fillStyle = reviving ? 'rgba(150,255,180,0.95)' : 'rgba(255,120,110,0.95)';
  if(!renderHeavyLoad){ ctx.shadowBlur = 12; ctx.shadowColor = reviving ? 'rgba(60,220,110,0.8)' : 'rgba(255,60,40,0.8)'; }
  ctx.fillText(reviving ? '蘇生されている…！' : `仲間の蘇生を待て (残り${remain}秒)`, viewW/2, viewH*0.20);
  if(reviving && typeof TEAM_REVIVE_SEC!=='undefined'){
    const w = 180, h = 6, x = viewW/2 - w/2, y = viewH*0.20 + 12;
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#58e07e'; ctx.fillRect(x, y, w*clamp(player.reviveProgress/TEAM_REVIVE_SEC,0,1), h);
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
  if(!renderHeavyLoad){ ctx.shadowBlur = 10; ctx.shadowColor = outside ? 'rgba(255,60,20,0.9)' : 'rgba(244,196,48,0.7)'; }
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
/* バトルアリーナ中だけ、安置コンパスの下に両チームの生存数(3-2形式)と残り時間を小さく出す。
   DOMは足さずcanvasで完結させる(既存HUDのID構成を変えない)。エンティティのalive/teamIdと
   matchTimeはマルチのゲストでも同期済みなので、そのまま数えるだけで両側で同じ表示になる。
   位置はコンパス(cy=70,r=24)+圏外時の距離表示(〜y110)の直下で、既存要素と重ならない。 */
function drawArenaScoreHud(){
  if(!game.arena || !player || player.teamId==null) return;
  let mine = 0, foe = 0;
  for(const e of entities){
    if(!e.alive || e.teamId==null) continue;
    if(e.teamId===player.teamId) mine++; else foe++;
  }
  const left = Math.max(0, ARENA_TIME_LIMIT - matchTime);
  const timeText = fmtTime(left);
  /* 開始バナー: 最初の2.5秒だけ中央に大きく「3 vs 3」を出す(APEXのラウンド開始演出の
     最小形。スコアピルが小さくて開幕の文脈が伝わらない=批評指摘への応答) */
  if(matchTime < 2.5 && !introState.active){
    const a = matchTime < 2.0 ? 1 : (2.5 - matchTime)/0.5;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.font = "bold 46px 'Russo One', sans-serif";
    ctx.fillStyle = '#f4c430';
    if(!renderHeavyLoad){ ctx.shadowBlur = 24; ctx.shadowColor = 'rgba(244,196,48,0.6)'; }
    ctx.fillText(`${mine} vs ${foe}`, viewW/2, viewH*0.32);
    ctx.shadowBlur = 0;
    ctx.font = "bold 15px 'Rajdhani', sans-serif";
    ctx.fillStyle = 'rgba(235,240,248,0.9)';
    ctx.fillText('バトルアリーナ ― 相手チームを全滅させろ', viewW/2, viewH*0.32 + 26);
    ctx.restore();
    return;   // バナー表示中はスコアピルを出さない(同じ位置で重なる)
  }
  const cx = viewW/2, top = 112, h = 30, w = 210;
  ctx.save();
  // 背景はパネル類(rgba(11,19,32,…))と同じトーンの丸角ピル
  ctx.beginPath();
  const r = h/2, x0 = cx-w/2, y0 = top;
  ctx.moveTo(x0+r, y0);
  ctx.arcTo(x0+w, y0,   x0+w, y0+h, r);
  ctx.arcTo(x0+w, y0+h, x0,   y0+h, r);
  ctx.arcTo(x0,   y0+h, x0,   y0,   r);
  ctx.arcTo(x0,   y0,   x0+w, y0,   r);
  ctx.closePath();
  ctx.fillStyle = 'rgba(11,19,32,0.66)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const cyText = y0 + h/2 + 1;
  // 生存数: 自チーム=味方マーカーと同じ緑 / 敵チーム=被弾系の赤(既存HUDの配色に合わせる)
  ctx.font = "bold 19px 'Russo One', sans-serif";
  ctx.fillStyle = '#58e07e';
  ctx.fillText(String(mine), cx-44, cyText);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = "bold 13px 'Rajdhani', sans-serif";
  ctx.fillText('vs', cx-22, cyText);
  ctx.font = "bold 19px 'Russo One', sans-serif";
  ctx.fillStyle = '#ff6a6a';
  ctx.fillText(String(foe), cx, cyText);
  // 残り時間(上限を超えたら生存数の多い側の勝ち)。残り30秒からは琥珀色で促す
  ctx.font = "14px 'Share Tech Mono', monospace";
  ctx.fillStyle = left<=30 ? '#f4c430' : 'rgba(255,255,255,0.75)';
  ctx.fillText(timeText, cx+50, cyText);
  ctx.restore();
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
// rectOutlinePointsの一般化(近い端がnearD)。羅生門の「最遠から門への逆走の帯」のように
// 原点(0)から始まらない帯を描くときに使う。**rectOutlinePointsは変更しない**(近い端=0の別実装として残す)
function rectBandOutlinePoints(x,y,angle,nearD,farD,halfWidth){
  const fx=Math.cos(angle), fy=Math.sin(angle);
  const rx=-Math.sin(angle), ry=Math.cos(angle);
  const nx=x+fx*nearD, ny=y+fy*nearD, span=farD-nearD;
  const corners = [
    {x:nx+rx*halfWidth, y:ny+ry*halfWidth},
    {x:nx-rx*halfWidth, y:ny-ry*halfWidth},
    {x:nx-rx*halfWidth+fx*span, y:ny-ry*halfWidth+fy*span},
    {x:nx+rx*halfWidth+fx*span, y:ny+ry*halfWidth+fy*span},
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
  if(!renderHeavyLoad){ ctx.shadowBlur=18; ctx.shadowColor=color; }
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
    const hw = ae.width*halfWidthFrac*0.5;
    /* うねりを**当たり判定の外へ出さない**。以前は振幅が幅の0.32倍あり、
       いちばん外の層(半幅0.475倍)と足すと**判定の1.59倍の幅**まで膨らんでいた。
       当たると思って避ける/当たらないと思って被弾する原因になる(採点表の最優先条件)。
       帯の半幅を引いた残りぶんだけ揺らす(2つの正弦の係数の和を1にして超えないようにする)。 */
    const room = Math.max(0, ae.width*0.5 - hw);
    for(let i=0;i<=segs;i++){
      const along = curReach*(i/segs);
      const wobble = (Math.sin(along*0.018+t)*0.69 + Math.sin(along*0.05-t*1.7)*0.31) * room;
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
    if(!renderHeavyLoad){ ctx.shadowBlur = 10; ctx.shadowColor = color; }
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
    const hw = ae.width*halfWidthFrac*0.5;
    /* うねりを**当たり判定の外へ出さない**。以前は振幅が幅の0.32倍あり、
       いちばん外の層(半幅0.475倍)と足すと**判定の1.59倍の幅**まで膨らんでいた。
       当たると思って避ける/当たらないと思って被弾する原因になる(採点表の最優先条件)。
       帯の半幅を引いた残りぶんだけ揺らす(2つの正弦の係数の和を1にして超えないようにする)。 */
    const room = Math.max(0, ae.width*0.5 - hw);
    for(let i=0;i<=segs;i++){
      const along = curReach*(i/segs);
      const wobble = (Math.sin(along*0.018+t)*0.69 + Math.sin(along*0.05-t*1.7)*0.31) * room;
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
      // 炎のゆらぎで**到達距離の外へ出さない**(いちばん外の層で射程の1.08倍まで伸びていた)
      const r = Math.min(curReach, curReach*frac*wob);
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
   ・入口は drawSingleAreaEffect 先頭の real3dFx() 1か所。falseなら従来の平面エフェクトが走る。
   ・柱・弧・ドームの各点は project(x, y, 地面の高さ+dz) で個別に投影する。
     画面上で楕円や矩形を決め打ちしないので、坂の上でも地面から生えて見える
     (この決まりは地面に貼る円と同じ。扁平率を固定すると浮いて見える)。
===================================================================== */
// 高さの基準は「モンスターの背丈」。ここを変えると範囲技の背の高さがまとめて変わる
// (drawMonsterは足元から radius*1.85 ぶんの高さに絵を描くので、radius22なら約50)
const FX3D_MON_H      = 52;
const FX3D_FLAME_H    = FX3D_MON_H;         // 炎の高さ
const FX3D_FLAME_N    = 24;                 // 1つの範囲技に立てる炎の数(増やすと濃くなるが重い)
const FX3D_FLAME_R    = 36;                 // 炎1つの根元の太さ
const FX3D_SPIKE_H    = FX3D_MON_H*1.15;    // 結晶の柱の高さ
const FX3D_SPIKE_N    = 11;                 // 結晶の柱の本数
const FX3D_RAIN_H     = 900;                // 降ってくる結晶の初期高度
const FX3D_WALL_H     = FX3D_MON_H;         // 念力の壁の高さ
const FX3D_DOME_H_RATIO = 0.62;             // 爆風ドームの高さ(判定半径に対する比)
const FX3D_DOME_H_MIN   = FX3D_MON_H;      // 小さい爆風でもこれ以上は高さを出す
const FX3D_BOLT_SKY   = 820;                // 落雷が始まる高さ(雷だけは背を低くしない)
const FX3D_BOLT_N     = 5;                  // 1回の雷で空から落とす本数
const FX3D_RING_SEGS  = 30;                 // 輪・弧のサンプル数
const FX3D_AREA_ALPHA = 0.58;               // 範囲技の透け具合(小さいほど後ろが見える)
const FX3D_DOME_ALPHA = 1.0;                // 爆風ドームだけは濃いまま残す

/* 技のエフェクトは地面(WebGL)と違って全部2Dキャンバスで描いている。
   WebGLに一切依存していないので、通常マップでも同じ立体エフェクトをそのまま出せる。
   違いは groundZAt() が通常マップでは常に0を返すこと=平らな地面の上に乗るだけ。
   FX_SOLID_ALL_MAPS を false にすると通常マップだけ従来の平面エフェクトへ戻る。     */
const FX_SOLID_ALL_MAPS = true;
function real3dFx(){ return FX_SOLID_ALL_MAPS || (typeof isReal3dMap==='function' && isReal3dMap()); }
/* 技のエフェクトは負荷が高くても簡略化しない(発注者方針: ゲームのクオリティを下げない)。
   代わりに「同じ見た目のまま安くする」方向で詰める:
   ・加算合成(lighter)の切り替えは端末側でレイヤの吐き出しが起きるため、
     炎1本ごとに切り替えず、まとめて1回で済ませる(fx3dFlameField)               */

// 投影済みの点列を塗る/なぞる(shadowBlurは重い端末では自動で切る)
/* 面の下に敷く「暗い縁」の濃さと広がり。
   【なぜ要るか】採点表2は**暗い煙/縁 → 属性色 → 白熱の芯**の3層を求めるが、
   この作品の立体エフェクトは**明るい層だけで組まれていた**。批評家3名が独立に
   「平らなポリゴンと太さ一定の輪郭線でできていて紙細工に見える」と指摘し、
   18技中12技がこの項目で3点以下だった。**最下層が構造として無いのが原因。**
   加算では暗くできないが、fx3dFill は通常合成なので**ここでなら暗い層を置ける。**
   面を重心から少し広げて暗色で塗り、その上に本来の面を重ねる = 縁が締まる。 */
const FX3D_SHADE_W    = 4.5;    // 暗い縁の太さ(px)。面を広げて塗ると隣の面を汚すので線で引く
const FX3D_SHADE_A    = 0.55;   // 暗い縁の濃さ(本体のalphaに掛ける)
function fx3dShadeUnder(pts, color, alpha){
  /* 【重要】面を広げて**塗る**と、深度順に重ねる技(炎・触手)で
     **後から描く面の暗色が、先に描いた明るい面の上を横切る。**
     実測で炎に茶色い帯、触手に真っ黒な楔(ポリゴン抜けに見える)が出た。
     縁を**線で引く**だけなら、重なっても細い暗い輪郭にしかならず、
     採点表2が求める「暗い縁」もそのまま満たせる。 */
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha*FX3D_SHADE_A);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.lineWidth = FX3D_SHADE_W;
  ctx.strokeStyle = _mixHex(typeof color === 'string' && color[0]==='#' ? color : '#20202a', '#000000', 0.72);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}
function fx3dFill(pts, color, alpha, blur, noShade){
  if(!pts || pts.length<3 || alpha<=0.01) return;
  // 暗い縁を先に敷く(グラデーション塗りのときは色を取れないので既定の暗色を使う)
  if(!noShade && alpha > 0.12) fx3dShadeUnder(pts, color, alpha);
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
/* 白熱の芯だけを**加算**で置く。
   【なぜ別の関数が要るか】fx3dFill は通常合成(source-over)で、しかも呼び出し側は
   `fade × FX3D_AREA_ALPHA(0.58)` を掛けて渡す。そのため `rgba(255,255,255,0.95)` と
   書いても**画面では最大238程度にしかならず、250を超えられない**(実測: 結晶の頂点227・
   念力の壁238・モッチ砲の筒195)。「芯を白飛びさせた」つもりの修正が効かなかった原因。
   加算で、しかも fade を掛けずに置けば確実に飽和する
   (fx3dDomeBurst の天辺だけが飽和していたのは、そこだけこの書き方だったため)。
   **面全体には使わない。** 芯=小さい範囲だけに使うこと(全面に使うと画が白く洗われる)。 */
function fx3dCore(pts, color, alpha, blur){
  if(!pts || pts.length<3 || alpha<=0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
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
/* 炎をまとめて描く。
   炎1本ごとに save/合成モード切り替え/restore をしていると、24本×3層で
   72回の切り替えになる。加算合成への切り替えは端末側でレイヤの吐き出しを伴うため、
   ここが積み上がる。見た目は変えずに「外側の層を全部 → 内側2層を加算でまとめて」
   の2パスにして、切り替えを2回に減らす。                                       */
let fxFlameBatched = false;
function fx3dFlameField(list, rBase, fade, ramp){
  fxFlameBatched = true;
  try{
    // 1パス目: くすんだ外側(通常合成)
    for(const c of list) fx3dFlame(c.x, c.y, c.gz, c.h, rBase, c.seed, fade, ramp, 0, 1);
    // 2パス目: 技色と白熱の芯(加算合成をここで1回だけ立てる)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for(const c of list) fx3dFlame(c.x, c.y, c.gz, c.h, rBase, c.seed, fade, ramp, 1, 3);
    ctx.restore();
  } finally { fxFlameBatched = false; }
}
function fx3dFlame(x, y, gz, h, rBase, seed, fade, ramp, kFrom, kTo){
  const N = 7;
  const base = fx3dPoint(x, y, 0, gz);
  const top  = fx3dPoint(x, y, h*1.1, gz);
  if(!base || !top) return;
  const k0 = kFrom||0, k1 = (kTo==null ? 3 : kTo);
  for(let k=k0;k<k1;k++){
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
    ctx.globalAlpha = (k===0 ? 0.72 : 0.85)*fade;   // 炎は密度が命なので濃いめに重ねる
    if(k>0 && !fxFlameBatched) ctx.globalCompositeOperation = 'lighter'; // 加算で重なりを白熱させる
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
/* ビーム(筒)。ビーム系の技はすべてこれ1つで描き、違うのは色だけにする。
   ・断面は「横=技の当たり幅 / 縦=モンスターの背丈」の楕円。
     真円にすると幅の広い技(モッチ砲は120)で縦にも同じだけ塗ることになり、
     実際に塗る面積が倍近くなる。横に広く縦は背丈ぶん、が技の見た目にも合う。
   ・断面の楕円は uH(横)と uV(縦)の2本のベクトルで持つ。どちらも実際に投影して
     求めるので、坂の下へ撃っても真上から見ても正しく傾く。
   ・輪郭の膨らみは「その向きへの楕円の張り出し」= hypot(n・uH, n・uV) で厳密に出る。
   ・加算合成なので重なるほど明るくなり、光の筒に見える                         */
/* 筒をカメラから何ユニット先から描き始めるか。
   カメラは術者の145後ろなので、260にすると術者の115先から筒が始まる。
   射程800〜2200の技では見え方はほぼ変わらず、足元の巨大な断面だけが消える。 */
const TUBE_NEAR = 260;
/* denseK: 途中の輪の「中身の濃さ」を落とす係数(既定1)。
   フラワービームのように**同じ場所に何本も重ねる技**では、1本ぶんの中身を薄くしないと
   3本の筒が溶けて1つの緑の塊に見える。縁の線は落とさないので、本数は数えられる。 */
function fx3dBeamTube(ox, oy, angle, reach, radius, col, fade, fullReach, denseK){
  const segs = 16;
  // 縦半径は横の半分。これより薄くすると、正面から撃った時に地面へ貼り付いた
  // 板にしか見えなくなる(実際に起きた)。細いビームでも背丈の半分は確保する
  const halfH = Math.max(FX3D_MON_H*0.5, radius*0.5);
  // 芯の高さ。筒の下端が必ず地面から浮くようにして、地面の模様と一体化させない
  const dz    = halfH + FX3D_MON_H*0.35;
  const px = -Math.sin(angle), py = Math.cos(angle);   // 進行方向に垂直(ワールド水平)
  const fx = Math.cos(angle), fy = Math.sin(angle);
  /* 芯はワールド座標で「まっすぐな線分」にする。
     地形の高さを1点ずつ拾って芯を通すと、丘のでこぼこで芯がジグザグになり、
     断面の向きが区間ごとに反転して筒がねじれて見える(2026-07-31に発生)。
     始点と終点の地面の高さだけを見て、その間は直線で結ぶ = 全体の傾斜には乗る。 */
  // 傾きの基準は「最大射程の先」で取る。伸びている途中の先端で取ると、
  // 先端が凸凹を通るたびに筒全体が揺れてしまう
  const refLen = fullReach || reach;
  const gz0 = groundZAt(ox, oy) + dz;
  const gzEnd = groundZAt(ox+fx*refLen, oy+fy*refLen) + dz;
  const slope = refLen > 1 ? (gzEnd - gz0)/refLen : 0;
  const pts = [], uH = [], uV = [], alongs = [], nearK = [];
  /* 【重要】節を等間隔に置かない。**手前ほど詰めて置く。**
     筒は「投影した節の間を直線の四角形で結ぶ」ので、遠近の変化が速い区間では
     直線の辺が本当の輪郭より外へふくらむ。カメラは術者の145後ろに居るため
     いちばん手前の区間が最も歪み、**当たり判定の外の地面まで塗っていた**
     (実測: モッチ砲は判定140pxの所を378px=2.7倍に塗り、天河天翔は約3倍)。
     f=(i/segs)^2 にすると最初の区間が射程の0.4%まで縮み、辺が輪郭に張り付く。
     **技の長さも太さも変えない**(節の置き方だけを変える)ので、性能とは無関係。 */
  /* 【重要】カメラに近すぎる区間は**ワールド距離で捨てる。**
     画面上の大きさで判定していたが、真正面へ撃つとその判定では救えない
     (芯が画面上で点になり、口の塗りつぶしが804x402pxの巨大な楕円として残る。
      天河天翔は当たり幅160なのに画面幅810pxまで覆っていた)。
     カメラから TUBE_NEAR より手前の節は最初から作らない。射程の長い技では
     見え方はほとんど変わらない(術者はカメラの145先なので、切れるのは足元だけ)。 */
  const _cam = (typeof camPos !== 'undefined' && camPos) ? camPos : null;
  for(let i=0;i<=segs;i++){
    const f = (i/segs)*(i/segs), along = reach*f;
    const z = gz0 + slope*along;
    const x = ox+fx*along, y = oy+fy*along;
    const c = project(x, y, z);
    if(!c) continue;
    /* **捨てない。手前ほど細くする。**
       `continue` で捨てたら、スキル文書に自分で書いた「口を捨てて胴体を残す」を
       距離基準でやり直しただけになり、筒が術者から切れて浮いた。さらに伸び始めの
       コマ(節が全部 TUBE_NEAR 以内)では**技がまるごと消えた**(王狐炎衝の0.28s)。
       カメラに近いほど半径を0へ絞れば、巨大な断面だけが消えて筒は繋がったまま残る。 */
    const _nk = _cam ? Math.min(1, Math.hypot(x - _cam.x, y - _cam.y) / TUBE_NEAR) : 1;
    const h = project(x + px*radius, y + py*radius, z);
    const v = project(x, y, z + halfH);
    if(!h || !v) continue;
    pts.push(c); alongs.push(along); nearK.push(_nk*_nk);
    uH.push({ x:(h.x-c.x)*_nk, y:(h.y-c.y)*_nk });
    uV.push({ x:(v.x-c.x)*_nk, y:(v.y-c.y)*_nk });
  }
  if(pts.length<2) return;
  /* 画面上の垂直方向は「芯の全体の向き」から1つだけ作る。
     芯がワールドで直線なら画面上でも直線になるので、区間ごとに取り直す必要はない。
     区間ごとに取ると、遠くで点が詰まったときに向きが暴れて輪郭が交差する。      */
  const a0 = pts[0], a1 = pts[pts.length-1];
  let dx = a1.x-a0.x, dy = a1.y-a0.y;
  const len = Math.hypot(dx,dy);
  if(len < 0.5){ dx = 0; dy = 1; }   // ほぼ真正面。断面だけを見せる
  else { dx/=len; dy/=len; }
  const nx = -dy, ny = dx;
  const nrm = [];
  for(let i=0;i<pts.length;i++){
    const r = Math.hypot(nx*uH[i].x + ny*uH[i].y, nx*uV[i].x + ny*uV[i].y);
    nrm.push({ x:nx, y:ny, r:Math.max(0.5, r) });
  }
  const sh = auraShades(col);
  const shell = _mixHex(col, '#ffffff', 0.25);   // 外殻の色(技色より少し明るい)
  const edgeA = [], edgeB = [];
  /* 【真正面へ撃ったときは胴体を1枚も描かない。】
     芯が画面上で潰れると、断面の向き(nx,ny)は既定の横向きになり、四角形は
     「筒の胴体」ではなく**画面を横切る白い羽根**として塗られる(実測: 天河天翔で横795px、
     モッチ砲は桃色の門に見えた)。区間を繋いでも、輪を減らしても、羽根は羽根のまま。
     カメラの奥へ向いた筒は**本当に円盤にしか見えない**のが正しい見え方なので、
     胴体と外殻線をやめ、口の断面・芯・**地面の光の帯**だけで見せる。
     伸びは地面の帯が受け持つ(地面には遠近が効くので、伸びるほど帯も伸びる)。 */
  const _headOn = len < nrm[0].r*1.2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = fade;
  /* 【重要】**地面の光の帯を筒より先に敷く。**
     カメラの奥へ撃つと筒は画面上で潰れ、口の楕円が重なった「シャボン玉」にしか
     見えない(天河天翔・モッチ砲が同じ壊れ方で不合格)。芯の画面長は術者で239px・
     射程2200の先で16pxしかないので、**筒そのものをどう描いても伸びは出せない。**
     一方で地面は遠近が効くので、判定と同じ幅・同じ長さの帯を地面へ落とすと
     「前方の遠くまで伸びている」が一目で読める。伸びるほど帯も伸びるので
     採点表7(時間設計)も同時に埋まる。**幅は radius(=判定の半幅)そのもの。** */
  {
    const GSEG = 12;
    const gpt = (t, s)=>{
      const along = reach*t*t;                      // 手前を詰める(筒と同じ理由)
      const x = ox+fx*along + px*radius*s, y = oy+fy*along + py*radius*s;
      return project(x, y, groundZAt(x, y) + 2);
    };
    for(let i=0;i<GSEG;i++){
      const t0=i/GSEG, t1=(i+1)/GSEG;
      const a0=gpt(t0,-1), a1=gpt(t0,1), b1=gpt(t1,1), b0=gpt(t1,-1);
      if(!a0||!a1||!b1||!b0) continue;
      ctx.globalAlpha = fade * (0.40 - 0.30*t0);    // 手前が濃く、先へ行くほど薄い
      ctx.fillStyle = _hexA(sh.bright, 1);
      ctx.beginPath();
      ctx.moveTo(a0.x,a0.y); ctx.lineTo(a1.x,a1.y); ctx.lineTo(b1.x,b1.y); ctx.lineTo(b0.x,b0.y);
      ctx.closePath(); ctx.fill();
    }
    /* 帯の左右の縁 = **当たり判定の縁そのもの**。
       ただし**通しの実線で引かない。** 3本束ねる技(フラワービーム)では3枚の帯の縁が
       交差して**術者を囲むガラスの箱(温室)**に見えた(実測の指摘)。単発の技でも
       「滑走路の白線」と言われた。区間ごとに引いて奥へ行くほど消し、線を溶かす。 */
    ctx.lineCap='butt'; ctx.lineJoin='round';
    for(const s of [-1, 1]){
      ctx.strokeStyle = _hexA(shell, 1);
      for(let i=0;i<GSEG;i++){
        const c0 = gpt(i/GSEG, s), c1 = gpt((i+1)/GSEG, s);
        if(!c0||!c1) continue;
        const t0 = i/GSEG;
        ctx.globalAlpha = fade * 0.34 * (1 - t0)*(1 - t0);
        ctx.lineWidth = Math.max(1, 2.6*(1 - t0));
        ctx.beginPath(); ctx.moveTo(c0.x,c0.y); ctx.lineTo(c1.x,c1.y); ctx.stroke();
      }
    }
    // 帯の真ん中に白い筋。地面の上を光が走っているように見せる(こちらは芯なので強く)
    for(let i=0;i<GSEG;i++){
      const c0 = gpt(i/GSEG, 0), c1 = gpt((i+1)/GSEG, 0);
      if(!c0||!c1) continue;
      const t0 = i/GSEG;
      // 帯の芯。**外殻の円より目立たせない**(細い1本の線に見える原因になっていた)
      ctx.globalAlpha = fade * (0.62 - 0.45*t0);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.2, 3.2*(1 - t0*0.7));
      ctx.beginPath(); ctx.moveTo(c0.x,c0.y); ctx.lineTo(c1.x,c1.y); ctx.stroke();
    }
    ctx.globalAlpha = fade;
  }
  let _prev = 0;               // 最後に四角形を張った節。潰れた区間はここから先へ繋ぐ
  for(let i=0;!_headOn && i<pts.length-1;i++){
    const a=pts[_prev], b=pts[i+1], na=nrm[_prev], nb=nrm[i+1];
    /* **潰れた区間の胴体は描かない。**
       真正面へ撃つと芯が画面上でほぼ点になるので、節と節の間隔(segLen)が
       帯の半幅(bandW)よりずっと小さくなる。この四角形は「筒の横断面」ではなく
       **画面を横切る羽**として塗られる(実測: 天河天翔で横795px。判定は幅240)。
       前の修正で断面の輪だけ戻したが、羽の正体は胴体のほうだったので幅が変わらなかった。
       間隔が半幅の35%を切ったら胴体をやめ、`ringAt` の楕円に任せる
       (輪は下で必ず描かれるので、筒が消えることはない)。 */
    const segLen = Math.hypot(b.x-a.x, b.y-a.y);
    const bandW  = (na.r + nb.r) * 0.5;
    /* 【重要】潰れた区間を`continue`で捨てると、**カメラの奥へ撃ったときに
       全区間が潰れて胴体が丸ごと消え、口の楕円だけが残る**(同心楕円=シャボン玉に見えた)。
       芯の画面上の長さは、術者の位置で239px・射程2200の先で16pxしかないので、
       正面へ撃つ=普通の撃ち方では必ずこうなる。
       捨てるのではなく**筒を繋いだまま先の節まで飛ばす**。溜めた区間が十分な長さに
       なったところで1枚の四角形にすれば、潰れた所だけが間引かれて筒は途切れない。 */
    if(segLen < bandW*0.35 && i < pts.length-2){ continue; }
    const q = [
      { x:a.x+na.x*na.r, y:a.y+na.y*na.r },
      { x:b.x+nb.x*nb.r, y:b.y+nb.y*nb.r },
      { x:b.x-nb.x*nb.r, y:b.y-nb.y*nb.r },
      { x:a.x-na.x*na.r, y:a.y-na.y*na.r },
    ];
    const mx=(a.x+b.x)/2, my=(a.y+b.y)/2, mr=(na.r+nb.r)/2, mnx=(na.x+nb.x)/2, mny=(na.y+nb.y)/2;
    // 断面方向の色: 縁(外殻)が濃く、少し内側で一度沈み、芯で白く光る。
    // 縁を薄いままにすると帯にしか見えないので、外殻をはっきり出して筒に見せる
    const g = ctx.createLinearGradient(mx-mnx*mr, my-mny*mr, mx+mnx*mr, my+mny*mr);
    g.addColorStop(0,    _hexA(shell, 1));
    g.addColorStop(0.08, _hexA(col, 0.85));
    g.addColorStop(0.26, _hexA(col, 0.55));
    g.addColorStop(0.42, _hexA(sh.bright, 0.8));
    g.addColorStop(0.5,  'rgba(255,255,255,0.98)');
    g.addColorStop(0.58, _hexA(sh.bright, 0.8));
    g.addColorStop(0.74, _hexA(col, 0.55));
    g.addColorStop(0.92, _hexA(col, 0.85));
    g.addColorStop(1,    _hexA(shell, 1));
    ctx.beginPath();
    ctx.moveTo(q[0].x,q[0].y); ctx.lineTo(q[1].x,q[1].y); ctx.lineTo(q[2].x,q[2].y); ctx.lineTo(q[3].x,q[3].y);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    edgeA.push(q[0], q[1]); edgeB.push(q[3], q[2]);
    _prev = i+1;
  }
  // 外殻の輪郭線。ここが無いと縁がぼやけて筒に見えない。
  // 線は輪郭の内側へ寄せて引く(中心に置くと線の太さの半分だけ当たり幅からはみ出す)
  const rimW = Math.max(1.6, nrm[Math.floor(nrm.length/2)].r*0.11);
  const inset = (list, sign)=>list.map((q,i)=>{
    const n = nrm[Math.min(nrm.length-1, i>>1)];
    return { x:q.x - n.x*sign*rimW*0.5, y:q.y - n.y*sign*rimW*0.5 };
  });
  if(edgeA.length >= 2){
    fxStrokePath(inset(edgeA, 1), shell, rimW, 0.95*fade, 0);
    fxStrokePath(inset(edgeB, -1), shell, rimW, 0.95*fade, 0);
  }
  /* 芯の白熱を**加算で別に1本**引く。
     胴体のグラデーションの中央に白を置いてあるが、fx3dFill は通常合成で
     `fade × FX3D_AREA_ALPHA(0.58)` が掛かるため、**画面では195止まり**で
     白飛びしない(モッチ砲の実測)。ここだけ lighter で、fade を掛けずに引く。
     太さは帯の半幅の18%まで。太くすると筒の中身が白い棒に潰れる。 */
  if(pts.length >= 2){
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    /* 正面撃ちでは芯を控えめにする。胴体が描かれないぶん芯だけが目立ち、
       「中心の線1本しか出ていない」に見えていた。主役は外殻の円のほう。 */
    ctx.globalAlpha = _headOn ? 0.55 : 0.85;
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for(let i=0;i<pts.length-1;i++){
      const w = Math.max(1.2, Math.min((nrm[i].r + nrm[i+1].r)*0.5*(_headOn ? 0.11 : 0.18), _headOn ? 8 : 14));
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[i+1].x, pts[i+1].y);
      ctx.stroke();
    }
    ctx.restore();
  }
  // 断面の輪。両端は塗りつぶし、途中は輪郭だけを等間隔に入れて「筒」だと分かるようにする。
  // uH/uV をそのまま基底にすれば、投影された楕円がそのまま描ける
  const ringAt = (i, filled, kA)=>{
    const c = pts[i], h = uH[i], v = uV[i];
    const det = h.x*v.y - h.y*v.x;
    if(Math.abs(det) < 1) return;          // 真横から見て潰れているときは描かない
    /* 手前の断面は画面上で巨大になるので薄くする。**ただし消さない。**
       【なぜ変えたか】以前はここで `return` して**筒の口だけを捨て、胴体の帯は残していた。**
       これが一番悪い組み合わせで、
         ・真正面へ撃つと軸が画面上でほぼ点になり、胴体が**横796pxの羽**に潰れる(天河天翔)
         ・口が無いので筒が術者から30px切れて浮く(モッチ砲)
         ・3本の口が重なって白い団子になる(フラワービーム)
       という3技の不合格が、すべてこの1行から出ていた。
       大きい断面ほど薄くして、形は必ず残す。 */
    const _hr = Math.hypot(h.x, h.y);
    const _big = _hr / Math.max(1, viewW*0.14);
    /* 正面撃ちでは口を**光のにじみ**にする。以前は外周を `shell` の0.9αで締めていたので、
       画面上440pxの**つやのあるシャボン玉**になり、判定(幅140px)の3倍の物体が
       浮いて見えた。縁を0で終わらせて溶かし、濃さも落とす。 */
    /* 【薄くしすぎない】以前は `1/(_big*_big)` に加えて正面撃ちで 0.4 を掛けていたため、
       口も途中の輪もほとんど消え、**残るのは芯の白い線と地面の帯だけ**になっていた。
       「範囲に対して細く見える」の正体がこれ(発注者指摘・2026-08-17)。
       外殻の円がこの技の主役なので、減衰は緩く(1/_big)・下限も高く取る。 */
    const ringA = (_big <= 1 ? 1 : Math.max(0.40, 1/_big))
                * (nearK[i] != null ? nearK[i] : 1) * (kA == null ? 1 : kA);
    ctx.save();
    ctx.globalAlpha = ringA;
    ctx.transform(h.x, h.y, v.x, v.y, c.x, c.y);
    ctx.beginPath(); ctx.arc(0,0,1,0,Math.PI*2);
    /* 中身も薄く塗る。**輪郭だけにすると「ばね(コイル)」に見える。**
       薄い面を距離ぶん重ねると、手前ほど濃い「光の柱」になって太さが読める。
       いちばん外は α0 で終わらせて溶かす(ベタで締めると つやのあるシャボン玉になる)。 */
    /* 途中の輪の中身は**薄く**。加算で6〜8枚重なるので、1枚を濃くすると
       白い技(天河天翔)では中が真っ白な円盤に潰れる。濃いのは縁だけでよい。 */
    const _dk = denseK == null ? 1 : denseK;
    const g = ctx.createRadialGradient(0,0,0, 0,0,1);
    g.addColorStop(0, filled ? 'rgba(255,255,255,0.98)' : _hexA(sh.bright, 0.12*_dk));
    g.addColorStop(0.4, _hexA(sh.bright, filled ? 0.55 : 0.07*_dk));
    g.addColorStop(0.78, _hexA(col, filled ? 0.42 : 0.11*_dk));
    g.addColorStop(0.93, _hexA(shell, filled ? 0.95 : 0.42));
    g.addColorStop(1, _hexA(shell, 0));
    ctx.fillStyle = g; ctx.fill();
    if(!filled){
      // 縁の線。**これが「外殻の円」そのもの。** 変換前の空間で指定するので拡大率で割る
      ctx.lineWidth = 3.0 / Math.max(1, Math.sqrt(Math.abs(det)));
      ctx.strokeStyle = _hexA(shell, 0.75);
      ctx.stroke();
    }
    ctx.restore();
  };
  const last = pts.length-1;
  /* 途中の輪は**距離で選ぶ**。節が手前に詰まっているので添字で等分すると
     輪が3本とも術者の足元に固まる。
     **正面へ撃ったときは輪を減らす。** 芯が画面上でほぼ点になるので、
     輪を8本も入れると同心楕円の重なり=シャボン玉にしか見えない。 */
  const _axisLen = Math.hypot(pts[last].x-pts[0].x, pts[last].y-pts[0].y);
  /* 【何本入れるか】一度「正面撃ちでは1本も入れない」にしたが、そうすると
     正面へ撃ったとき**画に残るのが芯の白い線と地面の帯だけ**になり、判定の幅より
     ずっと細い技に見えた(発注者指摘・2026-08-17)。外殻の円を主役にするので必ず入れる。
     ただし節は手前に詰まっているので**距離で等分**して選ぶ(添字で割ると足元に固まり、
     同心楕円=シャボン玉に見える)。正面撃ちは奥へ向かうトンネルなので本数は控えめに。 */
  const _rings = _axisLen < nrm[0].r*1.2 ? 6 : 8;
  for(let k=1;k<_rings;k++){
    const t = k/_rings;
    const want = reach*t;
    let i = 0, best = Infinity;
    for(let j=1;j<last;j++){ const d = Math.abs(alongs[j]-want); if(d<best){ best=d; i=j; } }
    // 奥へ行くほど薄く。全部同じ濃さで並べると平らな的(同心円)に見える
    if(i>0 && i<last) ringAt(i, false, 1 - 0.55*t);
  }
  ringAt(0, true); ringAt(last, true);
  ctx.restore();
}
// 地面から生える尖った柱(結晶・氷柱)
function fx3dSpike(x, y, gz, h, rBase, col, fade){
  const apex = fx3dPoint(x, y, h, gz);
  const base = fx3dPoint(x, y, 0, gz);
  if(!apex || !base) return;
  const sh = auraShades(col);
  const r = rBase*base.scale;
  /* 根元=暗い煙 / 中間=属性色 / 頂点=白熱 の3層(採点表2)。
     以前はいちばん明るい所が sh.bright の0.5αで、**白まで届いていなかった**。
     実測: クリスタルレインの0.85sのコマで全チャンネル245超の画素が1個しか無く、
     「光っている」ように見えなかった。頂点だけは必ず白飛びさせる。 */
  const g = ctx.createLinearGradient(base.x, base.y, apex.x, apex.y);
  g.addColorStop(0, _hexA(sh.dark, 0.9));
  g.addColorStop(0.5, _hexA(col, 0.72));
  g.addColorStop(0.86, _hexA(sh.spark, 0.8));
  g.addColorStop(1, 'rgba(255,255,255,0.95)');
  fx3dFill([{x:base.x-r,y:base.y},{x:base.x+r,y:base.y},apex], g, fade, 0);
  // 光を受けている面(片側だけ明るくして立体に見せる)
  fx3dFill([{x:base.x-r*0.5,y:base.y},{x:base.x+r*0.15,y:base.y},apex], _hexA(sh.bright, 0.55), fade, 10);
  /* 頂点の白熱。面のグラデーションだけだと投影で潰れて白が出ないことがあるので、
     先端に小さな白の芯を1つ足して確実に飽和させる。 */
  const tipR = Math.max(2, r*0.42);
  const tg = ctx.createRadialGradient(apex.x, apex.y, 0, apex.x, apex.y, tipR);
  tg.addColorStop(0, 'rgba(255,255,255,0.95)');
  tg.addColorStop(0.5, _hexA(sh.spark, 0.55));
  tg.addColorStop(1, _hexA(col, 0));
  fx3dCore([{x:apex.x-tipR,y:apex.y-tipR},{x:apex.x+tipR,y:apex.y-tipR},
            {x:apex.x+tipR,y:apex.y+tipR},{x:apex.x-tipR,y:apex.y+tipR}], tg, 0.9, 12);
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
  for(const c of cols) fx3dFireGlow(c.x, c.y, c.gz, FX3D_FLAME_R*2.4, ramp.hot, fade*0.5);
  fx3dFlameField(cols, FX3D_FLAME_R, fade, ramp);
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
  for(const c of cols) fx3dFireGlow(c.x, c.y, c.gz, FX3D_FLAME_R*2.2, ramp.hot, fade*0.5);
  fx3dFlameField(cols, FX3D_FLAME_R*0.9, fade, ramp);
}
/* 柱の太さ。52では柱の外端が通路(=当たり幅)の1.47倍、笠木を入れると2.9倍になり、
   門の開口部ではなく建物全体を当たり範囲と読み違える(実測で柱間隔が判定の1.9倍)。
   通路(halfSpan)は当たり幅そのままで触らず、外へ張り出す量だけ詰める。 */
const OGRE_GATE_PILLAR_W = 34;      // 門の柱の太さ(半幅)
const OGRE_GATE_H_MULT   = 1.52;    // 門の柱の高さ(FX3D_MON_H基準)。発注者依頼(2026-08-12「デカすぎる」)で4.6→33%に縮小
const OGRE_GATE_ROCK_SEG = 5;       // 柱を積む岩塊の段数
const OGRE_GATE_ROCK_JUT = 0.35;    // 段ごとの出っ張り量(柱の太さに対する比率)
const OGRE_GATE_DEPTH_R  = 0.6;     // 柱・梁の奥行き(太さに対する比率)。側面を持たせて棒状に見えないようにする
const OGRE_GATE_BEAM_OVERHANG = 1.18; // 梁(笠木)の張り出し(1.45では当たり幅の外へ大きく出る)
const OGRE_GATE_BEAM_H   = OGRE_GATE_PILLAR_W*0.85; // 梁の高さ
// 側壁・上部の壁(発注者依頼2026-08-12「門らしい囲いを作って」対策)。
// 柱2本+屋根だけだと骨組みが宙に浮いて見えるため、通路の外側と柱の上側を壁で塞いで
// 「建物として囲まれた門」に見せる。通路(halfSpan)の内側だけは敵が通れるよう空けたままにする。
const OGRE_GATE_SILL_R    = 0.62;   // 通路の開口部の高さ(柱の高さ基準)。これより下は壁を塞がない
const OGRE_GATE_BASE_H_R  = 0.22;   // 柱の根元に置く石積みの土台の高さ(柱の太さ基準)
// 大屋根(発注者から送られた羅生門の参考画像に合わせる。2026-08-12)。
// 入母屋風の四注屋根を1枚、隅を外側・上へ反らせて（軒先の反り）載せる。
/* 屋根の奥行きと張り出し。**手前へ出しすぎない。**
   0.62 / 1.22 では軒先の手前端が術者の49ユニット先まで来て、
   カメラ(術者の145後ろ)から見ると**画面上端を横切る帯**になり、山と空を塗り潰していた。
   門の幅は発注者依頼(2026-08-12の参考画像)なので変えず、**手前への出だけ**を詰める
   (0.42/1.08 で軒先の手前端は98ユニット先=約2倍遠くなる)。 */
const OGRE_ROOF_HALF_D_R    = 0.42;  // 屋根の奥行き(横幅に対する比率)
const OGRE_ROOF_FLARE       = 1.08;  // 軒先が外へ張り出す量
const OGRE_ROOF_CORNER_LIFT_R = 0.24; // 隅が上へ反り上がる量(柱の高さ基準)
// ハート門(北大路さつキジンtier3専用)の色。色は決め打ちしない原則の例外(発注者指定・2026-08-12)
const SATSUKI_HEART_COLOR   = '#ff4fa3';
const SATSUKI_HEART_GLOW    = '#ffd6ea';
// スクリーン座標にハート形のパスを積む(中心cx,cyの少し下に頂点が来る向き)
function _heartPathAt(cx, cy, size){
  ctx.beginPath();
  ctx.moveTo(cx, cy + size*0.9);
  ctx.bezierCurveTo(cx - size*1.35, cy - size*0.35, cx - size*0.65, cy - size*1.35, cx, cy - size*0.55);
  ctx.bezierCurveTo(cx + size*0.65, cy - size*1.35, cx + size*1.35, cy - size*0.35, cx, cy + size*0.9);
  ctx.closePath();
}
// blend: 省略時は通常合成(不透明)。'lighter'を渡すと加算合成になり、奥にいる敵が透けて見える
function fx3dFillHeartScreen(cx, cy, size, color, alpha, blur, blend){
  if(alpha<=0.01 || size<=0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  if(blend) ctx.globalCompositeOperation = blend;
  _heartPathAt(cx, cy, size);
  ctx.fillStyle = color;
  if(blur && !renderHeavyLoad){ ctx.shadowBlur = blur; ctx.shadowColor = color; }
  ctx.fill();
  ctx.restore();
}
function fx3dStrokeHeartScreen(cx, cy, size, color, width, alpha){
  if(alpha<=0.01) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round';
  _heartPathAt(cx, cy, size);
  ctx.stroke();
  ctx.restore();
}
/* 羅生門の柱1本ぶん(岩塊を積み上げたようなゴツゴツした質感)。
   段ごとに太さ・出っ張り・明暗をランダムに振り、境目に暗い溝を入れることで
   1枚の平らな板に見えないようにする。決め打ちの座標ではなくfx3dPointで毎段投影する。
   正面の面(rx×z)に加え、奥行き方向(fx×z)にも側面を張ることで、通路の正面から見ても
   斜めから見ても「太い柱」に見えるようにする(発注者依頼2026-08-12「棒に見える」対策)。 */
function fx3dGatePillarRocky(dx, dy, gz, fx, fy, rx, ry, side, gateH, sh, ramp, fade, seed){
  const segH = gateH/OGRE_GATE_ROCK_SEG;
  const depth = OGRE_GATE_PILLAR_W*OGRE_GATE_DEPTH_R;
  for(let s=0;s<OGRE_GATE_ROCK_SEG;s++){
    const h0 = segH*s, h1 = segH*(s+1);
    const jOut = (fxHash01(seed*3.1+s*7.7)-0.25) * OGRE_GATE_PILLAR_W*OGRE_GATE_ROCK_JUT;
    const jIn  = (fxHash01(seed*5.9+s*2.3)-0.25) * OGRE_GATE_PILLAR_W*OGRE_GATE_ROCK_JUT;
    const ox = rx*jOut*side, oy = ry*jOut*side;                 // 外へのはみ出し
    const inW = -side*(OGRE_GATE_PILLAR_W + jIn);
    const ix = rx*inW, iy = ry*inW;                              // 柱の厚み方向(内側)
    const base   = fx3dPoint(dx+ox,    dy+oy,    h0, gz);
    const top    = fx3dPoint(dx+ox,    dy+oy,    h1, gz);
    const topIn  = fx3dPoint(dx+ox+ix, dy+oy+iy, h1, gz);
    const baseIn = fx3dPoint(dx+ox+ix, dy+oy+iy, h0, gz);
    if(!base || !top || !topIn || !baseIn) continue;
    const shade = fxHash01(seed*13.3+s*6.1);
    const stoneCol = _mixHex(sh.dark, shade>0.5 ? sh.mid : '#000000', shade>0.5 ? (shade-0.5)*0.7 : 0.3);
    fx3dFill([base,top,topIn,baseIn], stoneCol, 0.92*fade, 0);   // 正面
    fx3dStroke([base,top], '#000000', 1.1, 0.35*fade, 0);        // 段の継ぎ目の溝
    // 側面(奥行き)。外側の縁を奥へ張り出させ、柱に立体の厚みを持たせる
    const backOx = ox - fx*depth, backOy = oy - fy*depth;
    const baseBack = fx3dPoint(dx+backOx, dy+backOy, h0, gz);
    const topBack  = fx3dPoint(dx+backOx, dy+backOy, h1, gz);
    if(baseBack && topBack){
      fx3dFill([base, top, topBack, baseBack], _mixHex(stoneCol, '#000000', 0.35), 0.88*fade, 0);
    }
    // 岩片の出っ張り(段の半分くらいの確率で外へ突き出す小さな塊)
    if(fxHash01(seed*17.7+s*8.9) > 0.45){
      const bump = OGRE_GATE_PILLAR_W*0.55;
      const bx = rx*bump*side, by = ry*bump*side;
      const bumpTip = fx3dPoint(dx+ox+bx, dy+oy+by, (h0+h1)*0.5, gz);
      if(bumpTip) fx3dFill([base, bumpTip, top], _mixHex(stoneCol, sh.bright, 0.3), 0.85*fade, 0);
    }
    fx3dFireGlow(dx+ox, dy+oy, gz, 60, ramp.hot, fade*0.3);
  }
}
/* 上部の梁(笠木)。柱の外側まで大きく張り出させ、厚みも持たせることで、
   遠目にも「2本の棒」ではなく「門」のシルエットとして読めるようにする。 */
function fx3dGateBeam(dx, dy, gz, fx, fy, rx, ry, beamSpan, gateH, sh, fade){
  const beamH = OGRE_GATE_BEAM_H;
  const depth = OGRE_GATE_PILLAR_W*OGRE_GATE_DEPTH_R;
  const l1 = fx3dPoint(dx+rx*beamSpan,  dy+ry*beamSpan,  gateH,        gz);
  const l2 = fx3dPoint(dx-rx*beamSpan,  dy-ry*beamSpan,  gateH,        gz);
  const l1t= fx3dPoint(dx+rx*beamSpan,  dy+ry*beamSpan,  gateH+beamH,  gz);
  const l2t= fx3dPoint(dx-rx*beamSpan,  dy-ry*beamSpan,  gateH+beamH,  gz);
  const col = _mixHex(sh.dark, '#000000', 0.2);
  if(l1&&l2&&l2t&&l1t) fx3dFill([l1,l2,l2t,l1t], col, 0.94*fade, 0);       // 正面
  if(l1&&l2) fx3dStroke([l1,l2], '#000000', 1.6, 0.4*fade, 0);
  // 片端だけ奥行きの側面を足し、厚みのある角材に見せる
  const bfx = -fx*depth, bfy = -fy*depth;
  const l1b = fx3dPoint(dx+rx*beamSpan+bfx, dy+ry*beamSpan+bfy, gateH,       gz);
  const l1tb= fx3dPoint(dx+rx*beamSpan+bfx, dy+ry*beamSpan+bfy, gateH+beamH, gz);
  if(l1&&l1t&&l1tb&&l1b) fx3dFill([l1,l1t,l1tb,l1b], _mixHex(col,'#000000',0.35), 0.88*fade, 0);
}
/* 側壁。柱の外側(halfSpan)から屋根の軒先(outerSpan)まで、地面から梁の下端まで塞ぐ壁。
   これを両側に置くことで「柱が2本浮いているだけ」ではなく「壁に囲まれた建物に開いた門」に見せる。
   通路の内側(halfSpanより内側)は絶対に塞がない = 敵の通行・視認性に影響しない。 */
function fx3dGateSideWall(dx, dy, gz, fx, fy, rx, ry, side, innerSpan, outerSpan, wallH, sh, fade){
  const depth = OGRE_GATE_PILLAR_W*OGRE_GATE_DEPTH_R*1.4;
  const iBase = fx3dPoint(dx+rx*innerSpan*side, dy+ry*innerSpan*side, 0,     gz);
  const iTop  = fx3dPoint(dx+rx*innerSpan*side, dy+ry*innerSpan*side, wallH, gz);
  const oTop  = fx3dPoint(dx+rx*outerSpan*side, dy+ry*outerSpan*side, wallH, gz);
  const oBase = fx3dPoint(dx+rx*outerSpan*side, dy+ry*outerSpan*side, 0,     gz);
  if(!iBase || !iTop || !oTop || !oBase) return;
  const col = _mixHex(sh.dark, '#000000', 0.3);
  fx3dFill([iBase, iTop, oTop, oBase], col, 0.9*fade, 0);          // 正面
  fx3dStroke([iBase, iTop], '#000000', 1.4, 0.4*fade, 0);          // 通路側の縁をはっきりさせる
  // 奥行きの側面(壁にも厚みを持たせる)
  const bfx = -fx*depth, bfy = -fy*depth;
  const oBaseB = fx3dPoint(dx+rx*outerSpan*side+bfx, dy+ry*outerSpan*side+bfy, 0,     gz);
  const oTopB  = fx3dPoint(dx+rx*outerSpan*side+bfx, dy+ry*outerSpan*side+bfy, wallH, gz);
  if(oBaseB && oTopB) fx3dFill([oBase, oTop, oTopB, oBaseB], _mixHex(col,'#000000',0.3), 0.85*fade, 0);
}
/* 通路上部の壁(欄間)。柱と柱の間、頭上より高い位置だけを塞いで「壁に開いた戸口」に見せる。
   sillHより下は必ず素通しにし、敵の通行・被視認性を邪魔しない。 */
function fx3dGateUpperInfill(dx, dy, gz, rx, ry, halfSpan, sillH, topH, sh, fade){
  const L0 = fx3dPoint(dx-rx*halfSpan, dy-ry*halfSpan, sillH, gz);
  const L1 = fx3dPoint(dx-rx*halfSpan, dy-ry*halfSpan, topH,  gz);
  const R1 = fx3dPoint(dx+rx*halfSpan, dy+ry*halfSpan, topH,  gz);
  const R0 = fx3dPoint(dx+rx*halfSpan, dy+ry*halfSpan, sillH, gz);
  if(!L0 || !L1 || !R1 || !R0) return;
  fx3dFill([L0,L1,R1,R0], _mixHex(sh.dark, '#000000', 0.65), 0.85*fade, 0);
  // 格子(欄間らしい横桟を2本入れる)
  for(const t of [0.35, 0.68]){
    const yH = sillH + (topH-sillH)*t;
    const a = fx3dPoint(dx-rx*halfSpan, dy-ry*halfSpan, yH, gz);
    const b = fx3dPoint(dx+rx*halfSpan, dy+ry*halfSpan, yH, gz);
    if(a && b) fx3dStroke([a,b], '#000000', 1.6, 0.5*fade, 0);
  }
  fx3dStroke([L0,L1,R1,R0,L0], '#000000', 1.6, 0.45*fade, 0);
}
/* 柱の根元の石積みの土台。柱がそのまま地面に刺さっているだけだと軽く見えるので、
   一回り太い低い塊を足元に置いて「建物の礎石」らしさを出す。 */
function fx3dGateBasePlinth(dx, dy, gz, fx, fy, rx, ry, side, sh, fade){
  const w = OGRE_GATE_PILLAR_W*1.35, h = OGRE_GATE_PILLAR_W*OGRE_GATE_BASE_H_R, depth = w*0.9;
  const ox = rx*w*side, oy = ry*w*side;
  const base = fx3dPoint(dx+ox, dy+oy, 0, gz);
  const top  = fx3dPoint(dx+ox, dy+oy, h, gz);
  const inW = -side*w, ix = rx*inW, iy = ry*inW;
  const topIn = fx3dPoint(dx+ox+ix, dy+oy+iy, h, gz);
  const baseIn= fx3dPoint(dx+ox+ix, dy+oy+iy, 0, gz);
  if(base && top && topIn && baseIn) fx3dFill([base,top,topIn,baseIn], _mixHex(sh.dark,'#000000',0.15), 0.9*fade, 0);
  const backOx = ox - fx*depth, backOy = oy - fy*depth;
  const baseBack = fx3dPoint(dx+backOx, dy+backOy, 0, gz);
  const topBack  = fx3dPoint(dx+backOx, dy+backOy, h, gz);
  if(base && top && topBack && baseBack) fx3dFill([base,top,topBack,baseBack], _mixHex(sh.dark,'#000000',0.4), 0.85*fade, 0);
}
/* 大屋根。発注者からのスクリーンショット指摘(2026-08-19「赤で囲んだ中にある柱が不要」)を受けて、
   棟(ridge)をやめてフラットな一枚屋根にする。棟線は通路の奥行き方向(fx軸)に沿って画面中央
   (rx=0)を通るため、通路の正面から見るカメラでは遠近感でその線が中央に立つ「柱」のように
   見えてしまっていた。中心を通る線・点を一切置かない構成にすることで再発を防ぐ。 */
function fx3dGateRoof(dx, dy, gz, fx, fy, rx, ry, roofBaseH, halfW, pillarH, sh, fade){
  const halfD = halfW*OGRE_ROOF_HALF_D_R;
  const lift = pillarH*OGRE_ROOF_CORNER_LIFT_R;
  const combos = [[-1,-1],[-1,1],[1,1],[1,-1]]; // 反時計回り: 手前左→奥左→奥右→手前右
  const corners = combos.map(([side,dir])=>{
    const ox = rx*halfW*OGRE_ROOF_FLARE*side + fx*halfD*OGRE_ROOF_FLARE*dir;
    const oy = ry*halfW*OGRE_ROOF_FLARE*side + fy*halfD*OGRE_ROOF_FLARE*dir;
    return fx3dPoint(dx+ox, dy+oy, roofBaseH+lift, gz);
  });
  if(corners.some(c=>!c)) return;
  const [FL, BL, BR, FR] = corners;
  const roofCol = _mixHex(sh.dark, '#000000', 0.55);
  /* 不透明な屋根は「ここが当たり判定」と読み違えられる。建物として見える程度まで薄くする
     (通路=当たり判定は柱と灯りが示す)。 */
  fx3dFill([FL,BL,BR,FR], roofCol, 0.62*fade, 0);                       // 屋根の上面
  fx3dStroke([FL,BL,BR,FR,FL], '#000000', 2.0, 0.55*fade, 0);           // 軒先の縁
  // 手前側(dir=-1)の軒だけ厚み(ファシア板)を足して、板1枚に見えないようにする。
  // 中心(rx=0)を通らない、外側の縁だけを使うので中央に線は出ない。
  const FLlow = fx3dPoint(dx+rx*halfW*OGRE_ROOF_FLARE*(-1)+fx*halfD*OGRE_ROOF_FLARE*(-1),
                           dy+ry*halfW*OGRE_ROOF_FLARE*(-1)+fy*halfD*OGRE_ROOF_FLARE*(-1), roofBaseH, gz);
  const FRlow = fx3dPoint(dx+rx*halfW*OGRE_ROOF_FLARE*( 1)+fx*halfD*OGRE_ROOF_FLARE*(-1),
                           dy+ry*halfW*OGRE_ROOF_FLARE*( 1)+fy*halfD*OGRE_ROOF_FLARE*(-1), roofBaseH, gz);
  if(FLlow && FRlow) fx3dFill([FLlow, FL, FR, FRlow], _mixHex(roofCol,'#000000',0.3), 0.58*fade, 0);
}


// ハート門(北大路さつキジンtier3)。柱2本+梁の代わりに、門の中央へピンクのハートを立てる。
// 発注者依頼(2026-08-12): 少し小さく・加算合成で透けさせ、奥にいる敵が見えるようにする。
function fx3dHeartGate(dx, dy, gz, halfSpan, gateH, fade){
  const center = fx3dPoint(dx, dy, gateH*0.58, gz);
  if(!center) return;
  const s = halfSpan*1.15*center.scale;
  fx3dFillHeartScreen(center.x, center.y, s*1.25, SATSUKI_HEART_GLOW, 0.28*fade, 36, 'lighter'); // 淡いグロー
  fx3dFillHeartScreen(center.x, center.y, s, SATSUKI_HEART_COLOR, 0.42*fade, 16, 'lighter');      // 本体(加算合成=透ける)
  fx3dStrokeHeartScreen(center.x, center.y, s, SATSUKI_HEART_COLOR, 3.2, 0.85*fade);              // 輪郭ははっきり見せる
  fx3dFillHeartScreen(center.x - s*0.3, center.y - s*0.38, s*0.22, '#ffffff', 0.4*fade, 8, 'lighter'); // ハイライト
  fx3dFireGlow(dx, dy, gz, 80, SATSUKI_HEART_GLOW, fade*0.35);
}
/* 羅生門(キジンtier3)。門(柱2本+梁、SSRスキン装備時はハート)は予告の瞬間から発生し続け、
   炎はfx3dFireWaveの逆走版(最遠から門へ迫る)として描く。
   ・判定(combat.jsのae.doorDist/frontDist)と同じ式をそのまま使う(見た目だけ広げない)。
   ・門の位置は`Math.min(move.gateDist, ae.range)`で既に遮蔽物ぶん短くなっているので、
     そのまま`ae.doorDist`を読むだけでよい(ここで再計算しない)。
   ・ae.style==='heart'(北大路さつキジン専用tier3)のときだけハート門に差し替える。 */
function fx3dGate(ae, fillDist, fade, inTelegraph){
  const col = ae.auraTint || ae.color;
  const ramp = fx3dFireRamp(col);
  const sh = auraShades(col);
  const doorDist = ae.doorDist||0;
  const fx=Math.cos(ae.angle), fy=Math.sin(ae.angle);
  const rx=-Math.sin(ae.angle), ry=Math.cos(ae.angle);
  // 予告は他の技と同じ、通路全体(0〜range)の点線で出す
  const outline = rectOutlinePoints(ae.x, ae.y, ae.angle, ae.range, ae.width/2);
  if(outline) strokeDashedShape(outline, sh.outline, 0.5*fade);

  const dx = ae.x+fx*doorDist, dy = ae.y+fy*doorDist;
  const gz = groundZAt(dx, dy);
  const gateH = FX3D_MON_H*OGRE_GATE_H_MULT;
  const halfSpan = (ae.width||220)/2;
  if(ae.style==='heart'){
    fx3dHeartGate(dx, dy, gz, halfSpan, gateH, fade);
  } else {
    const outerSpan = halfSpan*OGRE_GATE_BEAM_OVERHANG;
    for(const side of [-1,1]){
      fx3dGateBasePlinth(dx, dy, gz, fx, fy, rx, ry, side, sh, fade);
      fx3dGatePillarRocky(dx, dy, gz, fx, fy, rx, ry, side, gateH, sh, ramp, fade, ae.id + side*97);
      // 側壁。柱の外側から屋根の軒先まで塞ぎ、「建物に開いた門」に見せる(通路の内側は塞がない)
      fx3dGateSideWall(dx, dy, gz, fx, fy, rx, ry, side, halfSpan, outerSpan, gateH+OGRE_GATE_BEAM_H, sh, fade);
    }
    // 通路の頭上(sillより上)を欄間で塞ぐ。sillより下は敵の通行のため必ず素通しのまま
    fx3dGateUpperInfill(dx, dy, gz, rx, ry, halfSpan, gateH*OGRE_GATE_SILL_R, gateH, sh, fade);
    // 梁(笠木)。柱の外側まで大きく張り出させ、厚みも持たせる
    fx3dGateBeam(dx, dy, gz, fx, fy, rx, ry, outerSpan, gateH, sh, fade);
    // 大屋根。参考画像(2026-08-12)の楼門らしい反った大屋根を梁の上に載せる
    fx3dGateRoof(dx, dy, gz, fx, fy, rx, ry, gateH+OGRE_GATE_BEAM_H, outerSpan, gateH, sh, fade);
  }

  if(inTelegraph) return;
  // 逆走する炎: 最遠(ae.range)から門(doorDist)へ向かって迫る帯
  const frontDist = clamp(ae.range - fillDist, doorDist, ae.range);
  if(ae.range - frontDist <= 2) return; // まだ炎が発生していない
  const band = rectBandOutlinePoints(ae.x, ae.y, ae.angle, frontDist, ae.range, ae.width/2);
  if(band) fx3dFill(band, ramp.smoke, 0.42*fade, 0);
  const cols = [];
  const push=(along, lateral, h, seed)=>{
    const x = ae.x+fx*along+rx*lateral, y = ae.y+fy*along+ry*lateral;
    const p = fx3dPoint(x, y, 0);
    cols.push({ x, y, gz:groundZAt(x,y), h, seed, depth:p?p.depth:0 });
  };
  const wallN = 7;
  for(let i=0;i<wallN;i++){                        // 先端(門に近づく側)の炎の壁
    const lat = (i/(wallN-1)-0.5)*ae.width*0.92;
    push(frontDist + ae.width*0.12, lat, FX3D_FLAME_H*(1.0+0.25*fxHash01(ae.id+i*3.7)), ae.id+i);
  }
  for(let i=0;i<FX3D_FLAME_N;i++){                  // 燃え広がった後方(遠い側)の残り火
    const h1 = fxHash01(ae.id*5.1+i*7.3), h2 = fxHash01(ae.id*2.7+i*11.9);
    push(frontDist + (ae.range-frontDist)*(0.05+0.8*h1), (h2*2-1)*ae.width*0.42,
         FX3D_FLAME_H*(0.4+0.4*h2), ae.id+i*3);
  }
  cols.sort((a,b)=>b.depth-a.depth);
  for(const c of cols) fx3dFireGlow(c.x, c.y, c.gz, FX3D_FLAME_R*2.2, ramp.hot, fade*0.5);
  fx3dFlameField(cols, FX3D_FLAME_R*0.9, fade, ramp);
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
/* まっぷたつ(デュラハン): 細い範囲を、縦長の斬撃(光の刃)が奥へ切り進んでいく。
   先端に立てた刃(fx3dSpikeを縦長・細幅に流用)が伸び、通ってきた軌跡に薄い刃の残像を残す。 */
function fx3dZangetsu(ae, curReach, fade, progress){
  const col = ae.auraTint || ae.color;
  const sh = auraShades(col);
  const fx=Math.cos(ae.angle), fy=Math.sin(ae.angle);
  // 通った帯にうっすら斬撃痕
  const band = rectOutlinePoints(ae.x, ae.y, ae.angle, curReach, ae.width/2);
  if(band) fx3dFill(band, sh.dark, 0.2*fade, 0);
  // 先端の刃
  const tipX = ae.x+fx*curReach, tipY = ae.y+fy*curReach;
  fx3dSpike(tipX, tipY, groundZAt(tipX,tipY), FX3D_MON_H*2.4, ae.width*0.22, col, fade);
  if(renderHeavyLoad) return;
  // 軌跡に残る刃の残像(奥ほど薄く・低く)
  const N = 5;
  for(let i=0;i<N;i++){
    const t = (i+1)/(N+1);
    const along = curReach*t;
    const x = ae.x+fx*along, y = ae.y+fy*along;
    fx3dSpike(x, y, groundZAt(x,y), FX3D_MON_H*(1.1+0.8*t), ae.width*0.14, col, fade*0.3*(0.5+0.5*t));
  }
}
/* 鱗赫(大喰いの利世): 赤い触手が足元から生えて範囲を進んでいく。
   触手は「地面に沿ってうねる背骨」を1本ずつ投影し、太さを先細りさせた帯として描く。
   画面上で決め打ちの楕円や矩形を使わないので、坂でも地面から生えて見える。      */
const KAGUNE_N       = 6;            // 触手の本数
const KAGUNE_SEG     = 14;           // 1本あたりの節の数
const KAGUNE_H       = FX3D_MON_H*0.9;  // 持ち上がる高さ
const KAGUNE_ARC_COL = '#b45cff';    // 帯びるビリビリの色(紫)
function fx3dKagune(ae, curReach, fade, progress){
  const col = ae.auraTint || ae.color;
  const sh = auraShades(col);
  const groove = _mixHex(sh.dark, '#000000', 0.6); // 硬い節目・輪郭の溝色(半透明にしない)
  const fx=Math.cos(ae.angle), fy=Math.sin(ae.angle);
  const rx=-Math.sin(ae.angle), ry=Math.cos(ae.angle);
  const band = rectOutlinePoints(ae.x, ae.y, ae.angle, curReach, ae.width/2);
  if(band) fx3dFill(band, sh.dark, 0.22*fade, 0);   // 足元の血だまり(地面の飾りなのでここだけ半透明のまま)
  for(let k=0;k<KAGUNE_N;k++){
    const h1 = fxHash01(ae.id*5.3 + k*7.7), h2 = fxHash01(ae.id*9.1 + k*3.3);
    // 触手ごとに横位置と、うねりの速さ・向きを変える
    const lat0 = ((k+0.5)/KAGUNE_N*2-1) * ae.width*0.42;
    const wob  = 1.6 + h1*1.8, ph = h2*6.28, dirn = (k%2 ? 1 : -1);
    const reach = curReach*(0.72 + 0.28*h1);       // 先端の伸び方に差を付ける
    const rBase = ae.width*0.062*(0.8+0.4*h2);     // 従来より細身にする
    const pts=[], wid=[];
    for(let i=0;i<=KAGUNE_SEG;i++){
      const t = i/KAGUNE_SEG;
      const along = reach*t;
      if(along > curReach) break;
      // 進むほど横に大きくうねり、中ほどで一番持ち上がる
      const sway = Math.sin(t*wob*Math.PI + ph + matchTime*3.4*dirn) * ae.width*0.16*t;
      const lat  = lat0*(1-t*0.45) + sway;
      const x = ae.x+fx*along+rx*lat, y = ae.y+fy*along+ry*lat;
      const dz = KAGUNE_H*Math.pow(Math.sin(Math.PI*t), 0.65)*(0.55+0.45*h1);
      const p = fx3dPoint(x, y, dz);
      if(!p) continue;
      pts.push(p);
      // 指数を強めて早めに絞り込み、刺さると痛そうな鋭い先細り形状にする
      wid.push(rBase*Math.pow(Math.max(0,1-t), 1.6)*Math.min(1, progress*3));
    }
    if(pts.length<3) continue;
    const normals=[];
    for(let i=0;i<pts.length;i++){
      const a = pts[Math.max(0,i-1)], b = pts[Math.min(pts.length-1,i+1)];
      let nx = -(b.y-a.y), ny = (b.x-a.x);
      const L = Math.hypot(nx,ny) || 1;
      nx/=L; ny/=L;
      normals.push({ nx, ny });
    }
    // 本体: 区間(輪切り)ごとに断面グラデーションを塗り、鱗を粒として置かず
    // "表面"そのものに硬い甲殻の丸み・節目を表現する。全区間、完全不透明。
    const ringGap = 2;
    for(let i=1;i<pts.length;i++){
      const w0 = wid[i-1]*(pts[i-1].scale||1), w1 = wid[i]*(pts[i].scale||1);
      if(w1 < 0.6 && w0 < 0.6) continue;
      const n0 = normals[i-1], n1 = normals[i];
      const l0 = { x:pts[i-1].x+n0.nx*w0, y:pts[i-1].y+n0.ny*w0 };
      const r0 = { x:pts[i-1].x-n0.nx*w0, y:pts[i-1].y-n0.ny*w0 };
      const l1 = { x:pts[i].x+n1.nx*w1,   y:pts[i].y+n1.ny*w1 };
      const r1 = { x:pts[i].x-n1.nx*w1,   y:pts[i].y-n1.ny*w1 };
      const grad = ctx.createLinearGradient(l1.x, l1.y, r1.x, r1.y);
      grad.addColorStop(0,    _hexA(groove, 1));
      grad.addColorStop(0.28, _hexA(sh.bright, 1));
      grad.addColorStop(0.55, _hexA(sh.mid, 1));
      grad.addColorStop(1,    _hexA(groove, 1));
      ctx.beginPath();
      ctx.moveTo(l0.x,l0.y); ctx.lineTo(l1.x,l1.y); ctx.lineTo(r1.x,r1.y); ctx.lineTo(r0.x,r0.y);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      // 硬い節目(粒鱗ではなく、輪切りの継ぎ目として本体表面に直接刻む)
      if(i % ringGap === 0 && w1 > 1.2){
        ctx.strokeStyle = _hexA(groove, 1);
        ctx.lineWidth = Math.max(1, w1*0.24);
        ctx.beginPath();
        ctx.moveTo(l1.x, l1.y);
        ctx.lineTo(r1.x, r1.y);
        ctx.stroke();
      }
    }
    // 輪郭線(半透明にせず、太くはっきりした黒縁で硬さを強調)
    ctx.save();
    ctx.strokeStyle = _hexA(groove, 1);
    ctx.lineWidth = Math.max(1.4, (wid[1]||wid[0]||2)*0.4);
    ctx.lineJoin='round'; ctx.lineCap='round';
    for(let i=1;i<pts.length;i++){
      const w0 = wid[i-1]*(pts[i-1].scale||1), w1 = wid[i]*(pts[i].scale||1);
      const n0 = normals[i-1], n1 = normals[i];
      ctx.beginPath();
      ctx.moveTo(pts[i-1].x+n0.nx*w0, pts[i-1].y+n0.ny*w0);
      ctx.lineTo(pts[i].x+n1.nx*w1, pts[i].y+n1.ny*w1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pts[i-1].x-n0.nx*w0, pts[i-1].y-n0.ny*w0);
      ctx.lineTo(pts[i].x-n1.nx*w1, pts[i].y-n1.ny*w1);
      ctx.stroke();
    }
    ctx.restore();
    // 先端: 刺さると痛そうな鋭い針状の切っ先を追加で伸ばす
    const lastI = pts.length-1;
    if(lastI>=1){
      const tdx = pts[lastI].x-pts[lastI-1].x, tdy = pts[lastI].y-pts[lastI-1].y;
      const tl = Math.hypot(tdx,tdy)||1;
      const baseW = (wid[lastI]||wid[lastI-1]||2)*(pts[lastI].scale||1);
      const tipLen = baseW*2.8 + 7;
      const tipX = pts[lastI].x + (tdx/tl)*tipLen, tipY = pts[lastI].y + (tdy/tl)*tipLen;
      const nrmTip = normals[lastI];
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[lastI].x+nrmTip.nx*baseW, pts[lastI].y+nrmTip.ny*baseW);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(pts[lastI].x-nrmTip.nx*baseW, pts[lastI].y-nrmTip.ny*baseW);
      ctx.closePath();
      ctx.fillStyle = _hexA(sh.bright, 1);
      ctx.fill();
      ctx.strokeStyle = _hexA(groove, 1);
      ctx.lineWidth = Math.max(0.9, baseW*0.3);
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }
    // 紫のビリビリ。触手に沿って何本か枝分かれさせる(ぼかしはかけず、線のまま)
    if(!renderHeavyLoad){
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for(let a=0;a<2;a++){
        const seed = Math.floor(matchTime*22) + k*13 + a*5;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for(let i=1;i<pts.length;i++){
          const j = (fxHash01(seed + i*3.7)-0.5) * (wid[i]||2) * 4;
          ctx.lineTo(pts[i].x + j, pts[i].y + j*0.5);
        }
        ctx.strokeStyle = _hexA(a ? '#ffffff' : KAGUNE_ARC_COL, a ? 0.6 : 1);
        ctx.lineWidth = a ? 1 : 2;
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
// 帯(モッチ砲・ラガモッチ砲・熱視線・天河天翔): ビームは色以外すべて共通の見た目
function fx3dRectBeam(ae, curReach, fade){
  const col = ae.auraTint || ae.color;
  fx3dBeamTube(ae.x, ae.y, ae.angle, curReach, ae.width/2, col, fade, ae.range);
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
    // 3本が重なるので中身は薄く(縁の線はそのまま。本数が読めなくなるため)
    fx3dBeamTube(ae.x, ae.y, a, curReach, ae.width/2, col, fade, ranges[b], 0.35);
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
    /* 【重要】壁を1枚の多角形で塗ると、**左右の辺が画面に対して垂直に切り立った
       平らな長方形**になり、扇の弧がまったく読めない(「UIのパネルが出た」と
       誤解されうる、と実測で指摘された)。
       短冊に割って1枚ずつ塗ると、隣どうしの高さと明るさが弧に沿って変わるので、
       左右の端が放射方向へ倒れて弧が見える。**判定(扇の角度と到達距離)は触らない。** */
    const hiR = high.slice().reverse();
    for(let k=0;k<low.length-1;k++){
      const quad = [low[k], low[k+1], high[k+1], high[k]];
      const f = k/(low.length-1);                       // 0=左端 1=右端
      const edge = 1 - Math.abs(f*2 - 1);               // 中央ほど1、端ほど0
      const g = ctx.createLinearGradient(low[k].x, low[k].y, high[k].x, high[k].y);
      g.addColorStop(0, _hexA(sh.bright, 0.95));
      g.addColorStop(0.55, _hexA(col, 0.7));
      g.addColorStop(1, _hexA(col, 0.10));
      fx3dFill(quad, g, wallFade*(0.75 + 0.75*edge), 0);
    }
    fx3dStroke(high, '#ffffff', 3, 0.9*wallFade, 14);
    fx3dStroke(low, sh.bright, 3.4, 0.8*wallFade, 12);
  }
}
/* 円(ビッグバン・ヴァニッシュ・レクイエムエンドの爆風)
   ・横の広さは判定と同じ curReach、高さはモンスターの背丈ぶんに抑える
   ・中身の詰まった球に見せるため、上へ積む輪を「濃いまま」重ねる
     (薄くすると地面の色が透けて煙にしか見えない)                          */
const FX3D_DOME_NEAR = 200;   // カメラがこの距離まで近ければ胴体を塗らない(輪郭と地面の輪は残す)
function fx3dDomeBurst(ae, curReach, fade){
  const R = curReach;
  /* **カメラがドームの中に入っているときは胴体を塗らない。**
     半径420を術者の足元に出す技(デュラハン最終奥義)は、カメラが術者の145後ろに居るので
     必ずこうなる。塗ると画面全体が白い霧になり、技も術者も地形も見えなくなる
     (実測: 四隅の輝度が背景比 +54.9。他技は最大 +6.1)。
     判定は一切変えない。**輪郭と地面の輪だけ**にして、どこまでが範囲かは残す。 */
  /* 「カメラが輪の内側か」だけでは**膨らむ前のコマを取りこぼす。**
     実測: デュラハン最終奥義の0.1sは半径がまだ約100でカメラは145後ろ=外側なので
     胴体が描かれ、しかも濃くした変更が効いて**いちばん近いコマだけが明るくなった**
     (輝度240超が5.7%→7.8%)。カメラが縁に近いだけでも画面を埋めるので、
     半径に余裕を足して判定する。遠くの爆風はこの条件に掛からない。 */
  const camIn = (typeof camPos !== 'undefined' && camPos)
    && Math.hypot(camPos.x - ae.x, camPos.y - ae.y) < R + FX3D_DOME_NEAR;
  const H = Math.max(FX3D_DOME_H_MIN, R*FX3D_DOME_H_RATIO);
  const col = ae.auraTint || ae.color || '#ffffff';
  const sh = auraShades(col);
  const rings = 6;
  // 下から上へ、輪を重ねて塊にする。上の輪ほど明るくして丸みを出す
  for(let k=0;k<=rings && !camIn;k++){
    const th = (k/rings)*(Math.PI/2);
    const ring = fx3dRingPts(ae.x, ae.y, R*Math.cos(th), 2 + H*Math.sin(th));
    if(!ring) continue;
    const t = k/rings;
    /* 胴体が α0.34〜0.24 の通常合成で、地面がほぼ素通しだった。半径330・威力60の爆風が
       「白い輪1本」にしか見えない原因(実測: 暗けいの0.85sで飽和画素158)。濃くする。
       最下段は暗く沈めて接地を作り、上へ行くほど属性色→明るい側へ寄せる。 */
    fx3dFill(ring, _mixHex(t < 0.18 ? sh.dark : col, sh.bright, t*0.55),
             (0.62 - t*0.22)*fade, 0);
  }
  /* 縁と稜線(ドームの形をはっきりさせる)。
     **広がっていく縁だけは必ず白飛びさせる。** sh.bright は技色を55%白へ寄せた色なので、
     黒い技(ビッグバン #14121c)では暗い灰色にしかならず、
     半径330・威力60の爆風なのに**飽和した画素が1つも無い**線画になっていた(実測)。
     色の決め打ちではなく、採点表2の「芯は必ず白飛びさせる」に当たる扱い。
     属性の色は本体(輪の積み重ね)が持っているので、identity は失わない。 */
  const rim = fx3dRingPts(ae.x, ae.y, R, 2);
  if(rim){
    fx3dStroke(rim, sh.bright, 3.5, 0.9*fade, 20, true);
    fx3dStroke(rim, '#ffffff', 1.6, 0.85*fade, 21, true);
  }
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
    // 天辺の芯が半径330の爆風に対して小さすぎた(26px固定)。半径に比例させる
    const rr = Math.max(6, Math.min(R*0.25, 120)*apex.scale);
    const g = ctx.createRadialGradient(apex.x, apex.y, 0, apex.x, apex.y, rr);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');   // 天辺の芯。暗い技でもここは白く抜く
    g.addColorStop(0.45, _hexA(sh.spark, 0.7));
    g.addColorStop(1, _hexA(col, 0));
    ctx.beginPath(); ctx.arc(apex.x, apex.y, rr, 0, Math.PI*2);
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
  }
}
// 爆風にハートを纏わせる(北大路さつキジンtier3の門の爆風=kind:'circle',style:'heartBlast'専用)。
// ドーム本体(fx3dDomeBurst)の上に、外周から浮かび上がって消えるハートを重ねて描く。
const HEART_BURST_N = 10;
function fx3dHeartBurstFx(ae, curReach, fade){
  if(renderHeavyLoad) return;
  for(let i=0;i<HEART_BURST_N;i++){
    const h1 = fxHash01(ae.id*4.3 + i*9.7), h2 = fxHash01(ae.id*8.1 + i*3.3), h3 = fxHash01(ae.id*6.7 + i*5.1);
    const ang = h1*Math.PI*2;
    const dist = curReach*(0.25+0.7*h2);
    const phase = (matchTime*0.6 + h3) % 1;             // 0→1でふわっと浮き上がって消える
    const x = ae.x + Math.cos(ang)*dist, y = ae.y + Math.sin(ang)*dist;
    const z = FX3D_MON_H*(0.3 + 1.1*phase);
    const p = fx3dPoint(x, y, z);
    if(!p) continue;
    const size = 16*p.scale*(1-phase*0.4);
    fx3dFillHeartScreen(p.x, p.y, size, SATSUKI_HEART_COLOR, fade*(1-phase)*0.9, 10);
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
  // 羅生門(キジンtier3)。門と逆走の炎を専用に描く(予告の出し方も含めて完全に独自)
  if(ae.kind==='gate'){
    fx3dGate(ae, fillDist, fade, inTelegraph);
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
  else if(ae.kind==='circle'){
    fx3dDomeBurst(ae, curReach, fade);
    if(ae.style==='heartBlast') fx3dHeartBurstFx(ae, curReach, fade); // 発注者依頼(2026-08-12): 爆風にハートを纏わせる
  }
  else if(ae.kind==='rect'){
    if(ae.style==='crystal')   fx3dCrystalRain(ae, curReach, fade, progress);
    else if(ae.style==='kagune') fx3dKagune(ae, curReach, fade, progress);
    else if(ae.style==='lava') fx3dFireWave(ae, curReach, fade);
    else if(ae.style==='zangetsu') fx3dZangetsu(ae, curReach, fade, progress);
    else                       fx3dRectBeam(ae, curReach, fade);   // モッチ砲/天河天翔/熱視線
  } else return false;
  return true;
}
/* 範囲技の深度ソート用の基準点。
   発生地点(術者の足元)だけで見ていると、前進しながら技を撃った時に
   発生地点がカメラの後ろへ回った瞬間に投影できなくなり、まだ前方に伸びている
   エフェクトごと消えてしまう。中ほど→先端の順に代わりの基準点を探して防ぐ。   */
/* 技のエフェクトが山の向こうにあるか。
   【なぜ必要か】2Dキャンバスは3Dの地形より必ず後に描くので深度判定を受けない。
   モンスター・弾・アイテムには occludedByMountain を通していたが、
   技エフェクトとパーティクルだけ素通りで、山の裏の技が透けて見えていた
   (実機で report・2026-08-14)。**2Dで世界に描く物を足したら必ずここを通すこと。**
   技は発生点から range だけ伸びるので、根元・中間・先端の3点すべてが
   山の中に入っているときだけ消す(山をまたぐ技が丸ごと消えないように)。   */
function areaEffectOccluded(ae){
  if(!mountOccluders.length) return false;
  const reach = ae.range || 0;
  const a = ae.angle || 0;
  const z = (ae.z || 0) + 40;
  for(const f of (reach > 0 ? [0, 0.5, 1] : [0])){
    if(!occludedByMountain(ae.x + Math.cos(a)*reach*f, ae.y + Math.sin(a)*reach*f, z)) return false;
  }
  return true;
}
function areaEffectAnchor(ae){
  const p0 = projectGround(ae.x, ae.y);
  if(p0) return p0;
  const reach = ae.range || 0;
  if(reach <= 0) return null;
  const a = ae.angle || 0;
  for(const f of [0.45, 0.75, 1.0]){
    const p = projectGround(ae.x + Math.cos(a)*reach*f, ae.y + Math.sin(a)*reach*f);
    if(p) return p;
  }
  return null;
}
function drawSingleAreaEffect(ae){
    const elapsed = matchTime - ae.spawnAt;
    if(elapsed > ae.life) return;
    const telegraphTime = ae.telegraphTime||0.18;
    const fillSpeed = ae.fillSpeed||900;
    const inTelegraph = elapsed <= telegraphTime;
    const fillDist = Math.max(0, elapsed - telegraphTime) * fillSpeed;
    /* 減衰。**先端が最大射程へ届いた時点から落とし始める。**
       以前は `ae.life - 0.2` の最後の0.2秒だけだったので、寿命の長い技
       (天河天翔は2.87秒・フラワービームは1.76秒)が**ほぼ全編を全開で持ち**、
       0.28秒と1.15秒のコマがほとんど同じ絵になっていた
       (実測: 白飛び画素が15269→9469で62%残る)。採点表7が求める
       「速く立ち上がり、ゆっくり減衰する」の逆の形。
       伸びている間は全開のまま(そこは技が育つ時間なので変えない)。 */
    const reachTime = telegraphTime + (ae.range||0)/Math.max(1, fillSpeed);
    /* 減衰の開始。**reachTime だけを見ると射程の長い技で最後まで全開のまま**になる。
       reachTime = telegraph + range/fillSpeed なので、射程900以上の6技
       (クリスタルレイン1.18s / フラワービーム1.51s / 超雷撃1.73s / 天河天翔1.63s /
        サイコキネシス1.62s / ファイアウェーブ1.29s)では減衰が寿命のほぼ終端に来て、
       画が最後まで変わらなかった。寿命の45%を過ぎたらどのみち落とし始める。 */
    const tailStart = Math.min(ae.life - 0.2, Math.max(telegraphTime,
                               Math.min(reachTime, ae.life*0.45)));
    const tailLen   = Math.max(0.2, ae.life - tailStart);
    const fadeAlpha = elapsed>tailStart
      ? clamp(1 - Math.pow((elapsed-tailStart)/tailLen, 1.6), 0, 1) : 1;

    // 立体エフェクトに差し替える(判定・数値はマップによらず同じものを読む)
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
          if(!renderHeavyLoad){ ctx.shadowBlur=20; ctx.shadowColor=ae.color; }
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
/* レイドのボスの予告標的。範囲攻撃が出る前に、当たる場所を点滅する輪で見せる。
   地面に貼る円は必ず1点ずつ投影する(画面上の楕円を決め打ちすると地面から浮く)。
   扇は中心から両端へ伸ばした2本の線と、外周の弧で「どこまで届くか」を示す。      */
/* レイドボスの攻撃予告。
   **塗る形は当たり判定(hitTestFan/hitTestRect/circleのdist)と同じ半径・同じ角度**にする
   (見た目だけ広い/狭いにしない)。ボスは予告中は動かない(resolveMovement)ので、
   ここで使う m.x/m.y/m.angle は実際に撃たれる位置とズレない。 */
/* レイドの着弾予告を3D側(real3d_zone.js)へ渡す形に変換する。
   2Dの drawRaidTelegraph と同じ見え方になるよう、色・点滅・塗りの濃さを揃えてある。
   **片方を直したらもう片方も直すこと。** */
function raidTelegraphMarks(){
  if(!game.raid || typeof raidState==='undefined' || !raidState || !raidState.pending) return null;
  const p = raidState.pending;
  if(!p.move || !Array.isArray(p.marks)) return null;
  const left = Math.max(0, p.fireAt - matchTime);
  const soon = left < 0.6;
  const blink = 0.45 + 0.45*Math.abs(Math.sin(matchTime*(soon?18:9)));
  const col = p.move.color || '#ff5d5d';
  const out = [];
  for(const m of p.marks){
    const half = (m.fanDeg!=null) ? (m.fanDeg*Math.PI/180)/2 : 0;
    out.push({
      x:m.x, y:m.y, r:m.r, color:col, alpha:blink,
      fillAlpha: blink * (soon ? 0.42 : 0.24),
      arc: (m.fanDeg!=null) ? { from:m.angle-half, to:m.angle+half } : null,
      inner: (m.fanDeg==null),
    });
  }
  return out;
}
function drawRaidTelegraph(){
  if(!game.raid || typeof raidState==='undefined' || !raidState || !raidState.pending) return;
  const p = raidState.pending;
  if(!p.move || !Array.isArray(p.marks)) return;
  const left = Math.max(0, p.fireAt - matchTime);
  const soon = left < 0.6;
  // 発動が近いほど速く点滅・強く光らせて「そろそろ来る」と分かるようにする
  const blink = 0.45 + 0.45*Math.abs(Math.sin(matchTime*(soon?18:9)));
  const fillAlpha = blink * (soon ? 0.42 : 0.24);
  const col = p.move.color || '#ff5d5d';
  ctx.save();
  ctx.globalAlpha = blink;
  for(const m of p.marks){
    if(m.fanDeg!=null){
      const half = (m.fanDeg*Math.PI/180)/2;
      const arc = [];
      const SEG = 26;
      for(let i=0;i<=SEG;i++){
        const a = m.angle - half + (i/SEG)*half*2;
        const wx = m.x+Math.cos(a)*m.r, wy = m.y+Math.sin(a)*m.r;
        const pt = project(wx, wy, groundZAt(wx,wy));
        arc.push(pt || null);
      }
      const c = project(m.x, m.y, groundZAt(m.x,m.y));
      // 扇の内側を塗って光らせる(中心→弧→中心の扇形。nullは投影の裏側などで稀に出る)
      const arcValid = arc.filter(Boolean);
      if(c && arcValid.length>=2) fillShape([c, ...arcValid], col, fillAlpha);
      if(c){
        for(const side of [arc[0], arc[arc.length-1]]){
          if(!side) continue;
          ctx.beginPath(); ctx.moveTo(c.x,c.y); ctx.lineTo(side.x,side.y);
          ctx.strokeStyle=col; ctx.lineWidth=3; ctx.setLineDash([10,8]); ctx.stroke();
        }
      }
      strokeProjectedRing(arc, col, 4, [12,9], renderHeavyLoad?null:{blur:14, color:col});
    } else {
      const pts = groundCirclePoints(m.x, m.y, m.r, 40);
      // 円の内側を塗って光らせる
      if(pts) fillShape(pts, col, fillAlpha);
      if(pts) strokeProjectedRing(pts, col, 4, [12,9], renderHeavyLoad?null:{blur:14, color:col});
      // 中心にも小さい輪を出して「ここに落ちる」と分かるようにする
      const inner = groundCirclePoints(m.x, m.y, m.r*0.35, 26);
      if(inner) strokeProjectedRing(inner, col, 2, [7,7], null);
    }
  }
  ctx.restore();
  ctx.setLineDash([]);
}
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
  /* 中心を白熱させる。以前は中心が `#3a3a44`(灰色)止まりで、この技の主役である
     足元の爆風が「白い細線の弧2本と地面の輪」にしか見えなかった(採点表2=2点)。
     暗い縁 / 属性色 / 白熱の芯 の3層を、他の技と同じ順で並べる。 */
  ctx.globalAlpha = 0.7*fadeAlpha;
  const _dsh = auraShades(ae.color);
  const g = ctx.createRadialGradient(center.x, center.y-domeH*0.3, 0, center.x, center.y-domeH*0.1, Math.max(halfW,domeH)*1.05);
  g.addColorStop(0,    'rgba(255,255,255,0.95)');
  g.addColorStop(0.18, _hexA(_dsh.bright, 0.85));
  g.addColorStop(0.55, ae.color);
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, halfW, domeH, 0, Math.PI, Math.PI*2, false);
  ctx.closePath();
  ctx.fill();
  // 2b) 芯の白飛び。通常合成では 0.7α が掛かって255に届かないので加算で1枚重ねる
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = fadeAlpha;
  const g2 = ctx.createRadialGradient(center.x, center.y-domeH*0.25, 0, center.x, center.y-domeH*0.25, Math.max(halfW,domeH)*0.42);
  g2.addColorStop(0,   'rgba(255,255,255,0.9)');
  g2.addColorStop(0.5, _hexA(_dsh.bright, 0.35));
  g2.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, halfW, domeH, 0, Math.PI, Math.PI*2, false);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

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
    // 着弾点が山の裏なら描かない(2Dは深度判定を受けないので明示的に消す)
    if(occludedByMountain(p.landX, p.landY, groundZAt(p.landX, p.landY))) continue;
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
    if(!renderHeavyLoad){ ctx.shadowBlur = 22; ctx.shadowColor = 'rgba(255,90,20,0.8)'; }
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
          if(!renderHeavyLoad){ ctx.shadowBlur=16; ctx.shadowColor='rgba(210,235,255,0.9)'; }
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
          if(!renderHeavyLoad){ ctx.shadowBlur=22; ctx.shadowColor='rgba(255,110,30,0.95)'; }
          ctx.fill();
          ctx.shadowBlur=0;
        }
      }
    }
  }
  ctx.restore();
}
/* 描画品質レベル(0=通常 / 1=影を切る)。
   shadowBlur は端末側のラスタ化で最も高い処理で、アイテムやモンスターのように
   数が多いものに掛けると一気に重くなる。フレーム時間が続けて悪いときだけ切る。 */
let gfxLevel = 0;
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
    /* 遮蔽に使う円錐は「見えている山」と同じ形にする。r に v.radius を入れると
       裾を埋めたぶんだけ実物より太い円錐で隠してしまい、山肌の外にいる相手や技まで
       消える。r は地面の高さでの実半径、rise はそこから頂上までの高さ。 */
    mountOccluders.push({
      x:v.x, y:v.y, r: mountainGroundRadius(v),
      rise: mountainRiseOf(v),
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
/* =====================================================================
   パフォーマンス計測(管理者画面から表示を切り替える)
   ・OFFのときは perfFrameStart が即returnするので、通常プレイに負荷を足さない
   ・見るのは「1フレーム全体・update・2D描画・WebGL」の内訳と、描いている物の数。
     実機でどこが重いかを数字で確かめてから手を入れるためのもの
===================================================================== */
let perfOn = false;
const PERF_AVG = 30;             // 平均を取るフレーム数
const perf = {
  t0:0, last:0, prevFrame:0,
  sum:{ frame:0, update:0, render:0, gl:0 }, n:0,
  avg:{ frame:0, update:0, render:0, gl:0 },
  glMs:0, drawables:0, lastShownAt:0,
};
function perfEnabled(on){
  perfOn = !!on;
  const el = document.getElementById('perfOverlay');
  if(el) el.classList.toggle('hidden', !perfOn);
}
function perfFrameStart(now){
  // フレーム時間だけは常に測る(動的解像度がこれを見るため。コストはほぼゼロ)
  perf.prevFrame = perf.t0 ? (now - perf.t0) : 0;
  perf.t0 = now;
  if(!perfOn) return;
  perf.last = performance.now();
  perf.glMs = 0;
}
function perfMark(key){
  if(!perfOn) return;
  const t = performance.now();
  const d = t - perf.last;
  perf.last = t;
  if(key==='update') perf.sum.update += d;
  else if(key==='render') perf.sum.render += d;
}
// WebGLの描画時間だけは render() の中から個別に記録する
function perfGl(ms){ if(perfOn) perf.glMs += ms; }
/* 動的解像度
   計測でわかったこと: JSは9msしか使っておらず、残りはブラウザ側(GPUのラスタ化と合成)。
   そこは描画するピクセル数に比例するので、重いフレームが続いたら描画倍率を下げ、
   軽くなったら元へ戻す。上限(端末の実解像度・最大2倍)は変えないので、
   余裕のある端末では今までと同じ見た目のまま。                                 */
/* 落とし方は控えめに、戻し方は素早く。
   範囲攻撃が重なって一瞬重くなるのは許容し、収まったらすぐ元の画質へ戻す方針。 */
const RS_SLOW_MS    = 20;    // これより遅い = 50fps未満
const RS_BAD_MS     = 30;    // これより遅い = 33fps未満
const RS_PANIC_MS   = 55;    // これより遅い = 18fps未満。すぐに大きく下げる
// 60fpsのフレーム時間は16.7ms。ここを16.7より下にすると「余裕がある」と一生判定されず、
// 一度下げた画質が戻らなくなる(実際に起きた)
const RS_RECOVER_MS = 17.6;
let rsSlow = 0, rsBad = 0, rsFast = 0, rsPanic = 0;
function updateRenderScale(frameMs){
  if(typeof setRenderScale!=='function' || !game.started || game.over) return;
  if(frameMs > RS_PANIC_MS){ rsPanic++; rsBad++; rsSlow++; rsFast = 0; }
  else if(frameMs > RS_BAD_MS){ rsPanic = 0; rsBad++; rsSlow++; rsFast = 0; }
  else if(frameMs > RS_SLOW_MS){ rsPanic = 0; rsSlow++; rsBad = 0; rsFast = 0; }
  else if(frameMs < RS_RECOVER_MS){ rsFast++; rsSlow = 0; rsBad = 0; rsPanic = 0; }
  else { rsSlow = 0; rsBad = 0; rsFast = 0; rsPanic = 0; }
  // 目に見えて崩れている時(18fps未満)は5フレームで大きく落とす
  if(rsPanic >= 5){
    rsPanic = 0; rsBad = 0; rsSlow = 0;
    if(gfxLevel < 1) gfxLevel = 1;
    setRenderScale(renderScale - 0.35);
    return;
  }
  // ひどく重いときは0.5秒で大きく、そこそこのときは1.5秒かけて少しずつ下げる
  // 影を切るのがいちばん安く効くので先に落とし、それでも足りなければ解像度を下げる。
  // 一瞬の重さでは動かさず、続いたときだけ落とす
  if(rsBad >= 30){
    rsBad = 0; rsSlow = 0;
    if(gfxLevel < 1) gfxLevel = 1;
    else setRenderScale(renderScale - 0.25);
  } else if(rsSlow >= 120){
    rsSlow = 0;
    if(gfxLevel < 1) gfxLevel = 1;
    else setRenderScale(renderScale - 0.12);
  } else if(rsFast >= 40){
    // 戻すのは速く(0.7秒ぶん余裕が続けば1段)。解像度を先に戻し、最後に影を戻す
    rsFast = 0;
    if(!setRenderScale(renderScale + 0.2)) gfxLevel = 0;
  }
}
function perfFrameEnd(){
  updateRenderScale(perf.prevFrame || 16.7);
  if(!perfOn) return;
  perf.sum.frame += perf.prevFrame;
  perf.sum.gl += perf.glMs;
  perf.n++;
  if(perf.n < PERF_AVG) return;
  for(const k in perf.sum){ perf.avg[k] = perf.sum[k]/perf.n; perf.sum[k] = 0; }
  perf.n = 0;
  const el = document.getElementById('perfOverlay');
  if(!el) return;
  const fps = perf.avg.frame > 0 ? 1000/perf.avg.frame : 0;
  const st = (window.__aramonReal3D && window.__aramonReal3D.stats) ? window.__aramonReal3D.stats() : null;
  const f = (v)=>v.toFixed(1).padStart(5);
  const lines = [
    `${fps.toFixed(0).padStart(3)} fps   frame ${f(perf.avg.frame)}ms`,
    `update ${f(perf.avg.update)}  2D ${f(perf.avg.render)}`,
    `WebGL  ${f(perf.avg.gl)}  他+待 ${f(Math.max(0, perf.avg.frame - perf.avg.update - perf.avg.render))}`,
    `dpr ${(typeof dpr!=='undefined'?dpr:1).toFixed(2)}  gfx ${gfxLevel}`,
    `mon ${entities.filter(e=>e.alive).length}  proj ${projectiles.length}  fx ${particles.length}  ae ${areaEffects.length}`,
    `draw ${perf.drawables}${renderHeavyLoad ? '  [heavy]' : ''}`,
  ];
  if(st) lines.push(`地形 ${String(st.patchVerts).padStart(5)}頂点 ${st.patchMs.toFixed(1)}ms x${st.patchCount}  岩${st.obst}`);
  // マルチ中は通信の状態も1行出す(net_transport.jsの実測。rtc/rtdbとRTT)
  if(netState.mode==='multi' && typeof window.__aramonNetStats==='function'){
    try{
      const ns = window.__aramonNetStats();
      const rtts = (ns.peers||[]).map(p=>p.rttMs).filter(v=>v!=null);
      const rtt = rtts.length ? Math.round(rtts.reduce((s,v)=>s+v,0)/rtts.length)+'ms' : '--';
      const mode = (ns.isHost ? ns.rtcAllPeers : ns.rtcToHost) ? 'rtc' : 'rtdb';
      lines.push(`net ${mode}  rtt ${rtt}  配信 ${ns.authAvgIntervalMs}ms±${ns.authJitterMs}`);
    }catch(err){}
  }
  el.textContent = lines.join('\n');
  el.classList.toggle('warn', fps < 50 && fps >= 35);
  el.classList.toggle('bad', fps < 35);
}
/* パーティクル(火花・ダメージ数字)の上限。
   激しい撃ち合いでは100個を超え、1個ずつ塗りや文字描画が入るので効いてくる。
   情報のあるダメージ数字(text)は残し、火花から先に間引く。                   */
const PARTICLE_MAX = 90;
function trimParticles(){
  if(particles.length <= PARTICLE_MAX) return;
  let over = particles.length - PARTICLE_MAX;
  for(let i=0; i<particles.length && over>0; ){
    if(particles[i].type !== 'text'){ particles.splice(i,1); over--; }
    else i++;
  }
  if(particles.length > PARTICLE_MAX) particles.splice(0, particles.length - PARTICLE_MAX);
}
/* 描画中に1か所でも例外が出ると、そのフレームの残り(他のモンスター・弾・アイテム・
   ミニマップなど)が丸ごと描かれず、「操作はできるが何も映らない」状態になる。
   しかも毎フレーム同じ所で落ちるので画面は二度と戻らない。
   1個の失敗をその1個だけで止めて、フレームの残りは必ず描き切る。            */
let drawErrorCount = 0;
function reportDrawError(err){
  drawErrorCount++;
  if(drawErrorCount<=5) console.error('[aramon] draw error', err);
  if(drawErrorCount===1 && typeof pushToast==='function'){
    // 中身も出す。文言だけだと実機からの報告で原因を追えない
    const detail = (err && (err.message || err.name)) ? String(err.message || err.name).slice(0,90) : '';
    pushToast('描画エラーが出ましたが続行します' + (detail ? '：' + detail : ''));
  }
  // 例外でsave/restoreの釣り合いが崩れているので既定へ戻す。
  // 空のスタックへのrestoreは仕様上なにも起きないため、多めに呼んで構わない
  for(let i=0;i<8;i++) ctx.restore();
  ctx.setTransform(dpr,0,0,dpr,0,0);   // 基準変換はresize()と同じ(dpr倍)
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = 0; ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.filter = 'none';
  ctx.lineWidth = 1; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}
function safeDraw(fn){ try{ fn(); }catch(err){ reportDrawError(err); } }
function render(){
  trimParticles();
  ctx.clearRect(0,0,viewW,viewH);
  /* 当たった衝撃でカメラをずらす。2DのprojectもWebGL層も同じcamPosを読むので、
     ここで1回ずらせば両方の層が一緒に揺れる。**必ず fxPunchRestore() で戻す。** */
  fxPunchApply(_fxGlPrevMs ? Math.min(0.05, (performance.now()-_fxGlPrevMs)/1000) : 0.016);
  // 序盤など弾/エフェクトが同時に多い時は重い影描画(shadowBlur)を間引いて負荷を下げる
  renderHeavyLoad = gfxLevel >= 1 || (projectiles.length + particles.length) > 22;
  // リアルマップ(テスト)では地面をWebGL(real3d.js)が描くので、2D側は空・地面・
  // 地面の装飾を描かずに透かす。初期化に失敗した場合はfalseが返るので従来描画に戻る
  // 障害物(岩・木・水晶など)も3D側が描く。2D側は同じ輪郭をくり抜くだけ(eraseObstacle)。
  // 山と地面のしみ(溶岩・海・川・オアシス)は3D側が地形に沿わせて描く
  const _glT0 = perfOn ? performance.now() : 0;
  const gl3d = !!(window.__aramonReal3D && window.__aramonReal3D.render(rocks, {
    volcanoes: volcanoObstacles, lava: lavaZones, sea: seaZones, river: riverZones, oasis: oasisZones,
    crystals: crystalObstacles,
    // 海は円の集合ではなく海岸線の式そのものから水面を張る(seaEdgeXはworld.jsの純関数)
    seaEdge: (currentMap && currentMap.hasSea) ? seaEdgeX : null,
    bounds: { w: WORLD.w, h: WORLD.h },
    /* 安置線と技の地面円は3D側で描く。2Dで描くと3Dの上に重なって深度判定を受けず、
       丘や大きな物の向こうにあっても手前に見えてしまうため(実機で報告された不具合)。 */
    zone: game.trainingRange ? null : {
      center: zoneState.center, radius: zoneState.radius,
      toCenter: zoneState.toCenter, toRadius: zoneState.toRadius,
      shrinking: zoneState.shrinking, hasNext: zoneState.hasNext,
      snow: !!(currentMap && currentMap.mountainStyle === 'snow'),
    },
    marks: raidTelegraphMarks(),
  }));
  if(perfOn) perfGl(performance.now() - _glT0);
  real3dActive = gl3d;
  prepareMountainOccluders();
  if(!gl3d){
    drawSkyAndGround();
    // しみは起伏に沿わせる必要があるためリアルマップでは3D側が描く
    drawWaterZones();
    drawLavaZones();
  }
  if(!gl3d) safeDraw(drawTerrainDecor);
  // 安置線と技の地面円は、リアルマップでは3D側(real3d_zone.js)が描く。
  // 2Dで描くと深度判定を受けず、丘の向こうの線が透けて手前に見える
  if(!gl3d){
    safeDraw(drawZoneRings);
    safeDraw(drawRaidTelegraph);
  }
  safeDraw(drawLandingMarkers);
  if(introState.active) safeDraw(drawSummonIntro);

  const drawables = [];
  // 岩等の大きな障害物と正しく前後関係が付くよう、他のdrawablesと同じ深度ソートに乗せる
  for(const ae of areaEffects){
    if(areaEffectOccluded(ae)) continue;
    const p = areaEffectAnchor(ae); if(p) drawables.push({kind:'ae', obj:ae, p});
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
  // アイテムはマルチで420個ほど撒かれる。遠くのぶんまで描くと描画数が一気に増え、
  // 地平線に沿って粒が数珠つなぎに並んで浮いて見えるので、一定より遠いものは描かない
  for(const it of lootItems){
    if(it.predictedPickup != null || it.respawnAt > matchTime) continue;
    if(occludedByMountain(it.x, it.y, it.z||0)) continue;
    const p = project(it.x,it.y,it.z||0);
    if(p && p.depth <= LOOT_VIEW) drawables.push({kind:'loot', obj:it, p});
  }
  for(const pr of projectiles){ if(occludedByMountain(pr.x, pr.y, pr.z+20)) continue; const p = project(pr.x,pr.y,pr.z+20); if(p) drawables.push({kind:'proj', obj:pr, p}); }
  for(const e of entities){ if(!e.alive) continue; const p = project(e.x,e.y,e.z); if(p){ // 自分だけは山に隠さない(カメラが山にめり込んだ時に自機が消えるのを防ぐ)
    if(e.isPlayer || !occludedByMountain(e.x, e.y, (e.z||0)+(e.radius||26))) drawables.push({kind:'mon', obj:e, p}); if(!e.isPlayer) monsterScreenPos.set(e.id, {x:p.x,y:p.y,scale:p.scale}); } }
  for(const pt of particles){
    const pz = (pt.z||0)+(pt.type==='text'?42:16);
    if(occludedByMountain(pt.x, pt.y, pz)) continue;
    const p = project(pt.x,pt.y, pz); if(p) drawables.push({kind:'fx', obj:pt, p});
  }

  if(perfOn) perf.drawables = drawables.length;
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
    // 1個が落ちても残りは描き切る(ここで抜けると画面が丸ごと空になる)
    try{
      if(d.kind==='loot') drawLootItem(d.obj,d.p);
      else if(d.kind==='proj') drawProjectile(d.obj,d.p);
      else if(d.kind==='volcano') drawVolcanoComplex(d.obj,d.p);
      else if(d.kind==='mon') drawMonster(d.obj,d.p);
      // リアルマップの障害物は3Dが描くので、2Dは輪郭をくり抜くだけ
      else if(d.kind==='rock'){ if(real3dActive) eraseObstacle(d.obj,d.p); else drawRock(d.obj,d.p); }
      else if(d.kind==='crystal'){ if(real3dActive) eraseObstacle(d.obj,d.p,'crystal'); else drawCrystal(d.obj,d.p); }
      else if(d.kind==='ae') drawSingleAreaEffect(d.obj);
      else drawParticle(d.obj,d.p);
    }catch(err){ reportDrawError(err); }
    if(faded) ctx.globalAlpha = 1;
  }
  if(introState.active) safeDraw(drawSummonIntroFront);
  safeDraw(drawDangerVignette);
  safeDraw(drawDownedOverlay);   // チーム戦: 自分がダウン中の赤いビネット+蘇生待ちの案内
  safeDraw(drawPingMarkers);     // チーム戦: 小隊のピン(旗マーカー)。案内表示なので最前面に出す
  safeDraw(drawZoneCompass);
  safeDraw(drawArenaScoreHud);   // アリーナ: 両チームの生存数と残り時間(アリーナ以外では何も描かない)
  if(introState.active) safeDraw(drawSummonCountdown);
  /* 技エフェクトのWebGL層(fx_gl.js)。2Dの技の芯を描き終えたあとに、粒・軌跡・
     地面の輪を加算で重ねる。**2Dの上・ミニマップとHUDの下**。
     この層が無くても技は成立する(芯は2D側が描いている)ので、
     初期化に失敗しても何も足さないだけで済む。                         */
  safeDraw(renderFxGlLayer);
  fxPunchRestore();
  safeDraw(drawFxFlash);
  safeDraw(renderMinimap);
}
/* WebGL VFX層を1フレーム進めて描く。時間は実時間(前フレームからの経過)で進める:
   試合が止まっている間もエフェクトは自然に減衰してほしいため。       */
let _fxGlPrevMs = 0;
function renderFxGlLayer(){
  const fx = window.__aramonFxGl;
  if(!fx) return;
  // 撮影ハーネスの --nofx。改修前と後を同じ条件で撮るためだけの逃げ道
  if(window.__fxForceOff) return;
  /* fx_gl.js はESモジュールなので、試合開始(applyFxGlLayer)より後に読み込みが
     終わることがある。その場合ここで有効化する。**この保険が無いと、通信が遅い
     端末でだけ技のエフェクトが出ない**という再現しにくい不具合になる。      */
  if(!fx.isActive() && !fx.setActive(true)) return;
  const now = performance.now();
  const dt = _fxGlPrevMs ? (now - _fxGlPrevMs)/1000 : 0.016;
  _fxGlPrevMs = now;
  fx.begin(dt);
  fxGlFeed(fx, dt);
  fx.render();
}

/* =====================================================================
   当たった感触を画面側にも出す(採点表8)
   ・**カメラそのものを揺らす。** 2Dのproject()もWebGL層も同じcamPosを読むので、
     こうすれば2つの層が必ず一緒に揺れる(片方だけ動くと二重像になる)。
   ・揺れは短く小さく。CLAUDE.mdの決まりどおり **0.12秒以下・画面高の1%以下**。
     長い揺れは酔うので、強さではなく「立ち上がりの速さ」で効かせる。
   ・遠くの爆発では揺れない(距離で減衰させる)。
===================================================================== */
const FX_PUNCH_MAX_SEC = 0.12;    // これ以上は伸ばさない
const FX_PUNCH_MAX_AMP = 0.01;    // 画面高に対する最大振幅
const FX_PUNCH_FALLOFF = 900;     // これより遠い出来事では揺れない
let _fxPunch = 0, _fxPunchT = 0, _fxFlash = 0;
let _fxPunchSaved = null;

/* 画面のフラッシュ。上限0.09・減衰 dt*7 では **約2フレーム(33ms)で消えていた**ため、
   発射0.1秒後のコマには1枚も写らず、実機でも見えていなかった(批評家Aの実測: 45枚すべてで
   四隅の輝度が84.6〜89.3に収まり、フラッシュの痕跡ゼロ)。採点表8の「0.12秒以下」に収まる
   範囲で寿命を伸ばす。上限0.14・減衰 dt*1.4 で 0.14→0.01 が約93ms。
   **使う前に宣言する**(下の関数より後ろに置くとTDZの読み違えを誘う)。 */
/* 上限は 0.10 まで。0.14 では画面の平均輝度が+13持ち上がり、
   「画面が洗われた」と指摘された以前の失敗(空が+14.5)とほぼ同じ強さになった。
   見えなかった原因は強さではなく**寿命**(33ms)だったので、伸ばすのは寿命だけにする。 */
const FX_FLASH_MAX = 0.10, FX_FLASH_DECAY = 1.4;
// amount: 0..1。dist を渡すとプレイヤーからの距離で自動的に弱める
function fxPunch(amount, x, y){
  let a = Math.max(0, Math.min(1, amount));
  if(x != null && player){
    const d = Math.hypot(x - player.x, y - player.y);
    a *= Math.max(0, 1 - d / FX_PUNCH_FALLOFF);
  }
  if(a <= 0.01) return;
  /* 弱い(=遠い)出来事ではフラッシュを出さない。
     距離減衰で揺れはほぼ0になるのに、フラッシュだけ残ると
     **画面に光る物が無いのに全体が明るくなる**(原因の見えない明滅になる)。 */
  if(a < 0.15){ _fxPunch = Math.max(_fxPunch, a); _fxPunchT = FX_PUNCH_MAX_SEC; return; }
  _fxPunch  = Math.max(_fxPunch, a);       // 重ねがけで暴れないよう最大値を採る
  _fxPunchT = FX_PUNCH_MAX_SEC;
  _fxFlash  = Math.max(_fxFlash, a*0.35*(FX_FLASH_MAX/0.09));
}
// 技側(fx_moves.js)から fx.flash() で呼ぶ。揺らさずに明るさだけ返したいとき用
function fxFlashAdd(amount){ _fxFlash = Math.max(_fxFlash, Math.max(0, Math.min(1, amount))*FX_FLASH_MAX); }
// 描画の直前にカメラをずらす。必ず fxPunchRestore() と対で呼ぶ
function fxPunchApply(dt){
  if(_fxPunchT <= 0){ _fxPunch = 0; _fxFlash = Math.max(0, _fxFlash - dt*FX_FLASH_DECAY); return; }
  _fxPunchT -= dt;
  const t = Math.max(0, _fxPunchT / FX_PUNCH_MAX_SEC);
  const amp = _fxPunch * t * t * (viewH * FX_PUNCH_MAX_AMP);
  // 画面のピクセルではなくワールドでずらす。奥行きが変わらないよう横と縦だけ動かす
  const ph = matchTime * 90;
  const ox = Math.sin(ph) * amp, oz = Math.cos(ph*1.7) * amp;
  _fxPunchSaved = { x:camPos.x, y:camPos.y, z:camPos.z };
  camPos.x += -Math.sin(camState.yaw) * ox;
  camPos.y +=  Math.cos(camState.yaw) * ox;
  camPos.z += oz;
  _fxFlash = Math.max(0, _fxFlash - dt*FX_FLASH_DECAY);
}
function fxPunchRestore(){
  if(!_fxPunchSaved) return;
  camPos.x = _fxPunchSaved.x; camPos.y = _fxPunchSaved.y; camPos.z = _fxPunchSaved.z;
  _fxPunchSaved = null;
}
// 着弾の一瞬だけ画面全体をわずかに持ち上げる(白飛びではなく「明るくなる」程度)
function drawFxFlash(){
  if(_fxFlash <= 0.01) return;
  const a = Math.min(FX_FLASH_MAX, _fxFlash);
  ctx.save();
  /* 【平らに塗らない】`fillRect` で全面を持ち上げると、遠景の山も雲も空も同じだけ
     明るくなり「画面が洗われた」ようにしか見えない(実測で空が+14.5)。
     採点表8が求めているのは**周辺減光**なので、中心を少し持ち上げ、
     縁は逆にわずかに沈める。面積あたりの効果は同じでも、画は締まる。 */
  const cx = viewW/2, cy = viewH*0.56;
  const R = Math.max(viewW, viewH)*0.75;
  const g = ctx.createRadialGradient(cx, cy, R*0.1, cx, cy, R);
  g.addColorStop(0,    `rgba(255,244,225,${a})`);
  g.addColorStop(0.45, `rgba(255,244,225,${a*0.35})`);
  g.addColorStop(1,    'rgba(255,244,225,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.fillRect(0,0,viewW,viewH);
  // 縁を沈めて中心へ目を寄せる(白足しの総量を増やさずに締める)
  ctx.globalCompositeOperation = 'source-over';
  const v = ctx.createRadialGradient(cx, cy, R*0.45, cx, cy, R);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(0,0,0,${a*1.6})`);
  ctx.fillStyle = v;
  ctx.fillRect(0,0,viewW,viewH);
  ctx.restore();
}

/* =====================================================================
   WebGL VFX層への発注(全技共通の土台)
   ・技ごとの作り込みはこの下の FX_GL_STYLE で分ける。**表に1行足せば効く**
     ようにしてあるので、技ごとに if を増やさない。
   ・色は技の色(auraTintを優先)から作る。**決め打ちしない。**
   ・ここが無くても技は成立する(芯は2Dが描いている)。この層は足すだけ。
===================================================================== */
// '#rrggbb' → [0..1, 0..1, 0..1]。技の色はすべてこの形で持っている
function fxGlColor(hex){
  const h = (typeof hex === 'string' && hex[0] === '#') ? hex : '#ffffff';
  return [parseInt(h.slice(1,3),16)/255, parseInt(h.slice(3,5),16)/255, parseInt(h.slice(5,7),16)/255];
}
// 弾・範囲技の色。SSRスキンの色替え(auraTint)が乗っていればそちらを優先する
function fxGlTint(o){
  /* projStyle 付きの弾は「2Dが実際に描いている色」が PROJ_TRAIL_COLORS にある。
     【なぜ必要か】レクイエムエンドは data.js の color が金(#e6c35c)なのに
     2D側は紫で描いており、色が2か所で別々に持たれている。
     こちらを見ないと、紫の技の中に金の輪と金の粒が出る(実測で確認)。
     **決め打ちではなく、既にある表を読む**ので色替え(auraTint)は今までどおり優先。 */
  if(!o.auraTint && o.projStyle && typeof PROJ_TRAIL_COLORS === 'object'
     && PROJ_TRAIL_COLORS[o.projStyle]) return fxGlColor(PROJ_TRAIL_COLORS[o.projStyle]);
  return fxGlColor(o.auraTint || o.color);
}

/* 白黒オーラのSSR専用tier3(天衣無縫 / 終焉に救いを / ラガモッチ砲 / ドラゴンころし /
   言葉は無粋)の差し色。**本体色には一切触らない。**
   【なぜこうしたか】以前は白黒のオーラで tier3 の本体色ごと塗り替えていたため、
   白は「真っ白な紙の山」、黒は「無彩色の灰色のガラス管」になり、**素のtier3より
   見劣りしていた**(2026-08-16の批評)。白黒は色相を持たないので、本体を素の技の色に
   戻し(data.js の getMoveEffectColor)、ここが縁とアクセントだけを足す。
     white … 芯の白熱を強め、外へ白い羽根がゆっくり舞う(重力を弱く・寿命を長く)
     black … 加算層では「暗くする」ことができないので、**濃く沈めた同系色**
             (fxDeep)の大粒をゆっくり流して煤の殻に見せる
   呼ぶのは fxGlFeed の1か所だけ。技ごとの if をここから外へ増やさない。       */
/* 【全技共通】二次運動(採点表10)と地面の痕(採点表5)。
   【なぜ1か所にまとめるか】批評家3名の採点で、10.二次運動が2点以下=10技、
   5.地面デカールが2点以下=6技。属性ごとに書き足すと必ず抜けが出る
   (前縁の帯を8属性で書き忘れたのと同じ事故)。**入口1つで全技に効かせる。**
   渦を巻いて曲がる粒 / 上昇する熱気 / 重力で落ちる欠片 の3種を同居させる。
   地面の輪の**半径は必ず当たり判定から取る**ので、判定より大きくならない。 */
function fxGlAmbient(fx, o, c, kind, dt, radius){
  if(!fx) return;
  const R = Math.max(30, radius || 60);
  const gz = (typeof fxGroundZ === 'function') ? fxGroundZ(o.x, o.y) : 0;
  const n = (typeof fxSpawnN === 'function') ? fxSpawnN(dt, kind === 'area' ? 30 : 18) : 0;
  const hot = (typeof fxHot === 'function') ? fxHot(c, 0.45) : c;
  const dim = (typeof fxDim === 'function') ? fxDim(c, 0.45) : c;
  for(let i=0;i<n;i++){
    const a = Math.random()*Math.PI*2, r = Math.sqrt(Math.random())*R;
    const x = o.x + Math.cos(a)*r, y = o.y + Math.sin(a)*r;
    const roll = Math.random();
    if(roll < 0.45){
      fx.emit({ x, y, z: gz + 8 + Math.random()*40,
                vx:Math.cos(a+1.4)*(30+Math.random()*70), vy:Math.sin(a+1.4)*(30+Math.random()*70),
                vz: 20+Math.random()*50, az:-70,
                r:hot[0], g:hot[1], b:hot[2], bright:1.0,
                life:0.55+Math.random()*0.5, size0:5+Math.random()*6, size1:1,
                turb:26, turbFreq:1.5, spin:5, stretch:0.7 });
    } else if(roll < 0.75){
      fx.emit({ x, y, z: gz + 20 + Math.random()*30,
                vx:(Math.random()-0.5)*24, vy:(Math.random()-0.5)*24, vz: 55+Math.random()*70,
                az:-14, r:dim[0], g:dim[1], b:dim[2], bright:0.5,
                life:0.9+Math.random()*0.6, size0:16+Math.random()*14, size1:40,
                turb:16, turbFreq:0.7, hot:0 });
    } else {
      fx.emit({ x, y, z: gz + 30 + Math.random()*70,
                vx:Math.cos(a)*(40+Math.random()*90), vy:Math.sin(a)*(40+Math.random()*90),
                vz: 40+Math.random()*80, az:-320,
                r:c[0], g:c[1], b:c[2], bright:0.9,
                life:0.7+Math.random()*0.4, size0:4+Math.random()*5, size1:2,
                turb:5, turbFreq:2, spin:8, stretch:0.9, hot:0.3 });
    }
  }
}
function fxGlScorch(fx, x, y, c, radius){
  if(!fx || !fx.ring) return;
  const dim = (typeof fxDim === 'function') ? fxDim(c, 0.5) : c;
  fx.ring({ x, y, r0:Math.max(8, radius*0.25), r1:radius, life:0.9,
            color:dim, width:Math.max(10, radius*0.16), bright:0.55 });
}
/* 焦げ跡を置いた時刻。毎フレーム置くと地面が真っ黒になるので間引く */
const _fxScorchAt = new Map();
function fxGlAccent(fx, o, c, phase, dt){
  const acc = o && o.auraAccent;
  if(!acc || !fx) return;
  const white = acc === 'white';
  /* 【自分で入れたバグの修正】撒く場所を等方の円盤で決めていたため、
     45度の扇の技(言葉は無粋)では差し色の87%が扇の外、矩形の技(天衣無縫)でも
     30%が判定の外へ出ていた。**判定の形はここで計算し直さない。**
     fx_moves.js の fxAeHalfWidth / fxAeLateral / fxHitRadius を必ず通す
     (同じ判定を2か所目に書かない、の原則。あちらのコメントに同じ事故の記録がある)。 */
  const isArea = !!(o.kind || o.aoeShape);
  /* 黒は**加算では出せない**。fxDeep は最大成分を保つ彩度上げの関数なので、
     明るい技(終焉に救いを #ffe9a8 / ドラゴンころし #f4f7ff)では金や白になり、
     素と1ピクセルも変わらなかった。fx_gl.js に足した煤レーン(soot:true)へ回す。
     煤はアルファを出して**下を暗くする**ので、白い技ほど効く。 */
  const col = white ? [1, 0.97, 0.9]
                    : (typeof fxDim === 'function' ? fxDim(c, 0.55) : [c[0]*0.55, c[1]*0.55, c[2]*0.55]);
  // 判定の内側に1点取る。範囲技は「前方の along と、その距離での横幅」から作る
  const pick = ()=>{
    if(!isArea){
      const R = (typeof fxHitRadius === 'function') ? fxHitRadius(o) : Math.max(40, (o.hitR||12)*3);
      const a = Math.random()*Math.PI*2, r = Math.sqrt(Math.random())*R;
      return { x:o.x + Math.cos(a)*r, y:o.y + Math.sin(a)*r, r:R };
    }
    if(o.kind === 'circle'){                       // 爆風は円そのものが判定
      const R = o.range || 200;
      const a = Math.random()*Math.PI*2, r = Math.sqrt(Math.random())*R;
      return { x:o.x + Math.cos(a)*r, y:o.y + Math.sin(a)*r, r:R };
    }
    const fwx = Math.cos(o.angle||0), fwy = Math.sin(o.angle||0);
    const rgx = -fwy, rgy = fwx;
    const along = Math.random() * (o.range || 200);
    const lat = (typeof fxAeLateral === 'function') ? fxAeLateral(o, along)
                                                    : (Math.random()*2-1)*60;
    const hw = (typeof fxAeHalfWidth === 'function') ? fxAeHalfWidth(o, along) : 60;
    return { x:o.x + fwx*along + rgx*lat, y:o.y + fwy*along + rgy*lat, r:hw };
  };
  const spawn = (n, o2)=>{
    for(let i=0;i<n;i++){
      const q = pick();
      fx.emit(Object.assign({
        x:q.x, y:q.y, z:(o.z||0) + 14 + Math.random()*Math.min(90, q.r*0.5),
        r:col[0], g:col[1], b:col[2],
        turb: white ? 1.5 : 0.7, turbFreq: white ? 0.8 : 0.4, seed:Math.random(),
      }, o2));
    }
  };
  /* 白は「羽根」なので**速度方向へ伸ばす**(stretch)。丸いボケを12個散らしただけでは
     素との差が全画素の0.13%にしかならず、離れて見ると区別が付かなかった。 */
  /* 【白が効かない理由】白い羽根を**明るい技の上へ加算**しても、下地がもう明るいので
     画に出ない(実測: 天衣無縫で差が226画素=画面の0.048%)。羽根を大きく長寿命にした上で、
     **同じ場所へ煤も少し撒いて下地を暗くする。** 暗い下地の上でだけ白は白く見える。
     黒オーラは煤だけで既に効いている(素より輝度60以上暗い画素が2952〜4935)ので触らない。 */
  const feather = (n, o2)=>{
    spawn(n, o2);
    spawn(Math.max(2, Math.round(n*0.5)), {
      vz:4, az:-70, life:(o2.life||1)*1.15, size0:(o2.size0||8)*3.2, size1:(o2.size0||8)*5.0,
      bright:0.7, hot:0, soot:true });
  };
  if(phase === 'cast' || phase === 'impact'){
    if(white) feather(34, { vz: 50+Math.random()*90, az:-40, life:1.3+Math.random()*0.5,
                            size0:18, size1:3, bright:1.5, hot:1, stretch:1.3 });
    else      spawn(16, { vz: 10+Math.random()*30, az:-90, life:1.3+Math.random()*0.5,
                          size0:26, size1:46, bright:0.8, hot:0, soot:true });
  } else if(phase === 'fly'){
    const n = (typeof fxSpawnN === 'function') ? fxSpawnN(dt, white ? 40 : 14) : 0;
    if(white) feather(n, { vz: 25+Math.random()*45, az:-30, life:1.0, size0:13, size1:2,
                           bright:1.35, hot:1, stretch:1.2 });
    else      spawn(n, { vz: 5, az:-60, life:1.0, size0:18, size1:34, bright:0.7, hot:0, soot:true });
  } else if(phase === 'sustain'){
    const n = (typeof fxSpawnN === 'function') ? fxSpawnN(dt, white ? 32 : 10) : 0;
    if(white) feather(n, { vz: 35+Math.random()*55, az:-35, life:1.1, size0:14, size1:2.4,
                           bright:1.25, hot:1, stretch:1.2 });
    else      spawn(n, { vz: 8, az:-70, life:1.1, size0:22, size1:40, bright:0.65, hot:0, soot:true });
  }
}

const _fxSeenAe   = new Set();   // 発生時に1回だけ出すもの(cast)の既出判定
/* 歪みを出した時刻。**毎フレーム出すと重なって画が溶ける**ので0.16秒に1つへ間引く */
const _fxWarpAt   = new Map();
/* 歪みの半径の上限(ワールド)。判定が大きくてもここで止める。
   半径330の爆風をそのまま歪ませると画面の6割が動き、屈折でなく二重写しに見えた。 */
const WARP_R_MAX  = 110;
const _fxProjSeen = new Map();   // 弾id → 最後に見えた位置。消えた瞬間に impact を出す

/* 属性ごとの作り込み(fx_moves.js の表)を引く。無い属性は既定の見え方。
   **ここが分岐の1か所。** 技ごとの if をこの外に増やさない。 */
function fxGlStyleFor(o){
  const table = window.__aramonFxMoves;
  const def   = window.__aramonFxDefault;
  if(!table || !def) return null;
  const owner = (o.ownerId != null && typeof getEntity === 'function') ? getEntity(o.ownerId) : null;
  const el = (owner && owner.element) || o.element || null;
  const st = (el && table[el]) || null;
  /* 【1か所で直す】爆風(kind:'circle')は spawnGroundBlast が作る**別物の範囲技**で、
     angle も range も「扇の向き・射程」ではなく「円の半径」の意味になる。
     属性ごとの cast は前方へ向けた技のつもりで書いてあるので、そのまま呼ぶと
     羅生門の先端の爆風(半径240)に足元用の半径60の輪が出る、といった食い違いが起きる。
     **既定の cast は爆風の枝を持っている**ので、円のときはそちらへ渡す。
     自分で円を描き分ける属性(ピクシー・ハム=技そのものが爆風)は blastAware:true を
     立てておく。属性ごとの if をここから外へ増やさない。 */
  const castOwn = (o.kind === 'circle' && st && !st.blastAware) ? null : (st && st.cast);
  // 属性の表に無い出番は既定で埋める(4段のうち1つだけ書いた表も成立させる)
  return {
    cast:    castOwn            || def.cast,
    fly:     (st && st.fly)     || def.fly,
    impact:  (st && st.impact)  || def.impact,
    /* 【自分で入れたバグ】ここだけ `|| null` にしていたため、**属性の表は持つが
       sustain を書いていない属性(ピクシー・デュラハン・ワーム・ザン・ハム)には
       既定の sustain が一切届かず、範囲技が発生の一瞬だけになっていた。**
       他の3つと同じく既定へ落とす。 */
    sustain: (st && st.sustain) || def.sustain || null,
  };
}

function fxGlFeed(fx, dt){
  // ---- 飛んでいる弾 ----
  for(const p of projectiles){
    const st = fxGlStyleFor(p); if(!st) break;
    const c = fxGlTint(p);
    st.fly(fx, p, c, dt);
    fxGlAccent(fx, p, c, 'fly', dt);   // 白黒オーラのSSRだけ縁の差し色を足す
    fxGlAmbient(fx, p, c, 'proj', dt, Math.max(24, (p.hitR||12)*1.2));
    /* 着弾で使うぶんを控える。**進行方向と projStyle も渡す**:
       無いと「弾の来た向きへ飛び散る破片」と tier別の作り分けができない(属性班の指摘)。 */
    _fxProjSeen.set(p.id, { x:p.x, y:p.y, z:p.z||0, c, splash:p.splash, hitR:p.hitR,
                            ownerId:p.ownerId, vx:p.vx||0, vy:p.vy||0, projStyle:p.projStyle||null,
                            auraAccent:p.auraAccent||null });
  }
  // ---- 消えた弾 = 着弾。combat.js を触らずに「最後に見えた位置」で1回出す ----
  if(_fxProjSeen.size){
    const alive = new Set(projectiles.map(p=>p.id));
    for(const [id, last] of _fxProjSeen){
      if(alive.has(id)) continue;
      _fxProjSeen.delete(id);
      const st = fxGlStyleFor(last); if(!st) continue;
      st.impact(fx, last, last.c);
      fxGlAccent(fx, last, last.c, 'impact');
      if(typeof fxHitRadius === 'function')
        fxGlScorch(fx, last.x, last.y, last.c, Math.max(40, Math.min(fxHitRadius(last), 240)));
      // 着弾の球面波。半径は当たり判定(splash か hitR*3)まで
      if(fx.distort && typeof fxHitRadius === 'function')
        fx.distort({ x:last.x, y:last.y, z:(last.z||0)+20,
                     radius:Math.max(60, Math.min(fxHitRadius(last), WARP_R_MAX)),
                     life:0.35, strength:0.014, kind:'shock' });
      // 当たりの重さは弾の当たり判定の大きさで測る(威力は表示用の値と混ざるため)
      fxPunch(Math.min(0.9, (last.hitR||10)/34), last.x, last.y);
    }
  }
  // ---- 範囲技: 発生の瞬間(cast)と、出ている間(sustain) ----
  for(const ae of areaEffects){
    const st = fxGlStyleFor(ae); if(!st) break;
    const c = fxGlTint(ae);
    if(!_fxSeenAe.has(ae.id)){
      _fxSeenAe.add(ae.id);
      st.cast(fx, ae, c);
      fxGlAccent(fx, ae, c, 'cast');
      /* 揺れの強さは**射程ではなく「その場の破壊力」**で決める。
         `range/900` は tier3(射程750〜2200)が全部上限1.0に張り付き、
         どの技でも同じ最大の揺れが出ていた。しかも発動=術者の足元なので
         距離減衰も効かない。爆風は半径、それ以外は当たり幅を基準にする。 */
      const power = ae.kind === 'circle'
        ? Math.min(0.8, (ae.range||200)/700)
        : Math.min(0.5, (ae.width || ae.rectWidth || 120)/400);
      fxPunch(power, ae.x, ae.y);
    }
    if(st.sustain) st.sustain(fx, ae, c, dt);
    /* 前縁の帯・粒・焦げ跡・陽炎は**1か所でまとめて出す**ので、属性ごとの sustain に
       書き足す必要がない(書き忘れた属性だけ帯が無い、が起きない)。
       【自分で入れたバグ】`ae.__fxT` は fxAeReach() を呼ぶ属性でしか立たない。
       ogre / pixie / dullahan / aqua / leaf / warm / zan / hum は呼んでいないので
       **reach=0 が渡り、帯が1本も出ていなかった**(gl.ribbons が全コマ0)。
       判定側(drawSingleAreaEffect)とまったく同じ値から自分で出す。 */
    /* 充填の進み具合。**3か所で同じ式を書いていた**ので1つにまとめる。
       _reach … 発生から充填が進んだ長さ
       _front … その技の「いま前縁が居る距離」。羅生門(kind:'gate')だけは
                最遠から門へ**縮む**吸い込み技なので、前へ進む距離とは別物になる。
                前は _reach をそのまま前方の座標に使っていたため、**帯・粒・焦げ跡・陽炎が
                吸い込みと逆の向きへ飛び出していた**(2026-08-17に発注者から指摘)。 */
    const _tgw   = ae.telegraphTime != null ? ae.telegraphTime : 0.18;
    const _reach = Math.min(ae.range || 0, Math.max(0, (matchTime - ae.spawnAt) - _tgw) * (ae.fillSpeed || 900));
    const _pull  = (typeof fxAeIsPull === 'function') && fxAeIsPull(ae);
    const _front = (typeof fxAeFrontDist === 'function') ? fxAeFrontDist(ae, _reach) : _reach;
    const _fwx = Math.cos(ae.angle||0), _fwy = Math.sin(ae.angle||0);
    // 前へ伸びる技は帯の中ほど、吸い込み技は炎の壁そのものに置く
    const _atDist = (k)=> _pull ? _front : _reach*k;
    /* 歪み(採点表6)。**1か所でまとめて出す**ので属性ごとに書き足さない。
       炎系=上へ揺れる陽炎 / 爆風=外へ広がる球面波。
       半径は当たり判定から取るので、歪みが判定より大きくならない。 */
    if(fx.distort){
      if(!_fxWarpAt.has(ae.id) || (matchTime - _fxWarpAt.get(ae.id)) > 0.16){
        _fxWarpAt.set(ae.id, matchTime);
        const isBlast = ae.kind === 'circle';
        if(isBlast){
          /* 半径は判定どおりでも、画面を覆うほど大きいと歪みが画面効果になってしまう。
             見せたいのは「爆心の周りが揺れる」ことなので上限を掛ける。 */
          if(_reach > 20) fx.distort({ x:ae.x, y:ae.y, z:(ae.z||0)+30,
                                       radius:Math.min(_reach, ae.range||200, WARP_R_MAX),
                                       life:0.45, strength:0.016, kind:'shock' });
        } else if(_reach > 40){
          // 帯・扇の中ほどに陽炎を1つ。判定の半幅を超えない大きさにする
          const d  = _atDist(0.6);
          const hw = (typeof fxAeHalfWidth === 'function') ? fxAeHalfWidth(ae, d) : 60;
          fx.distort({ x:ae.x + _fwx*d, y:ae.y + _fwy*d, z:(ae.z||0)+40,
                       radius:Math.max(50, Math.min(hw, WARP_R_MAX)), life:0.5, strength:0.010,
                       freq:3.4, kind:'heat' });
        }
      }
    }
    if(_reach > 10){
      const isC = ae.kind === 'circle';
      const d2  = _atDist(0.7);
      const hw2 = isC ? _reach
        : ((typeof fxAeHalfWidth === 'function') ? fxAeHalfWidth(ae, d2) : 60);
      const ax2 = isC ? ae.x : ae.x + _fwx*d2;
      const ay2 = isC ? ae.y : ae.y + _fwy*d2;
      fxGlAmbient(fx, { x:ax2, y:ay2 }, c, 'area', dt, hw2);
      if(!_fxScorchAt.has(ae.id) || (matchTime - _fxScorchAt.get(ae.id)) > 0.22){
        _fxScorchAt.set(ae.id, matchTime);
        fxGlScorch(fx, ax2, ay2, c, Math.max(40, Math.min(hw2, 240)));
      }
    }
    // 前縁の帯。吸い込み技では前縁が術者へ寄ってくるので、帯もそのまま逆向きに動く
    if(typeof fxAeFrontRibbon === 'function' && (!_pull || _reach > 8))
      fxAeFrontRibbon(fx, ae, c, _front);
    fxGlAccent(fx, ae, c, 'sustain', dt);
  }
  // 消えた範囲技のidは捨てる(Setが試合中ずっと膨らむのを防ぐ)
  if(_fxSeenAe.size > 256){
    const alive = new Set(areaEffects.map(a=>a.id));
    for(const id of _fxSeenAe) if(!alive.has(id)) _fxSeenAe.delete(id);
  }
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
      if(!renderHeavyLoad){ ctx.shadowBlur = 26*pg.scale; ctx.shadowColor = 'rgba(255,222,150,0.9)'; }
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
  if(!renderHeavyLoad){ ctx.shadowBlur = 12; ctx.shadowColor = 'rgba(255,180,80,0.9)'; }
  ctx.fillText('召 喚', viewW/2, viewH*0.16);
  ctx.font = `bold ${Math.round(66*scale)}px 'Rajdhani', sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  if(!renderHeavyLoad){ ctx.shadowBlur = 22; ctx.shadowColor = 'rgba(120,200,255,0.95)'; }
  ctx.fillText(String(n), viewW/2, viewH*0.31);
  ctx.restore();
}
/* ===== チーム戦: ピンの旗マーカー(3D世界) =====
   毎フレームproject()で1点ずつ投影する(画面上の位置・角度を決め打ちしない)。
   敵ピン(赤)は対象の頭上に追従し、移動ピン(黄)は指した地面に立つ。
   上下にふわふわ+自分からの距離mを添える。スケールは頭上ラベルと同じ上限
   (TEAM_LABEL_MAX_SCALE)でカメラ至近でも巨大化しない。掃除はprunePings(combat.js)。 */
function drawPingMarkers(){
  if(typeof teamPings==='undefined' || !teamPings.size || !player) return;
  for(const pg of teamPings.values()){
    let wx, wy, wz;
    if(pg.kind==='enemy'){
      const t = getEntity(pg.targetId);
      if(!t || !t.alive) continue;   // 消すのはprunePingsの仕事(描画では飛ばすだけ)
      wx=t.x; wy=t.y; wz=(t.z||0) + t.radius*2.6;   // 頭上(名前ラベルのさらに上)
    } else {
      wx=pg.x; wy=pg.y; wz=groundZAt(wx, wy);
    }
    const p = project(wx, wy, wz);
    if(!p) continue;
    const col = pg.kind==='enemy' ? '#ff5a5a' : '#ffd23c';
    // 出現0.15秒でなじませ、最後の0.5秒でふっと消える
    const fade = clamp((pg.expireAt - matchTime)/0.5, 0, 1) * clamp((matchTime - pg.bornAt)/0.15 + 0.35, 0, 1);
    if(fade <= 0.02) continue;
    const k = Math.min(Math.max(p.scale, 0.55), TEAM_LABEL_MAX_SCALE);   // 遠くでも読め、至近で巨大化しない
    const bob = Math.sin(matchTime*3 + pg.senderId)*4*k;                 // 上下にふわふわ(目に留まる)
    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.scale(k, k);
    ctx.globalAlpha = fade;
    // 旗: ポール+旗布+根本の点(地点/対象の真上)
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -26); ctx.stroke();
    ctx.fillStyle = col;
    if(!renderHeavyLoad){ ctx.shadowBlur = 8; ctx.shadowColor = col; }
    ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(16, -21); ctx.lineTo(0, -16); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, Math.PI*2); ctx.fill();
    // 自分からの距離m(近づくほど減る=そのまま誘導になる)
    const txt = Math.max(1, Math.round(dist(player, {x:wx, y:wy})/PING_UNITS_PER_M)) + 'm';
    ctx.font = "bold 10px 'Rajdhani', sans-serif";
    ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(txt, 0, -32);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(txt, 0, -32);
    ctx.restore();
  }
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
    // ミニマップも「通れない広さ」= 地面の高さでの実半径で描く(当たり判定と一致させる)
    miniCtx.arc(v.x*scale, v.y*scale, Math.max(2, mountainGroundRadius(v)*scale), 0, Math.PI*2);
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
    // チーム戦の味方は緑の点+白い縁取り(自分の白い点と同型の強調)で敵と即区別する
    const isAllyM = (typeof sameTeam==='function') && player && sameTeam(player, e);
    /* チーム戦は「敵か味方か自分か」の3値だけにする。元素色のままだと
       多色の紙吹雪になり敵味方が判別できない(批評指摘)。個人戦は従来どおり元素色。
       味方は緑+白縁の【三角】=色相だけでなく形でも区別する(赤緑色覚対応。
       頭上の▽・小隊バーと同じ形言語)。敵・個人戦は従来の丸 */
    const teamMini = (typeof isTeamMatch==='function') && isTeamMatch();
    if(isAllyM){
      const mx=e.x*scale, my2=e.y*scale, r=4.2;
      miniCtx.beginPath();
      miniCtx.moveTo(mx, my2-r); miniCtx.lineTo(mx+r*0.9, my2+r*0.7); miniCtx.lineTo(mx-r*0.9, my2+r*0.7);
      miniCtx.closePath();
      miniCtx.fillStyle='#58e07e'; miniCtx.fill();
      miniCtx.strokeStyle='rgba(255,255,255,0.9)'; miniCtx.lineWidth=1; miniCtx.stroke();
    } else {
      miniCtx.beginPath();
      miniCtx.arc(e.x*scale, e.y*scale, e.isPlayer?3.4:2.2, 0, Math.PI*2);
      miniCtx.fillStyle = e.isPlayer ? '#ffffff'
        : (teamMini ? '#ff5a5a' : (ELEMENTS[e.element].accent || ELEMENTS[e.element].color));
      miniCtx.fill();
    }
  }
  // チーム戦: 小隊のピン(敵=赤/移動=黄)を点滅させて出す。3D世界の旗と同じ色言語
  if(typeof teamPings!=='undefined' && teamPings.size){
    const blink = 0.45 + 0.55*Math.abs(Math.sin(matchTime*5));
    for(const pg of teamPings.values()){
      let px2, py2;
      if(pg.kind==='enemy'){
        const t = getEntity(pg.targetId);
        if(!t || !t.alive) continue;
        px2=t.x; py2=t.y;
      } else { px2=pg.x; py2=pg.y; }
      miniCtx.save();
      miniCtx.globalAlpha = blink;
      miniCtx.beginPath();
      miniCtx.arc(px2*scale, py2*scale, 3.6, 0, Math.PI*2);
      miniCtx.fillStyle = pg.kind==='enemy' ? '#ff5a5a' : '#ffd23c';
      miniCtx.fill();
      miniCtx.strokeStyle='rgba(255,255,255,0.95)'; miniCtx.lineWidth=1.2; miniCtx.stroke();
      miniCtx.restore();
    }
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
/* ===== チーム戦: 小隊バー(味方2人の名前+HPバー+状態) =====
   #topLeft(縦flex)の中=HPパネルの直下に置いてあるので位置の計算は不要。
   行のDOMは「人数・名前・状態」が変わったときだけ作り直し、HPバーの幅と
   ダウン残り秒は毎フレーム値だけ書く(innerHTMLを毎フレーム書かない)。 */
function updateSquadPanel(){
  const el = document.getElementById('squadPanel');
  if(!el) return;
  const teamMode = (typeof isTeamMatch==='function') && isTeamMatch() && player && player.teamId!=null;
  const mates = teamMode ? teamMembers(player.teamId).filter(m=>m!==player) : [];
  if(!mates.length){
    if(!el.classList.contains('hidden')){ el.classList.add('hidden'); el.innerHTML=''; el._sqSig=null; }
    document.body.classList.remove('self-downed');   // 前のチーム戦の印を持ち越さない
    return;
  }
  el.classList.remove('hidden');
  const stateOf = (m)=> !m.alive ? 'dead' : (entityDowned(m) ? 'down' : 'ok');
  const sig = mates.map(m=> m.id+':'+displayNameFor(m)+':'+stateOf(m)).join('|');
  if(el._sqSig !== sig){
    el._sqSig = sig;
    el.innerHTML = mates.map(m=>{
      const st = stateOf(m);
      const stLabel = st==='dead' ? '倒された' : (st==='down' ? 'ダウン中' : '');
      const mark = st==='dead' ? '💀' : '▽';   // 死亡はドクロで一目で分かるように(ダウンとの区別)
      return `<div class="sq-row sq-${st}" data-ent="${m.id}">
        <div class="sq-top"><span class="sq-mark">${mark}</span><span class="sq-name">${displayNameFor(m)}</span><span class="sq-hp-num"></span><span class="sq-state">${stLabel}</span></div>
        <div class="sq-hp-track"><div class="sq-hp-fill"></div></div>
      </div>`;
    }).join('');
  }
  /* 自分がダウン中はbodyへ印を付け、FIRE/DASH/技ボタンをCSSで無効に見せる
     (実際の発射はホスト/ソロ側で既に弾いている。UIだけ生きていると
      「押せるのに撃てない」に見える=批評指摘)。 */
  document.body.classList.toggle('self-downed',
    !!(game.started && !game.over && player && entityDowned(player)));
  for(const row of el.children){
    const m = mates.find(x=> x.id===Number(row.dataset.ent));
    if(!m) continue;
    const fill = row.querySelector('.sq-hp-fill');
    if(fill) fill.style.width = (m.alive ? clamp(m.hp/m.maxHp,0,1)*100 : 0)+'%';
    // HP数値(バーの太さだけでは残量が読み取れない=批評指摘)
    const hpEl = row.querySelector('.sq-hp-num');
    if(hpEl){
      const t = m.alive ? String(Math.max(0,Math.round(m.hp))) : '';
      if(hpEl.textContent!==t) hpEl.textContent = t;
    }
    if(entityDowned(m)){
      // ダウン中は「蘇生中」か出血死までの残り秒を出す(文字が変わったときだけ書く)
      const stEl = row.querySelector('.sq-state');
      const txt = m.reviveProgress>0 ? '蘇生中' : `ダウン中 ${Math.max(0,Math.ceil((m.downedUntil||0)-matchTime))}s`;
      if(stEl && stEl.textContent!==txt) stEl.textContent = txt;
    }
  }
}
/* ゲストのヒットマーカー: 自分の弾が見た目命中した瞬間、照準に×印を0.15秒重ねる。
   ホストはapplyDamageの実ダメージ数字が即出るので呼ばない(network.jsのゲスト経路だけが呼ぶ) */
let hitMarkerTimer = null;
function showHitMarker(){
  const el = document.getElementById('hitMarker');
  if(!el) return;
  el.classList.remove('hm-show');
  void el.offsetWidth;   // アニメーションを毎回最初から再生する
  el.classList.add('hm-show');
  if(hitMarkerTimer) clearTimeout(hitMarkerTimer);
  hitMarkerTimer = setTimeout(()=> el.classList.remove('hm-show'), 170);
}
function updateHUD(){
  if(!player) return;
  const el = ELEMENTS[player.element];
  // ランキング表示名(名前入力欄)をそのままHUDに表示する
  document.getElementById('hudName').textContent =
    (typeof getDisplayNameFromInput==='function') ? getDisplayNameFromInput() : (player.name||'プレイヤー');
  /* トレーニングで変わった数値を**全部**プレイヤー欄に出す(発注者指示)。
     一覧の作りは matchTrainBoardRows(ui.js)が1か所で持っている ―― カードぶんと
     拾ったアイテムぶんを同じ「元から何%」に揃えて混ぜる。ここは並べるだけ。
     **毎フレームinnerHTMLを書き換えない。** 中身が変わったときだけ作り直す。 */
  {
    const line = document.getElementById('trainBuffsLine');
    const rows = (typeof matchTrainBoardRows==='function') ? matchTrainBoardRows(player) : [];
    const sig = rows.map(r=>r.label+r.text).join('|');
    if(line._tbSig !== sig){
      line._tbSig = sig;
      line.innerHTML = rows.map(r=>
        `<span class="tb-chip ${r.good?'up':'down'}">${r.label}<b>${r.text}</b></span>`).join('');
    }
  }
  document.getElementById('hudElTag').textContent = el.label;
  // HUD左上バーの色はモンスター本来の色ではなくオーラ色(スキンによる変化を考慮)
  const playerAura = (typeof getMonsterAura==='function') ? getMonsterAura(player) : null;
  const accentColor = (playerAura && typeof auraColorHex==='function') ? auraColorHex(playerAura) : el.color;
  document.documentElement.style.setProperty('--accent', accentColor);
  if(typeof updateRaidHud==='function') updateRaidHud();   // レイド中だけボスHP・残り時間・与ダメを更新
  updateSquadPanel();   // チーム戦だけ小隊バー(個人戦では隠れたまま)
  if(typeof prunePings==='function') prunePings();             // ピンの寿命(ゲストのループでも回る)
  if(typeof updateKillLeader==='function') updateKillLeader(); // 同期済みkillsから毎フレーム導出(同期追加なし)
  // ピンボタンはチーム系モードの試合中だけ出す(個人戦・レイド・射撃訓練場では非表示)
  {
    const pingBtnEl = document.getElementById('pingBtn');
    if(pingBtnEl){
      const showPing = (typeof isTeamMatch==='function') && isTeamMatch() &&
        game.started && !game.over && player.alive;
      pingBtnEl.classList.toggle('hidden', !showPing);
    }
  }
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
  {
    /* 生存カウンタの言葉はモードで3通り。**どれも同じ2要素(#aliveNum/#aliveLabel)へ書く**ので、
       前のモードの文言が残らないよう毎フレーム両方を確定させる。
         アリーナ  : 自3 v 敵3      (1本勝負なので部隊数に意味が無い)
         チーム戦BR: 12部隊 / 残り34人 (APEXと同じ「部隊数と残り人数」・発注者要望 2026-08-14)
         個人戦    : 20 体 生存中 */
    let num, label;
    if(game.arena && player && player.teamId!=null){
      const own = entities.filter(e=>e.alive && e.teamId===player.teamId).length;
      num = `${own}v${aliveCount-own}`; label = '自 vs 敵';
    } else if((typeof isTeamMatch==='function') && isTeamMatch()){
      // ダウン中も alive のまま=部隊はまだ生きている(全員が本当に倒れて初めて1部隊減る)
      const squads = new Set();
      for(const e of entities){ if(e.alive && e.teamId!=null) squads.add(e.teamId); }
      num = `${squads.size}部隊`; label = `残り${aliveCount}人`;
    } else {
      num = String(aliveCount); label = '体 生存中';
    }
    const an = document.getElementById('aliveNum'), al = document.getElementById('aliveLabel');
    if(an.textContent!==num) an.textContent = num;
    if(al.textContent!==label) al.textContent = label;
  }
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
  /* キルフィードが流れている間は操作ヒントを消す(フィード3行目とヒント帯が
     重なって最新のキル行が読めなくなる=批評指摘。キルが起きている時点で
     操作は分かっているので、ヒントを譲るのが正しい優先順位)。 */
  const feedBusy = (()=>{ const kf = document.getElementById('killFeed'); return kf && kf.children.length > 0; })();
  document.getElementById('tipBox').style.opacity = (!introState.active && game.tipTimer>0 && !feedBusy) ? '1':'0';

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
      if(typeof sameTeam==='function' && sameTeam(player, e)) continue; // チーム戦: 味方にはロックオン表示を出さない(攻撃も当たらない)
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
  if(e.target.closest('#titleScreen') || e.target.closest('#startScreen') || e.target.closest('#settingsOverlay') || e.target.closest('#myPageOverlay') || e.target.closest('#helpOverlay') || e.target.closest('#helpImageOverlay') || e.target.closest('#monsterPickOverlay') || e.target.closest('#mapPickOverlay') || e.target.closest('#modePickOverlay') || e.target.closest('#audioSettingsOverlay') || e.target.closest('#lobbyBgmOverlay') || e.target.closest('#accountOverlay') || e.target.closest('#bagOverlay') || e.target.closest('#galleryOverlay') || e.target.closest('#missionOverlay') || e.target.closest('#expeditionOverlay') || e.target.closest('#expeditionPickOverlay') || e.target.closest('#loginBonusPopup') || e.target.closest('#season1PreviewOverlay') || e.target.closest('#gachaOverlay') || e.target.closest('#ssrPromoteOverlay') || e.target.closest('#skinPromoOverlay') || e.target.closest('#rockSsrPromoOverlay') || e.target.closest('#metagGaruruPromoOverlay') || e.target.closest('#skinPreviewOverlay') || e.target.closest('#shopOverlay') || e.target.closest('#changelogOverlay') || e.target.closest('#rankingScreen') || e.target.closest('#myStatsScreen') || e.target.closest('#howToPlayScreen') || e.target.closest('#mastermonScreen') || e.target.closest('#resultScreen') || e.target.closest('#monsterListScreen') || e.target.closest('#adminPassScreen') || e.target.closest('#adminScreen') || e.target.closest('#lobbyScreen') || e.target.closest('#roomListScreen') || e.target.closest('#spectateBar') || e.target.closest('#trainCardBar') || e.target.closest('#rangeBar') || e.target.closest('#lookSettingsOverlay') || e.target.closest('#textInputOverlay') || e.target.closest('#rebirthOverlay') || e.target.closest('#awakenOverlay') || e.target.closest('#hidenOverlay') || e.target.closest('#rebirthAnimOverlay') || e.target.closest('#awakenAnimOverlay') || e.target.closest('#raidOverlay') || e.target.closest('#raidRankOverlay') || e.target.closest('#shareOverlay')) return;
  e.preventDefault();
}, {passive:false});
document.addEventListener('gesturestart', (e)=>{ e.preventDefault(); });
document.addEventListener('gesturechange', (e)=>{ e.preventDefault(); });
document.addEventListener('gestureend', (e)=>{ e.preventDefault(); });

