---
name: aramon-push-notifications
description: 荒野モン動のプッシュ通知(遠征の帰還・マルチの部屋が立った)の調査結果と実装手順。2026-08-11時点の調査で、発注者判断により**現段階では実装しない**。通知の話が出たとき・再検討するとき・「なぜ入れていないのか」を聞かれたときに読む。
---

# プッシュ通知(調査結果 / 2026-08-11)

**発注者の決定(2026-08-11): 現段階では実装しない。** この文書は再検討するときのための保管。
ここに書いてある結論は調査済みなので、**同じ調査をやり直さない。**

やりたかったこと:
1. 遠征からモンスターが帰ってきたら通知
2. 誰かのマルチの部屋が立ったら通知

## 結論

**2つとも技術的には可能。ただしゲーム本体(GitHub Pages)だけでは絶対に実現できない。**
「送る係」の外部サーバーが1つ要る。これが導入の唯一にして最大のハードル。

## 決定的な制約(ここを忘れると設計を間違える)

- **Webには「N時間後に鳴らす」ローカル通知が存在しない。** Chromeが試していた
  Notification Triggers API(`showTrigger` / `TimestampTrigger`)は開発中止になり、
  **iOSには一度も来ていない。** したがって遠征の帰還通知は
  「端末が自分で時間を測って鳴らす」ことができず、**必ずサーバーから送る**しかない。
- 部屋通知も同じで、「部屋ができた」ことを検知して送る側が要る。
  Firebase Realtime Database は**自分から外へ送れない**(Cloud Functions か外部のポーラーが要る)。

## iOS側の条件(クリアできる)

| 条件 | 状況 |
|---|---|
| iOS 16.4以降 | 問題なし(2026年時点で95%超がiOS16以降) |
| **ホーム画面に追加したPWAだけ** | 荒野モン動はすでにホーム画面追加を案内済み。**Safariのタブでは仕様上ぜったいに出ない** |
| 許可はユーザーのタップの中でだけ求められる | 設定画面にトグルを置く必要がある |
| `manifest.json`が`display:fullscreen`/`standalone` | 現状`fullscreen`なのでOK |
| iOSの全ブラウザがWebKit | Chrome/Firefoxでも同じ制約。抜け道はない |
| EU圏はDMAでPWAの扱いが変わり通知不可 | 発注者は日本なので影響なし |

補足: Safari 18.4 で Declarative Web Push(Service Worker不要の簡易版)が入ったが、
**「サーバーから送る」必要がある点は何も変わらない。**

## 送る係の選択肢

| 方法 | 費用 | 遅延 | 備考 |
|---|---|---|---|
| **Cloudflare Workers + Cron Triggers** | **無料・クレカ不要** | 最大1分 | cronは最短1分間隔、無料プランはcron 5個・CPU 10ms/req。RTDBはREST(`.json`)で読む |
| Firebase Cloud Functions | 無料枠内なら0円だが**クレカ登録が必須** | 部屋は即時(`onCreate`) | **Functionsの利用にはBlazeプランへの切替が必要**(Spark では deploy できない) |
| 常時起動のPC | 無料 | 1分 | PCを落とすと届かない。運用が人依存になるので非推奨 |

## 実装に要る作業(どの方法でも共通)

1. VAPID鍵ペアを作る。公開鍵をクライアントへ、秘密鍵を送信側だけに置く。
2. `sw.js` に `push` と `notificationclick` のハンドラを足す。
   `notificationclick` はゲームを開いて該当画面(遠征 / ロビー)まで飛ばす。
3. 設定画面に「通知を受け取る」トグル。**iOSは必ずタップの中で`Notification.requestPermission()`**。
4. 購読を `pushSubs/{accountKey}` へ保存(`{endpoint, keys:{p256dh,auth}, enabled, ...}`)。
   **Firebaseのセキュリティルールに`pushSubs`の追加が要る**(`ghosts`と同じ手順)。
5. 遠征は**帰還予定時刻(`dueAt`)も一緒に保存**する。出発・📯ホラ貝での短縮・受け取りのたびに更新。
   送信側は毎分「`dueAt <= now` かつ 未送信」を撃って `sentAt` を立てる。
6. 送信が `404` / `410` で返ったらその購読を削除する(ホーム画面から消された端末)。
   **掃除を入れないと死んだ購読が溜まり続ける。**

## 通知ごとの評価

### 遠征の帰還通知 — きれいに作れる
帰還予定時刻が確定しているので、毎分のcronで撃つだけ。誤差は最大1分。
鳴りすぎの問題もない(1回の遠征につき1通)。**入れるならこちらから。**

### 部屋が立った通知 — 落とし穴が多い
- **部屋は数分で消える。** cron方式の最大1分遅れは実用上けっこう痛い。
  即時が要るなら Cloud Functions(=クレカ登録)になる。
- **全員に飛ばすと、部屋が立つたびに全員の通知が鳴ってすぐ嫌がられる。** 最低限これが要る:
  - 受け取るON/OFFのトグル
  - 同じ人へは○分に1回まで、という上限
  - 自分が作った部屋は自分に飛ばさない
  - 深夜は送らない時間帯の設定

## 推奨(再検討するときの出発点)

**Cloudflare Workers(無料・クレカ不要)で、まず遠征の帰還通知だけ入れる。**
部屋通知は遅延と通知疲れのリスクがあるので、遠征が問題なく回ってから頻度制限つきで足す。

## 出典(2026-08-11に確認)

- iOSのPWA/プッシュの条件: <https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide>
- 2026年時点の実情: <https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye?lang=en>
- Notification Triggers API(開発終了): <https://developer.chrome.com/docs/web-platform/notification-triggers>
- Cloudflare Workers の Cron Triggers: <https://blog.cloudflare.com/introducing-cron-triggers-for-cloudflare-workers/>
- Cloud Functions が Blaze 必須である件: <https://github.com/firebase/codelab-friendlychat-web/issues/603>
