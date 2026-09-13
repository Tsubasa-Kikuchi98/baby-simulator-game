// ステージ3「夕方のリビング」の 4 つの新機構（CONTRACT §12）
// 面のハザード（zone）／時限ハザード（activeAt）／押して動かす家具と配置コンボ／兄
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, DT, run, obj, baby, ofType, FROZEN, BASE, dragTo, makeCarry } from './helpers.js';
import { TUNING, STAGES } from '../../src/game/stages.js';
import { isCandidate } from '../../src/game/baby.js';
import { activePlacementCombos } from '../../src/game/combos.js';

const S3 = 2; // ステージ3 は index 2

// 兄と猫が動くと配置や物が変わってしまうテストがあるので、必要なところでは訪問者を止める
function stopVisitors(game) {
  for (const v of game.state.visitors) v.done = true;
}

// ---- 面のハザード（§12.1）--------------------------------------------------

test('zone: 矩形の外では滞在が溜まらず、点で接触してもヒヤリにならない', () => {
  const game = newGame(1, FROZEN);
  game.startStage(S3);
  stopVisitors(game);
  const b = baby(game);
  const puddle = obj(game, 'puddle');
  assert.equal(puddle.zone, true);
  assert.deepEqual(puddle.area, { w: 140, h: 100 });
  assert.equal(puddle.weight, 'heavy');
  assert.equal(puddle.draggable, false);

  // 中心にぴったり重ねても「接触」ではヒヤリにならない（zone は findHiyariContact の対象外）
  b.x = puddle.x;
  b.y = puddle.y;
  const fx = run(game, DT);
  assert.equal(ofType(fx, 'hiyari').length, 0);
  assert.equal(game.state.hiyari, 0);

  // 矩形の外へ出すと滞在は 0 に戻る
  b.x = puddle.x;
  b.y = puddle.y - 200;
  run(game, DT);
  assert.equal(b.zoneDwell.puddle || 0, 0);
});

test('zone: dwellSec だけ矩形内にとどまるとヒヤリ（転倒）。zone_enter は入った瞬間に 1 回だけ', () => {
  const game = newGame(1, FROZEN);
  game.startStage(S3);
  stopVisitors(game);
  const b = baby(game);
  const puddle = obj(game, 'puddle');
  b.x = puddle.x;
  b.y = puddle.y;

  const fx1 = run(game, DT);
  const enter = ofType(fx1, 'zone_enter');
  assert.equal(enter.length, 1);
  assert.equal(enter[0].objectId, 'puddle');
  assert.equal(enter[0].payload.babyId, 'baby0');

  // dwellSec の手前ではまだヒヤリにならない
  const fx2 = run(game, puddle.dwellSec - 3 * DT);
  assert.equal(ofType(fx2, 'hiyari').length, 0);
  assert.equal(ofType(fx2, 'zone_enter').length, 0, 'zone_enter は入った瞬間だけ');

  const fx3 = run(game, 5 * DT);
  const h = ofType(fx3, 'hiyari');
  assert.equal(h.length, 1);
  assert.equal(h[0].objectId, 'puddle');
  assert.equal(game.state.hiyari, 1);
  // ヒヤリの後は spawn に戻り、滞在はすべて消える
  assert.deepEqual(b.zoneDwell, {});
  const spawn = STAGES[S3].babySpawns[0];
  assert.equal(b.x, spawn.x);
  assert.equal(b.y, spawn.y);
  // ログは事故名「転倒」の文言
  assert.ok(game.state.log.some(e => e.kind === 'hiyari' && e.text.includes('すべって転び')), JSON.stringify(game.state.log.slice(-3)));
});

test('zone: 対策（タオル）すると滞在しても安全。再発すると危険に戻り、タオルも元の場所へ戻る', () => {
  const game = newGame(1, FROZEN);
  game.startStage(S3);
  stopVisitors(game);
  const b = baby(game);
  const puddle = obj(game, 'puddle');
  const towel = obj(game, 'towel');
  const towelHome = { x: towel.x, y: towel.y };

  dragTo(game, 'towel', puddle.x, puddle.y);
  assert.equal(puddle.state, 'fixed');
  assert.equal(towel.state, 'used');

  // fixed の間はいくら踏んでも安全
  b.x = puddle.x;
  b.y = puddle.y;
  const fx = run(game, puddle.dwellSec * 2);
  assert.equal(ofType(fx, 'hiyari').length, 0);
  assert.equal(b.zoneDwell.puddle || 0, 0);

  // respawnSec で再発し、使ったタオルが定義位置に戻る（CONTRACT §12.1 の「再発時の goods の復帰」）
  b.x = 400;
  b.y = 60; // 矩形の外へ
  const fx2 = run(game, puddle.respawnSec + 0.2);
  const re = ofType(fx2, 'respawn');
  assert.ok(re.some(e => e.objectId === 'puddle'), '水たまりが再発する');
  assert.ok(re.some(e => e.objectId === 'towel'), 'タオルが戻る');
  assert.equal(puddle.state, 'open');
  assert.equal(towel.state, 'available');
  assert.equal(towel.x, towelHome.x);
  assert.equal(towel.y, towelHome.y);
});

// ---- 時限ハザード（§12.2）--------------------------------------------------

test('activeAt: inactive の間は触れてもヒヤリにならず目標にもならない。時刻が来ると activate して危険になる', () => {
  const game = newGame(1, FROZEN);
  game.startStage(S3);
  stopVisitors(game);
  const b = baby(game);
  const cooker = obj(game, 'rice_cooker');
  assert.equal(cooker.state, 'inactive');
  assert.equal(cooker.activeAt, 16);
  assert.equal(isCandidate(cooker, b, game.state), false);

  b.x = cooker.x;
  b.y = cooker.y + 10;
  const fx = run(game, 1);
  assert.equal(ofType(fx, 'hiyari').length, 0, 'inactive の間は触れても何も起きない');

  b.x = 400;
  b.y = 250;
  const fx2 = run(game, cooker.activeAt);
  const act = ofType(fx2, 'activate');
  assert.equal(act.length, 1);
  assert.equal(act[0].objectId, 'rice_cooker');
  assert.equal(cooker.state, 'open');
  assert.equal(isCandidate(cooker, b, game.state), true);

  // open になった後は接触でヒヤリ
  b.x = cooker.x;
  b.y = cooker.y + 10;
  const fx3 = run(game, DT);
  assert.equal(ofType(fx3, 'hiyari').length, 1);
});

test('activeAt: ON になる前でも先回りして対策できる。fixed にしたものは activate しない', () => {
  const game = newGame(1, FROZEN);
  game.startStage(S3);
  stopVisitors(game);
  const cooker = obj(game, 'rice_cooker');
  assert.equal(cooker.state, 'inactive');

  dragTo(game, 'tie', cooker.x, cooker.y);
  assert.equal(cooker.state, 'fixed', 'inactive のうちに対策できる（CONTRACT §12.2）');

  const fx = run(game, cooker.activeAt + 1);
  assert.equal(ofType(fx, 'activate').filter(e => e.objectId === 'rice_cooker').length, 0);
  assert.equal(cooker.state, 'fixed');
});

// ---- 押して動かす家具と配置コンボ（§12.3）------------------------------------

test('placement: 開始時点で椅子×窓・収納ケース×ベランダが成立していて、窓が登れる状態になっている', () => {
  const game = newGame(1, FROZEN);
  game.startStage(S3);
  run(game, DT);
  const active = activePlacementCombos(game.state);
  assert.deepEqual(active.map(a => a.id).sort(), ['chair_window', 'crate_balcony']);
  assert.equal(obj(game, 'window').climbable, true);
  assert.equal(obj(game, 'balcony').climbable, true);
  assert.ok(game.state.log.some(e => e.kind === 'placement_warn' && e.text.includes('踏み台')), JSON.stringify(game.state.log));
});

test('placement: 椅子を押して離すと窓は登れなくなる（暫定対策）', () => {
  const game = newGame(1, FROZEN);
  game.startStage(S3);
  stopVisitors(game);
  run(game, DT);
  const chair = obj(game, 'chair');
  assert.equal(chair.weight, 'push');
  assert.equal(chair.draggable, true);

  const fx = dragTo(game, 'chair', 400, 250);
  const warn = ofType(fx, 'placement_warn').filter(e => e.objectId === 'window');
  assert.equal(warn.length, 1);
  assert.equal(warn[0].payload.active, false);
  assert.equal(obj(game, 'window').climbable, false);
  assert.equal(activePlacementCombos(game.state).some(a => a.id === 'chair_window'), false);
  // 押した家具は床に置かれる（高い場所・容れ物には入らない）
  assert.equal(chair.state, 'open');
});

test('placement: 補助錠で窓を fixed にすると、椅子が近くにあっても成立しない（根本対策）', () => {
  const game = newGame(1, FROZEN);
  game.startStage(S3);
  stopVisitors(game);
  run(game, DT);
  const win = obj(game, 'window');
  dragTo(game, 'window_lock', win.x, win.y);
  assert.equal(win.state, 'fixed');
  run(game, DT);
  assert.equal(win.climbable, false);
  assert.equal(activePlacementCombos(game.state).some(a => a.id === 'chair_window'), false);
});

test('placement: 窓からの転落はヒヤリ 2（severity 2）。1 回で失敗まで王手がかかる', () => {
  const game = newGame(1, { ...FROZEN, CLIMB_FALL_PROB_PER_SEC: 1e9 });
  game.startStage(S3);
  stopVisitors(game);
  const b = baby(game);
  const win = obj(game, 'window');
  assert.equal(win.severity, 2);
  run(game, DT);
  assert.equal(win.climbable, true);

  b.x = win.x;
  b.y = win.y + 20; // TOUCH_DIST 内
  run(game, DT);
  assert.equal(b.climbing, 'window');
  const fx = run(game, DT * 3);
  assert.equal(ofType(fx, 'hiyari').length, 1);
  assert.equal(game.state.hiyari, 2, 'severity 2 なので 1 回で 2 カウント');
  assert.equal(game.state.hiyariEvents[0].severity, 2);
});

test('placement: 押して動かす家具は赤ちゃんの目標にも接触判定にもならない', () => {
  const game = newGame(1, FROZEN);
  game.startStage(S3);
  stopVisitors(game);
  const b = baby(game);
  const chair = obj(game, 'chair');
  assert.equal(isCandidate(chair, b, game.state), false);
  b.x = chair.x;
  b.y = chair.y;
  const fx = run(game, 1);
  assert.equal(ofType(fx, 'hiyari').length, 0);
});

// ---- 兄（§12.4）-------------------------------------------------------------

test('sibling: at 秒に現れて居座り、小物を散らかす（すべて別 id）', () => {
  const game = newGame(3, FROZEN);
  game.startStage(S3);
  const sib = game.state.visitors.find(v => v.type === 'sibling');
  assert.ok(sib);
  assert.equal(sib.active, false);

  run(game, 5);
  assert.equal(sib.active, true);
  const fx = run(game, 40);
  const drops = ofType(fx, 'visitor_drop').filter(e => e.payload.visitorId === 'brother');
  assert.ok(drops.length >= 2, `散らかした数 ${drops.length}`);
  const ids = drops.map(e => e.objectId);
  assert.equal(new Set(ids).size, ids.length, '同じ id を 2 度落とさない');
  for (const id of ids) assert.ok(obj(game, id), `${id} が state.objects にある`);
  assert.equal(sib.done, false, '兄はステージ終了まで居座る');
});

test('sibling: おもちゃを渡すとおとなしくなり、その間そのおもちゃは赤ちゃんが使えない', () => {
  const game = newGame(3, FROZEN);
  game.startStage(S3);
  const sib = game.state.visitors.find(v => v.type === 'sibling');
  run(game, 5);
  assert.equal(sib.active, true);
  const b = baby(game);

  const fx = dragTo(game, 'blocks', sib.x, sib.y);
  const busy = ofType(fx, 'sibling_busy');
  assert.equal(busy.length, 1);
  assert.equal(busy[0].objectId, 'blocks');
  assert.equal(busy[0].payload.visitorId, 'brother');

  const blocks = obj(game, 'blocks');
  assert.equal(blocks.carriedBy, 'brother');
  assert.equal(isCandidate(blocks, b, game.state), false, '兄が持っている間は赤ちゃんの目標にならない');

  // busy の間は散らかさない
  const during = run(game, TUNING.SIBLING_BUSY_SEC - 1);
  assert.equal(ofType(during, 'visitor_drop').filter(e => e.payload.visitorId === 'brother').length, 0);

  // busy 明けにおもちゃが床へ戻る
  const after = run(game, 2);
  const free = ofType(after, 'sibling_free');
  assert.equal(free.length, 1);
  assert.equal(free[0].objectId, 'blocks');
  assert.equal(blocks.carriedBy, null);
  assert.equal(isCandidate(blocks, b, game.state), true);
});

// ---- 全体 -------------------------------------------------------------------

test('ステージ3 は同じシードで 2 回回すと完全に同じ結果になる（決定論）', () => {
  const view = seed => {
    const game = newGame(seed);
    game.startStage(S3);
    const types = [];
    for (let i = 0; i < Math.round(20 / DT); i++) {
      for (const e of game.update(DT)) types.push(`${e.type}:${e.objectId}`);
    }
    const b = baby(game);
    return { types, hiyari: game.state.hiyari, x: b.x.toFixed(6), y: b.y.toFixed(6) };
  };
  assert.deepEqual(view(7), view(7));
});

test('ステージ3 の定義：新機構が仕様どおりの形をしている', () => {
  const stage = STAGES[S3];
  assert.equal(stage.id, 3);
  assert.equal(stage.timeLimit, 60);
  assert.equal(stage.babies, 1);
  assert.equal(stage.eduCardId, 'burn');
  // 配置コンボの mover / target が実在し、mover は push、target は climbableWhen:'placement'
  for (const c of stage.placementCombos) {
    const mover = stage.objects.find(o => o.id === c.mover);
    const target = stage.objects.find(o => o.id === c.target);
    assert.ok(mover && target, c.id);
    assert.equal(mover.weight, 'push');
    assert.equal(target.climbableWhen, 'placement');
    assert.ok(c.dist > 0);
  }
  // zone は area と accident を持ち、対応する goods が存在する
  for (const z of stage.objects.filter(o => o.zone)) {
    assert.ok(z.area && z.area.w > 0 && z.area.h > 0, z.id);
    assert.ok(z.accident, z.id);
    assert.ok(stage.objects.some(o => o.kind === 'goods' && (o.for || []).includes(z.id)), `${z.id} の goods`);
  }
  // 時限ハザードにも対策手段がある
  for (const o of stage.objects.filter(o => o.activeAt != null)) {
    assert.ok(stage.objects.some(g => g.kind === 'goods' && (g.for || []).includes(o.id)), `${o.id} の goods`);
  }
  // 兄が居る
  assert.ok(stage.visitors.some(v => v.type === 'sibling'));
});

test('ステージ1・2 には新機構が一切現れない（既存ステージの挙動を変えない）', () => {
  for (const stage of [STAGES[0], STAGES[1]]) {
    assert.equal(stage.placementCombos, undefined);
    assert.equal(stage.objects.some(o => o.zone), false);
    assert.equal(stage.objects.some(o => o.activeAt != null), false);
    assert.equal(stage.objects.some(o => o.weight === 'push'), false);
    assert.equal(stage.visitors.some(v => v.type === 'sibling'), false);
  }
  // 既定 TUNING（BASE）にステージ3 の定数が入っていること
  assert.equal(typeof BASE.WEIGHT_ZONE, 'number');
  assert.equal(typeof BASE.SIBLING_BUSY_SEC, 'number');
});
