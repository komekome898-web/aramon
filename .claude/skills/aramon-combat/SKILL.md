---
name: aramon-combat
description: 荒野モン動の戦闘ロジック(combat.js)・技のギミック(blast/burst/aoeShape/ガッツ削り)・安全圏・マスモン(メタ進行)・通貨/バッグ/ガチャ/ショップ。技を足す・調整するときに読む。
---

# 戦闘・技のギミック(combat.js)

- **`blast`(着弾ドームAoE)**: 弾に`blast:{radius,dmg,color,expandTime,(telegraphTime),(style),(se)}`を付けると着弾点で`spawnGroundBlast()`が`kind:'circle'`のareaEffectを出す。**直撃`mv.dmg`と爆風`mv.blast.dmg`は別々に入る。**
- **`endBlast`(扇/帯の技の先端に出す仕上げドーム)**: `aoeShape`技に`endBlast:{count,radius,dmg,expandTime,color,(se)}`を付けると、扇/帯が届いた先端(`ae.range`)に半分ずつ重ねてN個横並びに`spawnGroundBlast()`する(`updateAreaEffects`が`curReach>=ae.range`になった瞬間に1回だけ`spawnAoeEndBlast()`を呼ぶ)。**`ae.range`は`raycastObstacleDistance`で遮蔽物に応じて既に短くなっているので、技が途中で遮られてもその位置で爆発する**(追加のコードは不要)。SSR tier3の威力アップ(`dmgMult`)は本体と同じ比率で`endBlast.dmg`にも掛かる(`fireMove`の`endBlastDmgMult`)。新しいダメージ源なので`describeMoveFeatureText`/`buildMastermonMovesHtml`の威力表示にも追加済み。
- **`burstSpread`(連射の広がり。既定0.05rad)を読む場所は4か所**: combat.jsの`aoeShape`分岐と通常弾、network.jsのゲスト見た目の同2か所。
- **長い弾(槍)は`travelAngle - camState.yaw`で回さない**(カメラ奥へ撃つと横倒しに見える)。進行方向へ進んだ点を`project()`し画面上の差分から角度を取る(`seaSpear`が実装例)。
- **`aoeShape`技の`burst`**は即時生成なので2発目以降を`pendingAoeCasts`に積み`updatePendingAoeCasts()`で生成する。
- **範囲エフェクトの描画半径は判定と同じ`curReach`にする**(見栄えで0.95倍などを掛けない)。
- **`gutsDrainRatio`**(技単位のガッツ削り)は`gutsDrain`として弾・AoEに載せ`applyDamage`の`opts`で適用。属性単位のガッツ削り(プラント/アーク)とは別系統。
- **新しいダメージ源のフィールドを増やしたら`buildMastermonMovesHtml`の威力表示にも足す**(`mv.dmg`ベースなので「威力0」表示になる)。特徴テキストは`describeMoveFeatureText`。

# トレーニングカード(試合中の強化)

- **効果の正は`TRAINING_MENU`(data.js)1つ。** 試合中にトレーニングアイテムを拾うと、そこから3つ出て1つ選ぶ。ロビーの育成とまったく同じ言葉・同じ増減が効く。**同じ意味の表を2つ持たない**(以前は`TRAINING_ITEMS`側にベタ書きの固定効果があった)。
- `TRAINING_ITEMS[].menu` が「必ず候補に入る1枚」。抽選は`pickTrainCardKeys(itemType)`、増減は`trainCardChanges(mm, key)`。**強さの調整は`MATCH_TRAIN_CARD_MULT`1か所**(既定6=18pt→108pt相当)。
- **効かせ方は`applyTrainCardToEntity(ent, key)`1か所**(自分・bot・マルチの相手で共通)。中で`ent.matchMm`(試合中の仮マスモン)のステータスを動かし、`refreshMatchMmEffects()`が倍率を引き直す。
- **`ent.matchMm`は保存データの複製**(`cloneMatchMm`)。そのまま持つと試合中の強化が育成データに焼き付く。
- **HPと移動速度は差分だけ動かす。** 丸ごと入れ直すと回復アイテムのHP上限アップや修行チケットの加算が消える(`mmRawMaxHp`/`mmMaxHpBase`が基準)。
- マスモンを連れていない人・素のbotには`ensureMatchMm()`が種族の初期値で仮マスモンを作る。**この関数は今の数値を1つも変えない**(基準を控えるだけ)。
- **出現率(`LOOT_MIX_NORMAL`)は変えない。** 他のアイテムより明らかにレアだから探す楽しさがある、という発注者の判断(2026-08-10)。**1枚の効き目を大きくする方向で調整する。**
- 画面と同期の決まりは aramon-screens / aramon-multiplayer。

# 安全圏

`ZONE_PHASES`でフェーズ定義。安定フェーズ開始時に`prepareNextZoneTarget()`が次の縮小先を決め、`toCenter/toRadius`を予測点線で表示。マルチではホストのzoneState(toCenter含む)を同期する。

# マスモン(メタ進行)

- localStorage永続化(`loadMastermons`/`saveMastermons`)。6ステータスの戦闘反映は`mastermonStatFactor(v,statKey)`(`MASTERMON_STAT_FACTOR_DIVISOR`が小さいほど効きが強い)。EXPは`awardMastermonExp`(`MASTERMON_EXP_GLOBAL_MULT`×`xpMult`)。
- **適用は「エンティティ生成 → `applyMastermonStatsToEntity(ent, mm)`」の1本道**(ソロ=`startGame()`、マルチ=`beginMultiplayerMatchInner()`の人間ループ)。
- マルチでの育成値の共有は aramon-multiplayer を参照。
- **技強化チケット(`nextMoveBoost`)はソロ専用**(マルチは`moveTierUnlocked`がホスト権威で、authStateは上げる方向にしか反映しないため)。

# 転生(Lv100で1からやり直して強くなる不可逆システム)

- マスモンに増えるのは `mm.rebirth`(転生回数)と `mm.apt`(固有の適正表)の2つだけ。**どちらも「無ければ従来どおり」で読めるので、既存のセーブデータをそのまま扱える。**
- **ステータス上限と適正の参照は `mastermonStatCap(mm)` / `mastermonApt(mm)` に必ず通す。** 直接 `MASTERMON_STAT_CAP` や `APTITUDE[key]` を読むと転生後のマスモンで上限・適正が食い違う。
- 効果: Lv1 / EXP0 / ステータス1/3 / チケット+10 / 適正3つを1段階上昇 / **上限+100(`REBIRTH_STAT_CAP_STEP`。999→1099→1199…と転生の回数ぶん積み上がる)** / 基礎HP・移動速度+10(転生回数ぶん累積)。計算は `rebirthMastermonResult(mm, picks)` 1か所で、元のオブジェクトは書き換えない。
- **S以上の適正**(`S → S+ → SS → SS+ → M`。Mが最上位・虹色)は転生でしか手に入らない。上の段階ほどトレーニングの上がり幅が大きく(`APTITUDE_TRAIN_MULT`)、`mastermonStatFactor` の除数も縮んで**倍率の伸びも良くなる**(`APTITUDE_FACTOR_DIVISOR_MULT`)。**段階を足すときは `APTITUDE_ORDER` と上の3つの表をセットで増やす**(表に無い段階は倍率1に落ちて弱くなる)。**最上位の判定は `aptitudeIsMax()`**(`==='S'`と書かない)。CSSクラスは`+`が使えないので `aptitudeCssKey()` で `S+`→`apt-Sp` に変換する。
- **基礎値の加算は「倍率を掛ける前」に足す。** 計算順は `applyMastermonStatsToEntity` と `mmEffectiveStats` の2か所に同じ形で書いてあるので、**片方だけ変えると表示と実戦力が食い違う。**
- **マルチでは `rebirth` / `apt` / `baseHp` / `baseSpd` も部屋の参加者情報へ載せる**(`currentMastermonInfo` / `mmEntryFields`)。片側だけで掛けるとHPと移動速度が食い違い、ゲストの位置補正が暴れる。
- **適正がすべて最上位(M)になっても転生できるように、選ぶ数は `rebirthPickTarget(mm)` で「上げられる適正の数」に頭打ちする。**
- **ソロの敵botは転生回数ぶん強くする**(`syntheticMastermonForLevel(el, lv, rebirth)`)。上限が上がった比率でステータスを底上げし、`rebirth`を持たせることで基礎HP/速度の加算も自動で効く。**適正は種族のまま**(上げられるのは転生したプレイヤーだけ)。転生して自分だけ強くなると手応えが無くなるため。
- 転生前の状態は `REBIRTH_BACKUP_KEY` に保存してあり、管理者画面から戻せる(動作確認用。**戻したあとも保存は消さない**のでプレイヤーの操作では触れない)。
- 演出は8.5秒(`REBIRTH_ANIM_MS` = `audio/rebirth_audio.mp3` の長さ = CSSキーフレームの尺)。**尺を変えるときは3つとも直す。** 飛び出す金文字だけは向きが個別なのでWeb Animations APIで動かしている(**キーフレーム内で `var()` は使わない**。他の52個の演出と揃えるため)。

# 通貨・アイテム

- 通貨は`loadWallet/saveWallet/addWallet`、試合報酬は`showResult`(定数`GOLD_*`/`DIA_*`)。
- アイテムは`PLAYER_ITEMS`、バッグは`loadBag/saveBag/addBagItem`、ガチャ`GACHA_POOL`(10連10個目は`GACHA_TICKET_POOL`確定)、ショップ`SHOP_ITEMS`。
- バッグUIは左=アイコングリッド+説明、右=対象マスモン一覧。「選択→使用」の2段階で、**アイテムを切り替えてもマスモンの選択は保持する**。マスモン一覧は`innerHTML`で作り直すので、**`renderBagTargetList()`は前後で`scrollTop`を持ち越す**(入れないと選ぶたびに先頭へ飛ぶ)。フリートレーニングチケットを使ったときだけ`#bagGoTrainBtn`(そのマスモンのトレーニング画面へ直行)を出す。`showBagGoTrainBtn()`は`renderBag()`の**あと**に呼ぶこと(先に呼ぶと再描画で消える)。ステータス上昇アイテムは上限(`mastermonStatCap`。通常999・転生済みは999+100×転生回数)を考慮して変動値を出し、超える個数は選べない。
- **種族の基礎値(HP・移動速度)への加算は `mastermonBaseBonus(mm)` 1か所にまとまっている。** 内訳は転生回数ぶん(`REBIRTH_BASE_*_BONUS`)と基礎値アイテムぶん(`mm.baseHp` / `mm.baseSpd`)。**直接 `mm.baseHp` を足し込まない。**
- **基礎値アイテム**(レイド報酬限定・`PLAYER_ITEMS` の `base:'hp'|'speed'`)は「生命の果実」「加速剤」で、1個あたり `BASE_ITEM_GAIN`。**上限が無く、育成倍率が乗る前に足される**ので育ったマスモンほど効く。使用時の値は必ず `safeBaseAmount()` を通す(壊れた値でHPがNaNになると試合が続けられなくなる)。
- **マルチへ送るのは「アイテムぶんだけ」**(`baseHp`/`baseSpd`)。受け側が `rebirth` から転生ぶんを足し直すので、**合計を送ると転生ぶんが二重に乗る。**
- アイテムのアイコンは絵文字とSVGが混在する。**HTMLに入れる場所は `it.icon` をそのまま、`textContent`/トーストへ出す場所は `playerItemTextLabel()`** を使う(SVGを textContent に入れると生タグが出る)。
- 報酬(`grantReward`/`rewardText`/`raidRewardLabel`)は1件の `item`/`n` と複数件の `items:[{key,n}]` の両方を扱う。**列挙は必ず `rewardItemList(r)` を通す。**
- **遠征**(`EXPEDITIONS`・`loadExpeditions`/`saveExpeditions`)はマスモンを数時間送り出して育成アイテム・EXP・当たり枠を持ち帰らせる。**素のゴールドと基礎値アイテム(生命の果実・加速剤)は出さない**(前者は試合報酬と役割が被り放置が得になる、後者はレイド討伐限定の希少性を壊す)。EXPだけ`grantReward`に無いので`awardMastermonExp(mm,{bonusExp})`を直接呼び、**Lv上限のときの`goldGain`は自分で`addWallet`する**。画面と拘束の決まりは aramon-screens。
