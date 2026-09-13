// シード指定可能な乱数生成器（mulberry32）。src/game/ 内では組み込みの乱数を直接呼ばず、必ずこれを注入して使う。
export function createRng(seed = 1) {
  let a = (seed >>> 0) || 0x9e3779b9;
  const rng = function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.seed = seed;
  return rng;
}

// 重みに比例した確率で items から 1 つ選ぶ。weights は正の数の配列。合計 0 なら null。
export function weightedPick(rng, items, weights) {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0 || items.length === 0) return null;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}
