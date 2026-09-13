// Small shared CLI helpers for sim/*.js
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { STAGES } from '../src/game/stages.js';
import { botNames } from './bots/index.js';

export function parse(extraOptions = {}) {
  const { values } = parseArgs({
    options: {
      stage: { type: 'string', default: 'all' },
      bot: { type: 'string', default: 'all' },
      n: { type: 'string' },
      seed: { type: 'string', default: '1' },
      json: { type: 'string' },
      tuning: { type: 'string' },
      workers: { type: 'string' },
      fast: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      ...extraOptions
    },
    allowPositionals: false,
    strict: true
  });
  return values;
}

/** --stage 1|2|all (1-based) → array of 0-based indices */
export function stageIndices(arg) {
  if (!arg || arg === 'all') return STAGES.map((_, i) => i);
  return String(arg).split(',').map((s) => {
    const k = Number(s);
    if (!Number.isInteger(k) || k < 1 || k > STAGES.length) throw new Error(`--stage must be 1..${STAGES.length} or all (got ${s})`);
    return k - 1;
  });
}

export function botList(arg) {
  if (!arg || arg === 'all') return botNames.slice();
  const list = String(arg).split(',');
  for (const b of list) if (!botNames.includes(b)) throw new Error(`unknown bot ${b} (have ${botNames.join(', ')})`);
  return list;
}

export function parseTuning(arg) {
  if (!arg) return null;
  let obj;
  try { obj = JSON.parse(arg); } catch (e) { throw new Error(`--tuning must be JSON: ${e.message}`); }
  if (!obj || typeof obj !== 'object') throw new Error('--tuning must be a JSON object');
  return obj;
}

export function intArg(v, dflt) {
  if (v == null) return dflt;
  const k = Number(v);
  if (!Number.isFinite(k) || k < 0) throw new Error(`expected a number, got ${v}`);
  return Math.floor(k);
}

export function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 1));
}

export function progressBar(label) {
  let last = -1;
  return (done, total) => {
    if (!process.stderr.isTTY) return;
    const p = Math.floor((done / total) * 50);
    if (p === last && done !== total) return;
    last = p;
    process.stderr.write(`\r${label} ${done}/${total}`.padEnd(60) + (done === total ? '\n' : ''));
  };
}
