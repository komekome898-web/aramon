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
6. **プレイに関わる大きな変更をしたら「更新履歴」も更新する。** `data.js` の `UPDATE_HISTORY`(トップ画面「更新履歴」ボタンで表示)に、その日の日付の項目として1行追記する。**項目は`{ t:'本文', g:['タグid',…] }`の形式**で、タグは`CHANGELOG_TAGS`(全般/新要素/モンスター/バランス/ソロ/マルチ/不具合/演出・音)から必要なだけ付ける(絞り込みに使われる)。対象=**新機能の追加・既存機能の変更・バランス/仕様の調整など、プレイヤーの遊びに影響する内容**。対象外=細かい画面レイアウト・見た目・軽微なバグ修正・内部リファクタ・ドキュメントのみ。日付は降順(新しい日を上に)。文言は発注者向けに簡潔な日本語で(技術用語を避ける)。1回のPRで複数の大きな変更をした場合は複数行に分ける。

## ファイル構成と担当範囲

| ファイル | 担当 |
|---|---|
| `index.html` | 全画面のDOMマークアップ。scriptの読み込み順: firebase.js(module) → data.js → audio.js → world.js → combat.js → render.js → input.js → ui.js → network.js |
| `style.css` | 全スタイル。CSS変数は`:root`(--amber, --ink, --danger等) |
| `data.js` | 定数・マスタデータ: WORLD寸法, MAPS, ELEMENTS(モンスター), SIGNATURE_MOVES, マスモン(トレーニング/EXP/ステータス倍率), 試合内アイテム定義, プレイヤーアカウント系(通貨=ゴールド/ダイヤ, バッグ, PLAYER_ITEMS, ガチャ, ショップ, 試合報酬), **更新履歴`UPDATE_HISTORY`**, オーラ/SSRスキン関連(`SSR_SKINS`/`SSR_SKIN_AURA`/`SSR_SKIN_TIER3`/`getMoveAura`/`getMoveName`/`ssrTier3DmgMult`), 色スキン(`SKIN_CONFIG`/`recolorToCanvas`), **バトル歩行アニメ**(`WALK_ANIM`/`entityWalkFrameImage`/`getDisplayImage`) |
| `audio.js` | BGM/SE。原則Web Audio APIで合成。BGMはステップシーケンサ(タイトル/試合中/残り5人以下)、SEは`playSe(name)`。音量はlocalStorage永続化。**例外的に一部だけ実音源を使う**(下記「音」参照): SSR獲得SE=内蔵mp3データURI、残り5人以下BGM=`bgm_final5.mp3` |
| `world.js` | ワールド生成(岩/水晶/川/海/火山/建物), 安全圏(zoneState), 地形判定, 移動・衝突 |
| `combat.js` | 戦闘: 攻撃, ダメージ, AoE, 状態変化, Bot AI |
| `render.js` | 3D風投影(project), 全描画, ミニマップ, グローバルtouchmove制御 |
| `input.js` | タッチ/キー入力, ジョイスティック, カメラ操作, ダブルタップズーム防止 |
| `ui.js` | 画面遷移, リザルト, ランキング, マスモンUI, 管理者画面, localStorage永続化, プレイヤーアカウント(ログイン/サーバー同期), バッグ/ガチャ/ショップUI, トップ画面ヘッダー |
| `network.js` | マルチプレイ同期(ホスト権威型)。ホストがauthStateを配信しゲストが補間追従 |
| `firebase.js` | Firebase初期化とAPI。`window.__aramon*` 関数群としてグローバル公開(ESモジュールなのでこの橋渡しが必要) |
| `sw.js` | サービスワーカー。ネットワーク優先+キャッシュフォールバック |
| `manifest.json` | PWAマニフェスト |
| `monsters/*.png` | モンスター画像。静止画に加え**歩行アニメ用スプライト** `<prefix>_walk_f1..8.png`(正面8コマ)/`<prefix>_walk_b1..8.png`(後ろ8コマ)。320px・256色透過PNG |
| `tools/build_walk.py` | **歩行スプライト生成の開発用スクリプト**(ゲームには読み込まれない)。動画→8コマ透過PNG。この環境のffmpeg/PIL/numpy/scipy/opencvで動く。詳細は「バトル歩行アニメーション」節 |
| `top_bg.jpg` | トップ画面(ロビー)の背景画像。`#topBg`が`cover`で敷く |
| `title_bg.jpg` / `title_logo.png` | タイトル画面の背景とロゴ。ロゴは背景を透過済み(白背景を縁から連結する成分だけ抜き、文字内部に閉じた白いハイライトは黒で塗った)。**ロビーのタイトル(`#lobbyTitleLogo`)も同じ画像を使う** |
| `bgm_final5.mp3` / `bgm_lastbattle.mp3` / `bgm_shop.mp3` / `bgm_lobby.mp3` / `bgm_training.mp3` | 決戦(残り5人以下) / ラストバトル(残り2人) / ショップ / **ロビー(既定)** / **マスモンのトレーニング** のBGM実音源。すべてmono 96k・`loudnorm=I=-16:TP=-1.5:LRA=11`で整音。`monsters/*.png`同様に実行時読み込みの外部アセット |
| `se_darkhost.mp3` / `se_mocchibeam.mp3` / `se_crystal.mp3` | 3秒級の技SE実音源。短いSEは内蔵データURIだが、この長さは外部ファイルにしている(`createSeOneShot`はfetchなのでURLでもデータURIでも同じに動く) |

## 重要な設計知識

### 画面(スクリーン)の追加・変更時
- 各画面は `index.html` 内の `<div class="resultScreen hidden">` 等で定義し、`.hidden`(display:none !important)の付け外しで遷移する。
- **マルチのマッチング(`#lobbyScreen`)と部屋一覧(`#roomListScreen`)は全面ではなく画面右側のパネル。** 背後のロビーを見せたままにするため`#startScreen`を隠さず、代わりに`#startScreen.behind-matching`で`#lobbyLayout`/`#topHeader`を`pointer-events:none`にして誤操作を防いでいる(class の付け外しはui.js末尾のMutationObserver1か所)。
- **【スクロールロックの除外・必須】新しい画面/オーバーレイを追加したら、グローバルな除外リストにそのIDを必ず3か所すべて追加する:** `render.js` の `touchmove`、`input.js` の `touchend` と `dblclick`(いずれも `e.target.closest('#xxx')` の連鎖)。追加しないと画面内スクロールやタップが効かないバグになる(過去に管理者画面・ランキング画面・デイリー/シーズンで対応)。3リストは同じ内容に保つこと。
- **【ポップアップ画面の横幅・スクロール・×ボタン 定型】`.mastermon-confirm-overlay`系のポップアップ(バッグ/ショップ/デイリー/シーズン等)を新規追加するときは、以下を守れば毎回同じ手直しが不要:**
  - 幅は基底 `.mastermon-confirm-box`(`max-width:340px`)に負けるので、**複合セレクタ** `.mastermon-confirm-box.xxx-box{ ... }` で `max-width:min(760px, calc(95 * var(--vw))); width:min(760px, calc(95 * var(--vw)));` を指定(ショップ/バッグと同じ広さ)。単一クラス指定だと340pxのまま。
  - **`position:relative` を必ず付ける。** 付けないと右上の `.overlay-close-btn`(`position:absolute`)が画面全体基準になり、枠外(画面隅)に飛ぶ。
  - 縦にはみ出す前提で **`max-height:calc(94 * var(--vh)); overflow-y:auto`** を付け、枠ごとスクロールさせる(内側に別の `max-height` スクロールを重ねない)。
- プルダウンは `.custom-select` / `.custom-select-menu` の自前実装を再利用する。ポップアップが親のoverflowで切れないよう「外枠はoverflow可視・中のリストだけ独立スクロール」の構成にする。
- 横長(landscape)の低い画面が前提。新しい画面は縦幅を詰めてスクロールなしで収まるようにする。

### タイトル画面(起動直後)
- 流れは「起動 → `#titleScreen` → タップ → `#startScreen`(ロビー)」。ロビーはHTMLで`.hidden`を付けた状態で始まり、タップで外す。
- ロゴ(`title_logo.png`)は左下の外からスライドイン(`titleLogoIn`)し、着地後に光沢(`titleShine`)がループする。**光沢は要素をtransformで動かしてはいけない。** ロゴ画像をmaskに使っているので要素が動くとマスクも動き、別の位置にロゴの形が浮き出る(実際に出た)。`background-position`だけを動かす。
- 読み込みは`initTitleScreen()`が待つ: `document.fonts.ready` / タイトル背景・ロゴ・ロビー背景の画像 / `window.load`。**最低`TITLE_MIN_MS`(1.9秒)は必ず見せる**のでロゴのアニメが途中で消えない。完了後に`#titleTapStart`を出す。
- **タップはユーザー操作なので、ここで`audioInit()`とタイトルBGMを開始する**(iOSは操作なしに音が出せない)。
- タップSEは内蔵mp3の`titleStart`(`createSeOneShot`。未ロード時は`jakiin`にフォールバック)。
- `#titleScreen`もスクロールロックの除外リスト3か所に入れる。入れないと`touchend`の`preventDefault`でタップが効かない。

### トップ画面(ロビー)
- **1画面完結でスクロールしない。** `#startScreen`は`overflow:hidden`、`#lobbyLayout`が `左メニュー / 中央 / 右` の3カラムグリッド。サイズは全部`var(--vw)/var(--vh)`基準(メディアクエリ禁止の理由はカルーセル節と同じ)。
- 背景は`top_bg.jpg`(`#topBg`)。文字を読ませるため`#topBg::after`で左右と上下から暗いグラデーションを重ねている。
- **左カラム**: シーズン/デイリー/ガチャ/ショップ/バッグ/ランキング(`.lobby-side-btn`)+ 最下部にバナー。`justify-content:center`+バナーは`margin-top:auto`なので、短い画面でも重ならない。
- **中央**: タイトル → `#lobbyMonsterStage`(選択中モンスターの正面歩行) → 名前 → タップ案内。**`#lobbyMonsterStage`自体が`<button>`で、これを押すとモンスター選択のオーバーレイが開く**(独立した「モンスター選択」ボタンは廃止)。`<button>`にしているのは共通タップSE(audio.jsのclickハンドラが`closest('button')`で判定)とフォーカスを効かせるためなので、`div`に戻さないこと。未選択時は`#lobbyMonsterEmpty`が枠付きで点滅し、選択後は`#lobbyMonsterTapHint`が「タップしてモンスター変更」を出す。歩行は`renderLobbyMonster()`が`monsterWalkFrameDataUrls(element, skinId, 'front')`のdataURLを`setInterval`で差し替える。**マスモン選択中だけ装備スキンを反映**(モンスター一覧は素の姿を選ぶ画面なので反映しない)。歩行コマ未ロードなら静止画のまま0.35秒×6回リトライする。
- **右カラム**: `マップ` / `プレイモード` の値表示ボタン(押すとオーバーレイ)→ `バトル開始`(`#joinBtn`。大きめ+`::after`の斜め光沢スイープ+`margin-top`で下寄せ。光沢は無効時は止める)。マップ・モードの実体(`#mapTabs`/`#mapPreview`/`#modeTabs`/`#capacityTabs`/`#invertPitchRow`)はオーバーレイの中に移してあるだけなので、既存のハンドラはそのまま効く。値の表示更新は`updateLobbyPickLabels()`。
- **ヘッダー**: ⚙️設定(遊び方/画面カスタマイズ/音量) / 👤マイページ(ログイン/マイ記録/表示名) / 🆕更新履歴。**中身は元のボタンをDOMごと移動しただけ**なのでIDもハンドラも変わっていない。
- バナーは`data.js`の`LOBBY_BANNERS`に1件足すだけで増える(`LOBBY_BANNER_MS`=3秒でループ。`open`で押したとき開く画面を指定)。
- **タイマーはトップ画面の表示/非表示に合わせて止める。** `#startScreen`の`class`をMutationObserverで見て、隠れたら歩行アニメとバナーのループを停止する。
- **ロビーの初期化ブロックはui.jsの末尾に置く。** `netState`など後方で`let`宣言している値を読むため、途中で実行するとTDZで落ちる(実際に踏んだ)。

### カードカルーセル(モンスター選択 / マスモン選択で共用)
- **エンジンは`createCardCarousel(cfg)`(ui.js)1つだけ。** モンスター一覧(`mlCarousel`)とマスモン(`mmCarousel`)が同じ実装を共有し、`cfg`で「並べるキー」「カードの中身」「アクセント色」「タップ時の動作」だけを差し替える。**カルーセルの挙動を直すときは必ずエンジン側を直す**(片方だけ直すと必ず食い違う)。
- 位置は**全部JSがtransformで書く**。`st.pos`(小数。整数のときそのカードが中央)を唯一の状態とし、`render()`が全カードに`translate3d/rotateY/scale`と`filter:brightness`を設定する。**`.ml-card`にtransitionを付けてはいけない**(ドラッグ追従が鈍る)。滑らかな吸着は`startAnim()`のrAFで`pos`を`target`へ寄せて実現している。
- **無限ループは「環状の最短距離」`ringDelta(i, pos)`で成立している。** `pos`は正規化せず単調な小数のまま持ち、各カードの相対位置だけを`-n/2〜n/2`に畳む。`pos`を0〜nに丸めようとすると境界でカードが飛ぶ。登録数が5未満(マスモン)でも破綻せず、見えるカードが減るだけ。
- 見た目の定数は`CARO_*`にまとめてある(`CARO_CENTER_SCALE`=1.2 / `CARO_SIDE_BRIGHTNESS`=0.55 / `CARO_VISIBLE_SIDE`=2 / `CARO_SNAP_RATE` / `CARO_FLICK_THRESHOLD`)。
- **カード寸法とカード間隔はCSSの`#mlStage/#mmStage{--ml-card-h / --ml-card-w / --ml-step}`が正。** JSは`--ml-step`を**プローブ要素の`offsetWidth`で読む**(`.caro-step-probe`= 幅が`var(--ml-step)`の見えないdiv)。`getComputedStyle().getPropertyValue('--ml-step')`は未登録のカスタムプロパティを`calc(...)`の文字列で返すため数値にできない(`@property`は古いiOSで使えないので採用しない)。**JS側に間隔の数字を書かないこと。**
- **【メディアクエリ禁止・全画面共通】レイアウトに`@media`を使ってはいけない。** 幅で分岐したいときはworld.jsが論理幅で付ける`html.logical-narrow`(論理幅520px以下)を使う。
- **【メディアクエリ禁止】この画面のレイアウトに`@media`を使ってはいけない。** 強制横向き(端末が縦画面ロック)ではCSSの生の`vw/vh`とメディアクエリが「縦向きの実viewport」基準になり論理サイズと食い違う。実際に`@media (max-width:520px)`で詳細の2列が1列に落ちる不具合が出た。サイズは必ず`var(--vw)/var(--vh)`基準の`clamp()`で決める。
- **「少しだけ見切れる」のは`#mlStage`の幅を`calc(var(--ml-step) * 4.4)`にして`overflow:hidden`しているから。** 画面幅基準にすると広い画面で5枚とも収まってしまい、スワイプできることが伝わらなくなる。
- **1回のスワイプで2枚飛ばないようにしてある**: 離した時点の最寄りへ吸着し、フリック加算は「ドラッグだけではカードが変わらなかったとき」だけ効く(`target === Math.round(dragStartPos)`の判定)。
- **ドラッグ直後のclickは`st.suppressClick`で1回だけ無視する。** `dragMoved`を見たままにすると次のタップまで無視され続ける(詳細が開かなくなる)。
- **カード送りSE(`cardSwipe`)を鳴らすのは`render()`の1か所だけ。** 中央インデックスが`st.lastCenterIdx`から変わった瞬間に鳴らすので、ドラッグ・下段の送りボタン・隣カードのタップ・詳細の`≪ ≫`の全経路が自動でカバーされる。画面を開くときは`reset(key)`が`lastCenterIdx = null`にして鳴らさない。送りボタンは`<button>`なので、audio.jsの共通タップ音を`.ml-nav`と`.ml-card-nav`で除外して二重鳴りを防いでいる。
- **強制横向き対応は2か所**: ドラッグ量は`toLogicalDelta()`で回転補正する / 詳細を開くFLIP演出(`caroFlipCard`)は`getBoundingClientRect()`が実画面基準なので`isForcedLandscape()`で幅と高さを入れ替え、中心座標は`toLogicalPoint()`で論理座標に直してから差分を出す。
- 画面を閉じるときは`stopAnim()`で**必ずrAFを止める**。
- **詳細ビューは一覧のカードDOMを`cloneNode`して左カラムに置く。** カルーセルがインラインで書いた`transform/filter/opacity/z-index`が付いてくるので、`#mlDetailCardSlot .ml-card`側で全部`!important`で打ち消している。**特に`z-index:1 !important`を外すと、カード(z:50)が上に乗って`≪ ≫`ボタン(z:12)が見えなくなる。**
- 詳細のカードは**絵が余りを埋める / 本文は必要な高さだけ**のフレックス配置にしてある(一覧と同じパーセント指定のままだと、カードが横長になったときに本文がはみ出して切れる)。
- カードの`HP/速さ`は`.ml-card-fig-v`で大きく表示する(Russo One + オーラ色の発光)。**オーラのアイコンはカードにも詳細のチップにも出さない**(枠と上端のラインの色で表現する)。
- カード上の`≪ ≫`(`.ml-card-nav`)は**背景・枠なしで記号だけ**。絵を隠さないため。視認性は`text-shadow`で確保する。

### モンスター選択(トップ画面の分岐 → モンスター一覧)
- 導線は「トップ画面の`モンスター選択`(`.selector-card`が2枚: マスモン / モンスター一覧) → それぞれの画面」。分岐カードは`renderSelectorCards()`が中身を書き、CSSでアイコン左・テキスト右・右端`::after`の`›`という横並びにしている(縦積みだと日本語が折り返して崩れる)。
- **この画面は「素のモンスター」を選ぶ画面なので、装備スキンを一切見ない。** カード画像は`defaultMonsterImgTag()`(`equippedIconImgTag()`ではない)、オーラは`mlAuraOf()`が`MONSTER_AURA`を直に引く、技は`buildMastermonMovesHtml(key, {ignoreSkin:true})`。ignoreSkinは擬似エンティティを`{isPlayer:false, skinId:null}`にすることで`entitySkinId()`をnullにし、`getMoveAura`/`skinTier3Move`/`getMoveName`/`ssrTier3DmgMult`をまとめて既定値にしている(1か所で効く)。
- 詳細の右カラムは**上段2列(`.ml-info-cols`: STATUS / 特性+状態変化) + 下に技を全幅**。STATUSは共用の`caroStatusSecHtml()`で出す(初期値+適正バッジ)。
- **ヘッダー(`.ml-info-head`)はスクロールさせない。** 中身は`.ml-info-scroll`に入れ、`#mlDetailRight`は`overflow:hidden`のフレックス縦置きにする。右上の×と重ならないようヘッダーに`padding-right:46px`を入れている。
- スクロール部の右端には**マスモン側と同じ自前のスライドバー**を置く(`.mm-content-wrap` + `.mm-scrollbar` + `attachVisibleScrollbar()`)。両画面で同じ実装を使うので、直すときはヘルパー側を直す。

### マスモン選択(カルーセル + 詳細)
- カードは`mmCardInnerHtml()`。**マスモンは「着せ替え済みの姿」なので、こちらは装備スキンを反映する**(画像=`equippedIconImgTag`、アクセント色=`getMonsterAura`)。モンスター一覧と逆なので混同しないこと。
- カードにはLvバッジ・育成後の実効HP/速さ(`mmEffectiveStats`)・EXPバー・チケット数を出す。**EXP行があるぶん本文が長いので、`.ml-card-art-mm`/`.ml-card-body-mm`で絵の比率を50%に下げている**(下げないと本文が枠外に出て切れる)。
- 詳細の左カラムは「カード → このマスモンで参戦 → 編集 / 一覧へ」の3ボタンだけ。**残りの縦幅は全部カードに使う**(`#mmDetailCardSlot{min-height:calc(40 * var(--vh))}`)。
- 右カラムは`#mastermonDetailPanel`で、`renderMastermonDetail(key)`が「全幅ヘッダー(名前+Lv+タブ名+戻る) → STATUS + 内容」を描く。**ヘッダーはステータスの上まで全幅**(モンスター一覧と同じ位置)。
- **`mastermonDetailTab`がnullのときが初期画面**で、STATUSの右に`詳細情報 / トレーニング / 着せ替え`の3ボタン(`buildMastermonMenuHtml`)を出す。タブを開くと右上に`← 戻る`が出てnullへ戻る。**技一覧タブは廃止し、内容は詳細情報(`buildMastermonInfoHtml`)に統合した。** 着せ替えタブだけステータス列を出さないのは従来通り。
- **詳細情報タブの内容は`.mm-subview-content`の1スクロールにまとめてある**(2列+技は全幅の1グリッド)。右端には`attachVisibleScrollbar()`が更新する**自前のスライドバー**を置く(モンスター一覧の詳細と共用)。iOSのネイティブスクロールバーはスクロール中しか出ないため、スクロールできることが見て分かるように自前で描いてつまみをドラッグできるようにしている(高さ変化はResizeObserverで追従。監視対象は要素ごとに`el._scrollbarRO`へ持たせるので2画面で同時に使っても壊れない)。
- STATUSはモンスター一覧と共用の`caroStatusSecHtml()`。**バーの下に6ステータスの短縮説明を3つ×2行で置く(`STAT_SHORT_DESC`)。** `MASTERMON_STATS`の`desc`は長すぎて折り返すので、この画面用の短い文を別に持っている。
- `renderMastermonList()`は名前を残したまま中身が「カルーセルのカードを作り直す」に変わっている(改名・トレーニング・着せ替えの後から呼ばれるため)。**登録数が変わったときは`build()`、値だけ変わったときは`refreshCards()`。**

### 安全圏(zoneState)
- `ZONE_PHASES`でフェーズ定義。安定フェーズ開始時に`prepareNextZoneTarget()`で次の縮小先を事前決定し、`toCenter/toRadius`を予測点線として表示する。
- マルチプレイではホストのzoneState(toCenter含む)をauthStateで同期する。

### マルチプレイ(network.js)
- ホスト権威型。ワールド生成はシード付き乱数(`seededRand`)でホスト/ゲストが同一結果を得る。ソロ用とシード付きの生成関数が対になって存在する(例: `spawnLoot` / `seededSpawnLoot`)。**ワールド生成ロジックを変更するときは必ず両方を同じように変更する。**
- ホスト側だけで発生するイベント(アイテム出現等)はゲストへ明示的に配信が必要。

#### ゲストに「起きない・遅れる」系の不具合を作らないための原則
ゲストは`update(dt)`を一切実行しない。**ホストのループの中でしか起きない処理は、ゲストには自動では何も起きない。** 新しく「〜したら演出/表示が出る」処理をホスト側に足すときは、必ず下のどれかで届ける。
- **1件も落とせない単発の通知**(キルフィード等)は`onChildAdded`+キーでの重複排除で配信する。**`limitToLast(1)`+`onValue`は短時間に複数件発生すると途中が丸ごと消えるので使ってはいけない**(キルフィードが流れない原因だった)。`handleRoomEvent()`が受け口。
- **ホストは自分が関与したイベントだけを配信してはいけない。** ホストは唯一の権威なので、bot同士のキルも含めて全件配信する(以前は`killer.isPlayer||victim.isPlayer`で絞っていたため、ゲストのキルフィードがほぼ空だった)。
- **HP/ガッツのような数値はauthStateで伝わるが、SE・ダメージ数字・トーストは伝わらない。** ゲスト側で同じ演出を再現する必要がある(キルボーナスがそれ)。撃破EXPボーナス(`mastermonKillExpBonus`)のようにリザルトで使う値も明示的に同期する。
- **`AUTH_FULL_EVERY`で間引かれる「コールド」フィールド(maxHp・train系係数等)は最大0.4秒遅れる。** アイテム取得のように即座に効果を見せたい変更をしたら`hostForceFullNext = true`を立てて次の配信をフルにする。
- **「ホストのupdate()の中だけで起きる演出」を足したら、必ずゲスト側の再現も足す。** 実績のあるパターンは2つ: ①ホストが単発イベントを配信してゲストが同じ演出を出す(キルボーナス・状態変化の発動)、②同期済みの情報からゲストが自前で見た目だけ出す(安全圏外/溶岩のダメージ数字=`showGuestEnvironmentDamage`)。**HP等の数値はauthStateで伝わるので、足りないのはほぼ常に「演出」の側**。
- **絶対時刻(matchTime基準)のフィールドは残り秒数で送る。** ホストとゲストのmatchTimeは実測でズレる(dtの上限やコマ落ちの差)ため、絶対値を送ると効果時間が伸び縮みする。現在この方式で送っているもの: 凍結`fz`/鈍足`sl`/速度バフ`sb`/やけど`bn`/どく`po`/状態変化`stR`・`stcR`。**新しい「〜Until」を足したらここに倣う。**
- **安全圏の`zoneState.timer`も同期する(`zone.tm`)。** これが無いとゲストの「次の縮小まであと何秒」が一切進まず、縮小に備えられない(見落としやすい)。
- **`updatePendingAoeCasts()`はゲストのループでも呼ぶ。** 呼ばないと連射する範囲技の2発目以降が永久に出ない。**`pendingAoeCasts`は試合開始時に必ずクリアする**(残ると次の試合で無関係なモンスターから幻の範囲攻撃が発生する。idが1から振り直されるため)。
- **自分が撃った弾の「エコー」はゲストで捨てられる**(`spawnVisualShotFromEvent`が`sourceNetId===myPlayerId`で弾く)。そのため**着弾ドーム(`blast`)のようにホストが後から生成する派生エフェクトは、ゲストが自分でも生成しないと自分の攻撃だけ爆発が見えない**。ゲストの視覚専用弾にも`blast`を持たせ、着弾時に`spawnGroundBlast`を呼ぶ。
- **発射できる条件は3か所で一致させる**: `tryPlayerFire`(ホスト自身) / `tryNonHostPlayerFireVisual`(ゲストの見た目) / `processRemoteFireEvents`(ホストがゲストの発射を確定)。どれか1つに条件が無いと「ゲストだけ凍結中に撃てる」「撃ったのに何も起きない」といった食い違いになる。
- **取得判定のようにホストしか行わない処理は、ゲスト側で見た目だけ先読みする。** アイテムは`predictLootPickupsAsGuest()`が重なった瞬間に隠し、ホストの確定が来なければ一定時間後に復活させる。**先読みフラグの判定は`!= null`で行う**(`matchTime`が0=試合開始直後だと真偽値では未先読みと区別できない)。

#### ゲスト側の位置・動きの扱い(ラバーバンド/瞬間移動対策)
- **位置補正のしきい値は移動速度に比例させる(`selfCorrectSpeedScale`)。** 固定距離だと、育成やバフで速くなるほど1往復ぶんの移動量が許容を超え、通常の前進でも引き戻され`SELF_CORRECT_SNAP`にも届いて瞬間移動して見える。`entityMoveSpeed(ent)`(combat.js)を基準に許容と収束速度を同じ倍率で広げる。
- **マルチだけ移動速度と弾速を落とす**(`MULTI_MOVE_SPEED_MULT`/`MULTI_PROJ_SPEED_MULT`、combat.js)。掛ける場所は`resolveMovement`の`effSpeed`と`effectiveProjSpeed`の各1か所だけなので、ホスト/ゲストの計算が自動で一致する。**ダッシュ速度は`slowedSpeed`基準のままにして飛距離を変えない。**
- **自分の位置は「同じ入力時点どうし」で突き合わせる。** 入力に`seq`を付けて送り、ホストは`applyRemoteInputsLocally`で適用したseqを`aseq`として返す。ゲストは`selfPredHistory`(送信時点の予測位置)と突き合わせて誤差を出し、`SELF_CORRECT_DEADZONE`以下は無視、それ以上は`selfCorrX/Y`に溜めて毎フレーム少しずつ消費する。**現在位置とホストの(遅れた)位置を直接比べてはいけない** — 遅延そのものが誤差になり、移動中ずっと後ろへ引っ張られる。水中など低速地形では前進速度を上回って操作不能になっていた。
- **ダッシュのような「一瞬だけ大きく動く操作」は入力に回数(`dashSeq`)を載せてホストに再現させる。** 送っていないとホストは通常移動のまま計算するので、動いたぶんがそのまま誤差になり引き戻される(実際にダッシュで起きていた)。連続値のフラグではなく回数にすることで、二重発動も取りこぼしも防げる。ダッシュ開始処理は`startEntityDash()`に切り出してホスト/ゲストで同じ向き計算を使う。**自分のダッシュのクールタイムはauthStateで上書きしない**(1往復遅れた0が届いて連続ダッシュできてしまう)。
- **ダッシュ中と直後だけ位置の許容を広げる(`SELF_CORRECT_DEADZONE_DASH`)。** ホストがダッシュ入力を受け取るまでの数フレームぶんは必ず位置が離れるが、両者がダッシュを終えれば移動量は一致して誤差は自然に消える。ここで補正すると「ダッシュしたのに引き戻される」動きに戻ってしまう。
- **移動に影響する状態異常(`freezeUntil`/`slowUntil`/`speedBuffUntil`)は必ず同期する。** ホストだけが知っていると、ゲストは通常速度で予測し続けて誤差が開き、上の補正で引き戻される。**絶対時刻ではなく「残り秒数」で送り、受信側で`matchTime + 残り`に変換する**(ホストとゲストのmatchTimeはズレるため)。
- **他エンティティの補間はホストの試合時刻(`payload.t`)を時間軸にする。** 到着時刻を軸にすると、配信がまとめて届いた(ジッタ)ときにスナップショット間隔が実際より短く見積もられ、**速い相手が瞬間移動したように飛ぶ**。`hostClockOffset`(最速で届いた配信を基準)でローカル時刻へ変換する。
- 新しい試合を始めるときは`beginMultiplayerMatch`の先頭で補間・突き合わせの状態(`guestSnapBuf`/`hostClockOffset`/`selfPredHistory`/`selfCorrX/Y`/`selfInputSeq`)を必ずリセットする。

#### 落ちないための保険(フリーズ対策)
- **`loop()`の中身は必ずtry/catchで囲む。** 例外をそのまま投げると`requestAnimationFrame`が再登録されず、**描画も入力も完全に止まり、次の試合を始めても動かない**(復帰不能のフリーズ)。捕まえたら`console.error`+初回のみトーストで知らせ、RAFは必ず継続する。
- **`beginMultiplayerMatch()`は外枠のtry/catchでフラグを必ず戻す。** 中で例外が出ると`matchBeginning`が立ったまま・`game.started`がfalseのまま抜け、以降「試合を始めようとしても何も起きない」状態になる。失敗時はトップ画面へ帰して部屋も離脱する。
- **ゲストの自分の座標は`sanitizeSelfPosition()`で毎フレーム点検する。** 一度NaNが入ると以降ずっと描画されず操作もできない。直前の正常な位置へ戻す。

#### 観戦(ホスト敗退後)
- `spectateCandidates()`は**自分以外の生存者全員**(人間を先、botを後)。人間だけを候補にすると、生き残りが1人のときに「次のプレイヤー」を押しても切り替わらない。観戦の終了判定(`checkWin`の`humanAlive`)は候補とは別なので、botを候補に含めても試合終了の条件は変わらない。

### マスモン(メタ進行)
- localStorage永続化(`data.js`の`loadMastermons`/`saveMastermons`)。
- 6ステータス(ライフ/ちから/かしこさ/命中/回避/丈夫さ)。戦闘への反映は`mastermonStatFactor(v, statKey)`で、`MASTERMON_STAT_FACTOR_DIVISOR`によりステータスごとに増減幅が異なる(数値が小さいほど効きが強い)。
- EXPは`awardMastermonExp`。全試合共通倍率`MASTERMON_EXP_GLOBAL_MULT`(現在3)×マルチボーナス等の`xpMult`。
- **育成ステータスの適用は「エンティティ生成 → `applyMastermonStatsToEntity(ent, mm)`」の1本道。** ソロは`startGame()`の`applyMastermonToPlayer()`、マルチは`beginMultiplayerMatchInner()`の人間ループ。
- **マルチでは育成ステータスを部屋の参加者情報で共有する。** `currentMastermonInfo()`(ui.js)が`{level, stats}`を返し、入室時に`rooms/{id}/players/{pid}.mm`へ書き込む(`mmLevel`は旧クライアント互換の残置)。`beginMultiplayerMatchInner`は`h.mm`から**自分・相手・ホスト・ゲストの区別なく同じ倍率**を計算する。**ステータスを共有せず片側だけで掛けるとHPと移動速度が食い違い、ゲストの位置補正が暴れる(ラバーバンドの原因になる)。**
  - **入室経路は3つあり、`mm`を載せ忘れやすい**: `__aramonCreateRoom` / `__aramonJoinRoom` / `__aramonFindOrCreateRoom`(自動マッチング。以前ここだけ`mmLevel`を送っておらず、この経路で作った部屋では撃破ボーナスが一切入らなかった)。firebase.js側は書き込みを`mmEntryFields(mmInfo)`に集約したので、**プレイヤー項目を書く行(計4か所)は必ずこれをスプレッドする**。
  - `maxHp`はauthStateのコールドフィールドで上書きされるので最終的にホストが正。**同期していないのは`speed`と各`mastermon*Mult`なので、そこが一致することが重要。**
- **撃破EXPボーナス(`victim.mastermonLevel` × `MASTERMON_KILL_EXP_PER_LEVEL`)はbot・人間の区別なく与える。** ホストが`killEntity`で積み、`hostForceFullNext = true`で次の配信をフルにして`mmKillExp`を最短で届ける。ゲストは`kill`イベント受信時にも自前で積む(最後のキルで試合が終わると同期が間に合わないため)。**`mmKillExp`の反映は`Math.max`で行う**(積み上がるだけの値なので、遅れて届いた古い値で減らさない)。
- **技強化チケット(`nextMoveBoost`)はソロ専用。** マルチでは`moveTierUnlocked`がホスト権威で、authStateは「上げる方向にしか」反映しないため、開始tierを共有しないと食い違う。マルチにも入れるなら参加者情報に載せて両側で同じtierから始めること。

### Firebase
- Realtime Database。パス: `scores`(ランキングのベスト記録), `matchLogs`(管理者画面用の試合ログ), `lobby`, `rooms`, `accounts`(プレイヤーアカウント)。
- **新しいDBパスを追加したら、Firebaseコンソール側のセキュリティルールにもそのパスの`.read`/`.write`を追加する必要がある**(ルール未定義のパスはデフォルト拒否)。コードだけでは動かないので、変更時はコミットメッセージやPR説明でルール追加が必要な旨を必ず伝えること。**発注者がコンソールで手作業で貼るので、貼り付け用のJSONをそのまま渡すこと。**
- 管理者画面: トップ画面最下部の小さな「管理者用」ボタン → 4桁パスワード(0008) → 表示。プレイヤー名「おりょう」は集計から除外。
  - タイトル右に**「プレイ状況」「音声確認」タブ**(`.admin-tab`, `adminShowTab`)。各ペイン(`#adminStatsPane`/`#adminSePane`)は`display:flex`の縦フレックスにして内側をスクロールさせる(blockのままだと内側のflex高さ制約が効かずスクロール不能になる)。
  - 「音声確認」タブ内はさらに**「SE」「BGM」サブタブ**(`.admin-subtab`, `adminShowSeSubtab`)。全SEを`SE_DEFS`から自動列挙してタップ再生、全BGM(タイトル/試合中3段階/残り5人以下/停止)を確認できる。この画面では共通タップSE(`tap`)を鳴らさない(`audio.js`のclickハンドラで`#adminSePane`配下を除外)。
  - 動作確認用「💎ダイヤ+500」ボタン(`#adminGrantDiaBtn`)は現在**hidden**(機能は残す。再表示は`hidden`を外す)。

### プレイヤーアカウント・通貨・アイテム(ui.js / data.js / firebase.js)
- ログイン: プレイヤー名+4桁パスコードで `accounts/{nameKey}` を読み書き(`window.__aramonGetAccount/__aramonSetAccount/__aramonUpdateAccountData`)。名前重複を検知。認証情報は端末に保存(`aramon_account_v1`)し自動ログイン。**自動ログインは端末に認証情報がある時点で即ログイン扱いにし、通信失敗でもログイン状態を維持する**(更新直後にログアウト表示になる不具合を防ぐため)。
- サーバー同期: `ACCOUNT_SYNC_KEYS`(マスモン/戦績/表示名/ウォレット/バッグ)を、保存時に`accountMarkDirty()`→3秒デバウンスで送信。ログイン時は`updatedAt`とローカルのタイムスタンプを比較して新しい方を採用。**localStorageのsave関数に`accountMarkDirty()`呼び出しを足すのを忘れない。**
- 通貨: `loadWallet/saveWallet/addWallet`(ゴールド/ダイヤ)。試合報酬は`showResult`で付与(定数 `GOLD_*`/`DIA_*`)。トップ画面ヘッダー(`#topHeader`)と各画面に残高表示。
- アイテム: `PLAYER_ITEMS`(実6種=各ステータス+`STAT_SEED_GAIN`, フリートレチケ, 技強化チケ)。バッグ`loadBag/saveBag/addBagItem`。ガチャ`GACHA_POOL`(ダイヤ専用・単発/10連, 10連10個目は`GACHA_TICKET_POOL`確定)、ショップ`SHOP_ITEMS`(ゴールド)。
- バッグUI: 左=アイコングリッド+説明フィールド、右=対象マスモン一覧(マスモン画面と同じステータスバー`buildMastermonStatsColHtml`を流用)。トレーニング同様「選択→使用」の2段階。

### 描画(render.js)
- `project(wx,wy,wz)`で3D風投影。描画物は`drawables`に集めてdepthソート後に描画。
- **TPSカメラは`world.js`の`CAM_DIST_BEHIND`(=145)と`CAM_HEIGHT`(=90)の2つで決まる。この2つは必ずセットで調整する。** `distBehind`を小さくすると自分のモンスターは大きくなるが**同時に画面内で下へ動き、足元が下の技フィールドに隠れる**。`height`を下げると上へ戻るので、両方を組み合わせて「大きさだけ変えて画面上の位置(足元Y)と地平線の高さは維持する」のが正解(190/120→145/90で見た目約1.35倍・足元Yは318→316でほぼ同じ)。数値を変えたら実際に`startGame()`後の`project(player.x,player.y,0)`のyと、見下ろし角(遠景の地面Y)を測って確認すること。
- 画面外カリングは`cullMarginFor`でオブジェクトの見た目上の半径に応じた余白を取る(固定余白だと巨大オブジェクトが近距離で誤って消える)。
- 障害物は影(接地点)と本体の底が接するように描く(浮いて見えるバグ防止)。
- **`areaEffects`も`drawables`に`kind:'ae'`として積み、他のオブジェクトと同じdepthソートに乗せる**(実描画は`drawSingleAreaEffect(ae)`)。かつては`drawAreaEffects()`を地面直後に一括描画していたため、**大きな岩・建物・火山と重なると範囲エフェクトがその裏に隠れて見えなくなっていた**(2026-07-25修正)。`cullMarginFor`では`kind:'ae'`に`ae.range`ぶんの余白を与える(発生地点=足元が画面外でも射程が長い技は画面内に届くため)。
- **地面に貼り付く円(範囲予告・爆風など)は、画面上で楕円を決め打ちしてはならない。** `groundCirclePoints(cx,cy,radius,segs)`でワールド座標の円周をサンプルし1点ずつ`project(x,y,0)`して多角形として描く。**このカメラでの地面円の実際の扁平率は約0.165で、`ry = rx*0.5`のような固定比率で描くと縦に約3倍伸び、円が「宙に浮いて」見える**(2026-07-25にビッグバンで発生・修正)。遠近により円の外接矩形の中心は投影中心より下にずれるのが正しい挙動。立体物(ドーム等)の高さも`project(x,y,高さ)`で頂点を投影して求めること。

### バトル歩行アニメーション(data.js / render.js)
- 動画から1歩行ループを8コマに分割した透過スプライトで歩行を表現する。`monsters/<prefix>_walk_f1..8.png`(正面)/`<prefix>_walk_b1..8.png`(後ろ)。
- **有効化はレジストリ `WALK_ANIM`(data.js)に登録するだけ。** 要素キーごとに `{ base:{front:_loadWalk('x_walk_f'), back:_loadWalk('x_walk_b')}, ssr?:{skinId, front, back} }`。現在対応: モッチー(+ラガモッチーSSR)/ガリ(+ゼウスSSR)/スエゾー/ザン/キュービ(+タマモノマエSSR)/ライガー/ヒノトリ(+フェニックスSSR)/アーク(+イブリースSSR)/ウンディーネ/ドラゴン/プラント/ゴーレム/イルミネ(+ペルセポネSSR)/ワーム/ピクシー(+ちょこSSR)。**全15エレメント対応完了。**
- 描画の入口は `getDisplayImage(entity)`。先頭で `entityWalkFrameImage(entity)` を呼び、歩行コマがあればそれを返す(なければ従来の静止画にフォールバック)。`drawMonster`/`drawMonsterPortrait` がこれを描く。
- コマ選択(`entityWalkFrameImage`): `matchTime`でコマ送り、平滑化速度`_mwSpeed`が`WALK_MOVE_EPS`超で「歩行中」。進行方向とカメラ`camState.yaw`の内積で正面/後ろを切替(カメラ奥向き=後ろ姿)。停止中は静止(自分=後ろ姿/他=正面)。素体は色スキン装備時に`recolorToCanvas`で各コマ再着色し`_walkRecolor`にキャッシュ。**歩行コマ未提供のSSRスキン装備時は`null`を返し従来の静止スキン画像を表示**(ガード有り。現在対応済みSSRはラガモッチー/ゼウス/タマモノマエ/フェニックス/イブリース/ちょこ/ペルセポネの7種で、これ以外の新規SSRを追加した際に歩行コマを用意しなければこのガードが働く)。
- **黒背景で生成された素材(ペルセポネ等)は輝度キーで抜く。** 白背景用の`white_alpha`ではなく「輝度6→40のゆるやかなランプでアルファを作り、被写体内側の小さな閉じた暗部だけ不透明に戻す」方式。**全体を`binary_fill_holes`してはいけない**(渦や発光が輪になっている部分の内側=背景まで埋まって黒い板になる)。
- **透過PNGの保存は`quantize(colors=256, method=Image.FASTOCTREE)`。** RGBAを扱えるので、やわらかい発光の階調を保ったまま既存の`monsters/*.png`と同じ「パレット+per-index alpha」形式になり、RGBAのまま保存するより1/4以下に収まる。**`convert('P')`+`transparency=255`は透過が正しく書かれないので使わない**(全面不透明になった)。
- **動画に透かしタグが入っている場合は「明るいのに全フレームで動かない画素」を静止マスクとして抜く。** 矩形で塗り潰すと被写体(三叉の槍の先など)を削ってしまう。マスクを数px膨張させてアンチエイリアスの縁も消す。
- **歩行周期は「下半身の時系列からドリフト(移動平均)を引いた自己相関」で探す。** 生の自己相関はAI動画のゆっくりしたズーム/揺らぎに埋もれて単調増加になり周期が出ない。半周期で強い負の相関が出るのでその2倍が周期。
- **スプライト生成は `tools/build_walk.py`(開発用)。** 動画→60fps抽出→自己相関で1周期検出→8コマ抽出→モンスター別セグメンテーション→320px・256色透過PNGに統一(足を94%基準・中央寄せ)。背景/被写体別モード:
  - 白背景(キュービ等) = `white_alpha`: 隅から連結する白のみ透過(内側の白い毛は残す)。
  - 淡い草/金背景 = `grabcut_alpha`(`single`/`gentle`/`hard`/`hardgentle`): grabCut切り抜き。`gentle`はopen省略で細い足を守る(スエゾーの一本足)、`hard`は縁を確定背景にしたマスク初期化(金色ボケ背景)。
  - 鳥(ヒノトリ/フェニックス。炎・羽が背景色に近い) = `phoenixcut_alpha`: 彩度/明度/背景色距離で本体抽出。**かぎ爪の足(暗色)を明示追加し中央下部限定の縦closeで本体に接続**(largestで足が消えるのを防ぐ)、足元の淡い地面/オーラを色で除去、トサカを上端中央で復元。正面は脚間を残すため小穴のみ塗り、後ろは尾を塗りつぶして密度確保。パラメータは`_PHX`(satT/distT/fill/warm_trim)で正面・後ろ別。
- **【検証必須・過去に鳥系で何度も手戻り】新しい歩行スプライトは、全16コマ(正面8+後ろ8)を1コマずつ目視し「トサカ等の突起」「足」が欠けないこと・足元の背景/地面が透過していることを確認してから採用する。** `tools/build_walk.py`の隣に置く判定(bboxの上端中央=トサカ、下端中央=足に画素があるか)で全コマ自動チェックしつつ、必ず目視も行う。
- **`tools/build_walk.py`の`W`/`OUTDIR`は環境変数`BUILD_WALK_WORK`/`BUILD_WALK_OUT`で上書きでき、既定の出力先はスクリプト位置から解決した`<repo>/monsters`。** セッションごとに更新が必要なのは`MOV{}`の動画パス(`/root/.claude/uploads/<セッションID>/...`)だけ。
- **`tools/build_walk.py`のJOBS/MOVに新規ジョブを足すとき、job id(例:`'p1'`)が既存行と重複していないか必ず`grep`で確認すること。** 重複するとMOV辞書は後勝ちで上書きされ、既存モンスターのjob定義に新しい動画パスが紛れ込み、**既存モンスターの歩行スプライトを気づかずに上書き破壊する**(2026-07-25に実際発生。phoenixのp1/p2とピクシーのp1/p2が衝突し、修復にmd5sum比較+元zipからの復元が必要だった)。空いている文字を使うこと。

### 新モンスターの追加(data.js内の登録箇所チェックリスト)
新しい要素キー(例:`pixie`)を1体追加する際、以下**すべて**に対応する行を追加する。上から順にやれば漏れない。1つでも欠けると「選択はできるが技が出ない」「色スキンが効かない」等の不具合になる。
1. `ELEMENTS`: label/color/dark/(accent)/speed/(speedMod)/hp/trait/(dmgTakenMod等の特性モディファイア)
2. `TRAIT_DESC`(ui.js): `trait`キーに対応する説明文
3. `SIGNATURE_MOVES`: tier1/2/3の技配列
4. `MOVE_AURA`: 各技名→オーラ色
5. `MONSTER_AURA`: 無スキン時のデフォルトオーラ
6. `SKIN_CONFIG`: 5色スキンの置換対象色相(`source.hue`は実画像から主要色をサンプリングして決める)
7. `STATE_CHANGES`: 状態変化(発動条件/効果)。全モンスターが1つずつ持つ設計なので省略しない
8. `APTITUDE`: マスモンのステータス適正(A〜E)
9. `WALK_ANIM`(任意・歩行動画がある場合): `_loadWalk`で front/back を登録
10. `monsters/<key>.png`・`<key>_player.png`(静止画。正方形キャンバス・被写体が高さの9割前後を占め足元が下端付近、という既存ファイルの規格に正規化してから配置する)
- 技に`aoeShape`(範囲技)や独自の着弾処理(例:ピクシー「ビッグバン」の着弾ドームAoE=`blast`フィールド+`spawnGroundBlast`)等、既存にないギミックが必要な場合はcombat.js/render.jsの拡張が必要になる。既存の同系統実装(`aoeShape`分岐・`areaEffects`)を参考に、新しい`kind`を増やす形で実装するのが素直。

### スキンとオーラ・プレビュー(data.js / render.js / ui.js)
- **【新しいSSRスキンを足すときの登録先】画像は`SSR_SKINS`に書けば`ssrSkinImages`が自動で読み込む。** 以前は`ssrSkinImages`(data.js)がスキンIDを手書きで並べた表で、追記を忘れると**カタログ・バッグのスキン欄・着せ替え画面・装備時の見た目すべてが素のモンスターや✨にフォールバックする**(ペルセポネで実際に発生)。`SSR_SKINS`のキー走査で生成するようにしたので、もう表への追記は不要。**`ssrSkinImages`の実体生成は`SSR_SKINS`の宣言直後に置くこと**(data.js前半の宣言位置では`SSR_SKINS`がTDZで落ちる)。
- **DOM表示は事前ロードに依存させない。** `skinnedIconDataUrl`/`skinnedPlayerDataUrl`は画像が未ロードでもSSRなら`ssrSkinFileUrl()`でファイルのURLを返す。`<img src>`はブラウザが自分で読むので、読み込み待ちや事前ロードの取りこぼしで素のモンスターに化けない。**canvasへ描く経路(`skinnedImage`)はロード済みのImageが必要**なので、こちらは`ssrSkinImages`が正しく揃っていることが前提。
- 新SSR追加時のチェックリスト: `SSR_SKINS` / `SSR_SKIN_AURA` / `SSR_SKIN_TIER3`(専用技を出すなら) / `SKIN_TIER3_SE`(専用SEを出すなら) / `WALK_ANIM`の`ssr`(歩行コマがあるなら) / `monsters/<iconImg>.png`・`<playerImg>.png`。ガチャとカタログは`gachaSsrSkinIds()`が`SSR_SKINS`から作るので作業不要。
- **tier3技のオーラ/エフェクト色はSSRスキンもSR色スキンも変える。** 判定は`skinTier3Aura(skinId)`1か所に集約(SSR=`SSR_SKIN_AURA`の固定色 / SR=`element:colorId`のcolorId)。`getMoveAura`/`getMoveEffectColor`がこれを見るので、**エフェクト色の伝搬(combat.jsとnetwork.jsの`effColor`/`auraTint`)は触らなくてよい**。
- **SSRだけの特典は「tier3の技名と威力」**(`SSR_SKIN_TIER3`/`getMoveName`/`ssrTier3DmgMult`)。SRはオーラ・エフェクトのみでここは変えない。新しいスキン種別を足すときもこの線引きを守る。
- **`SSR_SKIN_TIER3`は2通りの書き方ができる。** `dmgMult`=元の技の威力に倍率を掛けるだけ(従来型)。`move:{...}`=元の技のフィールドを直接上書きし、性能ごと変える専用技にする(ちょこの「ヴァニッシュ」)。`blast`は中身をマージするので変えたいキーだけ書けばよい。**`move`側に`dmg`を書くときは`dmgMult`を併記しない**(`ssrTier3DmgMult`が別途掛かって二重適用になる)。
- **専用技の解決は`skinTier3Move(move, attacker)`。** 解決結果はスキンID+技名でキャッシュする(元の`SIGNATURE_MOVES`は書き換えない)。**呼ぶ場所は4か所で、増やしたら全部に通すこと**: `combat.js`の`fireMove`先頭 / `network.js`のゲスト発射(`tryNonHostPlayerFireVisual`) / `render.js`のHUD技フィールド / `ui.js`の技一覧(`buildMastermonMovesHtml`)。fireMove先頭で解決すれば威力・弾速・射程・爆風・消費ガッツ・SEはすべて解決後の値で流れる。
- **「本体色はオーラ色、ビリビリ電撃だけ既定の紫」にしたい技は`keepArcColor:true`**(ペルセポネの「アムピトリテ」)。`getMoveAuraTint`がnullを返し、`arcColorsFor(null)`の既定色(紫)になる。`keepBaseColor`と対になるフラグ。
- **`SSR_SKIN_TIER3`の中で`auraColorHex()`を呼んではいけない。** `SKIN_COLORS`の宣言はこの定義より後ろなのでTDZで落ちる(data.js全体が読み込めなくなる)。色はリテラルで書く。
- **「本体色は元のまま、差し色だけオーラ色にしたい」技は`keepBaseColor:true`。** `getMoveEffectColor`が本体色を返し、差し色は`getMoveAuraTint`が別に返す(ちょこ=球体とドームは黒のまま、ビリビリ電撃だけ赤)。ビリビリの2色は`render.js`の`arcColorsFor(tint)`に集約してあり、弾(`voidOrb`)とドーム(`drawDomeBurstEffect`)の両方が使う。**`spawnGroundBlast`には弾の`auraTint`を渡すこと**(渡さないとドームだけ既定色に戻る)。
- **スキン別のSE差し替えは3つの対応表で行う**(combat.js): `SKIN_TIER3_SE`(tier3発射) / `SKIN_SUMMON_SE`(召喚演出) / `SKIN_HIT_SE`(被弾)。いずれも`playSe(skinXxxSeName(entity) || '既定SE')`の形で呼ぶので、未定義スキンは自動で既定SEになる。
- **スキンプレビュー(`showSkinPreview`)は歩行モーションを再生する。** `skinWalkFrameDataUrls(skinId, view)`(render.js)が歩行8コマをdataURL配列で返し(色スキンは`recolorToCanvas`で再着色・`_skinDataUrlCache`にキャッシュ)、ui.jsの`startSkinPreviewAnim`が`WALK_FRAME_DUR`間隔で正面/後ろの`<img>.src`を差し替える。**歩行コマ未用意/未ロードならnullを返し静止画のまま**(画像ロード待ちの可能性があるので0.35秒×最大6回リトライする)。オーバーレイを閉じたら必ず`stopSkinPreviewAnim()`でタイマーを止める。

### 文字入力(input.js / index.html / style.css)
- **文字入力はすべて共通ポップアップ(`#textInputOverlay`)で行う。** iOSのソフトキーボードは実画面の下側を覆い、**強制横向きではそれがアプリの右側にあたる**ため、画面のどこに入力欄を置いても隠れうる。アプリ全体をずらす方式は強制横向きと相性が悪く実機で破綻したので採用しない(2026-07-27に一度試して差し戻した)。
- 仕組み: `focusin`(capture)で対象の`<input>`を`readOnly`にして`blur()`し、ポップアップを開いて中の入力欄に`focus()`する。**focusはタップと同じターンで呼ぶこと**(iOSはユーザー操作外だとキーボードを出さない)。確定時に元の欄へ値を書き戻し、`input`/`change`イベントを流して既存のハンドラを動かす。
- **documentへの委譲なので、新しい入力欄を足しても個別対応は不要**(動的に生成されるマスモンの名前変更欄にも効く)。対象外にしたい入力は`type`を`range`等にするか`KB_SKIP_TYPES`を見る。
- 見出しは`data-kb-title` → 直前の要素のテキスト(20文字以内) → `placeholder` の順。長い説明文が見出しにならないよう文字数で弾いている。
- ポップアップの位置は**通常時は上端中央 / 強制横向き時は左端寄せ**(回転後のアプリ右側が実画面の下=キーボードの位置になるため)。`#textInputOverlay`はスクロールロックの除外リスト3か所にも入れる。

### 長押しでの選択・メニュー抑止(style.css / input.js)
- CSSとJSの二段構えで全画面に効かせている。**新しい画面を足しても個別対応は不要。**
  - style.css の `*` に `-webkit-user-select:none; user-select:none; -webkit-touch-callout:none;`(callout無しだとiOSで長押し時に「コピー/調べる/画像を保存」が出る)。**直後の `input, textarea{ user-select:text }` で入力欄だけ選択可能に戻しているので、この2行はセットで維持する。**
  - input.js の `contextmenu`/`selectstart` を`preventDefault`(`isTextEntry()`で入力欄は除外)。
  - **`-webkit-touch-callout`はiOS Safari専用。** ブラウザの計算値には出ないので、style.cssのテキストで確認する(実機では効く)。

### 更新履歴(ui.js / data.js)
- 項目は`{ t:本文, g:[タグid…] }`。タグ定義は`data.js`の`CHANGELOG_TAGS`(id/label/color)。
- タイトルとタグ行(`.changelog-head`)はスクロールさせず、下の`.changelog-list`だけをスクロールさせる。右端のスライドバーはマスモン詳細と共用の`attachVisibleScrollbar()`。
- 絞り込みは`changelogFilterTag`(nullで全件)。タグを押すたびに`renderChangelogTags()`+`renderChangelogList()`を呼ぶ。該当が0件の日付は行ごと出さない。
- **タグの色は`color-mix()`を使わずJS側で`changelogTagVars()`が透過色を作ってCSS変数で渡す**(`color-mix`は古いiOSで使えない)。

### 更新履歴の未読バッジ(ui.js)
- `changelogSignature()` = `最新日付#全項目数`。これを`localStorage`の`aramon_changelog_seen_v1`と比較して未読判定(`changelogHasUnread`)し、`#changelogNewPop`の`new`バッジを出す(`updateChangelogBadge`)。ボタンを開いた時点で`markChangelogSeen()`が既読化する。
- 項目数を含めているので**同じ日付に項目を足しただけでも再び未読になる**。`UPDATE_HISTORY`に追記すれば自動でバッジが出るので、バッジ側の作業は不要。
- 端末ごとの既読状態なのでアカウント同期(`ACCOUNT_SYNC_KEYS`/`accountMarkDirty`)には**入れない**。

### 技のギミック(combat.js / render.js / ui.js)
- **`blast`(着弾ドームAoE。ピクシー「ビッグバン」)**: 弾に`blast:{radius,dmg,color,expandTime,(telegraphTime),(style),(se)}`を付けると、命中/最大射程到達の地点で`spawnGroundBlast()`が`kind:'circle'`の`areaEffect`を発生させ、円が広がりながらダメージ判定する。**弾の直撃ダメージ(`mv.dmg`)と爆風ダメージ(`mv.blast.dmg`)は別々に入る**(両方当たれば合計)。描画は`drawDomeBurstEffect`。
- **`burstSpread`(連射の広がり。既定0.05rad)**: 連射する技の発射角の刻みを技ごとに変えられる。**指定を読む場所は4か所**(combat.jsの`aoeShape`分岐と通常弾、network.jsのゲスト見た目の同2か所)なので、増やすときは全部に通す。アムピトリテは0.11で着弾ドームをバラけさせている。
- **長い弾(槍など)は`travelAngle - camState.yaw`で回してはいけない。** カメラ奥へ撃つと画面右向き=横倒しに見える。進行方向へ少し進んだ点を`project()`し、画面上の差分から角度を取る(`seaSpear`が実装例)。短い弾では目立たないので既存の弾はそのままでよい。
- **`aoeShape`技の`burst`(範囲技の連射。ピクシー「ライトニング」)**: 通常の弾と違い`areaEffect`は即時生成なので、2発目以降は`pendingAoeCasts`(world.js)に「発射時刻+生成関数」を積み、`updatePendingAoeCasts()`が時刻到達で生成する。撃った本人が発射前に倒れた場合は不発になる。
- **範囲エフェクトの見た目は必ずダメージ判定と同じ半径で描く。** `updateAreaEffects`のヒット判定は`curReach`(=`fillDist`を`range`でクランプした値)を使うので、描画側も同じ値を使う。見栄えのために0.95倍などを掛けると判定と見た目がズレる。
- **`gutsDrainRatio`(技単位のガッツ削り。ピクシー「キッス」)**: 技に付けると、与えたダメージ×この割合ぶん相手のガッツも削る。伝搬は`gutsDrain`という名前で弾・AoEに載せ、`applyDamage`の`opts.gutsDrain`で適用する。**属性単位のガッツ削り(プラント0.3/アーク0.45)とは別系統**なので混同しないこと。
- **新しいダメージ源のフィールドを増やしたら、`ui.js`の技一覧(`buildMastermonMovesHtml`)の威力表示にも足すこと。** 表示は`mv.dmg`ベースなので、威力を`blast`など別フィールドに持たせると**技一覧が「威力 0」と表示されてしまう**(2026-07-25にビッグバンで発生・修正。現在は`mv.dmg + mv.blast.dmg`の合計を表示)。特徴テキストは`describeMoveFeatureText`に分岐を足す。

### 音(audio.js)
- 原則Web Audio APIで合成。iOS対策で初回タップ後に`audioInit()`でAudioContext起動。
- SE合成ヘルパー: `seTone`(オシレータ)/`seNoise`(ノイズ+フィルタ)/`seNoiseLfo`(持続ノイズ+揺らぎ)。SE定義は`SE_DEFS`オブジェクト。音作りはこの3つの組み合わせ。
- SE: `playSe(name, opts)`。**負荷対策として自分の操作モンスターに関わる音のみ鳴らす**。`SE_MIN_GAP`で連打間引き、`SE_VOL_BOOST`で技SEを一括増幅。tier3技はエフェクトスタイル→SE名の対応表`MOVE_SE_BY_STYLE`(combat.js)で個別化。技名個別指定は`move.seStyle`。
- BGM: タイトル(牧場)/試合中(残り人数で段階変化 intensity 0〜2)/残り5人以下(intensity 3=決戦)/残り2人(intensity 4=ラストバトル)/ショップ。`bgmSetTrack('title'|'battle'|'shop'|null)`/`bgmUpdateBattleIntensity(aliveCount)`(render.jsのHUD更新から呼ぶ)。ステップシーケンサ`bgmScheduler`が16分音符単位で先読みスケジュール。全ノードは`bgmTrackGain`(切替フェード用)→`bgmGain`(音量=`audioSettings.bgm`)→出力。
- **intensityを増やしたら`bgmStepDur()`のbpm配列も同じ長さに伸ばすこと。** 配列外だと`undefined`→BPMがNaNになりスケジューラが無限ループ的に進む。`|| 126`のフォールバックも入れてある。
- **トラック/intensityを追加したら管理者画面のBGM確認(`BGM_TEST_ITEMS`/`adminPlayBgm`)にも足す。** 実機で1タップ確認できるようにしておく。
- **実音源ループは「常に1曲だけ」を`updateBgmFileLoops()`が保証する。** `bgmFileLoopTarget()`が鳴らすべきループを1つ返し、それ以外は必ず`stop()`する。**トラック名は必ず明示で判定すること**(以前「title/shop以外はすべて試合中」としていたため、トレーニング画面で前の試合の`intensity`が残っていると決戦BGMが重なって鳴った)。新しいトラックを足すときは`bgmFileLoopTarget()`に1行足すだけでよく、重複の心配はいらない。
- **`bgmSetTrack('title'|'shop'|'training')`は`intensity`を0に戻す**(試合の盛り上がり段階を画面遷移後に持ち越さない)。`null`は試合中の演出でも使うので触らない。
- **リザルト後にロビー曲へ戻す遅延処理は、その間に決まった行き先を上書きしない**(`bgmDesiredTrack()!==null`なら何もしない)。

#### 実音源を使う例外(合成ではない箇所)
「全合成」が原則だが、発注者提供の実音を使う箇所がいくつかある。いずれも**外部依存を増やさない/オフラインでも壊さない**方針。
- **SSR獲得SE**(`playSsrJackpotOnce`/`startSsrJackpotLoop`): 動画音声を**内蔵mp3データURI**(`SSR_JACKPOT_DATAURL`)にして`decodeAudioData`→`AudioBuffer`再生。SSR演出中はループ、スキップで停止。短いのでインライン埋め込み。
- **長いBGM(mp3ループ)は`createBgmLoop(url)`で作る**(`bgmFinal5`=残り5人以下 / `bgmLastBattle`=残り2人 / `bgmShop`=ショップ)。返り値に`ensure()`(fetch+decodeAudioData)・`start()`/`stop()`(0.6秒フェードイン/0.4秒フェードアウト)・`setPlaying(bool)`・`buffer`/`source`を持つ。全ノードは`bgmTrackGain`経由なのでBGM音量・切替フェードがそのまま乗る。
  - どのループを鳴らすかは毎tickの`updateBgmFileLoops()`が一括判定する。**ラストバトル音源が鳴るときは決戦BGMを止める**(重複防止)。**ラストバトル音源が未ロードなら決戦BGMを鳴らし続ける**(合成に落とすより自然)。
  - 合成パートとの二重再生は`bgmFileLoopActive()`で防ぐ。**実音源が鳴っている間はスケジューラの合成ステップを一切呼ばない。** 音源未ロード/取得失敗時のみ合成にフォールバック(決戦/ラストバトル=`bgmEpicStep`、ショップ=`bgmTitleStep`)するので無音にならない。
  - 読み込みタイミング: 試合中に必要な2曲(`bgm_final5`/`bgm_lastbattle`)は`audioInit()`の`ensureBgmFileBuffers()`で先読み。**ショップ曲は画面を開いたとき(`ensureBgmShopBuffer()`)に初回ロード**する(起動時のfetchを増やさないため)。長い曲を足すときもこの使い分けにする。
  - **曲ごとの音量は`BGM_FILE_GAIN`で微調整する**(決戦BGM=1.0を基準に実測でそろえた値)。音源を再エンコードせずに数値だけで直せるようにしてある。新しい曲を足したらここにも1行足す。
  - **切替は等パワークロスフェード(`_equalPowerCurve`)で行う。** 単純な線形フェードで2曲を重ねると合計音量が一時的に1.4倍近くまで上がり、切替の瞬間だけ音が大きくなる(決戦→ラストバトルで実際に起きていた)。上げ側は`sin`、下げ側は`cos`で、**下げ側は終点基準(`to + (from-to)*cos`)で組む**(始点基準にすると逆向きに立ち上がってしまう)。
- **ゼウス(SSR)装備時のtier3専用SE**(`playZeusTier3Once`): 動画音声(約1秒)を内蔵mp3データURI(`ZEUS_TIER3_DATAURL`)で再生。`moveSeName`が`SKIN_TIER3_SE`(combat.js)経由でゼウス装備tier3のみこのSEに差し替え。未ロード時は合成`godRising`にフォールバック。
- **短い内蔵SEを増やすときは`createSeOneShot(dataUrl, gain)`を使う**(ちょこの召喚/ヴァニッシュ/被弾の3種)。`ensure()`で先読み・`play()`は未ロード/音量0ならfalseを返すので、`SE_DEFS`側で `if(!seXxx.play()) SE_DEFS.既定SE(t,o)` と書けば必ず音が出る。**`SE_DEFS`に足せば管理者画面のSE確認に自動で載る**(表示名は`SE_TEST_LABELS`に追記、連打間引きは`SE_MIN_GAP`に追記)。
- **リザルトの自己ベスト更新SE**(`playBestUpdateOnce`): 約9秒と長いので外部ファイル`best_update.mp3`を`fetch`+`decodeAudioData`し1回だけ再生(ループ無し)。全体の自己ベスト更新時に鳴らし、称号/モンスター毎ベストのSSR獲得SEより優先。未ロード時はSSR獲得SEにフォールバック。
- **実音の抽出手順**(この環境): `pip install imageio-ffmpeg`で静的ffmpegが入る(`python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"`)。Chromium(OSSビルド)は**AAC/HEVCをデコード不可・mp3は可**。動画音声はAACなので一旦ffmpegでmp3化してから埋め込む。整音は`loudnorm`。
- **ロビーBGMは「いちか(実音源)」と「オリジナル(合成)」を切り替えられる。** 選択は`lobbyBgmMode`(localStorage `aramon_lobby_bgm_v1`)で、ヘッダーの`#headerBgmBtn`が`toggleLobbyBgmMode()`を呼ぶ。表示更新は`updateLobbyBgmLabel()`(ui.js)。
- **ロビーBGMだけ再生位置を記憶する。** `createBgmLoop(url, gain, keepPos)`の第3引数で、`stop()`時に`offset`へ経過を足し、`start()`で`src.start(t, offset)`から再開する。他の曲は従来どおり頭から。
- **トレーニング画面は`bgmSetTrack('training')`。** 切替の判断は`updateMetaBgm()`(ui.js)1か所に集約してあり、`mmOpenTab()`と`#mastermonScreen`のMutationObserverから呼ぶ(タブを離れても画面を抜けてもロビー曲へ戻る)。試合中とショップ表示中は触らない。
- 別の実音を足すときの判断: 1.2秒程度までの効果音はデータURIインライン、3秒級のSEと長い曲は外部mp3+`fetch`。いずれもSWのネットワーク優先キャッシュに乗る。
- **提供音源の技SEは`move.seStyle`で指定する**(`MOVE_SE_BY_STYLE`は`aoeStyle/projStyle`単位なので、同じ見た目の技を共有している他モンスターまで巻き込んでしまう)。現在: `darkHoust`/`requiemEnd`/`mocchiBeam`/`monta`/`crystalRain`/`fireWave`。
- **「実音源のあとに合成SEをつなげる」ときは`createSeOneShot(...).play(when)`に開始時刻を渡す**(ヒノトリ`fireWave`= bard音源→`fireRoar`)。長さは`.dur()`で取れる。

## 用語(発注者の言い回し)

- 「ヒット判定を大きく」= モンスター本体ではなく**ムーブ(攻撃)のヒットボックス**の拡大を指す。
- 「安置」= 安全圏(zone)。「安置予測」= 次の縮小先の点線表示。
- 「マスモン」= メタ進行レイヤーのモンスター育成システム。

### 見切れを出さないための決まり(style.css / world.js)
- **サイズ指定に生の`vw`/`vh`/`vmax`/`vmin`を使ってはいけない。** 強制横向きでは実viewportが縦向きのままなので、`1vh`が論理画面の高さの1%より大きくなり、要素が画面より大きくなって上下が見切れる(SSR獲得演出で実際に発生)。必ず`calc(N * var(--vh))`/`var(--vw)`を使う。`--vw`/`--vh`の定義(`:root`の`1vw`/`1vh`)だけが例外。
- **幅による分岐は`html.logical-narrow`**(world.jsが論理幅520px以下で付ける)。`@media (max-width:…)`は実画面の幅に反応するため強制横向きで誤発動する。
- **画像は`height`を固定せず`max-height`+`flex:0 1 auto`にする。** 縦が足りない端末では縮んで収まる。`object-fit:contain`と併用する。
- **`.mastermon-confirm-box`は共通で`max-height:calc(94 * var(--vh))`+`overflow-y:auto`を持つ。** 個別のポップアップで指定を忘れても縦にはみ出さない。

### 強制横向き / タッチ
- 縦画面ロック端末では`#appRoot`をCSS回転させ横向き表示にする(`world.js`の`updateForceLandscapeMode`等)。ポインタ座標・移動量は`toLogicalPoint`/`toLogicalDelta`で回転補正する。
- 縦画面ロック中はネイティブスクロールが効きにくいので、`input.js`が回転補正した移動量で手動スクロールする補助を入れている。新しいスクロール要素はこの仕組みで動く(overflow:auto/scrollを付ければ拾われる)。

## 作業の進め方

- 数値バランス(倍率・係数)は発注者が実機プレイテスト後に反復調整するので、調整しやすいよう名前付き定数にまとめる。
- 変更したファイルだけをコミットする。コミットメッセージは日本語でよい。
- 動作確認はiPhone実機(PWA)で発注者が行う。デプロイ後にキャッシュバージョンが上がっていれば次回アクセス時に自動更新される。
- **PRはsquashマージ運用**。前回PRのコミットが作業ブランチに残ったまま次の作業を重ねると、mainのsquashコミットと内容が重複してPR作成時にコンフリクトする。次のPR前に `git fetch origin main && git rebase --onto origin/main <前回のブランチ先端(=squash元)> <作業ブランチ>` で既マージ分を落としてから `push --force-with-lease` する(このセッションで毎回実施している手順)。
- **プレイに関わる大きな変更時は`data.js`の`UPDATE_HISTORY`にも追記**(絶対に守るルール6)。同じコミットに含める。
- **ヘッドレスブラウザ(Playwright)での動作確認はしない。** 動作確認はiPhone実機で発注者が行う。こちら側は`node --check <file>`の構文チェックまでで、検証用スクリプトを新規に書かない。
- GitHub Actionsの`actions_list`はレスポンスが巨大でトークン超過するので、保存されたファイルを`jq -r '.workflow_runs[:N][] | [.head_sha[0:7], .status, .conclusion] | @tsv'`で読む。
- マージ後の「pages build and deployment」成功確認は、対象コミットSHAのrunが`completed/success`になっているかで判断する。

### 報告・文章のスタイル
- **返答は短く、要点だけ。** 前置き・但し書きは最小限にし、答えそのものに文字数を使う。説明を求められたときも、詳しく知りたいと言われない限り要点のまとめだけ返す。
- **作業前に「これから何をするか」を一文だけ言う。** 作業中の報告は、重要なことが分かったときと方針を変えるときだけ。
- **終わったら結論から書く。** 最初の一文で「何をしたか」「何が分かったか」に答え、細かい話はその後。
- **書き出す文書(PR説明・コミットメッセージ・ドキュメント)は必要な長さに収める。** 中身は省かなくてよいが、埋めるための章・同じ内容の繰り返しの要約・お決まりの前置きで長くしない。

<tone_preference>
出力は簡潔に。
</tone_preference>
