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

/* ===== チーム戦(将来の3人1組×20チーム=60体まで拡張できる土台)のバランス定数 =====
   個人戦(game.teamSize===1)ではどれも読まれない。判定の入口は combat.js の isTeamMatch() 1つ。
   数値は発注者が実機で反復調整する前提の名前付き定数。 */
const TEAM_SPAWN_SPREAD        = 80;   // 同チームのスポーンをアンカーからどれだけ離すか(隣接スポーン)
const TEAM_FOLLOW_DIST         = 200;  // botがリーダーへ寄り直す距離(これ以上離れたら追従)
const TEAM_REVIVE_RADIUS       = 80;   // 蘇生できる距離(この半径内にとどまると進む)
const TEAM_REVIVE_SEC          = 2.5;  // 蘇生に必要なとどまり時間(秒)
const TEAM_DOWN_BLEED_SEC      = 30;   // ダウンから出血死までの時間(秒)
const TEAM_DOWN_SPEED_MULT     = 0.1;  // ダウン中の移動速度倍率(這い移動。通常の10%・発注者決定 2026-08-14)
const TEAM_DOWN_DMG_TAKEN_MULT = 1.5;  // ダウン中の被ダメ倍率
const TEAM_DOWN_INVULN_SEC     = 2;    // ダウン直後の無敵時間(秒)。この間はとどめを刺せない(発注者要望 2026-08-19)
const TEAM_DOWN_HP_RATIO       = 0.3;  // ダウンした瞬間に残すHP(最大HP比。とどめ用の体力。0にしない=HPバーが空にならない)
const TEAM_REVIVE_HP_RATIO     = 0.4;  // 蘇生で戻るHP(最大HP比)
const TEAM_BOT_REVIVE_SEEK_RANGE = 1600; // botが蘇生に向かうダウン味方の探索距離

/* チーム戦(20チームバトロワ)の編成。ロビーのサブ選択(ui.js)と試合の組み立て(ui.js/network.js)が
   両方ここを読む(同じ意味の数字を2か所に書かない)。 */
const TEAM_BR_SQUAD_SIZE = 3;   // 1チームの人数(3人1組。マルチ部屋の定員=人間1小隊もこの値)
const TEAM_BR_TEAM_COUNT = 20;  // 20チームバトロワのチーム数(総勢 3×20=60体)

/* ===== バトルアリーナ(1チームvs1チーム・3v3=6体・1本勝負)のバランス定数 =====
   個人戦・通常のチーム戦では読まれない。判定の入口は game.arena 1つ(combat.js)。
   数値は発注者が実機で反復調整する前提の名前付き定数。 */
const ARENA_TEAM_SIZE       = 3;    // 1チームの人数(3v3)
const ARENA_ZONE_RADIUS     = 1200; // 開始時の安置半径(既存マップの中央に固定)
const ARENA_ZONE_END_RADIUS = 350;  // 1段階の縮小後の決着圏の半径
const ARENA_ZONE_HOLD_SEC   = 20;   // 縮小を始めるまでの待機(秒)
const ARENA_ZONE_SHRINK_SEC = 60;   // 縮小にかける時間(秒)。1段階だけゆっくり
const ARENA_ZONE_DPS        = 10;   // 安置外ダメージ(通常の序盤より高め=逃げ回り防止)
const ARENA_SPAWN_GAP       = 600;  // 両チームのスポーンアンカー間の距離(安置中心を挟んで対面)
const ARENA_LOOT_COUNT      = 14;   // 開始時に撒くアイテム数(少数。探す時間より交戦を優先)
const ARENA_LOOT_SPREAD     = 0.6;  // アイテムを撒く中央帯の広さ(安置半径に対する比)
const ARENA_TIME_LIMIT      = 180;  // 試合時間の上限(秒)。超えたら生存数(同数ならHP合計)で勝敗
const GOLD_ARENA_MULT       = 0.6;  // アリーナのゴールド報酬倍率(試合が短いぶん少なめ)

/* ===== チーム戦: ピン(シグナル)とキルリーダー(APEX風のチーム体験)の定数 ===== */
const PING_LIFETIME_SEC       = 6;    // ピンの表示時間(秒)。過ぎたら3D世界・ミニマップから消える
const PING_RANGE              = 700;  // 移動ピンを置く距離(照準方向。途中に障害物があればその手前)
const PING_ENEMY_SEARCH_ANGLE = 0.30; // 敵ピンの探索半角(rad≒17°。照準からこの角度以内の敵を対象にする)
const PING_ENEMY_SEARCH_RANGE = 900;  // 敵ピンの探索距離(移動ピンよりやや遠くの敵も指せる)
const PING_UNITS_PER_M        = 10;   // 距離表示の換算(ワールド10単位=1m。表示専用)
const KILL_LEADER_MIN_KILLS   = 2;    // キルリーダーになる最少キル数(1キルで王冠は大げさ)
let worldDensityScale = 1; // 岩・地形装飾の密度倍率(マップ面積縮小に応じてseededGen側で使用)

// マップの規模(ワールドサイズ・安全圏半径)をスケールに応じて再計算する。
// ソロは常にscale=1、マルチはMULTI_MAP_SCALEを使う。試合開始のたびに必ず呼び出すこと。
function applyWorldScale(scale){
  WORLD.w = Math.round(WORLD_BASE_SIZE * scale);
  WORLD.h = Math.round(WORLD_BASE_SIZE * scale);
  ZONE_CENTER0.x = WORLD.w/2;
  ZONE_CENTER0.y = WORLD.h/2;
  ZONE_PHASES = ZONE_PHASES_BASE.map(p=>({...p, holdRadius: Math.round(p.holdRadius*scale)}));
  /* チュートリアルの練習試合だけ、安置の縮小と待ち時間を縮めて2〜3分で決着させる。
     **通常の試合は今までどおり(倍率1)。** 入口の判定は game.tutorialMatch 1つ。 */
  const tutMult = (typeof game !== 'undefined' && game.tutorialMatch) ? TUTORIAL_MATCH.zoneTimeMult : 1;
  if(tutMult !== 1){
    ZONE_PHASES = ZONE_PHASES.map(p=>({
      ...p,
      shrinkTime: Math.round(p.shrinkTime * tutMult),
      // 最終フェーズの holdTime は「終わらせない」ための番人なので縮めない
      holdTime:   p.holdTime > 9999 ? p.holdTime : Math.round(p.holdTime * tutMult),
    }));
  }
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
    realObstacles:[{ type:'rock', w:0.66 }, { type:'deadtree', w:0.22 }, { type:'ruinwall', w:0.12 }],
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
    realObstacles:[{ type:'rock', w:0.52 }, { type:'basalt', w:0.38 }, { type:'ruinwall', w:0.10 }],
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
    realObstacles:[{ type:'snowrock', w:0.54 }, { type:'pine', w:0.34 }, { type:'hut', w:0.12 }],
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
    realObstacles:[{ type:'tree', w:0.44 }, { type:'rock', w:0.24 }, { type:'log', w:0.20 }, { type:'ruinpillar', w:0.12 }],
  },
  toble: {
    key:'toble', label:'トーブル海岸', rockCount:560, decorCount:6800, hasVolcano:false,
    groundColor:'#cdb27a',
    previewIcon:'🌊', previewColors:['#2e6a8a','#c9ad76'],
    desc:'左手に大海、右手から川が流れ込む海岸線。水の中は動きが鈍くなり、アイテムも湧かない。',
    hasSea:true, seaWidthRatio:0.14,
    hasRiver:true, riverCount:5, riverWidth:260,
    rockFlavors:[{ type:'rock', w:0.5 }, { type:'shell', w:0.5 }],
    realObstacles:[{ type:'palm', w:0.32 }, { type:'rock', w:0.30 }, { type:'shell', w:0.26 }, { type:'container', w:0.12 }],
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
    realObstacles:[{ type:'sandrock', w:0.58 }, { type:'cactus', w:0.30 }, { type:'ruinpillar', w:0.12 }],
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
  hum:     { label:'ハム', color:'#e0ad7b', dark:'#86684a', accent:'#e07be0', speed:210, hp:90, trait:'hum' }, /*@hum*/
  ogre:    { label:'キジン', color:'#e0ad7b', dark:'#86684a', speed:185, hp:130, trait:'ogre', dmgDealtMod:1.2 }, /*@ogre*/
  centaur: { label:'ケンタウロス', color:'#7fb236', dark:'#4f6f1f', speed:190, hp:110, trait:'cent' }, /*@centaur*/
  narga:   { label:'ナーガ', color:'#7a2fc6', dark:'#491c77', speed:185, hp:130, trait:'narga' }, /*@narga*/
  joker:   { label:'ジョーカー', color:'#4d1d7c', dark:'#2e114a', accent:'#f5ec00', speed:196, hp:115, trait:'joker', dmgDealtMod:1.2 }, /*@joker*/
  // <<AUTO:ELEMENTS>> ここから上へ tools/monster_add.py が新モンスターの行を追記する
};

/* ===== 試合中の見た目の大きさ調整(drawScale) =====
   横長のドラゴン・ヒノトリ等は当たり判定(radius)は他とほぼ同じなのに、
   絵だけ見ると翼や尻尾に面積を取られて他より小さい存在感になっていた(2026-09-04)。
   render.js の entityDrawScale(e) が下の順で読む(1か所に集約。他で同じ判定を書かない):
     1. 装備中のSSRスキンに SSR_SKINS[skinId].drawScale があればそれ
     2. 無ければ素体 ELEMENTS[属性].drawScale があればそれ
     3. どちらも無ければ自動 ―― 立ち絵(monsters/<属性>.png or SSRのiconImg)の
        不透明部分の縦横比から算出する(WIDE_DRAW_BOOST/MAX)。歩行コマは折りたたんだ
        翼などで縦長になり毎フレーム比が変わるため使わない(モンスターごとに1回だけ測る)。
   どちらの欄も省略可(書かなければ自動のまま)。**当たり判定(radius)には一切効かない。
   見た目だけの倍率。** 例: ELEMENTS.phoenix に drawScale:1.3 のように追記する。 */
const WIDE_DRAW_BOOST = 0.5;  // 自動倍率: 縦横比(幅/高さ)が1を超えたぶんに掛ける係数
const WIDE_DRAW_MAX   = 1.4;  // 自動倍率の頭打ち(手書きのdrawScaleにはかからない)
/* 体(不透明部分)の高さを 2r × BODY_H_RATIO × drawScale にそろえて描く。
   0.79(歩行コマの体高%実測平均)からいったん決めたが、それだと立ち絵(体が画像いっぱいの
   モンスター、例:岩=旧89%・鬼=旧90%)が**修正前の立ち姿より縮む**劣化になった
   (岩39→35px・鬼33→30px、2026-09-04発注者指摘)。drawScale倍率1(横長でない)のモンスター
   でも「修正前の立ち絵の高さ」を必ず上回るよう実測して0.92まで上げた
   (岩:旧最大39px→新40px / 鬼:旧最大33px→新34〜35px / 雷:旧27px→新30〜31px。
    ヒノトリは元から横長ぶんの倍率が乗るので旧33px→新41〜42pxまで伸びる)。
   歩行時にわずかに大きくなる副作用(数px)は許容 ―― 縮む劣化のほうが問題という発注者判断。 */
const BODY_H_RATIO = 0.92;
// 体の幅がこれ(2r×BODY_W_MAX)を超えたら幅基準へ切り替える(翼を広げた絵が画面を占有しすぎない保険)
const BODY_W_MAX = 1.7;
/* 体(不透明部分)の下端=足を置く画面上の位置(原点からの距離 = radius×この値)。
   歩行スプライトは下の余白がほぼ一律6%だったので、旧描画(画像全体をradius*2の高さに
   合わせていた)での足の実際の位置に合わせてある。ここを変えると全モンスターの
   接地位置が一斉にずれるので、変えたら必ず「地面に足が着いているか」を見比べる。 */
const FOOT_Y_RATIO = 0.88;

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
// ピックアップの定数(GACHA_PICKUP_SSR_IDS / RAID_GACHA_PICKUP_IDS)を読める位置まで src の代入は遅らせる。
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
/* ssr は配列。1つの素体に何体でもSSRの歩行コマを持てる(装備中のskinIdで選ぶ)。
   ここに歩行コマが無いSSRスキンは静止画で表示される(ゲーム側が自動で切り替える)。 */
const WALK_ANIM = {
  mocchi: {
    base: { front:_loadWalk('mocchi_walk_f'),     back:_loadWalk('mocchi_walk_b') },     // 素モッチー(色スキン対応)
    ssr: [
      { skinId:'mocchi_ssr', front:_loadWalk('mocchi_ssr_walk_f'), back:_loadWalk('mocchi_ssr_walk_b') }, // ラガモッチー
    ],
  },
  god: {
    base: { front:_loadWalk('god_walk_f'), back:_loadWalk('god_walk_b') },               // ガリ(色スキン対応)
    ssr: [
      { skinId:'zeus_ssr', front:_loadWalk('zeus_ssr_walk_f'), back:_loadWalk('zeus_ssr_walk_b') }, // SSRゼウス
    ],
  },
  suezo: {
    base: { front:_loadWalk('suezo_walk_f'), back:_loadWalk('suezo_walk_b') },            // スエゾー(色スキン対応)
    ssr: [
      { skinId:'suezo_ssr', front:_loadWalk('suezo_ssr_walk_f'), back:_loadWalk('suezo_ssr_walk_b') }, /*@suezo_ssr*/
    ],
  },
  zan: {
    base: { front:_loadWalk('zan_walk_f'), back:_loadWalk('zan_walk_b') },                // ザン(色スキン対応)
    ssr: [
      { skinId:'zan_ssr', front:_loadWalk('zan_ssr_walk_f'), back:_loadWalk('zan_ssr_walk_b') }, /*@zan_ssr*/
    ],
  },
  fox: {
    base: { front:_loadWalk('fox_walk_f'), back:_loadWalk('fox_walk_b') },                // キュービ(色スキン対応)
    ssr: [
      { skinId:'tamamo_ssr', front:_loadWalk('tamamo_ssr_walk_f'), back:_loadWalk('tamamo_ssr_walk_b') }, // SSRタマモノマエ
    ],
  },
  spark: {
    base: { front:_loadWalk('spark_walk_f'), back:_loadWalk('spark_walk_b') },            // ライガー(色スキン対応)
    ssr: [
      { skinId:'garurumon_ssr', front:_loadWalk('garurumon_ssr_walk_f'), back:_loadWalk('garurumon_ssr_walk_b') }, /*@garurumon_ssr*/
    ],
  },
  phoenix: {
    base: { front:_loadWalk('phoenix_walk_f'),     back:_loadWalk('phoenix_walk_b') },     // ヒノトリ(色スキン対応)
    ssr: [
      { skinId:'phoenix_ssr', front:_loadWalk('phoenix_ssr_walk_f'), back:_loadWalk('phoenix_ssr_walk_b') }, // SSRフェニックス
      { skinId:'ganon_ssr', front:_loadWalk('ganon_ssr_walk_f'), back:_loadWalk('ganon_ssr_walk_b') }, /*@ganon_ssr*/
    ],
  },
  ark: {
    base: { front:_loadWalk('ark_walk_f'), back:_loadWalk('ark_walk_b') },                // アーク(色スキン対応)
    ssr: [
      { skinId:'iblees_ssr', front:_loadWalk('iblees_ssr_walk_f'), back:_loadWalk('iblees_ssr_walk_b') }, // SSRイブリース
    ],
  },
  aqua: {
    base: { front:_loadWalk('aqua_walk_f'), back:_loadWalk('aqua_walk_b') },              // ウンディーネ(色スキン対応)
    ssr: [
      { skinId:'aqua_ssr', front:_loadWalk('aqua_ssr_walk_f'), back:_loadWalk('aqua_ssr_walk_b') }, /*@aqua_ssr*/
    ],
  },
  fire: {
    base: { front:_loadWalk('fire_walk_f'), back:_loadWalk('fire_walk_b') },              // ドラゴン(色スキン対応)
    ssr: [
      { skinId:'zod_ssr', front:_loadWalk('zod_ssr_walk_f'), back:_loadWalk('zod_ssr_walk_b') }, /*@zod_ssr*/
      { skinId:'metag_ssr', front:_loadWalk('metag_ssr_walk_f'), back:_loadWalk('metag_ssr_walk_b') }, /*@metag_ssr*/
    ],
  },
  leaf: {
    base: { front:_loadWalk('leaf_walk_f'), back:_loadWalk('leaf_walk_b') },              // プラント(色スキン対応)
    ssr: [
      { skinId:'leaf_ssr', front:_loadWalk('leaf_ssr_walk_f'), back:_loadWalk('leaf_ssr_walk_b') }, /*@leaf_ssr*/
    ],
  },
  rock: {
    base: { front:_loadWalk('rock_walk_f'), back:_loadWalk('rock_walk_b') },              // ゴーレム(色スキン対応)
    ssr: [
      { skinId:'rock_ssr', front:_loadWalk('rock_ssr_walk_f'), back:_loadWalk('rock_ssr_walk_b') }, /*@rock_ssr*/
    ],
  },
  illumine: {
    base: { front:_loadWalk('illumine_walk_f'), back:_loadWalk('illumine_walk_b') },      // イルミネ(色スキン対応)
    ssr: [
      { skinId:'persephone_ssr', front:_loadWalk('persephone_ssr_walk_f'), back:_loadWalk('persephone_ssr_walk_b') }, // SSRペルセポネ
    ],
  },
  warm: {
    base: { front:_loadWalk('warm_walk_f'), back:_loadWalk('warm_walk_b') },              // ワーム(色スキン対応)
    ssr: [
      { skinId:'warm_ssr', front:_loadWalk('warm_ssr_walk_f'), back:_loadWalk('warm_ssr_walk_b') }, /*@warm_ssr*/
    ],
  },
  pixie: {
    base: { front:_loadWalk('pixie_walk_f'), back:_loadWalk('pixie_walk_b') },            // ピクシー(色スキン対応)
    ssr: [
      { skinId:'choco_ssr', front:_loadWalk('choco_ssr_walk_f'), back:_loadWalk('choco_ssr_walk_b') }, // SSRちょこ
      { skinId:'tsukasa_ssr', front:_loadWalk('tsukasa_ssr_walk_f'), back:_loadWalk('tsukasa_ssr_walk_b') }, /*@tsukasa_ssr*/
    ],
  },
  dullahan:{ /*@dullahan*/
    base: { front:_loadWalk('dullahan_walk_f'), back:_loadWalk('dullahan_walk_b') },
    ssr: [
      { skinId:'guts_ssr', front:_loadWalk('guts_ssr_walk_f'), back:_loadWalk('guts_ssr_walk_b') }, /*@guts_ssr*/
      { skinId:'guts_ssr_awake', front:_loadWalk('guts_ssr_awake_walk_f'), back:_loadWalk('guts_ssr_awake_walk_b') }, /*@guts_ssr_awake*/
    ],
  },
  hum:     { /*@hum*/
    base: { front:_loadWalk('hum_walk_f'), back:_loadWalk('hum_walk_b') },
  },
  ogre:    { /*@ogre*/
    base: { front:_loadWalk('ogre_walk_f'), back:_loadWalk('ogre_walk_b') },
    ssr: [
      { skinId:'satsuki_ssr', front:_loadWalk('satsuki_ssr_walk_f'), back:_loadWalk('satsuki_ssr_walk_b') }, /*@satsuki_ssr*/
      { skinId:'satsuki_ssr_awake', front:_loadWalk('satsuki_ssr_awake_walk_f'), back:_loadWalk('satsuki_ssr_awake_walk_b') }, /*@satsuki_ssr_awake*/
    ],
  },
  centaur: { /*@centaur*/
    base: { front:_loadWalk('centaur_walk_f'), back:_loadWalk('centaur_walk_b') },
    ssr: [
      { skinId:'oki_ssr', front:_loadWalk('oki_ssr_walk_f'), back:_loadWalk('oki_ssr_walk_b') }, /*@oki_ssr*/
    ],
  },
  narga:   { /*@narga*/
    base: { front:_loadWalk('narga_walk_f'), back:_loadWalk('narga_walk_b') },
    ssr: [
      { skinId:'narga_ssr', front:_loadWalk('narga_ssr_walk_f'), back:_loadWalk('narga_ssr_walk_b') }, /*@narga_ssr*/
    ],
  },
  joker:   { /*@joker*/
    base: { front:_loadWalk('joker_walk_f'), back:_loadWalk('joker_walk_b') },
    ssr: [
      { skinId:'joker_ssr', front:_loadWalk('joker_ssr_walk_f'), back:_loadWalk('joker_ssr_walk_b') }, /*@joker_ssr*/
    ],
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
  // 装備中のSSRスキン専用の歩行コマを探す(1素体に何体でも持てる)
  const ssrSet = skin ? (reg.ssr||[]).find(s=>s.skinId===skin) : null;
  const useSsr = !!ssrSet;
  // 歩行コマが用意されていないSSRスキン(例:ガリのゼウス)装備時は静止スキン画像を優先する
  if(skin && skin.indexOf(':')<0 && !useSsr) return null;
  const set = useSsr ? ssrSet : reg.base;
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
  e._walkBack = back;   // 探検で着けた装備を重ねるとき、後ろ姿なら武器を背中の上に描く(explore_loot.js)
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

/* ===== エモート(よろこぶ・しょんぼり等) =====
   **新しい画像を1枚も使わない。** 今表示している絵をそのまま transform で動かすだけなので、
   モンスターを増やしてもSSRスキンを増やしても自動で付く(素材の用意が要らない)。

   動きは**キーフレームの表**で書く。`[時刻, {値}, 補間]` を並べるだけなので、
   手触りの調整は数字を触るだけで済む(関数を書き直さなくてよい)。
     y   … 上下(絵の高さに対する比。マイナスが上)
     sx  … 横の拡縮  /  sy … 縦の拡縮(1が等倍)
     rot … 回転(度)
   **拡縮も回転も「足元」を軸に掛かる**(再生側が transform-origin を 50% 100% にする)。
   だから sy<1 は「しゃがむ/つぶれる」、sy>1 は「伸び上がる」に見え、rot は体が傾いて見える。
   中心を軸にすると宙に浮いたように見えてしまうので、ここは変えないこと。

   補間の指定:
     's'(既定) なめらか / 'out' だんだん遅く(上昇・浮き) / 'in' だんだん速く(落下)
     'lin'     等速     / 'back' 行き過ぎて戻る(バネの反動)

   気持ちよさは**つぶす→伸びる→行き過ぎる**の3拍子で決まる。跳ねる前に必ず一度しゃがみ、
   着地では必ずつぶし、戻るときは少し行き過ぎてから収める。左右対称の正弦波だけだと
   「ただ揺れている」ようにしか見えない(最初の実装がそれで、可愛くないと言われた)。

   増やすときはこの表に1行足すだけでよい(ロビーのボタンも自動で増える)。 */
const EMOTE_EASE = {
  lin: (x)=> x,
  s:   (x)=> x*x*(3-2*x),
  in:  (x)=> x*x,
  out: (x)=> 1-(1-x)*(1-x),
  back:(x)=>{ const c=2.2, y=x-1; return 1 + (c+1)*y*y*y + c*y*y; },
};
function emoteTrack(t, keys){
  let i = 0;
  while(i < keys.length-2 && t >= keys[i+1][0]) i++;
  const a = keys[i], b = keys[i+1] || keys[i];
  const span = (b[0] - a[0]) || 1;
  const k = (EMOTE_EASE[b[2]] || EMOTE_EASE.s)(Math.min(1, Math.max(0, (t-a[0])/span)));
  const mix = (key, dflt)=>{
    const va = a[1][key]==null ? dflt : a[1][key];
    const vb = b[1][key]==null ? dflt : b[1][key];
    return va + (vb-va)*k;
  };
  return { y:mix('y',0), sx:mix('sx',1), sy:mix('sy',1), rot:mix('rot',0) };
}
/* 繰り返すエモートは回を追うごとに小さくする(decay)。同じ大きさで繰り返すと機械的に見える。 */
function emoteMotionAt(def, t, loopIdx){
  const m = emoteTrack(t, def.keys);
  const k = Math.max(0, 1 - (def.decay||0) * (loopIdx||0));
  return { y:m.y*k, sx:1+(m.sx-1)*k, sy:1+(m.sy-1)*k, rot:m.rot*k };
}
const EMOTES = {
  // よろこぶ: しゃがむ→伸び上がる→跳ぶ→着地でつぶれる→反動、を3回だんだん小さく
  joy: {
    label:'よろこぶ', icon:'😊', dur:0.62, loop:3, decay:0.26, se:'emoteJoy', tap:3,
    fx:{ ch:'✨', n:5, mode:'rise', at:0.17, spread:1.15, every:true },
    keys:[
      [0.00, { y:0,     sx:1.00, sy:1.00, rot:0  }],
      [0.15, { y:0,     sx:1.16, sy:0.84, rot:0  }, 'out'],   // ためる(しゃがむ)
      [0.23, { y:-0.04, sx:0.90, sy:1.16, rot:-4 }, 'in'],    // 伸び上がって離陸
      [0.44, { y:-0.30, sx:0.97, sy:1.05, rot:5  }, 'out'],   // 頂点(上りは減速)
      [0.63, { y:-0.02, sx:1.02, sy:0.99, rot:-3 }, 'in'],    // 落下は加速
      [0.71, { y:0,     sx:1.20, sy:0.80, rot:0  }, 'out'],   // 着地でつぶれる
      [0.85, { y:-0.02, sx:0.95, sy:1.07, rot:3  }, 'back'],  // 反動で伸びる
      [1.00, { y:0,     sx:1.00, sy:1.00, rot:0  }, 's'],
    ],
  },
  // しょんぼり: 息を吸う→うなだれて沈む→小さく震える→ゆっくり戻る
  sad: {
    label:'しょんぼり', icon:'😢', dur:1.90, loop:1, se:'emoteSad', tap:1,
    fx:{ ch:'💧', n:3, mode:'fall', at:0.30, spread:0.55, every:true },
    keys:[
      [0.00, { y:0,     sx:1.00, sy:1.00, rot:0  }],
      [0.09, { y:-0.02, sx:0.97, sy:1.05, rot:0  }, 'out'],   // ひと呼吸(ためらい)
      [0.30, { y:0,     sx:1.09, sy:0.87, rot:-7 }, 'in'],    // がっくり沈む
      [0.42, { y:0,     sx:1.08, sy:0.88, rot:-4 }, 's'],     // 小さく震える
      [0.54, { y:0,     sx:1.10, sy:0.86, rot:-8 }, 's'],
      [0.66, { y:0,     sx:1.08, sy:0.88, rot:-5 }, 's'],
      [0.80, { y:0,     sx:1.09, sy:0.87, rot:-7 }, 's'],
      [1.00, { y:0,     sx:1.00, sy:1.00, rot:0  }, 's'],     // ゆっくり戻る
    ],
  },
  // おこる: 沈む→プンッと跳ねる→踏みつけ→小刻みに首を振って収まる
  angry: {
    label:'おこる', icon:'💢', dur:0.95, loop:1, se:'emoteAngry', tap:1,
    fx:{ ch:'💢', n:3, mode:'pop', at:0.12, spread:0.85 },
    keys:[
      [0.00, { y:0,     sx:1.00, sy:1.00, rot:0  }],
      [0.11, { y:0,     sx:1.12, sy:0.88, rot:0  }, 'out'],   // ぐっとためる
      [0.19, { y:-0.11, sx:0.90, sy:1.14, rot:0  }, 'out'],   // プンッと跳ねる
      [0.28, { y:0,     sx:1.18, sy:0.84, rot:0  }, 'in'],    // 踏みつける
      [0.38, { y:0,     sx:0.97, sy:1.04, rot:-11}, 'back'],  // 顔をそむける
      [0.48, { y:0,     sx:1.02, sy:0.99, rot:9  }, 's'],     // 小刻みに首を振る
      [0.58, { y:0,     sx:0.99, sy:1.01, rot:-7 }, 's'],
      [0.68, { y:0,     sx:1.01, sy:1.00, rot:5  }, 's'],
      [0.78, { y:0,     sx:1.00, sy:1.00, rot:-3 }, 's'],
      [1.00, { y:0,     sx:1.00, sy:1.00, rot:0  }, 's'],
    ],
  },
  // だいすき: ゆっくり伸び上がって、体を左右に揺らしながらハートを飛ばす
  love: {
    label:'だいすき', icon:'❤️', dur:1.30, loop:2, decay:0.2, se:'emoteLove', tap:3,
    fx:{ ch:'❤️', n:4, mode:'rise', at:0.16, spread:1.0, every:true },
    keys:[
      [0.00, { y:0,     sx:1.00, sy:1.00, rot:0  }],
      [0.14, { y:0,     sx:1.10, sy:0.90, rot:0  }, 'out'],   // ためる
      [0.28, { y:-0.06, sx:0.94, sy:1.10, rot:0  }, 'back'],  // ふわっと伸び上がる
      [0.46, { y:-0.05, sx:0.97, sy:1.06, rot:8  }, 's'],     // 左右に揺れる
      [0.64, { y:-0.05, sx:0.97, sy:1.06, rot:-8 }, 's'],
      [0.80, { y:-0.04, sx:0.98, sy:1.05, rot:5  }, 's'],
      [0.90, { y:0,     sx:1.06, sy:0.95, rot:0  }, 'in'],    // 着地
      [1.00, { y:0,     sx:1.00, sy:1.00, rot:0  }, 'back'],
    ],
  },
};
const EMOTE_ORDER = ['joy','love','sad','angry'];   // ボタンに並べる順(表示の順序だけをここで決める)
/* 絵をタップしたときの反応。**嬉しい側を出やすくする**(可愛がったのに毎回すねられると
   愛着の逆になる)。重みは各エモートの tap で、増やしたエモートにも自動で効く。 */
function pickEmoteForTap(){
  const pool = [];
  EMOTE_ORDER.forEach(k=>{ for(let i=0;i<(EMOTES[k].tap||1);i++) pool.push(k); });
  return pool[Math.floor(Math.random()*pool.length)];
}
/* モンスター/スキンごとの専用コマ(任意)。**ここに無ければ上の共通モーションで動く。**
   「共通を基本にして、特別なものだけ後から差し替える」ための受け皿で、
   ここに1行足したものだけがコマ送りに切り替わる(他は何も変わらない)。
   { prefix, n } は monsters/<prefix>1..n.png。スキンIDの指定が素体より優先される。 */
const EMOTE_FRAMES = {
  // 例: guts_ssr: { joy:{ prefix:'guts_ssr_emote_joy', n:6 } },
};
function emoteFramesFor(element, skinId, key){
  const bySkin = skinId && EMOTE_FRAMES[skinId];
  if(bySkin && bySkin[key]) return bySkin[key];
  const byElem = element && EMOTE_FRAMES[element];
  if(byElem && byElem[key]) return byElem[key];
  return null;
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
// (2026-09-03: 弾から範囲技(rollingShell)に変更。バフの数値・効果はそのまま)
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
    { name:'クリスタルレイン',   tier:3, color:'#3dccc7', dmg:62, cooldown:1.9, gutsCost:24,
      aoeShape:'rect', range:900, rectWidth:260, aoeStyle:'crystal', seStyle:'crystalRain' },
  ],
  leaf: [
    { name:'種',     tier:1, color:'#7fb236', range:650,  dmg:22, cooldown:0.78, gutsCost:8, projSpeed:500, hitR:12, splash:72, icon:'🍃' },
    { name:'種マシンガン', tier:2, color:'#7fb236', range:1300, dmg:11, cooldown:1.15, gutsCost:16, projSpeed:460, hitR:6,  burst:4, burstGap:0.11, icon:'🍃' },
    { name:'フラワービーム',   tier:3, color:'#8fe33f', dmg:58, cooldown:2.2, gutsCost:24,
      aoeShape:'beams', range:1200, beamWidth:100, beamCount:3, beamSpreadDeg:40, aoeStyle:'flower' },
  ],
  spark: [
    { name:'かみなり',   tier:1, color:'#f4c430', range:650,  dmg:20, cooldown:0.7,  gutsCost:8, projSpeed:600, hitR:10, splash:62, icon:'⚡️' },
    { name:'雷撃', tier:2, color:'#f4c430', range:1300, dmg:9,  cooldown:0.85, gutsCost:16, projSpeed:560, hitR:5,  burst:5, burstGap:0.08, icon:'⚡️' },
    { name:'超雷撃',     tier:3, color:'#fff34d', dmg:64, cooldown:1.9, gutsCost:24,
      aoeShape:'zigzag', range:1400, zigzagWidth:150, aoeStyle:'thunder' },
  ],
  rock: [
    { name:'ロケットパンチ',       tier:1, color:'#a98a68', range:600,  dmg:28, cooldown:0.95, gutsCost:8, projSpeed:440, hitR:14, splash:78, icon:'👊🏿' },
    { name:'掌打',   tier:2, color:'#a98a68', range:1200, dmg:15, cooldown:1.3, gutsCost:16, projSpeed:380, hitR:9,  burst:3, burstGap:0.14, icon:'🤚🏿' },
    { name:'竜巻アタック', tier:3, color:'#a98a68', range:1600, dmg:34, cooldown:2.4, gutsCost:24, projSpeed:760, hitR:34, splash:60, projStyle:'tornado', growWithDistance:true,
      burst:3, burstGap:0, burstSpread:0, burstSideStep:55 }, /* 超番長ボーナスと同じ3本構成(色・エフェクトはそのまま)。
      **横並びの間隔(burstSideStep)は「単体に何本当たるか」を決める最重要の数字。**105では
      単体にはほぼ1本しか当たらず、紙の合計63に対して実際は21しか入っていなかった(2026-08-19)。
      55へ詰めて2本前後が当たるようにし、あわせて1本の威力と弾速を上げてある。 */
  ],
  phoenix: [
    { name:'火炎砲',     tier:1, color:'#e8432a', range:725,  dmg:25, cooldown:0.82, gutsCost:8, projSpeed:540, hitR:12, splash:70, icon:'🔥' },
    { name:'火炎連砲', tier:2, color:'#e8432a', range:1450, dmg:13, cooldown:1.05, gutsCost:16, projSpeed:500, hitR:7,  burst:3, burstGap:0.1, icon:'🔥' },
    { name:'ファイアウェーブ', tier:3, color:'#ff8a3d', dmg:58, cooldown:2.0, gutsCost:24,
      aoeShape:'rect', range:1000, rectWidth:220, aoeStyle:'lava', seStyle:'fireWave' },
  ],
  ark: [
    { name:'しっぽふり',   tier:1, color:'#ffe9a8', range:700,  dmg:24, cooldown:0.85, gutsCost:8, projSpeed:520, hitR:12, splash:70, icon:'🌱' },
    { name:'熾天の剣', tier:2, color:'#ffe9a8', range:1450, dmg:13, cooldown:1.05, gutsCost:16, projSpeed:500, hitR:7,  burst:3, burstGap:0.1, icon:'🏹' },
    /* blast: 着弾点に広がるドーム状の爆風(発注者依頼・2026-08-17)。直撃58+爆風24=82は
       ビッグバン(20+60=80)と同じ帯。半径240はビッグバン330より小さくして、
       射程1850の遠距離技が面まで最大にならないようにしてある。 */
    { name:'天の慈悲', tier:3, color:'#ffe9a8', range:1850, dmg:58, cooldown:2.0, gutsCost:24, projSpeed:560, hitR:30, splash:55, shape:'triangle', projStyle:'holy',
      blast:{ radius:240, dmg:24, expandTime:0.45, color:'#ffe9a8' } },
  ],
  warm: [
    { name:'毒ガス',       tier:1, color:'#9b5fd1', range:700,  dmg:23, cooldown:0.85, gutsCost:8, projSpeed:500, hitR:12, splash:75, icon:'☠️' },
    { name:'毒噴射',   tier:2, color:'#9b5fd1', range:1400, dmg:12, cooldown:1.1, gutsCost:16, projSpeed:470, hitR:7,  burst:3, burstGap:0.12, icon:'☠️' },
    /* 範囲技(rollingShell)に変更(発注者依頼・2026-09-03): 速い球体が地面を転がっていく。
       射程・威力・命中時の自分の移動速度バフはそのまま。projSpeedは充填の速さとして働く
       (combat.jsのfillSpeed=Math.max(200, effProjSpeed||900))。 */
    { name:'シェルアタック', tier:3, color:'#9b5fd1', dmg:70, cooldown:2.1, gutsCost:24,
      aoeShape:'rect', range:1750, rectWidth:120, projSpeed:1400, telegraphTime:0.18,
      aoeStyle:'rollingShell', selfSpeedBuffOnHit:true },
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
    { name:'天河天翔', tier:3, color:'#ffffff', dmg:74, cooldown:2.1, gutsCost:24,
      // 幅はキュービの特性(hitboxMult 1.5)で実効300になる。ここは素の値
      aoeShape:'rect', range:2200, rectWidth:200, aoeStyle:'galaxy' },
  ],
  mocchi: [
    { name:'もんた',     tier:1, color:'#ff8fc4', range:700,  dmg:24, cooldown:0.85, gutsCost:8, projSpeed:530, hitR:12, splash:70, icon:'🖐🏻', seStyle:'monta' },
    { name:'さくらふぶき', tier:2, color:'#ff8fc4', range:1400, dmg:13, cooldown:1.05, gutsCost:16, projSpeed:500, hitR:7,  burst:3, burstGap:0.1, icon:'🌸' },
    { name:'モッチ砲', tier:3, color:'#ff5fb0', dmg:86, cooldown:2.1, gutsCost:24, projSpeed:1400,
      aoeShape:'rect', range:1000, rectWidth:220, aoeStyle:'sakura', seStyle:'mocchiBeam' },
  ],
  suezo: [
    { name:'ツバはき',   tier:1, color:'#ffdd33', range:700,  dmg:22, cooldown:0.8,  gutsCost:8, projSpeed:520, hitR:12, splash:70, icon:'💧' },
    { name:'熱視線', tier:2, color:'#ffdd33', dmg:30, cooldown:1.1, gutsCost:16,
      aoeShape:'rect', range:1300, rectWidth:70, seStyle:'beam' },
    { name:'サイコキネシス', tier:3, color:'#3d9fff', dmg:66, cooldown:2.0, gutsCost:24,
      aoeShape:'fanZigzag', range:1300, fanAngleDeg:30, aoeStyle:'psychic' },
  ],
  // ガリ(god): 特性で全技の射程が長め・消費ガッツ-12.5%(射程/gutsCostを各技に直接反映)
  god: [
    { name:'ストレート', tier:1, color:'#f5f0ff', range:900, dmg:24, cooldown:0.85, gutsCost:7, projSpeed:560, hitR:13, splash:70, icon:'👊🏻' },
    { name:'ホーリーサンダー', tier:2, color:'#fff2b0', dmg:26, cooldown:1.15, gutsCost:14,
      aoeShape:'zigzag', range:1600, zigzagWidth:105, aoeStyle:'thunder', icon:'⚡️' },
    // **この技は4球撃つ。**dmgは1球ぶんなので、上げると4倍で効く(2026-08-19の調整で小幅に留めた)
    { name:'ゴッドライジング', tier:3, color:'#ffffff', dmg:28, cooldown:2.1, gutsCost:21, projSpeed:820,
      range:1200, hitR:30, splash:0, projStyle:'godorb', multiOrb:['#ff4d4d','#4d7cff','#ffe14d','#4dff6a'],
      orbAuras:['red','blue','yellow','green'], orbSpreadDeg:9, icon:'✨' },
  ],
  // ザン(zan): 命中で毒(ワームと同じ特性)。HP普通・移動速め
  zan: [
    { name:'ソニックナイフ', tier:1, color:'#8fa0c8', range:680, dmg:20, cooldown:0.8, gutsCost:8, projSpeed:640, hitR:11, splash:64, icon:'🗡️' },
    { name:'フォルターブリッツ', tier:2, color:'#8fa0c8', range:1250, dmg:11, cooldown:1.05, gutsCost:16, projSpeed:600, hitR:6, burst:3, burstGap:0.1, icon:'🗡️' },
    /* burstSpread = 連射の広がりの**幅**(1発ごとの角度差・rad)。既定の0.05のままだと
       発数を増やしたぶんだけ扇が広がってしまうので、**発数が増えても幅が同じくらいになる**
       値を明示する(7発 × 0.035 = 約12度)。疾風(zan_ssr)は10発なので、
       同じ幅になるよう SSR_SKIN_TIER3 側で 0.026 にしてある。
       burstSpreadRandom = その幅の中で**ランダムにブレる**(発注者指定)。
       等間隔だと弾道が定規で引いたように並んで見えるため。幅は変わらない。 */
    { name:'ダークホウスト', tier:3, color:'#2a2d40', dmg:24, cooldown:2.0, gutsCost:24, projSpeed:900,
      range:1340, hitR:22, burst:7, burstGap:0.09, burstSpread:0.035, burstSpreadRandom:true,
      projStyle:'crescent', icon:'🌙', seStyle:'darkHoust' },
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
      blast:{ radius:330, dmg:72, color:'#14121c', expandTime:0.5 } },
  ],
  dullahan:[ /*@dullahan*/
    { name:'まっぷたつ', tier:1, color:'#f4f7ff', aoeShape:'rect', range:700, rectWidth:55, dmg:24, cooldown:0.85, gutsCost:8, aoeStyle:'zangetsu', closeBonusMax:1.5, icon:'🗡️' },
    { name:'風神剣', tier:2, color:'#f4f7ff', range:1300, dmg:13, cooldown:1.05, gutsCost:16, projSpeed:760, hitR:18, burst:3, burstGap:0.09, projStyle:'crescentWhite', closeBonusMax:1.5, icon:'🗡️' },
    // selfBlast: 撃った瞬間に自分の足元でドーム状の爆風が広がる。そのあと竜巻と一緒に前進する
    { name:'最終奥義', tier:3, color:'#f4f7ff', range:1300, dmg:78, cooldown:2.1, gutsCost:26, projSpeed:1500, hitR:34, projStyle:'tornadoAura', closeBonusMax:1.5, selfMoveWithProjectile:true,
      selfBlast:{ radius:420, dmg:46, expandTime:0.42 }, icon:'🌪️' }
  ],
  /* ハムの特性は「技の弾速が速く、射程が短い」。**その通りに全技へ効かせてある**
     (雛形の値に対して射程は0.5倍、弾速は2倍)。ガリの godrange とは逆向きの、
     技側に数字を焼き込むタイプの特性なので、数字を触るときは3つとも同じ向きに動かす。
     雛形: 正拳 700/520・ワンツー 1400/500・暗けい 1500/640(range/projSpeed)。 */
  hum:     [ /*@hum*/
    { name:'正拳', tier:1, color:'#e0ad7b', range:350, dmg:24, cooldown:0.85, gutsCost:8, projSpeed:1040, hitR:12, splash:70, icon:'👊🏿' },
    // dmg 19.5 は端数ではなく意図した値。**3連射だった頃の合計(13×3=39)を2連射で保つ**ためのもの
    { name:'ワンツー', tier:2, color:'#e0ad7b', range:700, dmg:19.5, cooldown:1.05, gutsCost:16, projSpeed:1000, hitR:7, burst:2, burstGap:0.1, icon:'👊🏿' },
    // 手のひらを相手へ向けて飛ばす。iconは 🖐(手のひら) なので REAL_ICON_FX の fxIconPalm が
    // 進行方向へ向けて描く。**projStyleを付けるとその分岐に入らない**ので付けない
    { name:'暗けい', tier:3, color:'#d9b391', range:750, dmg:20, cooldown:2.3, gutsCost:24, projSpeed:1280, hitR:28, splash:0, icon:'🖐🏻', blast:{ radius:330, dmg:60, expandTime:0.5, color:'#d9b391' } }
  ],
  ogre:    [ /*@ogre*/
    { name:'殴打', tier:1, color:'#e0ad7b', range:700, dmg:24, cooldown:0.85, gutsCost:8, projSpeed:520, hitR:12, splash:70, icon:'👊🏿' },
    { name:'阿修羅', tier:2, color:'#e0ad7b', range:1400, dmg:13, cooldown:1.05, gutsCost:16, projSpeed:500, hitR:7, burst:6, burstGap:0.1, icon:'👊🏿' },
    /* 羅生門: 「吸い込み技」。予告範囲の最遠(range)から自分の前の門(gateDist)へ炎が逆走し、
       触れた敵はダメージ(mv.dmg)を受けつつ門の前まで引き寄せられる(吸い込み)。炎が門に
       届いた瞬間にendBlastのドームでさらにダメージが入る(炎の接触+門の爆風の2段構え)。
       mv.dmgはendBlast.dmgへ「威力アップ・アウラ相性等の倍率」を伝える基準値も兼ねる
       (fireMoveのendBlastDmgMult=effDmg/move.dmgと同じ比率をそのまま使う。二重の表を作らない)。
       kind='gate'の当たり判定・引き寄せ・炎ダメージ・爆発トリガーはcombat.jsのupdateAreaEffectsに実装。
       gateDist: 発注者依頼(2026-08-12)で260→170に短縮し、門を自分の近くに出す。 */
    { name:'羅生門', tier:3, color:'#e0ad7b', range:1000, dmg:30, cooldown:2, gutsCost:24,
      aoeShape:'gate', gateDist:170, rectWidth:220,
      endBlast:{ count:1, radius:240, dmg:47, expandTime:0.45, color:'#ff6a2e', se:'tornado' } }
  ],
  centaur: [ /*@centaur*/
    { name:'スロウランサー', tier:1, color:'#7fb236', range:840, dmg:24, cooldown:0.85, gutsCost:8, projSpeed:624, hitR:12, splash:70, icon:'🏹' },
    { name:'マインドフレア', tier:2, color:'#7fb236', range:1680, dmg:13, cooldown:1.05, gutsCost:16, projSpeed:600, hitR:7, burst:3, burstGap:0.1, icon:'🔥' },
    /* 見た目はピクシーの「ビッグバン」と同じにする(発注者指定・2026-08-17)。
       projStyle:'voidOrb' が2D/3Dの弾の絵、FX_MOVES.centaur(=pixie)が粒と輪を受け持つ。
       性能値(射程・弾速・3連射・当たり判定・爆風)はケンタウロスのまま。色も緑のまま
       (オーラ相性が green なので黒にしない)。 */
    { name:'メテオドライブ', tier:3, color:'#7fb236', range:1620, dmg:22, cooldown:2.2, gutsCost:24, projSpeed:1380, hitR:34, burst:3, burstGap:0.12, burstSpread:0.11, projStyle:'voidOrb', blast:{ radius:325, dmg:26, expandTime:0.5, color:'#7fb236' } }
  ],
  /* ナーガの特性「技の威力が高い」は、**倍率ではなくここの数字そのもの**で効かせている
     (ガリの射程・ハムの弾速と同じ形。エンジンに分岐を足さない)。
     ELEMENTS の dmgDealtMod にすると、ナーガのスキンであるゴッドエンペラーにも同じ倍率が乗り、
     「素はゴッドエンペラーの0.8倍」という関係が崩れる。**威力を動かすときは両方を見ること。** */
  narga:   [ /*@narga*/
    { name:'真空弾', tier:1, color:'#7a2fc6', range:700, dmg:38, cooldown:0.85, gutsCost:8, projSpeed:520, hitR:12, splash:70, icon:'🔥' },
    { name:'連続真空弾', tier:2, color:'#7a2fc6', range:1400, dmg:20, cooldown:1.05, gutsCost:16, projSpeed:500, hitR:7, burst:3, burstGap:0.1, icon:'🔥' },
    // pierce: 遮蔽物で止まらず射程いっぱいまで貫く(判定は combat.js の moveReachDistance 1か所)
    { name:'アイビーム', tier:3, color:'#7a2fc6', range:1000, dmg:83, cooldown:2.1, gutsCost:24, projSpeed:1900, aoeShape:'rect', aoeStyle:'sakura', rectWidth:80, pierce:true }
  ],
  joker:   [ /*@joker*/
    { name:'デスエナジー', tier:1, color:'#4d1d7c', range:700, dmg:24, cooldown:0.85, gutsCost:8, projSpeed:520, hitR:12, splash:70, icon:'🔥' },
    /* デスカッター: 見た目はザンのtier3「ダークホウスト」と同じ回転する黒い三日月。
       **性能はtier2のまま**(射程1400・威力13・ガッツ16・当たり判定7)。
       projVisR は当たり判定と切り離した「絵の大きさ」。これが無いと当たり判定7に
       合わせて刃が8pxまで縮み、三日月の形が画面上で読めない。 */
    { name:'デスカッター', tier:2, color:'#2a2d40', range:1400, dmg:13, cooldown:1.05, gutsCost:16, projSpeed:500, hitR:7,
      burst:3, burstGap:0.1, burstSpread:0.035, burstSpreadRandom:true,
      projStyle:'crescent', projVisR:17, icon:'🌙', seStyle:'darkHoust' },
    /* デスファイナル: 5連射×3方向の15連射。burstDirs が「方向の束」の数で、
       束は順番でなく**交互に**選ぶので、左右と正面へ同時に散り続ける(=無数に飛んでくる)。
       広がりはザン(7発×0.035 ≒ 左右12度)に対し、束の間隔0.30 + 束の中0.075 で
       **左右およそ52度**。全弾を1体へ当てることは実質できない広さ。 */
    { name:'デスファイナル', tier:3, color:'#141018', range:1340, dmg:21, cooldown:2, gutsCost:24, projSpeed:820, hitR:22,
      burst:15, burstDirs:3, burstDirSpread:0.30, burstGap:0.07, burstSpread:0.075, burstSpreadRandom:true,
      projStyle:'scythe', icon:'🌙' }
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
  garurumon_ssr:  'blue', /*@garurumon_ssr*/
  metag_ssr:      'yellow', /*@metag_ssr*/
  guts_ssr_awake: 'black', /*@guts_ssr_awake*/
  satsuki_ssr:    'yellow', /*@satsuki_ssr*/
  satsuki_ssr_awake:'yellow', /*@satsuki_ssr_awake*/
  tsukasa_ssr:    'yellow', /*@tsukasa_ssr*/
  oki_ssr:        'blue', /*@oki_ssr*/
  leaf_ssr:       'white', /*@leaf_ssr*/
  narga_ssr:      'green', /*@narga_ssr*/
  suezo_ssr:      'red', /*@suezo_ssr*/
  zan_ssr:        'blue', /*@zan_ssr*/
  joker_ssr:      'white', /*@joker_ssr*/
  warm_ssr:       'red', /*@warm_ssr*/
  ganon_ssr:      'black', /*@ganon_ssr*/
  // <<AUTO:SSR_SKIN_AURA>> ここから上へ tools/studio_web.html が新しいSSRスキンの行を追記する
};
// スキンなし時のモンスターのデフォルトオーラ(体色由来)
const MONSTER_AURA = {
  mocchi:'red', suezo:'yellow', phoenix:'red', fire:'red', aqua:'blue', leaf:'green',
  spark:'blue', rock:'black', ark:'green', warm:'yellow', illumine:'black',
  fox:'white', god:'white', zan:'black', pixie:'red',
  dullahan:'white', /*@dullahan*/
  hum:     'yellow', /*@hum*/
  ogre:    'yellow', /*@ogre*/
  centaur: 'green', /*@centaur*/
  narga:   'black', /*@narga*/
  joker:   'black', /*@joker*/
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
  '正拳':'yellow','ワンツー':'yellow','暗けい':'yellow', /*@hum*/
  '殴打':'yellow','阿修羅':'red','羅生門':'yellow', /*@ogre*/
  'スロウランサー':'green','マインドフレア':'green','メテオドライブ':'green', /*@centaur*/
  '真空弾':'black','連続真空弾':'black','アイビーム':'black', /*@narga*/
  'デスエナジー':'black','デスカッター':'black','デスファイナル':'black', /*@joker*/
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
/* 白と黒のオーラ。**本体色は他の色と同じようにここで乗せる。**
   【一度外して戻した経緯】2026-08-16に「白=真っ白な紙の山 / 黒=灰色のガラス管」に
   見えたので白黒だけ本体色を素のままにしたが、そうすると**スキンを着せても技の色が
   まったく変わらない**(天衣無縫が素のファイアウェーブと同じ橙のまま)。
   発注者から不具合として指摘されたので戻した(2026-08-17)。
   見栄えは色を殺すのではなく、暗い層・白熱の芯・煤(getMoveAuraAccent)で作る。 */
const ACHROMATIC_AURAS = { white:1, black:1 };
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
  if(!a) return null;
  return auraColorHex(a);
}
/* 白黒オーラ専用の「上乗せ」。'white' / 'black' の文字列をそのまま返す(色ではなく「向き」)。
   本体色は getMoveEffectColor が既に白/黒にしているので、ここはその上へ
   受け取る側(render.js の fxGlAccent)が
     white → 芯を白熱させて外へ白い羽根を散らす
     black → 外周に黒い煤の殻をまとわせる
   を足すだけ。無彩色は加算の層に乗りにくいので、この2つが実質の見せ場になる。 */
function getMoveAuraAccent(move, attacker){
  if(!move || move.tier!==3) return null;
  const a = skinTier3Aura(entitySkinId(attacker));
  return (a && ACHROMATIC_AURAS[a]) ? a : null;
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
  /* **素の竜巻アタックと数値を合わせて動かすこと。** ここは倍率ではなく絶対値なので、
     素のほうだけ上げるとSSRスキンの方が弱くなる(2026-08-19の調整で実際に起きかけた)。
     横並びの間隔も素と同じ55にして、単体に2本前後当たるようにしてある。 */
  rock_ssr:       { name:'超番長ボーナス', move:{ /*@rock_ssr*/
    dmg:48, burst:3, burstGap:0, burstSpread:0, burstSideStep:55,
    cooldown:3.0, projSpeed:760, range:1500, gutsCost:26,
    projStyle:'tornado', projVariant:'bonus7',
    burstTints:['#3f74e6','#e6453f','#3f74e6'],
  }},
  // 大喰いの利世(ウンディーネ): クリスタルレインを置き換える専用tier3。
  // 赤い触手が足元から生えて範囲を進む。lifestealMult はこの技だけHP回復を倍にする。
  // **素のクリスタルレインと数値を合わせて動かすこと**(絶対値指定なので自動では追従しない)
  aqua_ssr:       { name:'鱗赫', move:{ /*@aqua_ssr*/
    dmg:70, rectWidth:340, aoeStyle:'kagune', lifestealMult:2,
  }},
  guts_ssr:       { name:'ドラゴンころし', dmgMult:1.15 }, /*@guts_ssr*/
  zod_ssr:        { name:'言葉は無粋', dmgMult:1.15 }, /*@zod_ssr*/
  // ガルルモン(ライガー): 素体の「超雷撃」(zigzag/電撃)を、青い炎を吐く扇状のブレスに置き換える。
  // 色は決め打ちしない。tier3は装備スキンのオーラ色(このスキンはblue)へ自動で乗る(getMoveEffectColor)。
  // projSpeedは範囲拡大速度(fillSpeed)そのもの。他の範囲技は指定が無く既定900のままなので、
  // 明確に速くするため1500にする。zigzagWidthは扇では読まれないが、値が残ると紛らしいので0にする。
  garurumon_ssr:  { name:'フォックスファイアー', dmgMult:1.15, move:{ /*@garurumon_ssr*/
    aoeShape:'fan', fanAngleDeg:30, aoeStyle:'inferno', projSpeed:1500, zigzagWidth:0,
  }},
  // メタルグレイモン(ドラゴン): 素体の「インフェルノ」(fan/inferno)の炎ブレスはそのまま活かし、
  // 先端の3連ドーム(endBlast)だけ削って、横並びの黒い核弾頭2発+着弾の大きいドーム爆風に差し替える。
  // warheads は fireMove の aoeShape 分岐でだけ読む専用フィールド(この技専用)。
  metag_ssr:      { name:'ギガデストロイヤー', dmgMult:1.15, move:{ /*@metag_ssr*/
    endBlast:null,
    warheads:{ count:2, sideStep:80, projSpeed:620, range:900, dmg:18, hitR:30,
               color:'#14121c', projStyle:'voidOrb',
               blast:{ radius:260, dmg:42, expandTime:0.5, color:'#ff6a2e' } },
  }},
  // 北大路さつキジン: 素体(キジン)の「羅生門」と数値は同じまま、門を大きなピンクのハート型に
  // 差し替える専用演出。aoeStyle:'heart' はrender.jsのfx3dGateがハート型の門を描く目印、
  // endBlast.style:'heartBlast' は爆風にハートのエフェクトを纏わせる目印(いずれも専用フィールド)。
  // 色は決め打ちしない原則の例外(発注者指定のピンク固定・2026-08-12。rock_ssrのburstTintsと同様の扱い)。
  satsuki_ssr:    { name:'2人でもっと熱くなろ', dmgMult:1.15, move:{
    aoeStyle:'heart',
    endBlast:{ count:1, radius:240, dmg:47, expandTime:0.45, color:'#ff5fa8', se:'tornado', style:'heartBlast' },
  }}, /*@satsuki_ssr*/
  /* 西野ピかさ(ピクシー): 「ビッグバン」の黒い球をいちごに差し替える(発注者指定・2026-08-17)。
     projStyle だけを上書きするので、威力・射程・弾速・当たり判定・爆風は素のビッグバンのまま。
     **いちごだけが赤**で、電撃・降着円盤・ドームの爆風はこれまでどおりオーラの色に乗る。 */
  tsukasa_ssr:    { name:'ずっとずっとキミのことが好き!!', dmgMult:1.15, move:{ projStyle:'strawberry' } }, /*@tsukasa_ssr*/
  oki_ssr:        { name:'大将軍の矛', dmgMult:1.15 }, /*@oki_ssr*/
  leaf_ssr:       { name:'引力光線', dmgMult:1.15 }, /*@leaf_ssr*/
  /* ゴッドエンペラー(ナーガ): **3つの技すべてを専用技に差し替える**唯一のスキン(発注者指定・2026-08-24)。
     tier1/tier2の上書きは `tiers` に置く(引くのは skinMoveDef 1か所)。消費ガッツは 10 / 20 / 30。
     素の技より少し強いぶんをガッツで払う形にしてあるので、**素のナーガを調整したらここも見直す**
     (倍率ではなく絶対値で持っているため自動では追従しない)。
     ・デスミサイル = 素の「真空弾」を3連射にし、着弾ごとに小さいドーム爆風
     ・デスブレイク = ピクシー「ビッグバン」と同じ見た目(voidOrbの球+着弾ドーム)。素の連射は止める
     ・デスレーザー = 素の「アイビーム」を細く・速く・強くした貫通ビーム(pierceは素から引き継ぐ)。
       単発威力150は、特性・スキン倍率・近距離ボーナス込みで比べても全モンスター中最大にする。
       威力は絶対値で持つので dmgMult は付けない(二重に掛かるため) */
  narga_ssr:      { name:'デスレーザー', move:{ dmg:150, projSpeed:2600, rectWidth:56, gutsCost:30 }, /*@narga_ssr*/
    tiers:{
      1:{ name:'デスミサイル', move:{ dmg:10, cooldown:0.9, gutsCost:10, projSpeed:620, hitR:13, splash:0,
                                      burst:3, burstGap:0.1, burstSpread:0.06,
                                      blast:{ radius:95, dmg:6, expandTime:0.3, color:'#7a2fc6' } } },
      2:{ name:'デスブレイク', move:{ dmg:26, cooldown:1.15, gutsCost:20, range:1300, projSpeed:620, hitR:26,
                                      burst:1, burstGap:0, projStyle:'voidOrb',
                                      blast:{ radius:240, dmg:48, expandTime:0.45, color:'#7a2fc6' } } },
    } },
  /* バジリスエゾー: 技の絵は素の「サイコキネシス」のまま。**睨む赤い眼を上へ重ねるだけ**の印。
     描くのは render.js の drawGlareEyesFx 1か所(画像は images/fx_glare_eyes.png)。 */
  suezo_ssr:      { name:'真瞳術', dmgMult:1.15, move:{ glareEyes:true } }, /*@suezo_ssr*/
  /* 疾風: 素の「ダークホウスト」(7連射)を10連射にする。広がりは素と同じ幅に見えるよう
     0.035→0.026 へ下げる(10発 × 0.026 = 約13度で、素の7発とほぼ同じ扇)。
     **威力・射程・弾速は素のまま**(dmgMult 1.15 は従来どおり別途掛かる)。 */
  zan_ssr:        { name:'月光ノ刻', dmgMult:1.15, move:{ burst:10, burstSpread:0.026, burstSpreadRandom:true } }, /*@zan_ssr*/
  joker_ssr:      { name:'聖ジョージの剣', dmgMult:1.15 }, /*@joker_ssr*/
  /* 電王ライナー: 赤い新幹線をイメージした最長(2600)・最速(3200/s)の範囲技(発注者依頼・2026-09-03)。
     予告0.6秒でレールを敷き、そのレールの上を赤い新幹線が走り抜ける(pierce:trueで岩・山を貫通)。
     素のシェルアタック(hitR/splash/shape/projStyle)はaoeShapeへ完全に上書きされるので残っていても無害。 */
  warm_ssr:       { name:'俺、参上', dmgMult:1.15,
    move:{ aoeShape:'rect', range:2600, rectWidth:150, projSpeed:3200, telegraphTime:0.6,
           aoeStyle:'shinkansen', pierce:true, selfSpeedBuffOnHit:true } }, /*@warm_ssr*/
  /* 怨霊ガノン鳥(フェニックス): 素の「ファイアウェーブ」(rect/lava)を、黒紫の禍々しい炎+
     3連続のドーム爆風に差し替える専用tier3(発注者依頼・2026-09-04)。
     ・炎の先端(fillDist)が射程1000を3等分した位置(約333/667/1000)を通過するたびに、
       その位置へ半径170のドーム爆風を1つ出す(waveBlast。updateAreaEffectsのwaveBlastDoneで
       二重発火を防ぐ)。ドーム同士の間隔は約333、直径は170×2=340なので重なり幅は約7しかなく、
       **同じ場所に立ち止まっていても普通は1発しか当たらない**(重ねすぎると射程1000が
       実質「1回のデカい爆風」になり3連続に見えなくなるため、間隔と半径をほぼ隙間なしに揃えた)。
     ・爆風に当たった相手は中心から見て反対方向へ260だけ0.28秒かけて強制移動する
       (waveBlast.knockDist/knockSec。既存のpulledUntil/pulledX/pulledY/pulledSpeedをそのまま使う)。
     ・威力の答え合わせ: 単体は「炎58 + ドーム1発50 = 108」。SSR倍率1.15で 108*1.15≈124。
       既存tier3の最高は超雷撃64(×1.15で74)なので、消費ガッツ28・発動後0.5秒の鈍足という
       代償付きで全モンスター中最高水準になる(発注者方針: 技のエフェクトは負荷が高くても
       簡略化しない/威力は消費と代償に見合わせる)。
     ・selfSlowSec:0.5 → fireMoveで attacker.slowUntil = matchTime+0.5 を立てるだけ。
       既存のslowUntilは速度0.5倍にする(combat.js entityMoveSpeed)ので要求の「0.5倍」と一致する。
     ・keepBaseColor:true → 素のままだと getMoveEffectColor が本体色を装備オーラの色
       (ganon_ssrのオーラは'black')へ置き換えてしまい、指定の黒紫#7a18c9が出ない。
       choco_ssr「ヴァニッシュ」と同じ扱いで本体色を固定する(色の決め打ちは発注者指定の例外)。
       黒(achromatic)オーラの「外周に煤をまとわせる」演出はkeepBaseColorでも変わらず乗る。
     ・waveBlast.style:'ganonHellfireBlast' はrender.jsが「黒紫の球体+赤い衝撃輪」の
       専用描画を選ぶための目印(heartBlast等と同じ仕組み)。 */
  ganon_ssr:      { name:'魔神炎', dmgMult:1.15, move:{
    aoeShape:'rect', range:1000, rectWidth:240, dmg:58, cooldown:2.3, gutsCost:28,
    color:'#7a18c9', aoeStyle:'ganonHellfire', keepBaseColor:true,
    waveBlast:{ count:3, radius:170, dmg:50, expandTime:0.32, color:'#ff2a2a', knockDist:260, knockSec:0.28,
                style:'ganonHellfireBlast' },
    selfSlowSec:0.5,
  } }, /*@ganon_ssr*/
  // <<AUTO:SSR_SKIN_TIER3>> ここから上へ tools/studio_web.html が新しいSSRスキンの行を追記する
};
// スキン装備時の技を「専用技」に解決する(名前と、moveがあれば数値も上書き)。
// 中心はtier3だが、スキンが `tiers` を持っていればtier1/tier2も同じ形で差し替わる。
// 対象外はそのまま元の技を返す。結果はスキンID+技名でキャッシュし毎フレームの生成を避ける。
// 威力倍率(dmgMult)は従来どおり effectiveMoveDmg 側の ssrTier3DmgMult が掛けるので、ここでは触らない。
/* スキンIDから tier3 の専用技の定義を引く。**覚醒スキンは元のスキンのものを受け継ぐ。**
   覚醒後の姿には専用技の行が無い(ツールが作るのは見た目だけ)ため、そのまま引くと
   技名が通常の名前に戻り、SSRの威力倍率まで失われていた(実機で報告・2026-08-11)。
   **SSR_SKIN_TIER3 を直接引く場所を 増やさない。必ずこの関数を通す。** */
function skinTier3Def(skinId){
  if(!skinId) return null;
  if(SSR_SKIN_TIER3[skinId]) return SSR_SKIN_TIER3[skinId];
  if(typeof isAwakenedSkinId === 'function' && isAwakenedSkinId(skinId))
    return SSR_SKIN_TIER3[SSR_SKINS[skinId].awakenOf] || null;
  return null;
}
/* スキンがこの技を上書きしているかを引く。tier3はスキンの行そのもの、tier1/tier2は `tiers` の中。
   **`tiers` を直接読む場所を増やさない。必ずこの関数を通す**(引く場所が散ると、技名だけ
   専用名になって数値が素のまま、といった食い違いが起きる)。 */
function skinMoveDef(move, skinId){
  const def = skinTier3Def(skinId);
  if(!def || !move) return null;
  if(move.tier===3) return def;
  return (def.tiers && def.tiers[move.tier]) || null;
}
const _skinTier3MoveCache = {};
function skinTier3Move(move, attacker){
  if(!move) return move;
  const sid = entitySkinId(attacker);
  const def = skinMoveDef(move, sid);
  // 技強化(覚醒・秘伝の書)はtier3だけに効く従来どおりの決まり
  const boosts = (move.tier===3) ? entityMoveBoosts(attacker) : [];
  if(!def && !boosts.length) return move;
  /* 強化は「どの段のどの種類か」で結果が変わるのでキャッシュキーに混ぜる。
     **強化を1つでも足したらここに必ず入れる。** 混ぜ忘れると同じスキンの同じ技で
     古い結果が使い回され、強化を付けても数字が変わらない(再読込まで直らない)。 */
  const ck = `${sid}:${move.name}:${moveBoostCacheKey(boosts)}`;
  if(_skinTier3MoveCache[ck]) return _skinTier3MoveCache[ck];
  let out = Object.assign({}, move);
  if(def){
    if(def.name) out.name = def.name;
    if(def.move){
      for(const k of Object.keys(def.move)){ if(k!=='blast') out[k] = def.move[k]; }
      if(def.move.blast) out.blast = Object.assign({}, move.blast||{}, def.move.blast);
    }
  }
  // 載っている強化を**すべて**順に掛ける(覚醒と秘伝の書は重ねられる)
  boosts.forEach(b=>{ out = applyMoveBoostToMove(out, b); });
  _skinTier3MoveCache[ck] = out;
  return out;
}
/* 強化を技へ掛ける。**スキンの上書き(SSR_SKIN_TIER3)を当てたあとに掛ける**ので、
   スキンで技を差し替えていても、差し替え後の値に対して効く。
   威力(dmgMult)はここでは触らない(従来どおり effectiveMoveDmg 側の ssrTier3DmgMult が掛ける)。 */
function applyMoveBoostToMove(move, boost){
  const b = moveBoostEffect(boost);
  if(!b || !move) return move;
  const out = Object.assign({}, move);
  if(b.mult){
    for(const k of Object.keys(b.mult)){
      // 指定の無いフィールドは既定値(base)から伸ばす。範囲技のfillSpeedは未指定なら900
      const cur = (out[k]!=null) ? out[k] : (b.base && b.base[k]);
      if(cur!=null) out[k] = Math.round(cur * b.mult[k]);
    }
  }
  // 爆風ドームは expandTime が小さいほど速く広がる
  if(b.blastExpandMult){
    ['blast','endBlast','selfBlast'].forEach(k=>{
      if(!out[k]) return;
      const cur = out[k].expandTime || 0.45;
      out[k] = Object.assign({}, out[k], { expandTime: Math.round(cur*b.blastExpandMult*1000)/1000 });
    });
  }
  return out;
}
// 旧名。覚醒だけを掛ける呼び出しが残っていても動くように残す
function applyAwakenBoostToMove(move, boostKey){
  return boostKey ? applyMoveBoostToMove(move, { src:'awaken', kind:boostKey }) : move;
}
/* このエンティティに効いている技強化の一覧。**試合が始まる時にエンティティへ載せてある**ので、
   自分・味方bot・マルチの相手のどれでも同じように読める(ここで localStorage を見ない。
   マルチの相手のマスモンは手元に無いため)。

   形は [{src:'awaken'|'hiden', kind:'power'|…}, …]。
   **昔の写しは awakenBoost に文字列1つで入っている**ので、それも1要素として受ける
   (マルチの相手・保存済みのゴーストが古い形で届く)。 */
function entityMoveBoosts(entity){
  if(!entity) return [];
  /* 【moveBoosts があればそれだけを見る】awakenBoost は古い受け側のために
     写しへ残してあるので、両方読むと覚醒が二重に掛かる(威力なら1.30が1.69になる)。
     moveBoosts は覚醒ぶんも含んだ完全な一覧なので、あるときはこちらが正。 */
  const src = Array.isArray(entity.moveBoosts) ? entity.moveBoosts
            : (entity.awakenBoost != null ? [entity.awakenBoost] : []);
  const out = [], seen = {};
  src.forEach(b=>{
    const n = normalizeMoveBoost(b);
    if(!n) return;
    const k = `${n.src}.${n.kind}`;
    if(seen[k]) return;              // 同じ段の同じ種類は1回だけ
    seen[k] = 1;
    out.push(n);
  });
  return out;
}
// 文字列(昔の形=覚醒)でも {src,kind} でも受ける。効かない種類は落とす
function normalizeMoveBoost(b){
  if(typeof b === 'string') return b ? { src:'awaken', kind:b } : null;
  if(b && b.kind && MOVE_BOOST_KINDS[b.kind]) return { src: b.src || 'awaken', kind: b.kind };
  return null;
}
function moveBoostEffect(boost){
  const n = normalizeMoveBoost(boost);
  const grade = n && MOVE_BOOST_GRADES[n.src];
  return (grade && grade[n.kind]) || null;
}
function moveBoostCacheKey(boosts){
  return (boosts||[]).map(b=>`${b.src}.${b.kind}`).join('+');
}
// 旧名。1語で読む呼び出しが残っていても動くように残す(覚醒ぶんだけを返す)
function entityAwakenBoost(entity){
  const b = entityMoveBoosts(entity).find(x=>x.src==='awaken');
  return b ? b.kind : null;
}
// 技の表示名(SSR装備時は専用名に上書き。tier1/tier2も上書きするスキンがある)
function getMoveName(move, attacker){
  const def = skinMoveDef(move, entitySkinId(attacker));
  if(def && def.name) return def.name;
  return move ? move.name : '';
}
/* SSR装備時のtier3威力倍率(非装備/非tier3は1)。「威力」の強化を選んでいればさらに掛かる。
   **tier1/tier2を上書きするスキン(`tiers`)は威力を絶対値で持つ決まりなので、ここでは掛けない。**
   **載っている強化を全部掛ける。** 1つしか見ないと、技一覧の表示だけ上がって
   実戦のダメージが上がらない(表示と実戦力の食い違い)。 */
function ssrTier3DmgMult(move, attacker){
  if(move && move.tier===3){
    const def = skinTier3Def(entitySkinId(attacker));
    let mult = def ? (def.dmgMult || 1) : 1;
    entityMoveBoosts(attacker).forEach(b=>{
      const e = moveBoostEffect(b);
      if(e && e.dmgMult) mult *= e.dmgMult;
    });
    return mult;
  }
  return 1;
}

// 更新履歴(プレイに関わる大きな機能の追加・変更・調整のみ。日付降順で表示する)。
// 該当する作業をしたら、このリストの先頭日付にも追記すること(CLAUDE.md参照)。
// トップ画面左下のバナー。3秒ごとに切り替わってループする。最大5件(古いものから落ちる)。
// open は押したときに開く画面('gacha' / 'season' / 'shop' / 'raid')。
// 【自動更新】tools/studio_web.html のSSRスキン追加(<<AUTO:LOBBY_BANNERS>>)が新しい1件を
// 先頭へ足し、5件を超えたら末尾を落とす。手動で増やすときもこの形式に合わせること。
const LOBBY_BANNERS = [
  // 先頭が起動直後に表示される(lobbyBannerIdx=0 から始まる)。新しい順。
  // レイド第3回「あるるかん討伐」の告知(2026-09-04)。5件超のため末尾のバジリスエゾーを落とした
  { rar:'SSR', name:'あるるかん討伐', tag:'レイド', img:'images/promo_raid_s2.jpg', size:'cover', pos:'50% 40%', open:'raid' },
  { rar:'SSR', name:'西野ピかさ', tag:'新登場・ガチャ', img:'monsters/tsukasa_ssr.png', size:'150%', pos:'50% 20%', open:'gacha' }, /*@tsukasa_ssr*/
  { rar:'SSR', name:'秦の怪鳥', tag:'新登場・ガチャ', img:'monsters/oki_ssr.png', size:'150%', pos:'50% 20%', open:'gacha' }, /*@oki_ssr*/
  { rar:'SSR', name:'メカビオギドラ', tag:'新登場・ガチャ', img:'monsters/leaf_ssr.png', size:'150%', pos:'50% 20%', open:'gacha' }, /*@leaf_ssr*/
  { rar:'SSR', name:'ゴッドエンペラー', tag:'新登場・ガチャ', img:'monsters/narga_ssr.png', size:'150%', pos:'50% 20%', open:'gacha' }, /*@narga_ssr*/
  // <<AUTO:LOBBY_BANNERS>> ここから下へ tools/studio_web.html が新しいSSRの行を先頭挿入する(5件超は末尾を削除)
];
const LOBBY_BANNER_MS = 3000;

/* Xへのシェア。**URLとタグはここだけに書く**(文面を作る場所が増えても二重に持たない)。
   Xは本文をURL=23・日本語=2・ASCII=1で数えて上限280。 */
const SHARE_URL = 'https://komekome898-web.github.io/aramon/index.html';
const SHARE_TAG = '#荒野モン動';
// 投稿文の末尾、URLの直前に必ず入れる案内。PWAとして入れてもらうのが狙い
const SHARE_PWA_HINT = 'ブラウザから開き共有からホーム画面に追加でいつでも遊べる！';
const SHARE_TEXT_MAX_UNITS = 250;   // 上限280に対する余裕ぶん

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
  { date:'2026-09-07', items:[
    { t:'🌱 難易度「やさしい」で、敵に狙いが自動で合うようになりました(タップした敵を追い続け、照準の近くの敵へ少し引き寄せます)', g:['feature','solo'] },
    { t:'🏅 段位ランキングを「今シーズン」と「通算」で切り替えられるようにしました。既定は今シーズンです', g:['feature','general'] },
    { t:'🔥 難易度「ハード」を追加しました。上位プレイヤーが育てたモンスターが敵として出てきます。段位RPと経験値が増える代わりに、負けたときの下がり幅も大きくなります', g:['feature','solo','balance'] },
    { t:'🎰 ガチャのピックアップが日替わりになりました。日によって出やすいSSRスキンが変わります', g:['feature','general'] },
    { t:'⚔️ チーム戦(20チームバトロワ)でも難易度を選べるようにしました。他の人がいる部屋では「ふつう」になります', g:['feature','multi'] },
  ]},
  { date:'2026-09-04', items:[
    { t:'🎉 シーズン2が始まりました(9/4〜10/1)。段位RPがリセットされます', g:['feature','general'] },
    { t:'✨ シーズン2パスの最終報酬はSSRスキン「怨霊ガノン鳥」です。25段目まで進めると受け取れます(このシーズン限定)', g:['feature','monster'] },
    { t:'✨ 前シーズンの最終報酬だったSSRスキン「大喰いの利世」が、ガチャとSSRカタログで手に入るようになりました', g:['feature','monster'] },
    { t:'🐉 レイド「あるるかん討伐」を開催中です(9/4〜9/17)。舞台はジョーカーの雪山、全員の与ダメージ累計が目標に届くとSSR「あるるかん」がもらえます', g:['feature','multi'] },
    { t:'⚔ あるるかんの技が4つの新技に一新され、威力も全体的に上がりました', g:['monster','balance'] },
    { t:'👥 レイドで仲間の体力が見えるようになり、倒れても近くにいる仲間が助け起こせば復活できます(チーム戦と同じ仕組み)', g:['feature','multi'] },
    { t:'レイドは技が最初から全解放されているので、開始時から大技(tier3)を選んだ状態で始まるようにしました', g:['multi','general'] },
    { t:'レイドの「1人で挑む」を廃止しました。「部屋を作る」は1人でもそのままスタートでき、空いた枠はマスモン・botが埋めます', g:['multi'] },
    { t:'レイドガチャは機械モンスターピックアップです(電王ライナー・メカビオギドラ・メタルグレイモン。装備するとレイドで特効)', g:['feature','monster'] },
    { t:'レイドガチャの累計回数はレイドごとに数え直します。前回100回引いた人も、今回また100回でSSRレイドカタログがもらえます', g:['feature','general'] },
    { t:'✨ SSRスキン「怨霊ガノン鳥」の専用技「魔神炎」を追加しました。黒紫の炎が進むのに合わせて爆風が3連続で起こり、当たった相手を吹き飛ばします(消費ガッツ24→28、撃った直後0.5秒は移動が遅くなります)', g:['monster','balance','av'] },
    { t:'ドラゴンやヒノトリのように横長のモンスターが、他のモンスターに比べて小さく見えていたのを直しました(当たり判定は変わりません)', g:['monster','general'] },
  ]},
  { date:'2026-09-03', items:[
    { t:'✨ SSRスキン「電王ライナー」が登場しました！ レイドガチャとSSRレイドカタログだけで手に入ります(通常のガチャ・SSRカタログには出ません)', g:['feature','monster'] },
    { t:'✨ 前回のレイド限定だったSSRスキン「狂戦士ガッツ」が、通常のガチャとSSRカタログで手に入るようになりました', g:['feature','monster'] },
    { t:'⚡ 電王ライナーの専用技「俺、参上」が、レールを敷いて赤い新幹線を走らせる最長・最速の範囲技になりました(射程1750→2600)', g:['monster','balance','av'] },
    { t:'🐛 ワーム「シェルアタック」が、速い球体が地面を転がっていく範囲技になりました(威力70・射程1750はそのまま。命中で自分が速くなる効果も同じ)', g:['monster','balance','av'] },
  ]},
  { date:'2026-08-31', items:[
    { t:'🆕 新モンスター「ジョーカー」が登場しました！ 技ダメ1.2倍、ダメージの20%ガッツダメージ。tier2「デスカッター」は回転する黒い刃を3連射します。tier3「デスファイナル」は黒い鎌を3方向へ5発ずつ、合わせて15連射。ブレる幅は左右に約26度で、ザンの約6度よりずっと広く散ります', g:['feature','monster'] },
  ]},
  { date:'2026-08-30', items:[
    { t:'✨ SSRスキン「疾風」が登場しました！ tier3「月光ノ刻」は10連射。あわせてザンの「ダークホウスト」も5連射→7連射になりました。どちらも1発ごとに少しだけ横へブレて飛びます(ブレる幅は左右に約6度で、発数が違っても同じくらい。並びは毎回変わります)', g:['feature','monster','balance'] },
  ]},
  { date:'2026-08-29', items:[
    { t:'🏆 リザルト画面を作り直しました。順位は左端の大きな札に出て、何人中何位か(チーム戦はチーム順位)まで分かります。1位は金、2〜3位は銀に札の色が変わります。これまでは入り切らないぶんを画面ごと縮めていました', g:['general'] },
    { t:'📊 リザルトの戦績が5項目になりました。撃破数・与ダメージ・生存時間に加えて、続けざまに倒した最高数(連続撃破)と、試合を終えたときの残りHPが出ます。チーム戦は小隊の欄があるので3項目のままです', g:['general'] },
    { t:'💰 もらった報酬の内訳が出るようになりました。参加・撃破・チャンピオンといった中身と、みんなで対戦やリアルマップの倍率、そして合計が順に並んで数字が動きます', g:['feature','general'] },
    { t:'📊 リザルトにマスモンの経験値バーが出るようになりました。次のレベルまでの残りと、その試合でレベルがいくつ上がってトレーニングチケットを何枚もらえたかが分かります', g:['feature','monster'] },
    { t:'🌈 自己ベストを更新した数字が虹色に光るようになりました。勝っても負けても光ります', g:['general'] },
  ]},
  { date:'2026-08-28', items:[
    { t:'👻 「るすばん報告」が届くようになりました！ ログインしていると、あなたのマスモンは他の人の試合に出かけます。何体たおしたか・誰にやられたかの報告が、ロビーの自分の子の吹き出しと マイページ→るすばん報告 で読めます', g:['feature','general','monster'] },
    { t:'🏆 リザルトが2ページになりました。1枚目は勝敗とその試合のハイライト(初チャンピオン・自己ベスト更新・連続キル・大逆転など)、2枚目に細かい数字とバッジ。スワイプかボタンで切り替えられます', g:['feature','general'] },
    { t:'📖 マスモン詳細に「あゆみ」が加わりました！ ともに戦った試合数・チャンピオン回数・通算キル・出会った日などが、その子ごとに残ります。これまでの試合の記録も引き継いで表示します(ランキング名でログインしていた分。トレーニング回数だけ今日から)。SNSシェアもここからで、画像にあゆみの内容が入ります。マイ記録にあったモンスターごとの記録はこちらへ一本化しました', g:['feature','general'] },
    { t:'🎯 ミッションに「累計」が加わりました！ 上段は「プレイヤー累計」(通算試合数・勝利・キル・ダメージ・遊んだ種族数。段階称号と連動)、下はマスモンごとの累計(試合数・キル・ダメージ・レベル・転生・トレーニング。行をタップで開閉)。報酬はゴールド・ダイヤのほか、後半の段でフリートレチケや💠モン晶。すべて達成するとその種族の覇者称号(「ドラゴンの覇者」など)を獲得できます', g:['feature','general','monster'] },
    { t:'👑 称号が増えました。1試合のキルは40キルまで、1試合のダメージは20000まで段階が伸び、種族ごとの覇者称号も加わりました', g:['feature','general'] },
    { t:'📈 マイ記録が ソロ／マルチ／チーム戦 の3つに分かれました(これまでチーム戦はマルチに混ざっていました。過去のぶんは分けられないため、今日の試合から正しく分かれます)。勝率・通算キル・通算与ダメージも出ます', g:['general','multi'] },
  ]},
  { date:'2026-08-26', items:[
    { t:'✨ SSRスキン「バジリスエゾー」が登場しました！ tier3「真瞳術」は睨みつける赤い眼が相手へ飛んでいき、撃つたびに当たりが変わります ―― 30%で青くなり与えたダメージの50%を回復、10%で紫になり威力1.5倍。鳴き声も当たりごとに変わります。当てたときと相手を倒したときにも専用の音が鳴ります', g:['feature','monster','av','balance'] },
    { t:'🎆 すべての技のエフェクトから、技の上に乗っていた白く光る粒をなくしました。白飛びで潰れていた技の形と色が見えるようになります', g:['av','general'] },
    { t:'⚔️ 技強化チケットとミューテーター「技強化」が、マルチ(部屋を作る／部屋を探す／チーム戦)でも効くようになりました。これまではシングルでしか効いていませんでした。レイドは最初から全部の技が使えるので、チケットは消費しません', g:['fix','multi','balance'] },
    { t:'トレーニング画面で「丈夫さ」がトレ実行ボタンに隠れて見えないことがあったのと、修行チケットが無いときの案内が途中で切れて読めなかったのを直しました', g:['fix','general'] },
    { t:'横向きに持ったまま起動したとき、ロビーの左のボタンが右へあふれて中央が潰れることがあったのを直しました', g:['fix','general'] },
  ]},
  { date:'2026-08-25', items:[
    { t:'💥 ゴッドエンペラーの「デスレーザー」の威力を104→150に上げ、全モンスターの技で単発威力を最大にしました', g:['monster','balance'] },
  ]},
  { date:'2026-08-24', items:[
    { t:'✨ SSRスキン「ゴッドエンペラー」が登場しました！ 3つの技がすべて専用技になります。「デスミサイル」はミサイルを3連射し、当たった場所ごとに小さな爆風が広がります。「デスブレイク」は黒い球を撃ち出し、着弾点に大きなドームの爆風が広がります。「デスレーザー」は岩や山を貫通して射程いっぱいまで届く、細く速いビームで、撃つと専用の音が鳴ります。そのぶん消費ガッツは10・20・30と重めです', g:['feature','monster','balance','av'] },
    { t:'🆕 新モンスター「ナーガ」が登場しました！ 特性は「技の威力が高い」で、3つの技すべてが他のモンスターより高い威力です(真空弾38・連続真空弾20×3・アイビーム83)。技が当たると相手をどく状態にします(10秒間1秒毎に5ダメージ、どくではHPは1残る)。tier3「アイビーム」は岩や山を貫通して射程いっぱいまで届き、伸びが速いかわりに幅は細めです', g:['feature','monster','balance'] },
    { t:'👻 チーム戦の敵に、他の人が育てたマスモン(ゴースト)が出るようになりました。頭の上に持ち主の名前が出ます。これまではソロだけでした。ゴーストが自分の部隊に入ることはありません', g:['feature','multi'] },
    { t:'🧴 ガロエオイルの回復量が「最大HPの割合」になりました。大60%・中40%・小20%です。これまでは固定の量だったので、育ったマスモンほど拾っても効かなくなっていました', g:['balance','general'] },
    { t:'起動したときにロビーの並びが崩れ、ボタンが右へあふれて中央の文字が切れることがあったのを直しました', g:['fix','general'] },
    { t:'マルチで「もう一度」を押した次の試合が、前の試合の勝敗表示が出たまますぐ終わってしまうことがあったのを直しました', g:['fix','multi'] },
    { t:'💪 トレーニングを実行したあとも、選んでいたメニューが選ばれたままになりました。同じトレーニングを続けるときに毎回選び直さなくてよくなります', g:['general'] },
  ]},
  { date:'2026-08-23', items:[
    { t:'🌱 シングルの30人バトロワに難易度「やさしい／ふつう」を追加しました。プレイモードの画面で選べます。やさしいは敵が弱く動き出しも遅く、ダイヤと経験値は入りますが、ランキングと段位RPには記録されません', g:['feature','solo','balance'] },
    { t:'📖 遊び方ガイドに「用語集」を追加しました。ガッツ・安置・適正・段位RP・モン晶・円盤石・覚醒・転生など22項目の意味が読めます。ヘルプからも開けるようにしました(これまで設定の奥にあって見つけられませんでした)', g:['feature','general'] },
    { t:'🏆 ランキングで自分の順位が分かるようになりました。自分の行が光り、50位より下でも一番下に「あなた #順位」が出ます', g:['feature','general'] },
    { t:'⟳ リザルトに「もう一度」を追加しました。マルチでは部屋にいる仲間とそのまま続けて遊べます(部屋を作り直す必要がありません)', g:['feature','multi'] },
    { t:'🚪 チーム戦で倒され、残っている味方がbotだけになったときの観戦画面に「試合を抜ける」を出すようにしました。仲間が残っているあいだは出ません(その人たちの試合が終わってしまうため)', g:['multi','general'] },
    { t:'待機画面が分かりやすくなりました。チーム戦では見出しが「チームメンバーを募集中」になり、あと何人で始まるのか・誰が始めるのかが別の行に出ます。Botの待機枠は1行にまとめました', g:['multi','general'] },
    { t:'部屋を探す画面が5秒ごとに自動で更新されるようになりました。部屋の行にマップ名が出て、「⚡ 空いてる部屋に入る」で人数の多い部屋から順に入れます。部屋に入るときは「参加中…」と出て、連打しても二重に入りません', g:['multi','general'] },
    { t:'圏外のときの表示を直しました。「部屋を作る」を押すと断りなく1人用の試合が始まっていたのをやめ、1人で遊ぶかどうかを選べます。マルチのボタンは沈んで押すと理由が出ます。「募集中の部屋はありません」も、本当に無い場合とつながらない場合で分けて出るようにし、画面の上にも印が出ます', g:['fix','multi'] },
    { t:'📡 マルチの通信の遅れ(ms)を画面の隅に出せるようにしました(設定から入り切り)。ゲスト側で、当たったように見えたのに相手のHPが減らないとき、出したままだった命中の印と数字も消えるようになりました', g:['multi','fix'] },
    { t:'ショップやトレーニングで足りない物があるとき、押しても何も起きなかったのを直しました。何がいくつ足りないか・どこで手に入るかが出ます', g:['fix','general'] },
    { t:'マスモンの詳細で、転生や覚醒ができるようになっているときは、そのボタンが一番上に出るようになりました。マスモン登録の画面には「スキップすると、この試合の経験値は入りません」と出ます', g:['general'] },
    { t:'バトル中のメッセージの黒い帯をなくし、文字だけを縁取りで出すようにしました。画面が見やすくなります', g:['general'] },
    { t:'🔇 音量設定に一括ミュートを追加しました', g:['general'] },
    { t:'ヘッダーの⚙️👤🆕❓のボタンと、画面右上の✕を大きくしました(押し間違いが減ります)。ロビーの小さすぎた文字も読める大きさにし、待機部屋のスクロールとリザルトのボタンの小ささも直しています', g:['general','fix'] },
    { t:'試合中に予告なくアプリが再起動されることが無くなりました。新しいバージョンの用意ができても試合が終わるまで待ち、ロビーなど試合中でない場面で自動的に切り替わります(みなさんが何かを押す必要はありません)', g:['fix','general'] },
  ]},
  { date:'2026-08-22', items:[
    { t:'🎯 FIREボタンを押した指をそのまま滑らせると視点が動くようになりました。右手だけで「撃ちながら狙う」ができます。設定 →「視点設定」でOFFにもできます(はじめはON)。FIREを押したまま指が少しズレても発射が止まらなくなりました', g:['feature','general'] },
    { t:'⚙️設定に「視点設定」を追加しました。視野角とカメラ感度が射撃訓練場の中にしか無く、たどり着けなかったためです。「視点上下反転」もプレイモード選択からこちらへ移しました', g:['general'] },
    { t:'🎯 どこから撃たれたかが分かるようになりました。被弾した方向に画面の外周が光ります', g:['feature','general'] },
    { t:'⚔️ 敵に当てたときに照準へ×印が出て、音も鳴るようになりました。ソロでは当たった手がかりが小さな数字だけでした。近接技の空振りにも音が付きます', g:['feature','general'] },
    { t:'⏱️ 安全圏が縮む10秒前に予告が出るようになりました。やけど・鈍足・どくにも残り時間を表示します(こおりに続いて)', g:['feature','general'] },
    { t:'リザルトに「誰に倒されたか」が出るようになりました', g:['feature','general'] },
    { t:'ロビーに「🐾 マスモン」を追加しました。育成画面へ直接行けます', g:['general'] },
    { t:'🔍 岩や山ごしでも照準が赤くなり「当たる」と思って撃ってしまう不具合を直しました。ガッツが足りないときはFIREボタンが灰色になります', g:['fix','general'] },
    { t:'ダメージの数字に縁取りを付けて読みやすくしました。マルチでは残り人数のうち何人が人間かも出ます', g:['general','multi'] },
    { t:'トレーニングカードが照準の真上を塞いでいたのを、下寄りへ移しました', g:['fix','general'] },
    { t:'安置までの距離が実際の10倍の数字で出ていたのを直しました', g:['fix','general'] },
    { t:'ノッチやホームバーの下にHUDが潜らないようにしました(iPhone X以降)', g:['fix','general'] },
    { t:'🔧 マルチの部屋が「募集中の部屋はありません」になったまま見つからなくなる不具合を直しました。人の出入りで部屋の人数が実際より多く数えられ、誰も居ないのに満員扱いになっていたのが原因です。ロビーに出る待機人数も正しくなります', g:['fix','multi'] },
    { t:'ホストの通信が切れたときに、待っている人がずっと待たされたり、試合中に世界が止まったまま抜けられなくなる不具合を直しました。切れたと分かった時点でお知らせを出し、リザルトへ進めます。通信が切れた相手のモンスターが最後に入力した方向へ走り続けるのも直っています', g:['fix','multi'] },
    { t:'2本目の指が画面に触れると視点が動かなくなる不具合を直しました。視点は先に触れている指が最後まで操作します', g:['fix','general'] },
    { t:'こおり中はFIRE・ダッシュ・技のボタンが灰色になり、押してもダッシュのクールタイムを無駄にしなくなりました。解けた瞬間に勝手に飛び出すこともありません。残り時間も表示されます', g:['fix','balance'] },
    { t:'起動のたびにお知らせが2枚続けて出ていたのをやめました。お知らせは一度閉じると出なくなり、新しいものが来たときだけ出ます', g:['general'] },
    { t:'ログインとログアウトのときに確認をはさむようにしました。すでに遊んでいる端末で別のアカウントに入ると中身が入れ替わるので、消えるものを先に表示します', g:['fix','general'] },
  ]},
  { date:'2026-08-20', items:[
    { t:'✨ SSRスキン「メカビオギドラ」が登場しました！', g:['feature','monster'] },
  ]},
  { date:'2026-08-19', items:[
    { t:'⚔️ tier3技(各モンスターの最後の技)の強さを見直しました。弱かった技をまとめて引き上げ、技どうしの差を約7倍から約1.8倍まで縮めています', g:['balance','monster'] },
    { t:'とくに大きく強くなった技: ゴーレム「竜巻アタック」(3本の間隔を詰めて当たりやすく・威力21→34・弾速520→760)、モッチー「モッチ砲」(威力46→86・幅120→220)、キュービ「天河天翔」(威力48→74・幅160→200)、ライガー「超雷撃」(威力40→64・幅110→150)', g:['balance','monster'] },
    { t:'爆風を持たない技の弾が速くなりました。ワーム「シェルアタック」500→760、ガリ「ゴッドライジング」600→820、ザン「ダークホウスト」820→900', g:['balance','monster'] },
    { t:'キジン「羅生門」の吸い込む炎のダメージを47→30に下げました。門の爆風はそのままです', g:['balance','monster'] },
    { t:'技一覧の「威力」で、キジン「羅生門」の吸い込む炎のダメージが数えられていなかったのを直しました(実際のダメージは前から入っていました)', g:['fix','general'] },
    { t:'チーム戦で部屋を作ると、待機画面の自分の斜め後ろ左右にチームメンバーのモンスターが並ぶようになりました。歩行モーションが付き、他のプレイヤーが参加してメンバーが変わると表示も自動で切り替わります(シングルのマルチPvPでは表示しません)。あわせて「対戦相手を探しています…」のパネルに隠れて見えなかったのと、文字・ボタンが2行に折れていたのも直しています', g:['general','multi','fix'] },
    { t:'チーム戦を部屋を使わず1人で始める「ソロ出撃」を廃止しました。チーム戦は部屋を作って遊んでください', g:['general','multi'] },
    { t:'部屋の待機画面のBot待機枠に、実際に参戦する自分のマスモンが表示されるようになりました(他のプレイヤーが参加すると弾かれます)。表示と実際の参戦が食い違う不具合も直しています。チーム戦では、部屋作成者が連れてくる自分の他のマスモンが自分のチームへ優先的に入ります', g:['fix','multi'] },
    { t:'チーム戦のキル数・キルボーナス(HP・ガッツ回復)を、とどめを刺した人ではなく相手をダウンさせた人に入るようにしました', g:['fix','multi','balance'] },
    { t:'観戦画面(自分が倒された後)の視点・ミニマップ・技表示が自分のものと見ている相手のもので食い違っていた不具合を修正しました。視点は見ている相手の向きに、安置内外の表示やミニマップの自分位置、HP・技・クールタイムなどの表示もすべて見ている相手のものに揃うようにしました', g:['fix','multi'] },
    { t:'チーム戦で味方や敵が岩・水晶などにたまってその場から動けなくなる不具合を修正しました。倒れた相手が落とす円盤石も、障害物に埋もれて取れなくなることがないようにしました', g:['fix','multi'] },
  ]},
  { date:'2026-08-18', items:[
    { t:'チーム戦の試合BGMが、残り人数ではなく残り部隊数で盛り上がるようになりました。同じ部隊の仲間が次々倒れても曲は動かず、部隊が丸ごと脱落したときだけ盛り上がります', g:['multi','av'] },
    { t:'設定の「画面カスタマイズ」で、チーム戦のピンボタンも位置とサイズを変えられるようになりました', g:['multi','general'] },
    { t:'🔰 はじめて遊ぶ方向けのチュートリアルを追加しました。モンスター選び→練習バトル→マスモン登録→育成→アカウント作成→無料10連ガチャ→着せ替えまで、順番に案内します', g:['feature','general'] },
    { t:'チュートリアルの10連ガチャは無料で、登録したマスモンのスキンが1つ必ず出ます。最後まで進めるとダイヤ60・トレーニングチケット3枚・称号「新人モン動」を受け取れます', g:['feature'] },
    { t:'チュートリアルの練習バトルは10体・短めの安置で、相手も控えめの強さにしてあります(通常のバトルは今までどおりです)', g:['balance','solo'] },
    { t:'ヘルプに「はじめての説明をもう一度」を追加しました', g:['general'] },
  ]},
  { date:'2026-08-17', items:[
    { t:'バトルに出る自分以外のモンスター(bot・ゴースト・自分の他のマスモン)が、自分が使っているマスモンのステータス合計を超えなくなりました。育ちきった相手が出てきても、こちらより数字の上で強いことはありません', g:['balance','solo','multi'] },
    { t:'🎒 バッグを使いやすくしました。左のアイテム欄だけがスクロールするようになり、説明と「使用する」は常に画面の中に見えます', g:['general'] },
    { t:'バッグの右のマスモン一覧は、選ぶまでステータスを閉じて一度に多くの子が見えるようになりました。選んだ子はステータスが開いた状態で一番上に固定され、左のアイテムを変えても動きません', g:['general'] },
    { t:'バッグで使えない相手が選べなくなりました(遠征中の子、ステータスが上限に届いている子)。理由も名前の横に出ます', g:['general'] },
    { t:'📯帰還のホラ貝をバッグから使えるようにしました。遠征に出ている子だけが選べる状態で並び、使うとその場で帰ってきて、受け取りのために遠征画面へ行くボタンが出ます', g:['general','feature'] },
    { t:'✨ SSRスキン「秦の怪鳥」が登場しました！', g:['feature','monster'] },
    { t:'「秦の怪鳥」にバトル開始の召喚演出の専用SEを追加しました', g:['monster','av'] },
    { t:'ギャラリーのミュージアムで、召喚演出の専用SEも聴けるようになりました(「ちょこ」「秦の怪鳥」)', g:['av','general'] },
    { t:'マスモンの名前を変えたあと、モンスターが小さくなったり選択のポップアップが途切れたりしていたのを直しました。キーボードを閉じたときの画面の大きさの測り方が原因でした', g:['fix','general'] },
    { t:'🎰 スキンガチャが「荒モン100%ダブルピックアップ」になりました！ ピックアップは「北大路さつキジン」と「西野ピかさ」の2体で、SSR全体2%のうちこの2体で合わせて1%(各0.5%)、他のSSRが合わせて1%です', g:['feature','general'] },
    { t:'✨ SSRスキン「西野ピかさ」が登場しました！ ピクシーのスキンです', g:['feature','monster'] },
    { t:'「西野ピかさ」がモッチーのスキンとして登録されていたのを、ピクシーのスキンに直しました。すでに持っている方はピクシーの着せ替えに並びます', g:['fix','monster'] },
    { t:'「西野ピかさ」のtier3「ずっとずっとキミのことが好き!!」の弾が赤いいちごになりました。電撃・輪・着弾のドームはこれまでどおりです。技の威力・射程・弾速・爆風の広さは変わりません', g:['av','monster'] },
    { t:'「西野ピかさ」にキル時・勝利時の専用SEを追加しました', g:['monster','av'] },
    { t:'「西野ピかさ」に専用BGMを追加しました。残り6人以上・残り5人以下は「北大路さつキジン」と同じ曲で、残り2人だけ専用の曲になります', g:['av','monster'] },
    { t:'「北大路さつキジン」の専用BGMを1段ずつずらしました。残り6人以上でこれまでの残り5人以下の曲、残り5人以下でこれまでの残り2人の曲が流れ、残り2人は新しい曲になります', g:['av','monster'] },
    { t:'アークの「天の慈悲」に、着弾点から広がるドーム状の爆風を追加しました(半径240・威力24)。直撃58と合わせて最大82になります', g:['balance','monster'] },
    { t:'スキンを着てもtier3の技がオーラの色にならないことがあったのを直しました。白・黒のオーラだけ技の色が変わらず、素の技と同じ見た目のままでした(「天衣無縫」「終焉に救いを」「ラガモッチ砲」「ドラゴンころし」「言葉は無粋」)', g:['fix','av','monster'] },
    { t:'キジンの「羅生門」で、吸い込む技なのに火の粉が前へ飛び出していたのを直しました。炎の壁が奥から門へ迫るのに合わせて、火の粉・地面の痕・光の帯も門へ向かって流れます', g:['fix','av'] },
    { t:'ビーム系の技(モッチ砲・天河天翔・フラワービーム・熱視線)が、正面へ撃つと細い1本の線にしか見えなかったのを直しました。当たる範囲と同じ太さの筒が、奥へ伸びる光のトンネルとして出ます', g:['fix','av'] },
    { t:'ケンタウロスの「メテオドライブ」の見た目を、ピクシーの「ビッグバン」と同じ吸い込む球+ドームの爆風に変えました。威力・射程・弾速・3連射・爆風の広さはこれまでと同じです', g:['av','monster'] },
  ]},
  { date:'2026-08-16', items:[
    { t:'🆕 新モンスター「ケンタウロス」が登場しました！ 技の射程が長く、弾速が速い', g:['feature','monster'] },
    { t:'✨ 技のエフェクトを刷新しました。技の粒・尾・地面に残る痕をGPUで描く層を足し、炎は舞い上がる火の粉と落ちる煤、水は波紋と砕ける結晶、草は舞う葉と胞子、雷は地面を這う枝分かれ、岩は落ちて跳ねる破片と土煙、光は降る羽根、闇は吸い込まれる紫、神は4色の球がそれぞれの色で咲く、というように属性ごとに作り分けています', g:['av'] },
    { t:'技が当たったとき、画面が短く揺れて一瞬明るくなるようになりました(酔わないよう0.12秒以内・揺れ幅は画面の1%以内で、遠くの爆発では揺れません)', g:['av'] },
    { t:'必殺技(tier3)の見た目を当たる範囲に合わせました。前へ撃つ技は当たる範囲がそのまま地面に光の帯として出るので、どこまで届くか・どこに立つと当たるかが目で分かります。技の威力・射程・弾速・範囲はこれまでと同じです', g:['av','balance'] },
  ]},
  { date:'2026-08-15', items:[
    { t:'🆕 モン晶(💠)が登場! ガチャで持っているスキンが出たときのダイヤの代わりに、SRで1個・SSRで5個もらえます。ショップの「💠モン晶こうかん」タブでプレミアムなアイテムと交換できます', g:['feature'] },
    { t:'🆕 秘伝の書: モン晶100個で交換できる技強化アイテム。今着ているスキンのtier3技に「威力+12%」「射程+12%」「弾速+20%」などの強化を1つ付けられます。覚醒と重ねがけできます。強化先を変えるときは新しい秘伝の書が1冊必要です', g:['feature','balance'] },
    { t:'💠交換所には他にスキンカタログ(300個)・フリートレーニングチケット5枚(20個)・帰還のホラ貝3個(15個)を並べました', g:['feature'] },
    { t:'ダイヤの入手量を全体的に増やしました(試合の参加報酬 5→8、チャンピオン 10→15、ログインボーナス、デイリー、遠征の当たり枠、レイドの周回報酬)。被りでダイヤがもらえなくなったぶんの埋め合わせです', g:['balance'] },
    { t:'🏆 ランキングに「チーム戦」タブが増えました。チーム戦の撃破数・ダメージはシングルとは別に集計されます(仲間と分け合う試合の記録を1人で戦う記録と同じ表で競わせないため)', g:['feature','multi'] },
    { t:'デス円盤石の力を、拾った1人の総取りではなく生きている小隊全員で山分けするようになりました(3人そろっていれば3等分)。拾いに行く価値がチーム全体のものになります', g:['balance','multi'] },
    { t:'デス円盤石の見た目を、ガチャ・召喚演出と同じ円盤石の絵に変えました', g:['av'] },
    { t:'チーム戦のヘッダーに「残り部隊数」と「残り人数」を出すようにしました', g:['multi'] },
    { t:'ダウン中の移動速度を通常の10%にしました(以前は30%)。這って逃げ切るのが難しくなり、仲間の蘇生がより大事になります', g:['balance','multi'] },
    { t:'転生を重ねるほどレベルアップに必要なEXPが増えるようになりました(転生1回ごとに1.5倍→2倍→2.5倍…)。転生回数はマスモン詳細の「必要EXP倍率」で確認できます', g:['balance'] },
    { t:'転生でもらえる基礎HP・基礎移動速度の上がり幅が、回を追うごとに小さくなりました(+10→+8→+6→+4→+2)。すでに転生済みのマスモンにも適用されます。合計はマスモン詳細の「転生ボーナス」で確認できます', g:['balance'] },
    { t:'転生できる回数を5回までにしました。5回まで転生したマスモンは、★の代わりに👑が付きます', g:['balance','feature'] },
    { t:'覚醒スキンでも元のSSRスキンの専用BGM・専用SEが鳴るようになりました(「北大路さつキジン」「狂戦士ガッツ」の覚醒で確認)', g:['fix','av'] },
    { t:'リザルト画面で「トップ画面へ」などのボタンが画面の外へ出て押せなくなることがあったのを直しました。中身が増えても必ず1画面に収まります', g:['fix'] },
    { t:'ホスト以外(部屋に入った側)で、修行チケットを取っても技が解放されず tier1 の技しか撃てなかったのを直しました。試合中の強さの変化(移動速度・トレーニングカード・状態変化)も届いていなかったので、あわせて直っています', g:['fix','multi'] },
    { t:'ホスト以外で、移動速度の高いマスモンを使うと勝手に前へ走り出して行ったり来たりすることがあったのを直しました。位置合わせの許容が、転生や加速剤で上がった移動速度に追いついていませんでした', g:['fix','multi'] },
    { t:'ジョイスティックを前へ倒して離すだけでオートランが点いてしまうことがあったのを直しました。発動は今までどおり「素早く上へ2回弾く」だけです', g:['fix'] },
    { t:'チーム戦で、岩や水晶の中に埋まって動かなくなるモンスターがいたのを直しました。チーム戦のスポーンだけが岩を避けていなかったことと、押し合いで障害物に押し込まれても抜け出せないことが原因でした', g:['fix','multi'] },
  ]},
  { date:'2026-08-14', items:[
    { t:'🆕 プレイモードを「シングル/チーム戦/レイド」に整理しました。シングル=30人バトロワ・マルチPvP(2〜4人)、チーム戦=20チームバトロワ(3人1組×20の60体)・バトルアリーナ、レイドは3人チームになります', g:['feature'] },
    { t:'🆕 バトルアリーナが登場! 3人1組の1チームvs1チーム。狭い決着圏で最初からぶつかり合う、3分以内の短期決戦モードです', g:['feature','multi'] },
    { t:'🆕 デス円盤石: 倒されたモンスターが試合中のトレーニング強化を「円盤石」として落とします。誰でも拾えて即強化! 拾った力も自分が倒されればまた落ちる=力が試合の中を巡ります(光の色: 敵の遺物=赤/味方=緑)', g:['feature'] },
    { t:'🆕 チーム戦にピン(合図)を追加。🎯ボタン1つで「敵発見!」や「ここへ!」を仲間に伝えられます(旗マーカー+ミニマップ)。キル数トップには👑が付きます', g:['feature','multi'] },
    { t:'🆕 スクワッド(3人1組のチーム戦)が遊べるようになりました。ソロでもマルチでもチーム編成から選べます。倒れても「ダウン」で踏みとどまり、仲間が近くにいてくれれば蘇生。チームの全滅で決着し、順位もチーム単位になります', g:['feature','multi'] },
    { t:'🆕 マルチプレイの通信を高速化しました。対応する環境では端末同士を直接つないで、撃った・当たったの反応が速くなります(つながらない場合も今までどおり遊べます)', g:['multi'] },
    { t:'マルチのゲスト側でも、命中の印(ヒットマーカー)やダメージの数字がすぐに表示されるようになりました', g:['multi','av'] },
    { t:'乱戦でダメージの数字どうしが重なって読めなくなるのを直しました', g:['fix','av'] },
    { t:'✵ 「北大路さつキジン」に覚醒の姿が追加されました！ 転生2回以上・全ステータス800以上のマスモンがこのスキンを装備していると覚醒でき、tier3の技を1つ選んで強化できます', g:['feature','monster'] },
  ]},
  { date:'2026-08-13', items:[
    { t:'リアルマップで、丘や大きな物の向こうにある安置線・技の予告円が透けて見えていたのを直しました。地面の起伏に隠れるようになります', g:['fix','av'] },
    { t:'リアルマップの地面の模様が立体的すぎて、隠れられる岩と見分けにくかったのを直しました。模様は平らに、隠れられる岩は陰影と足元の影ではっきり分かるようになります', g:['fix','av'] },
    { t:'リアルマップで足元に撒いていた飾りの小石をやめました。本物の岩と同じ形・色なのに隠れられず紛らわしかったためで、これからは見えている岩はすべて隠れられる岩です', g:['fix','av'] },
    { t:'雪原と火山にあった「雪の塊・灰の塊」の飾りをやめ、枯れ草に置き換えました。岩に見えるのに隠れられなかったためで、リアルマップで岩に見える物はすべて隠れられる岩になります', g:['fix','av'] },
    { t:'リアルマップで、山の向こうにある技のエフェクトが透けて見えていたのを直しました', g:['fix','av'] },
    { t:'リアルマップの山肌を作り直しました。雪山は雪の白さに黒い岩の崖、火山は黒い山体、森の山は緑に岩の尾根と、山ごとの姿がはっきり出るようになります(迷彩柄に見えていたのを解消)', g:['av'] },
    { t:'雪原の岩が雪と同じ白さで平らな模様に見えていたのを直しました。地面との明暗差を広げ、雪のかぶり方を控えめにしています', g:['fix','av'] },
    { t:'リアルマップの雪山・火山などの大きな山で、見えている山肌より手前で止められたり技が消えたりしていたのを直しました。山のふもとの当たり判定が見た目とぴったり一致します', g:['fix','av'] },
    { t:'🆕 リアルマップに身を隠せる人工物(崩れた石壁・貨物コンテナ・遺跡の石柱・小屋)が現れるようになりました', g:['feature','av'] },
    { t:'🆕 リアルマップの見た目を全面的に作り直しました。空に太陽と流れる雲が入り、遠くの山並みに起伏と陰影が付きました', g:['feature','av'] },
    { t:'リアルマップの地面に砂利・ひび割れ・風紋・落ち葉などの質感が入り、遠くの地面ものっぺりしなくなりました', g:['av'] },
    { t:'リアルマップに草・低木・小石が生えるようになりました。風で揺れます(通り抜けられる飾りで、当たり判定はありません)', g:['feature','av'] },
    { t:'リアルマップの水を作り直しました。深さで色が変わり、空を映し、岸で波が泡立ちます。溶岩も黒い地殻の割れ目が光る見た目になりました', g:['av'] },
    { t:'リアルマップのマップごとの色合いを調整しました。特に密林は空まで緑だったのを、青い空と緑の地面に分けています', g:['av'] },
  ]},
  { date:'2026-08-12', items:[
    { t:'SSRスキン「ラガモッチー」がガチャで入手できるようになりました', g:['feature'] },
    { t:'🆕 ロビーに「ギャラリー」を追加しました。獲得したスキンの鑑賞・着せ替えへのジャンプ、SSRスキンの専用ムービー・BGM・SEを見聞きできる「ミュージアム」が使えます', g:['feature'] },
    { t:'SSRスキン「北大路さつキジン」にキル時・勝利時の専用SEを追加しました', g:['monster','av'] },
    { t:'✨ SSRスキン「北大路さつキジン」が登場しました！', g:['feature','monster'] },
    { t:'🆕 新モンスター「キジン」が登場しました！ 与ダメ1.2倍、技が当たった相手を10秒間やけど状態にする', g:['feature','monster'] },
    { t:'キジンのtier2技「阿修羅」のオーラが赤に変わり、6連射になりました', g:['monster','balance'] },
    { t:'キジンのtier3技「羅生門」が一新されました。目の前に門が現れ、奥から迫る炎が範囲内の敵を門の前まで引き寄せ、炎が門に届くと爆風でダメージを与えます', g:['monster','balance','av'] },
    { t:'キジンのtier3技「羅生門」を調整しました。迫る炎に触れた瞬間にもダメージが入るようになり、門の位置が少し自分の近くになりました', g:['monster','balance'] },
    { t:'ロビーのモンスター表示に、正面と後ろ姿を切り替えられるボタンを追加しました', g:['feature','av'] },
  ]},
  { date:'2026-08-11', items:[
    { t:'✵ 「狂戦士ガッツ」に覚醒の姿が追加されました！ 転生2回以上・全ステータス800以上のマスモンがこのスキンを装備していると覚醒でき、tier3の技を1つ選んで強化できます', g:['feature','monster'] },
    { t:'✵ 覚醒に専用の演出を追加しました。元の姿が光に包まれ、閃光とともに覚醒後の姿へ入れ替わります。最後に「何を強化したか」も出ます', g:['feature','av'] },
    { t:'✵ 覚醒したあと、技の名前が通常の名前に戻ってしまう不具合を修正しました。SSRスキンの専用技名と威力アップも覚醒後の姿に引き継がれます', g:['fix','balance'] },
    { t:'✵ 覚醒したあと、マスモンのカードとロビーのカードに新しい姿がすぐ反映されない不具合を修正しました', g:['fix'] },
    { t:'✵ 覚醒できるようになると、マスモンのカードに印が出て、メニューの一番上に覚醒ボタンが出るようになりました', g:['general'] },
    { t:'✵ 技一覧で、覚醒の強化によって何がどれだけ上がったのかを「54 → 70」のように出すようにしました', g:['general'] },
    { t:'🧭 遠征中の画面で、送り出した子が向こうで頑張っている様子を見られるようになりました。行き先ごとの景色の中を歩き、いま何をしているかが流れ、進み具合にあわせて背中の袋の中身が増えていきます', g:['av','general'] },
    { t:'🏅 ロビーの右上に段位パネルを追加しました。今の段位・RP・次の段位まであと何RPかが一目で分かります', g:['feature','general'] },
    { t:'ロビー左のメニューを2列にしました。ボタンが縦に潰れて押しづらかったのを、アイコンと名前を縦に並べた大きめのボタンに変えています', g:['general'] },
    { t:'🏋️ トレーニングで変わった数値が、試合中ずっと左上のプレイヤー欄にまとめて出るようになりました。カードで取ったぶんも拾ったアイテムのぶんも合計して「最大HP +39%」のように表示します', g:['feature','general'] },
    { t:'🏅 ランキングの「段位」タブがキル数ランキングのままになっていた不具合を修正しました。プレイヤー名を主役に、今の段位とRPが並ぶようになりました', g:['fix','general'] },
    { t:'🏅 ランキングの「段位」に、モンスターの種類ごとにどれだけRPを稼いだかの集計が出るようになりました。「モンスター別RP」タブでは、どの子でRPを伸ばしたかを競えます', g:['feature','general'] },
  ]},
  { date:'2026-08-10', items:[
    { t:'🏋️ トレーニングカードの効果が、ステータスの上限（999など）に関係なく上がるようになりました。育てきったマスモンでもカードが無駄になりません（試合が終われば必ず元に戻ります）', g:['balance','fix'] },
    { t:'🏋️ トレーニングカードの表示を「ライフ+108」ではなく「最大HP +24%」のように、実際にどれだけ強くなるかで出すようにしました', g:['general','av'] },
    { t:'移動しながら（スティックを握ったまま）でもトレーニングカードを選べるようにしました', g:['fix'] },
    { t:'🏋️ トレーニングの選択が、撃破/ダメージ表示のすぐ下に横長で出るようになりました。位置と大きさは設定の「操作画面カスタマイズ」で変えられます', g:['feature','av'] },
    { t:'縦画面ロックのときにエモートのエフェクトが出る位置がズレる不具合を修正しました', g:['fix','av'] },
    { t:'参戦中のマスモンを遠征に出したとき、参戦の選択が中途半端に残る不具合を修正しました', g:['fix'] },
    { t:'🏅 段位を追加しました！ 試合の順位と撃破数でランクポイント(RP)が増え、見習い→石→銅→銀→金→白金→ダイヤ→覇王 と上がっていきます。ソロ・マルチ・レイドのすべてで動きます(ソロはbotが相手なので半分)。**一度上がった段位からは落ちません。** ロビー上部とマイページ、ランキングの「段位」タブで確認できます', g:['feature','general'] },
    { t:'👻 ソロの敵に「他のプレイヤーが育てたマスモンの写し」が混ざるようになりました。名前の上に持ち主が出て、★が付いた金色の名前で分かります。倒すと経験値が多めにもらえます（自分のマスモンのレベル±15の相手だけが出るので、いきなり強すぎる相手は来ません）', g:['feature','solo'] },
    { t:'マルチで出るホストのマスモンbotに、転生の回数と適正・基礎値アイテムが反映されていなかったのを直しました。育てたぶんがそのまま強さに出ます', g:['fix','multi'] },
    { t:'🏋️ トレーニングアイテムを拾うと、その場で「トレーニングを3つから1つ選ぶ」ようになりました。中身はマスモンのトレーニングとまったく同じ10種類で、上がり幅は試合中でもはっきり分かる大きさです。適正の高いステータスほど大きく伸びるので、育てた個性が試合中の選択に出ます', g:['feature','balance','solo','multi'] },
    { t:'これまでのトレーニングアイテムの固定効果（技ダメージ+16%など）は、上のカード選択に置き換わりました。落ちている数は今までと同じです。カードは8秒で自動的に決まるので、戦いながらでも困りません', g:['balance'] },
    { t:'🧭 遠征を追加しました！ ロビー左の「遠征」からマスモンを送り出すと、数時間後に育成アイテム・EXP・当たり枠を持ち帰ります。行き先ごとに相性のよいステータスがあり、★が高いほど成果が増えます。遠征中の子はバトル・トレーニング・アイテムに使えません', g:['feature','general'] },
    { t:'遠征の枠はマスモンの所持数で増えます（1体で1枠・3体で2枠・6体で3枠）。「📯帰還のホラ貝」を使うと残り時間0ですぐ帰らせられます（ショップ・ガチャ・遠征の当たり枠で手に入ります）', g:['feature','general'] },
    { t:'😊 エモートを追加しました！ ロビーのモンスターの下のボタンで「よろこぶ・しょんぼり・おこる」の反応が出せます。試合の結果画面でも勝ち負けに合わせて自動で反応し、マスモン詳細ではカードをタップすると反応します', g:['feature','general'] },
    { t:'❤️ エモートに「だいすき」が増え、4種類すべての動きを作り直しました。しっかり跳ねて、着地でつぶれて、反動で伸びる動きになり、エモートごとの効果音とエフェクト(舞い上がる・落ちる・弾ける)が付きます', g:['feature','av'] },
    { t:'縦持ちのときにエモートのエフェクトが横を向いてしまう不具合を修正しました', g:['fix','av'] },
  ]},
  { date:'2026-08-09', items:[
    { t:'【レイド】ボスの残り体力を討伐(累計2,500,000ダメージ)まで削りきったあとは、累計ダメージと次の繰り返し報酬(3,500,000→4,500,000…と100万ずつ増えていきます)の表示に切り替わるようにしました', g:['feature','multi'] },
    { t:'ランキングに「マスモン」タブを追加しました。マスモンLv・転生回数・ステータス合計の3種類が見られます。マスモンLvは通常マップ・リアルマップのタブからは無くなり、このタブに移りました', g:['feature','general'] },
    { t:'✨ SSRスキン「メタルグレイモン」が登場しました！ tier3技「ギガデストロイヤー」は黒い核弾頭を2発発射し、着弾で大きなドーム状の爆風を起こす技です', g:['feature','monster'] },
    { t:'マップで「ランダム」＋「リアルマップ」を選んでいると、通常の対戦のつもりがレイドバトルとして始まってしまう不具合を修正しました。ランダムの抽選にレイド専用の「竜の火口」が混ざっていたのが原因です', g:['fix','multi','solo'] },
    { t:'選んだプレイモードと実際に始まる試合が食い違う不具合を修正しました。「みんなと対戦」のつもりがレイドで始まる／レイドのつもりが通常の対戦になる／試合のあとロビーから続けて始めると前と違うモードになる、のすべてが直っています', g:['fix','multi'] },
    { t:'✨ SSRスキン「ガルルモン」が登場しました！ tier3技「フォックスファイアー」は青い炎を30度の扇状に吐くブレス技です', g:['feature','monster'] },
    { t:'【レイド】ボスの攻撃予告を少し長くし、実際に当たる範囲を輪の中まで光らせて分かりやすくしました。予告中はボスも動かなくなるので、見せた範囲より大きい攻撃が来ることはありません', g:['fix','balance'] },
    { t:'🐹 新モンスター「ハム」が登場しました！ 技の弾速がとても速いかわりに射程が短い、近づいて戦うタイプです。tier3「暗けい」は手のひらを飛ばして炸裂させます', g:['feature','monster'] },
    { t:'🎉 SNSへのシェア機能を追加しました！ 成績やマスモンを1枚の画像にして投稿できます。リザルト・マスモン詳細・ランキング・レイドランキング・ガチャ結果・SSR獲得画面の6か所に「SNSでシェア」ボタンがあります', g:['feature','general'] },
  ]},
  { date:'2026-08-08', items:[
    { t:'【レイド】残り時間が0になっても試合が終わらないことがある不具合を修正しました。全てのモードで、時間切れ・全滅・討伐のいずれかで必ず終わります', g:['fix'] },
    { t:'【レイド】自分が力尽きても、残っている味方の視点で観戦できるようになりました（ソロ・マルチとも）。「次のプレイヤー」で見る相手を切り替えられます', g:['feature'] },
    { t:'前回えらんだマップ・プレイモード・参戦モンスターが記憶されず、毎回はじめの状態で始まってしまう不具合を修正しました', g:['fix'] },
  ]},
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
    { t:'ロビーの「レイド」と「プレイモード」に、募集中の部屋で待っている人数が出るようになりました。誰かが部屋を立てているとすぐ分かります', g:['feature','multi'] },
    { t:'【レイド】最後の報酬を受け取ったあとも報酬が増え続けるようになりました。あなたの累計10万ごとに🪙1,000💎20🎟️1、みんなの累計100万ごとに🪙5,000💎50🎟️5。レイド画面を開いた時点で自動で受け取れます（すでに超えているぶんもまとめて入ります）', g:['balance','feature'] },
    { t:'【転生】2回目以降も伸び続けるようになりました。適正はSの上に S+ → SS → SS+ → M（虹色・最上位）が加わり、ステータス上限は転生1回につき+100（999→1099→1199…）になります', g:['feature','balance'] },
    { t:'【転生】ソロプレイの敵も、使っているマスモンの転生回数に応じて強くなります。転生しても歯ごたえが変わらないようにするためです', g:['balance','solo'] },
    { t:'ロビーで流れる曲を選べるようになりました。ヘッダーの🎵から、いちか・オリジナル・決戦・ラストバトル・ショップ・訓練場と、持っているSSRスキンの専用曲(3区分)を選べます。選んだ曲は次回以降も流れます', g:['feature','av'] },
    { t:'前回えらんだマップ・プレイモード・参戦モンスターを憶えておき、次に開いたときはその状態から始まるようになりました', g:['feature','general'] },
    { t:'プレイモードで「みんなと対戦」「レイドバトル」のふきだし部分を押しても選べていなかった不具合を修正しました(レイドを選んだのにロビーの表示が変わらないのはこれが原因です)', g:['fix'] },
    { t:'バッグでフリートレーニングチケットを使うと、そのマスモンのトレーニング画面へ直接飛べるボタンが出るようになりました。マスモン一覧のスクロール位置が飛ぶ不具合も直しています', g:['feature','fix'] },
    { t:'タップした場所に波紋が出て、ボタンも押し込まれるようになりました。どこを押したか分かりやすくなります(試合中の操作には出ません)', g:['av'] },
    { t:'一部の端末でタイトルが「読み込み中」から進まなくなる不具合を修正しました', g:['fix'] },
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

/* 回復量は**最大HPの割合**(発注者指定・2026-08-24)。固定値だと育ったマスモンほど効かなくなり、
   終盤ほど拾う意味が薄れていた。maxBoost は「HPが満タンのときに代わりに上がる上限」で、
   こちらは固定のまま(割合にすると拾うたびに上限が増え、その増えた上限にまた割合が乗って際限なく伸びる)。
   実際の回復量は healItemAmount() 1か所で出す。表示も同じ関数を通すこと。 */
const HEAL_ITEMS = {
  oilS: { name:'小ガロエオイル', healPct:0.2, maxBoost:4,  color:'#9b6b2f', accent:'#e8c873', size:0.8  },
  oilM: { name:'中ガロエオイル', healPct:0.4, maxBoost:9,  color:'#b9802f', accent:'#f0d27a', size:1.05 },
  oilL: { name:'大ガロエオイル', healPct:0.6, maxBoost:16, color:'#d99a2b', accent:'#ffe28a', size:1.35 },
};
// このアイテムがこのモンスターを回復する量(最大HPの割合。下限1)
function healItemAmount(hi, ent){
  const maxHp = (ent && ent.maxHp) || 100;
  return Math.max(1, Math.round(maxHp * (hi.healPct || 0)));
}
// 一覧・拾い物の表示用(相手が決まっていないので割合のまま出す)
function healItemPctText(hi){ return Math.round((hi.healPct || 0) * 100) + '%'; }
const HEAL_TYPES = Object.keys(HEAL_ITEMS);

/* ===== トレーニングアイテム(出現率は低め=たまに来るご褒美) =====
   拾うと**トレーニングを3つ提示して1つ選ぶ**。効果の正は下の TRAINING_MENU 1つで、
   ロビーの育成とまったく同じ言葉・同じ増減が試合中にも効く(同じ意味の表を2つ持たない)。
   `menu` は「必ず候補に入る1枚」。アイテムの見た目と結果がつながるようにしてある。 */
const TRAINING_ITEMS = {
  weight:   { name:'重り引き', emoji:'🏋️', color:'#c97b3d', accent:'#ffd9a8', menu:'weight', desc:'3つのトレーニングから1つ選ぶ' },
  meditate: { name:'めいそう', emoji:'🧘', color:'#7bd1c9', accent:'#d8fff8', menu:'medit',  desc:'3つのトレーニングから1つ選ぶ' },
  pool:     { name:'プール',   emoji:'🏊', color:'#3d9fd1', accent:'#bfe9ff', menu:'pool',   desc:'3つのトレーニングから1つ選ぶ' },
  floor:    { name:'変動ゆか', emoji:'💃', color:'#d13d9f', accent:'#ffbfe9', menu:'floor',  desc:'3つのトレーニングから1つ選ぶ' },
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
  hum:     { /*@hum*/
    name:'余裕', duration:20, cooldown:120, trigger:'hpBelow', triggerValue:0.5,
    effects:{ dmgTakenMult:1.5, gutsRegenMult:2, speedMult:1.5 },
  },
  ogre:    { /*@ogre*/
    name:'闘魂', duration:20, cooldown:120, trigger:'gutsBelow', triggerValue:0.5,
    effects:{ gutsRegenMult:2, cooldownMult:0.667 },
  },
  centaur: { /*@centaur*/
    name:'憤怒', duration:30, cooldown:120, trigger:'hpBelow', triggerValue:0.5,
    effects:{ dmgMult:1.2, gutsRegenMult:2, cooldownMult:0.667, speedMult:1.5 },
  },
  narga:   { /*@narga*/
    name:'逆上', duration:20, cooldown:60, trigger:'onHitTakenChance', triggerValue:0.2,
    effects:{ gutsRegenMult:2, speedMult:1.5 },
  },
  joker:   { /*@joker*/
    name:'本気', duration:30, cooldown:120, trigger:'onKill', triggerValue:null,
    effects:{ dmgMult:1.2, dmgTakenMult:0.8, gutsRegenMult:2, speedMult:1.5 },
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
  hum:     { life:'C', power:'A', wisdom:'E', accuracy:'C', evasion:'A', vitality:'E' }, /*@hum*/
  ogre:    { life:'C', power:'A', wisdom:'D', accuracy:'C', evasion:'B', vitality:'B' }, /*@ogre*/
  centaur: { life:'C', power:'C', wisdom:'B', accuracy:'A', evasion:'D', vitality:'D' }, /*@centaur*/
  narga:   { life:'C', power:'B', wisdom:'E', accuracy:'B', evasion:'D', vitality:'C' }, /*@narga*/
  joker:   { life:'C', power:'C', wisdom:'A', accuracy:'A', evasion:'D', vitality:'D' }, /*@joker*/
  // <<AUTO:APTITUDE>> ここから上へ tools/monster_add.py が新モンスターの行を追記する
};
/* 特性の「技を当てたときに相手へ起きること」。
   **既存モンスターぶんはここに無い**(combat.jsに element で直接書いてあり、挙動を変えたくないため)。
   **スタジオから足した特性だけがここに載る。** 判定は combat.js の1か所だけで、表に1行足せば効く。

   ここに書かないもの:
   ・常時かかる倍率(被ダメ/与ダメ/連射/ガッツ回復/移動速度/当たり判定)は ELEMENTS 側の
     dmgTakenMod / dmgDealtMod / cooldownMod / gutsRegenMod / speedMod / hitboxMult で既に効く。
   ・射程や弾速の増減は SIGNATURE_MOVES の数字そのものへ焼き込む(ガリの godrange・ハムの hum と同じ)。

   例: { burnSec:10, gutsDrain:0.3 } = 命中で10秒やけど + 与ダメの30%ぶん相手のガッツを削る */
const TRAIT_ON_HIT = {
  ogre:       { burnSec:10 }, /*@ogre*/
  narga:      { poisonSec:10 }, /*@narga*/
  // <<AUTO:TRAIT_ON_HIT>> ここから上へ tools のスタジオが新しい特性の行を追記する
};
// 適正は E→D→C→B→A→S の6段階。Sは転生でしか手に入らない(種族の初期適正には出てこない)。
/* 適正の段階。**種族の適正はSまで**で、S より上は転生でしか到達できない。
   転生を重ねるほど上へ伸びるように S+ / SS / SS+ / M(最上位・虹色)を用意してある。
   段階を足すときは ORDER と下の3つの表を必ずセットで増やす(表に無い段階は倍率1扱いになる)。 */
const APTITUDE_ORDER = ['E','D','C','B','A','S','S+','SS','SS+','M'];
const APTITUDE_INITIAL_VALUE = { M:210, 'SS+':200, SS:190, 'S+':180, S:170, A:150, B:130, C:110, D:90, E:70 };
const APTITUDE_TRAIN_MULT   = { M:2.7,  'SS+':2.4, SS:2.2, 'S+':2.0, S:1.8, A:1.5, B:1.25, C:1.0, D:0.8, E:0.6 };
/* S以上だけの追加ボーナス: ステータス1ポイントあたりの倍率の伸びも良くなる。
   mastermonStatFactor の除数に掛ける(除数が小さいほど1ポイントの効きが強い)。
   表に無い段階(A以下)は 1 = 補正なし。 */
const APTITUDE_FACTOR_DIVISOR_MULT = { S:0.75, 'S+':0.70, SS:0.65, 'SS+':0.60, M:0.52 };
/* 適正バッジの色。**style.css の .mm-stat-apt-badge.apt-* と同じ色を二重に持っている。**
   canvasはCSSクラスを読めないので、シェア画像を描くためにここにも必要になった。
   **色を変えるときは必ず両方直すこと。** Mだけは虹色なので配列(グラデーションの色止め)で持つ。 */
const APTITUDE_BADGE_COLOR = {
  M:    ['#ff004c','#ff8a00','#ffe600','#00e15a','#00b3ff','#a24bff'],
  'SS+':'#7fb0ff', SS:'#ff9de0', 'S+':'#ffc93f', S:'#ffd76a',
  A:'#ff5a5a', B:'#ff8fd1', C:'#6fe07a', D:'#5fd4e8', E:'#b98fe8',
};
// CSSのクラス名に使える形にする('S+' はそのままだとセレクタに書けない)
function aptitudeCssKey(grade){ return String(grade||'').replace(/\+/g, 'p'); }
// これ以上は上がらない段階か
function aptitudeIsMax(grade){ return grade === APTITUDE_ORDER[APTITUDE_ORDER.length-1]; }
// 1段階上げる(Mが上限)。転生で選んだ適正に使う
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

/* ===== 試合中のトレーニングカード =====
   トレーニングアイテムを拾うと TRAINING_MENU から3つ出て1つ選ぶ。**表は増やさない。**
   ロビーのトレーニング1回ぶんでは試合中に体感できないので、上がり幅をこの倍率で増やす。
   **強さの調整はこの1か所**(効き目の目安は下のコメント)。 */
const MATCH_TRAIN_CARD_MULT = 6;   // 18pt → 108pt 相当
const TRAIN_CARD_COUNT = 3;        // 1回に出す枚数
const TRAIN_CARD_PICK_SEC = 8;     // 選ばなかったときに自動で決まるまでの秒数
/* 1枚あたりの効き目の目安(ステータス100・適正Cの子):
     走り込み(ライフ+108)   → 最大HP +24%
     丸太うけ(丈夫さ+108)   → 被ダメ −11%
     しゃてき(命中+108)     → 連射  +14%
     ドミノ倒し(ちから+108) → 技ダメ +6%
   除数(MASTERMON_STAT_FACTOR_DIVISOR)の違いで威力系だけ伸びが小さい。 */
/* ===== デス円盤石(倒された者が試合中の強化を石の円盤として落とす) =====
   ・試合中に確定したトレーニングカードは ent.matchTrainLog に積まれ、
     本当の死亡時(ダウンではない)にその新しい方から最大 DEATH_DISC_MAX_ITEMS 件が
     kind:'deathDisc' の円盤石として落ちる。誰でも拾え、カード選択なしで即適用される。
   ・拾った項目は拾った側の matchTrainLog にも積まれる(倒されたらまた落ちる=力の連鎖)。
   ・レイドだけは出さない(ボス戦の文脈に合わない)。 */
const DEATH_DISC_MAX_ITEMS = 3;      // 中身の上限(発注者が実機調整)
const DEATH_DISC_COLOR     = '#b8b2a4';  // 石の円盤の色(画像が未ロードのときの手描き用)
const DEATH_DISC_ACCENT    = '#ffd76a';  // 金の光(拾えることを示す)
// 落下地点を岩・火山・水晶の外側へ逃がす余白。拾える距離(e.radius+14、モンスター半径は概ね19〜25)
// より確実に広く取り、誰も近づけない位置に落ちて拾えなくなる事故を防ぐ(spawnLootの45と同じ考え方)
const DEATH_DISC_DROP_CLEAR_MARGIN = 45;
/* 見た目はガチャ・召喚演出と同じ円盤石の画像(images/summon_disk_thick.png)を使う。
   R=画面上の顔(上面)の横半径。光のふち・光の柱もこの1つの基準からサイズを取る。
   下の3つは**画像の実測から出した値**なので、絵を差し替えたら測り直すこと
   (600x600 の中で顔は x66〜541 / y152〜430、画像中心は 300,300):
     THICK_SCALE  顔の直径がちょうど R*2 になる全体倍率 = 600/475
     FACE_RATIO   顔の縦横比 = 278/475(光のふちをこの比で描くと絵の縁に重なる)
     FACE_DY      顔の中心は画像中心より 9px 上 → 描く位置を下へずらして 0 に合わせる */
const DEATH_DISC_R           = 17;
const DEATH_DISC_THICK_SCALE = 2.53;
const DEATH_DISC_FACE_RATIO  = 0.585;
const DEATH_DISC_FACE_DY     = 0.038;   // R に対する比
function trainCardMenu(key){ return TRAINING_MENU.find(t=>t.key===key) || null; }
/* 出す3枚。**拾ったアイテムに対応する1枚は必ず入る**(アイテムの見た目と結果をつなぐ)。
   rnd を渡せる形にしてあるので、同じ乱数から同じ3枚を作れる。 */
function pickTrainCardKeys(itemType, rnd){
  const r = rnd || Math.random;
  const must = (TRAINING_ITEMS[itemType] || {}).menu;
  const rest = TRAINING_MENU.map(t=>t.key).filter(k=>k!==must);
  for(let i=rest.length-1;i>0;i--){ const j=Math.floor(r()*(i+1)); [rest[i],rest[j]]=[rest[j],rest[i]]; }
  const keys = (must ? [must] : []).concat(rest).slice(0, TRAIN_CARD_COUNT);
  // 並び順もばらす(必ず入る1枚がいつも左端だと選択が作業になる)
  for(let i=keys.length-1;i>0;i--){ const j=Math.floor(r()*(i+1)); [keys[i],keys[j]]=[keys[j],keys[i]]; }
  return keys;
}
/* 試合中のステータスの丸め。**上限(mastermonStatCap)を見ない。**
   育てきったマスモン(999)でカードが何も効かなくなるのを避けるため。
   試合中の値は ent.matchMm(保存データの複製)にしか入らず、試合ごとに作り直されるので
   育成データへは残らない。下限だけは1で止める(0以下だと倍率が壊れて移動が逆を向く)。 */
function matchStatClamp(v){ return Math.max(1, Math.round(v)); }
/* このマスモンがこのカードを取ったときのステータス変動。
   ロビーの previewMastermonTraining と同じ計算に MATCH_TRAIN_CARD_MULT を掛けただけ。 */
function trainCardChanges(mm, cardKey){
  const tpl = trainCardMenu(cardKey);
  if(!tpl || !mm || !mm.stats) return null;
  const apt = mastermonApt(mm);
  const changes = {};
  tpl.up.forEach(u=>{
    const gain = Math.round(u.amount * (APTITUDE_TRAIN_MULT[apt[u.stat]] || 1) * MATCH_TRAIN_CARD_MULT);
    changes[u.stat] = matchStatClamp(mm.stats[u.stat] + gain) - mm.stats[u.stat];
  });
  tpl.down.forEach(d=>{
    const loss = Math.round(d.amount * MATCH_TRAIN_CARD_MULT);
    changes[d.stat] = matchStatClamp(mm.stats[d.stat] - loss) - mm.stats[d.stat];
  });
  return changes;
}
/* カードの効き目を「ステータスの数字」ではなく **その結果どれだけ強くなるか** で返す。
   ライフ+108 と言われても分からないので、最大HP+24% のように実際に変わる値で見せる。
   ・被ダメだけは小さいほど良いので、マイナスを「良い」として扱う
   ・連射はクールタイムの逆数(短いほど速い)
   戻り値: [{ label, pct, good }] 変わらない項目は入らない。 */
/* 2つのマスモン(前・後)の差を「変わる数値」の一覧にする。**並び順もここが正**で、
   カードの1枚ぶんも試合中の合計も同じ順・同じ言葉で出る。 */
const MATCH_EFFECT_LABELS = ['最大HP','技ダメ','被ダメ','連射','ガッツ','速さ'];
// 数値が小さいほど良い項目(表示の色と符号の扱いが逆になる)
const MATCH_EFFECT_LOWER_BETTER = ['被ダメ'];
function effectDiffRows(beforeMm, afterMm){
  const a = mastermonEffectMults(beforeMm), b = mastermonEffectMults(afterMm);
  const out = [];
  const add = (label, before, next)=>{
    if(!before) return;
    const pct = Math.round((next/before - 1) * 100);
    if(pct === 0) return;
    const lower = MATCH_EFFECT_LOWER_BETTER.includes(label);
    out.push({ label, pct, good: lower ? (pct < 0) : (pct > 0) });
  };
  add('最大HP', a.lifeMult,       b.lifeMult);
  add('技ダメ', a.dmgDealtMult,   b.dmgDealtMult);
  add('被ダメ', a.dmgTakenMult,   b.dmgTakenMult);
  add('連射',   1/a.cooldownMult, 1/b.cooldownMult);
  add('ガッツ', a.gutsRegenMult,  b.gutsRegenMult);
  add('速さ',   a.speedMult,      b.speedMult);
  return out;
}
function trainCardEffects(mm, cardKey){
  const ch = trainCardChanges(mm, cardKey);
  if(!mm || !mm.stats || !ch) return [];
  const after = Object.assign({}, mm, { stats: Object.assign({}, mm.stats) });
  Object.keys(ch).forEach(k=>{ after.stats[k] = mm.stats[k] + ch[k]; });
  return effectDiffRows(mm, after);
}
/* 試合中に取ったカードの**合計**。基準は試合開始時のステータス(matchMmBaseStats)。
   1枚ぶんの効き目と同じ言葉・同じ順で出るので、拾ったときの表示と足し算が合う。 */
function matchTrainTotalEffects(mm, baseStats){
  if(!mm || !mm.stats || !baseStats) return [];
  const before = Object.assign({}, mm, { stats: Object.assign({}, baseStats) });
  return effectDiffRows(before, mm);
}

/* =====================================================================
   転生(レベル100で1からやり直し、そのぶん強くなる不可逆システム)

   マスモンに増えるフィールドは2つだけ:
     mm.rebirth : 転生した回数(未転生は undefined/0)
     mm.apt     : このマスモン固有の適正表(転生で1段階上げたもの)。
                  無ければ種族の APTITUDE[element] を使う。
   どちらも「無ければ従来どおり」で読めるので、既存のセーブデータをそのまま扱える。
   ===================================================================== */
const REBIRTH_LEVEL_REQ        = MASTERMON_LEVEL_CAP; // 転生できるレベル(=上限レベル)
const REBIRTH_MAX              = 5;     // 転生できる回数の上限(到達したら印が★から👑になる)
const REBIRTH_STAT_CAP_STEP    = 100;   // 転生1回につきステータス上限に加算(1回目1099・2回目1199…)
/* 転生1回ごとに種族の基礎HP・基礎移動速度へ加算する量(1回目→5回目)。**HPと速度で共通**。
   後ろほど小さくして、回すほど1周の重みが増えるのに見返りは減る形にしている
   (必要EXPは REBIRTH_EXP_MULT_STEP で増える)。合計は 10/18/24/28/30。
   **合計は mastermonBaseBonus が毎回この表から数え直す**ので、
   すでに転生済みのマスモンにもこの表を直しただけで反映される(保存側には持たない)。 */
const REBIRTH_BASE_BONUS_STEPS = [10, 8, 6, 4, 2];
const REBIRTH_TICKETS          = 10;    // 転生時にもらえるトレーニングチケット
const REBIRTH_STAT_KEEP_RATIO  = 1/3;   // 転生後に残るステータスの割合(999→333)
const REBIRTH_APT_PICKS        = 3;     // 転生時に1段階上げる適正の数
/* レベルアップに要るEXPが転生1回につき増える割合(等差)。
   0回=1.0倍 / 1回=1.5倍 / 2回=2.0倍 …(mastermonExpToNext)。
   転生は「1からやり直して上限を上げる」仕組みなので、回数を重ねても同じ手間で
   カンストできると周回が作業になる。回るほど重くして、1周の価値を上げる。
   **数値は発注者が実機で調整する。ここ1か所だけを直せば全体に効く。** */
const REBIRTH_EXP_MULT_STEP    = 0.5;

function mastermonRebirthCount(mm){ return Math.max(0, Math.round((mm && mm.rebirth) || 0)); }
/* マスモン戦歴(rec): m=試合数, w=チャンピオン回数, k=通算キル, dmg=通算与ダメージ,
   bk=最高キル, bd=最高与ダメージ, tr=トレーニング回数, fw=初チャンピオンの時刻(0=未),
   since=登録時刻。あゆみ画面と累計ミッション(LIFETIME_MISSIONS)が読む。
   mastermonSnapshot には**含めない**(Firebaseのghostsノードを太らせない)。 */
// rec が無い既存の個体には作って返す(既存プレイヤーのデータを壊さない)
function mmRec(mm){
  if(!mm) return null;
  if(!mm.rec) mm.rec = { m:0, w:0, k:0, dmg:0, bk:0, bd:0, tr:0, fw:0, since:0 };
  return mm.rec;
}
// 試合1回ぶんの記録。呼び出しは ui.js の handleMastermonPostMatch(別担当)
function mmRecordMatch(mm, o){
  const r = mmRec(mm); if(!r) return;
  const kills = Math.max(0, Math.round((o&&o.kills)||0));
  const dmg   = Math.max(0, Math.round((o&&o.damage)||0));
  r.m++; r.k += kills; r.dmg += dmg;
  if(kills > r.bk) r.bk = kills;
  if(dmg > r.bd) r.bd = dmg;
  if(o && o.isWin){ if(!r.w && !r.fw) r.fw = Date.now(); r.w++; }
}
// n回目(1始まり)の転生でもらえる基礎値の加算。表の外(上限を超えた回)は0
function rebirthBaseBonusStep(n){ return REBIRTH_BASE_BONUS_STEPS[Math.round(n)-1] || 0; }
// 転生をn回した個体の基礎値加算の合計。**保存せず毎回数え直す**(表を直せば既存の個体にも効く)
function rebirthBaseBonusTotal(n){
  let sum = 0;
  for(let i=1; i<=Math.max(0, Math.round(n)); i++) sum += rebirthBaseBonusStep(i);
  return sum;
}
/* 転生回数の印。**上限まで行ったら★の並びではなく王冠1つ**にする。
   ★が5つ並ぶより「これ以上ない個体」だとひと目で分かる。
   ここ1か所を全部の表示(カード・転生画面・演出)が呼ぶ。 */
function rebirthMarkText(mm){
  const n = mastermonRebirthCount(mm);
  return n >= REBIRTH_MAX ? '👑' : '★'.repeat(n);
}
// ランキング「ステ合計」用。育成で振った6ステータスの合計(適正・転生ボーナスは含まない生値)
function mastermonStatTotal(mm){
  return MASTERMON_STATS.reduce((sum,s)=>sum + Math.round((mm && mm.stats && mm.stats[s.key]) || 0), 0);
}

/* =====================================================================
   スキン覚醒
   育て込んだマスモンだけが到達できる最終形態。**見た目(覚醒スキン)と tier3技の強化**が付く。

   ・覚醒後の姿は SSR_SKINS に `awakenOf:'元のスキンID'` を付けた**ただのSSRスキン**として登録する。
     そうすればオーラ・専用技名・歩行コマ・BGM/SEまで既存の表がそのまま効く(新しい分岐が要らない)。
   ・覚醒したことはマスモンに持つ: mm.awaken = { '元のスキンID': '強化の種類' }
     **スキンの所持(loadSkins().owned)には入れない。** 「育てたこの子だけの姿」にするため。
   ・着せ替えで元の姿へ戻せる(覚醒スキンを一覧に足すだけなので、装備の仕組みは既存のまま)。

   マスモンに増えるフィールドは mm.awaken の1つだけで、無ければ従来どおり読める。
   ===================================================================== */
const AWAKEN_REBIRTH_REQ = 2;    // 必要な転生回数
const AWAKEN_STAT_MIN    = 800;  // 6ステータス「すべて」がこの値以上であること

/* 覚醒時に1つ選ぶ tier3技の強化。
   **「弾速」と「範囲拡大速度」は同じフィールド(projSpeed)で、技が弾を撃つ技か範囲技かで
   意味が変わる**(範囲技では fillSpeed = 範囲の広がる速さになる。combat.js の fireMove 参照)。
   そのため両方を並べず、`applies(move)` でその技に効くものだけを出す。
   増やすときはこの表に1行足すだけでよい(選択ボタンも効果の適用も自動で回る)。 */
/* `stat` は技一覧のどの数字が動くか。**強調表示はこの印だけを見る**ので、
   強化を足すときにここへ1つ書けば画面側は何も足さなくてよい。 */
/* 【表は2つに割ってある】
   ・MOVE_BOOST_KINDS = **何が上がるか**(ラベル・アイコン・どの数字が動くか・どの技に効くか)
   ・MOVE_BOOST_GRADES = **どれだけ上がるか**を出どころ別に持つ(awaken=覚醒 / hiden=秘伝の書)
   覚醒と秘伝の書は「上がるもの」がまったく同じで「効き目」だけが違う。
   1つの表に混ぜると、種類を足したときに片方だけ直す事故が必ず起きるので分けてある。
   **種類を増やすときは KINDS に1行 + GRADES の各段に1行**(両方に入れる。片方だけだと無効)。 */
const MOVE_BOOST_KINDS = {
  power:  { label:'威力',         icon:'💥', desc:'技のダメージが上がる', stat:'dmg',
            applies:()=>true },
  range:  { label:'射程',         icon:'🎯', desc:'技の届く距離が伸びる', stat:'range',
            applies:(m)=>!!(m && m.range) },
  // 弾を撃つ技(aoeShapeが無い)だけ。projSpeed は弾の速さ
  projSpeed:{ label:'弾速',       icon:'⚡', desc:'弾が速く飛ぶ', stat:'speed',
            applies:(m)=>!!(m && !m.aoeShape && m.projSpeed) },
  // 範囲技だけ。projSpeed は範囲の広がる速さ(fillSpeed)。未指定の技は既定900から伸ばす
  fillSpeed:{ label:'範囲拡大速度', icon:'🌀', desc:'範囲が広がる速さが上がる', stat:'speed',
            applies:(m)=>!!(m && m.aoeShape) },
  // 爆風ドームを持つ技だけ。expandTime は小さいほど速く広がる
  blastSpeed:{ label:'爆風の広がり', icon:'💠', desc:'着弾の爆風が速く広がる', stat:'feature',
            applies:(m)=>!!(m && (m.blast || m.endBlast || m.selfBlast)) },
};
/* 効き目の段。**awaken の数字は覚醒システム公開時のまま。ここを動かすと既存の覚醒個体が変わる。**
   hiden(秘伝の書)は覚醒の約4割。覚醒は転生2回+全ステ800以上という長い道のりの報酬なので、
   モン晶100個で買える書が並ぶと覚醒の価値が消える。**重ねられる**ので、
   両方そろえた個体が一番強い(威力なら 1.30×1.12 = +45.6%)。
   **数値は発注者が実機で調整する。ここ1か所だけを直せば全体に効く。** */
const MOVE_BOOST_GRADES = {
  awaken: {
    power:     { dmgMult:1.30 },
    range:     { mult:{ range:1.30 } },
    projSpeed: { mult:{ projSpeed:1.50 } },
    fillSpeed: { mult:{ projSpeed:1.50 }, base:{ projSpeed:900 } },
    blastSpeed:{ blastExpandMult:1/1.4 },
  },
  hiden: {
    power:     { dmgMult:1.12 },
    range:     { mult:{ range:1.12 } },
    projSpeed: { mult:{ projSpeed:1.20 } },
    fillSpeed: { mult:{ projSpeed:1.20 }, base:{ projSpeed:900 } },
    blastSpeed:{ blastExpandMult:1/1.15 },
  },
};
/* 覚醒の強化表。**KINDSとGRADESから組み立てた読むだけの表**なので、
   既存の呼び出し(awakenBoostKeysFor / awakenBoostAmountText / 画面側)は今までどおり使える。 */
const AWAKEN_BOOSTS = Object.keys(MOVE_BOOST_KINDS).reduce((acc,k)=>{
  acc[k] = Object.assign({}, MOVE_BOOST_KINDS[k], MOVE_BOOST_GRADES.awaken[k]);
  return acc;
}, {});
// 秘伝の書の強化表(同じ作り方。段が違うだけ)
const HIDEN_BOOSTS = Object.keys(MOVE_BOOST_KINDS).reduce((acc,k)=>{
  acc[k] = Object.assign({}, MOVE_BOOST_KINDS[k], MOVE_BOOST_GRADES.hiden[k]);
  return acc;
}, {});
function moveBoostTable(src){ return src==='hiden' ? HIDEN_BOOSTS : AWAKEN_BOOSTS; }
/* 強化の効き目を「+何%」の文字にする。**表の数字から作る**ので二重に持たない。
   爆風だけは expandTime(小さいほど速い)なので逆数で見る。
   src を省くと覚醒の段(従来の呼び出しがそのまま動く)。 */
function moveBoostAmountText(key, src){
  const b = moveBoostTable(src)[key];
  if(!b) return '';
  const pct = (v)=> `+${Math.round((v-1)*100)}%`;
  if(b.dmgMult) return pct(b.dmgMult);
  if(b.mult){ const k = Object.keys(b.mult)[0]; return pct(b.mult[k]); }
  if(b.blastExpandMult) return pct(1/b.blastExpandMult);
  return '';
}
function awakenBoostAmountText(key){ return moveBoostAmountText(key, 'awaken'); }
/* その技で実際に選べる強化の一覧(効かないものは出さない)。
   **効く／効かないは種類だけで決まる**(段によらない)ので覚醒も秘伝の書も同じ答えになる。 */
function moveBoostKeysFor(move){
  return Object.keys(MOVE_BOOST_KINDS).filter(k=>MOVE_BOOST_KINDS[k].applies(move));
}
function awakenBoostKeysFor(move){ return moveBoostKeysFor(move); }
// このマスモンが覚醒済みのスキンに対して選んだ強化(未覚醒なら null)
function mastermonAwakenBoost(mm, baseSkinId){
  const a = mm && mm.awaken;
  return (a && baseSkinId && a[baseSkinId]) || null;
}
/* 今着ているスキンに対して効く強化。**覚醒スキンを着ているときだけ乗る。**
   元の姿に戻せば強化も戻る(着せ替えで見た目と性能がいつも一致する)。 */
function awakenBoostForSkin(mm, skinId){
  if(!mm || !skinId || !isAwakenedSkinId(skinId)) return null;
  return mastermonAwakenBoost(mm, SSR_SKINS[skinId].awakenOf);
}

/* =====================================================================
   秘伝の書(モン晶100個で交換する技強化アイテム)

   マスモンに増えるフィールドは mm.moveBoost の1つだけ。無ければ従来どおり読める。
     mm.moveBoost = { 'スキンID': '強化の種類' }
   **mm.awaken とは別に持つ。** 混ぜると「覚醒していないのに覚醒扱い」になり、
   姿・オーラ・専用BGMまで巻き込む(覚醒スキンは SSR_SKINS の別スキンなので副作用が大きい)。
   ===================================================================== */
const HIDEN_MAX_PER_MASTERMON = 1;   // 1体に付けられる秘伝の書は1つ(上書きで付け替える)

function mastermonHidenBoost(mm, skinId){
  const h = mm && mm.moveBoost;
  return (h && skinId && h[skinId]) || null;
}
/* 今着ているスキンに対して効く秘伝の書。
   **覚醒すると装備スキンIDが変わる**(元のSSR → 覚醒スキン)ので、
   覚醒スキンを着ているときは元のIDでも引く。こうしないと、書を付けたあとに覚醒した人の
   書が消えたように見える。 */
function hidenBoostForSkin(mm, skinId){
  if(!mm || !skinId) return null;
  const direct = mastermonHidenBoost(mm, skinId);
  if(direct) return direct;
  if(isAwakenedSkinId(skinId)) return mastermonHidenBoost(mm, SSR_SKINS[skinId].awakenOf);
  return null;
}
/* このマスモン+装備スキンに効いている強化の一覧([{src,kind},…])。
   **エンティティへ載せる形を作るのはここ1か所。** 覚醒と秘伝の書の両方を見る。 */
function mastermonMoveBoosts(mm, skinId){
  const out = [];
  const aw = (typeof awakenBoostForSkin==='function') ? awakenBoostForSkin(mm, skinId) : null;
  if(aw) out.push({ src:'awaken', kind:aw });
  const hd = hidenBoostForSkin(mm, skinId);
  if(hd) out.push({ src:'hiden', kind:hd });
  return out;
}
/* 覚醒の条件。**判定はここ1か所だけ。** 足りないものを配列で返すので、
   画面はこれをそのまま「あと何が要るか」の表示に使える(条件と表示を二重に持たない)。 */
function awakenRequirements(mm, skinId){
  const missing = [];
  const rb = mastermonRebirthCount(mm);
  if(rb < AWAKEN_REBIRTH_REQ) missing.push({ kind:'rebirth', label:'転生', now:rb, need:AWAKEN_REBIRTH_REQ });
  MASTERMON_STATS.forEach(s=>{
    const v = Math.round((mm && mm.stats && mm.stats[s.key]) || 0);
    if(v < AWAKEN_STAT_MIN) missing.push({ kind:'stat', key:s.key, label:s.label, now:v, need:AWAKEN_STAT_MIN });
  });
  if(!skinId || !SSR_SKINS[skinId]) missing.push({ kind:'skin', label:'SSRスキンを装備' });
  else if(!awakenedSkinIdOf(skinId)) missing.push({ kind:'skin', label:'このスキンには覚醒後の姿がまだありません' });
  else if(mastermonAwakenBoost(mm, skinId)) missing.push({ kind:'done', label:'このスキンは覚醒済み' });
  return missing;
}
function canAwakenMastermon(mm, skinId){ return awakenRequirements(mm, skinId).length === 0; }
// このマスモンの適正表。転生で書き換わっていればそちら、無ければ種族の適正
function mastermonApt(mm){
  if(mm && mm.apt) return mm.apt;
  const byElement = mm && APTITUDE[mm.element];
  return byElement || APTITUDE.mocchi;
}
// このマスモンのステータス上限。**転生の回数ぶん積み上がる**(999 → 1099 → 1199 …)
function mastermonStatCap(mm){ return MASTERMON_STAT_CAP + mastermonRebirthCount(mm)*REBIRTH_STAT_CAP_STEP; }
/* 種族の基礎値(HP・移動速度)への加算。内訳は2つ:
     ・転生の回数ぶん(REBIRTH_BASE_*_BONUS)
     ・基礎値アイテム(生命の果実・加速剤)を使ったぶん(mm.baseHp / mm.baseSpd)
   どちらも「無ければ0」で読めるので、既存のセーブデータをそのまま扱える。
   ここ1か所を通せば表示(mmEffectiveStats)も実戦力(applyMastermonStatsToEntity)も揃う。 */
function mastermonBaseBonus(mm){
  const n = mastermonRebirthCount(mm);
  const itemHp    = safeBaseAmount(mm && mm.baseHp);
  const itemSpeed = safeBaseAmount(mm && mm.baseSpd);
  const rbBonus = rebirthBaseBonusTotal(n);
  return { hp: rbBonus + itemHp, speed: rbBonus + itemSpeed };
}
// 壊れたセーブや相手から届いた変な値でNaNにならないようにする。
// NaNのままだとHPが数値でなくなり、ダメージ計算もゲージも壊れて試合が続けられなくなる。
function safeBaseAmount(v){
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}
// もう転生できないところまで回した個体か(ボタンの出し方と印を分ける判定はここ1か所)
function rebirthMaxedOut(mm){ return mastermonRebirthCount(mm) >= REBIRTH_MAX; }
function canRebirthMastermon(mm){
  return !!mm && (mm.level||0) >= REBIRTH_LEVEL_REQ && !rebirthMaxedOut(mm);
}
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
  // 転生「後」の上限で丸める(1/3にするので上限には当たらないが、計算の基準をそろえる)
  const nextCap = mastermonStatCap({ rebirth: nextRebirth });
  MASTERMON_STATS.forEach(s=>{
    stats[s.key] = mastermonClampStat((mm.stats[s.key]||0) * REBIRTH_STAT_KEEP_RATIO, nextCap);
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
/* マスモン1体の「写し」。**マスモンを他所へ渡す形はこれ1つだけ。**
   使うのは3か所とも:
     ・マルチの部屋へ送る自分の育成値(currentMastermonInfo)
     ・マルチでホストのマスモンをbotにするときの積み荷(hostMastermonBots)
     ・ゴースト(他の人が育てたマスモンをソロの敵として出す)
   受け側は applyMastermonStatsToEntity にそのまま渡せる。
   ・baseHp/baseSpd は**基礎値アイテムぶんだけ**。受け側が rebirth から転生ぶんを足し直すので、
     合計を入れると転生ぶんが二重に乗る。
   ・moveBoosts は**解決済みの一覧**([{src,kind},…])。受け側は覚醒や秘伝の書の記録を
     持っていないため、ここで着ているスキンに対して引き当てた結果だけを渡す。
   ・awakenBoost も**古い受け側のために1語で残す**(バージョン違いの相手と繋がったとき、
     せめて覚醒ぶんは効くように)。新しい受け側は moveBoosts を読む。
   ・Firebaseは undefined を受け付けないので、無いものは null / [] にする。 */
function mastermonSnapshot(mm, skinId){
  const src = (mm && mm.stats) || {};
  const stats = {}, apt = {};
  const srcApt = mastermonApt(mm);
  MASTERMON_STATS.forEach(s=>{
    stats[s.key] = Math.round(src[s.key] || 0);
    apt[s.key] = srcApt[s.key] || 'C';
  });
  const awakenBoost = (typeof awakenBoostForSkin==='function') ? awakenBoostForSkin(mm, skinId||null) : null;
  const moveBoosts = (typeof mastermonMoveBoosts==='function') ? mastermonMoveBoosts(mm, skinId||null) : [];
  return {
    name: (mm && mm.name) || '',
    element: (mm && mm.element) || null,
    level: (mm && mm.level) || 1,
    stats, apt,
    rebirth: mastermonRebirthCount(mm),
    baseHp: safeBaseAmount(mm && mm.baseHp),
    baseSpd: safeBaseAmount(mm && mm.baseSpd),
    skin: skinId || null,
    awakenBoost: awakenBoost || null,
    moveBoosts,
  };
}
/* 次のレベルに要るEXP。**転生を重ねるほど増える**(REBIRTH_EXP_MULT_STEP)。

   引数は**マスモンを丸ごと**受ける。レベルだけ渡す形にすると、転生回数を足し忘れた
   呼び出しが混ざって「画面に出ている必要EXP」と「実際にレベルが上がる量」が食い違う
   (同じ取り違えが mmEffectiveStats で実際に起きている)。渡す物を1つにして防ぐ。 */
function mastermonExpToNext(mm){
  const level = Math.max(1, Math.round((mm && mm.level) || 1));
  return Math.round((80 + level*15) * mastermonExpMult(mm));
}
// 転生回数による必要EXPの倍率。表示(マスモン詳細)と計算で同じ物を見るためここが正
function mastermonExpMult(mm){ return 1 + mastermonRebirthCount(mm) * REBIRTH_EXP_MULT_STEP; }
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
// grade が S 以上なら除数が縮み、同じステータス値でも倍率の伸びが良くなる(上の段階ほど強い)
function mastermonStatFactor(v, statKey, grade){
  let divisor = MASTERMON_STAT_FACTOR_DIVISOR[statKey] || 900;
  divisor *= (APTITUDE_FACTOR_DIVISOR_MULT[grade] || 1);   // S以上だけ効く(A以下は1)
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
    rec: { m:0, w:0, k:0, dmg:0, bk:0, bd:0, tr:0, fw:0, since:Date.now() },
  };
}
// 実際には反映せず、実行した場合の各ステータス変動量(クランプ後の差分)だけを計算する
function previewMastermonTraining(mm, trainingKey){
  const tpl = TRAINING_MENU.find(t=>t.key===trainingKey);
  if(!tpl) return null;
  const apt = mastermonApt(mm);      // 転生で上がった適正があればそちらが効く
  const cap = mastermonStatCap(mm);  // 転生の回数ぶん上限が上がる(999+100×回数)
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
  mmRec(mm).tr++; // 戦歴: トレーニング回数(プレビューでは数えない)
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
  while(mm.level<MASTERMON_LEVEL_CAP && mm.exp>=mastermonExpToNext(mm)){
    mm.exp -= mastermonExpToNext(mm);
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
/* レベル(と転生回数)から、その強さ相当の「仮のマスモン」を作る。ソロの敵botに使う。
   rebirth を渡すと、プレイヤーの転生に合わせて敵も強くする:
     ・ステータス上限が上がる(mastermonStatCap)ぶん、ステータスも同じ比率で底上げする
     ・基礎HP/移動速度の加算(mastermonBaseBonus)も rebirth を持たせるだけで効く
   適正は種族のまま(上げるのは転生したプレイヤーだけの特権)。 */
function syntheticMastermonForLevel(elementKey, level, rebirth){
  const apt = APTITUDE[elementKey] || APTITUDE.mocchi;
  const stats = mastermonInitialStats(elementKey);
  const lv = clamp(Math.round(level)||1, 1, MASTERMON_LEVEL_CAP);
  const n = Math.max(0, Math.round(rebirth||0));
  const trainings = Math.max(0, lv-1);
  const totalPoints = trainings * 18; // 訓練1回≈18ポイント相当
  const mults = MASTERMON_STATS.map(s=>APTITUDE_TRAIN_MULT[apt[s.key]]||1);
  const sumMult = mults.reduce((a,b)=>a+b,0) || 1;
  // 上限が上がったぶんだけステータスも伸ばす(999→1099なら×1.10)
  const cap = mastermonStatCap({ rebirth:n });
  const capMult = cap / MASTERMON_STAT_CAP;
  MASTERMON_STATS.forEach((s,i)=>{
    stats[s.key] = mastermonClampStat((stats[s.key] + totalPoints*(mults[i]/sumMult)) * capMult, cap);
  });
  return { element:elementKey, level:lv, stats, rebirth:n };
}

/* =====================================================================
   自分以外のモンスターの強さの上限(発注者指示 2026-08-17)

   **バトルに出る自分以外のモンスターは、自分が使っているマスモンのステータス合計を
   上回らない。** bot・ゴースト・自分の他のマスモン(マルチの★bot / レイドの味方)が対象。
   通し方は「上限を1つ作る(battleStatLimitOf) → 写しを通す(capMastermonToLimit)」の2段で、
   **判定を各所に散らさない。**

   ・縮め方は6ステータスを同じ比率で下げる(下限1)。誰かのステータスの形は保たれる。
   ・基礎値アイテム(baseHp/baseSpd)と転生回数も自分のぶんで頭打ちにする。どちらも
     ステータスと同じ計算に乗って強さになるので、ここを見ないと合計だけ守っても強い。
   ・適正(apt)は触らない。**合計が同じでも適正が高いほど1ポイントの効きは良い**ので、
     ここは差が残る(発注者へ報告済み)。
   ・**人間のプレイヤー(マルチ)は対象外。** 他人のマスモンを弱めることはしない。
   ・元のオブジェクトは書き換えない(ゴースト・部屋の積み荷を壊さないため)。
   ・マルチのホストのマスモンbotは**積み荷を作るときに縮めておく**。受け取ってから各自で
     縮めると、ホストとゲストで基準が違いHP・速度が食い違う(位置補正が暴れる)。 */
function battleStatLimitOf(mm, elementKey){
  // マスモンを連れていないときは種族の初期値が自分の強さ(育成ぶん0)
  const base = (mm && mm.stats) ? mm : { stats: mastermonInitialStats(elementKey || 'mocchi') };
  return {
    total:   Math.max(1, mastermonStatTotal(base)),
    baseHp:  Math.max(0, Math.round((mm && mm.baseHp) || 0)),
    baseSpd: Math.max(0, Math.round((mm && mm.baseSpd) || 0)),
    rebirth: mastermonRebirthCount(mm),
  };
}
function capMastermonToLimit(mm, limit){
  if(!mm || !mm.stats || !limit) return mm;
  const total = mastermonStatTotal(mm);
  const overStats = total > limit.total;
  const overBase  = ((mm.baseHp || 0) > limit.baseHp) || ((mm.baseSpd || 0) > limit.baseSpd);
  const overRb    = mastermonRebirthCount(mm) > limit.rebirth;
  if(!overStats && !overBase && !overRb) return mm;
  const out = Object.assign({}, mm);
  if(overStats){
    const k = limit.total / total;
    out.stats = {};
    MASTERMON_STATS.forEach(s=>{ out.stats[s.key] = Math.max(1, Math.floor((mm.stats[s.key] || 0) * k)); });
  }
  if(overBase){
    out.baseHp  = Math.min(Math.round(mm.baseHp || 0),  limit.baseHp);
    out.baseSpd = Math.min(Math.round(mm.baseSpd || 0), limit.baseSpd);
  }
  if(overRb) out.rebirth = limit.rebirth;
  return out;
}

// マスモンのステータスから、バトル中に適用する各種倍率を算出。
// 適正S以上のステータスは倍率の伸びも良くなる(mastermonStatFactorの第3引数)。
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
  /* explore: 探検モードのフィールド。起伏は控えめにして、その上に地域ごとの高さ
     (exploreElevGrad。凍った高地は高く、草原の盆地は低い)を足す。
     足したぶんの傾きは最大0.12程度なので、この組の最大傾斜は0.16に抑えてある
     (合計で0.3を超えると坂を登れなくなる)。 */
  explore: [
    { amp:110, fx:0.00040, fy:0.00036, ph:0.7 },
    { amp: 64, fx:0.00093, fy:0.00082, ph:2.3 },
    { amp: 30, fx:0.00205, fy:0.00188, ph:4.0 },
    { amp: 12, fx:0.00510, fy:0.00462, ph:1.2 },
    { amp:  8, fx:0.00780, fy:0.00700, ph:3.6 },
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
  // 探検フィールドだけ地域ごとの高さと起伏(尾根・峡谷・山・段丘)を足す(他のマップは表が違うので素通り)
  if(L === REAL3D_TERRAIN_SETS.explore) h += exploreElevGrad(x, y).h + exploreRelief(x, y);
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
  if(L === REAL3D_TERRAIN_SETS.explore){
    const e = exploreElevGrad(x, y);
    h += e.h; gx += e.gx; gy += e.gy;
    // 起伏は中心差分(max の継ぎ目や地層の段があるので解析微分にしない)
    const r0 = exploreRelief(x, y), rx = exploreRelief(x + 3, y), ry = exploreRelief(x, y + 3);
    if(r0 > 0.01 || rx > 0.01 || ry > 0.01){
      h += r0;
      gx += (rx - exploreRelief(x - 3, y))/6;
      gy += (ry - exploreRelief(x, y - 3))/6;
    }
  }
  _r3grad.h = h; _r3grad.gx = gx; _r3grad.gy = gy;
  return _r3grad;
}
/* リアルマップの見た目。real3d.jsが window.__aramonRealTheme 経由で読む。
   tex: 地面テクスチャの作り方(ひび割れ・粒の強さ)。snowLine: 遠景の山に雪が乗り始める高さ比 */
const REAL3D_THEMES = {
  wild: {
    tex:'dry', bump:0.30,
    // 夕暮れの荒野。前は全体が暗すぎて地面の作り込みが沈んでいたので、
    // 「薄暗い」の性格は残したまま明度だけ持ち上げてある
    // 地面は暖色(乾いた土)、空は寒色(夕暮れ)。明度を上げるだけで青灰色にすると
    // 荒野ではなく寒々しいツンドラに見えたので、地面側は必ず暖色に寄せること
    skyTop:0x24344f, skyBot:0x8b9aab, haze:0x9aa3ac,
    low:0x6b6355, high:0x9c9179, steep:0x554e44, gravel:0x7d7466, scrub:0x6f6b48,
    ridgeRock:0x5b6472, ridgeFoot:0x717c8c, ridgeSnow:0xd2dbe6, snowLine:0.80,
  },
  kaurea: {
    tex:'volcanic', bump:0.34,
    skyTop:0x2a1408, skyBot:0xb0693a, haze:0x8a4a22,
    low:0x2b1d13, high:0x50392a, steep:0x1b1310, gravel:0x3b2b1f, scrub:0x5c3c1e,
    ridgeRock:0x3a2418, ridgeFoot:0x6a4426, ridgeSnow:0xd8a878, snowLine:0.92,
  },
  papas: {
    tex:'snow', bump:0.18,
    // 雪原。空も地面も白いと全部が溶けて見えるので、天頂を濃い青にして
    // 「青い空 対 白い雪」の対比を作る。雪の影側(low)も少し青を強くした
    skyTop:0x24558f, skyBot:0xbcd7ec, haze:0xd2e4f2,
    low:0xa8bccd, high:0xeef5ff, steep:0x6f8195, gravel:0xbccadb, scrub:0x9ab0c4,
    ridgeRock:0x7c8b9d, ridgeFoot:0xb7c6d6, ridgeSnow:0xffffff, snowLine:0.28,
  },
  palepale: {
    tex:'jungle', bump:0.30,
    /* 密林。**空まで緑にしない。** 前は空・霞・地面・草が全部同じ緑で、
       画面全体が緑一色のスープになり、空が空に見えていなかった。
       空は湿った熱帯の青、霞は白っぽい靄にして、緑は地面だけが持つ。
       steep/gravel を茶色にしてあるのは、緑の中に土の色を出すため
       (急斜面のむき出しの土と、落ち葉が溜まった地面)。               */
    skyTop:0x2f6f9e, skyBot:0xa8cfd8, haze:0xbcd3c8,
    low:0x2a4a22, high:0x5c7f38, steep:0x5a4a30, gravel:0x6b5a3c, scrub:0x6e8a28,
    ridgeRock:0x4a5f45, ridgeFoot:0x6d8a68, ridgeSnow:0xdfe8d8, snowLine:0.82,
  },
  toble: {
    tex:'sand', bump:0.22,
    skyTop:0x1f4a72, skyBot:0xa9d0e4, haze:0xcfe0e8,
    low:0xb09a6a, high:0xeaddb0, steep:0x8a7a5c, gravel:0xc0ac82, scrub:0x9aa86a,
    ridgeRock:0x6d7a86, ridgeFoot:0xa89a7a, ridgeSnow:0xe8f0f6, snowLine:0.70,
  },
  mandy: {
    tex:'sand', bump:0.24,
    // 天頂だけ青を強くして、砂と空が同じ金色で溶けるのを防ぐ
    skyTop:0x2f5c93, skyBot:0xe0c98f, haze:0xe6d3a4,
    low:0xc9ab6f, high:0xf2e2ae, steep:0xa08a5c, gravel:0xd8c48c, scrub:0xc0b070,
    ridgeRock:0x8a7a5a, ridgeFoot:0xc8ae7e, ridgeSnow:0xf2ead8, snowLine:0.86,
  },
  /* 探検フィールド。**1枚のマップの中で地域ごとに見た目を変える**唯一のテーマ。
     explore:true が目印で、real3d_*.js はこの印があるときだけ地域ブレンドを使う
     (他のマップは1マップ1テーマのまま。分岐は R3.theme.explore の1か所)。
     ・上の段(skyTop〜snowLine)は空・遠景・環境光・障害物の地の色に使う「全体の地」。
       晴れた昼の高原にしてあり、地域の色は下の regions が上から乗せる。
     ・regions の順番とキーは EXPLORE_FIELD_LAYOUT.regions と同じ(camp=ベースキャンプ)。
       low〜scrub=地面の頂点色 / tex=地面テクスチャ / sky=天頂の色 / cloud=雲を霞の色(煙)へ寄せる量 / ridgeHaze=遠景の山並みを霞へ寄せる量 /
       haze=その地域に立ったときの霞 /
       fog=[霞が始まる距離, 完全に霞む距離] / sun=日差しの色 / rock=障害物の色の掛け率 /
       grass=草の色 / veg=植生の濃さ(草・花・シダ・枯れ枝・硬い葉)            */
  explore: {
    explore:true,
    tex:'meadow', bump:0.30,
    skyTop:0x2a5d98, skyBot:0xa7c6dc, haze:0xc3d2d4,
    low:0x55683a, high:0x8a9a5a, steep:0x4d4a3c, gravel:0x7e7862, scrub:0x5f7f2e,
    ridgeRock:0x56637a, ridgeFoot:0x7d8c98, ridgeSnow:0xeef3f8, snowLine:0.58,
    lavaCrust:0x1c130e,   // 溶岩の冷えた殻(探検は全体の地が草原色なので、溶岩だけ火山の黒にする)
    /* 地域ごと: sky=天頂 / haze=霞=地平の色 / fogD=指数の霞の濃さ(0.00013で約8km先まで形が残る) /
       sun=日差しの色 / sunK=日差しの強さの倍率 / clouds=[雲の量, 厚さのしきい値, 巻雲, 低い雲] /
       cloudTint=雲の影の色(火山は下から赤く照らされる) / snowAlt=雪が乗り始める高さ / strata=岩肌の地層の縞 */
    regions: {
      meadow:  { tex:'meadow',
                 low:0x44602a, high:0x769838, steep:0x6a6352, gravel:0x857d5e, scrub:0x5f8c28,
                 sky:0x2a62a4, haze:0xc9dcd8, fogD:0.00013, sun:0xfff1d6, sunK:1.00,
                 clouds:[0.62, 0.50, 0.25, 0.95], cloudTint:0x56626e, cloud:0.00, ridgeHaze:0.20,
                 rock:[1.04, 1.00, 0.92], snowAlt:1250, strata:0.55,
                 grass:0x6f9a34, veg:{ grass:1.00, flower:1.00, fern:0.35, twig:0.05, blades:0.10 } },
      frost:   { tex:'snow',
                 low:0xa7bbcf, high:0xecf3fd, steep:0x4e5b6e, gravel:0xb7c6d8, scrub:0x98afc4,
                 sky:0x16408c, haze:0xd7e5f3, fogD:0.00011, sun:0xf0f5ff, sunK:1.05,
                 clouds:[0.22, 0.82, 0.35, 0.30], cloudTint:0x5a6c84, cloud:0.00, ridgeHaze:0.15,
                 rock:[0.78, 0.92, 1.22], snowAlt:140, strata:0.25,
                 grass:0xa9b8a0, veg:{ grass:0.14, flower:0.00, fern:0.00, twig:0.10, blades:1.00 } },
      volcano: { tex:'volcanic',
                 low:0x2d1e14, high:0x51392a, steep:0x241913, gravel:0x3d2c20, scrub:0x5a3a1e,
                 sky:0x2c1c1a, haze:0x7a4a33, fogD:0.00022, sun:0xffa870, sunK:0.80,
                 clouds:[1.00, 0.22, 0.00, 1.00], cloudTint:0x4a2418, cloud:0.80, ridgeHaze:0.65,
                 rock:[0.50, 0.44, 0.42], snowAlt:1e9, strata:1.00,
                 grass:0x7a6a3a, veg:{ grass:0.10, flower:0.00, fern:0.00, twig:1.00, blades:0.10 } },
      jungle:  { tex:'jungle',
                 low:0x223c1a, high:0x4a6e2c, steep:0x4a4230, gravel:0x5a4b32, scrub:0x5a8a22,
                 sky:0x3d6f80, haze:0x9fbe9c, fogD:0.00030, sun:0xf4f0c4, sunK:0.68,
                 clouds:[0.78, 0.40, 0.10, 1.00], cloudTint:0x4c5c4a, cloud:0.30, ridgeHaze:0.45,
                 rock:[0.80, 0.92, 0.78], snowAlt:1e9, strata:0.25,
                 grass:0x4f8a2a, veg:{ grass:0.95, flower:0.05, fern:1.00, twig:0.00, blades:0.15 } },
      camp:    { tex:'meadow',
                 low:0x6e5a40, high:0x92805e, steep:0x574c3c, gravel:0x857258, scrub:0x6c7a38,
                 sky:0x2a62a4, haze:0xc9d6d2, fogD:0.00013, sun:0xfff1d6, sunK:1.00,
                 clouds:[0.60, 0.50, 0.25, 0.95], cloudTint:0x56626e, cloud:0.00, ridgeHaze:0.20,
                 rock:[1.00, 0.96, 0.90], snowAlt:1e9, strata:0.0,
                 grass:0x7a8a40, veg:{ grass:0.35, flower:0.10, fern:0.00, twig:0.10, blades:0.10 } },
    },
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
  /* ---- 人工物(身を隠すための遮蔽物)。リアルマップだけに出る ----
     当たり判定は他の障害物と同じ「半径の円」なので、**中には入れない**。
     陰に隠れるための塊として、背は高め(半径の1.3〜2.4倍)にしてある。
     中に入れる建物は別途あらためて設計する(発注者判断・2026-08-13)。        */
  ruinwall:  { h:1.78, sink:0.16, sil:[[0.81,0.86,0.95,1]] },                     // 崩れた石壁
  container: { h:1.36, sink:0.10, sil:[[0.63,0.96,0.68,1]] },                     // 打ち上げられた貨物コンテナ
  ruinpillar:{ h:2.42, sink:0.18, sil:[[1.16,0.44,1.26,1,0.38],[0.28,0.88,0.34,1]] }, // 遺跡の石柱と土台
  hut:       { h:1.58, sink:0.12, sil:[[0.72,0.94,0.82,1]] },                     // 崩れかけた小屋
};
window.__aramonObstShapes = OBST_SHAPES;   // ESモジュール(real3d.js)への橋渡し

/* =====================================================================
   山(火山・雪山・森・ピラミッド)の広さ — **ここが唯一の正**

   【なぜ要るか】山は円錐で、裾を MOUNT_SKIRT だけ地面へ埋めてある。
   つまり **地面の高さでの実際の半径は v.radius より細い**。
   なのに移動の当たり判定・弾の当たり・射線・描画の遮蔽がすべて v.radius を
   そのまま使っていたため、見えている山肌よりかなり外側で止められ、技も遮られていた
   (実機で報告された不具合・2026-08-13)。小さい山ほど差が大きく、
   半径500の山では地面での実半径が約395 = 21%も細い。

   使う側は必ずこの関数を通すこと。**v.radius を直接「山の広さ」として使わない。**
   real3d_props.js もこの形で円錐を作る(window.__aramonMountProfile 経由)。
   ===================================================================== */
const MOUNT_SKIRT = 120;   // 山の裾を地面へ埋める深さ(real3d_props.js と同じ値)
/* 高さ/半径の比。riseK は探検フィールドだけが持つ(なだらかな肩や切り立った崖を作るため)。
   他のマップの山は riseK を持たないので従来どおり(主峰1.15・それ以外0.9)。
   **real3d_props.js の buildMountainMesh も同じ式。変えるときは両方直す。** */
function mountainRiseOf(v){ return v.radius * (v.riseK || (v.isMain ? 1.15 : 0.9)); }
/* 山の「地面からの高さ zUp」における実際の半径。
   zUp=0 なら地面の高さでの半径。円錐なので上へ行くほど細くなる。 */
function mountainRadiusAt(v, zUp){
  const rise = mountainRiseOf(v);
  const h = rise + MOUNT_SKIRT;                      // 円錐の全高(埋めたぶんを含む)
  const s = MOUNT_SKIRT + Math.max(0, zUp || 0);     // 円錐の底からの高さ
  return v.radius * Math.max(0, 1 - s / h);
}
// 地面の高さでの半径(移動の当たり判定・射線・ミニマップはこれを使う)
function mountainGroundRadius(v){ return mountainRadiusAt(v, 0); }
/* mountainGroundRadius の逆(isMain なしの山で、地面での半径が g になる v.radius)。
   探検フィールドのランドマーク(アーチの脚・監視塔など)の当たり判定を
   山の仕組みに乗せるときに使う。g = r*rise/(rise+SKIRT), rise=k*r を r について解いたもの。 */
function mountainRadiusForGround(g, riseK){
  const k = riseK || 0.9;
  return (k*g + Math.sqrt(k*k*g*g + 4*k*MOUNT_SKIRT*g)) / (2*k);
}
window.__aramonMountProfile = { skirt: MOUNT_SKIRT, riseOf: mountainRiseOf, radiusAt: mountainRadiusAt };
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
/* =====================================================================
   探検モードのフィールド(MAPS.explore)
   ・通常の試合とは別の1枚。exploreOnly:true で通常のマップ選択・ランダム抽選から外す
     (判定は下の isSelectableMap() 1か所)
   ・中身(山・尾根・水・岩・遺跡)は world.js の exploreGenWorld() が
     EXPLORE_FIELD_LAYOUT から作る。**毎回同じ形**(固定の種)なので、ホストとゲストで
     同じ世界になる。genVolcanoAndLava などの通常の生成は使わない
   ・見た目は REAL3D_THEMES.explore(地域ブレンド)、高さは REAL3D_TERRAIN_SETS.explore
     + 地域ごとの高さ(exploreElevGrad)                                        */
MAPS.explore = {
  key:'explore', label:'探検フィールド', rockCount:0, decorCount:0, hasVolcano:true,
  mountainStyle:'crag', groundColor:'#3a4a2a',
  previewIcon:'🧭', previewColors:['#4a6a38','#1c2a14'],
  desc:'草原・火山・雪原・密林がつながる広大な探検フィールド。',
  real3d:true, real3dTerrain:'explore', real3dTheme:'explore',
  exploreOnly:true,
  volcanoSites:[], lavaRingPerVolcano:0, lavaPoolCount:0, lavaDps:18,
  // 水と水晶は exploreGenWorld が置く。フラグは「その当たり判定を有効にする」ためのもの
  hasRiver:true, riverCount:0, hasOasis:true, oasisCount:0, hasCrystals:true, crystalCount:0,
  realObstacles:[{ type:'rock', w:1 }],
};
/* 探検フィールドの設計図。**地域・ベースキャンプ・ボスの巣・ランドマークの位置はここが唯一の正。**
   world.js(当たり判定のある物の生成)と real3d_explore.js(ランドマークの3D)と
   real3d_*(地域ブレンドの見た目)が全部ここを読む。座標はワールド単位(18100四方。
   探検は必ず applyWorldScale(1))。x=右 / y=下(ミニマップと同じ向き)。
   ・regions   4つの地域。x,y,radius=地域の中心と広がり(見た目の混ざり方もこれで決まる)
               elev=地域の地面の高さ(なだらかに混ぜる) / mountain=その地域の山の種類
               nest=ボスの巣(周りは空けておく。r=空ける半径)
   ・camp      ベースキャンプ。clear=何も置かない半径 / blend=見た目がキャンプの色になる半径
               beacon=帰還ビーコン(緑の灯火の塔)の位置
   ・passes    尾根・峡谷を抜ける峠。relief の gaps と paths から名前で参照する
   ・relief    起伏(尾根・峡谷・山・段丘・世界の縁)。地形そのものの高さ(exploreRelief)。
               通れない所の当たりは world.js がこの面を測って置く(詳しくは relief の上のコメント)
   ・lakes / rivers / lava / lavaRivers  水辺と溶岩(凍った高地の湖は凍る)
   ・paths     踏み分け道(見た目の土の道。岩を置かない)
   ・structures 人工物の並び(row=線に沿って / ring=円に沿って / houseRow・houseRing=家 /
               wall=折れ線に沿った一続きの石壁。openings=抜け(幅は wallOpenW)・arches=抜けをアーチに)
   ・scatter   地域ごとの岩・木の数と内訳 / crystals=水晶の群生 / giants=密林の巨木
   ・areas     番号付きのエリア(モンハン式。exploreAreaAt で引く)。HUD の札・全体地図が名前を読む
   ・landmarks 遠くから方向が分かる大物(3Dは real3d_explore.js)。foot=当たり判定の半径 */
const EXPLORE_FIELD_LAYOUT = {
  seed: 20260923,
  camp: { x:9050, y:9050, clear:1250, blend:1500, beacon:{ x:9050, y:8680, foot:70 },
          // テントと焚き火(キャンプ中心からのずれ)。隠れられそうな大きさなので当たり判定を持つ
          props:[
            { kind:'tent', dx:-440, dy:-170, rot: 0.35, foot:105 },
            { kind:'tent', dx: 420, dy:-240, rot:-0.50, foot:105 },
            { kind:'tent', dx:-380, dy: 400, rot: 2.70, foot:105 },
            { kind:'tent', dx: 450, dy: 330, rot: 3.75, foot:105 },
            { kind:'fire', dx:   0, dy: 150, rot: 0,    foot:55 },
          ] },
  regions: {
    meadow:  { label:'草原の盆地', x:4700,  y:4800,  radius:3900, elev:-120, mountain:'crag',
               nest:{ x:2300, y:4300, r:620 } },
    frost:   { label:'凍った高地', x:13400, y:4700,  radius:3900, elev: 240, mountain:'snow',
               nest:{ x:15900, y:5300, r:620 } },
    volcano: { label:'火山の峡谷', x:13400, y:13400, radius:4000, elev:  30, mountain:'volcano',
               nest:{ x:12650, y:16550, r:680 } },
    jungle:  { label:'密林の遺跡', x:4700,  y:13300, radius:3900, elev: -40, mountain:'jungle',
               nest:{ x:2500, y:15700, r:620 } },
  },
  passes: {
    n1:[9050,5000], n2:[9030,2900], e1:[13300,9070], e2:[15500,9040],
    s1:[9050,13300], s2:[9040,15400], w1:[4800,9050], w2:[2700,9040],
    c1:[11830,13380], c2:[13360,12250],
    // 洞窟(尾根をくぐる近道。細い切り通しに岩の天井)と尾根越えの高い道
    w3:[5900,9230], e3:[16900,9020], n3:[8960,6650],
  },
  /* 起伏(地形そのものを盛り上げる。円錐の山は使わない)。高さは exploreRelief() が
     real3dHeightAt に足す純関数なので、見た目・歩ける高さ・弾の当たりが全部同じ面になる。
     通れない所(尾根・峡谷の壁・山)は world.js がこの面を実際に測って、その範囲に
     見えない円の判定(noMesh の山)を並べる(= 見た目と判定が必ず一致する)。
     ・ridges   尾根。pts=稜線 / w=裾までの幅 / h=稜線の高さ(どちらも範囲。線に沿ってうねる)
                gaps=峠(そこだけ鞍部まで下がる)。名前だけなら既定の幅。{ p, half, blend } で幅を変え、
                  floor=そこまでしか下げない(尾根越えの高い道) / slot=[通る向き(rad), 長さ]=細長い切り通し /
                  tunnel=切り通しに岩の天井を架ける(洞窟。天井は real3d_explore.js・当たりは world.js)
                strata=地層の段(0〜1)
     ・canyon   峡谷。中心線の両側に台地の壁(band)が立つ。通り道の半幅は narrow と wide(部屋)を
                rooms(中心線の長さに対する位置)で入れ替える=狭い道と広い部屋が交互に来る
     ・peaks    山。r=裾の半径 / h=高さ / warp=輪郭のゆがみ / round=丸い丘(密林)
                crater=火口(r=半径比 / depth=深さ比 / breach=崩れた側の向き[rad])
     ・terraces 段丘・台地。上が平らで、ramp の向き([rad, 半角])だけ緩い坂(傾き0.3未満)で登れる
     ・rim      世界の縁の外へせり上がる山並み(h=高さ / out=外へ伸ばす幅)            */
  relief: {
    gapHalf: 320, gapBlend: 420, ridgeTaper: 1400,
    ridges: [
      // 草原|凍った高地(北)。雪をかぶる高い尾根
      { gaps:[{ p:'n1', half:560, blend:420 },'n2', { p:'n3', half:360, blend:620, floor:230 }], w:[760,1080], h:[620,980], strata:0.15,
        pts:[[9050,7650],[8850,6100],[9200,4300],[8950,2300],[9100,300],[9000,-1200]] },
      // 凍った高地|火山(東)
      { gaps:['e1','e2', { p:'e3', half:150, blend:130, slot:[1.571, 1300], tunnel:true }], w:[720,980], h:[520,820], strata:0.45,
        pts:[[10450,9050],[12200,8850],[14300,9250],[16300,8900],[17900,9100],[19300,9000]] },
      // 火山|密林(南)
      { gaps:['s1','s2'], w:[720,980], h:[500,780], strata:0.45,
        pts:[[9050,10450],[9250,12200],[8850,14300],[9200,16300],[9000,17900],[9100,19300]] },
      // 密林|草原(西)
      { gaps:['w1','w2', { p:'w3', half:150, blend:130, slot:[1.571, 1300], tunnel:true }], w:[700,960], h:[420,660], strata:0.10,
        pts:[[7650,9050],[5900,9250],[3800,8850],[1800,9200],[200,9000],[-1200,9100]] },
      // 凍った高地の氷の尾根
      { gaps:[], w:[520,700], h:[380,560], strata:0.0, pts:[[14700,7300],[15700,7700],[16600,7500]] },
    ],
    canyon: { gaps:['c1','c2'], narrow:210, wide:560, rooms:[0.22, 0.52, 0.82], roomLen:700,
              band:1000, h:[560, 860], strata:0.8, fade:1300,
              pts:[[11500,10900],[12400,12000],[12700,13400],[12400,14800],[12700,15850]] },
    peaks: [
      { id:'frostMain',   x:14900, y:2650,  r:2150, h:2100, warp:0.22 },
      { id:'frost2',      x:11600, y:1950,  r:1500, h:1350, warp:0.25 },
      { id:'volcanoMain', x:15350, y:15150, r:2300, h:1750, warp:0.14, strata:0.35,
        crater:{ r:0.30, depth:0.34, breach:3.6 } },
      { id:'volcano2',    x:16500, y:11700, r:1200, h:780,  warp:0.28, strata:0.5 },
      { id:'jungle1',     x:2100,  y:11300, r:1250, h:680,  warp:0.20, round:true },
      { id:'jungle2',     x:6950,  y:15250, r:1150, h:600,  warp:0.22, round:true },
      { id:'jungle3',     x:1500,  y:14700, r:950,  h:520,  warp:0.25, round:true },
      { id:'meadow1',     x:1850,  y:6650,  r:1150, h:760,  warp:0.26, strata:0.2 },
      { id:'meadow2',     x:6850,  y:2300,  r:1150, h:820,  warp:0.24, strata:0.2 },
    ],
    terraces: [
      // 草原: 監視塔の丘 / アーチ岩の丘
      { id:'towerHill',  x:6300,  y:3500,  r:420, h:240, cliff:280, ramp:[1.50, 0.55] },
      { id:'archHill',   x:3450,  y:6540,  r:880, h:190, cliff:280, ramp:[-1.20, 0.60] },
      // 凍った高地: 氷河の棚(2段)
      { id:'glacierA',   x:11650, y:5450,  r:620, h:270, cliff:280, ramp:[2.40, 0.50] },
      { id:'glacierB',   x:16250, y:5150,  r:520, h:330, cliff:280, ramp:[3.05, 0.45] },
      // 火山: 溶岩の段丘
      { id:'lavaTerrA',  x:16350, y:13650, r:560, h:230, cliff:280, ramp:[3.14, 0.50], strata:0.6 },
      { id:'lavaTerrB',  x:10250, y:16700, r:470, h:220, cliff:280, ramp:[-1.57, 0.50], strata:0.6 },
      // 密林: 遺跡の基壇 / 見晴らしの丘
      { id:'ruinBase',   x:5300,  y:12700, r:960, h:120, cliff:280, ramp:[-0.785, 0.40] },
      { id:'jungleKnoll',x:6250,  y:13950, r:420, h:250, cliff:280, ramp:[-1.57, 0.55] },
    ],
    rim: { h:1500, out:2800, inner:650 },
  },
  lakes: [ { x:4300, y:4400, r:650 }, { x:12900, y:5300, r:520 }, { x:2500, y:12650, r:460 } ],
  rivers: [
    { r:110, pts:[[1100,1300],[2000,2150],[2700,2900],[3350,3650],[3900,4050]] },
    { r:100, pts:[[5600,850],[5250,1900],[4900,2900],[4550,3800]] },
    { r:95,  pts:[[13250,4550],[13150,4750],[12980,4950]] },   // 山の斜面から始めない(崖を縦に流れて板に見えた)
    { r:125, pts:[[700,11650],[1850,12300],[3050,13300],[3750,14500],[4900,15500],[6250,16350],[7500,17500]] },
    // 全体を横切る大きな川: 西の縁の山の麓→草原の湖→峠(n1)→凍った高地の湖→東の縁の山の麓(縁の坂は登らせない)
    { r:120, pts:[[750,3250],[1300,3500],[2800,4100],[3700,4350]] },
    { r:115, pts:[[4950,4650],[6300,5250],[7700,5420],[8400,5380],[9050,5330],[9750,5250],[10050,4450],[11300,4200],[12300,4250],[12560,4880]] },
    { r:110, pts:[[13420,5350],[14400,5800],[15300,5920],[16500,6050],[17350,6150]] },
  ],
  lava: [
    { x:14650, y:11150, r:300 }, { x:14250, y:12450, r:230 }, { x:17200, y:10500, r:230 },
    { x:15450, y:12650, r:240 }, { x:10300, y:14600, r:210 },
    { x:14750, y:12850, r:200 },   // 溶岩の川の湧き口(火山の麓の平らな所。斜面に流すと宙に浮いた帯に見えた)
  ],
  // 溶岩の川(峡谷の東の溶岩原を、火山の麓の湧き口から北へ流れる。平らな所だけを通す)。r=半幅。当たりは円の列(noMesh)で持つ
  lavaRivers: [
    { r:115, pts:[[14800,12700],[14880,12450],[14800,12000],[15150,11450],[15300,10900],[15100,10350]] },
  ],
  paths: [
    { w:120, pts:[[9050,9050],[7900,7900],[6350,6250],[5000,5150],[4700,4800]] },
    { w:120, pts:[[9050,9050],[10250,7850],[11900,6300],[12900,5900]] },
    { w:120, pts:[[9050,9050],[10250,10250],[11500,10900],[12400,12000],[12700,13400],[12400,14800],[12700,15850]] },
    { w:120, pts:[[9050,9050],[7900,10200],[7000,11000],[6150,11850],[5300,12700]] },
    { w:95,  pts:[[6500,4700],'n1',[11400,4700]] },
    { w:95,  pts:[[7000,2500],'n2',[11000,3000]] },
    { w:95,  pts:[[13000,7600],'e1',[14200,10500]] },
    { w:95,  pts:[[15600,7600],'e2',[15500,10500]] },
    { w:95,  pts:[[7200,13300],'s1',[10400,13300],'c1',[12700,13400]] },
    { w:95,  pts:[[7400,15700],'s2',[10600,15600],[12650,16550]] },
    { w:95,  pts:[[4600,7300],'w1',[4600,10800]] },
    { w:95,  pts:[[2600,7500],'w2',[2600,10600]] },
    { w:95,  pts:[[12700,12300],'c2',[14300,12000]] },
    // 近道: 廃村→洞窟→遺跡 / 凍った高地の東→洞窟→溶岩原 / キャンプの北の尾根越え
    { w:85,  pts:[[6300,7400],[5900,8150],'w3',[5900,10300],[5700,11000]] },
    { w:85,  pts:[[16400,6900],[16900,8100],'e3',[16900,9950],[16000,10900]] },
    { w:85,  pts:[[7400,7300],'n3',[10300,6300]] },
  ],
  /* 番号付きのエリア(モンハン式)。HUD の地域の札・全体地図が名前を読む(exploreAreaAt)。
     x,y,r=エリアの中心と広さ(いちばん近い中心のエリアに入る。r の外はどのエリアでもない) */
  areas: [
    { n:1,  name:'ベースキャンプ',   x:9050,  y:9050,  r:1300 },
    { n:2,  name:'草原の廃村',       x:6300,  y:6300,  r:1300 },
    { n:3,  name:'鏡の湖',           x:4300,  y:4400,  r:1300 },
    { n:4,  name:'アーチ岩の丘',     x:3300,  y:6700,  r:1200 },
    { n:5,  name:'物見の丘',         x:6300,  y:3300,  r:1200 },
    { n:6,  name:'北の峠',           x:9050,  y:4000,  r:1100 },
    { n:7,  name:'氷の尖塔',         x:11300, y:3900,  r:1300 },
    { n:8,  name:'氷河の湖',         x:12900, y:5500,  r:1200 },
    { n:9,  name:'竜骨の雪原',       x:15700, y:5300,  r:1400 },
    { n:10, name:'東の洞窟',         x:16900, y:9000,  r:1000 },
    { n:11, name:'溶岩原',           x:14900, y:11600, r:1500 },
    { n:12, name:'火山の峡谷',       x:12500, y:13600, r:1500 },
    { n:13, name:'火口',             x:15300, y:15100, r:1500 },
    { n:14, name:'遺跡の大門',       x:5700,  y:12400, r:1400 },
    { n:15, name:'巨木の森',         x:3500,  y:14200, r:1600 },
    { n:16, name:'西の洞窟',         x:5900,  y:9250,  r:900 },
  ],
  // 石壁の抜け(openings)の幅。world.js の当たりと real3d_explore.js の石積みが両方ここを読む
  wallOpenW: 200,
  structures: [
    // 草原の廃村。通り(キャンプ→湖の道)の両側に石と木の家(face=家の正面の向き。+1=線の左)
    { kind:'houseRow', a:[5520,5920], b:[6800,7020], spacing:330, face:-1, skip:0.12 },
    { kind:'houseRow', a:[5900,5480], b:[7180,6580], spacing:330, face: 1, skip:0.12 },
    // 村の裏の崩れた石垣(一続きの壁。openings=抜けている所。線の長さに対する位置)
    { kind:'wall', h:[120,210], pts:[[6950,5330],[7560,5860],[7700,6250]], openings:[0.45] },
    { kind:'wall', h:[110,200], pts:[[5080,6440],[5560,7060],[5900,7320]], openings:[0.55] },
    // 密林の参道。キャンプから遺跡の大門まで石柱が並ぶ
    { kind:'row', f:'ruinpillar', a:[7884,10484], b:[6700,11668], r:50, spacing:310 },
    { kind:'row', f:'ruinpillar', a:[7516,10116], b:[6332,11300], r:50, spacing:310 },
    // 大門の奥の回廊(二重の石壁。入口をずらして回り込ませる。窓とアーチの抜けがある)
    { kind:'wall', h:[170,300], arches:true, closed:true, openings:[0.125, 0.625],
      pts:[[5300,11850],[6150,12700],[5300,13550],[4450,12700]] },
    { kind:'wall', h:[150,250], arches:true, closed:true, openings:[0.375, 0.875],
      pts:[[5300,12330],[5670,12700],[5300,13070],[4930,12700]] },
    // 凍った高地の打ち捨てられた野営地(雪をかぶった小屋)
    { kind:'houseRing', x:15300, y:6700, R:430, n:4, snowy:true },
    // 火山の峡谷の手前、採掘の前哨(コンテナのバリケード)
    { kind:'row', f:'container', a:[10300,11750], b:[10380,12800], r:56, skip:0.28 },
    { kind:'row', f:'container', a:[10050,13900], b:[10500,14250], r:56, skip:0.20 },
    // ベースキャンプの外周の物資(道の所は自動で空く)
    { kind:'ring', f:'container', x:9050, y:9050, R:1420, n:16, r:54, skip:0.45 },
  ],
  // 密林の巨木。幹だけ当たり判定(foot)、樹冠は頭上で判定なし。空を隠す天井になる
  giants: { region:'jungle', n:60, foot:[80, 120], h:[950, 1400], minGap:400 },
  scatter: {
    meadow:  { n:280, mix:[['rock',0.36],['tree',0.38,[34,58]],['deadtree',0.06],['log',0.11],['ruinwall',0.09]] },
    frost:   { n:300, mix:[['snowrock',0.40],['pine',0.55,[34,58]],['hut',0.05]] },
    volcano: { n:270, mix:[['basalt',0.52],['rock',0.40],['deadtree',0.08]] },
    // 密林は木を大きく・多く(3番目=その種類の半径の幅。省略時は world.js の EXPLORE_FLAVOR_R)
    jungle:  { n:520, mix:[['tree',0.46,[38,72]],['palm',0.16,[36,56]],['rock',0.08],['log',0.12],['ruinpillar',0.09],['ruinwall',0.07]] },
  },
  crystals: { region:'frost', n:170, cluster:[3, 7] },   // 群生(1か所に3〜7本)
  landmarks: [
    // 天然のアーチ岩。アーチの丘(archHill)の上。脚は板状(foot=板の半幅)、断面は2:1、地層入り
    { kind:'arch',  region:'meadow', a:[2900,6280], b:[4000,6800], foot:230, h:980 },
    { kind:'tower', region:'meadow', x:6300,  y:3500,  foot:95, h:600 },
    // 凍った高地の氷の尖塔(塔と被らない形。遠くから青白く光る)
    { kind:'icespire', region:'frost', x:11300, y:3900, foot:210, h:1050 },
    { kind:'gate',  region:'jungle', x:6150,  y:11850, toward:[7000,11000], half:380, foot:135, h:820 },
    { kind:'plume', region:'volcano', peak:'volcanoMain' },
  ],
};
window.__aramonExploreLayout = EXPLORE_FIELD_LAYOUT;   // ESモジュール(real3d_*.js)への橋渡し
const EXPLORE_REGION_KEYS = ['meadow', 'frost', 'volcano', 'jungle'];   // 地域の並び(重みの配列の順番)
/* 見た目の混ざり方の鋭さ。大きいほど境目が細い(4.5で約800単位かけて入れ替わる)。
   高さは別の値(なだらか)で混ぜる。高さの境目を細くすると坂が急になり登れなくなる。 */
const EXPLORE_BLEND_SHARP = 4.5;
const EXPLORE_ELEV_SHARP  = 1.2;
/* ワールド座標 → 地域の重み(純関数)。out[0..3]=EXPLORE_REGION_KEYS の順、out[4]=ベースキャンプ。
   合計は1。境目は波打たせてあるので直線にならない。毎フレーム数千回呼ばれるので
   戻り値の配列は使い回す(呼んだ側ですぐ読むこと)。                      */
const _exW = [0, 0, 0, 0, 0];
function exploreRegionWeights(x, y, out){
  const o = out || _exW, L = EXPLORE_FIELD_LAYOUT;
  const wx = x + 520*Math.sin(y*0.00047 + 1.3) + 240*Math.sin(y*0.00131 + x*0.00043 + 0.4);
  const wy = y + 520*Math.sin(x*0.00051 + 2.1) + 240*Math.sin(x*0.00127 - y*0.00039 + 1.9);
  let sum = 0;
  for(let i=0;i<4;i++){
    const r = L.regions[EXPLORE_REGION_KEYS[i]];
    const dx = (wx - r.x)/r.radius, dy = (wy - r.y)/r.radius;
    const e = Math.exp(-EXPLORE_BLEND_SHARP*(dx*dx + dy*dy));
    o[i] = e; sum += e;
  }
  // ベースキャンプは中心が平らで、縁でなだらかに地域の色へ戻る
  const c = L.camp;
  const cq = ((x-c.x)*(x-c.x) + (y-c.y)*(y-c.y)) / (c.blend*c.blend);
  const cw = Math.exp(-cq*cq*1.6);
  const k = (1 - cw) / (sum || 1);
  for(let i=0;i<4;i++) o[i] *= k;
  o[4] = cw;
  return o;
}
// いちばん重い地域のキー(ベースキャンプは含めない)。生成(world.js)が使う。
// 地域の定義(名前・危険度)ごと欲しいときは exploreRegionAt(ベースキャンプの中なら null)
function exploreRegionKeyAt(x, y){
  const w = exploreRegionWeights(x, y);
  let best = 0;
  for(let i=1;i<4;i++) if(w[i] > w[best]) best = i;
  return EXPLORE_REGION_KEYS[best];
}
/* 地域ごとの地面の高さ(なだらかに混ぜたもの)と、その傾き(解析微分)。
   real3dHeightAt / real3dHeightGrad が探検フィールドのときだけ足す。
   境目を波打たせない(波打たせると微分が複雑になり、坂も急になる)。       */
const _exElev = { h:0, gx:0, gy:0 };
function exploreElevGrad(x, y){
  const L = EXPLORE_FIELD_LAYOUT, S = EXPLORE_ELEV_SHARP;
  let se = 0, sh = 0;
  const e = _exElevE, qx = _exElevQx, qy = _exElevQy;
  for(let i=0;i<4;i++){
    const r = L.regions[EXPLORE_REGION_KEYS[i]];
    const inv = 1/(r.radius*r.radius);
    const dx = x - r.x, dy = y - r.y;
    const ei = Math.exp(-S*(dx*dx + dy*dy)*inv);
    e[i] = ei; qx[i] = 2*dx*inv; qy[i] = 2*dy*inv;
    se += ei; sh += ei*r.elev;
  }
  const H = sh/se;
  let gx = 0, gy = 0;
  for(let i=0;i<4;i++){
    const w = e[i]/se, d = L.regions[EXPLORE_REGION_KEYS[i]].elev - H;
    gx += w*qx[i]*d; gy += w*qy[i]*d;
  }
  _exElev.h = H; _exElev.gx = -S*gx; _exElev.gy = -S*gy;
  return _exElev;
}
const _exElevE = [0,0,0,0], _exElevQx = [0,0,0,0], _exElevQy = [0,0,0,0];

/* =====================================================================
   探検フィールドの起伏(EXPLORE_FIELD_LAYOUT.relief)— 地形の高さそのもの
   ・尾根・峡谷・山・段丘・世界の縁を「高さの関数」として足す(純関数。ホスト/ゲストで一致)。
     円錐の山を並べる作りをやめたのは、どう彫っても「ピラミッドの列」に見えたため(批評家の指摘)。
   ・重なった所はいちばん高いものを採る(max)。細部のノイズは三角関数だけで作る(速さのため)。
   ・毎フレーム何百回も呼ばれるので、特徴の影響範囲を1000単位の格子に登録しておき、
     その点の升に載っている特徴だけを調べる。
   ・傾き(real3dHeightGrad)は起伏の部分だけ中心差分で求める(地形パッチの頂点にしか使わない)。
   ===================================================================== */
const EXR_CELL = 1000, EXR_ORG = -10000, EXR_N = 39;   // 格子(ワールドの外側10000まで覆う)
let _exr = null;
const _exSm = (a, b, x)=>{ const t = x <= a ? 0 : (x >= b ? 1 : (x - a)/(b - a)); return t*t*(3 - 2*t); };
// 尾根の襞・谷筋に使う安いノイズ(0〜1)。1-|sin| の稜が交差して沢筋の模様になる
function exploreRidgeNoise(x, y){
  const a = 1 - Math.abs(Math.sin(x*0.0023 + y*0.0011 + Math.sin(y*0.0017)*1.3));
  const b = 1 - Math.abs(Math.sin(-x*0.0013 + y*0.0029 + Math.sin(x*0.0021)*1.1));
  const c = 1 - Math.abs(Math.sin(x*0.0061 - y*0.0043 + Math.sin(x*0.0037 + y*0.0023)*0.8));
  return a*0.42 + b*0.36 + c*0.22;
}
// 地層の段。平らな踏面と急な段差を作る(amt=0で素通り)
function exploreStrata(h, step, amt){
  if(!amt || h <= 0) return h;
  const q = h/step, fl = Math.floor(q), fr = q - fl;
  // 段の7割は緩い踏面、残り3割で一気に上がる(連続なので段差で歩けなくはならない)
  const g = fr < 0.7 ? fr*0.25/0.7 : 0.25 + 0.75*_exSm(0.7, 1, fr);
  return h + ((fl + g)*step - h)*amt;
}
function explorePolyPrep(pts, passes){
  const P = pts.map(p=> (typeof p === 'string') ? { x:passes[p][0], y:passes[p][1] } : { x:p[0], y:p[1] });
  const segs = []; let s0 = 0;
  for(let i=0;i<P.length-1;i++){
    const a = P[i], b = P[i+1], vx = b.x-a.x, vy = b.y-a.y, len = Math.hypot(vx, vy) || 1;
    segs.push({ ax:a.x, ay:a.y, vx, vy, l2:len*len, len, s0 });
    s0 += len;
  }
  return { segs, total:s0, pts:P };
}
// 折れ線への最寄り点(距離 d・弧長 u・u は端の外へはみ出した分も負/超過で返す)。
// u は近い線分どうしで重みを付けて混ぜる: 最寄りの1本だけで決めると、折れ線の曲がり角の内側で
// 最寄りの線分が入れ替わる所で u が飛び、u で変わる高さ・部屋の幅が段差(垂直の崖)になった。
const _exNear = { d:0, u:0 }, _exNd = [], _exNu = [];
const EXPLORE_NEAR_BLEND = 160;   // この距離差まで隣の線分の弧長を混ぜる
function exploreNearest(poly, x, y){
  let best = Infinity;
  const S = poly.segs, n = S.length;
  for(let i=0;i<n;i++){
    const g = S[i];
    let t = ((x - g.ax)*g.vx + (y - g.ay)*g.vy)/g.l2;
    const tc = t < 0 ? 0 : (t > 1 ? 1 : t);
    const dx = x - (g.ax + g.vx*tc), dy = y - (g.ay + g.vy*tc);
    const d = Math.sqrt(dx*dx + dy*dy);
    _exNd[i] = d;
    // 端の外は弧長を伸ばして返す(峡谷の入口を開けるのに使う)
    _exNu[i] = g.s0 + ((i === 0 && t < 0) || (i === n-1 && t > 1) ? t : tc)*g.len;
    if(d < best) best = d;
  }
  let sw = 0, su = 0;
  for(let i=0;i<n;i++){
    const k = 1 - (_exNd[i] - best)/EXPLORE_NEAR_BLEND;
    if(k <= 0) continue;
    sw += k*k; su += k*k*_exNu[i];
  }
  _exNear.d = best; _exNear.u = su/sw;
  return _exNear;
}
function exploreReliefPrep(){
  const R = EXPLORE_FIELD_LAYOUT.relief, P = EXPLORE_FIELD_LAYOUT.passes;
  const feats = [];
  // 峠は名前だけ('n1')でも、幅や高さを持つ形({ p, half, blend, floor, slot, tunnel })でも書ける
  const gapPts = (g)=> g.map(k=>{
    const o = (typeof k === 'string') ? { p:k } : k;
    const q = P[o.p];
    return { x:q[0], y:q[1], half:o.half, blend:o.blend, floor:o.floor || 0,
             sx:o.slot ? Math.cos(o.slot[0]) : 0, sy:o.slot ? Math.sin(o.slot[0]) : 0, len:o.slot ? o.slot[1]/2 : 0 };
  });
  R.ridges.forEach((r, i)=>{
    const poly = explorePolyPrep(r.pts, P);
    feats.push({ type:0, poly, w:r.w, h:r.h, strata:r.strata||0, gaps:gapPts(r.gaps), ph:i*1.73 + 0.4, pad:r.w[1] });
  });
  {
    const c = R.canyon, poly = explorePolyPrep(c.pts, P);
    feats.push({ type:1, poly, c, gaps:gapPts(c.gaps), rooms:c.rooms.map(f=> f*poly.total), ph:2.9, pad:c.wide + c.band });
  }
  R.peaks.forEach((p, i)=> feats.push({ type:2, p, ph:i*2.31 + 1.1, pad:p.r*(1 + (p.warp||0)) }));
  R.terraces.forEach((t, i)=> feats.push({ type:3, t, ph:i*1.37 + 0.7, pad:t.r*1.15 + Math.max(t.cliff, t.h*6.2) }));
  // 格子へ登録(特徴の外接矩形 + 影響幅)
  const grid = new Array(EXR_N*EXR_N);
  for(let i=0;i<grid.length;i++) grid[i] = [];
  feats.forEach((f, fi)=>{
    let x0, y0, x1, y1;
    if(f.poly){ x0 = Math.min(...f.poly.pts.map(q=>q.x)); x1 = Math.max(...f.poly.pts.map(q=>q.x));
                y0 = Math.min(...f.poly.pts.map(q=>q.y)); y1 = Math.max(...f.poly.pts.map(q=>q.y)); }
    else { const o = f.p || f.t; x0 = x1 = o.x; y0 = y1 = o.y; }
    const cx0 = Math.max(0, Math.floor((x0 - f.pad - EXR_ORG)/EXR_CELL)), cx1 = Math.min(EXR_N-1, Math.floor((x1 + f.pad - EXR_ORG)/EXR_CELL));
    const cy0 = Math.max(0, Math.floor((y0 - f.pad - EXR_ORG)/EXR_CELL)), cy1 = Math.min(EXR_N-1, Math.floor((y1 + f.pad - EXR_ORG)/EXR_CELL));
    for(let cy=cy0; cy<=cy1; cy++) for(let cx=cx0; cx<=cx1; cx++) grid[cy*EXR_N + cx].push(fi);
  });
  _exr = { feats, grid, R };
}
// 峠で高さを下げる。floor>0 の峠はそこまでしか下げない(尾根越えの道)。slot の峠は通る向きに細長い
function exploreGapApply(gaps, x, y, R, h){
  for(const g of gaps){
    let dx = x - g.x, dy = y - g.y, d;
    if(g.len){
      const a = dx*g.sx + dy*g.sy, b = -dx*g.sy + dy*g.sx;   // a=通る向き / b=横
      d = Math.hypot(Math.max(0, Math.abs(a) - g.len), b);
    } else d = Math.hypot(dx, dy);
    const half = g.half != null ? g.half : R.gapHalf, blend = g.blend != null ? g.blend : R.gapBlend;
    if(d >= half + blend) continue;
    const k = _exSm(half, half + blend, d);
    const lo = Math.min(h, g.floor);
    h = lo + (h - lo)*k;
  }
  return h;
}
function exploreFeatureH(f, x, y, R){
  if(f.type === 0){                                   // 尾根
    const nr = exploreNearest(f.poly, x, y), u = nr.u;
    const W = f.w[0] + (f.w[1]-f.w[0])*(0.5 + 0.5*Math.sin(u*0.0013 + f.ph))*(0.82 + 0.18*Math.sin(u*0.0047 + f.ph*2));
    const t = nr.d/W;
    if(t >= 1) return 0;
    const H = f.h[0] + (f.h[1]-f.h[0])*(0.5 + 0.5*Math.sin(u*0.00093 + f.ph*1.7))*(0.78 + 0.22*Math.sin(u*0.0031 + f.ph));
    let prof = 1 - t*t*(3 - 2*t);
    prof = prof*(0.72 + 0.28*prof);                   // 稜線を少し尖らせる
    let h = H*prof*(0.68 + 0.32*exploreRidgeNoise(x, y));
    h *= _exSm(0, R.ridgeTaper, u);                  // 始点(マップの中央側)は平地から立ち上がる(台形の塊にしない)
    if(f.gaps.length) h = exploreGapApply(f.gaps, x, y, R, h);
    return exploreStrata(h, 110, f.strata);
  }
  if(f.type === 1){                                   // 峡谷(中心線の両側に台地の壁)
    const c = f.c, nr = exploreNearest(f.poly, x, y), u = nr.u;
    let room = 0;
    for(const rs of f.rooms){ const q = Math.abs(u - rs)/c.roomLen; if(q < 1) room = Math.max(room, 1 - q*q*(3 - 2*q)); }
    const half = c.narrow + (c.wide - c.narrow)*room;
    const ti = (nr.d - half)/c.band;
    if(ti <= 0 || ti >= 1) return 0;
    const H = c.h[0] + (c.h[1]-c.h[0])*(0.5 + 0.5*Math.sin(u*0.0021 + f.ph))*(0.8 + 0.2*Math.sin(u*0.0057));
    // 内側は切り立った崖・上は平ら・外側はやや緩い斜面
    let h = H*_exSm(0, 0.15, ti)*(1 - _exSm(0.50, 1, ti));
    h *= 0.86 + 0.14*exploreRidgeNoise(x*1.3, y*1.3);
    h *= _exSm(0, c.fade, u)*_exSm(0, c.fade, f.poly.total - u);   // 入口と出口は開ける
    if(f.gaps.length) h = exploreGapApply(f.gaps, x, y, R, h);
    return exploreStrata(h, 95, c.strata);
  }
  if(f.type === 2){                                   // 山
    const p = f.p, dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
    if(d >= p.r*(1 + (p.warp||0))) return 0;
    const th = Math.atan2(dy, dx), w = p.warp || 0;
    const rr = p.r*(1 + w*(0.55*Math.sin(3*th + f.ph) + 0.30*Math.sin(5*th + f.ph*2) + 0.15*Math.sin(8*th + f.ph*3)));
    const t = d/rr;
    if(t >= 1) return 0;
    const prof = p.round ? (1 - t*t)*(1 - t*t)
                         : 0.68*Math.pow(1 - t, 1.6) + 0.32*(1 - t*t)*(1 - t*t);
    const nK = 0.66 + 0.34*exploreRidgeNoise(x + f.ph*500, y);
    let h = p.h*prof*nK;
    if(p.crater){
      /* 火口。縁の高さは「その点の山の面を火口の半径で測った高さ」なので、縁の内と外で段差が出ない
         (別の式で縁を作ると、縁の上で高さが飛んで垂直の壁になった)。崩れた側(breach)は縁ごと下げる。 */
      const cr = p.crater, crR = cr.r*(1 + 0.12*Math.sin(7*th + f.ph) + 0.07*Math.sin(13*th + 1.3));
      let da = th - cr.breach; da = Math.atan2(Math.sin(da), Math.cos(da));
      const br = Math.exp(-(da/0.42)*(da/0.42));
      const B = 1 - 0.36*br;
      const rimH = p.h*(0.68*Math.pow(1 - crR, 1.6) + 0.32*(1 - crR*crR)*(1 - crR*crR))*nK*B;
      if(t < crR){
        // 火口の底は平ら(中心で角度によって高さが変わらないよう、縁の揺らぎ・崩れを含めない高さから測る)
        const floorH = p.h*(0.68*Math.pow(1 - cr.r, 1.6) + 0.32*(1 - cr.r*cr.r)*(1 - cr.r*cr.r))*nK - p.h*cr.depth;
        h = floorH + (rimH - floorH)*Math.pow(_exSm(0.45, 1, t/crR), 1.3);
      }else if(t < crR*1.9){
        h *= B + (1 - B)*_exSm(crR, crR*1.9, t);
      }
    }
    return exploreStrata(h, 120, p.strata || 0);
  }
  // 段丘・台地(上が平ら。ramp の向きだけ緩い坂)
  const T = f.t, dx = x - T.x, dy = y - T.y, d = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
  let da = th - T.ramp[0]; da = Math.atan2(Math.sin(da), Math.cos(da));
  const m = Math.exp(-(da/T.ramp[1])*(da/T.ramp[1]));
  const W = T.cliff + (T.h*6.2 - T.cliff)*m;
  const edge = T.r*(1 + 0.08*Math.sin(5*th + f.ph) + 0.05*Math.sin(9*th + f.ph*2));
  const ti = (d - edge)/W;
  if(ti >= 1) return 0;
  const prof = ti <= 0 ? 1 : 1 - ti*ti*(3 - 2*ti);
  const h = T.h*prof*(0.96 + 0.04*exploreRidgeNoise(x, y));
  return exploreStrata(h, 80, T.strata || 0);
}
// 世界の縁: マップの外へせり上がる山並み(内側 inner だけは緩い坂)
function exploreRimH(x, y, R){
  const W = WORLD_BASE_SIZE, din = Math.min(x, y, W - x, W - y);
  const rim = R.rim;
  if(din > rim.inner) return 0;
  const t = (rim.inner - din)/(rim.inner + rim.out);
  const k = t >= 1 ? 1 : t*t*(3 - 2*t);
  return rim.h*k*(0.62 + 0.38*exploreRidgeNoise(x*0.8 + 300, y*0.8));
}
// いま居る番号付きのエリア(EXPLORE_FIELD_LAYOUT.areas)。いちばん近い中心のエリアで、r の外なら null
function exploreAreaAt(x, y){
  let best = null, bd = Infinity;
  for(const a of EXPLORE_FIELD_LAYOUT.areas){
    const d = Math.hypot(x - a.x, y - a.y);
    if(d < a.r && d/a.r < bd){ bd = d/a.r; best = a; }
  }
  return best;
}
function exploreRelief(x, y){
  if(!_exr) exploreReliefPrep();
  const R = _exr.R;
  let h = exploreRimH(x, y, R);
  const cx = Math.floor((x - EXR_ORG)/EXR_CELL), cy = Math.floor((y - EXR_ORG)/EXR_CELL);
  if(cx < 0 || cy < 0 || cx >= EXR_N || cy >= EXR_N) return h;
  const list = _exr.grid[cy*EXR_N + cx], F = _exr.feats;
  for(let i=0;i<list.length;i++){
    const v = exploreFeatureH(F[list[i]], x, y, R);
    if(v > h) h = v;
  }
  return h;
}
/* 通常のマップ選択・ランダム抽選に出してよいマップか。**判定はここ1か所だけ。**

   【この関数が無かったせいで起きた不具合】
   MAPS.raid には「通常のマップ選択・ランダム抽選から外す」つもりで raidOnly:true を
   付けてあったが、**この印はどこからも読まれていなかった**。抽選側(resolveMapKey)は
   testOnly しか見ていなかったため、「マップ=ランダム + リアルマップON」で竜の火口が
   当たることがあり、**通常マルチのつもりでレイドバトルが始まっていた**(実機で発生)。
   マップを増やすときに除外の条件を書き足す場所は、必ずここ1つにする。            */
function isSelectableMap(key){
  const m = MAPS[key];
  // exploreOnly = 探検モード専用のフィールド(explore.js が必ず立てる)。通常の抽選には出さない
  return !!m && !m.testOnly && !m.raidOnly && !m.exploreOnly;
}
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
/* レイド最終報酬(参加者全員へ配布)のスキン。**版の報酬表から参照するのでここで先に定義する。**
   (モンスター作成スタジオはこの行を行頭一致で書き換えるので、位置が変わっても差し支えない) */
const RAID_CLEAR_SKIN = 'joker_ssr';

/* 日付で「版」を選ぶ共通関数(シーズン・レイド共通、1か所。編集はここだけでよい)。
   端末のローカル日付(YYYY-MM-DD)を作り、startDate<=today の版のうち startDate が
   一番遅いものの id を返す(該当が無ければ fallbackId)。日付の作り方は dailyTodayStr()と
   同じ new Date()+getFullYear/getMonth/getDate の組み合わせだが、startDate の文字列は
   ゼロ埋めなので、こちらもゼロ埋めして辞書順で正しく比較できるようにしてある。
   ページ読み込み時に一度だけ決まる(開きっぱなしの端末は次に開いたときに切り替わる)。
   手で固定したいときは、呼び出し側の引数を渡さず id の文字列を直接書けばよい。 */
function editionByDate(editions, fallbackId){
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  let bestId = null, bestStart = null;
  Object.keys(editions).forEach(id=>{
    const start = editions[id].startDate;
    if(start && start <= today && (bestStart===null || start > bestStart)){ bestId = id; bestStart = start; }
  });
  return bestId || fallbackId;
}
// editionByDate と違い「今日」を見ず、startDateが一番新しい版を無条件に返す。
// レイド限定スキンの判定(raidExclusiveSkinIds)は「次に開催される回」の分から
// 先に切り替えたいので、開催日を待つ editionByDate ではなくこちらを使う。
function latestEditionId(editions, fallbackId){
  let bestId = null, bestStart = null;
  Object.keys(editions).forEach(id=>{
    const start = editions[id].startDate;
    if(start && (bestStart===null || start > bestStart)){ bestId = id; bestStart = start; }
  });
  return bestId || fallbackId;
}

/* ===== 開催ごとの「版(edition)」 =====
   開催のたびに動かす数字だけをここへ集め、**RAID_EDITION(実体は editionByDate による
   日付の自動選択)を変えるだけで次回開催へ切り替わる**。
   期間・ボスHP・報酬しきい値は互いに噛み合っているので(aramon-season-raid 参照)、
   別々の場所に置くと片方だけ直して食い違う。版ごとに1組で持つ。

   【厳守】**開催中の版の数字は書き換えないこと。**
   しきい値を動かすと「付与済み回数」の意味が変わり、繰り返し報酬が二重付与/未付与になる。
   次回ぶんは新しい版を足して、開催が終わってから RAID_EDITION を切り替える。

   数字の決め方は管理者画面「プレイ状況 → レイド分析」が実測から推奨値を出すので、
   次の版を確定させる前に必ずそれを見る(勘で決めない)。                        */
const RAID_EDITIONS = {
  /* 第1回(2026-08-07〜)。**開催済み/開催中なので数字を動かさない。** */
  r1: {
    label: '第1回',
    startDate: '2026-08-07',   // シーズン1と同時開幕
    durationDays: 7,           // 開催期間(1週間)
    baseHp: 24000,             // 1人あたりの基準HP(人数ぶん増える。3人で50,400)
    totalTiers: [
      { at:  50000, gold:1500, dia:20 },
      { at: 200000, gold:3000, dia:40, item:'freeTrainTicket', n:3 },
      { at: 500000, gold:5000, dia:60, item:'moveTicket', n:3 },
      // レイドでしか手に入らない基礎値アイテム(生命の果実・加速剤)を目玉にする
      { at:1200000, gold:8000, dia:100, items:[{key:'fruit_life',n:1},{key:'accel_elixir',n:1}] },
      { at:2500000, gold:12000, dia:150, skin:RAID_CLEAR_SKIN },   // 討伐達成: 全員に限定SSR
    ],
    personalTiers: [
      { at:   4000, gold:500,  dia:5 },
      { at:  16000, gold:1200, dia:10, item:'freeTrainTicket', n:1 },
      { at:  50000, gold:2500, dia:20, item:'moveTicket', n:1 },
      { at: 120000, gold:4000, dia:35, items:[{key:'fruit_life',n:1},{key:'accel_elixir',n:1}] },
      { at: 300000, gold:7000, dia:60, items:[{key:'fruit_life',n:1},{key:'accel_elixir',n:1}] },
    ],
    repeatPersonal: { step:  100000, gold:1000, dia:30, item:'freeTrainTicket', n:1 },
    repeatTotal:    { step: 1000000, gold:5000, dia:70, item:'freeTrainTicket', n:5 },
    // この回のレイド限定スキン。最新の版のものだけがレイドガチャ・SSRレイドカタログ限定になり、
    // 古い版のものは通常ガチャ・SSRカタログへ自動で解放される
    exclusiveSkins: ['guts_ssr'],
    moveDmg: {},               // ボスの技の威力は既定値のまま
    // ボスの見た目・名前・入口画面の文言(版ごと)。RAID_BOSS が下でここを読む
    boss: { element:'fire', skinId:'zod_ssr', name:'不死のゾッド', lead:'不死身の巨竜<b>ゾッド</b>が火口に降り立った。' },
  },
  /* 第2回(r2)は 2026-08-21 開始で用意していたが、一度も有効にしないまま終了日を迎えた
     ため削除し、第3回(r3)に置き換えた(2026-09-04)。moveDmg の暫定値(nova/ring/meteor)は
     育成なしの体を即死させない調整として r3 でそのまま引き継いでいる。 */
  /* 第3回「あるるかん討伐」(2026-09-04〜、2週間)。
     ・baseHp を24,000→40,000へ引き上げ(1回の与ダメと報酬もそのぶん上がる)。
     ・全体最終段=10,000,000(討伐達成で全員に限定SSR「あるるかん」)。
     ・答え合わせ: 個人最終段600,000 ÷ 1回の上限(3人で baseHp×人数ぶん=約84,000)≒8回。
       全体10,000,000は「1日あたり715,000 = 1回8万なら9回/日」。 */
  r3: {
    label: '第3回',
    startDate: '2026-09-04',
    durationDays: 14,          // 開催期間(2週間)
    baseHp: 40000,
    keyImg: 'images/raid_arurukan.jpg',  // レイド画面の絵(既定は images/raid_key.jpg)
    totalTiers: [
      { at:  200000, gold:1500, dia:20 },
      { at:  800000, gold:3000, dia:40, item:'freeTrainTicket', n:3 },
      { at: 2000000, gold:5000, dia:60, item:'moveTicket', n:3 },
      { at: 4800000, gold:8000, dia:100, items:[{key:'fruit_life',n:1},{key:'accel_elixir',n:1}] },
      { at:10000000, gold:15000, dia:200, skin:RAID_CLEAR_SKIN },   // 討伐達成: 全員に限定SSR
    ],
    personalTiers: [
      { at:   8000, gold:500,  dia:5 },
      { at:  32000, gold:1200, dia:10, item:'freeTrainTicket', n:1 },
      { at: 100000, gold:2500, dia:20, item:'moveTicket', n:1 },
      { at: 240000, gold:4000, dia:35, items:[{key:'fruit_life',n:1},{key:'accel_elixir',n:1}] },
      { at: 600000, gold:8000, dia:80, items:[{key:'fruit_life',n:1},{key:'accel_elixir',n:1}] },
    ],
    repeatPersonal: { step:  200000, gold:1000, dia:30, item:'freeTrainTicket', n:1 },
    repeatTotal:    { step: 2000000, gold:5000, dia:70, item:'freeTrainTicket', n:5 },
    // この回のレイド限定スキン。最新の版のものだけがレイドガチャ・SSRレイドカタログ限定になり、
    // 古い版のものは通常ガチャ・SSRカタログへ自動で解放される
    exclusiveSkins: ['warm_ssr'],
    // ボス専用の技4つ(第1回の6技とは総入れ替え。moveDmgでの上書きは使わない=キーを持たない)。
    // style=描画側(render.js/fx_moves.js)が絵を見分けるための印。bind.freezeSec=命中で動きを封じる秒数。
    // 威力の根拠: 第1回の同種と比べて tail56→72(+29%) / breath64→80(+25%) /
    //   meteor86→95(+10%、拘束が付くぶん控えめ) / nova130→160(+23%)
    bossMoves: [
      { key:'gear',    tier:1, name:'虎乱(コラン)',              shape:'circle', range:1150, dmg:72,  telegraph:1.10, color:'#f5ec00', selfCentered:true, style:'jokerGear',
        warn:'⚠ 虎乱 — 歯車が回る！あるるかんから離れろ！' },
      { key:'arrow',   tier:1, name:'炎の矢(フレッシュ・アンフラメ)', shape:'fan',    range:2200, fanAngleDeg:30, dmg:80, telegraph:1.20, color:'#ff5a2e', style:'jokerPiston',
        warn:'⚠ 炎の矢 — 正面の細い帯から外れろ！' },
      { key:'feather', tier:2, name:'羽の舞踏(ラ・ダンス・ダン・ヴオラン)', shape:'meteor', range:520, dmg:95, telegraph:1.50, color:'#c98cff', count:4, style:'jokerFeather', bind:{ freezeSec:1.6 },
        warn:'⚠ 羽の舞踏 — 羽根の輪から逃げろ！動きを封じられる！' },
      { key:'sword',   tier:3, name:'聖ジョージの剣',              shape:'fan',    range:3000, fanAngleDeg:150, dmg:160, telegraph:2.10, color:'#ffd400', style:'jokerSword',
        warn:'☠ 聖ジョージの剣 — 剣の外側、背後へ回り込め！' },
    ],
    // 舞台をリアルマップの雪山(パパス)に変える。ラベル・アイコンも版ごとに切り替わる
    // (直後の Object.assign(MAPS.raid, RAID_ED.map) で MAPS.raid へ合流させる)
    map: {
      label:'ジョーカーの雪山', real3dTerrain:'drift', real3dTheme:'papas',
      mountainStyle:'snow', groundColor:'#dbe8f2',
      previewIcon:'🃏', previewColors:['#dce8f2','#8fa9be'],
      desc:'雪山を背にあるるかんが待ち構える円形の闘技場。逃げ場は狭い。',
    },
    // ボスの見た目・名前・入口画面の文言(版ごと)。
    // element はあえて 'joker' にせず 'fire' のまま据え置く: ELEMENTS.joker は dmgDealtMod:1.2
    // を持ち(ELEMENTS.fire は無し)、ボスの与ダメ計算はダメージ元(=ボス)の element から
    // 直接この倍率を掛ける(combat.js のapplyDamage、target.isRaidBoss等の条件無し)ため、
    // element だけ変えると上のbossMovesで調整済みの威力にさらに20%乗ってしまう。
    // 一方スキンの表示(getDisplayImage→skinnedImageForEntity)は entity.element と
    // SSR_SKINS[skinId].element の一致を見ておらず skinId だけで絵を出すので、
    // 見た目はSSRスキン「あるるかん」のまま素体は据え置き(=fire)で問題ない。
    boss: { element:'fire', skinId:'joker_ssr', name:'あるるかん', lead:'ジョーカー<b>あるるかん</b>が雪山に現れた。' },
  },
};
// 版は日付で自動選択(開催前後で自動的に切り替わる)。手で固定したいときはここへ id の文字列を書く
const RAID_EDITION = editionByDate(RAID_EDITIONS, 'r1');
const RAID_ED = RAID_EDITIONS[RAID_EDITION] || RAID_EDITIONS.r1;
// 版が舞台(map)を持てば MAPS.raid へ合流させる(第1回は map を持たないので竜の火口のまま)。
// MAPS.raid 自体は RAID_EDITIONS より前で定義済みなので、ここで上書きする形にしてある
Object.assign(MAPS.raid, RAID_ED.map || {});
// レイド限定スキンの判定用: 開催日を待たず「一番新しく定義された版」を指す。
// 次回ぶんの版を先に足しておけば、その時点で今回の版の限定スキンが通常ガチャへ解放される。
const RAID_LATEST_EDITION = latestEditionId(RAID_EDITIONS, 'r1');
// 「今のレイド限定」のSSRスキンID一覧(=最新の版のexclusiveSkinsだけ)
function raidExclusiveSkinIds(){
  return (RAID_EDITIONS[RAID_LATEST_EDITION] || {}).exclusiveSkins || [];
}

const RAID_START_DATE = RAID_ED.startDate;
const RAID_DURATION_DAYS = RAID_ED.durationDays;
const RAID_CAPACITY = 3;                  // 同時に挑める人数=3人チーム固定(余りはマスモン・botで補充)
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
// ボスの見た目・名前は版ごと(RAID_EDITIONS[版].boss)。無い版はr1にフォールバック
const RAID_BOSS_DEF = RAID_ED.boss || RAID_EDITIONS.r1.boss;
const RAID_BOSS = {
  element: RAID_BOSS_DEF.element,   // 素体(ステータス・与ダメ倍率などの元になる種族)。版が変わっても既定はドラゴン
  skinId:  RAID_BOSS_DEF.skinId,    // 見た目はSSRスキン。歩行コマもこのスキンのものが出る
  name:    RAID_BOSS_DEF.name,
  radius: 288,               // 通常のモンスター(22前後)の13倍。画面を覆うほどの巨体
  baseHp: RAID_ED.baseHp,    // 1人あたりの基準HP。人数ぶん増える(raidBossMaxHp。3人で50,400)
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
//   telegraph : 予告の長さ(秒)。この間は当たらず、点線+塗りの予告と標的だけが出る
//   warn      : 予告トーストの文言
// 予告から発動までを、各技のtelegraphより少し長くする(「見えたのに間に合わなかった」を減らす)
const RAID_TELEGRAPH_EXTRA = 0.4;
function raidTelegraphTime(move){ return (move && move.telegraph || 0) + RAID_TELEGRAPH_EXTRA; }
// 既定(第1回)の技6つ。版が独自の技(bossMoves)を持たない場合はこちらを使う
const RAID_BOSS_MOVES_DEFAULT = [
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
// 版が独自の技を持てば(第3回など)それを使う。style=描画の見分け、bind=命中で動きを封じる
const RAID_BOSS_MOVES = RAID_ED.bossMoves || RAID_BOSS_MOVES_DEFAULT;
/* 版ごとの威力の上書き(RAID_EDITIONS[].moveDmg)。表そのものを版ごとに複製すると
   範囲・予告・文言まで二重管理になるので、**変える数字(dmg)だけを差し替える**。
   指定の無い技は上の既定値のまま。bossMovesを独自に持つ版はmoveDmgを使わない(キー不一致で何も起きない)。 */
Object.keys(RAID_ED.moveDmg || {}).forEach(key=>{
  const mv = RAID_BOSS_MOVES.find(m=>m.key===key);
  if(mv) mv.dmg = RAID_ED.moveDmg[key];
});
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
  warm_ssr:       { dmgDealt:1.5, dmgTaken:0.75, name:'電王ライナー' }, /*@warm_ssr*/
  // レイド第3回ピックアップの残り2体。電王ライナー(1.5/0.75)より弱い特効にしてある
  metag_ssr:      { dmgDealt:1.3, dmgTaken:0.85, name:'メタルグレイモン' },
  leaf_ssr:       { dmgDealt:1.3, dmgTaken:0.85, name:'メカビオギドラ' },
  // <<AUTO:RAID_EFFECT_SKINS>> ここから上へ tools/studio_web.html がレイド特効スキンの行を追記する
};
function raidSkinBonus(skinId){ return (skinId && RAID_EFFECT_SKINS[skinId]) || null; }
/* レイドガチャのピックアップ(=レイド特効スキン)。**複数体を並べられる**
   (スキンガチャの GACHA_PICKUP_SSR_IDS と同じ形。2026-09-04導入)。
   ピックアップ全体でSSR枠の1%を等分し、残りは他SSRで等分する(pickRaidGachaSsrSkinId)。 */
const RAID_GACHA_PICKUP_IDS = ['warm_ssr', 'metag_ssr', 'leaf_ssr']; /*@raidpickup*/
// PICK UPの札に出す文字。null なら1体目のスキン名をそのまま出す(GACHA_PICKUP_LABELと同じ扱い)
const RAID_GACHA_PICKUP_LABEL = '機械モンスター';
// ガチャ画面・記念ポップアップに出す告知画像。null なら1体目のスキンのpromoImgを使う
const RAID_GACHA_PROMO_IMG = 'images/promo_raid_s2.jpg';
function isRaidGachaPickup(id){ return RAID_GACHA_PICKUP_IDS.indexOf(id) >= 0; }
// ※ RAID_CLEAR_SKIN は版の報酬表から参照するため、このファイルの前の方で定義してある

/* --- 報酬 ---
   累計ダメージの到達報酬(全員共通)と、個人の与ダメ順位に応じた報酬。
   **中身は開催ごとの版(RAID_EDITIONS)が持つ。** ここは選ばれている版を指すだけで、
   数字を直接書かない(期間・ボスHPと噛み合わせるため1か所にまとめてある)。 */
/* 最後の段の at がレイド全体の「ボスの総HP」として表示される(raid画面の残り体力バー)。
   1回の戦闘のボスHP(RAID_BOSS.baseHp)と同じ倍率で増減させること。 */
const RAID_TOTAL_TIERS = RAID_ED.totalTiers;
// 個人の累計与ダメによる報酬(上から順に、達成した一番上のものまで全部もらえる)
const RAID_PERSONAL_TIERS = RAID_ED.personalTiers;
/* 最終段のあとも走り続けられるようにする繰り返し報酬。
   最終段の`at`を超えてから`step`ごとに1回もらえる(個人は300,000の次が400,000)。
   **受け取りボタンは出さず、レイド画面を開いたときに未付与ぶんをまとめて渡す。**
   ボタン方式だと、既に走り込んだ人へ後から差分を届けられないため。 */
const RAID_REPEAT_PERSONAL = RAID_ED.repeatPersonal;
const RAID_REPEAT_TOTAL    = RAID_ED.repeatTotal;
// 到達量から「繰り返し報酬を何回ぶん獲得しているか」を出す(付与済み回数との差が未付与ぶん)
function raidRepeatCount(reached, tiers, rep){
  const last = tiers[tiers.length-1].at;
  if(!(reached > last) || !rep.step) return 0;
  return Math.floor((reached - last) / rep.step);
}
// 次に繰り返し報酬がもらえる到達量
function raidRepeatNextAt(tiers, rep, gotTimes){
  return tiers[tiers.length-1].at + ((gotTimes||0) + 1) * rep.step;
}
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
    // repeatTotal/repeatPersonal は繰り返し報酬を何回ぶん渡したか(古い保存には無いので0扱い)
    if(r.weekId !== raidWeekId()) return { weekId:raidWeekId(), dmg:0, runs:0, best:0, claimedTotal:{}, claimedPersonal:{}, repeatTotal:0, repeatPersonal:0 };
    return { weekId:r.weekId, dmg:Math.max(0,r.dmg||0), runs:r.runs||0, best:Math.max(0,r.best||0),
             claimedTotal:r.claimedTotal||{}, claimedPersonal:r.claimedPersonal||{},
             repeatTotal:Math.max(0,r.repeatTotal||0), repeatPersonal:Math.max(0,r.repeatPersonal||0) };
  }catch(err){ return { weekId:raidWeekId(), dmg:0, runs:0, best:0, claimedTotal:{}, claimedPersonal:{}, repeatTotal:0, repeatPersonal:0 }; }
}
function saveRaidProgress(r){
  try{ localStorage.setItem(RAID_STORAGE_KEY, JSON.stringify(r)); }catch(err){}
  if(typeof accountMarkDirty==='function') accountMarkDirty();
}

/* =====================================================================
   UTIL
===================================================================== */
const rand = (a,b)=>a+Math.random()*(b-a);
/* 連射1発ごとの横のブレ(rad)。**読む場所を4か所に散らさない**ため、式はここ1つだけ。
   使うのは combat.js の2か所(範囲技・通常弾)と network.js の2か所(ゲストの見た目)。

   既定は**等間隔の扇**(中心を挟んで左右へ均等に開く)。
   `burstSpreadRandom:true` を持つ技だけ、**同じ幅の中でランダムにブレる**
   (発注者指定 ―― ザンと疾風。等間隔だと弾道が定規で引いたように見えるため)。
   幅そのものは変えないので、当たり方の広さは等間隔のときと同じ。

   ※ ランダムにすると**ホストの当たり判定とゲストの見た目で角度が食い違う**。
     通常弾は元から狙いのブレ(jitter)が乗っていて同じ食い違いがあるので実害は無いが、
     範囲技(aoeShape)は今まで完全に一致していた。**範囲技へこの印を付けるときは、
     ゲストに見える形が変わることを承知のうえで付けること。** */
function burstSpreadOffset(move, i, burstCount){
  if(!move || burstCount <= 1) return 0;
  const step = (move.burstSpread != null) ? move.burstSpread : 0.05;
  /* burstDirs = 連射を「方向の束」に分ける数(ジョーカーのデスファイナル = 5連射×3方向)。
     束どうしは burstDirSpread ぶん離し、束の中の広がりは今までどおり burstSpread が決める。
     **束は順番でなく交互に選ぶ**(i%dirs)。順番に撃つと左を撃ち終えてから正面…と
     掃くように見えるが、交互だと左右と正面へ同時に散り続けて「無数に飛んでくる」になる。
     ここに置くのは、発射側(ボット・プレイヤー・範囲技)が全部この関数だけを呼ぶため。 */
  const dirs = Math.max(1, move.burstDirs || 1);
  let dirOff = 0, k = i, n = burstCount;
  if(dirs > 1){
    n = Math.ceil(burstCount / dirs);                     // 1束あたりの発数
    k = Math.floor(i / dirs);                             // 束の中で何発目か
    const gap = (move.burstDirSpread != null) ? move.burstDirSpread : 0.30;
    dirOff = ((i % dirs) - (dirs - 1) / 2) * gap;
  }
  if(!step) return dirOff;
  const half = (n - 1) / 2 * step;   // 等間隔のときの端までの幅
  return dirOff + (move.burstSpreadRandom ? rand(-half, half) : (k - (n - 1) / 2) * step);
}
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
/* 財布。**モン晶(shard)もここに入れる。**
   別の保存キーにすると ACCOUNT_SYNC_KEYS への追加と移行が要るが、財布へ足せば
   同期も「無ければ0」も既存のまま効く(古いセーブは shard が無いので自然に0になる)。 */
function loadWallet(){
  try{
    const w = JSON.parse(localStorage.getItem(WALLET_STORAGE_KEY)) || {};
    return { gold: Math.max(0, Math.round(w.gold||0)), dia: Math.max(0, Math.round(w.dia||0)),
             shard: Math.max(0, Math.round(w.shard||0)) };
  }catch(err){ return { gold:0, dia:0, shard:0 }; }
}
function saveWallet(w){
  try{ localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(w)); }catch(err){}
  if(typeof accountMarkDirty==='function') accountMarkDirty();
}
function addWallet(gold, dia, shard){
  const w = loadWallet();
  w.gold += Math.round(gold||0); w.dia += Math.round(dia||0); w.shard += Math.round(shard||0);
  saveWallet(w);
  return w;
}
function addShards(n){ return addWallet(0, 0, n||0); }
function shardCount(){ return loadWallet().shard; }
// 足りるか。足りなければ false(呼ぶ側でトーストを出す)
function spendShards(n){
  const need = Math.max(0, Math.round(n||0));
  const w = loadWallet();
  if(w.shard < need) return false;
  w.shard -= need;
  saveWallet(w);
  return true;
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
/* アイテムを1つ減らす。足りなければ**何もせず false**(呼ぶ側でトーストを出す)。
   **名前を useBagItem にしない。** ui.js に「アイテムをマスモンに使う」別物の
   useBagItem(itemKey, mmKey, qty) があり、あとから読み込まれるこちらが勝つため、
   同じ名前にすると黙って別の関数が呼ばれる(実際に一度やった)。
   0になったキーは消す(バッグの一覧が「0個」の行で埋まらないように)。
   **消費はここ1か所を通す。** 数を直接引くコードを増やすと、二重消費や
   マイナス在庫が入り込む余地ができる。 */
function consumeBagItem(key, n){
  const need = Math.max(1, Math.round(n||1));
  const b = loadBag();
  if((b[key]||0) < need) return false;
  b[key] -= need;
  if(b[key] <= 0) delete b[key];
  saveBag(b);
  return true;
}

// ===== バトル操作画面カスタマイズ(端末ごとにHUD配置を保存。アカウント同期はしない) =====
const HUD_LAYOUT_KEY = 'aramon_hud_layout_v1';
// カスタマイズ対象の要素id → 編集モードで表示するラベル。値は#hud基準の割合(fx,fy)で保存する
const HUD_DRAGGABLE = {
  joystickBase:'移動', fireBtn:'攻撃', dashBtn:'回避',
  turnLeftBtn:'左回転', turnRightBtn:'右回転', movePanel:'技',
  topLeft:'HP/ガッツ', statsPanel:'撃破/ダメ', topRight:'情報/地図',
  // 普段は隠れているので、編集モードのあいだだけ見本を出して動かせるようにしてある
  trainCardBar:'トレーニング', pingBtn:'ピン',
  /* 撃破ログは元は「情報/地図」(#topRight)の子で一緒に動いていたが、回転ボタンとの
     重なりを直すため#hudの直下へ出した。**ここに足さないと動かせなくなる**うえ、
     編集中は暗幕の下に潜って見えなくなる(2026-08-22) */
  killFeed:'撃破ログ',
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
  { id:'kill30', name:'修羅',             emoji:'👹', cat:'キル', type:'matchKills', n:30 },
  { id:'kill40', name:'荒野の死神',       emoji:'💀', cat:'キル', type:'matchKills', n:40 },
  // 1試合の与ダメージ
  { id:'dmg1000', name:'パンチ',           emoji:'👊', cat:'ダメージ', type:'matchDamage', n:1000 },
  { id:'dmg1500', name:'アッパー',         emoji:'🥊', cat:'ダメージ', type:'matchDamage', n:1500 },
  { id:'dmg2000', name:'ハンマー',         emoji:'🔨', cat:'ダメージ', type:'matchDamage', n:2000 },
  { id:'dmg2500', name:'ビリビリハンマー', emoji:'⚡', cat:'ダメージ', type:'matchDamage', n:2500 },
  { id:'dmg3000', name:'縦ハンマー',       emoji:'⛏️', cat:'ダメージ', type:'matchDamage', n:3000 },
  { id:'dmg4000', name:'ダブルハンマー',   emoji:'🛠️', cat:'ダメージ', type:'matchDamage', n:4000 },
  { id:'dmg5000', name:'メテオハンマー',   emoji:'☄️', cat:'ダメージ', type:'matchDamage', n:5000 },
  { id:'dmg7500',  name:'ギガハンマー',   emoji:'🌋', cat:'ダメージ', type:'matchDamage', n:7500 },
  { id:'dmg10000', name:'テラハンマー',   emoji:'🌠', cat:'ダメージ', type:'matchDamage', n:10000 },
  { id:'dmg15000', name:'星砕き',         emoji:'💫', cat:'ダメージ', type:'matchDamage', n:15000 },
  { id:'dmg20000', name:'創世ハンマー',   emoji:'🌌', cat:'ダメージ', type:'matchDamage', n:20000 },
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
  { id:'tutorial', name:'新人モン動', emoji:'🔰', cat:'特殊', type:'tutorial' },
];
// 種族ごとの覇者称号。ELEMENTS に1体足せば称号も自動で増える
Object.keys(ELEMENTS).forEach(key=>{
  TITLES.push({ id:`lord_${key}`, name:`${ELEMENTS[key].label}の覇者`, emoji:'👑',
                cat:'覇者', type:'lifetimeLord', element:key });
});
const TITLES_BY_ID = {}; TITLES.forEach(t=>{ TITLES_BY_ID[t.id]=t; });

/* =====================================================================
   試合ハイライト: リザルトの1枚目に**1試合1つだけ**出す。上から順に最初に当たった物。
   ctx = { isWin, placement, kills, damage, bestKills, bestDamage(更新前の自己ベスト),
           mmFirstWin(この子の初チャンピオンか), maxStreak(10秒以内の連続キルの最大),
           hpRatio(終了時HP割合 0..1) }
   文言は遊ぶ人向けの短い日本語。ここに1行足せば増える。
===================================================================== */
const HIGHLIGHT_CLUTCH_HP = 0.15;   // 「残りHPわずかで勝利」とみなす割合
/* 【文言に絵文字を入れない】この1行が出るのはリザルトの1枚目だけで、そこは
   `#resultScreen .result-highlight` が**左のアクセント罫 + アクセント色の文字**を
   既に持っている。飾りは罫と色が受け持つので、頭に絵文字を足すと
   金1色の画面に既製の絵が1つだけ浮く(2026-08-29 批評の指摘)。 */
const HIGHLIGHT_DEFS = [
  { id:'firstWin',  test:(c)=> c.isWin && c.mmFirstWin,                    text:(c)=> 'この子と初めてのチャンピオン！' },
  { id:'bestKills', test:(c)=> c.kills>0 && c.kills>c.bestKills,           text:(c)=> `自己ベスト更新！ ${c.kills}キル` },
  // 数字の書式はリザルト共通の rsNum(4桁以上を3桁区切り)。ここだけ別の書き方をしない
  { id:'bestDmg',   test:(c)=> c.damage>0 && c.damage>c.bestDamage,        text:(c)=> `自己ベスト更新！ ${rsNum(c.damage)}ダメージ` },
  { id:'streak3',   test:(c)=> c.maxStreak>=3,                             text:(c)=> `${c.maxStreak}連続キル！` },
  { id:'clutch',    test:(c)=> c.isWin && c.hpRatio<=HIGHLIGHT_CLUTCH_HP,  text:(c)=> '残りHPわずかからの大逆転！' },
];
function pickHighlight(ctx){
  for(const d of HIGHLIGHT_DEFS){ try{ if(d.test(ctx)) return d.text(ctx); }catch(e){} }
  return '';
}
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
    case 'tutorial':    return `チュートリアルを終える`;
    case 'allElem':     return `全モンスターでプレイ`;
    case 'lifetimeLord': return `${ELEMENTS[t.element].label}の累計ミッションをすべて達成`;
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
  /* 【2026-08-15】ガチャ被りのダイヤ還元をやめたぶん、ダイヤの総量が減らないように
     ここを引き上げてある(5/10/20 → 10/15/30)。**ダイヤの総量は据え置きが方針。** */
  { dia:10 },                        // Day3
  { gold:300 },                      // Day4
  { item:'freeTrainTicket', n:1 },   // Day5
  { dia:15 },                        // Day6
  { gold:500, dia:30 },              // Day7(大)
];
// 毎日リセットされるミッション(固定3種)。ゴールドは100単位
const DAILY_MISSIONS = [
  { id:'play', name:'試合に3回参加する', target:3, reward:{ gold:100 }, track:'play' },
  { id:'kill', name:'合計5キルする',     target:5, reward:{ gold:200 }, track:'kill' },
  // 被り還元の廃止ぶんの埋め合わせで 5 → 10(2026-08-15)
  { id:'win',  name:'1回勝利する',       target:1, reward:{ dia:10 },   track:'win'  },
];
/* 累計ミッション: マスモン1体ごとに、その子の戦歴(rec)や育成状況で進む。
   value はその子の現在値。tiers は小さい順で、**届いた段を1つずつ受け取る**。
   受け取り状況は mm.mis[key] = 受け取り済みの段数(1始まり)。
   数値バランスは発注者が実機で調整する前提なので、この表が唯一の置き場。
   【報酬の設計意図(2026-08-28)】💠(モン晶)は最終段のみ(秘伝の書=💠100 の長期目標を
   崩さない)。後半に🪙を残す(トレーニング消費は後半ほど大きい)。 */
const LIFETIME_MISSIONS = [
  { key:'matches',  icon:'⚔️', label:'試合に出る',       unit:'試合',
    value:(mm)=> mmRec(mm).m,
    tiers:[ {n:5,   reward:{gold:500}}, {n:20,  reward:{dia:20}},
            {n:50,  reward:{item:'freeTrainTicket', n:1}},
            {n:100, reward:{gold:3000}}, {n:200, reward:{shard:50}} ] },
  { key:'kills',    icon:'🎯', label:'敵を倒す',         unit:'キル',
    value:(mm)=> mmRec(mm).k,
    tiers:[ {n:10,  reward:{gold:500}}, {n:50,  reward:{dia:20}},
            {n:150, reward:{item:'freeTrainTicket', n:1}}, {n:400, reward:{dia:40}} ] },
  { key:'damage',   icon:'💥', label:'ダメージを与える', unit:'',
    value:(mm)=> mmRec(mm).dmg,
    tiers:[ {n:10000,  reward:{gold:500}},  {n:50000,  reward:{dia:20}},
            {n:150000, reward:{gold:2000}}, {n:400000, reward:{dia:40}} ] },
  { key:'level',    icon:'🌟', label:'レベルを上げる',   unit:'',
    value:(mm)=> (mm.level||1),
    tiers:[ {n:10, reward:{gold:1000}}, {n:30, reward:{dia:30}},
            {n:60, reward:{item:'freeTrainTicket', n:2}}, {n:100, reward:{dia:80}} ] },
  { key:'rebirth',  icon:'♻️', label:'転生する',         unit:'回',
    value:(mm)=> mastermonRebirthCount(mm),
    tiers:[ {n:1, reward:{dia:40}}, {n:3, reward:{gold:5000}}, {n:5, reward:{dia:120}} ] },
  { key:'training', icon:'💪', label:'トレーニングする', unit:'回',
    value:(mm)=> mmRec(mm).tr,
    tiers:[ {n:20, reward:{gold:1000}}, {n:60, reward:{dia:20}}, {n:150, reward:{gold:3000}} ] },
];
function lifetimeClaimedTier(mm, key){ return Math.max(0, Math.round((mm && mm.mis && mm.mis[key]) || 0)); }
// 次に受け取れる段(1始まり)。無ければ0
function lifetimeClaimableTier(mm, def){
  const done = lifetimeClaimedTier(mm, def.key);
  if(done >= def.tiers.length) return 0;
  return def.value(mm) >= def.tiers[done].n ? done + 1 : 0;
}
// 全項目の最終段まで受け取り済みか(覇者称号の条件)
function lifetimeMissionAllComplete(mm){
  return !!mm && LIFETIME_MISSIONS.every(d=> lifetimeClaimedTier(mm, d.key) >= d.tiers.length);
}
// 覇者称号の条件。ui.js の titleConditionMet から呼ばれる(別担当が結線)
function lifetimeLordEarned(elementKey){
  const mm = loadMastermons()[elementKey];
  return !!mm && lifetimeMissionAllComplete(mm);
}
/* ===== プレイヤー累計ミッション(ミッション「累計」タブの最上部) =====
   段の n と称号名は **TITLES が正**(手書きの対応表を作らない。ui.js の
   accountMissionDefs が type ごとに n 昇順へソートして段にする)。ここに持つのは
   **報酬列だけ**(typeごと・n昇順。TITLES の途中に段が挿し込まれても昇順どうしで
   対応するのでずれない)。列が足りない段は既定 {gold:1000}。
   【報酬の設計意図】💠(モン晶)は各typeに多くて1段だけ(秘伝の書=💠100 の長期目標を
   崩さない)。数値は発注者が実機で調整する。 */
const ACCOUNT_MISSION_REWARDS = {
  matches:     [ {gold:300}, {gold:1000}, {dia:30},   {dia:50},   {shard:50} ], // 1/10/50/100/300
  wins:        [ {gold:500}, {dia:20},    {dia:40},   {shard:50}, {dia:150}  ], // 1/5/10/25/50
  totalKills:  [ {dia:30},   {gold:5000}, {dia:100} ],                          // 100/500/1000
  totalDamage: [ {dia:30},   {dia:50} ],                                        // 50000/200000
};
/* TITLES に段が無いプレイヤー累計ミッション。進捗の取り方は ui.js 側
   (titlesCumulativeStats の elemPlayed)。20種の段は称号「オールラウンダー」と同時期に届く。 */
const ACCOUNT_EXTRA_MISSIONS = [
  { key:'elems', icon:'🌈', label:'いろんなモンスターで遊ぶ', unit:'種',
    tiers:[ {n:5, reward:{gold:1000}}, {n:10, reward:{dia:30}}, {n:20, reward:{dia:80}} ] },
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
/* 報酬を「1つ=1要素」の配列で返す。**中身の正はここ1か所。**
   1行に並べたいところは rewardText()(下)、1つずつ行に分けたいところ(ミッションの行)は
   こちらを使う。分け方を2か所に書かないための入口。 */
function rewardParts(r){
  if(!r) return [];
  const parts = [];
  if(r.gold) parts.push(`🪙${r.gold}`);
  if(r.dia)  parts.push(`💎${r.dia}`);
  if(r.shard) parts.push(`💠${r.shard}`); // モン晶(SHARD_ICONと同じ絵。宣言順の都合で直書き)
  for(const x of rewardItemList(r)) parts.push(playerItemTextLabel(x.key, x.n));
  if(r.skin){ const m = (typeof skinMeta==='function') ? skinMeta(r.skin) : null; parts.push(`✨${m?m.name:'スキン'}`); }
  return parts;
}
function rewardText(r){ return rewardParts(r).join(' '); }
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
  if(r.gold || r.dia || r.shard) addWallet(r.gold||0, r.dia||0, r.shard||0);
  for(const x of rewardItemList(r)) addBagItem(x.key, x.n);
  if(r.skin && typeof ownSkin==='function') ownSkin(r.skin);
  // スキンカタログ(あとで好きな1着を選べる引換券)。モン晶の交換所が使う
  if(r.catalog && typeof addCatalog==='function') addCatalog(r.catalog, r.n || 1);
}

/* =====================================================================
   遠征: マスモンを送り出して、遊んでいない時間に報酬を持ち帰らせる

   ・**マスモン(mm)には何も保存しない。** 出撃中かどうかはこのストアだけが持つ
     (mmの形を変えないでおく。ゴーストなど後の機能がmmを丸ごと写すため)。
   ・時刻は端末の Date.now()。レイド・デイリーと同じ土俵にそろえる。
     時計を戻されたときだけ壊れないように startAt を今へ丸める(loadで読むときに丸めるだけ)。
   ・報酬は「育成アイテム / マスモンEXP / レアな当たり枠」の3種だけ。
     素のゴールドは出さない(試合報酬と役割が被り、放置が試合より得になる)。
     基礎値アイテム(生命の果実・加速剤)も出さない(レイド討伐限定の希少性を壊す)。
   ・**どの子をどこへ出すか**が判断になるよう、行き先ごとに「相性のステータス」を持たせ、
     出したマスモンのその実値で報酬が 0.6〜1.7 倍に変わる。★は出発前に見せる。
===================================================================== */
const EXPEDITION_STORAGE_KEY = 'aramon_expedition_v1';
/* 同時に出せる枠は**所持マスモン数**で解放する(2体目を育てる理由を作る)。
   [必要な所持数, そのときの枠数] を小さい順に並べる。ここに1行足せば増える。 */
const EXPEDITION_SLOT_UNLOCKS = [ { own:1, slots:1 }, { own:3, slots:2 }, { own:6, slots:3 } ];
const EXPEDITION_MAX_SLOTS = 3;
/* 相性。行き先の stat の実値 → ★と倍率。**上から順に max 以下で判定する。** */
const EXPEDITION_AFFINITY = [
  { max:199,      star:1, mult:0.6 },
  { max:399,      star:2, mult:0.8 },
  { max:599,      star:3, mult:1.0 },
  { max:799,      star:4, mult:1.3 },
  { max:Infinity, star:5, mult:1.7 },
];
const EXPEDITION_EXP_LEVEL_DIVISOR = 50;   // EXPは (1 + Lv/50) 倍。育った子ほどEXPが要るため
const EXPEDITION_RARE_CHANCE_MAX = 0.40;   // 当たり枠の確率の上限
/* 遠征中の枠に出す「今その子がやっていること」。**行き先の表の中に置く**ので、
   行き先を1行足せば情景も実況もそのまま付いてくる(別に対応表を作らない)。
   ・実況の文は EXPEDITION_LOG_INTERVAL_SEC ごとに logs を順ぐりで送る。
     **乱数を使わない**ので、画面を開き直しても閉じても同じ時刻には同じ文が出る。
   ・残りが EXPEDITION_HOMEWARD_AT を超えたら、行き先によらず帰り道の文に変わる。 */
const EXPEDITION_LOG_INTERVAL_SEC = 20;
const EXPEDITION_HOMEWARD_AT = 0.9;
const EXPEDITION_HOMEWARD_LOG = '🏠 帰り道に入った。もうすぐ！';
/* 情景の色と舞う粒。sky/sky2=空のグラデーション、ground=地面、
   mote={ ch:粒の文字, color:色, dir:'up'|'side'|'down' } → style.cssの .exp-fx-<dir> が動かす。 */
/* 行き先。**ここに1行足すだけで画面・相性・抽選・遠征中の情景まで回る。**
   reward.items は固定のアイテム、reward.randomSeeds はステータスの実からランダムでN個。
   長いほど時間あたりの取り分を良くしてある(2h=30EXP/h → 12h=42EXP/h)。 */
const EXPEDITIONS = [
  { id:'quarry',  name:'石切り場',       icon:'⛏️', hours:2,  stat:'vitality',
    reward:{ items:[{ key:'seed_vitality', n:1 }] }, exp:60,
    rare:{ chance:0.08, reward:{ item:'freeTrainTicket', n:1 } },
    desc:'固い岩を運び出す。丈夫な子ほど多く持ち帰る',
    scene:{ sky:'#3b352c', sky2:'#7a6647', ground:'#4a3a28', far:'⛰️',
      mote:{ ch:'✦', color:'#e6cd9c', dir:'up' },
      logs:['岩肌に道具を打ち込んでいる', 'ずっしりした石を担ぎ上げた', '砕けたかけらを選り分け中',
            '足場を組み直して奥へ進む', '大きな岩がびくともしない…', 'ひと息ついて、また掘る'] } },
  { id:'ridge',   name:'風鳴りの丘',     icon:'🌬️', hours:2,  stat:'evasion',
    reward:{ items:[{ key:'seed_evasion', n:1 }] }, exp:60,
    rare:{ chance:0.08, reward:{ item:'expeditionRecall', n:1 } },
    desc:'吹き上がる風の中を駆け抜ける。身のこなしがものを言う',
    scene:{ sky:'#2b4a63', sky2:'#9fc9dd', ground:'#4c6b4f', far:'🌾',
      mote:{ ch:'〜', color:'#e6f4ff', dir:'side' },
      logs:['吹き上がる風に乗って駆ける', '足元の砂利をひらりとかわす', '突風が来た！ 体を低くする',
            '尾根づたいに軽やかに走る', '風の音にまじって何かが光った', '崖っぷちをするりと抜けた'] } },
  { id:'library', name:'忘れられた書庫', icon:'📚', hours:6,  stat:'wisdom',
    reward:{ items:[{ key:'seed_wisdom', n:2 }] }, exp:220,
    rare:{ chance:0.14, reward:{ dia:20 } },
    desc:'古い書物を読み解く。かしこい子ほど成果が大きい',
    scene:{ sky:'#241f31', sky2:'#5b4a6d', ground:'#3a2f44', far:'📕',
      mote:{ ch:'✧', color:'#f0dfae', dir:'up' },
      logs:['古い本を棚から出してめくる', '読めない文字とにらめっこ中', 'ほこりだらけの巻物を見つけた',
            'ろうそくの明かりで書き写す', '本の山がくずれた！ 積み直す', '一冊だけ光っている本がある'] } },
  { id:'crater',  name:'火口の縁',       icon:'🌋', hours:6,  stat:'power',
    reward:{ items:[{ key:'seed_power', n:2 }] }, exp:220,
    rare:{ chance:0.14, reward:{ item:'moveTicket', n:1 } },
    desc:'熱気の中で岩を砕く。力自慢の子に向く',
    scene:{ sky:'#3a1a12', sky2:'#93401a', ground:'#4a2317', far:'🌋',
      mote:{ ch:'●', color:'#ffab5c', dir:'up' },
      logs:['熱気にあおられながら岩を砕く', '火の粉をはらって前へ進む', '真っ赤な石を手早く運び出す',
            '足場の岩がぐらついている…', '大きく振りかぶって、一撃！', '汗をぬぐってもうひと踏ん張り'] } },
  { id:'trail',   name:'巡礼の道',       icon:'🧭', hours:12, stat:'life',
    reward:{ randomSeeds:3 }, exp:500,
    rare:{ chance:0.22, reward:{ dia:50 } },
    desc:'丸一日かけて歩き通す。体力のある子ほど遠くまで行ける',
    scene:{ sky:'#2f3f5c', sky2:'#e0a66d', ground:'#5b4a33', far:'🏔️',
      mote:{ ch:'·', color:'#f3e2b8', dir:'side' },
      logs:['長い一本道をひたすら歩く', '道ばたの実をひとつ摘んだ', '日が傾いた。歩みは止めない',
            '旅の人とすれちがって手をふる', '小さな橋をわたっている', '足を止めて空を見上げた'] } },
  { id:'abyss',   name:'深淵の裂け目',   icon:'🕳️', hours:12, stat:'accuracy',
    reward:{ items:[{ key:'seed_accuracy', n:2 }], randomSeeds:1 }, exp:500,
    rare:{ chance:0.22, reward:{ item:'freeTrainTicket', n:3 } },
    desc:'足場の悪い裂け目を進む。狙いの正確な子ほど深く潜れる',
    scene:{ sky:'#10141f', sky2:'#2c3653', ground:'#191f2e', far:'🕳️',
      mote:{ ch:'◦', color:'#9fd8ff', dir:'down' },
      logs:['足場を確かめながら降りていく', '暗がりの奥で何かが動いた…', '細いすき間をすり抜けた',
            'ランプで底をのぞきこむ', '落ちてきた小石をよけた', '手ざわりだけを頼りに進む'] } },
];
function expeditionDest(id){ return EXPEDITIONS.find(e=>e.id===id) || null; }
// ステータスの実の一覧。**表(PLAYER_ITEMS)から作る**ので実を足せば自動で候補に入る
function expeditionSeedItemKeys(){
  return Object.keys(PLAYER_ITEMS).filter(k=>PLAYER_ITEMS[k].stat);
}
// この行き先に対するこのマスモンの相性(★と倍率)
function expeditionAffinity(dest, mm){
  const v = Math.round((mm && mm.stats && dest && mm.stats[dest.stat]) || 0);
  return EXPEDITION_AFFINITY.find(a=>v<=a.max) || EXPEDITION_AFFINITY[EXPEDITION_AFFINITY.length-1];
}
/* 出発前に見せる成果の見込み。**受け取り時もこの関数を通す**ので、
   「見せた内容」と「実際にもらえる内容」がずれない(当たり枠だけ確率で上乗せ)。 */
function expeditionRewardPreview(dest, mm){
  const af = expeditionAffinity(dest, mm);
  const src = (dest && dest.reward) || {};
  const items = (src.items||[]).map(x=>({ key:x.key, n:Math.max(1, Math.round(x.n*af.mult)) }));
  const randomSeeds = src.randomSeeds ? Math.max(1, Math.round(src.randomSeeds*af.mult)) : 0;
  const dia = src.dia ? Math.max(1, Math.round(src.dia*af.mult)) : 0;
  const lv = Math.max(1, Math.round((mm && mm.level) || 1));
  const exp = Math.round((dest.exp||0) * af.mult * (1 + lv/EXPEDITION_EXP_LEVEL_DIVISOR));
  const rareChance = Math.min(EXPEDITION_RARE_CHANCE_MAX, (dest.rare ? dest.rare.chance : 0) * af.mult);
  return { star:af.star, mult:af.mult, items, randomSeeds, dia, exp, rareChance,
           rare:(dest.rare ? dest.rare.reward : null) };
}
/* 受け取りの中身を確定させる(ランダムの実と当たり枠をここで引く)。
   **呼ぶのは受け取りの1回だけ。** 引き直しは枠を空にすることで防ぐ。 */
function expeditionRollResult(dest, mm){
  const p = expeditionRewardPreview(dest, mm);
  const items = p.items.map(x=>({ key:x.key, n:x.n }));
  const seeds = expeditionSeedItemKeys();
  for(let i=0;i<p.randomSeeds && seeds.length;i++){
    const k = seeds[Math.floor(Math.random()*seeds.length)];
    const hit = items.find(x=>x.key===k);
    if(hit) hit.n += 1; else items.push({ key:k, n:1 });
  }
  const rare = (p.rare && Math.random() < p.rareChance) ? p.rare : null;
  return { star:p.star, exp:p.exp, reward:{ dia:p.dia||0, items }, rare };
}
// 1枠ぶんの保存値を安全な形にそろえる。**未来の時刻は今へ丸める**(時計を戻されても壊れない)
function sanitizeExpeditionSlot(s){
  if(!s || !expeditionDest(s.dest) || !s.mmKey) return null;
  const start = Math.min(Date.now(), Math.max(0, Math.round(s.startAt)||0));
  return { dest:s.dest, mmKey:String(s.mmKey), startAt:start, done:!!s.done };
}
function loadExpeditions(){
  try{
    const d = JSON.parse(localStorage.getItem(EXPEDITION_STORAGE_KEY)) || {};
    const slots = Array.isArray(d.slots) ? d.slots : [];
    return { slots: slots.slice(0, EXPEDITION_MAX_SLOTS).map(sanitizeExpeditionSlot) };
  }catch(err){ return { slots:[] }; }
}
function saveExpeditions(d){
  const out = { slots: (d && Array.isArray(d.slots) ? d.slots : []).slice(0, EXPEDITION_MAX_SLOTS)
                        .map(s=>s ? sanitizeExpeditionSlot(s) : null) };
  try{ localStorage.setItem(EXPEDITION_STORAGE_KEY, JSON.stringify(out)); }catch(err){}
  if(typeof accountMarkDirty==='function') accountMarkDirty();
}
// 今使える枠の数(所持マスモン数で決まる)
function expeditionSlotCount(){
  const own = (typeof loadMastermons==='function') ? Object.keys(loadMastermons()).length : 0;
  let n = 0;
  for(const u of EXPEDITION_SLOT_UNLOCKS){ if(own >= u.own) n = Math.max(n, u.slots); }
  return Math.min(EXPEDITION_MAX_SLOTS, n);
}
// あと何体育てれば次の枠が開くか(0なら次は無い)
function expeditionNextUnlock(){
  const own = (typeof loadMastermons==='function') ? Object.keys(loadMastermons()).length : 0;
  const next = EXPEDITION_SLOT_UNLOCKS.find(u=>own < u.own);
  return next ? { need:next.own - own, slots:next.slots } : null;
}
function expeditionEndAt(slot){
  const d = slot && expeditionDest(slot.dest);
  return d ? slot.startAt + d.hours*3600000 : 0;
}
// 'empty'(空き) / 'running'(遠征中) / 'ready'(受け取り待ち)。**読むだけ。書き戻さない**
function expeditionSlotState(slot, now){
  if(!slot || !slot.dest) return 'empty';
  if(slot.done) return 'ready';
  return (now||Date.now()) >= expeditionEndAt(slot) ? 'ready' : 'running';
}
function expeditionSecondsLeft(slot, now){
  return Math.max(0, Math.ceil((expeditionEndAt(slot) - (now||Date.now()))/1000));
}
/* ここから下は「遠征中の様子」を出すための読み取り専用の計算。**保存には一切触らない。**
   同じ時刻を渡せば必ず同じ結果になるので、画面を作り直しても表示が飛ばない。 */
// 0(出発)〜1(到着)。時短アイテムで done になった枠は1
function expeditionProgress(slot, now){
  const d = slot && expeditionDest(slot.dest);
  if(!d) return 0;
  if(slot.done) return 1;
  const total = d.hours*3600000;
  if(!(total > 0)) return 1;
  return Math.max(0, Math.min(1, ((now||Date.now()) - slot.startAt)/total));
}
function expeditionScene(dest){ return (dest && dest.scene) || null; }
// 今この瞬間の実況。EXPEDITION_LOG_INTERVAL_SEC ごとに送り、終盤は帰り道の文になる
function expeditionLogLine(slot, now){
  const d = slot && expeditionDest(slot.dest);
  const sc = expeditionScene(d);
  if(!sc || !sc.logs || !sc.logs.length) return '';
  if(expeditionProgress(slot, now) >= EXPEDITION_HOMEWARD_AT) return EXPEDITION_HOMEWARD_LOG;
  const elapsed = Math.max(0, (now||Date.now()) - slot.startAt);
  const i = Math.floor(elapsed/1000/EXPEDITION_LOG_INTERVAL_SEC) % sc.logs.length;
  return sc.logs[i];
}
/* 背中の袋の中身。**expeditionRewardPreview と同じ値から作る**ので、
   ここに出た物は必ずそのまま持ち帰る(ランダムの実だけ ❓、当たり枠はここに出さない)。
   1つずつのアイコンに開いて返し、進み具合に応じて手前から灯していく。 */
const EXPEDITION_PACK_MAX = 6;   // 枠が小さいのでこれ以上は出さない(あふれたぶんは「+n」)
function expeditionPackIcons(dest, mm){
  const v = expeditionRewardPreview(dest, mm || { level:1, stats:{} });
  const out = [];
  for(const it of v.items){ for(let i=0;i<it.n;i++) out.push({ html:playerItemIconHtml(it.key), unknown:false }); }
  for(let i=0;i<(v.randomSeeds||0);i++) out.push({ html:'❓', unknown:true });
  if(v.dia) out.push({ html:'💎', unknown:false });
  return out;
}
// 今どのマスモンが出撃中か。**拘束の判定はここ1か所**
function expeditionBusyKeys(){
  const set = new Set();
  for(const s of loadExpeditions().slots){ if(s && s.dest && s.mmKey) set.add(s.mmKey); }
  return set;
}
function expeditionIsBusy(mmKey){ return !!mmKey && expeditionBusyKeys().has(mmKey); }
// 受け取り待ちが1つでもあるか(通知ドット用)
function expeditionHasReady(){
  const now = Date.now();
  return loadExpeditions().slots.some(s=>expeditionSlotState(s, now)==='ready');
}
// 残り時間の表示("1:59:03" / "12:00:00")
function expeditionTimeLabel(sec){
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), ss = s%60;
  return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

/* =====================================================================
   シーズンは「版」で持つ(レイドの RAID_EDITIONS/RAID_EDITION と同じ形)。
   開催期間・ミューテーター・報酬表は互いに噛み合っているので、次のシーズンは
   別々の場所を直すのではなく新しい版を1つ足すだけにする。
   読む側(ミューテーター判定・カレンダー表示・シーズンパス画面)は今まで通り
   SEASON1_MUTATORS/SEASON1_START_DATE/SEASON_ID/SEASON_REWARDS を読むだけでよい
   (このすぐ下で選ばれている版から作る、参照の張り方を変えただけ)。

   ★シーズン切り替えパッチの手順(まとめて1回でやること。この順で進める)★
   1. 次の版を下の SEASON_EDITIONS へ追記する: id / startDate(ミューテーター発動日) /
      mutators(曜日ごとの変則ルール) / rewards(25段のシーズンパス報酬) /
      prevFinalSkin(★前の版の rewards 最終段が指していたスキンid。ここに書いておけば
      切替時に「どのスキンをガチャへ解放するか」を探さずに済む)
   2. 前の版の prevFinalSkin が指す SSR_SKINS のエントリから seasonExclusive:true を外し、
      ガチャ・SSRカタログへ解放する(2026-08-12、ラガモッチーで実施した対応と同じ)。
      次回(s2→s3)はs2の最終報酬「怨霊ガノン鳥」(ganon_ssr)が対象になる
   3. LOBBY_BANNERS を見直す(解放したスキンを「新登場・ガチャ」枠へ足すか検討)
   4. SEASON_EDITION は editionByDate() で日付から自動選択される(startDate<=today の
      最新の版が選ばれる)。手で固定したいときだけ呼び出し側を id の文字列に書き換える。
      SEASON_ID が変われば seasonStateKey() が自動で変わり、SP・受取状況は全員リセットされる
      (段位のRPも同じ鍵を使っているので一緒にリセットされる。SEASON_RESET_EPOCH は変更不要)
   5. UPDATE_HISTORY に告知を1行、sw.js の CACHE_NAME を上げる
===================================================================== */
/* 曜日ごとのミューテーター設定(表示は月始まり。dayはDate.getDay()準拠 0=日〜6=土)。
   **配列を版ごとに複製しない**: シーズン2もs1と同じ曜日周期なので、両方の版がこの1つを参照する。 */
const WEEKDAY_MUTATORS = [
  { day:1, label:'月曜日', tier:true,  reward:false, spawn:false },
  { day:2, label:'火曜日', tier:false, reward:true,  spawn:false },
  { day:3, label:'水曜日', tier:false, reward:false, spawn:true  },
  { day:4, label:'木曜日', tier:true,  reward:false, spawn:false },
  { day:5, label:'金曜日', tier:false, reward:true,  spawn:false },
  { day:6, label:'土曜日', tier:true,  reward:true,  spawn:true  },
  { day:0, label:'日曜日', tier:true,  reward:true,  spawn:true  },
];
/* シーズンパス1〜24段の報酬(1段階目=index0)。5の倍数はダイヤの節目報酬。
   ゴールドは100から始めて100単位で上がっていき、最後のゴールド報酬(24段階目)が1000になる。
   **25段目(最終報酬)は版ごとに違うので、この配列には含めない**(各版が
   [...SEASON_REWARDS_BASE24, 最終段] の形で組み立てる。配列を版ごとに複製しない)。 */
const SEASON_REWARDS_BASE24 = [
  { gold:100 }, { gold:200 }, { item:'freeTrainTicket', n:1 }, { gold:300 }, { dia:15 },      // 1-5
  { gold:300 }, { gold:400 }, { item:'seed_power', n:1 }, { gold:400 }, { dia:25 },           // 6-10
  { gold:500 }, { item:'moveTicket', n:1 }, { gold:500 }, { gold:600 }, { dia:30 },           // 11-15
  { gold:600 }, { item:'freeTrainTicket', n:1 }, { gold:700 }, { gold:700 }, { dia:40 },      // 16-20
  { gold:800 }, { item:'seed_vitality', n:1 }, { gold:900 }, { gold:1000 },                   // 21-24
];
const SEASON_EDITIONS = {
  s1: {
    id:'s1',
    label:'シーズン1',      // プレイヤーに見える表示名。ここが正。2か所目に書かない
    startDate:'2026-08-07', // ミューテーター適用開始日(この日の前はSEASON1_ACTIVE=trueでも発動しない)
    endDate:'2026-09-03',   // 表示にだけ使う(2026-09-04にs2追記に合わせて追加)
    mutators: WEEKDAY_MUTATORS,
    rewards: [...SEASON_REWARDS_BASE24, { skin:'aqua_ssr' }], // 25(最終=限定SSRスキン「大喰いの利世」)
    // 前シーズン(このシーズンより前)の最終報酬。すでにガチャへ解放済み(2026-08-12)
    prevFinalSkin:'mocchi_ssr',
  },
  s2: {
    id:'s2',
    label:'シーズン2',      // プレイヤーに見える表示名。ここが正。2か所目に書かない
    startDate:'2026-09-04',
    endDate:'2026-10-01',   // 表示にだけ使う
    mutators: WEEKDAY_MUTATORS,   // s1と同じ曜日周期(配列は複製しない)
    // 25段目(最終報酬)=シーズン2限定SSRスキン「怨霊ガノン鳥」(2026-09-04に決定。
    // それまでは { tbd:true } で「？」表示にしていた)。次の版へ移るときは
    // s3 の prevFinalSkin にこのidを書き、seasonExclusive を外して解放する。
    rewards: [...SEASON_REWARDS_BASE24, { skin:'ganon_ssr' }],
    // 前シーズン(s1)の最終報酬。2026-09-04にseasonExclusiveを外してガチャ・SSRカタログへ解放済み
    prevFinalSkin:'aqua_ssr',
  },
};
// 版は日付で自動選択(開催前後で自動的に切り替わる)。手で固定したいときはここへ id の文字列を書く
const SEASON_EDITION = editionByDate(SEASON_EDITIONS, 's1');

// 版は読み込み時の日付で凍結される。開きっぱなしの端末が日付を跨いだかを見る(下のリロード判定で使う)
function editionsChangedSinceLoad(){
  return editionByDate(SEASON_EDITIONS, 's1') !== SEASON_EDITION
      || editionByDate(RAID_EDITIONS, 'r1') !== RAID_EDITION;
}

/* =====================================================================
   シーズン1 準備(非公開・管理者プレビューのみ): ミューテーター(日替わり変則ルール)
   SEASON1_ACTIVE を true にするまでゲームプレイに一切影響しない。
   公開時は true へ変更し、CLAUDE.mdのルールに従って UPDATE_HISTORY に告知を追記すること。
===================================================================== */
const SEASON1_ACTIVE = true;  // シーズン1公開済み(ミューテーターの発動は SEASON1_START_DATE から)
const SEASON1_START_DATE = SEASON_EDITIONS[SEASON_EDITION].startDate;
const SEASON1_MUTATORS = SEASON_EDITIONS[SEASON_EDITION].mutators;
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
const SEASON_ID = SEASON_EDITIONS[SEASON_EDITION].id;   // シーズン識別子
const SEASON_LABEL = SEASON_EDITIONS[SEASON_EDITION].label; // プレイヤーに見える表示名(「シーズン1」等)。画面側はここだけを読む
/* SPと受取状況をリセットしたいときに1つ上げる(シーズンの途中でも効く)。
   シーズンの切り替わり(SEASON_IDの変更)でも同じようにリセットされる。
   判定は保存側の seasonId と seasonStateKey() の食い違いを見るだけなので、
   どちらを変えても次にloadSeasonを通った時点でSP0・受取状況なしから始まる。 */
const SEASON_RESET_EPOCH = 2;         // 2026-08-07 シーズン1公開に合わせて全員リセット
function seasonStateKey(){ return SEASON_ID + '#' + SEASON_RESET_EPOCH; }
const SEASON_SP_PER_TIER = 120;       // 1段階に必要なSP
const SEASON_MAX_TIER = 25;
// 各段階の報酬(1段階目=index0)。中身は選ばれている版(SEASON_EDITIONS[SEASON_EDITION])が正
const SEASON_REWARDS = SEASON_EDITIONS[SEASON_EDITION].rewards;
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

/* =====================================================================
   段位(ランクポイント)

   ・**シーズンと同じ鍵(seasonStateKey)で自動リセット**する。新しい期間の概念を作らない。
   ・**降格はその段位の下限で止まる。** 一度上がった段位からは落ちない(長く遊ぶ動機を折らない)。
   ・順位は「上位何%か」で引く。**30人固定の表にしない**(人数の少ないマルチでも成立させるため)。
   ・**ソロも含めて全モードで動く**(発注者決定)。ソロはbotが相手なので倍率を下げる。
===================================================================== */
const RANK_STORAGE_KEY = 'aramon_rank_v1';
// 下から順に。判定は rankOf(rp) 1か所
const RANKS = [
  { id:'novice', name:'見習い', icon:'🌱', color:'#9fb4c8', rp:0 },
  { id:'stone',  name:'石',     icon:'🪨', color:'#b0a89a', rp:100 },
  { id:'bronze', name:'銅',     icon:'🥉', color:'#c98a4b', rp:300 },
  { id:'silver', name:'銀',     icon:'🥈', color:'#cfd6e0', rp:600 },
  { id:'gold',   name:'金',     icon:'🥇', color:'#f4c430', rp:1000 },
  // 💎はダイヤ(通貨)と紛らわしいので使わない。ヘッダーで所持金の隣に並ぶため
  { id:'plat',   name:'白金',   icon:'🏵️', color:'#7fe3d4', rp:1500 },
  { id:'dia',    name:'ダイヤ', icon:'🔷', color:'#9fd1ff', rp:2100 },
  { id:'king',   name:'覇王',   icon:'👑', color:'#ff9a5a', rp:3000 },
];
/* 順位のぶん。上から順に「上位◯以内なら」で判定する(ratio=順位÷参加数)。
   1位だけは人数に関係なく別枠。 */
const RANK_RP_PLACE = [
  { top:0.10, rp: 35 },   // 上位1割
  { top:0.34, rp: 20 },   // 上位1/3(30人なら10位まで。0.33だと10/30が入らない)
  { top:0.67, rp:  5 },   // 上位2/3(30人なら20位まで)
  { top:1.00, rp:-15 },   // 下位1/3だけが減る
];
const RANK_RP_WIN = 50;          // 1位
const RANK_RP_PER_KILL = 3;
const RANK_RP_KILL_MAX = 30;
// モードごとの倍率。レイドは順位が無いので RANK_RP_RAID を使う
const RANK_RP_MULT = { solo:0.5, multi:1.0 };
const RANK_RP_RAID = { clear:30, best:15, other:0 };

function rankOf(rp){
  const v = Math.max(0, Math.round(rp||0));
  let cur = RANKS[0];
  for(const r of RANKS){ if(v >= r.rp) cur = r; }
  return cur;
}
// 次の段位と、そこまでの進み具合(0〜1)。最上位なら next=null
function rankProgress(rp){
  const v = Math.max(0, Math.round(rp||0));
  const cur = rankOf(v);
  const next = RANKS[RANKS.indexOf(cur) + 1] || null;
  const pct = next ? Math.max(0, Math.min(1, (v - cur.rp) / (next.rp - cur.rp))) : 1;
  return { cur, next, pct };
}
/* 1試合ぶんの増減。**計算はここ1か所。**
   placement=順位(1始まり) / total=参加数 / kills=撃破数 / mode='solo'|'multi'|'raid' */
function rankRpForMatch(o){
  o = o || {};
  if(o.mode === 'raid'){
    if(o.raidClear) return RANK_RP_RAID.clear;
    if(o.raidBest)  return RANK_RP_RAID.best;
    return RANK_RP_RAID.other;
  }
  const total = Math.max(1, Math.round(o.total || 0));
  const place = Math.max(1, Math.min(total, Math.round(o.placement || total)));
  let base;
  if(place === 1) base = RANK_RP_WIN;
  else {
    const ratio = place / total;
    base = (RANK_RP_PLACE.find(p=>ratio <= p.top) || RANK_RP_PLACE[RANK_RP_PLACE.length-1]).rp;
  }
  const killRp = Math.min(RANK_RP_KILL_MAX, Math.max(0, Math.round(o.kills||0)) * RANK_RP_PER_KILL);
  const mult = RANK_RP_MULT[o.mode] != null ? RANK_RP_MULT[o.mode] : RANK_RP_MULT.multi;
  // 難易度「ハード」は増減とも倍率を掛ける(ハイリスク・ハイリターン。matchRankRpMult()が正)
  const hardMult = (typeof matchRankRpMult==='function') ? matchRankRpMult() : 1;
  return Math.round((base + killRp) * mult * hardMult);
}
function loadRank(){
  const key = seasonStateKey();
  const fresh = ()=>({ seasonId:key, rp:0, best:RANKS[0].id, elem:{} });
  try{
    const r = JSON.parse(localStorage.getItem(RANK_STORAGE_KEY)) || {};
    // 到達した最高段位だけはシーズンをまたいで残す(努力が消えた感じにしない)
    if(r.seasonId !== key) return { seasonId:key, rp:0, best:r.best || RANKS[0].id, elem:{} };
    return { seasonId:key, rp:Math.max(0, Math.round(r.rp||0)), best:r.best || RANKS[0].id,
             elem: (r.elem && typeof r.elem==='object') ? r.elem : {} };
  }catch(err){ return fresh(); }
}
function saveRank(r){
  try{ localStorage.setItem(RANK_STORAGE_KEY, JSON.stringify(r)); }catch(err){}
  if(typeof accountMarkDirty==='function') accountMarkDirty();
}
/* RPを足して保存する。**下がるのは今の段位の下限まで**(段位そのものは落ちない)。
   戻り値は表示用の { delta, rp, before, after, promoted } 。
   element を渡すと、そのモンスターで稼いだぶんを r.elem に足す。
   **足すのは「実際に動いた量」**(下限で止まったぶんは含めない)。
   こうしておくと `Σ r.elem = r.rp` が常に成り立ち、ランキングの内訳と総量がズレない。 */
function addRankRp(delta, element){
  const r = loadRank();
  const prev = r.rp;
  const before = rankOf(prev);
  r.rp = Math.max(before.rp, prev + Math.round(delta||0));   // 今の段位の下限で止める
  const after = rankOf(r.rp);
  // 到達した最高段位の更新(シーズンをまたいで残る)
  const bestIdx = RANKS.findIndex(x=>x.id===r.best);
  if(RANKS.indexOf(after) > (bestIdx < 0 ? 0 : bestIdx)) r.best = after.id;
  const gained = r.rp - prev;
  if(element){
    if(!r.elem || typeof r.elem!=='object') r.elem = {};
    r.elem[element] = Math.round((r.elem[element]||0) + gained);
  }
  saveRank(r);
  return { delta: gained, rp: r.rp, before, after, promoted: after !== before };
}
// そのモンスターで稼いだRPの合計(ランキングへ送る値)
function rankElemRp(element){
  const e = loadRank().elem || {};
  return Math.round(e[element] || 0);
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
/* 【2026-08-15】ガチャ被りのダイヤ還元をやめたぶんの埋め合わせで引き上げた(5→8 / 10→15)。
   還元は10連あたり22.9💎(コストの46%)戻っていて、よく遊ぶ人で1日約71💎ぶんあった。
   ログボ・デイリー・遠征・レイドの引き上げが+21💎/日なので、残りをここで埋めている。
   **試合はダイヤの最大の蛇口**(1日約70💎)なので、ここを動かすのが一番効く。
   **数値は発注者が実機で調整する。** */
const DIA_MATCH_BASE = 8;        // 参加報酬
const DIA_CHAMPION_BONUS = 15;   // チャンピオンボーナス

/* 試合報酬の内訳。**額の式はここ1か所だけに置く。**
   通常の試合とレイドでそれぞれ別に書いていたせいで、内訳が画面に残らず、
   片方だけ直す事故も起きうる形だった。リザルトは rows をそのまま並べ、
   財布へ入れるのは gold / dia をそのまま渡す(表示と加算を2か所に書かない)。

   rows の作り:
   - 素点の行 = { label, gold, dia }。**倍率を掛ける前の額**を持つ。
   - 倍率の行 = { label, mult, on }。on は倍率が効く側('gold' / 'dia' / 'both')。
     ゴールドだけ2倍・ダイヤは等倍、といった差が実際にあるので効く側を持たせる。
   合計は「素点の合計に、rows の順で倍率を掛けて最後に丸める」。
   掛ける順番は元の式と同じにしてあるので、額は1の位まで変わらない。 */
function matchRewardBreakdown(o){
  o = o || {};
  const kind    = o.kind === 'raid' ? 'raid' : 'br';
  const kills   = Math.max(0, Math.round(o.kills || 0));
  const damage  = Math.max(0, o.damage || 0);
  const isWin   = !!o.isWin;
  const mutMult = (typeof o.mutMult === 'number' && isFinite(o.mutMult)) ? o.mutMult : 1;
  // レイドのデモなど「記録が残らない試合」は報酬なし。内訳も出さない
  if(o.noRecord) return { rows: [], gold: 0, dia: 0 };

  const rows = [];
  rows.push({ label:'参加', gold: GOLD_MATCH_BASE, dia: DIA_MATCH_BASE });

  if(kind === 'raid'){
    const goldFromDmg = Math.min(RAID_RUN_GOLD_MAX, Math.round(damage * RAID_RUN_GOLD_PER_DMG));
    const diaFromDmg  = Math.min(RAID_RUN_DIA_MAX,  Math.round(damage * RAID_RUN_DIA_PER_DMG));
    if(goldFromDmg || diaFromDmg) rows.push({ label:'与えたダメージ', gold: goldFromDmg, dia: diaFromDmg });
    if(o.defeated) rows.push({ label:'討伐成功', gold: GOLD_CHAMPION_BONUS, dia: DIA_CHAMPION_BONUS });
    if(o.isMulti) rows.push({ label:'みんなで挑戦', mult: GOLD_MULTI_MULT, on:'gold' });
    if(mutMult !== 1) rows.push({ label:'報酬アップ中', mult: mutMult, on:'both' });
  } else {
    if(kills > 0) rows.push({ label:`撃破 ×${kills}`, gold: kills * GOLD_PER_KILL });
    if(isWin) rows.push({ label:'チャンピオン', gold: GOLD_CHAMPION_BONUS, dia: DIA_CHAMPION_BONUS });
    if(o.isMulti) rows.push({ label:'みんなで対戦', mult: GOLD_MULTI_MULT, on:'gold' });
    if(o.realMap) rows.push({ label:'リアルマップ', mult: REAL_MAP_REWARD_MULT, on:'both' });
    if(mutMult !== 1) rows.push({ label:'報酬アップ中', mult: mutMult, on:'both' });
    if(o.arena) rows.push({ label:'アリーナ', mult: GOLD_ARENA_MULT, on:'gold' });
  }

  let gold = 0, dia = 0;
  for(const r of rows){ if(r.mult === undefined){ gold += (r.gold||0); dia += (r.dia||0); } }
  // 倍率は rows に並んだ順で掛ける(元の式と同じ順番。順番を変えると端数がずれる)
  for(const r of rows){
    if(r.mult === undefined) continue;
    if(r.on !== 'dia')  gold *= r.mult;
    if(r.on !== 'gold') dia  *= r.mult;
  }
  return { rows, gold: Math.round(gold), dia: Math.round(dia) };
}

/* =====================================================================
   リザルト画面のアイコン(SVG)。**使うのはリザルトの中だけ。**

   なぜ絵文字をやめたか: 端末が描く既製の絵文字は線の太さ・彩度・光沢がどれもばらばらで、
   「暗い面 + 金1色」のこの画面に7種類が同時に並ぶと、そこだけ別の絵を貼ったように浮く
   (批評の指摘)。ヘッダー・ショップ・バッグ・ミッション・ガチャ・遠征・ロビーは
   **絵文字のまま据え置き**(発注者決定。不統一は承知のうえ)。ここを他画面へ広げない。

   作りの決まり(レイド限定アイテムのアイコンと同じ流儀):
   ・**単色。fill は currentColor** ―― 色は使う側が決める。台帳(白)・合計(金)・
     値なし(灰)が同じ絵で通り、**style.css を1行も足さずに済む**。
   ・**id / defs / gradient を一切使わない。** 台帳では同じ絵が何行にも出るので、
     idを持つと画面内で衝突して塗りが化ける。
   ・viewBox は `0 0 24 24` に統一。**角はすべて45°で落とす**(画面の斜め切りと同じ言語)。
     面の太さも24基準で約3.2〜3.4にそろえてあるので、並べても線幅が揃って見える。
     ゴールドだけ円なのは「硬貨は丸い」という一点だけの例外で、中心の菱形で45°に乗せる。
   ・**寸法と間隔はここに書かない。** 大きさ(1em)・座り・アイコンと数字の間は
     style.css の `#resultScreen .rs-ico` 1か所が持つ。以前ここにインラインstyleで
     同じ値を持っていたが、インラインはCSSより強いので「小さい所だけ一回り大きく」の
     指定が効かなかった(同じ意味の数字を2か所に持たない ―― 正はCSS側)。
===================================================================== */
const RS_ICON_ATTRS = 'class="rs-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"';
const RS_ICONS = {
  // ゴールド: 縁のある硬貨(輪 + 中心の菱形)
  coin: `<svg ${RS_ICON_ATTRS}><path fill-rule="evenodd" d="M12 2.2a9.8 9.8 0 1 0 0 19.6 9.8 9.8 0 0 0 0-19.6zm0 3.4a6.4 6.4 0 1 1 0 12.8 6.4 6.4 0 0 1 0-12.8z"/><path d="M12 8.6l3.4 3.4-3.4 3.4L8.6 12z"/></svg>`,
  /* ダイヤ: 面ごとに分けた宝石。**1本の輪郭では光沢が出ない**(塗りが1色なので
     ただの多角形にしか見えない)。天面・左右の冠・下の錐・きらめきの5枚に分け、
     style.css が面ごとに濃さを変えて艶を作る。
     **gradient も id も使わない** ―― 同じ絵が台帳に何行も並ぶので衝突する。
     **並び順がそのまま濃さの割り当て**なので、入れ替えるときは
     style.css の nth-child も一緒に直すこと。 */
  dia: `<svg ${RS_ICON_ATTRS}><path d="M8.4 3h7.2l1.9 5.4H6.5z"/><path d="M8.4 3L6.1 8.4H2.9z"/><path d="M15.6 3l2.3 5.4h3.2z"/><path d="M2.9 9.4h18.2L12 21z"/><path d="M9.2 4.2h1.4L9.4 8.1H8.1z"/></svg>`,
  /* 自己ベスト: トロフィー(浅い鉢・短い脚・広い台)。
     **鉢を深く絞って台を細くすると砂時計に見える**(最初の形で実際にそうなった)。
     鉢の底を広く、台の上辺を脚の近くまで広げて、上下の塊を「杯と台」に読ませる。 */
  best: `<svg ${RS_ICON_ATTRS}><path d="M5 2.6h14v3.4l-2.6 2.6H7.6L5 6z"/><path d="M10.6 8.6h2.8v5.6h-2.8z"/><path d="M8.2 14.2h7.6v1.8H8.2z"/><path d="M5.2 16h13.6l1.6 1.6v2.8H3.6v-2.8z"/></svg>`,
  // 称号: 帯から下がった八角の勲章(中心を菱形で抜く)
  title: `<svg ${RS_ICON_ATTRS}><path d="M6.5 2h11v2l-3.2 3.2H9.7L6.5 4z"/><path fill-rule="evenodd" d="M9.2 6.2h5.6l4.8 4.8v5.6l-4.8 4.8H9.2l-4.8-4.8V11z M12 10.8l3 3-3 3-3-3z"/></svg>`,
  // シーズン: 角を落とした通行証(しおり形)
  season: `<svg ${RS_ICON_ATTRS}><path fill-rule="evenodd" d="M4.5 2.5h11l4 4v15L12 17.1 4.5 21.5z M7.7 6.2h8.6v2.6H7.7z"/></svg>`,
  /* トレーニングチケット: 両端を浅く切り欠いた券 + 中央の穴。
     切り欠きを深くすると蝶ネクタイに見えるので、深さは高さの1/6までにする。 */
  ticket: `<svg ${RS_ICON_ATTRS}><path fill-rule="evenodd" d="M1.6 5.4h20.8v4l-2 2 2 2v4H1.6v-4l2-2-2-2z M12 9.4l2 2-2 2-2-2z"/></svg>`,
  /* 段位: 山形2段の記章。**段位ごとの絵は作らない** ―― RANKS の絵文字(🌱🪨🥉…)は
     ロビーやランキングでも使う共通の表で、リザルトのためにあの表を書き換えない。
     段位の別は隣に出る名前(見習い/石/銅…)が持っているので、印は1種類でよい。 */
  rank: `<svg ${RS_ICON_ATTRS}><path d="M12 2l7 7-2.4 2.4L12 6.8 7.4 11.4 5 9z"/><path d="M12 11.6l7 7-2.4 2.4L12 16.4l-4.6 4.6L5 18.6z"/></svg>`,
  /* ここから下の3つは死因の1行(「〇〇 に倒された」/安置外/溶岩)専用。
     絵文字(⚔ ☠ 🌋)のままだと、金1色の暗い面にひとつだけ既製の絵が残る。
     ・sword … 刃・鍔・柄・柄頭の4枚。先端と鍔の端を45°で落とす(柄頭は硬貨と同じ菱形)
     ・zone  … 安全圏は八角の輪(45°だけでできた形)。**輪の外に菱形を1つ置いて
               「外にいた」ことを絵にする。** 輪だけだと硬貨と見分けが付かない
     ・lava  … 45°の斜面の山 + 上に噴き上がる菱形。溶岩だと一目で分かる形にする */
  sword: `<svg ${RS_ICON_ATTRS}><path d="M12 0.8l2.6 2.6V14H9.4V3.4z"/><path d="M3.4 14h17.2l-3 3H6.4z"/><path d="M9.6 17h4.8v2.6H9.6z"/><path d="M12 18.8l2.6 2.6-2.6 2.6-2.6-2.6z"/></svg>`,
  zone: `<svg ${RS_ICON_ATTRS}><path fill-rule="evenodd" d="M7 2h7l5 5v7l-5 5H7l-5-5V7z M8.1 5.2h4.8l2.9 2.9v4.8l-2.9 2.9H8.1l-2.9-2.9V8.1z"/><path d="M19.8 17l2.8 2.8-2.8 2.8-2.8-2.8z"/></svg>`,
  lava: `<svg ${RS_ICON_ATTRS}><path d="M9.6 8.4h4.8l9.2 9.2H0.4z"/><path d="M12 1.2l3 3-3 3-3-3z"/></svg>`,
};
// アイコンはHTMLとして埋める(textContent に入れると生タグが出る)
/* 絵ごとの印(`rs-ico-coin` など)を足して返す。
   **通貨だけは色を決め打ちする**(発注者指定: コインは銀・ダイヤは光沢のある水色)。
   ほかの絵は今までどおり使う側の文字色に乗る(勝ちは金・負けは銀)。
   ここで印を付けるので、絵の定義そのものは1つのまま。色は style.css が持つ。 */
function rsIconHtml(key){
  const svg = RS_ICONS[key];
  if(!svg) return '';
  return svg.replace('class="rs-ico"', 'class="rs-ico rs-ico-' + key + '"');
}

/* リザルトに出る数字は**すべてこの関数を通す**(1か所だけ)。
   4桁以上を3桁区切りにする ―― 同じ画面の中に `18420`(区切りなし)と `7,698`(区切りあり)が
   同時に出ていて、桁の読み方が場所によって変わっていた(批評の指摘)。
   カウントアップの途中も同じ書式にするため、演出側の書式関数もここを呼ぶ。
   **toLocaleString は使わない** ―― 区切り文字が端末の言語で変わる(空白やピリオドになる国がある)。 */
function rsNum(v){
  const n = Math.round(Number(v) || 0);
  const s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-' : '') + s;
}
/* 値が取れない欄の書き方。**欄そのものは消さずにこれを置く**(報酬の台帳と同じ流儀)。
   カウントアップ(ui.js の rsCountStats)はこの文字を見て「回さない」と決めるので、
   別の文字(「-」「なし」)を混ぜると 0 から数え上がって嘘の数字が出る。 */
const RS_STAT_NA = '--';

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
  /* 遠征の時短。**バッグからも遠征画面の枠からも使える**(2026-08-17)。
     バッグでは「遠征に出ている子だけが選べる」状態で一覧に並び、選んで使うとその枠が
     受け取り待ちになる。枠を終わらせる処理は遠征画面と同じ expeditionUseRecall。 */
  expeditionRecall:{ name:'帰還のホラ貝', icon:'📯', expedition:'finish' },
  /* モン晶の交換所で手に入る技強化。**バッグでは使えず、マスモン詳細から使う**
     (対象がマスモンだけでなく「今着ているスキンのtier3技」なので、
     バッグの「アイテム→対象マスモン」の2段UIでは選びきれない。帰還のホラ貝と同じ判断)。 */
  hidenScroll:{ name:'秘伝の書', icon:'📖', hiden:true,
                desc:'今着ているスキンのtier3技に強化を1つ付ける(マスモン詳細から使用)' },
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
  if(it.expedition==='finish') return '遠征に出ている子を選んで使うと、残り時間が0になってすぐ帰ってきます（受け取りは🧭遠征の画面から）';
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
  SSR: { label:'SSR', jp:'スペシャルスーパーレア', color:'rainbow', rate:2 }, // 内訳: ピックアップ合計1% + 他SSR合算1%(pickGachaSsrSkinId)
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
  hum:     { colors:['black','white','red','blue','green'], source:{type:'chroma', hue:15, window:60} }, /*@hum*/
  ogre:    { colors:['black','white','red','blue','green'], source:{type:'chroma', hue:30, window:60} }, /*@ogre*/
  centaur: { colors:['black','white','red','blue','yellow'], source:{type:'chroma', hue:190, window:60} }, /*@centaur*/
  narga:   { colors:['white','red','blue','yellow','green'], source:{type:'chroma', hue:275, window:60} }, /*@narga*/
  joker:   { colors:['white','red','blue','yellow','green'], source:{type:'chroma', hue:265, window:60} }, /*@joker*/
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
  // ラガモッチー: 前シーズンの最終報酬だったオリジナルSSR。シーズン切り替え時の運用(下のSEASON_EDITIONS参照)
  // に沿ってseasonExclusiveを外し、ガチャ・SSRカタログへ解放済み(2026-08-12)
  mocchi_ssr:  { element:'mocchi', name:'ラガモッチー', iconImg:'mocchi_ssr', playerImg:'mocchi_player_ssr' },
  // ゼウス: ガリのオリジナルSSR。ガチャ・SSRカタログにも出る(seasonExclusiveは付けない)
  zeus_ssr:    { element:'god', name:'ゼウス', iconImg:'zeus_ssr', playerImg:'zeus_player_ssr' },
  // ちょこ: ピクシーのオリジナルSSR。ガチャ・SSRカタログにも出る
  choco_ssr:   { element:'pixie', name:'ちょこ', iconImg:'choco_ssr', playerImg:'choco_player_ssr' },
  // ペルセポネ: イルミネのオリジナルSSR。ガチャ・SSRカタログにも出る
  persephone_ssr: { element:'illumine', name:'ペルセポネ', iconImg:'persephone_ssr', playerImg:'persephone_player_ssr' },
  rock_ssr:       { element:'rock', name:'轟金剛', iconImg:'rock_ssr', playerImg:'rock_player_ssr' }, /*@rock_ssr*/
  // 大喰いの利世: シーズン1の最終報酬だったオリジナルSSR。シーズン2切り替え(2026-09-04)の
  // 運用に沿ってseasonExclusiveを外し、ガチャ・SSRカタログへ解放済み(上のSEASON_EDITIONS参照)
  aqua_ssr:       { element:'aqua', name:'大喰いの利世', iconImg:'aqua_ssr', playerImg:'aqua_player_ssr' }, /*@aqua_ssr*/
  // 狂戦士ガッツ: 第1回レイド限定だったが、第3回(r3)への切り替えでRAID_EDITIONS.r1.exclusiveSkins
  // から外れ、通常のガチャ・SSRカタログへ自動で解放された(2026-09-03)
  guts_ssr:       { element:'dullahan', name:'狂戦士ガッツ', iconImg:'guts_ssr', playerImg:'guts_player_ssr' }, /*@guts_ssr*/
  // 不死のゾッド: レイド討伐達成の報酬限定。どのガチャ・どのカタログにも出さない
  zod_ssr:        { element:'fire', name:'不死のゾッド', iconImg:'zod_ssr', playerImg:'zod_player_ssr', raidClearOnly:true }, /*@zod_ssr*/
  garurumon_ssr:  { element:'spark', name:'ガルルモン', iconImg:'garurumon_ssr', playerImg:'garurumon_player_ssr' }, /*@garurumon_ssr*/
  metag_ssr:      { element:'fire', name:'メタルグレイモン', iconImg:'metag_ssr', playerImg:'metag_player_ssr' }, /*@metag_ssr*/
  guts_ssr_awake: { element:'dullahan', name:'狂戦士ガッツ【覚醒】', iconImg:'guts_ssr_awake', playerImg:'guts_player_ssr_awake', awakenOf:'guts_ssr' }, /*@guts_ssr_awake*/
  satsuki_ssr:    { element:'ogre', name:'北大路さつキジン', iconImg:'satsuki_ssr', playerImg:'satsuki_player_ssr' }, /*@satsuki_ssr*/
  satsuki_ssr_awake:{ element:'ogre', name:'北大路さつキジン【覚醒】', iconImg:'satsuki_ssr_awake', playerImg:'satsuki_player_ssr_awake', awakenOf:'satsuki_ssr' }, /*@satsuki_ssr_awake*/
  tsukasa_ssr:    { element:'pixie', name:'西野ピかさ', iconImg:'tsukasa_ssr', playerImg:'tsukasa_player_ssr' }, /*@tsukasa_ssr*/
  oki_ssr:        { element:'centaur', name:'秦の怪鳥', iconImg:'oki_ssr', playerImg:'oki_player_ssr' }, /*@oki_ssr*/
  leaf_ssr:       { element:'leaf', name:'メカビオギドラ', iconImg:'leaf_ssr', playerImg:'leaf_player_ssr' }, /*@leaf_ssr*/
  narga_ssr:      { element:'narga', name:'ゴッドエンペラー', iconImg:'narga_ssr', playerImg:'narga_player_ssr' }, /*@narga_ssr*/
  suezo_ssr:      { element:'suezo', name:'バジリスエゾー', iconImg:'suezo_ssr', playerImg:'suezo_player_ssr' }, /*@suezo_ssr*/
  zan_ssr:        { element:'zan', name:'疾風', iconImg:'zan_ssr', playerImg:'zan_player_ssr' }, /*@zan_ssr*/
  joker_ssr:      { element:'joker', name:'あるるかん', iconImg:'joker_ssr', playerImg:'joker_player_ssr', raidClearOnly:true }, /*@joker_ssr*/
  warm_ssr:       { element:'warm', name:'電王ライナー', iconImg:'warm_ssr', playerImg:'warm_player_ssr' }, /*@warm_ssr*/ // レイドガチャ・SSRレイドカタログ限定かどうかは RAID_EDITIONS[版].exclusiveSkins で決まる(r3=最新の版に指定済み)
  ganon_ssr:      { element:'phoenix', name:'怨霊ガノン鳥', iconImg:'ganon_ssr', playerImg:'ganon_player_ssr', seasonExclusive:true }, /*@ganon_ssr*/
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
   止められることがあるため)。bgmOnReveal は獲得画面で流す自分のBGM区分の明示指定で、
   省略しても bgm.lastBattle があればui.jsのssrRevealBgmTrackが自動でそれを使う
   (書き忘れても前に流れていた別SSRのBGMへ戻ってしまう事故にならない)。   */
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
  garurumon_ssr: { /*@garurumon_ssr*/
    promote: { video:'video/garurumon_ssr_promote', audio:'audio/garurumon_ssr_promote_audio.m4a', safetyMs:34558, bgmOnReveal:'lastBattle' },
    bgm: { battle:'audio/bgm_garurumon_ssr_battle.m4a', final5:'audio/bgm_garurumon_ssr_final5.m4a', lastBattle:'audio/bgm_garurumon_ssr_lastbattle.m4a' },
    se: { tier3:'audio/se_garurumon_ssr_tier3.m4a' },
  },
  // 専用BGMは残り6人以上・残り5人以下をガルルモンと同じ曲にする(音源を複製せず、同じファイルパスを直接指す)。
  // 残り2人だけ専用曲(audio/bgm_metag_ssr_lastbattle.mp3)
  metag_ssr: { /*@metag_ssr*/
    promote: { video:'video/metag_ssr_promote', audio:'audio/metag_ssr_promote_audio.m4a', safetyMs:34648 },
    bgm: { battle:'audio/bgm_garurumon_ssr_battle.m4a', final5:'audio/bgm_garurumon_ssr_final5.m4a',
           lastBattle:'audio/bgm_metag_ssr_lastbattle.mp3' },
    se: { tier3:'audio/se_metag_ssr_tier3.m4a' },
  },
  /* 【重要・ファイル名と枠が1つずれている】発注者依頼(2026-08-17)で、さつキジンの
     専用BGMを1段ずつ後ろへずらした。**音源は複製せず既にあるパスをそのまま指す**
     (ゾッド・メタルグレイモンと同じやり方)ので、ファイル名は元の役割のまま残っている。
       残り6人以上(battle)   … bgm_satsuki_ssr_final5.m4a     ← 元の「残り5人以下」
       残り5人以下(final5)   … bgm_satsuki_ssr_lastbattle.m4a ← 元の「残り2人」
       残り2人  (lastBattle) … bgm_satsuki_ssr_last2.mp3      ← 新規
     **直すときは枠(左のキー)を見る。ファイル名(右)で判断しない。**
     ファイル名を役割に合わせて改名しなかったのは、素材のキャッシュ(MEDIA_CACHE)が
     stale-while-revalidate で**URLごとに古い中身を1回返す**ため、改名すると更新直後の
     1試合だけ枠と曲が入れ替わって鳴るから。 */
  satsuki_ssr: { /*@satsuki_ssr*/
    promote: { video:'video/satsuki_ssr_promote', audio:'audio/satsuki_ssr_promote_audio.m4a', safetyMs:9475, bgmOnReveal:'lastBattle' },
    bgm: { battle:'audio/bgm_satsuki_ssr_final5.m4a',
           final5:'audio/bgm_satsuki_ssr_lastbattle.m4a',
           lastBattle:'audio/bgm_satsuki_ssr_last2.mp3' },
    se: { tier3:'audio/se_satsuki_ssr_tier3.m4a', kill:'audio/se_satsuki_ssr_kill.m4a', win:'audio/se_satsuki_ssr_win.m4a' },
  },
  /* 西野ピかさ: **残り2人だけ専用曲**で、残り6人以上・残り5人以下は北大路さつキジンと
     同じ曲を指す(上のコメントのとおり、こちらもファイル名と枠が1つずれている)。 */
  tsukasa_ssr: { /*@tsukasa_ssr*/
    promote: { video:'video/tsukasa_ssr_promote', audio:'audio/tsukasa_ssr_promote_audio.m4a', safetyMs:30413 },
    bgm: { battle:'audio/bgm_satsuki_ssr_final5.m4a',
           final5:'audio/bgm_satsuki_ssr_lastbattle.m4a',
           lastBattle:'audio/bgm_tsukasa_ssr_last2.mp3' },
    se: { tier3:'audio/se_tsukasa_ssr_tier3.m4a', kill:'audio/se_tsukasa_ssr_kill.mp3',
          win:'audio/se_tsukasa_ssr_win.mp3' },
  },
  oki_ssr: { /*@oki_ssr*/
    promote: { video:'video/oki_ssr_promote', audio:'audio/oki_ssr_promote_audio.m4a', safetyMs:33688, bgmOnReveal:'lastBattle' },
    bgm: { battle:'audio/bgm_oki_ssr_battle.m4a', final5:'audio/bgm_oki_ssr_final5.m4a', lastBattle:'audio/bgm_oki_ssr_lastbattle.m4a' },
    se: { summon:'audio/se_oki_ssr_summon.mp3', tier3:'audio/se_oki_ssr_tier3.m4a',
          hit:'audio/se_oki_ssr_hit.m4a', kill:'audio/se_oki_ssr_kill.m4a', win:'audio/se_oki_ssr_win.m4a' },
  },
  narga_ssr: { /*@narga_ssr*/
    promote: { video:'video/narga_ssr_promote', audio:'audio/narga_ssr_promote_audio.m4a', safetyMs:14605, bgmOnReveal:'lastBattle' },
    bgm: { battle:'audio/bgm_narga_ssr_battle.m4a', final5:'audio/bgm_narga_ssr_final5.m4a', lastBattle:'audio/bgm_narga_ssr_lastbattle.m4a' },
    se: { tier3:'audio/se_narga_ssr_tier3.mp3' },   // デスレーザーの専用SE
  },
  suezo_ssr: { /*@suezo_ssr*/
    promote: { video:'video/suezo_ssr_promote', audio:'audio/suezo_ssr_promote_audio.m4a', safetyMs:32787, bgmOnReveal:'lastBattle' },
    bgm: { battle:'audio/bgm_suezo_ssr_battle.m4a', final5:'audio/bgm_suezo_ssr_final5.m4a', lastBattle:'audio/bgm_suezo_ssr_lastbattle.m4a' },
    /* 【1区分に複数書くと確率で鳴らし分ける】tier3「真瞳術」は3種を 60% / 30% / 10% で鳴らす
       (発注者指定・2026-08-26)。weight の合計で割るので、比だけ合っていればよい。
       文字列1つの従来の書き方もそのまま使える。抽選は audio.js の makeSkinSeSet 1か所。
       ※ スタジオで**この子の専用メディアを更新し直すと、この行はツールの書式で上書きされる**
         (配列は書けないため tier3 が消える)。そのときはここを書き戻すこと。 */
    se: { summon:'audio/se_suezo_ssr_summon.m4a',
          /* 【1行=1つの当たり】音・エフェクトの色・追加効果を同じ行に書く。
             こうしておけば「鳴った音と起きたことが食い違う」ことが構造的に起きない。
             color はエフェクトの色だけを変える。**オーラ(相性)は赤のまま**なので有利不利は変わらない。 */
          tier3:[ { src:'audio/se_suezo_ssr_tier3_a.mp3', weight:60 },
                  { src:'audio/se_suezo_ssr_tier3_b.mp3', weight:30,
                    color:'#3d9fff', healRatio:0.5 },   // 与えたダメージの50%を回復
                  { src:'audio/se_suezo_ssr_tier3_c.mp3', weight:10,
                    color:'#a24dff', dmgMult:1.5 } ],   // 威力1.5倍
          tier3hit:'audio/se_suezo_ssr_tier3hit.mp3',   // 真瞳術を当てたとき
          kill:'audio/se_suezo_ssr_kill.mp3' },
  },
  zan_ssr: { /*@zan_ssr*/
    promote: { video:'video/zan_ssr_promote', audio:'audio/zan_ssr_promote_audio.m4a', safetyMs:21313, bgmOnReveal:'lastBattle' },
    bgm: { battle:'audio/bgm_zan_ssr_battle.m4a', final5:'audio/bgm_zan_ssr_final5.m4a', lastBattle:'audio/bgm_zan_ssr_lastbattle.m4a' },
    se: { summon:'audio/se_zan_ssr_summon.m4a', tier3:'audio/se_zan_ssr_tier3.m4a', kill:'audio/se_zan_ssr_kill.m4a', win:'audio/se_zan_ssr_win.m4a' },
  },
  warm_ssr: { /*@warm_ssr*/
    promote: { video:'video/warm_ssr_promote', audio:'audio/warm_ssr_promote_audio.m4a', safetyMs:33932, bgmOnReveal:'lastBattle' },
    bgm: { battle:'audio/bgm_warm_ssr_battle.m4a', final5:'audio/bgm_warm_ssr_final5.m4a', lastBattle:'audio/bgm_warm_ssr_lastbattle.m4a' },
    se: { tier3:'audio/se_warm_ssr_tier3.m4a', kill:'audio/se_warm_ssr_kill.m4a' },
  },
  ganon_ssr: { /*@ganon_ssr*/
    promote: { video:'video/ganon_ssr_promote', audio:'audio/ganon_ssr_promote_audio.m4a', safetyMs:56122, bgmOnReveal:'lastBattle' },
    bgm: { battle:'audio/bgm_ganon_ssr_battle.mp3', final5:'audio/bgm_ganon_ssr_final5.mp3', lastBattle:'audio/bgm_ganon_ssr_lastbattle.mp3' },
    se: { tier3:'audio/se_ganon_ssr_tier3.m4a', hit:'audio/se_ganon_ssr_hit.m4a', kill:'audio/se_ganon_ssr_kill.m4a' },
    promoImg: 'images/promo_ganon_ssr.png',
  },
  // <<AUTO:SKIN_MEDIA>> ここから上へ tools/studio_web.html がSSRスキン専用メディアの行を追記する
};
/* 【覚醒スキンは元のSSRの専用BGM・専用SEをそのまま受け継ぐ】
   覚醒後の姿(awakenOf付き)は「同じモンスターの強化形態」なので、音は元と同じであるべき。
   ここで SKIN_MEDIA へ実体を継ぎ足しておくと、audio.js が SKIN_MEDIA のキーを1周して
   作る BGMループ・SEワンショットにも、ui.js のミュージアム・管理者の音声確認にも
   自動で載る(それぞれが SKIN_MEDIA を直接見ているので、参照時の解決では足りない)。
   **これで tools/studio_web.html は覚醒スキンのメディア行を書かなくてよい**
   (SSR_SKINS へ awakenOf 付きで1行足せば音まで自動でそろう)。
   ・promote(昇格ムービー)と promoImg は継がない。覚醒スキンはガチャに出ないので
     昇格演出を持たず、ミュージアムに元と同じ動画が二重に並ぶだけになるため。
   ・覚醒スキン自身の行が既にある場合はそちらが優先(将来の専用曲への差し替え口)。 */
Object.keys(SSR_SKINS).forEach(id=>{
  const base = SSR_SKINS[id].awakenOf;
  if(!base || !SKIN_MEDIA[base]) return;
  const inherited = {};
  if(SKIN_MEDIA[base].bgm) inherited.bgm = SKIN_MEDIA[base].bgm;
  if(SKIN_MEDIA[base].se)  inherited.se  = SKIN_MEDIA[base].se;
  if(!Object.keys(inherited).length) return;
  SKIN_MEDIA[id] = Object.assign(inherited, SKIN_MEDIA[id] || {});
});
/* 専用SEの区分。並びは試合で鳴る順(ギャラリーのボタンの並びもこの順になる)。
   **ここへ1行足せば、SKIN_MEDIA.se の受け取り・SE_DEFSへの登録・combat.jsの差し替え表・
   ギャラリー・管理者画面のSE確認まで全部が回る。**(2026-08-17に summon を追加) */
/* tier3hit は「tier3を**当てた**ときに鳴る音」。hit(=自分が被弾したとき)とは別物なので混同しない。
   鳴らす名前の解決は combat.js の SKIN_TIER3_HIT_SE、鳴らすのは applyDamage の1か所。 */
const SKIN_SE_SLOTS = { summon:'召喚演出', tier3:'技(tier3)', tier3hit:'技(tier3)の命中',
                        hit:'被弾', kill:'キル', win:'勝利' };
const SKIN_BGM_SLOTS = { battle:'残り6人以上', final5:'残り5人以下', lastBattle:'残り2人' };
function skinMediaOf(skinId){ return (skinId && SKIN_MEDIA[skinId]) || null; }
/* 専用SEの「当たりの種類」の一覧。文字列1つでも配列でも同じ形にして返す。
   **重みも色も追加効果もこの1つの表が正**で、引くのはこの関数だけ。 */
function skinSeVariantList(skinId, slot){
  const media = skinMediaOf(skinId);
  const e = media && media.se && media.se[slot];
  if(!e) return [];
  return (Array.isArray(e) ? e : [e])
    .map(v=> (typeof v === 'string') ? { src:v, weight:1 } : v)
    .filter(v=> v && v.src);
}
// 重みで1つ引く(該当なしは-1)。**技を撃つときに1度だけ引き、音・色・効果すべてに同じ結果を使う。**
function pickSkinSeVariant(skinId, slot){
  const list = skinSeVariantList(skinId, slot);
  if(!list.length) return -1;
  const w = (v)=> Math.max(0, +v.weight || 0);
  const total = list.reduce((s2, v)=> s2 + w(v), 0);
  let r = Math.random() * (total > 0 ? total : list.length);
  for(let i=0;i<list.length;i++){
    r -= (total > 0 ? w(list[i]) : 1);
    if(r < 0) return i;
  }
  return list.length - 1;
}
/* 当たりの説明文。**同じ表から作る**ので、確率や効果を変えれば説明も一緒に変わる
   (技一覧に書いた数字が実際と食い違う、という事故が起きない)。 */
function skinTier3VariantText(skinId){
  const list = skinSeVariantList(skinId, 'tier3');
  if(list.length < 2) return '';
  const w = (v)=> Math.max(0, +v.weight || 0);
  const total = list.reduce((s2, v)=> s2 + w(v), 0) || list.length;
  const parts = [];
  for(const v of list){
    const eff = [];
    if(v.dmgMult && v.dmgMult !== 1) eff.push(`威力${v.dmgMult}倍`);
    if(v.healRatio) eff.push(`与えたダメージの${Math.round(v.healRatio*100)}%を回復`);
    if(!eff.length) continue;                       // 何も起きない当たりは書かない
    parts.push(`${Math.round(w(v)/total*100)}%で${eff.join('・')}`);
  }
  return parts.length ? `撃つたびに ${parts.join(' / ')}(音とエフェクトの色も変わる)` : '';
}
/* この技を撃つときの「当たり」を決める。tier3で専用SEが複数あるスキンだけが対象。
   idx を渡すとその番号をそのまま使う(マルチでゲストが引いた結果をホストが再現するため)。 */
function rollSkinTier3Variant(attacker, move, idx){
  if(!attacker || !move || move.tier!==3) return null;
  const sid = (typeof entitySkinId==='function') ? entitySkinId(attacker) : null;
  const list = skinSeVariantList(sid, 'tier3');
  if(list.length < 2) return null;                  // 1つだけなら従来どおり(引く意味が無い)
  const i = (idx!=null && idx>=0 && idx<list.length) ? idx : pickSkinSeVariant(sid, 'tier3');
  if(i < 0) return null;
  return Object.assign({ index:i }, list[i]);
}

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
/* SSRスキンの入手経路は3つの印+1つの表で決まる(何も無ければ「どこでも出る」)。
     seasonExclusive : シーズンパス報酬限定。ガチャにもカタログにも出さない
     raidClearOnly   : レイド討伐達成の報酬限定。どのガチャ・どのカタログにも出さない
     awakenOf        : 覚醒後の姿。元のスキンを装備したマスモンが覚醒したときだけ手に入るので、
                       どのガチャ・どのカタログにも出さない
     raidGachaOnly の印は廃止。レイドガチャ限定かどうかは印を個別に付けるのではなく、
     RAID_EDITIONS[版].exclusiveSkins(最新の版だけ有効。raidExclusiveSkinIds()で参照)で
     決める。版が切り替わると、古い版のexclusiveSkinsは自動的にこの除外から外れる。
   一覧を作るときは必ず下の2つの関数を通す(印を直接読む場所を増やさない)。 */
// スキンガチャ・SSRスキンカタログに出るSSR
function gachaSsrSkinIds(){
  const raidOnly = raidExclusiveSkinIds();
  return Object.keys(SSR_SKINS).filter(id=>{
    const s = SSR_SKINS[id];
    return !s.seasonExclusive && !s.raidClearOnly && !s.awakenOf && !raidOnly.includes(id);
  });
}
// レイドガチャ・レイドSSRスキンカタログに出るSSR(シーズンパス報酬と討伐報酬だけを除く)
function raidGachaSsrSkinIds(){
  return Object.keys(SSR_SKINS).filter(id=>{
    const s = SSR_SKINS[id];
    return !s.seasonExclusive && !s.raidClearOnly && !s.awakenOf;
  });
}
/* 覚醒スキンの対応表。**SSR_SKINS の awakenOf から自動で作る**ので、
   スキンを足しても書き足すところは無い(手書きの対応表を新しく作らない)。 */
const _awakenedSkinByBase = {};
Object.keys(SSR_SKINS).forEach(id=>{
  const base = SSR_SKINS[id].awakenOf;
  if(base) _awakenedSkinByBase[base] = id;
});
// 元のスキンID → 覚醒後のスキンID(用意されていなければ null)
function awakenedSkinIdOf(baseSkinId){ return _awakenedSkinByBase[baseSkinId] || null; }
// 覚醒スキンかどうか
function isAwakenedSkinId(skinId){ return !!(SSR_SKINS[skinId] && SSR_SKINS[skinId].awakenOf); }

// ガチャのレアリティ別アイテム
const GACHA_N_ITEMS = ['seed_life','seed_power','seed_wisdom','seed_accuracy','seed_evasion','seed_vitality'];
/* ガチャのR枠。**帰還のホラ貝はここに入れない。**
   1枠増やすと既存のトレチケ・技強化チケットの当たる割合が 1/2 → 1/3 に下がり、
   遠征とは関係のない既存のバランスを弱めてしまうため。入手はショップと遠征の当たり枠。 */
const GACHA_R_ITEMS = ['freeTrainTicket','moveTicket'];
/* 【被りはダイヤではなくモン晶になる(2026-08-15)】
   持っているスキンが出たときのダイヤ還元をやめ、モン晶を配るようにした。
   還元は「集めた人ほどガチャが安くなる」仕組みで、全部そろった人は10連50💎に対して
   平均23💎(46%)が戻っていた。モン晶に替えて、被りを新しい進行(交換所)につなげる。
   ※ ダイヤの総量は変えない方針なので、還元をやめたぶんはログボ・デイリー・遠征・レイドで戻す。 */
const DUP_SKIN_SHARD = 1;   // 既に持っているSRスキンが出た時に貰えるモン晶
const DUP_SSR_SHARD  = 5;   // 既に持っているSSRスキンが出た時に貰えるモン晶
const SHARD_NAME = 'モン晶';
const SHARD_ICON = '💠';

function weightedPickRarity(guaranteedSRplus){
  const entries = guaranteedSRplus ? [['SR',GUARANTEED_SLOT_RATES.SR],['SSR',GUARANTEED_SLOT_RATES.SSR]]
                                    : RARITY_ORDER.map(r=>[r, RARITIES[r].rate]);
  const total = entries.reduce((s,e)=>s+e[1],0);
  let r = Math.random()*total;
  for(const [k,w] of entries){ r-=w; if(r<0) return k; }
  return entries[0][0];
}
/* SSR内の内訳抽選(ピックアップ)。SSR全体2%のうち、**ピックアップ全体で1%**・
   他SSR合算で1%になるよう、SSR枠に入った時点で五分五分に振る。
   【複数体を並べられる】2026-08-17のダブルピックアップから配列にした。
   ピックアップ側の1%は並べた体数で等分するので、2体なら各0.5%になる。
   ここを1行変えるだけで、抽選・提供割合の表・ガチャ画面の札・記念ポップアップが
   まとめて追従する(手書きの対応表を増やさない)。

   【2026-09-07 日替わりピックアップ】下の4定数は「今のピックアップ」を直接持つのを
   やめ、GACHA_DAILY_PICKUPS(曜日ごとの表)から gachaPickupOfToday() が毎回選ぶ形に
   した。この4定数は**そのまま残してある**——tools/studio_web.html が行頭一致
   (`/^const GACHA_PICKUP_SSR_IDS = .*$/m` 等)でこの行そのものを書き換えるため、形を
   崩すとスタジオの「ピックアップに設定」が動かなくなる。
   ただし今は「日替わりを止めて固定したいときの上書き値」という役目に変わっている。
   GACHA_PICKUP_ROTATION_ENABLED が既定の true のあいだはこの4定数は読まれない。
   スタジオでピックアップを書き込んだあと、それを実際に効かせたい(=日替わりを止めて
   固定する)ときは、GACHA_PICKUP_ROTATION_ENABLED を手で false にすること
   ——スタジオの書き換え自体はこの行を触らないので、書き込むだけでは自動では効かない。
   これは書き換えを壊さない範囲での妥協で、完全な自動優先はできていない。 */
const GACHA_PICKUP_SSR_IDS = ['satsuki_ssr', 'tsukasa_ssr']; /*@pickup*/
/* PICK UPの札に出す文字。**2体以上のときは名前を並べると札(画面の46%)で切れる**
   ので、キャンペーンの短い名前を置く。null なら1体目のスキン名をそのまま出す。 */
const GACHA_PICKUP_LABEL = '荒モン100%';
/* ガチャ画面と記念ポップアップに出す告知画像。**キャンペーンの絵**を指す
   (2体ぶんなので、どちらか一方の SKIN_MEDIA.promoImg にすると片方が出ない)。
   null なら従来どおり1体目のスキンの promoImg を使う。 */
const GACHA_PICKUP_PROMO_IMG = 'images/promo_aramon100.jpg';
// 記念ポップアップで画像の下に出す宣伝文(発注者から支給・1行1要素)
const GACHA_PICKUP_PROMO_LINES = [
  '荒モン100%ダブルピックアップ！',
  'セクシーvsプリティー　あなたはどっち派？',
  '専用技&ボイス&BGM&ムービー搭載',
];
// true(既定)= 日替わり優先。false = 上の4定数(スタジオの固定書き込み)を使う
const GACHA_PICKUP_ROTATION_ENABLED = true;
/* 曜日(Date#getDay の 0=日〜6=土)ごとのピックアップ表。**曜日にした理由**:
   循環配列だと「何日目か」を出すのに導入日(エポック)をどこかに持たないといけないが、
   曜日は new Date().getDay() だけで決まり、起点日を持たずに済む。7日で一巡するので
   「今日は何の日」も定着しやすい。
   各枠の ids は必ず gachaSsrSkinIds() が返すもの(=通常のスキンガチャに出るSSR)から
   選ぶこと。シーズン限定・レイド限定・覚醒後のスキンは入れない(入れてもピックアップ
   としては機能せず、gachaRateTable 側で「その他SSR」に混ざるだけになる)。
   label/promoImg/promoLines は null で構わない(それぞれ1体目の名前・promoImg・
   宣伝文なしにフォールバックする。gachaPickupOfToday() 参照)。
   月曜(1)は導入時点で動いていたキャンペーン(荒モン100%)をそのまま据えてある。 */
const GACHA_DAILY_PICKUPS = {
  0: { ids:['rock_ssr','guts_ssr','aqua_ssr'],        label:null, promoImg:null, promoLines:null },
  1: { ids:['satsuki_ssr','tsukasa_ssr'], label:'荒モン100%', promoImg:'images/promo_aramon100.jpg',
       promoLines:['荒モン100%ダブルピックアップ！','セクシーvsプリティー　あなたはどっち派？','専用技&ボイス&BGM&ムービー搭載'] },
  2: { ids:['garurumon_ssr','metag_ssr','mocchi_ssr'], label:null, promoImg:null, promoLines:null },
  3: { ids:['phoenix_ssr','tamamo_ssr','iblees_ssr'],  label:null, promoImg:null, promoLines:null },
  4: { ids:['zeus_ssr','choco_ssr','persephone_ssr'],  label:null, promoImg:null, promoLines:null },
  5: { ids:['oki_ssr','leaf_ssr','narga_ssr'],         label:null, promoImg:null, promoLines:null },
  6: { ids:['suezo_ssr','zan_ssr'],                    label:null, promoImg:null, promoLines:null },
};
/* 今日のピックアップ({ids, label, promoImg, promoLines})を返す。呼ぶたびに端末の
   ローカル日付で判定する(editionByDate と同じ「端末のローカル日付」だが、こちらは
   開きっぱなしでも呼ぶたびに再判定する。ガチャ抽選・画面表示のたびに呼ばれる軽い処理
   なので、読み込み時に一度だけ決める必要が無い)。
   ガチャ画面・記念ポップアップ・提供割合表・抽選(isGachaPickupSsr)は必ずこの関数を
   通す(GACHA_PICKUP_SSR_IDS 等を直接読まない。手書きの対応表を増やさない)。 */
function gachaPickupOfToday(){
  if(!GACHA_PICKUP_ROTATION_ENABLED){
    return { ids:GACHA_PICKUP_SSR_IDS, label:GACHA_PICKUP_LABEL,
             promoImg:GACHA_PICKUP_PROMO_IMG, promoLines:GACHA_PICKUP_PROMO_LINES };
  }
  const day = new Date().getDay();
  return GACHA_DAILY_PICKUPS[day] || GACHA_DAILY_PICKUPS[0];
}
function isGachaPickupSsr(id){ return gachaPickupOfToday().ids.indexOf(id) >= 0; }
function pickGachaSsrSkinId(){
  const ids    = gachaSsrSkinIds();
  const pickup = ids.filter(isGachaPickupSsr);
  const others = ids.filter(id=>!isGachaPickupSsr(id));
  if(!pickup.length) return others.length ? pickRandom(others) : ids[0];
  if(!others.length) return pickRandom(pickup);   // 他SSRが無ければ常にピックアップ
  return Math.random()<0.5 ? pickRandom(pickup) : pickRandom(others);
}
function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
/* ガチャ画面の告知画像。スキンガチャ・レイドガチャそれぞれのピックアップスキンの
   SKIN_MEDIA.promoImg を使う(未登録なら轟金剛の画像のまま)。タイトルの
  「(◯◯ピックアップ)」も同じ定数から作るので、差し替えはこの2つの定数だけで済む。 */
function skinPromoImgUrl(skinId){
  const m = skinMediaOf(skinId);
  return (m && m.promoImg) || null;
}
/* スキンガチャの告知画像のURL。
   1. 今日のピックアップにキャンペーンの絵(today.promoImg)があればそれ
   2. 無ければ、今日のピックアップの中で SKIN_MEDIA[id].promoImg を持つものを探す(先頭優先)
   3. **それも無ければ、他のスキンの絵(轟金剛の既定画像など)へは絶対に逃がさない。**
      「今日のピックアップに入っていないスキンの絵が出る」のは告知として嘘になるため
      (2026-09-08に発注者指摘。以前はここで 'images/promo_rock_ssr.jpeg' へ落としていた)。
      代わりに今日のピックアップ1体目の見た目(iconImg=正面)を使う。専用の告知画像では
      ないが、少なくとも「今日のピックアップの絵」ではある。iconImgのURLの作り方は
      ssrSkinImagesの読み込みと同じ imgSrcFor() を使う(新しい対応表を作らない)。 */
function gachaPickupPromoImgUrl(){
  const today = gachaPickupOfToday();
  if(today.promoImg) return today.promoImg;
  for(const id of today.ids){
    const url = skinPromoImgUrl(id);
    if(url) return url;
  }
  const first = SSR_SKINS[today.ids[0]];
  return first ? imgSrcFor(`monsters/${first.iconImg}`) : null;
}
gachaPickupPromoImg.src = gachaPickupPromoImgUrl();
// レイドガチャの告知画像のURL(キャンペーンの絵=RAID_GACHA_PROMO_IMGが無ければ1体目のpromoImg)
function raidGachaPickupPromoImgUrl(){
  return RAID_GACHA_PROMO_IMG || skinPromoImgUrl(RAID_GACHA_PICKUP_IDS[0]) || 'images/promo_rock_ssr.jpeg';
}
const raidGachaPickupPromoImg = loadPromoImage(raidGachaPickupPromoImgUrl());
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
  // ピックアップ側で1%を等分(2体なら各0.5%)、他SSRで残り1%を等分
  const pickupIds   = ssrIds.filter(isGachaPickupSsr);
  const otherSsrIds = ssrIds.filter(id=>!isGachaPickupSsr(id));
  rows.push({ rarity:'SSR', items: ssrIds.map(id=>({
    label: skinMeta(id).name,
    pct: isGachaPickupSsr(id) ? (pickupIds.length ? RARITIES.SSR.rate/2/pickupIds.length : 0)
                              : (otherSsrIds.length ? RARITIES.SSR.rate/2/otherSsrIds.length : 0),
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
/* あるモンスターが選べる全スキン(色スキン+SSR+覚醒)のskinId一覧。
   **覚醒スキンはスキンの所持(owned)ではなく、そのマスモンが覚醒したかで決まる。**
   ここへ足しておけば、着せ替え画面の一覧・プレビュー・装備は既存のまま動く
   (覚醒の分岐を画面側へ増やさないための1か所)。 */
function ownedSkinsForElement(element){
  const owned = loadSkins().owned;
  const out = [];
  for(const c of monsterSkinColors(element)){ const id=colorSkinId(element,c); if(owned[id]) out.push(id); }
  for(const id of allSsrSkinIds()){
    const s = SSR_SKINS[id];
    if(s.element!==element || s.awakenOf) continue;   // 覚醒スキンは下でまとめて足す
    if(owned[id]) out.push(id);
  }
  // 覚醒スキンはこの要素のマスモンぶんだけ足す(集計はownedAwakenedSkinIds()に集約)
  for(const awId of ownedAwakenedSkinIds()){ if(SSR_SKINS[awId].element===element) out.push(awId); }
  return out;
}
/* 覚醒スキンだけを全マスモン横断で集める(ギャラリーの所持スキン一覧用)。
   覚醒は所持(owned)ではなくマスモン側のmm.awakenで決まるので、loadSkins().owned
   だけを見る一覧には出てこない。ここへ集約し、呼び出し側はownedのidと合わせるだけでよい。 */
function ownedAwakenedSkinIds(){
  const owned = loadSkins().owned;
  const mms = loadMastermons();
  const out = [];
  for(const element of Object.keys(mms)){
    const mm = mms[element];
    if(!mm || !mm.awaken) continue;
    for(const baseId of Object.keys(mm.awaken)){
      const awId = awakenedSkinIdOf(baseId);
      if(awId && SSR_SKINS[awId] && SSR_SKINS[awId].element===element && owned[baseId]) out.push(awId);
    }
  }
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
// 累計はレイドの版(RAID_EDITION)ごとに数え直す(2026-09-03)。前回100連でカタログを受け取った人も、
// 次のレイドでまた100連で受け取れる。ed が無い古い保存は第1回のものとして扱う。
function loadRaidGachaCount(){
  try{
    const c=JSON.parse(localStorage.getItem(RAID_GACHA_COUNT_KEY))||{};
    if((c.ed||'r1')!==RAID_EDITION) return { count:0, done:false, ed:RAID_EDITION };
    return { count:c.count||0, done:!!c.done, ed:RAID_EDITION };
  }
  catch(err){ return { count:0, done:false, ed:RAID_EDITION }; }
}
function saveRaidGachaCount(c){
  c.ed = RAID_EDITION;
  try{ localStorage.setItem(RAID_GACHA_COUNT_KEY, JSON.stringify(c)); }catch(err){}
  if(typeof accountMarkDirty==='function') accountMarkDirty();
}
// レイドガチャのSSR枠。ピックアップ(レイド特効。複数体を等分)が半分、残りは通常SSRから均等
function pickRaidGachaSsrSkinId(){
  const ids = raidGachaSsrSkinIds();
  const pickup = ids.filter(isRaidGachaPickup);
  const others = ids.filter(id=>!isRaidGachaPickup(id));
  if(!pickup.length) return others.length ? pickRandom(others) : ids[0];
  if(!others.length) return pickRandom(pickup);
  return Math.random()<0.5 ? pickRandom(pickup) : pickRandom(others);
}
// 提供割合表(レイドガチャ版)。SSRの内訳だけ差し替えて、他は通常ガチャと同じ
function raidGachaRateTable(){
  const rows = gachaRateTable();
  const ssrRow = rows.find(r=>r.rarity==='SSR');
  if(ssrRow){
    const ids = raidGachaSsrSkinIds();
    const pickupIds = ids.filter(isRaidGachaPickup);
    const otherIds = ids.filter(id=>!isRaidGachaPickup(id));
    ssrRow.items = ids.map(id=>({
      label: skinMeta(id).name + (isRaidGachaPickup(id) ? '(ピックアップ)' : ''),
      pct: isRaidGachaPickup(id) ? (pickupIds.length ? RARITIES.SSR.rate/2/pickupIds.length : 0)
                                  : (otherIds.length ? RARITIES.SSR.rate/2/otherIds.length : 0),
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
  ['freeTrainTicket',1000],['moveTicket',1000],['expeditionRecall',800],
];

/* モン晶の交換所。**1行足せば品が増える**(画面もこの表から作る。手書きの一覧を作らない)。
   reward は grantReward() がそのまま受け取る形なので、新しい付与経路は要らない。
   ・目玉は秘伝の書100個(被り約31回ぶんの10連)。長期の目標として置く。
   ・生命の果実・加速剤は**入れない**(レイド討伐限定の希少性を壊す)。
   ・小口(20/15)を混ぜて、100に届く前でも使い道があるようにしている。 */
const SHARD_EXCHANGE = [
  { id:'hiden',    cost:100, reward:{ item:'hidenScroll', n:1 },
    note:'tier3技に強化を1つ付ける。覚醒と重ねられる' },
  { id:'catalog',  cost:300, reward:{ catalog:'ssr', n:1 },
    note:'欲しいSSR/SRスキンを1着えらんで受け取る' },
  { id:'freeTrain',cost: 20, reward:{ item:'freeTrainTicket', n:5 },
    note:'トレーニングチケット5枚ぶん' },
  { id:'recall',   cost: 15, reward:{ item:'expeditionRecall', n:3 },
    note:'遠征をすぐ帰らせる' },
];
function shardExchangeLabel(e){
  if(!e) return '';
  if(e.reward.item){
    const it = PLAYER_ITEMS[e.reward.item];
    const n = e.reward.n || 1;
    return `${it.icon} ${it.name}${n>1 ? ` ×${n}` : ''}`;
  }
  if(e.reward.catalog) return `🎫 ${catalogTitle(e.reward.catalog)}`;
  return '';
}

/* =====================================================================
   初回チュートリアル(新規プレイヤーの離脱防止。発注者指示 2026-08-18)

   **順番・文言・完了条件はこの表1つ。** ステップを増やすときはここへ1行足す。
   進行の面倒(カードの表示・帯・画面のロック・保存・再開)は tutorial.js が見る。

   1行の中身:
     id       進捗の保存に使う名前。**変えると途中の人が再開できなくなる**
     card     節目に出す全画面カード { title, body, img }
     hint     操作している間、画面下の帯に出す一言。**帯は1行で切れる**ので20字くらいまで
     allow    その間さわってよい要素(セレクタ)。**先頭が光る**
     enter()  カードを閉じたときに一度だけ走る(画面を開くなどの前準備)
     leave()  そのステップを終えたときに一度だけ走る(開いた物を元へ戻す後始末)
     done()   これが true になったら次のステップへ。**省略するとカードを閉じただけで進む**
     skipIf() 最初から満たしているとき、そのステップを飛ばす
     optional true ならカードに「あとで」を出す(飛ばしてよいステップ)
     inMatch  true = **練習試合の中で出す案内**。カードは出さず帯だけ。画面はロックしない
     limitSec inMatch のときの待ち上限(秒)。過ぎたら黙って次へ(試合は止まらないので必須)

   ・**試合中は画面をロックしない**(操作できなくなるため)。tutorial.js 側の共通判断。
   ・関数の中身は実行時にしか評価されないので、ui.js の関数をそのまま呼んでよい。
   ===================================================================== */
/* 練習試合の中の案内(inMatch)で使う数値。**試合は止まらない**前提で決めてある。
   ・読む余裕が無いので帯は短く、条件を満たしたら即次へ。
   ・できなくても必ず先へ行けるように、1つの案内で待つ上限を持たせる。 */
const TUT_MATCH_STEP_SEC = 22;    // 1つの案内で待つ上限(秒)。過ぎたら次へ送る
const TUT_MATCH_READ_SEC = 2.2;   // 帯を最低これだけは残す(先に条件を満たしていても一瞬で消えない)
const TUT_LOOK_YAW_RAD   = 1.0;   // 「まわりを見た」と認める向きの変化(約57度)
const TUT_AIM_YAW_RAD    = 0.35;  // 「FIREを滑らせて狙った」と認める向きの変化(約20度)
const TUT_GUTS_REGAIN    = 5;     // 「ガッツが戻り始めた」と認める回復量
const TUTORIAL_STEPS = [
  { id:'pickMonster',
    card:{ title:'まずは相棒を選ぼう', body:'モンスターごとに技も強さも違う。気になった子を選んでみよう。あとから何度でも変えられるよ。' },
    hint:'画面中央をタップ→モンスターを選んで「このモンスターで参戦」',
    allow:['#lobbyMonsterStage', '#monsterPickOverlay', '#monsterListScreen'],
    done:()=> !!game.selectedElement },

  { id:'match',
    card:{ title:'1試合やってみよう',
      body:'左下のスティックで移動、右下の「FIRE」で攻撃。\n画面をドラッグすると見ている向きが変わる。FIREは押したまま指を滑らせても狙えるよ。\n最後の1体まで生き残れば勝ち！ 今回は短めの練習試合。倒されても大丈夫、そのまま次へ進むよ。\n\n試合が始まったら、画面の下に次にやることを1つずつ出すね。' },
    hint:'「バトル開始」で試合を始めよう',
    allow:['#joinBtn'],
    enter:()=> tutorialSetSoloMode(),
    done:()=> game.started && !game.over },

  /* ---- ここから練習試合の中(inMatch)。**カードは出さない**(試合が止まらないので読めない)。
     順番は「見る → 狙う → 倒す → 技 → 安置 → ガッツ」。倒されたり試合が終わったら
     残りは黙って畳んで matchEnd へ落ちる(tutorial.js の共通処理)。 */
  { id:'mLook', inMatch:true, limitSec:TUT_MATCH_STEP_SEC,
    hint:'画面をドラッグしてまわりを見よう',
    allow:[],                       // 画面全体が対象。**光らせる物は無い**(#gameCanvasを光らせると枠が画面外へ出る)
    enter:()=> tutorialMarkYaw(),
    done:()=> tutorialYawMoved(TUT_LOOK_YAW_RAD) },

  { id:'mAim', inMatch:true, limitSec:TUT_MATCH_STEP_SEC,
    hint:'「FIRE」は押したまま滑らせて狙える',
    allow:['#fireBtn'],
    enter:()=> tutorialMarkYaw(),
    done:()=> tutorialFireAimDone() },

  { id:'mKill', inMatch:true, limitSec:TUT_MATCH_STEP_SEC,
    hint:'敵に近づいて「FIRE」で倒そう',
    allow:['#fireBtn'],
    done:()=> !!player && (player.kills||0) >= 1 },

  { id:'mTier', inMatch:true, limitSec:TUT_MATCH_STEP_SEC,
    hint:'🎫を拾うと強い技。タップで切替',
    allow:['#movePanel'],
    enter:()=> tutorialMarkMoveTier(),
    done:()=> tutorialMoveTierDone() },

  { id:'mZone', inMatch:true, limitSec:TUT_MATCH_STEP_SEC,
    hint:'安置(黄色い円)の外はダメージ',
    allow:['#minimapWrap'],
    done:()=> tutorialInZoneDone() },

  { id:'mGuts', inMatch:true, limitSec:TUT_MATCH_STEP_SEC,
    hint:'ガッツは技の燃料。待てば戻る',
    allow:['#gutsTrack'],
    enter:()=> tutorialMarkGuts(),
    done:()=> tutorialGutsDone() },

  /* 試合の終わりを待つだけの段。**limitSec を持たせない**(ここで時間切れにすると
     まだ試合中なのに次のカードが試合の上へ出てしまう)。帯も出さない(hintなし)。
     リザルトを通らずにロビーへ戻された場合(通信切れなど)にも止まらないよう、
     「試合が終わっていてロビーが出ている」でも次へ行く。 */
  { id:'matchEnd', inMatch:true,
    done:()=> !document.getElementById('resultScreen').classList.contains('hidden')
           || (!game.started && !document.getElementById('startScreen').classList.contains('hidden')) },

  { id:'register',
    card:{ title:'マスモンに登録しよう', body:'気に入ったモンスターは「マスモン」として登録できる。レベルが上がって強くなり、ずっと相棒として育てられるよ。' },
    hint:'名前を決めて「登録する」を押そう',
    allow:['#mastermonRegisterPrompt', '#textInputOverlay'],
    skipIf:()=> !!loadMastermons()[game.selectedElement],
    done:()=> !!loadMastermons()[game.selectedElement] },

  { id:'train',
    card:{ title:'マスモンを育てよう', body:'トレーニングでステータスが伸びる。チケットは試合やレベルアップで増えていくよ。' },
    hint:'メニューを選んで「トレ実行」を押そう',
    allow:['#mastermonScreen'],
    enter:()=> tutorialOpenTraining(),
    skipIf:()=> !tutorialMastermonKey(),
    done:()=> tutorialTrainDone() },

  { id:'account',
    card:{ title:'データを守ろう', body:'アカウントを作ると、機種変更やホーム画面に追加したときもデータを引き継げる。\n「プレイヤー名」と「パスコード(4桁の数字)」を決めるだけ。あとからでもOK。' },
    hint:'名前とパスコードを入れて「ログイン / 新規作成」',
    allow:['#accountOverlay', '#textInputOverlay'],
    enter:()=> tutorialOpenAccount(),
    optional:true,
    skipIf:()=> accountState.loggedIn,
    done:()=> accountState.loggedIn },

  { id:'gacha',
    card:{ title:'ガチャを引いてみよう', body:'今回は特別に「10連ガチャ」が無料！\n相棒の新しい姿がきっと手に入るよ。' },
    hint:'「10連ガチャ」を押そう',
    allow:['#gachaOverlay', '#ssrRevealOverlay'],
    enter:()=> tutorialOpenGacha(),
    done:()=> tutorialGachaDone() },

  { id:'dressup',
    card:{ title:'スキンを着せてみよう', body:'手に入れたスキンは「着せ替え」でいつでも変えられる。見た目もオーラも変わるよ。' },
    hint:'新しいスキンを選んで「これに着せ替える」',
    allow:['#mastermonScreen'],
    enter:()=> tutorialOpenDressup(),
    skipIf:()=> !tutorialMastermonKey(),
    done:()=> tutorialDressupDone() },

  /* 試合の外の遊び方(D-2)。**全部は入れない**(長いとやめてしまう)。
     ここに置くのは「教わらないと存在に気づけない」2つだけ ―― 遠征とマルチ。
     残りの画面は FIRST_VISIT_CARDS(初めて開いたときの1枚)にまかせる。 */
  { id:'expedition',
    card:{ title:'留守のあいだも育てよう', body:'マスモンは「遠征」へ送り出せる。しばらくすると経験値やアイテムを持って帰ってくるよ。\n遊んでいない間も育つので、ロビーに戻ったらのぞいてみよう。' },
    hint:'左の「遠征」を開いてみよう',
    allow:['#openExpeditionBtn', '#expeditionOverlay', '#expeditionPickOverlay'],
    enter:()=> tutorialBackToLobby(),
    optional:true,
    done:()=> tutorialExpeditionDone() },

  { id:'multi',
    card:{ title:'誰かと一緒に遊ぶには', body:'「プレイモード」で「マルチPvP(2〜4人)」を選ぶと、「部屋を作る」「部屋を探す」が出てくる。\n「部屋を探す」を押すだけで、待っている誰かと遊べるよ。もらえる経験値もぐんと増える。' },
    hint:'「プレイモード」を開いてみよう',
    allow:['#openModePickBtn', '#modePickOverlay'],
    enter:()=> tutorialBackToLobby(),
    optional:true,
    leave:()=> tutorialSetSoloMode(),   // 見に行ったあとは1人で遊べるシングルへ戻しておく
    done:()=> tutorialModePickDone() },

  { id:'pwa',
    card:{ title:'ホーム画面に追加しよう', body:'共有ボタンから「ホーム画面に追加」すると、アプリのように全画面ですぐ遊べる。\n※追加したあとは、さっき作ったアカウントでログインしてね。', img:'guide/addhome-guide.png' },
    skipIf:()=> tutorialIsStandalone() },

  { id:'help',
    card:{ title:'困ったときは', body:'遊び方・操作・画面の見かたは、ロビー左の「🔰 はじめて」からいつでも見られるよ。' },
    hint:'左の「🔰 はじめて」を開いてみよう',
    allow:['#openHelpFromLobbyBtn', '#headerHelpBtn', '#helpOverlay', '#helpImageOverlay'],
    enter:()=> tutorialBackToLobby(),
    done:()=> tutorialHelpDone() },

  { id:'finish',
    card:{ title:'チュートリアル完了！', body:'これで一通りの遊び方はおしまい。あとは自由に暴れよう！\nお礼にプレゼントを受け取ってね。' } },
];

/* チュートリアルの練習試合。**通常の試合の数値には一切影響させない**
   (入口の判定は game.tutorialMatch 1つ。射撃訓練場の game.trainingRange と同じ流儀) */
const TUTORIAL_MATCH = {
  botCount:      9,     // 自分を入れて10体
  mapScale:      0.5,   // 10体で全面マップだと出会えないので狭くする
  zoneTimeMult:  0.5,   // 安置の縮小・待ち時間を半分にして2〜3分で決着させる
  botPowerMult:  0.6,   // 初回は勝てる手応えにする(自分のステータス合計の6割を上限にする)
  botThinkMult:  2.2,   // botの考え直す間隔(反応の鈍さ)。大きいほど動き出しが遅い
};
// チュートリアル完了のプレゼント
const TUTORIAL_REWARD = { dia: 60, items: [{ key:'freeTrainTicket', n: 3 }] };

/* =====================================================================
   難易度「やさしい / ふつう」(D-6)

   チュートリアルを卒業した次の試合からいきなり等倍になる段差を埋めるための、
   プレイヤーが自分で選ぶ手加減。**この表に1行足せば難易度が増える。**
   呼ぶ側は id で分岐せず、下の関数だけを見ること。

   ・**数字の正は TUTORIAL_MATCH**(発注者決定「練習試合の係数を使い回す」)。
     ここは読むだけにして二重に持たない。**調整するときは TUTORIAL_MATCH のほうを直す。**
   ・**やさしいで変えるのは bot の強さと反応の2つだけ。**
     TUTORIAL_MATCH には体数(botCount)・マップの広さ(mapScale)・安置の速さ(zoneTimeMult)も
     あるが、あれは「チュートリアルを2〜3分で終わらせる」ための時間短縮であって難易度ではない。
     やさしいでも30人・全面マップ・通常の安置で遊ぶ(そこまで変えると別のゲームになる)。
   ・**記録するかどうか(ranked)もこの表の欄にしてある。** 呼ぶ側が
     `matchDifficultyId()==='easy'` と各所に書くのを防ぐため。
     ranked:false ではランキング送信と段位RPを止めるが、**ダイヤ・EXPは従来どおり入る**
     (発注者決定 2026-08-22)。
   ===================================================================== */
// ハードの段位RP・経験値の倍率(増える方も減る方も同じ倍率。発注者決定「ハイリスク・ハイリターン」)。
// 名前付き定数にしてこの表のすぐ上に置く(発注者が実機で調整する用)。
const MATCH_HARD_RP_MULT  = 1.5;   // 段位RPの増減(勝ちも負けも)に掛ける
const MATCH_HARD_EXP_MULT = 1.5;   // 経験値に掛ける
const MATCH_DIFFICULTIES = [
  { id:'normal', label:'ふつう',   icon:'⚔️', ranked:true,
    note:'記録に残る本番。ランキングと段位RPが動く',
    botPowerMult: 1, botThinkMult: 1 },
  { id:'easy',   label:'やさしい', icon:'🌱', ranked:false,
    note:'敵が弱く、動き出しも遅い。狙いも自動で補助する。ダイヤと経験値は入るが、ランキングと段位RPには残らない',
    botPowerMult: TUTORIAL_MATCH.botPowerMult,   // 正は TUTORIAL_MATCH(ここは読むだけ)
    botThinkMult: TUTORIAL_MATCH.botThinkMult,   // 同上
    autoAim: true },   // オートエイム(継続ロックオン+弱い引き寄せ)。normalには付けない
  { id:'hard',   label:'ハード',   icon:'🔥', ranked:true,
    note:'上位プレイヤーが育てたモンスターが敵として出てくる。段位RPと経験値が増える代わりに、負けたときの下がり幅も大きい',
    botPowerMult: 1.3,   // 敵(ゴーストで埋まらない分の強化bot)のステータス上限を3割増しにする
    botThinkMult: 0.7,   // botの考え直す間隔を3割縮める(反応が速くなる)
    rpMult: MATCH_HARD_RP_MULT,
    expMult: MATCH_HARD_EXP_MULT },
];
const MATCH_DIFFICULTY_DEFAULT = 'normal';                   // 既定は今までどおりの試合
const MATCH_DIFFICULTY_KEY = 'aramon_match_difficulty_v1';   // 端末ごとの選択(localStorage)

/* いま選んでいる難易度。**書くのは setMatchDifficulty() だけ**(localStorage を触るのもそこだけ)。
   読み出しは最初に要ったときの1回で、以降はこの変数が正。 */
let matchDifficultyCur = null;
function matchDifficultyById(id){ return MATCH_DIFFICULTIES.find(d=> d.id === id) || null; }
// いま選んでいる難易度の1行(必ず何かを返す。壊れた保存値は既定へ丸める)
function matchDifficulty(){
  if(!matchDifficultyCur){
    let saved = null;
    try{ saved = localStorage.getItem(MATCH_DIFFICULTY_KEY); }catch(err){}
    matchDifficultyCur = matchDifficultyById(saved)
                      || matchDifficultyById(MATCH_DIFFICULTY_DEFAULT) || MATCH_DIFFICULTIES[0];
  }
  return matchDifficultyCur;
}
function matchDifficultyId(){ return matchDifficulty().id; }
// 難易度を変える唯一の入口。表に無い id は無視する(選択を壊さない)
function setMatchDifficulty(id){
  const d = matchDifficultyById(id);
  if(!d) return matchDifficulty();
  matchDifficultyCur = d;
  try{ localStorage.setItem(MATCH_DIFFICULTY_KEY, d.id); }catch(err){}
  return d;
}

/* 難易度が効く「試合の種類」かどうかの規則を1か所にまとめる。対象は
   「個人戦30人バトロワ」と「チーム戦20チームバトロワ」の2つだけ ―― レイド・
   チームのアリーナ・シングルのマルチPvP(pvp4)・射撃訓練場は対象外。
   **ロビーの出し分け(ui.js の renderDifficultyTabs 呼び出し側)と matchDifficultyApplies()
   の両方がここを読む**(条件を2か所に書き分けない)。前者は選ぶ前の lobbyMode/lobbySubMode を
   isTeam/sub にそのまま渡し、後者は試合中の isTeamMatch()/game.arena から同じ形を作って渡す。
   マルチPvP(部屋を使う対戦かどうか)はここでは見ない ―― ロビーの時点ではまだ確定しない
   (部屋を作っても後で誰も来ないかもしれない)ため、呼び出し側がそれぞれ別に見る。 */
function matchDifficultyModeOk(isTeam, sub){
  return isTeam ? (sub==='br20') : (sub==='br30');
}
/* 難易度が効く試合か。
   【2026-09-07 チーム戦(20チームバトロワ)にも難易度を導入】isTeamMatch() による除外を外した。
   ただし以下はそのまま除外する:
   ・game.trainingRange / game.raid / game.arena ―― 射撃訓練場・レイド・チームのアリーナは対象外
     (アリーナは matchDifficultyModeOk 側の sub==='br20' にも該当しないので二重に守られる)
   ・マルチ(部屋を使う対戦)は、**部屋に自分以外の人間が1人でもいたら**除外する(発注者決定
     2026-09-07「部屋に人間が自分だけのときだけ効かせる」)。個人戦のマルチ(pvp4)は
     人数に関係なく従来どおり常に除外 ―― sub を 'pvp4' として matchDifficultyModeOk() 側で
     弾く(pvp4はマルチでしか遊べないので、ここで弾けば下の人数チェックへは来ない)。
     チーム戦(br20)だけ、**試合開始時点で自分以外の人間がいなかった場合に限り**効かせる。
     マルチは実際に他のプレイヤーがいると、端末ごとに違う手加減(bot強さ・自動照準)を
     混ぜるとフェアでないため ―― 自分1人だけの部屋(残りはbot/ゴースト)ならこの心配がない。
     **人数は試合開始時点で1回だけ判定し、試合中に人が抜けても変えない**(判定・持ち場は
     network.js の beginMultiplayerMatchInner が game.matchOtherHumansPresent へ控える。
     数え方は新しく作らず、ui.js の exitEndsMatchForOthers() と同じ「自分以外の人間がいるか」
     の式をそのまま使う)。 */
function matchDifficultyApplies(){
  if(typeof game==='undefined' || !game) return false;
  if(game.trainingRange || game.raid || game.arena) return false;
  const isMulti = typeof netState!=='undefined' && netState && netState.mode==='multi';
  const isTeam = (typeof isTeamMatch==='function') && isTeamMatch();
  const sub = isTeam ? 'br20' : (isMulti ? 'pvp4' : 'br30');
  if(!matchDifficultyModeOk(isTeam, sub)) return false;
  if(isMulti && game.matchOtherHumansPresent) return false;
  return true;
}
/* この試合の成績をランキング・段位RPへ登録してよいか。**可否はこの1関数で決める。**
   難易度が効かない試合(マルチ・レイド等)は今までどおり常に true。 */
function matchDifficultyRanked(){
  return !matchDifficultyApplies() || !!matchDifficulty().ranked;
}

/* ===== 手加減の倍率(チュートリアルの練習試合と難易度をまとめた1つの入口) =====
   練習試合(tutorialMatch)の間だけは**掛け算にせず、手加減が強いほう(=より弱いbot)**を採る。
   掛けると 0.6×0.6=0.36 と、どちらの設計値でもない別物になるうえ、
   **練習試合の手応えが難易度の選択で変わってしまう**(練習試合は1ミリも変えない、が条件)。
   やさしいの係数は TUTORIAL_MATCH と同じ値なので、練習試合は選択に関係なく従来どおり
   ―― ハード(1を超える強化)を選んでいても、練習試合はTUTORIAL_MATCHより強くならない。
   **練習試合でないときは難易度の値をそのまま返す**(ハードの「1を超える」強化がここで
   1に丸められてしまわないように)。 */
function matchBotPowerMult(){   // bot のステータス合計の上限に掛ける(小さいほど弱い、大きいほど強い)
  const dif = matchDifficultyApplies() ? matchDifficulty().botPowerMult : 1;
  if(!(typeof game!=='undefined' && game && game.tutorialMatch)) return dif;
  return Math.min(TUTORIAL_MATCH.botPowerMult, dif);
}
function matchBotThinkMult(){   // bot が考え直す間隔に掛ける(大きいほど反応が鈍い、小さいほど速い)
  const dif = matchDifficultyApplies() ? matchDifficulty().botThinkMult : 1;
  if(!(typeof game!=='undefined' && game && game.tutorialMatch)) return dif;
  return Math.max(TUTORIAL_MATCH.botThinkMult, dif);
}
/* 段位RP・経験値の倍率(ハードだけ1以外になる)。**呼ぶ側は id で分岐せず、この2関数だけ見る。**
   表(MATCH_DIFFICULTIES)に rpMult/expMult が無い行は1(倍率なし)として扱う。 */
function matchRankRpMult(){
  return (matchDifficultyApplies() && matchDifficulty().rpMult) ? matchDifficulty().rpMult : 1;
}
function matchExpMult(){
  return (matchDifficultyApplies() && matchDifficulty().expMult) ? matchDifficulty().expMult : 1;
}

/* ===== オートエイム(難易度「やさしい」限定。スマホ操作が苦手な人向け・発注者要望 2026-09-07) =====
   効果は2つ(実装はcombat.js/input.js)。**強さの数字は全部ここにまとめる**(発注者が実機で調整するため)。
   ・継続ロックオン: 敵タップ後のスナップ(startCameraSnap)を、その敵が生きていて
     射程・視野に入っているあいだ、この速度で追い続ける(combat.jsのupdateAutoAimLock)。
   ・弱い引き寄せ: 照準の近くの敵へ毎フレームこの速度だけ寄せる。プレイヤーの入力は上書きしない
     (combat.jsのapplyAutoAimAssist。入力に足すだけ)。 */
const AUTO_AIM_LOCK_TURN_DEG_PER_SEC   = 260; // 継続ロックオン: 視点を追わせる最大回転速度(1秒あたり度)
const AUTO_AIM_ASSIST_MAX_DEG_PER_SEC  = 16;  // 弱い引き寄せ: 1秒あたり最大何度視点を寄せるか(既定は控えめ)
const AUTO_AIM_ASSIST_CONE_DEG         = 9;   // 弱い引き寄せの対象範囲(照準中心から±この角度以内の敵だけ)
const AUTO_AIM_FALLBACK_RANGE          = 900; // 技の射程が取れないとき(技未選択など)の距離判定の既定値

/* オートエイムが効く試合か。**判定はここ1か所**(呼ぶ側に書き足さない)。
   ・難易度が効く試合かどうかは matchDifficultyApplies() をそのまま読む(レイド・訓練場・アリーナ・
     マルチ・チーム戦は元からここで弾かれるので二重に書かない)。
   ・チュートリアルの練習試合だけは追加で無効にする(自分専用の手順で敵タップの狙い方を教える場面なので、
     まだ操作説明が済んでいない段階でカメラが勝手に動く挙動を混ぜない)。 */
function autoAimEnabled(){
  if(typeof game!=='undefined' && game && game.tutorialMatch) return false;
  return matchDifficultyApplies() && !!matchDifficulty().autoAim;
}

/* =====================================================================
   はじめてその画面を開いたときの1枚カード(D-2)

   チュートリアル本編に全部の遊びを詰めると長くなりすぎてやめてしまうので、
   **ロビーのボタンを初めて押したときに、その画面の説明を1枚だけ出す。**
   ・**この表に1行足せば増える。** 画面ごとの分岐は書かない
   ・出す仕組み(押した検知・保存・チュートリアル中は出さない)は tutorial.js の共通処理
   ・btn = 押されたボタン(セレクタ)。id = 出し終わったことを覚える名前(**変えると再び出る**)
   ・チュートリアル本編で教える画面(遠征・プレイモード)はここに入れない(二重に出るため)
   ===================================================================== */
const FIRST_VISIT_KEY = 'aramon_first_visit_v1';   // 出し終わったidの一覧。**端末ごと**(見た/見ないの記録)
const FIRST_VISIT_CARDS = [
  { id:'range',   btn:'#openRangeBtn',    title:'射撃訓練場',
    body:'的は倒しても復活し、アイテムは何度でも拾える練習場。\n技の届く距離や、FIREを滑らせて狙う感じをここで確かめよう。勝ち負けは無いので、いつ抜けてもOK。' },
  { id:'mission', btn:'#openMissionBtn',  title:'ミッション',
    body:'毎日のデイリーミッションと、シーズンパスがここ。\n試合をこなすだけで進むので、遊んだあとにのぞくとゴールドやダイヤがたまっているよ。' },
  { id:'bag',     btn:'#openBagBtn',      title:'バッグ',
    body:'手に入れたアイテムと称号はここ。\n「タネ」はマスモンのステータスを直接のばす。使う相手を右から選んでね。' },
  { id:'shop',    btn:'#openShopBtn',     title:'ショップ',
    body:'試合でたまったゴールドでアイテムを買える。\n「💠モン晶こうかん」タブでは、ガチャの被りでたまるモン晶を特別なアイテムに換えられるよ。' },
  { id:'ranking', btn:'#titleRankingBtn', title:'ランキング',
    body:'撃破数・与ダメージ・マスモンの育ち具合が全国で並ぶ。\n通常マップ／リアルマップ／マスモンでタブが分かれているよ。' },
  { id:'gallery', btn:'#openGalleryBtn',  title:'ギャラリー',
    body:'持っているスキンを大きく鑑賞できる。\nSSRスキンは専用のムービー・BGM・効果音も聴ける(ミュージアム)。気に入った曲はロビーBGMにもできるよ。' },
  { id:'gacha',   btn:'#openGachaBtn',    title:'ガチャ',
    body:'ダイヤでスキンを引く。持っているスキンが出たときは「モン晶(💠)」がもらえて、ショップで交換できる。\n引いた回数でも節目の報酬がもらえるよ。' },
  { id:'raid',    btn:'#openRaidBtn',     title:'レイドバトル',
    body:'みんなで大きなボスに挑む期間限定のバトル。\n倒しきれなくても、与えたダメージが積み上がって報酬になるよ。1人でも部屋を作っても挑める。' },
];
function firstVisitCardFor(sel){ return FIRST_VISIT_CARDS.find(c=> c.btn === sel) || null; }
function loadFirstVisitSeen(){
  try{ return JSON.parse(localStorage.getItem(FIRST_VISIT_KEY)) || {}; }catch(err){ return {}; }
}
function markFirstVisitSeen(id){
  const s = loadFirstVisitSeen();
  if(s[id]) return;
  s[id] = 1;
  try{ localStorage.setItem(FIRST_VISIT_KEY, JSON.stringify(s)); }catch(err){}
}
/* 押された要素から「まだ出していないカード」を引く。押した先が中の <span> でも当たるように
   closest() で探す(座標を使わないので強制横向きでも効く)。無ければ null。 */
function firstVisitCardForTarget(el){
  if(!el || !el.closest) return null;
  for(const c of FIRST_VISIT_CARDS){
    if(el.closest(c.btn)) return loadFirstVisitSeen()[c.id] ? null : c;
  }
  return null;
}

/* =====================================================================
   用語集(D-3)

   ガッツ・安置・モン晶…といった中核の言葉が、ゲーム内のどこにも説明されていなかった。
   **説明はこの表1つ**にまとめ、遊び方ガイドの「用語集」の章はここから組み立てる
   (ELEMENTS / STATE_CHANGES / CHANGELOG_TAGS と同じ流儀。手書きの一覧を作らない)。

   1行の中身: { id, cat, icon, term, desc }
     cat  GLOSSARY_CATEGORIES の id。章の中の並びはこの表の順そのまま
     desc **文字列か、文字列を返す関数**。数字を出すときは必ず関数にして
          **定数から組み立てる**(定数を変えたら説明も変わる。数字を二重に持たない)

   画面側は次の2つだけ使えばよい:
     glossaryEntries(catId)  … その章の項目(catId 省略で全件)
     glossaryText(entry)     … その項目の説明文(関数でも文字列でも同じ形で返る)
   ===================================================================== */
const GLOSSARY_CATEGORIES = [
  { id:'battle', label:'バトルの言葉' },
  { id:'grow',   label:'育成の言葉' },
  { id:'meta',   label:'やりこみの言葉' },
];
const GLOSSARY = [
  /* ---- バトル ---- */
  { id:'guts', cat:'battle', icon:'💪', term:'ガッツ',
    desc:()=> `技を撃つための燃料。HPバーの下の細いバーがそれで、技ごとに決まった量を使う。`
            + `足りないと「ガッツ不足！」と出て撃てず、FIREボタンも灰色になる。`
            + `時間がたつと自動で戻り、ステータスの「かしこさ」が高いほど回復が速い。`
            + `落ちている${GUTS_ITEM.name}(🍬)を拾うと ガッツ+${GUTS_ITEM.restore}・上限+${GUTS_ITEM.maxBoost}。` },
  { id:'zone', cat:'battle', icon:'🟡', term:'安置（安全圏）',
    desc:()=> `ミニマップの黄色い円の中が安置。外にいるとじわじわダメージを受け、`
            + `終盤ほど痛くなる(最後は毎秒${ZONE_PHASES_BASE[ZONE_PHASES_BASE.length-1].dps})。`
            + `円は時間で小さくなり、点線が次の縮小先(安置予測)。`
            + `縮み始める${ZONE_WARN_LEAD_SEC}秒前に知らせが出るので、そこで動き出せば間に合う。` },
  { id:'tier', cat:'battle', icon:'🎫', term:'技のtierと修行チケット',
    desc:()=> `技は3段階(tier1〜3)あり、試合の始めはtier1だけ。`
            + `落ちている${TICKET_ITEM.name}(🎫)を拾うと上の技が使えるようになる。`
            + `画面下の技パネルをタップすると使う技を切り替えられる(左右のフリックでも切替)。` },
  { id:'autorun', cat:'battle', icon:'🏃', term:'オートラン',
    desc:'左のスティックを上へ2回はじくと、指を離しても走り続ける。もう一度スティックを触るか、被弾すると解除。移動が長い序盤に使うと楽。' },
  { id:'dash', cat:'battle', icon:'💨', term:'ダッシュ',
    desc:()=> `右下のDASHで短い距離を一気に移動する(通常の${DASH_SPEED_MULT}倍の速さ)。`
            + `技をよけるときと、安置へ急ぐときの両方に使える。` },
  { id:'down', cat:'battle', icon:'🩹', term:'ダウンと蘇生',
    desc:()=> `チーム戦だけの仕組み。HPが尽きても一度は「ダウン」で踏みとどまり、這って動ける`
            + `(移動は${Math.round(TEAM_DOWN_SPEED_MULT*100)}%・被ダメ${TEAM_DOWN_DMG_TAKEN_MULT}倍)。`
            + `仲間が近く(${Math.round(TEAM_REVIVE_RADIUS/PING_UNITS_PER_M)}mほど)に${TEAM_REVIVE_SEC}秒とどまると蘇生でき、`
            + `HPが最大の${Math.round(TEAM_REVIVE_HP_RATIO*100)}%まで戻る。`
            + `誰も来ないまま${TEAM_DOWN_BLEED_SEC}秒たつと力尽きる。` },
  { id:'ping', cat:'battle', icon:'🎯', term:'ピン（合図）',
    desc:()=> `チーム戦で出る🎯ボタン。見ている方向へ「ここへ行こう」「敵がいる」の合図を置ける。`
            + `味方の画面とミニマップに${PING_LIFETIME_SEC}秒だけ出るので、文字を打たずに意思を伝えられる。` },
  { id:'deathDisc', cat:'battle', icon:'🥏', term:'デス円盤石',
    desc:()=> `倒されたモンスターが、試合中に得た強化を石の円盤として最大${DEATH_DISC_MAX_ITEMS}個落とす。`
            + `誰でも拾えて、拾った瞬間にそのまま自分の強化になる。`
            + `拾った力も自分が倒されればまた落ちるので、強化が試合の中をぐるぐる巡る。` },
  { id:'disc', cat:'battle', icon:'💿', term:'円盤石',
    desc:'試合の開始やガチャの召喚でモンスターの足元に出る、光る石の円盤。演出なので効果は無い(強化の石は「デス円盤石」のほう)。' },

  /* ---- 育成 ---- */
  { id:'mastermon', cat:'grow', icon:'⭐', term:'マスモン',
    desc:()=> `ずっと相棒として育てられるモンスター。試合を1回終えると登録でき、1種族につき1体。`
            + `レベルは${MASTERMON_LEVEL_CAP}が上限で、上げたステータスは次の試合にそのまま乗る。` },
  { id:'aptitude', cat:'grow', icon:'🅰️', term:'適正（ステータスの横のバッジ）',
    desc:()=> `ステータスごとの「トレーニングの伸びやすさ」。段階は ${APTITUDE_ORDER.join('→')} で、`
            + `1回のトレーニングで伸びる量が ${APTITUDE_TRAIN_MULT[APTITUDE_ORDER[0]]}倍`
            + `〜${APTITUDE_TRAIN_MULT[APTITUDE_ORDER[APTITUDE_ORDER.length-1]]}倍まで変わる。`
            + `種族の適正はSまでで、それより上は転生でしか手に入らない。`
            + `S以上はステータス1ポイントあたりの効きも良くなる。` },
  { id:'rebirth', cat:'grow', icon:'♻️', term:'転生',
    desc:()=> `レベル${REBIRTH_LEVEL_REQ}のマスモンをレベル1に戻す代わりに、`
            + `適正を${REBIRTH_APT_PICKS}つ1段階ずつ上げる。ステータスは${Math.round(1/REBIRTH_STAT_KEEP_RATIO)}分の1だけ残り、`
            + `上限が+${REBIRTH_STAT_CAP_STEP}、トレーニングチケットも${REBIRTH_TICKETS}枚もらえる。`
            + `${REBIRTH_MAX}回まで重ねられて、そのたびに伸びしろが増える。` },
  { id:'awaken', cat:'grow', icon:'✵', term:'覚醒',
    desc:()=> `育て込んだマスモンだけの最終形態。転生${AWAKEN_REBIRTH_REQ}回以上＋6つのステータスすべて${AWAKEN_STAT_MIN}以上で、`
            + `対応するSSRスキンを着ていると覚醒できる。姿が変わり、tier3の技に強化を1つ選んで付けられる。`
            + `着せ替えで元の姿に戻すこともできる(戻すと強化も外れる)。` },
  { id:'hiden', cat:'grow', icon:(PLAYER_ITEMS.hidenScroll||{}).icon || '📖', term:'秘伝の書',
    desc:()=> `モン晶${(SHARD_EXCHANGE.find(e=>e.id==='hiden')||{cost:0}).cost}個で交換できる技の強化アイテム。`
            + `いま着ているスキンのtier3技に「威力アップ」などの強化を1つ付けられる。`
            + `1体につき${HIDEN_MAX_PER_MASTERMON}つまでで、覚醒の強化とは重ねてかけられる。` },
  { id:'expedition', cat:'grow', icon:'🧭', term:'遠征',
    desc:()=> `マスモンを送り出しておくと、時間がたって経験値やアイテムを持ち帰る。`
            + `枠はマスモンの数で増える(${EXPEDITION_SLOT_UNLOCKS.map(u=>`${u.own}体で${u.slots}枠`).join('・')})。`
            + `行き先とステータスの相性がよいほど成果が大きい。出ている間その子は試合に出せない。` },

  /* ---- やりこみ ---- */
  { id:'shard', cat:'meta', icon:SHARD_ICON, term:SHARD_NAME,
    desc:()=> `ガチャで「すでに持っているスキン」が出たとき(これを被りという)にもらえる石。`
            + `SRの被りで${DUP_SKIN_SHARD}個・SSRの被りで${DUP_SSR_SHARD}個。`
            + `ショップの「${SHARD_ICON}モン晶こうかん」で、${SHARD_EXCHANGE.map(e=>shardExchangeLabel(e)).join('・')} と交換できる。` },
  { id:'rank', cat:'meta', icon:'👑', term:'段位とRP',
    desc:()=> `試合の成績でたまる点がRP、その量で決まる位が段位(${RANKS.map(r=>r.name).join('→')})。`
            + `1試合で 1位=+${RANK_RP_WIN} / `
            + RANK_RP_PLACE.map((p,i)=> `${i === RANK_RP_PLACE.length-1 ? 'それ以下' : `上位${Math.round(p.top*100)}%`}=${p.rp>0?'+':''}${p.rp}`).join(' / ')
            + `、さらに撃破1体につき+${RANK_RP_PER_KILL}(最大+${RANK_RP_KILL_MAX})。`
            + `ソロは${RANK_RP_MULT.solo}倍。下位に沈むと減るが、一度上がった段位より下には落ちない。`
            + `シーズンが切り替わると0からやり直しになる。` },
  { id:'sp', cat:'meta', icon:'🎖️', term:'SP（シーズンポイント）',
    desc:()=> `シーズンパスの進み具合。試合ごとに撃破数・与ダメージ・勝利でたまり、`
            + `${SEASON_SP_PER_TIER}SPごとに1段階、全${SEASON_MAX_TIER}段階の報酬がもらえる(すべて無料)。`
            + `シーズンが切り替わると0に戻る。` },
  { id:'mutator', cat:'meta', icon:'🎲', term:'ミューテーター',
    desc:()=> `曜日ごとに変わる特別ルール。ミッション画面のカレンダーで今日の内容を確認できる。`
            + `効果は ${MUTATOR_LEGEND.map(m=>`${m.label}=${m.desc}`).join(' / ')}。` },
  { id:'raid', cat:'meta', icon:'🐉', term:'レイド',
    desc:'期間限定の大型ボス戦。倒しきれなくても与えたダメージが全員ぶん積み上がり、討伐までみんなで削っていく。自分の与ダメージに応じて報酬とランキングがつく。' },
];
function glossaryText(e){ return e ? (typeof e.desc === 'function' ? e.desc() : (e.desc || '')) : ''; }
function glossaryEntries(catId){ return catId ? GLOSSARY.filter(g=> g.cat === catId) : GLOSSARY.slice(); }

/* =====================================================================
   探検モード(内部名 explore)の定数・表
   ・**既存の「遠征」(放置で報酬が来る仕組み)とは別物。名前を混ぜない。**
   ・モードの進行(開始・力尽き・帰還・終了・報酬)は explore.js。ここは数値と表だけ。
   ・分岐の入口は game.explore 1つ(game.raid と同じ方式)。通常の試合はここを読まない。
   ・数値は発注者が実機で調整する前提の名前付き定数。
   ・MAPS.explore / REAL3D_TERRAIN_SETS.explore / REAL3D_THEMES.explore はフィールド担当の持ち物で、
     このブロックでは触らない(地域の位置と色のヒントは下の EXPLORE_REGIONS が正)。
   ===================================================================== */
const EXPLORE_TIME_LIMIT          = 900;   // 制限時間(秒)。過ぎたら「時間切れ」で持ち帰り半分
const EXPLORE_MAX_FAINTS          = 3;     // 力尽きてよい回数。この回数に達したら終了(持ち帰り半分)
const EXPLORE_FAIL_KEEP_RATIO     = 0.5;   // 力尽き/時間切れで持ち帰れる割合(素材ごとに切り捨て)
const EXPLORE_FAIL_KEEP_MIN       = 1;     // ただし素材の種類ごとに最低この数は残す(1個しか無い素材が0にならない。統括の判断)
// 演出の尺(秒)。出発の札とカメラの一周 / 終わった直後のフィールドの札 / 力尽き(札→暗転→キャンプで明転)
const EXPLORE_INTRO_SEC           = 2.6;   // 出発: 「探検開始」の札を出し、カメラがキャンプを回る(この間は動けない)
const EXPLORE_OUTRO_SEC           = 1.6;   // 終了: フィールドに「帰還成功/時間切れ/力尽きた」の札を出してから報酬画面へ
const EXPLORE_OUTRO_RETURN_SEC    = 2.8;   // 帰還成功だけ長め(光の柱に包まれ、持ち帰った素材のアイコンが札を流れる)
const EXPLORE_FAINT_SLOWMO        = { scale:0.35, holdSec:0.3, easeSec:0.35 };   // 力尽きた瞬間の一瞬のスロー(実時間の秒。ボス討伐の間と同じ仕組み)
const EXPLORE_FAINT_SEQ           = { fall:0.5, card:1.1, fadeOut:0.35, black:0.35, fadeIn:0.8 };   // 力尽き: 倒れる→札→暗転→(キャンプへ運ぶ)→明転(起き上がる)
const EXPLORE_LAST_STORAGE_KEY    = 'aramon_explore_last_v1';   // 前回の持ち帰り(ロビー右列に出す。端末ごとの表示なので同期しない)
const EXPLORE_WORLD_SCALE         = 1;     // フィールドの広さ(通常試合と同じ 18100 四方)
const EXPLORE_RESPAWN_INVULN_SEC  = 3;     // ベースキャンプで復活した直後の無敵(秒)
/* ベースキャンプ。ワールドに対する比で置く(フィールド生成もここを読んで平らに空ける)。
   radius の内側は野生モンスターを置かない・湧かせない安全地帯。 */
const EXPLORE_CAMP = { xr:0.5, yr:0.5, radius:760 };
const EXPLORE_CAMP_SPAWN_OFFSET   = { dx:0, dy:240 };    // キャンプ中心から見た出発地点(復活地点も同じ)
const EXPLORE_BEACON_OFFSET       = { dx:0, dy:-300 };   // キャンプ中心から見た帰還ビーコンの位置
const EXPLORE_CAM_CLEARANCE       = 40;    // カメラと足元の地面(プレイヤー→カメラの線上)の最小の隙間
const EXPLORE_CAM_SAMPLES         = [0.35, 0.7, 1.0];   // 地面を調べる位置(プレイヤー=0 / カメラ=1)
const EXPLORE_CAM_LIFT_DOWN       = 3;     // 持ち上げを戻す速さ(上げるときは即座)
const EXPLORE_BEACON_RADIUS       = 120;   // ビーコンの輪の半径。この中にとどまると帰還が進む
const EXPLORE_BEACON_HOLD_SEC     = 3;     // 輪の中に何秒とどまれば帰還するか
const EXPLORE_BEACON_ARM_SEC      = 4;     // 出発直後はビーコンを効かせない(秒。うっかり帰還しない)
/* ===== 野生モンスター(群れ・気づき・縄張り。動きは explore.js の exploreWildAI / exploreResolveMove) =====
   1地域に群れを EXPLORE_WILD_PACKS_PER_REGION 個。群れ=リーダー1体+取り巻き(同じ種)。
   状態: うろつく → 気づきかけ「?」→ 気づく「!」→ 追う/攻撃 → (弱ると)逃げる → 縄張りへ戻る(戻る間は回復) */
const EXPLORE_WILD_PACKS_PER_REGION = 3;     // 1地域あたりの群れの数
const EXPLORE_WILD_PACK_SIZE      = { min:3, max:5 };   // 1つの群れの頭数(リーダー込み)
const EXPLORE_WILD_PACK_SPREAD    = 170;   // 取り巻きがリーダーの周りに寄り添う距離
const EXPLORE_WILD_LEADER         = { hp:1.5, radius:1.4, dmg:1.15 };    // リーダーだけ一回り大きく・硬い(足元の金の輪でも区別)
// 危険度★ごとの強さ(種族の素の値に掛ける)。tier=使える技の段(1〜3)
const EXPLORE_WILD_DANGER = {
  1: { hp:0.85, dmg:0.60, speed:0.88, tier:1 },
  2: { hp:1.05, dmg:0.80, speed:0.94, tier:1 },
  3: { hp:1.30, dmg:1.00, speed:1.00, tier:2 },
  4: { hp:1.60, dmg:1.20, speed:1.06, tier:3 },
};
const EXPLORE_WILD_ACTIVE_RADIUS  = 3600;  // プレイヤーからこの距離より遠い野生・ボスは眠らせる(AI・移動・攻撃を止める)
const EXPLORE_WILD_SLEEP_HYST     = 400;   // 起きる距離はこれだけ内側(境目で寝起きを繰り返さない)
const EXPLORE_WILD_WANDER         = 420;   // 普段うろつく範囲(縄張りの中心から)
const EXPLORE_WILD_WANDER_SPEED   = 0.38;  // うろつくときの速さ(素の速さに対する比。ゆっくり歩く)
const EXPLORE_WILD_REST_SEC       = { min:1.8, max:5.0 };   // 目的地に着いて立ち止まる時間
const EXPLORE_WILD_SIGHT_RANGE    = 700;   // 視界の扇の奥行き
const EXPLORE_WILD_SIGHT_DEG      = 130;   // 視界の扇の開き(度)。背後は見えない
const EXPLORE_WILD_NEAR_SENSE     = 240;   // 背後でもこの距離まで来れば気配で気づく
const EXPLORE_WILD_HEAR_RANGE     = 1500;  // プレイヤーの射撃の音が届く距離(視界の外でも気づく)
const EXPLORE_WILD_NOTICE_SEC     = 0.9;   // 視界の奥で見え続けて気づくまで(近いほど速い。「?」の間)
const EXPLORE_WILD_FORGET_SEC     = 1.6;   // 見えなくなってから気づきかけ「?」が消えるまで
const EXPLORE_WILD_ALERT_PAUSE    = 0.55;  // 気づいた瞬間に立ち止まって睨む時間
const EXPLORE_WILD_ALERT_SHOW     = 1.5;   // 頭上の「!」を出す秒数
const EXPLORE_WILD_PACK_CALL      = { min:0.2, max:0.65 };  // 仲間が気づいてから自分も気づくまでの遅れ(秒)
const EXPLORE_WILD_CHASE_RANGE    = 1100;  // 追っている相手がこれより離れたら見失い始める
const EXPLORE_WILD_LOSE_SEC       = 2.5;   // CHASE_RANGE の外にこの秒数いたら諦める
const EXPLORE_WILD_LEASH          = 1500;  // 縄張りの中心からこれ以上離れたら追うのをやめて戻る
const EXPLORE_WILD_RETURN_REGEN   = 0.10;  // 縄張りへ戻る間の回復(最大HPに対する毎秒)
const EXPLORE_WILD_RETURN_CALM_SEC= 3;     // 戻り終えてから再び気づけるようになるまで(秒)
const EXPLORE_WILD_FLEE_SEC       = 5;     // 逃げ続ける時間(その後は縄張りへ戻る)
const EXPLORE_WILD_FLEE_SPEED     = 1.1;   // 逃げる速さ(素の速さに対する比)
const EXPLORE_WILD_GUTS_REGEN     = 3;     // 野生の追加ガッツ回復(毎秒)。技を撃てずに棒立ちになるのを防ぐ
const EXPLORE_WILD_RESPAWN_SEC    = 60;    // 倒してから同じ縄張りに湧き直すまで(秒)
const EXPLORE_WILD_RESPAWN_HIDE   = 2400;  // プレイヤーがこの距離より近いと湧き直さない
const EXPLORE_WILD_RESPAWN_SEEN   = 4200;  // この距離より近く、しかもカメラの前方なら湧き直さない(見ている前で湧かせない)
// 保つ間合い(使う技の射程に対する比)。kite=距離を取って撃つ / rush=懐へ突っ込む
const EXPLORE_WILD_KEEP_DIST      = { kite:0.72, rush:0.30 };
/* 種ごとの性格(ELEMENTS のキー)。表に無い種は EXPLORE_WILD_NATURE_DEFAULT。
     temper: 'docile'=おとなしい(先に攻撃されるまで襲わない。気づいても「?」で様子を見るだけ)
             'aggressive'=好戦的(気づいたら「!」で襲ってくる)
     style : 'kite'=距離を保って撃つ / 'rush'=突っ込む
     fleeHp: 体力がこの割合を切ると逃げる(0=逃げない) */
const EXPLORE_WILD_NATURE = {
  mocchi:  { temper:'docile',     style:'kite', fleeHp:0.35 },
  hum:     { temper:'docile',     style:'kite', fleeHp:0.4  },
  suezo:   { temper:'aggressive', style:'rush', fleeHp:0.2  },
  centaur: { temper:'aggressive', style:'kite', fleeHp:0    },
  aqua:    { temper:'docile',     style:'kite', fleeHp:0.3  },
  fox:     { temper:'docile',     style:'kite', fleeHp:0.35 },
  ark:     { temper:'aggressive', style:'rush', fleeHp:0    },
  god:     { temper:'aggressive', style:'kite', fleeHp:0.15 },
  fire:    { temper:'aggressive', style:'rush', fleeHp:0    },
  phoenix: { temper:'aggressive', style:'kite', fleeHp:0.2  },
  rock:    { temper:'docile',     style:'rush', fleeHp:0    },
  ogre:    { temper:'aggressive', style:'rush', fleeHp:0    },
  leaf:    { temper:'docile',     style:'kite', fleeHp:0.25 },
  warm:    { temper:'aggressive', style:'rush', fleeHp:0    },
  narga:   { temper:'aggressive', style:'kite', fleeHp:0    },
  zan:     { temper:'aggressive', style:'rush', fleeHp:0.15 },
  pixie:   { temper:'docile',     style:'kite', fleeHp:0.45 },
};
const EXPLORE_WILD_NATURE_DEFAULT = { temper:'aggressive', style:'kite', fleeHp:0 };
function exploreWildNature(elKey){ return EXPLORE_WILD_NATURE[elKey] || EXPLORE_WILD_NATURE_DEFAULT; }

/* ===== ボス(地域ボス3体+頂点ボス1体。進行は explore.js の exploreUpdateBosses) =====
   **1行足せばボスが増える。** 見た目は既存のSSRスキン(skinId)をそのまま巨大化して使う。
   **人型のスキンは使わない**(「岩鎧の獣」がコートの人間に見えた=批評指摘)。獣・竜・怪鳥に見える物だけ。
   element はスキンの素体と同じにする(歩行コマが素体ごとの表 WALK_ANIM にあるため)。
   プレイヤーが同じスキンを着ていても「巨大な自分」に見えないよう、ボスには常時 color の色味と輪郭の光が掛かる
   (explore.js の exploreDrawMonsterUnder / exploreDrawMonsterTint)。
     region  = 巣を置く地域(EXPLORE_REGIONS の id)。巣の位置は exploreBossNest(region) が決める
     apex    = 頂点ボス(名前の札・討伐の演出が一段豪華になる)
     hp/radius/speed = 体力・体の半径(通常のモンスターは22前後。レイドのボスは288)・歩く速さ
     dmg     = 大技の威力の倍率(EXPLORE_BOSS_MOVES の dmg に掛ける)
     gap     = 大技と大技の間隔(秒)[最短, 最長]
     moves   = 使う大技(EXPLORE_BOSS_MOVES のキー)。rageOnly の技は怒ってから出る
     color   = 予告・大技・オーラの色(スキンの色に合わせる)
     partName= 弱点(頭)の部位名。部位破壊の通知に出る
     breakRatio = 部位破壊に要る弱点ダメージ(最大HPに対する比)
     drops / breakDrops = EXPLORE_DROP_TABLES のキー(討伐 / 部位破壊)
     roar    = 咆哮の音(audio.js の exploreRoar が合成する)。pitch=高さの倍率(1=基準・小さいほど低い) /
               len=長さ(秒) / grit=うなりのざらつき(0〜1) / heads=首の数(3なら3つの声がずれて重なる) */
const EXPLORE_BOSSES = [
  { id:'gandrock', region:'meadow', apex:false, name:'ガンドレイク', title:'盆地を統べる鋼角の竜',
    element:'fire', skinId:'metag_ssr', color:'#ffa04a', hp:2200, radius:190, speed:125, dmg:1.0,
    gap:[2.8, 4.2], moves:['swipe','stomp','charge','meteor','rain'], partName:'鋼の角', breakRatio:0.14,
    drops:'boss_gandrock', breakDrops:'break_gandrock', roar:{ pitch:0.62, len:1.9, grit:0.9 } },
  { id:'galvark', region:'frost', apex:false, name:'ガルヴァルク', title:'吹雪を裂く白き牙',
    element:'spark', skinId:'garurumon_ssr', color:'#8fe6ff', hp:2800, radius:170, speed:170, dmg:1.1,
    gap:[2.4, 3.8], moves:['swipe','breath','charge','meteor','rain'], partName:'氷牙', breakRatio:0.14,
    drops:'boss_galvark', breakDrops:'break_galvark', roar:{ pitch:1.35, len:1.4, grit:0.35 } },
  { id:'volgreim', region:'volcano', apex:false, name:'ヴォルガルーダ', title:'火口を舞う業火の翼',
    element:'phoenix', skinId:'ganon_ssr', color:'#ff5a22', hp:3400, radius:210, speed:140, dmg:1.25,
    gap:[2.4, 3.6], moves:['breath','stomp','charge','meteor','rain','nova'], partName:'炎の冠羽', breakRatio:0.15,
    drops:'boss_volgreim', breakDrops:'break_volgreim', roar:{ pitch:1.15, len:1.8, grit:0.7 } },
  { id:'gidravers', region:'jungle', apex:true, name:'ゾルディオス', title:'密林の頂点に君臨する黒き魔獣',
    element:'fire', skinId:'zod_ssr', color:'#c86bff', hp:5200, radius:250, speed:150, dmg:1.5,
    gap:[2.0, 3.2], moves:['swipe','breath','stomp','charge','meteor','rain','nova'], partName:'双角', breakRatio:0.13,
    drops:'boss_gidravers', breakDrops:'break_gidravers', roar:{ pitch:0.5, len:2.6, grit:1.0, heads:2 } },
];
/* ボスの大技。予告(地面の印)→発動の2段。形は4つ:
     fan    = 正面の扇(range=奥行き / fanAngleDeg=開き)
     circle = 自分中心の円(range=半径 / knock=吹き飛ばし距離)
     meteor = 相手の周りに count 個の円が stagger 秒ずつずれて落ちる(spread=散らばり / range=1個の半径)
     charge = 相手へ向かって一直線に突進(length=距離 / speed=速さ。予告は通り道に並ぶ円)
   minDist/maxDist = この技を選ぶ相手との距離 / w=選ばれやすさ / rageOnly=怒ってから使う
   **fan / circle(自分中心)の range と minDist / maxDist は体の縁から測る**(実際の値 = 表の値 + ボスの半径)。
   巨体の大きさが違っても「体からどこまで届くか」が同じになるように。 */
const EXPLORE_BOSS_MOVES = {
  swipe:  { name:'薙ぎ払い',   shape:'fan',    range:560,  fanAngleDeg:110, dmg:30, telegraph:0.85, maxDist:700,  w:3 },
  breath: { name:'ブレス',     shape:'fan',    range:1350, fanAngleDeg:34,  dmg:40, telegraph:1.25, minDist:260, maxDist:1400, w:3, color:'#ff8a1a' },
  stomp:  { name:'踏み鳴らし', shape:'circle', range:440,  dmg:34, telegraph:1.00, maxDist:560, knock:260, w:3 },
  meteor: { name:'岩石落とし', shape:'meteor', count:3, spread:240, range:110, dmg:36, telegraph:1.35, stagger:0.25, w:2 },
  rain:   { name:'流星群',     shape:'meteor', count:6, spread:560, range:90, dmg:32, telegraph:1.40, stagger:0.18, w:2, rageOnly:true },
  charge: { name:'突進',       shape:'charge', length:1250, speed:1500, dmg:44, telegraph:1.05, minDist:320, maxDist:1500, knock:320, w:3, color:'#c8101c', pattern:'arrows' },
  nova:   { name:'大爆発',     shape:'circle', range:950,  dmg:58, telegraph:2.00, maxDist:900, knock:420, w:1, rageOnly:true },
};
const EXPLORE_BOSS_NEST_RADIUS    = 650;   // 巣の広さ(岩を空ける・眠って回復する範囲)
const EXPLORE_BOSS_NEST_OFFSET    = 0.5;   // 巣の既定の位置: 地域の中心からキャンプと反対側へ、地域の半径×この比
const EXPLORE_BOSS_ENGAGE_RANGE   = 1300;  // これより近づくと咆哮して戦いが始まる(攻撃を当てても始まる)
const EXPLORE_BOSS_LEASH          = 3200;  // 巣からプレイヤーがこれより離れたら諦めて巣へ戻る
const EXPLORE_BOSS_HOME_REGEN     = 0.02;  // 諦めて巣へ戻る間の回復(最大HPに対する毎秒)
const EXPLORE_BOSS_ROAR_SEC       = 2.2;   // 登場の咆哮の長さ(大技を撃たない)
const EXPLORE_BOSS_RAGE_ROAR_SEC  = 1.4;   // 怒ったときの咆哮の長さ
const EXPLORE_BOSS_ROAR_SLOW_RANGE= 800;   // 咆哮で耳をふさぐ(短い鈍足)範囲
const EXPLORE_BOSS_ROAR_SLOW_SEC  = 0.9;
const EXPLORE_BOSS_RAGE_HP        = 0.5;   // この割合を切ると怒る
const EXPLORE_BOSS_RAGE           = { speed:1.25, gap:0.7, dmg:1.15, telegraph:0.85 };   // 怒り中の倍率
const EXPLORE_BOSS_FLEE_HP        = 0.2;   // この割合を切ると足を引きずって巣へ逃げる(1回だけ)
const EXPLORE_BOSS_LIMP_SPEED     = 0.55;  // 足を引きずる速さ(素の速さに対する比)
const EXPLORE_BOSS_SLEEP_SEC      = 10;    // 巣で眠る長さ(起こされなければ)
const EXPLORE_BOSS_SLEEP_HEAL     = 0.12;  // 眠って回復する量(最大HPに対する比・眠り全体で)
const EXPLORE_BOSS_SLEEP_DMG_MULT = 2;     // 眠っているところへの最初の一撃の倍率(起きる)
const EXPLORE_BOSS_TOPPLE_SEC     = 2.2;   // 部位破壊で転倒している長さ
const EXPLORE_BOSS_TOPPLE_DMG_MULT= 1.25;  // 転倒中に受けるダメージの倍率
const EXPLORE_BOSS_BREAK_BODY_RATIO = 0.3; // 弱点以外への命中が部位破壊の蓄積に入る割合(弱点は1)
/* 弱点(頭)。**狙撃担当(sniper.js)との約束:**
     ent.weakPoint = { from, to, mult } … 体の高さ(exploreBodyHeight(ent))に対する比の範囲と倍率。
     命中した高さ z が ent.z + from×高さ 〜 ent.z + to×高さ に入れば弱点(exploreIsWeakPointHit)。
     弱点に当たったら applyDamage の opts に weakPoint:true を付ける。**倍率は狙撃側で掛けない**
     (explore.js の exploreDmgTakenMult が1か所で掛ける。二重に掛けない) */
const EXPLORE_BOSS_WEAK_POINT     = { from:0.62, to:1.0, mult:1.5 };
const EXPLORE_BOSS_KILL_SLOWMO    = { scale:0.2, holdSec:0.9, easeSec:0.6 };   // 討伐の瞬間の間(実時間の秒)
const EXPLORE_BOSS_DYING_SEC      = 3.2;   // 倒れてから姿が消えるまで(試合内の秒)
const EXPLORE_BOSS_HP_BAR_RANGE   = 3400;  // 戦っているボスのHPバーを出す距離
/* 登場の視点演出(咆哮 intro のときだけ)。turnSec でボスへ向き直り、zoomSec のあいだ zoom 倍に寄る。
   上下の黒帯は画面の高さ×bar。寄せは world.js の setViewZoom(狙撃と同じ入口)で、構え中は狙撃を優先する */
const EXPLORE_BOSS_CINE           = { turnSec:0.4, zoomSec:1.2, zoom:1.8, bar:0.1, dimSec:1.6 };
// 討伐の視点演出(同じ仕組み)。崩れ落ちる0.8秒を画面の中央で見せる。討伐完了の札は崩れ終わってから出る
const EXPLORE_BOSS_HUNT_CINE      = { turnSec:0.35, zoomSec:2.0, zoom:1.15, bar:0.09, dimSec:2.2, lookZ:0.9 };   // lookZ: 体の高さのどこを画面の中央にするか(高いほどボスが画面の下寄り=上の札と重ならない)
// 弱点命中の数字(照準の近く。画面の画素で固定サイズ・秒数)。狙撃のスコープ中は狙撃側が出すので出さない
const EXPLORE_WEAK_POP            = { px:32, sec:1.2, dx:58, dy:-44 };
const EXPLORE_BOSS_TOPPLE_SQUASH  = 0.92;  // 部位破壊のひるみの縦の潰し(潰さず、のけぞりで見せる)
/* 地面の印(予告)の塗り: カメラに近いほど薄くして縁の線だけ残す [薄くし始める距離, 普通の濃さになる距離]
   ・急な斜面の塗りも弱める(斜面に板のように貼り付いて見える=批評指摘) */
const EXPLORE_TELEGRAPH_NEAR      = [220, 900];
const EXPLORE_TELEGRAPH_NEAR_BAND = [40, 320];   // 突進の帯(細いので手前も濃いまま近くまで見せる)
const EXPLORE_BOSS_RAGE_CINE      = { turnSec:0, zoomSec:0.7, zoom:1.18, bar:0, dimSec:0, lookZ:0.5, noPitch:true };   // 怒りの咆哮の一瞬の寄り
const EXPLORE_BODY_POP_PX         = 22;   // ボスの体に当てた数字(白)の大きさ(画面の画素)
const EXPLORE_AIM_CLEAR           = { w:170, h:120 };   // 照準の周りの文字を出さない範囲(画面の画素)
/* ボス戦の間の視点の補正: ボスの頭が画面上部のHUD(exploreHudBand の下端)+margin より上に出たら、
   視点を上げて(見上げて)引く。pitchRate=角度の追従の速さ / backMax=引く最大距離 */
const EXPLORE_BOSS_FRAME          = { margin:28, pitchRate:5, pitchMax:0.45, backMax:110, backRate:3 };
const EXPLORE_BOSS_FLAT_TRIES     = 36;    // 巣の中で平らな立ち位置を探す候補の数
const EXPLORE_BOSS_FIGHT_PILLAR_A = 0.22;  // ボス戦の間、縄張りの中の光の柱の濃さ
const EXPLORE_BOSS_HUNT_CAM       = { dist:3.6, extra:320, rise:0.55, tries:[0,0.35,-0.35,0.7,-0.7,1.05,-1.05] };   // 討伐の視点: ボスから半径×dist+extra 離れた障害物の無い所
const EXPLORE_WILD_NAME_PX        = 13;    // 群れの長の名札(画面の画素。最低12)   // 転倒で縦に潰す割合(小さいほど潰れる。傾きと揺れで倒れた感じを出す)
/* 大技の予告の見え方(real3d_zone.js の地面の印へ渡す)。
   outline = 暗い太い外縁の色 / minContrast = 地面との明るさの差がこれ未満なら白(暗い地面)か赤(明るい地面)へ寄せる */
const EXPLORE_TELEGRAPH           = { outline:'#160806', minContrast:0.35, towardLight:'#ffffff', pushLight:0.6, towardDark:'#d0101e', pushDark:0.85 };
const EXPLORE_METEOR_FALL_H       = 620;   // 流星群・岩石落としの岩が落ち始める高さ(予告の間に降ってくる)
const EXPLORE_BOSS_RAGE_STEP_SHAKE= 0.22;  // 怒り中の一歩ごとの画面の揺れ(近いほど強い)
const EXPLORE_BOSS_BREATH_EVERY   = 2.4;   // 怒り中に口元から白い息を吐く間隔(秒)

/* ===== 落とし物(倒したときに何を落とすか)。落とす処理は explore.js の exploreDropLoot 1つを通す =====
   形: { rolls:抽選回数, items:[{ key, w:重み, n:[最小,最大] }], always:[{ key, n:[最小,最大] }] }
   キーの決まり: 'wild_<地域id>' / 'boss_<ボスid>' / 'break_<ボスid>'(部位破壊) */
const EXPLORE_DROP_TABLES = {
  wild_meadow:  { rolls:1, items:[ { key:'meadow_fiber', w:74, n:[1,2] }, { key:'meadow_honey', w:13 }, { key:'meadow_plume', w:13 } ] },
  wild_frost:   { rolls:1, items:[ { key:'frost_shard',  w:70, n:[1,2] }, { key:'frost_dew',    w:15 }, { key:'frost_hide',   w:15 } ] },
  wild_volcano: { rolls:1, items:[ { key:'volcano_ore',  w:66, n:[1,3] }, { key:'volcano_heart', w:34 } ] },
  wild_jungle:  { rolls:2, items:[ { key:'jungle_vine',  w:62, n:[1,3] }, { key:'jungle_relic', w:38 } ] },
  boss_gandrock:  { rolls:3, always:[ { key:'boss_horn', n:[2,3] } ],
                    items:[ { key:'meadow_fiber', w:40, n:[2,4] }, { key:'meadow_honey', w:25, n:[1,2] }, { key:'meadow_plume', w:25, n:[1,2] }, { key:'boss_horn', w:10 } ] },
  break_gandrock: { rolls:1, always:[ { key:'boss_horn', n:[1,1] } ], items:[ { key:'meadow_honey', w:1 } ] },
  boss_galvark:   { rolls:3, always:[ { key:'boss_fang', n:[2,3] } ],
                    items:[ { key:'frost_shard', w:40, n:[2,4] }, { key:'frost_dew', w:25, n:[1,2] }, { key:'frost_hide', w:25, n:[1,2] }, { key:'boss_fang', w:10 } ] },
  break_galvark:  { rolls:1, always:[ { key:'boss_fang', n:[1,1] } ], items:[ { key:'frost_dew', w:1 } ] },
  boss_volgreim:  { rolls:3, always:[ { key:'boss_scale', n:[2,3] } ],
                    items:[ { key:'volcano_ore', w:45, n:[2,4] }, { key:'volcano_heart', w:40, n:[1,2] }, { key:'boss_scale', w:15 } ] },
  break_volgreim: { rolls:1, always:[ { key:'boss_scale', n:[1,1] } ], items:[ { key:'volcano_heart', w:1 } ] },
  boss_gidravers: { rolls:4, always:[ { key:'apex_core', n:[1,1] } ],
                    items:[ { key:'life_crystal', w:18 }, { key:'boss_horn', w:22 }, { key:'boss_fang', w:22 }, { key:'boss_scale', w:22 }, { key:'jungle_relic', w:16, n:[2,3] } ] },
  break_gidravers:{ rolls:1, items:[ { key:'life_crystal', w:35 }, { key:'apex_core', w:15 }, { key:'jungle_relic', w:50, n:[2,3] } ] },
};
const EXPLORE_DROP_LEADER_ROLLS   = 1;     // 群れのリーダーは抽選が1回多い
// 地面にそのまま撒く回復・ガッツ(通常の試合と同じ品)。ルートの主役は補給箱(下の EXPLORE_CRATE_*)なので少なめ
const EXPLORE_CAMP_LOOT_COUNT     = 10;    // ベースキャンプの周り
const EXPLORE_REGION_LOOT_COUNT   = 10;    // 各地域
// ゴールド報酬(持ち帰ったぶんで計算する)
const EXPLORE_GOLD_BASE           = 30;    // 参加ぶん
const EXPLORE_GOLD_PER_KILL       = 4;     // 野生を1体倒すごと
const EXPLORE_GOLD_RETURN_BONUS   = 60;    // 帰還ビーコンで帰ったときの上乗せ
const EXPLORE_GOLD_PER_RARITY     = { common:2, rare:6, epic:18, legendary:50 };   // 持ち帰った素材1個ごと
const EXPLORE_STASH_STORAGE_KEY   = 'aramon_explore_stash_v1';   // 探検専用の保管(ボス素材など)。アカウント同期する

/* レア度。色は APEX の白・青・紫・金。光の柱・通知・結果画面の枠はすべてここを読む(決め打ちしない) */
const EXPLORE_RARITY = {
  common:    { label:'コモン',     color:'#e8e8e8', order:0 },
  rare:      { label:'レア',       color:'#4fa3ff', order:1 },
  epic:      { label:'エピック',   color:'#b36bff', order:2 },
  legendary: { label:'レジェンド', color:'#ffc93c', order:3 },
};

/* 4つの地域(ベースキャンプを囲む)。**地域の位置・広さ・色のヒントはこの表が正。**
   フィールド生成(world.js の exploreGenWorld)・3Dの見た目(real3d_explore.js)・野生の配置・
   HUDの地域名は、すべてここを読む。1行足せば地域が増える作りにしておく。
     xr/yr/rr = 中心と半径(ワールドに対する比)。**位置の正は EXPLORE_FIELD_LAYOUT.regions**で、
                ここでは写し取るだけ(exploreRegionFromLayout)。半径は野生・補給箱を撒く範囲なので
                地域の混ざり半径より内側(EXPLORE_REGION_SCATTER_K)にする
     danger = 危険度★(1〜4)。野生の強さと落とす物の良さが上がる
     wild   = 出る野生モンスターの属性(ELEMENTS のキー)
     theme  = 色のヒント(ground=地面 / grass=植生 / fog=霞 / sky=空 / accent=目印の光) */
function exploreRegionFromLayout(r){
  const g = EXPLORE_FIELD_LAYOUT.regions[r.id];
  return { ...r, xr: g.x/WORLD_BASE_SIZE, yr: g.y/WORLD_BASE_SIZE, rr: g.radius*EXPLORE_REGION_SCATTER_K/WORLD_BASE_SIZE };
}
const EXPLORE_REGION_SCATTER_K = 0.8;   // 撒く範囲 = 配置表の地域の半径 × これ
const EXPLORE_REGIONS = [
  { id:'meadow',  name:'草原の盆地', icon:'🌾', danger:1,
    wild:['mocchi','suezo','hum','centaur'],
    theme:{ ground:'#6f9a3e', grass:'#8fc44f', fog:'#d8ecc4', sky:'#9fd3ff', accent:'#c8f27a' } },
  { id:'frost',   name:'凍った高地', icon:'❄️', danger:2,
    wild:['aqua','ark','fox','god'],
    theme:{ ground:'#dfe9f2', grass:'#9fb8c9', fog:'#e8f2fb', sky:'#b9d8f2', accent:'#8fe6ff' } },
  { id:'volcano', name:'火山の峡谷', icon:'🌋', danger:3,
    wild:['fire','phoenix','rock','ogre'],
    theme:{ ground:'#4a2a1a', grass:'#6b3b22', fog:'#8a5a44', sky:'#e0906a', accent:'#ff6b2e' } },
  { id:'jungle',  name:'密林の遺跡', icon:'🗿', danger:4,
    wild:['leaf','warm','narga','zan','pixie'],
    theme:{ ground:'#23421f', grass:'#2f6b2a', fog:'#6f8f6a', sky:'#8fb8a0', accent:'#7dffb0' } },
].map(exploreRegionFromLayout);
function exploreRegion(id){ return EXPLORE_REGIONS.find(r=> r.id === id) || null; }
// 地域の中心と半径(ワールド座標)。WORLD は試合ごとに applyWorldScale で変わるので、その都度計算する
function exploreRegionCircle(r){
  return { x: WORLD.w * r.xr, y: WORLD.h * r.yr, r: WORLD.w * r.rr };
}
// その地点がどの地域か(ベースキャンプの中なら null)。HUDの地域名・ミニマップが読む。
// 境目の判定はフィールドの見た目と同じ重み(exploreRegionWeights)を使う
function exploreRegionAt(x, y){
  const w = exploreRegionWeights(x, y);
  if(w[4] > 0.5) return null;
  return exploreRegion(exploreRegionKeyAt(x, y));
}

/* 素材。**レア度・行き先・説明はこの表が正**(結果画面・通知・保管の一覧はすべてここから作る)。
     region = 落ちる地域(ボス素材は 'boss')
     toBag  = 持ち帰ったときに換わる PLAYER_ITEMS のキー。無いものは探検専用の保管へ入る
              (ボス素材は工房で装備に使う ―― 工房は段2で作る) */
const EXPLORE_MATERIALS = {
  // 草原の盆地
  meadow_fiber:  { name:'草原の繊維',   icon:'🌾', rarity:'common', region:'meadow',  desc:'盆地の草から取れるしなやかな繊維。装備の下地になる' },
  meadow_honey:  { name:'盆地の蜜',     icon:'🍯', rarity:'rare',   region:'meadow',  toBag:'seed_life',     desc:'持ち帰るとライフの実になる' },
  meadow_plume:  { name:'風切り羽',     icon:'🪶', rarity:'rare',   region:'meadow',  toBag:'seed_evasion',  desc:'持ち帰ると回避の実になる' },
  // 凍った高地
  frost_shard:   { name:'氷晶のかけら', icon:'❄️', rarity:'common', region:'frost',   desc:'溶けない氷。冷気をまとう装備の材料' },
  frost_dew:     { name:'オーロラの雫', icon:'💧', rarity:'rare',   region:'frost',   toBag:'seed_wisdom',   desc:'持ち帰るとかしこさの実になる' },
  frost_hide:    { name:'霜の毛皮',     icon:'🧥', rarity:'rare',   region:'frost',   toBag:'seed_vitality', desc:'持ち帰ると丈夫さの実になる' },
  // 火山の峡谷
  volcano_ore:   { name:'灼熱鉱石',     icon:'🪨', rarity:'common', region:'volcano', desc:'熱を帯びた鉱石。武器の芯になる' },
  volcano_heart: { name:'炎の核',       icon:'🔥', rarity:'rare',   region:'volcano', toBag:'seed_power',    desc:'持ち帰るとちからの実になる' },
  // 密林の遺跡
  jungle_vine:   { name:'古代の蔓',     icon:'🌿', rarity:'common', region:'jungle',  desc:'遺跡に絡みつく丈夫な蔓' },
  jungle_relic:  { name:'遺跡の欠片',   icon:'🗿', rarity:'rare',   region:'jungle',  toBag:'seed_accuracy', desc:'持ち帰ると命中の実になる' },
  // ボス素材(段2のボスが落とす)
  boss_horn:     { name:'大角',         icon:'🦴', rarity:'epic',      region:'boss', desc:'地域の主の角。工房で装備に使う' },
  boss_scale:    { name:'紅蓮の鱗',     icon:'🐉', rarity:'epic',      region:'boss', desc:'炎に焼かれない鱗。工房で装備に使う' },
  boss_fang:     { name:'氷河の牙',     icon:'🦷', rarity:'epic',      region:'boss', desc:'凍てつく牙。工房で装備に使う' },
  apex_core:     { name:'頂点の心核',   icon:'💠', rarity:'legendary', region:'boss', desc:'頂点に立つ者の心臓。最上級の装備に使う' },
  life_crystal:  { name:'生命の結晶',   icon:'💎', rarity:'legendary', region:'boss', toBag:'fruit_life', desc:'持ち帰ると生命の果実になる' },
};
/* 倒した(部位を壊した)相手から、落とし物の表を1つ選ぶ。**何を落とすかの正は EXPLORE_DROP_TABLES。**
     kind = 'kill'(倒した) / 'break'(部位破壊)
   野生は地域の表(リーダーは抽選 +EXPLORE_DROP_LEADER_ROLLS)、ボスは表の drops / breakDrops。 */
function exploreDropTable(ent, kind){
  if(!ent) return null;
  if(ent.isExploreBoss){
    const def = EXPLORE_BOSSES.find(b=> b.id === ent.exBossId);
    if(!def) return null;
    return EXPLORE_DROP_TABLES[kind === 'break' ? def.breakDrops : def.drops] || null;
  }
  const base = EXPLORE_DROP_TABLES['wild_' + ent.exploreRegion];
  if(!base) return null;
  return ent.exLeader ? { ...base, rolls:(base.rolls||1) + EXPLORE_DROP_LEADER_ROLLS } : base;
}
// 表を振って [{ key, n }] を返す(同じ素材はまとめる)。表の中身だけで決まる純関数
function exploreRollDropTable(table){
  if(!table) return [];
  const got = {};
  const add = (e)=>{
    if(!e || !EXPLORE_MATERIALS[e.key]) return;
    const n = e.n ? randInt(e.n[0], e.n[1]) : 1;
    got[e.key] = (got[e.key] || 0) + n;
  };
  for(const e of (table.always || [])) add(e);
  const items = table.items || [];
  const total = items.reduce((s, e)=> s + (e.w || 0), 0);
  for(let i=0; i<(table.rolls || 0) && total > 0; i++){
    let r = Math.random() * total;
    for(const e of items){ r -= (e.w || 0); if(r <= 0){ add(e); break; } }
  }
  return Object.keys(got).map(key=> ({ key, n:got[key] }));
}
function exploreMaterialColor(key){
  const m = EXPLORE_MATERIALS[key];
  return (m && EXPLORE_RARITY[m.rarity]) ? EXPLORE_RARITY[m.rarity].color : EXPLORE_RARITY.common.color;
}

/* 探検専用の保管(toBag を持たない素材の置き場)。形は { 素材キー: 個数 }。
   **アカウント同期する**(ui.js の ACCOUNT_SYNC_KEYS に入れてある)。知らないキー・壊れた値は読み捨てる。 */
function loadExploreStash(){
  try{
    const d = JSON.parse(localStorage.getItem(EXPLORE_STASH_STORAGE_KEY)) || {};
    const out = {};
    for(const k of Object.keys(d)){
      const n = Math.max(0, Math.floor(Number(d[k]) || 0));
      if(EXPLORE_MATERIALS[k] && n > 0) out[k] = n;
    }
    return out;
  }catch(err){ return {}; }
}
function saveExploreStash(s){
  try{ localStorage.setItem(EXPLORE_STASH_STORAGE_KEY, JSON.stringify(s || {})); }catch(err){}
  if(typeof accountMarkDirty==='function') accountMarkDirty();
}
function addExploreStash(key, n){
  if(!EXPLORE_MATERIALS[key]) return;
  const s = loadExploreStash();
  s[key] = (s[key] || 0) + Math.max(0, Math.floor(n || 0));
  saveExploreStash(s);
}

/* =====================================================================
   探検モード: ルート(補給箱・落ちている品・光の柱)
   ・置く/開ける/散らす/拾う/描くのは explore_loot.js。ここは数値と表だけ。
   ・レア度の色は上の EXPLORE_RARITY が正(光の柱・通知・工房の枠がすべてそこを読む)。
   ===================================================================== */
// 補給箱の数(地域ごと。表に無い地域は _DEFAULT)
const EXPLORE_CRATE_PER_REGION         = { meadow:6, frost:6, volcano:6, jungle:6 };
const EXPLORE_CRATE_PER_REGION_DEFAULT = 5;
const EXPLORE_CRATE_CAMP_COUNT    = 2;      // ベースキャンプの中(出発してすぐ目に入る位置。最初の「開ける」を覚える)
const EXPLORE_CRATE_MIN_GAP       = 520;    // 補給箱どうしの最小の間隔
const EXPLORE_CRATE_NEST_CLEAR    = 520;    // ボスの巣(半径)のさらにこの外まで補給箱を置かない(ボス戦の場を散らかさない)
const EXPLORE_CRATE_OPEN_RANGE    = 120;    // 箱の中心からこの距離にとどまると開き始める
const EXPLORE_CRATE_OPEN_SEC      = 0.6;    // とどまって開くまでの秒数(離れると進みは倍の速さで戻る)
const EXPLORE_CRATE_LID_SEC       = 0.38;   // 蓋が開ききるまでの秒数
const EXPLORE_CRATE_SCATTER       = [70, 190];     // 中身が散らばる距離(最小・最大)
const EXPLORE_CRATE_FLIGHT_SEC    = [0.55, 0.85];  // 中身が弾けて地面に落ちるまでの秒数(最小・最大)
const EXPLORE_CRATE_BURST_GAP     = 0.07;   // 中身が1個ずつ飛び出す間隔(秒)
const EXPLORE_CRATE_ITEMS         = { common:[3,4], rare:[3,4], epic:[4,5], legendary:[5,6] };   // 1箱の中身の数(最小・最大)
const EXPLORE_CRATE_SIZE          = { w:66, d:46, h:36, lid:13 };   // 箱の寸法(ワールド単位。見た目だけ)
const EXPLORE_CRATE_BIG_SCALE     = { epic:1.4, legendary:1.4 };   // 紫・金の箱はこの倍率で大きい(レア度の色の金属の蓋と角飾り)
const EXPLORE_CRATE_BEACON_H      = { epic:560, legendary:760 };   // 閉じた紫・金の箱の上に立つ光の高さ(1500以上離れても見える)
/* 地面にそのまま落ちている品(箱の外)。拾う物は補給箱と同じ光の柱とレア度で見せる(exploreSpawnDrop)。
   キャンプの周りと各地域に EXPLORE_CAMP_LOOT_COUNT / EXPLORE_REGION_LOOT_COUNT 個ずつ */
const EXPLORE_GROUND_LOOT = [ {w:36, item:'heal_s'}, {w:16, item:'heal_m'}, {w:4, item:'heal_l'}, {w:30, item:'guts'}, {w:14, mat:'common'} ];
const EXPLORE_CRATE_VIEW          = 3800;   // 補給箱を描く距離
/* 箱のレア度の抽選(地域の危険度★ごとの重み)。キャンプの箱は 0 の行 */
const EXPLORE_CRATE_RARITY_BY_DANGER = {
  0: { common:80, rare:20, epic:0,  legendary:0 },
  1: { common:55, rare:35, epic:9,  legendary:1 },
  2: { common:45, rare:38, epic:14, legendary:3 },
  3: { common:35, rare:40, epic:20, legendary:5 },
  4: { common:25, rare:40, epic:27, legendary:8 },
};
/* 素材以外の落ちている品。名前は元の表が正(回復=HEAL_ITEMS / ガッツ飴=GUTS_ITEM)なので書かない。
   狙撃銃・スコープの ref は sniper.js の SNIPER_WEAPONS / SNIPER_SCOPES のキー(拾うと sniperGive / sniperAttachScope)。 */
const EXPLORE_FIELD_ITEMS = {
  heal_s:  { kind:'heal',   ref:'oilS',    icon:'🧴', rarity:'common' },
  heal_m:  { kind:'heal',   ref:'oilM',    icon:'🧴', rarity:'rare' },
  heal_l:  { kind:'heal',   ref:'oilL',    icon:'🧴', rarity:'epic' },
  guts:    { kind:'guts',                  icon:'🍬', rarity:'common' },
  longbow: { kind:'weapon', ref:'longbow', icon:'🏹', rarity:'rare',   name:'ロングボウ(狙撃銃)' },
  scope2x: { kind:'scope',  ref:'x2', icon:'🔭', name:'2倍スコープ' },   // レア度は SNIPER_SCOPES が正
  scope4x: { kind:'scope',  ref:'x4', icon:'🔭', name:'4倍スコープ' },   // レア度は SNIPER_SCOPES が正
  scope8x: { kind:'scope',  ref:'x8', icon:'🔭', name:'8倍スコープ' },   // レア度は SNIPER_SCOPES が正
};
/* 補給箱の中身(箱のレア度ごと・重み付き)。
     mat:'<レア度>' … そのレア度の素材を「箱のある地域」から引く。epic/legendary はボス素材(region:'boss')
     item:'<キー>'  … EXPLORE_FIELD_ITEMS の品
   1個目は必ず EXPLORE_CRATE_HEAD(箱と同じレア度の目玉)。残りをこの表から引く。 */
const EXPLORE_CRATE_LOOT = {
  common:    [ {w:34, mat:'common'}, {w:10, mat:'rare'}, {w:20, item:'heal_s'}, {w:8, item:'heal_m'}, {w:16, item:'guts'},
               {w:6, item:'scope2x'}, {w:3, item:'longbow'} ],
  rare:      [ {w:26, mat:'common'}, {w:22, mat:'rare'}, {w:12, item:'heal_m'}, {w:4, item:'heal_l'}, {w:12, item:'guts'},
               {w:8, item:'scope4x'}, {w:6, item:'longbow'}, {w:4, item:'scope2x'} ],
  epic:      [ {w:18, mat:'common'}, {w:26, mat:'rare'}, {w:12, mat:'epic'}, {w:10, item:'heal_l'}, {w:10, item:'guts'},
               {w:8, item:'scope8x'}, {w:8, item:'scope4x'}, {w:6, item:'longbow'} ],
  legendary: [ {w:10, mat:'common'}, {w:24, mat:'rare'}, {w:24, mat:'epic'}, {w:6, mat:'legendary'}, {w:10, item:'heal_l'},
               {w:8, item:'guts'}, {w:10, item:'scope8x'}, {w:6, item:'longbow'} ],
};
const EXPLORE_CRATE_HEAD = { common:{mat:'common'}, rare:{mat:'rare'}, epic:{mat:'epic'}, legendary:{mat:'legendary'} };
// 光の柱(落ちている品の上に立つ。遠くから価値が分かる)。高さ・太さはワールド単位
// 光の柱はレア度で段階的に太く高く(金がいちばん太く、根元に輪)。見ただけで価値の順が分かるように
const EXPLORE_PILLAR_HEIGHT       = { common:210, rare:320, epic:450, legendary:640 };
/* 太さの差は1.5倍まで(金の柱が視界をふさぐ壁になった=批評指摘)。レア度の差は明るさ・周りを舞う粒・根元の輪で付ける */
const EXPLORE_PILLAR_WIDTH        = { common:10,  rare:11,  epic:13,  legendary:15 };
const EXPLORE_PILLAR_MIN_PX       = { common:2.6, rare:2.8, epic:3.3, legendary:3.9 };   // 遠くでも柱がこの太さ(画面px)より細くならない
const EXPLORE_PILLAR_GLOW         = { common:0.42, rare:0.55, epic:0.7, legendary:0.9 };  // 柱の明るさ
const EXPLORE_PILLAR_MOTES        = { common:0, rare:2, epic:4, legendary:7 };            // 柱の周りを螺旋に昇る光の粒の数
/* 補給箱を開けた瞬間: 中身がレア度の枠付きアイコンになって箱の上に扇形に並び(rise→hold)、そこから地面へ飛ぶ */
const EXPLORE_CRATE_FAN           = { rise:0.28, hold:0.85, lift:95, gap:44, arc:18 };   // 秒 / 箱の上の高さ・間隔・弧の反り(ワールド単位)
const EXPLORE_DROP_BADGE          = { common:15, rare:17, epic:20, legendary:25 };   // 落ちている品のしるし(アイコン)の大きさ(ワールド単位の半径)
const EXPLORE_DROP_FLOAT          = 34;     // しるしを地面から浮かせる高さ(ワールド単位)
const EXPLORE_PILLAR_VIEW         = 6500;   // 光の柱が見える距離
const EXPLORE_PILLAR_RING_DEPTH   = 950;    // これより近いと地面に輪を出す
const EXPLORE_DROP_ITEM_VIEW      = 1700;   // 品物そのもの(アイコン)を描く距離
const EXPLORE_DROP_LABEL_RANGE    = 280;    // プレイヤーがこの距離まで近づくと名前を出す
const EXPLORE_DROP_PICK_RANGE     = 40;     // 拾う距離(モンスターの半径に足す)
const EXPLORE_DROP_ARM_SEC        = 0.25;   // 地面に落ちてから拾えるようになるまで(飛んでいる途中で吸い込まない)
// 拾った通知(画面左に積み上がるレア度色の行)
const EXPLORE_FEED_MAX            = 6;      // 同時に出す行数の上限(入らない分は「+N件」の1行にまとめる)
const EXPLORE_FEED_SEC            = 3.4;    // 1行の表示秒数
const EXPLORE_FEED_MERGE_SEC      = 1.5;    // この秒数以内に同じ品を拾ったら行を増やさず個数をまとめる

/* =====================================================================
   探検モード: HUD(方位バー・目標・ミニマップ・全体地図・ボスの札)と音(地域の環境曲・ボス戦・環境音)
   描く・鳴らすのは explore_hud.js / explore.js(ボスの札) / audio.js(探検のBGM)。ここは数字だけ。
   距離の表示は PING_UNITS_PER_M(ワールド10単位=1m)で換算する。
   ===================================================================== */
// 方位バー(画面上部中央。APEX)
const EXPLORE_COMPASS_SPAN_DEG    = 150;    // バーの端から端までに入る角度(広いほど目盛りが詰まる)
const EXPLORE_COMPASS_H           = 46;     // バーの高さ(px。倍率 EXPLORE_HUD_SCALE を掛ける前)。CSS は JS が --exp-hud-k から決める
/* HUDの文字・欄の大きさの倍率。画面の縦(論理px)から決める: 倍率 = 縦 / BASE_H(1〜MAX)。
   縦持ち・横持ちで同じ端末なら論理の縦は同じなので、持ち方で文字サイズは変わらない(narrow-screen では分けない)。
   1624x750 のような大きい画面で文字が豆粒にならないようにするためのもの */
const EXPLORE_HUD_BASE_H          = 375;
const EXPLORE_HUD_MAX_SCALE       = 1.5;
const EXPLORE_COMPASS_CRATE_RANGE = 2600;   // この距離より近い補給箱(未開封)だけバーに出す
const EXPLORE_COMPASS_CRATE_MAX   = 4;      // バーに出す補給箱の数(近い順)
const EXPLORE_COMPASS_THREAT_RANGE= 1600;   // 気づいて追ってくる野生をバーに赤い印で出す距離
const EXPLORE_COMPASS_LABEL_RANGE = 99999;  // 距離(m)の数字を出す上限(ビーコン・ボス・目標は遠くても出す)
// 目標(クエスト)パネル
const EXPLORE_OBJ_MATERIAL_GOAL   = 15;     // 「素材を集める」の目安の個数(報酬は無い。HUDの目安だけ)
const EXPLORE_OBJ_RETURN_WARN_SEC = 120;    // 残り時間がこれを切ったら「帰還」を優先の目標にする
const EXPLORE_OBJ_DONE_FLASH_SEC  = 2.2;    // 達成した目標を光らせる秒数
// 地域に入ったときの名前の札
const EXPLORE_REGION_CARD_SEC     = 2.8;
// ミニマップ(探検のときだけ)・全体地図
const EXPLORE_MINIMAP_RADIUS      = 3000;   // ミニマップの中心から縁までのワールド距離(300m)
const EXPLORE_MINIMAP_CRATE_RANGE = 3000;   // ミニマップに出す補給箱の距離
const EXPLORE_MAP_BAKE_PX         = 1024;   // 地形を焼いておく画像の一辺(1回だけ描く)
const EXPLORE_MAP_HEIGHT_PX       = 384;    // 地面の高さ(real3dHeightAt)を測る格子の数(一辺)。数フレームに分けて焼く
const EXPLORE_MAP_BAKE_MS         = 6;      // 1フレームで焼きに使ってよい時間(ms)。一瞬の重さを出さない
const EXPLORE_MAP_BAND_H          = 120;    // 高さの段の幅(ワールド単位)。段ごとに平面の色を1段明るくする
const EXPLORE_MAP_CLIFF_SLOPE     = 1.8;    // この傾き(高さ/水平距離)を超えた所を崖の線にする
const EXPLORE_MAP_CRATE_RANGE     = 5000;   // 全体地図に出す補給箱の距離(遠くの箱は見せない)
const EXPLORE_MAP_REDRAW_SEC      = 0.2;    // 全体地図を描き直す間隔(点滅のため)
// ボスの札・HPバーの置き方(縦の割合。R3: 縦が足りないときは 称号の行 → バーの太さ の順に削る)
/* ボスの帯は1行(紋章・名前・状態の札/予告の技名・バー・残り%)。方位バーの真下。
   R3: 縦が足りないときは 二つ名の行(下の小さな1行。縦 titleMinH 以上のときだけ出す)→ 状態の札 → 名前 の順に削る */
const EXPLORE_BOSS_HUD = {
  rowH: 18,          // 1行の高さ(px。倍率を掛ける前)
  barH: 6,           // バーの太さ(px。倍率を掛ける前)
  titleMinH: 520,    // 画面の縦がこれ以上なら二つ名を帯の下に小さく出す
  barMinW: 70,       // バーの最小の長さ。これを割るなら札・名前を削る
  maxW: 620,         // 帯の横幅の上限(px。倍率を掛ける前)
};
// 音(探検のBGM・環境音)。曲の中身は audio.js(EXPLORE_BGM_*)
const EXPLORE_BGM_FADE_SEC        = 1.3;    // 地域の曲の切り替え(setTargetAtTime の時定数。約3倍で入れ替わる)
const EXPLORE_BGM_BOSS_FADE_SEC   = 0.35;   // ボス戦の曲へ切り替える速さ(咆哮で一気に変える)
const EXPLORE_BGM_FANFARE_SEC     = 4.6;    // 討伐のファンファーレの長さ(その間は環境曲を鳴らさない)
const EXPLORE_AMB_VOL             = { wind:0.20, insect:0.055, lava:0.34 };   // 環境音の音量(地域の重み1のとき)
const EXPLORE_AMB_BOSS_DUCK       = 0.35;   // ボス戦の間の環境音の音量(割合)
const EXPLORE_SPOTTED_SE_GAP      = 3.0;    // 群れに気づかれた音を鳴らす最短の間隔(秒)

/* =====================================================================
   探検モード: 装備と工房(鍛冶屋)
   ・**効果は探検モードの中だけで効く**(explore_loot.js の exploreApplyGear を exploreStart だけが呼ぶ)。
     シングル/チーム戦/レイドの力関係は変えない(統括の判断)。
   ・**表に1行足せば工房に並ぶ。** 画面(ui.js の工房)・効果の足し算・セット効果はすべてこの表から作る。
     slot   = EXPLORE_GEAR_SLOTS の id
     set    = EXPLORE_GEAR_SETS のキー(セット効果と色)
     rarity = EXPLORE_RARITY のキー(枠の色・完成演出の色)
     mats   = 必要な素材 { EXPLORE_MATERIALS のキー: 個数 }。**保管(toBag を持たない素材)だけ**を使う
              (toBag を持つ素材は持ち帰った時点でバッグの実に換わっていて保管に残らないため)
     fx     = 効果(EXPLORE_GEAR_STATS のキー: 割合。0.08 = +8%、被ダメは -0.05 = 5%減る)
     sniper = 武器だけ。sniper.js の SNIPER_WEAPONS に足す想定のキー。無ければ標準の狙撃銃(longbow)を持つ
   ===================================================================== */
const EXPLORE_GEAR_STORAGE_KEY = 'aramon_explore_gear_v1';   // { owned:[キー], equip:{スロット:キー} }。アカウント同期する
const EXPLORE_GEAR_SLOTS = [
  { id:'weapon', label:'武器' },
  { id:'head',   label:'頭' },
  { id:'body',   label:'胴' },
  { id:'arms',   label:'腕' },
];
// 効果の言葉と並び順(工房の表示・合計・試合開始時の通知はすべてここを読む)
const EXPLORE_GEAR_STATS = {
  hpPct:        { label:'体力',           short:'体力' },
  dmgTakenPct:  { label:'受けるダメージ', short:'被ダメ', lowerIsBetter:true },
  speedPct:     { label:'移動速度',       short:'速さ' },
  gutsRegenPct: { label:'ガッツ回復',     short:'ガッツ' },
  dmgPct:       { label:'技の威力',       short:'技' },
  snipePct:     { label:'狙撃の威力',     short:'狙撃' },
};
// セット(同じセットの装備を n 個以上着けると bonus の効果が上乗せされる)。color = アイコンの地色
const EXPLORE_GEAR_SETS = {
  scout: { name:'探検者', emblem:'🧭', color:'#c9a36b', bonus:[ { n:3, fx:{ speedPct:0.04 } } ] },
  horn:  { name:'大角',   emblem:'🦴', color:'#efe3c2', bonus:[ { n:2, fx:{ hpPct:0.05 } }, { n:4, fx:{ dmgTakenPct:-0.06 } } ] },
  frost: { name:'氷河',   emblem:'❄️', color:'#8fe6ff', bonus:[ { n:2, fx:{ gutsRegenPct:0.10 } }, { n:4, fx:{ snipePct:0.10 } } ] },
  blaze: { name:'紅蓮',   emblem:'🔥', color:'#ff7a3c', bonus:[ { n:2, fx:{ dmgPct:0.05 } }, { n:3, fx:{ dmgTakenPct:-0.05 } } ] },
  apex:  { name:'頂点',   emblem:'💠', color:'#ffd84a', bonus:[ { n:2, fx:{ hpPct:0.06, dmgPct:0.04 } }, { n:4, fx:{ snipePct:0.15, dmgTakenPct:-0.08 } } ] },
};
const EXPLORE_GEAR = {
  /* 武器の派生の根(補給箱で拾う標準の狙撃銃)。root:true = 工房では作らない・着けない(表の起点として並ぶだけ)。
     from = 派生元(このキーの装備を持っていると作れる。配列ならどれか1つ)。工房の表の線はここから自動で引く
     shape = 武器の形('bow' 弓 / 'rifle' 銃)。アイコンの描き分けに使う */
  longbow:     { slot:'weapon', set:'scout', rarity:'rare', name:'探検者のロングボウ', root:true, shape:'bow', sniper:'longbow', mats:{}, fx:{},
                 note:'補給箱で拾える標準の狙撃銃。工房の武器はここから派生する' },
  // 探検者(コモン素材だけで作れる入門の一式)
  scout_head:  { slot:'head',   set:'scout', rarity:'rare', name:'探検者の帽子',       mats:{ meadow_fiber:4, jungle_vine:2 },                 fx:{ hpPct:0.04 } },
  scout_body:  { slot:'body',   set:'scout', rarity:'rare', name:'探検者のジャケット', mats:{ meadow_fiber:6, frost_shard:2 },                 fx:{ hpPct:0.06 } },
  scout_arms:  { slot:'arms',   set:'scout', rarity:'rare', name:'探検者のグローブ',   mats:{ jungle_vine:4, volcano_ore:2 },                  fx:{ gutsRegenPct:0.06 } },
  // 大角(草原の主)
  horn_bow:    { slot:'weapon', set:'horn',  rarity:'epic', name:'大角の剛弓',   sniper:'hornbow', shape:'bow',   from:'longbow', mats:{ boss_horn:3, volcano_ore:6, meadow_fiber:4 }, fx:{ snipePct:0.15 } },
  horn_head:   { slot:'head',   set:'horn',  rarity:'epic', name:'大角の兜',     mats:{ boss_horn:2, meadow_fiber:6 },                  fx:{ hpPct:0.08 } },
  horn_body:   { slot:'body',   set:'horn',  rarity:'epic', name:'大角の胸当て', mats:{ boss_horn:3, volcano_ore:4 },                   fx:{ hpPct:0.10, dmgTakenPct:-0.03 } },
  horn_arms:   { slot:'arms',   set:'horn',  rarity:'epic', name:'大角の籠手',   mats:{ boss_horn:2, jungle_vine:4 },                   fx:{ dmgPct:0.05 } },
  // 氷河(凍った高地の主)
  frost_rifle: { slot:'weapon', set:'frost', rarity:'epic', name:'氷河の狙撃銃', sniper:'glacier', shape:'rifle', from:'longbow', mats:{ boss_fang:3, frost_shard:8 },         fx:{ snipePct:0.20 } },
  frost_head:  { slot:'head',   set:'frost', rarity:'epic', name:'氷河の頭巾',   mats:{ boss_fang:2, frost_shard:6 },                   fx:{ gutsRegenPct:0.10 } },
  frost_body:  { slot:'body',   set:'frost', rarity:'epic', name:'氷河の外套',   mats:{ boss_fang:3, frost_shard:6, meadow_fiber:3 },   fx:{ hpPct:0.06, speedPct:0.04 } },
  frost_arms:  { slot:'arms',   set:'frost', rarity:'epic', name:'氷河の手甲',   mats:{ boss_fang:2, frost_shard:4 },                   fx:{ speedPct:0.05 } },
  // 紅蓮(火山の峡谷の主)
  blaze_head:  { slot:'head',   set:'blaze', rarity:'epic', name:'紅蓮の角兜',   mats:{ boss_scale:2, volcano_ore:6 },                  fx:{ dmgPct:0.05 } },
  blaze_body:  { slot:'body',   set:'blaze', rarity:'epic', name:'紅蓮の鎧',     mats:{ boss_scale:3, volcano_ore:8 },                  fx:{ dmgTakenPct:-0.08 } },
  blaze_arms:  { slot:'arms',   set:'blaze', rarity:'epic', name:'紅蓮の腕甲',   mats:{ boss_scale:2, volcano_ore:4, jungle_vine:3 },   fx:{ dmgPct:0.06 } },
  // 頂点(頂点ボス)
  apex_bow:    { slot:'weapon', set:'apex',  rarity:'legendary', name:'頂点の魔弾', sniper:'apexbow', shape:'rifle', from:['horn_bow','frost_rifle'], mats:{ apex_core:2, boss_horn:2, boss_fang:2, boss_scale:2 }, fx:{ snipePct:0.30 } },
  apex_head:   { slot:'head',   set:'apex',  rarity:'legendary', name:'頂点の冠',   mats:{ apex_core:1, boss_horn:2, frost_shard:6 },   fx:{ hpPct:0.10, gutsRegenPct:0.08 } },
  apex_body:   { slot:'body',   set:'apex',  rarity:'legendary', name:'頂点の聖鎧', mats:{ apex_core:2, boss_scale:2, volcano_ore:6 },  fx:{ hpPct:0.12, dmgTakenPct:-0.06 } },
  apex_arms:   { slot:'arms',   set:'apex',  rarity:'legendary', name:'頂点の籠手', mats:{ apex_core:1, boss_fang:2, jungle_vine:6 },   fx:{ dmgPct:0.08, speedPct:0.04 } },
};

/* 装備の保管。知らないキー・壊れた値は読み捨てる(表から消した装備を持っていても落ちない) */
function loadExploreGear(){
  const out = { owned:[], equip:{} };
  try{
    const d = JSON.parse(localStorage.getItem(EXPLORE_GEAR_STORAGE_KEY)) || {};
    if(Array.isArray(d.owned)) out.owned = d.owned.filter((k, i, a)=> EXPLORE_GEAR[k] && !EXPLORE_GEAR[k].root && a.indexOf(k) === i);
    const eq = d.equip || {};
    for(const s of EXPLORE_GEAR_SLOTS){
      const k = eq[s.id];
      if(k && EXPLORE_GEAR[k] && EXPLORE_GEAR[k].slot === s.id && out.owned.includes(k)) out.equip[s.id] = k;
    }
  }catch(err){}
  return out;
}
function saveExploreGear(g){
  try{ localStorage.setItem(EXPLORE_GEAR_STORAGE_KEY, JSON.stringify({ owned:(g && g.owned) || [], equip:(g && g.equip) || {} })); }catch(err){}
  if(typeof accountMarkDirty==='function') accountMarkDirty();
}
// 作れるか(足りない素材の一覧も返す)。stash を渡さなければ今の保管を読む
/* 作れるか(足りない素材の一覧も返す)。stash を渡さなければ今の保管を読む。
   派生(from)があれば、派生元のどれか1つを持っていることも条件(根 root は拾う物なので常に満たす) */
function exploreGearFromList(key){
  const g = EXPLORE_GEAR[key];
  if(!g || !g.from) return [];
  return (Array.isArray(g.from) ? g.from : [g.from]).filter(k=> EXPLORE_GEAR[k]);
}
function exploreGearCraftCheck(key, stash, gear){
  const g = EXPLORE_GEAR[key];
  if(!g || g.root) return { ok:false, lack:[], rows:[], fromOk:true, from:[] };
  const s = stash || loadExploreStash();
  const rows = Object.keys(g.mats).map(k=>({ key:k, need:g.mats[k], have:s[k] || 0 }));
  const lack = rows.filter(r=> r.have < r.need);
  const from = exploreGearFromList(key);
  const owned = (gear || loadExploreGear()).owned;
  const fromOk = !from.length || from.some(k=> EXPLORE_GEAR[k].root || owned.includes(k));
  return { ok: lack.length === 0 && fromOk, lack, rows, fromOk, from };
}
// 表の中で見せる短い名前(セット名は行の見出しに出すので「大角の剛弓」→「剛弓」)
function exploreGearShortName(key){
  const g = EXPLORE_GEAR[key];
  if(!g) return '';
  const set = EXPLORE_GEAR_SETS[g.set];
  const pre = set ? set.name + 'の' : '';
  return (pre && g.name.startsWith(pre)) ? g.name.slice(pre.length) : g.name;
}
/* 素材の入手先(工房で足りないときの案内)。**表から自動で作る**(ボスの落とし物・部位破壊・野生・補給箱)。
   返り値: ['ガンドロックの討伐(草原の盆地)', …] 多いものから最大 max 件 */
function exploreMaterialSources(key, max){
  const out = [];
  const inTable = (id)=>{
    const t = (typeof EXPLORE_DROP_TABLES!=='undefined') ? EXPLORE_DROP_TABLES[id] : null;
    if(!t) return false;
    return (t.always || []).some(i=> i.key === key) || (t.items || []).some(i=> i.key === key);
  };
  const regName = (id)=>{ const r = (typeof exploreRegion==='function') ? exploreRegion(id) : null; return r ? r.name : ''; };
  if(typeof EXPLORE_BOSSES!=='undefined') for(const b of EXPLORE_BOSSES){
    const where = regName(b.region);
    if(inTable(b.drops)) out.push(`${b.name}の討伐${where ? `(${where})` : ''}`);
    else if(inTable(b.breakDrops)) out.push(`${b.name}の${b.partName || '部位'}破壊${where ? `(${where})` : ''}`);
  }
  if(typeof EXPLORE_REGIONS!=='undefined') for(const r of EXPLORE_REGIONS){
    if(inTable('wild_' + r.id)) out.push(`${r.name}の野生`);
  }
  const m = EXPLORE_MATERIALS[key];
  if(m && m.region && m.region !== 'boss'){ const n = regName(m.region); if(n) out.push(`${n}の補給箱`); }
  return out.slice(0, max || 3);
}
// 前回の持ち帰り(ロビー右列の表示用。壊れていれば null)
function loadExploreLast(){
  try{ const d = JSON.parse(localStorage.getItem(EXPLORE_LAST_STORAGE_KEY)); return (d && typeof d === 'object') ? d : null; }
  catch(err){ return null; }
}
function saveExploreLast(d){ try{ localStorage.setItem(EXPLORE_LAST_STORAGE_KEY, JSON.stringify(d || null)); }catch(err){} }
// 作る(素材を減らして所持に足す)。作れなければ false。持っている物は作らない
function exploreCraftGear(key){
  const g = EXPLORE_GEAR[key];
  if(!g) return false;
  const gear = loadExploreGear();
  if(gear.owned.includes(key)) return false;
  const s = loadExploreStash();
  if(!exploreGearCraftCheck(key, s).ok) return false;
  for(const k of Object.keys(g.mats)) s[k] = Math.max(0, (s[k] || 0) - g.mats[k]);
  for(const k of Object.keys(s)) if(!(s[k] > 0)) delete s[k];
  saveExploreStash(s);
  gear.owned.push(key);
  // 着けるかどうかは完成の画面で選ばせる(装備する/あとで)。ここでは所持に足すだけ
  saveExploreGear(gear);
  return true;
}
function exploreEquipGear(key){
  const g = EXPLORE_GEAR[key];
  const gear = loadExploreGear();
  if(!g || g.root || !gear.owned.includes(key)) return false;
  gear.equip[g.slot] = key;
  saveExploreGear(gear);
  return true;
}
function exploreUnequipSlot(slotId){
  const gear = loadExploreGear();
  delete gear.equip[slotId];
  saveExploreGear(gear);
}
/* 着けている装備の効果の合計(セット効果込み)。**効果の足し算はここ1か所**(工房の表示と試合の適用が同じ数字を読む)。
   返り値: { fx:{ 効果キー: 合計 }, sets:[{ set, n, active:[bonus…], next:bonus|null }] } */
function exploreGearTotals(equip){
  const fx = {};
  const add = (src)=>{ for(const k of Object.keys(src || {})) fx[k] = (fx[k] || 0) + src[k]; };
  const count = {};
  for(const s of EXPLORE_GEAR_SLOTS){
    const g = EXPLORE_GEAR[(equip || {})[s.id]];
    if(!g) continue;
    add(g.fx);
    count[g.set] = (count[g.set] || 0) + 1;
  }
  const sets = [];
  for(const id of Object.keys(count)){
    const def = EXPLORE_GEAR_SETS[id];
    if(!def) continue;
    const active = def.bonus.filter(b=> count[id] >= b.n);
    active.forEach(b=> add(b.fx));
    sets.push({ set:id, n:count[id], active, next: def.bonus.find(b=> count[id] < b.n) || null });
  }
  return { fx, sets };
}
/* 着けた装備を体に重ねる(explore_loot.js の exploreDrawWornGear)。位置と大きさは体の矩形(絵の不透明部分)に対する比。
   x = 体の中心からの横(芯の幅に対する比)/ y = 頭のてっぺんからの縦(体の高さに対する比)/ w = 大きさ(芯の幅に対する比)
   core = 芯の幅(翼・尾で横に広い絵でも体の幅で置く。体の高さ×この比を上限にする) */
const EXPLORE_WORN = {
  core:0.62,
  head:   { x:0,     y:0.03, w:0.5 },             // 頭のてっぺんに載せる(顔は隠さない)
  body:   { x:0,     y:0.48, w:0.66 },
  arms:   { x:0.40,  y:0.56, w:0.30 },            // 左右に1つずつ(左は裏返す)
  weapon: { x:0.36,  y:0.42, w:1.15, rot:-0.55, backX:-0.05, backRot:0.6 },   // 前向きは体の後ろ・後ろ姿は背中の上
};
/* 着けている装備でいちばん多いセット(見た目の色に使う。フィールドの足元の光・報酬画面・工房の「着けたときの姿」)。
   同じ数なら発動しているセット効果が多い方、それも同じなら表の先(EXPLORE_GEAR_SLOTS の並び)。何も着けていなければ null
   返り値: { set, n, active(発動しているセット効果の数) } */
function exploreGearMainSet(equip){
  const tot = exploreGearTotals(equip);
  let best = null;
  for(const r of tot.sets){
    const cand = { set:r.set, n:r.n, active:r.active.length };
    if(!best || cand.n > best.n || (cand.n === best.n && cand.active > best.active)) best = cand;
  }
  return best;
}
// 効果を「体力+8%・被ダメ-3%」の形の短い文にする(表の並び順)。short=false で長い言葉
function exploreGearFxText(fx, short){
  const out = [];
  for(const k of Object.keys(EXPLORE_GEAR_STATS)){
    const v = fx && fx[k];
    if(!v) continue;
    const st = EXPLORE_GEAR_STATS[k];
    out.push(`${short===false ? st.label : st.short}${v > 0 ? '+' : '−'}${Math.round(Math.abs(v)*100)}%`);
  }
  return out.join('・');
}

/* =====================================================================
   GAME STATE
===================================================================== */

/* =====================================================================
   狙撃銃とスコープ(探検モード専用。本体は sniper.js)
   **数値はすべてこの表と名前付き定数が正**(発注者が実機で調整する)。
   ・距離の単位はワールド単位(10単位=1m。PING_UNITS_PER_M と同じ換算)。
   ・武器を足すときは SNIPER_WEAPONS に1行足すだけ(装備担当が上位の狙撃銃を足す場所)。
     入手は sniperGive(ent, 'キー') / sniperAttachScope(ent, 'x8') で渡す。
   ・探検モード以外では何も読まれない(入口の判定は sniper.js の sniperModeOn() 1か所)。
===================================================================== */
const SNIPER_WEAPONS = {
  /* dmg      : 1発の威力(胴体)。弱点(ent.weakPoint)に当たると critMult 倍
     speed    : 弾速(ワールド単位/秒。水平成分)
     range    : 最大射程(ワールド単位)。地形パッチ(7200四方)の半分より内側に収める
     mag      : 装弾数。撃ち切ると自動で装填
     reloadSec: 装填にかかる秒数 / cycleSec: 1発ごとの連射間隔(ボルトを引く時間)
     critMult : 弱点命中の倍率(ent.weakPoint.mult があればさらに掛ける)
     drop     : 落下の強さ。既存の弾道 projGravityFor(range, speed) に掛ける倍率(大きいほど遠くで落ちる)
     sway     : 構えの揺れの大きさ(ラジアン。スコープの sway 係数を掛ける)
     recoil   : 反動の跳ね上がり(スコープの視野の半分に対する割合。倍率によらず画面上で同じ量)
     hitR     : 弾の当たりの太さ / tracer: 弾道の光の色 / defaultScope: スコープ無しで拾ったときの照準 */
  longbow: { name:'ロングボウ', icon:'🎯', dmg:110, speed:3200, range:3500, mag:5, reloadSec:2.6, cycleSec:1.05,
             critMult:1.8, drop:2.5, sway:0.0032, recoil:0.42, hitR:5, tracer:'#ffd79a', defaultScope:'iron' },
  // 工房で作る上位の狙撃銃(EXPLORE_GEAR の sniper キー)。威力の上乗せは装備の snipePct とは別に武器そのものが強い
  hornbow: { name:'大角の剛弓', icon:'🏹', dmg:135, speed:3300, range:3700, mag:5, reloadSec:2.4, cycleSec:1.0,
             critMult:1.9, drop:2.3, sway:0.0030, recoil:0.44, hitR:5, tracer:'#ffb36a', defaultScope:'iron' },
  glacier: { name:'氷河の狙撃銃', icon:'❄️', dmg:125, speed:3800, range:4000, mag:6, reloadSec:2.2, cycleSec:0.9,
             critMult:1.9, drop:1.8, sway:0.0026, recoil:0.38, hitR:5, tracer:'#9fe6ff', defaultScope:'iron' },
  apexbow: { name:'頂点の魔弾', icon:'🌟', dmg:170, speed:4000, range:4200, mag:4, reloadSec:2.6, cycleSec:1.1,
             critMult:2.1, drop:1.6, sway:0.0024, recoil:0.50, hitR:6, tracer:'#ffe36a', defaultScope:'iron' },
};
const SNIPER_NOISE_RANGE        = 5200;  // 銃声が野生・ボスに届く距離(ワールド単位。exploreMakeNoise へ渡す)
const SNIPER_SCOPES = {
  /* mag     : 倍率(視野角は tan(基準の半分)÷倍率 で狭める。1=ズームしない)
     sway    : 揺れの係数(倍率が高いほど大きい)
     reticle : 照準の絵('iron'=照門と照星 / 'chevron'=2倍 / 'mildot'=4倍 / 'bdc'=8倍の落下補正はしご)
     aperture: スコープ窓の半径(画面の高さに対する割合。0=窓なし)
     rarity  : ルートの色分け(common白/rare青/epic紫/legendary金)。拾う側が使う */
  /* sway は「画面の上で見える揺れ」がおおむね アイアン4px / 2倍8px / 4倍11px / 8倍20px(高さ750)になる値。
     低い倍率でも少しは動かないと、揺れがあること自体が伝わらない(批評の指摘) */
  iron: { name:'アイアンサイト', label:'1.25×', mag:1.25, sway:1.8,  reticle:'iron',    aperture:0,    rarity:'common' },
  x2:   { name:'2倍スコープ',   label:'2×',    mag:2,    sway:2.0,  reticle:'chevron', aperture:0.47, rarity:'rare' },
  x4:   { name:'4倍スコープ',   label:'4×',    mag:4,    sway:1.4,  reticle:'mildot',  aperture:0.46, rarity:'epic' },
  x8:   { name:'8倍スコープ',   label:'8×',    mag:8,    sway:1.3,  reticle:'bdc',     aperture:0.45, rarity:'legendary' },
};
const SNIPER_ADS_IN_SEC         = 0.22;  // 構えに入るまでの秒数(カメラの寄せと窓の開き)
const SNIPER_ADS_OUT_SEC        = 0.15;  // 構えを解くまでの秒数
const SNIPER_ZOOM_RATE          = 16;    // 倍率が目標へ寄る速さ(大きいほど速い。倍率は対数でなめらかに動く)
const SNIPER_ADS_SENS_BASE      = 1.05;  // 構え中の視点感度 = BASE ÷ 倍率^EXP(8倍で約0.16倍)
const SNIPER_ADS_SENS_EXP       = 0.9;
const SNIPER_SWAY_PERIOD        = 3.6;   // 8の字の揺れが一周する秒数
const SNIPER_MOVE_SWAY_MULT     = 2.2;   // 歩きながら構えたときの揺れの倍率
const SNIPER_BREATH_MAX_SEC     = 4.0;   // 息止めが続く秒数
const SNIPER_BREATH_RECOVER_SEC = 3.0;   // 息が空から満タンに戻る秒数
const SNIPER_BREATH_SWAY        = 0.10;  // 息止め中の揺れ(通常を1として)
const SNIPER_EXHAUST_SWAY       = 1.7;   // 息を使い切った直後の揺れ(息が半分戻るまで)
const SNIPER_RECOIL_RETURN      = 9;     // 反動が戻る速さ(ばねの強さ)
const SNIPER_ZERO_M             = 100;   // ゼロイン距離(m)。ここより遠いと弾が照準の下へ落ちる
const SNIPER_BODY_H_PER_RADIUS  = 2.0;   // 当たりの背の高さ = 半径×これ(ent.bodyH があればそちら)
const SNIPER_HIT_RADIUS_MULT    = 0.95;  // 当たりの横幅 = 半径×これ
const SNIPER_WEAK_FROM          = 0.62;  // ent.weakPoint に from が無いときの弱点の下端(背の高さに対する割合)
const SNIPER_DROP_MARKS_M       = [150, 200, 250, 300];   // 落下補正の目盛り(m)
const SNIPER_DROP_LABEL_ORDER   = [200, 300, 150, 250];   // 目盛りの数字が詰まって区別できないとき、残す順(前ほど残る)
const SNIPER_DROP_LABEL_X       = 0.2;    // 目盛りの数字の列の位置(照準から窓の半径×この割合だけ横)
const SNIPER_DROP_LABEL_DIM     = 0.42;   // 目盛りの数字が的の体に掛かるときの濃さ
const SNIPER_SWAY_NOISE         = 0.55;  // 揺れに混ぜるなめらかなノイズの割合(周期を読めなくする)
const SNIPER_HEARTBEAT_HZ       = 1.15;  // 心拍の細かい揺れの速さ(回/秒)
const SNIPER_HEARTBEAT_AMP      = 0.22;  // 心拍の揺れの大きさ(揺れ全体に対する割合。息止め中も残る)
const SNIPER_RECOIL_KEEP        = 0.10;  // 反動の跳ね上がりのうち戻らない割合(撃つたびに少し上がる)
const SNIPER_SHOT_SHAKE         = 0.035; // 撃った瞬間の画面の揺れ(視野の半分に対する割合)
const SNIPER_SHOT_ZOOM_KICK     = -0.05; // 撃った瞬間の視野の弾み(倍率の変化の割合。マイナス=一瞬広がる)
const SNIPER_CRIT_ZOOM_KICK     = 0.07;  // 弱点命中の倍率の弾み
const SNIPER_HITSTOP_SEC        = 0.07;  // 弱点命中のヒットストップ(秒)
const SNIPER_HITSTOP_SCALE      = 0.04;  // ヒットストップ中の時間の速さ
const SNIPER_TRACER_CONVERGE    = 1600;  // 弾道の光が銃口(画面の右下)から照準の線へ合流する距離(ワールド単位=160m)
const SNIPER_SHOT_RANGE_SEC     = 1.0;   // 撃った瞬間の距離を残して見せる秒数
const SNIPER_FIRE_CANCEL_MARGIN = 0.6;   // FIREを離した場所がボタンの外(大きさのこの割合より外)なら撃たない
const SNIPER_SCOPE_PIXEL_BOOST  = 1.5;   // 構え中、スコープの窓の範囲だけ3Dの描画解像度をこの倍にする(上限3)
const SNIPER_VEG_CONE_MIN_ZOOM  = 1.9;   // この倍率以上で、草・低木を「視線の先の扇」へ並べ替えて遠くまで出す
const SNIPER_BODY_FLASH_SEC     = 0.0006; // 探検: 狙撃の命中で体が白くなる時間(ゲーム内の秒)。ヒットストップ中(時間の速さ0.04)でも次のフレームで消える=1フレームだけ。光は当たった点の周りだけ
const SNIPER_TRACER_CLIP        = 0.97;  // 覗いている間、弾道の光を描く範囲(窓の半径に対する割合。距離・残弾は窓の外なので窓いっぱい)
const SNIPER_TRACER_CORE_PX     = [1.6, 4];   // 弾道の光の芯の太さ(画面px)。先=細い〜手前=太い
const SNIPER_FLASH_LEVELS       = [1, 0.85, 0.6];   // 発砲の閃光の強さ(撃ってから描くコマごと。0.62より上のコマは白い芯つき)
const SNIPER_HIT_JOLT_SEC       = 0.25;  // 探検: 狙撃の命中で的の絵が揺れる時間(秒)
const SNIPER_HIT_JOLT_PX        = [3, 5];  // 同じく揺れの幅(画面px。体 / 弱点)
const SNIPER_IMPACT_COLUMN_H    = 60;    // 外れた弾が地面に立てる土柱の高さ(ワールド単位=6m相当。遠くからでも見える大きさ)
const SNIPER_IMPACT_DEBRIS_G    = 900;   // 土くれ・小石が落ちる重さ(ワールド単位/秒²)
const SNIPER_CRIT_NUM_SCALE     = 1.5;   // 弱点命中のダメージの数字の大きさ(体への命中の数字に対する倍率)
