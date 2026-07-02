このフォルダに以下のファイル名で画像を置いてください（PNG推奨、正方形が綺麗に収まります）:

【全モンスター共通・選択画面と戦闘中の敵に使用】
fire.png     - ドラゴン
aqua.png     - ウンディーネ
leaf.png     - プラント
spark.png    - ライガー
rock.png     - ゴーレム
phoenix.png  - 火の鳥種

【操作中の自分専用・任意】
fire_player.png
aqua_player.png
leaf_player.png
spark_player.png
rock_player.png
phoenix_player.png

_player.png がアップロードされている属性は、自分が操作しているときだけ
その画像が使われます（背面視点用の絵などにおすすめです）。
_player.png が無い場合は、通常の画像（例: fire.png）が代わりに使われます。
両方とも無い場合は、自動的に元のグラデーション円アイコンが表示されます。

GitHubリポジトリの構成例:
  index.html
  monsters/
    fire.png
    fire_player.png   (任意)
    aqua.png
    aqua_player.png   (任意)
    leaf.png
    spark.png
    rock.png
    phoenix.png
