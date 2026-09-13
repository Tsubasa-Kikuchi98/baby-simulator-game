// スコア・クリア/失敗判定・ヒヤリ計上・介入ペナルティ量（§4.2, §4.3, §4.7）。
import { comboInfo } from './combos.js';

export function computeScore(state) {
  const hiyariBonus = Math.max(0, 2 - state.hiyari) * 1000;
  const playBonus = state.playCount * 200;
  const timeBonus = Math.round(state.allHazardsFixedAt ?? 0) * 10;
  return { score: hiyariBonus + playBonus + timeBonus, breakdown: { hiyariBonus, playBonus, timeBonus } };
}

// 'fail' | 'clear' | null。失敗を優先する
export function judge(state) {
  if (state.hiyari >= 3) return 'fail';
  if (state.timeLeft <= 0) return 'clear';
  return null;
}

// ヒヤリの原因を object ごとにまとめる（多い順）。combo は、その object でのヒヤリに combo があればその label
export function groupHiyariCauses(state) {
  const byId = new Map();
  for (const ev of state.hiyariEvents || []) {
    let g = byId.get(ev.objectId);
    if (!g) {
      const o = state.objects.find(x => x.id === ev.objectId);
      // ingestible な toy（§11.4）は accident を持たないので誤飲として扱う
      const accident = o ? (o.accident ?? (o.ingestible ? '誤飲' : null)) : null;
      // count は件数、weight は severity の合計（§12.3。結果画面が「◯◯ 1回（重大）」と出せる）
      g = { objectId: ev.objectId, label: o ? o.label : ev.objectId, accident, count: 0, weight: 0, combo: null };
      byId.set(ev.objectId, g);
    }
    g.count++;
    g.weight += typeof ev.severity === 'number' && ev.severity > 0 ? ev.severity : 1;
    if (ev.comboLabel && !g.combo) g.combo = ev.comboLabel;
  }
  return [...byId.values()].sort((a, b) => b.weight - a.weight || b.count - a.count);
}

export function buildResult(state, cleared) {
  const { score, breakdown } = computeScore(state);
  return {
    cleared,
    score,
    breakdown,
    failAtSec: cleared ? null : state.elapsed,
    hiyari: state.hiyari,
    playCount: state.playCount,
    eduCardId: state.stage ? state.stage.eduCardId : null,
    hiyariCauses: groupHiyariCauses(state),
    log: (state.log || []).map(e => ({ ...e }))
  };
}

// 介入ペナルティ量（負の数）。前回介入から INTERVENE_REPEAT_SEC 以内なら倍率が掛かる
export function interventionAmount(baby, kind, elapsed, tuning) {
  const base = kind === 'pickup' ? tuning.PICKUP_SAT : tuning.TAKEAWAY_SAT;
  const repeat = elapsed - baby.lastInterventionAt < tuning.INTERVENE_REPEAT_SEC;
  return base * (repeat ? tuning.INTERVENE_REPEAT_MULT : 1);
}

// ヒヤリの計上と effect（hiyari / combo_hiyari）。赤ちゃん側の処理（戻し・停止・手放し）は呼び出し側が行う。
// extra は hiyari の payload に足す（§11.1 の飲み込みは { mouth: true }）
export function registerHiyari(state, baby, obj, combo, effects, extra = {}) {
  // 重大なヒヤリ（CONTRACT §12.3）：object の severity（省略時 1）の分だけヒヤリを加算する。
  // judge は hiyari >= 3 のままなので、窓からの転落（severity 2）は 1 回で実質致命的になる
  const severity = typeof obj.severity === 'number' && obj.severity > 0 ? obj.severity : 1;
  state.hiyari += severity;
  if (combo) state.comboHiyari++;
  if (!state.hiyariEvents) state.hiyariEvents = [];
  state.hiyariEvents.push({ objectId: obj.id, babyId: baby.id, comboLabel: combo ? combo.label : null, severity });
  effects.push({
    type: 'hiyari',
    objectId: obj.id,
    payload: { babyId: baby.id, x: baby.x, y: baby.y, count: state.hiyari, severity, combo: comboInfo(combo), ...extra }
  });
  if (combo) {
    effects.push({
      type: 'combo_hiyari',
      objectId: obj.id,
      payload: { babyId: baby.id, label: combo.label, ignoresFix: combo.ignoresFix, toyId: baby.carrying }
    });
  }
}
