# シーズン2 + レイド第3回「あるるかん討伐」 実装仕様(2026-09-04 開始)

すべて `data.js`(表)+ `ui.js`(表示の1〜2か所)+ `sw.js`(CACHE_NAME)。ゲームの仕組みは変えない。
発注者の決定(変えない): 期間 9/4〜10/1 / 最終報酬は「？」表示(後で追加) / RPリセット / ミューテーターはs1と同じ曜日周期 /
レイド 9/4 から2週間・総HP 10,000,000・全体最終段=あるるかんスキン / レイドガチャのピックアップ=電王ライナー・メカビオギドラ・メタルグレイモン(後2体は弱い特効)/ ガチャ画面の絵 = `images/promo_raid_s2.jpg`(配置済み)。

## 1. 日付で版を選ぶ(「日付が変わったタイミングで始まる」)
- 新設 `editionByDate(editions, fallbackId)`(data.js の版の定義の近く、1か所): 端末のローカル日付 `YYYY-MM-DD` を作り、`startDate <= today` の版のうち **startDate が最も遅いもの** の id を返す。該当が無ければ fallbackId。ローカル日付の作り方は既存の `raidOpenNow()`/`raidWeekId()` が使っている関数を使い回す(新しい日付関数を作らない)。
- `const SEASON_EDITION = editionByDate(SEASON_EDITIONS, 's1');` / `const RAID_EDITION = editionByDate(RAID_EDITIONS, 'r1');` に変える(ポインタは「日付で自動」。コメントに「手で固定したいときは文字列を書く」と書く)。
- ページ読み込み時に決まる(開きっぱなしの端末は次に開いたとき切り替わる)。それでよい。

## 2. シーズン2(`SEASON_EDITIONS.s2`)
- `id:'s2'`, `startDate:'2026-09-04'`, `endDate:'2026-10-01'`(新キー。表示にだけ使う。s1 にも `endDate:'2026-09-03'` を足す)。
- `mutators`: s1 と同じ曜日周期。**配列を複製しない**: s1 の配列を `const WEEKDAY_MUTATORS = [...]` として1か所に出し、s1・s2 両方から参照する。
- `rewards`: s1 の 1〜24 段と同じ(**配列を複製せず** `SEASON_REWARDS_BASE24` のような1か所へ出して s1/s2 から `[...base, final]` で組む)。25段目 = `{ tbd:true, label:'？' }`。
- `prevFinalSkin:'aqua_ssr'`。
- s1 の最終報酬 `aqua_ssr`(大喰いの利世)から `seasonExclusive:true` を外す(ガチャ・SSRカタログへ解放。SKILL の手順2)。コメントに日付と理由。
- `SEASON_RESET_EPOCH` は触らない(SEASON_ID が変われば `seasonStateKey()` が変わり SP・受取・段位RPが全員リセットされる)。
- **UI: 25段目が `tbd` のとき**: シーズンパス画面(ui.js 9040〜9070 付近の `r.skin` を見ている所)で「？」の大きな文字+「最終報酬は近日発表」を出す(`season-tier-final` の装飾は付ける)。受け取り処理(ui.js 9000〜9020)は `tbd` の段では**受け取れない**(ボタンを「近日発表」に。SP は貯まったまま、あとで報酬を入れたら受け取れる)。管理者プレビュー・カレンダー(`season1CalendarHtml`/`season1LegendHtml`)は `endDate` を期間表示に使うなら1行、無ければ触らない。
- 期間の表示: シーズン画面に「9/4〜10/1」が出る場所があれば `startDate/endDate` から作る(2か所に日付を書かない)。

## 3. レイド第3回(`RAID_EDITIONS.r3`)
- `r2`(2026-08-21・一度も有効にしていない)は**削除**し、r3 を足す(コメント: r2 は未開催のまま r3 に置き換えた)。
- `startDate:'2026-09-04'`, `durationDays:14`, `baseHp:40000`(1人あたり。r1 の24000から上げる=1回の与ダメと報酬も上がる)。
- `totalTiers`(最終段 = 10,000,000。段階的):
  `{at:200000, gold:1500, dia:20}` / `{at:800000, gold:3000, dia:40, item:'freeTrainTicket', n:3}` / `{at:2000000, gold:5000, dia:60, item:'moveTicket', n:3}` / `{at:4800000, gold:8000, dia:100, items:[{key:'fruit_life',n:1},{key:'accel_elixir',n:1}]}` / `{at:10000000, gold:15000, dia:200, skin:RAID_CLEAR_SKIN}`(RAID_CLEAR_SKIN は既に `'joker_ssr'`=あるるかん。変えない)。
- `personalTiers`(2週間ぶん、r1 の約2倍): `{at:8000, gold:500, dia:5}` / `{at:32000, gold:1200, dia:10, item:'freeTrainTicket', n:1}` / `{at:100000, gold:2500, dia:20, item:'moveTicket', n:1}` / `{at:240000, gold:4000, dia:35, items:[fruit_life 1, accel_elixir 1]}` / `{at:600000, gold:8000, dia:80, items:[fruit_life 1, accel_elixir 1]}`。
- `repeatPersonal: {step:200000, gold:1000, dia:30, item:'freeTrainTicket', n:1}` / `repeatTotal: {step:2000000, gold:5000, dia:70, item:'freeTrainTicket', n:5}`。
- `moveDmg: { nova:105, ring:98, meteor:78 }`(r2 に用意していた値。育成なしの体を即死させない)。
- 答え合わせをコメントに書く: 個人最終段 600,000 ÷ 1回の上限(3人で baseHp×人数ぶん=約84,000)≒ 8回 / 全体 10,000,000 は「1日あたり 715,000 = 1回8万なら 9回/日」。

## 4. レイド特効・レイドガチャ
- `RAID_EFFECT_SKINS` に `metag_ssr:{dmgDealt:1.3, dmgTaken:0.85, name:'メタルグレイモン'}` と `leaf_ssr:{dmgDealt:1.3, dmgTaken:0.85, name:'メカビオギドラ'}` を足す(`warm_ssr` 1.5/0.75 より弱い。`// <<AUTO:RAID_EFFECT_SKINS>>` の**上**に)。
- ピックアップを複数に: `RAID_GACHA_PICKUP_IDS = ['warm_ssr','metag_ssr','leaf_ssr'] /*@raidpickup*/`、`RAID_GACHA_PICKUP_LABEL = '機械モンスター'`、`RAID_GACHA_PROMO_IMG = 'images/promo_raid_s2.jpg'`。**`RAID_GACHA_PICKUP` は残さない**(参照している所を全部直す: data.js 4776/4909-4924、ui.js 2939/3074/3084、他に grep で見つかる所)。
  - 抽選(data.js 4909-4924): ピックアップ3体で SSR 率の半分を等分、残りを他で等分。提供割合の表示(`label`/`pct`)も3体に「(ピックアップ)」。
  - タイトル(ui.js 2939): `RAID_GACHA_PICKUP_LABEL`。ポップアップの絵(ui.js 3074)と待機画面の絵(data.js 4776): `RAID_GACHA_PROMO_IMG`。名前(ui.js 3084): ラベル。
  - `isRaidGachaPickup(id)` を1つ作り、印の判定を関数経由に。
- 記念ポップアップ(`promoIsRaidPickup` が真のとき)の絵も `RAID_GACHA_PROMO_IMG`。

## 5. 告知・その他
- `LOBBY_BANNERS`: 先頭に `{ rar:'SSR', name:'あるるかん討伐', tag:'レイド', img:'images/promo_raid_s2.jpg', size:'cover', pos:'50% 40%', open:'raid' }` を足し、5件超なら末尾を落とす(`open:'raid'` が無ければ既存の open の値の中でレイド画面を開くものを使う。無ければ `'gacha'`)。
- `UPDATE_HISTORY` の先頭に `2026-09-04` のブロック(3〜4行): シーズン2開始(9/4〜10/1・段位RPリセット・最終報酬は近日発表)/ 前シーズン最終報酬「大喰いの利世」がガチャ・カタログに登場 / レイド「あるるかん討伐」(9/4〜9/17・全体討伐でSSR「あるるかん」)/ レイドガチャは機械モンスターピックアップ(電王ライナー・メカビオギドラ・メタルグレイモン。レイド特効)。`node tools/changelog_check.mjs` を通す。
- `sw.js` の `CACHE_NAME` を1つ上げる。
- 検査: `node --check data.js ui.js`、`node tools/changelog_check.mjs`、`node tools/undef_check.mjs`、`node tools/layout_test.mjs`(シーズン画面・ガチャ画面が対象なら)。加えて node で `data.js` を vm 評価して `editionByDate` を **日付を差し替えて**確かめる(9/3 → s1/r1、9/4 → s2/r3、10/2 → s2/r3 のまま)。

## 6. レイド画面の絵(発注者指定)
- `RAID_EDITIONS.r3.keyImg = 'images/raid_arurukan.jpg'`(配置済み)。ui.js の `.raid-key` の img は `RAID_ED.keyImg || 'images/raid_key.jpg'` を1か所で読む(r1 は今の絵のまま)。見出しが版ごとに持てるなら r3 は「あるるかん討伐」。

## 7. ボスを版ごとに持つ(2026-09-03 追記・第3回はボスが「あるるかん」)
- `RAID_EDITIONS.r1.boss = { element:'fire', skinId:'zod_ssr', name:'不死のゾッド', lead:'不死身の巨竜<b>ゾッド</b>が火口に降り立った。' }`、
  `RAID_EDITIONS.r3.boss = { element:'joker', skinId:'joker_ssr', name:'あるるかん', lead:'ジョーカー<b>あるるかん</b>が火口に現れた。' }`。
- `RAID_BOSS` の `element/skinId/name` は `RAID_ED.boss` から読む(`RAID_BOSS` は `RAID_ED` の後で定義されているので読める。無ければ r1 の値)。
  element を変えると `MONSTERS[element]` の trait / dmgDealtMod が乗るか確認し、乗るなら **ボスは fire のまま skinId だけ替える**(スキンが素体の属性を見て弾く場合だけ joker にする)。どちらにしたかコメントに書く。
- index.html の `〜不死のゾッド〜`(`.raid-title-dash`)に id を付け、ui.js のレイド画面描画で `'〜'+RAID_BOSS.name+'〜'` を入れる。
  `raid-lead` の1文目は `RAID_ED.boss.lead` から。「🐉 」の絵文字(raidBossName)は版ごとの絵文字にしない(そのまま)。
- CACHE_NAME +1、`node --check`、`node tools/undef_check.mjs`。
