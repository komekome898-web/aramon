# モンスター追加ツール(開発用)

ゲーム本体からは読み込まれません。すべて `tools/` の中で完結します。

## 何が自動になるか

1体追加するのに必要だった作業のうち、次が自動になります。

- 動画 → 歩行8コマ×2(正面/後ろ)の透過PNG
- 静止画 → `monsters/<key>.png` / `<key>_player.png`(正方形・被写体が高さの9割・足元が下端付近)
- 色スキンの `hue` を静止画から自動サンプリング
- **9つの表への登録**(`ELEMENTS` / `TRAIT_DESC` / `SIGNATURE_MOVES` / `MOVE_AURA` / `MONSTER_AURA` / `SKIN_CONFIG` / `STATE_CHANGES` / `APTITUDE` / `WALK_ANIM`)
- 技3つの組み立て(tier1/2 は絵文字を選ぶだけ、tier3 は形のテンプレートを選ぶだけ)
- **検証**(登録漏れ・画像の不足・歩行コマの異常・JSの構文)

## 準備

```
pip install pillow numpy opencv-python-headless scipy imageio-ffmpeg
```

登録と検証だけなら上記は不要です(標準ライブラリだけで動きます)。

素材は `assets/<key>/` に置きます(gitには入りません)。

```
assets/mymon/front.mp4   歩行(正面)
assets/mymon/back.mp4    歩行(後ろ)
assets/mymon/icon.png    静止画(透過済み)
```

## 使い方A: GUI(おすすめ)

```
python3 tools/monster_studio.py
```

ブラウザで `http://127.0.0.1:8777` を開きます。

- 左で仕様(名前・色・特性・適性・技)を入力
- 右で歩行動画の**背景の抜き方を切り替えながら8コマをその場でプレビュー**。
  問題のあるコマは赤枠で理由付きで印が付くので、良い設定が見つかるまで切り替えます
- 「この設定で書き出す」→「静止画を整える」→「data.js / ui.js へ登録」→「検証」の順に押すだけ

## 使い方B: CLI

```
python3 tools/monster_add.py mymon --dry-run   # 入る差分を確認
python3 tools/monster_add.py mymon             # 全部やる
python3 tools/monster_add.py mymon --revert    # 登録を取り消す
python3 tools/check_monsters.py                # 検証だけ
```

仕様ファイルは `monsters/specs/<key>.json`。`monsters/specs/_example.json` をコピーして使います。

## 技のテンプレート(tier3)

コードを書かずに、既存の立体エフェクトがそのまま乗ります。

| template | 見た目 |
|---|---|
| `fan` | 炎の扇(インフェルノ型) |
| `wave` | 炎の壁が前進(ファイアウェーブ型) |
| `crystal` | 結晶が降って地面から突き出る |
| `beam` | 光の筒(モッチ砲型) |
| `river` | 宙を走る星の川(天河天翔型) |
| `beams3` | 光の筒3本(フラワービーム型) |
| `thunder` | 空から落雷(超雷撃型) |
| `psychic` | 弧を描く念力の壁(サイコキネシス型) |
| `orb` | 黒い球+着弾でドーム爆風(ビッグバン型) |
| `tornado` | 地面に立つ竜巻 |
| `sword` | 黄金の聖剣(天の慈悲型) |
| `shell` | 回る殻+毒の電撃(シェルアタック型) |
| `crescent` | 黒い三日月を5連射(ダークホウスト型) |
| `spear` | 三叉の槍3本+爆風(アムピトリテ型) |

tier1/2 の弾は絵文字を選ぶだけです。選択肢は `render.js` の `REAL_ICON_FX` から自動で読むので、
ゲーム側に弾エフェクトを足せばツールの選択肢にも自動で増えます。

## 仕組み(壊さないための約束)

- 表への挿入位置は各表の末尾にある `// <<AUTO:表名>>` の行です。**この行を消さないでください。**
- 追記した行には `/*@key*/` の目印が入ります。`--revert` はこの目印で行を特定して消します。
- 挿入は全表を1回のトランザクションで書きます(途中で失敗したら何も書きません)。
- 背景除去のアルゴリズムは既存の `tools/build_walk.py` をそのまま呼んでいます。
  モンスターごとに積み上げたモード(`white` / `black` / `blackopen` / `grass`)の資産はそのまま使えます。

## 最後にやること

ツールは `sw.js` を触りません。**コミット前に `CACHE_NAME` を1つ上げてください。**
