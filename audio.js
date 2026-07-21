/* =====================================================================
   AUDIO (BGM / SE)
   すべてWeb Audio APIで合成する(外部音源ファイルなし・ビルドレス維持)。
   - 初回のユーザー操作でAudioContextを起動(iOS Safariの自動再生制限対応)
   - BGM: タイトル(のどかな牧場) / 試合中(残り人数で段階変化) / 残り5人以下(壮大)
   - SE: 負荷対策として自分の操作モンスターに関わる音のみ鳴らす
===================================================================== */

// ===== 音量設定(localStorage永続化) =====
const AUDIO_SETTINGS_KEY = 'aramon_audio_v1';
let audioSettings = { bgm: 0.5, se: 0.7 };
try {
  const saved = JSON.parse(localStorage.getItem(AUDIO_SETTINGS_KEY));
  if(saved && typeof saved.bgm==='number' && typeof saved.se==='number'){
    audioSettings = { bgm: Math.min(1,Math.max(0,saved.bgm)), se: Math.min(1,Math.max(0,saved.se)) };
  }
} catch(e){}
function saveAudioSettings(){
  try { localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(audioSettings)); } catch(e){}
}

let actx = null, seGain = null, bgmGain = null, bgmTrackGain = null;
function applyAudioVolumes(){
  if(seGain) seGain.gain.value = audioSettings.se;
  if(bgmGain) bgmGain.gain.value = audioSettings.bgm;
}
function audioInit(){
  if(actx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if(!AC) return;
  actx = new AC();
  seGain = actx.createGain(); seGain.connect(actx.destination);
  bgmGain = actx.createGain(); bgmGain.connect(actx.destination);
  bgmTrackGain = actx.createGain(); bgmTrackGain.gain.value = 1; bgmTrackGain.connect(bgmGain);
  applyAudioVolumes();
  startBgmScheduler();
}
// 初回のタップ/クリック/キーで起動+復帰(iOSはユーザー操作が無いと音が出せない)
['pointerdown','touchend','keydown'].forEach(ev=>{
  window.addEventListener(ev, ()=>{
    audioInit();
    if(actx && actx.state==='suspended') actx.resume();
  }, {capture:true, passive:true});
});
// バックグラウンドでは停止(電池・音の積み残し対策)
document.addEventListener('visibilitychange', ()=>{
  if(!actx) return;
  if(document.hidden) actx.suspend();
  else actx.resume();
});

// ===== SE =====
// 同じSEの最低再生間隔(秒)。連打・毎フレーム呼び出しでの音割れ防止
const SE_MIN_GAP = { tap:0.05, jakiin:0.25, train:0.3, pickup:0.1, fire:0.06, hitTaken:0.12, noGuts:0.5, kill:0.15, fanfare:1.5, sad:1.5,
  fireRoar:0.3, iceCrack:0.3, tornado:0.3, spin:0.25, beam:0.3, whoosh:0.2, bell:0.3 };
const seLastAt = {};
// 技SEは他のSEより一回り大きく鳴らす(名前ごとの音量倍率)
const SE_VOL_BOOST = { fire:1.35, fireRoar:1.35, iceCrack:1.35, tornado:1.35, spin:1.35, beam:1.35, whoosh:1.35, bell:1.35 };
let seCurrentBoost = 1;
function playSe(name, opts){
  if(!actx || audioSettings.se<=0.005) return;
  const now = actx.currentTime;
  if(seLastAt[name]!=null && now - seLastAt[name] < (SE_MIN_GAP[name]||0.05)) return;
  seLastAt[name] = now;
  const fn = SE_DEFS[name];
  if(fn){
    seCurrentBoost = SE_VOL_BOOST[name] || 1;
    fn(now, opts||{});
    seCurrentBoost = 1;
  }
}
function seTone(t, o){
  const osc = actx.createOscillator(), g = actx.createGain();
  const dur = o.dur||0.15;
  osc.type = o.type||'sine';
  osc.frequency.setValueAtTime(o.freq||440, t);
  if(o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(o.freqEnd,1), t+dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime((o.vol!=null?o.vol:0.5)*seCurrentBoost, t+(o.attack||0.005));
  g.gain.exponentialRampToValueAtTime(0.001, t+dur);
  osc.connect(g); g.connect(seGain);
  osc.start(t); osc.stop(t+dur+0.05);
}
function seNoise(t, o){
  const dur = o.dur||0.2;
  const len = Math.max(1, Math.floor(actx.sampleRate*dur));
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const d = buf.getChannelData(0);
  for(let i=0;i<len;i++) d[i] = Math.random()*2-1;
  const src = actx.createBufferSource(); src.buffer = buf;
  const f = actx.createBiquadFilter();
  f.type = o.filterType||'lowpass';
  f.frequency.setValueAtTime(o.filterFreq||1000, t);
  if(o.filterEnd) f.frequency.exponentialRampToValueAtTime(Math.max(o.filterEnd,10), t+dur);
  const g = actx.createGain();
  g.gain.setValueAtTime((o.vol!=null?o.vol:0.4)*seCurrentBoost, t);
  g.gain.exponentialRampToValueAtTime(0.001, t+dur);
  src.connect(f); f.connect(g); g.connect(seGain);
  src.start(t); src.stop(t+dur+0.05);
}
// ループノイズ+音量LFO(揺らぎ)付きのノイズ再生。炎や竜巻など長い持続音に使う
function seNoiseLfo(t, o){
  const dur = o.dur||1;
  const len = Math.max(1, Math.floor(actx.sampleRate*Math.min(dur,1.5)));
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const d = buf.getChannelData(0);
  for(let i=0;i<len;i++) d[i] = Math.random()*2-1;
  const src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
  const f = actx.createBiquadFilter();
  f.type = o.filterType||'lowpass';
  f.frequency.setValueAtTime(o.filterFreq||800, t);
  if(o.filterEnd) f.frequency.exponentialRampToValueAtTime(Math.max(o.filterEnd,10), t+dur);
  const g = actx.createGain();
  const v0 = (o.volStart!=null ? o.volStart : (o.vol||0.4)) * seCurrentBoost;
  const vEnd = o.volEnd!=null ? o.volEnd*seCurrentBoost : null;
  g.gain.setValueAtTime(Math.max(v0,0.001), t);
  if(vEnd!=null) g.gain.linearRampToValueAtTime(Math.max(vEnd,0.001), t+dur*0.8);
  g.gain.setValueAtTime(vEnd!=null?Math.max(vEnd,0.001):Math.max(v0,0.001), t+dur*0.85);
  g.gain.exponentialRampToValueAtTime(0.001, t+dur);
  if(o.lfoFreq){
    const lfo = actx.createOscillator(), lg = actx.createGain();
    lfo.frequency.value = o.lfoFreq;
    lg.gain.value = (o.lfoDepth||0.35) * Math.max(v0, vEnd||0);
    lfo.connect(lg); lg.connect(g.gain);
    lfo.start(t); lfo.stop(t+dur+0.05);
  }
  src.connect(f); f.connect(g); g.connect(seGain);
  src.start(t); src.stop(t+dur+0.05);
}
const SE_DEFS = {
  // 通常のボタンタップ「ポン」
  tap(t){ seTone(t, {freq:660, freqEnd:440, dur:0.09, type:'sine', vol:0.45}); },
  // 試合開始・状態変化発動「ジャキーン」(金属的な立ち上がり+伸び)
  jakiin(t){
    seNoise(t, {dur:0.1, vol:0.22, filterType:'highpass', filterFreq:3500});
    seTone(t,       {freq:740,  freqEnd:1480, dur:0.34, type:'square',   vol:0.22});
    seTone(t+0.03,  {freq:1108, freqEnd:2217, dur:0.36, type:'square',   vol:0.16});
    seTone(t+0.05,  {freq:1480, freqEnd:2960, dur:0.4,  type:'triangle', vol:0.22});
  },
  // トレーニング実行「ポワポワ」(ステータスが伸びていく上昇音)
  train(t){
    const notes = [523, 659, 784, 1047];
    notes.forEach((f,i)=>{
      seTone(t+i*0.13, {freq:f*0.97, freqEnd:f, dur:0.28, type:'sine', vol:0.4, attack:0.03});
      seTone(t+i*0.13, {freq:f*1.99, freqEnd:f*2.02, dur:0.2, type:'sine', vol:0.12, attack:0.03});
    });
  },
  // アイテム取得「ピュイン」
  pickup(t){
    seTone(t, {freq:880, freqEnd:1760, dur:0.1, type:'triangle', vol:0.45});
    seTone(t+0.08, {freq:1320, freqEnd:2200, dur:0.12, type:'sine', vol:0.3});
  },
  // 技発射「ボゥ」(単発/連射/範囲で変化)
  fire(t, opts){
    const kind = opts.kind||'single';
    if(kind==='aoe'){
      // tier3範囲技: エフェクトの持続時間(opts.dur)に合わせた長く強い轟音
      const d = Math.min(2.8, Math.max(0.7, opts.dur||0.9));
      seNoise(t, {dur:d, vol:0.42, filterFreq:1500, filterEnd:110});
      seTone(t, {freq:190, freqEnd:50, dur:d, type:'sawtooth', vol:0.26});
      seTone(t, {freq:95, freqEnd:38, dur:d*0.95, type:'sine', vol:0.42});
      seTone(t, {freq:63, dur:d*0.9, type:'sine', vol:0.2}); // 近接周波数のうなりでゴゴゴ感
      seNoise(t+d*0.55, {dur:d*0.45, vol:0.2, filterType:'highpass', filterFreq:2500}); // 余韻のシュウウ
    } else if(kind==='burst'){
      for(let i=0;i<3;i++){
        seTone(t+i*0.09, {freq:400, freqEnd:220, dur:0.08, type:'sine', vol:0.32});
        seNoise(t+i*0.09, {dur:0.06, vol:0.14, filterFreq:1500, filterEnd:500});
      }
    } else {
      seTone(t, {freq:300, freqEnd:140, dur:0.17, type:'sine', vol:0.45});
      seNoise(t, {dur:0.11, vol:0.18, filterFreq:900, filterEnd:300});
    }
  },
  // 技被弾「ドゥン」
  hitTaken(t){
    seTone(t, {freq:150, freqEnd:55, dur:0.25, type:'sine', vol:0.55});
    seNoise(t, {dur:0.16, vol:0.3, filterFreq:450, filterEnd:120});
  },
  // ガッツ不足「ピピピッ」
  noGuts(t){
    for(let i=0;i<3;i++) seTone(t+i*0.08, {freq:1250, dur:0.045, type:'square', vol:0.28});
  },
  // インフェルノ・ファイアウェーブ「ボオオオオ」(燃え盛る炎)
  fireRoar(t, o){
    const d = Math.min(3, Math.max(0.8, (o&&o.dur)||1.2));
    seNoiseLfo(t, {dur:d, vol:0.45, filterFreq:950, filterEnd:280, lfoFreq:8, lfoDepth:0.45});
    seTone(t, {freq:90, freqEnd:45, dur:d, type:'sawtooth', vol:0.24});
    for(let i=0;i<5;i++){ // パチパチと爆ぜる音
      seNoise(t + Math.random()*d*0.8, {dur:0.04, vol:0.13, filterType:'highpass', filterFreq:3200});
    }
  },
  // クリスタルレイン「パリパリパリ」(高く凍てつく、氷が砕ける音)
  iceCrack(t, o){
    const d = Math.min(2.5, Math.max(0.8, (o&&o.dur)||1.2));
    const n = Math.round(d*8)+4; // 細かく連続した「パリパリ」
    for(let i=0;i<n;i++){
      const tt = t + i*(d/n) + Math.random()*0.03;
      const f = 3200 + Math.random()*2800; // 高音域(氷の冷たさ)
      seTone(tt, {freq:f, freqEnd:f*1.15, dur:0.05, type:'triangle', vol:0.24}); // 上昇でパキッと
      seTone(tt, {freq:f*1.5, dur:0.03, type:'sine', vol:0.12});                 // 倍音のきらめき
      seNoise(tt, {dur:0.03, vol:0.16, filterType:'highpass', filterFreq:6500}); // 砕けるノイズ
    }
    seNoise(t+d*0.85, {dur:0.3, vol:0.2, filterType:'highpass', filterFreq:5500}); // 最後にシャラーン
  },
  // 竜巻アタック「ゴオオオオ」(最初から轟音+地響き)
  tornado(t, o){
    const d = Math.min(3, Math.max(1, (o&&o.dur)||2));
    seNoiseLfo(t, {dur:d, vol:0.55, filterFreq:900, filterEnd:450, lfoFreq:11, lfoDepth:0.3}); // 風の轟音
    seNoiseLfo(t, {dur:d, vol:0.5, filterFreq:130, lfoFreq:5.5, lfoDepth:0.5});               // 地響きの揺れ
    seTone(t, {freq:44, dur:d, type:'sine', vol:0.42});      // 地鳴りの超低音
    seTone(t, {freq:60, dur:d, type:'sawtooth', vol:0.2});
  },
  // シェルアタック「シュルルルル」(回転音)
  spin(t, o){
    const d = Math.min(1.6, Math.max(0.6, (o&&o.dur)||1));
    seNoiseLfo(t, {dur:d, vol:0.34, filterType:'bandpass', filterFreq:2600, lfoFreq:15, lfoDepth:0.8});
    seTone(t, {freq:640, freqEnd:900, dur:d, type:'sine', vol:0.07});
  },
  // 熱視線・サイコキネシス・モッチ砲・フラワービーム・天河天翔(持続レーザー: 低く尖った音+うなり)
  beam(t, o){
    const d = Math.min(2.6, Math.max(0.5, (o&&o.dur)||1));
    seTone(t, {freq:1400, freqEnd:650, dur:0.12, type:'sawtooth', vol:0.16}); // 撃ち出しのザップ
    seTone(t, {freq:330, dur:d, type:'sawtooth', vol:0.2, attack:0.015});
    seTone(t, {freq:333, dur:d, type:'sawtooth', vol:0.18, attack:0.015}); // わずかにずらしてうなり
    seTone(t, {freq:165, dur:d, type:'square', vol:0.13, attack:0.015});  // 低域の芯
    seNoise(t, {dur:d, vol:0.05, filterType:'bandpass', filterFreq:2400});
  },
  // レクイエムエンド「シュンシュンシュン」(風切り3連)
  whoosh(t){
    for(let i=0;i<3;i++){
      seNoise(t+i*0.11, {dur:0.15, vol:0.36, filterType:'bandpass', filterFreq:3900, filterEnd:650});
    }
  },
  // 天の慈悲「リンリンリーン」(残響たっぷりの鐘の音)
  bell(t){
    // 実際の鐘に近い非整数倍音(ハム・プライム・ティアス・クイント・ノミナル)を重ねて長く響かせる
    const ring=(tt,f,d,v)=>{
      seTone(tt, {freq:f*0.5,  dur:d*1.5, type:'sine', vol:v*0.5,  attack:0.008});
      seTone(tt, {freq:f,      dur:d,     type:'sine', vol:v,      attack:0.008});
      seTone(tt, {freq:f*1.19, dur:d*0.85,type:'sine', vol:v*0.5,  attack:0.008});
      seTone(tt, {freq:f*1.5,  dur:d*0.7, type:'sine', vol:v*0.35, attack:0.008});
      seTone(tt, {freq:f*2.0,  dur:d*0.55,type:'sine', vol:v*0.3,  attack:0.008});
      seTone(tt, {freq:f*2.74, dur:d*0.35,type:'sine', vol:v*0.2,  attack:0.008});
    };
    ring(t,      1568, 1.1, 0.3);
    ring(t+0.24, 1568, 1.1, 0.28);
    ring(t+0.5,  2093, 2.4, 0.34); // 最後の一打は長く響かせる
  },
  // 敵をキルした時「ザシュッ」(切り裂き音)
  kill(t){
    seNoise(t, {dur:0.16, vol:0.5, filterType:'bandpass', filterFreq:5200, filterEnd:900});
    seTone(t, {freq:2400, freqEnd:280, dur:0.14, type:'sawtooth', vol:0.14});
    seNoise(t+0.06, {dur:0.2, vol:0.28, filterFreq:1300, filterEnd:180});
  },
  // 勝利ファンファーレ(リザルト画面・約3.6秒)
  fanfare(t){
    const N=(dt,f,d,v)=>{
      seTone(t+dt, {freq:f, dur:d, type:'square', vol:(v||0.3)*0.55});
      seTone(t+dt, {freq:f/2, dur:d, type:'triangle', vol:(v||0.3)*0.45});
    };
    // 第1フレーズ: パパパ、パーン!
    N(0,    784, 0.15); N(0.17, 784, 0.15); N(0.34, 784, 0.15);
    N(0.52, 1047, 0.45, 0.34);
    // 第2フレーズ: 駆け上がり
    N(1.05, 880, 0.15); N(1.21, 988, 0.15); N(1.38, 1047, 0.4, 0.32);
    // 第3フレーズ: さらに高く駆け上がって大団円
    N(1.85, 1047, 0.14); N(2.0, 1175, 0.14); N(2.16, 1319, 0.14);
    N(2.34, 1568, 0.9, 0.38);
    [523,659,784,1047,1319].forEach(f=>seTone(t+2.34, {freq:f, dur:1.1, type:'triangle', vol:0.11, attack:0.05}));
    seNoise(t+0.52, {dur:0.3, vol:0.08, filterType:'highpass', filterFreq:5000});
    seNoise(t+2.34, {dur:0.7, vol:0.13, filterType:'highpass', filterFreq:5000}); // シャーンという輝き
  },
  // 敗北・その他(悲しげな下降フレーズ・約2.4秒)
  sad(t){
    const notes=[[0,659],[0.42,587],[0.84,523],[1.22,494]];
    for(const [dt,f] of notes){
      seTone(t+dt, {freq:f, dur:0.55, type:'triangle', vol:0.3, attack:0.04});
      seTone(t+dt, {freq:f/2, dur:0.55, type:'sine', vol:0.18, attack:0.04});
    }
    seTone(t+1.62, {freq:440, dur:1.0, type:'triangle', vol:0.28, attack:0.06});
    seTone(t+1.62, {freq:220, dur:1.0, type:'sine', vol:0.2, attack:0.06});
    seTone(t+1.62, {freq:262, dur:1.0, type:'sine', vol:0.12, attack:0.06});
  },
};
// メニュー系の<button>タップで共通の「ポン」を鳴らす
document.addEventListener('click', (e)=>{
  if(e.target && e.target.closest && e.target.closest('button')) playSe('tap');
}, true);

// ===== BGM(ステップシーケンサ) =====
// 16分音符単位で先読みスケジュールする。トラックは 'title' / 'battle'。
// battleは残り人数に応じて intensity 0(序盤)→1(中盤)→2(終盤)→3(残り5人以下=壮大) が上がる
const bgmState = { desired:'title', current:null, step:0, nextTime:0, intensity:0, timerId:null };
const MIDI = n => 440*Math.pow(2,(n-69)/12);
function bgmSetTrack(name){
  if(bgmState.desired===name) return;
  bgmState.desired = name;
  if(actx && bgmTrackGain){
    // 切替時は短くフェードアウト→インして繋ぎ目を柔らかく
    const t = actx.currentTime;
    bgmTrackGain.gain.cancelScheduledValues(t);
    bgmTrackGain.gain.setValueAtTime(bgmTrackGain.gain.value, t);
    bgmTrackGain.gain.linearRampToValueAtTime(0.0001, t+0.25);
    bgmTrackGain.gain.linearRampToValueAtTime(1, t+0.9);
  }
}
function bgmUpdateBattleIntensity(aliveCount){
  bgmState.intensity = aliveCount<=5 ? 3 : aliveCount<=10 ? 2 : aliveCount<=20 ? 1 : 0;
}
function startBgmScheduler(){
  if(bgmState.timerId) return;
  bgmState.nextTime = actx.currentTime + 0.1;
  bgmState.timerId = setInterval(bgmScheduler, 90);
}
function bgmStepDur(){
  const bpm = bgmState.current==='title' ? 92 : [116,126,138,126][bgmState.intensity];
  return 60/bpm/4;
}
function bgmScheduler(){
  if(!actx || actx.state!=='running') return;
  if(bgmState.current !== bgmState.desired){
    bgmState.current = bgmState.desired;
    bgmState.step = 0;
    bgmState.nextTime = Math.max(bgmState.nextTime, actx.currentTime + 0.08);
  }
  if(!bgmState.current || audioSettings.bgm<=0.005){
    bgmState.nextTime = actx.currentTime + 0.1; // 復帰時にまとめ鳴りしないよう追従だけさせる
    return;
  }
  while(bgmState.nextTime < actx.currentTime + 0.28){
    if(bgmState.current==='title') bgmTitleStep(bgmState.step, bgmState.nextTime);
    else if(bgmState.intensity>=3) bgmEpicStep(bgmState.step, bgmState.nextTime);
    else bgmBattleStep(bgmState.step, bgmState.nextTime, bgmState.intensity);
    bgmState.step++;
    bgmState.nextTime += bgmStepDur();
  }
}
// BGM用の発音ヘルパー
function bNote(t, midi, dur, type, vol, detune){
  const osc = actx.createOscillator(), g = actx.createGain();
  osc.type = type||'triangle';
  osc.frequency.setValueAtTime(MIDI(midi), t);
  if(detune) osc.detune.setValueAtTime(detune, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol!=null?vol:0.15, t+0.015);
  g.gain.setValueAtTime(vol!=null?vol:0.15, t+dur*0.6);
  g.gain.exponentialRampToValueAtTime(0.001, t+dur);
  osc.connect(g); g.connect(bgmTrackGain);
  osc.start(t); osc.stop(t+dur+0.05);
}
function bKick(t, vol){
  const osc = actx.createOscillator(), g = actx.createGain();
  osc.type='sine';
  osc.frequency.setValueAtTime(130, t);
  osc.frequency.exponentialRampToValueAtTime(45, t+0.11);
  g.gain.setValueAtTime(vol!=null?vol:0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t+0.13);
  osc.connect(g); g.connect(bgmTrackGain);
  osc.start(t); osc.stop(t+0.16);
}
function bHat(t, vol){
  const len = Math.floor(actx.sampleRate*0.035);
  const buf = actx.createBuffer(1,len,actx.sampleRate);
  const d = buf.getChannelData(0);
  for(let i=0;i<len;i++) d[i]=Math.random()*2-1;
  const src=actx.createBufferSource(); src.buffer=buf;
  const f=actx.createBiquadFilter(); f.type='highpass'; f.frequency.value=6500;
  const g=actx.createGain();
  g.gain.setValueAtTime(vol!=null?vol:0.12, t);
  g.gain.exponentialRampToValueAtTime(0.001, t+0.035);
  src.connect(f); f.connect(g); g.connect(bgmTrackGain);
  src.start(t); src.stop(t+0.05);
}
function bCrash(t, vol){
  const len = Math.floor(actx.sampleRate*0.9);
  const buf = actx.createBuffer(1,len,actx.sampleRate);
  const d = buf.getChannelData(0);
  for(let i=0;i<len;i++) d[i]=Math.random()*2-1;
  const src=actx.createBufferSource(); src.buffer=buf;
  const f=actx.createBiquadFilter(); f.type='highpass'; f.frequency.value=4200;
  const g=actx.createGain();
  g.gain.setValueAtTime(vol!=null?vol:0.16, t);
  g.gain.exponentialRampToValueAtTime(0.001, t+0.9);
  src.connect(f); f.connect(g); g.connect(bgmTrackGain);
  src.start(t); src.stop(t+1.0);
}
function bTom(t, vol){
  const osc = actx.createOscillator(), g = actx.createGain();
  osc.type='sine';
  osc.frequency.setValueAtTime(190, t);
  osc.frequency.exponentialRampToValueAtTime(80, t+0.16);
  g.gain.setValueAtTime(vol!=null?vol:0.3, t);
  g.gain.exponentialRampToValueAtTime(0.001, t+0.18);
  osc.connect(g); g.connect(bgmTrackGain);
  osc.start(t); osc.stop(t+0.22);
}
function bSnare(t, vol){
  const len = Math.floor(actx.sampleRate*0.12);
  const buf = actx.createBuffer(1,len,actx.sampleRate);
  const d = buf.getChannelData(0);
  for(let i=0;i<len;i++) d[i]=Math.random()*2-1;
  const src=actx.createBufferSource(); src.buffer=buf;
  const f=actx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=1900; f.Q.value=0.7;
  const g=actx.createGain();
  g.gain.setValueAtTime(vol!=null?vol:0.28, t);
  g.gain.exponentialRampToValueAtTime(0.001, t+0.12);
  src.connect(f); f.connect(g); g.connect(bgmTrackGain);
  src.start(t); src.stop(t+0.15);
}

// --- タイトルBGM: のどかな牧場(ハ長調・ゆったり8小節ループ) ---
// コード進行: C - F - C - G - C - Am - F - G(1小節=16ステップ)
const TITLE_CHORDS = [
  [60,64,67],[65,69,72],[60,64,67],[67,71,74],
  [60,64,67],[57,60,64],[65,69,72],[67,71,74],
];
// メロディ: [開始ステップ(128中), MIDIノート, 長さ(ステップ)] 素朴なペンタトニック調
const TITLE_MELODY = [
  [0,76,4],[4,79,4],[8,81,6],[14,79,2],
  [16,81,4],[20,79,4],[24,76,8],
  [32,72,4],[36,76,4],[40,79,6],[46,76,2],
  [48,74,8],[56,71,8],
  [64,76,4],[68,79,4],[72,81,6],[78,84,2],
  [80,84,4],[84,81,4],[88,79,8],
  [96,77,4],[100,76,4],[104,74,4],[108,72,4],
  [112,74,6],[118,71,2],[120,72,8],
];
function bgmTitleStep(step, t){
  const s = step % 128;
  const bar = Math.floor(s/16), sb = s%16;
  const chord = TITLE_CHORDS[bar];
  const dur = bgmStepDur();
  // ベース: 1・3拍目にルート音(のんびり)
  if(sb===0 || sb===8) bNote(t, chord[0]-24, dur*7, 'sine', 0.22);
  // 分散和音: 8分でやわらかく
  if(sb%2===0){
    const arpNote = chord[(sb/2)%3] ;
    bNote(t, arpNote, dur*1.8, 'triangle', 0.075);
  }
  // メロディ
  for(const [ms, note, len] of TITLE_MELODY){
    if(ms===s) bNote(t, note, dur*len*0.92, 'triangle', 0.16);
  }
  // 小鳥のさえずり風(たまに高音がピロッ)
  if(s===30 || s===94){ bNote(t, 96, dur, 'sine', 0.05); bNote(t+dur, 98, dur, 'sine', 0.04); }
}

// --- 試合中BGM: 緊張感のあるマイナー進行(残り人数で厚み・速さが増す) ---
// コード進行: Am - Am - F - G(1小節=16ステップ、4小節ループ)
const BATTLE_CHORDS = [ [57,60,64],[57,60,64],[53,57,60],[55,59,62] ];
function bgmBattleStep(step, t, lv){
  const s = step % 64;
  const bar = Math.floor(s/16), sb = s%16;
  const chord = BATTLE_CHORDS[bar];
  const root = chord[0]-24;
  const dur = bgmStepDur();
  // ベース: 8分刻みのパルス
  if(sb%2===0) bNote(t, root, dur*1.6, 'sawtooth', lv>=1?0.13:0.1);
  // ハイハット: 序盤は8分、終盤は16分
  if(lv>=2 || sb%2===0) bHat(t, sb%4===2?0.13:0.08);
  // キック: 中盤から4つ打ち
  if(lv>=1 && sb%4===0) bKick(t, 0.42);
  if(lv===0 && sb===0) bKick(t, 0.3);
  // スネア: 終盤から2・4拍
  if(lv>=2 && (sb===4 || sb===12)) bSnare(t);
  // アルペジオ: 序盤4分→中盤8分→終盤16分で刻みが細かくなる
  const arpEvery = lv>=2 ? 1 : lv>=1 ? 2 : 4;
  if(sb%arpEvery===0){
    const arpNote = chord[Math.floor(sb/arpEvery)%3]+12;
    bNote(t, arpNote, dur*1.4, 'square', 0.05);
  }
  // 終盤: 小節頭に不穏なスタブ
  if(lv>=2 && sb===0) bNote(t, chord[0], dur*6, 'sawtooth', 0.08, 8);
}

// --- 残り5人以下: 重厚で禍々しい決戦BGM(8小節=128ステップループ) ---
// コード進行: Am - F - Dm - E / Am - B♭ - F - E(B♭の半音上行とEの導音で禍々しさを出す)
const EPIC_CHORDS = [
  [57,60,64],[53,57,60],[50,53,57],[52,56,59],
  [57,60,64],[58,62,65],[53,57,60],[52,56,59],
];
// 旋律: 上昇音形の反復(ゼクエンツ)で、8小節かけて段階的に高まっていく
const EPIC_MELODY = [
  [0,57,4],[4,60,4],[8,64,4],[12,62,4],          // 低域: A-C-E-D
  [16,60,4],[20,64,4],[24,65,4],[28,64,4],        // 一段上がって C-E-F-E
  [32,62,4],[36,65,4],[40,69,4],[44,67,4],        // さらに上がって D-F-A-G
  [48,64,4],[52,68,4],[56,71,4],[60,68,4],        // E-G#-B-G#(導音で緊張)
  [64,69,4],[68,72,4],[72,76,4],[76,74,4],        // 1オクターブ上で最初の音形を反復
  [80,74,4],[84,77,4],[88,81,4],[92,79,4],        // D-F-A-G(高域)
  [96,81,3],[99,84,3],[102,81,3],[105,84,3],[108,86,4], // A-C-A-C-D 畳みかけ
  [112,88,8],[120,87,4],[124,88,4],               // E6の頂点 → 導音を挟んでループ頭のAへ
];
function bgmEpicStep(step, t){
  const s = step % 128;
  const bar = Math.floor(s/16), sb = s%16;
  const chord = EPIC_CHORDS[bar];
  const dur = bgmStepDur();
  const build = bar/7; // 0→1: 8小節かけて徐々に盛り上がる係数
  // 小節頭: クラッシュ+重厚パッド+聖歌隊風+地鳴りサブベース+うなり(禍々しさ)
  if(sb===0){
    bCrash(t, bar===0 ? 0.22 : 0.1+build*0.08);
    for(const n of chord){
      bNote(t, n, dur*15, 'sawtooth', 0.04+build*0.02, -12);
      bNote(t, n, dur*15, 'sawtooth', 0.04+build*0.02, 12);
      bNote(t, n+12, dur*15, 'triangle', 0.03+build*0.05); // 聖歌隊風(後半ほど強く)
    }
    bNote(t, chord[0]-12, dur*15, 'sawtooth', 0.1);
    bNote(t, chord[0]-24, dur*15, 'sine', 0.24);     // 地鳴りのサブベース
    bNote(t, chord[0]-24, dur*15, 'sine', 0.06, 22); // わずかにずらした同音のうなりで不穏さを出す
  }
  // 重々しいベース: ノコギリ+1オクターブ下の矩形の2枚重ね。小節末に半音下をぶつける
  if(sb%2===0){
    const bn = chord[0]-24 + (sb===14 ? -1 : 0);
    bNote(t, bn, dur*1.8, 'sawtooth', 0.2);
    bNote(t, bn-12, dur*1.8, 'square', 0.07);
  }
  // ドラム: 4つ打ち+小節終わりのダブルキック+2・4スネア+低音タム+16分ハット
  if(sb%4===0) bKick(t, 0.6);
  if(sb===14){ bKick(t, 0.5); bKick(t+dur/2, 0.5); }
  if(sb===4 || sb===12) bSnare(t, 0.3+build*0.1);
  if(sb===7 || sb===15) bTom(t, 0.32);
  bHat(t, sb%4===0?0.13:0.08);
  // 鐘のような不穏なトライトーンアクセント
  if(sb===8 && bar%2===1) bNote(t, chord[0]+18, dur*4, 'triangle', 0.05);
  // 旋律: 小節が進むほど層が厚く・強くなる(徐々に盛り上がる)
  for(const [ms, note, len] of EPIC_MELODY){
    if(ms===s){
      bNote(t, note, dur*len*0.95, 'square', 0.07+build*0.05);
      if(bar>=2) bNote(t, note+12, dur*len*0.95, 'triangle', 0.05+build*0.09);
      if(bar>=4) bNote(t, note-12, dur*len*0.95, 'sawtooth', 0.05);
      if(bar>=6) bNote(t, note+7, dur*len*0.95, 'triangle', 0.06);
    }
  }
}
