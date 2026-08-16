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
      /* 帯は**技の色そのもの**を渡す。白へ寄せると加算の重なりで飽和して
         炎に見えなくなる(白いサーチライトになった)。白熱は whiten を
         小さく取って先端だけに残す。 */
      fx.trail('p'+p.id, p.x, p.y, (p.z||0)+14,
               { color:c, width: Math.max(12, (p.hitR||10)*1.8), bright:1.1, whiten:0.3 });
      // 尾を引く火の粉。帯だけだと「棒」に見えるので、必ず粒を混ぜて輪郭を崩す
      const n = Math.min(dt||0, 0.05) * 40;
      for(let i = Math.floor(n) + (Math.random() < (n%1) ? 1 : 0); i>0; i--){
        fx.emit({ x:p.x+(Math.random()-0.5)*16, y:p.y+(Math.random()-0.5)*16, z:(p.z||0)+14+(Math.random()-0.5)*16,
                  vx:-(p.vx||0)*0.14, vy:-(p.vy||0)*0.14, vz:30+Math.random()*70,
                  az:20, r:c[0], g:c[1], b:c[2], bright:1.05,
                  life:0.35+Math.random()*0.3, size0:7+Math.random()*7, size1:1,
                  turb:18, turbFreq:1.5, spin:3 });
      }
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


/* =====================================================================
   属性ごとの作り込み(担当班が書いたぶん)
   マーカー <<FX:名前>> … <</FX:名前>> で1属性ぶんを囲む。**囲みを外さない。**
   班ごとに別のworktreeで書いたものをここへ集めているので、囲みが
   「どこからどこまでが1属性か」の唯一の目印になっている。
===================================================================== */

/* <<FX:helpers:ark+illumine+god>> */
/* 光(ark)・闇(illumine)・神(god)の3つが共有する小道具。
   3属性のどれか1つだけを取り込むときも、このブロックは必ず一緒に持っていく。
   **fxHot / fxDim と同じ立場**(色と量を作るだけで、技の性能には一切触らない)。 */

/* 彩度を立てる。色相はそのままに「一番濃い成分が1になるまで」明度を上げる。
   加算合成では暗い色がほとんど描かれない。実例=レクイエムエンドの爆風ドームは
   ae.color が #1d0b2e(ほぼ黒)で、そのまま渡すと粒が1つも見えない。
   fxHot で白へ寄せると今度は色が抜けて「闇」に見えなくなるので、
   **明るさだけを上げて色相は必ず引数 c から取る**。これが決め打ちを避ける要。 */
function fxVivid(c){
  const m = Math.max(c[0], c[1], c[2]);
  if(m < 0.02) return c;              // 完全な黒。持ち上げようがないのでそのまま返す
  return [c[0]/m, c[1]/m, c[2]/m];
}

/* 色を「白から遠ざける」。fxVivid が明るさを上げるのに対し、こちらは**彩度**を上げる。
   一番濃い成分は保ったまま、薄い成分だけを k 乗で落とす。
   実例=光の #ffe9a8 は (1.00, 0.91, 0.66) でほぼ白。そのまま輪に使うと画の中では
   「灰色の針金」にしか見えなかった(2周目のコマで確認)。k=2.4 で (1.00, 0.80, 0.35) の
   金になり、白い芯との差がついて初めて加算3層(採点表2)が成立する。
   **色相は元の色のまま**なので、色替え(auraTint)でも関係が崩れない。 */
function fxDeep(c, k){
  const m = Math.max(c[0], c[1], c[2]);
  if(m < 0.02) return c;
  const e = k || 2.4;
  return [m*Math.pow(c[0]/m, e), m*Math.pow(c[1]/m, e), m*Math.pow(c[2]/m, e)];
}

/* 弾の進行方向(ワールドの単位ベクトル)。止まっている弾は null。
   **画面上の角度ではない**ので、カメラを回しても粒の並びが破綻しない。 */
function fxHeadingOf(p){
  const s = Math.hypot(p.vx||0, p.vy||0);
  return s > 1 ? [p.vx/s, p.vy/s] : null;
}

/* 弾に「発生(muzzle)」を1回だけ出すための印。
   render.js は cast を**範囲技にしか呼ばない**(弾には fly と impact だけ)。
   採点表4「サブエミッタ4段」の1段目を弾でも作りたいので、fly の初回で撃つ。
   印は弾そのものに置く: 弾が消えれば印も消えるので、表が試合中ずっと膨らまない。 */
function fxOnce(p){
  if(p.__fxMuzzle) return false;
  p.__fxMuzzle = 1;
  return true;
}

/* dt に比例した個数。整数部はそのまま、端数は確率で足す。
   **フレーム落ちしても密度が変わらない**(fire の sustain と同じ考え方)。
   dt は 0.05 で頭打ちにする。タブを戻した直後の巨大な dt で
   数千個いっぺんに湧くのを防ぐ(render.js が渡す dt は実時間で無制限)。 */
function fxSpawnN(dt, perSec){
  const n = Math.min(dt||0, 0.05) * perSec;
  return Math.floor(n) + (Math.random() < (n % 1) ? 1 : 0);
}

/* 地面の高さ。リアルマップは起伏があるので、地面に置く粒はここから積む。
   通常マップでは常に0を返すので見た目は変わらない(fx_gl.js の輪と同じ拾い方)。 */
function fxGroundZ(x, y){
  return (typeof window.groundZAt === 'function') ? window.groundZAt(x, y) : 0;
}

/* 範囲技が「今どこまで伸びているか」。
   ae は spawnAt を試合内時刻で持っているが、この層は実時間で回っているので
   自前の経過時間を ae に足していく(印を ae に置くので技が消えれば一緒に消える)。
   **ここがずれても当たり判定には一切触らない。** 粒を置く位置だけの話。 */
function fxAeReach(ae, dt){
  ae.__fxT = (ae.__fxT || 0) + Math.min(dt||0, 0.05);
  const t = ae.__fxT - (ae.telegraphTime || 0);
  if(t <= 0) return 0;
  return Math.min(ae.range || 0, t * (ae.fillSpeed || 900));
}

/* 中心へ吸い込む粒。burst は外へ散らすことしかできないので、
   半径 r の球面に置いて速度を中心向き(負)にして自前で撒く。**闇の要**。
   速さは「寿命のあいだにちょうど中心へ着く」ように距離から決める。
   一定速にすると外側の粒だけ遅れて、収束の瞬間がぼやける。 */
function fxImplode(fx, o){
  const n = o.count || 18;
  const c = o.color || [1,1,1];
  const life = o.life || 0.4;
  for(let i=0;i<n;i++){
    const a  = Math.random()*Math.PI*2;
    const el = (o.elev==null ? Math.random()*0.8 : o.elev + (Math.random()-0.5)*(o.elevSpread||0.6));
    const rr = (o.r||150) * (0.55 + Math.random()*0.45);
    const ch = Math.cos(el), sh = Math.sin(el);
    const ox = Math.cos(a)*ch*rr, oy = Math.sin(a)*ch*rr, oz = sh*rr;
    const k  = 1/Math.max(life, 0.05);
    fx.emit({ x:o.x+ox, y:o.y+oy, z:(o.z||0)+oz,
              vx:-ox*k, vy:-oy*k, vz:-oz*k,
              az:(o.az==null ? 0 : o.az),        // 既定は無重力。**吸い込む向きだけを見せたい**
              r:c[0], g:c[1], b:c[2], bright:o.bright,
              life: life*(0.85+Math.random()*0.3),
              size0:(o.size0||10)*(0.7+Math.random()*0.6), size1:o.size1,
              turb:o.turb||0, turbFreq:o.turbFreq||1, spin:o.spin||0 });
  }
}
/* <</FX:helpers:ark+illumine+god>> */

/* <<FX:ark>> */
/* ---- 光(アーク) ----
   狙い: **眩しさは「量」ではなく「芯の白さ」で作る。** 粒を増やすと画面が白く濁るだけで、
   光ってはくれない。だから芯は fxHot(c, 0.8〜0.85) でほぼ白へ飛ばし、周りに置く粒は
   fxDeep で彩度を立てた金にして「白い芯 → 金の身 → 深い琥珀の縁」の3層(採点表2)を作る。
   **fxDeep が要**。#ffe9a8 は元がほぼ白なので、素のまま輪に使うと灰色の針金に見える。
   二次運動は**ゆっくり落ちる羽根**。az を弱い負(-50前後)にし、寿命を1.4秒級まで伸ばし、
   size1 を size0 の半分までしか縮めない(点まで縮めると火の粉になって光に見えない)。 */
FX_MOVES.ark = {
  /* 光の範囲技が増えたときの受け皿。現行の光3技はすべて弾なので、
     いまここへ来るのは撃った側の足元ではなく将来の範囲技だけ。
     **輪を射程いっぱいに広げない**(加算合成なので白い帯が画面を横切る)。 */
  cast(fx, ae, c){
    const hot = fxHot(c, 0.85), gold = fxDeep(c, 2.2), halo = fxDim(fxDeep(c, 2.8), 0.75);
    /* 【術者の足元の輪は必ず小さくする】カメラは術者の145後ろ・90上に居るので、
       半径が120を超えた輪は**カメラの真横を通り抜けて画面を横切る白い弧**になる
       (0.06sのコマで実際にそうなった)。足元の輪は60前後・bright 0.6以下が上限。 */
    const R = Math.min(ae.range || 60, 60);
    fx.ring({ x:ae.x, y:ae.y, r0:8, r1:R, life:0.5, color:gold, width:7, bright:0.6 });
    // 足元から抜ける細い柱(光の技の共通の芯)
    for(let i=0;i<18;i++){
      const x = ae.x + (Math.random()-0.5)*26, y = ae.y + (Math.random()-0.5)*26;
      fx.emit({ x, y, z:fxGroundZ(x,y)+Math.random()*14,
                vx:(Math.random()-0.5)*24, vy:(Math.random()-0.5)*24, vz:360+Math.random()*300,
                az:-260, r:hot[0], g:hot[1], b:hot[2], bright:1.6,
                life:0.5+Math.random()*0.3, size0:10+Math.random()*8, size1:1,
                turb:6, turbFreq:2, spin:0 });
    }
    // 舞い上がってから落ちる羽根(余韻)
    fx.burst({ x:ae.x, y:ae.y, z:20, count:16, speed:110, jitter:R*0.5, jitterZ:50,
               elev:0.8, elevSpread:0.9, r:halo[0], g:halo[1], b:halo[2], bright:0.9,
               life:1.5, size0:16, size1:8, az:-50, turb:38, turbFreq:0.45, spin:1.1 });
  },

  fly(fx, p, c, dt){
    if(p.delay > 0) return;              // 連射の待機中。まだ銃口に居るので何も出さない
    /* 3層。**芯は白 / 身は金 / 縁は深い琥珀。** #ffe9a8 はほぼ白なので、
       fxDeep を通さないと3層が全部同じ薄いクリーム色になって「平ら」に見える。 */
    const hot  = fxHot(c, 0.8);              // 芯。ほぼ白
    const gold = fxDeep(c, 2.2);             // 身。金
    const halo = fxDim(fxDeep(c, 2.8), 0.7); // 縁。加算では暗くできないので「濃く・薄く・広く」
    const z = (p.z||0) + 14;

    // ---- 1段目: 発生(muzzle)。render.js は弾に cast を呼ばないのでここで1回だけ ----
    if(fxOnce(p)){
      const h = fxHeadingOf(p) || [1,0];
      fx.burst({ x:p.x, y:p.y, z, count:16, speed:260, jitter:6, jitterZ:10,
                 angle:Math.atan2(h[1],h[0]), spread:1.1, elev:0.12, elevSpread:0.5,
                 r:hot[0], g:hot[1], b:hot[2], bright:1.7,
                 life:0.2, size0:16, size1:0.5, az:-140, turb:6, turbFreq:2, spin:5 });
      /* 足元の輪。**60前後まで。** カメラは術者の145後ろに居るので、これ以上広げると
         輪がカメラの横をすり抜けて画面を横切る白い弧になる(実際に一度そうなった)。 */
      fx.ring({ x:p.x, y:p.y, r0:8, r1:58, life:0.34, color:gold, width:6, bright:0.55 });
      fx.burst({ x:p.x, y:p.y, z:16, count:12, speed:90, jitter:20, jitterZ:26,
                 elev:0.9, elevSpread:0.7, r:gold[0], g:gold[1], b:gold[2], bright:0.95,
                 life:1.4, size0:14, size1:7, az:-55, turb:36, turbFreq:0.5, spin:1.2 });
    }

    // ---- 2段目: 飛翔中。細い白の芯 + 太く薄い金の外套の2本立て ----
    fx.trail('p'+p.id, p.x, p.y, z,
             { color:hot, width: Math.max(10, (p.hitR||10)*1.5), bright:1.5 });
    /* 2本目は projStyle(tier3の専用弾)だけ。帯は24本しか無いので、
       雑魚弾まで2本使うと乱戦で誰の帯も出なくなる。見せ場の弾だけ厚くする。 */
    if(p.projStyle){
      fx.trail('pw'+p.id, p.x, p.y, z,
               { color:halo, width: Math.max(26, (p.hitR||10)*4.2), bright:0.75 });
    }
    // 尾から剥がれてゆっくり落ちる羽根。az が弱いので後ろへ長く残る(採点表10)
    const w = (p.hitR||10)*1.6;
    for(let i=fxSpawnN(dt, p.projStyle ? 90 : 34); i>0; i--){
      fx.emit({ x:p.x+(Math.random()-0.5)*w, y:p.y+(Math.random()-0.5)*w, z:z+(Math.random()-0.5)*w,
                vx:(Math.random()-0.5)*40, vy:(Math.random()-0.5)*40, vz:10+Math.random()*40,
                az:-52,                                   // 弱い負。強くすると火の粉になる
                r:gold[0], g:gold[1], b:gold[2], bright:1.05,
                life:1.1+Math.random()*0.8,               // 長め。落ちきる前に消えない
                size0:8+Math.random()*8, size1:5,         // 縮み切らない = 羽根の面が残る
                turb:30, turbFreq:0.5, spin:1.4 });
    }
  },

  /* 着弾。**last には vx/projStyle が無い**(render.js が最後に見えた位置だけを控えるため)ので、
     大きさは hitR と splash から作る。読むだけで、性能値は書き換えない。 */
  impact(fx, p, c){
    const hot  = fxHot(c, 0.85);              // 芯 = 白
    const gold = fxDeep(c, 2.8);              // 身 = 金(輪は遠くで細く見えるので彩度を強めに取る)
    const halo = fxDim(fxDeep(c, 3.4), 0.75); // 縁 = 深い琥珀
    const R  = Math.max(60, (p.splash||0) || (p.hitR||12)*3);
    const g  = fxGroundZ(p.x, p.y);
    // ---- 3段目その1: 白の閃光。**数ではなく bright を上げて眩しくする** ----
    fx.burst({ x:p.x, y:p.y, z:(p.z||0)+10, count:14, speed:230, jitter:5,
               r:hot[0], g:hot[1], b:hot[2], bright:2.0,
               life:0.16, size0:18, size1:0.5, az:-200, turb:4, turbFreq:2.6, spin:6 });
    /* ---- 3段目その2: 下から立つ細い柱 ----
       横のばらつきを当たり半径の半分に抑えて「細さ」を作る。粒を縦に積み上げるので、
       密度を上げないと点の列にしか見えない(1周目は16個で足りなかった)。
       上端が一直線に揃うと板に見えるので、初速に幅を持たせて先をほどけさせる。 */
    const colR = Math.max(6, (p.hitR||12)*0.5);
    for(let i=0;i<30;i++){
      fx.emit({ x:p.x+(Math.random()-0.5)*colR, y:p.y+(Math.random()-0.5)*colR, z:g+Math.random()*16,
                vx:(Math.random()-0.5)*22, vy:(Math.random()-0.5)*22, vz:420+Math.random()*340,
                az:-300,                                  // 上がりきって止まる = 柱の先がほどける
                r:hot[0], g:hot[1], b:hot[2], bright:1.6,
                life:0.5+Math.random()*0.35, size0:11+Math.random()*9, size1:1,
                turb:5, turbFreq:2, spin:0 });
    }
    // ---- 地面: 外へ広がる薄い輪 + 内側の短い輪。**白へ寄せない・太くしない** ----
    fx.ring({ x:p.x, y:p.y, r0:R*0.25, r1:R*3.2, life:0.6,  color:gold, width:17, bright:1.0 });
    fx.ring({ x:p.x, y:p.y, r0:4,      r1:R*1.1, life:0.26, color:hot,  width:9,  bright:1.15 });
    // ---- 4段目: 残り羽根。2秒級の寿命で余韻を残す(採点表7)。**着弾より後に画が痩せない** ----
    fx.burst({ x:p.x, y:p.y, z:(p.z||0)+30, count:30, speed:120, jitter:R*0.5, jitterZ:70,
               elev:0.75, elevSpread:0.9, r:halo[0], g:halo[1], b:halo[2], bright:1.0,
               life:1.9, size0:20, size1:10, az:-46, turb:40, turbFreq:0.4, spin:1.1 });
  },

  // 光の範囲技が続いている間。先端の縁から羽根がこぼれ続ける
  sustain(fx, ae, c, dt){
    const reach = fxAeReach(ae, dt);
    if(reach <= 2) return;
    const gold = fxDeep(c, 2.2);
    for(let i=fxSpawnN(dt, 24); i>0; i--){
      const a = (ae.angle||0) + (Math.random()-0.5)*((ae.fanAngleDeg||60)*Math.PI/180);
      const d = reach * (0.3 + Math.random()*0.7);
      const x = ae.x + Math.cos(a)*d, y = ae.y + Math.sin(a)*d;
      fx.emit({ x, y, z:fxGroundZ(x,y)+10+Math.random()*40,
                vx:(Math.random()-0.5)*30, vy:(Math.random()-0.5)*30, vz:40+Math.random()*70,
                az:-50, r:gold[0], g:gold[1], b:gold[2], bright:1.0,
                life:1.0+Math.random()*0.7, size0:10+Math.random()*8, size1:5,
                turb:32, turbFreq:0.5, spin:1.3 });
    }
  },
};
/* <</FX:ark>> */

/* <<FX:illumine>> */
/* ---- 闇(イルミネ) ----
   狙い: **外へ散らすのではなく内へ吸い込む。** burst を使うと必ず「散る」画になるので、
   飛翔中も着弾も fxImplode(中心向きの負の初速)を主役に据えた。
   色は fxVivid で彩度を立ててから使う。tier3 の爆風ドームは ae.color が #1d0b2e
   (ほぼ黒)で、素のままだと加算合成で1粒も見えないため。
   暗い縁は fxDim(fxDeep(viv, 2.2), 0.34) を「太く・薄く・長寿命」で置いて作る。加算合成では
   画面を暗くできないので、**明るい芯の外側を薄い層で囲む**のが唯一のやり方。
   残滓は az:0・vz:0 で地面すれすれに置き、乱流だけで這わせてゆっくり消す。 */
FX_MOVES.illumine = {
  /* 出番はレクイエムエンドの爆風ドーム(kind:'circle')。
     **ドームは実際に外へ広がる当たり判定**なので、ここだけは内向きにしない。
     内向きにすると判定の広がりと逆向きに見えて嘘になる。
     吸い込みの役は fly と impact が持っているので、属性の性格は保たれる。 */
  cast(fx, ae, c){
    const viv = fxVivid(c), core = fxHot(viv, 0.5), rim = fxDim(fxDeep(viv, 2.2), 0.34);
    const R   = ae.range || 200;
    const exp = ae.fillSpeed ? R/ae.fillSpeed : 0.45;    // 広がりきるまでの秒(判定と同じ速さ)
    // 縁の輪2枚。**中は埋めない**(2D側がドームの面を描いているので芯を隠さない)
    fx.ring({ x:ae.x, y:ae.y, r0:8, r1:R,      life:exp+0.25, color:viv, width:16, bright:0.95 });
    fx.ring({ x:ae.x, y:ae.y, r0:8, r1:R*1.35, life:exp+0.55, color:rim, width:26, bright:0.55 });
    // ドームの殻。上半球だけへ撒くので「半球」に見える
    for(let i=0;i<34;i++){
      const a  = Math.random()*Math.PI*2;
      const el = Math.random()*Math.PI*0.5;
      const sp = (R/Math.max(exp,0.05)) * (0.7+Math.random()*0.4);
      fx.emit({ x:ae.x, y:ae.y, z:(ae.z||0)+6,
                vx:Math.cos(a)*Math.cos(el)*sp, vy:Math.sin(a)*Math.cos(el)*sp, vz:Math.sin(el)*sp,
                az:-140, r:viv[0], g:viv[1], b:viv[2], bright:1.0,
                life:exp*(1.1+Math.random()*0.6), size0:16+Math.random()*14, size1:34,
                turb:20, turbFreq:0.9, spin:1.5 });
    }
    // 中心で潰れた1点だけを白く飛ばす。周りが暗いので、点1つで十分眩しくなる
    fx.burst({ x:ae.x, y:ae.y, z:(ae.z||0)+14, count:7, speed:110, jitter:3,
               r:core[0], g:core[1], b:core[2], bright:1.9,
               life:0.15, size0:16, size1:0.5, az:-120, turb:0, spin:8 });
  },

  fly(fx, p, c, dt){
    if(p.delay > 0) return;
    const viv  = fxVivid(c);
    const core = fxHot(viv, 0.35);              // 芯。**白へ振り切らない**(振り切ると光属性と見分けが付かない)
    const rim  = fxDim(fxDeep(viv, 2.2), 0.34); // 暗い縁。彩度を上げてから落とすと「濃い紫」になる
    const z = (p.z||0) + 14;

    // ---- 1段目: 発生。撃つ前に周りの闇が銃口へ集まる ----
    if(fxOnce(p)){
      fxImplode(fx, { x:p.x, y:p.y, z, r:90 + (p.hitR||10)*2, count:20,
                      color:viv, bright:1.15, life:0.26, size0:14, size1:2,
                      turb:16, turbFreq:2.0, spin:4 });
      /* 暗い縁の輪。**bright を1未満に抑える**(明るくすると紫が白へ飛んで闇に見えない)。
         半径も60前後まで。カメラが術者の145後ろに居るので、それ以上は画面を横切る弧になる。 */
      fx.ring({ x:p.x, y:p.y, r0:6, r1:60, life:0.4, color:rim, width:8, bright:0.6 });
    }

    // ---- 2段目: 飛翔中。細い芯 + 太く薄い暗縁の2本立て ----
    fx.trail('p'+p.id, p.x, p.y, z,
             { color:core, width: Math.max(9, (p.hitR||10)*1.35), bright:1.25 });
    if(p.projStyle){
      fx.trail('pw'+p.id, p.x, p.y, z,
               { color:rim, width: Math.max(30, (p.hitR||10)*5), bright:0.5 });
    }
    /* 弾のまわりの紫が**内へ吸われる**。進行方向に垂直な輪の上に置いて、
       中心(弾が居た所)へ引き戻す。弾は前へ進み続けるので、後ろに
       「すぼまっていく袖」が残る = 吸い込みが速度としても読める。 */
    const h = fxHeadingOf(p) || [1,0];
    for(let i=fxSpawnN(dt, p.projStyle ? 70 : 30); i>0; i--){
      const a  = Math.random()*Math.PI*2;
      const rr = 26 + (p.hitR||10)*1.6 + Math.random()*20;
      const ox = -h[1]*Math.cos(a)*rr, oy = h[0]*Math.cos(a)*rr, oz = Math.sin(a)*rr;
      const life = 0.34 + Math.random()*0.18;
      fx.emit({ x:p.x+ox, y:p.y+oy, z:z+oz,
                vx:-ox/life, vy:-oy/life, vz:-oz/life,
                az:0,                       // 落とさない。**吸い込む向きだけを見せたい**
                r:rim[0], g:rim[1], b:rim[2], bright:1.0,
                life, size0:12+Math.random()*8, size1:2,
                turb:14, turbFreq:1.6, spin:3 });
    }
    /* 通った下の地面に残滓を落とす。size1 > size0 なので、消えながら広がる。
       速度をほぼ殺して**その場に溜める**。1周目は速度30で散らしていたため、
       0.9sのコマで「ばらけた点」にしかならず、地面の染みに見えなかった。 */
    for(let i=fxSpawnN(dt, 22); i>0; i--){
      const x = p.x+(Math.random()-0.5)*60, y = p.y+(Math.random()-0.5)*60;
      fx.emit({ x, y, z:fxGroundZ(x,y)+4+Math.random()*8,
                vx:(Math.random()-0.5)*12, vy:(Math.random()-0.5)*12, vz:0,
                az:0, r:rim[0], g:rim[1], b:rim[2], bright:0.7,
                life:1.6+Math.random()*1.0, size0:26+Math.random()*20, size1:44,
                turb:16, turbFreq:0.25, spin:0.4 });
    }
  },

  impact(fx, p, c){
    const viv = fxVivid(c), core = fxHot(viv, 0.55), rim = fxDim(fxDeep(viv, 2.2), 0.32);
    const R = Math.max(70, (p.splash||0) || (p.hitR||12)*3.2);
    // ---- 3段目その1: 崩落。外から中心へ一気に吸い込む(**外へ散らさない**) ----
    fxImplode(fx, { x:p.x, y:p.y, z:(p.z||0)+12, r:R*2.2, count:34,
                    color:viv, bright:1.3, life:0.3, size0:18, size1:2,
                    turb:12, turbFreq:2.2, spin:5 });
    // ---- 3段目その2: 潰れた一点だけが白く弾ける。量ではなく密度で眩しくする ----
    fx.burst({ x:p.x, y:p.y, z:(p.z||0)+12, count:8, speed:120, jitter:3,
               r:core[0], g:core[1], b:core[2], bright:2.1,
               life:0.14, size0:16, size1:0.5, az:-120, turb:0, spin:8 });
    // ---- 地面: 暗い縁の広い輪 + 芯の短い輪 ----
    fx.ring({ x:p.x, y:p.y, r0:R*0.2, r1:R*3.0, life:0.6,  color:rim, width:16, bright:0.7 });
    fx.ring({ x:p.x, y:p.y, r0:2,     r1:R*0.9, life:0.24, color:viv, width:8,  bright:1.0 });
    /* ---- 4段目: 残滓。地面を這って1.6〜2.6秒かけてゆっくり消える ----
       外へ這う速さは20前後まで。速いと「散った粒」になって染みに見えない。
       粒は大きく・数を多く・重ねる。**1つ1つは薄い**ので、重なった所だけが濃くなる。 */
    for(let i=0;i<26;i++){
      const a = Math.random()*Math.PI*2, rr = R*(0.15+Math.random()*0.85);
      const x = p.x+Math.cos(a)*rr, y = p.y+Math.sin(a)*rr;
      fx.emit({ x, y, z:fxGroundZ(x,y)+3+Math.random()*10,
                vx:Math.cos(a)*(10+Math.random()*22), vy:Math.sin(a)*(10+Math.random()*22), vz:0,
                az:0, r:rim[0], g:rim[1], b:rim[2], bright:0.75,
                life:1.6+Math.random()*1.0, size0:28+Math.random()*20, size1:52,
                turb:20, turbFreq:0.25, spin:0.35 });
    }
  },

  // ドームが広がっている間、縁の外側へ残滓を吐き続ける(消えたあとも痕が残る)
  sustain(fx, ae, c, dt){
    const reach = fxAeReach(ae, dt);
    if(reach <= 2) return;
    const rim = fxDim(fxDeep(fxVivid(c), 2.2), 0.34);
    for(let i=fxSpawnN(dt, 34); i>0; i--){
      const a = Math.random()*Math.PI*2, rr = reach*(0.7+Math.random()*0.35);
      const x = ae.x+Math.cos(a)*rr, y = ae.y+Math.sin(a)*rr;
      fx.emit({ x, y, z:fxGroundZ(x,y)+3+Math.random()*14,
                vx:Math.cos(a)*14, vy:Math.sin(a)*14, vz:0,
                az:0, r:rim[0], g:rim[1], b:rim[2], bright:0.72,
                life:1.5+Math.random()*1.0, size0:24+Math.random()*18, size1:46,
                turb:18, turbFreq:0.25, spin:0.4 });
    }
  },
};
/* <</FX:illumine>> */

/* <<FX:god>> */
/* ---- 神(ガリ) ----
   【最重要】ゴッドライジングは**弾ごとに色が違う**(赤青黄緑)。引数 c は弾の色から来るので、
   色は必ず c から作れば4色が自動で出る。**ここで色を決め打ちすると4色が全部同じになって壊れる。**
   狙い: 4つの球が互いに干渉して見えること。だから
     ・球ごとに独立した帯を2本(細い芯 + 太い色)。**共有のキーを使わない**(p.id で必ず分かれる)
     ・球のまわりを回りながら後ろへ流れる螺旋の火花。位相を弾ごとに持つので4本がずれて絡む
     ・着弾の輪も色ごと。4つの輪が重なった所だけが白く抜ける = 干渉が見える
   ホーリーサンダー(tier2, zigzag)は範囲技なので cast と sustain が本番。
   稲妻の芯は2D側が描いているので、ここは**落雷の着地**(火花・焦げの輪)だけを足す。 */
FX_MOVES.god = {
  cast(fx, ae, c){
    const viv = fxVivid(c), hot = fxHot(viv, 0.75);
    /* 足元の輪。**ae.range(1600)ではなく足元だけ**に留める。既定の見え方は
       min(range, 420) にしていて、加算合成の太い輪が画面を横切る白い帯になっていた。
       半径200でもまだ帯になったので60まで落とした(カメラが術者の145後ろに居るため)。 */
    fx.ring({ x:ae.x, y:ae.y, r0:8, r1:60, life:0.45, color:viv, width:7, bright:0.6 });
    // 溜め → 放出。白い芯が上へ抜けてから、色が横へ散る
    fx.burst({ x:ae.x, y:ae.y, z:10, count:16, speed:150, jitter:14, jitterZ:20,
               elev:1.15, elevSpread:0.4, r:hot[0], g:hot[1], b:hot[2], bright:1.5,
               life:0.34, size0:13, size1:0.5, az:-260, turb:6, turbFreq:2.6, spin:5 });
    fx.burst({ x:ae.x, y:ae.y, z:14, count:20, speed:190, jitter:24, jitterZ:26,
               elev:0.3, elevSpread:0.8, r:viv[0], g:viv[1], b:viv[2], bright:1.15,
               life:0.6, size0:18, size1:2, az:-180, turb:20, turbFreq:1.4, spin:3 });
  },

  fly(fx, p, c, dt){
    if(p.delay > 0) return;
    const viv  = fxVivid(c);            // 4色の球は薄い色(#4d7cff等)なので彩度を立ててから使う
    /* 【4色を保つための線引き】芯を白へ寄せすぎない。1周目は fxHot(viv, 0.55) にしていて、
       4つの球が同じ場所から出る 0.2s のコマで**全部が白い塊に融けた**(色差が消えた)。
       白飛びは着弾(impact)の一点だけに任せ、飛翔中は色を守る。 */
    const core = fxHot(viv, 0.22);
    /* 2D側が描く球の芯は**白い**(4つとも同じ)。色を見せるには、その白い塊の
       **外側**に自分の色の層を置くしかない。だから螺旋の半径を球の当たり半径より
       大きく取り、色は fxDeep で振り切る。これで白い芯 → 濃い色の殻、の2重になる。 */
    const deep = fxDeep(viv, 2.4);
    const z = (p.z||0) + 14;

    // ---- 1段目: 発生 ----
    if(fxOnce(p)){
      const h = fxHeadingOf(p) || [1,0];
      fx.burst({ x:p.x, y:p.y, z, count:14, speed:240, jitter:6, jitterZ:10,
                 angle:Math.atan2(h[1],h[0]), spread:1.0, elev:0.1, elevSpread:0.5,
                 r:core[0], g:core[1], b:core[2], bright:1.25,
                 life:0.2, size0:14, size1:0.5, az:-160, turb:6, turbFreq:2.2, spin:5 });
      // 輪も球の色。**4発ぶんが足元で重なるので、1つあたりは小さく暗く**(重なって初めて眩しい)
      fx.ring({ x:p.x, y:p.y, r0:6, r1:52, life:0.32, color:deep, width:6, bright:0.5 });
    }

    // ---- 2段目: 飛翔中。**球ごとに独立した帯**(キーが p.id なので必ず分かれる) ----
    fx.trail('p'+p.id, p.x, p.y, z,
             { color:core, width: Math.max(11, (p.hitR||10)*1.4), bright:1.15 });
    /* 神は色が白に近い(#f5f0ff)ので、彩度では層を作れない。**太さで層を作る。**
       だから2本目は tier3 だけでなく全弾に付ける。同時に飛ぶのは tier1 が1発・
       tier3 が4発なので、帯(24本)を食い潰さない。 */
    fx.trail('pw'+p.id, p.x, p.y, z,
             { color:deep, width: Math.max(p.projStyle?24:18, (p.hitR||10)*3.4),
               bright: p.projStyle ? 0.85 : 0.7 });
    /* 螺旋の火花。位相は弾そのものに持たせるので、4つの球がそれぞれ違う所を回る。
       速度は**後ろ向き**にして、球から剥がれて流れていくように見せる(速度が読める)。 */
    p.__fxSpin = (p.__fxSpin==null ? Math.random()*6.283 : p.__fxSpin) + Math.min(dt||0, 0.05)*13;
    const h = fxHeadingOf(p) || [1,0];
    const rr = 26 + (p.hitR||10)*1.5;   // 球の当たり半径より外へ。白い芯に飲まれない位置
    /* tier3(projStyle)は**4つの球が同時に撒く**ので1本あたりを抑える。
       1周目は60/秒×4本にしていて、重なった所が真っ白になり4色が消えた。
       逆に単発の tier1 は数を出さないと screenshot で「何も無い」に見えた(4周目)。 */
    for(let i=fxSpawnN(dt, p.projStyle ? 34 : 44); i>0; i--){
      const a  = p.__fxSpin + i*0.9;
      const ox = -h[1]*Math.cos(a)*rr, oy = h[0]*Math.cos(a)*rr, oz = Math.sin(a)*rr;
      fx.emit({ x:p.x+ox, y:p.y+oy, z:z+oz,
                vx:-h[0]*90, vy:-h[1]*90, vz:0,
                az:-40, r:deep[0], g:deep[1], b:deep[2], bright:1.3,
                life:0.45+Math.random()*0.35, size0:9+Math.random()*7, size1:1,
                turb:12, turbFreq:2.4, spin:4 });
    }
  },

  impact(fx, p, c){
    const viv = fxVivid(c), hot = fxHot(viv, 0.8), deep = fxDeep(viv, 2.4);
    const R = Math.max(55, (p.splash||0) || (p.hitR||12)*2.6);
    // ---- 3段目その1: 白の芯。**着弾だけは白飛びさせてよい**(4つ同時でも一瞬なので色は潰れない) ----
    fx.burst({ x:p.x, y:p.y, z:(p.z||0)+10, count:10, speed:220, jitter:4,
               r:hot[0], g:hot[1], b:hot[2], bright:1.8,
               life:0.15, size0:17, size1:0.5, az:-220, turb:4, turbFreq:2.6, spin:7 });
    // ---- 3段目その2: 色の花火。**c から作るので4色の球がそれぞれ自分の色で咲く** ----
    fx.burst({ x:p.x, y:p.y, z:(p.z||0)+12, count:24, speed:300, jitter:8, jitterZ:14,
               r:deep[0], g:deep[1], b:deep[2], bright:1.45,
               life:0.55, size0:14, size1:1, az:-240, turb:16, turbFreq:1.8, spin:4 });
    /* ---- 地面: 色ごとの輪。**4つの弾がそれぞれ自分の色で輪を出す**ので、
       半径のずれた同心の輪が4色ぶん重なる = 干渉して見える(0.6sのコマで確認)。 ---- */
    fx.ring({ x:p.x, y:p.y, r0:R*0.2, r1:R*2.8, life:0.55, color:deep, width:16, bright:1.05 });
    fx.ring({ x:p.x, y:p.y, r0:2,     r1:R*1.0, life:0.22, color:hot,  width:8,  bright:1.15 });
    // ---- 4段目: 残り火。上がってから落ちる色の粒。**1.8秒級で余韻を残す** ----
    fx.burst({ x:p.x, y:p.y, z:(p.z||0)+18, count:18, speed:110, jitter:R*0.4, jitterZ:40,
               elev:0.85, elevSpread:0.8, r:deep[0], g:deep[1], b:deep[2], bright:1.0,
               life:1.8, size0:14, size1:6, az:-80, turb:32, turbFreq:0.55, spin:1.4 });
  },

  /* ホーリーサンダー。稲妻そのものは2Dが描いているので、ここは**落雷の着地**を足す。
     伸びた距離ぶんだけ等間隔に落とすので、フレームレートが変わっても
     落ちる本数と間隔が変わらない(時間ではなく距離で刻む)。 */
  sustain(fx, ae, c, dt){
    const reach = fxAeReach(ae, dt);
    if(reach <= 2) return;
    /* #fff2b0 は (1.00, 0.95, 0.69) でほぼ白。k=2.2 では輪が「灰色の針金」に見えたので
       3.4まで振って琥珀にする(3周目のコマで確認)。芯の白との差はここで付ける。 */
    const viv = fxVivid(c), hot = fxHot(viv, 0.7), deep = fxDeep(viv, 3.4);
    const fwx = Math.cos(ae.angle||0), fwy = Math.sin(ae.angle||0);
    const rgx = -fwy, rgy = fwx;
    const amp = (ae.width||110)*0.5;
    const step = Math.max(90, amp*1.6);
    ae.__fxStrike = ae.__fxStrike || 0;
    while(reach - ae.__fxStrike > step){
      ae.__fxStrike += step;
      const lat = (Math.random()*2-1)*amp;
      const x = ae.x + fwx*ae.__fxStrike + rgx*lat;
      const y = ae.y + fwy*ae.__fxStrike + rgy*lat;
      const g = fxGroundZ(x, y);
      /* 着地の閃光。**輪だけだと「地面に描いた線」にしか見えない**(3周目のコマで確認)。
         大きく短命の粒を数個だけ重ねて、落ちた瞬間に地面が白く光るようにする。 */
      fx.burst({ x, y, z:g+8, count:6, speed:60, jitter:amp*0.5, jitterZ:10,
                 r:hot[0], g:hot[1], b:hot[2], bright:1.6,
                 life:0.13, size0:46, size1:18, az:0, turb:0, spin:0.6 });
      // 着地の白い火花。ほぼ真上へ跳ねて強い重力で落ちる = 短く鋭い
      fx.burst({ x, y, z:g+4, count:16, speed:250, jitter:8, jitterZ:6,
                 elev:1.1, elevSpread:0.55, r:hot[0], g:hot[1], b:hot[2], bright:1.9,
                 life:0.32, size0:14, size1:0.5, az:-460, turb:8, turbFreq:2.8, spin:6 });
      /* 焦げの輪を2枚。**内側は明るく細く、外側は色を濃く広く。**
         2周目は1枚だけ・半径 amp*1.5 で、遠くのコマでは点にしか見えなかった。 */
      fx.ring({ x, y, r0:3, r1:amp*1.2, life:0.24, color:hot,  width:7,  bright:1.1 });
      fx.ring({ x, y, r0:6, r1:amp*3.0, life:0.5,  color:deep, width:11, bright:0.95 });
    }
    // 走った跡で弾け続ける小さな電気(残り火)
    for(let i=fxSpawnN(dt, 34); i>0; i--){
      const along = reach*Math.random();
      const lat = (Math.random()*2-1)*amp;
      const x = ae.x + fwx*along + rgx*lat, y = ae.y + fwy*along + rgy*lat;
      fx.emit({ x, y, z:fxGroundZ(x,y)+4+Math.random()*16,
                vx:(Math.random()-0.5)*70, vy:(Math.random()-0.5)*70, vz:60+Math.random()*130,
                az:-300, r:deep[0], g:deep[1], b:deep[2], bright:1.2,
                life:0.35+Math.random()*0.35, size0:8+Math.random()*7, size1:0.5,
                turb:14, turbFreq:2.6, spin:5 });
    }
  },
};
/* <</FX:god>> */

/* <<FX:aqua>> */
/* =====================================================================
   水(ウンディーネ) — 水風船 / アクアウェイブ / クリスタルレイン
   ---------------------------------------------------------------------
   水らしさは「重さ」で出す。飛沫は必ず落とす(az を既定の -260 より強くする)。
   軽く漂う粒を混ぜると水ではなく煙になるので、漂わせるのは冷気だけにする。

   色: **リボンにも粒にも c をそのまま渡す。** fx_gl.js 側が
   粒の中心を白熱させ(FS の core 項)、リボンの先端を白へ寄せる(hot^3)ので、
   ここで fxHot を掛けると身まで白くなり「白い棒」になる(既定の見え方がそれ)。
   白へ寄せるのは、芯そのものを見せたい落下結晶と着弾の第一波だけ。

   波紋: 輪を1枚だけ出すと「輪が1つ」で終わる(採点表5が3点止まり)。
   **速さと寿命の違う輪を3枚**重ねると、時間が経つほど間隔が開いて波紋に見える。
===================================================================== */
/* 1フレームぶんの上限。**fx_gl.js の begin() は自分の時計しか頭打ちにしておらず、
   fly/sustain へ来る dt は素の値**なので、フレームが長引くと
   ・粒がまとめて何十個も出る
   ・落下中の結晶の帯が「空から地面まで一直線の白い柱」になる
   の2つが起きる(撮影ハーネスは1コマぶんをまとめて進めるので実際に出た)。
   時間の進みだけをここで頭打ちにする(演出が少し遅れるだけで、形は崩れない)。
   値は **fx_gl.js の begin() が自分の時計に掛けている上限と同じ 0.1** にする。
   ここだけ短くすると、粒(fx_gl側の時計)と落下の進み(こちらの時計)がずれる。
   【二重管理の注意】草にも同じ値を置いてある(LEAF_DT_MAX)。属性ごとのブロックは
   別々に統合されるので、片方だけ取り込んでも動くようにしている。 */
const AQUA_DT_MAX = 0.1;

const AQUA_G      = -520;   // 飛沫の重力。既定(-260)の2倍=水は重く、すぐ落ちる
const AQUA_MIST_G = -30;    // 冷気だけは例外。ほとんど落ちずに低くたなびく
const AQUA_RAIN_N = 4;      // クリスタルレインで同時に落ちている結晶の数
const AQUA_RAIN_H = 320;    // 結晶を落とし始める高さ(ワールド)
const AQUA_RAIN_T = 0.42;   // 落ちきるまでの秒

/* 範囲技が今どこまで伸びているか。2Dの芯(render.js の drawSingleAreaEffect)と
   同じ時間軸で出したいので matchTime を読む。粒だけが芯より先に進むのを防ぐ。
   ae 自身が持っている値(spawnAt/telegraphTime/fillSpeed/range)だけで計算するので、
   render.js の定数を写し取ってはいない。
   【二重管理の注意】草にも同じ関数を置いてある(leafReach)。属性ごとのブロックは
   別々に統合されるため、共有関数にせず各ブロックで完結させている。 */
function aquaReach(ae){
  if(typeof matchTime !== 'number') return ae.range || 0;
  const t = matchTime - (ae.spawnAt || 0) - (ae.telegraphTime || 0);
  if(t <= 0) return 0;
  return Math.min(ae.range || 0, t * (ae.fillSpeed || 900));
}

/* 落ちてきた結晶が砕けた瞬間。破片は強い重力で外へ跳ね、
   足元に小さな波紋を1枚残し、冷気がその場に留まる(発生→着地→残りの3段目)。 */
function aquaShatter(fx, x, y, c){
  const hot = fxHot(c, 0.7), mist = fxDim(c, 0.45);
  // 破片。上へ跳ねてから落ちる。寿命を短くして「割れた」の一瞬に集める
  fx.burst({ x, y, z:6, count:10, speed:200, jitter:8, jitterZ:6,
             elev:0.85, elevSpread:0.75, r:hot[0], g:hot[1], b:hot[2], bright:1.6,
             life:0.3, size0:12, size1:0.5, az:AQUA_G, turb:7, turbFreq:2.4, spin:9 });
  // 砕けた足元の小さな波紋。**技全体の輪より必ず細く暗く**(足すたびに画面が白む)
  fx.ring({ x, y, r0:3, r1:58, life:0.3, color:c, width:8, bright:0.8 });
  // 冷気。ここだけ重力を切って残す。これが無いと結晶が「消える」だけになる
  fx.burst({ x, y, z:4, count:4, speed:55, jitter:16, jitterZ:8,
             elev:0.3, elevSpread:0.5, r:mist[0], g:mist[1], b:mist[2], bright:0.5,
             life:0.95, size0:24, size1:8, az:AQUA_MIST_G, turb:28, turbFreq:0.6, spin:1 });
}

/* 落下中の結晶を1つ、新しい落下位置へ置き直す。
   位置は帯(ae.angle 方向・幅 ae.width)の中だけ。2Dの結晶の柱と同じ場所に降る。 */
function aquaRainRespawn(d, ae, reach){
  const a = ae.angle || 0;
  const fwdX = Math.cos(a), fwdY = Math.sin(a);
  const along = reach * (0.12 + Math.random()*0.88);
  const lat   = (Math.random()*2 - 1) * (ae.width || 200) * 0.42;
  d.x = ae.x + fwdX*along - fwdY*lat;
  d.y = ae.y + fwdY*along + fwdX*lat;
  d.t = AQUA_RAIN_T;
  d.gen++;
}

FX_MOVES.aqua = {
  cast(fx, ae, c){
    const hot = fxHot(c, 0.55), mist = fxDim(c, 0.4);
    /* 足元の輪。**射程いっぱいに広げない・白へ寄せない・太くしない。**
       加算合成なので、太い白い輪は画面を横切る帯になって地面の痕に見えなくなる
       (既定の見え方が r1=420/width=26 でまさにそうなっている)。 */
    fx.ring({ x:ae.x, y:ae.y, r0:12, r1:Math.min(ae.range || 300, 150), life:0.5,
              color:c, width:9, bright:0.48 });
    // 放出の頭。技の向きへ扇状に吹き出す水。重力で前方へ落ちる弧を描く
    fx.burst({ x:ae.x, y:ae.y, z:14, count:16, speed:320, jitter:14, jitterZ:18,
               angle:(ae.angle||0), spread:1.1, elev:0.5, elevSpread:0.55,
               r:hot[0], g:hot[1], b:hot[2], bright:1.35,
               life:0.4, size0:18, size1:1.5, az:AQUA_G, turb:9, turbFreq:2.0, spin:5 });
    // 押し出された水しぶき。色のまま、少し遅れて落ちる中間の層
    fx.burst({ x:ae.x, y:ae.y, z:10, count:24, speed:190, jitter:26, jitterZ:26,
               elev:0.45, elevSpread:0.8, r:c[0], g:c[1], b:c[2], bright:1.15,
               life:0.6, size0:22, size1:2, az:AQUA_G*0.6, turb:18, turbFreq:1.2, spin:3 });
    // 立ち上がる冷気。暗い縁の層。落ちないので余韻がここに残る
    fx.burst({ x:ae.x, y:ae.y, z:16, count:12, speed:110, jitter:34, jitterZ:40,
               elev:0.8, elevSpread:0.7, r:mist[0], g:mist[1], b:mist[2], bright:0.6,
               life:1.15, size0:30, size1:10, az:AQUA_MIST_G, turb:30, turbFreq:0.6, spin:1.2 });
  },

  fly(fx, p, c, dt){
    dt = Math.min(dt || 0, AQUA_DT_MAX);
    /* 軌跡。色は c のまま(先端の白熱は fx_gl.js が付ける)。
       太さは当たり判定から作る。**hitR を見た目のために読み替えない。** */
    fx.trail('p'+p.id, p.x, p.y, (p.z||0)+14,
             { color:c, width: Math.max(13, (p.hitR||10)*2.4), bright:1.15 });
    /* 【色の鞘】リボンは fx_gl.js が先端を白へ寄せるので、**そのままだと白い棒**にしか
       見えない(既定の見え方も1〜2周目のこれも同じ問題だった)。
       弾とほぼ同じ速度で流れる大きく淡い粒を毎フレーム置き、白いリボンの周りに
       技の色の層を作る。これで「白い芯 / 青緑の身 / 暗い縁」の3層が軌跡にも揃う。 */
    const hitR = p.hitR || 10;
    p._fxAqSh = (p._fxAqSh || 0) + dt * 55;
    let sh = Math.min(3, Math.floor(p._fxAqSh));
    p._fxAqSh -= sh;
    while(sh-- > 0){
      fx.emit({ x:p.x, y:p.y, z:(p.z||0)+14,
                vx:(p.vx||0)*0.82, vy:(p.vy||0)*0.82, vz:(p.vz||0)*0.82 - 20, az:-60,
                r:c[0], g:c[1], b:c[2], bright:0.8,
                life:0.2, size0:hitR*3.6, size1:hitR*1.4, turb:3, turbFreq:1.4 });
    }
    /* 後ろへこぼれる飛沫。速度の逆向きへ置いて重力で落とすと、
       弾が「水を撒きながら飛んでいる」ように見える(粒が真横に散ると煙になる)。
       個数は dt で積む。フレームが落ちても密度が変わらない。 */
    const sp = Math.hypot(p.vx||0, p.vy||0) || 1;
    const bx = -(p.vx||0)/sp, by = -(p.vy||0)/sp;
    const big = (p.hitR||10) >= 9;                       // t1(水風船)は太く、t2(連射)は控えめ
    p._fxAqAcc = (p._fxAqAcc || 0) + dt * (big ? 46 : 26);
    let n = Math.min(4, Math.floor(p._fxAqAcc));
    p._fxAqAcc -= n;
    const hot = fxHot(c, 0.35);
    while(n-- > 0){
      const back = 40 + Math.random()*90;
      fx.emit({ x:p.x + bx*6, y:p.y + by*6, z:(p.z||0) + 8 + Math.random()*14,
                vx: bx*back + (Math.random()-0.5)*70,
                vy: by*back + (Math.random()-0.5)*70,
                vz: 20 + Math.random()*70, az: AQUA_G,
                r:hot[0], g:hot[1], b:hot[2], bright:1.2,
                life:0.28 + Math.random()*0.24,
                size0: (big?9:6) + Math.random()*6, size1:0.5,
                turb:8, turbFreq:2.0, spin:6 });
    }
    // 通り道に残る霧。暗い第3層。落ちないので弾の通った線が少しの間残る
    if(Math.random() < dt*14){
      const mist = fxDim(c, 0.4);
      fx.emit({ x:p.x, y:p.y, z:(p.z||0)+10, vx:bx*30, vy:by*30, vz:16,
                az:AQUA_MIST_G, r:mist[0], g:mist[1], b:mist[2], bright:0.5,
                life:0.7 + Math.random()*0.4, size0:20 + Math.random()*10, size1:6,
                turb:26, turbFreq:0.7, spin:1 });
    }
  },

  impact(fx, p, c){
    const z = (p.z||0);
    const hot = fxHot(c, 0.65), mist = fxDim(c, 0.4);
    // splash が無い技(連射)でも輪が消えないよう、当たり判定から下限を作る
    const sp = Math.max(p.splash || 0, (p.hitR || 8) * 5);
    /* 波紋を3枚。**同じ輪を3枚重ねるのではなく、広がる速さと寿命を変える。**
       時間が経つほど互いの間隔が開くので、1枚の輪では出ない「水面」になる。
       内側だけ白へ寄せ、外の2枚は技の色のまま暗く置く(白い帯にしないため)。 */
    fx.ring({ x:p.x, y:p.y, r0:4,  r1:sp*0.55, life:0.20, color:hot, width:12, bright:1.25 });
    fx.ring({ x:p.x, y:p.y, r0:6,  r1:sp*1.15, life:0.38, color:c,   width:10, bright:0.95 });
    fx.ring({ x:p.x, y:p.y, r0:10, r1:sp*1.95, life:0.66, color:c,   width:7,  bright:0.6 });
    // 第一波。ほぼ真上へ立ち上がる水柱。速く立ち上げるため寿命を短く取る
    fx.burst({ x:p.x, y:p.y, z:z+6, count:16, speed:250, jitter:5, jitterZ:6,
               elev:1.15, elevSpread:0.45, r:hot[0], g:hot[1], b:hot[2], bright:1.7,
               life:0.26, size0:15, size1:0.5, az:AQUA_G, turb:5, turbFreq:2.6, spin:8 });
    // 外へ広がる水の膜。低い角度で速く、すぐ落ちる
    fx.burst({ x:p.x, y:p.y, z:z+4, count:20, speed:290, jitter:8,
               elev:0.18, elevSpread:0.3, r:c[0], g:c[1], b:c[2], bright:1.3,
               life:0.34, size0:13, size1:1, az:AQUA_G, turb:10, turbFreq:1.8, spin:4 });
    // 落ちてくる大粒。寿命を長く取って「余韻」を作る(0.6sのコマでまだ落ちている)
    fx.burst({ x:p.x, y:p.y, z:z+18, count:10, speed:160, jitter:16, jitterZ:18,
               elev:0.9, elevSpread:0.8, r:c[0], g:c[1], b:c[2], bright:1.0,
               life:0.75, size0:11, size1:2, az:AQUA_G*0.75, turb:14, turbFreq:1.0, spin:3 });
    // その場に残る冷気
    fx.burst({ x:p.x, y:p.y, z:z+10, count:7, speed:80, jitter:22, jitterZ:16,
               elev:0.5, elevSpread:0.7, r:mist[0], g:mist[1], b:mist[2], bright:0.55,
               life:1.0, size0:26, size1:9, az:AQUA_MIST_G, turb:30, turbFreq:0.6, spin:1 });
  },

  /* クリスタルレイン。2Dの芯は「地面から生える結晶の柱」と「降ってくる結晶」を描いていて、
     降った結晶が**落ちた先で何も起きない**のが一番の物足りなさだった。
     ここでは落下する結晶を自前で持ち駒として管理し、
     地面に着いた瞬間に必ず砕く(落下 → 着地 → 破片 → 冷気 がつながる)。
     持ち駒方式にしたのは、fx_gl.js に「遅延して出す」APIが無いため。
     ばら撒きにすると落下と破片が別々の場所で起きて、目が繋げられない。      */
  sustain(fx, ae, c, dt){
    dt = Math.min(dt || 0, AQUA_DT_MAX);
    const reach = aquaReach(ae);
    if(reach <= 4) return;
    let rain = ae._fxAquaRain;
    if(!rain){
      rain = ae._fxAquaRain = [];
      for(let i=0;i<AQUA_RAIN_N;i++){
        const d = { x:ae.x, y:ae.y, t:0, gen:0 };
        aquaRainRespawn(d, ae, reach);
        d.t = AQUA_RAIN_T * (i + 0.5) / AQUA_RAIN_N;   // 位相をずらす(一斉に落とさない)
        rain.push(d);
      }
    }
    for(let i=0;i<rain.length;i++){
      const d = rain[i];
      d.t -= dt;
      if(d.t <= 0){
        aquaShatter(fx, d.x, d.y, c);
        aquaRainRespawn(d, ae, reach);
        continue;                    // 置き直した直後は帯を張らない(空から地面へ線が走る)
      }
      // 高さは f^2。地面に近いほど速い=落下の加速に見える
      const f = d.t / AQUA_RAIN_T;
      /* 帯は**細く**。太くすると空から降りる白い柱になり、
         2Dの結晶の柱(芯)より目立って何の技か分からなくなる(1周目がそれ)。
         先端の白熱は fx_gl.js が付けるので、ここで渡すのは技の色のまま。 */
      fx.trail('aqRain'+ae.id+'_'+i+'_'+d.gen, d.x, d.y, AQUA_RAIN_H*f*f,
               { color:c, width:5, bright:0.88 });
    }
    // 帯の上を這う冷気。柱の根元をつなぐ「暗い縁」の層で、帯の輪郭がここで見える
    if(Math.random() < dt*22){
      const a = ae.angle || 0;
      const fwdX = Math.cos(a), fwdY = Math.sin(a);
      const along = reach * Math.random();
      const lat = (Math.random()*2 - 1) * (ae.width || 200) * 0.5;
      const mist = fxDim(c, 0.4);
      const side = Math.sign(lat || 1) * (20 + Math.random()*40);
      fx.emit({ x: ae.x + fwdX*along - fwdY*lat, y: ae.y + fwdY*along + fwdX*lat,
                z: 2 + Math.random()*14,
                vx: -fwdY*side, vy: fwdX*side, vz: 12 + Math.random()*26,
                az: AQUA_MIST_G, r:mist[0], g:mist[1], b:mist[2], bright:0.5,
                life: 1.0 + Math.random()*0.6, size0: 26 + Math.random()*18, size1:10,
                turb:30, turbFreq:0.5, spin:0.8 });
    }
  },
};
/* <</FX:aqua>> */

/* <<FX:leaf>> */
/* =====================================================================
   草(モッチー) — 種 / 種マシンガン / フラワービーム
   ---------------------------------------------------------------------
   草らしさは「軽さ」で出す。水と正反対に、重力をほぼ切って(LEAF_G)
   乱流を大きく取る(LEAF_TURB)。まっすぐ飛ぶ粒は草に見えない。
   spin も大きく取り、粒を回して葉が裏返るように見せる。

   着弾は**下から上へ咲かせる**。水の着弾が「外へ広がる波紋」なのに対し、
   草は「その場から立ち上がる」。同じ粒でもこの2つで属性の差が付く。

   フラワービームの2Dの芯(fx3dBeamTube)は筒の中が白飛びしているので、
   **筒の中に明るい粒を足さない。** 足すのは筒の縁から漏れる胞子と、
   先端で咲く花だけにする(足すほど白い塊になり、3本のシルエットが潰れる)。 */
/* 1フレームぶんの上限。水の AQUA_DT_MAX と同じ理由・同じ値。
   fx_gl.js の begin() が自分の時計に掛けている上限に合わせてある。
   属性ごとのブロックを別々に統合できるよう、共有せず各ブロックで持つ。 */
const LEAF_DT_MAX = 0.1;

const LEAF_G     = -70;    // 葉の重力。既定(-260)の1/4以下。ゆっくり舞い落ちる
const LEAF_UP    = 25;     // 胞子だけは正の加速度。ふわりと上がり続ける
const LEAF_TURB  = 38;     // 乱流。大きく曲がるほど「風に舞う葉」に見える

/* aquaReach と同じ。属性ごとのブロックは別々に統合されるので共有関数にしない
   (統合の順番で片方が消えると、もう片方が落ちるため) */
function leafReach(ae){
  if(typeof matchTime !== 'number') return ae.range || 0;
  const t = matchTime - (ae.spawnAt || 0) - (ae.telegraphTime || 0);
  if(t <= 0) return 0;
  return Math.min(ae.range || 0, t * (ae.fillSpeed || 900));
}

/* 下から上へ咲く。着弾にもビームの先端にも使う共通の形。
   ・中心から真上へ立ち上がる茎(細く速く、寿命は短い)
   ・その上で外へ開く花びら(遅く、重力がほぼ無いので開いたまま留まる)
   ・地面を這う葉(低く外へ、乱流で曲がる)
   scale で大きさだけ変え、形は変えない(技が違っても同じ「咲く」に見せる)。 */
function leafBloom(fx, x, y, z, c, scale){
  const hot = fxHot(c, 0.6), dark = fxDim(c, 0.42);
  // 茎: ほぼ真上。速く立ち上げて先に消す
  fx.burst({ x, y, z:z+4, count:10, speed:210*scale, jitter:4, jitterZ:4,
             elev:1.3, elevSpread:0.3, r:hot[0], g:hot[1], b:hot[2], bright:1.6,
             life:0.24, size0:12*scale, size1:0.5, az:-200, turb:5, turbFreq:2.2, spin:4 });
  // 花びら: 上で開く。重力が弱いので開いたまま漂い、余韻がここに残る
  fx.burst({ x, y, z:z+16*scale, count:16, speed:150*scale, jitter:10, jitterZ:14,
             elev:0.85, elevSpread:0.9, r:c[0], g:c[1], b:c[2], bright:1.2,
             life:1.05, size0:17*scale, size1:4, az:LEAF_G, turb:LEAF_TURB, turbFreq:0.9, spin:5 });
  // 地面を這う葉: 低く外へ。乱流で曲がるので直線的に散らない
  fx.burst({ x, y, z:z+3, count:12, speed:200*scale, jitter:10,
             elev:0.12, elevSpread:0.25, r:dark[0], g:dark[1], b:dark[2], bright:0.8,
             life:0.7, size0:15*scale, size1:5, az:LEAF_G, turb:LEAF_TURB*0.8, turbFreq:1.1, spin:7 });
}

FX_MOVES.leaf = {
  cast(fx, ae, c){
    const dark = fxDim(c, 0.42);
    // 足元の輪。水と同じく細く暗く、射程いっぱいには広げない
    fx.ring({ x:ae.x, y:ae.y, r0:12, r1:Math.min(ae.range || 300, 160), life:0.55,
              color:c, width:9, bright:0.42 });
    // 足元から咲く。ビームは筒が白飛びしているので、頭は控えめ(scale 0.9)に留める
    leafBloom(fx, ae.x, ae.y, 6, c, 0.9);
    /* 巻き上がる葉。上昇気流に乗せ、乱流を最大に取る。
       az を正にしているのはここだけ = 「舞い上がる」もの。 */
    fx.burst({ x:ae.x, y:ae.y, z:12, count:20, speed:120, jitter:36, jitterZ:44,
               elev:0.9, elevSpread:0.8, r:dark[0], g:dark[1], b:dark[2], bright:0.75,
               life:1.2, size0:20, size1:6, az:LEAF_UP, turb:LEAF_TURB, turbFreq:0.7, spin:3 });
  },

  fly(fx, p, c, dt){
    dt = Math.min(dt || 0, LEAF_DT_MAX);
    /* 軌跡。種は硬く小さいので水より細くする(太さの差で属性が読み分けられる)。 */
    fx.trail('p'+p.id, p.x, p.y, (p.z||0)+14,
             { color:c, width: Math.max(11, (p.hitR||10)*2.0), bright:1.05 });
    /* 【色の鞘】狙いは水と同じ(白いリボンの周りに技色の層を作る)。
       ただし種は小さく硬いので、水より**細く・短く**して芯を強調する。 */
    const hitR = p.hitR || 10;
    p._fxLfSh = (p._fxLfSh || 0) + dt * 50;
    let sh = Math.min(3, Math.floor(p._fxLfSh));
    p._fxLfSh -= sh;
    while(sh-- > 0){
      fx.emit({ x:p.x, y:p.y, z:(p.z||0)+14,
                vx:(p.vx||0)*0.85, vy:(p.vy||0)*0.85, vz:(p.vz||0)*0.85, az:-30,
                r:c[0], g:c[1], b:c[2], bright:0.7,
                life:0.16, size0:hitR*2.8, size1:hitR*1.1, turb:3, turbFreq:1.4 });
    }
    const sp = Math.hypot(p.vx||0, p.vy||0) || 1;
    const bx = -(p.vx||0)/sp, by = -(p.vy||0)/sp;
    const big = (p.hitR||10) >= 9;                        // t1(種)は太く、t2(マシンガン)は控えめ
    p._fxLfAcc = (p._fxLfAcc || 0) + dt * (big ? 40 : 24);
    let n = Math.min(4, Math.floor(p._fxLfAcc));
    p._fxLfAcc -= n;
    while(n-- > 0){
      /* こぼれる葉。重力をほぼ切って乱流と回転を大きく取るので、
         後ろへ流れながら大きく曲がって残る = 水の飛沫と一目で見分けが付く。 */
      fx.emit({ x:p.x + bx*6, y:p.y + by*6, z:(p.z||0) + 8 + Math.random()*16,
                vx: bx*(30 + Math.random()*60) + (Math.random()-0.5)*80,
                vy: by*(30 + Math.random()*60) + (Math.random()-0.5)*80,
                vz: 10 + Math.random()*50, az: LEAF_G,
                r:c[0], g:c[1], b:c[2], bright:1.1,
                life:0.55 + Math.random()*0.4,
                size0:(big?12:8) + Math.random()*6, size1:3,
                turb:LEAF_TURB, turbFreq:1.0, spin:7 });
    }
    // 漂う胞子。上がり続ける暗い層。通り道が空中にうっすら残る
    if(Math.random() < dt*12){
      const dark = fxDim(c, 0.4);
      fx.emit({ x:p.x, y:p.y, z:(p.z||0)+12, vx:bx*20, vy:by*20, vz:20 + Math.random()*30,
                az:LEAF_UP, r:dark[0], g:dark[1], b:dark[2], bright:0.5,
                life:1.1 + Math.random()*0.5, size0:16 + Math.random()*10, size1:6,
                turb:LEAF_TURB, turbFreq:0.6, spin:2 });
    }
  },

  impact(fx, p, c){
    const z = (p.z||0);
    const dark = fxDim(c, 0.42);
    const sp = Math.max(p.splash || 0, (p.hitR || 8) * 5);
    // 咲く。大きさだけ当たり判定から決め、形は cast と同じ
    leafBloom(fx, p.x, p.y, z, c, Math.max(0.75, Math.min(1.35, sp/72)));
    /* 地面の輪は2枚。水(3枚の波紋)より少なくして、
       草は「輪が広がる」より「立ち上がる」技だと読ませる。 */
    fx.ring({ x:p.x, y:p.y, r0:5, r1:sp*0.95, life:0.30, color:fxHot(c,0.4), width:11, bright:1.1 });
    fx.ring({ x:p.x, y:p.y, r0:8, r1:sp*1.6,  life:0.78, color:c,             width:7,  bright:0.6 });
    // 舞い上がる胞子。0.6sのコマでまだ上がっている=余韻
    fx.burst({ x:p.x, y:p.y, z:z+14, count:9, speed:70, jitter:20, jitterZ:20,
               elev:0.95, elevSpread:0.7, r:dark[0], g:dark[1], b:dark[2], bright:0.55,
               life:1.25, size0:20, size1:7, az:LEAF_UP, turb:LEAF_TURB, turbFreq:0.55, spin:2 });
  },

  /* フラワービーム。筒の中には足さず、**縁**と**先端**だけを受け持つ。
     ・縁から漏れる胞子: 筒の外へ押し出され、上昇気流に乗って離れていく
     ・先端で咲く花: ビームには着弾(impact)が無いので、当たっている先が
       何も起きないまま伸びるだけになる。ここで咲かせて終点を作る。      */
  sustain(fx, ae, c, dt){
    dt = Math.min(dt || 0, LEAF_DT_MAX);
    const fill = leafReach(ae);
    if(fill <= 4) return;
    const count = Math.max(1, ae.beamCount || 3);
    const spread = (ae.beamSpreadDeg || 40) * Math.PI / 180;
    const halfW = (ae.width || 100) * 0.5;
    /* 筒のおおよその中心の高さ。**render.js の式を写さず**、ビームの太さから作る。
       胞子は筒から離れていくものなので、芯とぴったり合っている必要はない。 */
    const coreZ = Math.max(34, halfW * 0.9);
    const beamAt = (b)=> (ae.angle || 0) + (count > 1 ? (b/(count-1) - 0.5) * spread : 0);
    const beamMax = (b)=> (ae.beamRanges && ae.beamRanges[b]) || ae.range || 0;
    const dark = fxDim(c, 0.45);

    // ---- 縁から漏れる胞子 ----
    ae._fxLeafAcc = (ae._fxLeafAcc || 0) + dt * 26 * count;
    let n = Math.min(6, Math.floor(ae._fxLeafAcc));
    ae._fxLeafAcc -= n;
    while(n-- > 0){
      const b = Math.floor(Math.random()*count);
      const a = beamAt(b);
      const fwdX = Math.cos(a), fwdY = Math.sin(a);
      const reach = Math.min(beamMax(b), fill);
      if(reach <= 4) continue;
      const along = reach * (0.15 + Math.random()*0.85);
      const s = Math.random() < 0.5 ? -1 : 1;              // どちらの縁から漏らすか
      const lat = s * halfW * (0.85 + Math.random()*0.3);
      /* 半分は筒に貼り付いたまま(縁の層)、半分は離れて舞い上がる(二次運動)。
         全部を上げてしまうと、ビームから切り離された蛍の群れにしか見えない
         (2周目がそれだった)。貼り付く側があって初めて筒の輪郭が出る。 */
      const cling = Math.random() < 0.6;   // 貼り付く側を多めに=筒の輪郭が出る
      const out = cling ? (6 + Math.random()*14) : (30 + Math.random()*50);
      fx.emit({ x: ae.x + fwdX*along - fwdY*lat, y: ae.y + fwdY*along + fwdX*lat,
                z: coreZ + (Math.random()*2 - 1) * halfW * 0.7,
                // 筒の外へ押し出される。前後の速度は持たせない(ビームは動かないため)
                vx: -fwdY * s * out, vy: fwdX * s * out,
                vz: cling ? (2 + Math.random()*12) : (25 + Math.random()*45),
                az: cling ? 0 : LEAF_UP,
                r:dark[0], g:dark[1], b:dark[2], bright: cling ? 0.62 : 0.45,
                life: cling ? (0.5 + Math.random()*0.4) : (0.9 + Math.random()*0.7),
                size0: cling ? (22 + Math.random()*14) : (18 + Math.random()*16),
                size1: cling ? 10 : 7,
                turb: cling ? 10 : LEAF_TURB, turbFreq:0.7, spin: cling ? 1.5 : 3 });
    }

    // ---- 先端で咲く花。1本ずつ順に咲かせる(3本同時だと先端が1つの塊になる) ----
    ae._fxLeafTip = (ae._fxLeafTip || 0) + dt * 9;
    if(ae._fxLeafTip >= 1){
      ae._fxLeafTip -= 1;
      const b = (ae._fxLeafTipN = ((ae._fxLeafTipN || 0) + 1) % count);
      const a = beamAt(b);
      const reach = Math.min(beamMax(b), fill);
      if(reach > 8){
        const tx = ae.x + Math.cos(a)*reach, ty = ae.y + Math.sin(a)*reach;
        leafBloom(fx, tx, ty, 0, c, 1.0);
      }
    }
  },
};
/* <</FX:leaf>> */


window.__aramonFxMoves  = FX_MOVES;
window.__aramonFxDefault = FX_DEFAULT;
