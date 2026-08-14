/* =====================================================================
   net_transport.js — マルチプレイのトランスポート抽象化(rtdb / WebRTC)

   目的: ホスト/ゲスト格差の根源であるFirebase RTDB往復遅延(片道50〜200ms)を、
   WebRTC DataChannelのP2P直結(ホスト⇔各ゲストのスター型)で構造的に潰す。
   RTDBはシグナリングと「必ず動くフォールバック」として残す。

   ■ チャンネル表(どの便で・どちら向きに・何を運ぶか)
   | ch    | 方向          | DataChannel | rtc接続中のRTDB送信                     |
   |-------|---------------|-------------|-----------------------------------------|
   | input | ゲスト→ホスト | fast        | **床として従来の22Hzで送り続ける**(DC便は40Hzの上乗せ) |
   | auth  | ホスト→全員   | fast        | **床として従来の20Hzで書き続ける**(DC便は30Hzの上乗せ。ackで次便を待たせない) |
   | fire  | ゲスト→ホスト | reliable    | **常に送る**(信頼配送の土台はRTDBのまま)  |
   | hit   | ゲスト→ホスト | reliable    | 常に送る                                |
   | event | ホスト→全員   | reliable    | 常に送る                                |
   | shot  | ホスト→全員   | reliable    | 常に送る                                |
   | loot  | ホスト→全員   | reliable    | 常に送る                                |

   fast     = ordered:false, maxRetransmits:0(遅延最優先。落ちても次の便が来る)
   reliable = ordered:true(TCP的。接続が生きている限り必ず届く)

   ■ 昇格と降格(相手ごとに独立した状態遷移)
     rtdbのみ(試合開始時) → connecting(シグナリング中。送受信はrtdbのまま)
       → live(fast/reliable両方open。DataChannelへ切替)
       → down(DataChannelのclose/error/沈黙5秒/接続失敗 → rtdbへ即時フォールバック。
              ゲスト側は少し待って再接続を数回だけ試みる)
     どちらの経路で届いても同じハンドラに流れる。信頼配送チャンネルは送信側が
     両経路に同じキー(_k)を刻み、受信側で重複を1回に畳む(既存のprocessed*Keysと同じ発想)。

   ■ rtdbしか無い環境では1バイトも挙動が変わらない保証
     - rtcが確立していない相手への送信は、元の __aramon*(firebase.js)へそのまま委譲する。
     - 受信側のフィルタは「rtcで既に届けたキー/seq」しか落とさないので、rtc未確立なら
       何も落とさず素通しになる(rtcSeenが常に空)。
     - _k はrtcでDataChannelへ実際に送れたときだけ付与する。rtc未確立の送信は
       ペイロードもキーも従来と同一。
     - 旧クライアント(このファイルを読まない版)とはシグナリングが成立しないため
       自動的に全経路rtdbになり、現行と同じ動きで混在できる。

   ■ セキュリティルール
     シグナリングは新パス rooms/{id}/rtc/{fromPid}_{toPid} を使う(firebase.js側)。
     rooms直下を丸ごと許可していないルールの場合は rtc の .read/.write の追加が要る
     (貼るまではシグナリングが書けず、全経路rtdbのまま=従来通り遊べる)。

   ゲームロジックは一切持たない。network.js/combat.js/world.jsからは
   window.__aramon* の関数シグネチャそのままで透過的に使われる。
===================================================================== */
(function(){
'use strict';

/* ---- 名前付き定数(数値バランスは発注者が実機で調整する) ---- */
const RTC_STUN_URLS = ['stun:stun.l.google.com:19302']; // STUNのみ。TURNは使わない(NAT越え不可なら素直にrtdbのまま)
const RTC_PING_INTERVAL_MS = 1000;      // fastチャンネルでのping間隔(RTT実測+沈黙検知の生存信号)
const RTC_SILENCE_TIMEOUT_MS = 5000;    // これだけ無通信なら切れたとみなしてrtdbへ戻す
const RTC_CONNECT_TIMEOUT_MS = 12000;   // offerからこの時間で確立しなければ諦める
const RTC_RETRY_DELAY_MS = 8000;        // 降格後に再接続を試みるまでの待ち(ゲスト側のみ)
const RTC_MAX_CONNECT_ATTEMPTS = 3;     // 再接続を含めた接続試行の上限(超えたら試合中ずっとrtdb)
const RTC_SIGNAL_STALE_MS = 30000;      // これより古いシグナリングは無視(部屋パスに残った古い便を拾わない)
/* 【RTDBは床・DCは上乗せ】rtc接続中もRTDBへは従来の間隔で書き続ける。
   500msキープアライブへ間引く設計にしていたら、CPU逼迫や電波劣化で
   unreliable DCが連続で落ちたとき、ゲストのauthが実質0.5秒間隔になって
   補間が飢え、相手が止まって飛んだ(ハーネスで実測: 被弾表示300ms・p95ジャンプ25px)。
   50ms=現行のRTDB配信間隔そのもの(quota現状維持。悪くなりようがない)。 */
const AUTH_RTDB_KEEPALIVE_MS = 50;
const INPUT_RTDB_FLOOR_MS = 45;         // 入力のRTDB床(現行の22Hz。DC便は40Hzで上乗せ)
const RTT_EWMA_ALPHA = 0.2;             // RTTの指数移動平均の係数
const AUTH_STAT_EWMA_ALPHA = 0.1;       // auth到着間隔・ジッタの指数移動平均の係数

/* チャンネル定義。dir: g2h=ゲスト→ホスト / h2all=ホスト→全ゲスト */
const CHANNELS = {
  input: { dc:'fast',     dir:'g2h'   },
  auth:  { dc:'fast',     dir:'h2all' },
  fire:  { dc:'reliable', dir:'g2h'   },
  hit:   { dc:'reliable', dir:'g2h'   },
  event: { dc:'reliable', dir:'h2all' },
  shot:  { dc:'reliable', dir:'h2all' },
  loot:  { dc:'reliable', dir:'h2all' },
};

function nowMs(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }

/* =====================================================================
   Transport — WebRTC接続の管理(コア)。ゲーム状態を一切知らない。
   テスト(tools/rtc_test.html)はこのクラスを2つ作り、シグナリングを
   ページ内スタブで注入して直結させる。
===================================================================== */
class Transport {
  constructor(){
    this.onPeerState = null;   // (pid, state, reason) 昇格/降格の通知
    this._afterAttach = null;  // 既定インスタンスのラッパ層が状態リセットに使う
    this._resetAll();
  }
  _resetAll(){
    this.attached = false;
    this.roomId = null; this.myPid = null; this.isHost = false; this.hostPid = null;
    this.peers = new Map();     // pid -> peer
    this.signaling = null;
    this.signalStops = [];
    this.msgHandlers = {};      // ch -> fn(key, data, fromPid)
    this.pingTimer = null;
    this.attachAt = 0;
    this.msgSeq = 0;
    this.nonce = '';
    this.pingIntervalMs = RTC_PING_INTERVAL_MS;
    this.silenceTimeoutMs = RTC_SILENCE_TIMEOUT_MS;
    this.retryDelayMs = RTC_RETRY_DELAY_MS;
  }

  /* 試合開始時に呼ぶ。rtdbで開始し、裏でrtc接続を張り始める。
     opts: { roomId, myPid, isHost, hostPid, peerPids,
             signaling?{send,watch}(テスト注入用), pingIntervalMs?, silenceTimeoutMs?, retryDelayMs? } */
  attach(opts){
    this.detach();
    if(!opts || !opts.roomId || !opts.myPid) return;
    this.attached = true;
    this.roomId = opts.roomId;
    this.myPid = String(opts.myPid);
    this.isHost = !!opts.isHost;
    this.hostPid = opts.hostPid ? String(opts.hostPid) : null;
    this.attachAt = Date.now();
    this.nonce = Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2,5);
    if(opts.pingIntervalMs) this.pingIntervalMs = opts.pingIntervalMs;
    if(opts.silenceTimeoutMs) this.silenceTimeoutMs = opts.silenceTimeoutMs;
    if(opts.retryDelayMs != null) this.retryDelayMs = opts.retryDelayMs;
    this.signaling = opts.signaling || this._firebaseSignaling();

    // WebRTC自体が無い環境(古いブラウザ等)は接続を張らない=全経路rtdbのまま
    const rtcOk = (typeof RTCPeerConnection !== 'undefined') && this.signaling;
    if(rtcOk){
      if(this.isHost){
        // ホスト: 各ゲストからのofferを待つ(受け身)
        for(const pid of (opts.peerPids||[])){
          if(pid===this.myPid) continue;
          this._addPeer(String(pid), false);
        }
      } else if(this.hostPid && this.hostPid!==this.myPid){
        // ゲスト: ホストへ自分からofferを出す
        this._addPeer(this.hostPid, true);
      }
      this._startPingLoop();
    }
    if(this._afterAttach) this._afterAttach();
  }

  detach(){
    if(this.pingTimer){ clearInterval(this.pingTimer); this.pingTimer = null; }
    for(const peer of this.peers.values()){
      if(peer.retryTimer){ clearTimeout(peer.retryTimer); peer.retryTimer = null; }
      if(peer.connectTimer){ clearTimeout(peer.connectTimer); peer.connectTimer = null; }
      this._closePeerPc(peer);
    }
    for(const stop of this.signalStops){ try{ if(typeof stop==='function') stop(); }catch(err){} }
    this._resetAll();
  }

  /* DataChannel経由の受信ハンドラ。ラッパ層(またはテスト)が登録する */
  onMessage(ch, fn){ this.msgHandlers[ch] = fn; }

  /* chの向きに沿った相手へDataChannelで送る。1人でも送れたらtrue。
     送れなかった(未接続等)ときは呼び出し側がrtdbへフォールバックする */
  send(ch, data, key){
    const def = CHANNELS[ch];
    if(!def || !this.attached) return false;
    let targets;
    if(def.dir==='g2h') targets = (!this.isHost && this.hostPid) ? [this.peers.get(this.hostPid)] : [];
    else                targets = this.isHost ? Array.from(this.peers.values()) : [];
    let sent = false;
    let raw = null;
    for(const peer of targets){
      if(!peer || !peer.live) continue;
      const c = def.dc==='fast' ? peer.fast : peer.reliable;
      if(!c || c.readyState!=='open') continue;
      try{
        if(raw===null) raw = JSON.stringify({ ch, k: key||null, d: data });
        c.send(raw);
        sent = true;
      }catch(err){
        this._demotePeer(peer, 'send-error');
      }
    }
    return sent;
  }

  makeKey(){ return this.myPid + '.' + this.nonce + '.' + (++this.msgSeq); }

  /* ゲスト: ホストとのrtc直結が生きているか(入力レート・補間遅延の適応に使う) */
  isRtcActiveToHost(){
    if(!this.attached || this.isHost || !this.hostPid) return false;
    const p = this.peers.get(this.hostPid);
    return !!(p && p.live);
  }
  /* ホスト: 全ゲストとrtc直結できているか(auth配信レートの適応に使う。
     1人でもrtdbのゲストがいる間はRTDBのquotaを守って現行レートのまま) */
  isRtcActiveAllPeers(){
    if(!this.attached || !this.isHost || this.peers.size===0) return false;
    for(const p of this.peers.values()){ if(!p.live) return false; }
    return true;
  }
  /* ホスト: rtc未確立のゲストが1人でもいるか(auth配信のRTDB併送の判断) */
  hasNonRtcPeer(){
    if(!this.attached || !this.isHost) return false;
    for(const p of this.peers.values()){ if(!p.live) return true; }
    return false;
  }

  /* テスト用: 突然の切断を模して降格処理を通す */
  debugKillPeer(pid){
    const peer = this.peers.get(String(pid));
    if(peer) this._demotePeer(peer, 'debug-kill');
  }

  /* ---- 内部: シグナリング(既定はfirebase.jsの rooms/{id}/rtc パス) ---- */
  _firebaseSignaling(){
    const roomId = this.roomId;
    if(typeof window==='undefined' || !window.__aramonSendRtcSignal || !window.__aramonWatchRtcSignals) return null;
    return {
      send(from, to, msg){ window.__aramonSendRtcSignal(roomId, from, to, msg); },
      watch(from, to, cb){ return window.__aramonWatchRtcSignals(roomId, from, to, cb); },
    };
  }
  _sendSignal(toPid, msg){
    if(!this.signaling) return;
    msg.ts = Date.now();
    try{ this.signaling.send(this.myPid, toPid, msg); }catch(err){}
  }

  _addPeer(pid, initiator){
    const peer = {
      pid, initiator,
      pc:null, fast:null, reliable:null,
      live:false, state:'connecting',
      lastRecvAt:0, rttMs:null, attempts:0,
      pendingIce:[], remoteSet:false,
      connectTimer:null, retryTimer:null,
    };
    this.peers.set(pid, peer);
    // 相手→自分 宛のシグナリングを購読する
    const stop = this.signaling.watch(pid, this.myPid, (msg)=> this._handleSignal(peer, msg));
    if(stop) this.signalStops.push(stop);
    if(initiator) this._connectPeer(peer);
  }

  /* ゲスト側: offerを作って接続を張る(再接続でも使う) */
  _connectPeer(peer){
    peer.attempts++;
    peer.state = 'connecting';
    peer.remoteSet = false; peer.pendingIce = [];
    const pc = this._newPc(peer);
    // DataChannelはofferする側(ゲスト)が2本とも作る。ホストはondatachannelで受ける
    this._wireChannel(peer, 'fast',     pc.createDataChannel('fast',     { ordered:false, maxRetransmits:0 }));
    this._wireChannel(peer, 'reliable', pc.createDataChannel('reliable', { ordered:true }));
    pc.createOffer()
      .then(offer=> pc.setLocalDescription(offer))
      .then(()=> this._sendSignal(peer.pid, { t:'offer', sdp: pc.localDescription.sdp }))
      .catch(()=> this._demotePeer(peer, 'offer-failed'));
    if(peer.connectTimer) clearTimeout(peer.connectTimer);
    peer.connectTimer = setTimeout(()=>{
      peer.connectTimer = null;
      if(!peer.live) this._demotePeer(peer, 'connect-timeout');
    }, RTC_CONNECT_TIMEOUT_MS);
  }

  _newPc(peer){
    this._closePeerPc(peer);
    const pc = new RTCPeerConnection({ iceServers: RTC_STUN_URLS.map(u=>({ urls:u })) });
    peer.pc = pc;
    pc.onicecandidate = (e)=>{
      if(e.candidate) this._sendSignal(peer.pid, { t:'ice', c: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = ()=>{
      if(peer.pc!==pc) return; // 作り直し後の古いpcのイベントは無視
      const s = pc.connectionState;
      // 'disconnected'は一時的に出て自然回復することがあるので、沈黙検知(ping)に任せる
      if(s==='failed' || s==='closed') this._demotePeer(peer, 'pc-'+s);
    };
    pc.ondatachannel = (e)=>{
      if(peer.pc!==pc) return;
      this._wireChannel(peer, e.channel.label, e.channel);
    };
    return pc;
  }

  _wireChannel(peer, label, ch){
    if(label!=='fast' && label!=='reliable') return;
    peer[label] = ch;
    ch.onopen = ()=>{
      // fast/reliableの両方が開いたら昇格(以後この相手への送信はDataChannel)
      if(peer.fast && peer.fast.readyState==='open' && peer.reliable && peer.reliable.readyState==='open' && !peer.live){
        peer.live = true;
        peer.state = 'live';
        peer.lastRecvAt = nowMs();
        if(peer.connectTimer){ clearTimeout(peer.connectTimer); peer.connectTimer = null; }
        this._emitPeerState(peer, 'live', 'connected');
      }
    };
    ch.onclose = ()=> this._demotePeer(peer, 'dc-close-'+label);
    ch.onerror = ()=> this._demotePeer(peer, 'dc-error-'+label);
    ch.onmessage = (e)=>{
      peer.lastRecvAt = nowMs();
      let m = null;
      try{ m = JSON.parse(e.data); }catch(err){ return; }
      if(!m || typeof m!=='object') return;
      if(m.c==='ping'){
        // pongはfastで返す(計測もfast経路のRTTにしたい)
        if(peer.fast && peer.fast.readyState==='open'){
          try{ peer.fast.send(JSON.stringify({ c:'pong', t:m.t })); }catch(err){}
        }
        return;
      }
      if(m.c==='pong'){
        const rtt = nowMs() - m.t;
        peer.rttMs = (peer.rttMs==null) ? rtt : peer.rttMs + (rtt - peer.rttMs)*RTT_EWMA_ALPHA;
        return;
      }
      if(m.ch && CHANNELS[m.ch]){
        const fn = this.msgHandlers[m.ch];
        if(fn) fn(m.k||null, m.d, peer.pid);
      }
    };
  }

  _handleSignal(peer, msg){
    if(!this.attached || !msg || typeof msg!=='object') return;
    // 部屋パスに残った古い便(前の接続試行のofferなど)を拾わない
    if(typeof msg.ts==='number' && msg.ts < this.attachAt - RTC_SIGNAL_STALE_MS) return;
    if(msg.t==='offer' && !peer.initiator){
      // ホスト側: ゲストからのoffer(再接続のofferなら既存pcを破棄して作り直す)
      peer.live = false; peer.state = 'connecting';
      peer.remoteSet = false; peer.pendingIce = [];
      const pc = this._newPc(peer);
      pc.setRemoteDescription({ type:'offer', sdp: msg.sdp })
        .then(()=>{ peer.remoteSet = true; this._flushPendingIce(peer); return pc.createAnswer(); })
        .then(ans=> pc.setLocalDescription(ans))
        .then(()=> this._sendSignal(peer.pid, { t:'answer', sdp: pc.localDescription.sdp }))
        .catch(()=> this._demotePeer(peer, 'answer-failed'));
    } else if(msg.t==='answer' && peer.initiator && peer.pc && !peer.remoteSet){
      peer.pc.setRemoteDescription({ type:'answer', sdp: msg.sdp })
        .then(()=>{ peer.remoteSet = true; this._flushPendingIce(peer); })
        .catch(()=> this._demotePeer(peer, 'set-answer-failed'));
    } else if(msg.t==='ice' && msg.c){
      if(peer.pc && peer.remoteSet){
        peer.pc.addIceCandidate(msg.c).catch(()=>{});
      } else {
        peer.pendingIce.push(msg.c); // remoteDescription前に届いた候補は積んでおく
      }
    }
  }
  _flushPendingIce(peer){
    if(!peer.pc) return;
    for(const c of peer.pendingIce){ peer.pc.addIceCandidate(c).catch(()=>{}); }
    peer.pendingIce = [];
  }

  _closePeerPc(peer){
    if(peer.fast){ try{ peer.fast.onclose = peer.fast.onerror = null; peer.fast.close(); }catch(err){} peer.fast = null; }
    if(peer.reliable){ try{ peer.reliable.onclose = peer.reliable.onerror = null; peer.reliable.close(); }catch(err){} peer.reliable = null; }
    if(peer.pc){ try{ peer.pc.onconnectionstatechange = null; peer.pc.ondatachannel = null; peer.pc.close(); }catch(err){} peer.pc = null; }
  }

  /* 降格: rtdbへ即時フォールバック。以後この相手への送信はsend()がfalseを返し、
     ラッパ層が元の__aramon*(rtdb)をそのまま使う */
  _demotePeer(peer, reason){
    if(!this.attached || !this.peers.has(peer.pid)) return;
    if(peer.state==='down' || peer.state==='waiting-retry') return;
    const wasLive = peer.live;
    peer.live = false;
    peer.state = 'down';
    if(peer.connectTimer){ clearTimeout(peer.connectTimer); peer.connectTimer = null; }
    this._closePeerPc(peer);
    this._emitPeerState(peer, 'down', reason);
    // 再接続はofferを出す側(ゲスト)だけが試みる。上限を超えたら試合中ずっとrtdbのまま
    if(peer.initiator && peer.attempts < RTC_MAX_CONNECT_ATTEMPTS){
      peer.state = 'waiting-retry';
      peer.retryTimer = setTimeout(()=>{
        peer.retryTimer = null;
        if(this.attached && this.peers.has(peer.pid)) this._connectPeer(peer);
      }, this.retryDelayMs);
    }
    // wasLiveは通知内容に含めないが、ここを通った時点で送信は次のフレームからrtdbへ戻っている
    void wasLive;
  }

  _emitPeerState(peer, state, reason){
    if(this.onPeerState){ try{ this.onPeerState(peer.pid, state, reason); }catch(err){} }
  }

  _startPingLoop(){
    if(this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(()=>{
      if(!this.attached) return;
      const t = nowMs();
      for(const peer of this.peers.values()){
        if(!peer.live) continue;
        // 沈黙検知: pingを送り合っているので、無通信=接続が黙って死んでいる
        if(peer.lastRecvAt && t - peer.lastRecvAt > this.silenceTimeoutMs){
          this._demotePeer(peer, 'silence');
          continue;
        }
        if(peer.fast && peer.fast.readyState==='open'){
          try{ peer.fast.send(JSON.stringify({ c:'ping', t })); }
          catch(err){ this._demotePeer(peer, 'ping-send-error'); }
        }
      }
    }, this.pingIntervalMs);
  }
}

/* =====================================================================
   ラッパ層 — 既定インスタンスに対して window.__aramon* を透過的に包む。
   firebase.jsはESモジュールで、このファイル(通常script)より後に実行されるため、
   ラップはDOMContentLoaded(モジュール実行後)で行う。
===================================================================== */
const dflt = new Transport();
dflt.Transport = Transport;           // テストページがクラスを取り出して2つ作るために公開
if(typeof window!=='undefined') window.NetTransport = dflt;

const RAW = {};   // 元の __aramon*(rtdb直呼び)。ラップ時に退避する

/* ラッパの受信状態(部屋=試合ごとにattachでリセットされる) */
const st = {};
function resetWrapperState(){
  st.cbs = {};                 // ch -> アプリの受信コールバック
  st.rtdbPlayers = {};         // WatchInputsの直近のRTDBスナップショット
  st.dcInputs = new Map();     // pid -> DataChannelで届いた最新input
  st.authMaxSeq = -Infinity;   // 届けたauthの最大seq(経路問わず)
  st.authMaxDcSeq = -Infinity; // rtc経由で届けたauthの最大seq(rtdb側の遅れた便だけを落とす)
  st.authLastAt = 0;           // auth到着間隔・ジッタの実測(補間遅延の適応に使う)
  st.authAvgMs = 0;
  st.authJitMs = 0;
  st.lastAuthRtdbAt = 0;       // ホスト: authをRTDBへ書いた最終時刻(床の間引き判定)
  st.lastInputRtdbAt = 0;      // ゲスト: inputをRTDBへ書いた最終時刻(床の間引き判定)
  st.rel = {};                 // 信頼配送チャンネルの重複排除 ch -> {rtcSeen:Set, rtdbSeen:Set}
  for(const ch in CHANNELS){
    if(CHANNELS[ch].dc==='reliable') st.rel[ch] = { rtcSeen:new Set(), rtdbSeen:new Set() };
  }
}
resetWrapperState();
dflt._afterAttach = resetWrapperState;

/* ---- 受信の合流点: rtdb/rtcどちらで届いても同じアプリのハンドラへ流す ---- */

/* 信頼配送: 送信側が両経路に刻んだ同じキーで1回に畳む。
   rtdbしか無い環境ではrtcSeenが常に空なのでrtdb便は絶対に落ちない(素通し=挙動不変)。 */
function deliverReliable(ch, key, evt, via){
  const d = st.rel[ch];
  if(!d || key==null){ // キー無し(異常系)は畳めないのでそのまま流す
    invokeReliableCb(ch, key, evt);
    return;
  }
  if(via==='rtdb'){
    if(d.rtcSeen.has(key)) return;      // rtcで先に届けた便の複製
    if(!st.cbs[ch]) return;             // まだ受け口が無い(markせず、後の便に任せる)
    d.rtdbSeen.add(key);
  } else {
    if(d.rtcSeen.has(key) || d.rtdbSeen.has(key)) return;
    if(!st.cbs[ch]) return;
    d.rtcSeen.add(key);
  }
  invokeReliableCb(ch, key, evt);
}
function invokeReliableCb(ch, key, evt){
  const cb = st.cbs[ch];
  if(!cb) return;
  // 既存の受け口のシグネチャに合わせる: eventsだけ(evt, key)、他は(key, evt)
  if(ch==='event') cb(evt, key);
  else cb(key, evt);
}

/* auth(最新優先): rtcで新しいseqを届けた後に遅れて届くrtdbの古い便だけを落とす。
   rtdbしか無い環境ではauthMaxDcSeqが-∞のままなので何も落ちない。 */
function deliverAuth(payload, via){
  if(!payload){ if(via==='rtdb' && st.cbs.auth) st.cbs.auth(payload); return; }
  const seq = (typeof payload.seq==='number') ? payload.seq : null;
  if(seq!==null){
    if(via==='rtc'){
      if(seq <= st.authMaxSeq) return;             // どの経路かを問わず古い便は捨てる
      st.authMaxDcSeq = Math.max(st.authMaxDcSeq, seq);
    } else if(st.authMaxDcSeq >= seq){
      return;                                       // rtcで既により新しいものを届けた
    }
    st.authMaxSeq = Math.max(st.authMaxSeq, seq);
  }
  // 到着間隔とジッタの実測(network.jsの補間遅延の適応が読む)
  const t = nowMs();
  if(st.authLastAt){
    const iv = t - st.authLastAt;
    st.authAvgMs = st.authAvgMs ? st.authAvgMs + (iv - st.authAvgMs)*AUTH_STAT_EWMA_ALPHA : iv;
    const dev = Math.abs(iv - st.authAvgMs);
    st.authJitMs = st.authJitMs + (dev - st.authJitMs)*AUTH_STAT_EWMA_ALPHA;
  }
  st.authLastAt = t;
  if(st.cbs.auth) st.cbs.auth(payload);
}

/* input(最新優先): ホストはRTDBのplayersスナップショットにDataChannelの最新inputを
   重ねて渡す。DataChannelで一度も届いていなければ元のオブジェクトを素通しする(挙動不変)。 */
function mergedPlayers(){
  const out = Object.assign({}, st.rtdbPlayers);
  st.dcInputs.forEach((input, pid)=>{
    const base = out[pid] || {};
    const rtdbSeq = (base.input && typeof base.input.seq==='number') ? base.input.seq : -1;
    // 昇格中はDataChannelのseqが常に新しい。降格後にrtdbが追い越したらrtdb側が勝つ
    if(typeof input.seq!=='number' || input.seq >= rtdbSeq){
      out[pid] = Object.assign({}, base, { input });
    }
  });
  return out;
}

/* DataChannel受信をチャンネルごとに合流点へ配線する(既定インスタンスに一度だけ) */
dflt.onMessage('input', (key, d, fromPid)=>{
  /* 【unordered DCは古い便が後から届く】入力は「最新だけが正」なので、
     seqが進んだときだけ採用する。古い入力を通すとホストの netAckInputSeq が後退し、
     ゲストの突き合わせが履歴を見つけられず「現在位置と遅れたホスト位置の直接比較」へ
     落ちて、移動中ずっと引き戻される(ハーネスで実測: 補正1136px/試合→ガードで解消)。 */
  const prev = st.dcInputs.get(fromPid);
  if(prev && typeof prev.seq==='number' && typeof d.seq==='number' && d.seq <= prev.seq) return;
  st.dcInputs.set(fromPid, d);
  if(st.cbs.input) st.cbs.input(mergedPlayers());
});
dflt.onMessage('auth',  (key, d)=> deliverAuth(d, 'rtc'));
dflt.onMessage('fire',  (key, d)=> deliverReliable('fire',  key, d, 'rtc'));
dflt.onMessage('hit',   (key, d)=> deliverReliable('hit',   key, d, 'rtc'));
dflt.onMessage('event', (key, d)=> deliverReliable('event', key, d, 'rtc'));
dflt.onMessage('shot',  (key, d)=> deliverReliable('shot',  key, d, 'rtc'));
dflt.onMessage('loot',  (key, d)=> deliverReliable('loot',  key, d, 'rtc'));
dflt.onPeerState = (pid, state)=>{
  // 降格した相手のDataChannel由来inputは捨てる(以後はrtdbの値が正)
  if(state==='down' || state==='waiting-retry') st.dcInputs.delete(pid);
};
/* network.jsの補間遅延の適応が読む実測値 */
dflt.authStreamStats = function(){ return { avgMs: st.authAvgMs, jitterMs: st.authJitMs }; };

/* ---- 送信ラッパ ---- */
function transportReady(roomId){
  return dflt.attached && dflt.roomId===roomId;
}
/* 信頼配送の送信: DataChannelへ送れたときだけ、RTDB側のペイロードにも同じキー(_k)を
   刻んで両経路の複製を受信側で畳めるようにする。RTDBへは常に送る(信頼配送の土台)。
   rtcが未確立ならペイロードもキーも従来と完全に同一(挙動不変)。 */
function sendReliableBoth(ch, rawName, roomId, evt){
  if(transportReady(roomId) && evt && typeof evt==='object'){
    const key = dflt.makeKey();
    evt._k = key;
    if(!dflt.send(ch, evt, key)) delete evt._k;
  }
  return RAW[rawName](roomId, evt);
}

const WRAPPERS = {
  /* input: rtc接続中はDataChannelのみ(最新優先なのでRTDBへの二重書きは不要=quota節約)。
     未接続・降格中は従来どおりRTDB。ホスト自身の入力送信は相手がいないので常にRTDB */
  /* input: DataChannelは「追加の高速便」で、RTDBへも従来の間隔で書き続ける(床)。
     rtc中にDCだけへ絞る設計にしていたら、CPU逼迫や電波劣化でunreliable DCが
     連続で落ちたときに入力がホストへ一切届かず、ホスト側の自分が棒立ちになって
     ゲストが延々引き戻された(ハーネスで実測: 補正1127px/試合)。
     RTDB側は自前で間引く(現行の22Hz=quota現状維持。DC便は40Hzで上乗せ)。 */
  __aramonSendInput(roomId, input){
    if(transportReady(roomId) && dflt.isRtcActiveToHost()){
      dflt.send('input', input);
      const now = Date.now();
      if(now - st.lastInputRtdbAt < INPUT_RTDB_FLOOR_MS) return Promise.resolve();
      st.lastInputRtdbAt = now;
    }
    return RAW.__aramonSendInput(roomId, input);
  },
  /* auth: rtc接続中の相手へはDataChannelで毎回。RTDBへは
     ①rtc未確立のゲストがいる ②フル配信 ③キープアライブ間隔経過 のいずれかで書く */
  __aramonPublishAuthState(roomId, authState){
    if(transportReady(roomId) && dflt.isHost){
      const dcSent = dflt.send('auth', authState);
      const now = Date.now();
      const needRtdb = !dcSent || dflt.hasNonRtcPeer() || (authState && authState.full)
        || (now - st.lastAuthRtdbAt >= AUTH_RTDB_KEEPALIVE_MS);
      if(!needRtdb) return Promise.resolve();
      st.lastAuthRtdbAt = now;
      /* DataChannelで既に届けられた便のRTDB書き込みは「黙って死んだDC」への保険なので、
         書き込みackで呼び出し側(authPublishInFlight)を待たせない。待たせると
         フル配信のたびに30Hzの配信がack往復ぶん(遅い回線で150ms)止まり、
         ゲストの補間が飢えて相手が飛ぶ(ハーネスで実測: 被弾表示461ms→修正後に解消)。 */
      if(dcSent){
        RAW.__aramonPublishAuthState(roomId, authState).catch(()=>{});
        return Promise.resolve();
      }
    }
    return RAW.__aramonPublishAuthState(roomId, authState);
  },
  __aramonSendFireEvent(roomId, evt){ return sendReliableBoth('fire',  '__aramonSendFireEvent', roomId, evt); },
  __aramonReportHit(roomId, hit){     return sendReliableBoth('hit',   '__aramonReportHit',     roomId, hit); },
  __aramonPushEvent(roomId, evt){     return sendReliableBoth('event', '__aramonPushEvent',     roomId, evt); },
  __aramonPushShotEvent(roomId, evt){ return sendReliableBoth('shot',  '__aramonPushShotEvent', roomId, evt); },
  __aramonPushLootEvent(roomId, evt){ return sendReliableBoth('loot',  '__aramonPushLootEvent', roomId, evt); },

  /* ---- 受信ラッパ: RTDBの便も合流点へ通す ---- */
  __aramonWatchInputs(roomId, cb){
    st.cbs.input = cb;
    return RAW.__aramonWatchInputs(roomId, (players)=>{
      st.rtdbPlayers = players || {};
      if(st.dcInputs.size===0){ cb(players); return; } // rtc未使用なら素通し
      cb(mergedPlayers());
    });
  },
  __aramonWatchAuthState(roomId, cb){
    st.cbs.auth = cb;
    return RAW.__aramonWatchAuthState(roomId, (payload)=> deliverAuth(payload, 'rtdb'));
  },
  __aramonWatchFireEvents(roomId, cb){
    st.cbs.fire = cb;
    return RAW.__aramonWatchFireEvents(roomId, (key, evt)=> deliverReliable('fire', (evt && evt._k) || key, evt, 'rtdb'));
  },
  __aramonWatchHitsAsHost(roomId, cb){
    st.cbs.hit = cb;
    return RAW.__aramonWatchHitsAsHost(roomId, (key, evt)=> deliverReliable('hit', (evt && evt._k) || key, evt, 'rtdb'));
  },
  __aramonWatchEvents(roomId, cb){
    st.cbs.event = cb;
    // eventsだけシグネチャが(evt, key)の順
    return RAW.__aramonWatchEvents(roomId, (evt, key)=> deliverReliable('event', (evt && evt._k) || key, evt, 'rtdb'));
  },
  __aramonWatchShotEvents(roomId, cb){
    st.cbs.shot = cb;
    return RAW.__aramonWatchShotEvents(roomId, (key, evt)=> deliverReliable('shot', (evt && evt._k) || key, evt, 'rtdb'));
  },
  __aramonWatchLootEvents(roomId, cb){
    st.cbs.loot = cb;
    return RAW.__aramonWatchLootEvents(roomId, (key, evt)=> deliverReliable('loot', (evt && evt._k) || key, evt, 'rtdb'));
  },

  /* 部屋を出る/解散するときはrtc接続も畳む(全exit経路がこの2つを通る) */
  __aramonLeaveRoom(roomId){
    try{ dflt.detach(); }catch(err){}
    return RAW.__aramonLeaveRoom(roomId);
  },
  __aramonDisbandRoom(roomId, lobbyEntryId){
    try{ dflt.detach(); }catch(err){}
    return RAW.__aramonDisbandRoom(roomId, lobbyEntryId);
  },
};

/* firebase.js(ESモジュール=このファイルより後に実行)が生やした関数を包む。
   多重ラップはしない。存在しない関数(古いfirebase.js等)は触らない */
function installWrappers(){
  if(typeof window==='undefined') return;
  for(const name in WRAPPERS){
    const orig = window[name];
    if(typeof orig!=='function' || orig.__netTransportWrapped) continue;
    RAW[name] = orig;
    const w = WRAPPERS[name];
    w.__netTransportWrapped = true;
    window[name] = w;
  }
}
if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', installWrappers);
  else installWrappers();
}
// attach時にも念のため再試行する(モジュールの読み込みが遅れた場合の保険)
const attachOrig = Transport.prototype.attach;
Transport.prototype.attach = function(opts){
  if(this===dflt) installWrappers();
  return attachOrig.call(this, opts);
};

/* 接続状態とRTTの実測(管理者画面のパフォーマンス表示に後で載せる) */
if(typeof window!=='undefined'){
  window.__aramonNetStats = function(){
    return {
      attached: dflt.attached,
      roomId: dflt.roomId,
      isHost: dflt.isHost,
      rtcToHost: dflt.isRtcActiveToHost(),
      rtcAllPeers: dflt.isRtcActiveAllPeers(),
      peers: Array.from(dflt.peers.values()).map(p=>({
        pid: p.pid, state: p.state,
        rttMs: p.rttMs!=null ? Math.round(p.rttMs) : null,
        attempts: p.attempts,
      })),
      authAvgIntervalMs: Math.round(st.authAvgMs||0),
      authJitterMs: Math.round(st.authJitMs||0),
    };
  };
}

})();
