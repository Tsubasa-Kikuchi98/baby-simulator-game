// 組み合わせ危険（§4.4）。stage.combos に明示列挙されたものだけを見る。動的生成はしない。
// 配置コンボ（CONTRACT §12.3）も stage.placementCombos に明示列挙されたものだけを見る。乱数は使わない。
import { dist, findObject } from './objects.js';

// 合成 toy など ALL_COMBOS に無い id が来ても null を返すだけ（例外にしない）
export function findCombo(stage, toyId, hazardId) {
  if (!stage || !Array.isArray(stage.combos) || toyId == null || hazardId == null) return null;
  for (const c of stage.combos) if (c.toy === toyId && c.hazard === hazardId) return c;
  return null;
}

// その toy と組み合わせになる combo の一覧
export function combosForToy(stage, toyId) {
  if (!stage || !Array.isArray(stage.combos) || toyId == null) return [];
  return stage.combos.filter(c => c.toy === toyId);
}

// hazard の現在状態でこの combo がヒヤリになるか：
// ignoresFix なら fixed でも成立、そうでなければ open のときだけ
export function comboTriggers(combo, hazardState) {
  if (!combo) return false;
  if (hazardState === 'removed') return false;
  if (combo.ignoresFix) return true;
  return hazardState === 'open';
}

// effect payload 用の平坦なコピー
export function comboInfo(combo) {
  if (!combo) return null;
  return { toy: combo.toy, hazard: combo.hazard, ignoresFix: combo.ignoresFix, label: combo.label };
}

// ---- 配置コンボ（CONTRACT §12.3）---------------------------------------------
// mover（押して動かせる家具）が target（窓・ベランダ柵）の近くにある間、target を「登れる家具」にする。
// stage.placementCombos が無いステージ（1・2）では何もしない。乱数は使わない。
//
// 成立条件：mover と target がともに removed でなく、target.state === 'open'、dist(mover, target) < c.dist
// 成立／非成立が切り替わった瞬間だけ effect placement_warn（objectId = target）を出す。
// 非成立に戻ったとき、その target に登っている赤ちゃんは baby.js の updateClimb が次に降ろす（ヒヤリにしない）
export function updatePlacementCombos(state, effects) {
  const list = state.stage && state.stage.placementCombos;
  if (!Array.isArray(list) || list.length === 0) return;

  // 成立している組（target ごとに最初の 1 つ）
  const active = new Map();
  const targetIds = [];
  for (const c of list) {
    if (!targetIds.includes(c.target)) targetIds.push(c.target);
    if (active.has(c.target)) continue;
    const mover = findObject(state, c.mover);
    const target = findObject(state, c.target);
    if (!mover || !target) continue;
    if (mover.state === 'removed' || target.state === 'removed') continue;
    if (target.state !== 'open') continue;           // fixed（補助錠）なら成立しない＝根本対策
    if (dist(mover, target) >= c.dist) continue;     // 離せば成立しない＝暫定対策
    active.set(c.target, { combo: c, moverId: mover.id });
  }

  for (const id of targetIds) {
    const target = findObject(state, id);
    if (!target) continue;
    const hit = active.get(id) || null;
    const was = target.climbable === true;
    const now = hit != null;
    if (now === was) continue;
    if (now) {
      target.climbable = true;
      target.placementCombo = { id: hit.combo.id, label: hit.combo.label, moverId: hit.moverId };
      effects.push({
        type: 'placement_warn', objectId: id,
        payload: { active: true, label: hit.combo.label, moverId: hit.moverId }
      });
    } else {
      const prev = target.placementCombo;
      target.climbable = false;
      target.placementCombo = null;
      effects.push({
        type: 'placement_warn', objectId: id,
        payload: { active: false, label: prev ? prev.label : null, moverId: prev ? prev.moverId : null }
      });
    }
  }
}

// 成立中の配置コンボ（描画層・bots 用）：[{ id, moverId, targetId, label }]
export function activePlacementCombos(state) {
  const out = [];
  for (const o of state.objects || []) {
    if (o.placementCombo && o.climbable === true) {
      out.push({ id: o.placementCombo.id, moverId: o.placementCombo.moverId, targetId: o.id, label: o.placementCombo.label });
    }
  }
  return out;
}
