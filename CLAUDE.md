# 荒野モン動 (Aramon) — プロジェクトガイド

iPhoneブラウザ(PWA)向けのTPSバトルロイヤルゲーム。HTML5 Canvas + バニラJavaScript + Firebase Realtime Database。ビルドステップなし・フレームワークなし。GitHub Pagesでホストされ、mainにマージすると自動デプロイされる。

公開URL: https://komekome898-web.github.io/aramon/index.html

## 絶対に守るルール

1. **デプロイ(コミット)のたびに `sw.js` の `CACHE_NAME` のバージョン番号を必ず1つ上げる。**
   例: `aramon-cache-v159` → `aramon-cache-v160`。上げ忘れるとユーザーの端末に古いキャッシュが残り続け、更新が反映されない。
2. **ビルドツール・npmパッケージ・フレームワークを導入しない。** すべて素のJS/CSS/HTMLのまま維持する。
3. **モジュール分割構成を維持する。** 新機能も既存の担当ファイルに追記する(下記参照)。1ファイルに戻すリファクタリングはしない。
4. **変更は動作する実用的な解を優先する。** アーキテクチャ的な完璧さのための大規模リファクタリングは指示がない限りしない。

## ファイル構成と担当範囲

| ファイル | 担当 |
|---|---|
| `index.html` | 全画面のDOMマークアップ。scriptの読み込み順: firebase.js(module) → data.js → world.js → combat.js → render.js → input.js → ui.js → network.js |
| `style.css` | 全スタイル。CSS変数は`:root`(--amber, --ink, --danger等) |
| `data.js` | 定数・マスタデータ: WORLD寸法, MAPS, ELEMENTS(モンスター), SIGNATURE_MOVES, マスモン(トレーニング/EXP/ステータス倍率), アイテム定義 |
| `world.js` | ワールド生成(岩/水晶/川/海/火山/建物), 安全圏(zoneState), 地形判定, 移動・衝突 |
| `combat.js` | 戦闘: 攻撃, ダメージ, AoE, 状態変化, Bot AI |
| `render.js` | 3D風投影(project), 全描画, ミニマップ, グローバルtouchmove制御 |
| `input.js` | タッチ/キー入力, ジョイスティック, カメラ操作, ダブルタップズーム防止 |
| `ui.js` | 画面遷移, リザルト, ランキング, マスモンUI, 管理者画面, localStorage永続化 |
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
- Realtime Database。パス: `scores`(ランキングのベスト記録), `matchLogs`(管理者画面用の試合ログ), `lobby`, `rooms`。
- **新しいDBパスを追加したら、Firebaseコンソール側のセキュリティルールにもそのパスの`.read`/`.write`を追加する必要がある**(ルール未定義のパスはデフォルト拒否)。コードだけでは動かないので、変更時はコミットメッセージやPR説明でルール追加が必要な旨を必ず伝えること。
- 管理者画面: トップ画面最下部の小さな「管理者用」ボタン → 4桁パスワード(0008) → 統計表示。プレイヤー名「おりょう」は集計から除外。

### 描画(render.js)
- `project(wx,wy,wz)`で3D風投影。描画物は`drawables`に集めてdepthソート後に描画。
- 画面外カリングは`cullMarginFor`でオブジェクトの見た目上の半径に応じた余白を取る(固定余白だと巨大オブジェクトが近距離で誤って消える)。
- 障害物は影(接地点)と本体の底が接するように描く(浮いて見えるバグ防止)。

## 用語(発注者の言い回し)

- 「ヒット判定を大きく」= モンスター本体ではなく**ムーブ(攻撃)のヒットボックス**の拡大を指す。
- 「安置」= 安全圏(zone)。「安置予測」= 次の縮小先の点線表示。
- 「マスモン」= メタ進行レイヤーのモンスター育成システム。

## 作業の進め方

- 数値バランス(倍率・係数)は発注者が実機プレイテスト後に反復調整するので、調整しやすいよう名前付き定数にまとめる。
- 変更したファイルだけをコミットする。コミットメッセージは日本語でよい。
- 動作確認はiPhone実機(PWA)で発注者が行う。デプロイ後にキャッシュバージョンが上がっていれば次回アクセス時に自動更新される。
