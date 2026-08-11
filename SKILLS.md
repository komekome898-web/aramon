# スキル一覧

CLAUDE.mdから外した詳しい仕様は`.claude/skills/<名前>/SKILL.md`に置いてある。
Claude Codeは必要になったスキルだけを自動で読み込むので、**作業に入る前に該当するものを読むこと。**

| スキル | 中身 | 主に触るファイル |
|---|---|---|
| `aramon-layout` | CSS・レイアウトの共通規則、スクロールロック除外、ポップアップの定型、文字入力ポップアップ、強制横向き/タッチ | `style.css` `input.js` `world.js` |
| `aramon-screens` | タイトル / ロビー / カードカルーセル / モンスター一覧 / マスモン詳細 / 射撃訓練場 / 視点設定 / 更新履歴 / 管理者画面 | `ui.js` `index.html` |
| `aramon-render` | 3D風投影・カメラ・depthソート・カリング・地面に貼る円、技エフェクトの立体化(炎/結晶/雷/ビーム/ドーム/弾) | `render.js` |
| `aramon-real3d` | リアルマップのWebGL地形・空・遠景の山・水/溶岩・障害物(岩/木/水晶)・弾道(上下のねらい) | `real3d.js` `data.js` `render.js` |
| `aramon-multiplayer` | ホスト権威型の同期、ゲスト側の演出漏れ対策、ラバーバンド対策、フリーズ対策、観戦、Firebase・アカウント | `network.js` `firebase.js` |
| `aramon-audio` | BGMトラック/intensity、SE定義、Web Audio合成、実音源mp3のループとクロスフェード、スキン専用BGM/SE | `audio.js` `audio/` |
| `aramon-combat` | 技のギミック(blast/burst/aoeShape/ガッツ削り)、安全圏、マスモン、通貨・バッグ・ガチャ・ショップ | `combat.js` `data.js` `ui.js` |
| `aramon-season-raid` | シーズンの開始/切替/SPリセット、シーズンパス報酬、日替わりミューテーター、レイドの公開とボスHP・報酬の調整、レイドガチャ/カタログ、SSRの入手経路 | `data.js` `ui.js` |
| `aramon-monsters` | 新モンスター追加チェックリスト、SSR/色スキン、歩行アニメーション、歩行スプライト生成 | `data.js` `monsters/` |
| `aramon-monster-tools` | モンスター追加ツール(studio_web.html / monster_studio.py / monster_add.py / check_monsters.py)の仕組みと落とし穴 | `tools/` |
| `aramon-performance` | 描画量・shadowBlur・動的解像度・遅延ロード・縮小スプライト・地形パッチ・Service Worker | 全般 |
| `aramon-push-notifications` | プッシュ通知(遠征の帰還・部屋が立った)の調査結果と実装手順。**発注者判断で現段階では未実装。** 再検討するときに読む | (未実装) |
