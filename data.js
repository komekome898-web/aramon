const WORLD_BASE_SIZE = 18100;
const WORLD = { w: WORLD_BASE_SIZE, h: WORLD_BASE_SIZE };
const DASH_COOLDOWN_MAX = 3.0;
const DASH_DURATION = 0.2; // ダッシュが持続する秒数
const DASH_SPEED_MULT = 6.0; // ダッシュ速度倍率(旧3.0から距離2倍に)
const DASH_REF_SPEED = 200; // この移動速度を基準に、遅いほどダッシュ距離が伸び、速いほど縮む
const ZONE_CENTER0 = { x: WORLD.w/2, y: WORLD.h/2 };

const ZONE_PHASES_BASE = [
  { holdRadius: 7910, shrinkTime: 0,  holdTime: 61, dps: 0  },
  { holdRadius: 5495, shrinkTime: 36, holdTime: 48, dps: 3  },
  { holdRadius: 3485, shrinkTime: 29, holdTime: 42, dps: 5  },
  { holdRadius: 1942, shrinkTime: 28, holdTime: 36, dps: 8  },
  { holdRadius: 872,  shrinkTime: 21, holdTime: 29, dps: 12 },
  { holdRadius: 302,  shrinkTime: 17, holdTime: 99999, dps: 16 },
];
let ZONE_PHASES = ZONE_PHASES_BASE.map(p=>({...p}));

// マルチプレイ(少人数想定)はソロより一回り狭いマップにする
const MULTI_MAP_SCALE = 0.68;
let worldDensityScale = 1; // 岩・地形装飾の密度倍率(マップ面積縮小に応じてseededGen側で使用)

// マップの規模(ワールドサイズ・安全圏半径)をスケールに応じて再計算する。
// ソロは常にscale=1、マルチはMULTI_MAP_SCALEを使う。試合開始のたびに必ず呼び出すこと。
function applyWorldScale(scale){
  WORLD.w = Math.round(WORLD_BASE_SIZE * scale);
  WORLD.h = Math.round(WORLD_BASE_SIZE * scale);
  ZONE_CENTER0.x = WORLD.w/2;
  ZONE_CENTER0.y = WORLD.h/2;
  ZONE_PHASES = ZONE_PHASES_BASE.map(p=>({...p, holdRadius: Math.round(p.holdRadius*scale)}));
  worldDensityScale = scale*scale; // 面積比に応じて岩/地形の個数密度を調整
}

// ===== マップ定義 =====
// hasVolcano:true のマップは、通れない「山(複合体)」エリアが生成される。
// mountainStyle でその山の見た目(volcano=火山/snow=雪山/forest=森/pyramid=ピラミッド)を切り替える。
// lavaRingPerVolcano/lavaPoolCount が0のマップは溶岩(ダメージ床)は生成されない。
// rockFlavors は岩オブジェクトの見た目バリエーションを重み付きで指定する(未指定時は通常の岩)。
const WATER_SPEED_MULT = 0.6; // 海・川の中での移動速度倍率
const OASIS_SPEED_MULT = 0.8; // オアシスの中での移動速度倍率
const MAPS = {
  wild: {
    key:'wild', label:'荒野', rockCount:800, decorCount:9000, hasVolcano:false,
    groundColor:'#142433',
    previewIcon:'🪨', previewColors:['#2a3a4a','#0f1a24'],
    desc:'岩が点在するだけのシンプルな荒野。見通しが良く、初めてのバトルにもおすすめ。',
  },
  kaurea: {
    key:'kaurea', label:'カウレア火山', rockCount:640, decorCount:7200, hasVolcano:true,
    mountainStyle:'volcano',
    groundColor:'#241708',
    previewIcon:'🌋', previewColors:['#5a2a12','#1a0c05'],
    desc:'3つの火山と溶岩地帯が広がる灼熱の島。溶岩に触れるとダメージを受ける。',
    // ワールド比率(0〜1)で指定した3つの火山の位置。大きさも少しずつ変える
    volcanoSites:[
      { xr:0.60, yr:0.42, radius:1550, peakBumps:7 },
      { xr:0.24, yr:0.68, radius:1250, peakBumps:6 },
      { xr:0.80, yr:0.76, radius:1350, peakBumps:6 },
    ],
    lavaRingPerVolcano: 4, lavaRingRadius: 2150, lavaPoolCount: 4,
    lavaDps: 22,
  },
  papas: {
    key:'papas', label:'パパス雪山', rockCount:540, decorCount:6200, hasVolcano:true,
    mountainStyle:'snow',
    groundColor:'#dbe8f2',
    previewIcon:'🏔️', previewColors:['#dce8f2','#8fa9be'],
    desc:'白銀の雪山と尖った氷の水晶がそびえる極寒のフィールド。',
    volcanoSites:[
      { xr:0.56, yr:0.40, radius:1650, peakBumps:6 },
      { xr:0.22, yr:0.72, radius:1200, peakBumps:5 },
    ],
    lavaRingPerVolcano:0, lavaPoolCount:0, lavaDps:0,
    hasCrystals:true, crystalCount:260,
    rockFlavors:[{ type:'snowrock', w:1 }],
  },
  palepale: {
    key:'palepale', label:'パレパレジャングル', rockCount:520, decorCount:8200, hasVolcano:true,
    mountainStyle:'forest',
    groundColor:'#16321a',
    previewIcon:'🌴', previewColors:['#1f4a24','#0c210f'],
    desc:'深い森に阻まれた入り組んだジャングル。物陰からの奇襲に注意。',
    volcanoSites:[
      { xr:0.28, yr:0.30, radius:1300, peakBumps:8 },
      { xr:0.74, yr:0.26, radius:1150, peakBumps:7 },
      { xr:0.30, yr:0.76, radius:1250, peakBumps:8 },
      { xr:0.78, yr:0.72, radius:1100, peakBumps:6 },
      { xr:0.52, yr:0.52, radius:900,  peakBumps:6 },
    ],
    lavaRingPerVolcano:0, lavaPoolCount:0, lavaDps:0,
    rockFlavors:[{ type:'rock', w:0.55 }, { type:'tree', w:0.45 }],
  },
  toble: {
    key:'toble', label:'トーブル海岸', rockCount:560, decorCount:6800, hasVolcano:false,
    groundColor:'#cdb27a',
    previewIcon:'🌊', previewColors:['#2e6a8a','#c9ad76'],
    desc:'左手に大海、右手から川が流れ込む海岸線。水の中は動きが鈍くなり、アイテムも湧かない。',
    hasSea:true, seaWidthRatio:0.14,
    hasRiver:true, riverCount:5, riverWidth:260,
    rockFlavors:[{ type:'rock', w:0.5 }, { type:'shell', w:0.5 }],
  },
  mandy: {
    key:'mandy', label:'マンディー砂漠', rockCount:480, decorCount:5200, hasVolcano:true,
    mountainStyle:'pyramid',
    groundColor:'#e8d79a',
    previewIcon:'🔺', previewColors:['#d8c078','#8a6a3a'],
    desc:'砂に埋もれたピラミッドが点在する砂漠。オアシスは足が遅くなる代わりにアイテムが豊富。',
    volcanoSites:[
      { xr:0.62, yr:0.35, radius:820, peakBumps:0 },
      { xr:0.24, yr:0.58, radius:650, peakBumps:0 },
      { xr:0.78, yr:0.74, radius:700, peakBumps:0 },
    ],
    lavaRingPerVolcano:0, lavaPoolCount:0, lavaDps:0,
    hasOasis:true, oasisCount:6, oasisRadius:420,
    rockFlavors:[{ type:'sandrock', w:1 }],
  },
};

const ELEMENTS = {
  mocchi:  { label:'モッチー',   color:'#ff8fc4', dark:'#b3548a', speed:190, hp:115, trait:'soft', dmgTakenMod:0.8 },
  suezo:   { label:'スエゾー',   color:'#ffdd33', dark:'#a8901f', speed:222, hp:76,  trait:'gutsbreak' },
  phoenix: { label:'ヒノトリ',   color:'#f2b33d', dark:'#9c6a1a', accent:'#e8432a', speed:198, hp:110, trait:'haste', cooldownMod:1/1.5 },
  fire:    { label:'ドラゴン',   color:'#ff6b35', dark:'#a8431d', speed:182, hp:100, trait:'burn' },
  aqua:    { label:'ウンディーネ', color:'#3dccc7', dark:'#1d8c88', speed:204, hp:88,  trait:'lifesteal' },
  leaf:    { label:'プラント',   color:'#7fb236', dark:'#4f6f1f', speed:140, hp:200, trait:'gutsdrain', cooldownMod:1/1.5, dmgDealtMod:0.8, gutsRegenMod:1.5 },
  spark:   { label:'ライガー',   color:'#f4c430', dark:'#a8801c', speed:224, hp:78,  trait:'slow' },
  rock:    { label:'ゴーレム',   color:'#a98a68', dark:'#5c4a38', speed:158, hp:132, trait:'golem', dmgTakenMod:0.8, dmgDealtMod:1.2 },
  ark:     { label:'アーク',     color:'#f5f2e0', dark:'#8a7a4a', accent:'#ffe9a8', speed:188, hp:145, trait:'grace' },
  warm:    { label:'ワーム',     color:'#9b5fd1', dark:'#5c3680', speed:185, hp:160, trait:'poison' },
  illumine:{ label:'イルミネ',   color:'#1c1c22', dark:'#0a0a0d', accent:'#c98bff', speed:206, hp:155, trait:'haste', cooldownMod:1/1.5 },
  fox:     { label:'キュービ',   color:'#f5f2ea', dark:'#b8b2a4', speed:215, hp:105, trait:'bighitbox', hitboxMult:1.5 },
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

// ワームtier3「シェルアタック」: 相手に命中した時、自分の移動速度にかかるバフ
const WARM_SHELL_SPEED_BUFF_MULT = 1.5;   // 移動速度倍率
const WARM_SHELL_SPEED_BUFF_DURATION = 10; // 効果時間(秒)

const SIGNATURE_MOVES = {
  fire: [
    { name:'ファイア',   tier:1, color:'#ff6b35', range:700,  dmg:24, cooldown:0.85, gutsCost:8, projSpeed:520, hitR:12, splash:70, icon:'🔥' },
    { name:'ファイアブレス',   tier:2, color:'#ff6b35', range:1400, dmg:13, cooldown:1.1, gutsCost:16, projSpeed:480, hitR:7,  burst:3, burstGap:0.12, icon:'🔥' },
    { name:'インフェルノ',   tier:3, color:'#ff3b1a', dmg:55, cooldown:2.1, gutsCost:24,
      aoeShape:'fan', range:800, fanAngleDeg:45, aoeStyle:'inferno' },
  ],
  aqua: [
    { name:'水風船',     tier:1, color:'#3dccc7', range:750,  dmg:23, cooldown:0.8,  gutsCost:8, projSpeed:560, hitR:11, splash:68, icon:'💧' },
    { name:'アクアウェイブ',   tier:2, color:'#3dccc7', range:1500, dmg:12, cooldown:1.0, gutsCost:16, projSpeed:520, hitR:6,  burst:3, burstGap:0.1, icon:'💧' },
    { name:'クリスタルレイン',   tier:3, color:'#3dccc7', dmg:42, cooldown:1.9, gutsCost:24,
      aoeShape:'rect', range:900, rectWidth:260, aoeStyle:'crystal' },
  ],
  leaf: [
    { name:'種',     tier:1, color:'#7fb236', range:650,  dmg:22, cooldown:0.78, gutsCost:8, projSpeed:500, hitR:12, splash:72, icon:'🍃' },
    { name:'種マシンガン', tier:2, color:'#7fb236', range:1300, dmg:11, cooldown:1.15, gutsCost:16, projSpeed:460, hitR:6,  burst:4, burstGap:0.11, icon:'🍃' },
    { name:'フラワービーム',   tier:3, color:'#8fe33f', dmg:44, cooldown:2.2, gutsCost:24,
      aoeShape:'beams', range:1200, beamWidth:100, beamCount:3, beamSpreadDeg:40, aoeStyle:'flower' },
  ],
  spark: [
    { name:'かみなり',   tier:1, color:'#f4c430', range:650,  dmg:20, cooldown:0.7,  gutsCost:8, projSpeed:600, hitR:10, splash:62, icon:'⚡️' },
    { name:'雷撃', tier:2, color:'#f4c430', range:1300, dmg:9,  cooldown:0.85, gutsCost:16, projSpeed:560, hitR:5,  burst:5, burstGap:0.08, icon:'⚡️' },
    { name:'超雷撃',     tier:3, color:'#fff34d', dmg:40, cooldown:1.9, gutsCost:24,
      aoeShape:'zigzag', range:1400, zigzagWidth:110, aoeStyle:'thunder' },
  ],
  rock: [
    { name:'ロケットパンチ',       tier:1, color:'#a98a68', range:600,  dmg:28, cooldown:0.95, gutsCost:8, projSpeed:440, hitR:14, splash:78, icon:'👊🏿' },
    { name:'掌打',   tier:2, color:'#a98a68', range:1200, dmg:15, cooldown:1.3, gutsCost:16, projSpeed:380, hitR:9,  burst:3, burstGap:0.14, icon:'🤚🏿' },
    { name:'竜巻アタック', tier:3, color:'#a98a68', range:1600, dmg:62, cooldown:2.4, gutsCost:24, projSpeed:520, hitR:34, splash:60, projStyle:'tornado', growWithDistance:true },
  ],
  phoenix: [
    { name:'火炎砲',     tier:1, color:'#e8432a', range:725,  dmg:25, cooldown:0.82, gutsCost:8, projSpeed:540, hitR:12, splash:70, icon:'🔥' },
    { name:'火炎連砲', tier:2, color:'#e8432a', range:1450, dmg:13, cooldown:1.05, gutsCost:16, projSpeed:500, hitR:7,  burst:3, burstGap:0.1, icon:'🔥' },
    { name:'ファイアウェーブ', tier:3, color:'#ff8a3d', dmg:47, cooldown:2.0, gutsCost:24,
      aoeShape:'rect', range:1000, rectWidth:220, aoeStyle:'lava' },
  ],
  ark: [
    { name:'しっぽふり',   tier:1, color:'#ffe9a8', range:700,  dmg:24, cooldown:0.85, gutsCost:8, projSpeed:520, hitR:12, splash:70, icon:'🌱' },
    { name:'熾天の剣', tier:2, color:'#ffe9a8', range:1450, dmg:13, cooldown:1.05, gutsCost:16, projSpeed:500, hitR:7,  burst:3, burstGap:0.1, icon:'🏹' },
    { name:'天の慈悲', tier:3, color:'#ffe9a8', range:1850, dmg:58, cooldown:2.0, gutsCost:24, projSpeed:560, hitR:30, splash:55, shape:'triangle', projStyle:'holy' },
  ],
  warm: [
    { name:'毒ガス',       tier:1, color:'#9b5fd1', range:700,  dmg:23, cooldown:0.85, gutsCost:8, projSpeed:500, hitR:12, splash:75, icon:'☠️' },
    { name:'毒噴射',   tier:2, color:'#9b5fd1', range:1400, dmg:12, cooldown:1.1, gutsCost:16, projSpeed:470, hitR:7,  burst:3, burstGap:0.12, icon:'☠️' },
    { name:'シェルアタック', tier:3, color:'#9b5fd1', range:1750, dmg:56, cooldown:2.1, gutsCost:24, projSpeed:500, hitR:34, splash:58, shape:'sphere', projStyle:'shell', selfSpeedBuffOnHit:true },
  ],
  illumine: [
    { name:'ヴェノムエッジ', tier:1, color:'#8b2fc9', range:700,  dmg:25, cooldown:0.85, gutsCost:8, projSpeed:540, hitR:12, splash:70, icon:'🗡️' },
    { name:'アサルトアロー', tier:2, color:'#8b2fc9', range:1450, dmg:13, cooldown:1.05, gutsCost:16, projSpeed:580, hitR:7,  burst:3, burstGap:0.09, icon:'🗡️' },
    { name:'レクイエムエンド', tier:3, color:'#e6c35c', range:1750, dmg:24, cooldown:2.2, gutsCost:24, projSpeed:720, hitR:20, burst:3, burstGap:0.1, shape:'triangle', projStyle:'requiem' },
  ],
  fox: [
    { name:'狐火',     tier:1, color:'#eaf6ff', range:700,  dmg:23, cooldown:0.82, gutsCost:8, projSpeed:530, hitR:13, splash:74 },
    { name:'超狐火',   tier:2, color:'#eaf6ff', range:1450, dmg:13, cooldown:1.05, gutsCost:16, projSpeed:540, hitR:7,  burst:3, burstGap:0.1 },
    { name:'天河天翔', tier:3, color:'#ffffff', dmg:48, cooldown:2.1, gutsCost:24,
      aoeShape:'rect', range:2200, rectWidth:160, aoeStyle:'galaxy' },
  ],
  mocchi: [
    { name:'もんた',     tier:1, color:'#ff8fc4', range:700,  dmg:24, cooldown:0.85, gutsCost:8, projSpeed:530, hitR:12, splash:70, icon:'🖐🏻' },
    { name:'さくらふぶき', tier:2, color:'#ff8fc4', range:1400, dmg:13, cooldown:1.05, gutsCost:16, projSpeed:500, hitR:7,  burst:3, burstGap:0.1, icon:'🌸' },
    { name:'モッチ砲', tier:3, color:'#ff5fb0', dmg:46, cooldown:2.1, gutsCost:24, projSpeed:1400,
      aoeShape:'rect', range:1000, rectWidth:120, aoeStyle:'sakura' },
  ],
  suezo: [
    { name:'ツバはき',   tier:1, color:'#ffdd33', range:700,  dmg:22, cooldown:0.8,  gutsCost:8, projSpeed:520, hitR:12, splash:70, icon:'💧' },
    { name:'熱視線', tier:2, color:'#ffdd33', dmg:30, cooldown:1.1, gutsCost:16,
      aoeShape:'rect', range:1300, rectWidth:70 },
    { name:'サイコキネシス', tier:3, color:'#3d9fff', dmg:45, cooldown:2.0, gutsCost:24,
      aoeShape:'fanZigzag', range:1300, fanAngleDeg:30, aoeStyle:'psychic' },
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

// ===== トレーニングアイテム(出現率は低め・永続ステータス強化) =====
const TRAINING_ITEMS = {
  weight:   { name:'重り引き', emoji:'🏋️', color:'#c97b3d', accent:'#ffd9a8', desc:'技ダメージ+16%・最大HP+30' },
  meditate: { name:'めいそう', emoji:'🧘', color:'#7bd1c9', accent:'#d8fff8', desc:'技の消費ガッツ-2・技弾速+20%' },
  pool:     { name:'プール',   emoji:'🏊', color:'#3d9fd1', accent:'#bfe9ff', desc:'最大HP+36・被ダメ-10%' },
  floor:    { name:'変動ゆか', emoji:'💃', color:'#d13d9f', accent:'#ffbfe9', desc:'移動速度+12%・技の連射速度+16%' },
};
const TRAINING_TYPES = Object.keys(TRAINING_ITEMS);

// ===== モンスター専用の状態変化 =====
// trigger: 'hpBelow'(HP割合が閾値以下) / 'gutsBelow'(ガッツ割合が閾値以下) /
//          'onHitChance'(技命中時に確率で) / 'onHitTakenChance'(技を受けた時に確率で) / 'onKill'(撃破時に確実に)
// effects: dmgMult(技ダメージ) gutsRegenMult(ガッツ回復速度) cooldownMult(技のクールタイム、小さいほど速い)
//          gutsCostMult(技の消費ガッツ) speedMult(移動速度) dmgTakenMult(被ダメージ) lifestealPct(与ダメの何%を自分のHPに回復)
const STATE_CHANGES = {
  fire: {
    name:'憤怒', duration:30, cooldown:120, trigger:'hpBelow', triggerValue:0.5,
    effects:{ dmgMult:1.2, gutsRegenMult:2, cooldownMult:1/1.5, speedMult:1.5 },
  },
  aqua: {
    name:'元気', duration:20, cooldown:60, trigger:'onHitChance', triggerValue:0.2,
    effects:{ cooldownMult:0.5, gutsCostMult:0.5 },
  },
  leaf: {
    name:'必死', duration:20, cooldown:60, trigger:'hpBelow', triggerValue:0.5,
    effects:{ speedMult:2, lifestealPct:0.5 },
  },
  spark: {
    name:'元気', duration:20, cooldown:60, trigger:'onHitChance', triggerValue:0.2,
    effects:{ cooldownMult:0.5, gutsCostMult:0.5 },
  },
  rock: {
    name:'我慢', duration:30, cooldown:120, trigger:'hpBelow', triggerValue:0.3,
    effects:{ dmgTakenMult:0.5, gutsRegenMult:2, cooldownMult:0.5 },
  },
  phoenix: {
    name:'本気', duration:30, cooldown:120, trigger:'onKill', triggerValue:null,
    effects:{ dmgTakenMult:0.8, dmgMult:1.2, gutsRegenMult:2, speedMult:1.5 },
  },
  ark: {
    name:'余裕', duration:20, cooldown:120, trigger:'hpBelow', triggerValue:0.5,
    effects:{ gutsRegenMult:2, speedMult:1.5, dmgTakenMult:1.5 },
  },
  warm: {
    name:'闘魂', duration:20, cooldown:120, trigger:'gutsBelow', triggerValue:0.5,
    effects:{ gutsRegenMult:2, cooldownMult:1/1.5 },
  },
  illumine: {
    name:'我慢', duration:30, cooldown:120, trigger:'hpBelow', triggerValue:0.3,
    effects:{ dmgTakenMult:0.5, gutsRegenMult:2, cooldownMult:0.5 },
  },
  fox: {
    name:'陽炎', duration:5, cooldown:60, trigger:'onHitChance', triggerValue:0.2,
    effects:{ dmgTakenMult:0 },
  },
  mocchi: {
    name:'元気', duration:20, cooldown:60, trigger:'onHitChance', triggerValue:0.2,
    effects:{ cooldownMult:0.5, gutsCostMult:0.5 },
  },
  suezo: {
    name:'逆上', duration:20, cooldown:60, trigger:'onHitTakenChance', triggerValue:0.2,
    effects:{ gutsRegenMult:2, speedMult:1.5 },
  },
};

const BOT_NAMES = ['ガロン','ヒスイ','ボムリン','ナギ','ソルト','ピコ','ザンギ','ウル','ミドリ','カイト','ルゥ','テスラ','ドンガラ','フブキ','イグニ','クラゲン','モグ','ライ','バサル','ジン','ヌマル','コゲ'];

/* =====================================================================
   マスモン(マスターモンスター)
===================================================================== */
const MASTERMON_STORAGE_KEY = 'aramon_mastermons_v1';
const MASTERMON_STAT_CAP = 999;
const MASTERMON_LEVEL_CAP = 100;

const MASTERMON_STATS = [
  { key:'life',     label:'ライフ',   color:'#f4c430', desc:'HPに影響' },
  { key:'power',    label:'ちから',   color:'#e0473f', desc:'技の威力・被ダメージに影響' },
  { key:'wisdom',   label:'かしこさ', color:'#5fbf5f', desc:'技の威力・ガッツ回復速度に影響' },
  { key:'accuracy', label:'命中',    color:'#ef6fb0', desc:'技の連射速度に影響' },
  { key:'evasion',  label:'回避',    color:'#4fc9e0', desc:'移動速度に影響' },
  { key:'vitality', label:'丈夫さ',   color:'#2d4fae', desc:'被ダメージに影響' },
];

// モンスター毎のステータス適正(A〜E)。イルミネ・キュービは指定値、他は近縁の性質を参考に設定。
const APTITUDE = {
  fire:    { life:'C', power:'A', wisdom:'A', accuracy:'C', evasion:'D', vitality:'C' },
  aqua:    { life:'C', power:'D', wisdom:'B', accuracy:'B', evasion:'A', vitality:'D' },
  leaf:    { life:'A', power:'E', wisdom:'C', accuracy:'C', evasion:'D', vitality:'E' },
  spark:   { life:'D', power:'D', wisdom:'B', accuracy:'A', evasion:'B', vitality:'E' },
  rock:    { life:'C', power:'A', wisdom:'C', accuracy:'E', evasion:'E', vitality:'A' },
  phoenix: { life:'C', power:'E', wisdom:'A', accuracy:'C', evasion:'C', vitality:'C' },
  ark:     { life:'B', power:'D', wisdom:'A', accuracy:'B', evasion:'B', vitality:'C' },
  warm:    { life:'B', power:'B', wisdom:'D', accuracy:'C', evasion:'C', vitality:'D' },
  illumine:{ life:'C', power:'B', wisdom:'E', accuracy:'A', evasion:'B', vitality:'C' },
  fox:     { life:'C', power:'D', wisdom:'B', accuracy:'A', evasion:'B', vitality:'E' },
  mocchi:  { life:'C', power:'C', wisdom:'C', accuracy:'B', evasion:'B', vitality:'B' },
  suezo:   { life:'D', power:'C', wisdom:'A', accuracy:'B', evasion:'D', vitality:'D' },
};
const APTITUDE_INITIAL_VALUE = { A:150, B:130, C:110, D:90, E:70 };
const APTITUDE_TRAIN_MULT   = { A:1.5, B:1.25, C:1.0, D:0.8, E:0.6 };

// トレーニングメニュー。upは適正に応じて上昇量が変動、downは適正に関係なく固定量で下降
const TRAINING_MENU = [
  { key:'domino',  label:'ドミノ倒し', desc:'ちから↑',            up:[{stat:'power',   amount:18}], down:[] },
  { key:'shateki', label:'しゃてき',   desc:'命中↑',             up:[{stat:'accuracy',amount:18}], down:[] },
  { key:'study',   label:'猛勉強',    desc:'かしこさ↑',          up:[{stat:'wisdom',  amount:18}], down:[] },
  { key:'boulder', label:'巨石よけ',   desc:'回避↑',             up:[{stat:'evasion', amount:18}], down:[] },
  { key:'run',     label:'走り込み',   desc:'ライフ↑',            up:[{stat:'life',    amount:18}], down:[] },
  { key:'log',     label:'丸太うけ',   desc:'丈夫さ↑',            up:[{stat:'vitality',amount:18}], down:[] },
  { key:'weight',  label:'重り引き',   desc:'ちから↑↑・ライフ↑／回避↓', up:[{stat:'power',   amount:28},{stat:'life',    amount:12}], down:[{stat:'evasion', amount:10}] },
  { key:'floor',   label:'変動ゆか',   desc:'回避↑↑・かしこさ↑／ちから↓', up:[{stat:'evasion', amount:28},{stat:'wisdom',  amount:12}], down:[{stat:'power',   amount:10}] },
  { key:'medit',   label:'めいそう',   desc:'かしこさ↑↑・命中↑／丈夫さ↓', up:[{stat:'wisdom',  amount:28},{stat:'accuracy',amount:12}], down:[{stat:'vitality',amount:10}] },
  { key:'pool',    label:'プール',    desc:'丈夫さ↑↑・ライフ↑／かしこさ↓', up:[{stat:'vitality',amount:28},{stat:'life',    amount:12}], down:[{stat:'wisdom',  amount:10}] },
];

function mastermonClampStat(v){ return Math.max(1, Math.min(MASTERMON_STAT_CAP, Math.round(v))); }
function mastermonInitialStats(elementKey){
  const apt = APTITUDE[elementKey];
  const stats = {};
  MASTERMON_STATS.forEach(s=>{ stats[s.key] = APTITUDE_INITIAL_VALUE[apt[s.key]]; });
  return stats;
}
function mastermonExpToNext(level){ return 80 + level*15; }
// ステータス100を基準(倍率1.0)に、ステータスごとの係数(小さいほど効果の増減幅が大きい)で倍率を算出。
// ライフ・命中・丈夫さは増減幅を拡大、回避は増減幅を縮小するためデフォルト(900)から変更。
const MASTERMON_STAT_FACTOR_DIVISOR = {
  life:     450,  // 増減幅アップ(さらに拡大)
  power:    900,
  wisdom:   900,
  accuracy: 650,  // 増減幅アップ
  evasion:  1300, // 増減幅ダウン
  vitality: 450,  // 増減幅アップ(さらに拡大)
};
function mastermonStatFactor(v, statKey){
  const divisor = MASTERMON_STAT_FACTOR_DIVISOR[statKey] || 900;
  return 1 + (v-100)/divisor;
}

function loadMastermons(){
  try{ return JSON.parse(localStorage.getItem(MASTERMON_STORAGE_KEY)) || {}; }catch(err){ return {}; }
}
function saveMastermons(data){
  try{ localStorage.setItem(MASTERMON_STORAGE_KEY, JSON.stringify(data)); }catch(err){}
}
function deleteMastermon(elementKey){
  const data = loadMastermons();
  delete data[elementKey];
  saveMastermons(data);
}
function createMastermon(elementKey, name){
  return {
    element: elementKey,
    name: (name||'').trim().slice(0,10) || ELEMENTS[elementKey].label,
    level: 1, exp: 0, tickets: 1,
    stats: mastermonInitialStats(elementKey),
  };
}
// 実際には反映せず、実行した場合の各ステータス変動量(クランプ後の差分)だけを計算する
function previewMastermonTraining(mm, trainingKey){
  const tpl = TRAINING_MENU.find(t=>t.key===trainingKey);
  if(!tpl) return null;
  const apt = APTITUDE[mm.element];
  const changes = {};
  tpl.up.forEach(u=>{
    const mult = APTITUDE_TRAIN_MULT[apt[u.stat]] || 1;
    const gain = Math.round(u.amount*mult);
    const newVal = mastermonClampStat(mm.stats[u.stat]+gain);
    changes[u.stat] = newVal - mm.stats[u.stat];
  });
  tpl.down.forEach(d=>{
    const newVal = mastermonClampStat(mm.stats[d.stat]-d.amount);
    changes[d.stat] = newVal - mm.stats[d.stat];
  });
  return changes;
}
function applyMastermonTraining(mm, trainingKey){
  if(mm.tickets<=0) return null;
  const changes = previewMastermonTraining(mm, trainingKey);
  if(!changes) return null;
  Object.keys(changes).forEach(k=>{ mm.stats[k] = mastermonClampStat(mm.stats[k]+changes[k]); });
  mm.tickets -= 1;
  return changes;
}
// 試合成績に応じてEXPを付与し、レベルアップ毎にトレーニングチケットを1枚獲得
const MASTERMON_EXP_GLOBAL_MULT = 3; // 全試合共通のEXP倍率
// マスモン(bot補完・他プレイヤー)撃破ボーナス: 相手のレベル×この値のEXPを追加で獲得
// (xpMult・GLOBAL_MULTは掛けない固定値。バランス調整はこの係数で行う)
const MASTERMON_KILL_EXP_PER_LEVEL = 10;
function awardMastermonExp(mm, opts){
  opts = opts || {};
  const kills = opts.kills||0, damage = opts.damage||0, survivalSec = opts.survivalSec||0, champion = !!opts.champion;
  const xpMult = opts.xpMult||1;
  const bonusExp = Math.round(opts.bonusExp||0); // マスモン撃破ボーナス等の加算EXP
  if(mm.level>=MASTERMON_LEVEL_CAP) return { expGain:0, levelsGained:0 };
  const expGain = Math.round((kills*15 + damage/20 + survivalSec/10 + (champion?100:0)) * xpMult * MASTERMON_EXP_GLOBAL_MULT) + bonusExp;
  mm.exp += expGain;
  let levelsGained = 0;
  while(mm.level<MASTERMON_LEVEL_CAP && mm.exp>=mastermonExpToNext(mm.level)){
    mm.exp -= mastermonExpToNext(mm.level);
    mm.level += 1;
    mm.tickets += 1;
    levelsGained += 1;
  }
  if(mm.level>=MASTERMON_LEVEL_CAP) mm.exp = 0;
  return { expGain, levelsGained };
}
// マスモンのステータスから、バトル中に適用する各種倍率を算出
function mastermonEffectMults(mm){
  const s = mm.stats, f = mastermonStatFactor;
  return {
    lifeMult: f(s.life, 'life'),
    dmgDealtMult: (f(s.power,'power')+f(s.wisdom,'wisdom'))/2,
    dmgTakenMult: 1/((f(s.power,'power')+f(s.vitality,'vitality'))/2),
    gutsRegenMult: f(s.wisdom,'wisdom'),
    cooldownMult: 1/f(s.accuracy,'accuracy'),
    speedMult: f(s.evasion,'evasion'),
  };
}

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
