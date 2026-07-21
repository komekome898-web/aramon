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
      await runTransaction(scoreRef, (cur)=>{
        if(!cur){
          return {
            name: entry.name, element: entry.element, elementLabel: entry.elementLabel,
            mastermonName: entry.mastermonName || null,
            mastermonLevel: entry.mastermonLevel || null,
            kills: entry.kills, damage: entry.damage,
            placement: entry.placement, isWin: entry.isWin,
            time: entry.time, ts: entry.ts,
          };
        }
        return {
          name: entry.name, element: entry.element, elementLabel: entry.elementLabel,
          mastermonName: entry.mastermonName || cur.mastermonName || null,
          mastermonLevel: Math.max(cur.mastermonLevel||0, entry.mastermonLevel||0) || null,
          kills: Math.max(cur.kills||0, entry.kills||0),
          damage: Math.max(cur.damage||0, entry.damage||0),
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
      const q = query(ref(fbDb, 'scores'), orderByChild(field), limitToLast(count||20));
      const snap = await get(q);
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
     matchLogs/{autoId} : { name, map, mapLabel, element, elementLabel, mode, ts }
     試合が終わるたびに1件ずつ追記していく単純なログ。ランキング用のscoresとは別物で、
     こちらは「誰が・いつ・どのマップ・どのモンスターで遊んだか」を集計するためだけに使う。
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

  function clearRoomListeners(){
    roomListeners.forEach(({r,cb,isChildAdded})=>off(r, isChildAdded?'child_added':'value', cb));
    roomListeners = [];
  }

  // 空いている部屋を探して入るか、無ければ新規に作ってホストになる
  // 部屋を新規作成してホストになる
  window.__aramonCreateRoom = async function(capacity, playerName, elementKey, mmLevel, skinId){
    const roomId = genId();
    const roomRef = ref(fbDb, `rooms/${roomId}`);
    await set(roomRef, {
      meta: { hostId: myPlayerId, capacity, status:'waiting', createdAt: Date.now(), hostName: playerName },
      players: { [myPlayerId]: { name: playerName, element: elementKey, mmLevel: mmLevel||null, skin: skinId||null, joinedAt: Date.now(), isHost:true, input:{} } },
    });
    const lobbyEntryRef = push(ref(fbDb,'lobby'), { roomId, capacity, count:1, status:'waiting', createdAt: Date.now(), hostName: playerName });
    onDisconnect(ref(fbDb, `rooms/${roomId}/players/${myPlayerId}`)).remove();
    onDisconnect(lobbyEntryRef).remove();
    window.__aramonLobbyEntryId = lobbyEntryRef.key;
    activeRoomId = roomId;
    return { roomId, isHost:true, myPlayerId };
  };

  // 募集中の部屋一覧を取得する(部屋を探す画面用)
  window.__aramonListOpenRooms = async function(){
    try{
      const lobbyRef = ref(fbDb, 'lobby');
      const q = query(lobbyRef, orderByChild('status'), limitToLast(30));
      const snap = await get(q);
      const rooms = [];
      snap.forEach(ch=>{
        const v = ch.val();
        if(v && v.status==='waiting' && v.count < v.capacity){
          rooms.push({ lobbyKey: ch.key, roomId: v.roomId, capacity: v.capacity, count: v.count, hostName: v.hostName||'名無しのモンスター', createdAt: v.createdAt||0 });
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
  window.__aramonJoinRoom = async function(roomId, lobbyKey, playerName, elementKey, mmLevel, skinId){
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
        name: playerName, element: elementKey, mmLevel: mmLevel||null, skin: skinId||null, joinedAt: Date.now(), isHost:false, input:{}
      });
      onDisconnect(child(roomPlayersRef, myPlayerId)).remove();
      activeRoomId = roomId;
      return { ok:true, roomId, isHost:false, myPlayerId, capacity: meta.capacity };
    }catch(err){
      console.error('join room failed', err);
      return { ok:false, reason:'参加に失敗しました' };
    }
  };

  // 旧方式(自動マッチング)は互換のため残置
  window.__aramonFindOrCreateRoom = async function(capacity, playerName, elementKey, skinId){
    const lobbyRef = ref(fbDb, 'lobby');
    const q = query(lobbyRef, orderByChild('status'), limitToLast(30));
    let joinedRoomId = null;
    let becameHost = false;

    try{
      const snap = await get(q);
      const candidates = [];
      snap.forEach(ch=>{
        const v = ch.val();
        if(v && v.status==='waiting' && v.capacity===capacity && v.count < v.capacity){
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
            name: playerName, element: elementKey, skin: skinId||null, joinedAt: Date.now(), isHost:false, input:{}
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
        meta: { hostId: myPlayerId, capacity, status:'waiting', createdAt: Date.now() },
        players: { [myPlayerId]: { name: playerName, element: elementKey, skin: skinId||null, joinedAt: Date.now(), isHost:true, input:{} } },
      });
      const lobbyEntryRef = push(ref(fbDb,'lobby'), { roomId, capacity, count:1, status:'waiting', createdAt: Date.now() });
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
      await update(ref(fbDb, `rooms/${roomId}/players/${myPlayerId}`), { input, inputTs: Date.now() });
    }catch(err){}
  };

  window.__aramonSendRecon = async function(roomId, recon){
    try{
      await update(ref(fbDb, `rooms/${roomId}/players/${myPlayerId}`), { recon, reconTs: Date.now() });
    }catch(err){}
  };

  window.__aramonSetRoomSeed = async function(roomId, seed, fixedPlayers, mapKey, hostMastermonBots, worldData){
    try{ await update(ref(fbDb, `rooms/${roomId}/meta`), { seed, fixedPlayers: fixedPlayers||null, mapKey: mapKey||'wild', hostMastermonBots: hostMastermonBots||null, world: worldData||null }); }catch(err){}
  };

  window.__aramonWaitForRoomSeed = function(roomId, timeoutMs){
    return new Promise((resolve)=>{
      const r = ref(fbDb, `rooms/${roomId}/meta`);
      let done = false;
      const cb = (snap)=>{
        const v = snap.val();
        if(v && v.seed!=null && v.fixedPlayers && !done){
          done=true; off(r,'value',cb); resolve({ seed:v.seed, fixedPlayers:v.fixedPlayers, mapKey:v.mapKey||'wild', hostMastermonBots:v.hostMastermonBots||[], world:v.world||null });
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
      await set(ref(fbDb, `rooms/${roomId}/state`), stateObj);
    }catch(err){}
  };

  window.__aramonWatchInputs = function(roomId, callback){
    const r = ref(fbDb, `rooms/${roomId}/players`);
    const cb = (snap)=>{ callback(snap.val()||{}); };
    onValue(r, cb);
    roomListeners.push({r,cb});
  };

  window.__aramonPushEvent = async function(roomId, evt){
    try{ await push(ref(fbDb, `rooms/${roomId}/events`), evt); }catch(err){}
  };

  window.__aramonWatchEvents = function(roomId, callback){
    const r = ref(fbDb, `rooms/${roomId}/events`);
    const q = query(r, limitToLast(1));
    const cb = (snap)=>{ snap.forEach(ch=>callback(ch.val())); };
    onValue(q, cb);
    roomListeners.push({r:q,cb});
  };

  // 命中報告: 誰かが人間に当てた攻撃を報告し、ホストだけが確定計算する
  window.__aramonReportHit = async function(roomId, hit){
    try{ await push(ref(fbDb, `rooms/${roomId}/hits`), hit); }catch(err){}
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
    try{ await push(ref(fbDb, `rooms/${roomId}/fireEvents`), fireEvt); }catch(err){}
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
    try{ await push(ref(fbDb, `rooms/${roomId}/shotEvents`), evt); }catch(err){}
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
    try{ await push(ref(fbDb, `rooms/${roomId}/lootEvents`), evt); }catch(err){}
  };
  window.__aramonWatchLootEvents = function(roomId, callback){
    const r = ref(fbDb, `rooms/${roomId}/lootEvents`);
    const cb = (snap)=>{ callback(snap.key, snap.val()); };
    onChildAdded(r, cb);
    roomListeners.push({r,cb,isChildAdded:true});
  };

  window.__aramonPublishAuthState = async function(roomId, authState){
    try{ await set(ref(fbDb, `rooms/${roomId}/authState`), authState); }catch(err){}
  };
  window.__aramonWatchAuthState = function(roomId, callback){
    const r = ref(fbDb, `rooms/${roomId}/authState`);
    const cb = (snap)=>{ callback(snap.val()||null); };
    onValue(r, cb);
    roomListeners.push({r,cb});
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
          best = {
            name: best.name, element: best.element, elementLabel: best.elementLabel,
            mastermonName: best.mastermonName || it.val.mastermonName || null,
            mastermonLevel: Math.max(best.mastermonLevel||0, it.val.mastermonLevel||0) || null,
            kills: Math.max(best.kills||0, it.val.kills||0),
            damage: Math.max(best.damage||0, it.val.damage||0),
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
