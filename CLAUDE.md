# 荒野モン動 (Aramon) — プロジェクトガイド

iPhoneブラウザ(PWA)向けTPSバトルロイヤル。HTML5 Canvas + バニラJS + Firebase Realtime Database。ビルドステップなし。GitHub Pagesでホストし、mainマージで自動デプロイ。
公開URL: https://komekome898-web.github.io/aramon/index.html

## 絶対に守るルール

1. **コミットのたびに `sw.js` の `CACHE_NAME` を1つ上げる**(例 `aramon-cache-v335` → `v336`)。上げないと古いキャッシュが残る。例外: ドキュメントのみの変更。
2. **本番公開まで自動で完了させる。** 作業ブランチへpush後、確認なしでmainへPR作成→マージ。GitHub Actions「pages build and deployment」の成功を確認してから完了報告する(発注者合意済み)。
3. **ビルドツール・npm・フレームワークを導入しない。** 素のJS/CSS/HTMLを維持。
   **例外(発注者判断・2026-07-28)**: 「リアルマップ(テスト)」のみThree.jsを使う。`vendor/three.module.min.js`を同梱するだけで、package.jsonもnode_modulesもビルド手順も無い。**この例外を他機能へ広げない。**
4. **モジュール分割構成を維持する。** 新機能も既存の担当ファイルに追記。1ファイルに戻さない。
5. **動作する実用的な解を優先。** 指示のない大規模リファクタはしない。
6. **プレイに関わる大きな変更をしたら `data.js` の `UPDATE_HISTORY` に1行追記する。** 形式は `{ t:'本文', g:['タグid',…] }`、タグは`CHANGELOG_TAGS`(全般/新要素/モンスター/バランス/ソロ/マルチ/不具合/演出・音)から必要なだけ。対象=新機能・仕様/バランス変更などプレイに影響するもの。対象外=レイアウト・見た目・軽微なバグ修正・内部リファクタ・ドキュメント。日付は降順、文言は技術用語を避けた簡潔な日本語。複数の大きな変更は複数行に分ける。

## ファイル構成

| ファイル | 担当 |
|---|---|
| `index.html` | 全画面のDOM。読み込み順: firebase.js(module) → data.js → audio.js → world.js → combat.js → render.js → input.js → ui.js → network.js |
| `style.css` | 全スタイル。CSS変数は`:root` |
| `data.js` | 定数・マスタ: WORLD/MAPS/ELEMENTS/SIGNATURE_MOVES、マスモン(育成/EXP/倍率)、試合内アイテム、アカウント系(通貨・バッグ・ガチャ・ショップ・報酬)、`UPDATE_HISTORY`、オーラ/SSRスキン、色スキン(`SKIN_CONFIG`/`recolorToCanvas`)、歩行アニメ(`WALK_ANIM`/`getDisplayImage`)、`real3dHeightAt` |
| `audio.js` | BGM/SE。原則Web Audio合成、一部のみ実音源(下記「音」) |
| `world.js` | ワールド生成、安全圏、地形判定、移動・衝突、強制横向き/リサイズ |
| `combat.js` | 攻撃・ダメージ・AoE・状態変化・Bot AI |
| `render.js` | 3D風投影(`project`)、全描画、ミニマップ、touchmove制御 |
| `input.js` | タッチ/キー入力、ジョイスティック、カメラ、文字入力ポップアップ |
| `ui.js` | 画面遷移、リザルト、ランキング、マスモンUI、管理者画面、localStorage、アカウント、バッグ/ガチャ/ショップ、ロビー |
| `network.js` | マルチ同期(ホスト権威型) |
| `firebase.js` | Firebase初期化・API。`window.__aramon*`で公開(ESモジュールの橋渡し) |
| `real3d.js` / `vendor/three.module.min.js` | リアルマップのWebGL描画(`window.__aramonReal3D`)/ Three.js r160(MIT) |
| `sw.js` / `manifest.json` | SW(ネットワーク優先+キャッシュ) / PWAマニフェスト |
| `monsters/*.png` | モンスター画像。静止画+歩行スプライト `<prefix>_walk_f1..8` / `_b1..8`(320px・256色透過) |
| `tools/build_walk.py` | 歩行スプライト生成の開発用スクリプト(ゲームには読み込まない) |
| `top_bg.jpg` / `title_bg.jpg` / `title_logo.png` | ロビー背景 / タイトル背景・ロゴ(ロビーのタイトルも同ロゴ) |
| `bgm_*.mp3` | final5(残り5人)/ lastbattle(残り2人)/ shop / lobby(既定)/ training。mono 96k・`loudnorm=I=-16:TP=-1.5:LRA=11` |
| `se_*.mp3` / `best_update.mp3` | 3秒級以上のSE実音源(短いSEは内蔵データURI) |

## 全画面に効く決まり

- **【メディアクエリ禁止】レイアウトに`@media`を使わない。** 強制横向きでは実viewportが縦のままなので基準が食い違う(詳細2列が1列に落ちる不具合が実際に出た)。幅で分岐したいときは`html.narrow-screen`(world.jsが実画面幅520px以下で付与)。
- **【生のvw/vh禁止】サイズは`calc(N * var(--vh))`/`var(--vw)`で書く。** 生の`vh`は強制横向きで大きくなり上下が見切れる。`:root`の`--vw/--vh`定義だけが例外。
- **画像は`height`固定でなく`max-height`+`flex:0 1 auto`+`object-fit:contain`。** 縦の狭い端末で縮んで収まる。
- **【スクロールロック除外・必須】新しい画面/オーバーレイを足したらIDを3か所すべてに追加する:** `render.js`の`touchmove`、`input.js`の`touchend`と`dblclick`。漏れるとスクロールもタップも効かない(管理者/ランキング/観戦バー/文字入力で実際に踏んだ)。3リストは同じ内容に保つ。
- **ポップアップ(`.mastermon-confirm-overlay`系)の定型**: 幅は複合セレクタ`.mastermon-confirm-box.xxx-box{ max-width:min(760px, calc(95 * var(--vw))); width:同 }`(単一クラスだと基底の340pxに負ける)/ `position:relative`必須(無いと`.overlay-close-btn`が画面隅へ飛ぶ)/ `max-height:calc(94 * var(--vh)); overflow-y:auto`(基底にも入っているが明示推奨。内側に別のスクロールを重ねない)。
- プルダウンは`.custom-select`の自前実装を再利用。外枠はoverflow可視・中のリストだけ独立スクロール。
- 横長・低い画面が前提。新画面はスクロールなしで収まる縦幅にする。
- **長押しの選択/メニュー抑止は全画面共通で入っている**(個別対応不要): style.cssの`*`に`user-select:none`+`-webkit-touch-callout:none`、直後の`input,textarea{user-select:text}`とセットで維持。input.jsが`contextmenu`/`selectstart`を`preventDefault`(入力欄は除外)。`-webkit-touch-callout`は計算値に出ないのでCSSテキストで確認する。
- **文字入力はすべて共通ポップアップ(`#textInputOverlay`)。** iOSのキーボードは実画面下=強制横向きではアプリ右側を覆うため、どこに置いても隠れうる。アプリ全体をずらす方式は実機で破綻したので使わない(2026-07-27に試して差し戻し)。仕組み: `focusin`(capture)で元の`<input>`を`readOnly`+`blur()`し、ポップアップの欄に`focus()`(**タップと同じターンで呼ぶ**)。確定時に値を書き戻して`input`/`change`を発火。document委譲なので新しい入力欄への個別対応は不要。見出しは`data-kb-title`→直前要素のテキスト(20文字以内)→`placeholder`。位置は通常上端中央/強制横向き時は左寄せ。

## 画面まわり

### タイトル
- 起動 → `#titleScreen` → タップ → `#startScreen`(ロビー。HTMLで`.hidden`付き)。
- ロゴの光沢は`background-position`だけ動かす。**要素をtransformで動かすとmaskごと動いて別位置にロゴ形が浮き出る。**
- `initTitleScreen()`が`document.fonts.ready`/各画像/`window.load`を待ち、最低`TITLE_MIN_MS`(1.9秒)は表示。
- **タップ時に`audioInit()`とタイトルBGMを開始**(iOSは操作なしに音を出せない)。タップSEは`titleStart`(未ロード時`jakiin`)。

### ロビー(トップ画面)
- 1画面完結でスクロールしない。`#lobbyLayout`が左メニュー/中央/右の3カラム。
- 左: シーズン/デイリー/ガチャ/ショップ/バッグ/ランキング + 最下部バナー(`LOBBY_BANNERS`に1件足すだけで増える)。
- 中央: ロゴ → `#lobbyMonsterStage`(**これ自体が`<button>`。押すとモンスター選択オーバーレイ。`div`に戻さない**) → 名前 → タップ案内。歩行は`renderLobbyMonster()`が`monsterWalkFrameDataUrls()`のdataURLを差し替える。**マスモン選択中だけ装備スキンを反映。** 未ロードなら静止画のまま0.35秒×6回リトライ。
- 右: マップ/プレイモードの値表示ボタン(押すとオーバーレイ。実体のDOMを移しただけなのでハンドラは不変。表示更新は`updateLobbyPickLabels()`)→ `バトル開始`(`#joinBtn`。光沢スイープは無効時に止める)。
- ヘッダー: ⚙️設定 / 👤マイページ / 🆕更新履歴 / 🎵ロビーBGM切替。**元のボタンをDOMごと移動しただけ**でIDもハンドラも同じ。高さは`--top-header-h`(`#lobbyLayout`と右パネルの`top`も同じ変数。**数値を直書きしない**)。
- **タイマーは`#startScreen`のclassをMutationObserverで見て、隠れたら停止**(歩行・バナー)。
- **ロビーの初期化ブロックはui.js末尾に置く**(`netState`等を読むためTDZで落ちる)。
- マルチのマッチング(`#lobbyScreen`)と部屋一覧(`#roomListScreen`)は**右側パネル**。背後のロビーを見せるため`#startScreen`を隠さず、`#startScreen.behind-matching`で`#lobbyLayout`/`#topHeader`を`pointer-events:none`にする(付け外しはui.js末尾のMutationObserver1か所)。

### カードカルーセル(モンスター一覧 / マスモンで共用)
- **エンジンは`createCardCarousel(cfg)`(ui.js)1つだけ。挙動の修正は必ずエンジン側で行う。**
- 位置は全部JSがtransformで書く。`st.pos`(小数)が唯一の状態。**`.ml-card`にtransitionを付けない**(ドラッグが鈍る)。吸着は`startAnim()`のrAF。閉じるときは`stopAnim()`必須。
- **無限ループは環状の最短距離`ringDelta(i,pos)`で成立。`pos`を0〜nに正規化すると境界でカードが飛ぶ。**
- 見た目定数は`CARO_*`。カード寸法/間隔はCSSの`--ml-card-h/-w/--ml-step`が正で、JSはプローブ要素(`.caro-step-probe`)の`offsetWidth`で読む(`getComputedStyle`は未登録カスタムプロパティを`calc()`文字列で返す)。**JS側に間隔の数字を書かない。**
- `#mlStage`幅は`calc(var(--ml-step) * 4.4)`+`overflow:hidden`で「少しだけ見切れる」ようにしてある(スワイプできると伝えるため)。
- 1スワイプで2枚飛ばない: 離した位置の最寄りへ吸着し、フリック加算は`target === Math.round(dragStartPos)`のときだけ。
- ドラッグ直後のclickは`st.suppressClick`で**1回だけ**無視する(フラグを残すと詳細が開かなくなる)。
- **送りSE(`cardSwipe`)は`render()`の1か所だけ**で中央インデックス変化時に鳴らす(全経路をカバー)。`reset(key)`は`lastCenterIdx=null`で鳴らさない。送りボタンはaudio.jsの共通タップ音から`.ml-nav`/`.ml-card-nav`を除外して二重鳴り防止。
- 強制横向き対応2か所: ドラッグ量は`toLogicalDelta()`、FLIP演出(`caroFlipCard`)は`isForcedLandscape()`で幅高さを入れ替え`toLogicalPoint()`で論理座標へ。
- 詳細ビューは一覧カードの`cloneNode`。インラインのtransform等を`#mlDetailCardSlot .ml-card`側で`!important`で打ち消している。**`z-index:1 !important`を外すと`≪ ≫`ボタンが隠れる。**
- 詳細のカードは「絵が余りを埋める/本文は必要な高さだけ」のフレックス。`≪ ≫`(`.ml-card-nav`)は背景・枠なしで記号のみ(視認性は`text-shadow`)。

### モンスター一覧 / マスモン詳細
- **モンスター一覧は「素の姿」を選ぶ画面なので装備スキンを一切見ない**: `defaultMonsterImgTag()` / `mlAuraOf()`(`MONSTER_AURA`直引き) / `buildMastermonMovesHtml(key,{ignoreSkin:true})`。ignoreSkinは擬似エンティティの`skinId`をnullにして関連関数をまとめて既定値にする。
- **マスモンは「着せ替え済みの姿」なので逆に装備スキンを反映する**(`equippedIconImgTag` / `getMonsterAura`)。混同しない。
- マスモンカードはLv・実効HP/速さ(`mmEffectiveStats`)・EXPバー・チケット数を出すぶん本文が長いので`.ml-card-art-mm`で絵を50%に下げている。
- マスモン詳細: 左は「カード → 参戦 → 編集/一覧へ」の3ボタンのみ。右は`renderMastermonDetail(key)`が全幅ヘッダー→STATUS+内容を描く。**`mastermonDetailTab===null`が初期画面**で`詳細情報/トレーニング/着せ替え`の3ボタン(技一覧タブは詳細情報に統合済み)。着せ替えタブだけステータス列を出さない。
- STATUSは両画面共用の`caroStatusSecHtml()`。バー下の短縮説明は`STAT_SHORT_DESC`(`MASTERMON_STATS.desc`は長すぎる)。
- ヘッダーはスクロールさせず中身だけスクロール。右端には自前スライドバー`attachVisibleScrollbar()`(iOSのネイティブバーはスクロール中しか出ないため)。両画面共用なので修正はヘルパー側。ResizeObserverは`el._scrollbarRO`に持たせて同時使用でも壊れない。
- `renderMastermonList()`は「カードを作り直す」処理。**登録数が変わったら`build()`、値だけなら`refreshCards()`。改名後はカード再生成も呼ぶ**(詳細カードはcloneなので古い名前が残る)。

### 更新履歴
- 項目`{t,g}`、タグ定義は`CHANGELOG_TAGS`。見出し+タグ行は固定、`.changelog-list`だけスクロール(自前スライドバー共用)。
- 絞り込みは`changelogFilterTag`。該当0件の日付は行ごと出さない。
- **タグ色は`color-mix()`を使わずJSの`changelogTagVars()`でCSS変数として渡す**(古いiOS非対応)。
- 未読バッジ: `changelogSignature()` = `最新日付#全項目数` を`aramon_changelog_seen_v1`と比較。`UPDATE_HISTORY`に足せば自動で出るのでバッジ側の作業は不要。**アカウント同期には入れない**(端末ごとの状態)。

### 管理者画面
- ロビー最下部「管理者用」→ 4桁パスワード(0008)。プレイヤー名「おりょう」は集計から除外。
- 「プレイ状況」「音声確認」タブ。各ペインは`display:flex`の縦フレックス(blockのままだと内側がスクロール不能)。音声確認内は「SE」「BGM」サブタブで、SEは`SE_DEFS`から自動列挙。このペインでは共通タップSEを鳴らさない。
- 「💎ダイヤ+500」(`#adminGrantDiaBtn`)は現在hidden(機能は残置)。

## 描画(render.js)

- `project(wx,wy,wz)`で3D風投影。`drawables`に集めてdepthソート後に描画。
- **TPSカメラは`world.js`の`CAM_DIST_BEHIND`(145)と`CAM_HEIGHT`(90)の2つ。必ずセットで調整する。** distBehindを縮めると大きくなる代わりに画面下へ動き足元が隠れるので、heightで戻して「大きさだけ変える」。変更したら`project(player.x,player.y,0)`のyと遠景の地面Yを実測して確認。
- カリングは`cullMarginFor`で見た目半径に応じた余白(固定余白だと巨大オブジェクトが近距離で消える)。`kind:'ae'`には`ae.range`ぶんの余白。
- 障害物は影(接地点)と本体の底を接して描く。
- **`areaEffects`も`drawables`に`kind:'ae'`として積む**(実描画は`drawSingleAreaEffect`)。地面直後の一括描画だと大岩・建物の裏に隠れる。
- **地面に貼り付く円は画面上で楕円を決め打ちしない。** `groundCirclePoints()`でワールド円周をサンプルし1点ずつ投影して多角形で描く。**このカメラの地面円の扁平率は約0.165**で、`ry=rx*0.5`のような固定比だと3倍近く縦に伸びて浮いて見える。立体物の高さも`project(x,y,高さ)`で求める。
- **地面に接する物は`projectGround(x,y)`で投影する**(`groundZAt()`は他マップで0を返すので見た目不変)。エンティティに紐づく地面描画(召喚円盤石・降下ビーム)は`e.z`を使う。

## リアルマップ(テスト): WebGL地形(real3d.js)

- **地面だけWebGLで描き、モンスター・弾・エフェクト・HUDは従来の2Dキャンバスが上に重なる**(`#glCanvas` z:0 / `#gameCanvas` z:1)。この分担なので既存描画を書き換えずに済んでいる。
- **2Dの`project()`と3Dカメラを完全に一致させてある**(`FOV_V`=64° / `camPos` / `camState.yaw,pitch`)。**`FOV_V`や`CAM_*`を変えたらreal3d.js側も合わせる。** 丘による遮蔽は2D側に無い(割り切り)。
- **高さは`data.js`の`real3dHeightAt(x,y)`。純関数なのでホスト/ゲストで自動一致**し、当たり判定(`world.js`の`getTerrainHeightAt`)も同じ関数を使う。
- **`REAL3D_TERRAIN`の最大傾斜は0.3程度まで。** ダッシュは1フレーム20単位進むので、超えると`CLIMB_TOLERANCE`(12)を越えて坂を登れなくなる。
- **岩・水晶の「登っているからすり抜ける」判定は`baseTerrainHeightAt`基準**(絶対値`m.z>25`だと起伏だけですり抜ける)。
- **細かい質感はテクスチャで出す。** メッシュ分割は約50単位なので、それより細かい起伏を`REAL3D_TERRAIN`に足してもジャギーになるだけ。`buildGroundTexture()`が値ノイズのタイルを生成。**UVオフセットをパッチ位置に合わせること**(`tex.offset.set(sx/TEX_TILE, -sy/TEX_TILE)`。`uv.y`は`rotateX(-π/2)`で反転するので符号が逆)。無いと模様が地面の上を滑る。
- 地面の色は「高さ+傾斜」に`macroPatch()`(ワールド座標の純関数)のまだらを混ぜる。細かい粒立ちは`buildDetailBumpTexture()`の`bumpMap`(Phongの弱い反射つき)。**色・凹凸の2枚とも`offset`をパッチ位置に合わせる**(片方だけだと模様が滑る)。
- **テクスチャ生成は試合開始時に1回だけ走る同期処理。** オクターブ数やサイズを上げると実機の待ち時間に直結する(色512px/凹凸128pxが上限の目安)。
- 遠景の山は`RIDGE_LAYERS`(距離の違う3枚)を縦にも分割して高度で色を変える(麓=霞/中腹=岩/頂上=雪)。**奥の層から順に頂点を積む**(空も山も深度を書かないので、手前を後に描かないと消される)。描画順は`renderOrder`(空-2 / 山-1)で固定。
- 岩は2Dのまま`drawRealisticRock()`(render.js)で描く。光の向き`REAL_ROCK_SUN`はreal3d.jsの`SUN_DIR`と同じ値。**3Dへ移すと2Dのモンスターが必ず手前に描かれ、岩に隠れなくなる。**
- ESモジュールなので`window.__aramonReal3D`(`setActive`/`render`/`resize`)経由。WebGL初期化失敗時は`render()`がfalseを返し2D地面にフォールバックする。
- テストマップは`MAPS`に`testOnly:true`を付けて「ランダム」抽選から外している(`resolveMapKey()`)。

### リアルマップの弾道(上下のねらい)
- **通常マップに影響を出さないため、分岐はすべて`isReal3dMap()`1か所に寄せる。** 通常マップでは`fireAimSlope()`が0・`projectileMuzzleZ()`が`ent.z`・`projHeightHits()`が従来判定を返すので、弾道も当たり判定も一切変わらない。
- 弾は`vz = aimSlope × 水平弾速`で飛び、弾ごとの`grav`で落ちる。**水平速度と`traveled`は変えない**ので飛距離(`move.range`)は従来どおり。
- **落下加速度は`projGravityFor(range, 弾速)`が技ごとに決める。** 「平らな地面で水平に撃つと、ちょうど射程距離の地点で銃口の高さぶん落ちて着地する」強さ。射程も弾速も技ごとに違うので固定値にしない。強さの調整は`PROJ_DROP_Z`1か所。
- **打ち上げ角は`ballisticSlope(dz, 水平距離, 弾速, 重力)`が落下ぶんを見越して決める**ので、重力を変えても狙点はずれない。
- プレイヤーの`aimSlope`は`cameraAimSlope()`= 画面中心から視線を伸ばして地形に当たる点を探し、銃口(`足元+AIM_MUZZLE_Z`)からそこへ向ける。botは`targetAimSlope()`で相手の胴をねらう。
- **マルチではゲストのカメラをホストが知らないので、発射イベントに`slope`を載せて`ent.aimSlopeOverride`で渡す**(処理後にnullへ戻す)。弾の配信にも`vz`/`terrain3d`が要る。
- 地形への着弾は`p.terrain3d && p.z <= getTerrainHeightAt()`。**ホスト(combat.js)とゲストの見た目ループ(network.js)の両方に入れる。**
- **安全圏の円は投影できない点(カメラの後ろ)をnullのまま残し、`strokeProjectedRing`が線を切る。** 詰めて連結すると円の左右が1本の直線で結ばれ、遠くの安置線が目の前を横切って見える(高低差のあるリアルマップで顕著)。画面上で飛びすぎた区間も切る。
- 視点の上下範囲は`camPitchMin()`(リアルマップだけ空側`-0.42`まで)、試合開始角度は`applyStartPitchForMap()`。**マップ確定の直後に呼ぶ**(startGame/beginMultiplayerMatchInner)。前のマップの角度が残らないよう`updateCamera()`でも毎フレームclampしている。

## モンスター・スキン

### 新モンスター追加チェックリスト(1つでも欠けると不具合)
1. `ELEMENTS` 2. `TRAIT_DESC`(ui.js) 3. `SIGNATURE_MOVES` 4. `MOVE_AURA` 5. `MONSTER_AURA` 6. `SKIN_CONFIG`(`source.hue`は実画像からサンプリング) 7. `STATE_CHANGES` 8. `APTITUDE` 9. `WALK_ANIM`(歩行動画があれば) 10. `monsters/<key>.png`・`<key>_player.png`(正方形・被写体が高さの9割・足元が下端付近に正規化)
- 既存にないギミックが要るときはcombat.js/render.jsに新しい`kind`を増やす形で拡張する。

### SSR/色スキン
- **画像は`SSR_SKINS`に書けば`ssrSkinImages`が自動生成される**(以前は手書き表で、追記漏れによりカタログ・バッグ・着せ替え・装備時の見た目がすべて素のモンスターに化けた)。**実体生成は`SSR_SKINS`の宣言直後に置く**(前半だとTDZ)。
- **DOM表示は事前ロードに依存させない。** `skinnedIconDataUrl`等は未ロードでも`ssrSkinFileUrl()`でURLを返す。canvasへ描く`skinnedImage`だけはロード済みImageが必要。
- 新SSRの登録先: `SSR_SKINS` / `SSR_SKIN_AURA` / `SSR_SKIN_TIER3`(専用技) / `SKIN_TIER3_SE`(専用SE) / `WALK_ANIM`の`ssr` / 画像2枚。ガチャ・カタログは`gachaSsrSkinIds()`が自動生成。
- tier3のオーラ/エフェクト色はSSRもSR色スキンも変える。判定は`skinTier3Aura(skinId)`1か所に集約済みなので、combat.js/network.jsの`effColor`/`auraTint`は触らなくてよい。
- **SSRだけの特典は「tier3の技名と威力」。** SRはオーラ・エフェクトのみ。この線引きを守る。
- `SSR_SKIN_TIER3`は`dmgMult`(倍率だけ)か`move:{...}`(フィールド上書きで性能ごと専用技化。`blast`はマージ)。**`move`に`dmg`を書くときは`dmgMult`を併記しない**(二重適用)。
- **`SSR_SKIN_TIER3`内で`auraColorHex()`を呼ばない。** `SKIN_COLORS`の宣言が後ろにありTDZでdata.js全体が落ちる。色はリテラルで書く。
- **専用技の解決は`skinTier3Move(move, attacker)`で、呼ぶ場所は4か所**: combat.jsの`fireMove`先頭 / network.jsの`tryNonHostPlayerFireVisual` / render.jsのHUD技フィールド / ui.jsの`buildMastermonMovesHtml`。fireMove先頭で解決すれば威力・弾速・射程・爆風・ガッツ・SEはすべて解決後の値で流れる。
- 色の例外フラグ: `keepBaseColor`=本体色は元のまま差し色だけオーラ色 / `keepArcColor`=本体はオーラ色でビリビリだけ既定の紫。ビリビリ2色は`arcColorsFor(tint)`に集約。**`spawnGroundBlast`には弾の`auraTint`を渡す**(渡さないとドームだけ既定色に戻る)。
- スキン別SEは3表(combat.js): `SKIN_TIER3_SE` / `SKIN_SUMMON_SE` / `SKIN_HIT_SE`。`playSe(skinXxxSeName(entity) || '既定SE')`の形なので未定義は自動で既定。
- スキンプレビューは歩行を再生する(`skinWalkFrameDataUrls` + `startSkinPreviewAnim`)。未ロードならnullで静止画のまま(0.35秒×6回リトライ)。閉じたら必ず`stopSkinPreviewAnim()`。

### 歩行アニメーション
- `monsters/<prefix>_walk_f1..8.png`(正面)/`_b1..8.png`(後ろ)。**有効化は`WALK_ANIM`への登録だけ。全15エレメント対応済み**(SSRはラガモッチー/ゼウス/タマモノマエ/フェニックス/イブリース/ちょこ/ペルセポネ)。
- 入口は`getDisplayImage(entity)`→`entityWalkFrameImage(entity)`。`matchTime`でコマ送り、平滑化速度`_mwSpeed`が`WALK_MOVE_EPS`超で歩行中。進行方向とカメラyawの内積で正面/後ろを切替、停止中は静止(自分=後ろ/他=正面)。色スキンは各コマを`recolorToCanvas`して`_walkRecolor`にキャッシュ。**歩行コマ未提供のSSRは`null`を返して静止スキン画像にフォールバック**(新SSRで歩行を用意しない場合はここが働く)。
- 生成は`tools/build_walk.py`(開発用。動画→60fps抽出→自己相関で1周期検出→8コマ→切り抜き→320px・256色透過PNG)。背景別モード: `white_alpha`(白背景・隅から連結する白のみ透過)/ `grabcut_alpha`(草・金背景。`gentle`は細い足を守る、`hard`は縁を確定背景に)/ `phoenixcut_alpha`(鳥。かぎ爪の足を明示追加し中央下部限定の縦closeで接続、トサカ復元)。黒背景素材は輝度キー(6→40のランプ)で抜く。
- 落とし穴:
  - **全体を`binary_fill_holes`しない**(渦・発光の輪の内側まで埋まって黒い板になる)。小さな閉じた暗部だけ埋める。
  - **保存は`quantize(colors=256, method=Image.FASTOCTREE)`。** `convert('P')`+`transparency=255`は透過が正しく書かれない。
  - 動画の透かしは「明るいのに全フレーム動かない画素」をマスクして抜く(矩形塗り潰しは被写体を削る)。数px膨張させる。
  - 周期検出は下半身時系列からドリフトを引いた自己相関(生の自己相関はズームに埋もれる)。半周期の負相関×2が周期。
  - **【検証必須】全16コマを目視し、突起(トサカ)・足の欠けと足元の背景残りが無いことを確認する。** 自動チェックだけで採用しない(鳥系で何度も手戻りした)。
  - **JOBS/MOVに新規ジョブを足すときjob idの重複を必ず`grep`で確認する。** 後勝ちで上書きされ**既存モンスターのスプライトを破壊する**(2026-07-25に発生、復元が必要だった)。
  - `W`/`OUTDIR`は環境変数`BUILD_WALK_WORK`/`BUILD_WALK_OUT`で上書き可。セッションごとに更新が要るのは`MOV{}`の動画パスだけ。

## 戦闘・技のギミック

- **`blast`(着弾ドームAoE)**: 弾に`blast:{radius,dmg,color,expandTime,(telegraphTime),(style),(se)}`を付けると着弾点で`spawnGroundBlast()`が`kind:'circle'`のareaEffectを出す。**直撃`mv.dmg`と爆風`mv.blast.dmg`は別々に入る。**
- **`burstSpread`(連射の広がり。既定0.05rad)を読む場所は4か所**: combat.jsの`aoeShape`分岐と通常弾、network.jsのゲスト見た目の同2か所。
- **長い弾(槍)は`travelAngle - camState.yaw`で回さない**(カメラ奥へ撃つと横倒しに見える)。進行方向へ進んだ点を`project()`し画面上の差分から角度を取る(`seaSpear`が実装例)。
- **`aoeShape`技の`burst`**は即時生成なので2発目以降を`pendingAoeCasts`に積み`updatePendingAoeCasts()`で生成する。
- **範囲エフェクトの描画半径は判定と同じ`curReach`にする**(見栄えで0.95倍などを掛けない)。
- **`gutsDrainRatio`**(技単位のガッツ削り)は`gutsDrain`として弾・AoEに載せ`applyDamage`の`opts`で適用。属性単位のガッツ削り(プラント/アーク)とは別系統。
- **新しいダメージ源のフィールドを増やしたら`buildMastermonMovesHtml`の威力表示にも足す**(`mv.dmg`ベースなので「威力0」表示になる)。特徴テキストは`describeMoveFeatureText`。

## 安全圏

- `ZONE_PHASES`でフェーズ定義。安定フェーズ開始時に`prepareNextZoneTarget()`が次の縮小先を決め、`toCenter/toRadius`を予測点線で表示。マルチではホストのzoneState(toCenter含む)を同期する。

## マスモン(メタ進行)

- localStorage永続化(`loadMastermons`/`saveMastermons`)。6ステータスの戦闘反映は`mastermonStatFactor(v,statKey)`(`MASTERMON_STAT_FACTOR_DIVISOR`が小さいほど効きが強い)。EXPは`awardMastermonExp`(`MASTERMON_EXP_GLOBAL_MULT`×`xpMult`)。
- **適用は「エンティティ生成 → `applyMastermonStatsToEntity(ent, mm)`」の1本道**(ソロ=`startGame()`、マルチ=`beginMultiplayerMatchInner()`の人間ループ)。
- **マルチでは育成ステータスを部屋の参加者情報で共有する。** `currentMastermonInfo()`が`{level,stats}`を返し`rooms/{id}/players/{pid}.mm`へ書く。**片側だけで掛けるとHPと移動速度が食い違い、ゲストの位置補正が暴れる。** 入室経路は3つ(`__aramonCreateRoom`/`__aramonJoinRoom`/`__aramonFindOrCreateRoom`)あり載せ忘れやすいので、書き込み4か所は必ず`mmEntryFields(mmInfo)`をスプレッドする。同期していないのは`speed`と各`mastermon*Mult`(maxHpはauthStateで上書きされる)。
- **撃破EXPボーナスはbot・人間の区別なく与える。** ホストが`killEntity`で積み`hostForceFullNext=true`で最短配信、ゲストも`kill`イベント受信時に自前で積む(最後のキルで試合が終わると間に合わないため)。反映は`Math.max`(遅れて届いた古い値で減らさない)。
- **技強化チケット(`nextMoveBoost`)はソロ専用**(マルチは`moveTierUnlocked`がホスト権威で、authStateは上げる方向にしか反映しないため)。

## マルチプレイ(network.js)

ホスト権威型。ワールド生成はシード付き乱数でホスト/ゲストが同一結果を得る。**ソロ用とシード付きの生成関数は対になっているので、変更するときは必ず両方直す**(例 `spawnLoot`/`seededSpawnLoot`)。

### ゲストに「起きない・遅れる」を作らない
ゲストは`update(dt)`を実行しない。**ホストのループの中でしか起きない処理は、ゲストには何も起きない。**
- **単発通知(キルフィード等)は`onChildAdded`+キーで重複排除して配信する。`limitToLast(1)`+`onValue`は短時間に複数件出ると途中が消えるので使わない。** 受け口は`handleRoomEvent()`。
- **ホストは全件配信する**(bot同士のキルも含む)。関与分だけに絞るとゲストのキルフィードがほぼ空になる。
- **HP/ガッツはauthStateで伝わるが、SE・ダメージ数字・トーストは伝わらない。** ゲスト側で再現する。パターンは2つ: ①ホストが単発イベントを配信してゲストが同じ演出を出す ②同期済み情報からゲストが見た目だけ出す(`showGuestEnvironmentDamage`)。**足りないのはほぼ常に「演出」の側。**
- **`AUTH_FULL_EVERY`で間引かれるコールドフィールド(maxHp・train係数等)は最大0.4秒遅れる。** 即座に見せたいときは`hostForceFullNext = true`。
- **絶対時刻(matchTime基準)は残り秒数で送る**(ホストとゲストのmatchTimeはズレる)。現在: `fz`/`sl`/`sb`/`bn`/`po`/`stR`/`stcR`。新しい「〜Until」もこれに倣う。
- **安全圏の`zoneState.timer`も同期する(`zone.tm`)。** 無いとゲストの残り秒数が進まない。
- **`updatePendingAoeCasts()`はゲストのループでも呼ぶ**(連射範囲技の2発目以降が出ない)。**`pendingAoeCasts`は試合開始時に必ずクリア**(残ると次の試合で幻の範囲攻撃が出る)。
- **自分が撃った弾のエコーはゲストで捨てられる**ため、着弾ドームのような派生エフェクトはゲストも自前で生成する(視覚専用弾にも`blast`を持たせる)。
- **発射条件は3か所で一致させる**: `tryPlayerFire` / `tryNonHostPlayerFireVisual` / `processRemoteFireEvents`。
- **ホストしか行わない取得判定はゲストが見た目だけ先読みする**(`predictLootPickupsAsGuest()`。確定が来なければ復活)。**先読みフラグは`!= null`で判定**(matchTime 0と区別できない)。

### 位置・動き(ラバーバンド対策)
- **補正のしきい値は移動速度に比例させる(`selfCorrectSpeedScale`)。** 固定距離だと速いほど通常の前進でも引き戻される。基準は`entityMoveSpeed(ent)`。
- **マルチだけ移動速度と弾速を落とす**(`MULTI_MOVE_SPEED_MULT`/`MULTI_PROJ_SPEED_MULT`)。掛ける場所は`resolveMovement`の`effSpeed`と`effectiveProjSpeed`の各1か所だけなのでホスト/ゲストが自動一致する。**ダッシュ速度は`slowedSpeed`基準のままにして飛距離を変えない。**
- **自分の位置は「同じ入力時点どうし」で突き合わせる。** 入力に`seq`を付け、ホストが`aseq`を返す。ゲストは`selfPredHistory`と比較し、`SELF_CORRECT_DEADZONE`超のぶんを`selfCorrX/Y`に溜めて少しずつ消費する。**現在位置とホストの遅れた位置を直接比べてはいけない**(遅延がそのまま誤差になり、低速地形では操作不能になった)。
- **ダッシュは回数(`dashSeq`)を入力に載せてホストに再現させる**(フラグではなく回数にすると二重発動も取りこぼしも防げる)。開始処理は`startEntityDash()`に集約。**自分のダッシュのクールタイムはauthStateで上書きしない**(遅れた0が届いて連続ダッシュできる)。**ダッシュ中と直後は許容を広げる(`SELF_CORRECT_DEADZONE_DASH`)。**
- **移動に影響する状態異常は必ず同期する**(残り秒数で)。
- **他エンティティの補間はホストの試合時刻(`payload.t`)を時間軸にする。** 到着時刻基準だとジッタで速い相手が瞬間移動する。変換は`hostClockOffset`。
- 試合開始時に`guestSnapBuf`/`hostClockOffset`/`selfPredHistory`/`selfCorrX/Y`/`selfInputSeq`をリセットする。

### フリーズ対策
- **`loop()`の中身は必ずtry/catchで囲む。** 例外を投げるとRAFが再登録されず描画も入力も完全に止まる(復帰不能)。捕まえてもRAFは継続する。
- **`beginMultiplayerMatch()`は外枠のtry/catchでフラグを必ず戻す**(`matchBeginning`が立ったままだと以後試合を開始できない)。失敗時はトップ画面へ帰し部屋も離脱。
- **ゲストの自分の座標は`sanitizeSelfPosition()`で毎フレーム点検**(一度NaNが入ると以後描画も操作もできない)。

### 観戦(ホスト敗退後)
- `spectateCandidates()`は**自分以外の生存者全員**(人間を先、botを後)。人間だけにすると残り1人のとき「次のプレイヤー」が効かない。終了判定(`checkWin`の`humanAlive`)は別なので影響しない。

## 音(audio.js)

- 原則Web Audio合成。初回タップ後に`audioInit()`。合成ヘルパーは`seTone`/`seNoise`/`seNoiseLfo`、定義は`SE_DEFS`。
- `playSe(name, opts)`は**負荷対策で自分の操作モンスターに関わる音のみ**鳴らす。`SE_MIN_GAP`で連打間引き、`SE_VOL_BOOST`で技SEを増幅。tier3は`MOVE_SE_BY_STYLE`(combat.js)、技名個別は`move.seStyle`。
- BGM: タイトル / 試合中(intensity 0〜2)/ 決戦(3)/ ラストバトル(4)/ ショップ / ロビー / トレーニング。`bgmSetTrack()`と`bgmUpdateBattleIntensity(aliveCount)`。全ノードは`bgmTrackGain`→`bgmGain`→出力。
- **intensityを増やしたら`bgmStepDur()`のbpm配列も伸ばす**(配列外でBPMがNaNになる)。
- **トラック/intensityを追加したら管理者画面の`BGM_TEST_ITEMS`にも足す。**
- **実音源ループは「常に1曲だけ」を`updateBgmFileLoops()`が保証する。** `bgmFileLoopTarget()`が鳴らすべき1曲を返し、それ以外は`stop()`。**トラック名は明示で判定する**(「title/shop以外は試合中」としていたためトレーニング画面で決戦BGMが重なった)。新トラックは1行足すだけ。
- `bgmSetTrack('title'|'shop'|'training')`はintensityを0に戻す(`null`は試合中の演出でも使うので触らない)。リザルト後にロビー曲へ戻す遅延処理は`bgmDesiredTrack()!==null`なら何もしない。

### 実音源を使う例外
「全合成」が原則だが、外部依存を増やさない範囲で実音を使う。
- **長いBGMは`createBgmLoop(url, gain, keepPos)`**: `ensure()`(fetch+decode)/`start()`/`stop()`(0.6秒/0.4秒フェード)。合成との二重再生は`bgmFileLoopActive()`で防ぎ、**実音源が鳴っている間は合成ステップを一切呼ばない**。未ロード/失敗時のみ合成へフォールバック。試合中の2曲は`audioInit()`で先読み、ショップ曲は画面を開いたときに初回ロード。曲ごとの音量は`BGM_FILE_GAIN`。
- **切替は等パワークロスフェード(`_equalPowerCurve`)。** 線形だと合計音量が一時的に1.4倍になる。上げ側`sin`/下げ側`cos`で、**下げ側は終点基準(`to + (from-to)*cos`)**。
- **ロビーBGMだけ再生位置を記憶する**(`keepPos`。`stop()`で経過を足し`start()`で`src.start(t, offset)`)。「いちか(実音源)」と「オリジナル(合成)」の切替は`lobbyBgmMode`(localStorage `aramon_lobby_bgm_v1`)+ヘッダーの`#headerBgmBtn`。
- **トレーニング画面は`bgmSetTrack('training')`。切替判断は`updateMetaBgm()`(ui.js)1か所**に集約(`mmOpenTab()`と`#mastermonScreen`のMutationObserverから呼ぶ)。試合中とショップ表示中は触らない。
- **短い内蔵SEは`createSeOneShot(dataUrl|url, gain)`。** `play()`が未ロード/音量0でfalseを返すので`if(!seXxx.play()) SE_DEFS.既定SE(t,o)`と書けば必ず鳴る。`SE_DEFS`に足せば管理者画面のSE確認に自動で載る(表示名`SE_TEST_LABELS`、間引き`SE_MIN_GAP`)。
- **「実音源のあとに合成SEをつなげる」ときは`play(when)`に開始時刻を渡す**(ヒノトリ`fireWave`)。長さは`.dur()`。
- **提供音源の技SEは`move.seStyle`で指定する**(`MOVE_SE_BY_STYLE`はスタイル単位なので他モンスターまで巻き込む)。現在: `darkHoust`/`requiemEnd`/`mocchiBeam`/`monta`/`crystalRain`/`fireWave`。
- 使い分け: 1.2秒程度まではデータURIインライン、3秒級のSEと長い曲は外部mp3+fetch。
- **提供音源の前後の無音はmp3の側で切っておく**(再生時にずらす仕組みは持たない)。`silencedetect`で位置を測り、`-ss/-to`で切り直してからデータURIへ。
- 実音の抽出(この環境): `pip install imageio-ffmpeg`で静的ffmpeg。**Chromium(OSSビルド)はAAC不可・mp3可**なので動画音声は一旦mp3化する。整音は`loudnorm`。

## Firebase・アカウント

- Realtime Database。パス: `scores` / `matchLogs` / `lobby` / `rooms` / `accounts`。
- **新しいDBパスを追加したらFirebaseコンソールのセキュリティルールにも`.read`/`.write`が要る**(未定義パスはデフォルト拒否)。**発注者が手作業で貼るので、貼り付け用のJSONをそのまま渡す。**
- ログインは名前+4桁パスコードで`accounts/{nameKey}`。認証情報は`aramon_account_v1`に保存し自動ログイン。**端末に認証情報がある時点で即ログイン扱いにし、通信失敗でもログイン状態を維持する。**
- サーバー同期は`ACCOUNT_SYNC_KEYS`を`accountMarkDirty()`→3秒デバウンスで送信。ログイン時は`updatedAt`で新しい方を採用。**localStorageのsave関数に`accountMarkDirty()`を足し忘れない。**
- 通貨は`loadWallet/saveWallet/addWallet`、試合報酬は`showResult`(定数`GOLD_*`/`DIA_*`)。
- アイテムは`PLAYER_ITEMS`、バッグは`loadBag/saveBag/addBagItem`、ガチャ`GACHA_POOL`(10連10個目は`GACHA_TICKET_POOL`確定)、ショップ`SHOP_ITEMS`。
- バッグUIは左=アイコングリッド+説明、右=対象マスモン一覧。「選択→使用」の2段階で、**アイテムを切り替えてもマスモンの選択は保持する**。ステータス上昇アイテムは999上限を考慮して変動値を出し、超える個数は選べない。

## 強制横向き / タッチ

- 縦画面ロック端末では`#appRoot`をCSS回転(`world.js`の`updateForceLandscapeMode`)。座標・移動量は`toLogicalPoint`/`toLogicalDelta`で補正。
- **向きの判定は`matchMedia('(orientation: portrait)')`。** 実測pxは起動直後に確定しないことがあり、それで一度だけ判定すると縦持ち起動時に効かないまま固定される。`getRealViewportSize()`は`visualViewport`→`innerWidth/Height`→`clientWidth/Height`の順にフォールバック。
- **起動直後は`resize()`を何度も呼び直す**(`DOMContentLoaded`/`load`/`pageshow` + 50〜2000msのタイマー + mqのchange)。iOSは`orientationchange`を取りこぼす。キャンバス処理はtry/catchで囲み、失敗しても向き判定は済ませる。
- 縦画面ロック中はネイティブスクロールが効きにくいので、input.jsが回転補正した移動量で手動スクロールする(overflow:auto/scrollを付ければ拾われる)。

## 作業の進め方

- 数値バランスは発注者が実機で反復調整するので、名前付き定数にまとめる。
- 変更したファイルだけをコミットする。コミットメッセージは日本語。
- **動作確認はiPhone実機(PWA)で発注者が行う。ヘッドレスブラウザは使わない。** こちらは`node --check <file>`の構文チェックまでで、検証用スクリプトを新規に書かない。
- **PRはsquashマージ運用。** 次のPR前に `git fetch origin main && git rebase --onto origin/main <前回のブランチ先端> <作業ブランチ>` で既マージ分を落として`push --force-with-lease`する(毎回実施)。
- GitHub Actionsの`actions_list`はレスポンスが巨大なので、保存ファイルを `jq -r '.workflow_runs[:N][] | [.head_sha[0:7], .status, .conclusion] | @tsv'` で読む。対象SHAのrunが`completed/success`なら成功。

## 用語(発注者の言い回し)

- 「ヒット判定を大きく」= モンスター本体ではなく**技のヒットボックス**の拡大。
- 「安置」= 安全圏。「安置予測」= 次の縮小先の点線。
- 「マスモン」= メタ進行のモンスター育成システム。

## 報告・文章のスタイル

- **返答は短く要点だけ。** 前置き・但し書きは最小限。
- **作業前に「これから何をするか」を一文だけ。** 途中の報告は重要な発見と方針変更のときだけ。
- **終わったら結論から書く。** 最初の一文で「何をしたか/何が分かったか」に答える。
- **書き出す文書(PR説明・コミットメッセージ)は必要な長さに収める。** 埋めるための章や繰り返しの要約を書かない。

<tone_preference>
出力は簡潔に。
</tone_preference>
