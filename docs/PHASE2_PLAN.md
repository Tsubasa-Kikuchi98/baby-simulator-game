# フェーズ2 計画：3D 移植とサウンド追加

作成 2026-09-12（v1）。仕様は `baby_safe_spec.md` §9〜§11、契約は `docs/CONTRACT.md`（v3 追補 §9 まで）。
この文書は「何が既にあり、何が残っているか」の棚卸しと、残作業の順序・完了条件を決めるもの。作業が進んだら表の状態欄を更新する。

> **注意（2026-09-12 22:00 時点）**：別の Claude Code セッションが `src/render/three/`・`src/game/`・`tests/` を同時に編集中だった
> （3D 層の v3 追随と旧テストの修正）。下記の「現状」はその時点のスナップショット。**着手前に必ず `git status` / mtime と
> 該当テストの結果を再確認**し、済んでいる項目は飛ばす。

---

## 0. 現状スナップショット

### 0.1 できていること

| 領域 | 状態 | 場所 |
|---|---|---|
| ゲームロジックの分離（DOM/Canvas/Math.random 非依存） | 済。`npm run check:pure` OK | `src/game/` |
| 描画層・音声層のインターフェースと DI | 済。`?mode=3d` / `GAME_MODE=3d` で切替、3D 失敗時は 2D へフォールバック | `src/render/IRenderer.js` `src/audio/IAudio.js` `src/main.js` |
| Three.js 描画層（プレースホルダー・Raycaster・床平面ドラッグ・カメラ自動フィット） | 済（約 900 行）。SwiftShader 判定で影を軽くする分岐あり | `src/render/three/ThreeRenderer.js` |
| glTF 読み込み・差し替え・`fixedModel`・頂点数ログ・8 秒タイムアウト | 済 | `src/render/three/assets.js` `ObjectView.js` |
| 赤ちゃんの AnimationMixer（clip 名 = `baby.anim`）＋手続きアニメのフォールバック | 済 | `src/render/three/BabyView.js` |
| 演出：緑バースト、遊びの星、黄フラッシュ、combo 同期点滅、再発 emissive、モヤモヤ、不機嫌 Sprite、抱き上げ、着地、落下の弧、合成グロー、あきた表示 | 済 | `ThreeRenderer.js` `particles.js` `textures.js` |
| v3（容れ物・高い場所・収納済み・重い家具の鍵・捨てた絵文字の飛び・`heavy_nudge`） | **別セッションが実装中**（22:00 時点で `trashed` `stored` `heavy_nudge` `lidpop` `hintWalls` `isStored` が入っている） | `ThreeRenderer.js` `ObjectView.js` |
| Web Audio 層：合成音フォールバック、mp3/ogg 読み込み、初回クリック後に AudioContext、ミュート（Title/HUD、localStorage） | 済 | `src/audio/webaudio.js` `src/ui.js` |
| BGM：`bgm_main` を Play 中ループ（ファイル or 合成アルペジオ） | 済（単層のみ） | `webaudio.js` `main.js` |
| 3D ビルド（`dist-3d/`、assets コピー） | 済。three 込みで約 620 KB（gzip 160 KB） | `vite.config.js` |
| Playwright 3D 確認（WebGL 有無、mute、頂点数、raycast、ドラッグ、フラッシュ、次ステージ構築） | 済だが一部が旧仕様 | `tests/browser3d.mjs` |

### 0.2 確認結果（このスナップショットで実行）

| コマンド | 結果 | 失敗の内容 |
|---|---|---|
| `npm run test:game` | 54 件中 44 pass（30 分前は 37 pass。別セッションが修正中） | 残り 10 件は `recipes.test.js` / `objects.test.js` の一部。旧 3 ステージ構成（`STAGES[2]`、リビングの `stairs`）や「長押しで fixed」を前提にしている |
| `npm run check:pure` | OK | — |
| `npm run test:browser`（2D） | 27 件中 25 pass | 「outlet を長押しで fixing/fixed」の 2 件。v3 で長押し対策は廃止済みなのでテストが古い |
| `npm run test:browser3d` | 34 件中 30 pass | 同上 4 件（fixing、進捗リング、fixed、緑化）。それ以外の 3D 固有チェックはすべて通過 |
| `sim/out/assert.json`（21:30 の `--fast`） | errors 0。optimal 全クリア、noop は失敗側 | 目標範囲の判定は `npm run sim:assert` で再確認 |

### 0.3 その他の気づき

- **git にコミットが 1 件も無い**。フェーズ2 の受け入れ条件「`src/game/` がフェーズ1 完了時点から変更されていない（git diff）」の基準点が作れない。
- README の「遊び方」表と「ディレクトリ」説明が v2 のまま（長押しで塞ぐ、3 ステージ、リビング）。人に遊ばせる前に v3 へ更新が必要。
- `main.js` の `audioNameFor` に `click` が無い（入力イベントは effects を通らないため）。`bgm_bored` はどこからも開始されない。
  `drop` `trashed` `stored` `toy_merged` `recipe_ng` `heavy_nudge` `no_toy` に音が無い。
- 合成 BGM は `setInterval` 駆動。タブ非表示時にタイマーが間引かれて拍が崩れる。

---

## 1. ステップ0：着手前の土台（目安 0.5 日）

フェーズ2 の作業を安全に進めるための前提。**3D・音より先に済ませる。**

| # | 作業 | 完了条件 |
|---|---|---|
| 0-1 | 別セッションの編集が落ち着いたのを確認し、**初回コミット**を作る。`src/game/` の状態にタグ `phase1-logic` を打つ | `git log` にコミットがあり、`git diff phase1-logic -- src/game/` が空 |
| 0-2 | 旧テストの v3 追随（**`tests/browser3d.mjs` は 22:05 に別セッションが v3 化済み**。残りを確認）：`tests/game/recipes.test.js` `objects.test.js` の 10 件（`STAGES[2]` → 2 ステージ、長押し fixed → goods ドラッグで fixed、`stairs` は双子ステージ）。`tests/browser.mjs` `tests/browser3d.mjs` の「outlet 長押し」ブロックを **goods（cover）→ outlet のドラッグで fixed** に書き換え、`stairs` 早期リリースの確認は削除 | `npm run test:game` 全 pass、`test:browser` `test:browser3d` 全 pass |
| 0-3 | README の「遊び方」「ディレクトリ」「テスト」を v3（キッチン→双子、ドラッグ中心、容れ物・高い場所）に更新 | 記述が `docs/CONTRACT.md` §9 と一致 |
| 0-4 | `npm run sim:assert` を通して現在値を記録（`sim/out/assert.json`） | exit 0（外れる指標があればチューニングはユーザー判断で別課題） |

---

## 2. A：3D 移植の残作業

### A-1 v3 パリティの確認（別セッションの作業を引き継ぐ。目安 0.5 日）

2D（`Canvas2DRenderer.js`）にあって 3D に必要な表現。実装済みかを **実機（`npm run dev` → `?mode=3d`）で目視** し、無いものだけ足す。

| 表現（2D の実装） | 3D での表し方 | 状態 |
|---|---|---|
| 蓋つきゴミ箱（`_drawBin` / `_drawLid`、`lidpop`） | バケツ＋蓋グループ。ヒント中に脈打って持ち上がる、捨てた直後にぱたん | 実装中（`ObjectView.isBin` `lidGeo`） |
| 高い場所のヒント（`hintWalls`、「↑ 高い場所へ」） | highPlace の wall 上面にヒント板（emissive 脈動）＋ Sprite 文字 | 実装中（`w.hint`） |
| 収納済み hazard（`_drawStored`：小さく灰色＋✅、収納先の上に） | 縮小 0.7・灰色マテリアル・✅、`storedIn` が object なら `BOX_H`、wall なら `WALL_H` の高さに置く | 実装中（`setStored` `STORED_SCALE`） |
| 重い家具の台座と鍵（`_drawLock`、`heavyShadow`） | 台座（濃い円盤）＋鍵 Sprite（`lockTex`）。fixed で鍵を消す | 実装中 |
| 捨てた／片付けた絵文字が飛ぶ（`trashed` `stored`） | 絵文字 Sprite が from → to へ 0.3 秒の弧（`flies`） | 実装中 |
| 「動かない」揺れ（`heavy_nudge` → `nudge`） | x 方向の小さな揺れ | 実装中 |
| ドロップ地点のリング（`_drawDropRing`、`drop`） | 床に薄いリングが広がって消える | **未確認**（3D の `fx.start('drop')` は無かった） |
| 進捗リング（`fixing`） | v3 で廃止。3D 側の `showRing`/`hideRing` と `state.press` 参照は取り上げ用（BabyView）だけ残し、ObjectView 側は削除してよい | 要整理 |

完了条件：`docs/CONTRACT.md` §8.3 のログ表に出る全 effect について、2D と 3D の両方で 1 秒以内に盤面上の変化がある（表を上から手動で確認）。

### A-2 見た目の仕上げ（目安 0.5 日）

- **Sprite の深度**：ラベル・✅・あきた は `depthTest:false` で常に手前。壁の陰に隠れる場所（カウンター奥のケトル・包丁）で読めるか確認。隠れるなら wall label のみ `depthTest:true` を維持し、それ以外は現状維持で可。
- **カメラ**：60° 固定は維持。`CAM_MARGIN` と `topInset` で HUD 帯・右のログ列と重ならないことを 1280×800 / 1920×1080 / 1366×768 で確認。
- **照明・影**：`PCFSoftShadowMap` 2048。プレゼン PC で重ければ 1024 に落とす（A-4 の計測後に決める）。
- **床・壁**：床テクスチャは Canvas 生成のまま。壁は `BoxGeometry` に kind 色。glb（`counter` 等）が入れば差し替わる。
- **合成 toy**：金色グローリングは実装済み。`fixedModel` 無しの light hazard（ケトル・包丁・洗剤）は「収納済み」の縮小表示で十分なので `*_fixed.glb` は不要（素材リストから外す）。

### A-3 glTF パイプラインと素材受け入れ（目安 0.5 日 ＋ 素材待ち）

- **命名・寸法規約を README に明記**：モデル名は `stages.js` の `model` / `fixedModel`（下の表）。単位は任意（`fitModel` が幅 36・高さ 36・奥行 36 の箱に収める。壁は wall の w×h、高さ 80）。原点は底面中央でなくてもよい（`fitModel` が補正）。Y-up、glb（バイナリ）1 ファイル、テクスチャ埋め込み。
- **赤ちゃん**：`baby.glb`。クリップ名 `crawl` `idle` `stun` `play`（`fuss` `held` は任意）。無いクリップは手続きアニメに落ちる（実装済み）。前方は +Z（`BabyView.facing`）。
- **検証スクリプト `npm run assets:check`（新規、`tests/assets-check.mjs`）**：`assets/models/*.glb` を Playwright（SwiftShader）で読み込み、頂点数・クリップ名・バウンディングを表で出す。1 モデル 5,000 ポリゴン超と、`baby.glb` に `crawl`/`idle` が無い場合は警告。Node 単体では GLTFLoader が動かないためブラウザ経由にする。
- **受け入れ条件「glb を 1 つ置くとそのモデルだけ差し替わる」の自動化**：テスト内で最小の glb（1 三角形）を生成して一時 `assets/models/ball.glb` としてビルド出力にコピーし、`[three] loaded model ball.glb` のログと `objects.get('ball').model != null`、他のオブジェクトは箱のままであることを確認する。

**素材の優先順位（人間側の作業）**。プレースホルダーで遊べるので、効果の大きい順に置く。

| 優先 | モデル名（`assets/models/<name>.glb`） | 備考 |
|---|---|---|
| 1 | `baby` | 見た目への影響が最大。クリップ `crawl` `idle` `stun` `play` |
| 2 | 壁・家具 6：`counter` `island` `fridge` `sofa` `tv_stand` `shelf` | 部屋の印象を決める。天面は平らに（高い場所に物を置く） |
| 3 | 重い危険と対策後 10：`outlet` `outlet_fixed` `drawer` `drawer_fixed` `trash` `trash_fixed` `stairs` `stairs_fixed` `table` `table_fixed` | `*_fixed` は「カバーが付いた」「ゲートが付いた」状態 |
| 4 | おもちゃ 7：`ball` `bear` `blocks` `spoon` `cloth` `music_blocks` `bear_tower` | 合成 toy 2 つは少し大きめに見せる（描画側で 1.15 倍） |
| 5 | 軽い危険・小物・容れ物 6：`kettle` `knife` `detergent` `battery` `grocery` `bin` | `*_fixed` 不要 |
| 6 | 安全グッズ 7：`cover` `lock` `tie` `trashlock` `gate` `guard` | 平たいタグ形状に寄せる（現在のプレースホルダーと同じ印象） |

置いたら README のライセンス欄に「生成手段／出典・ライセンス・確認日」を記入する（§9.3）。

### A-4 パフォーマンス（目安 0.5 日）

- 目標：プレゼン PC で **60 fps 付近**（§11）。計測手段が無いので `?debug=1` で右下に FPS・`renderer.info.render.calls`・三角形数を出す小さなオーバーレイを `main.js` に足す（3D/2D 共通）。
- 計測は素材が入った状態で行う。閾値を下回ったら順に：影の解像度 2048→1024、`MAX_DPR` 2→1.5、`PCFSoft`→`PCF`、Sprite の Canvas テクスチャ再生成（`makeTopTexture` を fixed 切替時に毎回作っている）をキャッシュ化、`setEmissive` をフレーム毎に全マテリアルへ書かず変化時のみ。
- 頂点数バジェット 10 万は `loadStage` でログ済み。超えたら Blender の Decimate（§9.3）。

### A-5 ビルドと配布（目安 0.2 日）

- `build:3d` の 500 KB 警告：`manualChunks` で `three` を別チャンクにするか `chunkSizeWarningLimit` を上げる（機能差はない）。
- 配布形態を README に：フェーズ1 = `dist/index.html` 1 ファイル、フェーズ2 = `dist-3d/` フォルダ（`assets/` を同梱、`file://` では glb の fetch が失敗するので `npx vite preview --outDir dist-3d` か任意の静的サーバで開く）。
- 3D 版を主配布にするかはユーザー判断（§6 参照）。

### A-6 3D のテスト更新（0-2 と同時に。目安 0.3 日）

22:05 時点で別セッションが `tests/browser3d.mjs` を v3（グッズ→コンセント、電池→ゴミ箱、ケトル→カウンター、包丁→引き出し、取り上げ）に書き換え済み。以下は **不足分の確認リスト** として使う。

`tests/browser3d.mjs` に追加する v3 チェック：cover→outlet ドラッグで fixed＋`fixedModel`/緑化、kettle→counter（highPlace）で `setStored` の見た目（縮小・高さ `WALL_H`）、battery→trash で `flies` が発生し蓋が上がる、blocks×drum の合成で新 toy の view が生成される、重い `drawer` を引っ張って `nudge` が走る。スクリーンショットは `3d-*.png` を継続。

---

## 3. B：サウンドの残作業

### B-1 方針

- `IAudio` の形（`init / play(name) / startBgm / stopBgm / setMuted / isMuted`）は変えない。**レイヤー BGM 用に `setBgmLayer(name, on)` を 1 つ追加**する（`SilentAudio` は空実装）。
- 「どの effect でどの音か」を `main.js` から **`src/audio/cues.js`** に分離し、2D 版でも将来同じ表を使えるようにする。
- ゲームロジックには一切触れない（音は effects と入力イベントから導く）。

### B-2 キューの対応表（`src/audio/cues.js`）

§9.2 の 10 音は維持し、v3 で増えた出来事に 5 音を追加する（合成音は必ず用意。ファイルは任意）。

| effect / 入力 | cue | 備考 |
|---|---|---|
| 入力 `dragStart`、赤ちゃんへの `pressStart` | `click` | 入力は effects を通らないので `main.js` の `onEvent` ラッパで鳴らす。物への `pressStart` は何も起きないので鳴らさない |
| `fixed`（via 長押し/goods/high/store） `removed`（item） `stored` | `fix_done` | `recipe_ok` の fix 型は同時に `fixed` が出るので鳴らさない（現状通り） |
| `play_done` `recipe_ok`(toy) | `play_done` | |
| `hiyari` | `hiyari` | 低め。`combo_hiyari` は同時に出るので追加音なし |
| `combo_warn` active | `combo_warn` | inactive は無音 |
| `pickup` | `pickup` | |
| `fuss_start` | `fuss` | |
| `respawn` | `respawn` | |
| `stage_clear` / `stage_fail` | `clear` / `fail` | BGM を止めてから鳴らす（B-3） |
| **`drop` `takeaway`** | **`drop`（新）** | 柔らかい短い「ぽと」。ノイズバースト＋低いサイン |
| **`trashed`** | **`trash`（新）** | 蓋の「かたん」 |
| **`toy_merged`** | **`merge`（新）** | きらきらの上昇アルペジオ。`recipe_ok`(toy) の `play_done` と重なるので `play_done` 側を省く |
| **`recipe_ng`** | **`ng`（新）** | 短くくぐもった 1 音。責めない音 |
| **`heavy_nudge`** | **`nudge`（新）** | 低い「ごと」。鳴りすぎるので 300 ms のクールダウン |
| `no_toy` active | （無音のまま） | HUD アイコンとログで足りる。`bgm_bored` レイヤーが担う |
| `bored` `unbored` `fuss_end` `sat_delta` `play_start` `screen` | 無音 | |

### B-3 `WebAudio` の拡張（目安 1 日）

| # | 作業 | 完了条件 |
|---|---|---|
| B-3a | **クールダウンと同時発音上限**：同名 cue は 80 ms 以内の再発を捨てる（`nudge` は 300 ms）。同時再生ソース上限 8、超えたら最古を止める | 双子ステージで `random` 相当の連打をしても音が濁らない |
| B-3b | **BGM レイヤー**：`bgm_main` に `bgm_bored` を重ねる。`main.js` が毎フレーム `babies.some(b => b.satLow)` を見て変化時に `setBgmLayer('bgm_bored', on)`。gain は 0.5 秒でフェード | 満足度が 40 を割ると 1 秒以内にレイヤーが聞こえ、戻ると消える |
| B-3c | **BGM のフェードと結果画面**：Play 開始で 0.5 秒フェードイン、Play 終了で 0.3 秒フェードアウトしてから `clear`/`fail`。Loading/Tutorial は無音（現状通り） | 結果画面で BGM と `clear` が被らない |
| B-3d | **ダッキング（任意）**：`hiyari` の瞬間 BGM を −6 dB に落として 0.6 秒で戻す | ヒヤリ音が埋もれない |
| B-3e | **合成 BGM のスケジューラ**：`setInterval` を AudioContext 時刻ベースの先読み（100 ms 間隔で 200 ms 先まで予約）に置き換える。`visibilitychange` で `ctx.suspend()/resume()` | タブを裏にして戻しても拍が崩れない |
| B-3f | **読み込みの前倒し**：AudioContext は初回クリックまで作らないが、`fetch` の arrayBuffer だけは Loading 中に先読みして `init()` 後にデコードする | 初回の効果音がファイル版で鳴る（現状は初回クリック直後は合成音になり得る） |
| B-3g | `EXTS` に `wav` を追加（テスト用の生成ファイルに使う） | B-6 の自動テストが通る |
| B-3h | 合成音の追加：`drop` `trash` `merge` `ng` `nudge`。ノイズ系は `AudioBuffer` に白色ノイズを書いて短い減衰をかける | 全 cue が合成音で鳴る |

### B-4 音量バランスと基準

- マスター 1.0、効果音 0.08〜0.18（現状値）、BGM 0.07（合成）／0.35（ファイル）。ファイル素材が来たら **ラウドネスを −16 LUFS 付近に揃えて**書き出す（ElevenLabs / Freesound の素材は音量差が大きい）。
- 「toy-like, soft, not scary」。`hiyari` `fuss` は低めで短く、驚かせない（§4.7 の表現原則）。

### B-5 素材（人間側の作業）

`assets/audio/<name>.mp3`（または .ogg）。既存 12 に新規 5 を加えた 17 ファイル。優先順：`bgm_main` → `hiyari` `play_done` `fix_done` → `click` `drop` `trash` → 残り。
README の素材表と `IAudio.js` のコメントに新 cue を追記し、ライセンス欄に記入する。

### B-6 サウンドのテスト（目安 0.3 日）

Playwright（`tests/browser3d.mjs` に追加、または `tests/audio.mjs` を新設）：

- 初回クリック前に `__audio.ctx` が無い（既存）。
- `__audio.play` を spy で包み、cover→outlet ドラッグで `fix_done`、ドラッグ開始で `click`、ゴミ箱へ捨てて `trash` が呼ばれる。
- 満足度を直接 30 に落として `bgm_bored` レイヤーの gain が上がる。
- テストで生成した無音の `bgm_main.wav` を置いて `[audio] loaded bgm_main.wav` が出る（受け入れ条件「ファイルを置くと差し替わる」の自動化）。
- ミュート中は `play` が何も生成しない（`ctx` の `createBufferSource` 呼び出し数で確認）。

---

## 4. 受け入れ条件（§11 フェーズ2）との対応

| 条件 | 確認手段 | 状態 |
|---|---|---|
| `assets/` が空でも全ステージがプレースホルダーで遊べる | `test:browser3d`（次ステージ構築の確認あり） | 済 |
| glb を 1 つ置くとそのモデルだけ差し替わる | A-3 の自動テスト＋実素材で目視 | 未（自動化なし） |
| 音声ファイルが無くても合成音が鳴り、ファイルを置くと差し替わる | B-6 | 前半済・後半未 |
| 3D 上でも toy のドラッグが床平面上で機能する | `test:browser3d`「landed near the drop point」 | 済 |
| ミュートが機能し、初回クリック前に音が鳴らない | `test:browser3d` | 済 |
| `src/game/` がフェーズ1 完了時点から変更されていない | `git diff phase1-logic -- src/game/` | 未（0-1 が前提） |
| プレゼン用 PC で 60 fps 付近 | A-4 のオーバーレイで実機計測 | 未 |
| （追加）§8.3 の全 effect に 3D でも 1 秒以内の表現がある | A-1 の手動表 | 進行中 |
| （追加）双子ステージで音が濁らない・鳴りすぎない | B-3a、人間の試行 | 未 |

---

## 5. 実施順と目安

```
Step0 土台（0.5日）
  └→ A-1 v3 パリティ確認（0.5日・別セッションの成果を引き継ぐ）
  └→ B-2 cues.js 分離 + B-3 WebAudio 拡張（1日）      ← A と並列可
        └→ A-2 見た目 + A-4 計測（0.5日）
        └→ A-6 / B-6 テスト（0.5日）
              └→ A-3 素材受け入れ（素材が届き次第。検証スクリプトは先に作る）
                    └→ A-4 チューニング、A-5 配布、README ライセンス欄（0.5日）
                          └→ 人間の試行 1〜2 回（§13.6）→ 音量・演出の微調整
```

合計 3〜3.5 日＋素材待ち（仕様 §10 の「3〜4 日」と整合）。A と B は独立なので 2 セッションで並列にできるが、`main.js` と `tests/browser3d.mjs` は両方が触るため、先に B（`cues.js` と `onEvent` ラッパ）を `main.js` に入れてから A の計測オーバーレイを足す順にする。

---

## 6. 決めてほしいこと（ユーザー判断）

1. **`bgm_bored` を入れるか**（§12 で任意）。推奨：入れる。合成の軽いレイヤーで足り、満足度低下を耳で伝えられる。
2. **新規 5 cue（`drop` `trash` `merge` `ng` `nudge`）の採用**。採用なら `IAudio.js` のコメント・README・CONTRACT に追補として書く。
3. **主配布を 3D 版にするか**。2D 単一ファイル版は保守を続ける（sim と同じロジック、軽い、`file://` で開ける）。
4. **素材生成ツールとライセンス**（Meshy / Tripo / ElevenLabs / Freesound）。社内利用に留めるか、公開を見据えて CC0 に限定するか。
5. **旧テスト 10 件の扱い**：別セッションが直し切っていれば不要。残っていればステップ 0-2 で対応。
