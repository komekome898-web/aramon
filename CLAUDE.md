# 荒野モン動 (Aramon) — プロジェクトガイド

iPhoneブラウザ(PWA)向けのTPSバトルロイヤルゲーム。HTML5 Canvas + バニラJavaScript + Firebase Realtime Database。ビルドステップなし・フレームワークなし。GitHub Pagesでホストされ、mainにマージすると自動デプロイされる。

公開URL: https://komekome898-web.github.io/aramon/index.html

## 絶対に守るルール

1. **デプロイ(コミット)のたびに `sw.js` の `CACHE_NAME` のバージョン番号を必ず1つ上げる。**
   例: `aramon-cache-v159` → `aramon-cache-v160`。上げ忘れるとユーザーの端末に古いキャッシュが残り続け、更新が反映されない。
   例外: `CLAUDE.md`・`README.md` などゲームの動作に一切影響しないドキュメントのみの変更では上げなくてよい。
2. **変更は本番公開まで自動で完了させる。** 作業ブランチへのコミット・プッシュ後、発注者への確認なしでmainへのPR作成→マージまで行う。マージ後はGitHub Actionsの「pages build and deployment」が成功したことを確認してから完了報告する(発注者の合意済み運用)。
3. **ビルドツール・npmパッケージ・フレームワークを導入しない。** すべて素のJS/CSS/HTMLのまま維持する。
4. **モジュール分割構成を維持する。** 新機能も既存の担当ファイルに追記する(下記参照)。1ファイルに戻すリファクタリングはしない。
5. **変更は動作する実用的な解を優先する。** アーキテクチャ的な完璧さのための大規模リファクタリングは指示がない限りしない。

## ファイル構成と担当範囲

| ファイル | 担当 |
|---|---|
| `index.html` | 全画面のDOMマークアップ。scriptの読み込み順: firebase.js(module) → data.js → audio.js → world.js → combat.js → render.js → input.js → ui.js → network.js |
| `style.css` | 全スタイル。CSS変数は`:root`(--amber, --ink, --danger等) |
| `data.js` | 定数・マスタデータ: WORLD寸法, MAPS, ELEMENTS(モンスター), SIGNATURE_MOVES, マスモン(トレーニング/EXP/ステータス倍率), 試合内アイテム定義, プレイヤーアカウント系(通貨=ゴールド/ダイヤ, バッグ, PLAYER_ITEMS, ガチャ, ショップ, 試合報酬) |
| `audio.js` | BGM/SE。外部音源なしでWeb Audio APIにより全合成。BGMはステップシーケンサ(タイトル/試合中/残り5人以下)、SEは`playSe(name)`。音量はlocalStorage永続化 |
| `world.js` | ワールド生成(岩/水晶/川/海/火山/建物), 安全圏(zoneState), 地形判定, 移動・衝突 |
| `combat.js` | 戦闘: 攻撃, ダメージ, AoE, 状態変化, Bot AI |
| `render.js` | 3D風投影(project), 全描画, ミニマップ, グローバルtouchmove制御 |
| `input.js` | タッチ/キー入力, ジョイスティック, カメラ操作, ダブルタップズーム防止 |
| `ui.js` | 画面遷移, リザルト, ランキング, マスモンUI, 管理者画面, localStorage永続化, プレイヤーアカウント(ログイン/サーバー同期), バッグ/ガチャ/ショップUI, トップ画面ヘッダー |
| `network.js` | マルチプレイ同期(ホスト権威型)。ホストがauthStateを配信しゲストが補間追従 |
| `firebase.js` | Firebase初期化とAPI。`window.__aramon*` 関数群としてグローバル公開(ESモジュールなのでこの橋渡しが必要) |
| `sw.js` | サービスワーカー。ネットワーク優先+キャッシュフォールバック |
| `manifest.json` | PWAマニフェスト |
| `monsters/*.png` | モンスター画像 |

## 重要な設計知識

### 画面(スクリーン)の追加・変更時
- 各画面は `index.html` 内の `<div class="resultScreen hidden">` 等で定義し、`.hidden`(display:none !important)の付け外しで遷移する。
- **新しい画面を追加したら、`render.js` と `input.js` にあるグローバルな `touchmove` / `touchend` / `dblclick` の除外リスト(`e.target.closest('#xxx')`の連鎖)に必ずその画面のIDを追加する。** 追加しないと画面内スクロールやタップが効かないバグになる(過去に管理者画面・ランキング画面で発生)。
- プルダウンは `.custom-select` / `.custom-select-menu` の自前実装を再利用する。ポップアップが親のoverflowで切れないよう「外枠はoverflow可視・中のリストだけ独立スクロール」の構成にする。
- 横長(landscape)の低い画面が前提。新しい画面は縦幅を詰めてスクロールなしで収まるようにする。

### 安全圏(zoneState)
- `ZONE_PHASES`でフェーズ定義。安定フェーズ開始時に`prepareNextZoneTarget()`で次の縮小先を事前決定し、`toCenter/toRadius`を予測点線として表示する。
- マルチプレイではホストのzoneState(toCenter含む)をauthStateで同期する。

### マルチプレイ(network.js)
- ホスト権威型。ワールド生成はシード付き乱数(`seededRand`)でホスト/ゲストが同一結果を得る。ソロ用とシード付きの生成関数が対になって存在する(例: `spawnLoot` / `seededSpawnLoot`)。**ワールド生成ロジックを変更するときは必ず両方を同じように変更する。**
- ホスト側だけで発生するイベント(アイテム出現等)はゲストへ明示的に配信が必要。

### マスモン(メタ進行)
- localStorage永続化(`data.js`の`loadMastermons`/`saveMastermons`)。
- 6ステータス(ライフ/ちから/かしこさ/命中/回避/丈夫さ)。戦闘への反映は`mastermonStatFactor(v, statKey)`で、`MASTERMON_STAT_FACTOR_DIVISOR`によりステータスごとに増減幅が異なる(数値が小さいほど効きが強い)。
- EXPは`awardMastermonExp`。全試合共通倍率`MASTERMON_EXP_GLOBAL_MULT`(現在3)×マルチボーナス等の`xpMult`。

### Firebase
- Realtime Database。パス: `scores`(ランキングのベスト記録), `matchLogs`(管理者画面用の試合ログ), `lobby`, `rooms`, `accounts`(プレイヤーアカウント)。
- **新しいDBパスを追加したら、Firebaseコンソール側のセキュリティルールにもそのパスの`.read`/`.write`を追加する必要がある**(ルール未定義のパスはデフォルト拒否)。コードだけでは動かないので、変更時はコミットメッセージやPR説明でルール追加が必要な旨を必ず伝えること。**発注者がコンソールで手作業で貼るので、貼り付け用のJSONをそのまま渡すこと。**
- 管理者画面: トップ画面最下部の小さな「管理者用」ボタン → 4桁パスワード(0008) → 統計表示。プレイヤー名「おりょう」は集計から除外。動作確認用の「💎ダイヤ+500」ボタンもここにある。

### プレイヤーアカウント・通貨・アイテム(ui.js / data.js / firebase.js)
- ログイン: プレイヤー名+4桁パスコードで `accounts/{nameKey}` を読み書き(`window.__aramonGetAccount/__aramonSetAccount/__aramonUpdateAccountData`)。名前重複を検知。認証情報は端末に保存(`aramon_account_v1`)し自動ログイン。**自動ログインは端末に認証情報がある時点で即ログイン扱いにし、通信失敗でもログイン状態を維持する**(更新直後にログアウト表示になる不具合を防ぐため)。
- サーバー同期: `ACCOUNT_SYNC_KEYS`(マスモン/戦績/表示名/ウォレット/バッグ)を、保存時に`accountMarkDirty()`→3秒デバウンスで送信。ログイン時は`updatedAt`とローカルのタイムスタンプを比較して新しい方を採用。**localStorageのsave関数に`accountMarkDirty()`呼び出しを足すのを忘れない。**
- 通貨: `loadWallet/saveWallet/addWallet`(ゴールド/ダイヤ)。試合報酬は`showResult`で付与(定数 `GOLD_*`/`DIA_*`)。トップ画面ヘッダー(`#topHeader`)と各画面に残高表示。
- アイテム: `PLAYER_ITEMS`(実6種=各ステータス+`STAT_SEED_GAIN`, フリートレチケ, 技強化チケ)。バッグ`loadBag/saveBag/addBagItem`。ガチャ`GACHA_POOL`(ダイヤ専用・単発/10連, 10連10個目は`GACHA_TICKET_POOL`確定)、ショップ`SHOP_ITEMS`(ゴールド)。
- バッグUI: 左=アイコングリッド+説明フィールド、右=対象マスモン一覧(マスモン画面と同じステータスバー`buildMastermonStatsColHtml`を流用)。トレーニング同様「選択→使用」の2段階。

### 描画(render.js)
- `project(wx,wy,wz)`で3D風投影。描画物は`drawables`に集めてdepthソート後に描画。
- 画面外カリングは`cullMarginFor`でオブジェクトの見た目上の半径に応じた余白を取る(固定余白だと巨大オブジェクトが近距離で誤って消える)。
- 障害物は影(接地点)と本体の底が接するように描く(浮いて見えるバグ防止)。

### 音(audio.js)
- 全てWeb Audio APIで合成(外部音源なし)。iOS対策で初回タップ後にAudioContext起動。
- BGM: タイトル(牧場)/試合中(残り人数で段階変化)/残り5人以下(壮大な決戦曲)。`bgmSetTrack`/`bgmUpdateBattleIntensity`(render.jsのHUD更新から呼ぶ)。
- SE: `playSe(name, opts)`。**負荷対策として自分の操作モンスターに関わる音のみ鳴らす**。tier3技はエフェクトスタイル→SE名の対応表`MOVE_SE_BY_STYLE`(combat.js)で個別化。技SEは`SE_VOL_BOOST`で一括増幅。技名個別指定は`move.seStyle`。

## 用語(発注者の言い回し)

- 「ヒット判定を大きく」= モンスター本体ではなく**ムーブ(攻撃)のヒットボックス**の拡大を指す。
- 「安置」= 安全圏(zone)。「安置予測」= 次の縮小先の点線表示。
- 「マスモン」= メタ進行レイヤーのモンスター育成システム。

### 強制横向き / タッチ
- 縦画面ロック端末では`#appRoot`をCSS回転させ横向き表示にする(`world.js`の`updateForceLandscapeMode`等)。ポインタ座標・移動量は`toLogicalPoint`/`toLogicalDelta`で回転補正する。
- 縦画面ロック中はネイティブスクロールが効きにくいので、`input.js`が回転補正した移動量で手動スクロールする補助を入れている。新しいスクロール要素はこの仕組みで動く(overflow:auto/scrollを付ければ拾われる)。

## 作業の進め方

- 数値バランス(倍率・係数)は発注者が実機プレイテスト後に反復調整するので、調整しやすいよう名前付き定数にまとめる。
- 変更したファイルだけをコミットする。コミットメッセージは日本語でよい。
- 動作確認はiPhone実機(PWA)で発注者が行う。デプロイ後にキャッシュバージョンが上がっていれば次回アクセス時に自動更新される。

### ヘッドレスでの動作確認(重要)
- 発注者は実機だが、こちら側でもコミット前に**Playwright(ヘッドレスChromium)で必ず検証する**。UIロジック・ゲーム状態・レイアウト・SE発音の有無まで確認できる。
  - Playwright: `/opt/node22/lib/node_modules/playwright/index.mjs`、chromium: `/opt/pw-browsers/chromium`。ローカルにhttpサーバを立て`page.goto`。
  - **PWAのService Workerが初回インストール後に1度ページを自動リロードする**ため、`waitForFunction`は失敗しやすい。`for`ループで `waitForTimeout(500)`+`try{ evaluate(()=> typeof 関数==='function') }catch` をリトライする方式を使う(既存の`scratchpad/*.mjs`が手本)。
  - localStorageのseedは`addInitScript`で(例: `aramon_mastermons_v1`, `aramon_bag_v1`, `aramon_wallet_v1`, `aramon_account_v1`)。Firebaseは`window.__aramon*`をスタブで差し替えて検証できる。
  - `js/check`: `node --check <file>` で構文チェック。
- GitHub Actionsの`actions_list`はレスポンスが巨大でトークン超過するので、保存されたファイルを`jq -r '.workflow_runs[:N][] | [.head_sha[0:7], .status, .conclusion] | @tsv'`で読む。
- マージ後の「pages build and deployment」成功確認は、対象コミットSHAのrunが`completed/success`になっているかで判断する。
