import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, DT, run, obj, baby, ofType, FROZEN, makeCarry, dragTo } from './helpers.js';
import { findCombo, comboTriggers } from '../../src/game/combos.js';
import { STAGES } from '../../src/game/stages.js';

// stage 0 = キッチン（spoon×outlet, ball×kettle）、stage 1 = 双子（kettle 以外の全 combo）
test('findCombo / comboTriggers', () => {
  const c = findCombo(STAGES[0], 'spoon', 'outlet');
  assert.ok(c && c.ignoresFix);
  assert.equal(findCombo(STAGES[0], 'ball', 'stairs'), null);
  assert.ok(findCombo(STAGES[1], 'ball', 'stairs'));
  assert.ok(findCombo(STAGES[1], 'spoon', 'outlet'));
  assert.equal(findCombo(STAGES[1], 'ball', 'kettle'), null);
  assert.equal(comboTriggers(c, 'fixed'), true);
  assert.equal(comboTriggers(findCombo(STAGES[0], 'ball', 'kettle'), 'fixed'), false);
  assert.equal(comboTriggers(findCombo(STAGES[0], 'ball', 'kettle'), 'open'), true);
  assert.equal(comboTriggers(c, 'removed'), false);
});

test('spoon + fixed outlet in the kitchen: combo_warn beforehand, then hiyari + combo_hiyari', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const b = baby(game);
  const outlet = obj(game, 'outlet');
  dragTo(game, 'cover', outlet.x, outlet.y); // コンセントカバーで fixed
  assert.equal(outlet.state, 'fixed');
  makeCarry(game, 'spoon');
  assert.equal(b.carrying, 'spoon');
  // 距離 70 に置く → 予告
  b.x = outlet.x + 70; b.y = outlet.y;
  let fx = run(game, DT);
  const warn = ofType(fx, 'combo_warn');
  assert.equal(warn.length, 1);
  assert.equal(warn[0].objectId, 'outlet');
  assert.deepEqual(warn[0].payload, { babyId: 'baby0', toyId: 'spoon', active: true });
  assert.equal(b.comboWarnHazardId, 'outlet');
  assert.equal(ofType(fx, 'hiyari').length, 0);
  // 離れる → 解除（(300,250) は薬の位置なので避ける）
  b.x = outlet.x + 200; b.y = 200;
  fx = run(game, DT);
  assert.deepEqual(ofType(fx, 'combo_warn')[0].payload, { babyId: 'baby0', toyId: 'spoon', active: false });
  assert.equal(b.comboWarnHazardId, null);
  // 再接近して予告 → 接触 → fixed でもヒヤリ
  b.x = outlet.x + 70; b.y = outlet.y;
  fx = run(game, DT);
  assert.equal(ofType(fx, 'combo_warn')[0].payload.active, true);
  b.x = outlet.x + 20; b.y = outlet.y;
  fx = run(game, DT);
  const hi = ofType(fx, 'hiyari');
  assert.equal(hi.length, 1);
  assert.equal(hi[0].objectId, 'outlet');
  assert.equal(hi[0].payload.babyId, 'baby0');
  assert.equal(hi[0].payload.count, 1);
  assert.deepEqual(hi[0].payload.combo, { toy: 'spoon', hazard: 'outlet', ignoresFix: true, label: 'スプーン × コンセント' });
  const ch = ofType(fx, 'combo_hiyari');
  assert.equal(ch.length, 1);
  assert.deepEqual(ch[0].payload, { babyId: 'baby0', label: 'スプーン × コンセント', ignoresFix: true, toyId: 'spoon' });
  assert.equal(game.state.hiyari, 1);
  assert.equal(game.state.comboHiyari, 1);
  // 赤ちゃんはスポーンに戻り停止、toy は接触地点付近に落ちる
  assert.equal(b.x, 400);
  assert.equal(b.y, 270);
  assert.equal(b.anim, 'stun');
  assert.equal(b.carrying, null);
  const spoon = obj(game, 'spoon');
  assert.equal(spoon.carriedBy, null);
  assert.ok(Math.hypot(spoon.x - (outlet.x + 20), spoon.y - outlet.y) < 20);
  assert.deepEqual(ofType(fx, 'drop')[0].payload, { babyId: 'baby0', reason: 'hiyari' });
  // 予告の解除も同じフレームで出る（active:false）
  const off = ofType(fx, 'combo_warn').filter(e => !e.payload.active);
  assert.equal(off.length, 1);
});

test('ball + fixed kettle (ignoresFix:false) does not trigger; open hazard hiyari carries combo info', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const b = baby(game);
  const kettle = obj(game, 'kettle');
  makeCarry(game, 'ball');
  // open kettle：通常ヒヤリだが combo 情報付き
  b.x = kettle.x; b.y = kettle.y + 20;
  let fx = run(game, DT);
  assert.equal(game.state.hiyari, 1);
  assert.equal(game.state.comboHiyari, 1);
  assert.equal(ofType(fx, 'hiyari')[0].payload.combo.label, 'ボール × ケトル');
  // コード留めで fix、ball を持ち直して接近 → 予告もヒヤリも無し
  dragTo(game, 'tie', kettle.x, kettle.y);
  assert.equal(kettle.state, 'fixed');
  const ball = obj(game, 'ball');
  ball.state = 'available'; ball.boredUntil = null;
  run(game, 1.2); // stun 明け
  makeCarry(game, 'ball');
  assert.equal(b.carrying, 'ball');
  b.x = kettle.x; b.y = kettle.y + 20;
  fx = run(game, DT);
  assert.equal(ofType(fx, 'combo_warn').length, 0);
  assert.equal(ofType(fx, 'hiyari').length, 0);
  assert.equal(game.state.hiyari, 1);
  // ケトルを高い場所へ移した場合（via high）も同じく安全
  const g2 = newGame(1, FROZEN);
  g2.startStage(0);
  dragTo(g2, 'kettle', 330, 30);
  makeCarry(g2, 'ball');
  const b2 = baby(g2);
  b2.x = 330; b2.y = 76;
  fx = run(g2, DT);
  assert.equal(ofType(fx, 'hiyari').length, 0);
});

test('hiyari on open hazard without carrying has combo null; 3 hiyari -> stage_fail', () => {
  const game = newGame(1, FROZEN);
  game.startStage(0);
  const b = baby(game);
  const drawer = obj(game, 'drawer');
  for (let i = 1; i <= 3; i++) {
    b.x = drawer.x; b.y = drawer.y;
    const fx = run(game, DT);
    const hi = ofType(fx, 'hiyari');
    assert.equal(hi.length, 1);
    assert.equal(hi[0].payload.count, i);
    assert.equal(hi[0].payload.combo, null);
    if (i < 3) { run(game, 1.1); assert.equal(game.state.screen, 'play'); }
    else {
      assert.equal(game.state.screen, 'stageResult');
      assert.equal(ofType(fx, 'stage_fail').length, 1);
      assert.ok(Math.abs(ofType(fx, 'stage_fail')[0].payload.failAtSec - game.state.result.failAtSec) < 1e-9);
      assert.equal(game.state.result.cleared, false);
      assert.equal(ofType(fx, 'screen')[0].payload.to, 'stageResult');
    }
  }
  assert.deepEqual(game.update(DT), []);
});
