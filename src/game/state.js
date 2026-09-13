// ゲーム状態機械（CONTRACT §1-§6）。画面遷移・入力の解釈・毎フレーム更新をまとめる。
// src/game/ は DOM・描画・組み込み乱数・Date.now を参照しない。時刻は state.elapsed（秒）。
import { STAGES, TUNING, baseSpeedFor } from './stages.js';
import { createRng } from './rng.js';
import { pickTip } from './edu.js';
import {
  createRuntimeObjects, findObject, findBaby, countPlayableToys, updateObjects, isDraggableOnFloor
} from './objects.js';
import {
  createBaby, updateBaby, requestReselectAll, doTakeaway, pickUp, putDown
} from './baby.js';
import { judge, buildResult } from './scoring.js';
import { resolveDrop } from './drop.js';
import { appendLog } from './log.js';
import { createVisitors, updateVisitors } from './visitors.js';
import { updatePlacementCombos } from './combos.js';

export function createGame({ rng = createRng(1), stages = STAGES, tuning = TUNING } = {}) {
  const state = {
    screen: 'title',
    // 'campaign'：はじめから通しで遊ぶ（チュートリアル → 全ステージ → finalResult）
    // 'single'  ：タイトルで選んだ 1 ステージだけ遊ぶ（結果画面からタイトルへ戻る）
    mode: 'campaign',
    stageIndex: 0,
    stage: null,
    objects: [],
    babies: [],
    visitors: [],                  // 訪問者の実行時状態（CONTRACT §10.2）。ステージ開始ごとに作り直す
    elapsed: 0, timeLeft: 0,
    hiyari: 0, playCount: 0, interventions: 0, comboHiyari: 0,
    noToy: false,
    allHazardsFixedAt: null,
    press: null,
    drag: null,
    loading: { elapsed: 0, ready: false, next: null },
    tip: null, tutorialTip: null, shownTipIds: [],
    result: null,
    totalScore: 0,
    satLowTime: 0,
    log: [],                       // できごとログ（CONTRACT §8.3）。先頭が古い。最大 200 件
    hiyariEvents: []               // 内部用：result.hiyariCauses の元データ { objectId, babyId, comboLabel }
  };

  // dispatch/input 由来の effects は次の update() の先頭で返す
  let pending = [];

  function transition(to) {
    const from = state.screen;
    state.screen = to;
    pending.push({ type: 'screen', objectId: null, payload: { from, to } });
  }

  function enterLoading(next, stageIndex) {
    state.stageIndex = stageIndex;
    state.loading = { elapsed: 0, ready: false, next };
    state.tip = pickTip(rng, state.shownTipIds);
    transition('loading');
  }

  function setupStage(index) {
    const stage = stages[index];
    if (!stage) throw new Error(`stage index out of range: ${index}`);
    state.stageIndex = index;
    state.stage = stage;
    state.objects = createRuntimeObjects(stage);
    state.visitors = createVisitors(stage);
    const speed = baseSpeedFor(stage, tuning);
    state.babies = [];
    for (let i = 0; i < stage.babies; i++) {
      const spawn = stage.babySpawns[i] || stage.babySpawns[0];
      state.babies.push(createBaby(i, spawn, speed, tuning));
    }
    state.elapsed = 0;
    state.timeLeft = stage.timeLimit;
    state.hiyari = 0;
    state.playCount = 0;
    state.interventions = 0;
    state.comboHiyari = 0;
    state.allHazardsFixedAt = null;
    state.press = null;
    state.drag = null;
    state.result = null;
    state.satLowTime = 0;
    state.log = [];
    state.hiyariEvents = [];
    state.noToy = countPlayableToys(state) === 0;
  }

  // effects[loggedUpTo..] をログへ。戻り値は次の開始位置
  function flushLog(effects, loggedUpTo) {
    return appendLog(state, effects, loggedUpTo);
  }

  function finishStage(cleared, effects, loggedUpTo) {
    state.press = null;
    state.drag = null;
    for (const b of state.babies) b.holdProgress = 0;
    // result を作る前に stage_clear/fail までログへ載せる（result.log にクリア/失敗の行を含めるため）
    if (cleared) {
      const { score, breakdown } = buildResult(state, true);
      effects.push({ type: 'stage_clear', objectId: null, payload: { score, breakdown } });
    } else {
      effects.push({ type: 'stage_fail', objectId: null, payload: { failAtSec: state.elapsed } });
    }
    loggedUpTo = flushLog(effects, loggedUpTo);
    const result = buildResult(state, cleared);
    state.result = result;
    if (cleared) state.totalScore += result.score;
    transition('stageResult');
    return loggedUpTo;
  }

  // ---- 長押し（赤ちゃんの取り上げだけ。オブジェクトへの長押しは何もしない：CONTRACT §9.1）--------------

  function cancelPress() {
    const p = state.press;
    if (!p) return;
    const baby = findBaby(state, p.targetId);
    if (baby) baby.holdProgress = 0;
    state.press = null;
  }

  function pressStart(targetId) {
    cancelPress();
    if (findObject(state, targetId)) return; // hazard / item / toy / goods / container / prop：何も起きない
    const baby = findBaby(state, targetId);
    // carrying の toy、または口に入れている物（§11.1）があれば取り上げ長押し
    if (baby && (baby.carrying != null || baby.mouthing != null) && !baby.isHeld) {
      baby.holdProgress = 0;
      state.press = { targetId: baby.id, elapsed: 0, needSec: tuning.TAKEAWAY_HOLD_SEC };
    }
  }

  function updatePress(dt, effects) {
    const p = state.press;
    if (!p) return;
    p.elapsed += dt;
    const baby = findBaby(state, p.targetId);
    if (!baby || (baby.carrying == null && baby.mouthing == null) || baby.isHeld) {
      if (baby) baby.holdProgress = 0;
      state.press = null;
      return;
    }
    baby.holdProgress = Math.min(1, p.elapsed / p.needSec);
    if (baby.holdProgress >= 1) {
      state.press = null;
      doTakeaway(baby, state, tuning, effects);
    }
  }

  // ---- ドラッグ -------------------------------------------------------------

  function dragStart(targetId, x, y) {
    if (state.drag) return;
    cancelPress();
    const obj = findObject(state, targetId);
    if (obj) {
      if (!isDraggableOnFloor(obj)) return; // light（draggable）で床にあるものだけ。heavy・container は動かない
      obj.x = x;
      obj.y = y;
      state.drag = { targetId: obj.id, x, y };
      requestReselectAll(state);           // 手の中のものは目標から外れる
      return;
    }
    const baby = findBaby(state, targetId);
    if (!baby || baby.isHeld) return;
    state.drag = { targetId: baby.id, x, y };
    baby.x = x;
    baby.y = y;
    pickUp(baby, state, tuning, pending);
  }

  function dragMove(x, y) {
    const d = state.drag;
    if (!d) return;
    d.x = x;
    d.y = y;
    const obj = findObject(state, d.targetId);
    if (obj) {
      obj.x = x;
      obj.y = y;
      return;
    }
    const baby = findBaby(state, d.targetId);
    if (baby) {
      baby.x = x;
      baby.y = y;
      if (baby.carrying != null) {
        const toy = findObject(state, baby.carrying);
        if (toy) { toy.x = x; toy.y = y; }
      }
    }
  }

  function dragEnd(x, y) {
    const d = state.drag;
    if (!d) return;
    state.drag = null;
    const obj = findObject(state, d.targetId);
    if (obj) {
      // ドロップ先の判定（CONTRACT §9.3）：レシピ → 容れ物 → 高い場所 → recipe_ng → 床。effects は次の update() の先頭で返る
      resolveDrop(obj, state, tuning, pending, x, y);
      requestReselectAll(state);
      return;
    }
    const baby = findBaby(state, d.targetId);
    if (baby) putDown(baby, state, tuning, x, y);
  }

  // ---- 公開 API -------------------------------------------------------------

  function update(dt) {
    const effects = pending;
    pending = [];

    if (state.screen === 'loading') {
      state.loading.elapsed += dt;
      if (state.loading.elapsed >= tuning.LOADING_MIN_SEC && state.loading.ready) {
        if (state.loading.next === 'tutorial') {
          state.tutorialTip = pickTip(rng, state.shownTipIds);
          transition('tutorial');
        } else {
          setupStage(state.stageIndex);
          transition('play');
        }
        effects.push(...pending);
        pending = [];
      }
      return effects;
    }
    if (state.screen !== 'play') return effects;

    const stage = state.stage;
    state.elapsed += dt;
    state.timeLeft = Math.max(0, stage.timeLimit - state.elapsed);

    updatePress(dt, effects);
    updateObjects(state, effects);
    updatePlacementCombos(state, effects);   // 配置コンボ（CONTRACT §12.3）。stage.placementCombos が無ければ何もしない
    updateVisitors(state, tuning, effects, dt, rng);

    let nt = countPlayableToys(state) === 0;
    if (nt !== state.noToy) {
      state.noToy = nt;
      effects.push({ type: 'no_toy', objectId: null, payload: { active: nt } });
    }

    for (const baby of state.babies) updateBaby(baby, state, tuning, rng, effects, dt);

    nt = countPlayableToys(state) === 0;
    if (nt !== state.noToy) {
      state.noToy = nt;
      effects.push({ type: 'no_toy', objectId: null, payload: { active: nt } });
    }

    if (state.babies.some(b => b.satLow)) state.satLowTime += dt;

    let logged = 0;
    const verdict = judge(state);
    if (verdict === 'fail') logged = finishStage(false, effects, logged);
    else if (verdict === 'clear') logged = finishStage(true, effects, logged);

    effects.push(...pending);
    pending = [];
    flushLog(effects, logged);
    return effects;
  }

  function dispatch(action) {
    if (!action) return;
    switch (action.type) {
      case 'start':
        if (state.screen === 'title') {
          state.mode = 'campaign';
          state.totalScore = 0;
          enterLoading('tutorial', 0);
        }
        break;
      // タイトルのステージ選択（§9.4）。選んだステージだけを遊び、結果画面からタイトルへ戻る
      case 'selectStage': {
        if (state.screen !== 'title') break;
        const i = action.index | 0;
        if (i < 0 || i >= stages.length) break;
        state.mode = 'single';
        state.totalScore = 0;
        enterLoading('play', i);
        break;
      }
      case 'assetsReady':
        if (state.screen === 'loading') state.loading.ready = true;
        break;
      case 'tutorialOk':
        if (state.screen === 'tutorial') {
          setupStage(0);
          transition('play');
        }
        break;
      case 'next':
        if (state.screen === 'stageResult' && state.result && state.result.cleared) {
          // ステージ選択で遊んでいるときは次へ進まず、まとめ（finalResult）を出してタイトルへ戻す
          if (state.mode === 'single') transition('finalResult');
          else if (state.stageIndex + 1 < stages.length) enterLoading('play', state.stageIndex + 1);
          else transition('finalResult');
        }
        break;
      case 'retry':
        if (state.screen === 'stageResult' && state.result && !state.result.cleared) {
          enterLoading('play', state.stageIndex);
        }
        break;
      case 'toTitle':
        state.mode = 'campaign';
        state.totalScore = 0;
        state.shownTipIds.length = 0;
        state.result = null;
        state.tip = null;
        state.tutorialTip = null;
        state.press = null;
        state.drag = null;
        transition('title');
        break;
      default:
        break;
    }
  }

  function input(event) {
    if (!event || state.screen !== 'play') return;
    switch (event.type) {
      case 'pressStart': pressStart(event.targetId); break;
      case 'pressEnd': cancelPress(); break;
      case 'dragStart': dragStart(event.targetId, event.x, event.y); break;
      case 'dragMove': dragMove(event.x, event.y); break;
      case 'dragEnd': dragEnd(event.x, event.y); break;
      default: break;
    }
  }

  function startStage(index, { skipLoading = true } = {}) {
    if (skipLoading) {
      setupStage(index);
      transition('play');
    } else {
      enterLoading('play', index);
    }
  }

  return { state, update, dispatch, input, startStage };
}
