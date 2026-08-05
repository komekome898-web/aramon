---
name: aramon-real3d
description: 荒野モン動のリアルマップ(real3d.js / Three.js)。WebGL地形・空・遠景の山・水/溶岩・障害物(岩・木・水晶)の3D化、リアルマップ専用の弾道(上下のねらい)。real3d.jsやリアルマップ関連を触るときに読む。
---

# リアルマップ: WebGL地形(real3d.js)

- **通常6マップそれぞれにリアル版がある**(`wild_real`等)。中身(岩・山・水・溶岩・アイテム)は通常版と同じで、違うのは地面が立体になることだけ。**`MAPS`の各マップから`data.js`末尾の`Object.keys(MAPS).forEach`が自動生成する。**
- 選択は「通常マップのキー(`game.selectedMap`)+ リアル切替(`game.realMapMode`)」。実キーは`mapKeyForMode()`が組み立て、ランダムは同じ側からだけ抽選(`resolveMapKey()`)。**マップのキーをそのまま保存しない。**
- **リアルマップは報酬2倍**(`REAL_MAP_REWARD_MULT`。`showResult`のゴールド/ダイヤに掛ける)。
- 地形の形は`REAL3D_TERRAIN_SETS`(`real3dTerrain`)、見た目は`REAL3D_THEMES`(`real3dTheme`)。**色を足すときはreal3d.jsの`DEFAULT_THEME`にも足す。**
- テーマの反映は`applyReal3DLayer()`が`window.__aramonRealTheme`に入れ、real3d.jsの`setActive()`→`applyTheme()`が空・霞・頂点色・テクスチャ・遠景の山を差し替える(地形メッシュは使い回す)。
- **地面だけWebGLで描き、モンスター・弾・エフェクト・HUDは従来の2Dキャンバスが上に重なる**(`#glCanvas` z:0 / `#gameCanvas` z:1)。
- **2Dの`project()`と3Dカメラを完全に一致させてある**(`FOV_V`=64° / `camPos` / `camState.yaw,pitch`)。**`FOV_V`や`CAM_*`を変えたらreal3d.js側も合わせる。** 丘による遮蔽は2D側に無い(割り切り)。
- **高さは`data.js`の`real3dHeightAt(x,y)`。純関数なのでホスト/ゲストで自動一致**し、当たり判定(`world.js`の`getTerrainHeightAt`)も同じ関数を使う。
- **各`REAL3D_TERRAIN_SETS`の最大傾斜は0.3程度まで**(`Σ(amp×freq)/2`)。ダッシュは1フレーム20単位進むので、超えると`CLIMB_TOLERANCE`(12)を越えて坂を登れなくなる。
- **岩・水晶の「登っているからすり抜ける」判定は`baseTerrainHeightAt`基準**(絶対値`m.z>25`だと起伏だけですり抜ける)。
- ESモジュールなので`window.__aramonReal3D`(`setActive`/`render`/`resize`)経由。WebGL初期化失敗時は`render()`がfalseを返し2D地面にフォールバック。

## テクスチャ・材質・ライティング

- **細かい質感はテクスチャで出す。** メッシュ分割は約50単位なので、それより細かい起伏を地形セットに足してもジャギーになるだけ。`buildGroundTexture()`が値ノイズのタイルを生成。**UVオフセットをパッチ位置に合わせること**(`tex.offset.set(sx/TEX_TILE, -sy/TEX_TILE)`。`uv.y`は`rotateX(-π/2)`で反転するので符号が逆)。無いと模様が地面の上を滑る。
- 地面の色は「高さ+傾斜」に`macroPatch()`(ワールド座標の純関数)のまだらを混ぜる。
- **地面はPBR(`MeshStandardMaterial`)。** 色(`buildGroundTexture`)+ 法線・粗さ・AO(`buildDetailMaps`)の4枚組で、`groundMapsFor(style)`がスタイルごとに1回だけ作って使い回す。**4枚すべての`offset`をパッチ位置に合わせる。** 凹凸の強さはテーマの`bump`→`normalScale`(`bump*3`)。`metalness`は0。
- **色テクスチャだけ`colorSpace = SRGBColorSpace`。** 法線・粗さ・AOは`NoColorSpace`。取り違えると色が沈む/凹凸が壊れる。
- **ライティングは「空から作った環境マップ(PMREM)+ DirectionalLight」。** HDRI画像は持たず、`applyEnvironment()`が同じ空シェーダーを`PMREMGenerator.fromScene()`に通す。テーマを変えたら必ず作り直す。**前の`envRT`は`dispose()`する。**
- **仕上げはrenderer側で完結**(`toneMapping = ACESFilmic` / `outputColorSpace = SRGB` / `antialias:true`)。**ポストプロセス(EffectComposer)は入れない。** 挟むとMSAAが無効になりiPhoneのメモリと帯域を大きく使う。SSAOは開けた地形では画素差0.4/255程度しか出ず割に合わない(計測済み)。
- **`scene.environmentIntensity`はThree r160に無い**(r163から)。環境光の強さは`material.envMapIntensity`で指定する。
- **空と遠景の山は`material.toneMapped = false`。** テーマで決め打ちした色なので、トーンマッピングを通すと意図した色でなくなる。
- **テクスチャ生成は試合開始時に1回だけ走る同期処理。** オクターブ数やサイズを上げると実機の待ち時間に直結(色512px/細部256pxが上限の目安)。法線・粗さ・AOは**同じ高さ場を1回だけ作って共有する**。

## 遠景の山・地形の大物・水/溶岩

- 遠景の山は`RIDGE_LAYERS`(距離の違う3枚)を縦にも分割して高度で色を変える(麓=霞/中腹=岩/頂上=雪)。**奥の層から順に頂点を積む**(空も山も深度を書かないので、手前を後に描かないと消される)。描画順は`renderOrder`(空-2 / 山-1)。
- **`ridgeProfile()`の周波数は必ず整数にする。** 半端な値だと一周(2π)して戻った時に高さが一致せず、輪の閉じ目に縦の段差が出る。
- **山(火山/雪山/森/ピラミッド)と地面のしみ(溶岩/海/川/オアシス)は3Dで描く。** render.jsが`__aramonReal3D.render(rocks, {volcanoes,lava,sea,river,oasis})`で渡し、`updateWorldObjects()`が署名(件数+端の座標)の変化を見て作り直す。**`setActive()`で`worldSig`を空にする。**
- 山の寸法は2Dの`drawSolidCone`と同じ(高さ=`radius*(isMain?1.15:0.9)`)。裾は`MOUNT_SKIRT`ぶん地面へ埋める。**リアルマップでは`drawVolcanoComplex`を呼ばない。**
- **山の見た目は「形+頂点カラー」で作る。画面に貼る円で演出しない**(視点を変えると山からずれて浮いて見える)。火山の主峰は先を切った円錐+火口の円盤+赤熱した縁、色は`MOUNT_COLORS`の麓/中腹/頂上を高さで混ぜる。側面は**内向きにだけ**へこませる(外へ膨らませると当たり判定の外に山肌が出る)。
- しみは`RingGeometry`の各頂点を`heightAt()`で地形に沿わせる。`ZONE_LIFT`で少し浮かせ`polygonOffset`と併用してZファイティングを防ぐ。**水は`roughness`を下げすぎない**(空を映しすぎて白く飛ぶ)。
- **海と川は円を並べない。** 海は海岸線の式`seaEdgeX(y)`の沖側に格子を張り(列uが0=沖/1=岸)、川は円の連なりを芯にしたリボンにする(`splitRivers`で本数に切り分け)。円のまま描くと輪郭が数珠つなぎに見える。
- **海面の高さは行(y)ごとに決める。** 全体で1つの平均にすると地形の起伏(±130ほど)に負けて水面が地面に埋もれる。岸ぎわだけ地面へ寄せて水際の段差を消す。
- **波と流れは頂点シェーダー(`onBeforeCompile`)で動かす。** 属性は`aShore`(0=沖/中央 1=岸)と`aFlow`(川の向き。海は0)。CPUは毎フレーム`uTime`を渡すだけ。**泡は岸ぎわの細い帯と海の寄せ波だけ。**
- **手で組んだ水面は三角形の表裏が揃わない。** 材質は`DoubleSide`にし、法線は組み立て後に上向きへ揃える。
- **しみのUVはワールド座標から作る**(`ZONE_UV_TILE`)。**共有材質は`userData.shared`を見て使い回す**(作り直しのときに`dispose()`すると次の試合で消える)。
- 溶岩は「黒い地殻+割れ目だけ光る`emissiveMap`」。脈動は`lavaMats`の`emissiveIntensity`をまとめて動かす(火口・縁も同じ配列に入れる)。
- **遠くの2D障害物(建物)は`obstacleFade()`で消す。** 3Dの山は奥行きを持つのに2Dの建物は距離に関係なく重なるため。岩・木・水晶は3Dなので不要。
- **山を3Dにすると2Dのモンスター・弾・アイテムが必ず山より手前に描かれる。** render.jsの`occludedByMountain()`(カメラ→対象の線が円錐の内側を通るか)で描画を止める。**自分だけは例外**(カメラが山にめり込むと自機が消えるため)。
- **影の範囲はカメラ前方(`SHADOW_AHEAD`)を中心に`SHADOW_HALF`四方だけ。** `SHADOW_MAP`(1024)を上げるとiPhoneで重くなる。
- **地面に立つ大きな物(火山・雪山・森・ピラミッド)の頂点は`groundZAt()+高さ`で投影する**(底面は`projectGround`)。通常マップでは`groundZAt`が0なので見た目は変わらない。

## 障害物(岩・木・水晶)

- **3Dで描くが、モンスター・技との前後関係は従来の奥行きソートのまま。** 仕組みは「3Dで描く → 2D側は`drawables`の同じ位置で`eraseObstacle()`が`destination-out`で輪郭をくり抜く」。くり抜くと**それより先に描かれたもの(=奥)だけが消えて3Dの障害物が見え、後に描かれるもの(=手前)はそのまま上に乗る**。`occludedByMountain`のような全消し判定は使わない(小さな岩で全身が消える)。
- **形の定義は`data.js`の`OBST_SHAPES`1か所**(`h`モデルの全高 / `sink`地面へ埋める深さ / `sil`くり抜く形)。real3d.jsは`window.__aramonObstShapes`、render.jsは同名の定数として同じ表を読む。**3Dモデルの寸法を変えたら必ず表も直す。** 単位は当たり判定の半径=1。
- **`sil`の座標はモデルの原点(=地面より`sink`だけ下)基準。** 種別は 0=楕円 / 1=箱(5番目で上端の太さ) / 2=三角(円錐)。幹や柱を楕円で消すと角が残り、横倒しの丸太を楕円で消すと両端が残る。
- **隠れる範囲を実物と合わせるため、3D側の置き方を2Dでも完全に再現する**: ①`sink`を引いた位置がモデルの原点 ②高さの個体差`hk`は3Dと同じ式でseedから作る ③接地高さは3Dと同じ「足元4点のいちばん低い高さ」(`obstacleBaseZ`。岩は動かないので1回計算して覚える)。
- **同じパスに入れる部分パスは回り方をそろえる。** `ctx.ellipse(0→2π)`と逆回りの多角形を混ぜると非ゼロ規則で穴になり消し残る(幹と葉が重なる木で発生)。多角形は右下→左下→左上→右上で回す。
- **細い枝・葉・回転する張り出しは消さない/幹に寄せる。** サボテンの腕のようにヨー回転で向きが変わる張り出しは、左右対称の箱では追従できないのでモデル側を幹に寄せる。
- **高さは決め打ちで縮尺せず`project(x,y,原点+r*h*hk)`で実測する。**
- **数が多いので種類ごとに`InstancedMesh`(形は3通り)。** 並べ直すのは`OBST_STEP`だけ動いたときで、近い順に`OBST_MAX`個まで。**上限で切ったときの実距離を`obstacleCullDist()`で2Dへ返す**(食い違うと3Dに無い障害物をくり抜いて地面に穴が開く)。
- **障害物の内訳はマップごとの`realObstacles`。** 通常マップは`rockFlavors`のまま。種類を足す手順: ①`realObstacles` ②`OBST_SHAPES`に形 ③real3d.jsの`obstacleGeo()`にモデル ④`OBST_MATS`に材質 ⑤render.jsの`drawRock`のフォールバック分岐(WebGL失敗時)。
- **既定の岩(`rock`)の色はテーマから作る**(`theme.steep`/`theme.gravel`)。荒野・火山・ジャングル・海岸に共通で出るので決め打ちにするとどこかで浮く。
- モデルは「当たり判定の半径=1・地面=y0」のローカル空間で作り、配置時に`radius`で拡大。**足元4点のいちばん低い高さに合わせてから`sink`ぶん埋める。**
- **影は本物のメッシュが落とす**(影専用ダミー球`updateShadowCasters`は廃止済み)。
- three本体に`mergeGeometries`は無いので、複数パーツのモデルは`mergeGeos()`(自前・非indexed化して連結)でまとめる。一度も描いていないジオメトリは`dispose()`不要。

## 弾道(上下のねらい)

- **通常マップに影響を出さないため、分岐はすべて`isReal3dMap()`1か所に寄せる。** 通常マップでは`fireAimSlope()`が0・`projectileMuzzleZ()`が`ent.z`・`projHeightHits()`が従来判定を返すので、弾道も当たり判定も変わらない。
- 弾は`vz = aimSlope × 水平弾速`で飛び、弾ごとの`grav`で落ちる。**水平速度と`traveled`は変えない**ので飛距離(`move.range`)は従来どおり。
- **落下加速度は`projGravityFor(range, 弾速)`が技ごとに決める。** 「平らな地面で水平に撃つと、ちょうど射程距離の地点で銃口の高さぶん落ちて着地する」強さ。固定値にしない。調整は`PROJ_DROP_Z`1か所。
- **打ち上げ角は`ballisticSlope(dz, 水平距離, 弾速, 重力)`が落下ぶんを見越して決める**ので、重力を変えても狙点はずれない。
- プレイヤーの`aimSlope`は`cameraAimSlope()`(画面中心から視線を伸ばして地形に当たる点を探し、銃口=`足元+AIM_MUZZLE_Z`からそこへ向ける)。botは`targetAimSlope()`で相手の胴をねらう。
- **マルチではゲストのカメラをホストが知らないので、発射イベントに`slope`を載せて`ent.aimSlopeOverride`で渡す**(処理後にnullへ戻す)。弾の配信にも`vz`/`terrain3d`が要る。
- 地形への着弾は`p.terrain3d && p.z <= getTerrainHeightAt()`。**ホスト(combat.js)とゲストの見た目ループ(network.js)の両方に入れる。**
- **安全圏の円は投影できない点(カメラの後ろ)をnullのまま残し、`strokeProjectedRing`が線を切る。** 詰めて連結すると円の左右が1本の直線で結ばれ、遠くの安置線が目の前を横切って見える。画面上で飛びすぎた区間も切る。
- 視点の上下範囲は`camPitchMin()`(リアルマップだけ空側`-0.42`まで)、試合開始角度は`applyStartPitchForMap()`。**マップ確定の直後に呼ぶ**(startGame/beginMultiplayerMatchInner)。`updateCamera()`でも毎フレームclampしている。
