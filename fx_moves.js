/* =====================================================================
   技ごとのVFX(fx_gl.js のWebGL層への発注)
   ---------------------------------------------------------------------
   ここは「どの技で、どんな粒・軌跡・輪を出すか」だけを書く表。
   描く仕組みそのものは fx_gl.js にあり、このファイルは注文書に徹する。

   表に1行足せば効く:
     FX_MOVES[属性キー] = { cast, fly, impact, sustain }
   4つとも省略できる。無い属性は FX_DEFAULT が受け持つので、**新しい属性を
   足しても何もしなくて動く**(手書きの対応表を増やさない、の原則)。

   4つの出番(採点表4「サブエミッタ4段」に対応):
     cast    … 技が出た瞬間に1回。溜め〜放出の頭。範囲技は発生時、弾は発射時
     fly     … 弾が飛んでいる間、毎フレーム
     impact  … 弾が消えた瞬間に1回(命中・射程切れ・障害物)
     sustain … 範囲技が続いている間、毎フレーム

   引数:
     fx  … window.__aramonFxGl(emit / burst / trail / ring)
     o   … 弾または範囲技そのもの(x,y,z,color,hitR,range…)
     c   … [r,g,b] 0..1。技の色。**auraTint(スキンの色替え)が既に反映済み**
     dt  … 前フレームからの秒(fly / sustain のみ)

   守ること:
     ・**色を決め打ちしない。** 必ず c から作る。白熱させたいときは c を1へ寄せる
     ・座標はワールド座標。画面上の位置や楕円を自分で計算しない
     ・技の性能値(range/dmg/hitR)を見た目のために読み替えない
===================================================================== */

/* 色を白へ寄せる(白熱の芯を作る)。t=0で技の色、t=1で白 */
function fxHot(c, t){ return [c[0]+(1-c[0])*t, c[1]+(1-c[1])*t, c[2]+(1-c[2])*t]; }
/* 色を暗く落とす(煙・縁を作る) */
function fxDim(c, t){ return [c[0]*t, c[1]*t, c[2]*t]; }

/* 既定の見え方。属性ごとの作り込みが無いときはこれが出る。
   「何も出ない」を作らないための下限であって、目標ではない。 */
const FX_DEFAULT = {
  fly(fx, p, c, dt){
    fx.trail('p'+p.id, p.x, p.y, (p.z||0)+14,
             { color:c, width: Math.max(10, (p.hitR||10)*1.7), bright:1.15 });
  },
  impact(fx, p, c){
    const h = fxHot(c, 0.55);
    fx.burst({ x:p.x, y:p.y, z:(p.z||0)+10, count:14, speed:200, jitter:8,
               r:h[0], g:h[1], b:h[2], bright:1.3, life:0.34, size0:12, size1:0.5,
               az:-300, turb:10, turbFreq:1.6, spin:5 });
    fx.ring({ x:p.x, y:p.y, r0:6, r1:Math.max(60, (p.splash||60)), life:0.32,
              color:c, width:14, bright:1.1 });
  },
  cast(fx, ae, c){
    fx.ring({ x:ae.x, y:ae.y, r0:12, r1:Math.min(ae.range||200, 420), life:0.55,
              color:c, width:26, bright:1.25 });
    fx.burst({ x:ae.x, y:ae.y, z:8, count:26, speed:210, jitter:26, jitterZ:30,
               elev:0.55, elevSpread:0.9, r:c[0], g:c[1], b:c[2], bright:1.2,
               life:0.5, size0:16, size1:1, az:-180, turb:16, turbFreq:1.2, spin:4 });
  },
};

/* =====================================================================
   属性ごとの作り込み
   ---------------------------------------------------------------------
   【fire を手本にすること】4段(cast/fly/impact/sustain)がすべて埋まっていて、
   採点表の「加算3層・軌跡・二次運動・時間設計」がどう手当てされているかが
   コメントで追える。他の属性もこの粒度で書く。
===================================================================== */
const FX_MOVES = {

  /* ---- 炎(ドラゴン / ヒノトリ) ----
     炎の見せ場は「白熱の芯・舞い上がる火の粉・後に残る煤」。
     火の粉は上昇気流(az>0)で舞い上げ、煤は重力で落とす。
     この2つを同時に出すと、同じ色でも「熱がある」ように見える。        */
  fire: {
    cast(fx, ae, c){
      const hot = fxHot(c, 0.6), soot = fxDim(c, 0.35);
      /* 地面の焦げの輪。**白へ寄せない・太くしない。**
         加算合成なので、白に寄せた太い輪は画面を横切る白い帯になって
         「地面の痕」に見えなくなる(実際に一度そうなった)。
         広がりも技の射程いっぱいではなく、足元の衝撃が届く範囲に留める。 */
      fx.ring({ x:ae.x, y:ae.y, r0:14, r1:Math.min(ae.range||300, 240), life:0.6,
                color:c, width:16, bright:0.85 });
      // 放出の頭。白熱を先に、色を後に出すと「点火」に見える
      fx.burst({ x:ae.x, y:ae.y, z:10, count:22, speed:280, jitter:20, jitterZ:24,
                 elev:0.35, elevSpread:0.7, r:hot[0], g:hot[1], b:hot[2], bright:1.6,
                 life:0.3, size0:22, size1:2, az:-120, turb:8, turbFreq:2.2, spin:6 });
      fx.burst({ x:ae.x, y:ae.y, z:14, count:30, speed:170, jitter:34, jitterZ:40,
                 elev:0.7, elevSpread:1.0, r:c[0], g:c[1], b:c[2], bright:1.25,
                 life:0.75, size0:26, size1:3, az:60, turb:22, turbFreq:1.1, spin:3 });
      // 煤。暗い色で重力に従って落ち、余韻を作る
      fx.burst({ x:ae.x, y:ae.y, z:18, count:14, speed:120, jitter:40, jitterZ:50,
                 elev:0.8, elevSpread:0.8, r:soot[0], g:soot[1], b:soot[2], bright:0.8,
                 life:1.1, size0:30, size1:8, az:-90, turb:26, turbFreq:0.7, spin:1.5 });
    },
    fly(fx, p, c, dt){
      const hot = fxHot(c, 0.5);
      fx.trail('p'+p.id, p.x, p.y, (p.z||0)+14,
               { color:hot, width: Math.max(14, (p.hitR||10)*2.2), bright:1.4 });
    },
    impact(fx, p, c){
      const hot = fxHot(c, 0.7), soot = fxDim(c, 0.3);
      fx.burst({ x:p.x, y:p.y, z:(p.z||0)+10, count:18, speed:300, jitter:6,
                 r:hot[0], g:hot[1], b:hot[2], bright:1.8, life:0.22, size0:16, size1:0.5,
                 az:-260, turb:6, turbFreq:2.4, spin:7 });
      fx.burst({ x:p.x, y:p.y, z:(p.z||0)+12, count:12, speed:120, jitter:14,
                 elev:0.9, elevSpread:0.6, r:soot[0], g:soot[1], b:soot[2], bright:0.9,
                 life:0.8, size0:22, size1:6, az:20, turb:24, turbFreq:0.8, spin:1 });
      fx.ring({ x:p.x, y:p.y, r0:5, r1:Math.max(70, (p.splash||70)*1.2), life:0.3,
                color:hot, width:16, bright:1.4 });
    },
    // 扇・壁が出ている間、縁から火の粉を上げ続ける(消えるまで生きて見せる)
    sustain(fx, ae, c, dt){
      if(Math.random() > dt*26) return;      // 秒26個ぶん。フレーム落ちしても密度が変わらない
      const a = (ae.angle||0) + (Math.random()-0.5)*((ae.fanAngleDeg||60)*Math.PI/180);
      const d = (ae.range||300) * (0.25 + Math.random()*0.75);
      fx.emit({ x: ae.x+Math.cos(a)*d, y: ae.y+Math.sin(a)*d, z: 6+Math.random()*20,
                vx:(Math.random()-0.5)*40, vy:(Math.random()-0.5)*40, vz: 90+Math.random()*110,
                az: 30, r:c[0], g:c[1], b:c[2], bright:1.1,
                life:0.6+Math.random()*0.5, size0:12+Math.random()*10, size1:1,
                turb:20, turbFreq:1.3, spin:2.5 });
    },
  },
};

// ヒノトリは炎と同じ作り(色だけ違う)。表を分けず参照を共有する
FX_MOVES.phoenix = FX_MOVES.fire;

window.__aramonFxMoves  = FX_MOVES;
window.__aramonFxDefault = FX_DEFAULT;
