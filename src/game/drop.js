// ドロップ先の判定（CONTRACT §9.3）。dragEnd で A をドロップ点 P に落としたとき、上から順に判定して最初に成立したものを適用する。
//  1. レシピ（fix / store / toy）            → recipes.js
//  2. 容れ物（container:true の B が P の近く） → item/toy/goods を removed（effect 'trashed'）。hazard は不成立
//  3. 高い場所（P が highPlace:true の wall 内） → hazard を fixed（via 'high'、x,y は P のまま）／item・toy・goods・prop を removed（effect 'stored'）
//     ただし容量（wall.capacity ?? HIGH_PLACE_CAPACITY、CONTRACT §11.2）に達していれば置けない：effect 'high_full' ＋ wall の手前の床へ通常ドロップ
//  4. goods を合わない hazard に重ねた          → recipe_ng、A はその場（床スナップ）
//  5. それ以外                                 → 通常の床ドロップ（床スナップ、draggedAt 更新）
// DOM・乱数は使わない。時刻は state.elapsed。
import { dist, snapToFloor, markFixed, markRemoved, isContainer, highPlaceAt, isHighPlaceFull, highPlaceCapacity } from './objects.js';
import { applyDropRecipe, applyRecipeNg } from './recipes.js';

// P から DROP_COMBINE_DIST 未満にある最も近い容れ物（A 自身は除く）
export function findContainerNear(a, p, state, tuning) {
  let best = null;
  let bestD = Infinity;
  for (const o of state.objects) {
    if (o === a || !isContainer(o)) continue;
    const d = dist(p, o);
    if (d < tuning.DROP_COMBINE_DIST && d < bestD) { bestD = d; best = o; }
  }
  return best;
}

// 通常の床ドロップ：床スナップして draggedAt を更新
function floorDrop(a, state, tuning, p) {
  const q = snapToFloor(p.x, p.y, state.stage.walls, tuning);
  a.x = q.x;
  a.y = q.y;
  a.draggedAt = state.elapsed;
}

/**
 * 戻り値：'fix' | 'store' | 'toy' | 'trashed' | 'stored' | 'high' | 'high_full' | 'ng' | 'floor'
 * effects には fixed / recipe_ok / trashed / stored / recipe_ng などが積まれる（呼び出し側が次の update() で返す）
 */
export function resolveDrop(a, state, tuning, effects, x, y) {
  const p = { x, y };
  a.x = x;
  a.y = y;

  // 1. レシピ
  const r = applyDropRecipe(a, state, tuning, effects, p);
  if (r) return r;

  const storable = a.kind === 'item' || a.kind === 'toy' || a.kind === 'goods' || a.kind === 'prop';

  // 2. 容れ物（hazard は入らない）
  if (storable) {
    const c = findContainerNear(a, p, state, tuning);
    if (c) {
      a.x = c.x;
      a.y = c.y;
      markRemoved(a, state, effects, 'trashed', { into: c.id });
      return 'trashed';
    }
  }

  // 3. 高い場所（床スナップしない：wall の中に置いたまま描く）
  const wall = highPlaceAt(state.stage.walls, x, y);
  if (wall && (a.kind === 'hazard' || storable)) {
    if (isHighPlaceFull(state, wall, tuning)) {
      // 満杯（§11.2）：置けない。wall の手前の床へ（snapToFloor が最も近い辺の外側へ出す）
      effects.push({ type: 'high_full', objectId: a.id, payload: { into: wall.model, capacity: highPlaceCapacity(wall, tuning) } });
      floorDrop(a, state, tuning, p);
      return 'high_full';
    }
    if (a.kind === 'hazard') {
      a.storedIn = wall.model;
      markFixed(a, state, effects, { via: 'high', into: wall.model });
      return 'high';
    }
    a.storedIn = wall.model;
    markRemoved(a, state, effects, 'stored', { into: wall.model });
    return 'stored';
  }

  // 4. goods を合わない hazard に重ねた → recipe_ng、A はその場に残る
  if (applyRecipeNg(a, state, tuning, effects, p)) {
    floorDrop(a, state, tuning, p);
    return 'ng';
  }

  // 5. 通常の床ドロップ
  floorDrop(a, state, tuning, p);
  return 'floor';
}
