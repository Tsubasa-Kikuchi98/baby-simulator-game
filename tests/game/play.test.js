import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, DT, run, obj, baby, ofType, FROZEN, STEADY, makeCarry, dragTo } from './helpers.js';
import { TUNING } from '../../src/game/stages.js';

test('toy play gives +25/+15/+10 and bored 30/40/50 s; toy is carried afterwards', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const b = baby(game);
  const ball = obj(game, 'ball');
  const expected = [[25, 30], [15, 40], [10, 50]];
  for (let i = 0; i < 3; i++) {
    b.satisfaction = 50;
    const fx = makeCarry(game, 'ball');
    const pd = ofType(fx, 'play_done');
    assert.equal(pd.length, 1, `play ${i}`);
    assert.equal(pd[0].objectId, 'ball');
    assert.equal(pd[0].payload.amount, expected[i][0]);
    assert.equal(pd[0].payload.playCount, i + 1);
    const sd = ofType(fx, 'sat_delta');
    assert.equal(sd[0].payload.reason, 'play');
    assert.equal(sd[0].payload.amount, expected[i][0]);
    assert.ok(Math.abs(b.satisfaction - (50 + expected[i][0])) < 0.2, `sat ${b.satisfaction}`);
    assert.equal(ball.state, 'bored');
    const bored = ofType(fx, 'bored')[0];
    assert.ok(Math.abs(bored.payload.until - ball.boredUntil) < 1e-9);
    assert.ok(Math.abs(ball.boredUntil - game.state.elapsed - expected[i][1]) < 0.1, `boredUntil ${ball.boredUntil - game.state.elapsed}`);
    assert.equal(b.carrying, 'ball');
    assert.equal(ball.carriedBy, 'baby0');
    assert.equal(game.state.playCount, i + 1);
    // 次の周回のため：手放しさせ、bored を解除
    run(game, TUNING.DROP_AFTER_SEC + 0.1);
    assert.equal(b.carrying, null);
    ball.state = 'available';
    ball.boredUntil = null;
  }
});

test('anim is play during PLAY_SEC and satisfaction does not decay while playing', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const b = baby(game);
  const ball = obj(game, 'ball');
  ball.x = b.x; ball.y = b.y;
  run(game, DT);
  assert.equal(b.anim, 'play');
  assert.equal(ball.playingBy, 'baby0');
  const s0 = b.satisfaction;
  run(game, 2);
  assert.equal(b.anim, 'play');
  assert.ok(Math.abs(b.satisfaction - s0) < 1e-9);
});

test('carried toy is dropped 8 s after becoming bored, with drop effect and floor position', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const b = baby(game);
  const ball = obj(game, 'ball');
  makeCarry(game, 'ball');
  const boredAt = b.carriedBoredAt;
  assert.ok(boredAt != null);
  // 追従
  run(game, 1);
  assert.ok(Math.hypot(ball.x - b.x, ball.y - b.y) <= 18.01);
  let fx = run(game, 8 - 1 - 0.2 - (game.state.elapsed - boredAt) + 1 + 0.2 - 0.3);
  assert.equal(b.carrying, 'ball');
  fx = run(game, 0.5);
  assert.equal(b.carrying, null);
  assert.equal(ball.carriedBy, null);
  const drops = ofType(fx, 'drop');
  assert.equal(drops.length, 1);
  assert.deepEqual(drops[0], { type: 'drop', objectId: 'ball', payload: { babyId: 'baby0', reason: 'bored' } });
  assert.ok(Math.abs(game.state.elapsed - (boredAt + 8)) < 0.6);
  assert.ok(ball.x >= 16 && ball.x <= 784 && ball.y >= 16 && ball.y <= 524);
  assert.equal(ball.state, 'bored'); // まだ bored（30 s）
});

test('unbored effect when boredUntil passes', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const ball = obj(game, 'ball');
  makeCarry(game, 'ball');
  const fx = run(game, 30.5);
  assert.equal(ball.state, 'available');
  assert.equal(ofType(fx, 'unbored').length, 1);
  assert.equal(ofType(fx, 'unbored')[0].objectId, 'ball');
});

test('satisfaction decays at SAT_IDLE, SAT_NO_TOY when no toy, and satLowTime accumulates', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const b = baby(game);
  run(game, 2);
  assert.ok(Math.abs(b.satisfaction - (TUNING.SAT_START + 2 * TUNING.SAT_IDLE)) < 0.1);
  for (const id of ['bear', 'blocks', 'spoon', 'puzzle']) obj(game, id).state = 'removed'; // ball を唯一の toy にする
  dragTo(game, 'ball', 400, 30); // カウンター（高い場所）へ片付ける
  assert.equal(obj(game, 'ball').state, 'removed');
  assert.equal(game.state.noToy, true);
  const s = b.satisfaction;
  run(game, 2);
  assert.ok(Math.abs(b.satisfaction - (s + 2 * TUNING.SAT_NO_TOY)) < 0.1);
  b.satisfaction = 41;
  run(game, 2);
  assert.ok(b.satisfaction < 40);
  assert.equal(b.satLow, true);
  assert.ok(game.state.satLowTime > 0);
  assert.ok(Math.abs(b.speed - 0) < 1e-9); // FROZEN: 0 × 1.3
});

test('speed multiplier: satLow -> max(1.3, mood), fussing -> 1.5, both -> 1.5 (no wobble with STEADY, MOOD gain 0)', () => {
  const game = newGame(1, STEADY); // ゆらぎ無し・MOOD_SPEED_GAIN 0 で従来の倍率だけを見る
  game.startStage(0);
  const b = baby(game);
  const v = TUNING.BABY_SPEED;
  run(game, DT);
  assert.ok(Math.abs(b.speed - v) < 1e-9);
  b.satisfaction = 10;
  run(game, DT);
  assert.ok(Math.abs(b.speed - v * 1.3) < 1e-9, `speed ${b.speed}`);
  b.fussUntil = game.state.elapsed + 5;
  run(game, DT);
  assert.ok(Math.abs(b.speed - v * 1.5) < 1e-9);
  b.satisfaction = 90;
  run(game, DT);
  assert.ok(Math.abs(b.speed - v * 1.5) < 1e-9);
  // 既定の TUNING では speed = base × max(倍率, moodMult) × speedK（speedK は 0.55..1.25）
  const g2 = newGame(1);
  g2.startStage(0);
  const b2 = baby(g2);
  b2.satisfaction = 10;
  run(g2, DT);
  const mult = Math.max(1.3, b2.moodMult);
  assert.ok(Math.abs(b2.speed - v * mult * b2.speedK) < 1e-9, `speed ${b2.speed}`);
  assert.ok(b2.moodMult > 1.3, `moodMult ${b2.moodMult}`);
});
