#!/usr/bin/env node
// node sim/tune.js [--n 300] [--n2 100] [--workers k] [--seed 1] [--levels 0.7,1,1.3] [--vars BABY_SPEED,...]
// §13.4: sweep the 5 tuning variables at 3 levels each (243 conditions); run human_like on both stages at --n,
// and noop / intervene_only (stage 1) + optimal (both stages) at --n2. FIX_SEC_MULT was replaced by MOOD_SPEED_GAIN (CONTRACT §9). List conditions where all targets pass,
// sorted by distance from the centre of the target ranges, and recommend the most central one.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TUNING } from '../src/game/stages.js';
import { parse, parseTuning, intArg, writeJson, progressBar } from './cli.js';
import { runJobs, defaultWorkers } from './pool.js';
import { aggregate, table, fmt, pct } from './metrics.js';
import { buildTargets, evaluateTargets, rangeText } from './assert.js';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');
const VARS = ['BABY_SPEED', 'SAT_NO_TOY', 'FUSS_SEC', 'WEIGHT_TOY', 'MOOD_SPEED_GAIN'];

function conditions(vars, levels, base) {
  const out = [[]];
  for (const v of vars) {
    const next = [];
    for (const partial of out) for (const m of levels) next.push([...partial, [v, m]]);
    out.length = 0; out.push(...next);
  }
  return out.map((pairs) => {
    const mult = Object.fromEntries(pairs);
    const tuning = {};
    for (const [v, m] of pairs) tuning[v] = round(base[v] * m, 4);
    return { key: pairs.map(([v, m]) => `${v}x${m}`).join(' '), mult, tuning };
  });
}
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/** normalised distance from the centre of every ranged target (0 = dead centre; 1 = at the edge). */
function centreDistance(evals) {
  let sum = 0, k = 0;
  for (const e of evals) {
    if (!Number.isFinite(e.hi) || e.hi === 1 && e.lo >= 0.9) continue; // one-sided targets have no centre
    const mid = (e.lo + e.hi) / 2, half = (e.hi - e.lo) / 2;
    const d = (e.actual - mid) / half;
    sum += d * d; k++;
  }
  return k ? Math.sqrt(sum / k) : 0;
}

async function main() {
  const args = parse({ n2: { type: 'string' }, levels: { type: 'string', default: '0.7,1,1.3' }, vars: { type: 'string' } });
  if (args.help) {
    console.log('usage: node sim/tune.js [--n 300] [--n2 100] [--workers k] [--seed 1] [--levels 0.7,1,1.3] [--vars A,B] [--tuning JSON]');
    return;
  }
  const n = intArg(args.n, args.fast ? 60 : 300);
  const n2 = intArg(args.n2, Math.min(100, n));
  const seed = intArg(args.seed, 1);
  const workers = intArg(args.workers, defaultWorkers());
  const levels = args.levels.split(',').map(Number);
  const vars = args.vars ? args.vars.split(',') : VARS;
  const fixedOverride = parseTuning(args.tuning) || {};
  const base = { ...TUNING, ...fixedOverride };
  const conds = conditions(vars, levels, base);

  const targets = buildTargets();
  // cells: human_like x2 at n; noop s1, intervene s1, optimal x2 at n2
  const cells = [];
  for (const t of targets) for (const c of t.cells) if (!cells.includes(c)) cells.push(c);
  const jobs = [];
  for (let ci = 0; ci < conds.length; ci++) {
    const tuning = { ...fixedOverride, ...conds[ci].tuning };
    for (const cell of cells) {
      const [si, bot] = cell.split('|');
      const count = bot === 'human_like' ? n : n2;
      for (let i = 0; i < count; i++) jobs.push({ stageIndex: Number(si), botName: bot, seed: seed + i, tuning, lite: true, tag: ci * 1000 + cells.indexOf(cell) });
    }
  }
  console.log(`${conds.length} conditions x ${cells.length} cells = ${jobs.length} runs, workers=${workers}`);
  const t0 = Date.now();
  // incremental aggregation: keep only what the targets need
  const acc = new Map(); // tag → results (lite, ~200 B each)
  await runJobs(jobs, {
    workers, chunk: 50,
    onResult: (r, job) => { let a = acc.get(job.tag); if (!a) acc.set(job.tag, (a = [])); a.push(r); },
    onProgress: args.quiet ? null : progressBar('tune')
  });

  const rows = [];
  for (let ci = 0; ci < conds.length; ci++) {
    const A = {};
    for (const cell of cells) A[cell] = aggregate(acc.get(ci * 1000 + cells.indexOf(cell)) || []);
    const evals = evaluateTargets(targets, A);
    const errors = Object.values(A).reduce((s, a) => s + a.errors, 0);
    rows.push({ ...conds[ci], evals, pass: evals.every((e) => e.pass) && errors === 0, failed: evals.filter((e) => !e.pass).map((e) => e.id), dist: centreDistance(evals), errors, A });
  }
  const passing = rows.filter((r) => r.pass).sort((a, b) => a.dist - b.dist);
  const shortCols = (r) => vars.map((v) => `x${r.mult[v]}`);
  const metricCols = (r) => r.evals.map((e) => e.format(e.actual));
  const header = ['#', ...vars.map((v) => v.replace('BABY_SPEED', 'SPEED').replace('SAT_NO_TOY', 'NOTOY').replace('MOOD_SPEED_GAIN', 'MOOD').replace('WEIGHT_TOY', 'WTOY').replace('FUSS_SEC', 'FUSS')), 'dist', ...targets.map((t) => t.id)];

  console.log(`\nfinished in ${((Date.now() - t0) / 1000).toFixed(0)}s. ${passing.length}/${rows.length} conditions pass every target.\n`);
  console.log('targets: ' + targets.map((t) => `${t.id} ${rangeText(t)}`).join(' | '));
  if (passing.length) {
    console.log('\nPASSING (sorted by distance from target-range centres):');
    console.log(table(header, passing.map((r, i) => [i + 1, ...shortCols(r), fmt(r.dist, 3), ...metricCols(r)])));
    const rec = passing[0];
    const medianMult = {};
    for (const v of vars) { const ms = passing.map((r) => r.mult[v]).sort((a, b) => a - b); medianMult[v] = ms[Math.floor(ms.length / 2)]; }
    console.log('\nRECOMMENDED (most central):', JSON.stringify(rec.tuning));
    console.log('per-variable median multiplier over the passing set:', JSON.stringify(medianMult));
    console.log('Apply by writing the recommended values into TUNING in src/game/stages.js, then run `npm run sim:assert`.');
  } else {
    const near = rows.slice().sort((a, b) => a.failed.length - b.failed.length || a.dist - b.dist).slice(0, 15);
    console.log('\nNO condition passes every target. Closest 15 (fewest failed targets, then centre distance):');
    console.log(table([...header, 'failed'], near.map((r, i) => [i + 1, ...shortCols(r), fmt(r.dist, 3), ...metricCols(r), r.failed.join(',')])));
    console.log('\nPer §13.4 step 4: do not loosen targets; report to a human which targets conflict.');
  }
  writeJson(join(OUT_DIR, 'tune.json'), {
    n, n2, seed, vars, levels, fixedOverride,
    targets: targets.map((t) => ({ id: t.id, label: t.label, lo: t.lo, hi: t.hi })),
    conditions: rows.map((r) => ({ key: r.key, mult: r.mult, tuning: r.tuning, pass: r.pass, failed: r.failed, dist: r.dist, errors: r.errors, metrics: Object.fromEntries(r.evals.map((e) => [e.id, e.actual])) }))
  });
  console.log(`\nJSON: ${join(OUT_DIR, 'tune.json')}`);
}

main().catch((e) => { console.error(e.stack || e); process.exit(2); });
