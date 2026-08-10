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
- ヘッダー: ⚙️設定 / 👤マイページ / 🆕更新履歴 / 🎵ロビーBGM。**元のボタンをDOMごと移動しただけ**でIDもハンドラも同じ。高さは`--top-header-h`(`#lobbyLayout`と右パネルの`top`も同じ変数)。🎵は曲名を出すチップで、押すと`#lobbyBgmOverlay`(曲の一覧)。**曲名は長いので`max-width`+`text-overflow:ellipsis`で止める**(詳細は aramon-audio)。
- **ポップ・バッジ・通知ドットには`pointer-events:none`を付ける。** `.mode-tab-wrap`のポップはボタンの**外側**にあるため、付けないとポップの上を押しても何も起きない(「レイドを選んだのに表示が変わらない」の正体)。あわせて**タブの選択は`#modeTabs`への委譲で受け、`.mode-tab-wrap`から中のボタンへ解決する**(`selectModeTab()`)。新しいポップを足したら`style.css`の`pointer-events:none`のセレクタ一覧にも足す。
- **前回の選択(マップ/リアル切替/プレイモード/人数/参戦モンスター)は`aramon_lobby_prefs_v1`に保存し、起動時に`restoreLobbyPrefs()`で戻す。** 端末ごとの操作の好みなので**アカウント同期には入れない**(視点設定と同じ)。**選ぶ場所を足したら`saveLobbyPrefs()`の呼び出しも足す。** **`saveLobbyPrefs()`は復元が済むまで何もしない**(`lobbyPrefsReady`)。起動時のトップレベル初期化(`setRealMapMode(false)`など)からも保存が呼ばれるので、この止め方が無いと**復元より先に既定値で上書きされて前回の選択が消える**(実際にそうなっていた)。 復元は必ず存在チェック付き(消したマスモン→素のモンスター、終わったレイド→ソロ、壊れた値→何もしない)。`setRealMapMode(false)`など起動時の初期値より**後**、かつ**`buildMonsterGrid()`より後**に呼ぶこと。復元の最後に`renderSelectorCards()`が走るので、先に呼ぶと`#mastermonSelectCard`がまだ無くて例外になる。復元自体はtry-catchで包んであるが、**初期化ブロックで例外が出るとタイトルが「読み込み中」から進まなくなる**(`initTitleScreen()`まで到達しないため)。v472で実際に本番を止めた。
- **タイマーは`#startScreen`のclassをMutationObserverで見て、隠れたら停止**(歩行・バナー・部屋の監視)。**新しい定期処理を足したら`refreshLobby()`で開始・隠れた側で停止の両方に足す**(試合中に通信を続けないため)。
- **募集中の部屋の待機人数バッジ**(`updateLobbyRoomBadges` → `#raidWaitBadge`/`#multiWaitBadge`)は`__aramonListOpenRooms('br'|'raid')`を15秒ごとに見るだけ。**バッジを絶対配置でボタンの外へ出さない**(はみ出す/中の文字を覆う。実測で両方発生)。左メニューは幅が固定(最小104px)なので中身に入れると溢れる→**文字の右の空きへ`position:absolute`で重ねる**。プレイモードは縦並びなので値の下に普通に置く。
- **ロビーの初期化ブロックはui.js末尾に置く**(`netState`等を読むためTDZで落ちる)。**このブロックで例外が出るとタイトル画面が「読み込み中」で固まる**(末尾の`initTitleScreen()`が呼ばれない)。DOMを触る初期化を足すときは、そのDOMを作る`buildXxx()`より後に置き、外部要因で失敗しうる処理はtry-catchで包む。
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

## スキン覚醒(育て込んだマスモンの最終形態)

- **覚醒スキンは「ただのSSRスキン」。** `SSR_SKINS`に`awakenOf:'<元のid>'`付きで1行足すだけで、オーラ・tier3の技名と威力・歩行アニメ・アイコン・専用BGM/SEまで既存の表がそのまま効く(表示の入口が`entitySkinId()`→`getEquippedSkin()`の1本だから)。**ゲーム側に新しい分岐を作らない。**
- `awakenOf`付きは**4つ目の入手経路の印**で、`gachaSsrSkinIds()`/`raidGachaSsrSkinIds()`から除外される。全体の所持(`loadSkins().owned`)にも入れず、`ownedSkinsForElement()`が**そのマスモンの`mm.awaken`を見て一覧の末尾に足す**。だから「育てたこの子だけの姿」になり、**着せ替えで元の姿に戻せる**(戻せば強化も外れる)。
- 条件は`AWAKEN_REBIRTH_REQ`(転生回数)と`AWAKEN_STAT_MIN`(6ステータス**すべて**)の2定数だけ。判定は`awakenRequirements()`が「足りないものの一覧」を返し、`canAwakenMastermon()`はそれが空かを見るだけ。**満たしていなくてもボタンは隠さず`disabled`+残り(「転生あと1回・ちから あと100」)を出す** — 長期目標として一番効く。
- **強化は覚醒時に1つ選ぶ**(`AWAKEN_BOOSTS`)。威力/射程/弾速/範囲拡大速度/爆風の広がりのうち、**その子のtier3に効くものだけ**を`applies(move)`で絞って出す。**弾速と範囲拡大速度は同じ`projSpeed`**(AoE技では`fillSpeed`として使われる)なので、片方しか出ない。選んだ結果は`mm.awaken[元のid]='power'`のように残り、`awakenBoostForSkin()`→`ent.awakenBoost`→`skinTier3Move()`/`ssrTier3DmgMult()`へ流れる。マルチではホストが`awakenBoost`をボットの積み荷に載せる。
- 演出は既存の昇格演出に丸ごと乗せる(`runSsrPromotionSequence()`→`showSsrReveal()`)。`SKIN_MEDIA[覚醒ID].promote`に動画を入れれば専用演出になり、入れなければ共通演出だけが流れる。
- 覚醒スキンの**素材はスタジオの「覚醒スキンを作る」で作る**(元スキンの18枚に同じ加工を掛ける。詳細は aramon-monster-tools)。

## エモート(よろこぶ・だいすき・しょんぼり・おこる)

- **新しい画像を1枚も使わない。** 今出ている絵を`transform`で動かすだけなので、モンスターもスキンも増やし放題。定義は`data.js`の`EMOTES` + 並び順は`EMOTE_ORDER`。**増やすときはこの表に1行足すだけ**でロビーのボタンも管理者画面のSE確認も自動で増える。
- 動きは**キーフレームの表**(`keys:[[時刻,{y,sx,sy,rot},補間],…]`)で、`emoteTrack()`が補間する。補間は`s`(既定)/`out`(上昇)/`in`(落下)/`lin`/`back`(行き過ぎて戻る)。数字を触るだけで手触りを変えられる。
- **可愛く見せるための決めごとが3つある。守らないと「ただ揺れている」だけになる**(最初の実装がそれで実機で却下された):
  1. **足元を軸にする** — 再生中だけ`transform-origin:50% 100%`。中心を軸にすると宙に浮いて見える。
  2. **transitionを切る** — `#lobbyMonsterImg`には`transition:transform 0.12s`が付いており、毎フレーム書き換える動きが全部なまる。再生中だけ`transition:none`にして終わったら戻す。
  3. **つぶす→伸びる→行き過ぎる** — 跳ぶ前に必ずしゃがみ、着地で必ずつぶし、戻りは少し行き過ぎてから収める。左右対称の正弦波は使わない。
  繰り返すエモートは`decay`で1回ごとに小さくする(`emoteMotionAt(def,t,loopIdx)`)。
- 再生は`playEmote(el, key, opts)`1か所。**transformだけを書き、レイアウトを動かす値は触らない。** 二重再生の防止・DOMから外れたときの停止・終了時の後始末(transform/軸/transition/srcを元へ戻す)を全部ここが持つ。止めるのは`stopEmote(el)`。`opts.silent`で効果音だけ止める(リザルトはファンファーレと重なるため使う)。
- **効果音はエモートごと**(`EMOTES[k].se` → `SE_DEFS`の`emoteJoy`/`emoteSad`/`emoteAngry`/`emoteLove`。全部Web Audio合成)。**音の拍と動きの拍を揃える**(よろこぶは跳ねる周期0.62秒に合わせて3音)。
- **専用コマ(`EMOTE_FRAMES`)を入れたものだけコマ送りに切り替わる。** 値は`{prefix,n}`で`monsters/<prefix>1..n.png`。スキンIDの指定が素体より優先。無ければ共通モーション。
- 粒は`fx:{ch,n,mode,at,spread,every}`。`mode`は`rise`(舞い上がる)/`fall`(落ちる)/`pop`(頭上で弾ける)でCSSアニメーションが変わる。**1粒ずつ位置・大きさ・傾きを乱す**(`--dx`/`--sc`/`--rot`)。`every:true`なら1周ごとに出し直す。
- 粒は**`document.body`直下に`position:fixed`で置き、`getBoundingClientRect()`の実座標で重ねる**(`.tap-ripple`と同じ理由。ロビーの絵の親が`<button>`でdivを入れられない)。**ただし`#appRoot`は縦持ちで90度回っているので、`html.force-landscape .emote-fx`で粒も同じだけ回す** — 回さないと絵文字が横倒しになり、飛ぶ向きも90度ずれる(実機で発覚)。`pointer-events:none`で自分から消えるのでスクロールロック除外リストへの追加は不要。
- 絵のタップは`pickEmoteForTap()`で**嬉しい側(`tap`の重み)を出やすくする**。可愛がって毎回すねられると愛着の逆になる。
- **リザルトの勝ちだけは絵を動かさず粒だけ出す**(`fxOnly`)。`.resultScreen.win .result-monster-icon`のCSSアニメーションが`transform`を持っており、**CSSアニメーションはインラインの`transform`より強い**ので、両方書くとこちらが無視されるため。
- **`renderLobbyMonster()`は、出しているモンスターが同じままならエモート中に描き直さない**(`img.dataset.lobbySubject`で判定)。歩行コマの読み込み待ちリトライがこの関数を最大6回呼ぶので、素通しにするとエモートが毎回打ち消されて動かない(実際に踏んだ)。
- ロビーのエモート行(`#lobbyEmoteRow`)は`#lobbyMonsterStage`の**兄弟**に置く(ボタンの入れ子は不正)。ステージが`flex:1 1 auto`で余白を吸収するので、行を足してもステージが少し縮むだけで**スクロールは出ない**(667/812/568の3サイズで実測済み)。

## 遠征(`#expeditionOverlay` / `#expeditionPickOverlay`)

- **マスモン(`mm`)には何も保存しない。** 状態を持つのは`aramon_expedition_v1`(data.jsの`loadExpeditions`/`saveExpeditions`)だけ。`mm`の形を変えないでおくため(あとから足す機能が`mm`を丸ごと写す)。
- **拘束の判定は`expeditionIsBusy()`/`expeditionBusyKeys()`1か所。** 見ているのは4か所+1: 参戦ボタン(`mastermonUseBtn`)/ トレーニング実行 / バッグの対象一覧と`useBagItem` / 削除ボタン / 保険として`applyMastermonToPlayer()`。**新しく「マスモンを選ぶ場所」を足したらここも通す。**
- **枠は所持マスモン数で解放**(`EXPEDITION_SLOT_UNLOCKS`。1体=1枠/3体=2枠/6体=3枠)。判定は`expeditionSlotCount()`。
- **報酬は行き先の`stat`との相性で 0.6〜1.7倍**(`EXPEDITION_AFFINITY`)。見込みと実際は同じ`expeditionRewardPreview()`を通すのでズレない。当たり枠とランダムの実だけ`expeditionRollResult()`が引く。
- **受け取りは先に枠を空けて保存してから渡す**(`expeditionClaim`)。二度押し・再読み込みでも二重に受け取れない。
- **状態の判定は純関数**(`expeditionSlotState`)。`loadMastermons()`は多くの画面から呼ばれるので、**読むたびに書き戻さない。**
- 残り時間は1秒ごとに**文字だけ**書き換える(`expeditionTickOnce`)。作り直すのは受け取り待ちへ変わったときだけ。**画面が閉じたら自分で止まり、`#startScreen`が隠れたときも止める。**
- 成果は**新しいオーバーレイを作らず**`#expeditionMain`と`#expeditionResult`を入れ替えて出す。
- **時短アイテム(📯帰還のホラ貝)はバッグから使えない。** 対象がマスモンではなく遠征の枠なので、`renderBagDesc`が`it.expedition`のときだけ個数ゲージ・使用ボタン・対象一覧を隠す。**ガチャのR枠には入れない**(既存のトレチケ・技強化チケットの当たる割合が薄まるため)。
- **ロビー左メニューは8個で埋まっている。** 増やすときは必ず実寸を測ること(`scratchpad`の測定スクリプトと同じ方法で、バナー下端が`#appRoot`の下端を越えないか)。8個に合わせて`#lobbyLeft`の`gap`とボタンの上下`padding`、アイコンの最小サイズを詰めてある。

## 更新履歴

- 項目`{t,g}`、タグ定義は`CHANGELOG_TAGS`。見出し+タグ行は固定、`.changelog-list`だけスクロール(自前スライドバー共用)。
- 絞り込みは`changelogFilterTag`。該当0件の日付は行ごと出さない。
- **タグ色は`color-mix()`を使わずJSの`changelogTagVars()`でCSS変数として渡す**(古いiOS非対応)。
- 未読バッジ: `changelogSignature()` = `最新日付#全項目数` を`aramon_changelog_seen_v1`と比較。`UPDATE_HISTORY`に足せば自動で出るのでバッジ側の作業は不要。**アカウント同期には入れない**(端末ごとの状態)。

## ランキング(`#rankingScreen`)

- **2段のタブ**: 上段(`.rank-map-tab`/`#rankingMapTabs`)が「通常マップ／リアルマップ／マスモン」、下段(`.rank-tab`/`#rankingTabs`)がカテゴリごとの内訳。下段の中身は`RANKING_TABS_BY_CATEGORY`(ui.js)**1か所の表**から`renderRankingModeTabs()`が組み立てる。**種類を増やすときはここへ1行足すだけでよい**(HTMLに書かない。下段クリックは`#rankingTabs`への委譲で受けるので、要素を張り直しても handler は増設不要)。
- 通常マップ/リアルマップ = `kills`/`damage`(`killsNormal`等、地形別にFirebase側で別カウンタ)。マスモン = `mastermonLevel`/`mastermonRebirth`/`mastermonStatTotal`(**マスモン自身の記録なので地形の区別が無い**。フィールド名をそのまま索引に使う)。
- **マスモン系の値は試合終了時の`submitScoreToRanking()`から`scores/{name}__{element}`へ一緒に送る**(専用の集計経路を新設しない)。`mastermonStatTotal`は`mastermonStatTotal(mm)`(data.js、`MASTERMON_STATS`6項目の生値合計)。値は既存の`mastermonLevel`と同じく**Math.maxで積み上げ**(`firebase.js`の`__aramonSubmitScore`)、`mastermonName`が無い記録はランキングから除外する。
- 称号バッジ(`recordTitleBadgesHtml`)はkills/damageの実績を見るので、マスモンタブでも**通常マップの実績として**表示する(地形の指定が無いため)。

## レイドバトル(数字と公開手順は aramon-season-raid)

- **入口は2つ**: ロビー左メニューの「🐉レイド」と、プレイモードの「レイドバトル」タブ。**どちらの経路でも`setLobbyMode('raid')`を通してタブと表示をレイドへ揃える**(詳細は aramon-multiplayer の「プレイモードの持ち方」)。**どちらも`raidPlayable(アカウント名)`で出し分け**、文言は`raidPhase()`で作る。進む前の門番は`raidGuardReady()`1か所(モンスター未選択・期間外はトーストを出してロビーへ戻す。**押しても何も起きない状態を作らない**)。
- 入口画面はタイトル → キービジュアル+説明(横並び) → ボスの残り体力と自分の累計+ランキングボタン → 報酬2枠 → 特効スキンと限定アイテム(それぞれ`raid-cols`で2列)。詰め方の意図は aramon-layout の「スクロール量を減らす」。
- ランキングは総ダメージ/最大ダメージ/参加回数の3タブ。**並べ替えの基準と値の出し方は`RAID_RANK_KINDS` 1か所**、行は1組だけ持ってタブごとに並べ替える。`raids/{weekId}/players/{名前}`に`dmg`/`runs`/`best`を与ダメ報告のトランザクションで一緒に積む。
- **取得の失敗を握りつぶさない。** 空表示と区別できず原因が追えなくなる(実際に`orderByChild`の`.indexOn`不足で空のまま止まった)。理由と再読み込みボタンを出す。
- リザルトは通常の試合と共用。レイドでは`setResultButtonsForRaid(true)`で「レイドランキング」に差し替える。

## 管理者画面

- ロビー最下部「管理者用」→ 4桁パスワード(0008)。プレイヤー名「おりょう」は集計から除外。
- 「プレイ状況」「音声確認」タブ。各ペインは`display:flex`の縦フレックス(blockのままだと内側がスクロール不能)。音声確認内は「SE」「BGM」サブタブで、SEは`SE_DEFS`から自動列挙。このペインでは共通タップSEを鳴らさない。
- **プレイ状況は`matchLogs`(Firebase)の一件ずつのログが元データ。** 通常の試合は`logMatchForAdmin()`、レイドは`logRaidMatchForAdmin()`(`raidShowResult`内、`noRecord`=準備中/デモは記録しない)。**レイド分は`raid:true`と`raidDamage`/`raidResult`を追加で持つだけで、`map:'raid'`(`MAPS.raid`)は通常の地形と同じ扱い**なので地形別チャートは変更不要。モード表示(ソロ/マルチ/レイド)は`adminModeLabel(r)`1か所に集約。新しいモード・ログ項目を足すときはここを起点にする。
- **1試合の成績(`sec`/`kills`/`dmg`/`skin`)は`matchOutcomeFields()`1か所**で作り、通常戦とレイドで同じ形にする。**記録は後から遡れないので、集計に使いたい値は早めに足す。**
- **後から足したフィールドは古いログに入っていない。** 勝率・プレイ時間は必ず**「持っているログだけで割る」**(`typeof r.win==='boolean'`等で母数を絞り、母数も画面に併記する)。0除算と「古い記録＝負け」の誤集計を両方防ぐ。表示は`adminSecLabel`/`adminWinLabel`が`—`/空欄に落とす。
- 時間帯別グラフは`ts`だけで出せるので**過去のログもそのまま集計できる**。0件の時間は行ごと出さない(24行は縦を食うだけ)。
- 「💎ダイヤ+500」(`#adminGrantDiaBtn`)は現在hidden(機能は残置)。
- **「機能」タブのSSR昇格演出の確認ボタンは`SKIN_MEDIA`から自動生成**(`renderAdminPromoteCheckBtns()` → `#adminPromoteCheckBtns`)。`promote.video`を持つスキンのぶんだけ並ぶので、スキンを足してもHTMLもJSも触らなくてよい。**包んでいるdivは親と同じ縦フレックスにしておく**(divで包むと1つのフレックス項目になり、中のボタンが横に流れる)。
- 「📊 パフォーマンス表示」は aramon-performance を参照。

## Xへのシェア(`#shareOverlay`)

- **Xのツイート用URLには画像を添付できない。** 画像付き投稿の唯一の道が`navigator.share({files})`(Web Share API Level 2)で、
  OSの共有シートを経由してXアプリへ渡す。非対応端末は「画像を長押し保存 →`<a target="_blank">`で投稿画面を開く → 手で添付」へ落とす。
- **画面に出す文言は「SNS」で統一する。**(共有シートはX以外にも送れるため)。X固定なのは
  非対応端末の逃げ道(`x.com/intent/post`)だけで、そのボタンも「投稿画面を開く」と名乗る。
  ボタンの絵は共有マーク(右へ飛ぶ矢印)。**SVGは`style.css`の`--share-ico-svg`1か所だけ**にあり、
  使う側は`<span class="share-ico"></span>`と書く(`currentColor`に追従する)。
- **`share()`はタップのハンドラから同期で呼ぶ。** `onShareBtnTap()`に`await`を足すとユーザー操作の資格が切れ、
  iOSが`NotAllowedError`で撥ねる。**画像(File)は`openShareOverlay()`で作り終えてある。**
- 呼ぶ順序は **`navigator.share()`が先、`clipboard.writeText()`が後**。
  Xのアプリが画像だけ受け取って本文を捨てることがあるので、同じタップの中で必ずコピーもしておく。
- **`AbortError`(共有シートを閉じただけ)は失敗ではない。** 黙って`ready`へ戻す。エラー表示を出すと壊れて見える。
- 見た目の出し分けは`data-state`属性1つ(building/ready/unsupported/sharing/done/error)。**JS側でクラスを付け替えない。**
- **`#shareOverlay`は`z-index:760`。** SSR獲得画面を包む`#gachaOverlay`(620)より上に出す必要がある
  (`.mastermon-confirm-overlay`の既定600のままだと獲得画面の裏に隠れる)。
- 連打・開き直しは`_shareState.seq`で捨てる。`await`明けにseqが一致しなければ何もしない。
- 入口は6か所。**リザルトだけは表示のその場で`_lastResultShare`に控える**
  (`player`は次の試合で作り直され、報酬はブロック内のローカル変数なので後から読めない)。
  ランキング系は一覧を描くたびに`setRankShareTarget()`を呼び、**自分が載っているときだけボタンを出す**。
  ガチャ結果とSSR獲得画面は**どこを触っても閉じる/進むので`e.stopPropagation()`が必須**。
- マスモン詳細の入口は`MM_MENU_ITEMS`に1行足すだけ(`tab`ではなく`action:'share'`。転生ボタンと同じ形)。
- **投稿文の末尾は`buildShareText()`1か所で組む。** 並びは【空行 → タグ → PWAの案内(`SHARE_PWA_HINT`) → URL】で全カード共通。
  **画面ごとに書き足さない**(位置がずれる)。文言と`SHARE_URL`は`data.js`にだけ置く。
  Xは URL=23 / 日本語=2 / ASCII=1 で数えて上限280。`SHARE_TEXT_MAX_UNITS`(250)を超えたら**本文の末尾から削る**ので、
  いちばん落としてよい行を最後に置く。**数値や適正は画像側で見せているので文面で繰り返さない。**
