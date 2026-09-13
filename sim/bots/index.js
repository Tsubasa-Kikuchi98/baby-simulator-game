// Bot strategies (spec §13.2, CONTRACT §9.4). Each bot: create(rng, tuning) → { step(state, effects, emit, dt) }.
// All bots model a single mouse: at most one press or one drag is active at any time.
// No bot long-presses objects any more (CONTRACT §9.1): every countermeasure is a drag & drop.
import { ROOM } from '../../src/game/stages.js';
import {
  dist, uniform, isHazardLike, isOpen, isFloorToy, isFloorGoods, isFloorLight, isContainer, findObject, findBaby,
  openHazards, comboHazardIdsFor, insideWall, safeSpot, startDrag, nearestHighPlacePoint, nearestContainer, isMouthing
} from './common.js';

// ---------------------------------------------------------------- noop
const noop = {
  create() { return { step() {} }; }
};

// ---------------------------------------------------------------- target inference (what a player can see)
/**
 * Guess where a baby is heading without reading baby.targetId: among open hazards/items and available floor
 * toys, pick the one with the smallest angle to the baby's heading (ties → nearer). A baby that is not moving
 * (stun / play / idle / held) gives no heading, so assume the open hazard nearest to it.
 */
function inferTargetOf(state, b) {
  const moving = !b.isHeld && (b.anim === 'crawl' || b.anim === 'fuss') && (b.dirX || b.dirY);
  if (!moving) {
    let best = null, bestD = Infinity;
    for (const o of openHazards(state)) { const d = dist(b, o); if (d < bestD) { bestD = d; best = o; } }
    return best;
  }
  const dl = Math.hypot(b.dirX, b.dirY) || 1;
  const ux = b.dirX / dl, uy = b.dirY / dl;
  let best = null, bestCos = -Infinity, bestD = Infinity;
  for (const o of state.objects) {
    const ok = isHazardLike(o) ? isOpen(o) : (o.state === 'available' && isFloorToy(state, o));
    if (!ok) continue;
    const d = dist(b, o);
    if (d < 1e-6) return o;
    const cos = ((o.x - b.x) * ux + (o.y - b.y) * uy) / d;
    if (cos > bestCos + 1e-9 || (Math.abs(cos - bestCos) <= 1e-9 && d < bestD)) { bestCos = cos; bestD = d; best = o; }
  }
  return best;
}

// ---------------------------------------------------------------- optimal / human_like
// Climbable furniture (sofa, CONTRACT §10.1) is a heavy hazard whose goods is the mat, so actionFor() handles it like
// any other goods→hazard recipe. Items dropped by visitors (§10.2) or carried around by the cat (§11.5) are ordinary
// open items → container / highPlace. v5 (§11): a baby with something in its mouth is saved by the take-away hold
// (pressStart on the baby for TAKEAWAY_HOLD_SEC) — that beats every drag. High places are skipped when full
// (nearestHighPlacePoint reads highPlaceCount); with nowhere to put a light hazard/item it is moved far from the babies.
const TOY_DANGER_DIST = 120;
const TOY_REDRAG_COOLDOWN = 6;
const ACTION_COOLDOWN = 1.5;       // do not retry the same hazard action within this many seconds (the game may refuse a drop)
const FAR_MOVE_COOLDOWN = 8;       // a hazard parked far from the babies is left alone this long before re-planning it
const NOT_HEADING_ETA_MULT = 2.5;  // a hazard no baby is heading to is treated as this many times farther

/**
 * opts: reactionDelay [lo,hi] seconds or null, misclick rate, abortRate rate,
 *       inferTarget (bool): do not read baby.targetId; infer the baby's intent from its heading instead.
 * With all zero/null this is `optimal`; human_like passes the §13.2 numbers.
 *
 * Per open hazard the bot picks one drag (CONTRACT §9.4):
 *   heavy hazard → its safety goods (goods.for) dropped on it (recipe 'fix')
 *   light hazard → the 'store' recipe partner (knife → drawer) if the stage has one, else the nearest highPlace wall point,
 *                  else its goods
 *   item         → the nearest container (kind 'container' or container:true), else the nearest highPlace wall point
 * Actions are ordered by the babies' ETA to the hazard (babies heading there first). Toys lying near open hazards
 * or their combo partners are relocated to a safe floor spot when nothing is urgent.
 */
function createOptimalLike(rng, T, opts = {}) {
  const reactionDelay = opts.reactionDelay || null;
  const misclick = opts.misclick || 0;
  const abortRate = opts.abortRate || 0;
  const inferTarget = !!opts.inferTarget;
  // human_like: inferred target per baby id, refreshed only when a new action starts (after the reaction delay)
  const inferred = new Map();

  /** what a player believes the baby is heading to. optimal reads targetId (upper bound); human_like infers. */
  function babyTarget(state, b) {
    if (!inferTarget) return b.targetId ? findObject(state, b.targetId) : null;
    const id = inferred.get(b.id);
    return id != null ? findObject(state, id) : null;
  }

  function refreshInference(state) {
    if (!inferTarget) return;
    for (const b of state.babies) {
      const o = inferTargetOf(state, b);
      inferred.set(b.id, o ? o.id : null);
    }
  }

  let mode = 'idle'; // idle | wait | drag | hold
  let drag = null;   // driver from startDrag
  let hold = null;   // { babyId } take-away hold in progress (§11.1)
  let abortAt = null; // frame index at which a human_like drag is released early
  let waitUntil = 0;
  const lastActionAt = new Map(); // action key → elapsed

  function cooled(state, key, sec) {
    const last = lastActionAt.get(key);
    return last == null || state.elapsed - last >= sec;
  }

  // ---- destinations ---------------------------------------------------------

  /** floor goods whose `for` lists the hazard (nearest to the hazard) */
  function goodsFor(state, h) {
    let best = null, bestD = Infinity;
    for (const g of state.objects) {
      if (!isFloorGoods(state, g) || !(g.for || []).includes(h.id)) continue;
      const d = dist(g, h);
      if (d < bestD) { bestD = d; best = g; }
    }
    return best;
  }

  /** 'store' recipe partner for a light hazard (e.g. knife → drawer), if present and not removed */
  function storePartner(state, h) {
    const recipes = (state.stage && state.stage.recipes) || [];
    for (const r of recipes) {
      if (r.type !== 'store') continue;
      const otherId = r.a === h.id ? r.b : r.b === h.id ? r.a : null;
      if (!otherId) continue;
      const o = findObject(state, otherId);
      if (o && o.state !== 'removed' && o.carriedBy == null) return o;
    }
    return null;
  }

  /** the drag that neutralises hazard/item h, or null when nothing on the board can */
  function actionFor(state, h) {
    if (h.kind === 'hazard' && h.weight !== 'light') {
      const g = goodsFor(state, h);
      return g ? { kind: 'drag', targetId: g.id, to: { x: h.x, y: h.y }, key: `${g.id}>${h.id}`, hazardId: h.id } : null;
    }
    if (!isFloorLight(state, h)) return null;
    if (h.kind === 'hazard') {
      const sp = storePartner(state, h);
      if (sp) return { kind: 'drag', targetId: h.id, to: { x: sp.x, y: sp.y }, key: `${h.id}>${sp.id}`, hazardId: h.id };
      const hp = nearestHighPlacePoint(state, h);
      if (hp) return { kind: 'drag', targetId: h.id, to: { x: hp.x, y: hp.y }, key: `${h.id}>${hp.wall}`, hazardId: h.id };
      const g = goodsFor(state, h);
      if (g) return { kind: 'drag', targetId: g.id, to: { x: h.x, y: h.y }, key: `${g.id}>${h.id}`, hazardId: h.id };
      return farMove(state, h);
    }
    // item
    const c = nearestContainer(state, h);
    if (c) return { kind: 'drag', targetId: h.id, to: { x: c.x, y: c.y }, key: `${h.id}>${c.id}`, hazardId: h.id };
    const hp = nearestHighPlacePoint(state, h);
    if (hp) return { kind: 'drag', targetId: h.id, to: { x: hp.x, y: hp.y }, key: `${h.id}>${hp.wall}`, hazardId: h.id };
    return farMove(state, h);
  }

  /** nothing can neutralise h (every high place full, no container/goods): park it as far from the babies as possible */
  function farMove(state, h) {
    if (!cooled(state, `${h.id}>far`, FAR_MOVE_COOLDOWN)) return null;
    const containers = state.objects.filter(isContainer);
    const to = safeSpot(state, state.babies, { minClear: 150, babyBonus: 0, avoid: containers });
    if (!to) return null;
    let cur = Infinity;
    for (const b of state.babies) cur = Math.min(cur, dist(h, b));
    let next = Infinity;
    for (const b of state.babies) next = Math.min(next, dist(to, b));
    if (next < cur + 60) return null; // already about as far as it gets
    return { kind: 'drag', targetId: h.id, to, key: `${h.id}>far`, hazardId: h.id, far: true };
  }

  /** a baby with something in its mouth (§11.1): the take-away hold is the only save */
  function planMouthing(state) {
    for (const b of state.babies) if (isMouthing(b)) return { kind: 'hold', babyId: b.id, key: `hold:${b.id}` };
    return null;
  }

  /** seconds until the nearest baby reaches h; babies (believed to be) heading there count fully, others ×2.5 */
  function etaTo(state, h) {
    let eta = Infinity;
    for (const b of state.babies) {
      if (b.isHeld) continue;
      const sec = dist(b, h) / Math.max(1, b.speed || T.BABY_SPEED);
      const tgt = babyTarget(state, b);
      const e = tgt && tgt.id === h.id ? sec : sec * NOT_HEADING_ETA_MULT;
      if (e < eta) eta = e;
    }
    return eta;
  }

  function planHazards(state) {
    const open = openHazards(state);
    if (!open.length) return null;
    let best = null;
    for (const h of open) {
      if (h.carriedBy != null) continue; // in a baby's mouth (planMouthing) or the cat's
      const act = actionFor(state, h);
      if (!act || !cooled(state, act.key, ACTION_COOLDOWN)) continue;
      act.eta = etaTo(state, h);
      if (!best || act.eta < best.eta) best = act;
    }
    return best;
  }

  function planToyMove(state) {
    const open = openHazards(state);
    const containers = state.objects.filter(isContainer);
    for (const toy of state.objects) {
      if (!isFloorToy(state, toy)) continue;
      if (!cooled(state, `toy:${toy.id}`, TOY_REDRAG_COOLDOWN)) continue;
      const comboIds = comboHazardIdsFor(state, toy.id);
      const dangers = open.slice();
      for (const hid of comboIds) {
        const h = findObject(state, hid);
        if (h && !dangers.includes(h)) dangers.push(h); // ignoresFix combos: even fixed hazard is a danger
      }
      if (!dangers.length) continue;
      let minD = Infinity;
      for (const d of dangers) { const dd = dist(toy, d); if (dd < minD) minD = dd; }
      if (minD >= TOY_DANGER_DIST) continue;
      const to = safeSpot(state, dangers, { avoid: containers });
      if (!to) continue;
      let toMin = Infinity;
      for (const d of dangers) { const dd = dist(to, d); if (dd < toMin) toMin = dd; }
      if (toMin < minD + 40) continue; // not worth it
      return { kind: 'drag', targetId: toy.id, to, key: `toy:${toy.id}` };
    }
    return null;
  }

  function plan(state) {
    return planMouthing(state) || planHazards(state) || planToyMove(state);
  }

  function beginWait(state) {
    mode = 'wait';
    waitUntil = state.elapsed + uniform(rng, reactionDelay[0], reactionDelay[1]);
  }

  /** human error: grab a random light object and move it a short way to a random floor point */
  function misclickPlan(state, avoidId) {
    const cands = state.objects.filter((o) => o.id !== avoidId && isFloorLight(state, o));
    if (!cands.length) return null;
    const o = cands[Math.floor(rng() * cands.length)];
    for (let k = 0; k < 8; k++) {
      const to = { x: o.x + uniform(rng, -80, 80), y: o.y + uniform(rng, -80, 80) };
      if (to.x < 20 || to.x > ROOM.w - 20 || to.y < 20 || to.y > ROOM.h - 20) continue;
      if (insideWall(state, to.x, to.y, 0)) continue;
      return { kind: 'drag', targetId: o.id, to, key: `mis:${o.id}` };
    }
    return null;
  }

  function execute(state, p, emit, dt) {
    if (!p) { mode = 'idle'; return; }
    if (p.kind === 'hold') {
      const b = findBaby(state, p.babyId);
      if (!b || !isMouthing(b)) { mode = 'idle'; return; }
      emit({ type: 'pressStart', targetId: b.id });
      if (!state.press || state.press.targetId !== b.id) { mode = 'idle'; return; }
      hold = { babyId: b.id };
      lastActionAt.set(p.key, state.elapsed);
      mode = 'hold';
      return;
    }
    if (misclick > 0 && rng() < misclick) {
      const m = misclickPlan(state, p.targetId);
      if (m) p = m;
    }
    const o = findObject(state, p.targetId);
    if (!o || !isFloorLight(state, o)) { mode = 'idle'; return; }
    drag = startDrag(emit, o, p.to, dt);
    lastActionAt.set(p.key, state.elapsed);
    const frames = Math.max(1, Math.round(0.3 / dt));
    abortAt = abortRate > 0 && rng() < abortRate ? 1 + Math.floor(rng() * Math.max(1, frames - 1)) : null;
    mode = 'drag';
  }

  function start(state, p, emit, dt) {
    if (!p) { mode = 'idle'; return; }
    if (reactionDelay) beginWait(state); else execute(state, p, emit, dt);
  }

  let dragFrame = 0;
  return {
    step(state, effects, emit, dt) {
      const t = state.elapsed;
      switch (mode) {
        case 'hold': {
          // keep the mouse down until the game performs the take-away (press disappears) or the baby stopped mouthing
          const b = findBaby(state, hold.babyId);
          if (!state.press || state.press.targetId !== hold.babyId || !b || !isMouthing(b)) {
            if (state.press && state.press.targetId === hold.babyId) emit({ type: 'pressEnd' });
            mode = 'idle'; hold = null;
          }
          return;
        }
        case 'drag': {
          if (!state.drag || state.drag.targetId !== drag.targetId) { // game refused/ended the drag
            mode = 'idle'; drag = null; dragFrame = 0; return;
          }
          // a baby put something in its mouth: let go here and grab the baby next frame (§11.1)
          if (planMouthing(state)) {
            emit({ type: 'dragEnd', x: state.drag.x, y: state.drag.y });
            mode = 'idle'; drag = null; dragFrame = 0; abortAt = null;
            return;
          }
          dragFrame++;
          if (abortAt != null && dragFrame >= abortAt) {
            // abort: let go early at a random floor point near the cursor
            const p = { x: state.drag.x + uniform(rng, -60, 60), y: state.drag.y + uniform(rng, -60, 60) };
            emit({ type: 'dragEnd', x: Math.min(ROOM.w - 20, Math.max(20, p.x)), y: Math.min(ROOM.h - 20, Math.max(20, p.y)) });
            mode = 'idle'; drag = null; dragFrame = 0; abortAt = null;
            return;
          }
          if (!drag.step(emit)) { mode = 'idle'; drag = null; dragFrame = 0; }
          return;
        }
        case 'wait': {
          if (t >= waitUntil) { refreshInference(state); execute(state, plan(state), emit, dt); }
          return;
        }
        case 'idle':
        default: {
          const p = plan(state);
          if (p) start(state, p, emit, dt);
          return;
        }
      }
    }
  };
}

const optimal = {
  create(rng, T) { return createOptimalLike(rng, T, {}); }
};

const human_like = {
  create(rng, T) {
    return createOptimalLike(rng, T, { reactionDelay: [0.4, 1.2], misclick: 0.10, abortRate: 0.15, inferTarget: true });
  }
};

// ---------------------------------------------------------------- intervene_only
const INTERVENE_DIST = 60;
const INTERVENE_REACTION = [0.4, 1.2]; // human reaction delay between noticing danger and grabbing the baby
const intervene_only = {
  create(rng, T) {
    let drag = null;
    let cooldownUntil = 0;
    let noticed = null; // { babyId, at } — danger seen, reacting after a human delay
    const inDanger = (state, b, open) => {
      if (b.isHeld || b.stunUntil > state.elapsed) return false;
      if (b.climbing != null) return false; // never intervene on a climbing baby (CONTRACT §10.1)
      if (b.comboWarnHazardId != null) return true;
      for (const o of open) if (dist(b, o) < INTERVENE_DIST) return true;
      return false;
    };
    return {
      step(state, effects, emit, dt) {
        const t = state.elapsed;
        if (drag) {
          if (!state.drag || state.drag.targetId !== drag.targetId) { drag = null; cooldownUntil = t + 0.5; return; }
          if (!drag.step(emit)) { drag = null; cooldownUntil = t + (T.STUN_SEC ?? 1) + 0.2; }
          return;
        }
        if (t < cooldownUntil) return;
        if (noticed) {
          if (t < noticed.at) return;
          const b = findBaby(state, noticed.babyId);
          noticed = null;
          // the reaction may be too late (hiyari already happened → baby is stunned at spawn): do nothing then
          if (!b || b.isHeld || b.stunUntil > t) return;
          drag = startDrag(emit, b, { x: ROOM.cx, y: ROOM.cy }, dt);
          return;
        }
        const open = openHazards(state);
        for (const b of state.babies) {
          if (!inDanger(state, b, open)) continue;
          noticed = { babyId: b.id, at: t + uniform(rng, INTERVENE_REACTION[0], INTERVENE_REACTION[1]) };
          return;
        }
      }
    };
  }
};

// ---------------------------------------------------------------- random
const random = {
  create(rng, T) {
    let nextDecision = 0;
    let active = null; // { type:'press', until } | { type:'drag', frames, i }
    const coord = (state) => {
      const r = rng();
      const walls = (state.stage && state.stage.walls) || [];
      if (r < 0.2 && walls.length) { // inside any wall on purpose
        const w = walls[Math.floor(rng() * walls.length)];
        return { x: w.x + rng() * w.w, y: w.y + rng() * w.h };
      }
      if (r < 0.35) { // inside a high place (stored / fixed via high)
        const highs = walls.filter((w) => w.highPlace);
        if (highs.length) { const w = highs[Math.floor(rng() * highs.length)]; return { x: w.x + rng() * w.w, y: w.y + rng() * w.h }; }
      }
      if (r < 0.45) return { x: uniform(rng, -100, 900), y: uniform(rng, -100, 640) }; // out of room
      if (r < 0.55) { // onto a container (trashed)
        const cs = state.objects.filter(isContainer);
        if (cs.length) { const c = cs[Math.floor(rng() * cs.length)]; return { x: c.x + uniform(rng, -20, 20), y: c.y + uniform(rng, -20, 20) }; }
      }
      if (r < 0.7 && state.objects && state.objects.length) { // onto another object (hazard / toy / goods → recipes, recipe_ng)
        const o = state.objects[Math.floor(rng() * state.objects.length)];
        return { x: o.x + uniform(rng, -20, 20), y: o.y + uniform(rng, -20, 20) };
      }
      return { x: uniform(rng, 0, ROOM.w), y: uniform(rng, 0, ROOM.h) };
    };
    return {
      step(state, effects, emit, dt) {
        const t = state.elapsed;
        if (active) {
          if (active.type === 'press') {
            if (t >= active.until) { emit({ type: 'pressEnd' }); active = null; }
          } else {
            active.i++;
            const c = coord(state);
            if (active.i < active.frames) emit({ type: 'dragMove', x: c.x, y: c.y });
            else { emit({ type: 'dragEnd', x: c.x, y: c.y }); active = null; }
          }
          return;
        }
        if (t < nextDecision) return;
        nextDecision = t + 0.5;
        const ids = [];
        for (const o of state.objects) ids.push(o.id);
        for (const b of state.babies) ids.push(b.id);
        const id = rng() < 0.05 ? `bogus${Math.floor(rng() * 10)}` : ids[Math.floor(rng() * ids.length)];
        const r = rng();
        if (r < 0.3) { // presses are no-ops on objects now, but still exercised (baby take-away hold, invalid ids)
          emit({ type: 'pressStart', targetId: id });
          active = { type: 'press', until: t + uniform(rng, 0.2, 2.5) };
        } else if (r < 0.85) {
          const c = coord(state);
          emit({ type: 'dragStart', targetId: id, x: c.x, y: c.y });
          active = { type: 'drag', frames: 2 + Math.floor(rng() * 8), i: 0 };
        } else if (r < 0.92) {
          emit({ type: 'pressEnd' });
        } else if (r < 0.98) {
          const c = coord(state);
          emit({ type: 'dragEnd', x: c.x, y: c.y });
        } else {
          emit({ type: 'dragMove', x: uniform(rng, -50, 850), y: uniform(rng, -50, 600) });
        }
      }
    };
  }
};

export const bots = { noop, optimal, intervene_only, random, human_like };
export const botNames = Object.keys(bots);
