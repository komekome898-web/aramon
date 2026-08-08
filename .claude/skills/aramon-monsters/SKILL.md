---
name: aramon-monsters
description: 荒野モン動のモンスター追加チェックリスト・SSR/色スキン・歩行アニメーション。新しいモンスターやスキンを足す、スキンの色替えやtier3専用技、歩行スプライトを扱うときに読む。
---

# モンスター・スキン

## 新モンスター追加チェックリスト(1つでも欠けると不具合)

1. `ELEMENTS` 2. `TRAIT_DESC`(ui.js) 3. `SIGNATURE_MOVES` 4. `MOVE_AURA` 5. `MONSTER_AURA` 6. `SKIN_CONFIG`(`source.hue`は実画像からサンプリング) 7. `STATE_CHANGES` 8. `APTITUDE` 9. `WALK_ANIM`(歩行動画があれば) 10. `monsters/<key>.png`・`<key>_player.png`(正方形・被写体が高さの9割・足元が下端付近に正規化)

## 特性は「文言」と「効果」の2つで1組

`TRAIT_DESC`(ui.js)は**説明文だけ**で、効果は別のところに入れる。3通りある。

- **常時かかる倍率** → `ELEMENTS` の行に書く(`dmgTakenMod` / `dmgDealtMod` / `cooldownMod` /
  `gutsRegenMod` / `speedMod` / `hitboxMult`)。エンジンが元から読んでいるので追加実装は要らない。
- **射程・弾速・消費ガッツの増減** → `SIGNATURE_MOVES` の数字そのものへ焼き込む。
  ガリの`godrange`(射程が長い)とハムの`hum`(弾速が速く射程が短い)がこの形。**エンジンに分岐を足さない。**
- **技を当てたときに相手へ起きること** → `data.js` の `TRAIT_ON_HIT` に1行。
  判定は`combat.js`の`applyTraitOnHit()`1か所だけ。
  **既存モンスターぶんはこの表に載っていない**(combat.jsに`element`で直接書いてあり、挙動を変えたくないため)。
  同じ特性idを既存モンスターと共有するときは**この表に足さない**(相手の挙動まで変わる)。

**説明文だけ書いて効果を入れ忘れるのが定番の事故。** 書いたとおりに動くかを必ず1つずつ確かめる。

## 色スキンの5色はオーラ色以外

`SKIN_CONFIG.<key>.colors` は `SKIN_COLOR_ORDER` の6色から**そのモンスターのオーラ色を除いた5色**。
オーラと同じ色を入れると着せ替えでオーラと見分けがつかなくなるので、全モンスターでこの決まりにそろえる
(スタジオは`MONSTER_AURA`から自動で外すので手で選ばない)。

既存にないギミックが要るときはcombat.js/render.jsに新しい`kind`を増やす形で拡張する。
**追加作業の最後に必ず`python3 tools/check_monsters.py`を通す**(上のチェックリストを機械的に強制する)。

## SSR/色スキン

- **画像は`SSR_SKINS`に書けば`ssrSkinImages`が自動生成される**(以前は手書き表で、追記漏れによりカタログ・バッグ・着せ替え・装備時の見た目がすべて素のモンスターに化けた)。**実体生成は`SSR_SKINS`の宣言直後に置く**(前半だとTDZ)。
- **DOM表示は事前ロードに依存させない。** `skinnedIconDataUrl`等は未ロードでも`ssrSkinFileUrl()`でURLを返す。canvasへ描く`skinnedImage`だけはロード済みImageが必要。
- 新SSRの登録先: `SSR_SKINS` / `SSR_SKIN_AURA` / `SSR_SKIN_TIER3`(専用技) / `SKIN_TIER3_SE`(専用SE) / `WALK_ANIM`の`ssr` / 画像2枚。ガチャ・カタログの一覧は自動生成される。
- **SSRの入手経路は`SSR_SKINS`の印3つで決まる**(印が無ければどこでも出る)。`seasonExclusive`=シーズンパス報酬限定 / `raidClearOnly`=レイド討伐報酬限定(どこにも出さない) / `raidGachaOnly`=レイドガチャとレイドSSRカタログにだけ出す。
- **一覧は`gachaSsrSkinIds()`(スキンガチャ・SSRカタログ)と`raidGachaSsrSkinIds()`(レイドガチャ・レイドSSRカタログ)の2つを通す。** 印を直接読む場所を増やさない。カタログの中身は`catalogSkinIds(kind)`1か所(`sr`/`ssr`/`raidSsr`)。
- tier3のオーラ/エフェクト色はSSRもSR色スキンも変える。判定は`skinTier3Aura(skinId)`1か所に集約済みなので、combat.js/network.jsの`effColor`/`auraTint`は触らなくてよい。
- **SSRだけの特典は「tier3の技名と威力」。** SRはオーラ・エフェクトのみ。この線引きを守る。
- `SSR_SKIN_TIER3`は`dmgMult`(倍率だけ)か`move:{...}`(フィールド上書きで性能ごと専用技化。`blast`はマージ)。**`move`に`dmg`を書くときは`dmgMult`を併記しない**(二重適用)。
- **`SSR_SKIN_TIER3`内で`auraColorHex()`を呼ばない。** `SKIN_COLORS`の宣言が後ろにありTDZでdata.js全体が落ちる。色はリテラルで書く。
- **専用技の解決は`skinTier3Move(move, attacker)`で、呼ぶ場所は4か所**: combat.jsの`fireMove`先頭 / network.jsの`tryNonHostPlayerFireVisual` / render.jsのHUD技フィールド / ui.jsの`buildMastermonMovesHtml`。fireMove先頭で解決すれば威力・弾速・射程・爆風・ガッツ・SEはすべて解決後の値で流れる。
- 色の例外フラグ: `keepBaseColor`=本体色は元のまま差し色だけオーラ色 / `keepArcColor`=本体はオーラ色でビリビリだけ既定の紫。ビリビリ2色は`arcColorsFor(tint)`に集約。**`spawnGroundBlast`には弾の`auraTint`を渡す**(渡さないとドームだけ既定色に戻る)。
- スキン別SEは3表(combat.js): `SKIN_TIER3_SE` / `SKIN_SUMMON_SE` / `SKIN_HIT_SE`。`playSe(skinXxxSeName(entity) || '既定SE')`の形なので未定義は自動で既定。
- スキンプレビューは歩行を再生する(`skinWalkFrameDataUrls` + `startSkinPreviewAnim`)。未ロードならnullで静止画のまま(0.35秒×6回リトライ)。閉じたら必ず`stopSkinPreviewAnim()`。

## 歩行アニメーション

- `monsters/<prefix>_walk_f1..8.png`(正面)/`_b1..8.png`(後ろ)。**有効化は`WALK_ANIM`への登録だけ。全15エレメント対応済み**(SSRはラガモッチー/ゼウス/タマモノマエ/フェニックス/イブリース/ちょこ/ペルセポネ)。
- 入口は`getDisplayImage(entity)`→`entityWalkFrameImage(entity)`。`matchTime`でコマ送り、平滑化速度`_mwSpeed`が`WALK_MOVE_EPS`超で歩行中。進行方向とカメラyawの内積で正面/後ろを切替、停止中は静止(自分=後ろ/他=正面)。色スキンは各コマを`recolorToCanvas`して`_walkRecolor`にキャッシュ。**歩行コマ未提供のSSRは`null`を返して静止スキン画像にフォールバック。**
- コマの表示時間`WALK_FRAME_DUR`(0.11秒)はdata.jsと`tools/studio_web.html`に二重に持っているので、**変えたら両方直す。**

## 歩行スプライト生成(tools/build_walk.py)

動画→60fps抽出→自己相関で1周期検出→8コマ→切り抜き→320px・256色透過PNG。背景別モード: `white_alpha`(白背景・隅から連結する白のみ透過)/ `grabcut_alpha`(草・金背景。`gentle`は細い足を守る、`hard`は縁を確定背景に)/ `phoenixcut_alpha`(鳥。かぎ爪の足を明示追加し中央下部限定の縦closeで接続、トサカ復元)。黒背景素材は輝度キー(6→40のランプ)で抜く。

落とし穴:
- **全体を`binary_fill_holes`しない**(渦・発光の輪の内側まで埋まって黒い板になる)。小さな閉じた暗部だけ埋める。
- **保存は`quantize(colors=256, method=Image.FASTOCTREE)`。** `convert('P')`+`transparency=255`は透過が正しく書かれない。
- 動画の透かしは「明るいのに全フレーム動かない画素」をマスクして抜く(矩形塗り潰しは被写体を削る)。数px膨張させる。
- 周期検出は下半身時系列からドリフトを引いた自己相関(生の自己相関はズームに埋もれる)。半周期の負相関×2が周期。
- **【検証必須】全16コマを目視し、突起(トサカ)・足の欠けと足元の背景残りが無いことを確認する。** 自動チェックだけで採用しない(鳥系で何度も手戻りした)。
- **JOBS/MOVに新規ジョブを足すときjob idの重複を必ず`grep`で確認する。** 後勝ちで上書きされ**既存モンスターのスプライトを破壊する**(2026-07-25に発生、復元が必要だった)。
- `W`/`OUTDIR`は環境変数`BUILD_WALK_WORK`/`BUILD_WALK_OUT`で上書き可。セッションごとに更新が要るのは`MOV{}`の動画パスだけ。
