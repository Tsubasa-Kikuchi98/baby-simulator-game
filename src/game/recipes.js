// レシピ（CONTRACT §8.2, §9.3-1）：ドラッグしたオブジェクト A を別のオブジェクト B に重ねて落としたときの判定と適用。
// - type 'fix'   : goods → hazard（heavy でも可）。hazard を即 fixed（markFixed）、goods は 'used'
// - type 'store' : light hazard → 収納先 B。A が fixed になり、x,y は B に重なる（storedIn = B.id）
// - type 'toy'   : toy × toy。両方 removed、MERGED_TOYS[result] を deep copy してドロップ位置に追加
// ドロップ先の判定順（容れ物・高い場所・recipe_ng・床）は drop.js が持つ。DOM・乱数は使わない。
import { MERGED_TOYS } from './stages.js';
import { dist, markFixed, isCombineTarget, createMergedToy, snapToFloor } from './objects.js';

// stage.recipes から {a,b} が順不同で一致するものを返す
export function findRecipe(stage, idA, idB) {
  if (!stage || !Array.isArray(stage.recipes) || idA == null || idB == null) return null;
  for (const r of stage.recipes) {
    if ((r.a === idA && r.b === idB) || (r.a === idB && r.b === idA)) return r;
  }
  return null;
}

// 点 p から DROP_COMBINE_DIST 未満にある相手候補（removed/used でなく、carriedBy==null、A 自身でない）を近い順に
export function combinePartnersNear(a, p, state, tuning) {
  const out = [];
  for (const o of state.objects) {
    if (o === a || o.id === a.id) continue;
    if (!isCombineTarget(o)) continue;
    const d = dist(p, o);
    if (d < tuning.DROP_COMBINE_DIST) out.push({ o, d });
  }
  out.sort((u, v) => u.d - v.d);
  return out.map(e => e.o);
}

// 最も近い相手 1 つ（互換用）
export function findCombinePartner(a, state, tuning, p = a) {
  const list = combinePartnersNear(a, p, state, tuning);
  return list.length ? list[0] : null;
}

/**
 * dragEnd 時、A をドロップ点 p に落としたときのレシピ判定（§9.3 の 1）。
 * p の近くの相手を近い順に見て、最初に成立したレシピを適用する。
 * 戻り値：'fix' | 'store' | 'toy' | null（成立しなければ null。recipe_ng は出さない：drop.js の 4 で判定）
 */
export function applyDropRecipe(a, state, tuning, effects, p = { x: a.x, y: a.y }) {
  if (!a || a.state === 'removed' || a.state === 'used') return null;
  const x = p.x;
  const y = p.y;
  for (const b of combinePartnersNear(a, p, state, tuning)) {
    const recipe = findRecipe(state.stage, a.id, b.id);
    if (!recipe) continue;
    if (recipe.type === 'fix') {
      // goods → hazard。hazard が open のときだけ成立（既に fixed なら不成立）
      const goods = a.kind === 'goods' ? a : b.kind === 'goods' ? b : null;
      const hazard = goods === a ? b : a;
      if (!goods || hazard.kind !== 'hazard' || hazard.state !== 'open') continue;
      markFixed(hazard, state, effects, { via: 'goods', goodsId: goods.id });
      goods.state = 'used';
      goods.progress = 0;
      goods.x = hazard.x;
      goods.y = hazard.y;
      effects.push({
        type: 'recipe_ok', objectId: hazard.id,
        payload: { a: a.id, b: b.id, recipeId: recipe.id, label: recipe.label, type: 'fix', x, y }
      });
      return 'fix';
    }
    if (recipe.type === 'store') {
      // light hazard → 収納先。A が open な hazard のときだけ（B は removed でなければ状態を問わない）
      if (a.kind !== 'hazard' || a.state !== 'open') continue;
      a.x = b.x;
      a.y = b.y;
      a.storedIn = b.id;
      markFixed(a, state, effects, { via: 'store', into: b.id });
      effects.push({
        type: 'recipe_ok', objectId: a.id,
        payload: { a: a.id, b: b.id, recipeId: recipe.id, label: recipe.label, type: 'store', x, y }
      });
      return 'store';
    }
    if (recipe.type === 'toy') {
      if (a.kind !== 'toy' || b.kind !== 'toy') continue;
      if (b.playingBy != null || a.playingBy != null) continue;
      const def = MERGED_TOYS[recipe.result];
      if (!def) continue;
      for (const t of [a, b]) {
        t.state = 'removed';
        t.progress = 0;
        t.playingBy = null;
        t.boredUntil = null;
        effects.push({ type: 'removed', objectId: t.id, payload: { kind: 'toy', merged: true } });
      }
      const q = snapToFloor(x, y, state.stage.walls, tuning);
      const merged = createMergedToy(def, q.x, q.y, state.elapsed);
      state.objects.push(merged);
      const payload = { a: a.id, b: b.id, recipeId: recipe.id, label: recipe.label, x: q.x, y: q.y };
      effects.push({ type: 'toy_merged', objectId: merged.id, payload: { ...payload } });
      effects.push({ type: 'recipe_ok', objectId: merged.id, payload: { ...payload, type: 'toy' } });
      return 'toy';
    }
  }
  return null;
}

// goods A を合わない hazard に重ねた（§9.3 の 4）：最も近い hazard 相手があれば recipe_ng を出して true
export function applyRecipeNg(a, state, tuning, effects, p = { x: a.x, y: a.y }) {
  if (!a || a.kind !== 'goods') return false;
  for (const b of combinePartnersNear(a, p, state, tuning)) {
    if (b.kind !== 'hazard') continue;
    effects.push({ type: 'recipe_ng', objectId: b.id, payload: { a: a.id, b: b.id, x: p.x, y: p.y } });
    return true;
  }
  return false;
}
