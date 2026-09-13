// Runs many simulation jobs, optionally spread over worker_threads.
// job = { stageIndex, botName, seed, tuning?, dt?, lite?, tag? }  (tag is echoed back untouched)
import { Worker } from 'node:worker_threads';
import os from 'node:os';
import { runOnce } from './engine.js';

export function defaultWorkers() {
  const n = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, n - 1);
}

/**
 * @param jobs array of jobs
 * @param opts { workers, chunk, onResult(result, job), onProgress(done, total) }
 * @returns results in job order
 */
export async function runJobs(jobs, { workers = 1, chunk = 25, onResult, onProgress } = {}) {
  const total = jobs.length;
  const results = new Array(total);
  let done = 0;
  const finish = (i, r) => {
    results[i] = r;
    if (onResult) onResult(r, jobs[i]);
    done++;
    if (onProgress) onProgress(done, total);
  };
  if (workers <= 1 || total < 2) {
    for (let i = 0; i < total; i++) finish(i, await runOnce(jobs[i]));
    return results;
  }
  const nWorkers = Math.min(workers, Math.ceil(total / chunk));
  let next = 0;
  await new Promise((resolve, reject) => {
    let alive = nWorkers;
    for (let w = 0; w < nWorkers; w++) {
      const worker = new Worker(new URL('./worker.js', import.meta.url));
      const feed = () => {
        if (next >= total) { worker.postMessage({ done: true }); return; }
        const start = next; const end = Math.min(total, next + chunk); next = end;
        worker.postMessage({ start, jobs: jobs.slice(start, end).map(stripTag) });
      };
      worker.on('message', (msg) => {
        if (msg.error) { reject(new Error(msg.error)); return; }
        msg.results.forEach((r, k) => finish(msg.start + k, r));
        feed();
      });
      worker.on('error', reject);
      worker.on('exit', () => { if (--alive === 0) resolve(); });
      feed();
    }
  });
  return results;
}

function stripTag(j) { const { tag, ...rest } = j; return rest; }
