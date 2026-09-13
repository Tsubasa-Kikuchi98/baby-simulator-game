import { createGame } from '../../src/game/state.js';
import { createRng } from '../../src/game/rng.js';
import { TUNING } from '../../src/game/stages.js';

export const DT = 1 / 60;

// テストの基準 tuning（TUNING そのまま。長押し廃止（CONTRACT §9.1）で FIX_SEC_MULT は無い）
export const BASE = { ...TUNING };

export function newGame(seed = 1, tuning = BASE) {
  return createGame({ rng: createRng(seed), tuning });
}

// 秒数ぶん update を回し、effects をまとめて返す
export function run(game, sec, onFrame = null) {
  const out = [];
  const n = Math.round(sec / DT);
  for (let i = 0; i < n; i++) {
    const fx = game.update(DT);
    for (const e of fx) out.push(e);
    if (onFrame) onFrame(i, fx);
  }
  return out;
}

export function obj(game, id) {
  return game.state.objects.find(o => o.id === id);
}

export function baby(game, i = 0) {
  return game.state.babies[i];
}

export function ofType(effects, type) {
  return effects.filter(e => e.type === type);
}

// 赤ちゃんを止めて一定の場所に置く（速度 0 の tuning）
export const FROZEN = { ...BASE, BABY_SPEED: 0, BABY_SPEED_STAGE3: 0 };

// 動きのゆらぎ・立ち止まり・向きの揺れを無効にした tuning（一直線・等速の挙動を検証したいテスト用）
export const STEADY = {
  ...BASE,
  MOVE_SPEED_K_MIN: 1, MOVE_SPEED_K_MIN_BAD: 1, MOVE_SPEED_K_MAX: 1,
  MOVE_PAUSE_MEAN_SEC: 0, MOVE_HEADING_MAX_DEG: 0, MOOD_SPEED_GAIN: 0
};

// オブジェクト id をドラッグして (x,y) に落とし、次の 1 フレームの effects を返す（レシピ等の effects は次の update の先頭で返る）
export function dragTo(game, id, x, y) {
  const o = obj(game, id);
  game.input({ type: 'dragStart', targetId: id, x: o.x, y: o.y });
  game.input({ type: 'dragMove', x: (o.x + x) / 2, y: (o.y + y) / 2 });
  game.input({ type: 'dragEnd', x, y });
  return run(game, DT);
}

// toy を赤ちゃんの位置に置いて遊ばせ、持たせる（PLAY_SEC 後に carrying になる）
export function makeCarry(game, toyId, babyIndex = 0) {
  const b = baby(game, babyIndex);
  const t = obj(game, toyId);
  t.x = b.x;
  t.y = b.y;
  const fx = run(game, DT);          // 接触 → play 開始
  const more = run(game, TUNING.PLAY_SEC + DT * 2);
  return [...fx, ...more];
}
