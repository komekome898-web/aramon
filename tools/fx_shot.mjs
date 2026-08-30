/* 技エフェクトをヘッドレスChromiumで決まった条件でコマ撮りする開発用ツール。
   ゲーム本体には読み込まない(tools/以下は本番に含めない)。

   なぜ要るか:
     技エフェクトの良し悪しは数字では判定できない。「撃った瞬間・伸びきり・着弾・余韻」を
     毎回まったく同じ条件で画像に落とせて初めて、前後の比較と第三者の批評ができる。

   使い方:
     node tools/fx_shot.mjs --out shots/fx_base                 全属性×tier1-3
     node tools/fx_shot.mjs --out shots/x --moves fire:3,aqua:3 技を絞る
     node tools/fx_shot.mjs --out shots/x --map wild_real       リアルマップで撮る
     node tools/fx_shot.mjs --out shots/x --frames 0.06,0.2,0.5 撮る時刻(発射からの秒)
     node tools/fx_shot.mjs --out shots/x --contact             着弾の瞬間だけを撮る
     node tools/fx_shot.mjs --out shots/x --sheet               1技を1枚の連番シートにまとめる

   録画(トレーラーの素材づくり):
     node tools/fx_shot.mjs --video --moves zan:3 --out shots/clip
     node tools/fx_shot.mjs --video --moves zan:3 --skin zan_ssr --map wild_real --secs 2.5 --fps 30
     --secs 発射後に撮る秒数(既定2.2) / --lead 発射前(既定0.3) / --fps(既定30)
     --quality JPEGの品質(既定92) / -w -h で画の大きさ
     出力: <out>/<属性>_t<段>/f0000.jpg… と、それをまとめた <属性>_t<段>.mp4

   出力: <out>/<element>_t<tier>_<秒>.png と <out>/report.json

   決まりごと:
     ・Math.random をシード付きに差し替えるので、何度撮っても同じ絵になる
     ・update(dt) を固定dtで手回しする(実時間に依存しない)
     ・カメラは技ごとに固定。技の見え方以外の差が画に出ないようにする       */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let chromium = null;
try { ({ chromium } = await import('playwright')); }
catch {
  for(const base of ['/opt/node22/lib/node_modules/', '/usr/lib/node_modules/', '/usr/local/lib/node_modules/']){
    try { ({ chromium } = createRequire(base)('playwright')); break; } catch {}
  }
  if(!chromium){
    try { ({ chromium } = await import('playwright-core')); } catch {}
  }
}
if(!chromium){ console.error('playwrightが見つかりません(npm i -g playwright)。'); process.exit(1); }

const args = process.argv.slice(2);
const opt  = (n, d)=>{ const i = args.indexOf('--'+n); return i>=0 && args[i+1] && !args[i+1].startsWith('--') ? args[i+1] : d; };
const flag = (n)=> args.includes('--'+n);

const OUT   = path.resolve(opt('out', path.join(ROOT, 'shots', 'fx')));
const W     = parseInt(opt('w', '1280'), 10);
const H     = parseInt(opt('h', '600'), 10);
const SEED  = parseInt(opt('seed', '20260815'), 10);
const MAP   = opt('map', 'wild');
const EXEC  = opt('chromium', process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium');
const FRAMES = (opt('frames', '0.1,0.28,0.5,0.85,1.15')).split(',').map(Number).filter(n=>!isNaN(n));
/* --crop 720x420 : 画面中央のこの大きさだけを切り出す。
   技は画面の中央付近で起きるので、切り出したほうが批評家が形を判定できる
   (全景のままだと技が数十pxにしかならず、「良いか悪いか」を見られない)。 */
const CROP = (()=>{
  const v = opt('crop', '');
  if(!v) return null;
  const m = v.match(/^(\d+)[x,](\d+)$/);
  return m ? { w: parseInt(m[1],10), h: parseInt(m[2],10) } : null;
})();

/* 撮る技。element:tier の並び。省略時は全属性の全tier。 */
const MOVES = opt('moves', '');
/* --view front|side。side は弾道と直角から撮る。軌跡と弾速の判定に要る */
const VIEW = opt('view', 'front');
/* --skin <id>: SSR専用tier3(ヴァニッシュ・アムピトリテ・鱗赫など)を撮るために
   そのスキンを装備した状態にする。素の技とは見た目も性能も別物なので、
   **SSR専用は必ずスキンを着せて撮る。** */
const SKIN = opt('skin', '');
// --variant <番号>: 確率で見た目と効果が変わる技(真瞳術)の、どの当たりを撮るか
const VARIANT = opt('variant', '');
/* --shake: カメラのピン留めを外して撮る。
   通常はコマごとにカメラを固定して「技の見え方以外の差」を消しているが、
   その副作用で**技が起こした画面揺れも必ず打ち消される**(採点表8が原理的に測れない)。
   揺れを見たいときだけこれを付ける。技の比較には使わない。 */
const NOPIN = flag('shake');
/* ===== 録画モード(--video) =====
   トレーラー用に「1つの技を頭から終わりまで」通しで撮る。批評用のコマ撮り(FRAMES)は
   「決めた時刻だけ」を撮るのに対し、こちらは 1/fps ずつ均等に撮って動画にする。
   **駆動部(setup / step / draw / fire とカメラの固定)はコマ撮りと同じものを使う** ――
   同じ意味の仕掛けを2つ持たないため、別ファイルにはしない。
   合成は page.screenshot で撮る。**キャンバスが3枚重なっている**ので
   (glCanvas=リアルマップ / gameCanvas=2D / fxCanvas=技のWebGL層)、
   1枚だけ toDataURL しても他の層が写らない。 */
const VIDEO = flag('video');
const FPS   = Math.max(1, parseInt(opt('fps', '30'), 10));
const SECS  = Math.max(0.1, parseFloat(opt('secs', '2.2')));
const LEAD  = Math.max(0, parseFloat(opt('lead', '0.3')));   // 発射前に写す秒数(溜めの間)
const QUAL  = Math.max(1, Math.min(100, parseInt(opt('quality', '92'), 10)));

fs.mkdirSync(OUT, { recursive:true });

/* ---- リポジトリを配る小さなHTTPサーバ(ESモジュールは file:// から読めない) ---- */
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
               '.webp':'image/webp', '.mp3':'audio/mpeg', '.mp4':'video/mp4', '.webm':'video/webm' };
const server = http.createServer((req, res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(ROOT, rel);
  if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r=> server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: fs.existsSync(EXEC) ? EXEC : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
         '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

/* ページ側で動く駆動コード。index.html をそのまま読ませ、ゲーム本体の関数を直接呼ぶ
   (撮影用にワールドや技を作り直さない = 実際の見た目と必ず一致する)。          */
const DRIVER = `(function(){
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
    /* 【最重要】ゲーム自身のフレームループを止める。
       network.js の loop() が requestAnimationFrame で回り続けており、
       こちらが step()/draw() で作った状態を**次のフレームが即座に上書きする**。
       これを止めないと、指定した時刻のコマも、置き直したカメラも撮れない
       (真横からの撮影が効かず、正面のままだったのはこれが原因)。
       rAF を無効化すると loop() が自分を再登録できなくなり、次のフレームで止まる。 */
    window.requestAnimationFrame = function(){ return 0; };
    seedRandom(o.seed);
    muteAudio();
    game.selectedElement = o.element || 'fire';
    game.selectedMastermonKey = null;
    /* スキンを装備させる。getEquippedSkin() が読む所に直接書く
       (ロビーのUIを経由しないので、保存の形だけを合わせる)。 */
    if(o.skin){
      try{
        if(typeof setEquippedSkin === 'function') setEquippedSkin(o.element, o.skin);
        else if(typeof saveEquippedSkins === 'function'){
          const cur = (typeof loadEquippedSkins==='function') ? loadEquippedSkins() : {};
          cur[o.element] = o.skin; saveEquippedSkins(cur);
        }
      }catch(e){}
    }
    game.selectedMap = (o.mapKey||'wild').replace(/_real$/,'');
    game.realMapMode = /_real$/.test(o.mapKey||'');
    startGame({});
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
    /* **カメラは常に固定する。** 撃った瞬間にゲームがカメラをスナップさせるので、
       固定しないと技によって1コマ目が「空だけ」になり、立ち上がりを比べられない
       (warm_t3で発生)。技の見え方以外の差を画に出さないのがこのハーネスの役目。 */
    api._pinCam = o.noPin ? null
      : { x:camPos.x, y:camPos.y, z:camPos.z, yaw:camState.yaw, pitch:camState.pitch };
    api._me = me; api._tgt = tgt;
    return { ok:true, x:me.x, y:me.y, map:game.activeMapKey, el:me.element,
             view:o.view||'front', yaw:camState.yaw, skin:o.skin||null,
             move:(function(){ try{ const mv=activeMove(player); return mv&&mv.name; }catch(e){ return null; } })(),
             cam:{ x:Math.round(camPos.x), y:Math.round(camPos.y), z:Math.round(camPos.z) } };
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
    fireMove(me, mv.melee ? api._tgt : aim, mv);
    me.fireCooldown = 9999;   // 連射させない(1発だけを見る)
    me.seVariantOverride = null;
    /* 実際に出た技の名前は fireMove の中で skinTier3Move() を通ったあとの値。
       activeMove() の戻りは素の技なので、**SSR専用tier3を撮っても素の名前が記録される**。
       出た弾/範囲技から拾い直す(スキンが効いているかの確認になる)。 */
    const rv = (typeof skinTier3Move==='function') ? (skinTier3Move(mv, me) || mv) : mv;
    const shown = (projectiles[projectiles.length-1] || areaEffects[areaEffects.length-1] || {});
    return { name: mv.name, tier: mv.tier, aoe: mv.aoeShape||null,
             /* 撃った直後の本数。**表(data.js)の burst / warheads.count と突き合わせる**ための値。
                コマの counts.proj は「その時刻に生きている数」なので、初めから出ていないのか
                途中で消えたのかを、これが無いと区別できない。 */
             spawned: projectiles.length, spawnedAe: areaEffects.length,
             /* **SSRの上書きを当てたあとの技**から読む。素の技(mv)を見ていたため、
                ギガデストロイヤーの核弾頭が wantWarheads:0 と記録されていた。 */
             wantBurst: (rv.burst) || 1, wantWarheads: (rv.warheads && rv.warheads.count) || 0,
             style: shown.projStyle || shown.style || mv.aoeStyle || mv.projStyle || null,
             skinName: (typeof skinTier3Move==='function' ? (skinTier3Move(mv, me)||{}).name : null) };
  };
  /* 固定dtで時間を進める。撃ち返し・再発射は止めてあるので毎回同じ絵になる。 */
  /* 【最重要】**1コマ進めるごとに render() も呼ぶ。**
     fly / sustain の粒は render.js の fxGlFeed() の中でしか湧かない。
     update() だけを回して撮る瞬間に1回だけ描いていたので、1.15秒の技に対して
     sustain が**5回しか呼ばれていなかった**(実機は60fpsで約70回)。
     結果、羅生門の吸い込み・モッチ砲の花びら・サイコキネシスの芯は
     **実装されていても画に出ず、批評家が採点できなかった**。
     fx層の時計も実時間で進むので、描かないとエフェクトの時間も進まない。 */
  /* draw=true のときだけ1コマごとに描く。
     【なぜ描く必要があるか】fly / sustain の粒は render.js の fxGlFeed() の中でしか
     湧かない。撮る瞬間に1回だけ描いていたので、1.15秒の技に対して sustain が
     5回しか呼ばれず(実機は60fpsで約70回)、**実装した作り込みが画に出なかった**。
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
  window.__fx = api;
})();`;

const ALL_ELEMENTS = ['fire','aqua','leaf','spark','rock','phoenix','ark','warm','illumine','fox','god','zan',
                      'pixie','dullahan','hum','ogre','mocchi','suezo'];

// --moves fire:3,aqua:1  /  --moves fire  (全tier)
function parseMoves(spec, known){
  if(!spec) return known.flatMap(e=> [1,2,3].map(t=> ({ el:e, tier:t })));
  const out = [];
  for(const part of spec.split(',')){
    const [el, t] = part.split(':');
    if(!el) continue;
    if(t) out.push({ el:el.trim(), tier: parseInt(t,10) });
    else [1,2,3].forEach(tt=> out.push({ el:el.trim(), tier:tt }));
  }
  return out;
}

const report = { seed:SEED, map:MAP, size:[W,H], frames:FRAMES, shots:[], bench:{}, errors:[] };
const errors = [];

let page = null;
async function freshPage(){
  if(page) await page.close().catch(()=>{});
  const ctx = await browser.newContext({ viewport:{ width:W, height:H }, deviceScaleFactor:1,
                                         serviceWorkers:'block' });
  page = await ctx.newPage();
  /* ソフトウェアGPUでは1枚の screenshot に30秒以上かかることがある(実際に0.85sの
     コマで TimeoutError が出て、その技の残りのコマが丸ごと欠けた)。長めに取る。 */
  page.setDefaultTimeout(90000);
  page.on('pageerror', e=> errors.push('PAGEERR '+String(e).split('\n')[0]));
  page.on('console', m=>{ if(m.type()==='error') errors.push('CONSOLE '+m.text().slice(0,160)); });
  // 外部(フォント・Firebase)はヘッドレスでは繋がらない。待ち時間を作らないよう即座に切る
  await page.route('**://fonts.googleapis.com/**', r=> r.abort());
  await page.route('**://fonts.gstatic.com/**',   r=> r.abort());
  await page.route('**://www.gstatic.com/**',     r=> r.abort());
  await page.goto(`${ORIGIN}/index.html`, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(()=> typeof window.startGame === 'function'
    || (typeof startGame === 'function'), null, { timeout:30000 }).catch(()=>{});
  await page.evaluate(DRIVER);
  await page.waitForFunction(()=> window.__fx && window.__fx.ready(), null, { timeout:30000 });
  return page;
}

/* --sheetonly: 撮影はせず、既にある report.json からシートだけ作り直す。
   撮影は1回18分かかるので、シートの作りを直すたびに撮り直さなくて済むようにする。 */
if(flag('sheetonly')){
  const prev = JSON.parse(fs.readFileSync(path.join(OUT,'report.json'),'utf8'));
  report.shots = prev.shots || [];
}
const targets = flag('sheetonly') ? [] : parseMoves(MOVES, ALL_ELEMENTS);
// 属性ごとにページを作り直す。1ページの使い回しはWebGLコンテキストが積み上がって落ちる
const byElement = new Map();
for(const t of targets){
  if(!byElement.has(t.el)) byElement.set(t.el, []);
  byElement.get(t.el).push(t.tier);
}

for(const [el, tiers] of byElement){
  for(const tier of tiers){
    try {
      await freshPage();
      const setup = await page.evaluate(([e,m,s,v,sk,np])=> window.__fx.setup({ element:e, mapKey:m, seed:s, view:v, skin:sk, noPin:np }),
                                        [el, MAP, SEED, VIEW, SKIN, NOPIN]);
      if(!setup || !setup.ok){ errors.push(`${el}:t${tier} setup失敗`); continue; }
      report.setups = report.setups || {};
      report.setups[`${el}_t${tier}`] = setup;
      await page.evaluate(()=> window.__fx.hideHud());
      if(flag('nofx')) await page.evaluate(()=> window.__fx.setFx(false));
      /* 撃つ前に1.2秒回す。試合開始直後は画面が暗転から明けていく途中で、
         0.35秒では足りず最初のコマが真っ黒になった(god_t3で発生)。 */
      await page.evaluate(()=> window.__fx.step(1.2));
      /* 捨てコマを描く。**ページを開いてから最初の render() は2Dが真っ黒になる**
         (初回だけ用意される描画資源があるらしい)。1枚では足りない属性があったので
         合成の間を空けて2枚捨てる。ここをけちると立ち上がりのコマが撮れない。 */
      await page.evaluate(()=> window.__fx.draw());
      await page.waitForTimeout(120);
      await page.evaluate(()=> window.__fx.draw());
      await page.waitForTimeout(60);
      /* --video: 発射の前後を通しで撮る。撮った連番は encodeClip() が動画にする。 */
      if(VIDEO){
        const dir = path.join(OUT, `${el}_t${tier}`);
        fs.mkdirSync(dir, { recursive:true });
        const clipBox = CROP
          ? { x: Math.max(0, (W-CROP.w)/2|0), y: Math.max(0, (H-CROP.h)/2|0),
              width: Math.min(W, CROP.w), height: Math.min(H, CROP.h) }
          : { x:0, y:0, width:W, height:H };
        const dt = 1/FPS;
        const leadN = Math.round(LEAD*FPS), mainN = Math.round(SECS*FPS);
        let n = 0, info = null;
        const shoot = async ()=>{
          await page.evaluate(()=> window.__fx.draw());
          await page.waitForTimeout(30);   // 描いた内容が画面へ出るのを待つ(1コマ目が黒くなるのを防ぐ)
          await page.screenshot({ path: path.join(dir, `f${String(n).padStart(4,'0')}.jpg`),
                                  type:'jpeg', quality:QUAL, clip:clipBox });
          n++;
        };
        for(let i=0;i<leadN;i++){ await page.evaluate(([d])=> window.__fx.step(d, d, true), [dt]); await shoot(); }
        info = await page.evaluate((a)=> window.__fx.fire(a.t, a.v), { t: tier, v: VARIANT!=='' ? +VARIANT : null });
        for(let i=0;i<mainN;i++){ await page.evaluate(([d])=> window.__fx.step(d, d, true), [dt]); await shoot(); }
        report.clips = report.clips || [];
        report.clips.push({ el, tier, move:info && info.name, skin:SKIN||null, map:MAP,
                            fps:FPS, frames:n, secs:+(n/FPS).toFixed(2),
                            dir: path.relative(ROOT, dir) });
        console.log(`  ${el} t${tier}: ${n}コマ (${(n/FPS).toFixed(2)}秒) → ${path.relative(ROOT, dir)}`);
        continue;
      }
      const info = await page.evaluate((a)=> window.__fx.fire(a.t, a.v), { t: tier, v: VARIANT!=='' ? +VARIANT : null });
      let prev = 0;
      for(const at of FRAMES){
        /* 1回の evaluate が長いと Playwright のタイムアウト(30秒)に当たるので、
           0.15秒ずつに小分けして進める(ソフトウェアGPUでは1描画が重い)。 */
        let remain = Math.max(0, at - prev);
        while(remain > 0.0001){
          const slice = Math.min(0.15, remain);
          await page.evaluate(([dtSec])=> window.__fx.step(dtSec, null, true), [slice]);
          remain -= slice;
        }
        prev = at;
        const counts = await page.evaluate(()=> window.__fx.draw());
        /* 描いた内容が画面へ出るのを待つ。ゲームのrAFループを止めてあるので、
           待たないと**1コマ目だけ真っ黒**になる(合成が間に合わない)。 */
        await page.waitForTimeout(40);
        const file = path.join(OUT, `${el}_t${tier}_${String(at).replace('.','p')}.png`);
        const clip = CROP
          ? { x: Math.max(0, (W-CROP.w)/2|0), y: Math.max(0, (H-CROP.h)/2|0),
              width: Math.min(W, CROP.w), height: Math.min(H, CROP.h) }
          : { x:0, y:0, width:W, height:H };
        await page.screenshot({ path:file, clip });
        report.shots.push({ el, tier, at, move:info.name, skinName:info.skinName||null,
                            spawned:info.spawned, wantBurst:info.wantBurst, wantWarheads:info.wantWarheads,
                            skin:SKIN||null, style:info.style, counts,
                            file: path.relative(ROOT, file) });
      }
      if(flag('bench')){
        // WebGL層あり/なしの両方を測る。差がこの層の追加ぶん
        const bOff = await page.evaluate(()=> window.__fx.bench(40, true));
        const b    = await page.evaluate(()=> window.__fx.bench(40));
        report.bench[`${el}_t${tier}`] = { on:b, off:bOff, addedMs:+(b.ms-bOff.ms).toFixed(2) };
        process.stdout.write(`  負荷 ${el} t${tier}: ${bOff.ms}ms → ${b.ms}ms (+${(b.ms-bOff.ms).toFixed(2)}ms)\n`);
      }
      process.stdout.write(`撮影 ${el} t${tier} ${info.name}\n`);
    } catch(e){
      errors.push(`${el}:t${tier} ${String(e).split('\n')[0]}`);
    }
  }
}

/* --sheet: 1つの技のコマを横1列に並べた1枚を作る。
   批評家に渡すのはこれ。バラのPNGだと「立ち上がり→伸び→着弾→余韻」という
   時間の流れが判定できず、静止画1枚の印象だけで採点されてしまう。          */
if(flag('sheet') && report.shots.length){
  const byMove = new Map();
  for(const s of report.shots){
    const k = `${s.el}_t${s.tier}`;
    if(!byMove.has(k)) byMove.set(k, []);
    byMove.get(k).push(s);
  }
  const sheetPage = await browser.newPage({ viewport:{ width: 1200, height: 400 } });
  for(const [key, shots] of byMove){
    shots.sort((a,b)=> a.at - b.at);
    // 画像はbase64で埋め込む。--out がリポジトリの外(一時ディレクトリ)でも必ず出るようにする
    const cells = shots.map(s=>{
      const abs = path.resolve(ROOT, s.file);
      const b64 = fs.existsSync(abs) ? fs.readFileSync(abs).toString('base64') : '';
      return `<figure><img src="data:image/png;base64,${b64}"><figcaption>${s.at}s</figcaption></figure>`;
    }).join('');
    const html = `<meta charset="utf-8"><style>
      body{margin:0;background:#05070c;color:#e9e6dc;font-family:'Noto Sans JP',sans-serif;padding:14px 16px}
      h2{font-size:15px;margin:0 0 10px;color:#f4c430}
      .row{display:flex;gap:8px}
      figure{margin:0;flex:1 1 0}
      img{width:100%;display:block;border:1px solid rgba(255,255,255,.12)}
      figcaption{font-size:10px;color:#8d97a8;margin-top:3px;text-align:center}
      #wrap{display:inline-block}
      </style><div id="wrap"><h2>${key} — ${shots[0].move}${shots[0].style?' ('+shots[0].style+')':''}</h2>
      <div class="row">${cells}</div></div>`;
    await sheetPage.setContent(html);
    /* decode() まで待つ。complete だけを見ると**貼る前に撮ってしまい、1コマ目が
       真っ黒のシートができる**(PNG本体は正常なのに欠けて見えた)。 */
    await sheetPage.evaluate(()=> Promise.all([...document.images].map(i=> i.decode().catch(()=>{}))));
    const el = await sheetPage.$('#wrap');
    await el.screenshot({ path: path.join(OUT, `sheet_${key}.png`) });
  }
  await sheetPage.close();
}

report.errors = errors;
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
server.close();

/* 連番を動画にする。**ffmpeg はPATHに無い**ので、音声作業で使っている
   imageio-ffmpeg 同梱の実体を Python 経由で引く(aramon-audio スキルと同じやり方)。
   見つからないときは連番のまま置いて、その旨だけ伝える(撮り直しは高くつくので消さない)。 */
if(VIDEO && (report.clips||[]).length){
  const { execFileSync } = await import('child_process');
  let ff = null;
  try {
    ff = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'],
                      { encoding:'utf8' }).trim();
    if(!fs.existsSync(ff)) ff = null;
  } catch { ff = null; }
  if(!ff){
    console.log('\nffmpeg が見つからないので連番のままにした(pip install imageio-ffmpeg で入る)');
  } else {
    for(const c of report.clips){
      const dir = path.join(ROOT, c.dir);
      const mp4 = path.join(dir + '.mp4');
      try {
        execFileSync(ff, ['-y', '-framerate', String(c.fps), '-i', path.join(dir, 'f%04d.jpg'),
                          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
                          // 幅・高さを偶数へ丸める(奇数だと yuv420p で失敗する)
                          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', mp4],
                     { stdio:'pipe' });
        c.mp4 = path.relative(ROOT, mp4);
        console.log(`  動画: ${c.mp4}`);
      } catch(e){
        console.log(`  動画にできなかった: ${c.dir} — ${String(e.message||e).split('\n')[0]}`);
      }
    }
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  }
}

console.log(`\n出力: ${OUT}  (${VIDEO ? (report.clips||[]).length + '本' : report.shots.length + '枚'})`);
if(errors.length){
  console.log('エラー:');
  for(const e of errors.slice(0, 15)) console.log('  ' + e);
}
