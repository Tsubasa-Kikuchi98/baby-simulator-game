// 両描画層で共有する「state からの導出」：ドラッグ中のヒント対象、収納済みの判定、飽きの残り割合。
// DOM / Canvas / THREE には触らない。契約 §8.2 / §9（v3：重さ・容れ物・高い場所）/ §11.2（高い場所の容量）。
import { TUNING } from '../game/stages.js';

/** ドラッグ中のオブジェクト（赤ちゃんをドラッグ中なら null） */
export function draggedObject(state) {
  const drag = state && state.drag;
  if (!drag) return null;
  return (state.objects || []).find(o => o.id === drag.targetId) || null;
}

/**
 * 重い（動かせない＝掴めない）オブジェクトか。weight が無い古い定義は draggable で判断する。
 * §12.3 の `weight:'push'`（押して動かせる家具）は **重くない**（掴める）ので false を返す。
 */
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
  // push（§12.3）はレシピ・容れ物・高い場所のいずれにも入らない＝常に床ドロップなのでヒントを出さない
  if (isPushable(a)) return hints;
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
  if (!a || isHeavy(a) || isPushable(a)) return set;
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

// ---------------------------------------------------------------- ステージ3（CONTRACT §12.6）
// 面のハザード（zone）／時限ハザード（activeAt）／配置コンボ／押して動かす家具（weight 'push'）の導出。
// ゲーム側がまだ実装していない場合（フィールドが無い）でも例外を出さず、空・null を返す。

/** 押して動かせる家具（§12.3）。heavy でも light でもない。ドラッグはできるが高い場所・容れ物・レシピには入らない */
export function isPushable(o) {
  return !!o && o.weight === 'push';
}

/**
 * 「家具として登れる」もの（v4 §10.1 のソファ）。
 * ステージ3の窓・ベランダは `climbableWhen:'placement'` で **実行時に** `climbable` が true/false へ書き換わるため、
 * マット・クッションの描画（家具として登れるもの専用）と区別する。
 */
export function isFurnitureClimbable(o) {
  return !!o && !!o.climbable && o.climbableWhen == null;
}

/** ドラッグ中ならドラッグ座標、そうでなければオブジェクトの座標 */
function posOf(state, o) {
  if (!o) return { x: 0, y: 0 };
  const d = state && state.drag;
  if (d && d.targetId === o.id && Number.isFinite(d.x) && Number.isFinite(d.y)) return { x: d.x, y: d.y };
  return { x: o.x, y: o.y };
}

function tune(key, fallback) {
  const v = TUNING[key];
  return Number.isFinite(v) ? v : fallback;
}

/** zone の滞在必要秒数（dwellSec 省略時は TUNING.ZONE_DWELL_DEFAULT） */
export function zoneDwellSec(o) {
  const d = o && o.dwellSec;
  return Number.isFinite(d) && d > 0 ? d : tune('ZONE_DWELL_DEFAULT', 1.5);
}

/**
 * 面のハザード（§12.1）の矩形。x, y は**中心**、w, h は area。
 * @returns {Array<{ id, x, y, w, h, state, label, emoji, dwellSec, obj }>}（zone が無ければ空配列）
 */
export function zoneRects(state) {
  const out = [];
  for (const o of (state && state.objects) || []) {
    if (!o || o.zone !== true || o.state === 'removed') continue;
    const w = o.area && Number.isFinite(o.area.w) ? o.area.w : 0;
    const h = o.area && Number.isFinite(o.area.h) ? o.area.h : 0;
    if (!(w > 0 && h > 0)) continue;
    out.push({ id: o.id, x: o.x, y: o.y, w, h, state: o.state, label: o.label, emoji: o.emoji, dwellSec: zoneDwellSec(o), obj: o });
  }
  return out;
}

/** その zone に一番長くとどまっている赤ちゃんの滞在割合 0..1（`baby.zoneDwell[zoneId] / dwellSec` の最大値） */
export function zoneDwellFraction(state, zoneId) {
  if (!state || zoneId == null) return 0;
  const o = (state.objects || []).find(x => x.id === zoneId);
  const need = zoneDwellSec(o);
  let best = 0;
  for (const b of state.babies || []) {
    const d = b && b.zoneDwell ? b.zoneDwell[zoneId] : 0;
    if (Number.isFinite(d) && d > best) best = d;
  }
  return need > 0 ? Math.max(0, Math.min(1, best / need)) : 0;
}

/**
 * 時限ハザード（§12.2）が ON になるまでの残り割合。`ACTIVATE_WARN_SEC` を分母にした 0..1。
 * 1 = まだ先、0 = まさに ON。**1 未満なら予告点滅**させる。`inactive` でなければ null。
 */
export function activationFraction(state, o) {
  if (!state || !o || o.state !== 'inactive') return null;
  const at = o.activeAt;
  if (!Number.isFinite(at)) return null;
  const warn = tune('ACTIVATE_WARN_SEC', 3);
  const remain = Math.max(0, at - (state.elapsed || 0));
  return warn > 0 ? Math.max(0, Math.min(1, remain / warn)) : 0;
}

/**
 * 成立中の配置コンボ（§12.3）。mover と target を線で結び、target に強い警告を出すために使う。
 * @returns {Array<{ id, moverId, targetId, label, mover:{x,y}, target:{x,y}, dist, need }>}
 */
export function placementWarnings(state) {
  const out = [];
  const combos = (state && state.stage && state.stage.placementCombos) || [];
  if (!combos.length) return out;
  const objs = state.objects || [];
  for (const c of combos) {
    const mover = objs.find(o => o.id === c.mover);
    const target = objs.find(o => o.id === c.target);
    if (!mover || !target) continue;
    if (mover.state === 'removed' || target.state === 'removed') continue;
    if (target.state !== 'open') continue;
    const mp = posOf(state, mover);
    const tp = posOf(state, target);
    const need = Number.isFinite(c.dist) ? c.dist : 90;
    const d = Math.hypot(mp.x - tp.x, mp.y - tp.y);
    if (d >= need) continue;
    out.push({ id: c.id, moverId: mover.id, targetId: target.id, label: c.label || '', mover: mp, target: tp, dist: d, need });
  }
  return out;
}

/** 成立中の配置コンボの target id の Set（描画のヒット判定用） */
export function placementTargetIds(state) {
  return new Set(placementWarnings(state).map(p => p.targetId));
}

/**
 * push をドラッグ中に「ここから離すと安全」を示すための target 一覧（§12.6）。
 * push をドラッグしていなければ空配列。`active` は今その target の踏み台になっている（＝離すべき）。
 * @returns {Array<{ id, targetId, x, y, need, dist, label, active, fixed }>}
 */
export function pushTargets(state) {
  const out = [];
  const a = draggedObject(state);
  if (!a || !isPushable(a)) return out;
  const objs = state.objects || [];
  const mp = posOf(state, a);
  for (const c of (state.stage && state.stage.placementCombos) || []) {
    if (c.mover !== a.id) continue;
    const target = objs.find(o => o.id === c.target);
    if (!target || target.state === 'removed') continue;
    const need = Number.isFinite(c.dist) ? c.dist : 90;
    const d = Math.hypot(mp.x - target.x, mp.y - target.y);
    out.push({
      id: c.id, targetId: target.id, x: target.x, y: target.y, need, dist: d,
      label: c.label || '', fixed: target.state === 'fixed',
      active: target.state === 'open' && d < need
    });
  }
  return out;
}
