# sim/ — headless simulation (spec §13)

Runs `src/game/state.js` in Node at `dt = 1/60` with scripted bots, no DOM/Canvas. Every run is
deterministic for a given seed (game rng = `createRng(seed)`, bot rng = `createRng(seed ^ 0x5bd1e995)`).

```
npm run sim -- --stage 1 --bot optimal --n 1000            # one cell; JSON → sim/out/1-optimal.json
npm run sim -- --stage all --bot all --n 300 --workers 4   # every cell, parallel
npm run sim -- --stage 2 --bot human_like --n 200 --tuning '{"BABY_SPEED":60}' --json out.json
npm run sim:assert                                         # §13.3 target matrix, n=300/cell, exit 1 on FAIL
npm run sim:assert -- --fast                               # n=60/cell, random x150 (quick check)
npm run sim:tune -- --workers 8                            # §13.4 sweep (243 conditions x human_like n=300 x 2 stages)
npm run sim:tune -- --n 60 --n2 40                         # faster, noisier sweep
```

Options (all scripts): `--seed` (first seed, default 1), `--tuning JSON` (merged over `TUNING`), `--workers k`
(worker_threads; `run`/`assert` default 1, `tune` defaults to cores-1), `--quiet`.
`--stage` is 1-based (`1` = キッチン, `2` = 双子, `3` = 夕方のリビング, `1,2`, `all`). `--bot` is `noop|optimal|intervene_only|random|human_like|all`.

## Files

| file | role |
|---|---|
| `engine.js` | `runOnce({ stageIndex, botName, seed, tuning, dt, maxSec, lite })` → per-run result; `deterministicView()` strips wall-clock fields |
| `bots/index.js` | `bots = { noop, optimal, intervene_only, random, human_like }`, each `create(rng, tuning) → { step(state, effects, emit, dt) }`. No bot long-presses objects (CONTRACT §9.1). `optimal` fixes every open hazard by drag & drop: heavy hazard ← its goods (`for`), light hazard → `store` recipe partner (knife → drawer) else the nearest highPlace wall, item → nearest container (kind `container` or `container:true`) else highPlace; actions are ordered by the babies' ETA to the hazard, then toys near danger are relocated. It reads `baby.targetId` (upper bound); `human_like` must not — it infers the baby's intent from its heading (`dirX/dirY`), re-evaluated only when a new action starts after the 0.4–1.2 s reaction delay, misclicks 10 % (drags a random light object a short way) and aborts 15 % of drags early at a random floor point. `intervene_only` also reacts with a 0.4–1.2 s human delay between noticing danger (60 px / combo warn) and grabbing the baby. `random` also drops onto walls (high places) and containers. v4 (CONTRACT §10): the climbable `sofa` is a heavy hazard whose goods is `mat`, so `optimal`/`human_like` fix it like any other recipe; items dropped by the visitor (`cigarette`/`coin`/`pills`) are tidied by the item rule (container → highPlace); `intervene_only` never grabs a baby with `climbing != null`. v5 (CONTRACT §11): `optimal`/`human_like` answer a mouthing baby (`baby.mouthing != null`) with the take-away hold before any drag (releasing a drag in progress), skip high places whose `highPlaceCount` has reached capacity (container / other high place instead, else park the hazard far from the babies), and never touch props; `random` drags props too |
| `bots/common.js` | geometry / state helpers shared by bots, `safeSpot()` grid search, single-mouse drag driver |
| `metrics.js` | `aggregate(results)` → clearRate, median failAtSec, median playCount, comboHiyariRate, mean satLowRatio, frame stats |
| `pool.js` / `worker.js` | job runner, optionally over `node:worker_threads` |
| `run.js` / `assert.js` / `tune.js` | CLIs described above |
| `out/` | JSON output (gitignored) |

## Result shape (one run)

```
{ stageId, bot, seed, cleared, failAtSec, hiyari, playCount, interventions, comboHiyari,
  satLowRatio, satisfactionCurve /* mean satisfaction sampled every 1 s */, frameMaxMs, error, elapsed }
```

`error` holds the stack of any exception thrown by the game or bot (the `random` bot exists to find these).

## Developing without the game module

`SIM_GAME_MODULE=/path/to/stand-in.js` makes `engine.js` import that file instead of `../src/game/state.js`.
It must export `createGame({ rng, stages, tuning })` per `docs/CONTRACT.md`.
