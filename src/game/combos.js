// 組み合わせ危険（§4.4）。stage.combos に明示列挙されたものだけを見る。動的生成はしない。

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
