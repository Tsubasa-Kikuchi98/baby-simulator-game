// 実行時オブジェクト（stage.objects の deep copy ＋ 実行時フィールド）と、床・壁まわりの幾何ヘルパー。
// DOM・描画には一切依存しない。時刻は state.elapsed（秒）。
import { ROOM } from './stages.js';

// ---- 生成 ---------------------------------------------------------------

// 定義から初期 state を決める。時限ハザード（CONTRACT §12.2）は activeAt を持つ間 'inactive' で始まる
function initialState(def) {
  if (def.kind === 'toy' || def.kind === 'goods' || def.kind === 'container' || def.kind === 'prop') return 'available';
  if (def.kind === 'hazard' && def.activeAt != null) return 'inactive';
  return 'open';
}

export function createRuntimeObject(def) {
  const copy = JSON.parse(JSON.stringify(def));
  return {
    ...copy,
    // toy: available|bored|removed / goods: available|used|removed / container: available（不変） / prop: available|removed /
    // hazard,item: open|fixed|removed（hazard は activeAt を持つ間 'inactive'）
    state: initialState(def),
    // 配置コンボ（CONTRACT §12.3）：climbableWhen:'placement' の hazard は踏み台が近いときだけ climbable になる
    climbable: def.climbable === true,
    placementCombo: null,        // 成立中の配置コンボ { id, label, moverId }。非成立なら null
    progress: 0,                 // 互換のため残す（長押し廃止で常に 0）
    respawnAt: null,
    boredUntil: null,
    draggedAt: null,
    playCount: 0,
    carriedBy: null,
    playingBy: null,
    storedIn: null,              // 収納先（store レシピの相手 id、または高い場所の wall.model）。fixed のときだけ非 null
    spawnX: def.x, spawnY: def.y // 定義位置（再発時にここへ戻す）
  };
}

export function createRuntimeObjects(stage) {
  return stage.objects.map(createRuntimeObject);
}

export function findObject(state, id) {
  if (id == null) return null;
  for (const o of state.objects) if (o.id === id) return o;
  return null;
}

export function findBaby(state, id) {
  if (id == null) return null;
  for (const b of state.babies) if (b.id === id) return b;
  return null;
}

// ---- 幾何 ---------------------------------------------------------------

export function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// 点 (x,y) が、半径 r だけ膨らませた矩形の内側（境界は外側扱い）か
export function pointInInflatedRect(x, y, rect, r) {
  return x > rect.x - r && x < rect.x + rect.w + r && y > rect.y - r && y < rect.y + rect.h + r;
}

// 赤ちゃん（半径 r）の中心が (x,y) に立てるか：部屋の外周内かつ壁（膨らませた矩形）の外
export function isWalkable(x, y, walls, r, room = ROOM) {
  if (x < r || x > room.w - r || y < r || y > room.h - r) return false;
  for (const w of walls) if (pointInInflatedRect(x, y, w, r)) return false;
  return true;
}

// 床スナップ：壁（膨らませた矩形）の内側なら最も近い辺の外側 BABY_RADIUS+2 px へ。部屋の外周内にクランプ。
// 複数の壁の膨らみが重なる隅では単純な辺スナップが別の壁の内側に入るため、辺候補を幅優先で広げて
// 立てる（isWalkable）最寄り点を返す。見つからなければ格子探索で最寄りの立てる点。
export function snapToFloor(x, y, walls, tuning, room = ROOM) {
  const r = tuning.BABY_RADIUS;
  const pad = r + 2;
  const inRoom = (px, py) => px >= pad && px <= room.w - pad && py >= pad && py <= room.h - pad;
  const start = { x: clamp(x, pad, room.w - pad), y: clamp(y, pad, room.h - pad) };
  if (isWalkable(start.x, start.y, walls, r, room)) return start;
  const d2 = c => (c.x - start.x) ** 2 + (c.y - start.y) ** 2;
  let best = null;
  let bestD = Infinity;
  const seen = new Set();
  let frontier = [start];
  for (let depth = 0; depth < 4 && frontier.length > 0; depth++) {
    const next = [];
    for (const p of frontier) {
      for (const w of walls) {
        if (!pointInInflatedRect(p.x, p.y, w, r)) continue;
        const cands = [
          { x: w.x - pad, y: p.y },
          { x: w.x + w.w + pad, y: p.y },
          { x: p.x, y: w.y - pad },
          { x: p.x, y: w.y + w.h + pad }
        ];
        for (const c of cands) {
          if (!inRoom(c.x, c.y)) continue;
          const key = `${c.x.toFixed(3)},${c.y.toFixed(3)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (isWalkable(c.x, c.y, walls, r, room)) {
            const d = d2(c);
            if (d < bestD) { bestD = d; best = c; }
          } else {
            next.push(c);
          }
        }
      }
    }
    if (best) return best;
    frontier = next;
  }
  // 格子探索（通常は到達しない）
  const step = 8;
  for (let ring = 1; ring <= 60 && !best; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (const [gx, gy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
        const c = { x: start.x + gx * step, y: start.y + gy * step };
        if (!inRoom(c.x, c.y) || !isWalkable(c.x, c.y, walls, r, room)) continue;
        const d = d2(c);
        if (d < bestD) { bestD = d; best = c; }
      }
    }
  }
  return best || start;
}

// ---- 状態遷移ヘルパー -----------------------------------------------------

// 遊べる toy：available かつ床にあり、ドラッグ中でない（goods は数えない）
export function isToyPlayable(obj, state) {
  return obj.kind === 'toy' && obj.state === 'available' && obj.carriedBy == null &&
    !(state.drag && state.drag.targetId === obj.id);
}

// 床にあってマウスでドラッグできるもの（CONTRACT §9.2, §11）：draggable（= weight 'light'）で、
// toy は removed でなく持たれておらず遊ばれていない / goods は available / prop は available / hazard・item は open。
// carriedBy が立っているもの（赤ちゃんが口に入れている・猫がくわえている）は拾えない。container・heavy は不可
export function isDraggableOnFloor(obj) {
  if (!obj.draggable || obj.kind === 'container') return false;
  if (obj.carriedBy != null) return false;
  // 押して動かす家具（CONTRACT §12.3）：hazard かつ weight 'push' で open のときだけ動かせる
  if (obj.weight === 'push') return obj.kind === 'hazard' && obj.state === 'open';
  if (obj.kind === 'toy') return obj.state !== 'removed' && obj.playingBy == null;
  if (obj.kind === 'goods' || obj.kind === 'prop') return obj.state === 'available';
  if (obj.kind === 'hazard' || obj.kind === 'item') return obj.state === 'open';
  return false;
}

// ---- ステージ3 の新機構（CONTRACT §12）--------------------------------------

// 面のハザード（§12.1）。矩形に滞在した時間でヒヤリになる。点接触ではヒヤリにしない
export function isZone(obj) {
  return !!obj && obj.zone === true;
}

// zone の滞在秒数（省略時 TUNING.ZONE_DWELL_DEFAULT）
export function zoneDwellSec(obj, tuning) {
  return typeof obj.dwellSec === 'number' && obj.dwellSec > 0 ? obj.dwellSec : tuning.ZONE_DWELL_DEFAULT;
}

// 点 (x,y) が zone の矩形（x,y は中心）の内側か
export function pointInZone(x, y, obj) {
  const w = (obj.area && obj.area.w) || 0;
  const h = (obj.area && obj.area.h) || 0;
  return Math.abs(x - obj.x) <= w / 2 && Math.abs(y - obj.y) <= h / 2;
}

// 押して動かす家具（§12.3）。heavy と light の中間：ドラッグできるが常に床に置かれる
export function isPushable(obj) {
  return !!obj && obj.weight === 'push';
}

// 踏み台があるときだけ登れる hazard（§12.3）。踏み台が離れている間は単体では危険でない
export function isPlacementTarget(obj) {
  return !!obj && obj.climbableWhen === 'placement';
}

// 口に入れる対象（CONTRACT §11.1）：誤飲の light な hazard/item、または ingestible:true の toy
export function isMouthable(obj) {
  if (!obj) return false;
  if (obj.kind === 'toy') return obj.ingestible === true;
  if (obj.kind === 'hazard' || obj.kind === 'item') return obj.accident === '誤飲' && obj.weight === 'light';
  return false;
}

// boredUntil > elapsed（toy 以外にも使う：登れる家具・口から手放した hazard/item。候補・接触から除外）
export function isBoredNow(obj, elapsed) {
  return obj.boredUntil != null && obj.boredUntil > elapsed;
}

// ドラッグ中のオブジェクトを「重ねた」相手（レシピ判定の B）になり得るか
export function isCombineTarget(obj) {
  if (obj.state === 'removed' || obj.state === 'used') return false;
  if (obj.carriedBy != null) return false;
  return true;
}

// 容れ物として使えるか（kind 'container'、または container:true の hazard。状態は問わない：§9.4）
export function isContainer(obj) {
  return !!obj && obj.container === true && obj.state !== 'removed';
}

// 点 (x,y) が highPlace:true の wall 矩形の内側なら、その wall
export function highPlaceAt(walls, x, y) {
  for (const w of walls || []) {
    if (!w.highPlace) continue;
    if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) return w;
  }
  return null;
}

// 高い場所に置かれている個数（CONTRACT §11.2）：storedIn === wall.model で fixed / removed のもの。
// respawn で床に戻ったものは storedIn が null に戻るので数えない。描画層（n/capacity 表示）と bots も使う
export function highPlaceCount(state, wall) {
  if (!wall) return 0;
  let n = 0;
  for (const o of state.objects) {
    if (o.storedIn !== wall.model) continue;
    if (o.state === 'fixed' || o.state === 'removed') n++;
  }
  return n;
}

export function highPlaceCapacity(wall, tuning) {
  return wall && typeof wall.capacity === 'number' ? wall.capacity : tuning.HIGH_PLACE_CAPACITY;
}

export function isHighPlaceFull(state, wall, tuning) {
  return highPlaceCount(state, wall) >= highPlaceCapacity(wall, tuning);
}

// ---- 登れる家具（CONTRACT §10.1）-------------------------------------------

export function isClimbable(obj) {
  return !!obj && obj.climbable === true && obj.kind === 'hazard' && obj.state !== 'removed';
}

// 家具が「飽きられている」（降りた／落ちた直後。boredUntil > elapsed）
export function isClimbBored(obj, elapsed) {
  return obj.boredUntil != null && obj.boredUntil > elapsed;
}

// 点 (x,y) から矩形までの距離（内側なら 0）
function rectDist(x, y, w) {
  const dx = x < w.x ? w.x - x : x > w.x + w.w ? x - (w.x + w.w) : 0;
  const dy = y < w.y ? w.y - y : y > w.y + w.h ? y - (w.y + w.h) : 0;
  return Math.sqrt(dx * dx + dy * dy);
}

// 登れる家具に対応する壁（矩形が家具の位置に最も近い wall）。無ければ null
export function climbWallFor(obj, walls) {
  let best = null;
  let bestD = Infinity;
  for (const w of walls || []) {
    const d = rectDist(obj.x, obj.y, w);
    if (d < bestD) { bestD = d; best = w; }
  }
  return best;
}

// 家具の壁の上に立つ位置：x は壁の内側にクランプ、y は壁の中央
export function climbTopPoint(obj, wall, x, tuning) {
  if (!wall) return { x, y: obj.y };
  const r = tuning.BABY_RADIUS;
  const lo = wall.x + r;
  const hi = wall.x + wall.w - r;
  return { x: lo <= hi ? clamp(x, lo, hi) : wall.x + wall.w / 2, y: wall.y + wall.h / 2 };
}

// 家具の前の床：(x, obj.y + BABY_RADIUS) を床スナップ
export function climbFrontPoint(obj, x, walls, tuning) {
  return snapToFloor(x, obj.y + tuning.BABY_RADIUS, walls, tuning);
}

// 合成 toy の定義から実行時オブジェクトを作る（ドロップ位置は呼び出し側で床スナップ済み）
export function createMergedToy(def, x, y, elapsed) {
  const o = createRuntimeObject(def);
  o.x = x;
  o.y = y;
  o.state = 'available';
  o.playCount = 0;
  o.draggedAt = elapsed;
  o.merged = true;
  return o;
}

export function countPlayableToys(state) {
  let n = 0;
  for (const o of state.objects) if (isToyPlayable(o, state)) n++;
  return n;
}

export function allHazardsFixed(objects) {
  for (const o of objects) if (o.kind === 'hazard' && o.state !== 'fixed') return false;
  return true;
}

// hazard を fixed にする（goods レシピ via:'goods' / 収納 via:'store' / 高い場所 via:'high'）。
// allHazardsFixedAt は経路を問わず「kind 'hazard' がすべて fixed になった瞬間」の timeLeft
export function markFixed(obj, state, effects, payload = {}) {
  obj.progress = 0;
  obj.state = 'fixed';
  // 再発する zone（§12.1）は、対策に使った goods を再発時に戻せるように覚えておく（CONTRACT §12.1 追補）
  if (isZone(obj) && obj.respawnSec != null && payload.via === 'goods' && payload.goodsId != null) {
    obj.fixedByGoodsId = payload.goodsId;
  }
  effects.push({ type: 'fixed', objectId: obj.id, payload: { ...payload } });
  if (state.allHazardsFixedAt == null && allHazardsFixed(state.objects)) state.allHazardsFixedAt = state.timeLeft;
}

// item / toy / goods / prop を removed にする。effectType は 'removed' | 'trashed' | 'stored'。item は respawn を予約
export function markRemoved(obj, state, effects, effectType = 'removed', payload = {}) {
  obj.progress = 0;
  obj.state = 'removed';
  obj.playingBy = null;
  obj.carriedBy = null;
  obj.boredUntil = null;
  if (obj.kind === 'item') obj.respawnAt = obj.respawnSec != null ? state.elapsed + obj.respawnSec : null;
  effects.push({ type: effectType, objectId: obj.id, payload: { kind: obj.kind, ...payload } });
}

// 互換：hazard→fixed / それ以外→removed（旧 長押し完了と同じ分岐）
export function completeFix(obj, state, effects, fixedPayload = {}) {
  if (obj.kind === 'hazard') markFixed(obj, state, effects, fixedPayload);
  else markRemoved(obj, state, effects, 'removed');
}

// 毎フレーム：再発と bored 解除
export function updateObjects(state, effects) {
  const t = state.elapsed;
  for (const o of state.objects) {
    if (o.kind === 'goods' || o.kind === 'container' || o.kind === 'prop') continue;
    if (o.kind !== 'toy') {
      // 登れる家具の「飽き」と、口から手放した hazard/item の「飽き」（§11.1）は静かに解除する（effect なし。候補判定は isBoredNow が見る）
      if (o.boredUntil != null && t >= o.boredUntil) o.boredUntil = null;
      // 時限ハザード（§12.2）：activeAt 秒に inactive → open。fixed になった後は activate しない
      if (o.state === 'inactive' && o.activeAt != null && t >= o.activeAt) {
        o.state = 'open';
        effects.push({ type: 'activate', objectId: o.id, payload: { activeAt: o.activeAt } });
        continue;
      }
      // 面のハザードの再発（§12.1）：fixed になった時点で respawnAt を立て、時刻到達で open に戻す。
      // 対策に使った goods（type 'fix' で 'used' になっている）も定義位置へ戻す（でないと二度と対策できない）
      if (isZone(o) && o.respawnSec != null && o.state === 'fixed') {
        if (o.respawnAt == null) o.respawnAt = t + o.respawnSec;
        else if (t >= o.respawnAt) {
          o.state = 'open';
          o.respawnAt = null;
          o.progress = 0;
          effects.push({ type: 'respawn', objectId: o.id, payload: {} });
          const goods = o.fixedByGoodsId != null ? findObject(state, o.fixedByGoodsId) : null;
          o.fixedByGoodsId = null;
          if (goods && goods.kind === 'goods' && goods.state === 'used') {
            goods.state = 'available';
            goods.progress = 0;
            goods.carriedBy = null;
            if (typeof goods.spawnX === 'number') { goods.x = goods.spawnX; goods.y = goods.spawnY; }
            effects.push({ type: 'respawn', objectId: goods.id, payload: {} });
          }
        }
        continue;
      }
      if (o.state === 'removed' && o.respawnAt != null && t >= o.respawnAt) {
        // 捨てた／片付けた item も、元の定義位置に再発する
        o.state = 'open';
        o.respawnAt = null;
        o.progress = 0;
        o.storedIn = null;
        o.carriedBy = null;
        if (typeof o.spawnX === 'number') { o.x = o.spawnX; o.y = o.spawnY; }
        effects.push({ type: 'respawn', objectId: o.id, payload: {} });
      }
    } else if (o.state === 'bored' && o.boredUntil != null && t >= o.boredUntil) {
      o.state = 'available';
      o.boredUntil = null;
      effects.push({ type: 'unbored', objectId: o.id, payload: {} });
    }
  }
}

// toy を bored にする
export function setBored(toy, until, effects) {
  toy.state = 'bored';
  toy.boredUntil = until;
  effects.push({ type: 'bored', objectId: toy.id, payload: { until } });
}
