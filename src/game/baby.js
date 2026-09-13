// 赤ちゃんの生成・毎フレーム更新（目標選択・移動・接触・遊び・手放し・ぐずり・介入）。§3, §4, CONTRACT §5-6, §9.5。
import { ROOM } from './stages.js';
import { weightedPick } from './rng.js';
import {
  dist, clamp, isWalkable, snapToFloor, findObject, setBored,
  isClimbable, isClimbBored, isBoredNow, isMouthable, climbWallFor, climbTopPoint, climbFrontPoint
} from './objects.js';
import { findCombo, comboTriggers } from './combos.js';
import { interventionAmount, registerHiyari } from './scoring.js';

export function createBaby(index, spawn, baseSpeed, tuning) {
  return {
    id: `baby${index}`,
    x: spawn.x, y: spawn.y, speed: baseSpeed,
    targetId: null, carrying: null, carriedBoredAt: null,
    playUntil: 0, stunUntil: 0,
    satisfaction: tuning.SAT_START,
    fussUntil: 0, lastInterventionAt: -Infinity,
    isHeld: false, holdProgress: 0,
    anim: 'crawl',
    fussing: false, satLow: false,
    comboWarnHazardId: null,
    climbing: null,             // 登っている家具の id（CONTRACT §10.1）。登っている間は移動・接触なし、anim 'climb'
    climbUntil: 0,              // 自分で降りる時刻（elapsed）
    mouthing: null,             // 口に入れている物 { objectId, until }（CONTRACT §11.1）。間は移動・接触・満足度減衰なし、anim 'mouth'
    // ---- 動きの自然さ（CONTRACT §9.5）。描画層・sim は読み取りのみ ----
    moodMult: 1,                // 機嫌による速度倍率 1 + MOOD_SPEED_GAIN × ((100−sat)/100)^2
    speedK: 1,                  // 速度ゆらぎ係数（MOVE_SPEED_K_MIN..MAX）。speed = base × max(倍率) × speedK
    pauseUntil: 0,              // 立ち止まり中は elapsed < pauseUntil（anim 'idle'）
    headingOff: 0,              // 直進方向からのオフセット角（rad）。目標に近づくと 0 へ収束
    // ---- 以下は内部用（描画層は参照しない）----
    spawnIndex: index,
    baseSpeed,
    dirX: 0, dirY: 1,           // 直近の移動方向（持ち toy のオフセット用）
    playToyId: null,            // 遊んでいる toy
    pendingFuss: false,         // 抱き上げドロップ後、停止明けにぐずりを開始する
    needReselect: false,        // 外部イベントによる目標再選択の要求
    prevTargetId: null,
    idleTarget: null,
    stuckX: spawn.x, stuckY: spawn.y, stuckSec: 0,
    comboWarnToyId: null,
    speedKTarget: 1, speedKNextAt: 0,     // ゆらぎの目標係数と次に選び直す時刻
    headingOffTarget: 0, headingNextAt: 0, // オフセット角の目標値と次に選び直す時刻
    pauseReselect: false                   // 立ち止まり明けに目標を選び直す（気が変わる）
  };
}

// ---- 目標選択 -------------------------------------------------------------

// 別の赤ちゃんがその家具に登っているか
function isClimbedByOther(obj, baby, state) {
  for (const b of state.babies) if (b !== baby && b.climbing === obj.id) return true;
  return false;
}

function otherTargets(baby, state) {
  const ids = [];
  for (const b of state.babies) if (b !== baby && b.targetId != null) ids.push(b.targetId);
  return ids;
}

export function isCandidate(obj, baby, state, others = otherTargets(baby, state)) {
  if (obj.kind === 'goods' || obj.kind === 'container' || obj.kind === 'prop') return false; // 安全グッズ・容れ物・ダミーは赤ちゃんの目標にならない
  if (others.includes(obj.id)) return false;
  if (state.drag && state.drag.targetId === obj.id) return false;      // 大人の手の中にあるものは目標にしない
  if (obj.carriedBy != null && obj.carriedBy !== baby.id) return false; // 別の赤ちゃんの口の中・猫の口の中（§11.1, §11.5）
  if (obj.climbable) {
    // 登れる家具（§10.1）：open でも fixed でも候補。飽きている間と、別の赤ちゃんが登っている間は候補外
    if (obj.state !== 'open' && obj.state !== 'fixed') return false;
    if (isClimbBored(obj, state.elapsed)) return false;
    return !isClimbedByOther(obj, baby, state);
  }
  if (obj.kind === 'toy') {
    return obj.state === 'available' && obj.carriedBy == null &&
      (obj.playingBy == null || obj.playingBy === baby.id);
  }
  if (obj.carriedBy != null) return false;
  if (isBoredNow(obj, state.elapsed)) return false;                    // 口から手放した直後の hazard/item（§11.1）
  if (obj.state === 'open') return true;
  // 持っている toy と ignoresFix の combo が成立する hazard は fixed でも候補（「スプーンをコンセントに差したい」）
  if (obj.kind === 'hazard' && obj.state === 'fixed' && baby.carrying != null) {
    const combo = findCombo(state.stage, baby.carrying, obj.id);
    return !!(combo && combo.ignoresFix);
  }
  return false;
}

export function candidatesFor(baby, state) {
  const others = otherTargets(baby, state);
  return state.objects.filter(o => isCandidate(o, baby, state, others));
}

function hazardBase(baby, tuning) {
  let base = tuning.WEIGHT_HAZARD;
  if (baby.satLow) base = Math.max(base, tuning.WEIGHT_HAZARD_BORED);
  if (baby.fussing) base = Math.max(base, tuning.FUSS_HAZARD_WEIGHT);
  return base;
}

export function targetWeight(obj, baby, state, tuning) {
  let base;
  if (obj.kind === 'toy') {
    // 合成 toy は自身の targetWeight を優先（省略時 WEIGHT_TOY。weight は重さ 'light'|'heavy'）。ドラッグ直後は WEIGHT_TOY_DRAGGED との大きい方
    const own = typeof obj.targetWeight === 'number' ? obj.targetWeight : tuning.WEIGHT_TOY;
    const dragged = obj.draggedAt != null && state.elapsed - obj.draggedAt < tuning.DRAGGED_WEIGHT_SEC;
    base = dragged ? Math.max(own, tuning.WEIGHT_TOY_DRAGGED) : own;
  } else if (obj.climbable) {
    base = tuning.CLIMB_WEIGHT;
  } else {
    base = hazardBase(baby, tuning);
    // 持っている toy と combo が成立する hazard（open、または fixed+ignoresFix）は COMBO_ATTRACT 倍
    if (obj.kind === 'hazard' && baby.carrying != null) {
      const combo = findCombo(state.stage, baby.carrying, obj.id);
      if (combo && comboTriggers(combo, obj.state)) base *= tuning.COMBO_ATTRACT;
    }
  }
  return base / (dist(baby, obj) + 100);
}

function resetStuck(baby) {
  baby.stuckX = baby.x;
  baby.stuckY = baby.y;
  baby.stuckSec = 0;
}

// 重み付きランダムで目標を選ぶ。候補なしなら targetId=null（idle）。halveId の候補は重みを半分にする
export function selectTarget(baby, state, tuning, rng, { halveId = null } = {}) {
  const cands = candidatesFor(baby, state);
  resetStuck(baby);
  baby.needReselect = false;
  if (cands.length === 0) {
    baby.prevTargetId = baby.targetId;
    baby.targetId = null;
    return null;
  }
  const weights = cands.map(o => {
    let w = targetWeight(o, baby, state, tuning);
    if (halveId != null && o.id === halveId) w *= 0.5;
    return w;
  });
  const pick = weightedPick(rng, cands, weights);
  baby.prevTargetId = baby.targetId;
  baby.targetId = pick.id;
  baby.idleTarget = null;
  return pick;
}

export function requestReselectAll(state) {
  for (const b of state.babies) b.needReselect = true;
}

// ---- 移動 -----------------------------------------------------------------

// 目標点へ speed*dt だけ進む。フル移動→x のみ→y のみ→垂直方向へ回避、の順に試す
export function moveToward(baby, tx, ty, speed, dt, walls, tuning) {
  const dx = tx - baby.x;
  const dy = ty - baby.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.01 || speed <= 0) return false;
  const step = Math.min(speed * dt, d);
  const ux = dx / d;
  const uy = dy / d;
  const r = tuning.BABY_RADIUS;
  const nx = baby.x + ux * step;
  const ny = baby.y + uy * step;
  baby.dirX = ux;
  baby.dirY = uy;
  const tries = [
    [nx, ny],
    [nx, baby.y],
    [baby.x, ny],
    [baby.x - uy * step, baby.y + ux * step],
    [baby.x + uy * step, baby.y - ux * step]
  ];
  for (let i = 0; i < tries.length; i++) {
    const [cx, cy] = tries[i];
    if ((i === 1 && Math.abs(ux) < 1e-6) || (i === 2 && Math.abs(uy) < 1e-6)) continue;
    if (isWalkable(cx, cy, walls, r)) {
      baby.x = cx;
      baby.y = cy;
      return true;
    }
  }
  return false;
}

// 目標点 (tx,ty) へ、オフセット角 headingOff だけ回した方向で進む。塞がれたら直進で再試行
function moveTowardWithHeading(baby, tx, ty, speed, dt, walls, tuning) {
  const off = baby.headingOff;
  if (Math.abs(off) > 1e-4) {
    const dx = tx - baby.x;
    const dy = ty - baby.y;
    const c = Math.cos(off);
    const sn = Math.sin(off);
    const ax = baby.x + dx * c - dy * sn;
    const ay = baby.y + dx * sn + dy * c;
    if (moveToward(baby, ax, ay, speed, dt, walls, tuning)) return true;
  }
  return moveToward(baby, tx, ty, speed, dt, walls, tuning);
}

const uniform = (rng, range) => range[0] + (range[1] - range[0]) * rng();
const approach = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, rate * dt);

// 速度ゆらぎ係数の更新（§9.5）。bad = 機嫌が悪い（satLow または ぐずり）→ 下限を MOVE_SPEED_K_MIN_BAD に
function updateSpeedWobble(baby, t, tuning, rng, dt, bad) {
  const kMin = bad ? tuning.MOVE_SPEED_K_MIN_BAD : tuning.MOVE_SPEED_K_MIN;
  if (t >= baby.speedKNextAt) {
    baby.speedKTarget = kMin + (tuning.MOVE_SPEED_K_MAX - kMin) * rng();
    baby.speedKNextAt = t + uniform(rng, tuning.MOVE_SPEED_RETARGET_SEC);
  }
  const target = Math.max(kMin, baby.speedKTarget);
  baby.speedK = approach(baby.speedK, target, tuning.MOVE_SPEED_FOLLOW, dt);
}

// 向きの揺れ：0.5〜1.2 秒ごとに ±MAX_DEG 以内の新しいオフセットへ滑らかに。目標が近ければ 0 へ収束
function updateHeading(baby, t, tuning, rng, dt, distToTarget) {
  if (t >= baby.headingNextAt) {
    const max = (tuning.MOVE_HEADING_MAX_DEG * Math.PI) / 180;
    baby.headingOffTarget = (rng() * 2 - 1) * max;
    baby.headingNextAt = t + uniform(rng, tuning.MOVE_HEADING_RETARGET_SEC);
  }
  const target = distToTarget < tuning.MOVE_HEADING_ZERO_DIST ? 0 : baby.headingOffTarget;
  baby.headingOff = approach(baby.headingOff, target, tuning.MOVE_HEADING_FOLLOW, dt);
  if (distToTarget < tuning.MOVE_HEADING_ZERO_DIST && Math.abs(baby.headingOff) < 0.02) baby.headingOff = 0;
}

// 立ち止まり：平均 MOVE_PAUSE_MEAN_SEC に 1 回（機嫌が悪ければ半分の頻度）。戻り値 true なら今フレームは動かない
function updatePause(baby, t, tuning, rng, dt, bad) {
  if (t < baby.pauseUntil) return true;
  if (baby.pauseReselect) {
    baby.pauseReselect = false;
    if (rng() < tuning.MOVE_PAUSE_RESELECT) baby.needReselect = true;
  }
  const mean = tuning.MOVE_PAUSE_MEAN_SEC * (bad ? 2 : 1);
  if (mean > 0 && rng() < dt / mean) {
    baby.pauseUntil = t + uniform(rng, tuning.MOVE_PAUSE_SEC);
    baby.pauseReselect = true;
    return true;
  }
  return false;
}

function followCarried(baby, state) {
  if (baby.carrying != null) {
    const toy = findObject(state, baby.carrying);
    if (toy) {
      toy.x = baby.x + baby.dirX * 18;
      toy.y = baby.y + baby.dirY * 18;
    }
  }
  if (baby.mouthing != null) {
    // 口元（進行方向に少し前）
    const o = findObject(state, baby.mouthing.objectId);
    if (o) {
      o.x = baby.x + baby.dirX * 10;
      o.y = baby.y + baby.dirY * 10;
    }
  }
}

function idleWander(baby, state, tuning, rng, dt) {
  if (!baby.idleTarget || dist(baby, baby.idleTarget) < 4) {
    const p = snapToFloor(ROOM.cx + (rng() * 2 - 1) * 60, ROOM.cy + (rng() * 2 - 1) * 60, state.stage.walls, tuning);
    baby.idleTarget = p;
  }
  moveTowardWithHeading(baby, baby.idleTarget.x, baby.idleTarget.y, baby.speed * 0.4, dt, state.stage.walls, tuning);
}

// ---- 手放し・介入・ぐずり ---------------------------------------------------

// carrying の toy を (x,y) の床に置く（床スナップ）。取り上げ長押し中なら解除
export function dropCarried(baby, state, tuning, effects, reason, x = baby.x, y = baby.y) {
  const toyId = baby.carrying;
  if (toyId == null) return null;
  const toy = findObject(state, toyId);
  if (toy) {
    const p = snapToFloor(x, y, state.stage.walls, tuning);
    toy.x = p.x;
    toy.y = p.y;
    toy.carriedBy = null;
    effects.push({ type: 'drop', objectId: toy.id, payload: { babyId: baby.id, reason } });
  }
  baby.carrying = null;
  baby.carriedBoredAt = null;
  cancelTakeawayPress(baby, state);
  return toy;
}

export function cancelTakeawayPress(baby, state) {
  if (state.press && state.press.targetId === baby.id) state.press = null;
  baby.holdProgress = 0;
}

export function startFuss(baby, state, tuning, effects) {
  const until = state.elapsed + tuning.FUSS_SEC;
  baby.fussUntil = until;
  baby.fussing = true;
  baby.needReselect = true;
  effects.push({ type: 'fuss_start', objectId: baby.id, payload: { until } });
}

// 介入ペナルティ（抱き上げ 'pickup' / 取り上げ 'takeaway'）
export function applyIntervention(baby, state, tuning, effects, kind, extra = {}) {
  const amount = interventionAmount(baby, kind, state.elapsed, tuning);
  baby.satisfaction = clamp(baby.satisfaction + amount, 0, 100);
  baby.lastInterventionAt = state.elapsed;
  state.interventions++;
  if (baby.fussUntil > state.elapsed) baby.fussUntil = state.elapsed + tuning.FUSS_SEC;
  effects.push({ type: kind, objectId: baby.id, payload: { amount, ...extra } });
  effects.push({ type: 'sat_delta', objectId: baby.id, payload: { amount, x: baby.x, y: baby.y, reason: kind } });
  return amount;
}

// ---- 口に入れる（CONTRACT §11.1, §11.4）-------------------------------------------

// 口に入れている物を床（足元）に置いて mouthing を解除する。boredUntil = elapsed + TAKEAWAY_BORED_SEC（すぐ拾い直さない）。
// toy（§11.4）は遊び終えて bored のままなので、boredUntil はより遠い方を残す。戻り値は物（無ければ null）
function releaseMouthed(baby, state, tuning, effects, reason, x = baby.x, y = baby.y) {
  const m = baby.mouthing;
  if (!m) return null;
  const o = findObject(state, m.objectId);
  baby.mouthing = null;
  if (o) {
    const p = snapToFloor(x, y, state.stage.walls, tuning);
    o.x = p.x;
    o.y = p.y;
    if (o.carriedBy === baby.id) o.carriedBy = null;
    const until = state.elapsed + tuning.TAKEAWAY_BORED_SEC;
    if (o.kind === 'toy') {
      if (o.state !== 'removed') o.boredUntil = Math.max(o.boredUntil ?? 0, until);
    } else if (o.state === 'open') {
      o.boredUntil = until;
    }
    if (reason) effects.push({ type: 'drop', objectId: o.id, payload: { babyId: baby.id, reason } });
  }
  baby.holdProgress = 0;
  baby.needReselect = true;
  return o;
}

// 口に入れ始める：carrying の toy は足元に落とす（reason 'mouth'）。until は elapsed + rng∈[MOUTH_SEC_MIN, MOUTH_SEC_MAX]
function startMouthing(baby, obj, state, tuning, rng, effects) {
  if (baby.carrying != null && baby.carrying !== obj.id) dropCarried(baby, state, tuning, effects, 'mouth');
  baby.carrying = null;
  baby.carriedBoredAt = null;
  const sec = tuning.MOUTH_SEC_MIN + (tuning.MOUTH_SEC_MAX - tuning.MOUTH_SEC_MIN) * rng();
  const until = state.elapsed + sec;
  obj.carriedBy = baby.id;
  obj.playingBy = null;
  baby.mouthing = { objectId: obj.id, until };
  baby.anim = 'mouth';
  baby.targetId = null;
  baby.playToyId = null;
  baby.playUntil = 0;
  baby.idleTarget = null;
  baby.headingOff = 0;
  baby.headingOffTarget = 0;
  resetStuck(baby);
  followCarried(baby, state);
  effects.push({ type: 'mouth_start', objectId: obj.id, payload: { babyId: baby.id, until } });
}

// 口に入れている間の毎フレーム処理。戻り値 true なら今フレームはここで終わり
function updateMouthing(baby, state, tuning, rng, effects) {
  const m = baby.mouthing;
  if (!m) return false;
  const o = findObject(state, m.objectId);
  const t = state.elapsed;
  if (!o || o.state === 'removed' || o.carriedBy !== baby.id) {
    // 物が無くなった（通常は起きない）
    baby.mouthing = null;
    baby.needReselect = true;
    return false;
  }
  if (t < m.until) {
    baby.anim = 'mouth';
    followCarried(baby, state);
    updateComboWarn(baby, state, tuning, effects);
    return true;
  }
  if (rng() < tuning.MOUTH_INGEST_PROB) {
    // 飲み込んだ：通常のヒヤリ。物は接触地点（赤ちゃんは動いていないので現在地）に残る
    const p = snapToFloor(baby.x, baby.y, state.stage.walls, tuning);
    baby.mouthing = null;
    o.carriedBy = null;
    o.x = p.x;
    o.y = p.y;
    onHiyari(baby, { obj: o, combo: null }, state, tuning, effects, null, { mouth: true });
  } else {
    releaseMouthed(baby, state, tuning, effects, null);
    effects.push({ type: 'mouth_release', objectId: o.id, payload: { babyId: baby.id } });
    baby.anim = 'crawl';
  }
  updateComboWarn(baby, state, tuning, effects);
  return true;
}

// 取り上げ：足元に落として TAKEAWAY_BORED_SEC の間 bored、ペナルティ、即ぐずり、目標再選択。
// 口に入れている物（§11.1）も同じ長押しで取り上げる（effect takeaway の toyId はその物の id、mouth:true）
export function doTakeaway(baby, state, tuning, effects) {
  if (baby.mouthing != null) {
    const objectId = baby.mouthing.objectId;
    applyIntervention(baby, state, tuning, effects, 'takeaway', { toyId: objectId, mouth: true });
    releaseMouthed(baby, state, tuning, effects, 'takeaway');
    startFuss(baby, state, tuning, effects);
    baby.anim = 'fuss';
    baby.holdProgress = 0;
    baby.needReselect = true;
    return;
  }
  const toyId = baby.carrying;
  if (toyId == null) return;
  applyIntervention(baby, state, tuning, effects, 'takeaway', { toyId });
  const toy = dropCarried(baby, state, tuning, effects, 'takeaway');
  if (toy) setBored(toy, state.elapsed + tuning.TAKEAWAY_BORED_SEC, effects);
  startFuss(baby, state, tuning, effects);
  baby.holdProgress = 0;
  baby.needReselect = true;
}

// 抱き上げ開始（dragStart baby）
export function pickUp(baby, state, tuning, effects) {
  if (baby.playToyId != null) {
    const toy = findObject(state, baby.playToyId);
    if (toy && toy.playingBy === baby.id) toy.playingBy = null;
    baby.playToyId = null;
    baby.playUntil = 0;
  }
  cancelTakeawayPress(baby, state);
  baby.climbing = null;          // 登っていれば抱き下ろす（§10.1）
  baby.climbUntil = 0;
  if (baby.mouthing != null) releaseMouthed(baby, state, tuning, effects, 'pickup'); // 口の物は床に落ちる（§11.1）
  baby.isHeld = true;
  baby.anim = 'held';
  baby.pendingFuss = false;
  applyIntervention(baby, state, tuning, effects, 'pickup');
}

// 抱き上げ解放（dragEnd baby）：床スナップ、停止、停止明けにぐずり＋目標再選択
export function putDown(baby, state, tuning, x, y) {
  const p = snapToFloor(x, y, state.stage.walls, tuning);
  baby.x = p.x;
  baby.y = p.y;
  baby.isHeld = false;
  baby.stunUntil = state.elapsed + tuning.STUN_SEC;
  baby.anim = 'stun';
  baby.pendingFuss = true;
  baby.needReselect = true;
  resetStuck(baby);
  followCarried(baby, state);
}

// ---- 遊び ---------------------------------------------------------------

function startPlay(baby, toy, state, tuning, effects) {
  baby.playUntil = state.elapsed + tuning.PLAY_SEC;
  baby.playToyId = toy.id;
  baby.targetId = toy.id;
  baby.anim = 'play';
  toy.playingBy = baby.id;
  effects.push({ type: 'play_start', objectId: toy.id, payload: { babyId: baby.id } });
}

// 遊び回数別の満足度回復：toy.satPlay（合成 toy）を優先、省略時は SAT_PLAY_BY_COUNT
export function playAmount(toy, tuning) {
  const table = Array.isArray(toy.satPlay) && toy.satPlay.length ? toy.satPlay : tuning.SAT_PLAY_BY_COUNT;
  const idx = Math.min(Math.max(0, toy.playCount - 1), table.length - 1);
  return table[idx];
}

function finishPlay(baby, state, tuning, rng, effects) {
  const toy = findObject(state, baby.playToyId);
  baby.playToyId = null;
  if (!toy || toy.state === 'removed' || toy.playingBy !== baby.id) return;
  toy.playingBy = null;
  toy.playCount++;
  state.playCount++;
  const idx = Math.min(toy.playCount - 1, 2);
  let amount = playAmount(toy, tuning);
  if (baby.fussUntil > state.elapsed) amount = Math.min(amount, tuning.FUSS_PLAY_SAT);
  baby.satisfaction = Math.min(100, baby.satisfaction + amount);
  effects.push({ type: 'play_done', objectId: toy.id, payload: { babyId: baby.id, amount, playCount: toy.playCount } });
  effects.push({ type: 'sat_delta', objectId: baby.id, payload: { amount, x: baby.x, y: baby.y, reason: 'play' } });
  setBored(toy, state.elapsed + tuning.BORED_SEC_BASE + tuning.BORED_SEC_STEP * idx, effects);
  // 危険なおもちゃ（§11.4）：持ち歩く代わりに部品を口に入れる
  if (toy.ingestible === true && rng() < tuning.RISKY_TOY_PROB) {
    startMouthing(baby, toy, state, tuning, rng, effects);
    return;
  }
  if (baby.carrying != null) dropCarried(baby, state, tuning, effects, 'next_toy');
  baby.carrying = toy.id;
  baby.carriedBoredAt = state.elapsed;
  toy.carriedBy = baby.id;
  baby.targetId = null;
  baby.needReselect = true;
}

// ---- 接触 -----------------------------------------------------------------

// ヒヤリになる接触を探す。戻り値 { obj, combo } または null
function findHiyariContact(baby, state, tuning) {
  for (const o of state.objects) {
    if (o.kind !== 'hazard' && o.kind !== 'item') continue; // toy / goods / container は接触判定しない
    if (o.state === 'removed') continue;
    if (o.climbable) continue;                                  // 登れる家具は接触でヒヤリにならない（findClimbContact）
    if (state.drag && state.drag.targetId === o.id) continue;   // 大人が持ち上げているものには触れない
    if (o.carriedBy != null) continue;                          // 別の赤ちゃんの口の中・猫の口の中
    if (isBoredNow(o, state.elapsed)) continue;                 // 口から手放した直後（§11.1）
    if (dist(baby, o) >= tuning.TOUCH_DIST) continue;
    const combo = o.kind === 'hazard' ? findCombo(state.stage, baby.carrying, o.id) : null;
    if (o.state === 'open') return { obj: o, combo };
    if (o.state === 'fixed' && combo && comboTriggers(combo, o.state)) return { obj: o, combo };
  }
  return null;
}

// drop: 持っていた toy を落とす位置（省略時は赤ちゃんの現在地）。extra は hiyari payload への追加（§11.1 は {mouth:true}）
function onHiyari(baby, hit, state, tuning, effects, drop = null, extra = {}) {
  const cx = drop ? drop.x : baby.x;
  const cy = drop ? drop.y : baby.y;
  registerHiyari(state, baby, hit.obj, hit.combo, effects, extra);
  if (baby.carrying != null) dropCarried(baby, state, tuning, effects, 'hiyari', cx, cy);
  cancelTakeawayPress(baby, state);
  const spawn = state.stage.babySpawns[baby.spawnIndex] || state.stage.babySpawns[0];
  baby.x = spawn.x;
  baby.y = spawn.y;
  baby.stunUntil = state.elapsed + tuning.STUN_SEC;
  baby.anim = 'stun';
  baby.targetId = null;
  baby.playToyId = null;
  baby.playUntil = 0;
  baby.idleTarget = null;
  baby.needReselect = true;
  resetStuck(baby);
}

// ---- 登り（CONTRACT §10.1）--------------------------------------------------

// 登れる家具への接触。飽きている家具・別の赤ちゃんが登っている家具は登らない（候補除外と同じ扱い）
function findClimbContact(baby, state, tuning) {
  for (const o of state.objects) {
    if (!isClimbable(o)) continue;
    if (o.state !== 'open' && o.state !== 'fixed') continue;
    if (isClimbBored(o, state.elapsed)) continue;
    if (isClimbedByOther(o, baby, state)) continue;
    if (dist(baby, o) < tuning.TOUCH_DIST) return o;
  }
  return null;
}

function startClimb(baby, obj, state, tuning, effects) {
  const wall = climbWallFor(obj, state.stage.walls);
  const top = climbTopPoint(obj, wall, baby.x, tuning);
  baby.x = top.x;
  baby.y = top.y;
  baby.climbing = obj.id;
  baby.climbUntil = state.elapsed + tuning.CLIMB_SEC;
  baby.anim = 'climb';
  baby.targetId = null;
  baby.playToyId = null;
  baby.playUntil = 0;
  baby.idleTarget = null;
  baby.headingOff = 0;
  baby.headingOffTarget = 0;
  resetStuck(baby);
  followCarried(baby, state);
  effects.push({ type: 'climb_start', objectId: obj.id, payload: { babyId: baby.id } });
}

// 家具の前の床へ降りる（共通）。家具は CLIMB_BORED_SEC の間、候補外
function leaveClimb(baby, obj, state, tuning) {
  const p = climbFrontPoint(obj, baby.x, state.stage.walls, tuning);
  baby.x = p.x;
  baby.y = p.y;
  baby.climbing = null;
  baby.climbUntil = 0;
  baby.targetId = null;
  baby.needReselect = true;
  obj.boredUntil = state.elapsed + tuning.CLIMB_BORED_SEC;
  resetStuck(baby);
  return p;
}

// 登っている間の毎フレーム処理。戻り値 true なら今フレームはここで終わり
function updateClimb(baby, state, tuning, rng, effects, dt) {
  const obj = findObject(state, baby.climbing);
  const t = state.elapsed;
  if (!obj || obj.state === 'removed') {
    // 家具が無くなった（通常は起きない）：最寄りの床へ降りる
    const p = snapToFloor(baby.x, baby.y, state.stage.walls, tuning);
    baby.x = p.x;
    baby.y = p.y;
    baby.climbing = null;
    baby.climbUntil = 0;
    baby.needReselect = true;
    resetStuck(baby);
    return false;
  }
  baby.satisfaction = clamp(baby.satisfaction + tuning.CLIMB_SAT_PER_SEC * dt, 0, 100);
  // 転落判定
  if (rng() < tuning.CLIMB_FALL_PROB_PER_SEC * dt) {
    if (obj.state === 'open') {
      // マット無し：通常のヒヤリ（転落）。toy は家具の前に落ちる
      const front = climbFrontPoint(obj, baby.x, state.stage.walls, tuning);
      baby.climbing = null;
      baby.climbUntil = 0;
      obj.boredUntil = t + tuning.CLIMB_BORED_SEC;
      onHiyari(baby, { obj, combo: null }, state, tuning, effects, front);
    } else {
      // マット有り：家具の前の床に降りて停止。ヒヤリにしない
      leaveClimb(baby, obj, state, tuning);
      baby.stunUntil = t + tuning.STUN_SEC;
      baby.anim = 'stun';
      effects.push({ type: 'climb_fall_safe', objectId: obj.id, payload: { babyId: baby.id } });
    }
    followCarried(baby, state);
    updateComboWarn(baby, state, tuning, effects);
    return true;
  }
  if (t >= baby.climbUntil) {
    leaveClimb(baby, obj, state, tuning);
    baby.anim = 'crawl';
    effects.push({ type: 'climb_end', objectId: obj.id, payload: { babyId: baby.id } });
    followCarried(baby, state);
    updateComboWarn(baby, state, tuning, effects);
    return true;
  }
  baby.anim = 'climb';
  followCarried(baby, state);
  updateComboWarn(baby, state, tuning, effects);
  return true;
}

function findToyContact(baby, state, tuning) {
  for (const o of state.objects) {
    if (o.kind !== 'toy') continue;
    if (o.state !== 'available' || o.carriedBy != null || o.playingBy != null) continue;
    if (state.drag && state.drag.targetId === o.id) continue;
    if (dist(baby, o) < tuning.TOUCH_DIST) return o;
  }
  return null;
}

// combo 予告（持っている toy と combo が成立する hazard に接近）
function updateComboWarn(baby, state, tuning, effects) {
  let warnId = null;
  if (baby.carrying != null && !baby.isHeld) {
    for (const o of state.objects) {
      if (o.kind !== 'hazard') continue;
      const combo = findCombo(state.stage, baby.carrying, o.id);
      if (!combo || !comboTriggers(combo, o.state)) continue;
      if (dist(baby, o) < tuning.COMBO_WARN_DIST) { warnId = o.id; break; }
    }
  }
  if (warnId === baby.comboWarnHazardId) return;
  if (baby.comboWarnHazardId != null) {
    effects.push({ type: 'combo_warn', objectId: baby.comboWarnHazardId, payload: { babyId: baby.id, toyId: baby.comboWarnToyId, active: false } });
  }
  baby.comboWarnHazardId = warnId;
  baby.comboWarnToyId = warnId != null ? baby.carrying : null;
  if (warnId != null) {
    effects.push({ type: 'combo_warn', objectId: warnId, payload: { babyId: baby.id, toyId: baby.carrying, active: true } });
  }
}

// ---- 毎フレーム更新 ---------------------------------------------------------

export function updateBaby(baby, state, tuning, rng, effects, dt) {
  const t = state.elapsed;

  // 状態フラグと速度
  const fussingNow = baby.fussUntil > t;
  const satLowNow = baby.satisfaction < tuning.SAT_LOW;
  if (baby.fussing && !fussingNow) {
    effects.push({ type: 'fuss_end', objectId: baby.id, payload: {} });
    baby.needReselect = true;
  }
  if (baby.satLow !== satLowNow) baby.needReselect = true;
  baby.fussing = fussingNow;
  baby.satLow = satLowNow;
  const bad = satLowNow || fussingNow;
  // 機嫌による連続的な速度倍率（§9.5）。satLow / ぐずりの倍率とは最大値を採用（乗算しない）
  const low = clamp((100 - baby.satisfaction) / 100, 0, 1);
  baby.moodMult = 1 + (tuning.MOOD_SPEED_GAIN ?? 0) * low * low;
  let mult = baby.moodMult;
  if (satLowNow) mult = Math.max(mult, tuning.BORED_SPEED_MULT);
  if (fussingNow) mult = Math.max(mult, tuning.FUSS_SPEED_MULT);
  updateSpeedWobble(baby, t, tuning, rng, dt, bad);
  baby.speed = baby.baseSpeed * mult * baby.speedK;

  const playing = baby.playToyId != null && baby.playUntil > t;

  // 満足度の減衰（遊び中・抱き上げ中・登っている間・口に入れている間は減らない）
  if (!baby.isHeld && !playing && baby.climbing == null && baby.mouthing == null) {
    const rate = state.noToy ? tuning.SAT_NO_TOY : tuning.SAT_IDLE;
    baby.satisfaction = clamp(baby.satisfaction + rate * dt, 0, 100);
  }

  if (baby.isHeld) {
    baby.anim = 'held';
    followCarried(baby, state);
    updateComboWarn(baby, state, tuning, effects);
    return;
  }

  // 登っている（§10.1）：移動・接触なし。転落／降りる判定だけ
  if (baby.climbing != null && updateClimb(baby, state, tuning, rng, effects, dt)) return;

  // 停止（ヒヤリ後・抱き上げドロップ後）
  if (baby.stunUntil > t) {
    baby.anim = 'stun';
    followCarried(baby, state);
    updateComboWarn(baby, state, tuning, effects);
    return;
  }

  // 口に入れている（§11.1）：移動・接触なし。until で 飲み込む／手放す
  if (baby.mouthing != null && updateMouthing(baby, state, tuning, rng, effects)) return;
  if (baby.pendingFuss) {
    baby.pendingFuss = false;
    startFuss(baby, state, tuning, effects);
    baby.fussing = true;
    baby.speed = baby.baseSpeed * Math.max(mult, tuning.FUSS_SPEED_MULT) * baby.speedK;
  }

  // 遊び
  if (baby.playToyId != null && !playing) {
    finishPlay(baby, state, tuning, rng, effects);
    if (baby.mouthing != null) { // 危険なおもちゃの部品を口に入れた（§11.4）
      updateComboWarn(baby, state, tuning, effects);
      return;
    }
  }
  if (playing) {
    baby.anim = 'play';
    followCarried(baby, state);
    updateComboWarn(baby, state, tuning, effects);
    return;
  }

  // 飽きた toy の手放し
  if (baby.carrying != null && baby.carriedBoredAt != null && t - baby.carriedBoredAt >= tuning.DROP_AFTER_SEC) {
    dropCarried(baby, state, tuning, effects, 'bored');
    baby.needReselect = true;
  }

  // 目標の妥当性と再選択
  if (baby.targetId != null) {
    const tgt = findObject(state, baby.targetId);
    if (!tgt || !isCandidate(tgt, baby, state)) {
      baby.targetId = null;
      baby.needReselect = true;
    }
  }
  if (baby.needReselect || baby.targetId == null) selectTarget(baby, state, tuning, rng);

  // 立ち止まり（§9.5）。止まっている間はスタック検出を進めない。立ち止まり明けに「気が変わる」ことがある
  const paused = updatePause(baby, t, tuning, rng, dt, bad);
  if (baby.needReselect) selectTarget(baby, state, tuning, rng);

  // 移動
  const walls = state.stage.walls;
  if (baby.targetId != null) {
    const tgt = findObject(state, baby.targetId);
    const d = dist(baby, tgt);
    updateHeading(baby, t, tuning, rng, dt, d);
    if (paused) {
      baby.anim = baby.fussing ? 'fuss' : 'idle';
      resetStuck(baby);
    } else {
      moveTowardWithHeading(baby, tgt.x, tgt.y, baby.speed, dt, walls, tuning);
      baby.anim = baby.fussing ? 'fuss' : 'crawl';
      // スタック検出：STUCK_SEC の間 8px 未満しか動いていなければ再選択（直前の目標は重み半分）
      const moved = Math.sqrt((baby.x - baby.stuckX) ** 2 + (baby.y - baby.stuckY) ** 2);
      if (moved >= 8) {
        resetStuck(baby);
      } else {
        baby.stuckSec += dt;
        if (baby.stuckSec >= tuning.STUCK_SEC) {
          const prev = baby.targetId;
          baby.headingOff = 0;
          baby.headingOffTarget = 0;
          selectTarget(baby, state, tuning, rng, { halveId: prev });
        }
      }
    }
  } else {
    updateHeading(baby, t, tuning, rng, dt, baby.idleTarget ? dist(baby, baby.idleTarget) : Infinity);
    if (!paused) idleWander(baby, state, tuning, rng, dt);
    baby.anim = baby.fussing ? 'fuss' : 'idle';
  }
  followCarried(baby, state);

  // 接触判定。誤飲の軽い物（§11.1）は combo が成立しない限り即ヒヤリにせず口に入れる
  const hit = findHiyariContact(baby, state, tuning);
  if (hit) {
    if (!hit.combo && isMouthable(hit.obj)) startMouthing(baby, hit.obj, state, tuning, rng, effects);
    else onHiyari(baby, hit, state, tuning, effects);
    followCarried(baby, state);
    updateComboWarn(baby, state, tuning, effects);
    return;
  }
  const furniture = findClimbContact(baby, state, tuning);
  if (furniture) {
    startClimb(baby, furniture, state, tuning, effects);
    updateComboWarn(baby, state, tuning, effects);
    return;
  }
  const toy = findToyContact(baby, state, tuning);
  if (toy) startPlay(baby, toy, state, tuning, effects);

  updateComboWarn(baby, state, tuning, effects);
}
