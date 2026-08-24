  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
  import {
    getDatabase, ref, push, query, orderByChild, limitToLast, get,
    set, update, onValue, off, onDisconnect, remove, serverTimestamp,
    runTransaction, child, onChildAdded
  } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

  const firebaseConfig = {
    apiKey: "AIzaSyC54sYz-Uvi10qeJ_1e2u3rfa5AUlAo0Ug",
    authDomain: "aramon-ranking.firebaseapp.com",
    databaseURL: "https://aramon-ranking-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "aramon-ranking",
    storageBucket: "aramon-ranking.firebasestorage.app",
    messagingSenderId: "246981641227",
    appId: "1:246981641227:web:7710164c6049275f4f330e",
    measurementId: "G-W61FCCKHTK"
  };

  const fbApp = initializeApp(firebaseConfig);
  const fbDb = getDatabase(fbApp);

  /* ===== 通信の成否を1か所へ集める =====
     ここは例外を握り潰す場所が多く、握り潰したぶんは呼び出し側から見ると
     「0件だった」「まだ準備中」と見分けが付かない(部屋一覧が圏外でも
     「現在募集中の部屋はありません」になっていた)。**戻り値の形は変えず**、
     成否だけを network.js の1か所へ投げ、失敗した戻り値には見えない印を付ける。
     状態の持ち主が network.js 側にあるのは、圏外だとこのファイル自体が
     読み込めない(index.htmlが .catch で握る)ため ―― 詳しくは network.js の
     「通信の状態を1か所で持つ」の項。 */
  function netMark(op, ok, err){
    try{ if(window.__aramonNetMark) window.__aramonNetMark(op, ok, err); }catch(e){}
    return ok;
  }
  // 失敗して返す値に印を付けて返す(呼び出し側は window.__aramonNetFailed(戻り値) で読む)
  function netFailValue(op, err, value){
    netMark(op, false, err);
    try{ if(window.__aramonNetTagFailed) window.__aramonNetTagFailed(value); }catch(e){}
    return value;
  }
  // 失敗の理由をプレイヤーの言葉で1つに決める(文言の分岐を各所に散らさない)
  function netFailReason(fallback){
    const online = (typeof window.__aramonNetOnline==='function') ? window.__aramonNetOnline() : true;
    return online ? fallback : '通信できません。電波の状態を確認してください';
  }

  function makeScoreKey(name, element){
    // Firebaseキーに使えない文字を除去し、プレイヤー名+モンスターで一意なキーを作る
    const safeName = String(name||'').replace(/[.#$/\[\]\s]/g,'_').slice(0,40) || 'anon';
    return `${safeName}__${element}`;
  }

  // ===== プレイヤーアカウント(accounts/{nameKey}) =====
  // ※Firebaseコンソールのセキュリティルールに accounts パスの追加が必要
  window.__aramonAccountKey = function(name){
    return String(name||'').replace(/[.#$/\[\]\s]/g,'_').slice(0,24).toLowerCase() || 'anon';
  };
  /* アカウント系は**例外をそのまま投げる**(呼び出し側が try/catch している)。
     ここでは成否を記録するだけにして、投げ方は従来どおりにする ――
     戻り値や例外の形を変えると ui.js 側の分岐が変わってしまうため。 */
  window.__aramonGetAccount = async function(nameKey){
    try{
      const snap = await get(ref(fbDb, `accounts/${nameKey}`));
      netMark('account', true);
      return snap.exists() ? snap.val() : null;   // null=そのアカウントが無い(通信は成功)
    }catch(err){ netMark('account', false, err); throw err; }
  };
  window.__aramonSetAccount = async function(nameKey, obj){
    try{
      await set(ref(fbDb, `accounts/${nameKey}`), obj);
      return netMark('account', true);
    }catch(err){ netMark('account', false, err); throw err; }
  };
  window.__aramonUpdateAccountData = async function(nameKey, dataObj){
    try{
      await update(ref(fbDb, `accounts/${nameKey}`), { data: dataObj, updatedAt: Date.now() });
      return netMark('accountSync', true);
    }catch(err){ netMark('accountSync', false, err); throw err; }
  };

  window.__aramonSubmitScore = async function(entry){
    try{
      const key = makeScoreKey(entry.name, entry.element);
      const scoreRef = ref(fbDb, `scores/${key}`);
      const isReal = entry.mapType === 'real';
      const isTeam = entry.mapType === 'team';   // チーム戦はマップを問わず専用の集計先へ
      await runTransaction(scoreRef, (cur)=>{
        if(!cur){
          const base = {
            name: entry.name, element: entry.element, elementLabel: entry.elementLabel,
            skin: entry.skin || null,            // 装備スキン(ランキングアイコンに反映)
            mastermonName: entry.mastermonName || null,
            mastermonLevel: entry.mastermonLevel || null,
            mastermonRebirth: entry.mastermonRebirth || null,
            mastermonStatTotal: entry.mastermonStatTotal || null,
            rankPoint: entry.rankPoint || null,   // 段位ポイント(地形で分けない)
            /* このモンスターで稼いだRPの合計。**負にもなるので Math.max で混ぜない。**
               集計は端末側(loadRank().elem)が正で、ここは最新値を上書きするだけ。
               `|| null` も使わない(0 と 未記録 を区別する必要がないうえ、負の値が消える)。 */
            rankRpSum: entry.rankRpSum != null ? entry.rankRpSum : 0,
            /* キル数・ダメージ数の集計先。**シングルとチーム戦を混ぜない。**
               シングルは通常マップ/リアルマップで分け、チーム戦(スクワッド・20チームBR・
               アリーナ)はマップを問わずTeamへ入れる。1人で戦う記録とチームで積んだ記録は
               意味が違うので、同じ表で競わせない(発注者判断・2026-08-14)。 */
            killsNormal: 0, damageNormal: 0, killsReal: 0, damageReal: 0,
            killsTeam: 0, damageTeam: 0,
            placement: entry.placement, isWin: entry.isWin,
            time: entry.time, ts: entry.ts,
          };
          if(isTeam){ base.killsTeam = entry.kills||0; base.damageTeam = entry.damage||0; }
          else if(isReal){ base.killsReal = entry.kills||0; base.damageReal = entry.damage||0; }
          else { base.killsNormal = entry.kills||0; base.damageNormal = entry.damage||0; }
          return base;
        }
        // 旧データ(通常/リアル分離前のkills/damage)は通常マップの実績として引き継ぐ
        const killsNormal = cur.killsNormal!=null ? cur.killsNormal : (cur.kills||0);
        const damageNormal = cur.damageNormal!=null ? cur.damageNormal : (cur.damage||0);
        const killsReal = cur.killsReal||0;
        const damageReal = cur.damageReal||0;
        const killsTeam = cur.killsTeam||0;
        const damageTeam = cur.damageTeam||0;
        return {
          name: entry.name, element: entry.element, elementLabel: entry.elementLabel,
          skin: entry.skin || cur.skin || null,  // 直近の装備スキンを優先(未装備なら従来値を維持)
          mastermonName: entry.mastermonName || cur.mastermonName || null,
          mastermonLevel: Math.max(cur.mastermonLevel||0, entry.mastermonLevel||0) || null,
          mastermonRebirth: Math.max(cur.mastermonRebirth||0, entry.mastermonRebirth||0) || null,
          mastermonStatTotal: Math.max(cur.mastermonStatTotal||0, entry.mastermonStatTotal||0) || null,
          rankPoint: Math.max(cur.rankPoint||0, entry.rankPoint||0) || null,
          rankRpSum: entry.rankRpSum != null ? entry.rankRpSum : (cur.rankRpSum||0),
          killsNormal: (isReal||isTeam) ? killsNormal : Math.max(killsNormal, entry.kills||0),
          damageNormal: (isReal||isTeam) ? damageNormal : Math.max(damageNormal, entry.damage||0),
          killsReal: isReal ? Math.max(killsReal, entry.kills||0) : killsReal,
          damageReal: isReal ? Math.max(damageReal, entry.damage||0) : damageReal,
          killsTeam: isTeam ? Math.max(killsTeam, entry.kills||0) : killsTeam,
          damageTeam: isTeam ? Math.max(damageTeam, entry.damage||0) : damageTeam,
          placement: Math.min(cur.placement||99, entry.placement||99),
          isWin: !!(cur.isWin || entry.isWin),
          time: Math.max(cur.time||0, entry.time||0),
          ts: entry.ts,
        };
      });
      return netMark('submitScore', true);
    }catch(err){
      console.error('score submit failed', err);
      netMark('submitScore', false, err);
      return false;
    }
  };

  window.__aramonFetchRanking = async function(field, count){
    try{
      // orderByChild(field) + limitToLast(count) だと、対象フィールド(killsNormal等)を
      // まだ持っていない旧形式のレコードがFirebase側の並び替えで最下位扱いになり、
      // 母数が多いと件数指定で足切りされて結果に出てこなくなる(「除外」のように見えるバグの原因)。
      // ここでは scores を全件取得し、フォールバック込みの並び替えはui.js側に任せる。
      const snap = await get(ref(fbDb, 'scores'));
      const rows = [];
      snap.forEach(child=>{ rows.push(child.val()); });
      rows.sort((a,b)=> (b[field]||0) - (a[field]||0));
      netMark('ranking', true);
      return rows;
    }catch(err){
      console.error('ranking fetch failed', err);
      // ここは元から null が「失敗」の合図。印も付けて他のAPIと扱いを揃える
      return netFailValue('ranking', err, null);
    }
  };

  /* =====================================================================
     MATCH LOG (管理者画面用の試合履歴)
     matchLogs/{autoId} : { name, map, mapLabel, element, elementLabel, mode, ts,
                             win, place?, sec, kills, dmg, skin,
                             raid?, raidDamage?, raidResult? }
     試合が終わるたびに1件ずつ追記していく単純なログ。ランキング用のscoresとは別物で、
     こちらは「誰が・いつ・どのマップ・どのモンスターで遊んだか」を集計するためだけに使う。
     raid以降はレイドバトルのときだけ付く追加情報(ui.jsのraidShowResultから記録)。
     **記録は後から遡れない**ので、集計に使いたい値は増やすなら早いほどよい。
     win / sec / kills / dmg / skin は後から足したフィールドなので、
     **古いログには入っていない**。集計側は必ず「持っているログだけで割る」こと。
  ===================================================================== */
  window.__aramonLogMatch = async function(entry){
    try{
      await push(ref(fbDb, 'matchLogs'), entry);
      return netMark('matchLog', true);
    }catch(err){
      console.error('match log failed', err);
      netMark('matchLog', false, err);
      return false;
    }
  };

  window.__aramonFetchMatchLogs = async function(){
    try{
      const snap = await get(ref(fbDb, 'matchLogs'));
      const rows = [];
      snap.forEach(child=>{ rows.push(child.val()); });
      netMark('matchLogs', true);
      return rows;
    }catch(err){
      console.error('match logs fetch failed', err);
      return netFailValue('matchLogs', err, null);
    }
  };

  /* =====================================================================
     MATCHMAKING / ROOM SYNC
     lobby/{lobbyEntryId}   : { roomId, capacity, count, status, createdAt }
     rooms/{roomId}/meta    : { hostId, capacity, status, createdAt }
     rooms/{roomId}/players/{playerId} : { name, element, joinedAt, input:{...} }
     rooms/{roomId}/state   : ホストが配信する全体スナップショット(entities/projectiles/loot/zone/matchTime等)
     rooms/{roomId}/events  : push()されるキルフィード等の単発イベント
  ===================================================================== */
  function genId(){
    return Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4);
  }
  const myPlayerId = genId();
  window.__aramonMyPlayerId = myPlayerId;

  let activeRoomId = null;
  let roomListeners = [];
  /* いま自分が席を1つ確保している lobby エントリのキー。
     退出のときに count を戻す先が要るのに、参加時はどこにも控えていなかった。
     戻せないと入退室のたびに count だけが増え、誰も居ない部屋が「満員」扱いで
     募集一覧から消える(マルチが成立しない直接の原因だった)。 */
  let activeLobbySeat = null;   // { lobbyKey } / 席を持っていないときは null

  /* 【必ず通す】RTDBへ書く値から undefined を落とす。
     Realtime Database の set/push/update は、値のどこかに undefined が1つでもあると
     **書き込み全体を例外で拒否する**。ここは try/catch で握り潰しているので、
     ゲームからは「その便だけが静かに届かない」ようにしか見えない。
     実害の例(2026-08-15に修正): マスモンを連れていないbotは mastermon*Mult を持たない
     ため、authStateの**フル配信だけが毎回失敗**していた。ゲストには位置・HP等の
     ホットフィールドだけが届き、moveTierUnlocked(修行チケットの技解放)・speed・
     train*Mult といったコールドフィールドが**試合中ずっと届かなかった**。
     送り側1か所ずつの `||1` に頼ると同じ事故が別のフィールドで再発するので、
     RTDBへ出ていく境界のここで必ず落とす。
     **健全なときは何もコピーしない**(authStateは60体ぶんを毎秒20〜30回書くので、
     毎回作り直すとゴミが出る)。まず走査だけして、見つかったときにだけ作り直す。
     NaN/Infinity も同じく書き込み全体を拒否させるので、一緒に落とす。 */
  function isBadValue(v){ return v === undefined || typeof v === 'function' || (typeof v === 'number' && !Number.isFinite(v)); }
  function hasBadValue(v){
    if(isBadValue(v)) return true;
    if(v === null || typeof v !== 'object') return false;
    if(Array.isArray(v)){
      for(let i=0;i<v.length;i++){ if(hasBadValue(v[i])) return true; }
      return false;
    }
    for(const k in v){ if(hasBadValue(v[k])) return true; }
    return false;
  }
  function stripUndefinedDeep(v){
    if(isBadValue(v)) return null;
    if(v === null || typeof v !== 'object') return v;
    if(Array.isArray(v)) return v.map(stripUndefinedDeep);
    const out = {};
    for(const k in v){
      if(isBadValue(v[k])) continue;   // キーごと落とす(受け側は「無い」で判定している)
      out[k] = stripUndefinedDeep(v[k]);
    }
    return out;
  }
  function stripUndefined(v){ return hasBadValue(v) ? stripUndefinedDeep(v) : v; }
  /* 部屋への書き込み失敗は握り潰すが、**最初の1回だけは必ず知らせる**。
     黙って落ちる作りにしたせいでフル配信の全滅に長く気づけなかった。 */
  const warnedRoomWrites = new Set();
  function warnRoomWrite(label, err){
    // 失敗は毎回記録する(consoleは最初の1回だけ)。試合中に通信が死んだことを
    // UI側が知る手掛かりがこれしかないため。連続する同じ失敗は netNotify 側で間引かれる
    netMark('roomWrite:'+label, false, err);
    if(warnedRoomWrites.has(label)) return;
    warnedRoomWrites.add(label);
    console.warn(`[aramon] room write failed (${label})`, err);
  }

  function clearRoomListeners(){
    roomListeners.forEach(({r,cb,isChildAdded})=>off(r, isChildAdded?'child_added':'value', cb));
    roomListeners = [];
  }
  /* 試合ぶんの購読だけを畳む(部屋のplayers/metaはロビーのものなので残す)。
     「もう一度」で同じ部屋のまま2試合目に入ると、畳まないまま同じ購読をもう1組
     貼ることになり、試合を重ねるほど同じイベントが何重にも届く。 */
  window.__aramonClearMatchListeners = function(){
    const keep = [];
    roomListeners.forEach((L)=>{
      if(L.scope!=='match'){ keep.push(L); return; }
      off(L.r, L.isChildAdded?'child_added':'value', L.cb);
    });
    roomListeners = keep;
  };
  /* 試合ごとに使い捨てる置き場を空にする(ホストが試合を始める直前に呼ぶ)。
     **onChildAdded は購読した瞬間に「もう入っている子」を全部流し込む。**
     前の試合の events が残っていると、2試合目を始めた全員へ前の試合の matchEnd が
     もう一度届き、始まったばかりの試合がその場で勝敗表示のまま終わる
     (2026-08-24 実機報告「もう一度を押した次の試合で前の勝利演出が流れて終わる」)。 */
  window.__aramonClearRoomTransient = async function(roomId){
    if(!roomId) return;
    const paths = ['events','shotEvents','lootEvents','fireEvents','hits','authState'];
    try{ await Promise.all(paths.map(p=> remove(ref(fbDb, `rooms/${roomId}/${p}`)))); }
    catch(err){ warnRoomWrite('clearTransient', err); }
  };

  // 部屋のプレイヤー情報に載せるマスモン情報(レベル+育成ステータス)。
  // mmLevel は旧クライアント互換のために残す(新クライアントは mm.level を見る)。
  function mmEntryFields(mmInfo){
    const lv = (mmInfo && mmInfo.level) || null;
    return { mmLevel: lv, mm: (mmInfo && mmInfo.stats)
      ? { level: lv||1, stats: mmInfo.stats, rebirth: mmInfo.rebirth||0, apt: mmInfo.apt||null,
          // 基礎値アイテム(生命の果実・加速剤)ぶん。これが欠けるとホストとゲストでHP・速度がずれる
          baseHp: mmInfo.baseHp||0, baseSpd: mmInfo.baseSpd||0 }
      : null };
  }

  /* ===== 部屋の席(lobby/{key}/count)の管理 =====
     count は「席の予約数」。同時に入ろうとした人が定員を超えないよう、増やすのは必ず
     トランザクションで行う。ただし count は自分で戻さないと減らない値で、
     **通信断・アプリ終了では戻せない**(RTDBの onDisconnect は set/remove しか張れず、
     加減算=トランザクションが張れないため。固定値の set を張ると、あとから入った人の
     予約を巻き戻して定員を超えさせてしまう)。
     一方 rooms/{id}/players は onDisconnect で確実に消えるので、**実際の在室人数の正は
     players の側**。そこで「読むとき・入るときに players の実数へ寄せ直す」形にして、
     戻し損ねた残骸で部屋が満員になったまま消えるのを防ぐ。 */
  async function roomOccupancy(roomId){
    try{
      const snap = await get(ref(fbDb, `rooms/${roomId}/players`));
      if(!snap.exists()) return null;   // 部屋自体がもう無い
      let n = 0; snap.forEach(()=>{ n++; });
      return n;
    }catch(err){ return undefined; }    // 読めなかった=不明。呼び出し側は count のまま扱う
  }

  /* 席を1つ予約する。満員なら false。
     real(=players の実数)が count より少ないときは、そのぶんを残骸とみなして詰める。
     ※予約した直後(players へ自分を書く前)の人も real には数えられないので、
       ごく短い窓では定員+1になりうる。部屋が永久に満員のまま消えるより軽い副作用として許容する。 */
  async function reserveLobbySeat(lobbyKey, roomId, capacity){
    const real = await roomOccupancy(roomId);
    const res = await runTransaction(ref(fbDb, `lobby/${lobbyKey}/count`), (cur)=>{
      if(cur===null) return cur;
      const base = (real!=null && real < cur) ? real : cur;
      if(base >= capacity) return;   // abort=満員
      return base + 1;
    });
    return !!res.committed;
  }

  /* 自分の席を返す。二重に効いても負にならないよう下限0でトランザクションする
     (退出→切断が続けて起きても、席を持っているのは1回きりなので activeLobbySeat で締める)。 */
  async function releaseLobbySeat(){
    const seat = activeLobbySeat;
    activeLobbySeat = null;
    if(!seat) return;
    try{
      await runTransaction(ref(fbDb, `lobby/${seat.lobbyKey}/count`), (cur)=>{
        if(cur===null) return cur;    // エントリごと消えている(解散済み)
        return Math.max(0, cur - 1);
      });
    }catch(err){}
  }

  // 空いている部屋を探して入るか、無ければ新規に作ってホストになる
  // 部屋を新規作成してホストになる
  // mode は 'br'(バトルロイヤル)か 'raid'。部屋一覧で混ざらないよう分けて扱う。
  // 旧クライアントの部屋には mode が無いので 'br' とみなす。
  // teamSize はチーム戦の1チーム人数(1=個人戦)。capacity と同様に素通しで部屋metaへ載せるだけ
  // sub はチーム戦のサブモード('br20'=20チームバトロワ / 'arena'=バトルアリーナ / null=従来型)。
  // これも素通し。旧クライアントの部屋には無いので、読む側は v.sub||null で扱う。
  window.__aramonCreateRoom = async function(capacity, playerName, elementKey, mmInfo, skinId, mode, teamSize, sub, mapPick){
    /* 失敗は**従来どおり例外のまま**投げる(ui.js側が try/catch している)。
       ここでは成否を記録するだけにして、呼び出し側の分岐を変えない。 */
    try{
      return await createRoomInner(capacity, playerName, elementKey, mmInfo, skinId, mode, teamSize, sub, mapPick);
    }catch(err){ netMark('createRoom', false, err); throw err; }
  };
  async function createRoomInner(capacity, playerName, elementKey, mmInfo, skinId, mode, teamSize, sub, mapPick){
    await releaseLobbySeat();   // 新しい席を取る前に、持っている席は必ず返す(取りっぱなしを作らない)
    const roomMode = mode==='raid' ? 'raid' : 'br';
    const roomTeamSize = (teamSize|0) > 1 ? (teamSize|0) : 1;
    const roomSub = (sub==='br20' || sub==='arena') ? sub : null;
    const roomId = genId();
    const roomRef = ref(fbDb, `rooms/${roomId}`);
    await set(roomRef, {
      meta: { hostId: myPlayerId, capacity, teamSize: roomTeamSize, sub: roomSub, status:'waiting', mode:roomMode, createdAt: Date.now(), hostName: playerName, mapPick: mapPick||null },
      players: { [myPlayerId]: { name: playerName, element: elementKey, ...mmEntryFields(mmInfo), skin: skinId||null, joinedAt: Date.now(), isHost:true, input:{} } },
    });
    /* mapPick は部屋一覧に「どのマップか」を出すためだけの表示用。**|| null が必須** ――
       RTDBは undefined が1つでも混ざると書き込みを丸ごと拒否する。
       実際に使うマップはホストが「スタート」を押したときのシード(__aramonSetRoomSeed)が正で、
       ここの値は選び直されても追いかけない(表示が少し古くなるだけで試合には影響しない)。 */
    const lobbyEntryRef = push(ref(fbDb,'lobby'), { roomId, capacity, teamSize: roomTeamSize, sub: roomSub, count:1, status:'waiting', mode:roomMode, createdAt: Date.now(), hostName: playerName, mapPick: mapPick||null });
    onDisconnect(ref(fbDb, `rooms/${roomId}/players/${myPlayerId}`)).remove();
    onDisconnect(lobbyEntryRef).remove();
    /* ホストが落ちたら meta も消す。待機中のゲストの解散検知は「meta が消えたこと」だけを
       見ているので、これが残っているとゲストは永遠に「ホストが試合を開始するのを待っています…」
       のまま待たされる。試合中の meta 削除は無害(ゲスト側の解散検知は !game.started のときだけ)。 */
    onDisconnect(ref(fbDb, `rooms/${roomId}/meta`)).remove();
    window.__aramonLobbyEntryId = lobbyEntryRef.key;
    activeLobbySeat = { lobbyKey: lobbyEntryRef.key };   // 自分の1席(count:1)ぶん
    activeRoomId = roomId;
    netMark('createRoom', true);
    return { roomId, isHost:true, myPlayerId };
  }

  // 募集中の部屋一覧を取得する(部屋を探す画面用)
  window.__aramonListOpenRooms = async function(mode){
    const wantMode = mode==='raid' ? 'raid' : 'br';
    try{
      const lobbyRef = ref(fbDb, 'lobby');
      const q = query(lobbyRef, orderByChild('status'), limitToLast(30));
      const snap = await get(q);
      const cands = [];
      snap.forEach(ch=>{
        const v = ch.val();
        if(v && v.status==='waiting' && (v.mode||'br')===wantMode){
          cands.push({ lobbyKey: ch.key, roomId: v.roomId, capacity: v.capacity, teamSize:(v.teamSize||1), sub:(v.sub||null), count: v.count, hostName: v.hostName||'名無しのモンスター', createdAt: v.createdAt||0, mode:(v.mode||'br'), mapPick:(v.mapPick||null) });
        }
      });
      /* 人数は count(予約数)ではなく players の実数で出す。count は切断で戻り損ねるので、
         そのまま使うと「満員」で一覧から消え、ロビーの待機人数バッジも嘘の数になる。
         募集中の部屋はふつう数件なので、その件数ぶんだけ players を読む。 */
      const occ = await Promise.all(cands.map(c=>roomOccupancy(c.roomId)));
      const rooms = [];
      cands.forEach((c, i)=>{
        const real = occ[i];
        if(real===null) return;              // 部屋が消えている(残ったlobbyエントリ)
        const count = (real!=null) ? real : c.count;
        if(!(count < c.capacity)) return;    // 本当に満員
        rooms.push({ ...c, count });
      });
      rooms.sort((a,b)=> b.createdAt - a.createdAt);
      netMark('listRooms', true);
      return rooms;
    }catch(err){
      console.error('list rooms failed', err);
      /* 【F-9】失敗も空配列で返すのは従来どおり(呼び出し側は rooms.length / rooms.map を
         そのまま使っている)。ただし**「0件」と「通信に失敗」は別物**なので、
         この配列には印を付けて返す。UI側は window.__aramonNetFailed(rooms) で見分ける。 */
      return netFailValue('listRooms', err, []);
    }
  };

  // 指定した部屋に参加する(部屋を探す画面で選んだ場合)
  window.__aramonJoinRoom = async function(roomId, lobbyKey, playerName, elementKey, mmInfo, skinId){
    try{
      /* 席を返すのも通信。**try の中に入れる** ―― 外に置くと、ここで例外が出たときに
         呼び出し側(ui.jsのjoinSelectedRoom)は try/catch を持っていないので
         「押しても何も起きない」になる(理由も出ない)。 */
      await releaseLobbySeat();   // 新しい席を取る前に、持っている席は必ず返す
      const roomPlayersRef = ref(fbDb, `rooms/${roomId}/players`);
      const metaSnap = await get(ref(fbDb, `rooms/${roomId}/meta`));
      const meta = metaSnap.val();
      if(!meta || meta.status!=='waiting') return { ok:false, reason:'この部屋はもう開始しています' };

      if(!(await reserveLobbySeat(lobbyKey, roomId, meta.capacity))) return { ok:false, reason:'この部屋は満員です' };
      activeLobbySeat = { lobbyKey };   // 退出時にこの席を返す

      await set(child(roomPlayersRef, myPlayerId), {
        name: playerName, element: elementKey, ...mmEntryFields(mmInfo), skin: skinId||null, joinedAt: Date.now(), isHost:false, input:{}
      });
      onDisconnect(child(roomPlayersRef, myPlayerId)).remove();
      activeRoomId = roomId;
      netMark('joinRoom', true);
      return { ok:true, roomId, isHost:false, myPlayerId, capacity: meta.capacity, teamSize:(meta.teamSize||1), sub:(meta.sub||null), mode:(meta.mode||'br') };
    }catch(err){
      console.error('join room failed', err);
      await releaseLobbySeat();   // 予約だけ通って登録に失敗した場合に席を残さない
      /* 【F-9】「満員」「もう始まっている」と**通信できない**を同じ文言にしない。
         reason はそのままトーストに出るので、圏外のときは電波の話にする。 */
      return netFailValue('joinRoom', err,
        { ok:false, reason: netFailReason('参加に失敗しました(通信エラー)') });
    }
  };

  // 旧方式(自動マッチング)は互換のため残置
  // mode は 'br'(バトルロイヤル)か 'raid'。募集一覧で混ざらないよう分けて数える。
  // 旧クライアントの募集には mode が無いので 'br' とみなす。
  window.__aramonFindOrCreateRoom = async function(capacity, playerName, elementKey, mmInfo, skinId, mode, teamSize, sub){
    const wantMode = mode==='raid' ? 'raid' : 'br';
    const wantTeamSize = (teamSize|0) > 1 ? (teamSize|0) : 1;   // チーム人数も一致する部屋だけに入る
    const wantSub = (sub==='br20' || sub==='arena') ? sub : null; // サブモードも一致する部屋だけに入る
    const lobbyRef = ref(fbDb, 'lobby');
    const q = query(lobbyRef, orderByChild('status'), limitToLast(30));
    let joinedRoomId = null;
    let becameHost = false;
    await releaseLobbySeat();   // 新しい席を取る前に、持っている席は必ず返す

    try{
      const snap = await get(q);
      const candidates = [];
      snap.forEach(ch=>{
        const v = ch.val();
        if(v && v.status==='waiting' && v.capacity===capacity && v.count < v.capacity && (v.mode||'br')===wantMode && (v.teamSize||1)===wantTeamSize && (v.sub||null)===wantSub){
          candidates.push({ lobbyKey: ch.key, roomId: v.roomId, count: v.count });
        }
      });
      candidates.sort((a,b)=> b.count - a.count);

      for(const cand of candidates){
        const roomPlayersRef = ref(fbDb, `rooms/${cand.roomId}/players`);
        if(await reserveLobbySeat(cand.lobbyKey, cand.roomId, capacity)){
          activeLobbySeat = { lobbyKey: cand.lobbyKey };   // 退出時にこの席を返す
          await set(child(roomPlayersRef, myPlayerId), {
            name: playerName, element: elementKey, ...mmEntryFields(mmInfo), skin: skinId||null, joinedAt: Date.now(), isHost:false, input:{}
          });
          onDisconnect(child(roomPlayersRef, myPlayerId)).remove();
          joinedRoomId = cand.roomId;
          break;
        }
      }
    }catch(err){ console.error('room search failed', err); netMark('findRoom', false, err); }

    if(!joinedRoomId){
      await releaseLobbySeat();   // 予約だけ通って登録に失敗した候補の席を残さない
      const roomId = genId();
      const roomRef = ref(fbDb, `rooms/${roomId}`);
      await set(roomRef, {
        meta: { hostId: myPlayerId, capacity, teamSize: wantTeamSize, sub: wantSub, status:'waiting', mode:wantMode, createdAt: Date.now() },
        players: { [myPlayerId]: { name: playerName, element: elementKey, ...mmEntryFields(mmInfo), skin: skinId||null, joinedAt: Date.now(), isHost:true, input:{} } },
      });
      const lobbyEntryRef = push(ref(fbDb,'lobby'), { roomId, capacity, teamSize: wantTeamSize, sub: wantSub, count:1, status:'waiting', mode:wantMode, createdAt: Date.now() });
      onDisconnect(ref(fbDb, `rooms/${roomId}/players/${myPlayerId}`)).remove();
      onDisconnect(lobbyEntryRef).remove();
      onDisconnect(ref(fbDb, `rooms/${roomId}/meta`)).remove();   // 待機中の解散をゲストへ伝えるため(__aramonCreateRoomと同じ)
      window.__aramonLobbyEntryId = lobbyEntryRef.key;
      activeLobbySeat = { lobbyKey: lobbyEntryRef.key };   // 自分の1席(count:1)ぶん
      joinedRoomId = roomId;
      becameHost = true;
    }

    activeRoomId = joinedRoomId;
    netMark('findRoom', true);
    return { roomId: joinedRoomId, isHost: becameHost, myPlayerId };
  };

  window.__aramonLeaveRoom = async function(roomId){
    clearRoomListeners();
    try{
      await remove(ref(fbDb, `rooms/${roomId}/players/${myPlayerId}`));
    }catch(err){}
    await releaseLobbySeat();   // 確保していた席を戻す(戻さないと部屋が満員のまま消える)
  };

  window.__aramonWatchRoomPlayers = function(roomId, callback){
    const r = ref(fbDb, `rooms/${roomId}/players`);
    const cb = (snap)=>{ callback(snap.val()||{}); };
    onValue(r, cb);
    roomListeners.push({r,cb});
  };

  // 試合開始が確定した瞬間の参加者一覧を一度だけ取得する(全員が同じスナップショットを使うため)
  window.__aramonFetchRoomPlayersOnce = async function(roomId){
    try{
      const snap = await get(ref(fbDb, `rooms/${roomId}/players`));
      netMark('roomPlayers', true);
      return snap.val() || {};
    }catch(err){
      console.error('fetch players once failed', err);
      // 空オブジェクトは「誰も居ない」とも読めてしまうので、失敗の印を付けて返す
      return netFailValue('roomPlayers', err, {});
    }
  };

  window.__aramonWatchRoomMeta = function(roomId, callback){
    const r = ref(fbDb, `rooms/${roomId}/meta`);
    const cb = (snap)=>{ callback(snap.val()||null); };
    onValue(r, cb);
    roomListeners.push({r,cb});
  };

  window.__aramonSetRoomStatus = async function(roomId, status){
    await update(ref(fbDb, `rooms/${roomId}/meta`), { status });
  };

  // ホストが「スタート」を押した瞬間: 全員が同じ時刻を基準にカウントダウン表示できるよう、
  // 開始予定時刻(startAt)も一緒に書き込む
  window.__aramonSetRoomStarting = async function(roomId, startAt){
    await update(ref(fbDb, `rooms/${roomId}/meta`), { status:'starting', startAt });
  };
  // ゲスト退出などでカウントダウンを取り消す
  window.__aramonCancelRoomStarting = async function(roomId){
    await update(ref(fbDb, `rooms/${roomId}/meta`), { status:'waiting', startAt:null });
  };
  // ホストが部屋を解散する: 部屋自体を削除し、募集一覧のエントリも消す。
  // ゲスト側はmeta購読がnullを受け取ることで解散を検知する
  window.__aramonDisbandRoom = async function(roomId, lobbyEntryId){
    activeLobbySeat = null;   // エントリごと消すので、席を戻す相手はもう居ない
    try{ await remove(ref(fbDb, `rooms/${roomId}`)); }catch(err){}
    if(lobbyEntryId){
      try{ await remove(ref(fbDb, `lobby/${lobbyEntryId}`)); }catch(err){}
    }
  };

  window.__aramonSendInput = async function(roomId, input){
    try{
      await update(ref(fbDb, `rooms/${roomId}/players/${myPlayerId}`), { input: stripUndefined(input), inputTs: Date.now() });
    }catch(err){ warnRoomWrite('input', err); }
  };

  window.__aramonSendRecon = async function(roomId, recon){
    try{
      await update(ref(fbDb, `rooms/${roomId}/players/${myPlayerId}`), { recon: stripUndefined(recon), reconTs: Date.now() });
    }catch(err){ warnRoomWrite('recon', err); }
  };

  // teamSize はチーム戦の1チーム人数(1=個人戦)、sub はチーム戦のサブモード('br20'/'arena'/null)。
  // どちらも素通しで載せ、ゲストは__aramonWaitForRoomSeedで受け取る(試合の組み立てはこの値が正)
  window.__aramonSetRoomSeed = async function(roomId, seed, fixedPlayers, mapKey, hostMastermonBots, worldData, teamSize, sub){
    try{ await update(ref(fbDb, `rooms/${roomId}/meta`), { seed, fixedPlayers: fixedPlayers||null, mapKey: mapKey||'wild', hostMastermonBots: hostMastermonBots||null, world: worldData||null, teamSize: (teamSize|0)>1 ? (teamSize|0) : 1, sub: (sub==='br20'||sub==='arena') ? sub : null }); }catch(err){}
  };

  window.__aramonWaitForRoomSeed = function(roomId, timeoutMs){
    return new Promise((resolve)=>{
      const r = ref(fbDb, `rooms/${roomId}/meta`);
      let done = false;
      const cb = (snap)=>{
        const v = snap.val();
        if(v && v.seed!=null && v.fixedPlayers && !done){
          done=true; off(r,'value',cb); resolve({ seed:v.seed, fixedPlayers:v.fixedPlayers, mapKey:v.mapKey||'wild', hostMastermonBots:v.hostMastermonBots||[], world:v.world||null, teamSize:(v.teamSize||1), sub:(v.sub||null) });
        }
      };
      onValue(r, cb);
      setTimeout(()=>{
        if(!done){ done=true; off(r,'value',cb); resolve(null); }
      }, timeoutMs||4000);
    });
  };

  window.__aramonWatchState = function(roomId, callback){
    const r = ref(fbDb, `rooms/${roomId}/state`);
    const cb = (snap)=>{ callback(snap.val()||null); };
    onValue(r, cb);
    roomListeners.push({r,cb,scope:'match'});
  };

  window.__aramonPublishState = async function(roomId, stateObj){
    try{
      await set(ref(fbDb, `rooms/${roomId}/state`), stripUndefined(stateObj));
    }catch(err){ warnRoomWrite('state', err); }
  };

  window.__aramonWatchInputs = function(roomId, callback){
    const r = ref(fbDb, `rooms/${roomId}/players`);
    const cb = (snap)=>{ callback(snap.val()||{}); };
    onValue(r, cb);
    roomListeners.push({r,cb,scope:'match'});
  };

  window.__aramonPushEvent = async function(roomId, evt){
    try{ await push(ref(fbDb, `rooms/${roomId}/events`), stripUndefined(evt)); }catch(err){ warnRoomWrite('event', err); }
  };

  // キルフィード等の単発イベント。limitToLast(1)+onValueだと短時間に複数件発生したとき
  // 途中のイベントが丸ごと消えてしまう(キルフィードが流れない原因だった)ので、
  // shotEvents/lootEventsと同じonChildAdded方式にして1件も取りこぼさないようにする。
  // 呼び出し側はキーで重複処理を防ぐこと。
  window.__aramonWatchEvents = function(roomId, callback){
    const r = ref(fbDb, `rooms/${roomId}/events`);
    const cb = (snap)=>{ callback(snap.val(), snap.key); };
    onChildAdded(r, cb);
    roomListeners.push({r,cb,isChildAdded:true,scope:'match'});
  };

  // 命中報告: 誰かが人間に当てた攻撃を報告し、ホストだけが確定計算する
  window.__aramonReportHit = async function(roomId, hit){
    try{ await push(ref(fbDb, `rooms/${roomId}/hits`), stripUndefined(hit)); }catch(err){ warnRoomWrite('hit', err); }
  };

  window.__aramonWatchHitsAsHost = function(roomId, callback){
    const r = ref(fbDb, `rooms/${roomId}/hits`);
    const cb = (snap)=>{ callback(snap.key, snap.val()); };
    onChildAdded(r, cb);
    roomListeners.push({r,cb,isChildAdded:true,scope:'match'});
  };

  // 単発の「発射しました」イベント: 誰が・どの技を・どこから・どの方向へ撃ったかを都度送信する
  // (連射中かどうかの状態送信ではなく、1回の発射ごとに1件のイベントとして扱うことで
  //  見た目の連射・非連射のズレを構造的に無くす)
  window.__aramonSendFireEvent = async function(roomId, fireEvt){
    try{ await push(ref(fbDb, `rooms/${roomId}/fireEvents`), stripUndefined(fireEvt)); }catch(err){ warnRoomWrite('fire', err); }
  };
  window.__aramonWatchFireEvents = function(roomId, callback){
    const r = ref(fbDb, `rooms/${roomId}/fireEvents`);
    const cb = (snap)=>{ callback(snap.key, snap.val()); };
    onChildAdded(r, cb);
    roomListeners.push({r,cb,isChildAdded:true,scope:'match'});
  };

  // ホストが確定させた権威状態(人間プレイヤーのHP/ガッツ/生存)を配信
  // ホストが撃たれた瞬間(弾/範囲攻撃の発生)を都度ブロードキャストする専用チャンネル。
  // authStateのような「最新状態の上書き配信」と違い、1件も取りこぼさず全員に届ける必要があるため
  // fireEventsと同じonChildAdded方式を使う(取りこぼすと「相手の弾が見えない」原因になる)
  window.__aramonPushShotEvent = async function(roomId, evt){
    try{ await push(ref(fbDb, `rooms/${roomId}/shotEvents`), stripUndefined(evt)); }catch(err){ warnRoomWrite('shot', err); }
  };
  window.__aramonWatchShotEvents = function(roomId, callback){
    const r = ref(fbDb, `rooms/${roomId}/shotEvents`);
    const cb = (snap)=>{ callback(snap.key, snap.val()); };
    onChildAdded(r, cb);
    roomListeners.push({r,cb,isChildAdded:true,scope:'match'});
  };

  // アイテムの出現/取得を都度配信する(ホストのlootItems配列は非ホストに自動同期されないため、
  // 拾われて消えた/新たに湧いたという「変化」だけを個別イベントとして届ける)
  window.__aramonPushLootEvent = async function(roomId, evt){
    try{ await push(ref(fbDb, `rooms/${roomId}/lootEvents`), stripUndefined(evt)); }catch(err){ warnRoomWrite('loot', err); }
  };
  window.__aramonWatchLootEvents = function(roomId, callback){
    const r = ref(fbDb, `rooms/${roomId}/lootEvents`);
    const cb = (snap)=>{ callback(snap.key, snap.val()); };
    onChildAdded(r, cb);
    roomListeners.push({r,cb,isChildAdded:true,scope:'match'});
  };

  /* WebRTCシグナリング(net_transport.js用)
     rooms/{roomId}/rtc/{fromPid}_{toPid} に offer/answer/ICE候補を1件ずつpushし、
     受け手はonChildAddedで拾う(取りこぼし不可のためfireEventsと同じ方式)。
     ※ rooms配下の新パス。rooms直下を丸ごと許可していないルールの場合は
        セキュリティルールに rtc の .read/.write の追加が要る(未定義パスは既定で拒否)。
        貼るまではシグナリングが書けないだけで、マルチは従来どおり全てrtdb経由で動く。 */
  window.__aramonSendRtcSignal = async function(roomId, fromPid, toPid, msg){
    try{ await push(ref(fbDb, `rooms/${roomId}/rtc/${fromPid}_${toPid}`), msg); }catch(err){}
  };
  window.__aramonWatchRtcSignals = function(roomId, fromPid, toPid, callback){
    const r = ref(fbDb, `rooms/${roomId}/rtc/${fromPid}_${toPid}`);
    const cb = (snap)=>{ callback(snap.val()); };
    onChildAdded(r, cb);
    roomListeners.push({r,cb,isChildAdded:true});
    // net_transport.jsが試合をまたいで個別に購読を畳めるよう解除関数も返す
    return ()=> off(r, 'child_added', cb);
  };

  window.__aramonPublishAuthState = async function(roomId, authState){
    try{ await set(ref(fbDb, `rooms/${roomId}/authState`), stripUndefined(authState)); }catch(err){ warnRoomWrite('authState', err); }
  };
  window.__aramonWatchAuthState = function(roomId, callback){
    const r = ref(fbDb, `rooms/${roomId}/authState`);
    const cb = (snap)=>{ callback(snap.val()||null); };
    onValue(r, cb);
    roomListeners.push({r,cb,scope:'match'});
  };

  /* --- ゴーストマスモン ---
     ghosts/{accountKey} … { owner:表示名, at:更新時刻, list:[mastermonSnapshot…] }
     他の人が育てたマスモンの写しを、ソロの敵botとして出すために置く。
     ※ 新しいパスなので、Firebaseコンソールのセキュリティルールに ghosts の
        .read / .write を足す必要がある(未定義パスは既定で拒否される)。
     ※ accounts を直接読む案は採らない(同じオブジェクトに4桁パスコードが入っているため)。 */
  window.__aramonPutGhost = async function(accountKey, obj){
    await set(ref(fbDb, `ghosts/${accountKey}`), obj);
    return true;
  };
  /* 新しい方から limit 人ぶん取る。**全件取得にしない**(scores が全件取得で肥大した前例がある)。
     limitToLast はキー順の末尾なので索引(.indexOn)は要らない。 */
  window.__aramonFetchGhosts = async function(limit){
    const n = Math.max(1, Math.min(200, Math.round(limit||50)));
    const snap = await get(query(ref(fbDb, 'ghosts'), limitToLast(n)));
    const out = [];
    snap.forEach(ch=>{ const v = ch.val(); if(v && Array.isArray(v.list)) out.push({ key:ch.key, owner:v.owner||'', at:v.at||0, list:v.list }); });
    return out;
  };

  /* --- 週替わりレイド ---
     raids/{weekId}/total      … 全プレイヤーの与ダメ累計(トランザクションで加算)
     raids/{weekId}/players/{名前キー} … 個人の累計(ランキング用)
     ※ 新しいパスなので、Firebaseコンソールのセキュリティルールに raids の
        .read / .write を足す必要がある(未定義パスは既定で拒否される)。       */
  window.__aramonAddRaidDamage = async function(weekId, dmg, playerName){
    const add = Math.max(0, Math.round(dmg||0));
    // ダメージ0でも挑戦回数は数える(参加回数ランキングに載らなくなるため)
    if(!weekId) return;
    try{
      if(add>0) await runTransaction(ref(fbDb, `raids/${weekId}/total`), (cur)=> (cur||0) + add);
      const key = String(playerName||'ゲスト').replace(/[.#$/\[\]]/g,'_').slice(0,24) || 'ゲスト';
      await runTransaction(ref(fbDb, `raids/${weekId}/players/${key}`), (cur)=>{
        const prev = (cur && cur.dmg) || 0;
        const runs = ((cur && cur.runs) || 0) + 1;   // 参加回数ランキング用
        const best = Math.max((cur && cur.best) || 0, add); // 1回の最大ダメージランキング用
        return { name: String(playerName||'ゲスト').slice(0,24), dmg: prev + add, runs, best, at: Date.now() };
      });
    }catch(err){ console.warn('raid damage report failed', err); netMark('raidDamage', false, err); }
  };
  window.__aramonFetchRaidTotal = async function(weekId){
    try{
      const snap = await get(ref(fbDb, `raids/${weekId}/total`));
      netMark('raidTotal', true);
      return snap.val() || 0;
    }catch(err){ netMark('raidTotal', false, err); return 0; }
  };
  /* ランキングは players をそのまま読んで手元で並べ替える。
     orderByChild('dmg') を使うとセキュリティルール側に .indexOn が要り、
     無いと並べ替えが効かない/弾かれる。参加者はせいぜい数十人なので全件読んで問題ない。
     失敗はここで握りつぶさず投げる(呼び出し側が「読み込めなかった」と出せるように)。 */
  window.__aramonFetchRaidRanking = async function(weekId, topN){
    let snap;
    // 失敗は投げたまま(呼び出し側が「読み込めなかった」と出せるように)。記録だけ足す
    try{ snap = await get(ref(fbDb, `raids/${weekId}/players`)); netMark('raidRanking', true); }
    catch(err){ netMark('raidRanking', false, err); throw err; }
    const rows = [];
    snap.forEach(ch=>{
      const v = ch.val();
      if(v) rows.push({ name:v.name||ch.key, dmg:Number(v.dmg)||0, runs:Number(v.runs)||0, best:Number(v.best)||0 });
    });
    rows.sort((a,b)=>b.dmg-a.dmg);
    return rows.slice(0, topN||20);
  };

  window.__aramonCleanupLobbyEntry = async function(){
    activeLobbySeat = null;   // 募集エントリごと消える(=席を戻す相手が無くなる)
    if(window.__aramonLobbyEntryId){
      try{ await remove(ref(fbDb, `lobby/${window.__aramonLobbyEntryId}`)); }catch(err){}
    }
  };

  // 既存データの整理用: 同じ名前+モンスターで複数のレコードが残っている場合、
  // 最良のものだけを新形式キーに残し、古い重複レコードを削除する(一度だけ実行想定)
  window.__aramonDedupeScores = async function(){
    try{
      const snap = await get(ref(fbDb, 'scores'));
      const all = [];
      snap.forEach(ch=>{ all.push({ key: ch.key, val: ch.val() }); });

      const groups = {};
      for(const item of all){
        const v = item.val;
        if(!v || !v.name || !v.element) continue;
        const gkey = makeScoreKey(v.name, v.element);
        if(!groups[gkey]) groups[gkey] = [];
        groups[gkey].push(item);
      }

      let mergedCount = 0, deletedCount = 0;
      for(const gkey in groups){
        const items = groups[gkey];
        let best = null;
        for(const it of items){
          if(!best){ best = it.val; continue; }
          const bKN = best.killsNormal!=null ? best.killsNormal : (best.kills||0);
          const bDN = best.damageNormal!=null ? best.damageNormal : (best.damage||0);
          const iKN = it.val.killsNormal!=null ? it.val.killsNormal : (it.val.kills||0);
          const iDN = it.val.damageNormal!=null ? it.val.damageNormal : (it.val.damage||0);
          best = {
            name: best.name, element: best.element, elementLabel: best.elementLabel,
            mastermonName: best.mastermonName || it.val.mastermonName || null,
            mastermonLevel: Math.max(best.mastermonLevel||0, it.val.mastermonLevel||0) || null,
            killsNormal: Math.max(bKN, iKN),
            damageNormal: Math.max(bDN, iDN),
            killsReal: Math.max(best.killsReal||0, it.val.killsReal||0),
            damageReal: Math.max(best.damageReal||0, it.val.damageReal||0),
            placement: Math.min(best.placement||99, it.val.placement||99),
            isWin: !!(best.isWin || it.val.isWin),
            time: Math.max(best.time||0, it.val.time||0),
            ts: Math.max(best.ts||0, it.val.ts||0),
          };
        }
        await set(ref(fbDb, `scores/${gkey}`), best);
        mergedCount++;
        for(const it of items){
          if(it.key !== gkey){
            await remove(ref(fbDb, `scores/${it.key}`));
            deletedCount++;
          }
        }
      }
      return { mergedCount, deletedCount, totalBefore: all.length };
    }catch(err){
      console.error('dedupe failed', err);
      return null;
    }
  };

  /* =====================================================================
     管理者: ランキング記録の検索・削除
     テストプレイ等で紛れ込んだ記録(例: チーム全員で試した記録が1位に残る)を
     発注者が管理者画面から直接消せるようにする。scoresは1レコード=名前×モンスターで、
     索引(.indexOn)を持たないため全件取得してJS側で絞り込む(__aramonFetchRankingと同じ方針)。
  ===================================================================== */
  window.__aramonAdminFindScores = async function(name){
    try{
      const target = String(name||'').trim();
      if(!target) return [];
      const snap = await get(ref(fbDb, 'scores'));
      const rows = [];
      snap.forEach(ch=>{ const v = ch.val(); if(v && v.name===target) rows.push(v); });
      return rows;
    }catch(err){
      console.error('admin score search failed', err);
      return null;
    }
  };
  // レコードの中の1項目(killsReal等)だけを消す。他の項目(段位・別地形の記録)は残る
  window.__aramonAdminDeleteScoreField = async function(name, element, field){
    try{
      await remove(ref(fbDb, `scores/${makeScoreKey(name, element)}/${field}`));
      return true;
    }catch(err){ console.error('admin score field delete failed', err); return false; }
  };
  // レコード(名前×モンスター)を丸ごと消す
  window.__aramonAdminDeleteScoreRecord = async function(name, element){
    try{
      await remove(ref(fbDb, `scores/${makeScoreKey(name, element)}`));
      return true;
    }catch(err){ console.error('admin score record delete failed', err); return false; }
  };
