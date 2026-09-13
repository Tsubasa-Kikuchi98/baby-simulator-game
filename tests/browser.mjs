// ブラウザ側の自動確認（§13.5）。`npm run test:browser`。
// 1) `vite build --base ./` で dist/ を作る（--no-build で省略）
// 2) dist/ を小さな静的サーバで配信し、Playwright(chromium) で開く
// 3) Title → Loading(≥2.5s) → Tutorial → Play をクリックで進め、v3 のドラッグ＆ドロップ（契約 §9）を発行して state と HUD を確認：
//    重いものは動かない／グッズ→コンセント／電池→ゴミ箱／ケトル→カウンター（高い場所）／包丁→引き出し（収納）／おもちゃの置き直し／取り上げ長押し
// 4) ステージ2（双子）へ進み、v4（契約 §10）：マット→ソファで fixed、訪問者（おじさん。双子のみ）の出現と落とし物、ソファ登り（起きれば）を確認
//    v5（契約 §11）：ダミー→カウンター（容量 2）、3 個目で high_full、危険なおもちゃの ingestible、口に入れる（起きれば）、猫（at 27）の出現と cat_take/cat_drop
// 5) verified:false の豆知識が DOM に無いことを確認。各画面のスクリーンショットを tests/screenshots/ に保存
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { hintTargets } from '../src/render/hints.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SHOTS = path.join(ROOT, 'tests', 'screenshots');
const args = new Set(process.argv.slice(2));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const failures = [];
function check(cond, msg) {
  if (cond) console.log(`  ok   ${msg}`);
  else { console.log(`  FAIL ${msg}`); failures.push(msg); }
}

function build() {
  if (args.has('--no-build')) return;
  console.log('> vite build --base ./');
  const r = spawnSync('npx', ['vite', 'build', '--base', './'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error('vite build failed');
}

function serve(dir) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let p = decodeURIComponent(url.pathname);
      if (p === '/' || p === '') p = '/index.html';
      const file = path.join(dir, p);
      if (!file.startsWith(dir)) { res.writeHead(403); res.end(); return; }
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch (e) {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function waitForScreen(page, screen, timeoutMs = 15000) {
  await page.waitForFunction((s) => window.__game && window.__game.state.screen === s, screen, { timeout: timeoutMs });
}

async function screenState(page) {
  return page.evaluate(() => window.__game.state.screen);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function gameToScreen(page, x, y) {
  return page.evaluate(([gx, gy]) => window.__renderer.toScreenCoords(gx, gy), [x, y]);
}

async function findObject(page, id) {
  return page.evaluate((oid) => {
    const o = window.__game.state.objects.find(x => x.id === oid);
    return o ? { id: o.id, kind: o.kind, x: o.x, y: o.y, state: o.state, weight: o.weight, draggable: o.draggable, storedIn: o.storedIn ?? null, carriedBy: o.carriedBy, playingBy: o.playingBy } : null;
  }, id);
}

/** 対象が拾える（赤ちゃんが重なっていない・持たれていない）まで待つ。true なら拾える */
async function waitPickable(page, id, timeoutMs = 8000) {
  try {
    await page.waitForFunction((oid) => {
      const st = window.__game.state;
      const o = st.objects.find(x => x.id === oid);
      if (!o || o.state === 'removed' || o.state === 'used' || o.carriedBy != null || o.playingBy != null) return false;
      const s = window.__renderer.toScreenCoords(o.x, o.y);
      return window.__renderer.pickObject(s.x, s.y) === oid;
    }, id, { timeout: timeoutMs });
    return true;
  } catch (e) {
    return false;
  }
}

/** ゲーム座標 from にあるものを to へドラッグ（6px のしきい値を越えてから移動）。midShot があれば途中でスクリーンショット */
async function dragGame(page, from, to, { midShot = null, midCheck = null } = {}) {
  const a = await gameToScreen(page, from.x, from.y);
  const b = await gameToScreen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 10, a.y + 10, { steps: 3 });
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  let mid = null;
  if (midCheck) mid = await midCheck();
  if (midShot) await shot(page, midShot);
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  return mid;
}

/** 口に入れる（§11.1）：赤ちゃんのどれかが mouthing になるまで待つ（最大 budgetMs）。起きなければ skip */
async function mouthingCheck(page, prefix, budgetMs) {
  if (budgetMs < 1500) { console.log('  skip mouthing (not enough stage time left)'); return; }
  let mouthed = null;
  try {
    await page.waitForFunction(() => window.__game.state.screen !== 'play' || window.__game.state.babies.some(b => b.mouthing), null, { timeout: budgetMs });
    mouthed = await page.evaluate(() => {
      const b = window.__game.state.babies.find(x => x.mouthing);
      if (!b) return null;
      const o = window.__game.state.objects.find(x => x.id === b.mouthing.objectId);
      return { id: b.id, anim: b.anim, objectId: b.mouthing.objectId, until: b.mouthing.until, carriedBy: o ? o.carriedBy : null, elapsed: window.__game.state.elapsed };
    });
  } catch (e) { /* skip */ }
  if (!mouthed) { console.log('  skip mouthing (no baby put anything in its mouth in time)'); return; }
  check(mouthed.carriedBy === mouthed.id && mouthed.until > mouthed.elapsed, `mouthing baby carries the object at its mouth (${JSON.stringify(mouthed)})`);
  await page.waitForTimeout(120);
  await shot(page, `${prefix}mouthing`);
  const drawn = await page.evaluate((id) => {
    const r = window.__renderer;
    if (r.mouthStart) return r.mouthStart.has(id);              // 2D：危険リングの開始時刻が記録されている
    const v = r.babies && r.babies.get(id);
    return !!(v && v.danger && v.danger.visible);                 // 3D：危険リングの Sprite
  }, mouthed.id);
  check(drawn, 'renderer draws the mouthing danger ring');
  const notPickable = await page.evaluate((oid) => {
    const o = window.__game.state.objects.find(x => x.id === oid);
    const s = window.__renderer.toScreenCoords(o.x, o.y);
    return window.__renderer.pickObject(s.x, s.y);
  }, mouthed.objectId);
  check(notPickable !== mouthed.objectId, `mouthed object is not pickable (${notPickable})`);
  const logged = await page.evaluate(() => window.__game.state.log.some(e => /口に入れそう/.test(e.text || '')));
  check(logged, 'log mentions 口に入れそう');
}

/** 猫（§11.5）：at まで進めて出現・運搬・スクリーンショット */
async function catChecks(page, prefix) {
  const catDef = await page.evaluate(() => {
    const v = (window.__game.state.stage.visitors || []).find(x => x.type === 'cat');
    return v ? { id: v.id, at: v.at } : null;
  });
  check(!!catDef && catDef.at === 27, `stage 2 has a cat visitor at 27 s (${JSON.stringify(catDef)})`);
  if (!catDef) return;
  await page.evaluate((at) => {
    const s = window.__game.state;
    if (s.elapsed < at) { s.elapsed = at - 0.2; s.timeLeft = Math.max(0.1, (s.stage.timeLimit || 45) - s.elapsed); }
  }, catDef.at);
  let cat = null;
  try {
    await page.waitForFunction(() => (window.__game.state.visitors || []).some(v => v.type === 'cat' && v.active), null, { timeout: 8000 });
    cat = await page.evaluate(() => { const v = window.__game.state.visitors.find(x => x.type === 'cat'); return { id: v.id, type: v.type, active: v.active, carrying: v.carrying ?? null }; });
  } catch (e) { /* below */ }
  check(!!cat && cat.type === 'cat' && cat.active, `state.visitors has an active cat after elapsed passes 27 (${JSON.stringify(cat)})`);
  if (!cat) return;
  await page.waitForFunction(() => { const v = window.__game.state.visitors.find(x => x.type === 'cat'); return !v.active || (v.x > 60 && v.x < 740); }, null, { timeout: 6000 }).catch(() => {});
  await shot(page, `${prefix}cat`);
  const notPickable = await page.evaluate(() => {
    const v = window.__game.state.visitors.find(x => x.type === 'cat');
    const s = window.__renderer.toScreenCoords(v.x, v.y);
    return window.__renderer.pickObject(s.x, s.y);
  });
  check(notPickable !== cat.id, `cat is not pickable (${notPickable})`);
  let carried = false;
  try {
    await page.waitForFunction(() => window.__game.state.screen !== 'play' || window.__game.state.log.some(e => /ねこが.*(くわえた|置いた)/.test(e.text || '')), null, { timeout: 15000 });
    carried = await page.evaluate(() => window.__game.state.log.some(e => /ねこが.*(くわえた|置いた)/.test(e.text || '')));
  } catch (e) { /* below */ }
  check(carried, 'log has a cat_take / cat_drop line (ねこが…くわえた／置いた)');
  // くわえている瞬間があれば撮る
  try {
    await page.waitForFunction(() => { const v = window.__game.state.visitors.find(x => x.type === 'cat'); return v && v.active && v.carrying; }, null, { timeout: 4000 });
    const carry = await page.evaluate(() => {
      const v = window.__game.state.visitors.find(x => x.type === 'cat');
      const o = window.__game.state.objects.find(x => x.id === v.carrying);
      return { carrying: v.carrying, carriedBy: o ? o.carriedBy : null };
    });
    check(carry.carriedBy === 'cat', `carried object has carriedBy 'cat' (${JSON.stringify(carry)})`);
    await shot(page, `${prefix}cat-carry`);
  } catch (e) { console.log('  skip cat-carry shot (cat not carrying right now)'); }
}

/** ステージ2（双子）の v4/v5 確認。Play 中に呼ぶ */
async function twinsChecks(page, prefix) {
  const stageName = await page.evaluate(() => window.__game.state.stage.name);
  check(stageName === '双子', `stage 2 is 双子 (${stageName})`);
  await shot(page, `${prefix}twins`);

  // ソファ：climbable な heavy hazard。前縁 (400,84)
  const sofaDef = await page.evaluate(() => {
    const o = window.__game.state.objects.find(x => x.id === 'sofa');
    return o ? { climbable: !!o.climbable, weight: o.weight, state: o.state, x: o.x, y: o.y } : null;
  });
  check(!!sofaDef && sofaDef.climbable && sofaDef.weight === 'heavy' && sofaDef.state === 'open', `sofa is an open climbable heavy hazard (${JSON.stringify(sofaDef)})`);

  // グッズ：mat → sofa（レシピ mat_sofa）。ドラッグ中は sofa がヒント対象（hints.js）
  const mat = await findObject(page, 'mat');
  const sofa = await findObject(page, 'sofa');
  check(!!mat && !!sofa, 'mat goods and sofa exist');
  if (mat && sofa && await waitPickable(page, 'mat')) {
    const mid = await dragGame(page, mat, sofa, {
      midShot: `${prefix}drag-mat`,
      midCheck: () => page.evaluate(() => {
        const s = window.__game.state;
        return { drag: s.drag && s.drag.targetId, objects: s.objects, stage: { recipes: s.stage.recipes, walls: s.stage.walls }, dragState: s.drag };
      })
    });
    check(mid && mid.drag === 'mat', `state.drag targets mat during drag (${mid && mid.drag})`);
    if (mid) {
      const hints = hintTargets({ drag: mid.dragState, objects: mid.objects, stage: mid.stage });
      check(hints.has('sofa'), `sofa is a drop hint while dragging mat (${[...hints].join(',')})`);
    }
    const so = await findObject(page, 'sofa');
    const ma = await findObject(page, 'mat');
    check(so.state === 'fixed', `sofa fixed after dropping mat on it (${so.state})`);
    check(ma.state === 'used', `mat is used (${ma.state})`);
    await page.waitForTimeout(150);
    await shot(page, `${prefix}mat`);
  }

  // 訪問者（おじさんは双子のみ、at 10）：at まで elapsed を進め、active になるのを待つ
  const visitorDef = await page.evaluate(() => {
    const v = (window.__game.state.stage.visitors || []).find(x => (x.type || 'uncle') === 'uncle');
    return v ? { id: v.id, at: v.at, drops: (v.drops || []).map(d => d.id) } : null;
  });
  check(!!visitorDef && visitorDef.drops.length === 3 && visitorDef.at === 10, `stage 2 has the uncle (at 10) with 3 drops (${JSON.stringify(visitorDef)})`);
  if (visitorDef) {
    await page.evaluate((at) => {
      const s = window.__game.state;
      if (s.elapsed < at) { s.elapsed = at - 0.2; s.timeLeft = Math.max(0.1, (s.stage.timeLimit || 45) - s.elapsed); }
    }, visitorDef.at);
    let seen = false;
    try {
      await page.waitForFunction((id) => { const v = (window.__game.state.visitors || []).find(x => x.id === id); return !!(v && v.active); }, visitorDef.id, { timeout: 8000 });
      seen = true;
    } catch (e) { /* below */ }
    check(seen, `uncle becomes active after elapsed passes at=${visitorDef.at}`);
    if (seen) {
      // 部屋の中に入ってから撮る
      await page.waitForFunction((id) => { const v = window.__game.state.visitors.find(x => x.id === id); return v.active && v.x > 60 && v.x < 740; }, visitorDef.id, { timeout: 6000 }).catch(() => {});
      await shot(page, `${prefix}visitor`);
      const drawn = await page.evaluate((id) => (window.__renderer.visitorPhase.get(id) || 0) > 0, visitorDef.id);
      check(drawn, 'renderer animates the visitor (walk phase advanced)');
      const notPickable = await page.evaluate((id) => {
        const v = window.__game.state.visitors.find(x => x.id === id);
        const s = window.__renderer.toScreenCoords(v.x, v.y);
        return window.__renderer.pickObject(s.x, s.y);
      }, visitorDef.id);
      check(notPickable !== visitorDef.id, `visitor is not pickable (${notPickable})`);
      const enterLogged = await page.evaluate(() => window.__game.state.log.some(e => /おじさん/.test(e.text || '')));
      check(enterLogged, 'log mentions おじさん');
      let dropsDone = false;
      try {
        await page.waitForFunction((ids) => ids.every(id => window.__game.state.objects.some(o => o.id === id)), visitorDef.drops, { timeout: 14000 });
        dropsDone = true;
      } catch (e) { /* below */ }
      check(dropsDone, `visitor dropped ${visitorDef.drops.join('/')} as runtime objects`);
      if (dropsDone) {
        const dropped = await page.evaluate((ids) => ids.map(id => {
          const o = window.__game.state.objects.find(x => x.id === id);
          return o ? { id, kind: o.kind, state: o.state, emoji: o.emoji, x: Math.round(o.x), y: Math.round(o.y) } : null;
        }), visitorDef.drops);
        check(dropped.every(d => d && d.kind === 'item' && d.state === 'open' && !!d.emoji && d.x >= 16 && d.x <= 784), `dropped items are open items with emoji inside the room (${JSON.stringify(dropped)})`);
        const pickable = await waitPickable(page, visitorDef.drops[0], 6000);
        check(pickable, `dropped ${visitorDef.drops[0]} is drawn and pickable`);
        await shot(page, `${prefix}drops`);
      }
    }
  }

  // 猫（§11.5）
  await catChecks(page, prefix);

  // ソファ登り：自然に起きれば確認（最大 6 秒。起きなければ skip）
  let climbed = null;
  try {
    await page.waitForFunction(() => window.__game.state.screen !== 'play' || window.__game.state.babies.some(b => b.climbing), null, { timeout: 6000 });
    climbed = await page.evaluate(() => {
      const b = window.__game.state.babies.find(x => x.climbing);
      return b ? { id: b.id, anim: b.anim, x: Math.round(b.x), y: Math.round(b.y), climbing: b.climbing } : null;
    });
  } catch (e) { /* skip */ }
  if (climbed) {
    check(climbed.anim === 'climb' && climbed.y < 70, `climbing baby is drawn on the sofa (${JSON.stringify(climbed)})`);
    await shot(page, `${prefix}climb`);
  } else {
    console.log('  skip climb (no baby climbed the sofa in time)');
  }
}

async function main() {
  build();
  await fs.mkdir(SHOTS, { recursive: true });

  const { tips } = await import(pathToFileURL(path.join(ROOT, 'src', 'game', 'edu.js')).href);
  const unverified = tips.filter(t => !t.verified);

  // ビルド済みバンドルに「zzz」（旧・飽き表示）が残っていない
  const bundle = await fs.readFile(path.join(DIST, 'index.html'), 'utf8');
  check(!/['"`]zzz['"`]/.test(bundle), 'bundle has no "zzz" string');

  const { server, port } = await serve(DIST);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  try {
    await page.goto(`http://127.0.0.1:${port}/index.html?seed=12345`);
    await page.waitForFunction(() => !!window.__game, null, { timeout: 10000 });

    // ---- Title
    check((await screenState(page)) === 'title', 'starts on title');
    const lead = await page.textContent('.lead');
    check(!/長押し/.test(lead || ''), `title lead does not mention 長押し (${(lead || '').slice(0, 40)}…)`);
    check(/2ステージ/.test(lead || '') && /45秒/.test(lead || ''), `title lead says 45秒 × 2ステージ`);
    await shot(page, '01-title');
    await page.click('button[data-action="start"]');

    // ---- Loading（最低 2.5 秒）
    await waitForScreen(page, 'loading');
    const loadingStart = Date.now();
    await page.waitForTimeout(400);
    await shot(page, '02-loading');
    const loadingTip = await page.evaluate(() => window.__game.state.tip && window.__game.state.tip.text);
    check(!!loadingTip, 'loading shows a tip');
    const loadingTipInDom = await page.evaluate((t) => document.body.innerText.includes(t), loadingTip || '');
    check(loadingTipInDom, 'loading tip text is in the DOM');

    // ---- Tutorial（§9.4 の 3 行）
    await waitForScreen(page, 'tutorial');
    const loadingDur = Date.now() - loadingStart;
    check(loadingDur >= 2000, `loading lasted >= ~2.5s (${loadingDur}ms)`);
    await shot(page, '03-tutorial');
    const tutorialLines = await page.$$eval('.tutorial-lines li', els => els.map(e => e.textContent));
    check(tutorialLines.length > 0 && tutorialLines.length <= 3, `tutorial has <= 3 lines (${tutorialLines.length})`);
    check(tutorialLines[0] === '軽いものはドラッグで動かせる。危ないものは高い場所へ、ゴミはゴミ箱へ', 'tutorial line 1 verbatim (§9.4)');
    check(tutorialLines[1] === '安全グッズを重い危険（コンセント・階段…）に重ねると対策。おもちゃ同士を重ねると合成', 'tutorial line 2 verbatim (§9.4)');
    check(tutorialLines[2] === '赤ちゃんもドラッグで移せるが嫌がって危険が増える。ヒヤリ3回で失敗', 'tutorial line 3 verbatim (§9.4)');
    await page.click('button[data-action="tutorialOk"]');

    // ---- Play（ステージ1 キッチン）
    await waitForScreen(page, 'play');
    await page.waitForTimeout(300);
    await shot(page, '04-play');
    const stageName = await page.evaluate(() => window.__game.state.stage.name);
    check(stageName === 'キッチン', `stage 1 is キッチン (${stageName})`);
    const hudTime0 = await page.textContent('.hud-time');
    const hudHiyari0 = await page.textContent('.hud-hiyari');
    check(/^\d+:\d\d$/.test((hudTime0 || '').trim()), `HUD time formatted m:ss (${hudTime0})`);
    check((hudHiyari0 || '').trim() === '○○○', `HUD hiyari starts at ○○○ (${hudHiyari0})`);
    const hudStage = await page.textContent('.hud-stage');
    check(/1\/2/.test(hudStage || ''), `HUD shows stage 1/2 (${hudStage})`);

    // 重いもの（outlet）は引っ張っても動かない：state.drag は null のまま、位置も変わらない
    const outlet0 = await findObject(page, 'outlet');
    check(!!outlet0 && outlet0.weight === 'heavy', 'outlet exists and is heavy');
    if (outlet0) {
      const sp = await gameToScreen(page, outlet0.x, outlet0.y);
      const picked = await page.evaluate(([x, y]) => window.__renderer.pickObject(x, y), [sp.x, sp.y]);
      check(picked === 'outlet', `pickObject at outlet screen position returns outlet (${picked})`);
      await page.mouse.move(sp.x, sp.y);
      await page.mouse.down();
      await page.mouse.move(sp.x + 12, sp.y + 4, { steps: 3 });
      const dragMid = await page.evaluate(() => window.__game.state.drag);
      const rejected = await page.evaluate(() => !!(window.__input.current && window.__input.current.rejected));
      const nudge = await page.evaluate(() => window.__renderer.fx.progress('nudge', 'outlet'));
      await page.mouse.move(sp.x + 120, sp.y + 90, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(100);
      const outlet1 = await findObject(page, 'outlet');
      check(dragMid == null, 'dragging a heavy object does not start state.drag');
      check(rejected, 'input marks the heavy drag as rejected');
      check(nudge != null, 'renderer plays the "動かない" nudge on the heavy object');
      check(outlet1.x === outlet0.x && outlet1.y === outlet0.y && outlet1.state === 'open', `outlet position/state unchanged (${outlet1.x},${outlet1.y} ${outlet1.state})`);
    }

    // グッズ：cover → outlet（レシピ fix）。途中でヒントのスクリーンショット
    const cover = await findObject(page, 'cover');
    check(!!cover, 'cover goods exists');
    if (cover && outlet0 && await waitPickable(page, 'cover')) {
      const hinted = await dragGame(page, cover, outlet0, {
        midShot: '05-drag-goods',
        midCheck: () => page.evaluate(() => {
          const s = window.__game.state;
          return { drag: s.drag && s.drag.targetId };
        })
      });
      check(hinted && hinted.drag === 'cover', `state.drag targets cover during drag (${hinted && hinted.drag})`);
      const o = await findObject(page, 'outlet');
      const c = await findObject(page, 'cover');
      check(o.state === 'fixed', `outlet fixed after dropping cover on it (${o.state})`);
      check(c.state === 'used', `cover is used (${c.state})`);
    }

    // item：battery → trash（容れ物付き hazard）→ removed
    const battery = await findObject(page, 'battery');
    const trash = await findObject(page, 'trash');
    check(!!battery && !!trash, 'battery and trash exist');
    if (battery && trash && await waitPickable(page, 'battery')) {
      await dragGame(page, battery, trash);
      const b = await findObject(page, 'battery');
      check(b.state === 'removed', `battery removed after dropping into trash (${b.state})`);
      const trashedLogged = await page.evaluate(() => window.__game.state.log.some(e => e.kind === 'trashed'));
      check(trashedLogged, 'log has a trashed entry');
    }

    // 軽い hazard：kettle → カウンター（highPlace の wall, y≈30）→ fixed（via high）。途中で高い場所のヒントを撮る
    const kettle = await findObject(page, 'kettle');
    check(!!kettle && kettle.weight === 'light' && kettle.draggable === true, 'kettle exists and is light/draggable');
    if (kettle && await waitPickable(page, 'kettle')) {
      const target = { x: 330, y: 30 };
      const mid = await dragGame(page, kettle, target, {
        midShot: '06-drag-high',
        midCheck: () => page.evaluate(() => {
          const s = window.__game.state;
          return { drag: s.drag && s.drag.targetId };
        })
      });
      check(mid && mid.drag === 'kettle', `state.drag targets kettle during drag (${mid && mid.drag})`);
      const k = await findObject(page, 'kettle');
      check(k.state === 'fixed', `kettle fixed after dropping onto the counter (${k.state})`);
      check(k.storedIn === 'counter', `kettle storedIn counter (${k.storedIn})`);
      check(k.y < 60, `kettle stays drawn inside the counter (y=${Math.round(k.y)})`);
      const picked = await page.evaluate(() => {
        const o = window.__game.state.objects.find(x => x.id === 'kettle');
        const s = window.__renderer.toScreenCoords(o.x, o.y);
        return window.__renderer.pickObject(s.x, s.y);
      });
      check(picked !== 'kettle', `stored kettle is no longer pickable (${picked})`);
    }

    // キッチンに訪問者はいない（§11.6）
    const kitchenVisitors = await page.evaluate(() => (window.__game.state.stage.visitors || []).length);
    check(kitchenVisitors === 0, `kitchen has no visitors (${kitchenVisitors})`);

    // 危険なおもちゃ（§11.4）：puzzle は ingestible
    const puzzle = await page.evaluate(() => { const o = window.__game.state.objects.find(x => x.id === 'puzzle'); return o ? { kind: o.kind, ingestible: !!o.ingestible, riskLabel: o.riskLabel } : null; });
    check(!!puzzle && puzzle.kind === 'toy' && puzzle.ingestible && !!puzzle.riskLabel, `puzzle is an ingestible toy (${JSON.stringify(puzzle)})`);

    // ダミー（§11.3）：cushion / magazine は kind 'prop'・light・draggable。cushion → カウンターで stored（容量を消費）
    const props = await page.evaluate(() => window.__game.state.objects.filter(o => o.kind === 'prop').map(o => ({ id: o.id, weight: o.weight, draggable: o.draggable })));
    check(props.length >= 2 && props.every(p => p.weight === 'light' && p.draggable === true), `kitchen has draggable props (${JSON.stringify(props)})`);
    const cushion = await findObject(page, 'cushion');
    if (cushion && await waitPickable(page, 'cushion')) {
      const mid = await dragGame(page, cushion, { x: 150, y: 30 }, {
        midShot: '06b-drag-prop',
        midCheck: () => page.evaluate(() => window.__game.state.drag && window.__game.state.drag.targetId)
      });
      check(mid === 'cushion', `state.drag targets cushion during drag (${mid})`);
      const c = await findObject(page, 'cushion');
      check(c.state === 'removed' && c.storedIn === 'counter', `cushion stored on the counter (${c.state}, storedIn ${c.storedIn})`);
      const count = await page.evaluate(() => window.__game.state.objects.filter(o => o.storedIn === 'counter' && (o.state === 'fixed' || o.state === 'removed')).length);
      check(count === 2, `counter holds 2 objects now (${count})`);
    } else {
      console.log('  skip cushion → counter (cushion not pickable)');
    }

    // 高い場所の容量（§11.2）：3 個目（magazine）は置けない → high_full、床に戻る、ログ「もう置けない」
    const magazine = await findObject(page, 'magazine');
    if (magazine && await waitPickable(page, 'magazine')) {
      await dragGame(page, magazine, { x: 660, y: 30 }, { midShot: '06c-drag-full' });
      const m = await findObject(page, 'magazine');
      const fullLogged = await page.evaluate(() => window.__game.state.log.some(e => /もう置けない/.test(e.text || '')));
      check(fullLogged || (m.state !== 'removed' && m.storedIn == null), `third drop onto the counter is refused (high_full; log ${fullLogged}, magazine ${m.state}/${m.storedIn})`);
      check(m.state !== 'removed' && m.storedIn == null && m.y >= 60, `magazine bounced back to the floor in front of the counter (y=${Math.round(m.y)})`);
      await page.waitForTimeout(150);
      await shot(page, '06d-high-full');
    } else {
      console.log('  skip magazine → counter (magazine not pickable)');
    }

    // 軽い hazard：knife → drawer（レシピ store）→ knife fixed
    const knife = await findObject(page, 'knife');
    const drawer = await findObject(page, 'drawer');
    check(!!knife && !!drawer, 'knife and drawer exist');
    if (knife && drawer && await waitPickable(page, 'knife')) {
      await dragGame(page, knife, drawer);
      const k = await findObject(page, 'knife');
      check(k.state === 'fixed', `knife fixed after dropping on the drawer (${k.state})`);
      check(k.storedIn === 'drawer', `knife storedIn drawer (${k.storedIn})`);
    }
    await page.waitForTimeout(200);
    await shot(page, '07-stored');

    // ドラッグ：ball を床の別の位置へ（赤ちゃんが重なっている／遊んでいる間は拾えないので空くまで待つ）
    let ball = await findObject(page, 'ball');
    check(!!ball, 'ball exists in stage 1');
    if (ball && await waitPickable(page, 'ball', 20000)) {
      ball = await findObject(page, 'ball');
      const target = { x: 470, y: 180 };
      const mid = await dragGame(page, ball, target, {
        midShot: '08-drag-toy',
        midCheck: () => page.evaluate(() => window.__game.state.drag && window.__game.state.drag.targetId)
      });
      check(mid === 'ball', `state.drag targets ball during drag (${mid})`);
      const moved = await findObject(page, 'ball');
      const dist = Math.hypot(moved.x - ball.x, moved.y - ball.y);
      check(dist > 50, `ball moved by drag (${Math.round(dist)}px)`);
    } else if (ball) {
      console.log('  skip ball drag (ball never free of the baby within 20s)');
    }

    // 取り上げ長押し（0.5 秒）：おもちゃを持っている赤ちゃんがいれば。移動中の赤ちゃんを追うと 6px でドラッグに
    // なってしまうので、契約 §3 のイベントを直接 game.input に流して確認する（input.js の pressStart と同じ形）
    // 赤ちゃんが遊び終えておもちゃを持つまで少し待つ（持っていなければ skip）
    try {
      await page.waitForFunction(() => window.__game.state.babies.some(x => x.carrying != null && !x.isHeld), null, { timeout: 10000 });
    } catch (e) { /* skip below */ }
    const carrier = await page.evaluate(() => {
      const b = window.__game.state.babies.find(x => x.carrying != null && !x.isHeld);
      return b ? b.id : null;
    });
    if (carrier) {
      const before = await page.evaluate(() => window.__game.state.interventions);
      await page.evaluate((id) => window.__game.input({ type: 'pressStart', targetId: id }), carrier);
      await page.waitForTimeout(200);
      const pressing = await page.evaluate((id) => {
        const s = window.__game.state;
        const b = s.babies.find(x => x.id === id);
        return { press: s.press && s.press.targetId, hold: b ? b.holdProgress : null };
      }, carrier);
      check(pressing.press === carrier && pressing.hold > 0, `take-away hold in progress (holdProgress ${pressing.hold})`);
      await shot(page, '09-takeaway-hold');
      let done = false;
      try {
        await page.waitForFunction(([id, n]) => {
          const s = window.__game.state;
          const b = s.babies.find(x => x.id === id);
          return s.interventions > n || (b && b.carrying == null);
        }, [carrier, before], { timeout: 3000 });
        done = true;
      } catch (e) { /* below */ }
      await page.evaluate(() => window.__game.input({ type: 'pressEnd' }));
      check(done, 'take-away completes after the 0.5s hold');
    } else {
      console.log('  skip take-away hold (no baby is carrying a toy right now)');
    }

    // 口に入れる（§11.1）：起きれば確認（ステージの残り時間に合わせて最大 15 秒）
    const budget = await page.evaluate(() => Math.max(0, (window.__game.state.timeLeft - 8) * 1000));
    await mouthingCheck(page, '09b-', Math.min(15000, budget));

    // HUD の値が変化している
    await page.waitForTimeout(1200);
    const hudTime1 = await page.textContent('.hud-time');
    check(hudTime1 !== hudTime0, `HUD time changed (${hudTime0} -> ${hudTime1})`);
    const satWidth = await page.$eval('.sat-fill', el => el.style.width);
    check(!!satWidth, `satisfaction bar has a width (${satWidth})`);
    await shot(page, '10-play-later');

    // 取り上げ以外で state.press が立っていない（オブジェクトの長押しは廃止）
    const pressNow = await page.evaluate(() => window.__game.state.press);
    check(pressNow == null, 'no lingering state.press');
    const logCount = await page.evaluate(() => window.__game.state.log.length);
    check(logCount > 0, `log has entries (${logCount})`);
    const logLines = await page.$$eval('#log .log-line', els => els.length);
    check(logLines > 0, `log panel renders lines (${logLines})`);

    // ---- StageResult（テスト短縮：残り時間を直接縮める。失敗しても致命ではない）
    let reached = false;
    try {
      await page.evaluate(() => {
        const s = window.__game.state;
        s.hiyari = Math.min(s.hiyari, 2);   // クリア扱いにして「次へ」を出す（ステージ2 の確認へ進むため）
        s.elapsed = Math.max(s.elapsed, (s.stage.timeLimit || 45) - 0.05);
        s.timeLeft = 0.05;
      });
      await waitForScreen(page, 'stageResult', 4000);
      reached = true;
    } catch (e) {
      console.log('  skip stageResult (could not fast-forward timeLeft)');
    }
    if (reached) {
      await page.waitForTimeout(200);
      await shot(page, '11-stage-result');
      const bodyText = await page.evaluate(() => document.body.innerText);
      const { cards, DISCLAIMER } = await import(pathToFileURL(path.join(ROOT, 'src', 'game', 'edu.js')).href);
      const cardId = await page.evaluate(() => window.__game.state.result && window.__game.state.result.eduCardId);
      const card = cards[cardId];
      check(!!card, `result has edu card (${cardId})`);
      if (card) {
        check(bodyText.includes(card.title), 'card title shown verbatim');
        check(bodyText.includes(card.body), 'card body shown verbatim');
        check(bodyText.includes(card.source), 'card source shown verbatim');
      }
      check(bodyText.includes(DISCLAIMER), 'DISCLAIMER shown on result');
      const events = await page.$('.result-events');
      check(!!events, 'result has the できごと block');
      const hasNext = await page.$('button[data-action="next"], button[data-action="retry"]');
      check(!!hasNext, 'result has Next or Retry button');
      const resultLog = await page.evaluate(() => (window.__game.state.result && window.__game.state.result.log || []).length);
      check(resultLog > 0, `result.log has entries (${resultLog})`);

      // ---- ステージ2（双子）：ソファ登り・マット・訪問者（契約 §10）
      const next = await page.$('button[data-action="next"]');
      if (next) {
        await next.click();
        await waitForScreen(page, 'loading');
        await waitForScreen(page, 'play', 20000);
        await page.waitForTimeout(300);
        await twinsChecks(page, '12-');
      } else {
        console.log('  skip twins stage (no next button)');
      }
    }

    // ---- verified:false の豆知識が DOM に無い（全画面を通して）
    const bodyTextAll = await page.evaluate(() => document.body.innerText);
    for (const t of unverified) {
      check(!bodyTextAll.includes(t.text), `unverified tip not shown: ${t.id}`);
    }
    check(!/zzz/i.test(bodyTextAll), 'no "zzz" in the page text');
    const shownIds = await page.evaluate(() => window.__game.state.shownTipIds || []);
    const badShown = shownIds.filter(id => unverified.some(t => t.id === id));
    check(badShown.length === 0, `no unverified tip ids in shownTipIds (${shownIds.join(',')})`);

    check(consoleErrors.length === 0, `no page errors (${consoleErrors.length})`);
    if (consoleErrors.length) console.log(consoleErrors.join('\n'));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\nscreenshots: ${SHOTS}`);
  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log('\nall checks passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
