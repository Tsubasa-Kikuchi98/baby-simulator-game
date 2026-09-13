// worker_threads entry used by pool.js
import { parentPort } from 'node:worker_threads';
import { runOnce } from './engine.js';

parentPort.on('message', async (msg) => {
  if (msg.done) { parentPort.close(); return; }
  try {
    const results = [];
    for (const job of msg.jobs) results.push(await runOnce(job));
    parentPort.postMessage({ start: msg.start, results });
  } catch (e) {
    parentPort.postMessage({ error: (e && e.stack) || String(e) });
  }
});
