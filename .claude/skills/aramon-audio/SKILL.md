---
name: aramon-audio
description: 荒野モン動の音(audio.js)。BGMトラック/intensity・SE定義・Web Audio合成・実音源mp3のループとクロスフェード・スキン専用BGM/SEを触るときに読む。音源ファイルはaudio/フォルダ。
---

# 音(audio.js)

音源ファイルはすべて`audio/`フォルダ(`./audio/bgm_*.mp3` / `./audio/se_*.mp3`)。

- 原則Web Audio合成。初回タップ後に`audioInit()`。合成ヘルパーは`seTone`/`seNoise`/`seNoiseLfo`、定義は`SE_DEFS`。
- `playSe(name, opts)`は**負荷対策で自分の操作モンスターに関わる音のみ**鳴らす。`SE_MIN_GAP`で連打間引き、`SE_VOL_BOOST`で技SEを増幅。tier3は`MOVE_SE_BY_STYLE`(combat.js)、技名個別は`move.seStyle`。
- BGM: タイトル / 試合中(intensity 0〜2)/ 決戦(3)/ ラストバトル(4)/ ショップ / ロビー / トレーニング。`bgmSetTrack()`と`bgmUpdateBattleIntensity(aliveCount)`。全ノードは`bgmTrackGain`→`bgmGain`→出力。
- **intensityを増やしたら`bgmStepDur()`のbpm配列も伸ばす**(配列外でBPMがNaNになる)。
- **トラック/intensityを追加したら管理者画面の`BGM_TEST_ITEMS`にも足す。**
- **実音源ループは「常に1曲だけ」を`updateBgmFileLoops()`が保証する。** `bgmFileLoopTarget()`が鳴らすべき1曲を返し、それ以外は`stop()`。**トラック名は明示で判定する**(「title/shop以外は試合中」としていたためトレーニング画面で決戦BGMが重なった)。新トラックは1行足すだけ。
- **SSRスキン専用の音(BGM3曲・専用SE4種・昇格演出の音声)は`data.js`の`SKIN_MEDIA`だけが持つ。** audio.jsは表を1周してループ/ワンショットを作るだけなので、**スキンを足してもaudio.jsは1行も増えない**(`skinBgmLoops`/`skinMediaSeOneShots`/`skinPromoteSeOneShots`)。専用SEは`skinSe:<スキンid>:<tier3|hit|kill|win>`という名前で`SE_DEFS`へ入り、combat.jsの`SKIN_TIER3_SE`等へも自動で登録される(手書きの指定があるスキンはそちらが優先)。**未ロード・取得失敗のときは既存のSE(`SKIN_SE_FALLBACK`)へ落ちる。**
- **専用BGMは`activeSkinBgmSet()`(`game.started && SKIN_MEDIA[装備スキン].bgm`)のときだけ切り替わる。** `game.started`を見るのは、管理者画面のBGM確認(`final5`/`last2`ボタン)が試合を開始せずに`cur:'battle'`を使うため。ここを見ないと、開発者アカウントがたまたま専用BGM持ちのスキンを装備していると確認ボタンが専用曲を鳴らしてしまう。**専用曲が未ロードの区間だけ通常のfinal5/lastbattle/合成BGMへ自動フォールバックする**(3曲を個別にensureする、無音にしない)。管理者画面のテストIDは`skinBgm:<スキンid>:<battle|final5|lastBattle>`で、`BGM_TEST_ITEMS`の行も`SKIN_MEDIA`から生成される。
- `bgmSetTrack('title'|'shop'|'training')`はintensityを0に戻す(`null`は試合中の演出でも使うので触らない)。リザルト後にロビー曲へ戻す遅延処理は`bgmDesiredTrack()!==null`なら何もしない。

## 実音源を使う例外

「全合成」が原則だが、外部依存を増やさない範囲で実音を使う。

- **長いBGMは`createBgmLoop(url, gain, keepPos)`**: `ensure()`(fetch+decode)/`start()`/`stop()`(0.6秒/0.4秒フェード)。合成との二重再生は`bgmFileLoopActive()`で防ぎ、**実音源が鳴っている間は合成ステップを一切呼ばない**。未ロード/失敗時のみ合成へフォールバック。試合中の2曲は`audioInit()`で先読み、ショップ曲は画面を開いたときに初回ロード。曲ごとの音量は`BGM_FILE_GAIN`。
- **切替は等パワークロスフェード(`_equalPowerCurve`)。** 線形だと合計音量が一時的に1.4倍になる。上げ側`sin`/下げ側`cos`で、**下げ側は終点基準(`to + (from-to)*cos`)**。
- **ロビーBGMだけ再生位置を記憶する**(`keepPos`。`stop()`で経過を足し`start()`で`src.start(t, offset)`)。「いちか(実音源)」と「オリジナル(合成)」の切替は`lobbyBgmMode`(localStorage `aramon_lobby_bgm_v1`)+ヘッダーの`#headerBgmBtn`。
- **トレーニング画面は`bgmSetTrack('training')`。切替判断は`updateMetaBgm()`(ui.js)1か所**に集約(`mmOpenTab()`と`#mastermonScreen`のMutationObserverから呼ぶ)。試合中とショップ表示中は触らない。
- **短い内蔵SEは`createSeOneShot(dataUrl|url, gain)`。** `play()`が未ロード/音量0でfalseを返すので`if(!seXxx.play()) SE_DEFS.既定SE(t,o)`と書けば必ず鳴る。`SE_DEFS`に足せば管理者画面のSE確認に自動で載る(表示名`SE_TEST_LABELS`、間引き`SE_MIN_GAP`)。
- **「実音源のあとに合成SEをつなげる」ときは`play(when)`に開始時刻を渡す**(ヒノトリ`fireWave`)。長さは`.dur()`。
- **提供音源の技SEは`move.seStyle`で指定する**(`MOVE_SE_BY_STYLE`はスタイル単位なので他モンスターまで巻き込む)。現在: `darkHoust`/`requiemEnd`/`mocchiBeam`/`monta`/`crystalRain`/`fireWave`。
- **転生演出の音声(`audio/rebirth_audio.mp3`・約8.5秒)は `seRebirth`。** 演出のCSSキーフレームと尺を合わせてあるので、**長さを変えるときは ui.js の `REBIRTH_ANIM_MS` とキーフレームも一緒に直す。** 転生の確認画面を開いた時点で `ensureRebirthSeBuffer()` が読み始める。
- 使い分け: 1.2秒程度まではデータURIインライン、3秒級のSEと長い曲は外部mp3+fetch。
- **提供音源の前後の無音はmp3の側で切っておく**(再生時にずらす仕組みは持たない)。`silencedetect`で位置を測り`-ss/-to`で切り直す。
- 実音の抽出(この環境): `pip install imageio-ffmpeg`で静的ffmpeg。**Chromium(OSSビルド)はAAC不可・mp3可**なので動画音声は一旦mp3化する。整音は`loudnorm=I=-16:TP=-1.5:LRA=11`(mono 96k)。
- **iPhoneだけで足すときは`tools/studio_web.html`の「SSRスキン専用」**。動画を実時間で再生しながらMediaRecorderで録り直すので、出てくるのは端末が対応する形式(iPhoneなら`.m4a`/`.mp4`)。ffmpegを通していないぶんラウドネスは揃わないので、**音量が浮くときはこちらでmp3に作り直して`SKIN_MEDIA`のパスを差し替える。**
