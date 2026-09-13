import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, DT, run, obj, baby, ofType, FROZEN, makeCarry, dragTo } from './helpers.js';
import { isCandidate } from '../../src/game/baby.js';
import { describeEvent } from '../../src/game/log.js';
import { MERGED_TOYS, STAGES } from '../../src/game/stages.js';

// stage 0 = キッチン：cover→outlet / lock→drawer / tie→kettle / trashlock→trash / knife→drawer(store) / blocks×bear→bear_tower
// stage 1 = 双子：cover→outlet / guard→table / lock→drawer / gate→stairs / blocks×bear→bear_tower

test('goods: runtime state available, never a press target, draggable like a toy with floor snap', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const cover = obj(game, 'cover');
  assert.equal(cover.kind, 'goods');
  assert.equal(cover.state, 'available');
  game.input({ type: 'pressStart', targetId: 'cover' });
  assert.equal(game.state.press, null);
  game.input({ type: 'dragStart', targetId: 'cover', x: cover.x, y: cover.y });
  assert.deepEqual(game.state.drag, { targetId: 'cover', x: cover.x, y: cover.y });
  game.input({ type: 'dragMove', x: 400, y: 400 });
  assert.equal(cover.x, 400);
  assert.equal(cover.y, 400);
  game.input({ type: 'dragEnd', x: 400, y: 400 }); // island（highPlace ではない）内 → 床へスナップ
  assert.equal(game.state.drag, null);
  assert.equal(cover.x, 400);
  assert.equal(cover.y, 380 - 16);
  assert.equal(cover.state, 'available');
  assert.ok(Math.abs(cover.draggedAt - game.state.elapsed) < 1e-9);
});

test('goods dropped on its matching hazard fixes it instantly; goods becomes used; allHazardsFixedAt counts it', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const outlet = obj(game, 'outlet');
  const cover = obj(game, 'cover');
  const fx = dragTo(game, 'cover', outlet.x, outlet.y);
  assert.equal(outlet.state, 'fixed');
  assert.equal(outlet.progress, 0);
  assert.equal(cover.state, 'used');
  const fixed = ofType(fx, 'fixed');
  assert.equal(fixed.length, 1);
  assert.equal(fixed[0].objectId, 'outlet');
  assert.deepEqual(fixed[0].payload, { via: 'goods', goodsId: 'cover' });
  const ok = ofType(fx, 'recipe_ok');
  assert.equal(ok.length, 1);
  assert.equal(ok[0].objectId, 'outlet');
  assert.equal(ok[0].payload.type, 'fix');
  assert.equal(ok[0].payload.recipeId, 'cover_outlet');
  assert.deepEqual([ok[0].payload.a, ok[0].payload.b], ['cover', 'outlet']);
  assert.equal(ofType(fx, 'recipe_ng').length, 0);
  // used な goods は再ドラッグできない
  game.input({ type: 'dragStart', targetId: 'cover', x: cover.x, y: cover.y });
  assert.equal(game.state.drag, null);
  // 同じ hazard に別の goods を重ねても何も起きない（fixed には不成立）
  const fx2 = dragTo(game, 'lock', outlet.x, outlet.y);
  assert.equal(ofType(fx2, 'fixed').length + ofType(fx2, 'recipe_ok').length, 0);
  // 残りをドラッグで対策 → allHazardsFixedAt が立つ（goods / store 経由の fixed も含めて判定）
  const drawer = obj(game, 'drawer');
  for (const [a, tx, ty] of [['tie', obj(game, 'kettle').x, obj(game, 'kettle').y], ['knife', drawer.x, drawer.y], ['lock', drawer.x, drawer.y], ['trashlock', obj(game, 'trash').x, obj(game, 'trash').y], ['medicine', 300, 30]]) {
    assert.equal(game.state.allHazardsFixedAt, null);
    dragTo(game, a, tx, ty);
  }
  assert.ok(game.state.allHazardsFixedAt > 40, `allHazardsFixedAt ${game.state.allHazardsFixedAt}`);
});

test('goods dropped on a non-matching hazard emits recipe_ng and stays available at the drop position', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const outlet = obj(game, 'outlet');
  const lock = obj(game, 'lock'); // for: ['drawer']
  const fx = dragTo(game, 'lock', outlet.x, outlet.y);
  assert.equal(outlet.state, 'open');
  assert.equal(lock.state, 'available');
  assert.equal(lock.x, outlet.x);
  assert.equal(lock.y, outlet.y);
  const ng = ofType(fx, 'recipe_ng');
  assert.equal(ng.length, 1);
  assert.equal(ng[0].objectId, 'outlet');
  assert.deepEqual(ng[0].payload, { a: 'lock', b: 'outlet', x: outlet.x, y: outlet.y });
  assert.equal(ofType(fx, 'fixed').length, 0);
  assert.equal(ofType(fx, 'recipe_ok').length, 0);
  // 対応する hazard には使える
  const drawer = obj(game, 'drawer');
  const fx2 = dragTo(game, 'lock', drawer.x, drawer.y);
  assert.equal(drawer.state, 'fixed');
  assert.equal(lock.state, 'used');
  assert.equal(ofType(fx2, 'fixed')[0].payload.goodsId, 'lock');
});

test('goods dropped far from anything, or a toy dropped on a hazard, is a plain drop (no recipe effects)', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  let fx = dragTo(game, 'cover', 500, 300);
  assert.equal(ofType(fx, 'recipe_ng').length + ofType(fx, 'recipe_ok').length, 0);
  assert.equal(obj(game, 'cover').state, 'available');
  const outlet = obj(game, 'outlet');
  fx = dragTo(game, 'ball', outlet.x, outlet.y);
  assert.equal(ofType(fx, 'recipe_ng').length + ofType(fx, 'recipe_ok').length + ofType(fx, 'trashed').length, 0);
  assert.equal(outlet.state, 'open');
  assert.equal(obj(game, 'ball').state, 'available');
});

test('blocks + bear merge into bear_tower at the drop position with removed x2, toy_merged, recipe_ok', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const bear = obj(game, 'bear');
  const blocks = obj(game, 'blocks');
  const n = game.state.objects.length;
  const fx = dragTo(game, 'blocks', bear.x + 10, bear.y - 5);
  assert.equal(blocks.state, 'removed');
  assert.equal(bear.state, 'removed');
  assert.equal(game.state.objects.length, n + 1);
  const merged = obj(game, 'bear_tower');
  assert.ok(merged, 'bear_tower appended');
  assert.equal(merged.kind, 'toy');
  assert.equal(merged.merged, true);
  assert.equal(merged.state, 'available');
  assert.equal(merged.playCount, 0);
  assert.equal(merged.carriedBy, null);
  assert.equal(merged.x, bear.x + 10);
  assert.equal(merged.y, bear.y - 5);
  assert.ok(Math.abs(merged.draggedAt - game.state.elapsed) < 0.02);
  assert.deepEqual(merged.satPlay, [35, 20, 12]);
  assert.equal(merged.targetWeight, 4.5);
  assert.equal(merged.weight, 'light');
  assert.equal(merged.draggable, true);
  assert.notEqual(merged, MERGED_TOYS.bear_tower); // deep copy
  merged.x += 1;
  assert.equal(MERGED_TOYS.bear_tower.x, 0);

  const seq = fx.filter(e => ['removed', 'toy_merged', 'recipe_ok'].includes(e.type));
  assert.deepEqual(seq.map(e => e.type), ['removed', 'removed', 'toy_merged', 'recipe_ok']);
  assert.deepEqual(seq[0], { type: 'removed', objectId: 'blocks', payload: { kind: 'toy', merged: true } });
  assert.deepEqual(seq[1], { type: 'removed', objectId: 'bear', payload: { kind: 'toy', merged: true } });
  assert.equal(seq[2].objectId, 'bear_tower');
  assert.deepEqual(seq[2].payload, {
    a: 'blocks', b: 'bear', recipeId: 'bear_tower', label: '積み木 × ぬいぐるみ → くまの積み木タワー', x: bear.x + 10, y: bear.y - 5
  });
  assert.equal(seq[3].objectId, 'bear_tower');
  assert.equal(seq[3].payload.type, 'toy');
  assert.equal(seq[3].payload.recipeId, 'bear_tower');
  // 合成 toy はドラッグでき、高い場所に片付けられる
  game.input({ type: 'dragStart', targetId: 'bear_tower', x: merged.x, y: merged.y });
  assert.equal(game.state.drag.targetId, 'bear_tower');
  game.input({ type: 'dragEnd', x: 500, y: 300 });
  assert.equal(merged.x, 500);
  const fx3 = dragTo(game, 'bear_tower', 400, 30);
  assert.equal(merged.state, 'removed');
  assert.equal(ofType(fx3, 'stored')[0].payload.into, 'counter');
});

test('merged toy gives +35 on first play (satPlay) and uses its own targetWeight for targeting', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const b = baby(game);
  const bear = obj(game, 'bear');
  dragTo(game, 'blocks', bear.x, bear.y);
  const merged = obj(game, 'bear_tower');
  b.satisfaction = 50;
  const fx = makeCarry(game, 'bear_tower');
  const ps = ofType(fx, 'play_start');
  assert.equal(ps.length, 1);
  assert.deepEqual(ps[0], { type: 'play_start', objectId: 'bear_tower', payload: { babyId: 'baby0' } });
  const pd = ofType(fx, 'play_done');
  assert.equal(pd.length, 1);
  assert.equal(pd[0].payload.amount, 35);
  assert.ok(Math.abs(b.satisfaction - 85) < 0.2, `sat ${b.satisfaction}`);
  assert.equal(b.carrying, 'bear_tower');
  assert.equal(merged.state, 'bored');
  // 2 回目は 20
  run(game, 8.1); // 手放し
  merged.state = 'available'; merged.boredUntil = null;
  b.satisfaction = 50;
  const fx2 = makeCarry(game, 'bear_tower');
  assert.equal(ofType(fx2, 'play_done')[0].payload.amount, 20);
});

test('toy recipe does not fire while a partner is being played with', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const b = baby(game);
  const bear = obj(game, 'bear');
  bear.x = b.x; bear.y = b.y;
  run(game, DT);
  assert.equal(bear.playingBy, 'baby0');
  const fx = dragTo(game, 'blocks', bear.x, bear.y);
  assert.equal(ofType(fx, 'toy_merged').length, 0);
  assert.equal(obj(game, 'blocks').state, 'available');
  assert.equal(bear.state, 'available');
  assert.equal(obj(game, 'bear_tower'), undefined);
});

test('goods are never a baby target candidate and never touched', () => {
  for (const seed of [1, 2, 3]) {
    const game = newGame(seed);
    game.startStage(0);
    const b = baby(game);
    for (const g of game.state.objects.filter(o => o.kind === 'goods')) assert.equal(isCandidate(g, b, game.state), false);
    const goodsIds = new Set(game.state.objects.filter(o => o.kind === 'goods').map(o => o.id));
    run(game, 45, () => {
      if (game.state.screen !== 'play') return;
      for (const bb of game.state.babies) assert.ok(!goodsIds.has(bb.targetId), `targeted goods ${bb.targetId}`);
    });
    for (const g of game.state.objects.filter(o => o.kind === 'goods')) assert.equal(g.state, 'available');
  }
  // 2 人でも同じ
  const game3 = newGame(4);
  game3.startStage(1);
  const goods3 = new Set(game3.state.objects.filter(o => o.kind === 'goods').map(o => o.id));
  run(game3, 40, () => { for (const bb of game3.state.babies) assert.ok(!goods3.has(bb.targetId)); });
});

test('state.log receives entries for hiyari / play_start / fixed (store and goods), cleared on stage start', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const s = game.state;
  assert.deepEqual(s.log, []);
  const b = baby(game);
  const drawer = obj(game, 'drawer');
  b.x = drawer.x; b.y = drawer.y;
  run(game, DT);
  let e = s.log.find(x => x.kind === 'hiyari');
  assert.ok(e, 'hiyari logged');
  assert.ok(e.text.includes('引き出し') && e.text.includes('指はさみ'), e.text);
  assert.equal(e.tone, 'bad');
  assert.ok(Math.abs(e.t - s.elapsed) < 1e-9);
  run(game, 1.1);
  makeCarry(game, 'ball');
  e = s.log.find(x => x.kind === 'play_start');
  assert.ok(e && e.text.includes('ボールで遊んでいる'), e && e.text);
  assert.equal(e.tone, 'good');
  e = s.log.find(x => x.kind === 'play_done');
  assert.ok(e && e.text.includes('ボール') && e.text.includes('+25'), e && e.text);
  e = s.log.find(x => x.kind === 'bored');
  assert.ok(e && e.text.includes('ボール') && e.text.includes('30秒'), e && e.text);
  dragTo(game, 'knife', drawer.x, drawer.y); // store
  e = s.log.find(x => x.kind === 'fixed');
  assert.ok(e && e.text.includes('包丁') && e.text.includes('引き出し') && e.text.includes('収納'), e && e.text);
  assert.equal(e.tone, 'good');
  const kettle = obj(game, 'kettle');
  dragTo(game, 'tie', kettle.x, kettle.y); // goods
  const fixedLogs = s.log.filter(x => x.kind === 'fixed');
  assert.equal(fixedLogs.length, 2);
  assert.ok(fixedLogs[1].text.includes('コード留め') && fixedLogs[1].text.includes('→') && fixedLogs[1].text.includes('電気ケトル'), fixedLogs[1].text);
  assert.ok(s.log.every(x => ['bad', 'good', 'info'].includes(x.tone)));
  // 順序は古いものが先
  for (let i = 1; i < s.log.length; i++) assert.ok(s.log[i].t >= s.log[i - 1].t);
  game.startStage(1);
  assert.deepEqual(s.log, []);
});

test('describeEvent covers the §8.3 / §9.4 tables and returns null for unknown effects; log is capped at 200', () => {
  const game = newGame(1, FROZEN);
  game.startStage(1);
  const s = game.state;
  const d = (type, objectId, payload = {}) => describeEvent({ type, objectId, payload }, s);
  assert.equal(d('screen', null, { from: 'a', to: 'b' }), null);
  assert.equal(d('combo_warn', 'outlet', { active: true }), null);
  assert.deepEqual(d('hiyari', 'battery', { combo: null }), { text: 'ボタン電池を口に入れそうになった！（誤飲）', tone: 'bad' });
  assert.equal(d('hiyari', 'outlet', { combo: { toy: 'spoon' } }), null); // combo_hiyari 側で出す
  assert.deepEqual(d('combo_hiyari', 'outlet', { toyId: 'spoon', ignoresFix: true }),
    { text: '金属のスプーンを持ってコンセントへ！ コンセントカバーをしていても危険', tone: 'bad' });
  assert.deepEqual(d('toy_merged', 'music_blocks', { a: 'blocks', b: 'bear' }), { text: '積み木 × ぬいぐるみ → 新しいおもちゃができた！', tone: 'good' });
  assert.deepEqual(d('recipe_ng', 'outlet', { a: 'lock' }), { text: 'チャイルドロックはコンセントには使えない', tone: 'info' });
  assert.deepEqual(d('removed', 'battery', { kind: 'item' }), { text: 'ボタン電池をゴミ箱に捨てた', tone: 'good' }); // item.fix「ゴミ箱に捨てる」の過去形
  assert.deepEqual(d('removed', 'ball', { kind: 'toy' }), { text: 'ボールを片付けた', tone: 'info' });
  assert.deepEqual(d('trashed', 'battery', { kind: 'item', into: 'bin' }), { text: 'ボタン電池をフタ付きゴミ箱に捨てた', tone: 'good' });
  assert.deepEqual(d('trashed', 'ball', { kind: 'toy', into: 'bin' }), { text: 'ボールをフタ付きゴミ箱に捨てた', tone: 'info' });
  assert.deepEqual(d('stored', 'ball', { kind: 'toy', into: 'shelf' }), { text: 'ボールを棚の上に片付けた', tone: 'info' });
  assert.deepEqual(d('stored', 'battery', { kind: 'item', into: 'tv_stand' }), { text: 'ボタン電池をテレビ台の上に片付けた', tone: 'good' });
  assert.deepEqual(d('fixed', 'detergent', { via: 'high', into: 'shelf' }), { text: '洗剤ボトルを棚の上へ移した。届かない', tone: 'good' });
  assert.deepEqual(d('fixed', 'outlet', { via: 'goods', goodsId: 'cover' }), { text: 'コンセントカバー → コンセント。すぐに対策できた', tone: 'good' });
  assert.deepEqual(d('pickup', 'baby0', { amount: -15 }), { text: '抱き上げられた（満足度 −15）', tone: 'bad' });
  assert.deepEqual(d('takeaway', 'baby0', { amount: -20, toyId: 'spoon' }), { text: '金属のスプーンを取り上げられた（満足度 −20）', tone: 'bad' });
  assert.deepEqual(d('no_toy', null, { active: true }), { text: '遊べるおもちゃがない。退屈している', tone: 'bad' });
  assert.equal(d('no_toy', null, { active: false }), null);
  assert.deepEqual(d('respawn', 'battery'), { text: 'ボタン電池がまた出てきた', tone: 'bad' });
  assert.deepEqual(d('stage_clear', null), { text: 'クリア！', tone: 'good' });
  assert.deepEqual(d('stage_fail', null), { text: 'ヒヤリ3回で失敗', tone: 'bad' });
  assert.deepEqual(d('unbored', 'ball'), { text: 'ボールにまた興味が出た', tone: 'info' });
  assert.deepEqual(d('drop', 'ball', { reason: 'bored' }), { text: 'ボールを手放した', tone: 'info' });
  assert.deepEqual(d('fuss_start', 'baby0', { until: 5 }), { text: 'ぐずっている。危険なものに向かいやすい', tone: 'bad' });
  // store はキッチンで
  const gk = newGame(1, FROZEN);
  gk.startStage(0);
  assert.deepEqual(describeEvent({ type: 'fixed', objectId: 'knife', payload: { via: 'store', into: 'drawer' } }, gk.state), { text: '包丁を引き出しに収納した', tone: 'good' });
  assert.deepEqual(describeEvent({ type: 'trashed', objectId: 'battery', payload: { kind: 'item', into: 'trash' } }, gk.state), { text: 'ボタン電池をゴミ箱に捨てた', tone: 'good' });
  // cap 200
  const ball = obj(game, 'ball');
  for (let i = 0; i < 260; i++) { ball.state = 'bored'; ball.boredUntil = s.elapsed; run(game, DT); }
  assert.ok(s.log.length <= 200, `log ${s.log.length}`);
  assert.equal(s.log.length, 200);
});

test('result.hiyariCauses groups by object (count desc, combo label) and result.log copies the log', () => {
  const game = newGame(1, FROZEN);
  game.startStage(1);
  const b = baby(game, 0);
  const table = obj(game, 'table');
  const stairs = obj(game, 'stairs');
  // 1: stairs, 2: table, 3: table → fail
  b.x = stairs.x; b.y = stairs.y; run(game, DT); run(game, 1.1);
  b.x = table.x; b.y = table.y; run(game, DT); run(game, 1.1);
  b.x = table.x; b.y = table.y; run(game, DT);
  const s = game.state;
  assert.equal(s.screen, 'stageResult');
  const r = s.result;
  assert.deepEqual(r.hiyariCauses, [
    { objectId: 'table', label: 'テーブルの角', accident: '打撲', count: 2, combo: null },
    { objectId: 'stairs', label: '階段', accident: '転落', count: 1, combo: null }
  ]);
  assert.ok(Array.isArray(r.log) && r.log.length >= 4);
  assert.equal(r.log[r.log.length - 1].kind, 'stage_fail');
  assert.equal(r.log[r.log.length - 1].text, 'ヒヤリ3回で失敗');
  assert.deepEqual(r.log, s.log);
  assert.notEqual(r.log, s.log);
  // combo ヒヤリの label（キッチン：ボール × ケトル）
  const g2 = newGame(1, FROZEN);
  g2.startStage(0);
  const b2 = baby(g2);
  const kettle = obj(g2, 'kettle');
  makeCarry(g2, 'ball');
  b2.x = kettle.x; b2.y = kettle.y + 20;
  run(g2, DT);
  assert.equal(g2.state.hiyari, 1);
  run(g2, 1.1);
  b2.x = kettle.x; b2.y = kettle.y + 20;
  run(g2, DT);
  run(g2, 1.1);
  b2.x = kettle.x; b2.y = kettle.y + 20;
  run(g2, DT);
  assert.equal(g2.state.screen, 'stageResult');
  assert.equal(g2.state.result.hiyariCauses.length, 1);
  assert.equal(g2.state.result.hiyariCauses[0].objectId, 'kettle');
  assert.equal(g2.state.result.hiyariCauses[0].count, 3);
  assert.equal(g2.state.result.hiyariCauses[0].combo, 'ボール × ケトル');
  assert.ok(g2.state.log.some(e => e.kind === 'combo_hiyari' && e.text.includes('ボールを持って電気ケトルへ！')));
});

test('every stage recipe references objects present in that stage, merged results exist, weights are consistent', () => {
  for (const stage of STAGES) {
    const ids = new Set(stage.objects.map(o => o.id));
    for (const r of stage.recipes) {
      assert.ok(ids.has(r.a) && ids.has(r.b), `stage ${stage.id} recipe ${r.id}`);
      if (r.type === 'toy') assert.ok(MERGED_TOYS[r.result], `merged ${r.result}`);
      if (r.type === 'store') {
        const a = stage.objects.find(o => o.id === r.a);
        assert.equal(a.kind, 'hazard');
        assert.equal(a.weight, 'light');
      }
      if (r.type === 'fix') {
        const g = stage.objects.find(o => o.id === r.a);
        const h = stage.objects.find(o => o.id === r.b);
        assert.equal(g.kind, 'goods');
        assert.equal(h.kind, 'hazard');
        assert.ok(g.for.includes(h.id));
      }
    }
    for (const o of stage.objects) {
      assert.ok(o.weight === 'light' || o.weight === 'heavy', `${o.id} weight`);
      assert.equal(o.draggable, o.weight === 'light', `${o.id} draggable`);
      if (o.kind === 'container') assert.equal(o.container, true);
    }
  }
  for (const m of Object.values(MERGED_TOYS)) {
    assert.equal(typeof m.targetWeight, 'number');
    assert.equal(m.weight, 'light');
  }
});
