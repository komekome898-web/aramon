let lastT = performance.now();

/* =====================================================================
   MULTIPLAYER MATCH LOGIC (ホスト完全権威方式)
   - 全プレイヤーが同じシードから同じ初期状態(岩・地形・ルート・ボット構成・
     全員のスポーン地点)をローカルで再現し、エンティティのid割り当ても
     全員で完全に一致する(host/非host問わず同じ順序で生成するため)
   - ホストだけが本物のシミュレーション(ボットAI・当たり判定・ダメージ・ゾーン)を
     実行し、その結果(全エンティティの位置・HP・ガッツ・状態)を高頻度で配信する
   - 非ホストは「自分の入力→自分の見た目の予測」だけをローカルで行い、
     自分以外の全エンティティ(ボットや他プレイヤー)はホストの配信値へ
     滑らかに追従表示するだけにする(自分でシミュレーションしない)
   - これにより非ホスト側での「同期ズレ」「ボットが止まって見える」を構造的に防ぐ
===================================================================== */

/* =====================================================================
   通信の状態(オフライン・直近の通信の成否)を1か所で持つ
   ---------------------------------------------------------------------
   ・**なぜ firebase.js ではなくここか**: firebase.js は index.html から動的importされ、
     圏外だと**読み込み自体が失敗して window.__aramon* が1つも生えない**
     (index.html側で .catch(()=>{}) している)。「オフラインかどうか」を知りたいのは
     まさにその状況なので、状態の持ち主は常に読み込まれる classic script のこちらに置く。
     firebase.js は成否を __aramonNetMark() へ投げ込むだけにする(判定を2か所に書かない)。
   ・目的は、受け側が「**0件だったのか、通信に失敗したのか**」を区別できるようにすること。
     **戻り値の形は変えない**(配列は配列のまま)。失敗した戻り値には見えない印を付け、
     __aramonNetFailed(戻り値) で読む。既存の呼び出し側(rooms.length / rooms.map)は無改修で動く。
   ・表示・文言はUI側(ui.js)の担当。ここは材料を出すだけ。
===================================================================== */
const NET_NOTIFY_MIN_MS = 800;   // 同じ結果の連続通知は間引く(authStateは毎秒20回以上書くため)
const netHealth = {
  online: (typeof navigator === 'undefined') || navigator.onLine !== false,
  offlineSince: 0,          // オフラインになった時刻(ms)。オンラインなら0
  lastOkAt: 0,              // 最後に成功した通信の時刻
  lastFailAt: 0, lastFailOp: null,
  ops: Object.create(null), // op名 -> { ok, at, msg }
};
if(!netHealth.online) netHealth.offlineSince = Date.now();
const netWatchers = [];
let netLastNotifyAt = 0, netLastNotifyKey = '';
function netStatusSnapshot(){
  return {
    online: netHealth.online,
    offlineSince: netHealth.offlineSince,
    lastOkAt: netHealth.lastOkAt,
    lastFailAt: netHealth.lastFailAt,
    lastFailOp: netHealth.lastFailOp,
    ready: typeof window.__aramonListOpenRooms === 'function',
  };
}
function netNotify(key){
  const now = Date.now();
  if(key && key === netLastNotifyKey && now - netLastNotifyAt < NET_NOTIFY_MIN_MS) return;
  netLastNotifyKey = key || ''; netLastNotifyAt = now;
  const snap = netStatusSnapshot();
  for(const cb of netWatchers){ try{ cb(snap); }catch(err){} }
}
if(typeof window !== 'undefined' && window.addEventListener){
  window.addEventListener('online', ()=>{
    if(netHealth.online) return;
    netHealth.online = true; netHealth.offlineSince = 0; netNotify('on');
  });
  window.addEventListener('offline', ()=>{
    if(!netHealth.online) return;
    netHealth.online = false; netHealth.offlineSince = Date.now(); netNotify('off');
  });
}
/* 端末がオンラインか。**navigator.onLine は「何かに繋がっている」しか言わない**ので、
   これだけでは足りない。実際に届いたかどうかは __aramonNetMark の記録の方を見る。 */
window.__aramonNetOnline = function(){ return !!netHealth.online; };
/* 通信の下回りが使えるか(firebase.jsを読み込めたか)。マルチのボタンを沈ませる判断用 */
window.__aramonNetReady = function(){ return typeof window.__aramonListOpenRooms === 'function'; };
window.__aramonNetStatus = netStatusSnapshot;
/* firebase.js が通信の成否を投げ込む口。op は 'listRooms' / 'createRoom' などの識別子 */
window.__aramonNetMark = function(op, ok, err){
  const now = Date.now();
  netHealth.ops[op] = { ok: !!ok, at: now,
    msg: ok ? '' : String((err && (err.message || err.code)) || err || '') };
  if(ok) netHealth.lastOkAt = now;
  else { netHealth.lastFailAt = now; netHealth.lastFailOp = op; }
  netNotify((ok ? 'ok:' : 'ng:') + op);
  return ok;
};
/* 直近のその通信が失敗したか。null = まだ一度も呼んでいない */
window.__aramonNetOpFailed = function(op){
  const r = netHealth.ops[op];
  return r ? !r.ok : null;
};
/* 失敗して返ってきた値に印を付ける / 読む。印は列挙されないので、
   そのまま map/JSON.stringify しても従来と同じ結果になる。 */
window.__aramonNetTagFailed = function(v){
  if(v && typeof v === 'object'){
    try{ Object.defineProperty(v, '__netFailed', { value:true, enumerable:false, configurable:true }); }catch(err){}
  }
  return v;
};
window.__aramonNetFailed = function(v){ return !!(v && typeof v === 'object' && v.__netFailed === true); };
/* 状態が変わったら呼ばれる購読。登録時に1回すぐ呼ぶ。戻り値は解除関数 */
window.__aramonNetWatch = function(cb){
  if(typeof cb !== 'function') return ()=>{};
  netWatchers.push(cb);
  try{ cb(netStatusSnapshot()); }catch(err){}
  return ()=>{ const i = netWatchers.indexOf(cb); if(i >= 0) netWatchers.splice(i, 1); };
};

/* =====================================================================
   遅延(RTT)の実測
   自分の入力(seq)をホストが適用して aseq を返してくるまでの往復を測る。
   net_transport.js の ping/pong は **WebRTCが繋がっている間しか測れない**が、
   こちらは rtdb 経由でも測れ、しかもホストの1tickぶんも込みなので
   「押してから世界に反映されるまで」というプレイヤーの体感に一番近い。
   使い道は2つ: ①HUDの遅延表示(F-10) ②予測命中の取り消し待ち時間(F-11)。
===================================================================== */
const NET_RTT_EWMA_ALPHA = 0.25;   // 1回の実測をどれだけ効かせるか(大きいほど敏感)
const NET_RTT_STALE_MS = 4000;     // これだけ更新が無ければ「測れていない」扱い
const NET_RTT_MAX_MS = 5000;       // これを超える値はスリープ明け等の異常として捨てる
let netRttMs = null;               // EWMAした往復(ms)。null=未計測
let netRttAt = 0;                  // 最後に更新した時刻(performance.now)
function noteNetRtt(ms){
  if(!(ms >= 0) || ms > NET_RTT_MAX_MS) return;
  netRttMs = (netRttMs == null) ? ms : netRttMs + (ms - netRttMs) * NET_RTT_EWMA_ALPHA;
  netRttAt = performance.now();
}
function currentNetRttMs(){
  if(netRttMs != null && performance.now() - netRttAt < NET_RTT_STALE_MS) return netRttMs;
  // ackがまだ来ていない間だけ、WebRTCの実測ping(あれば)で代用する
  const st = (typeof window.__aramonNetStats === 'function') ? window.__aramonNetStats() : null;
  if(st && st.peers){
    for(const p of st.peers){ if(p.rttMs != null) return p.rttMs; }
  }
  return null;
}
/* HUDの遅延表示(F-10)の材料。**描画は render.js の drawNetStatusChip()**。
   ソロでは null を返す(=何も出さない)。ホストは自分が基準なので往復を出さない。 */
function netHudInfo(){
  if(!game.started || netState.mode !== 'multi') return null;
  if(netState.isHost) return { host:true, rtt:null, interp:null };
  return { host:false, rtt: currentNetRttMs(), interp: interpDelayMs };
}

// 自分の入力を送る間隔(秒)。rtdb=約22回/秒(Firebaseのquota都合)。
// WebRTC直結(net_transport.js)が確立している間だけ約40回/秒へ上げる
const INPUT_SEND_INTERVAL_RTDB = 0.045;
const INPUT_SEND_INTERVAL_RTC  = 0.025;
function inputSendInterval(){
  return (window.NetTransport && NetTransport.isRtcActiveToHost())
    ? INPUT_SEND_INTERVAL_RTC : INPUT_SEND_INTERVAL_RTDB;
}
let lastInputSendAt = 0;
let remoteInputs = {};   // playerId -> {mx,my,facing,wantFire,wantDash,moveTierSelected,seq}
const processedRoomEventKeys = new Set(); // events(キルフィード等)の重複処理防止

/* ===== ホストの沈黙(ゲスト側の取り残され対策) =====
   ホストが圏外・アプリ終了になるとauthStateが止まり、敵もbotも凍ったまま自分だけ動ける
   世界が残る。以前はトーストも出ずリザルトにも進めないので、アプリを終了するしかなかった。
   authStateはrtdb経由でも50ms間隔で届く(net_transport.jsのキープアライブ)ので、
   秒単位の途絶えは「ホストがもう居ない」とみなしてよい。 */
const HOST_SILENCE_TIMEOUT = 5;          // これだけ(秒)authStateが途絶えたら試合を切り上げる
const HOST_SILENCE_RESUME_GAP_MS = 1000; // フレームがこれ以上飛んだら「アプリが止まっていた」とみなし測り直す
let hostAuthSeenAt = 0;                  // 最後にauthStateを受け取った時刻(performance.now基準・ms)
let hostSilenceHandled = false;          // 二重に終わらせない
let lastFrameGapMs = 0;                  // 直前フレームからの実経過(dtは0.05で頭打ちなので別に持つ)

// ===== 自分の位置の突き合わせ(ラバーバンド対策) =====
// 入力に連番(seq)を付けて送り、ホストは「最後に適用した入力seq」をauthStateで返す。
// ゲストは自分の予測位置をseqごとに覚えておき、同じ入力時点どうしで誤差を取る。
// 現在位置とホストの過去位置を比べる従来方式は、遅延そのものが誤差として出てしまい
// 移動中はずっと後ろへ引っ張られていた(水中など低速だと前進できず操作不能になっていた)。
let selfInputSeq = 0;
let selfDashSeq = 0;                    // ダッシュした回数。入力に載せてホストへ伝える
/* トレーニングカードの選択。ダッシュと同じく「回数」で伝えるので、
   取りこぼしも二重適用も起きない(ホストは回数が増えたときだけ1回処理する)。 */
let selfCardSeq = 0;
let selfCardPick = null;
function sendTrainCardPick(key){ selfCardPick = key; selfCardSeq++; }
let selfPredHistory = [];               // [{seq,x,y}] 入力送信時点の自分の予測位置
const SELF_HISTORY_CAP = 80;
const SELF_CORRECT_DEADZONE = 14;       // これ以下の誤差は無視(予測を信頼する)
// ダッシュ中と直後だけ許容を広げる。ダッシュは短時間に大きく動くので、ホストが
// ダッシュを受け取るまでの数フレームぶん位置が離れる。両者がダッシュを終えれば移動量は
// 同じになり誤差は自然に消えるため、ここで補正すると「ダッシュしたのに引き戻される」動きになる。
const SELF_CORRECT_DEADZONE_DASH = 70;
const SELF_DASH_GRACE = 0.45;           // ダッシュ終了後も許容を広げておく秒数
const SELF_CORRECT_SNAP = 240;          // これを超えたら即座に合わせる(壁抜け等)
const SELF_CORRECT_RATE = 6;            // 誤差を秒あたりどれだけ詰めるか(大きいほど速く収束)
let selfCorrX = 0, selfCorrY = 0;       // 未適用の補正量(毎フレーム少しずつ消費する)
// 【移動速度を考慮した補正】しきい値を固定距離にすると、育成やバフで移動速度が上がるほど
// 1フレーム/1往復ぶんの移動量が大きくなり、通常の前進でも許容を超えて引き戻され、
// スナップ距離にも届いて瞬間移動して見える(=飛び飛びになる)。
// 実効移動速度に比例して許容と収束速度を広げ、速いモンスターでも滑らかに追従させる。
/* 【上限は「起こりうる速度」に合わせる】許容の元になる誤差は「ホストが1回ぶん古い入力で
   進めてしまう距離」=速度×入力送信間隔(45ms)なので、速度に素直に比例させるのが正しい。
   上限2.4(速度720相当)は**実際に出る速度に届いていなかった**: 移動速度の基礎値は
   転生(+30まで)に加えて加速剤が**上限なし**で積め、そこへ回避の倍率(最大約3倍)と
   試合中のトレーニングカードが乗るので、1000を超える個体が普通に出る。
   届いていない上限のままだと、速い個体ほど「まっすぐ走っているだけ」で許容を超えて
   引き戻され、行ったり来たりして見えた(2026-08-15の報告)。 */
const SELF_CORRECT_REF_SPEED = 300;        // この速度のとき倍率1.0(既定のモンスター相当)
const SELF_CORRECT_SPEED_SCALE_MAX = 6;    // 許容と収束速度の上限(速度1800相当。実際に出る速度を覆う)
/* スナップ(即座に位置を合わせる)距離だけは別の上限にする。こちらの役目は壁抜け等の
   「本当にあり得ないズレ」の救済なので、速度に合わせて青天井に広げると
   ズレたまま戻らなくなる。従来どおりの2.4(=576px)で止める。 */
const SELF_CORRECT_SNAP_SCALE_MAX = 2.4;
function selfCorrectSpeedScale(ent){
  if(!ent || typeof entityMoveSpeed!=='function') return 1;
  const spd = entityMoveSpeed(ent) * (typeof multiMoveSpeedMult==='function' ? multiMoveSpeedMult() : 1);
  return clamp(spd / SELF_CORRECT_REF_SPEED, 1, SELF_CORRECT_SPEED_SCALE_MAX);
}

// ===== スナップショット補間(①)＋速度外挿(②)＋ラグ補正(③)＋差分/分割配信(④) =====
// 遠隔エンティティは「一定の描画遅延」を挟んで直近2スナップショット間を線形補間する。
// これにより更新間隔のムラを吸収し、ホスト/ゲストで見た目の滑らかさを揃える。
// 時間軸は「ホストの試合時刻(payload.t)」を使う。到着時刻を時間軸にすると、配信が
// まとめて届いた(ジッタ)ときにスナップショット間隔が実際より短く見積もられ、
// 速い相手が瞬間移動したように飛ぶ。ホスト時刻なら間隔が常に正しくなる。
const INTERP_DELAY_MS = 120;   // 遠隔エンティティの描画遅延(publish間隔+ジッタを吸収)。rtdb時の値=上限
// WebRTC直結中は配信間隔が短くなるので、描画遅延も実測(ジッタ+2配信間隔)へ縮めて
// 「相手の動きが新しく見える」ようにする。急変させるとその瞬間に相手が飛ぶので、
// 目標値へゆっくり追従させる(降格でrtdbへ戻れば自然に120msへ戻る)
const INTERP_DELAY_MIN_MS = 50;      // rtc時の下限
const INTERP_DELAY_ADAPT_RATE = 0.8; // 目標へ寄せる速さ(1秒あたりの割合)
let interpDelayMs = INTERP_DELAY_MS;
function updateInterpDelay(dt){
  let target = INTERP_DELAY_MS;
  const t = window.NetTransport;
  if(t && t.isRtcActiveToHost() && t.authStreamStats){
    const s = t.authStreamStats();
    if(s && s.avgMs > 0) target = clamp(s.jitterMs + s.avgMs*2, INTERP_DELAY_MIN_MS, INTERP_DELAY_MS);
  }
  interpDelayMs += (target - interpDelayMs) * Math.min(1, dt*INTERP_DELAY_ADAPT_RATE);
}
const EXTRAP_CAP_MS = 180;     // スナップショット欠落時に速度で外挿する上限
/* ゲストがauthStateのHPの減りを「攻撃を受けた」とみなす下限(HP)。
   安全圏・溶岩の環境ダメージは1配信(50ms)あたり数HPなので、それより大きい減りだけを拾う */
const GUEST_HIT_FEEDBACK_MIN = 5;

/* =====================================================================
   ゲストの「予測命中」の取り消し(F-11)
   ---------------------------------------------------------------------
   ゲストの見た目弾は**補間された(=遅れた)相手位置**に当たる。ホストの確定判定は
   巻き戻し(entityRewoundPos)で、座標系も弾の軌道も別物なので**必ずズレる**。
   外れたときに×印と数字が出っぱなしになるのが「当たったのに減らない」の正体。

   【確定が来たかどうかの判定】**自分の damageDealt が増えたこと**を使う。
   ホストは buildAuthStatePayload で全エンティティに damageDealt を毎tick載せており
   (フル配信待ちにならない)、applyAuthState が自分のぶんも受けている。
   「相手のHPが減ったか」で見ると他人が与えたダメージまで自分の手柄に数えてしまうが、
   damageDealt は**ホストが自分の攻撃として計上した量**なので、与えた側の証拠として正しい。
   どの相手に当たったかまでは分からないが、ここで消したいのは「1件も当たっていないのに
   出てしまった表示」なので、「この窓の間に自分の与ダメが1も増えなかった」で十分。
   1配信で複数発ぶんまとめて確定することがあり、その内訳は分からない。連射で同時に
   何発も当てたときは**当たっていた表示まで取り消しうる**が、消えるのは薄い予測数字だけで、
   確定の実数字(HPの減りから出る本来の数字)はそのまま出る。逆向きの誤り
   (外れたのに残す)より軽いので、この向きに倒してある。

   待ち時間は往復の実測(currentNetRttMs)に合わせる。固定値にすると回線が悪い人ほど
   **本当は当たっているのに取り消す**ことになり、今より悪い嘘になる。
===================================================================== */
const PRED_HIT_CONFIRM_BASE_SEC = 0.22;  // 往復に上乗せする猶予(ホストの1tick+配信間隔ぶん)
const PRED_HIT_CONFIRM_MIN_SEC  = 0.35;  // 待ち時間の下限
const PRED_HIT_CONFIRM_MAX_SEC  = 1.20;  // 待ち時間の上限(これ以上は待たずに取り消す)
const PRED_HIT_TEXT_EXTRA_SEC   = 0.15;  // 予測数字は待ち時間より少し長く生かす(取り消しが見えるように)
const PRED_HIT_CANCEL_FADE_SEC  = 0.12;  // 取り消しと決まってから消えるまで
// ※ 予測の×印・予測数字の「濃さ」は描画側の話なので render.js が持つ
//    (HIT_MARKER_PRED_DIM / drawParticle の pred 分岐)。数字を2か所に置かない。
let guestPredHits = [];       // [{at, part}] 未確定の予測命中。partは予測ダメージ数字のパーティクル
let guestPredDmgDealt = null; // 直前に受け取った自分の damageDealt(増分で確定を判定する)
function predHitConfirmSec(){
  const rtt = currentNetRttMs();
  const w = PRED_HIT_CONFIRM_BASE_SEC + (rtt != null ? rtt/1000 : PRED_HIT_CONFIRM_MAX_SEC);
  return clamp(w, PRED_HIT_CONFIRM_MIN_SEC, PRED_HIT_CONFIRM_MAX_SEC);
}
/* 見た目命中の瞬間の表示。**確定ではないと分かる濃さ**で出し、あとで取り消せるよう控える */
function noteGuestPredHit(e, p){
  const wait = predHitConfirmSec();
  if(typeof showHitMarker === 'function') showHitMarker(true);   // 薄い×印(予測)
  playSe('hitDealt');   // 命中SE(ソロ/ホストは combat.js の applyDamage で鳴らす)
  let part = null;
  if(p.predDmg && typeof spawnPredDmgText === 'function'){
    spawnPredDmgText(e.x, e.y, e.z, p.predDmg);
    /* spawnPredDmgText(world.js)の既定の寿命は取り消しの窓より短く、待っている間に
       自然に消えてしまう。**この関数の呼び出し元はここだけ**なので、控えた直後に
       寿命だけをこちらの窓に合わせる(world.js側の既定は触らない)。 */
    const last = particles[particles.length - 1];
    if(last && last.pred){
      part = last;
      part.life = part.maxLife = wait + PRED_HIT_TEXT_EXTRA_SEC;
    }
  }
  guestPredHits.push({ at: matchTime, wait, part, dmg: p.predDmg || 0 });
}
/* 毎フレーム点検し、待ち時間を過ぎても確定が来なかったものを取り消す(薄く消す)。
   確定が来たものは、ホストの実数字(HPの減りから出る)に役目を譲って控えを捨てるだけ。 */
function updateGuestPredHits(){
  if(!guestPredHits.length) return;
  for(let i = guestPredHits.length - 1; i >= 0; i--){
    const h = guestPredHits[i];
    if(h.confirmed){ guestPredHits.splice(i, 1); continue; }
    if(matchTime - h.at < h.wait) continue;
    if(h.part && h.part.life > PRED_HIT_CANCEL_FADE_SEC){
      // 残り寿命を切り詰める。描画側は life/maxLife を濃さに使うので、そのまま薄くなって消える
      h.part.life = PRED_HIT_CANCEL_FADE_SEC;
      h.part.predMiss = true;   // render.js: 取り消し中はさらに薄く描く
    }
    guestPredHits.splice(i, 1);
  }
}
/* ホストが自分の与ダメを計上した=古い予測から順に「当たっていた」とみなす。
   1配信で何発ぶん確定したかは分からないので、増えた量が予測値の
   PRED_HIT_DMG_TOLERANCE 倍を賄えるあいだ、古い順に確定にしていく
   (予測値は概算なので、ぴったり突き合わせようとすると常に外れる)。 */
const PRED_HIT_DMG_TOLERANCE = 0.6;
function confirmGuestPredHits(deltaDmg){
  let left = deltaDmg;
  for(const h of guestPredHits){
    if(h.confirmed) continue;
    h.confirmed = true;
    left -= Math.max(1, h.dmg || 0) * PRED_HIT_DMG_TOLERANCE;
    if(left <= 0) break;
  }
}

const AUTH_FULL_EVERY = 8;   // 何回に1回、静的値(maxHp/train係数等)も載せた「フル」配信にするか(残りは位置等の軽量配信)
const HOST_HISTORY_CAP = 60;   // ホストの位置履歴(ラグ補正の巻き戻し用)保持スナップショット数
let guestSnapBuf = [];         // ゲスト: 補間用スナップショット {rt, ht, seq, ents:{id:{x,y,z,f,vx,vy,alive}}}
let guestCurViewSeq = 0;       // ゲスト: 今まさに描画している(=狙いを定めている)ホストseq
// ホスト時刻(ms) と ローカル時刻(performance.now) の差の推定値。
// 「最も早く着いた配信」を基準にすることで、遅れて届いた配信に引きずられないようにする。
let hostClockOffset = null;    // localNow - hostT の推定値
let hostForceFullNext = false; // ホスト: 次のauthStateを強制的にフル配信にする(強化値の即時反映用)
let hostPosHistory = [];       // ホスト: [{seq, ents:{id:{x,y}}}] 直近のみ保持(巻き戻し用)
let authPublishSeq = 0;        // ホスト: authStateの連番
let lastPubPos = {};           // ホスト: 速度算出用 id->{x,y,t}
// 最短方向で角度を補間する(±πをまたぐズレを防ぐ)
function lerpAngleShort(a, b, t){ let d=b-a; while(d>Math.PI)d-=Math.PI*2; while(d<-Math.PI)d+=Math.PI*2; return a+d*t; }
// ホスト: あるエンティティの「lagDelaySeqスナップショット前」の位置を返す(ラグ補正の巻き戻し)
function entityRewoundPos(entId, lagDelaySeq){
  if(!hostPosHistory.length) return null;
  const back = Math.max(0, Math.min(lagDelaySeq|0, hostPosHistory.length-1));
  const snap = hostPosHistory[hostPosHistory.length-1-back];
  return snap ? snap.ents[entId] : null;
}

function seedFromString(str){
  let h = 2166136261;
  for(let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h>>>0;
}

// ゲストが自分でダッシュしたときに呼ばれる(input.jsのtryDashから)。
// 回数を1つ増やし、次の入力送信でホストへ伝える
function noteLocalDash(){
  if(netState.mode!=='multi' || netState.isHost) return;
  selfDashSeq++;
}
// 部屋の単発イベント(キルフィード・試合終了)の処理。onChildAdded経由で1件ずつ届く
function handleRoomEvent(evt, evtKey){
  if(!evt) return;
  if(evtKey){
    if(processedRoomEventKeys.has(evtKey)) return; // onChildAddedは再アタッチ時に再送されるため重複を弾く
    processedRoomEventKeys.add(evtKey);
  }
  // キルフィードはキル発生元(常にホスト)がkillEntity()で即座に一度表示済みなので、
  // 自分が送ったイベントがそのまま自分にも返ってくるホスト側では二重表示しない。
  // ゲスト側はこのイベント経由でしか受け取らないため、これで両者とも1回だけになる。
  if(evt.kind==='kill' && !netState.isHost){
    if(evt.text) pushKillFeed(evt.text);
    // 自分が倒した場合のキルボーナス演出(HP/ガッツの実値はauthStateで届く)。
    // ゲストはkillEntity()を実行しないため、ここで演出だけを再現する
    if(player && evt.killerId===player.id && player.alive){
      playSe(skinKillSeName(player) || 'kill');
      spawnDmgText(player.x, player.y, player.z, '+50', '#7fffa0');
      spawnDmgText(player.x, player.y, player.z+30, '+50GT', '#ffd9e3');
      let bonusMsg = 'キルボーナス！ HP+50 ガッツ+50';
      if(evt.expBonus && game.selectedMastermonKey) bonusMsg += ` 経験値+${evt.expBonus}`;
      pushToast(bonusMsg);
      // 撃破EXPボーナスは本来authStateのmmKillExpで届くが、最後のキルで試合が終わると
      // 間に合わずリザルトに乗らないことがある。ここで先に積んでおく
      // (積み上がるだけの値なので、受信側はmaxで反映して二重加算にならないようにしてある)
      if(evt.expBonus) player.mastermonKillExpBonus = (player.mastermonKillExpBonus||0) + evt.expBonus;
    }
  }
  // 状態変化の発動(ゲストは自分の分でも演出が出ないため、ここで再現する)
  if(evt.kind==='state' && !netState.isHost){
    const ent = getEntity(evt.entId);
    if(ent) ent.stateFlashUntil = matchTime + STATE_FLASH_DUR; // ホストと同じ合図(HPゲージ上の表示を光らせる)
    if(player && evt.entId===player.id){
      pushToast(`${evt.name} 発動！(${evt.duration}秒間)`);
      playSe('jakiin');
    }
  }
  // レイド: ボスの予告(表示専用)。ゲストはホストのループを回さないので、
  // これを受けないと警告も標的も一切出ない
  if(evt.kind==='raidTele' && game.raid && !netState.isHost){
    const mv = RAID_BOSS_MOVES.find(m=>m.key===evt.mv) || RAID_BOSS_MOVES[0];
    const marks = (evt.marks||[]).map(m=>({ x:m.x, y:m.y, r:m.r,
      angle: m.a!=null ? m.a : undefined, fanDeg: m.f!=null ? m.f : undefined }));
    raidState.pending = { move: mv, marks, fireAt: matchTime + (evt.tele||1.2), angle: marks[0] && marks[0].angle || 0 };
    raidState.marks = marks;
    pushToast(mv.warn);
    playSe(mv.tier>=3 ? 'godRising' : 'fireRoar');
    // 予告の時間が過ぎたら消す(実際の攻撃はホストがshotEventで見せる)
    setTimeout(()=>{ if(raidState.pending && raidState.pending.move===mv){ raidState.pending=null; raidState.marks=[]; } },
               Math.round((evt.tele||1.2)*1000));
  }
  // チーム戦: ダウン・蘇生の通知(ゲストはホストのループを回さないので、フィードと本人向けの合図を再現する)
  if(evt.kind==='down' && !netState.isHost){
    if(evt.text) pushKillFeed(evt.text);
    if(player && evt.victimId===player.id) pushToast('ダウンした！ 仲間の蘇生を待て');
  }
  if(evt.kind==='revive' && !netState.isHost){
    if(evt.text) pushKillFeed(evt.text);
    if(player && evt.entId===player.id){ pushToast('蘇生された！'); playSe('pickup'); }
  }
  // チーム戦: ピン(発信者→全員の配信。ホスト権威ではない=ゲストも発信できる)。
  // 自分のエコーは捨て(送信時に適用済み)、同じ小隊のぶんだけ表示する。botは反応しない(表示のみ)
  if(evt.kind==='ping'){
    const ownEcho = evt.pid && evt.pid===netState.myPlayerId;
    if(!ownEcho && typeof isTeamMatch==='function' && isTeamMatch() &&
       player && player.teamId!=null && player.teamId===evt.team &&
       typeof applyPing==='function'){
      applyPing(evt);
    }
  }
  // レイド: 決着はホストが判定する。ゲストはこれを受けて同じ結果画面へ進む
  if(evt.kind==='raidEnd' && game.raid && !game.over){
    finishRaid(!!evt.defeated);
  }
  if(evt.kind==='matchEnd' && !game.over){
    // チーム戦: 自分がダウン/死亡していても、自チームの勝ちなら勝利
    const teamWin = (typeof evt.winnerTeam==='number') && player && player.teamId===evt.winnerTeam;
    if(player && (teamWin || (player.netPlayerId===evt.winnerNetId && player.alive))){
      onPlayerWin();
    } else if(player && player.netPlayerId!==evt.winnerNetId){
      // 自分は勝者ではない側。通常はhostが即時配信するauthStateのhp/alive更新で
      // 自然に結果画面へ移るが、通信の遅延等でそれが届かない場合に備えて、
      // 少し待っても試合が終わっていなければここで確実に終わらせる
      // (ゲスト側が生き残ったまま延々と試合が終わらないのを防ぐ保険)
      setTimeout(()=>{
        if(!game.over){ showResult(false, player.placement || (entities.filter(e=>e.alive).length+1)); }
      }, 500);
    }
  }
}

// 試合開始処理の外枠。中で例外が出たときに必ずフラグを戻してトップ画面へ帰す。
// これが無いと matchBeginning が立ったまま・game.started が false のまま抜けてしまい、
// 画面が固まったように見えたうえ「次に試合を始めようとしても何も起きない」状態になる。
async function beginMultiplayerMatch(){
  try{
    await beginMultiplayerMatchInner();
  }catch(err){
    console.error('[aramon] beginMultiplayerMatch failed', err);
    matchBeginning = false;
    game.started = false;
    netState.matchStarting = false;
    try{
      document.getElementById('lobbyScreen').classList.add('hidden');
      document.getElementById('startScreen').classList.remove('hidden');
      joinInProgress = false;
      if(typeof updatePlayButtonsEnabled==='function') updatePlayButtonsEnabled();
      const rid = netState.roomId;
      netState.roomId=null; netState.isHost=false; netState.humanPlayers={}; netState.hostId=null;
      if(rid && window.__aramonLeaveRoom) await window.__aramonLeaveRoom(rid);
    }catch(e){}
    pushToast('試合の開始に失敗しました。もう一度お試しください');
  }
}
async function beginMultiplayerMatchInner(){
  if(game.started || matchBeginning) return;
  matchBeginning = true;
  document.getElementById('lobbyScreen').classList.add('hidden');
  document.getElementById('resultScreen').classList.add('hidden');

  entities=[]; projectiles=[]; lootItems=[]; particles=[]; areaEffects=[]; pendingAoeCasts=[]; nextId=1;
  if(typeof resetMatchFinishAnim==='function') resetMatchFinishAnim();  // 前の試合の決着演出と待ちのタイマーを畳む
  resetTrainCards();   // トレーニングカードの表示と待ち行列を必ず空にする(前の試合ぶんを持ち越さない)
  matchTime=0; game.over=false; game.tipTimer=7; hostSpectating=false; spectateTargetId=null; lastGutsWarnAt=-Infinity;
  camState.yaw = 0; camState.pitch = 0.27;
  camSnap.active = false;
  monsterScreenPos.clear();
  Object.keys(keys).forEach(k=>keys[k]=false);
  fireBtnHeld=false; joystick.active=false; joystick.nx=0; joystick.ny=0;
  if(typeof setAutoRun==='function') setAutoRun(false); // 試合開始時はオートラン解除
  joyKnobEl.style.transform='translate(0,0)';
  remoteInputs = {}; processedHitKeys.clear(); authPublishTimer=0;
  pendingRemoteFireEvents.length = 0; processedFireEventKeys.clear();
  processedLootEventKeys.clear();
  /* **processedRoomEventKeys は消さない。** ここには matchEnd(試合を終わらせるイベント)が
     混ざっていて、消してしまうと前の試合のものを「初めて見た」として処理してしまう。
     ホスト側で置き場を空にしてはいるが、消し損ねた場合の最後の砦としてこちらも残す。
     キーは部屋の中で重複しないので、残っていても誤って弾くことはない。 */
  // 補間/ラグ補正の状態をリセット
  guestSnapBuf = []; guestCurViewSeq = 0; hostPosHistory = []; authPublishSeq = 0; lastPubPos = {};
  hostClockOffset = null; hostForceFullNext = false; interpDelayMs = INTERP_DELAY_MS;
  // 自分の位置の突き合わせ状態をリセット(前の試合の履歴が残ると初回補正が暴れる)
  selfInputSeq = 0; selfDashSeq = 0; selfPredHistory = []; selfCorrX = 0; selfCorrY = 0;
  selfCardSeq = 0; selfCardPick = null; resetTrainOffers();
  // ホストの沈黙の計測も試合ごとにやり直す
  hostAuthSeenAt = performance.now(); hostSilenceHandled = false; lastFrameGapMs = 0;
  // 遅延の実測と予測命中の控えも試合ごとに捨てる(前の試合の値で待ち時間が決まらないように)
  netRttMs = null; netRttAt = 0;
  guestPredHits.length = 0; guestPredDmgDealt = null;

  // 部屋のシードと確定参加者リストを決定/取得
  // ホストが「試合開始が確定した瞬間の参加者一覧」を1回だけ書き込み、非ホストはそれだけを読む(誰も新規にgetしない)
  let seed, fixedPlayers, mapKey, hostMastermonBots, ghostBots, sharedWorld = null;
  let matchTeamSize = 1;   // この試合のチーム人数(1=個人戦)。ホストは部屋の設定、ゲストはシード配信の値が正
  let matchSub = null;     // この試合のサブモード('br20'/'arena'/null=従来型)。持ち方はteamSizeと同じ
  if(netState.isHost){
    matchTeamSize = Math.max(1, netState.teamSize||1);
    matchSub = netState.sub || null;
    seed = (Date.now() ^ Math.floor(Math.random()*0xffffffff)) >>> 0;
    if(window.__netProbeSeed!=null) seed = window.__netProbeSeed>>>0; // 計測ハーネス用のシード固定(通常は未定義で素通り)
    fixedPlayers = netState.humanPlayers || {};
    if(!fixedPlayers[netState.myPlayerId]){
      const mySkin = (typeof getEquippedSkin==='function') ? getEquippedSkin(game.selectedElement) : null;
      const myMm = (typeof currentMastermonInfo==='function') ? currentMastermonInfo() : null;
      fixedPlayers = { ...fixedPlayers, [netState.myPlayerId]: { name:'名無しのモンスター', element: game.selectedElement, skin: mySkin||null, mm: myMm||null, mmLevel: myMm?myMm.level:null } };
    }
    mapKey = (typeof resolveMapKey==='function') ? resolveMapKey() : (game.selectedMap || 'wild'); // 'ランダム'選択時は実マップを確定
    // ホストが持っているマスモンのうち、今使っているもの以外からランダムに選んでbot候補にする。
    // 【発注者要望 2026-08-19】並び順はロビー画面(ui.jsのgetHostMastermonBotOrder)と同じものを使う。
    // ここで改めてshuffle()し直すと、待機画面のプレビューと実際に参戦するマスモンがズレてしまう。
    const ownMastermons = loadMastermons();
    const shuffledCandidates = (typeof getHostMastermonBotOrder==='function') ? getHostMastermonBotOrder()
      : shuffle(Object.keys(ownMastermons).filter(k=>k!==game.selectedMastermonKey));
    /* 積み荷は mastermonSnapshot 1つで作る(部屋へ送る自分の育成値・ゴーストと同じ形)。
       以前はここだけ転生回数・適正・基礎値アイテムを載せておらず、ホストのマスモンbotに
       育成の一部が反映されていなかった。 */
    /* **積み荷を作る時点でホスト自身のマスモンの合計まで縮める。**
       受け取ってから各自で縮めるとホストとゲストで基準が違い、HP・速度が食い違う。 */
    const hostLimit = battleStatLimitOf(ownMastermons[game.selectedMastermonKey] || null, game.selectedElement);
    hostMastermonBots = shuffledCandidates.map(k=>{
      const skin = (typeof getEquippedSkin==='function') ? getEquippedSkin(k) : null;
      return Object.assign({ key:k }, capMastermonToLimit(mastermonSnapshot(ownMastermons[k], skin), hostLimit));
    });
    /* チーム戦だけ、他の人が育てたマスモン(ゴースト)を敵として混ぜる。
       **ホストが選んでシードに載せる**ので、全員が同じ相手を同じ強さで見る。
       レイドは全員でボスと戦う場なので混ぜない。取れなければ空で従来どおり。 */
    ghostBots = (matchTeamSize>1 && !netState.raid && typeof ghostBotsForRoom==='function')
      ? ghostBotsForRoom() : [];
  } else {
    console.log('[aramon] NON-HOST: waiting for seed+world...');
    const result = await window.__aramonWaitForRoomSeed(netState.roomId, 12000);
    if(result){
      seed = result.seed;
      fixedPlayers = result.fixedPlayers;
      mapKey = result.mapKey || 'wild';
      hostMastermonBots = result.hostMastermonBots || [];
      ghostBots = result.ghostBots || [];        // ホストが選んだゴースト(チーム戦の敵)
      sharedWorld = result.world || null; // ホストが生成した障害物(あれば正として使う)
      matchTeamSize = Math.max(1, result.teamSize||1); // チーム人数もホストの配信が正
      matchSub = result.sub || null;                   // サブモードも同様
    } else {
      matchTeamSize = Math.max(1, netState.teamSize||1); // タイムアウト時は部屋参加時のmetaで代用
      matchSub = netState.sub || null;
      // タイムアウト時のみ、やむを得ずローカルの直近スナップショットで代用する
      seed = seedFromString(netState.roomId);
      fixedPlayers = netState.humanPlayers || {};
      mapKey = game.selectedMap || 'wild';
      hostMastermonBots = [];
      ghostBots = [];
      console.warn('[aramon] NON-HOST: TIMEOUT, falling back to local snapshot', seed, fixedPlayers);
    }
  }
  netState.humanPlayers = fixedPlayers;
  /* この試合がレイドかどうかは**部屋のモード(netState.raid)が正**。
     ゲストは部屋に入った時点で部屋のmodeを netState.raid に入れてある。
     `mapKey==='raid'` はゲスト側の保険としてだけ残す:
     resolveMapKey() がレイド専用マップを絶対に返さないので、ホストが配信した
     mapKeyがraidなら「本当にレイドを走らせている」ときだけ成り立つ。
     **この保険を効かせるには resolveMapKey() 側の除外が必須**で、そこが抜けていたため
     「ランダム+リアルマップ」で竜の火口が当たると通常マルチがレイドに化けていた。 */
  const wantRaid = !!netState.raid || mapKey==='raid';
  raidResetState();          // 前の試合の持ち越しを断ってから立て直す
  teamResetState();          // チーム戦の状態も入口で消す(必要ならこの後assignTeamsで立て直す)
  arenaResetState();         // アリーナの状態も入口で消す
  netState.raid = wantRaid;
  game.raid = wantRaid;
  if(game.raid){ matchTeamSize = 1; matchSub = null; }   // レイドとチーム戦は排他
  netState.sub = matchSub;   // 確定したサブモードを部屋の状態にも反映(ホスト/ゲストで一致する)
  if(game.raid) mapKey = 'raid';
  /* この試合がバトルアリーナかは**部屋のサブモード(netState.sub==='arena')が正**。
     部屋metaへのsubの配線はモード再編側の担当で、ホスト・ゲストとも部屋に入った時点で
     netState.subに入っている前提(未配線の旧部屋ではundefined=通常戦のまま)。
     レイドとは排他。アリーナは常に3v3=6体で、余った枠はbotが埋める。 */
  game.arena = !game.raid && netState.sub==='arena';
  if(game.arena) matchTeamSize = ARENA_TEAM_SIZE;
  // 逆向きの保険: レイドでない試合にレイド専用マップが紛れ込んだら通常マップへ戻す
  else if(MAPS[mapKey] && MAPS[mapKey].raidOnly) mapKey = 'wild';
  game.activeMapKey = MAPS[mapKey] ? mapKey : 'wild';
  currentMap = MAPS[mapKey] || MAPS.wild;
  if(typeof applyStartPitchForMap==='function') applyStartPitchForMap(); // マップが決まってから視点の初期角度を決める
  if(typeof applyReal3DLayer==='function') applyReal3DLayer();  // リアルマップならWebGL地形を有効化

  // レイドは狭い円形の闘技場。通常のマルチは少人数想定でソロより一回り狭いマップにする
  applyWorldScale(game.raid ? RAID_WORLD_SCALE : MULTI_MAP_SCALE);

  // サブシステムごとに独立した派生rngを使う。こうすることで、ある生成の消費数が
  // 環境差でズレても他(スポーン/アイテム/装飾)まで連鎖して崩れない。
  const deriveRng = (salt)=> makeSeededRng((Math.imul(seed>>>0, 2654435761) ^ (salt>>>0)) >>> 0);
  const rng      = makeSeededRng(seed); // bot名/属性/枠決定用(host/guestで一致)
  const obRng    = deriveRng(0xA1);     // 障害物生成(ホスト or フォールバック)
  const decorRng = deriveRng(0xD2);     // 地形装飾(見た目のみ)
  const spawnRng = deriveRng(0x53);     // スポーン地点
  const lootRng  = deriveRng(0x7C);     // アイテム

  if(game.raid) initRaidZone(); else if(game.arena) initArenaZone(); else initZone();
  if(sharedWorld){
    // ゲスト: ホストが生成・配信した障害物をそのまま反映(座標一致で見えない岩ハマりを防ぐ)
    applyWorldFromSync(sharedWorld, obRng);
  } else {
    // ホスト、またはworld未受信のフォールバック: シードから生成
    seededGenVolcanoAndLava(obRng);
    seededGenWater(obRng);
    seededGenOasisZones(obRng);
    seededGenRocks(obRng);
    seededGenCrystals(obRng);
  }
  seededGenTerrain(decorRng);

  // ホストは生成した障害物一式を含めてシード等を配信する(ゲストはこれを正とする)
  if(netState.isHost){
    /* 【シードを配る前に】前の試合の使い捨てイベントを消す。ゲストはシードが載ってから
       購読を貼るので、ここで消しておけば全員が空の状態で2試合目を始められる。
       残っていると、貼った瞬間に前の試合の matchEnd が流れてその場で試合が終わる。 */
    if(window.__aramonClearRoomTransient) await window.__aramonClearRoomTransient(netState.roomId);
    const worldData = packWorldForSync();
    console.log('[aramon] HOST: publishing seed+world', seed, mapKey);
    await window.__aramonSetRoomSeed(netState.roomId, seed, fixedPlayers, mapKey, hostMastermonBots, worldData, matchTeamSize, matchSub, ghostBots);
  }

  // 参加している人間プレイヤーの一覧を「IDの文字列順」で確定させる(全員が同じ順序で処理するため)
  const humanList = Object.keys(fixedPlayers||{}).map(id=>({ id, ...fixedPlayers[id] }));
  if(!humanList.find(h=>h.id===netState.myPlayerId)){
    const mySkin = (typeof getEquippedSkin==='function') ? getEquippedSkin(game.selectedElement) : null;
    const myMm = (typeof currentMastermonInfo==='function') ? currentMastermonInfo() : null;
    humanList.push({ id:netState.myPlayerId, name:'名無しのモンスター', element: game.selectedElement, skin: mySkin||null, mm: myMm||null, mmLevel: myMm?myMm.level:null });
  }
  humanList.sort((a,b)=> a.id<b.id?-1:(a.id>b.id?1:0));

  const usedSlots = humanList.length;
  /* 総エンティティ数。従来型(sub無し)は部屋の定員ぶん(人間+bot)。
     チーム戦のサブモード: 20チームバトロワ=3人1組×20チーム=総勢60体(人間は1小隊・残りbot)。
     バトルアリーナは部屋の定員に関係なく常に3v3=6体(ARENA_TEAM_SIZE)。
     sub/teamSize はシード配信の値なので両側で必ず同じ頭数になる。 */
  const wantTotal = matchSub==='br20' ? Math.max(1, matchTeamSize) * TEAM_BR_TEAM_COUNT
                  : (game.arena || matchSub==='arena') ? ARENA_TEAM_SIZE*2
                  : netState.capacity;
  const botCount = Math.max(0, wantTotal - usedSlots);
  const totalEntityCount = usedSlots + botCount;
  // チーム戦は同チームを隣接スポーンにする(ソロ用pickTeamSpawnPointsBatchと対のシード付き)。
  // 返り値は「チーム0→チーム1→…」の平坦な並びで、下の生成順(人間→bot)=チーム割当順と一致する
  const spawnPoints = game.arena
    ? seededPickArenaSpawnPointsBatch(spawnRng, matchTeamSize)   // 対面配置(ソロ用pickArenaSpawnPointsBatchと対)
    : (matchTeamSize>1)
    ? seededPickTeamSpawnPointsBatch(spawnRng, Math.ceil(totalEntityCount/matchTeamSize), matchTeamSize)
    : seededPickSpawnPointsBatch(spawnRng, totalEntityCount);

  let idCounter = 1;
  let spawnIdx = 0;
  for(const h of humanList){
    const sp = spawnPoints[spawnIdx++];
    const isMe = h.id===netState.myPlayerId;
    const ent = createMonster(h.element||'fire', isMe, h.name||'プレイヤー', { id: idCounter++, spawnPoint: sp });
    ent.netPlayerId = h.id;
    // マスモンで参戦している人間プレイヤーには、本人・相手・ホスト・ゲストの区別なく
    // 同じ育成ステータス補正を掛ける(部屋の参加者情報に載っているstatsを使うので、
    // ホストとゲストで必ず同じHP・速度・与ダメ倍率になる)
    const hMm = (h.mm && h.mm.stats) ? h.mm : null;
    if(hMm) applyMastermonStatsToEntity(ent, hMm);
    // マスモン使用者は撃破時のEXPボーナス対象(bot・人間の区別なく与える)
    const hMmLevel = (hMm && hMm.level) || h.mmLevel || 0;
    if(hMmLevel) ent.mastermonLevel = hMmLevel;
    if(h.skin) ent.skinId = h.skin;               // 相手の着せ替えスキンを反映
    if(isMe){ ent.isPlayer = true; player = ent; }
    else { ent.isPlayer=false; ent.isRemoteHuman=true; }
    entities.push(ent);
  }

  const names = seededShuffle(rng, BOT_NAMES);
  const botElements = seededShuffle(rng, Object.keys(ELEMENTS));
  // ホストのマスモン候補を、どのbot枠に登場させるかも共有シードで決める(host/guest間で必ず一致させるため)。
  // 【発注者要望 2026-08-19】以前は全bot枠から完全ランダムに選んでいたため、自分のマスモンが
  // 敵チームに出ることがあった。ホスト自身のチームの空き枠を優先的に埋め、余れば他チームへ回す。
  const mastermonBotCount = Math.min((hostMastermonBots||[]).length, botCount);
  const hostFlatIdx = humanList.findIndex(h=>h.id===netState.hostId);
  const hostTeamId = (matchTeamSize>1 && hostFlatIdx>=0) ? Math.floor(hostFlatIdx/matchTeamSize) : -1;
  const ownTeamSlots = [], otherSlots = [];
  for(let i=0;i<botCount;i++){
    const teamOfSlot = matchTeamSize>1 ? Math.floor((usedSlots+i)/matchTeamSize) : -1;
    (hostTeamId>=0 && teamOfSlot===hostTeamId ? ownTeamSlots : otherSlots).push(i);
  }
  const slotOrder = seededShuffle(rng, ownTeamSlots).concat(seededShuffle(rng, otherSlots));
  const slotToMastermon = new Map();
  for(let j=0;j<mastermonBotCount;j++){ slotToMastermon.set(slotOrder[j], hostMastermonBots[j]); }
  /* ゴースト(他の人が育てたマスモン)は**人間が1人もいないチームの枠を先に埋める。**
     こうすると誰から見ても味方ではなく敵として出る(人間のいるチーム=誰かの味方枠を避ける)。
     どの枠に入るかも共有シードで決めるので、ホストとゲストで必ず同じ並びになる。 */
  const humanTeams = new Set();
  if(matchTeamSize>1) humanList.forEach((h,idx)=> humanTeams.add(Math.floor(idx/matchTeamSize)));
  const ghostSlots = [];
  for(let i=0;i<botCount;i++){
    if(slotToMastermon.has(i)) continue;   // ホストのマスモンが入る枠とは取り合わない
    const teamOfSlot = matchTeamSize>1 ? Math.floor((usedSlots+i)/matchTeamSize) : -1;
    if(matchTeamSize>1 && !humanTeams.has(teamOfSlot)) ghostSlots.push(i);
  }
  const ghostOrder = seededShuffle(rng, ghostSlots);
  const slotToGhost = new Map();
  const ghostBotCount = Math.min((ghostBots||[]).length, ghostOrder.length);
  for(let j=0;j<ghostBotCount;j++){ slotToGhost.set(ghostOrder[j], ghostBots[j]); }
  for(let i=0;i<botCount;i++){
    const sp = spawnPoints[spawnIdx++];
    const mmDef = slotToMastermon.get(i);
    if(mmDef){
      const ent = createMonster(mmDef.element, false, mmDef.name, { id: idCounter++, spawnPoint: sp });
      applyMastermonStatsToEntity(ent, mmDef);
      ent.isMastermonBot = true;
      ent.mastermonLevel = mmDef.level||1;
      if(mmDef.skin) ent.skinId = mmDef.skin;     // マスモンbotの着せ替えスキンを反映
      entities.push(ent);
    } else if(slotToGhost.get(i)){
      /* 他の人が育てたマスモン。差し込み方はホストのマスモンbotと同じで、
         **持ち主の名前(ghostOwner)だけ足す**(頭の上に「〇〇 の」と出る。render.js) */
      const g = slotToGhost.get(i);
      const ent = createMonster(g.element, false, g.name, { id: idCounter++, spawnPoint: sp });
      applyMastermonStatsToEntity(ent, g);
      ent.isMastermonBot = true;
      ent.mastermonLevel = g.level || 1;
      if(g.skin) ent.skinId = g.skin;
      ent.ghostOwner = g.owner || null;
      entities.push(ent);
    } else {
      const elKey = botElements[i % botElements.length];
      const nm = names[i % names.length] + (i>=names.length?'Ⅱ':'');
      entities.push(createMonster(elKey, false, nm, { id: idCounter++, spawnPoint: sp }));
    }
  }

  // チーム戦: 生成順(人間がid文字列順で先・botが後)をteamSizeずつ区切って割り当てる。
  // 並びはホスト/ゲストで完全に一致するので、チーム割当も必ず一致する(同チームは連番id)
  if(matchTeamSize>1) assignTeams(matchTeamSize);

  if(game.raid){
    /* レイド: 全員(人間もbotも)がボスと戦う。ボスもシード付き生成の一部として
       同じidで両側に作られるので、位置・HPは authState でそのまま同期される。
       ホスト/ゲストで挙動が変わらないよう、生成はここ1か所にまとめてある。      */
    const cx = WORLD.w/2;
    const bossY = Math.max(WORLD.h*RAID_BOSS_YR, raidBossMinY());
    const bossClear = RAID_BOSS.radius + RAID_BOSS.repositionDist + 160;
    rocks = rocks.filter(r=> Math.hypot(r.x-cx, r.y-bossY) > bossClear);
    // 挑戦者は手前に横並び。ボスから同じ距離に置いて開幕の有利不利を作らない
    const line = entities.filter(e=>!e.isRaidBoss);
    line.forEach((e,i)=>{
      const t = line.length>1 ? (i/(line.length-1)-0.5) : 0;
      e.x = clamp(cx + t*WORLD.w*0.22, 200, WORLD.w-200);
      e.y = cy0RaidSpawnY();
      e.z = baseTerrainHeightAt(e.x, e.y);
      e.moveTierUnlocked = 3;      // レイドは最初から全技を使える
      e.moveTierSelected = 1;
      e.raidDamage = 0;
    });
    const boss = createMonster(RAID_BOSS.element, false, RAID_BOSS.name, { id: idCounter++, spawnPoint:{x:cx, y:bossY} });
    boss.isRaidBoss = true;
    boss.skinId = RAID_BOSS.skinId;
    boss.radius = RAID_BOSS.radius;
    boss.speed = RAID_BOSS.speed;
    boss.maxHp = raidBossMaxHp(netState.capacity);
    boss.hp = boss.maxHp;
    boss.guts = 0; boss.maxGuts = 0;
    boss.raidHomeX = cx; boss.raidHomeY = bossY;
    boss.facingAngle = Math.PI/2;
    entities.push(boss);
    raidState = { bossId: boss.id, nextAttackAt: 3.0, pending:null, marks:[],
                  repositionAt: RAID_BOSS.repositionEvery, endsAt: RAID_TIME_LIMIT,
                  nextLootAt: RAID_LOOT_REFILL_EVERY };
    // アイテムは火山と反対側にまとめて撒く(ソロと同じ配置。シード付きで全員一致する)
    seededSpawnLoot(lootRng, RAID_LOOT_COUNT, { x:cx, y:WORLD.h*RAID_LOOT_YR }, Math.min(WORLD.w, WORLD.h)*RAID_LOOT_SPREAD);
    document.getElementById('raidHud').classList.remove('hidden');
    // バトルロイヤル専用のHUD(順位・安全圏の案内)は隠す。重なって読めなくなる
    document.getElementById('hud').classList.add('raid-mode');
  } else if(game.arena){
    // アリーナは少数を中央帯(安置内)だけに撒く(ソロ用spawnLoot側と対)
    seededSpawnLoot(lootRng, ARENA_LOOT_COUNT, ZONE_CENTER0, ARENA_ZONE_RADIUS*ARENA_LOOT_SPREAD);
  } else {
    // マップ面積が縮んだ分だけアイテムの湧き数も比例して減らす
    const mutSpawnMult = (typeof mutatorSpawnMult==='function') ? mutatorSpawnMult() : 1; // ミューテーター「スポーン数1.5倍」
    const multiLootCount = Math.round(420 * MULTI_MAP_SCALE * MULTI_MAP_SCALE * mutSpawnMult);
    seededSpawnLoot(lootRng, multiLootCount, ZONE_CENTER0, ZONE_PHASES[0].holdRadius*0.95);
    seededSpawnOasisBonusLoot(lootRng);
  }
  updateCamera();

  // トランスポート: 常にrtdbで開始し、WebRTC直結が確立した相手からrtcへ自動昇格する
  // (切断・沈黙時は自動でrtdbへ戻る。rtcが使えない環境では何もせず従来どおり全てrtdb)。
  // 以降の __aramonSend*/__aramonWatch* はnet_transport.jsのラッパを透過的に通る
  if(window.NetTransport && NetTransport.attach){
    NetTransport.attach({
      roomId: netState.roomId,
      myPid: netState.myPlayerId,
      isHost: netState.isHost,
      hostPid: netState.hostId,   // ゲストはここへofferを出す(未取得ならrtdbのまま)
      peerPids: Object.keys(fixedPlayers||{}).filter(id=>id!==netState.myPlayerId),
    });
  }

  /* 前の試合ぶんの購読を畳んでから貼り直す(「もう一度」で同じ部屋のまま2試合目に入るため)。
     畳まないと同じ購読が積み上がり、試合を重ねるほど同じイベントが何重にも届く。 */
  if(window.__aramonClearMatchListeners) window.__aramonClearMatchListeners();
  window.__aramonWatchInputs(netState.roomId, (players)=>{
    netState.humanPlayers = players||{};
    for(const id in players){
      if(id===netState.myPlayerId) continue;
      if(players[id] && players[id].input) remoteInputs[id] = players[id].input;
    }
    dropAbsentRemoteInputs(netState.humanPlayers);
  });
  window.__aramonWatchEvents(netState.roomId, handleRoomEvent);

  if(netState.isHost){
    window.__aramonWatchHitsAsHost(netState.roomId, (hitKey, hit)=>{
      if(processedHitKeys.has(hitKey)) return;
      processedHitKeys.add(hitKey);
      processHitAsHost(hit);
    });
    window.__aramonWatchFireEvents(netState.roomId, (evtKey, evt)=>{
      if(processedFireEventKeys.has(evtKey)) return;
      processedFireEventKeys.add(evtKey);
      pendingRemoteFireEvents.push(evt);
    });
  }
  window.__aramonWatchAuthState(netState.roomId, (authState)=>{
    if(authState && !netState.isHost){
      hostAuthSeenAt = performance.now();   // ホストが生きている唯一の証拠(rtc/rtdbどちらの便でも同じ)
      applyAuthState(authState);
    }
  });
  if(!netState.isHost){
    window.__aramonWatchShotEvents(netState.roomId, (evtKey, evt)=>{
      spawnVisualShotFromEvent(evt);
    });
    window.__aramonWatchLootEvents(netState.roomId, (evtKey, evt)=>{
      if(processedLootEventKeys.has(evtKey)) return;
      processedLootEventKeys.add(evtKey);
      applyLootEventLocally(evt);
    });
  }

  document.getElementById('startScreen').classList.add('hidden');
  if(typeof applyHudLayout==='function') applyHudLayout(); // カスタマイズしたHUD配置を反映
  game.started=true;
  beginSummonIntro();   // 5秒の召喚演出 → 演出後に本戦開始(バトル開始SE/BGM)
}

/* 部屋から消えた(退出・切断した)相手の入力を捨て、そのエンティティを離席扱いにする。
   remoteInputs は書き込むだけで消しておらず、applyRemoteInputsLocally() が最後の入力を
   毎フレーム当て続けるので、通信が切れた相手が最後の方向へ壁まで走り続ける置物になっていた
   (「回線を切ったほうが弾よけになる」不公平にも見える)。
   rooms/{id}/players は onDisconnect で必ず消えるので、そこに居ないIDが離席の正。
   入力を止めるだけで体は残す(生死・HPはホストの判定のままにする)。 */
function dropAbsentRemoteInputs(players){
  for(const id in remoteInputs){
    if(id===netState.myPlayerId) continue;
    if(players && players[id]) continue;
    delete remoteInputs[id];
    const ent = entities.find(e=>e.netPlayerId===id);
    if(ent){ ent.inputMoveX = 0; ent.inputMoveY = 0; }
  }
}

/* ホストの沈黙を見張る(ゲストだけ・試合中だけ)。
   終わらせ方は既存の経路をそのまま使う(レイド=finishRaid / それ以外=showResult)ので、
   リザルト・報酬・後始末はいつもの試合終了と同じ道を通る。
   トーストは1枠で上書きされるが、リザルト画面自体が出るので消えても行き止まりにならない。 */
function checkHostSilenceAsGuest(now){
  if(hostSilenceHandled || game.over) return;
  // 復帰直後(バックグラウンドでRAFごと止まっていた)は測り直す。通信が本当に切れていれば次の5秒で出る
  if(lastFrameGapMs > HOST_SILENCE_RESUME_GAP_MS){ hostAuthSeenAt = now; return; }
  if(now - hostAuthSeenAt < HOST_SILENCE_TIMEOUT*1000) return;
  hostSilenceHandled = true;
  pushToast('ホストとの接続が切れました');
  if(game.raid){ finishRaid(false); return; }
  showResult(false, (player && player.placement) || (entities.filter(e=>e.alive).length+1));
}

// 他プレイヤーの入力を、対応するローカルエンティティに反映する
function applyRemoteInputsLocally(){
  for(const id in remoteInputs){
    if(id===netState.myPlayerId) continue;
    const ent = entities.find(e=>e.netPlayerId===id);
    if(!ent || !ent.alive) continue;
    const inp = remoteInputs[id];
    if(!inp) continue;
    ent.inputMoveX = clamp(inp.mx||0,-1,1);
    ent.inputMoveY = clamp(inp.my||0,-1,1);
    ent.facingAngle = typeof inp.facing==='number' ? inp.facing : ent.facingAngle;
    if(typeof inp.moveTierSelected==='number') ent.moveTierSelected = inp.moveTierSelected;
    // 「どのseqの入力まで反映したか」を覚えてauthStateで返す(ゲストの位置突き合わせ用)
    if(typeof inp.seq==='number') ent.netAckInputSeq = inp.seq;
    // ダッシュ: 回数が増えていたらホスト側でも同じように実行する。
    // これを反映しないとホストは通常移動のまま計算し続けるので、ゲストのダッシュぶんが
    // そのまま位置の誤差になり、ダッシュした直後に元の位置へ引き戻されてしまう。
    if(typeof inp.dashSeq==='number' && inp.dashSeq > (ent.netLastDashSeq||0)){
      ent.netLastDashSeq = inp.dashSeq;
      // クールタイムはゲスト側で既に判定済みなので、ここでは二重ダッシュだけを防ぐ
      // (ホストのクールタイムで弾くと、ゲストだけが動いてズレる原因になる)
      if(ent.alive && !(ent.dashTimer>0) && typeof startEntityDash==='function') startEntityDash(ent);
    }
    // トレーニングカードの選択。ダッシュと同じく回数が増えたときだけ1回処理する
    if(typeof inp.cardSeq==='number' && inp.cardSeq > (ent.netLastCardSeq||0)){
      ent.netLastCardSeq = inp.cardSeq;
      if(inp.cardPick && typeof resolveTrainOfferFor==='function') resolveTrainOfferFor(ent, inp.cardPick);
    }
  }
}
// ホスト専用: 非ホストから届いた「1回発射しました」イベントを、届いた分だけ正確に処理する
const pendingRemoteFireEvents = [];
const processedFireEventKeys = new Set();
function processRemoteFireEvents(){
  while(pendingRemoteFireEvents.length){
    const evt = pendingRemoteFireEvents.shift();
    const ent = entities.find(e=>e.netPlayerId===evt.sourceNetId);
    if(!ent || !ent.alive) continue;
    if(ent.freezeUntil > matchTime) continue; // 凍結中は撃てない(ホスト自身と同じ条件)
    if(entityDowned(ent)) continue;           // ダウン中も撃てない(tryPlayerFireと同じ条件)
    ent.facingAngle = evt.facing;
    if(typeof evt.moveTier==='number') ent.moveTierSelected = evt.moveTier;
    const mv = activeMove(ent);
    if(ent.guts < effectiveGutsCost(ent, mv)) continue;
    // ③ ラグ補正: ゲストが撃った瞬間の自分の位置(fx,fy)から発射し、
    //   ゲストが見ていたホストseq(viewSeq)からの遅延ぶん、敵位置を巻き戻して当てる。
    const hasLagComp = (typeof evt.fx==='number' && typeof evt.fy==='number');
    const lagDelaySeq = (typeof evt.viewSeq==='number')
      ? Math.max(0, Math.min(HOST_HISTORY_CAP-1, authPublishSeq - evt.viewSeq)) : 0;
    const savedX=ent.x, savedY=ent.y;
    if(hasLagComp){ ent.x=evt.fx; ent.y=evt.fy; }
    let targetPoint;
    if(mv.melee){
      let best=null, bestD=mv.range;
      const dfx=Math.cos(ent.facingAngle), dfy=Math.sin(ent.facingAngle);
      for(const e2 of entities){
        if(e2===ent || !e2.alive) continue;
        if(sameTeam(ent, e2)) continue;   // チーム戦: 近接技の相手にも味方を選ばない(tryPlayerFireと同じ)
        if(e2.z - ent.z > upwardBlockLimit()) continue;
        const rp = (hasLagComp && entityRewoundPos(e2.id, lagDelaySeq)) || e2; // 巻き戻し位置で判定
        const d = Math.hypot(rp.x-ent.x, rp.y-ent.y);
        if(d>mv.range) continue;
        const dirx=(rp.x-ent.x)/Math.max(d,0.001), diry=(rp.y-ent.y)/Math.max(d,0.001);
        if(dirx*dfx+diry*dfy>0.55 && d<bestD){ bestD=d; best=e2; }
      }
      targetPoint = best;
    } else {
      targetPoint = { x: ent.x+Math.cos(ent.facingAngle)*1000, y: ent.y+Math.sin(ent.facingAngle)*1000 };
    }
    const projBefore = projectiles.length;
    // リアルマップの上下のねらいは撃った本人のカメラでしか分からないので、届いた値を使う
    ent.aimSlopeOverride = (typeof evt.slope==='number') ? evt.slope : null;
    // 当たりはゲストが引いた番号をそのまま使う(引き直すと音と効果が食い違う)
    ent.seVariantOverride = (typeof evt.sev==='number') ? evt.sev : null;
    fireMove(ent, targetPoint, mv);
    ent.aimSlopeOverride = null;
    ent.seVariantOverride = null;
    ent.fireCooldown = effectiveCooldown(ent, mv);
    if(hasLagComp){
      ent.x=savedX; ent.y=savedY;
      // 生成された飛び道具に遅延量を刻む。飛翔中の当たり判定を「一定遅延の敵位置」で行う(combat.js)
      for(let k=projBefore; k<projectiles.length; k++) projectiles[k].lagDelaySeq = lagDelaySeq;
    }
    // 計測ハーネス用: ゲストの発射イベントが実弾になった時刻を記録(通常は素通り)
    if(window.__netProbe) __netProbe.mark('remoteFireSpawn', { srcTs: evt.ts||0, now: Date.now(), n: projectiles.length - projBefore });
  }
}

function sendLocalInputIfMultiplayer(now){
  if(netState.mode!=='multi' || !netState.roomId) return;
  if(now-lastInputSendAt >= inputSendInterval()*1000){
    lastInputSendAt = now;
    selfInputSeq++;
    // この入力を送った時点の自分の予測位置を先に覚えておく。
    // ホストが「このseqまで適用した」と返してきたとき、同じ時点どうしで誤差を比較する
    if(player && !netState.isHost){
      // t: 送った時刻。ホストが aseq で返してきたときに往復(RTT)を測るのに使う(F-10)
      selfPredHistory.push({ seq:selfInputSeq, x:player.x, y:player.y, t:now });
      if(selfPredHistory.length > SELF_HISTORY_CAP) selfPredHistory.shift();
    }
    window.__aramonSendInput(netState.roomId, {
      mx: player? player.inputMoveX:0,
      my: player? player.inputMoveY:0,
      facing: player? player.facingAngle:0,
      moveTierSelected: player? player.moveTierSelected:1,
      seq: selfInputSeq,
      dashSeq: selfDashSeq, // ダッシュは連続値ではなく回数で伝える(ホストは増えた分だけ実行する)
      cardSeq: selfCardSeq, // トレーニングカードの選択も回数で伝える(取りこぼし・二重適用を防ぐ)
      cardPick: selfCardPick,
    });
  }
}

// 自分が実際に1回発射した瞬間だけ、単発イベントとして送信する
// (ホストはこれを見て、非ホストの発射をシミュレーションに反映する)
function sendFireEventIfMultiplayer(aimAngle, mv, aimSlope, seVarIndex){
  if(netState.mode!=='multi' || !netState.roomId || netState.isHost) return;
  // 計測ハーネス用: 発射イベントの送信時刻を記録(通常は__netProbe未定義で素通り)
  if(window.__netProbe) __netProbe.mark('fireSent', { ts: Date.now() });
  window.__aramonSendFireEvent(netState.roomId, {
    sourceNetId: netState.myPlayerId,
    facing: aimAngle,
    // リアルマップの上下のねらい。ホストは自分のカメラしか持っていないので必ず送る
    slope: aimSlope || 0,
    moveTier: player.moveTierSelected,
    sev: (seVarIndex!=null) ? seVarIndex : null,   // 引いた当たりの番号(ホストが同じ結果で判定する)
    // ③ ラグ補正用: 撃った瞬間の自分の位置(予測=正確)と、その時見ていたホストseq
    fx: Math.round(player.x), fy: Math.round(player.y),
    viewSeq: guestCurViewSeq,
    ts: Date.now(),
  });
}

// 非ホスト専用: ダメージ・ガッツの確定計算はホストに任せつつ、
// クールダウン管理と「発射しました」イベント送信、体感のための見た目の弾だけを担当する
function tryNonHostPlayerFireVisual(dt){
  if(!player.alive || player.fireCooldown>0) return;
  // 凍結中は撃てない(ホストのtryPlayerFireと同じ条件にそろえる)。
  // ここを見ていないと、ゲストだけ凍結中に撃てる/撃ったのにホストが実行せず
  // 見た目だけの弾が飛ぶ、という食い違いになる
  if(player.freezeUntil > matchTime) return;
  if(entityDowned(player)) return; // ダウン中は撃てない(tryPlayerFire/processRemoteFireEventsと同じ条件)
  if(!(fireBtnHeld || keys['f'])) return;
  // combat.jsのfireMoveと同じく、スキン装備でtier3が専用技に変わる場合は先に解決する
  let mv = activeMove(player);
  if(typeof skinTier3Move==='function') mv = skinTier3Move(mv, player);
  /* 当たり(音・色・追加効果)は**撃つ側が1度だけ引く**。番号を発射イベントに載せて送り、
     ホストは同じ番号で判定するので、見た目と実際の効果が必ず一致する。 */
  const seVar = (typeof rollSkinTier3Variant==='function') ? rollSkinTier3Variant(player, mv) : null;
  /* ガッツ不足の判定は combat.js の playerGutsShort() が正(FIREボタンを沈ませる印も同じ関数を見る)。
     ここに同じ式を書くと、沈んでいるのに撃てる/撃てないのに沈まない、が起きる */
  if(playerGutsShort()){ warnGutsShortage(); return; }
  const aimAngle = player.facingAngle;

  // クールダウン・見た目のガッツ消費だけローカルで進める(実値はホストのauthStateで上書きされる)
  player.fireCooldown = effectiveCooldown(player, mv);
  player.guts = Math.max(0, player.guts - effectiveGutsCost(player, mv));
  const effProjSpeed = effectiveProjSpeed(player, mv);
  // リアルマップの上下のねらい(通常マップでは0)。ホスト側の再現用に発射イベントでも送る
  const onReal3d = isReal3dMap();
  const projGrav = onReal3d ? projGravityFor(mv.range, effProjSpeed) : 0;
  const aimSlope = fireAimSlope(player, null, mv.range, effProjSpeed, projGrav);
  const muzzleZ = projectileMuzzleZ(player);
  const hbMult = ELEMENTS[player.element].hitboxMult || 1;
  const sp = moveSeName(mv, player); // tier3技の専用SE(無ければnull。ゼウス等のスキン専用SEも反映)
  // combat.jsのfireMoveと同じ見た目情報(スタイル・オーラ色・SSR色替え)を付与し、
  // ゲスト自身のtier3エフェクトがホストと同じ見た目で描画されるようにする
  const moveAura = (typeof getMoveAura==='function') ? getMoveAura(mv, player) : (mv.aura||null);
  const effColor = (seVar && seVar.color) ? seVar.color
                 : ((typeof getMoveEffectColor==='function') ? getMoveEffectColor(mv, player) : mv.color);
  /* 差し色も当たりの色にする。**GPUの粒や尾はこの色で描く**ので、ここを変えないと
     枠だけ色が変わって中身が元の色のまま、という半端な見え方になる(実際にそうなった)。
     オーラ(moveAura=相性)は触らないので、有利不利は今までどおり。 */
  const auraTint = (seVar && seVar.color) ? seVar.color
                 : ((typeof getMoveAuraTint==='function') ? getMoveAuraTint(mv, player) : null);
  // 白黒オーラのSSR tier3だけに付く差し色の向き(combat.js と同じ。詳細は data.js の getMoveAuraAccent)
  const auraAccent = (typeof getMoveAuraAccent==='function') ? getMoveAuraAccent(mv, player) : null;

  if(mv.aoeShape){
    const width = (mv.rectWidth||mv.beamWidth||mv.zigzagWidth||0) * hbMult;
    const fillSpeed = Math.max(200, effProjSpeed||900);
    // combat.jsのfireMoveと同じく、連射(burst)ぶんを角度をずらして順番に出す。
    // 1発しか出していなかったため、ライトニング等の連射技がゲストだけ1発に見えていた。
    const burstCount = mv.burst || 1;
    const burstGap = mv.burstGap || 0;
    const buildVisualAe = (ang)=>{
      const beamRanges = mv.aoeShape==='beams'
        ? Array.from({length:mv.beamCount||3}, (_,b)=>{
            const spread=(mv.beamSpreadDeg||40)*Math.PI/180, count=mv.beamCount||3;
            const off=count>1 ? (b/(count-1)-0.5)*spread : 0;
            return moveReachDistance(mv, player.x, player.y, ang+off);
          })
        : undefined;
      // 貫通技(pierce)は遮蔽物で止まらない。判定は combat.js の moveReachDistance 1か所
      const reach = beamRanges ? Math.max(...beamRanges) : moveReachDistance(mv, player.x, player.y, ang);
      return {
        id:nextId++, ownerId:player.id, kind:mv.aoeShape, x:player.x, y:player.y, z:player.z,
        angle:ang, color:effColor, range: beamRanges ? mv.range : reach, width,
        fanAngleDeg:mv.fanAngleDeg||45, beamCount:mv.beamCount||3, beamSpreadDeg:mv.beamSpreadDeg||40,
        beamRanges, fillSpeed, telegraphTime:0.18,
        spawnAt:matchTime, life: 0.18 + reach/fillSpeed + 0.25,
        style:mv.aoeStyle||null, moveAura, auraTint, auraAccent,
        glareEyes: !!mv.glareEyes,   // 睨む眼(ホスト側の buildAe と同じ印)
        glareTint: (seVar && seVar.color) || null,
      };
    };
    let firstLife = 0;
    for(let i=0;i<burstCount;i++){
      const spreadStep = (mv.burstSpread!=null ? mv.burstSpread : 0.05); // 技ごとに連射の広がりを変えられる
      const spreadOffset = burstCount>1 ? (i-(burstCount-1)/2)*spreadStep : 0;
      const ang = aimAngle + spreadOffset;
      if(i===0){
        const ae = buildVisualAe(ang);
        firstLife = ae.life;
        areaEffects.push(ae);
      } else {
        // 2発目以降は発射時刻になってから生成する(ホスト側と同じくpendingAoeCastsで待つ)
        pendingAoeCasts.push({ at: matchTime + i*burstGap, attackerId:player.id, aimAngle:ang, build: buildVisualAe });
      }
    }
    const life = firstLife + (burstCount-1)*burstGap;
    lockMoveFacing(player, aimAngle, life);
    playSe(sp || 'fire', sp ? { dur: life } : { kind:'aoe', dur: life });
  } else if(mv.lobbed){
    const throwDist = mv.range;
    const landX = player.x + Math.cos(aimAngle)*throwDist;
    const landY = player.y + Math.sin(aimAngle)*throwDist;
    const flightTime = throwDist / effProjSpeed;
    projectiles.push({
      x:player.x, y:player.y, z:player.z,
      lobbed:true, startX:player.x, startY:player.y, startZ:player.z,
      landZ: (typeof getTerrainHeightAt==='function') ? getTerrainHeightAt(landX, landY) : 0,
      landX, landY, arcHeight: mv.arcHeight||120,
      flightTime: Math.max(0.05, flightTime), flightT:0,
      color:effColor, hitR:mv.hitR*hbMult, hitW:0, visualOnly:true, icon:mv.icon, shape:mv.shape,
      projStyle:mv.projStyle||null, moveAura,
    });
    lockMoveFacing(player, aimAngle, Math.max(0.05, flightTime));
    playSe(sp || 'fire', sp ? { dur: Math.max(0.05, flightTime) } : { kind:'single' });
  } else if(mv.multiOrb){
    // ゴッドライジング等: 赤青黄緑の光球を放射線状に。見た目専用(当たり判定はホスト)
    const colors = mv.multiOrb;
    const orbAuras = mv.orbAuras || [];
    const n = colors.length;
    const spread = (mv.orbSpreadDeg||9)*Math.PI/180;
    for(let i=0;i<n;i++){
      const off = n>1 ? ((i-(n-1)/2)/(n-1))*spread : 0;
      const ang = aimAngle + off;
      projectiles.push({
        x:player.x, y:player.y, z:muzzleZ,
        vx:Math.cos(ang)*effProjSpeed, vy:Math.sin(ang)*effProjSpeed, vz:aimSlope*effProjSpeed, terrain3d:onReal3d, grav:projGrav,
        color:colors[i], hitR:(mv.hitR||24)*hbMult, hitW:0,
        traveled:0, maxRange:mv.range, delay:0, visualOnly:true,
        projStyle:'godorb', orbColor:colors[i], moveAura: orbAuras[i] || moveAura, matchAura: moveAura,
        // 見た目命中時の予測ダメージ(見た目専用。確定はホスト)
        predDmg: Math.round(effectiveMoveDmg(player, mv)),
        ownerId: player.id,
      });
    }
    lockMoveFacing(player, aimAngle, mv.range/effProjSpeed);
    playSe(sp || 'fire', sp ? { dur: mv.range/effProjSpeed } : { kind:'single' });
  } else if(!mv.melee){
    const burstCount = mv.burst || 1;
    const burstGap = mv.burstGap || 0;
    // 横並びの発射(ホスト側の fireMove と同じ式)
    const sideStep = mv.burstSideStep || 0;
    const sideX = -Math.sin(aimAngle), sideY = Math.cos(aimAngle);
    for(let i=0;i<burstCount;i++){
      const spreadStep = (mv.burstSpread!=null ? mv.burstSpread : 0.05); // 技ごとに連射の広がりを変えられる
      const spreadOffset = burstCount>1 ? (i-(burstCount-1)/2)*spreadStep : 0;
      const ang = aimAngle + spreadOffset;
      const sideOff = (burstCount>1 ? (i-(burstCount-1)/2) : 0) * sideStep;
      projectiles.push({
        x:player.x + sideX*sideOff, y:player.y + sideY*sideOff, z:muzzleZ,
        vx:Math.cos(ang)*effProjSpeed, vy:Math.sin(ang)*effProjSpeed, vz:aimSlope*effProjSpeed, terrain3d:onReal3d, grav:projGrav,
        color:effColor, hitR:mv.hitR*hbMult, hitW:(mv.hitW||0)*hbMult,
        traveled:0, maxRange:mv.range, delay: i*burstGap, visualOnly:true, icon:mv.icon, shape:mv.shape,
        projStyle:mv.projStyle||null, projVariant: mv.projVariant||null, moveAura,
        // burstTints があれば連射の何発目かで色を変える(ホスト側の fireMove と同じ式)
        auraTint: (mv.burstTints && mv.burstTints[i % mv.burstTints.length]) || auraTint,
        auraAccent,
        growWithDistance: mv.growWithDistance||false, baseHitR: mv.hitR*hbMult, burstIndex:i,
        // 着弾ドーム(ビッグバン/ヴァニッシュ)。これを持たせないと、着弾時にゲスト側で
        // 爆風を出せないうえ、ホストからのエコーは「自分の弾」として弾かれるため
        // 自分で撃ったときだけ爆発が一切見えなくなる
        blast: mv.blast||null,
        // 見た目命中時の予測ダメージ(見た目専用の概算。確定の実数字はホストのauthState側)
        predDmg: Math.round(effectiveMoveDmg(player, mv)),
        ownerId: player.id,
      });
    }
    lockMoveFacing(player, aimAngle, mv.range/effProjSpeed + burstGap*Math.max(0, burstCount-1));
    playSe(sp || 'fire', sp ? { dur: mv.range/effProjSpeed } : { kind: mv.burst ? 'burst' : 'single' });
  } else {
    lockMoveFacing(player, aimAngle, MOVE_FACING_LOCK_MELEE_DUR);
    spawnHit(player.x + Math.cos(aimAngle)*mv.range*0.5, player.y + Math.sin(aimAngle)*mv.range*0.5, player.z, effColor);
    playSe('fire', { kind:'single' });
  }

  sendFireEventIfMultiplayer(aimAngle, mv, aimSlope, seVar ? seVar.index : null);
}

// ===== ホスト専用: 命中報告を確定計算し、authStateとして配信 =====
const processedHitKeys = new Set();
let authPublishTimer = 0;
let authPublishInFlight = false;
// authStateの配信間隔(秒)。rtdb=約20回/秒(quota都合)。高頻度配信+クライアント側補間で滑らかさを両立する。
// 全ゲストとWebRTC直結できている間だけ約30回/秒へ上げる(1人でもrtdbのゲストが
// いる間はRTDBへの書き込みが続くので現行レートを守る)
const AUTH_PUBLISH_INTERVAL_RTDB = 0.05;
const AUTH_PUBLISH_INTERVAL_RTC  = 0.033;
function authPublishInterval(){
  return (window.NetTransport && NetTransport.isRtcActiveAllPeers())
    ? AUTH_PUBLISH_INTERVAL_RTC : AUTH_PUBLISH_INTERVAL_RTDB;
}

function processHitAsHost(hit){
  if(!hit) return;
  const target = entities.find(e=>
    (hit.targetNetId && e.netPlayerId===hit.targetNetId) || (!hit.targetNetId && e.id===hit.targetLocalId)
  );
  const source = hit.sourceNetId ? entities.find(e=>e.netPlayerId===hit.sourceNetId)
                 : (hit.sourceLocalId!=null ? entities.find(e=>e.id===hit.sourceLocalId) : null);
  if(!target || !target.alive) return;
  applyDamage(target, hit.dmg, source||null, {authoritative:true, moveAura: hit.moveAura||null, matchAura: hit.matchAura||null});
}

// 全エンティティ(ボット含む)を id(全クライアント共通の決定的な採番) をキーに配信する。
// 以前は netPlayerId を持つ人間プレイヤーしか配信していなかったため、非ホスト側でボットが
// 一切動かず止まって見える不具合の直接の原因になっていた。
// ホスト専用: 新しく発生した弾/範囲攻撃を検知し、取りこぼしのないイベントとして全員に配信する。
// (authStateのような周期上書き配信だと、寿命の短い弾は次の配信までに消えてしまい
//  「相手の弾が見えない」原因になるため、発生の瞬間を専用チャンネルで確実に届ける)
let lastBroadcastProjIds = new Set();
let lastBroadcastAeIds = new Set();
function broadcastNewShotsAsHost(){
  const curProjIds = new Set();
  for(const p of projectiles){
    if(p.id==null) continue;
    curProjIds.add(p.id);
    if(lastBroadcastProjIds.has(p.id)) continue;
    const owner = p.ownerId!=null ? entities.find(e=>e.id===p.ownerId) : null;
    window.__aramonPushShotEvent(netState.roomId, {
      type:'proj', sourceNetId: (owner && owner.netPlayerId) || null, ownerId: p.ownerId!=null ? p.ownerId : null,
      x:Math.round(p.x), y:Math.round(p.y), z:Math.round(p.z||0),
      vx:p.vx||0, vy:p.vy||0, vz:p.vz||0, grav:p.grav||0, terrain3d:!!p.terrain3d, color:p.color, hitR:p.hitR, hitW:p.hitW||0,
      maxRange:p.maxRange||0, icon:p.icon||null, shape:p.shape||null,
      projStyle:p.projStyle||null, projVariant:p.projVariant||null,
      orbColor:p.orbColor||null, auraTint:p.auraTint||null, auraAccent:p.auraAccent||null, moveAura:p.moveAura||null,
      lobbed:!!p.lobbed, landX:p.landX||0, landY:p.landY||0, landZ:p.landZ||0, arcHeight:p.arcHeight||0, flightTime:p.flightTime||0,
    });
  }
  lastBroadcastProjIds = curProjIds;

  const curAeIds = new Set();
  for(const ae of areaEffects){
    if(ae.id==null) continue;
    curAeIds.add(ae.id);
    if(lastBroadcastAeIds.has(ae.id)) continue;
    const owner = ae.ownerId!=null ? entities.find(e=>e.id===ae.ownerId) : null;
    window.__aramonPushShotEvent(netState.roomId, {
      type:'aoe', sourceNetId: (owner && owner.netPlayerId) || null,
      /* 撃った本人のid。**これが無いとゲスト側で属性が分からず、技のエフェクトが
         既定の見た目に落ちる**(弾には元から付いていたので弾だけ正しく出ていた)。
         fx_moves.js の作り分けは属性で引くので、ここを落とすとマルチだけ画が痩せる。 */
      ownerId: ae.ownerId!=null ? ae.ownerId : null,
      kind:ae.kind, x:Math.round(ae.x), y:Math.round(ae.y), angle:ae.angle, color:ae.color,
      range:ae.range, width:ae.width, fanAngleDeg:ae.fanAngleDeg, beamCount:ae.beamCount,
      beamSpreadDeg:ae.beamSpreadDeg, life:ae.life, fillSpeed:ae.fillSpeed, telegraphTime:ae.telegraphTime,
      beamRanges:ae.beamRanges||null, style:ae.style||null, auraTint:ae.auraTint||null, auraAccent:ae.auraAccent||null, moveAura:ae.moveAura||null,
      glareEyes: ae.glareEyes ? 1 : 0,   // 睨む眼(これが無いと他の人の画面に眼が出ない)
      glareTint: ae.glareTint || null,
      doorDist:ae.doorDist||0, // 羅生門(kind:'gate')の門の位置。ゲストは自分で遮蔽物の再計算をしないのでそのまま渡す
    });
  }
  lastBroadcastAeIds = curAeIds;
}
// 非ホスト専用: ホストから届いたアイテムの出現/取得イベントを、自分のlootItems配列にも反映する
const processedLootEventKeys = new Set();
// ゲスト側のアイテム取得先読み。ホストしか取得判定をしないため、そのままだと
// 「重なってもしばらく消えない」「効果が遅れて出る」ように見える。
// 重なった瞬間に見た目だけ消し、ホストの確定(pickupイベント)を待つ。
// 確定が来なければ(他の人が先に拾った・ホストの判定では届いていない等)元に戻す。
// 自分の座標がNaN/範囲外になっていないか点検して復旧する。
// 一度でもNaNが入ると以降ずっと描画もされず操作もできなくなる(フリーズしたように見える)ので、
// 直前の正常な位置(無ければマップ中央)へ戻して必ず動ける状態を保つ。
let lastGoodSelfPos = null;
function sanitizeSelfPosition(){
  if(!player) return;
  const ok = Number.isFinite(player.x) && Number.isFinite(player.y) && Number.isFinite(player.z||0)
    && player.x > -1e4 && player.y > -1e4 && player.x < WORLD.w+1e4 && player.y < WORLD.h+1e4;
  if(ok){ lastGoodSelfPos = { x:player.x, y:player.y, z:player.z||0 }; return; }
  const fb = lastGoodSelfPos || { x:WORLD.w/2, y:WORLD.h/2, z:0 };
  player.x = fb.x; player.y = fb.y; player.z = fb.z;
  selfCorrX = 0; selfCorrY = 0;
  console.warn('[aramon] self position was invalid; recovered');
}
// 安全圏外・溶岩のダメージ表示をゲスト側で再現する(数字は見た目だけ。HPはauthStateが正)。
// ホストのupdate()内でしか数字を出していないため、ゲストはHPだけが静かに減っていき
// 「なぜ減っているのか分からない」状態だった。安全圏と溶岩の位置は同期済みなので
// ゲスト側でも同じ条件で判定できる。
function showGuestEnvironmentDamage(dt){
  if(!player || !player.alive || !zoneState) return;
  const dps = (typeof currentDps==='function') ? currentDps() : 0;
  if(dps>0 && dist(player, zoneState.center) > zoneState.radius){
    if(Math.random() < 0.08) spawnDmgText(player.x, player.y, player.z, Math.round(dps), '#ff9c3d');
  }
  if(lavaZones && lavaZones.length){
    for(const lz of lavaZones){
      if(Math.hypot(player.x-lz.x, player.y-lz.y) < lz.radius + player.radius*0.4){
        const lavaDps = (currentMap && currentMap.lavaDps) || 20;
        if(Math.random() < 0.12) spawnDmgText(player.x, player.y, player.z, Math.round(lavaDps), '#ff5a1f');
        break;
      }
    }
  }
}
const GUEST_PICKUP_CONFIRM_WAIT = 2.5; // 確定待ちの上限(秒)
// 種類で絞らないので、試合中に増える種類(デス円盤石=deathDisc含む)も自動で先読み対象になる
function predictLootPickupsAsGuest(){
  if(!player || !player.alive) return;
  for(const it of lootItems){
    // 先読み済みの判定は「!= null」で行う(matchTimeが0=試合開始直後だと
    // 真偽値では未先読みと区別できず、開始直後のアイテムが消えなくなる)
    if(it.predictedPickup != null){
      // 一定時間確定が来なければ復活させる(消えたままにならないように)
      if(matchTime - it.predictedPickup > GUEST_PICKUP_CONFIRM_WAIT) it.predictedPickup = null;
      continue;
    }
    if(dist(player, it) < player.radius+14) it.predictedPickup = matchTime; // ホストと同じ判定距離
  }
}
function applyLootEventLocally(evt){
  if(!evt) return;
  if(evt.evtType==='pickup'){
    const idx = lootItems.findIndex(it=>it.id===evt.id);
    if(idx>=0) lootItems.splice(idx,1);
    // 自分(ゲスト)が拾った場合はSEと効果メッセージを出す
    // (ホスト側のupdateでは自分のSE/トーストは鳴らないため、ここで再現する)
    if(evt.by && evt.by===netState.myPlayerId){
      playSe(evt.kind==='deathDisc' ? 'chupiin' : (evt.kind==='training' ? 'train' : 'pickup'));
      if(evt.msg) pushToast(evt.msg);
      // トレーニングは候補3枚が届く。**抽選はホストなので、ゲストは出すだけ**
      if(Array.isArray(evt.cards) && evt.cards.length && typeof showTrainCards==='function') showTrainCards(evt.cards);
      /* 修行チケットの技解放。authStateのフル配信でも同じ値が届くが、こちらは取りこぼしの
         無い信頼配送なので、これを正として即座に解放する(遅れて届くフル配信は
         `a.moveTierUnlocked > ent.moveTierUnlocked` の条件で素通りする)。 */
      if(typeof evt.tier==='number' && player && evt.tier > player.moveTierUnlocked){
        player.moveTierUnlocked = Math.min(3, evt.tier);
        player.moveTierSelected = player.moveTierUnlocked;
      }
    }
    /* デス円盤石の山分け: **拾っていない味方**にも効くので、by とは別に受け取り手が届く。
       ステータスの実体は authState のフル配信で来るが、それだけでは
       「何が起きたのか」が分からないので、ここで音と文言を出す。 */
    else if(Array.isArray(evt.mates) && netState.myPlayerId && evt.mates.includes(netState.myPlayerId)){
      playSe('chupiin');
      if(evt.mateMsg) pushToast(evt.mateMsg);
      if(player) spawnDmgText(player.x, player.y, player.z, '💠 継承', DEATH_DISC_ACCENT);
    }
  } else if(evt.evtType==='spawn'){
    if(!lootItems.find(it=>it.id===evt.id)){
      // zは座標から一意に決まるので配信不要(real3dHeightAtは純関数)
      // keys/owner はデス円盤石だけが持つ(ゲストは見た目と持ち主名の表示にしか使わない。適用はホスト)
      lootItems.push({ id:evt.id, kind:evt.kind, type:evt.itemType, x:evt.x, y:evt.y, z:baseTerrainHeightAt(evt.x,evt.y), bob:evt.bob||0,
                       keys:evt.keys||null, owner:evt.owner||null,
                       ownerTeamId:(typeof evt.tid==='number')?evt.tid:null });   // 敵味方の色分け用
    }
  }
}
// 非ホスト専用: ホストから届いた発生イベントを、見た目専用の弾/範囲攻撃として即座に再現する
// (当たり判定・ダメージはホストのauthStateで届くHP側が正なので、ここでは一切計算しない)
function spawnVisualShotFromEvent(evt){
  if(!evt) return;
  // 自分が撃った弾は既にローカルで即座に描画済みなので、ホストからのエコーで二重に描画しない
  if(evt.sourceNetId && evt.sourceNetId===netState.myPlayerId) return;
  if(evt.type==='proj'){
    if(evt.lobbed){
      projectiles.push({
        x:evt.x, y:evt.y, z:evt.z, lobbed:true, startX:evt.x, startY:evt.y, startZ:evt.z,
        landX:evt.landX, landY:evt.landY, landZ:evt.landZ||0, arcHeight:evt.arcHeight||120,
        flightTime:Math.max(0.05, evt.flightTime||1), flightT:0,
        color:evt.color, hitR:evt.hitR, hitW:0, visualOnly:true, icon:evt.icon||undefined, shape:evt.shape||undefined,
        projStyle:evt.projStyle||null, moveAura:evt.moveAura||null,
      });
    } else {
      projectiles.push({
        x:evt.x, y:evt.y, z:evt.z, vx:evt.vx, vy:evt.vy, vz:evt.vz||0, grav:evt.grav||0, terrain3d:!!evt.terrain3d,
        color:evt.color, hitR:evt.hitR, hitW:evt.hitW||0,
        traveled:0, maxRange:evt.maxRange||2000, delay:0, visualOnly:true, icon:evt.icon||undefined, shape:evt.shape||undefined,
        projStyle:evt.projStyle||null, projVariant:evt.projVariant||null,
        orbColor:evt.orbColor||undefined, auraTint:evt.auraTint||null, auraAccent:evt.auraAccent||null, moveAura:evt.moveAura||null,
        ownerId: evt.ownerId!=null ? evt.ownerId : null,
      });
    }
  } else if(evt.type==='aoe'){
    areaEffects.push({
      hostId:null, ownerId: evt.ownerId!=null ? evt.ownerId : null, kind:evt.kind, x:evt.x, y:evt.y, angle:evt.angle, color:evt.color,
      range:evt.range, width:evt.width, fanAngleDeg:evt.fanAngleDeg, beamCount:evt.beamCount,
      beamSpreadDeg:evt.beamSpreadDeg, spawnAt:matchTime, life:evt.life,
      fillSpeed:evt.fillSpeed||900, telegraphTime:evt.telegraphTime||0.18, beamRanges:evt.beamRanges||undefined,
      style:evt.style||null, auraTint:evt.auraTint||null, auraAccent:evt.auraAccent||null, moveAura:evt.moveAura||null,
      glareEyes: !!evt.glareEyes,
      glareTint: evt.glareTint || null,
      doorDist:evt.doorDist||0, // 羅生門の見た目(fx3dGate)が門の位置を読む。hitIdsは付けないので判定はしない(見た目のみ)
    });
  }
}

// レイドの挑戦者が並ぶ位置(ソロ・マルチで同じ計算を使う)
function cy0RaidSpawnY(){ return WORLD.h/2 + WORLD.h*0.18; }
/* 発射元の座標をauthStateに載せる時間。render.jsのHIT_DIR_SEC(0.8秒)より少し長くして、
   配信の間隔で取りこぼさないようにする */
const HIT_SOURCE_SEND_SEC = 1.2;
function buildAuthStatePayload(){
  authPublishSeq++;
  const seq = authPublishSeq;
  // ④ たまに静的値も載せる「フル」配信、それ以外は位置等の軽量配信。
  // アイテム取得直後などは即座に強化値を届けたいので、強制フラグでフルにする
  const full = hostForceFullNext || (seq % AUTH_FULL_EVERY === 0);
  hostForceFullNext = false;
  const nowT = matchTime;                     // ② 速度算出の時刻基準(ホストのmatchTime秒)
  // t: ホストの試合時刻(ms)。ゲストはこれを時間軸にして補間するので、配信が
  // まとめて届いても相手の動きが等速に見える(瞬間移動対策)
  const payload = { seq, full, t: Math.round(matchTime*1000), zone:{
    cx: Math.round(zoneState.center.x), cy: Math.round(zoneState.center.y),
    r: Math.round(zoneState.radius), phase: zoneState.phaseIndex, shrinking: zoneState.shrinking,
    // フェーズ内経過秒。これを送らないとゲストのzoneState.timerが0のままで、
    // 「次の縮小まであと何秒」のカウントダウンが一切進まない(縮小に備えられない)
    tm: Math.round(zoneState.timer*10)/10,
    tcx: Math.round(zoneState.toCenter.x), tcy: Math.round(zoneState.toCenter.y),
    tr: Math.round(zoneState.toRadius), hasNext: !!zoneState.hasNext,
  }, aliveCount: entities.filter(e=>e.alive).length, entities: [] };
  const hist = {}; // ③ ラグ補正用の位置履歴
  for(const e of entities){
    // ② 前回配信位置との差分から速度(px/秒)を求め、ゲストの外挿に使う
    const prev = lastPubPos[e.id];
    let vx=0, vy=0;
    if(prev){ const dtp = nowT - prev.t; if(dtp > 0.0001){ vx=(e.x-prev.x)/dtp; vy=(e.y-prev.y)/dtp; } }
    lastPubPos[e.id] = { x:e.x, y:e.y, t:nowT };
    hist[e.id] = { x: Math.round(e.x), y: Math.round(e.y) };
    // 毎tick載せる「ホット」フィールド(位置・向き・速度・HP・ガッツ・生存・キル等)
    const o = {
      id: e.id,
      // レイドの貢献度。ゲストは自分でダメージ計算をしないので、これが唯一の正
      ...(game.raid ? { rd: Math.round(e.raidDamage||0) } : {}),
      x: Math.round(e.x), y: Math.round(e.y), z: Math.round(e.z||0),
      f: Math.round((e.facingAngle||0)*1000)/1000,
      vx: Math.round(vx*10)/10, vy: Math.round(vy*10)/10,
      hp: Math.round(e.hp), guts: Math.round(e.guts),
      alive: e.alive, kills: e.kills, damageDealt: Math.round(e.damageDealt),
      placement: e.placement||null,
    };
    // 移動に効く状態異常は「残り秒数」で毎tick送る。絶対時刻で送るとホストとゲストの
    // matchTimeのズレでそのまま食い違うため。これを送らないとゲストは凍結/鈍足を知らずに
    // 通常速度で予測してしまい、ホスト位置との差が開いて引き戻される
    // (川など低速地形では前進できず操作不能に見えていた)
    const fzR = (e.freezeUntil||0) - nowT;
    if(fzR > 0) o.fz = Math.round(fzR*100)/100;
    const slR = (e.slowUntil||0) - nowT;
    if(slR > 0) o.sl = Math.round(slR*100)/100;
    const sbR = (e.speedBuffUntil||0) - nowT;
    if(sbR > 0){ o.sb = Math.round(sbR*100)/100; o.sbm = e.speedBuffMult||1; }
    // やけど・どくも残り秒数で送る。これが無いとゲストでは状態表示(ピル)も
    // エンティティの燃焼/毒エフェクトも一切出ず、何を受けているのか分からない
    const bnR = (e.burnUntil||0) - nowT;
    if(bnR > 0) o.bn = Math.round(bnR*100)/100;
    const poR = (e.poisonUntil||0) - nowT;
    if(poR > 0) o.po = Math.round(poR*100)/100;
    /* 【被弾方向マーカー(B-1)】ゲストは自分の被弾を「HPが減ったこと」でしか知らず
       (applyAuthStateのhp差分。ゲストの自分にapplyDamageは走らない)、**誰に撃たれたかが
       どこにも届いていない**。直近に撃たれたときだけ発射元の座標を載せる。
       表示は0.8秒なので、載せる窓もそれに合わせた短い間だけでよい。 */
    if(e.lastHitAt && nowT - e.lastHitAt < HIT_SOURCE_SEND_SEC){
      o.lhx = Math.round(e.lastHitFromX); o.lhy = Math.round(e.lastHitFromY);
    }
    // チーム戦: ダウンの残り秒数(dw)と蘇生の進み(rv)。絶対時刻は送らない(残り秒数方式)。
    // dwが載っていない=ダウンしていない、として受信側が判定する
    if(e.downed && e.alive){
      o.dw = Math.round(Math.max(0, (e.downedUntil||0) - nowT)*100)/100;
      if(e.reviveProgress > 0) o.rv = Math.round(e.reviveProgress*100)/100;
    }
    // 人間プレイヤーには「最後に適用した入力seq」を返す(ゲストの位置突き合わせ用)
    if(e.netPlayerId && typeof e.netAckInputSeq==='number') o.aseq = e.netAckInputSeq;
    // ④ フル配信の時だけ載せる「コールド」フィールド(ほぼ静的・低頻度で十分)
    if(full){
      o.maxHp = e.maxHp; o.maxGuts = e.maxGuts;
      o.moveTierUnlocked = e.moveTierUnlocked; o.moveTierSelected = e.moveTierSelected;
      o.trainCooldownMult = e.trainCooldownMult; o.trainGutsCostReduction = e.trainGutsCostReduction;
      o.trainProjSpeedMult = e.trainProjSpeedMult; o.trainDmgMult = e.trainDmgMult;
      o.trainDmgTakenMult = e.trainDmgTakenMult; o.trainSpeedMult = e.trainSpeedMult;
      /* 育成の倍率と移動速度。**トレーニングカードでこれらが試合中に変わる**ので同期する。
         カードが無かった頃は両側が試合開始時に同じ値を作っていたため送っていなかった。 */
      o.mmDD = e.mastermonDmgDealtMult; o.mmDT = e.mastermonDmgTakenMult;
      o.mmGR = e.mastermonGutsRegenMult; o.mmCD = e.mastermonCooldownMult;
      o.spd = Math.round((e.speed||0)*100)/100;
      // 状態変化も「残り秒数」で送る(絶対時刻だとホストとゲストのmatchTimeのズレで
      // 効果時間が伸び縮みする)。0以下の場合は送らない=切れている扱い
      const stR = (e.stateUntil||0) - nowT;
      if(stR > 0) o.stR = Math.round(stR*100)/100;
      const stcR = (e.stateCooldownUntil||0) - nowT;
      if(stcR > 0) o.stcR = Math.round(stcR*100)/100;
      o.dashCooldown = Math.round((e.dashCooldown||0)*100)/100;
      o.trainMaxHpBonus = e.trainMaxHpBonus||0;
      // 撃破EXPボーナスはゲスト側では計算されないので、リザルトで反映できるよう同期する
      o.mmKillExp = Math.round(e.mastermonKillExpBonus||0);
    }
    payload.entities.push(o);
  }
  hostPosHistory.push({ seq, ents: hist });
  if(hostPosHistory.length > HOST_HISTORY_CAP) hostPosHistory.shift();
  return payload;
}

// 非ホスト側: 自分以外の全エンティティはホストの値へ「補間目標」を更新するだけにし、
// 実際の座標移動は毎フレームのlerpで滑らかに追従させる(loop()内で処理)。
// 自分自身は入力予測を活かしつつ、大きくズレた時だけ軽く補正する。
function applyAuthState(authState){
  if(!authState) return;
  if(authState.zone){
    zoneState.center.x = authState.zone.cx;
    zoneState.center.y = authState.zone.cy;
    zoneState.radius = authState.zone.r;
    zoneState.phaseIndex = authState.zone.phase;
    zoneState.shrinking = authState.zone.shrinking;
    if(typeof authState.zone.tm === 'number') zoneState.timer = authState.zone.tm; // 縮小までの残り秒数の表示用
    if(typeof authState.zone.tcx === 'number'){
      zoneState.toCenter.x = authState.zone.tcx;
      zoneState.toCenter.y = authState.zone.tcy;
      zoneState.toRadius = authState.zone.tr;
      zoneState.hasNext = !!authState.zone.hasNext;
    }
  }
  const list = Array.isArray(authState.entities) ? authState.entities : [];
  const isFull = !!authState.full; // 静的値(train系・状態変化等)が載っている配信かどうか
  const snapEnts = {}; // ① このスナップショットの位置(自分以外)を補間バッファへ
  for(const a of list){
    const ent = entities.find(e=>e.id===a.id);
    if(!ent) continue;
    if(ent.isPlayer){
      // 自分の位置: ホストが「このseqの入力まで反映した」と返してきた時点の
      // 自分の予測位置と比べ、その誤差だけを補正量として溜める。
      // 現在位置と比べると遅延ぶんがそのまま誤差になり、移動中ずっと後ろへ
      // 引っ張られてしまう(水中では前進できず操作不能になっていた)。
      let errX = null, errY = null;
      if(typeof a.aseq==='number' && selfPredHistory.length){
        let hist = null;
        for(let i=selfPredHistory.length-1;i>=0;i--){
          if(selfPredHistory[i].seq===a.aseq){ hist = selfPredHistory[i]; break; }
        }
        if(hist){
          errX = a.x - hist.x; errY = a.y - hist.y;
          // 遅延の実測(F-10): 「この入力を送ってから、それを反映した配信が届くまで」の往復。
          // 押してから世界に反映されるまでの体感そのものなので、これをHUDに出す
          // **同じaseqが何度も返る**(ホストが次の入力を適用するまで)ので、測るのは最初の1回だけ。
          // 2回目以降まで数えると、届くのが遅れたぶんだけRTTが実際より長く出る
          if(typeof hist.t === 'number'){ noteNetRtt(performance.now() - hist.t); hist.t = null; }
          // 適用済みより古い履歴は破棄
          while(selfPredHistory.length && selfPredHistory[0].seq < a.aseq) selfPredHistory.shift();
        }
      }
      if(errX===null){
        // ackがまだ無い(参加直後など)場合のみ現在位置と比較する従来方式にフォールバック
        errX = a.x - ent.x; errY = a.y - ent.y;
      }
      const err = Math.hypot(errX, errY);
      // ダッシュ中/直後は許容を広げる(ホストがダッシュを受け取るまでの一時的なズレを補正しない)
      const dashing = (ent.dashTimer>0) || (matchTime - (ent.lastDashAt!=null?ent.lastDashAt:-99) < SELF_DASH_GRACE);
      // 速いモンスターほど許容を広げる(固定距離だと前進中ずっと補正が掛かって飛ぶ)
      const scale = selfCorrectSpeedScale(ent);
      const deadzone = (dashing ? SELF_CORRECT_DEADZONE_DASH : SELF_CORRECT_DEADZONE) * scale;
      if(err > SELF_CORRECT_SNAP * Math.min(scale, SELF_CORRECT_SNAP_SCALE_MAX)){
        ent.x = a.x; ent.y = a.y; selfCorrX = 0; selfCorrY = 0; // 壁抜け等は即座に合わせる
      } else if(err > deadzone){
        selfCorrX = errX; selfCorrY = errY; // 毎フレーム少しずつ消費して滑らかに寄せる
      } else {
        selfCorrX = 0; selfCorrY = 0;       // 誤差が小さいうちは予測を信頼して一切動かさない
      }
    } else {
      // 自分以外は位置を即書きせず、補間(interpolateRemoteEntities)で滑らかに動かす。
      // 初回だけは位置が無いので即座に配置しておく。
      if(typeof ent.x!=='number' || typeof ent.y!=='number'){ ent.x=a.x; ent.y=a.y; ent.z=a.z; ent.facingAngle=a.f; }
    }
    // 位置以外の権威フィールドは受信時に即反映する(補間しない)
    const prevHp = ent.hp;   // ゲストの被弾フィードバック用(下)
    ent.hp = a.hp; ent.guts = a.guts;
    // 計測ハーネス用: HPが画面に反映された時刻を記録(通常は素通り)
    if(window.__netProbe) __netProbe.hp(a.id, a.hp);
    /* ゲストの戦闘フィードバック即時化: HPが下がった瞬間に「攻撃を受けた」合図を出す(確定値ベース)。
       ホストではapplyDamageが担う演出(被弾SE・ヒットフラッシュ・ダメージ数字)で、
       ゲストはHPだけが静かに減っていた。安全圏・溶岩の環境ダメージは1配信あたり数HPで
       showGuestEnvironmentDamageが担当しているので、それより大きい減りだけを攻撃とみなす */
    const hpDrop = prevHp - ent.hp;
    if(game.started && ent.alive && hpDrop >= GUEST_HIT_FEEDBACK_MIN){
      ent.hitFlash = 0.18;
      // 自分の被弾はSEも鳴らす(ホストのapplyDamageと同じ)。数字は全エンティティに出す
      // (ホスト画面では周囲の戦闘もダメージ数字で見えているので、ゲストも同じ絵にする)
      if(ent.isPlayer) playSe(skinHitSeName(ent) || 'hitTaken');
      spawnDmgText(ent.x, ent.y, ent.z, Math.round(hpDrop));
    }
    /* 被弾方向マーカー(B-1)の材料。ホストが載せてきた発射元の座標をそのまま控える。
       時刻はゲスト自身のmatchTimeで打ち直す(絶対時刻はホストとズレるため、
       状態異常を残り秒数で送っているのと同じ理由) */
    if(a.lhx != null){ ent.lastHitFromX = a.lhx; ent.lastHitFromY = a.lhy; ent.lastHitAt = matchTime; }
    if(typeof a.maxHp==='number') ent.maxHp = a.maxHp;
    if(typeof a.maxGuts==='number') ent.maxGuts = a.maxGuts;
    /* 予測命中の確定(F-11)。**自分の与ダメが増えたことがホストの確定の証拠**。
       相手のHPの減りで見ると他人が与えたぶんまで自分の手柄に数えてしまうので使わない。 */
    if(ent.isPlayer && typeof a.damageDealt === 'number'){
      if(guestPredDmgDealt != null && a.damageDealt > guestPredDmgDealt){
        confirmGuestPredHits(a.damageDealt - guestPredDmgDealt);
      }
      guestPredDmgDealt = a.damageDealt;
    }
    ent.kills = a.kills; ent.damageDealt = a.damageDealt;
    // レイドの貢献度もホストの値をそのまま採用する(ゲストは自分では数えない)
    if(typeof a.rd==='number') ent.raidDamage = a.rd;
    if(a.placement!=null) ent.placement = a.placement;
    // moveTierSelectedは「今どの技を使うか」というプレイヤー自身の選択なので、
    // 自分自身の分だけはホストの(1往復遅れた)値で上書きしない(タップしてもすぐ元に戻る
    // チラつきの原因だった)。ボット・他プレイヤーの表示用には引き続き反映する
    if(!ent.isPlayer && typeof a.moveTierSelected==='number') ent.moveTierSelected = a.moveTierSelected;
    // ダッシュのクールタイムは自分の分だけホスト値で上書きしない。
    // ホストが自分のダッシュを反映するのは1往復あとなので、その間に届く古い0で
    // ローカルのクールタイムが解除され、連続ダッシュできてしまう
    // (moveTierSelectedと同じ理由。ボット・他プレイヤーの表示用には反映する)
    if(!ent.isPlayer && typeof a.dashCooldown==='number') ent.dashCooldown = a.dashCooldown;
    // 移動に効く状態異常は残り秒数で届くので、ローカルのmatchTime基準に直して反映する
    ent.freezeUntil = (typeof a.fz==='number') ? matchTime + a.fz : 0;
    ent.slowUntil   = (typeof a.sl==='number') ? matchTime + a.sl : 0;
    if(typeof a.sb==='number'){ ent.speedBuffUntil = matchTime + a.sb; ent.speedBuffMult = a.sbm||1; }
    else ent.speedBuffUntil = 0;
    ent.burnUntil   = (typeof a.bn==='number') ? matchTime + a.bn : 0;
    ent.poisonUntil = (typeof a.po==='number') ? matchTime + a.po : 0;
    // チーム戦のダウン状態。残り秒数(dw)で届く。無ければダウンしていない
    if(typeof a.dw==='number'){
      ent.downed = true;
      ent.downedUntil = matchTime + a.dw;
      ent.reviveProgress = (typeof a.rv==='number') ? a.rv : 0;
    } else {
      ent.downed = false; ent.downedUntil = 0; ent.reviveProgress = 0;
    }
    if(typeof a.trainMaxHpBonus==='number') ent.trainMaxHpBonus = a.trainMaxHpBonus;
    if(typeof a.mmKillExp==='number') ent.mastermonKillExpBonus = Math.max(ent.mastermonKillExpBonus||0, a.mmKillExp);
    if(typeof a.trainCooldownMult==='number') ent.trainCooldownMult = a.trainCooldownMult;
    if(typeof a.trainGutsCostReduction==='number') ent.trainGutsCostReduction = a.trainGutsCostReduction;
    if(typeof a.trainProjSpeedMult==='number') ent.trainProjSpeedMult = a.trainProjSpeedMult;
    if(typeof a.trainDmgMult==='number') ent.trainDmgMult = a.trainDmgMult;
    if(typeof a.trainDmgTakenMult==='number') ent.trainDmgTakenMult = a.trainDmgTakenMult;
    if(typeof a.trainSpeedMult==='number') ent.trainSpeedMult = a.trainSpeedMult;
    if(typeof a.mmDD==='number') ent.mastermonDmgDealtMult = a.mmDD;
    if(typeof a.mmDT==='number') ent.mastermonDmgTakenMult = a.mmDT;
    if(typeof a.mmGR==='number') ent.mastermonGutsRegenMult = a.mmGR;
    if(typeof a.mmCD==='number') ent.mastermonCooldownMult = a.mmCD;
    if(typeof a.spd==='number') ent.speed = a.spd;
    // 状態変化は残り秒数で届く(フル配信のときだけ載る)。届いた時だけ更新する
    if(isFull){
      ent.stateUntil = (typeof a.stR==='number') ? matchTime + a.stR : 0;
      ent.stateCooldownUntil = (typeof a.stcR==='number') ? matchTime + a.stcR : 0;
    }
    if(typeof a.moveTierUnlocked==='number' && a.moveTierUnlocked>ent.moveTierUnlocked){
      ent.moveTierUnlocked = a.moveTierUnlocked;
      if(ent.isPlayer && ent.moveTierSelected < ent.moveTierUnlocked) ent.moveTierSelected = ent.moveTierUnlocked;
    }
    if(ent.alive && !a.alive){
      ent.alive = false; ent.hp = 0;
      if(ent.isPlayer && !game.over) onPlayerDown();
    }
    if(!ent.isPlayer){
      snapEnts[a.id] = { x:a.x, y:a.y, z:a.z||0, f:a.f, vx:a.vx||0, vy:a.vy||0, alive:a.alive };
    }
  }
  // ① スナップショットをバッファに積む。時間軸はホストの試合時刻(ht)を使う。
  const rtNow = performance.now();
  const ht = (typeof authState.t==='number') ? authState.t : null;
  if(ht!==null){
    // ホスト時刻→ローカル時刻の差を推定する。最小値(=最速で届いた配信)へ寄せることで、
    // 遅れて届いた配信に引きずられて時間軸がぶれるのを防ぐ
    const off = rtNow - ht;
    if(hostClockOffset===null || off < hostClockOffset) hostClockOffset = off;
    else hostClockOffset += (off - hostClockOffset) * 0.002; // 端末間のクロックドリフトへゆっくり追従
  }
  guestSnapBuf.push({ rt: rtNow, ht, seq: authState.seq||0, ents: snapEnts });
  // ホスト時刻がある場合は順序が入れ替わって届いても正しく並べる
  if(ht!==null && guestSnapBuf.length>1 && guestSnapBuf[guestSnapBuf.length-2].ht!==null){
    guestSnapBuf.sort((p,q)=> (p.ht||0)-(q.ht||0));
  }
  const cutoff = rtNow - 1500;
  while(guestSnapBuf.length>2 && guestSnapBuf[0].rt < cutoff) guestSnapBuf.shift();
}
// ① 遠隔エンティティを「一定遅延の描画時刻」で直近2スナップショット間を補間(欠落時は②速度で外挿)
function interpolateRemoteEntities(){
  const buf = guestSnapBuf;
  if(buf.length===0) return;
  // ホスト時刻が使えるならその時間軸で、無ければ従来の受信時刻で補間する。
  // ホスト時刻を使うとスナップショット間隔が常に正しくなるので、配信がまとめて
  // 届いても速い相手が飛ばずに等速で動いて見える。
  const useHostClock = (buf[buf.length-1].ht!==null && hostClockOffset!==null);
  const timeOf = (s)=> useHostClock ? s.ht : s.rt;
  // 描画遅延はrtc接続中だけ実測に合わせて縮む(updateInterpDelay。rtdb時は120ms固定)
  const renderT = useHostClock
    ? (performance.now() - hostClockOffset - interpDelayMs)
    : (performance.now() - interpDelayMs);
  let s0=null, s1=null;
  for(let i=buf.length-1;i>=0;i--){
    if(timeOf(buf[i]) <= renderT){ s0=buf[i]; s1=buf[i+1]||null; break; }
  }
  if(!s0){ s0=buf[0]; s1=buf[1]||null; } // 描画時刻がバッファ最古より前 → 最古で代用
  guestCurViewSeq = s0.seq||0;            // ③ 今狙いを定めているホストseqを記録(発射イベントで送る)
  const t0 = timeOf(s0);
  for(const e of entities){
    if(e===player || !e.alive) continue;
    const a0 = s0.ents[e.id];
    if(!a0) continue;
    if(s1 && s1.ents[e.id]){
      const a1 = s1.ents[e.id];
      const span = timeOf(s1) - t0;
      const alpha = span>0 ? clamp((renderT - t0)/span, 0, 1) : 0;
      e.x = lerp(a0.x, a1.x, alpha); e.y = lerp(a0.y, a1.y, alpha);
      e.z = lerp(a0.z, a1.z, alpha); e.facingAngle = lerpAngleShort(a0.f, a1.f, alpha);
    } else {
      // 最新スナップより先(欠落/遅延) → 速度で短時間だけ外挿
      const ahead = Math.min(EXTRAP_CAP_MS, Math.max(0, renderT - t0)) / 1000;
      e.x = a0.x + a0.vx*ahead; e.y = a0.y + a0.vy*ahead; e.z = a0.z; e.facingAngle = a0.f;
    }
  }
}


// 1フレーム内で例外が出てもRAFの連鎖を必ず継続させる。
// 例外をそのまま投げるとrequestAnimationFrameが再登録されずゲームが完全に停止し、
// 画面が固まったまま入力も描画も戻らない(次の試合を始めても動かない)。
let loopErrorCount = 0;
function loop(now){
  try{
    lastFrameGapMs = now - lastT;   // dtは0.05で頭打ちなので、実際に飛んだ時間は別に控える
    const dt = Math.min(0.05, lastFrameGapMs/1000);
    lastT = now;
    // パフォーマンス計測(管理者画面でONのときだけ実際に時計を読む)
    if(typeof perfFrameStart==='function') perfFrameStart(now);

    if(game.started && !game.over){
      if(introState.active){
        // 召喚演出中はmatchTimeを進めず、視点操作と演出のみ行う(ホスト/ゲスト共通)
        updateSummonIntro(dt);
        // 演出の間はホストもauthStateを配信しないので、沈黙の計測はここから始める
        hostAuthSeenAt = now;
      } else if(netState.mode!=='multi'){
        update(dt);
      } else if(netState.isHost){
        applyRemoteInputsLocally();
        processRemoteFireEvents();
        update(dt);
        broadcastNewShotsAsHost();
        sendLocalInputIfMultiplayer(now);
        authPublishTimer += dt;
        if(authPublishTimer >= authPublishInterval() && !authPublishInFlight){
          authPublishTimer = 0;
          authPublishInFlight = true;
          window.__aramonPublishAuthState(netState.roomId, buildAuthStatePayload())
            .catch(()=>{})
            .finally(()=>{ authPublishInFlight = false; });
        }
      } else {
        // 非ホスト: ダメージ・ガッツ・キル・ゾーン等の確定計算は一切行わず、
        // 自分の移動だけをローカルで滑らかに再現し、残りはホストからのauthState配信に委ねる
        checkHostSilenceAsGuest(now);   // この分岐に入る=マルチのゲストなので、ソロ・ホストでは走らない
        updateCameraSnap(dt);
        computePlayerInput();
        if(player && player.alive){
          resolveMovement(player, dt);
          // 溜まっている補正量(=同じ入力時点で比べたホストとの誤差)を少しずつ消費する。
          // 遅延ぶんは誤差に含まれないので、まっすぐ歩いている間は補正がほぼゼロになり
          // 後ろへ引っ張られない。衝突・ノックバック等で本当にズレた時だけ効く。
          if(selfCorrX || selfCorrY){
            // 許容を広げたぶん残る誤差も大きくなるので、収束速度も同じ倍率で上げる
            const k = Math.min(1, dt*SELF_CORRECT_RATE*selfCorrectSpeedScale(player));
            const sx = selfCorrX*k, sy = selfCorrY*k;
            player.x += sx; player.y += sy;
            selfCorrX -= sx; selfCorrY -= sy;
            if(Math.hypot(selfCorrX, selfCorrY) < 0.5){ selfCorrX = 0; selfCorrY = 0; }
            // 計測ハーネス用: このフレームで消費した補正量を記録(通常は素通り)
            if(window.__netProbe) __netProbe.mark('selfCorr', { sx, sy, x: player.x, y: player.y, mx: player.inputMoveX, my: player.inputMoveY, mt: matchTime });
          }
          sanitizeSelfPosition(); // NaN等でハマったまま操作不能にならないよう点検
        }
        for(const e of entities){
          if(!e.alive) continue;
          if(e.fireCooldown>0) e.fireCooldown -= dt;
          if(e.dashCooldown>0) e.dashCooldown -= dt;
          if(e.hitFlash>0) e.hitFlash -= dt;
        }
        updateInterpDelay(dt);       // rtc接続中は描画遅延を実測に合わせて縮める(急変させない)
        interpolateRemoteEntities(); // ①② 自分以外は補間バッファから描画時刻の位置を再構成
        predictLootPickupsAsGuest(); // 重なったアイテムは即座に見た目を消す(確定はホスト)
        tryNonHostPlayerFireVisual(dt);
        updatePendingAoeCasts();        // 連射する範囲技の2発目以降を時刻到達で出す(見た目専用)
        updateGuestPredHits();          // 確定が来なかった予測命中の表示を取り消す(F-11)
        showGuestEnvironmentDamage(dt); // 安全圏外/溶岩のダメージ表示(HPの確定はホスト)
        // 自分が撃った見た目専用の弾だけをローカルで移動させる(当たり判定はホストが確定する)
        for(let i=projectiles.length-1;i>=0;i--){
          const p = projectiles[i];
          if(!p.visualOnly) continue;
          if(p.lobbed){
            p.flightT += dt;
            const t = clamp(p.flightT / p.flightTime, 0, 1);
            p.x = lerp(p.startX, p.landX, t);
            p.y = lerp(p.startY, p.landY, t);
            p.z = lerp(p.startZ, p.landZ||0, t) + Math.sin(t*Math.PI)*p.arcHeight;
            if(t>=1){
              spawnHit(p.x,p.y,p.landZ||0,p.color);
              projectiles.splice(i,1);
            }
            continue;
          }
          if(p.delay>0){ p.delay -= dt; continue; }
          const step = Math.hypot(p.vx,p.vy)*dt;
          p.x += p.vx*dt; p.y += p.vy*dt; p.traveled += step;
          // リアルマップ: 上下にも進み、重力で落ちる(combat.jsのupdateProjectilesと同じ式)
          if(p.terrain3d){ p.z += (p.vz||0)*dt; p.vz = (p.vz||0) - (p.grav||0)*dt; }
          else if(p.vz) p.z += p.vz*dt;
          let visualHit = p.traveled >= p.maxRange;
          // リアルマップ: 丘に当たったら見た目もそこで止める(当たり判定はホストが確定)
          if(!visualHit && p.terrain3d && typeof getTerrainHeightAt==='function'){
            const gz = getTerrainHeightAt(p.x, p.y);
            if(p.z <= gz){ p.z = gz; visualHit = true; spawnHit(p.x,p.y,gz,p.color); }
          }
          if(!visualHit){
            // 当たり判定・ダメージ計算はホストのauthState/hit報告が正なので、ここでは一切計算しない。
            // ただし見た目上は接触した瞬間に消さないと、弾が体を貫通していくように見えてしまうため、
            // 見た目専用の当たり「らしさ」判定だけをローカルで行う
            for(const e of entities){
              if(!e.alive || e.id===p.ownerId) continue;
              if(projTeamBlocked(p, e)) continue; // チーム戦: 味方の体は見た目も素通り(ホスト側と同じ)
              if(p.terrain3d && !projHeightHits(p,e)) continue; // 頭上/足元を大きく外れた弾は見た目も当てない
              if(dist(p,e) < e.radius+(p.hitR||0)){
                visualHit=true; spawnHit(e.x,e.y,e.z,p.color);
                /* ゲストの体感: 自分の弾が見た目命中した瞬間に、照準の×印と予測ダメージを出す。
                   確定の実数字は従来どおりホストのauthState(HPの減り)から後で出るので、
                   予測側は小さく半透明(spawnPredDmgText)にして二重に見えないようにする */
                if(player && p.ownerId===player.id) noteGuestPredHit(e, p);
                break;
              }
            }
          }
          if(visualHit){
            // 着弾ドームを持つ弾(ビッグバン/ヴァニッシュ)は、ここで見た目の爆風も出す。
            // ダメージ判定はホストが確定するが、ゲスト側でこれを出さないと
            // 自分で撃ったときだけ爆発が見えない(ホストのエコーは自分の弾として弾かれる)
            if(p.blast && typeof spawnGroundBlast==='function'){
              spawnGroundBlast(p.x, p.y, p.blast, p.ownerId, p.moveAura, p.auraTint, p.auraAccent);
            }
            projectiles.splice(i,1);
          }
        }
        updateCamera();
        matchTime += dt;
        if(game.tipTimer>0) game.tipTimer -= dt;
        for(let i=particles.length-1;i>=0;i--){
          const p = particles[i];
          p.x += p.vx*dt; p.y += p.vy*dt;
          if(p.type==='text') p.vy += 60*dt;
          p.life -= dt;
          if(p.life<=0) particles.splice(i,1);
        }
        for(let i=areaEffects.length-1;i>=0;i--){
          if(matchTime - areaEffects[i].spawnAt > areaEffects[i].life) areaEffects.splice(i,1);
        }
        updateHUD();
        sendLocalInputIfMultiplayer(now);
      }
    }

    if(typeof perfMark==='function') perfMark('update');
    if(game.started) render();
    if(typeof perfMark==='function') perfMark('render');
    if(typeof perfFrameEnd==='function') perfFrameEnd();
  }catch(err){
    loopErrorCount++;
    if(loopErrorCount<=5) console.error("[aramon] loop error", err);
    if(loopErrorCount===1 && typeof pushToast==="function"){
      // 中身も出す。文言だけだと何が起きたのか分からず、実機からの報告で追えない
      const detail = (err && (err.message || err.name)) ? String(err.message || err.name).slice(0,90) : '';
      pushToast("内部エラーが発生しましたが復帰しました" + (detail ? "：" + detail : ""));
    }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

