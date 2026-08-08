---
name: aramon-season-raid
description: 荒野モン動のシーズン運用とレイドバトルの手順書。シーズンの開始/切替/SPリセット、シーズンパス報酬、日替わりミューテーター、レイドの公開・ボスHPや報酬の調整、レイドガチャとスキンカタログ、SSRの入手経路を触るときに読む。
---

# シーズン運用・レイド

数字と表はすべて`data.js`。**同じ意味の値が2か所にあるものは下に明記してあるので、片方だけ直さない。**

## シーズンを切り替える / SPをリセットする

判定は`seasonStateKey()`(`SEASON_ID` + `SEASON_RESET_EPOCH`)1か所。保存側と食い違えば
`loadSeason()`がSP0・受取状況なしで返す。**どちらか一方を変えるだけでリセットされる。**

- 次シーズンへ → `SEASON_ID`を変える(`s1`→`s2`)。あわせて`SEASON_REWARDS` / `SEASON1_MUTATORS` / `SEASON1_START_DATE`を新シーズンの内容へ
- シーズン途中でリセットしたい → `SEASON_RESET_EPOCH`を1つ上げる
- **受取状況(`claimed`)も消える。** 最終報酬を配り直したいときはこれで足りる

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

## レイドの数字を触る

**一緒に動かすもの**(片方だけ変えると噛み合わない):

- `RAID_BOSS.baseHp`(1回の戦闘) と `RAID_TOTAL_TIERS`の最後の`at`(=全体の討伐目標。レイド画面の「ボスの残り体力」はこの値)
- 1回の与ダメの上限はボスHPで決まる。**ボスHPを下げると1回の報酬(ゴールド/ダイヤ/EXP/SP)も一緒に下がる**

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

### 【次回開催前の宿題】前回の実績で数字を見直す

**開催が終わったら、次回の`RAID_BOSS.baseHp`と報酬段階を決める前に、必ず前回の実績を見る。**
初回(2026-08-07開催)は**想定よりダメージ進行が速く**、最終段に早々に届いて繰り返し報酬を足す対応が必要になった。

見るもの: レイドランキングの総ダメージ(全体の伸び方)/ 管理者画面の「レイド結果別」と参加回数 / 討伐までに掛かった日数。
合わせるもの: `RAID_BOSS.baseHp` と `RAID_TOTAL_TIERS`の最後の`at`(この2つは連動)、`RAID_PERSONAL_TIERS`、繰り返し報酬の`step`。
**目安は「開催期間の終盤で最終段に届く」**。序盤で届くなら全体の目標と個人のしきい値を上げる。

## レイドガチャ・カタログ・SSRの入手経路

- SSRの入手経路は`SSR_SKINS`の印で決まる(印が無ければどこでも出る)
  - `seasonExclusive` … シーズンパス報酬限定
  - `raidClearOnly` … レイド討伐報酬限定(どのガチャ・カタログにも出さない)
  - `raidGachaOnly` … レイドガチャとレイドカタログにだけ出す
- 一覧は`gachaSsrSkinIds()`(スキンガチャ・SSRカタログ)と`raidGachaSsrSkinIds()`(レイドガチャ・SSRレイドカタログ)の2つを通す。**印を直接読む場所を増やさない**
- カタログは`sr`/`ssr`/`raidSsr`の3種。中身は`catalogSkinIds(kind)`、名前は`CATALOG_LABEL` 1か所
- レイドガチャは100連で`raidSsr`を1回だけ付与(`RAID_GACHA_CATALOG_AT`)。ピックアップは`RAID_GACHA_PICKUP`
- ガチャ画面はレイド開催中ならレイドタブから開く。記念ポップアップの絵も`promoPickupSkinId()`で切り替わる
- **昇格演出の音声は先読みが要る。** 未ロードだと`play()`が何もせず無音になる。ピックアップは起動時に先読み済み(`ensureSkinPromoteSe`)。演出側も読み込みを待ってから動画と同時に鳴らす

## 追加したら更新するもの

`UPDATE_HISTORY`(プレイに影響する変更のみ)/ `sw.js`の`CACHE_NAME`。
Firebaseに新しいパスを足したらセキュリティルールも要る(発注者が貼るのでJSONを渡す)。
