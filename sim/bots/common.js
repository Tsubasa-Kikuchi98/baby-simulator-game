// Shared helpers for bots. Bots read gameState (CONTRACT §5) and emit input events (§3).
import { ROOM, TUNING } from '../../src/game/stages.js';
import { highPlaceCount } from '../../src/game/objects.js';

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a, b, k) => a + (b - a) * k;
export const uniform = (rng, lo, hi) => lo + (hi - lo) * rng();

export const isHazardLike = (o) => o.kind === 'hazard' || o.kind === 'item';
export const isOpen = (o) => o.state === 'open';
export const isDone = (o) => o.state === 'fixed' || o.state === 'removed';
/** container the game accepts drops into: kind 'container' or a hazard with container:true (any state but removed) */
export const isContainer = (o) => o.container === true && o.state !== 'removed';

/** toy lying on the floor that a mouse can act on (not carried, not removed, not played with, not dragged). */
export function isFloorToy(state, o) {
  if (o.kind !== 'toy' || o.state === 'removed') return false;
  if (o.carriedBy != null || o.playingBy != null) return false;
  if (state.drag && state.drag.targetId === o.id) return false;
  return true;
}

/** safety goods lying on the floor that a mouse can drag (available, not being dragged). */
export function isFloorGoods(state, o) {
  if (o.kind !== 'goods' || o.state !== 'available') return false;
  if (state.drag && state.drag.targetId === o.id) return false;
  return true;
}

/** any light (draggable) object lying on the floor that the game will accept a dragStart on (CONTRACT §9.2, §11).
 *  carriedBy != null (a baby's mouth, the cat) is never draggable. */
export function isFloorLight(state, o) {
  if (!o.draggable || o.kind === 'container') return false;
  if (o.carriedBy != null) return false;
  if (state.drag && state.drag.targetId === o.id) return false;
  if (o.kind === 'toy') return o.state !== 'removed' && o.playingBy == null;
  if (o.kind === 'goods' || o.kind === 'prop') return o.state === 'available';
  return o.state === 'open'; // hazard / item
}

/** baby currently holding something in its mouth (CONTRACT §11.1): the take-away hold is the only save */
export function isMouthing(b) {
  return b.mouthing != null && !b.isHeld;
}

/** high place wall has room for one more object (CONTRACT §11.2) */
export function highPlaceHasRoom(state, wall, T = TUNING) {
  const cap = typeof wall.capacity === 'number' ? wall.capacity : T.HIGH_PLACE_CAPACITY;
  return highPlaceCount(state, wall) < cap;
}

export function findObject(state, id) {
  const objs = state.objects;
  for (let i = 0; i < objs.length; i++) if (objs[i].id === id) return objs[i];
  return null;
}
export function findBaby(state, id) {
  const bs = state.babies;
  for (let i = 0; i < bs.length; i++) if (bs[i].id === id) return bs[i];
  return null;
}

/** push furniture (CONTRACT §12.3): draggable, but never a baby target and never dangerous on contact */
export const isPushFurniture = (o) => o.weight === 'push';

/** open hazards/items a baby can actually head to or be hurt by. Excludes push furniture (§12.3). */
export function openHazards(state) {
  return state.objects.filter((o) => isHazardLike(o) && isOpen(o) && !isPushFurniture(o));
}

/**
 * Hazards the bot may plan an action for. Adds two §12 cases to openHazards:
 *  - `inactive` (§12.2): not dangerous yet, but a player can and should fix it before it turns on
 *  - push furniture (§12.3): not dangerous itself, but forms a climbing step next to a window
 */
export function plannableHazards(state) {
  return state.objects.filter((o) => isHazardLike(o) && (o.state === 'open' || o.state === 'inactive'));
}

/** placement combos (§12.3) currently formed: a push mover close enough to a still-open target */
export function activePlacements(state) {
  const out = [];
  for (const c of (state.stage && state.stage.placementCombos) || []) {
    const mover = findObject(state, c.mover);
    const target = findObject(state, c.target);
    if (!mover || !target) continue;
    if (mover.state === 'removed' || target.state !== 'open') continue;
    if (dist(mover, target) < c.dist) out.push({ combo: c, mover, target });
  }
  return out;
}

/** combos (stage.combos) whose toy matches; returns hazard ids */
export function comboHazardIdsFor(state, toyId) {
  const combos = (state.stage && state.stage.combos) || [];
  const out = [];
  for (const c of combos) if (c.toy === toyId) out.push(c.hazard);
  return out;
}

/**
 * Nearest point inside a highPlace wall (>= `inset` px from the rect edge) to `from`. null if the stage has none.
 * With `onlyWithRoom` (default) walls that are already at capacity (§11.2) are skipped.
 */
export function nearestHighPlacePoint(state, from, inset = 20, { onlyWithRoom = true, T = TUNING } = {}) {
  const walls = (state.stage && state.stage.walls) || [];
  let best = null, bestD = Infinity;
  for (const w of walls) {
    if (!w.highPlace) continue;
    if (onlyWithRoom && !highPlaceHasRoom(state, w, T)) continue;
    const x0 = w.w > 2 * inset ? w.x + inset : w.x + w.w / 2;
    const x1 = w.w > 2 * inset ? w.x + w.w - inset : w.x + w.w / 2;
    const y0 = w.h > 2 * inset ? w.y + inset : w.y + w.h / 2;
    const y1 = w.h > 2 * inset ? w.y + w.h - inset : w.y + w.h / 2;
    const p = { x: Math.min(x1, Math.max(x0, from.x)), y: Math.min(y1, Math.max(y0, from.y)), wall: w.model };
    const d = dist(p, from);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/** Nearest usable container to `from` (kind 'container' or container:true hazard). null if none. */
export function nearestContainer(state, from) {
  let best = null, bestD = Infinity;
  for (const o of state.objects) {
    if (!isContainer(o)) continue;
    const d = dist(o, from);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

export function insideWall(state, x, y, pad = 0) {
  const walls = (state.stage && state.stage.walls) || [];
  for (const w of walls) {
    if (x > w.x - pad && x < w.x + w.w + pad && y > w.y - pad && y < w.y + w.h + pad) return true;
  }
  return false;
}

const GRID_COLS = 6, GRID_ROWS = 4, MARGIN = 60;
/**
 * Evaluate a 6x4 grid of floor points, return the one maximising min distance to `dangers`
 * (plus a small bonus for being far from babies). Points inside walls (inflated 30px) are skipped, and so are
 * points within `avoidDist` of any `avoid` object (containers: dropping a toy there would throw it away).
 * Returns null if no point is >= minClear from every danger.
 */
export function safeSpot(state, dangers, { minClear = 60, babyBonus = 0.25, avoid = [], avoidDist = 60 } = {}) {
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < GRID_COLS; i++) {
    const x = MARGIN + (i * (ROOM.w - 2 * MARGIN)) / (GRID_COLS - 1);
    for (let j = 0; j < GRID_ROWS; j++) {
      const y = MARGIN + (j * (ROOM.h - 2 * MARGIN)) / (GRID_ROWS - 1);
      if (insideWall(state, x, y, 30)) continue;
      const p = { x, y };
      let near = false;
      for (const a of avoid) if (dist(p, a) < avoidDist) { near = true; break; }
      if (near) continue;
      let minD = Infinity;
      for (const d of dangers) { const dd = dist(p, d); if (dd < minD) minD = dd; }
      if (dangers.length && minD < minClear) continue;
      let minB = Infinity;
      for (const b of state.babies) { const dd = dist(p, b); if (dd < minB) minB = dd; }
      const score = (dangers.length ? minD : 0) + babyBonus * (minB === Infinity ? 0 : minB);
      if (score > bestScore) { bestScore = score; best = p; }
    }
  }
  return best;
}

/**
 * Tiny single-mouse drag driver: dragStart now, dragMove for `frames` frames, then dragEnd at `to`.
 * Returns an object with step(state, emit) → true while still dragging.
 */
export function startDrag(emit, target, to, dt, seconds = 0.3) {
  const from = { x: target.x, y: target.y };
  emit({ type: 'dragStart', targetId: target.id, x: from.x, y: from.y });
  const frames = Math.max(1, Math.round(seconds / dt));
  let i = 0;
  return {
    targetId: target.id,
    to,
    step(emit2) {
      i++;
      if (i < frames) {
        const k = i / frames;
        emit2({ type: 'dragMove', x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k) });
        return true;
      }
      emit2({ type: 'dragEnd', x: to.x, y: to.y });
      return false;
    }
  };
}
