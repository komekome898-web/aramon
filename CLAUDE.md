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
6. **プレイに関わる大きな変更をしたら「更新履歴」も更新する。** `data.js` の `UPDATE_HISTORY`(トップ画面「更新履歴」ボタンで表示)に、その日の日付の項目として1行追記する。対象=**新機能の追加・既存機能の変更・バランス/仕様の調整など、プレイヤーの遊びに影響する内容**。対象外=細かい画面レイアウト・見た目・軽微なバグ修正・内部リファクタ・ドキュメントのみ。日付は降順(新しい日を上に)。文言は発注者向けに簡潔な日本語で(技術用語を避ける)。1回のPRで複数の大きな変更をした場合は複数行に分ける。

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
| `bgm_final5.mp3` / `bgm_lastbattle.mp3` / `bgm_shop.mp3` | 残り5人以下(決戦) / 残り2人(ラストバトル) / ショップのBGM実音源(発注者提供動画の音声を抽出・整音したもの)。`monsters/*.png`同様に実行時読み込みの外部アセット |

## 重要な設計知識

### 画面(スクリーン)の追加・変更時
- 各画面は `index.html` 内の `<div class="resultScreen hidden">` 等で定義し、`.hidden`(display:none !important)の付け外しで遷移する。
- **【スクロールロックの除外・必須】新しい画面/オーバーレイを追加したら、グローバルな除外リストにそのIDを必ず3か所すべて追加する:** `render.js` の `touchmove`、`input.js` の `touchend` と `dblclick`(いずれも `e.target.closest('#xxx')` の連鎖)。追加しないと画面内スクロールやタップが効かないバグになる(過去に管理者画面・ランキング画面・デイリー/シーズンで対応)。3リストは同じ内容に保つこと。
- **【ポップアップ画面の横幅・スクロール・×ボタン 定型】`.mastermon-confirm-overlay`系のポップアップ(バッグ/ショップ/デイリー/シーズン等)を新規追加するときは、以下を守れば毎回同じ手直しが不要:**
  - 幅は基底 `.mastermon-confirm-box`(`max-width:340px`)に負けるので、**複合セレクタ** `.mastermon-confirm-box.xxx-box{ ... }` で `max-width:min(760px, calc(95 * var(--vw))); width:min(760px, calc(95 * var(--vw)));` を指定(ショップ/バッグと同じ広さ)。単一クラス指定だと340pxのまま。
  - **`position:relative` を必ず付ける。** 付けないと右上の `.overlay-close-btn`(`position:absolute`)が画面全体基準になり、枠外(画面隅)に飛ぶ。
  - 縦にはみ出す前提で **`max-height:calc(94 * var(--vh)); overflow-y:auto`** を付け、枠ごとスクロールさせる(内側に別の `max-height` スクロールを重ねない)。
- プルダウンは `.custom-select` / `.custom-select-menu` の自前実装を再利用する。ポップアップが親のoverflowで切れないよう「外枠はoverflow可視・中のリストだけ独立スクロール」の構成にする。
- 横長(landscape)の低い画面が前提。新しい画面は縦幅を詰めてスクロールなしで収まるようにする。

### モンスター選択(トップ画面の分岐 → モンスター一覧カルーセル)
- 導線は「トップ画面の`モンスター選択`(`.selector-card`が2枚: マスモン / モンスター一覧) → それぞれの画面」。分岐カードは`renderSelectorCards()`が中身を書き、CSSでアイコン左・テキスト右・右端`::after`の`›`という横並びにしている(縦積みだと日本語が折り返して崩れる)。
- `#monsterListScreen`のカルーセルは**位置を全部JSがtransformで書く方式**。`mlState.pos`(小数。整数のときそのカードが中央)を唯一の状態とし、`renderMonsterCarousel()`が全カードに`translate3d/rotateY/scale`と`filter:brightness`を設定する。**`.ml-card`にtransitionを付けてはいけない**(ドラッグ追従が鈍る)。滑らかな吸着は`mlStartAnim()`のrAFで`pos`を`target`へ寄せて実現している。
- **無限ループは「環状の最短距離」`mlRingDelta(i, pos)`で成立している。** `pos`は正規化せず単調な小数のまま持ち、各カードの相対位置だけを`-n/2〜n/2`に畳む。これで先頭の左に末尾が並び、末尾の右に先頭が並ぶ。`pos`を0〜nに丸めようとすると境界でカードが飛ぶ。
- 見た目の定数は先頭にまとめてある(`ML_CENTER_SCALE`=1.2 / `ML_SIDE_BRIGHTNESS`=0.55 / `ML_VISIBLE_SIDE`=2 / `ML_SNAP_RATE` / `ML_FLICK_THRESHOLD`)。**カード間隔は CSS の `#mlStage{--ml-step}` が正**で、JSは`getComputedStyle`で読む(2か所に数字を書かないため)。
- **「少しだけ見切れる」のは`#mlStage`の幅を`calc(var(--ml-step) * 4.4)`にして`overflow:hidden`しているから。** 画面幅基準にすると広い画面で5枚とも収まってしまい、スワイプできることが伝わらなくなる。`--ml-step`を変えたらこの倍率も見直す。
- **1回のスワイプで2枚飛ばないようにしてある**: 離した時点の最寄りへ吸着し、フリック加算は「ドラッグだけではカードが変わらなかったとき」だけ効く(`target === Math.round(dragStartPos)`の判定)。
- **ドラッグ直後のclickは`mlState.suppressClick`で1回だけ無視する。** `dragMoved`を見たままにすると次のタップまで無視され続ける(詳細が開かなくなる)。
- **強制横向き(端末が縦画面ロック)対応は2か所**: ドラッグ量は`toLogicalDelta()`で回転補正する / 詳細を開くFLIP演出は`getBoundingClientRect()`が実画面基準なので`isForcedLandscape()`で幅と高さを入れ替え、中心座標は`toLogicalPoint()`で論理座標に直してから差分を出す。どちらも入れないと縦画面ロック端末で「横スワイプが効かない」「カードが変な方向から飛んでくる」になる。
- 詳細ビューは一覧のカードDOMを`cloneNode`して左カラムに置き、右カラムに情報を出す。技一覧は**マスモン画面の`buildMastermonMovesHtml(key)`をそのまま流用**(スキンでtier3が変わる解決もそちらに入っているため)。左右の`.ml-card`のスタイルは共通で、詳細側は`#mlDetailCardSlot .ml-card`で中央寄せを解除して枠いっぱいに広げている。
- 画面を閉じるときは`closeMonsterListScreen()`で**必ずrAFを止める**(`mlState.raf`)。

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
- **有効化はレジストリ `WALK_ANIM`(data.js)に登録するだけ。** 要素キーごとに `{ base:{front:_loadWalk('x_walk_f'), back:_loadWalk('x_walk_b')}, ssr?:{skinId, front, back} }`。現在対応: モッチー(+ラガモッチーSSR)/ガリ(+ゼウスSSR)/スエゾー/ザン/キュービ(+タマモノマエSSR)/ライガー/ヒノトリ(+フェニックスSSR)/アーク(+イブリースSSR)/ウンディーネ/ドラゴン/プラント/ゴーレム/イルミネ/ワーム/ピクシー(+ちょこSSR)。**全15エレメント対応完了。**
- 描画の入口は `getDisplayImage(entity)`。先頭で `entityWalkFrameImage(entity)` を呼び、歩行コマがあればそれを返す(なければ従来の静止画にフォールバック)。`drawMonster`/`drawMonsterPortrait` がこれを描く。
- コマ選択(`entityWalkFrameImage`): `matchTime`でコマ送り、平滑化速度`_mwSpeed`が`WALK_MOVE_EPS`超で「歩行中」。進行方向とカメラ`camState.yaw`の内積で正面/後ろを切替(カメラ奥向き=後ろ姿)。停止中は静止(自分=後ろ姿/他=正面)。素体は色スキン装備時に`recolorToCanvas`で各コマ再着色し`_walkRecolor`にキャッシュ。**歩行コマ未提供のSSRスキン装備時は`null`を返し従来の静止スキン画像を表示**(ガード有り。現在対応済みSSRはラガモッチー/ゼウス/タマモノマエ/フェニックス/イブリースの5種で、これ以外の新規SSRを追加した際に歩行コマを用意しなければこのガードが働く)。
- **スプライト生成は `tools/build_walk.py`(開発用)。** 動画→60fps抽出→自己相関で1周期検出→8コマ抽出→モンスター別セグメンテーション→320px・256色透過PNGに統一(足を94%基準・中央寄せ)。背景/被写体別モード:
  - 白背景(キュービ等) = `white_alpha`: 隅から連結する白のみ透過(内側の白い毛は残す)。
  - 淡い草/金背景 = `grabcut_alpha`(`single`/`gentle`/`hard`/`hardgentle`): grabCut切り抜き。`gentle`はopen省略で細い足を守る(スエゾーの一本足)、`hard`は縁を確定背景にしたマスク初期化(金色ボケ背景)。
  - 鳥(ヒノトリ/フェニックス。炎・羽が背景色に近い) = `phoenixcut_alpha`: 彩度/明度/背景色距離で本体抽出。**かぎ爪の足(暗色)を明示追加し中央下部限定の縦closeで本体に接続**(largestで足が消えるのを防ぐ)、足元の淡い地面/オーラを色で除去、トサカを上端中央で復元。正面は脚間を残すため小穴のみ塗り、後ろは尾を塗りつぶして密度確保。パラメータは`_PHX`(satT/distT/fill/warm_trim)で正面・後ろ別。
- **【検証必須・過去に鳥系で何度も手戻り】新しい歩行スプライトは、全16コマ(正面8+後ろ8)を1コマずつ目視し「トサカ等の突起」「足」が欠けないこと・足元の背景/地面が透過していることを確認してから採用する。** `tools/build_walk.py`の隣に置く判定(bboxの上端中央=トサカ、下端中央=足に画素があるか)で全コマ自動チェックしつつ、必ず目視も行う。ヘッドレスでも`getDisplayImage`→`drawMonster`で実描画確認する。
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
- **tier3技のオーラ/エフェクト色はSSRスキンもSR色スキンも変える。** 判定は`skinTier3Aura(skinId)`1か所に集約(SSR=`SSR_SKIN_AURA`の固定色 / SR=`element:colorId`のcolorId)。`getMoveAura`/`getMoveEffectColor`がこれを見るので、**エフェクト色の伝搬(combat.jsとnetwork.jsの`effColor`/`auraTint`)は触らなくてよい**。
- **SSRだけの特典は「tier3の技名と威力」**(`SSR_SKIN_TIER3`/`getMoveName`/`ssrTier3DmgMult`)。SRはオーラ・エフェクトのみでここは変えない。新しいスキン種別を足すときもこの線引きを守る。
- **`SSR_SKIN_TIER3`は2通りの書き方ができる。** `dmgMult`=元の技の威力に倍率を掛けるだけ(従来型)。`move:{...}`=元の技のフィールドを直接上書きし、性能ごと変える専用技にする(ちょこの「ヴァニッシュ」)。`blast`は中身をマージするので変えたいキーだけ書けばよい。**`move`側に`dmg`を書くときは`dmgMult`を併記しない**(`ssrTier3DmgMult`が別途掛かって二重適用になる)。
- **専用技の解決は`skinTier3Move(move, attacker)`。** 解決結果はスキンID+技名でキャッシュする(元の`SIGNATURE_MOVES`は書き換えない)。**呼ぶ場所は4か所で、増やしたら全部に通すこと**: `combat.js`の`fireMove`先頭 / `network.js`のゲスト発射(`tryNonHostPlayerFireVisual`) / `render.js`のHUD技フィールド / `ui.js`の技一覧(`buildMastermonMovesHtml`)。fireMove先頭で解決すれば威力・弾速・射程・爆風・消費ガッツ・SEはすべて解決後の値で流れる。
- **「本体色は元のまま、差し色だけオーラ色にしたい」技は`keepBaseColor:true`。** `getMoveEffectColor`が本体色を返し、差し色は`getMoveAuraTint`が別に返す(ちょこ=球体とドームは黒のまま、ビリビリ電撃だけ赤)。ビリビリの2色は`render.js`の`arcColorsFor(tint)`に集約してあり、弾(`voidOrb`)とドーム(`drawDomeBurstEffect`)の両方が使う。**`spawnGroundBlast`には弾の`auraTint`を渡すこと**(渡さないとドームだけ既定色に戻る)。
- **スキン別のSE差し替えは3つの対応表で行う**(combat.js): `SKIN_TIER3_SE`(tier3発射) / `SKIN_SUMMON_SE`(召喚演出) / `SKIN_HIT_SE`(被弾)。いずれも`playSe(skinXxxSeName(entity) || '既定SE')`の形で呼ぶので、未定義スキンは自動で既定SEになる。
- **スキンプレビュー(`showSkinPreview`)は歩行モーションを再生する。** `skinWalkFrameDataUrls(skinId, view)`(render.js)が歩行8コマをdataURL配列で返し(色スキンは`recolorToCanvas`で再着色・`_skinDataUrlCache`にキャッシュ)、ui.jsの`startSkinPreviewAnim`が`WALK_FRAME_DUR`間隔で正面/後ろの`<img>.src`を差し替える。**歩行コマ未用意/未ロードならnullを返し静止画のまま**(画像ロード待ちの可能性があるので0.35秒×最大6回リトライする)。オーバーレイを閉じたら必ず`stopSkinPreviewAnim()`でタイマーを止める。

### 長押しでの選択・メニュー抑止(style.css / input.js)
- CSSとJSの二段構えで全画面に効かせている。**新しい画面を足しても個別対応は不要。**
  - style.css の `*` に `-webkit-user-select:none; user-select:none; -webkit-touch-callout:none;`(callout無しだとiOSで長押し時に「コピー/調べる/画像を保存」が出る)。**直後の `input, textarea{ user-select:text }` で入力欄だけ選択可能に戻しているので、この2行はセットで維持する。**
  - input.js の `contextmenu`/`selectstart` を`preventDefault`(`isTextEntry()`で入力欄は除外)。
  - **`-webkit-touch-callout`はiOS Safari専用で、ChromiumはCSSOMからも落とすためヘッドレスでは計算値を検証できない。** style.cssのテキストを直接確認するしかない(実機では効く)。

### 更新履歴の未読バッジ(ui.js)
- `changelogSignature()` = `最新日付#全項目数`。これを`localStorage`の`aramon_changelog_seen_v1`と比較して未読判定(`changelogHasUnread`)し、`#changelogNewPop`の`new`バッジを出す(`updateChangelogBadge`)。ボタンを開いた時点で`markChangelogSeen()`が既読化する。
- 項目数を含めているので**同じ日付に項目を足しただけでも再び未読になる**。`UPDATE_HISTORY`に追記すれば自動でバッジが出るので、バッジ側の作業は不要。
- 端末ごとの既読状態なのでアカウント同期(`ACCOUNT_SYNC_KEYS`/`accountMarkDirty`)には**入れない**。

### 技のギミック(combat.js / render.js / ui.js)
- **`blast`(着弾ドームAoE。ピクシー「ビッグバン」)**: 弾に`blast:{radius,dmg,color,expandTime,(telegraphTime),(style),(se)}`を付けると、命中/最大射程到達の地点で`spawnGroundBlast()`が`kind:'circle'`の`areaEffect`を発生させ、円が広がりながらダメージ判定する。**弾の直撃ダメージ(`mv.dmg`)と爆風ダメージ(`mv.blast.dmg`)は別々に入る**(両方当たれば合計)。描画は`drawDomeBurstEffect`。
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
- 別の実音を足すときの判断: 短い効果音はデータURIインライン、長い曲は外部mp3+`fetch`。いずれもSWのネットワーク優先キャッシュに乗る。

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
- **PRはsquashマージ運用**。前回PRのコミットが作業ブランチに残ったまま次の作業を重ねると、mainのsquashコミットと内容が重複してPR作成時にコンフリクトする。次のPR前に `git fetch origin main && git rebase --onto origin/main <前回のブランチ先端(=squash元)> <作業ブランチ>` で既マージ分を落としてから `push --force-with-lease` する(このセッションで毎回実施している手順)。
- **プレイに関わる大きな変更時は`data.js`の`UPDATE_HISTORY`にも追記**(絶対に守るルール6)。同じコミットに含める。

### ヘッドレスでの動作確認(重要)
- 発注者は実機だが、こちら側でもコミット前に**Playwright(ヘッドレスChromium)で必ず検証する**。UIロジック・ゲーム状態・レイアウト・SE発音の有無まで確認できる。
  - Playwright: `/opt/node22/lib/node_modules/playwright/index.mjs`、chromium: `/opt/pw-browsers/chromium`。ローカルにhttpサーバを立て`page.goto`。
  - **PWAのService Workerが初回インストール後に1度ページを自動リロードする**ため、`waitForFunction`は失敗しやすい。`for`ループで `waitForTimeout(500)`+`try{ evaluate(()=> typeof 関数==='function') }catch` をリトライする方式を使う(既存の`scratchpad/*.mjs`が手本)。
  - localStorageのseedは`addInitScript`で(例: `aramon_mastermons_v1`, `aramon_bag_v1`, `aramon_wallet_v1`, `aramon_account_v1`)。Firebaseは`window.__aramon*`をスタブで差し替えて検証できる。
  - `js/check`: `node --check <file>` で構文チェック。
  - **戦闘ロジックの検証は、UI操作を再現せず直接関数を叩くのが速い。** `entities/projectiles/areaEffects/pendingAoeCasts`を空にして`createMonster(element, isPlayer, name, {spawnPoint})`で2体生成→`fireMove(攻撃側, 標的, SIGNATURE_MOVES[key][tier-1])`→`matchTime`を進めながら`updateProjectiles(dt)`/`updateAreaEffects(dt)`を回し、標的の`hp`推移で威力を数値確認する(手打ちのentityオブジェクトでは`recentAttackers`等の初期化漏れで落ちるので必ず`createMonster`を使う)。
  - **見た目の確認は`startGame()`で実戦を起動してスクリーンショットを撮る。** `game.selectedElement`/`game.activeMapKey`/`game.selectedMap`をセットして`startGame()`→相手の座標を動かして狙った状況を作る→`fireMove`→`waitForTimeout`後に`page.screenshot`。障害物との重なりを見たいときは`rocks[0]`の座標・半径を書き換えて着弾点の近くに置く。
  - **エフェクトの幾何は目視だけでなく数値でも検証できる。** 例: `groundCirclePoints()`が返す点群の外接矩形から扁平率(縦÷横)を出し、地面に貼り付いているか(≈0.165)を確認する。目視しづらいズレを確実に捉えられる。
- GitHub Actionsの`actions_list`はレスポンスが巨大でトークン超過するので、保存されたファイルを`jq -r '.workflow_runs[:N][] | [.head_sha[0:7], .status, .conclusion] | @tsv'`で読む。
- マージ後の「pages build and deployment」成功確認は、対象コミットSHAのrunが`completed/success`になっているかで判断する。
