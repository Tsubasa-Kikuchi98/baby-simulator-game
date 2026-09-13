import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapToFloor, isWalkable, createRuntimeObjects } from '../../src/game/objects.js';
import { STAGES, TUNING } from '../../src/game/stages.js';

test('snapToFloor: room clamp, single wall, and overlapping-wall corner all yield walkable points', () => {
  const walls2 = STAGES[0].walls; // キッチン：counter / island / fridge
  assert.deepEqual(snapToFloor(900, 600, [], TUNING), { x: 784, y: 524 });
  assert.deepEqual(snapToFloor(400, 30, walls2, TUNING), { x: 400, y: 76 });
  // counter (y<74) と fridge (x>706, y>66) の重なる隅
  const p = snapToFloor(795, 58, walls2, TUNING);
  assert.ok(isWalkable(p.x, p.y, walls2, TUNING.BABY_RADIUS), JSON.stringify(p));
  assert.deepEqual(p, { x: 704, y: 76 });
  // 全ステージの壁内・外周外の格子点を総当たりで確認
  for (const stage of STAGES) {
    for (let x = -30; x <= 830; x += 17) {
      for (let y = -30; y <= 570; y += 13) {
        const q = snapToFloor(x, y, stage.walls, TUNING);
        assert.ok(isWalkable(q.x, q.y, stage.walls, TUNING.BABY_RADIUS), `stage ${stage.id} ${x},${y} -> ${JSON.stringify(q)}`);
      }
    }
  }
});

test('all stage objects are reachable: a walkable point exists within TOUCH_DIST of each', () => {
  for (const stage of STAGES) {
    for (const o of stage.objects) {
      let ok = false;
      for (let a = 0; a < 360 && !ok; a += 15) {
        for (let d = 0; d <= TUNING.TOUCH_DIST - 2 && !ok; d += 4) {
          const x = o.x + Math.cos(a * Math.PI / 180) * d;
          const y = o.y + Math.sin(a * Math.PI / 180) * d;
          if (isWalkable(x, y, stage.walls, TUNING.BABY_RADIUS)) ok = true;
        }
      }
      assert.ok(ok, `stage ${stage.id} ${o.id} unreachable`);
    }
  }
});

test('createRuntimeObjects deep-copies with runtime fields', () => {
  const objs = createRuntimeObjects(STAGES[0]);
  const ball = objs.find(o => o.id === 'ball');
  assert.equal(ball.state, 'available');
  assert.equal(objs.find(o => o.id === 'outlet').state, 'open');
  assert.equal(objs.find(o => o.id === 'trash').container, true);
  assert.deepEqual(
    [ball.progress, ball.respawnAt, ball.boredUntil, ball.draggedAt, ball.playCount, ball.carriedBy, ball.playingBy, ball.storedIn],
    [0, null, null, null, 0, null, null, null]
  );
  assert.deepEqual([ball.spawnX, ball.spawnY], [ball.x, ball.y]);
  assert.equal(ball.weight, 'light');
  assert.equal(ball.draggable, true);
  const bin = createRuntimeObjects(STAGES[1]).find(o => o.id === 'bin');
  assert.equal(bin.kind, 'container');
  assert.equal(bin.state, 'available');
  assert.equal(bin.draggable, false);
  const defX = STAGES[0].objects.find(o => o.id === 'ball').x;
  ball.x = defX + 1;
  assert.equal(STAGES[0].objects.find(o => o.id === 'ball').x, defX);
});
