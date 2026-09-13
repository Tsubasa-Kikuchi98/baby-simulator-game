#!/usr/bin/env node
// node sim/assert.js [--n 300] [--fast] [--tuning JSON] [--workers k]
// Runs the §13.3 matrix and checks every target. Exit 1 on any failure.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { STAGES, TUNING } from '../src/game/stages.js';
import { parse, parseTuning, intArg, writeJson, progressBar } from './cli.js';
import { runJobs } from './pool.js';
import { runOnce, deterministicView } from './engine.js';
import { aggregate, mean, table, fmt, pct } from './metrics.js';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');

/** The target matrix (§13.3, re-mapped to the 2-stage layout per CONTRACT §9.4).
 *  stage1 = キッチン (index 0), stage2 = 双子 (index 1). noop / intervene_only are judged on stage1;
 *  human_like clear-rate targets: old stage2 range → new stage1, old stage3 range → new stage2; combo on both.
 *  Each check: { id, cells, metric(aggregates) → value, lo, hi, format } */
export function buildTargets() {
  const R = (id, label, cells, value, lo, hi, format = pct) => ({ id, label, cells, value, lo, hi, format });
  const s = (i, bot) => `${i}|${bot}`;
  return [
    R('noop_s1_fail', 'noop stage1(kitchen) median failAtSec', [s(0, 'noop')], (A) => A[s(0, 'noop')].medianFailAtSec, 30, 40, (v) => fmt(v, 1)),
    R('optimal_s1', 'optimal stage1(kitchen) clear rate', [s(0, 'optimal')], (A) => A[s(0, 'optimal')].clearRate, 0.95, 1),
    R('optimal_s2', 'optimal stage2(twins) clear rate', [s(1, 'optimal')], (A) => A[s(1, 'optimal')].clearRate, 0.95, 1),
    R('intervene_s1_fail', 'intervene_only stage1(kitchen) fail rate', [s(0, 'intervene_only')], (A) => A[s(0, 'intervene_only')].failRate, 0.90, 1),
    R('human_s1', 'human_like stage1(kitchen) clear rate', [s(0, 'human_like')], (A) => A[s(0, 'human_like')].clearRate, 0.50, 0.70),
    R('human_s2', 'human_like stage2(twins) clear rate', [s(1, 'human_like')], (A) => A[s(1, 'human_like')].clearRate, 0.35, 0.55),
    R('human_s1_play', 'human_like stage1 median playCount', [s(0, 'human_like')], (A) => A[s(0, 'human_like')].medianPlayCount, 2, Infinity, (v) => fmt(v, 1)),
    R('human_s2_play', 'human_like stage2 median playCount', [s(1, 'human_like')], (A) => A[s(1, 'human_like')].medianPlayCount, 2, Infinity, (v) => fmt(v, 1)),
    R('human_s1_combo', 'human_like stage1 combo hiyari rate', [s(0, 'human_like')], (A) => A[s(0, 'human_like')].comboHiyariRate, 0.30, 0.60),
    R('human_s2_combo', 'human_like stage2 combo hiyari rate', [s(1, 'human_like')], (A) => A[s(1, 'human_like')].comboHiyariRate, 0.30, 0.60),
    R('human_satlow', 'human_like satLowRatio mean (both stages)', [s(0, 'human_like'), s(1, 'human_like')],
      (A) => mean([0, 1].map((i) => A[s(i, 'human_like')].meanSatLowRatio)), 0.15, 0.40)
  ];
}

export function evaluateTargets(targets, A) {
  return targets.map((t) => {
    let value;
    try { value = t.value(A); } catch { value = NaN; }
    const pass = value != null && !Number.isNaN(value) && value >= t.lo && value <= t.hi;
    return { ...t, actual: value, pass };
  });
}

export function rangeText(t) {
  if (t.hi === Infinity) return `>= ${t.format(t.lo)}`;
  if (t.hi === 1 && t.format === pct && t.lo > 0) return `>= ${t.format(t.lo)}`;
  return `${t.format(t.lo)} .. ${t.format(t.hi)}`;
}

async function main() {
  const args = parse();
  if (args.help) {
    console.log('usage: node sim/assert.js [--n 300] [--fast] [--tuning JSON] [--workers k] [--seed 1]');
    return;
  }
  const n = intArg(args.n, args.fast ? 60 : 300);
  const nRandom = args.fast ? 150 : 1000;
  const seed = intArg(args.seed, 1);
  const tuningOverride = parseTuning(args.tuning);
  const tuning = tuningOverride || undefined;
  const workers = intArg(args.workers, 1);

  // matrix
  const targets = buildTargets();
  const cellKeys = new Set();
  for (const t of targets) for (const c of t.cells) cellKeys.add(c);
  const jobs = [];
  for (const key of cellKeys) {
    const [si, bot] = key.split('|');
    for (let i = 0; i < n; i++) jobs.push({ stageIndex: Number(si), botName: bot, seed: seed + i, tuning, lite: true, tag: key });
  }
  for (let i = 0; i < nRandom; i++) jobs.push({ stageIndex: i % STAGES.length, botName: 'random', seed: seed + 100000 + i, tuning, lite: true, tag: 'random' });

  const t0 = Date.now();
  const results = await runJobs(jobs, { workers, onProgress: args.quiet ? null : progressBar('assert') });
  const A = {};
  for (const key of [...cellKeys, 'random']) A[key] = aggregate(results.filter((_, i) => jobs[i].tag === key));

  const rows = [];
  const evals = evaluateTargets(targets, A);
  for (const e of evals) rows.push([e.pass ? 'PASS' : 'FAIL', e.label, e.format(e.actual), rangeText(e)]);

  // random: zero errors, max frame < 50 ms
  const rnd = A.random;
  const randErrPass = rnd.errors === 0;
  const randFramePass = rnd.frameMaxMs < 50;
  rows.push([randErrPass ? 'PASS' : 'FAIL', `random x${nRandom} (all ${STAGES.length} stages) exceptions`, String(rnd.errors), '0']);
  rows.push([randFramePass ? 'PASS' : 'FAIL', `random x${nRandom} max frame ms`, fmt(rnd.frameMaxMs, 2), '< 50']);

  // errors in any cell
  const totalErrors = results.filter((r) => r.error).length;
  rows.push([totalErrors === 0 ? 'PASS' : 'FAIL', 'exceptions in all cells', String(totalErrors), '0']);

  // determinism
  const detStage = 1, detSeed = seed + 7;
  const d1 = deterministicView(await runOnce({ stageIndex: detStage, botName: 'human_like', seed: detSeed, tuning }));
  const d2 = deterministicView(await runOnce({ stageIndex: detStage, botName: 'human_like', seed: detSeed, tuning }));
  const detPass = JSON.stringify(d1) === JSON.stringify(d2);
  rows.push([detPass ? 'PASS' : 'FAIL', 'determinism (same seed twice, human_like stage2/twins)', detPass ? 'equal' : 'DIFFERENT', 'equal']);

  console.log(table(['result', 'check', 'actual', 'target'], rows));
  const fails = rows.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${rows.length - fails}/${rows.length} checks passed; n=${n} per cell, random=${nRandom}; ${((Date.now() - t0) / 1000).toFixed(1)}s, workers=${workers}`);
  if (tuningOverride) console.log(`tuning override: ${JSON.stringify(tuningOverride)}`);

  const errs = results.filter((r) => r.error);
  if (errs.length) {
    const byMsg = new Map();
    for (const r of errs) { const k = r.error.split('\n')[0]; byMsg.set(k, (byMsg.get(k) || 0) + 1); }
    console.log('\nException summary:');
    for (const [k, c] of byMsg) console.log(`  x${c}  ${k}`);
    const first = errs[0];
    console.log(`\nFirst stack (stage${first.stageId}/${first.bot} seed=${first.seed}):\n${first.error}`);
  }
  writeJson(join(OUT_DIR, 'assert.json'), { n, nRandom, tuning: tuningOverride || {}, summaries: A, checks: rows, determinism: detPass });
  process.exit(fails ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main().catch((e) => { console.error(e.stack || e); process.exit(2); });
