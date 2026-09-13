# CLAUDE.md

ベビーセーフ・ルーム — 家庭内事故（起きて動いている赤ちゃんの事故）の予防知識を遊びながら得る
トップビュー・シミュレーションゲーム。Vanilla JS + Vite、TypeScript は使わない。

このファイルは Claude Code 向けの作業ガイド。**仕様の正典は次の2つ**で、迷ったらこちらを読む：

| ドキュメント | 役割 |
|---|---|
| [baby_safe_spec.md](baby_safe_spec.md) | 元仕様書 v3.3（企画・ゲームルール・教育コンテンツ・受け入れ条件・シミュレーション §13） |
| [docs/CONTRACT.md](docs/CONTRACT.md) | **モジュール間契約（382行）。実装の最新の正。v2〜v5 の追補 §8〜§11 が仕様書を上書きしている** |
| [docs/PHASE2_PLAN.md](docs/PHASE2_PLAN.md) | 2026-09-12 時点のスナップショット。**「未実装」の記述の多くは既に完了済み。現状把握には使わない** |
| [sim/README.md](sim/README.md) | ヘッドレスシミュレータの詳細 |
| [assets/audio/README.md](assets/audio/README.md) | 音声素材の置き方 |

仕様書と CONTRACT が食い違う場合は **CONTRACT が正**（長押しでの対策廃止、3ステージ→2ステージ など）。

---

## 起動・ビルド

```bash
npm install
npm run dev            # http://localhost:5173  （?mode=3d で Three.js 描画層、?seed=123 で乱数固定）
npm run build          # フェーズ1：dist/index.html 1ファイル。ブラウザで直接開ける
npm run build:3d       # フェーズ2：dist-3d/（three.js + assets/ を同梱）
                       # 確認は npx vite preview --outDir dist-3d （file:// では glb の fetch が失敗する）
```

対象環境は PC の Chrome 最新、マウス操作のみ。

## テスト・検証

> **Windows の既定シェル（cmd.exe / PowerShell）では `npm run test:game` と `npm run check:pure` が正しく動かない。**
> 下の「Windows での落とし穴」を必ず読むこと。

```bash
node --test tests/game/*.test.js     # ゲームロジックのユニットテスト 75件（Git Bash から）
npm run test:browser                 # Playwright：2D をビルドして実クリック・ドラッグで確認 → tests/screenshots/
npm run test:browser3d               # 同上、3D（--use-angle=swiftshader でソフトウェア WebGL）
npm run sim:assert -- --fast         # 難易度指標の簡易判定（n=60/セル）
```

`npm run test:browser` は毎回 `vite build` から走る。ビルド済みなら `-- --no-build` で省略できる。

## シミュレーション（難易度調整）

`src/game/` を Node 上で `dt = 1/60` 固定で回し、ボット5種で難易度を数値化する。
**人間に遊ばせる前に、ここで指標を目標範囲に入れる**（仕様書 §13）。

```bash
npm run sim -- --stage 1 --bot optimal --n 1000       # → sim/out/1-optimal.json
npm run sim -- --stage all --bot all --n 300 --workers 4
npm run sim -- --stage 2 --bot human_like --n 200 --tuning '{"BABY_SPEED":60}'
npm run sim:assert                                    # §13.3 の全指標を判定。1つでも外れると exit 1
npm run sim:tune -- --workers 6                       # 5変数 × 3水準 = 243条件のスイープ
```

- ボット：`noop`（下限）/ `optimal`（上限）/ `intervene_only` / `random`（例外ファザー）/ `human_like`（**主指標**）
- `--stage` は1始まり（`1`=キッチン、`2`=双子、`1,2`、`all`）、`--seed` 既定1、`--tuning` は `TUNING` にマージ
- `sim:assert` は指標に加えて **`random` × 1000回の例外ゼロ・最大フレーム < 50ms・同一シード2回の結果一致** も検証する
- 指標が通らないとき **勝手に目標範囲を緩めない**。仕様書 §13.4 の手順に従い、通る条件が無ければ人間に報告する

## アーキテクチャ

3層 + DI。依存は一方向（描画/音声 → ゲーム。**逆向きの依存は無い**）。

```
src/main.js          DI とループ（requestAnimationFrame、dt は最大 1/20 秒にクランプ）
  ├─ src/game/       ゲームロジック（純粋）  ← 何にも依存しない。両フェーズで同一ファイルを共有
  ├─ src/render/     IRenderer 実装  canvas2d/（フェーズ1） three/（フェーズ2）
  ├─ src/audio/      IAudio 実装  webaudio.js（合成音・manifest があればファイル再生） silent.js
  ├─ src/ui.js       HTML の HUD・各画面（Title/Loading/Tutorial/Result）
  └─ src/input.js    マウス → 入力イベント（bots も同じイベント形式を発行する）
sim/                 ヘッドレス（src/game/ だけを Node で駆動）
tests/               ユニット（node:test）と Playwright
assets/models/       glb 置き場      assets/audio/  効果音・BGM 置き場（無ければプレースホルダーで動く）
```

**毎フレーム**（`src/main.js` の `frame()`）：
`game.update(dt)` → 返った effects を `renderer.playEffect` / `ui.onEffect` / `audio.play` の3方向へ配る →
`renderer.update(state, dt)` → `ui.update(state)`。

**2D/3D の切り替え**は3経路：ビルド時 `GAME_MODE=3d`（vite define の `__GAME_MODE__`）、
実行時 `?mode=3d`（dev サーバか 3d ビルドのときのみ）、3D 層は動的 `import()` で読み、
失敗したら `console.warn` して Canvas2D にフォールバックする（2D 単一ファイルビルドに three を混ぜないため）。

**座標系**は両レンダラとも 800×540 のゲーム平面（`ROOM`）。`new Renderer({ topInset: 60 })` で HUD 帯分の
上インセットを受け取る（`main.js` の `HUD_BAND_PX` と CSS の `--hud-h` が同値）。

### src/game/ の各モジュール

| ファイル | 責務 |
|---|---|
| `state.js` | 状態機械の中心。`createGame()` が `state` と `update / dispatch / input / startStage` を返す |
| `stages.js` | ステージ定義データ（`STAGES` `ROOM` `ALL_COMBOS` `ALL_RECIPES` `MERGED_TOYS`）と全難易度定数 `TUNING` |
| `baby.js` | 赤ちゃんの毎フレーム更新。目標選択・移動・接触・遊び・口に入れる・ソファ登り・ぐずり・介入（最大 814行） |
| `objects.js` | 実行時オブジェクト生成、幾何ヘルパ（`isWalkable` `snapToFloor` `dist`）、再発・飽き解除 |
| `visitors.js` | おじさん（path をたどり item を落とす・乱数不使用）と猫（rng で床の軽い物を運ぶ） |
| `drop.js` | `dragEnd` のドロップ先判定。**レシピ → 容れ物 → 高い場所 → recipe_ng → 床** の順で最初に成立したものを適用 |
| `recipes.js` | `fix`（グッズ→危険）/ `store`（軽い危険→収納先）/ `toy`（おもちゃ合成）の3種 |
| `combos.js` | 組み合わせ危険。`stage.combos` に明示列挙されたものだけを見る（動的生成しない） |
| `scoring.js` | スコア・クリア/失敗判定（`judge`）・ヒヤリ計上・介入ペナルティ |
| `log.js` | effect → できごとログの日本語文言（`describeEvent`）。`state.log` に最大200件 |
| `edu.js` | 教育カードと豆知識。**`verified:false` の豆知識は `pickTip` が除外する** |
| `rng.js` | `createRng(seed)`（mulberry32）と `weightedPick`。26行だが決定論性の要 |

### 状態と更新

`state.screen` は `title | loading | tutorial | play | stageResult | finalResult`。形は CONTRACT §5。
`state.mode` は `campaign`（Title の「はじめる」→ Tutorial → 全ステージ通し）か `single`（Title のステージ選択 →
そのステージだけ → FinalResult → Title）。`single` では `next` が次ステージへ進まない（CONTRACT §2）。

- `update(dt)` が唯一のエントリポイント。`play` 以外は effects を空で返す（`loading` だけ `loading.elapsed` を進める）
- `play` 中の順序：`elapsed += dt` → 長押し → オブジェクト（再発/飽き解除）→ **訪問者** → `noToy` 判定 →
  **全赤ちゃん** → `noToy` 再判定 → `satLowTime` 加算 → `judge()` → ログ追記
- `dispatch()` / `input()` 由来の effects は即座には返らず `pending` に積まれ、**次の `update()` の先頭で**返る
- テスト/sim は `game.startStage(index, { skipLoading: true })` で Loading を飛ばせる

---

## 守るべきルール

### 決定論性（最重要）

1. **`src/game/` で `Math.random` / `Date.now` / `performance` / DOM / Canvas / THREE を一切使わない。**
   乱数は必ず `createGame({ rng })` で注入された rng を使う。時計は `state.elapsed`（秒）のみ
2. 新しいランダム要素を足すときは `TUNING` に定数を追加し、注入 rng 経由にする（CONTRACT §9.5）
3. **`rng()` の呼び出し順序・回数が変わると既存シードの結果が変わる。**
   条件分岐の中で rng を呼ぶ位置を動かすだけで sim の全数値がずれる
4. 逆に、**描画層では `Math.random` を使ってよい**（`src/render/canvas2d/effects.js` に「決定性が要らない演出専用」と明記）

### レンダラ非依存

5. 描画層は `gameState` を**読むだけ**。state への代入は 2D/3D とも皆無。演出用の派生状態はレンダラ自身が持つ
6. state から毎フレーム導出できるもの（`combo_warn` `sat_delta` `no_toy` `stage_*`）は `playEffect` に頼らない。
   `playEffect` は「その瞬間に一度だけ起きたこと」専用
7. **state からの判定ロジックは [src/render/hints.js](src/render/hints.js) に集約する**（両レンダラが共有。
   片方だけに書くと 2D/3D で挙動がずれる）
8. 3D は「判断は `ThreeRenderer`、見た目の setter は `*View`」の分担。
   ラベルは Sprite ではなく [src/render/three/labels.js](src/render/three/labels.js) の DOM レイヤー（`LabelLayer`）。
   `DomLabel` は `Object3D` なので従来どおり group に add でき、`.visible` / `.position` / `.material.opacity` がそのまま効く。
   投影は `renderer.render()` の**後**（ワールド行列確定後）に `labelLayer.update(camera)` で行う
8b. glb が無いときの形は [src/render/three/shapes.js](src/render/three/shapes.js) のプロシージャル形状。
   `SHAPES` はオブジェクト id（= `model` 名）で引く。`assets/models/<model>.glb` を置けば `setModels` が自動で上書きする
9. HUD は描画層の責務ではない（`showOverlay` は両実装とも空）。`topInset`（60px）は必ず尊重する

### データ・命名

10. ステージ／オブジェクト定義の追加は `stages.js` のファクトリ関数経由。
    `draggable = weight === 'light'` は自動導出なので手で書かない
11. `kind` は `hazard | item | toy | goods | container | prop` の6種。`state` の取りうる値は kind ごとに違う
    （hazard/item: `open|fixed|removed`、toy: `available|bored|removed`、goods: `available|used|removed`）
12. **新しい effect type を足したら4か所を更新する**：`log.js` の `describeEvent`、`main.js` の `audioNameFor`、
    2D の `playEffect`、3D の `playEffect`
13. 教育コンテンツ（`edu.js`）は**実装者が追加・変更しない**。出典未確認のものは `verified: false` にする
14. `TUNING` の変更は理由と sim の根拠をコメントで残す

---

## 落とし穴

### Windows での落とし穴（実測確認済み）

- **`npm run test:game` は cmd.exe / PowerShell では 0件しか走らず「静かに成功」する。**
  `node --test 'tests/game/**/*.test.js'` のシングルクォートが剥がされないため。
  **Git Bash から `node --test tests/game/*.test.js` を使うこと**（75件 pass）
- **`npm run check:pure` は `grep` に依存するため cmd.exe では落ちる。**
  Git Bash から実行する。**純粋性チェックは自動では効いていないと思って扱うこと**

### コード上の落とし穴

- **`highPlaceCount` / `isHighPlaceFull` が [src/game/objects.js](src/game/objects.js#L178) と
  [src/render/hints.js](src/render/hints.js#L84) に重複実装されている。**
  片方だけ直すとゲーム判定と描画ヒントが食い違う（「置けるように光っているのに置けない」）
- **`dispatch()` / `input()` の effects は即座に返らない**（次の `update()` の先頭で返る）。
  ドラッグ直後に `update` を回さないとレシピ成立を取りこぼしたように見える
- **`update()` 内の処理順序に依存関係がある。** `noToy` は赤ちゃん更新の前後で2回判定され、
  訪問者は赤ちゃんより先に更新される（落とした item を同フレームで目標にできるように）。
  入れ替えると満足度経済と sim の指標が変わる
- **`boredUntil` が3つの意味で使い回されている**：(a) toy の飽き（`bored`/`unbored` effect あり）、
  (b) 登れる家具の飽き（effect なし）、(c) 口から手放した hazard/item の再取得防止（effect なし・`state` は `open` のまま）。
  (b)(c) を toy と同じに扱うと破綻する
- **`Raycaster` は `visible = false` のメッシュを飛ばす。** 当たり判定用の箱（`ObjectView.pickMesh`）を
  見た目だけ消すときは `visible` ではなく `_hideBoxKeepPicking()`（`colorWrite: false` のマテリアルに差し替え）を使う。
  `visible = false` にすると掴めなくなる
- **描画層は effect の取りこぼしに耐える設計にする。** `playEffect` の時点で state は更新済みなので、
  「直前の位置」が要る演出（転落）は前フレーム値を自前で保持する。リング系の表示は分母のフォールバックを必ず用意する
- `main.js` が `window.__game / __renderer / __ui / __input / __seed / __audio / __mode` を公開しているのは
  Playwright テストとデバッグのため。消さないこと

---

## 素材（人間側の作業）

ファイルが無くてもプレースホルダー（箱形状・合成音）で全ステージ遊べる。置くとそのファイルだけ差し替わる。

| 置き場所 | 内容 |
|---|---|
| `assets/models/<model>.glb` | `model` 名は `stages.js` の各オブジェクトの `model`（例 `outlet`）、対策後は `fixedModel`（例 `outlet_fixed`）、walls は `sofa` `tv_stand` `shelf` `counter` `island` `fridge`。Y-up、テクスチャ埋め込み、5,000ポリゴン以下 |
| `assets/models/baby.glb` | アニメーションクリップ名 `crawl` `idle` `stun` `play`（`fuss` `held` は省略可） |
| `assets/audio/<name>.mp3` + `manifest.json` | `click` `fix_done` `trash` `play_done` `merge` `hiyari` `combo_warn` `deny` `pickup` `fuss` `respawn` `mouth` `relief` `climb` `fall_safe` `visitor` `cat` `clear` `fail` `bgm_main` `bgm_bored` |

生成の指示は仕様書 §9.3（モデルは "low-poly, flat-shaded, toy-like, pastel colors"、効果音は "toy-like, soft, not scary"）。

### ライセンス表記欄

素材を追加したら、ここに出典・ライセンス・利用規約を確認した日付を記入する（仕様書 §9.3 / §10-16 の要件）。

| ファイル | 生成手段 / 出典 | ライセンス | 確認日 |
|---|---|---|---|
| （未追加） | | | |

教育カード・豆知識の出典は `src/game/edu.js` に文言ごとに併記している（公的資料の要約）。
`verified: false` の豆知識は出典確認が済むまで表示されず、起動時と `npm run test:browser` で警告が出る。
