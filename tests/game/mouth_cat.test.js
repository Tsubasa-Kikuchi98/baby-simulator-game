// 誤飲の猶予・高い場所の容量・ダミー・危険なおもちゃ・猫（CONTRACT §11）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, DT, run, obj, baby, ofType, FROZEN, dragTo } from './helpers.js';
import { TUNING, STAGES } from '../../src/game/stages.js';
import { isWalkable, highPlaceCount, isDraggableOnFloor } from '../../src/game/objects.js';
import { isCandidate } from '../../src/game/baby.js';

const INGEST = { ...FROZEN, MOUTH_INGEST_PROB: 1 };
const RELEASE = { ...FROZEN, MOUTH_INGEST_PROB: 0 };

// 赤ちゃんを battery（キッチン 200,300）の上に置いて 1 フレーム進める → mouth_start
function touchBattery(game) {
  const b = baby(game);
  const bat = obj(game, 'battery');
  b.x = bat.x; b.y = bat.y;
  return run(game, DT);
}

test('touching the battery starts mouthing (no immediate hiyari): carriedBy, anim mouth, no movement, no decay; carried toy is dropped (reason mouth)', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const b = baby(game);
  const bat = obj(game, 'battery');
  // 先に toy を持たせる
  const ball = obj(game, 'ball');
  ball.x = b.x; ball.y = b.y;
  run(game, DT);
  run(game, TUNING.PLAY_SEC + DT * 2);
  assert.equal(b.carrying, 'ball');
  const t0 = game.state.elapsed;
  const fx = touchBattery(game);
  assert.equal(ofType(fx, 'hiyari').length, 0);
  assert.equal(game.state.hiyari, 0);
  const ms = ofType(fx, 'mouth_start');
  assert.equal(ms.length, 1);
  assert.equal(ms[0].objectId, 'battery');
  assert.equal(ms[0].payload.babyId, 'baby0');
  assert.ok(b.mouthing && b.mouthing.objectId === 'battery');
  assert.equal(ms[0].payload.until, b.mouthing.until);
  assert.ok(b.mouthing.until >= t0 + TUNING.MOUTH_SEC_MIN - 0.05 && b.mouthing.until <= t0 + TUNING.MOUTH_SEC_MAX + 0.05, `until ${b.mouthing.until - t0}`);
  assert.equal(b.anim, 'mouth');
  assert.equal(bat.carriedBy, 'baby0');
  assert.equal(bat.state, 'open');
  // 持っていた toy は落ちる
  assert.equal(b.carrying, null);
  assert.equal(ball.carriedBy, null);
  assert.deepEqual(ofType(fx, 'drop')[0].payload, { babyId: 'baby0', reason: 'mouth' });
  // 口に入れている物はドラッグで拾えない・別の候補判定にもならない
  assert.equal(isDraggableOnFloor(bat), false);
  game.input({ type: 'dragStart', targetId: 'battery', x: bat.x, y: bat.y });
  assert.equal(game.state.drag, null);
  // 間は動かない・満足度が減らない
  const s0 = b.satisfaction;
  const x0 = b.x;
  run(game, 1);
  assert.ok(b.mouthing);
  assert.equal(b.anim, 'mouth');
  assert.equal(b.x, x0);
  assert.ok(Math.abs(b.satisfaction - s0) < 1e-9);
  assert.ok(game.state.log.some(e => e.kind === 'mouth_start' && e.text === 'ボタン電池を口に入れそう！' && e.tone === 'bad'));
});

test('MOUTH_INGEST_PROB 1 → hiyari at until (objectId battery, payload.mouth), object stays open at the contact point', () => {
  const game = newGame(1, INGEST);
  game.startStage(0);
  const b = baby(game);
  const bat = obj(game, 'battery');
  touchBattery(game);
  const until = b.mouthing.until;
  const contact = { x: b.x, y: b.y };
  let fx = run(game, until - game.state.elapsed - 0.1);
  assert.equal(ofType(fx, 'hiyari').length, 0);
  fx = run(game, 0.2);
  const hi = ofType(fx, 'hiyari');
  assert.equal(hi.length, 1);
  assert.equal(hi[0].objectId, 'battery');
  assert.equal(hi[0].payload.mouth, true);
  assert.equal(hi[0].payload.combo, null);
  assert.equal(game.state.hiyari, 1);
  assert.equal(b.mouthing, null);
  assert.equal(b.anim, 'stun');
  assert.deepEqual([b.x, b.y], [400, 270]); // spawn
  assert.equal(bat.state, 'open');
  assert.equal(bat.carriedBy, null);
  assert.equal(bat.boredUntil, null);
  assert.ok(Math.abs(bat.x - contact.x) < 1e-9 && Math.abs(bat.y - contact.y) < 1e-9, `battery ${bat.x},${bat.y}`);
  assert.ok(game.state.log.some(e => e.kind === 'hiyari' && e.text === 'ボタン電池を飲み込んだ！（誤飲）'));
  assert.deepEqual(game.state.hiyariEvents[0], { objectId: 'battery', babyId: 'baby0', comboLabel: null });
  assert.equal(ofType(fx, 'mouth_release').length, 0);
});

test('MOUTH_INGEST_PROB 0 → release at until: no hiyari, object at the feet with boredUntil, excluded from candidates and touch until it passes', () => {
  const game = newGame(1, RELEASE);
  game.startStage(0);
  const b = baby(game);
  const bat = obj(game, 'battery');
  touchBattery(game);
  const until = b.mouthing.until;
  let fx = run(game, until - game.state.elapsed + 0.1);
  assert.equal(ofType(fx, 'hiyari').length, 0);
  assert.equal(game.state.hiyari, 0);
  const rel = ofType(fx, 'mouth_release');
  assert.equal(rel.length, 1);
  assert.equal(rel[0].objectId, 'battery');
  assert.equal(rel[0].payload.babyId, 'baby0');
  assert.equal(b.mouthing, null);
  assert.notEqual(b.anim, 'mouth');
  assert.equal(bat.carriedBy, null);
  assert.equal(bat.state, 'open');
  // 手放しは until 到達の最初のフレーム：boredUntil ∈ [until + 3, until + 3 + DT]
  assert.ok(bat.boredUntil >= until + TUNING.TAKEAWAY_BORED_SEC - 1e-9 && bat.boredUntil <= until + TUNING.TAKEAWAY_BORED_SEC + DT + 1e-9, `boredUntil ${bat.boredUntil - until}`);
  assert.ok(isWalkable(bat.x, bat.y, game.state.stage.walls, TUNING.BABY_RADIUS));
  assert.ok(Math.abs(bat.x - b.x) < 1 && Math.abs(bat.y - b.y) < 1, 'at the feet');
  assert.ok(game.state.log.some(e => e.kind === 'mouth_release' && e.text === 'ボタン電池を手放した。危なかった' && e.tone === 'info'));
  // 飽きている間：候補外・触れても何も起きない（赤ちゃんは電池の上に立っている）
  assert.equal(isCandidate(bat, b, game.state), false);
  fx = run(game, TUNING.TAKEAWAY_BORED_SEC - 0.2);
  assert.equal(ofType(fx, 'mouth_start').length + ofType(fx, 'hiyari').length, 0);
  assert.notEqual(b.targetId, 'battery');
  // 明けると boredUntil が消え、候補に戻り、触れればまた口に入れる
  fx = run(game, 0.4);
  assert.equal(bat.boredUntil, null);
  assert.equal(ofType(fx, 'mouth_start').length, 1); // 候補・接触に戻った（赤ちゃんは電池の上に立っている）
  assert.equal(bat.carriedBy, 'baby0');
});

test('take-away hold during mouthing drops the object (bored), applies -20 and fuss; pickup also releases the object', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const b = baby(game);
  const bat = obj(game, 'battery');
  // carrying が無い状態では長押しは無効
  game.input({ type: 'pressStart', targetId: 'baby0' });
  assert.equal(game.state.press, null);
  touchBattery(game);
  game.input({ type: 'pressStart', targetId: 'baby0' });
  assert.deepEqual(game.state.press, { targetId: 'baby0', elapsed: 0, needSec: TUNING.TAKEAWAY_HOLD_SEC });
  const s0 = b.satisfaction;
  const fx = run(game, TUNING.TAKEAWAY_HOLD_SEC + 0.05);
  const tk = ofType(fx, 'takeaway');
  assert.equal(tk.length, 1);
  assert.deepEqual(tk[0].payload, { amount: -20, toyId: 'battery', mouth: true });
  assert.ok(Math.abs(b.satisfaction - (s0 - 20)) < 0.5);
  assert.equal(game.state.interventions, 1);
  assert.equal(b.mouthing, null);
  assert.equal(b.holdProgress, 0);
  assert.equal(game.state.press, null);
  assert.equal(bat.carriedBy, null);
  assert.equal(bat.state, 'open');
  assert.ok(Math.abs(bat.boredUntil - (game.state.elapsed + TUNING.TAKEAWAY_BORED_SEC)) < 0.1, `boredUntil ${bat.boredUntil - game.state.elapsed}`);
  assert.ok(isWalkable(bat.x, bat.y, game.state.stage.walls, TUNING.BABY_RADIUS));
  assert.deepEqual(ofType(fx, 'drop')[0].payload, { babyId: 'baby0', reason: 'takeaway' });
  assert.equal(ofType(fx, 'fuss_start').length, 1);
  assert.equal(b.fussing, true);
  assert.equal(ofType(fx, 'hiyari').length, 0);
  assert.ok(game.state.log.some(e => e.kind === 'takeaway' && e.text === 'ボタン電池を取り上げた（満足度 −20）。ぐずる'));
  assert.ok(!game.state.log.some(e => e.kind === 'drop' && e.t === game.state.elapsed)); // takeaway の drop はログに出さない

  // 抱き上げでも解除される
  run(game, TUNING.TAKEAWAY_BORED_SEC + 0.1);
  bat.boredUntil = null;
  b.fussUntil = 0;
  touchBattery(game);
  assert.ok(b.mouthing);
  game.input({ type: 'dragStart', targetId: 'baby0', x: b.x, y: b.y });
  assert.equal(b.isHeld, true);
  assert.equal(b.mouthing, null);
  assert.equal(bat.carriedBy, null);
  assert.ok(bat.boredUntil > game.state.elapsed);
  game.input({ type: 'dragMove', x: 500, y: 300 });
  assert.notDeepEqual([bat.x, bat.y], [500, 300]); // 物は床に残る
  game.input({ type: 'dragEnd', x: 500, y: 300 });
  assert.equal(game.state.hiyari, 0);
});

test('risky toy: puzzle after play with RISKY_TOY_PROB 1 → mouthing the puzzle (not carrying); hiyari text uses riskLabel; release leaves it bored on the floor', () => {
  const game = newGame(1, { ...INGEST, RISKY_TOY_PROB: 1 });
  game.startStage(0);
  const b = baby(game);
  const puzzle = obj(game, 'puzzle');
  assert.equal(puzzle.ingestible, true);
  assert.equal(puzzle.riskLabel, '小さなピース');
  puzzle.x = b.x; puzzle.y = b.y;
  let fx = run(game, DT);
  assert.equal(ofType(fx, 'play_start')[0].objectId, 'puzzle');
  const s0 = b.satisfaction;
  fx = run(game, TUNING.PLAY_SEC + DT * 2);
  const pd = ofType(fx, 'play_done');
  assert.equal(pd.length, 1);
  assert.equal(pd[0].payload.amount, 25); // 満足度回復は通常通り
  assert.ok(Math.abs(b.satisfaction - (s0 + 25)) < 0.2, `sat ${b.satisfaction - s0}`); // 遊び終えたフレームの減衰ぶんを許容
  assert.equal(b.carrying, null);
  assert.ok(b.mouthing && b.mouthing.objectId === 'puzzle');
  assert.equal(ofType(fx, 'mouth_start')[0].objectId, 'puzzle');
  assert.equal(puzzle.carriedBy, 'baby0');
  assert.equal(puzzle.state, 'bored');
  assert.equal(b.anim, 'mouth');
  assert.ok(game.state.log.some(e => e.kind === 'mouth_start' && e.text === 'ジグソーパズルの小さなピースを口に入れそう！'));
  // 飲み込む（INGEST）
  fx = run(game, TUNING.MOUTH_SEC_MAX + DT);
  const hi = ofType(fx, 'hiyari');
  assert.equal(hi.length, 1);
  assert.equal(hi[0].objectId, 'puzzle');
  const e = game.state.log.find(x => x.kind === 'hiyari');
  assert.ok(e && e.text.includes('小さなピース'), e && e.text);
  assert.equal(e.text, 'ジグソーパズルの小さなピースを飲み込んだ！（誤飲）');
  assert.equal(puzzle.carriedBy, null);
  assert.equal(puzzle.state, 'bored');
  assert.equal(game.state.result, null);
  // hiyariCauses は誤飲として集計される
  run(game, 50);
  const cause = game.state.result.hiyariCauses.find(c => c.objectId === 'puzzle');
  assert.ok(cause && cause.accident === '誤飲' && cause.count >= 1, JSON.stringify(cause));

  // 手放すケース（RELEASE）：toy は bored のまま床へ、boredUntil は遊びの分（長い方）を保つ
  const g2 = newGame(1, { ...RELEASE, RISKY_TOY_PROB: 1 });
  g2.startStage(0);
  const b2 = baby(g2);
  const pz = obj(g2, 'puzzle');
  pz.x = b2.x; pz.y = b2.y;
  run(g2, DT);
  run(g2, TUNING.PLAY_SEC + DT * 2);
  assert.ok(b2.mouthing);
  const boredUntil = pz.boredUntil;
  assert.ok(boredUntil - g2.state.elapsed > 25);
  fx = run(g2, TUNING.MOUTH_SEC_MAX + DT);
  assert.equal(ofType(fx, 'mouth_release')[0].objectId, 'puzzle');
  assert.equal(ofType(fx, 'hiyari').length, 0);
  assert.equal(pz.carriedBy, null);
  assert.equal(pz.state, 'bored');
  assert.equal(pz.boredUntil, boredUntil);
  assert.equal(b2.carrying, null);
  assert.ok(g2.state.log.some(x => x.kind === 'mouth_release' && x.text === 'ジグソーパズルの小さなピースを手放した。危なかった'));

  // RISKY_TOY_PROB 0 なら従来通り持ち歩く
  const g3 = newGame(1, { ...FROZEN, RISKY_TOY_PROB: 0 });
  g3.startStage(0);
  const b3 = baby(g3);
  const p3 = obj(g3, 'puzzle');
  p3.x = b3.x; p3.y = b3.y;
  run(g3, DT);
  run(g3, TUNING.PLAY_SEC + DT * 2);
  assert.equal(b3.carrying, 'puzzle');
  assert.equal(b3.mouthing, null);
});

test('heavy 誤飲 (trash) and non-誤飲 light hazards (kettle) still cause an instant hiyari; combo with a light 誤飲 hazard is an instant combo hiyari', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const b = baby(game);
  const trash = obj(game, 'trash');
  b.x = trash.x; b.y = trash.y + 10;
  let fx = run(game, DT);
  assert.equal(ofType(fx, 'hiyari')[0].objectId, 'trash');
  assert.equal(ofType(fx, 'mouth_start').length, 0);
  run(game, 1.1);
  const kettle = obj(game, 'kettle');
  b.x = kettle.x; b.y = kettle.y + 10;
  fx = run(game, DT);
  assert.equal(ofType(fx, 'hiyari')[0].objectId, 'kettle');
  // 双子：布を持って洗剤へ → combo ヒヤリ（口に入れる猶予なし）
  const g2 = newGame(1, FROZEN);
  g2.startStage(1);
  const c = baby(g2);
  const cloth = obj(g2, 'cloth');
  cloth.x = c.x; cloth.y = c.y;
  run(g2, DT);
  run(g2, TUNING.PLAY_SEC + DT * 2);
  assert.equal(c.carrying, 'cloth');
  const det = obj(g2, 'detergent');
  c.x = det.x + 10; c.y = det.y + 10;
  fx = run(g2, DT);
  assert.equal(ofType(fx, 'combo_hiyari').length, 1);
  assert.equal(ofType(fx, 'hiyari')[0].objectId, 'detergent');
  assert.equal(c.mouthing, null);
});

test('high place capacity: the 3rd object dropped on the counter → high_full, stays on the floor in front; highPlaceCount tracks respawn', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const s = game.state;
  const counter = s.stage.walls.find(w => w.model === 'counter');
  assert.equal(counter.capacity, 2);
  assert.equal(highPlaceCount(s, counter), 0);
  let fx = dragTo(game, 'kettle', 330, 30);
  assert.equal(obj(game, 'kettle').state, 'fixed');
  assert.equal(highPlaceCount(s, counter), 1);
  fx = dragTo(game, 'battery', 200, 30);
  assert.equal(obj(game, 'battery').state, 'removed');
  assert.equal(obj(game, 'battery').storedIn, 'counter');
  assert.equal(highPlaceCount(s, counter), 2);
  // 3 つ目（薬）は置けない
  const med = obj(game, 'medicine');
  fx = dragTo(game, 'medicine', 300, 30);
  const full = ofType(fx, 'high_full');
  assert.equal(full.length, 1);
  assert.deepEqual(full[0], { type: 'high_full', objectId: 'medicine', payload: { into: 'counter', capacity: 2 } });
  assert.equal(ofType(fx, 'fixed').length + ofType(fx, 'stored').length, 0);
  assert.equal(med.state, 'open');
  assert.equal(med.storedIn, null);
  assert.equal(med.x, 300);
  assert.equal(med.y, 76); // カウンター（y<60）の手前の床
  assert.ok(isWalkable(med.x, med.y, s.stage.walls, TUNING.BABY_RADIUS));
  assert.ok(Math.abs(med.draggedAt - (s.elapsed - DT)) < 1e-6);
  assert.equal(highPlaceCount(s, counter), 2);
  assert.ok(s.log.some(e => e.kind === 'high_full' && e.text === 'カウンターはもう置けない（2個まで）' && e.tone === 'info'));
  assert.equal(s.allHazardsFixedAt, null);
  // 電池が respawn すると空きができ、薬を置ける
  run(game, 25.5);
  assert.equal(obj(game, 'battery').state, 'open');
  assert.equal(highPlaceCount(s, counter), 1);
  fx = dragTo(game, 'medicine', 300, 30);
  assert.equal(med.state, 'fixed');
  assert.equal(ofType(fx, 'high_full').length, 0);
  assert.equal(highPlaceCount(s, counter), 2);
  // 双子：shelf と tv_stand は別々に数える。capacity 省略時は TUNING.HIGH_PLACE_CAPACITY
  game.startStage(1);
  const shelf = s.stage.walls.find(w => w.model === 'shelf');
  const tv = s.stage.walls.find(w => w.model === 'tv_stand');
  dragTo(game, 'detergent', 760, 100);
  dragTo(game, 'cushion', 760, 150);
  assert.equal(highPlaceCount(s, shelf), 2);
  assert.equal(highPlaceCount(s, tv), 0);
  fx = dragTo(game, 'battery', 760, 120);
  assert.equal(ofType(fx, 'high_full')[0].payload.into, 'shelf');
  assert.equal(obj(game, 'battery').state, 'open');
  assert.ok(obj(game, 'battery').x < 730, `battery x ${obj(game, 'battery').x}`); // 棚（x>=730）の手前
  fx = dragTo(game, 'battery', 30, 260);
  assert.equal(obj(game, 'battery').state, 'removed');
  assert.equal(highPlaceCount(s, tv), 1);
});

test('props: never a candidate nor a touch, draggable, storable (consumes capacity) and trashable, no recipes', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const s = game.state;
  const b = baby(game);
  const cushion = obj(game, 'cushion');
  const magazine = obj(game, 'magazine');
  assert.equal(cushion.kind, 'prop');
  assert.equal(cushion.state, 'available');
  assert.equal(cushion.draggable, true);
  assert.equal(isCandidate(cushion, b, s), false);
  assert.equal(isCandidate(magazine, b, s), false);
  // 上に立っても何も起きない
  b.x = cushion.x; b.y = cushion.y;
  let fx = run(game, 1);
  assert.equal(ofType(fx, 'hiyari').length + ofType(fx, 'mouth_start').length + ofType(fx, 'play_start').length, 0);
  assert.equal(cushion.playingBy, null);
  // 長押しは無効
  game.input({ type: 'pressStart', targetId: 'cushion' });
  assert.equal(s.press, null);
  // ドラッグで床へ
  fx = dragTo(game, 'cushion', 500, 300);
  assert.deepEqual([cushion.x, cushion.y], [500, 300]);
  assert.equal(cushion.state, 'available');
  assert.equal(ofType(fx, 'recipe_ok').length + ofType(fx, 'recipe_ng').length, 0);
  // hazard に重ねても何も起きない（レシピなし）
  const outlet = obj(game, 'outlet');
  fx = dragTo(game, 'cushion', outlet.x, outlet.y);
  assert.equal(outlet.state, 'open');
  assert.equal(ofType(fx, 'recipe_ok').length + ofType(fx, 'recipe_ng').length + ofType(fx, 'fixed').length, 0);
  // 高い場所 → stored、容量を消費
  const counter = s.stage.walls.find(w => w.model === 'counter');
  fx = dragTo(game, 'cushion', 400, 30);
  assert.equal(cushion.state, 'removed');
  assert.equal(cushion.storedIn, 'counter');
  assert.deepEqual(ofType(fx, 'stored')[0], { type: 'stored', objectId: 'cushion', payload: { kind: 'prop', into: 'counter' } });
  assert.equal(highPlaceCount(s, counter), 1);
  const e = s.log.find(x => x.kind === 'stored');
  assert.equal(e.text, 'クッションをカウンターの上に片付けた');
  assert.equal(e.tone, 'info');
  // 容れ物 → trashed。respawn しない
  const trash = obj(game, 'trash');
  fx = dragTo(game, 'magazine', trash.x, trash.y);
  assert.equal(magazine.state, 'removed');
  assert.deepEqual(ofType(fx, 'trashed')[0].payload, { kind: 'prop', into: 'trash' });
  run(game, 30);
  assert.equal(magazine.state, 'removed');
  assert.equal(cushion.state, 'removed');
  // 赤ちゃんは実プレイでも prop を目標にしない
  for (const seed of [1, 2]) {
    const g = newGame(seed);
    g.startStage(1);
    run(g, 20, () => {
      for (const bb of g.state.babies) {
        assert.notEqual(bb.targetId, 'cushion');
        assert.notEqual(bb.targetId, 'slippers');
      }
    });
  }
});

test('cat: appears at 27 s in twins, takes floor objects (cat_take) and drops them near a baby (cat_drop, outside walls), then leaves; kitchen has no visitor events', () => {
  const def = STAGES[1].visitors.find(v => v.type === 'cat');
  assert.ok(def && def.at === 27);
  let anyDrop = 0;
  for (const seed of [1, 2, 3]) {
    const game = newGame(seed, FROZEN);
    game.startStage(1);
    const s = game.state;
    const cat = s.visitors.find(v => v.id === 'cat');
    assert.equal(cat.type, 'cat');
    assert.equal(cat.carrying, null);
    assert.equal(cat.active, false);
    let fx = run(game, def.at - 0.05);
    assert.equal(ofType(fx, 'visitor_enter').filter(e => e.objectId === 'cat').length, 0);
    assert.equal(ofType(fx, 'cat_take').length, 0);
    const takes = [];
    const drops = [];
    let carriedFollowed = 0;
    let draggableWhileCarried = 0;
    fx = run(game, 45 - def.at + 0.5, (i, f) => {
      for (const e of f) {
        if (e.type === 'cat_take') takes.push({ e, t: s.elapsed });
        if (e.type === 'cat_drop') drops.push({ e, t: s.elapsed, babies: s.babies.map(b => ({ x: b.x, y: b.y })) });
      }
      if (cat.active && cat.carrying != null) {
        const o = s.objects.find(x => x.id === cat.carrying);
        assert.equal(o.carriedBy, 'cat');
        if (Math.hypot(o.x - cat.x, o.y - cat.y) < 20) carriedFollowed++;
        if (isDraggableOnFloor(o)) draggableWhileCarried++;
        // 猫がくわえている物は赤ちゃんの目標にならない
        for (const b of s.babies) assert.notEqual(b.targetId, o.id);
      }
    });
    const enter = ofType(fx, 'visitor_enter').filter(e => e.objectId === 'cat');
    assert.equal(enter.length, 1, `seed ${seed} enter`);
    assert.deepEqual(enter[0].payload, { x: def.entry.x, y: def.entry.y, visitorType: 'cat' });
    assert.ok(takes.length >= 1, `seed ${seed} takes`);
    assert.ok(drops.length >= 1, `seed ${seed} drops`);
    assert.ok(takes.length <= TUNING.CAT_STEALS);
    assert.ok(carriedFollowed > 0);
    assert.equal(draggableWhileCarried, 0);
    anyDrop += drops.length;
    for (const { e } of takes) {
      assert.equal(e.payload.visitorId, 'cat');
      const o = s.objects.find(x => x.id === e.objectId);
      assert.ok(o && o.draggable && o.kind !== 'container', e.objectId);
      assert.ok(s.log.some(l => l.kind === 'cat_take' && l.text === `ねこが${o.label}をくわえた` && l.tone === 'bad'));
    }
    for (const { e } of drops) {
      const { x, y, babyId } = e.payload;
      const o = s.objects.find(v => v.id === e.objectId);
      assert.ok(o);
      const b = s.babies.find(v => v.id === babyId);
      assert.ok(b, `babyId ${babyId}`);
      // FROZEN なので赤ちゃんは動かない：落とした位置は赤ちゃんから ~CAT_DROP_NEAR_BABY px（壁で床スナップされても 120 以内）
      assert.ok(Math.hypot(x - b.x, y - b.y) <= 120, `seed ${seed} drop ${x},${y} baby ${b.x},${b.y}`);
      assert.ok(isWalkable(x, y, s.stage.walls, TUNING.BABY_RADIUS), `seed ${seed} drop in wall ${x},${y}`);
      assert.ok(x > 0 && x < 800 && y > 0 && y < 540);
      assert.ok(s.log.some(l => l.kind === 'cat_drop' && l.text === `ねこが${o.label}を赤ちゃんのそばに置いた`));
    }
    // 落とした後は carriedBy が外れている（猫がまだ持っている最後の 1 つを除く）
    for (const o of s.objects) if (o.carriedBy === 'cat') assert.equal(o.id, cat.carrying);
    assert.ok(cat.dropped.length === drops.length);
    if (cat.done) {
      assert.equal(cat.carrying, null);
      assert.equal(ofType(fx, 'visitor_leave').filter(e => e.objectId === 'cat').length, 1);
      assert.ok(s.log.some(l => l.kind === 'visitor_leave' && l.text === 'ねこは出て行った'));
    }
    assert.equal(s.hiyari, 0); // 赤ちゃんは止まっているので猫が置いただけではヒヤリにならない
  }
  assert.ok(anyDrop >= 3);
  // キッチンには訪問者イベントが無い
  const k = newGame(1);
  k.startStage(0);
  assert.deepEqual(k.state.visitors, []);
  const fx = run(k, 46);
  for (const t of ['visitor_enter', 'visitor_drop', 'visitor_leave', 'cat_take', 'cat_drop']) assert.equal(ofType(fx, t).length, 0, t);
  assert.equal(k.state.screen, 'stageResult');
});

test('cat with moving babies: object it carries is never touched or targeted; drop re-targets babies; determinism', () => {
  const runSeed = (seed) => {
    const game = newGame(seed);
    game.startStage(1);
    const s = game.state;
    const cat = s.visitors.find(v => v.id === 'cat');
    const fx = run(game, 45.2, () => {
      if (s.screen !== 'play') return;
      if (cat.carrying != null) {
        const o = s.objects.find(x => x.id === cat.carrying);
        assert.equal(o.carriedBy, 'cat');
        for (const b of s.babies) {
          assert.notEqual(b.targetId, o.id);
          assert.notEqual(b.carrying, o.id);
          if (b.mouthing) assert.notEqual(b.mouthing.objectId, o.id);
        }
      }
      for (const o of s.objects) {
        if (o.carriedBy === 'cat') assert.equal(o.id, cat.carrying);
      }
    });
    return { fx, state: s };
  };
  let takes = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const r = runSeed(seed);
    takes += ofType(r.fx, 'cat_take').length;
    assert.equal(r.state.screen, 'stageResult');
    // 猫が置いた直後の cat_drop では全赤ちゃんが再選択を要求される（次フレームで targetId が有効なものになる）
    for (const e of ofType(r.fx, 'cat_drop')) assert.ok(isWalkable(e.payload.x, e.payload.y, r.state.stage.walls, TUNING.BABY_RADIUS));
  }
  assert.ok(takes > 0);
  const a = runSeed(4);
  const b = runSeed(4);
  assert.deepStrictEqual(a.state, b.state);
  assert.deepStrictEqual(a.fx, b.fx);
});
