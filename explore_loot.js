/* =====================================================================
   探検モード(game.explore)― ルート: 補給箱・落ちている品・光の柱・拾った通知、装備の適用
   ・表と数値は data.js の探検ブロック(EXPLORE_CRATE_* / EXPLORE_FIELD_ITEMS / EXPLORE_PILLAR_* /
     EXPLORE_FEED_* / EXPLORE_GEAR*)。ここは置く・開ける・散らす・拾う・描くだけ。
   ・**探検以外では何もしない。** 入口はすべて game.explore を見てから動く。
     通常の試合の落ちているアイテム(lootItems / updateLootPickups / drawLootItem)には触らない。
     探検の品は exploreState.crates / exploreState.drops に別に持つ。

   【呼ばれる場所】
     explore.js  exploreStart      … exploreApplyGear(player)(装備の効果。**探検の開始時だけ**)
                 exploreSpawnLoot  … exploreSpawnCrates()
                 updateExplore     … exploreLootUpdate(dt)(箱を開ける・品が落ちる・拾う)
                 exploreGainMaterial … exploreLootNotify(拾った通知)
                 exploreResetState … exploreLootReset()(通知の行を消す)
     render.js   render()          … exploreLootDrawables(drawables)(深度ソートに乗せる。描くのは d.draw)

   【他の担当が使う口】
     exploreSpawnDrop(x, y, itemKey, rarity, opts) … その場から品を弾けさせて地面に落とす(光の柱が立つ)。
         itemKey = EXPLORE_MATERIALS か EXPLORE_FIELD_ITEMS のキー / rarity 省略=品のレア度
         opts = { n:個数, fromZ:飛び出す高さ, dist:[最小,最大]の距離, delay:秒 }
         野生・ボスの落とし物(exploreDropLoot)はこれを呼ぶ
     exploreCrateSpots() … 補給箱の置き場所 [{x,y,region,danger}]。**置き場所はこの1つに寄せてある**ので、
         フィールドの配置(ランドマークの横など)に差し替えるときはこの関数だけを書き換える
     exploreApplyGear(player) … 着けている装備の効果をプレイヤーへ掛ける(探検の開始時だけ呼ぶ)
     player.sniperDmgMult … 狙撃の威力の倍率(装備の効果。sniper.js が弾のダメージに掛ける)
   ===================================================================== */

/* ===== 品の情報(名前・アイコン・レア度)。素材と素材以外を1つの形にそろえる ===== */
function exploreItemInfo(key){
  const m = EXPLORE_MATERIALS[key];
  if(m) return { key, kind:'mat', name:m.name, icon:m.icon, rarity:m.rarity };
  const f = EXPLORE_FIELD_ITEMS[key];
  if(!f) return null;
  let name = f.name || key;
  if(f.kind==='heal' && HEAL_ITEMS[f.ref]) name = HEAL_ITEMS[f.ref].name;
  else if(f.kind==='guts') name = GUTS_ITEM.name;
  return { key, kind:f.kind, ref:f.ref, name, icon:f.icon, rarity:f.rarity };
}
function exploreRarityColor(r){ return (EXPLORE_RARITY[r] || EXPLORE_RARITY.common).color; }
function exploreRarityOrder(r){ return (EXPLORE_RARITY[r] || EXPLORE_RARITY.common).order; }
// '#rrggbb' → 'rgba(r,g,b,a)'(色は EXPLORE_RARITY が正。ここで決め打ちしない)
const _exploreRgbCache = {};
function exploreRgba(hex, a){
  let c = _exploreRgbCache[hex];
  if(!c){
    const h = String(hex).replace('#','');
    const n = parseInt(h.length===3 ? h.split('').map(x=>x+x).join('') : h, 16) || 0;
    c = _exploreRgbCache[hex] = [(n>>16)&255, (n>>8)&255, n&255];
  }
  return `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a))})`;
}
function exploreWeightedPick(table){
  let sum = 0;
  for(const e of table) sum += e.w || 0;
  let r = Math.random() * sum;
  for(const e of table){ r -= e.w || 0; if(r < 0) return e; }
  return table[table.length-1] || null;
}

/* ===== 補給箱の置き場所 =====
   **置き場所はこの関数1つ。** いまは地域の円(EXPLORE_REGIONS)の中へ散らす。フィールド担当の配置
   (ランドマークの横・路地の奥など)に合わせるときは、ここだけを差し替えればよい。
   返り値: [{ x, y, region:地域id|null(キャンプ), danger:0〜4 }] */
function exploreCrateSpots(){
  const spots = [];
  const camp = exploreState.camp;
  const farFromOthers = (x, y)=> spots.every(s=> Math.hypot(s.x-x, s.y-y) >= EXPLORE_CRATE_MIN_GAP);
  const onHazard = (x, y)=> (typeof isOnHazard==='function') && isOnHazard(x, y, 70);
  // ベースキャンプ: 出発地点の左右前方(出発してすぐ目に入る。最初の「開ける」をここで覚える)
  if(camp && exploreState.spawn){
    const sp = exploreState.spawn, b = exploreState.beacon || camp;
    const fwd = Math.atan2(b.y - sp.y, b.x - sp.x);
    for(let i=0;i<EXPLORE_CRATE_CAMP_COUNT;i++){
      const side = (i % 2 ? 1 : -1) * (0.42 + 0.18*Math.floor(i/2));
      const p = clearObstaclePoint(sp.x + Math.cos(fwd+side)*430, sp.y + Math.sin(fwd+side)*430, 70);
      spots.push({ x:p.x, y:p.y, region:null, danger:0 });
    }
  }
  for(const reg of EXPLORE_REGIONS){
    const rc = exploreRegionCircle(reg);
    const want = EXPLORE_CRATE_PER_REGION[reg.id] != null ? EXPLORE_CRATE_PER_REGION[reg.id] : EXPLORE_CRATE_PER_REGION_DEFAULT;
    let placed = 0;
    for(let guard=0; guard<want*30 && placed<want; guard++){
      const a = rand(0, Math.PI*2), d = rc.r*0.85*Math.sqrt(rand(0,1));
      const x = clamp(rc.x + Math.cos(a)*d, 240, WORLD.w-240), y = clamp(rc.y + Math.sin(a)*d, 240, WORLD.h-240);
      if(camp && Math.hypot(x-camp.x, y-camp.y) < camp.r + 300) continue;
      if(onHazard(x, y)) continue;
      const p = clearObstaclePoint(x, y, 80);
      if(onHazard(p.x, p.y) || !farFromOthers(p.x, p.y)) continue;
      spots.push({ x:p.x, y:p.y, region:reg.id, danger:reg.danger });
      placed++;
    }
  }
  return spots;
}
function exploreRollCrateRarity(danger){
  const w = EXPLORE_CRATE_RARITY_BY_DANGER[danger] || EXPLORE_CRATE_RARITY_BY_DANGER[1];
  const e = exploreWeightedPick(Object.keys(w).map(k=>({ k, w:w[k] })));
  return e ? e.k : 'common';
}
// 補給箱を置く(exploreSpawnLoot から。試合ごとに1回)
function exploreSpawnCrates(){
  if(!game.explore) return;
  for(const s of exploreCrateSpots()){
    exploreState.crates.push({
      id: nextId++, x:s.x, y:s.y, z: baseTerrainHeightAt(s.x, s.y),
      angle: rand(0, Math.PI*2), region:s.region, danger:s.danger,
      rarity: exploreRollCrateRarity(s.danger),
      opened:false, openedAt:0, hold:0,
    });
  }
}

/* ===== 中身の抽選 ===== */
// そのレア度の素材を1つ選ぶ(箱のある地域 → ボス素材 → どこでも の順に探す)
function exploreLootPickMat(rarity, region){
  const all = Object.keys(EXPLORE_MATERIALS).filter(k=> EXPLORE_MATERIALS[k].rarity === rarity);
  let pool = region ? all.filter(k=> EXPLORE_MATERIALS[k].region === region) : all.filter(k=> EXPLORE_MATERIALS[k].region !== 'boss');
  if(!pool.length) pool = all.filter(k=> EXPLORE_MATERIALS[k].region === 'boss');
  if(!pool.length) pool = all;
  return pool.length ? pool[Math.floor(Math.random()*pool.length)] : null;
}
function exploreRollCrate(c){
  const resolve = (e)=> !e ? null : (e.mat ? exploreLootPickMat(e.mat, c.region) : (EXPLORE_FIELD_ITEMS[e.item] ? e.item : null));
  const out = [];
  const head = resolve(EXPLORE_CRATE_HEAD[c.rarity]);
  if(head) out.push(head);
  const range = EXPLORE_CRATE_ITEMS[c.rarity] || EXPLORE_CRATE_ITEMS.common;
  const n = range[0] + Math.floor(Math.random()*(range[1]-range[0]+1));
  const table = EXPLORE_CRATE_LOOT[c.rarity] || EXPLORE_CRATE_LOOT.common;
  for(let guard=0; out.length<n && guard<n*4; guard++){
    const k = resolve(exploreWeightedPick(table));
    if(k) out.push(k);
  }
  return out;
}

/* 箱を開ける。蓋が開き、中身が1個ずつ弾けて周りの地面に散る(APEX)。
   レア度の高い品ほど後に出す(最後にいちばん良い物が飛び出す) */
function exploreOpenCrate(c){
  if(!c || c.opened) return;
  c.opened = true; c.openedAt = matchTime; c.hold = 0;
  const items = exploreRollCrate(c).sort((a,b)=> exploreRarityOrder(exploreItemInfo(a).rarity) - exploreRarityOrder(exploreItemInfo(b).rarity));
  const baseA = rand(0, Math.PI*2);
  items.forEach((k, i)=>{
    const info = exploreItemInfo(k);
    const n = (info.kind==='mat' && info.rarity==='common') ? 1 + Math.floor(Math.random()*2) : 1;
    // 周り一周に均等に散らす(重ならない)。少しだけ乱す
    const a = baseA + (i / items.length) * Math.PI*2 + rand(-0.25, 0.25);
    exploreSpawnDrop(c.x, c.y, k, null, { n, fromZ:EXPLORE_CRATE_SIZE.h, angle:a,
      delay: EXPLORE_CRATE_LID_SEC*0.45 + i*EXPLORE_CRATE_BURST_GAP });
  });
  const col = exploreRarityColor(c.rarity);
  exploreLootFx({ type:'ring', x:c.x, y:c.y, z:c.z, color:col, dur:0.7, r0:30, r1:190 });
  if(c.rarity==='epic' || c.rarity==='legendary') exploreLootFx({ type:'ring', x:c.x, y:c.y, z:c.z, color:col, dur:1.1, r0:20, r1:320, delay:0.12 });
  for(let i=0;i<12;i++){
    const a = rand(0, Math.PI*2), sp = rand(80, 240);
    addParticle({ type:'spark', x:c.x, y:c.y, z:c.z + EXPLORE_CRATE_SIZE.h, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, life:0.55, maxLife:0.55, color:col, size:rand(2,4) });
  }
  playSe('expCrateOpen');
  if(c.rarity==='legendary') playSe('expLootLegend');
}

/* ===== 落ちている品 =====
   その場(x,y)から弾けて、周りの地面(散る距離)に落ちる。地面に落ちたら光の柱が立ち、近づくと拾える。 */
function exploreSpawnDrop(x, y, itemKey, rarity, opts){
  if(!game.explore) return null;
  const info = exploreItemInfo(itemKey);
  if(!info) return null;
  const o = opts || {};
  const rar = EXPLORE_RARITY[rarity] ? rarity : info.rarity;
  const a = o.angle != null ? o.angle : rand(0, Math.PI*2);
  const range = Array.isArray(o.dist) ? o.dist : EXPLORE_CRATE_SCATTER;
  const dd = rand(range[0], range[1]);
  const land = clearObstaclePoint(clamp(x + Math.cos(a)*dd, 40, WORLD.w-40), clamp(y + Math.sin(a)*dd, 40, WORLD.h-40), 30);
  const delay = o.delay || 0;
  const flight = rand(EXPLORE_CRATE_FLIGHT_SEC[0], EXPLORE_CRATE_FLIGHT_SEC[1]);
  const d = {
    id: nextId++, key:itemKey, rarity:rar, n: Math.max(1, Math.floor(o.n || 1)),
    sx:x, sy:y, sz: baseTerrainHeightAt(x, y) + (o.fromZ != null ? o.fromZ : 30),
    x:land.x, y:land.y, z: baseTerrainHeightAt(land.x, land.y),
    bornAt: matchTime + delay, landAt: matchTime + delay + flight,
    arc: rand(90, 150) + exploreRarityOrder(rar)*20,   // 良い物ほど高く跳ねる
    landed:false, bob: rand(0, Math.PI*2),
  };
  exploreState.drops.push(d);
  return d;
}
// 飛んでいる途中の位置(bornAt〜landAt を放物線で)。落ちた後は地面の位置
function exploreDropPos(d){
  if(d.landed || matchTime >= d.landAt) return { x:d.x, y:d.y, z:d.z, s:1 };
  const s = clamp((matchTime - d.bornAt) / Math.max(0.01, d.landAt - d.bornAt), 0, 1);
  return { x: d.sx + (d.x-d.sx)*s, y: d.sy + (d.y-d.sy)*s, z: d.sz + (d.z-d.sz)*s + 4*d.arc*s*(1-s), s };
}

/* 拾う。効き方は通常の試合の拾い物(updateLootPickups)と同じ数字を読む(HEAL_ITEMS / GUTS_ITEM)。
   狙撃銃・スコープは狙撃担当(sniper.js)の口があるときだけ渡す */
function exploreTakeDrop(d){
  const info = exploreItemInfo(d.key);
  const p = player;
  if(!info || !p) return;
  let note = '';
  if(info.kind==='mat'){
    exploreGainMaterial(d.key, d.n, null, null);   // 数え方と通知は素材の入口1か所
  } else {
    if(info.kind==='heal'){
      const hi = HEAL_ITEMS[info.ref];
      if(hi){
        if(p.hp >= p.maxHp){ p.maxHp += hi.maxBoost; p.hp += hi.maxBoost; note = `HP上限+${hi.maxBoost}`; }
        else { const h = Math.min(healItemAmount(hi, p), p.maxHp - p.hp); p.hp += h; note = `HP+${Math.round(h)}`; }
        spawnDmgText(p.x, p.y, p.z, note, '#7fffa0');
      }
    } else if(info.kind==='guts'){
      p.maxGuts += GUTS_ITEM.maxBoost;
      const r = Math.min(GUTS_ITEM.restore, p.maxGuts - p.guts);
      p.guts = Math.min(p.maxGuts, p.guts + GUTS_ITEM.restore);
      note = `ガッツ+${Math.round(r)}`;
      spawnDmgText(p.x, p.y, p.z, note, '#ffd9e3');
    } else if(info.kind==='weapon'){
      if(typeof window.sniperGive==='function'){ try{ window.sniperGive(p, info.ref); }catch(err){} }
      note = '装備した';
    } else if(info.kind==='scope'){
      if(typeof window.sniperAttachScope==='function'){ try{ window.sniperAttachScope(p, info.ref); }catch(err){} }
      note = '取り付けた';
    }
    exploreLootNotify(d.key, d.n, note);
    exploreLootPickupSe(info.rarity);
  }
  const col = exploreRarityColor(d.rarity);
  exploreLootFx({ type:'ring', x:d.x, y:d.y, z:d.z, color:col, dur:0.35, r0:40, r1:8 });
  for(let i=0;i<6;i++){
    const a = rand(0, Math.PI*2), sp = rand(30, 90);
    addParticle({ type:'spark', x:d.x, y:d.y, z:d.z + 20, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, life:0.4, maxLife:0.4, color:col, size:rand(2,3) });
  }
}
// 拾ったときの音(レア度で変える。金は特別な音)。素材は exploreGainMaterial から同じ関数を呼ぶ
function exploreLootPickupSe(rarity){
  if(rarity==='legendary'){ playSe('expLootLegend'); exploreLegendFlash(); }
  else if(rarity==='epic') playSe('expLootEpic');
  else playSe('pickup');
}

/* ===== 毎フレーム(updateExplore から) ===== */
function exploreLootUpdate(dt){
  if(!game.explore || game.over) return;
  const p = player;
  const pOk = p && p.alive;
  // 補給箱: 近くにとどまると開く(離れると進みは倍の速さで戻る)
  for(const c of exploreState.crates){
    if(c.opened) continue;
    if(pOk && Math.hypot(p.x-c.x, p.y-c.y) < EXPLORE_CRATE_OPEN_RANGE){
      c.hold += dt;
      if(c.hold >= EXPLORE_CRATE_OPEN_SEC) exploreOpenCrate(c);
    } else if(c.hold > 0){
      c.hold = Math.max(0, c.hold - dt*2);
    }
  }
  // 落ちている品: 着地と拾う
  const drops = exploreState.drops;
  for(let i=drops.length-1;i>=0;i--){
    const d = drops[i];
    if(!d.landed){
      if(matchTime < d.landAt) continue;
      d.landed = true;
      exploreLootFx({ type:'ring', x:d.x, y:d.y, z:d.z, color:exploreRarityColor(d.rarity), dur:0.45, r0:6, r1:54 });
    }
    if(!pOk || matchTime < d.landAt + EXPLORE_DROP_ARM_SEC) continue;
    if(Math.hypot(p.x-d.x, p.y-d.y) < (p.radius||26) + EXPLORE_DROP_PICK_RANGE){
      drops.splice(i, 1);
      exploreTakeDrop(d);
    }
  }
  // 拾った通知の置き場所を測り直す(行が出ているあいだだけ・0.25秒ごと)
  if(matchTime - (exploreState.feedLayoutAt || 0) > 0.25){
    exploreState.feedLayoutAt = matchTime;
    const feed = document.getElementById('expLootFeed');
    if(feed && feed.children.length) exploreFeedLayout(feed);
  }
  // 地面の輪などの一時的な光
  const fx = exploreState.lootFx;
  for(let i=fx.length-1;i>=0;i--){ if(matchTime > fx[i].t0 + fx[i].dur) fx.splice(i, 1); }
}
function exploreLootFx(f){
  f.t0 = matchTime + (f.delay || 0);
  exploreState.lootFx.push(f);
}

/* ===== 描画(render.js の render() から。深度ソートに乗せ、描くのは各エントリの draw) =====
   地面に接する物・立体物は project() で1点ずつ投影する(画面上で楕円・箱を決め打ちしない)。 */
function exploreLootDrawables(list){
  if(!game.explore) return;
  const cx = camPos.x, cy = camPos.y;
  for(const c of exploreState.crates){
    if(Math.hypot(c.x-cx, c.y-cy) > EXPLORE_CRATE_VIEW) continue;
    if(occludedByMountain(c.x, c.y, c.z + EXPLORE_CRATE_SIZE.h)) continue;
    const p = project(c.x, c.y, c.z);
    if(p) list.push({ kind:'exl', obj:c, p, draw:exploreDrawCrate });
  }
  for(const d of exploreState.drops){
    if(matchTime < d.bornAt) continue;
    if(Math.hypot(d.x-cx, d.y-cy) > EXPLORE_PILLAR_VIEW) continue;
    const pos = exploreDropPos(d);
    const H = EXPLORE_PILLAR_HEIGHT[d.rarity] || EXPLORE_PILLAR_HEIGHT.common;
    // 足元が山に隠れても、柱の先が見えていれば柱は出す(遠くから価値が分かるのが柱の役目)
    if(occludedByMountain(pos.x, pos.y, pos.z + (d.landed ? H : 20))) continue;
    const p = project(pos.x, pos.y, pos.z);
    if(p) list.push({ kind:'exl', obj:d, p, draw:exploreDrawDrop, pos });
  }
  for(const f of exploreState.lootFx){
    if(matchTime < f.t0) continue;
    const p = project(f.x, f.y, f.z);
    if(p) list.push({ kind:'exl', obj:f, p, draw:exploreDrawFx });
  }
}

// 1点ずつ投影した多角形を塗る(点が1つでもカメラの後ろなら描かない)
function _exlPoly(pts){
  if(pts.some(q=> !q)) return false;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  return true;
}
const EXPLORE_CRATE_LIGHT = (()=>{ const v = [-0.35, -0.55, 0.76], l = Math.hypot(v[0], v[1], v[2]); return v.map(x=> x/l); })();
function _exlShade(hexBase, n, k){
  // 面の向きと光の向きで明るさを変える(ランバート+環境光)
  const d = Math.max(0, n[0]*EXPLORE_CRATE_LIGHT[0] + n[1]*EXPLORE_CRATE_LIGHT[1] + n[2]*EXPLORE_CRATE_LIGHT[2]);
  const f = (0.42 + 0.58*d) * (k || 1);
  const c = hexBase;
  return `rgb(${Math.round(c[0]*f)},${Math.round(c[1]*f)},${Math.round(c[2]*f)})`;
}
const EXPLORE_CRATE_METAL = [70, 78, 90];      // 箱の地の金属色(暗い灰)。レア度の色は縁と帯だけに使う
const EXPLORE_CRATE_TRIM  = [36, 40, 48];      // 台座・蓋の縁の暗い色

/* 補給箱。胴(4面)+蓋(厚みのある板)を立体で描く。蓋は奥の辺を軸に開く。
   レア度の色は「帯・縁・地面の光」にだけ使う(箱全体を塗るとおもちゃに見える) */
function exploreDrawCrate(c, p0){
  const S = EXPLORE_CRATE_SIZE;
  // 遠い箱は細部(補強材・地面の光・影)を省く。その距離では数pxなので見た目は変わらない
  const far = !!(p0 && p0.depth > 2400);
  const W = S.w/2, D = S.d/2, H = S.h;
  const ca = Math.cos(c.angle), sa = Math.sin(c.angle);
  const wx = (lx, ly)=> c.x + lx*ca - ly*sa;
  const wy = (lx, ly)=> c.y + lx*sa + ly*ca;
  const P = (lx, ly, lz)=> project(wx(lx, ly), wy(lx, ly), c.z + lz);
  const rotN = (n)=> [n[0]*ca - n[1]*sa, n[0]*sa + n[1]*ca, n[2]];
  const faces = (n, cxl, cyl, czl)=>{
    const wn = rotN(n);
    const vx = camPos.x - wx(cxl, cyl), vy = camPos.y - wy(cxl, cyl), vz = camPos.z - (c.z + czl);
    return { wn, vis: wn[0]*vx + wn[1]*vy + wn[2]*vz > 0 };
  };
  const col = exploreRarityColor(c.rarity);
  const ord = exploreRarityOrder(c.rarity);
  const heavy = renderHeavyLoad;
  const pulse = 0.7 + 0.3*Math.sin(matchTime*3.2 + c.id);
  const openT = c.opened ? clamp((matchTime - c.openedAt) / EXPLORE_CRATE_LID_SEC, 0, 1) : 0;
  // 蓋の角度: 行き過ぎて戻る(easeOutBack)で「バン」と開く
  const eb = (t)=>{ const s = 1.70158; const u = t - 1; return 1 + (s+1)*u*u*u + s*u*u; };
  const lidA = c.opened ? eb(openT) * 1.95 : 0;   // 約112度
  ctx.save();

  // --- 地面の光(レア以上は常に。閉じている間だけ) ---
  if(!c.opened && ord >= 1 && !far){
    const ring = groundCirclePoints(c.x, c.y, 58 + ord*6, 28);
    if(ring){
      ctx.globalCompositeOperation = 'lighter';
      _exlPoly(ring);
      ctx.fillStyle = exploreRgba(col, (0.07 + ord*0.03) * pulse); ctx.fill();
      ctx.strokeStyle = exploreRgba(col, 0.35 * pulse); ctx.lineWidth = 1.2; ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  // --- 接地の影 ---
  if(!far){ const sh = groundCirclePoints(c.x, c.y, W*1.15, 20);
    if(sh){ _exlPoly(sh); ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill(); } }

  // --- 胴の4面 ---
  const bodySides = [
    { n:[0,-1,0], q:[[-W,-D],[W,-D]], c:[0,-D] },
    { n:[0, 1,0], q:[[W, D],[-W, D]], c:[0, D] },
    { n:[-1,0,0], q:[[-W, D],[-W,-D]], c:[-W,0] },
    { n:[ 1,0,0], q:[[W,-D],[W, D]], c:[W, 0] },
  ];
  const drawBody = ()=>{
    for(const f of bodySides){
      const v = faces(f.n, f.c[0], f.c[1], H/2);
      if(!v.vis) continue;
      const [a, b] = f.q;
      // 面
      if(_exlPoly([P(a[0],a[1],0), P(b[0],b[1],0), P(b[0],b[1],H), P(a[0],a[1],H)])){
        ctx.fillStyle = _exlShade(EXPLORE_CRATE_METAL, v.wn); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1; ctx.stroke();
      }
      // 台座(下の暗い帯)
      if(_exlPoly([P(a[0],a[1],0), P(b[0],b[1],0), P(b[0],b[1],H*0.14), P(a[0],a[1],H*0.14)])){
        ctx.fillStyle = _exlShade(EXPLORE_CRATE_TRIM, v.wn); ctx.fill();
      }
      // 縦の補強材(両端)
      if(!far) for(const t of [0.08, 0.92]){
        const lx = a[0] + (b[0]-a[0])*t, ly = a[1] + (b[1]-a[1])*t;
        const lx2 = a[0] + (b[0]-a[0])*(t + (t<0.5 ? 0.07 : -0.07)), ly2 = a[1] + (b[1]-a[1])*(t + (t<0.5 ? 0.07 : -0.07));
        if(_exlPoly([P(lx,ly,0), P(lx2,ly2,0), P(lx2,ly2,H), P(lx,ly,H)])){
          ctx.fillStyle = _exlShade(EXPLORE_CRATE_TRIM, v.wn, 1.15); ctx.fill();
        }
      }
      // レア度の光の帯(真ん中の高さ。補強材の内側だけ)
      const e0 = [a[0] + (b[0]-a[0])*0.17, a[1] + (b[1]-a[1])*0.17], e1 = [a[0] + (b[0]-a[0])*0.83, a[1] + (b[1]-a[1])*0.83];
      if(_exlPoly([P(e0[0],e0[1],H*0.46), P(e1[0],e1[1],H*0.46), P(e1[0],e1[1],H*0.6), P(e0[0],e0[1],H*0.6)])){
        if(!heavy){ ctx.shadowBlur = 8 + ord*4; ctx.shadowColor = col; }
        ctx.fillStyle = exploreRgba(col, c.opened ? 0.55 : 0.75 + 0.25*pulse); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  };
  // --- 蓋(奥の辺 ly=-D, lz=H を軸に lidA だけ開く) ---
  const L = S.lid, OV = 2;   // 厚み・はみ出し
  const lidPt = (lx, ly, lz)=>{
    const dy = ly + D, dz = lz - H;
    const ry = dy*Math.cos(lidA) - dz*Math.sin(lidA), rz = dy*Math.sin(lidA) + dz*Math.cos(lidA);
    return [lx, -D + ry, H + rz];
  };
  const lidN = (n)=> [n[0], n[1]*Math.cos(lidA) - n[2]*Math.sin(lidA), n[1]*Math.sin(lidA) + n[2]*Math.cos(lidA)];
  const LP = (lx, ly, lz)=>{ const q = lidPt(lx, ly, lz); return P(q[0], q[1], q[2]); };
  const drawLid = ()=>{
    const X = W + OV, Y0 = -D - OV, Y1 = D + OV;
    const lidFaces = [
      { n:[0,0, 1], pts:[[-X,Y0,H+L],[X,Y0,H+L],[X,Y1,H+L],[-X,Y1,H+L]], top:true },
      { n:[0,0,-1], pts:[[-X,Y0,H],[X,Y0,H],[X,Y1,H],[-X,Y1,H]], under:true },
      { n:[0, 1,0], pts:[[-X,Y1,H],[X,Y1,H],[X,Y1,H+L],[-X,Y1,H+L]], front:true },
      { n:[0,-1,0], pts:[[-X,Y0,H],[X,Y0,H],[X,Y0,H+L],[-X,Y0,H+L]] },
      { n:[-1,0,0], pts:[[-X,Y0,H],[-X,Y1,H],[-X,Y1,H+L],[-X,Y0,H+L]] },
      { n:[ 1,0,0], pts:[[X,Y0,H],[X,Y1,H],[X,Y1,H+L],[X,Y0,H+L]] },
    ];
    for(const f of lidFaces){
      const ln = lidN(f.n);
      const ctr = lidPt(f.pts.reduce((s,q)=>s+q[0],0)/4, f.pts.reduce((s,q)=>s+q[1],0)/4, f.pts.reduce((s,q)=>s+q[2],0)/4);
      const v = faces(ln, ctr[0], ctr[1], ctr[2]);
      if(!v.vis) continue;
      if(!_exlPoly(f.pts.map(q=> LP(q[0], q[1], q[2])))) continue;
      ctx.fillStyle = f.under ? _exlShade(EXPLORE_CRATE_TRIM, v.wn, 0.9) : _exlShade(EXPLORE_CRATE_METAL, v.wn, f.top ? 1.12 : 0.95);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      if(f.top){
        // 縁の面取り(光を受ける細い線)。箱が「塗った四角」ではなく金属の板に見える
        ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.2; ctx.stroke();
        const inset = f.pts.map(q=> LP(q[0]*0.86, q[1]*0.8, q[2]));
        if(_exlPoly(inset)){ ctx.fillStyle = _exlShade(EXPLORE_CRATE_TRIM, v.wn, 1.25); ctx.fill(); }
        // 蓋の上の印(レア度の色の山形 2本)
        for(const off of [-0.18, 0.18]){
          const y0 = off*D*2;
          const pts = [[-X*0.62, y0 - D*0.10, H+L], [0, y0 + D*0.22, H+L], [X*0.62, y0 - D*0.10, H+L],
                       [X*0.62, y0 - D*0.24, H+L], [0, y0 + D*0.08, H+L], [-X*0.62, y0 - D*0.24, H+L]];
          if(_exlPoly(pts.map(q=> LP(q[0], q[1], q[2])))){
            if(!heavy){ ctx.shadowBlur = 6 + ord*3; ctx.shadowColor = col; }
            ctx.fillStyle = exploreRgba(col, c.opened ? 0.5 : 0.65 + 0.3*pulse); ctx.fill();
            ctx.shadowBlur = 0;
          }
        }
      } else if(f.front && !f.under){
        // 蓋の前の縁はレア度の色に光る
        if(!heavy){ ctx.shadowBlur = 10 + ord*4; ctx.shadowColor = col; }
        ctx.fillStyle = exploreRgba(col, c.opened ? 0.45 : 0.55 + 0.4*pulse); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  };
  // 開いた箱の中(暗い底+レア度の光が湧く)
  const drawInside = ()=>{
    const q = [P(-W+3,-D+3,H), P(W-3,-D+3,H), P(W-3,D-3,H), P(-W+3,D-3,H)];
    if(!_exlPoly(q)) return;
    ctx.fillStyle = '#0b0f14'; ctx.fill();
    const age = matchTime - c.openedAt;
    const glow = Math.max(0.18, 1 - age/2.5);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = exploreRgba(col, 0.55*glow); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  };
  // 開いた瞬間の光の柱(箱の中から上へ)
  const drawBurstBeam = ()=>{
    const age = matchTime - c.openedAt;
    if(age < 0 || age > 1.6) return;
    const k = age < 0.15 ? age/0.15 : 1 - (age-0.15)/1.45;
    const b0 = P(0, 0, H), b1 = P(0, 0, H + 260 + ord*60);
    if(!b0 || !b1) return;
    const w0 = Math.max(4, W*0.9*b0.scale), w1 = w0*2.2;
    const g = ctx.createLinearGradient(0, b0.y, 0, b1.y);
    g.addColorStop(0, exploreRgba(col, 0.75*k)); g.addColorStop(0.35, exploreRgba(col, 0.3*k)); g.addColorStop(1, exploreRgba(col, 0));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(b0.x - w0, b0.y); ctx.lineTo(b1.x - w1, b1.y); ctx.lineTo(b1.x + w1, b1.y); ctx.lineTo(b0.x + w0, b0.y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = exploreRgba('#ffffff', 0.35*k);
    ctx.beginPath(); ctx.moveTo(b0.x - w0*0.3, b0.y); ctx.lineTo(b1.x - w0*0.2, b1.y); ctx.lineTo(b1.x + w0*0.2, b1.y); ctx.lineTo(b0.x + w0*0.3, b0.y); ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  };

  if(!c.opened){
    drawBody();
    drawLid();
    // 角の灯り(蓋の前の2隅。レア度の色で点る)
    for(const sx of [-1, 1]){
      const q = LP(sx*(W+OV-3), D+OV, H+L*0.5);
      if(!q) continue;
      const r = Math.max(1.5, 3.2*q.scale);
      if(!heavy){ ctx.shadowBlur = 8 + ord*3; ctx.shadowColor = col; }
      ctx.fillStyle = exploreRgba('#ffffff', 0.9); ctx.beginPath(); ctx.arc(q.x, q.y, r*0.55, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = exploreRgba(col, 0.85*pulse); ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    // 紫・金の箱は上に淡い光が立つ(遠くから「良い箱」だと分かる。品の光の柱よりずっと低く淡い)
    if(ord >= 2){
      const b0 = P(0, 0, H + L), b1 = P(0, 0, H + L + 90 + ord*25);
      if(b0 && b1){
        const w0 = Math.max(3, W*0.8*b0.scale);
        const g = ctx.createLinearGradient(0, b0.y, 0, b1.y);
        g.addColorStop(0, exploreRgba(col, 0.28*pulse)); g.addColorStop(1, exploreRgba(col, 0));
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(b0.x - w0, b0.y); ctx.lineTo(b1.x - w0*0.4, b1.y); ctx.lineTo(b1.x + w0*0.4, b1.y); ctx.lineTo(b0.x + w0, b0.y); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  } else {
    // 開いた蓋はカメラから遠い側を先に描く(箱の向こうへ倒れた蓋は胴に隠れる)
    const lc = lidPt(0, 0, H + L/2);
    const dl = Math.hypot(camPos.x - wx(lc[0], lc[1]), camPos.y - wy(lc[0], lc[1]));
    const db = Math.hypot(camPos.x - c.x, camPos.y - c.y);
    if(dl > db){ drawLid(); drawBody(); drawInside(); }
    else { drawBody(); drawInside(); drawLid(); }
    drawBurstBeam();
  }

  // --- 近づいたら名前と開ける進み(地面の弧) ---
  if(!c.opened && player){
    const dp = Math.hypot(player.x - c.x, player.y - c.y);
    if(c.hold > 0){
      const prog = clamp(c.hold / EXPLORE_CRATE_OPEN_SEC, 0, 1);
      const segs = Math.max(3, Math.round(40*prog));
      const pts = [];
      for(let i=0;i<=segs;i++){
        const a = -Math.PI/2 + (i/40)*Math.PI*2;
        const x = c.x + Math.cos(a)*(W+26), y = c.y + Math.sin(a)*(W+26);
        const q = project(x, y, groundZAt(x, y) + 1);
        if(q) pts.push(q);
      }
      if(pts.length > 1){
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for(const q of pts) ctx.lineTo(q.x, q.y);
        if(!heavy){ ctx.shadowBlur = 10; ctx.shadowColor = col; }
        ctx.strokeStyle = exploreRgba(col, 0.95); ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.stroke();
        ctx.shadowBlur = 0; ctx.lineCap = 'butt';
      }
    }
    if(dp < 420){
      const tp = P(0, 0, H + L + 26);
      if(tp){
        const rar = EXPLORE_RARITY[c.rarity] || EXPLORE_RARITY.common;
        const fs = clamp(11*tp.scale, 9, 14);
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.font = `700 ${fs}px 'Rajdhani', sans-serif`;
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        const t1 = `補給箱・${rar.label}`;
        ctx.strokeText(t1, tp.x, tp.y); ctx.fillStyle = col; ctx.fillText(t1, tp.x, tp.y);
        if(dp < EXPLORE_CRATE_OPEN_RANGE + 140){
          ctx.font = `600 ${Math.max(9, fs-2)}px 'Rajdhani', sans-serif`;
          const t2 = c.hold > 0 ? '開けています…' : '近くにとどまると開く';
          ctx.strokeText(t2, tp.x, tp.y + fs + 2); ctx.fillStyle = 'rgba(240,240,240,0.92)'; ctx.fillText(t2, tp.x, tp.y + fs + 2);
        }
      }
    }
  }
  ctx.restore();
}

/* 光の柱。地面から上へ淡く消える縦の光(加算)。遠くでは細く(最小 EXPLORE_PILLAR_MIN_PX)、
   近くでは地面に輪を出す。高さ・太さ・色はレア度で決まる */
function exploreDrawPillar(x, y, z, rarity, grow, depth){
  const H = (EXPLORE_PILLAR_HEIGHT[rarity] || 150) * grow;
  const pb = project(x, y, z), pt = project(x, y, z + H);
  if(!pb || !pt || H < 1) return;
  const col = exploreRarityColor(rarity);
  const ord = exploreRarityOrder(rarity);
  const flick = 0.85 + 0.15*Math.sin(matchTime*5 + x*0.01);
  const w = Math.max(EXPLORE_PILLAR_MIN_PX, (EXPLORE_PILLAR_WIDTH[rarity] || 8) * pb.scale);
  const wt = w * 0.45;
  // 遠いほど少し明るく(細くなって見えなくなるのを防ぐ)
  const far = clamp((depth - 1500) / 4000, 0, 1);
  const a0 = (0.5 + 0.1*ord + 0.25*far) * flick;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(pb.x, pb.y, pt.x, pt.y);
  g.addColorStop(0, exploreRgba(col, a0)); g.addColorStop(0.55, exploreRgba(col, a0*0.35)); g.addColorStop(1, exploreRgba(col, 0));
  ctx.fillStyle = g;
  // 外側のにじみ
  ctx.beginPath(); ctx.moveTo(pb.x - w*1.8, pb.y); ctx.lineTo(pt.x - wt*1.8, pt.y); ctx.lineTo(pt.x + wt*1.8, pt.y); ctx.lineTo(pb.x + w*1.8, pb.y); ctx.closePath(); ctx.fill();
  // 芯(白く寄せる)
  const g2 = ctx.createLinearGradient(pb.x, pb.y, pt.x, pt.y);
  g2.addColorStop(0, exploreRgba('#ffffff', 0.55*flick)); g2.addColorStop(0.4, exploreRgba(col, 0.35)); g2.addColorStop(1, exploreRgba(col, 0));
  ctx.fillStyle = g2;
  ctx.beginPath(); ctx.moveTo(pb.x - w*0.4, pb.y); ctx.lineTo(pt.x - wt*0.3, pt.y); ctx.lineTo(pt.x + wt*0.3, pt.y); ctx.lineTo(pb.x + w*0.4, pb.y); ctx.closePath(); ctx.fill();
  // 金・紫は柱を昇る光の粒
  if(ord >= 2 && depth < 2600){
    for(let i=0;i<3;i++){
      const u = ((matchTime*0.45 + i/3 + x*0.0007) % 1);
      const q = project(x, y, z + H*u);
      if(!q) continue;
      ctx.fillStyle = exploreRgba(col, 0.9*(1-u));
      ctx.beginPath(); ctx.arc(q.x + Math.sin(u*9 + i)*w*0.6, q.y, Math.max(1.2, 2.4*q.scale), 0, Math.PI*2); ctx.fill();
    }
  }
  ctx.restore();
  // 近くでは地面に輪
  if(depth < EXPLORE_PILLAR_RING_DEPTH){
    const r = 26 + ord*4 + 4*Math.sin(matchTime*3 + x);
    const ring = groundCirclePoints(x, y, r, 22);
    if(ring){
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      _exlPoly(ring);
      ctx.fillStyle = exploreRgba(col, 0.12 + 0.04*ord); ctx.fill();
      ctx.strokeStyle = exploreRgba(col, 0.75); ctx.lineWidth = 1.6; ctx.stroke();
      ctx.restore();
    }
  }
}
// 品物のしるし(レア度の色の菱形+アイコン)。画面の大きさは投影のスケールで決まる
function exploreDrawDropBadge(q, info, rarity, alpha){
  const col = exploreRarityColor(rarity);
  const s = clamp(q.scale, 0.35, 2.2);
  const R = 12*s;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(q.x, q.y);
  if(!renderHeavyLoad){ ctx.shadowBlur = 10 + exploreRarityOrder(rarity)*4; ctx.shadowColor = col; }
  ctx.beginPath(); ctx.moveTo(0, -R); ctx.lineTo(R, 0); ctx.lineTo(0, R); ctx.lineTo(-R, 0); ctx.closePath();
  const g = ctx.createLinearGradient(0, -R, 0, R);
  g.addColorStop(0, exploreRgba(col, 0.95)); g.addColorStop(1, exploreRgba(col, 0.55));
  ctx.fillStyle = g; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.moveTo(0, -R*0.78); ctx.lineTo(R*0.78, 0); ctx.lineTo(0, R*0.78); ctx.lineTo(-R*0.78, 0); ctx.closePath();
  ctx.fillStyle = 'rgba(8,12,18,0.88)'; ctx.fill();
  ctx.font = `${Math.round(R*1.05)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(info.icon, 0, R*0.06);
  ctx.restore();
}
function exploreDrawDrop(d, p, entry){
  const info = exploreItemInfo(d.key);
  if(!info) return;
  const pos = (entry && entry.pos) || exploreDropPos(d);
  const col = exploreRarityColor(d.rarity);
  if(!d.landed && matchTime < d.landAt){
    // 飛んでいる途中: しるし+短い光の尾(0.07秒前の位置から今の位置へ)
    const s0 = clamp((matchTime - 0.07 - d.bornAt) / Math.max(0.01, d.landAt - d.bornAt), 0, 1);
    const tq = project(d.sx + (d.x-d.sx)*s0, d.sy + (d.y-d.sy)*s0, d.sz + (d.z-d.sz)*s0 + 4*d.arc*s0*(1-s0));
    const q = project(pos.x, pos.y, pos.z);
    if(q && tq){
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = exploreRgba(col, 0.8); ctx.lineCap = 'round'; ctx.lineWidth = Math.max(2, 6*q.scale);
      ctx.beginPath(); ctx.moveTo(tq.x, tq.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      ctx.restore();
      exploreDrawDropBadge(q, info, d.rarity, 1);
    }
    return;
  }
  const grow = clamp((matchTime - d.landAt) / 0.35, 0, 1);
  const eo = 1 - Math.pow(1 - grow, 3);
  exploreDrawPillar(d.x, d.y, d.z, d.rarity, eo, p.depth);
  if(p.depth > EXPLORE_DROP_ITEM_VIEW) return;
  const bob = Math.sin(matchTime*2.6 + d.bob)*4;
  const q = project(d.x, d.y, d.z + 22 + bob);
  if(!q) return;
  exploreDrawDropBadge(q, info, d.rarity, 1);
  if(player && Math.hypot(player.x - d.x, player.y - d.y) < EXPLORE_DROP_LABEL_RANGE){
    const fs = clamp(10*q.scale, 9, 13);
    ctx.save();
    ctx.font = `700 ${fs}px 'Rajdhani', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const t = `${info.name}${d.n > 1 ? ' ×'+d.n : ''}`;
    const ty = q.y - 16*clamp(q.scale, 0.35, 2.2);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(t, q.x, ty);
    ctx.fillStyle = col; ctx.fillText(t, q.x, ty);
    ctx.restore();
  }
}
function exploreDrawFx(f){
  const k = clamp((matchTime - f.t0) / f.dur, 0, 1);
  if(f.type==='ring'){
    const r = f.r0 + (f.r1 - f.r0) * (1 - Math.pow(1-k, 2));
    const pts = groundCirclePoints(f.x, f.y, Math.max(2, r), 30);
    if(!pts) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    _exlPoly(pts);
    ctx.strokeStyle = exploreRgba(f.color, 0.9*(1-k)); ctx.lineWidth = 3*(1-k) + 1; ctx.stroke();
    ctx.fillStyle = exploreRgba(f.color, 0.12*(1-k)); ctx.fill();
    ctx.restore();
  }
}

/* ===== 拾った通知(画面の左に積み上がるレア度色の行) =====
   #hud の中に1つだけ作る(pointer-events:none。押す物が無いのでスクロールロック除外は不要)。
   同じ品を続けて拾ったら行を増やさず個数をまとめる。古い行から消える。 */
function exploreFeedRoot(){
  let el = document.getElementById('expLootFeed');
  if(el) return el;
  const hud = document.getElementById('hud');
  if(!hud) return null;
  el = document.createElement('div');
  el.id = 'expLootFeed';
  hud.appendChild(el);
  return el;
}
function exploreFeedPush(row){
  const root = exploreFeedRoot();
  if(!root) return;
  const now = performance.now();
  let n = Math.max(1, Math.floor(row.n || 1));
  if(row.key){
    for(const el of root.children){
      if(el.dataset.key === row.key && !el.classList.contains('is-out') && now - Number(el.dataset.t) < EXPLORE_FEED_MERGE_SEC*1000){
        n += Number(el.dataset.n) || 0;
        clearTimeout(el._expTimer);
        el.remove();
        break;
      }
    }
  }
  const el = document.createElement('div');
  el.className = 'exp-feed-row';
  el.dataset.key = row.key || '';
  el.dataset.n = String(n);
  el.dataset.t = String(now);
  el.dataset.rar = row.rarity || 'common';
  const rc = row.color || exploreRarityColor(row.rarity);
  el.style.setProperty('--rc', rc);
  el.style.setProperty('--rc-soft', exploreRgba(rc, 0.34));     // CSS 側で色を混ぜない(古い iOS の Safari に color-mix が無い)
  el.style.setProperty('--rc-strong', exploreRgba(rc, 0.55));
  const esc = (s)=> String(s == null ? '' : s).replace(/[&<>"]/g, (ch)=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  el.innerHTML = `<span class="exp-feed-ico">${esc(row.icon)}</span>`
    + `<span class="exp-feed-main"><span class="exp-feed-name">${esc(row.name)}</span>`
    + `<span class="exp-feed-sub">${esc(row.sub)}</span></span>`
    + (row.showN === false ? '' : `<span class="exp-feed-n">×${n}</span>`);
  root.appendChild(el);
  exploreFeedLayout(root);
  el._expTimer = setTimeout(()=>{
    el.classList.add('is-out');
    el._expTimer = setTimeout(()=> el.remove(), 420);
  }, (row.sec || EXPLORE_FEED_SEC) * 1000);
}
/* 箱は画面から決める(R1): 左上のステータス欄の下端〜ジョイスティックの上端が使える縦幅。
   入らない行は古い方から消す(行数の上限 EXPLORE_FEED_MAX と、使える縦幅の小さい方)。
   ステータス欄は試合中に行が増えて背が伸びる(装備・トレーニングの効果)ので、行があるあいだは
   exploreLootUpdate からも測り直す */
function exploreFeedLayout(root){
  root = root || document.getElementById('expLootFeed');
  if(!root || !root.parentNode) return;
  const hud = root.parentNode;
  const tl = document.getElementById('topLeft'), js = document.getElementById('joystickBase');
  const top = tl ? tl.offsetTop + tl.offsetHeight + 8 : 150;
  const bottom = (js && js.offsetTop > 0) ? js.offsetTop - 10 : hud.clientHeight - 160;
  const st = top + 'px', sh = Math.max(30, bottom - top) + 'px';
  if(root.style.top !== st) root.style.top = st;
  if(root.style.height !== sh) root.style.height = sh;
  const rowsH = ()=>{ let h = 0; for(const r of root.children) h += r.offsetHeight + 4; return h; };
  while(root.children.length > 1 && (root.children.length > EXPLORE_FEED_MAX || rowsH() > root.clientHeight + 4)){
    const f = root.firstChild; clearTimeout(f._expTimer); f.remove();
  }
}
// 品を拾った通知(素材・回復・狙撃銃…すべてこれ)
function exploreLootNotify(key, n, note){
  const info = exploreItemInfo(key);
  if(!info) return;
  const rar = EXPLORE_RARITY[info.rarity] || EXPLORE_RARITY.common;
  exploreFeedPush({ key, n, icon:info.icon, name:info.name, rarity:info.rarity,
                    sub: note ? `${rar.label}・${note}` : rar.label });
}
// 金を拾ったときの画面のふちの金の光(1回きりのCSSアニメーション。自分で消える)
function exploreLegendFlash(){
  const hud = document.getElementById('hud');
  if(!hud) return;
  const el = document.createElement('div');
  el.className = 'exp-legend-flash';
  el.style.setProperty('--rc-strong', exploreRgba(EXPLORE_RARITY.legendary.color, 0.6));
  hud.appendChild(el);
  setTimeout(()=> el.remove(), 1200);
}
// 探検の状態を戻すとき(exploreResetState から)。通知の行を消す
function exploreLootReset(){
  const el = document.getElementById('expLootFeed');
  if(el){ for(const r of el.children) clearTimeout(r._expTimer); el.innerHTML = ''; }
  document.querySelectorAll('.exp-legend-flash').forEach(e=> e.remove());
}

/* ===== 装備の効果(探検の開始時だけ。**探検以外では呼ばない**=PvPの力関係を変えない) =====
   効果の合計は data.js の exploreGearTotals 1か所(工房の表示と同じ数字)。
   掛ける先は既存の倍率(trainDmgTakenMult / trainSpeedMult / trainDmgMult / mastermonGutsRegenMult)なので、
   ダメージ計算・移動・ガッツ回復の側に新しい分岐は要らない。探検のプレイヤーは毎回作り直すので持ち越さない。 */
function exploreApplyGear(p){
  if(!p || !game.explore) return null;
  const gear = loadExploreGear();
  const tot = exploreGearTotals(gear.equip);
  const fx = tot.fx;
  if(fx.hpPct){ p.maxHp = Math.round(p.maxHp * (1 + fx.hpPct)); p.hp = p.maxHp; }
  if(fx.dmgTakenPct) p.trainDmgTakenMult = (p.trainDmgTakenMult || 1) * Math.max(0.1, 1 + fx.dmgTakenPct);
  if(fx.speedPct) p.trainSpeedMult = (p.trainSpeedMult || 1) * (1 + fx.speedPct);
  if(fx.gutsRegenPct) p.mastermonGutsRegenMult = (p.mastermonGutsRegenMult || 1) * (1 + fx.gutsRegenPct);
  if(fx.dmgPct) p.trainDmgMult = (p.trainDmgMult || 1) * (1 + fx.dmgPct);
  p.sniperDmgMult = 1 + (fx.snipePct || 0);   // sniper.js が弾の威力に掛ける
  const w = EXPLORE_GEAR[gear.equip.weapon];
  p.exploreGear = { equip:{ ...gear.equip }, fx, weapon: w ? w.sniper : null };
  // 武器: 狙撃担当の口があるときだけ渡す。知らないキーなら標準の狙撃銃
  if(w && typeof window.sniperGive==='function'){
    let ok = false;
    try{ ok = window.sniperGive(p, w.sniper) !== false; }catch(err){ ok = false; }
    if(!ok){ try{ window.sniperGive(p, 'longbow'); }catch(err){} }
  }
  const txt = exploreGearFxText(fx);
  if(txt){
    const n = Object.keys(gear.equip).length;
    exploreFeedPush({ icon:'⚒️', name:`工房の装備 ${n}部位が効いている`, sub:txt, rarity:'legendary', color:'#ffb347', showN:false, sec:5 });
  }
  return tot;
}

/* ===== 効果音(Web Audio合成。audio.js の SE_DEFS へ足すだけ。playSe の名前で鳴る) ===== */
(function exploreLootRegisterSe(){
  if(typeof SE_DEFS==='undefined') return;
  // 補給箱が開く: 留め金の「ガチャ」+ 蓋が跳ね上がる空気 + きらめき
  SE_DEFS.expCrateOpen = function(t){
    seNoise(t, { dur:0.05, vol:0.45, filterType:'bandpass', filterFreq:2400, filterEnd:1200 });
    seTone(t, { freq:180, freqEnd:90, dur:0.12, type:'square', vol:0.22, attack:0.002 });
    seNoise(t+0.05, { dur:0.22, vol:0.3, filterType:'bandpass', filterFreq:900, filterEnd:3800 });
    [880, 1320, 1760].forEach((f, i)=> seTone(t+0.14+i*0.05, { freq:f, dur:0.22, type:'triangle', vol:0.16 }));
  };
  // エピック(紫)を拾う: 上がっていく3音
  SE_DEFS.expLootEpic = function(t){
    [659, 988, 1319].forEach((f, i)=> seTone(t+i*0.06, { freq:f, dur:0.28, type:'triangle', vol:0.22 }));
    seTone(t+0.18, { freq:2637, dur:0.3, type:'sine', vol:0.08 });
  };
  // レジェンド(金)を拾う/金の箱が開く: 低い響き+きらめく和音(特別な音)
  SE_DEFS.expLootLegend = function(t){
    seTone(t, { freq:110, freqEnd:220, dur:0.6, type:'sine', vol:0.3, attack:0.02 });
    [523, 659, 784, 1047, 1319].forEach((f, i)=> seTone(t+0.04+i*0.07, { freq:f, dur:0.9 - i*0.08, type:'triangle', vol:0.2 }));
    for(let i=0;i<6;i++) seTone(t+0.35+i*0.05, { freq:2093 + i*330, dur:0.18, type:'sine', vol:0.07 });
    seNoise(t+0.3, { dur:0.6, vol:0.08, filterType:'highpass', filterFreq:6000 });
  };
  // 工房: 槌で打つ「カーン」
  SE_DEFS.expForgeHit = function(t){
    seNoise(t, { dur:0.04, vol:0.5, filterType:'bandpass', filterFreq:5200, filterEnd:2600 });
    [1180, 3257, 6372].forEach((f, i)=> seTone(t, { freq:f, dur:0.35 - i*0.08, type:i ? 'sine' : 'square', vol:[0.2,0.12,0.06][i], attack:0.001 }));
  };
  // 工房: 完成
  SE_DEFS.expForgeDone = function(t){
    [392, 523, 659, 784].forEach((f, i)=> seTone(t+i*0.08, { freq:f, dur:0.5, type:'triangle', vol:0.22 }));
    seTone(t+0.32, { freq:1047, dur:0.7, type:'sine', vol:0.18 });
    seNoise(t+0.3, { dur:0.5, vol:0.07, filterType:'highpass', filterFreq:5000 });
  };
})();
