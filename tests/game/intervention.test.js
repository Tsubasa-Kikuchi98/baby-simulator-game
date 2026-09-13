import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, DT, run, obj, baby, ofType, FROZEN, makeCarry } from './helpers.js';

test('pickup penalty -15 then -30 within 20 s; held/stun/fuss sequence with effects', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const b = baby(game);
  run(game, DT);
  const s0 = b.satisfaction;
  game.input({ type: 'dragStart', targetId: 'baby0', x: b.x, y: b.y });
  assert.equal(b.isHeld, true);
  assert.equal(b.anim, 'held');
  assert.deepEqual(game.state.drag, { targetId: 'baby0', x: b.x, y: b.y });
  let fx = run(game, DT);
  const pk = ofType(fx, 'pickup');
  assert.equal(pk.length, 1);
  assert.equal(pk[0].objectId, 'baby0');
  assert.equal(pk[0].payload.amount, -15);
  const sd = ofType(fx, 'sat_delta');
  assert.equal(sd[0].payload.reason, 'pickup');
  assert.equal(sd[0].payload.amount, -15);
  assert.ok(Math.abs(b.satisfaction - (s0 - 15)) < 1e-9);
  assert.equal(game.state.interventions, 1);
  // 抱き上げ中は減衰しない・動かない
  game.input({ type: 'dragMove', x: 200, y: 200 });
  assert.equal(b.x, 200);
  run(game, 1);
  assert.ok(Math.abs(b.satisfaction - (s0 - 15)) < 1e-9);
  game.input({ type: 'dragEnd', x: 210, y: 210 });
  assert.equal(b.isHeld, false);
  assert.equal(b.anim, 'stun');
  assert.equal(game.state.drag, null);
  assert.equal(b.x, 210);
  fx = run(game, 0.9);
  assert.equal(b.anim, 'stun');
  assert.equal(ofType(fx, 'fuss_start').length, 0);
  fx = run(game, 0.2);
  assert.equal(ofType(fx, 'fuss_start').length, 1);
  assert.equal(b.fussing, true);
  assert.equal(b.anim, 'fuss');
  // 20 秒以内の再介入 → 2 倍
  game.input({ type: 'dragStart', targetId: 'baby0', x: b.x, y: b.y });
  fx = run(game, DT);
  assert.equal(ofType(fx, 'pickup')[0].payload.amount, -30);
  assert.equal(game.state.interventions, 2);
  game.input({ type: 'dragEnd', x: 300, y: 300 });
  fx = run(game, 6.5);
  assert.equal(ofType(fx, 'fuss_start').length, 1);
  assert.equal(ofType(fx, 'fuss_end').length, 1);
  assert.equal(b.fussing, false);
});

test('dragEnd baby inside a wall snaps to the floor outside', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const b = baby(game);
  game.input({ type: 'dragStart', targetId: 'baby0', x: b.x, y: b.y });
  game.input({ type: 'dragEnd', x: 400, y: 30 }); // counter 0..800 × 0..60（赤ちゃんは高い場所に置けない：床スナップ）
  assert.ok(b.y >= 60 + 14, `y ${b.y}`);
  assert.equal(b.x, 400);
});

test('takeaway requires carrying, needs 0.5 s hold, drops toy bored for 3 s with -20 and fuss', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const b = baby(game);
  game.input({ type: 'pressStart', targetId: 'baby0' });
  assert.equal(game.state.press, null);
  makeCarry(game, 'ball');
  assert.equal(b.carrying, 'ball');
  const ball = obj(game, 'ball');
  game.input({ type: 'pressStart', targetId: 'baby0' });
  assert.deepEqual(game.state.press, { targetId: 'baby0', elapsed: 0, needSec: 0.5 });
  run(game, 0.25);
  assert.ok(b.holdProgress > 0.4 && b.holdProgress < 0.6);
  game.input({ type: 'pressEnd' });
  assert.equal(b.holdProgress, 0);
  assert.equal(b.carrying, 'ball');
  game.input({ type: 'pressStart', targetId: 'baby0' });
  const s0 = b.satisfaction;
  const fx = run(game, 0.55);
  assert.equal(b.carrying, null);
  assert.equal(b.holdProgress, 0);
  assert.equal(game.state.press, null);
  assert.equal(ball.carriedBy, null);
  assert.equal(ball.state, 'bored');
  assert.ok(Math.abs(ball.boredUntil - game.state.elapsed - 3) < 0.05, `bored for ${ball.boredUntil - game.state.elapsed}`);
  const tk = ofType(fx, 'takeaway');
  assert.equal(tk.length, 1);
  assert.deepEqual(tk[0].payload, { amount: -20, toyId: 'ball' });
  assert.equal(ofType(fx, 'sat_delta')[0].payload.reason, 'takeaway');
  assert.ok(Math.abs(b.satisfaction - (s0 - 20)) < 2.5); // 0.55 s × SAT_NO_TOY(-4/s) の減衰ぶんを許容（唯一の toy が bored）
  assert.deepEqual(ofType(fx, 'drop')[0].payload, { babyId: 'baby0', reason: 'takeaway' });
  assert.equal(ofType(fx, 'bored').length, 1);
  assert.equal(ofType(fx, 'fuss_start').length, 1);
  assert.equal(b.fussing, true);
  assert.equal(game.state.interventions, 1);
  // 3 秒後に available へ戻る
  const fx2 = run(game, 3.1);
  assert.equal(ball.state, 'available');
  assert.equal(ofType(fx2, 'unbored').length, 1);
});

test('play while fussing recovers at most FUSS_PLAY_SAT', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const b = baby(game);
  b.satisfaction = 50;
  b.fussUntil = game.state.elapsed + 10;
  const fx = makeCarry(game, 'ball');
  assert.equal(ofType(fx, 'play_done')[0].payload.amount, 12);
});

test('toy drag: only floor toys, snaps into room, sets draggedAt and re-targets babies', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const ball = obj(game, 'ball');
  for (const id of ['bear', 'blocks', 'spoon', 'puzzle']) obj(game, id).state = 'removed'; // ball を唯一の toy にする
  run(game, DT);
  game.input({ type: 'dragStart', targetId: 'ball', x: 300, y: 380 });
  assert.deepEqual(game.state.drag, { targetId: 'ball', x: 300, y: 380 });
  assert.equal(game.state.noToy, false);
  run(game, DT);
  assert.equal(game.state.noToy, true); // ドラッグ中は遊べる toy に数えない
  game.input({ type: 'dragMove', x: 900, y: 600 });
  assert.equal(ball.x, 900);
  game.input({ type: 'dragEnd', x: 900, y: 600 });
  assert.equal(ball.x, 784);
  assert.equal(ball.y, 524);
  assert.ok(Math.abs(ball.draggedAt - game.state.elapsed) < 1e-9);
  assert.equal(game.state.drag, null);
  // 持たれている toy はドラッグ不可
  makeCarry(game, 'ball');
  game.input({ type: 'dragStart', targetId: 'ball', x: 1, y: 1 });
  assert.equal(game.state.drag, null);
  game.input({ type: 'pressStart', targetId: 'ball' });
  assert.equal(game.state.press, null);
});
