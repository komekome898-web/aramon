const TRAIT_DESC = {
  burn:       '攻撃命中で相手をやけど状態に(10秒間 被ダメ1.5倍)',
  lifesteal:  '与えたダメージの20%分HP回復。技命中で20%の確率で相手を1秒間こおり状態に(行動不能)',
  gutsdrain:  '与えたダメージの30%分 相手のガッツを削る。ガッツ回復速度1.5倍・技の連射速度1.5倍・技の威力0.8倍',
  slow:       '技命中で相手を1秒間 移動速度半分に',
  golem:      '被ダメ0.8倍・与ダメ1.2倍',
  haste:      '技の連射速度1.5倍',
  grace:      '与えたダメージの45%分 相手のガッツを削る。天の慈悲(tier3)発動後10秒間 被ダメ0.5倍',
  poison:     '技命中で相手をどく状態に(10秒間 1秒毎に5ダメージ、どくではHPは1残る)',
  bighitbox:  '技の当たり判定が1.5倍大きい',
  soft:       '被ダメ0.8倍',
  gutsbreak:  '与えたダメージの40%分 相手のガッツを削る',
  godrange:   '全ての技の射程が長い・技の消費ガッツ-12.5%',
  nimble:     '移動速度1.2倍',
  dullahan:   '被ダメ0.8倍、相手に近いほど技ダメが上がる', /*@dullahan*/
  hum:        '技の弾速が速く、射程が短い', /*@hum*/
  // <<AUTO:TRAIT_DESC>> ここから上へ tools/monster_add.py が新モンスターの行を追記する
};
function stateTriggerText(sc){
  return {
    hpBelow: `HPが${Math.round(sc.triggerValue*100)}%以下で発動`,
    gutsBelow: `ガッツが${Math.round(sc.triggerValue*100)}%以下で発動`,
    onHitChance: `技命中時${Math.round(sc.triggerValue*100)}%の確率で発動`,
    onHitTakenChance: `技を受けた時${Math.round(sc.triggerValue*100)}%の確率で発動`,
    onKill: `撃破時に発動`,
  }[sc.trigger] || '';
}
function stateDurationText(sc){
  return `効果時間${sc.duration}秒間・クールタイム${sc.cooldown}秒`;
}
game.selectedMastermonKey = null;

function buildMonsterGrid(){
  const grid = document.getElementById('monsterGrid');
  grid.innerHTML = `
    <div class="monster-card selector-card" id="mastermonSelectCard"></div>
    <div class="monster-card selector-card" id="monsterListSelectCard"></div>
  `;
  // 分岐カードを押したら、この選択オーバーレイを閉じてから目的の画面を開く
  // (閉じないと上に残り続けてカルーセルが操作できない)
  document.getElementById('mastermonSelectCard').addEventListener('click', ()=>{
    lobbyCloseOverlay('monsterPickOverlay');
    openMastermonScreen(false);
  });
  document.getElementById('monsterListSelectCard').addEventListener('click', ()=>{
    lobbyCloseOverlay('monsterPickOverlay');
    openMonsterListScreen();
  });
  buildMonsterListScreenGrid();
  renderSelectorCards();
}

// スキンを一切考慮しないデフォルト画像の <img>(モンスター選択画面のカードで使う。
// 装備スキンを反映すると「素のモンスターを選ぶ」画面なのに見た目と情報が食い違うため)
function defaultMonsterImgTag(element, altLabel){
  return `<img src="${imgSrcFor(`monsters/${element}`)}" data-ext-idx="0" alt="${altLabel||''}" onerror="handleMonsterImgError(this, 'monsters/${element}')">`;
}
// そのモンスターに装備中のスキンがあればスキンアイコン(dataURL)、無ければ通常画像で <img> を返す
function equippedIconImgTag(element, altLabel){
  if(typeof getEquippedSkin==='function'){
    const sk = getEquippedSkin(element);
    if(sk){ const url = skinnedIconDataUrl(sk); if(url) return `<img src="${url}" alt="${altLabel||''}">`; }
  }
  return `<img src="${imgSrcFor(`monsters/${element}`)}" data-ext-idx="0" alt="${altLabel||''}" onerror="handleMonsterImgError(this, 'monsters/${element}')">`;
}
function renderSelectorCards(){
  if(typeof updateRaidEntryButton==='function') updateRaidEntryButton(); // レイド開催中だけ入口を出す
  if(typeof renderLobbyMonster==='function') renderLobbyMonster();   // 中央の歩行モーションも更新
  if(typeof updateLobbyPickLabels==='function') updateLobbyPickLabels();
  const mmCard = document.getElementById('mastermonSelectCard');
  const mmData = game.selectedMastermonKey ? loadMastermons()[game.selectedMastermonKey] : null;
  if(mmData){
    const el = ELEMENTS[mmData.element];
    const mults = mastermonEffectMults(mmData);
    const effHp = Math.round(el.hp*mults.lifeMult);
    const effSpeed = Math.round(el.speed*(el.speedMod||1)*mults.speedMult);
    mmCard.classList.add('selected');
    mmCard.style.setProperty('--accent', el.accent || el.color);
    mmCard.innerHTML = `
      <div class="m-swatch" style="background:radial-gradient(circle at 35% 30%, ${el.color}, ${el.dark})">
        ${equippedIconImgTag(mmData.element, el.label)}
      </div>
      <div class="m-name">${mmData.name}<span class="m-name-sub">(${el.label})</span></div>
      <div class="m-stat">Lv.${mmData.level}　HP ${effHp}<br>速さ ${effSpeed}</div>
      <div class="m-trait">マスモンから選ぶ</div>`;
  } else {
    mmCard.classList.remove('selected');
    mmCard.style.removeProperty('--accent');
    mmCard.innerHTML = `
      <div class="m-swatch mastermon-entry-swatch">★</div>
      <div class="m-name">マスモンから選ぶ</div>
      <div class="m-stat" id="mastermonEntryCount">登録数 0</div>
      <div class="m-trait">育てたマスモンで参戦できます</div>`;
    updateMastermonEntryCount();
  }

  const listCard = document.getElementById('monsterListSelectCard');
  if(game.selectedElement && !game.selectedMastermonKey){
    const el = ELEMENTS[game.selectedElement];
    listCard.classList.add('selected');
    listCard.style.setProperty('--accent', el.accent || el.color);
    listCard.innerHTML = `
      <div class="m-swatch" style="background:radial-gradient(circle at 35% 30%, ${el.color}, ${el.dark})">
        <img src="${imgSrcFor(`monsters/${game.selectedElement}`)}" data-ext-idx="0" alt="${el.label}" onerror="handleMonsterImgError(this, 'monsters/${game.selectedElement}')">
      </div>
      <div class="m-name">${el.label}</div>
      <div class="m-stat">HP ${el.hp}<br>速さ ${Math.round(el.speed*(el.speedMod||1))}</div>
      <div class="m-trait">モンスター一覧から選ぶ</div>`;
  } else {
    listCard.classList.remove('selected');
    listCard.style.removeProperty('--accent');
    listCard.innerHTML = `
      <div class="m-swatch monsterlist-entry-swatch">🐾</div>
      <div class="m-name">モンスター一覧から選ぶ</div>
      <div class="m-stat">${Object.keys(ELEMENTS).length}体から選択</div>
      <div class="m-trait">お気に入りのモンスターで参戦</div>`;
  }
}

/* =====================================================================
   カードカルーセルの共通エンジン(モンスター選択 / マスモン選択で共用)
   ・弧状に並べたカードを左右スワイプで送る。中央だけ拡大・他は暗くする
   ・両端が繋がって無限にスワイプできる(位置は「環状の最短距離」で計算する)
   ・位置は全部JSがtransformで書く。CSS側にtransitionを付けてはいけない(追従が鈍る)
   画面固有の「カードの中身」「タップしたときの動き」だけを cfg で渡す。
   ===================================================================== */
const CARO_VISIBLE_SIDE = 2;        // 中央の左右に何枚見せるか(中央+左右2枚=計5枚)
const CARO_CENTER_SCALE = 1.2;      // 中央カードの拡大率(他は1.0)
const CARO_SIDE_BRIGHTNESS = 0.55;  // 隣のカードの明るさ(中央=1.0)
const CARO_SNAP_RATE = 0.22;        // 吸着アニメの追従率(1フレームあたり)
const CARO_FLICK_THRESHOLD = 0.45;  // これ以上の速さで離したら1枚送る(枚/秒相当)

// cfg: { stage, track, dots, counterNow, counterAll, glow, prevBtn, nextBtn,
//        keys:()=>[...], cardHtml:(key)=>html, accent:(key)=>'#rrggbb',
//        art:(key)=>{a,b}, onPick:(key, cardEl)=>void }
function createCardCarousel(cfg){
  const st = {
    pos: 0, target: 0, raf: null,
    dragging: false, pointerId: null,
    dragStartX: 0, dragStartY: 0, dragStartPos: 0, dragMoved: 0,
    lastX: 0, lastT: 0, velocity: 0,
    suppressClick: false,   // ドラッグ直後のclickを1回だけ無視する
    lastCenterIdx: null,    // 中央が変わった瞬間だけSEを鳴らすための直前値
    built: false, cards: [], keys: [],
  };
  const el = id => document.getElementById(id);
  const stageEl = () => el(cfg.stage);
  // カード間隔はCSSの --ml-step が正。ただし getComputedStyle は未登録のカスタム
  // プロパティを「calc(...)」の文字列で返すので数値にできない。そこで幅が --ml-step の
  // 見えない要素(プローブ)を1つ置き、その offsetWidth で解決後のpxを読む。
  // (JS側に数字を書かないため。@property は古いiOSで使えないので採用しない)
  let stepProbe = null;
  function stepPx(){
    if(!stepProbe){
      stepProbe = document.createElement('div');
      stepProbe.className = 'caro-step-probe';
      stageEl().appendChild(stepProbe);
    }
    return stepProbe.offsetWidth || 118;
  }

  // 環状の最短距離(-n/2 〜 n/2)。これで先頭と末尾が繋がる
  function ringDelta(i, pos){
    const n = st.keys.length;
    if(!n) return 0;
    let d = (i - pos) % n;
    if(d > n/2) d -= n;
    if(d < -n/2) d += n;
    return d;
  }
  function centerIndex(){
    const n = st.keys.length;
    return n ? ((Math.round(st.pos) % n) + n) % n : 0;
  }
  function centerKey(){ return st.keys[centerIndex()]; }

  function build(){
    const track = el(cfg.track), dots = el(cfg.dots);
    st.keys = cfg.keys() || [];
    track.innerHTML = '';
    dots.innerHTML = '';
    st.cards = st.keys.map((key, i)=>{
      const card = document.createElement('div');
      card.className = 'ml-card' + (cfg.cardClass ? ' ' + cfg.cardClass(key) : '');
      card.dataset.key = key;
      card.dataset.index = String(i);
      card.style.setProperty('--ml-accent', cfg.accent(key));
      const art = cfg.art(key);
      card.style.setProperty('--ml-art-a', art.a);
      card.style.setProperty('--ml-art-b', art.b);
      card.innerHTML = cfg.cardHtml(key);
      track.appendChild(card);
      const dot = document.createElement('div');
      dot.className = 'ml-dot';
      dots.appendChild(dot);
      return card;
    });
    if(cfg.counterAll) el(cfg.counterAll).textContent = String(st.keys.length);
    // 1枚しかないときは送りボタン・ドットを出さない
    const single = st.keys.length <= 1;
    [cfg.prevBtn, cfg.nextBtn].forEach(id=>{ if(id && el(id)) el(id).classList.toggle('hidden', single); });
    dots.classList.toggle('hidden', single);
    st.built = true;
    render();
  }
  // カードの中身だけ作り直す(選択中バッジ・レベル等が変わったとき)
  function refreshCards(){
    st.keys.forEach((key,i)=>{
      const c = st.cards[i];
      if(!c) return;
      // 位置は render() がインラインで書くので、クラスの付け替えは中身の作り直しと一緒に行う
      const center = c.classList.contains('is-center');
      c.className = 'ml-card' + (cfg.cardClass ? ' ' + cfg.cardClass(key) : '') + (center ? ' is-center' : '');
      // 着せ替えでオーラ色(枠・上端ライン・数値の発光)も変わるので、アクセント色も更新する
      c.style.setProperty('--ml-accent', cfg.accent(key));
      const art = cfg.art(key);
      c.style.setProperty('--ml-art-a', art.a);
      c.style.setProperty('--ml-art-b', art.b);
      c.innerHTML = cfg.cardHtml(key);
    });
  }

  function render(){
    if(!st.built) return;
    const step = stepPx();
    const centerIdx = centerIndex();
    st.cards.forEach((card, i)=>{
      const d = ringDelta(i, st.pos);
      const ad = Math.abs(d);
      if(ad > CARO_VISIBLE_SIDE + 0.75){
        card.style.opacity = '0';
        card.style.pointerEvents = 'none';
        card.style.transform = 'translate3d(0,0,-600px)';
        card.classList.remove('is-center');
        return;
      }
      const near = Math.max(0, 1 - ad);                    // 中央でだけ1、隣で0
      const scale = 1 + (CARO_CENTER_SCALE - 1) * near;
      const bright = 1 - (1 - CARO_SIDE_BRIGHTNESS) * Math.min(1, ad);
      const z = -Math.min(ad, CARO_VISIBLE_SIDE) * 60;     // 奥に引いて弧に見せる
      // 一番外側は少しだけ薄くして、見切れが自然に見えるようにする
      const fade = ad > CARO_VISIBLE_SIDE ? Math.max(0, 1 - (ad - CARO_VISIBLE_SIDE) / 0.75) : 1;
      card.style.opacity = String(fade);
      card.style.pointerEvents = fade > 0.35 ? 'auto' : 'none';
      card.style.zIndex = String(50 - Math.round(ad * 10));
      card.style.transform = `translate3d(${d * step}px,0,${z}px) rotateY(${-d * 13}deg) scale(${scale})`;
      card.style.filter = `brightness(${bright}) saturate(${0.7 + 0.3 * near})`;
      card.classList.toggle('is-center', i === centerIdx);
    });
    if(cfg.glow && el(cfg.glow) && st.keys.length){
      el(cfg.glow).style.setProperty('--ml-glow', caroHexToRgba(cfg.accent(st.keys[centerIdx]), 0.5));
    }
    if(cfg.counterNow) el(cfg.counterNow).textContent = String(centerIdx + 1);
    const dotEls = el(cfg.dots).children;
    for(let i=0;i<dotEls.length;i++) dotEls[i].classList.toggle('active', i === centerIdx);
    // 中央のカードが切り替わった瞬間に「シュッ」を鳴らす。ドラッグ・送りボタン・隣カードの
    // タップ・詳細の≪≫ のどの経路でもここを通るので、鳴らす場所はこの1か所に集約している
    if(st.lastCenterIdx !== centerIdx){
      if(st.lastCenterIdx != null && typeof playSe==='function') playSe('cardSwipe');
      st.lastCenterIdx = centerIdx;
    }
  }

  // 吸着アニメ: target へ滑らかに寄せる。十分近づいたら整数にスナップして停止する
  function startAnim(){
    if(st.raf) return;
    const tick = ()=>{
      st.raf = null;
      if(st.dragging){ render(); return; }
      const diff = st.target - st.pos;
      if(Math.abs(diff) < 0.004){ st.pos = st.target; render(); return; }
      st.pos += diff * CARO_SNAP_RATE;
      render();
      st.raf = requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick);
  }
  function goTo(target){ st.target = target; startAnim(); }
  // 隣のカードへ即座に送る(詳細画面の≪≫用。アニメを待たず位置を確定させる)
  function jump(dir){
    const n = st.keys.length;
    if(n <= 1) return centerKey();
    const next = Math.round(st.pos) + dir;
    st.pos = next; st.target = next;
    render();
    return centerKey();
  }
  function stopAnim(){ if(st.raf){ cancelAnimationFrame(st.raf); st.raf = null; } st.dragging = false; }
  // 指定キーを中央にしてSEを鳴らさずに開く
  function reset(key){
    const idx = Math.max(0, st.keys.indexOf(key));
    st.pos = idx; st.target = idx; st.lastCenterIdx = null;
    render();
  }

  function onDown(e){
    if(e.pointerType === 'mouse' && e.button !== 0) return;
    st.dragging = true; st.pointerId = e.pointerId;
    st.dragStartX = e.clientX; st.dragStartY = e.clientY;
    st.dragStartPos = st.pos; st.dragMoved = 0;
    st.lastX = 0; st.lastT = performance.now(); st.velocity = 0;
    try{ stageEl().setPointerCapture(e.pointerId); }catch(_){}
  }
  function onMove(e){
    if(!st.dragging || e.pointerId !== st.pointerId) return;
    // 強制横向き(端末が縦画面ロック)のときはUI全体がCSSで回転しているので、
    // 実画面の移動量を toLogicalDelta で回転補正してから横方向として使う
    const d = (typeof toLogicalDelta==='function')
      ? toLogicalDelta(e.clientX - st.dragStartX, e.clientY - st.dragStartY)
      : { x: e.clientX - st.dragStartX };
    st.dragMoved = Math.max(st.dragMoved, Math.abs(d.x));
    st.pos = st.dragStartPos - d.x / stepPx();
    const now = performance.now(), dt = now - st.lastT;
    if(dt > 0){ st.velocity = (d.x - st.lastX) / dt; st.lastX = d.x; st.lastT = now; }
    render();
  }
  function onUp(e){
    if(!st.dragging || (e && e.pointerId !== st.pointerId)) return;
    st.dragging = false; st.pointerId = null;
    // ドラッグして離した直後は click も飛んでくるので、その1回だけ無視する
    st.suppressClick = st.dragMoved > 8;
    // 基本は最寄りへ吸着。少しだけ払って離したときだけフリック扱いで1枚送る
    // (既にドラッグで1枚以上動いている場合は上乗せしない=1回のスワイプで2枚飛ばない)
    const flick = -st.velocity * 1000 / stepPx();
    let target = Math.round(st.pos);
    if(Math.abs(flick) > CARO_FLICK_THRESHOLD && target === Math.round(st.dragStartPos)){
      target += (flick > 0 ? 1 : -1);
    }
    goTo(target);
  }
  function onClick(e){
    if(st.suppressClick){ st.suppressClick = false; return; }
    const card = e.target.closest('.ml-card');
    if(!card) return;
    const i = parseInt(card.dataset.index, 10);
    if(i === centerIndex()) cfg.onPick(st.keys[i], card);
    else goTo(st.pos + ringDelta(i, st.pos));
  }

  const stage = stageEl();
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('click', onClick);
  if(cfg.prevBtn) el(cfg.prevBtn).addEventListener('click', (e)=>{ e.stopPropagation(); goTo(Math.round(st.pos) - 1); });
  if(cfg.nextBtn) el(cfg.nextBtn).addEventListener('click', (e)=>{ e.stopPropagation(); goTo(Math.round(st.pos) + 1); });

  return { st, build, refreshCards, render, goTo, jump, stopAnim, reset, centerIndex, centerKey, ringDelta };
}
function caroHexToRgba(hex, a){
  const m = /^#?([0-9a-f]{6})$/i.exec(hex||'');
  if(!m) return `rgba(244,196,48,${a})`;
  const v = parseInt(m[1],16);
  return `rgba(${(v>>16)&255},${(v>>8)&255},${v&255},${a})`;
}

/* =====================================================================
   モンスター選択(モンスター一覧カルーセル)
   この画面は「素のモンスター」を選ぶ画面なので、装備スキンを一切見ない。
   ===================================================================== */
const ML_KEYS = Object.keys(ELEMENTS);
let mlDetailKey = null;

function mlSpeedOf(key){ const el = ELEMENTS[key]; return Math.round(el.speed * (el.speedMod||1)); }
// オーラも装備スキンを見ないデフォルト値を使う
function mlAuraOf(key){ return MONSTER_AURA[key] || null; }
function mlAccentOf(key){
  const aura = mlAuraOf(key);
  return (aura && typeof auraColorHex==='function') ? auraColorHex(aura) : (ELEMENTS[key].accent || ELEMENTS[key].color);
}
// STATUSの下に置く短縮版の説明。1行に3つ×2行で収めるため、MASTERMON_STATSのdescより
// さらに短い言い回しを使う(長い文だと折り返して2行に収まらない)
const STAT_SHORT_DESC = {
  life:'HP', power:'与ダメ/被ダメ', wisdom:'与ダメ/ガッツ回復',
  accuracy:'連射速度', evasion:'移動速度', vitality:'被ダメ',
};
// 3行2列(左=ライフ/ちから/かしこさ, 右=命中/回避/丈夫さ)。CSSのgrid-auto-flow:columnで
// MASTERMON_STATSの並び順そのままがこの配置になる
function caroStatDescHtml(){
  return `<div class="ml-stat-desc">${MASTERMON_STATS.map(s=>
    `<span class="ml-stat-desc-item"><b style="color:${s.color}">${s.label}</b>=${STAT_SHORT_DESC[s.key]}</span>`
  ).join('')}</div>`;
}
// STATUSセクション。モンスター一覧とマスモン選択で同じ見た目にするため共用する
function caroStatusSecHtml(mm, apt, preview, note){
  return `<div class="ml-sec ml-sec-status">
    <div class="ml-sec-title">STATUS<span class="ml-sec-note">${note}</span></div>
    ${buildMastermonStatsColHtml(mm, apt || {}, preview)}
    ${caroStatDescHtml()}
  </div>`;
}
// 名前の横に置くオーラのマーク(●をオーラ色で。絵文字だと色が固定なので自前で描く)
function caroAuraMarkHtml(aura){
  if(!aura) return '';
  const hex = (typeof auraColorHex==='function') ? auraColorHex(aura) : '#fff';
  const jp = (typeof AURA_JP!=='undefined') ? AURA_JP[aura] : '';
  return `<span class="ml-aura-mark" style="--am:${hex}" title="${jp}オーラ"></span>`;
}
// カード下部の数値(HP・速さ)。大きく見せたいので専用クラスで組む
// r.colorClassを指定すると数値の文字色を差し替えられる(マスモンカードの育成強調用)
function caroFigsHtml(rows){
  return `<div class="ml-card-figs">${rows.map(r=>`
    <div class="ml-card-fig"><span class="ml-card-fig-k">${r.k}</span><span class="ml-card-fig-v${r.colorClass?(' '+r.colorClass):''}">${r.v}</span></div>`).join('')}</div>`;
}
function mlCardInnerHtml(key){
  const el = ELEMENTS[key];
  const picked = (game.selectedElement===key && !game.selectedMastermonKey) ? '<div class="ml-card-picked">選択中</div>' : '';
  return `
    ${picked}
    <div class="ml-card-art">${defaultMonsterImgTag(key, el.label)}</div>
    <div class="ml-card-shine"></div>
    <div class="ml-card-body">
      <div class="ml-card-name">${el.label}${caroAuraMarkHtml(mlAuraOf(key))}</div>
      ${caroFigsHtml([{k:'HP', v:el.hp}, {k:'速さ', v:mlSpeedOf(key)}])}
    </div>`;
}

const mlCarousel = createCardCarousel({
  stage:'mlStage', track:'mlTrack', dots:'mlDots', glow:'mlGlow',
  counterNow:'mlCounterNow', counterAll:'mlCounterAll',
  prevBtn:'mlPrevBtn', nextBtn:'mlNextBtn',
  keys: ()=>ML_KEYS,
  cardHtml: mlCardInnerHtml,
  accent: mlAccentOf,
  art: (key)=>({ a: ELEMENTS[key].color, b: ELEMENTS[key].dark }),
  onPick: (key, cardEl)=>openMonsterDetail(key, cardEl),
});
// 旧関数名(トップ画面の初期化から呼ばれる)を残しておく
function buildMonsterListScreenGrid(){ mlCarousel.build(); }

/* ---------------- 詳細ビュー ---------------- */
function mlDetailInfoHtml(key){
  const el = ELEMENTS[key];
  const aura = mlAuraOf(key);
  const auraName = (aura && typeof AURA_JP!=='undefined') ? `${AURA_JP[aura]}オーラ` : '';
  // 属性が持つ常時モディファイア(被ダメ0.8倍など)を読める形で並べる
  const mods = [];
  if(el.dmgTakenMod) mods.push(`被ダメ ${el.dmgTakenMod}倍`);
  if(el.dmgDealtMod) mods.push(`与ダメ ${el.dmgDealtMod}倍`);
  if(el.cooldownMod) mods.push(`連射 ${Math.round((1/el.cooldownMod)*10)/10}倍`);
  if(el.gutsRegenMod) mods.push(`ガッツ回復 ${el.gutsRegenMod}倍`);
  if(el.hitboxMult) mods.push(`当たり判定 ${el.hitboxMult}倍`);
  if(el.speedMod) mods.push(`移動 ${el.speedMod}倍`);
  const sc = STATE_CHANGES[key];
  const bonus = moveBonusEffectText(key);
  // ステータスは「マスモンに登録したときの初期値+適正(A〜E)」。表示はマスモン画面と共通の
  // buildMastermonStatsColHtml を流用する(バー・適正バッジの見た目をそろえるため)
  // ヘッダー(名前・チップ)はスクロールさせないので .ml-info-scroll の外に出す
  return `
    <div class="ml-info-head">
      <span class="ml-info-name">${el.label}${caroAuraMarkHtml(aura)}</span>
      ${auraName ? `<span class="ml-info-chip aura">${auraName}</span>` : ''}
      <span class="ml-info-chip">HP ${el.hp}</span>
      <span class="ml-info-chip">速さ ${mlSpeedOf(key)}</span>
      ${mods.map(m=>`<span class="ml-info-chip">${m}</span>`).join('')}
    </div>
    <div class="mm-content-wrap">
    <div class="ml-info-scroll">
    <div class="ml-info-cols">
      ${caroStatusSecHtml({ stats: mastermonInitialStats(key) }, APTITUDE[key], null, '初期値 / 適正')}
      <div class="ml-info-col2">
        <div class="ml-sec">
          <div class="ml-sec-title">特性</div>
          <div class="ml-trait-text">${TRAIT_DESC[el.trait] || ''}</div>
          ${bonus ? `<div class="ml-trait-bonus">${bonus}</div>` : ''}
        </div>
        ${sc ? `
        <div class="ml-sec">
          <div class="ml-sec-title">状態変化</div>
          <div class="ml-state-name">${sc.name}</div>
          <div class="ml-state-line">${stateTriggerText(sc)}</div>
          <div class="ml-state-line">${stateDurationText(sc)}</div>
          <div class="ml-state-effect">${describeStateEffectsText(sc.effects)}</div>
        </div>` : ''}
      </div>
    </div>
    <div class="ml-sec">
      <div class="ml-sec-title">技</div>
      ${buildMastermonMovesHtml(key, { ignoreSkin:true })}
    </div>
    </div>
    <div class="mm-scrollbar hidden"><div class="mm-scrollbar-thumb"></div></div>
    </div>`;
}

// カードの左右に置く「隣のモンスターへ」ボタン。カードのアイコン(絵)の両サイドに重ねる
function caroDetailNavHtml(){
  return `
    <button class="ml-card-nav ml-card-nav-prev" aria-label="前へ">«</button>
    <button class="ml-card-nav ml-card-nav-next" aria-label="次へ">»</button>`;
}
// 詳細ビューの中身(カード+情報)を描く。srcCardがあると一覧の位置から飛ぶ演出(FLIP)を付ける
function renderMonsterDetail(key, srcCard){
  mlDetailKey = key;
  const slot = document.getElementById('mlDetailCardSlot');
  const right = document.getElementById('mlDetailRight');
  let clone;
  if(srcCard){
    clone = srcCard.cloneNode(true);
  } else {
    clone = document.createElement('div');
    clone.className = 'ml-card';
    clone.dataset.key = key;
    clone.style.setProperty('--ml-accent', mlAccentOf(key));
    clone.style.setProperty('--ml-art-a', ELEMENTS[key].color);
    clone.style.setProperty('--ml-art-b', ELEMENTS[key].dark);
    clone.innerHTML = mlCardInnerHtml(key);
  }
  clone.classList.add('is-center');
  slot.innerHTML = '';
  slot.appendChild(clone);
  slot.insertAdjacentHTML('beforeend', caroDetailNavHtml());
  slot.querySelector('.ml-card-nav-prev').addEventListener('click', (e)=>{ e.stopPropagation(); mlDetailStep(-1); });
  slot.querySelector('.ml-card-nav-next').addEventListener('click', (e)=>{ e.stopPropagation(); mlDetailStep(1); });
  right.innerHTML = mlDetailInfoHtml(key);
  const scrollEl = right.querySelector('.ml-info-scroll');
  if(scrollEl) scrollEl.scrollTop = 0;
  attachVisibleScrollbar(scrollEl, right.querySelector('.mm-scrollbar'));
  return clone;
}
// 詳細を開いたまま隣のモンスターへ移動する(カード送りSEはカルーセル側が鳴らす)
function mlDetailStep(dir){
  const key = mlCarousel.jump(dir);
  if(!key) return;
  const card = renderMonsterDetail(key, null);
  card.classList.add(dir > 0 ? 'ml-slide-in-right' : 'ml-slide-in-left');
}
// 一覧のカードの見た目をそのまま詳細へ持ち込み、元の位置から左へ飛んで拡大させる(FLIP)
function openMonsterDetail(key, srcCard){
  const srcRect = srcCard ? srcCard.getBoundingClientRect() : null;
  const clone = renderMonsterDetail(key, srcCard);
  const slot = document.getElementById('mlDetailCardSlot');
  document.getElementById('mlCarouselView').classList.add('hidden');
  document.getElementById('mlDetailView').classList.remove('hidden');
  if(srcRect) caroFlipCard(slot, clone, srcRect);
}
// 表示後の位置を測り、元の位置へ一旦戻してからtransitionで戻す(=飛んで拡大して見える)
function caroFlipCard(slot, clone, srcRect){
  const dstRect = clone.getBoundingClientRect();
  // getBoundingClientRectは実画面基準なので、強制横向き時は幅と高さ・座標軸が入れ替わる。
  // カードのローカル座標系(=論理座標系)に直してから差分を出す
  const forced = (typeof isForcedLandscape==='function') && isForcedLandscape();
  const srcW = forced ? srcRect.height : srcRect.width;
  const srcH = forced ? srcRect.width  : srcRect.height;
  const dstW = forced ? dstRect.height : dstRect.width;
  const dstH = forced ? dstRect.width  : dstRect.height;
  const sx = dstW ? srcW / dstW : 1;
  const sy = dstH ? srcH / dstH : 1;
  const toL = (typeof toLogicalPoint==='function') ? toLogicalPoint : ((x,y)=>({x,y}));
  const sc = toL(srcRect.left + srcRect.width/2, srcRect.top + srcRect.height/2);
  const dc = toL(dstRect.left + dstRect.width/2, dstRect.top + dstRect.height/2);
  slot.classList.remove('ml-flip');
  clone.style.setProperty('transform', `translate(${sc.x-dc.x}px,${sc.y-dc.y}px) scale(${sx},${sy})`, 'important');
  requestAnimationFrame(()=>{
    slot.classList.add('ml-flip');
    clone.style.setProperty('transform', 'none', 'important');
  });
}
function closeMonsterDetail(){
  document.getElementById('mlDetailView').classList.add('hidden');
  document.getElementById('mlCarouselView').classList.remove('hidden');
  mlCarousel.render();
}
// 「このモンスターで参戦」= 選択を確定してトップ画面へ戻る
function mlConfirmEntry(){
  const key = mlDetailKey;
  if(!key) return;
  game.selectedElement = key;
  game.selectedMastermonKey = null;
  updatePlayButtonsEnabled();
  closeMonsterListScreen();
  renderSelectorCards();
  mlCarousel.refreshCards();
  if(game.trainingRange) rangeApplyMonsterChange(); // 訓練場では即その場で乗り換える
  saveLobbyPrefs();
  if(typeof pushToast==='function') pushToast(`${ELEMENTS[key].label} で参戦します`);
}

function openMonsterListScreen(){
  if(!mlCarousel.st.built) mlCarousel.build();
  else mlCarousel.refreshCards();
  // 選択中のモンスター(あれば)を中央にして開く
  const cur = (game.selectedElement && !game.selectedMastermonKey) ? game.selectedElement : ML_KEYS[0];
  mlCarousel.reset(cur);
  document.getElementById('mlDetailView').classList.add('hidden');
  document.getElementById('mlCarouselView').classList.remove('hidden');
  document.getElementById('monsterListScreen').classList.remove('hidden');
  document.getElementById('startScreen').classList.add('hidden');
}
function closeMonsterListScreen(){
  mlCarousel.stopAnim();
  document.getElementById('monsterListScreen').classList.add('hidden');
  if(game.trainingRange) return; // 射撃訓練場から開いた場合はロビーを出さずに訓練場へ戻る
  document.getElementById('startScreen').classList.remove('hidden');
}
document.getElementById('mlBackBtn').addEventListener('click', closeMonsterDetail);
document.getElementById('mlEntryBtn').addEventListener('click', mlConfirmEntry);
document.getElementById('closeMonsterListBtn').addEventListener('click', closeMonsterListScreen);
window.addEventListener('keydown', (e)=>{
  if(document.getElementById('monsterListScreen').classList.contains('hidden')) return;
  if(!document.getElementById('mlDetailView').classList.contains('hidden')){
    if(e.key==='ArrowLeft') mlDetailStep(-1);
    else if(e.key==='ArrowRight') mlDetailStep(1);
    return;
  }
  if(e.key==='ArrowLeft') mlCarousel.goTo(Math.round(mlCarousel.st.pos) - 1);
  else if(e.key==='ArrowRight') mlCarousel.goTo(Math.round(mlCarousel.st.pos) + 1);
  else if(e.key==='Enter') openMonsterDetail(mlCarousel.centerKey(), mlCarousel.st.cards[mlCarousel.centerIndex()]);
});
function updateMastermonEntryCount(){
  const countEl = document.getElementById('mastermonEntryCount');
  if(!countEl) return;
  const n = Object.keys(loadMastermons()).length;
  countEl.textContent = `登録数 ${n}`;
}
function describeStateEffectsText(effects){
  const parts = [];
  if(effects.dmgMult) parts.push(`技ダメ${effects.dmgMult}倍`);
  if(effects.gutsRegenMult) parts.push(`ガッツ回復${effects.gutsRegenMult}倍`);
  if(effects.cooldownMult){
    const atkSpeed = Math.round((1/effects.cooldownMult)*10)/10;
    parts.push(`連射${atkSpeed}倍`);
  }
  if(effects.gutsCostMult) parts.push(`消費ガッツ${effects.gutsCostMult}倍`);
  if(effects.speedMult) parts.push(`移動${effects.speedMult}倍`);
  if(effects.dmgTakenMult!=null) parts.push(`被ダメ${effects.dmgTakenMult}倍`);
  if(effects.lifestealPct) parts.push(`与ダメの${Math.round(effects.lifestealPct*100)}%自己回復`);
  return parts.join('・');
}
function buildHowtoLists(){
  const itemsEl = document.getElementById('howtoItems');
  if(itemsEl){
    const cards = [];
    HEAL_TYPES.forEach(type=>{
      const hi = HEAL_ITEMS[type];
      cards.push(`
        <div class="howto-item-card">
          <div class="howto-item-icon" style="background:${hi.color};">🧴</div>
          <div class="howto-item-text"><div class="howto-item-name">${hi.name}</div><div class="howto-item-effect">HP+${hi.heal}</div></div>
        </div>`);
    });
    cards.push(`
      <div class="howto-item-card">
        <div class="howto-item-icon" style="background:${TICKET_ITEM.color};">🎫</div>
        <div class="howto-item-text"><div class="howto-item-name">${TICKET_ITEM.name}</div><div class="howto-item-effect">技を強化(tier3後はランダムで永続強化)</div></div>
      </div>`);
    cards.push(`
      <div class="howto-item-card">
        <div class="howto-item-icon" style="background:${GUTS_ITEM.color};">🍬</div>
        <div class="howto-item-text"><div class="howto-item-name">${GUTS_ITEM.name}</div><div class="howto-item-effect">ガッツ+${GUTS_ITEM.restore}・上限+${GUTS_ITEM.maxBoost}</div></div>
      </div>`);
    TRAINING_TYPES.forEach(type=>{
      const ti = TRAINING_ITEMS[type];
      cards.push(`
        <div class="howto-item-card">
          <div class="howto-item-icon" style="background:${ti.color};">${ti.emoji}</div>
          <div class="howto-item-text"><div class="howto-item-name">${ti.name}(低確率)</div><div class="howto-item-effect">${ti.desc}</div></div>
        </div>`);
    });
    itemsEl.innerHTML = cards.join('');
  }

  const statesEl = document.getElementById('howtoStates');
  if(statesEl){
    const cards = Object.keys(ELEMENTS).map(key=>{
      const el = ELEMENTS[key];
      const sc = STATE_CHANGES[key];
      if(!sc) return '';
      return `
        <div class="howto-state-card">
          <div class="howto-state-icon">
            <img src="${imgSrcFor(`monsters/${key}`)}" data-ext-idx="0" alt="${el.label}" onerror="handleMonsterImgError(this, 'monsters/${key}')">
          </div>
          <div class="howto-state-text">
            <div class="howto-state-name">${el.label}：${sc.name}</div>
            <div class="howto-state-trigger">${stateTriggerText(sc)}</div>
            <div class="howto-state-duration">${stateDurationText(sc)}</div>
            <div class="howto-state-effect">${describeStateEffectsText(sc.effects)}</div>
          </div>
        </div>`;
    });
    statesEl.innerHTML = cards.join('');
  }
}
/* =====================================================================
   トップ画面(ロビー)
   ・左端メニュー / 中央の選択中モンスター / 右の出撃ボタン の3カラム
   ・各種設定・マイページ・マップ・モードはオーバーレイに逃がして1画面に収める
   ===================================================================== */

// ---- 設定 / マイページ / 各選択オーバーレイの開閉 ----
function lobbyOpenOverlay(id){ document.getElementById(id).classList.remove('hidden'); }
function lobbyCloseOverlay(id){ document.getElementById(id).classList.add('hidden'); }
{
  const pairs = [
    ['headerSettingsBtn','settingsOverlay','closeSettingsBtn'],
    ['headerMyPageBtn','myPageOverlay','closeMyPageBtn'],
    ['headerHelpBtn','helpOverlay','closeHelpBtn'],
    ['lobbyMonsterStage','monsterPickOverlay','closeMonsterPickBtn'],
    ['openMapPickBtn','mapPickOverlay','closeMapPickBtn'],
    ['openModePickBtn','modePickOverlay','closeModePickBtn'],
  ];
  pairs.forEach(([openId, ovId, closeId])=>{
    document.getElementById(openId).addEventListener('click', ()=> lobbyOpenOverlay(ovId));
    document.getElementById(closeId).addEventListener('click', ()=> lobbyCloseOverlay(ovId));
  });
  // ロビー右上「🔰 はじめての方へ」→ ヘルプ画面(headerHelpBtnと同じオーバーレイを開くだけ)
  document.getElementById('openHelpFromLobbyBtn').addEventListener('click', ()=> lobbyOpenOverlay('helpOverlay'));
  // 設定・マイページの中のボタンは、押したらそのオーバーレイを閉じてから目的の画面を開く
  ['howToPlayBtn','openHudCustomizeBtn','audioSettingsBtn','adminEntryBtn'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener('click', ()=> lobbyCloseOverlay('settingsOverlay'));
  });
  // ランキングは左カラムへ移したので、閉じる対象はマイ記録だけ
  ['titleMyStatsBtn'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener('click', ()=> lobbyCloseOverlay('myPageOverlay'));
  });
}

// ---- ヘルプ: マニュアル画像ビューア(一覧のボタンを押すと該当画像を表示) ----
document.querySelectorAll('.help-manual-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.getElementById('helpImageTag').src = btn.dataset.manual;
    document.getElementById('helpImageTitle').textContent = btn.dataset.title || '';
    document.getElementById('helpImageScroll').scrollTop = 0;
    lobbyCloseOverlay('helpOverlay');
    lobbyOpenOverlay('helpImageOverlay');
  });
});
document.getElementById('closeHelpImageBtn').addEventListener('click', ()=>{
  lobbyCloseOverlay('helpImageOverlay');
  lobbyOpenOverlay('helpOverlay');
});

// ---- 右カラムの「マップ」「プレイモード」の表示値を更新 ----
function updateLobbyPickLabels(){
  const mapEl = document.getElementById('lobbyMapValue');
  if(mapEl){
    const realTag = game.realMapMode ? '⛰️リアル ' : '';
    if(game.selectedMap==='random') mapEl.textContent = realTag+'🎲 ランダム';
    else {
      const m = MAPS[game.selectedMap] || MAPS.wild;
      mapEl.textContent = `${realTag}${m.previewIcon||'🗺️'} ${m.label}`;
    }
  }
  const modeEl = document.getElementById('lobbyModeValue');
  if(modeEl){
    // 表示は「ロビーで選んだもの(lobbyMode)」が正。試合中の netState を見ない
    modeEl.textContent = lobbyMode==='raid' ? `レイドバトル (最大${RAID_CAPACITY}人)`
      : (lobbyMode==='multi' ? `みんなと対戦 (${netState.capacity}人)` : '1人でプレイ');
  }
}

/* ===== 前回の選択(マップ / プレイモード / 参戦するモンスター)を憶えておく =====
   毎回選び直す手間を無くすため、選ぶたびに保存して起動時に復元する。
   **端末ごとの操作の好みなのでアカウント同期には入れない**(視点設定と同じ扱い)。
   値は復元時に必ず存在チェックする(消したマスモン・古いマップキーが残っていても壊れないように)。 */
const LOBBY_PREFS_KEY = 'aramon_lobby_prefs_v1';
/* 【必須】復元が済むまでは保存しない。
   起動時のトップレベルで `setRealMapMode(false)` などの初期化が走り、その中から
   saveLobbyPrefs() が呼ばれる。復元より先なので、**前回の選択が既定値で上書きされて
   消えていた**(記憶しているのに毎回ランダム・ソロで始まる、という不具合の原因)。 */
let lobbyPrefsReady = false;
function saveLobbyPrefs(){
  if(!lobbyPrefsReady) return;
  try{
    localStorage.setItem(LOBBY_PREFS_KEY, JSON.stringify({
      map: game.selectedMap, real: !!game.realMapMode,
      // 保存するのは「ロビーで選んだもの」。試合中に変わる netState を見ない
      // (レイドを1回遊ぶと以降ずっと raid で保存される、という不具合の原因だった)
      mode: lobbyMode,
      cap: netState.capacity,
      mmKey: game.selectedMastermonKey || null,
      element: game.selectedElement || null,
    }));
  }catch(err){}
}
/* 復元は「あれば嬉しい」機能なので、中で何が起きても起動は止めない。
   丸ごとtry-catchで包み、失敗したら初期値のままロビーを開く。 */
function restoreLobbyPrefs(){
  try{ restoreLobbyPrefsInner(); }
  catch(err){ console.warn('前回の選択の復元に失敗', err); }
  finally{ lobbyPrefsReady = true; }   // ここから先の選択は保存する
}
function restoreLobbyPrefsInner(){
  let p = null;
  try{ p = JSON.parse(localStorage.getItem(LOBBY_PREFS_KEY)); }catch(err){}
  if(!p) return;
  // --- 参戦するモンスター(マスモン優先。消えていればモンスター単体で復元) ---
  const mms = (typeof loadMastermons==='function') ? loadMastermons() : {};
  if(p.mmKey && mms[p.mmKey]){
    game.selectedElement = p.mmKey;
    game.selectedMastermonKey = p.mmKey;
  } else if(p.element && ELEMENTS[p.element]){
    game.selectedElement = p.element;
    game.selectedMastermonKey = null;
  }
  // --- マップ(通常/リアルの切替も) ---
  /* 保存されているのは「通常マップのキー」か 'random' だけ。リアルかどうかは p.real が持つ。
     レイド専用マップやリアル版のキーが混ざっていたら受け付けない
     (受け付けるとマップタブのどれとも一致せず、選択と表示が食い違う)。 */
  if(p.map === 'random' || (isSelectableMap(p.map) && !MAPS[p.map].real3d)){
    game.selectedMap = p.map;
    document.querySelectorAll('.map-tab').forEach(t=> t.classList.toggle('active', t.dataset.map===p.map));
  }
  setRealMapMode(!!p.real);
  // --- 人数(プレイモードより先に。selectModeTabが表示を作り直すため) ---
  if(typeof p.cap==='number' && p.cap>=2){
    netState.capacity = p.cap;
    document.querySelectorAll('.cap-tab').forEach(t=> t.classList.toggle('active', Number(t.dataset.cap)===p.cap));
  }
  // --- プレイモード。レイドは開催が終わっていることがあるのでソロへ落とす ---
  let mode = p.mode==='raid' || p.mode==='multi' ? p.mode : 'solo';
  if(mode==='raid' && !(typeof raidPlayable==='function' && raidPlayable(raidMyAccountName()))) mode = 'solo';
  setLobbyMode(mode, { save:false });   // 復元中は保存し返さない
  updatePlayButtonsEnabled();
  if(typeof renderSelectorCards==='function') renderSelectorCards();
  updateLobbyPickLabels();
}

// ---- 中央: 選択中モンスターの正面歩行モーション ----
// 選択中が「マスモン」なら装備スキン込みの姿、「モンスター一覧」なら素の姿を出す。
// 歩行コマが未対応/未ロードなら静止画にフォールバックする。
let lobbyWalkTimer = null;
let lobbyWalkRetry = 0;
function stopLobbyWalkAnim(){ if(lobbyWalkTimer){ clearInterval(lobbyWalkTimer); lobbyWalkTimer = null; } }
function lobbySelectedSkinId(){
  // マスモンで参戦するときだけ装備スキンを反映する(モンスター一覧は素のモンスターを選ぶ画面)
  if(!game.selectedMastermonKey || typeof getEquippedSkin!=='function') return null;
  return getEquippedSkin(game.selectedMastermonKey) || null;
}
function renderLobbyMonster(){
  const img = document.getElementById('lobbyMonsterImg');
  const empty = document.getElementById('lobbyMonsterEmpty');
  const nameEl = document.getElementById('lobbyMonsterName');
  const hint = document.getElementById('lobbyMonsterTapHint');
  if(!img) return;
  stopLobbyWalkAnim();
  const key = game.selectedElement;
  if(!key || !ELEMENTS[key]){
    img.classList.add('hidden');
    empty.classList.remove('hidden');
    if(hint) hint.classList.add('hidden');
    nameEl.textContent = '';
    return;
  }
  empty.classList.add('hidden');
  img.classList.remove('hidden');
  if(hint) hint.classList.remove('hidden');

  // 名前(マスモンなら「マスモン名(種族)Lv.n」)
  const el = ELEMENTS[key];
  if(game.selectedMastermonKey){
    const mm = loadMastermons()[game.selectedMastermonKey];
    nameEl.innerHTML = mm
      ? `${mm.name}<span class="lobby-mon-sub">${el.label} / Lv.${mm.level}</span>`
      : el.label;
  } else {
    nameEl.textContent = el.label;
  }

  const skinId = lobbySelectedSkinId();
  // まず静止画を出しておく(歩行コマの用意ができ次第、下でコマ送りに差し替える)
  const still = skinId && typeof skinnedIconDataUrl==='function' ? skinnedIconDataUrl(skinId) : null;
  img.src = still || imgSrcFor(`monsters/${key}`);

  const frames = (typeof monsterWalkFrameDataUrls==='function')
    ? monsterWalkFrameDataUrls(key, skinId, 'front') : null;
  if(!frames || !frames.length){
    // 画像の読み込み待ちのことがあるので少しリトライする
    if(lobbyWalkRetry < 6){
      lobbyWalkRetry++;
      setTimeout(()=>{ if(!document.getElementById('startScreen').classList.contains('hidden')) renderLobbyMonster(); }, 350);
    }
    return;
  }
  lobbyWalkRetry = 0;
  let i = 0;
  img.src = frames[0];
  const dur = (typeof WALK_FRAME_DUR==='number' ? WALK_FRAME_DUR : 0.11) * 1000;
  lobbyWalkTimer = setInterval(()=>{
    i = (i + 1) % frames.length;
    img.src = frames[i];
  }, dur);
}

// ---- 左下バナー(3秒ごとに切り替えてループ) ----
let lobbyBannerTimer = null;
let lobbyBannerIdx = 0;
function buildLobbyBanner(){
  const track = document.getElementById('lobbyBannerTrack');
  const dots = document.getElementById('lobbyBannerDots');
  if(!track || typeof LOBBY_BANNERS==='undefined') return;
  track.innerHTML = LOBBY_BANNERS.map((b,i)=>`
    <div class="lobby-banner-card ${i===0?'active':''}" data-i="${i}" data-open="${b.open||''}">
      <div class="lobby-banner-face" style="background-image:url('${b.img}');background-size:${b.size||'cover'};background-position:${b.pos||'50% 40%'}"></div>
      <div class="lobby-banner-shade"></div>
      <div class="lobby-banner-rar">${b.rar||'SSR'}</div>
      <div class="lobby-banner-foot">
        <span class="lobby-banner-name">${b.name}</span>
        <span class="lobby-banner-tag">${b.tag}</span>
      </div>
    </div>`).join('');
  dots.innerHTML = LOBBY_BANNERS.map((_,i)=>`<div class="ml-dot ${i===0?'active':''}"></div>`).join('');
  dots.classList.toggle('hidden', LOBBY_BANNERS.length <= 1);
  track.querySelectorAll('.lobby-banner-card').forEach(card=>{
    card.addEventListener('click', ()=>{
      const to = card.dataset.open;
      if(to==='gacha') document.getElementById('openGachaBtn').click();
      else if(to==='season') document.getElementById('openSeasonBtn').click();
      else if(to==='shop') document.getElementById('openShopBtn').click();
    });
  });
  lobbyBannerIdx = 0;
}
function showLobbyBanner(i){
  const track = document.getElementById('lobbyBannerTrack');
  const dots = document.getElementById('lobbyBannerDots');
  if(!track) return;
  const cards = track.children, dotEls = dots.children;
  for(let n=0;n<cards.length;n++) cards[n].classList.toggle('active', n===i);
  for(let n=0;n<dotEls.length;n++) dotEls[n].classList.toggle('active', n===i);
  lobbyBannerIdx = i;
}
function startLobbyBannerLoop(){
  stopLobbyBannerLoop();
  if(typeof LOBBY_BANNERS==='undefined' || LOBBY_BANNERS.length<=1) return;
  const ms = (typeof LOBBY_BANNER_MS==='number') ? LOBBY_BANNER_MS : 3000;
  lobbyBannerTimer = setInterval(()=>{
    showLobbyBanner((lobbyBannerIdx + 1) % LOBBY_BANNERS.length);
  }, ms);
}
function stopLobbyBannerLoop(){ if(lobbyBannerTimer){ clearInterval(lobbyBannerTimer); lobbyBannerTimer = null; } }

/* ===== 募集中の部屋の「待っている人がいる」バッジ =====
   マルチもレイドも、部屋を立てても相手が気づかなければ成立しない。ロビーを開いている間だけ
   lobby を見に行き、ボタンへ待機人数を出す。**ロビーが隠れたら必ず止める**(試合中に通信しない)。
   数えるのは __aramonListOpenRooms が返す募集中の部屋の人数合計で、
   'br'(通常マルチ)と 'raid' は別のボタンに出す。自分が立てた部屋も入るが、
   自分がロビーに戻っている＝その部屋はもう無い(onDisconnectで消える)ので実害はない。 */
const LOBBY_ROOM_POLL_MS = 15000;
let lobbyRoomPollTimer = null;
function setWaitBadge(id, people){
  const el = document.getElementById(id);
  if(!el) return;
  // 文言は短く固定する(左メニューのボタン幅は最小104pxしかないため)
  el.textContent = people>0 ? `${people}人` : '';
  el.classList.toggle('hidden', people<=0);
}
async function updateLobbyRoomBadges(){
  if(!window.__aramonListOpenRooms) return;
  try{
    const [br, raid] = await Promise.all([
      window.__aramonListOpenRooms('br'), window.__aramonListOpenRooms('raid'),
    ]);
    const sum = (rooms)=> (rooms||[]).reduce((a,r)=> a + (r.count||0), 0);
    setWaitBadge('multiWaitBadge', sum(br));
    // レイドのバッジは、そもそもレイドボタンが出ている(=開催中)ときだけ意味がある
    const raidBtn = document.getElementById('openRaidBtn');
    const raidVisible = raidBtn && !raidBtn.classList.contains('hidden');
    setWaitBadge('raidWaitBadge', raidVisible ? sum(raid) : 0);
  }catch(err){ /* 取得できない時はバッジを触らない(前の値のまま) */ }
}
function startLobbyRoomPoll(){
  if(lobbyRoomPollTimer) return;
  updateLobbyRoomBadges();
  lobbyRoomPollTimer = setInterval(updateLobbyRoomBadges, LOBBY_ROOM_POLL_MS);
}
function stopLobbyRoomPoll(){
  if(lobbyRoomPollTimer){ clearInterval(lobbyRoomPollTimer); lobbyRoomPollTimer = null; }
}

// トップ画面を表示/非表示にするたびに、歩行アニメとバナーのタイマーを合わせて動かす。
// 画面が隠れている間にタイマーを回し続けないため、MutationObserverで .hidden を監視する。
// ヘッダーのロビーBGMチップの表示を今の選択に合わせる
function updateLobbyBgmLabel(){
  const el = document.getElementById('headerBgmName');
  if(!el || typeof getLobbyBgmLabel!=='function') return;
  el.textContent = getLobbyBgmLabel();
}
/* ロビーBGM選択。並ぶ曲は audio.js の lobbyBgmChoices() が作るので、
   曲やSSRスキンを足してもここへの追記は要らない(手書きの対応表を作らない) */
function renderLobbyBgmList(){
  const list = document.getElementById('lobbyBgmList');
  if(!list || typeof lobbyBgmChoices!=='function') return;
  const cur = getLobbyBgmMode();
  list.innerHTML = lobbyBgmChoices().map(c=>{
    const on = c.id===cur;
    return `<button class="lobby-bgm-item${on?' active':''}${c.ssr?' ssr':''}" data-bgm="${c.id}">
      <span class="lobby-bgm-mark">${on?'▶':'🎵'}</span>
      <span class="lobby-bgm-text"><span class="lobby-bgm-name">${c.label}</span>
      <span class="lobby-bgm-sub">${c.note||''}</span></span></button>`;
  }).join('');
}
function openLobbyBgmOverlay(){
  if(typeof audioInit==='function') audioInit();   // タップ直後なのでここで音を起こしておく
  renderLobbyBgmList();
  document.getElementById('lobbyBgmOverlay').classList.remove('hidden');
}
function closeLobbyBgmOverlay(){ document.getElementById('lobbyBgmOverlay').classList.add('hidden'); }
function pickLobbyBgm(id){
  if(typeof setLobbyBgmMode==='function') setLobbyBgmMode(id);
  updateLobbyBgmLabel();
  renderLobbyBgmList();   // 選択中の印を付け替える(画面は開いたままで聴き比べられる)
}
function refreshLobby(){
  updateLobbyPickLabels();
  updateLobbyBgmLabel();
  renderLobbyMonster();
  startLobbyBannerLoop();
  startLobbyRoomPoll();
}


// ===== 音量設定(BGM/SE) =====
function syncAudioSliders(){
  document.getElementById('bgmVolSlider').value = Math.round(audioSettings.bgm*100);
  document.getElementById('seVolSlider').value = Math.round(audioSettings.se*100);
  document.getElementById('bgmVolVal').textContent = Math.round(audioSettings.bgm*100);
  document.getElementById('seVolVal').textContent = Math.round(audioSettings.se*100);
}
/* ===== 視点設定(視野角・左右/上下の感度) =====
   実体は world.js の lookSettings。ここでは保存/復元とスライダーの面倒を見る。
   端末ごとの操作設定なのでアカウント同期には入れない(更新履歴の既読と同じ扱い)。 */
const LOOK_LS_KEY = 'aramon_look_v1';
function loadLookSettings(){
  try{
    const raw = JSON.parse(localStorage.getItem(LOOK_LS_KEY) || '{}');
    for(const k of Object.keys(LOOK_DEFAULTS)){
      const lim = LOOK_LIMITS[k];
      if(typeof raw[k]==='number' && isFinite(raw[k])) lookSettings[k] = clamp(raw[k], lim[0], lim[1]);
    }
  }catch(e){}
  applyLookSettings();
}
function saveLookSettings(){
  try{ localStorage.setItem(LOOK_LS_KEY, JSON.stringify(lookSettings)); }catch(e){}
}
// スライダーは整数で扱う(感度は 0.0001 刻み = 表示値/10000)
const LOOK_SLIDERS = [
  { key:'fovDeg', slider:'fovSlider', val:'fovVal',  minus:'fovMinus',   plus:'fovPlus',   scale:1,     step:1 },
  { key:'sensX',  slider:'sensXSlider', val:'sensXVal', minus:'sensXMinus', plus:'sensXPlus', scale:10000, step:3 },
  { key:'sensY',  slider:'sensYSlider', val:'sensYVal', minus:'sensYMinus', plus:'sensYPlus', scale:10000, step:2 },
];
function syncLookSliders(){
  for(const s of LOOK_SLIDERS){
    const v = Math.round(lookSettings[s.key]*s.scale);
    document.getElementById(s.slider).value = v;
    document.getElementById(s.val).textContent = v;
  }
}
function setLookValue(s, rawVal){
  const lim = LOOK_LIMITS[s.key];
  lookSettings[s.key] = clamp(rawVal/s.scale, lim[0], lim[1]);
  applyLookSettings();
  syncLookSliders();
}
LOOK_SLIDERS.forEach(s=>{
  document.getElementById(s.slider).addEventListener('input', (e)=>setLookValue(s, +e.target.value));
  document.getElementById(s.slider).addEventListener('change', saveLookSettings);
  document.getElementById(s.minus).addEventListener('click', ()=>{ setLookValue(s, Math.round(lookSettings[s.key]*s.scale)-s.step); saveLookSettings(); });
  document.getElementById(s.plus ).addEventListener('click', ()=>{ setLookValue(s, Math.round(lookSettings[s.key]*s.scale)+s.step); saveLookSettings(); });
});
document.getElementById('lookResetBtn').addEventListener('click', ()=>{
  Object.assign(lookSettings, LOOK_DEFAULTS);
  applyLookSettings(); syncLookSliders(); saveLookSettings();
  pushToast('視点設定を初期値に戻しました');
});
function openLookSettings(){
  syncLookSliders();
  document.getElementById('lookSettingsOverlay').classList.remove('hidden');
}
document.getElementById('closeLookSettingsBtn').addEventListener('click', ()=>{
  document.getElementById('lookSettingsOverlay').classList.add('hidden');
  saveLookSettings();
});
loadLookSettings();

document.getElementById('audioSettingsBtn').addEventListener('click', ()=>{
  syncAudioSliders();
  document.getElementById('audioSettingsOverlay').classList.remove('hidden');
});
document.getElementById('closeAudioSettingsBtn').addEventListener('click', ()=>{
  document.getElementById('audioSettingsOverlay').classList.add('hidden');
  saveAudioSettings();
});

/* =====================================================================
   バトル操作画面カスタマイズ(HUD配置編集)
   - 各パーツ(ジョイスティック/各ボタン/各フィールド)を#hud基準の割合で保存し、
     次回以降のバトルに反映する。
   - 見た目とタップ判定のズレを防ぐため、判定は各DOM要素自身(=見た目そのもの)で
     行われる前提で「要素そのもの」を動かす。座標は回転(強制横向き)をtoLogicalDeltaで補正。
   ===================================================================== */
// 現在のtransformから拡縮率(scale)を取り出す
function hudElScale(el){
  const st = getComputedStyle(el);
  if(st.transform && st.transform!=='none'){ try{ return new DOMMatrixReadOnly(st.transform).m11 || 1; }catch(e){} }
  return 1;
}
// 位置(left/top)と拡縮(scale)をまとめて適用。scaleは左上基準にして位置の基準点をズラさない。
function hudApplyPosScale(el, left, top, s){
  el.style.left = left+'px'; el.style.top = top+'px';
  el.style.right='auto'; el.style.bottom='auto';
  el.style.transformOrigin = 'top left';
  el.style.transform = (s && Math.abs(s-1)>0.001) ? ('scale('+s+')') : 'none';
}
// 要素の現在の見た目(中央寄せtranslate等)を left/top へ畳み込み、拡縮scaleは保ったまま正規化する
// (ドラッグ開始時のガタつき防止。scaleは左上基準へ統一)
function hudFlattenElement(el){
  const st = getComputedStyle(el);
  let a=1, tx=0, ty=0;
  if(st.transform && st.transform!=='none'){
    try{ const m=new DOMMatrixReadOnly(st.transform); a=m.m11||1; tx=m.m41; ty=m.m42; }catch(e){}
  }
  hudApplyPosScale(el, el.offsetLeft + tx, el.offsetTop + ty, a);
}
// オートラン中ラベルはジョイスティックの真上に追従させる
function hudPositionAutoRunLabel(){
  const label = document.getElementById('autoRunLabel');
  const joy = document.getElementById('joystickBase');
  if(!label || !joy) return;
  const layout = loadHudLayout();
  if(layout.joystickBase && typeof layout.joystickBase.fx==='number'){
    const s = layout.joystickBase.s || 1;
    label.style.left = joy.style.left || (joy.offsetLeft+'px');
    label.style.width = (joy.offsetWidth*s)+'px';
    label.style.top = (joy.offsetTop - 30)+'px';
    label.style.bottom = 'auto';
  } else {
    label.style.left=''; label.style.top=''; label.style.width=''; label.style.bottom='';
  }
}
// 保存済みレイアウト(位置fx,fy＋サイズs)をHUDへ反映(未設定の要素はCSSデフォルトに戻す)
function applyHudLayout(){
  const hud = document.getElementById('hud');
  if(!hud || typeof HUD_DRAGGABLE_IDS==='undefined') return;
  const layout = loadHudLayout();
  const hudW = hud.offsetWidth || 1, hudH = hud.offsetHeight || 1;
  for(const id of HUD_DRAGGABLE_IDS){
    const el = document.getElementById(id);
    if(!el) continue;
    const pos = layout[id];
    if(pos && typeof pos.fx==='number' && typeof pos.fy==='number'){
      const maxX = Math.max(0, hudW - el.offsetWidth), maxY = Math.max(0, hudH - el.offsetHeight);
      hudApplyPosScale(el, clamp(pos.fx*hudW, 0, maxX), clamp(pos.fy*hudH, 0, maxY), pos.s || 1);
    } else {
      el.style.left=''; el.style.top=''; el.style.right=''; el.style.bottom=''; el.style.transform=''; el.style.transformOrigin='';
    }
  }
  hudPositionAutoRunLabel();
}

let hudEditDraft = null;
let hudDrag = null;
let hudSelectedId = null;
// 編集中の選択パーツを更新(枠を強調＋操作パネルに名前表示)
function hudSelect(id){
  hudSelectedId = id;
  for(const k of HUD_DRAGGABLE_IDS){ const el=document.getElementById(k); if(el) el.classList.toggle('hud-selected', k===id); }
  const selEl = document.getElementById('hudCustSel');
  if(selEl) selEl.textContent = id ? (HUD_DRAGGABLE[id]||'パーツ') : '(パーツを選択)';
}
// 選択中パーツのサイズを±調整(0.6〜2.0倍)。当たり判定もscaleで一緒に拡縮されるためズレない。
function hudResizeSelected(delta){
  if(!hudSelectedId) return;
  const el = document.getElementById(hudSelectedId);
  if(!el) return;
  const hud = document.getElementById('hud');
  const hudW = hud.offsetWidth||1, hudH = hud.offsetHeight||1;
  const ns = clamp(Math.round((hudElScale(el)+delta)*100)/100, 0.6, 2.0);
  el.style.transformOrigin='top left';
  el.style.transform = (Math.abs(ns-1)>0.001) ? ('scale('+ns+')') : 'none';
  if(hudEditDraft){
    const d = hudEditDraft[hudSelectedId] || {};
    if(typeof d.fx!=='number') d.fx = el.offsetLeft/hudW;
    if(typeof d.fy!=='number') d.fy = el.offsetTop/hudH;
    d.s = ns; hudEditDraft[hudSelectedId] = d;
  }
  if(hudSelectedId==='joystickBase') hudPositionAutoRunLabel();
}
function enterHudCustomize(){
  if(game.started) return; // バトル中は不可(トップ画面から入る)
  hudEditDraft = JSON.parse(JSON.stringify(loadHudLayout()));
  applyHudLayout();
  document.getElementById('startScreen').classList.add('hidden');
  document.documentElement.classList.add('hud-editing');
  document.getElementById('hudCustomizeBar').classList.remove('hidden');
  // 各対象を left/top へ正規化(scaleは保持)し、ドラッグ可能マーク＆ラベルを付与
  for(const id of HUD_DRAGGABLE_IDS){
    const el = document.getElementById(id);
    if(!el) continue;
    hudFlattenElement(el);
    el.dataset.hudDrag = '1';
    el.dataset.hudLabel = HUD_DRAGGABLE[id] || '';
  }
  hudSelect(null);
}
function exitHudCustomize(save){
  if(save && hudEditDraft) saveHudLayout(hudEditDraft);
  hudEditDraft = null; hudDrag = null;
  document.documentElement.classList.remove('hud-editing');
  document.getElementById('hudCustomizeBar').classList.add('hidden');
  for(const id of HUD_DRAGGABLE_IDS){
    const el = document.getElementById(id);
    if(el){ delete el.dataset.hudDrag; delete el.dataset.hudLabel; el.classList.remove('hud-dragging'); el.classList.remove('hud-selected'); }
  }
  hudSelectedId = null;
  applyHudLayout(); // 保存後(またはキャンセルで元に戻して)反映
  document.getElementById('startScreen').classList.remove('hidden');
}
function resetHudCustomize(){
  hudEditDraft = {};
  for(const id of HUD_DRAGGABLE_IDS){
    const el = document.getElementById(id);
    if(el){ el.style.left=''; el.style.top=''; el.style.right=''; el.style.bottom=''; el.style.transform=''; el.style.transformOrigin=''; }
  }
  // 反映(CSSデフォルト)後、続けて編集できるよう再度フラット化
  for(const id of HUD_DRAGGABLE_IDS){ const el=document.getElementById(id); if(el) hudFlattenElement(el); }
  hudSelect(null);
  hudPositionAutoRunLabel();
}
// ドラッグ: captureで最初に拾い、ゲーム側のジョイスティック等のハンドラより先に処理する
document.addEventListener('pointerdown', (e)=>{
  if(!document.documentElement.classList.contains('hud-editing')) return;
  const el = e.target.closest('[data-hud-drag]');
  if(!el) return;
  e.preventDefault(); e.stopPropagation();
  hudSelect(el.id); // 触れたパーツを選択(サイズ調整の対象になる)
  const hud = document.getElementById('hud');
  const s = hudElScale(el);
  hudDrag = { el, pid:e.pointerId, sx:e.clientX, sy:e.clientY,
    startLeft:el.offsetLeft, startTop:el.offsetTop,
    hudW:hud.offsetWidth||1, hudH:hud.offsetHeight||1,
    w:el.offsetWidth*s, h:el.offsetHeight*s }; // 論理サイズ(拡縮込み)で画面内クランプ
  try{ el.setPointerCapture(e.pointerId); }catch(_){}
  el.classList.add('hud-dragging');
}, true);
window.addEventListener('pointermove', (e)=>{
  if(!hudDrag || e.pointerId!==hudDrag.pid) return;
  const ld = toLogicalDelta(e.clientX-hudDrag.sx, e.clientY-hudDrag.sy);
  const nl = clamp(hudDrag.startLeft+ld.x, 0, Math.max(0, hudDrag.hudW-hudDrag.w));
  const nt = clamp(hudDrag.startTop +ld.y, 0, Math.max(0, hudDrag.hudH-hudDrag.h));
  // 位置のみ更新(transform=scaleはそのまま維持)
  hudDrag.el.style.left=nl+'px'; hudDrag.el.style.top=nt+'px';
  hudDrag.el.style.right='auto'; hudDrag.el.style.bottom='auto';
  if(hudDrag.el.id==='joystickBase') hudPositionAutoRunLabel();
});
function hudDragEnd(e){
  if(!hudDrag || (e && e.pointerId!==hudDrag.pid)) return;
  const el = hudDrag.el;
  el.classList.remove('hud-dragging');
  if(hudEditDraft) hudEditDraft[el.id] = { fx: el.offsetLeft/hudDrag.hudW, fy: el.offsetTop/hudDrag.hudH, s: hudElScale(el) };
  hudDrag = null;
}
window.addEventListener('pointerup', hudDragEnd);
window.addEventListener('pointercancel', hudDragEnd);
document.getElementById('openHudCustomizeBtn').addEventListener('click', enterHudCustomize);
document.getElementById('hudCustSaveBtn').addEventListener('click', ()=>exitHudCustomize(true));
document.getElementById('hudCustCancelBtn').addEventListener('click', ()=>exitHudCustomize(false));
document.getElementById('hudCustResetBtn').addEventListener('click', resetHudCustomize);
document.getElementById('hudCustSizeUp').addEventListener('click', ()=>hudResizeSelected(+0.1));
document.getElementById('hudCustSizeDown').addEventListener('click', ()=>hudResizeSelected(-0.1));
applyHudLayout(); // 起動時に反映
document.getElementById('bgmVolSlider').addEventListener('input', (e)=>{
  audioSettings.bgm = (+e.target.value)/100;
  document.getElementById('bgmVolVal').textContent = e.target.value;
  applyAudioVolumes();
});
document.getElementById('bgmVolSlider').addEventListener('change', ()=>saveAudioSettings());
document.getElementById('seVolSlider').addEventListener('input', (e)=>{
  audioSettings.se = (+e.target.value)/100;
  document.getElementById('seVolVal').textContent = e.target.value;
  applyAudioVolumes();
});
document.getElementById('seVolSlider').addEventListener('change', ()=>{ saveAudioSettings(); playSe('pickup'); }); // 音量確認用に試し鳴らし
// ±ボタンで1ずつ調整
function nudgeVolume(key, delta){
  const v = Math.min(100, Math.max(0, Math.round(audioSettings[key]*100) + delta));
  audioSettings[key] = v/100;
  applyAudioVolumes();
  saveAudioSettings();
  syncAudioSliders();
}
document.getElementById('bgmVolMinus').addEventListener('click', ()=>nudgeVolume('bgm', -1));
document.getElementById('bgmVolPlus').addEventListener('click', ()=>nudgeVolume('bgm', +1));
document.getElementById('seVolMinus').addEventListener('click', ()=>nudgeVolume('se', -1));
document.getElementById('seVolPlus').addEventListener('click', ()=>nudgeVolume('se', +1));

// ===== プレイヤーアカウント(名前+パスコードでログイン・サーバー同期) =====
const ACCOUNT_CRED_KEY = 'aramon_account_v1';        // 自動ログイン用の認証情報
const ACCOUNT_LOCAL_TS_KEY = 'aramon_account_ts_v1'; // ローカルデータの最終更新時刻
// サーバーに同期するlocalStorageキー(音量などの端末固有設定は同期しない)。
// ※このコードはPLAYER_NAME_KEY等の宣言より前に実行されるため、キー名は文字列で直接指定する
const ACCOUNT_SYNC_KEYS = ['aramon_mastermons_v1','aramon_local_stats_v1','aramon_player_name_v1','aramon_wallet_v1','aramon_bag_v1','aramon_skins_v1','aramon_catalogs_v1','aramon_gachacount_v1','aramon_promo_skingacha_v1','aramon_promo_rockssr_v1','aramon_titles_v1','aramon_daily_v1','aramon_season_v1','aramon_raid_v1','aramon_raidgachacount_v1'];
const accountState = { loggedIn:false, name:null, key:null, pass:null, syncTimer:null };

function loadAccountCreds(){ try{ return JSON.parse(localStorage.getItem(ACCOUNT_CRED_KEY)); }catch(err){ return null; } }
function saveAccountCreds(c){ try{ localStorage.setItem(ACCOUNT_CRED_KEY, JSON.stringify(c)); }catch(err){} }

function collectAccountData(){
  const out = {};
  for(const k of ACCOUNT_SYNC_KEYS){
    const v = localStorage.getItem(k);
    if(v!=null) out[k] = v;
  }
  return out;
}
function applyAccountData(d){
  if(!d) return;
  for(const k of ACCOUNT_SYNC_KEYS){
    if(d[k]!=null){ try{ localStorage.setItem(k, d[k]); }catch(err){} }
  }
  const savedName = localStorage.getItem('aramon_player_name_v1');
  if(savedName!=null) document.getElementById('playerNameInput').value = savedName;
  renderSelectorCards();
  updateAccountBar();
}
// ローカルデータが更新された時に呼ばれる。ログイン中ならデバウンスしてサーバーへ送信
function accountMarkDirty(){
  try{ localStorage.setItem(ACCOUNT_LOCAL_TS_KEY, String(Date.now())); }catch(err){}
  updateAccountBar();
  if(!accountState.loggedIn) return;
  clearTimeout(accountState.syncTimer);
  accountState.syncTimer = setTimeout(accountSyncNow, 3000);
}
async function accountSyncNow(){
  if(!accountState.loggedIn || !window.__aramonUpdateAccountData) return;
  try{ await window.__aramonUpdateAccountData(accountState.key, collectAccountData()); }catch(err){}
}
function updateAccountBar(){
  const w = loadWallet();
  // 上部ヘッダー: アカウント名・ゴールド・ダイヤ
  document.getElementById('headerAccountName').textContent = accountState.loggedIn ? accountState.name : 'ゲスト';
  document.getElementById('headerGold').textContent = `🪙 ${w.gold}`;
  document.getElementById('headerDia').textContent = `💎 ${w.dia}`;
  // アカウントボタンはマイページの中に常設。文言だけログイン状態で切り替える
  const btn = document.getElementById('accountLoginBtn');
  const label = btn.querySelector('.lobby-menu-text b');
  if(label) label.textContent = accountState.loggedIn ? 'アカウント' : 'ログイン / アカウント作成';
  btn.classList.toggle('logged-in', accountState.loggedIn);
  // ログイン中はランキング表示名の入力欄を隠す(アカウント名を表示名として使う)
  document.getElementById('playerNameLabel').classList.toggle('hidden', accountState.loggedIn);
  document.getElementById('playerNameInput').classList.toggle('hidden', accountState.loggedIn);
  if(typeof updateHeaderTitle==='function') updateHeaderTitle();
}
// アカウント名をランキング表示名として反映する(入力欄は非表示でも値は参照される)
function applyAccountNameAsDisplayName(name){
  document.getElementById('playerNameInput').value = name;
  try{ localStorage.setItem('aramon_player_name_v1', name); }catch(err){}
}
function accountShowMsg(text, ok){
  const el = document.getElementById('accountMsg');
  el.textContent = text;
  el.classList.toggle('ok', !!ok);
  el.classList.remove('hidden');
}
document.getElementById('accountLoginBtn').addEventListener('click', ()=>{
  document.getElementById('accountNameInput').value = accountState.name || document.getElementById('playerNameInput').value.trim();
  document.getElementById('accountPassInput').value = '';
  document.getElementById('accountMsg').classList.add('hidden');
  document.getElementById('accountLogoutBtn').classList.toggle('hidden', !accountState.loggedIn);
  document.getElementById('accountOverlay').classList.remove('hidden');
});
document.getElementById('accountCancelBtn').addEventListener('click', ()=>{
  document.getElementById('accountOverlay').classList.add('hidden');
});
document.getElementById('accountLogoutBtn').addEventListener('click', ()=>{
  accountState.loggedIn = false; accountState.name = null; accountState.key = null; accountState.pass = null;
  try{ localStorage.removeItem(ACCOUNT_CRED_KEY); }catch(err){}
  document.getElementById('accountOverlay').classList.add('hidden');
  updateAccountBar();
  pushToast('ログアウトしました');
});
document.getElementById('accountSubmitBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('accountNameInput').value.trim();
  const pass = document.getElementById('accountPassInput').value.trim();
  if(!name){ accountShowMsg('プレイヤー名を入力してください'); return; }
  if(!/^\d{4}$/.test(pass)){ accountShowMsg('パスコードは4桁の数字で入力してください'); return; }
  if(!window.__aramonGetAccount){ accountShowMsg('通信の準備中です。少し待ってからもう一度お試しください'); return; }
  const key = window.__aramonAccountKey(name);
  accountShowMsg('確認中…', true);
  try{
    const acc = await window.__aramonGetAccount(key);
    if(!acc){
      // 新規作成: 現在のローカルデータをサーバーに保存
      // 名前入力欄もアカウント名に合わせておく(ランキング表示名と一致させる)
      document.getElementById('playerNameInput').value = name;
      try{ localStorage.setItem('aramon_player_name_v1', name); }catch(err){}
      await window.__aramonSetAccount(key, {
        name, pass, createdAt: Date.now(), updatedAt: Date.now(), data: collectAccountData(),
      });
      accountState.loggedIn = true; accountState.name = name; accountState.key = key; accountState.pass = pass;
      saveAccountCreds({ name, key, pass });
      updateAccountBar();
      accountShowMsg('アカウントを作成しました！今後は自動でログインします', true);
      pushToast(`ようこそ、${name}！`);
      promoOryouResetIfNeeded(name);
      maybeShowSkinGachaPromo();
      maybeShowRockSsrPromo();
    } else if(String(acc.pass) === pass){
      // ログイン: サーバーのデータを取り込む
      accountState.loggedIn = true; accountState.name = acc.name; accountState.key = key; accountState.pass = pass;
      saveAccountCreds({ name: acc.name, key, pass });
      applyAccountData(acc.data);
      applyAccountNameAsDisplayName(acc.name);
      updateAccountBar();
      accountShowMsg('ログインしました！', true);
      pushToast(`おかえりなさい、${acc.name}！`);
      promoOryouResetIfNeeded(acc.name);
      maybeShowSkinGachaPromo();
      maybeShowRockSsrPromo();
    } else {
      // 名前の重複検知: 別人のアカウントが存在する
      accountShowMsg('この名前は既に使われています。別の名前に変えるか、心当たりがあれば正しいパスコードを入力してください');
    }
  }catch(err){
    accountShowMsg('通信に失敗しました。電波の良いところでもう一度お試しください');
  }
});
// 自動ログイン: 保存済みの認証情報でサーバーと同期(Firebase読み込み完了までリトライ)
// アプリ更新(controllerchangeでのリロード)直後はfirebase.js(module)やCDNの読み込みが
// 遅れることがあるため、リトライ回数を十分に確保する。
(function accountAutoLogin(){
  const creds = loadAccountCreds();
  if(!creds || !creds.key) return;
  // 認証情報がある時点で、通信完了前でもログイン済みとしてUIを更新しておく
  // (これをしないと、データ取得が遅い/失敗したときにログアウト状態に見えてしまう)
  accountState.loggedIn = true; accountState.name = creds.name; accountState.key = creds.key; accountState.pass = creds.pass;
  applyAccountNameAsDisplayName(creds.name);
  updateAccountBar();
  let tries = 0;
  const attempt = async ()=>{
    if(!window.__aramonGetAccount){
      if(++tries < 240) setTimeout(attempt, 500); // 最大約2分リトライ
      return;
    }
    try{
      const acc = await window.__aramonGetAccount(creds.key);
      if(acc && String(acc.pass) === String(creds.pass)){
        accountState.name = acc.name;
        const localTs = +(localStorage.getItem(ACCOUNT_LOCAL_TS_KEY)||0);
        if((acc.updatedAt||0) >= localTs){
          try{ applyAccountData(acc.data); }catch(e){} // サーバーの方が新しい→取り込む(失敗してもログイン状態は維持)
        } else {
          accountMarkDirty(); // ローカルの方が新しい(オフラインでプレイ等)→サーバーへ送る
        }
        applyAccountNameAsDisplayName(acc.name);
        updateAccountBar();
        promoOryouResetIfNeeded(acc.name);
        maybeShowSkinGachaPromo();   // ログイン中アカウントに記念ダイヤ+ポップアップ(一度だけ)
        maybeShowRockSsrPromo();  // SSR轟金剛実装記念ダイヤ+ポップアップ(一度だけ)
      } else if(acc && String(acc.pass) !== String(creds.pass)){
        // パスコードが変更された等でサーバーと不一致→ログイン解除
        accountState.loggedIn = false; accountState.key = null; accountState.pass = null;
        updateAccountBar();
      }
      // acc が取得できなかった(通信失敗・一時的にnull)場合は、端末の認証情報を信じてログイン状態を維持
    }catch(err){}
  };
  attempt();
})();

// ===== バッグ =====
let bagSelectedItem = null; // 説明フィールドに表示中のアイテムキー
document.getElementById('openBagBtn').addEventListener('click', ()=>{
  bagSelectedItem = null;   // renderBagで先頭アイテムを自動選択→一覧+ゲージが最初から表示
  bagPicker.targetKey = null; // 開き直したときは対象マスモン未選択から(アイテム切替では維持する)
  renderBag();
  showBagGoTrainBtn(null);  // 前回のジャンプボタンを持ち越さない
  bagShowTab('item'); // 開くたびアイテムタブから
  document.getElementById('bagOverlay').classList.remove('hidden');
});
// バッグのタブ切替(アイテム / スキン / 称号)
function bagShowTab(tab){
  document.querySelectorAll('.bag-tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===tab));
  document.getElementById('bagItemPane').classList.toggle('hidden', tab!=='item');
  document.getElementById('bagSkinPane').classList.toggle('hidden', tab!=='skin');
  document.getElementById('bagTitlePane').classList.toggle('hidden', tab!=='title');
  if(tab==='skin') renderBagSkins();
  else if(tab==='title') renderBagTitles();
}
// 称号一覧(獲得済みを上に、未獲得は解放条件を表示。タップで装着トグル)
function renderBagTitles(){
  const grid = document.getElementById('bagTitleGrid');
  if(!grid || typeof TITLES==='undefined') return;
  if(typeof checkTitleUnlocks==='function') checkTitleUnlocks(); // 開いた時点の実績を反映(SSR所持/全属性など)
  const t = loadTitles();
  const hint = document.getElementById('bagTitleHint');
  const eqCount = (t.equipped||[]).length;
  if(hint){
    const cnt = TITLES.filter(d=>t.unlocked[d.id]).length;
    hint.textContent = `獲得 ${cnt} / ${TITLES.length}　タップで装着(もう一度で外す・最大${TITLE_EQUIP_MAX}つ ${eqCount}/${TITLE_EQUIP_MAX})。装着中はアイコンが名前の横に表示されます。`;
  }
  const list = TITLES.slice().sort((a,b)=>{
    const ua = t.unlocked[a.id]?0:1, ub = t.unlocked[b.id]?0:1;
    return ua-ub; // 獲得済みを先頭へ(同順はカタログ順維持)
  });
  grid.innerHTML = list.map(def=>{
    const owned = !!t.unlocked[def.id];
    const eq = owned && (t.equipped||[]).includes(def.id);
    return `<button class="bag-title-cell ${owned?'owned':'locked'} ${eq?'equipped':''}" data-title="${def.id}" ${owned?'':'disabled'}>
      <span class="bag-title-emoji">${owned?def.emoji:'🔒'}</span>
      <span class="bag-title-name">${owned?def.name:'？？？'}</span>
      <span class="bag-title-cond">${titleCondText(def)}</span>
      ${eq?'<span class="bag-title-eqbadge">装着中</span>':''}
    </button>`;
  }).join('');
  grid.querySelectorAll('.bag-title-cell.owned').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.dataset.title;
      const tt = loadTitles();
      const arr = tt.equipped || [];
      const idx = arr.indexOf(id);
      if(idx>=0){ arr.splice(idx,1); } // 装着解除
      else if(arr.length < TITLE_EQUIP_MAX){ arr.push(id); } // 装着
      else { if(typeof pushToast==='function') pushToast(`称号は最大${TITLE_EQUIP_MAX}つまで装着できます`); return; }
      tt.equipped = arr;
      saveTitles(tt);
      renderBagTitles();
      updateHeaderTitle();
    });
  });
}
// 装着中の称号(最大3つ)をトップヘッダーのプレイヤー名の横にアイコンのみで表示
function updateHeaderTitle(){
  const chip = document.getElementById('headerTitleChip');
  if(!chip || typeof loadTitles!=='function') return;
  const t = loadTitles();
  const ids = t.equipped || [];
  const emojis = ids.map(id=> TITLES_BY_ID[id] ? TITLES_BY_ID[id].emoji : '').filter(Boolean);
  if(emojis.length){ chip.textContent = emojis.join(''); chip.classList.remove('hidden'); }
  else { chip.textContent = ''; chip.classList.add('hidden'); }
}
document.querySelectorAll('.bag-tab').forEach(tab=>{
  tab.addEventListener('click', ()=> bagShowTab(tab.dataset.tab));
});
// ===== スキンのプレビュー(正面=アイコン / 後ろ姿=試合中)を大きく表示 =====
// バッグ・ガチャ結果・カタログ・シーズン報酬など、スキンをタップしたら共通で開く
let skinPreviewSelect = null; // カタログからのプレビュー時のみ「選ぶ」ボタンのコールバックを保持
function skinPreviewSrc(skinId, view){
  const url = view==='back' ? skinnedPlayerDataUrl(skinId) : skinnedIconDataUrl(skinId);
  if(url) return url;
  // フォールバック: 画像がまだdataURL化されていない場合、SSRは元ファイルを直接読む
  if(SSR_SKINS[skinId]){ const s = SSR_SKINS[skinId]; return `monsters/${view==='back'? s.playerImg : s.iconImg}.png`; }
  return '';
}
// プレビューの歩行モーション再生。正面・後ろの2枚を同じタイマーでコマ送りする。
// 歩行コマが未用意/未ロードのスキンは静止画のままにする(数回だけロードを待って再試行)。
let skinPreviewAnimTimer = null, skinPreviewAnimRetry = null;
const SKIN_PREVIEW_FRAME_MS = (typeof WALK_FRAME_DUR==='number' ? WALK_FRAME_DUR : 0.11) * 1000;
function stopSkinPreviewAnim(){
  if(skinPreviewAnimTimer){ clearInterval(skinPreviewAnimTimer); skinPreviewAnimTimer = null; }
  if(skinPreviewAnimRetry){ clearTimeout(skinPreviewAnimRetry); skinPreviewAnimRetry = null; }
}
function startSkinPreviewAnim(skinId, tries){
  stopSkinPreviewAnim();
  if(typeof skinWalkFrameDataUrls!=='function') return;
  const frontEl = document.getElementById('skinPreviewFront');
  const backEl  = document.getElementById('skinPreviewBack');
  const front = skinWalkFrameDataUrls(skinId, 'front');
  const back  = skinWalkFrameDataUrls(skinId, 'back');
  if(!front && !back){
    // 画像の読み込み待ちの可能性があるので少し待って再試行(上限あり)
    if((tries||0) < 6){
      skinPreviewAnimRetry = setTimeout(()=>{ skinPreviewAnimRetry = null; startSkinPreviewAnim(skinId, (tries||0)+1); }, 350);
    }
    return;
  }
  let i = 0;
  const tick = ()=>{
    if(document.getElementById('skinPreviewOverlay').classList.contains('hidden')){ stopSkinPreviewAnim(); return; }
    if(front && frontEl) frontEl.src = front[i];
    if(back && backEl)   backEl.src  = back[i];
    i = (i+1) % 8;
  };
  tick();
  skinPreviewAnimTimer = setInterval(tick, SKIN_PREVIEW_FRAME_MS);
}
function showSkinPreview(skinId, opts){
  opts = opts || {};
  const m = skinMeta(skinId);
  if(!m) return;
  document.getElementById('skinPreviewName').textContent = m.name;
  const rarEl = document.getElementById('skinPreviewRar');
  rarEl.textContent = m.rarity; rarEl.className = 'skin-preview-rar rar-'+m.rarity;
  // まず静止画を入れておき(歩行コマ未対応スキンのフォールバック)、あれば歩行モーションに差し替える
  document.getElementById('skinPreviewFront').src = skinPreviewSrc(skinId, 'front');
  document.getElementById('skinPreviewBack').src = skinPreviewSrc(skinId, 'back');
  const selBtn = document.getElementById('skinPreviewSelectBtn');
  if(opts.selectable){ selBtn.classList.remove('hidden'); skinPreviewSelect = opts.onSelect || null; }
  else { selBtn.classList.add('hidden'); skinPreviewSelect = null; }
  document.getElementById('skinPreviewOverlay').classList.remove('hidden');
  startSkinPreviewAnim(skinId, 0);
}
document.getElementById('skinPreviewCloseBtn').addEventListener('click', ()=>{
  document.getElementById('skinPreviewOverlay').classList.add('hidden'); skinPreviewSelect = null;
  stopSkinPreviewAnim();
});
document.getElementById('skinPreviewSelectBtn').addEventListener('click', ()=>{
  const fn = skinPreviewSelect; skinPreviewSelect = null;
  document.getElementById('skinPreviewOverlay').classList.add('hidden');
  stopSkinPreviewAnim();
  if(fn) fn();
});

// 所持スキン一覧(レアリティ順)
function renderBagSkins(){
  const grid = document.getElementById('bagSkinGrid');
  const owned = loadSkins().owned;
  const ids = Object.keys(owned).filter(id=>owned[id] && skinMeta(id));
  if(ids.length===0){
    grid.innerHTML = '<div class="bag-skin-empty">所持しているスキンはありません。ガチャで手に入れよう！</div>';
    return;
  }
  // 並び順: レアリティ(SSR→SR)を優先しつつ、同レアリティ内は種族順→色順で並べる
  const elemOrder = Object.keys(ELEMENTS);
  const colOrder = (typeof SKIN_COLOR_ORDER!=='undefined') ? SKIN_COLOR_ORDER : [];
  ids.sort((a,b)=>{
    const ma=skinMeta(a), mb=skinMeta(b);
    const rr = (RARITY_RANK[mb.rarity]||0)-(RARITY_RANK[ma.rarity]||0);
    if(rr!==0) return rr;
    const ea=elemOrder.indexOf(ma.element), eb=elemOrder.indexOf(mb.element);
    if(ea!==eb) return ea-eb;
    return colOrder.indexOf(ma.colorId||'') - colOrder.indexOf(mb.colorId||'');
  });
  grid.innerHTML = ids.map(id=>{
    const m = skinMeta(id);
    const url = skinnedIconDataUrl(id);
    const img = url ? `<img src="${url}" alt="">` : `<span class="gacha-cell-emoji">✨</span>`;
    return `<div class="bag-skin-cell" data-skin="${id}">${img}<span class="bag-skin-rar rar-${m.rarity}">${m.rarity}</span><span class="bag-skin-name">${m.name}</span></div>`;
  }).join('');
  grid.querySelectorAll('.bag-skin-cell').forEach(cell=>{
    cell.addEventListener('click', ()=> showSkinPreview(cell.dataset.skin));
  });
}
document.getElementById('closeBagBtn').addEventListener('click', ()=>{
  document.getElementById('bagOverlay').classList.add('hidden');
});
let bagUseQty = 1;
let bagPicker = { itemKey:null, targetKey:null };
function renderBag(){
  const bag = loadBag();
  const gridEl = document.getElementById('bagIconGrid');
  const keys = Object.keys(PLAYER_ITEMS).filter(k=>bag[k]>0);
  if(keys.length===0){
    gridEl.innerHTML = '<div class="bag-empty">アイテムはありません。ガチャやショップで手に入れよう！</div>';
    bagSelectedItem = null;
    renderBagDesc();
    return;
  }
  // 表示中のアイテムが無くなったら選択解除。未選択なら先頭を自動選択(最初から選択済み表示)
  if(bagSelectedItem && !(bag[bagSelectedItem]>0)) bagSelectedItem = null;
  if(!bagSelectedItem) bagSelectedItem = keys[0];
  gridEl.innerHTML = keys.map(k=>{
    const it = PLAYER_ITEMS[k];
    const active = k===bagSelectedItem;
    return `
    <button class="bag-icon-cell ${active?'active':''} ${it.rarity==='SSR'?'is-ssr':''}" data-key="${k}">
      <span class="bag-icon-emoji">${it.icon}</span>
      <span class="bag-icon-count">×${bag[k]}</span>
    </button>`;
  }).join('');
  gridEl.querySelectorAll('.bag-icon-cell').forEach(b=>{
    b.addEventListener('click', ()=>{
      if(bagSelectedItem===b.dataset.key) return; // 常に何か選択された状態を維持
      bagSelectedItem = b.dataset.key;
      renderBag();
    });
  });
  renderBagDesc();
}
// 選択中アイテムの説明+個数ゲージ+対象マスモン一覧を常に表示する
// ステータスの実を選んでいるとき、選択中マスモンが上限(999)に達するまでに使える個数。
// 対象未選択やステータス以外のアイテムなら null(=所持数まで使える)。
// 0 は「もう上限なので1個も使えない」を意味する。
function bagStatUsableQty(itemKey, targetKey){
  const it = PLAYER_ITEMS[itemKey];
  if(!it || !it.stat || !targetKey) return null;
  const mm = loadMastermons()[targetKey];
  if(!mm) return null;
  const cur = mm.stats[it.stat] || 0;
  return Math.max(0, Math.ceil((mastermonStatCap(mm) - cur) / STAT_SEED_GAIN));
}
// 個数ゲージの上限を「所持数」と「上限までに必要な個数」の小さい方に合わせる
function syncBagQtyLimit(){
  const owned = loadBag()[bagSelectedItem] || 0;
  const need = bagStatUsableQty(bagSelectedItem, bagPicker.targetKey);
  const max = Math.max(1, need==null ? owned : Math.min(owned, Math.max(need, 1)));
  const slider = document.getElementById('bagQtySlider');
  slider.max = max;
  if(bagUseQty > max) bagUseQty = max;
  if(bagUseQty < 1) bagUseQty = 1;
  slider.value = bagUseQty;
  document.getElementById('bagQtyVal').textContent = bagUseQty;
  return need;
}
function renderBagDesc(){
  const empty = document.getElementById('bagDescEmpty');
  const content = document.getElementById('bagDescContent');
  const wrap = document.getElementById('bagTargetWrap');
  if(!bagSelectedItem || !PLAYER_ITEMS[bagSelectedItem]){
    empty.classList.remove('hidden');
    content.classList.add('hidden');
    wrap.classList.add('hidden');
    return;
  }
  const it = PLAYER_ITEMS[bagSelectedItem];
  empty.classList.add('hidden');
  content.classList.remove('hidden');
  // アイコンはSVGのことがあるのでHTMLとして入れる(textContentだと生タグが出る)
  document.getElementById('bagDescIcon').innerHTML = it.icon;
  const nameEl = document.getElementById('bagDescName');
  nameEl.textContent = it.name;
  nameEl.classList.toggle('is-ssr', it.rarity==='SSR');
  document.getElementById('bagDescText').textContent = playerItemDesc(bagSelectedItem);
  // 対象マスモンの選択はアイテムを切り替えても維持する(選び直しの手間を無くす)。
  // 消えたマスモンを選んだままにならないよう、存在チェックだけ行う
  const keep = bagPicker.targetKey && loadMastermons()[bagPicker.targetKey] ? bagPicker.targetKey : null;
  bagPicker = { itemKey: bagSelectedItem, targetKey: keep };
  // 個数ゲージ: 最低1。アイテムを切り替えたら1に戻し、上限は所持数と残り伸びしろで決める
  bagUseQty = 1;
  syncBagQtyLimit();
  renderBagTargetList();
  wrap.classList.remove('hidden');
}
function setBagQty(v){
  const slider = document.getElementById('bagQtySlider');
  const max = +slider.max || 1;
  bagUseQty = Math.max(1, Math.min(max, Math.round(v)||1));
  slider.value = bagUseQty;
  document.getElementById('bagQtyVal').textContent = bagUseQty;
  // 右側マスモンのプレビュー(ステータス差分・チケット枚数)を個数に合わせて更新
  const wrap = document.getElementById('bagTargetWrap');
  if(wrap && !wrap.classList.contains('hidden')) renderBagTargetList();
}
document.getElementById('bagQtyMinus').addEventListener('click', ()=>setBagQty(bagUseQty-1));
document.getElementById('bagQtyPlus').addEventListener('click', ()=>setBagQty(bagUseQty+1));
document.getElementById('bagQtySlider').addEventListener('input', (e)=>setBagQty(+e.target.value));
/* 基礎値アイテムのプレビュー。基礎値は育成倍率が乗る前に足されるので、
   生の+5ではなく「実際にどれだけHP/速さが増えるか」で見せる。
   計算は mmEffectiveStats に通す(表示と実戦力の式を分けないため)。 */
function bagBaseItemPreviewHtml(mm, baseKey, qty){
  const after = Object.assign({}, mm);
  if(baseKey==='hp') after.baseHp = safeBaseAmount(mm.baseHp) + BASE_ITEM_GAIN*qty;
  else after.baseSpd = safeBaseAmount(mm.baseSpd) + BASE_ITEM_GAIN*qty;
  const a = mmEffectiveStats(mm), b = mmEffectiveStats(after);
  const isHp = baseKey==='hp';
  const label = isHp ? '❤️ HP' : '💨 速さ';
  const from = isHp ? a.hp : a.speed, to = isHp ? b.hp : b.speed;
  return `<div class="bt-extra bt-extra-base">${label} ${from}→<b>${to}</b>（+${to-from}）</div>`;
}
function renderBagTargetList(){
  const data = loadMastermons();
  const pick = document.getElementById('bagTargetList');
  // innerHTMLで作り直すとスクロール位置が先頭へ戻る。マスモンを選ぶ/アイテムを切り替える
  // たびに一覧が飛んで見えるので、書き換えの前後で位置を持ち越す
  const keepScroll = pick.scrollTop;
  const keys = Object.keys(data);
  if(keys.length===0){
    pick.innerHTML = '<div class="bag-empty">マスモンがいません。先にマスモン登録しよう！</div>';
    document.getElementById('bagUseConfirmBtn').disabled = true;
    return;
  }
  const it = PLAYER_ITEMS[bagPicker.itemKey];
  const qty = bagUseQty || 1;
  // ステータスの実は対象ステータスのプレビュー差分(個数分)を作り、マスモン画面と同じステータスバーで表示
  const preview = it.stat ? { [it.stat]: STAT_SEED_GAIN * qty } : null;
  pick.innerHTML = keys.map(k=>{
    const mm = data[k];
    const active = k===bagPicker.targetKey;
    const statsBarHtml = buildMastermonStatsColHtml(mm, mastermonApt(mm), preview);
    const extra =
      bagPicker.itemKey==='freeTrainTicket' ? `<div class="bt-extra">🎫 トレチケ ${mm.tickets||0}→${(mm.tickets||0)+qty}枚</div>` :
      bagPicker.itemKey==='moveTicket' ? `<div class="bt-extra">⚔️ 技強化ストック ${mm.nextMoveBoost||0}→${(mm.nextMoveBoost||0)+qty}</div>` :
      it.base ? bagBaseItemPreviewHtml(mm, it.base, qty) : '';
    return `
    <button class="bag-target-btn ${active?'active':''}" data-key="${k}">
      <span class="bt-head">
        ${equippedIconImgTag(k, ELEMENTS[k].label)}
        ${mm.name}(${ELEMENTS[k].label}) Lv.${mm.level}
      </span>
      ${statsBarHtml}
      ${extra}
    </button>`;
  }).join('');
  pick.scrollTop = keepScroll;   // 書き換えで先頭へ戻ったぶんを戻す
  pick.querySelectorAll('.bag-target-btn').forEach(b=>{
    b.addEventListener('click', ()=>{
      bagPicker.targetKey = (bagPicker.targetKey===b.dataset.key) ? null : b.dataset.key;
      syncBagQtyLimit();      // 対象が変わると残り伸びしろも変わるので個数上限を引き直す
      renderBagTargetList();
    });
  });
  // ステータスが既に上限のマスモンには使わせない(アイテムの無駄使いを防ぐ)
  const need = bagStatUsableQty(bagPicker.itemKey, bagPicker.targetKey);
  const capped = need===0;
  const btn = document.getElementById('bagUseConfirmBtn');
  btn.disabled = !bagPicker.targetKey || capped;
  btn.textContent = capped ? '上限に到達' : '使用する';
}
document.getElementById('bagUseConfirmBtn').addEventListener('click', ()=>{
  if(!bagPicker.itemKey || !bagPicker.targetKey) return;
  useBagItem(bagPicker.itemKey, bagPicker.targetKey, bagUseQty);
});
function useBagItem(itemKey, mmKey, qty){
  const bag = loadBag();
  qty = Math.max(1, Math.min(Math.round(qty)||1, bag[itemKey]||0));
  if(qty<=0) return;
  const data = loadMastermons();
  const mm = data[mmKey];
  const it = PLAYER_ITEMS[itemKey];
  if(!mm || !it) return;
  let resultText;
  if(it.stat){
    const before = mm.stats[it.stat];
    const label = MASTERMON_STATS.find(s=>s.key===it.stat).label;
    // 上限(通常999・転生済みは999+100×転生回数)に必要な個数までに絞る。余分なアイテムは消費しない
    const cap = mastermonStatCap(mm);
    const need = Math.max(0, Math.ceil((cap - before) / STAT_SEED_GAIN));
    if(need<=0){ pushToast(`${mm.name}の${label}は既に上限です`); return; }
    qty = Math.min(qty, need);
    for(let i=0;i<qty;i++) mm.stats[it.stat] = mastermonClampStat(mm.stats[it.stat] + STAT_SEED_GAIN, cap);
    const gained = mm.stats[it.stat] - before;
    resultText = `${mm.name}の${label}+${gained}`;
  } else if(it.base){
    // 基礎値は上限が無い。実際にどれだけ強くなったかで結果を出す
    const before = mmEffectiveStats(mm);
    if(it.base==='hp') mm.baseHp = safeBaseAmount(mm.baseHp) + BASE_ITEM_GAIN*qty;
    else mm.baseSpd = safeBaseAmount(mm.baseSpd) + BASE_ITEM_GAIN*qty;
    const after = mmEffectiveStats(mm);
    resultText = it.base==='hp'
      ? `${mm.name}のライフの基礎値+${BASE_ITEM_GAIN*qty}(HP ${before.hp}→${after.hp})`
      : `${mm.name}の移動速度の基礎値+${BASE_ITEM_GAIN*qty}(速さ ${before.speed}→${after.speed})`;
  } else if(itemKey==='freeTrainTicket'){
    mm.tickets = (mm.tickets||0) + qty;
    resultText = `${mm.name}のトレーニングチケット+${qty}(🎫${mm.tickets}枚)`;
  } else if(itemKey==='moveTicket'){
    mm.nextMoveBoost = (mm.nextMoveBoost||0) + qty;
    resultText = `${mm.name}は次の試合を技tier2解放で開始！(${mm.nextMoveBoost}回分)`;
  }
  bag[itemKey] -= qty;
  if(bag[itemKey]<=0) delete bag[itemKey];
  saveBag(bag);
  saveMastermons(data);
  playSe('train');
  pushToast(resultText);
  renderBag(); // 消費後に再描画(残っていれば一覧+ゲージを再表示、0なら別アイテムへ)
  renderSelectorCards();
  // トレーニングチケットは「使ったらすぐ使いたい」ので、その場から training タブへ飛べるようにする
  showBagGoTrainBtn(itemKey==='freeTrainTicket' ? mmKey : null);
}
/* バッグ→トレーニングへのジャンプボタン。mmKeyがnullなら隠す。
   renderBag()のあとに呼ぶこと(先に呼ぶと再描画で消える)。 */
function showBagGoTrainBtn(mmKey){
  const btn = document.getElementById('bagGoTrainBtn');
  if(!btn) return;
  const mm = mmKey && loadMastermons()[mmKey];
  btn.classList.toggle('hidden', !mm);
  if(!mm) return;
  btn.textContent = `🎫 ${mm.name} のトレーニングへ`;
  btn.onclick = ()=>{
    btn.classList.add('hidden');
    lobbyCloseOverlay('bagOverlay');
    // マスモン画面を開いてから、そのマスモンの詳細→トレーニングタブまで一気に進める
    mastermonDetailKey = mmKey;
    openMastermonScreen(false);
    openMastermonDetail(mmKey, null);
    mmOpenTab('training');
  };
}

// ===== ガチャ(スキンガチャ・全画面) =====
const RARITY_RANK = { N:0, R:1, SR:2, SSR:3 };
function updateGachaWallet(){
  const w = loadWallet();
  document.getElementById('gachaDia').textContent = `💎 ${w.dia}`;
}
function rarityCssColor(rarity, now){
  if(rarity==='SSR'){ const h=((now||0)*0.12)%360; return `hsl(${h},90%,63%)`; }
  return RARITIES[rarity].color;
}
// --- ガチャカウンター(ゲージ・カタログ) ---
function updateGachaCounterUI(){
  const raid = (typeof gachaMode!=='undefined') && gachaMode==='raid';
  const max = raid ? RAID_GACHA_CATALOG_AT : GACHA_SSR_CATALOG_AT;
  const cnt = raid ? Math.min(RAID_GACHA_CATALOG_AT, loadRaidGachaCount().count) : loadGachaCount().count;
  document.getElementById('gachaCountNum').textContent = `${cnt} / ${max}`;
  document.getElementById('gachaGaugeFill').style.width = `${Math.min(100, cnt/max*100)}%`;
  // 節目はモードで中身が変わる(レイドは100連の1つだけ)
  const ms1 = document.getElementById('gachaMs1'), ms2 = document.getElementById('gachaMs2');
  ms1.dataset.at = raid ? RAID_GACHA_CATALOG_AT : GACHA_SR_CATALOG_AT;
  ms1.querySelector('.gacha-ms-label').innerHTML = raid ? `${RAID_GACHA_CATALOG_AT}<br>SSR` : `${GACHA_SR_CATALOG_AT}<br>SR`;
  ms2.classList.toggle('hidden', raid);
  document.getElementById('gachaMsNote').innerHTML = raid
    ? `${RAID_GACHA_CATALOG_AT}回でレイド特効スキンを含む<b class="rar-SSR">${CATALOG_LABEL.raidSsr}</b>を付与！(1回限り)`
    : `100回で<b class="rar-SR">${CATALOG_LABEL.sr}</b>、200回で<b class="rar-SSR">${CATALOG_LABEL.ssr}</b>を付与！`;
  // 節目の位置はゲージの最大値に対する割合で置く。
  // レイドは100連が最大なので、同じ「100」でも右端に来る(スキンガチャでは真ん中)
  document.querySelectorAll('.gacha-milestone').forEach(m=>{
    const at = +m.dataset.at;
    m.style.left = `${Math.max(0, Math.min(100, at/max*100))}%`;
    m.classList.toggle('reached', cnt>=at);
  });
  // 表示するカタログはタブごとに分ける(レイドタブに通常カタログを混ぜない)
  const cats = loadCatalogs();
  const shown = raid ? ['raidSsr'] : ['sr', 'ssr'];
  const row = document.getElementById('gachaCatalogRow');
  row.innerHTML = shown.filter(k=>cats[k]>0).map(k=>
    `<button class="gacha-catalog-btn ${k==='sr'?'sr':'ssr'}" data-cat="${k}">🎫 ${CATALOG_LABEL[k]} ×${cats[k]}</button>`
  ).join('');
  row.querySelectorAll('.gacha-catalog-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> openCatalogModal(btn.dataset.cat));
  });
}
/* --- レイドガチャ ---
   スキンガチャと同じ画面をタブで切り替える。抽選そのものは共用で、違うのは
   「SSR枠の中身」と「カタログの節目(100連で1枚だけ・以降は数えない)」の2つだけ。 */
let gachaMode = 'skin';   // 'skin' | 'raid'
function setGachaMode(mode){
  gachaMode = (mode==='raid') ? 'raid' : 'skin';
  document.querySelectorAll('.gacha-tab').forEach(t=>t.classList.toggle('active', t.dataset.gacha===gachaMode));
  const raid = gachaMode==='raid';
  // タイトルの「(◯◯ピックアップ)」は両タブともピックアップの定数から作る
  // (data.js の GACHA_PICKUP_SSR / RAID_GACHA_PICKUP を変えればここも追従する)
  const pickupName = (id, alt)=> SSR_SKINS[id] ? skinMeta(id).name : alt;
  document.getElementById('gachaTitle').firstChild.textContent = raid ? '🐉 レイドガチャ' : '🎰 スキンガチャ';
  document.getElementById('gachaTitlePickup').textContent = raid
    ? `(${pickupName(RAID_GACHA_PICKUP, 'レイド特効')}ピックアップ)`
    : `(${pickupName(GACHA_PICKUP_SSR, 'SSR')}ピックアップ)`;
  // 開催前は引けない。ボタンとゲージの上に「近日公開」を被せる
  const locked = raid && !raidGachaOpenNow();
  document.getElementById('gachaSoonMask').classList.toggle('hidden', !locked);
  document.getElementById('gachaSingleBtn').disabled = locked;
  document.getElementById('gachaTenBtn').disabled = locked;
  updateGachaCounterUI();
}
// レイドガチャのカウンター。100連で1回だけカタログを付与し、以降は数えない
function incrementRaidGachaCount(n){
  const c = loadRaidGachaCount(); const granted=[];
  for(let i=0;i<n;i++){
    if(c.done) break;
    c.count++;
    // 付与するのは専用の「レイドSSRスキンカタログ」(狂戦士ガッツを含む)
    if(c.count>=RAID_GACHA_CATALOG_AT){ c.done=true; addCatalog('raidSsr',1); granted.push('raidSsr'); }
  }
  saveRaidGachaCount(c);
  return granted;
}
// カウンターを進め、100/200到達でカタログ付与。200で1周してリセット
function incrementGachaCount(n){
  const c = loadGachaCount(); const granted=[];
  for(let i=0;i<n;i++){
    c.count++;
    if(!c.sr && c.count>=GACHA_SR_CATALOG_AT){ c.sr=true; addCatalog('sr',1); granted.push('sr'); }
    if(!c.ssr && c.count>=GACHA_SSR_CATALOG_AT){ addCatalog('ssr',1); granted.push('ssr'); c.count=0; c.sr=false; c.ssr=false; }
  }
  saveGachaCount(c);
  return granted;
}
// タイトル画面ではなくロビー(#startScreen)が表示されている時だけポップアップを出す。
// 未表示ならここでは何もせず、pending扱いのままにしておく(enterLobby()等から呼び直される)。
function maybeFlushPendingPromoPopups(){
  const startScr = document.getElementById('startScreen');
  if(!startScr || startScr.classList.contains('hidden')) return; // まだタイトル画面など→ロビーに来るまで待つ
  if(localStorage.getItem(SKIN_PROMO_PENDING_KEY)==='1') showSkinPromoPopup();
  if(localStorage.getItem(ROCK_SSR_PROMO_PENDING_KEY)==='1') showRockSsrPromoPopup();
}
// ===== スキンガチャ実装記念ポップアップ =====
// このバージョン以降にログインしたアカウントに一度だけ、ダイヤ500個付与+誘導ポップアップ
const SKIN_PROMO_KEY = 'aramon_promo_skingacha_v1';       // 受け取り済み(アカウント同期)
const SKIN_PROMO_PENDING_KEY = 'aramon_promo_pending_v1'; // 未確認=表示中(端末ローカル。SW自動リロードをまたいで残す)
const SKIN_PROMO_DIA = 500;
function showSkinPromoPopup(){
  const el = document.getElementById('skinPromoOverlay');
  if(el) el.classList.remove('hidden');
}
function dismissSkinPromoPopup(){
  try{ localStorage.removeItem(SKIN_PROMO_PENDING_KEY); }catch(e){}
  const el = document.getElementById('skinPromoOverlay');
  if(el) el.classList.add('hidden');
}
// 確認用: おりょうのアカウントは端末ごとに一度だけ記念フラグをリセットして再表示させる
function promoOryouResetIfNeeded(name){
  if(name !== 'おりょう') return;
  if(localStorage.getItem('aramon_promo_oryou_reset_v1')==='1') return;
  try{
    localStorage.setItem('aramon_promo_oryou_reset_v1','1');
    localStorage.removeItem(SKIN_PROMO_KEY); // 受け取り済みフラグを消す→再び付与+表示される
  }catch(e){}
}
function openGachaScreen(){
  // レイド開催期間中はレイドガチャを最初に見せる(期間外は従来どおりスキンガチャ)
  setGachaMode(raidOpenNow() ? 'raid' : 'skin');
  updateGachaWallet();
  document.getElementById('gachaSingleCost').textContent = `💎 ${GACHA_COST_DIA_SINGLE}`;
  document.getElementById('gachaTenCost').textContent = `💎 ${GACHA_COST_DIA_TEN}`;
  document.getElementById('gachaResult').classList.add('hidden');
  document.getElementById('gachaRatesModal').classList.add('hidden');
  document.getElementById('gachaCatalogModal').classList.add('hidden');
  document.getElementById('gachaButtons').style.visibility='visible';
  updateGachaCounterUI();
  document.getElementById('gachaOverlay').classList.remove('hidden');
  gachaAnimStart('idle');
}
function maybeShowSkinGachaPromo(){
  if(!accountState.loggedIn) return;                       // ログイン中のアカウントのみ
  if(localStorage.getItem(SKIN_PROMO_KEY)==='1') return;    // 既に受け取り済みなら出さない
  try{ localStorage.setItem(SKIN_PROMO_KEY,'1'); }catch(e){}
  try{ localStorage.setItem(SKIN_PROMO_PENDING_KEY,'1'); }catch(e){} // ボタンを押すまで表示を維持
  addWallet(0, SKIN_PROMO_DIA);                             // ダイヤ500個付与(saveWalletがsync予約)
  accountMarkDirty();                                       // フラグもサーバーへ同期
  updateAccountBar();
  maybeFlushPendingPromoPopups();
  pushToast(`スキンガチャ実装記念！ 💎+${SKIN_PROMO_DIA}`);
}
document.getElementById('skinPromoCloseBtn').addEventListener('click', ()=>{
  dismissSkinPromoPopup();
});
document.getElementById('skinPromoGachaBtn').addEventListener('click', ()=>{
  dismissSkinPromoPopup();
  openGachaScreen();
});
// SW自動リロード等で消えても、未確認(保留中)ならロビー表示時に再表示する(maybeFlushPendingPromoPopups)
maybeFlushPendingPromoPopups();

/* ===== ピックアップSSR実装記念ポップアップ =====
   ログインしてロビーに来るたび毎回ポップアップを表示する。ダイヤ500個の付与だけは1アカウント1回のみ。
   出す画像・文言はスキンガチャのピックアップ(GACHA_PICKUP_SSR)から作るので、
   ピックアップを差し替えるとポップアップの絵も自動で入れ替わる(IDは轟金剛のときのまま)。 */
const ROCK_SSR_PROMO_KEY = 'aramon_promo_rockssr_v1';       // ダイヤ受け取り済み(アカウント同期)
const ROCK_SSR_PROMO_PENDING_KEY = 'aramon_promo_rockssr_pending_v1'; // 未確認=表示中(端末ローカル)
const ROCK_SSR_PROMO_DIA = 500;
/* ポップアップに出すピックアップ。レイド開催期間中はレイドガチャのピックアップに
   切り替える(画像は SKIN_MEDIA.promoImg から引くので、ツールで差し替えれば自動で入れ替わる)。 */
function promoPickupSkinId(){
  return (typeof raidOpenNow==='function' && raidOpenNow()) ? RAID_GACHA_PICKUP : GACHA_PICKUP_SSR;
}
function gachaPickupName(){
  const id = promoPickupSkinId();
  return (typeof SSR_SKINS!=='undefined' && SSR_SKINS[id]) ? skinMeta(id).name : 'SSR';
}
function showRockSsrPromoPopup(){
  const el = document.getElementById('rockSsrPromoOverlay');
  if(!el) return;
  const img = document.getElementById('rockSsrPromoImg');
  const url = (typeof skinPromoImgUrl==='function') ? skinPromoImgUrl(promoPickupSkinId()) : null;
  if(img && url && img.getAttribute('src') !== url){
    img.src = url;
    img.alt = `SSR${gachaPickupName()}ピックアップ`;
  }
  el.classList.remove('hidden');
}
function dismissRockSsrPromoPopup(){
  try{ localStorage.removeItem(ROCK_SSR_PROMO_PENDING_KEY); }catch(e){}
  const el = document.getElementById('rockSsrPromoOverlay');
  if(el) el.classList.add('hidden');
}
function maybeShowRockSsrPromo(){
  if(!accountState.loggedIn) return;                            // ログイン中のアカウントのみ
  const alreadyGranted = localStorage.getItem(ROCK_SSR_PROMO_KEY)==='1';
  if(!alreadyGranted){
    // ダイヤ付与は1回のみ
    try{ localStorage.setItem(ROCK_SSR_PROMO_KEY,'1'); }catch(e){}
    addWallet(0, ROCK_SSR_PROMO_DIA);                            // ダイヤ500個付与(saveWalletがsync予約)
    accountMarkDirty();                                          // フラグもサーバーへ同期
    updateAccountBar();
    pushToast(`SSR${gachaPickupName()}実装記念！ 💎+${ROCK_SSR_PROMO_DIA}`);
  }
  // ポップアップ自体はログインのたび毎回表示する
  try{ localStorage.setItem(ROCK_SSR_PROMO_PENDING_KEY,'1'); }catch(e){} // ボタンを押すまで表示を維持
  maybeFlushPendingPromoPopups();
}
document.getElementById('rockSsrPromoCloseBtn').addEventListener('click', ()=>{
  dismissRockSsrPromoPopup();
});
document.getElementById('rockSsrPromoGachaBtn').addEventListener('click', ()=>{
  dismissRockSsrPromoPopup();
  openGachaScreen();
});
// SW自動リロード等で消えても、未確認(保留中)ならロビー表示時に再表示する(maybeFlushPendingPromoPopups)

document.getElementById('openGachaBtn').addEventListener('click', openGachaScreen);
document.getElementById('closeGachaBtn').addEventListener('click', ()=>{
  gachaAnimStop();
  document.getElementById('gachaOverlay').classList.add('hidden');
});

// --- ガチャ演出(canvas): 円盤石が回り→光の柱→レアリティ色の球体 ---
const gachaAnim = { raf:null, phase:'idle', t0:0, results:[], count:1, orbs:[], onReveal:null };
// SSRのうち昇格演出対象(promoted)は、円盤/光の玉の演出だけSRとして扱う(見た目のみ。結果は変わらない)
function gachaEffRarity(r){
  if(!r) return 'N';
  return (r.rarity==='SSR' && r.promoted) ? 'SR' : r.rarity;
}
function gachaCanvasSize(){
  const cv = document.getElementById('gachaCanvas');
  const f = document.getElementById('gachaField');
  const w = f.clientWidth, h = f.clientHeight;
  if(cv.width!==w) cv.width=w;
  if(cv.height!==h) cv.height=h;
  return { cv, w, h };
}
function gachaAnimStart(phase){
  gachaAnim.phase = phase;
  gachaAnim.t0 = performance.now();
  if(!gachaAnim.raf) gachaAnim.raf = requestAnimationFrame(gachaAnimFrame);
}
function gachaAnimStop(){
  if(gachaAnim.raf){ cancelAnimationFrame(gachaAnim.raf); gachaAnim.raf=null; }
}
function gachaAnimFrame(now){
  const { cv, w, h } = gachaCanvasSize();
  const g = cv.getContext('2d');
  g.clearRect(0,0,w,h);
  const cx=w/2, cy=h*0.46;
  const diskR = Math.min(w,h)*0.20;
  const elapsed = (now - gachaAnim.t0)/1000;
  const topR = gachaAnim.results.length ? gachaAnim.results.reduce((a,r)=>{ const er=gachaEffRarity(r); return RARITY_RANK[er]>RARITY_RANK[a]?er:a; },'N') : 'N';
  const drawDisk = (ang, glow, glowColor)=>{
    // 厚みを焼き込んだ立体円盤石を回転描画する(厚みも一緒に回る)。顔の中心=画像中心。
    g.save(); g.translate(cx,cy);
    if(glow>0){ g.shadowBlur=40*glow; g.shadowColor=glowColor||'#fff'; }
    g.rotate(ang);
    if(imgIsReady(summonDiskThickImg)){
      const S = diskR*2.2; // 顔の直径が diskR*2 相当になるよう全体を拡縮
      g.drawImage(summonDiskThickImg, -S/2, -S/2, S, S);
    } else if(imgIsReady(summonDiskImg)){
      g.drawImage(summonDiskImg, -diskR, -diskR*0.62, diskR*2, diskR*1.24); // フォールバック(平ら)
    } else {
      g.beginPath(); g.ellipse(0,0,diskR,diskR*0.62,0,0,Math.PI*2); g.fillStyle='#c98d5a'; g.fill();
    }
    g.restore();
  };
  if(gachaAnim.phase==='idle'){
    // 表示中のタブ(スキン/レイド)のピックアップ告知画像を出す
    const promoImg = (typeof gachaPromoImgFor==='function') ? gachaPromoImgFor(gachaMode) : gachaPickupPromoImg;
    if(imgIsReady(promoImg)){
      // ピックアップ告知画像を背景として表示(下のボタン/ゲージ等はDOM側なので位置は変わらない)
      const iw = promoImg.naturalWidth || 1364, ih = promoImg.naturalHeight || 768;
      const pulse = 1 + 0.012*Math.sin(now/700);
      const scale = Math.min((w*0.94)/iw, (h*0.78)/ih) * pulse;
      const dw = iw*scale, dh = ih*scale;
      g.save();
      g.shadowBlur = 26 + 8*Math.sin(now/700); g.shadowColor = 'rgba(244,196,48,0.55)';
      g.globalAlpha = 0.96;
      g.drawImage(promoImg, cx-dw/2, cy-dh/2, dw, dh);
      g.restore();
    } else {
      // 画像未読込時の保険: 従来の白く光る円盤石+「回せ！」を出す
      const pulse = 0.4+0.3*Math.sin(now/380);
      drawDisk(0, pulse, '#ffffff');
      g.save(); g.translate(cx,cy);
      const ar = diskR*1.42, a0 = (now/600)%(Math.PI*2);
      g.strokeStyle='rgba(255,230,150,0.9)'; g.lineWidth=5; g.lineCap='round';
      g.beginPath(); g.arc(0,0,ar, a0, a0+Math.PI*1.4); g.stroke();
      const ae=a0+Math.PI*1.4, ax=Math.cos(ae)*ar, ay=Math.sin(ae)*ar;
      g.translate(ax,ay); g.rotate(ae+Math.PI/2);
      g.fillStyle='rgba(255,230,150,0.95)'; g.beginPath(); g.moveTo(0,-11); g.lineTo(9,6); g.lineTo(-9,6); g.closePath(); g.fill();
      g.restore();
      g.save(); g.textAlign='center'; g.font=`bold ${Math.round(Math.min(w,h)*0.09)}px 'Rajdhani',sans-serif`;
      g.fillStyle='#fff'; g.shadowBlur=14; g.shadowColor='rgba(255,200,80,0.9)';
      g.fillText('回せ！', cx, cy - diskR*1.9);
      g.restore();
    }
  } else if(gachaAnim.phase==='spin'){
    // 加速回転しながらレアリティ色に光る(回転時間は従来の倍)
    const p = Math.min(1, elapsed/2.4);
    const ang = (elapsed*elapsed)*7;
    drawDisk(ang, 0.5+p, rarityCssColor(topR, now));
    if(elapsed>=2.4){ buildGachaOrbs(w,h,cx,cy,diskR); gachaAnimStart('rain'); }
  } else if(gachaAnim.phase==='rain'){
    // 各レアリティ色の光の柱を1本ずつ順番に落とし、消えると球体が残る
    const n = gachaAnim.orbs.length;
    const stagger = n>1 ? 0.16 : 0;
    const fallDur = 0.42, hold = 0.55;
    drawDisk(12, 0.5, rarityCssColor(topR, now));
    for(let i=0;i<n;i++){
      const o = gachaAnim.orbs[i];
      const local = elapsed - i*stagger;
      if(local < 0) continue;
      const col = rarityCssColor(o.rarity, now + o.seed*90);
      const fallP = Math.min(1, local/fallDur);
      if(fallP < 1){
        // 落ちてくる光の柱(その球体の位置へ)
        const topY = 0, lead = lerp(topY, o.y, fallP), halfW = o.r*1.5;
        g.save(); g.globalCompositeOperation='lighter';
        const grad=g.createLinearGradient(0,topY,0,lead);
        grad.addColorStop(0,'rgba(255,255,255,0)'); grad.addColorStop(0.65,col); grad.addColorStop(1,'#ffffff');
        g.fillStyle=grad; g.globalAlpha=0.9;
        g.beginPath(); g.moveTo(o.x-halfW*0.5,topY); g.lineTo(o.x+halfW*0.5,topY); g.lineTo(o.x+halfW,lead); g.lineTo(o.x-halfW,lead); g.closePath(); g.fill();
        g.restore();
      } else {
        // 柱が消えて球体が残る(出現直後は少し弾む)
        const pop = Math.min(1,(local-fallDur)/0.18);
        const rr = o.r*(0.7+0.3*pop);
        g.save(); g.shadowBlur=26; g.shadowColor=col;
        const rg=g.createRadialGradient(o.x,o.y,rr*0.1,o.x,o.y,rr);
        rg.addColorStop(0,'#ffffff'); rg.addColorStop(0.5,col); rg.addColorStop(1,'rgba(0,0,0,0)');
        g.fillStyle=rg; g.beginPath(); g.arc(o.x,o.y,rr,0,Math.PI*2); g.fill();
        g.restore();
      }
    }
    const total = (n-1)*stagger + fallDur + hold;
    if(elapsed>=total && gachaAnim.onReveal){ const cb=gachaAnim.onReveal; gachaAnim.onReveal=null; cb(); }
  }
  if(gachaAnim.raf) gachaAnim.raf = requestAnimationFrame(gachaAnimFrame);
}
function buildGachaOrbs(w,h,cx,cy,diskR){
  const n = gachaAnim.count;
  gachaAnim.orbs = [];
  if(n===1){
    const r = Math.min(w,h)*0.14;
    gachaAnim.orbs.push({ x:cx, y:cy-diskR*0.1, r, rarity:gachaEffRarity(gachaAnim.results[0]), seed:0 });
  } else {
    // 10連は画面の横幅いっぱいを使い、玉体も大きくする(5列×2行)
    const cols = 5;
    const marginX = w*0.05;
    const cellW = (w - marginX*2) / cols;
    const r = Math.min(cellW*0.44, h*0.15);   // セル幅と高さから大きめの半径を決める
    const rowGap = r*2.3;
    const rows = Math.ceil(n/cols);
    const gridH = (rows-1)*rowGap;
    const y0 = cy - diskR*0.15 - gridH*0.35;
    for(let i=0;i<n;i++){
      const col=i%cols, rowi=Math.floor(i/cols);
      gachaAnim.orbs.push({ x: marginX + cellW*(col+0.5), y: y0 + rowi*rowGap, r, rarity:gachaEffRarity(gachaAnim.results[i]), seed:i });
    }
  }
}

// SSR昇格演出(SRだと思わせる演出)が発生するかどうか。
// ・未取得(初めて手に入れた)SSRなら100%発生
// ・取得済(重複)SSRなら50%発生
// ガチャ以外(カタログ交換・シーズンパス報酬)でのSSR獲得にも共通で使う
function ssrShouldPromote(alreadyOwned){
  return alreadyOwned ? (Math.random()<0.5) : true;
}
function doGacha(count){
  if(gachaAnim.phase!=='idle') return; // 演出中は無効
  if(gachaMode==='raid' && !raidGachaOpenNow()){ pushToast('レイドガチャは近日公開です'); return; }
  const cost = count===10 ? GACHA_COST_DIA_TEN : GACHA_COST_DIA_SINGLE;
  const w = loadWallet();
  if(w.dia < cost){ pushToast('ダイヤが足りません'); return; }
  w.dia -= cost; saveWallet(w);
  // 抽選
  const results = [];
  for(let i=0;i<count;i++){
    const guaranteed = (count===10 && i===count-1); // 10連の10個目はSR以上確定
    const roll = gachaRollOne(guaranteed);
    // レイドガチャのSSR枠はレイド特効スキンのピックアップに差し替える(全体2%のうち1%)
    if(gachaMode==='raid' && roll.kind==='skin' && roll.rarity==='SSR') roll.skinId = pickRaidGachaSsrSkinId();
    let dup = false, diaGain = 0;
    if(roll.kind==='item'){
      addBagItem(roll.key,1);
    } else {
      if(isSkinOwned(roll.skinId)){ dup=true; diaGain=(roll.rarity==='SSR'?DUP_SSR_DIA:DUP_SKIN_DIA); addWallet(0, diaGain); }
      else ownSkin(roll.skinId);
    }
    results.push({ ...roll, dup, diaGain, promoted: (roll.kind==='skin' && roll.rarity==='SSR') ? ssrShouldPromote(dup) : false });
  }
  const granted = gachaMode==='raid' ? incrementRaidGachaCount(count) : incrementGachaCount(count);
  gachaAnim.results = results; gachaAnim.count = count;
  // 演出開始
  document.getElementById('gachaButtons').style.visibility='hidden';
  document.getElementById('gachaResult').classList.add('hidden');
  playSe('chupiin');
  setTimeout(()=>playSe('shuwaa'), 2400); // 円盤石の回転(2.4秒)後、光の柱が降り始めるタイミング
  gachaAnim.onReveal = ()=>{
    // SSRが出ていたら、結果一覧の前に虹色の獲得演出を挟む(複数なら順番に。50%は昇格演出を経由)
    const ssrResults = results.filter(r=>r.kind==='skin' && r.rarity==='SSR');
    if(ssrResults.length) runSsrRevealsThen(ssrResults, ()=> showGachaResults(results, granted));
    else showGachaResults(results, granted);
  };
  gachaAnimStart('spin');
}
// ===== SSR獲得演出(虹色の全画面リビール) =====
let ssrRevealContinue = null;
function showSsrReveal(skinId, onContinue){
  const ov = document.getElementById('ssrRevealOverlay');
  const m = skinMeta(skinId);
  const url = skinnedIconDataUrl(skinId);
  // 昇格演出でBGMを止めていた場合はここで元のトラックへ戻す
  if(ssrPromoteBgmResumeTrack!==null){
    if(typeof bgmSetTrack==='function') bgmSetTrack(ssrPromoteBgmResumeTrack);
    ssrPromoteBgmResumeTrack = null;
  }
  document.getElementById('ssrRevealIcon').src = url || '';
  document.getElementById('ssrRevealText').textContent = `SSR ${m.name} 獲得！`;
  setLastSkinShare(skinId);   // 画面内のシェアボタンとガチャ結果の両方がこれを見る
  ov.classList.remove('hidden');
  ov.classList.remove('play'); void ov.offsetWidth; ov.classList.add('play'); // ループアニメーションを再スタート
  // 内蔵の大当たり音声をスキップまでループ再生
  if(typeof startSsrJackpotLoop==='function') startSsrJackpotLoop();
  ssrRevealContinue = ()=>{
    ssrRevealContinue = null;
    if(typeof stopSsrJackpotLoop==='function') stopSsrJackpotLoop();
    ov.classList.add('hidden'); ov.classList.remove('play');
    if(onContinue) onContinue();
  };
}
function runSsrRevealsThen(ssrResults, done){
  let i=0;
  const step=()=>{
    if(i>=ssrResults.length){ done(); return; }
    const r = ssrResults[i++];
    if(r.promoted) runSsrPromotionSequence(r.skinId, ()=> showSsrReveal(r.skinId, step));
    else showSsrReveal(r.skinId, step);
  };
  step();
}
// ===== SSR昇格演出(SRだと思わせておいて、動画→タップ待ち画像を経てSSRリビールへ繋ぐ) =====
let ssrPromoteContinue = null;
// 昇格演出中はBGMを止め、SSR獲得画面(showSsrReveal)の表示と同時に元のトラックへ戻す
let ssrPromoteBgmResumeTrack = null;
// 管理者確認ボタンで true にすると、演出中の状態を画面内の診断パネルに逐次表示する
// (通常プレイ中は false のままなので、プレイヤーに見えることはない)
let ssrPromoteDebugMode = false;
let ssrPromoteDebugLines = [];
function ssrPromoteDebugLog(line){
  if(!ssrPromoteDebugMode) return;
  console.log('[ssrPromote]', line);
  ssrPromoteDebugLines.push(line);
  const el = document.getElementById('ssrPromoteDebug');
  el.classList.remove('hidden');
  el.textContent = ssrPromoteDebugLines.join('\n');
}
/* 昇格演出は「共通(ssr_promote.*)」と「スキン専用(SKIN_MEDIA[skinId].promote)」の2種類の素材があり、
   下の関数群で1本ずつの素材(media)と、その再生順(stages)を組み立てる。
   se/ensureSeはSE本体・先読み関数を直接参照する(audio.jsのconstはwindowのプロパティにならないため、
   文字列キー+window[...]でのルックアップは常にundefinedになり無音になってしまう。直接参照で回避する)。 */
function ssrPromotionDefaultMedia(){
  return {
    label: '共通',
    videoWebm: 'video/ssr_promote.webm', videoMp4: 'video/ssr_promote.mp4',
    se: (typeof seSsrPromote!=='undefined') ? seSsrPromote : null,
    ensureSe: (typeof ensureSsrPromoteSeBuffer==='function') ? ensureSsrPromoteSeBuffer : null,
    skipTapImage: false, safetyMs: 4000,
  };
}
function ssrPromotionSkinMedia(skinId){
  const p = (typeof skinMediaOf==='function' && skinMediaOf(skinId) || {}).promote;
  if(!(p && p.video)) return null;
  return {
    label: '専用',
    videoWebm: p.video + '.webm', videoMp4: p.video + '.mp4',
    se: (typeof skinPromoteSe==='function') ? skinPromoteSe(skinId) : null,
    ensureSe: (typeof ensureSkinPromoteSe==='function') ? ()=>ensureSkinPromoteSe(skinId) : null,
    // 専用動画があるスキンは音声も付いているので、タップ待ち画像を挟まず直接リビールへ進む
    skipTapImage: p.skipTapImage !== false,
    safetyMs: p.safetyMs || 20000,   // 動画+音声が終わらないときの保険(動画より長く取る)
  };
}
/* リビール画面(showSsrReveal)で流すBGM区分をここ1か所だけで決める。
   SKIN_MEDIA[skinId].promote.bgmOnReveal で明示指定があればそれを使うが、
   指定が無くても「自分専用のlastBattle曲を持っているならそれを使う」を既定にする
   (専用動画の有無やSKIN_MEDIAの書き方に関わらず必ずここを通るので、
   新しいSSRを追記した際にbgmOnRevealを書き忘れても、前に流れていた別SSRのBGMが
   鳴り続けたままになる事故が起きない。実際にメタルグレイモンでこの書き忘れが起きた)。
   専用BGMを何も持たないSSRはnullを返し、呼び出し元がリビール前のトラックへ戻す。 */
function ssrRevealBgmTrack(skinId){
  const media = (typeof skinMediaOf==='function' && skinMediaOf(skinId)) || null;
  if(!media || typeof skinBgmTrack!=='function') return null;
  const p = media.promote || {};
  const slot = p.bgmOnReveal || (media.bgm && media.bgm.lastBattle ? 'lastBattle' : null);
  return slot ? skinBgmTrack(skinId, slot) : null;
}
/* 再生する順番。**専用の昇格演出を持つスキンは、共通(ssr_promote)を前に挟んでから専用へ進む。**
   専用を持たないSSRは共通1本だけで、従来とまったく同じ動き(タップ待ち画像→リビール)。
   段を増やしたいときはこの配列に足すだけでよい(再生側はstagesを順番に回すだけ)。 */
function ssrPromotionStages(skinId){
  const skin = ssrPromotionSkinMedia(skinId);
  return skin ? [ssrPromotionDefaultMedia(), skin] : [ssrPromotionDefaultMedia()];
}
/* 昇格演出の全体。BGMの停止/復帰とオーバーレイの開閉は「通し」で1回ずつ行い、
   動画1本ぶんの再生は runSsrPromotionStage に任せる(段が何本でも同じ流れになる)。 */
function runSsrPromotionSequence(skinId, onContinue){
  const stages = ssrPromotionStages(skinId);
  const ov = document.getElementById('ssrPromoteOverlay');
  const debugEl = document.getElementById('ssrPromoteDebug');
  if(ssrPromoteDebugMode) debugEl.classList.remove('hidden'); else debugEl.classList.add('hidden');
  // 昇格演出中はBGMを止める。SSR獲得画面(showSsrReveal)表示時に元のトラック
  // (またはssrRevealBgmTrackが決めるそのSSR専用トラック)へ切り替える
  if(typeof bgmSetTrack==='function' && typeof bgmDesiredTrack==='function'){
    ssrPromoteBgmResumeTrack = ssrRevealBgmTrack(skinId) || bgmDesiredTrack();
    // スキン専用BGM(bgm_*.mp3)は試合開始時にしか先読みされないため、ここで切替前
    // (動画再生中の十数〜20秒)に読み込みを始めておく。先読みなしだとバッファが無い状態で
    // start()が無視され、リビール時に無音のままになる
    if(ssrPromoteBgmResumeTrack && ssrPromoteBgmResumeTrack.indexOf('skinBgm:')===0
       && typeof ensureSkinBgmBuffers==='function') ensureSkinBgmBuffers(ssrPromoteBgmResumeTrack.split(':')[1]);
    bgmSetTrack(null);
  }
  ov.classList.remove('hidden');
  let idx = 0;
  const runNext = ()=>{
    if(idx >= stages.length){
      ssrPromoteContinue = null;
      ov.classList.add('hidden');
      if(onContinue) onContinue();
      return;
    }
    const media = stages[idx++];
    ssrPromoteDebugLog(`--- ${idx}/${stages.length} ${media.label}の昇格演出 ---`);
    runSsrPromotionStage(media, skinId, runNext);
  };
  runNext();
}
// 昇格演出の1段(動画1本+同時に鳴らす音声)。終わったら onStageEnd を呼ぶ。
// オーバーレイの開閉とBGMは呼び出し元(runSsrPromotionSequence)が持つ。
function runSsrPromotionStage(media, skinId, onStageEnd){
  const video = document.getElementById('ssrPromoteVideo');
  const tapImg = document.getElementById('ssrPromoteTapImg');
  video.classList.remove('hidden'); tapImg.classList.add('hidden');
  // 動画ファイル自体は音無し(音声はWeb Audio側のSEを別途同時再生する)。
  // ミュートにしておくと自動再生がブロックされにくく、映像の頭切れも防げる。
  video.muted = true;
  // このスキン専用の動画ソースへ差し替える(source子要素のsrcを書き換えてload()し直す)
  // type属性で対象を選ぶ(子要素の並び順に依存すると、拡張子とtypeが食い違って再生できなくなる)
  const sourceMp4 = video.querySelector('source[type="video/mp4"]');
  const sourceWebm = video.querySelector('source[type="video/webm"]');
  if(sourceMp4) sourceMp4.src = media.videoMp4;
  if(sourceWebm) sourceWebm.src = media.videoWebm;
  video.load();
  ssrPromoteDebugLog(`skinId=${skinId} 動画src(webm)=${media.videoWebm} 動画src(mp4)=${media.videoMp4}`);
  let advanced = false;
  const finish = (reason)=>{
    if(advanced) return; advanced = true;
    ssrPromoteDebugLog(`→ この段の演出終了・次へ (${reason})`);
    clearTimeout(safetyTimer);
    video.classList.add('hidden'); video.pause();
    if(ssrPromoteContinue) ssrPromoteContinue(); // 後片付けも含めてここで実行される
  };
  const showTapImage = (reason)=>{
    if(advanced) return; advanced = true;
    ssrPromoteDebugLog(`→ タップ待ち画像を表示 (${reason})`);
    clearTimeout(safetyTimer);
    video.classList.add('hidden'); video.pause();
    tapImg.classList.remove('hidden');
  };
  // このスキンの昇格演出は「タップ待ち画像なし」の設定なら、動画終了時に直接次へ進む
  const onMediaEnd = (reason)=> media.skipTapImage ? finish(reason) : showTapImage(reason);
  // 動画が読み込み・再生に失敗しても(端末やファイル欠落等)必ず先へ進める
  video.onerror = ()=>{
    const err = video.error;
    ssrPromoteDebugLog(`❌ 動画onerror: code=${err&&err.code} message=${err&&err.message}`);
    onMediaEnd('動画エラー');
  };
  video.onended = ()=>{ ssrPromoteDebugLog('✅ 動画再生完了(ended)'); onMediaEnd('再生完了'); };
  video.onplaying = ()=> ssrPromoteDebugLog('✅ 動画再生開始(playing)');
  video.onstalled = ()=> ssrPromoteDebugLog('⚠️ 動画stalled');
  video.onwaiting = ()=> ssrPromoteDebugLog('⚠️ 動画waiting');
  // 万一どちらのイベントも発火しない場合の保険(動画の長さに応じてmedia.safetyMsを使う)
  const safetyTimer = setTimeout(()=>onMediaEnd('セーフティタイムアウト'), media.safetyMs);
  try{ video.currentTime = 0; }catch(err){ ssrPromoteDebugLog(`⚠️ currentTime設定失敗: ${err.message}`); }
  /* 動画ファイル自体は音無しで、音声はWeb Audio側から同時に鳴らす。
     音声の読み込みが間に合っていないと無音のまま演出が流れてしまうので、
     再生を始める前にデコードの完了を待つ(待てなければ映像だけで進める)。
     待ってから両方を始めるので、映像と音声がずれることもない。 */
  const startPlayback = ()=>{
    video.play().then(()=>{
      ssrPromoteDebugLog(`▶️ play()成功 currentSrc=${video.currentSrc}`);
      if(media.se && !media.se.play()){
        ssrPromoteDebugLog('⚠️ 音声を鳴らせなかった(SE音量0、または読み込み失敗)');
      }
    }).catch((err)=>{
      ssrPromoteDebugLog(`❌ play()失敗: ${err.name} ${err.message} currentSrc=${video.currentSrc||'(なし)'}`);
      onMediaEnd('play失敗');
    });
  };
  if(media.se && typeof media.se.ready==='function'){
    if(media.ensureSe) media.ensureSe();
    // 待ち時間はセーフティより十分短くする(待っている間に演出が打ち切られないように)
    media.se.ready(Math.min(6000, Math.max(1500, media.safetyMs/3))).then((ok)=>{
      ssrPromoteDebugLog(ok ? '✅ 音声の読み込み完了。動画と同時に鳴らす' : '⚠️ 音声の読み込みが間に合わないので映像だけで進める');
      startPlayback();
    });
  } else {
    if(media.ensureSe) media.ensureSe();
    startPlayback();
  }
  // タップ待ち画像のタップ(ssrPromoteOverlayのclick)からもここへ来る。
  // 次の段があればそれを始め、無ければ通し全体の後始末へ進む(onStageEnd = runNext)
  ssrPromoteContinue = ()=>{
    ssrPromoteContinue = null;
    clearTimeout(safetyTimer);
    video.onended = null; video.onerror = null; video.onplaying = null; video.onstalled = null; video.onwaiting = null;
    if(onStageEnd) onStageEnd();
  };
}
// 開発・管理者確認用: 3つの素材(動画mp4/動画webm/画像)が実際に読み込めるかをHTTPステータスで確認する。
// (端末のHTTPキャッシュに古い404が残っていると、ファイルを正しく置いても再現し続けるため
//  cache:'no-store' で必ずサーバーへ問い合わせる)
async function checkAssetUrls(urls){
  const check = async (url)=>{
    try{
      const res = await fetch(url, { cache:'no-store' });
      const len = res.headers.get('content-length');
      return `${url}: HTTP ${res.status}${res.ok?'':'(失敗)'} / ${res.headers.get('content-type')||'?'}${len?` / ${len}bytes`:''}`;
    }catch(err){ return `${url}: 通信エラー(${err.message})`; }
  };
  return Promise.all(urls.map(check));
}
async function checkSsrPromoteAssets(){
  const [v, vw, i] = await checkAssetUrls(['video/ssr_promote.mp4', 'video/ssr_promote.webm', 'images/ssr_promote_tap.jpg']);
  console.log('[ssrPromote] asset check:', v, '|', vw, '|', i);
  return { video: v, videoWebm: vw, img: i };
}
// スキンごとの昇格演出の素材確認は adminRunPromoteCheck が SKIN_MEDIA から直接URLを作る
async function checkAquaBattleBgmAssets(){
  const [b, f, l] = await checkAssetUrls(['audio/bgm_aqua_battle.mp3', 'audio/bgm_aqua_final5.mp3', 'audio/bgm_aqua_lastbattle.mp3']);
  console.log('[aquaBattleBgm] asset check:', b, '|', f, '|', l);
  return { battle: b, final5: f, lastBattle: l };
}
document.getElementById('ssrPromoteTapImg').addEventListener('load', ()=>{
  ssrPromoteDebugLog('✅ タップ待ち画像 読み込み成功');
});
document.getElementById('ssrPromoteTapImg').addEventListener('error', ()=>{
  console.warn('[ssrPromote] images/ssr_promote_tap.jpg の読み込みに失敗しました(ファイルが配置されているか確認してください)。画面タップでは先へ進めます。');
  ssrPromoteDebugLog('❌ タップ待ち画像 読み込み失敗(404等)。画面タップでは先へ進めます');
});
document.getElementById('ssrPromoteOverlay').addEventListener('click', ()=>{
  // 動画再生中はタップを無効化する(誤タップでスキップされないように)。
  // 動画が隠れた後(タップ待ち画像の表示中)だけタップに反応して先へ進む。
  const video = document.getElementById('ssrPromoteVideo');
  if(!video.classList.contains('hidden')) return;
  if(ssrPromoteContinue) ssrPromoteContinue();
});
document.getElementById('ssrRevealSkip').addEventListener('click', (e)=>{ e.stopPropagation(); if(ssrRevealContinue) ssrRevealContinue(); });
document.getElementById('ssrRevealOverlay').addEventListener('click', ()=>{ if(ssrRevealContinue) ssrRevealContinue(); });
function skinCellInner(skinId){
  const url = skinnedIconDataUrl(skinId);
  if(url) return `<img src="${url}" alt="">`;
  const m = skinMeta(skinId);
  return `<span class="gacha-cell-emoji">✨</span>`;
}
function showGachaResults(results, granted){
  const cells = results.map(r=>{
    let inner, rarCls, name, dup='';
    if(r.kind==='item'){
      const it=PLAYER_ITEMS[r.key];
      inner=`<span class="gacha-cell-emoji">${it.icon}</span>`;
      rarCls=r.rarity.toLowerCase(); name=it.name;
    } else {
      const m=skinMeta(r.skinId);
      inner=skinCellInner(r.skinId);
      rarCls=r.rarity.toLowerCase(); name=m.name;
      if(r.dup) dup=`<span class="gacha-dup-dia">💎${r.diaGain}</span>`;
    }
    const skinAttr = r.kind==='skin' ? ` data-skin="${r.skinId}"` : '';
    return `<div class="gacha-cell ${rarCls}"${skinAttr}>
      <span class="gacha-rar-tag rar-${r.rarity}">${r.rarity}</span>${dup}
      ${inner}<span class="gacha-cell-name">${name}</span></div>`;
  }).join('');
  const cols = results.length>1 ? 5 : 1;
  let grantMsg='';
  for(const k of CATALOG_KINDS){
    if(!granted.includes(k)) continue;
    grantMsg += `<div class="rar-${k==='sr'?'SR':'SSR'}" style="font-weight:700;">${CATALOG_LABEL[k]}を獲得！</div>`;
  }
  /* シェアは「一番いいものが出たとき」だけ出す。SSR > SR の順で1つ選ぶ
     (すべての行にボタンを付けると10連の結果が読めなくなる) */
  const brag = results.find(r=>r.kind==='skin' && r.rarity==='SSR' && !r.dup)
            || results.find(r=>r.kind==='skin' && r.rarity==='SR'  && !r.dup);
  if(brag) setLastSkinShare(brag.skinId);
  const shareBtn = brag ? '<button id="shareGachaBtn" class="gacha-share-btn"><span class="share-ico"></span> SNSでシェア</button>' : '';
  const res = document.getElementById('gachaResult');
  res.innerHTML = `<div class="gacha-result-grid" style="grid-template-columns:repeat(${cols},1fr)">${cells}</div>
    ${grantMsg}${shareBtn}<div class="gacha-result-tap">タップで閉じる</div>`;
  res.classList.remove('hidden');
  playSe('jakiin');
  updateGachaWallet(); updateAccountBar(); updateGachaCounterUI();
  // スキンのセルをタップしたら正面/後ろ姿のプレビューを開く(結果を閉じない)
  res.querySelectorAll('.gacha-cell[data-skin]').forEach(cell=>{
    cell.addEventListener('click', (e)=>{ e.stopPropagation(); showSkinPreview(cell.dataset.skin); });
  });
  // 結果はどこを触っても閉じるので、シェアだけは伝播を止める
  const gShare = document.getElementById('shareGachaBtn');
  if(gShare) gShare.addEventListener('click', (e)=>{
    e.stopPropagation();
    if(_lastSkinShare) openShareOverlay(_lastSkinShare.spec, _lastSkinShare.text);
  });
  res.onclick = ()=>{
    res.classList.add('hidden'); res.onclick=null;
    document.getElementById('gachaButtons').style.visibility='visible';
    gachaAnim.results=[]; gachaAnim.orbs=[];
    gachaAnimStart('idle');
  };
}
document.querySelectorAll('.gacha-tab').forEach(t=>{
  t.addEventListener('click', ()=> setGachaMode(t.dataset.gacha));
});
document.getElementById('gachaSingleBtn').addEventListener('click', ()=>doGacha(1));
document.getElementById('gachaTenBtn').addEventListener('click', ()=>doGacha(10));

// --- 提供割合モーダル ---
document.getElementById('gachaRatesBtn').addEventListener('click', ()=>{
  const rows = (typeof gachaMode!=='undefined' && gachaMode==='raid') ? raidGachaRateTable() : gachaRateTable();
  const fmt = p=>{ const r=Math.round(p); if(Math.abs(p-r)<0.005) return r+'%'; return (p>=1? p.toFixed(1): p.toFixed(2))+'%'; };
  const html = rows.map(row=>{
    const R = RARITIES[row.rarity];
    const items = row.items.map(it=>`<div class="gacha-rate-item"><span>${it.label}</span><span class="pct">${fmt(it.pct)}</span></div>`).join('');
    return `<div class="gacha-rate-rar"><span class="rar-${row.rarity}">${R.label}</span><span style="font-size:11px;color:var(--ink-dim)">${R.jp}</span><span class="pct">${R.rate}%</span></div>${items}`;
  }).join('');
  const note = `<div class="gacha-rate-note">10連ガチャの10連目はSR以上確定(SR ${GUARANTEED_SLOT_RATES.SR}% / SSR ${GUARANTEED_SLOT_RATES.SSR}%)</div>`;
  document.getElementById('gachaRatesBody').innerHTML = html + note;
  document.getElementById('gachaRatesModal').classList.remove('hidden');
});
document.getElementById('gachaRatesCloseBtn').addEventListener('click', ()=>{
  document.getElementById('gachaRatesModal').classList.add('hidden');
});

// --- スキンカタログ選択モーダル ---
let catalogPick = null, catalogKind = null;
function openCatalogModal(kind){
  catalogKind = kind; catalogPick = null;
  document.getElementById('gachaCatalogTitle').textContent = catalogTitle(kind);
  // 中身の決定は data.js の catalogSkinIds に寄せる(種類が増えてもここは変えない)
  const ids = catalogSkinIds(kind);
  const grid = document.getElementById('gachaCatalogGrid');
  grid.innerHTML = ids.map(id=>{
    const m = skinMeta(id); const owned = isSkinOwned(id);
    const url = skinnedIconDataUrl(id);
    const img = url ? `<img src="${url}" alt="">` : `<span class="gacha-cell-emoji">✨</span>`;
    return `<div class="gacha-cat-cell ${owned?'owned':''}" data-id="${id}">
      ${img}<span class="cat-name">${m.name}</span>${owned?'<span class="cat-owned-tag">所持</span>':''}</div>`;
  }).join('');
  grid.querySelectorAll('.gacha-cat-cell').forEach(cell=>{
    const id = cell.dataset.id;
    const owned = cell.classList.contains('owned');
    cell.addEventListener('click', ()=>{
      // タップで正面/後ろ姿のプレビューを表示。未所持なら「このスキンを選ぶ」ボタンで選択できる
      showSkinPreview(id, owned ? {} : { selectable:true, onSelect:()=>{
        grid.querySelectorAll('.gacha-cat-cell').forEach(c=>c.classList.remove('selected'));
        cell.classList.add('selected'); catalogPick = id;
        document.getElementById('gachaCatalogConfirmBtn').disabled = false;
      }});
    });
  });
  document.getElementById('gachaCatalogConfirmBtn').disabled = true;
  document.getElementById('gachaCatalogModal').classList.remove('hidden');
}
document.getElementById('gachaCatalogCancelBtn').addEventListener('click', ()=>{
  document.getElementById('gachaCatalogModal').classList.add('hidden');
});
document.getElementById('gachaCatalogConfirmBtn').addEventListener('click', ()=>{
  if(!catalogPick || !catalogKind) return;
  const cats = loadCatalogs();
  if((cats[catalogKind]||0) <= 0){ pushToast('カタログがありません'); return; }
  const pickedId = catalogPick;
  const meta = skinMeta(pickedId);
  ownSkin(pickedId);
  cats[catalogKind] -= 1; saveCatalogs(cats);
  document.getElementById('gachaCatalogModal').classList.add('hidden');
  updateGachaCounterUI();
  if(meta.rarity==='SSR'){
    // SSRを選んだ時も虹色の獲得演出を出す(カタログは常に未取得スキンのみ選べるため昇格演出は100%)
    runSsrPromotionSequence(pickedId, ()=> showSsrReveal(pickedId, ()=> pushToast(`${meta.name} を獲得！`)));
  } else {
    playSe('pickup');
    pushToast(`${meta.name} を獲得！`);
  }
});

// ===== ショップ(ゴールドでアイテム購入) =====
// ショップ店主「ラガゼウスモチ」の会話。購入回数に応じてセリフが変化する。
// 購入回数はショップを開く度にリセット(今回開いてからの回数)。
let shopBuysThisOpen = 0;
const SHOP_NPC_DEFAULT = '神界のアイテムを分けてやろう\n金はいただくがの';
function shopNpcBuyLine(count){
  if(count>=10) return '金じゃ金じゃうひょひょひょひょ！';
  if(count>=5) return '欲しがりじゃのう';
  return '上手く使うが良い';
}
function setShopDialogue(text){ const el=document.getElementById('shopNpcText'); if(el) el.textContent = text; }
function renderShop(){
  const w = loadWallet();
  document.getElementById('shopGold').textContent = `🪙 ${w.gold}`;
  const bag = loadBag();
  const listEl = document.getElementById('shopList');
  listEl.innerHTML = SHOP_ITEMS.map(([k, price])=>{
    const it = PLAYER_ITEMS[k];
    const owned = bag[k] || 0;
    return `
    <div class="bag-item">
      <div class="shop-item-top">
        <span class="bag-item-icon">${it.icon}</span>
        <span class="bag-item-text">
          <span class="bag-item-name">${it.name}</span>
          <span class="bag-item-desc">${playerItemDesc(k)}</span>
          <span class="shop-item-owned">所持数 ${owned}</span>
        </span>
      </div>
      <button class="bag-use-btn shop-buy-btn" data-key="${k}" data-price="${price}" ${w.gold<price?'disabled':''}>🪙${price}</button>
    </div>`;
  }).join('');
  listEl.querySelectorAll('.shop-buy-btn').forEach(b=>{
    b.addEventListener('click', ()=>buyShopItem(b.dataset.key, +b.dataset.price));
  });
}
function buyShopItem(itemKey, price){
  const w = loadWallet();
  if(w.gold < price){ pushToast('ゴールドが足りません'); return; }
  w.gold -= price;
  saveWallet(w);
  addBagItem(itemKey, 1);
  playSe('buy');
  pushToast(`${PLAYER_ITEMS[itemKey].name} を購入した！`);
  // 今回開いてからの購入回数を増やし、店主のセリフを回数帯に応じて変化させる
  shopBuysThisOpen++;
  setShopDialogue(shopNpcBuyLine(shopBuysThisOpen));
  renderShop();
  updateAccountBar();
}
// 管理者画面: 動作確認用のダイヤ付与(この端末のウォレットに加算→ログイン中なら自動同期)
/* パフォーマンス表示のON/OFF。端末ごとの開発用設定なのでアカウント同期には入れない。
   実体は render.js の perfEnabled()(OFFのときは計測処理そのものが走らない)。 */
const PERF_KEY = 'aramon_perf_v1';
function loadPerfPref(){ try{ return localStorage.getItem(PERF_KEY)==='1'; }catch(e){ return false; } }
function applyPerfPref(on){
  try{ localStorage.setItem(PERF_KEY, on?'1':'0'); }catch(e){}
  if(typeof perfEnabled==='function') perfEnabled(on);
  const btn = document.getElementById('adminPerfToggle');
  if(btn) btn.textContent = `📊 パフォーマンス表示: ${on?'ON':'OFF'}`;
}
document.getElementById('adminPerfToggle').addEventListener('click', ()=>{
  applyPerfPref(!loadPerfPref());
});
applyPerfPref(loadPerfPref());
document.getElementById('adminGrantDiaBtn').addEventListener('click', ()=>{
  addWallet(0, 500);
  updateAccountBar();
  pushToast('💎 ダイヤを500個付与しました');
});

/* 管理者画面の「機能」タブ: スキンをこの端末のアカウントへ付与/取り消しする。
   シーズンパス報酬のように通常は手に入らないスキンを、実機で確認・調整するため。
   saveSkins() が accountMarkDirty() を呼ぶのでサーバーにも同期される。          */
let adminSkinPick = null;
function adminSkinLabel(skinId){
  const m = skinMeta(skinId);
  if(m.kind === 'ssr'){
    const el = ELEMENTS[m.element] ? ELEMENTS[m.element].label : m.element;
    return `${el} / ${m.name}`;
  }
  return m.name;
}
function buildAdminSkinMenu(){
  const wrap = document.getElementById('adminSkinWrap');
  const menu = document.getElementById('adminSkinMenu');
  const btn  = document.getElementById('adminSkinBtn');
  if(!wrap || !menu || !btn) return;
  if(wrap.dataset.built){ adminSkinMarkOwned(); return; }
  wrap.dataset.built = '1';
  const rows = ['<div class="custom-select-group">SSRスキン</div>'];
  for(const id of allSsrSkinIds())
    rows.push(`<div class="custom-select-item" data-skin="${id}">${adminSkinLabel(id)}` +
              `${SSR_SKINS[id].seasonExclusive ? '(シーズン限定)' : ''}</div>`);
  rows.push('<div class="custom-select-group">色スキン</div>');
  for(const el of Object.keys(ELEMENTS))
    for(const c of monsterSkinColors(el)){
      const id = colorSkinId(el, c);
      rows.push(`<div class="custom-select-item" data-skin="${id}">${adminSkinLabel(id)}</div>`);
    }
  menu.innerHTML = rows.join('');
  btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    adminSkinMarkOwned();               // 開くたびに所持の印を付け直す
    menu.classList.toggle('hidden');
  });
  menu.addEventListener('click', (e)=>{
    const item = e.target.closest('.custom-select-item');
    if(!item) return;
    e.stopPropagation();
    menu.querySelectorAll('.custom-select-item').forEach(i=>i.classList.remove('active'));
    item.classList.add('active');
    adminSkinPick = item.dataset.skin;
    btn.textContent = item.textContent;
    menu.classList.add('hidden');
    updateAdminSkinBtn();
  });
  document.addEventListener('click', ()=> menu.classList.add('hidden'));
  adminSkinMarkOwned();
}
function adminSkinMarkOwned(){
  const menu = document.getElementById('adminSkinMenu');
  if(!menu) return;
  menu.querySelectorAll('.custom-select-item').forEach(i=>{
    i.classList.toggle('owned', isSkinOwned(i.dataset.skin));
  });
}
function updateAdminSkinBtn(){
  const b = document.getElementById('adminGrantSkinBtn');
  if(!b) return;
  if(!adminSkinPick){ b.disabled = true; b.textContent = '✨ スキンを選んでください'; return; }
  b.disabled = false;
  b.textContent = isSkinOwned(adminSkinPick)
    ? '🗑 このスキンの所持を取り消す' : '✨ このスキンを付与する';
}
document.getElementById('adminGrantSkinBtn').addEventListener('click', ()=>{
  if(!adminSkinPick) return;
  const name = adminSkinLabel(adminSkinPick);
  if(isSkinOwned(adminSkinPick)){
    disownSkin(adminSkinPick);
    pushToast(`${name} の所持を取り消しました`);
  }else{
    ownSkin(adminSkinPick);
    pushToast(`✨ ${name} を付与しました`);
  }
  updateAdminSkinBtn();
  adminSkinMarkOwned();
});
document.getElementById('openShopBtn').addEventListener('click', ()=>{
  shopBuysThisOpen = 0;               // 開く度に購入回数をリセット
  renderShop();
  setShopDialogue(SHOP_NPC_DEFAULT);  // 開いた直後はデフォルトセリフ
  document.getElementById('shopOverlay').classList.remove('hidden');
  // ショップ専用BGMに切替(音源はここで初回ロード。未ロード時はタイトル曲のまま代替)
  if(typeof ensureBgmShopBuffer==='function') ensureBgmShopBuffer();
  if(typeof bgmSetTrack==='function') bgmSetTrack('shop');
});
document.getElementById('closeShopBtn').addEventListener('click', ()=>{
  document.getElementById('shopOverlay').classList.add('hidden');
  if(typeof bgmSetTrack==='function') bgmSetTrack('title'); // トップ画面のBGMに戻す
});
document.getElementById('shopGoBagBtn').addEventListener('click', ()=>{
  document.getElementById('shopOverlay').classList.add('hidden'); // ショップは閉じてからバッグへ
  document.getElementById('openBagBtn').click(); // 既存のバッグを開く処理をそのまま使う
});
document.getElementById('shopGoMastermonBtn').addEventListener('click', ()=>{
  document.getElementById('shopOverlay').classList.add('hidden'); // ショップは閉じてからマスモンへ
  openMastermonScreen(false); // false=ロビーへ戻る(結果画面からの遷移ではないため)
});
// 更新履歴の未読管理: まだ開いて確認していない項目があるとボタンに「new」を出す。
// 署名は「最新日付#全項目数」なので、同じ日付に項目を足した場合も未読扱いになる。
// 端末ごとの既読状態なのでアカウント同期はしない(localStorageのみ)。
const CHANGELOG_SEEN_KEY = 'aramon_changelog_seen_v1';
function changelogSignature(){
  if(typeof UPDATE_HISTORY==='undefined' || !UPDATE_HISTORY.length) return '';
  const newest = UPDATE_HISTORY.map(e=>e.date).sort().pop();
  const total = UPDATE_HISTORY.reduce((n,e)=>n + ((e.items && e.items.length) || 0), 0);
  return `${newest}#${total}`;
}
function changelogHasUnread(){
  const sig = changelogSignature();
  if(!sig) return false;
  try{ return localStorage.getItem(CHANGELOG_SEEN_KEY) !== sig; }catch(err){ return false; }
}
function updateChangelogBadge(){
  const pop = document.getElementById('changelogNewPop');
  if(pop) pop.classList.toggle('hidden', !changelogHasUnread());
}
function markChangelogSeen(){
  try{ localStorage.setItem(CHANGELOG_SEEN_KEY, changelogSignature()); }catch(err){}
  updateChangelogBadge();
}
// 更新履歴: 日付降順で「プレイに関わる大きな変更」を表示する
// 選択中のタグ(nullで全件表示)
let changelogFilterTag = null;
function changelogItemText(it){ return (typeof it==='string') ? it : (it.t||''); }
function changelogItemTags(it){ return (typeof it==='string') ? [] : (it.g||[]); }
// color-mix()は古いiOSで使えないので、透過色はここで作ってCSS変数として渡す
function changelogTagVars(hex){
  return `--tg:${hex};--tgb:${caroHexToRgba(hex,0.15)};--tgl:${caroHexToRgba(hex,0.45)}`;
}
function changelogTagMeta(id){
  return (typeof CHANGELOG_TAGS!=='undefined' ? CHANGELOG_TAGS : []).find(t=>t.id===id) || null;
}
// タイトル横のタグ一覧。押すとそのタグを含む項目だけに絞り込む(もう一度押すと解除)
function renderChangelogTags(){
  const el = document.getElementById('changelogTags');
  if(!el || typeof CHANGELOG_TAGS==='undefined') return;
  // 件数も出しておくと、そのタグに何件あるか分かる
  const count = id => UPDATE_HISTORY.reduce((n,e)=>
    n + (e.items||[]).filter(it=>changelogItemTags(it).includes(id)).length, 0);
  el.innerHTML = [
    `<button class="changelog-tag all ${changelogFilterTag===null?'active':''}" data-tag="">すべて</button>`,
    ...CHANGELOG_TAGS.map(t=>{
      const n = count(t.id);
      if(!n) return '';
      return `<button class="changelog-tag ${changelogFilterTag===t.id?'active':''}" data-tag="${t.id}" style="${changelogTagVars(t.color)}">${t.label}<span class="changelog-tag-n">${n}</span></button>`;
    }),
  ].join('');
  el.querySelectorAll('.changelog-tag').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.dataset.tag || null;
      changelogFilterTag = (id && changelogFilterTag===id) ? null : id;
      renderChangelogTags();
      renderChangelogList();
    });
  });
}
function renderChangelogList(){
  const listEl = document.getElementById('changelogList');
  if(!listEl || typeof UPDATE_HISTORY==='undefined') return;
  const entries = [...UPDATE_HISTORY].sort((a,b)=> (a.date<b.date?1:a.date>b.date?-1:0)); // 日付降順
  const tagChips = it => changelogItemTags(it).map(id=>{
    const m = changelogTagMeta(id);
    return m ? `<span class="changelog-item-tag" style="${changelogTagVars(m.color)}">${m.label}</span>` : '';
  }).join('');
  let shown = 0;
  const html = entries.map(e=>{
    const items = (e.items||[]).filter(it=>
      !changelogFilterTag || changelogItemTags(it).includes(changelogFilterTag));
    if(!items.length) return '';       // その日に該当が無ければ日付ごと出さない
    shown += items.length;
    return `
    <div class="changelog-entry">
      <div class="changelog-date">${e.date}</div>
      <ul class="changelog-items">${items.map(it=>
        `<li>${changelogItemText(it)}<span class="changelog-item-tags">${tagChips(it)}</span></li>`).join('')}</ul>
    </div>`;
  }).join('');
  listEl.innerHTML = shown ? html : '<div class="changelog-empty">該当する更新はありません</div>';
  listEl.scrollTop = 0;
  attachVisibleScrollbar(listEl, listEl.parentElement.querySelector('.mm-scrollbar'));
}
function renderChangelog(){
  renderChangelogTags();
  renderChangelogList();
}
document.getElementById('changelogBtn').addEventListener('click', ()=>{
  renderChangelog();
  document.getElementById('changelogOverlay').classList.remove('hidden');
  markChangelogSeen(); // 開いたら既読にして「new」を消す
});
document.getElementById('closeChangelogBtn').addEventListener('click', ()=>{
  document.getElementById('changelogOverlay').classList.add('hidden');
});
updateAccountBar();
if(typeof dailyCheckLogin==='function') dailyCheckLogin(); // 起動時にログインボーナス＆ミッション更新
if(typeof updateSeasonBadge==='function') updateSeasonBadge(); // シーズンの受取可能ドット
updateChangelogBadge(); // 更新履歴の未読「new」バッジ

document.getElementById('howToPlayBtn').addEventListener('click', ()=>{
  document.getElementById('howToPlayScreen').classList.remove('hidden');
  document.getElementById('startScreen').classList.add('hidden');
});
document.getElementById('closeHowToPlayBtn').addEventListener('click', ()=>{
  document.getElementById('howToPlayScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
});

const PLAYER_NAME_KEY = 'aramon_player_name_v1';
(function restorePlayerName(){
  try{
    const saved = localStorage.getItem(PLAYER_NAME_KEY);
    if(saved) document.getElementById('playerNameInput').value = saved;
  }catch(err){}
})();
document.getElementById('playerNameInput').addEventListener('input', (e)=>{
  try{ localStorage.setItem(PLAYER_NAME_KEY, e.target.value); }catch(err){}
  accountMarkDirty();
});

const INVERT_PITCH_KEY = 'aramon_invert_pitch_v1';
let invertPitchY = false;
(function restoreInvertPitch(){
  try{ invertPitchY = localStorage.getItem(INVERT_PITCH_KEY) === '1'; }catch(err){}
  document.getElementById('invertPitchToggle').setAttribute('aria-checked', invertPitchY ? 'true' : 'false');
})();
document.getElementById('invertPitchToggle').addEventListener('click', ()=>{
  invertPitchY = !invertPitchY;
  document.getElementById('invertPitchToggle').setAttribute('aria-checked', invertPitchY ? 'true' : 'false');
  try{ localStorage.setItem(INVERT_PITCH_KEY, invertPitchY ? '1' : '0'); }catch(err){}
});

/* =====================================================================
   MULTIPLAYER STATE
===================================================================== */
const netState = {
  mode:'solo', capacity:3, roomId:null, isHost:false, myPlayerId:null, hostId:null,
  humanPlayers:{}, lobbyPollTimer:null, matchStarting:false, cancelled:false,
  raid:false,   // レイドの部屋か(部屋のmodeと一致させる。試合の組み立てが変わる)
};

/* =====================================================================
   プレイモードの持ち方(ここを崩すと「通常マルチのつもりがレイドになる」類の事故が起きる)

   **役割の違う2つを混ぜない。**
     lobbyMode      … ロビーでプレイヤーが選んだもの('solo'/'multi'/'raid')。
                      タブの見た目・ロビーの表示・保存(前回の選択)の**唯一の正**。
     netState.mode  … いま組み立てている「部屋/試合」がマルチかどうか
     netState.raid  … いま組み立てている「部屋/試合」がレイドかどうか

   以前は netState.raid 1つで両方を表していたため、レイドを1回遊ぶと立ったまま残り、
   次に通常マルチの「部屋を作る」を押すとレイドの部屋ができてしまっていた(逆も同様)。

   決まり:
     ・**lobbyMode を変えるのは setLobbyMode() だけ。** タブ・レイド入口・復元のすべてが通る。
     ・**試合/部屋を作り始める直前に必ず syncNetStateToLobbyMode() を呼ぶ**(startGame /
       createRoomFlow / openFindRoomScreen)。ロビーの選択が実際の部屋の種類になる。
     ・**他人の部屋に入るときだけは部屋の側が正**(joinRoom で部屋のmodeを netState と
       lobbyMode の両方へ反映する)。
     ・**試合から戻ったら必ず syncNetStateToLobbyMode() で作り直す**(前の試合の持ち越しを断つ)。
   ===================================================================== */
let lobbyMode = 'solo';
// lobbyMode から netState を作り直す。これ以外の場所で netState.raid を書かない
function syncNetStateToLobbyMode(){
  netState.mode = (lobbyMode==='solo') ? 'solo' : 'multi';
  netState.raid = (lobbyMode==='raid');
}
/* ロビーの選択を変える唯一の入口。タブの見た目・パネルの出し分け・ラベル・保存まで面倒を見る。
   opts.save=false のときだけ保存しない(復元中に上書きし返さないため)。 */
function setLobbyMode(mode, opts){
  lobbyMode = (mode==='multi' || mode==='raid') ? mode : 'solo';
  syncNetStateToLobbyMode();
  const isRaid = lobbyMode==='raid';
  document.querySelectorAll('.mode-tab').forEach(t=> t.classList.toggle('active', t.dataset.mode===lobbyMode));
  // 人数などの細かい設定はプレイモードのオーバーレイ内、出撃ボタンは右カラムに出す
  document.getElementById('multiOptions').classList.toggle('hidden', lobbyMode!=='multi');
  document.getElementById('multiActionRow').classList.toggle('hidden', lobbyMode!=='multi');
  document.getElementById('joinBtn').classList.toggle('hidden', lobbyMode!=='solo');
  document.getElementById('raidModeOptions').classList.toggle('hidden', !isRaid);
  if(isRaid && typeof updateRaidModePanel==='function') updateRaidModePanel();
  if(typeof updateLobbyPickLabels==='function') updateLobbyPickLabels();
  if(!(opts && opts.save===false) && typeof saveLobbyPrefs==='function') saveLobbyPrefs();
}
let hostSpectating = false;
let matchBeginning = false; // beginMultiplayerMatchの多重起動防止フラグ

/* タブの選択は #modeTabs への委譲で受ける。
   「みんなと対戦」「レイドバトル」はポップを乗せるために .mode-tab-wrap で包んであり、
   **ボタンの外側(ラッパーの余白やポップの上)を踏むと何も起きなかった**。
   ラッパーごと拾って中のボタンへ解決することで、見えている範囲のどこを触っても選べる
   (これが「レイドを選んでもロビーの表示が切り替わらない」不具合の原因だった)。 */
document.getElementById('modeTabs').addEventListener('click', (e)=>{
  const wrap = e.target.closest('.mode-tab-wrap');
  const tab = e.target.closest('.mode-tab') || (wrap && wrap.querySelector('.mode-tab'));
  if(tab) selectModeTab(tab);
});
// タブのクリックはすべて setLobbyMode() へ流す(モードを変える処理を2か所に書かない)
function selectModeTab(tab){ setLobbyMode(tab.dataset.mode); }
// game.selectedMap が 'random' の場合は実在マップからランダムに1つ選ぶ
// リアルマップ(テスト)ならWebGLの地形レイヤーを有効化する。
// 初期化に失敗した端末では自動的に従来の2D地面に戻る(render.js側で判定)
function applyReal3DLayer(){
  if(!window.__aramonReal3D) return;
  // マップごとの見た目(空・霞・地面の色・遠景の山)をWebGL側へ渡してから有効化する
  window.__aramonRealTheme = (currentMap && currentMap.real3dTheme && REAL3D_THEMES[currentMap.real3dTheme])
    ? REAL3D_THEMES[currentMap.real3dTheme] : null;
  window.__aramonReal3D.setActive(!!(currentMap && currentMap.real3d));
}
/* マップ選択は「通常マップのキー」+「リアル切替(game.realMapMode)」で持つ。
   実際に使うマップキーはここで組み立てる(リアル版は <キー>_real)。 */
function mapKeyForMode(baseKey){
  const k = game.realMapMode ? baseKey+REAL_MAP_SUFFIX : baseKey;
  return MAPS[k] ? k : (MAPS[baseKey] ? baseKey : 'wild');
}
/* 通常の試合で使うマップキーを決める。
   **レイド専用マップ(竜の火口)を絶対に返さない**こと。返してしまうと、試合の
   組み立て側が「マップがraid=レイドの試合」とみなして、通常マルチのつもりが
   レイドバトルとして始まる(実機で発生。原因はランダム抽選が raidOnly を
   見ていなかったこと)。出してよいマップの判定は data.js の isSelectableMap() 1か所。 */
function resolveMapKey(){
  if(game.selectedMap && game.selectedMap!=='random'){
    const k = mapKeyForMode(game.selectedMap);
    return isSelectableMap(k) ? k : 'wild';   // 壊れた保存値でレイド用マップが来ても弾く
  }
  // ランダムは、いま選んでいる側(通常/リアル)の中から選ぶ
  const wantReal = !!game.realMapMode;
  const keys = Object.keys(MAPS).filter(k=> isSelectableMap(k) && !!MAPS[k].real3d===wantReal);
  if(!keys.length) return 'wild';
  return keys[Math.floor(Math.random()*keys.length)];
}
function updateMapPreview(){
  const imgEl = document.getElementById('mapPreviewImage');
  const iconEl = document.getElementById('mapPreviewIcon');
  const nameEl = document.getElementById('mapPreviewName');
  const descEl = document.getElementById('mapPreviewDesc');
  if(!imgEl) return;
  if(game.selectedMap==='random'){
    imgEl.style.background = 'linear-gradient(135deg, #4a3a6a, #1a1030)';
    iconEl.textContent = '🎲';
    nameEl.textContent = game.realMapMode ? 'ランダム(リアル)' : 'ランダム';
    descEl.textContent = game.realMapMode
      ? 'リアルマップの中からランダムで選ばれる。報酬2倍'
      : '全てのマップからランダムで選ばれる。ドキドキ';
    return;
  }
  const map = MAPS[mapKeyForMode(game.selectedMap)] || MAPS.wild;
  const colors = map.previewColors || [map.groundColor||'#333', map.groundColor||'#111'];
  imgEl.style.background = `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`;
  iconEl.textContent = map.previewIcon || '🗺️';
  nameEl.textContent = map.label;
  descEl.textContent = map.desc || '';
}
// 通常/リアルの切替。選んでいるマップはそのままで、地形の種類だけ入れ替える
function setRealMapMode(on){
  game.realMapMode = !!on;
  document.querySelectorAll('#mapModeToggle .map-mode-btn').forEach(b=>{
    b.classList.toggle('active', (b.dataset.mode==='real') === game.realMapMode);
  });
  const note = document.getElementById('mapModeNote');
  if(note) note.textContent = game.realMapMode
    ? '地面が立体になった上級者向けマップ。獲得ゴールド・ダイヤが2倍になります'
    : '従来のマップ。地面は平らです';
  updateMapPreview();
  if(typeof updateLobbyPickLabels==='function') updateLobbyPickLabels();
  if(typeof saveLobbyPrefs==='function') saveLobbyPrefs();
}
document.querySelectorAll('#mapModeToggle .map-mode-btn').forEach(btn=>{
  btn.addEventListener('click', ()=> setRealMapMode(btn.dataset.mode==='real'));
});
document.querySelectorAll('.map-tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.map-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    const key = tab.dataset.map;
    game.selectedMap = (key==='random' || MAPS[key]) ? key : 'wild';   // 通常マップのキーで保持し、リアルかどうかはトグルで決める
    updateMapPreview();
    if(typeof updateLobbyPickLabels==='function') updateLobbyPickLabels();
    saveLobbyPrefs();
  });
});
setRealMapMode(false);   // 起動時は通常マップ
document.querySelectorAll('.cap-tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.cap-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    netState.capacity = Number(tab.dataset.cap)||3;
    /* 【触らない】ここで netState.raid を下ろさないこと。
       この人数タブは通常マルチのときしか出ないが、以前ここで raid を false にしていたため、
       レイドの状態のまま人数を触ると**レイドの部屋なのに通常戦が始まる**事故になっていた。
       モードを決めるのは setLobbyMode() だけ。 */
    // 右カラムの「プレイモード」の表示にも人数を反映する(マップ側と同じ扱い)
    if(typeof updateLobbyPickLabels==='function') updateLobbyPickLabels();
    saveLobbyPrefs();
  });
});

function renderLobbyPlayerList(){
  const listEl = document.getElementById('lobbyPlayerList');
  const rows = [];
  const human = netState.humanPlayers || {};
  const humanIds = Object.keys(human);
  humanIds.forEach(id=>{
    const p = human[id];
    const hostTag = id===netState.hostId ? '（ホスト）' : '';
    rows.push(`<div class="lobby-player-row"><span class="lp-dot"></span><span>${p.name||'名無しのモンスター'}${hostTag}（${ELEMENTS[p.element]?.label||'?'}）${id===netState.myPlayerId?'（あなた）':''}</span></div>`);
  });
  const botCount = Math.max(0, netState.capacity - humanIds.length);
  for(let i=0;i<botCount;i++){
    rows.push(`<div class="lobby-player-row is-bot"><span class="lp-dot"></span><span>Bot 待機枠</span></div>`);
  }
  listEl.innerHTML = rows.join('');
  document.getElementById('lobbySubText').textContent = `${humanIds.length} / ${netState.capacity} 人が参加中`;
}

// ホストが「スタート」を押した後の3秒カウントダウンの状態。
// hostCountdownSnapshotが非nullの間は「カウント中」を意味し、この間に参加者が
// 減った場合はcancelHostCountdown()で開始を取り消す。
let hostCountdownTimer = null;
let hostCountdownSnapshot = null;
let guestCountdownTimer = null;

function showLobbyButtonsForRole(){
  document.getElementById('lobbyCancelBtn').classList.add('hidden');
  document.getElementById('lobbyHostBtnRow').classList.toggle('hidden', !netState.isHost);
  document.getElementById('lobbyGuestLeaveBtn').classList.toggle('hidden', !!netState.isHost);
}

function resetLobbyCountdownDisplay(){
  document.getElementById('lobbyCountdown').textContent='';
  if(guestCountdownTimer){ clearInterval(guestCountdownTimer); guestCountdownTimer=null; }
}

function startLobbyCountdownDisplay(startAt){
  resetLobbyCountdownDisplay();
  const tick = ()=>{
    const remain = Math.max(0, Math.ceil((startAt-Date.now())/1000));
    document.getElementById('lobbyCountdown').textContent = remain>0 ? `まもなく開始… ${remain}` : 'まもなく開始…';
  };
  tick();
  guestCountdownTimer = setInterval(tick, 250);
}

function cancelHostCountdown(reason){
  if(hostCountdownTimer){ clearTimeout(hostCountdownTimer); hostCountdownTimer=null; }
  hostCountdownSnapshot = null;
  resetLobbyCountdownDisplay();
  document.getElementById('lobbySubText').textContent='他のプレイヤーを待っています。準備ができたら「スタート」を押してください';
  if(netState.roomId) window.__aramonCancelRoomStarting(netState.roomId);
  if(reason) pushToast(reason);
}

async function handleRoomDisbanded(){
  matchBeginning = false;
  resetLobbyCountdownDisplay();
  document.getElementById('lobbyScreen').classList.add('hidden');
  pushToast('ホストが部屋を解散しました');
  joinInProgress = false;
  updatePlayButtonsEnabled();
  await openFindRoomScreen();
}

function enterLobbyForRoom(){
  document.getElementById('lobbyScreen').classList.remove('hidden');
  resetLobbyCountdownDisplay();
  document.getElementById('lobbyPlayerList').innerHTML='';
  hostCountdownTimer=null; hostCountdownSnapshot=null;
  showLobbyButtonsForRole();

  window.__aramonWatchRoomPlayers(netState.roomId, (players)=>{
    netState.humanPlayers = players||{};
    renderLobbyPlayerList();
    // ホストのスタートカウント中に参加者が抜けた場合は開始をキャンセルする
    if(netState.isHost && hostCountdownSnapshot){
      const stillHere = hostCountdownSnapshot.every(id => players && players[id]);
      if(!stillHere) cancelHostCountdown('参加者が退出したため開始をキャンセルしました');
    }
  });

  if(netState.isHost){
    document.getElementById('lobbySubText').textContent='他のプレイヤーを待っています。準備ができたら「スタート」を押してください';
  } else {
    document.getElementById('lobbySubText').textContent='ホストが試合を開始するのを待っています…';
    window.__aramonWatchRoomMeta(netState.roomId, (meta)=>{
      if(!meta){
        if(!game.started && !matchBeginning) handleRoomDisbanded();
        return;
      }
      if(meta.hostId){ netState.hostId = meta.hostId; renderLobbyPlayerList(); }
      if(typeof meta.capacity==='number'){ netState.capacity = meta.capacity; if(typeof updateLobbyPickLabels==='function') updateLobbyPickLabels(); }
      if(meta.status==='starting' && meta.startAt && !matchBeginning){
        startLobbyCountdownDisplay(meta.startAt);
      } else if(meta.status==='waiting'){
        resetLobbyCountdownDisplay();
        document.getElementById('lobbySubText').textContent='ホストが試合を開始するのを待っています…';
      } else if(meta.status==='playing' && !game.started && !matchBeginning){
        beginMultiplayerMatch();
      }
    });
  }
}

function getDisplayNameFromInput(){
  const rawName = (document.getElementById('playerNameInput').value||'').trim();
  return rawName ? rawName.slice(0,12) : '名無しのモンスター';
}

// マスモンで参戦する場合、そのレベルと育成ステータスを部屋の自分のプレイヤー情報に載せる。
// level = 倒した相手がレベルに応じたEXPボーナスを得るために使う。
// stats = ホスト・ゲストの双方が同じ育成補正(HP/速度/与ダメ等)を計算するために使う。
// ステータスを共有しないとホストだけが自分の育成値を知っている状態になり、
// マルチではマスモンを育てても強くならない/HPが食い違うことになる。
function currentMastermonInfo(){
  if(!game.selectedMastermonKey) return null;
  const mm = loadMastermons()[game.selectedMastermonKey];
  if(!mm) return null;
  const src = mm.stats || {};
  const stats = {};
  MASTERMON_STATS.forEach(s=>{ stats[s.key] = Math.round(src[s.key]||0); });
  // 転生と基礎値アイテムの情報も必ず載せる。適正S以上(倍率の伸びが良くなる)と基礎値加算を
  // 片側だけで掛けるとホストとゲストでHP・移動速度が食い違い、ゲストの位置補正が暴れる。
  // Firebaseはundefinedを受け付けないのでnullで送る。
  const apt = {};
  const srcApt = mastermonApt(mm);
  MASTERMON_STATS.forEach(s=>{ apt[s.key] = srcApt[s.key] || 'C'; });
  // baseHp/baseSpd は「基礎値アイテムぶん」だけを素のまま送る。
  // 受け側は mastermonBaseBonus() で rebirth から転生ぶんを足し直すので、
  // ここで合計を送ると転生ぶんが二重に乗る。
  return { level: mm.level||1, stats, rebirth: mastermonRebirthCount(mm), apt,
    baseHp: safeBaseAmount(mm.baseHp), baseSpd: safeBaseAmount(mm.baseSpd) };
}
// 今参戦するモンスターに装備中のスキンID(マルチプレイで相手にも見せるため送る)
function currentEquippedSkinId(){
  if(!game.selectedElement || typeof getEquippedSkin!=='function') return null;
  return getEquippedSkin(game.selectedElement) || null;
}
async function createRoomFlow(){
  if(!window.__aramonCreateRoom){
    pushToast('通信機能が利用できません。1人でプレイに切り替えます');
    startGame();
    return;
  }
  /* 【必須】部屋を作る直前に、ロビーの選択から netState を作り直す。
     こうしないと前の試合で立った netState.raid が残り、通常マルチのつもりで
     レイドの部屋ができる(逆も同様)。部屋のmodeは下で netState.raid から決まる。 */
  syncNetStateToLobbyMode();
  netState.cancelled = false;
  matchBeginning = false;
  document.getElementById('lobbySubText').textContent='部屋を作成中…';
  document.getElementById('lobbyScreen').classList.remove('hidden');
  document.getElementById('lobbyPlayerList').innerHTML='';
  document.getElementById('lobbyCountdown').textContent='';
  document.getElementById('lobbyHostBtnRow').classList.add('hidden');
  document.getElementById('lobbyGuestLeaveBtn').classList.add('hidden');
  document.getElementById('lobbyCancelBtn').classList.remove('hidden');

  const displayName = getDisplayNameFromInput();
  let result;
  try{
    result = await window.__aramonCreateRoom(netState.capacity, displayName, game.selectedElement, currentMastermonInfo(), currentEquippedSkinId(), netState.raid?'raid':'br');
  }catch(err){
    console.error(err);
    pushToast('部屋の作成に失敗しました。1人でプレイに切り替えます');
    document.getElementById('lobbyScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
    startGame();
    return;
  }
  if(netState.cancelled) return;

  netState.roomId = result.roomId;
  netState.isHost = true;
  netState.myPlayerId = result.myPlayerId;
  netState.hostId = netState.myPlayerId;

  enterLobbyForRoom();
}

async function openFindRoomScreen(){
  // 探す部屋の種類もロビーの選択から決める(一覧は netState.raid で 'raid'/'br' に分かれる)
  syncNetStateToLobbyMode();
  document.getElementById('roomListScreen').classList.remove('hidden');
  // レイド経由(netState.raid)ならタイトルを変えて、どちらの部屋を探しているか分かるようにする
  document.getElementById('roomListTitle').textContent = netState.raid ? '🐉 レイドの部屋を探す' : '部屋を探す';
  await refreshRoomList();
}
async function refreshRoomList(){
  const listEl = document.getElementById('roomListItems');
  const subEl = document.getElementById('roomListSubText');
  subEl.textContent = '募集中の部屋を検索中…';
  listEl.innerHTML = '<div class="rank-empty">検索中…</div>';
  if(!window.__aramonListOpenRooms){
    listEl.innerHTML = '<div class="rank-empty">通信機能が利用できません</div>';
    subEl.textContent = '';
    return;
  }
  const rooms = await window.__aramonListOpenRooms(netState.raid?'raid':'br');
  if(!rooms.length){
    listEl.innerHTML = '<div class="rank-empty">現在募集中の部屋はありません</div>';
    subEl.textContent = '部屋が見つかりませんでした';
    return;
  }
  subEl.textContent = `${rooms.length}件の部屋が見つかりました`;
  listEl.innerHTML = rooms.map(r=>`
    <div class="room-row" data-room-id="${r.roomId}" data-lobby-key="${r.lobbyKey}">
      <div>
        <div class="rm-host">${r.hostName}の部屋</div>
        <div class="rm-sub">定員 ${r.capacity}人</div>
      </div>
      <div class="rm-count">${r.count} / ${r.capacity}</div>
    </div>
  `).join('');
  listEl.querySelectorAll('.room-row').forEach(row=>{
    row.addEventListener('click', ()=>joinSelectedRoom(row.dataset.roomId, row.dataset.lobbyKey));
  });
}
async function joinSelectedRoom(roomId, lobbyKey){
  if(!window.__aramonJoinRoom){
    pushToast('通信機能が利用できません');
    return;
  }
  const displayName = getDisplayNameFromInput();
  const result = await window.__aramonJoinRoom(roomId, lobbyKey, displayName, game.selectedElement, currentMastermonInfo(), currentEquippedSkinId());
  if(!result.ok){
    pushToast(result.reason||'参加に失敗しました');
    await refreshRoomList();
    return;
  }
  netState.cancelled = false;
  matchBeginning = false;
  netState.roomId = result.roomId;
  netState.isHost = false;
  netState.myPlayerId = result.myPlayerId;
  if(result.capacity){ netState.capacity = result.capacity; if(typeof updateLobbyPickLabels==='function') updateLobbyPickLabels(); }
  /* 【ここだけは部屋が正】他人の部屋に入るときは、部屋のmodeが実際に始まる試合を決める。
     ロビーの表示もそれに合わせて動かし、「レイドの部屋に入ったのに表示はみんなと対戦」を無くす。 */
  setLobbyMode(result.mode==='raid' ? 'raid' : 'multi');

  document.getElementById('roomListScreen').classList.add('hidden');
  document.getElementById('lobbySubText').textContent='ホストが試合を開始するのを待っています…';
  enterLobbyForRoom();
}


document.getElementById('lobbyStartBtn').addEventListener('click', async ()=>{
  if(hostCountdownSnapshot) return; // カウント中の多重押下防止
  hostCountdownSnapshot = Object.keys(netState.humanPlayers||{});
  const startAt = Date.now() + 3000;
  netState.matchStarting = false;
  await window.__aramonSetRoomStarting(netState.roomId, startAt);
  startLobbyCountdownDisplay(startAt);
  hostCountdownTimer = setTimeout(async ()=>{
    hostCountdownTimer = null;
    if(!hostCountdownSnapshot) return; // 途中でキャンセル済み
    hostCountdownSnapshot = null;
    netState.matchStarting = true;
    await window.__aramonSetRoomStatus(netState.roomId, 'playing');
    window.__aramonCleanupLobbyEntry();
    beginMultiplayerMatch();
  }, 3000);
});

document.getElementById('lobbyDisbandBtn').addEventListener('click', async ()=>{
  if(hostCountdownTimer){ clearTimeout(hostCountdownTimer); hostCountdownTimer=null; }
  hostCountdownSnapshot = null;
  resetLobbyCountdownDisplay();
  const roomId = netState.roomId;
  const lobbyEntryId = window.__aramonLobbyEntryId;
  document.getElementById('lobbyScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
  joinInProgress = false;
  updatePlayButtonsEnabled();
  netState.roomId=null; netState.isHost=false; netState.humanPlayers={}; netState.hostId=null;
  matchBeginning = false;
  if(roomId){
    await window.__aramonLeaveRoom(roomId); // 自分のリスナー解除+players登録解除
    await window.__aramonDisbandRoom(roomId, lobbyEntryId); // 部屋自体を削除
  }
});

document.getElementById('lobbyGuestLeaveBtn').addEventListener('click', async ()=>{
  netState.cancelled = true;
  resetLobbyCountdownDisplay();
  joinInProgress = false;
  updatePlayButtonsEnabled();
  if(netState.roomId) await window.__aramonLeaveRoom(netState.roomId);
  document.getElementById('lobbyScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
});

document.getElementById('lobbyCancelBtn').addEventListener('click', async ()=>{
  netState.cancelled = true;
  joinInProgress = false;
  updatePlayButtonsEnabled();
  if(netState.roomId){
    await window.__aramonLeaveRoom(netState.roomId);
    await window.__aramonCleanupLobbyEntry();
  }
  document.getElementById('lobbyScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
});

function startGame(){
  game.trainingRange = false;   // 射撃訓練場の状態を持ち越さない
  raidResetState();             // レイドの状態も持ち越さない(下記コメント参照)
  // ロビーの選択から netState を作り直す(1人でプレイなので solo に確定する)
  syncNetStateToLobbyMode();
  document.getElementById('rangeBar').classList.add('hidden');
  document.getElementById('rangeHint').classList.add('hidden');
  document.getElementById('hud').classList.remove('range-mode');
  entities=[]; projectiles=[]; lootItems=[]; particles=[]; areaEffects=[]; pendingAoeCasts=[]; nextId=1;
  matchTime=0; game.over=false; game.tipTimer=7; lastGutsWarnAt=-Infinity;
  hostSpectating=false; spectateTargetId=null;   // 前の試合の観戦状態を持ち越さない
  camState.yaw = 0; camState.pitch = 0.27;
  camSnap.active = false;
  monsterScreenPos.clear();
  Object.keys(keys).forEach(k=>keys[k]=false);
  fireBtnHeld=false; joystick.active=false; joystick.nx=0; joystick.ny=0;
  if(typeof setAutoRun==='function') setAutoRun(false); // 試合開始時はオートラン解除
  joyKnobEl.style.transform='translate(0,0)';
  game.activeMapKey = resolveMapKey();   // 'ランダム'選択時はここで実マップを確定
  currentMap = MAPS[game.activeMapKey] || MAPS.wild;
  applyStartPitchForMap();   // マップが決まってから視点の初期角度を決める
  applyReal3DLayer();
  applyWorldScale(1);
  initZone();
  genVolcanoAndLava();
  genWater();
  genOasisZones();
  genRocks();
  genCrystals();
  genTerrain();

  let playerDisplayName = 'プレイヤー';
  if(game.selectedMastermonKey){
    const mmData = loadMastermons()[game.selectedMastermonKey];
    if(mmData) playerDisplayName = mmData.name;
  }
  const totalEntityCount = 30;
  const spawnPoints = pickSpawnPointsBatch(totalEntityCount);
  player = createMonster(game.selectedElement, true, playerDisplayName, { spawnPoint: spawnPoints[0] });
  applyMastermonToPlayer();
  entities.push(player);
  const names = shuffle(BOT_NAMES);
  const botElements = shuffle(Object.keys(ELEMENTS));
  /* 敵botのステータスは、プレイヤーのマスモンレベル±10程度(適正に応じた育ち方)に合わせる。
     **転生していれば、その回数ぶん敵も強くなる**(ステータス上限と基礎値の上昇を敵にも掛ける)。
     転生で自分だけ強くなると手応えが無くなるため。マスモン未選択時はベースのまま。 */
  const playerMm = (game.selectedMastermonKey && loadMastermons()[game.selectedMastermonKey]) || null;
  const playerMmLevel = playerMm ? playerMm.level : null;
  const playerRebirth = mastermonRebirthCount(playerMm);
  for(let i=0;i<29;i++){
    const elKey = botElements[i % botElements.length];
    const bot = createMonster(elKey, false, names[i % names.length]+ (i>=names.length?'Ⅱ':''), { spawnPoint: spawnPoints[i+1] });
    if(playerMmLevel){
      const botLevel = clamp(playerMmLevel + randInt(-10, 10), 1, MASTERMON_LEVEL_CAP);
      applyMastermonStatsToEntity(bot, syntheticMastermonForLevel(elKey, botLevel, playerRebirth));
    }
    entities.push(bot);
  }
  // ミューテーター「スポーンアイテム数1.5倍」(非公開中は常に1)
  const mutSpawnMultSolo = (typeof mutatorSpawnMult==='function') ? mutatorSpawnMult() : 1;
  spawnLoot(Math.round(420 * mutSpawnMultSolo), ZONE_CENTER0, ZONE_PHASES[0].holdRadius*0.95);
  spawnOasisBonusLoot();
  updateCamera();

  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('resultScreen').classList.add('hidden');
  if(typeof applyHudLayout==='function') applyHudLayout(); // カスタマイズしたHUD配置を反映
  game.started=true;
  beginSummonIntro();   // 5秒の召喚演出 → 演出後に本戦開始(バトル開始SE/BGM)
}
/* =====================================================================
   射撃訓練場
   ・狭いリアルマップで、バトルと同じ操作のまま技を撃ち込んで練習する場所。
   ・安置は動かさず(update()がupdateTrainingRangeを呼ぶ)、的は倒しても復活する。
   ・アイテムは一列に並んでいて何度でも拾える(combat.jsのrangeRespawn)。
   ・通常の試合と同じ初期化を通すので、追加の分岐は game.trainingRange 1つだけ。
   ===================================================================== */
const RANGE_WORLD_SCALE  = 0.18;              // 訓練場の広さ(通常マップに対する比)
const RANGE_TARGET_DISTS = [260, 460, 700, 980, 1240]; // 的を置く距離(弾の落ち方を距離ごとに試せる)
const RANGE_TARGET_HP    = 320;               // 的の耐久
const RANGE_TARGET_SPAN  = [140, 200, 260, 320, 380];  // 的が左右に往復する幅(遠いほど大きい)
function rangeSpawnTargets(cx, cy){
  const names = ['的 近','的 中','的 遠','的 超遠','的 最遠'];
  RANGE_TARGET_DISTS.forEach((d, i)=>{
    const hx = clamp(cx + d, 120, WORLD.w-120);
    const hy = clamp(cy, 120, WORLD.h-120);
    const span = RANGE_TARGET_SPAN[i];
    const t = createMonster('rock', false, names[i], { spawnPoint:{ x:hx, y:hy } });
    t.isTargetBot = true;
    t.homeX = hx; t.homeY = hy;
    // 進行方向(+x)に対して左右=y方向へ往復させる
    t.rangePoints = [
      { x:hx, y: clamp(hy-span, 80, WORLD.h-80) },
      { x:hx, y: clamp(hy+span, 80, WORLD.h-80) },
    ];
    t.rangeEndIdx = 0;
    t.maxHp = RANGE_TARGET_HP; t.hp = RANGE_TARGET_HP;
    t.speed = t.speed * (0.6 + i*0.12); // 遠い的ほど速く動く
    entities.push(t);
  });
}
// バトルで出てくるアイテムを1種類ずつ横一列に並べる(拾っても少し待てば同じ場所に出る)
function rangeSpawnLootRow(cx, cy){
  const list = [
    { kind:'heal', type:'oilS' }, { kind:'heal', type:'oilM' }, { kind:'heal', type:'oilL' },
    { kind:'guts', type:'guts' }, { kind:'ticket', type:'ticket' },
    ...TRAINING_TYPES.map(t=>({ kind:'training', type:t })),
  ];
  const gap = 62, x = cx - 120;
  const y0 = cy - ((list.length-1)/2)*gap;
  list.forEach((it, i)=>{
    const y = clamp(y0 + i*gap, 80, WORLD.h-80);
    lootItems.push({ id:nextId++, kind:it.kind, type:it.type, x, y, z: baseTerrainHeightAt(x,y), bob: rand(0,Math.PI*2), rangeRespawn:true, respawnAt:0 });
  });
}
function rangePlayerName(){
  if(game.selectedMastermonKey){
    const mm = loadMastermons()[game.selectedMastermonKey];
    if(mm) return mm.name;
  }
  return 'プレイヤー';
}
function startShootingRange(){
  entities=[]; projectiles=[]; lootItems=[]; particles=[]; areaEffects=[]; pendingAoeCasts=[]; nextId=1;
  matchTime=0; game.over=false; game.tipTimer=0; lastGutsWarnAt=-Infinity;
  hostSpectating=false; spectateTargetId=null;   // 前の試合の観戦状態を持ち越さない
  netState.mode='solo';           // 訓練場は常にローカル(マルチの後でも確実にソロ扱いにする)
  introState.active=false;        // 召喚演出は挟まない
  camState.yaw = 0;
  camSnap.active = false;
  monsterScreenPos.clear();
  Object.keys(keys).forEach(k=>keys[k]=false);
  fireBtnHeld=false; joystick.active=false; joystick.nx=0; joystick.ny=0;
  if(typeof setAutoRun==='function') setAutoRun(false);
  joyKnobEl.style.transform='translate(0,0)';

  raidResetState();             // レイドの状態を持ち越さない
  game.trainingRange = true;
  game.activeMapKey = 'wild'+REAL_MAP_SUFFIX;      // 訓練場は荒野のリアル版で固定
  currentMap = MAPS[game.activeMapKey] || MAPS.wild;
  applyStartPitchForMap();
  applyReal3DLayer();
  applyWorldScale(RANGE_WORLD_SCALE);
  initZone();
  // 安置は縮小させないうえ、ワールド全体を圏内にする(圏外のアイテムは消えてしまうため)
  zoneState.radius = WORLD.w*2;
  zoneState.fromRadius = zoneState.toRadius = zoneState.radius;
  zoneState.shrinking = false; zoneState.hasNext = false;
  genVolcanoAndLava(); genWater(); genOasisZones(); genRocks(); genCrystals(); genTerrain();

  const cx = WORLD.w/2, cy = WORLD.h/2;
  // 的を並べる射線上の岩は取り除く(弾が岩に吸われて練習にならないため)
  rocks = rocks.filter(r=> !(r.x > cx-260 && r.x < cx+RANGE_TARGET_DISTS[RANGE_TARGET_DISTS.length-1]+220 && Math.abs(r.y-cy) < 480));
  player = createMonster(game.selectedElement, true, rangePlayerName(), { spawnPoint:{x:cx, y:cy} });
  applyMastermonToPlayer();
  player.moveTierUnlocked = 3;    // 訓練場では技をすべて解放しておく
  player.moveTierSelected = 1;
  entities.push(player);
  rangeSpawnTargets(cx, cy);
  rangeSpawnLootRow(cx, cy);
  updateCamera();

  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('resultScreen').classList.add('hidden');
  document.getElementById('hud').classList.add('range-mode');
  document.getElementById('rangeBar').classList.remove('hidden');
  document.getElementById('rangeHint').classList.remove('hidden');
  if(typeof applyHudLayout==='function') applyHudLayout();
  game.started = true;
  if(typeof ensureBgmTrainingBuffer==='function') ensureBgmTrainingBuffer();
  bgmSetTrack('training');
  pushToast('🎯 射撃訓練場：技は全解放・的は復活します');
}
/* =====================================================================
   週替わりレイドバトル(ソロ / 最大4人)

   ・試合の初期化は射撃訓練場と同じ骨組みを流用し、分岐は game.raid の1つに寄せてある
   ・与えたダメージは端末に貯め、Firebase の raids/{weekId} へ全プレイヤーぶんを累計する
   ・累計の到達で全員報酬、自分の累計で個人報酬
   ===================================================================== */
let raidRunDemo = false;      // 管理者画面からのデモプレイ(記録・報酬を残さない)
let raidTotalCache = { total:0, at:0 };

// 参戦するモンスター(選択中のマスモンがあればそれ)。ロビーと同じ判定を使う
function raidStart(multi, demo){
  raidRunDemo = !!demo;
  entities=[]; projectiles=[]; lootItems=[]; particles=[]; areaEffects=[]; pendingAoeCasts=[]; nextId=1;
  matchTime=0; game.over=false; game.tipTimer=0; lastGutsWarnAt=-Infinity;
  hostSpectating=false; spectateTargetId=null;   // 前の試合の観戦状態を持ち越さない
  /* 1人で挑むレイドは部屋を使わないので netState はソロ扱いにする。
     **レイドかどうかは game.raid が正**(この関数の下で true にする)。
     lobbyMode は 'raid' のままなので、終わってロビーへ戻れば選択はレイドに残る。 */
  netState.mode='solo';
  netState.raid = false;
  introState.active=false;
  camState.yaw = 0; camSnap.active = false;
  monsterScreenPos.clear();
  Object.keys(keys).forEach(k=>keys[k]=false);
  fireBtnHeld=false; joystick.active=false; joystick.nx=0; joystick.ny=0;
  if(typeof setAutoRun==='function') setAutoRun(false);
  joyKnobEl.style.transform='translate(0,0)';

  raidResetState();          // いったん初期化してから立て直す
  game.trainingRange = false;
  game.raid = true;
  game.activeMapKey = 'raid';
  currentMap = MAPS.raid;
  applyStartPitchForMap();
  applyReal3DLayer();
  applyWorldScale(RAID_WORLD_SCALE);
  initRaidZone();
  genVolcanoAndLava(); genWater(); genOasisZones(); genRocks(); genCrystals(); genTerrain();

  const cx = WORLD.w/2, cy = WORLD.h/2;
  // ボスは火口の手前、挑戦者はさらに手前に並ぶ
  const bossY = Math.max(WORLD.h*RAID_BOSS_YR, raidBossMinY());
  // ボスが動き回る範囲の岩は取り除く。巨体なので岩に引っかかると身動きが取れなくなり、
  // 弾も岩に吸われて当たらなくなる
  const bossClear = RAID_BOSS.radius + RAID_BOSS.repositionDist + 160;
  rocks = rocks.filter(r=> Math.hypot(r.x-cx, r.y-bossY) > bossClear);
  // 従来のマップと同じアイテムを、火山と反対側(手前)の安置内に撒く。
  // ボスから離れた場所にあるので、拾いに行くか殴り続けるかの駆け引きになる。
  spawnLoot(RAID_LOOT_COUNT, { x:cx, y:WORLD.h*RAID_LOOT_YR }, Math.min(WORLD.w, WORLD.h)*RAID_LOOT_SPREAD);

  player = createMonster(game.selectedElement, true, getDisplayNameFromInput()||'あなた', { spawnPoint:{x:cx, y:cy+WORLD.h*0.18} });
  applyMastermonToPlayer();
  player.moveTierUnlocked = 3;      // レイドは最初から全技を使える(ボスに火力を出すため)
  player.moveTierSelected = 1;
  player.raidDamage = 0;
  entities.push(player);

  // 残りの枠はマスモン・botで埋める(ソロでもにぎやかに、みんなでボスを削る絵にする)
  const allies = Math.max(0, RAID_CAPACITY - 1);
  const mmData = loadMastermons();
  const mmKeysAll = Object.keys(mmData).filter(k=>k!==game.selectedMastermonKey);
  const elems = shuffle(Object.keys(ELEMENTS));
  for(let i=0;i<allies;i++){
    const a = (i/allies)*Math.PI*2;
    const sp = { x: cx+Math.cos(a)*WORLD.w*0.12, y: cy+WORLD.h*0.16+Math.sin(a)*WORLD.h*0.06 };
    const mmKey = mmKeysAll[i];
    const el = mmKey || elems[i % elems.length];
    const ally = createMonster(el, false, mmKey ? mmData[mmKey].name : BOT_NAMES[i % BOT_NAMES.length], { spawnPoint: sp });
    if(mmKey){ applyMastermonStatsToEntity(ally, mmData[mmKey]); ally.isMastermonBot = true; ally.mastermonLevel = mmData[mmKey].level||1; }
    ally.moveTierUnlocked = 3;
    entities.push(ally);
  }

  // ボス本体。素体はドラゴンで、見た目(スキン)・半径・HP・速さだけレイド用に差し替える
  const boss = createMonster(RAID_BOSS.element, false, RAID_BOSS.name, { spawnPoint:{x:cx, y:bossY} });
  boss.isRaidBoss = true;
  boss.skinId = RAID_BOSS.skinId;   // 「不死のゾッド」。歩行コマもこのスキンのものが使われる
  boss.radius = RAID_BOSS.radius;
  boss.speed = RAID_BOSS.speed;
  boss.maxHp = raidBossMaxHp(RAID_CAPACITY);
  boss.hp = boss.maxHp;
  boss.guts = 0; boss.maxGuts = 0;
  boss.raidHomeX = cx; boss.raidHomeY = bossY;
  boss.facingAngle = Math.PI/2;
  entities.push(boss);

  raidState = { bossId: boss.id, nextAttackAt: 3.0, pending:null, marks:[],
                repositionAt: RAID_BOSS.repositionEvery, endsAt: RAID_TIME_LIMIT,
                nextLootAt: RAID_LOOT_REFILL_EVERY };
  updateCamera();

  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('resultScreen').classList.add('hidden');
  document.getElementById('raidOverlay').classList.add('hidden');
  document.getElementById('raidHud').classList.remove('hidden');
  // レイドでは順位・安全圏の案内など、バトルロイヤル専用のHUDを隠す(重なって読めなくなる)
  document.getElementById('hud').classList.add('raid-mode');
  if(typeof applyHudLayout==='function') applyHudLayout();
  game.started = true;
  // レイドは召喚演出を挟まないので、通常の試合(endSummonIntro)の代わりにここで戦闘BGMを鳴らす。
  // 盛り上がりは常に「残り2人」相当(bgmUpdateBattleIntensityがレイドを固定する)。
  bgmSetTrack('battle');
  bgmUpdateBattleIntensity(2);
  pushToast(demo ? '🐉 デモプレイ:記録は残りません' : '🐉 レイド開始！ 竜に総力戦を挑め');
}

// レイドHUDの更新(毎フレーム。render側のHUD更新から呼ぶ)
function updateRaidHud(){
  const hud = document.getElementById('raidHud');
  if(!hud) return;
  if(!game.raid){ hud.classList.add('hidden'); return; }
  hud.classList.remove('hidden');
  const b = (typeof raidBossEntity==='function') ? raidBossEntity() : null;
  const pct = b ? Math.max(0, b.hp/b.maxHp) : 0;
  document.getElementById('raidBossName').textContent = '🐉 '+RAID_BOSS.name;
  document.getElementById('raidBossFill').style.width = (pct*100).toFixed(1)+'%';
  document.getElementById('raidBossHpText').textContent = b ? `${Math.max(0,Math.round(b.hp)).toLocaleString()} / ${b.maxHp.toLocaleString()}` : '討伐！';
  document.getElementById('raidTimeLeft').textContent = fmtTime(Math.max(0, RAID_TIME_LIMIT - matchTime));
  document.getElementById('raidMyDmg').textContent = '与ダメ '+Math.round(player&&player.raidDamage||0).toLocaleString();
  const rage = Math.round(raidEscalation(matchTime)*100);
  const rageEl = document.getElementById('raidRage');
  rageEl.textContent = '怒り '+rage+'%';
  rageEl.classList.toggle('is-max', rage>=100);
}

// 決着。与ダメを記録して結果画面へ
function finishRaid(defeated){
  if(game.over) return;
  const dmg = Math.round((player && player.raidDamage) || 0);
  // 自己ベストの判定に使うので、記録を更新する前の値を控えておく
  const prevBest = Math.round(loadRaidProgress().best || 0);
  // デモプレイ中と準備中は、記録も報酬も一切残さない(公開時に全員が同じ位置から始められるように)
  if(!raidRunDemo && !raidRecordsDisabled()) raidRecordRun(dmg);
  raidShowResult(defeated, dmg, prevBest);
}
// 与ダメを端末とサーバーの累計へ反映する
function raidRecordRun(dmg){
  const r = loadRaidProgress();
  r.dmg += dmg; r.runs += 1; r.best = Math.max(r.best||0, dmg);
  saveRaidProgress(r);
  // サーバー側の全体累計と個人ランキングへ(失敗しても端末側の記録は残る)
  if(window.__aramonAddRaidDamage){
    window.__aramonAddRaidDamage(raidWeekId(), dmg, (typeof accountState!=='undefined' && accountState.name) || getDisplayNameFromInput() || 'ゲスト')
      .catch(()=>{});
  }
}
async function raidExit(){
  game.started = false; game.over = false;
  raidResetState();
  raidRunDemo = false;
  joinInProgress = false;
  // みんなで挑んだ場合は部屋から抜けて、次に普通のマルチへ行っても混ざらないようにする
  if(netState.mode==='multi' && netState.roomId){
    try{ await window.__aramonLeaveRoom(netState.roomId); }catch(err){}
    netState.roomId=null; netState.isHost=false; netState.humanPlayers={}; netState.hostId=null;
    netState.matchStarting=false; matchBeginning=false;
  }
  /* ロビーへ戻るときは、ロビーの選択から netState を作り直す。
     以前はここで solo に固定していたが、タブの表示は「レイド」のままだったので
     戻ったあとの表示と実際のモードが食い違っていた。 */
  syncNetStateToLobbyMode();
  if(typeof setAutoRun==='function') setAutoRun(false);
  if(window.__aramonReal3D) window.__aramonReal3D.setActive(false);
  document.getElementById('raidHud').classList.add('hidden');
  document.getElementById('resultScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
  bgmSetTrack('title');
  if(typeof renderSelectorCards==='function') renderSelectorCards();
  if(typeof updateRaidEntryButton==='function') updateRaidEntryButton();
}

/* --- レイド入口画面 --- */
// ロビーの入口ボタンは開催中だけ出す
function raidMyAccountName(){
  return (typeof accountState!=='undefined' && accountState.loggedIn) ? accountState.name : null;
}
// レイドが今どういう状態かを1か所で判定する(文言をここから作る)
function raidPhase(){
  if(!RAID_ACTIVE) return 'off';
  if(raidRecordsDisabled()) return 'preview';       // 準備中(RAID_PREVIEW)
  if(Date.now() < raidStartAt().getTime()) return 'before';
  return raidOpenNow() ? 'open' : 'ended';
}
function raidStartDateLabel(){
  const d = raidStartAt();
  return `${d.getMonth()+1}/${d.getDate()}`;
}
function updateRaidEntryButton(){
  const btn = document.getElementById('openRaidBtn');
  if(!btn) return;
  // 開催中だけ出す(準備中は開発アカウントだけ)
  btn.classList.toggle('hidden', !raidPlayable(raidMyAccountName()));
  // 未受け取りの報酬があるときだけ通知の点を出す(準備中は記録が残らないので出さない)
  const dot = document.getElementById('raidDot');
  if(dot) dot.classList.toggle('hidden', raidRecordsDisabled() || !raidHasClaimable());
  // ガチャボタンの「レイドガチャ開催中」ポップは開催期間中だけ出す
  const gachaPop = document.getElementById('raidGachaPop');
  if(gachaPop) gachaPop.classList.toggle('hidden', !raidOpenNow());
  // プレイモード側の案内も合わせて更新する
  if(typeof updateRaidModePanel==='function') updateRaidModePanel();
}
// プレイモードのレイド欄。今の状態に応じた案内と、入れるかどうかをここで出し分ける
function updateRaidModePanel(){
  const note = document.getElementById('raidModeNote');
  const btn = document.getElementById('raidModeOpenBtn');
  const pop = document.getElementById('raidModePop');
  if(!note || !btn) return;
  const ok = raidPlayable(raidMyAccountName());
  const phase = raidPhase();
  if(pop) pop.classList.toggle('hidden', phase!=='preview');
  note.textContent =
    phase==='preview' ? (ok ? '準備中のため、バトルが終わっても記録・報酬は残りません。'
                            : '準備中です。もうしばらくお待ちください。') :
    phase==='open'    ? '開催中です。挑んだぶんだけ全プレイヤーの累計に加算されます。' :
    phase==='before'  ? `${raidStartDateLabel()}開幕。全プレイヤーで累計ダメージを稼いで巨竜を討伐しよう。` :
                        '今回の開催は終了しました。次回をお待ちください。';
  btn.disabled = !ok;
  btn.textContent =
    ok                ? '🐉 レイドバトルへ' :
    phase==='preview' ? '🐉 準備中' :
    phase==='before'  ? `🐉 ${raidStartDateLabel()}開幕` :
                        '🐉 開催前';
}
document.getElementById('raidModeOpenBtn').addEventListener('click', ()=>{
  if(!raidGuardReady()) return;
  document.getElementById('modePickOverlay').classList.add('hidden');
  openRaidOverlay();
});
/* レイドへ進む前の共通チェック。モンスター未選択・開催期間外はここで止めて、
   必ずメッセージを出してロビーへ戻す(押しても何も起きない状態を作らない)。 */
function raidGuardReady(){
  if(!raidPlayable(raidMyAccountName())){
    const phase = raidPhase();
    raidBackToLobby(
      phase==='preview' ? 'レイドバトルは準備中です' :
      phase==='before'  ? `レイドバトルは${raidStartDateLabel()}開幕です` :
                          'レイドバトルは現在開催していません');
    return false;
  }
  if(!game.selectedElement){ raidBackToLobby('先にモンスターを選んでください'); return false; }
  return true;
}
function raidBackToLobby(msg){
  document.getElementById('raidOverlay').classList.add('hidden');
  document.getElementById('modePickOverlay').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
  pushToast(msg);
}
function raidHasClaimable(){
  if(!raidOpenNow()) return false;
  const r = loadRaidProgress();
  const total = raidTotalCache.total;
  for(let i=0;i<RAID_TOTAL_TIERS.length;i++) if(total>=RAID_TOTAL_TIERS[i].at && !r.claimedTotal[i]) return true;
  for(let i=0;i<RAID_PERSONAL_TIERS.length;i++) if(r.dmg>=RAID_PERSONAL_TIERS[i].at && !r.claimedPersonal[i]) return true;
  return false;
}
// 入口画面に出すボスの姿。スキン(不死のゾッド)の画像を使う
function raidBossImgTag(){
  const url = (typeof skinnedIconDataUrl==='function') ? skinnedIconDataUrl(RAID_BOSS.skinId) : null;
  if(url) return `<img src="${url}" alt="${RAID_BOSS.name}">`;
  return defaultMonsterImgTag(RAID_BOSS.element, RAID_BOSS.name);
}
/* 報酬の並び。html=true は報酬行(innerHTML)用でSVGアイコンをそのまま出す。
   html=false はトースト(textContent)用で、SVGアイコンは名前だけにする。 */
function raidRewardLabel(t, html){
  const parts = [];
  if(t.gold) parts.push(`🪙${t.gold.toLocaleString()}`);
  if(t.dia) parts.push(`💎${t.dia}`);
  for(const x of rewardItemList(t)){
    const it = PLAYER_ITEMS[x.key];
    const icon = (html || !playerItemIconIsSvg(x.key)) ? it.icon : '';
    parts.push(`${icon}${it.name}×${x.n}`);
  }
  if(t.skin) parts.push(`✨${skinMeta(t.skin).name}`);
  return parts.join(' / ');
}
function raidTierRowsHtml(tiers, reached, claimed, kind){
  return tiers.map((t,i)=>{
    const ok = reached >= t.at;
    const got = !!claimed[i];
    const btn = ok && !got
      ? `<button class="raid-claim-btn" data-kind="${kind}" data-idx="${i}">受け取る</button>`
      : `<span class="raid-claim-state">${got?'受取済':'未達成'}</span>`;
    return `<div class="raid-tier-row${ok?' is-reached':''}${got?' is-got':''}">
      <span class="raid-tier-at">${t.at.toLocaleString()}</span>
      <span class="raid-tier-reward">${raidRewardLabel(t, true)}</span>
      ${btn}
    </div>`;
  }).join('');
}
/* 最終段のあとも走り続けられることの説明。しきい値と報酬は RAID_REPEAT_* から作るので、
   数字を変えてもここは直さなくてよい(文言とデータを二重に持たない)。 */
function raidRepeatSectionHtml(r){
  const row = (label, rep, tiers, got)=>`
    <div class="raid-repeat-row">
      <span class="raid-repeat-cond">${label} ${rep.step.toLocaleString()} ごと</span>
      <span class="raid-tier-reward">${raidRewardLabel(rep, true)}</span>
      <span class="raid-claim-state">受取${got}回 / 次 ${raidRepeatNextAt(tiers, rep, got).toLocaleString()}</span>
    </div>`;
  return `<div class="raid-sec raid-sec-repeat">
    <div class="raid-sec-title">🔥 倒してもレイドバトルは続く！<span class="raid-sec-note">刻んだぶんだけ報酬が増え続ける</span></div>
    <div class="raid-repeat-list">
      ${row('あなたの累計', RAID_REPEAT_PERSONAL, RAID_PERSONAL_TIERS, r.repeatPersonal||0)}
      ${row('みんなの累計', RAID_REPEAT_TOTAL, RAID_TOTAL_TIERS, r.repeatTotal||0)}
    </div>
    <div class="raid-bonus-note">条件を満たすと<b>次にこの画面を開いた時点で自動で受け取れます</b>(受け取りボタンは要りません)。</div>
  </div>`;
}
// レイド限定の基礎値アイテムの説明。効果の文言は playerItemDesc に寄せて二重管理を避ける
const RAID_BASE_ITEM_KEYS = ['fruit_life', 'accel_elixir'];
function raidBaseItemLinesHtml(){
  return RAID_BASE_ITEM_KEYS.filter(k=>PLAYER_ITEMS[k]).map(k=>{
    const it = PLAYER_ITEMS[k];
    return `<div class="raid-item-line">
      <span class="raid-item-icon">${it.icon}</span>
      <span class="raid-item-body"><b>${it.name}</b><span>${playerItemDesc(k)}</span></span>
    </div>`;
  }).join('');
}
function renderRaidOverlay(){
  const box = document.getElementById('raidScroll');
  if(!box) return;
  const r = loadRaidProgress();
  const total = raidTotalCache.total;
  const last = RAID_TOTAL_TIERS[RAID_TOTAL_TIERS.length-1].at;
  const pct = Math.min(100, total/last*100);
  const left = raidSecondsLeft();
  const days = Math.floor(left/86400), hours = Math.floor((left%86400)/3600);
  document.getElementById('raidTitleSub').textContent = raidOpenNow()
    ? `残り ${days}日${hours}時間 ／ ${RAID_BOSS.name}` : '開催前';
  const skinBonus = RAID_EFFECT_SKINS[RAID_GACHA_PICKUP];
  const preview = raidRecordsDisabled();
  box.innerHTML = `
    <div class="raid-head-cols">
      <div class="raid-key"><img src="images/raid_key.jpg" alt="${RAID_BOSS.name}"></div>
      <div class="raid-head-text">
        <div class="raid-lead">
          不死身の巨竜<b>ゾッド</b>が火口に降り立った。ひとりでは到底届かない相手だ。
          最大4人で挑み、<b>与えたダメージは全プレイヤーぶんが累計</b>される。倒しきれなくても、
          刻んだダメージはすべて残る。
        </div>
        <div class="raid-rules">
          <span>⏱ 制限時間 ${RAID_TIME_LIMIT}秒</span><span>👥 最大${RAID_CAPACITY}人</span>
          <span>⚔ 技は最初から全解放</span><span>🛡 味方の攻撃は当たらない</span>
          <span>⚠ 技の前に必ず予告が出る</span><span>🔥 時間が経つほど激しくなる</span>
        </div>
      </div>
    </div>
    ${preview ? '<div class="raid-preview-note">🚧 準備中: バトルが終わっても記録・報酬は残りません</div>' : ''}
    <div class="raid-sec">
      <div class="raid-sec-title">ボスの残り体力<span class="raid-sec-note">${Math.max(0, last-Math.round(total)).toLocaleString()} / ${last.toLocaleString()}</span></div>
      <div class="raid-gauge raid-gauge-boss"><div class="raid-gauge-fill" style="width:${Math.max(0,100-pct).toFixed(1)}%"></div></div>
      <div class="raid-my-dmg">あなたが与えた累計ダメージ <b>${Math.round(r.dmg).toLocaleString()}</b>
        <span class="raid-my-sub">（挑戦${r.runs}回 / 自己ベスト ${Math.round(r.best).toLocaleString()}）</span></div>
      <button id="raidRankOpenBtn" class="raid-rank-open-btn">🏆 レイドランキングを見る</button>
    </div>
    <div class="raid-cols">
      <div class="raid-sec">
        <div class="raid-sec-title">みんなの累計で全員がもらえる報酬</div>
        <div class="raid-tier-list">${raidTierRowsHtml(RAID_TOTAL_TIERS, total, r.claimedTotal, 'total')}</div>
      </div>
      <div class="raid-sec">
        <div class="raid-sec-title">あなたの累計でもらえる報酬</div>
        <div class="raid-tier-list">${raidTierRowsHtml(RAID_PERSONAL_TIERS, r.dmg, r.claimedPersonal, 'personal')}</div>
      </div>
    </div>
    ${preview ? '' : raidRepeatSectionHtml(r)}
    <div class="raid-cols">
      ${skinBonus ? `<div class="raid-sec raid-sec-bonus">
        <div class="raid-sec-title">✦ レイド特効スキン</div>
        <div class="raid-bonus-text">「${skinBonus.name}」を装備してレイドに挑むと、
        ボスへの<b>与ダメージ×${skinBonus.dmgDealt}</b>・ボスからの<b>被ダメージ×${skinBonus.dmgTaken}</b>。レイドガチャで手に入ります。</div>
      </div>` : ''}
      <div class="raid-sec raid-sec-bonus">
        <div class="raid-sec-title">✦ レイドでしか手に入らないアイテム</div>
        ${raidBaseItemLinesHtml()}
        <div class="raid-bonus-note">基礎値は上限が無く、育成の倍率が乗る前に足されます。育てたマスモンほど1個の効きが大きくなります。</div>
      </div>
    </div>`;
  const rankBtn = document.getElementById('raidRankOpenBtn');
  if(rankBtn) rankBtn.addEventListener('click', openRaidRanking);
  box.querySelectorAll('.raid-claim-btn').forEach(b=>{
    b.addEventListener('click', ()=> raidClaim(b.dataset.kind, Number(b.dataset.idx)));
  });
  attachVisibleScrollbar(box, document.getElementById('raidScrollbar'));
}
/* 繰り返し報酬の未付与ぶんをまとめて渡す。**レイド画面を開くたびに呼ぶ。**
   受け取りボタンを出さない自動付与にしてあるので、実装前に既に走り込んでいた人にも
   開いた時点で差分が必ず届く。付与済み回数を保存しているので何度呼んでも二重に渡らない。 */
function raidGrantRepeatRewards(){
  if(raidRecordsDisabled()) return;   // 準備中は記録も報酬も残さない
  const r = loadRaidProgress();
  const granted = [];
  const run = (key, reached, tiers, rep, label)=>{
    const earned = raidRepeatCount(reached, tiers, rep);
    const got = r[key] || 0;
    if(earned <= got) return;
    const times = earned - got;
    r[key] = earned;
    // まとめて渡すので、回数ぶん掛けた1件の報酬にする(付与処理はシーズンパスと同じ)
    const reward = { gold:rep.gold*times, dia:rep.dia*times, item:rep.item, n:rep.n*times };
    grantReward(reward);
    granted.push(`${label}${times>1?`×${times}`:''} ${raidRewardLabel(reward)}`);
  };
  run('repeatPersonal', r.dmg, RAID_PERSONAL_TIERS, RAID_REPEAT_PERSONAL, '個人の繰り返し報酬');
  run('repeatTotal', raidTotalCache.total, RAID_TOTAL_TIERS, RAID_REPEAT_TOTAL, '全体の繰り返し報酬');
  if(!granted.length) return;
  saveRaidProgress(r);
  playSe('buy');
  pushToast('🐉 ' + granted.join(' ／ '));
  updateAccountBar();
}
function raidClaim(kind, idx){
  const r = loadRaidProgress();
  const tiers = kind==='total' ? RAID_TOTAL_TIERS : RAID_PERSONAL_TIERS;
  const claimed = kind==='total' ? r.claimedTotal : r.claimedPersonal;
  const reached = kind==='total' ? raidTotalCache.total : r.dmg;
  const t = tiers[idx];
  if(!t || claimed[idx] || reached < t.at) return;
  claimed[idx] = true;
  saveRaidProgress(r);
  grantReward(t);                  // ゴールド/ダイヤ/アイテム/スキンの付与はシーズンパスと同じ処理を使う
  playSe('buy');
  pushToast('報酬を受け取りました: '+raidRewardLabel(t));
  renderRaidOverlay();
  updateRaidEntryButton();
}
/* --- レイドランキング(総ダメージ / 1回の最大ダメージ / 参加回数) ---
   並べ替えの基準と値の出し方はこの表1か所で決める(タブを足すならここへ1行)。 */
const RAID_RANK_KINDS = {
  dmg:  { field:'dmg',  label:'総ダメージ',  format: v=>Math.round(v).toLocaleString() },
  best: { field:'best', label:'最大ダメージ', format: v=>Math.round(v).toLocaleString() },
  runs: { field:'runs', label:'参加回数',    format: v=>`${v} 回` },
};
let raidRankTab = 'dmg';
let raidRankRows = null;   // 取得した生の行(表示のたびにタブの基準で並べ替える)
let raidRankError = null;
async function openRaidRanking(){
  document.getElementById('raidRankOverlay').classList.remove('hidden');
  // 開くたびに取り直す(前回の結果を出したままにしない)
  raidRankRows = null;
  raidRankError = null;
  renderRaidRanking();
  if(!window.__aramonFetchRaidRanking){
    raidRankError = '通信機能が利用できません';
    renderRaidRanking();
    return;
  }
  try{
    raidRankRows = await window.__aramonFetchRaidRanking(raidWeekId(), 50);
  }catch(err){
    // 握りつぶすと「読み込み中…」のまま止まって原因が分からなくなる
    console.warn('[aramon] raid ranking fetch failed', err);
    raidRankError = (err && err.message) ? String(err.message).slice(0,80) : '読み込みに失敗しました';
    raidRankRows = [];
  }
  renderRaidRanking();
}
function renderRaidRanking(){
  const box = document.getElementById('raidRankScroll');
  if(!box) return;
  const left = raidSecondsLeft();
  document.getElementById('raidRankSub').textContent =
    raidOpenNow() ? `今回の開催 残り ${Math.floor(left/86400)}日${Math.floor((left%86400)/3600)}時間` : '開催前';
  document.querySelectorAll('.raid-rank-tab').forEach(t=>t.classList.toggle('active', t.dataset.rk===raidRankTab));
  const kind = RAID_RANK_KINDS[raidRankTab] || RAID_RANK_KINDS.dmg;
  setRankShareTarget(true, null);   // 自分の行が見つかるまではシェアできない
  if(raidRankRows===null){ box.innerHTML = '<div class="rank-empty">読み込み中…</div>'; return; }
  // 記録が無い人(0)は載せない。同じ人が全タブに並ぶより、その基準で実績がある人だけ出す
  const rows = raidRankRows.filter(r=>(r[kind.field]||0) > 0)
                           .sort((a,b)=>(b[kind.field]||0) - (a[kind.field]||0));
  if(!rows.length){
    box.innerHTML = raidRankError
      ? `<div class="rank-empty">ランキングを読み込めませんでした<br><span class="rank-empty-detail">${rebirthEscape(raidRankError)}</span><br><button id="raidRankRetryBtn" class="raid-rank-retry">もう一度読み込む</button></div>`
      : '<div class="rank-empty">まだ記録がありません</div>';
    const retry = document.getElementById('raidRankRetryBtn');
    if(retry) retry.addEventListener('click', openRaidRanking);
    return;
  }
  const me = raidMyAccountName();
  let mine = null;
  box.innerHTML = `<div class="raid-rank-list">${rows.map((r,i)=>{
    const v = kind.format(r[kind.field]||0);
    const medal = i===0?'🥇':(i===1?'🥈':(i===2?'🥉':`${i+1}`));
    if(r.name===me && !mine) mine = { rank:i+1, val:v };   // シェア用に自分の行を控える
    return `<div class="raid-rank-row${r.name===me?' is-me':''}">
      <span class="raid-rank-no">${medal}</span>
      <span class="raid-rank-name">${rebirthEscape(r.name||'ゲスト')}</span>
      <span class="raid-rank-val">${v}</span>
    </div>`;
  }).join('')}</div>`;
  setRankShareTarget(true, mine && {
    rank: mine.rank,
    title: `レイドの${kind.label}ランキング`,
    valueLabel: kind.label, valueText: mine.val,
    element: game.selectedElement,
    skinId: (typeof getEquippedSkin==='function') ? getEquippedSkin(game.selectedElement) : null,
    monsterLabel: ELEMENTS[game.selectedElement] ? ELEMENTS[game.selectedElement].label : '',
    chips: ['レイドバトル'],
  });
  attachVisibleScrollbar(box, document.getElementById('raidRankScrollbar'));
}
document.querySelectorAll('.raid-rank-tab').forEach(t=>{
  t.addEventListener('click', ()=>{ raidRankTab = t.dataset.rk; renderRaidRanking(); });
});
document.getElementById('raidRankCloseBtn').addEventListener('click', ()=>{
  document.getElementById('raidRankOverlay').classList.add('hidden');
});

async function openRaidOverlay(){
  document.getElementById('raidOverlay').classList.remove('hidden');
  raidGrantRepeatRewards();   // 個人ぶんは端末の記録だけで判定できるので先に渡す
  renderRaidOverlay();
  // 全体の累計はサーバーから取り直す(取れなければ直前の値のまま表示する)
  if(window.__aramonFetchRaidTotal){
    try{
      const v = await window.__aramonFetchRaidTotal(raidWeekId());
      raidTotalCache = { total: v||0, at: Date.now() };
      raidGrantRepeatRewards();   // 全体ぶんは最新の累計が来てから(呼び直しても二重に渡らない)
      renderRaidOverlay();
      updateRaidEntryButton();
    }catch(err){}
  }
}
document.getElementById('openRaidBtn').addEventListener('click', ()=>{
  if(!raidGuardReady()) return;
  openRaidOverlay();
});
// 管理者画面のデモプレイ。開催前でも入れて、記録も報酬も残さない
document.getElementById('adminRaidDemoBtn').addEventListener('click', ()=>{
  if(!game.selectedElement){ pushToast('先にモンスターを選んでください'); return; }
  document.getElementById('adminScreen').classList.add('hidden');
  raidStart(false, true);
});
document.getElementById('raidCloseBtn').addEventListener('click', ()=> document.getElementById('raidOverlay').classList.add('hidden'));
/* レイド入口の3つのボタンは、押した時点で**ロビーの選択もレイドへ揃える**。
   こうしないとタブが「みんなと対戦」のままレイドが始まり、戻ってきたときに
   表示と実際のモードが食い違う(それが「つもりと違うモードで始まる」の原因だった)。 */
document.getElementById('raidSoloBtn').addEventListener('click', ()=>{
  if(!raidGuardReady()) return;
  setLobbyMode('raid');
  raidStart(false, false);
});
// みんなで挑む: 通常のマルチと同じ部屋の作成→ロビー→開始の流れに乗せる。
// 違いは定員が4人固定で、部屋のモードが 'raid' になることだけ。
document.getElementById('raidMultiBtn').addEventListener('click', ()=>{
  if(!raidGuardReady()) return;
  document.getElementById('raidOverlay').classList.add('hidden');
  netState.capacity = RAID_CAPACITY;
  setLobbyMode('raid');     // netState.mode/raid はここから導出される
  createRoomFlow();
});
// レイドの「部屋を探す」。通常マルチと同じ#roomListScreenを使うが、netState.raidを立てて
// おくことで__aramonListOpenRooms(netState.raid?'raid':'br')がレイドの部屋だけを検索する
// (部屋のmode('br'/'raid')で一覧が分かれているので、通常マルチの部屋は混ざらない)。
document.getElementById('raidFindRoomBtn').addEventListener('click', ()=>{
  if(!raidGuardReady()) return;
  document.getElementById('raidOverlay').classList.add('hidden');
  netState.capacity = RAID_CAPACITY;
  setLobbyMode('raid');     // netState.mode/raid はここから導出される
  openFindRoomScreen();
});

/* --- レイドのリザルト --- */
function raidShowResult(defeated, dmg, prevBest){
  game.over = true;
  game.started = false;
  joinInProgress = false;
  if(typeof setAutoRun==='function') setAutoRun(false);
  hostSpectating = false;   // 観戦を終える(バーも消す)
  { const sb = document.getElementById('spectateBar'); if(sb) sb.classList.add('hidden'); }
  const noRecord = raidRunDemo || raidRecordsDisabled();
  const d = Math.round(dmg);
  // 倒しきれなくても、自己ベストを更新できたなら勝利あつかいにする
  const newBest = RAID_BEST_IS_WIN && !noRecord && d > Math.round(prevBest||0);
  const isWin = !!defeated || newBest;
  const died = !!(player && !player.alive);   // 時間切れなのか、やられたのかを分ける

  bgmSetTrack(null);
  // 勝利SEはSSRスキンで差し替わる(通常の試合と同じ扱い)
  playSe(isWin ? ((typeof skinWinSeName==='function' && skinWinSeName(player)) || 'fanfare') : 'sad');
  setTimeout(()=>{
    if(game.started) return;
    if(typeof bgmDesiredTrack==='function' && bgmDesiredTrack()!==null) return;
    bgmSetTrack('title');
  }, isWin ? 3800 : 3000);

  const scr = document.getElementById('resultScreen');
  // winクラスがアイコンの飛び跳ねアニメーションと金色の見た目を出す
  scr.className = 'resultScreen ' + (isWin?'win':'lose');
  document.getElementById('resultRank').textContent =
    defeated ? '🐉 討伐成功' :
    newBest  ? '🔥 自己ベスト更新' :
    died     ? '💀 力尽きた' : '⏱ 時間切れ';
  let sub = `与えたダメージ ${d.toLocaleString()}`;
  if(newBest && prevBest>0) sub += `（これまでの最高 ${Math.round(prevBest).toLocaleString()}）`;
  if(noRecord) sub += '（記録は残りません）';
  document.getElementById('resultSub').textContent = sub;
  document.getElementById('statKills').textContent = player ? player.kills : 0;
  document.getElementById('statDamage').textContent = d.toLocaleString();
  document.getElementById('statTime').textContent = fmtTime(player && player.deathAt ? player.deathAt : matchTime);

  // 報酬。通常の試合と同じ「参加ぶん + 成果ぶん(+討伐ボーナス)」で、成果ぶんを与ダメから出す
  {
    const isMultiMatch = netState.mode==='multi';
    const mutRewardMult = (typeof mutatorRewardMult==='function') ? mutatorRewardMult() : 1;
    const goldFromDmg = Math.min(RAID_RUN_GOLD_MAX, Math.round(d*RAID_RUN_GOLD_PER_DMG));
    const diaFromDmg  = Math.min(RAID_RUN_DIA_MAX,  Math.round(d*RAID_RUN_DIA_PER_DMG));
    const goldGain = noRecord ? 0 : Math.round(
      (GOLD_MATCH_BASE + goldFromDmg + (defeated?GOLD_CHAMPION_BONUS:0)) * (isMultiMatch?GOLD_MULTI_MULT:1) * mutRewardMult);
    const diaGain = noRecord ? 0 : Math.round(
      (DIA_MATCH_BASE + diaFromDmg + (defeated?DIA_CHAMPION_BONUS:0)) * mutRewardMult);
    if(goldGain||diaGain) addWallet(goldGain, diaGain);
    document.getElementById('resultCurrencyLine').textContent = noRecord
      ? '記録は残りません' : `報酬　🪙 +${goldGain}　💎 +${diaGain}`;
    updateAccountBar();
  }
  /* マスモンの経験値とシーズンSPも通常の試合と同じ式で入れる。
     レイドの与ダメージは桁が違うので RAID_PROGRESS_DAMAGE_SCALE で釣り合わせた値を渡す
     (ゴールド/ダイヤはレイド専用の係数で上に別計算しているのでここでは使わない)。 */
  const progressDmg = Math.round(d * RAID_PROGRESS_DAMAGE_SCALE);
  let seasonSp = 0;
  if(!noRecord){
    if(typeof handleMastermonPostMatch==='function') handleMastermonPostMatch(isWin, { damage: progressDmg });
    if(typeof seasonOnMatchEnd==='function'){
      seasonSp = seasonOnMatchEnd({ kills: player ? player.kills : 0, damage: progressDmg, isWin: !!isWin });
    }
  } else {
    document.getElementById('mastermonResultInfo').classList.add('hidden');
    document.getElementById('mastermonRegisterPrompt').classList.add('hidden');
  }
  // レイドの自己ベストは上の見出しで出しているので、バッジはSPだけ出す
  renderResultBadges({ kills:0, damage:0, prevBestKills:0, prevBestDamage:0,
                       newTitles:[], elemNewTitles:[], seasonSp });
  document.getElementById('scoreSubmitStatus').textContent = '';
  setResultMonsterIcon(player ? player.element : game.selectedElement);
  setResultButtonsForRaid(true);
  scr.classList.remove('hidden');
  if(window.__aramonReal3D) window.__aramonReal3D.setActive(false);
  document.getElementById('raidHud').classList.add('hidden');
  if(!noRecord){
    logRaidMatchForAdmin(d, defeated ? 'defeated' : (newBest ? 'best' : (died ? 'died' : 'timeup')));
  }
  // シェア用の控え(通常の試合と同じ理由でここで作る)
  {
    const key = player ? player.element : game.selectedElement;
    _lastResultShare = buildRaidShare({
      defeated: !!defeated, newBest: !!newBest, died,
      element: key,
      skinId: (typeof getEquippedSkin==='function') ? getEquippedSkin(key) : null,
      dmg: d, kills: player ? player.kills : 0,
      timeText: fmtTime(player && player.deathAt ? player.deathAt : matchTime),
    });
  }
}

function exitShootingRange(){
  game.started = false;
  game.trainingRange = false;
  game.over = false;
  joinInProgress = false;
  // 訓練場は常にソロ扱いで netState を潰しているので、戻るときにロビーの選択へ戻す
  syncNetStateToLobbyMode();
  if(typeof setAutoRun==='function') setAutoRun(false);
  if(window.__aramonReal3D) window.__aramonReal3D.setActive(false);
  document.getElementById('rangeBar').classList.add('hidden');
  document.getElementById('rangeHint').classList.add('hidden');
  document.getElementById('hud').classList.remove('range-mode');
  document.getElementById('lookSettingsOverlay').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
  bgmSetTrack('title');
}
// 訓練場でモンスターを切り替える。その場の位置を保ったまま作り直す
function rangeApplyMonsterChange(){
  if(!game.trainingRange || !player) return;
  const idx = entities.indexOf(player);
  const keepX = player.x, keepY = player.y, keepFacing = player.facingAngle;
  // 飛んでいる自分の弾は持ち主が入れ替わると自分自身に当たりうるので、まとめて消す
  projectiles.length = 0; areaEffects.length = 0; pendingAoeCasts.length = 0;
  const np = createMonster(game.selectedElement, true, rangePlayerName(), { spawnPoint:{x:keepX, y:keepY} });
  np.facingAngle = keepFacing;
  if(idx>=0) entities[idx] = np; else entities.push(np);
  player = np;
  applyMastermonToPlayer();
  player.moveTierUnlocked = 3;
  player.moveTierSelected = 1;
  updateCamera();
}
let joinInProgress = false;
// モンスター(またはマスモン)が選択されていない状態では、ソロの「バトルに参加する」だけでなく
// マルチプレイの「部屋を作る」「部屋を探す」もクリックできないようにする
// (未選択のままマルチプレイに入れてしまう不具合の修正)
function updatePlayButtonsEnabled(){
  const enabled = !!game.selectedElement;
  document.getElementById('joinBtn').disabled = !enabled;
  document.getElementById('openRangeBtn').disabled = !enabled; // 射撃訓練場もモンスター選択が要る
  document.getElementById('createRoomBtn').disabled = !enabled;
  document.getElementById('findRoomBtn').disabled = !enabled;
  document.getElementById('pickMonsterNotice').classList.toggle('hidden', enabled);
}
document.getElementById('joinBtn').addEventListener('click', ()=>{
  if(joinInProgress) return;
  joinInProgress = true;
  document.getElementById('joinBtn').disabled = true;
  requestFullscreenSafe();
  requestOrientationLockSafe();
  startGame();
});
document.getElementById('openRangeBtn').addEventListener('click', ()=>{
  if(joinInProgress) return;
  if(!game.selectedElement){ pushToast('先にモンスターを選択してください'); return; }
  requestFullscreenSafe();
  requestOrientationLockSafe();
  startShootingRange();
});
// 訓練場の操作バー
document.getElementById('rangeExitBtn').addEventListener('click', exitShootingRange);
document.getElementById('rangeLookBtn').addEventListener('click', openLookSettings);
document.getElementById('rangeMonsterBtn').addEventListener('click', ()=>{
  // ロビーと同じ「マスモン / モンスター」の選択。閉じたときの戻り先は game.trainingRange で分岐する
  lobbyOpenOverlay('monsterPickOverlay');
});
document.getElementById('createRoomBtn').addEventListener('click', ()=>{
  if(joinInProgress) return;
  if(!game.selectedElement){ pushToast('先にモンスターを選択してください'); return; }
  joinInProgress = true;
  requestFullscreenSafe();
  requestOrientationLockSafe();
  createRoomFlow();
});
document.getElementById('findRoomBtn').addEventListener('click', ()=>{
  if(joinInProgress) return;
  if(!game.selectedElement){ pushToast('先にモンスターを選択してください'); return; }
  joinInProgress = true;
  requestFullscreenSafe();
  requestOrientationLockSafe();
  openFindRoomScreen();
});
document.getElementById('roomListRefreshBtn').addEventListener('click', ()=>{ refreshRoomList(); });
document.getElementById('roomListCancelBtn').addEventListener('click', ()=>{
  joinInProgress = false;
  document.getElementById('roomListScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
});

/* =====================================================================
   決着演出(リザルト画面の手前に挟む3秒のアニメーション)
   勝利=使用モンスターがこちらを向いて飛び跳ねる / 敗北=横に倒れる。

   showResult() は「演出を出してから本来のリザルトへ進む」だけの薄いラッパーにしてある。
   結果画面へ入る経路は5か所(自分の勝利・自分の敗退・ホスト観戦の終了・matchEnd受信)
   あるので、ここ1か所に寄せておけばどの経路でも必ず同じ演出が入る。
   ===================================================================== */
const MATCH_FINISH_ANIM_MS = 3000;
// 演出中は試合を止める。時刻で持つのは、万一 showResultNow まで進めなかった場合でも
// 3秒後に必ず自動で解除され、操作不能のまま固まらないようにするため(保険)。
let matchFinishFreezeUntil = 0;
function matchFinishFreezeActive(){ return performance.now() < matchFinishFreezeUntil; }
// 演出に出す「こちらを向いた姿」。装備スキン(SSR/色スキン)があればその見た目にする
function matchFinishMonsterImgTag(){
  const ent = (typeof player!=='undefined') ? player : null;
  const skinId = (ent && typeof entitySkinId==='function') ? entitySkinId(ent) : null;
  if(skinId && typeof skinnedIconDataUrl==='function'){
    const url = skinnedIconDataUrl(skinId);
    if(url) return `<img src="${url}" alt="">`;
  }
  const key = (ent && ent.element) || game.selectedElement;
  if(!key || !ELEMENTS[key]) return '';
  return equippedIconImgTag(key, ELEMENTS[key].label);
}
function showResult(isWin, placement){
  if(game.over || matchFinishFreezeActive()) return;   // 二重起動を防ぐ
  const ov = document.getElementById('matchFinishOverlay');
  const host = document.getElementById('matchFinishMonster');
  const label = document.getElementById('matchFinishText');
  if(!ov || !host || !label){ showResultNow(isWin, placement); return; }
  matchFinishFreezeUntil = performance.now() + MATCH_FINISH_ANIM_MS;
  if(typeof setAutoRun==='function') setAutoRun(false);
  const sb = document.getElementById('spectateBar'); if(sb) sb.classList.add('hidden');
  host.innerHTML = matchFinishMonsterImgTag();
  label.textContent = isWin ? 'WIN!' : 'DEFEAT';
  ov.className = isWin ? 'mf-win' : 'mf-lose';   // hiddenを外しつつ勝敗クラスを付ける
  // 前回のアニメーションが残っていると再生されないので、強制的に作り直す
  void ov.offsetWidth;
  setTimeout(()=>{
    ov.className = 'hidden';
    host.innerHTML = '';
    matchFinishFreezeUntil = 0;
    showResultNow(isWin, placement);
  }, MATCH_FINISH_ANIM_MS);
}
/* リザルトのモンスターアイコン。装備中スキンがあればそれを反映する。
   通常の試合とレイドで同じものを使う(レイドで出ない不具合があったため1か所にまとめた)。 */
function setResultMonsterIcon(elementKey){
  const iconEl = document.getElementById('resultMonsterIcon');
  if(!iconEl || !elementKey) return;
  const el = ELEMENTS[elementKey];
  iconEl.alt = el ? el.label : '';
  iconEl.style.display = '';
  const sk = (typeof getEquippedSkin==='function') ? getEquippedSkin(elementKey) : null;
  const skUrl = sk && (typeof skinnedIconDataUrl==='function') ? skinnedIconDataUrl(sk) : null;
  if(skUrl){
    iconEl.dataset.variant = 'skin';
    iconEl.src = skUrl;
  } else {
    iconEl.dataset.variant = 'normal';
    iconEl.dataset.extIdx = '0';
    iconEl.dataset.basePath = `monsters/${elementKey}`;
    iconEl.src = imgSrcFor(iconEl.dataset.basePath);
  }
}
/* リザルトのボタン列。レイドでは「ランキング/マイ記録」の代わりに
   「レイドランキング」を出す(通常の順位ランキングはレイドに存在しないため)。 */
function setResultButtonsForRaid(isRaid){
  const set = (id, hidden)=>{ const b=document.getElementById(id); if(b) b.classList.toggle('hidden', hidden); };
  set('viewRankingBtn', isRaid);
  set('viewMyStatsBtn', isRaid);
  set('viewRaidRankBtn', !isRaid);
}
function showResultNow(isWin, placement){
  if(game.over) return;
  game.over=true;
  game.started=false;
  joinInProgress = false;
  if(typeof setAutoRun==='function') setAutoRun(false); // 試合終了でオートラン解除
  if(window.__aramonReal3D) window.__aramonReal3D.setActive(false); // WebGL地形を止めてロビーへ戻す
  if(typeof updateSpectateBar==='function'){ const sb=document.getElementById('spectateBar'); if(sb) sb.classList.add('hidden'); }
  // リザルトSE(勝利=ファンファーレ/それ以外=悲しげ)を鳴らし、鳴り終わってから通常BGMへ
  bgmSetTrack(null);
  // 勝利SEはSSRスキンで差し替わる(轟金剛など)。敗北SEは共通
  playSe(isWin ? ((typeof skinWinSeName==='function' && skinWinSeName(player)) || 'fanfare') : 'sad');
  // リザルトSEが鳴り終わったらロビー曲へ。ただしこの3〜4秒の間にマスモン画面などで
  // 別のトラックが選ばれていたら上書きしない(トレーニングBGMが即座に消える不具合の防止)
  setTimeout(()=>{
    if(game.started) return;
    if(typeof bgmDesiredTrack==='function' && bgmDesiredTrack()!==null) return;
    bgmSetTrack('title');
  }, isWin ? 3800 : 3000);
  document.getElementById('resultScreen').className = 'resultScreen ' + (isWin?'win':'lose');
  document.getElementById('resultRank').textContent = isWin ? '👑 WINNER' : ('#'+placement);
  document.getElementById('resultSub').textContent = isWin ? '生き残った！今夜はモン勝ちだ！' : '撃破された';
  document.getElementById('statKills').textContent = player.kills;
  document.getElementById('statDamage').textContent = Math.round(player.damageDealt);
  document.getElementById('statTime').textContent = fmtTime(player.deathAt||matchTime);
  // ゴールド/ダイヤ報酬(経験値と一緒に入手。game.overガードにより1試合1回だけ)
  {
    const isMultiMatch = netState.mode==='multi';
    // リアルマップは上級者向けなので獲得報酬2倍
    const realMult = (currentMap && currentMap.real3d) ? REAL_MAP_REWARD_MULT : 1;
    // ミューテーター「報酬2倍」(非公開中は常に1)
    const mutRewardMult = (typeof mutatorRewardMult==='function') ? mutatorRewardMult() : 1;
    const goldGain = Math.round((GOLD_MATCH_BASE + player.kills*GOLD_PER_KILL + (isWin?GOLD_CHAMPION_BONUS:0)) * (isMultiMatch?GOLD_MULTI_MULT:1) * realMult * mutRewardMult);
    const diaGain = Math.round((DIA_MATCH_BASE + (isWin?DIA_CHAMPION_BONUS:0)) * realMult * mutRewardMult);
    addWallet(goldGain, diaGain);
    document.getElementById('resultCurrencyLine').textContent = `報酬　🪙 +${goldGain}　💎 +${diaGain}`;
    updateAccountBar();
  }
  setResultMonsterIcon(player.element);
  setResultButtonsForRaid(false);
  document.getElementById('resultScreen').classList.remove('hidden');
  // 自己ベスト更新の検出用に、記録前のベストを控えておく(全体＋このモンスター毎)
  const _preCum = titlesCumulativeStats();
  const _prevBestKills = _preCum.bestKills, _prevBestDamage = _preCum.bestDamage;
  const _dmg = Math.round(player.damageDealt);
  const _preElem = elementBestAcrossModes(player.element);
  const _elemNewTitles = elementNewTitleBadges(_preElem, player.kills, _dmg);
  recordMatchResult(player.element, player.kills, _dmg, !!isWin, netState.mode==='multi' ? 'multi' : 'solo');
  const _newTitles = (typeof checkTitleUnlocks==='function') ? checkTitleUnlocks() : [];
  if(typeof dailyOnMatchEnd==='function') dailyOnMatchEnd({ kills: player.kills, isWin: !!isWin });
  const _seasonSp = (typeof seasonOnMatchEnd==='function') ? seasonOnMatchEnd({ kills: player.kills, damage: _dmg, isWin: !!isWin }) : 0;
  renderResultBadges({
    kills: player.kills, damage: _dmg,
    prevBestKills: _prevBestKills, prevBestDamage: _prevBestDamage, newTitles: _newTitles, seasonSp: _seasonSp,
    elementLabel: (ELEMENTS[player.element] ? ELEMENTS[player.element].label : player.element),
    prevElemBestKills: _preElem.bestKills, prevElemBestDamage: _preElem.bestDamage, elemNewTitles: _elemNewTitles,
  });
  handleMastermonPostMatch(isWin);
  submitScoreToRanking(isWin, placement);
  logMatchForAdmin(isWin, placement);
  /* シェア用の控え。**ここで作らないと後から復元できない**
     (playerは次の試合開始で作り直され、報酬額もこの関数のローカル変数のため) */
  _lastResultShare = buildResultShare({
    isWin: !!isWin, placement,
    element: player.element,
    skinId: (typeof getEquippedSkin==='function') ? getEquippedSkin(player.element) : null,
    kills: player.kills, dmg: _dmg,
    timeText: fmtTime(player.deathAt||matchTime),
    mapLabel: shareMapLabel(),
    best: (player.kills>0 && player.kills>_prevBestKills) || (_dmg>0 && _dmg>_prevBestDamage),
  });
}
// リザルトの自己ベスト更新バッジ＆獲得称号バッジを描画する
function renderResultBadges(o){
  const el = document.getElementById('resultBadges');
  if(!el) return;
  const badges = [];
  let rainbow = false; // 自己ベスト更新 or 称号獲得(=虹色バッジ)が出たか
  if(o.seasonSp>0) badges.push(`<span class="result-badge season">🎫 シーズン +${o.seasonSp} SP</span>`);
  const globalKillsBest = o.kills>0 && o.kills > o.prevBestKills;
  const globalDamageBest = o.damage>0 && o.damage > o.prevBestDamage;
  if(globalKillsBest){ badges.push(`<span class="result-badge best">🏆 自己ベスト キル数 ${o.kills}!</span>`); rainbow = true; }
  if(globalDamageBest){ badges.push(`<span class="result-badge best">🏆 自己ベスト ダメージ ${o.damage}!</span>`); rainbow = true; }
  // モンスター毎の最高記録更新(全体ベストと重複しない場合のみ)
  const elemLabel = o.elementLabel || 'このモンスター';
  const monsterKillsBest = !globalKillsBest && o.kills>0 && o.kills > (o.prevElemBestKills||0);
  const monsterDamageBest = !globalDamageBest && o.damage>0 && o.damage > (o.prevElemBestDamage||0);
  if(monsterKillsBest){ badges.push(`<span class="result-badge best">🏆 ${elemLabel}の最高記録 キル数 ${o.kills}!</span>`); rainbow = true; }
  if(monsterDamageBest){ badges.push(`<span class="result-badge best">🏆 ${elemLabel}の最高記録 ダメージ ${o.damage}!</span>`); rainbow = true; }
  let titleGot = false;
  for(const t of (o.newTitles||[])){ badges.push(`<span class="result-badge title">🎖️ 称号獲得「${t.emoji} ${t.name}」</span>`); rainbow = true; titleGot = true; }
  // モンスター毎の新称号(全体の新称号に含まれないもの)
  const globalNewIds = new Set((o.newTitles||[]).map(t=>t.id));
  for(const t of (o.elemNewTitles||[])){
    if(globalNewIds.has(t.id)) continue;
    badges.push(`<span class="result-badge title">🎖️ ${elemLabel}で称号獲得「${t.emoji} ${t.name}」</span>`); rainbow = true; titleGot = true;
  }
  el.innerHTML = badges.join('');
  el.classList.toggle('hidden', badges.length===0);
  // リザルトSE:
  //  ・全体の自己ベスト更新 → 専用SE(提供動画音声)を1回だけ。重複時はこれを優先(SSR獲得SEは鳴らさない)
  //  ・称号獲得 / モンスター毎の最高記録更新 → 従来どおりSSR獲得SEを2回
  const globalBestUpdate = globalKillsBest || globalDamageBest;
  const otherCelebrate = monsterKillsBest || monsterDamageBest || titleGot;
  if(globalBestUpdate){
    if(typeof playBestUpdateOnce==='function') playBestUpdateOnce();
  } else if(otherCelebrate && typeof playSsrJackpotOnce==='function'){
    playSsrJackpotOnce();
    setTimeout(()=>{ if(typeof playSsrJackpotOnce==='function') playSsrJackpotOnce(); }, 700);
  }
}
/* 1試合ぶんの成績。通常戦とレイドで同じ形にしておく(集計側で分岐を増やさないため)。
   **記録は後から遡れない**ので、増やすならプレイ前に入れる。 */
function matchOutcomeFields(){
  return {
    sec: Math.round(player && player.deathAt ? player.deathAt : matchTime), // 1試合の長さ(秒)
    kills: player ? player.kills : 0,
    dmg: player ? Math.round(player.damageDealt) : 0,
    skin: (typeof currentEquippedSkinId==='function') ? (currentEquippedSkinId() || null) : null,
  };
}
/* =====================================================================
   Xへのシェア(共有シート → Xアプリ)

   ・**Xのツイート用URLには画像を添付できない。** 画像付きで投稿する唯一の道が
     Web Share API Level 2(navigator.share({files})) で、OSの共有シートを経由する。
   ・share() は**ユーザー操作のハンドラから同期的に**呼ばないとiOSに撥ねられる。
     そのため画像(File)はこの画面を開いた時点で作り終え、タップでは share() を呼ぶだけにする。
   ・画像の絵柄は render.js の shareCardCanvas(spec) が描く。**画面ごとの違いはspecの作り方だけ**で、
     入口を足すときは buildXxxShare() を1つ書いて openShareOverlay() へ渡せばよい。
   ===================================================================== */
let _shareState = { file:null, text:'', seq:0 };
function shareFilesSupported(f){
  return !!(navigator.canShare && navigator.share && f && navigator.canShare({ files:[f] }));
}
const SHARE_HINTS = {
  ready:       'ボタンを押すと共有メニューが開きます。そこで X を選んでください',
  unsupported: 'この端末では画像を直接渡せません。画像を長押しして保存 →「投稿画面を開く」→ 投稿画面で添付してください',
  sharing:     '共有メニューを開いています…',
  done:        '共有メニューを開きました。投稿画面の本文が空のときは貼り付けてください（コピー済みです）',
  error:       '共有できませんでした。画像を長押しして保存し、「投稿画面を開く」から投稿してください',
  building:    '',
};
function setShareState(state){
  const ov = document.getElementById('shareOverlay');
  if(!ov) return;
  ov.dataset.state = state;
  const hint = document.getElementById('shareHint');
  if(hint) hint.textContent = SHARE_HINTS[state] || '';
}
/* spec(絵柄の設計図)と text(投稿文)を受け取って画面を開き、Fileまで作る。
   **await を挟むのはこちら側だけ**(タップのハンドラでは挟まない)。 */
async function openShareOverlay(spec, text){
  const ov = document.getElementById('shareOverlay');
  if(!ov || typeof shareCardCanvas!=='function'){ pushToast('シェア機能を読み込めませんでした'); return; }
  const seq = ++_shareState.seq;              // 連打・開き直しで古い生成結果を捨てる
  _shareState.file = null;
  _shareState.text = text || '';
  document.getElementById('shareTextBox').textContent = _shareState.text;
  document.getElementById('shareOpenXBtn').href = 'https://x.com/intent/post?text=' + encodeURIComponent(_shareState.text);
  document.getElementById('sharePreviewImg').src = '';
  setShareState('building');
  ov.classList.remove('hidden');
  try{
    // フォント未解決のまま描くと文字幅が変わるので待つ。来なくても描けるよう握りつぶす
    if(document.fonts && document.fonts.ready) await document.fonts.ready;
  }catch(err){}
  if(seq !== _shareState.seq) return;
  let canvas = null;
  try{ canvas = shareCardCanvas(spec); }
  catch(err){ console.warn('シェア画像を作れませんでした', err); }
  if(seq !== _shareState.seq) return;
  if(!canvas){ setShareState('error'); return; }
  document.getElementById('sharePreviewImg').src = canvas.toDataURL('image/png');
  const file = await shareCardFile(spec, 'aramon.png', canvas);
  if(seq !== _shareState.seq) return;
  _shareState.file = file;
  if(shareFilesSupported(file)){ setShareState('ready'); }
  else { setShareState('unsupported'); copyShareText(true); }   // 貼り付けだけで済むようにしておく
}
function closeShareOverlay(){
  _shareState.seq++;                          // 進行中の生成を無効化する
  _shareState.file = null;
  const ov = document.getElementById('shareOverlay');
  if(ov) ov.classList.add('hidden');
  const img = document.getElementById('sharePreviewImg');
  if(img) img.src = '';                       // 1MB級のdataURLを抱えたままにしない
}
/* 【重要】この関数に await を絶対に足さないこと。
   navigator.share はタップ直後に同期で呼ぶ必要があり、await を挟むと
   ユーザー操作の資格が切れて iOS が NotAllowedError で撥ねる。 */
function onShareBtnTap(){
  const f = _shareState.file;
  if(!shareFilesSupported(f)){ setShareState('unsupported'); copyShareText(); return; }
  setShareState('sharing');
  const p = navigator.share({ files:[f], text:_shareState.text });   // ← 先にこれ
  // Xのアプリが画像だけ受け取って本文を捨てることがあるので、同じタップの中でコピーもしておく
  copyShareText(true);                                              // ← 順序を逆にしない
  p.then(()=>{ setShareState('done'); })
   .catch(err=>{
     // 共有メニューを閉じただけ(AbortError)は失敗ではない。黙って元へ戻す
     if(err && err.name === 'AbortError'){ setShareState('ready'); return; }
     console.warn('シェアに失敗', err);
     setShareState('error');
   });
}
function copyShareText(silent){
  const t = _shareState.text || '';
  const ok = ()=>{ if(!silent) pushToast('投稿する文をコピーしました'); };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(t).then(ok).catch(()=>{ if(shareLegacyCopy(t)) ok(); });
    return;
  }
  if(shareLegacyCopy(t)) ok();
}
// clipboard APIが無い/拒否された端末向けの保険。*のuser-select:noneを避けるためtextareaを使う
function shareLegacyCopy(t){
  const ta = document.createElement('textarea');
  ta.value = t;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  document.body.appendChild(ta);
  ta.select(); ta.setSelectionRange(0, t.length);
  let ok = false;
  try{ ok = document.execCommand('copy'); }catch(err){}
  ta.remove();
  return ok;
}
/* 投稿文の組み立て。**URLは必ず最後の行に単独で置く**(Xのプレビューが安定する)。
   Xは URL=23 / 日本語=2 / ASCII=1 で数えて上限280。溢れたら数値行から削る。 */
function shareTextUnits(s){
  let n = 0;
  for(const ch of String(s||'')) n += (ch.charCodeAt(0) < 0x80) ? 1 : 2;
  return n;
}
function buildShareText(lines, tags){
  const body = (lines||[]).filter(Boolean).map(String);
  const tagLine = [SHARE_TAG].concat(tags||[]).join(' ');
  /* 末尾は【空行 → タグ → PWAの案内 → URL】で全カード共通。**この並びを画面ごとに変えない。**
     URLは必ず最後の行に単独で置く(Xのプレビューが安定する)。 */
  const tail = ['', tagLine, SHARE_PWA_HINT, SHARE_URL];
  // URLはXが一律23文字で数えるので、実文字ぶんは足さず23として見積もる
  const fixed = shareTextUnits(tail.slice(0, -1).join('\n')) + 23 + 2;
  while(body.length > 1 && shareTextUnits(body.join('\n')) + fixed > SHARE_TEXT_MAX_UNITS) body.pop();
  return body.concat(tail).join('\n');
}
// シェアに出すプレイヤー名。ランキング登録名をそのまま使う
function sharePlayerName(){
  const el = document.getElementById('playerNameInput');
  const raw = el ? (el.value||'').trim() : '';
  return raw ? raw.slice(0, 12) : '名無しのモンスター';
}
/* モンスターの絵。装備スキンがあればそれを反映する。
   **未ロードなら null**(カード側がプレースホルダに切り替える)。 */
function shareArtImage(elementKey, skinId){
  if(typeof skinnedImage==='function' && skinId){
    const s = skinnedImage(skinId, 'icon');
    if(s && (typeof imgIsReady!=='function' || s instanceof HTMLCanvasElement || imgIsReady(s))) return s;
  }
  const base = (typeof monsterImages!=='undefined') ? monsterImages[elementKey] : null;
  if(base && (typeof imgIsReady!=='function' || imgIsReady(base))) return base;
  return null;
}
function shareBindUi(){
  const on = (id, fn, stop)=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener('click', (e)=>{ if(stop) e.stopPropagation(); fn(e); });
  };
  on('closeShareBtn', closeShareOverlay);
  on('shareDoBtn', onShareBtnTap);
  on('shareCopyBtn', ()=>copyShareText(false));
  // 背景をタップしたら閉じる(枠の中は閉じない)
  const ov = document.getElementById('shareOverlay');
  if(ov) ov.addEventListener('click', (e)=>{ if(e.target === ov) closeShareOverlay(); });

  // --- 各画面の入口 ---
  on('shareResultBtn', ()=>{
    if(!_lastResultShare){ pushToast('シェアできる記録がありません'); return; }
    openShareOverlay(_lastResultShare.spec, _lastResultShare.text);
  });
  on('shareRankBtn',     ()=>openRankShare(false));
  on('shareRaidRankBtn', ()=>openRankShare(true));
  /* SSR獲得画面は**どこを触っても次へ進む**ので、スキップボタンと同じく伝播を止める。
     シェア画面を閉じると獲得画面が残り、そのままタップで次へ進める。 */
  on('ssrRevealShareBtn', ()=>{
    const s = _lastSkinShare;
    if(s) openShareOverlay(s.spec, s.text);
  }, true);
}
// 直前に獲得したスキン(SSR獲得画面・ガチャ結果の両方が参照する)
let _lastSkinShare = null;
function setLastSkinShare(skinId){ _lastSkinShare = buildSkinShare(skinId); }

/* ---- 各画面のカード(spec)と投稿文 --------------------------------------
   入口を足すときはここに1つ関数を書き、{spec, text} を返して openShareOverlay へ渡す。
   render.js 側には手を入れない。                                            */
const SHARE_ACCENT = {
  win:  { accent:'#f4c430', accent2:'#5a3a12' },
  lose: { accent:'#6fa8ff', accent2:'#16294a' },
  raid: { accent:'#c07bff', accent2:'#39185e' },
  mm:   { accent:'#7fd4a0', accent2:'#14402c' },
  ssr:  { accent:'#ff8fd1', accent2:'#4a1030' },
};
// リザルトは表示のその場で作って持っておく(playerも報酬も後から読み直せない)
let _lastResultShare = null;
// ランキングのタブ名。シェアの見出しと投稿文の両方で使う
const RANKING_MODE_LABEL = { kills:'キル数', damage:'ダメージ数',
  mastermonLevel:'マスモンLv', mastermonRebirth:'転生回数', mastermonStatTotal:'ステ合計' };
/* ランキングをシェアできるのは「自分が一覧に載っているとき」だけ。
   載っていないときはボタンごと消す(押しても出せない順位を見せない)。
   一覧を描くたびに setRankShareTarget() で更新する。 */
let _rankShareInfo = null, _raidRankShareInfo = null;
function setRankShareTarget(raid, info){
  if(raid) _raidRankShareInfo = info || null;
  else     _rankShareInfo = info || null;
  const btn = document.getElementById(raid ? 'shareRaidRankBtn' : 'shareRankBtn');
  if(btn) btn.classList.toggle('hidden', !info);
}
function openRankShare(raid){
  const info = raid ? _raidRankShareInfo : _rankShareInfo;
  if(!info){ pushToast('ランキングに自分の記録がありません'); return; }
  const s = buildRankShare({ ...info, raid });
  openShareOverlay(s.spec, s.text);
}
function shareMapLabel(){
  const key = (game.activeMapKey && MAPS[game.activeMapKey]) ? game.activeMapKey
            : (MAPS[game.selectedMap] ? game.selectedMap : 'wild');
  return (MAPS[key] || MAPS.wild).label;
}
function shareModeLabel(){ return netState.mode==='multi' ? 'みんなと対戦' : 'ソロ'; }
// 参戦しているマスモンの名前(登録していなければモンスター名)
function shareMonsterName(elementKey){
  const el = ELEMENTS[elementKey];
  const base = el ? el.label : String(elementKey||'');
  try{
    const mm = loadMastermons()[elementKey];
    if(mm && mm.name) return mm.name;
  }catch(err){}
  return base;
}
function buildResultShare(o){
  const el = ELEMENTS[o.element];
  const label = el ? el.label : o.element;
  const monName = shareMonsterName(o.element);
  const chips = [];
  if(o.best) chips.push('🏆 自己ベスト');
  chips.push(shareModeLabel());
  const spec = {
    ...(o.isWin ? SHARE_ACCENT.win : SHARE_ACCENT.lose),
    player: sharePlayerName(),
    headline: o.isWin ? '👑 WINNER' : ('#' + o.placement),
    sub: `${o.mapLabel} ／ ${shareModeLabel()}`,
    image: shareArtImage(o.element, o.skinId),
    imageLabel: monName === label ? label : `${monName}（${label}）`,
    rows: [
      { label:'撃破数',   value: String(o.kills) },
      { label:'与ダメージ', value: Number(o.dmg).toLocaleString() },
      { label:'生存時間',  value: o.timeText },
    ],
    chips,
  };
  const head = o.isWin ? '👑 荒野モン動で優勝！' : `荒野モン動で ${o.placement} 位でした`;
  const text = buildShareText([
    head + (o.best ? '　🏆自己ベスト更新！' : ''),
    `${monName} ／ ${o.mapLabel}・${shareModeLabel()}`,
    `撃破 ${o.kills} ・ 与ダメ ${Number(o.dmg).toLocaleString()} ・ 生存 ${o.timeText}`,
  ]);
  return { spec, text };
}
function buildRaidShare(o){
  const el = ELEMENTS[o.element];
  const label = el ? el.label : o.element;
  const monName = shareMonsterName(o.element);
  const head = o.defeated ? '🐉 レイドボスを討伐！'
             : o.newBest  ? '🔥 レイドで自己ベスト更新！'
             : o.died     ? '💀 レイドで力尽きた…'
                          : '⏱ レイド時間切れ…';
  const spec = {
    ...SHARE_ACCENT.raid,
    player: sharePlayerName(),
    headline: head,
    sub: (typeof RAID_BOSS!=='undefined' ? RAID_BOSS.name : 'レイドボス'),
    image: shareArtImage(o.element, o.skinId),
    imageLabel: monName === label ? label : `${monName}（${label}）`,
    rows: [
      { label:'与ダメージ', value: Number(o.dmg).toLocaleString() },
      { label:'撃破数',    value: String(o.kills) },
      { label:'生存時間',   value: o.timeText },
    ],
    chips: ['レイドバトル', shareModeLabel()],
  };
  const text = buildShareText([
    head,
    `${monName} で 与ダメージ ${Number(o.dmg).toLocaleString()}`,
  ], ['#レイドバトル']);
  return { spec, text };
}
function buildMastermonShare(key){
  const mm = loadMastermons()[key];
  if(!mm) return null;
  const el = ELEMENTS[key];
  const species = el ? el.label : key;
  const apt = mastermonApt(mm);
  const rb = mastermonRebirthCount(mm);
  const cap = mastermonStatCap(mm);   // 転生の回数ぶん上限が上がる。バーもそこまで伸びる
  const skinId = (typeof getEquippedSkin==='function') ? getEquippedSkin(key) : null;
  const skinName = (skinId && typeof skinMeta==='function') ? skinMeta(skinId).name : null;
  /* マスモン詳細の STATUS 欄と同じ形(名前＋適正バッジ＋数値＋バー)を6項目そのまま出す。
     どこを伸ばしたマスモンなのかは、上位3つの数字だけでは伝わらない。 */
  const bars = MASTERMON_STATS.map(s=>({
    label: s.label, rank: apt[s.key], color: s.color,
    value: Math.round((mm.stats && mm.stats[s.key]) || 0), max: cap,
  }));
  const chips = [];
  if(rb > 0) chips.push(`★ 転生${rb}`);
  chips.push(species);
  const spec = {
    ...SHARE_ACCENT.mm,
    player: sharePlayerName(),
    headline: mm.name,
    sub: `Lv.${mm.level}${skinName ? ` ／ ${skinName}` : ''}`,
    image: shareArtImage(key, skinId),
    // 絵は着せ替え後の姿なので、ラベルもスキン名にそろえる(未装備なら種族名)
    imageLabel: skinName || species,
    bars,
    chips,
  };
  // ステータスと適正は画像側のバーで見せているので、文面では繰り返さない
  const text = buildShareText([
    `マスモン「${mm.name}」Lv.${mm.level}${rb>0?` ★転生${rb}`:''}`,
    skinName ? `${species} ／ スキン「${skinName}」` : species,
    '自慢のマスモンステータスを見て！',
  ], ['#マスモン']);
  return { spec, text };
}
/* スキン獲得(SSR獲得画面・ガチャ結果の両方から使う)。
   絵はスキンそのもの。素の姿ではなく**着せ替え後の姿**を出す。 */
function buildSkinShare(skinId){
  const m = (typeof skinMeta==='function') ? skinMeta(skinId) : null;
  if(!m) return null;
  const el = ELEMENTS[m.element];
  const rar = m.rarity;   // skinMeta が 'SSR' / 'SR' を必ず入れてくる
  const img = (typeof skinnedImage==='function') ? skinnedImage(skinId, 'icon') : null;
  const spec = {
    ...SHARE_ACCENT.ssr,
    player: sharePlayerName(),
    headline: `${rar} ${m.name} 獲得！`,
    sub: el ? `${el.label} のスキン` : 'スキン',
    image: img || shareArtImage(m.element, null),
    imageLabel: m.name,
    rows: [
      { label:'レアリティ', value: rar },
      { label:'モンスター', value: el ? el.label : m.element },
    ],
    chips: ['スキンガチャ'],
  };
  const text = buildShareText([
    `ガチャで「${m.name}」（${rar}）を引いた！`,
    el ? `${el.label} の新しい姿` : '',
  ], ['#ガチャ']);
  return { spec, text };
}
/* ランキングのシェア。**自分が一覧に載っているときだけ**呼ばれる。
   通常/レイドで見出しだけ変えて中身は共通にする。 */
function buildRankShare(o){
  const spec = {
    ...(o.raid ? SHARE_ACCENT.raid : SHARE_ACCENT.win),
    player: sharePlayerName(),
    headline: `${o.rank} 位`,
    sub: o.title,
    image: shareArtImage(o.element || game.selectedElement, o.skinId),
    imageLabel: o.monsterLabel || '',
    rows: [
      { label:o.valueLabel, value:o.valueText },
      { label:'順位', value:`#${o.rank}` },
    ],
    chips: o.chips || [],
  };
  const text = buildShareText([
    `${o.title} で ${o.rank} 位！`,
    `${o.valueLabel} ${o.valueText}`,
  ], o.raid ? ['#レイドバトル'] : []);
  return { spec, text };
}

function logMatchForAdmin(isWin, placement){
  if(!window.__aramonLogMatch){ console.warn('logMatchForAdmin: __aramonLogMatch not ready, skipped'); return; }
  const rawName = (document.getElementById('playerNameInput').value||'').trim();
  const name = rawName ? rawName.slice(0,12) : '名無しのモンスター';
  const mapKey = (game.activeMapKey && MAPS[game.activeMapKey]) ? game.activeMapKey : (MAPS[game.selectedMap] ? game.selectedMap : 'wild');
  const map = MAPS[mapKey] || MAPS.wild;
  const elementKey = player.element;
  const el = ELEMENTS[elementKey];
  window.__aramonLogMatch({
    name,
    map: mapKey,
    mapLabel: map.label,
    element: elementKey,
    elementLabel: el ? el.label : elementKey,
    mode: netState.mode==='multi' ? 'multi' : 'solo',
    win: !!isWin,
    place: placement || 0,
    ...matchOutcomeFields(),
    ts: Date.now(),
  });
}
// レイド版のlogMatchForAdmin。管理者画面の各項目(プレイ回数/プレイヤー情報/直近プレイ)に
// レイドの参加が出るように、通常の試合と同じmatchLogsへ記録する(raid系フィールドを追加で持たせる)。
function logRaidMatchForAdmin(dmg, result){
  if(!window.__aramonLogMatch) return;
  const name = getDisplayNameFromInput();
  const elementKey = (player && player.element) || game.selectedElement;
  const el = ELEMENTS[elementKey];
  window.__aramonLogMatch({
    name,
    map: 'raid',
    mapLabel: MAPS.raid.label,
    element: elementKey,
    elementLabel: el ? el.label : elementKey,
    // レイドもソロ/マルチを分けて残す(表示側は adminModeLabel が「レイド(ソロ)」等に組み立てる)
    mode: netState.mode==='multi' ? 'multi' : 'solo',
    raid: true,
    raidDamage: Math.round(dmg),
    raidResult: result, // 'defeated' | 'best' | 'died' | 'timeup'
    win: result==='defeated' || result==='best',
    ...matchOutcomeFields(),
    ts: Date.now(),
  });
}
/* =====================================================================
   LOCAL STATS (localStorage)
===================================================================== */
const LOCAL_STATS_KEY = 'aramon_local_stats_v1';
function defaultModeStats(){
  const byElement = {};
  Object.keys(ELEMENTS).forEach(key=>{
    byElement[key] = { bestDamage:0, bestKills:0, matches:0 };
  });
  return {
    totalMatches:0, totalWins:0, totalKills:0, totalDamage:0,
    bestDamage:0, bestKills:0,
    byElement,
  };
}
function defaultLocalStats(){
  return { solo: defaultModeStats(), multi: defaultModeStats() };
}
function loadLocalStats(){
  try{
    const raw = localStorage.getItem(LOCAL_STATS_KEY);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    if(!parsed) return null;
    // 旧フォーマット(ソロ/マルチ分離前)は、これまでの記録をまるごとソロ側へ引き継ぐ形で移行する
    if(!parsed.solo && !parsed.multi && typeof parsed.totalMatches==='number'){
      const migrated = { solo: parsed, multi: defaultModeStats() };
      saveLocalStats(migrated);
      return migrated;
    }
    if(!parsed.solo) parsed.solo = defaultModeStats();
    if(!parsed.multi) parsed.multi = defaultModeStats();
    return parsed;
  }catch(err){ return null; }
}
function saveLocalStats(stats){
  try{ localStorage.setItem(LOCAL_STATS_KEY, JSON.stringify(stats)); }catch(err){}
  accountMarkDirty();
}
function recordMatchResult(elementKey, kills, damage, isWin, mode){
  let stats = loadLocalStats();
  if(!stats) stats = defaultLocalStats();
  const modeKey = mode==='multi' ? 'multi' : 'solo';
  if(!stats[modeKey]) stats[modeKey] = defaultModeStats();
  const ms = stats[modeKey];
  if(!ms.byElement) ms.byElement = {};
  if(!ms.byElement[elementKey]) ms.byElement[elementKey] = { bestDamage:0, bestKills:0, matches:0 };

  ms.totalMatches = (ms.totalMatches||0) + 1;
  ms.totalWins = (ms.totalWins||0) + (isWin?1:0);
  ms.totalKills = (ms.totalKills||0) + kills;
  ms.totalDamage = (ms.totalDamage||0) + damage;
  ms.bestDamage = Math.max(ms.bestDamage||0, damage);
  ms.bestKills = Math.max(ms.bestKills||0, kills);

  const es = ms.byElement[elementKey];
  es.matches = (es.matches||0) + 1;
  es.bestDamage = Math.max(es.bestDamage||0, damage);
  es.bestKills = Math.max(es.bestKills||0, kills);

  saveLocalStats(stats);
  return stats;
}
function computeDerivedStats(stats){
  const deaths = Math.max(0, (stats.totalMatches||0) - (stats.totalWins||0));
  const kd = deaths>0 ? (stats.totalKills||0)/deaths : (stats.totalKills||0);
  const avgDamage = (stats.totalMatches||0)>0 ? (stats.totalDamage||0)/stats.totalMatches : 0;
  return { deaths, kd, avgDamage };
}
// あるモンスター(element)のソロ+マルチ合算の最高キル/ダメージ
function elementBestAcrossModes(elementKey){
  const s = loadLocalStats() || defaultLocalStats();
  let bestKills=0, bestDamage=0;
  for(const m of ['solo','multi']){
    const be = s[m] && s[m].byElement && s[m].byElement[elementKey];
    if(be){ bestKills = Math.max(bestKills, be.bestKills||0); bestDamage = Math.max(bestDamage, be.bestDamage||0); }
  }
  return { bestKills, bestDamage };
}
// このモンスターが今回の試合で新たに超えたキル/ダメージ称号(各カテゴリの最高の1つ)を返す
function elementNewTitleBadges(prevElem, kills, damage){
  if(typeof TITLES==='undefined') return [];
  const out = [];
  let bestKillT=null, bestDmgT=null;
  for(const def of TITLES){
    if(def.type==='matchKills' && kills>0 && prevElem.bestKills < def.n && kills >= def.n){ if(!bestKillT || def.n>bestKillT.n) bestKillT = def; }
    else if(def.type==='matchDamage' && damage>0 && prevElem.bestDamage < def.n && damage >= def.n){ if(!bestDmgT || def.n>bestDmgT.n) bestDmgT = def; }
  }
  if(bestKillT) out.push(bestKillT);
  if(bestDmgT) out.push(bestDmgT);
  return out;
}

/* =====================================================================
   称号(タイトル)の解放判定
===================================================================== */
// solo+multiを合算した通算値と、1試合の自己ベストをまとめる
function titlesCumulativeStats(){
  const s = loadLocalStats() || defaultLocalStats();
  const modes = ['solo','multi'];
  let wins=0, matches=0, kills=0, damage=0, bestKills=0, bestDamage=0;
  const elemPlayed = new Set();
  for(const m of modes){
    const ms = s[m]; if(!ms) continue;
    wins += ms.totalWins||0; matches += ms.totalMatches||0;
    kills += ms.totalKills||0; damage += ms.totalDamage||0;
    bestKills = Math.max(bestKills, ms.bestKills||0);
    bestDamage = Math.max(bestDamage, ms.bestDamage||0);
    const be = ms.byElement||{};
    Object.keys(be).forEach(k=>{ if((be[k].matches||0)>0) elemPlayed.add(k); });
  }
  return { wins, matches, kills, damage, bestKills, bestDamage, elemPlayed };
}
function ownsAnySsr(){
  try{
    const owned = loadSkins().owned || {};
    return Object.keys(owned).some(id=>{ if(!owned[id]) return false; const m=skinMeta(id); return m && m.rarity==='SSR'; });
  }catch(e){ return false; }
}
function titleConditionMet(t, cum){
  switch(t.type){
    case 'matchKills':  return cum.bestKills  >= t.n;
    case 'matchDamage': return cum.bestDamage >= t.n;
    case 'wins':        return cum.wins   >= t.n;
    case 'matches':     return cum.matches >= t.n;
    case 'totalKills':  return cum.kills   >= t.n;
    case 'totalDamage': return cum.damage  >= t.n;
    case 'ssr':         return ownsAnySsr();
    case 'allElem':     return Object.keys(ELEMENTS).every(k=> cum.elemPlayed.has(k));
    default:            return false;
  }
}
// 現在の実績で解放できる称号を解放し、新しく解放したものの配列を返す
function checkTitleUnlocks(){
  if(typeof TITLES==='undefined') return [];
  const cum = titlesCumulativeStats();
  const t = loadTitles();
  const newly = [];
  for(const def of TITLES){
    if(t.unlocked[def.id]) continue;
    if(titleConditionMet(def, cum)){ t.unlocked[def.id] = Date.now(); newly.push(def); }
  }
  if(newly.length){ saveTitles(t); }
  return newly;
}

/* =====================================================================
   デイリー: ログインボーナス＋ミッション
===================================================================== */
function dailyEnsureMissions(d){
  const today = dailyTodayStr();
  if(d.missionDate !== today){
    d.missionDate = today;
    d.missions = {};
    DAILY_MISSIONS.forEach(m=>{ d.missions[m.id] = { progress:0, claimed:false }; });
    return true;
  }
  // 定義追加に備えて欠けているミッションを補完
  DAILY_MISSIONS.forEach(m=>{ if(!d.missions[m.id]) d.missions[m.id] = { progress:0, claimed:false }; });
  return false;
}
// 起動時: 新しい日ならログインボーナス付与＆ミッション更新
function dailyCheckLogin(){
  if(typeof loadDaily!=='function') return;
  const d = loadDaily();
  const today = dailyTodayStr();
  let granted = null;
  if(d.lastLoginDate !== today){
    d.loginDay = ((d.loginDay||0) % 7) + 1; // 1..7でループ
    d.lastLoginDate = today;
    const reward = LOGIN_BONUS[d.loginDay];
    grantReward(reward);
    granted = { day:d.loginDay, reward };
  }
  dailyEnsureMissions(d);
  saveDaily(d);
  if(granted) showLoginBonusPopup(granted);
  updateDailyBadge();
  updateAccountBar();
}
// 試合終了時に呼ぶ: ミッション進捗を加算
function dailyOnMatchEnd(ctx){
  if(typeof loadDaily!=='function') return;
  const d = loadDaily();
  dailyEnsureMissions(d);
  for(const m of DAILY_MISSIONS){
    const st = d.missions[m.id]; if(!st || st.claimed) { /* 受取済でも進捗は進めてよいがcap不要 */ }
    if(!st) continue;
    if(m.track==='play') st.progress += 1;
    else if(m.track==='kill') st.progress += (ctx.kills||0);
    else if(m.track==='win') st.progress += (ctx.isWin?1:0);
  }
  saveDaily(d);
  updateDailyBadge();
}
function showLoginBonusPopup(g){
  const dayEl = document.getElementById('loginBonusDay');
  const rewEl = document.getElementById('loginBonusReward');
  const pop = document.getElementById('loginBonusPopup');
  if(!dayEl || !rewEl || !pop) return;
  dayEl.textContent = `Day ${g.day} / 7`;
  rewEl.textContent = rewardText(g.reward);
  pop.classList.remove('hidden');
}
function updateDailyBadge(){
  const dot = document.getElementById('dailyDot');
  if(!dot || typeof loadDaily!=='function') return;
  const d = loadDaily();
  dailyEnsureMissions(d);
  const claimable = DAILY_MISSIONS.some(m=>{ const st=d.missions[m.id]; return st && st.progress>=m.target && !st.claimed; });
  dot.classList.toggle('hidden', !claimable);
}
function renderDailyLoginTrack(){
  const el = document.getElementById('dailyLoginTrack');
  if(!el) return;
  const d = loadDaily();
  el.innerHTML = [1,2,3,4,5,6,7].map(day=>{
    const isToday = day===d.loginDay;
    const got = day<=(d.loginDay||0); // 今サイクルで受取済み(簡易表示)
    return `<div class="daily-day ${isToday?'today':''} ${got?'got':''}">
      <div class="daily-day-label">Day ${day}</div>
      <div class="daily-day-reward">${rewardText(LOGIN_BONUS[day])}</div>
      ${isToday?'<div class="daily-day-badge">本日</div>':(got?'<div class="daily-day-check">✓</div>':'')}
    </div>`;
  }).join('');
}
function renderDailyMissions(){
  const el = document.getElementById('dailyMissionList');
  if(!el) return;
  const d = loadDaily();
  dailyEnsureMissions(d);
  saveDaily(d);
  el.innerHTML = DAILY_MISSIONS.map(m=>{
    const st = d.missions[m.id] || { progress:0, claimed:false };
    const done = st.progress>=m.target;
    const pct = Math.min(100, Math.round(st.progress/m.target*100));
    let action;
    if(st.claimed) action = `<span class="daily-claimed">受取済</span>`;
    else if(done) action = `<button class="daily-claim-btn" data-m="${m.id}">受け取る</button>`;
    else action = `<span class="daily-progress-num">${Math.min(st.progress,m.target)} / ${m.target}</span>`;
    return `<div class="daily-mission ${done&&!st.claimed?'ready':''}">
      <div class="daily-mission-info">
        <div class="daily-mission-name">${m.name}</div>
        <div class="daily-bar"><div class="daily-bar-fill" style="width:${pct}%"></div></div>
        <div class="daily-mission-reward">報酬 ${rewardText(m.reward)}</div>
      </div>
      <div class="daily-mission-action">${action}</div>
    </div>`;
  }).join('');
  el.querySelectorAll('.daily-claim-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const m = DAILY_MISSIONS.find(x=>x.id===btn.dataset.m);
      const dd = loadDaily();
      const st = dd.missions[m.id];
      if(st && st.progress>=m.target && !st.claimed){
        st.claimed = true;
        grantReward(m.reward);
        saveDaily(dd);
        renderDailyMissions();
        updateDailyBadge();
        updateAccountBar();
        if(typeof pushToast==='function') pushToast(`報酬 ${rewardText(m.reward)} を受け取った！`);
      }
    });
  });
}
document.getElementById('openDailyBtn').addEventListener('click', ()=>{
  renderDailyLoginTrack();
  renderDailyMissions();
  document.getElementById('dailyOverlay').classList.remove('hidden');
});
document.getElementById('closeDailyBtn').addEventListener('click', ()=>{
  document.getElementById('dailyOverlay').classList.add('hidden');
});
document.getElementById('loginBonusOkBtn').addEventListener('click', ()=>{
  document.getElementById('loginBonusPopup').classList.add('hidden');
  updateAccountBar();
});

/* =====================================================================
   シーズンパス
===================================================================== */
// 試合終了時に呼ぶ: SP加算。加算量を返す(リザルト表示用)
function seasonOnMatchEnd(ctx){
  if(typeof loadSeason!=='function') return 0;
  const gain = seasonSpForMatch(ctx.kills, ctx.damage, ctx.isWin);
  const s = loadSeason();
  s.sp += gain;
  saveSeason(s);
  updateSeasonBadge();
  return gain;
}
function updateSeasonBadge(){
  const dot = document.getElementById('seasonDot');
  if(!dot || typeof loadSeason!=='function') return;
  const s = loadSeason();
  const tier = seasonTierForSp(s.sp);
  let claimable = false;
  for(let t=1;t<=tier;t++){ if(!s.claimed[t]){ claimable = true; break; } }
  dot.classList.toggle('hidden', !claimable);
}
function seasonClaim(t){
  const s = loadSeason();
  if(seasonTierForSp(s.sp) >= t && !s.claimed[t]){
    s.claimed[t] = true;
    const reward = SEASON_REWARDS[t-1];
    const rewardSkinAlreadyOwned = (reward && reward.skin && typeof isSkinOwned==='function') ? isSkinOwned(reward.skin) : false;
    grantReward(reward);
    saveSeason(s);
    renderSeasonOverlay();
    updateSeasonBadge();
    updateAccountBar();
    // 限定SSRスキンはSSR獲得演出(虹色リビール)を出す
    if(reward && reward.skin && typeof showSsrReveal==='function'){
      // ssrPromoteOverlay/ssrRevealOverlayはガチャ画面の子要素なので、表示中だけ裏で開いておく
      const gachaOv = document.getElementById('gachaOverlay');
      const gachaWasOpen = gachaOv && !gachaOv.classList.contains('hidden');
      if(gachaOv) gachaOv.classList.remove('hidden');
      const finishReveal = ()=>{
        if(gachaOv && !gachaWasOpen) gachaOv.classList.add('hidden');
        if(typeof pushToast==='function') pushToast(`${skinMeta(reward.skin).name} を獲得！`);
      };
      if(ssrShouldPromote(rewardSkinAlreadyOwned)) runSsrPromotionSequence(reward.skin, ()=> showSsrReveal(reward.skin, finishReveal));
      else showSsrReveal(reward.skin, finishReveal);
    } else if(typeof pushToast==='function'){
      pushToast(`Tier ${t} 報酬 ${rewardText(reward)} を受け取った！`);
    }
  }
}
function renderSeasonOverlay(){
  const s = loadSeason();
  const tier = seasonTierForSp(s.sp);
  const spInTier = s.sp - tier*SEASON_SP_PER_TIER;
  const atMax = tier>=SEASON_MAX_TIER;
  const spEl = document.getElementById('seasonSpText');
  const tierEl = document.getElementById('seasonTierText');
  const barEl = document.getElementById('seasonProgFill');
  const nextEl = document.getElementById('seasonNextText');
  if(spEl) spEl.textContent = `${s.sp} SP`;
  if(tierEl) tierEl.textContent = `Tier ${tier} / ${SEASON_MAX_TIER}`;
  if(barEl) barEl.style.width = (atMax ? 100 : Math.round(spInTier/SEASON_SP_PER_TIER*100)) + '%';
  if(nextEl) nextEl.textContent = atMax ? '最大Tier到達！' : `次のTierまで ${SEASON_SP_PER_TIER - spInTier} SP`;
  const track = document.getElementById('seasonTrack');
  if(track){
    track.innerHTML = SEASON_REWARDS.map((r,i)=>{
      const t = i+1;
      const reached = tier>=t;
      const claimed = !!s.claimed[t];
      const milestone = (t%5===0);
      let action;
      if(claimed) action = `<span class="season-claimed">受取済</span>`;
      else if(reached) action = `<button class="season-claim-btn" data-t="${t}">受け取る</button>`;
      else action = `<span class="season-locked">🔒</span>`;
      // 限定SSRスキン報酬は虹色背景のアイコンで表示(タップで正面/後ろ姿プレビュー)
      const rewardMid = r.skin
        ? `<div class="season-skin-reward" data-skin="${r.skin}"><img class="season-skin-img" src="${skinPreviewSrc(r.skin,'front')}" alt=""><span class="season-skin-name">${skinMeta(r.skin).name}</span></div>`
        : `<div class="season-tier-reward">${rewardText(r)}</div>`;
      return `<div class="season-tier ${reached&&!claimed?'ready':''} ${milestone?'milestone':''} ${r.skin?'season-tier-final':''}">
        <div class="season-tier-num">T${t}</div>
        ${rewardMid}
        <div class="season-tier-action">${action}</div>
      </div>`;
    }).join('');
    track.querySelectorAll('.season-claim-btn').forEach(btn=>{
      btn.addEventListener('click', ()=> seasonClaim(parseInt(btn.dataset.t,10)));
    });
    track.querySelectorAll('.season-skin-reward[data-skin]').forEach(el=>{
      el.addEventListener('click', ()=> showSkinPreview(el.dataset.skin));
    });
    // 25段あるので、開いたときに今のTier付近が見えるよう横スクロール位置を寄せる
    const focus = track.children[Math.max(0, Math.min(SEASON_MAX_TIER-1, tier))];
    if(focus) track.scrollLeft = Math.max(0, focus.offsetLeft - track.clientWidth/2 + focus.offsetWidth/2);
  }
  // スケジュール(曜日ごとの変則ルール+レイド開催期間)も一緒に出す
  if(typeof renderSeasonSchedule==='function') renderSeasonSchedule();
}
document.getElementById('openSeasonBtn').addEventListener('click', ()=>{
  renderSeasonOverlay();
  document.getElementById('seasonOverlay').classList.remove('hidden');
});
document.getElementById('closeSeasonBtn').addEventListener('click', ()=>{
  document.getElementById('seasonOverlay').classList.add('hidden');
});

function submitScoreToRanking(isWin, placement){
  const statusEl = document.getElementById('scoreSubmitStatus');
  if(!window.__aramonSubmitScore){ statusEl.textContent=''; return; }
  const rawName = (document.getElementById('playerNameInput').value||'').trim();
  const name = rawName ? rawName.slice(0,12) : '名無しのモンスター';
  let mastermonName = null;
  let mastermonLevel = null;
  let mastermonRebirth = null;
  let mastermonStatTotalVal = null;
  if(game.selectedMastermonKey){
    const mm = loadMastermons()[game.selectedMastermonKey];
    if(mm){
      mastermonName = mm.name; mastermonLevel = mm.level;
      mastermonRebirth = mastermonRebirthCount(mm);
      mastermonStatTotalVal = mastermonStatTotal(mm);
    }
  }
  statusEl.textContent = 'ランキングに送信中…';
  const equippedSkin = (typeof getEquippedSkin==='function') ? (getEquippedSkin(player.element) || null) : null;
  window.__aramonSubmitScore({
    name,
    element: player.element,
    elementLabel: ELEMENTS[player.element].label,
    mapType: (currentMap && currentMap.real3d) ? 'real' : 'normal', // 通常/リアルマップでランキングを分ける
    skin: equippedSkin,               // その試合で装備していたスキン(ランキングアイコンに反映)
    mastermonName,
    mastermonLevel,
    mastermonRebirth,
    mastermonStatTotal: mastermonStatTotalVal,
    kills: player.kills,
    damage: Math.round(player.damageDealt),
    placement: isWin ? 1 : placement,
    isWin: !!isWin,
    time: Math.round(player.deathAt||matchTime),
    ts: Date.now(),
  }).then(ok=>{
    statusEl.textContent = ok ? 'ランキングに記録しました' : 'ランキング送信に失敗しました';
  });
}
/* =====================================================================
   マスモン(マスターモンスター) UI
===================================================================== */
let mastermonDetailKey = null;
let mastermonSelectedTraining = null;
let mastermonDetailTab = null; // 'info'(既定) / 'moves' / 'training' / 'dressup' / 'edit'

let mastermonOpenedFrom = 'title';
/* =====================================================================
   マスモン選択(カルーセル + 詳細)
   モンスター選択と同じカードカルーセルのエンジン(createCardCarousel)を共用する。
   違いは「登録済みマスモンだけを並べる」「装備スキンを反映する」「詳細の右側が
   既存のサブビュー(詳細情報/技一覧/トレーニング/着せ替え/編集)になる」の3点。
   ===================================================================== */
function mmKeys(){ return Object.keys(loadMastermons()); }
// 育成後の実効値(バトルで実際に使われる値)を出す
// カード等に出す実効HP・速さ。applyMastermonStatsToEntity と同じ順番で計算する
// (基礎値の加算 → 育成倍率)。式を片方だけ変えると表示と実戦力が食い違う。
function mmEffectiveStats(mm){
  const el = ELEMENTS[mm.element];
  const mults = mastermonEffectMults(mm);
  const rb = mastermonBaseBonus(mm);
  return {
    hp: Math.round((el.hp + rb.hp) * mults.lifeMult),
    speed: Math.round((el.speed * (el.speedMod||1) + rb.speed) * mults.speedMult),
  };
}
// マスモンカードのHP/速さが育つほど数値の色を目立たせる(200:オレンジ/300:金/400:虹)
function mmStatValueColorClass(v){
  if(v>=400) return 'ml-fig-v-rainbow';
  if(v>=300) return 'ml-fig-v-gold';
  if(v>=200) return 'ml-fig-v-orange';
  return '';
}
// マスモンは「着せ替え済みの姿」なのでスキン込みのオーラを使う
function mmAuraOf(key){
  return (typeof getMonsterAura==='function') ? getMonsterAura({ element:key, isPlayer:true }) : MONSTER_AURA[key];
}
function mmAccentOf(key){
  const aura = mmAuraOf(key);
  return (aura && typeof auraColorHex==='function') ? auraColorHex(aura) : (ELEMENTS[key].accent || ELEMENTS[key].color);
}
// 装備スキンのレア度でカードの光沢の色を変える(SR=金 / SSR=虹 / 無し=白)
function mmShineClass(key){
  const sid = (typeof getEquippedSkin==='function') ? getEquippedSkin(key) : null;
  if(!sid) return '';
  if(typeof SSR_SKINS!=='undefined' && SSR_SKINS[sid]) return 'ml-shine-ssr';
  if(sid.indexOf(':')>=0) return 'ml-shine-sr';
  return '';
}
function mmCardInnerHtml(key){
  const mm = loadMastermons()[key];
  if(!mm) return '';
  const el = ELEMENTS[key];
  const eff = mmEffectiveStats(mm);
  const expNeed = mastermonExpToNext(mm.level);
  const maxed = mm.level >= MASTERMON_LEVEL_CAP;
  const expPct = maxed ? 100 : Math.round(mm.exp/expNeed*100);
  const picked = (game.selectedMastermonKey===key) ? '<div class="ml-card-picked">選択中</div>' : '';
  return `
    ${picked}
    <div class="ml-card-lv">Lv.${mm.level}</div>
    ${mmRebirthStarsHtml(mm)}
    <div class="ml-card-art ml-card-art-mm">${equippedIconImgTag(key, el.label)}</div>
    <div class="ml-card-shine"></div>
    <div class="ml-card-body ml-card-body-mm">
      <div class="ml-card-name">${mm.name}${caroAuraMarkHtml(mmAuraOf(key))}</div>
      ${caroFigsHtml([{k:'HP', v:eff.hp, colorClass:mmStatValueColorClass(eff.hp)}, {k:'速さ', v:eff.speed, colorClass:mmStatValueColorClass(eff.speed)}])}
      <div class="ml-card-exp"><div class="ml-card-exp-fill" style="width:${expPct}%"></div></div>
      <div class="ml-card-exp-label"><span class="${maxed?'ml-card-maxlv':''}">${maxed ? 'MAX LEVEL' : `EXP ${mm.exp}/${expNeed}`}</span>　<span class="ml-card-ticket">🎫${mm.tickets}</span></div>
    </div>`;
}

const mmCarousel = createCardCarousel({
  stage:'mmStage', track:'mmTrack', dots:'mmDots', glow:'mmGlow',
  counterNow:'mmCounterNow', counterAll:'mmCounterAll',
  prevBtn:'mmPrevBtn', nextBtn:'mmNextBtn',
  keys: mmKeys,
  cardHtml: mmCardInnerHtml,
  cardClass: mmShineClass,
  accent: mmAccentOf,
  art: (key)=>({ a: ELEMENTS[key].color, b: ELEMENTS[key].dark }),
  onPick: (key, cardEl)=>openMastermonDetail(key, cardEl),
});
// 旧関数名(削除・改名・トレーニング後などから呼ばれる)。カードの中身を作り直す
function renderMastermonList(){
  const keys = mmKeys();
  // 登録数が変わったときはカード自体を作り直す
  if(!mmCarousel.st.built || mmCarousel.st.keys.length !== keys.length) mmCarousel.build();
  else mmCarousel.refreshCards();
}

// 詳細ビューのカードだけ描く(右側の内容は既存の renderMastermonDetail が担当)
function renderMastermonCard(key, srcCard){
  const slot = document.getElementById('mmDetailCardSlot');
  let clone;
  if(srcCard){
    clone = srcCard.cloneNode(true);
  } else {
    clone = document.createElement('div');
    clone.className = 'ml-card ' + mmShineClass(key);
    clone.dataset.key = key;
    clone.style.setProperty('--ml-accent', mmAccentOf(key));
    clone.style.setProperty('--ml-art-a', ELEMENTS[key].color);
    clone.style.setProperty('--ml-art-b', ELEMENTS[key].dark);
    clone.innerHTML = mmCardInnerHtml(key);
  }
  clone.classList.add('is-center');
  slot.innerHTML = '';
  slot.appendChild(clone);
  // マスモンが1体だけのときは隣へ移動できないので≪≫は出さない
  if(mmCarousel.st.keys.length > 1){
    slot.insertAdjacentHTML('beforeend', caroDetailNavHtml());
    slot.querySelector('.ml-card-nav-prev').addEventListener('click', (e)=>{ e.stopPropagation(); mmDetailStep(-1); });
    slot.querySelector('.ml-card-nav-next').addEventListener('click', (e)=>{ e.stopPropagation(); mmDetailStep(1); });
  }
  return clone;
}
// 詳細を開いたまま隣のマスモンへ移動する(カード送りSEはカルーセル側が鳴らす)
function mmDetailStep(dir){
  const key = mmCarousel.jump(dir);
  if(!key) return;
  mastermonDetailKey = key;
  mastermonSelectedTraining = null;
  mastermonPreviewSkin = null;   // 切替先の装備中スキンをプレビュー初期値にする
  mastermonDetailTab = null;     // 隣へ移ったらメニューに戻す
  const card = renderMastermonCard(key, null);
  card.classList.add(dir > 0 ? 'ml-slide-in-right' : 'ml-slide-in-left');
  renderMastermonDetail(key);
}
function openMastermonDetail(key, srcCard){
  mastermonDetailKey = key;
  mastermonSelectedTraining = null;
  mastermonPreviewSkin = null;
  mastermonDetailTab = null;   // 初期はステータスの右に「詳細情報/トレーニング/着せ替え」の3ボタン
  const srcRect = srcCard ? srcCard.getBoundingClientRect() : null;
  const clone = renderMastermonCard(key, srcCard);
  document.getElementById('mmCarouselView').classList.add('hidden');
  document.getElementById('mmDetailView').classList.remove('hidden');
  renderMastermonDetail(key);
  if(srcRect) caroFlipCard(document.getElementById('mmDetailCardSlot'), clone, srcRect);
}
function closeMastermonDetail(){
  mastermonDetailTab = null;
  document.getElementById('mmDetailView').classList.add('hidden');
  document.getElementById('mmCarouselView').classList.remove('hidden');
  mmCarousel.refreshCards();
  mmCarousel.render();
}
// 左カラムのボタン(編集 / 一覧へ)。他のタブはメニュー画面(ステータスの右)から開く
{
  document.getElementById('mmDetailTabGrid').querySelectorAll('.mm-tab-btn[data-tab]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ mmOpenTab(btn.dataset.tab); });
  });
  document.getElementById('mmBackToListBtn').addEventListener('click', closeMastermonDetail);
}
function mmOpenTab(tab){
  mastermonDetailTab = tab;
  mastermonSelectedTraining = null;
  if(tab==='dressup') mastermonPreviewSkin = null;   // 装備中を初期プレビューに
  renderMastermonDetail(mastermonDetailKey);
  updateMetaBgm();
}
// 試合外(メタ画面)のBGMを今の画面に合わせる。
// トレーニング画面だけ専用曲にし、それ以外はロビー曲へ戻す。
// ショップは専用の開閉ハンドラが 'shop' を出しているのでここでは触らない。
function updateMetaBgm(){
  if(typeof bgmSetTrack!=='function') return;
  if(game.started) return;
  const shop = document.getElementById('shopOverlay');
  if(shop && !shop.classList.contains('hidden')) return;
  const mmScr = document.getElementById('mastermonScreen');
  const onTraining = !!(mmScr && !mmScr.classList.contains('hidden') && mastermonDetailTab==='training');
  if(onTraining && typeof ensureBgmTrainingBuffer==='function') ensureBgmTrainingBuffer();
  bgmSetTrack(onTraining ? 'training' : 'title');
}
// 左カラムのボタンの選択状態を現在のタブに合わせる
function mmSyncTabButtons(){
  document.querySelectorAll('#mmDetailTabGrid .mm-tab-btn[data-tab]').forEach(b=>{
    b.classList.toggle('active', b.dataset.tab === mastermonDetailTab);
  });
}
// スクロールできることが分かるように、常に見えるスライドバーを右端に付ける。
// iOSのネイティブスクロールバーはスクロール中しか出ないため、自前で描いて掴んで動かせるようにする。
function attachVisibleScrollbar(el, bar){
  if(!el || !bar) return;
  const thumb = bar.querySelector('.mm-scrollbar-thumb');
  const MIN_THUMB = 26;
  function update(){
    const h = el.clientHeight, sh = el.scrollHeight;
    if(sh <= h + 1){ bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const thumbH = Math.max(MIN_THUMB, Math.round(h * (h / sh)));
    const maxTop = h - thumbH;
    const top = maxTop > 0 ? (el.scrollTop / (sh - h)) * maxTop : 0;
    thumb.style.height = thumbH + 'px';
    thumb.style.transform = `translateY(${top}px)`;
  }
  el.addEventListener('scroll', update);
  // 画像の読み込みや内容の切り替えで高さが変わるので、変化を監視して追従する
  if(el._scrollbarRO){ el._scrollbarRO.disconnect(); el._scrollbarRO = null; }
  if(typeof ResizeObserver === 'function'){
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if(el.firstElementChild) ro.observe(el.firstElementChild);
    el._scrollbarRO = ro;
  }
  requestAnimationFrame(update);
  update();

  // つまみを掴んでスクロールできるようにする(強制横向きでは移動量を回転補正する)
  let dragId = null, startY = 0, startTop = 0;
  thumb.addEventListener('pointerdown', (e)=>{
    dragId = e.pointerId; startY = e.clientY; startTop = el.scrollTop;
    thumb.classList.add('dragging');
    try{ thumb.setPointerCapture(e.pointerId); }catch(_){}
    e.stopPropagation();
  });
  thumb.addEventListener('pointermove', (e)=>{
    if(dragId !== e.pointerId) return;
    const dy = (typeof toLogicalDelta==='function') ? toLogicalDelta(0, e.clientY - startY).y : (e.clientY - startY);
    const h = el.clientHeight, sh = el.scrollHeight;
    const thumbH = thumb.offsetHeight, maxTop = h - thumbH;
    if(maxTop > 0) el.scrollTop = startTop + (dy / maxTop) * (sh - h);
    update();
    e.stopPropagation();
  });
  const end = (e)=>{ if(dragId===e.pointerId){ dragId = null; thumb.classList.remove('dragging'); } };
  thumb.addEventListener('pointerup', end);
  thumb.addEventListener('pointercancel', end);
}

// メニュー(初期画面): ステータスの右に並べる3ボタン
const MM_MENU_ITEMS = [
  { tab:'info',     icon:'📊', label:'詳細情報',     desc:'ステ倍率・特性・状態変化・技の詳しいデータを見る' },
  { tab:'training', icon:'💪', label:'トレーニング', desc:'チケットを使ってステータスを上げる' },
  { tab:'dressup',  icon:'👕', label:'着せ替え',     desc:'スキンを変更し見た目とオーラを変える' },
  // タブを開かずその場でシェア画面を出すので、tabではなくactionで区別する(転生ボタンと同じ形)
  { action:'share', icon:'<span class="share-ico"></span>', label:'SNSでシェア', desc:'このマスモンの育ち具合を画像にしてSNSへ投稿する' },
];
function buildMastermonMenuHtml(mm){
  const items = MM_MENU_ITEMS.map(m=>`
      <button class="mm-menu-btn" ${m.tab ? `data-tab="${m.tab}"` : `data-action="${m.action}"`}>
        <span class="mm-menu-btn-icon">${m.icon}</span>
        <span class="mm-menu-btn-text">
          <span class="mm-menu-btn-label">${m.label}</span>
          <span class="mm-menu-btn-desc">${m.desc}</span>
        </span>
      </button>`);
  // 転生ボタンはレベル100に到達したマスモンにだけ出す(着せ替えの下)
  if(canRebirthMastermon(mm)){
    items.push(`
      <button class="mm-menu-btn mm-menu-btn-rebirth" data-action="rebirth">
        <span class="mm-menu-btn-icon">✦</span>
        <span class="mm-menu-btn-text">
          <span class="mm-menu-btn-label">転生</span>
          <span class="mm-menu-btn-desc">レベル1に戻る代わりに上限・基礎値・適正が上がる(取り消せません)</span>
        </span>
      </button>`);
  }
  return `<div class="mm-menu-list">${items.join('')}</div>`;
}

/* =====================================================================
   転生(Lv100のマスモンを1から鍛え直して強化する不可逆システム)

   ・確認画面で「転生前」と「転生後」を並べて見比べ、適正を3つ選んでから実行する
   ・実行前のマスモンは REBIRTH_BACKUP_KEY に丸ごと保存し、管理者画面から
     元に戻せるようにしてある(動作確認用。プレイヤーからは触れない)
   ===================================================================== */
const REBIRTH_BACKUP_KEY = 'aramon_rebirth_backup_v1';
// 転生後に「各ステータス最大時」を見せるときの表示用ラベル
const REBIRTH_MULT_ROWS = [
  { key:'lifeMult',      label:'HP倍率',    hint:'高いほど良い' },
  { key:'dmgDealtMult',  label:'与ダメージ', hint:'高いほど良い' },
  { key:'dmgTakenMult',  label:'被ダメージ', hint:'低いほど良い' },
  { key:'gutsRegenMult', label:'ガッツ回復', hint:'高いほど良い' },
  { key:'cooldownMult',  label:'技の間隔',  hint:'低いほど良い' },
  { key:'speedMult',     label:'移動速度',  hint:'高いほど良い' },
];
let rebirthKey = null;          // 確認画面で対象にしているマスモンのキー
let rebirthPicks = [];          // 1段階上げる適正(ステータスキー)を最大3つ

// カードに出す転生回数の虹色★
function mmRebirthStarsHtml(mm){
  const n = mastermonRebirthCount(mm);
  if(n<=0) return '';
  return `<div class="ml-card-rebirth" title="転生${n}回">${'★'.repeat(Math.min(n, 10))}</div>`;
}
// マスモンの名前はプレイヤーが自由に付けられるので、HTMLへ差し込む前に無害化する
function rebirthEscape(t){
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function rebirthMultValue(mults, key){ return mults[key].toFixed(2); }
// 選ぶ適正の数。何度も転生して上げきると残りがSばかりになるので、
// 上げられる適正が3つ未満のときはその数に合わせる(選べなくて転生できない状態を作らない)
function rebirthPickTarget(mm){
  const apt = mastermonApt(mm);
  const upgradable = MASTERMON_STATS.filter(s=>!aptitudeIsMax(apt[s.key])).length;
  return Math.min(REBIRTH_APT_PICKS, upgradable);
}
// 「全ステータスが上限のとき」の姿。転生後の伸びしろを見せるために使う
function rebirthMaxedClone(mm){
  const cap = mastermonStatCap(mm);
  const stats = {};
  MASTERMON_STATS.forEach(s=>{ stats[s.key] = cap; });
  return Object.assign({}, mm, { stats });
}

// 比較画面の片側(カード + ステータス/適正の列)を組み立てる
function rebirthSideHtml(mm, opts){
  const el = ELEMENTS[mm.element];
  const eff = mmEffectiveStats(mm);
  const mults = mastermonEffectMults(mm);
  const apt = mastermonApt(mm);
  const cap = mastermonStatCap(mm);
  const beforeApt = opts.compareApt || null;   // 適正が変わった行を光らせるための比較元
  const multRows = REBIRTH_MULT_ROWS.map(r=>{
    const before = opts.compareMults ? opts.compareMults[r.key] : null;
    const up = before!=null && Math.abs(mults[r.key]-before) > 0.0005;
    return `<div class="rb-mult-row${up?' is-changed':''}">
      <span class="rb-mult-k">${r.label}</span>
      <span class="rb-mult-v">×${rebirthMultValue(mults, r.key)}</span>
    </div>`;
  }).join('');
  const statRows = MASTERMON_STATS.map(s=>{
    const v = mm.stats[s.key];
    const g = apt[s.key];
    const gChanged = beforeApt && beforeApt[s.key] !== g;
    return `<div class="rb-stat-row">
      <span class="rb-stat-k">${s.label}</span>
      <span class="rb-stat-apt mm-stat-apt-badge apt-${aptitudeCssKey(g)}${gChanged?' is-upgraded':''}">${g}</span>
      <span class="rb-stat-v">${v}<span class="rb-stat-cap">/${cap}</span></span>
      <span class="rb-stat-track"><span class="rb-stat-fill" style="width:${Math.round(v/cap*100)}%; background:${s.color};"></span></span>
    </div>`;
  }).join('');
  const stars = mastermonRebirthCount(mm)>0
    ? `<div class="rb-card-stars">${'★'.repeat(Math.min(mastermonRebirthCount(mm),10))}</div>` : '';
  return `
    <div class="rb-side ${opts.sideClass}">
      <div class="rb-side-title">${opts.title}</div>
      <div class="rb-side-body">
        <div class="rb-card">
          ${stars}
          <div class="rb-card-art">${equippedIconImgTag(mm.element, el.label)}</div>
          <div class="rb-card-name"><span class="rb-card-nm">${rebirthEscape(mm.name)}</span><span class="rb-card-lv">Lv.${mm.level}</span></div>
          <div class="rb-card-figs">
            <div class="rb-card-fig"><span class="rb-card-fig-k">HP</span><span class="rb-card-fig-v">${eff.hp}</span></div>
            <div class="rb-card-fig"><span class="rb-card-fig-k">速さ</span><span class="rb-card-fig-v">${eff.speed}</span></div>
          </div>
          <div class="rb-mult-list">${multRows}</div>
        </div>
        <div class="rb-stats">
          <div class="rb-stats-title">ステータス / 適正</div>
          ${statRows}
          <div class="rb-tickets">🎫 トレーニングチケット ${mm.tickets||0}枚</div>
        </div>
      </div>
      ${opts.extraHtml||''}
    </div>`;
}

// 「全ステータス最大時」のまとめ(転生後の側にだけ出す)
function rebirthMaxedHtml(afterMm){
  const maxed = rebirthMaxedClone(afterMm);
  const eff = mmEffectiveStats(maxed);
  const mults = mastermonEffectMults(maxed);
  const rows = REBIRTH_MULT_ROWS.map(r=>`
    <div class="rb-mult-row"><span class="rb-mult-k">${r.label}</span><span class="rb-mult-v">×${rebirthMultValue(mults, r.key)}</span></div>`).join('');
  return `
    <div class="rb-maxed">
      <div class="rb-maxed-title">全ステータス最大(${mastermonStatCap(afterMm)})まで育てたとき</div>
      <div class="rb-maxed-figs">
        <div class="rb-card-fig"><span class="rb-card-fig-k">HP</span><span class="rb-card-fig-v">${eff.hp}</span></div>
        <div class="rb-card-fig"><span class="rb-card-fig-k">速さ</span><span class="rb-card-fig-v">${eff.speed}</span></div>
      </div>
      <div class="rb-mult-list">${rows}</div>
    </div>`;
}

// 適正を3つ選ぶピッカー(選んだぶんだけ1段階上がる)
function rebirthPickerHtml(mm){
  const apt = mastermonApt(mm);
  const btns = MASTERMON_STATS.map(s=>{
    const g = apt[s.key];
    const next = aptitudeUpgrade(g);
    const on = rebirthPicks.indexOf(s.key)>=0;
    const maxed = aptitudeIsMax(g);   // 最上位(M)まで行ったらもう上げられない
    return `<button class="rb-pick-btn${on?' is-on':''}${maxed?' is-max':''}" data-stat="${s.key}"${maxed?' disabled':''}>
      <span class="rb-pick-label">${s.label}</span>
      <span class="rb-pick-grade"><span class="mm-stat-apt-badge apt-${aptitudeCssKey(g)}">${g}</span>${maxed?'':`<span class="rb-pick-arrow">▶</span><span class="mm-stat-apt-badge apt-${aptitudeCssKey(next)}">${next}</span>`}</span>
    </button>`;
  }).join('');
  const need = rebirthPickTarget(mm);
  return `
    <div class="rb-picker">
      <div class="rb-picker-title">上げる適正を${need}つ選ぶ<span class="rb-picker-count">${rebirthPicks.length}/${need}</span></div>
      <div class="rb-picker-grid">${btns}</div>
      <div class="rb-sbonus">
        <div class="rb-sbonus-title">✦ S以上の適正ボーナス</div>
        <div class="rb-sbonus-text">適正Aの上は<b>${APTITUDE_ORDER.slice(5).join(' → ')}</b>と伸び、
        <b>${APTITUDE_ORDER[APTITUDE_ORDER.length-1]}</b>が最上位です。上の段階ほどトレーニングの上がり幅が大きく
        (S ×${APTITUDE_TRAIN_MULT.S} → M ×${APTITUDE_TRAIN_MULT.M})、同じ値でも<b>倍率の伸びが良くなります</b>
        (S 約${Math.round((1/APTITUDE_FACTOR_DIVISOR_MULT.S-1)*100)}% → M 約${Math.round((1/APTITUDE_FACTOR_DIVISOR_MULT.M-1)*100)}%)。
        上がりやすく、上がったぶんもよく効く二重の得です。</div>
      </div>
    </div>`;
}

function rebirthBenefitLines(beforeMm, afterMm){
  const apt0 = mastermonApt(beforeMm), apt1 = mastermonApt(afterMm);
  const aptLines = MASTERMON_STATS.filter(s=>apt0[s.key]!==apt1[s.key])
    .map(s=>`適正 ${s.label} ${apt0[s.key]} → <b>${apt1[s.key]}</b>`);
  return [
    `ステータス上限 ${mastermonStatCap(beforeMm)} → <b>${mastermonStatCap(afterMm)}</b>`,
    `基礎HP <b>+${REBIRTH_BASE_HP_BONUS}</b> ／ 基礎移動速度 <b>+${REBIRTH_BASE_SPEED_BONUS}</b>`,
    `トレーニングチケット <b>+${REBIRTH_TICKETS}枚</b>(${beforeMm.tickets||0} → ${afterMm.tickets||0}枚)`,
  ].concat(aptLines).concat([
    `レベル ${beforeMm.level} → <b>1</b>(ステータスは転生前の1/3から再スタート)`,
    `転生回数 <b>★${mastermonRebirthCount(afterMm)}</b>`,
  ]);
}

function renderRebirthOverlay(){
  const data = loadMastermons();
  const mm = data[rebirthKey];
  const box = document.getElementById('rebirthScroll');
  if(!mm || !box) return;
  const after = rebirthMastermonResult(mm, rebirthPicks);
  const beforeMults = mastermonEffectMults(mm);
  box.innerHTML = `
    ${rebirthPickerHtml(mm)}
    <div class="rb-compare">
      ${rebirthSideHtml(mm, { title:'転生前', sideClass:'rb-side-before' })}
      <div class="rb-arrow">➡</div>
      ${rebirthSideHtml(after, { title:'転生後', sideClass:'rb-side-after',
        compareMults: beforeMults, compareApt: mastermonApt(mm), extraHtml: rebirthMaxedHtml(after) })}
    </div>
    <div class="rb-warn">⚠ 転生は取り消せません。レベルとステータスは戻りません。</div>`;
  box.querySelectorAll('.rb-pick-btn').forEach(b=>{
    b.addEventListener('click', ()=>{
      const k = b.dataset.stat;
      const need = rebirthPickTarget(mm);
      const i = rebirthPicks.indexOf(k);
      if(i>=0) rebirthPicks.splice(i,1);
      else if(rebirthPicks.length < need) rebirthPicks.push(k);
      else { pushToast(`適正は${need}つまでです`); return; }
      renderRebirthOverlay();
    });
  });
  const ok = document.getElementById('rebirthConfirmBtn');
  const need = rebirthPickTarget(mm);
  const ready = rebirthPicks.length === need;
  ok.disabled = !ready;
  ok.textContent = ready ? '✦ 転生する' : `適正を${need}つ選んでください`;
  attachVisibleScrollbar(box, document.getElementById('rebirthScrollbar'));
}

function openRebirthOverlay(key){
  const mm = loadMastermons()[key];
  if(!mm) return;
  if(!canRebirthMastermon(mm)){ pushToast(`レベル${REBIRTH_LEVEL_REQ}になると転生できます`); return; }
  rebirthKey = key;
  rebirthPicks = [];
  // 転生を実行するころには読み終わっているよう、確認画面を開いた時点で音声を取りに行く
  if(typeof ensureRebirthSeBuffer==='function') ensureRebirthSeBuffer();
  document.getElementById('rebirthOverlay').classList.remove('hidden');
  renderRebirthOverlay();
}
function closeRebirthOverlay(){
  document.getElementById('rebirthOverlay').classList.add('hidden');
  rebirthKey = null;
  rebirthPicks = [];
}

// 転生前の状態を丸ごと保存する(管理者画面から戻せるように)
function saveRebirthBackup(key, mm){
  try{
    const all = JSON.parse(localStorage.getItem(REBIRTH_BACKUP_KEY)) || {};
    all[key] = { savedAt: Date.now(), mm: JSON.parse(JSON.stringify(mm)) };
    localStorage.setItem(REBIRTH_BACKUP_KEY, JSON.stringify(all));
  }catch(err){}
}
function loadRebirthBackups(){
  try{ return JSON.parse(localStorage.getItem(REBIRTH_BACKUP_KEY)) || {}; }catch(err){ return {}; }
}

function doRebirth(){
  const key = rebirthKey;
  const data = loadMastermons();
  const mm = data[key];
  if(!mm || !canRebirthMastermon(mm)) return;
  if(rebirthPicks.length !== rebirthPickTarget(mm)) return;
  const before = JSON.parse(JSON.stringify(mm));
  const after = rebirthMastermonResult(mm, rebirthPicks);
  saveRebirthBackup(key, before);          // 動作確認用に転生前を保存(ロールバック用)
  data[key] = after;
  saveMastermons(data);
  closeRebirthOverlay();
  playRebirthAnim(key, before, after);
}

/* 転生アニメーション。おおまかな流れ(合計 REBIRTH_ANIM_MS):
   ①暗転して魔法陣が広がる ②光の粒が立ち上る ③閃光 ④生まれ変わった姿が現れる
   ⑤恩恵の一覧が1行ずつ出る。閉じるとマスモン画面へ戻る                            */
const REBIRTH_ANIM_MS = 8500;   // audio/rebirth_audio.mp3 と同じ尺。CSSのキーフレームも同じ
const REBIRTH_POP_START_MS = 3400;  // 恩恵が飛び出し始める時刻(閃光と判子のあと)
const REBIRTH_POP_STEP_MS  = 380;   // 次の恩恵が飛び出すまでの間隔
// 恩恵が飛び出す向き(モンスターの中心から見た角度と距離)。画面下はダイアログが
// あるので使わず、左右へ大きく振って横幅いっぱいに散らす。左右を交互に出すと
// 続けて出たときに重なりにくく、画面全体が使われて見える。
const REBIRTH_POP_SLOTS = [
  { a:-160, d:1.00 }, { a: -20, d:1.00 },
  { a:-136, d:0.86 }, { a: -44, d:0.86 },
  { a:-175, d:0.92 }, { a:  -5, d:0.92 },
  { a:-112, d:0.70 }, { a: -68, d:0.70 },
  { a:-148, d:1.05 }, { a: -32, d:1.05 },
  { a:-168, d:0.62 }, { a: -12, d:0.62 },
];
// 飛び出す金文字の中身(値+ラベル)。ダイアログの明細より短く、ひと目で分かるものだけ
function rebirthPopItems(beforeMm, afterMm){
  const apt0 = mastermonApt(beforeMm), apt1 = mastermonApt(afterMm);
  const items = [
    { v:'+'+(mastermonStatCap(afterMm)-mastermonStatCap(beforeMm)), k:'ステ上限' },
    { v:'+'+REBIRTH_BASE_HP_BONUS,    k:'基礎HP' },
    { v:'+'+REBIRTH_BASE_SPEED_BONUS, k:'基礎速さ' },
    { v:'+'+REBIRTH_TICKETS,          k:'🎫チケット' },
  ];
  MASTERMON_STATS.forEach(st=>{
    if(apt0[st.key]!==apt1[st.key]) items.push({ v:apt1[st.key], k:st.label+'適正' });
  });
  items.push({ v:'★'+mastermonRebirthCount(afterMm), k:'転生' });
  return items;
}
function playRebirthAnim(key, before, after){
  const ov = document.getElementById('rebirthAnimOverlay');
  if(!ov){ afterRebirthRefresh(key); return; }
  document.getElementById('rebirthAnimMonster').innerHTML = equippedIconImgTag(after.element, ELEMENTS[after.element].label);
  document.getElementById('rebirthAnimName').innerHTML = `${rebirthEscape(after.name)}<span class="rb-res-stars">${'★'.repeat(Math.min(mastermonRebirthCount(after),10))}</span>`;

  // モンスターから飛び出す金文字の中身を先に作っておく(位置はこのあと実寸から決める)
  const popHost = document.getElementById('rebirthAnimPops');
  popHost.innerHTML = rebirthPopItems(before, after).map(it=>
    `<div class="rb-pop"><span class="rb-pop-v">${it.v}</span><span class="rb-pop-k">${it.k}↑</span></div>`).join('');

  // 明細はダイアログがせり上がったあと(CSSのrbResultが46%地点)から1行ずつ出す
  const list = document.getElementById('rebirthAnimBenefits');
  const lines = rebirthBenefitLines(before, after);
  const base = Math.round(REBIRTH_ANIM_MS*0.48);
  const step = Math.min(320, Math.max(120, Math.round(1800/Math.max(1,lines.length))));
  list.innerHTML = lines.map((t,i)=>`<li style="animation-delay:${base + i*step}ms">${t}</li>`).join('');

  ov.className = 'rb-anim-run';   // hiddenを外す。display切替でCSSアニメーションが頭から再生される
  void ov.offsetWidth;
  startRebirthPops(popHost);      // 表示してから実寸を測る(hiddenのままだと0になる)
  // 専用の音声。未ロードなら合成SEで代用する(音が完全に無い状態は作らない)
  if(typeof playRebirthSe!=='function' || !playRebirthSe()) playSe('godRising');
  afterRebirthRefresh(key);   // 裏で画面の中身を新しい状態にしておく
}
/* 金文字を1つずつ違う向きへ飛ばす。向きが個別なのでCSSのキーフレームではなく
   Web Animations API で動かす(キーフレーム内で var() を使う書き方は、
   このプロジェクトの他の52個の演出と揃えるため使っていない)。
   飛距離はステージの実寸から出すので、画面比が変わっても破綻しない。          */
function startRebirthPops(popHost){
  const stage = document.getElementById('rebirthAnimStage');
  // 横と縦で別々の基準にする。横長の画面なので、まとめて短い方(=高さ)に合わせると
  // 中央にかたまって窮屈に見える。横は画面幅いっぱいまで使って大きく散らす。
  const unitX = Math.max(60, (stage.clientWidth  || 0) * 0.40);
  const unitY = Math.max(40, (stage.clientHeight || 0) * 0.34);
  popHost.querySelectorAll('.rb-pop').forEach((el, i)=>{
    const slot = REBIRTH_POP_SLOTS[i % REBIRTH_POP_SLOTS.length];
    const rad = slot.a*Math.PI/180;
    const dx = Math.cos(rad)*unitX*slot.d, dy = Math.sin(rad)*unitY*slot.d;
    const delay = REBIRTH_POP_START_MS + i*REBIRTH_POP_STEP_MS;
    const at = (fx, fy, sc, op) =>
      ({ transform:`translate(calc(-50% + ${(dx*fx).toFixed(1)}px), calc(-50% + ${(dy*fy).toFixed(1)}px)) scale(${sc})`, opacity:op });
    // element.animate が無い環境では、動かさずその場に出して消すだけにする(無表示にはしない)
    if(typeof el.animate !== 'function'){
      setTimeout(()=>{ el.style.opacity = '1'; }, delay);
      setTimeout(()=>{ el.style.opacity = '0'; }, delay+1900);
      return;
    }
    el.animate([
      Object.assign(at(0,    0,    0.3,  0), { offset:0 }),
      Object.assign(at(0.45, 0.45, 1.18, 1), { offset:0.18 }),
      Object.assign(at(0.6,  0.6,  1,    1), { offset:0.30 }),
      Object.assign(at(1,    1,    1,    1), { offset:0.72 }),
      Object.assign(at(1.12, 1.22, 0.96, 0), { offset:1 }),
    ], { duration:1900, delay, easing:'cubic-bezier(.15,1.3,.4,1)', fill:'both' });
  });
}
function closeRebirthAnim(){
  const ov = document.getElementById('rebirthAnimOverlay');
  if(!ov) return;
  ov.className = 'hidden';
  document.getElementById('rebirthAnimMonster').innerHTML = '';
  document.getElementById('rebirthAnimPops').innerHTML = '';
}
// 転生後にマスモン画面の表示を作り直す。
// レベルが100→1に変わると並び順(レベル降順)も変わるので、カードは作り直しが必要。
function afterRebirthRefresh(key){
  mastermonDetailKey = key;
  mastermonDetailTab = null;
  mastermonSelectedTraining = null;
  mmCarousel.build();
  mmCarousel.reset(key);
  renderMastermonCard(key, null);
  renderMastermonDetail(key);
  renderSelectorCards();
}

/* --- 管理者画面: 転生ロールバック(動作確認用) ---
   転生は本来やり直せないが、確認のあいだは何度でも試せるように、転生前の状態を
   端末に保存しておいて元に戻せるようにしてある。開くたびに一覧を作り直す。 */
let adminRebirthPick = null;
function buildAdminRebirthMenu(){
  const wrap = document.getElementById('adminRebirthWrap');
  const menu = document.getElementById('adminRebirthMenu');
  const btn  = document.getElementById('adminRebirthBtn');
  if(!wrap || !menu || !btn) return;
  const backups = loadRebirthBackups();
  const data = loadMastermons();
  const keys = Object.keys(backups).filter(k=>data[k]);   // 削除済みのマスモンは対象外
  menu.innerHTML = keys.length
    ? keys.map(k=>{
        const b = backups[k], mm = b.mm;
        const d = new Date(b.savedAt||0);
        const stamp = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        return `<div class="custom-select-item" data-key="${k}">${rebirthEscape(mm.name)}(${ELEMENTS[k]?ELEMENTS[k].label:k}) Lv.${mm.level} ／ ${stamp}</div>`;
      }).join('')
    : '<div class="custom-select-group">保存された転生前の状態はありません</div>';
  // 一覧を作り直したので選択は解除する(消えた項目を選んだままにしない)
  adminRebirthPick = null;
  btn.textContent = '戻すマスモンを選ぶ';
  updateAdminRebirthBtn();
  if(wrap.dataset.built) return;
  wrap.dataset.built = '1';
  btn.addEventListener('click', (e)=>{ e.stopPropagation(); menu.classList.toggle('hidden'); });
  menu.addEventListener('click', (e)=>{
    const item = e.target.closest('.custom-select-item');
    if(!item || !item.dataset.key) return;
    e.stopPropagation();
    menu.querySelectorAll('.custom-select-item').forEach(i=>i.classList.remove('active'));
    item.classList.add('active');
    adminRebirthPick = item.dataset.key;
    btn.textContent = item.textContent;
    menu.classList.add('hidden');
    updateAdminRebirthBtn();
  });
}
function updateAdminRebirthBtn(){
  const b = document.getElementById('adminRebirthRollbackBtn');
  if(!b) return;
  b.disabled = !adminRebirthPick;
  b.textContent = adminRebirthPick ? '🔁 このマスモンを転生前に戻す' : '🔁 転生前に戻す';
}
document.getElementById('adminRebirthRollbackBtn').addEventListener('click', ()=>{
  if(!adminRebirthPick) return;
  const backups = loadRebirthBackups();
  const entry = backups[adminRebirthPick];
  const data = loadMastermons();
  if(!entry || !entry.mm || !data[adminRebirthPick]){ pushToast('戻せる状態が見つかりません'); buildAdminRebirthMenu(); return; }
  const key = adminRebirthPick;
  data[key] = JSON.parse(JSON.stringify(entry.mm));
  saveMastermons(data);
  // 何度でも転生を試せるよう、戻したあとも保存は消さない
  pushToast(`${data[key].name} を転生前(Lv.${data[key].level})に戻しました`);
  if(typeof renderSelectorCards==='function') renderSelectorCards();
  // マスモンの詳細を開いている最中だけ画面を作り直す(閉じているなら次に開いたときに新しくなる)
  const detail = document.getElementById('mmDetailView');
  if(detail && !detail.classList.contains('hidden')) afterRebirthRefresh(key);
  buildAdminRebirthMenu();
});

document.getElementById('rebirthCloseBtn').addEventListener('click', closeRebirthOverlay);
document.getElementById('rebirthCancelBtn').addEventListener('click', closeRebirthOverlay);
document.getElementById('rebirthConfirmBtn').addEventListener('click', doRebirth);
document.getElementById('rebirthAnimCloseBtn').addEventListener('click', closeRebirthAnim);

function openMastermonScreen(fromResult){
  const data = loadMastermons();
  const keys = Object.keys(data);
  const noticeEl = document.getElementById('mastermonNotice');
  if(keys.length===0){
    noticeEl.textContent = 'マスモンがいません。チャンピオンを取ってマスモン登録しよう！';
    noticeEl.classList.remove('hidden');
    clearTimeout(mastermonNoticeTimer);
    mastermonNoticeTimer = setTimeout(()=>noticeEl.classList.add('hidden'), 3200);
    return;
  }
  noticeEl.classList.add('hidden');
  mastermonOpenedFrom = fromResult ? 'result' : 'title';
  if(!mastermonDetailKey || !data[mastermonDetailKey]) mastermonDetailKey = keys[0];
  mastermonSelectedTraining = null;
  mastermonPreviewSkin = null;
  mastermonDetailTab = null;
  mmCarousel.build();
  mmCarousel.reset(game.selectedMastermonKey && data[game.selectedMastermonKey] ? game.selectedMastermonKey : mastermonDetailKey);
  document.getElementById('mmDetailView').classList.add('hidden');
  document.getElementById('mmCarouselView').classList.remove('hidden');
  document.getElementById('mastermonScreen').classList.remove('hidden');
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('resultScreen').classList.add('hidden');
}
let mastermonNoticeTimer = null;
document.getElementById('closeMastermonBtn').addEventListener('click', ()=>{
  mmCarousel.stopAnim();
  document.getElementById('mastermonScreen').classList.add('hidden');
  if(game.trainingRange){ /* 射撃訓練場から開いた場合はそのまま訓練場へ戻る */ }
  else if(mastermonOpenedFrom==='result'){
    document.getElementById('resultScreen').classList.remove('hidden');
  } else {
    document.getElementById('startScreen').classList.remove('hidden');
  }
});
document.getElementById('viewMastermonBtn').addEventListener('click', ()=>openMastermonScreen(true));

let mastermonPendingDeleteKey = null;
document.getElementById('mastermonDeleteNoBtn').addEventListener('click', ()=>{
  document.getElementById('mastermonDeleteConfirm').classList.add('hidden');
  mastermonPendingDeleteKey = null;
});
document.getElementById('mastermonDeleteYesBtn').addEventListener('click', ()=>{
  if(!mastermonPendingDeleteKey) return;
  const deletedKey = mastermonPendingDeleteKey;
  deleteMastermon(deletedKey);
  mastermonPendingDeleteKey = null;
  document.getElementById('mastermonDeleteConfirm').classList.add('hidden');
  if(game.selectedMastermonKey===deletedKey){
    game.selectedMastermonKey = null;
    game.selectedElement = null;
    updatePlayButtonsEnabled();
  }
  renderSelectorCards();
  pushToast('マスモンを削除しました');
  const remaining = Object.keys(loadMastermons());
  if(remaining.length===0){
    document.getElementById('mastermonScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
    return;
  }
  if(mastermonDetailKey===deletedKey) mastermonDetailKey = remaining[0];
  mastermonSelectedTraining = null;
  mastermonPreviewSkin = null;
  mastermonDetailTab = null;
  mmCarousel.build();
  mmCarousel.reset(mastermonDetailKey);
  closeMastermonDetail();   // 消したマスモンの詳細に留まらないよう一覧へ戻す
});

function renderMastermonDetail(key){
  const data = loadMastermons();
  const mm = data[key];
  const el = ELEMENTS[key];
  const apt = mastermonApt(mm);   // 転生で上がった適正があればそちらを出す
  const panel = document.getElementById('mastermonDetailPanel');
  panel.classList.remove('hidden');

  // フッターの参戦ボタンは常設なので、選択中のマスモンに応じてハンドラを差し替える
  document.getElementById('mastermonUseBtn').onclick = ()=>{
    game.selectedElement = key;
    game.selectedMastermonKey = key;
    saveLobbyPrefs();
    updatePlayButtonsEnabled();
    mmCarousel.stopAnim();
    document.getElementById('mastermonScreen').classList.add('hidden');
    if(game.trainingRange) rangeApplyMonsterChange();   // 訓練場では即その場で乗り換える
    else document.getElementById('startScreen').classList.remove('hidden');
    renderSelectorCards();
    pushToast(`${mm.name} で参戦準備完了`);
  };

  // 再描画でDOMが作り直されるとスクロール位置が失われるため、事前に保存しておく
  const prevStatsCol = panel.querySelector('.ml-sec-status');
  const prevContent = panel.querySelector('.mm-subview-content');
  const savedStatsScroll = prevStatsCol ? prevStatsCol.scrollTop : 0;
  const savedContentScroll = prevContent ? prevContent.scrollTop : 0;

  const preview = (mastermonDetailTab==='training' && mastermonSelectedTraining) ? previewMastermonTraining(mm, mastermonSelectedTraining) : null;
  // 着せ替え画面のみステータス列を表示しない(プレビューを大きく取るため)。
  // それ以外はモンスター一覧と同じSTATUSセクション(バー+説明2行)にそろえる
  // 着せ替え(プレビューを大きく取る)と詳細情報(グリッド内にSTATUSを含む)は左の列を出さない
  const statsColHtml = (mastermonDetailTab==='dressup' || mastermonDetailTab==='info')
    ? '' : caroStatusSecHtml(mm, apt, preview, '育成後 / 適正');

  const TAB_TITLES = { info:'詳細情報', training:'トレーニング', edit:'マスモン編集', dressup:'着せ替え' };
  let contentHtml;
  if(mastermonDetailTab==='training') contentHtml = buildMastermonTrainingHtml(mm);
  else if(mastermonDetailTab==='edit') contentHtml = buildMastermonEditHtml(mm);
  else if(mastermonDetailTab==='dressup') contentHtml = buildMastermonSkinHtml(key);
  else if(mastermonDetailTab==='info') contentHtml = buildMastermonInfoHtml(key, mm, el);
  else contentHtml = buildMastermonMenuHtml(mm);  // 初期はメニュー(Lv100なら転生も並ぶ)

  // トレーニング画面では実行ボタンをヘッダー右に置く。ヘッダーはステータスの上まで
  // 全幅で伸ばす(モンスター一覧の画面と同じ形)。タブを開いているときだけ戻るボタンを出す
  const trainExecBtnHtml = mastermonDetailTab==='training' ? `
      <button id="mastermonExecuteTrainBtn" class="mastermon-execute-btn mm-header-exec-btn" ${(!mastermonSelectedTraining||mm.tickets<=0)?'disabled':''}>トレ実行🎫${mm.tickets}枚</button>` : '';
  const headerHtml = `
    <div class="mm-subview-header">
      <div class="mm-subview-title">${mm.name}<span class="mm-subview-sub">Lv.${mm.level}${mastermonDetailTab?` ／ ${TAB_TITLES[mastermonDetailTab]}`:''}</span></div>
      ${trainExecBtnHtml}
      ${mastermonDetailTab ? '<button class="mm-back-btn">← 戻る</button>' : ''}
    </div>`;

  panel.innerHTML = `
    ${headerHtml}
    <div class="mastermon-detail-body">
      ${statsColHtml}
      <div class="mastermon-detail-maincol">
        <div class="mm-content-wrap">
          <div class="mm-subview-content">${contentHtml}</div>
          <div class="mm-scrollbar hidden"><div class="mm-scrollbar-thumb"></div></div>
        </div>
      </div>
    </div>`;

  const statsColEl = panel.querySelector('.ml-sec-status');
  const contentEl = panel.querySelector('.mm-subview-content');
  if(statsColEl) statsColEl.scrollTop = savedStatsScroll;
  if(contentEl) contentEl.scrollTop = savedContentScroll;
  attachVisibleScrollbar(contentEl, panel.querySelector('.mm-scrollbar'));

  mmSyncTabButtons();

  if(!mastermonDetailTab){
    panel.querySelectorAll('.mm-menu-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(btn.dataset.action==='rebirth'){ openRebirthOverlay(key); return; }
        if(btn.dataset.action==='share'){
          const s = buildMastermonShare(key);
          if(s) openShareOverlay(s.spec, s.text); else pushToast('このマスモンをシェアできませんでした');
          return;
        }
        mmOpenTab(btn.dataset.tab);
      });
    });
    return;
  }
  const backBtn = panel.querySelector('.mm-back-btn');
  if(backBtn) backBtn.addEventListener('click', ()=>{
    mastermonDetailTab = null;
    mastermonSelectedTraining = null;
    mastermonPreviewSkin = null;
    renderMastermonDetail(key);
  });

  if(mastermonDetailTab==='edit'){
    document.getElementById('mastermonRenameBtn').addEventListener('click', ()=>{
      const newName = document.getElementById('mastermonRenameInput').value.trim();
      if(!newName){ pushToast('名前を入力してください'); return; }
      mm.name = newName;
      data[key] = mm;
      saveMastermons(data);
      renderMastermonList();      // 一覧のカルーセルのカード
      renderMastermonCard(key);   // 詳細ビュー左のカード(cloneなので作り直さないと古い名前のまま)
      renderSelectorCards();
      renderMastermonDetail(key);
      pushToast('名前を変更しました');
    });
    document.getElementById('mastermonEditDeleteBtn').addEventListener('click', ()=>{
      mastermonPendingDeleteKey = key;
      document.getElementById('mastermonDeleteText').textContent = `${mm.name}とお別れします。いいですか？`;
      document.getElementById('mastermonDeleteConfirm').classList.remove('hidden');
    });
  }

  if(mastermonDetailTab==='training'){
    panel.querySelectorAll('.mm-train-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        mastermonSelectedTraining = (mastermonSelectedTraining===btn.dataset.key) ? null : btn.dataset.key;
        renderMastermonDetail(key);
      });
    });
    document.getElementById('mastermonExecuteTrainBtn').addEventListener('click', ()=>{
      if(!mastermonSelectedTraining) return;
      const changes = applyMastermonTraining(mm, mastermonSelectedTraining);
      if(!changes) return;
      data[key] = mm;
      saveMastermons(data);
      const parts = Object.keys(changes).map(k=>{
        const label = MASTERMON_STATS.find(s=>s.key===k).label;
        const v = changes[k];
        return `${label}${v>0?'+':''}${v}`;
      });
      pushToast(`トレーニング結果: ${parts.join(' / ')}`);
      playSe('train');
      mastermonSelectedTraining = null;
      renderMastermonList();
      renderMastermonCard(key);   // 詳細ビュー左の大きいカードもHP/速さを即反映(cloneなので作り直さないと古い数値のまま)
      renderMastermonDetail(key);
    });
  }

  if(mastermonDetailTab==='dressup'){
    panel.querySelectorAll('.mm-skin-thumb').forEach(thumb=>{
      thumb.addEventListener('click', ()=>{
        mastermonPreviewSkin = thumb.dataset.skin; // '' はデフォルト(nullにするとデフォルト選択が未初期化扱いになり戻せない)
        renderMastermonDetail(key);
      });
    });
    const confirmBtn = document.getElementById('mmSkinConfirmBtn');
    if(confirmBtn) confirmBtn.addEventListener('click', ()=>{
      setEquippedSkin(key, mastermonPreviewSkin || null);
      renderMastermonList();       // 一覧のカード(画像・オーラ色・光沢)を作り直す
      renderMastermonCard(key);    // 詳細の大きいカードも同時に差し替える
      renderSelectorCards();
      renderMastermonDetail(key);
      pushToast(mastermonPreviewSkin ? 'スキンを着せ替えました' : 'デフォルトに戻しました');
      playSe('pickup');
    });
  }
}

// 「着せ替え」画面: 大きなプレビュー + 所持スキンのサムネイル行(ステータスは非表示)
let mastermonPreviewSkin = null; // null=このマスモンのプレビュー未初期化
function skinPreviewImgTag(element, skinId){
  // skinId が null/'' ならデフォルト(素のアイコン画像)
  if(!skinId){ return `<img src="${imgSrcFor(`monsters/${element}`)}" onerror="handleMonsterImgError(this,'monsters/${element}')" alt="">`; }
  const url = skinnedIconDataUrl(skinId);
  if(url) return `<img src="${url}" alt="">`;
  return `<img src="${imgSrcFor(`monsters/${element}`)}" onerror="handleMonsterImgError(this,'monsters/${element}')" alt="">`;
}
// 後ろ姿(試合中の姿)プレビュー
function skinBackImgTag(element, skinId){
  if(!skinId){ return `<img src="${imgSrcFor(`monsters/${element}_player`)}" data-ext-idx="0" onerror="handleMonsterImgError(this,'monsters/${element}_player')" alt="">`; }
  const url = skinnedPlayerDataUrl(skinId);
  if(url) return `<img src="${url}" alt="">`;
  return `<img src="${imgSrcFor(`monsters/${element}_player`)}" data-ext-idx="0" onerror="handleMonsterImgError(this,'monsters/${element}_player')" alt="">`;
}
function buildMastermonSkinHtml(key){
  const owned = ownedSkinsForElement(key);       // 所持スキンID一覧
  const equipped = getEquippedSkin(key);
  // 画面を開くたびに装備中スキンをプレビュー初期値にする
  if(mastermonPreviewSkin === null) mastermonPreviewSkin = equipped || '';
  const previewSkin = mastermonPreviewSkin || null;
  const previewName = previewSkin ? skinMeta(previewSkin).name : `${ELEMENTS[key].label}(デフォルト)`;
  // デフォルト + 所持スキンのサムネイル(左側の縦一覧)
  const thumbs = [{ id:'', cls:'' }].concat(owned.map(id=>({ id, cls: skinMeta(id).rarity==='SSR'?'ssr':'' })));
  const listHtml = thumbs.map(t=>{
    const sel = ((mastermonPreviewSkin||'')===t.id) ? 'selected' : '';
    const eq = ((equipped||'')===t.id) ? 'equipped' : '';
    return `<div class="mm-skin-thumb ${t.cls} ${sel} ${eq}" data-skin="${t.id}">${skinPreviewImgTag(key, t.id||null)}</div>`;
  }).join('');
  const isEquippedNow = ((equipped||'')===(mastermonPreviewSkin||''));
  return `
    <div class="mm-skin-body2">
      <div class="mm-skin-list">${listHtml}</div>
      <div class="mm-skin-main">
        <div class="mm-skin-previews">
          <div class="mm-skin-prev"><span class="mm-skin-prev-label">正面</span>${skinPreviewImgTag(key, previewSkin)}</div>
          <div class="mm-skin-prev"><span class="mm-skin-prev-label">後ろ</span>${skinBackImgTag(key, previewSkin)}</div>
        </div>
        <div class="mm-skin-preview-name">${previewName}</div>
        <button id="mmSkinConfirmBtn" class="mm-skin-confirm" ${isEquippedNow?'disabled':''}>${isEquippedNow?'着用中':'これに着せ替える'}</button>
      </div>
    </div>`;
}

// ステータス(ライフ・ちから等)バー: メニュー/詳細情報/技一覧/トレーニングの全画面で共通表示
function buildMastermonStatsColHtml(mm, apt, preview){
  const cap = mastermonStatCap(mm);   // 転生の回数ぶん上限が上がり、バーもそこまで伸びる
  const statsHtml = MASTERMON_STATS.map(s=>{
    const v = mm.stats[s.key];
    const delta = preview ? preview[s.key] : null;
    const resultVal = delta ? mastermonClampStat(v + delta, cap) : v;
    const pct = Math.round(resultVal/cap*100);
    // 表示する差分は上限で頭打ちにした「実際に動く量」にする。
    // 要求値をそのまま出すと、997に+25と書いてあるのに値は999、という食い違いになる
    const effDelta = resultVal - v;
    const deltaHtml = effDelta ? `<span class="mm-stat-delta ${effDelta>0?'up':'down'}">(${effDelta>0?'+':''}${effDelta})</span>` : '';
    const aptGrade = apt[s.key];
    return `
      <div class="mm-stat-row">
        <div class="mm-stat-toprow">
          <span class="mm-stat-name">${s.label}<span class="mm-stat-apt-badge apt-${aptitudeCssKey(aptGrade)}">${aptGrade}</span></span>
          <span class="mm-stat-val">${resultVal}${deltaHtml}</span>
        </div>
        <div class="mm-stat-track"><div class="mm-stat-fill" style="width:${pct}%; background:${s.color};"></div></div>
      </div>`;
  }).join('');
  return `<div class="mastermon-detail-statscol"><div class="mm-stats-wrap">${statsHtml}</div></div>`;
}

// 「マスモン編集」画面: 名前変更と削除
function buildMastermonEditHtml(mm){
  const safeName = String(mm.name).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  return `
    <div class="mm-edit-body">
      <div style="width:100%;">
        <div class="mm-edit-label">名前の変更</div>
        <div class="mm-edit-row">
          <input type="text" id="mastermonRenameInput" maxlength="10" value="${safeName}" placeholder="マスモンの名前">
          <button id="mastermonRenameBtn" class="mm-edit-rename-btn">名前を変更</button>
        </div>
      </div>
      <button id="mastermonEditDeleteBtn" class="mastermon-delete-btn">マスモンを削除</button>
    </div>`;
}


function mmFmtMult(v){ return `×${(Math.round(v*100)/100).toFixed(2)}`; }

// 「詳細情報」画面: ステータス倍率・特性・状態変化を縦一列に表示
function buildMastermonInfoHtml(key, mm, el){
  const mults = mastermonEffectMults(mm);
  const effHp = Math.round(el.hp*mults.lifeMult);
  const effSpeed = Math.round(el.speed*(el.speedMod||1)*mults.speedMult);
  const fireRateMult = 1/mults.cooldownMult;
  const dashDistance = Math.round((DASH_REF_SPEED*DASH_REF_SPEED*DASH_SPEED_MULT/Math.max(effSpeed,1))*DASH_DURATION);
  const sc = STATE_CHANGES[key];

  // mastermonStatFactor()はステータス100で1.0(=無補正)を返すため、1.0を基準に上昇/下降を判定する。
  // 被ダメ倍率だけは値が低いほど良い(被ダメが減る)ので判定を反転させる。
  const mmMultColorClass = (mult, invert)=>{
    if(Math.abs(mult-1) < 0.001) return '';
    const isUp = mult > 1;
    const good = invert ? !isUp : isUp;
    return good ? 'mm-info-val-up' : 'mm-info-val-down';
  };

  const statRows = [
    { label:'HP', val: effHp, cls: mmMultColorClass(mults.lifeMult, false) },
    { label:'移動速度', val: effSpeed, cls: mmMultColorClass(mults.speedMult, false) },
    { label:'ダッシュ距離', val: dashDistance, cls: mmMultColorClass(1/mults.speedMult, false) },
    { label:'技ダメ倍率', val: mmFmtMult(mults.dmgDealtMult), cls: mmMultColorClass(mults.dmgDealtMult, false) },
    { label:'被ダメ倍率', val: mmFmtMult(mults.dmgTakenMult), cls: mmMultColorClass(mults.dmgTakenMult, true) },
    { label:'連射速度倍率', val: mmFmtMult(fireRateMult), cls: mmMultColorClass(fireRateMult, false) },
    { label:'ガッツ回復速度倍率', val: mmFmtMult(mults.gutsRegenMult), cls: mmMultColorClass(mults.gutsRegenMult, false) },
  ].map(r=>`
    <div class="mm-info-row">
      <span class="mm-info-label">${r.label}</span>
      <span class="mm-info-val ${r.cls}">${r.val}</span>
    </div>`).join('');

  const stateHtml = sc ? `
    <div class="mm-info-state-card">
      <div class="mm-info-state-name">${sc.name}</div>
      <div class="mm-info-state-line">発動条件：${stateTriggerText(sc)}</div>
      <div class="mm-info-state-line">${stateDurationText(sc)}</div>
      <div class="mm-info-state-line">効果：${describeStateEffectsText(sc.effects)}</div>
    </div>` : '';

  // 2列 + 技を全幅で1つのグリッドに入れ、まとめてスクロールさせる
  //   ステータス   ステータス倍率
  //   特性         状態変化
  //   技(2列分)
  return `
    <div class="ml-info-cols mm-info-grid">
      ${caroStatusSecHtml(mm, mastermonApt(mm), null, '育成後 / 適正')}
      <div class="ml-sec">
        <div class="ml-sec-title">ステータス倍率</div>
        ${statRows}
      </div>
      <div class="ml-sec">
        <div class="ml-sec-title">特性</div>
        <div class="ml-trait-text">${TRAIT_DESC[el.trait]}</div>
      </div>
      <div class="ml-sec">
        <div class="ml-sec-title">状態変化</div>
        ${stateHtml}
      </div>
      <div class="ml-sec mm-info-moves">
        <div class="ml-sec-title">技</div>
        ${buildMastermonMovesHtml(key)}
      </div>
    </div>`;
}

// 技の見た目(aoe形状・連射・爆風など)から、簡易な特徴テキストを組み立てる
function describeMoveFeatureText(mv){
  const parts = [];
  if(mv.aoeShape==='fan') parts.push(`扇状(${mv.fanAngleDeg}°)に攻撃`);
  else if(mv.aoeShape==='rect') parts.push(`幅${mv.rectWidth}の直線状に攻撃`);
  else if(mv.aoeShape==='beams') parts.push(`${mv.beamCount}方向のビームで攻撃`);
  else if(mv.aoeShape==='zigzag') parts.push(`ジグザグ状(幅${mv.zigzagWidth})に攻撃`);
  else if(mv.aoeShape==='fanZigzag') parts.push('扇状かつジグザグに攻撃');
  if(mv.burst) parts.push(`${mv.burst}連射`);
  if(mv.splash) parts.push(`着弾時に半径${mv.splash}へ爆風`);
  if(mv.blast) parts.push(`直撃${mv.dmg}+着弾点から半径${mv.blast.radius}へドーム状の爆風${mv.blast.dmg}`);
  if(mv.endBlast) parts.push(`技の先端に半径${mv.endBlast.radius}の爆風ドーム×${mv.endBlast.count||3}(各${mv.endBlast.dmg})`);
  if(mv.warheads) parts.push(`黒い核弾頭${mv.warheads.count||1}発を発射し、直撃${mv.warheads.dmg}+着弾点から半径${mv.warheads.blast.radius}へドーム状の爆風${mv.warheads.blast.dmg}`);
  if(mv.gutsDrainRatio) parts.push(`与えたダメージの${Math.round(mv.gutsDrainRatio*100)}%ぶん相手のガッツを削る`);
  if(mv.growWithDistance) parts.push('飛距離が長いほど威力上昇');
  if(mv.closeBonusMax && mv.closeBonusMax>1) parts.push(`命中距離が近いほど威力上昇(最大+${Math.round((mv.closeBonusMax-1)*100)}%)`);
  if(mv.selfMoveWithProjectile) parts.push('発動中は技と同じ速度で自分も前進する移動技');
  if(mv.selfSpeedBuffOnHit) parts.push(`命中時 自分の移動速度${WARM_SHELL_SPEED_BUFF_MULT}倍(${WARM_SHELL_SPEED_BUFF_DURATION}秒間)`);
  if(mv.multiOrb) parts.push('赤青黄緑のオーラ球体を発射');
  if(!parts.length) parts.push('単体に直撃');
  return parts.join('・');
}

// 技に付随する特殊効果(ワームtier3の命中時スピードバフ等)の一言説明。無ければ空文字
function moveBonusEffectText(key){
  const mv = (SIGNATURE_MOVES[key]||[]).find(m=>m.selfSpeedBuffOnHit);
  if(!mv) return '';
  return `「${mv.name}」命中時 移動速度${WARM_SHELL_SPEED_BUFF_MULT}倍(${WARM_SHELL_SPEED_BUFF_DURATION}秒)`;
}

// 「技一覧」画面: tier毎の技情報(アイコン・威力・消費ガッツ・CT・弾速・射程・特徴)
// opts.ignoreSkin=true にすると装備スキンを一切見ないデフォルトの技を表示する
// (モンスター選択画面は素のモンスターを選ぶ画面なのでこちらを使う)
function buildMastermonMovesHtml(key, opts){
  const moves = SIGNATURE_MOVES[key] || [];
  const fallbackIcon = (moves.find(m=>m.icon) || {}).icon || '✨';
  const ignoreSkin = !!(opts && opts.ignoreSkin);
  const movesHtml = moves.map(baseMv=>{
    // 装備スキンでtier3が専用技(ちょこの「ヴァニッシュ」等)に変わる場合は解決後の性能を表示する。
    // ignoreSkin時は isPlayer:false + skinId:null にすることで entitySkinId() が null を返し、
    // getMoveAura / skinTier3Move / getMoveName / ssrTier3DmgMult がすべて既定値になる
    const pseudoForMove = ignoreSkin ? { element:key, isPlayer:false, skinId:null } : { element:key, isPlayer:true };
    const mv = (typeof skinTier3Move==='function') ? skinTier3Move(baseMv, pseudoForMove) : baseMv;
    const icon = mv.icon || fallbackIcon;
    // 技アイコンは該当オーラのアイコンを表示(tier3は装備SSRスキンで一致技に変わる)
    const dispAura = (typeof getMoveAura==='function') ? getMoveAura(mv, pseudoForMove) : mv.aura;
    const auraIcon = (dispAura && typeof AURA_EMOJI!=='undefined') ? AURA_EMOJI[dispAura] : icon;
    // combat.js の fireMove() と同じ計算: 範囲攻撃(aoeShape)は projSpeed が無くても
    // 予告表示の後、この速度でダメージ範囲が塗り広がっていく(瞬間発動ではない)
    const isAoe = !!mv.aoeShape;
    const speedVal = isAoe ? Math.max(200, mv.projSpeed||900) : mv.projSpeed;
    const speedText = isAoe ? `範囲拡大速度 ${speedVal}` : `弾速 ${speedVal}`;
    // tier3は装備SSRスキンで技名・威力が変わる(該当スキン装備時のみ)
    const pseudo = pseudoForMove;
    const dispName = (typeof getMoveName==='function') ? getMoveName(mv, pseudo) : mv.name;
    // 威力は「直撃+爆風」の合計を表示(ビッグバンのように威力の大半がblast側にある技で0表示にならないように)。
    // endBlastは重なった3つのドーム全部に当たった場合の合計(インフェルノ等)。
    // warheadsは核弾頭N発ぶんの「直撃+着弾ドーム」合計(ギガデストロイヤー)
    const baseDmg = mv.dmg + (mv.blast ? (mv.blast.dmg||0) : 0)
      + (mv.endBlast ? (mv.endBlast.dmg||0)*(mv.endBlast.count||1) : 0)
      + (mv.warheads ? ((mv.warheads.dmg||0) + (mv.warheads.blast ? mv.warheads.blast.dmg||0 : 0)) * (mv.warheads.count||1) : 0);
    const dispDmg = Math.round(baseDmg * ((typeof ssrTier3DmgMult==='function') ? ssrTier3DmgMult(mv, pseudo) : 1));
    return `
    <div class="mm-move-card">
      <div class="mm-move-tier-badge">TIER<br>${mv.tier}</div>
      <div class="mm-move-info">
        <div class="mm-move-name">${dispName}<span class="mm-move-icon">${auraIcon}</span></div>
        <div class="mm-move-stats">
          <span>威力 ${dispDmg}</span>
          <span>消費ガッツ ${mv.gutsCost}</span>
          <span>CT ${mv.cooldown}秒</span>
          <span>${speedText}</span>
          <span>射程 ${mv.range}</span>
        </div>
        <div class="mm-move-feature">${describeMoveFeatureText(mv)}</div>
      </div>
    </div>`;
  }).join('');
  return `<div class="mm-moves-list">${movesHtml}</div>`;
}

// 「トレーニング」画面: 従来のトレーニング一覧と同じ内容(ステータスバーは共通の左カラムに表示)
function buildMastermonTrainingHtml(mm){
  const trainingHtml = TRAINING_MENU.map(t=>`
    <button class="mm-train-btn ${t.key===mastermonSelectedTraining?'active':''}" data-key="${t.key}">
      <span class="mm-train-name">${t.label}</span>
    </button>`).join('');

  // ステータス説明はSTATUSセクションの下に常に出ているので、ここには置かない
  return `
    <div class="mastermon-detail-traincol">
      <div class="mm-train-title">トレーニング(選択で変動値をプレビュー)</div>
      <div class="mm-train-grid">${trainingHtml}</div>
    </div>`;
}

// マスモンのステータス倍率を任意のエンティティに適用する(プレイヤー本人にも、マルチプレイの
// マスモンbotにも共通で使う)
function applyMastermonStatsToEntity(ent, mm){
  if(!ent || !mm) return;
  const mults = mastermonEffectMults(mm);
  // 基礎値の加算(転生ぶん+基礎値アイテムぶん)は「倍率を掛ける前」に足す
  // (育成の倍率がそのまま乗るように)
  const rb = mastermonBaseBonus(mm);
  ent.maxHp = Math.round((ent.maxHp + rb.hp) * mults.lifeMult);
  ent.hp = ent.maxHp;
  ent.speed = (ent.speed + rb.speed) * mults.speedMult;
  ent.mastermonDmgDealtMult = mults.dmgDealtMult;
  ent.mastermonDmgTakenMult = mults.dmgTakenMult;
  ent.mastermonGutsRegenMult = mults.gutsRegenMult;
  ent.mastermonCooldownMult = mults.cooldownMult;
}
// バトル開始時、選択中のマスモンのステータス倍率をプレイヤーに適用
function applyMastermonToPlayer(){
  if(!game.selectedMastermonKey) return;
  const data = loadMastermons();
  const mm = data[game.selectedMastermonKey];
  applyMastermonStatsToEntity(player, mm);
  // ミューテーター「技tier2スタート」: 全員tier2からスタート(訓練場除く。非公開中は常にfalse)
  const mutTierActive = (typeof mutatorTierStartActive==='function') && mutatorTierStartActive() && !game.trainingRange;
  if(mutTierActive){
    player.moveTierUnlocked = Math.max(player.moveTierUnlocked||1, 2);
    player.moveTierSelected = 2;
  }
  // 技強化チケット: ストックがあれば1つ消費して技tier2解放でスタート
  // (ミューテーター発動中はさらに1段上がりtier3解放でスタート)
  if(mm && mm.nextMoveBoost > 0 && !game.trainingRange){   // 訓練場ではチケットを消費しない(最初から全解放)
    const bumpTier = mutTierActive ? 3 : 2;
    player.moveTierUnlocked = Math.max(player.moveTierUnlocked||1, bumpTier);
    player.moveTierSelected = bumpTier;
    mm.nextMoveBoost--;
    saveMastermons(data);
    pushToast(mutTierActive ? '⚔️ 技強化チケット発動！技tier3解放でスタート' : '⚔️ 技強化チケット発動！技tier2解放でスタート');
  }
}

// 試合終了後：マスモン使用時はEXP付与、未登録の種族でチャンピオンを取った場合は登録を促す
/* overrides.damage を渡すと、経験値の計算だけその値を使う。
   レイドは与ダメージの桁が通常の試合と違うので、釣り合わせた値を渡すために使う。 */
function handleMastermonPostMatch(isWin, overrides){
  const dmgForExp = (overrides && overrides.damage!=null) ? Math.round(overrides.damage) : Math.round(player.damageDealt);
  const infoEl = document.getElementById('mastermonResultInfo');
  const registerEl = document.getElementById('mastermonRegisterPrompt');
  infoEl.classList.add('hidden');
  registerEl.classList.add('hidden');

  if(game.selectedMastermonKey){
    const data = loadMastermons();
    const mm = data[game.selectedMastermonKey];
    if(mm){
      const killExpBonus = Math.round(player.mastermonKillExpBonus||0);
      // ミューテーター「報酬2倍」(非公開中は常に1)。ゴールド/ダイヤと同様EXPにも反映
      const mutRewardMultExp = (typeof mutatorRewardMult==='function') ? mutatorRewardMult() : 1;
      const result = awardMastermonExp(mm, {
        kills: player.kills, damage: dmgForExp,
        survivalSec: Math.round(player.deathAt||matchTime), champion: !!isWin,
        xpMult: (netState.mode==='multi' ? 5 : 1) * mutRewardMultExp, // マルチプレイは獲得経験値5倍
        bonusExp: killExpBonus, // マスモン撃破ボーナス(相手レベル×係数の積み立て)
      });
      saveMastermons(data);
      let resultText;
      if(result.goldGain>0){
        // レベル上限に達したマスモンは経験値の代わりにゴールドを獲得
        addWallet(result.goldGain, 0);
        updateAccountBar();
        resultText = `${mm.name} は最高レベル！ EXPの代わりに 🪙+${result.goldGain}`;
      } else {
        resultText = `${mm.name} EXP+${result.expGain}`;
        if(killExpBonus>0) resultText += `(うちマスモン撃破ボーナス+${killExpBonus})`;
        if(result.levelsGained>0) resultText += ` Lv.${mm.level}に上昇！トレーニングチケット+${result.levelsGained}`;
      }
      infoEl.textContent = resultText;
      infoEl.classList.remove('hidden');
    }
    return;
  }

  {
    const data = loadMastermons();
    if(!data[player.element]){
      registerEl.classList.remove('hidden');
      registerEl.dataset.element = player.element;
      document.getElementById('mastermonRegisterName').value = '';
      // 登録した瞬間にこの試合の経験値を付与できるよう、成績を控えておく。
      // これをしないと「新規モンスターで試合→登録」した試合の経験値が消えてしまう。
      pendingRegisterMatchStats = {
        kills: player.kills, damage: dmgForExp,
        survivalSec: Math.round(player.deathAt||matchTime), champion: !!isWin,
        xpMult: (netState.mode==='multi' ? 5 : 1) * ((typeof mutatorRewardMult==='function') ? mutatorRewardMult() : 1),
        bonusExp: Math.round(player.mastermonKillExpBonus||0),
      };
    }
  }
}
let pendingRegisterMatchStats = null;
document.getElementById('mastermonRegisterConfirmBtn').addEventListener('click', ()=>{
  const registerEl = document.getElementById('mastermonRegisterPrompt');
  const elementKey = registerEl.dataset.element;
  if(!elementKey) return;
  const name = document.getElementById('mastermonRegisterName').value;
  const data = loadMastermons();
  data[elementKey] = createMastermon(elementKey, name);
  // 登録した試合の経験値をその場で付与し、リザルトにも表示する
  let toastExpText = '';
  if(pendingRegisterMatchStats){
    const mm = data[elementKey];
    const result = awardMastermonExp(mm, pendingRegisterMatchStats);
    pendingRegisterMatchStats = null;
    toastExpText = ` EXP+${result.expGain}`;
    let infoText = `${mm.name} EXP+${result.expGain}`;
    if(result.levelsGained>0) infoText += ` Lv.${mm.level}に上昇！トレーニングチケット+${result.levelsGained}`;
    const infoEl = document.getElementById('mastermonResultInfo');
    infoEl.textContent = infoText;
    infoEl.classList.remove('hidden');
  }
  saveMastermons(data);
  // そのまま再戦しても経験値が入るように、登録と同時にこのマスモンを選択状態にする
  game.selectedElement = elementKey;
  game.selectedMastermonKey = elementKey;
  updatePlayButtonsEnabled();
  // 登録直後に「マスモン」画面を開いた時、今登録したばかりのマスモンが表示されるようにする。
  // これをしないと、既に他のマスモンを登録済みの場合に古い選択(mastermonDetailKey)が
  // 残ったままとなり、「このマスモンで参戦する」を押しても新しく登録した方ではなく
  // 別のマスモンが選ばれてしまい、狙った試合で経験値が入らないように見える不具合があった。
  mastermonDetailKey = elementKey;
  registerEl.classList.add('hidden');
  renderSelectorCards();
  pushToast('マスモンに登録しました！' + toastExpText);
});
document.getElementById('mastermonRegisterSkipBtn').addEventListener('click', ()=>{
  pendingRegisterMatchStats = null;
  document.getElementById('mastermonRegisterPrompt').classList.add('hidden');
});
function onPlayerDown(){
  /* レイドは checkRaidEnd() が「全滅 or 時間切れ or 討伐」で決着させるので、
     通常のリザルト処理へは進めない(倒れても仲間が戦っている間は続く)。
     そのぶん自分の視点が置き去りになるので、残っている味方を観戦する。
     ソロ・マルチどちらも同じ扱い(味方botしか残っていなくても観戦する)。 */
  if(game.raid){ startSpectating('力尽きました。残っている味方を観戦します'); return; }
  if(netState.mode==='multi' && netState.isHost){
    startSpectating('あなたは敗退しました。生き残っているプレイヤーを観戦します');
    return;
  }
  showResult(false, player.placement||entities.filter(e=>e.alive).length+1);
}
/* 観戦を始める(自分が倒れて試合が続く場面)。視点を味方へ移して観戦バーを出すところまで。
   通常マルチのホスト敗退時とレイドで共用する。残っている味方が居なければ何もしない
   (レイドなら全滅として checkRaidEnd() が試合を終わらせる)。 */
function startSpectating(toastText){
  hostSpectating = true;
  if(typeof ensureSpectateTarget!=='function'){ updateSpectateBar(); return; }
  const t = ensureSpectateTarget();
  if(t){
    if(toastText) pushToast(toastText);
    if(typeof startCameraSnap==='function') startCameraSnap(t);
  }
  updateSpectateBar();
}
// 観戦バーの表示更新(観戦中のみ表示。対象名を反映)
function updateSpectateBar(){
  const bar = document.getElementById('spectateBar');
  if(!bar) return;
  const spectating = (typeof spectatingNow==='function' ? spectatingNow() : false)
    && typeof spectateTargetId!=='undefined' && spectateTargetId!=null;
  if(spectating){
    const t = getEntity(spectateTargetId);
    if(t){
      const nameEl = document.getElementById('spectateName');
      if(nameEl) nameEl.textContent = displayNameFor(t);
      bar.classList.remove('hidden');
      return;
    }
  }
  bar.classList.add('hidden');
}
document.getElementById('spectateNextBtn').addEventListener('click', (e)=>{
  e.preventDefault(); e.stopPropagation();
  if(typeof spectateNext==='function') spectateNext();
});
function onPlayerWin(){ showResult(true, 1); }

document.getElementById('replayBtn').addEventListener('click', async ()=>{
  // レイドは専用の後始末(game.raidを下ろしてロビーへ戻す)
  if(game.raid){ raidExit(); return; }
  document.getElementById('resultScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
  document.getElementById('killFeed').innerHTML='';
  game.started=false;
  joinInProgress = false;
  updatePlayButtonsEnabled();
  renderSelectorCards();
  if(netState.mode==='multi' && netState.roomId){
    await window.__aramonLeaveRoom(netState.roomId);
    netState.roomId=null; netState.isHost=false; netState.humanPlayers={}; netState.hostId=null;
    hostCountdownTimer && clearTimeout(hostCountdownTimer);
    hostCountdownTimer=null; hostCountdownSnapshot=null;
    netState.matchStarting=false; hostSpectating=false; matchBeginning=false;
    if(typeof spectateTargetId!=='undefined') spectateTargetId=null;
    updateSpectateBar();
  }
  /* 【必須】試合の名残を断ってロビーの選択へ戻す。
     これが無いと、直前の試合で立った netState.raid が残ったままロビーに戻り、
     そのまま出撃すると前と違うモードで始まる(実際に報告があった)。 */
  syncNetStateToLobbyMode();
});

let currentRankingMode = 'kills';
let currentRankingMonster = 'all';
let currentRankingMapType = 'normal'; // 通常マップ / リアルマップ / マスモン(タブの名前を流用しているだけで地形ではない)
// マスモン自身の記録(通常/リアルのどちらで遊んでも同じ値)。フィールド名がFirebase側の記録名そのもの。
const MASTERMON_RANK_MODES = ['mastermonLevel', 'mastermonRebirth', 'mastermonStatTotal'];
// カテゴリ(#rankingMapTabsのタブ)ごとに出すサブタブ。1か所にまとめてあるので、
// 種類を増やすときはここへ1行足すだけでよい(表に足せば自動で回る)。
const RANKING_TABS_BY_CATEGORY = {
  normal: [['kills','キル数'], ['damage','ダメージ数']],
  real:   [['kills','キル数'], ['damage','ダメージ数']],
  mastermon: [['mastermonLevel','マスモンLv'], ['mastermonRebirth','転生回数'], ['mastermonStatTotal','ステ合計']],
};
// カテゴリを切り替えるたびにサブタブを組み直す。今のモードが新カテゴリに無ければ先頭へ落とす。
function renderRankingModeTabs(){
  const wrap = document.getElementById('rankingTabs');
  if(!wrap) return;
  const list = RANKING_TABS_BY_CATEGORY[currentRankingMapType] || RANKING_TABS_BY_CATEGORY.normal;
  if(!list.some(([m])=>m===currentRankingMode)) currentRankingMode = list[0][0];
  wrap.innerHTML = list.map(([m,label])=>
    `<button class="rank-tab${m===currentRankingMode?' active':''}" data-mode="${m}">${label}</button>`).join('');
}
let rankingOpenedFrom = 'result';
function populateRankingMonsterFilter(){
  const wrap = document.getElementById('rankingMonsterFilterWrap');
  const btn = document.getElementById('rankingMonsterFilterBtn');
  const menu = document.getElementById('rankingMonsterFilterMenu');
  if(!wrap || wrap.dataset.built) return;
  wrap.dataset.built = '1';
  const options = [{ value:'all', label:'総合(全モンスター)' }]
    .concat(Object.keys(ELEMENTS).map(key=>({ value:key, label:ELEMENTS[key].label })));
  menu.innerHTML = options.map(o=>`<div class="custom-select-item${o.value==='all'?' active':''}" data-value="${o.value}">${o.label}</div>`).join('');
  const closeMenu = ()=>menu.classList.add('hidden');
  btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    menu.classList.toggle('hidden');
  });
  menu.querySelectorAll('.custom-select-item').forEach(item=>{
    item.addEventListener('click', (e)=>{
      e.stopPropagation();
      menu.querySelectorAll('.custom-select-item').forEach(i=>i.classList.remove('active'));
      item.classList.add('active');
      currentRankingMonster = item.dataset.value;
      btn.textContent = item.textContent;
      closeMenu();
      loadRankingList(currentRankingMode);
    });
  });
  document.addEventListener('click', (e)=>{
    if(!wrap.contains(e.target)) closeMenu();
  });
}
async function openRankingScreen(fromTitle){
  rankingOpenedFrom = fromTitle ? 'title' : 'result';
  populateRankingMonsterFilter();
  renderRankingModeTabs();
  document.getElementById('rankingScreen').classList.remove('hidden');
  document.getElementById('resultScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.add('hidden');
  await loadRankingList(currentRankingMode);
}
const RANK_CROWN = { 1:{ color:'#ffd700', glow:'rgba(255,215,0,0.7)' }, 2:{ color:'#dfe6ee', glow:'rgba(223,230,238,0.6)' }, 3:{ color:'#cd7f32', glow:'rgba(205,127,50,0.6)' } };
// scoresの1レコードからkills/damageを通常/リアル別に取り出す。
// killsNormal等はこの機能を追加した後に試合を送信したレコードにしか無いので、
// 未移行の旧データ(kills/damageのみ)は読み取り時にも通常マップの実績として引き継ぐ(リアルは0扱い)。
function mmMapStat(r, statName, mapType){
  const field = statName + (mapType==='real' ? 'Real' : 'Normal');
  if(r[field]!=null) return r[field]||0;
  return mapType==='normal' ? (r[statName]||0) : 0;
}
// ある値(キル/ダメージ)で満たせる最上位の称号を返す
function highestTitleOf(type, value){
  if(typeof TITLES==='undefined') return null;
  let best = null;
  for(const t of TITLES){ if(t.type===type && (value||0)>=t.n){ if(!best || t.n>best.n) best = t; } }
  return best;
}
// 単一の記録値が満たす最上位称号をアイコンで返す(マイ記録用)
function statTitleChip(type, value){
  const t = highestTitleOf(type, value);
  return t ? `<span class="rank-title-chip" title="${t.name}（${titleCondText(t)}）">${t.emoji}</span>` : '';
}
// ランキングの記録が満たす称号(最上位のキル称号＋ダメージ称号)をアイコンで表示
// mapType('normal'/'real')に応じて通常/リアルマップどちらの記録を見るか切り替える
function recordTitleBadgesHtml(r, mapType){
  const chips = [];
  const kt = highestTitleOf('matchKills', mmMapStat(r,'kills',mapType));
  const dt = highestTitleOf('matchDamage', mmMapStat(r,'damage',mapType));
  if(kt) chips.push(`<span class="rank-title-chip" title="${kt.name}（${titleCondText(kt)}）">${kt.emoji}</span>`);
  if(dt) chips.push(`<span class="rank-title-chip" title="${dt.name}（${titleCondText(dt)}）">${dt.emoji}</span>`);
  return chips.length ? `<span class="rank-titles">${chips.join('')}</span>` : '';
}
// マスモン名は長くても「…」で切らず、枠幅に収まるよう文字数に応じて字を小さくする
const RANK_MM_MAX_PX = 96;   // 名前チップに使える横幅
function rankMastermonHtml(name){
  if(!name) return '';
  const safe = String(name).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const chars = String(name).length + 2;   // 『』の2文字ぶんも幅を取る
  const size = Math.max(7, Math.min(10, Math.floor(RANK_MM_MAX_PX / chars)));
  return `<span class="rank-mastermon" style="font-size:${size}px">『${safe}』</span>`;
}
async function loadRankingList(mode){
  const listEl = document.getElementById('rankingList');
  listEl.innerHTML = '<div class="rank-empty">読み込み中…</div>';
  setRankShareTarget(false, null);   // 読み直しの間はシェアできない
  if(!window.__aramonFetchRanking){
    listEl.innerHTML = '<div class="rank-empty">ランキング機能が利用できません</div>';
    return;
  }
  // kills/damageは通常マップ/リアルマップで別カウンタ(killsNormal等)に集計しているので、
  // モードとマップ種別タブから実際に索引する項目名を組み立てる。マスモン自身の記録はマップ別に分けない。
  const isMastermonMode = MASTERMON_RANK_MODES.includes(mode);
  const field = isMastermonMode ? mode : (mode + (currentRankingMapType==='real' ? 'Real' : 'Normal'));
  const fetchCount = currentRankingMonster==='all' ? 50 : 300;
  const rows = await window.__aramonFetchRanking(field, fetchCount);
  if(!rows){
    listEl.innerHTML = '<div class="rank-empty">読み込みに失敗しました</div>';
    return;
  }
  let filtered = currentRankingMonster==='all' ? rows : rows.filter(r=>r.element===currentRankingMonster);
  // 同じスコアは同じ順位にする(次の順位は人数ぶん飛ぶ = 一般的な競技順位)
  const scoreOf = (r)=> isMastermonMode ? (r[mode]||0) : mmMapStat(r, mode, currentRankingMapType);
  if(isMastermonMode){
    // マスモンを選んでいない記録(mastermonName無し)は除外してから並べる
    filtered = filtered.filter(r=>r.mastermonName).sort((a,b)=>scoreOf(b)-scoreOf(a));
  } else {
    // Firebase側の索引(killsNormal等)は旧データに存在せず並び順に反映されないため、
    // 読み取り時のフォールバック込みの値で改めて並べ直す
    filtered = filtered.slice().sort((a,b)=>scoreOf(b)-scoreOf(a));
  }
  const top = filtered.slice(0,50);
  if(top.length===0){
    listEl.innerHTML = '<div class="rank-empty">まだ記録がありません</div>';
    return;
  }
  let prevScore = null, prevRank = 0;
  const me = sharePlayerName();   // 自分の行が一覧にあればシェアできる
  let mine = null;
  listEl.innerHTML = top.map((r,i)=>{
    const score = scoreOf(r);
    const val = mode==='mastermonLevel' ? `Lv.${score}` : mode==='mastermonRebirth' ? `★${score}` : score;
    const nm = (r.name||'名無しのモンスター');
    const rank = (prevScore!==null && score===prevScore) ? prevRank : i+1;
    prevScore = score; prevRank = rank;
    const crown = RANK_CROWN[rank];
    const crownHtml = crown ? `<span class="rank-crown" style="color:${crown.color}; text-shadow:0 0 8px ${crown.glow};">👑</span>` : '';
    // 記録時に装備していたスキンがあればそのアイコンを表示(なければ通常のモンスター画像)
    let iconHtml = '';
    if(r.element){
      const skinUrl = r.skin && typeof skinnedIconDataUrl==='function' ? skinnedIconDataUrl(r.skin) : null;
      iconHtml = skinUrl
        ? `<img class="rank-icon" src="${skinUrl}" alt="">`
        : `<img class="rank-icon" src="${imgSrcFor(`monsters/${r.element}`)}" data-ext-idx="0" alt="" onerror="handleMonsterImgError(this, 'monsters/${r.element}')">`;
    }
    const mmHtml = rankMastermonHtml(r.mastermonName);
    // マスモン自身の記録タブは地形の区別が無いので、称号バッジは通常マップ扱いで見る
    const titleHtml = (typeof recordTitleBadgesHtml==='function') ? recordTitleBadgesHtml(r, isMastermonMode ? 'normal' : currentRankingMapType) : '';
    if(nm === me && !mine) mine = { r, rank, val };   // シェア用に自分の行を控える
    return `<div class="rank-row${crown?' rank-row-top':''}">${crownHtml}<span class="rk">#${rank}</span>${iconHtml}${mmHtml}<span class="rn">${nm}</span>${titleHtml}<span class="rv">${val}</span></div>`;
  }).join('');
  const scopeLabel = isMastermonMode ? 'マスモン' : (currentRankingMapType==='real' ? 'リアルマップ' : '通常マップ');
  setRankShareTarget(false, mine && {
    rank: mine.rank,
    title: `${RANKING_MODE_LABEL[mode] || mode}ランキング（${scopeLabel}）`,
    valueLabel: RANKING_MODE_LABEL[mode] || mode,
    valueText: String(mine.val),
    element: mine.r.element, skinId: mine.r.skin || null,
    monsterLabel: mine.r.mastermonName || (ELEMENTS[mine.r.element] ? ELEMENTS[mine.r.element].label : ''),
    chips: [scopeLabel],
  });
}
document.getElementById('viewRankingBtn').addEventListener('click', ()=>openRankingScreen(false));
document.getElementById('titleRankingBtn').addEventListener('click', ()=>openRankingScreen(true));
document.getElementById('closeRankingBtn').addEventListener('click', ()=>{
  document.getElementById('rankingScreen').classList.add('hidden');
  const menu = document.getElementById('rankingMonsterFilterMenu');
  if(menu) menu.classList.add('hidden');
  if(rankingOpenedFrom==='title'){
    document.getElementById('startScreen').classList.remove('hidden');
  } else {
    document.getElementById('resultScreen').classList.remove('hidden');
  }
});
// サブタブはカテゴリ切替のたびに renderRankingModeTabs() が中身を作り直すので、
// クリックは親要素(#rankingTabs)への委譲で受ける(要素ごとの張り直しが要らない)。
document.getElementById('rankingTabs').addEventListener('click', (e)=>{
  const tab = e.target.closest('.rank-tab');
  if(!tab) return;
  document.querySelectorAll('.rank-tab').forEach(t=>t.classList.remove('active'));
  tab.classList.add('active');
  currentRankingMode = tab.dataset.mode;
  loadRankingList(currentRankingMode);
});
document.querySelectorAll('.rank-map-tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.rank-map-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    const t = tab.dataset.maptype;
    currentRankingMapType = (t==='real' || t==='mastermon') ? t : 'normal';
    renderRankingModeTabs();   // サブタブの中身をカテゴリに合わせて作り直す
    loadRankingList(currentRankingMode);
  });
});

let myStatsOpenedFrom = 'result';
let myStatsModeTab = 'solo';
function openMyStatsScreen(fromTitle){
  myStatsOpenedFrom = fromTitle ? 'title' : 'result';
  document.getElementById('myStatsScreen').classList.remove('hidden');
  document.getElementById('resultScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.add('hidden');
  renderMyStats();
}
document.querySelectorAll('.mystat-mode-tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.mystat-mode-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    myStatsModeTab = tab.dataset.mode;
    renderMyStats();
  });
});
function renderMyStats(){
  const allStats = loadLocalStats() || defaultLocalStats();
  const stats = allStats[myStatsModeTab] || defaultModeStats();
  const derived = computeDerivedStats(stats);
  const overallEl = document.getElementById('myStatsOverall');
  overallEl.innerHTML = `
    <div class="mystat-box"><div class="ml">通算マッチ数</div><div class="mv">${stats.totalMatches||0}</div></div>
    <div class="mystat-box"><div class="ml">通算勝利数</div><div class="mv">${stats.totalWins||0}</div></div>
    <div class="mystat-box"><div class="ml">最高キル数</div><div class="mv">${stats.bestKills||0} ${statTitleChip('matchKills', stats.bestKills||0)}</div></div>
    <div class="mystat-box"><div class="ml">K/D</div><div class="mv">${derived.kd.toFixed(2)}</div></div>
    <div class="mystat-box"><div class="ml">最高ダメージ</div><div class="mv">${stats.bestDamage||0} ${statTitleChip('matchDamage', stats.bestDamage||0)}</div></div>
    <div class="mystat-box"><div class="ml">平均ダメージ</div><div class="mv">${Math.round(derived.avgDamage)}</div></div>
  `;
  const byElEl = document.getElementById('myStatsByElement');
  if(!stats.totalMatches){
    byElEl.innerHTML = '<div class="rank-empty">まだ記録がありません。1試合プレイすると記録されます</div>';
    return;
  }
  const ownMastermons = loadMastermons();
  const rows = Object.keys(ELEMENTS).map(key=>{
    const el = ELEMENTS[key];
    const es = (stats.byElement && stats.byElement[key]) || { bestDamage:0, bestKills:0, matches:0 };
    const mm = ownMastermons[key];
    const mmLine = mm ? `<span class="en-mastermon">★ ${mm.name} Lv.${mm.level}</span>` : '';
    // アイコンは、そのモンスターに現在装備中のスキンがあればそれを使う(無ければデフォルト画像)
    const equippedSkin = (typeof getEquippedSkin==='function') ? getEquippedSkin(key) : null;
    const skinUrl = (equippedSkin && typeof skinnedIconDataUrl==='function') ? skinnedIconDataUrl(equippedSkin) : null;
    const iconImg = skinUrl
      ? `<img class="ei" src="${skinUrl}" alt="">`
      : `<img class="ei" src="${imgSrcFor(`monsters/${key}`)}" data-ext-idx="0" alt="" onerror="handleMonsterImgError(this, 'monsters/${key}')">`;
    return `<div class="mystat-elem-row">
      ${iconImg}
      <span class="en">${el.label}</span>
      ${mmLine}
      <span class="ev-line">使用回数　${es.matches||0}回</span>
      <span class="ev-line">最高キル　${es.bestKills||0} ${statTitleChip('matchKills', es.bestKills||0)}</span>
      <span class="ev-line">最高ダメージ　${es.bestDamage||0} ${statTitleChip('matchDamage', es.bestDamage||0)}</span>
    </div>`;
  });
  byElEl.innerHTML = rows.join('');
}
document.getElementById('viewMyStatsBtn').addEventListener('click', ()=>openMyStatsScreen(false));
// レイドのリザルトから直接レイドランキングへ
document.getElementById('viewRaidRankBtn').addEventListener('click', ()=>openRaidRanking());
document.getElementById('titleMyStatsBtn').addEventListener('click', ()=>openMyStatsScreen(true));
document.getElementById('closeMyStatsBtn').addEventListener('click', ()=>{
  document.getElementById('myStatsScreen').classList.add('hidden');
  if(myStatsOpenedFrom==='title'){
    document.getElementById('startScreen').classList.remove('hidden');
  } else {
    document.getElementById('resultScreen').classList.remove('hidden');
  }
});

/* =====================================================================
   管理者画面
===================================================================== */
const ADMIN_PASSWORD = '0008';
const ADMIN_EXCLUDE_NAME = 'おりょう';
// レイドの試合ログ(raidResult)の表示名。raidShowResultで付ける値と1対1
const ADMIN_RAID_RESULT_LABEL = { defeated:'討伐成功', best:'自己ベスト更新', died:'力尽きた', timeup:'時間切れ' };
let adminPassInput = '';
let adminMatchLogsCache = null;
let adminSelectedPeriod = 'all';
let adminSelectedMap = null;
let adminSelectedMonster = null;
let adminStatSubtab = 'count';    // プレイ状況タブ内のサブタブ(count=プレイ回数 / player=プレイヤー情報 / recent=直近プレイ)
let adminSelectedPlayer = null;   // プレイヤー情報で詳細表示中のプレイヤー名

function updateAdminPassDots(){
  const dots = document.querySelectorAll('#adminPassDots .admin-pass-dot');
  dots.forEach((d,i)=> d.classList.toggle('filled', i < adminPassInput.length));
}

document.getElementById('adminEntryBtn').addEventListener('click', ()=>{
  adminPassInput = '';
  updateAdminPassDots();
  document.getElementById('adminPassError').classList.add('hidden');
  document.getElementById('adminPassScreen').classList.remove('hidden');
  document.getElementById('startScreen').classList.add('hidden');
});
document.getElementById('adminPassCancelBtn').addEventListener('click', ()=>{
  document.getElementById('adminPassScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
});
function adminPassFail(){
  document.getElementById('adminPassError').classList.remove('hidden');
  setTimeout(()=>{
    document.getElementById('adminPassScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
  }, 700);
}
document.querySelectorAll('#adminPassKeypad button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const k = btn.dataset.k;
    if(document.getElementById('adminPassError').classList.contains('hidden')===false) return;
    if(k==='clear'){ adminPassInput=''; }
    else if(k==='back'){ adminPassInput = adminPassInput.slice(0,-1); }
    else if(adminPassInput.length<4){ adminPassInput += k; }
    updateAdminPassDots();
    if(adminPassInput.length===4){
      if(adminPassInput===ADMIN_PASSWORD){
        document.getElementById('adminPassScreen').classList.add('hidden');
        openAdminScreen();
      } else {
        adminPassFail();
      }
    }
  });
});

let adminFetchFailed = false;
async function fetchAdminMatchLogs(force){
  if(adminMatchLogsCache && !force) return adminMatchLogsCache;
  adminFetchFailed = false;
  if(!window.__aramonFetchMatchLogs){ adminMatchLogsCache = []; return adminMatchLogsCache; }
  const rows = await window.__aramonFetchMatchLogs();
  if(rows===null){
    // nullは「本当にデータが0件」ではなく「取得自体に失敗した」ことを示す
    // (Firebaseの読み取り権限がmatchLogsパスに無い場合など)。0件と混同しないよう区別する。
    adminFetchFailed = true;
    adminMatchLogsCache = [];
    return adminMatchLogsCache;
  }
  adminMatchLogsCache = rows.filter(r=> r && r.name !== ADMIN_EXCLUDE_NAME);
  return adminMatchLogsCache;
}
function adminMonthKeyOf(ts){
  const d = new Date(ts||0);
  return `${d.getFullYear()}年${String(d.getMonth()+1).padStart(2,'0')}月`;
}
function adminFilterByPeriod(logs, period){
  if(period==='all') return logs;
  return logs.filter(r=> adminMonthKeyOf(r.ts)===period);
}
// 汎用の自前ドロップダウン(マップ/モンスター選択用)。呼ばれるたびに選択肢を作り直すので、
// トグル用のクリックリスナーだけdataset.boundで一度きり登録する。
// 横棒グラフのHTMLを組む。entries=[{label,count}], 最大値基準で幅を割合表示
function adminBarChartHtml(entries, color){
  if(!entries.length) return '<div class="rank-empty">記録がありません</div>';
  const max = Math.max(1, ...entries.map(e=>e.count));
  return entries.map(e=>{
    const pct = Math.round(e.count/max*100);
    return `<div class="admin-bar-row"${e.player?` data-player="${encodeURIComponent(e.player)}"`:''}>
      <span class="admin-bar-label">${e.label}</span>
      <span class="admin-bar-track"><span class="admin-bar-fill" style="width:${pct}%;background:${color||'#f4c430'}"></span></span>
      <span class="admin-bar-count">${e.count}</span>
    </div>`;
  }).join('');
}
// 月フィルタ(全期間＋各月)のボタン列を作る
function renderAdminMonthFilter(logs){
  const months = Array.from(new Set(logs.map(r=>adminMonthKeyOf(r.ts)))).sort().reverse();
  if(adminSelectedPeriod!=='all' && !months.includes(adminSelectedPeriod)) adminSelectedPeriod = 'all';
  const opts = [{ v:'all', l:'全期間' }].concat(months.map(m=>({ v:m, l:m })));
  const wrap = document.getElementById('adminMonthFilter');
  wrap.innerHTML = opts.map(o=>`<button class="admin-month-btn${o.v===adminSelectedPeriod?' active':''}" data-period="${o.v}">${o.l}</button>`).join('');
  wrap.querySelectorAll('.admin-month-btn').forEach(b=> b.onclick = ()=>{ adminSelectedPeriod = b.dataset.period; renderAdminData(); });
}
function adminFmtDate(ts){ if(!ts) return '—'; const d=new Date(ts); return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`; }
function adminFmtDateTime(ts){ if(!ts) return '—'; const d=new Date(ts); return `${adminFmtDate(ts)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function adminMapLabel(r){ return MAPS[r.map] ? MAPS[r.map].label : (r.mapLabel || r.map || '?'); }
function adminMonLabel(r){ return ELEMENTS[r.element] ? ELEMENTS[r.element].label : (r.elementLabel || r.element || '?'); }
// モード表示。レイドは別枠だが、ソロ/マルチも記録してあるので括弧で添える
function adminModeLabel(r){
  const co = r.mode==='multi' ? 'マルチ' : 'ソロ';
  return r.raid ? `レイド(${co})` : co;
}
// 1試合の長さ。古いログにはsecが無いので「—」にする(0と区別する)
function adminSecLabel(r){
  if(typeof r.sec!=='number' || r.sec<=0) return '—';
  return `${Math.floor(r.sec/60)}:${String(r.sec%60).padStart(2,'0')}`;
}
// 勝敗。winを持たない古いログは空欄(負けと決めつけない)
function adminWinLabel(r){ return typeof r.win!=='boolean' ? '' : (r.win ? '勝' : '負'); }

function renderAdminData(){
  const totalEl = document.getElementById('adminTotalMatches');
  if(adminFetchFailed){
    totalEl.textContent = '取得に失敗しました(Firebaseの読み取り権限をご確認ください)';
    totalEl.classList.add('admin-total-line-error');
    document.getElementById('adminMapChart').innerHTML = '';
    document.getElementById('adminMonsterChart').innerHTML = '';
    document.getElementById('adminRaidChart').innerHTML = '';
    document.getElementById('adminHourChart').innerHTML = '';
    document.getElementById('adminPlayerList').innerHTML = '<div class="rank-empty">読み込みエラーのため表示できません</div>';
    return;
  }
  totalEl.classList.remove('admin-total-line-error');
  const logs = adminMatchLogsCache || [];
  // --- プレイ回数タブ(月フィルタあり) ---
  renderAdminMonthFilter(logs);
  const filtered = adminFilterByPeriod(logs, adminSelectedPeriod);
  const raidFiltered = filtered.filter(r=>r.raid);
  totalEl.textContent = `合計プレイ回数　${filtered.length}回（レイド ${raidFiltered.length}回）`;
  const mapEntries = Object.keys(MAPS)
    .map(k=>({ label:MAPS[k].label, count: filtered.filter(r=>r.map===k).length }))
    .sort((a,b)=> b.count-a.count);
  document.getElementById('adminMapChart').innerHTML = adminBarChartHtml(mapEntries, '#5aa6ff');
  const monEntries = Object.keys(ELEMENTS)
    .map(k=>({ label:ELEMENTS[k].label, count: filtered.filter(r=>r.element===k).length }))
    .sort((a,b)=> b.count-a.count);
  document.getElementById('adminMonsterChart').innerHTML = adminBarChartHtml(monEntries, '#f4c430');
  // レイド結果別(討伐成功/自己ベスト更新/力尽きた/時間切れ)
  const raidResultEntries = Object.entries(ADMIN_RAID_RESULT_LABEL)
    .map(([k,label])=>({ label, count: raidFiltered.filter(r=>r.raidResult===k).length }))
    .sort((a,b)=> b.count-a.count);
  document.getElementById('adminRaidChart').innerHTML = raidFiltered.length
    ? adminBarChartHtml(raidResultEntries, '#a24bff') : '<div class="rank-empty">記録がありません</div>';
  /* 時間帯別。tsは最初から記録しているので、過去のログもそのまま集計できる。
     0件の時間は行ごと出さない(24行は縦を食うだけで読み取れることが増えない) */
  const byHour = {};
  filtered.forEach(r=>{ const h = new Date(r.ts||0).getHours(); byHour[h] = (byHour[h]||0)+1; });
  const hourEntries = Object.keys(byHour).map(Number).sort((a,b)=>a-b)
    .map(h=>({ label:`${String(h).padStart(2,'0')}時台`, count:byHour[h] }));
  document.getElementById('adminHourChart').innerHTML = hourEntries.length
    ? adminBarChartHtml(hourEntries, '#6bff8e') : '<div class="rank-empty">記録がありません</div>';
  // --- プレイヤー情報タブ(全期間) ---
  renderAdminPlayerTab();
  // --- 直近プレイタブ(全期間・日時降順) ---
  renderAdminRecentTab();
}
// プレイヤー情報タブ: 一覧 or 詳細
function renderAdminPlayerTab(){
  if(adminSelectedPlayer){ renderAdminPlayerDetail(adminSelectedPlayer); return; }
  document.getElementById('adminPlayerListWrap').classList.remove('hidden');
  document.getElementById('adminPlayerDetail').classList.add('hidden');
  const logs = adminMatchLogsCache || [];
  const byPlayer = {};
  logs.forEach(r=>{ const nm = r.name || '名無しのモンスター'; byPlayer[nm] = (byPlayer[nm]||0)+1; });
  const rows = Object.entries(byPlayer).sort((a,b)=> b[1]-a[1])
    .map(([nm,cnt],i)=>({ label:`#${i+1} ${nm}`, count:cnt, player:nm }));
  const listEl = document.getElementById('adminPlayerList');
  listEl.innerHTML = rows.length ? adminBarChartHtml(rows, '#6bff8e') : '<div class="rank-empty">記録がありません</div>';
  listEl.querySelectorAll('.admin-bar-row[data-player]').forEach(row=>{
    row.style.cursor = 'pointer';
    row.onclick = ()=>{ adminSelectedPlayer = decodeURIComponent(row.dataset.player); renderAdminPlayerTab(); };
  });
}
// プレイヤー詳細: そのプレイヤーの情報をできるだけ多く表示
function renderAdminPlayerDetail(name){
  document.getElementById('adminPlayerListWrap').classList.add('hidden');
  const detail = document.getElementById('adminPlayerDetail');
  detail.classList.remove('hidden');
  const logs = (adminMatchLogsCache||[]).filter(r=> (r.name||'名無しのモンスター')===name);
  const total = logs.length;
  const raidLogs = logs.filter(r=> r.raid);
  const nonRaidLogs = logs.filter(r=> !r.raid);
  const solo = nonRaidLogs.filter(r=> r.mode!=='multi').length;
  const multi = nonRaidLogs.filter(r=> r.mode==='multi').length;
  const raidRuns = raidLogs.length;
  const raidBestDmg = raidLogs.length ? Math.max(...raidLogs.map(r=> r.raidDamage||0)) : 0;
  const raidDefeats = raidLogs.filter(r=> r.raidResult==='defeated').length;
  // 勝率とプレイ時間は新しい項目なので、持っているログだけで割る(母数も併記して誤読を防ぐ)
  const rated = logs.filter(r=> typeof r.win==='boolean');
  const wins = rated.filter(r=> r.win).length;
  const winText = rated.length ? `${Math.round(wins/rated.length*100)}%（${wins}/${rated.length}）` : '—';
  const timed = logs.filter(r=> typeof r.sec==='number' && r.sec>0);
  const totalSec = timed.reduce((a,r)=>a+r.sec, 0);
  const avgSec = timed.length ? Math.round(totalSec/timed.length) : 0;
  const fmtMin = (s)=> s>=3600 ? `${Math.floor(s/3600)}時間${Math.round(s%3600/60)}分` : `${Math.floor(s/60)}分${s%60}秒`;
  const tsList = logs.map(r=> r.ts||0).filter(Boolean);
  const first = tsList.length ? Math.min(...tsList) : 0;
  const last  = tsList.length ? Math.max(...tsList) : 0;
  const monMap={}; logs.forEach(r=>{ const l=adminMonLabel(r); monMap[l]=(monMap[l]||0)+1; });
  const monEntries = Object.entries(monMap).map(([l,c])=>({label:l,count:c})).sort((a,b)=>b.count-a.count);
  const mapMap={}; logs.forEach(r=>{ const l=adminMapLabel(r); mapMap[l]=(mapMap[l]||0)+1; });
  const mapEntries = Object.entries(mapMap).map(([l,c])=>({label:l,count:c})).sort((a,b)=>b.count-a.count);
  const monthMap={}; logs.forEach(r=>{ const k=adminMonthKeyOf(r.ts); monthMap[k]=(monthMap[k]||0)+1; });
  const monthEntries = Object.entries(monthMap).sort((a,b)=> a[0]<b[0]?1:-1).map(([k,c])=>({label:k,count:c}));
  const recent = logs.slice().sort((a,b)=>(b.ts||0)-(a.ts||0)).slice(0,12);
  const favMon = monEntries[0] ? monEntries[0].label : '—';
  const favMap = mapEntries[0] ? mapEntries[0].label : '—';
  detail.innerHTML = `
    <button class="admin-back-btn" id="adminPlayerBackBtn">← 一覧へ戻る</button>
    <div class="admin-detail-name">${name}</div>
    <div class="admin-detail-grid">
      <div><span class="admin-dk">合計プレイ</span><span class="admin-dv">${total}回</span></div>
      <div><span class="admin-dk">ソロ / マルチ</span><span class="admin-dv">${solo} / ${multi}</span></div>
      <div><span class="admin-dk">勝率</span><span class="admin-dv">${winText}</span></div>
      <div><span class="admin-dk">総プレイ時間</span><span class="admin-dv">${timed.length?fmtMin(totalSec):'—'}</span></div>
      <div><span class="admin-dk">1試合の平均</span><span class="admin-dv">${timed.length?fmtMin(avgSec):'—'}</span></div>
      <div><span class="admin-dk">レイド参加</span><span class="admin-dv">${raidRuns}回</span></div>
      <div><span class="admin-dk">レイド討伐</span><span class="admin-dv">${raidDefeats}回</span></div>
      <div><span class="admin-dk">レイド最高与ダメ</span><span class="admin-dv">${raidBestDmg.toLocaleString()}</span></div>
      <div><span class="admin-dk">初プレイ</span><span class="admin-dv">${adminFmtDate(first)}</span></div>
      <div><span class="admin-dk">最終プレイ</span><span class="admin-dv">${adminFmtDate(last)}</span></div>
      <div><span class="admin-dk">最多モンスター</span><span class="admin-dv">${favMon}</span></div>
      <div><span class="admin-dk">最多地形</span><span class="admin-dv">${favMap}</span></div>
    </div>
    <div class="admin-col-title" style="margin-top:14px;">月別プレイ回数</div>
    <div class="admin-bar-chart">${adminBarChartHtml(monthEntries,'#a24bff')}</div>
    <div class="admin-col-title" style="margin-top:14px;">モンスター別</div>
    <div class="admin-bar-chart">${adminBarChartHtml(monEntries,'#f4c430')}</div>
    <div class="admin-col-title" style="margin-top:14px;">地形別</div>
    <div class="admin-bar-chart">${adminBarChartHtml(mapEntries,'#5aa6ff')}</div>
    <div class="admin-col-title" style="margin-top:14px;">直近の試合(最大12件)</div>
    <div class="admin-recent-list">${recent.map(r=>
      `<div class="admin-recent-row"><span class="ar-dt">${adminFmtDateTime(r.ts)}</span><span class="ar-map">${adminMapLabel(r)}</span><span class="ar-mon">${adminMonLabel(r)}</span><span class="ar-mode">${adminModeLabel(r)}</span><span class="ar-sec">${adminSecLabel(r)}</span><span class="ar-win ${r.win?'is-win':''}">${adminWinLabel(r)}</span></div>`
    ).join('')}</div>
  `;
  document.getElementById('adminPlayerBackBtn').onclick = ()=>{ adminSelectedPlayer = null; renderAdminPlayerTab(); };
}
// プレイ状況タブ内のサブタブ切替(プレイ回数 / プレイヤー情報 / 直近プレイ)
function adminShowStatSubtab(sub){
  adminStatSubtab = sub;
  document.querySelectorAll('#adminStatSubtabs .admin-substat').forEach(t=>t.classList.toggle('active', t.dataset.substat===sub));
  document.getElementById('adminStatCountPane').classList.toggle('hidden', sub!=='count');
  document.getElementById('adminStatPlayerPane').classList.toggle('hidden', sub!=='player');
  document.getElementById('adminStatRecentPane').classList.toggle('hidden', sub!=='recent');
  if(sub==='player'){ adminSelectedPlayer = null; renderAdminPlayerTab(); }
  if(sub==='recent'){ renderAdminRecentTab(); }
}
// 直近プレイ: 全プレイヤーの試合履歴を日時降順で最大100件表示(日時/プレイヤー名/マップ/モンスター/ソロ・マルチ)
function renderAdminRecentTab(){
  const logs = adminMatchLogsCache || [];
  const recent = logs.slice().sort((a,b)=>(b.ts||0)-(a.ts||0)).slice(0,100);
  const listEl = document.getElementById('adminRecentPlayList');
  listEl.innerHTML = recent.length ? recent.map(r=>
    `<div class="admin-recent-row">
      <span class="ar-dt">${adminFmtDateTime(r.ts)}</span>
      <span class="ar-name">${r.name || '名無しのモンスター'}</span>
      <span class="ar-map">${adminMapLabel(r)}</span>
      <span class="ar-mon">${adminMonLabel(r)}</span>
      <span class="ar-mode">${adminModeLabel(r)}</span>
      <span class="ar-sec">${adminSecLabel(r)}</span>
      <span class="ar-win ${r.win?'is-win':''}">${adminWinLabel(r)}</span>
    </div>`
  ).join('') : '<div class="rank-empty">記録がありません</div>';
}
document.querySelectorAll('#adminStatSubtabs .admin-substat').forEach(t=> t.addEventListener('click', ()=>adminShowStatSubtab(t.dataset.substat)));
// 管理者画面: SE確認グリッド(全SEをタップで再生)
const SE_TEST_LABELS = {
  tap:'ボタン ポン', cardSwipe:'カード送り シュッ', jakiin:'開始/状態変化 ジャキーン', train:'トレーニング ポワポワ', pickup:'取得 ピュイン',
  fire:'技発射 バァン', hitTaken:'被弾 ドスッ', noGuts:'ガッツ不足 ピピピ', fireRoar:'炎 ボオオオ',
  iceCrack:'氷 パリパリ', tornado:'竜巻 ゴオオオ', spin:'回転 シュルル', beam:'ビーム', whoosh:'風切り シュン',
  bell:'鐘 リンリン', chupiin:'召喚・柱 チュピーン', shuwaa:'召喚・収束 シュワァー', kill:'撃破 ズバシュ',
  fanfare:'勝利ファンファーレ', sad:'敗北', godRising:'ゴッドライジング 運命', ssrJackpot:'SSR大当たり', zashu:'ダークホウスト ズバシュ×5',
  chocoSummon:'ちょこ 召喚', chocoVanish:'ちょこ ヴァニッシュ', chocoHit:'ちょこ 被弾',
  titleStart:'タイトル TAP START',
  buy:'ショップ購入', darkHoust:'ザン ダークホウスト', requiemEnd:'イルミネ レクイエムエンド',
  mocchiBeam:'モッチー モッチ砲', monta:'モッチー もんた', crystalRain:'ウンディーネ クリスタルレイン',
  fireWave:'ヒノトリ ファイアウェーブ',
  amphitrite:'ペルセポネ アムピトリテ(3連射)', amphitriteBlast:'ペルセポネ アムピトリテ 爆風',
  venomEdge:'イルミネ ヴェノムエッジ', assaultArrow:'イルミネ アサルトアロー(3連射)', requiemBlast:'イルミネ レクイエムエンド 爆風',
  gokongo:'轟金剛 超番長ボーナス', gokongoWin:'轟金剛 勝利', gokongoKill:'轟金剛 キル',
  rize:'大喰いの利世 鱗赫', rizeKill:'大喰いの利世 勝利', rizeHit:'大喰いの利世 被弾', aquaKill:'大喰いの利世 キル',
  gutsTier3:'狂戦士ガッツ ドラゴンころし',
};
// SKIN_MEDIA から自動登録されたSE('skinSe:<id>:<区分>')の表示名はスキン名から作る
function seTestLabel(name){
  if(SE_TEST_LABELS[name]) return SE_TEST_LABELS[name];
  if(name.indexOf('skinSe:')===0){
    const [, id, slot] = name.split(':');
    const jp = (typeof SKIN_SE_SLOTS!=='undefined' && SKIN_SE_SLOTS[slot]) || slot;
    const label = (typeof skinMeta==='function' && SSR_SKINS[id]) ? skinMeta(id).name : id;
    return `${label} ${jp}`;
  }
  return name;
}
function renderAdminSeGrid(){
  const grid = document.getElementById('adminSeGrid');
  if(!grid || typeof SE_DEFS==='undefined') return;
  const names = Object.keys(SE_DEFS);
  grid.innerHTML = names.map(n=>`<button class="admin-se-btn" data-se="${n}">🔊 ${seTestLabel(n)}</button>`).join('');
  grid.querySelectorAll('.admin-se-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const n = btn.dataset.se;
      // aoe系はdurを渡すと本来の長さで鳴る。fireは単発指定。
      if(n==='fire') playSe('fire', {kind:'single'});
      else playSe(n, {dur:1.6});
    });
  });
}
// 管理者画面: BGM確認グリッド
const BGM_TEST_ITEMS = [
  { id:'title',  label:'🎵 タイトル(牧場)' },
  { id:'battle0',label:'🎵 試合中・序盤' },
  { id:'battle1',label:'🎵 試合中・中盤' },
  { id:'battle2',label:'🎵 試合中・終盤' },
  { id:'final5', label:'🎵 残り5人以下(決戦・動画音源)' },
  { id:'last2',  label:'🎵 残り2人(ラストバトル・動画音源)' },
  // SSRスキン専用BGMの行は SKIN_MEDIA から作る(スキンを足してもここへの追記は要らない)
  ...(typeof SKIN_MEDIA!=='undefined' ? Object.keys(SKIN_MEDIA) : []).flatMap(id=>{
    const bgm = SKIN_MEDIA[id].bgm || {};
    const name = (typeof skinMeta==='function' && SSR_SKINS[id]) ? skinMeta(id).name : id;
    return Object.keys(SKIN_BGM_SLOTS).filter(slot=>bgm[slot])
      .map(slot=>({ id:`skinBgm:${id}:${slot}`, label:`🎵 ${name}・${SKIN_BGM_SLOTS[slot]}` }));
  }),
  { id:'shop',   label:'🎵 ショップ(動画音源)' },
  { id:'lobby',  label:'🎵 ロビー(いちか・実音源)' },
  { id:'training',label:'🎵 トレーニング(実音源)' },
  { id:'stop',   label:'⏹ 停止' },
];
function adminPlayBgm(id){
  if(typeof audioInit==='function') audioInit();
  if(id==='stop'){ if(typeof bgmSetTrack==='function') bgmSetTrack(null); return; }
  if(id==='title'){ if(typeof bgmSetTrack==='function') bgmSetTrack('title'); return; }
  if(id==='lobby'){
    // ロビー曲(いちか)の確認。プレイヤーが選んでいるロビーBGMは書き換えず、専用トラックで鳴らす
    if(typeof bgmLobby!=='undefined') bgmLobby.ensure();
    if(typeof bgmSetTrack==='function') bgmSetTrack('lobbyFile');
    return;
  }
  if(id==='training'){
    if(typeof ensureBgmTrainingBuffer==='function') ensureBgmTrainingBuffer();
    if(typeof bgmSetTrack==='function') bgmSetTrack('training');
    return;
  }
  if(id==='shop'){
    if(typeof ensureBgmShopBuffer==='function') ensureBgmShopBuffer();
    if(typeof bgmSetTrack==='function') bgmSetTrack('shop');
    return;
  }
  if(id.indexOf('skinBgm:')===0){
    // 装備スキンや試合中かどうかに関係なく、専用曲そのものを確認できるようにする
    if(typeof ensureSkinBgmBuffers==='function') ensureSkinBgmBuffers(id.split(':')[1]);
    if(typeof bgmSetTrack==='function') bgmSetTrack(id);
    return;
  }
  const lv = { battle0:0, battle1:1, battle2:2, final5:3, last2:4 }[id];
  if(typeof bgmSetIntensity==='function') bgmSetIntensity(lv);
  if(typeof bgmSetTrack==='function') bgmSetTrack('battle');
}
function renderAdminBgmGrid(){
  const grid = document.getElementById('adminBgmGrid');
  if(!grid) return;
  grid.innerHTML = BGM_TEST_ITEMS.map(it=>`<button class="admin-se-btn" data-bgm="${it.id}">${it.label}</button>`).join('');
  grid.querySelectorAll('.admin-se-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> adminPlayBgm(btn.dataset.bgm));
  });
}
// 管理者画面: 音声確認タブ内のサブタブ切替(SE / BGM)
function adminShowSeSubtab(sub){
  document.querySelectorAll('.admin-subtab').forEach(t=>t.classList.toggle('active', t.dataset.subtab===sub));
  document.getElementById('adminSeSubPane').classList.toggle('hidden', sub!=='se');
  document.getElementById('adminBgmSubPane').classList.toggle('hidden', sub!=='bgm');
  if(sub!=='bgm' && typeof bgmSetTrack==='function') bgmSetTrack('title'); // BGMサブタブを離れたらテストBGMを止めてタイトルへ
}
document.querySelectorAll('.admin-subtab').forEach(t=> t.addEventListener('click', ()=>adminShowSeSubtab(t.dataset.subtab)));

/* =====================================================================
   シーズン1 準備プレビュー(管理者専用・非公開)
   SEASON1_MUTATORS / SEASON_REWARDS(data.js)を表示するだけの確認画面。
   ここでの表示・操作はゲームプレイに一切影響しない。
===================================================================== */
// 開始日(SEASON1_START_DATE)の月を、日曜始まりの週グリッドに組み立てる
function buildSeason1CalendarWeeks(){
  const start = new Date(SEASON1_START_DATE+'T00:00:00');
  const year = start.getFullYear(), month = start.getMonth();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const startWeekday = new Date(year, month, 1).getDay(); // 0=日
  const cells = [];
  for(let i=0;i<startWeekday;i++) cells.push(null);
  for(let d=1; d<=daysInMonth; d++) cells.push(new Date(year, month, d));
  while(cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for(let i=0;i<cells.length;i+=7) weeks.push(cells.slice(i,i+7));
  // 開始前しか入っていない先頭の週は落とす。その週には出す情報が何も無いのに
  // 1行ぶん(数十px)場所を取り、そのぶん下が見えなくなるため。
  while(weeks.length > 1 && weeks[0].every(d=>!d || d < start)) weeks.shift();
  return { weeks, start };
}
/* シーズン1のスケジュール(カレンダー)と説明。プレイヤーのシーズン画面と
   管理者のプレビュー画面で同じものを出すので、組み立てはここ1か所にまとめる。
   レイド開催期間は紫のバーで示す(週をまたぐぶんは各日のセルに帯を出して繋げる)。 */
function season1CalendarHtml(){
  if(typeof SEASON1_MUTATORS==='undefined') return '';
  const { weeks, start } = buildSeason1CalendarWeeks();
  const dow = ['日','月','火','水','木','金','土'];
  const today = new Date(); today.setHours(0,0,0,0);
  const isToday = (date)=> date.getFullYear()===today.getFullYear() && date.getMonth()===today.getMonth() && date.getDate()===today.getDate();
  const raidFrom = (typeof raidStartAt==='function') ? raidStartAt().getTime() : null;
  const raidTo   = (typeof raidEndAt==='function')   ? raidEndAt().getTime()   : null;
  // その日がレイド期間内か / 期間の初日・最終日か(バーの角丸を付ける位置)
  const raidInfo = (date)=>{
    if(raidFrom==null || !RAID_ACTIVE) return null;
    const t = date.getTime();
    if(t < raidFrom || t >= raidTo) return null;
    return { first: t===raidFrom, last: t+86400000>=raidTo };
  };
  let html = `<div class="s1prev-cal-month">${start.getFullYear()}年${start.getMonth()+1}月〜(シーズン1開始 ${start.getMonth()+1}/${start.getDate()}・以降は同じ曜日パターンで毎週繰り返し)</div>`;
  html += `<div class="s1prev-cal-grid s1prev-cal-head">${dow.map(d=>`<div class="s1prev-cal-dow">${d}</div>`).join('')}</div>`;
  weeks.forEach(week=>{
    html += `<div class="s1prev-cal-grid">` + week.map(date=>{
      if(!date) return `<div class="s1prev-cal-cell empty"></div>`;
      const before = date < start;
      const m = SEASON1_MUTATORS.find(mm=>mm.day===date.getDay());
      const badges = before ? [] : mutatorBadgeLabels(m);
      const raid = raidInfo(date);
      // 週をまたぐぶんは、行の端では横に伸ばさない(カレンダーの外にはみ出さないように)
      const raidBar = raid
        ? `<div class="s1prev-cal-raid${raid.first?' is-first':''}${raid.last?' is-last':''}`
          + `${date.getDay()===0?' is-rowstart':''}${date.getDay()===6?' is-rowend':''}">`
          + `${raid.first?'🐉レイド':''}</div>`
        : '';
      return `<div class="s1prev-cal-cell ${before?'before-start':''} ${isToday(date)?'is-today':''}">
        <div class="s1prev-cal-date">${date.getDate()}${isToday(date)?'<span class="s1prev-cal-today-tag">本日</span>':''}</div>
        ${raidBar}
        <div class="s1prev-cal-badges">${badges.map(b=>`<span class="s1prev-badge">${b}</span>`).join('')}</div>
      </div>`;
    }).join('') + `</div>`;
  });
  return html;
}
function season1LegendHtml(){
  if(typeof MUTATOR_LEGEND==='undefined') return '';
  const rows = MUTATOR_LEGEND.map(l=>
    `<div class="s1prev-legend-item"><span class="s1prev-badge">${l.label}</span><span class="s1prev-legend-desc">${l.desc}</span></div>`).join('');
  const raidRow = RAID_ACTIVE
    ? `<div class="s1prev-legend-item"><span class="s1prev-badge s1prev-badge-raid">レイド</span><span class="s1prev-legend-desc">レイドバトル「${RAID_BOSS.name}」の開催期間(${RAID_DURATION_DAYS}日間)</span></div>`
    : '';
  return rows + raidRow;
}
// プレイヤーのシーズン画面に出すスケジュールと説明
function renderSeasonSchedule(){
  const cal = document.getElementById('seasonCalendar');
  if(cal) cal.innerHTML = season1CalendarHtml();
  const legend = document.getElementById('seasonLegend');
  if(legend) legend.innerHTML = season1LegendHtml();
}
function renderSeason1Preview(){
  const track = document.getElementById('season1PreviewTrack');
  if(track && typeof SEASON_REWARDS!=='undefined'){
    track.innerHTML = SEASON_REWARDS.map((r,i)=>{
      const t = i+1;
      const milestone = (t%5===0);
      const rewardMid = r.skin
        ? `<img class="s1prev-card-skin" src="${skinPreviewSrc(r.skin,'front')}" alt=""><div class="s1prev-card-reward">✨${skinMeta(r.skin).name}</div>`
        : `<div class="s1prev-card-reward">${rewardText(r)}</div>`;
      return `<div class="s1prev-card ${milestone?'milestone':''} ${r.skin?'s1prev-card-final':''}">
        <div class="s1prev-card-num">T${t}</div>
        ${rewardMid}
      </div>`;
    }).join('');
  }
  // カレンダーと説明はプレイヤー画面と同じものを使う(2か所に書かない)
  const cal = document.getElementById('season1PreviewCalendar');
  if(cal) cal.innerHTML = season1CalendarHtml();
  const legend = document.getElementById('season1PreviewLegend');
  if(legend) legend.innerHTML = season1LegendHtml();
}
document.getElementById('adminSeason1Btn').addEventListener('click', ()=>{
  renderSeason1Preview();
  document.getElementById('season1PreviewOverlay').classList.remove('hidden');
});
document.getElementById('closeSeason1PreviewBtn').addEventListener('click', ()=>{
  document.getElementById('season1PreviewOverlay').classList.add('hidden');
});

// 管理者確認用: 動画・画像の読み込み状況をチェックしてから昇格演出→SSRリビールまでを通しで再生する
document.getElementById('adminSsrPromoteCheckBtn').addEventListener('click', async ()=>{
  const { video, videoWebm, img } = await checkSsrPromoteAssets();
  // 轟金剛は専用演出なので、確認用には轟金剛以外のSSRを1つ選ぶ
  const sampleSkin = (typeof gachaSsrSkinIds==='function' ? gachaSsrSkinIds().find(id=>id!=='rock_ssr') : null);
  if(!sampleSkin){ alert('確認用のSSRスキンが見つかりません'); return; }
  ssrPromoteDebugMode = true;
  ssrPromoteDebugLines = [];
  // ファイル取得結果は演出パネル(黒画面)の診断表示に直接書き込む(演出に隠れて見えなくなる別要素には出さない)
  ssrPromoteDebugLog('--- 素材読み込み診断(cache:no-store) ---');
  ssrPromoteDebugLog(video);
  ssrPromoteDebugLog(videoWebm);
  ssrPromoteDebugLog(img);
  document.getElementById('closeAdminBtn').click(); // 演出を隠さないよう管理者画面を正規の手順で閉じておく
  openGachaScreen(); // ssrPromoteOverlay/ssrRevealOverlayはガチャ画面の子要素なので、開いておかないと表示されない
  runSsrPromotionSequence(sampleSkin, ()=>{
    showSsrReveal(sampleSkin, ()=>{ pushToast('🎬 演出確認 完了'); ssrPromoteDebugMode = false; });
  });
});
/* 管理者確認用: 指定したSSRスキンの専用昇格演出を、素材の読み込み診断つきで通しで再生する。
   確認するURLは SKIN_MEDIA.promote から作るので、スキンを足してもこの関数は変えなくてよい
   (増えるのはボタン1行と、その下の1行だけ)。 */
async function adminRunPromoteCheck(skinId){
  const p = ((typeof skinMediaOf==='function' && skinMediaOf(skinId)) || {}).promote;
  if(!p || !p.video){ alert('このスキンには専用の昇格演出がありません'); return; }
  const name = (typeof skinMeta==='function') ? skinMeta(skinId).name : skinId;
  const urls = [p.video + '.mp4', p.video + '.webm'];
  if(p.audio) urls.push(p.audio);
  const lines = await checkAssetUrls(urls);
  ssrPromoteDebugMode = true;
  ssrPromoteDebugLines = [];
  // 診断は演出パネル(黒画面)へ直接書く。演出に隠れる別要素には出さない
  ssrPromoteDebugLog(`--- ${name} 素材読み込み診断(cache:no-store) ---`);
  lines.forEach(l=>ssrPromoteDebugLog(l));
  if(typeof ensureSkinPromoteSe==='function') ensureSkinPromoteSe(skinId);
  document.getElementById('closeAdminBtn').click();  // 演出を隠さないよう正規の手順で閉じる
  openGachaScreen();  // 演出のオーバーレイはガチャ画面の子要素なので開いておく
  runSsrPromotionSequence(skinId, ()=>{
    showSsrReveal(skinId, ()=>{ pushToast(`🎬 ${name} 演出確認 完了`); ssrPromoteDebugMode = false; });
  });
}
/* 専用の昇格演出を持つSSRスキンの確認ボタンを SKIN_MEDIA から自動生成する。
   モンスター作成スタジオでSSR昇格演出を追加すると SKIN_MEDIA に promote の行が増えるので、
   index.html もこの関数も触らずにボタンが1つ増える(**手書きの対応表を新しく作らない**)。
   絵文字はスキンごとに持たず🎬で統一する(表を増やすと追記漏れで化けるため)。 */
function renderAdminPromoteCheckBtns(){
  const wrap = document.getElementById('adminPromoteCheckBtns');
  if(!wrap || typeof SKIN_MEDIA==='undefined') return;
  const ids = Object.keys(SKIN_MEDIA).filter(id=> SKIN_MEDIA[id].promote && SKIN_MEDIA[id].promote.video);
  wrap.innerHTML = ids.map(id=>{
    const name = (typeof skinMeta==='function' && SSR_SKINS[id]) ? skinMeta(id).name : id;
    return `<button class="admin-grant-dia-btn" data-promote-skin="${id}">🎬 ${name} 昇格演出確認</button>`;
  }).join('');
  wrap.querySelectorAll('[data-promote-skin]').forEach(b=>
    b.addEventListener('click', ()=>adminRunPromoteCheck(b.dataset.promoteSkin)));
}
renderAdminPromoteCheckBtns();
// 大喰いの利世専用の試合中BGM3曲の素材読み込みを確認するボタン(音自体はBGM確認グリッドから再生)
document.getElementById('adminAquaBattleBgmCheckBtn').addEventListener('click', async ()=>{
  const { battle, final5, lastBattle } = await checkAquaBattleBgmAssets();
  alert(`大喰いの利世 バトルBGM素材診断\n${battle}\n${final5}\n${lastBattle}`);
});
// 管理者画面のタブ切替(プレイ状況 / 音声確認)
function adminShowTab(tab){
  document.querySelectorAll('.admin-tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===tab));
  document.getElementById('adminStatsPane').classList.toggle('hidden', tab!=='stats');
  document.getElementById('adminSePane').classList.toggle('hidden', tab!=='se');
  document.getElementById('adminToolsPane').classList.toggle('hidden', tab!=='tools');
  if(tab==='tools'){ buildAdminSkinMenu(); updateAdminSkinBtn(); buildAdminRebirthMenu(); }
  if(tab!=='se' && typeof bgmSetTrack==='function') bgmSetTrack('title'); // 音声確認タブを離れたらテストBGMを止める
}
document.querySelectorAll('.admin-tab').forEach(t=> t.addEventListener('click', ()=>adminShowTab(t.dataset.tab)));
async function openAdminScreen(){
  document.getElementById('adminScreen').classList.remove('hidden');
  adminShowTab('stats'); // デフォルトはプレイ状況
  adminSelectedPlayer = null;
  adminShowStatSubtab('count'); // プレイ状況内はデフォルトで「プレイ回数」
  document.getElementById('adminTotalMatches').textContent = '読み込み中…';
  document.getElementById('adminMapChart').innerHTML = '';
  document.getElementById('adminMonsterChart').innerHTML = '';
  document.getElementById('adminPlayerList').innerHTML = '';
  renderAdminSeGrid();
  renderAdminBgmGrid();
  adminShowSeSubtab('se'); // 音声確認タブ内はデフォルトでSE
  await fetchAdminMatchLogs(true);
  renderAdminData();
}
document.getElementById('closeAdminBtn').addEventListener('click', ()=>{
  document.getElementById('adminScreen').classList.add('hidden');
  document.querySelectorAll('#adminScreen .custom-select-menu').forEach(m=>m.classList.add('hidden'));
  if(typeof bgmSetTrack==='function') bgmSetTrack('title'); // テストBGMを止めてトップのタイトルBGMへ
  document.getElementById('startScreen').classList.remove('hidden');
});

/* =====================================================================
   LOOP
===================================================================== */

/* =====================================================================
   タイトル画面
   ・起動直後に表示。ロゴのスライドイン中に読み込み(フォント・画像・SW登録)を待つ
   ・終わったら中央に「TAP START」を点滅させ、タップでロビーへ
   ・タップはユーザー操作なので、ここでBGM/SEの起動(audioInit)も済ませる
===================================================================== */
const TITLE_MIN_MS = 1900;   // ロゴのスライドイン+光沢を見せる最低時間
function initTitleScreen(){
  const scr = document.getElementById('titleScreen');
  if(!scr) return;
  const fill = document.getElementById('titleLoadingFill');
  const loading = document.getElementById('titleLoading');
  const tap = document.getElementById('titleTapStart');
  const started = performance.now();
  let ready = false, entered = false;

  // 実際に待つもの: Webフォント / タイトル画像 / ページのload(SW登録・スクリプト)
  const waitImage = (src)=> new Promise(res=>{
    const im = new Image();
    im.onload = im.onerror = ()=>res();
    im.src = src;
  });
  const waitLoad = () => (document.readyState==='complete')
    ? Promise.resolve()
    : new Promise(res=>window.addEventListener('load', res, { once:true }));
  const tasks = [
    (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve(),
    waitImage('images/title_bg.jpg'),
    waitImage('images/title_logo.png'),
    waitImage('images/top_bg.jpg'),
    waitLoad(),
  ];
  // 進捗はタスクの完了数で出す(止まって見えないよう、待っている間も少しずつ進める)
  let done = 0;
  const setPct = p => { if(fill) fill.style.width = Math.min(100, Math.round(p)) + '%'; };
  const tick = setInterval(()=>{
    const byTime = Math.min(88, (performance.now()-started) / TITLE_MIN_MS * 88);
    setPct(Math.max(byTime, done / tasks.length * 100));
  }, 80);
  tasks.forEach(t=>Promise.resolve(t).then(()=>{ done++; }).catch(()=>{ done++; }));

  Promise.all(tasks.map(t=>Promise.resolve(t).catch(()=>{})))
    .then(()=> new Promise(res=>setTimeout(res, Math.max(0, TITLE_MIN_MS - (performance.now()-started)))))
    .then(()=>{
      clearInterval(tick);
      setPct(100);
      ready = true;
      setTimeout(()=>{
        if(loading) loading.classList.add('hidden');
        if(tap) tap.classList.remove('hidden');
      }, 220);
    });

  function enterLobby(){
    if(!ready || entered) return;
    entered = true;
    // タップはユーザー操作なので、ここでオーディオを起動してタイトルBGMを鳴らす
    if(typeof audioInit==='function') audioInit();
    if(typeof playSe==='function') playSe('titleStart');
    if(typeof bgmSetTrack==='function') bgmSetTrack('title');
    scr.classList.add('fading');
    document.getElementById('startScreen').classList.remove('hidden');
    if(typeof maybeFlushPendingPromoPopups==='function') maybeFlushPendingPromoPopups();
    setTimeout(()=>{ scr.classList.add('hidden'); }, 480);
  }
  scr.addEventListener('click', enterLobby);
  window.addEventListener('keydown', (e)=>{
    if(!scr.classList.contains('hidden')) enterLobby();
  });
}

/* =====================================================================
   トップ画面(ロビー)の初期化。
   netState など後方で let / const 宣言している値を読むので、
   必ずファイル末尾(全ての宣言が済んだあと)で実行する。
===================================================================== */
{
  const scr = document.getElementById('startScreen');
  const sync = ()=>{
    // 画面が隠れている間はタイマーを回さない(歩行アニメ・バナー切り替え・部屋の監視)
    if(scr.classList.contains('hidden')){ stopLobbyWalkAnim(); stopLobbyBannerLoop(); stopLobbyRoomPoll(); }
    else refreshLobby();
  };
  new MutationObserver(sync).observe(scr, { attributes:true, attributeFilter:['class'] });

  // マッチング/部屋一覧パネルが出ている間は、背後のロビーを操作させない
  {
    const panels = ['lobbyScreen','roomListScreen'].map(id=>document.getElementById(id)).filter(Boolean);
    const syncBehind = ()=>{
      const open = panels.some(p=>!p.classList.contains('hidden'));
      scr.classList.toggle('behind-matching', open);
    };
    panels.forEach(p=> new MutationObserver(syncBehind).observe(p, { attributes:true, attributeFilter:['class'] }));
    syncBehind();
  }

  // マスモン画面の開閉に合わせてBGMを戻す(トレーニング中に一覧やトップへ抜けた場合)
  const mmScr = document.getElementById('mastermonScreen');
  if(mmScr) new MutationObserver(()=>updateMetaBgm()).observe(mmScr, { attributes:true, attributeFilter:['class'] });

  // ヘッダーのロビーBGMチップ → 曲の選択画面
  const bgmBtn = document.getElementById('headerBgmBtn');
  if(bgmBtn) bgmBtn.addEventListener('click', openLobbyBgmOverlay);
  const closeBgmBtn = document.getElementById('closeLobbyBgmBtn');
  if(closeBgmBtn) closeBgmBtn.addEventListener('click', closeLobbyBgmOverlay);
  const bgmList = document.getElementById('lobbyBgmList');
  if(bgmList) bgmList.addEventListener('click', (e)=>{
    const item = e.target.closest('.lobby-bgm-item');
    if(item) pickLobbyBgm(item.dataset.bgm);
  });
  updateLobbyBgmLabel();

  buildLobbyBanner();
  buildMonsterGrid();
  /* 前回のマップ/プレイモード/参戦モンスターを復元する。
     【順番が重要】起動時の初期値(top-levelの setRealMapMode(false) など)より後で、
     かつ **buildMonsterGrid() より後** に呼ぶこと。復元の最後に renderSelectorCards() が
     走るので、先に呼ぶと #mastermonSelectCard がまだ無くて例外→初期化が止まり、
     「読み込み中」から進まなくなる(実際に起きた)。 */
  restoreLobbyPrefs();
  buildHowtoLists();
  shareBindUi();     // Xへのシェア(常設ボタンの結線。中身は開いたときに作る)
  sync();
  initTitleScreen();
}
