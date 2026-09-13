# モジュール間契約（CONTRACT）

`src/game/`（ロジック）・`src/render/`＋`src/ui.js`＋`src/input.js`（表示・入力）・`sim/`（ヘッドレス）は
この文書の API と `gameState` の形だけを共有する。仕様書は `baby_safe_spec.md`（v3.3）。
既存ファイル：`src/game/rng.js`（`createRng(seed)`, `weightedPick`）、`src/game/stages.js`（`STAGES`, `TUNING`, `ROOM`, `ALL_COMBOS`, `baseSpeedFor`）、`src/game/edu.js`（`cards`, `tips`, `pickTip`, `unverifiedTips`, `DISCLAIMER`）。

## 1. ゲームの生成と駆動（`src/game/state.js`）

```js
import { createGame } from './game/state.js';
const game = createGame({ rng, stages = STAGES, tuning = TUNING });
game.state            // 下記 gameState。毎フレーム参照してよい（描画層は読み取りのみ）
game.update(dt)       // 秒。状態を進め、今フレームの effects 配列を返す（下記 §4）
game.dispatch(action) // UI からの画面遷移操作（§2）
game.input(event)     // マウス由来の操作イベント（§3）。bots も同じ形式を発行する
game.startStage(index, { skipLoading = true } = {})  // sim/テスト用：即 Play へ
```

- `dt` は秒。`src/game/` は `Math.random` / `Date.now` / `performance` / DOM / Canvas を一切参照しない。時刻は `state.elapsed`（ステージ開始からの秒）を時計として使う。
- `TUNING` はオブジェクトを渡すので、sim のチューニングは `createGame({ tuning: {...TUNING, BABY_SPEED: 60} })` のように上書きして行う。（v3：`FIX_SEC_MULT` は長押し廃止（§9.1）で削除。§13.4 の 5 番目の調整変数は `MOOD_SPEED_GAIN`）

## 2. dispatch アクション（画面遷移）

| action | 遷移 |
|---|---|
| `{type:'start'}` | Title → Loading（`loading.next = 'tutorial'`、stageIndex=0）。`state.mode = 'campaign'` |
| `{type:'selectStage', index}` | Title のステージ選択 → Loading（`loading.next = 'play'`、Tutorial は挟まない）。`state.mode = 'single'`。範囲外・Title 以外では無視 |
| `{type:'assetsReady'}` | Loading 中に描画層の `loadStage()` が完了したら main が送る。`loading.ready = true` |
| `{type:'tutorialOk'}` | Tutorial → Play(stage 0) |
| `{type:'next'}` | StageResult(clear) → Loading → Play(次) / 最終ステージなら FinalResult。`mode === 'single'` のときは次へ進まず FinalResult |
| `{type:'retry'}` | StageResult(fail) → Loading → Play(同じステージ) |
| `{type:'toTitle'}` | FinalResult / StageResult（または任意）→ Title。`totalScore`・`shownTipIds`・`mode` をリセット |

`state.mode`：`'campaign'`（はじめから通し）/ `'single'`（Title で選んだ 1 ステージだけ）。Title は「はじめる（さいしょから）」と全ステージのボタン（`.btn-stage[data-stage-index]`）を出す。StageResult・FinalResult には常に「タイトルへ」を置き、クリア後は Title に戻れる。

Loading は `update(dt)` で `loading.elapsed` を進め、`elapsed >= tuning.LOADING_MIN_SEC && ready` になったら自動で `loading.next` へ遷移する。
Loading に入った瞬間、`pickTip(rng, state.shownTipIds)` で `state.tip` を選ぶ。Tutorial 用の tip は `state.tutorialTip`（Loading→Tutorial 遷移時に別途 pick）。

## 3. input イベント（`input.js` と bots が発行）

```js
{ type:'pressStart', targetId }      // 長押し開始。targetId は object.id または baby.id
{ type:'pressEnd' }                  // 離した／カーソルが対象から外れた
{ type:'dragStart', targetId, x, y } // ドラッグ開始（toy または baby）。x,y はゲーム座標
{ type:'dragMove', x, y }
{ type:'dragEnd', x, y }
```

ゲーム側の解釈：
- `pressStart`
  - hazard/item で `state=='open'` → `state='fixing'`、`progress` が `dt / (fixSec*FIX_SEC_MULT)` で増える。`pressEnd` で `progress=0, state='open'`。1.0 で hazard→`fixed`（effect `fixed`）、item→`removed`（effect `removed`、`respawnSec` があれば `respawnAt = elapsed + respawnSec`）
  - toy（床にあり `carriedBy==null`）→ 同様に `progress` を進め、完了で `state='removed'`（effect `removed`）
  - baby で `carrying != null` → 取り上げ長押し。`state.press = {targetId: babyId, elapsed, needSec: TAKEAWAY_HOLD_SEC}`。完了で「取り上げ」（§3 仕様）。`carrying==null` なら無視
  - 対象が無効なら無視（`state.press = null`）
- `pressStart` 中は `state.press = { targetId, elapsed, needSec }` を公開する（描画層は `object.progress` または `press.elapsed/needSec` でリング描画）
- `dragStart` toy：床にある toy（`carriedBy==null`、`state!='removed'`、遊ばれていない）のみ。`state.drag = {targetId, x, y}`。`dragMove` で toy の x,y を追従。`dragEnd` で `walls` 内なら最寄り床にスナップ、`draggedAt = elapsed`、全赤ちゃんが目標を再選択する（実装者判断：ドラッグ直後の重みを実効化するため）。ドラッグ中の toy は目標候補から除外する
- `dragStart` baby：`isHeld=true, anim='held'`、介入ペナルティ（下記）。`dragMove` で x,y 追従（`carrying` の toy も追従）。`dragEnd` で床スナップ、`stunUntil = elapsed + STUN_SEC`（`anim='stun'`）、停止が明けたら `fussUntil = elapsed + FUSS_SEC` にしてぐずり開始（effect `fuss_start`）と目標再選択
- 介入ペナルティ：抱き上げ `PICKUP_SAT`(-15)、取り上げ `TAKEAWAY_SAT`(-20)。`elapsed - lastInterventionAt < INTERVENE_REPEAT_SEC` なら `× INTERVENE_REPEAT_MULT`。適用時に effect `pickup` / `takeaway`（payload.amount は負の数）と `sat_delta` を出す。`lastInterventionAt = elapsed`、`state.interventions++`。ぐずり中の再介入は `fussUntil` を `elapsed + FUSS_SEC` にリセット
- 取り上げ：toy を赤ちゃんの足元（床スナップ）に落とし `state='bored', boredUntil = elapsed + TAKEAWAY_BORED_SEC`、`carrying=null`、即ぐずり、目標再選択
- 赤ちゃんが持っている toy（`carriedBy != null`）への press/drag は無視する（描画層の pickObject が赤ちゃんを優先するので通常は来ない）

## 4. effects（`update(dt)` の戻り値）

`[{ type, objectId, payload }]`。main は各要素を `renderer.playEffect(type, objectId, payload)` と `ui.onEffect(type, objectId, payload)` と `audio` に配る。

| type | objectId | payload |
|---|---|---|
| `fixed` | hazard id | `{}` |
| `removed` | item/toy id | `{ kind }` |
| `respawn` | item id | `{}` |
| `hiyari` | 接触した hazard/item id | `{ babyId, x, y, count, combo: null \| {toy, hazard, ignoresFix, label} }` |
| `combo_hiyari` | hazard id | `{ babyId, label, ignoresFix, toyId }`（`hiyari` と同時に出す） |
| `combo_warn` | hazard id | `{ babyId, toyId, active: true\|false }`（接近開始で true、離れたら false） |
| `play_done` | toy id | `{ babyId, amount, playCount }` |
| `sat_delta` | baby id | `{ amount, x, y, reason: 'play'\|'pickup'\|'takeaway' }`（amount 正=緑、負=赤） |
| `bored` | toy id | `{ until }` |
| `unbored` | toy id | `{}` |
| `no_toy` | null | `{ active }`（遊べる toy が 0 になった/戻った瞬間だけ） |
| `pickup` | baby id | `{ amount }` |
| `takeaway` | baby id | `{ amount, toyId }`（v5：口の物を取り上げたときは `toyId` はその物の id、`mouth: true` を付ける） |
| `fuss_start` | baby id | `{ until }` |
| `fuss_end` | baby id | `{}` |
| `drop` | toy/object id | `{ babyId, reason: 'bored'\|'next_toy'\|'hiyari'\|'takeaway'\|'mouth'\|'pickup' }`（v5：`'mouth'` は口に入れ始めて持ち toy を落とした、`'pickup'` は抱き上げで口の物が落ちた） |
| `stage_clear` / `stage_fail` | null | `{ score, breakdown }` / `{ failAtSec }` |
| `climb_start` / `climb_end` / `climb_fall_safe` | 家具（climbable hazard）id | `{ babyId }`（v4 §10.1。転落でヒヤリのときは通常の `hiyari`、objectId=家具 id） |
| `visitor_enter` / `visitor_leave` | visitor id | `{ x, y }`（v4 §10.2）。`visitor_enter` は `visitorType`（`'uncle' | 'cat'`）も持つ |
| `visitor_drop` | 落とした item id | `{ visitorId, x, y }`（v4 §10.2。item は `state.objects` に追加済み） |
| `mouth_start` | 口に入れた object id | `{ babyId, until }`（v5 §11.1。`until` で飲み込む／手放すが決まる） |
| `mouth_release` | object id | `{ babyId }`（v5 §11.1。手放した。物は足元、`boredUntil` が立つ） |
| `hiyari`（口から） | object id | 通常の `hiyari` payload に `mouth: true`（v5 §11.1 / §11.4。物は接触地点に残る） |
| `high_full` | ドロップしたobject id | `{ into: wall.model, capacity }`（v5 §11.2。置けず、wall の手前の床へ通常ドロップされた） |
| `cat_take` | くわえた object id | `{ visitorId }`（v5 §11.5。`carriedBy = 'cat'`） |
| `cat_drop` | 置いた object id | `{ visitorId, x, y, babyId }`（v5 §11.5。`carriedBy = null`、全赤ちゃん再選択） |
| `screen` | null | `{ from, to }`（画面遷移。ui はこれで再描画してもよいし、毎フレーム `state.screen` を見てもよい） |

## 5. gameState の形

```js
state = {
  screen: 'title' | 'loading' | 'tutorial' | 'play' | 'stageResult' | 'finalResult',
  stageIndex: 0,                 // 0..1（v3：キッチン / 双子 の 2 ステージ）
  stage: { id, name, timeLimit, babies, babySpawns, walls, objects(定義), combos, recipes, eduCardId },
                                 //   walls[i] = { x, y, w, h, model, label, highPlace, capacity? }（highPlace:true は「高い場所」§9.3。capacity 省略時 TUNING.HIGH_PLACE_CAPACITY §11.2）
  objects: [ runtimeObject ],    // 下記。stage.objects の deep copy に実行時フィールドを足したもの
  babies:  [ runtimeBaby ],      // id は 'baby0', 'baby1'
  visitors: [ runtimeVisitor ],  // v4（§10.2）：{ id, type:'uncle'|'cat', label, emoji, x, y, dirX, dirY, active, done, dropped:[object id], carrying: object id|null }。
                                 //   v5：`type`（定義に無ければ 'uncle'）と `carrying`（猫がくわえている物。おじさんは常に null）を追加。ステージ開始ごとに作り直す
  elapsed: 0, timeLeft: 90,
  hiyari: 0, playCount: 0, interventions: 0, comboHiyari: 0,
  noToy: false,                  // 遊べる toy（state=='available' かつ carriedBy==null かつ非ドラッグ中）が 0
  allHazardsFixedAt: null,       // 全 hazard が fixed になった時の timeLeft（スコア用）
  press: null | { targetId, elapsed, needSec },   // v3：赤ちゃんの取り上げ長押しだけ（targetId は baby id）。オブジェクトには立たない
  drag:  null | { targetId, x, y },               // light（draggable）なオブジェクト、または赤ちゃん
  loading: { elapsed, ready, next },
  tip: null | { id, text, source }, tutorialTip: null | {...}, shownTipIds: [],
  result: null | { cleared, score, breakdown: { hiyariBonus, playBonus, timeBonus }, failAtSec, hiyari, playCount, eduCardId },
  totalScore: 0,
  satLowTime: 0                  // いずれかの赤ちゃんの satisfaction < SAT_LOW だった累計秒（sim 指標用）
}

runtimeObject = { ...定義, state, progress, respawnAt, boredUntil, draggedAt, playCount, carriedBy, playingBy, storedIn, spawnX, spawnY }
//  定義側（stages.js）：kind 'hazard' | 'item' | 'toy' | 'goods' | 'container' | 'prop'（v5 §11.3：ダミー。state 'available'|'removed'）、
//    toy は ingestible:true, riskLabel を持てる（v5 §11.4）、
//    weight: 'light' | 'heavy'、draggable = weight === 'light'（§9.2。container・heavy hazard は動かせない）、
//    container: true（容れ物。kind 'container'、または kind 'hazard' で container 付き＝キッチンのゴミ箱）、
//    合成 toy（MERGED_TOYS）は targetWeight（目標選択の base。旧 `weight` を改名。省略時 WEIGHT_TOY）と satPlay を持てる
//  hazard/item.state: 'open' | 'fixed' | 'removed'（v3：'fixing' は使わない。progress は常に 0 で互換のため残る）
//  toy.state:         'available' | 'bored' | 'removed' / goods.state: 'available' | 'used' | 'removed' / container.state: 'available'（不変）
//  carriedBy: baby id | 'cat' | null（持ち歩かれている間は x,y が赤ちゃんに追従。v5：口に入れている物（§11.1）と猫がくわえている物（§11.5）も立つ。
//             carriedBy != null の物はドラッグ不可・赤ちゃんの候補／接触対象外）
//  boredUntil（v5）: hazard/item にも使う。口から手放した／取り上げた後 TAKEAWAY_BORED_SEC の間、候補・接触から除外（state は 'open' のまま。effect なしで静かに null に戻る）
//  playingBy: baby id | null（3秒遊んでいる間）
//  storedIn:  null | object id（store レシピの相手。x,y はその相手に重なる）| wall.model（高い場所。x,y はドロップ点のまま wall の中）
//             v5：高い場所に `stored` した item/toy/goods/prop（removed）にも wall.model が入る（容量の計数用。respawn で床に戻ると null）。
//             描画層は `highPlaceCount(state, wall)`（`src/game/objects.js` から export）で n/capacity を得られる（fixed/removed で storedIn === wall.model のものを数える）
//  spawnX, spawnY: 定義位置。捨てた／片付けた item はここに再発する

runtimeBaby = {
  id, x, y, speed,               // speed は実効速度（基準 × max(moodMult, satLow/ぐずり倍率) × speedK）を毎フレーム書く（§9.5。立ち止まり中も「動くとしたら」の値）
  moodMult, speedK, pauseUntil, headingOff,
                                 //   moodMult: 1 + MOOD_SPEED_GAIN×((100−sat)/100)^2 / speedK: 速度ゆらぎ係数 MOVE_SPEED_K_MIN..MAX /
                                 //   pauseUntil: elapsed < pauseUntil の間は立ち止まり（anim 'idle'、ぐずり中は 'fuss'）/ headingOff: 直進からのオフセット角 rad（目標 60px 未満で 0 へ収束）
  targetId, carrying, carriedBoredAt,
  playUntil, stunUntil, satisfaction, fussUntil, lastInterventionAt,
  isHeld, holdProgress,          // holdProgress: 取り上げ長押しの 0..1（取り上げ中でなければ 0）
  anim: 'crawl' | 'idle' | 'stun' | 'play' | 'fuss' | 'held' | 'climb' | 'mouth',
  fussing: bool, satLow: bool,    // 描画の便宜用（fussUntil > elapsed / satisfaction < SAT_LOW）
  comboWarnHazardId: null | id,   // 予告中の hazard
  climbing: null | id,            // v4（§10.1）：登っている家具の id。登っている間は x,y が家具の壁の上、anim 'climb'、移動・接触なし
  climbUntil: 0,                  // 自分で降りる時刻（elapsed）。climbing == null のときは 0
  mouthing: null | { objectId, until } // v5（§11.1）：口に入れている物と判定時刻。間は移動・接触・満足度減衰なし、anim 'mouth'。
                                  //   取り上げ長押し（pressStart baby）は carrying だけでなく mouthing でも有効
}
// runtimeObject 追加（v4）：climbable:true の hazard は boredUntil（降りた／落ちた後 CLIMB_BORED_SEC の間、候補外。state は変えない）を使う
```

## 6. ルールの確定事項（仕様書の解釈）

- 接触判定は `dist(baby, object) < TOUCH_DIST`。hazard/item が `open` または `fixing` なら **ヒヤリ**。`fixed`/`removed` は安全。ただし `carrying` の toy と combo が成立し `ignoresFix:true` なら `fixed` でもヒヤリ。`ignoresFix:false` の combo は hazard が `open/fixing` のときにヒヤリになる（通常ヒヤリと同じだが `combo` 情報を付けて表示を変える）
- ヒヤリ時：`hiyari++`、赤ちゃんは自分の `babySpawns[i]` に戻り `stunUntil = elapsed + STUN_SEC`、`carrying` があればその toy を接触地点（床スナップ）に落とす（effect `drop`）。進行中の取り上げ長押しは解除。`hiyari >= 3` で失敗
- 遊び：`available` な toy に到達 → `playUntil = elapsed + PLAY_SEC`、`anim='play'`、toy.playingBy=babyId。完了で `toy.playCount++`、`amount = SAT_PLAY_BY_COUNT[min(playCount-1, 2)]`、ぐずり中なら `amount = min(amount, FUSS_PLAY_SAT)`、`satisfaction = min(100, +amount)`、`state.playCount++`、toy は `bored`（`boredUntil = elapsed + BORED_SEC_BASE + BORED_SEC_STEP*min(playCount-1,2)`）、以前の `carrying` があれば足元に落とし、新しい toy を `carrying` にして `carriedBoredAt = elapsed`
- 手放し：`carrying` の toy が bored になってから `DROP_AFTER_SEC` 経過でその場（床スナップ）に置く。目標再選択
- 満足度：各赤ちゃんごと。`noToy` なら `SAT_NO_TOY`/秒、そうでなく遊んでいない間は `SAT_IDLE`/秒。遊び中・isHeld 中は減らない。0..100 にクランプ
- 速度倍率：`satLow` なら `BORED_SPEED_MULT`、`fussing` なら `FUSS_SPEED_MULT`、両方なら大きい方（乗算しない）。hazard/item の重みも同様（`WEIGHT_HAZARD_BORED` / `FUSS_HAZARD_WEIGHT` の大きい方）
- 目標選択のタイミング：到達時／目標が候補でなくなった時／`STUCK_SEC` 秒間 8px 以上動いていない時／満足度が SAT_LOW を跨いだ時／抱き上げ解放（停止明け）／ぐずり開始・終了／toy のドラッグ終了／手放し・取り上げ後
- 候補：hazard/item（`open`/`fixing`）、toy（`available`、`carriedBy==null`、ドラッグ中でない、他の赤ちゃんの `targetId` でない）。さらに `carrying` の toy と `stage.combos` で combo が成立する hazard は、`ignoresFix:true` なら `fixed` でも候補になる。`w = base / (dist + 100)`。combo が成立する hazard（`open`、または `fixed`+`ignoresFix`）は `base` を `COMBO_ATTRACT` 倍する（「スプーンをコンセントに差したい」。§4.4 の学びを観測可能にするため）。候補なしなら `anim='idle'` で中央 ±60px を往復（速度 ×0.4）
- 移動：壁（`walls` の矩形を `BABY_RADIUS` だけ膨らませたもの）と部屋の外周に対して、フル移動→x のみ→y のみの順に試す。スタック時は目標再選択（同じ目標を選び直しても良いが、直前の目標は重みを半分にする）
- 床スナップ：`walls` 内なら矩形の最も近い辺の外側 `BABY_RADIUS+2` px へ。部屋の外周内（`16 <= x <= 784, 16 <= y <= 524`）にクランプ
- 再発：`respawnAt` に到達で `state='open'`、effect `respawn`。描画層は `respawnAt - elapsed <= RESPAWN_WARN_SEC` で予告点滅
- combo 予告：`carrying` の toy と combo が成立する hazard が存在し、その hazard との距離が `< COMBO_WARN_DIST` なら `comboWarnHazardId` を立て、立った瞬間に `combo_warn {active:true}`、外れた瞬間に `{active:false}`
- スコア：`max(0, 2 - hiyari) * 1000 + playCount * 200 + round(allHazardsFixedAt ?? 0) * 10`。`allHazardsFixedAt` は kind=='hazard' がすべて `fixed` になった瞬間の `timeLeft`
- クリア：`timeLeft <= 0 && hiyari < 3`。Play 中のみ進行し、`stageResult` などでは `update` は effects を空で返す（Loading だけは `loading.elapsed` を進める）
- 決定性：同じ seed・同じ入力列で同じ結果。`rng` はゲーム生成時のものだけを使う

## 7. 描画・UI 側の責務分担

- `src/render/canvas2d/`：部屋・walls・objects・赤ちゃん・因果表現のうち **盤面上のもの**（進捗リング、✅、toy 上の数字ポップ、zzz、combo 同期点滅、再発予告点滅、モヤモヤ、不機嫌アイコン、ヒヤリの黄フラッシュ、✅の揺れ）
- `src/ui.js`：HTML の HUD（残り時間／ヒヤリ ○○○／満足度バー（赤ちゃんごと）／ぐずり残秒バッジ／ステージ名／「あそべるものがない」アイコン／満足度バー横の数字ポップ）、Title / Loading / Tutorial / StageResult / FinalResult、combo ヒヤリの中央テキスト（1.5秒）。`ui.onEffect(type, objectId, payload)` と `ui.update(state)` を持つ
- `src/input.js`：`createInput({ canvasEl, renderer, onEvent })`。mousedown → `pickObject` で対象決定、toy/baby は 6px 以上動いたらドラッグ、それ以外は長押し（`pressStart`）。mousemove 中に `pickObject` が対象 id と異なれば `pressEnd`。mouseup で `pressEnd` / `dragEnd`。ボットも同じ event 形式を `game.input` に渡す
- 描画層は `toScreenCoords(x, y)`（ゲーム座標→クライアント座標）も実装する（Playwright テストが使う）。また `new Renderer({ topInset: 60 })` で HUD バンド分の上インセットを受け取り、部屋をその下に描く（`main.js` の `HUD_BAND_PX` と CSS `--hud-h` が同じ値）
- `src/main.js`：`__GAME_MODE__`（vite define、'2d' | '3d'）で描画層を選び（音声層は 2d/3d とも `WebAudio`。AudioContext が使えなければ `SilentAudio`）、`requestAnimationFrame` ループで `dt`（最大 1/20 秒にクランプ）を回し、`update` → effects 配布 → `renderer.update` → `ui.update`

## 8. 追補（v2）：安全グッズ・レシピ・できごとログ・飽き表示

ユーザー要望による追加。仕様書 v3.3 には無い。

### 8.1 kind `goods`（安全グッズ）

`stages.js` の `goods(id, label, emoji, x, y, forIds)`。`{ kind:'goods', draggable:true, for:[hazardId,...], state:'available'|'used'|'removed' }`。
- 赤ちゃんの目標候補にならず、接触判定もしない。長押しは無視（`pressStart` → 何もしない）
- ドラッグ可能（toy と同じ挙動：`state.drag` に載り、`dragMove` で x,y 追従、`dragEnd` で床スナップ）
- `pickObject` は toy と同様に拾う（赤ちゃん優先は変わらず）

### 8.2 レシピ（`stage.recipes`、`ALL_RECIPES`、`MERGED_TOYS`）

`dragEnd` 時、ドラッグしていた toy / goods（= A）から距離 `< tuning.DROP_COMBINE_DIST`（40）に別のオブジェクト B（removed/used でなく、`carriedBy==null`）があれば、`stage.recipes` から `{a,b}` が `{A.id, B.id}` に順不同で一致するものを探す。
- `type:'fix'`（goods → hazard）：B が `open`/`fixing` なら B を `fixed`（`progress=0`、`allHazardsFixedAt` の更新も通常の fixed と同じ）、A を `state='used'`。effects：`fixed`（objectId=B, payload `{ via:'goods', goodsId:A.id }`）と `recipe_ok`（objectId=B, payload `{ a:A.id, b:B.id, recipeId, label, type:'fix', x, y }`）。B が既に fixed なら不成立扱い
- `type:'toy'`（toy × toy）：A・B とも `state='removed'`（B が遊ばれ中なら不成立）。`MERGED_TOYS[result]` を deep copy して `x,y` をドロップ位置（床スナップ）、`state:'available'`、`playCount:0`、`draggedAt = elapsed`（誘導と同じ重み増）で `state.objects` に **追加**。effects：`removed`（A, B それぞれ `{kind:'toy', merged:true}`）→ `toy_merged`（objectId=新 id, payload `{ a, b, recipeId, label, x, y }`）→ `recipe_ok`（同 payload に `type:'toy'`）。全赤ちゃんが目標再選択
- 一致するレシピが無く、A が goods で B が hazard のとき：effects `recipe_ng`（objectId=B, payload `{ a, b, x, y }`）。A はドロップ位置に残る
- それ以外は通常のドロップ（従来通り）
- 合成 toy は `satPlay`（回数別回復量、省略時 `SAT_PLAY_BY_COUNT`）と `weight`（省略時 `WEIGHT_TOY`）を持てる。`finishPlay` と `targetWeight` はこれを優先する。`merged:true`
- スコアの `allHazardsFixedAt` は goods 経由の fixed も含めて判定する

### 8.3 できごとログ（`state.log`, `src/game/log.js`）

`state.log` は `{ t, kind, text, tone }` の配列（先頭が古い。最大 200 件、ステージ開始でクリア）。`tone` は `'bad' | 'good' | 'info'`。
文言は `src/game/log.js` の `describeEvent(effect, state) → { text, tone } | null` で生成し、`state.js` が effects を返す直前に該当 effect をログへ push する。文言は短い日常語の一文（感嘆符可）。恐怖を煽らない。例：

| effect | text（例） | tone |
|---|---|---|
| `hiyari`（通常） | `ボタン電池を口に入れそうになった！（誤飲）` / `コンセントに手が届いた！（感電）` — `{label}` と `{accident}` を使う | bad |
| `combo_hiyari` | `スプーンを持ってコンセントへ！ カバーをしていても危険` （ignoresFix のとき後半を付ける） | bad |
| `play_start`（新 effect：遊び開始時に出す。objectId=toy, payload `{babyId}`） | `ボールで遊んでいる！` | good |
| `play_done` | `ボールで遊んで満足（+25）` | good |
| `fixed`（長押し） | `コンセントにコンセントカバーをつけた` — `{label}` に `{fix}` | good |
| `fixed`（goods 経由） | `コンセントカバー → コンセント。すぐに対策できた` | good |
| `removed`（item） | `ボタン電池を拾って捨てた` | good |
| `removed`（toy、片付け） | `ボールを片付けた` | info |
| `toy_merged` | `積み木 × たいこ → 音の出る積み木ができた！` | good |
| `recipe_ng` | `コーナーガードはコンセントには使えない` | info |
| `bored` | `ボールに飽きた（30秒）` | info |
| `unbored` | `ボールにまた興味が出た` | info |
| `drop` | `ボールを手放した` | info |
| `no_toy` active | `遊べるおもちゃがない。退屈している` | bad |
| `pickup` | `抱き上げられた（満足度 −15）` | bad |
| `takeaway` | `スプーンを取り上げられた（満足度 −20）` | bad |
| `fuss_start` | `ぐずっている。危険なものに向かいやすい` | bad |
| `respawn` | `ボタン電池がまた転がってきた` | bad |
| `stage_clear` / `stage_fail` | `クリア！` / `ヒヤリ3回で失敗` | good/bad |

`state.result` に `hiyariCauses: [{ objectId, label, accident, count, combo: label|null }]`（多い順）と `log`（そのステージのログのコピー）を追加する。

### 8.4 飽き表示の変更

toy の `bored` 表示は「zzz」ではなく、toy を半透明にして **「あきた」** の文字と、`boredUntil` までの残り時間を示す小さなリングを描く（両フェーズ）。

## 9. 追補（v3）：長押し対策の廃止・重さ・置き場所（ドラッグ＆ドロップ中心へ）

ユーザー要望。ステージ1（リビング）は削除し、**キッチン（45秒）→ 双子（45秒）** の 2 ステージ構成。チュートリアルはキッチンの前。
教育カードはキッチン後 `burn`、双子後 `combo`、最終 `summary`（`battery` カードは使わない）。

### 9.1 長押しによる対策の廃止

- `pressStart` は **hazard / item / toy / goods / container に対して何もしない**（`state.press` は立てない、`fixing` 状態・`progress` は使わない）。`fixSec` フィールドは削除済み。`TUNING.FIX_SEC_MULT` は未使用
- 赤ちゃんへの 0.5 秒長押し（取り上げ）だけは残す（介入であり「無効化」ではない）
- 描画層：オブジェクトの進捗リングは描かない。取り上げのリングは残す

### 9.2 重さ（`weight: 'light' | 'heavy'`、`draggable = weight === 'light'`）

- light：item、toy、goods、軽い hazard（洗剤ボトル・電気ケトル・包丁）。ドラッグで床の任意の位置へ動かせる（hazard は動かしても `open` のまま。ただし届かない所へ置けば安全）
- heavy：コンセント・階段・テーブルの角・引き出し・ゴミ箱・容れ物。動かせない。対応する goods のレシピ（`type:'fix'`）でのみ対策できる
- `dragStart` は light のみ受け付ける（heavy は無視）。赤ちゃんは従来通りドラッグ可

### 9.3 ドロップ先の判定（`dragEnd` の順序）

ドラッグしていたオブジェクト A をドロップ点 P に落としたとき、上から順に判定し最初に成立したものを適用する。

1. **レシピ**（`stage.recipes`、A と「P から `DROP_COMBINE_DIST` 以内の最も近いオブジェクト B」の順不同一致）
   - `fix`：B（heavy hazard、`open`）→ `fixed`。A（goods）→ `used`。effects `fixed`（B, `{via:'goods', goodsId}`）＋ `recipe_ok`
   - `store`：A（light hazard）→ `fixed`、A の x,y は B の位置に重ねる（`storedIn: B.id`）。effects `fixed`（A, `{via:'store', into: B.id}`）＋ `recipe_ok`
   - `toy`：従来通り（両方 `removed`、`MERGED_TOYS[result]` を追加）。合成 toy の目標選択 base は **`targetWeight`**（旧 `weight` から改名。`weight` は重さ）
2. **容れ物**（`container:true` のオブジェクト B が P から `DROP_COMBINE_DIST` 以内。kind 'container' または container 付き hazard）
   - A が item / toy / goods → A `removed`（item の respawn は従来通り予約）。effect `trashed`（A, `{ into: B.id, kind: A.kind }`）
   - A が hazard → 不成立（次へ）
3. **高い場所**（P が `highPlace:true` の wall 矩形の内側）
   - A が hazard（light）→ `fixed`、x,y は P（wall の中に置いたまま描く）、`storedIn: wall.model`。effect `fixed`（A, `{via:'high', into: wall.model}`）
   - A が item / toy / goods → `removed`、effect `stored`（A, `{ into: wall.model, kind }`）。item の respawn は従来通り
4. **goods を合わない hazard に重ねた** → `recipe_ng`（従来通り）。A はその場に残る
5. それ以外 → 通常の床ドロップ（床スナップ、toy は `draggedAt` 更新、全赤ちゃん再選択）

### 9.4 その他

- `kind:'container'`：赤ちゃんの候補・接触対象にならない。描画は蓋つきゴミ箱。ドラッグ中に light オブジェクトを持っていると、容れ物と highPlace の wall と対応する goods 先がハイライトされる（ヒント）
- ゴミ箱 hazard（キッチン `trash`, `container:true`）は `open` の間は接触でヒヤリ、`fixed`（ゴミ箱ロック）後も容れ物としては使える
- スコア：`allHazardsFixedAt` は kind 'hazard' がすべて `fixed` になった瞬間（store/high/goods いずれでも）
- ログ文言（`log.js`）追加：`trashed` 「ボタン電池をゴミ箱に捨てた」、`stored` 「ボールを棚の上に片付けた」、`fixed via:'high'` 「洗剤ボトルを棚の上へ移した。届かない」、`fixed via:'store'` 「包丁を引き出しに収納した」。`fixed via:'goods'` は従来通り
- Tutorial 文言（3 行以内）：「軽いものはドラッグで動かせる。危ないものは高い場所へ、ゴミはゴミ箱へ」「安全グッズを重い危険（コンセント・階段…）に重ねると対策。おもちゃ同士を重ねると合成」「赤ちゃんもドラッグで移せるが嫌がって危険が増える。ヒヤリ3回で失敗」
- sim：ボットは長押しを使わない。`optimal`/`human_like` は goods→hazard、light hazard→highPlace/収納先、item→容れ物（無ければ highPlace）をドラッグで行う。`assert.js` の「ステージ1/2/3」は「ステージ1（キッチン）/2（双子）」に読み替え（noop・intervene_only はステージ1、human_like の目標は旧ステージ2・3 の範囲を新ステージ1・2 に適用、combo はステージ1・2）。目標値は変えない（調整はユーザー判断）

### 9.5 赤ちゃんの動きの自然さ（ユーザー要望）

一直線・等速をやめる。すべて注入された `rng` を使い決定性を保つ。`TUNING` に定数を追加してよい（`MOVE_*`）。

- **速度のゆらぎ**：0.6〜1.5 秒ごとに目標速度係数を `[0.55, 1.25]` から選び、現在係数をそこへ滑らかに近づける（1 秒で追いつく程度）
- **立ち止まり**：移動中、平均 4 秒に 1 回程度（rng）、0.4〜1.2 秒止まって `anim:'idle'`（きょろきょろ）。止まった後は 30% の確率で目標を再選択する（気が変わる）
- **向きの揺れ**：目標への直進方向に対して、±35° 以内のオフセット角を持ち、0.5〜1.2 秒ごとに新しいオフセットへ滑らかに変える。目標との距離が 60 未満ではオフセットを 0 に収束させ、確実に到達できるようにする。壁との衝突処理は従来通り
- **機嫌と速さ**：満足度が低いほど連続的に速くする。`moodMult = 1 + MOOD_SPEED_GAIN × ((100 − satisfaction) / 100)^2`（`MOOD_SPEED_GAIN` 0.6：満足度 70 で ×1.05、20 で ×1.38、0 で ×1.6）。従来の `BORED_SPEED_MULT`（satLow）・`FUSS_SPEED_MULT`（ぐずり）とは **最大値を採用**。機嫌が悪い（satLow または ぐずり）ときは立ち止まりの頻度を半分にし、速度係数の下限を 0.8 にする
- `baby.speed` には実効速度（基準 × 全倍率 × ゆらぎ）を毎フレーム書く（描画層・sim が読む）。`anim` は移動中 `crawl`、立ち止まり `idle`

## 10. 追補（v4）：ソファ登り・無神経なおじさん・薬

### 10.1 登れる家具（`climbable:true` の heavy hazard。双子ステージの `sofa`、位置はソファ前縁 (400,84)）

- **目標候補**になる（base = `CLIMB_WEIGHT`、`state=='open'|'fixed'` のどちらでも。`boredUntil > elapsed` の間は候補外）。接触してもヒヤリにならず **登る**
- 登り：`baby.climbing = objId`、`anim:'climb'`、赤ちゃんの座標を家具の壁の上（`x` はそのまま、`y = wall.y + wall.h/2` 相当。双子では (baby.x, 35)）へ移す。`climbUntil = elapsed + CLIMB_SEC`。effect `climb_start`（objectId, `{babyId}`）。登っている間は移動・接触判定なし、満足度 `+CLIMB_SAT_PER_SEC`/秒（上限 100）、`carrying` の toy はそのまま
- **転落判定**：登っている間、毎フレーム `rng() < CLIMB_FALL_PROB_PER_SEC * dt`。成立したら
  - 家具が `open`（マット無し）→ 通常のヒヤリ処理（`hiyari` effect、objectId=家具 id、`accident:'転落'`、赤ちゃんは spawn へ戻り stun）。ログ「ソファから落ちた！（転落）」
  - 家具が `fixed`（マット有り）→ ヒヤリにしない。家具の前の床（(baby.x, 84+BABY_RADIUS) を床スナップ）に降り、`stunUntil = elapsed + STUN_SEC`（`anim:'stun'`）。effect `climb_fall_safe`（objectId, `{babyId}`）。ログ「ソファから落ちたが、マットの上で無事」
- `climbUntil` 到達で降りる：家具前の床へ、effect `climb_end`。家具の `boredUntil = elapsed + CLIMB_BORED_SEC`（`state` は変えない。toy と同じ `boredUntil` を使う）。転落時も同じく `boredUntil` を設定
- 登っている赤ちゃんはドラッグで抱き下ろせる（`pickUp` が `climbing` を解除）。取り上げ長押しも可
- マット：`goods('mat')` を `sofa` に重ねると `fixed`（既存レシピ `mat_sofa`、`type:'fix'`）。描画は家具の前の床にマットを敷く
- `allHazardsFixedAt`（スコア）には climbable も含める（マットで fixed になる）
- sim ボット：`optimal` は mat→sofa を他の goods と同様に行う。赤ちゃんが登っている間の介入はしない

### 10.2 訪問者（`stage.visitors[]`、無神経なおじさん）

`{ id, label, emoji, at, path:[{x,y}...], drops:[item...] }`。`at` 秒に `path[0]`（部屋の外）に現れ、`VISITOR_SPEED` で waypoint を順にたどり、最後の waypoint（部屋の外）で退場する。

- `state.visitors = [{ id, label, emoji, x, y, dirX, dirY, active, done, dropped:[ids] }]`（描画層が読む）
- effects：`visitor_enter`（objectId=visitor id）、`visitor_drop`（objectId=落とした item id、payload `{visitorId, x, y}`）、`visitor_leave`
- 落とす位置：path の全長を `drops.length + 1` 等分した地点（入口・出口を除く）を通過した瞬間に、その位置（床スナップ）へ `drops[i]` を **runtime object として追加**（`state:'open'`、`spawnX/Y` はその位置、respawn なし）。追加時に全赤ちゃんが目標を再選択してよい
- 訪問者は壁を無視して歩く（NPC）。オブジェクト・赤ちゃんとの衝突なし。プレイヤーは触れない（`pickObject` は返さない）
- ログ：`visitor_enter`「おじさんが入ってきた」（info）、`visitor_drop`「おじさんがたばこを床に落とした」（bad）、`visitor_leave`「おじさんは気にせず出て行った」（info）
- 落とした item（たばこ・小銭・薬のシート）は通常の item：接触でヒヤリ（誤飲）、ゴミ箱に捨てる／高い場所へ置く
- sim：`optimal`/`human_like` は落ちた item を既存ルール（容れ物→高い場所）で片付ける。`noop` の指標は変わる（ユーザー判断）

### 10.3 薬

キッチンに light hazard `medicine`（薬、誤飲、高い場所へ）。訪問者が `pills`（薬のシート）を落とす。教育カード・豆知識の追加は **出典確認後**（ユーザーと相談）まで行わない。ログ文言のみ。

### 10.4 描画

- 登っている赤ちゃん：ソファの上に描く（2D：ソファ矩形の上に重ねる、少し大きく＝手前。3D：壁の天面 `y=WALL_H` に乗せる）。`anim:'climb'` は上下に小さく跳ねる。転落は 0.4 秒の落下アニメ（safe の場合はマットの上で小さくバウンド）
- マット：`sofa` が fixed のとき、ソファ前の床に緑のマット矩形（幅はソファと同じ、高さ 40）
- 訪問者：2D は背の高い人型（emoji 🧔＋体）で影付き、歩行の上下動。3D は赤ちゃんの 2 倍の高さのカプセル＋顔の Sprite。落とす瞬間に手元から item が落ちる小アニメ
- ドラッグヒント：mat を持っている間は sofa をハイライト

## 11. 追補（v5）：誤飲の猶予・高い場所の容量・ダミー・危険なおもちゃ・猫

### 11.1 誤飲の猶予（口に入れる）

対象：`accident === '誤飲'` かつ `weight === 'light'` の hazard / item（ボタン電池・洗剤ボトル・薬・たばこ・小銭・薬のシート…）、および `ingestible:true` の toy（§11.4）。heavy の誤飲（ゴミ箱）は従来通り即ヒヤリ。

- 接触しても即ヒヤリにしない。赤ちゃんはその物を **口元に持つ**：`obj.carriedBy = babyId`、`baby.mouthing = { objectId, until }`（`until = elapsed + rng∈[MOUTH_SEC_MIN, MOUTH_SEC_MAX]`）、`anim:'mouth'`。移動・他の接触判定は停止。既に `carrying` の toy があれば足元に落とす（`drop` reason `'mouth'`）。effect `mouth_start`（objectId, `{babyId, until}`）。ログ「ボタン電池を口に入れそう！」（bad）
- `until` 到達で判定：`rng() < MOUTH_INGEST_PROB` → **ヒヤリ**（通常処理、objectId=その物、ログ「ボタン電池を飲み込んだ！（誤飲）」。物は接触地点に残る＝`open`）。そうでなければ **手放す**：物を足元（床スナップ）に置いて `carriedBy=null`、`boredUntil = elapsed + TAKEAWAY_BORED_SEC`（すぐ拾い直さない。hazard/item にも `boredUntil` を使い、候補・接触から除外）、effect `mouth_release`、ログ「ボタン電池を手放した。危なかった」（info）。目標再選択
- **取り上げ**：口に入れている間、既存の取り上げ長押し（0.5 秒）で取り上げられる（`carrying` に加え `mouthing` も対象）。物は足元に落ち `boredUntil = elapsed + TAKEAWAY_BORED_SEC`、満足度 `TAKEAWAY_SAT`（20 秒ルール適用）、ぐずり。effect `takeaway`（`{toyId: objectId}`）。ログ「ボタン電池を取り上げた（満足度 −20）。ぐずる」。抱き上げ（ドラッグ）でも解除され、物は床に落ちる
- 口に入れている物はドラッグで拾えない（`carriedBy` が立つので従来と同じ）。描画：赤ちゃんの口元に物、頭上に危険リング（残り時間で縮む）、HUD 色は combo_warn と同系統

### 11.2 高い場所の容量

- `walls[].capacity`（既定 `TUNING.HIGH_PLACE_CAPACITY`）。その wall に `storedIn === wall.model` で置かれている runtime object（fixed / removed 問わず、respawn で床に戻ったものは除く）が `capacity` 以上なら **置けない**：ドロップは通常の床ドロップ（wall の手前の床へスナップ）になり、effect `high_full`（objectId, `{into: wall.model, capacity}`）、ログ「カウンターはもう置けない（2個まで）」（info）
- ダミー（prop）も容量を消費する（何を上げるかの選択になる）
- 描画：wall のラベル横に `n/2` を表示。満杯時はドラッグヒントを出さない（または赤っぽく）

### 11.3 ダミー（kind `prop`）

- `prop()`：軽い、ドラッグ可、赤ちゃんの候補・接触対象外、ヒヤリなし、レシピなし。高い場所（容量消費・`stored`）・容れ物（`trashed`）に入れられる
- 猫（§11.5）が運ぶ対象になる
- 描画は落ち着いた色（ベージュ／茶）。ラベルのみ

### 11.4 危険なおもちゃ（`ingestible:true`、`riskLabel`）

- 通常の toy として遊べる・合成対象にはならない
- 遊び終えた瞬間、`rng() < RISKY_TOY_PROB` なら **持ち歩く代わりに** §11.1 の口に入れる状態へ（objectId=その toy）。ヒヤリ時のログは「ジグソーパズルの小さなピースを飲み込んだ！（誤飲）」（`riskLabel` を使う）。手放したときは toy は `bored` のまま床へ
- 満足度回復は通常通り。描画：toy に小さな「！」バッジ（おもちゃだが危険と分かる）

### 11.5 猫（`visitors[]` の `type:'cat'`）

`{ id, type:'cat', label, emoji, at, entry, exit }`。`at` 秒に `entry` から入り、以下を `CAT_STEALS` 回繰り返して `exit` へ去る。速度 `CAT_SPEED`、壁は無視、rng で決定的に選ぶ。

1. 床の軽い runtime object（`carriedBy==null`、`state` が open/available/bored、ドラッグ中でない、kind ∈ hazard/item/toy/prop/goods）から 1 つ選ぶ。hazard/item は重み 2、他は 1。無ければ退場
2. そこへ走り、到達で **くわえる**（`obj.carriedBy = 'cat'`、猫に追従）。effect `cat_take`（objectId）。ログ「ねこがボタン電池をくわえた」（bad）
3. いずれかの赤ちゃん（rng）を選び、その周囲 `CAT_DROP_NEAR_BABY` px の点（床スナップ、壁外）へ走って **落とす**（`carriedBy=null`、その位置へ）。effect `cat_drop`（objectId, `{x,y,babyId}`）。ログ「ねこがボタン電池を赤ちゃんのそばに置いた」（bad）。赤ちゃんは目標再選択
4. 0.5 秒その場で止まってから次へ

- `state.visitors` に uncle と同じ形で載る（`type`, `carrying: objectId|null` を追加）。プレイヤーは触れない
- effects `visitor_enter/leave` は共通。猫がくわえている物はドラッグで拾えない（`carriedBy`）
- 描画：低く速い 4 足の姿（🐈）、くわえている物を口元に、移動方向を向く。3D は低いカプセル

### 11.6 おじさん

キッチンの訪問者を削除。双子のみ（`at:10`）。猫は双子の `at:27`。

### 11.7 実装メモ（v5 の確定事項）

- 口に入れる対象の判定は `isMouthable(obj)`（`objects.js`）。持っている toy と **combo が成立する接触は従来通り即ヒヤリ**（例：布 × 洗剤ボトル）。口に入れている間は満足度が減らない（遊び中と同じ扱い）
- 口に入れている間に赤ちゃんが持っていた toy は `drop`（reason `'mouth'`）で足元へ。抱き上げで口の物が落ちるときは `drop`（reason `'pickup'`、ログなし）
- 手放し・取り上げの `boredUntil`：hazard/item は `elapsed + TAKEAWAY_BORED_SEC`。ingestible toy は遊び終えた `bored` の `boredUntil` の方が長いのでそのまま（短くしない）。hazard/item の `boredUntil` は `bored`/`unbored` effect を出さない
- 高い場所に `stored` した removed オブジェクトにも `storedIn = wall.model` を書く（容量の計数）。`highPlaceCount(state, wall)` / `highPlaceCapacity(wall, tuning)` / `isHighPlaceFull(state, wall, tuning)` を `objects.js` が export する
- 猫がくわえる候補（`isCatTakeable`、`visitors.js`）：draggable、`carriedBy == null`、`playingBy == null`、state open/available/bored、ドラッグ中でない。目標が途中で拾われたら選び直す。落とす点は赤ちゃんの周囲 `CAT_DROP_NEAR_BABY` px で `isWalkable` な角度を最大 8 回試し、無ければ床スナップ。落とした後 `CAT_PAUSE_SEC`（TUNING、0.5）止まる。`CAT_STEALS` 回運ぶか候補が尽きたら `exit` へ
- `updateVisitors(state, tuning, effects, dt, rng)`：猫は注入 rng を使う（決定的）。`visitor_leave` の猫のログは「ねこは出て行った」
- sim ボット：`optimal`/`human_like` は `baby.mouthing != null` を見つけたら他の何よりも先に取り上げ長押し（ドラッグ中なら手放して次フレームに長押し）。高い場所は `highPlaceCount` が容量に達したものを避け、どこにも置けない軽い hazard/item は赤ちゃんから遠い床へ移す。prop は触らない。`random` は prop も含めて操作する

## 12. 追補（v6）：ステージ3「夕方のリビング」と 4 つの新機構

ユーザー要望（2026-09-13）。**キッチン（45秒）→ 双子（45秒）→ 夕方のリビング（60秒）** の 3 ステージ構成にする。
難易度は物量ではなく **判断の質**（置き場所の選択・先読み・資源の配分）で上げる。この追補は §9〜§11 を上書きしない（追加のみ）。

新機構は 4 つ。いずれも **ステージ3にしか登場しない**（stage 定義にフィールドが無ければ従来どおり動く）。

> **決定論の絶対条件**：ステージ1・2 の `rng()` 呼び出し列を一切変えないこと。
> 新機構は rng を使わない（zone・時限・配置コンボ）か、ステージ3にしか現れない訪問者（兄）の中でだけ使う。
> `tests/game/determinism.test.js` と `npm run sim -- --stage 1,2` の既存シード結果が変わったら実装が誤っている。

### 12.1 面のハザード（zone）

矩形の範囲に **滞在した時間** でヒヤリになる hazard。接触（点）ではない。

**定義**（`stages.js` の `zone()` ファクトリ）

```js
zone(id, label, accident, fix, emoji, x, y, { w, h, dwellSec, respawnSec })
// → { id, kind:'hazard', zone:true, area:{w,h}, dwellSec, x, y（矩形の中心）,
//     weight:'heavy', draggable:false, model:id, fixedModel:`${id}_fixed`, respawnSec }
```

**判定**（`baby.js`。rng を使わない）

- 赤ちゃんの中心が矩形内（`|bx-x| <= w/2 && |by-y| <= h/2`）かつ zone が `open` の間、`baby.zoneDwell[id] += dt`
- 矩形外に出たら `baby.zoneDwell[id] = 0`。zone が `fixed` の間は加算しない（拭いた水・ガードしたヒーターは安全）
- `zoneDwell[id] >= dwellSec`（省略時 `TUNING.ZONE_DWELL_DEFAULT`）で **ヒヤリ**（`onHiyari`。赤ちゃんは spawn へ戻り `zoneDwell` は全消去）
- 判定の位置：`updateBaby` の **接触判定（`findHiyariContact`）の直前**。抱っこ中・登り中・口に入れている間・stun 中は加算しない
- `findHiyariContact` は `o.zone === true` を **除外**する（点接触ではヒヤリにしない）

**目標選択**：zone は候補に含める。`targetWeight` の base は `TUNING.WEIGHT_ZONE`（0.8。toy 3.0・hazard 1.0 より低い）。
狙って行く物ではなく「通り道として踏む」ことが本質なので低くする。

**対策**：対応する goods を重ねる（`type:'fix'` レシピ）。zone は heavy なのでドラッグはできない。

**再発**：`respawnSec` を持つ zone は `fixed` になった時点で `respawnAt = elapsed + respawnSec` を立て、
`updateObjects` が時刻到達で `open` に戻す（`storedIn` は触らない、effect `respawn`）。
※ 既存の再発（`state==='removed'` の item）とは別分岐。zone 以外の hazard には適用しない。

**再発時の goods の復帰**（重要）：`type:'fix'` の goods は使うと `used` になって消えるため、そのままでは
再発した zone を二度と対策できなくなる。zone を `fixed` にしたのが goods レシピだったときは、その goods の id を
zone の実行時フィールド `fixedByGoodsId` に記録し、**再発の瞬間にその goods を `available` に戻して定義位置
（`spawnX` / `spawnY`）へ戻す**（effect `respawn`（objectId = goods））。タオルやガードは使い回せる、という素直な解釈。
`fixedByGoodsId` は zone が高い場所・収納で fixed になったときは立たない（zone は heavy なので実際には起きない）。

**effect**：`zone_enter`（矩形に入った瞬間・1 回だけ。payload `{ babyId, dwellSec }`）。出たときの effect は出さない。
滞在の進捗表示は state（`baby.zoneDwell`）から毎フレーム導出する（§12.6）。

### 12.2 時限ハザード（activeAt）

**定義**：hazard の `extra` に `activeAt: <秒>`。`createRuntimeObject` は `activeAt != null` のとき `state = 'inactive'` で作る。

- `inactive` の間：接触してもヒヤリにならない（`findHiyariContact` は `open`/`fixed` しか見ないので自動）、
  赤ちゃんの目標候補にならない（`isCandidate` が `open` を見るので自動）、combo も成立しない
- `updateObjects` が `state === 'inactive' && elapsed >= activeAt` で `state = 'open'` にし、effect `activate` を出す
- **ON になる前でも対策できる**（先回りが正解）。`recipes.js` の `type:'fix'` は hazard が
  `open` **または `inactive`** のとき成立させる。`fixed` になった後は `activate` しない（`inactive` からの遷移のみ）
- `allHazardsFixed` は従来どおり `state !== 'fixed'` を見るので、`inactive` は未対策として数える

**予告**：`activeAt - elapsed <= TUNING.ACTIVATE_WARN_SEC`（3秒）を描画層が state から導出して点滅させる（effect ではない）。

### 12.3 押して動かす家具（weight: 'push'）と配置コンボ

**`weight: 'push'`**（`stages.js` の `pushable()` ファクトリ）

- heavy と light の中間。`draggable: true` を明示的に持つ（`draggable = weight === 'light'` の自動導出は使わない）
- `isDraggableOnFloor`：`kind==='hazard'` かつ `weight==='push'` かつ `state==='open'` ならドラッグ可
- `resolveDrop`：push のものは **レシピ・容れ物・高い場所のいずれにも入らない**。常に床ドロップ（`snapToFloor`）
- 赤ちゃんの目標にならない（`isCandidate` で `weight === 'push'` を除外）。`findHiyariContact` でも除外（当たっても何も起きない）
- 猫は運べない（`isCatTakeable` が `weight === 'push'` を明示的に除外する）

**配置コンボ**（`stage.placementCombos`）

```js
{ id, mover: <object id>, target: <object id>, dist: 90, label: '椅子 × 窓' }
```

- `combos.js` に `updatePlacementCombos(state, effects)` を追加し、`updateObjects` の直後・訪問者の前に毎フレーム呼ぶ
- **成立条件**：mover と target がともに `removed` でなく、`target.state === 'open'`、`dist(mover, target) < c.dist`
- 成立中、target の実行時フィールド `climbable` を `true` にする（定義側は `climbableWhen:'placement'` を持ち、初期 `climbable` は false）。
  非成立になったら `climbable = false` に戻し、その target に登っている赤ちゃんは **その場で降ろす**（`leaveClimb` 相当。ヒヤリにしない）
- 成立／非成立が切り替わった瞬間だけ effect `placement_warn`（objectId = target、payload `{ active, label, moverId }`）
- target が `fixed`（補助錠をかけた）なら成立しない＝**根本対策**。mover を離しても成立しない＝**暫定対策**。この二択が狙い

**重大なヒヤリ（severity）**

- object 定義に `severity: 2`（省略時 1）。`registerHiyari` が `state.hiyari += (obj.severity ?? 1)` とし、
  `hiyariEvents` の要素に `severity` を持たせる。`judge` は `hiyari >= 3` のまま（＝窓からの転落 1 回で実質致命的）
- `groupHiyariCauses` の `count` は **件数**のまま。`severity` 合計を `weight` として各グループに持たせ、結果画面が「◯◯ 1回（重大）」と出せるようにする

### 12.4 兄（`visitors[]` の `type:'sibling'`）

```js
{ id:'brother', type:'sibling', label:'お兄ちゃん', emoji:'🧒', at:4,
  entry:{x,y}, home:{x,y}, litter:[<item 定義>], max:4 }
```

`at` 秒に `entry` から入り、**ステージ終了まで居座る**（`done` にならない）。速度 `TUNING.SIBLING_SPEED`、壁は無視、rng は注入 rng のみ。

状態機械（1 フレームに 1 フェーズだけ進める。猫と同じ流儀）

1. `wander`：`home` の周囲 `SIBLING_WANDER_R` px のランダムな点（rng）へ歩く。到達したら次の行動時刻 `nextActAt = elapsed + SIBLING_INTERVAL_SEC` まで `wander` を続ける
2. `nextActAt` 到達かつ散らかした数 < `max` のとき、**散らかす先**を rng で決める
   - `rng() < SIBLING_GIVE_PROB` → いずれかの赤ちゃん（rng）の周囲 `SIBLING_NEAR_BABY` px の床の点（猫の `pickDropPoint` と同じ手順）
   - そうでなければ 部屋のランダムな床の点
   `phase = 'toSpot'` でそこへ歩き、到達したら `litter[i % litter.length]` を床に置く
   （`visitors.js` の `dropItem` を再利用。effect `visitor_drop`、`requestReselectAll`）。散らかした数 +1、`nextActAt` を更新して `wander` へ
3. `busy`：プレイヤーが toy を兄にドロップすると `busyUntil = elapsed + SIBLING_BUSY_SEC`。
   その間は動かず散らかさない。渡した toy は `carriedBy = 'brother'` で兄の足元に固定（＝赤ちゃんは使えない）。
   `busyUntil` 到達で toy を床へ戻し（`carriedBy = null`、`draggedAt` 更新、`requestReselectAll`）、`wander` へ

**toy を兄に渡す**（`drop.js`）：ドロップ判定の順序に **2. 訪問者** を挿入する。

> 1. レシピ → **2. 訪問者** → 3. 容れ物 → 4. 高い場所 → 5. recipe_ng → 6. 床

成立条件：A が `kind==='toy'` かつ `state==='available'`、ドロップ点 P から `DROP_COMBINE_DIST` 以内に
`type==='sibling'` かつ `active` かつ busy でない訪問者がいる。effect `sibling_busy`（objectId = toy、payload `{ visitorId, until }`）。戻り値 `'sibling'`。
busy 明けの effect は `sibling_free`（objectId = toy、payload `{ visitorId }`）。

### 12.5 ステージ3 の内容

`{ id:3, name:'夕方のリビング', timeLimit:60, babies:1, eduCardId:'burn' }`

- **壁**：窓（左上）／カウンター（中央上・高い場所 capacity 1）／ベランダ（右上）／棚（左・capacity 2）／テレビ台（右・capacity 2）／ソファ（下）
- **開始時点で配置コンボが 2 つとも成立している**（椅子が窓の前、収納ケースがベランダの前）。最初の判断がこれになる
- **時限**：炊飯器の蒸気 `activeAt:16`、コンロ `activeAt:30`
- **面**：こぼれた水（転倒・`respawnSec` あり）、ヒーターの前（やけど）
- **訪問者**：兄（`at:4`、常駐）＋ 猫（`at:38`）
- **combos**：スプーン × コンセント（`ignoresFix`）、ボール × 窓（`ALL_COMBOS` に追加）、布 × 洗剤ボトル
- 教育カードは キッチン後 `battery`（ステージ1 にボタン電池があるため §9 から変更）、双子後 `combo`、リビング後 `burn`（炊飯器・コンロのやけど）、最終 `summary`。
  転落専用カードは文言・出典が未確定のため作らない（§10-16 の要件。用意でき次第 `edu.js` に追加して差し替える）

### 12.6 描画層・ログ・音（両フェーズ共通）

`src/render/hints.js` に集約して両レンダラが共有する（片方だけに書かない）。

| 追加する導出 | 内容 |
|---|---|
| `zoneRects(state)` | zone の矩形（`{ id, x, y, w, h, state }`）。`open` は警告色、`fixed` は淡色 |
| `zoneDwellFraction(state, zoneId)` | 全赤ちゃんの `zoneDwell[zoneId] / dwellSec` の最大値 0..1。滞在リング用 |
| `activationFraction(state, o)` | `inactive` の hazard が ON になるまでの残り割合。`ACTIVATE_WARN_SEC` 以内なら点滅 |
| `placementWarnings(state)` | 成立中の配置コンボ `[{ moverId, targetId, label }]`。mover と target を線で結んで警告表示 |
| `pushTargets(state)` | push をドラッグ中に「ここから離すと安全」を示すための target 一覧 |

- `isDraggableOnFloor` 相当の見た目（掴めるカーソル）は push も対象にする
- `inactive` の hazard は薄く描き、対策済みの見た目とは区別する（「まだ危険ではないが、来る」）
- 新しい effect は **4 か所すべて** 更新する（`log.js` の `describeEvent`、`main.js` の `audioNameFor`、2D の `playEffect`、3D の `playEffect`）

| effect | ログ（日本語） | 音（既存の音名を再利用。新規素材は追加しない） |
|---|---|---|
| `activate` | 「炊飯器の蒸気が熱くなった！」（bad） | `combo_warn` |
| `zone_enter` | 「赤ちゃんがこぼれた水に入った」（bad） | `deny` |
| `placement_warn` | active のとき「椅子 × 窓：踏み台になっている！」（bad）／解除は「椅子を窓から離した」（good） | active のとき `combo_warn`、解除は無音 |
| `sibling_busy` | 「お兄ちゃんに積み木を渡した」（good） | `play_done` |
| `sibling_free` | 「お兄ちゃんが積み木に飽きた」（bad） | 無音 |

`log.js` の事故名の文言に `'転倒'` → 「ですべって転びそうになった！」を追加する。

### 12.7 新しい TUNING（`stages.js`）

```js
// ---- ステージ3（CONTRACT §12）----
WEIGHT_ZONE: 0.8,            // 面のハザードの目標選択 base（toy 3.0・hazard 1.0 より低い＝通り道として踏む）
ZONE_DWELL_DEFAULT: 1.5,     // zone.dwellSec 省略時の滞在秒数
ACTIVATE_WARN_SEC: 3,        // 時限ハザードの予告点滅（描画層が使う）
SIBLING_SPEED: 110,          // 兄の歩く速さ px/s
SIBLING_INTERVAL_SEC: 7,     // 散らかす間隔
SIBLING_GIVE_PROB: 0.4,      // 赤ちゃんのそばに散らかす確率（残りは部屋のランダムな床）
SIBLING_NEAR_BABY: 70,       // 赤ちゃんのそばに置くときの距離
SIBLING_WANDER_R: 90,        // home の周囲をうろつく半径
SIBLING_BUSY_SEC: 15,        // おもちゃを渡したときにおとなしくなる秒数
BABY_SPEED_STAGE3: 78        // 98 から引き下げ（§12 は仕掛けで難しくする方針。最終値は sim で決める）
```

### 12.8 受け入れ条件

- ステージ1・2 の既存シードの結果が **完全に一致**する（`tests/game/determinism.test.js`、`npm run sim -- --stage 1,2 --bot all`）
- `node --test tests/game/*.test.js` が全件 pass（新機構のテストを追加する）
- `npm run sim:assert` の例外ゼロ・最大フレーム < 50ms・同一シード2回一致がステージ3でも通る
- 2D / 3D の両方でステージ3が最後まで遊べる（`npm run test:browser` / `test:browser3d`）

**ステージ3の難易度目標**（`sim/assert.js` の `buildTargets` に追加済み。新ステージなので設計意図から定めた）

| 指標 | 目標範囲 | 根拠 |
|---|---|---|
| `optimal` クリア率 | 0.85 〜 1.00 | 転落（severity 2）は完璧に近い操作でも 1 回のミスで致命的になるため、1・2 の 0.95 より低く置く |
| `human_like` クリア率 | 0.25 〜 0.45 | ステージ2（0.35〜0.55）より明確に難しい。ただし丁寧に遊べば勝てる |
| `human_like` playCount 中央値 | 2 以上 | 危険対応に追われて遊ばせられない＝満足度経済が破綻している状態を弾く |

sim のボットも §12 に対応させた（`sim/bots/common.js` に `plannableHazards`（`inactive` を計画対象に含める）、
`activePlacements`（成立中の配置コンボ）、`isPushFurniture`（push 家具は赤ちゃんの目標でも危険でもない）を追加）。

### 12.9 追補：赤ちゃんの動き（2026-09-13、実プレイ後の調整）

ユーザーが実際に遊んでの指摘：**「まだ簡単」「今の状態だとほぼ真ん中付近にしかいない」**。

**計測方法**（`optimal` ボットで 60 秒 × 30 シード、`screen === 'play'` のフレームだけを数える）

| 指標 | 意味 |
|---|---|
| 踏破率 | 部屋を 4×3 に分けたセルのうち、赤ちゃんが一度でも入ったセルの割合 |
| 中心からの平均距離 | 部屋の中心 (400, 270) からの距離の平均（部屋全体に一様なら約 230 px） |

**原因は距離バイアスではなく、おもちゃの配置だった**

| 変更 | 踏破率 | 中心からの距離 |
|---|---|---|
| 変更前 | 43% | 129 px |
| `TARGET_DIST_BIAS` を 100 → 260（目標選択で距離の効きを緩める） | 43% | 131 px |
| **おもちゃ 6 個を部屋の外周へ散らす** | **65%** | 183 px |
| ＋ `BABY_SPEED_STAGE3` を 78 → 110 | **78%** | **199 px** |

`targetWeight` は toy の base が 3.0、hazard が 1.0 なので、赤ちゃんは圧倒的におもちゃへ向かう。
ステージ3 の初期配置はおもちゃ 6 個がすべて中央帯（x 200〜620）にあり、**赤ちゃんが中央から出る理由が無かった**。
おもちゃを四隅・外周へ散らすことがそのまま解決になる。combo の相手（ボール × 窓、布 × 洗剤、スプーン × コンセント）
からも離してあるので、「おもちゃを持って部屋を横断する」動きが出る。

**採用しなかった変更**：`TARGET_DIST_BIAS` の引き上げ。ステージ3 の踏破率への寄与は 79% → 81% とわずかな一方、
**ステージ1・2 が明確に易しくなった**（`noop` クリア率 ステージ2 で 37% → 51%）。100（従来の埋め込み値）に戻した。
定数自体は `TUNING` に残してある（意味の分かる形で調整できるようにするため）。

**あわせて直したもの**

- `idleWander`（目標候補がまったく無いときのうろつき先）が部屋の中心 ±60 px に固定されていた。部屋全体から選ぶように変更。
  ただし候補が空になるのは稀で、ステージ1・2 の sim 指標は変更前と**完全に一致**する
  （n=150・seed 1 で `noop` 57.3% / 36.7%、`random` 54.0% / 48.7%、`human_like` 100% / 100%）
- **赤ちゃんの初期位置が水たまりの 20 px 上にあり、開始 1 秒で `zone_enter` していた。**
  ヒヤリのたびにそこへ戻るため、(400, 250) → (400, 165) へ。
  **再発する面のハザードの近くを `babySpawns` にしない**こと
- ラベルが重なっていたオブジェクト（積み木・コード留め・ヒーターガード・チャイルドロック・ボタン電池）の位置を調整

**指標の変化**（n=200・seed 1）：ステージ3 は `noop` 14.5%、`random` 15.5%、`optimal` 100%、`human_like` 100%。
`intervene_only` が **96.7% → 77.0%** に下がり、§12 実装時に報告した「抱き上げ続ければ勝てる」抜け穴が弱まった
（赤ちゃんが速くなり、おもちゃが遠くに散ったため、抱き上げ続けるコストが上がった）。
`BABY_SPEED_STAGE3` は 125 も試したが踏破率 81% で頭打ちだったため 110 を採用した。
