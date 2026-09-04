/* 技エフェクトを外から動かすための駆動コード(開発用)。
   **ゲーム本体には読み込まない。** index.html に <script src> で足すと sw.js の
   precache に載り、本番の全端末へ配られてしまう(設計仕様 §11 [32])。

   読み込むと window.__fx を定義する。使う側は2つ:
     ・tools/fx_shot.mjs  … このファイルを読んで page.evaluate する(ヘッドレスのコマ撮り)
     ・tools/studio_web.html … 同一オリジンで fetch して iframe に注入し、postMessage で操る
   **同じ意味の仕掛けを2つ持たないため、駆動部はこの1ファイルだけにする。**

   2つの使い方の違いは setup({ mode }) の1か所に寄せてある:
     mode:'shot'    … ゲーム自身の rAF を止める / カメラを固定 / step() で手回し(既定)
     mode:'preview' … rAF を止めない(動いて見える)/ カメラは固定しない / step() は使わない
   音は silent オプション(shot=true で消す / preview=false で本物を鳴らす)。 */
(function(){
  function seedRandom(seed){
    let s = (seed>>>0) || 1;
    Math.random = function(){ s = (s*1664525 + 1013904223) >>> 0; return s/4294967296; };
  }
  // 音は鳴らさない(ヘッドレスでは無意味なうえ、AudioContextの生成で時間を食う)
  function muteAudio(){
    try{ window.playSe = function(){}; window.playBgm = function(){}; }catch(e){}
    for(const k of ['playSe','playBgm','stopBgm','playMoveSe']){
      try{ if(typeof window[k] === 'function') window[k] = function(){}; }catch(e){}
    }
  }
  const api = {};
  api.ready = function(){
    return typeof startGame === 'function' && typeof update === 'function'
        && typeof render === 'function' && typeof fireMove === 'function';
  };
  /* 試合を1つ立ち上げ、撮影に邪魔な要素(他のbot・安置ダメージ・HUD)を外す。
     プレイヤーと的1体だけの、毎回同じ舞台を作る。                        */
  api.setup = function(o){
    /* 【ここが shot と preview の唯一の分かれ道】
       他の場所で mode を見ない。増やすなら必ずここへ足す。 */
    const preview = (o.mode === 'preview');
    api._mode = preview ? 'preview' : 'shot';
    // 音を消すか。省略時は「コマ撮りなら消す・プレビューなら鳴らす」
    const silent = (o.silent == null) ? !preview : !!o.silent;
    /* 【最重要・コマ撮りのとき】ゲーム自身のフレームループを止める。
       network.js の loop() が requestAnimationFrame で回り続けており、
       こちらが step()/draw() で作った状態を**次のフレームが即座に上書きする**。
       これを止めないと、指定した時刻のコマも、置き直したカメラも撮れない
       (真横からの撮影が効かず、正面のままだったのはこれが原因)。
       rAF を無効化すると loop() が自分を再登録できなくなり、次のフレームで止まる。
       **プレビューでは止めない。** 止めると絵が動かず、技が見えない。 */
    if(!preview) window.requestAnimationFrame = function(){ return 0; };
    seedRandom(o.seed);
    if(silent) muteAudio();
    /* 未登録のキー(スタジオで作りかけのモンスター)は先に defineElement を送ってもらう。
       createMonster が ELEMENTS[key].speed を読むので、無いとここで落ちる。 */
    if(o.element && typeof ELEMENTS !== 'undefined' && !ELEMENTS[o.element])
      return { ok:false, reason:'「' + o.element + '」がゲームの表にありません(先に defineElement を送ってください)' };
    game.selectedElement = o.element || 'fire';
    game.selectedMastermonKey = null;
    /* スキンを装備させる。getEquippedSkin() が読む所に直接書く
       (ロビーのUIを経由しないので、保存の形だけを合わせる)。
       **ここは localStorage へ書く。** プレビューでは index.html の ?harness=1 が
       localStorage をメモリへ差し替えているので、本物の保存データは汚れない。 */
    if(o.skin){
      try{ if(typeof setEquippedSkin === 'function') setEquippedSkin(o.element, o.skin); }catch(e){}
    }
    game.selectedMap = (o.mapKey||'wild').replace(/_real$/,'');
    game.realMapMode = /_real$/.test(o.mapKey||'');
    startGame({});
    /* 【プレビューだけ】安置を止める入口は game.trainingRange 1つ(combat.js:2551)。
       これを立てないと updateZone が回り、phaseIndex 0 の holdTime(61秒)を過ぎた所で
       安置が縮み始め、外に置いた自機が焼かれて死ぬ ―― 技を見ている最中に画面が止まる。
       アイテムの湧き(advanceZonePhase の spawnLoot)も同時に止まるので絵が汚れない。
       **startGame が false へ戻すので、必ずその後で立てる。**
       コマ撮り(shot)は数秒しか回さないので今までどおり触らない。

       **この1つで一緒に入る副作用**(技の絵と数字には関わらないが、遊びの手応えは本番と違う):
         ・自機のガッツが毎秒 +6(combat.js の RANGE_GUTS_REGEN)
         ・自機のHPが毎秒 5% 回復する(combat.js の updateTrainingRange)
         ・難易度の手加減が外れる(data.js の matchDifficultyApplies が false を返す)
       つまりプレビューで確かめられるのは**技そのもの**であって、
       「ガッツが足りなくて撃てない」「削られて死ぬ」といった試合の手応えではない。 */
    if(preview) game.trainingRange = true;
    // 召喚演出(5秒のカウントダウン)は撮影の邪魔なので即座に終わらせる。
    // 消さないとプレイヤーがまだ降下中で、技が円盤石の上から出る。
    if(typeof endSummonIntro === 'function') endSummonIntro();
    if(typeof introState !== 'undefined' && introState){ introState.active = false; introState.timer = 0; }
    // botを全部消し、決まった位置に的を1体だけ置く
    const me = player;
    entities.length = 0;
    entities.push(me);
    /* 撃つ位置は**障害物から離れた所**にする。
       【なぜ必要か】ワールド中央に固定していたため、そこに岩があるマップでは
       横へずらして撃つ弾(轟金剛の3連射・ギガデストロイヤーの核弾頭)が
       **発射の1tick目で岩に当たって消えていた**(実測: 3発中1発しか写らず、
       burstTintsの赤が一度も出ない)。技の不具合に見えるが、原因は撮影位置。
       中央から渦巻き状に探して、岩・山から十分離れた地点を選ぶ。 */
    (function pickClearSpot(){
      const clear = (x, y)=>{
        if(x<600 || y<600 || x>WORLD.w-600 || y>WORLD.h-600) return false;
        for(const r of (typeof rocks!=='undefined' ? rocks : []))
          if(Math.hypot(x-r.x, y-r.y) < r.radius + 420) return false;
        for(const v of (typeof volcanoObstacles!=='undefined' ? volcanoObstacles : []))
          if(Math.hypot(x-v.x, y-v.y) < (v.radius||0) + 700) return false;
        return true;
      };
      const cx = WORLD.w*0.5, cy = WORLD.h*0.5;
      if(clear(cx, cy)){ me.x = cx; me.y = cy; return; }
      for(let ring=1; ring<=14; ring++){
        for(let k=0; k<12; k++){
          const a2 = (k/12)*Math.PI*2, d = ring*220;
          const x = cx + Math.cos(a2)*d, y = cy + Math.sin(a2)*d;
          if(clear(x, y)){ me.x = x; me.y = y; return; }
        }
      }
      me.x = cx; me.y = cy;   // 見つからなければ従来どおり中央
    })();
    me.z = (typeof groundZAt==='function') ? groundZAt(me.x, me.y) : 0;
    /* 撃つ向きも選ぶ。**上り坂へ撃つと弾が途中で地面に刺さる。**
       実測: ギガデストロイヤーの核弾頭は、前方310で地面が15上がってくるため
       射程900の1/3で着弾していた(弾道の不具合ではなく撮影地点の地形)。
       技そのものを見たいので、900先まででいちばん登らない向きを選ぶ。
       **技の性能は何も変えない。** 立ち位置と向きだけの話。 */
    (function pickFacing(){
      const gz = (typeof groundZAt==='function') ? groundZAt : ()=>0;
      const z0 = gz(me.x, me.y);
      let best = 0, bestRise = Infinity;
      for(let k=0;k<12;k++){
        const a2 = (k/12)*Math.PI*2;
        let rise = 0;
        for(let d=150; d<=900; d+=150){
          rise = Math.max(rise, gz(me.x+Math.cos(a2)*d, me.y+Math.sin(a2)*d) - z0);
        }
        if(rise < bestRise){ bestRise = rise; best = a2; }
      }
      me.facingAngle = best;
    })();
    me.hp = me.maxHp; me.guts = me.maxGuts;
    me.alive = true; me.fireCooldown = 0;
    const _td = o.targetDist||760;
    const _tx = me.x + Math.cos(me.facingAngle)*_td, _ty = me.y + Math.sin(me.facingAngle)*_td;
    const tgt = createMonster('rock', false, 'まと', { spawnPoint:{ x:_tx, y:_ty } });
    tgt.x = _tx; tgt.y = _ty;
    tgt.z = (typeof groundZAt==='function') ? groundZAt(tgt.x, tgt.y) : 0;
    tgt.hp = 99999; tgt.maxHp = 99999; tgt.alive = true;
    tgt.fireCooldown = 9999;          // 的は撃ち返さない
    entities.push(tgt);
    // 安置を十分大きく取り、縮小ダメージが画に混ざらないようにする
    if(typeof zoneState !== 'undefined' && zoneState){
      zoneState.center = { x: me.x, y: me.y };
      zoneState.radius = 99999; zoneState.toRadius = 99999;
      zoneState.shrinking = false; zoneState.hasNext = false;
    }
    lootItems.length = 0; projectiles.length = 0; areaEffects.length = 0; particles.length = 0;
    matchTime = 0;
    /* カメラの向き。
       front = 弾を追う向き(実際の遊びの見え方)。
       side  = 弾道と直角(**軌跡・尾・弾速はこれでしか判定できない**。
               正面から撮ると帯が奥行きに潰れて、太さの違いしか見えない)。
       撃つ向き(facingAngle)は常に +x のまま。カメラだけを回す。            */
    camState.yaw = (o.view === 'side') ? Math.PI/2 : 0;
    camState.pitch = (o.pitch==null) ? 0.16 : o.pitch;
    if(o.dist != null) camState.distBehind = o.dist;
    if(typeof updateCamera === 'function') updateCamera();
    camPos.x = me.x - Math.cos(camState.yaw)*camState.distBehind;
    camPos.y = me.y - Math.sin(camState.yaw)*camState.distBehind;
    camPos.z = me.z + camState.height;
    // 真横から撮るときは、弾道の中ほどが画面の中央に来るよう後ろへ下げる
    if(o.view === 'side'){
      const back = (o.targetDist||760)*0.9;
      camPos.x = me.x + (o.targetDist||760)*0.45;
      camPos.y = me.y - back;
      camPos.z = me.z + camState.height + 60;
    }
    /* **コマ撮りではカメラを常に固定する。** 撃った瞬間にゲームがカメラをスナップさせるので、
       固定しないと技によって1コマ目が「空だけ」になり、立ち上がりを比べられない
       (warm_t3で発生)。技の見え方以外の差を画に出さないのがこのハーネスの役目。
       **プレビューでは固定しない** ―― 遊んでいるときと同じカメラの動きで見せたいので。 */
    api._pinCam = (preview || o.noPin) ? null
      : { x:camPos.x, y:camPos.y, z:camPos.z, yaw:camState.yaw, pitch:camState.pitch };
    api._me = me; api._tgt = tgt;
    return { ok:true, x:me.x, y:me.y, map:game.activeMapKey, el:me.element,
             mode:api._mode, silent:silent, zone:api.zone(),
             view:o.view||'front', yaw:camState.yaw, skin:o.skin||null,
             move:(function(){ try{ const mv=activeMove(player); return mv&&mv.name; }catch(e){ return null; } })(),
             cam:{ x:Math.round(camPos.x), y:Math.round(camPos.y), z:Math.round(camPos.z) } };
  };
  /* 安置とアイテムの様子。**「61秒たっても縮んでいない」ことを外から検査する**ための返事。
     zonePhase が 0 のまま・shrinking が false・loot が 0 なら、安置は止まっている。 */
  api.zone = function(){
    const z = (typeof zoneState !== 'undefined' && zoneState) ? zoneState : {};
    return { zonePhase: z.phaseIndex == null ? null : z.phaseIndex,
             zoneTimer: z.timer == null ? null : +z.timer.toFixed(1),
             shrinking: !!z.shrinking, training: !!game.trainingRange,
             loot: (typeof lootItems !== 'undefined') ? lootItems.length : null,
             alive: !!(api._me && api._me.alive), hp: api._me ? Math.round(api._me.hp) : null,
             matchTime: (typeof matchTime === 'number') ? +matchTime.toFixed(1) : null };
  };
  /* 指定tierの技を1発撃つ。撃つのは「プレイヤー本人が撃つ」経路そのもの。 */
  api.fire = function(tier, seVariant){
    const me = api._me;
    me.moveTierSelected = tier;
    /* 当たり(音・色・追加効果)が確率で変わる技を撮るための指定。
       番号を渡すと fireMove がその当たりで撃つ(--variant)。 */
    me.seVariantOverride = (seVariant!=null) ? seVariant : null;
    const mv = activeMove(me);
    me.guts = me.maxGuts;
    const aim = mv.melee ? api._tgt
              : { x: me.x + Math.cos(me.facingAngle)*2000, y: me.y + Math.sin(me.facingAngle)*2000 };
    const n0 = projectiles.length, nAe0 = areaEffects.length;
    fireMove(me, mv.melee ? api._tgt : aim, mv);
    /* コマ撮りは1発だけを見たいので連射させない。
       プレビューは3秒ごとに撃ち直すので、次が撃てるように0へ戻す。 */
    me.fireCooldown = (api._mode === 'preview') ? 0 : 9999;
    me.seVariantOverride = null;
    /* 実際に出た技の名前は fireMove の中で skinTier3Move() を通ったあとの値。
       activeMove() の戻りは素の技なので、**SSR専用tier3を撮っても素の名前が記録される**。
       出た弾/範囲技から拾い直す(スキンが効いているかの確認になる)。 */
    const rv = (typeof skinTier3Move==='function') ? (skinTier3Move(mv, me) || mv) : mv;
    const shown = (projectiles[projectiles.length-1] || areaEffects[areaEffects.length-1] || {});
    return { name: mv.name, tier: mv.tier, aoe: mv.aoeShape||null,
             /* 撃った直後の本数。**表(data.js)の burst / warheads.count と突き合わせる**ための値。
                コマの counts.proj は「その時刻に生きている数」なので、初めから出ていないのか
                途中で消えたのかを、これが無いと区別できない。
                プレビューでは撃つ前の弾が残っているので、**増えた数**も併せて返す。 */
             spawned: projectiles.length, spawnedAe: areaEffects.length,
             added: projectiles.length - n0, addedAe: areaEffects.length - nAe0,
             wantBurst: (rv.burst) || 1, wantWarheads: (rv.warheads && rv.warheads.count) || 0,
             style: shown.projStyle || shown.style || mv.aoeStyle || mv.projStyle || null,
             skinName: (typeof skinTier3Move==='function' ? (skinTier3Move(mv, me)||{}).name : null) };
  };
  /* 固定dtで時間を進める(コマ撮り専用。プレビューでは呼ばない)。
     撃ち返し・再発射は止めてあるので毎回同じ絵になる。 */
  /* 【最重要】**1コマ進めるごとに render() も呼ぶ。**
     fly / sustain の粒は render.js の fxGlFeed() の中でしか湧かない。
     update() だけを回して撮る瞬間に1回だけ描いていたので、1.15秒の技に対して
     sustain が**5回しか呼ばれていなかった**(実機は60fpsで約70回)。
     結果、羅生門の吸い込み・モッチ砲の花びら・サイコキネシスの芯は
     **実装されていても画に出ず、批評家が採点できなかった**。
     fx層の時計も実時間で進むので、描かないとエフェクトの時間も進まない。 */
  /* draw=true のときだけ1コマごとに描く。
     【なぜ 1/30 か】ソフトウェアGPUでは1描画が重く、1/60で回すと1技90秒かかって
     撮影が落ちた。粒の数は fxSpawnN(dt,…) が dt に比例し、dt の頭打ちが0.05なので、
     1/30(=0.033)なら**60fpsと同じ密度**になる。飛翔の位置も同じ。
     【なぜ発射前は描かないか】技が出ていない間は粒が湧かないので描く意味が無い。 */
  api.step = function(seconds, dt, draw){
    const d = dt || (draw ? 1/30 : 1/60);
    let n = Math.max(0, Math.round(seconds/d));
    const sc = api._pinCam;
    for(let i=0;i<n;i++){
      api._me.guts = api._me.maxGuts;
      update(d);
      if(draw){
        if(sc){ camPos.x=sc.x; camPos.y=sc.y; camPos.z=sc.z; camState.yaw=sc.yaw; camState.pitch=sc.pitch; }
        render();
      }
    }
    return matchTime;
  };
  api.draw = function(){
    // update() の updateCamera() と発射時のカメラスナップがカメラを動かすので、
    // 描く直前に必ず置き直す(置かないと技ごとに画角が変わって比較できない)
    const sc = api._pinCam;
    if(sc){ camPos.x=sc.x; camPos.y=sc.y; camPos.z=sc.z; camState.yaw=sc.yaw; camState.pitch=sc.pitch; }
    render();
    const pp = (typeof project==='function') ? project(player.x, player.y, player.z||0) : null;
    /* part は**2Dの粒**(combat.js の particles)の数。WebGL層の粒は別勘定なので、
       ここだけを見て「粒がゼロ」と判定すると必ず読み違える(批評家4名が実際に誤読した)。
       WebGL層の生きている帯・輪の数を gl として併記する。 */
    return { proj: projectiles.length, ae: areaEffects.length, part: particles.length,
             gl: (window.__aramonFxGl && window.__aramonFxGl.isActive()) ? window.__aramonFxGl.stats() : null,
             yaw:+camState.yaw.toFixed(3), pinned: !!sc,
             playerPx: pp ? [Math.round(pp.x), Math.round(pp.y)] : null,
             cam:[Math.round(camPos.x), Math.round(camPos.y)], vw:viewW, vh:viewH }; };
  /* 1フレームの描画にかかる時間を測る。**エフェクトが一番濃い瞬間で測る**
     (何も出ていない時間を混ぜると平均が下がって実態を隠す)。         */
  api.bench = function(n, fxOff){
    const gl0 = window.__aramonFxGl;
    if(gl0 && fxOff) gl0.setActive(false);
    const N = n || 40;
    // 初回のシェーダ確定とJITの立ち上がりぶんは測らない。
    // ここを1回だけにすると、先に測ったほうが不利になって「層を足したら速くなった」
    // という嘘の数字が出る(実際に出た)。
    for(let i=0;i<12;i++) render();
    const t0 = performance.now();
    for(let i=0;i<N;i++) render();
    const ms = (performance.now()-t0)/N;
    const gl = window.__aramonFxGl;
    if(gl && fxOff) gl.setActive(true);
    return { ms:+ms.toFixed(2), fps:+(1000/ms).toFixed(1),
             fx: gl && gl.isActive() ? gl.stats() : null,
             proj: projectiles.length, ae: areaEffects.length, part: particles.length,
             gl: (window.__aramonFxGl && window.__aramonFxGl.isActive()) ? window.__aramonFxGl.stats() : null };
  };
  /* 画面を「試合中」だけにする。タイトル画面は起動演出のあいだ全面を覆っており、
     タップで消える作りなので startGame() を呼んでも自動では消えない。   */
  /* --nofx: WebGL層を止めて撮る。**改修前の絵をまったく同じ条件で撮る**ためのもの。
     昔のコミットへ戻して撮り直すと、シード・カメラ・地形が微妙に変わって
     比較にならない(実際に一度そうなった)。                             */
  api.setFx = function(on){
    const gl = window.__aramonFxGl;
    if(gl) gl.setActive(!!on);
    window.__fxForceOff = !on;
  };
  api.hideHud = function(){
    for(const id of ['titleScreen','startScreen','resultScreen','lobbyScreen','roomListScreen',
                     'howToPlayScreen','mastermonScreen','monsterListScreen','myStatsScreen',
                     'rankingScreen','adminPassScreen','adminScreen']){
      const el = document.getElementById(id); if(el) el.style.display = 'none';
    }
    const hud = document.getElementById('hud'); if(hud) hud.style.opacity = '0';
    for(const id of ['joystick','fireBtn','dashBtn','crosshair','minimapWrap','tipBox','pingBtn',
                     'rangeBar','rangeHint','squadPanel','killFeed','statusIcons']){
      const el = document.getElementById(id); if(el) el.style.display = 'none';
    }
  };

  /* ============================================================ 編集した技を当てる
     スタジオが作った3技をそのまま SIGNATURE_MOVES[属性] へ置く。
     activeMove() は毎回この表を引き直すので、次に撃つ弾から新しい数字になる。 */
  api.override = function(element, moves, auras){
    if(!element || !Array.isArray(moves) || !moves.length) return { ok:false, reason:'技がありません' };
    if(typeof SIGNATURE_MOVES === 'undefined') return { ok:false, reason:'SIGNATURE_MOVES がありません' };
    SIGNATURE_MOVES[element] = moves;
    /* 技のオーラは**技オブジェクトの mv.aura** が正(実行時は getMoveAura が move.aura を見る)。
       data.js:929 の焼き込みは**読み込みのときの1回きり**なので、あとから MOVE_AURA へ
       書いても誰も読み直さない(そこへ書いていた前の版は死にコードで、差し替えた技の
       オーラが毎回消えていた)。

       **どの色になるかを決めるのは呼ぶ側**(auras = 技名 → オーラ)。スタジオは
         ・登録済みを開いて直すとき = data.js の MOVE_AURA に**今入っている**値
         ・新しく登録するとき       = これから MOVE_AURA へ書く値(spec.moveAura || spec.aura)
       を渡すので、**新規登録後に生成される MOVE_AURA と同じ値**でプレビューできる
       (技名を変えても、その名前に付くはずの色で見える)。
       渡されなかった技は data.js:929 とまったく同じ扱い —— MOVE_AURA にその技名が
       あればその色、無ければ**付けない**。MONSTER_AURA へ落としていた前の版は
       data.js と食い違っていて、名前を変えた技が本番と違う色で見えていた。 */
    try{
      const ma = (typeof MOVE_AURA !== 'undefined') ? MOVE_AURA : {};
      for(const mv of moves){
        if(!mv) continue;
        const a = (auras && auras[mv.name] != null) ? auras[mv.name] : ma[mv.name];
        if(a) mv.aura = a;
      }
    }catch(e){}
    return { ok:true, count: moves.length, names: moves.map(m=> m && m.name),
             auras: moves.map(m=> m && m.aura) };
  };

  /* ============================================================ 未登録のモンスターを名乗らせる
     スタジオで作りかけのキー(まだ data.js に無い)でプレビューを開くための入口。
     **createMonster は ELEMENTS[key] を読む**ので、これを先に通さないと
     "Cannot read properties of undefined (reading 'speed')" で落ちる。
     既に本物の表にあるキーは**触らない**(本物の性能でプレビューしたいので)。
     ただし force を渡されたときだけは上書きする —— スタジオの「登録済みを開いて直す」では
     ELEMENTS[key] が既にあり、上書きしないと**仕様パネルで直した速度・HP・当たりの大きさ・
     クールタイムの倍率がプレビューに出ない**(直したのに何も変わらない、と見える)。
     新規登録と fx_shot(コマ撮り)は force を渡さないので従来どおり。 */
  api.defineElement = function(key, def, aura, aptitude, force){
    if(!key) return { ok:false, reason:'キーがありません' };
    if(typeof ELEMENTS === 'undefined') return { ok:false, reason:'ELEMENTS がありません' };
    const existed = !!ELEMENTS[key];
    const d = def || {};
    /* 書き込む値の作り方は**ここ1か所**(新しく作るときも force で上書きするときも同じ)。 */
    const want = {
      label: d.label || key, color: d.color || '#ffffff', dark: d.dark || '#666666',
      speed: +d.speed || 190, hp: +d.hp || 110, trait: d.trait || '',
    };
    if(d.accent) want.accent = d.accent;
    /* 見た目だけの倍率(render.js の entityDrawScale が ELEMENTS[key].drawScale として読む。
       当たり判定radiusには効かない)。**数値のときだけ**入れる ―― 空欄・非数値のままキーを
       作ると entityDrawScale の `typeof===\'number\'` 判定に落ちて自動計算に化けるだけで実害は
       無いが、ここで弾いておけば「数値でないものは無視」の意図が動きからも読み取れる。 */
    if(d.drawScale != null && d.drawScale !== '' && isFinite(+d.drawScale)) want.drawScale = +d.drawScale;
    // 常時の倍率(特性の効果)も、書いてあるものだけ入れる
    for(const k of ['speedMod','cooldownMod','dmgDealtMod','dmgTakenMod','gutsRegenMod','hitboxMult'])
      if(d[k] != null) want[k] = +d[k];
    const overrode = [];
    if(!existed) ELEMENTS[key] = want;
    else if(force){
      /* **送られてきた項目だけ**を上書きする。空の欄まで既定値(速度190・HP110)で
         塗ると、直していない項目がプレビューだけ別物になる。 */
      for(const k of Object.keys(want)){
        if(d[k] == null || d[k] === '') continue;
        if(ELEMENTS[key][k] === want[k]) continue;
        ELEMENTS[key][k] = want[k];
        overrode.push(k);
      }
    }
    if(typeof MONSTER_AURA !== 'undefined' && aura && MONSTER_AURA[key] == null) MONSTER_AURA[key] = aura;
    /* 適正(APTITUDE)も要る。試合の入口が mastermonInitialStats(キー) を呼び、
       その中で APTITUDE[キー].life を読むので、無いと「life が読めない」で落ちる。
       **順番も名前もゲームの表(data.js の APTITUDE)に合わせる。** */
    if(typeof APTITUDE !== 'undefined' && !APTITUDE[key]){
      const a = aptitude || {};
      APTITUDE[key] = {};
      for(const s of ['life','power','wisdom','accuracy','evasion','vitality'])
        APTITUDE[key][s] = a[s] || 'C';
    }
    /* 技が1つも無いと render.js:7772 の SIGNATURE_MOVES[element] が undefined になって
       毎フレーム落ちる。**本物の技はこのすぐ後の override が入れる**ので、
       ここでは「形だけそろえる」ために既存の1体をそのまま借りる。 */
    if(typeof SIGNATURE_MOVES !== 'undefined' && !SIGNATURE_MOVES[key]){
      const donor = SIGNATURE_MOVES[Object.keys(SIGNATURE_MOVES)[0]];
      SIGNATURE_MOVES[key] = JSON.parse(JSON.stringify(donor));
    }
    /* overrode = 上書きした項目名。スタジオはこれを見て「性能は編集中の値で見ています」と
       画面に出す —— 何の数字で見ているのか分からないまま比べるのがいちばん危ない。 */
    return { ok:true, key, existed, forced: !!(existed && force), overrode,
             label: ELEMENTS[key].label, aura: (typeof MONSTER_AURA!=='undefined') ? MONSTER_AURA[key] : null };
  };

  /* ============================================================ 語彙を集める
     **必ずこの中(=ゲームと同じ実行環境)で集める。**
     REAL_STYLE_FX / MOVE_SE_BY_STYLE / SE_TEST_LABELS はすべて const 宣言なので
     window には出ておらず、iframe.contentWindow.REAL_STYLE_FX では取れない。 */
  api.vocab = async function(){
    const out = { projStyles:[], aoeStyles:[], seStyles:[], seLabels:null, cacheName:null };
    const uniq = a => Array.from(new Set(a.filter(v=> typeof v === 'string' && v))).sort();
    try{ out.projStyles = uniq(Object.keys(REAL_STYLE_FX)); }catch(e){}
    // 範囲技の見た目は表が無いので、data.js の全技から実際に使われている値を集める
    const aoe = [], se = [];
    try{
      for(const k of Object.keys(SIGNATURE_MOVES)) for(const mv of SIGNATURE_MOVES[k]){
        if(mv && mv.aoeStyle) aoe.push(mv.aoeStyle);
        if(mv && mv.seStyle)  se.push(mv.seStyle);
        if(mv && mv.projStyle) out.projStyles.push(mv.projStyle);
      }
    }catch(e){}
    out.projStyles = uniq(out.projStyles);
    out.aoeStyles = uniq(aoe);
    try{ se.push(...Object.values(MOVE_SE_BY_STYLE)); }catch(e){}
    try{ if(typeof SE_TEST_LABELS !== 'undefined') out.seLabels = Object.assign({}, SE_TEST_LABELS); }catch(e){}
    /* SEは**鳴らせる音すべて**から選ばせる。技の表に今使われている値だけを集めると18件しか
       出ず、「ジャキーン」も「ズバシュ」も選べなかった。SE_TEST_LABELS(管理者画面のSE試聴の表)が
       ゲームの持っている音の正なので、そちらを土台にして、表に無い値だけを足す。 */
    if(out.seLabels) se.push(...Object.keys(out.seLabels));
    out.seStyles = uniq(se);
    /* いま動かしている版。タイトルの版表示(#versionTag)は sw.js を読んで入るので、
       まだ入っていなければ自分で読む(どちらも同じ CACHE_NAME を見ている)。 */
    try{
      const tag = document.getElementById('versionTag');
      if(tag && tag.textContent) out.cacheName = tag.textContent;
      else {
        const t = await fetch('sw.js', { cache:'no-store' }).then(r=> r.text());
        const m = t.match(/CACHE_NAME\s*=\s*'aramon-cache-(v\d+)'/);
        if(m) out.cacheName = m[1];
      }
    }catch(e){}
    return out;
  };

  /* 音を出せる状態にする。**iOS は「タップの同期処理の中」でしか AudioContext を
     起こせない。** スタジオは「撃ってみる」を押した瞬間にこれを送ってくる。 */
  api.audio = function(){
    try{ if(typeof audioInit === 'function') audioInit(); }catch(e){}
    try{ if(typeof actx !== 'undefined' && actx && actx.state === 'suspended') actx.resume(); }catch(e){}
    let state = null;
    try{ state = (typeof actx !== 'undefined' && actx) ? actx.state : null; }catch(e){}
    return { ok:true, state };
  };

  /* ============================================================ postMessage の受け口
     スタジオ(親ページ)から {cmd, id, …} が来る。返事は {__fx:true, id, ok, result|error}。
     **cmd を増やすときは api に関数を足してここへ1行**(処理の本体をここに書かない)。 */
  const CMDS = {
    setup:    o => api.setup(o),
    defineElement: o => api.defineElement(o.key, o.def, o.aura, o.aptitude, o.force),
    override: o => api.override(o.element, o.moves, o.auras),
    fire:     o => api.fire(o.tier, o.seVariant),
    zone:     () => api.zone(),
    vocab:    () => api.vocab(),
    audio:    () => api.audio(),
    hideHud:  () => { api.hideHud(); return { ok:true }; },
    ready:    () => ({ ok: api.ready(), harnessOk: !!window.__harnessOk, shim: !!window.__harnessShim }),
  };
  /* 受け取ってよいのは**同じオリジンの、親ページか自分自身**からのものだけ。
     ここはゲームの中身を書き換えられる口なので、素性の分からない窓からの指示は受けない
     (スタジオは同一オリジンの親、fx_shot/harness_test は自分自身から投げている)。
     file:// で開いたときは origin が 'null' になるので、そのときは相手の窓だけで見る。 */
  const NULL_ORIGIN = (location.origin === 'null' || !location.origin);
  function trusted(ev){
    if(!NULL_ORIGIN && ev.origin !== location.origin) return false;
    return ev.source === window || ev.source === window.parent;
  }
  window.addEventListener('message', async (ev)=>{
    if(!trusted(ev)) return;
    const d = ev.data;
    if(!d || typeof d !== 'object' || !d.cmd || !CMDS[d.cmd]) return;
    let msg;
    try{ msg = { __fx:true, id:d.id, ok:true, result: await CMDS[d.cmd](d) }; }
    catch(e){ msg = { __fx:true, id:d.id, ok:false, error: String(e && e.message || e).slice(0, 300) }; }
    try{ (ev.source || window.parent).postMessage(msg, NULL_ORIGIN ? '*' : location.origin); }catch(e){}
  });

  window.__fx = api;
})();
