// Headless simulation engine (spec §13.1). Drives src/game/state.js with a bot at a fixed dt.
// No DOM, no Math.random: game rng and bot rng both derive from the run seed.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createRng } from '../src/game/rng.js';
import { STAGES, TUNING } from '../src/game/stages.js';
import { bots } from './bots/index.js';

const BOT_SEED_XOR = 0x5bd1e995;

let gameModulePromise = null;
// Default import path is the real game module. SIM_GAME_MODULE (a file path) overrides it,
// which is only meant for developing the harness against a stand-in.
export function loadGameModule() {
  if (!gameModulePromise) {
    const override = process.env.SIM_GAME_MODULE;
    gameModulePromise = override
      ? import(pathToFileURL(resolve(override)).href)
      : import('../src/game/state.js');
  }
  return gameModulePromise;
}

export function mergeTuning(override) {
  if (!override) return TUNING;
  return { ...TUNING, ...override };
}

/**
 * Run one stage to completion with one bot.
 * @returns {{ stageId, bot, seed, cleared, failAtSec, hiyari, playCount, interventions, comboHiyari,
 *             satLowRatio, satisfactionCurve, frameMaxMs, error }}
 */
export async function runOnce({ stageIndex, botName, seed, tuning, dt = 1 / 60, maxSec, lite = false }) {
  const { createGame } = await loadGameModule();
  const T = tuning ? (tuning === TUNING ? TUNING : { ...TUNING, ...tuning }) : TUNING;
  const stageDef = STAGES[stageIndex];
  const result = {
    stageId: stageDef ? stageDef.id : stageIndex + 1,
    bot: botName,
    seed,
    cleared: false,
    failAtSec: null,
    hiyari: 0,
    playCount: 0,
    interventions: 0,
    comboHiyari: 0,
    satLowRatio: 0,
    satisfactionCurve: lite ? undefined : [],
    frameMaxMs: 0,
    error: null
  };
  const botDef = bots[botName];
  if (!botDef) throw new Error(`unknown bot "${botName}" (have: ${Object.keys(bots).join(', ')})`);
  if (!stageDef) throw new Error(`bad stageIndex ${stageIndex} (0..${STAGES.length - 1})`);

  const limit = maxSec ?? stageDef.timeLimit + 1;
  const maxFrames = Math.ceil(limit / dt) + 2;
  let elapsedSelf = 0;
  let satLowSelf = 0;
  let nextSample = 0;
  let frameMaxNs = 0n;
  let game = null;
  try {
    game = createGame({ rng: createRng(seed >>> 0), stages: STAGES, tuning: T });
    game.startStage(stageIndex, { skipLoading: true });
    const bot = botDef.create(createRng((seed ^ BOT_SEED_XOR) >>> 0), T);
    const emit = (ev) => game.input(ev);
    const state = game.state;
    let effects = [];
    for (let frame = 0; frame < maxFrames; frame++) {
      if (state.screen !== 'play') break;
      if (state.elapsed > limit) break;
      const t0 = process.hrtime.bigint();
      bot.step(state, effects, emit, dt);
      effects = game.update(dt) || [];
      const ns = process.hrtime.bigint() - t0;
      if (ns > frameMaxNs) frameMaxNs = ns;
      elapsedSelf += dt;
      const babies = state.babies;
      let low = false;
      for (let i = 0; i < babies.length; i++) if (babies[i].satisfaction < T.SAT_LOW) { low = true; break; }
      if (low) satLowSelf += dt;
      if (!lite && elapsedSelf >= nextSample) {
        nextSample += 1;
        let sum = 0;
        for (let i = 0; i < babies.length; i++) sum += babies[i].satisfaction;
        result.satisfactionCurve.push(Math.round((sum / Math.max(1, babies.length)) * 10) / 10);
      }
    }
    const res = state.result;
    result.hiyari = state.hiyari;
    result.playCount = state.playCount;
    result.interventions = state.interventions;
    result.comboHiyari = state.comboHiyari;
    if (res && typeof res.cleared === 'boolean') {
      result.cleared = res.cleared;
      result.failAtSec = res.cleared ? null : round2(res.failAtSec ?? state.elapsed);
    } else {
      result.cleared = state.hiyari < 3 && state.timeLeft <= 0;
      result.failAtSec = result.cleared ? null : round2(state.elapsed);
    }
    const played = state.elapsed > 0 ? state.elapsed : elapsedSelf;
    const lowTime = typeof state.satLowTime === 'number' ? state.satLowTime : satLowSelf;
    result.satLowRatio = played > 0 ? round4(lowTime / played) : 0;
    result.elapsed = round2(state.elapsed);
  } catch (e) {
    result.error = (e && e.stack) || String(e);
    if (game && game.state) {
      result.hiyari = game.state.hiyari ?? 0;
      result.failAtSec = round2(game.state.elapsed ?? elapsedSelf);
    } else {
      result.failAtSec = round2(elapsedSelf);
    }
  }
  result.frameMaxMs = Number(frameMaxNs) / 1e6;
  return result;
}

/** Sequential batch runner (no workers). Seeds are seed, seed+1, ... */
export async function runMany({ stageIndex, botName, n, seed = 1, tuning, dt, lite, onProgress }) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = await runOnce({ stageIndex, botName, seed: seed + i, tuning, dt, lite });
    if (onProgress) onProgress(i + 1, n);
  }
  return out;
}

/** Strip wall-clock fields so two runs can be compared for determinism. */
export function deterministicView(result) {
  const { frameMaxMs, ...rest } = result;
  return rest;
}

function round2(v) { return v == null ? v : Math.round(v * 100) / 100; }
function round4(v) { return v == null ? v : Math.round(v * 10000) / 10000; }
