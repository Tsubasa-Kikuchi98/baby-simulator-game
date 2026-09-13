// 訪問者（CONTRACT §10.2 おじさん、§11.5 猫）。stage.visitors[] の定義から実行時 state.visitors[] を作り、毎フレーム進める。
// おじさん（type 'uncle'）：at 秒に path[0]（部屋の外）に現れ、VISITOR_SPEED で waypoint を順にたどり、最後の waypoint で退場する。
//   path の全長を drops.length+1 等分した地点（入口・出口を除く）を通過した瞬間に drops[i] を床に落とす（runtime object を追加）。乱数は使わない。
// 猫（type 'cat'）：at 秒に entry から入り、床の軽い物を CAT_STEALS 回くわえて赤ちゃんの近くへ運び、exit へ去る。選択は注入 rng（決定的）。
// どちらも壁・オブジェクト・赤ちゃんとは衝突しない。DOM・Date は参照しない。
import { createRuntimeObject, snapToFloor, findObject, isWalkable } from './objects.js';
import { weightedPick } from './rng.js';
import { requestReselectAll } from './baby.js';

function segLengths(path) {
  const out = [];
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    out.push(Math.sqrt(dx * dx + dy * dy));
  }
  return out;
}

// 距離 s（0..total）における path 上の点と進行方向
function pointAt(path, segs, s) {
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const len = segs[i];
    if (s <= acc + len || i === segs.length - 1) {
      const a = path[i];
      const b = path[i + 1];
      const k = len > 0 ? Math.max(0, Math.min(1, (s - acc) / len)) : 0;
      const dirX = len > 0 ? (b.x - a.x) / len : 0;
      const dirY = len > 0 ? (b.y - a.y) / len : 0;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dirX, dirY };
    }
    acc += len;
  }
  const last = path[path.length - 1];
  return { x: last.x, y: last.y, dirX: 0, dirY: 0 };
}

export function createVisitors(stage) {
  const defs = (stage && stage.visitors) || [];
  return defs.map(def => {
    const type = def.type || 'uncle';
    const path = (def.path || []).map(p => ({ x: p.x, y: p.y }));
    const segs = segLengths(path);
    let total = 0;
    for (const l of segs) total += l;
    const entry = def.entry ? { x: def.entry.x, y: def.entry.y } : (path[0] || { x: 0, y: 0 });
    const exit = def.exit ? { x: def.exit.x, y: def.exit.y } : (path[path.length - 1] || entry);
    return {
      id: def.id, type, label: def.label, emoji: def.emoji,
      x: entry.x, y: entry.y, dirX: 0, dirY: 0,
      active: false, done: false,
      dropped: [],                 // 落とした／置いた object の id
      carrying: null,              // 猫がくわえている object id（§11.5）。おじさんは常に null
      // ---- 以下は内部用（描画層は参照しない）----
      at: def.at,
      path, segs, total,
      drops: (def.drops || []).map(d => JSON.parse(JSON.stringify(d))),
      dist: 0,                     // path 上の進んだ距離（おじさん）
      nextDrop: 0,                 // 次に落とす drops の index（おじさん）
      entry, exit,
      phase: null,                 // 猫：'seek' | 'toDrop' | 'pause' | 'exit'
      targetId: null,              // 猫：くわえに向かっている object id
      dropPoint: null,             // 猫：落とす位置 { x, y, babyId }
      pauseUntil: 0,
      steals: 0                    // 猫：運んだ回数
    };
  });
}

// ---- おじさん（§10.2）-----------------------------------------------------------

function dropItem(v, def, state, tuning, effects, p) {
  const q = snapToFloor(p.x, p.y, state.stage.walls, tuning);
  const o = createRuntimeObject(def);
  o.x = q.x;
  o.y = q.y;
  o.spawnX = q.x;
  o.spawnY = q.y;
  o.state = 'open';
  o.respawnSec = null;
  o.respawnAt = null;
  state.objects.push(o);
  v.dropped.push(o.id);
  effects.push({ type: 'visitor_drop', objectId: o.id, payload: { visitorId: v.id, x: q.x, y: q.y } });
  requestReselectAll(state);
}

function updateUncle(v, state, tuning, effects, dt) {
  const t = state.elapsed;
  const speed = tuning.VISITOR_SPEED;
  if (!v.active) {
    if (t < v.at || v.path.length === 0) return;
    v.active = true;
    const p = pointAt(v.path, v.segs, 0);
    v.x = p.x; v.y = p.y; v.dirX = p.dirX; v.dirY = p.dirY;
    effects.push({ type: 'visitor_enter', objectId: v.id, payload: { x: v.x, y: v.y, visitorType: v.type } });
  }
  v.dist = Math.min(v.total, v.dist + speed * dt);
  // 等間隔の地点を通過したら落とす（1 フレームで複数通過してもすべて落とす）
  const n = v.drops.length;
  while (v.nextDrop < n) {
    const s = (v.total * (v.nextDrop + 1)) / (n + 1);
    if (v.dist < s) break;
    const p = pointAt(v.path, v.segs, s);
    dropItem(v, v.drops[v.nextDrop], state, tuning, effects, p);
    v.nextDrop++;
  }
  const p = pointAt(v.path, v.segs, v.dist);
  v.x = p.x; v.y = p.y;
  if (p.dirX !== 0 || p.dirY !== 0) { v.dirX = p.dirX; v.dirY = p.dirY; }
  if (v.dist >= v.total) {
    v.active = false;
    v.done = true;
    effects.push({ type: 'visitor_leave', objectId: v.id, payload: { x: v.x, y: v.y } });
  }
}

// ---- 猫（§11.5）-----------------------------------------------------------------

const CAT_KINDS = new Set(['hazard', 'item', 'toy', 'prop', 'goods']);

// 猫がくわえられる床の軽い物：draggable（light）、carriedBy なし、open/available/bored、ドラッグ中でない、遊ばれていない
export function isCatTakeable(obj, state) {
  if (!obj || !CAT_KINDS.has(obj.kind) || !obj.draggable) return false;
  if (obj.carriedBy != null || obj.playingBy != null) return false;
  if (obj.state !== 'open' && obj.state !== 'available' && obj.state !== 'bored') return false;
  if (state.drag && state.drag.targetId === obj.id) return false;
  return true;
}

function pickCatTarget(state, rng) {
  const cands = [];
  const weights = [];
  for (const o of state.objects) {
    if (!isCatTakeable(o, state)) continue;
    cands.push(o);
    weights.push(o.kind === 'hazard' || o.kind === 'item' ? 2 : 1);
  }
  const pick = weightedPick(rng, cands, weights);
  return pick ? pick.id : null;
}

// 赤ちゃんの周囲 CAT_DROP_NEAR_BABY px の床の点（壁の外・部屋の中）。何度か角度を試し、だめなら床スナップ
function pickDropPoint(state, tuning, rng, baby) {
  const r = tuning.CAT_DROP_NEAR_BABY;
  const walls = state.stage.walls;
  let first = null;
  for (let k = 0; k < 8; k++) {
    const a = rng() * Math.PI * 2;
    const p = { x: baby.x + Math.cos(a) * r, y: baby.y + Math.sin(a) * r };
    if (!first) first = p;
    if (isWalkable(p.x, p.y, walls, tuning.BABY_RADIUS)) return p;
  }
  return snapToFloor(first.x, first.y, walls, tuning);
}

// 直線で (tx,ty) へ speed*dt 進む。到達したら true
function runTo(v, tx, ty, speed, dt) {
  const dx = tx - v.x;
  const dy = ty - v.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const step = speed * dt;
  if (d <= step || d < 1e-6) {
    v.x = tx;
    v.y = ty;
    return true;
  }
  v.dirX = dx / d;
  v.dirY = dy / d;
  v.x += v.dirX * step;
  v.y += v.dirY * step;
  return false;
}

function catCarry(v, state) {
  if (v.carrying == null) return;
  const o = findObject(state, v.carrying);
  if (!o) { v.carrying = null; return; }
  o.x = v.x + v.dirX * 12;
  o.y = v.y + v.dirY * 12;
}

function catSeek(v, state, rng) {
  v.targetId = pickCatTarget(state, rng);
  v.phase = v.targetId != null ? 'seek' : 'exit';
}

function updateCat(v, state, tuning, effects, dt, rng) {
  const t = state.elapsed;
  const speed = tuning.CAT_SPEED;
  if (!v.active) {
    if (t < v.at) return;
    v.active = true;
    v.x = v.entry.x;
    v.y = v.entry.y;
    effects.push({ type: 'visitor_enter', objectId: v.id, payload: { x: v.x, y: v.y, visitorType: v.type } });
    catSeek(v, state, rng);
  }
  // 1 フレームに 1 フェーズだけ進める（速度の整合のため）
  switch (v.phase) {
    case 'seek': {
      const o = findObject(state, v.targetId);
      if (!isCatTakeable(o, state)) { catSeek(v, state, rng); break; } // 目標が拾われた／持たれた → 選び直し
      if (runTo(v, o.x, o.y, speed, dt)) {
        o.carriedBy = 'cat';
        v.carrying = o.id;
        v.targetId = null;
        effects.push({ type: 'cat_take', objectId: o.id, payload: { visitorId: v.id } });
        requestReselectAll(state);
        const babies = state.babies;
        const baby = babies[Math.min(babies.length - 1, Math.floor(rng() * babies.length))];
        const p = baby ? pickDropPoint(state, tuning, rng, baby) : snapToFloor(v.x, v.y, state.stage.walls, tuning);
        v.dropPoint = { x: p.x, y: p.y, babyId: baby ? baby.id : null };
        v.phase = 'toDrop';
        catCarry(v, state);
      }
      break;
    }
    case 'toDrop': {
      const o = findObject(state, v.carrying);
      if (!o || o.carriedBy !== 'cat') { v.carrying = null; catSeek(v, state, rng); break; }
      if (runTo(v, v.dropPoint.x, v.dropPoint.y, speed, dt)) {
        const q = snapToFloor(v.dropPoint.x, v.dropPoint.y, state.stage.walls, tuning);
        o.carriedBy = null;
        o.x = q.x;
        o.y = q.y;
        v.carrying = null;
        v.dropped.push(o.id);
        v.steals++;
        effects.push({ type: 'cat_drop', objectId: o.id, payload: { visitorId: v.id, x: q.x, y: q.y, babyId: v.dropPoint.babyId } });
        requestReselectAll(state);
        v.dropPoint = null;
        v.pauseUntil = t + tuning.CAT_PAUSE_SEC;
        v.phase = 'pause';
      } else {
        catCarry(v, state);
      }
      break;
    }
    case 'pause': {
      if (t < v.pauseUntil) break;
      if (v.steals >= tuning.CAT_STEALS) v.phase = 'exit';
      else catSeek(v, state, rng);
      break;
    }
    case 'exit':
    default: {
      if (runTo(v, v.exit.x, v.exit.y, speed, dt)) {
        v.active = false;
        v.done = true;
        catCarry(v, state);
        effects.push({ type: 'visitor_leave', objectId: v.id, payload: { x: v.x, y: v.y } });
      } else {
        catCarry(v, state);
      }
      break;
    }
  }
}

export function updateVisitors(state, tuning, effects, dt, rng = null) {
  for (const v of state.visitors || []) {
    if (v.done) continue;
    if (v.type === 'cat') {
      if (rng) updateCat(v, state, tuning, effects, dt, rng);
    } else {
      updateUncle(v, state, tuning, effects, dt);
    }
  }
}
