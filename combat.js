// tier3技のエフェクトスタイル → 専用SE名の対応表
/* **この表の値は tools/studio_web.html の SE_FALLBACK にも同じものを持っている。**
   スタジオはゲームを読み込まずに単体で動くので、プレビューを開く前でもSEを選べるように
   一覧を写してある。ここへ音を足したらあちらへも足すこと(ずれていないことは
   `node tools/studio_regress.mjs --only se` が毎回見る)。 */
const MOVE_SE_BY_STYLE = {
  inferno:'fireRoar', lava:'fireRoar', crystal:'iceCrack',
  psychic:'beam', sakura:'beam', flower:'beam', galaxy:'beam',
  tornado:'tornado', shell:'spin', holy:'bell', requiem:'whoosh',
  godorb:'godRising', crescent:'zashu', scythe:'zashu', voidOrb:'voidLaunch',
  // ワーム「シェルアタック」が範囲技(rollingShell)になったので、旧・弾のprojStyle:'shell'が
  // 使っていた音をそのまま引き継ぐ(shellキー自体はもう技から参照されない=実質死んでいるが、
  // 値のずれを防ぐため残してある)
  rollingShell:'spin',
  // 電王ライナー「俺、参上」: ファイアウェーブ/インフェルノと同じ轟音を新幹線の発車音に流用
  shinkansen:'fireRoar',
};
// SSRスキン装備時にtier3技を専用SEへ差し替える対応表(スキンID → SE名)
const SKIN_TIER3_SE = { zeus_ssr:'zeusTier3', choco_ssr:'chocoVanish', persephone_ssr:'amphitrite',
                        rock_ssr:'gokongo', aqua_ssr:'rize', guts_ssr:'gutsTier3' };
// SSRスキン装備時に召喚演出SE/被弾SEを差し替える対応表(スキンID → SE名)
const SKIN_SUMMON_SE = { choco_ssr:'chocoSummon' };
const SKIN_HIT_SE    = { choco_ssr:'chocoHit', aqua_ssr:'rizeHit' };
// 同・撃破時/勝利時のSE(スキンID → SE名)。未登録なら従来の kill / fanfare が鳴る
/* tier3を**当てた**ときに鳴る専用SE(被弾のSKIN_HIT_SEとは別物)。
   無ければ従来どおり 'hitDealt' が鳴る。SKIN_MEDIA の se.tier3hit から自動で入る。 */
const SKIN_TIER3_HIT_SE = {};
const SKIN_KILL_SE   = { rock_ssr:'gokongoKill', aqua_ssr:'aquaKill' };
const SKIN_WIN_SE    = { rock_ssr:'gokongoWin', aqua_ssr:'rizeKill' };
/* data.js の SKIN_MEDIA に専用SEのmp3が登録されているスキンは、上の表へ自動で入れる
   (ツールから追加したスキンはコードを書かずに専用SEが鳴る)。上の表に手書きの指定が
   あるスキンはそちらが優先される(ちょこの召喚SEは内蔵データURIなので手書きのまま)。 */
Object.keys(typeof SKIN_MEDIA!=='undefined' ? SKIN_MEDIA : {}).forEach(id=>{
  const table = { summon:SKIN_SUMMON_SE, tier3:SKIN_TIER3_SE, tier3hit:SKIN_TIER3_HIT_SE,
                    hit:SKIN_HIT_SE, kill:SKIN_KILL_SE, win:SKIN_WIN_SE };
  Object.keys(table).forEach(slot=>{
    if(table[slot][id]) return;
    const name = (typeof skinMediaSeName==='function') ? skinMediaSeName(id, slot) : null;
    if(name) table[slot][id] = name;
  });
});
// ウンディーネの特性「与えたダメージの一部を自分のHPへ」の基本割合。
// 技側の lifestealMult で倍にできる(大喰いの利世の鱗赫)
const AQUA_LIFESTEAL = 0.2;
function skinSummonSeName(entity){
  const sid = (typeof entitySkinId==='function') ? entitySkinId(entity) : null;
  return (sid && SKIN_SUMMON_SE[sid]) || null;
}
function skinHitSeName(entity){
  const sid = (typeof entitySkinId==='function') ? entitySkinId(entity) : null;
  return (sid && SKIN_HIT_SE[sid]) || null;
}
function skinKillSeName(entity){
  const sid = (typeof entitySkinId==='function') ? entitySkinId(entity) : null;
  return (sid && SKIN_KILL_SE[sid]) || null;
}
function skinWinSeName(entity){
  const sid = (typeof entitySkinId==='function') ? entitySkinId(entity) : null;
  return (sid && SKIN_WIN_SE[sid]) || null;
}
function moveSeName(move, attacker){
  if(move.tier===3 && attacker){
    const sid = (typeof entitySkinId==='function') ? entitySkinId(attacker) : null;
    if(sid && SKIN_TIER3_SE[sid]) return SKIN_TIER3_SE[sid]; // ゼウス等のSSRスキン専用tier3 SE
  }
  if(move.seStyle) return move.seStyle; // data.jsで個別指定(熱視線など)
  return MOVE_SE_BY_STYLE[move.aoeStyle || move.projStyle] || null;
}
/* tier3を当てたときに鳴らす専用SEの名前(無ければnull=従来の 'hitDealt')。
   **fireMoveで1度だけ解決して弾・範囲に持たせる。** 当たった瞬間に引き直すと、
   その間に技を切り替えていたときへ別の音が鳴る。 */
function skinTier3HitSeName(attacker, move){
  if(!attacker || !move || move.tier!==3) return null;
  const sid = (typeof entitySkinId==='function') ? entitySkinId(attacker) : null;
  return (sid && SKIN_TIER3_HIT_SE[sid]) || null;
}
// 技発生中は移動方向に関わらず技を打った方向を向かせる(歩行アニメの前向き/後ろ向き判定用。data.jsのentityWalkFrameImageが参照)
function lockMoveFacing(attacker, angle, duration){
  attacker.moveFacingAngle = angle;
  attacker.moveFacingUntil = matchTime + Math.max(0, duration);
}
/* =====================================================================
   リアルマップ(テスト)専用: 弾の上下方向(高低差のねらい)

   通常マップでは isReal3dMap() が false になり、下の関数はすべて 0 /
   従来と同じ値を返すので、既存マップの弾道・当たり判定は一切変わらない。
   リアルマップでは「画面中心のレティクルが指している地点」へ向けて弾を飛ばし、
   地形にぶつかったらそこで着弾する。
   ===================================================================== */
const AIM_MUZZLE_Z      = 34;   // 弾が出る高さ(足元から)。0だと足元の起伏で即着弾してしまう
// 弾の落下量。平らな地面で水平に撃ったとき、ちょうど「射程距離」の地点で
// 銃口の高さぶん落ちて着地する。技ごとに射程も弾速も違うので加速度は弾ごとに決める
// (この値を上げるほど手前で落ちて弧が大きくなる)
const PROJ_DROP_Z       = AIM_MUZZLE_Z;
const AIM_TARGET_BODY_Z = 40;   // bot・遠隔プレイヤーがねらう相手の高さ(胴のあたり)
const AIM_SLOPE_LIMIT   = 1.6;  // 上下の傾きの上限(約58度)
const AIM_RAY_STEP      = 26;   // レティクルの先の地面を探すときの刻み幅
const PROJ_OVERHEAD_MISS  = 95; // 相手の頭上をこれ以上越えて飛ぶ弾は当たらない
const PROJ_UNDERFOOT_MISS = 50; // 相手の足元をこれ以上下で通る弾も当たらない
const REAL3D_UPWARD_BLOCK_THRESHOLD = 400; // 上下にねらえるので「高い所は撃てない」制限をゆるめる
function isReal3dMap(){ return !!(currentMap && currentMap.real3d); }
// 「自分より高い所にいる相手は撃てない」しきい値。リアルマップだけ丘の分をゆるめる
function upwardBlockLimit(){ return isReal3dMap() ? REAL3D_UPWARD_BLOCK_THRESHOLD : UPWARD_BLOCK_THRESHOLD; }
function projectileMuzzleZ(a){ return (a.z||0) + (isReal3dMap() ? AIM_MUZZLE_Z : 0); }
// 弾と相手の高さが合っているか。上下にねらえる弾(リアルマップ)だけ上下両方向で判定し、
// 通常マップは従来どおり「相手が自分より大きく上にいるか」だけを見る(挙動そのまま)
function projHeightHits(p, e){
  if(!p.terrain3d) return !(e.z - p.z > UPWARD_BLOCK_THRESHOLD);
  return (p.z - e.z <= PROJ_OVERHEAD_MISS) && (e.z - p.z <= PROJ_UNDERFOOT_MISS);
}
function terrainZAt(x,y){ return (typeof getTerrainHeightAt==='function') ? getTerrainHeightAt(x,y) : 0; }
// 技ごとの落下加速度。射程いっぱいを飛ぶ時間で PROJ_DROP_Z だけ落ちる強さにする
function projGravityFor(range, speed){
  const t = Math.max(0.05, (range||600) / Math.max(1, speed||900));
  return (2*PROJ_DROP_Z) / (t*t);
}
// 落下するぶんを見越した打ち上げ角。水平距離hDistの的にちょうど当たる傾きを返す
// (落下量 = 1/2・g・t^2、t = 水平距離 ÷ 水平弾速)
function ballisticSlope(dz, hDist, speed, grav){
  const d = Math.max(40, hDist);
  const t = d / Math.max(1, speed||900);
  return clamp((dz + 0.5*(grav||0)*t*t) / d, -AIM_SLOPE_LIMIT, AIM_SLOPE_LIMIT);
}
// 画面中心(レティクル)から伸ばした視線が地形に当たる点を探し、そこへ向かう弾の傾きを返す
function cameraAimSlope(attacker, maxRange, speed, grav){
  const cosP = Math.max(0.2, Math.cos(camState.pitch)), sinP = Math.sin(camState.pitch);
  const dx = Math.cos(camState.yaw)*Math.cos(camState.pitch);
  const dy = Math.sin(camState.yaw)*Math.cos(camState.pitch);
  const dz = -sinP;
  const t0 = camState.distBehind / cosP;              // カメラは後ろにあるので自分の足元あたりから探す
  const tEnd = t0 + Math.max(200, maxRange||600) / cosP;
  let hitT = null, prevT = t0;
  for(let t=t0+AIM_RAY_STEP; t<=tEnd; t+=AIM_RAY_STEP){
    if(camPos.z + dz*t <= terrainZAt(camPos.x+dx*t, camPos.y+dy*t)){ hitT = t; break; }
    prevT = t;
  }
  let t = tEnd;
  if(hitT!=null){
    let lo = prevT, hi = hitT;                        // 二分探索で接地点を詰める
    for(let i=0;i<5;i++){
      const mid = (lo+hi)/2;
      if(camPos.z + dz*mid <= terrainZAt(camPos.x+dx*mid, camPos.y+dy*mid)) hi = mid; else lo = mid;
    }
    t = hi;
  }
  const tx = camPos.x+dx*t, ty = camPos.y+dy*t, tz = camPos.z+dz*t;
  const hDist = Math.hypot(tx-attacker.x, ty-attacker.y);
  return ballisticSlope(tz - projectileMuzzleZ(attacker), hDist, speed, grav);
}
// bot: 相手の胴をねらう
function targetAimSlope(attacker, target, speed, grav){
  const d = Math.hypot(target.x-attacker.x, target.y-attacker.y);
  const tz = (target.z||0) + AIM_TARGET_BODY_Z;
  return ballisticSlope(tz - projectileMuzzleZ(attacker), d, speed, grav);
}
// 弾の上下の傾き(初速の縦成分 = この値 × 水平弾速)。水平の弾速・射程は変えないので飛距離は従来どおり
function fireAimSlope(attacker, target, maxRange, speed, grav){
  if(!isReal3dMap()) return 0;
  if(attacker.aimSlopeOverride!=null) return attacker.aimSlopeOverride; // マルチ: ゲストの発射イベントで届いたねらい
  if(attacker.isPlayer && attacker===player) return cameraAimSlope(attacker, maxRange, speed, grav);
  if(target && target.x!=null) return targetAimSlope(attacker, target, speed, grav);
  return 0;
}
function fireMove(attacker, target, move){
  // スキン装備でtier3が専用技に変わる場合はここで解決し、以降すべて解決後の技で処理する
  // (威力・弾速・射程・爆風・消費ガッツ・技名がまとめて差し替わる)
  if(typeof skinTier3Move==='function') move = skinTier3Move(move, attacker);
  /* 【当たりの抽選はここ1回だけ】音・エフェクトの色・追加効果を同じ結果から配るので、
     「鳴った音と起きたこと」が食い違わない。表は data.js の SKIN_MEDIA.se.tier3。
     マルチでゲストが撃ったぶんは、ゲストが引いた番号(seVariantOverride)をそのまま使う。 */
  const seVar = rollSkinTier3Variant(attacker, move,
                  (attacker.seVariantOverride!=null ? attacker.seVariantOverride : null));
  // SE: 自分の技発射のみ(負荷対策)。専用SEがある技はそれを、無ければ単発/連射の共通音
  if(attacker.isPlayer && !move.aoeShape){
    const sp = moveSeName(move, attacker);
    if(sp){
      const flight = (move.range && move.projSpeed) ? move.range/effectiveProjSpeed(attacker, move) : undefined;
      playSe(sp, { dur: flight, variant: seVar ? seVar.index : undefined });
    } else {
      playSe('fire', { kind: move.burst ? 'burst' : 'single' });
    }
  }
  attacker.guts = Math.max(0, attacker.guts - effectiveGutsCost(attacker, move));
  if(attacker.element==='ark' && move.tier===3){
    attacker.graceUntil = matchTime + 10;
  }
  const effDmg = effectiveMoveDmg(attacker, move) * ((seVar && seVar.dmgMult) || 1);
  const effProjSpeed = effectiveProjSpeed(attacker, move);
  const hbMult = ELEMENTS[attacker.element].hitboxMult || 1; // キュービ「当たり判定が大きい」特性
  const moveAura = (typeof getMoveAura==='function') ? getMoveAura(move, attacker) : (move.aura||null);
  // 当たりが出たらエフェクトの色だけ変える。**moveAura(相性)は触らない**ので有利不利は変わらない
  const effColor = (seVar && seVar.color) ? seVar.color
                 : ((typeof getMoveEffectColor==='function') ? getMoveEffectColor(move, attacker) : move.color);
  // 差し色(ビリビリ電撃等のアクセント)。keepBaseColorの技は本体が黒のままここだけオーラ色になる
  /* 差し色も当たりの色にする。**GPUの粒や尾はこの色で描く**ので、ここを変えないと
     枠だけ色が変わって中身が元の色のまま、という半端な見え方になる(実際にそうなった)。
     オーラ(moveAura=相性)は触らないので、有利不利は今までどおり。 */
  const auraTint = (seVar && seVar.color) ? seVar.color
                 : ((typeof getMoveAuraTint==='function') ? getMoveAuraTint(move, attacker) : null);
  /* 白黒オーラ('white'/'black')のときだけ入る差し色の「向き」。本体色は素の技のまま残り、
     WebGL層(fxGlAccent)が芯の白熱 / 外周の黒い煤だけを足す。詳細は data.js の getMoveAuraAccent。 */
  const auraAccent = (typeof getMoveAuraAccent==='function') ? getMoveAuraAccent(move, attacker) : null;
  // この技を当てたときに鳴らす音(tier3の専用SEがあるスキンだけ。無ければnullで従来どおり)
  const hitSe = skinTier3HitSeName(attacker, move);
  // リアルマップ以外では常に0(=水平に飛ぶ従来どおりの弾道)
  const onReal3d = isReal3dMap();
  const projGrav = onReal3d ? projGravityFor(move.range, effProjSpeed) : 0;
  const aimSlope = fireAimSlope(attacker, target, move.range, effProjSpeed, projGrav);
  const muzzleZ = projectileMuzzleZ(attacker);
  if(move.melee){
    lockMoveFacing(attacker, (target ? angTo(attacker, target) : attacker.facingAngle), MOVE_FACING_LOCK_MELEE_DUR);
    if(target && target.alive){
      applyDamage(target, effDmg, attacker, { moveAura, gutsDrain: move.gutsDrainRatio||0,
                                              lifestealMult: move.lifestealMult||1 });
      spawnHit(target.x, target.y, target.z, effColor);
    } else if(attacker.isPlayer){
      // 空振り: ガッツは既に消費済みなのに完全に無音・無表示だった。
      // 「届いていない」ことだけを控えめな空気音で知らせる(命中音よりはっきり弱い)
      playSe('miss');
    }
    return;
  }
  if(move.aoeShape){
    const aimAngleBase = angTo(attacker, target) + rand(-1,1)*(attacker.isPlayer?0.01:0.03);
    const width = (move.rectWidth||move.beamWidth||move.zigzagWidth||0) * hbMult;
    const burstCount = move.burst || 1;
    const burstGap = move.burstGap || 0;
    // 技本体と同じ倍率(訓練・状態異常・SSR tier3威力アップ)を先端の爆風にも掛ける。
    // SSRスキン装備時は本体もこちらも一緒に強くなる(dmgMultをここだけ素通しにしない)
    const endBlastDmgMult = (move.endBlast && move.dmg) ? effDmg/move.dmg : 1;
    const buildAe = (aimAngle)=>{
      const ae = {
        id:nextId++, ownerId:attacker.id, kind:move.aoeShape, x:attacker.x, y:attacker.y, z:attacker.z,
        angle:aimAngle, dmg:effDmg, color:effColor, range:move.range, width,
        fanAngleDeg:move.fanAngleDeg||45, beamCount:move.beamCount||3, beamSpreadDeg:move.beamSpreadDeg||40,
        // telegraphTime: 技ごとに変えたい(電王ライナー「俺、参上」は0.6秒でレールを敷く)ので
        // move側の指定を優先し、無指定の技は従来どおり0.18秒に落ちる
        fillSpeed: Math.max(200, effProjSpeed||900), telegraphTime: move.telegraphTime!=null ? move.telegraphTime : 0.18,
        spawnAt:matchTime, hitIds:new Set(), resolved:false, style:move.aoeStyle||null, moveAura, auraTint, auraAccent,
        selfSpeedBuffOnHit: move.selfSpeedBuffOnHit||false, // 命中で自分の移動速度が上がる技(ワームtier3等)。適用はapplySelfSpeedBuffOnHit
        gutsDrain: move.gutsDrainRatio||0, // 技単位のガッツ削り
        hitSe, // 当てたときの専用SE(applyDamageのoptsへそのまま渡す)
        healRatio: (seVar && seVar.healRatio) || 0, // 当たり: 与えたダメージのこの割合を回復
        glareEyes: !!move.glareEyes, // 睨む眼を重ねる(バジリスエゾーの真瞳術)
        glareTint: (seVar && seVar.color) || null, // 眼も当たりの色に合わせる(無ければ元の絵のまま)
        lifestealMult: move.lifestealMult||1, // この技だけHP回復を増やす(鱗赫)
        closeBonusMax: move.closeBonusMax||1, // 命中距離が短いほど威力アップ(デュラハン)
        // 扇/帯の技が届いた先端に出す仕上げの爆風ドーム(インフェルノ等)。
        // ae.rangeは遮蔽物で短くなった実際の到達距離なので、途中で途切れてもそこで爆発する
        endBlast: move.endBlast ? Object.assign({}, move.endBlast, { dmg: move.endBlast.dmg*endBlastDmgMult }) : null,
      };
      if(move.aoeShape==='beams'){
        const spread = (move.beamSpreadDeg||40)*Math.PI/180;
        const count = move.beamCount||3;
        ae.beamRanges = [];
        for(let i=0;i<count;i++){
          const off = count>1 ? (i/(count-1)-0.5)*spread : 0;
          ae.beamRanges.push(moveReachDistance(move, attacker.x, attacker.y, aimAngle+off));
        }
        ae.life = ae.telegraphTime + Math.max(...ae.beamRanges)/ae.fillSpeed + 0.25;
      } else {
        ae.range = moveReachDistance(move, attacker.x, attacker.y, aimAngle);
        ae.life = ae.telegraphTime + ae.range/ae.fillSpeed + 0.25;
        if(move.aoeShape==='gate'){
          // 遮蔽物で通路が短くなっても、門は必ず届く範囲の中に置く
          ae.doorDist = Math.min(move.gateDist||0, ae.range);
          // 「最遠(range)から門(doorDist)へ」の逆走がちょうど収まる尺にする
          ae.life = ae.telegraphTime + (ae.range-ae.doorDist)/ae.fillSpeed + 0.25;
          ae.gateArriveAt = matchTime + ae.telegraphTime + (ae.range-ae.doorDist)/ae.fillSpeed;
        }
      }
      return ae;
    };
    let firstAe = null;
    for(let i=0;i<burstCount;i++){
      const spreadOffset = burstSpreadOffset(move, i, burstCount);   // 式は data.js に1つだけ
      const aimAngle = aimAngleBase + spreadOffset;
      if(i===0){
        firstAe = buildAe(aimAngle);
        areaEffects.push(firstAe);
      } else {
        // 2発目以降は発射時刻になってから実際にhit判定用のaeを組み立てる(pendingAoeCastsで待機)
        pendingAoeCasts.push({ at: matchTime + i*burstGap, attackerId:attacker.id, aimAngle, build: buildAe });
      }
    }
    // メタルグレイモン「ギガデストロイヤー」: 扇の炎ブレスとは別に、黒い核弾頭を横並びで実体の弾として飛ばし、
    // 着弾/最大射程到達で大きいドームAoEを起こす(spawnGroundBlastはprojectiles側のblast処理を流用)
    if(move.warheads){
      const wh = move.warheads;
      const whCount = wh.count || 1;
      const whDmgMult = move.dmg ? effDmg/move.dmg : 1; // 本体と同じ倍率(訓練・SSR tier3威力アップ)を核弾頭にも掛ける
      const sideX = -Math.sin(aimAngleBase), sideY = Math.cos(aimAngleBase);
      /* 核弾頭は**自分の射程と弾速で弾道を組む。**
         【なぜ要るか】ここまでの projGrav / aimSlope は親の技(インフェルノ=扇・射程800・
         弾速は既定)から作った値で、核弾頭(射程900・弾速620)には合わない。
         実測: 核弾頭に重力86.1が乗っていた(自分の射程と弾速なら32.3)。2.7倍重いので
         射程900のうち**約650で地面に落ちて**いた(リアルマップで実測。傾斜地ではもっと手前)。
         data.js の range:900 が出せていない不具合であって、性能値の変更ではない。 */
      const whSpeed = wh.projSpeed || effProjSpeed;
      const whRange = wh.range || move.range;
      const whGrav  = onReal3d ? projGravityFor(whRange, whSpeed) : 0;
      const whSlope = fireAimSlope(attacker, target, whRange, whSpeed, whGrav);
      for(let i=0;i<whCount;i++){
        const sideOff = (whCount>1 ? (i-(whCount-1)/2) : 0) * (wh.sideStep||0);
        projectiles.push({
          id:nextId++, ownerId:attacker.id,
          x:attacker.x + sideX*sideOff, y:attacker.y + sideY*sideOff, z:muzzleZ,
          vx:Math.cos(aimAngleBase)*whSpeed, vy:Math.sin(aimAngleBase)*whSpeed, vz:whSlope*whSpeed,
          terrain3d:onReal3d, grav:whGrav,
          dmg: wh.dmg*whDmgMult, color: wh.color||'#14121c', hitR:(wh.hitR||28)*hbMult, splash:0,
          traveled:0, maxRange: wh.range||move.range, delay: i*(wh.gap||0),
          projStyle: wh.projStyle||'voidOrb', moveAura, auraTint, auraAccent,
          blast: wh.blast ? Object.assign({}, wh.blast, { dmg: wh.blast.dmg*whDmgMult }) : null,
        });
      }
    }
    const totalLife = firstAe.life + (burstCount-1)*burstGap;
    lockMoveFacing(attacker, aimAngleBase, totalLife);
    if(attacker.isPlayer){
      const sp = moveSeName(move, attacker);
      const sv = seVar ? seVar.index : undefined;   // 引いた当たりと同じ音を鳴らす
      playSe(sp || 'fire', sp ? { dur: totalLife, variant: sv } : { kind:'aoe', dur: totalLife });
    }
    return;
  }
  if(move.lobbed){
    const d = dist(attacker, target);
    const throwDist = Math.min(d, move.range);
    const ang = angTo(attacker, target) + rand(-1,1)*(attacker.isPlayer?0.015:0.05);
    const landX = attacker.x + Math.cos(ang)*throwDist;
    const landY = attacker.y + Math.sin(ang)*throwDist;
    const flightTime = throwDist / effProjSpeed;
    projectiles.push({
      id:nextId++, ownerId:attacker.id, x:attacker.x, y:attacker.y, z:attacker.z,
      lobbed:true, startX:attacker.x, startY:attacker.y, startZ:attacker.z,
      landZ: terrainZAt(landX, landY), // 落下先の地面の高さ(通常マップでは0なので従来と同じ)
      landX, landY, arcHeight: move.arcHeight||120,
      flightTime: Math.max(0.05, flightTime), flightT:0,
      dmg:effDmg, color:effColor, hitR:move.hitR*hbMult, splash:(move.splash||0)*hbMult,
      icon:move.icon, shape:move.shape, projStyle:move.projStyle||null, visR:move.projVisR||0, moveAura,
    });
    lockMoveFacing(attacker, ang, Math.max(0.05, flightTime));
    return;
  }
  if(move.multiOrb){
    // ゴッドライジング(ガリ): 赤青黄緑の光球を同時に放射線状へ。隣同士が半分ずつ重なる
    // 有利不利の判定は球体ごとの色オーラで個別に行い、オーラ一致(1.2倍)は技本来のオーラ(白)で判定する
    const colors = move.multiOrb;
    const orbAuras = move.orbAuras || [];
    const n = colors.length;
    const spread = (move.orbSpreadDeg||9)*Math.PI/180;
    const baseAng = angTo(attacker, target) + rand(-1,1)*(attacker.isPlayer?0.01:0.03);
    for(let i=0;i<n;i++){
      const off = n>1 ? ((i-(n-1)/2)/(n-1))*spread : 0;
      const ang = baseAng + off;
      projectiles.push({
        id:nextId++, ownerId:attacker.id, x:attacker.x, y:attacker.y, z:muzzleZ,
        vx:Math.cos(ang)*effProjSpeed, vy:Math.sin(ang)*effProjSpeed, vz:aimSlope*effProjSpeed, terrain3d:onReal3d, grav:projGrav,
        dmg:effDmg, color:colors[i], hitR:(move.hitR||24)*hbMult, splash:(move.splash||0)*hbMult,
        traveled:0, maxRange:move.range, delay:0, projStyle:'godorb', orbColor:colors[i],
        moveAura: orbAuras[i] || moveAura, matchAura: moveAura,
      });
    }
    lockMoveFacing(attacker, baseAng, move.range/effProjSpeed);
    return;
  }
  const burstCount = move.burst || 1;
  const burstGap = move.burstGap || 0;
  const baseAng = angTo(attacker, target);
  // burstSideStep があると、扇状に散らさず発射位置を進行方向の左右へずらして横並びに飛ばす
  const sideStep = move.burstSideStep || 0;
  const sideX = -Math.sin(baseAng), sideY = Math.cos(baseAng);
  for(let i=0;i<burstCount;i++){
    const spreadOffset = burstSpreadOffset(move, i, burstCount);   // 式は data.js に1つだけ
    // 横並びのときは進行方向をそろえたいので、狙いのぶれを乗せない
    const jitter = sideStep ? 0 : rand(-1,1)*(attacker.isPlayer?0.02:0.07);
    const ang = baseAng + jitter + spreadOffset;
    const sideOff = (burstCount>1 ? (i-(burstCount-1)/2) : 0) * sideStep;
    projectiles.push({
      id:nextId++, ownerId:attacker.id,
      x:attacker.x + sideX*sideOff, y:attacker.y + sideY*sideOff, z:muzzleZ,
      vx:Math.cos(ang)*effProjSpeed, vy:Math.sin(ang)*effProjSpeed, vz:aimSlope*effProjSpeed, terrain3d:onReal3d, grav:projGrav,
      dmg:effDmg, color:effColor, hitR:move.hitR*hbMult, hitW:(move.hitW||0)*hbMult, splash:(move.splash||0)*hbMult,
      traveled:0, maxRange:move.range, delay: i*burstGap, icon:move.icon,
      growWithDistance: move.growWithDistance||false, baseHitR: move.hitR*hbMult,
      projStyle: move.projStyle||null, projVariant: move.projVariant||null, moveAura,
      // projVisR は当たり判定と切り離した「絵の大きさ」。下位tierの当たり判定のまま
      // 上位tierと同じ絵を出したいときに使う(ジョーカーのデスカッター)
      visR: move.projVisR||0,
      // burstTints があれば連射の何発目かで色を変える(轟金剛の青→赤→青)
      auraTint: (move.burstTints && move.burstTints[i % move.burstTints.length]) || auraTint,
      auraAccent,
      gutsDrain: move.gutsDrainRatio||0, // 技単位のガッツ削り(キッス等)
      hitSe, // 当てたときの専用SE
      healRatio: (seVar && seVar.healRatio) || 0,
      selfSpeedBuffOnHit: move.selfSpeedBuffOnHit||false,
      burstIndex: i, // 連射内の何発目か(レクイエムエンドの3形態描き分け等に使う)
      blast: move.blast||null, // ピクシー「ビッグバン」等: 着弾/最大射程到達で地面にドーム状AoEを発生させる
      closeBonusMax: move.closeBonusMax||1, // 命中距離が短いほど威力アップ(デュラハン)
      stopsSelfMove: move.selfMoveWithProjectile||false, // この弾が消えた地点で発射主の強制前進も止める(デュラハン最終奥義)
    });
  }
  // selfBlast: 撃った瞬間に自分の足元でドーム状の爆風を起こす(デュラハン最終奥義)。
  // 着弾ドーム(blast)と同じ spawnGroundBlast を使うので、当たり判定も描画も既存の仕組みに乗る。
  if(move.selfBlast){
    spawnGroundBlast(attacker.x, attacker.y, {
      ...move.selfBlast,
      color: move.selfBlast.color || effColor,
      se: move.selfBlast.se || 'tornado',
    }, attacker.id, moveAura, auraTint, auraAccent);
  }
  if(move.selfMoveWithProjectile){
    // 竜巻(最終奥義)と同じ速度で自分も前進する「移動技」
    attacker.moveWithMoveDirX = Math.cos(baseAng);
    attacker.moveWithMoveDirY = Math.sin(baseAng);
    attacker.moveWithMoveSpeed = effProjSpeed;
    attacker.moveWithMoveUntil = matchTime + move.range/effProjSpeed;
  }
  lockMoveFacing(attacker, baseAng, move.range/effProjSpeed + burstGap*Math.max(0, burstCount-1));
}
function angleDiff(a,b){ let d=a-b; while(d>Math.PI) d-=Math.PI*2; while(d<-Math.PI) d+=Math.PI*2; return d; }
function raySegmentCircleDist(ox,oy,angle,cx,cy,cr){
  const dx=Math.cos(angle), dy=Math.sin(angle);
  const fx=ox-cx, fy=oy-cy;
  const b = 2*(fx*dx+fy*dy);
  const c = fx*fx+fy*fy-cr*cr;
  const disc = b*b-4*c;
  if(disc<0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-b-sq)/2, t2 = (-b+sq)/2;
  if(t1>=0) return t1;
  if(t2>=0) return 0;
  return null;
}
/* 範囲技(扇・帯・ビーム)が実際に届く距離。**貫通技(`pierce`)は遮蔽物で止まらず射程いっぱいまで届く。**
   ホスト側の判定(fireMove)とゲスト側の見た目(network.js)の両方から呼ぶので、**貫通かどうかを見るのはここだけ。**
   2か所目に書くと、ゲストにだけ岩で止まって見える(当たり判定はホストなので当たりはする)食い違いが起きる。 */
function moveReachDistance(move, ox, oy, angle){
  if(move && move.pierce) return move.range;
  return raycastObstacleDistance(ox, oy, angle, move.range);
}
// 指定方向に岩・火山などの障害物があれば、そこまでの距離を返す(貫通防止用)。無ければmaxRangeを返す
function raycastObstacleDistance(ox,oy,angle,maxRange){
  let closest = maxRange;
  for(const v of volcanoObstacles){
    const d = raySegmentCircleDist(ox,oy,angle,v.x,v.y,mountainGroundRadius(v));
    if(d!=null && d<closest) closest = d;
  }
  for(const r of rocks){
    const d = raySegmentCircleDist(ox,oy,angle,r.x,r.y,r.radius);
    if(d!=null && d<closest) closest = d;
  }
  return Math.max(30, closest);
}
function hitTestFan(attacker, ent, aimAngle, range, halfAngleRad){
  if(!ent.alive || ent.id===attacker.id) return false;
  const d = dist(attacker, ent);
  if(d > range + ent.radius) return false;
  const angToEnt = angTo(attacker, ent);
  return Math.abs(angleDiff(angToEnt, aimAngle)) <= halfAngleRad;
}
function hitTestRect(attacker, ent, aimAngle, length, halfWidth){
  if(!ent.alive || ent.id===attacker.id) return false;
  const dx = ent.x-attacker.x, dy = ent.y-attacker.y;
  const fwd = dx*Math.cos(aimAngle)+dy*Math.sin(aimAngle);
  const right = -dx*Math.sin(aimAngle)+dy*Math.cos(aimAngle);
  return fwd>=-ent.radius && fwd<=length+ent.radius && Math.abs(right)<=halfWidth+ent.radius;
}
function isNetworkedHuman(ent){
  return netState.mode==='multi' && (ent.isPlayer || ent.isRemoteHuman);
}
// 命中距離が短いほど威力が増す技用の倍率(デュラハン全技)。
// maxRangeで1.0倍、距離0でbonusMax倍になるよう線形補間する
function closeRangeDmgMult(bonusMax, hitDist, maxRange){
  if(!bonusMax || bonusMax<=1 || !maxRange) return 1;
  const ratio = clamp(hitDist/maxRange, 0, 1);
  return 1 + (1-ratio)*(bonusMax-1);
}
/* 特性の命中時効果(data.js の TRAIT_ON_HIT)を1か所で適用する。
   表に無い特性(=既存モンスター)は何もしないので、今までの挙動は変わらない。 */
function applyTraitOnHit(source, target, finalDmg){
  if(typeof TRAIT_ON_HIT === 'undefined') return;
  const el = ELEMENTS[source.element];
  const tr = el && TRAIT_ON_HIT[el.trait];
  if(!tr) return;
  if(tr.burnSec)   target.burnUntil   = matchTime + tr.burnSec;
  if(tr.slowSec)   target.slowUntil   = matchTime + tr.slowSec;
  if(tr.freezeSec) target.freezeUntil = matchTime + tr.freezeSec;
  if(tr.poisonSec){
    // すでにどく中なら次のダメージ時刻は据え置き(重ねがけで連打にならないよう既存と同じ形にする)
    if(!(target.poisonUntil > matchTime)) target.poisonTickAt = matchTime + 1;
    target.poisonUntil = matchTime + tr.poisonSec;
    target.poisonSourceId = source.id;
  }
  if(tr.gutsDrain){
    const drained = Math.min(finalDmg*tr.gutsDrain, target.guts);
    if(drained > 0){
      target.guts = Math.max(0, target.guts - drained);
      spawnDmgText(target.x, target.y, target.z, '-'+Math.round(drained)+'GT', '#ff7a96');
    }
  }
  if(tr.lifesteal){
    const healed = Math.min(finalDmg*tr.lifesteal, source.maxHp - source.hp);
    if(healed > 0){
      source.hp += healed;
      spawnDmgText(source.x, source.y, source.z, '+'+Math.round(healed), '#7fffa0');
    }
  }
}
/* 自分が当てたときの合図(×印・命中SE)の間引き。範囲技・多段ヒットは1フレームで
   何体にも当たるので、そのたびにDOMを触ると重い。この間隔で1回だけ通す。 */
const SELF_HIT_FX_MIN_GAP = 0.05;   // 秒
let lastSelfHitFxAt = -Infinity;
function selfHitFxGate(){
  if(matchTime - lastSelfHitFxAt < SELF_HIT_FX_MIN_GAP) return false;
  lastSelfHitFxAt = matchTime;
  return true;
}
function applyDamage(target, dmg, source, opts){
  if(!target.alive) return;
  // レイドでは味方どうしの攻撃は当たらない(ボスが絡む攻撃だけが通る)。
  // ここ1か所で止めれば、弾・範囲攻撃・爆風のすべてに効く。
  if(raidFriendlyFireBlocked(target, source)) return;
  // チーム戦のフレンドリーファイア無しも同じ1か所で止める(状態異常・ガッツ削りも入口がここ)
  if(teamFriendlyFireBlocked(target, source)) return;
  // ダウン直後2秒は無敵(とどめが刺せない。TEAM_DOWN_INVULN_SEC。発注者要望 2026-08-19)
  if(entityDowned(target) && target.downedInvulnUntil > matchTime) return;
  if(target.isPlayer) playSe(skinHitSeName(target) || 'hitTaken'); // SE: 自分の被弾のみ(スキン専用SEがあれば差し替え)
  const involvesHuman = isNetworkedHuman(target) || (source && isNetworkedHuman(source));
  const isAuthoritative = (opts && opts.authoritative) || (netState.mode==='multi' && netState.isHost);

  if(involvesHuman && !isAuthoritative){
    // マルチプレイで人間が関わる場合、見た目だけ即時反映しつつ、確定計算はホストに委ねる
    spawnHit(target.x, target.y, target.z, source ? ELEMENTS[source.element].color : '#ffffff');
    const ta = opts && opts.moveAura;
    const ma = (opts && opts.matchAura) || ta;
    const ar = (ta && typeof auraAdvantage==='function') ? auraAdvantage(ta, getMonsterAura(target)) : 'neutral';
    if(ar==='adv')      spawnDmgText(target.x, target.y, target.z, Math.round(dmg*AURA_ADV_MULT), '#ff5555', true);
    else if(ar==='dis') spawnDmgText(target.x, target.y, target.z, Math.round(dmg*AURA_DIS_MULT), '#5aa6ff', true);
    else                spawnDmgText(target.x, target.y, target.z, Math.round(dmg));
    if(netState.mode==='multi'){
      window.__aramonReportHit(netState.roomId, {
        targetNetId: target.netPlayerId || null, targetLocalId: target.id,
        sourceNetId: source? (source.netPlayerId||null) : null, sourceLocalId: source? source.id : null,
        dmg, sourceElement: source? source.element : null, moveAura: ta || null, matchAura: ma || null, ts: Date.now(),
      });
    }
    return;
  }

  let finalDmg = dmg;
  if(ELEMENTS[target.element].dmgTakenMod){ finalDmg *= ELEMENTS[target.element].dmgTakenMod; }
  if(entityDowned(target)){ finalDmg *= TEAM_DOWN_DMG_TAKEN_MULT; }  // ダウン中は被ダメ増(チーム戦のみ)
  if(target.element==='ark' && target.graceUntil > matchTime){ finalDmg *= 0.5; }
  if(target.burnUntil > matchTime){ finalDmg *= 1.5; }
  if(target.trainDmgTakenMult){ finalDmg *= target.trainDmgTakenMult; }
  if(target.mastermonDmgTakenMult){ finalDmg *= target.mastermonDmgTakenMult; }
  const targetStateEff = activeStateEffects(target);
  if(targetStateEff && targetStateEff.dmgTakenMult != null){ finalDmg *= targetStateEff.dmgTakenMult; }
  if(source && source.alive){
    const srcEl = ELEMENTS[source.element];
    if(srcEl.dmgDealtMod){ finalDmg *= srcEl.dmgDealtMod; }
    if(source.mastermonDmgDealtMult){ finalDmg *= source.mastermonDmgDealtMult; }
    // レイド特効スキン: ボスへ与えるダメージだけ増える
    if(game.raid && target.isRaidBoss) finalDmg *= raidSkinMult(source, 'dealt');
  }
  // レイド特効スキン: ボスから受けるダメージだけ減る
  if(game.raid && source && source.isRaidBoss) finalDmg *= raidSkinMult(target, 'taken');
  // オーラ相性: 有利技×不利モンスター=AURA_ADV_MULT倍 / 不利技×有利モンスター=AURA_DIS_MULT倍 / 技オーラ=使用者オーラ=AURA_MATCH_MULT倍(一致)
  // matchAuraは「一致」判定専用(未指定ならmoveAuraと同じ)。ゴッドライジングの光球のように
  // 有利不利の判定だけ個別色にして、一致判定は技本来のオーラ(白)のまま保ちたいケースで分離指定する。
  let auraResult = 'neutral';
  const techAura = opts && opts.moveAura;
  const matchAura = (opts && opts.matchAura) || techAura;
  if(techAura && typeof auraAdvantage==='function'){
    auraResult = auraAdvantage(techAura, getMonsterAura(target));
    if(auraResult==='adv') finalDmg *= AURA_ADV_MULT;
    else if(auraResult==='dis') finalDmg *= AURA_DIS_MULT;
  }
  if(matchAura && source && getMonsterAura(source)===matchAura) finalDmg *= AURA_MATCH_MULT; // オーラ一致
  target.hp -= finalDmg; target.hitFlash = 0.18;
  /* 【命中の手応え】自分が与えたダメージが確定した瞬間に、照準の×印(render.jsのshowHitMarker)と
     命中SEを出す。ここは「ソロ/ホストの確定計算」だけが通る場所で、マルチのゲストは上の
     予測分岐(involvesHuman && !isAuthoritative)で必ずreturn済みなので、
     ゲストがnetwork.jsの見た目命中で出す×印と二重にはならない。
     範囲技は1フレームに何体も当たるため、×印(=DOMのリフロー)とSEはselfHitFxGateで間引く。 */
  if(source && source===player && source.id!==target.id && selfHitFxGate()){
    if(typeof showHitMarker==='function') showHitMarker();
    playSe((opts && opts.hitSe) || 'hitDealt');
  }
  // 計測ハーネス用: ダメージ確定(HP減少)の時刻を記録(通常は__netProbe未定義で素通り)
  if(window.__netProbe) __netProbe.mark('dmg', { id: target.id, src: source?source.id:null, dmg: Math.round(finalDmg), hp: Math.round(target.hp), ts: Date.now() });
  // ダメージ表記: オーラ相性でダメージ増加(有利技)=赤・減少(不利技)=青で強調(オーラ一致の増加分は考慮しない) / それ以外は通常
  if(auraResult==='adv')      spawnDmgText(target.x, target.y, target.z, Math.round(finalDmg), '#ff5555', true);
  else if(auraResult==='dis') spawnDmgText(target.x, target.y, target.z, Math.round(finalDmg), '#5aa6ff', true);
  else                        spawnDmgText(target.x, target.y, target.z, Math.round(finalDmg));
  if(source && source.id!==target.id){
    target.recentAttackers[source.id] = matchTime;
    target.lastAttackerId = source.id;
    target.lastAttackerAt = matchTime;
    /* 【被弾方向マーカー用】撃ってきた相手の「その時の位置」と時刻を控える。
       描画(画面外周の円弧)はrender.js側が player.lastHitFromX/Y と lastHitAt を読んで出すので、
       ここは記録だけ。相手が動いても方向がぶれないよう、当たった瞬間の座標を固定で残す。 */
    target.lastHitFromX = source.x;
    target.lastHitFromY = source.y;
    target.lastHitAt = matchTime;
  }
  // 状態変化「逆上」(スエゾー): 技を受けた時に確率で発動
  const targetSc = STATE_CHANGES[target.element];
  if(targetSc && targetSc.trigger==='onHitTakenChance' && canTriggerState(target) && Math.random() < targetSc.triggerValue){
    activateState(target);
  }

  if(source && source.alive && source.id!==target.id){
    source.damageDealt += finalDmg;
    // レイド: ボスへ与えたぶんだけを貢献度として別に数える(味方への誤射は元から通らない)
    if(game.raid && target.isRaidBoss) source.raidDamage = (source.raidDamage||0) + finalDmg;
    /* 技側から直接指定するHP回復(バジリスエゾーの当たり)。**属性の特性とは別枠。**
       アクアの吸収と同じ見せ方(緑の数字)にして、増えたことがその場で分かるようにする。 */
    const healRatio = (opts && opts.healRatio) || 0;
    if(healRatio > 0){
      const got = Math.min(finalDmg*healRatio, source.maxHp - source.hp);
      if(got > 0){
        source.hp += got;
        spawnDmgText(source.x, source.y, source.z, '+'+Math.round(got), '#7fffa0');
      }
    }
    if(source.element==='aqua'){
      // 技によってはHP回復を増やす(大喰いの利世の鱗赫は2倍)
      const lsMult = (opts && opts.lifestealMult) || 1;
      const healed = Math.min(finalDmg*AQUA_LIFESTEAL*lsMult, source.maxHp - source.hp);
      if(healed > 0){
        source.hp += healed;
        spawnDmgText(source.x, source.y, source.z, '+'+Math.round(healed), '#7fffa0');
      }
      if(Math.random() < 0.2){
        target.freezeUntil = matchTime + 1;
      }
    }
    // 技単位のガッツ削り(ピクシー「キッス」等)。与えたダメージに比例して相手のガッツを削る
    if(opts && opts.gutsDrain){
      const drained = Math.min(finalDmg*opts.gutsDrain, target.guts);
      if(drained > 0){
        target.guts = Math.max(0, target.guts - drained);
        spawnDmgText(target.x, target.y, target.z, '-'+Math.round(drained)+'GT', '#ff7a96');
      }
    }
    if(source.element==='leaf'){
      const drained = Math.min(finalDmg*0.3, target.guts);
      if(drained > 0){
        target.guts = Math.max(0, target.guts - drained);
        spawnDmgText(target.x, target.y, target.z, '-'+Math.round(drained)+'GT', '#ff7a96');
      }
    }
    if(source.element==='ark'){
      const drained = Math.min(finalDmg*0.45, target.guts);
      if(drained > 0){
        target.guts = Math.max(0, target.guts - drained);
        spawnDmgText(target.x, target.y, target.z, '-'+Math.round(drained)+'GT', '#ff7a96');
      }
    }
    if(source.element==='suezo'){
      const drained = Math.min(finalDmg*0.4, target.guts);
      if(drained > 0){
        target.guts = Math.max(0, target.guts - drained);
        spawnDmgText(target.x, target.y, target.z, '-'+Math.round(drained)+'GT', '#ff7a96');
      }
    }
    if(source.element==='fire'){
      target.burnUntil = matchTime + 10;
    }
    if(source.element==='spark'){
      target.slowUntil = matchTime + 1;
    }
    if(source.element==='warm' || source.element==='zan'){
      if(!(target.poisonUntil > matchTime)){
        target.poisonTickAt = matchTime + 1;
      }
      target.poisonUntil = matchTime + 10;
      target.poisonSourceId = source.id;
    }
    /* スタジオから足した特性の命中時効果。**上の既存モンスターぶんはこの表に載っていない**
       (挙動を変えないため element で直接書いたまま)。新しい特性は data.js の
       TRAIT_ON_HIT に1行足すだけで効く。判定はここ1か所だけにする。 */
    applyTraitOnHit(source, target, finalDmg);

    // 状態変化「必死」(プラント): 与えたダメージの一部を自分のHPに還元
    const srcStateEff = activeStateEffects(source);
    if(srcStateEff && srcStateEff.lifestealPct){
      const selfHeal = Math.min(finalDmg*srcStateEff.lifestealPct, source.maxHp - source.hp);
      if(selfHeal > 0){
        source.hp += selfHeal;
        spawnDmgText(source.x, source.y, source.z, '+'+Math.round(selfHeal), '#7fffa0');
      }
    }
    // 状態変化「元気」(ウンディーネ・ライガー): 技命中時に確率で発動
    const srcSc = STATE_CHANGES[source.element];
    if(srcSc && srcSc.trigger==='onHitChance' && canTriggerState(source) && Math.random() < srcSc.triggerValue){
      activateState(source);
    }
  }

  if(target.hp<=0){ killEntity(target, source); }
}
/* =====================================================================
   プレイヤーの連続キル記録(リザルトのハイライト「⚡ N連続キル！」用)
   killEntity() が積み、ui.js の showResultNow が playerMaxKillStreak() で読む。
   空にする分岐は1か所 ―― resetTrainCards()(ui.js。全試合の入口4か所が必ず通る)から
   resetKillStreakLog() を呼ぶ。試合開始の場所へ個別に足さない。
   マルチのゲストは killEntity がホスト側でしか走らないので積まれない(=この
   ハイライトが出ないだけで、他のハイライト判定には影響しない)。 */
const KILL_STREAK_WINDOW_SEC = 10;   // この秒数の幅に収まったキルを「連続」とみなす
let playerKillTimes = [];
function resetKillStreakLog(){ playerKillTimes.length = 0; }
// windowSec 秒の幅に収まる連続キル数の最大を返す(1キルなら1、0キルなら0)
function playerMaxKillStreak(windowSec){
  let best = 0;
  for(let i=0; i<playerKillTimes.length; i++){
    let n = 1;
    for(let j=i+1; j<playerKillTimes.length; j++){
      if(playerKillTimes[j] - playerKillTimes[i] <= windowSec) n++;
      else break;
    }
    if(n > best) best = n;
  }
  return best;
}
function killEntity(victim, killer){
  if(!victim.alive) return;
  // 安全圏外ダメージや溶岩などキラー不在の死亡は、直前に攻撃していた相手にキルを付与する
  if(!killer){
    const lastAtk = entities.find(o=>o.id===victim.lastAttackerId);
    if(lastAtk && lastAtk.alive && lastAtk.id!==victim.id && (matchTime - (victim.lastAttackerAt||0)) <= 8){
      killer = lastAtk;
    }
  }
  // チーム戦: 立っている味方がいればここで死亡せず「ダウン」で踏みとどまる。
  // ダウン中にHP0(とどめ)・出血タイマー切れのときは通らず、本当の死亡へ進む。
  if(tryEnterDowned(victim, killer)) return;
  // 【発注者要望 2026-08-19】チーム戦の本当の死亡はここから先。キル数・キルボーナスは
  // 「とどめを刺した人」ではなく「ダウンさせた人」に入れる(とどめが別人・出血死でも同じ)。
  if(isTeamMatch() && victim.downedByKillerId!=null){
    const downer = entities.find(o=>o.id===victim.downedByKillerId);
    if(downer) killer = downer;
  }
  victim.alive = false;
  victim.downed = false; victim.downedUntil = 0; victim.reviveProgress = 0;
  victim.deathAt = matchTime;
  const aliveCount = entities.filter(e=>e.alive).length + 1;
  if(!isTeamMatch()) victim.placement = aliveCount;   // チーム戦の順位はチーム単位(teamNoteDeathが付ける)
  spawnDeath(victim.x, victim.y, victim.z, ELEMENTS[victim.element].color);
  // デス円盤石: 試合中に確定したトレーニング強化があれば、その場に石の円盤として残す
  // (本当の死亡だけ=ダウンでは落とさない。上のtryEnterDownedを抜けた後なのでここでよい)
  spawnDeathDisc(victim);
  if(killer && entities.includes(killer) && killer.id!==victim.id){
    killer.kills += 1;
    if(killer.isPlayer) playerKillTimes.push(matchTime);   // 連続キルのハイライト用
    killer.hp = Math.min(killer.maxHp, killer.hp + 50);
    killer.guts = Math.min(killer.maxGuts, killer.guts + 50);
    spawnDmgText(killer.x, killer.y, killer.z, '+50', '#7fffa0');
    spawnDmgText(killer.x, killer.y, killer.z+30, '+50GT', '#ffd9e3');
    const kfText = `${displayNameFor(killer)} が ${displayNameFor(victim)} を倒した`;
    pushKillFeed(kfText);
    // マスモン(bot補完・他プレイヤー)を倒したら、相手レベルに応じたEXPボーナスを積み立てる。
    // マルチではゲストの分もホストが計算するので、ここでは撃破者がプレイヤーかどうかを問わず積む
    // (使われるのは「自分がマスモンで参戦している側」だけなので、他者に積んでも害はない)
    let expBonus = 0;
    if(victim.mastermonLevel){
      expBonus = victim.mastermonLevel * MASTERMON_KILL_EXP_PER_LEVEL;
      killer.mastermonKillExpBonus = (killer.mastermonKillExpBonus||0) + expBonus;
    }
    // マルチではホストが全てのキルを配信する。ゲストはこのイベントでしかキルフィードと
    // キルボーナスの演出を受け取れないため、自分が関与したキルだけに絞ってはいけない
    // (以前は絞っていたため、ゲスト側のキルフィードがほぼ流れていなかった)
    if(netState.mode==='multi' && netState.isHost){
      window.__aramonPushEvent(netState.roomId, {
        kind:'kill', text:kfText, killerId:killer.id, victimId:victim.id,
        expBonus, ts:Date.now(),
      });
      // 撃破EXPボーナスはフル配信でしか載らない「コールド」フィールドなので、
      // 次の配信をフルにして最短でゲストへ届ける
      if(expBonus > 0) hostForceFullNext = true;
    }
    if(killer.isPlayer){
      playSe(skinKillSeName(killer) || 'kill'); // ザシュッ(切り裂き音)
      let bonusMsg = 'キルボーナス！ HP+50 ガッツ+50';
      if(expBonus && game.selectedMastermonKey) bonusMsg += ` 経験値+${expBonus}`;
      pushToast(bonusMsg);
    }
    const killerSc = STATE_CHANGES[killer.element];
    if(killerSc && killerSc.trigger==='onKill' && canTriggerState(killer)){
      activateState(killer);
    }
  } else {
    const kfText = `${displayNameFor(victim)} は安全圏外で力尽きた`;
    pushKillFeed(kfText);
    // 安全圏外での力尽きもホストが全員分を配信する(ゲストのキルフィードに流すため)
    if(netState.mode==='multi' && netState.isHost){
      window.__aramonPushEvent(netState.roomId, {kind:'kill', text:kfText, victimId:victim.id, ts:Date.now()});
    }
  }
  teamNoteDeath(victim, killer);   // チーム戦: 全滅の確定とチーム順位付け(個人戦では何もしない)
  if(victim.isPlayer){ onPlayerDown(); }
  checkWin();
}
function checkWin(){
  if(game.trainingRange) return; // 射撃訓練場は勝敗なし(的は倒しても復活する)
  if(game.raid){ checkRaidEnd(); return; }  // レイドは「ボス撃破 or 時間切れ」で決着する
  if(netState.mode==='multi' && !netState.isHost) return; // 勝敗判定はホストのみ確定させる
  if(game.over) return;
  if(isTeamMatch()){ checkTeamWin(); return; }  // チーム戦は「自チーム以外の全チーム全滅」で決着
  const aliveList = entities.filter(e=>e.alive);
  if(netState.mode==='multi' && hostSpectating){
    // ホストは既に敗退し観戦中。残っているのが人間プレイヤーが誰もおらずbotだけになったら、
    // 決着(最後の1体)を待たずにここでリザルト画面へ進む
    const humanAlive = aliveList.some(e=>e.netPlayerId);
    if(!humanAlive){
      showResult(false, player.placement||2);
      return;
    }
  }
  if(aliveList.length<=1){
    if(aliveList.length===1){
      aliveList[0].placement = 1;
      if(netState.mode==='multi'){
        // 決着した瞬間の全員の最終状態(HP0/alive:falseや順位を含む)を、通常の配信タイマーを
        // 待たずに即座に配信する。これを待つとこの直後にhost側がgame.over=trueとなって
        // 配信ループそのものが止まり、非ホスト側が自分の敗北/試合終了を一生知れなくなる
        // (=ゲストが生き残ったままマッチが終わらないように見える)不具合の原因になっていた。
        window.__aramonPublishAuthState(netState.roomId, buildAuthStatePayload()).catch(()=>{});
        window.__aramonPushEvent(netState.roomId, {kind:'matchEnd', winnerNetId: aliveList[0].netPlayerId||null, winnerName: aliveList[0].name, ts:Date.now()});
      }
      if(aliveList[0].isPlayer){
        onPlayerWin();
      } else if(netState.mode==='multi' && netState.isHost && hostSpectating){
        // ホストは既に敗退し観戦していた場合、他の誰かが優勝した時点で結果画面へ
        showResult(false, player.placement||2);
      }
    }
  }
}

/* =====================================================================
   AI
===================================================================== */
function findNearestAliveEnemy(self, range){
  // レイド中はボス以外を狙わない。射程に関係なく必ずボスを返すので、
  // botもマスモンも一斉にボスへ向かう(味方を追いかけて散らばらない)。
  if(game.raid && !self.isRaidBoss) return raidBossEntity();
  let best=null, bestD=range;
  for(const e of entities){
    if(e===self || !e.alive) continue;
    if(sameTeam(self, e)) continue;   // チーム戦: 味方は狙わない
    if(e.z - self.z > upwardBlockLimit()) continue;
    const d=dist(self,e); if(d<bestD){bestD=d; best=e;}
  }
  return best;
}
function countRecentAttackers(self, windowSec){
  let count = 0;
  for(const id in self.recentAttackers){
    const t = self.recentAttackers[id];
    if(matchTime - t <= windowSec){
      const atk = getEntity(Number(id));
      if(atk && atk.alive) count++;
    }
  }
  return count;
}
function findNearestHealItem(self, range, safeZoneOnly){
  let best=null, bestD=range;
  for(const it of lootItems){
    if(it.kind!=='heal') continue;
    if(safeZoneOnly && dist(it, zoneState.center) > zoneState.radius) continue;
    const d = dist(self,it);
    if(d<bestD){ bestD=d; best=it; }
  }
  return best;
}
function findNearestLoot(self, range){
  let best=null, bestD=range;
  for(const it of lootItems){ const d=dist(self,it); if(d<bestD){bestD=d; best=it;} }
  return best;
}
// 最寄りのガッツ飴(kind==='guts')を返す
function findNearestGutsItem(self, range){
  let best=null, bestD=range;
  for(const it of lootItems){
    if(it.kind!=='guts') continue;
    const d=dist(self,it); if(d<bestD){bestD=d; best=it;}
  }
  return best;
}
// このモンスターが使える技のうち、最も安いガッツ消費量を返す(=これ未満だと一切技が撃てない)
function minMoveGutsCost(b){
  const moves = SIGNATURE_MOVES[b.element];
  if(!moves) return 0;
  const maxTier = Math.min(moves.length, b.moveTierUnlocked || moves.length);
  let mn = Infinity;
  for(let t=1; t<=maxTier; t++){
    const mv = moves[t-1];
    if(mv){ const c = effectiveGutsCost(b, mv); if(c<mn) mn=c; }
  }
  return mn===Infinity ? 0 : mn;
}
const BOT_STUCK_MOVE_EPS = 55;   // このpx以内しか動いていなければ「その場に留まっている」とみなす
const BOT_STUCK_SECONDS = 1.5;   // 留まり続けたら迂回を開始する秒数
const BOT_DETOUR_SECONDS = 1.4;  // 迂回移動を維持する秒数(この間は通常の目標選択を抑制)
// 射撃訓練場の的。攻撃はせず、決められた2点の間を左右に往復するだけ
function updateTargetBotAI(b){
  b.attackTargetId = null;
  b.destination = null;
  if(!b.aiTargetPoint || dist(b, b.aiTargetPoint) < 40){
    b.rangeEndIdx = b.rangeEndIdx ? 0 : 1;
    b.aiTargetPoint = b.rangePoints[b.rangeEndIdx];
  }
}
function updateBotAI(b, dt){
  if(b.attackTargetId){ const t=getEntity(b.attackTargetId); if(!t||!t.alive) b.attackTargetId=null; }
  b.aiTimer -= dt;
  if(b.aiTimer>0) return;
  /* 反応の鈍さ。チュートリアルの練習試合と難易度「やさしい」の**両方を1つの式**で通す
     (中身は data.js の matchBotThinkMult。手加減が強いほうだけを採る)。
     ふつうの試合・マルチ・レイドでは倍率1のままで、従来と1つも変わらない。 */
  b.aiTimer = rand(0.22,0.4) * matchBotThinkMult();
  if(b.isTargetBot){ updateTargetBotAI(b); return; }
  if(b.isRaidBoss){ updateRaidBossAI(b); return; }

  // ===== チーム戦: ダウン中は戦えない。立っている味方の方へ這って寄る(蘇生されやすい位置へ) =====
  if(isTeamMatch() && entityDowned(b)){
    b.attackTargetId = null; b.destination = null;
    const mate = teamNearestStandingMate(b);
    if(mate) b.aiTargetPoint = { x:mate.x, y:mate.y };
    b.aiState = 'DOWNED';
    return;
  }

  // ===== スタック検知＆迂回 =====
  // 攻撃射程内で待機している場合(=意図的に止まっている)はスタック扱いしない。
  // それ以外で長時間ほとんど動けていない場合は、反対方向を向いて迂回ルートへ切り替える。
  let holdingInRange = false;
  if(b.attackTargetId){
    const t = getEntity(b.attackTargetId);
    if(t && t.alive){ const mv = activeMove(b); if(mv && dist(b,t) <= mv.range*0.92) holdingInRange = true; }
  }
  if(holdingInRange || !b.moveAnchor || dist(b, b.moveAnchor) > BOT_STUCK_MOVE_EPS){
    b.moveAnchor = {x:b.x, y:b.y}; b.moveAnchorAt = matchTime;
  }
  if(matchTime < (b.detourUntil||0)){
    // 迂回移動を継続(迂回先に近づいたら解除して通常AIへ戻す)
    if(b.aiTargetPoint && dist(b, b.aiTargetPoint) < 45){ b.detourUntil = 0; }
    else { b.aiState='DETOUR'; return; }
  }
  if(!holdingInRange && (matchTime - (b.moveAnchorAt||matchTime)) > BOT_STUCK_SECONDS){
    // 反対方向(±)へ中距離の迂回先を設定し、追跡を一旦やめて回り込む
    const backAng = (b.facingAngle!=null ? b.facingAngle : rand(0,Math.PI*2)) + Math.PI + rand(-0.7,0.7);
    let tx = b.x + Math.cos(backAng)*360, ty = b.y + Math.sin(backAng)*360;
    tx = clamp(tx, zoneState.center.x-zoneState.radius+30, zoneState.center.x+zoneState.radius-30);
    ty = clamp(ty, zoneState.center.y-zoneState.radius+30, zoneState.center.y+zoneState.radius-30);
    b.attackTargetId=null; b.destination=null;
    b.aiTargetPoint = {x:tx, y:ty};
    b.avoidDirSign = -(b.avoidDirSign||1); // 障害物回避の迂回方向も反転
    b.detourUntil = matchTime + BOT_DETOUR_SECONDS;
    b.moveAnchor = {x:b.x, y:b.y}; b.moveAnchorAt = matchTime;
    b.aiState='DETOUR'; return;
  }

  const outOfZone = dist(b, zoneState.center) > zoneState.radius - b.radius;
  if(outOfZone){
    b.attackTargetId=null; b.destination=null;
    b.aiTargetPoint = {x:zoneState.center.x+rand(-30,30), y:zoneState.center.y+rand(-30,30)};
    b.aiState='RETREAT'; return;
  }

  // ===== チーム戦(小隊行動②): ダウンした味方の蘇生を最優先で向かう =====
  // 蘇生半径(TEAM_REVIVE_RADIUS)内へ入れば、あとはupdateTeamStatesが進捗を進める
  if(isTeamMatch()){
    const dn = teamNearestDownedMate(b, TEAM_BOT_REVIVE_SEEK_RANGE);
    if(dn){
      b.attackTargetId=null; b.destination=null;
      b.aiTargetPoint = { x:dn.x+rand(-30,30), y:dn.y+rand(-30,30) };
      b.aiState='REVIVE'; return;
    }
  }

  // ===== ガッツ枯渇: どの技も撃てないほどガッツが無ければ、ガッツ飴を探して移動 =====
  if(b.guts < minMoveGutsCost(b)){
    b.attackTargetId=null;
    const gutsItem = findNearestGutsItem(b, 1400);
    if(gutsItem){ b.aiTargetPoint = {x:gutsItem.x, y:gutsItem.y}; b.aiState='SEEK_GUTS'; return; }
    // ガッツ飴が見つからない: 敵とは交戦せず(撃てないので)、他アイテムか徘徊で回復を待つ
    const otherLoot = findNearestLoot(b, 700);
    if(otherLoot){ b.aiTargetPoint = {x:otherLoot.x, y:otherLoot.y}; b.aiState='SEEK_GUTS'; return; }
    const threat = findNearestAliveEnemy(b, 420);
    if(threat){ const away = angTo(threat,b); b.aiTargetPoint = {x:b.x+Math.cos(away)*300, y:b.y+Math.sin(away)*300}; b.aiState='SEEK_GUTS'; return; }
    if(!b.aiTargetPoint || dist(b,b.aiTargetPoint)<40){
      const a=rand(0,Math.PI*2), r=rand(150,420);
      let tx=clamp(b.x+Math.cos(a)*r, zoneState.center.x-zoneState.radius+30, zoneState.center.x+zoneState.radius-30);
      let ty=clamp(b.y+Math.sin(a)*r, zoneState.center.y-zoneState.radius+30, zoneState.center.y+zoneState.radius-30);
      b.aiTargetPoint = {x:tx, y:ty};
    }
    b.aiState='SEEK_GUTS'; return;
  }

  const attackerCount = countRecentAttackers(b, 2.2);
  const lowHp = b.hp < b.maxHp*0.2;
  const overwhelmed = attackerCount >= 2;

  if(lowHp || overwhelmed){
    b.attackTargetId=null;
    const healItem = findNearestHealItem(b, 900, true) || findNearestHealItem(b, 900, false);
    if(healItem){
      b.aiTargetPoint = {x:healItem.x, y:healItem.y};
      b.aiState='FLEE_HEAL'; return;
    }
    const threat = findNearestAliveEnemy(b, 500);
    if(threat){
      const away = angTo(threat,b);
      b.aiTargetPoint = { x:b.x+Math.cos(away)*300, y:b.y+Math.sin(away)*300 };
    } else {
      b.aiTargetPoint = { x: zoneState.center.x+rand(-150,150), y: zoneState.center.y+rand(-150,150) };
    }
    b.aiState='FLEE'; return;
  }

  const enemy = findNearestAliveEnemy(b, 900);
  if(enemy){ b.attackTargetId = enemy.id; b.destination=null; b.aiState='FIGHT'; return; }

  // ===== チーム戦(小隊行動①): 交戦相手がいなければリーダー(生存最古=id最小)へ緩く追従 =====
  // リーダーの走査はチーム内(最大teamSize体)だけなので、60体でも全ペア距離計算にはならない
  if(isTeamMatch()){
    const leader = teamLeader(b.teamId);
    if(leader && leader!==b && dist(b, leader) > TEAM_FOLLOW_DIST){
      b.attackTargetId=null;
      b.aiTargetPoint = { x:leader.x+rand(-90,90), y:leader.y+rand(-90,90) };
      b.aiState='FOLLOW'; return;
    }
  }

  const loot = findNearestLoot(b, 750);
  if(loot){ b.attackTargetId=null; b.aiTargetPoint = {x:loot.x,y:loot.y}; b.aiState='LOOT'; return; }

  b.attackTargetId=null;
  if(!b.aiTargetPoint || dist(b,b.aiTargetPoint)<40){
    const a=rand(0,Math.PI*2), r=rand(150,480);
    let tx=b.x+Math.cos(a)*r, ty=b.y+Math.sin(a)*r;
    tx = clamp(tx, zoneState.center.x-zoneState.radius+30, zoneState.center.x+zoneState.radius-30);
    ty = clamp(ty, zoneState.center.y-zoneState.radius+30, zoneState.center.y+zoneState.radius-30);
    b.aiTargetPoint = {x:tx,y:ty};
  }
  b.aiState='WANDER';
}

/* =====================================================================
   MOVEMENT
===================================================================== */
// 進路上に円形障害物(火山/岩/水晶)があれば、ぶつかる前に左右へ迂回する角度を返す。
// 【チーム戦のスタック対策】以前は火山だけを見ていたため、岩・水晶へ向かって直進すると
// 反応がtryMoveAxisの接線すべり任せになり、味方に押し合われて動けなくなることがあった
// (2026-08-19)。同じロジックを岩・水晶にも広げ、当たる前の早い段階で迂回させる。
function computeObstacleAvoidAngle(m, target, ang){
  const targetDist = dist(m, target);
  let strongestPush = 0, pushSign = m.avoidDirSign || 1;
  const consider=(ox,oy,r)=>{
    const clearance = r + m.radius + 70;
    const obDist = dist(m, {x:ox,y:oy});
    if(obDist > targetDist + clearance || obDist > 2600) return;
    const toOb = angTo(m, {x:ox,y:oy});
    let diff = toOb - ang;
    while(diff > Math.PI) diff -= Math.PI*2;
    while(diff < -Math.PI) diff += Math.PI*2;
    const blockAngle = Math.atan2(clearance, Math.max(obDist,1)) + 0.25;
    if(Math.abs(diff) < blockAngle){
      const pushAmount = Math.min(1.5, (clearance/Math.max(obDist,1))*1.4);
      if(pushAmount > strongestPush){
        strongestPush = pushAmount;
        pushSign = diff >= 0 ? -1 : 1; // 障害物が進路の右にあれば左へ、左にあれば右へ迂回
      }
    }
  };
  if(currentMap.hasVolcano){ for(const v of volcanoObstacles) consider(v.x, v.y, mountainGroundRadius(v)); }
  // 岩・水晶は「建物などへ登っていない(地面基準)」ときだけ実際に当たる(blockedByRock/Crystalと同じ条件)
  if(m.z <= baseTerrainHeightAt(m.x, m.y) + 25){
    for(const r of rocks) consider(r.x, r.y, r.radius);
    for(const c of crystalObstacles) consider(c.x, c.y, c.radius);
  }
  return strongestPush > 0 ? ang + pushSign*strongestPush : ang;
}
// ===== マルチプレイ用の速度補正 =====
// 通信ありでは必ず1往復ぶんの遅延が乗るため、速く動くほど位置の食い違い(飛び)が目立つ。
// マルチのときだけ移動速度と弾速をわずかに落として同期しやすくする。
// プレイテストで調整する前提の名前付き定数(1=補正なし)。
const MULTI_MOVE_SPEED_MULT = 0.9;
const MULTI_PROJ_SPEED_MULT = 0.9;
function multiMoveSpeedMult(){ return netState.mode==='multi' ? MULTI_MOVE_SPEED_MULT : 1; }
function multiProjSpeedMult(){ return netState.mode==='multi' ? MULTI_PROJ_SPEED_MULT : 1; }

// 実効移動速度(育成・状態変化・技命中バフ・鈍足を反映。地形とマルチ補正は含めない)。
// resolveMovement とゲストの位置補正(network.js)が同じ値を見るように関数へ切り出してある。
function entityMoveSpeed(m){
  const stateEff = activeStateEffects(m);
  const hitBuffMult = (m.speedBuffUntil > matchTime) ? (m.speedBuffMult||1) : 1; // 技命中バフ(ワームtier3等)
  // ダウン中(チーム戦)は這い移動。ここに掛けるとホストとゲストの予測(network.js)が自動で一致する
  const downMult = entityDowned(m) ? TEAM_DOWN_SPEED_MULT : 1;
  const base = m.speed * downMult * (m.trainSpeedMult||1) * (stateEff && stateEff.speedMult || 1) * hitBuffMult;
  return m.slowUntil > matchTime ? base*0.5 : base;
}
function resolveMovement(m, dt){
  if(m.freezeUntil > matchTime) return;
  /* 「羅生門」(キジンtier3)に吸い込まれている間は、入力・AIより優先してこちらへ
     強制的に引き寄せる。moveWithMoveUntilと同じ「早期return」の形にしておくと、
     ダッシュ・通常入力・AIの判断が一切混ざらず素直に門へ向かう。 */
  if(m.pulledUntil > matchTime){
    const dx = m.pulledX - m.x, dy = m.pulledY - m.y;
    const d = Math.hypot(dx, dy);
    if(d > 4){
      const spd = Math.min(m.pulledSpeed||900, d/Math.max(dt, 0.0001));
      tryMoveAxis(m, dx/d*spd*dt, dy/d*spd*dt);
    }
    return;
  }
  /* レイドボスは技を溜めている間(予告中)は歩かない。
     【重要】ここで動けると、予告で見せた輪の位置から実際の攻撃がズレて、
     「予告範囲より大きい攻撃が来る」ように見える不具合になる(実際に報告があった)。 */
  if(m.isRaidBoss && typeof raidState!=='undefined' && raidState && raidState.pending) return;
  // 技と一緒に自分も前進する「移動技」用(デュラハン最終奥義など)。入力・AIより優先する
  if(m.moveWithMoveUntil > matchTime){
    tryMoveAxis(m, m.moveWithMoveDirX*m.moveWithMoveSpeed*dt, m.moveWithMoveDirY*m.moveWithMoveSpeed*dt);
    m.lastMoveX = m.moveWithMoveDirX; m.lastMoveY = m.moveWithMoveDirY;
    return;
  }
  const slowedSpeed = entityMoveSpeed(m);
  // 海/川/オアシスの中では移動速度が落ちる(ダッシュの飛距離計算には影響させない)。
  // マルチ補正もここで掛ける(ダッシュ速度は slowedSpeed 基準なので飛距離は変わらない)
  const effSpeed = slowedSpeed * terrainSpeedMult(m.x, m.y) * multiMoveSpeedMult();
  if(m.dashTimer>0){
    m.dashTimer -= dt;
    // ダッシュ速度は移動速度に反比例させる(移動速度200を基準に、遅いほど距離が伸びる)
    const dashSpeed = (DASH_REF_SPEED*DASH_REF_SPEED*DASH_SPEED_MULT)/Math.max(slowedSpeed,1);
    tryMoveAxis(m, m.dashDirX*dashSpeed*dt, m.dashDirY*dashSpeed*dt);
    return;
  }
  if(m.isPlayer || m.isRemoteHuman){
    tryMoveAxis(m, m.inputMoveX*effSpeed*dt, m.inputMoveY*effSpeed*dt);
    const moveLen = Math.hypot(m.inputMoveX,m.inputMoveY);
    if(moveLen>0.05){ m.lastMoveX=m.inputMoveX/moveLen; m.lastMoveY=m.inputMoveY/moveLen; }
    return;
  }
  let target = null;
  let mustMove = true;
  const outOfZone = dist(m, zoneState.center) > zoneState.radius - m.radius*0.4;
  if(outOfZone){
    target = zoneState.center;
  } else if(m.attackTargetId){
    const t = getEntity(m.attackTargetId);
    if(t && t.alive){
      const mv = activeMove(m);
      const d = dist(m,t);
      if(d > mv.range*0.92){ target = {x:t.x,y:t.y}; }
      else { mustMove=false; }
      m.facingAngle = angTo(m,t);
    } else { m.attackTargetId=null; target = m.destination; }
  } else if(m.destination){
    target = m.destination;
  } else {
    target = m.aiTargetPoint;
  }
  if(mustMove && target){
    const d = dist(m,target);
    if(d < 4){
      if(m.destination===target) m.destination=null;
      if(m.aiTargetPoint===target) m.aiTargetPoint=null;
      m.stuckTimer=0; m.stuckLevel=0;
    } else {
      let ang = angTo(m,target);
      if(!m.isPlayer){
        ang = computeObstacleAvoidAngle(m, target, ang);
        m.stuckTimer += dt;
        if(m.stuckTimer > 0.4){
          const moved = dist(m, m.stuckCheckPos);
          if(moved < m.speed*0.4*m.stuckTimer*0.35){
            m.stuckLevel = Math.min(m.stuckLevel+1, 6);
          } else {
            m.stuckLevel = Math.max(m.stuckLevel-1, 0);
          }
          m.stuckCheckPos = {x:m.x, y:m.y};
          m.stuckTimer = 0;
          if(m.stuckLevel>=2 && Math.random()<0.5) m.avoidDirSign *= -1;
        }
        if(m.stuckLevel>0){
          ang += m.avoidDirSign * Math.min(m.stuckLevel*0.35, 1.9);
        }
      }
      const mx = Math.cos(ang), my = Math.sin(ang);
      tryMoveAxis(m, mx*effSpeed*dt, my*effSpeed*dt);
      m.lastMoveX=mx; m.lastMoveY=my;
      if(!m.attackTargetId) m.facingAngle = angTo(m,target);
    }
  }
}
function separateEntities(){
  for(let i=0;i<entities.length;i++){
    const a = entities[i]; if(!a.alive) continue;
    for(let j=i+1;j<entities.length;j++){
      const b = entities[j]; if(!b.alive) continue;
      if(Math.abs(a.z-b.z) > 30) continue;
      const minD = a.radius+b.radius-4;
      const d = dist(a,b);
      if(d>0 && d<minD){
        const push = (minD-d)/2;
        const ang = angTo(b,a);
        const px=Math.cos(ang)*push, py=Math.sin(ang)*push;
        // 障害物を見ずに座標を直接動かすので、押した相手は必ずめり込みの点検へ回す
        // (チーム戦は味方どうしが固まって動くため、押し合いで岩の中へ入りやすい)
        a.x+=px; a.y+=py; b.x-=px; b.y-=py;
        a.needsDepenetrate = true; b.needsDepenetrate = true;
      }
    }
  }
}
function computePlayerInput(){
  // 計測ハーネス(tools/net_probe.html)からの外部駆動。通常プレイでは__netProbeInputは未定義で素通り
  const np = window.__netProbeInput;
  if(np){
    player.inputMoveX = np.mx||0;
    player.inputMoveY = np.my||0;
    if(typeof np.facing==='number') player.facingAngle = np.facing;
    return;
  }
  let fwd = 0, strafe = 0;
  if(keys['w']||keys['arrowup']) fwd += 1;
  if(keys['s']||keys['arrowdown']) fwd -= 1;
  if(keys['d']||keys['arrowright']) strafe += 1;
  if(keys['a']||keys['arrowleft']) strafe -= 1;
  if(joystick.active){ fwd += -joystick.ny; strafe += joystick.nx; }
  // オートラン中(ジョイスティック非操作時)は視点方向へ前進し続ける
  if(game.autoRun && !joystick.active) fwd += 1;
  fwd = clamp(fwd,-1,1); strafe = clamp(strafe,-1,1);
  const yaw = camState.yaw;
  let mx = fwd*Math.cos(yaw) + strafe*Math.cos(yaw+Math.PI/2);
  let my = fwd*Math.sin(yaw) + strafe*Math.sin(yaw+Math.PI/2);
  const len = Math.hypot(mx,my);
  if(len>1){ mx/=len; my/=len; }
  player.inputMoveX = mx;
  player.inputMoveY = my;
  player.facingAngle = yaw;
}
/* =====================================================================
   レイドバトル

   ボスは既存のエンティティ+areaEffect(範囲攻撃)だけで作ってある。新しい攻撃の
   仕組みは足していないので、通常の試合の挙動には一切影響しない。分岐はすべて
   game.raid の1つに寄せてある。
   ===================================================================== */
// レイドの進行状態。試合ごとに startRaid() が作り直す
let raidState = { bossId:null, nextAttackAt:0, pending:null, marks:[], repositionAt:0, endsAt:0, nextLootAt:0 };
/* レイドの状態を初期値へ戻す。試合を始める全経路(ソロ/マルチ/訓練場)の冒頭で必ず呼ぶ。
   これを忘れると、レイドの次に始めた通常の試合で game.raid が立ったままになり、
   ボスAI・レイドの安置・レイドの決着判定が同時に走って試合が続行不能になる。      */
function raidResetState(){
  game.raid = false;
  if(typeof netState!=='undefined') netState.raid = false;
  raidState = { bossId:null, nextAttackAt:0, pending:null, marks:[], repositionAt:0, endsAt:0, nextLootAt:0 };
  const hud = document.getElementById('raidHud');
  if(hud) hud.classList.add('hidden');
  const el = document.getElementById('hud');
  if(el) el.classList.remove('raid-mode');
}
function raidBossEntity(){
  if(!game.raid || !raidState || raidState.bossId==null) return null;
  const b = getEntity(raidState.bossId);
  return (b && b.alive) ? b : null;
}
// レイドでは味方どうしの攻撃を通さない(ボスが撃った/ボスに当たる攻撃だけが通る)
function raidFriendlyFireBlocked(target, source){
  if(!game.raid || !source || source===target) return false;
  return !target.isRaidBoss && !source.isRaidBoss;
}
// 装備スキンによるレイド特効(与ダメ・被ダメ)。ボスが絡む攻撃にだけ掛ける
function raidSkinMult(entity, kind){
  if(!game.raid || !entity) return 1;
  const bonus = (typeof raidSkinBonus==='function') ? raidSkinBonus(entitySkinId(entity)) : null;
  if(!bonus) return 1;
  return (kind==='dealt' ? bonus.dmgDealt : bonus.dmgTaken) || 1;
}

/* =====================================================================
   チーム戦の土台(3人1組×20チーム=60体まで拡張できる形)

   ・分岐の入口は isTeamMatch() 1つ(game.trainingRange と同じ方式)。
     個人戦(game.teamSize===1)では以下のどの関数も何もしないので、既存の経路は
     1バイトも変わらない。**同じ判定を2か所目に書かない。**
   ・チーム割当は「エンティティ生成順を teamSize ずつ区切る」だけの決定的な規則。
     マルチでは人間(id文字列順)→botの順で生成されるので、
     「人間を先に詰める・同チームは連番id」がホスト/ゲストで必ず一致する。
   ・味方への攻撃は applyDamage の入口(teamFriendlyFireBlocked)1か所で止める。
   ・ダウン→蘇生・全滅・チーム順位はホスト(=ソロでは自分)だけが確定し、
     ゲストへは authState の dw(ダウン残り秒)/ rv(蘇生の進み)で伝わる。
   ・レイドとは排他(レイドでは teamSize=1 のまま)。
   ===================================================================== */
let teamMembersById = new Map();   // teamId -> メンバー配列。assignTeams()が試合開始時に作る
function isTeamMatch(){ return (game.teamSize||1) > 1; }
function sameTeam(a,b){ return isTeamMatch() && a && b && a!==b && a.teamId!=null && a.teamId===b.teamId; }
// ダウン中か(生存扱いのまま動けない状態)。判定はこの1関数だけに書く
function entityDowned(e){ return !!(e && e.alive && e.downed); }
function teamMembers(teamId){ return teamMembersById.get(teamId) || []; }
/* チーム戦の状態を初期値へ戻す。試合を始める全経路(startGame / beginMultiplayerMatchInner /
   raidStart / startShootingRange)の冒頭で必ず呼ぶ(raidResetStateと同じ「入口で消す」決まり)。 */
function teamResetState(){
  game.teamSize = 1;
  teamMembersById = new Map();
  pingResetState();   // ピンとキルリーダーも試合をまたいで持ち越さない(「入口で必ず消す」の決まり)
}
/* エンティティ生成順に teamSize ずつ区切ってチームを割り当てる。
   entities の並びだけから決まるので、同じ並びを作る2者(ホスト/ゲスト)で必ず一致する。 */
function assignTeams(teamSize){
  game.teamSize = teamSize;
  teamMembersById = new Map();
  let idx = 0;
  for(const e of entities){
    if(e.isRaidBoss) continue;
    e.teamId = Math.floor(idx/teamSize); idx++;
    e.downed = false; e.downedUntil = 0; e.reviveProgress = 0;
    if(!teamMembersById.has(e.teamId)) teamMembersById.set(e.teamId, []);
    teamMembersById.get(e.teamId).push(e);
  }
}
// チーム戦では同チームへの攻撃を通さない(raidFriendlyFireBlockedと同じ形の1か所判定)
function teamFriendlyFireBlocked(target, source){
  return !!(source && source!==target && sameTeam(target, source));
}
/* 弾が同チームの体で消えないようにする(素通り)。ダメージ自体はapplyDamageで止まるが、
   弾が味方の体に当たって消えると「味方が壁になる」ため、直撃判定の前にここで抜く。
   ownerTeamIdは初回に1度だけ引いて弾へキャッシュする(60体でも毎フレームfindしない)。 */
function projTeamBlocked(p, e){
  if(!isTeamMatch() || e.teamId==null) return false;
  if(p.ownerTeamId===undefined){
    const o = p.ownerId!=null ? getEntity(p.ownerId) : null;
    p.ownerTeamId = (o && o.teamId!=null) ? o.teamId : null;
  }
  return p.ownerTeamId!=null && p.ownerTeamId===e.teamId;
}
// 立っている(生存・非ダウン)味方が1体でもいるか
function teamHasStandingMate(ent){
  return teamMembers(ent.teamId).some(m=> m!==ent && m.alive && !entityDowned(m));
}
// リーダー=チームの生存最古(=idが最小の非ダウン生存者)。メンバーは最大でもteamSize体なので毎回走査してよい
function teamLeader(teamId){
  let best = null;
  for(const m of teamMembers(teamId)){
    if(!m.alive || entityDowned(m)) continue;
    if(!best || m.id < best.id) best = m;
  }
  return best;
}
function teamNearestStandingMate(e){
  let best=null, bestD=Infinity;
  for(const m of teamMembers(e.teamId)){
    if(m===e || !m.alive || entityDowned(m)) continue;
    const d = dist(e,m); if(d<bestD){ bestD=d; best=m; }
  }
  return best;
}
function teamNearestDownedMate(e, range){
  let best=null, bestD=range;
  for(const m of teamMembers(e.teamId)){
    if(m===e || !m.alive || !entityDowned(m)) continue;
    const d = dist(e,m); if(d<bestD){ bestD=d; best=m; }
  }
  return best;
}
/* HP0になった仲間をダウンで踏みとどまらせる(killEntityの冒頭から呼ばれる)。
   立っている味方がいなければ false(=そのまま死亡=チーム全滅の一角)。
   すでにダウン中のHP0は「とどめ」なので false(本当の死亡へ進む)。 */
function tryEnterDowned(victim, killer){
  if(!isTeamMatch() || victim.teamId==null) return false;
  if(entityDowned(victim)) return false;
  if(!teamHasStandingMate(victim)) return false;
  victim.hp = Math.max(1, Math.round(victim.maxHp*TEAM_DOWN_HP_RATIO)); // HPバーを0にしない(とどめ用の体力)
  victim.downed = true;
  victim.downedUntil = matchTime + TEAM_DOWN_BLEED_SEC;
  victim.reviveProgress = 0;
  victim.attackTargetId = null;
  victim.dashTimer = 0;
  // 【発注者要望 2026-08-19】チーム戦のキル数・キルボーナスは「とどめを刺した人」ではなく
  // 「ダウンさせた人」に入れる。ここで記録し、killEntity側の本当の死亡時にこれで上書きする
  victim.downedByKillerId = (killer && killer.id!==victim.id) ? killer.id : null;
  // ダウン直後2秒は無敵(その間はとどめを刺せない。発注者要望 2026-08-19)。
  // 起き上がる瞬間に囲まれて即詰みになるのを防ぐ狙い
  victim.downedInvulnUntil = matchTime + TEAM_DOWN_INVULN_SEC;
  const text = (killer && killer.id!==victim.id)
    ? `${displayNameFor(killer)} が ${displayNameFor(victim)} をダウンさせた`
    : `${displayNameFor(victim)} はダウンした`;
  pushKillFeed(text);   // キルフィードは「ダウンさせた」と「とどめ(倒した)」を区別する
  // 自分のダウンは画面下の帯(drawSelfDownedOverlay)が唯一の表示。
  // トーストも出すと帯と物理的に重なって両方読めない(批評指摘で削除)。
  // ゲストには「ホストのループの中でしか起きないこと」が何も起きないので、フィードを配信する
  if(netState.mode==='multi' && netState.isHost){
    window.__aramonPushEvent(netState.roomId, { kind:'down', text, victimId:victim.id, ts:Date.now() });
  }
  return true;
}
// 蘇生(味方が半径内に一定時間とどまると発動。進行はupdateTeamStatesが進める)
function reviveEntity(e){
  e.downed = false; e.downedUntil = 0; e.reviveProgress = 0;
  e.downedByKillerId = null;   // 蘇生したら「誰にダウンさせられたか」の記録も白紙に戻す
  e.downedInvulnUntil = 0;
  e.hp = Math.max(1, Math.round(e.maxHp*TEAM_REVIVE_HP_RATIO));
  const text = `${displayNameFor(e)} が蘇生した`;
  pushKillFeed(text);
  spawnDmgText(e.x, e.y, e.z, '蘇生', '#7fffa0');
  if(e.isPlayer){ pushToast('蘇生された！'); playSe('pickup'); }
  if(netState.mode==='multi' && netState.isHost){
    window.__aramonPushEvent(netState.roomId, { kind:'revive', entId:e.id, text, ts:Date.now() });
  }
}
/* 出血タイマーと蘇生の進行。update()(=ソロとホストのループ)から毎フレーム呼ぶ。
   エンティティ全体を1周し、ダウン中の1体につき自チームの最大teamSize体だけを見るので、
   60体でも全ペアの距離計算にはならない。 */
function updateTeamStates(dt){
  if(!isTeamMatch()) return;
  for(const e of entities){
    if(e.teamId==null || !e.alive) continue;
    if(!e.downed){ e.reviveProgress = 0; continue; }
    if(matchTime >= e.downedUntil){ killEntity(e, null); continue; }  // 出血死(downedのままなのでとどめ扱い)
    let near = false;
    for(const m of teamMembers(e.teamId)){
      if(m===e || !m.alive || entityDowned(m)) continue;
      if(dist(m,e) <= TEAM_REVIVE_RADIUS){ near = true; break; }
    }
    if(near){
      e.reviveProgress = (e.reviveProgress||0) + dt;
      if(e.reviveProgress >= TEAM_REVIVE_SEC) reviveEntity(e);
    } else {
      e.reviveProgress = 0;   // 離れたら最初から(進捗は持ち越さない)
    }
  }
}
/* ===== ピン(シグナル)とキルリーダー(APEX風のチーム体験) =====
   ・ピンはチーム系モード(isTeamMatch)のみ。同期は「発信者→全員のイベント配信」(kind:'ping')で、
     ホスト権威ではない(表示だけの機能なので誰が送ってもよい=ゲストも発信できる)。
   ・botはピンに反応しない(表示のみ)。ソロ小隊でも味方botの行動は変わらない。
   ・キルリーダーはauthStateで同期済みのkillsから毎フレーム全員が導出する(同期の追加なし)。 */
let teamPings = new Map();     // 発信者のエンティティid -> ピン。1人が連打しても最新1個だけ(上書き)
let killLeaderCurId = null;    // 現在のキルリーダーのエンティティid(2キル未満しかいなければnull)
function pingResetState(){
  lastPingSentAt = -Infinity; teamPings = new Map(); killLeaderCurId = null; }

// 照準方向の敵を探す(ロックオン表示と同じ「向いている先」基準。角度内で最も近い敵)
function pingFindEnemy(){
  let best = null, bestD = PING_ENEMY_SEARCH_RANGE;
  for(const e of entities){
    if(e===player || !e.alive || e.isRaidBoss) continue;
    if(sameTeam(player, e)) continue;
    const d = dist(player, e);
    if(d > bestD) continue;
    if(Math.abs(angleDiff(angTo(player, e), player.facingAngle)) > PING_ENEMY_SEARCH_ANGLE) continue;
    bestD = d; best = e;
  }
  return best;
}
/* ピンを打つ(ボタン1押しで完結)。照準の先に敵がいれば敵ピン、いなければ移動ピン。 */
let lastPingSentAt = -Infinity;
const PING_COOLDOWN_SEC = 1.2;   // 連打スパム防止(フィードが同じ行で埋まる=批評指摘)
function sendPing(){
  if(!game.started || game.over || !player || !player.alive) return;
  if(!isTeamMatch()) return;
  if(matchTime - lastPingSentAt < PING_COOLDOWN_SEC) return;
  lastPingSentAt = matchTime;
  const enemy = pingFindEnemy();
  let data;
  if(enemy){
    data = { pk:'enemy', tId: enemy.id };
  } else {
    // 障害物(岩・山)を貫通した先を指さない(見えない場所へ旗が立つと迷う)
    const d = raycastObstacleDistance(player.x, player.y, player.facingAngle, PING_RANGE);
    data = { pk:'move',
      x: Math.round(clamp(player.x + Math.cos(player.facingAngle)*d, 0, WORLD.w)),
      y: Math.round(clamp(player.y + Math.sin(player.facingAngle)*d, 0, WORLD.h)) };
  }
  applyPing({ ...data, entId: player.id });  // 自分の画面には即時反映(往復を待たない)
  if(netState.mode==='multi' && netState.roomId){
    // 自分のエコーは受信側でpidで捨てる(上で適用済み)。teamは「同じ小隊だけ表示」の判定に使う
    window.__aramonPushEvent(netState.roomId,
      { kind:'ping', pid: netState.myPlayerId, team: player.teamId, entId: player.id, ...data, ts: Date.now() });
  }
}
/* ピンを表示に反映する(発信者本人と、イベントを受け取った同じ小隊の両方が通る)。
   エンティティidはホスト/ゲストで一致する(チーム戦の土台の決まり)ので、idの読み替えは不要。
   期限は受信時の自分のmatchTime基準にする(ホストとゲストのmatchTimeはズレるため絶対時刻を使わない)。 */
function applyPing(d){
  const sender = getEntity(d.entId);
  if(!sender) return;
  teamPings.set(d.entId, { kind: d.pk, x: d.x, y: d.y, targetId: d.tId,
    senderId: d.entId, bornAt: matchTime, expireAt: matchTime + PING_LIFETIME_SEC });
  playSe('pickup');   // 軽い通知音(専用SEは作らず既存を流用)
  pushKillFeed(d.pk==='enemy' ? `📍 ${displayNameFor(sender)}: 敵発見！` : `📍 ${displayNameFor(sender)}: ここへ！`);
}
/* 期限切れ・対象消滅のピンを掃除する(updateHUDから毎フレーム=ゲストのループでも回る)。 */
function prunePings(){
  if(!teamPings.size) return;
  for(const [key, pg] of teamPings){
    if(matchTime >= pg.expireAt){ teamPings.delete(key); continue; }
    if(pg.kind==='enemy'){
      const t = getEntity(pg.targetId);
      if(!t || !t.alive) teamPings.delete(key);   // 倒された敵のピンは残さない
    }
  }
}

/* ===== キルリーダー(個人戦・チーム戦の両方で出す) =====
   導出は決定的(kills最多・同数ならentitiesの並びで先)にして、ホストとゲストが
   同期済みのkillsから必ず同じ答えを出すようにする(リーダーidそのものは同期しない)。 */
function computeKillLeaderId(){
  let best = null, bestK = KILL_LEADER_MIN_KILLS - 1;
  for(const e of entities){
    if(!e.alive || e.isRaidBoss) continue;
    const k = e.kills || 0;
    if(k > bestK){ bestK = k; best = e; }
  }
  return best ? best.id : null;
}
function isKillLeader(e){ return !!(e && killLeaderCurId!=null && e.id===killLeaderCurId); }
/* 毎フレーム呼ぶ(updateHUD経由=ソロ・ホスト・ゲスト全員)。交代のフィード行は
   ホスト/ソロだけが確定し、ゲストへは既存のkillイベント(textだけ)を流用して配る。 */
function updateKillLeader(){
  if(!game.started || game.over || game.raid || game.trainingRange){ killLeaderCurId = null; return; }
  const id = computeKillLeaderId();
  if(id === killLeaderCurId) return;
  killLeaderCurId = id;
  if(id==null) return;
  if(netState.mode==='multi' && !netState.isHost) return;  // ゲストは導出だけ(フィードはイベントで届く)
  const ent = getEntity(id);
  if(!ent) return;
  const text = `👑 ${displayNameFor(ent)} がキルリーダーになった`;
  pushKillFeed(text);
  if(netState.mode==='multi'){
    window.__aramonPushEvent(netState.roomId, { kind:'kill', text, ts: Date.now() });
  }
}

function countAliveTeams(){
  const s = new Set();
  for(const e of entities){ if(e.alive && e.teamId!=null) s.add(e.teamId); }
  return s.size;
}
/* 死亡のたびにチーム全滅を確認する(killEntityから呼ばれる)。
   立っている味方が誰もいなくなったチームは全滅=ダウン中の残りも死亡確定し、
   チーム順位(全員同順位)を付ける。 */
function teamNoteDeath(victim, killer){
  if(!isTeamMatch() || victim.teamId==null) return;
  const members = teamMembers(victim.teamId);
  if(members.some(m=> m.alive && !entityDowned(m))) return;   // まだ立っている味方がいる
  // 全滅: ダウン中の味方も死亡確定(killEntity内のtryEnterDownedは既ダウンなので通らない)
  for(const m of members){ if(m.alive) killEntity(m, killer||null); }
  // チーム順位=残っているチーム数+1(全員に同じ順位。再帰しても同じ値になる冪等な代入)
  const place = countAliveTeams() + 1;
  for(const m of members){ m.placement = place; }
  /* 小隊全滅はキルフィードでも伝える(誰かのダウン・キルの行だけでは
     「あの小隊が消えた」という戦況の変化が読めない)。ゲストへはkillイベントと
     同じ経路で配る(ホストのフィードは即時、ゲストはイベント受信で表示) */
  {
    const repName = displayNameFor(members[0]);
    const text = `💀 ${repName} の小隊が全滅した`;
    pushKillFeed(text);
    if(netState.mode==='multi' && netState.isHost){
      window.__aramonPushEvent(netState.roomId, { kind:'kill', text, ts:Date.now() });
    }
  }
  // ソロのチーム戦: 自分のチームが全滅した時点でリザルトへ(観戦はここで終わり)
  if(netState.mode!=='multi' && player && player.teamId===victim.teamId && !game.over && !player.alive){
    showResult(false, place);
  }
}
/* チーム戦の決着=自チーム以外の全チーム全滅。checkWin()から分岐してくる(ホスト/ソロのみ)。 */
function checkTeamWin(){
  const aliveTeamIds = new Set();
  for(const e of entities){ if(e.alive && e.teamId!=null) aliveTeamIds.add(e.teamId); }
  if(netState.mode==='multi' && hostSpectating){
    // ホスト敗退後、人間も自チームも残っていなければ決着(最後の1チーム)を待たずにリザルトへ
    const humanAlive = entities.some(e=>e.alive && e.netPlayerId);
    const myTeamAlive = player && player.teamId!=null && aliveTeamIds.has(player.teamId);
    if(!humanAlive && !myTeamAlive){ showResult(false, player.placement||2); return; }
  }
  if(aliveTeamIds.size > 1) return;
  const winnerTeamId = aliveTeamIds.size===1 ? aliveTeamIds.values().next().value : null;
  if(winnerTeamId!=null){ for(const m of teamMembers(winnerTeamId)) m.placement = 1; }  // 勝ちチームは全員1位
  if(netState.mode==='multi'){
    // 個人戦のcheckWinと同じ理由で、決着した瞬間の最終状態を通常の配信タイマーを待たずに配る
    window.__aramonPublishAuthState(netState.roomId, buildAuthStatePayload()).catch(()=>{});
    const wm = winnerTeamId!=null ? teamMembers(winnerTeamId) : [];
    window.__aramonPushEvent(netState.roomId, {
      kind:'matchEnd', winnerTeam: winnerTeamId,
      winnerNetId: (wm.find(m=>m.netPlayerId)||{}).netPlayerId || null,
      winnerName: wm.map(m=>m.name).join('・'), ts:Date.now(),
    });
  }
  if(player && winnerTeamId!=null && player.teamId===winnerTeamId){
    onPlayerWin();   // 自分がダウン/死亡していてもチームが勝てば勝利
  } else if(!game.over){
    showResult(false, (player && player.placement)||2);
  }
}

/* =====================================================================
   バトルアリーナ(1チームvs1チーム・3v3=6体・1本勝負)

   ・分岐の入口は game.arena 1つ(game.raid / game.trainingRange と同じ方式)。
     個人戦・通常のチーム戦ではどの関数も何もしないので既存の経路は変わらない。
     **同じ判定を2か所目に書かない。**
   ・チームの仕組み(ダウン/蘇生/全滅の決着=checkTeamWin/チームリザルト)は
     チーム戦の土台をそのまま使う。アリーナ固有なのは「中央固定の小さい安置」
     (world.jsのinitArenaZone/updateArenaZone)・「対面スポーン」・「時間切れの決着」だけ。
   ===================================================================== */
/* アリーナの状態を初期値へ戻す。試合を始める全経路(startGame / beginMultiplayerMatchInner /
   raidStart / startShootingRange)の冒頭で必ず呼ぶ(raidResetStateと同じ「入口で消す」決まり)。 */
function arenaResetState(){
  game.arena = false;
}
/* 時間切れの決着。update()(=ソロとホストのループ)から毎フレーム見る。
   レイドのcheckRaidEndと同じ理由で「誰かが倒れたとき」だけの判定にしない
   (時間が来ても誰も倒れなければ試合が終わらなくなる)。
   全滅による通常の決着は checkTeamWin がそのまま効くので、ここでは時間だけを見る。 */
function updateArena(dt){
  if(!game.arena || game.over) return;
  if(netState.mode==='multi' && !netState.isHost) return;   // 決着はホストだけが確定させる
  if(matchTime < ARENA_TIME_LIMIT) return;
  /* 生存数が多いチームの勝ち。同数ならHP合計(ダウン中も蘇生の望みがあるので生存に数える)。
     それでも並んだら先着チーム(teamIdが小さい方)。ホストだけが判定するので同着の裁定も1つに決まる。 */
  const score = new Map();
  for(const e of entities){
    if(!e.alive || e.teamId==null) continue;
    const s = score.get(e.teamId) || { alive:0, hp:0 };
    s.alive++; s.hp += Math.max(0, e.hp);
    score.set(e.teamId, s);
  }
  let winnerTeamId = null, best = null;
  for(const [tid, s] of score){
    if(!best || s.alive > best.alive || (s.alive===best.alive && s.hp > best.hp)
       || (s.alive===best.alive && s.hp===best.hp && tid < winnerTeamId)){
      winnerTeamId = tid; best = s;
    }
  }
  // 決着の付け方・配信はcheckTeamWinの全滅決着と同じ形(勝ちチーム全員1位・残りは2位)
  for(const e of entities){
    if(e.teamId==null) continue;
    e.placement = (e.teamId===winnerTeamId) ? 1 : 2;
  }
  if(netState.mode==='multi'){
    window.__aramonPublishAuthState(netState.roomId, buildAuthStatePayload()).catch(()=>{});
    const wm = winnerTeamId!=null ? teamMembers(winnerTeamId) : [];
    window.__aramonPushEvent(netState.roomId, {
      kind:'matchEnd', winnerTeam: winnerTeamId,
      winnerNetId: (wm.find(m=>m.netPlayerId)||{}).netPlayerId || null,
      winnerName: wm.map(m=>m.name).join('・'), ts:Date.now(),
    });
  }
  if(player && winnerTeamId!=null && player.teamId===winnerTeamId){
    onPlayerWin();   // 時間切れでも生存数で上回っていればチームの勝ち
  } else {
    showResult(false, (player && player.placement)||2);
  }
}

/* --- ボスAI ---
   ①予告(トースト+標的の輪)を出す ②予告時間が過ぎたら実際の範囲攻撃を出す
   の2段構え。攻撃の間隔は時間が経つほど短くなり、高tierの技も出やすくなる。   */
function updateRaidBossAI(b){
  if(!raidState) return;
  b.attackTargetId = null;
  b.destination = null;
  const elapsed = matchTime;
  // ほとんど動かないが、たまに少しだけ位置を変えて棒立ちに見えないようにする
  // 定期的に少しだけ動く。歩行モーションが見えるよう、必ず今の位置から離れた点を選ぶ
  if(matchTime >= raidState.repositionAt){
    raidState.repositionAt = matchTime + RAID_BOSS.repositionEvery;
    const a = rand(0, Math.PI*2), d = rand(RAID_BOSS.repositionDist*0.5, RAID_BOSS.repositionDist);
    const m = RAID_BOSS.radius + 120;   // 巨体なので壁から半径ぶん離す
    b.aiTargetPoint = {
      x: clamp(b.raidHomeX + Math.cos(a)*d, m, WORLD.w-m),
      // 上(火山側)へは行かせない。行かせると山の斜面に食い込んで見える
      y: clamp(b.raidHomeY + Math.sin(a)*d, raidBossMinY(), WORLD.h-m),
    };
  }
  if(b.aiTargetPoint && dist(b, b.aiTargetPoint) < 40) b.aiTargetPoint = null;

  if(raidState.pending) return;                  // 予告中は次の攻撃を積まない
  if(matchTime < raidState.nextAttackAt) return;
  const move = raidPickMove(elapsed);
  raidBeginBossAttack(b, move, elapsed);
}
// 予告を出す。標的(marks)は描画側が点滅する輪として描く
function raidBeginBossAttack(b, move, elapsed){
  const targets = entities.filter(e=>e.alive && !e.isRaidBoss);
  const focus = targets.length ? targets[randInt(0, targets.length-1)] : null;
  const marks = [];
  if(move.shape==='meteor'){
    const n = move.count || 1;
    for(let i=0;i<n;i++){
      // 1発目は誰かの足元、それ以降は闘技場のどこかへばらまく
      const t = (i===0 && focus) ? focus : (targets.length ? targets[randInt(0,targets.length-1)] : null);
      const jitter = i===0 ? 60 : 220;
      const x = t ? t.x + rand(-jitter,jitter) : rand(300, WORLD.w-300);
      const y = t ? t.y + rand(-jitter,jitter) : rand(300, WORLD.h-300);
      marks.push({ x, y, r:move.range });
    }
  } else if(move.selfCentered){
    marks.push({ x:b.x, y:b.y, r:move.range });
  } else {
    // 扇はボスの正面。予告のあいだにボスの向きが変わらないよう、ここで角度を固定する
    const ang = focus ? angTo(b, focus) : b.facingAngle;
    b.facingAngle = ang;
    marks.push({ x:b.x, y:b.y, r:move.range, angle:ang, fanDeg:move.fanAngleDeg });
  }
  const tele = raidTelegraphTime(move);
  raidState.pending = { move, marks, fireAt: matchTime + tele, angle: b.facingAngle };
  raidState.marks = marks;
  if(typeof pushToast==='function') pushToast(move.warn);
  playSe(move.tier>=3 ? 'godRising' : 'fireRoar');
  // ゲストには「ホストのループの中でしか起きないこと」が何も起きないので、予告を配信する。
  // 送るのは表示に必要なぶんだけ(技キー・標的・予告の長さ)。当たり判定はホストのまま。
  if(netState.mode==='multi' && netState.isHost){
    window.__aramonPushEvent(netState.roomId, {
      kind:'raidTele', mv:move.key, tele,
      marks: marks.map(m=>({ x:Math.round(m.x), y:Math.round(m.y), r:Math.round(m.r),
                             a: m.angle!=null ? Math.round(m.angle*1000)/1000 : null,
                             f: m.fanDeg!=null ? m.fanDeg : null })),
      ts: Date.now(),
    });
  }
}
// 予告が明けたら実際の範囲攻撃(areaEffect)を出す。当たり判定も描画も既存の仕組みに乗る
function raidFireBossAttack(b){
  const p = raidState && raidState.pending;
  if(!p || !p.move) return;
  const move = p.move;
  const made = [];
  const mk = (x, y, kind, angle)=>{
    const range = move.range;
    const ae = {
      id:nextId++, ownerId:b.id, kind, x, y, z:0, angle: angle||0,
      dmg: move.dmg, color: move.color, range, width:0,
      fanAngleDeg: move.fanAngleDeg||45, beamCount:0, beamSpreadDeg:0,
      fillSpeed: Math.max(700, range/0.55), telegraphTime:0,
      spawnAt: matchTime, hitIds:new Set(), resolved:false, style:null,
      moveAura:'red', auraTint: move.color, raidBossAttack:true,
    };
    ae.life = range/ae.fillSpeed + 0.35;
    areaEffects.push(ae);
    made.push(ae);
  };
  // 予告(p.marks)に記録した位置から撃つ。**b.x/b.yを直接読まない**
  // (ボスは予告中は動かないが、記録済みの位置を使えば万一動いても予告とズレない)
  if(move.shape==='meteor'){
    for(const m of p.marks) mk(m.x, m.y, 'circle');
  } else if(move.shape==='circle'){
    const m0 = p.marks[0];
    mk(m0.x, m0.y, 'circle');
  } else {
    const m0 = p.marks[0];
    mk(m0.x, m0.y, 'fan', p.angle);
  }
  playSe(move.tier>=3 ? 'beam' : 'fire');
  // ゲストにも同じ範囲攻撃を見せる(見た目専用。ダメージはホストが確定させる)
  if(netState.mode==='multi' && netState.isHost){
    for(const ae of made){
      window.__aramonPushShotEvent(netState.roomId, {
        type:'aoe', kind:ae.kind, x:Math.round(ae.x), y:Math.round(ae.y),
        angle:Math.round(ae.angle*1000)/1000, color:ae.color, range:Math.round(ae.range), width:0,
        fanAngleDeg:ae.fanAngleDeg, beamCount:0, beamSpreadDeg:0,
        life:Math.round(ae.life*100)/100, fillSpeed:Math.round(ae.fillSpeed),
        telegraphTime:0, style:null, auraTint:ae.auraTint||null, auraAccent:ae.auraAccent||null, moveAura:ae.moveAura||null,
      });
    }
  }
  raidState.pending = null;
  raidState.marks = [];
  raidState.nextAttackAt = matchTime + raidAttackGap(matchTime);
}
// 毎フレームの進行(予告の消化と、ボスのガッツを常に空にしておく処理)
function updateRaid(dt){
  if(!game.raid || !raidState) return;
  const b = raidBossEntity();
  if(b){
    b.guts = 0;              // ボスはガッツを持たない(技はガッツを使わず専用AIで撃つ)
    b.maxGuts = 0;
  }
  if(raidState.pending && matchTime >= raidState.pending.fireAt){
    if(b) raidFireBossAttack(b);
    else { raidState.pending = null; raidState.marks = []; }
  }
  raidRefillLoot();
  /* 【必須】決着はここで毎フレーム見る。
     以前は「誰かが倒れたとき(checkWin)」しか見ていなかったので、
     **残り時間が0になっても誰も倒れなければ試合が終わらなかった**
     (味方botがボスを削り切るまで延々と続く、という報告が実際にあった)。 */
  checkRaidEnd();
}
/* 3分間ずっと技を撃ち続ける戦いなので、開始時に撒いたぶんだけでは途中でガッツが尽きる。
   一定間隔で安置内へ追加を撒く。updateRaidはソロとホストでしか回らないので、
   マルチではここで撒いたぶんをゲストへ明示的に配信する(安置縮小時と同じやり方)。 */
function raidRefillLoot(){
  if(matchTime < raidState.nextLootAt) return;
  raidState.nextLootAt = matchTime + RAID_LOOT_REFILL_EVERY;
  const before = lootItems.length;
  // 今の安置の中に撒く(外に出ると取りに行けない)
  spawnLoot(RAID_LOOT_REFILL_COUNT, zoneState.center, Math.max(120, zoneState.radius*0.8));
  if(netState.mode==='multi' && netState.isHost && window.__aramonPushLootEvent){
    for(let i=before;i<lootItems.length;i++){
      const it = lootItems[i];
      window.__aramonPushLootEvent(netState.roomId, {
        evtType:'spawn', id:it.id, kind:it.kind, itemType:it.type, x:Math.round(it.x), y:Math.round(it.y), bob:it.bob,
      });
    }
  }
}
// レイドの決着判定。ボス撃破か時間切れで終わる(勝敗は「ボスを倒せたか」)
function checkRaidEnd(){
  if(!game.raid || game.over || !raidState) return;
  // マルチではホストだけが決着を確定させ、raidEndイベントで全員に伝える
  if(netState.mode==='multi' && !netState.isHost) return;
  const b = raidBossEntity();
  let done = null;
  if(!b) done = true;                                        // 討伐
  else if(matchTime >= raidState.endsAt) done = false;        // 時間切れ
  else if(!entities.some(e=>e.alive && !e.isRaidBoss)) done = false;  // 挑戦者が全滅
  if(done===null) return;
  if(netState.mode==='multi' && netState.isHost){
    // 決着した瞬間の全員の状態(貢献度を含む)を待たずに配信してから終わらせる
    window.__aramonPublishAuthState(netState.roomId, buildAuthStatePayload()).catch(()=>{});
    window.__aramonPushEvent(netState.roomId, { kind:'raidEnd', defeated:done, ts:Date.now() });
  }
  finishRaid(done);
}

// ===== 観戦(ホスト敗退後) =====
let spectateTargetId = null;
// 観戦対象候補: 自分以外の生存者。人間プレイヤーを先に並べ、その後にbotを並べる。
// 以前は人間プレイヤーだけを候補にしていたため、生き残りが1人しかいない場面
// (2人対戦でbotが残っている等)では「次のプレイヤー」を押しても切り替わらなかった。
function spectateCandidates(){
  // レイドのボスは「味方」ではないので観戦対象に入れない
  const list   = entities.filter(e=>e.alive && e!==player && !e.isRaidBoss);
  // チーム戦は味方を最優先(その後は従来どおり人間→bot)
  const isMate = (e)=> isTeamMatch() && player && player.teamId!=null && e.teamId===player.teamId;
  const mates  = list.filter(isMate);
  const rest   = list.filter(e=>!isMate(e));
  const humans = rest.filter(e=>e.netPlayerId);
  const bots   = rest.filter(e=>!e.netPlayerId);
  return mates.concat(humans, bots);
}
/* いま観戦中か。**この判定は1か所だけに書く**(視点・観戦バーの両方がこれを見る)。
   ・通常マルチ: ホストが敗退したとき
   ・レイド: 自分が倒れて味方が残っているとき(ソロ・マルチとも。倒れても試合は続くため) */
function spectatingNow(){
  if(!hostSpectating) return false;
  return game.raid || netState.mode==='multi' || isTeamMatch(); // チーム戦は倒れても味方が戦う間は観戦
}
// 現在の観戦対象を返す(不在なら先頭へ差し替え)。観戦していなければnull
function ensureSpectateTarget(){
  const cands = spectateCandidates();
  if(!cands.length){ if(spectateTargetId!=null){ spectateTargetId=null; if(typeof updateSpectateBar==='function') updateSpectateBar(); } return null; }
  let cur = cands.find(e=>e.id===spectateTargetId);
  if(!cur){ cur = cands[0]; spectateTargetId = cur.id; if(typeof updateSpectateBar==='function') updateSpectateBar(); }
  return cur;
}
// 次の生存プレイヤーへ観戦対象を切り替える
// 観戦対象の切替: 対象の位置へ視点を飛ばし、向きは対象自身のfacingAngleへ滑らかに寄せる
// (以前はangTo(player,target)=「(倒れて動かない)自分から見た方角」を使っており、
//  対象自身の視界とズレていた。updateCamera側の毎フレーム追従に引き継ぐための初動だけここが担当)
function spectateSnapToTarget(target){
  camSnap.active = true;
  camSnap.fromYaw = camState.yaw;
  camSnap.toYaw = camState.yaw + angleDiff(target.facingAngle, camState.yaw);
  camSnap.t = 0;
  camSnap.duration = 0.28;
}
function spectateNext(){
  const cands = spectateCandidates();
  if(!cands.length){ spectateTargetId=null; if(typeof updateSpectateBar==='function') updateSpectateBar(); return; }
  let idx = cands.findIndex(e=>e.id===spectateTargetId);
  idx = (idx+1) % cands.length;
  spectateTargetId = cands[idx].id;
  if(typeof updateSpectateBar==='function') updateSpectateBar();
  spectateSnapToTarget(cands[idx]);
}
// カメラ・描画の視点主体(観戦中は生存プレイヤー、通常は自分)
function currentViewEntity(){
  if(spectatingNow()){
    const t = ensureSpectateTarget();
    if(t) return t;
  }
  return player;
}
function updateCamera(dt){
  const v = currentViewEntity();
  // マップを移ったときに前のマップの視点角度が残らないようにする(リアルマップだけ上向きが広い)
  camState.pitch = clamp(camState.pitch, camPitchMin(), CAM_PITCH_MAX);
  /* 【観戦カメラ修正 2026-08-19】観戦中は自分でドラッグ操作せず、見ているモンスター
     本体の向き(facingAngle=その本体のAI/入力が向いている方向)へ視点を追従させる。
     以前はcamState.yaw/pitchが自分の最後の操作値のまま固定/操作可能で、
     「視点と画面表示がチグハグ」になる原因の一つだった。
     camSnap(spectateNext等の切替演出)中はそちらを優先し、終わったら追従を再開する。 */
  if(spectatingNow() && !camSnap.active){
    camState.yaw += angleDiff(v.facingAngle, camState.yaw) * clamp((dt||0)*8, 0, 1);
  }
  camPos.x = v.x - Math.cos(camState.yaw)*camState.distBehind;
  camPos.y = v.y - Math.sin(camState.yaw)*camState.distBehind;
  camPos.z = v.z + camState.height;
  updateMatchSignals();
}
/* 試合中に毎フレーム出す「自機まわりの合図」。
   【なぜここから呼ぶか】ソロ/ホストは update()、マルチのゲストは network.js のゲスト分岐と
   走るループが分かれており、両方が毎フレーム必ず通る関数はごく限られる。
   updateCamera() はその1つで、かつソロ・ホスト・ゲストで同じ結果になるので、
   ここ1か所から回せば「ホストでしか起きない」演出にならずに済む。 */
function updateMatchSignals(){
  updateFireReadyMark();   // 試合外でも呼ぶ(印を消す役目があるので早期returnしない)
  if(!game.started || game.over) return;
  if(typeof updateZoneShrinkWarning==='function') updateZoneShrinkWarning();
}
/* 【撃てない理由を押す前に見せる】ガッツが今の技の消費に足りない間だけ body.self-noguts を付け、
   FIREボタンをCSS側で沈ませる(印だけ付けて見せ方はCSSに任せるのは body.self-frozen /
   body.self-downed と同じ流儀)。技パネル(=安い技への切替)は沈ませないので、
   「足りない → 下の技に落とす」という逃げ道は残る。
   毎フレームDOMを触らないよう、状態が変わったときだけclassListを操作する。 */
let fireReadyMarkOn = false;
function updateFireReadyMark(){
  const lack = !!(game.started && !game.over && player && player.alive
                  && !spectatingNow() && !entityDowned(player) && playerGutsShort());
  if(lack === fireReadyMarkOn) return;
  fireReadyMarkOn = lack;
  document.body.classList.toggle('self-noguts', lack);
}
/* 「今の技を撃つガッツが足りない」の判定はここ1か所。発射を弾く tryPlayerFire と
   FIREを沈ませる印の両方がこれを見るので、片方だけ条件がずれることがない。 */
function playerGutsShort(){
  if(!player) return false;
  const mv = activeMove(player);
  return !!mv && player.guts < effectiveGutsCost(player, mv);
}
function updateCameraSnap(dt){
  if(!camSnap.active) return;
  camSnap.t += dt;
  const t = clamp(camSnap.t/camSnap.duration, 0, 1);
  const eased = 1 - Math.pow(1-t, 3);
  camState.yaw = lerp(camSnap.fromYaw, camSnap.toYaw, eased);
  if(t>=1) camSnap.active=false;
}
function startCameraSnap(target){
  const desired = angTo(player, target);
  let diff = desired - camState.yaw;
  while(diff > Math.PI) diff -= Math.PI*2;
  while(diff < -Math.PI) diff += Math.PI*2;
  camSnap.active = true;
  camSnap.fromYaw = camState.yaw;
  camSnap.toYaw = camState.yaw + diff;
  camSnap.t = 0;
  camSnap.duration = 0.28;
  pushToast(`${target.name} に視点を合わせた`);
}
function turnCameraByDegrees(deg){
  camSnap.active = true;
  camSnap.fromYaw = camState.yaw;
  camSnap.toYaw = camState.yaw + deg*Math.PI/180;
  camSnap.t = 0;
  camSnap.duration = 0.18;
}

/* =====================================================================
   MAIN UPDATE
===================================================================== */
function activeStateEffects(m){
  const sc = STATE_CHANGES[m.element];
  if(!sc || !(m.stateUntil > matchTime)) return null;
  return sc.effects;
}
function canTriggerState(m){
  return !(m.stateUntil > matchTime) && !(m.stateCooldownUntil > matchTime);
}
const STATE_FLASH_DUR = 1.4; // 状態変化発動の合図(名前を強調して光らせる)の長さ
function activateState(m){
  const sc = STATE_CHANGES[m.element];
  if(!sc) return;
  m.stateUntil = matchTime + sc.duration;
  m.stateCooldownUntil = matchTime + sc.cooldown;
  // 発動の合図はHPゲージのすぐ上の表示を短く光らせるだけにする
  // (以前は大きな文字が浮き上がってバトルの邪魔になっていた)
  m.stateFlashUntil = matchTime + STATE_FLASH_DUR;
  if(m.isPlayer){ pushToast(`${sc.name} 発動！(${sc.duration}秒間)`); playSe('jakiin'); }
  // マルチのゲストはこの関数を実行しないため、発動したこと自体が伝わらない
  // (効果はstateUntilの同期で効くが、演出・トースト・SEが出ず気づけない)。
  // ホストが人間プレイヤーの発動を配信し、ゲスト側で同じ演出を再現する。
  else if(netState.mode==='multi' && netState.isHost && m.netPlayerId){
    window.__aramonPushEvent(netState.roomId, {
      kind:'state', entId:m.id, name:sc.name, duration:sc.duration, ts:Date.now(),
    });
    hostForceFullNext = true; // stateUntilはフル配信でしか載らないので即座に届ける
  }
}
/* 射撃訓練場の毎フレーム処理。安置は縮小させず(updateZoneを呼ばない)、
   倒した的を一定時間後に元の位置へ復活させる。プレイヤーのガッツは自然回復のほか
   ここで少し多めに戻して、技を撃ち続けられるようにしている                     */
const RANGE_TARGET_RESPAWN = 2.5;   // 的が復活するまでの秒数
const RANGE_GUTS_REGEN     = 6;     // 訓練場での追加ガッツ回復(毎秒)
const RANGE_LOOT_RESPAWN   = 1.2;   // 訓練場のアイテムが同じ場所に出直すまでの秒数
function updateTrainingRange(dt){
  for(const e of entities){
    if(!e.isTargetBot) continue;
    if(e.alive) continue;
    if(matchTime - e.deathAt < RANGE_TARGET_RESPAWN) continue;
    e.alive = true;
    e.hp = e.maxHp;
    e.guts = e.maxGuts;
    e.x = e.homeX; e.y = e.homeY; e.z = baseTerrainHeightAt(e.x, e.y);
    e.hitFlash = 0; e.aiTargetPoint = null;
    e.burnUntil = e.slowUntil = e.freezeUntil = e.poisonUntil = 0;
  }
  if(player && player.alive){
    player.guts = Math.min(player.maxGuts, player.guts + RANGE_GUTS_REGEN*dt);
    if(player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + player.maxHp*0.05*dt);
  }
}
// HP割合・ガッツ割合による条件は継続的にチェックする必要があるため、毎フレーム呼び出す
function checkPassiveStateTriggers(m){
  const sc = STATE_CHANGES[m.element];
  if(!sc || !canTriggerState(m)) return;
  if(sc.trigger==='hpBelow' && m.maxHp>0 && (m.hp/m.maxHp) <= sc.triggerValue){
    activateState(m);
  } else if(sc.trigger==='gutsBelow' && m.maxGuts>0 && (m.guts/m.maxGuts) <= sc.triggerValue){
    activateState(m);
  }
}
function effectiveCooldown(m, mv){
  /* 消費ガッツと同じ理由で、**ここでスキンの専用技を解決する。** 呼び出し側が素の技を渡す所と
     解決後を渡す所が混在しており、ソロ(素の2.2秒)とマルチのゲスト(解決後の3.0秒)で
     超番長ボーナスのクールタイムが食い違っていた。HUDのリングも解決後を見ている。 */
  if(typeof skinTier3Move==='function') mv = skinTier3Move(mv, m);
  const el = ELEMENTS[m.element];
  const eff = activeStateEffects(m);
  return mv.cooldown * (el.cooldownMod || 1) * (m.trainCooldownMult || 1) * (m.mastermonCooldownMult || 1) * (eff && eff.cooldownMult || 1);
}
function effectiveGutsCost(m, mv){
  /* スキンの専用技は消費ガッツも上書きする(ゴッドエンペラーの10/20/30)ので、**ここで解決する。**
     解決しないと「撃てるかの判定は素の8、実際に引かれるのは10」になり、
     ガッツが足りないのに撃ててしまう。fireMoveは解決後の技で呼ぶが、二重に当てても同じ値になる。 */
  if(typeof skinTier3Move==='function') mv = skinTier3Move(mv, m);
  const eff = activeStateEffects(m);
  const scaled = mv.gutsCost * (eff && eff.gutsCostMult || 1);
  return Math.max(1, Math.round(scaled) - (m.trainGutsCostReduction || 0));
}
function effectiveProjSpeed(m, mv){
  return mv.projSpeed * (m.trainProjSpeedMult || 1) * multiProjSpeedMult();
}
function effectiveMoveDmg(m, mv){
  const eff = activeStateEffects(m);
  const ssrMult = (typeof ssrTier3DmgMult==='function') ? ssrTier3DmgMult(mv, m) : 1; // SSR装備時tier3威力アップ
  return mv.dmg * (m.trainDmgMult || 1) * (eff && eff.dmgMult || 1) * ssrMult;
}
function tryFire(m){
  if(m.freezeUntil > matchTime) return;
  if(entityDowned(m)) return;   // ダウン中は攻撃不可(チーム戦のみ)
  if(m.fireCooldown>0) return;
  if(!m.attackTargetId) return;
  const t = getEntity(m.attackTargetId);
  if(!t || !t.alive) return;
  if(t.z - m.z > upwardBlockLimit()) return;
  if(!m.isPlayer) m.moveTierSelected = pickBestAffordableTier(m);
  const mv = activeMove(m);
  if(m.guts < effectiveGutsCost(m, mv)) return;
  const d = dist(m,t);
  if(d > mv.range) return;
  fireMove(m, t, mv);
  m.fireCooldown = effectiveCooldown(m, mv);
}
function tryPlayerFire(dt){
  if(!player.alive || player.fireCooldown>0) return;
  if(player.freezeUntil > matchTime) return;
  if(entityDowned(player)) return;   // ダウン中は攻撃不可(発射条件はtryNonHostPlayerFireVisual/processRemoteFireEventsと一致させる)
  if(!(fireBtnHeld || keys['f'])) return;
  const mv = activeMove(player);
  if(playerGutsShort()){ warnGutsShortage(); return; }   // 判定はFIREの沈み(updateFireReadyMark)と共通
  let aimAngle = player.facingAngle;
  if(mv.melee){
    let best=null, bestD=mv.range;
    const fx=Math.cos(player.facingAngle), fy=Math.sin(player.facingAngle);
    for(const e of entities){
      if(e===player || !e.alive) continue;
      if(sameTeam(player, e)) continue;   // チーム戦: 近接技の相手にも味方を選ばない
      if(e.z - player.z > upwardBlockLimit()) continue;
      const d = dist(player,e);
      if(d>mv.range) continue;
      const dirx=(e.x-player.x)/Math.max(d,0.001), diry=(e.y-player.y)/Math.max(d,0.001);
      if(dirx*fx+diry*fy>0.55 && d<bestD){ bestD=d; best=e; }
    }
    fireMove(player, best, mv);
  } else {
    const aim = { x: player.x+Math.cos(player.facingAngle)*1000, y: player.y+Math.sin(player.facingAngle)*1000 };
    fireMove(player, aim, mv);
  }
  player.fireCooldown = effectiveCooldown(player, mv);
}
// Tier3技の弾が残す軌跡の色(スタイル別)
const PROJ_TRAIL_COLORS = {
  tornado:'#d8c49a', holy:'#ffe9a8', shell:'#b57fe0', requiem:'#8b46c9',
};
function updateProjectiles(dt){
  for(let i=projectiles.length-1;i>=0;i--){
    const p = projectiles[i];
    if(p.lobbed){
      p.flightT += dt;
      const t = clamp(p.flightT / p.flightTime, 0, 1);
      p.x = lerp(p.startX, p.landX, t);
      p.y = lerp(p.startY, p.landY, t);
      p.z = lerp(p.startZ, p.landZ||0, t) + Math.sin(t*Math.PI)*p.arcHeight;
      if(t>=1){
        for(const e of entities){
          if(!e.alive || e.id===p.ownerId) continue;
          if(dist(p,e) < e.radius+p.splash) applyDamage(e, p.dmg, getEntity(p.ownerId), { moveAura: p.moveAura, matchAura: p.matchAura, gutsDrain: p.gutsDrain, hitSe: p.hitSe, healRatio: p.healRatio });
        }
        spawnHit(p.x,p.y,p.landZ||0,p.color);
        spawnDeath(p.x,p.y,p.landZ||0,p.color);
        projectiles.splice(i,1);
      }
      continue;
    }
    if(p.delay>0){ p.delay -= dt; continue; }
    const step = Math.hypot(p.vx,p.vy)*dt;
    p.x += p.vx*dt; p.y += p.vy*dt; p.traveled += step;
    // リアルマップ: 上下にも進み、重力で落ちる(発射時の傾きは落下ぶんを見越してある)
    if(p.terrain3d){ p.z += (p.vz||0)*dt; p.vz = (p.vz||0) - (p.grav||0)*dt; }
    else if(p.vz) p.z += p.vz*dt;
    // Tier3技(projStyle付き)の弾は光る軌跡パーティクルを残す
    if(p.projStyle && Math.random() < 0.6){
      const trailColor = PROJ_TRAIL_COLORS[p.projStyle] || p.color;
      addParticle({ type:'spark', x:p.x, y:p.y, z:p.z,
        vx:rand(-24,24), vy:rand(-24,24), life:0.4, maxLife:0.4,
        color:trailColor, size:rand(2.5,4.5) });
    }
    if(p.growWithDistance){
      const growT = clamp(p.traveled/Math.max(p.maxRange,1), 0, 1);
      // 根元(発射直後)から太さを確保しつつ、伸びきった先端は従来と同じ最大2.8倍になるようにする
      p.hitR = p.baseHitR * (1.6 + growT*1.2);
    }
    let hit=false;
    if(p.traveled >= p.maxRange) hit=true;
    if(p.x<0||p.x>WORLD.w||p.y<0||p.y>WORLD.h) hit=true;
    // リアルマップ: 地面(丘)にぶつかったらそこで着弾する
    if(!hit && p.terrain3d){
      const gz = terrainZAt(p.x, p.y);
      if(p.z <= gz){
        p.z = gz;
        spawnHit(p.x,p.y,p.z,p.color);
        if(p.splash>0){
          for(const o of entities){
            if(!o.alive || o.id===p.ownerId) continue;
            if(dist(p,o)<p.splash) applyDamage(o, p.dmg*0.6, getEntity(p.ownerId), { moveAura: p.moveAura, matchAura: p.matchAura, gutsDrain: p.gutsDrain, hitSe: p.hitSe, healRatio: p.healRatio });
          }
        }
        hit = true;
      }
    }
    if(!hit){
      for(const r of rocks){
        // 岩の高さは地面からの高さ。起伏のあるマップでは岩の足元の地面を基準にする
        if(p.z >= (p.terrain3d ? baseTerrainHeightAt(r.x,r.y) : 0) + r.height) continue;
        if(Math.hypot(p.x-r.x,p.y-r.y) < r.radius+p.hitR){
          spawnHit(p.x,p.y,p.z,p.color);
          if(p.splash>0){
            for(const o of entities){
              if(!o.alive || o.id===p.ownerId) continue;
              if(!projHeightHits(p,o)) continue;
              if(dist(p,o)<p.splash) applyDamage(o, p.dmg*0.6, getEntity(p.ownerId), { moveAura: p.moveAura, matchAura: p.matchAura, gutsDrain: p.gutsDrain, hitSe: p.hitSe, healRatio: p.healRatio });
            }
          }
          hit=true; break;
        }
      }
    }
    if(!hit){
      for(const v of volcanoObstacles){
        /* 山は円錐なので、弾の高さによって当たる半径が変わる。v.radius をそのまま
           使うと、山肌のずっと外側・しかも山より高い所を飛ぶ弾まで止まってしまう
           (実機で「技が遮断される」と報告された原因)。 */
        const vTop = getTerrainHeightAt(v.x, v.y);
        if(Math.hypot(p.x-v.x,p.y-v.y) < mountainRadiusAt(v, p.z - vTop)+p.hitR){
          spawnHit(p.x,p.y,p.z,p.color);
          if(p.splash>0){
            for(const o of entities){
              if(!o.alive || o.id===p.ownerId) continue;
              if(!projHeightHits(p,o)) continue;
              if(dist(p,o)<p.splash) applyDamage(o, p.dmg*0.6, getEntity(p.ownerId), { moveAura: p.moveAura, matchAura: p.matchAura, gutsDrain: p.gutsDrain, hitSe: p.hitSe, healRatio: p.healRatio });
            }
          }
          hit=true; break;
        }
      }
    }
    if(!hit){
      for(const e of entities){
        if(!e.alive || e.id===p.ownerId) continue;
        if(projTeamBlocked(p, e)) continue;   // チーム戦: 味方の体は素通り(味方が壁にならない)
        if(!projHeightHits(p,e)) continue;
        // ③ ラグ補正弾(ゲスト発射)は、対象を「一定遅延だけ巻き戻した位置」で当たり判定する。
        //   ダメージ自体は本物のエンティティeに与える。通常弾はp.lagDelaySeq未設定でそのまま。
        const tp = (p.lagDelaySeq && typeof entityRewoundPos==='function' && entityRewoundPos(e.id, p.lagDelaySeq)) || e;
        let hitNow;
        if(p.hitW>p.hitR){
          const rx=tp.x-p.x, ry=tp.y-p.y;
          hitNow = Math.abs(rx) < e.radius+p.hitW && Math.abs(ry) < e.radius+p.hitR;
        } else {
          hitNow = Math.hypot(tp.x-p.x, tp.y-p.y) < e.radius+p.hitR;
        }
        if(hitNow){
          // blast付き(ビッグバン等)も球体の直撃ダメージを与える。着弾後の爆風ダメージは別途spawnGroundBlastで判定
          const dmgMult = closeRangeDmgMult(p.closeBonusMax, p.traveled, p.maxRange); // 命中距離が短いほど威力アップ(デュラハン)
          applyDamage(e, p.dmg*dmgMult, getEntity(p.ownerId), { moveAura: p.moveAura, matchAura: p.matchAura, gutsDrain: p.gutsDrain, hitSe: p.hitSe, healRatio: p.healRatio });
          // ワームtier3など: 相手に命中したら撃った本人に移動速度バフ
          if(p.selfSpeedBuffOnHit) applySelfSpeedBuffOnHit(p.ownerId);
          if(p.splash>0){
            for(const o of entities){
              if(o===e || !o.alive || o.id===p.ownerId) continue;
              if(!projHeightHits(p,o)) continue;
              if(dist(p,o)<p.splash) applyDamage(o, p.dmg*0.6, getEntity(p.ownerId), { moveAura: p.moveAura, matchAura: p.matchAura, gutsDrain: p.gutsDrain, hitSe: p.hitSe, healRatio: p.healRatio });
            }
          }
          spawnHit(tp.x,tp.y,e.z,p.color);
          hit=true; break;
        }
      }
    }
    if(hit && p.stopsSelfMove){
      // 竜巻(最終奥義)が敵や地面・障害物・射程切れで消えた地点で、自分の前進も止める
      const owner = getEntity(p.ownerId);
      if(owner) owner.moveWithMoveUntil = matchTime;
    }
    if(hit && p.blast) spawnGroundBlast(p.x, p.y, p.blast, p.ownerId, p.moveAura, p.auraTint, p.auraAccent); // ピクシー「ビッグバン」: 着弾/最大射程到達で地面にドームAoEを発生
    if(hit) projectiles.splice(i,1);
  }
}
// 着弾/最大射程到達点に、円形に広がるドーム状のダメージAoEを発生させる(ビッグバン等)
function spawnGroundBlast(x, y, blast, ownerId, moveAura, auraTint, auraAccent){
  const radius = blast.radius||220;
  const expandTime = blast.expandTime||0.45;
  const telegraphTime = blast.telegraphTime!=null ? blast.telegraphTime : 0.05;
  const ae = {
    id:nextId++, ownerId, kind:'circle', x, y, z:0, angle:0,
    dmg: blast.dmg||0, color: blast.color||'#000000', range: radius, width:0,
    fanAngleDeg:0, beamCount:0, beamSpreadDeg:0,
    fillSpeed: radius/expandTime, telegraphTime,
    spawnAt: matchTime, hitIds:new Set(), resolved:false, style: blast.style||null, moveAura, auraTint: auraTint||null, auraAccent: auraAccent||null,
  };
  ae.life = telegraphTime + expandTime + 0.25;
  areaEffects.push(ae);
  const owner = getEntity(ownerId);
  if(owner && owner.isPlayer){
    playSe(blast.se || 'fire', { kind:'aoe', dur: ae.life });
  }
}
// アイテム取得メッセージ。自分が拾ったならその場で表示する。
// マルチのホストが「ゲストが拾った」ぶんを処理したときは、その文言を控えておき
// pickupイベントに載せて本人へ届ける(ゲストは取得判定自体を行わないため、
// これをしないとゲスト側に効果のメッセージが一切出ない)。
let pendingLootToast = null;
let pendingLootCards = null;   // ゲストが拾ったトレーニングの候補3枚(取得イベントに載せる)
/* 修行チケットで解放された技のtier。authStateのフル配信でも届くが、届くのは早くても
   次の配信(最大0.4秒後)で、フル配信が何かの理由で落ちると**その試合ずっと**
   ゲストの技が解放されないままになる。取得イベントに載せて即座に確定させる。 */
let pendingLootTier = null;
/* デス円盤石の山分けで**拾っていないのに強くなった味方**(ゲスト)へ届けるぶん。
   ホストのループの中でしか山分けは起きないので、届けないとゲスト側は
   数値だけ黙って増える(何が起きたのか分からない)。 */
let pendingLootMates = null;   // 山分けを受けた味方のnetPlayerId配列
let pendingLootMateMsg = null; // その味方に出す文言

/* ===== トレーニングカードの配布(抽選はホスト=ソロは自分だけが行う) =====
   ・自分         → 画面にカードを出す(選ぶまで / TRAIN_CARD_PICK_SEC 秒で自動)
   ・bot          → その場でランダムに1枚。**選択UIは出さない**(拾得のループに分岐を足さない)
   ・ゲスト(人間) → 候補を配って返事を待つ。来なければホストが決める */
const trainOffers = [];   // ホストがゲストの返事を待っている一覧 {id, keys, deadline}
function offerTrainCards(e, itemType){
  const keys = pickTrainCardKeys(itemType);
  if(e.isPlayer){ if(typeof showTrainCards==='function') showTrainCards(keys); return keys; }
  if(netState.mode==='multi' && netState.isHost && e.netPlayerId){
    trainOffers.push({ id:e.id, keys, deadline: matchTime + TRAIN_CARD_PICK_SEC });
    return keys;
  }
  applyTrainCardToEntity(e, keys[Math.floor(Math.random()*keys.length)]);
  return keys;
}
// 返事が来なかったぶん・倒れたぶんをホストが片付ける。update()から毎フレーム呼ぶ
function updateTrainOffers(){
  for(let i=trainOffers.length-1;i>=0;i--){
    const o = trainOffers[i];
    const ent = getEntity(o.id);
    if(ent && ent.alive && matchTime < o.deadline) continue;
    trainOffers.splice(i,1);
    if(ent && ent.alive){
      applyTrainCardToEntity(ent, o.keys[Math.floor(Math.random()*o.keys.length)]);
      hostForceFullNext = true;
    }
  }
}
// ゲストから届いた選択を反映する(ホスト専用)。候補に無いものは1枚目に丸める
function resolveTrainOfferFor(ent, cardKey){
  const idx = trainOffers.findIndex(o=>o.id===ent.id);
  if(idx < 0) return false;
  const o = trainOffers[idx];
  trainOffers.splice(idx,1);
  applyTrainCardToEntity(ent, (o.keys.indexOf(cardKey) >= 0) ? cardKey : o.keys[0]);
  hostForceFullNext = true;
  return true;
}
function resetTrainOffers(){ trainOffers.length = 0; }
function lootToast(e, msg){
  if(e.isPlayer) pushToast(msg);
  else if(netState.mode==='multi' && netState.isHost && e.netPlayerId) pendingLootToast = msg;
}
function updateLootPickups(){
  for(let i=lootItems.length-1;i>=0;i--){
    const it = lootItems[i];
    if(it.respawnAt > matchTime) continue; // 射撃訓練場: 取り直せるようになるまで消えている
    if(dist(it, zoneState.center) > zoneState.radius){
      lootItems.splice(i,1);
      continue;
    }
    let consumed = false, consumedBy = null, consumedKind = null;
    pendingLootToast = null; pendingLootCards = null; pendingLootTier = null;
    pendingLootMates = null; pendingLootMateMsg = null;
    for(const e of entities){
      if(!e.alive) continue;
      if(e.isRaidBoss) continue;   // レイドのボスは拾わない(巨体なので通るだけで全部さらってしまう)
      if(entityDowned(e)) continue; // ダウン中(チーム戦)はアイテムを拾えない
      if(dist(e,it) < e.radius+14){
        if(it.kind==='heal'){
          const hi = HEAL_ITEMS[it.type];
          if(e.hp >= e.maxHp){
            const boost = hi.maxBoost;
            e.maxHp += boost;
            e.hp += boost;
            spawnDmgText(e.x, e.y, e.z, '上限+'+boost, '#ffe06b');
            lootToast(e, `${hi.name}：HP上限+${boost}`);
            consumed = true;
          } else {
            // 回復量は最大HPの割合(healItemAmount 1か所で出す)
            const healed = Math.min(healItemAmount(hi, e), e.maxHp-e.hp);
            e.hp += healed;
            spawnDmgText(e.x, e.y, e.z, '+'+Math.round(healed), '#7fffa0');
            lootToast(e, `${hi.name} で HP+${Math.round(healed)}`);
            consumed = true;
          }
        } else if(it.kind==='guts'){
          e.maxGuts += GUTS_ITEM.maxBoost;
          const restored = Math.min(GUTS_ITEM.restore, e.maxGuts-e.guts);
          e.guts = Math.min(e.maxGuts, e.guts + GUTS_ITEM.restore);
          spawnDmgText(e.x, e.y, e.z, '+'+Math.round(restored), '#ffd9e3');
          lootToast(e, `${GUTS_ITEM.name} で ガッツ上限+${GUTS_ITEM.maxBoost}・ガッツ+${Math.round(restored)}`);
          consumed = true;
        } else if(it.kind==='ticket'){
          if(e.moveTierUnlocked >= 3){
            const roll = Math.random();
            if(roll < 1/3){
              e.trainCooldownMult *= 0.93;
              spawnDmgText(e.x, e.y, e.z, '連射UP', '#9fd1ff');
              lootToast(e, `${TICKET_ITEM.name}：技の連射速度が上がった！`);
            } else if(roll < 2/3){
              e.trainGutsCostReduction += 1;
              spawnDmgText(e.x, e.y, e.z, '消費ガッツDOWN', '#9fd1ff');
              lootToast(e, `${TICKET_ITEM.name}：全技の消費ガッツが下がった！`);
            } else {
              e.trainProjSpeedMult *= 1.10;
              spawnDmgText(e.x, e.y, e.z, '弾速UP', '#9fd1ff');
              lootToast(e, `${TICKET_ITEM.name}：技の弾速が上がった！`);
            }
            consumed = true;
          } else {
            e.moveTierUnlocked = Math.min(3, e.moveTierUnlocked+1);
            e.moveTierSelected = e.moveTierUnlocked;
            // ゲストが拾ったぶんは解放後のtierも取得イベントに載せる(本人がその場で持ち替えられる)
            if(!e.isPlayer && netState.mode==='multi' && netState.isHost && e.netPlayerId) pendingLootTier = e.moveTierUnlocked;
            const newMove = SIGNATURE_MOVES[e.element][e.moveTierUnlocked-1];
            lootToast(e, `${TICKET_ITEM.name}！「${newMove.name}」が使えるようになった`);
            consumed = true;
          }
        } else if(it.kind==='training'){
          const ti = TRAINING_ITEMS[it.type];
          // トレーニングを3つ出して1つ選ばせる(効果の正は TRAINING_MENU 1つ)
          const cards = offerTrainCards(e, it.type);
          // ゲスト(マルチ)が拾ったぶんは、候補を取得イベントに載せて本人へ届ける
          // (抽選はホストのループの中でしか起きないため)
          if(!e.isPlayer && netState.mode==='multi' && netState.isHost && e.netPlayerId) pendingLootCards = cards;
          spawnDmgText(e.x, e.y, e.z, ti.emoji+' トレーニング', ti.accent);
          consumed = true;
        } else if(it.kind==='deathDisc'){
          /* デス円盤石: 中身のトレーニング項目を**カード選択なしで即適用**。
             効かせ方は既存カードと同じ1本道(applyTrainCardToEntity)なので、
             適正倍率・丸めがそのまま効き、受け継いだ項目は拾った側の履歴にも積まれる(連鎖)。

             【チーム戦は分け合う】倒した相手の力は拾った1体の総取りにせず、
             **生きているチーム全員へ等分**する(3人そろっていれば3等分・発注者決定 2026-08-14)。
             倒れた仲間の取り分は作らない(分けた力が消えると拾い得が無くなるため)。
             ダウン中の味方は生存扱いなので受け取る=拾って助け起こす動きに意味が出る。 */
          const takers = (isTeamMatch() && e.teamId!=null)
            ? teamMembers(e.teamId).filter(m=> m.alive)
            : [e];
          if(!takers.includes(e)) takers.push(e);   // 念のため拾った本人は必ず受け取る
          const share = 1 / takers.length;
          const counts = new Map();
          for(const k of (it.keys||[])){
            const t = trainCardMenu(k);
            if(!t) continue;
            let applied = false;
            for(const m of takers){ if(applyTrainCardToEntity(m, k, share)) applied = true; }
            if(applied) counts.set(t.label, (counts.get(t.label)||0) + 1);
          }
          if(counts.size){
            const parts = Array.from(counts, ([label,n])=> n>1 ? `${label}×${n}` : label);
            const owner = it.owner || '名も無きモンスター';
            const shareNote = takers.length > 1 ? `／${takers.length}人で山分け` : '';
            spawnDmgText(e.x, e.y, e.z, '💠 継承', DEATH_DISC_ACCENT);
            lootToast(e, `${owner} の力を受け継いだ！（${parts.join('・')}${shareNote}）`);
            if(takers.length > 1){
              // 山分けは自分が拾っていなくても効くので、味方一人ひとりの頭上にも印を出す
              const mateMsg = `味方が ${owner} の力を山分けしてくれた！（${parts.join('・')}）`;
              const mateIds = [];
              for(const m of takers){
                if(m===e) continue;
                spawnDmgText(m.x, m.y, m.z, '💠 継承', DEATH_DISC_ACCENT);
                if(m.isPlayer) pushToast(mateMsg);
                else if(netState.mode==='multi' && netState.isHost && m.netPlayerId) mateIds.push(m.netPlayerId);
              }
              if(mateIds.length){ pendingLootMates = mateIds; pendingLootMateMsg = mateMsg; }
            }
          }
          consumed = true;
        }
      }
      if(consumed){
        // SE: 自分のアイテム取得のみ。トレーニングアイテムはトレ実行と同じ「ポワポワ」、
        // デス円盤石は継承らしく光の柱の「チュピーン」(既存SEの流用)
        if(e.isPlayer) playSe(it.kind==='deathDisc' ? 'chupiin' : (it.kind==='training' ? 'train' : 'pickup'));
        consumedBy = e.netPlayerId || null; // 誰が拾ったか(ゲストのSE用)
        consumedKind = it.kind;
        break;
      }
    }
    if(consumed){
      // マルチプレイのホストはここでしか消費判定をしないため、ゲスト側の見た目からも
      // このアイテムを消すよう明示的に配信する(効果はauthStateのhp/guts等で既に伝わるが、
      // アイテム自体の見た目はホスト側のlootItems配列にしか無いため個別に届ける必要がある)
      if(netState.mode==='multi' && netState.isHost){
        // 拾った人間プレイヤーのIDと種類も送り、ゲスト側で自分の拾得ならSEを鳴らせるようにする
        window.__aramonPushLootEvent(netState.roomId, {
          evtType:'pickup', id: it.id, by: consumedBy||null, kind: consumedKind||null,
          msg: pendingLootToast||null, // 拾った本人(ゲスト)に出す効果メッセージ
          cards: pendingLootCards||null, // トレーニングの候補3枚(本人にカードを出させる)
          tier: pendingLootTier||null,   // 修行チケットで解放された技のtier(本人が即座に持ち替えられるように)
          mates: pendingLootMates||null, // デス円盤石の山分けを受けた味方(拾っていないので by では届かない)
          mateMsg: pendingLootMateMsg||null,
        });
        // 強化値(maxHp/train係数)は普段8回に1回のフル配信でしか送っていないため、
        // そのままだと効果の反映が最大0.4秒遅れる。取得直後は次の配信を強制的にフルにする
        hostForceFullNext = true;
      }
      // 射撃訓練場のアイテムは無くならない。少し待つと同じ場所にまた出る
      if(it.rangeRespawn) it.respawnAt = matchTime + RANGE_LOOT_RESPAWN;
      else lootItems.splice(i,1);
    }
  }
}
/* =====================================================================
   召喚演出(試合開始カウントダウン)
   ・視点操作のみ許可(移動・攻撃はupdate()を呼ばないことで自然に封じる)
   ・matchTimeを進めないので状態変化クールタイム/ゾーン/試合時間は演出後に開始
===================================================================== */
// 演出タイムライン(elapsed秒):
//  0.0-0.7  円盤石が現れる
//  0.45-1.25 天から光の柱が円盤石へ落ちる(SE: チュピーン)
//  1.25     着地。光が円盤石の周りを満たしモンスターは光に隠れる
//  1.6-4.4  光が周りから中心へ収束して細くなり、モンスターが現れる(SE: シュワァー)
const SUMMON_CHUPIIN_AT = 0.45;
const SUMMON_IMPACT_AT  = 1.25;
const SUMMON_SHUWAA_AT   = 1.6;
function beginSummonIntro(){
  introState.active = true;
  introState.timer = SUMMON_INTRO_DURATION;
  introState.duration = SUMMON_INTRO_DURATION;
  introState.chupiinPlayed = false;
  introState.shuwaaPlayed = false;
  introState.impactDone = false;
  camSnap.active = false;
  updateCamera();
  updateHUD();
  bgmSetTrack(null);      // 演出中はBGMを止めて神々しさを際立たせる
}
function updateSummonIntro(dt){
  introState.timer -= dt;
  const elapsed = introState.duration - introState.timer;
  if(!introState.chupiinPlayed && elapsed >= SUMMON_CHUPIIN_AT){
    introState.chupiinPlayed = true;
    playSe('chupiin');    // 光の柱が落ちる「チュピーン」
  }
  if(!introState.impactDone && elapsed >= SUMMON_IMPACT_AT){
    introState.impactDone = true;
    summonImpactBurst();  // 着地の光の弾け
  }
  if(!introState.shuwaaPlayed && elapsed >= SUMMON_SHUWAA_AT){
    introState.shuwaaPlayed = true;
    // 光が細くなっていく「シュワァー」。スキン専用の召喚SEがあればそれに差し替える
    playSe(skinSummonSeName(player) || 'shuwaa');
  }
  updateCameraSnap(dt);
  updateCamera(dt);
  // update()を通さないので、演出用のきらめき粒子だけここで進める
  for(let i=particles.length-1;i>=0;i--){
    const p = particles[i];
    p.x += p.vx*dt; p.y += p.vy*dt; p.z = (p.z||0) + (p.vz||0)*dt;
    if(p.vz!=null) p.vz -= 40*dt; // ゆるやかに落ちる
    p.life -= dt;
    if(p.life<=0) particles.splice(i,1);
  }
  // 収束中は円盤石の縁で柔らかくきらめく
  if(player && player.alive && elapsed > SUMMON_IMPACT_AT && Math.random() < 0.5){
    const a = Math.random()*Math.PI*2, rr = player.radius*(1.4+Math.random()*1.0);
    addParticle({ type:'spark', x:player.x+Math.cos(a)*rr, y:player.y+Math.sin(a)*rr, z:2,
      vx:0, vy:0, vz:40+Math.random()*70, life:0.6+Math.random()*0.4, maxLife:1.0,
      color:`hsl(${Math.floor(Math.random()*360)},90%,70%)`, size:2+Math.random()*2.5 });
  }
  if(introState.timer <= 0) endSummonIntro();
}
// 光の柱が着地した瞬間の四方への弾け
function summonImpactBurst(){
  if(!player) return;
  for(let i=0;i<22;i++){
    const a = Math.random()*Math.PI*2, sp = 60+Math.random()*180;
    addParticle({ type:'spark', x:player.x, y:player.y, z:4+Math.random()*10,
      vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, vz:90+Math.random()*160,
      life:0.5+Math.random()*0.4, maxLife:0.9,
      color:`hsl(${Math.floor(Math.random()*360)},92%,72%)`, size:2.5+Math.random()*3 });
  }
}
function endSummonIntro(){
  introState.active = false;
  introState.timer = 0;
  pushToast(netState.mode==='multi' ? 'バトル開始！（マルチプレイ）' : 'バトル開始！');
  playSe('jakiin');       // 従来の試合開始SE
  bgmSetTrack('battle');
}

function update(dt){
  // 決着演出(勝敗の3秒アニメーション)の間は試合を止める。
  // 止めないと敵が動き続け、演出の裏で順位や撃破数が変わってしまう。
  // 時刻で判定しているので、演出が何かの理由で終わらなくても3秒で自動的に再開する。
  if(typeof matchFinishFreezeActive==='function' && matchFinishFreezeActive()) return;
  matchTime += dt;
  if(game.tipTimer>0) game.tipTimer -= dt;
  if(game.trainingRange) updateTrainingRange(dt); // 安置は動かさず、的の復活だけ面倒を見る
  else if(game.raid) updateRaidZone(dt);          // レイドは制限時間に合わせて線形に縮める
  else if(game.arena) updateArenaZone(dt);        // アリーナは中央固定の小さい安置を1段階だけ縮める
  else updateZone(dt);
  if(game.raid) updateRaid(dt);                   // ボスの予告→発動と、決着の判定
  updateArena(dt);                                // アリーナ: 時間切れの決着(アリーナ以外では何もしない)
  updateTeamStates(dt);                           // チーム戦: 出血タイマーと蘇生の進行(個人戦では何もしない)
  updateCameraSnap(dt);
  computePlayerInput();

  for(const e of entities){ if(e.alive && !e.isPlayer && !e.isRemoteHuman) updateBotAI(e, dt); }
  // needsDepenetrate を立ててから動かす。tryMoveAxis を通った者は自分で下ろすので、
  // 立ったまま残るのは「今フレーム一度も動こうとしなかった者」だけになる
  for(const e of entities){ if(e.alive){ e.needsDepenetrate = true; resolveMovement(e, dt); } }
  separateEntities();
  depenetrateStuckEntities();   // 押し合い・非移動で障害物へ埋まった者を必ず外へ出す
  updateCamera(dt);

  for(const e of entities){
    if(!e.alive) continue;
    if(e.fireCooldown>0) e.fireCooldown -= dt;
    if(e.dashCooldown>0) e.dashCooldown -= dt;
    if(e.hitFlash>0) e.hitFlash -= dt;
    const stateEffForGuts = activeStateEffects(e);
    // レイド中の味方だけガッツ回復を速める(ボスに技を撃ち続けられるように)
    const raidGutsMult = (game.raid && !e.isRaidBoss) ? RAID_ALLY_GUTS_REGEN_MULT : 1;
    if(e.guts<e.maxGuts) e.guts = Math.min(e.maxGuts, e.guts + 2*dt*raidGutsMult*(ELEMENTS[e.element].gutsRegenMod||1)*(e.mastermonGutsRegenMult||1)*(stateEffForGuts && stateEffForGuts.gutsRegenMult || 1));
    checkPassiveStateTriggers(e);
    if(e.poisonUntil > matchTime && matchTime >= e.poisonTickAt){
      e.poisonTickAt = matchTime + 1;
      const dmg = Math.min(5, e.hp - 1);
      if(dmg > 0){
        e.hp -= dmg;
        e.hitFlash = 0.12;
        spawnDmgText(e.x, e.y, e.z, Math.round(dmg), '#c07bf0');
        const poisoner = entities.find(o=>o.id===e.poisonSourceId);
        if(poisoner && poisoner.alive && poisoner.id!==e.id){
          poisoner.damageDealt += dmg;
        }
      }
    }
    if(e.isPlayer) tryPlayerFire(dt);
    else if(!e.isRemoteHuman) tryFire(e);
  }
  updateProjectiles(dt);
  updateLootPickups();
  updateTrainOffers();   // 返事の来ないトレーニングカードをホストが決める

  const dps = currentDps();
  if(dps>0){
    for(const e of entities){
      if(!e.alive) continue;
      // ダウン直後の無敵中は安置外ダメージも通さない(「2秒間無敵」を環境ダメージにも揃える)
      if(entityDowned(e) && e.downedInvulnUntil > matchTime) continue;
      if(dist(e, zoneState.center) > zoneState.radius){
        e.hp -= dps*dt;
        if(Math.random()<0.08) spawnDmgText(e.x, e.y, e.z, Math.round(dps), '#ff9c3d');
        if(e.hp<=0) killEntity(e, null);
      }
    }
  }

  if(lavaZones.length>0){
    for(const e of entities){
      if(!e.alive) continue;
      // ダウン直後の無敵中は溶岩ダメージも通さない(上と同じ理由)
      if(entityDowned(e) && e.downedInvulnUntil > matchTime) continue;
      let inLava = false;
      for(const lz of lavaZones){
        if(Math.hypot(e.x-lz.x, e.y-lz.y) < lz.radius + e.radius*0.4){ inLava = true; break; }
      }
      if(inLava){
        const lavaDps = currentMap.lavaDps || 20;
        e.hp -= lavaDps*dt;
        if(Math.random()<0.12) spawnDmgText(e.x, e.y, e.z, Math.round(lavaDps), '#ff5a1f');
        if(e.hp<=0) killEntity(e, null);
      }
    }
  }

  for(let i=particles.length-1;i>=0;i--){
    const p = particles[i];
    p.x += p.vx*dt; p.y += p.vy*dt;
    if(p.type==='text') p.vy += 60*dt;
    p.life -= dt;
    if(p.life<=0) particles.splice(i,1);
  }

  updateAreaEffects(dt);
  updatePendingAoeCasts();

  updateHUD();
}
function updatePendingAoeCasts(){
  for(let i=pendingAoeCasts.length-1;i>=0;i--){
    const pc = pendingAoeCasts[i];
    if(matchTime < pc.at) continue;
    pendingAoeCasts.splice(i,1);
    const attacker = getEntity(pc.attackerId);
    if(!attacker || !attacker.alive) continue; // 発射前に本体が倒れた場合は不発
    areaEffects.push(pc.build(pc.aimAngle));
  }
}
/* 命中した瞬間に撃った本人の移動速度へバフを掛ける(ワームtier3「シェルアタック」・
   電王ライナー「俺、参上」共通)。弾(projectiles)と範囲技(areaEffects)の両方の
   命中処理から呼ぶので、数値(WARM_SHELL_SPEED_BUFF_MULT/DURATION)はここ1か所だけで持つ。 */
function applySelfSpeedBuffOnHit(ownerId){
  const owner = getEntity(ownerId);
  if(owner && owner.alive){
    owner.speedBuffMult = WARM_SHELL_SPEED_BUFF_MULT;
    owner.speedBuffUntil = matchTime + WARM_SHELL_SPEED_BUFF_DURATION;
    if(owner.isPlayer) pushToast(`命中${'！'}移動速度${WARM_SHELL_SPEED_BUFF_MULT}倍(${WARM_SHELL_SPEED_BUFF_DURATION}秒)`);
  }
}
function updateAreaEffects(dt){
  for(let i=areaEffects.length-1;i>=0;i--){
    const ae = areaEffects[i];
    const elapsed = matchTime - ae.spawnAt;
    if(elapsed > ae.life){ areaEffects.splice(i,1); continue; }
    if(ae.resolved || !ae.hitIds) continue; // ゲスト側の同期エントリはダメージ計算しない(見た目のみ)
    if(elapsed <= ae.telegraphTime) continue; // まだ点線予告のみ

    const fillDist = (elapsed - ae.telegraphTime) * ae.fillSpeed;
    const origin = { x:ae.x, y:ae.y, radius:0, id:ae.ownerId };
    const owner = getEntity(ae.ownerId);

    if(ae.kind==='gate'){
      /* 羅生門: 最遠(ae.range)から門(ae.doorDist)へ炎が逆走する。触れた敵はダメージ(ae.dmg)を
         受けたうえで、門の前まで引き寄せられる(resolveMovementのpulledUntilが実際の移動を担当)。
         炎が門に届いた瞬間(frontDistが doorDist まで縮んだ瞬間)に1回だけ endBlast で爆発する。 */
      const doorDist = ae.doorDist||0;
      const frontDist = clamp(ae.range - fillDist, doorDist, ae.range);
      const doorX = ae.x + Math.cos(ae.angle)*doorDist, doorY = ae.y + Math.sin(ae.angle)*doorDist;
      for(const ent of entities){
        if(!ent.alive || ent.id===ae.ownerId || ent.isRaidBoss) continue; // 巨体は吸い込まない
        if(owner && sameTeam(owner, ent)) continue; // チーム戦: 味方は引き寄せもダメージも受けない
        if(ae.hitIds.has(ent.id)) continue;
        // 通路全体(0〜range)には入っていて、まだ炎が来ていない範囲(0〜frontDist)には
        // 入っていない = ちょうど炎が通過した、を hitTestRect の2回判定で表す
        const inCorridor = hitTestRect(origin, ent, ae.angle, ae.range, ae.width/2);
        const notYetReached = hitTestRect(origin, ent, ae.angle, frontDist, ae.width/2);
        if(inCorridor && !notYetReached){
          ae.hitIds.add(ent.id);
          // 発注者依頼(2026-08-12): 引き寄せだけでなく、炎に触れた瞬間にもダメージを入れる
          applyDamage(ent, ae.dmg, owner, { moveAura: ae.moveAura, gutsDrain: ae.gutsDrain||0, hitSe: ae.hitSe, healRatio: ae.healRatio||0,
                                            lifestealMult: ae.lifestealMult||1 });
          ent.pulledUntil = ae.gateArriveAt;
          ent.pulledX = doorX; ent.pulledY = doorY;
          ent.pulledSpeed = ae.fillSpeed; // 炎と同じ速さで引き寄せる(門に炎が届くのとちょうど同時に到着する)
          spawnHit(ent.x, ent.y, ent.z, ae.color);
        }
      }
      if(!ae.resolved && frontDist <= doorDist + 0.5){
        ae.resolved = true;
        if(ae.endBlast) spawnGroundBlast(doorX, doorY, ae.endBlast, ae.ownerId, ae.moveAura, ae.auraTint, ae.auraAccent);
      }
      continue;
    }
    if(ae.kind==='beams'){
      const count = ae.beamCount||3;
      const spread = (ae.beamSpreadDeg||40)*Math.PI/180;
      let allDone = true;
      for(let b=0;b<count;b++){
        const beamMax = ae.beamRanges[b];
        const curReach = Math.min(beamMax, fillDist);
        if(curReach < beamMax) allDone = false;
        const beamAngle = ae.angle + (count>1 ? (b/(count-1)-0.5)*spread : 0);
        for(const ent of entities){
          if(!ent.alive || ent.id===ae.ownerId) continue;
          if(owner && sameTeam(owner, ent)) continue; // チーム戦: 味方にはヒット演出も出さない
          const key = ent.id+'_b'+b;
          if(ae.hitIds.has(key)) continue;
          if(hitTestRect(origin, ent, beamAngle, curReach, ae.width/2)){
            ae.hitIds.add(key);
            applyDamage(ent, ae.dmg, owner, { moveAura: ae.moveAura, gutsDrain: ae.gutsDrain||0, hitSe: ae.hitSe, healRatio: ae.healRatio||0,
                                              lifestealMult: ae.lifestealMult||1 });
            spawnHit(ent.x, ent.y, ent.z, ae.color);
          }
        }
      }
      if(allDone) ae.resolved = true;
    } else {
      const curReach = Math.min(ae.range, fillDist);
      for(const ent of entities){
        if(!ent.alive || ent.id===ae.ownerId) continue;
        if(owner && sameTeam(owner, ent)) continue; // チーム戦: 味方にはヒット演出も出さない
        if(ae.hitIds.has(ent.id)) continue;
        let hit = false;
        if(ae.kind==='fan' || ae.kind==='fanZigzag'){
          hit = hitTestFan(origin, ent, ae.angle, curReach, (ae.fanAngleDeg||45)*Math.PI/360);
        } else if(ae.kind==='rect' || ae.kind==='zigzag'){
          hit = hitTestRect(origin, ent, ae.angle, curReach, ae.width/2);
        } else if(ae.kind==='circle'){
          hit = dist(ae, ent) < curReach + ent.radius;
        }
        if(hit){
          ae.hitIds.add(ent.id);
          const dmgMult = closeRangeDmgMult(ae.closeBonusMax, dist(origin, ent), ae.range); // 命中距離が短いほど威力アップ(デュラハン)
          applyDamage(ent, ae.dmg*dmgMult, owner, { moveAura: ae.moveAura, gutsDrain: ae.gutsDrain||0, hitSe: ae.hitSe, healRatio: ae.healRatio||0,
                                            lifestealMult: ae.lifestealMult||1 });
          spawnHit(ent.x, ent.y, ent.z, ae.color);
          // ワームtier3/電王ライナーtier3: 範囲技が命中した瞬間にも同じ移動速度バフを掛ける
          if(ae.selfSpeedBuffOnHit){
            applySelfSpeedBuffOnHit(ae.ownerId);
            ae.selfSpeedBuffFxAt = matchTime; // 演出(fx_moves.js)が1回だけ足の筋を出すための印
          }
        }
      }
      if(curReach >= ae.range){
        // 届いた先端で仕上げの爆風ドームを出す(1回だけ。まだ未resolvedのこのフレームで発火)
        if(!ae.resolved && ae.endBlast) spawnAoeEndBlast(ae);
        ae.resolved = true;
      }
    }
  }
}
// 扇/帯の範囲技が届いた先端に、半分ずつ重ねた3つの爆風ドームを横並びで出す(インフェルノ等)。
// ae.angleに直交する方向へ並べる。ae.rangeを使うので、遮蔽物で途中で途切れても
// その短くなった位置で爆発する(raycastObstacleDistanceで既に短くなっている)。
function spawnAoeEndBlast(ae){
  const b = ae.endBlast;
  const count = Math.max(1, b.count||3);
  const radius = b.radius||130;
  const ex = ae.x + Math.cos(ae.angle)*ae.range, ey = ae.y + Math.sin(ae.angle)*ae.range;
  const px = -Math.sin(ae.angle), py = Math.cos(ae.angle); // 先端で横方向(並べる軸)
  for(let i=0;i<count;i++){
    const off = (i - (count-1)/2) * radius; // 中心間の距離=半径ぶん→隣とちょうど半分重なる
    spawnGroundBlast(ex+px*off, ey+py*off, {
      radius, dmg:b.dmg||0, color:b.color||ae.color, expandTime:b.expandTime||0.35, se:b.se,
    }, ae.ownerId, ae.moveAura, ae.auraTint, ae.auraAccent);
  }
}

/* =====================================================================
   PROJECTION (lightweight 3rd-person camera)
===================================================================== */
