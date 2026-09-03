---
name: aramon-season-raid
description: 荒野モン動のシーズン運用とレイドバトルの手順書。シーズンの開始/切替/SPリセット、シーズンパス報酬、日替わりミューテーター、レイドの公開・ボスHPや報酬の調整、レイドガチャとスキンカタログ、SSRの入手経路を触るときに読む。
---

# シーズン運用・レイド

数字と表はすべて`data.js`。**同じ意味の値が2か所にあるものは下に明記してあるので、片方だけ直さない。**

## シーズンを切り替える / SPをリセットする

**シーズンは「版」で持つ**(レイドの`RAID_EDITIONS`/`RAID_EDITION`と同じ形、2026-08-12導入)。
`SEASON_EDITIONS`が版ごとに`{id, startDate, mutators, rewards, prevFinalSkin}`を1組で持ち、
`SEASON_EDITION`のポインタ1行で選ぶ。`SEASON_ID`/`SEASON_REWARDS`/`SEASON1_MUTATORS`/
`SEASON1_START_DATE`は選ばれている版から作る**参照だけの1行**なので、読む側のコード
(ミューテーター判定・カレンダー表示・シーズンパス画面)は今まで通りでよい。

判定は`seasonStateKey()`(`SEASON_ID` + `SEASON_RESET_EPOCH`)1か所。保存側と食い違えば
`loadSeason()`がSP0・受取状況なしで返す。**どちらか一方を変えるだけでリセットされる。**

**次シーズンへ切り替える手順(`SEASON_EDITIONS`のコメントにも同じ手順を書いてある)**:
1. 新しい版を`SEASON_EDITIONS`へ追記(`id`/`startDate`/`mutators`/`rewards`/`prevFinalSkin`)。
   `prevFinalSkin`には**前の版の`rewards`最終段が指していたスキンid**を書く(切替時にどれを
   解放すればいいか探さずに済む)
2. **前の版の`prevFinalSkin`が指す`SSR_SKINS`のエントリから`seasonExclusive:true`を外し、
   ガチャ・SSRカタログへ解放する**(2026-08-12にラガモッチー`mocchi_ssr`で実施済み。次回はs1の
   最終報酬`aqua_ssr`が対象)。**シーズン最終報酬はシーズンが変わったら毎回このタイミングで解放する運用。**
3. `LOBBY_BANNERS`を見直す(解放したスキンを「新登場・ガチャ」枠へ足すか検討)
4. `SEASON_EDITION`を新しい版のidへ切り替える(`SEASON_RESET_EPOCH`は変更不要。`SEASON_ID`が
   変われば`seasonStateKey()`が自動で変わり、SP・受取状況・段位RPが全員リセットされる)
5. `UPDATE_HISTORY`に告知、`sw.js`の`CACHE_NAME`を上げる

- シーズン途中でリセットしたい(版は変えない) → `SEASON_RESET_EPOCH`を1つ上げる
- **受取状況(`claimed`)も消える。** 最終報酬を配り直したいときはこれで足りる

## 段位(ランクポイント)

- **保存の鍵はシーズンと同じ`seasonStateKey()`**(`loadRank`は`loadSeason`と同型)。**新しい期間の概念を作らない。** シーズンを切り替えるとRPも0に戻る。**到達した最高段位(`best`)だけはまたいで残す。**
- 表は`RANKS`(8段)と`RANK_RP_PLACE`/`RANK_RP_WIN`/`RANK_RP_PER_KILL`/`RANK_RP_MULT`/`RANK_RP_RAID`。**判定は`rankOf(rp)`、計算は`rankRpForMatch(o)`、加算は`addRankRp()`の各1か所。**
- **順位は「上位何%か」で引く。30人固定の表にしない**(4人部屋のマルチでも成立させるため)。上位1割/1/3/2/3で+35/+20/+5、下位1/3だけ−15。1位だけ人数に関係なく+50。
- **降格はその段位の下限で止まる**(段位そのものは落ちない)。`addRankRp`の戻り値`delta`は**実際に動いたぶん**なので、表示はこれを使う。
- **ソロも含めて全モードで動く**(発注者決定)。ソロは`RANK_RP_MULT.solo`で半分。レイドは順位が無いので`RANK_RP_RAID`の固定値。
- 動かすのは`rankOnMatchEnd()`だけで、呼ぶのは`showResultNow`と`raidShowResult`の1回ずつ(どちらも`game.over`ガードの内側)。射撃訓練場では動かさない。
- 表示は4か所: リザルトのバッジ / ロビーのヘッダー(**絵だけ**。名前とRPまで出すと568px幅で所持金がはみ出す) / マイページ(今の段位・次まで・最高段位) / ランキングの「段位」タブ + シェア画像のチップ。
- **段位の絵に💎を使わない**(ヘッダーでダイヤ(通貨)と紛らわしくなる)。チップは所持金の隣に置かない。

### モンスター別RP

- `addRankRp(delta, element)`の第2引数で`loadRank().elem[element]`へ足す。**足すのは実際に動いた量**(下限で止まったぶんは入れない)ので、**`Σelem = rp`が常に成り立つ**。この不変条件が内訳と総量のズレを防いでいるので崩さない。
- 送信は`submitScoreToRanking`の`rankRpSum`。**scoresは「名前×モンスター」で1件**なので、その子のぶんをそのまま入れれば1レコード=1モンスターになる。
- **`rankRpSum`はFirebase側で混ぜない**(`Math.max`も加算もしない)。**負の値を取る**ため最大では消え、加算では再送で二重になる。**端末側の集計が正**で、サーバは最新値を持つだけ。
- レイドのRPも`elem`には入るが、レイドは`scores`へ送らないので、**そのモンスターで次に通常の試合を終えたときにまとめて反映される**。

### ランキングの「段位」タブ

- **カテゴリ名は`RANKING_TABS_BY_CATEGORY`の鍵がそのまま正。** 種類を列挙して判定しない(`rank`が'normal'に落ちて、段位タブにキル数ランキングが出る不具合を出した)。
- 段位タブだけ**行の主役がユーザー名**(1人1行)。`RANK_TAB_MODES`に入っているモードは`renderRankRankingList()`が描く。`aggregateRankRows()`が名前でまとめ、`rankPoint`は最大・内訳は`rankRpSum`をそのまま並べる。
- クラス名は`rankrp-`で始める。`.rank-*`は既存のモンスター中心の行のもの。
- **一覧の幅は420px固定。** 名前を主役の大きさ(15px)で残すと内訳チップは2つまで(`RANK_ELEM_CHIP_MAX`)。内訳は`flex:0 0 auto`で縮めず、足りないぶんは名前が`min-width:84px`まで詰まって「…」になる。**3つにすると3つ目が途中で切れる**(実測)。

## シーズンの中身

| 何 | どこ |
|---|---|
| SPパス報酬25段(最終段が限定SSR) | `SEASON_REWARDS` |
| 1段あたりのSP / 段数 | `SEASON_SP_PER_TIER` / `SEASON_MAX_TIER` |
| 1試合のSP | `seasonSpForMatch()` |
| 曜日ごとの変則ルール | `SEASON1_MUTATORS`(発動は`SEASON1_START_DATE`から) |
| 変則ルールの説明 | `MUTATOR_LEGEND` |

- 公開スイッチは`SEASON1_ACTIVE`。**ミューテーターの発動日は別(`SEASON1_START_DATE`)** なので、前日に立てても当日まで効かない。
- **報酬表を別に持たない。** 準備用の`SEASON1_REWARDS_PREVIEW`が本番の`SEASON_REWARDS`とずれて最終報酬が食い違った(2026-08-07に統合)。管理者プレビューも`SEASON_REWARDS`を見る。
- カレンダーと説明の組み立ては`season1CalendarHtml()`/`season1LegendHtml()`。プレイヤー画面と管理者プレビューで共用。

## レイドを公開する

- `RAID_PREVIEW = false`(準備中の表記とアカウント制限が外れる)
- 出るかどうかは`raidPlayable()`、状態の文言は`raidPhase()`(`preview`/`before`/`open`/`ended`)1か所
- 開催期間は`RAID_START_DATE` + `RAID_DURATION_DAYS`。**判定は端末のローカル時刻**(日本時間で開始日になっていれば開く)
- 準備中は`raidRecordsDisabled()`が真で、記録も報酬も一切残さない

## 次の開催へ切り替える(版 / edition)

**開催ごとに動かす数字は`RAID_EDITIONS`が版ごとに1組で持つ。切り替えは`RAID_EDITION`の1行だけ。**
期間・ボスHP・報酬しきい値は互いに噛み合っているので、別々の場所に置くと片方だけ直して食い違う。

版が持つもの: `startDate` / `durationDays` / `baseHp` / `totalTiers` / `personalTiers` /
`repeatPersonal` / `repeatTotal` / `moveDmg`(ボスの技の威力の**上書きだけ**。表そのものは複製しない)。
`RAID_START_DATE`・`RAID_TOTAL_TIERS`・`RAID_BOSS.baseHp`等は選ばれている版を指すだけなので、
**読む側のコードは今までどおりで動く**(参照の張り方を変えただけ)。

- **【厳守】開催中の版の数字は書き換えない。** しきい値を動かすと「付与済み回数」(`repeatTotal`/`repeatPersonal`)の
  意味が変わり、繰り返し報酬が二重付与/未付与になる。次回ぶんは**新しい版を足して**、終わってから切り替える。
- `weekId`は`RAID_START_DATE`から作る(`raidWeekId()`)ので、**版を変えれば累計は自動で別枠になる**。
  逆に言うと、開催中に開始日を変えると累計がリセットされたように見える。
- 討伐報酬スキンは`RAID_CLEAR_SKIN`を参照する(版の表にIDを直書きしない)。

## 開催の振り返り(管理者画面 → プレイ状況 → レイド分析)

**次の版の数字を決める前に必ずここを見る。勘で決めない。** `matchLogs`のレイド分から自動で出る:

プレイ回数(総数・参加人数・1人あたり・ソロ/マルチ・日別)/ 与ダメージ(平均・中央値・最大・
ソロHPに対する割合)/ 結果の内訳(討伐率・「力尽きた」率=ボスの強さ)/ 1回あたりの実入りと
到達に要る挑戦回数 / **特効スキンの装備率と実測倍率**(設定値との差)/ **次の版への推奨値**。

- 推奨値の出し方: 全体の最終段=「今のペースで期間いっぱい走った量の9割」、
  個人の最終段=「参加者の与ダメージ中央値を期間換算した9割」、ボスHPは1回で削れた割合から。
  **序盤ほど予測がぶれるので終盤の数字を採用する。**
- 「力尽きた」率50%以上=ボスが強すぎ / 1回の平均がソロHPの95%超=HPが低すぎ、35%未満=高すぎ、が判定の目安。
- **母数が足りないものは倍率を出さず「母数不足」と表示する**(特効スキンは装備・非装備とも5件以上)。
  少ない件数から出した倍率で調整すると外す。

## レイドの数字を触る

**一緒に動かすもの**(片方だけ変えると噛み合わない):

- `RAID_BOSS.baseHp`(1回の戦闘) と `RAID_TOTAL_TIERS`の最後の`at`(=全体の討伐目標。レイド画面の「ボスの残り体力」はこの値)
- 1回の与ダメの上限はボスHPで決まる。**ボスHPを下げると1回の報酬(ゴールド/ダイヤ/EXP/SP)も一緒に下がる**
- **ボスの大技の威力は素体のHPと突き合わせる。** 素のHPは70(ピクシー)〜200(プラント)で、
  第1回の`nova`=130は17体中12体を育成なしで即死させていた。マスモンを育てていない人を締め出すので、
  「何体が即死するか」を必ず数えてから決める。

| 何 | どこ |
|---|---|
| 人数ぶんのHP増加 | `RAID_BOSS.hpPerExtraPlayer` → `raidBossMaxHp()` |
| 全体・個人の報酬しきい値 | `RAID_TOTAL_TIERS` / `RAID_PERSONAL_TIERS` |
| 1回のゴールド/ダイヤ | `RAID_RUN_GOLD_PER_DMG` / `RAID_RUN_DIA_PER_DMG` と上限 |
| EXPとSPの換算 | `RAID_PROGRESS_DAMAGE_SCALE`(レイドは与ダメの桁が違うので縮めてから通常の式に通す。掛けないと1回でシーズンパスが数段上がる) |
| 落ちるアイテムの内訳 | `LOOT_MIX_RAID`(通常は`LOOT_MIX_NORMAL`。`lootMix()`で切替、撒く処理は共通) |
| 途中の補給 | `RAID_LOOT_REFILL_EVERY` / `RAID_LOOT_REFILL_COUNT` |
| ボスの技・激化 | `RAID_BOSS_MOVES` / `raidState`(combat.js) |

- 調整したら**必要な挑戦回数**で答え合わせする(例: 個人報酬の最終段 ÷ 1回の上限)。しきい値だけ・HPだけを動かすと体感が大きくずれる。
- 自己ベスト更新は勝利あつかい(`RAID_BEST_IS_WIN`)。リザルトの見出しは討伐/自己ベスト/力尽きた/時間切れの4通り。
- **決着(`checkRaidEnd()`)は`updateRaid()`から毎フレーム呼ぶ。** 「誰かが倒れたとき(`checkWin`)」だけに任せると、**残り時間が0になっても誰も倒れなければ試合が終わらない**(味方botがボスを削り切るまで続いた、という報告が実際にあった)。終了条件は討伐 / 時間切れ(`raidState.endsAt`) / 挑戦者の全滅の3つで、マルチではホストだけが確定させて`raidEnd`イベントで配る。
- **レイドは自分が倒れても試合が続くので、倒れたら残っている味方を観戦する**(`onPlayerDown()`→`startSpectating()`。ソロ・マルチとも、味方botしか残っていなくても観戦する)。観戦中かの判定は`spectatingNow()`1か所で、通常マルチのホスト敗退と共用。**観戦候補(`spectateCandidates()`)からボスを除くこと**(`isRaidBoss`)。観戦状態(`hostSpectating`/`spectateTargetId`)は各試合の開始時に必ず落とし、リザルトでバーを隠す。
- **予告(点線の輪)は`raidTelegraphTime(move)`の長さだけ出す。** 各技の`telegraph`に`RAID_TELEGRAPH_EXTRA`(0.4秒)を足した値で、host/guestとも必ずこの関数を通す(`raidBeginBossAttack`が計算してネットワークにも`tele`として配る。`network.js`側は受け取った値をそのまま使うので直さなくてよい)。
  **`resolveMovement()`はレイドボスが予告中(`raidState.pending`)のあいだ丸ごと移動を止める。** 動けると、予告の輪を出した瞬間の位置から実際の攻撃が発動時にズレて「予告より大きい/ズレた範囲に攻撃が来る」ように見える(実際に報告があった)。**発動(`raidFireBossAttack`)も予告時に記録した`marks[0].x/y`から撃つ**(その場のボスの座標=`b.x/b.y`を読まない)。ボスの通常の位置調整(`repositionEvery`)は予告中も裏で目標地点を更新して構わない(発動が終わればすぐ動き出せる)が、実際に動く処理だけ止めている。
  **予告の点線(`drawRaidTelegraph()`in render.js)は輪の中も塗って光らせる。** 塗る半径・角度は当たり判定(`hitTestFan`/circleの`dist`)に使う値そのもの(`move.range`/`fanAngleDeg`)で、見た目だけ広い/狭いにしない。発動が近づくほど(`fireAt`まで0.6秒未満)明るく・速く点滅させる。
- **最終段のあとは繰り返し報酬**(`RAID_REPEAT_PERSONAL` / `RAID_REPEAT_TOTAL`)。最終段の`at`を超えてから`step`ごとに1回で、**受け取りボタンは出さず`raidGrantRepeatRewards()`がレイド画面を開くたびに未付与ぶんをまとめて渡す**(付与済み回数を`repeatPersonal`/`repeatTotal`に保存するので二重に渡らない)。**しきい値を後から変えると付与済み回数の意味が変わる**ので、開催途中では動かさない。

### 次回開催前にやること

**開催が終わったら、次の版を確定させる前に必ず「レイド分析」タブを開く**(上の節)。
初回(2026-08-07開催)は**想定よりダメージ進行が速く**、最終段に早々に届いて繰り返し報酬を足す対応が必要になった。
この取りこぼしを繰り返さないために、実績の集計と推奨値の算出は分析タブへ寄せてある。

手順: 分析タブの「⑥ 次回の版への推奨値」を見る → `RAID_EDITIONS`に新しい版を足して数字を入れる →
開催が終わってから`RAID_EDITION`を切り替える。**目安は「開催期間の終盤で最終段に届く」。**

## レイドガチャ・カタログ・SSRの入手経路

- SSRの入手経路は`SSR_SKINS`の印で決まる(印が無ければどこでも出る)
  - `seasonExclusive` … シーズンパス報酬限定
  - `raidClearOnly` … レイド討伐報酬限定(どのガチャ・カタログにも出さない)
  - `raidGachaOnly(廃止 2026-09-03: 今は `RAID_EDITIONS[版].exclusiveSkins`。最新の版のものだけ限定)` … レイドガチャとレイドカタログにだけ出す
- 一覧は`gachaSsrSkinIds()`(スキンガチャ・SSRカタログ)と`raidGachaSsrSkinIds()`(レイドガチャ・SSRレイドカタログ)の2つを通す。**印を直接読む場所を増やさない**
- カタログは`sr`/`ssr`/`raidSsr`の3種。中身は`catalogSkinIds(kind)`、名前は`CATALOG_LABEL` 1か所
- レイドガチャは100連で`raidSsr`を1回だけ付与(`RAID_GACHA_CATALOG_AT`)。ピックアップは`RAID_GACHA_PICKUP`
- ガチャ画面はレイド開催中ならレイドタブから開く。記念ポップアップの絵も`promoPickupSkinId()`で切り替わる
- **昇格演出の音声は先読みが要る。** 未ロードだと`play()`が何もせず無音になる。ピックアップは起動時に先読み済み(`ensureSkinPromoteSe`)。演出側も読み込みを待ってから動画と同時に鳴らす

## 追加したら更新するもの

`UPDATE_HISTORY`(プレイに影響する変更のみ)/ `sw.js`の`CACHE_NAME`。
Firebaseに新しいパスを足したらセキュリティルールも要る(発注者が貼るのでJSONを渡す)。
