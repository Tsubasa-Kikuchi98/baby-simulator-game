import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, DT, run, obj, baby, ofType, FROZEN, dragTo } from './helpers.js';

// 2 ステージ構成（CONTRACT §9）：キッチン（45 秒、edu 'burn'）→ 双子（45 秒、edu 'combo'）→ finalResult
test('title -> loading -> tutorial -> play(kitchen) -> stageResult -> loading -> play(twins) -> stageResult -> finalResult -> title', () => {
  const game = newGame(1, FROZEN);
  const s = game.state;
  const screens = [];
  const collect = fx => { for (const e of ofType(fx, 'screen')) screens.push(`${e.payload.from}>${e.payload.to}`); };

  assert.equal(s.screen, 'title');
  assert.deepEqual(game.update(DT), []);
  game.dispatch({ type: 'start' });
  assert.equal(s.screen, 'loading');
  assert.deepEqual(s.loading, { elapsed: 0, ready: false, next: 'tutorial' });
  assert.ok(s.tip && s.tip.id);
  assert.deepEqual(s.shownTipIds, [s.tip.id]);
  collect(run(game, 3));
  assert.equal(s.screen, 'loading'); // assetsReady 待ち
  game.dispatch({ type: 'assetsReady' });
  collect(run(game, DT));
  assert.equal(s.screen, 'tutorial');
  assert.ok(s.tutorialTip && s.tutorialTip.id !== s.tip.id);
  assert.deepEqual(game.update(DT), []);
  game.dispatch({ type: 'tutorialOk' });
  assert.equal(s.screen, 'play');
  assert.equal(s.stageIndex, 0);
  assert.equal(s.stage.id, 1);
  assert.equal(s.stage.name, 'キッチン');
  assert.equal(s.babies.length, 1);
  assert.equal(s.timeLeft, 45);
  collect(run(game, 45.1));
  assert.equal(s.screen, 'stageResult');
  assert.equal(s.result.cleared, true);
  assert.equal(s.result.eduCardId, 'burn');
  assert.equal(s.result.score, 2000);
  assert.deepEqual(s.result.breakdown, { hiyariBonus: 2000, playBonus: 0, timeBonus: 0 });
  assert.equal(s.totalScore, 2000);
  assert.deepEqual(game.update(DT), []);
  game.dispatch({ type: 'retry' }); // clear なので無視
  assert.equal(s.screen, 'stageResult');
  game.dispatch({ type: 'next' });
  assert.equal(s.screen, 'loading');
  assert.equal(s.loading.next, 'play');
  assert.equal(s.stageIndex, 1);
  game.dispatch({ type: 'assetsReady' });
  collect(run(game, 2.4));
  assert.equal(s.screen, 'loading'); // 最低表示時間
  collect(run(game, 0.2));
  assert.equal(s.screen, 'play');
  assert.equal(s.stage.id, 2);
  assert.equal(s.stage.name, '双子');
  assert.equal(s.babies.length, 2);
  assert.deepEqual(s.babies.map(b => b.id), ['baby0', 'baby1']);
  assert.equal(s.stage.timeLimit, 45);
  assert.ok(s.timeLeft > 44.8 && s.timeLeft <= 45);
  collect(run(game, 45.1));
  assert.equal(s.screen, 'stageResult');
  assert.equal(s.result.cleared, true);
  assert.equal(s.result.eduCardId, 'combo');
  assert.equal(s.totalScore, 4000);
  game.dispatch({ type: 'next' }); // 最終ステージ → finalResult
  assert.equal(s.screen, 'finalResult');
  collect(game.update(DT));
  assert.deepEqual(game.update(DT), []);
  game.dispatch({ type: 'toTitle' });
  assert.equal(s.screen, 'title');
  assert.equal(s.totalScore, 0);
  assert.deepEqual(s.shownTipIds, []);
  collect(game.update(DT));

  assert.deepEqual(screens, [
    'title>loading', 'loading>tutorial', 'tutorial>play', 'play>stageResult',
    'stageResult>loading', 'loading>play', 'play>stageResult',
    'stageResult>finalResult', 'finalResult>title'
  ]);
});

test('fail -> retry -> loading -> same stage; totalScore unchanged', () => {
  const game = newGame(2, FROZEN);
  game.startStage(1);
  game.state.totalScore = 1234;
  const s = game.state;
  const b = baby(game, 0);
  const stairs = obj(game, 'stairs');
  for (let i = 0; i < 3; i++) {
    b.x = stairs.x; b.y = stairs.y;
    run(game, DT);
    if (i < 2) run(game, 1.1);
  }
  assert.equal(s.screen, 'stageResult');
  assert.equal(s.result.cleared, false);
  assert.equal(s.result.eduCardId, 'combo');
  assert.equal(s.totalScore, 1234);
  game.dispatch({ type: 'next' }); // fail なので無視
  assert.equal(s.screen, 'stageResult');
  game.dispatch({ type: 'retry' });
  assert.equal(s.screen, 'loading');
  assert.equal(s.stageIndex, 1);
  game.dispatch({ type: 'assetsReady' });
  run(game, 2.6);
  assert.equal(s.screen, 'play');
  assert.equal(s.stage.id, 2);
  assert.equal(s.hiyari, 0);
  assert.ok(s.elapsed < 0.2);
  assert.equal(s.result, null);
});

test('startStage(index) enters play directly, fresh state, totalScore preserved; input ignored outside play', () => {
  const game = newGame(1);
  game.state.totalScore = 500;
  game.input({ type: 'dragStart', targetId: 'kettle', x: 0, y: 0 });
  game.startStage(1);
  const s = game.state;
  assert.equal(s.screen, 'play');
  assert.equal(s.stageIndex, 1);
  assert.equal(s.totalScore, 500);
  assert.equal(s.press, null);
  assert.equal(s.drag, null);
  const fx = game.update(DT);
  assert.deepEqual(ofType(fx, 'screen')[0].payload, { from: 'title', to: 'play' });
  game.startStage(0, { skipLoading: false });
  assert.equal(s.screen, 'loading');
  assert.equal(s.loading.next, 'play');
  assert.throws(() => game.startStage(2), /out of range/);
});

test('score formula: hiyari, play and time bonus (hazards fixed by drag & drop)', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const drawer = obj(game, 'drawer');
  dragTo(game, 'cover', obj(game, 'outlet').x, obj(game, 'outlet').y);
  dragTo(game, 'kettle', 330, 30);
  dragTo(game, 'knife', drawer.x, drawer.y);
  dragTo(game, 'lock', drawer.x, drawer.y);
  dragTo(game, 'trashlock', obj(game, 'trash').x, obj(game, 'trash').y);
  dragTo(game, 'medicine', 300, 30); // 薬はカウンターへ（§10.3）
  const fixedAt = game.state.allHazardsFixedAt;
  assert.ok(fixedAt > 0);
  const b = game.state.babies[0];
  const ball = game.state.objects.find(o => o.id === 'ball');
  ball.x = b.x; ball.y = b.y;
  run(game, 3.2);
  assert.equal(game.state.playCount, 1);
  const fx = run(game, 45);
  const plays = game.state.playCount; // 止まった赤ちゃんは bored 解除ごとに遊び直す
  assert.ok(plays >= 1);
  const clear = ofType(fx, 'stage_clear');
  assert.equal(clear.length, 1);
  assert.deepEqual(clear[0].payload.breakdown, { hiyariBonus: 2000, playBonus: plays * 200, timeBonus: Math.round(fixedAt) * 10 });
  assert.equal(clear[0].payload.score, 2000 + plays * 200 + Math.round(fixedAt) * 10);
  assert.equal(game.state.result.score, clear[0].payload.score);
});
