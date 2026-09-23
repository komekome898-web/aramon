/* 探検モードの見た目をヘッドレスChromiumで撮る開発用ツール(ゲーム本体には読み込まない)。
   **ゲームの遊びを確かめるものではない。** 批評家が「探検モードがどう見えるか」を
   毎回同じ条件の画像で採点するための撮影台。

   使い方:
     node tools/explore_shot.mjs --out shots/explore            全カット × 横持ち・縦持ち
     node tools/explore_shot.mjs --out shots/x --cuts camp,wild  カットを絞る
     node tools/explore_shot.mjs --out shots/x --vps land        横持ちだけ(land / port)
     node tools/explore_shot.mjs --list                          カットの一覧を出して終わる
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
  { name:'forge', kind:'lobby', desc:'工房: 装備の一覧(作れる/素材不足/装着中)と詳細',
    prep: ()=>{
      saveExploreStash({ meadow_fiber:14, jungle_vine:9, frost_shard:12, volcano_ore:15, boss_horn:5, boss_fang:2, boss_scale:3, apex_core:3 });
      saveExploreGear({ owned:['scout_head','horn_body','horn_arms'], equip:{ head:'scout_head', body:'horn_body', arms:'horn_arms' } });
      setLobbyMode('explore', { save:false }); refreshLobby();
      exploreForgeState.filter = 'all'; exploreForgeState.sel = 'apex_body';
      openExploreForge();
    } },
  { name:'forge_weapon', kind:'lobby', desc:'工房: 武器で絞り込み・素材が足りない武器の詳細',
    prep: ()=>{
      saveExploreStash({ meadow_fiber:4, frost_shard:3, volcano_ore:2, boss_fang:1 });
      saveExploreGear({ owned:['scout_head'], equip:{ head:'scout_head' } });
      exploreForgeState.filter = 'weapon'; exploreForgeState.sel = 'frost_rifle';
      openExploreForge();
    } },
  { name:'forge_done', kind:'lobby', desc:'工房: 作ったときの演出(槌→火花→完成の光。金)', waitMs:2300,
    prep: ()=>{
      saveExploreStash({ apex_core:3, boss_scale:3, volcano_ore:9 });
      saveExploreGear({ owned:[], equip:{} });
      exploreForgeState.filter = 'all'; exploreForgeState.sel = 'apex_body';
      openExploreForge();
      exploreForgeCraft('apex_body');
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
  ...[
    { name:'boss_intro', boss:'gandrock', dist:1150, desc:'ボス登場(咆哮・名前の札・画面揺れ)',
      after: `exploreBossStartRoar(B, 'intro'); for(let i=0;i<14;i++) update(1/30);` },
    { name:'boss_telegraph', boss:'volgreim', dist:1100, desc:'ボスの大技の予告(扇のブレス。地面の印とHPバーの技名)',
      after: `exploreBossEngaged(B); B.exState='fight'; B.exPending=null; exploreBossBeginAttack(B, exploreBossDef(B), player, 'breath'); for(let i=0;i<8;i++) update(1/30);` },
    { name:'boss_meteor', boss:'galvark', dist:1000, desc:'ボスの大技の予告(流星群。時間差で落ちる円)',
      after: `exploreBossEngaged(B); B.exState='fight'; B.exRage=true; B.hp=B.maxHp*0.42; B.exPending=null; exploreBossBeginAttack(B, exploreBossDef(B), player, 'rain'); for(let i=0;i<14;i++) update(1/30);` },
    { name:'boss_rage', boss:'galvark', dist:900, desc:'怒り状態(赤いオーラ・色味・咆哮・「怒り」の札)',
      after: `exploreBossEngaged(B); B.exState='fight'; B.hp=B.maxHp*0.46; B.exHpLag=0.62; B.exRage=true; exploreBossStartRoar(B, 'rage'); for(let i=0;i<12;i++) update(1/30);` },
    { name:'boss_break', boss:'gandrock', dist:1000, desc:'部位破壊の瞬間(転倒・星・ひびの印・素材が弾ける)',
      after: `exploreBossEngaged(B); B.exState='fight'; B.hp=B.maxHp*0.63; B.exHpLag=0.7; exploreBossBreakPart(B, exploreBossDef(B)); for(let i=0;i<10;i++) update(1/30);` },
    { name:'boss_hunt', boss:'gidravers', dist:1300, desc:'頂点ボスの討伐の瞬間(スローモーション・討伐完了・大量の素材)',
      after: `exploreBossEngaged(B); B.exState='fight'; B.hp=1; applyDamage(B, 50, player, {}); for(let i=0;i<40;i++) update(1/30);` },
  ].map(c=>({
    name:c.name, kind:'field', desc:c.desc,
    at: new Function(`
      const rec = exploreState.bosses.find(r=> r.bossId===${JSON.stringify(c.boss)});
      const B = rec && getEntity(rec.id); if(!B) return null;
      const a = Math.atan2(exploreState.camp.y - B.y, exploreState.camp.x - B.x);
      const p = clearObstaclePoint(B.x + Math.cos(a)*${c.dist}, B.y + Math.sin(a)*${c.dist}, 60);
      B.exState = 'fight'; B.exploreAsleep = false; B.facingAngle = Math.atan2(p.y-B.y, p.x-B.x);
      exploreState.banners.length = 0; exploreState.fx.length = 0;   // 前のカットの札を持ち越さない
      return { x:p.x, y:p.y, yaw:Math.atan2(B.y-p.y, B.x-p.x), pitch:0.16, warm:0.4, lookAt:B.id, vuln:true,
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
  { name:'result', kind:'result', desc:'帰還(exploreFinish(\'return\'))後の結果画面',
    prep: ()=>{
      const pick = ['meadow_fiber','meadow_honey','frost_shard','volcano_heart','jungle_relic','boss_horn','apex_core'];
      pick.forEach((k, i)=> exploreGainMaterial(k, 1 + (i*2)%5, null, null));
      exploreState.kills = 12;
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
};

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
const vpNames  = opt('vps', '')  ? opt('vps','').split(',').map(s=>s.trim()).filter(Boolean)  : Object.keys(VIEWPORTS);
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
    exploreStart();
    return { ok: !!game.explore, map: game.activeMapKey, wild: exploreState.wild.length,
             real3d: !!(window.__aramonReal3D), camp: exploreState.camp };
  };
  /* 1カットぶんの舞台を整える。プレイヤーを置き、warm 秒だけ時間を進め、カメラを据えて描く */
  window.__shotField = (atSrc)=>{
    const at = (new Function('return (' + atSrc + ')'))()();
    if(!at) return { ok:false, reason:'そのカットの対象が無い' };
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
    camState.yaw = at.yaw; camState.pitch = at.pitch;
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

async function shoot(page, file, vp){
  await page.screenshot({ path:file });
  if(vp.isMobile) await unrotateShot(file, vp.w, vp.h, vp.dsf);
}

for(const vpName of vpNames){
  const vp = VIEWPORTS[vpName];
  if(!vp){ console.warn(`知らない画面: ${vpName}`); continue; }
  const page = await browser.newPage({
    viewport:{ width:vp.w, height:vp.h }, screen:{ width:vp.w, height:vp.h },
    deviceScaleFactor:vp.dsf, isMobile:vp.isMobile, hasTouch:vp.isMobile,
  });
  const errs = [];
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
      const file = path.join(OUT, `${c.name}_${vpName}.png`);
      await shoot(page, file, vp);
      report.shots.push({ cut:c.name, vp:vpName, file:path.relative(ROOT, file), cam:info });
      console.log(`撮影 ${c.name}_${vpName}  (${info.region||'キャンプ'} / 生存${info.alive})`);
    }
    // 結果画面は1回で試合が終わるので、カットごとに探検を始め直す
    for(const c of resultCuts){
      await page.evaluate(([s, el])=> window.__shotStartExplore(s, el), [SEED, ELEMENT]);
      await page.evaluate(()=> window.__shotField(`()=>({ x:exploreState.spawn.x, y:exploreState.spawn.y, yaw:-Math.PI/2, pitch:0.14, warm:0 })`));
      await page.evaluate(`(${c.prep.toString()})()`);
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
