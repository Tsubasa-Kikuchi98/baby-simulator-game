// ドラッグ＆ドロップ中心の対策（CONTRACT §9）：重さ・レシピ・容れ物・高い場所・長押し廃止・動きの自然さ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, DT, run, obj, baby, ofType, FROZEN, STEADY, dragTo } from './helpers.js';
import { isCandidate } from '../../src/game/baby.js';
import { STAGES } from '../../src/game/stages.js';

// キッチン（stage 0）：counter (0,0,800,60) が highPlace。outlet/drawer/trash が heavy、kettle/knife が light。trash は container:true

test('heavy objects (outlet, drawer, trash, container) are not draggable; light ones are', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  for (const id of ['outlet', 'drawer', 'trash']) {
    const o = obj(game, id);
    assert.equal(o.weight, 'heavy');
    assert.equal(o.draggable, false);
    const { x, y } = o;
    game.input({ type: 'dragStart', targetId: id, x: 10, y: 10 });
    assert.equal(game.state.drag, null, `${id} must not start a drag`);
    assert.deepEqual([o.x, o.y], [x, y]);
    assert.equal(o.state, 'open');
  }
  for (const id of ['kettle', 'knife', 'battery', 'ball', 'cover']) {
    const o = obj(game, id);
    assert.equal(o.weight, 'light');
    game.input({ type: 'dragStart', targetId: id, x: o.x, y: o.y });
    assert.deepEqual(game.state.drag, { targetId: id, x: o.x, y: o.y });
    game.input({ type: 'dragEnd', x: o.x, y: o.y });
    assert.equal(game.state.drag, null);
  }
  // 双子の容れ物（kind 'container'）も動かない
  game.startStage(1);
  const bin = obj(game, 'bin');
  assert.equal(bin.kind, 'container');
  assert.equal(bin.state, 'available');
  game.input({ type: 'dragStart', targetId: 'bin', x: bin.x, y: bin.y });
  assert.equal(game.state.drag, null);
});

test('a light hazard can be dragged around the floor and stays open (still a hiyari on touch); it is not targeted while in hand', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const kettle = obj(game, 'kettle');
  const b = baby(game);
  game.input({ type: 'dragStart', targetId: 'kettle', x: kettle.x, y: kettle.y });
  assert.equal(isCandidate(kettle, b, game.state), false); // 手の中
  // 手の中のケトルを赤ちゃんの上に持ってきてもヒヤリにならない
  game.input({ type: 'dragMove', x: b.x, y: b.y });
  let fx = run(game, DT);
  assert.equal(ofType(fx, 'hiyari').length, 0);
  fx = dragTo(game, 'kettle', 500, 300);
  assert.equal(kettle.state, 'open');
  assert.deepEqual([kettle.x, kettle.y], [500, 300]);
  assert.equal(ofType(fx, 'fixed').length + ofType(fx, 'trashed').length + ofType(fx, 'stored').length, 0);
  assert.equal(isCandidate(kettle, b, game.state), true);
  // 床に置いたケトルに触れるとヒヤリ
  b.x = 500; b.y = 310;
  fx = run(game, DT);
  assert.equal(ofType(fx, 'hiyari').length, 1);
  assert.equal(ofType(fx, 'hiyari')[0].objectId, 'kettle');
  // 壁の中に落とせば床へスナップ（island 330..510 × 380..450、highPlace ではない）
  dragTo(game, 'kettle', 400, 400);
  assert.equal(kettle.state, 'open');
  assert.equal(kettle.x, 400);
  assert.equal(kettle.y, 380 - 16);
});

test('goods dropped on its heavy hazard fixes it (fixed via goods + recipe_ok)', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const outlet = obj(game, 'outlet');
  const fx = dragTo(game, 'cover', outlet.x + 5, outlet.y - 5);
  assert.equal(outlet.state, 'fixed');
  assert.equal(obj(game, 'cover').state, 'used');
  assert.deepEqual(ofType(fx, 'fixed')[0], { type: 'fixed', objectId: 'outlet', payload: { via: 'goods', goodsId: 'cover' } });
  assert.equal(ofType(fx, 'recipe_ok')[0].payload.type, 'fix');
});

test('store recipe: knife dropped on the drawer becomes fixed, moves onto the drawer, storedIn drawer; drawer stays open', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const knife = obj(game, 'knife');
  const drawer = obj(game, 'drawer');
  const fx = dragTo(game, 'knife', drawer.x + 8, drawer.y - 6);
  assert.equal(knife.state, 'fixed');
  assert.equal(knife.storedIn, 'drawer');
  assert.deepEqual([knife.x, knife.y], [drawer.x, drawer.y]);
  assert.equal(drawer.state, 'open');
  const fixed = ofType(fx, 'fixed');
  assert.equal(fixed.length, 1);
  assert.deepEqual(fixed[0], { type: 'fixed', objectId: 'knife', payload: { via: 'store', into: 'drawer' } });
  const ok = ofType(fx, 'recipe_ok');
  assert.equal(ok.length, 1);
  assert.equal(ok[0].objectId, 'knife');
  assert.equal(ok[0].payload.type, 'store');
  assert.equal(ok[0].payload.recipeId, 'knife_drawer');
  assert.deepEqual([ok[0].payload.a, ok[0].payload.b], ['knife', 'drawer']);
  // 収納した包丁は再ドラッグできず、赤ちゃんの候補にもならない
  game.input({ type: 'dragStart', targetId: 'knife', x: knife.x, y: knife.y });
  assert.equal(game.state.drag, null);
  assert.equal(isCandidate(knife, baby(game), game.state), false);
  // 収納後もチャイルドロックは引き出しに使える（包丁が重なっていても相手を探せる）
  const fx2 = dragTo(game, 'lock', drawer.x, drawer.y);
  assert.equal(drawer.state, 'fixed');
  assert.equal(ofType(fx2, 'fixed')[0].payload.goodsId, 'lock');
  // ログ文言
  const logStore = game.state.log.find(e => e.kind === 'fixed' && e.text.includes('包丁'));
  assert.ok(logStore && logStore.text.includes('引き出し') && logStore.text.includes('収納'), logStore && logStore.text);
});

test('item dropped on the trash is removed (trashed) and respawns later at its original spawn position', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const battery = obj(game, 'battery');
  const trash = obj(game, 'trash');
  const spawn = { x: battery.x, y: battery.y };
  let fx = dragTo(game, 'battery', trash.x - 10, trash.y + 10);
  assert.equal(battery.state, 'removed');
  assert.ok(Math.abs(battery.respawnAt - (game.state.elapsed - DT + 25)) < 0.05, `respawnAt ${battery.respawnAt}`);
  const tr = ofType(fx, 'trashed');
  assert.equal(tr.length, 1);
  assert.deepEqual(tr[0], { type: 'trashed', objectId: 'battery', payload: { kind: 'item', into: 'trash' } });
  assert.equal(ofType(fx, 'removed').length, 0);
  assert.equal(trash.state, 'open'); // ゴミ箱自体は open のまま（ヒヤリ対象）
  const logTrash = game.state.log.find(e => e.kind === 'trashed');
  assert.ok(logTrash && logTrash.text.includes('ボタン電池') && logTrash.text.includes('ゴミ箱') && logTrash.text.includes('捨てた'), logTrash && logTrash.text);
  assert.equal(logTrash.tone, 'good');
  fx = run(game, 24.5);
  assert.equal(battery.state, 'removed');
  assert.equal(ofType(fx, 'respawn').length, 0);
  fx = run(game, 1);
  assert.equal(battery.state, 'open');
  assert.equal(battery.respawnAt, null);
  assert.deepEqual([battery.x, battery.y], [spawn.x, spawn.y]);
  assert.deepEqual(ofType(fx, 'respawn'), [{ type: 'respawn', objectId: 'battery', payload: {} }]);
  // ゴミ箱をロックした後も容れ物として使える
  dragTo(game, 'trashlock', trash.x, trash.y);
  assert.equal(trash.state, 'fixed');
  fx = dragTo(game, 'grocery', trash.x, trash.y);
  assert.equal(obj(game, 'grocery').state, 'removed');
  assert.equal(ofType(fx, 'trashed')[0].payload.into, 'trash');
  // 双子の kind 'container' でも同じ
  game.startStage(1);
  const bin = obj(game, 'bin');
  fx = dragTo(game, 'cloth', bin.x, bin.y);
  assert.equal(obj(game, 'cloth').state, 'removed');
  assert.deepEqual(ofType(fx, 'trashed')[0].payload, { kind: 'toy', into: 'bin' });
  // hazard は容れ物に入らない（洗剤ボトルを bin に落としても床に置かれるだけ）
  fx = dragTo(game, 'detergent', bin.x, bin.y);
  assert.equal(obj(game, 'detergent').state, 'open');
  assert.equal(ofType(fx, 'trashed').length, 0);
});

test('toy / goods dropped on a high place are removed with stored; an item there respawns too', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const ball = obj(game, 'ball');
  let fx = dragTo(game, 'ball', 400, 30); // counter
  assert.equal(ball.state, 'removed');
  const st = ofType(fx, 'stored');
  assert.equal(st.length, 1);
  assert.deepEqual(st[0], { type: 'stored', objectId: 'ball', payload: { kind: 'toy', into: 'counter' } });
  assert.equal(ofType(fx, 'removed').length, 0);
  const logStored = game.state.log.find(e => e.kind === 'stored');
  assert.ok(logStored && logStored.text.includes('ボール') && logStored.text.includes('カウンター') && logStored.text.includes('片付けた'), logStored && logStored.text);
  assert.equal(logStored.tone, 'info');
  const grocery = obj(game, 'grocery');
  fx = dragTo(game, 'grocery', 100, 40);
  assert.equal(grocery.state, 'removed');
  assert.deepEqual(ofType(fx, 'stored')[0].payload, { kind: 'item', into: 'counter' });
  assert.ok(grocery.respawnAt > game.state.elapsed + 19);
  // カウンターは容量 2（§11.2）：3 つ目は置けず、手前の床に落ちる
  fx = dragTo(game, 'cover', 700, 20);
  assert.equal(obj(game, 'cover').state, 'available');
  assert.equal(ofType(fx, 'stored').length, 0);
  assert.deepEqual(ofType(fx, 'high_full')[0], { type: 'high_full', objectId: 'cover', payload: { into: 'counter', capacity: 2 } });
  assert.equal(obj(game, 'cover').y, 76);
  run(game, 20.5);
  assert.equal(grocery.state, 'open');
  assert.deepEqual([grocery.x, grocery.y], [620, 300]);
  assert.equal(grocery.storedIn, null); // respawn で床に戻ると容量を空ける
  // highPlace でない壁（island）に落とした toy は床へスナップされて残る
  const spoon = obj(game, 'spoon');
  fx = dragTo(game, 'spoon', 420, 420);
  assert.equal(spoon.state, 'available');
  assert.equal(ofType(fx, 'stored').length, 0);
  assert.equal(spoon.y, 450 + 16); // 近い辺（下）の外側
});

test('light hazard dropped on a high place becomes fixed via high, keeps the drop point (no floor snap), storedIn wall model', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const kettle = obj(game, 'kettle');
  const fx = dragTo(game, 'kettle', 330, 25);
  assert.equal(kettle.state, 'fixed');
  assert.deepEqual([kettle.x, kettle.y], [330, 25]);
  assert.equal(kettle.storedIn, 'counter');
  const fixed = ofType(fx, 'fixed');
  assert.equal(fixed.length, 1);
  assert.deepEqual(fixed[0], { type: 'fixed', objectId: 'kettle', payload: { via: 'high', into: 'counter' } });
  assert.equal(ofType(fx, 'recipe_ok').length, 0);
  const e = game.state.log.find(x => x.kind === 'fixed');
  assert.ok(e && e.text.includes('電気ケトル') && e.text.includes('カウンター') && e.text.includes('届かない'), e && e.text);
  // 触れてもヒヤリにならない（fixed）
  const b = baby(game);
  b.x = 330; b.y = 76;
  const fx2 = run(game, DT);
  assert.equal(ofType(fx2, 'hiyari').length, 0);
  // 双子：洗剤ボトル → 棚（shelf 730..800 × 60..220）
  game.startStage(1);
  const det = obj(game, 'detergent');
  const fx3 = dragTo(game, 'detergent', 760, 150);
  assert.equal(det.state, 'fixed');
  assert.equal(det.storedIn, 'shelf');
  assert.deepEqual(ofType(fx3, 'fixed')[0].payload, { via: 'high', into: 'shelf' });
  const e2 = game.state.log.find(x => x.kind === 'fixed');
  assert.equal(e2.text, '洗剤ボトルを棚の上へ移した。届かない');
});

test('containers are never a baby target nor a touch; open trash hazard is a hiyari until locked', () => {
  // 双子の bin
  for (const seed of [1, 2, 3]) {
    const game = newGame(seed);
    game.startStage(1);
    const bin = obj(game, 'bin');
    for (const b of game.state.babies) assert.equal(isCandidate(bin, b, game.state), false);
    run(game, 30, () => {
      if (game.state.screen !== 'play') return;
      for (const b of game.state.babies) assert.notEqual(b.targetId, 'bin');
    });
    assert.equal(bin.state, 'available');
  }
  const game = newGame(1, FROZEN);
  game.startStage(1);
  const bin = obj(game, 'bin');
  const b = baby(game);
  b.x = bin.x; b.y = bin.y;
  let fx = run(game, DT);
  assert.equal(ofType(fx, 'hiyari').length, 0);
  // キッチンの trash は hazard：open ならヒヤリ、ロック後は安全
  game.startStage(0);
  const trash = obj(game, 'trash');
  const kb = baby(game);
  kb.x = trash.x; kb.y = trash.y + 10;
  fx = run(game, DT);
  assert.equal(ofType(fx, 'hiyari').length, 1);
  assert.equal(ofType(fx, 'hiyari')[0].objectId, 'trash');
  run(game, 1.1);
  dragTo(game, 'trashlock', trash.x, trash.y);
  assert.equal(trash.state, 'fixed');
  kb.x = trash.x; kb.y = trash.y + 10;
  fx = run(game, DT);
  assert.equal(ofType(fx, 'hiyari').length, 0);
});

test('goods dropped on the wrong hazard: recipe_ng, goods stays at the drop point, hazard stays open', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const outlet = obj(game, 'outlet');
  const lock = obj(game, 'lock'); // for: ['drawer']
  const fx = dragTo(game, 'lock', outlet.x, outlet.y);
  assert.equal(outlet.state, 'open');
  assert.equal(lock.state, 'available');
  assert.deepEqual([lock.x, lock.y], [outlet.x, outlet.y]);
  const ng = ofType(fx, 'recipe_ng');
  assert.equal(ng.length, 1);
  assert.deepEqual(ng[0], { type: 'recipe_ng', objectId: 'outlet', payload: { a: 'lock', b: 'outlet', x: outlet.x, y: outlet.y } });
  assert.equal(ofType(fx, 'fixed').length + ofType(fx, 'recipe_ok').length + ofType(fx, 'trashed').length, 0);
});

test('pressStart on any object does nothing; only the baby take-away hold uses state.press', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  for (const o of game.state.objects) {
    const before = JSON.stringify(o);
    game.input({ type: 'pressStart', targetId: o.id });
    assert.equal(game.state.press, null, `press on ${o.id}`);
    run(game, 0.5);
    assert.equal(o.progress, 0);
    assert.notEqual(o.state, 'fixing');
    assert.equal(JSON.stringify(o), before, `${o.id} changed by press`);
    game.input({ type: 'pressEnd' });
  }
  game.input({ type: 'pressStart', targetId: 'baby0' }); // carrying なし → 無視
  assert.equal(game.state.press, null);
  assert.equal(game.state.objects.every(o => o.state !== 'fixing'), true);
});

test('allHazardsFixedAt is set once every hazard is fixed by any means (goods / high / store)', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const s = game.state;
  const drawer = obj(game, 'drawer');
  const trash = obj(game, 'trash');
  const outlet = obj(game, 'outlet');
  dragTo(game, 'cover', outlet.x, outlet.y);        // goods
  assert.equal(s.allHazardsFixedAt, null);
  dragTo(game, 'kettle', 330, 30);                   // high
  assert.equal(s.allHazardsFixedAt, null);
  dragTo(game, 'knife', drawer.x, drawer.y);         // store
  assert.equal(s.allHazardsFixedAt, null);
  dragTo(game, 'lock', drawer.x, drawer.y);          // goods
  assert.equal(s.allHazardsFixedAt, null);
  dragTo(game, 'trashlock', trash.x, trash.y);       // goods（container 付き hazard）
  assert.equal(s.allHazardsFixedAt, null);
  dragTo(game, 'medicine', 300, 30);                 // high（薬：§10.3）
  assert.ok(s.allHazardsFixedAt != null && s.allHazardsFixedAt > 40 && s.allHazardsFixedAt < 45, `allHazardsFixedAt ${s.allHazardsFixedAt}`);
  assert.ok(s.objects.filter(o => o.kind === 'hazard').every(o => o.state === 'fixed'));
  const at = s.allHazardsFixedAt;
  run(game, 1);
  assert.equal(s.allHazardsFixedAt, at); // 一度だけ
  // 双子：item を捨てても hazard ではないので関係ない。hazard 6 つを goods 5（mat→sofa を含む：§10.1）＋ high 1 で
  game.startStage(1);
  for (const [g, h] of [['cover', 'outlet'], ['gate', 'stairs'], ['guard', 'table'], ['lock', 'drawer'], ['mat', 'sofa']]) {
    const hz = obj(game, h);
    dragTo(game, g, hz.x, hz.y);
    assert.equal(hz.state, 'fixed', h);
    assert.equal(s.allHazardsFixedAt, null);
  }
  dragTo(game, 'detergent', 30, 260); // tv_stand
  assert.ok(s.allHazardsFixedAt > 40);
});

// ---- 動きの自然さ（§9.5） -----------------------------------------------------

test('baby speed wobbles (>20 % spread), pauses at least once while having a target, and still reaches objects', () => {
  let reached = 0;
  for (const seed of [1, 2, 3, 4]) {
    const game = newGame(seed);
    game.startStage(0);
    const b = baby(game);
    let min = Infinity, max = -Infinity, pauses = 0, idleWithTarget = 0;
    const fx = run(game, 30, () => {
      if (game.state.screen !== 'play') return;
      if (b.anim === 'crawl' || b.anim === 'fuss') { min = Math.min(min, b.speed); max = Math.max(max, b.speed); }
      if (b.anim === 'idle' && b.targetId != null) idleWithTarget++;
      if (b.pauseUntil > game.state.elapsed && b.targetId != null) pauses++;
      assert.ok(b.speedK >= 0.55 - 1e-9 && b.speedK <= 1.25 + 1e-9, `speedK ${b.speedK}`);
      assert.ok(b.moodMult >= 1 && b.moodMult <= 1.6 + 1e-9, `moodMult ${b.moodMult}`);
    });
    assert.ok((max - min) / max > 0.2, `seed ${seed}: speed spread ${min.toFixed(1)}..${max.toFixed(1)}`);
    assert.ok(idleWithTarget > 0 && pauses > 0, `seed ${seed}: no pause (idle frames ${idleWithTarget})`);
    if (fx.some(e => e.type === 'hiyari' || e.type === 'play_start')) reached++;
  }
  assert.equal(reached, 4, 'every seed reaches an object within 30 s');
});

test('moodMult is continuous in satisfaction and combined with satLow/fuss by max(); STEADY tuning gives constant speed', () => {
  const game = newGame(1, STEADY);
  game.startStage(0);
  const b = baby(game);
  const v = STEADY.BABY_SPEED;
  run(game, DT);
  assert.ok(Math.abs(b.speed - v) < 1e-9);
  assert.equal(b.speedK, 1);
  // MOOD_SPEED_GAIN 0.6：満足度 70 → ×1.054、20 → ×1.384、0 → ×1.6
  const g2 = newGame(1, { ...STEADY, MOOD_SPEED_GAIN: 0.6 });
  g2.startStage(0);
  const b2 = baby(g2);
  for (const [sat, expect] of [[70, 1.054], [20, 1.384], [0, 1.6]]) {
    b2.satisfaction = sat;
    b2.fussUntil = 0;
    run(g2, DT);
    const low = (100 - sat) / 100; // moodMult はそのフレームの減衰前の満足度で計算される
    const mood = 1 + 0.6 * low * low;
    assert.ok(Math.abs(b2.moodMult - mood) < 1e-3, `moodMult ${b2.moodMult} vs ${mood}`);
    assert.ok(Math.abs(mood - expect) < 0.01, `sat ${sat} mood ${mood}`);
    const mult = Math.max(mood, b2.satLow ? STEADY.BORED_SPEED_MULT : 1);
    assert.ok(Math.abs(b2.speed - v * mult) < 0.5, `sat ${sat} speed ${b2.speed} vs ${v * mult}`);
  }
  // ぐずり（×1.5）は mood（満足度 50 → ×1.15）より大きいので 1.5 が採用される
  b2.satisfaction = 50;
  b2.fussUntil = g2.state.elapsed + 5;
  run(g2, DT);
  assert.ok(Math.abs(b2.speed - v * 1.5) < 0.5, `fuss speed ${b2.speed}`);
});

test('babies in both stages keep moving and do not get stuck (no 8 s window without progress while crawling)', () => {
  for (const idx of [0, 1]) {
    for (const seed of [1, 2, 3]) {
      const game = newGame(seed);
      game.startStage(idx);
      const last = game.state.babies.map(b => ({ x: b.x, y: b.y, t: 0 }));
      run(game, STAGES[idx].timeLimit, () => {
        if (game.state.screen !== 'play') return;
        const t = game.state.elapsed;
        game.state.babies.forEach((b, i) => {
          if (b.anim !== 'crawl' && b.anim !== 'fuss') { last[i] = { x: b.x, y: b.y, t }; return; }
          if (Math.hypot(b.x - last[i].x, b.y - last[i].y) >= 8) last[i] = { x: b.x, y: b.y, t };
          assert.ok(t - last[i].t < 8, `stage ${idx} seed ${seed} ${b.id} stuck at ${b.x.toFixed(0)},${b.y.toFixed(0)} t=${t.toFixed(1)}`);
        });
      });
    }
  }
});
