/* tier3技の強さを一覧にする開発用ツール(ゲームには読み込まない)。
   「どの技が強い/弱いか」を勘ではなく同じものさしで並べるためのもの。

   使い方: node tools/move_balance.mjs [--tier 3]

   出すもの:
     ・紙上の合計威力(全弾・全爆風が当たった場合)
     ・**命中率を織り込んだ期待威力**と、クールタイムで割った期待DPS
     ・特性の付加効果をダメージへ換算して足した「特性込DPS」

   ★ここの命中率は**実測ではなく目安**。実際の手応えは実機で発注者が見る。
     数字の役目は「7倍も差がある」「この技だけ紙と実態が食い違う」を見つけること。

   前提(単体・中距離・動く相手):
     弾   … 弾速1200以上=0.85 / 700以上=0.70 / それ未満=0.55。当たり判定の大きさで加算
     範囲 … 実効幅(キュービは特性で1.5倍)が 300以上=0.75 / 200以上=0.68 / 140以上=0.60 / 未満=0.52
     吸込 … 0.75(引き寄せるので炎に触れたら門の爆風は確定)
     連射 … 横並び(burstSideStep)は間隔で1.15〜2.2本 / 拡散は burst×0.55 / 4球のガリは2.2球
     爆風 … 直撃が当たれば必ず入る。外しても半径330以上=0.5 / 230以上=0.35 / それ未満=0.2 で入る  */
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ctx = {
  window:{}, document:{ getElementById:()=>null, querySelectorAll:()=>[], createElement:()=>({getContext:()=>({})}), addEventListener:()=>{} },
  localStorage:{ getItem:()=>null, setItem:()=>{}, removeItem:()=>{} },
  navigator:{ userAgent:'node' }, location:{ search:'' }, console,
  Image:function(){}, performance:{ now:()=>0 }, setTimeout, clearTimeout, requestAnimationFrame:()=>0,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT,'data.js'),'utf8'), ctx);
const SIG = vm.runInContext('SIGNATURE_MOVES', ctx);
const ELEM = vm.runInContext('ELEMENTS', ctx);
const SSR3 = vm.runInContext("typeof SSR_SKIN_TIER3!=='undefined'?SSR_SKIN_TIER3:{}", ctx);
const SSR  = vm.runInContext("typeof SSR_SKINS!=='undefined'?SSR_SKINS:{}", ctx);

const tier = Number((process.argv.find(a=>a.startsWith('--tier'))||'').split('=')[1] || 3) || 3;
// 特性の付加効果をダメージへ換算した目安(実測ではない)
const TRAIT_VALUE = {
  fire:[20,'やけど10秒=被ダメ1.5倍'], ogre:[20,'やけど10秒=被ダメ1.5倍'],
  warm:[25,'毒5/秒×10秒'], zan:[25,'毒5/秒×10秒'],
  ark:[22,'ガッツ削り45%'], suezo:[20,'ガッツ削り40%'], leaf:[15,'ガッツ削り30%'],
  aqua:[12,'与ダメ20%回復+20%で凍結'], spark:[10,'スロウ1秒'],
  rock:[0,'与ダメ1.2倍(計算済)'], mocchi:[0,'被ダメ0.8'], fox:[0,'当たり判定1.5倍(計算済)'],
  god:[0,'射程長め・ガッツ-12.5%'], pixie:[0,'移動1.2倍'], hum:[0,'弾速速い・射程短い'],
  phoenix:[0,'CD1/1.5(計算済)'], illumine:[0,'CD1/1.5(計算済)'],
};
const projHit = (sp)=> sp>=1200 ? 0.85 : sp>=700 ? 0.70 : 0.55;
const aoeHit  = (w)=>  w>=300 ? 0.75 : w>=200 ? 0.68 : w>=140 ? 0.60 : 0.52;

export function rate(mv, el){
  const e = ELEM[el] || {};
  const hb = e.hitboxMult || 1;
  let hit, hits = 1;
  const n = mv.burst || 1;
  if(n > 1){
    const step = mv.burstSideStep || 0;
    hits = step ? (step<=60 ? 2.2 : step<=80 ? 1.8 : 1.15) : n*0.55;
  }
  if(mv.aoeShape === 'gate') hit = 0.75;
  else if(mv.aoeShape){
    const w = (mv.rectWidth || mv.zigzagWidth || (mv.beamWidth ? mv.beamWidth*(mv.beamCount||1) : 0)
               || (mv.fanAngleDeg ? mv.fanAngleDeg*6 : 160)) * hb;
    hit = aoeHit(w);
  } else if(mv.multiOrb){ hit = 1; hits = 2.2; }
  else hit = Math.min(0.92, projHit(mv.projSpeed) + (hb-1)*0.1 + ((mv.hitR||0)+(mv.splash||0))/900);

  let bd = null;
  if(mv.blast) bd = { r:mv.blast.radius, d:mv.blast.dmg, n:hits };
  if(mv.endBlast) bd = { r:mv.endBlast.radius, d:mv.endBlast.dmg*(mv.endBlast.count||1)*((mv.endBlast.count||1)>1?0.6:1), n:1 };
  const blastExp = bd ? bd.d*bd.n*(hit + (1-hit)*(bd.r>=320?0.5 : bd.r>=230?0.35 : 0.2)) : 0;
  /* 核弾頭(ギガデストロイヤー)は本体とは別に飛ぶ弾。**数えないと素の技より弱く見える。** */
  let whExp = 0;
  if(mv.warheads){
    const w = mv.warheads;
    const wHit = Math.min(0.92, projHit(w.projSpeed) + ((w.hitR||0))/900);
    const wb = w.blast ? w.blast.dmg*(wHit + (1-wHit)*(w.blast.radius>=320?0.5 : w.blast.radius>=230?0.35 : 0.2)) : 0;
    whExp = (w.count||1) * ((w.dmg||0)*wHit + wb);
  }

  const dealt = e.dmgDealtMod || 1;
  const paper = (mv.dmg*(mv.multiOrb?mv.multiOrb.length:n)
                 + (mv.blast ? mv.blast.dmg*n : 0)
                 + (mv.endBlast ? mv.endBlast.dmg*(mv.endBlast.count||1) : 0)
                 + (mv.warheads ? (mv.warheads.count||1)*((mv.warheads.dmg||0)+(mv.warheads.blast?mv.warheads.blast.dmg:0)) : 0)) * dealt;
  const exp = (mv.dmg*hits*hit + blastExp + whExp) * dealt;
  const cd  = mv.cooldown * (e.cooldownMod || 1);
  const tv  = (TRAIT_VALUE[el] || [0,'—'])[0];
  return { paper:Math.round(paper), exp:+exp.toFixed(1), dps:+(exp/cd).toFixed(1), tot:+((exp+tv)/cd).toFixed(1), cd:+cd.toFixed(2) };
}

const rows = [];
for(const el of Object.keys(SIG)){
  const mv = SIG[el].find(m=>m.tier===tier);
  if(!mv) continue;
  const e = ELEM[el] || {};
  const r = rate(mv, el);
  rows.push({ label:e.label||el, name:mv.name, kind: mv.aoeShape ? ('範囲/'+mv.aoeShape) : (mv.multiOrb?'弾×'+mv.multiOrb.length:'弾'),
              ...r, range:mv.range, speed:mv.projSpeed||'—', guts:mv.gutsCost, trait:(TRAIT_VALUE[el]||[0,'—'])[1] });
}
rows.sort((a,b)=> b.tot - a.tot);
const pad = (v,n)=> String(v).padEnd(n,'　').slice(0,n);
console.log(`=== tier${tier} 技の強さ(特性込DPSの降順) ===`);
console.log('モンスター\t技名\t種類\t紙上\t期待威力\t期待DPS\t特性込\t射程\t弾速\tCD\tガッツ\t特性');
for(const r of rows) console.log([r.label,r.name,r.kind,r.paper,r.exp,r.dps,r.tot,r.range,r.speed,r.cd,r.guts,r.trait].join('\t'));
const t = rows.map(r=>r.tot).sort((a,b)=>a-b);
console.log(`\n幅: ${t[0]} 〜 ${t[t.length-1]}(${(t[t.length-1]/t[0]).toFixed(1)}倍) / 中央値 ${t[Math.floor(t.length/2)]}`);

// SSR専用tier3が素の技より弱くなっていないか(絶対値で数値を持つものだけが危ない)
console.log('\n=== SSR専用tier3 と 素の技 の比較 ===');
for(const id of Object.keys(SSR3)){
  const def = SSR3[id], el = (SSR[id]||{}).element;
  if(!el || !SIG[el]) continue;
  const base = SIG[el].find(m=>m.tier===3);
  if(!base) continue;
  const merged = Object.assign({}, base, def.move||{});
  if(def.move && def.move.blast) merged.blast = Object.assign({}, base.blast, def.move.blast);
  if(def.move && def.move.endBlast === null) merged.endBlast = null;
  else if(def.move && def.move.endBlast) merged.endBlast = Object.assign({}, base.endBlast, def.move.endBlast);
  const mult = def.dmgMult || 1;
  merged.dmg = merged.dmg * mult;
  const b = rate(base, el), s = rate(merged, el);
  const ng = s.tot < b.tot - 0.05;
  console.log([ng ? 'NG ' : 'OK ', (SSR[id]||{}).name||id, ELEM[el].label, `素${b.tot}`, `SSR${s.tot}`, ng ? '← SSRの方が弱い' : ''].join('\t'));
}
