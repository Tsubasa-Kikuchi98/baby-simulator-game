// ソファ登り・訪問者・薬（CONTRACT §10）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, DT, run, obj, baby, ofType, FROZEN, dragTo, makeCarry } from './helpers.js';
import { TUNING, STAGES } from '../../src/game/stages.js';
import { isWalkable } from '../../src/game/objects.js';
import { isCandidate } from '../../src/game/baby.js';

// 双子（stage 1）：sofa は climbable heavy hazard (400,84)、壁 sofa は (300,0,200,70)。goods mat → recipe mat_sofa
const NO_FALL = { ...FROZEN, CLIMB_FALL_PROB_PER_SEC: 0 };
const SURE_FALL = { ...FROZEN, CLIMB_FALL_PROB_PER_SEC: 1e9 };

function reachSofa(game, i = 0) {
  const b = baby(game, i);
  b.x = 400;
  b.y = 100; // ソファ前縁 (400,84) から 16 px（TOUCH_DIST 28 未満）
  return run(game, DT);
}

test('touching the sofa starts climbing (no hiyari): baby on the wall top, anim climb, satisfaction rises', () => {
  const game = newGame(1, NO_FALL);
  game.startStage(1);
  const b = baby(game);
  const sofa = obj(game, 'sofa');
  assert.equal(sofa.climbable, true);
  assert.equal(sofa.state, 'open');
  assert.equal(isCandidate(sofa, b, game.state), true);
  const fx = reachSofa(game);
  assert.equal(ofType(fx, 'hiyari').length, 0);
  assert.equal(game.state.hiyari, 0);
  const cs = ofType(fx, 'climb_start');
  assert.equal(cs.length, 1);
  assert.deepEqual(cs[0], { type: 'climb_start', objectId: 'sofa', payload: { babyId: 'baby0' } });
  assert.equal(b.climbing, 'sofa');
  assert.equal(b.anim, 'climb');
  assert.equal(b.targetId, null);
  assert.equal(b.x, 400);
  assert.equal(b.y, 35); // wall.y + wall.h/2
  assert.ok(Math.abs(b.climbUntil - (game.state.elapsed + TUNING.CLIMB_SEC)) < 1e-9);
  // 登っている間：動かない、満足度が +CLIMB_SAT_PER_SEC/秒、接触判定なし
  const s0 = b.satisfaction;
  run(game, 1);
  assert.equal(b.climbing, 'sofa');
  assert.equal(b.anim, 'climb');
  assert.deepEqual([b.x, b.y], [400, 35]);
  assert.ok(Math.abs(b.satisfaction - (s0 + TUNING.CLIMB_SAT_PER_SEC)) < 0.1, `sat ${b.satisfaction - s0}`);
  assert.equal(game.state.hiyari, 0);
  // ログ
  const e = game.state.log.find(x => x.kind === 'climb_start');
  assert.ok(e && e.text === 'ソファに登った。ごきげん', e && e.text);
});

test('fall from an open sofa is a hiyari with objectId sofa (転落): baby back at spawn + stun, carried toy lands in front', () => {
  const game = newGame(1, SURE_FALL);
  game.startStage(1);
  const b = baby(game);
  const sofa = obj(game, 'sofa');
  makeCarry(game, 'ball');
  assert.equal(b.carrying, 'ball');
  reachSofa(game);
  assert.equal(b.climbing, 'sofa');
  const fx = run(game, DT);
  const hi = ofType(fx, 'hiyari');
  assert.equal(hi.length, 1);
  assert.equal(hi[0].objectId, 'sofa');
  assert.equal(hi[0].payload.babyId, 'baby0');
  assert.equal(hi[0].payload.combo, null);
  assert.equal(game.state.hiyari, 1);
  assert.equal(b.climbing, null);
  assert.equal(b.anim, 'stun');
  assert.deepEqual([b.x, b.y], [360, 270]); // spawn
  assert.ok(b.stunUntil > game.state.elapsed);
  // toy はソファの前の床に落ちる
  const ball = obj(game, 'ball');
  assert.equal(b.carrying, null);
  assert.equal(ball.carriedBy, null);
  assert.ok(ball.y >= 84 && ball.y < 130 && Math.abs(ball.x - 400) < 20, `ball ${ball.x},${ball.y}`);
  assert.ok(isWalkable(ball.x, ball.y, game.state.stage.walls, TUNING.BABY_RADIUS));
  // 家具は CLIMB_BORED_SEC の間、候補外
  assert.ok(Math.abs(sofa.boredUntil - (game.state.elapsed + TUNING.CLIMB_BORED_SEC)) < 0.05);
  assert.equal(sofa.state, 'open');
  assert.equal(isCandidate(sofa, b, game.state), false);
  // ログと result 用の原因
  const e = game.state.log.find(x => x.kind === 'hiyari');
  assert.ok(e && e.text === 'ソファから落ちた！（転落）', e && e.text);
  assert.equal(e.tone, 'bad');
  assert.deepEqual(game.state.hiyariEvents[0], { objectId: 'sofa', babyId: 'baby0', comboLabel: null });
});

test('mat → sofa fixes it (allHazardsFixedAt counts the sofa); a fall is then safe: no hiyari, climb_fall_safe, stun in front', () => {
  const game = newGame(1, SURE_FALL);
  game.startStage(1);
  const b = baby(game);
  const sofa = obj(game, 'sofa');
  const mat = obj(game, 'mat');
  const fx0 = dragTo(game, 'mat', sofa.x, sofa.y);
  assert.equal(sofa.state, 'fixed');
  assert.equal(mat.state, 'used');
  assert.equal(ofType(fx0, 'recipe_ok')[0].payload.recipeId, 'mat_sofa');
  // fixed でも候補・登れる
  assert.equal(isCandidate(sofa, b, game.state), true);
  reachSofa(game);
  assert.equal(b.climbing, 'sofa');
  const fx = run(game, DT);
  assert.equal(ofType(fx, 'hiyari').length, 0);
  assert.equal(game.state.hiyari, 0);
  const safe = ofType(fx, 'climb_fall_safe');
  assert.equal(safe.length, 1);
  assert.deepEqual(safe[0], { type: 'climb_fall_safe', objectId: 'sofa', payload: { babyId: 'baby0' } });
  assert.equal(b.climbing, null);
  assert.equal(b.anim, 'stun');
  assert.ok(b.stunUntil > game.state.elapsed);
  assert.ok(Math.abs(b.x - 400) < 1e-9 && b.y >= 84 && b.y < 110, `baby ${b.x},${b.y}`);
  assert.ok(isWalkable(b.x, b.y, game.state.stage.walls, TUNING.BABY_RADIUS));
  assert.ok(Math.abs(sofa.boredUntil - (game.state.elapsed + TUNING.CLIMB_BORED_SEC)) < 0.05);
  const e = game.state.log.find(x => x.kind === 'climb_fall_safe');
  assert.ok(e && e.text === 'ソファから落ちたが、ジョイントマットの上で無事', e && e.text);
  assert.equal(e.tone, 'good');
  // 残りの hazard を対策すると allHazardsFixedAt が立つ（sofa は mat で fixed 済み）
  const s = game.state;
  assert.equal(s.allHazardsFixedAt, null);
  dragTo(game, 'cover', obj(game, 'outlet').x, obj(game, 'outlet').y);
  dragTo(game, 'gate', obj(game, 'stairs').x, obj(game, 'stairs').y);
  dragTo(game, 'guard', obj(game, 'table').x, obj(game, 'table').y);
  dragTo(game, 'lock', obj(game, 'drawer').x, obj(game, 'drawer').y);
  assert.equal(s.allHazardsFixedAt, null);
  dragTo(game, 'detergent', 760, 100); // shelf（高い場所）
  assert.ok(s.allHazardsFixedAt != null && s.allHazardsFixedAt > 40, `allHazardsFixedAt ${s.allHazardsFixedAt}`);
});

test('climb ends after CLIMB_SEC: climb_end, baby on the floor in front, sofa boredUntil set and not a candidate until it passes', () => {
  const game = newGame(1, NO_FALL);
  game.startStage(1);
  const b = baby(game);
  const sofa = obj(game, 'sofa');
  reachSofa(game);
  const t0 = game.state.elapsed;
  let fx = run(game, TUNING.CLIMB_SEC - 0.1);
  assert.equal(b.climbing, 'sofa');
  assert.equal(ofType(fx, 'climb_end').length, 0);
  fx = run(game, 0.2);
  const ce = ofType(fx, 'climb_end');
  assert.equal(ce.length, 1);
  assert.deepEqual(ce[0], { type: 'climb_end', objectId: 'sofa', payload: { babyId: 'baby0' } });
  assert.equal(b.climbing, null);
  assert.equal(b.climbUntil, 0);
  assert.notEqual(b.anim, 'climb');
  assert.ok(Math.abs(game.state.elapsed - (t0 + TUNING.CLIMB_SEC)) < 0.2);
  assert.ok(b.y >= 84 && b.y < 110 && Math.abs(b.x - 400) < 1e-9, `baby ${b.x},${b.y}`);
  assert.ok(isWalkable(b.x, b.y, game.state.stage.walls, TUNING.BABY_RADIUS));
  assert.ok(Math.abs(sofa.boredUntil - (t0 + TUNING.CLIMB_SEC + TUNING.CLIMB_BORED_SEC)) < 0.05, `boredUntil ${sofa.boredUntil}`);
  assert.equal(isCandidate(sofa, b, game.state), false);
  assert.equal(game.state.hiyari, 0);
  const e = game.state.log.find(x => x.kind === 'climb_end');
  assert.ok(e && e.text === 'ソファから降りた', e && e.text);
  // 飽きている間はソファの前にいても登らない（FROZEN なので動かない）
  run(game, 1);
  assert.equal(b.climbing, null);
  // 飽きが明けると boredUntil が消え、また候補になる
  run(game, TUNING.CLIMB_BORED_SEC);
  assert.equal(sofa.boredUntil, null);
  assert.equal(isCandidate(sofa, b, game.state), true);
});

test('pickup while climbing clears climbing; takeaway hold works while climbing; twins never climb the same sofa', () => {
  const game = newGame(1, NO_FALL);
  game.startStage(1);
  const b = baby(game);
  makeCarry(game, 'ball');
  reachSofa(game);
  assert.equal(b.climbing, 'sofa');
  // 取り上げ長押し（登ったまま）
  game.input({ type: 'pressStart', targetId: 'baby0' });
  assert.deepEqual(game.state.press, { targetId: 'baby0', elapsed: 0, needSec: TUNING.TAKEAWAY_HOLD_SEC });
  let fx = run(game, TUNING.TAKEAWAY_HOLD_SEC + 0.05);
  assert.equal(ofType(fx, 'takeaway').length, 1);
  assert.equal(b.carrying, null);
  assert.equal(b.climbing, 'sofa'); // 登ったまま
  const ball = obj(game, 'ball');
  assert.ok(isWalkable(ball.x, ball.y, game.state.stage.walls, TUNING.BABY_RADIUS), `ball ${ball.x},${ball.y}`);
  // 抱き上げ → climbing 解除
  game.input({ type: 'dragStart', targetId: 'baby0', x: b.x, y: b.y });
  assert.equal(b.isHeld, true);
  assert.equal(b.climbing, null);
  assert.equal(b.climbUntil, 0);
  fx = run(game, DT);
  assert.equal(ofType(fx, 'pickup').length, 1);
  game.input({ type: 'dragEnd', x: 400, y: 300 });
  assert.equal(b.anim, 'stun');
  assert.deepEqual([b.x, b.y], [400, 300]);
  run(game, 1.5);
  assert.equal(b.climbing, null);
  assert.equal(game.state.hiyari, 0);

  // 双子：baby0 が登っている間、baby1 にとってソファは候補外で、触れても登らない
  const g2 = newGame(2, NO_FALL);
  g2.startStage(1);
  const [a, c] = g2.state.babies;
  const sofa = obj(g2, 'sofa');
  a.x = 400; a.y = 100;
  run(g2, DT);
  assert.equal(a.climbing, 'sofa');
  assert.equal(isCandidate(sofa, c, g2.state), false);
  c.x = 420; c.y = 100;
  const fx2 = run(g2, DT);
  assert.equal(c.climbing, null);
  assert.equal(ofType(fx2, 'climb_start').length, 0);
  assert.equal(ofType(fx2, 'hiyari').length, 0);
  assert.notEqual(c.targetId, 'sofa');
});

test('visitor: enters at `at`, drops 3 open items on the floor (inside the room, outside walls), leaves; cigarette is mouthed (§11.1)', () => {
  const game = newGame(1, FROZEN);
  game.startStage(1); // 双子：uncle at 10 s（キッチンには訪問者がいない：§11.6）
  const s = game.state;
  assert.equal(s.visitors.length, 2);
  const v = s.visitors[0];
  assert.equal(v.id, 'uncle');
  assert.equal(v.type, 'uncle');
  assert.equal(v.carrying, null);
  assert.equal(v.active, false);
  assert.equal(v.done, false);
  assert.deepEqual(v.dropped, []);
  const def = STAGES[1].visitors[0];
  let fx = run(game, def.at - 0.05);
  assert.equal(ofType(fx, 'visitor_enter').length, 0);
  assert.equal(v.active, false);
  fx = run(game, 0.1);
  const en = ofType(fx, 'visitor_enter');
  assert.equal(en.length, 1);
  assert.equal(en[0].objectId, 'uncle');
  assert.equal(v.active, true);
  assert.ok(s.log.some(e => e.kind === 'visitor_enter' && e.text === 'おじさんが入ってきた'));
  // path 全長 / VISITOR_SPEED 秒で退場
  let total = 0;
  for (let i = 1; i < def.path.length; i++) total += Math.hypot(def.path[i].x - def.path[i - 1].x, def.path[i].y - def.path[i - 1].y);
  const walkSec = total / TUNING.VISITOR_SPEED;
  const dropsSeen = [];
  fx = run(game, walkSec + 0.2, (i, f) => {
    for (const e of f) if (e.type === 'visitor_drop') dropsSeen.push({ t: s.elapsed, e });
  });
  const drops = ofType(fx, 'visitor_drop');
  assert.equal(drops.length, 3);
  assert.deepEqual(drops.map(e => e.objectId), ['cigarette', 'coin', 'pills']);
  assert.deepEqual(v.dropped, ['cigarette', 'coin', 'pills']);
  // 等間隔：落とす時刻の間隔がほぼ等しい
  const gaps = [dropsSeen[1].t - dropsSeen[0].t, dropsSeen[2].t - dropsSeen[1].t];
  assert.ok(Math.abs(gaps[0] - gaps[1]) < 0.1, `gaps ${gaps}`);
  assert.ok(Math.abs(gaps[0] - walkSec / 4) < 0.1, `gap ${gaps[0]} vs ${walkSec / 4}`);
  for (const e of drops) {
    assert.equal(e.payload.visitorId, 'uncle');
    const o = obj(game, e.objectId);
    assert.ok(o, `${e.objectId} exists`);
    assert.equal(o.kind, 'item');
    assert.equal(o.state, 'open');
    assert.equal(o.accident, '誤飲');
    assert.equal(o.respawnSec, null);
    assert.deepEqual([o.x, o.y], [e.payload.x, e.payload.y]);
    assert.deepEqual([o.spawnX, o.spawnY], [o.x, o.y]);
    assert.ok(o.x > 0 && o.x < 800 && o.y > 0 && o.y < 540, `${o.id} in room ${o.x},${o.y}`);
    assert.ok(isWalkable(o.x, o.y, s.stage.walls, TUNING.BABY_RADIUS), `${o.id} outside walls ${o.x},${o.y}`);
    assert.ok(s.log.some(l => l.kind === 'visitor_drop' && l.text === `おじさんが${o.label}を床に落とした` && l.tone === 'bad'), o.id);
  }
  // 定義は汚れていない（deep copy）
  assert.deepEqual([def.drops[0].x, def.drops[0].y], [0, 0]);
  assert.equal(def.drops[0].state, undefined);
  const lv = ofType(fx, 'visitor_leave').filter(e => e.objectId === 'uncle');
  assert.equal(lv.length, 1);
  assert.equal(v.active, false);
  assert.equal(v.done, true);
  assert.ok(s.log.some(e => e.kind === 'visitor_leave' && e.text === 'おじさんは気にせず出て行った'));
  // 一度きり（猫は 27 s なのでまだ来ない）
  fx = run(game, 2);
  assert.equal(ofType(fx, 'visitor_enter').length + ofType(fx, 'visitor_drop').length + ofType(fx, 'visitor_leave').length, 0);
  // id の重複なし
  const ids = s.objects.map(o => o.id);
  assert.equal(new Set(ids).size, ids.length);
  // たばこに触れると口に入れる（§11.1）。即ヒヤリではない
  const b = baby(game);
  const cig = obj(game, 'cigarette');
  b.x = cig.x; b.y = cig.y;
  fx = run(game, DT);
  assert.equal(ofType(fx, 'hiyari').length, 0);
  const ms = ofType(fx, 'mouth_start');
  assert.equal(ms.length, 1);
  assert.equal(ms[0].objectId, 'cigarette');
  assert.equal(b.mouthing.objectId, 'cigarette');
  assert.ok(s.log.some(e => e.kind === 'mouth_start' && e.text === 'たばこを口に入れそう！'));
  // 落ちた item はゴミ箱に捨てられる／高い場所へ置ける
  const bin = obj(game, 'bin');
  fx = dragTo(game, 'coin', bin.x, bin.y);
  assert.equal(obj(game, 'coin').state, 'removed');
  assert.equal(ofType(fx, 'trashed')[0].payload.into, 'bin');
  fx = dragTo(game, 'pills', 760, 100);
  assert.equal(obj(game, 'pills').state, 'removed');
  assert.equal(ofType(fx, 'stored')[0].payload.into, 'shelf');
  // respawn しない
  run(game, 30);
  assert.equal(obj(game, 'coin').state, 'removed');
  assert.equal(obj(game, 'pills').state, 'removed');
  // visitors はステージ開始でリセット
  game.startStage(1);
  assert.equal(s.visitors[0].active, false);
  assert.equal(s.visitors[0].done, false);
  assert.deepEqual(s.visitors[0].dropped, []);
  assert.equal(obj(game, 'cigarette'), undefined);
  // キッチンには訪問者がいない
  game.startStage(0);
  assert.deepEqual(s.visitors, []);
});

test('twins visitor also drops 3 items outside walls; visitor walks through walls (NPC) and babies are never affected by it', () => {
  const game = newGame(3);
  game.startStage(1);
  const s = game.state;
  const fx = run(game, 26);
  assert.equal(ofType(fx, 'visitor_enter').length, 1);
  assert.equal(ofType(fx, 'visitor_drop').length, 3);
  assert.equal(ofType(fx, 'visitor_leave').length, 1);
  for (const id of ['cigarette', 'coin', 'pills']) {
    const o = obj(game, id);
    assert.ok(o, id);
    assert.ok(isWalkable(o.spawnX, o.spawnY, s.stage.walls, TUNING.BABY_RADIUS), `${id} ${o.spawnX},${o.spawnY}`);
  }
});

test('medicine: light hazard in the kitchen (誤飲), mouthed on touch then swallowed (MOUTH_INGEST_PROB 1), fixed via high place with generic log text', () => {
  const game = newGame(1, { ...FROZEN, MOUTH_INGEST_PROB: 1 });
  game.startStage(0);
  const med = obj(game, 'medicine');
  assert.ok(med);
  assert.equal(med.kind, 'hazard');
  assert.equal(med.weight, 'light');
  assert.equal(med.draggable, true);
  assert.equal(med.accident, '誤飲');
  assert.equal(med.state, 'open');
  const b = baby(game);
  b.x = med.x; b.y = med.y;
  let fx = run(game, DT);
  assert.equal(ofType(fx, 'hiyari').length, 0);
  assert.equal(ofType(fx, 'mouth_start')[0].objectId, 'medicine');
  fx = run(game, TUNING.MOUTH_SEC_MAX + DT);
  assert.equal(ofType(fx, 'hiyari')[0].objectId, 'medicine');
  assert.equal(ofType(fx, 'hiyari')[0].payload.mouth, true);
  assert.ok(game.state.log.some(e => e.kind === 'hiyari' && e.text === '薬を飲み込んだ！（誤飲）'));
  assert.equal(med.state, 'open');
  assert.equal(med.carriedBy, null);
  run(game, 1.1);
  fx = dragTo(game, 'medicine', 300, 30);
  assert.equal(med.state, 'fixed');
  assert.deepEqual(ofType(fx, 'fixed')[0].payload, { via: 'high', into: 'counter' });
  assert.equal(med.storedIn, 'counter');
  assert.ok(game.state.log.some(e => e.kind === 'fixed' && e.text === '薬をカウンターの上へ移した。届かない'));
});

test('climbing baby in the twins stage with the real tuning: no hiyari from the sofa on touch, determinism holds', () => {
  const runSeed = (seed) => {
    const game = newGame(seed);
    game.startStage(1);
    const climbs = [];
    let touchedWhileOpen = 0;
    const fx = run(game, 45.2, (i, f) => {
      for (const e of f) if (e.type === 'climb_start') climbs.push(game.state.elapsed);
      for (const b of game.state.babies) {
        if (b.climbing) assert.equal(b.anim, 'climb');
        if (b.climbing == null && game.state.screen === 'play' && !b.isHeld) {
          assert.ok(b.x >= 14 && b.x <= 786 && b.y >= 14 && b.y <= 526, `baby left room ${b.x},${b.y}`);
        }
      }
      for (const e of f) if (e.type === 'hiyari' && e.objectId === 'sofa') touchedWhileOpen++;
    });
    return { fx, climbs, state: game.state };
  };
  let anyClimb = false;
  for (let seed = 1; seed <= 12; seed++) {
    const r = runSeed(seed);
    if (r.climbs.length) anyClimb = true;
    // ソファでのヒヤリはすべて転落（climb_start の後にだけ起きる）
    const sofaHiyari = r.fx.filter(e => e.type === 'hiyari' && e.objectId === 'sofa');
    if (sofaHiyari.length) assert.ok(r.climbs.length > 0, `seed ${seed}: sofa hiyari without climbing`);
    assert.equal(r.state.screen, 'stageResult');
  }
  assert.ok(anyClimb, 'some seed climbs the sofa within 45 s');
  const a = runSeed(5);
  const b = runSeed(5);
  assert.deepStrictEqual(a.state, b.state);
  assert.deepStrictEqual(a.fx, b.fx);
});
