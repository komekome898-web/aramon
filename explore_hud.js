/* =====================================================================
   探検モード(game.explore)― HUD と 音の橋渡し
   ・方位バー(APEX)   … 上部中央 #exploreHud のキャンバス。目盛り・照準の先の方位角・
                         帰還ビーコン・ボスの巣・近くの補給箱・追ってくる野生を載せる。距離は m(PING_UNITS_PER_M)
   ・目標パネル        … 右上 #expObjPanel(ミニマップの下)。残り時間・力尽き・所持数と、目標の行(優先を強調)
   ・地域の名前の札    … #expRegionCard(地域に入ったとき方位バーの下に出る)
   ・探検のミニマップ  … render.js の renderMinimap が game.explore のときだけここ(exploreRenderMinimap)へ来る。
                         地形(地域の色・尾根・峡谷・道・水・溶岩)は1回だけ焼いて、毎フレームは切り出して貼るだけ
   ・全体地図          … ミニマップをタップで開く #expMapOverlay(どこを押しても閉じる。試合は止めない)
   ・音                … 地域の重み・ボス戦の段階を毎フレーム audio.js(bgmExploreSetMood)へ渡す。
                         曲そのものと環境音は audio.js。群れに気づかれた音もここから鳴らす
   **探検以外では何もしない。** 入口はすべて game.explore を見てから動く(既存のHUD・ミニマップ・BGMは変えない)。
   数値は data.js の探検のHUD・音の節(EXPLORE_COMPASS_* / EXPLORE_OBJ_* / EXPLORE_MINIMAP_* / EXPLORE_MAP_* …)。

   【呼ばれる場所】
     explore.js  exploreStart        … exploreHudStart()
                 exploreResetState   … exploreHudReset()
                 exploreFinish       … exploreHudHide()
                 updateExplore       … exploreUpdateHud()(目標パネル・地域の札・音の気分。中身が変わったときだけDOMを書く)
                 exploreDrawScreen   … exploreHudFrame()(方位バー・全体地図を描く。render() の中)
                 exploreWildAlert    … exploreHudOnSpotted(b)(気づかれた音)
                 ボスの札・HPバー    … exploreHudBand() / exploreBossRect(b)(置き場所の計算)
     render.js   renderMinimap       … exploreRenderMinimap()
                 toggleMinimapZoom   … exploreToggleMap()
   ===================================================================== */

const _expHud = {
  cmp:{ cv:null, ctx:null, cssW:0, dpr:1, sig:'' },
  obj:{ sig:'', fitSig:'', layoutAt:-1, avail:0, lastBossKills:0, lastBagDone:false, flash:{} },
  region:{ id:undefined, since:0 },
  band:{ at:-1, v:null },
  mini:{ bake:null, bakeKey:'' },
  map:{ open:false, lastDraw:0, legendBuilt:false },
  spottedAt:-99,
};
function exploreHudDpr(){ return Math.min(2, window.devicePixelRatio || 1); }
/* HUDの倍率(文字・欄・方位バー・ボスの帯)。画面の縦(#hud の論理の高さ)から決める。
   同じ端末なら縦持ち・横持ちで論理の縦は同じ=持ち方で文字サイズは変わらない(narrow-screen では分けない)。
   CSS は #hud の --exp-hud-k を読むだけ(値の正はこの関数1つ) */
function exploreHudScale(){
  const hud = document.getElementById('hud');
  const h = (hud && hud.clientHeight) || viewH || EXPLORE_HUD_BASE_H;
  return clamp(h / EXPLORE_HUD_BASE_H, 1, EXPLORE_HUD_MAX_SCALE);
}
function exploreHudApplyScale(){
  const hud = document.getElementById('hud');
  if(!hud) return 1;
  const k = exploreHudScale(), v = k.toFixed(3);
  if(hud.style.getPropertyValue('--exp-hud-k') !== v){ hud.style.setProperty('--exp-hud-k', v); _expHud.band.at = -1; }
  _expHud.k = k;
  return k;
}
function exploreHudEl(id){ return document.getElementById(id); }
// ワールドの角度(x右・y下の atan2)→ 北を0とした時計回りの度(0〜360)
function exploreHeadingDeg(ang){ return ((ang*180/Math.PI + 90) % 360 + 360) % 360; }
function exploreHudMeters(d){ return Math.max(1, Math.round(d / PING_UNITS_PER_M)); }
// 距離の文字(1000m 以上は km で短く。狭い欄に入れるため)
function exploreHudDist(d){ const m = exploreHudMeters(d); return m < 1000 ? `${m}m` : `${(m/1000).toFixed(1)}km`; }
function exploreHudEsc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, (ch)=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }

/* ===== 始まり・終わり ===== */
function exploreHudStart(){
  _expHud.obj.sig = ''; _expHud.obj.fitSig = ''; _expHud.obj.layoutAt = -1;
  _expHud.obj.lastBossKills = 0; _expHud.obj.lastBagDone = false; _expHud.obj.flash = {};
  _expHud.region.id = undefined; _expHud.region.since = 0;
  _expHud.band.at = -1; _expHud.cmp.sig = '';
  exploreHudApplyScale();
  _expHud.mini.bake = null; _expHud.mini.bakeKey = '';
  _expHud.spottedAt = -99;
  exploreCloseMap();
  const p = exploreHudEl('expObjPanel');
  if(p) p.classList.remove('hidden');
  if(typeof bgmExploreSetMood === 'function') bgmExploreSetMood(null);   // 前の探検の気分を持ち越さない
}
// 結果画面へ移るとき(exploreFinish)。HUDを隠すだけ
function exploreHudHide(){
  ['expObjPanel','expRegionCard','expBossCanvas'].forEach(id=>{ const el = exploreHudEl(id); if(el) el.classList.add('hidden'); });
  exploreCloseMap();
  const hud = exploreHudEl('hud');
  if(hud) hud.classList.remove('exp-kf-off');
}
// 探検の状態を戻すとき(exploreResetState。どの試合の始まりでも通る)。ミニマップの解像度も元へ戻す
function exploreHudReset(){
  exploreHudHide();
  const mc = (typeof miniCanvas !== 'undefined') ? miniCanvas : null;
  if(mc && (mc.width !== 120 || mc.height !== 120)){ mc.width = 120; mc.height = 120; }
  const hud = exploreHudEl('hud');
  if(hud){ ['--exp-kf-top','--exp-kf-right','--exp-rc-top'].forEach(k=> hud.style.removeProperty(k)); }
  const panel = exploreHudEl('expObjPanel');
  if(panel){ panel.classList.remove('is-strip'); ['top','right','left','width'].forEach(k=> panel.style[k] = ''); }
  _expHud.obj.strip = false;
}

/* ===== 上部中央の帯(方位バー)の位置。キャンバス(viewW×viewH)の座標で返す =====
   ボスの札・HPバー(explore.js)もこの帯の幅と下端を基準に置く。DOMの寸法を読むので0.5秒ごとに測り直す */
function exploreHudBand(){
  const now = performance.now();
  const B = _expHud.band;
  if(B.v && now - B.at < 500) return B.v;
  B.at = now;
  const hud = exploreHudEl('hud'), el = exploreHudEl('exploreHud');
  let v = null;
  if(hud && el && !el.classList.contains('hidden') && el.offsetWidth > 0){
    const x = hud.offsetLeft + el.offsetLeft, y = hud.offsetTop + el.offsetTop;
    v = { x, w: el.offsetWidth, top: y, bottom: y + el.offsetHeight };
    // 目標が方位バーの下の1行にまとまっているときは、その1行までを帯とする(ボスの帯・札はその下)
    const ob = exploreHudEl('expObjPanel');
    if(_expHud.obj.strip && ob && !ob.classList.contains('hidden')) v.bottom = hud.offsetTop + ob.offsetTop + ob.offsetHeight;
  }
  if(!v){
    const w = Math.min(560, viewW*0.45);
    v = { x:(viewW - w)/2, w, top:6, bottom:6 + EXPLORE_COMPASS_H };
  }
  B.v = v;
  return v;
}
/* 画面の上の方にあるHUDの欄(自分の欄・ミニマップ・目標パネル)。キャンバスの座標の矩形の配列。
   キャンバスに描く札・咆哮の文字はここにも重ねない(DOMの欄の下に潜って読めなくなる) */
const _expHudObs = { at:-1, v:[] };
function exploreHudObstacles(){
  const now = performance.now();
  if(now - _expHudObs.at < 500) return _expHudObs.v;
  _expHudObs.at = now;
  const hud = exploreHudEl('hud');
  const out = [];
  if(hud){
    // 上の欄に加えて、下の操作系(スティック・技の欄・FIRE・DASH・回転の矢印)にも札を重ねない(操作の上に文字を置かない)
    for(const id of ['topLeft','topRight','expObjPanel','joystickBase','movePanel','fireBtn','dashBtn','turnLeftBtn','turnRightBtn']){
      const el = exploreHudEl(id);
      if(!el || el.classList.contains('hidden') || el.offsetWidth === 0) continue;
      out.push({ x: hud.offsetLeft + el.offsetLeft, y: hud.offsetTop + el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    }
  }
  _expHudObs.v = out;
  return out;
}
/* ボスの画面上の矩形(札・文字をここから逃がす)。ボス担当の exploreBossScreenRect があればそちらが正 */
function exploreBossRect(b){
  if(!b) return null;
  if(typeof window.exploreBossScreenRect === 'function'){
    const r = window.exploreBossScreenRect(b);
    if(r) return r;
  }
  const z0 = b.z || 0;
  const h = exploreBodyHeight(b) * (b.exploreLying ? 0.45 : 1);
  const f = project(b.x, b.y, z0), t = project(b.x, b.y, z0 + h);
  if(!f || !t) return null;
  const hw = b.radius * f.scale * (b.exploreLying ? 1.6 : 1.15);
  return { x: f.x - hw, y: t.y, w: hw*2, h: Math.max(8, f.y - t.y + b.radius*f.scale*0.25) };
}
function exploreRectsHit(a, b, pad){
  const p = pad || 0;
  return !!(a && b && a.x - p < b.x + b.w && a.x + a.w + p > b.x && a.y - p < b.y + b.h && a.y + a.h + p > b.y);
}

/* =====================================================================
   目標(いま優先の目標を1つ決め、行を並べる)
   ===================================================================== */
function exploreObjectives(){
  const st = exploreState;
  const p = player;
  const recs = st.bosses;
  const done = recs.filter(r=> r.defeated).length;
  // 狙うボス: 戦っている最中のもの → いちばん近い未討伐
  let target = null, targetD = Infinity, engaged = null;
  for(const r of recs){
    if(r.defeated) continue;
    const b = getEntity(r.id);
    const x = b && b.alive ? b.x : r.nestX, y = b && b.alive ? b.y : r.nestY;
    const d = p ? Math.hypot(x - p.x, y - p.y) : 0;
    if(st.engagedBossId === r.id && b && b.alive) engaged = { rec:r, b, x, y, d };
    if(d < targetD){ targetD = d; target = { rec:r, b, x, y, d }; }
  }
  if(engaged) target = engaged;
  const left = Math.max(0, st.endsAt - matchTime);
  const bag = exploreBagCount();
  const beacon = st.beacon;
  const beaconD = (p && beacon) ? Math.hypot(beacon.x - p.x, beacon.y - p.y) : 0;
  const lastLife = st.faints >= EXPLORE_MAX_FAINTS - 1;
  const urgent = left <= EXPLORE_OBJ_RETURN_WARN_SEC || lastLife;
  const hold = st.beaconInside ? Math.min(1, st.beaconHold / EXPLORE_BEACON_HOLD_SEC) : 0;
  const def = target ? EXPLORE_BOSSES.find(d=> d.id === target.rec.bossId) : null;
  const reg = target ? exploreRegion(target.rec.region) : null;

  const hunt = { id:'hunt', icon:'⚔', done: done >= recs.length && recs.length > 0,
    count:`${done}/${recs.length}`, x: target ? target.x : null, y: target ? target.y : null };
  if(engaged && def){
    // 戦っている最中(体力・怒り・部位破壊はボスの帯が出すので、ここでは二重に出さない)
    hunt.text = `${def.name}を討伐`;
    hunt.sub = reg ? `${reg.name}の主` : '大型モンスター';
  } else if(target && def){
    hunt.text = '大型モンスター討伐';
    hunt.sub = `次: ${def.name}${reg ? `(${reg.name})` : ''} ${exploreHudMeters(target.d)}m`;
  } else {
    hunt.text = '大型モンスター討伐';
    hunt.sub = 'すべて討伐した';
  }
  const gather = { id:'gather', icon:'◈', text:'素材を集める', count:`${Math.min(bag, EXPLORE_OBJ_MATERIAL_GOAL)}/${EXPLORE_OBJ_MATERIAL_GOAL}`,
    done: bag >= EXPLORE_OBJ_MATERIAL_GOAL, sub:`持ち物 ${bag}個 ・ 補給箱や野生から` };
  const ret = { id:'return', icon:'⇪', text: hold > 0 ? '帰還中…' : 'ビーコンで帰還',
    count: hold > 0 ? `${Math.max(0, EXPLORE_BEACON_HOLD_SEC*(1-hold)).toFixed(1)}秒` : exploreHudDist(beaconD),
    done:false, urgent, hold, x: beacon ? beacon.x : null, y: beacon ? beacon.y : null,
    sub: hold > 0 ? '輪の中にとどまる' : (urgent ? (lastLife ? 'あと1回力尽きると半分しか持ち帰れない' : '時間切れだと半分しか持ち帰れない') : 'いつでも全部持ち帰れる') };
  let prio = 'hunt';
  if(hold > 0) prio = 'return';
  else if(engaged) prio = 'hunt';
  else if(urgent) prio = 'return';
  else if(!hunt.done) prio = 'hunt';
  else if(!gather.done) prio = 'gather';
  else prio = 'return';
  return { rows:[hunt, gather, ret], prio, left, bag, engaged };
}

/* ===== 目標パネルの置き場所(R1: 箱は画面から決める) =====
   上端 = ミニマップ(#topRight)の下端+すき間 / 下端 = その下にある右列の操作(回転・狙撃・FIRE…)の上端−すき間。
   入る縦幅から「出せる行」を決める(R3: 削る順 = 他の目標の行 → 優先の目標の2行目 → 優先の目標 → 見出し)。
   撃破ログ(#killFeed)は探検のあいだパネルの下へ回し、入らなければ出さない(カスタマイズ済みなら触らない) */
const EXP_OBJ_H = { pad:8, head:16, row:17, sub:12, gap:1 };   // CSS の .exp-obj-* の高さ(×倍率)と同じ値(片方だけ変えない)
function exploreObjH(){ const k = _expHud.k || 1, o = {}; for(const n in EXP_OBJ_H) o[n] = EXP_OBJ_H[n]*k; return o; }
function exploreObjLayout(){
  const hud = exploreHudEl('hud'), panel = exploreHudEl('expObjPanel'), tr = exploreHudEl('topRight');
  if(!hud || !panel || !tr) return;
  exploreHudApplyScale();
  const hudW = hud.clientWidth, hudH = hud.clientHeight;
  const gap = 6;
  const top = tr.offsetTop + tr.offsetHeight + gap;
  const right = Math.max(0, hudW - (tr.offsetLeft + tr.offsetWidth));
  panel.classList.remove('is-strip');
  panel.style.left = ''; panel.style.width = '';
  const w = panel.offsetWidth || 180;
  const x0 = hudW - right - w, x1 = hudW - right;
  let bottom = hudH - gap;
  for(const id of ['turnLeftBtn','turnRightBtn','sniperAdsBtn','sniperAmmoChip','pingBtn','dashBtn','fireBtn','movePanel']){
    const el = exploreHudEl(id);
    if(!el || el.offsetWidth === 0 || el.classList.contains('hidden')) continue;
    const cs = getComputedStyle(el);
    if(cs.display === 'none' || cs.visibility === 'hidden') continue;
    const ex0 = el.offsetLeft, ex1 = ex0 + el.offsetWidth, ey0 = el.offsetTop, ey1 = ey0 + el.offsetHeight;
    if(ex1 <= x0 || ex0 >= x1 || ey1 <= top) continue;   // 横に外れている / パネルの上端より上で終わっている
    bottom = Math.min(bottom, ey0 <= top ? top : ey0 - gap);
  }
  const H = exploreObjH();
  const strip = bottom - top < H.pad + H.head + H.gap + H.row;
  _expHud.obj.strip = strip;
  if(strip){
    /* R3 の最後の段: ミニマップの下に見出し+1行も入らない(横持ちの低い画面では回転ボタンがミニマップの
       すぐ下に来る)。目標は方位バーの真下の細い1行(見出し+優先の目標)にまとめる。
       ボスの帯・札は exploreHudBand() がこの1行の下端を返すので、その下へ自動でずれる */
    const cmp = exploreHudEl('exploreHud');
    panel.classList.add('is-strip');
    if(cmp){
      panel.style.top = (cmp.offsetTop + cmp.offsetHeight + 2) + 'px';
      panel.style.left = cmp.offsetLeft + 'px';
      panel.style.width = cmp.offsetWidth + 'px';
      panel.style.right = 'auto';
    }
    _expHud.obj.avail = 0;
    _expHud.obj.panelBottomLimit = 0;
    hud.style.setProperty('--exp-rc-top', (cmp ? cmp.offsetTop + cmp.offsetHeight + 26*(_expHud.k || 1) : 70) + 'px');
    _expHud.band.at = -1;
    return;
  }
  const cmp0 = exploreHudEl('exploreHud');
  hud.style.setProperty('--exp-rc-top', (cmp0 ? cmp0.offsetTop + cmp0.offsetHeight + 4 : 56) + 'px');
  const st = top + 'px', sr = right + 'px';
  if(panel.style.top !== st) panel.style.top = st;
  if(panel.style.right !== sr) panel.style.right = sr;
  _expHud.obj.avail = Math.max(0, bottom - top);
  _expHud.obj.panelBottomLimit = bottom;
  _expHud.band.at = -1;
}
// 撃破ログをパネルの下へ(パネルの高さが決まった後に呼ぶ)
function exploreKillFeedLayout(){
  const hud = exploreHudEl('hud'), panel = exploreHudEl('expObjPanel');
  if(!hud || !panel) return;
  if(_expHud.obj.strip){   // 目標が方位バーの下の1行のときは撃破ログを元の場所のまま出す
    hud.classList.remove('exp-kf-off'); hud.style.removeProperty('--exp-kf-top'); hud.style.removeProperty('--exp-kf-right');
    return;
  }
  const kfTop = panel.offsetTop + panel.offsetHeight + 6;
  const room = (_expHud.obj.panelBottomLimit || 0) - kfTop;
  const off = room < 24;   // 1行(約22px)も入らないなら出さない
  hud.classList.toggle('exp-kf-off', off);
  const v = kfTop + 'px';
  if(hud.style.getPropertyValue('--exp-kf-top') !== v) hud.style.setProperty('--exp-kf-top', v);
  const r = panel.style.right || '14px';
  if(hud.style.getPropertyValue('--exp-kf-right') !== r) hud.style.setProperty('--exp-kf-right', r);
}

/* 毎フレーム(updateExplore から)。DOMは中身が変わったときだけ書く */
function exploreUpdateHud(){
  if(!game.explore) return;
  const panel = exploreHudEl('expObjPanel');
  const O = _expHud.obj;
  const nowR = performance.now();
  if(nowR - O.layoutAt > 500 || O.layoutAt < 0){ O.layoutAt = nowR; exploreObjLayout(); }
  const ob = exploreObjectives();
  _expHud.lastOb = ob;   // 方位バーが「優先の目標」の印を付けるのに読む
  // 達成の瞬間を覚える(光らせる)
  if(exploreState.bossKills > O.lastBossKills){ O.flash.hunt = matchTime; O.lastBossKills = exploreState.bossKills; }
  const gDone = ob.rows[1].done;
  if(gDone && !O.lastBagDone) O.flash.gather = matchTime;
  O.lastBagDone = gDone;
  // 見出し
  const left = ob.left;
  const lowCls = left <= 60 ? 'is-crit' : (left <= EXPLORE_OBJ_RETURN_WARN_SEC ? 'is-low' : '');
  const lives = EXPLORE_MAX_FAINTS - exploreState.faints;
  // 入る行を決める(R3)
  const H = exploreObjH(), avail = O.avail;
  let used = H.pad + H.head;
  const order = [ob.prio, ...ob.rows.map(r=> r.id).filter(id=> id !== ob.prio)];
  const show = {}; let showSub = false;
  if(O.strip || used + H.gap + H.row <= avail){ show[ob.prio] = true; used += H.gap + H.row; }
  if(!O.strip){
    if(show[ob.prio] && used + H.sub <= avail){ showSub = true; used += H.sub; }
    for(const id of order.slice(1)){ if(used + H.gap + H.row <= avail){ show[id] = true; used += H.gap + H.row; } }
  }
  // 1段目の優先の目標が入らないほど低いなら、2行目より他の行を先に削った結果になっている(上の順)
  const flashOn = (id)=> O.flash[id] != null && matchTime - O.flash[id] < EXPLORE_OBJ_DONE_FLASH_SEC;
  const rows = ob.rows.filter(r=> show[r.id]);
  const sig = [O.strip ? 'S' : 'P', Math.ceil(left), exploreState.faints, ob.bag, ob.prio, showSub ? 1 : 0, ob.rows[2].count,
    rows.map(r=> [r.id, r.text, r.count, r.sub, r.done?1:0, r.urgent?1:0, r.hold ? r.hold.toFixed(2) : '', flashOn(r.id)?1:0].join('~')).join('|')].join('#');
  if(sig !== O.sig && panel){
    O.sig = sig;
    const t = exploreHudEl('expObjTime');
    if(t){ t.textContent = fmtTime(left); t.className = 'exp-obj-time ' + lowCls; }
    const f = exploreHudEl('expObjFaint');
    if(f){
      let pips = '';
      for(let i=0;i<EXPLORE_MAX_FAINTS;i++) pips += `<i class="${i < lives ? 'on' : 'off'}"></i>`;
      f.innerHTML = pips;
      f.className = 'exp-obj-faint' + (lives <= 1 ? ' is-last' : '');
    }
    const bg = exploreHudEl('expObjBag');
    if(bg) bg.textContent = `${ob.bag}`;
    const bc = exploreHudEl('expObjBeacon');
    if(bc) bc.textContent = ob.rows[2].count;   // 帰還ビーコンまでの距離(輪の中なら残り秒)。行が削られても見出しに残す
    const bcw = exploreHudEl('expObjBeaconWrap');
    if(bcw) bcw.classList.toggle('is-hold', ob.rows[2].hold > 0);
    const box = exploreHudEl('expObjRows');
    if(box){
      box.innerHTML = rows.map(r=>{
        const prio = r.id === ob.prio;
        const cls = ['exp-obj-row', prio ? 'is-prio' : '', r.done ? 'is-done' : '', r.urgent ? 'is-urgent' : '', flashOn(r.id) ? 'is-flash' : ''].filter(Boolean).join(' ');
        const bar = (r.hold > 0) ? `<span class="exp-obj-hold"><i style="width:${Math.round(r.hold*100)}%"></i></span>` : '';
        return `<div class="${cls}"><div class="exp-obj-line"><span class="exp-obj-mark">${r.done ? '✓' : (prio ? '◆' : '◇')}</span>`
          + `<span class="exp-obj-text">${exploreHudEsc(r.text)}</span><span class="exp-obj-count">${exploreHudEsc(r.count)}</span></div>`
          + (prio && showSub ? `<div class="exp-obj-sub">${exploreHudEsc(r.sub)}</div>` : '') + bar + `</div>`;
      }).join('');
    }
    exploreKillFeedLayout();
  }
  exploreUpdateRegionCard();
  exploreHudAudioMood(ob);
}

/* ===== 地域に入ったときの名前の札(APEXの地名の出方) ===== */
function exploreUpdateRegionCard(){
  if(!player) return;
  const reg = exploreRegionAt(player.x, player.y);
  const id = reg ? reg.id : null;
  const R = _expHud.region;
  const card = exploreHudEl('expRegionCard');
  if(!card) return;
  if(id !== R.id){
    const first = R.id === undefined;
    R.id = id; R.since = matchTime;
    const k = exploreHudEl('expRegionKicker'), n = exploreHudEl('expRegionName'), d = exploreHudEl('expRegionDanger');
    // 札は2行(小見出し+地名)。危険度は小見出しの行にまとめる(下の拾った通知の列に届かない高さに収める)
    if(k) k.textContent = reg ? `エリア ・ 危険度 ${'★'.repeat(reg.danger)}${'☆'.repeat(Math.max(0, 4 - reg.danger))}` : '拠点 ・ 帰還ビーコンで持ち帰れる';
    if(n) n.textContent = reg ? `${reg.icon} ${reg.name}` : '⛺ ベースキャンプ';
    if(d) d.textContent = reg ? `危険度 ${'★'.repeat(reg.danger)}${'☆'.repeat(Math.max(0, 4 - reg.danger))}` : '帰還ビーコンで持ち帰れる';
    card.style.setProperty('--rc', reg ? reg.theme.accent : '#7dffb0');
    card.style.setProperty('--exp-rc-dur', EXPLORE_REGION_CARD_SEC + 's');   // 出ている長さの正は data.js
    if(!first || matchTime < 1){
      card.classList.remove('hidden', 'is-on');
      void card.offsetWidth;   // 同じ札をもう一度出すときもアニメーションを最初から
      card.classList.add('is-on');
    }
  }
  // ボスの札・HPバーと同じ場所なので、ボス戦の最中と時間切れ後は出さない
  const bossUp = typeof exploreFocusBoss === 'function' && !!exploreFocusBoss();
  /* R3: 目標が方位バーの下の1行に入っている低い画面(横持ちのスマホ)では、札は出さない
     (上部中央の縦がそこで尽きる。地名はミニマップの下端にいつも出ている) */
  const on = !bossUp && !_expHud.obj.strip && matchTime - R.since < EXPLORE_REGION_CARD_SEC;
  if(!on && !card.classList.contains('hidden')) card.classList.add('hidden');
}

/* ===== 音の気分(audio.js へ渡すだけ。曲は audio.js) ===== */
const _expMoodW = [0,0,0,0,0];
function exploreHudAudioMood(ob){
  if(typeof bgmExploreSetMood !== 'function' || !player) return;
  const w = exploreRegionWeights(player.x / (WORLD.w / WORLD_BASE_SIZE), player.y / (WORLD.h / WORLD_BASE_SIZE));
  for(let i=0;i<5;i++) _expMoodW[i] = w[i];
  let boss = 0;
  if(ob.engaged && ob.engaged.b && ob.engaged.b.alive && ob.engaged.b.exState !== 'dying') boss = ob.engaged.b.exRage ? 2 : 1;
  // 溶岩のうなり: いちばん近い溶岩の縁までの距離で強くなる
  let lava = 0;
  if(typeof lavaZones !== 'undefined'){
    for(const lz of lavaZones){
      const d = Math.hypot(lz.x - player.x, lz.y - player.y) - lz.radius;
      lava = Math.max(lava, 1 - clamp(d / 1400, 0, 1));
    }
  }
  bgmExploreSetMood({ w:_expMoodW, boss, lava });
}
// 群れに気づかれた(explore.js の exploreWildAlert から)。短い警告音を間を空けて鳴らす
/* 通常の試合の拾い物(回復・ガッツ飴・修行チケット)を探検で拾ったとき(combat.js の lootToast から)。
   下の中央のトーストではなく、左の拾った通知の行へ出す。文言は「名前：効果」/「名前 で 効果」を名前と効果に分ける */
function exploreHudLootNote(msg){
  if(typeof exploreFeedPush !== 'function') return;
  const text = String(msg || '');
  let icon = '✚', color = '#8fe38f';
  if(typeof TICKET_ITEM !== 'undefined' && text.indexOf(TICKET_ITEM.name) === 0){ icon = '🎫'; color = TICKET_ITEM.color; }
  else if(typeof GUTS_ITEM !== 'undefined' && text.indexOf(GUTS_ITEM.name) === 0){ icon = '⚡'; color = GUTS_ITEM.color; }
  else if(typeof HEAL_ITEMS !== 'undefined'){
    for(const k in HEAL_ITEMS){ if(text.indexOf(HEAL_ITEMS[k].name) === 0){ icon = '❤'; color = HEAL_ITEMS[k].color; break; } }
  }
  const m = text.match(/^(.+?)(?:：|！| で )\s*(.*)$/);
  const name = m ? m[1] : text, sub = m ? m[2].replace(/^「|」$/g, '') : '';
  exploreFeedPush({ key:'loot:' + name, icon, name, sub, color, rarity:'common', showN:false });
}
function exploreHudOnSpotted(b){
  if(!game.explore || !b || !player) return;
  if(matchTime - _expHud.spottedAt < EXPLORE_SPOTTED_SE_GAP) return;
  if(Math.hypot(b.x - player.x, b.y - player.y) > EXPLORE_WILD_HEAR_RANGE) return;
  _expHud.spottedAt = matchTime;
  playSe('exploreSpotted');
}

/* =====================================================================
   方位バー(キャンバス)。render() の中で毎フレーム呼ばれるが、見た目が変わらないフレームは描かない
   ===================================================================== */
function exploreCompassMarkers(){
  const out = [];
  const p = player, st = exploreState;
  if(!p) return out;
  const ob = _expHud.lastOb || null;
  const prio = ob ? ob.prio : null;
  if(st.beacon){
    out.push({ kind:'beacon', x:st.beacon.x, y:st.beacon.y, color:'#7dffb0', always:true, label:true, prio: prio === 'return' });
  }
  for(const r of st.bosses){
    const b = getEntity(r.id);
    const def = EXPLORE_BOSSES.find(d=> d.id === r.bossId);
    if(!def) continue;
    if(r.defeated){ out.push({ kind:'bossDone', x:r.nestX, y:r.nestY, color:'#9aa3ad' }); continue; }
    const live = b && b.alive;
    const x = live ? b.x : r.nestX, y = live ? b.y : r.nestY;
    const engaged = st.engagedBossId === r.id;
    out.push({ kind:'boss', x, y, color:def.color, apex:!!def.apex, engaged, flee: live && b.exState === 'flee',
               always: engaged || (prio === 'hunt' && ob && ob.rows[0].x === x && ob.rows[0].y === y), label:true,
               prio: prio === 'hunt' && ob && ob.rows[0].x === x && ob.rows[0].y === y });
  }
  // 近い補給箱(未開封)
  const crates = [];
  for(const c of st.crates){
    if(c.opened) continue;
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if(d < EXPLORE_COMPASS_CRATE_RANGE) crates.push({ c, d });
  }
  crates.sort((a,b)=> a.d - b.d);
  for(const it of crates.slice(0, EXPLORE_COMPASS_CRATE_MAX))
    out.push({ kind:'crate', x:it.c.x, y:it.c.y, color:exploreRarityColor(it.c.rarity), label: it.d < 1200 });
  // 追ってくる野生(気づかれている)
  for(const w of st.wild){
    const e = getEntity(w.id);
    if(!e || !e.alive || e.exploreAsleep) continue;
    if(e.exState !== 'chase' && e.exState !== 'alert') continue;
    if(Math.hypot(e.x - p.x, e.y - p.y) > EXPLORE_COMPASS_THREAT_RANGE) continue;
    out.push({ kind:'threat', x:e.x, y:e.y, color:'#ff4a3a' });
  }
  return out;
}
function exploreCompassCanvas(){
  const C = _expHud.cmp;
  const host = exploreHudEl('exploreHud');
  if(!host) return null;
  if(!C.cv) C.cv = exploreHudEl('expCompassCanvas');
  if(!C.cv) return null;
  const cssW = host.clientWidth, cssH = host.clientHeight, dpr = exploreHudDpr();
  if(cssW <= 0 || cssH <= 0) return null;
  if(C.cssW !== cssW || C.cssH !== cssH || C.dpr !== dpr || !C.ctx){
    C.cssW = cssW; C.cssH = cssH; C.dpr = dpr;
    C.cv.width = Math.round(cssW*dpr); C.cv.height = Math.round(cssH*dpr);
    C.ctx = C.cv.getContext('2d');
    C.sig = '';
  }
  return C;
}
// 方位バーの小さな印(画面の画素で描く。中心 x,y)
function exploreDrawCompassIcon(g, m, x, y, s){
  g.save();
  g.translate(x, y);
  g.lineJoin = 'round';
  if(m.kind === 'beacon'){
    // 帰還ビーコン: 緑のひし形に上向きの矢印
    g.beginPath(); g.moveTo(0,-7*s); g.lineTo(6*s,0); g.lineTo(0,7*s); g.lineTo(-6*s,0); g.closePath();
    g.fillStyle = 'rgba(8,40,24,0.92)'; g.fill();
    g.lineWidth = 1.6; g.strokeStyle = m.color; g.stroke();
    g.beginPath(); g.moveTo(0,-4*s); g.lineTo(3*s,-0.5*s); g.lineTo(1.1*s,-0.5*s); g.lineTo(1.1*s,3.5*s); g.lineTo(-1.1*s,3.5*s); g.lineTo(-1.1*s,-0.5*s); g.lineTo(-3*s,-0.5*s); g.closePath();
    g.fillStyle = m.color; g.fill();
  } else if(m.kind === 'boss'){
    // ボス: ボスの色の丸に牙の印。戦っている最中は輪が脈打つ
    const r = (m.apex ? 7.5 : 6.5)*s;
    if(m.engaged){
      const k = (performance.now()/700) % 1;
      g.beginPath(); g.arc(0,0, r + 2 + k*6, 0, Math.PI*2);
      g.strokeStyle = `rgba(255,80,60,${0.8*(1-k)})`; g.lineWidth = 1.6; g.stroke();
    }
    g.beginPath(); g.arc(0,0,r,0,Math.PI*2);
    g.fillStyle = 'rgba(12,10,10,0.92)'; g.fill();
    g.lineWidth = 1.8; g.strokeStyle = m.color; g.stroke();
    g.fillStyle = m.color;
    g.beginPath(); g.moveTo(-3.2*s,-2.6*s); g.lineTo(-1*s,-2.6*s); g.lineTo(-2.1*s,3.2*s); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(1*s,-2.6*s); g.lineTo(3.2*s,-2.6*s); g.lineTo(2.1*s,3.2*s); g.closePath(); g.fill();
    if(m.apex){ g.fillStyle = '#ffd35a'; g.beginPath(); g.moveTo(-3*s,-r-1); g.lineTo(-1.5*s,-r-4*s); g.lineTo(0,-r-1.5*s); g.lineTo(1.5*s,-r-4*s); g.lineTo(3*s,-r-1); g.closePath(); g.fill(); }
  } else if(m.kind === 'bossDone'){
    g.beginPath(); g.arc(0,0,5*s,0,Math.PI*2);
    g.fillStyle = 'rgba(30,34,40,0.8)'; g.fill();
    g.lineWidth = 1.2; g.strokeStyle = 'rgba(170,178,188,0.7)'; g.stroke();
    g.strokeStyle = '#9fe8b0'; g.lineWidth = 1.6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-2.4*s,0); g.lineTo(-0.6*s,1.9*s); g.lineTo(2.6*s,-2*s); g.stroke();
  } else if(m.kind === 'crate'){
    g.fillStyle = 'rgba(10,12,16,0.9)';
    g.fillRect(-4.5*s,-3.5*s,9*s,7*s);
    g.lineWidth = 1.5; g.strokeStyle = m.color; g.strokeRect(-4.5*s,-3.5*s,9*s,7*s);
    g.fillStyle = m.color; g.fillRect(-4.5*s,-1*s,9*s,1.6*s);
  } else if(m.kind === 'threat'){
    g.fillStyle = m.color;
    g.beginPath(); g.moveTo(0,4*s); g.lineTo(-4*s,-3*s); g.lineTo(4*s,-3*s); g.closePath(); g.fill();
    g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.stroke();
  }
  g.restore();
}
/* 方位バー。段を3つに分けて重ねない(第2周の指摘):
     上の段 = 方角(N/NE…)と15度ごとの数字。中央は照準の先の方位角の箱(箱の左右の数字は出さない)
     中の段 = 目盛りの線(基線)
     下の段 = 印(ビーコン・巣・箱・野生)と、その下に距離。優先の目標は金の輪で囲む(上に何も積まない)
   座標は倍率を掛ける前の値で書き、setTransform で倍率(exploreHudScale)を掛ける。文字は最小11px */
const EXP_CMP = { labelY:9, baseY:21, markY:31, distY:42.5, boxW:34, boxH:14,
  bossY:25,      // ボス戦の間、ボスの帯が始まる高さ(下の段を譲る)
  pinY:21 };     // ボス戦の間の印の高さ(基線の上に小さく載せる。距離は出さない)
function exploreDrawCompass(){
  const C = exploreCompassCanvas();
  if(!C || !player) return;
  const k = _expHud.k || exploreHudScale();
  const g = C.ctx, W = C.cssW / k, H = C.cssH / k;
  const yaw = camState.yaw;
  const head = exploreHeadingDeg(yaw);
  const markers = exploreCompassMarkers();
  // ボス戦の間は下の段(印と距離)をボスの帯に譲る。印は基線の上に小さく載せる
  const bossBand = typeof exploreFocusBoss === 'function' && !!exploreFocusBoss()
    && !exploreState.banners.some(bn=> bn.kind === 'plate' && matchTime - bn.t0 < bn.dur - 0.4);
  const pulse = markers.some(m=> m.engaged || m.flee) ? Math.floor(performance.now()/50) : 0;
  const sig = [head.toFixed(1), Math.round(player.x/20), Math.round(player.y/20), pulse, W, k, bossBand ? 1 : 0,
    markers.map(m=> m.kind[0] + Math.round(m.x/40) + ':' + Math.round(m.y/40) + (m.prio?'p':'') + (m.flee?'f':'')).join(',')].join('|');
  if(sig === C.sig) return;
  C.sig = sig;
  const dpr = C.dpr, L = EXP_CMP;
  g.setTransform(dpr*k, 0, 0, dpr*k, 0, 0);
  g.clearRect(0, 0, W, H);
  const span = EXPLORE_COMPASS_SPAN_DEG, ppd = W / span, cx = W/2;
  // 下地: 上の2段は濃く、印の段は薄く(両端へ消える)
  const bgH = bossBand ? L.bossY : H;
  const bg = g.createLinearGradient(0, 0, 0, bgH);
  bg.addColorStop(0, 'rgba(6,10,14,0.66)'); bg.addColorStop(0.5, 'rgba(6,10,14,0.5)'); bg.addColorStop(1, bossBand ? 'rgba(6,10,14,0.4)' : 'rgba(6,10,14,0.0)');
  g.fillStyle = bg; g.fillRect(0, 0, W, bgH);
  g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(0, L.baseY, W, 1);
  // 目盛り(5度ごと)・数字(15度ごと)・方角(45度ごと)。中央の箱の左右は数字を出さない
  const NAMES = { 0:'N', 45:'NE', 90:'E', 135:'SE', 180:'S', 225:'SW', 270:'W', 315:'NW' };
  const from = Math.floor((head - span/2)/5)*5, to = Math.ceil((head + span/2)/5)*5;
  const boxHalf = L.boxW/2 + 12;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for(let a = from; a <= to; a += 5){
    const x = cx + (a - head)*ppd;
    if(x < -10 || x > W + 10) continue;
    const n = ((a % 360) + 360) % 360;
    const name = NAMES[n];
    const nearBox = Math.abs(x - cx) < boxHalf;
    if(name){
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(x - 0.75, L.baseY - 6, 1.5, 6);
      if(!nearBox){
        g.font = n % 90 === 0 ? "bold 13px 'Russo One', sans-serif" : "bold 11px 'Russo One', sans-serif";
        g.fillStyle = n === 0 ? '#ff7a5a' : (n % 90 === 0 ? '#ffffff' : 'rgba(235,240,248,0.88)');
        g.fillText(name, x, L.labelY);
      }
    } else if(n % 15 === 0){
      g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(x - 0.5, L.baseY - 4, 1, 4);
      if(!nearBox){
        g.font = "11px 'Share Tech Mono', monospace";
        g.fillStyle = 'rgba(220,228,238,0.6)';
        g.fillText(String(n), x, L.labelY + 0.5);
      }
    } else {
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x - 0.5, L.baseY - 2, 1, 2);
    }
  }
  // 両端を溶かす(ここまでの目盛りと下地だけ。印は後から描くので溶けない)
  g.save();
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createLinearGradient(0,0,W,0);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(0.1, 'rgba(0,0,0,1)');
  fade.addColorStop(0.9, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade; g.fillRect(0,0,W,H);
  g.restore();
  // 照準の先の方位角(上の段の中央の箱)と、基線への刻み
  const ht = String(Math.round(head) % 360).padStart(3, '0');
  g.fillStyle = 'rgba(4,8,12,0.92)';
  g.fillRect(cx - L.boxW/2, 1, L.boxW, L.boxH + 1);
  g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
  g.strokeRect(cx - L.boxW/2 + 0.5, 1.5, L.boxW - 1, L.boxH);
  g.font = "bold 12px 'Share Tech Mono', monospace";
  g.fillStyle = '#ffffff';
  g.fillText(ht, cx, 1 + L.boxH/2 + 0.5);
  g.beginPath(); g.moveTo(cx - 4, L.boxH + 2); g.lineTo(cx + 4, L.boxH + 2); g.lineTo(cx, L.baseY + 1); g.closePath();
  g.fillStyle = '#ffffff'; g.fill();
  // 印(遠い物から描いて、近い物・優先の物を上に)。下の段だけに置く
  const px = player.x, py = player.y;
  const items = [];
  for(const m of markers){
    const d = Math.hypot(m.x - px, m.y - py);
    let rel = exploreHeadingDeg(Math.atan2(m.y - py, m.x - px)) - head;
    rel = ((rel + 540) % 360) - 180;
    let x = cx + rel*ppd, edge = 0;
    const lim = W/2 - 12;
    if(Math.abs(rel*ppd) > lim){
      if(!m.always) continue;
      edge = rel < 0 ? -1 : 1;
      x = cx + edge*lim;
    }
    items.push({ m, d, x, edge });
  }
  const rank = (it)=> (it.m.prio ? 3 : 0) + (it.m.kind === 'boss' ? 1 : 0) + (it.m.kind === 'beacon' ? 1 : 0);
  items.sort((a,b)=> rank(a) - rank(b) || b.d - a.d);
  const labelSpans = [];
  const labels = [];
  const fleeBlink = Math.floor(performance.now()/250) % 2;
  for(const it of items){
    const m = it.m;
    if(m.flee && fleeBlink) continue;
    const my = bossBand ? L.pinY : L.markY;
    const s = (m.prio ? 1.15 : (m.kind === 'crate' || m.kind === 'threat' ? 0.9 : 1)) * (bossBand ? 0.62 : 1);
    if(bossBand && Math.abs(it.x - cx) < L.boxW/2 + 4) continue;   // 中央の箱の下の刻みは隠さない
    if(m.prio){   // 優先の目標: 金の輪で囲む(上に重ねない)
      g.beginPath(); g.arc(it.x, my, 10.5*(bossBand ? 0.62 : 1), 0, Math.PI*2);
      g.strokeStyle = '#ffd35a'; g.lineWidth = bossBand ? 1.5 : 2; g.stroke();
    }
    exploreDrawCompassIcon(g, m, it.x, my, s);
    if(it.edge){
      g.fillStyle = m.prio ? '#ffd35a' : m.color;
      g.beginPath();
      const ex = it.x + it.edge*11;
      g.moveTo(ex + it.edge*5, my); g.lineTo(ex - it.edge*1, my - 5); g.lineTo(ex - it.edge*1, my + 5); g.closePath(); g.fill();
    }
    if(!bossBand && m.label && it.d <= EXPLORE_COMPASS_LABEL_RANGE) labels.unshift({ it, t: exploreHudDist(it.d) });   // 優先の物から場所を取る
  }
  g.font = "bold 11px 'Share Tech Mono', monospace";
  for(const { it, t } of labels){
    const tw = g.measureText(t).width;
    const lx = clamp(it.x, tw/2 + 3, W - tw/2 - 3);   // 端に寄せた印の距離もバーの外へ切らさない
    const lx0 = lx - tw/2 - 2, lx1 = lx + tw/2 + 2;
    if(labelSpans.some(([a,b])=> lx0 < b && lx1 > a)) continue;
    labelSpans.push([lx0, lx1]);
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(t, lx, L.distY);
    g.fillStyle = it.m.prio ? '#ffe08a' : 'rgba(235,240,248,0.95)';
    g.fillText(t, lx, L.distY);
  }
}

/* =====================================================================
   ボスの帯(方位バーの真下の1行)。#hud の中のキャンバス #expBossCanvas へ描く
   ・1行 = 紋章・名前・状態の札(予告中は ⚠技名)・HPバー・残り%。縦が高い画面だけ下に二つ名を小さく
   ・R3(横が足りないとき): 状態の札 → 名前(… で詰める) の順に削り、バーは EXPLORE_BOSS_HUD.barMinW を割らない
   ・寸法はキャンバス(viewW×viewH)の座標で返す(札・咆哮の置き場所と --measure が読む)
   ===================================================================== */
function exploreHudBossGeom(b){
  const k = _expHud.k || exploreHudScale();
  const band = exploreHudBand(), H = EXPLORE_BOSS_HUD;
  const w = Math.min(band.w, H.maxW*k);
  const x = band.x + (band.w - w)/2;
  /* ボス戦の間は方位バーの下の段(印と距離の段)をボスの帯に譲る(方位バーは上の2段だけになる)。
     帯が方位バーの外へ伸びないので、ボス本体に重ならない(第2周の指摘1) */
  const cmp = exploreHudEl('exploreHud'), hud = exploreHudEl('hud');
  const inCompass = !!(cmp && hud && !cmp.classList.contains('hidden') && cmp.offsetHeight > 0);
  const top = inCompass ? hud.offsetTop + cmp.offsetTop + EXP_CMP.bossY*k : band.bottom + 2*k;
  const rowH = H.rowH*k;
  const title = viewH >= H.titleMinH;
  const bottom = top + rowH + (title ? 13*k : 0) + 2*k;
  return { k, x, w, top, rowH, title, full:title, bottom };
}
function exploreBandSlant(g, x, y, w, h, s){
  g.beginPath(); g.moveTo(x + s, y); g.lineTo(x + w, y); g.lineTo(x + w - s, y + h); g.lineTo(x, y + h); g.closePath();
}
function exploreHudBossBand(){
  const cv = exploreHudEl('expBossCanvas'), hud = exploreHudEl('hud');
  if(!cv || !hud) return;
  const b = game.explore ? exploreFocusBoss() : null;
  const def = b ? exploreBossDef(b) : null;
  const plateUp = exploreState.banners.some(bn=> bn.kind === 'plate' && matchTime - bn.t0 < bn.dur - 0.4);
  if(!b || !def || plateUp){ if(!cv.classList.contains('hidden')) cv.classList.add('hidden'); return; }
  const G = exploreHudBossGeom(b), k = G.k, dpr = exploreHudDpr();
  const lx = Math.round(G.x - hud.offsetLeft - 4), ly = Math.round(G.top - hud.offsetTop);
  const cw = Math.round(G.w + 8), ch = Math.round(G.bottom - G.top + 2);
  if(cv.style.left !== lx + 'px') cv.style.left = lx + 'px';
  if(cv.style.top !== ly + 'px') cv.style.top = ly + 'px';
  if(cv.style.width !== cw + 'px') cv.style.width = cw + 'px';
  if(cv.style.height !== ch + 'px') cv.style.height = ch + 'px';
  if(cv.width !== Math.round(cw*dpr) || cv.height !== Math.round(ch*dpr)){ cv.width = Math.round(cw*dpr); cv.height = Math.round(ch*dpr); }
  cv.classList.remove('hidden');
  const g = cv.getContext('2d');
  g.setTransform(dpr*k, 0, 0, dpr*k, 0, 0);
  const W = cw/k, Hh = ch/k;
  g.clearRect(0, 0, W, Hh);
  const H = EXPLORE_BOSS_HUD;
  const rowC = H.rowH/2;               // 1行の縦の中心
  const x0 = 4/k + 2, x1 = W - 4/k - 2;
  const hpR = clamp(b.hp/b.maxHp, 0, 1), lag = clamp(b.exHpLag || hpR, hpR, 1);
  const base = b.exRage ? '#ff3a2a' : def.color;
  // 下地(行の後ろに薄い帯。両端は消える)
  const bgG = g.createLinearGradient(0, 0, W, 0);
  bgG.addColorStop(0, 'rgba(6,8,12,0)'); bgG.addColorStop(0.08, 'rgba(6,8,12,0.62)');
  bgG.addColorStop(0.92, 'rgba(6,8,12,0.62)'); bgG.addColorStop(1, 'rgba(6,8,12,0)');
  g.fillStyle = bgG; g.fillRect(0, 0, W, H.rowH);
  g.textBaseline = 'middle';
  // 寸法を先に決める(R3)
  g.font = "bold 13px 'Russo One', sans-serif";
  let name = def.name, nameW = g.measureText(name).width;
  g.font = "bold 11px 'Share Tech Mono', monospace";
  const pct = `${Math.max(1, Math.ceil(hpR*100))}%`, pctW = g.measureText(pct).width;
  const chips = [];
  if(b.exPending) chips.push({ t:`⚠ ${b.exPending.mv.name}`, c:'#ffcf5a', warn:true });
  else {
    if(b.exRage) chips.push({ t:'怒り', c:'#ff5a44' });
    if(b.exBroken) chips.push({ t:'部位破壊', c:'#ffc93c' });
    if(b.exState === 'flee') chips.push({ t:'瀕死', c:'#ffe08a' });
    if(b.exState === 'sleep') chips.push({ t:'睡眠', c:'#9fc4ff' });
    if(b.exState === 'stagger') chips.push({ t:'転倒', c:'#ffe45a' });
  }
  g.font = "bold 11px 'Rajdhani', sans-serif";
  chips.forEach(c=> c.w = g.measureText(c.t).width + 10);
  const iconW = 16, gap = 6;
  const barFor = ()=> (x1 - x0) - iconW - gap - (nameW ? nameW + gap : 0) - chips.reduce((a, c)=> a + c.w + 4, 0) - (chips.length ? gap - 4 : 0) - pctW - gap;
  while(barFor() < H.barMinW && chips.length > (chips[0] && chips[0].warn ? 1 : 0)) chips.pop();
  if(barFor() < H.barMinW){
    g.font = "bold 13px 'Russo One', sans-serif";
    while(name.length > 1 && barFor() < H.barMinW){ name = name.slice(0, -1); nameW = g.measureText(name + '…').width; }
    if(name !== def.name) name += '…';
  }
  const barW = Math.max(H.barMinW*0.6, barFor());
  let cx = x0;
  // 紋章
  exploreMapBossIcon(g, cx + 7, rowC, 6, def, 'alive');
  cx += iconW + gap;
  // 名前
  g.font = "bold 13px 'Russo One', sans-serif"; g.textAlign = 'left';
  g.lineWidth = 3.5; g.strokeStyle = 'rgba(0,0,0,0.8)';
  g.strokeText(name, cx, rowC + 0.5); g.fillStyle = '#ffffff'; g.fillText(name, cx, rowC + 0.5);
  cx += nameW + gap;
  // 状態の札 / 予告の技名
  const blink = 0.55 + 0.45*Math.abs(Math.sin(matchTime*9));
  g.font = "bold 11px 'Rajdhani', sans-serif";
  for(const c of chips){
    g.globalAlpha = c.warn ? blink : 1;
    exploreBandSlant(g, cx, rowC - 7, c.w, 14, 3);
    g.fillStyle = 'rgba(0,0,0,0.65)'; g.fill();
    g.strokeStyle = c.c; g.lineWidth = 1; g.stroke();
    g.fillStyle = c.c; g.textAlign = 'center';
    g.fillText(c.t, cx + c.w/2, rowC + 0.5);
    g.textAlign = 'left';
    g.globalAlpha = 1;
    cx += c.w + 4;
  }
  if(chips.length) cx += gap - 4;
  // バー
  const bh = H.barH, by = rowC - bh/2, sl = Math.min(5, bh*0.9);
  exploreBandSlant(g, cx - 1, by - 1, barW + 2, bh + 2, sl);
  g.fillStyle = 'rgba(6,8,12,0.9)'; g.fill();
  g.lineWidth = 1; g.strokeStyle = 'rgba(255,232,190,0.45)'; g.stroke();
  g.save();
  exploreBandSlant(g, cx, by, barW, bh, sl); g.clip();
  g.fillStyle = 'rgba(255,238,200,0.75)'; g.fillRect(cx, by, barW*lag, bh);
  const grad = g.createLinearGradient(cx, 0, cx + barW, 0);
  grad.addColorStop(0, exploreMixHex(base, '#000000', 0.3)); grad.addColorStop(1, exploreMixHex(base, '#ffffff', 0.15));
  g.fillStyle = grad; g.fillRect(cx, by, barW*hpR, bh);
  if(b.exRage){ g.fillStyle = `rgba(255,120,80,${0.18 + 0.18*Math.abs(Math.sin(matchTime*5))})`; g.fillRect(cx, by, barW*hpR, bh); }
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(cx, by, barW, bh*0.4);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for(let i=1;i<10;i++) g.fillRect(cx + barW*i/10 - 0.5, by + bh*0.4, 1, bh*0.6);
  g.restore();
  g.fillStyle = 'rgba(255,214,120,0.95)';   // 怒り(50%)・逃走(20%)の目安
  for(const t of [EXPLORE_BOSS_RAGE_HP, EXPLORE_BOSS_FLEE_HP]) g.fillRect(cx + barW*t - 0.75, by - 2, 1.5, bh + 4);
  cx += barW + gap;
  // 残り%
  g.font = "bold 11px 'Share Tech Mono', monospace";
  g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.8)';
  g.strokeText(pct, cx, rowC + 0.5); g.fillStyle = 'rgba(245,240,228,0.95)'; g.fillText(pct, cx, rowC + 0.5);
  // 二つ名(縦が高い画面だけ。帯の下に小さく)
  if(G.title){
    g.font = "bold 11px 'Rajdhani', sans-serif";
    g.fillStyle = exploreMixHex(def.color, '#ffffff', 0.5);
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.75)';
    const ty = H.rowH + 6.5;
    g.strokeText(def.title, x0 + iconW + gap, ty); g.fillText(def.title, x0 + iconW + gap, ty);
  }
}

/* render() の中(exploreDrawScreen)から毎フレーム */
function exploreHudFrame(){
  if(!game.explore) return;
  if(!_expBake.final) exploreMapBakeStep(EXPLORE_MAP_BAKE_MS);   // 地図の地形を少しずつ焼く(一瞬の重さを出さない)
  exploreDrawCompass();
  if(_expHud.map.open){
    const now = performance.now();
    if(now - _expHud.map.lastDraw > EXPLORE_MAP_REDRAW_SEC*1000){ _expHud.map.lastDraw = now; exploreLayoutBigMap(); exploreDrawBigMap(); }
  }
}

/* =====================================================================
   地形を焼く(1回だけ・数フレームに分けて)。**地面の高さそのもの(real3dHeightAt)から焼く**ので、
   フィールド担当の起伏(exploreRelief の尾根・峡谷・山・段丘)と地図が必ず一致する。
   ・平面の色 = 地域の地面の色(暗めに沈める)を、地域の基準の高さからの起伏の段(EXPLORE_MAP_BAND_H)ごとに
     その地域の岩の色へ寄せる(陰影は付けない。段の境目に細い等高線)
   ・崖 = 傾きが EXPLORE_MAP_CLIFF_SLOPE を超えた所を暗い線に
   ・水(湖・川)・溶岩・踏み分け道は配置表(EXPLORE_FIELD_LAYOUT)から細い線で重ねる
   ミニマップと全体地図はこの1枚から切り出して貼る(毎フレームは貼るだけ)。
   焼き終わるまでは地域の色だけの粗い絵で代わりにする
   ===================================================================== */
function exploreMapMix(a, b, t){ return exploreMixHex(a, b, t); }
// 地図の上の「高い所」の色(地域ごと)。段が上がるほどこの色へ寄る
const EXPLORE_MAP_ROCK = { meadow:'#cfc6a4', frost:'#ffffff', volcano:'#c98a60', jungle:'#98c682' };
const _expBake = { key:'', job:null, final:null, quick:null };
function exploreMapRgbList(){
  const rgb255 = (hex)=> exploreRgb(hex).map(v=> v*255);   // exploreRgb は 0〜1 で返す
  return {
    ground: EXPLORE_REGION_KEYS.map(id=> rgb255(exploreMapMix(exploreRegion(id).theme.ground, '#0d141c', 0.38))),
    rock:   EXPLORE_REGION_KEYS.map(id=> rgb255(exploreMapMix(EXPLORE_MAP_ROCK[id] || '#999999', '#0d141c', 0.12))),
    camp:   rgb255('#6b5c40'),
  };
}
function exploreMapBakeCheckKey(){
  const key = EXPLORE_MAP_BAKE_PX + ':' + EXPLORE_MAP_HEIGHT_PX + ':' + WORLD.w;
  if(_expBake.key !== key){ _expBake.key = key; _expBake.job = null; _expBake.final = null; _expBake.quick = null; }
}
// 焼き終わるまでの代わり(地域の色だけ。48×48)
function exploreMapQuick(){
  if(_expBake.quick) return _expBake.quick;
  const M = 48, cv = document.createElement('canvas');
  cv.width = cv.height = M;
  const g = cv.getContext('2d'), img = g.createImageData(M, M), C = exploreMapRgbList();
  for(let j=0;j<M;j++) for(let i=0;i<M;i++){
    const w = exploreRegionWeights((i + 0.5)/M*WORLD_BASE_SIZE, (j + 0.5)/M*WORLD_BASE_SIZE);
    const o = (j*M + i)*4;
    for(let c=0;c<3;c++){ let v = C.camp[c]*w[4]; for(let q=0;q<4;q++) v += C.ground[q][c]*w[q]; img.data[o+c] = v; }
    img.data[o+3] = 255;
  }
  g.putImageData(img, 0, 0);
  _expBake.quick = cv;
  return cv;
}
/* 1フレームぶん焼き進める(budgetMs まで)。焼き終わったら true */
function exploreMapBakeStep(budgetMs){
  exploreMapBakeCheckKey();
  if(_expBake.final) return true;
  const N = EXPLORE_MAP_HEIGHT_PX;
  let J = _expBake.job;
  if(!J) J = _expBake.job = { row:0, h:new Float32Array(N*N), rel:new Float32Array(N*N), rgb:new Uint8ClampedArray(N*N*3), rk:new Uint8Array(N*N), C:exploreMapRgbList() };
  const t0 = performance.now(), cell = WORLD.w / N, s = WORLD_BASE_SIZE / WORLD.w;
  while(J.row < N){
    const j = J.row;
    for(let i=0;i<N;i++){
      const wx = (i + 0.5)*cell, wy = (j + 0.5)*cell, lx = wx*s, ly = wy*s;
      const o = j*N + i;
      const h = real3dHeightAt(wx, wy);
      J.h[o] = h;
      J.rel[o] = h - exploreElevGrad(lx, ly).h;   // 地域の基準の高さからの起伏
      const w = exploreRegionWeights(lx, ly);
      let best = 0;
      for(let q=1;q<4;q++) if(w[q] > w[best]) best = q;
      J.rk[o] = best;
      for(let c=0;c<3;c++){ let v = J.C.camp[c]*w[4]; for(let q=0;q<4;q++) v += J.C.ground[q][c]*w[q]; J.rgb[o*3+c] = v; }
    }
    J.row++;
    if(performance.now() - t0 > budgetMs) return false;
  }
  _expBake.final = exploreMapCompose(J, N, cell);
  _expBake.job = null;
  return true;
}
function exploreMapBakeFinish(){ exploreMapBakeStep(Infinity); }
function exploreMapCompose(J, N, cell){
  // ① 平面の色(段ごと)・等高線・崖の線を N×N に
  const ras = document.createElement('canvas');
  ras.width = ras.height = N;
  const rg = ras.getContext('2d'), img = rg.createImageData(N, N), D = img.data;
  const BAND = EXPLORE_MAP_BAND_H, CLIFF = EXPLORE_MAP_CLIFF_SLOPE*cell;
  /* 崖の線は「急な所の縁」だけ細く引く: 急な格子のうち、右か下の隣が急でない所(面で塗らない) */
  const steep = new Uint8Array(N*N);
  for(let j=0;j<N;j++) for(let i=0;i<N;i++){
    const o = j*N + i, oR = i < N-1 ? o + 1 : o, oD = j < N-1 ? o + N : o;
    steep[o] = Math.max(Math.abs(J.h[o] - J.h[oR]), Math.abs(J.h[o] - J.h[oD])) > CLIFF ? 1 : 0;
  }
  const bandOf = (o)=> Math.max(0, Math.floor(J.rel[o] / BAND));
  for(let j=0;j<N;j++) for(let i=0;i<N;i++){
    const o = j*N + i, b = bandOf(o);
    const t = Math.min(0.9, b*0.2), rock = J.C.rock[J.rk[o]];
    let r = J.rgb[o*3] + (rock[0] - J.rgb[o*3])*t, g = J.rgb[o*3+1] + (rock[1] - J.rgb[o*3+1])*t, bl = J.rgb[o*3+2] + (rock[2] - J.rgb[o*3+2])*t;
    const oR = i < N-1 ? o + 1 : o, oD = j < N-1 ? o + N : o;
    if(bandOf(oR) !== b || bandOf(oD) !== b){ r *= 0.86; g *= 0.86; bl *= 0.86; }   // 等高線(薄く)
    if(steep[o] && (!steep[oR] || !steep[oD] || (i > 0 && !steep[o-1]) || (j > 0 && !steep[o-N]))){ r = r*0.35 + 10; g = g*0.35 + 12; bl = bl*0.35 + 16; }   // 崖の縁
    const q = o*4; D[q] = r; D[q+1] = g; D[q+2] = bl; D[q+3] = 255;
  }
  rg.putImageData(img, 0, 0);
  // ② 引き伸ばして、水・溶岩・道を細い線で重ねる
  const Np = EXPLORE_MAP_BAKE_PX, cv = document.createElement('canvas');
  cv.width = cv.height = Np;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.drawImage(ras, 0, 0, Np, Np);
  const L = EXPLORE_FIELD_LAYOUT, P = (v)=> v * (WORLD.w / WORLD_BASE_SIZE) * (Np / WORLD.w);
  const pt = (q)=> (typeof q === 'string') ? L.passes[q] : q;
  g.lineCap = 'round'; g.lineJoin = 'round';
  if(L.camp){
    g.strokeStyle = 'rgba(232,200,144,0.55)'; g.lineWidth = 1.5; g.setLineDash([4, 3]);
    g.beginPath(); g.arc(P(L.camp.x), P(L.camp.y), P(L.camp.clear*0.8), 0, Math.PI*2); g.stroke();
    g.setLineDash([]);
  }
  for(const pa of (L.paths || [])){
    const pts = pa.pts.map(pt).filter(Boolean);
    if(pts.length < 2) continue;
    g.beginPath(); pts.forEach((q, i)=> i ? g.lineTo(P(q[0]), P(q[1])) : g.moveTo(P(q[0]), P(q[1])));
    g.strokeStyle = 'rgba(20,14,8,0.55)'; g.lineWidth = 3.2; g.stroke();
    g.strokeStyle = 'rgba(236,216,168,0.85)'; g.lineWidth = 1.6; g.stroke();
  }
  for(const rv of (L.rivers || [])){
    g.beginPath(); rv.pts.forEach((q, i)=> i ? g.lineTo(P(q[0]), P(q[1])) : g.moveTo(P(q[0]), P(q[1])));
    g.strokeStyle = '#3f8fd0'; g.lineWidth = Math.max(2.5, P(rv.r)*1.1); g.stroke();
  }
  for(const lk of (L.lakes || [])){
    g.beginPath(); g.arc(P(lk.x), P(lk.y), P(lk.r), 0, Math.PI*2);
    g.fillStyle = '#2f76b4'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#8cc8f2'; g.stroke();
  }
  for(const lv of (L.lava || [])){
    g.beginPath(); g.arc(P(lv.x), P(lv.y), P(lv.r), 0, Math.PI*2);
    g.fillStyle = '#e8521c'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#ffc050'; g.stroke();
  }
  // 峠(尾根の抜け道)に小さな印
  for(const nm of Object.keys(L.passes || {})){
    const q = L.passes[nm];
    g.fillStyle = '#ffecbe'; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1;
    g.beginPath(); g.arc(P(q[0]), P(q[1]), 2.6, 0, Math.PI*2); g.fill(); g.stroke();
  }
  return cv;
}
// いま使える地形の絵(焼き終わっていれば本番、まだなら粗い代わり)
function exploreMapBake(){
  exploreMapBakeCheckKey();
  return _expBake.final || exploreMapQuick();
}

/* ===== 地図の上の印(ミニマップ・全体地図で共通)。M(x,y) = ワールド → 画素 / big = 全体地図 ===== */
function exploreMapLandmarks(){
  const L = EXPLORE_FIELD_LAYOUT, s = WORLD.w / WORLD_BASE_SIZE, out = [];
  for(const lm of (L.landmarks || [])){
    let x = lm.x, y = lm.y;
    if(lm.a && lm.b){ x = (lm.a[0] + lm.b[0])/2; y = (lm.a[1] + lm.b[1])/2; }
    if(lm.peak){ const pk = (L.peaks || []).find(p=> p.id === lm.peak); if(pk){ x = pk.x; y = pk.y; } }
    if(x == null || y == null) continue;
    out.push({ kind:lm.kind, x:x*s, y:y*s });
  }
  return out;
}
function exploreMapGlyph(g, kind, x, y, sz){
  g.save(); g.translate(x, y); g.lineJoin = 'round'; g.lineCap = 'round';
  const u = sz/10;
  g.fillStyle = 'rgba(8,10,14,0.78)';
  g.beginPath(); g.arc(0, 0, 6.5*u, 0, Math.PI*2); g.fill();
  g.lineWidth = 1.1*u; g.strokeStyle = 'rgba(255,240,210,0.9)'; g.stroke();
  g.strokeStyle = '#f2e6c8'; g.fillStyle = '#f2e6c8'; g.lineWidth = 1.3*u;
  if(kind === 'tower'){   // 監視塔: 細い脚の上に見張り台
    g.beginPath(); g.moveTo(-2.6*u, 4*u); g.lineTo(-1*u, -2*u); g.moveTo(2.6*u, 4*u); g.lineTo(1*u, -2*u); g.moveTo(-1.8*u, 1*u); g.lineTo(1.8*u, 1*u); g.stroke();
    g.fillRect(-2.6*u, -3.6*u, 5.2*u, 1.8*u); g.beginPath(); g.moveTo(-2.6*u, -3.6*u); g.lineTo(0, -5.2*u); g.lineTo(2.6*u, -3.6*u); g.closePath(); g.fill(); }
  else if(kind === 'arch'){ g.beginPath(); g.arc(0, 2.5*u, 3.6*u, Math.PI, 0); g.stroke(); g.beginPath(); g.moveTo(-3.6*u, 2.5*u); g.lineTo(-3.6*u, 3.6*u); g.moveTo(3.6*u, 2.5*u); g.lineTo(3.6*u, 3.6*u); g.stroke(); }
  else if(kind === 'gate'){ g.fillRect(-3.4*u, -1.5*u, 1.4*u, 5*u); g.fillRect(2*u, -1.5*u, 1.4*u, 5*u); g.fillRect(-4.4*u, -3.6*u, 8.8*u, 1.5*u); }
  else if(kind === 'plume'){ g.fillStyle = '#ff8a3c'; g.beginPath(); g.moveTo(0,-4.5*u); g.quadraticCurveTo(4*u, 0, 0, 4*u); g.quadraticCurveTo(-4*u, 0, 0, -4.5*u); g.fill(); }
  else if(kind === 'camp'){ g.fillStyle = '#e8c890'; g.beginPath(); g.moveTo(-4*u, 3*u); g.lineTo(0, -4*u); g.lineTo(4*u, 3*u); g.closePath(); g.fill(); g.fillStyle = 'rgba(8,10,14,0.9)'; g.beginPath(); g.moveTo(-1*u,3*u); g.lineTo(0,0); g.lineTo(1*u,3*u); g.closePath(); g.fill(); }
  g.restore();
}
function exploreMapBossIcon(g, x, y, r, def, state){
  // state: 'alive' | 'engaged' | 'flee' | 'done' | 'nest'
  g.save(); g.translate(x, y);
  if(state === 'nest'){
    g.setLineDash([2, 2]); g.lineWidth = 1.2; g.strokeStyle = def.color;
    g.beginPath(); g.arc(0, 0, r*0.8, 0, Math.PI*2); g.stroke();
    g.restore(); return;
  }
  if(state === 'engaged'){
    const k = (performance.now()/800) % 1;
    g.beginPath(); g.arc(0, 0, r + 2 + k*r, 0, Math.PI*2);
    g.strokeStyle = `rgba(255,70,50,${0.9*(1-k)})`; g.lineWidth = 2; g.stroke();
  }
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI*2);
  g.fillStyle = state === 'done' ? 'rgba(40,44,50,0.92)' : 'rgba(10,8,8,0.92)'; g.fill();
  g.lineWidth = Math.max(1.5, r*0.24); g.strokeStyle = state === 'done' ? '#8a939c' : def.color; g.stroke();
  g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.beginPath(); g.arc(0, 0, r + g.lineWidth, 0, Math.PI*2); g.stroke();
  if(state === 'done'){
    g.strokeStyle = '#d8dde2'; g.lineWidth = Math.max(1.5, r*0.26); g.lineCap = 'round';
    g.beginPath(); g.moveTo(-r*0.45, -r*0.45); g.lineTo(r*0.45, r*0.45); g.moveTo(r*0.45, -r*0.45); g.lineTo(-r*0.45, r*0.45); g.stroke();
  } else {
    g.fillStyle = def.color;
    g.beginPath(); g.moveTo(-r*0.55,-r*0.45); g.lineTo(-r*0.15,-r*0.45); g.lineTo(-r*0.35, r*0.55); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(r*0.15,-r*0.45); g.lineTo(r*0.55,-r*0.45); g.lineTo(r*0.35, r*0.55); g.closePath(); g.fill();
    if(def.apex){ g.fillStyle = '#ffd35a'; g.beginPath(); g.moveTo(-r*0.5,-r-1); g.lineTo(-r*0.25,-r*1.5); g.lineTo(0,-r*1.15); g.lineTo(r*0.25,-r*1.5); g.lineTo(r*0.5,-r-1); g.closePath(); g.fill(); }
  }
  g.restore();
}
function exploreMapDrawDynamic(g, M, opts){
  const st = exploreState, p = player;
  const big = !!opts.big, ms = opts.iconScale || 1;
  const inView = opts.inView || (()=> true);
  // ランドマーク・キャンプ
  // ランドマークは全体地図だけ(ミニマップは自分の周りの道・崖・水と動く物だけにする)
  if(big) for(const lm of exploreMapLandmarks()){ const q = M(lm.x, lm.y); if(inView(q, 10)) exploreMapGlyph(g, lm.kind, q.x, q.y, 13*ms); }
  if(st.camp){ const q = M(st.camp.x, st.camp.y); if(inView(q, 10)) exploreMapGlyph(g, 'camp', q.x, q.y, (big ? 13 : 10)*ms); }
  // 補給箱(近いものだけ・レア度の色)
  const cr = big ? EXPLORE_MAP_CRATE_RANGE : EXPLORE_MINIMAP_CRATE_RANGE;
  for(const c of st.crates){
    if(c.opened || !p || Math.hypot(c.x - p.x, c.y - p.y) > cr) continue;
    const q = M(c.x, c.y);
    if(!inView(q, 4)) continue;
    const s = (big ? 4 : 3.2)*ms;
    g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(q.x - s - 1, q.y - s*0.8 - 1, s*2 + 2, s*1.6 + 2);
    g.fillStyle = exploreRarityColor(c.rarity); g.fillRect(q.x - s, q.y - s*0.8, s*2, s*1.6);
  }
  // 落ちている良い品(紫・金)
  for(const d of (st.drops || [])){
    if(!(d.rarity === 'epic' || d.rarity === 'legendary')) continue;
    const pos = (typeof exploreDropPos === 'function') ? exploreDropPos(d) : d;
    const q = M(pos.x, pos.y);
    if(!inView(q, 4)) continue;
    const s = 3*ms;
    g.fillStyle = exploreRarityColor(d.rarity);
    g.beginPath(); g.moveTo(q.x, q.y - s); g.lineTo(q.x + s, q.y); g.lineTo(q.x, q.y + s); g.lineTo(q.x - s, q.y); g.closePath(); g.fill();
  }
  // 野生(ミニマップだけ。起きている個体。気づいている個体は赤)
  if(!big){
    for(const w of st.wild){
      const e = getEntity(w.id);
      if(!e || !e.alive || e.exploreAsleep) continue;
      const q = M(e.x, e.y);
      if(!inView(q, 3)) continue;
      const hot = e.exState === 'chase' || e.exState === 'alert';
      g.beginPath(); g.arc(q.x, q.y, (hot ? 2.8 : 2.1)*ms, 0, Math.PI*2);
      g.fillStyle = hot ? '#ff4a3a' : 'rgba(240,226,200,0.85)'; g.fill();
      if(hot){ g.lineWidth = 1; g.strokeStyle = '#ffffff'; g.stroke(); }
    }
  }
  // 帰還ビーコン
  if(st.beacon){
    const q = M(st.beacon.x, st.beacon.y);
    if(inView(q, 8)){
      const s = (big ? 7 : 5.5)*ms;
      g.save(); g.translate(q.x, q.y);
      if(!renderHeavyLoad){ g.shadowBlur = 8; g.shadowColor = '#7dffb0'; }
      g.beginPath(); g.moveTo(0,-s); g.lineTo(s*0.85,0); g.lineTo(0,s); g.lineTo(-s*0.85,0); g.closePath();
      g.fillStyle = 'rgba(8,40,24,0.95)'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = '#7dffb0'; g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = '#7dffb0'; g.beginPath(); g.moveTo(0,-s*0.55); g.lineTo(s*0.4,-s*0.05); g.lineTo(-s*0.4,-s*0.05); g.closePath(); g.fill();
      g.fillRect(-s*0.14, -s*0.1, s*0.28, s*0.55);
      g.restore();
    }
  }
  // ボスと巣(大きな縁付きの印。逃走中は点滅・倒したら×)
  const blink = Math.floor(performance.now()/260) % 2;
  for(const r of st.bosses){
    const def = EXPLORE_BOSSES.find(d=> d.id === r.bossId);
    if(!def) continue;
    const b = getEntity(r.id);
    const nq = M(r.nestX, r.nestY);
    const R = (big ? 9 : 6.5)*ms*(def.apex ? 1.15 : 1);
    if(r.defeated){ if(inView(nq, R)) exploreMapBossIcon(g, nq.x, nq.y, R, def, 'done'); continue; }
    const live = b && b.alive;
    const bq = live ? M(b.x, b.y) : nq;
    const away = live && Math.hypot(b.x - r.nestX, b.y - r.nestY) > 500;
    if(away && inView(nq, R)) exploreMapBossIcon(g, nq.x, nq.y, R, def, 'nest');
    const flee = live && b.exState === 'flee';
    if(flee && blink) continue;
    if(inView(bq, R)) exploreMapBossIcon(g, bq.x, bq.y, R, def, st.engagedBossId === r.id ? 'engaged' : (flee ? 'flee' : 'alive'));
  }
  // 自分(視野の扇+矢印)
  if(p){
    const q = M(p.x, p.y), yaw = camState.yaw;
    const fr = (big ? 26 : 20)*ms;
    const gr = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, fr);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(q.x, q.y); g.arc(q.x, q.y, fr, yaw - 0.55, yaw + 0.55); g.closePath(); g.fill();
    const s = (big ? 7 : 5.5)*ms;
    if(big){   // 全体地図では「いまここ」を輪で目立たせる
      const k = (performance.now()/900) % 1;
      g.beginPath(); g.arc(q.x, q.y, s*1.4 + k*s*1.6, 0, Math.PI*2);
      g.strokeStyle = `rgba(255,255,255,${0.8*(1-k)})`; g.lineWidth = 1.6; g.stroke();
    }
    g.save(); g.translate(q.x, q.y); g.rotate(yaw + Math.PI/2);
    g.beginPath(); g.moveTo(0, -s); g.lineTo(s*0.75, s*0.8); g.lineTo(0, s*0.4); g.lineTo(-s*0.75, s*0.8); g.closePath();
    g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 1.2; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.stroke();
    g.restore();
  }
}

/* ===== 探検のミニマップ(render.js の renderMinimap から。探検以外は来ない) =====
   北が上(既存のミニマップと同じ)。自分が中心・縁までが EXPLORE_MINIMAP_RADIUS。高解像度で描く */
function exploreRenderMinimap(){
  const cv = miniCanvas, c = miniCtx;
  const cssW = cv.clientWidth || 120, dpr = exploreHudDpr();
  const want = Math.round(cssW*dpr);
  if(cv.width !== want || cv.height !== want){ cv.width = want; cv.height = want; }
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = cssW;
  c.clearRect(0, 0, w, w);
  const ve = player;
  if(!ve) return;
  const bake = exploreMapBake();
  const R = EXPLORE_MINIMAP_RADIUS;
  const scale = (w/2) / R;
  const MX = (x)=> w/2 + (x - ve.x)*scale, MY = (y)=> w/2 + (y - ve.y)*scale;
  c.save();
  c.beginPath(); c.arc(w/2, w/2, w/2 - 1, 0, Math.PI*2); c.clip();
  c.fillStyle = '#0b1118'; c.fillRect(0, 0, w, w);
  // 焼いた地形を切り出して貼る(ワールドの外は切り詰める)
  const kb = bake.width / WORLD.w;
  let sx = (ve.x - R)*kb, sy = (ve.y - R)*kb, sw = 2*R*kb, sh = 2*R*kb;
  let dx = 0, dy = 0, dw = w, dh = w;
  const fixAxis = (s0, sLen, d0, dLen)=>{
    let s = s0, sl = sLen, d = d0, dl = dLen;
    if(s < 0){ const cut = -s; d += cut * dLen/sLen; dl -= cut * dLen/sLen; sl -= cut; s = 0; }
    if(s + sl > bake.width){ const cut = s + sl - bake.width; dl -= cut * dLen/sLen; sl -= cut; }
    return [s, sl, d, dl];
  };
  [sx, sw, dx, dw] = fixAxis(sx, sw, dx, dw);
  [sy, sh, dy, dh] = fixAxis(sy, sh, dy, dh);
  if(sw > 1 && sh > 1 && dw > 1 && dh > 1){
    c.imageSmoothingEnabled = true;
    c.drawImage(bake, sx, sy, sw, sh, dx, dy, dw, dh);
  }
  const inView = (q, m)=> Math.hypot(q.x - w/2, q.y - w/2) < w/2 + (m || 0);
  exploreMapDrawDynamic(c, (x, y)=> ({ x:MX(x), y:MY(y) }), { big:false, iconScale: w/120, inView });
  // 縁取りと北の印
  c.restore();
  c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,255,255,0.35)';
  c.beginPath(); c.arc(w/2, w/2, w/2 - 1.5, 0, Math.PI*2); c.stroke();
  c.save();
  c.font = "bold 9px 'Russo One', sans-serif"; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = 'rgba(8,10,14,0.85)'; c.beginPath(); c.arc(w/2, 8, 6.5, 0, Math.PI*2); c.fill();
  c.fillStyle = '#ff7a5a'; c.fillText('N', w/2, 8.5);
  // 下端: 今いる地域の名前
  const reg = exploreRegionAt(ve.x, ve.y);
  const label = reg ? reg.name : 'キャンプ';
  c.font = "bold 9px 'Rajdhani', sans-serif";
  c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.8)';
  c.strokeText(label, w/2, w - 9);
  c.fillStyle = reg ? reg.theme.accent : '#e8c890';
  c.fillText(label, w/2, w - 9);
  c.restore();
}

/* =====================================================================
   全体地図(ミニマップのタップで開く)
   ===================================================================== */
function exploreToggleMap(){
  if(_expHud.map.open) exploreCloseMap(); else exploreOpenMap();
}
function exploreOpenMap(){
  if(!game.explore || game.over) return;
  const ov = exploreHudEl('expMapOverlay');
  if(!ov) return;
  if(!_expHud.map.legendBuilt) exploreBuildMapLegend();
  ov.classList.remove('hidden');
  _expHud.map.open = true;
  exploreLayoutBigMap();
  _expHud.map.lastDraw = performance.now();
  exploreDrawBigMap();
}
function exploreCloseMap(){
  const ov = exploreHudEl('expMapOverlay');
  if(ov) ov.classList.add('hidden');
  _expHud.map.open = false;
}
/* 凡例。**地図に出る印はすべてここに載せる**(第2周の指摘)。印は地図と同じ描き方の関数で小さなキャンバスに描く
   (見た目を二重に持たない)。2列に並べる */
function exploreMapLegendRows(){
  const boss = EXPLORE_BOSSES[1] || EXPLORE_BOSSES[0];
  const line = (col, w, dash)=> (g)=>{ g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; if(dash) g.setLineDash(dash); g.beginPath(); g.moveTo(1.5, 8); g.lineTo(14.5, 8); g.stroke(); g.setLineDash([]); };
  return [
    { t:'あなた(向き)', d:(g)=>{ g.save(); g.translate(8, 8); g.beginPath(); g.moveTo(0,-6); g.lineTo(4.5,5); g.lineTo(0,2.5); g.lineTo(-4.5,5); g.closePath(); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1; g.strokeStyle = '#000'; g.stroke(); g.restore(); } },
    { t:'帰還ビーコン', d:(g)=> exploreDrawCompassIcon(g, { kind:'beacon', color:'#7dffb0' }, 8, 8, 0.95) },
    { t:'大型モンスター', d:(g)=> exploreMapBossIcon(g, 8, 8.5, 5.5, boss, 'alive') },
    { t:'討伐済み', d:(g)=> exploreMapBossIcon(g, 8, 8, 5.5, boss, 'done') },
    { t:'留守の巣', d:(g)=> exploreMapBossIcon(g, 8, 8, 7, boss, 'nest') },
    { t:'補給箱(近く)', d:(g)=>{ ['common','rare','epic','legendary'].forEach((r, i)=>{ g.fillStyle = '#000'; g.fillRect(i*4, 4, 4, 8); g.fillStyle = exploreRarityColor(r); g.fillRect(i*4 + 0.5, 4.5, 3, 7); }); } },
    { t:'良い落とし物', d:(g)=>{ g.fillStyle = exploreRarityColor('legendary'); g.beginPath(); g.moveTo(8,3); g.lineTo(13,8); g.lineTo(8,13); g.lineTo(3,8); g.closePath(); g.fill(); } },
    { t:'野生(赤=気づいた)', d:(g)=>{ g.fillStyle = 'rgba(240,226,200,0.9)'; g.beginPath(); g.arc(5, 8, 2.3, 0, Math.PI*2); g.fill(); g.fillStyle = '#ff4a3a'; g.beginPath(); g.arc(11, 8, 2.8, 0, Math.PI*2); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke(); } },
    { t:'ベースキャンプ', d:(g)=> exploreMapGlyph(g, 'camp', 8, 8, 12) },
    { t:'監視塔', d:(g)=> exploreMapGlyph(g, 'tower', 8, 8, 12) },
    { t:'岩のアーチ', d:(g)=> exploreMapGlyph(g, 'arch', 8, 8, 12) },
    { t:'遺跡の門', d:(g)=> exploreMapGlyph(g, 'gate', 8, 8, 12) },
    { t:'火口の噴煙', d:(g)=> exploreMapGlyph(g, 'plume', 8, 8, 12) },
    { t:'峠(抜け道)', d:(g)=>{ g.fillStyle = '#ffecbe'; g.strokeStyle = '#000'; g.lineWidth = 1; g.beginPath(); g.arc(8, 8, 3, 0, Math.PI*2); g.fill(); g.stroke(); } },
    { t:'道', d:(g)=>{ line('rgba(20,14,8,0.8)', 4)(g); line('#ecd8a8', 2)(g); } },
    { t:'崖', d:line('#0e1014', 3) },
    { t:'高い所(明るい)', d:(g)=>{ ['#3b4a2c','#5d6048','#8a8672','#b8b4a2'].forEach((c, i)=>{ g.fillStyle = c; g.fillRect(1 + i*3.5, 3, 3.5, 10); }); } },
    { t:'水辺', d:(g)=>{ g.fillStyle = '#2f76b4'; g.beginPath(); g.arc(8, 8, 5, 0, Math.PI*2); g.fill(); g.strokeStyle = '#8cc8f2'; g.lineWidth = 1; g.stroke(); } },
    { t:'溶岩', d:(g)=>{ g.fillStyle = '#e8521c'; g.beginPath(); g.arc(8, 8, 5, 0, Math.PI*2); g.fill(); g.strokeStyle = '#ffc050'; g.lineWidth = 1; g.stroke(); } },
    ...EXPLORE_REGIONS.map(r=> ({ t:`${r.name} ★${r.danger}`, d:(g)=>{ g.fillStyle = r.theme.accent; g.fillRect(2, 3, 12, 10); } })),
  ];
}
function exploreBuildMapLegend(){
  const el = exploreHudEl('expMapLegend');
  if(!el) return;
  const dpr = exploreHudDpr();
  el.innerHTML = '';
  for(const row of exploreMapLegendRows()){
    const div = document.createElement('div');
    div.className = 'exp-lg-row';
    const cv = document.createElement('canvas');
    cv.className = 'exp-lg-ico';
    cv.width = cv.height = Math.round(16*dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    try{ row.d(g); }catch(e){}
    const sp = document.createElement('span');
    sp.textContent = row.t;
    div.appendChild(cv); div.appendChild(sp);
    el.appendChild(div);
  }
  _expHud.map.legendBuilt = true;
}
// 箱は画面から決める(R1): 地図の一辺 = 箱の高さと (箱の幅 − 横の欄の最小幅) の小さい方
function exploreLayoutBigMap(){
  const box = exploreHudEl('expMapBox'), cv = exploreHudEl('expMapCanvas'), side = exploreHudEl('expMapSide');
  if(!box || !cv) return;
  const bw = box.clientWidth, bh = box.clientHeight;
  const sideMin = 150*(_expHud.k || 1);   // 横の欄(凡例)の最小幅。文字の倍率と一緒に広げる
  const S = Math.max(120, Math.floor(Math.min(bh, bw - sideMin - 10)));
  cv.style.width = S + 'px'; cv.style.height = S + 'px';
  const dpr = exploreHudDpr();
  if(cv.width !== Math.round(S*dpr)){ cv.width = Math.round(S*dpr); cv.height = Math.round(S*dpr); }
  if(side) side.classList.toggle('is-tight', bw - S - 10 < sideMin);
}
function exploreDrawBigMap(){
  const cv = exploreHudEl('expMapCanvas');
  if(!cv || !player) return;
  const g = cv.getContext('2d'), dpr = exploreHudDpr();
  const S = cv.width / dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, S, S);
  const bake = exploreMapBake();
  g.imageSmoothingEnabled = true;
  g.drawImage(bake, 0, 0, S, S);
  const k = S / WORLD.w;
  const M = (x, y)=> ({ x:x*k, y:y*k });
  // 地域の名前(危険度つき)
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for(const r of EXPLORE_REGIONS){
    const c = exploreRegionCircle(r);
    const q = M(c.x, c.y);
    const fs = Math.max(11, Math.round(S*0.034));
    g.font = `bold ${fs}px 'Rajdhani', sans-serif`;
    g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.strokeText(r.name, q.x, q.y - fs*0.4);
    g.fillStyle = '#ffffff'; g.fillText(r.name, q.x, q.y - fs*0.4);
    g.font = `bold ${Math.round(fs*0.8)}px sans-serif`;
    const stars = '★'.repeat(r.danger);
    g.strokeText(stars, q.x, q.y + fs*0.6);
    g.fillStyle = r.theme.accent; g.fillText(stars, q.x, q.y + fs*0.6);
  }
  exploreMapDrawDynamic(g, M, { big:true, iconScale: clamp(S/360, 0.85, 1.6) });
  // 縁
  g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.3)'; g.strokeRect(1, 1, S - 2, S - 2);
  // 方角
  g.font = "bold 12px 'Russo One', sans-serif"; g.fillStyle = '#ff7a5a';
  g.fillText('N', S/2, 10);
}

/* 全体地図は どこを押しても閉じる(✕のボタンも同じ)。押した指が下の視点ドラッグを掴まないよう止める */
(function exploreMapBindClose(){
  const ov = document.getElementById('expMapOverlay');
  if(!ov) return;
  ov.addEventListener('pointerdown', (e)=>{
    e.preventDefault(); e.stopPropagation();
    exploreCloseMap();
  });
})();
