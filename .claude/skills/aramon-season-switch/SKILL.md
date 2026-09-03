---
name: aramon-season-switch
description: 荒野モン動のシーズン切替・レイド開催・レイドガチャのピックアップ更新を「決められた項目を埋めるだけ」で行う定型手順。発注者から「シーズンN開始」「レイド第N回」「ピックアップを○○に」の指示が来たら読む。実装は下位モデルのサブエージェントに任せ、自分は仕様の穴埋めと検査だけを行う。
---

# シーズン切替の定型手順(発注者の指示 → 穴埋め → 下位モデルへ委任 → 検査 → PR)

前提知識は `aramon-season-raid`(版=edition の仕組み・数字の噛み合わせ)。**日付で版が自動で選ばれる**(`editionByDate()`)ので、
切替は「新しい版を足して startDate を書く」だけ。ポインタを手で切り替えない。

## 1. 発注者から聞く項目(足りないものだけ聞く。決まった値は必ず作業メモへ写す)

| 項目 | 例(シーズン2) | 書く場所 |
|---|---|---|
| シーズン id / 期間 | s2 / 2026-09-04〜2026-10-01 | `SEASON_EDITIONS.<id>.startDate/endDate` |
| ミューテーターの曜日周期 | s1 と同じ | `mutators`(共通配列 `WEEKDAY_MUTATORS` を参照。複製しない) |
| 段の報酬 | s1 と同じ / 最終段は「？」 | `rewards`(共通の24段 + 最終段。最終未定なら `{tbd:true}`) |
| 前シーズン最終報酬の解放 | aqua_ssr | `prevFinalSkin` + `SSR_SKINS` から `seasonExclusive` を外す |
| レイド id / 期間 / 総HP | r3 / 2026-09-04 から14日 / 10,000,000 | `RAID_EDITIONS.<id>`(`startDate/durationDays`、`totalTiers` 最終段の `at`) |
| 討伐報酬スキン | あるるかん | `RAID_CLEAR_SKIN`(印は `raidClearOnly`) |
| ボス1回のHP・段の報酬 | 総HPと期間から比例で | `baseHp` / `totalTiers` / `personalTiers` / `repeat*`(答え合わせ=必要な挑戦回数をコメントに) |
| レイド特効 | 電王ライナー 1.5/0.75、他2体 1.3/0.85 | `RAID_EFFECT_SKINS` |
| レイドガチャのピックアップ | 3体・ラベル・絵 | `RAID_GACHA_PICKUP_IDS` / `RAID_GACHA_PICKUP_LABEL` / `RAID_GACHA_PROMO_IMG`(絵は `images/promo_*.jpg` 1280px 以下) |
| 告知 | 3〜4行 | `UPDATE_HISTORY`(開始日の日付ブロック)/ `LOBBY_BANNERS` 先頭 |

## 2. 委任の仕方(トークン節約)

- 上の表を埋めた仕様ファイルを scratchpad に書き、**sonnet の general-purpose エージェント**に「この仕様どおり `data.js`/`ui.js`/`sw.js` を直し、検査を通す」と渡す。自分はコードを書かない。
- 前回の仕様の実物: `tools/season_specs/season2_spec.md`(2026-09-03。このスキルと同じ章立て)。次回はそれを複製して数字を差し替える。
- エージェントに必ず入れる注意: 開催中の版の数字は書き換えない / 同じ配列を版ごとに複製しない / `RAID_GACHA_PICKUP`(単数)は無い=複数形の定数を使う / `.claude/` は編集しない。

## 3. 検査(自分でやる)

```
node --check data.js ui.js sw.js
node tools/changelog_check.mjs
node tools/undef_check.mjs
node -e "…"  # data.js を vm で評価し、日付を差し替えて editionByDate が 前日=旧版 / 当日=新版 を返すこと
node tools/layout_test.mjs   # シーズン画面・ガチャ画面を触ったとき
```
- `sw.js` の `CACHE_NAME` +1 → PR → squash マージ → 「pages build and deployment」success を確認。
- 当日 0時に切り替わるのは「端末のローカル日付」で、開きっぱなしの端末は次に開いたとき。

## 4. 落とし穴
- `SEASON_RESET_EPOCH` は触らない(SEASON_ID が変われば SP・受取・段位RP は自動でリセット)。
- 最終報酬 `{tbd:true}` の段は受け取れない(SP は貯まる)。報酬が決まったら `{skin:'…'}` に差し替えるだけ。
- レイドの版を後から書き換えない(付与済み回数の意味が変わる)。数字は開催前に確定させる。
- 未開催のまま古くなった版(r2 のような)は消してよい。
