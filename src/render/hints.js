// 両描画層で共有する「state からの導出」：ドラッグ中のヒント対象、収納済みの判定、飽きの残り割合。
// DOM / Canvas / THREE には触らない。契約 §8.2 / §9（v3：重さ・容れ物・高い場所）/ §11.2（高い場所の容量）。
import { TUNING } from '../game/stages.js';

/** ドラッグ中のオブジェクト（赤ちゃんをドラッグ中なら null） */
export function draggedObject(state) {
  const drag = state && state.drag;
  if (!drag) return null;
  return (state.objects || []).find(o => o.id === drag.targetId) || null;
}

/** 重い（動かせない）オブジェクトか。weight が無い古い定義は draggable で判断 */
export function isHeavy(o) {
  if (!o) return false;
  if (o.weight != null) return o.weight === 'heavy';
  return o.draggable === false;
}

/** 収納済み（高い場所・収納先に移して fixed になった軽い hazard） */
export function isStored(o) {
  return !!o && o.kind === 'hazard' && o.state === 'fixed' && o.storedIn != null;
}

/** storedIn / into が wall の model を指していればその wall、そうでなければ null */
export function findWall(stage, model) {
  if (!stage || model == null) return null;
  return (stage.walls || []).find(w => w.model === model) || null;
}

function alive(o, a) {
  return !!o && o !== a && o.state !== 'removed' && o.state !== 'used' && o.carriedBy == null;
}

/**
 * ドラッグ中のヒント対象（オブジェクト id）の Set。ドロップ判定（§9.3）の順に対応する：
 * - goods → `for` の hazard（open）／レシピ fix の相手
 * - toy   → レシピ toy（合成）の相手（床にあり、遊ばれていないもの）
 * - 軽い hazard → レシピ store の収納先（包丁 → 引き出し）
 * - item / toy / goods → 容れ物（container:true。kind 'container' または container 付き hazard）
 * 何もドラッグしていなければ空。
 */
export function hintTargets(state) {
  const hints = new Set();
  const a = draggedObject(state);
  if (!a) return hints;
  const objs = state.objects || [];
  const find = id => objs.find(o => o.id === id);

  if (a.kind === 'goods') {
    for (const id of a.for || []) {
      const hz = find(id);
      if (alive(hz, a) && (hz.state === 'open' || hz.state === 'fixing')) hints.add(id);
    }
  }
  for (const r of (state.stage && state.stage.recipes) || []) {
    const other = r.a === a.id ? r.b : (r.b === a.id ? r.a : null);
    if (!other) continue;
    const b = find(other);
    if (!alive(b, a)) continue;
    if (r.type === 'toy') {
      if (a.kind === 'toy' && b.kind === 'toy' && b.playingBy == null) hints.add(other);
    } else if (r.type === 'store') {
      if (a.kind === 'hazard' && r.a === a.id) hints.add(other);
    } else if (r.type === 'fix') {
      if (a.kind === 'goods' && b.kind === 'hazard' && (b.state === 'open' || b.state === 'fixing')) hints.add(other);
    }
  }
  if (a.kind === 'item' || a.kind === 'toy' || a.kind === 'goods' || a.kind === 'prop') {
    for (const o of objs) if (alive(o, a) && o.container) hints.add(o.id);
  }
  return hints;
}

/** 高い場所（wall）の容量（§11.2）。wall.capacity が無ければ TUNING.HIGH_PLACE_CAPACITY（既定 2） */
export function wallCapacity(wall) {
  if (wall && Number.isFinite(wall.capacity)) return wall.capacity;
  return Number.isFinite(TUNING.HIGH_PLACE_CAPACITY) ? TUNING.HIGH_PLACE_CAPACITY : 2;
}

/**
 * その wall に置かれている runtime object の数（`storedIn === wall.model` で fixed / removed のもの）。
 * respawn で床に戻ったもの（state が open 等）は数えない。
 */
export function highPlaceCount(state, wall) {
  if (!state || !wall) return 0;
  let n = 0;
  for (const o of state.objects || []) {
    if (o.storedIn === wall.model && (o.state === 'fixed' || o.state === 'removed')) n++;
  }
  return n;
}

/** 高い場所が満杯か（§11.2。満杯ならドロップは床ドロップになり `high_full` が出る） */
export function isHighPlaceFull(state, wall) {
  return !!wall && wall.highPlace && highPlaceCount(state, wall) >= wallCapacity(wall);
}

/** ドラッグ中にハイライトする「高い場所」（highPlace:true の wall）の model の Set。軽いものをドラッグ中のみ（満杯の wall も含む。満杯は isHighPlaceFull で判定して赤く描く） */
export function hintWalls(state) {
  const set = new Set();
  const a = draggedObject(state);
  if (!a || isHeavy(a)) return set;
  for (const w of (state.stage && state.stage.walls) || []) if (w.highPlace) set.add(w.model);
  return set;
}

/**
 * 飽きの残り割合 0..1。total は `bored` effect の (until - elapsed) を渡す。
 * 不明なら playCount から BORED_SEC_BASE + BORED_SEC_STEP*min(playCount-1, 2) と推定する。
 */
export function boredFraction(o, elapsed, total) {
  const remain = o.boredUntil != null ? Math.max(0, o.boredUntil - elapsed) : 0;
  let tot = total;
  if (!(tot > 0)) {
    const n = Math.max(0, Math.min(2, (o.playCount || 1) - 1));
    tot = TUNING.BORED_SEC_BASE + TUNING.BORED_SEC_STEP * n;
  }
  if (remain > tot) tot = remain;
  return tot > 0 ? Math.max(0, Math.min(1, remain / tot)) : 0;
}
