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
  window.__aramonGetAccount = async function(nameKey){
    const snap = await get(ref(fbDb, `accounts/${nameKey}`));
    return snap.exists() ? snap.val() : null;
  };
  window.__aramonSetAccount = async function(nameKey, obj){
    await set(ref(fbDb, `accounts/${nameKey}`), obj);
    return true;
  };
  window.__aramonUpdateAccountData = async function(nameKey, dataObj){
    await update(ref(fbDb, `accounts/${nameKey}`), { data: dataObj, updatedAt: Date.now() });
    return true;
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
      return true;
    }catch(err){
      console.error('score submit failed', err);
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
      return rows;
    }catch(err){
      console.error('ranking fetch failed', err);
      return null;
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
      return true;
    }catch(err){
      console.error('match log failed', err);
      return false;
    }
  };

  window.__aramonFetchMatchLogs = async function(){
    try{
      const snap = await get(ref(fbDb, 'matchLogs'));
      const rows = [];
      snap.forEach(child=>{ rows.push(child.val()); });
      return rows;
    }catch(err){
      console.error('match logs fetch failed', err);
      return null;
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
    if(warnedRoomWrites.has(label)) return;
    warnedRoomWrites.add(label);
    console.warn(`[aramon] room write failed (${label})`, err);
  }

  function clearRoomListeners(){
    roomListeners.forEach(({r,cb,isChildAdded})=>off(r, isChildAdded?'child_added':'value', cb));
    roomListeners = [];
  }

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

  // 空いている部屋を探して入るか、無ければ新規に作ってホストになる
  // 部屋を新規作成してホストになる
  // mode は 'br'(バトルロイヤル)か 'raid'。部屋一覧で混ざらないよう分けて扱う。
  // 旧クライアントの部屋には mode が無いので 'br' とみなす。
  // teamSize はチーム戦の1チーム人数(1=個人戦)。capacity と同様に素通しで部屋metaへ載せるだけ
  // sub はチーム戦のサブモード('br20'=20チームバトロワ / 'arena'=バトルアリーナ / null=従来型)。
  // これも素通し。旧クライアントの部屋には無いので、読む側は v.sub||null で扱う。
  window.__aramonCreateRoom = async function(capacity, playerName, elementKey, mmInfo, skinId, mode, teamSize, sub){
    const roomMode = mode==='raid' ? 'raid' : 'br';
    const roomTeamSize = (teamSize|0) > 1 ? (teamSize|0) : 1;
    const roomSub = (sub==='br20' || sub==='arena') ? sub : null;
    const roomId = genId();
    const roomRef = ref(fbDb, `rooms/${roomId}`);
    await set(roomRef, {
      meta: { hostId: myPlayerId, capacity, teamSize: roomTeamSize, sub: roomSub, status:'waiting', mode:roomMode, createdAt: Date.now(), hostName: playerName },
      players: { [myPlayerId]: { name: playerName, element: elementKey, ...mmEntryFields(mmInfo), skin: skinId||null, joinedAt: Date.now(), isHost:true, input:{} } },
    });
    const lobbyEntryRef = push(ref(fbDb,'lobby'), { roomId, capacity, teamSize: roomTeamSize, sub: roomSub, count:1, status:'waiting', mode:roomMode, createdAt: Date.now(), hostName: playerName });
    onDisconnect(ref(fbDb, `rooms/${roomId}/players/${myPlayerId}`)).remove();
    onDisconnect(lobbyEntryRef).remove();
    window.__aramonLobbyEntryId = lobbyEntryRef.key;
    activeRoomId = roomId;
    return { roomId, isHost:true, myPlayerId };
  };

  // 募集中の部屋一覧を取得する(部屋を探す画面用)
  window.__aramonListOpenRooms = async function(mode){
    const wantMode = mode==='raid' ? 'raid' : 'br';
    try{
      const lobbyRef = ref(fbDb, 'lobby');
      const q = query(lobbyRef, orderByChild('status'), limitToLast(30));
      const snap = await get(q);
      const rooms = [];
      snap.forEach(ch=>{
        const v = ch.val();
        if(v && v.status==='waiting' && v.count < v.capacity && (v.mode||'br')===wantMode){
          rooms.push({ lobbyKey: ch.key, roomId: v.roomId, capacity: v.capacity, teamSize:(v.teamSize||1), sub:(v.sub||null), count: v.count, hostName: v.hostName||'名無しのモンスター', createdAt: v.createdAt||0, mode:(v.mode||'br') });
        }
      });
      rooms.sort((a,b)=> b.createdAt - a.createdAt);
      return rooms;
    }catch(err){
      console.error('list rooms failed', err);
      return [];
    }
  };

  // 指定した部屋に参加する(部屋を探す画面で選んだ場合)
  window.__aramonJoinRoom = async function(roomId, lobbyKey, playerName, elementKey, mmInfo, skinId){
    try{
      const roomPlayersRef = ref(fbDb, `rooms/${roomId}/players`);
      const lobbyCountRef = ref(fbDb, `lobby/${lobbyKey}/count`);
      const metaSnap = await get(ref(fbDb, `rooms/${roomId}/meta`));
      const meta = metaSnap.val();
      if(!meta || meta.status!=='waiting') return { ok:false, reason:'この部屋はもう開始しています' };

      const txResult = await runTransaction(lobbyCountRef, (cur)=>{
        if(cur===null) return cur;
        if(cur >= meta.capacity) return; // abort
        return cur + 1;
      });
      if(!txResult.committed) return { ok:false, reason:'この部屋は満員です' };

      await set(child(roomPlayersRef, myPlayerId), {
        name: playerName, element: elementKey, ...mmEntryFields(mmInfo), skin: skinId||null, joinedAt: Date.now(), isHost:false, input:{}
      });
      onDisconnect(child(roomPlayersRef, myPlayerId)).remove();
      activeRoomId = roomId;
      return { ok:true, roomId, isHost:false, myPlayerId, capacity: meta.capacity, teamSize:(meta.teamSize||1), sub:(meta.sub||null), mode:(meta.mode||'br') };
    }catch(err){
      console.error('join room failed', err);
      return { ok:false, reason:'参加に失敗しました' };
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
        const lobbyCountRef = ref(fbDb, `lobby/${cand.lobbyKey}/count`);
        const txResult = await runTransaction(lobbyCountRef, (cur)=>{
          if(cur===null) return cur;
          if(cur >= capacity) return; // abort
          return cur + 1;
        });
        if(txResult.committed){
          await set(child(roomPlayersRef, myPlayerId), {
            name: playerName, element: elementKey, ...mmEntryFields(mmInfo), skin: skinId||null, joinedAt: Date.now(), isHost:false, input:{}
          });
          onDisconnect(child(roomPlayersRef, myPlayerId)).remove();
          joinedRoomId = cand.roomId;
          break;
        }
      }
    }catch(err){ console.error('room search failed', err); }

    if(!joinedRoomId){
      const roomId = genId();
      const roomRef = ref(fbDb, `rooms/${roomId}`);
      await set(roomRef, {
        meta: { hostId: myPlayerId, capacity, teamSize: wantTeamSize, sub: wantSub, status:'waiting', mode:wantMode, createdAt: Date.now() },
        players: { [myPlayerId]: { name: playerName, element: elementKey, ...mmEntryFields(mmInfo), skin: skinId||null, joinedAt: Date.now(), isHost:true, input:{} } },
      });
      const lobbyEntryRef = push(ref(fbDb,'lobby'), { roomId, capacity, teamSize: wantTeamSize, sub: wantSub, count:1, status:'waiting', mode:wantMode, createdAt: Date.now() });
      onDisconnect(ref(fbDb, `rooms/${roomId}/players/${myPlayerId}`)).remove();
      onDisconnect(lobbyEntryRef).remove();
      window.__aramonLobbyEntryId = lobbyEntryRef.key;
      joinedRoomId = roomId;
      becameHost = true;
    }

    activeRoomId = joinedRoomId;
    return { roomId: joinedRoomId, isHost: becameHost, myPlayerId };
  };

  window.__aramonLeaveRoom = async function(roomId){
    clearRoomListeners();
    try{
      await remove(ref(fbDb, `rooms/${roomId}/players/${myPlayerId}`));
    }catch(err){}
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
      return snap.val() || {};
    }catch(err){
      console.error('fetch players once failed', err);
      return {};
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
    roomListeners.push({r,cb});
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
    roomListeners.push({r,cb});
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
    roomListeners.push({r,cb,isChildAdded:true});
  };

  // 命中報告: 誰かが人間に当てた攻撃を報告し、ホストだけが確定計算する
  window.__aramonReportHit = async function(roomId, hit){
    try{ await push(ref(fbDb, `rooms/${roomId}/hits`), stripUndefined(hit)); }catch(err){ warnRoomWrite('hit', err); }
  };

  window.__aramonWatchHitsAsHost = function(roomId, callback){
    const r = ref(fbDb, `rooms/${roomId}/hits`);
    const cb = (snap)=>{ callback(snap.key, snap.val()); };
    onChildAdded(r, cb);
    roomListeners.push({r,cb,isChildAdded:true});
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
    roomListeners.push({r,cb,isChildAdded:true});
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
    roomListeners.push({r,cb,isChildAdded:true});
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
    roomListeners.push({r,cb,isChildAdded:true});
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
    roomListeners.push({r,cb});
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
    }catch(err){ console.warn('raid damage report failed', err); }
  };
  window.__aramonFetchRaidTotal = async function(weekId){
    try{
      const snap = await get(ref(fbDb, `raids/${weekId}/total`));
      return snap.val() || 0;
    }catch(err){ return 0; }
  };
  /* ランキングは players をそのまま読んで手元で並べ替える。
     orderByChild('dmg') を使うとセキュリティルール側に .indexOn が要り、
     無いと並べ替えが効かない/弾かれる。参加者はせいぜい数十人なので全件読んで問題ない。
     失敗はここで握りつぶさず投げる(呼び出し側が「読み込めなかった」と出せるように)。 */
  window.__aramonFetchRaidRanking = async function(weekId, topN){
    const snap = await get(ref(fbDb, `raids/${weekId}/players`));
    const rows = [];
    snap.forEach(ch=>{
      const v = ch.val();
      if(v) rows.push({ name:v.name||ch.key, dmg:Number(v.dmg)||0, runs:Number(v.runs)||0, best:Number(v.best)||0 });
    });
    rows.sort((a,b)=>b.dmg-a.dmg);
    return rows.slice(0, topN||20);
  };

  window.__aramonCleanupLobbyEntry = async function(){
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
