import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, DT, run } from './helpers.js';

function scripted(seed) {
  const game = newGame(seed);
  game.startStage(0);
  const script = {
    60: { type: 'pressStart', targetId: 'outlet' },
    130: { type: 'pressEnd' },
    200: { type: 'pressStart', targetId: 'drawer' },
    300: { type: 'dragStart', targetId: 'ball', x: 650, y: 450 },
    310: { type: 'dragMove', x: 600, y: 400 },
    320: { type: 'dragEnd', x: 650, y: 420 },
    400: { type: 'dragStart', targetId: 'kettle', x: 330, y: 95 },
    410: { type: 'dragMove', x: 330, y: 60 },
    420: { type: 'dragEnd', x: 330, y: 30 },
    500: { type: 'dragStart', targetId: 'battery', x: 200, y: 300 },
    520: { type: 'dragEnd', x: 720, y: 330 },
    600: { type: 'dragStart', targetId: 'baby0', x: 400, y: 270 },
    620: { type: 'dragEnd', x: 200, y: 250 },
    900: { type: 'pressStart', targetId: 'baby0' },
    1000: { type: 'pressEnd' }
  };
  const effects = [];
  for (let i = 0; i < 90 * 60 && game.state.screen === 'play'; i++) {
    if (script[i]) game.input(script[i]);
    effects.push(...game.update(DT));
  }
  return { state: game.state, effects };
}

test('same seed + same scripted inputs -> deep-equal final state and effects', () => {
  const a = scripted(7);
  const b = scripted(7);
  assert.deepStrictEqual(a.state, b.state);
  assert.deepStrictEqual(a.effects, b.effects);
});

test('different seeds diverge (sanity)', () => {
  const a = scripted(1);
  const b = scripted(2);
  assert.notDeepStrictEqual(a.effects, b.effects);
});

// ステージ 1（キッチン、45 秒）に toy が 4 つある配置では、noop でもクリアする seed がある。
// ここでは「ステージが終わる」「失敗なら hiyari==3」「部屋・壁の外に出ない」だけを見る（難易度は sim/assert.js の対象）
test('noop stage 1 ends (fail => hiyari == 3), babies stay in room and out of walls', () => {
  let fails = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const game = newGame(seed);
    game.startStage(0);
    run(game, 91, () => {
      if (game.state.screen !== 'play') return;
      for (const b of game.state.babies) {
        assert.ok(b.x >= 14 && b.x <= 786 && b.y >= 14 && b.y <= 526, `baby left room ${b.x},${b.y}`);
        for (const w of game.state.stage.walls) {
          assert.ok(!(b.x > w.x - 14 && b.x < w.x + w.w + 14 && b.y > w.y - 14 && b.y < w.y + w.h + 14), `baby in wall ${w.model}`);
        }
      }
    });
    const s = game.state;
    assert.equal(s.screen, 'stageResult');
    if (!s.result.cleared) {
      fails++;
      assert.equal(s.hiyari, 3);
      assert.ok(s.result.failAtSec >= 5 && s.result.failAtSec <= 45, `seed ${seed} failAt ${s.result.failAtSec}`);
    } else {
      assert.ok(s.hiyari < 3);
    }
  }
  // 難易度はユーザー判断なので回数は assert しない
  console.log(`  noop stage1: ${fails}/20 seeds failed`);
});

test('noop stage 1 over 30 seeds always reaches stageResult; failures happen after 5 s', () => {
  const times = [];
  for (let seed = 1; seed <= 30; seed++) {
    const game = newGame(seed);
    game.startStage(0);
    run(game, 91);
    assert.equal(game.state.screen, 'stageResult', `seed ${seed} screen ${game.state.screen}`);
    if (!game.state.result.cleared) times.push(game.state.result.failAtSec);
  }
  for (const t of times) assert.ok(t >= 5, `fail too early ${t}`);
  times.sort((a, b) => a - b);
  console.log(`  noop stage1 failed ${times.length}/30, median failAt ${times.length ? times[Math.floor(times.length / 2)].toFixed(1) : '-'}`);
});

test('noop stage 2 (twins) runs without exceptions; babies move and reach objects', () => {
  for (const idx of [1]) {
    const game = newGame(3);
    game.startStage(idx);
    let moved = 0;
    const start = game.state.babies.map(b => ({ x: b.x, y: b.y }));
    const fx = run(game, 90, () => {
      game.state.babies.forEach((b, i) => { moved = Math.max(moved, Math.hypot(b.x - start[i].x, b.y - start[i].y)); });
    });
    assert.ok(moved > 100, 'babies moved');
    assert.ok(fx.some(e => e.type === 'hiyari' || e.type === 'play_done'), 'reached something');
    assert.ok(game.state.screen === 'stageResult');
  }
});

test('stage 2 twins never share a target', () => {
  const game = newGame(5);
  game.startStage(1);
  run(game, 45, () => {
    const [a, b] = game.state.babies;
    if (a.targetId != null) assert.notEqual(a.targetId, b.targetId);
  });
});
