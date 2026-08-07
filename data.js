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
// realObstacles はリアルマップだけで使う障害物の内訳(real3d.jsが3Dモデルで描く)。
// 通常マップは今までどおり rockFlavors を使うので見た目は変わらない。
const WATER_SPEED_MULT = 0.6; // 海・川の中での移動速度倍率
const OASIS_SPEED_MULT = 0.8; // オアシスの中での移動速度倍率
const MAPS = {
  wild: {
    key:'wild', label:'荒野', rockCount:800, decorCount:9000, hasVolcano:false,
    groundColor:'#142433',
    previewIcon:'🪨', previewColors:['#2a3a4a','#0f1a24'],
    desc:'岩が点在するだけのシンプルな荒野。見通しが良く、初めてのバトルにもおすすめ。',
    realObstacles:[{ type:'rock', w:0.74 }, { type:'deadtree', w:0.26 }],
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
    realObstacles:[{ type:'rock', w:0.58 }, { type:'basalt', w:0.42 }],
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
    realObstacles:[{ type:'snowrock', w:0.6 }, { type:'pine', w:0.4 }],
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
    realObstacles:[{ type:'tree', w:0.5 }, { type:'rock', w:0.28 }, { type:'log', w:0.22 }],
  },
  toble: {
    key:'toble', label:'トーブル海岸', rockCount:560, decorCount:6800, hasVolcano:false,
    groundColor:'#cdb27a',
    previewIcon:'🌊', previewColors:['#2e6a8a','#c9ad76'],
    desc:'左手に大海、右手から川が流れ込む海岸線。水の中は動きが鈍くなり、アイテムも湧かない。',
    hasSea:true, seaWidthRatio:0.14,
    hasRiver:true, riverCount:5, riverWidth:260,
    rockFlavors:[{ type:'rock', w:0.5 }, { type:'shell', w:0.5 }],
    realObstacles:[{ type:'palm', w:0.36 }, { type:'rock', w:0.34 }, { type:'shell', w:0.30 }],
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
    realObstacles:[{ type:'sandrock', w:0.66 }, { type:'cactus', w:0.34 }],
  },
};

const ELEMENTS = {
  mocchi:  { label:'モッチー',   color:'#ff8fc4', dark:'#b3548a', speed:190, hp:115, trait:'soft', dmgTakenMod:0.8 },
  suezo:   { label:'スエゾー',   color:'#ffdd33', dark:'#a8901f', speed:222, hp:76,  trait:'gutsbreak' },
  phoenix: { label:'ヒノトリ',   color:'#f2b33d', dark:'#9c6a1a', accent:'#e8432a', speed:200, hp:130, trait:'haste', cooldownMod:1/1.5 },
  fire:    { label:'ドラゴン',   color:'#ff6b35', dark:'#a8431d', speed:182, hp:125, trait:'burn' },
  aqua:    { label:'ウンディーネ', color:'#3dccc7', dark:'#1d8c88', speed:204, hp:88,  trait:'lifesteal' },
  leaf:    { label:'プラント',   color:'#7fb236', dark:'#4f6f1f', speed:140, hp:200, trait:'gutsdrain', cooldownMod:1/1.5, dmgDealtMod:0.8, gutsRegenMod:1.5 },
  spark:   { label:'ライガー',   color:'#f4c430', dark:'#a8801c', speed:224, hp:78,  trait:'slow' },
  rock:    { label:'ゴーレム',   color:'#a98a68', dark:'#5c4a38', speed:158, hp:132, trait:'golem', dmgTakenMod:0.8, dmgDealtMod:1.2 },
  ark:     { label:'アーク',     color:'#f5f2e0', dark:'#8a7a4a', accent:'#ffe9a8', speed:188, hp:145, trait:'grace' },
  warm:    { label:'ワーム',     color:'#9b5fd1', dark:'#5c3680', speed:185, hp:160, trait:'poison' },
  illumine:{ label:'イルミネ',   color:'#1c1c22', dark:'#0a0a0d', accent:'#c98bff', speed:206, hp:155, trait:'haste', cooldownMod:1/1.5 },
  fox:     { label:'キュービ',   color:'#f5f2ea', dark:'#b8b2a4', speed:215, hp:105, trait:'bighitbox', hitboxMult:1.5 },
  god:     { label:'ガリ',       color:'#f5f0ff', dark:'#c3b3e0', accent:'#ffd23c', speed:196, hp:110, trait:'godrange' },
  zan:     { label:'ザン',       color:'#3d4157', dark:'#1a1c28', accent:'#e5473d', speed:215, hp:95, trait:'poison' },
  pixie:   { label:'ピクシー',   color:'#f04060', dark:'#9c2c48', accent:'#905080', speed:200, speedMod:1.2, hp:70, trait:'nimble' },
  dullahan:{ label:'デュラハン', color:'#f2f4f8', dark:'#b7bcc8', speed:160, hp:120, trait:'dullahan' }, /*@dullahan*/
  // <<AUTO:ELEMENTS>> ここから上へ tools/monster_add.py が新モンスターの行を追記する
};

const monsterImages = {};
const playerMonsterImages = {};
// basePath (拡張子なし) に対して .png -> .PNG -> .Png の順で読み込みを試す。
// 最初に成功した拡張子はキャッシュしておき、次回以降は無駄なリトライをしない。
const EXT_CANDIDATES = ['png', 'PNG', 'Png'];
// lazy=true のときは src をまだ入れず、img._start() が呼ばれてから読み込みを始める
// (歩行スプライトは352枚あるので、起動時に全部読むと通信量もメモリも大きい)
function loadMonsterImage(basePath, lazy){
  const img = new Image();
  img.loaded = false;
  img.failed = false;
  img.decoding = 'async';
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
  if(lazy) img._start = ()=>{ img._start = null; tryNext(); };
  else tryNext();
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
// 召喚演出のスポーン円盤石(画像)。ガチャ演出用に厚み(立体)を焼き込んだ版も持つ
const summonDiskImg = loadMonsterImage('images/summon_disk');
const summonDiskThickImg = loadMonsterImage('images/summon_disk_thick');
// ガチャ画面のidle演出用(ピックアップ告知画像)。実際のURLは SKIN_MEDIA から決まるので、
// ピックアップの定数(GACHA_PICKUP_SSR / RAID_GACHA_PICKUP)を読める位置まで src の代入は遅らせる。
function loadPromoImage(url){
  const img = new Image();
  img.loaded = false; img.failed = false; img.decoding = 'async';
  img.onload = ()=>{ img.loaded = true; };
  img.onerror = ()=>{ img.failed = true; };
  if(url) img.src = url; else img.failed = true;
  return img;
}
const gachaPickupPromoImg = new Image();
gachaPickupPromoImg.loaded = false; gachaPickupPromoImg.failed = false; gachaPickupPromoImg.decoding = 'async';
gachaPickupPromoImg.onload = ()=>{ gachaPickupPromoImg.loaded = true; };
gachaPickupPromoImg.onerror = ()=>{ gachaPickupPromoImg.failed = true; };
// SSRスキンの手描き画像(アイコン=正面 / 試合用=後ろ姿)。
// 実体は SSR_SKINS の宣言直後に自動生成する(この位置では SSR_SKINS がまだTDZなので中身は入れない)。
const ssrSkinImages = {};
function imgIsReady(img){
  return img && img.loaded && !img.failed;
}

// ===== モンスターのバトル歩行アニメーション =====
// 動画から1歩行ループを8コマに分割した透過スプライト(正面8/後ろ8)。
// 歩行中はコマ送り、停止中は静止。進行方向がカメラ奥向き=後ろ姿/手前向き=正面。
// 素体は色スキン装備時に各コマを再着色。SSR専用コマがあればそれを使う(再着色しない)。
// 新しいモンスターの歩行を足すときは WALK_ANIM に画像プレフィックスを追加するだけでよい。
function _loadWalk(prefix){ return [1,2,3,4,5,6,7,8].map(i=>loadMonsterImage(`monsters/${prefix}${i}`, true)); }
/* 歩行コマは全部で352枚(6.8MB)ある。起動時に一括で読むと通信もメモリも大きいので、
   「実際に表示しようとした時」= この判定が最初に呼ばれた時に読み始める。
   揃うまでは呼び出し側が静止画にフォールバックし、揃い次第コマ送りへ切り替わる
   (この仕組みは元から入っているので、遅延ロードのために足す処理は無い)。      */
function _framesReady(arr){
  let ok = true;
  for(const im of arr){
    if(im._start) im._start();
    if(!imgIsReady(im)) ok = false;
  }
  return ok;
}
const WALK_ANIM = {
  mocchi: {
    base: { front:_loadWalk('mocchi_walk_f'),     back:_loadWalk('mocchi_walk_b') },     // 素モッチー(色スキン対応)
    ssr:  { skinId:'mocchi_ssr', front:_loadWalk('mocchi_ssr_walk_f'), back:_loadWalk('mocchi_ssr_walk_b') }, // ラガモッチー
  },
  god: {
    base: { front:_loadWalk('god_walk_f'), back:_loadWalk('god_walk_b') },               // ガリ(色スキン対応)
    ssr:  { skinId:'zeus_ssr', front:_loadWalk('zeus_ssr_walk_f'), back:_loadWalk('zeus_ssr_walk_b') }, // SSRゼウス
  },
  suezo: {
    base: { front:_loadWalk('suezo_walk_f'), back:_loadWalk('suezo_walk_b') },            // スエゾー(色スキン対応)
  },
  zan: {
    base: { front:_loadWalk('zan_walk_f'), back:_loadWalk('zan_walk_b') },                // ザン(色スキン対応)
  },
  fox: {
    base: { front:_loadWalk('fox_walk_f'), back:_loadWalk('fox_walk_b') },                // キュービ(色スキン対応)
    ssr:  { skinId:'tamamo_ssr', front:_loadWalk('tamamo_ssr_walk_f'), back:_loadWalk('tamamo_ssr_walk_b') }, // SSRタマモノマエ
  },
  spark: {
    base: { front:_loadWalk('spark_walk_f'), back:_loadWalk('spark_walk_b') },            // ライガー(色スキン対応)
  },
  phoenix: {
    base: { front:_loadWalk('phoenix_walk_f'),     back:_loadWalk('phoenix_walk_b') },     // ヒノトリ(色スキン対応)
    ssr:  { skinId:'phoenix_ssr', front:_loadWalk('phoenix_ssr_walk_f'), back:_loadWalk('phoenix_ssr_walk_b') }, // SSRフェニックス
  },
  ark: {
    base: { front:_loadWalk('ark_walk_f'), back:_loadWalk('ark_walk_b') },                // アーク(色スキン対応)
    ssr:  { skinId:'iblees_ssr', front:_loadWalk('iblees_ssr_walk_f'), back:_loadWalk('iblees_ssr_walk_b') }, // SSRイブリース
  },
  aqua: {
    base: { front:_loadWalk('aqua_walk_f'), back:_loadWalk('aqua_walk_b') },              // ウンディーネ(色スキン対応)
    ssr:  { skinId:'aqua_ssr', front:_loadWalk('aqua_ssr_walk_f'), back:_loadWalk('aqua_ssr_walk_b') }, /*@aqua_ssr*/
  },
  fire: {
    base: { front:_loadWalk('fire_walk_f'), back:_loadWalk('fire_walk_b') },              // ドラゴン(色スキン対応)
    ssr:  { skinId:'zod_ssr', front:_loadWalk('zod_ssr_walk_f'), back:_loadWalk('zod_ssr_walk_b') }, /*@zod_ssr*/
  },
  leaf: {
    base: { front:_loadWalk('leaf_walk_f'), back:_loadWalk('leaf_walk_b') },              // プラント(色スキン対応)
  },
  rock: {
    base: { front:_loadWalk('rock_walk_f'), back:_loadWalk('rock_walk_b') },              // ゴーレム(色スキン対応)
    ssr:  { skinId:'rock_ssr', front:_loadWalk('rock_ssr_walk_f'), back:_loadWalk('rock_ssr_walk_b') }, /*@rock_ssr*/
  },
  illumine: {
    base: { front:_loadWalk('illumine_walk_f'), back:_loadWalk('illumine_walk_b') },      // イルミネ(色スキン対応)
    ssr:  { skinId:'persephone_ssr', front:_loadWalk('persephone_ssr_walk_f'), back:_loadWalk('persephone_ssr_walk_b') }, // SSRペルセポネ
  },
  warm: {
    base: { front:_loadWalk('warm_walk_f'), back:_loadWalk('warm_walk_b') },              // ワーム(色スキン対応)
  },
  pixie: {
    base: { front:_loadWalk('pixie_walk_f'), back:_loadWalk('pixie_walk_b') },            // ピクシー(色スキン対応)
    ssr:  { skinId:'choco_ssr', front:_loadWalk('choco_ssr_walk_f'), back:_loadWalk('choco_ssr_walk_b') }, // SSRちょこ
  },
  dullahan:{ /*@dullahan*/
    base: { front:_loadWalk('dullahan_walk_f'), back:_loadWalk('dullahan_walk_b') },
    ssr:  { skinId:'guts_ssr', front:_loadWalk('guts_ssr_walk_f'), back:_loadWalk('guts_ssr_walk_b') }, /*@guts_ssr*/
  },
  // <<AUTO:WALK_ANIM>> ここから上へ tools/monster_add.py が新モンスターの行を追記する
};
const WALK_FRAME_DUR = 0.11; // 1コマの表示秒数(8コマ≒0.9秒/周)
const WALK_MOVE_EPS  = 30;   // これ以上の速度(ワールド単位/秒)で「歩行中」と判定
const MOVE_FACING_LOCK_MELEE_DUR = 0.3; // 近接技発生中の向き固定秒数(飛翔体等と違いエフェクト時間が無いため固定値)
const _walkRecolor = {};     // 色スキン再着色コマのキャッシュ element:colorId:view:idx -> canvas
function _entityDisplaySkinId(e){
  if(!e) return null;
  if(e.isPlayer) return (typeof getEquippedSkin==='function') ? getEquippedSkin(e.element) : null;
  return e.skinId || null;
}
// エンティティのこの瞬間に表示すべき歩行コマ画像を返す(対象外/未ロードはnull)。
function entityWalkFrameImage(e){
  if(!e) return null;
  const reg = WALK_ANIM[e.element];
  if(!reg) return null;
  const skin = _entityDisplaySkinId(e);
  const useSsr = !!(reg.ssr && skin===reg.ssr.skinId);
  // 歩行コマが用意されていないSSRスキン(例:ガリのゼウス)装備時は静止スキン画像を優先する
  if(skin && skin.indexOf(':')<0 && !useSsr) return null;
  const set = useSsr ? reg.ssr : reg.base;
  if(!set) return null;
  // 短絡させると後ろ姿のコマの読み込みが始まらないので、必ず両方を呼ぶ
  const frontOk = _framesReady(set.front), backOk = _framesReady(set.back);
  if(!frontOk || !backOk) return null;
  const t = (typeof matchTime==='number') ? matchTime : 0;
  // 1フレームに1回だけ移動量を更新(matchTimeをトークンにして重複呼び出しを吸収)
  if(e._mwToken!==t){
    const dt = (e._mwToken!=null) ? Math.max(1e-3, t-e._mwToken) : 0.016;
    const dx = e.x-(e._mwX!=null?e._mwX:e.x), dy = e.y-(e._mwY!=null?e._mwY:e.y);
    const sp = Math.hypot(dx,dy)/dt;
    e._mwSpeed = (e._mwSpeed||0)*0.5 + sp*0.5; // 速度をならす
    if(sp>1){ e._mwDirX=dx; e._mwDirY=dy; }     // 実移動時の向きを記憶
    e._mwX=e.x; e._mwY=e.y; e._mwToken=t;
  }
  const moving = (e._mwSpeed||0) > WALK_MOVE_EPS;
  const yaw = (typeof camState!=='undefined' && camState) ? camState.yaw : 0;
  let back;
  // 技発生中は移動方向に関わらず技を打った方向を向く(プレイヤーは奥に向けて打つため後ろ姿になる)
  if(typeof e.moveFacingUntil==='number' && t < e.moveFacingUntil && typeof e.moveFacingAngle==='number'){
    const fax=Math.cos(e.moveFacingAngle), fay=Math.sin(e.moveFacingAngle);
    back = (fax*Math.cos(yaw)+fay*Math.sin(yaw))>0;
  } else if(!moving){
    back = !!e.isPlayer;                          // 停止中の既定(自分=後ろ姿/他=正面)
  } else {
    const mvx=e._mwDirX||0, mvy=e._mwDirY||0;     // 進行方向がカメラ奥向き=後ろ姿/手前=正面
    back = (Math.hypot(mvx,mvy)<1e-3) ? !!e.isPlayer : (mvx*Math.cos(yaw)+mvy*Math.sin(yaw))>0;
  }
  let idx = 0; // 停止中は静止(先頭コマ)
  if(moving){ const phase = Math.floor((t + (e.id||0)*0.13)/WALK_FRAME_DUR); idx = ((phase%8)+8)%8; }
  const baseImg = (back ? set.back : set.front)[idx];
  if(!imgIsReady(baseImg)) return null;
  // SSR専用コマは再着色しない。素体で色スキン(element:colorId)装備時のみ再着色。
  if(!useSsr && skin && skin.indexOf(':')>=0 && typeof recolorToCanvas==='function' && typeof SKIN_COLORS!=='undefined'){
    const [selem, colorId] = skin.split(':');
    if(selem===e.element && SKIN_COLORS[colorId]){
      const ck = `${e.element}:${colorId}:${back?'b':'f'}:${idx}`;
      if(!_walkRecolor[ck]) _walkRecolor[ck] = recolorToCanvas(baseImg, e.element, colorId, 0);
      return _walkRecolor[ck];
    }
  }
  return baseImg;
}

function getDisplayImage(entity){
  // 歩行アニメがあれば最優先(進行方向で前後・停止で静止)
  const wf = entityWalkFrameImage(entity);
  if(wf) return wf;
  // 着せ替えスキン(自分/相手/マスモンbot)を装備していれば、そのスキン画像を優先する
  if(typeof skinnedImageForEntity==='function'){
    const sk = skinnedImageForEntity(entity);
    if(sk) return sk;
  }
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
      aoeShape:'fan', range:800, fanAngleDeg:45, aoeStyle:'inferno',
      // 扇の先端に、半分ずつ重ねた3つの爆風ドームを横並びで出す(不死のゾッドのtier3も継承)。
      // 遮蔽物で扇が途中で途切れた場合はその位置で爆発する(combat.jsのspawnAoeEndBlast)
      endBlast:{ count:3, radius:140, dmg:16, expandTime:0.35, color:'#ff6a2e' } },
  ],
  aqua: [
    { name:'水風船',     tier:1, color:'#3dccc7', range:750,  dmg:23, cooldown:0.8,  gutsCost:8, projSpeed:560, hitR:11, splash:68, icon:'💧' },
    { name:'アクアウェイブ',   tier:2, color:'#3dccc7', range:1500, dmg:12, cooldown:1.0, gutsCost:16, projSpeed:520, hitR:6,  burst:3, burstGap:0.1, icon:'💧' },
    { name:'クリスタルレイン',   tier:3, color:'#3dccc7', dmg:42, cooldown:1.9, gutsCost:24,
      aoeShape:'rect', range:900, rectWidth:260, aoeStyle:'crystal', seStyle:'crystalRain' },
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
    { name:'竜巻アタック', tier:3, color:'#a98a68', range:1600, dmg:21, cooldown:2.4, gutsCost:24, projSpeed:520, hitR:34, splash:60, projStyle:'tornado', growWithDistance:true,
      burst:3, burstGap:0, burstSpread:0, burstSideStep:105 }, // 超番長ボーナスと同じ3本構成(色・エフェクトはそのまま)。1本あたりのdmgは合計が旧来の62相当になるよう調整
  ],
  phoenix: [
    { name:'火炎砲',     tier:1, color:'#e8432a', range:725,  dmg:25, cooldown:0.82, gutsCost:8, projSpeed:540, hitR:12, splash:70, icon:'🔥' },
    { name:'火炎連砲', tier:2, color:'#e8432a', range:1450, dmg:13, cooldown:1.05, gutsCost:16, projSpeed:500, hitR:7,  burst:3, burstGap:0.1, icon:'🔥' },
    { name:'ファイアウェーブ', tier:3, color:'#ff8a3d', dmg:47, cooldown:2.0, gutsCost:24,
      aoeShape:'rect', range:1000, rectWidth:220, aoeStyle:'lava', seStyle:'fireWave' },
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
    { name:'ヴェノムエッジ', tier:1, color:'#8b2fc9', range:700,  dmg:25, cooldown:0.85, gutsCost:8, projSpeed:540, hitR:12, splash:70, icon:'🗡️', seStyle:'venomEdge' },
    { name:'アサルトアロー', tier:2, color:'#8b2fc9', range:1450, dmg:13, cooldown:1.05, gutsCost:16, projSpeed:580, hitR:7,  burst:3, burstGap:0.09, icon:'🗡️', seStyle:'assaultArrow' },
    // 3発それぞれの着弾点にドーム状の爆風が広がる(アムピトリテと同じ blast の仕組み)。
    // ドームの色は requiem の暗い紫(render.jsのDARKと同色)に合わせてある
    { name:'レクイエムエンド', tier:3, color:'#e6c35c', range:1750, dmg:24, cooldown:2.2, gutsCost:24, projSpeed:720, hitR:20, burst:3, burstGap:0.1, shape:'triangle', projStyle:'requiem', seStyle:'requiemEnd',
      blast:{ radius:260, dmg:18, color:'#1d0b2e', expandTime:0.45, se:'requiemBlast' } },
  ],
  fox: [
    { name:'狐火',     tier:1, color:'#eaf6ff', range:700,  dmg:23, cooldown:0.82, gutsCost:8, projSpeed:530, hitR:13, splash:74 },
    { name:'超狐火',   tier:2, color:'#eaf6ff', range:1450, dmg:13, cooldown:1.05, gutsCost:16, projSpeed:540, hitR:7,  burst:3, burstGap:0.1 },
    { name:'天河天翔', tier:3, color:'#ffffff', dmg:48, cooldown:2.1, gutsCost:24,
      aoeShape:'rect', range:2200, rectWidth:160, aoeStyle:'galaxy' },
  ],
  mocchi: [
    { name:'もんた',     tier:1, color:'#ff8fc4', range:700,  dmg:24, cooldown:0.85, gutsCost:8, projSpeed:530, hitR:12, splash:70, icon:'🖐🏻', seStyle:'monta' },
    { name:'さくらふぶき', tier:2, color:'#ff8fc4', range:1400, dmg:13, cooldown:1.05, gutsCost:16, projSpeed:500, hitR:7,  burst:3, burstGap:0.1, icon:'🌸' },
    { name:'モッチ砲', tier:3, color:'#ff5fb0', dmg:46, cooldown:2.1, gutsCost:24, projSpeed:1400,
      aoeShape:'rect', range:1000, rectWidth:120, aoeStyle:'sakura', seStyle:'mocchiBeam' },
  ],
  suezo: [
    { name:'ツバはき',   tier:1, color:'#ffdd33', range:700,  dmg:22, cooldown:0.8,  gutsCost:8, projSpeed:520, hitR:12, splash:70, icon:'💧' },
    { name:'熱視線', tier:2, color:'#ffdd33', dmg:30, cooldown:1.1, gutsCost:16,
      aoeShape:'rect', range:1300, rectWidth:70, seStyle:'beam' },
    { name:'サイコキネシス', tier:3, color:'#3d9fff', dmg:45, cooldown:2.0, gutsCost:24,
      aoeShape:'fanZigzag', range:1300, fanAngleDeg:30, aoeStyle:'psychic' },
  ],
  // ガリ(god): 特性で全技の射程が長め・消費ガッツ-12.5%(射程/gutsCostを各技に直接反映)
  god: [
    { name:'ストレート', tier:1, color:'#f5f0ff', range:900, dmg:24, cooldown:0.85, gutsCost:7, projSpeed:560, hitR:13, splash:70, icon:'👊🏻' },
    { name:'ホーリーサンダー', tier:2, color:'#fff2b0', dmg:26, cooldown:1.15, gutsCost:14,
      aoeShape:'zigzag', range:1600, zigzagWidth:105, aoeStyle:'thunder', icon:'⚡️' },
    { name:'ゴッドライジング', tier:3, color:'#ffffff', dmg:24, cooldown:2.1, gutsCost:21, projSpeed:600,
      range:1200, hitR:30, splash:0, projStyle:'godorb', multiOrb:['#ff4d4d','#4d7cff','#ffe14d','#4dff6a'],
      orbAuras:['red','blue','yellow','green'], orbSpreadDeg:9, icon:'✨' },
  ],
  // ザン(zan): 命中で毒(ワームと同じ特性)。HP普通・移動速め
  zan: [
    { name:'ソニックナイフ', tier:1, color:'#8fa0c8', range:680, dmg:20, cooldown:0.8, gutsCost:8, projSpeed:640, hitR:11, splash:64, icon:'🗡️' },
    { name:'フォルターブリッツ', tier:2, color:'#8fa0c8', range:1250, dmg:11, cooldown:1.05, gutsCost:16, projSpeed:600, hitR:6, burst:3, burstGap:0.1, icon:'🗡️' },
    { name:'ダークホウスト', tier:3, color:'#2a2d40', dmg:21, cooldown:2.0, gutsCost:24, projSpeed:820,
      range:1340, hitR:22, burst:5, burstGap:0.09, projStyle:'crescent', icon:'🌙', seStyle:'darkHoust' },
  ],
  // ピクシー: 特性で移動速度1.2倍・被ダメ1.2倍(高機動・低耐久のグラスキャノン)
  pixie: [
    // gutsDrainRatio: 与えたダメージのこの割合ぶん、相手のガッツも削る(技単位の効果)
    { name:'キッス',     tier:1, color:'#ff4d6d', range:700,  dmg:18, cooldown:0.8,  gutsCost:8,  projSpeed:530, hitR:11, splash:66, gutsDrainRatio:0.5, icon:'💋' },
    // 「ライガー種の超雷撃」と同じエフェクト(zigzag/aoeStyle:thunder)を、幅半分(55)で3連発
    { name:'ライトニング', tier:2, color:'#fff34d', dmg:10, cooldown:1.15, gutsCost:16,
      aoeShape:'zigzag', range:1300, zigzagWidth:55, burst:3, burstGap:0.15, aoeStyle:'thunder', icon:'⚡️' },
    // 黒い球体を発射し、命中/最大射程到達で着弾点に円形ダメージのドームが広がる
    // dmg=球体の直撃ダメージ / blast.dmg=着弾後の爆風ダメージ(両方当たれば合計値)
    { name:'ビッグバン', tier:3, color:'#14121c', dmg:20, cooldown:2.3, gutsCost:24,
      range:1500, projSpeed:640, hitR:28, splash:0, projStyle:'voidOrb', icon:'🔮',
      blast:{ radius:330, dmg:60, color:'#14121c', expandTime:0.5 } },
  ],
  dullahan:[ /*@dullahan*/
    { name:'まっぷたつ', tier:1, color:'#f4f7ff', aoeShape:'rect', range:700, rectWidth:55, dmg:24, cooldown:0.85, gutsCost:8, aoeStyle:'zangetsu', closeBonusMax:1.5, icon:'🗡️' },
    { name:'風神剣', tier:2, color:'#f4f7ff', range:1300, dmg:13, cooldown:1.05, gutsCost:16, projSpeed:760, hitR:18, burst:3, burstGap:0.09, projStyle:'crescentWhite', closeBonusMax:1.5, icon:'🗡️' },
    // selfBlast: 撃った瞬間に自分の足元でドーム状の爆風が広がる。そのあと竜巻と一緒に前進する
    { name:'最終奥義', tier:3, color:'#f4f7ff', range:1300, dmg:64, cooldown:2.1, gutsCost:26, projSpeed:1500, hitR:34, projStyle:'tornadoAura', closeBonusMax:1.5, selfMoveWithProjectile:true,
      selfBlast:{ radius:420, dmg:46, expandTime:0.42 }, icon:'🌪️' }
  ],
  // <<AUTO:SIGNATURE_MOVES>> ここから上へ tools/monster_add.py が新モンスターの行を追記する
};

/* =====================================================================
   オーラ相性
   リング 赤→緑→黄→青→赤(矢印の元が有利): 赤>緑>黄>青>赤 / 白⇔黒(相互有利)
   ・有利技×不利モンスター = ダメージ1.5倍 / 不利技×有利モンスター = 0.75倍
   ・技のオーラ = 使う側モンスターのオーラ = 1.2倍(オーラ一致)
   ・モンスターのオーラは 色スキン=装備色 / SSRスキン=固定色 / 無スキン=下記デフォルト
   ・技のオーラは基本エフェクト色由来。SSR装備時はtier3技を装備オーラの一致技に変える
===================================================================== */
const AURA_BEATS = { red:'green', green:'yellow', yellow:'blue', blue:'red' };
// オーラ相性のダメージ倍率(発注者が調整する係数)。有利技=増加 / 不利技=減少 / 一致=増加
const AURA_ADV_MULT = 1.5;   // 有利技×不利モンスター
const AURA_DIS_MULT = 0.75;  // 不利技×有利モンスター
const AURA_MATCH_MULT = 1.2; // 技オーラ=使用者オーラ(一致)
const AURA_JP = { red:'赤', green:'緑', yellow:'黄', blue:'青', white:'白', black:'黒' };
const AURA_EMOJI = { red:'🔴', green:'🟢', yellow:'🟡', blue:'🔵', white:'⚪', black:'⚫' };
const SSR_SKIN_AURA = {
  phoenix_ssr:'white', tamamo_ssr:'red', iblees_ssr:'black', mocchi_ssr:'black',
  zeus_ssr:'yellow', choco_ssr:'red', persephone_ssr:'blue',
  rock_ssr:       'blue', /*@rock_ssr*/
  aqua_ssr:       'red', /*@aqua_ssr*/
  guts_ssr:       'black', /*@guts_ssr*/
  zod_ssr:        'black', /*@zod_ssr*/
  // <<AUTO:SSR_SKIN_AURA>> ここから上へ tools/studio_web.html が新しいSSRスキンの行を追記する
};
// スキンなし時のモンスターのデフォルトオーラ(体色由来)
const MONSTER_AURA = {
  mocchi:'red', suezo:'yellow', phoenix:'red', fire:'red', aqua:'blue', leaf:'green',
  spark:'blue', rock:'black', ark:'green', warm:'yellow', illumine:'black',
  fox:'white', god:'white', zan:'black', pixie:'red',
  dullahan:'white', /*@dullahan*/
  // <<AUTO:MONSTER_AURA>> ここから上へ tools/monster_add.py が新モンスターの行を追記する
};
// 技のオーラ(技名→オーラ。エフェクト色由来で初期設定)
const MOVE_AURA = {
  'ファイア':'red','ファイアブレス':'red','インフェルノ':'red',
  '水風船':'blue','アクアウェイブ':'blue','クリスタルレイン':'blue',
  '種':'green','種マシンガン':'green','フラワービーム':'green',
  'かみなり':'yellow','雷撃':'yellow','超雷撃':'yellow',
  'ロケットパンチ':'black','掌打':'black','竜巻アタック':'black',
  '火炎砲':'red','火炎連砲':'red','ファイアウェーブ':'red',
  'しっぽふり':'green','熾天の剣':'red','天の慈悲':'blue',
  '毒ガス':'green','毒噴射':'green','シェルアタック':'yellow',
  'ヴェノムエッジ':'black','アサルトアロー':'black','レクイエムエンド':'black',
  '狐火':'white','超狐火':'white','天河天翔':'white',
  'もんた':'red','さくらふぶき':'red','モッチ砲':'red',
  'ツバはき':'yellow','熱視線':'yellow','サイコキネシス':'blue',
  'ストレート':'white','ホーリーサンダー':'yellow','ゴッドライジング':'white',
  'ソニックナイフ':'black','フォルターブリッツ':'yellow','ダークホウスト':'black',
  'キッス':'red','ライトニング':'yellow','ビッグバン':'black',
  'まっぷたつ':'white','風神剣':'white','最終奥義':'white', /*@dullahan*/
  // <<AUTO:MOVE_AURA>> ここから上へ tools/monster_add.py が新モンスターの行を追記する
};
// 技オブジェクトにauraを付与(技名で引く。調整はMOVE_AURAを編集)
Object.keys(SIGNATURE_MOVES).forEach(el=>{ SIGNATURE_MOVES[el].forEach(mv=>{ if(MOVE_AURA[mv.name]) mv.aura = MOVE_AURA[mv.name]; }); });
function auraColorHex(aura){ return (SKIN_COLORS[aura] && SKIN_COLORS[aura].hex) || '#ffffff'; }
// techオーラがtargetオーラに対して 'adv'(有利=1.5倍) / 'dis'(不利=0.75倍) / 'neutral'
function auraAdvantage(tech, target){
  if(!tech || !target) return 'neutral';
  if((tech==='white'&&target==='black')||(tech==='black'&&target==='white')) return 'adv';
  if(AURA_BEATS[tech]===target) return 'adv';
  if(AURA_BEATS[target]===tech) return 'dis';
  return 'neutral';
}
// エンティティの装備スキンID(プレイヤー=装備中スキン / bot・相手=entity.skinId)
function entitySkinId(entity){
  if(!entity) return null;
  if(entity.isPlayer) return (typeof getEquippedSkin==='function') ? getEquippedSkin(entity.element) : null;
  return entity.skinId || null;
}
// モンスターのオーラ(スキン優先: SSR固定色 → 色スキンの色 → デフォルト)
// レイド中のボスのオーラ。素体やスキンのオーラではなく必ずこれになる。
// getMonsterAura から参照するので、レイドの節ではなくここに置いてある(TDZ回避)。
const RAID_BOSS_AURA = 'white';
function getMonsterAura(entity){
  if(!entity) return null;
  // レイドのボスだけは白オーラで固定する(素体のドラゴンやスキンのオーラは使わない)。
  // ここ1か所で返すので、技の色・カード・HUDの発光もまとめて白になる。
  if(entity.isRaidBoss) return RAID_BOSS_AURA;
  const sid = entitySkinId(entity);
  if(sid){
    if(SSR_SKIN_AURA[sid]) return SSR_SKIN_AURA[sid];
    if(sid.indexOf(':')>=0){ const colorId = sid.split(':')[1]; if(SKIN_COLORS[colorId]) return colorId; }
  }
  return MONSTER_AURA[entity.element] || null;
}
// スキンID(SSR / 色スキン)から、tier3技に乗せるオーラを返す(非対象はnull)。
// SSRは固定色、SR(色スキン)はその色。getMonsterAuraと同じ優先順で揃えている。
function skinTier3Aura(skinId){
  if(!skinId) return null;
  if(SSR_SKIN_AURA[skinId]) return SSR_SKIN_AURA[skinId];
  if(skinId.indexOf(':')>=0){ const colorId = skinId.split(':')[1]; if(SKIN_COLORS[colorId]) return colorId; }
  return null;
}
// 技のオーラ(スキン装備時はtier3を装備オーラの一致技に上書き。SSR/SR色スキンどちらも対象)
function getMoveAura(move, attacker){
  if(!move) return null;
  if(move.tier===3){
    const a = skinTier3Aura(entitySkinId(attacker));
    if(a) return a;
  }
  return move.aura || null;
}
// 技のエフェクト色(スキン装備時はtier3を装備オーラの色基調に上書き。SSR/SR色スキンどちらも対象)。
// keepBaseColor が付いた技は本体色を変えない(ちょこの「ヴァニッシュ」= 球体とドームは黒のまま、
// 赤オーラはビリビリ電撃だけに乗せる)。その場合の差し色は getMoveAuraTint が担当する。
function getMoveEffectColor(move, attacker){
  if(move && move.tier===3 && !move.keepBaseColor){
    const a = skinTier3Aura(entitySkinId(attacker));
    if(a) return auraColorHex(a);
  }
  return move ? move.color : '#ffffff';
}
// tier3エフェクトの差し色(ビリビリ電撃等のアクセント)。装備スキンのオーラ色を返す。
// keepBaseColorの有無に関わらず返すので、本体色を黒に保ったまま差し色だけ変えられる。
function getMoveAuraTint(move, attacker){
  if(!move || move.tier!==3) return null;
  // keepArcColor: 本体はオーラ色にしつつ、ビリビリ電撃だけ既定色(紫)のままにする
  // (ペルセポネの「アムピトリテ」= 青い槍と青いドームに紫の電撃)
  if(move.keepArcColor) return null;
  const a = skinTier3Aura(entitySkinId(attacker));
  return a ? auraColorHex(a) : null;
}
// SSRスキン装備時のtier3の専用技名と威力倍率(少し上げる)。元の技の効果(オーラ・エフェクト・
// アーク=イブリースの被ダメ0.5倍など)は変えず、名前と威力だけ上書きする。
// dmgMult = 元の技の威力に掛ける倍率(名前と威力だけを変える従来型)。
// move    = 元の技のフィールドを直接上書きする差分(専用技として性能ごと変えたいとき)。
//           blastは中身をマージするので、変えたいキーだけ書けばよい。
const SSR_SKIN_TIER3 = {
  phoenix_ssr: { name:'天衣無縫',         dmgMult:1.15 },
  iblees_ssr:  { name:'終焉に救いを',     dmgMult:1.15 },
  tamamo_ssr:  { name:'王狐炎衝',         dmgMult:1.15 },
  zeus_ssr:    { name:'ゼウスライジング', dmgMult:1.15 },
  mocchi_ssr:  { name:'ラガモッチ砲',     dmgMult:1.15 },
  // ちょこ(ピクシー): ビッグバンを置き換える専用tier3。倍率ではなく数値を直接指定する。
  // 威力アップ・弾速アップ・射程は少し短く・爆風範囲は大きく・消費ガッツ30。
  // keepBaseColor: 球体とドームは黒のまま(赤オーラはビリビリ電撃だけに乗る)
  choco_ssr:   { name:'ヴァニッシュ', move:{
    dmg:30, projSpeed:860, range:1300, gutsCost:30, keepBaseColor:true,
    blast:{ radius:420, dmg:85 },
  }},
  // ペルセポネ(イルミネ): レクイエムエンドを置き換える専用tier3。
  // 大きい青い槍を3本発射し、着弾地点ごとにドーム状の爆風が広がる(ビッグバンの3個版)。
  // 威力アップ・弾速アップ・射程は少し短く・爆風範囲は大きく・消費ガッツ24。
  // keepArcColor: 槍とドームは青(オーラ色)のまま、ビリビリ電撃だけ既定の紫にする。
  // 威力は「槍の直撃(dmg)+ドームの爆風(blast.dmg)」が3本ぶん入る前提の数値。
  // burstSpread: 3本の発射角を広げて着弾点(=ドーム)がバラけやすくする(既定0.05rad)
  persephone_ssr: { name:'アムピトリテ', move:{
    dmg:22, projSpeed:1150, range:1350, gutsCost:24, hitR:34, burstGap:0.12, burstSpread:0.11,
    shape:null, projStyle:'seaSpear', keepArcColor:true,
    // ドームの色はブルーのオーラ色。SKIN_COLORS はこの定義より後で宣言されるので
    // auraColorHex() を呼ぶとTDZで落ちる。リテラルで持つ(SKIN_COLORS.blue.hex と同値)
    // 面積を半分にするので半径は1/√2(460→325)
    blast:{ radius:325, dmg:26, color:'#3f74e6', expandTime:0.5, se:'amphitriteBlast' },
  }},
  // 轟金剛(ゴーレム): 竜巻アタックを置き換える専用tier3。
  // 青・赤・青の半透明の竜巻を3連射し、それぞれの中で同じ色の「電撃の7」が回る。
  // burstTints は連射の何発目かで色を変えるための一覧(弾の auraTint に入る)。
  // projVariant は描画側が専用の見た目に切り替えるための目印。
  // burstSideStep があると、扇状に散らさず発射位置を横にずらして「横並び」で同時に飛ばす
  rock_ssr:       { name:'超番長ボーナス', move:{ /*@rock_ssr*/
    dmg:40, burst:3, burstGap:0, burstSpread:0, burstSideStep:105,
    cooldown:3.0, projSpeed:560, range:1500, gutsCost:26,
    projStyle:'tornado', projVariant:'bonus7',
    burstTints:['#3f74e6','#e6453f','#3f74e6'],
  }},
  // 大喰いの利世(ウンディーネ): クリスタルレインを置き換える専用tier3。
  // 赤い触手が足元から生えて範囲を進む。lifestealMult はこの技だけHP回復を倍にする。
  aqua_ssr:       { name:'鱗赫', move:{ /*@aqua_ssr*/
    dmg:48, rectWidth:340, aoeStyle:'kagune', lifestealMult:2,
  }},
  guts_ssr:       { name:'ドラゴンころし', dmgMult:1.15 }, /*@guts_ssr*/
  zod_ssr:        { name:'言葉は無粋', dmgMult:1.15 }, /*@zod_ssr*/
  // <<AUTO:SSR_SKIN_TIER3>> ここから上へ tools/studio_web.html が新しいSSRスキンの行を追記する
};
// スキン装備時のtier3を「専用技」に解決する(名前と、moveがあれば数値も上書き)。
// 対象外はそのまま元の技を返す。結果はスキンID+技名でキャッシュし毎フレームの生成を避ける。
// 威力倍率(dmgMult)は従来どおり effectiveMoveDmg 側の ssrTier3DmgMult が掛けるので、ここでは触らない。
const _skinTier3MoveCache = {};
function skinTier3Move(move, attacker){
  if(!move || move.tier!==3) return move;
  const sid = entitySkinId(attacker);
  const def = sid ? SSR_SKIN_TIER3[sid] : null;
  if(!def) return move;
  const ck = `${sid}:${move.name}`;
  if(_skinTier3MoveCache[ck]) return _skinTier3MoveCache[ck];
  const out = Object.assign({}, move);
  if(def.name) out.name = def.name;
  if(def.move){
    for(const k of Object.keys(def.move)){ if(k!=='blast') out[k] = def.move[k]; }
    if(def.move.blast) out.blast = Object.assign({}, move.blast||{}, def.move.blast);
  }
  _skinTier3MoveCache[ck] = out;
  return out;
}
// 技の表示名(SSR装備時はtier3を専用名に上書き)
function getMoveName(move, attacker){
  if(move && move.tier===3){
    const sid = entitySkinId(attacker);
    if(sid && SSR_SKIN_TIER3[sid]) return SSR_SKIN_TIER3[sid].name;
  }
  return move ? move.name : '';
}
// SSR装備時のtier3威力倍率(非装備/非tier3は1)
function ssrTier3DmgMult(move, attacker){
  if(move && move.tier===3){
    const sid = entitySkinId(attacker);
    if(sid && SSR_SKIN_TIER3[sid]) return SSR_SKIN_TIER3[sid].dmgMult || 1;
  }
  return 1;
}

// 更新履歴(プレイに関わる大きな機能の追加・変更・調整のみ。日付降順で表示する)。
// 該当する作業をしたら、このリストの先頭日付にも追記すること(CLAUDE.md参照)。
// トップ画面左下のバナー。3秒ごとに切り替わってループする。増やすときはここに1件足すだけ。
// open は押したときに開く画面('gacha' / 'season' / 'shop')
const LOBBY_BANNERS = [
  // 先頭が起動直後に表示される(lobbyBannerIdx=0 から始まる)
  { rar:'SSR', name:'ペルセポネ',   tag:'新登場・ガチャ', img:'monsters/persephone_ssr.png', size:'150%', pos:'50% 15%', open:'gacha' },
  { rar:'SSR', name:'ラガモッチー', tag:'シーズンパス', img:'monsters/mocchi_ssr.png',  size:'165%', pos:'50% 18%', open:'season' },
  { rar:'SSR', name:'ゼウス',       tag:'ガチャ',       img:'monsters/zeus_banner.png', size:'cover', pos:'50% 42%', open:'gacha' },
  { rar:'SSR', name:'ちょこ',       tag:'ガチャ',       img:'monsters/choco_ssr.png',   size:'150%', pos:'50% 20%', open:'gacha' },
];
const LOBBY_BANNER_MS = 3000;

// 更新履歴のタグ(トップ画面「更新履歴」でタイトル横に並び、選ぶと絞り込める)
const CHANGELOG_TAGS = [
  { id:'general', label:'全般',     color:'#b9c4d4' },
  { id:'feature', label:'新要素',   color:'#f4c430' },
  { id:'monster', label:'モンスター', color:'#7fd4a0' },
  { id:'balance', label:'バランス', color:'#ff9a5a' },
  { id:'solo',    label:'ソロ',     color:'#c98bff' },
  { id:'multi',   label:'マルチ',   color:'#6fa8ff' },
  { id:'fix',     label:'不具合',   color:'#ff6b6b' },
  { id:'av',      label:'演出・音', color:'#ff8fd1' },
];
// 各項目は { t:本文, g:[タグid...] }。タグは複数付けてよい
const UPDATE_HISTORY = [
  { date:'2026-08-07', items:[
    { t:'🎉 シーズン1が開幕しました！ 曜日ごとの変則ルールと、レイドバトル「不死のゾッド」が始まっています', g:['feature','general'] },
    { t:'シーズン1の開幕に合わせて、シーズンポイント(SP)と報酬の受け取り状況を全員リセットしました。ここからみんな同じスタートです。以降もシーズンが切り替わるたびにリセットされます', g:['general','balance'] },
    { t:'【レイド】ボスの体力を大幅に下げました。1回の戦闘は1/10(ソロ24,000・4人63,600)、全体の討伐目標は1/100です。報酬に必要な累計ダメージも下げているので、今までよりずっと早く報酬に届きます', g:['balance'] },
    { t:'シーズンパスの最終報酬(Tier25)が限定SSRスキン「大喰いの利世」に確定しました。報酬はTier順に横スクロールで並び、開くと今のTier付近が表示されます', g:['feature'] },
    { t:'【レイド】レイドランキングに「最大ダメージ」(1回の挑戦で出した最高記録)を追加しました', g:['feature','multi'] },
    { t:'SSRスキンの昇格演出で、動画は流れても音声が鳴らないことがあった不具合を修正しました(音声の読み込みを待ってから動画と同時に鳴らすようにしました)', g:['fix','av'] },
    { t:'【レイド】バトル中のBGMを「残り2人」の曲にしました。専用BGMを持つSSRスキンを装備していれば、そのスキンの曲が流れます', g:['av'] },
    { t:'【レイド】リザルトの報酬にマスモンの経験値とシーズンSPを追加しました。どちらも与えたダメージに応じて増えます', g:['balance'] },
    { t:'ロビーの「シーズン1」から、曜日ごとの変則ルールとレイドバトルの開催期間をカレンダーで確認できるようになりました', g:['feature'] },
    { t:'【レイド】与えたダメージに応じてゴールド・ダイヤ・マスモンの経験値がもらえるようになりました。今までより大幅に増えています', g:['balance'] },
    { t:'【レイド】自己ベストのダメージを更新したら、倒しきれなくても勝利あつかい(ファンファーレとアイコンの演出)になりました', g:['feature','av'] },
    { t:'【レイド】リザルトでやられたのに「時間切れ」と出ていたのを直し、モンスターのアイコンも出るようにしました。ボタンからレイドランキングへ行けます', g:['fix'] },
    { t:'【レイド】闘技場に落ちているアイテムを大幅に増やしました。とくにガッツ飴が多く出るようになり、さらに時間が経つと安全圏の中へ追加で補給されます', g:['balance'] },
    { t:'【レイド】レイドランキングが表示されない不具合を修正しました', g:['fix','multi'] },
    { t:'レイド開催中は、ガチャ画面を開くとレイドガチャから表示されるようになりました', g:['general'] },
    { t:'ドラゴンのtier3「インフェルノ」(不死のゾッド装備時は「言葉は無粋」)の最後に、爆風ドームが3つ横並びで発生するようになりました。技が途中で遮られた場合もその位置で爆発します', g:['monster','balance'] },
    { t:'SSRスキン「不死のゾッド」に専用BGM(狂戦士ガッツと同じ曲)とtier3技の専用SEを追加しました', g:['monster','av'] },
    { t:'専用の昇格演出を持つSSRスキンは、共通の昇格演出が流れてから専用ムービーへ切り替わるようになりました', g:['av'] },
  ]},
  { date:'2026-08-06', items:[
    { t:'🎉 シーズン1がいよいよ8/7に開幕します！ 曜日ごとの変則ルール(日替わりミューテーター)が始まり、月・木は全員が技tier2スタート、火・金は試合報酬2倍、水はスポーンアイテム1.5倍。土日はその全部が同時に発動します', g:['feature','general'] },
    { t:'🐉 8/7の開幕と同時に、レイドバトル「不死のゾッド」が全プレイヤーに開放されます。期間は1週間、最大4人で挑めます', g:['feature','multi'] },
    { t:'8/7からレイドガチャが引けるようになります。100連で「レイドSSRスキンカタログ」を1回だけ付与し、好きなSSR/SRスキンを1つ選べます(レイド特効の「狂戦士ガッツ」もこの中から選べます)', g:['feature'] },
    { t:'「狂戦士ガッツ」はレイドガチャ限定になりました。通常のスキンガチャとSSRスキンカタログには出ません', g:['balance'] },
    { t:'「不死のゾッド」はレイド討伐達成の報酬限定です。どのガチャ・どのカタログからも出ません', g:['balance'] },
    { t:'【レイド】レイド報酬に新アイテム「生命の果実」(ライフの基礎値+5)と「加速剤」(移動速度の基礎値+5)を追加しました。基礎値には上限が無く、育成の倍率が乗る前に足されるので、育てたマスモンほど1個の効きが大きくなります', g:['feature','balance'] },
    { t:'【レイド】これまでレイド報酬だったステータスの実を、生命の果実×1・加速剤×1に変更しました', g:['balance'] },
    { t:'バトル中に突然エラーが出て操作できなくなる/モンスターもアイテムも何も映らなくなる不具合を修正しました(「我慢」などの状態変化が出ているモンスターを描くところで落ちていました)', g:['fix'] },
    { t:'描画のどこかで問題が起きても、その1個だけを飛ばして残りは描き続けるようにしました(画面が丸ごと真っさらになるのを防ぎます)', g:['fix'] },
    { t:'【レイド】レイドバトルを選んだあとロビーのプレイモードが「みんなで対戦」と表示されていた不具合を修正しました', g:['fix'] },
    { t:'【レイド】モンスターを選ばずにレイドバトルを開こうとすると何も起きなかったのを、メッセージを出してロビーに戻すようにしました', g:['fix'] },
    { t:'【レイド】レイドのあとに通常の試合を始めるとレイドの処理が残ってしまい、内部エラーで続行不能になることがあった不具合を修正しました', g:['fix'] },
    { t:'デュラハンに状態変化「我慢」を追加しました(HP30%以下で30秒間、被ダメ半減・ガッツ回復2倍・技のクールタイム半分。120秒に1回発動)', g:['monster','balance'] },
    { t:'狂戦士ガッツtier3「ドラゴンころし」の発動SEを専用の音に変更しました', g:['monster'] },
    { t:'【レイド】プレイモードに「レイドバトル」を追加しました。専用画面からボスの残り体力・自分の累計ダメージ・レイドランキング(総ダメージ／参加回数)が見られます', g:['feature'] },
    { t:'【レイド】最大4人で同時に挑めるようになりました(ロビーのレイド→「みんなで挑む」)。空いた枠はマスモン・botが埋めます', g:['feature','multi'] },
    { t:'【レイド】ボスの攻撃の威力と範囲を大幅に強化しました。予告は今までどおり出るので、見てから逃げてください', g:['balance'] },
    { t:'【レイド】レイド中のボスは白オーラになりました', g:['av'] },
    { t:'デュラハンとSSR「狂戦士ガッツ」のtier3「最終奥義」を変更: 発動と同時に自分の周囲へドーム状の爆風が広がり、そのあと竜巻と一緒に前進するようになりました', g:['monster','balance'] },
    { t:'【レイド】レイドボスが「不死のゾッド」になりました。体がさらに大きくなり、少しずつ歩いて間合いを詰めてきます', g:['feature','balance'] },
    { t:'【レイド】闘技場に通常マップと同じアイテムが出るようになりました(火山と反対側にまとまって出ます。ボスは拾いません)。あわせて味方のガッツ回復速度が2倍になりました', g:['feature','balance'] },
    { t:'【レイド】週替わりレイドバトルが登場します！ 巨大な竜に挑み、与えたダメージを全プレイヤーで累計します。累計の到達で全員が報酬をもらえ、自分の累計でも報酬が増えます(シーズン1開始と同時に開幕・1週間)', g:['feature'] },
    { t:'【レイド】ボスは技を撃つ前に必ず予告が出ます。時間が経つほど攻撃が激しくなり、安全圏も狭くなります。味方の攻撃は当たらず、技は最初から全解放です', g:['feature'] },
    { t:'【レイド】レイドガチャを追加しました(ガチャ画面のタブで切り替え)。レイド特効スキンがピックアップで、100回引くとレイド特効スキンを含むSSRスキンカタログがもらえます。シーズン1開始まで近日公開です', g:['feature'] },
    { t:'【転生】レベル100のマスモンを「転生」させられるようになりました。レベル1に戻る代わりに、ステータス上限が1099へ、HPと移動速度の基礎値が上がり、トレーニングチケットを10枚もらえます。ステータスは転生前の1/3から再スタートです', g:['feature'] },
    { t:'【転生】転生のとき、好きな適正を3つ選んで1段階ずつ上げられます。適正はAの上に「S」が加わり、Sはトレーニングでの上がり幅が最大なうえ、同じステータス値でも倍率の伸びが良くなります', g:['feature','balance'] },
    { t:'【転生】転生した回数はマスモンのカードに虹色の星で表示されます', g:['feature'] },
    { t:'バトルの決着時、リザルト画面の前に3秒の演出が入るようになりました(勝つと使っていたモンスターが飛び跳ね、負けると横に倒れます)', g:['av'] },
    { t:'自分のライフゲージをモンスターの頭のすぐ上まで下げ、半透明にしました(視界の邪魔になりにくくなります)', g:['general','av'] },
    { t:'マルチプレイの観戦中に「次のプレイヤー」ボタンをタップしても反応しなかった不具合を修正しました', g:['multi','fix'] },
  ]},
  { date:'2026-08-05', items:[
    { t:'大喰いの利世の勝利SEを専用ボイスに、キルSEを新しい専用音に変更しました', g:['monster'] },
    { t:'デュラハンのテーマカラーを緑から白に変更しました', g:['balance','monster'] },
    { t:'デュラハン最終奥義の移動が、竜巻が敵や地面・障害物に当たって消えた場所でぴったり止まるようになりました(以前は射程いっぱいまで進んでいました)', g:['fix','monster'] },
    { t:'デュラハンの技をさらに調整: tier1・tier3のエフェクトを白に統一、tier1はより細く高さ2倍、tier3は竜巻の根元を太くし、発動と同時に自分も竜巻と同じ速度で前進する移動技になりました', g:['monster','balance','av'] },
    { t:'SSRスキン「大喰いの利世」を獲得したとき、轟金剛と同様の専用昇格演出(動画+音声)が流れるようになりました。また装備して試合に出ると、残り人数に応じて専用BGMが3段階で切り替わります', g:['feature','monster'] },
    { t:'デュラハンの技を刷新しました。tier1「まっぷたつ」は細い範囲を斬撃が進む範囲技に、tier2は「風神剣」(白い斬撃を3連射)に、tier3「最終奥義」はオーラ色の竜巻を纏って突進する高威力・高速・やや短射程の技になりました。全技に共通で、命中距離が近いほど威力が上がる効果を追加しています', g:['monster','balance'] },
    { t:'新モンスター「デュラハン」が登場しました！', g:['feature','monster'] },
    { t:'デュラハンの色スキンから「白」を廃止し、「緑」を追加しました', g:['balance','monster'] },
  ]},
  { date:'2026-08-04', items:[
    { t:'轟金剛tier3「超番長ボーナス」・ゴーレムtier3「竜巻アタック」の3本の竜巻について、根元の当たり判定が薄く抜けやすかった不具合を調整しました(竜巻アタックも超番長ボーナスと同じ3本構成になりました。合計威力は変更していません)', g:['balance'] },
    { t:'スキンガチャで轟金剛(SSR)ピックアップを実施中！ SSR排出率2%のうち轟金剛1%・他SSR合算1%(ノーマルは58%に調整)', g:['balance','general'] },
    { t:'SSR轟金剛の実装を記念して、ログインすると特別ポップアップとダイヤ500個をプレゼントします(お一人様1回)', g:['general'] },
    { t:'スキンカタログ・シーズンパス報酬から轟金剛(SSR)を初獲得したとき、専用の昇格演出が発生しない不具合を修正しました', g:['fix','av'] },
    { t:'轟金剛を獲得したときの専用BGM(bgm_gokongo_lastbattle.mp3)が読み込み未完了で無音になっていた不具合を修正しました', g:['fix','av'] },
    { t:'SSR獲得時の昇格演出(轟金剛専用のものを含む)で動画と音声が流れない不具合を修正しました', g:['fix','av'] },
  ]},
  { date:'2026-08-03', items:[
    { t:'SSRスキン「轟金剛」がガチャ・スキンカタログに登場するようになりました。獲得時には専用の昇格演出とBGMが流れます', g:['feature','monster'] },
    { t:'SSR昇格演出が一瞬で終わってしまう・音が鳴らない不具合を修正しました', g:['fix','av'] },
    { t:'ガチャ・カタログ・シーズンパスでSSRを獲得したとき、「SRだと思ったら実はSSRだった」という昇格演出が入るようになりました(初獲得は100%、重複獲得は5割の確率)', g:['feature','general'] },
  ]},
  { date:'2026-07-31', items:[
    { t:'ヘルプにホーム画面への追加方法を追加しました。ロビー右上の「はじめての方へ」からもヘルプ画面をすぐに開けます', g:['general','feature'] },
  ]},
  { date:'2026-07-30', items:[
    { t:'試合中の動作を大きく軽くしました。特に人数が多い試合開始直後のカクつきを解消しています。端末が重いときだけ自動で描画を軽くし、余裕があれば元の見た目に戻ります', g:['general'] },
    { t:'ゲームの動作を軽くしました。歩行モーションの画像を必要になってから読み込むようにし、画像と音を端末に貯めて起動を速くし、リアルマップの地形の計算量を大幅に減らしています。見た目は変わりません', g:['general'] },
    { t:'リアルマップの範囲技を立体的なエフェクトにしました。インフェルノやファイアウェーブは炎が立ち上がり、超雷撃は空から雷が落ち、クリスタルレインは結晶が降って地面から突き出し、サイコキネシスは弧を描く壁が押し寄せます。高さはモンスターの背丈ぶんに抑え、半透明にして周りが見えるようにしています', g:['general','av'] },
    { t:'リアルマップのビーム技(モッチ砲・ラガモッチ砲・天河天翔・熱視線・フラワービーム)を、当たり判定の幅そのままの太さの光の筒にしました。真後ろから見ると円形になります', g:['general','av'] },
    { t:'リアルマップの爆風ドーム(ビッグバン・ヴァニッシュ・レクイエムエンドなど)を、透けすぎないよう濃い塊に描き直しました', g:['general','av'] },
    { t:'立体的な技エフェクトを通常マップにも反映しました。炎・雷・ビーム・爆風などの演出と、絵文字ではない専用の弾が全マップで出るようになります', g:['general','av'] },
    { t:'前に進みながら範囲技を撃つと、技のエフェクトが途中で消えてしまう不具合を修正しました', g:['fix','general'] },
    { t:'リアルマップのtier3専用の弾も立体的に描き直しました。竜巻は地面に立つ本物の渦になり、ビッグバンは光を吸い込む黒い球、ゴッドライジングは赤道に環をまとった光球になります', g:['general','av'] },
    { t:'リアルマップで絵文字だった弾を、技に合わせた見た目に描き直しました。火の玉・水の玉・種・稲妻・ロケットパンチ・掌打・短剣・光の矢・毒ガス・花びら・ハートがそれぞれの形で飛びます', g:['general','av'] },
    { t:'リアルマップの岩や木などの障害物を立体にしました。地面のくぼみに埋まって影を落とすようになり、モンスターや技との前後の重なり方は今までどおりです', g:['general','av'] },
    { t:'リアルマップごとに合った障害物を置くようにしました。荒野は枯れ木、火山は黒い岩柱、雪山は雪をかぶった針葉樹、ジャングルは大木と倒木、海岸はヤシと貝殻、砂漠はサボテンが生えます', g:['general','av'] },
    { t:'ロビー上部に❓ヘルプボタンを追加しました。アカウント作成・バトルの始め方・マスモン登録・育成・スキン着せ替えの手順を、いつでも画像で確認できます', g:['feature','general'] },
    { t:'リアルマップの海と川を、円をつなげた形ではなく1枚のつながった水面にしました。川は海へ向かって流れ、海は海岸に向かって波が寄せて白く泡立ちます', g:['general','av'] },
    { t:'リアルマップの火山に火口を作り、山の形と色で火山・雪山・森を表現するようにしました。山頂に浮いて見えていた丸い光は廃止しました', g:['general','av'] },
    { t:'リアルマップの溶岩を、冷えた黒い地殻の割れ目が赤く光る見た目にしました。水面にもさざ波が入ります', g:['general','av'] },
    { t:'リアルマップで、遠くの岩や建物が山の手前に重なって見えないよう、一定より遠い障害物は表示しないようにしました', g:['general','av'] },
    { t:'リアルマップの火山・雪山・森・ピラミッドと、溶岩・海・川・オアシスを立体的に描くようにしました。地面の起伏に沿うので、丘の斜面にある溶岩や水辺も自然に見えます', g:['general','av'] },
    { t:'リアルマップの背景の山並みに出ていた切れ目(縦の段差)を直しました', g:['fix','av'] },
  ]},
  { date:'2026-07-29', items:[
    { t:'リアルマップの地面の描き方を作り直しました。光の当たり方が自然になり、砂利や岩肌の質感がはっきり出ます。岩は太陽の向きに合わせた影を地面に落とします', g:['general','av'] },
    { t:'ランキングのキル数・ダメージ数を、通常マップとリアルマップで別々に集計するようにしました。ランキング画面で切り替えて見られます', g:['general','balance'] },
  ]},
  { date:'2026-07-28', items:[
    { t:'6つのマップすべてに「リアルマップ」を用意しました。マップ選択画面のスイッチで通常/リアルを切り替えられます。地面に丘と谷があり、技は視線の向きへ飛びます', g:['feature','general'] },
    { t:'リアルマップは上級者向けとして、獲得できるゴールドとダイヤが2倍になります', g:['general','balance'] },
    { t:'ロビーに「射撃訓練場へ」を追加しました。狭いリアルマップで、技を全部使える状態・安置なし・アイテム取り放題・左右に動く的を相手に、自由に撃ち込んで練習できます', g:['feature','general','solo'] },
    { t:'視点の上下感度を少し下げました。射撃訓練場の「視点設定」から視野角・左右感度・上下感度を自分に合わせて変えられます(バトルにも反映されます)', g:['general'] },
    { t:'リアルマップ(テスト)で、遠くにあるはずの安全圏の線と予測線が目の前を横切って見えてしまう不具合を修正しました', g:['fix','general'] },
    { t:'リアルマップ(テスト)の技の落ち方を弱めました。平らな場所で水平に撃つと、本来の射程距離まで届いてから着地します', g:['balance','general'] },
    { t:'リアルマップ(テスト)で、技の弾が重力で落ちるようになりました。遠くをねらうほど山なりに飛びます', g:['balance','general'] },
    { t:'リアルマップ(テスト)の遠くの山並みを、雪をかぶった重なりのある景色に描き直しました', g:['general','av'] },
    { t:'リアルマップ(テスト)で、技が画面中央の照準の向いている方向へまっすぐ飛ぶようになりました。丘に当たればそこで止まり、丘の上の相手もねらえます', g:['general','balance'] },
    { t:'リアルマップ(テスト)だけ、視点を今までより大きく上に向けられるようにしました(遠くをねらいやすくなります)', g:['general'] },
    { t:'リアルマップ(テスト)の地面と岩の質感を、より本物らしい見た目にしました', g:['general','av'] },
  ]},
  { date:'2026-07-27', items:[
    { t:'リアルマップ(テスト)を改善しました。円盤石・アイテム・岩・技の範囲が地面の起伏に沿うようになり、地面の質感も細かくなりました', g:['general','av'] },
    { t:'マップ選択に「リアルマップ(テスト)」を追加しました。地形が立体的な丘や谷になり、当たり判定も起伏に沿います(テスト中のため、ランダム選択では選ばれません)', g:['feature','general'] },
    { t:'ランキングで同じスコアのプレイヤーが同じ順位になるようにしました。マスモン名が長いときも「…」で切らず全部表示します', g:['general','fix'] },
    { t:'縦持ちで起動したときに強制横向きが効かないことがある不具合を修正しました', g:['general','fix'] },
    { t:'端末によってSSR獲得演出などの画面が上下左右に見切れてしまう不具合を修正しました', g:['fix','av'] },
    { t:'名前などの文字入力を、キーボードに隠れない位置に出るポップアップで行うようにしました(マスモンの名前・表示名・アカウントのすべてが対象)', g:['general','fix'] },
    { t:'マスモンの名前を変更するとき、キーボードで入力欄が隠れないようになりました(他の入力欄も同様)', g:['general','fix'] },
    { t:'マスモンの名前を変更すると、左のカードの名前もすぐ変わるようになりました', g:['general','fix'] },
    { t:'バッグでアイテムを切り替えても、選んでいたマスモンが外れないようにしました', g:['general','fix'] },
    { t:'ステータスを上げるアイテムの表示が上限999を考慮するようになり、上限を超える個数は選べなくなりました(上限に達しているマスモンには使えません)', g:['general','fix'] },
    { t:'イルミネ「レクイエムエンド」にも、3発それぞれの着弾点でドーム状の爆風が広がる効果を追加しました(専用の爆発音つき)', g:['monster','balance','av'] },
    { t:'イルミネのtier1「ヴェノムエッジ」とtier2「アサルトアロー」に専用の効果音を追加しました(tier2は同じ音の3連射)', g:['monster','av'] },
    { t:'アムピトリテの槍が進行方向を向くようになり、3連射の発射角が広がって着弾点がバラけやすくなりました。爆風ドームの面積は半分に調整しました', g:['monster','balance','av'] },
    { t:'ペルセポネがスキンカタログ・バッグのスキン欄・着せ替え画面・装備時の見た目に反映されない不具合を修正しました', g:['fix','monster'] },
    { t:'ペルセポネに歩行モーションを追加しました。バトル中もロビーも、正面・後ろ姿ともに歩くようになります', g:['monster','av'] },
    { t:'イルミネのSSRスキン「ペルセポネ」を追加しました。スキンガチャとSSRカタログから入手でき、オーラは青になります', g:['feature','monster'] },
    { t:'ペルセポネ装備時のtier3が専用技「アムピトリテ」に変わります。大きな青い槍を3本発射し、着弾地点ごとにドーム状の爆風が広がります(威力アップ・弾速アップ・射程は少し短く・爆風範囲は大きく・消費ガッツ24)', g:['monster','balance','av'] },
    { t:'マルチプレイのマッチング画面と部屋一覧を画面右側のパネルにしました。相手を待っている間も、選んだモンスターがロビーに見えたままになります', g:['multi','general'] },
    { t:'ホストが倒された後の観戦で「次のプレイヤー」ボタンが反応しない不具合を修正しました', g:['multi','fix'] },
    { t:'移動速度が速いモンスターほど位置のズレが大きくなる性質に合わせて、マルチプレイの位置補正を移動速度に応じた幅にしました。飛び飛びに見える動きが出にくくなります', g:['multi','fix'] },
    { t:'マルチプレイでは移動速度と弾速がわずかに下がるようになりました(通信のズレを抑えるため。ソロは変わりません)', g:['multi','balance'] },
    { t:'リザルトからマスモンのトレーニング画面へ入ると、トレーニングBGMとバトルBGMが同時に鳴ってしまう不具合を修正しました', g:['fix','av'] },
    { t:'ロビーのBGMを新しい曲に変更しました。画面右上の🎵ボタンで、これまでのBGMと切り替えられます(選んだ曲は次回も引き継がれます)', g:['general','av'] },
    { t:'ロビーのBGMは、他の画面へ移って戻ってきたときに続きから流れるようになりました', g:['general','av'] },
    { t:'マスモンのトレーニング画面に専用BGMを追加しました', g:['general','av'] },
    { t:'ボタンのタップ音とショップの購入音を新しい効果音に変更しました', g:['general','av'] },
    { t:'技の効果音を専用のものに差し替えました(ザン「ダークホウスト」/イルミネ「レクイエムエンド」/モッチー「モッチ砲・ラガモッチ砲」「もんた」/ウンディーネ「クリスタルレイン」/ヒノトリ「ファイアウェーブ」)', g:['monster','av'] },
    { t:'「ランキング」をマイページからトップ画面左のメニュー(バッグの下)に移し、1タップで開けるようにしました', g:['general'] },
    { t:'トップ画面の「モンスター選択」ボタンをなくし、画面中央のモンスター(未選択のときは「モンスターを選択してください」)を直接タップして選べるようにしました', g:['general'] },
    { t:'タイトル画面の「TAP START」に専用の効果音が付きました。タイトルロゴの見た目も整え、トップ画面のタイトルにも同じロゴを使うようにしました', g:['general','av'] },
    { t:'タイトル画面を追加しました。起動するとタイトルロゴが左下からスライドインして光沢が走り、読み込みが終わると「TAP START」が点滅します。タップするとトップ画面に入ります', g:['general','feature','av'] },
    { t:'トップ画面を刷新しました。荒野の背景の上に、左=シーズン/デイリー/ガチャ/ショップ/バッグ、中央=選択中のモンスター、右=マップ/プレイモード/バトル開始という並びになり、スクロールなしで1画面に収まります', g:['general','feature'] },
    { t:'トップ画面の中央に、選んだモンスター(マスモンなら着せ替え済みの姿)の歩くアニメーションが表示されるようになりました', g:['general','av'] },
    { t:'遊び方説明・画面カスタマイズ・音量設定をヘッダーの⚙️「設定」にまとめ、マイ記録・ランキング・ログインを👤「マイページ」にまとめました', g:['general'] },
    { t:'トップ画面の左下にSSRスキンのバナーを置き、3秒ごとに切り替わるようにしました(タップでガチャ/シーズンへ移動できます)', g:['general','av'] },
    { t:'更新履歴にタグを付けました。タイトル横のタグを選ぶと、そのタグが付いた更新だけを表示できます', g:['general','feature'] },
    { t:'マスモンの着せ替えをすると、カードの見た目とオーラの色もすぐに変わるようになりました', g:['fix'] },
  ]},
  { date:'2026-07-26', items:[
    { t:'マスモンの選択画面も刷新しました。モンスター一覧と同じようにカードを左右にスワイプして選べるようになり、カードをタップすると詳細情報・技一覧・トレーニング・着せ替え・編集をその場で切り替えられます', g:['general','feature'] },
    { t:'カードの詳細画面で、カードの絵の両サイドにある「≪ ≫」ボタンから隣のモンスター/マスモンへ直接移動できるようにしました', g:['general'] },
    { t:'モンスター一覧の画面を刷新しました。カードを左右にスワイプして選べるようになり、中央のカードが大きく表示されます(端まで行くと最初に戻るのでぐるぐる回せます)。カードをタップすると、そのモンスターのステータス・技・状態変化をまとめて確認して、その場で「このモンスターで参戦」できます', g:['general','feature'] },
    { t:'マルチプレイでもマスモンの育成ステータスが反映されるようになりました(ホスト・ゲストのどちらで参加しても、自分と相手の全員に育成した強さが乗ります)', g:['multi','balance'] },
    { t:'マスモンの撃破ボーナス(経験値)が、マスモンbotだけでなく相手プレイヤーのマスモンを倒したときにも入るようになりました。ホスト・ゲストのどちらでも受け取れます', g:['multi','balance'] },
    { t:'マルチプレイのゲスト側で安全圏の縮小までの残り時間が進まなかったのを修正(縮小に備えられるようになりました)', g:['multi','fix'] },
    { t:'マルチプレイのゲスト側で状態変化(暴走・我慢など)の発動が分からなかったのを修正。やけど・どくの表示も出るようになりました', g:['multi','fix'] },
    { t:'マルチプレイのゲスト側で連射する範囲技が1発しか出ていなかったのと、自分で撃ったビッグバン/ヴァニッシュの爆風が見えなかったのを修正', g:['multi','fix'] },
    { t:'マルチプレイのゲスト側で安全圏外・溶岩のダメージ表示が出なかったのを修正(HPが減る理由が分かるようになりました)', g:['multi','fix'] },
    { t:'マルチプレイで凍結中に攻撃できるかどうかがホストとゲストで違っていたのを統一(凍結中は攻撃できません)', g:['multi','fix'] },
    { t:'バランス調整: ヒノトリのHPを130・移動速度を200に / ザンのHPを95・移動速度を215に / ドラゴンのHPを125に', g:['balance','monster'] },
    { t:'ピクシーの特性から「被ダメージ1.2倍」を削除(移動速度1.2倍はそのまま)。tier1「キッス」に、与えたダメージの50%ぶん相手のガッツも削る効果を追加', g:['balance','monster'] },
    { t:'オリジナルBGM(決戦・ラストバトル・ショップ)の音量を決戦BGM基準にそろえ、曲の切り替わりで一瞬音が大きくなるのを修正', g:['av','fix'] },
    { t:'マルチプレイのゲスト側でアイテムの効果メッセージが出ないのを修正', g:['multi','fix'] },
    { t:'マルチプレイのゲスト側でダッシュしても元の位置に戻されるのを修正', g:['multi','fix'] },
    { t:'マルチプレイで試合中に不具合が起きても画面が固まったままにならず、次の試合を普通に始められるように改善', g:['multi','fix'] },
    { t:'マルチプレイのゲスト側の不具合を修正: キルフィードが流れない／キルボーナス(HP・ガッツ・経験値)が入らない／拾ったアイテムが消えず効果も遅れて出る', g:['multi','fix'] },
    { t:'マルチプレイのゲスト側の操作感を改善: ラグで自分のモンスターが後ろに引っ張り戻される動きを解消し、川など足が遅くなる場所で動けなくなる問題も修正', g:['multi','fix'] },
    { t:'マルチプレイで移動の速い相手が瞬間移動して見える問題を修正(滑らかに動くようになりました)', g:['multi','fix'] },
    { t:'マルチプレイの観戦画面で「次のプレイヤー」を押しても視点が変わらないことがある問題を修正(生き残っているモンスターを順番に見られます)', g:['multi','fix'] },
    { t:'ピクシーのSSRスキン「ちょこ」を追加(ガチャ・SSRカタログから入手可能)。赤オーラで、バトル歩行アニメーションにも対応', g:['feature','monster'] },
    { t:'「ちょこ」装備中はtier3が専用技「ヴァニッシュ」に変化: 威力アップ・弾速アップ・射程は少し短く・爆風の範囲は大きく・消費ガッツ30。球体と爆風は黒のまま、ビリビリの電撃だけが赤くなります', g:['monster','balance'] },
    { t:'「ちょこ」装備中は召喚演出・ヴァニッシュ・被弾がそれぞれ専用の音になります', g:['av'] },
    { t:'色スキン(SR)を装備すると、SSRスキンと同じようにtier3技のオーラとエフェクトがスキンの色に変わるようになりました(技名と威力は変わりません)', g:['monster','balance'] },
    { t:'スキンのプレビュー画面で、正面と後ろの歩行モーションが動いて見えるようになりました', g:['general','av'] },
    { t:'残り2人になったときの専用BGM「ラストバトル」を追加', g:['av'] },
    { t:'ショップに専用BGMを追加', g:['av'] },
    { t:'バトルの視点を自分のモンスターに寄せて、モンスターが大きく見えるように変更', g:['general','av'] },
    { t:'ショップの値段を変更(〇〇の実 300 / トレーニングチケット 1000 / 技強化チケット 1000)', g:['balance'] },
    { t:'シーズンパスのゴールド報酬を100から1000まで100単位で上がるように変更', g:['balance'] },
    { t:'デイリー報酬のゴールドを100単位に変更', g:['balance'] },
    { t:'更新履歴に未読の項目があるとき、ボタンに「new」が付くようになりました', g:['general'] },
  ]},
  { date:'2026-07-25', items:[
    { t:'ピクシー「ビッグバン」を強化: 発射した球体の直撃と着弾後の爆風の両方でダメージが入るように変更、爆風の範囲と威力をアップ。技一覧の威力が0と表示されていたのを修正(直撃+爆風の合計を表示)。ダメージ範囲の円が宙に浮いて見えていたのを、地面に正しく貼り付くよう描画方式を修正', g:['monster','balance','fix'] },
    { t:'ピクシーのマスモン適正を調整(EDABBE)。ビッグバンの爆風エフェクトが大きな障害物の裏に隠れず正しい前後関係で表示されるよう修正、ダメージ判定円にエフェクトの見た目を正確に一致させ、発射時と同じ黒いビリビリ電撃も追加', g:['monster','balance','fix'] },
    { t:'ザンの全技の威力・射程を少し下方修正', g:['monster','balance'] },
    { t:'ピクシーのtier3「ビッグバン」を調整: 発射する球体を少し大きく、着弾時のエフェクトを地面に接地した半球型の黒い爆風に変更、発射音/着弾音を専用SEに変更', g:['monster','av'] },
    { t:'新モンスター「ピクシー」を追加(専用技「キッス」「ライトニング」「ビッグバン」・バトル歩行アニメーション・色スキン対応)。移動速度1.2倍・被ダメ1.2倍の高機動グラスキャノン', g:['feature','monster'] },
    { t:'イルミネ・ワームにもバトル中の歩行アニメーションを追加（色スキンにも対応）。これで全モンスターが歩行アニメーションに対応', g:['av','monster'] },
    { t:'技を出している間は、移動していてもその技を打った方向を向くように調整(自分の技発生中は後ろ姿になる)', g:['general'] },
    { t:'アーク・ウンディーネ・ドラゴン・プラント・ゴーレムとSSRスキン「イブリース」にもバトル中の歩行アニメーションを追加', g:['av','monster'] },
    { t:'SSRスキン「ゼウス」「タマモノマエ」にもバトル中の歩行アニメーションを追加', g:['av','monster'] },
  ]},
  { date:'2026-07-24', items:[
    { t:'ヒノトリとSSRフェニックスにもバトル中の歩行アニメーションを追加（色スキンにも対応）', g:['av','monster'] },
    { t:'ガリ・スエゾー・ザン・キュービ・ライガーにもバトル中の歩行アニメーションを追加（色スキンにも対応）', g:['av','monster'] },
    { t:'モッチーにバトル中の歩行アニメーションを追加（進行方向でスプライトが前向き／後ろ向きに切り替わり、停止中は静止。色スキン・ラガモッチーSSRスキンにも対応）', g:['av','monster'] },
    { t:'SSRスキン装備でtier3技の名前と威力が変化（天衣無縫／終焉に救いを／王狐炎衝／ゼウスライジング／ラガモッチ砲）', g:['monster','balance'] },
    { t:'技フィールドを左右フリックでも切り替え可能に（タップでの切替も継続）', g:['general'] },
    { t:'更新履歴画面を追加', g:['general','feature'] },
    { t:'敵AIを強化（ガッツ切れ時にガッツ飴を探す・障害物で詰まったら迂回・プレイヤーのマスモンレベルに応じた強さ）', g:['solo','balance'] },
    { t:'マルチプレイに観戦機能を追加（撃破後も生き残りプレイヤーを観戦）', g:['multi','feature'] },
    { t:'ガリのSSRスキン「ゼウス」を追加（tier3専用エフェクト＆SE）', g:['feature','monster'] },
    { t:'ショップに店主「ラガゼウスモチ」を追加（購入でセリフが変化）', g:['general','av'] },
    { t:'全画像を軽量化し、読み込みを高速化', g:['general'] },
  ]},
  { date:'2026-07-23', items:[
    { t:'オーラ相性システムを導入（相性でダメージが増減・オーラ一致でボーナス）', g:['feature','balance'] },
    { t:'オートラン機能を追加（ジョイスティックを上に2回はじくと視点方向へ前進し続ける）', g:['general','feature'] },
    { t:'バトル操作画面のカスタマイズ機能を追加（各パーツの配置・サイズを変更して記憶）', g:['general','feature'] },
    { t:'マルチプレイのプレイ感を改善（位置補間・ラグ補正で相手の動きを滑らかに）', g:['multi'] },
    { t:'モッチーのSSRスキン「ラガモッチー」を追加（シーズンパス限定）', g:['feature','monster'] },
  ]},
  { date:'2026-07-22', items:[
    { t:'称号システムを追加（実績で解放し、最大3つ装着）', g:['feature'] },
    { t:'デイリー機能を追加（ログインボーナス＋毎日のミッション）', g:['feature'] },
    { t:'シーズンパスを追加（試合でSPを貯めて25段階の報酬を獲得）', g:['feature'] },
    { t:'新モンスター「ガリ」「ザン」を追加', g:['feature','monster'] },
    { t:'SSRスキン「タマモノマエ」「イブリース」を追加', g:['feature','monster'] },
    { t:'SSR獲得演出を追加', g:['av'] },
  ]},
  { date:'2026-07-21', items:[
    { t:'モンスター着せ替え（スキン）機能とスキンガチャを追加', g:['feature'] },
    { t:'試合開始の召喚演出を追加', g:['av'] },
    { t:'マルチプレイのスキン反映・障害物同期を改善', g:['multi','fix'] },
  ]},
];

const TICKET_ITEM = { name:'修行チケット', color:'#9fd1ff', accent:'#ffffff' };
const GUTS_ITEM = { name:'ガッツ飴', restore:32, maxBoost:15, color:'#ff7a96', accent:'#ffd9e3' };
/* 落ちているアイテムの内訳(0〜1の累積しきい値。残りがトレーニング)。
   レイドは技を撃ち続ける戦いなのでガッツ飴を厚くする。
   通常マップとレイドの違いはこの表だけで、撒く処理そのものは共通(pickLootFrom)。 */
const LOOT_MIX_NORMAL = { heal:0.35, ticket:0.62, guts:0.92 };
const LOOT_MIX_RAID   = { heal:0.24, ticket:0.32, guts:0.95 };
function lootMix(){ return (typeof game!=='undefined' && game && game.raid) ? LOOT_MIX_RAID : LOOT_MIX_NORMAL; }

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
  god: {
    name:'憤怒', duration:30, cooldown:120, trigger:'hpBelow', triggerValue:0.5,
    effects:{ dmgMult:1.2, gutsRegenMult:2, cooldownMult:1/1.5, speedMult:1.5 },
  },
  zan: {
    name:'逆上', duration:20, cooldown:60, trigger:'onHitTakenChance', triggerValue:0.2,
    effects:{ gutsRegenMult:2, speedMult:1.5 },
  },
  // ピクシー: HPが減ると悪戯心が加速し、さらに素早く技を連発する
  pixie: {
    name:'暴走', duration:20, cooldown:90, trigger:'hpBelow', triggerValue:0.4,
    effects:{ speedMult:1.5, cooldownMult:1/1.5, dmgMult:1.15 },
  },
  dullahan: {
    name:'我慢', duration:30, cooldown:120, trigger:'hpBelow', triggerValue:0.3,
    effects:{ dmgTakenMult:0.5, gutsRegenMult:2, cooldownMult:0.5 },
  },
  // <<AUTO:STATE_CHANGES>> ここから上へ tools/monster_add.py が新モンスターの行を追記する
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
  god:     { life:'D', power:'B', wisdom:'A', accuracy:'C', evasion:'D', vitality:'C' },
  zan:     { life:'C', power:'B', wisdom:'D', accuracy:'C', evasion:'A', vitality:'D' },
  // ピクシー: 高速・低耐久のグラスキャノン想定でevasion(速さ)を最高、life/vitality(HP・耐久)を最低に
  pixie:   { life:'E', power:'D', wisdom:'A', accuracy:'B', evasion:'B', vitality:'E' },
  dullahan:{ life:'C', power:'B', wisdom:'C', accuracy:'C', evasion:'E', vitality:'A' }, /*@dullahan*/
  // <<AUTO:APTITUDE>> ここから上へ tools/monster_add.py が新モンスターの行を追記する
};
// 適正は E→D→C→B→A→S の6段階。Sは転生でしか手に入らない(種族の初期適正には出てこない)。
const APTITUDE_ORDER = ['E','D','C','B','A','S'];
const APTITUDE_INITIAL_VALUE = { S:170, A:150, B:130, C:110, D:90, E:70 };
const APTITUDE_TRAIN_MULT   = { S:1.8,  A:1.5, B:1.25, C:1.0, D:0.8, E:0.6 };
// 適正Sだけの追加ボーナス: ステータス1ポイントあたりの倍率の伸びも良くなる。
// mastermonStatFactor の除数に掛ける(除数が小さいほど1ポイントの効きが強い)。
const APTITUDE_S_FACTOR_DIVISOR_MULT = 0.75;
// 1段階上げる(Sが上限)。転生で選んだ適正に使う
function aptitudeUpgrade(grade){
  const i = APTITUDE_ORDER.indexOf(grade);
  if(i < 0) return grade;
  return APTITUDE_ORDER[Math.min(i+1, APTITUDE_ORDER.length-1)];
}

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

/* =====================================================================
   転生(レベル100で1からやり直し、そのぶん強くなる不可逆システム)

   マスモンに増えるフィールドは2つだけ:
     mm.rebirth : 転生した回数(未転生は undefined/0)
     mm.apt     : このマスモン固有の適正表(転生で1段階上げたもの)。
                  無ければ種族の APTITUDE[element] を使う。
   どちらも「無ければ従来どおり」で読めるので、既存のセーブデータをそのまま扱える。
   ===================================================================== */
const REBIRTH_LEVEL_REQ        = MASTERMON_LEVEL_CAP; // 転生できるレベル(=上限レベル)
const REBIRTH_STAT_CAP         = 1099;  // 転生後のステータス上限
const REBIRTH_BASE_HP_BONUS    = 10;    // 転生1回につき種族の基礎HPに加算
const REBIRTH_BASE_SPEED_BONUS = 10;    // 転生1回につき種族の基礎速度に加算
const REBIRTH_TICKETS          = 10;    // 転生時にもらえるトレーニングチケット
const REBIRTH_STAT_KEEP_RATIO  = 1/3;   // 転生後に残るステータスの割合(999→333)
const REBIRTH_APT_PICKS        = 3;     // 転生時に1段階上げる適正の数

function mastermonRebirthCount(mm){ return Math.max(0, Math.round((mm && mm.rebirth) || 0)); }
// このマスモンの適正表。転生で書き換わっていればそちら、無ければ種族の適正
function mastermonApt(mm){
  if(mm && mm.apt) return mm.apt;
  const byElement = mm && APTITUDE[mm.element];
  return byElement || APTITUDE.mocchi;
}
// このマスモンのステータス上限(転生していれば引き上がる)
function mastermonStatCap(mm){ return mastermonRebirthCount(mm)>0 ? REBIRTH_STAT_CAP : MASTERMON_STAT_CAP; }
/* 種族の基礎値(HP・移動速度)への加算。内訳は2つ:
     ・転生の回数ぶん(REBIRTH_BASE_*_BONUS)
     ・基礎値アイテム(生命の果実・加速剤)を使ったぶん(mm.baseHp / mm.baseSpd)
   どちらも「無ければ0」で読めるので、既存のセーブデータをそのまま扱える。
   ここ1か所を通せば表示(mmEffectiveStats)も実戦力(applyMastermonStatsToEntity)も揃う。 */
function mastermonBaseBonus(mm){
  const n = mastermonRebirthCount(mm);
  const itemHp    = safeBaseAmount(mm && mm.baseHp);
  const itemSpeed = safeBaseAmount(mm && mm.baseSpd);
  return { hp: n*REBIRTH_BASE_HP_BONUS + itemHp, speed: n*REBIRTH_BASE_SPEED_BONUS + itemSpeed };
}
// 壊れたセーブや相手から届いた変な値でNaNにならないようにする。
// NaNのままだとHPが数値でなくなり、ダメージ計算もゲージも壊れて試合が続けられなくなる。
function safeBaseAmount(v){
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}
function canRebirthMastermon(mm){ return !!mm && (mm.level||0) >= REBIRTH_LEVEL_REQ; }
// 転生を実行した結果の新しいマスモンを返す(元のオブジェクトは書き換えない)。
// aptPicks には1段階上げるステータスキーを REBIRTH_APT_PICKS 個渡す。
function rebirthMastermonResult(mm, aptPicks){
  const picks = (aptPicks||[]).slice(0, REBIRTH_APT_PICKS);
  const nextRebirth = mastermonRebirthCount(mm) + 1;
  const baseApt = mastermonApt(mm);
  const apt = {};
  MASTERMON_STATS.forEach(s=>{ apt[s.key] = baseApt[s.key]; });
  picks.forEach(k=>{ if(apt[k]) apt[k] = aptitudeUpgrade(apt[k]); });
  const stats = {};
  // 転生後の上限で丸める(1/3にするので上限には当たらないが、計算の基準をそろえる)
  MASTERMON_STATS.forEach(s=>{
    stats[s.key] = mastermonClampStat((mm.stats[s.key]||0) * REBIRTH_STAT_KEEP_RATIO, REBIRTH_STAT_CAP);
  });
  return Object.assign({}, mm, {
    level: 1, exp: 0,
    tickets: (mm.tickets||0) + REBIRTH_TICKETS,
    rebirth: nextRebirth,
    apt, stats,
  });
}

// 上限は既定で999。転生済みのマスモンを扱うときは cap に mastermonStatCap(mm) を渡す
function mastermonClampStat(v, cap){ return Math.max(1, Math.min(cap||MASTERMON_STAT_CAP, Math.round(v))); }
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
// grade に 'S' を渡すと除数が縮み、同じステータス値でも倍率の伸びが良くなる(適正Sボーナス)
function mastermonStatFactor(v, statKey, grade){
  let divisor = MASTERMON_STAT_FACTOR_DIVISOR[statKey] || 900;
  if(grade==='S') divisor *= APTITUDE_S_FACTOR_DIVISOR_MULT;
  return 1 + (v-100)/divisor;
}

// マスモンをレベル降順(同レベルはキー順で安定)に並べ替えた新しいオブジェクトを返す。
// JSオブジェクトは文字列キーの挿入順を保持し、マスモンのキーは要素名(非数値)なので、
// ここで並べ替えておけば Object.keys で列挙する全画面が自動的にレベル降順になる。
function sortMastermonsByLevel(data){
  const keys = Object.keys(data).sort((a,b)=>{
    const la = (data[a] && data[a].level) || 0, lb = (data[b] && data[b].level) || 0;
    if(lb !== la) return lb - la;      // レベル降順
    return a < b ? -1 : a > b ? 1 : 0; // 同レベルはキー順で安定化
  });
  const out = {};
  for(const k of keys) out[k] = data[k];
  return out;
}
function loadMastermons(){
  try{ return sortMastermonsByLevel(JSON.parse(localStorage.getItem(MASTERMON_STORAGE_KEY)) || {}); }catch(err){ return {}; }
}
function saveMastermons(data){
  try{ localStorage.setItem(MASTERMON_STORAGE_KEY, JSON.stringify(data)); }catch(err){}
  if(typeof accountMarkDirty==='function') accountMarkDirty(); // アカウント同期(ログイン時のみ送信)
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
  const apt = mastermonApt(mm);      // 転生で上がった適正があればそちらが効く
  const cap = mastermonStatCap(mm);  // 転生済みは上限1099まで伸ばせる
  const changes = {};
  tpl.up.forEach(u=>{
    const mult = APTITUDE_TRAIN_MULT[apt[u.stat]] || 1;
    const gain = Math.round(u.amount*mult);
    const newVal = mastermonClampStat(mm.stats[u.stat]+gain, cap);
    changes[u.stat] = newVal - mm.stats[u.stat];
  });
  tpl.down.forEach(d=>{
    const newVal = mastermonClampStat(mm.stats[d.stat]-d.amount, cap);
    changes[d.stat] = newVal - mm.stats[d.stat];
  });
  return changes;
}
function applyMastermonTraining(mm, trainingKey){
  if(mm.tickets<=0) return null;
  const changes = previewMastermonTraining(mm, trainingKey);
  if(!changes) return null;
  const cap = mastermonStatCap(mm);
  Object.keys(changes).forEach(k=>{ mm.stats[k] = mastermonClampStat(mm.stats[k]+changes[k], cap); });
  mm.tickets -= 1;
  return changes;
}
// 試合成績に応じてEXPを付与し、レベルアップ毎にトレーニングチケットを1枚獲得
const MASTERMON_EXP_GLOBAL_MULT = 3; // 全試合共通のEXP倍率
// マスモン(bot補完・他プレイヤー)撃破ボーナス: 相手のレベル×この値のEXPを追加で獲得
// (xpMult・GLOBAL_MULTは掛けない固定値。バランス調整はこの係数で行う)
const MASTERMON_KILL_EXP_PER_LEVEL = 10;
const MASTERMON_CAP_EXP_TO_GOLD = 1; // レベル上限到達後、経験値相当をこの倍率でゴールドに変換
function awardMastermonExp(mm, opts){
  opts = opts || {};
  const kills = opts.kills||0, damage = opts.damage||0, survivalSec = opts.survivalSec||0, champion = !!opts.champion;
  const xpMult = opts.xpMult||1;
  const bonusExp = Math.round(opts.bonusExp||0); // マスモン撃破ボーナス等の加算EXP
  const rawExp = Math.round((kills*15 + damage/20 + survivalSec/10 + (champion?100:0)) * xpMult * MASTERMON_EXP_GLOBAL_MULT) + bonusExp;
  // レベル上限に達したマスモンは経験値の代わりにゴールドを獲得する
  if(mm.level>=MASTERMON_LEVEL_CAP){
    const goldGain = Math.round(rawExp * MASTERMON_CAP_EXP_TO_GOLD);
    return { expGain:0, levelsGained:0, goldGain };
  }
  const expGain = rawExp;
  mm.exp += expGain;
  let levelsGained = 0;
  while(mm.level<MASTERMON_LEVEL_CAP && mm.exp>=mastermonExpToNext(mm.level)){
    mm.exp -= mastermonExpToNext(mm.level);
    mm.level += 1;
    mm.tickets += 1;
    levelsGained += 1;
  }
  if(mm.level>=MASTERMON_LEVEL_CAP) mm.exp = 0;
  return { expGain, levelsGained, goldGain:0 };
}
// 指定レベル・種族の「それっぽいマスモン」を合成する(敵botのステータス生成用)。
// レベル1=適正初期値。以降1レベルにつき訓練1回分(≈18pt)を、適正(A〜E)に応じた配分で
// 各ステータスへ振り分ける(適正が高いステータスほど多く伸びる=適正に応じた育ち方)。
function syntheticMastermonForLevel(elementKey, level){
  const apt = APTITUDE[elementKey] || APTITUDE.mocchi;
  const stats = mastermonInitialStats(elementKey);
  const lv = clamp(Math.round(level)||1, 1, MASTERMON_LEVEL_CAP);
  const trainings = Math.max(0, lv-1);
  const totalPoints = trainings * 18; // 訓練1回≈18ポイント相当
  const mults = MASTERMON_STATS.map(s=>APTITUDE_TRAIN_MULT[apt[s.key]]||1);
  const sumMult = mults.reduce((a,b)=>a+b,0) || 1;
  MASTERMON_STATS.forEach((s,i)=>{
    stats[s.key] = mastermonClampStat(stats[s.key] + totalPoints*(mults[i]/sumMult));
  });
  return { element:elementKey, level:lv, stats };
}
// マスモンのステータスから、バトル中に適用する各種倍率を算出。
// 適正Sのステータスは倍率の伸びも良くなる(mastermonStatFactorの第3引数)。
function mastermonEffectMults(mm){
  const s = mm.stats;
  const apt = mastermonApt(mm);
  const f = (key) => mastermonStatFactor(s[key], key, apt[key]);
  return {
    lifeMult: f('life'),
    dmgDealtMult: (f('power')+f('wisdom'))/2,
    dmgTakenMult: 1/((f('power')+f('vitality'))/2),
    gutsRegenMult: f('wisdom'),
    cooldownMult: 1/f('accuracy'),
    speedMult: f('evasion'),
  };
}

const CLIMB_TOLERANCE = 12;

/* =====================================================================
   リアルマップ: WebGL(Three.js)で起伏のある地形を描くマップ。
   通常の6マップそれぞれに対応するリアル版があり(<キー>_real)、出てくる岩・山・水・
   溶岩などの中身は通常版とまったく同じ。違うのは「地面が立体になる」ことだけ。
   ・高さは real3dHeightAt(x,y) という純関数なので、ホストとゲストで自動的に一致する
     (シード付き乱数を通す必要がない)。当たり判定もこの高さを使う。
   ・地形の形はマップごとに REAL3D_TERRAIN_SETS から選ぶ。
     振幅×周波数の合計(=最大傾斜)は0.3までに抑える。ダッシュ中は1フレームで20単位ほど
     進むため、傾斜が大きすぎると CLIMB_TOLERANCE(12)を超えて坂を登れなくなる。
   ・見た目(空・霞・地面の色・遠景の山)は REAL3D_THEMES。real3d.jsが読む。
   ===================================================================== */
const REAL3D_TERRAIN_SETS = {
  // hills: 標準的な丘と谷(荒野)
  hills: [
    { amp:120, fx:0.00042, fy:0.00037, ph:0.0 },
    { amp: 80, fx:0.00097, fy:0.00081, ph:1.7 },
    { amp: 40, fx:0.00210, fy:0.00185, ph:3.1 },
    { amp: 14, fx:0.00520, fy:0.00470, ph:5.2 },
    // 中間スケールの起伏。メッシュの分割(約50単位)で表現できる波長にしてある。
    // これより細かい凹凸は地形メッシュではなくテクスチャ(real3d.js)で出す
    { amp: 12, fx:0.00750, fy:0.00680, ph:2.4 },
  ],
  // crags: 荒れた溶岩台地(カウレア火山)。細かい段差が多い
  crags: [
    { amp:110, fx:0.00050, fy:0.00044, ph:0.6 },
    { amp: 90, fx:0.00120, fy:0.00104, ph:2.2 },
    { amp: 45, fx:0.00260, fy:0.00232, ph:3.8 },
    { amp: 18, fx:0.00560, fy:0.00510, ph:1.1 },
    { amp: 10, fx:0.00900, fy:0.00820, ph:4.6 },
  ],
  // drift: なだらかな雪原(パパス雪山)
  drift: [
    { amp:140, fx:0.00035, fy:0.00031, ph:1.3 },
    { amp: 60, fx:0.00090, fy:0.00078, ph:2.9 },
    { amp: 24, fx:0.00230, fy:0.00205, ph:0.4 },
    { amp:  9, fx:0.00550, fy:0.00490, ph:3.3 },
  ],
  // jungle: 細かい起伏が続く森(パレパレジャングル)
  jungle: [
    { amp: 90, fx:0.00060, fy:0.00053, ph:2.1 },
    { amp: 60, fx:0.00140, fy:0.00122, ph:0.8 },
    { amp: 30, fx:0.00300, fy:0.00268, ph:4.2 },
    { amp: 14, fx:0.00650, fy:0.00580, ph:1.9 },
    { amp:  8, fx:0.01050, fy:0.00940, ph:5.5 },
  ],
  // coast: 平坦寄りで低い海岸(トーブル海岸)。水面が丘に乗って見えないようにする
  coast: [
    { amp: 70, fx:0.00040, fy:0.00035, ph:0.2 },
    { amp: 40, fx:0.00105, fy:0.00092, ph:2.6 },
    { amp: 18, fx:0.00250, fy:0.00224, ph:4.9 },
    { amp:  8, fx:0.00600, fy:0.00540, ph:1.5 },
  ],
  // dunes: 大きくうねる砂丘(マンディー砂漠)
  dunes: [
    { amp:160, fx:0.00030, fy:0.00027, ph:0.9 },
    { amp: 70, fx:0.00085, fy:0.00074, ph:3.4 },
    { amp: 22, fx:0.00260, fy:0.00230, ph:1.7 },
    { amp:  8, fx:0.00620, fy:0.00560, ph:4.1 },
  ],
};
function real3dLayers(){
  const k = (typeof currentMap!=='undefined' && currentMap && currentMap.real3dTerrain) || 'hills';
  return REAL3D_TERRAIN_SETS[k] || REAL3D_TERRAIN_SETS.hills;
}
function real3dHeightAt(x, y){
  const L = real3dLayers();
  let h = 0;
  for(let i=0;i<L.length;i++){
    const w = L[i];
    h += w.amp * (Math.sin(x*w.fx + w.ph) * 0.5 + Math.cos(y*w.fy + w.ph*1.3) * 0.5);
  }
  return h;
}
/* 高さと傾き(∂h/∂x, ∂h/∂y)を1回の走査でまとめて求める。
   sin/cos の微分は同じ角度の cos/sin なので、隣の点を追加で評価して差分を取るより速く、
   しかも傾きが近似ではなく厳密になる(地形の法線がそのまま正確になる)。
   毎フレーム数万回呼ぶので戻り値のオブジェクトは使い回す(呼んだ側で即座に読むこと)。 */
const _r3grad = { h:0, gx:0, gy:0 };
function real3dHeightGrad(x, y){
  const L = real3dLayers();
  let h = 0, gx = 0, gy = 0;
  for(let i=0;i<L.length;i++){
    const w = L[i];
    const ax = x*w.fx + w.ph, ay = y*w.fy + w.ph*1.3;
    const half = w.amp*0.5;
    h  += half * (Math.sin(ax) + Math.cos(ay));
    gx += half * w.fx * Math.cos(ax);
    gy -= half * w.fy * Math.sin(ay);
  }
  _r3grad.h = h; _r3grad.gx = gx; _r3grad.gy = gy;
  return _r3grad;
}
/* リアルマップの見た目。real3d.jsが window.__aramonRealTheme 経由で読む。
   tex: 地面テクスチャの作り方(ひび割れ・粒の強さ)。snowLine: 遠景の山に雪が乗り始める高さ比 */
const REAL3D_THEMES = {
  wild: {
    tex:'dry', bump:0.30,
    skyTop:0x1b2740, skyBot:0x6d7b8c, haze:0x8d9099,
    low:0x4a5666, high:0x7d8798, steep:0x3a4351, gravel:0x5b6572, scrub:0x55603f,
    ridgeRock:0x4a5260, ridgeFoot:0x5d6675, ridgeSnow:0xd2dbe6, snowLine:0.80,
  },
  kaurea: {
    tex:'volcanic', bump:0.34,
    skyTop:0x2a1408, skyBot:0xb0693a, haze:0x8a4a22,
    low:0x2b1d13, high:0x50392a, steep:0x1b1310, gravel:0x3b2b1f, scrub:0x5c3c1e,
    ridgeRock:0x3a2418, ridgeFoot:0x6a4426, ridgeSnow:0xd8a878, snowLine:0.92,
  },
  papas: {
    tex:'snow', bump:0.18,
    skyTop:0x2e4a72, skyBot:0xcfe0ef, haze:0xdbe8f2,
    low:0xb9cad9, high:0xf4f9ff, steep:0x7f8ea0, gravel:0xc8d4e0, scrub:0xa9bccd,
    ridgeRock:0x7c8b9d, ridgeFoot:0xb7c6d6, ridgeSnow:0xffffff, snowLine:0.28,
  },
  palepale: {
    tex:'jungle', bump:0.30,
    skyTop:0x1a3a2a, skyBot:0x93b58c, haze:0x9db98f,
    low:0x24451f, high:0x4f7030, steep:0x3a3a24, gravel:0x3f4a2c, scrub:0x648020,
    ridgeRock:0x3a4a34, ridgeFoot:0x4c6440, ridgeSnow:0xdfe8d8, snowLine:0.82,
  },
  toble: {
    tex:'sand', bump:0.22,
    skyTop:0x1f4a72, skyBot:0xa9d0e4, haze:0xcfe0e8,
    low:0xb09a6a, high:0xeaddb0, steep:0x8a7a5c, gravel:0xc0ac82, scrub:0x9aa86a,
    ridgeRock:0x6d7a86, ridgeFoot:0xa89a7a, ridgeSnow:0xe8f0f6, snowLine:0.70,
  },
  mandy: {
    tex:'sand', bump:0.24,
    skyTop:0x2a4a7a, skyBot:0xe0c98f, haze:0xe6d3a4,
    low:0xc9ab6f, high:0xf2e2ae, steep:0xa08a5c, gravel:0xd8c48c, scrub:0xc0b070,
    ridgeRock:0x8a7a5a, ridgeFoot:0xc8ae7e, ridgeSnow:0xf2ead8, snowLine:0.86,
  },
};
/* リアルマップの障害物の形。real3d.jsが3Dモデルを作り、render.jsが「同じ形」で2Dを
   くり抜く(destination-out)ので、必ずこの1つの表を両方が見る。
   単位は当たり判定の半径(radius)を1としたときの比。**モデルの原点(=地面より
   sinkだけ下)を y=0 とし、上が+**。地面より上に見えるのは (h - sink) ぶん。
   ・h    モデルの全高(原点から天辺まで)
   ・sink 地面へ埋める深さ(埋めないと坂で浮いて見える)
   ・sil  くり抜く形の並び [中心の高さ, 横半径, 縦半径, 種別, 上端の横半径]。
          種別は 0/省略=楕円(丸い塊) / 1=箱(幹・柱) / 2=三角(円錐)。
          5番目は箱だけで使い、上ほど細い幹を表す(省略すると上下同じ太さ)。
          **3Dモデルの実寸に合わせること。** 大きいと障害物より広い範囲が隠れ、
          小さいと奥のモンスターが縁からはみ出す。細い枝や葉は消さずに残す
          (消すと枝の無い空間まで隠れる)。                                    */
const OBST_SHAPES = {
  rock:     { h:1.15, sink:0.24, sil:[[0.55,1.02,0.60]] },
  sandrock: { h:0.84, sink:0.20, sil:[[0.40,1.02,0.44]] },
  snowrock: { h:1.15, sink:0.24, sil:[[0.55,1.02,0.60]] },
  basalt:   { h:2.03, sink:0.22, sil:[[1.00,0.50,1.03,1,0.46],[0.72,0.62,0.80,1]] },
  // 枯れ木の枝は細いので消さない(消すと枝の無い空間まで隠れてしまう)
  deadtree: { h:2.26, sink:0.12, sil:[[1.13,0.22,1.13,1,0.10]] },
  pine:     { h:2.70, sink:0.10, sil:[[0.39,0.15,0.40,1,0.11],[1.11,0.98,0.59,2],[1.67,0.78,0.55,2],[2.21,0.54,0.49,2]] },
  tree:     { h:2.62, sink:0.10, sil:[[0.75,0.24,0.76,1,0.16],[1.80,0.90,0.82]] },
  log:      { h:0.61, sink:0.16, sil:[[0.30,0.85,0.31,1]] },   // 横倒しの丸太は箱で消す(楕円だと両端が残る)
  palm:     { h:3.08, sink:0.12, sil:[[1.39,0.19,1.40,1,0.26],[2.80,0.80,0.26]] },
  shell:    { h:0.56, sink:0.12, sil:[[0.00,1.05,0.56]] },
  cactus:   { h:2.45, sink:0.14, sil:[[1.20,0.40,1.25,1],[1.40,0.55,0.82,1]] },
  crystal:  { h:1.70, sink:0.18, sil:[[0.79,0.42,0.91,2],[0.58,0.60,0.70,1,0.22]] },
};
window.__aramonObstShapes = OBST_SHAPES;   // ESモジュール(real3d.js)への橋渡し
// 通常マップ → リアルマップの対応。地形の形だけマップごとに変える
const REAL3D_TERRAIN_OF ={ wild:'hills', kaurea:'crags', papas:'drift', palepale:'jungle', toble:'coast', mandy:'dunes' };
const REAL_MAP_SUFFIX = '_real';
const REAL_MAP_REWARD_MULT = 2;   // リアルマップは上級者向け。ゴールド/ダイヤの獲得量を倍にする
// 通常マップから対応するリアルマップを自動生成する(中身は同じで、地面だけ立体になる)。
// マップを1つ足せばリアル版も自動で増えるので、追加時にここを触る必要はない。
Object.keys(MAPS).forEach(key=>{
  const base = MAPS[key];
  if(base.real3d) return;
  const terrain = REAL3D_TERRAIN_OF[key];
  if(!terrain) return;
  MAPS[key+REAL_MAP_SUFFIX] = {
    ...base,
    key: key+REAL_MAP_SUFFIX,
    label: base.label+'(リアル)',
    real3d: true, realOf: key, real3dTerrain: terrain, real3dTheme: key,
    decorCount: 0,   // 地面の模様はWebGLのテクスチャが担当するので2Dの装飾は作らない
    desc: '【上級者向け・報酬2倍】'+(base.desc||'')+' 地面に丘と谷があり、技は視線の向きへ飛ぶ。',
  };
});
/* レイド専用マップ。カウレア火山のリアル版を流用した、狭い円形の闘技場。
   ・real3d:true を直に付けてあるので、上のリアル版の自動生成には拾われない
   ・raidOnly:true で通常のマップ選択・ランダム抽選から外す
   ・火山は1つだけ。ボスの真後ろに置く(位置は world.js の genVolcanoAndLava が
     game.raid のときだけ RAID_VOLCANO_SITE を使う)                                */
MAPS.raid = {
  key:'raid', label:'竜の火口', rockCount:120, decorCount:0, hasVolcano:true,
  mountainStyle:'volcano', groundColor:'#241708',
  previewIcon:'🐉', previewColors:['#5a2a12','#1a0c05'],
  desc:'火口を背に巨竜が待ち構える円形の闘技場。逃げ場は狭い。',
  real3d:true, realOf:'kaurea', real3dTerrain:'crags', real3dTheme:'kaurea',
  raidOnly:true,
  volcanoSites:[], lavaRingPerVolcano:0, lavaPoolCount:0, lavaDps:0,
  realObstacles:[{ type:'rock', w:0.55 }, { type:'basalt', w:0.45 }],
};
const UPWARD_BLOCK_THRESHOLD = 35;

/* =====================================================================
   週替わりレイドバトル

   ・週ごとに巨大ボス1体。ソロでもマルチでも挑め、与えたダメージは全プレイヤーで
     累計する(Firebaseの raids/{weekId})。累計の到達で全員報酬、加えて個人ランキング報酬。
   ・ボスは既存のエンティティ+areaEffect(範囲攻撃)の仕組みだけで作ってある。
     新しい攻撃の仕組みは足していないので、通常の試合の挙動には一切影響しない。
   ・開催前・終了後は RAID_ACTIVE / raidOpenNow() が false になり、入口も出ない。
   ===================================================================== */
/* 公開前は「準備中」。RAID_PREVIEW_ACCOUNTS のアカウントだけが入れて、
   バトルが終わっても記録も報酬も一切残さない(公開時に全員が同じ位置から始められるように)。
   公開するときは RAID_PREVIEW を false にするだけでよい。
   → シーズン1公開(2026-08-06)で false にした。以降は開催期間(RAID_START_DATE から
     RAID_DURATION_DAYS 日間)であれば全プレイヤーが挑める。                     */
const RAID_PREVIEW = false;
const RAID_PREVIEW_ACCOUNTS = ['おりょう', 'さびょう'];
const RAID_ACTIVE = true;                 // レイド機能そのものの有効/無効
const RAID_START_DATE = '2026-08-07';     // シーズン1と同時開幕
const RAID_DURATION_DAYS = 7;             // 開催期間(1週間)
const RAID_CAPACITY = 4;                  // 同時に挑める人数(余りはマスモン・botで補充)
const RAID_TIME_LIMIT = 180;              // 1回の挑戦の制限時間(秒)
const RAID_WORLD_SCALE = 0.30;            // 通常の試合に対するワールドの広さ(狭い円形闘技場)
const RAID_ARENA_MARGIN = 260;            // 闘技場の縁と安置の外周の間隔

// 開催期間。開始日00:00から RAID_DURATION_DAYS 日間
function raidStartAt(){ return new Date(RAID_START_DATE+'T00:00:00'); }
function raidEndAt(){ return new Date(raidStartAt().getTime() + RAID_DURATION_DAYS*86400000); }
function raidOpenNow(){
  if(!RAID_ACTIVE) return false;
  const now = Date.now();
  return now >= raidStartAt().getTime() && now < raidEndAt().getTime();
}
// 今このアカウントがレイドに入れるか。準備中は開発アカウントだけ
function raidPlayable(accountName){
  if(!RAID_ACTIVE) return false;
  if(!RAID_PREVIEW) return raidOpenNow();
  return RAID_PREVIEW_ACCOUNTS.indexOf(accountName||'') >= 0;
}
// 準備中は記録も報酬も残さない(デモプレイと同じ扱い)
function raidRecordsDisabled(){ return RAID_PREVIEW; }
function raidSecondsLeft(){ return Math.max(0, Math.floor((raidEndAt().getTime()-Date.now())/1000)); }
// 累計ダメージを貯める単位。開催ごとに変わるIDにしておけば、次回開催で自動的に別枠になる
function raidWeekId(){ return 'r_'+RAID_START_DATE.replace(/-/g,''); }

/* --- ボス --- */
/* 火口の位置(ワールド比率)。ボスはこの手前に立つので、見上げると必ず背後に火山が入る。
   ボスは巨体なので、火山の裾に埋まらないよう RAID_BOSS_YR まで手前へ下げてある。
   アイテムは火山と反対側(手前)に撒くので、拾いに行くとボスから離れる形になる。      */
const RAID_VOLCANO_SITE = { xr:0.5, yr:0.10, radius:1500, peakBumps:7 };
const RAID_BOSS_YR  = 0.45;   // ボスの立ち位置(ワールド比率)。火山とはこのぶん離れる
const RAID_BOSS_VOLCANO_GAP = 120;  // ボスの体と火山の裾のあいだに空ける余白
// ボスがこれより上(火山側)へ行かないようにする境界。巨体なので、火山の半径+ボスの半径ぶん
// 離しておかないと山の斜面に食い込んで見える。徘徊先もこの線でclampする。
function raidBossMinY(){
  return WORLD.h*RAID_VOLCANO_SITE.yr + RAID_VOLCANO_SITE.radius + RAID_BOSS.radius + RAID_BOSS_VOLCANO_GAP;
}
const RAID_LOOT_YR  = 0.64;   // アイテムを撒く中心(火山と反対側=手前)。安置が縮んでも一部が残る位置
const RAID_LOOT_COUNT = 46;   // 開始時に撒く数
const RAID_LOOT_SPREAD = 0.20; // 撒く範囲(ワールドの短辺に対する比率)
/* レイドは3分間ずっと技を撃ち続ける戦いなので、開始時に撒くだけだと途中でガッツが尽きる。
   一定間隔で追加を撒いて補給が途切れないようにする(マルチではホストが撒いて配信する)。 */
const RAID_LOOT_REFILL_EVERY = 14;  // 追加を撒く間隔(秒)
const RAID_LOOT_REFILL_COUNT = 12;  // 1回に撒く数
const RAID_BOSS = {
  element:'fire',            // 素体はドラゴン
  skinId:'zod_ssr',          // 見た目はSSRスキン「不死のゾッド」。歩行コマもこのスキンのものが出る
  name:'不死のゾッド',
  radius: 288,               // 通常のモンスター(22前後)の13倍。画面を覆うほどの巨体
  baseHp: 24000,             // 1人あたりの基準HP。人数ぶん増える(raidBossMaxHp。4人で63,600)
  hpPerExtraPlayer: 0.55,    // 2人目以降1人につきこの割合ぶんHPを足す
  speed: 60,                 // 動きは鈍いが、じりじり間合いを詰めてくる(通常のドラゴンは182)
  repositionEvery: 7,        // この秒数ごとに位置を変える(歩行モーションが見えるよう短め)
  repositionDist: 420,
};
// レイドの味方(自分・bot・マスモン)のガッツ回復倍率。
// ボスに技を撃ち続けられるよう、通常の試合より速く回復させる
const RAID_ALLY_GUTS_REGEN_MULT = 2;
// ボスの攻撃。すべて areaEffect(範囲攻撃)なので、当たり判定も描画も既存の仕組みに乗る。
//   tier      : 1=通常 2=強力 3=大技。時間が経つほど上のtierが出やすくなる
//   shape     : 'fan'(扇) / 'circle'(自分中心の円) / 'meteor'(狙った足元に落ちる円)
//   telegraph : 予告の長さ(秒)。この間は当たらず、点線の予告と標的だけが出る
//   warn      : 予告トーストの文言
const RAID_BOSS_MOVES = [
  { key:'breath',  tier:1, name:'灼熱のブレス', shape:'fan',    range:1900, fanAngleDeg:78, dmg:64, telegraph:1.30, color:'#ff6b35',
    warn:'⚠ 灼熱のブレス — 正面から離れろ！' },
  { key:'tail',    tier:1, name:'尾薙ぎ',       shape:'circle', range:900,  dmg:56, telegraph:1.10, color:'#ff9a5a', selfCentered:true,
    warn:'⚠ 尾薙ぎ — 竜から離れろ！' },
  { key:'meteor',  tier:2, name:'落炎',         shape:'meteor', range:560,  dmg:86, telegraph:1.55, color:'#ff4d2a', count:3,
    warn:'⚠ 落炎 — 足元の輪から逃げろ！' },
  { key:'pillar',  tier:2, name:'劫火の柱',     shape:'meteor', range:430,  dmg:74, telegraph:1.35, color:'#ffb703', count:5,
    warn:'⚠ 劫火の柱 — 柱が5本立つ！' },
  { key:'nova',    tier:3, name:'終焉の吐息',   shape:'fan',    range:2900, fanAngleDeg:170, dmg:130, telegraph:2.10, color:'#ff2e63',
    warn:'☠ 終焉の吐息 — 竜の背後へ回り込め！' },
  { key:'ring',    tier:3, name:'業火の輪',     shape:'circle', range:2100, dmg:118, telegraph:2.00, color:'#ff5d5d', selfCentered:true,
    warn:'☠ 業火の輪 — 全力で外周へ！' },
];
// 攻撃の間隔。時間が経つほど短くなる(=攻撃頻度が上がる)
const RAID_ATTACK_GAP_START = 4.6;
const RAID_ATTACK_GAP_END   = 1.7;
const RAID_ESCALATE_SECONDS = 150;  // この秒数かけて開幕→最高潮まで上がりきる
// 各tierの出やすさ。開幕(from)から最高潮(to)へ徐々に移る
const RAID_TIER_WEIGHTS = {
  from: { 1:82, 2:16, 3:2 },
  to:   { 1:34, 2:40, 3:26 },
};
// 経過時間0〜1(0=開幕 1=最高潮)。攻撃頻度・tier配分・HUDの「怒り」表示に使う
function raidEscalation(elapsed){ return clamp((elapsed||0)/RAID_ESCALATE_SECONDS, 0, 1); }
function raidAttackGap(elapsed){
  return lerp(RAID_ATTACK_GAP_START, RAID_ATTACK_GAP_END, raidEscalation(elapsed));
}
// 経過時間に応じてtierを抽選する
function raidPickMoveTier(elapsed){
  const t = raidEscalation(elapsed);
  const w = [1,2,3].map(k=> lerp(RAID_TIER_WEIGHTS.from[k], RAID_TIER_WEIGHTS.to[k], t));
  let r = Math.random()*(w[0]+w[1]+w[2]);
  for(let i=0;i<3;i++){ r -= w[i]; if(r<0) return i+1; }
  return 1;
}
function raidPickMove(elapsed){
  const tier = raidPickMoveTier(elapsed);
  const pool = RAID_BOSS_MOVES.filter(m=>m.tier===tier);
  return pool.length ? pickRandom(pool) : RAID_BOSS_MOVES[0];
}
// 挑戦人数に応じたボスのHP。1人でも削り切れないが、削ったぶんが累計に乗る作り
function raidBossMaxHp(playerCount){
  const n = Math.max(1, playerCount||1);
  return Math.round(RAID_BOSS.baseHp * (1 + (n-1)*RAID_BOSS.hpPerExtraPlayer));
}

/* --- レイド特効スキン ---
   ここに載せたスキンを装備していると、レイドのボス戦でだけ倍率が掛かる。
   ツールでスキンを追加したあと1行足すだけで効く(判定は raidSkinBonus 1か所)。 */
const RAID_EFFECT_SKINS = {
  guts_ssr:       { dmgDealt:1.5, dmgTaken:0.75, name:'狂戦士ガッツ' }, /*@guts_ssr*/
  // <<AUTO:RAID_EFFECT_SKINS>> ここから上へ tools/studio_web.html がレイド特効スキンの行を追記する
};
function raidSkinBonus(skinId){ return (skinId && RAID_EFFECT_SKINS[skinId]) || null; }
// レイドガチャのピックアップ(=レイド特効スキン)。ツールで追加したIDをここへ入れる
const RAID_GACHA_PICKUP = 'guts_ssr';
// レイド最終報酬(参加者全員へ配布)のスキン
const RAID_CLEAR_SKIN = 'zod_ssr';

/* --- 報酬 ---
   累計ダメージの到達報酬(全員共通)と、個人の与ダメ順位に応じた報酬。 */
/* 最後の段の at がレイド全体の「ボスの総HP」として表示される(raid画面の残り体力バー)。
   1回の戦闘のボスHP(RAID_BOSS.baseHp)と同じ倍率で増減させること。 */
const RAID_TOTAL_TIERS = [
  { at:  50000, gold:1500, dia:20 },
  { at: 200000, gold:3000, dia:40, item:'freeTrainTicket', n:3 },
  { at: 500000, gold:5000, dia:60, item:'moveTicket', n:3 },
  // レイドでしか手に入らない基礎値アイテム(生命の果実・加速剤)を目玉にする
  { at:1200000, gold:8000, dia:100, items:[{key:'fruit_life',n:1},{key:'accel_elixir',n:1}] },
  { at:2500000, gold:12000, dia:150, skin:RAID_CLEAR_SKIN },   // 討伐達成: 全員に限定SSR
];
// 個人の累計与ダメによる報酬(上から順に、達成した一番上のものまで全部もらえる)
const RAID_PERSONAL_TIERS = [
  { at:   4000, gold:500,  dia:5 },
  { at:  16000, gold:1200, dia:10, item:'freeTrainTicket', n:1 },
  { at:  50000, gold:2500, dia:20, item:'moveTicket', n:1 },
  { at: 120000, gold:4000, dia:35, items:[{key:'fruit_life',n:1},{key:'accel_elixir',n:1}] },
  { at: 300000, gold:7000, dia:60, items:[{key:'fruit_life',n:1},{key:'accel_elixir',n:1}] },
];
/* 1回の挑戦で得られるゴールド/ダイヤ。
   通常の試合と同じ「参加ぶん + 成果ぶん(+ 討伐ボーナス)」の形にして、
   成果ぶんを撃破数ではなく与ダメージから出す。倍率(マルチ・ミューテーター)も通常と同じ。
   ボスのHPは24万なので、1回の与ダメは数千〜数万になる想定。
   例: 5,000ダメージのソロ → 🪙20+55=75 / 💎5+4=9(通常の試合と同じくらい)
       50,000ダメージのマルチ → 🪙(20+555)×2=1,150 / 💎5+41=46           */
const RAID_RUN_GOLD_PER_DMG = 1/90;
const RAID_RUN_DIA_PER_DMG  = 1/1200;
const RAID_RUN_GOLD_MAX = 1500;   // 成果ぶんの上限(参加ぶん・討伐ボーナスは別)
const RAID_RUN_DIA_MAX  = 60;
// レイドの自己ベスト更新は勝利あつかいにする(倒しきれなくても手応えを返す)
const RAID_BEST_IS_WIN = true;
/* マスモンの経験値とシーズンSPは、通常の試合と同じ式(与ダメージから算出)を使う。
   ただしレイドの与ダメージは通常の試合より1桁大きいので、この係数を掛けて釣り合わせる。
   掛けないと1回のレイドでシーズンパスが数段階まとめて上がってしまう。
   例(5,000ダメージ): SP (10+30+5)×2 = 90 / EXP 25 … 通常の良い試合と同じくらい */
const RAID_PROGRESS_DAMAGE_SCALE = 1/10;

/* --- 進捗の保存(端末+アカウント同期) --- */
const RAID_STORAGE_KEY = 'aramon_raid_v1';
function loadRaidProgress(){
  try{
    const r = JSON.parse(localStorage.getItem(RAID_STORAGE_KEY)) || {};
    if(r.weekId !== raidWeekId()) return { weekId:raidWeekId(), dmg:0, runs:0, best:0, claimedTotal:{}, claimedPersonal:{} };
    return { weekId:r.weekId, dmg:Math.max(0,r.dmg||0), runs:r.runs||0, best:Math.max(0,r.best||0),
             claimedTotal:r.claimedTotal||{}, claimedPersonal:r.claimedPersonal||{} };
  }catch(err){ return { weekId:raidWeekId(), dmg:0, runs:0, best:0, claimedTotal:{}, claimedPersonal:{} }; }
}
function saveRaidProgress(r){
  try{ localStorage.setItem(RAID_STORAGE_KEY, JSON.stringify(r)); }catch(err){}
  if(typeof accountMarkDirty==='function') accountMarkDirty();
}

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
   プレイヤーアカウント: 通貨(ゴールド/ダイヤ)・バッグ・アイテム・ガチャ
===================================================================== */
const WALLET_STORAGE_KEY = 'aramon_wallet_v1';
const BAG_STORAGE_KEY = 'aramon_bag_v1';
function loadWallet(){
  try{
    const w = JSON.parse(localStorage.getItem(WALLET_STORAGE_KEY)) || {};
    return { gold: Math.max(0, Math.round(w.gold||0)), dia: Math.max(0, Math.round(w.dia||0)) };
  }catch(err){ return { gold:0, dia:0 }; }
}
function saveWallet(w){
  try{ localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(w)); }catch(err){}
  if(typeof accountMarkDirty==='function') accountMarkDirty();
}
function addWallet(gold, dia){
  const w = loadWallet();
  w.gold += Math.round(gold||0); w.dia += Math.round(dia||0);
  saveWallet(w);
  return w;
}
function loadBag(){
  try{ return JSON.parse(localStorage.getItem(BAG_STORAGE_KEY)) || {}; }catch(err){ return {}; }
}
function saveBag(b){
  try{ localStorage.setItem(BAG_STORAGE_KEY, JSON.stringify(b)); }catch(err){}
  if(typeof accountMarkDirty==='function') accountMarkDirty();
}
function addBagItem(key, n){
  const b = loadBag();
  b[key] = (b[key]||0) + (n||1);
  saveBag(b);
}

// ===== バトル操作画面カスタマイズ(端末ごとにHUD配置を保存。アカウント同期はしない) =====
const HUD_LAYOUT_KEY = 'aramon_hud_layout_v1';
// カスタマイズ対象の要素id → 編集モードで表示するラベル。値は#hud基準の割合(fx,fy)で保存する
const HUD_DRAGGABLE = {
  joystickBase:'移動', fireBtn:'攻撃', dashBtn:'回避',
  turnLeftBtn:'左回転', turnRightBtn:'右回転', movePanel:'技',
  topLeft:'HP/ガッツ', statsPanel:'撃破/ダメ', topRight:'情報/地図',
};
const HUD_DRAGGABLE_IDS = Object.keys(HUD_DRAGGABLE);
function loadHudLayout(){ try{ return JSON.parse(localStorage.getItem(HUD_LAYOUT_KEY)) || {}; }catch(e){ return {}; } }
function saveHudLayout(o){ try{ localStorage.setItem(HUD_LAYOUT_KEY, JSON.stringify(o||{})); }catch(e){} }

/* =====================================================================
   称号(タイトル): 実績で解放。バッグの「称号」タブで確認・装備できる
   type: matchKills/matchDamage=1試合の自己ベスト, wins/matches/totalKills/totalDamage=累計,
         ssr=SSRスキン所持, allElem=全モンスターでプレイ
===================================================================== */
const TITLES = [
  // 1試合のキル数
  { id:'kill3',  name:'ビギナーハンター', emoji:'🎯', cat:'キル', type:'matchKills', n:3 },
  { id:'kill5',  name:'ハンター',         emoji:'🏹', cat:'キル', type:'matchKills', n:5 },
  { id:'kill8',  name:'スレイヤー',       emoji:'⚔️', cat:'キル', type:'matchKills', n:8 },
  { id:'kill10', name:'キラー',           emoji:'🔪', cat:'キル', type:'matchKills', n:10 },
  { id:'kill15', name:'プレデター',       emoji:'🐾', cat:'キル', type:'matchKills', n:15 },
  { id:'kill20', name:'爪痕プレデター',   emoji:'🩸', cat:'キル', type:'matchKills', n:20 },
  { id:'kill25', name:'モンスターの覇者', emoji:'👑', cat:'キル', type:'matchKills', n:25 },
  // 1試合の与ダメージ
  { id:'dmg1000', name:'パンチ',           emoji:'👊', cat:'ダメージ', type:'matchDamage', n:1000 },
  { id:'dmg1500', name:'アッパー',         emoji:'🥊', cat:'ダメージ', type:'matchDamage', n:1500 },
  { id:'dmg2000', name:'ハンマー',         emoji:'🔨', cat:'ダメージ', type:'matchDamage', n:2000 },
  { id:'dmg2500', name:'ビリビリハンマー', emoji:'⚡', cat:'ダメージ', type:'matchDamage', n:2500 },
  { id:'dmg3000', name:'縦ハンマー',       emoji:'⛏️', cat:'ダメージ', type:'matchDamage', n:3000 },
  { id:'dmg4000', name:'ダブルハンマー',   emoji:'🛠️', cat:'ダメージ', type:'matchDamage', n:4000 },
  { id:'dmg5000', name:'メテオハンマー',   emoji:'☄️', cat:'ダメージ', type:'matchDamage', n:5000 },
  // 累計勝利
  { id:'win1',  name:'初モン勝ち',       emoji:'🎉', cat:'勝利', type:'wins', n:1 },
  { id:'win5',  name:'常勝の風格',       emoji:'🌟', cat:'勝利', type:'wins', n:5 },
  { id:'win10', name:'王者への道',       emoji:'🏆', cat:'勝利', type:'wins', n:10 },
  { id:'win25', name:'覇王',             emoji:'👑', cat:'勝利', type:'wins', n:25 },
  { id:'win50', name:'伝説のモンスター', emoji:'🔥', cat:'勝利', type:'wins', n:50 },
  // 累計試合数
  { id:'match1',   name:'新米モンスター', emoji:'🐣', cat:'試合数', type:'matches', n:1 },
  { id:'match10',  name:'野生の常連',     emoji:'🌿', cat:'試合数', type:'matches', n:10 },
  { id:'match50',  name:'歴戦の猛者',     emoji:'🗡️', cat:'試合数', type:'matches', n:50 },
  { id:'match100', name:'百戦錬磨',       emoji:'💯', cat:'試合数', type:'matches', n:100 },
  { id:'match300', name:'荒野の主',       emoji:'🏔️', cat:'試合数', type:'matches', n:300 },
  // 累計キル
  { id:'tk100',  name:'百人斬り',     emoji:'🌀', cat:'累計キル', type:'totalKills', n:100 },
  { id:'tk500',  name:'殺戮マシン',   emoji:'🤖', cat:'累計キル', type:'totalKills', n:500 },
  { id:'tk1000', name:'千の牙',       emoji:'🐺', cat:'累計キル', type:'totalKills', n:1000 },
  // 累計ダメージ
  { id:'td50k',  name:'破壊者', emoji:'💥', cat:'累計ダメージ', type:'totalDamage', n:50000 },
  { id:'td200k', name:'天災',   emoji:'🌪️', cat:'累計ダメージ', type:'totalDamage', n:200000 },
  // 特殊
  { id:'ssr',     name:'強運の持ち主',   emoji:'🍀', cat:'特殊', type:'ssr' },
  { id:'allElem', name:'オールラウンダー', emoji:'🌈', cat:'特殊', type:'allElem' },
];
const TITLES_BY_ID = {}; TITLES.forEach(t=>{ TITLES_BY_ID[t.id]=t; });
// 解放条件の説明文
function titleCondText(t){
  switch(t.type){
    case 'matchKills':  return `1試合で${t.n}キル`;
    case 'matchDamage': return `1試合で${t.n}ダメージ`;
    case 'wins':        return `通算${t.n}勝`;
    case 'matches':     return `通算${t.n}試合プレイ`;
    case 'totalKills':  return `通算${t.n}キル`;
    case 'totalDamage': return `通算${t.n}ダメージ`;
    case 'ssr':         return `SSRスキンを入手`;
    case 'allElem':     return `全モンスターでプレイ`;
    default:            return '';
  }
}
/* =====================================================================
   デイリー: ログインボーナス(7日サイクル)＋今日のミッション
===================================================================== */
const DAILY_STORAGE_KEY = 'aramon_daily_v1';
// 7日サイクルの報酬(徐々に豪華に→7日目で大きく→ループ)
// ゴールドはすべて100単位の値にする(端数の出ないきりの良い数値にそろえる方針)
const LOGIN_BONUS = [
  null,                              // index0未使用
  { gold:100 },                      // Day1
  { gold:200 },                      // Day2
  { dia:5 },                         // Day3
  { gold:300 },                      // Day4
  { item:'freeTrainTicket', n:1 },   // Day5
  { dia:10 },                        // Day6
  { gold:500, dia:20 },              // Day7(大)
];
// 毎日リセットされるミッション(固定3種)。ゴールドは100単位
const DAILY_MISSIONS = [
  { id:'play', name:'試合に3回参加する', target:3, reward:{ gold:100 }, track:'play' },
  { id:'kill', name:'合計5キルする',     target:5, reward:{ gold:200 }, track:'kill' },
  { id:'win',  name:'1回勝利する',       target:1, reward:{ dia:5 },    track:'win'  },
];
function dailyTodayStr(){ const d=new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; }
function loadDaily(){
  try{
    const d = JSON.parse(localStorage.getItem(DAILY_STORAGE_KEY)) || {};
    return { lastLoginDate: d.lastLoginDate||null, loginDay: d.loginDay||0,
      missionDate: d.missionDate||null, missions: d.missions||{} };
  }catch(err){ return { lastLoginDate:null, loginDay:0, missionDate:null, missions:{} }; }
}
function saveDaily(d){
  try{ localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(d)); }catch(err){}
  if(typeof accountMarkDirty==='function') accountMarkDirty();
}
// 報酬の表示テキスト(🪙100 💎5 🎟️×1 等)
function rewardText(r){
  if(!r) return '';
  const parts = [];
  if(r.gold) parts.push(`🪙${r.gold}`);
  if(r.dia)  parts.push(`💎${r.dia}`);
  for(const x of rewardItemList(r)) parts.push(playerItemTextLabel(x.key, x.n));
  if(r.skin){ const m = (typeof skinMeta==='function') ? skinMeta(r.skin) : null; parts.push(`✨${m?m.name:'スキン'}`); }
  return parts.join(' ');
}
// 報酬を実際に付与
// 報酬のアイテムを {key,n} の配列にそろえる。1個だけなら item/n、複数なら items:[{key,n}...]
function rewardItemList(r){
  if(!r) return [];
  const out = [];
  if(r.item) out.push({ key:r.item, n:r.n||1 });
  if(Array.isArray(r.items)) for(const x of r.items){ if(x && x.key) out.push({ key:x.key, n:x.n||1 }); }
  return out.filter(x=>PLAYER_ITEMS[x.key]);
}
function grantReward(r){
  if(!r) return;
  if(r.gold || r.dia) addWallet(r.gold||0, r.dia||0);
  for(const x of rewardItemList(r)) addBagItem(x.key, x.n);
  if(r.skin && typeof ownSkin==='function') ownSkin(r.skin);
}

/* =====================================================================
   シーズン1 準備(非公開・管理者プレビューのみ): ミューテーター(日替わり変則ルール)
   SEASON1_ACTIVE を true にするまでゲームプレイに一切影響しない。
   公開時は true へ変更し、CLAUDE.mdのルールに従って UPDATE_HISTORY に告知を追記すること。
===================================================================== */
const SEASON1_ACTIVE = true;  // シーズン1公開済み(ミューテーターの発動は SEASON1_START_DATE から)
const SEASON1_START_DATE = '2026-08-07'; // ミューテーター適用開始日(この日の前はSEASON1_ACTIVE=trueでも発動しない)

// 曜日ごとのミューテーター設定(表示は月始まり。dayはDate.getDay()準拠 0=日〜6=土)
const SEASON1_MUTATORS = [
  { day:1, label:'月曜日', tier:true,  reward:false, spawn:false },
  { day:2, label:'火曜日', tier:false, reward:true,  spawn:false },
  { day:3, label:'水曜日', tier:false, reward:false, spawn:true  },
  { day:4, label:'木曜日', tier:true,  reward:false, spawn:false },
  { day:5, label:'金曜日', tier:false, reward:true,  spawn:false },
  { day:6, label:'土曜日', tier:true,  reward:true,  spawn:true  },
  { day:0, label:'日曜日', tier:true,  reward:true,  spawn:true  },
];
// 今日のミューテーター設定(非公開中、またはSEASON1_START_DATE未到達ならnull)
function mutatorToday(){
  if(!SEASON1_ACTIVE) return null;
  const now = new Date();
  if(SEASON1_START_DATE && now < new Date(SEASON1_START_DATE+'T00:00:00')) return null;
  return SEASON1_MUTATORS.find(m=>m.day===now.getDay()) || null;
}
function mutatorTierStartActive(){ const m = mutatorToday(); return !!(m && m.tier); }
function mutatorRewardMult(){ const m = mutatorToday(); return (m && m.reward) ? 2 : 1; }
function mutatorSpawnMult(){ const m = mutatorToday(); return (m && m.spawn) ? 1.5 : 1; }
// ミューテーター短縮ラベル(カレンダー表示用)。各ラベルの詳しい説明はMUTATOR_LEGENDに記載。
const MUTATOR_LEGEND = [
  { key:'tier',   label:'技強化',     desc:'全員技tier2スタート(技強化チケット使用済みならtier3)' },
  { key:'spawn',  label:'アイテムUP', desc:'スポーンアイテム数1.5倍' },
  { key:'reward', label:'報酬UP',     desc:'試合報酬(ゴールド・ダイヤ・経験値)2倍' },
];
function mutatorBadgeLabels(m){
  if(!m) return [];
  const out = [];
  if(m.tier) out.push('技強化');
  if(m.spawn) out.push('アイテムUP');
  if(m.reward) out.push('報酬UP');
  return out;
}
/* シーズン1のSPパス報酬は SEASON_REWARDS が正。準備中に使っていた
   SEASON1_REWARDS_PREVIEW は同じ内容を二重に持っていたので廃止した
   (管理者プレビューも SEASON_REWARDS を見る)。 */

/* =====================================================================
   シーズンパス: 試合でシーズンポイント(SP)を貯めて段階報酬を受け取る(全て無料)
===================================================================== */
const SEASON_STORAGE_KEY = 'aramon_season_v1';
const SEASON_ID = 's1';               // シーズン識別子
/* SPと受取状況をリセットしたいときに1つ上げる(シーズンの途中でも効く)。
   シーズンの切り替わり(SEASON_IDの変更)でも同じようにリセットされる。
   判定は保存側の seasonId と seasonStateKey() の食い違いを見るだけなので、
   どちらを変えても次にloadSeasonを通った時点でSP0・受取状況なしから始まる。 */
const SEASON_RESET_EPOCH = 2;         // 2026-08-07 シーズン1公開に合わせて全員リセット
function seasonStateKey(){ return SEASON_ID + '#' + SEASON_RESET_EPOCH; }
const SEASON_SP_PER_TIER = 120;       // 1段階に必要なSP
const SEASON_MAX_TIER = 25;
// 各段階の報酬(1段階目=index0)。5の倍数はダイヤの節目報酬。
// ゴールドは100から始めて100単位で上がっていき、最後のゴールド報酬(24段階目)が1000になる。
const SEASON_REWARDS = [
  { gold:100 }, { gold:200 }, { item:'freeTrainTicket', n:1 }, { gold:300 }, { dia:15 },      // 1-5
  { gold:300 }, { gold:400 }, { item:'seed_power', n:1 }, { gold:400 }, { dia:25 },           // 6-10
  { gold:500 }, { item:'moveTicket', n:1 }, { gold:500 }, { gold:600 }, { dia:30 },           // 11-15
  { gold:600 }, { item:'freeTrainTicket', n:1 }, { gold:700 }, { gold:700 }, { dia:40 },      // 16-20
  { gold:800 }, { item:'seed_vitality', n:1 }, { gold:900 }, { gold:1000 }, { skin:'aqua_ssr' }, // 21-25(最終=限定SSRスキン「大喰いの利世」)
];
// 1試合で得られるSP(SEASON_SP_GLOBAL_MULTで全体倍率を調整)
const SEASON_SP_GLOBAL_MULT = 2;
function seasonSpForMatch(kills, damage, isWin){
  return (10 + (kills||0)*5 + (isWin?30:0) + Math.floor((damage||0)/100)) * SEASON_SP_GLOBAL_MULT;
}
function seasonTierForSp(sp){ return Math.max(0, Math.min(SEASON_MAX_TIER, Math.floor((sp||0)/SEASON_SP_PER_TIER))); }
function loadSeason(){
  const key = seasonStateKey();
  const fresh = ()=>({ seasonId:key, sp:0, claimed:{} });
  try{
    const s = JSON.parse(localStorage.getItem(SEASON_STORAGE_KEY)) || {};
    // シーズンが切り替わった/リセットしたときはSPも受取状況も引き継がない
    if(s.seasonId !== key) return fresh();
    return { seasonId:key, sp:Math.max(0, s.sp||0), claimed:s.claimed||{} };
  }catch(err){ return fresh(); }
}
function saveSeason(s){
  try{ localStorage.setItem(SEASON_STORAGE_KEY, JSON.stringify(s)); }catch(err){}
  if(typeof accountMarkDirty==='function') accountMarkDirty();
}

const TITLES_STORAGE_KEY = 'aramon_titles_v1';
const TITLE_EQUIP_MAX = 3; // 装着できる称号の最大数
function loadTitles(){
  try{
    const t = JSON.parse(localStorage.getItem(TITLES_STORAGE_KEY)) || {};
    let eq = t.equipped;
    if(typeof eq==='string') eq = eq ? [eq] : []; // 旧形式(単一)を配列へ移行
    if(!Array.isArray(eq)) eq = [];
    eq = eq.filter(id=>TITLES_BY_ID[id]).slice(0, TITLE_EQUIP_MAX);
    return { unlocked: t.unlocked||{}, equipped: eq };
  }catch(err){ return { unlocked:{}, equipped:[] }; }
}
function saveTitles(t){
  try{ localStorage.setItem(TITLES_STORAGE_KEY, JSON.stringify(t)); }catch(err){}
  if(typeof accountMarkDirty==='function') accountMarkDirty();
}

// 試合報酬(経験値と一緒に入手)
const GOLD_MATCH_BASE = 20;      // 参加報酬
const GOLD_PER_KILL = 10;        // キルごと
const GOLD_CHAMPION_BONUS = 50;  // チャンピオンボーナス
const GOLD_MULTI_MULT = 2;       // マルチプレイはゴールド2倍
const DIA_MATCH_BASE = 5;        // 参加報酬(従来の5倍)
const DIA_CHAMPION_BONUS = 10;   // チャンピオンボーナス(従来の5倍)

/* レイド限定アイテムのアイコン(SVG)。
   絵文字だと「実」と見分けが付かず、貴重さも伝わらないので専用の絵にする。
   複数個が同時に画面へ出る(バッグの一覧・説明・ガチャ・報酬行)ので、
   defs/gradientのidが衝突しないよう、塗りは重ね塗りだけで作りidを一切使わない。 */
const ITEM_ICON_FRUIT_LIFE = `<svg class="pi-svg" viewBox="0 0 40 40" aria-hidden="true">
  <circle cx="20" cy="23.5" r="13" fill="#7d1220"/>
  <ellipse cx="15.5" cy="19.5" rx="6" ry="7" fill="#c2263a" opacity=".85"/>
  <ellipse cx="20" cy="24" rx="6.2" ry="5.4" fill="#ff8a6a" opacity=".45"/>
  <ellipse cx="20" cy="24" rx="3.4" ry="3" fill="#ffe9a8" opacity=".9"/>
  <ellipse cx="14.6" cy="18" rx="2.6" ry="3.4" fill="#ffd7c8" opacity=".6"/>
  <circle cx="20" cy="23.5" r="13" fill="none" stroke="#ffd76a" stroke-width="2"/>
  <path d="M20 11.5q0-4.5 3-6.5" stroke="#c98a3a" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <path d="M21.5 8.5q6-3.5 8.5 1q-5.5 3.5-8.5-1z" fill="#5fe07c"/>
  <path d="M33 7l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" fill="#ffe9a8"/>
  <path d="M6.5 13l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4L3.2 16.3l2.4-.9z" fill="#ffd76a" opacity=".9"/>
</svg>`;
const ITEM_ICON_ACCEL = `<svg class="pi-svg" viewBox="0 0 40 40" aria-hidden="true">
  <path d="M16.5 9.5h7v5l5.6 12.2A4.8 4.8 0 0 1 24.7 33.5h-9.4a4.8 4.8 0 0 1-4.4-6.8L16.5 14.5z" fill="#10131a" opacity=".5"/>
  <path d="M13 23.5h14l2.4 5.2a4 4 0 0 1-3.6 5.6H14.2a4 4 0 0 1-3.6-5.6z" fill="#3fd8ff"/>
  <ellipse cx="20" cy="27" rx="5.8" ry="1.9" fill="#c8f6ff" opacity=".7"/>
  <circle cx="16.4" cy="30.2" r="1.5" fill="#eafcff" opacity=".8"/>
  <circle cx="23.2" cy="30.8" r="1" fill="#eafcff" opacity=".7"/>
  <path d="M16.5 9.5h7v5l5.6 12.2A4.8 4.8 0 0 1 24.7 33.5h-9.4a4.8 4.8 0 0 1-4.4-6.8L16.5 14.5z" fill="none" stroke="#ffd76a" stroke-width="2"/>
  <rect x="14.6" y="4.2" width="10.8" height="5" rx="1.8" fill="#ffd76a"/>
  <rect x="16.4" y="1.8" width="7.2" height="3" rx="1.5" fill="#ffe9a8"/>
  <path d="M31.5 14h5.5M30 18.5h4.5" stroke="#8fe6ff" stroke-width="2" stroke-linecap="round"/>
  <path d="M5.5 11l.9 2.5 2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9z" fill="#ffe9a8"/>
</svg>`;

// プレイヤーアイテム(主にマスモンに使う)
const STAT_SEED_GAIN = 5; // 「実」1個で上がるステータス量
const BASE_ITEM_GAIN = 5; // 基礎値アイテム1個で上がる種族基礎値(上限なし)
const PLAYER_ITEMS = {
  // レイド限定。育成のステータスではなく「種族の基礎値」そのものを底上げする(上限なし)
  fruit_life:     { name:'生命の果実', icon:ITEM_ICON_FRUIT_LIFE, base:'hp',    rarity:'SSR' },
  accel_elixir:   { name:'加速剤',     icon:ITEM_ICON_ACCEL,      base:'speed', rarity:'SSR' },
  seed_life:      { name:'ライフの実',   icon:'🍎', stat:'life' },
  seed_power:     { name:'ちからの実',   icon:'💪', stat:'power' },
  seed_wisdom:    { name:'かしこさの実', icon:'🧠', stat:'wisdom' },
  seed_accuracy:  { name:'命中の実',     icon:'🎯', stat:'accuracy' },
  seed_evasion:   { name:'回避の実',     icon:'💨', stat:'evasion' },
  seed_vitality:  { name:'丈夫さの実',   icon:'🛡️', stat:'vitality' },
  freeTrainTicket:{ name:'フリートレーニングチケット', icon:'🎟️', desc:'マスモンのトレーニングチケット+1' },
  moveTicket:     { name:'技強化チケット', icon:'⚔️', desc:'次の試合を技tier2解放状態で開始' },
};
// 基礎値アイテムが上げるもののラベル(説明文と効果表示で同じ言葉を使う)
const BASE_ITEM_LABEL = { hp:'ライフの基礎値', speed:'移動速度の基礎値' };
function playerItemDesc(key){
  const it = PLAYER_ITEMS[key];
  if(!it) return '';
  if(it.stat){
    const s = MASTERMON_STATS.find(x=>x.key===it.stat);
    return `マスモンの${s.label}+${STAT_SEED_GAIN}`;
  }
  // 基礎値は上限が無く、育成の倍率が乗る前に足されるので伸びるほど効く
  if(it.base) return `マスモンの${BASE_ITEM_LABEL[it.base]}+${BASE_ITEM_GAIN}(上限なし)`;
  return it.desc;
}
// アイコンはSVGのこともあるのでHTMLとして扱う(textContentに入れると生タグが出る)
function playerItemIconHtml(key){
  const it = PLAYER_ITEMS[key];
  return it ? it.icon : '';
}
function playerItemIconIsSvg(key){
  const it = PLAYER_ITEMS[key];
  return !!it && typeof it.icon==='string' && it.icon.charAt(0)==='<';
}
// トーストやtextContentなど「文字しか置けない場所」用。SVGアイコンのアイテムは名前で代用する
function playerItemTextLabel(key, n){
  const it = PLAYER_ITEMS[key];
  if(!it) return '';
  return playerItemIconIsSvg(key) ? `${it.name}×${n||1}` : `${it.icon}×${n||1}`;
}

// ガチャ(ダイヤ専用)
const GACHA_COST_DIA_SINGLE = 5;  // 単発ガチャ
const GACHA_COST_DIA_TEN = 50;    // 10連ガチャ

/* =====================================================================
   レアリティ・スキン(着せ替え)システム
   N ノーマル(茶) = 各ステータスの実 / R レア(銀) = チケット類 /
   SR スーパーレア(金) = 各モンスターの色違いスキン /
   SSR スペシャルスーパーレア(虹) = 特別スキン(ヒノトリ「フェニックス」)
===================================================================== */
const RARITIES = {
  N:   { label:'N',   jp:'ノーマル',          color:'#b07a4f', rate:58 },
  R:   { label:'R',   jp:'レア',              color:'#c9ccd6', rate:30 },
  SR:  { label:'SR',  jp:'スーパーレア',       color:'#ffcf3f', rate:10 },
  SSR: { label:'SSR', jp:'スペシャルスーパーレア', color:'rainbow', rate:2 }, // 内訳: 轟金剛1% + 他SSR合算1%(pickGachaSsrSkinId)
};
// 10連ガチャの10連目(SR以上確定枠)の内訳
const GUARANTEED_SLOT_RATES = { SR:90, SSR:10 };
const RARITY_ORDER = ['N','R','SR','SSR'];
// 色違いスキンの6色(黒白赤青黄緑)。各モンスターは元色に最も近い1色を除いた5色を持つ
const SKIN_COLORS = {
  black:  { jp:'ブラック', hex:'#2b2b30', ref:[26,26,30] },
  white:  { jp:'ホワイト', hex:'#eef0f4', ref:[240,240,244] },
  red:    { jp:'レッド',   hex:'#e0453a', ref:[224,69,58] },
  blue:   { jp:'ブルー',   hex:'#3f74e6', ref:[63,116,230] },
  yellow: { jp:'イエロー', hex:'#f2c31e', ref:[242,195,30] },
  green:  { jp:'グリーン', hex:'#48b84e', ref:[72,184,78] },
};
const SKIN_COLOR_ORDER = ['black','white','red','blue','yellow','green'];
// 色相ではなく明度で主要部を判定する(無彩色寄りの)モンスター
const SKIN_ACHROMATIC = { illumine:'dark', ark:'light', fox:'light' };

function hexToRgb(h){ return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }
function rgbToHsl(r,g,b){
  r/=255; g/=255; b/=255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b); let h,s,l=(mx+mn)/2;
  if(mx===mn){ h=s=0; }
  else { const d=mx-mn; s=l>0.5?d/(2-mx-mn):d/(mx+mn);
    switch(mx){ case r:h=(g-b)/d+(g<b?6:0);break; case g:h=(b-r)/d+2;break; default:h=(r-g)/d+4; } h/=6; }
  return [h*360, s, l];
}
function hslToRgb(h,s,l){
  h/=360; function hue(p,q,t){ if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; }
  let r,g,b; if(s===0){ r=g=b=l; } else { const q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q; r=hue(p,q,h+1/3); g=hue(p,q,h); b=hue(p,q,h-1/3); }
  return [r*255, g*255, b*255];
}
const SKIN_TARGET_HUE = { red:0, yellow:52, green:120, blue:215 };
// モンスターごとのスキン設定:
//  colors = 持てる5色 / source = 色置換する主要部(color相 or 明度タイプ)
//  source.type: 'chroma'(hue付近の色相を置換) / 'light'(白い部分) / 'dark'(暗い部分)
const SKIN_CONFIG = {
  mocchi:  { colors:['black','white','blue','yellow','green'], source:{type:'chroma', hue:332, window:60} }, // ピンクの部分
  suezo:   { colors:['black','white','red','blue','green'],    source:{type:'chroma', hue:50,  window:55} }, // 黄の部分
  phoenix: { colors:['black','white','blue','yellow','green'], source:{type:'chroma', hue:20,  window:60} }, // 赤〜橙の部分
  fire:    { colors:['black','white','blue','yellow','green'], source:{type:'chroma', hue:16,  window:72} }, // 赤い部分
  aqua:    { colors:['black','white','red','yellow','green'],  source:{type:'chroma', hue:198, window:95} }, // 青い部分
  leaf:    { colors:['black','white','red','blue','yellow'],   source:{type:'chroma', hue:90,  window:88} }, // 緑の部分
  spark:   { colors:['black','white','red','yellow','green'],  source:{type:'chroma', hue:210, window:85} }, // 青い部分
  rock:    { colors:['white','red','blue','yellow','green'],   source:{type:'chroma', hue:31,  window:50} }, // 茶色の部分
  ark:     { colors:['black','red','blue','yellow','white'],   source:{type:'chroma', hue:110, window:95} }, // 緑の部分
  warm:    { colors:['black','white','red','blue','green'],    source:{type:'chroma', hue:30,  window:45} }, // 茶色い部分
  illumine:{ colors:['white','red','blue','yellow','green'],   source:{type:'chroma', hue:272, window:55} }, // 紫の部分
  fox:     { colors:['black','red','blue','yellow','green'],   source:{type:'light'} },                       // 白い部分
  god:     { colors:['black','red','blue','yellow','green'],   source:{type:'light'} },                       // 白いローブ部分
  zan:     { colors:['white','red','blue','yellow','green'],   source:{type:'chroma', hue:238, window:95} },   // メインのグレー(青みがかった)ボディ部分
  pixie:   { colors:['black','white','blue','yellow','green'], source:{type:'chroma', hue:349, window:50} },   // 赤い部分
  dullahan:{ colors:['black','red','blue','yellow','green'], source:{type:'chroma', hue:30, window:60} }, /*@dullahan*/
  // <<AUTO:SKIN_CONFIG>> ここから上へ tools/monster_add.py が新モンスターの行を追記する
};
// 各モンスターが持てる色スキン(5色)
function monsterSkinColors(elementKey){
  const cfg = SKIN_CONFIG[elementKey];
  return (cfg && cfg.colors) ? cfg.colors.slice() : SKIN_COLOR_ORDER.slice(0,5);
}
// 色置換用の主要部情報(色相 or 明度タイプ + 色相許容幅)
function monsterMainInfo(elementKey){
  const cfg = SKIN_CONFIG[elementKey];
  if(cfg && cfg.source){ const s=cfg.source; return { type:s.type, hue:s.hue||0, window:s.window||55 }; }
  const [h] = rgbToHsl(...hexToRgb(ELEMENTS[elementKey].color));
  return { type:'chroma', hue:h, window:55 };
}

// SSRスキン定義(skinId -> 情報)
const SSR_SKINS = {
  phoenix_ssr: { element:'phoenix', name:'フェニックス', iconImg:'phoenix_ssr', playerImg:'phoenix_player_ssr' },
  tamamo_ssr:  { element:'fox', name:'タマモノマエ', iconImg:'tamamo_ssr', playerImg:'tamamo_player_ssr' },
  iblees_ssr:  { element:'ark', name:'イブリース', iconImg:'iblees_ssr', playerImg:'iblees_player_ssr' },
  // ラガモッチー: シーズンパス最終報酬限定のオリジナルSSR(ガチャ・カタログには出さない)
  mocchi_ssr:  { element:'mocchi', name:'ラガモッチー', iconImg:'mocchi_ssr', playerImg:'mocchi_player_ssr', seasonExclusive:true },
  // ゼウス: ガリのオリジナルSSR。ガチャ・SSRカタログにも出る(seasonExclusiveは付けない)
  zeus_ssr:    { element:'god', name:'ゼウス', iconImg:'zeus_ssr', playerImg:'zeus_player_ssr' },
  // ちょこ: ピクシーのオリジナルSSR。ガチャ・SSRカタログにも出る
  choco_ssr:   { element:'pixie', name:'ちょこ', iconImg:'choco_ssr', playerImg:'choco_player_ssr' },
  // ペルセポネ: イルミネのオリジナルSSR。ガチャ・SSRカタログにも出る
  persephone_ssr: { element:'illumine', name:'ペルセポネ', iconImg:'persephone_ssr', playerImg:'persephone_player_ssr' },
  rock_ssr:       { element:'rock', name:'轟金剛', iconImg:'rock_ssr', playerImg:'rock_player_ssr' }, /*@rock_ssr*/
  aqua_ssr:       { element:'aqua', name:'大喰いの利世', iconImg:'aqua_ssr', playerImg:'aqua_player_ssr', seasonExclusive:true }, /*@aqua_ssr*/
  // 狂戦士ガッツ: レイドガチャ限定。スキンガチャとSSRカタログには出さない(レイドSSRカタログには出る)
  guts_ssr:       { element:'dullahan', name:'狂戦士ガッツ', iconImg:'guts_ssr', playerImg:'guts_player_ssr', raidGachaOnly:true }, /*@guts_ssr*/
  // 不死のゾッド: レイド討伐達成の報酬限定。どのガチャ・どのカタログにも出さない
  zod_ssr:        { element:'fire', name:'不死のゾッド', iconImg:'zod_ssr', playerImg:'zod_player_ssr', raidClearOnly:true }, /*@zod_ssr*/
  // <<AUTO:SSR_SKINS>> ここから上へ tools/studio_web.html が新しいSSRスキンの行を追記する
};

/* ===== SSRスキン専用メディア(昇格演出・試合中BGM・専用SE・宣伝画像) =====
   スキン1体ぶんの「音と映像」をこの表だけで持つ。ここに1行足せば
     ・ガチャの昇格演出(無音の動画 + 別ファイルの音声)
     ・そのスキンを装備している試合中のBGM3曲(残り6人以上 / 5人以下 / 2人)
     ・専用SE4種(tier3技 / 被弾 / キル / 勝利)
     ・ガチャ画面とロビーのポップアップに出す宣伝画像
   がすべて有効になる(audio.js / combat.js / ui.js はこの表しか見ない)。
   モンスター作成スタジオの「SSRスキン専用」から追記・差し替えされる。

   promote.video は拡張子を書かない(.mp4 と .webm の両方を試す)。動画は音無しで、
   音声は promote.audio を Web Audio 側で同時再生する(音付き動画はiOSで自動再生が
   止められることがあるため)。bgmOnReveal は獲得画面で流す自分のBGM区分。   */
const SKIN_MEDIA = {
  rock_ssr: { /*@rock_ssr*/
    promote: { video:'video/rock_promote', audio:'audio/rock_promote_audio.mp3',
               safetyMs:23000, bgmOnReveal:'lastBattle' },
    bgm: { battle:'audio/bgm_gokongo_battle.mp3', final5:'audio/bgm_gokongo_final5.mp3',
           lastBattle:'audio/bgm_gokongo_lastbattle.mp3' },
    promoImg: 'images/promo_rock_ssr.jpeg',
  },
  aqua_ssr: { /*@aqua_ssr*/
    promote: { video:'video/aqua_promote', audio:'audio/aqua_promote_audio.mp3', safetyMs:17000 },
    bgm: { battle:'audio/bgm_aqua_battle.mp3', final5:'audio/bgm_aqua_final5.mp3',
           lastBattle:'audio/bgm_aqua_lastbattle.mp3' },
  },
  guts_ssr: { /*@guts_ssr*/
    promote: { video:'video/guts_ssr_promote', audio:'audio/guts_ssr_promote_audio.m4a', safetyMs:25397, bgmOnReveal:'lastBattle' },
    bgm: { battle:'audio/bgm_guts_ssr_battle.m4a', final5:'audio/bgm_guts_ssr_final5.m4a', lastBattle:'audio/bgm_guts_ssr_lastbattle.m4a' },
    se: { tier3:'audio/se_guts_ssr_tier3.m4a', hit:'audio/se_guts_ssr_hit.m4a', kill:'audio/se_guts_ssr_kill.m4a', win:'audio/se_guts_ssr_win.m4a' },
    promoImg: 'images/promo_guts_ssr.png',
  },
  // 専用BGMは狂戦士ガッツと同じ曲をそのまま指定(音源を複製せず、同じファイルを指す)
  zod_ssr: { /*@zod_ssr*/
    bgm: { battle:'audio/bgm_guts_ssr_battle.m4a', final5:'audio/bgm_guts_ssr_final5.m4a', lastBattle:'audio/bgm_guts_ssr_lastbattle.m4a' },
    se: { tier3:'audio/se_zod_ssr_tier3.mp3' },
  },
  // <<AUTO:SKIN_MEDIA>> ここから上へ tools/studio_web.html がSSRスキン専用メディアの行を追記する
};
// 専用SEの区分と、そのスキンに専用SEが無いときに鳴る既存のSE名
const SKIN_SE_SLOTS = { tier3:'技(tier3)', hit:'被弾', kill:'キル', win:'勝利' };
const SKIN_BGM_SLOTS = { battle:'残り6人以上', final5:'残り5人以下', lastBattle:'残り2人' };
function skinMediaOf(skinId){ return (skinId && SKIN_MEDIA[skinId]) || null; }

// skinId 体系: 色スキン = "element:colorId" / SSRスキン = SSR_SKINSのキー
// SSRスキンの画像を SSR_SKINS から自動で読み込む。
// 【重要】以前はスキンIDを手書きで並べた表だったため、新しいSSRを足したときにここへの
// 追記を忘れると「カタログ・バッグのスキン欄・着せ替え画面・装備時の見た目に反映されない」
// (画像が null になり素のモンスターや✨にフォールバックする)という不具合になった。
// 実際にペルセポネで発生したので、SSR_SKINS を唯一の登録先にして取りこぼしを防いでいる。
Object.keys(SSR_SKINS).forEach(id=>{
  const s = SSR_SKINS[id];
  [s.iconImg, s.playerImg].forEach(name=>{
    if(name && !ssrSkinImages[name]) ssrSkinImages[name] = loadMonsterImage(`monsters/${name}`);
  });
});

function colorSkinId(element, colorId){ return `${element}:${colorId}`; }
function skinMeta(skinId){
  if(SSR_SKINS[skinId]){
    const s=SSR_SKINS[skinId];
    return { skinId, rarity:'SSR', kind:'ssr', element:s.element, name:s.name };
  }
  const [element, colorId] = skinId.split(':');
  return { skinId, rarity:'SR', kind:'color', element, colorId,
           name:`${ELEMENTS[element].label} ${SKIN_COLORS[colorId] ? SKIN_COLORS[colorId].jp : colorId}` };
}
function allColorSkinIds(){
  const out=[]; for(const el of Object.keys(ELEMENTS)) for(const c of monsterSkinColors(el)) out.push(colorSkinId(el,c)); return out;
}
function allSsrSkinIds(){ return Object.keys(SSR_SKINS); }
/* SSRスキンの入手経路は3つの印で決まる(印が無ければ「どこでも出る」)。
     seasonExclusive : シーズンパス報酬限定。ガチャにもカタログにも出さない
     raidClearOnly   : レイド討伐達成の報酬限定。どのガチャ・どのカタログにも出さない
     raidGachaOnly   : レイドガチャ限定。スキンガチャとSSRカタログには出さず、
                       レイドガチャとレイドSSRカタログにだけ出す
   一覧を作るときは必ず下の2つの関数を通す(印を直接読む場所を増やさない)。 */
// スキンガチャ・SSRスキンカタログに出るSSR
function gachaSsrSkinIds(){
  return Object.keys(SSR_SKINS).filter(id=>{
    const s = SSR_SKINS[id];
    return !s.seasonExclusive && !s.raidClearOnly && !s.raidGachaOnly;
  });
}
// レイドガチャ・レイドSSRスキンカタログに出るSSR(シーズンパス報酬と討伐報酬だけを除く)
function raidGachaSsrSkinIds(){
  return Object.keys(SSR_SKINS).filter(id=>{
    const s = SSR_SKINS[id];
    return !s.seasonExclusive && !s.raidClearOnly;
  });
}

// ガチャのレアリティ別アイテム
const GACHA_N_ITEMS = ['seed_life','seed_power','seed_wisdom','seed_accuracy','seed_evasion','seed_vitality'];
const GACHA_R_ITEMS = ['freeTrainTicket','moveTicket'];
const DUP_SKIN_DIA = 5;     // 既に持っているSRスキンが出た時に貰えるダイヤ
const DUP_SSR_DIA = 50;     // 既に持っているSSRスキンが出た時に貰えるダイヤ

function weightedPickRarity(guaranteedSRplus){
  const entries = guaranteedSRplus ? [['SR',GUARANTEED_SLOT_RATES.SR],['SSR',GUARANTEED_SLOT_RATES.SSR]]
                                    : RARITY_ORDER.map(r=>[r, RARITIES[r].rate]);
  const total = entries.reduce((s,e)=>s+e[1],0);
  let r = Math.random()*total;
  for(const [k,w] of entries){ r-=w; if(r<0) return k; }
  return entries[0][0];
}
// SSR内の内訳抽選(ピックアップ): SSR全体2%のうち、轟金剛が1%・他SSR合算が1%になるよう
// SSR枠に入った時点で五分五分に振り、外れた方は他SSRの中から均等に選ぶ
const GACHA_PICKUP_SSR = 'rock_ssr';
function pickGachaSsrSkinId(){
  const others = gachaSsrSkinIds().filter(id=>id!==GACHA_PICKUP_SSR);
  if(others.length===0) return GACHA_PICKUP_SSR; // 他SSRが無ければ常に轟金剛
  return Math.random()<0.5 ? GACHA_PICKUP_SSR : pickRandom(others);
}
function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
/* ガチャ画面の告知画像。スキンガチャ・レイドガチャそれぞれのピックアップスキンの
   SKIN_MEDIA.promoImg を使う(未登録なら轟金剛の画像のまま)。タイトルの
  「(◯◯ピックアップ)」も同じ定数から作るので、差し替えはこの2つの定数だけで済む。 */
function skinPromoImgUrl(skinId){
  const m = skinMediaOf(skinId);
  return (m && m.promoImg) || null;
}
gachaPickupPromoImg.src = skinPromoImgUrl(GACHA_PICKUP_SSR) || 'images/promo_rock_ssr.jpeg';
const raidGachaPickupPromoImg = loadPromoImage(skinPromoImgUrl(RAID_GACHA_PICKUP));
// ガチャのタブ(スキン/レイド)に応じた告知画像を返す
function gachaPromoImgFor(mode){
  const img = (mode==='raid') ? raidGachaPickupPromoImg : gachaPickupPromoImg;
  return (img && img.loaded && !img.failed) ? img : gachaPickupPromoImg;
}
// 1回分の抽選結果を返す。{rarity, kind:'item'|'skin', key?, skinId?}
function gachaRollOne(guaranteedSRplus){
  const rarity = weightedPickRarity(guaranteedSRplus);
  if(rarity==='N') return { rarity, kind:'item', key: pickRandom(GACHA_N_ITEMS) };
  if(rarity==='R') return { rarity, kind:'item', key: pickRandom(GACHA_R_ITEMS) };
  if(rarity==='SR') return { rarity, kind:'skin', skinId: pickRandom(allColorSkinIds()) };
  return { rarity:'SSR', kind:'skin', skinId: pickGachaSsrSkinId() };
}
// 提供割合表示用: レアリティ別 & アイテム別の割合(%)を算出
function gachaRateTable(){
  const rows = [];
  const perItem = (rarity, n)=> RARITIES[rarity].rate / n;
  // 高いレアリティ順(SSR→SR→R→N)で表示する(シーズン限定SSRはガチャに出ないので除外)
  const ssrIds = gachaSsrSkinIds();
  const otherSsrIds = ssrIds.filter(id=>id!==GACHA_PICKUP_SSR);
  rows.push({ rarity:'SSR', items: ssrIds.map(id=>({
    label: skinMeta(id).name,
    pct: id===GACHA_PICKUP_SSR ? RARITIES.SSR.rate/2 : (otherSsrIds.length ? RARITIES.SSR.rate/2/otherSsrIds.length : 0),
  })) });
  const srIds = allColorSkinIds();
  rows.push({ rarity:'SR', items: srIds.map(id=>({ label: skinMeta(id).name, pct: perItem('SR', srIds.length) })) });
  rows.push({ rarity:'R', items: GACHA_R_ITEMS.map(k=>({ label:`${PLAYER_ITEMS[k].icon} ${PLAYER_ITEMS[k].name}`, pct: perItem('R', GACHA_R_ITEMS.length) })) });
  rows.push({ rarity:'N', items: GACHA_N_ITEMS.map(k=>({ label:`${PLAYER_ITEMS[k].icon} ${PLAYER_ITEMS[k].name}`, pct: perItem('N', GACHA_N_ITEMS.length) })) });
  return rows;
}

// --- スキン所持・装備の保存 ---
const SKIN_STORAGE_KEY = 'aramon_skins_v1';
function loadSkins(){
  try{ const s=JSON.parse(localStorage.getItem(SKIN_STORAGE_KEY))||{}; return { owned:s.owned||{}, equipped:s.equipped||{} }; }
  catch(err){ return { owned:{}, equipped:{} }; }
}
function saveSkins(s){
  try{ localStorage.setItem(SKIN_STORAGE_KEY, JSON.stringify(s)); }catch(err){}
  if(typeof accountMarkDirty==='function') accountMarkDirty();
}
function isSkinOwned(skinId){ return !!loadSkins().owned[skinId]; }
function ownSkin(skinId){ const s=loadSkins(); s.owned[skinId]=true; saveSkins(s); }
// 所持を取り消す(管理者画面の動作確認用)。装備したままだと持っていないスキンを
// 着ている状態になるので、装備からも外す。
function disownSkin(skinId){
  const s = loadSkins();
  delete s.owned[skinId];
  for(const el of Object.keys(s.equipped)) if(s.equipped[el]===skinId) delete s.equipped[el];
  saveSkins(s);
}
function getEquippedSkin(element){ return loadSkins().equipped[element] || null; }
function setEquippedSkin(element, skinId){
  const s=loadSkins();
  if(skinId) s.equipped[element]=skinId; else delete s.equipped[element];
  saveSkins(s);
}
// あるモンスターが所持している全スキン(色スキン+SSR)のskinId一覧
function ownedSkinsForElement(element){
  const owned = loadSkins().owned;
  const out = [];
  for(const c of monsterSkinColors(element)){ const id=colorSkinId(element,c); if(owned[id]) out.push(id); }
  for(const id of allSsrSkinIds()){ if(SSR_SKINS[id].element===element && owned[id]) out.push(id); }
  return out;
}

// --- ガチャ回数カウンター(200回で1周・100でSRカタログ・200でSSRカタログ) ---
const GACHA_COUNT_KEY = 'aramon_gachacount_v1';
const GACHA_SR_CATALOG_AT = 100;
const GACHA_SSR_CATALOG_AT = 200;
function loadGachaCount(){
  try{ const c=JSON.parse(localStorage.getItem(GACHA_COUNT_KEY))||{}; return { count:c.count||0, sr:!!c.sr, ssr:!!c.ssr }; }
  catch(err){ return { count:0, sr:false, ssr:false }; }
}
function saveGachaCount(c){
  try{ localStorage.setItem(GACHA_COUNT_KEY, JSON.stringify(c)); }catch(err){}
  if(typeof accountMarkDirty==='function') accountMarkDirty();
}

/* =====================================================================
   レイドガチャ(スキンガチャと同じ画面で切り替えて引く)

   通常のスキンガチャとの違いは3つだけ。抽選そのものは gachaRollOne を共用し、
   SSR枠に入ったときの中身と、カタログの節目だけを差し替えている。
     ・レイド開催まで引けない(近日公開)
     ・SSR枠はレイド特効スキンのピックアップ(全体2%のうち1%)
     ・累計100連でレイド特効スキンを含むSSRカタログを1枚。100連以降は数えない
   ===================================================================== */
const RAID_GACHA_CATALOG_AT = 100;
const RAID_GACHA_COUNT_KEY = 'aramon_raidgachacount_v1';
// 引けるようになるのはレイド開催と同時(終了後も引けるようにしておく)
function raidGachaOpenNow(){ return RAID_ACTIVE && Date.now() >= raidStartAt().getTime(); }
function loadRaidGachaCount(){
  try{ const c=JSON.parse(localStorage.getItem(RAID_GACHA_COUNT_KEY))||{}; return { count:c.count||0, done:!!c.done }; }
  catch(err){ return { count:0, done:false }; }
}
function saveRaidGachaCount(c){
  try{ localStorage.setItem(RAID_GACHA_COUNT_KEY, JSON.stringify(c)); }catch(err){}
  if(typeof accountMarkDirty==='function') accountMarkDirty();
}
// レイドガチャのSSR枠。ピックアップ(レイド特効)が半分、残りは通常SSRから均等
function pickRaidGachaSsrSkinId(){
  const ids = raidGachaSsrSkinIds();
  const pickup = ids.indexOf(RAID_GACHA_PICKUP)>=0 ? RAID_GACHA_PICKUP : null;
  const others = ids.filter(id=>id!==RAID_GACHA_PICKUP);
  if(!pickup) return others.length ? pickRandom(others) : ids[0];
  if(!others.length) return pickup;
  return Math.random()<0.5 ? pickup : pickRandom(others);
}
// 提供割合表(レイドガチャ版)。SSRの内訳だけ差し替えて、他は通常ガチャと同じ
function raidGachaRateTable(){
  const rows = gachaRateTable();
  const ssrRow = rows.find(r=>r.rarity==='SSR');
  if(ssrRow){
    const ids = raidGachaSsrSkinIds();
    const others = ids.filter(id=>id!==RAID_GACHA_PICKUP);
    ssrRow.items = ids.map(id=>({
      label: skinMeta(id).name + (id===RAID_GACHA_PICKUP ? '(ピックアップ)' : ''),
      pct: id===RAID_GACHA_PICKUP ? RARITIES.SSR.rate/2 : (others.length ? RARITIES.SSR.rate/2/others.length : 0),
    }));
  }
  return rows;
}

/* --- スキンカタログ(選んで貰える引換券) ---
   種類は3つ。中身は catalogSkinIds() 1か所で決める。
     sr      : SRスキン(色違い)
     ssr     : SSRスキン + SRスキン
     raidSsr : レイドガチャ100連の報酬。レイドガチャに出るSSR(狂戦士ガッツを含む)+ 全SRスキン */
const CATALOG_STORAGE_KEY = 'aramon_catalogs_v1';
const CATALOG_KINDS = ['sr', 'ssr', 'raidSsr'];
// 画面に出す名前。ボタン・節目の説明・獲得メッセージで同じ言葉を使う
const CATALOG_LABEL = { sr:'SRスキンカタログ', ssr:'SSRスキンカタログ', raidSsr:'SSRレイドカタログ' };
function loadCatalogs(){
  try{
    const c=JSON.parse(localStorage.getItem(CATALOG_STORAGE_KEY))||{};
    return { sr:c.sr||0, ssr:c.ssr||0, raidSsr:c.raidSsr||0 };
  }
  catch(err){ return { sr:0, ssr:0, raidSsr:0 }; }
}
// カタログで選べるスキンの一覧
function catalogSkinIds(kind){
  if(kind==='raidSsr') return [...raidGachaSsrSkinIds(), ...allColorSkinIds()];
  if(kind==='ssr')     return [...gachaSsrSkinIds(), ...allColorSkinIds()];
  return allColorSkinIds();
}
function catalogTitle(kind){
  if(kind==='raidSsr') return 'SSR/SRスキンを選ぶ(レイド)';
  if(kind==='ssr')     return 'SSR/SRスキンを選ぶ';
  return 'SRスキン(色違い)を選ぶ';
}
function saveCatalogs(c){
  try{ localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(c)); }catch(err){}
  if(typeof accountMarkDirty==='function') accountMarkDirty();
}
function addCatalog(kind, n){ const c=loadCatalogs(); c[kind]=(c[kind]||0)+(n||1); saveCatalogs(c); }

// ショップ(ゴールドでアイテム購入): [アイテムキー, 価格] ※スキンはショップには追加しない
const SHOP_ITEMS = [
  ['seed_life',300],['seed_power',300],['seed_wisdom',300],['seed_accuracy',300],['seed_evasion',300],['seed_vitality',300],
  ['freeTrainTicket',1000],['moveTicket',1000],
];

/* =====================================================================
   GAME STATE
===================================================================== */
