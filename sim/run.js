#!/usr/bin/env node
// node sim/run.js --stage 1 --bot optimal --n 1000 [--seed 1] [--json out.json] [--tuning '{"BABY_SPEED":60}'] [--workers 4]
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TUNING } from '../src/game/stages.js';
import { parse, stageIndices, botList, parseTuning, intArg, writeJson, progressBar } from './cli.js';
import { runJobs } from './pool.js';
import { aggregate, table, summaryRow, SUMMARY_HEADER } from './metrics.js';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');

async function main() {
  const args = parse();
  if (args.help) {
    console.log('usage: node sim/run.js --stage <1|2|all> --bot <name|all> --n <runs> [--seed 1] [--json path] [--tuning JSON] [--workers k]');
    return;
  }
  const stages = stageIndices(args.stage);
  const botsToRun = botList(args.bot);
  const n = intArg(args.n, args.fast ? 60 : 300);
  const seed = intArg(args.seed, 1);
  const tuningOverride = parseTuning(args.tuning);
  const tuning = tuningOverride ? { ...TUNING, ...tuningOverride } : TUNING;
  const workers = intArg(args.workers, 1);

  const jobs = [];
  for (const si of stages) for (const bot of botsToRun) for (let i = 0; i < n; i++) {
    jobs.push({ stageIndex: si, botName: bot, seed: seed + i, tuning: tuningOverride || undefined, tag: `${si}|${bot}` });
  }
  const t0 = Date.now();
  const results = await runJobs(jobs, { workers, onProgress: args.quiet ? null : progressBar('sim') });
  const elapsedMs = Date.now() - t0;

  const rows = [];
  const cells = [];
  for (const si of stages) for (const bot of botsToRun) {
    const cellResults = results.filter((r, i) => jobs[i].tag === `${si}|${bot}`);
    const summary = aggregate(cellResults);
    const cell = { stage: si + 1, stageId: cellResults[0]?.stageId ?? si + 1, bot, n, seed, tuning: tuningOverride || {}, summary, results: cellResults };
    cells.push(cell);
    rows.push(summaryRow(`stage${si + 1}/${bot}`, summary));
    if (!args.json) writeJson(join(OUT_DIR, `${si + 1}-${bot}.json`), cell);
  }
  if (args.json) writeJson(args.json, { tuning: tuningOverride || {}, cells });

  console.log(table(SUMMARY_HEADER, rows));
  console.log(`\n${jobs.length} runs in ${(elapsedMs / 1000).toFixed(1)}s (${(elapsedMs / jobs.length).toFixed(1)} ms/run, workers=${workers})`);
  console.log(`JSON: ${args.json || OUT_DIR + '/<stage>-<bot>.json'}`);
  const errs = results.filter((r) => r.error);
  if (errs.length) {
    console.log(`\n${errs.length} run(s) threw. First:`);
    console.log(`  stage${jobs[results.indexOf(errs[0])].stageIndex + 1}/${errs[0].bot} seed=${errs[0].seed}\n${errs[0].error}`);
  }
}

main().catch((e) => { console.error(e.stack || e); process.exit(2); });
