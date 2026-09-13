// フェーズ2（Three.js）のブラウザ側自動確認。`npm run test:browser3d`。
// 1) GAME_MODE=3d で `vite build --base ./ --outDir dist-3d`（--no-build で省略）
// 2) dist-3d/ を静的配信し、Playwright(chromium, SwiftShader で WebGL) で開く
// 3) Title → Loading → Tutorial → Play を進め、v3 のドラッグ＆ドロップ（契約 §9）を発行して HUD と state と 3D 表現を確認：
//    重いもの（台座＋鍵、動かない）／グッズ→コンセント／電池→ゴミ箱／ケトル→カウンター（高い場所）／包丁→引き出し／おもちゃ／取り上げ
// 4) __renderer が ThreeRenderer であること、頂点数ログ、ミュートトグルの動作を確認。スクリーンショットは tests/screenshots/3d-*.png
// 5) ステージ2（双子）へ進み、v4（契約 §10）：マット→ソファ（マットの板・emissive ヒント）、訪問者（VisitorView。双子のみ）と落とし物（遅延生成の ObjectView）、ソファ登り（起きれば）
// 6) v5（契約 §11）：ダミー（平たいベージュの板）→カウンター、3 個目で high_full、壁ラベルの n/2、危険なおもちゃの「！」Sprite、口に入れる危険リング（起きれば）、猫（CatView）
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist-3d');
const SHOTS = path.join(ROOT, 'tests', 'screenshots');
const args = new Set(process.argv.slice(2));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg'
};

const failures = [];
function check(cond, msg) {
  if (cond) console.log(`  ok   ${msg}`);
  else { console.log(`  FAIL ${msg}`); failures.push(msg); }
}

function build() {
  if (args.has('--no-build')) return;
  console.log('> GAME_MODE=3d vite build --base ./ --outDir dist-3d');
  const r = spawnSync('npx', ['vite', 'build', '--base', './', '--outDir', 'dist-3d'], {
    cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32',
    env: { ...process.env, GAME_MODE: '3d' }
  });
  if (r.status !== 0) throw new Error('vite build (3d) failed');
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

async function waitForScreen(page, screen, timeoutMs = 20000) {
  await page.waitForFunction((s) => window.__game && window.__game.state.screen === s, screen, { timeout: timeoutMs });
}

async function screenState(page) {
  return page.evaluate(() => window.__game.state.screen);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `3d-${name}.png`) });
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

/** 対象が拾える（raycast が当たる・赤ちゃんが重なっていない・弧の落下が終わっている）まで待つ */
async function waitPickable(page, id, timeoutMs = 10000) {
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

/** ゲーム座標 from にあるものを to へドラッグ（6px のしきい値を越えてから移動） */
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
  await page.waitForTimeout(200);
  return mid;
}

/** 口に入れる（§11.1）：起きれば BabyView の危険リング Sprite を確認 */
async function mouthingCheck(page, prefix, budgetMs) {
  if (budgetMs < 1500) { console.log('  skip mouthing (not enough stage time left)'); return; }
  let mouthed = null;
  try {
    await page.waitForFunction(() => window.__game.state.screen !== 'play' || window.__game.state.babies.some(b => b.mouthing), null, { timeout: budgetMs });
    mouthed = await page.evaluate(() => { const b = window.__game.state.babies.find(x => x.mouthing); return b ? { id: b.id, objectId: b.mouthing.objectId } : null; });
  } catch (e) { /* skip */ }
  if (!mouthed) { console.log('  skip mouthing (no baby put anything in its mouth in time)'); return; }
  await page.waitForTimeout(120);
  await shot(page, `${prefix}mouthing`);
  const look = await page.evaluate(([bid, oid]) => {
    const r = window.__renderer;
    const bv = r.babies.get(bid);
    const ov = r.objects.get(oid);
    return { ring: !!(bv && bv.danger && bv.danger.visible), objScale: ov ? ov.body.scale.x : null, objY: ov ? ov.body.position.y : null };
  }, [mouthed.id, mouthed.objectId]);
  check(look.ring, `danger ring sprite shown above the mouthing baby (${JSON.stringify(look)})`);
  check(look.objScale != null && look.objScale < 0.7 && look.objY > 5, `mouthed object is drawn small at the mouth (${JSON.stringify(look)})`);
}

/** 猫（§11.5）：CatView が出て、くわえた物が口元に追従する */
async function catChecks(page, prefix) {
  const catDef = await page.evaluate(() => { const v = (window.__game.state.stage.visitors || []).find(x => x.type === 'cat'); return v ? { id: v.id, at: v.at } : null; });
  check(!!catDef && catDef.at === 27, `stage 2 has a cat visitor at 27 s (${JSON.stringify(catDef)})`);
  if (!catDef) return;
  await page.evaluate((at) => {
    const s = window.__game.state;
    if (s.elapsed < at) { s.elapsed = at - 0.2; s.timeLeft = Math.max(0.1, (s.stage.timeLimit || 45) - s.elapsed); }
  }, catDef.at);
  let cat = null;
  try {
    await page.waitForFunction(() => (window.__game.state.visitors || []).some(v => v.type === 'cat' && v.active), null, { timeout: 8000 });
    cat = await page.evaluate(() => { const v = window.__game.state.visitors.find(x => x.type === 'cat'); return { id: v.id, type: v.type, active: v.active }; });
  } catch (e) { /* below */ }
  check(!!cat && cat.type === 'cat' && cat.active, `state.visitors has an active cat after elapsed passes 27 (${JSON.stringify(cat)})`);
  if (!cat) return;
  await page.waitForFunction(() => { const v = window.__game.state.visitors.find(x => x.type === 'cat'); return !v.active || (v.x > 60 && v.x < 740); }, null, { timeout: 6000 }).catch(() => {});
  await shot(page, `${prefix}cat`);
  const view = await page.evaluate((id) => { const v = window.__renderer.visitors.get(id); return v ? { type: v.type, visible: v.group.visible, phase: v.phase, legs: v.legs ? v.legs.length : 0 } : null; }, cat.id);
  check(!!view && view.type === 'cat' && view.visible && view.legs === 4 && view.phase > 0, `CatView exists, is a running four-legged figure (${JSON.stringify(view)})`);
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
  try {
    await page.waitForFunction(() => { const v = window.__game.state.visitors.find(x => x.type === 'cat'); return v && v.active && v.carrying; }, null, { timeout: 4000 });
    const carry = await page.evaluate(() => {
      const st = window.__game.state;
      const v = st.visitors.find(x => x.type === 'cat');
      const ov = window.__renderer.objects.get(v.carrying);
      const d = ov ? Math.hypot(ov.group.position.x - v.x, ov.group.position.z - v.y) : null;
      return { carrying: v.carrying, dist: d, scale: ov ? ov.body.scale.x : null };
    });
    check(carry.dist != null && carry.dist < 30 && carry.scale < 0.7, `carried object follows the cat's mouth, small (${JSON.stringify(carry)})`);
    await shot(page, `${prefix}cat-carry`);
  } catch (e) { console.log('  skip cat-carry shot (cat not carrying right now)'); }
}

/** ステージ2（双子）の v4/v5 確認（3D 表現込み）。Play 中に呼ぶ */
async function twinsChecks(page, prefix) {
  const stageName = await page.evaluate(() => window.__game.state.stage.name);
  check(stageName === '双子', `stage 2 is 双子 (${stageName})`);

  // ソファの object はクッション（台座・鍵なし）、マットの板は未表示
  const sofaLook = await page.evaluate(() => {
    const r = window.__renderer;
    const v = r.objects.get('sofa');
    const o = window.__game.state.objects.find(x => x.id === 'sofa');
    return v && o ? { climbable: v.isClimbable, plate: !!v.plate, lock: !!v.lock, state: o.state, mat: r.mats.has('sofa') ? r.mats.get('sofa').visible : null } : null;
  });
  check(!!sofaLook && sofaLook.climbable && !sofaLook.plate && !sofaLook.lock && sofaLook.state === 'open' && sofaLook.mat === false,
    `sofa view is a cushion without heavy cues and the mat is hidden while open (${JSON.stringify(sofaLook)})`);

  // mat → sofa：ドラッグ中は sofa（クッション）が emissive で光り、落とすと fixed・マットの板が出る
  const mat = await findObject(page, 'mat');
  const sofa = await findObject(page, 'sofa');
  if (mat && sofa && await waitPickable(page, 'mat')) {
    const mid = await dragGame(page, mat, sofa, {
      midShot: `${prefix}drag-mat`,
      midCheck: () => page.evaluate(() => {
        const s = window.__game.state;
        const v = window.__renderer.objects.get('sofa');
        return { drag: s.drag && s.drag.targetId, glow: v ? v.sideMat.emissiveIntensity : 0 };
      })
    });
    check(mid && mid.drag === 'mat', `state.drag targets mat during drag (${mid && mid.drag})`);
    check(mid && mid.glow > 0, `sofa glows as the drop hint while dragging mat (${mid && mid.glow.toFixed(2)})`);
    const so = await findObject(page, 'sofa');
    const ma = await findObject(page, 'mat');
    check(so.state === 'fixed' && ma.state === 'used', `sofa fixed by mat (${so.state}, mat ${ma.state})`);
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => {
      const r = window.__renderer;
      const v = r.objects.get('sofa');
      const m = r.mats.get('sofa');
      return { mat: !!(m && m.visible), cushion: v ? v.body.visible : null, check: v ? v.check.visible : null };
    });
    check(after.mat && after.cushion === false && after.check, `mat plate shown, cushion hidden, check shown after fix (${JSON.stringify(after)})`);
    await shot(page, `${prefix}mat`);
  } else {
    console.log('  skip mat → sofa (mat not pickable)');
  }

  // 訪問者（おじさんは双子のみ、at 10）：at まで elapsed を進め、VisitorView が出るのを待つ
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
      await page.waitForFunction((id) => { const v = window.__game.state.visitors.find(x => x.id === id); return v.active && v.x > 60 && v.x < 740; }, visitorDef.id, { timeout: 6000 }).catch(() => {});
      await shot(page, `${prefix}visitor`);
      const view = await page.evaluate((id) => {
        const v = window.__renderer.visitors.get(id);
        return v ? { visible: v.group.visible, y: v.group.position.y, phase: v.phase } : null;
      }, visitorDef.id);
      check(!!view && view.visible && view.phase > 0, `VisitorView exists, visible and walking (${JSON.stringify(view)})`);
      const notPickable = await page.evaluate((id) => {
        const v = window.__game.state.visitors.find(x => x.id === id);
        const s = window.__renderer.toScreenCoords(v.x, v.y);
        return window.__renderer.pickObject(s.x, s.y);
      }, visitorDef.id);
      check(notPickable !== visitorDef.id, `visitor is not pickable (${notPickable})`);
      let dropsDone = false;
      try {
        await page.waitForFunction((ids) => ids.every(id => window.__game.state.objects.some(o => o.id === id)), visitorDef.drops, { timeout: 14000 });
        dropsDone = true;
      } catch (e) { /* below */ }
      check(dropsDone, `visitor dropped ${visitorDef.drops.join('/')} as runtime objects`);
      if (dropsDone) {
        await page.waitForTimeout(100);
        const views = await page.evaluate((ids) => ids.map(id => { const v = window.__renderer.objects.get(id); return v ? { id, visible: v.group.visible, kind: v.kind } : null; }), visitorDef.drops);
        check(views.every(v => v && v.visible && v.kind === 'item'), `ObjectViews created lazily for the dropped items (${JSON.stringify(views)})`);
        const pickable = await waitPickable(page, visitorDef.drops[0], 6000);
        check(pickable, `dropped ${visitorDef.drops[0]} is pickable by raycast`);
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
      if (!b) return null;
      const v = window.__renderer.babies.get(b.id);
      return { id: b.id, anim: b.anim, y: Math.round(b.y), h: v ? v.group.position.y : null };
    });
  } catch (e) { /* skip */ }
  if (climbed) {
    check(climbed.anim === 'climb' && climbed.h >= 50, `climbing baby sits on the wall top (${JSON.stringify(climbed)})`);
    await shot(page, `${prefix}climb`);
  } else {
    console.log('  skip climb (no baby climbed the sofa in time)');
  }
}

async function main() {
  build();
  await fs.mkdir(SHOTS, { recursive: true });

  // ビルド済みバンドルに「zzz」（旧・飽き表示）が残っていない
  const files = await fs.readdir(path.join(DIST, 'assets')).catch(() => []);
  let zzz = false;
  for (const f of files) {
    if (!f.endsWith('.js')) continue;
    const src = await fs.readFile(path.join(DIST, 'assets', f), 'utf8');
    if (/['"`]zzz['"`]/.test(src)) zzz = true;
  }
  check(!zzz, 'bundle has no "zzz" string');

  const { server, port } = await serve(DIST);
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  const infoLogs = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error') {
      // 素材が無いことによる 404 は想定内（glb / 音声のフォールバック）
      if (/Failed to load resource|404/.test(text)) return;
      pageErrors.push(text);
    }
    if (m.type() === 'info' || m.type() === 'log') infoLogs.push(text);
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/index.html?seed=12345`);
    await page.waitForFunction(() => !!window.__game && !!window.__renderer, null, { timeout: 15000 });

    // ---- 描画層が Three.js であること
    const isThree = await page.evaluate(() => window.__renderer.isThreeRenderer === true);
    check(isThree, 'window.__renderer is the ThreeRenderer');
    const hasWebgl = await page.evaluate(() => {
      const c = document.querySelector('#game canvas');
      if (!c) return false;
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    });
    check(hasWebgl, 'game canvas has a WebGL context');
    const mode = await page.evaluate(() => window.__mode);
    check(mode === '3d', `mode is 3d (${mode})`);

    // ---- Title（ミュートトグルあり）
    check((await screenState(page)) === 'title', 'starts on title');
    await page.waitForTimeout(300);
    await shot(page, '01-title');
    const lead = await page.textContent('.lead');
    check(!/長押し/.test(lead || ''), 'title lead does not mention 長押し');
    const titleMute = await page.$('.overlay-title .mute-btn');
    check(!!titleMute, 'title has a mute toggle');
    if (titleMute) {
      const before = await page.evaluate(() => window.__audio.isMuted());
      await titleMute.click();
      const after = await page.evaluate(() => window.__audio.isMuted());
      check(before !== after, `mute toggle flips audio.isMuted (${before} -> ${after})`);
      const icon = await titleMute.textContent();
      check(icon.trim() === (after ? '🔇' : '🔈'), `mute icon reflects state (${icon})`);
      const stored = await page.evaluate(() => localStorage.getItem('babysafe.muted'));
      check(stored === (after ? '1' : '0'), `mute state persisted to localStorage (${stored})`);
      await titleMute.click(); // 元に戻す
    }
    const ctxCreatedOnClick = await page.evaluate(() => !!window.__audio.ctx);
    check(ctxCreatedOnClick, 'AudioContext created after the first click');

    await page.click('button[data-action="start"]');

    // ---- Loading
    await waitForScreen(page, 'loading');
    const loadingStart = Date.now();
    await page.waitForTimeout(400);
    await shot(page, '02-loading');

    // ---- Tutorial
    await waitForScreen(page, 'tutorial');
    const loadingDur = Date.now() - loadingStart;
    check(loadingDur >= 2000, `loading lasted >= ~2.5s (${loadingDur}ms)`);
    const vertexLog = infoLogs.find(t => t.includes('[three] vertices:'));
    check(!!vertexLog, `vertex count logged after loadStage (${vertexLog || 'none'})`);
    if (vertexLog) {
      const n = Number((vertexLog.match(/vertices:\s*(\d+)/) || [])[1]);
      check(Number.isFinite(n) && n > 0 && n <= 100000, `vertex count within budget (${n})`);
    }
    const tutorialLines = await page.$$eval('.tutorial-lines li', els => els.map(e => e.textContent));
    check(tutorialLines.length === 3 && tutorialLines[0].startsWith('軽いものはドラッグで動かせる'), 'tutorial shows the 3 v3 lines');
    await page.click('button[data-action="tutorialOk"]');

    // ---- Play（ステージ1 キッチン）
    await waitForScreen(page, 'play');
    await page.waitForTimeout(400);
    await shot(page, '04-play');
    const stageName = await page.evaluate(() => window.__game.state.stage.name);
    check(stageName === 'キッチン', `stage 1 is キッチン (${stageName})`);
    const hudTime0 = await page.textContent('.hud-time');
    const hudHiyari0 = await page.textContent('.hud-hiyari');
    check(/^\d+:\d\d$/.test((hudTime0 || '').trim()), `HUD time formatted m:ss (${hudTime0})`);
    check((hudHiyari0 || '').trim() === '○○○', `HUD hiyari starts at ○○○ (${hudHiyari0})`);
    const hudMute = await page.$('.hud .mute-btn');
    check(!!hudMute, 'HUD has a mute toggle');

    // 座標往復：toScreenCoords → toGameCoords がほぼ元に戻る
    const roundTrip = await page.evaluate(() => {
      const r = window.__renderer;
      const pts = [[100, 100], [400, 270], [700, 500]];
      return pts.map(([x, y]) => { const s = r.toScreenCoords(x, y); const g = r.toGameCoords(s.x, s.y); return Math.hypot(g.x - x, g.y - y); });
    });
    check(roundTrip.every(d => d < 1.5), `toScreenCoords/toGameCoords round-trip error < 1.5 (${roundTrip.map(d => d.toFixed(2)).join(', ')})`);

    // 容れ物・高い場所・重い家具の 3D 表現が組まれている
    const views = await page.evaluate(() => {
      const r = window.__renderer;
      const outlet = r.objects.get('outlet');
      const trash = r.objects.get('trash');
      const kettle = r.objects.get('kettle');
      return {
        outletHeavy: !!(outlet && outlet.isHeavy && outlet.plate && outlet.plate.visible && outlet.lock && outlet.lock.visible),
        trashLid: !!(trash && trash.lid),
        kettleLight: !!(kettle && !kettle.isHeavy && !kettle.plate),
        hintPlanes: r.walls.filter(w => w.hint).map(w => w.def.model)
      };
    });
    check(views.outletHeavy, 'heavy outlet has a base plate and a lock sprite');
    check(views.trashLid, 'trash (container hazard) has a lid');
    check(views.kettleLight, 'light kettle has no heavy cue');
    check(views.hintPlanes.includes('counter'), `highPlace walls have hint planes (${views.hintPlanes.join(',')})`);

    // 重いもの（outlet）は引っ張っても動かない
    const outlet0 = await findObject(page, 'outlet');
    check(!!outlet0 && outlet0.weight === 'heavy', 'outlet exists and is heavy');
    if (outlet0) {
      const sp = await gameToScreen(page, outlet0.x, outlet0.y);
      const picked = await page.evaluate(([x, y]) => window.__renderer.pickObject(x, y), [sp.x, sp.y]);
      check(picked === 'outlet', `pickObject (raycast) at outlet screen position returns outlet (${picked})`);
      await page.mouse.move(sp.x, sp.y);
      await page.mouse.down();
      await page.mouse.move(sp.x + 12, sp.y + 4, { steps: 3 });
      const dragMid = await page.evaluate(() => window.__game.state.drag);
      const rejected = await page.evaluate(() => !!(window.__input.current && window.__input.current.rejected));
      await page.mouse.move(sp.x + 120, sp.y + 90, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      const outlet1 = await findObject(page, 'outlet');
      check(dragMid == null, 'dragging a heavy object does not start state.drag');
      check(rejected, 'input marks the heavy drag as rejected (nudge)');
      check(outlet1.x === outlet0.x && outlet1.y === outlet0.y && outlet1.state === 'open', `outlet position/state unchanged (${outlet1.state})`);
    }

    // グッズ：cover → outlet（レシピ fix）。途中でヒント（emissive）を確認
    const cover = await findObject(page, 'cover');
    if (cover && outlet0 && await waitPickable(page, 'cover')) {
      const mid = await dragGame(page, cover, outlet0, {
        midShot: '05-drag-goods',
        midCheck: () => page.evaluate(() => {
          const s = window.__game.state;
          const v = window.__renderer.objects.get('outlet');
          return { drag: s.drag && s.drag.targetId, glow: v ? v.sideMat.emissiveIntensity : 0 };
        })
      });
      check(mid && mid.drag === 'cover', `state.drag targets cover during drag (${mid && mid.drag})`);
      check(mid && mid.glow > 0, `outlet glows as the drop hint while dragging cover (${mid && mid.glow.toFixed(2)})`);
      const o = await findObject(page, 'outlet');
      const c = await findObject(page, 'cover');
      check(o.state === 'fixed' && c.state === 'used', `outlet fixed by cover (${o.state}, cover ${c.state})`);
      await page.waitForTimeout(150);
      const fixedLook = await page.evaluate(() => { const v = window.__renderer.objects.get('outlet'); return v ? { fixed: v.isFixed, check: v.check.visible, lock: v.lock ? v.lock.visible : null, color: v.sideMat.color.getHexString() } : null; });
      check(!!fixedLook && fixedLook.fixed && fixedLook.check && fixedLook.lock === false, `fixed outlet turns green with a check and hides the lock (${JSON.stringify(fixedLook)})`);
      await shot(page, '06-fixed');
    } else {
      console.log('  skip cover → outlet (cover not pickable)');
    }

    // item：battery → trash → removed（view は消える）
    const battery = await findObject(page, 'battery');
    const trash = await findObject(page, 'trash');
    if (battery && trash && await waitPickable(page, 'battery')) {
      await dragGame(page, battery, trash);
      const b = await findObject(page, 'battery');
      check(b.state === 'removed', `battery removed after dropping into trash (${b.state})`);
      await page.waitForTimeout(100);
      const hidden = await page.evaluate(() => { const v = window.__renderer.objects.get('battery'); return v ? !v.group.visible : null; });
      check(hidden === true, 'battery view is hidden after trashing');
    } else {
      console.log('  skip battery → trash (battery not pickable)');
    }

    // 軽い hazard：kettle → カウンター（highPlace, y≈30）→ fixed（via high）。壁の上に小さく灰色で乗る
    const kettle = await findObject(page, 'kettle');
    if (kettle && await waitPickable(page, 'kettle')) {
      const mid = await dragGame(page, kettle, { x: 330, y: 30 }, {
        midShot: '07-drag-high',
        midCheck: () => page.evaluate(() => {
          const r = window.__renderer;
          const w = r.walls.find(x => x.def.model === 'counter');
          return { drag: window.__game.state.drag && window.__game.state.drag.targetId, hint: !!(w && w.hint && w.hint.visible) };
        })
      });
      check(mid && mid.drag === 'kettle', `state.drag targets kettle during drag (${mid && mid.drag})`);
      check(mid && mid.hint, 'counter hint plane is visible while dragging a light object');
      const k = await findObject(page, 'kettle');
      check(k.state === 'fixed' && k.storedIn === 'counter', `kettle fixed onto the counter (${k.state}, storedIn ${k.storedIn})`);
      await page.waitForTimeout(150);
      const look = await page.evaluate(() => {
        const v = window.__renderer.objects.get('kettle');
        return v ? { stored: v.isStored, y: v.body.position.y, scale: v.body.scale.x, check: v.check.visible } : null;
      });
      check(!!look && look.stored && look.y >= 50 && look.scale < 1 && look.check, `stored kettle sits on top of the wall, smaller, with a check (${JSON.stringify(look)})`);
      const hintOff = await page.evaluate(() => { const w = window.__renderer.walls.find(x => x.def.model === 'counter'); return !(w && w.hint && w.hint.visible); });
      check(hintOff, 'counter hint plane hides after the drop');
    } else {
      console.log('  skip kettle → counter (kettle not pickable)');
    }

    // v5：キッチンに訪問者はいない。危険なおもちゃの「！」Sprite、ダミーの平たい板、壁ラベルの n/2
    const kitchenVisitors = await page.evaluate(() => (window.__game.state.stage.visitors || []).length);
    check(kitchenVisitors === 0, `kitchen has no visitors (${kitchenVisitors})`);
    const v5views = await page.evaluate(() => {
      const r = window.__renderer;
      const puzzle = r.objects.get('puzzle');
      const cushion = r.objects.get('cushion');
      const counter = r.walls.find(w => w.def.model === 'counter');
      const o = window.__game.state.objects.find(x => x.id === 'puzzle');
      return { ingestible: !!(o && o.ingestible), risk: !!(puzzle && puzzle.risk), prop: !!(cushion && cushion.isProp && !cushion.plate && cushion.boxH < 20), label: counter ? counter.labelText : null };
    });
    check(v5views.ingestible && v5views.risk, `puzzle is ingestible and has the "！" badge sprite (${JSON.stringify(v5views)})`);
    check(v5views.prop, 'cushion prop is a flat plate without heavy cues');
    check(/カウンター 1\/2/.test(v5views.label || ''), `counter label shows 1/2 after storing the kettle (${v5views.label})`);

    // ダミー → カウンター（stored、容量 2 に到達）、3 個目（magazine）は high_full で床に戻る
    const cushion = await findObject(page, 'cushion');
    if (cushion && await waitPickable(page, 'cushion')) {
      await dragGame(page, cushion, { x: 150, y: 30 }, { midShot: '07b-drag-prop' });
      const c = await findObject(page, 'cushion');
      check(c.state === 'removed' && c.storedIn === 'counter', `cushion stored on the counter (${c.state}, storedIn ${c.storedIn})`);
    } else {
      console.log('  skip cushion → counter (cushion not pickable)');
    }
    const magazine = await findObject(page, 'magazine');
    if (magazine && await waitPickable(page, 'magazine')) {
      const mid = await dragGame(page, magazine, { x: 660, y: 30 }, {
        midShot: '07c-drag-full',
        midCheck: () => page.evaluate(() => { const w = window.__renderer.walls.find(x => x.def.model === 'counter'); return w && w.hint ? { visible: w.hint.visible, color: w.hint.material.color.getHexString() } : null; })
      });
      check(!!mid && mid.visible && mid.color === 'd05a5a', `counter hint plane is red while dragging onto a full counter (${JSON.stringify(mid)})`);
      const m = await findObject(page, 'magazine');
      const fullLogged = await page.evaluate(() => window.__game.state.log.some(e => /もう置けない/.test(e.text || '')));
      check(fullLogged || (m.state !== 'removed' && m.storedIn == null), `third drop onto the counter is refused (high_full; log ${fullLogged}, magazine ${m.state}/${m.storedIn})`);
      await page.waitForTimeout(150);
      const label = await page.evaluate(() => { const w = window.__renderer.walls.find(x => x.def.model === 'counter'); return w ? w.labelText : null; });
      check(/2\/2 満/.test(label || ''), `counter label shows 2/2 満 (${label})`);
      await shot(page, '07d-high-full');
    } else {
      console.log('  skip magazine → counter (magazine not pickable)');
    }

    // 軽い hazard：knife → drawer（レシピ store）
    const knife = await findObject(page, 'knife');
    const drawer = await findObject(page, 'drawer');
    if (knife && drawer && await waitPickable(page, 'knife')) {
      await dragGame(page, knife, drawer);
      const k = await findObject(page, 'knife');
      check(k.state === 'fixed' && k.storedIn === 'drawer', `knife stored in the drawer (${k.state}, storedIn ${k.storedIn})`);
    } else {
      console.log('  skip knife → drawer (knife not pickable)');
    }
    await page.waitForTimeout(200);
    await shot(page, '08-stored');

    // 空クリック：床（何も無い所）では pickObject が null
    const emptyPick = await page.evaluate(() => {
      const s = window.__renderer.toScreenCoords(700, 250);
      return window.__renderer.pickObject(s.x, s.y);
    });
    check(emptyPick === null, `pickObject on empty floor returns null (${emptyPick})`);

    // ドラッグ：ball を床の別の位置へ
    let ball = await findObject(page, 'ball');
    check(!!ball, 'ball exists in stage 1');
    if (ball && await waitPickable(page, 'ball', 15000)) {
      ball = await findObject(page, 'ball');
      const target = { x: 470, y: 180 };
      const mid = await dragGame(page, ball, target, {
        midShot: '09-drag-toy',
        midCheck: () => page.evaluate(() => window.__game.state.drag && window.__game.state.drag.targetId)
      });
      check(mid === 'ball', `state.drag targets ball during drag (${mid})`);
      const moved = await findObject(page, 'ball');
      const dist = Math.hypot(moved.x - ball.x, moved.y - ball.y);
      check(dist > 50, `ball moved by drag (${Math.round(dist)}px)`);
      const nearTarget = Math.hypot(moved.x - target.x, moved.y - target.y);
      check(nearTarget < 40, `ball landed near the drop point on the floor plane (${Math.round(nearTarget)}px off)`);
    } else if (ball) {
      console.log('  skip ball drag (ball was carried/played for the whole wait)');
    }

    // 取り上げ長押し（0.5 秒）：おもちゃを持っている赤ちゃんがいれば（契約 §3 のイベントを直接流す。リング Sprite を確認）
    // 赤ちゃんが遊び終えておもちゃを持つまで少し待つ（持っていなければ skip）
    try {
      await page.waitForFunction(() => window.__game.state.babies.some(x => x.carrying != null && !x.isHeld), null, { timeout: 12000 });
    } catch (e) { /* skip below */ }
    const carrier = await page.evaluate(() => {
      const b = window.__game.state.babies.find(x => x.carrying != null && !x.isHeld);
      return b ? b.id : null;
    });
    if (carrier) {
      const before = await page.evaluate(() => window.__game.state.interventions);
      await page.evaluate((id) => window.__game.input({ type: 'pressStart', targetId: id }), carrier);
      await page.waitForTimeout(250);
      const ring = await page.evaluate((id) => { const v = window.__renderer.babies.get(id); return !!(v && v.ring && v.ring.visible); }, carrier);
      check(ring, 'take-away ring sprite is shown above the baby while holding');
      let done = false;
      try {
        await page.waitForFunction(([id, n]) => {
          const s = window.__game.state;
          const b = s.babies.find(x => x.id === id);
          return s.interventions > n || (b && b.carrying == null);
        }, [carrier, before], { timeout: 5000 });
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
    const logCount = await page.evaluate(() => window.__game.state.log.length);
    check(logCount > 0, `log has entries (${logCount})`);

    // ---- 演出の確認：ヒヤリを強制発生させてフラッシュ要素が光る
    const flashSeen = await page.evaluate(async () => {
      const r = window.__renderer;
      r.playEffect('hiyari', 'drawer', { babyId: 'baby0', x: 0, y: 0, count: 1, combo: null });
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      const el = document.querySelector('#game .hiyari-flash');
      return el ? parseFloat(el.style.opacity) : -1;
    });
    check(flashSeen > 0, `hiyari flash overlay lights up (opacity ${flashSeen})`);

    // ---- StageResult（残り時間を直接縮める）
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
      const events = await page.$('.result-events');
      check(!!events, 'result has the できごと block');
      const hasNext = await page.$('button[data-action="next"], button[data-action="retry"]');
      check(!!hasNext, 'result has Next or Retry button');
      // 次ステージへ進み、Loading で新ステージが組まれること（双子：kind 'container' の bin が蓋つきバケツで組まれる）
      if (hasNext) {
        const action = await hasNext.getAttribute('data-action');
        await hasNext.click();
        await waitForScreen(page, 'loading');
        await waitForScreen(page, 'play', 20000);
        await page.waitForTimeout(400);
        const stageName2 = await page.evaluate(() => window.__game.state.stage.name);
        const viewIds = await page.evaluate(() => [...window.__renderer.objects.keys()]);
        const stateIds = await page.evaluate(() => window.__game.state.objects.map(o => o.id));
        check(stateIds.every(id => viewIds.includes(id)), `renderer built views for every object of the next stage (${action} -> ${stageName2})`);
        if (action === 'next') {
          const bin = await page.evaluate(() => { const v = window.__renderer.objects.get('bin'); return v ? { isBin: v.isBin, lid: !!v.lid, visible: v.group.visible } : null; });
          check(!!bin && bin.isBin && bin.lid && bin.visible, `container 'bin' is drawn as a lidded bucket (${JSON.stringify(bin)})`);
        }
        await shot(page, '12-next-stage');
        if (action === 'next') await twinsChecks(page, '13-');
      }
    }

    check(pageErrors.length === 0, `no page errors (${pageErrors.length})`);
    if (pageErrors.length) console.log(pageErrors.join('\n'));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\nscreenshots: ${SHOTS} (3d-*.png)`);
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
