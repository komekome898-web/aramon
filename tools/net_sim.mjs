/* ネットコード計測ランナー(開発用。ゲームには読み込まない)。
   tools/net_probe.html をヘッドレスChromiumで開き、RTT条件ごとにマルチ対戦を1試合
   自動で回して5指標を集計し、JSONで出力する。

   使い方:
     node tools/net_sim.mjs                        … 既定(片道25/75/150ms、ジッタ±30%、欠落0)
     node tools/net_sim.mjs --conditions 75,150    … 条件を指定
     node tools/net_sim.mjs --jitter 0.3 --loss 0.02 --seed 20260814
     node tools/net_sim.mjs --out tools/net_baseline.json

   指標の読み方:
     selfCorr     … ゲスト自機の位置補正(引き戻し)。totalPx=補正で動かされた総距離。
                    pullback*=進行方向と逆向きの補正(=体感の「引き戻し」)の回数と距離。
                    テレポート直後の整定窓は除外済み。
     fireToProj   … ゲストが撃った瞬間(fireEventのts)→ホスト側で実弾が生成されるまでのms。
     dmgToDisplay … ホストでHP減少が確定→ゲスト画面のHPが減るまでのms(authState反映)。
     remoteSmooth … ゲストから見た遠隔エンティティ(=ホスト機)のフレーム間移動距離。
                    p95/max と、実効移動速度×フレーム時間に対する倍率(ratio)。1近辺=等速で滑らか。
     symmetry     … 同時に撃ち合いを始めてから「最初の被弾」までの時間をホスト側/ゲスト側で比較。
                    diffMs>0 はゲストの攻撃が遅れて通っている(ホスト有利)ことを示す。
                    kill はどちらが先に倒したかと、連続射撃開始からの所要ms。 */
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
}
if(!chromium){
  console.error('playwrightが見つかりません(npm i -g playwright)。');
  process.exit(1);
}

const args = process.argv.slice(2);
const opt = (name, def)=>{ const i = args.indexOf('--'+name); return i>=0 && args[i+1] ? args[i+1] : def; };
const CONDITIONS = opt('conditions', '25,75,150').split(',').map(s=>Number(s.trim())).filter(n=>n>0);
const JITTER = Number(opt('jitter', '0.3'));
const LOSS   = Number(opt('loss', '0'));
const SEED   = Number(opt('seed', '20260814'));
const RTC    = args.includes('--rtc');   // WebRTCシグナリング橋を有効化(rtc昇格の上限性能)
const OUT    = path.resolve(opt('out', path.join(ROOT, 'tools', 'net_baseline.json')));
const TIMEOUT_MS = Number(opt('timeout', '150000'));

/* --- リポジトリを配る小さなHTTPサーバー(依存なし) --- */
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
               '.webp':'image/webp', '.mp3':'audio/mpeg', '.mp4':'video/mp4', '.webm':'video/webm' };
const server = http.createServer((req, res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel || 'index.html');
  if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r=> server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

/* --- 集計ヘルパー --- */
const r1 = (v)=> Math.round(v*10)/10;
function percentile(sorted, p){
  if(!sorted.length) return null;
  const idx = Math.min(sorted.length-1, Math.floor(sorted.length * p));
  return sorted[idx];
}
function stats(arr){
  if(!arr.length) return { count:0, avg:null, max:null, min:null };
  const s = arr.reduce((a,b)=>a+b, 0);
  return { count: arr.length, avg: r1(s/arr.length), max: r1(Math.max(...arr)), min: r1(Math.min(...arr)) };
}

/* --- 1試合ぶんの生データ → 5指標 --- */
function analyze(result){
  const cfg = result.cfg;
  const H = result.host, G = result.guest;
  const hostEntId = H.myEntId, guestEntId = G.myEntId;
  // テレポート(決闘配置)直後の整定窓は位置系の指標から除外する
  const excl = (mt)=> mt >= cfg.tMoveEnd - 0.1 && mt <= cfg.tDuelStart + 1.5;

  // ① ゲスト自機の引き戻し量
  const sc = G.marks.filter(m=>m.type==='selfCorr' && !excl(m.mt));
  let totalPx = 0, movePx = 0, pullbackPx = 0, maxSinglePx = 0;
  let pullbackEvents = 0, inPullback = false, lastPullMt = -10;
  for(const m of sc){
    const len = Math.hypot(m.sx, m.sy);
    totalPx += len;
    if(m.mt >= cfg.tMoveStart && m.mt < cfg.tMoveEnd) movePx += len;
    if(len > maxSinglePx) maxSinglePx = len;
    const ml = Math.hypot(m.mx, m.my);
    if(ml > 0.1){
      const dot = (m.sx*m.mx + m.sy*m.my) / ml;   // 進行方向成分(負=引き戻し)
      if(dot < -0.05){
        pullbackPx += -dot;
        if(!inPullback || m.mt - lastPullMt > 0.25) pullbackEvents++;
        inPullback = true; lastPullMt = m.mt;
      } else inPullback = false;
    } else inPullback = false;
  }
  const moveDur = cfg.tMoveEnd - cfg.tMoveStart;
  const selfCorr = {
    frames: sc.length, totalPx: r1(totalPx),
    movePhasePx: r1(movePx), movePhasePxPerSec: r1(movePx / moveDur),
    pullbackEvents, pullbackPx: r1(pullbackPx), maxSinglePx: r1(maxSinglePx),
  };

  // ② 発射→実弾の遅延(ゲスト発射のみ。srcTs=ゲストが送信した時刻)
  const spawns = H.marks.filter(m=>m.type==='remoteFireSpawn' && m.srcTs > 0);
  const fireDelays = spawns.map(m=> m.now - m.srcTs);
  const fireSentCount = G.marks.filter(m=>m.type==='fireSent').length;
  const fireToProj = { ...stats(fireDelays), guestFireSent: fireSentCount, hostSpawned: spawns.length };

  // ③ 被弾→表示の遅延(ホストのダメージ確定 → ゲストで同エンティティのHPが減る)
  const dmgs = H.marks.filter(m=>m.type==='dmg').sort((a,b)=>a.ts-b.ts);
  const drops = G.marks.filter(m=>m.type==='hpDrop').sort((a,b)=>a.ts-b.ts).map(m=>({ ...m, used:false }));
  const dispDelays = [];
  for(const d of dmgs){
    const hit = drops.find(x=> !x.used && x.id===d.id && x.hp <= d.hp + 0.6 && x.ts >= d.ts - 10);
    if(hit){ hit.used = true; dispDelays.push(hit.ts - d.ts); }
  }
  const dmgToDisplay = { ...stats(dispDelays), hostDmgEvents: dmgs.length, guestHpDrops: drops.length };

  // ④ 遠隔エンティティの滑らかさ(ゲストから見たホスト機のフレーム間移動距離)。
  //    相手が実際に動いている移動フェーズだけを対象にする(決闘中は両者静止のため)
  const sm = G.smooth.filter(s=> s.dt < 0.25 && s.mt >= cfg.tMoveStart && s.mt < cfg.tMoveEnd);
  const dArr = sm.map(s=>s.d).sort((a,b)=>a-b);
  const ratios = sm.filter(s=>s.spd > 1).map(s=> s.d / (s.spd * s.dt)).sort((a,b)=>a-b);
  const remoteSmooth = {
    samples: sm.length,
    p50px: r1(percentile(dArr, 0.50) ?? 0), p95px: r1(percentile(dArr, 0.95) ?? 0),
    maxPx: r1(dArr.length ? dArr[dArr.length-1] : 0),
    p95ratio: ratios.length ? r1(percentile(ratios, 0.95)) : null,
    maxRatio: ratios.length ? r1(ratios[ratios.length-1]) : null,
  };

  // ⑤ 対称性(両者同時に連続射撃を開始してから、最初の被弾まで/キル成立まで)
  const phaseTs = (agent, name)=>{ const p = agent.phases.find(x=>x.name===name); return p ? p.ts : null; };
  const duelTs = phaseTs(H, 'duel');   // ホスト(権威側)の決闘開始時刻を基準にする
  const h2g = dmgs.filter(m=> m.src===hostEntId && m.id===guestEntId);
  const g2h = dmgs.filter(m=> m.src===guestEntId && m.id===hostEntId);
  const firstAfter = (list, t0)=>{ if(t0==null) return null; const m = list.find(x=>x.ts>=t0); return m ? m.ts - t0 : null; };
  const death = H.deaths.length ? H.deaths[0] : null;
  const sumBy = (list, untilTs)=> r1(list.filter(m=> untilTs==null || m.ts<=untilTs).reduce((a,m)=>a+(m.dmg||0),0));
  const symmetry = {
    hostFirstHitMs: firstAfter(h2g, duelTs),
    guestFirstHitMs: firstAfter(g2h, duelTs),
    diffMs: (firstAfter(h2g, duelTs)!=null && firstAfter(g2h, duelTs)!=null)
      ? r1(firstAfter(g2h, duelTs) - firstAfter(h2g, duelTs)) : null,
    winner: death ? (death.id===guestEntId ? 'host' : 'guest') : null,
    killAfterDuelMs: (death && duelTs!=null) ? Math.max(0, death.ts - duelTs) : null,
    hostDmgDealtAtKill: sumBy(h2g, death && death.ts),
    guestDmgDealtAtKill: sumBy(g2h, death && death.ts),
  };

  return {
    oneway: cfg.oneway, jitter: cfg.jitter, loss: cfg.loss, seed: cfg.seed,
    boot: { ok: true, ...result.timing },
    fps: { host: r1(H.frames / Math.max(0.001, H.durMs/1000)), guest: r1(G.frames / Math.max(0.001, G.durMs/1000)) },
    selfCorr, fireToProj, dmgToDisplay, remoteSmooth, symmetry,
    bus: result.busStats,
    errors: { host: H.errors.slice(0,10), guest: G.errors.slice(0,10), bus: (result.busErrors||[]).slice(0,10) },
  };
}

/* --- 実行 --- */
const browser = await chromium.launch({
  executablePath: fs.existsSync('/opt/pw-browsers/chromium/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium/chrome-linux/chrome' : undefined,
  // SwiftShaderのvsyncはrAFを約20fpsに縛る。ネットコード計測は実時間で回したいので外す
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});

const report = { generatedAt: new Date().toISOString(), seed: SEED, jitter: JITTER, loss: LOSS, conditions: [] };
let failed = 0;

for(const oneway of CONDITIONS){
  const url = `${ORIGIN}/tools/net_probe.html?oneway=${oneway}&jitter=${JITTER}&loss=${LOSS}&seed=${SEED}${RTC?'&rtc=1':''}`;
  process.stderr.write(`[net_sim] oneway=${oneway}ms を計測中...\n`);
  const page = await browser.newPage({ viewport: { width: 1280, height: 420 } });
  const pageErrors = [];
  page.on('pageerror', e=> pageErrors.push(String(e)));
  try{
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(()=> !!window.__probeResult, null, { timeout: TIMEOUT_MS });
    const raw = await page.evaluate(()=> window.__probeResult);
    if(!raw.ok) throw new Error('probe failed: ' + raw.error);
    const summary = analyze(raw);
    summary.pageErrors = pageErrors.slice(0, 10);
    report.conditions.push(summary);
    process.stderr.write(`[net_sim]   完了 (試合開始まで ${summary.boot.bootMs + summary.boot.matchStartMs}ms, 全体 ${summary.boot.totalMs}ms)\n`);
  }catch(err){
    failed++;
    report.conditions.push({ oneway, ok:false, error: String(err && err.message || err), pageErrors: pageErrors.slice(0,10) });
    process.stderr.write(`[net_sim]   失敗: ${err}\n`);
  }finally{
    await page.close();
  }
}

await browser.close();
server.close();

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
process.stderr.write(`[net_sim] 結果を保存: ${OUT}\n`);

/* 要約を1条件1ブロックで出す */
for(const c of report.conditions){
  if(c.ok === false){ console.log(`oneway=${c.oneway}ms: 失敗 (${c.error})`); continue; }
  console.log(`--- 片道${c.oneway}ms (jitter±${c.jitter*100}% loss=${c.loss}) ---`);
  console.log(`  fps: host=${c.fps.host} guest=${c.fps.guest}  bus: 配信${c.bus.delivered}件/欠落${c.bus.dropped}件`);
  console.log(`  ①引き戻し: 補正総量${c.selfCorr.totalPx}px (移動中${c.selfCorr.movePhasePx}px=${c.selfCorr.movePhasePxPerSec}px/s) 逆行${c.selfCorr.pullbackEvents}回/${c.selfCorr.pullbackPx}px 最大1F${c.selfCorr.maxSinglePx}px`);
  console.log(`  ②発射→実弾: 平均${c.fireToProj.avg}ms 最悪${c.fireToProj.max}ms (${c.fireToProj.hostSpawned}/${c.fireToProj.guestFireSent}発)`);
  console.log(`  ③被弾→表示: 平均${c.dmgToDisplay.avg}ms 最悪${c.dmgToDisplay.max}ms (突合${c.dmgToDisplay.count}/${c.dmgToDisplay.hostDmgEvents}件)`);
  console.log(`  ④滑らかさ: フレーム間移動 p50=${c.remoteSmooth.p50px}px p95=${c.remoteSmooth.p95px}px 最大=${c.remoteSmooth.maxPx}px (対理論比 p95=${c.remoteSmooth.p95ratio} 最大=${c.remoteSmooth.maxRatio})`);
  console.log(`  ⑤対称性: 初被弾 ホスト攻撃${c.symmetry.hostFirstHitMs}ms / ゲスト攻撃${c.symmetry.guestFirstHitMs}ms (差${c.symmetry.diffMs}ms) 勝者=${c.symmetry.winner} キル所要${c.symmetry.killAfterDuelMs}ms 与ダメ H${c.symmetry.hostDmgDealtAtKill}/G${c.symmetry.guestDmgDealtAtKill}`);
}
process.exit(failed ? 1 : 0);
