---
name: aramon-multiplayer
description: 荒野モン動のマルチプレイ同期(network.js・ホスト権威型)。ゲスト側で演出が出ない/遅れる、位置のラバーバンド、フリーズ、観戦、Firebase同期を触るときに読む。
---

# マルチプレイ(network.js)

ホスト権威型。ワールド生成はシード付き乱数でホスト/ゲストが同一結果を得る。**ソロ用とシード付きの生成関数は対になっているので、変更するときは必ず両方直す**(例 `spawnLoot`/`seededSpawnLoot`)。

## ゲストに「起きない・遅れる」を作らない

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

## 位置・動き(ラバーバンド対策)

- **補正のしきい値は移動速度に比例させる(`selfCorrectSpeedScale`)。** 固定距離だと速いほど通常の前進でも引き戻される。基準は`entityMoveSpeed(ent)`。
- **マルチだけ移動速度と弾速を落とす**(`MULTI_MOVE_SPEED_MULT`/`MULTI_PROJ_SPEED_MULT`)。掛ける場所は`resolveMovement`の`effSpeed`と`effectiveProjSpeed`の各1か所だけなのでホスト/ゲストが自動一致する。**ダッシュ速度は`slowedSpeed`基準のままにして飛距離を変えない。**
- **自分の位置は「同じ入力時点どうし」で突き合わせる。** 入力に`seq`を付け、ホストが`aseq`を返す。ゲストは`selfPredHistory`と比較し、`SELF_CORRECT_DEADZONE`超のぶんを`selfCorrX/Y`に溜めて少しずつ消費する。**現在位置とホストの遅れた位置を直接比べてはいけない**(遅延がそのまま誤差になり、低速地形では操作不能になった)。
- **ダッシュは回数(`dashSeq`)を入力に載せてホストに再現させる**(フラグではなく回数にすると二重発動も取りこぼしも防げる)。開始処理は`startEntityDash()`に集約。**自分のダッシュのクールタイムはauthStateで上書きしない**(遅れた0が届いて連続ダッシュできる)。**ダッシュ中と直後は許容を広げる(`SELF_CORRECT_DEADZONE_DASH`)。**
- **移動に影響する状態異常は必ず同期する**(残り秒数で)。
- **他エンティティの補間はホストの試合時刻(`payload.t`)を時間軸にする。** 到着時刻基準だとジッタで速い相手が瞬間移動する。変換は`hostClockOffset`。
- 試合開始時に`guestSnapBuf`/`hostClockOffset`/`selfPredHistory`/`selfCorrX/Y`/`selfInputSeq`をリセットする。

## フリーズ対策

- **`loop()`の中身は必ずtry/catchで囲む。** 例外を投げるとRAFが再登録されず描画も入力も完全に止まる(復帰不能)。捕まえてもRAFは継続する。
- **`beginMultiplayerMatch()`は外枠のtry/catchでフラグを必ず戻す**(`matchBeginning`が立ったままだと以後試合を開始できない)。失敗時はトップ画面へ帰し部屋も離脱。
- **ゲストの自分の座標は`sanitizeSelfPosition()`で毎フレーム点検**(一度NaNが入ると以後描画も操作もできない)。

## 観戦(ホスト敗退後)

`spectateCandidates()`は**自分以外の生存者全員**(人間を先、botを後)。人間だけにすると残り1人のとき「次のプレイヤー」が効かない。終了判定(`checkWin`の`humanAlive`)は別なので影響しない。

## レイド(4人同時)

- **部屋は`mode`で分ける**(`lobby`と`rooms/{id}/meta`の`mode`。`'br'`=バトルロイヤル / `'raid'`)。旧クライアントの部屋は`mode`が無いので`'br'`とみなす。**`netState.raid`は必ず部屋の`mode`と一致させる**(ずれるとホストとゲストで別の試合を組み立ててしまう)。
- **試合の組み立ての分岐は`beginMultiplayerMatchInner`の`game.raid`1か所**。マップ・ワールドの広さ・安置・ボスの生成・アイテムの撒き方だけが変わる。シード共有・world同期・マスモン補正・スキンは通常のマルチと同じものがそのまま効く。
- **ボスもシード付き生成の一部として同じidで両側に作る。** 位置とHPはauthStateでそのまま同期されるので、ボス専用の同期は要らない。
- **ゲストへ足りないのは演出**: ①予告(`raidTele`イベント。表示専用で、予告時間が過ぎたらsetTimeoutで消す) ②発動した範囲攻撃(`shotEvent`の`type:'aoe'`。見た目専用) の2つ。**当たり判定はホストのまま。**
- **貢献度(`raidDamage`)はauthStateの`rd`で配る。** ゲストは自分ではダメージを数えないので、これが唯一の正。
- **決着はホストだけが確定させ`raidEnd`イベントで配る**(`checkRaidEnd`がゲストで早期returnする)。確定の直前にauthStateを即配信して、貢献度を取りこぼさないようにしている。
- **試合を始めるときは必ず`raidResetState()`を通す**(`startGame`/`raidStart`/`startShootingRange`/`raidExit`/`beginMultiplayerMatchInner`)。落とし忘れると、レイドの後の通常戦で居ないボスを指したままボスAI・レイド安置・終了判定が走り続ける。**モードをまたぐ状態は「入口で必ず消す」**。

## マスモン育成値の共有

**マルチでは育成ステータスを部屋の参加者情報で共有する。** `currentMastermonInfo()`が`{level,stats}`を返し`rooms/{id}/players/{pid}.mm`へ書く。**片側だけで掛けるとHPと移動速度が食い違い、ゲストの位置補正が暴れる。** 入室経路は3つ(`__aramonCreateRoom`/`__aramonJoinRoom`/`__aramonFindOrCreateRoom`)あり載せ忘れやすいので、書き込み4か所は必ず`mmEntryFields(mmInfo)`をスプレッドする。同期していないのは`speed`と各`mastermon*Mult`(maxHpはauthStateで上書きされる)。

**撃破EXPボーナスはbot・人間の区別なく与える。** ホストが`killEntity`で積み`hostForceFullNext=true`で最短配信、ゲストも`kill`イベント受信時に自前で積む(最後のキルで試合が終わると間に合わないため)。反映は`Math.max`(遅れて届いた古い値で減らさない)。

## Firebase・アカウント

- Realtime Database。パス: `scores` / `matchLogs` / `lobby` / `rooms` / `accounts`。
- **新しいDBパスを追加したらFirebaseコンソールのセキュリティルールにも`.read`/`.write`が要る**(未定義パスはデフォルト拒否)。**発注者が手作業で貼るので、貼り付け用のJSONをそのまま渡す。**
- ログインは名前+4桁パスコードで`accounts/{nameKey}`。認証情報は`aramon_account_v1`に保存し自動ログイン。**端末に認証情報がある時点で即ログイン扱いにし、通信失敗でもログイン状態を維持する。**
- サーバー同期は`ACCOUNT_SYNC_KEYS`を`accountMarkDirty()`→3秒デバウンスで送信。ログイン時は`updatedAt`で新しい方を採用。**localStorageのsave関数に`accountMarkDirty()`を足し忘れない。**
