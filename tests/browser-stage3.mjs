// ステージ3「夕方のリビング」（CONTRACT §12）のブラウザ確認。`npm run test:stage3`（2D と 3D を続けて実行）。
// tests/browser.mjs / browser3d.mjs はステージ1・2 を見ているので、こちらはステージ3 の 4 機構だけを実クリックで確かめる：
//   配置コンボの成立と、椅子を押して離したときの解除／兄におもちゃを渡して busy 明けに戻ること／
//   時限ハザードの activate／ページ例外ゼロ
// 使い方： node tests/browser-stage3.mjs [2d|3d]    （dist / dist-3d が必要。npm run test:stage3 は先にビルドする）
// スクリーンショットは tests/screenshots/s3-<mode>-*.png
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODE = process.argv[2] === '3d' ? '3d' : '2d';
const DIST = path.join(ROOT, MODE === '3d' ? 'dist-3d' : 'dist');
const SHOTS = path.join(ROOT, 'tests', 'screenshots');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg' };
const fails = [];
const check = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };

function serve(dir) {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (p === '/' || p === '') p = '/index.html';
      const file = path.join(dir, p);
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404); res.end('nf'); }
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

// ゲーム平面 (800x540) → 画面座標。両レンダラが toScreenCoords を公開している
async function toScreen(page, x, y) {
  return page.evaluate(([gx, gy]) => window.__renderer.toScreenCoords(gx, gy), [x, y]);
}

async function drag(page, from, to) {
  const a = await toScreen(page, from.x, from.y);
  const b = await toScreen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 10, a.y + 8, { steps: 3 });
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

const gs = (page, fn) => page.evaluate(fn);

(async () => {
  const { server, port } = await serve(DIST);
  const browser = await chromium.launch(MODE === '3d' ? { args: ['--use-angle=swiftshader'] } : {});
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/?seed=5${MODE === '3d' ? '&mode=3d' : ''}`);
  await page.waitForFunction(() => window.__game);
  await page.waitForTimeout(600);

  // ステージ3 へ直行
  await gs(page, () => window.__game.startStage(2));
  await page.waitForTimeout(400);
  check(await gs(page, () => window.__game.state.stage.id) === 3, 'ステージ3 に入った');
  await page.screenshot({ path: path.join(SHOTS, `s3-${MODE}-01-start.png`) });

  // 開始時点で配置コンボが 2 つ成立している
  const warn0 = await gs(page, () => window.__game.state.objects.filter(o => o.placementCombo).map(o => o.id));
  check(warn0.length === 2 && warn0.includes('window') && warn0.includes('balcony'), `開始時に配置コンボ 2 件 (${warn0})`);

  // 椅子を押して窓から離す → 解除される
  const chair = await gs(page, () => { const o = window.__game.state.objects.find(x => x.id === 'chair'); return { x: o.x, y: o.y }; });
  await drag(page, chair, { x: 330, y: 300 });
  const afterPush = await gs(page, () => {
    const w = window.__game.state.objects.find(o => o.id === 'window');
    const c = window.__game.state.objects.find(o => o.id === 'chair');
    return { climbable: w.climbable, combo: w.placementCombo, chair: { x: c.x, y: c.y } };
  });
  check(afterPush.climbable === false && afterPush.combo === null, `椅子を押したら窓が登れなくなった (${JSON.stringify(afterPush)})`);
  check(Math.abs(afterPush.chair.x - 330) < 60, `椅子が移動した (${JSON.stringify(afterPush.chair)})`);
  const logPush = await gs(page, () => window.__game.state.log.map(e => e.text).filter(t => /離した|踏み台/.test(t)));
  check(logPush.some(t => /離した/.test(t)), `解除のログが出た (${JSON.stringify(logPush)})`);
  await page.screenshot({ path: path.join(SHOTS, `s3-${MODE}-02-pushed.png`) });

  // 兄が入ってくるまで進めて、おもちゃを渡す
  await page.waitForFunction(() => window.__game.state.visitors.some(v => v.type === 'sibling' && v.active), null, { timeout: 15000 });
  const sib = await gs(page, () => { const v = window.__game.state.visitors.find(x => x.type === 'sibling'); return { x: v.x, y: v.y }; });
  const bear = await gs(page, () => { const o = window.__game.state.objects.find(x => x.id === 'bear'); return { x: o.x, y: o.y, state: o.state }; });
  await drag(page, bear, sib);
  const afterGive = await gs(page, () => {
    const v = window.__game.state.visitors.find(x => x.type === 'sibling');
    const o = window.__game.state.objects.find(x => x.id === 'bear');
    return { busy: v.busyUntil > window.__game.state.elapsed, busyToyId: v.busyToyId, carriedBy: o.carriedBy };
  });
  check(afterGive.busy && afterGive.carriedBy === 'brother', `兄におもちゃを渡せた (${JSON.stringify(afterGive)})`);
  const logGive = await gs(page, () => window.__game.state.log.map(e => e.text).filter(t => /お兄ちゃん/.test(t)));
  check(logGive.some(t => /渡した/.test(t)), `渡したログ (${JSON.stringify(logGive)})`);
  await page.screenshot({ path: path.join(SHOTS, `s3-${MODE}-03-sibling.png`) });

  // 時限ハザード：16 秒の炊飯器が activate すること（予告点滅の時間帯もスクリーンショット）
  await page.waitForFunction(() => window.__game.state.elapsed > 13.5, null, { timeout: 25000 });
  await page.screenshot({ path: path.join(SHOTS, `s3-${MODE}-04-warn.png`) });
  await page.waitForFunction(() => window.__game.state.objects.find(o => o.id === 'rice_cooker').state !== 'inactive', null, { timeout: 15000 });
  const act = await gs(page, () => ({
    state: window.__game.state.objects.find(o => o.id === 'rice_cooker').state,
    log: window.__game.state.log.map(e => e.text).filter(t => /熱く/.test(t))
  }));
  check(act.state === 'open' && act.log.length === 1, `炊飯器が活性化した (${JSON.stringify(act)})`);
  await page.screenshot({ path: path.join(SHOTS, `s3-${MODE}-05-activated.png`) });

  // 兄の busy 明け
  await page.waitForFunction(() => window.__game.state.log.some(e => e.kind === 'sibling_free'), null, { timeout: 30000 });
  const freed = await gs(page, () => window.__game.state.objects.find(o => o.id === 'bear').carriedBy);
  check(freed === null, `busy 明けでおもちゃが床に戻った (${freed})`);

  check(errors.length === 0, `page errors (${errors.length}) ${errors.slice(0, 2).join(' | ')}`);
  await browser.close();
  server.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall checks passed');
  process.exit(fails.length ? 1 : 0);
})();
