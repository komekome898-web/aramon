/* 探検モードの見た目をヘッドレスChromiumで撮る開発用ツール(ゲーム本体には読み込まない)。
   **ゲームの遊びを確かめるものではない。** 批評家が「探検モードがどう見えるか」を
   毎回同じ条件の画像で採点するための撮影台。

   使い方:
     node tools/explore_shot.mjs --out shots/explore            全カット × 横持ち・縦持ち
     node tools/explore_shot.mjs --out shots/x --cuts camp,wild  カットを絞る
     node tools/explore_shot.mjs --out shots/x --vps land        横持ちだけ(land / port)
     node tools/explore_shot.mjs --list                          カットの一覧を出して終わる
     node tools/explore_shot.mjs --measure                       探検のHUDを縦持ち3サイズ+横持ちで実測(撮らない)
   その他: --seed <数>(配置の乱数。既定 20260923) / --element <属性>(出発するモンスター。既定 fire)

   出力: <out>/<cut>_<vp>.png と <out>/report.json(撮れた枚数・カメラ位置・失敗)

   撮り方の決まり(layout_test.mjs / result_shot.mjs / real3d_shot.mjs と同じ土台):
     ・ローカルにHTTPサーバを立てて index.html を開く。sw.js は404で返す(キャッシュを挟ませない)
     ・screen を viewport と同じ値にする。そうしないと縦持ちで強制横向き(#appRootの90度回転)が効かない
     ・**縦持ちは絵を回して保存する**(実機を手に持ったときに見える向きへ戻す。result_shot と同じ)
     ・試合に入ったらゲーム自身のフレームループ(requestAnimationFrame)を止め、こちらが update()/render() を
       手で回す(tools/fx_driver.js と同じ考え方)。止めないと次のフレームが置き直したカメラを上書きする
     ・波・溶岩の脈動は performance.now() で進むので、描く間だけ時刻を固定する(real3d_probe と同じ)
     ・Math.random はシード付きに差し替える(何度撮っても同じ配置)

   【カットを足すとき】下の CUTS へ1行足すだけ(後続の担当: 狙撃・ボス・HUD がここへ足す)。
     kind:'lobby'  … ロビー側の画。prep(ページ内で実行)で画面を整える
     kind:'field'  … 探検中の画。at(ページ内で実行)が { x, y, yaw, pitch, warm } を返す
                     warm = 撮る前に update() を回す秒数(野生が気づいて寄ってくる等を写すため)
     kind:'result' … 結果画面。prep で素材を拾わせてから exploreFinish を呼ぶ
   prep / at は**ページの中で**文字列から関数に戻して実行する(ゲームの変数へ直接触れる)。 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ===== カットの表(この表が正。1行足せば1カット増える) ===== */
const CUTS = [
  { name:'lobby', kind:'lobby', desc:'ロビー(プレイモード=探検・右下が「探検へ出発」)',
    prep: ()=>{ setLobbyMode('explore', { save:false }); refreshLobby(); } },
  { name:'lobby_mode', kind:'lobby', desc:'プレイモード選択で探検を選んだ状態',
    prep: ()=>{ setLobbyMode('explore', { save:false }); refreshLobby(); lobbyOpenOverlay('modePickOverlay'); } },
  /* 工房(ui.js の renderExploreForge)。保管と装備は撮るたびに同じ中身へ書き直す(前のカットの結果を持ち越さない) */
  { name:'forge', kind:'lobby', desc:'工房: 表(行=セット・列=部位・武器の派生の線)と詳細(見た目・今の装備との比較・合計)',
    prep: ()=>{
      saveExploreStash({ meadow_fiber:14, jungle_vine:9, frost_shard:12, volcano_ore:15, boss_horn:5, boss_fang:2, boss_scale:3, apex_core:3 });
      saveExploreGear({ owned:['scout_head','horn_body','horn_arms','horn_bow'], equip:{ head:'scout_head', body:'horn_body', arms:'horn_arms', weapon:'horn_bow' } });
      setLobbyMode('explore', { save:false }); refreshLobby();
      exploreForgeState.sel = 'apex_body';
      openExploreForge();
    } },
  { name:'forge_weapon', kind:'lobby', desc:'工房: 素材が足りない武器の詳細(足りない素材の入手先)',
    prep: ()=>{
      saveExploreStash({ meadow_fiber:4, frost_shard:3, volcano_ore:2, boss_fang:1 });
      saveExploreGear({ owned:['scout_head'], equip:{ head:'scout_head' } });
      exploreForgeState.sel = 'frost_rifle';
      openExploreForge();
    } },
  /* 完成の演出は時間で進むので、決まった時刻で止めて撮る(撮るたびに同じ絵)。
     forge_done = 光って完成が出た直後(2.1秒)/ forge_choice = 合計の変化と「装備する/あとで」(2.6秒) */
  { name:'forge_done', kind:'lobby', desc:'工房: 作ったときの演出(光って完成=装備を着けた竜・着けたときの差・新しく作れる物)',
    prep: ()=>{
      saveExploreStash({ boss_horn:5, volcano_ore:6, meadow_fiber:4, apex_core:2, boss_fang:2, boss_scale:2 });
      saveExploreGear({ owned:['horn_head','horn_body','horn_arms'], equip:{ head:'horn_head', body:'horn_body', arms:'horn_arms' } });
      exploreForgeState.sel = 'horn_bow';
      openExploreForge();
      exploreForgeCraft('horn_bow');
      document.getElementById('exploreForgeFx').getAnimations({ subtree:true }).forEach(a=>{ a.pause(); a.currentTime = 2100; });
    } },
  { name:'forge_choice', kind:'lobby', desc:'工房: 完成のあと(着けると合計がどう変わるか・装備する/あとで)',
    prep: ()=>{
      saveExploreStash({ boss_horn:5, volcano_ore:6, meadow_fiber:4, apex_core:2, boss_fang:2, boss_scale:2 });
      saveExploreGear({ owned:['horn_head','horn_body','horn_arms'], equip:{ head:'horn_head', body:'horn_body', arms:'horn_arms' } });
      exploreForgeState.sel = 'horn_bow';
      openExploreForge();
      exploreForgeCraft('horn_bow');
      document.getElementById('exploreForgeFx').getAnimations({ subtree:true }).forEach(a=>{ a.pause(); a.currentTime = 2700; });
    } },
  { name:'camp', kind:'field', desc:'ベースキャンプの出発地点から帰還ビーコン側を見渡す',
    at: ()=>{ const s = exploreState.spawn, b = exploreState.beacon;
              return { x:s.x, y:s.y, yaw:Math.atan2(b.y-s.y, b.x-s.x), pitch:0.14, warm:0.3 }; } },
  { name:'camp_out', kind:'field', desc:'ベースキャンプから外(草原の盆地の方角)を望む',
    at: ()=>{ const s = exploreState.spawn, r = exploreRegionCircle(exploreRegion('meadow'));
              return { x:s.x, y:s.y, yaw:Math.atan2(r.y-s.y, r.x-s.x), pitch:0.08, warm:0.3 }; } },
  // 各地域: 中心の少しキャンプ寄りに立ち、地域の奥(外側)へ向かって見渡す
  ...['meadow','frost','volcano','jungle'].map(id=>({
    name:'field_'+id, kind:'field', desc:`地域「${id}」の中心付近から奥を見渡す`,
    at: new Function(`
      const reg = exploreRegion(${JSON.stringify(id)}); const c = exploreRegionCircle(reg);
      const cx = WORLD.w*EXPLORE_CAMP.xr, cy = WORLD.h*EXPLORE_CAMP.yr;
      const dir = Math.atan2(c.y-cy, c.x-cx);
      const p = clearObstaclePoint(c.x - Math.cos(dir)*c.r*0.45, c.y - Math.sin(dir)*c.r*0.45, 80);
      return { x:p.x, y:p.y, yaw:dir, pitch:0.10, warm:0.3 };`),
  })),
  { name:'wild', kind:'field', desc:'野生モンスターの近く(気づいて寄ってくるところ)',
    at: ()=>{
      const w = exploreState.wild.map(r=>getEntity(r.id)).find(e=> e && e.alive && e.exploreRegion==='meadow')
             || exploreState.wild.map(r=>getEntity(r.id)).find(e=> e && e.alive);
      if(!w) return null;
      const a = Math.atan2(exploreState.camp.y - w.y, exploreState.camp.x - w.x);   // キャンプ側から近づく
      const p = clearObstaclePoint(w.x + Math.cos(a)*520, w.y + Math.sin(a)*520, 60);
      return { x:p.x, y:p.y, yaw:Math.atan2(w.y-p.y, w.x-p.x), pitch:0.12, warm:1.2, lookAt:w.id };
    } },
  /* ---- 野生の群れとボス(段2)。状態を直接作って撮る(遊びの確認ではなく見た目の採点用) ----
     at() が返す物に after(撮る直前に1回)・vuln(撮影中の無敵を外す)を足せる */
  { name:'wild_herd', kind:'field', desc:'草原の群れがうろつく所(リーダー+取り巻き。気づかれていない)',
    at: ()=>{
      const pk = exploreState.packs.find(q=> q.region==='meadow') || exploreState.packs[0];
      if(!pk) return null;
      const mem = exploreState.wild.filter(w=> w.pack===pk.id).map(w=> getEntity(w.id)).filter(Boolean);
      const L = mem.find(e=> e.exLeader) || mem[0];
      const a = Math.atan2(exploreState.camp.y - L.y, exploreState.camp.x - L.x);
      const p = clearObstaclePoint(L.x + Math.cos(a)*460, L.y + Math.sin(a)*460, 60);
      return { x:p.x, y:p.y, yaw:Math.atan2(L.y-p.y, L.x-p.x), pitch:0.12, warm:4, lookAt:L.id };
    } },
  { name:'wild_alert', kind:'field', desc:'好戦的な群れが気づいた瞬間(リーダーに「!」・仲間は「?」)',
    at: ()=>{
      const pk = exploreState.packs.find(q=> exploreWildNature(q.element).temper==='aggressive' && q.region==='volcano')
              || exploreState.packs.find(q=> exploreWildNature(q.element).temper==='aggressive');
      if(!pk) return null;
      const mem = exploreState.wild.filter(w=> w.pack===pk.id).map(w=> getEntity(w.id)).filter(Boolean);
      const L = mem.find(e=> e.exLeader) || mem[0];
      const a = Math.atan2(exploreState.camp.y - L.y, exploreState.camp.x - L.x);
      const p = clearObstaclePoint(L.x + Math.cos(a)*520, L.y + Math.sin(a)*520, 60);
      return { x:p.x, y:p.y, yaw:Math.atan2(L.y-p.y, L.x-p.x), pitch:0.12, warm:1.5, lookAt:L.id, vuln:true,
        after: ()=>{
          exploreWildAlert(L, player);
          L.exAlertAt = matchTime - 0.25;
          mem.filter(e=> e!==L).forEach((e, i)=>{ e.exState='wander'; e.exCallAt=null; e.exAlertAt=-99; e.exAware = 0.35 + i*0.25; e.facingAngle = Math.atan2(player.y-e.y, player.x-e.x); });
        } };
    } },
  { name:'wild_flee', kind:'field', desc:'弱って逃げる野生(片側へ傾いて跳ねる・💦)',
    at: ()=>{
      const pk = exploreState.packs.find(q=> exploreWildNature(q.element).temper==='docile') || exploreState.packs[0];
      if(!pk) return null;
      const mem = exploreState.wild.filter(w=> w.pack===pk.id).map(w=> getEntity(w.id)).filter(Boolean);
      const L = mem.find(e=> e.exLeader) || mem[0];
      const a = Math.atan2(exploreState.camp.y - L.y, exploreState.camp.x - L.x);
      const p = clearObstaclePoint(L.x + Math.cos(a)*260, L.y + Math.sin(a)*260, 60);
      return { x:p.x, y:p.y, yaw:Math.atan2(L.y-p.y, L.x-p.x), pitch:0.12, warm:0.3, lookAt:L.id, vuln:true,
        after: ()=>{ mem.forEach(e=>{ e.exState='flee'; e.exFleeUntil = matchTime + 9; e.hp = e.maxHp*0.2; }); for(let i=0;i<12;i++) update(1/30); } };
    } },
  ...[
    { name:'boss_intro', boss:'gandrock', dist:1150, keepCam:true,
      desc:'ボス登場(背を向けていても向き直る・寄り・黒帯・咆哮・名前の札)',
      after: `camState.yaw = Math.atan2(player.y-B.y, player.x-B.x) + 0.4; B.exState='dormant'; exploreBossStartRoar(B, 'intro'); for(let i=0;i<16;i++) update(1/30);` },
    { name:'boss_charge', boss:'volgreim', dist:1000, desc:'ボスの突進の予告(通り道の帯。根元から先へ満ちる)',
      after: `exploreBossEngaged(B); B.exState='fight'; B.exPending=null; exploreBossBeginAttack(B, exploreBossDef(B), player, 'charge'); for(let i=0;i<18;i++) update(1/30);` },
    { name:'boss_telegraph', boss:'volgreim', dist:1100, desc:'ボスの大技の予告(扇のブレス。地面の印とHPバーの技名)',
      after: `exploreBossEngaged(B); B.exState='fight'; B.exPending=null; exploreBossBeginAttack(B, exploreBossDef(B), player, 'breath'); for(let i=0;i<8;i++) update(1/30);` },
    { name:'boss_meteor', boss:'galvark', dist:1000, desc:'ボスの大技の予告(流星群。時間差で落ちる円)',
      after: `exploreBossEngaged(B); B.exState='fight'; B.exRage=true; B.hp=B.maxHp*0.42; B.exPending=null; exploreBossBeginAttack(B, exploreBossDef(B), player, 'rain'); for(let i=0;i<22;i++) update(1/30);` },
    { name:'boss_weak', boss:'galvark', dist:700, desc:'技の弾が弱点(頭)に当たった瞬間(当たった高さに黄色の大きい数字・弱点！)',
      after: `exploreBossEngaged(B); B.exState='fight'; const H = exploreBodyHeight(B); applyDamage(B, 40, player, { hitZ:(B.z||0)+H*0.3 }); for(let i=0;i<5;i++) update(1/30); applyDamage(B, 60, player, { hitZ:(B.z||0)+H*0.82 }); for(let i=0;i<3;i++) update(1/30);` },
    { name:'boss_rage', boss:'galvark', dist:900, desc:'怒り状態(赤いオーラ・色味・咆哮・「怒り」の札)',
      after: `exploreBossEngaged(B); B.exState='fight'; B.hp=B.maxHp*0.46; B.exHpLag=0.62; B.exRage=true; exploreBossStartRoar(B, 'rage'); for(let i=0;i<12;i++) update(1/30);` },
    { name:'boss_break', boss:'gandrock', dist:1150, desc:'部位破壊の瞬間(転倒・星・ひびの印・素材が弾ける)',
      after: `exploreBossEngaged(B); B.exState='fight'; B.hp=B.maxHp*0.63; B.exHpLag=0.7; exploreBossBreakPart(B, exploreBossDef(B)); for(let i=0;i<10;i++) update(1/30);` },
    { name:'boss_hunt', boss:'gidravers', dist:1500, keepCam:true, desc:'頂点ボスの討伐の瞬間(スローモーション・討伐完了・大量の素材)',
      after: `exploreBossEngaged(B); B.exState='fight'; B.hp=1; applyDamage(B, 50, player, {}); exploreState.slowmo = null; for(let i=0;i<44;i++) update(1/30);` },
  ].map(c=>({
    name:c.name, kind:'field', desc:c.desc,
    at: new Function(`
      const rec = exploreState.bosses.find(r=> r.bossId===${JSON.stringify(c.boss)});
      const B = rec && getEntity(rec.id); if(!B) return null;
      const a = Math.atan2(exploreState.camp.y - B.y, exploreState.camp.x - B.x);
      const p = clearObstaclePoint(B.x + Math.cos(a)*${c.dist}, B.y + Math.sin(a)*${c.dist}, 60);
      B.exState = 'fight'; B.exploreAsleep = false; B.facingAngle = Math.atan2(p.y-B.y, p.x-B.x);
      exploreState.banners.length = 0; exploreState.fx.length = 0;   // 前のカットの札を持ち越さない
      exploreState.cine = null; exploreState.pops.length = 0; exploreState.shards.length = 0; document.body.classList.remove('explore-cine');   // 視点演出も持ち越さない
      return { x:p.x, y:p.y, yaw:Math.atan2(B.y-p.y, B.x-p.x), pitch:0.16, warm:0.4, lookAt:B.id, vuln:true, keepCam:${c.keepCam !== false},   // 既定でゲームのカメラのまま(ボス戦の視点の補正を写す)
               after: ()=>{ ${c.after} } };`),
  })),
  /* ===== ルート(explore_loot.js)。補給箱は地域の中に散っているので、撮る前にキャンプの箱を選び、
     撮りたいレア度へ書き換えてから近づく(配置の乱数に左右されない) ===== */
  { name:'crate_near', kind:'field', desc:'補給箱の近く(閉じている・金の箱。とどまって開ける途中)',
    at: ()=>{
      const c = exploreState.crates.find(k=> !k.opened);
      if(!c) return null;
      c.rarity = 'legendary';
      const a = Math.atan2(exploreState.spawn.y - c.y, exploreState.spawn.x - c.x);
      const p = { x:c.x + Math.cos(a)*230, y:c.y + Math.sin(a)*230 };
      // 2つ目の箱(紫)も同じ画に入るよう横に寄せる
      const c2 = exploreState.crates.find(k=> !k.opened && k !== c);
      if(c2){ c2.rarity = 'epic'; c2.x = c.x + Math.cos(a+Math.PI/2)*170 - Math.cos(a)*90; c2.y = c.y + Math.sin(a+Math.PI/2)*170 - Math.sin(a)*90; c2.z = baseTerrainHeightAt(c2.x, c2.y); }
      c.hold = EXPLORE_CRATE_OPEN_SEC*0.55;
      return { x:p.x, y:p.y, yaw:Math.atan2(c.y-p.y, c.x-p.x) + 0.12, pitch:0.16, warm:0 };
    } },
  { name:'crate_open', kind:'field', desc:'補給箱が開いた瞬間(蓋が跳ね上がり中身が弾けて散る)',
    at: ()=>{
      const c = exploreState.crates.find(k=> !k.opened);
      if(!c) return null;
      c.rarity = 'legendary';
      const a = Math.atan2(exploreState.spawn.y - c.y, exploreState.spawn.x - c.x);
      const p = { x:c.x + Math.cos(a)*300, y:c.y + Math.sin(a)*300 };
      camState.yaw = Math.atan2(c.y-p.y, c.x-p.x);   // 中身の扇はカメラの横向きに並ぶので、開ける前に向きを合わせる
      exploreOpenCrate(c);
      return { x:p.x, y:p.y, yaw:Math.atan2(c.y-p.y, c.x-p.x), pitch:0.12, warm:0.62 };
    } },
  { name:'pillars', kind:'field', desc:'光の柱が並ぶ遠景(白・青・紫・金)',
    at: ()=>{
      const reg = exploreRegion('meadow'), rc = exploreRegionCircle(reg);
      const cx = WORLD.w*EXPLORE_CAMP.xr, cy = WORLD.h*EXPLORE_CAMP.yr;
      const dir = Math.atan2(rc.y-cy, rc.x-cx);
      const p = clearObstaclePoint(rc.x - Math.cos(dir)*rc.r*0.55, rc.y - Math.sin(dir)*rc.r*0.55, 80);
      const keys = ['meadow_fiber','heal_s','meadow_honey','scope4x','boss_horn','meadow_fiber','guts','apex_core','frost_dew','longbow','scope8x','volcano_ore'];
      keys.forEach((k, i)=>{
        const d = 500 + i*230, a = dir + (((i*7)%9)-4)*0.085;
        exploreSpawnDrop(p.x + Math.cos(a)*d, p.y + Math.sin(a)*d, k, null, { dist:[0, 20], delay:0 });
      });
      return { x:p.x, y:p.y, yaw:dir, pitch:0.07, warm:1.4 };
    } },
  { name:'loot_feed', kind:'field', desc:'拾った通知が画面の左に積み上がったところ(白・青・紫・金)',
    waitMs: 700,
    at: ()=>{
      const s = exploreState.spawn;
      ['meadow_fiber','frost_dew','boss_fang','apex_core'].forEach((k, i)=> exploreGainMaterial(k, 1 + (i===0 ? 2 : 0), null, null));
      // 撮影は1枚に数秒かかる(ソフトウェア描画)ので、行が消える前に撮れるよう消える予約を外す
      document.querySelectorAll('#expLootFeed .exp-feed-row').forEach(r=> clearTimeout(r._expTimer));
      const c = exploreState.crates.find(k=> !k.opened);
      const yaw = c ? Math.atan2(c.y - s.y, c.x - s.x) : -Math.PI/2;
      return { x:s.x, y:s.y, yaw, pitch:0.12, warm:0 };
    } },
  /* ===== 狙撃銃とスコープ(sniper.js)。的は野生モンスターとボス。舞台は __shotSnipe が作る ===== */
  ...[
    { name:'sniper_hud',    desc:'狙撃銃を持った普段のHUD(狙撃ボタン・残弾と倍率の札)', o:{ target:'wild', dist:900, scope:null } },
    { name:'sniper_iron',   desc:'アイアンサイト(1.25倍)で野生を覗く', o:{ target:'wild', dist:900, scope:'iron', ratio:0.6 } },
    { name:'sniper_x2',     desc:'2倍スコープで野生を覗く', o:{ target:'wild', dist:1300, scope:'x2', ratio:0.6, sway:0.7 } },
    { name:'sniper_x4',     desc:'4倍スコープで野生を覗く(照準の先の1体の帯)', o:{ target:'wild', dist:1900, scope:'x4', ratio:0.55, sway:1.3 } },
    { name:'sniper_x8',     desc:'8倍スコープで240m先の野生を覗く(草が遠くまで・霞・照準の先の帯)', o:{ target:'wild', dist:2400, scope:'x8', ratio:0.55, sway:2.1 } },
    { name:'sniper_x8_boss',desc:'8倍スコープで遠くのボスを覗く', o:{ target:'boss:gandrock', dist:3200, scope:'x8', ratio:0.45, sway:0.4 } },
    { name:'sniper_weak',   desc:'8倍で、伏せて眠るボスの頭に狙いが乗った(姿勢込みの頭。中心が金+輪+「弱点」)', o:{ target:'boss:gandrock', dist:3200, scope:'x8', ratio:0.76, ballistic:true, pose:'sleep' } },
    { name:'sniper_breath', desc:'8倍で息止め中(揺れが収まり、鏡筒に息のゲージ)', o:{ target:'boss:volgreim', dist:3000, scope:'x8', ratio:0.6, breath:true, sway:1.1 } },
    { name:'sniper_muzzle', desc:'撃った瞬間(跳ね上がり・窓の欠け・下の縁の炎)', o:{ target:'boss:gandrock', dist:3200, scope:'x8', ratio:0.76, ballistic:true, fire:'muzzle' } },
    { name:'sniper_tracer', desc:'弾道の光(銃口=右下から照準へ吸い込まれて落ちる弧)', o:{ target:'boss:gandrock', dist:3200, scope:'x8', ratio:0.76, ballistic:true, fire:'tracer' } },
    { name:'sniper_hit',    desc:'体(胸)に当たった直後(白い×・白い数字・撃った距離)', o:{ target:'boss:gandrock', dist:3200, scope:'x8', ratio:0.4, ballistic:true, fire:'hit' } },
    { name:'sniper_crit',   desc:'弱点(頭)に当たった直後(金の×と広がる輪・1.5倍の黄〜橙の数字・「弱点!」)', o:{ target:'boss:gandrock', dist:3200, scope:'x8', ratio:0.76, ballistic:true, fire:'hit', noBreak:true } },
    { name:'sniper_miss',   desc:'外れた所の土煙', o:{ target:'wild', dist:2400, scope:'x8', ratio:-0.6, ballistic:true, fire:'miss' } },
  ].map(c=>({ name:c.name, kind:'field', desc:c.desc,
              at: new Function(`return window.__shotSnipe(${JSON.stringify(c.o)});`) })),
  /* ===== HUD(explore_hud.js)。方位バー・目標パネル・探検のミニマップ・全体地図・ボス戦の帯 =====
     拾った通知の行は消してから撮る(HUDそのものを見るカット) */
  { name:'hud', kind:'field', desc:'通常の画面: 方位バー(巣・箱・ビーコン)・目標パネル・地域の札・ミニマップ', waitMs:700,
    at: ()=>{
      const reg = exploreRegion('meadow'), c = exploreRegionCircle(reg);
      ['meadow_fiber','meadow_honey','frost_dew','boss_fang','meadow_fiber'].forEach(k=> exploreGainMaterial(k, 2, null, null));
      document.querySelectorAll('#expLootFeed .exp-feed-row').forEach(r=>{ clearTimeout(r._expTimer); r.remove(); });
      matchTime = 312; exploreState.faints = 1;
      _expHud.region.id = null;   // キャンプから草原へ入った扱いにして、地域の名前の札を出す
      const p = clearObstaclePoint(c.x + c.r*0.3, c.y + c.r*0.05, 80);
      const nest = exploreState.bosses.find(r=> r.bossId==='gandrock');
      /* pitch 0.2(以前は0.1): 自分の足元の装備オーラの紋章(explore_loot.js)が近すぎて
         画面の下端で半分切れていた(第3周の指摘)。見下ろす角度を少し増やして足元を画面の内側へ */
      return { x:p.x, y:p.y, yaw:Math.atan2(nest.nestY - p.y, nest.nestX - p.x) + 0.3, pitch:0.2, warm:0.2,
               after: ()=>{
                 exploreUpdateHud();
                 // 地域の札は実時間で2.8秒の動き。撮影(ソフトウェア描画)が遅いと撮る前に消えるので、出きった所で止める
                 document.getElementById('expRegionCard').getAnimations().forEach(a=>{ a.pause(); a.currentTime = 1000; });
               } };
    } },
  { name:'hud_boss', kind:'field', desc:'ボス戦のHUD: 怒り・予告中の大技・方位バーの脈打つ印・目標が討伐に切り替わる',
    at: ()=>{
      const rec = exploreState.bosses.find(r=> r.bossId==='volgreim');
      const B = rec && getEntity(rec.id); if(!B) return null;
      const a = Math.atan2(exploreState.camp.y - B.y, exploreState.camp.x - B.x);
      const p = clearObstaclePoint(B.x + Math.cos(a)*1050, B.y + Math.sin(a)*1050, 60);
      B.exState = 'fight'; B.exploreAsleep = false; B.facingAngle = Math.atan2(p.y-B.y, p.x-B.x);
      exploreState.banners.length = 0; exploreState.fx.length = 0;
      return { x:p.x, y:p.y, yaw:Math.atan2(B.y-p.y, B.x-p.x), pitch:0.16, warm:0.4, lookAt:B.id, vuln:true,
        after: ()=>{
          exploreBossEngaged(B); B.exState='fight'; B.exRage=true; B.hp=B.maxHp*0.38; B.exHpLag=0.5; B.exBroken=true;
          B.exPending=null; exploreBossBeginAttack(B, exploreBossDef(B), player, 'breath');
          for(let i=0;i<6;i++) update(1/30);
          exploreState.banners.length = 0;
          exploreUpdateHud();
        } };
    } },
  { name:'hud_beacon', kind:'field', desc:'帰還ビーコンの輪の中(目標パネルの帰還の進み・方位バー)',
    at: ()=>{
      const b = exploreState.beacon, s = exploreState.spawn;
      matchTime = 700;
      const p = { x:b.x + (s.x - b.x)*0.25, y:b.y + (s.y - b.y)*0.25 };
      // pitch 0.22(以前は0.12): 同じ理由(足元の装備オーラの紋章が画面の下端で切れていた)
      return { x:p.x, y:p.y, yaw:Math.atan2(b.y - p.y, b.x - p.x) + 0.6, pitch:0.22, warm:0,
               after: ()=>{
                 /* 前の 'hud_boss' カットが exploreBossEngaged() で engagedBossId を立てたまま(カット間で
                    状態を持ち越す撮影ハーネスの都合)。ここではキャンプで帰還中の場面を撮るので、
                    ボス戦の状態を明示的に解く(第4周で見つけた: 「ヴォルガルーダを…討伐中」が
                    帰還中の札と同時に出ていた原因はこれだった。実際のプレイでは離れれば自然に解ける) */
                 exploreState.engagedBossId = null;
                 exploreState.beaconInside = true; exploreState.beaconHold = EXPLORE_BEACON_HOLD_SEC*0.55; exploreUpdateHud();
               } };
    } },
  { name:'map', kind:'field', desc:'全体地図(ミニマップをタップ。地域・尾根・峠・道・ボスの巣・近くの補給箱)',
    at: ()=>{
      const reg = exploreRegion('frost'), c = exploreRegionCircle(reg);
      const rec = exploreState.bosses.find(r=> r.bossId==='gandrock'); if(rec) rec.defeated = true;
      const p = clearObstaclePoint(c.x - c.r*0.2, c.y + c.r*0.25, 80);
      return { x:p.x, y:p.y, yaw:-0.8, pitch:0.1, warm:0.1, after: ()=>{ exploreUpdateHud(); exploreOpenMap(); } };
    } },
  /* 全画面の札(explore_loot.js の exploreCineDraw)。進行の時計を手で進めて途中の絵を撮る */
  { name:'depart', kind:'result', desc:'出発: 「探検開始」の札(目標・制限時間)とキャンプを回るカメラ(0.9秒時点)', keepOutro:true,
    prep: ()=>{
      exploreIntroStart();
      for(let i=0;i<27;i++) update(1/30);
      render();
    } },
  { name:'faint_fall', kind:'result', desc:'力尽き: 札の前に倒れる動き(傾いて沈み、色が抜ける。0.35秒時点)', keepOutro:true,
    prep: ()=>{
      player.exploreInvulnUntil = 0;
      exploreOnPlayerFaint(player, null);
      exploreState.slowmo = null;   // 倒れた瞬間の一瞬のスローは実時間で進むので、撮影では外して試合の時計だけで進める
      const n = Math.round(EXPLORE_FAINT_SEQ.fall * 0.7 * 30);
      for(let i=0;i<n;i++) update(1/30);
      render();
    } },
  { name:'faint_card', kind:'result', desc:'力尽き: 「力尽きた 1/3」の札(倒れたあと・暗転する前)', keepOutro:true,
    prep: ()=>{
      player.exploreInvulnUntil = 0;
      exploreOnPlayerFaint(player, null);
      exploreState.slowmo = null;   // 倒れた瞬間の一瞬のスローは実時間で進むので、撮影では外して試合の時計だけで進める
      const n = Math.round((EXPLORE_FAINT_SEQ.fall + 0.45) * 30);
      for(let i=0;i<n;i++) update(1/30);
      render();
    } },
  { name:'faint_wake', kind:'result', desc:'力尽き: 暗転のあと、ベースキャンプで明転しながら起き上がるところ', keepOutro:true,
    prep: ()=>{
      player.exploreInvulnUntil = 0;
      exploreOnPlayerFaint(player, null);
      exploreState.slowmo = null;   // 倒れた瞬間の一瞬のスローは実時間で進むので、撮影では外して試合の時計だけで進める
      const S = EXPLORE_FAINT_SEQ;
      const n = Math.round((S.fall + S.card + S.fadeOut + S.black + S.fadeIn*0.45) * 30);
      for(let i=0;i<n;i++) update(1/30);
      render();
    } },
  { name:'return_card', kind:'result', desc:'終了直後: フィールドの「帰還成功」の札(報酬画面の前)', keepOutro:true,
    prep: ()=>{
      ['meadow_fiber','boss_horn','apex_core','frost_shard','meadow_honey','volcano_heart'].forEach((k, i)=> exploreGainMaterial(k, 1 + i, null, null));
      exploreFinish('return');
      clearTimeout(exploreOutroTimer);   // 撮り終えるまで報酬画面へ進ませない(1枚に数秒かかる)
      exploreState.card.t0 -= 1.6;   // 札が出そろい、素材が流れ終わった時刻の絵にする(札は実時間で進む)
      render();
    } },
  { name:'result', kind:'result', desc:'帰還(exploreFinish(\'return\'))後の結果画面',
    prep: ()=>{
      const pick = ['meadow_fiber','meadow_honey','frost_shard','volcano_heart','jungle_relic','boss_horn','apex_core'];
      pick.forEach((k, i)=> exploreGainMaterial(k, 1 + (i*2)%5, null, null));
      exploreState.kills = 12;
      // 記録の欄に出る物(狩った主・部位破壊・開けた箱)も入れておく
      exploreState.bosses.slice(0, 2).forEach(r=> r.defeated = true);
      if(exploreState.bosses[0]) exploreState.bosses[0].broken = true;
      exploreState.crates.slice(0, 7).forEach(c=> c.opened = true);
      matchTime = 612;
      exploreFinish('return');
    } },
  { name:'result_faint', kind:'result', desc:'力尽き3回で終わった結果画面(持ち帰り半分)',
    prep: ()=>{
      ['meadow_fiber','frost_dew','volcano_ore','jungle_vine'].forEach((k, i)=> exploreGainMaterial(k, 1 + i, null, null));
      exploreState.kills = 5; exploreState.faints = 3;
      matchTime = 431;
      exploreFinish('faint');
    } },
];

/* 撮る画面の大きさ。port は iPhone の縦持ち(=強制横向き)。保存時に横向きへ戻す */
const VIEWPORTS = {
  land: { w:1624, h:750, isMobile:false, dsf:1 },
  port: { w:375,  h:812, isMobile:true,  dsf:2 },
  // 横持ちのスマホ(実画面の幅が520より広い=narrow-screen が付かない。回転ボタンがミニマップのすぐ下に来る低い形)。
  // 既定では撮らない(--vps phone で指定)
  phone: { w:812, h:375, isMobile:true, dsf:2 },
  // 縦持ちの小さい/大きい端末(既定では撮らない。--vps p667,p896)
  p667:  { w:375, h:667, isMobile:true, dsf:2 },
  p896:  { w:414, h:896, isMobile:true, dsf:2 },
};
const DEFAULT_VPS = ['land', 'port'];

/* ===== 引数 ===== */
const args = process.argv.slice(2);
const opt = (name, def)=>{ const i = args.indexOf('--'+name); return i>=0 && args[i+1] ? args[i+1] : def; };
const flag = (name)=> args.includes('--'+name);
if(flag('list')){
  for(const c of CUTS) console.log(`${c.name.padEnd(16)} ${c.kind.padEnd(7)} ${c.desc}`);
  process.exit(0);
}
const OUT = path.resolve(opt('out', path.join(ROOT, 'shots', 'explore')));
const SEED = parseInt(opt('seed', '20260923'), 10);
const ELEMENT = opt('element', 'fire');
const cutNames = opt('cuts', '') ? opt('cuts','').split(',').map(s=>s.trim()).filter(Boolean) : CUTS.map(c=>c.name);
const vpNames  = opt('vps', '')  ? opt('vps','').split(',').map(s=>s.trim()).filter(Boolean)  : DEFAULT_VPS;
const cuts = cutNames.map(n=>{ const c = CUTS.find(x=>x.name===n); if(!c) console.warn(`知らないカット: ${n}(--list で一覧)`); return c; }).filter(Boolean);
fs.mkdirSync(OUT, { recursive:true });

/* ===== playwright(グローバルでもよい。measure_layout.mjs と同じ探し方) ===== */
let chromium = null;
try { ({ chromium } = await import('playwright')); }
catch {
  for(const b of ['/opt/node22/lib/node_modules/', '/usr/lib/node_modules/', '/usr/local/lib/node_modules/']){
    try { ({ chromium } = createRequire(b)('playwright')); break; } catch {}
  }
}
if(!chromium){ console.error('playwrightが見つかりません(npm i -g playwright)。'); process.exit(1); }

/* ESモジュール(real3d.js)は file:// から読めないので、リポジトリを配る小さなHTTPサーバを立てる */
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
               '.webp':'image/webp', '.mp3':'audio/mpeg', '.mp4':'video/mp4', '.webm':'video/webm' };
const server = http.createServer((req, res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if(rel === 'sw.js'){ res.writeHead(404); res.end('no sw in shot'); return; }
  const file = path.resolve(ROOT, rel);
  if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r=> server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: fs.existsSync('/opt/pw-browsers/chromium') && fs.statSync('/opt/pw-browsers/chromium').isFile()
    ? '/opt/pw-browsers/chromium' : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const report = { seed:SEED, element:ELEMENT, shots:[], errors:[] };

/* 横倒しの絵を「実機で見える向き」へ戻す(result_shot.mjs と同じやり方)。
   #appRoot は rotate(90deg) で描かれているので、逆向きに90度回して上書きする */
async function unrotateShot(file, w, h, dsf){
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  const p = await browser.newPage({ viewport:{ width:h, height:w }, deviceScaleFactor:dsf });
  await p.setContent(`<style>html,body{margin:0;padding:0;background:#000;overflow:hidden}`
    + `img{position:absolute;top:0;left:0;width:${w}px;height:${h}px;`
    + `transform-origin:0 0;transform:translateY(${w}px) rotate(-90deg)}</style>`
    + `<img src="${dataUrl}">`);
  await p.waitForTimeout(120);
  await p.screenshot({ path: file });
  await p.close();
}

/* ===== ページ側の道具(文字列にしてページへ入れる) ===== */
function pageTools(){
  // 決まった配置になるようシード付き乱数へ差し替える
  window.__shotSeed = (seed)=>{
    let s = (seed>>>0) || 1;
    Math.random = function(){ s = (s*1664525 + 1013904223) >>> 0; return s/4294967296; };
  };
  // 撮影に関係ない重なり(ログインボーナス・告知・チュートリアル)を閉じる
  window.__shotCloseOverlays = ()=>{
    document.querySelectorAll('.mastermon-confirm-overlay, #gachaOverlay, #textInputOverlay, #shareOverlay, #ssrPromoteOverlay, #tutorialLayer')
      .forEach(el=>{ if(el.id !== 'exploreResultOverlay') el.classList.add('hidden'); });
  };
  // 音は鳴らさない(ヘッドレスでは無意味なうえ時間を食う)
  window.__shotMute = ()=>{
    for(const k of ['playSe','bgmSetTrack','bgmUpdateBattleIntensity']){
      try{ if(typeof window[k]==='function') window[k] = function(){}; }catch(e){}
    }
  };
  /* 探検を始める。ここから先はゲーム自身のループを止め、update()/render() を手で回す */
  window.__shotStartExplore = (seed, element)=>{
    window.__shotCloseOverlays();
    window.requestAnimationFrame = function(){ return 0; };
    window.__shotSeed(seed);
    window.__shotMute();
    game.selectedElement = element; game.selectedMastermonKey = null;
    /* 着て出る装備を決めておく(前のカットの工房の結果を持ち越さない)。大角3つ=セット効果が出ている状態。
       武器は持たせない(狙撃の欄が全カットに出ないように。狙撃のカットは自分で持たせる) */
    saveExploreGear({ owned:['horn_head','horn_body','horn_arms'], equip:{ head:'horn_head', body:'horn_body', arms:'horn_arms' } });
    exploreStart();
    // 出発の札とカメラの一周(explore_loot.js)は飛ばす。見たいカット(depart)は自分で始め直す
    if(typeof exploreIntroSkip==='function') exploreIntroSkip();
    // 地図の地形は本番では数フレームに分けて焼く。撮影はフレームを回さないので、ここで焼き切る
    if(typeof exploreMapBakeFinish==='function') exploreMapBakeFinish();
    return { ok: !!game.explore, map: game.activeMapKey, wild: exploreState.wild.length,
             real3d: !!(window.__aramonReal3D), camp: exploreState.camp };
  };
  /* ===== 狙撃(sniper.js)のカット用。的(野生/ボス)から dist 離れた「視線の通る」立ち位置を探し、
     狙撃銃とスコープを持たせて構えた状態で返す(__shotField がそのまま撮る)。
       o.target : 'boss:<bossId>' / 'wild'      o.dist : 的までの距離(ワールド単位)
       o.scope  : 'iron'|'x2'|'x4'|'x8'|null(null=構えない普段のHUD)
       o.ratio  : 照準を置く高さ(0=足元〜1=頭のてっぺん) o.ballistic : 落下を見越して弾がその高さに届く向きにする
       o.fire   : null | 'muzzle'(撃った45ms後) | 'tracer'(飛んでいる途中) | 'hit'(当たった直後) | 'miss'(外れて土煙)
       o.breath : 息止め中にする   o.sway : 揺れの位相(秒)
       o.pose   : ボスの姿勢。'sleep'=伏せて眠る / 既定=立ったまま巣でじっとする
       o.noBreak: 撃っても部位破壊にしない(命中の表示だけを撮る)
     前のカットで撃ったボスは怒って追ってくるので、毎回すべてのボスを巣へ戻して落ち着かせてから撮る */
  window.__shotSnipe = (o)=>{
    if(typeof sniperView === 'object') sniperView.freezeFx = false;
    for(const rec of exploreState.bosses){
      const b = getEntity(rec.id);
      if(!b || !b.alive) continue;
      if(typeof exploreBossDisengaged === 'function') exploreBossDisengaged(b, 'lost');
      if(b.exNestX != null){ b.x = b.exNestX; b.y = b.exNestY; }
      b.exState = 'dormant'; b.exStateUntil = 0; b.exPending = null; b.exCharge = null; b.aiTargetPoint = null;
      b.moveWithMoveUntil = 0; b.hp = b.maxHp; b.exploreAsleep = true;
      b.exBreakDmg = 0;   // 前のカットの命中で部位破壊の手前まで溜まっていると、このカットで壊れて破片が飛ぶ
    }
    exploreState.cine = null;
    if(exploreState.shards) exploreState.shards.length = 0;
    let T = null;
    if(String(o.target).startsWith('boss:')){
      const rec = exploreState.bosses.find(r=> r.bossId === o.target.slice(5));
      T = rec && getEntity(rec.id);
    } else {
      const cands = exploreState.wild.map(r=> getEntity(r.id)).filter(e=> e && e.alive);
      cands.sort((a,b)=> (b.radius||0) - (a.radius||0));
      T = cands[0];
    }
    if(!T) return null;
    const gz = (x,y)=> baseTerrainHeightAt(x,y);
    const H = sniperBodyH(T);
    const los = (x0,y0,z0,x1,y1,z1)=>{
      for(let i=1;i<80;i++){ const t=i/80; if(z0+(z1-z0)*t < gz(x0+(x1-x0)*t, y0+(y1-y0)*t) + 4) return false; }
      const dx=x1-x0, dy=y1-y0, L2=dx*dx+dy*dy;
      // 岩・木・壁・家は見た目の大きさ(3Dの形の高さ・少し太め)で塞ぐかを見る
      for(const q of rocks){
        const t = clamp(((q.x-x0)*dx+(q.y-y0)*dy)/L2, 0, 0.97);
        const vh = Math.max(q.height, q.radius*obstShapeOf(q).h*1.2);
        if(Math.hypot(x0+dx*t-q.x, y0+dy*t-q.y) < q.radius*1.3+40 && z0+(z1-z0)*t < gz(q.x,q.y)+vh) return false;
      }
      // 補給箱も倍率で大きく写って的を隠す
      for(const c of (exploreState.crates || [])){
        const t = clamp(((c.x-x0)*dx+(c.y-y0)*dy)/L2, 0, 0.97);
        if(Math.hypot(x0+dx*t-c.x, y0+dy*t-c.y) < 130 && t < 0.95) return false;
      }
      for(const v of volcanoObstacles){
        const t = clamp(((v.x-x0)*dx+(v.y-y0)*dy)/L2, 0, 1);
        if(Math.hypot(x0+dx*t-v.x, y0+dy*t-v.y) < (v.radius||0)) return false;
      }
      return true;
    };
    let best = null;
    const base = Math.atan2(exploreState.camp.y - T.y, exploreState.camp.x - T.x);
    for(let k=0;k<96 && !best;k++){
      const a = base + (k%2 ? 1 : -1) * Math.ceil(k/2) * (Math.PI/48);
      const x = T.x + Math.cos(a)*o.dist, y = T.y + Math.sin(a)*o.dist;
      if(x<400||y<400||x>WORLD.w-400||y>WORLD.h-400) continue;
      const p = clearObstaclePoint(x, y, 40);
      const ez = gz(p.x,p.y) + AIM_MUZZLE_Z;
      // 他の野生が立ち位置の近く・視線の途中にいると、倍率で拡大されて画面を塞ぐ(的が見えない)ので避ける
      const blocked = entities.some(e=> e.alive && e !== T && !e.isPlayer && (
        Math.hypot(e.x-p.x, e.y-p.y) < 800 ||
        (()=>{ const dx=T.x-p.x, dy=T.y-p.y, L2=dx*dx+dy*dy, t=clamp(((e.x-p.x)*dx+(e.y-p.y)*dy)/L2, 0, 1);
               return t < 0.88 && Math.hypot(p.x+dx*t-e.x, p.y+dy*t-e.y) < (e.radius||30) + 90; })()));
      if(!blocked && los(p.x,p.y,ez, T.x,T.y,(T.z||gz(T.x,T.y)) + H*0.55) && los(p.x,p.y,ez, T.x,T.y,(T.z||gz(T.x,T.y)) + H*0.9)) best = p;
    }
    if(!best) best = clearObstaclePoint(T.x + Math.cos(base)*o.dist, T.y + Math.sin(base)*o.dist, 40);
    const at = { x:best.x, y:best.y, yaw:Math.atan2(T.y-best.y, T.x-best.x), pitch:0.08, warm:0 };
    at.after = ()=>{
      const me = player;
      /* o.fire がある(=実際に命中させる)ボスのカットは、的を dormant のままにしない。
         dormant/home のボスは1発当てるだけで exploreOnDamaged が咆哮(intro)を起こし、
         body.explore-cine が付いて操作ボタン・スティック・ミニマップ・目標の枠が消える(style.css)。
         これは狙撃側の不具合ではなく、的の状態を作らずに撃たせているこの撮影ツールの都合なので、
         既存の boss_* カット(このファイル上部)と同じ約束(exploreBossEngaged+exState='fight')で
         先に「もう戦闘中」にしてから撃つ(批評6巡目: 撃つとレンズが1.9倍に広がりボタンが消える件)。 */
      const keepFight = T.isExploreBoss && o.fire && o.pose !== 'sleep';
      if(keepFight){
        exploreBossEngaged(T); T.exState = 'fight'; T.exPending = null; T.exCharge = null; T.exploreAsleep = false;
      } else {
        T.exploreAsleep = true; T.exState = T.isExploreBoss ? (o.pose === 'sleep' ? 'sleep' : 'dormant') : T.exState;
      }
      // noBreak: この1発で部位破壊にしない(破片の演出=ボス担当 が重なり、弱点命中の表示そのものが見えなくなる)
      if(o.noBreak) T.exBreakDmg = -1e9;
      if(exploreState.banners) exploreState.banners.length = 0;   // 前のカットの札を持ち越さない
      if(exploreState.fx) exploreState.fx.length = 0;
      const tx = T.x, ty = T.y;
      sniperGive(me, 'longbow');
      sniperAttachScope(me, o.scope || 'x8');
      projectiles.length = 0; particles.length = 0;
      sniperResetState();
      const w = SNIPER_WEAPONS.longbow, sc = SNIPER_SCOPES[o.scope || 'x8'];
      // 狙う高さは的の「今の姿勢」の背で測る(眠らせて伏せた後。立った背で測ると頭の上を狙ってしまう)
      const Hn = sniperBodyH(T);
      const eyeZ = me.z + AIM_MUZZLE_Z, d = Math.hypot(tx-me.x, ty-me.y), tz = (T.z||0) + Hn*(o.ratio==null ? 0.6 : o.ratio);
      at.yaw = Math.atan2(ty-me.y, tx-me.x);
      if(o.ballistic){
        const b = sniperBallistics(w), tt = d / w.speed;
        at.pitch = Math.atan(b.zero - ((tz - eyeZ + 0.5*b.grav*tt*tt) / d));
      } else at.pitch = -Math.atan2(tz - eyeZ, d);
      if(!o.scope){ at.pitch = 0.12; return; }
      sniperView.ads = true; sniperView.blend = 1; sniperView.logMag = Math.log(sc.mag);
      sniperView.swayT = o.sway || 0;
      if(o.breath){ sniperView.breathHeld = true; sniperView.breath = 0.55; }
      if(o.fire){
        camState.yaw = at.yaw; camState.pitch = at.pitch;
        sniperView.offYaw = 0; sniperView.offPitch = 0; sniperView.amp = 0;
        // 撃つ前の1コマ(距離計・弱点の先読みが入った状態で撃つ=実際の遊びと同じ)
        sniperView.lastMs = performance.now(); sniperFrame(); sniperFrameEnd();
        sniperView.amp = 0; sniperView.offYaw = 0; sniperView.offPitch = 0;
        sniperFire(me);
        const N = o.fire === 'muzzle' ? 2 : (o.fire === 'tracer' ? 26 : 90);
        /* keepFight: N=90近く進める間、的のボスは巣からのリーシュ判定(fight→home→dormant)や
           HP割合の怒り・逃走判定が毎フレーム動く。弾が届くころに dormant へ戻っていると、
           命中の瞬間に exploreOnDamaged が「まだ気づいていなかった的」として咆哮(intro)を起こし、
           body.explore-cine で操作ボタン・スティック・ミニマップ・目標の枠が消える(批評6巡目)。
           毎フレーム state を張り直して、この1発の間だけは確実に「もう戦闘中」のままにする。 */
        for(let i=0;i<N;i++){
          update(1/60); T.x = tx; T.y = ty; me.x = at.x; me.y = at.y;
          if(keepFight){ T.exState = 'fight'; T.exPending = null; T.exCharge = null; T.exploreAsleep = false; }
          if((o.fire === 'hit' || o.fire === 'miss') && sniperView.fx.some(f=> f.kind==='hit' || f.kind==='impact')){
            for(let j=0;j<8;j++){ update(1/60); T.x=tx; T.y=ty; if(keepFight){ T.exState='fight'; T.exPending=null; T.exCharge=null; } }
            break;
          }
        }
        // 撮影は1枚に時間がかかるので、演出の時計はこちらで決める(muzzle=45ms後 / それ以外=落ち着いた後)
        // muzzle は 15ms×2コマ(閃光の2コマ目=白い芯つき)だけ反動のばね・閃光を進めてから撮る
        if(o.fire === 'muzzle'){ for(let i=0;i<2;i++){ sniperView.lastMs = performance.now() - 15; sniperFrame(); sniperFrameEnd(); } }
        /* 着弾の土煙(drawScopeImpacts)は`up`(0〜0.07秒で立ち上がる)にアルファを掛けるので、
           v.fx[].t が一度も進んでいない(sniperFrame は render() の中でしか呼ばれず、update() では進まない)
           t=0のまま撃った瞬間を撮ると土煙が透明で写る(=批評「外れたときの土煙が見えない」)。
           miss は 15ms×6コマ(=90ms)だけ進めて、煙が育った所を撮る */
        if(o.fire === 'miss'){ for(let i=0;i<6;i++){ sniperView.lastMs = performance.now() - 15; sniperFrame(); sniperFrameEnd(); } }
        sniperView.lastMs = 1234.5;
        if(o.fire !== 'muzzle'){ sniperView.flash = 0; sniperView.flashN = null; sniperView.smoke.length = 0; sniperView.recoil = sniperView.recoilV = 0; sniperView.recoilX = sniperView.recoilXV = 0; }
        // 撮るまでに描き直すコマ(__shotField・settleFrame)で演出の時計が進まないよう止める(閃光・命中の数字をその瞬間のまま写す)
        sniperView.freezeFx = true;
        at.yaw = camState.yaw; at.pitch = camState.pitch;
      } else sniperView.lastMs = 1234.5;
    };
    return at;
  };
  /* 1カットぶんの舞台を整える。プレイヤーを置き、warm 秒だけ時間を進め、カメラを据えて描く */
  window.__shotField = (atSrc)=>{
    const at = (new Function('return (' + atSrc + ')'))()();
    if(!at) return { ok:false, reason:'そのカットの対象が無い' };
    if(typeof exploreCloseMap==='function') exploreCloseMap();   // 前のカットで開いた全体地図を持ち越さない
    player.x = at.x; player.y = at.y; player.z = baseTerrainHeightAt(at.x, at.y);
    player.hp = player.maxHp; player.alive = true;
    player.exploreInvulnUntil = matchTime + 99;   // 撮影中に倒れないように(見た目には出ない)
    // ただし無敵のあいだは野生・ボスが相手にしない(気づかない・巣へ戻る)ので、それを撮るカットは外す
    if(at.vuln) player.exploreInvulnUntil = 0;
    camState.yaw = at.yaw; camState.pitch = at.pitch;
    player.facingAngle = at.yaw;
    const steps = Math.round((at.warm || 0) * 30);
    for(let i=0;i<steps;i++){
      if(game.over) break;
      camState.yaw = at.yaw; camState.pitch = at.pitch;
      update(1/30);
      // 野生の近くを撮るときは相手を画面に入れ続ける(寄ってくるので向きを追い直す)
      if(at.lookAt!=null){ const t = getEntity(at.lookAt); if(t) at.yaw = Math.atan2(t.y-player.y, t.x-player.x); }
      player.x = at.x; player.y = at.y;
    }
    // 撮る直前に状態を作る(ボスの咆哮・予告など)。作ったあとに進めた時間ぶんも自機は据え置く
    if(typeof at.after === 'function'){
      at.after();
      player.x = at.x; player.y = at.y; player.z = baseTerrainHeightAt(at.x, at.y);
      if(at.lookAt!=null){ const t = getEntity(at.lookAt); if(t) at.yaw = Math.atan2(t.y-player.y, t.x-player.x); }
    }
    // keepCam: ゲーム自身が動かしたカメラのまま撮る(ボス登場の向き直り・寄りを写すため)
    if(!at.keepCam){ camState.yaw = at.yaw; camState.pitch = at.pitch; }
    camSnap.active = false;
    updateCamera();
    const realNow = performance.now.bind(performance);
    performance.now = ()=> 1234.5;
    try{ for(let i=0;i<3;i++) render(); }
    finally{ performance.now = realNow; }
    const reg = exploreRegionAt(player.x, player.y);
    return { ok:true, x:Math.round(player.x), y:Math.round(player.y), yaw:+at.yaw.toFixed(3), pitch:at.pitch,
             region: reg ? reg.id : null, alive: entities.filter(e=>e.alive).length };
  };
}

/* カメラが大きく動いた直後(視点演出・カメラの一周・ワープ)の1枚目は、3D層の描画が
   撮影に間に合わず霞の色一色で写ることがある(ゲームは毎フレーム描き直すので遊びでは起きない)。
   撮る前にもう1回描いて揃える。時間は止めてあるので絵の中身は変わらない */
async function settleFrame(page){
  for(let i=0;i<2;i++){
    await page.evaluate(()=>{ try{ if(game.started && typeof render==='function') render(); }catch(e){} });
    await page.waitForTimeout(250);
  }
}
async function shoot(page, file, vp){
  await page.screenshot({ path:file, timeout:180000 });   // ソフトウェア描画で重い画は30秒を超えることがある
  if(vp.isMobile && vp.h > vp.w) await unrotateShot(file, vp.w, vp.h, vp.dsf);   // 縦持ちだけ回して戻す
}

/* ===== --measure: 探検のHUDの実測(撮影はしない) =====
   縦持ち 375x667 / 375x812 / 414x896 と横持ち 667x375 / 812x375 / 1624x750 で探検を始め、
   通常(hud)・ボス戦(hud_boss)・全体地図(map) の3つの状態で次を数字で出す:
     ①探検のHUDの各欄の位置と大きさ(#appRoot の論理座標)と、#appRoot の外へ出ていないか
     ②探検のHUDが他のHUD(自分の欄・ミニマップ・回転・狙撃・FIRE…)に重なっていないか
     ③文字サイズ(縦持ちと横持ちで同じ論理サイズの組を突き合わせる。跳ねていたら不具合)
     ④ボスの帯(キャンバスに描く)の下端とボス本体の上端 */
if(flag('measure')){
  const SIZES = [
    { name:'port667', w:375, h:667, mob:true }, { name:'port812', w:375, h:812, mob:true }, { name:'port896', w:414, h:896, mob:true },
    { name:'land667', w:667, h:375, mob:false }, { name:'land812', w:812, h:375, mob:false }, { name:'land1624', w:1624, h:750, mob:false },
  ];
  const MINE = ['exploreHud','expBossCanvas','expObjPanel','expRegionCard','killFeed','expMapBox','expMapCanvas','expMapSide','expMapCloseBtn'];
  const OTHERS = ['topLeft','topRight','expLootFeed','turnLeftBtn','turnRightBtn','sniperAdsBtn','sniperAmmoChip','fireBtn','dashBtn','movePanel','joystickBase','pingBtn'];
  const FONTS = ['.exp-obj-time','.exp-obj-text','.exp-obj-sub','.exp-obj-chip','.exp-rc-name','.exp-map-title','.exp-lg-row','.exp-map-close'];
  const all = {};
  let bad = 0;
  for(const sz of SIZES){
    const page = await browser.newPage({ viewport:{ width:sz.w, height:sz.h }, screen:{ width:sz.w, height:sz.h },
      deviceScaleFactor:2, isMobile:sz.mob, hasTouch:sz.mob });
    const errs = [];
    page.on('pageerror', e=> errs.push(String(e)));
    await page.addInitScript(()=>{ try{ localStorage.setItem('aramon_tutorial_v1', JSON.stringify({ state:'done' })); }catch(e){} });
    await page.goto(`${ORIGIN}/index.html`, { waitUntil:'load' });
    await page.waitForFunction(()=> typeof exploreStart==='function', null, { timeout:30000 });
    await page.waitForFunction(()=>{ const t=document.getElementById('titleTapStart'); return t && !t.classList.contains('hidden'); }, null, { timeout:30000 });
    await page.evaluate(()=> document.getElementById('titleScreen').click());
    await page.waitForTimeout(500);
    await page.evaluate(pageTools);
    await page.evaluate(([s, el])=> window.__shotStartExplore(s, el), [SEED, ELEMENT]);
    // 狙撃銃を持った状態(右列に「狙撃」ボタンが出る=いちばん詰まった形)
    await page.evaluate(()=>{ if(typeof sniperGive==='function') try{ sniperGive(player, 'longbow'); }catch(e){} });
    const res = {};
    for(const cutName of ['hud','hud_boss','hud_beacon','map']){
      const c = CUTS.find(x=> x.name === cutName);
      await page.evaluate((src)=> window.__shotField(src), c.at.toString());
      await page.waitForTimeout(250);
      res[cutName] = await page.evaluate(([mine, others, fonts])=>{
        const root = document.getElementById('appRoot');
        const rectOf = (el)=>{ let x=0, y=0, n=el; while(n && n!==root){ x+=n.offsetLeft; y+=n.offsetTop; n=n.offsetParent; } return { x, y, w:el.offsetWidth, h:el.offsetHeight }; };
        const vis = (el)=>{ if(!el) return false; if(el.offsetWidth===0 || el.offsetHeight===0) return false;
          for(let n=el; n && n!==document.body; n=n.parentElement){ const cs=getComputedStyle(n); if(cs.display==='none' || cs.visibility==='hidden' || +cs.opacity===0) return false; } return true; };
        const RW = root.offsetWidth, RH = root.offsetHeight;
        const out = { root:[RW, RH], rects:{}, outside:[], overlap:[], fonts:{} };
        const R = {};
        for(const id of [...mine, ...others]){ const el = document.getElementById(id); if(vis(el)) R[id] = rectOf(el); }
        for(const id of mine){ if(!R[id]) continue; const r = R[id]; out.rects[id] = [r.x, r.y, r.w, r.h].map(Math.round).join(',');
          const over = Math.max(-r.x, -r.y, r.x + r.w - RW, r.y + r.h - RH);
          if(over > 0.5) out.outside.push(`${id} ${Math.round(over)}px`); }
        const hit = (a, b)=> Math.min(a.x+a.w, b.x+b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y+a.h, b.y+b.h) - Math.max(a.y, b.y) > 1;
        const mapOpen = !!R.expMapBox;
        for(const a of mine){ if(!R[a] || a.startsWith('expMap')) continue;
          for(const b of [...mine, ...others]){ if(a===b || !R[b] || b.startsWith('expMap')) continue;
            if(mine.indexOf(b) >= 0 && mine.indexOf(b) < mine.indexOf(a)) continue;
            // ボスの帯はボス戦の間だけ方位バーの下の段に入る(わざと重ねている。方位バーはその段を空けて描く)
            if((a === 'exploreHud' && b === 'expBossCanvas') || (a === 'expBossCanvas' && b === 'exploreHud')) continue;
            if(hit(R[a], R[b])) out.overlap.push(`${a}×${b}`); } }
        for(const f of fonts){ const el = document.querySelector(f); if(vis(el)) out.fonts[f] = parseFloat(getComputedStyle(el).fontSize); }
        // ボスの帯(キャンバス)とボス本体
        const fb = (typeof exploreFocusBoss==='function') ? exploreFocusBoss() : null;
        /* ボスの帯とボス本体(ボス担当の exploreBossScreenRect)が重なっていないか。帯は横に g.x〜g.x+g.w・縦に g.top〜g.bottom */
        if(fb && !mapOpen){
          const g = exploreBossHudGeom(fb);
          const r = (typeof exploreBossScreenRect==='function' ? exploreBossScreenRect(fb) : null) || exploreBossRect(fb);
          let over = 0;
          if(r && Math.min(g.x + g.w, r.x + r.w) - Math.max(g.x, r.x) > 1) over = Math.max(0, Math.round(Math.min(g.bottom, r.y + r.h) - Math.max(g.top, r.y)));
          out.boss = { hudTop:Math.round(g.top), hudBottom:Math.round(g.bottom), full:g.full, bodyTop: r ? Math.round(r.y) : null, bodyBottom: r ? Math.round(r.y + r.h) : null, over };
        }
        out.objRows = document.querySelectorAll('#expObjRows .exp-obj-row').length;
        out.objSub = !!document.querySelector('#expObjRows .exp-obj-sub');
        out.killFeedOff = document.getElementById('hud').classList.contains('exp-kf-off');
        /* 探検の技パネル(#movePanel。右下へ移した)が自機の外枠(explorePlayerRect。ボス担当の関数)と
           重なっていないかを数字で出す(第3周の指摘: 縦持ち3サイズで確かめること) */
        if(R.movePanel && !mapOpen && typeof explorePlayerRect === 'function'){
          const pr = explorePlayerRect();
          if(pr){
            const mp = R.movePanel;
            const ox = Math.min(mp.x + mp.w, pr.x + pr.w) - Math.max(mp.x, pr.x);
            const oy = Math.min(mp.y + mp.h, pr.y + pr.h) - Math.max(mp.y, pr.y);
            out.moveVsSelf = { move:[mp.x, mp.y, mp.w, mp.h].map(Math.round), self:[pr.x, pr.y, pr.w, pr.h].map(Math.round),
              overlapPx: (ox > 0 && oy > 0) ? Math.round(Math.min(ox, oy)) : 0 };
          }
        }
        return out;
      }, [MINE, OTHERS, FONTS]);
      if(cutName === 'map') await page.evaluate(()=> exploreCloseMap());
    }
    if(errs.length) res.errors = errs.slice(0, 3);
    all[sz.name] = res;
    await page.close();
  }
  // 表にして出す
  for(const [name, res] of Object.entries(all)){
    console.log(`\n== ${name} (論理 ${res.hud ? res.hud.root.join('x') : '?'}) ==`);
    for(const [cut, r] of Object.entries(res)){
      if(cut === 'errors'){ console.log('  JSエラー:', r.join(' / ')); bad++; continue; }
      console.log(`  [${cut}] 目標の行=${r.objRows}${r.objSub ? '(2行目あり)' : ''} 撃破ログ=${r.killFeedOff ? '出さない' : '出す'}`);
      for(const [id, v] of Object.entries(r.rects)) console.log(`    ${id.padEnd(15)} ${v}`);
      if(r.boss){
        console.log(`    ボスの帯 y=${r.boss.hudTop}〜${r.boss.hudBottom} (${r.boss.full ? '二つ名あり' : '1行'}) / ボス本体 y=${r.boss.bodyTop}〜${r.boss.bodyBottom}`);
        if(r.boss.over > 0){ bad++; console.log(`    ✗ ボスの帯がボス本体に ${r.boss.over}px 重なっている`); } else console.log('    ✓ ボスの帯はボス本体に重なっていない');
      }
      if(r.moveVsSelf){
        console.log(`    技パネル ${r.moveVsSelf.move.join(',')} / 自機の外枠 ${r.moveVsSelf.self.join(',')}`);
        if(r.moveVsSelf.overlapPx > 0){ bad++; console.log(`    ✗ 技パネルが自機の外枠に ${r.moveVsSelf.overlapPx}px 重なっている`); }
        else console.log('    ✓ 技パネルは自機の外枠に重なっていない');
      }
      if(r.outside.length){ bad++; console.log(`    ✗ #appRoot の外: ${r.outside.join(', ')}`); } else console.log('    ✓ #appRoot の外へ出ていない');
      if(r.overlap.length){ bad++; console.log(`    ✗ 重なり: ${r.overlap.join(', ')}`); } else console.log('    ✓ 他のHUDと重なっていない');
      console.log(`    文字: ${Object.entries(r.fonts).map(([k, v])=> `${k}=${v}px`).join(' ')}`);
    }
  }
  // 持ち方で文字サイズが変わっていないか(同じ論理サイズの 縦持ち↔横持ち)
  for(const [p, l] of [['port667','land667'], ['port812','land812']]){
    for(const cut of ['hud','map']){
      const a = all[p] && all[p][cut], b = all[l] && all[l][cut];
      if(!a || !b) continue;
      const diff = Object.keys(a.fonts).filter(k=> b.fonts[k] != null && Math.abs(a.fonts[k] - b.fonts[k]) > 0.01);
      if(diff.length){ bad++; console.log(`✗ 文字サイズが持ち方で違う ${p}↔${l} [${cut}]: ${diff.map(k=> `${k} ${a.fonts[k]}↔${b.fonts[k]}`).join(', ')}`); }
      else console.log(`✓ 文字サイズは持ち方で同じ ${p}↔${l} [${cut}](${Object.keys(a.fonts).length}種)`);
    }
  }
  await browser.close(); server.close();
  console.log(bad ? `\n== 指摘 ${bad} 件 ==` : '\n== HUDの実測: 指摘なし ==');
  process.exit(bad ? 1 : 0);
}

for(const vpName of vpNames){
  const vp = VIEWPORTS[vpName];
  if(!vp){ console.warn(`知らない画面: ${vpName}`); continue; }
  const page = await browser.newPage({
    viewport:{ width:vp.w, height:vp.h }, screen:{ width:vp.w, height:vp.h },
    deviceScaleFactor:vp.dsf, isMobile:vp.isMobile, hasTouch:vp.isMobile,
  });
  const errs = [];
  // ソフトウェア描画では1コマの描画・撮影に30秒を超えることがある(スコープの2倍の解像度の窓など)
  page.setDefaultTimeout(180000);
  page.on('pageerror', e=> errs.push(String(e)));
  await page.addInitScript(()=>{
    try{ localStorage.setItem('aramon_tutorial_v1', JSON.stringify({ state:'done' })); }catch(e){}
  });
  await page.goto(`${ORIGIN}/index.html`, { waitUntil:'load' });
  await page.waitForFunction(()=> typeof exploreStart==='function' && typeof setLobbyMode==='function', null, { timeout:30000 });
  await page.waitForFunction(()=>{ const t=document.getElementById('titleTapStart'); return t && !t.classList.contains('hidden'); }, null, { timeout:30000 });
  await page.evaluate(()=> document.getElementById('titleScreen').click());
  await page.waitForTimeout(700);
  // リアルマップの3D層(ESモジュール)の読み込みを待つ。来なければ2Dのまま撮る
  await page.waitForFunction(()=> !!window.__aramonReal3D, null, { timeout:20000 }).catch(()=> report.errors.push(`${vpName}: 3D層が読み込まれなかった`));
  await page.evaluate(pageTools);
  await page.evaluate((el)=>{
    game.selectedElement = el; game.selectedMastermonKey = null;
    if(typeof updatePlayButtonsEnabled==='function') updatePlayButtonsEnabled();
    if(typeof refreshLobby==='function') refreshLobby();
  }, ELEMENT);

  // ロビー側のカット(ループを止める前に撮る)
  for(const c of cuts.filter(c=>c.kind==='lobby')){
    await page.evaluate(()=> window.__shotCloseOverlays());
    await page.evaluate(`(${c.prep.toString()})()`);
    await page.waitForTimeout(c.waitMs || 600);
    const file = path.join(OUT, `${c.name}_${vpName}.png`);
    await shoot(page, file, vp);
    report.shots.push({ cut:c.name, vp:vpName, file:path.relative(ROOT, file) });
    console.log(`撮影 ${c.name}_${vpName}`);
  }
  await page.evaluate(()=> window.__shotCloseOverlays());

  // 探検の中のカット
  const fieldCuts = cuts.filter(c=>c.kind==='field');
  const resultCuts = cuts.filter(c=>c.kind==='result');
  if(fieldCuts.length || resultCuts.length){
    const st = await page.evaluate(([s, el])=> window.__shotStartExplore(s, el), [SEED, ELEMENT]);
    if(!st.ok){ report.errors.push(`${vpName}: 探検が始まらなかった`); }
    report.start = st;
    for(const c of fieldCuts){
      const info = await page.evaluate((src)=> window.__shotField(src), c.at.toString());
      if(!info || !info.ok){ report.errors.push(`${c.name}_${vpName}: ${info && info.reason || '失敗'}`); continue; }
      await page.waitForTimeout(c.waitMs || 150);
      await settleFrame(page);
      const file = path.join(OUT, `${c.name}_${vpName}.png`);
      await shoot(page, file, vp);
      const shotRec = { cut:c.name, vp:vpName, file:path.relative(ROOT, file), cam:info };
      /* 検査用: 狙撃スコープの情報の枠(sniperView.__dbgInfoRect)がレンズの円(__dbgLens)へ
         食い込んでいないかを数字で出す(批評5巡目: 「レンズの内側には何も置かない」を検査する)。
         矩形と円の最短距離 >= 円の半径なら重ならない。ゲームの見た目には出ない値。 */
      if(c.name.startsWith('sniper_')){
        shotRec.snMetric = await page.evaluate(()=>{
          const v = (typeof sniperView === 'object') ? sniperView : null;
          const r = v && v.__dbgInfoRect, l = v && v.__dbgLens;
          if(!r || !l) return null;
          const clampN = (x, a, b)=> Math.max(a, Math.min(b, x));
          const cx = clampN(l.x, r[0], r[2]), cy = clampN(l.y, r[1], r[3]);
          const d = Math.hypot(l.x - cx, l.y - cy);
          return { rect:[Math.round(r[0]),Math.round(r[1]),Math.round(r[2]),Math.round(r[3])],
                   lens:{ x:Math.round(l.x), y:Math.round(l.y), r:Math.round(l.r) },
                   dist:Math.round(d), overlapPx: Math.round(l.r - d),
                   // HUDが消えていないか(body.explore-cine。的をdormantのまま撃ってボスの咆哮を
                   // 誤って起こすと付く。批評6巡目でこれが起きた=keepFightで防いでいる)
                   bodyCine: document.body.classList.contains('explore-cine'),
                   cine: (typeof exploreState==='object' && exploreState.cine) ? exploreState.cine.kind : null,
                   hudRects: (typeof snHudRects === 'function') ? snHudRects() : null };
        });
      }
      report.shots.push(shotRec);
      console.log(`撮影 ${c.name}_${vpName}  (${info.region||'キャンプ'} / 生存${info.alive})`);
    }
    // 結果画面は1回で試合が終わるので、カットごとに探検を始め直す
    for(const c of resultCuts){
      await page.evaluate(([s, el])=> window.__shotStartExplore(s, el), [SEED, ELEMENT]);
      await page.evaluate(()=> window.__shotField(`()=>({ x:exploreState.spawn.x, y:exploreState.spawn.y, yaw:-Math.PI/2, pitch:0.14, warm:0 })`));
      await page.evaluate(`(${c.prep.toString()})()`);
      // 終わりの札(フィールドの「帰還成功」)を待たずに報酬画面へ。札そのものを撮るカットは keepOutro
      if(!c.keepOutro) await page.evaluate(()=>{ if(typeof exploreOutroSkip==='function') exploreOutroSkip(); });
      /* 結果画面のカードは1枚ずつ順に出る(CSSの動き)。撮影はゲームのループを止めていて
         動きの進み方が撮るたびに変わるので、終わりのある動きは最後まで進めて「出そろった姿」で撮る
         (金のカードに光が横切るような繰り返しの動きはそのまま) */
      await page.evaluate(()=>{
        const ov = document.getElementById('exploreResultOverlay');
        if(!ov) return;
        for(const a of ov.getAnimations({ subtree:true })){
          const t = a.effect && a.effect.getTiming && a.effect.getTiming();
          if(t && t.iterations !== Infinity){ try{ a.finish(); }catch(e){} }
        }
      });
      await page.waitForTimeout(500);
      await settleFrame(page);
      const file = path.join(OUT, `${c.name}_${vpName}.png`);
      await shoot(page, file, vp);
      report.shots.push({ cut:c.name, vp:vpName, file:path.relative(ROOT, file) });
      console.log(`撮影 ${c.name}_${vpName}`);
    }
  }
  for(const e of errs) report.errors.push(`${vpName}: ${e.slice(0, 200)}`);
  await page.close();
}

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
server.close();
console.log(`\n出力: ${OUT}  (${report.shots.length}枚)`);
if(report.errors.length){
  console.log('エラー:');
  for(const e of report.errors.slice(0, 12)) console.log('  ' + e);
}
