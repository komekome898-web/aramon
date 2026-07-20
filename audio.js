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
const SE_MIN_GAP = { tap:0.05, jakiin:0.25, train:0.3, pickup:0.1, fire:0.06, hitTaken:0.12, noGuts:0.5 };
const seLastAt = {};
function playSe(name, opts){
  if(!actx || audioSettings.se<=0.005) return;
  const now = actx.currentTime;
  if(seLastAt[name]!=null && now - seLastAt[name] < (SE_MIN_GAP[name]||0.05)) return;
  seLastAt[name] = now;
  const fn = SE_DEFS[name];
  if(fn) fn(now, opts||{});
}
function seTone(t, o){
  const osc = actx.createOscillator(), g = actx.createGain();
  const dur = o.dur||0.15;
  osc.type = o.type||'sine';
  osc.frequency.setValueAtTime(o.freq||440, t);
  if(o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(o.freqEnd,1), t+dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.vol!=null?o.vol:0.5, t+(o.attack||0.005));
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
  g.gain.setValueAtTime(o.vol!=null?o.vol:0.4, t);
  g.gain.exponentialRampToValueAtTime(0.001, t+dur);
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
      seNoise(t, {dur:0.42, vol:0.4, filterFreq:1100, filterEnd:180});
      seTone(t, {freq:220, freqEnd:70, dur:0.4, type:'sine', vol:0.45});
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
  const bpm = bgmState.current==='title' ? 92 : [116,126,138,132][bgmState.intensity];
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

// --- 残り5人以下: 壮大な決戦BGM ---
// コード進行: Am - F - C - G(王道進行で壮大に)
const EPIC_CHORDS = [ [57,60,64],[53,57,60],[48,52,55],[55,59,62] ];
const EPIC_MELODY = [
  [0,69,6],[6,72,2],[8,76,8],
  [16,77,6],[22,76,2],[24,72,8],
  [32,76,6],[38,79,2],[40,84,8],
  [48,83,4],[52,79,4],[56,76,8],
];
function bgmEpicStep(step, t){
  const s = step % 64;
  const bar = Math.floor(s/16), sb = s%16;
  const chord = EPIC_CHORDS[bar];
  const dur = bgmStepDur();
  // 重厚なパッド: デチューンした2枚のノコギリ波+オクターブ
  if(sb===0){
    for(const n of chord){
      bNote(t, n, dur*15, 'sawtooth', 0.05, -7);
      bNote(t, n, dur*15, 'sawtooth', 0.05, 7);
    }
    bNote(t, chord[0]-12, dur*15, 'sawtooth', 0.07);
  }
  // ベース: オクターブ跳躍で疾走感
  if(sb%2===0) bNote(t, chord[0]-24 + (sb%4===2?12:0), dur*1.7, 'sawtooth', 0.15);
  // ドラム: 4つ打ち+2・4スネア+16分ハット
  if(sb%4===0) bKick(t, 0.5);
  if(sb===4 || sb===12) bSnare(t, 0.32);
  bHat(t, sb%4===0?0.12:0.07);
  // 壮大な主旋律(オクターブ重ね)
  for(const [ms, note, len] of EPIC_MELODY){
    if(ms===s){
      bNote(t, note, dur*len*0.95, 'square', 0.09);
      bNote(t, note+12, dur*len*0.95, 'triangle', 0.11);
    }
  }
}
