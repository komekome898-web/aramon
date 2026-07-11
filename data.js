const WORLD = { w: 8100, h: 8100 };
const ZONE_CENTER0 = { x: WORLD.w/2, y: WORLD.h/2 };

const ZONE_PHASES = [
  { holdRadius: 3540, shrinkTime: 0,  holdTime: 61, dps: 0  },
  { holdRadius: 2459, shrinkTime: 36, holdTime: 48, dps: 3  },
  { holdRadius: 1559, shrinkTime: 29, holdTime: 42, dps: 5  },
  { holdRadius: 869,  shrinkTime: 28, holdTime: 36, dps: 8  },
  { holdRadius: 390,  shrinkTime: 21, holdTime: 29, dps: 12 },
  { holdRadius: 135,  shrinkTime: 17, holdTime: 99999, dps: 16 },
];

const ELEMENTS = {
  fire:    { label:'ドラゴン',   color:'#ff6b35', dark:'#a8431d', speed:182, hp:100, trait:'burn' },
  aqua:    { label:'ウンディーネ', color:'#3dccc7', dark:'#1d8c88', speed:204, hp:88,  trait:'lifesteal' },
  leaf:    { label:'プラント',   color:'#7fb236', dark:'#4f6f1f', speed:140, hp:150, trait:'gutsdrain', cooldownMod:1/1.5, dmgDealtMod:0.8, gutsRegenMod:1.5 },
  spark:   { label:'ライガー',   color:'#f4c430', dark:'#a8801c', speed:224, hp:78,  trait:'slow' },
  rock:    { label:'ゴーレム',   color:'#a98a68', dark:'#5c4a38', speed:158, hp:132, trait:'golem', dmgTakenMod:0.8, dmgDealtMod:1.2 },
  phoenix: { label:'ヒノトリ',   color:'#f2b33d', dark:'#9c6a1a', accent:'#e8432a', speed:198, hp:110, trait:'haste', cooldownMod:1/1.5 },
  ark:     { label:'アーク',     color:'#f5f2e0', dark:'#8a7a4a', accent:'#ffe9a8', speed:188, hp:145, trait:'grace' },
  warm:    { label:'ワーム',     color:'#9b5fd1', dark:'#5c3680', speed:185, hp:160, trait:'poison' },
};

const monsterImages = {};
const playerMonsterImages = {};
// basePath (拡張子なし) に対して .png -> .PNG -> .Png の順で読み込みを試す。
// 最初に成功した拡張子はキャッシュしておき、次回以降は無駄なリトライをしない。
const EXT_CANDIDATES = ['png', 'PNG', 'Png'];
function loadMonsterImage(basePath){
  const img = new Image();
  img.loaded = false;
  img.failed = false;
  let attemptIndex = 0;
  const tryNext = ()=>{
    if(attemptIndex >= EXT_CANDIDATES.length){
      img.failed = true;
      return;
    }
    img.src = `${basePath}.${EXT_CANDIDATES[attemptIndex]}`;
    attemptIndex++;
  };
  img.onload = ()=>{ img.loaded = true; };
  img.onerror = ()=>{ tryNext(); };
  tryNext();
  return img;
}
function imgSrcFor(basePath){
  return `${basePath}.${EXT_CANDIDATES[0]}`;
}
// <img onerror="..."> から呼ばれる共通フォールバック処理。
// .png -> .PNG -> .Png の順で再試行し、全滅したら要素を消す。
function handleMonsterImgError(imgEl, basePath){
  const tried = parseInt(imgEl.dataset.extIdx || '0', 10) + 1;
  if(tried >= EXT_CANDIDATES.length){
    imgEl.remove();
    return;
  }
  imgEl.dataset.extIdx = String(tried);
  imgEl.src = `${basePath}.${EXT_CANDIDATES[tried]}`;
}
// 結果画面アイコン専用: プレイヤー用画像 -> 通常画像 -> 非表示、の順にフォールバック
function handleResultIconError(imgEl){
  const extIdx = parseInt(imgEl.dataset.extIdx || '0', 10) + 1;
  if(extIdx < EXT_CANDIDATES.length){
    imgEl.dataset.extIdx = String(extIdx);
    imgEl.src = `${imgEl.dataset.basePath}.${EXT_CANDIDATES[extIdx]}`;
    return;
  }
  if(imgEl.dataset.variant === 'player'){
    imgEl.dataset.variant = 'normal';
    imgEl.dataset.extIdx = '0';
    imgEl.dataset.basePath = imgEl.dataset.basePath.replace(/_player$/, '');
    imgEl.src = `${imgEl.dataset.basePath}.${EXT_CANDIDATES[0]}`;
    return;
  }
  imgEl.style.display = 'none';
}
Object.keys(ELEMENTS).forEach(key=>{
  monsterImages[key] = loadMonsterImage(`monsters/${key}`);
  playerMonsterImages[key] = loadMonsterImage(`monsters/${key}_player`);
});
function imgIsReady(img){
  return img && img.loaded && !img.failed;
}
function monsterImageReady(key){
  return imgIsReady(monsterImages[key]);
}
function getDisplayImage(entity){
  if(entity.isPlayer && imgIsReady(playerMonsterImages[entity.element])){
    return playerMonsterImages[entity.element];
  }
  if(imgIsReady(monsterImages[entity.element])){
    return monsterImages[entity.element];
  }
  return null;
}

const SIGNATURE_MOVES = {
  fire: [
    { name:'ファイア',   tier:1, color:'#ff6b35', lobbed:true, range:700,  dmg:24, cooldown:0.85, gutsCost:6, projSpeed:520, hitR:12, splash:70, arcHeight:140 },
    { name:'ファイアブレス',   tier:2, color:'#ff6b35', range:1400, dmg:13, cooldown:1.1, gutsCost:9, projSpeed:480, hitR:7,  burst:3, burstGap:0.12 },
    { name:'インフェルノ',   tier:3, color:'#ff6b35', range:1800, dmg:46, cooldown:2.1, gutsCost:18, projSpeed:460, hitR:14, hitW:84, splash:85 },
  ],
  aqua: [
    { name:'水風船',     tier:1, color:'#3dccc7', lobbed:true, range:750,  dmg:23, cooldown:0.8,  gutsCost:6, projSpeed:560, hitR:11, splash:68, arcHeight:140 },
    { name:'アクアウェイブ',   tier:2, color:'#3dccc7', range:1500, dmg:12, cooldown:1.0, gutsCost:9, projSpeed:520, hitR:6,  burst:3, burstGap:0.1 },
    { name:'クリスタルレイン',   tier:3, color:'#3dccc7', range:1900, dmg:42, cooldown:1.9, gutsCost:17, projSpeed:480, hitR:15, hitW:90, splash:90 },
  ],
  leaf: [
    { name:'種',     tier:1, color:'#7fb236', lobbed:true, range:650,  dmg:22, cooldown:0.78, gutsCost:6, projSpeed:500, hitR:12, splash:72, arcHeight:140 },
    { name:'種マシンガン', tier:2, color:'#7fb236', range:1300, dmg:11, cooldown:1.15, gutsCost:9, projSpeed:460, hitR:6,  burst:4, burstGap:0.11 },
    { name:'フラワービーム',   tier:3, color:'#7fb236', range:1700, dmg:44, cooldown:2.2, gutsCost:17, projSpeed:430, hitR:16, hitW:96, splash:95 },
  ],
  spark: [
    { name:'かみなり',   tier:1, color:'#f4c430', lobbed:true, range:650,  dmg:20, cooldown:0.7,  gutsCost:6, projSpeed:600, hitR:10, splash:62, arcHeight:130 },
    { name:'雷撃', tier:2, color:'#f4c430', range:1300, dmg:9,  cooldown:0.85, gutsCost:8, projSpeed:560, hitR:5,  burst:5, burstGap:0.08 },
    { name:'超雷撃',     tier:3, color:'#f4c430', range:1700, dmg:40, cooldown:1.9, gutsCost:16, projSpeed:500, hitR:13, hitW:76, splash:80 },
  ],
  rock: [
    { name:'ロケットパンチ',       tier:1, color:'#a98a68', lobbed:true, range:600,  dmg:28, cooldown:0.95, gutsCost:7, projSpeed:440, hitR:14, splash:78, arcHeight:150 },
    { name:'掌打',   tier:2, color:'#a98a68', range:1200, dmg:15, cooldown:1.3, gutsCost:10, projSpeed:380, hitR:9,  burst:3, burstGap:0.14 },
    { name:'超掌打', tier:3, color:'#a98a68', range:1600, dmg:52, cooldown:2.4, gutsCost:19, projSpeed:400, hitR:18, hitW:100, splash:100 },
  ],
  phoenix: [
    { name:'火炎砲',     tier:1, color:'#e8432a', lobbed:true, range:725,  dmg:25, cooldown:0.82, gutsCost:6, projSpeed:540, hitR:12, splash:70, arcHeight:140 },
    { name:'火炎連砲', tier:2, color:'#e8432a', range:1450, dmg:13, cooldown:1.05, gutsCost:9, projSpeed:500, hitR:7,  burst:3, burstGap:0.1 },
    { name:'ファイアウェーブ', tier:3, color:'#e8432a', range:1850, dmg:47, cooldown:2.0, gutsCost:18, projSpeed:460, hitR:15, hitW:88, splash:85 },
  ],
  ark: [
    { name:'しっぽふり',   tier:1, color:'#ffe9a8', lobbed:true, range:700,  dmg:24, cooldown:0.85, gutsCost:6, projSpeed:520, hitR:12, splash:70, arcHeight:140 },
    { name:'熾天の剣', tier:2, color:'#ffe9a8', range:1450, dmg:13, cooldown:1.05, gutsCost:9, projSpeed:500, hitR:7,  burst:3, burstGap:0.1 },
    { name:'天の慈悲', tier:3, color:'#ffe9a8', range:1850, dmg:47, cooldown:2.0, gutsCost:18, projSpeed:460, hitR:15, hitW:88, splash:85 },
  ],
  warm: [
    { name:'毒ガス',       tier:1, color:'#9b5fd1', lobbed:true, range:700,  dmg:23, cooldown:0.85, gutsCost:6, projSpeed:500, hitR:12, splash:75, arcHeight:140 },
    { name:'毒噴射',   tier:2, color:'#9b5fd1', range:1400, dmg:12, cooldown:1.1, gutsCost:9, projSpeed:470, hitR:7,  burst:3, burstGap:0.12 },
    { name:'シェルアタック', tier:3, color:'#9b5fd1', range:1750, dmg:45, cooldown:2.1, gutsCost:18, projSpeed:440, hitR:15, hitW:85, splash:88 },
  ],
};

const TICKET_ITEM = { name:'修行チケット', color:'#9fd1ff', accent:'#ffffff' };
const GUTS_ITEM = { name:'ガッツ飴', restore:32, maxBoost:15, color:'#ff7a96', accent:'#ffd9e3' };

const HEAL_ITEMS = {
  oilS: { name:'小ガロエオイル', heal:20, color:'#9b6b2f', accent:'#e8c873', size:0.8  },
  oilM: { name:'中ガロエオイル', heal:45, color:'#b9802f', accent:'#f0d27a', size:1.05 },
  oilL: { name:'大ガロエオイル', heal:80, color:'#d99a2b', accent:'#ffe28a', size:1.35 },
};
const HEAL_TYPES = Object.keys(HEAL_ITEMS);

const BOT_NAMES = ['ガロン','ヒスイ','ボムリン','ナギ','ソルト','ピコ','ザンギ','ウル','ミドリ','カイト','ルゥ','テスラ','ドンガラ','フブキ','イグニ','クラゲン','モグ','ライ','バサル','ジン','ヌマル','コゲ'];

const CLIMB_TOLERANCE = 12;
const UPWARD_BLOCK_THRESHOLD = 35;

/* =====================================================================
   UTIL
===================================================================== */
const rand = (a,b)=>a+Math.random()*(b-a);
const randInt = (a,b)=>Math.floor(rand(a,b+1));
const clamp = (v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const lerp = (a,b,t)=>a+(b-a)*t;
const dist = (a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const angTo = (a,b)=>Math.atan2(b.y-a.y,b.x-a.x);
function shuffle(arr){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=randInt(0,i); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function fmtTime(s){ s=Math.max(0,Math.floor(s)); const m=Math.floor(s/60), sec=s%60; return String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0'); }

// シード付き乱数(マルチプレイの初期状態を全員で一致させるために使用)
function makeSeededRng(seed){
  let s = seed>>>0;
  return function(){
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededRand(rng, a, b){ return a + rng()*(b-a); }
function seededInt(rng, a, b){ return Math.floor(seededRand(rng,a,b+1)); }
function seededShuffle(rng, arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){ const j = seededInt(rng,0,i); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

/* =====================================================================
   GAME STATE
===================================================================== */
