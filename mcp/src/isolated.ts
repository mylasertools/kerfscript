// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import { Worker } from 'node:worker_threads';
import type { Executor, Result } from './schema.js';
let active = 0;
export const isolatedExecute: Executor = (job, signal) => {
  if (active >= 2)
    return Promise.resolve({
      ok: false,
      error: { message: 'Renderer busy. Retry after the current render finishes.' },
    });
  if (signal?.aborted) return Promise.resolve({ ok: false, error: { message: 'Cancelled.' } });
  active++;
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./runner.js', import.meta.url), {
        workerData: job,
        resourceLimits: { maxOldGenerationSizeMb: 96, stackSizeMb: 4 },
      });
    } catch {
      active--;
      resolve({ ok: false, error: { message: 'Unable to start renderer.' } });
      return;
    }
    let finished = false;
    const finish = (result: Result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      const stopped = () => {
        active--;
        resolve(result);
      };
      void worker.terminate().then(stopped, stopped);
    };
    const fail = (message: string) => finish({ ok: false, error: { message } });
    const cancel = () => fail('Cancelled.');
    const timer = setTimeout(
      () => fail('Rendering exceeded the 5 second limit. Reduce complexity or render locally.'),
      5000,
    );
    signal?.addEventListener('abort', cancel, { once: true });
    worker.once('message', finish);
    worker.once('error', () => fail('Renderer exceeded its resources or failed.'));
    worker.once('exit', () => fail('Renderer stopped before returning a result.'));
  });
};
