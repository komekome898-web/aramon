---
name: aramon-screens
description: 荒野モン動の各画面の作り(タイトル・ロビー・カードカルーセル・モンスター一覧・マスモン詳細・射撃訓練場・視点設定・更新履歴・管理者画面)。ui.jsやindex.htmlで画面のUIを直す・足すときに読む。
---

# 画面まわり(ui.js / index.html)

## タイトル

- 起動 → `#titleScreen` → タップ → `#startScreen`(ロビー。HTMLで`.hidden`付き)。
- ロゴの光沢は`background-position`だけ動かす。**要素をtransformで動かすとmaskごと動いて別位置にロゴ形が浮き出る。**
- `initTitleScreen()`が`document.fonts.ready`/各画像/`window.load`を待ち、最低`TITLE_MIN_MS`(1.9秒)は表示。
- **タップ時に`audioInit()`とタイトルBGMを開始**(iOSは操作なしに音を出せない)。タップSEは`titleStart`(未ロード時`jakiin`)。

## ロビー(トップ画面)

- 1画面完結でスクロールしない。`#lobbyLayout`が左メニュー/中央/右の3カラム。
- 左: シーズン/デイリー/ガチャ/ショップ/バッグ/ランキング + 最下部バナー(`LOBBY_BANNERS`に1件足すだけで増える)。
- 中央: ロゴ → `#lobbyMonsterStage`(**これ自体が`<button>`。押すとモンスター選択オーバーレイ。`div`に戻さない**) → 名前 → タップ案内。歩行は`renderLobbyMonster()`が`monsterWalkFrameDataUrls()`のdataURLを差し替える。**マスモン選択中だけ装備スキンを反映。** 未ロードなら静止画のまま0.35秒×6回リトライ。
- 右: マップ/プレイモードの値表示ボタン(押すとオーバーレイ。実体のDOMを移しただけなのでハンドラは不変。表示更新は`updateLobbyPickLabels()`)→ `バトル開始`(`#joinBtn`。光沢スイープは無効時に止める)。
- ヘッダー: ⚙️設定 / 👤マイページ / 🆕更新履歴 / 🎵ロビーBGM切替。**元のボタンをDOMごと移動しただけ**でIDもハンドラも同じ。高さは`--top-header-h`(`#lobbyLayout`と右パネルの`top`も同じ変数)。
- **タイマーは`#startScreen`のclassをMutationObserverで見て、隠れたら停止**(歩行・バナー)。
- **ロビーの初期化ブロックはui.js末尾に置く**(`netState`等を読むためTDZで落ちる)。
- マルチのマッチング(`#lobbyScreen`)と部屋一覧(`#roomListScreen`)は**右側パネル**。背後のロビーを見せるため`#startScreen`を隠さず、`#startScreen.behind-matching`で`#lobbyLayout`/`#topHeader`を`pointer-events:none`にする(付け外しはui.js末尾のMutationObserver1か所)。

## カードカルーセル(モンスター一覧 / マスモンで共用)

- **エンジンは`createCardCarousel(cfg)`(ui.js)1つだけ。挙動の修正は必ずエンジン側で行う。**
- 位置は全部JSがtransformで書く。`st.pos`(小数)が唯一の状態。**`.ml-card`にtransitionを付けない**(ドラッグが鈍る)。吸着は`startAnim()`のrAF。閉じるときは`stopAnim()`必須。
- **無限ループは環状の最短距離`ringDelta(i,pos)`で成立。`pos`を0〜nに正規化すると境界でカードが飛ぶ。**
- 見た目定数は`CARO_*`。カード寸法/間隔はCSSの`--ml-card-h/-w/--ml-step`が正で、JSはプローブ要素(`.caro-step-probe`)の`offsetWidth`で読む(`getComputedStyle`は未登録カスタムプロパティを`calc()`文字列で返す)。**JS側に間隔の数字を書かない。**
- `#mlStage`幅は`calc(var(--ml-step) * 4.4)` + `overflow:hidden`で「少しだけ見切れる」ようにしてある(スワイプできると伝えるため)。
- 1スワイプで2枚飛ばない: 離した位置の最寄りへ吸着し、フリック加算は`target === Math.round(dragStartPos)`のときだけ。
- ドラッグ直後のclickは`st.suppressClick`で**1回だけ**無視する(フラグを残すと詳細が開かなくなる)。
- **送りSE(`cardSwipe`)は`render()`の1か所だけ**で中央インデックス変化時に鳴らす。`reset(key)`は`lastCenterIdx=null`で鳴らさない。送りボタンはaudio.jsの共通タップ音から`.ml-nav`/`.ml-card-nav`を除外して二重鳴り防止。
- 強制横向き対応2か所: ドラッグ量は`toLogicalDelta()`、FLIP演出(`caroFlipCard`)は`isForcedLandscape()`で幅高さを入れ替え`toLogicalPoint()`で論理座標へ。
- 詳細ビューは一覧カードの`cloneNode`。インラインのtransform等を`#mlDetailCardSlot .ml-card`側で`!important`で打ち消している。**`z-index:1 !important`を外すと`≪ ≫`ボタンが隠れる。**
- 詳細のカードは「絵が余りを埋める/本文は必要な高さだけ」のフレックス。`≪ ≫`(`.ml-card-nav`)は背景・枠なしで記号のみ(視認性は`text-shadow`)。

## モンスター一覧 / マスモン詳細

- **モンスター一覧は「素の姿」を選ぶ画面なので装備スキンを一切見ない**: `defaultMonsterImgTag()` / `mlAuraOf()`(`MONSTER_AURA`直引き) / `buildMastermonMovesHtml(key,{ignoreSkin:true})`。ignoreSkinは擬似エンティティの`skinId`をnullにして関連関数をまとめて既定値にする。
- **マスモンは「着せ替え済みの姿」なので逆に装備スキンを反映する**(`equippedIconImgTag` / `getMonsterAura`)。混同しない。
- マスモンカードはLv・実効HP/速さ(`mmEffectiveStats`)・EXPバー・チケット数を出すぶん本文が長いので`.ml-card-art-mm`で絵を50%に下げている。
- マスモン詳細: 左は「カード → 参戦 → 編集/一覧へ」の3ボタンのみ。右は`renderMastermonDetail(key)`が全幅ヘッダー→STATUS+内容を描く。**`mastermonDetailTab===null`が初期画面**で`詳細情報/トレーニング/着せ替え`の3ボタン(技一覧タブは詳細情報に統合済み)。着せ替えタブだけステータス列を出さない。
- STATUSは両画面共用の`caroStatusSecHtml()`。バー下の短縮説明は`STAT_SHORT_DESC`(`MASTERMON_STATS.desc`は長すぎる)。
- ヘッダーはスクロールさせず中身だけスクロール。右端には自前スライドバー`attachVisibleScrollbar()`(iOSのネイティブバーはスクロール中しか出ないため)。両画面共用なので修正はヘルパー側。ResizeObserverは`el._scrollbarRO`に持たせて同時使用でも壊れない。
- `renderMastermonList()`は「カードを作り直す」処理。**登録数が変わったら`build()`、値だけなら`refreshCards()`。改名後はカード再生成も呼ぶ**(詳細カードはcloneなので古い名前が残る)。

## 射撃訓練場

- ロビー右上の「射撃訓練場へ」(`#openRangeBtn`。バトル開始と同じくモンスター未選択では押せない)から`startShootingRange()`。
- **通常の試合と同じ初期化を通し、分岐は`game.trainingRange`1つだけ**にしてある(安置を止める/的の復活/アイテム再出現/勝敗なし)。触る場所は`update()`・`checkWin()`・`updateLootPickups()`・`drawZoneRings`系。
- マップは`wild_real`固定・`applyWorldScale(RANGE_WORLD_SCALE)`で狭くする。**安置は`zoneState.radius`をワールドより大きくして無効化する**(圏外のアイテムは消えてしまうため)。
- 的は`isTargetBot`。`updateTargetBotAI()`が2点間を往復させるだけで攻撃しない。倒すと`updateTrainingRange()`が数秒後に元の位置へ復活させる。射線上の岩は生成後に取り除く。
- アイテムは`rangeRespawn:true`。拾っても消さず`respawnAt`まで隠すだけ(描画側も`respawnAt`を見る)。
- モンスター切替はロビーと同じ`monsterPickOverlay`を開く。**選択画面を閉じたときの戻り先は`game.trainingRange`で分岐**(ロビーを出さずに訓練場へ戻り、`rangeApplyMonsterChange()`でその場で作り直す)。
- HUDは`#hud.range-mode`で安置パネル(`#topRight`)を隠し、`#rangeBar`(モンスター/視点設定/退出)を出す。BGMは`training`。

## 視点設定(視野角・左右/上下の感度)

- 実体は`world.js`の`lookSettings`(既定値`LOOK_DEFAULTS`・範囲`LOOK_LIMITS`)。**変更したら必ず`applyLookSettings()`**(視野角→`FOV_V`→`recomputeFocal()`)。
- **3D側は`window.__aramonLook`を毎フレーム読んでカメラのfovを合わせる。** 2Dの`project()`と視野角がずれると地面と2D描画が食い違う。
- 保存はui.jsの`aramon_look_v1`(端末ごとの操作設定なのでアカウント同期に入れない)。UIは音量設定と同じスライダー部品を流用。

## 更新履歴

- 項目`{t,g}`、タグ定義は`CHANGELOG_TAGS`。見出し+タグ行は固定、`.changelog-list`だけスクロール(自前スライドバー共用)。
- 絞り込みは`changelogFilterTag`。該当0件の日付は行ごと出さない。
- **タグ色は`color-mix()`を使わずJSの`changelogTagVars()`でCSS変数として渡す**(古いiOS非対応)。
- 未読バッジ: `changelogSignature()` = `最新日付#全項目数` を`aramon_changelog_seen_v1`と比較。`UPDATE_HISTORY`に足せば自動で出るのでバッジ側の作業は不要。**アカウント同期には入れない**(端末ごとの状態)。

## レイドバトル

- **入口は2つ**: ロビー左メニューの「🐉レイド」と、プレイモードの「レイドバトル」タブ。**どちらも`raidPlayable(アカウント名)`で出し分ける**(準備中は`RAID_PREVIEW_ACCOUNTS`のみ)。
- **準備中(`RAID_PREVIEW`)のあいだは記録も報酬も一切残さない**(`raidRecordsDisabled()`)。Firebaseの累計・ランキングにも送らず、ゴールド/ダイヤも付けない。**公開するときは`RAID_PREVIEW`をfalseにするだけ。**
- 入口画面: タイトル(紫の発光)→キービジュアル(`images/raid_key.jpg`)→説明→ルールのバッジ→ボスの残り体力と自分の累計→ランキングボタン→報酬2種→特効スキン。
- ランキングは総ダメージ/参加回数の2タブ。**参加回数は`raids/{weekId}/players/{名前}.runs`**(与ダメ報告のトランザクションで一緒に+1する)。自分の行は色を変える。

## 管理者画面

- ロビー最下部「管理者用」→ 4桁パスワード(0008)。プレイヤー名「おりょう」は集計から除外。
- 「プレイ状況」「音声確認」タブ。各ペインは`display:flex`の縦フレックス(blockのままだと内側がスクロール不能)。音声確認内は「SE」「BGM」サブタブで、SEは`SE_DEFS`から自動列挙。このペインでは共通タップSEを鳴らさない。
- 「💎ダイヤ+500」(`#adminGrantDiaBtn`)は現在hidden(機能は残置)。
- 「📊 パフォーマンス表示」は aramon-performance を参照。
