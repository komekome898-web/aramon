---
name: aramon-layout
description: 荒野モン動のCSS・レイアウト・タッチ操作の共通規則。style.cssを触る / 新しい画面・オーバーレイ・ポップアップを足す / スクロールやタップが効かない / 強制横向き(縦画面ロック端末)の座標がずれる / 文字入力欄を足すときに読む。
---

# レイアウト・タッチ共通規則

## 禁止事項

- **レイアウトに`@media`を使わない。** 強制横向きでは実viewportが縦のままなので基準が食い違う(詳細2列が1列に落ちる不具合が実際に出た)。幅で分岐したいときは`html.narrow-screen`(world.jsが実画面幅520px以下で付与)。
- **生の`vw`/`vh`を使わない。** サイズは`calc(N * var(--vh))` / `var(--vw)`で書く。生の`vh`は強制横向きで大きくなり上下が見切れる。`:root`の`--vw/--vh`定義だけが例外。

## 持ち方で文字サイズを変えない

同じ画面が縦持ちと横持ちで違う大きさに見えるのは不具合。**小さい方(=CSSで指定した値)に合わせる。**
原因は2つしかない。

1. **iOSの文字自動拡大。** 既定の`text-size-adjust:auto`だと、iOSは「実viewportより横に広い
   ブロックの文字」を勝手に大きくする。強制横向きでは`#appRoot`が実viewport(375px)より広い
   667pxなので、縦持ちのときだけ説明文が膨らんで行が増え、見切れる。
   → style.cssの`*`に`-webkit-text-size-adjust:100%; text-size-adjust:100%`で全画面停止済み。
   **個々のクラスに書き足さない。この1行を消さない。**
2. **`html.narrow-screen`で`font-size`を分けている。** narrow-screenは**実画面の幅**で付くので、
   同じ端末でも縦持ちだけONになる。**このクラスで変えてよいのは配分や余白などのレイアウトだけ。**

確認: `node tools/measure_layout.mjs <断片HTML> --orient` が横持ち/縦持ちの文字サイズを
突き合わせて差を出す(iOSの自動拡大自体はChromiumで再現できないので、①は`*`の指定の有無で見る)。

## 基本

- 横長・低い画面が前提。新画面はスクロールなしで収まる縦幅にする。
- 画像は`height`固定でなく`max-height` + `flex:0 1 auto` + `object-fit:contain`(縦の狭い端末で縮んで収まる)。
- プルダウンは`.custom-select`の自前実装を再利用。外枠はoverflow可視・中のリストだけ独立スクロール。
- 高さの共通値は変数(例 `--top-header-h`)。**数値を直書きしない。**
- 長押しの選択/メニュー抑止は全画面共通で入っている(個別対応不要): style.cssの`*`に`user-select:none` + `-webkit-touch-callout:none`、直後の`input,textarea{user-select:text}`とセットで維持。input.jsが`contextmenu`/`selectstart`を`preventDefault`(入力欄は除外)。`-webkit-touch-callout`は計算値に出ないのでCSSテキストで確認する。

## スクロール量を減らす(「スクロールが多い」と言われたとき)

**まず測る。** `node tools/measure_layout.mjs <断片HTML> --box <枠のセレクタ>` が、
画面数・**高さの内訳(大きい順)**・見切れ・横はみ出しを出す(`--orient`で文字サイズの
持ち方差も見る)。断片HTMLはマークアップだけでよい
(style.cssはツールが当てる)。どこが場所を食っているか分かってから直す。前後で同じ測り方をして
「◯画面ぶん→◯画面ぶん」で報告する。

効く順:

1. **横一列(`display:flex`)のカードは、いちばん背の高い1枚に全部が引き伸ばされる。**
   画像を1枚だけ持つカードがあると全カードがその高さになる(シーズンパスで121px→89px)
2. **縦長でない絵は横に何か並べる。** 絵は`max-height`で抑え、枠を`width:fit-content`にすると
   縦横比を変えずに全体が見えたまま小さくなる。空いた横に説明を置く(レイド画面で1画面ぶん節約)
3. **同じ粒度の枠は2列にする。** `grid-template-columns:1fr 1fr` + 中身に`min-width:0`。
   幅が半分になるので文字サイズと余白も一緒に詰め、長い文言は`overflow-wrap:anywhere`で折り返す
4. **情報が何も無い行は出さない**(開始前だけの週など)。**情報そのものは減らさない**
5. 枠を画面いっぱいに: `.xxx-box{ padding:8px 10px; width/max-height:calc(99 * var(--vh|--vw)) }`
   \+ `#xxxOverlay{ padding:0 }`。**閉じるボタン(右上37px)に重ならないよう見出しに`padding-right:44px`**

## スクロールロック除外(必須)

新しい画面/オーバーレイを足したらIDを**3か所すべて**に追加する:
`render.js`の`touchmove` / `input.js`の`touchend` / `input.js`の`dblclick`。
漏れるとスクロールもタップも効かない(管理者・ランキング・観戦バー・文字入力で実際に踏んだ)。3リストは同じ内容に保つ。

## タップの手応え(押した場所を見せる)

2つセットで担当が分かれている。**どちらもレイアウトを動かさない**(`transform`と`opacity`だけ)。

- **ボタンの押し込み**: `button:active{ transform:scale(0.96) }`(style.css末尾)。低い詳細度なので、独自の`:active`を持つボタン(`#mlEntryBtn`など)はそちらが勝つ。
- **波紋**: `input.js`の`spawnTapRipple()`が`pointerdown`(capture・passive)で`.tap-ripple`を1枚出し、0.45秒で自分を消す。
  - **`#appRoot`は縦持ちで90度回転しているので、波紋は回転の外(`document.body`直下)に置き、`clientX/clientY`をそのまま使う。** 中に入れると持ち方で指の位置とズレる。
  - **`#hud`内と`#gameCanvas`では出さない。** 試合中は指が出しっぱなしになり、ジョイスティック/FIRE/視点操作の邪魔になる。
  - `pointer-events:none`+自分で消えるので、**スクロールロック除外リストへの追加は不要**(`#perfOverlay`と同じ扱い)。

## ポップアップ(`.mastermon-confirm-overlay`系)の定型

- 幅は複合セレクタ `.mastermon-confirm-box.xxx-box{ max-width:min(760px, calc(95 * var(--vw))); width:同 }`(単一クラスだと基底の340pxに負ける)
- `position:relative`必須(無いと`.overlay-close-btn`が画面隅へ飛ぶ)
- `max-height:calc(94 * var(--vh)); overflow-y:auto`(基底にもあるが明示推奨。内側に別のスクロールを重ねない)

## 文字入力(共通ポップアップ `#textInputOverlay`)

すべての文字入力はこれを通す。iOSのキーボードは実画面下=強制横向きではアプリ右側を覆うため、どこに置いても隠れうる。**アプリ全体をずらす方式は実機で破綻したので使わない**(2026-07-27に試して差し戻し)。

仕組み: `focusin`(capture)で元の`<input>`を`readOnly`+`blur()`し、ポップアップの欄に`focus()`(**タップと同じターンで呼ぶ**)。確定時に値を書き戻して`input`/`change`を発火。document委譲なので新しい入力欄への個別対応は不要。見出しは`data-kb-title`→直前要素のテキスト(20文字以内)→`placeholder`。位置は通常上端中央/強制横向き時は左寄せ。

## 強制横向き / タッチ

- 縦画面ロック端末では`#appRoot`をCSS回転(`world.js`の`updateForceLandscapeMode`)。座標・移動量は`toLogicalPoint`/`toLogicalDelta`で補正。
- **向きの判定は`matchMedia('(orientation: portrait)')`。** 実測pxは起動直後に確定しないことがあり、それで一度だけ判定すると縦持ち起動時に効かないまま固定される。`getRealViewportSize()`は`visualViewport`→`innerWidth/Height`→`clientWidth/Height`の順にフォールバック。
- **起動直後は`resize()`を何度も呼び直す**(`DOMContentLoaded`/`load`/`pageshow` + 50〜2000msのタイマー + mqのchange)。iOSは`orientationchange`を取りこぼす。キャンバス処理はtry/catchで囲み、失敗しても向き判定は済ませる。
- 縦画面ロック中はネイティブスクロールが効きにくいので、input.jsが回転補正した移動量で手動スクロールする(`overflow:auto/scroll`を付ければ拾われる)。
