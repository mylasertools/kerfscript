// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import { Worker } from 'node:worker_threads';
import type { Executor, Job, Result } from './schema.js';
interface Pending {
  job: Job;
  resolve: (result: Result) => void;
  signal?: AbortSignal;
  cancel: () => void;
  timer?: ReturnType<typeof setTimeout>;
}
interface Slot {
  worker: Worker;
  ready: boolean;
  retiring: boolean;
  item?: Pending;
  startup?: ReturnType<typeof setTimeout>;
}
const failure = (message: string): Result => ({ ok: false, error: { message } });

/** Create a pool per host or tenant. Idle workers do not keep Node running. */
export function createExecutorPool({
  size = 2,
  maxQueue = 16,
  timeoutMs = 5000,
  queueTimeoutMs = 5000,
  startupTimeoutMs = 5000,
  workerUrl = new URL('./runner.js', import.meta.url),
} = {}) {
  for (const n of [size, maxQueue, timeoutMs, queueTimeoutMs, startupTimeoutMs])
    if (!Number.isSafeInteger(n) || n < 1)
      throw new Error('Pool limits must be positive integers.');
  const slots = new Set<Slot>();
  const queue: Pending[] = [];
  const terminations = new Set<Promise<void>>();
  let closed = false;
  function finish(item: Pending, result: Result) {
    clearTimeout(item.timer);
    item.signal?.removeEventListener('abort', item.cancel);
    item.resolve(result);
  }
  function retire(slot: Slot, message: string) {
    if (slot.retiring) return;
    slot.retiring = true;
    clearTimeout(slot.startup);
    if (slot.item) {
      finish(slot.item, failure(message));
      slot.item = undefined;
    }
    const done = () => {
      slots.delete(slot);
      terminations.delete(stopped);
      pump();
    };
    const stopped = slot.worker.terminate().then(done, done);
    terminations.add(stopped);
  }
  function start(slot: Slot) {
    const item = slot.item;
    if (!slot.ready || !item || slot.retiring) return;
    clearTimeout(item.timer);
    item.timer = setTimeout(
      () =>
        retire(
          slot,
          'Rendering exceeded its execution deadline. Reduce complexity or render locally.',
        ),
      timeoutMs,
    );
    try {
      slot.worker.postMessage(item.job);
    } catch {
      retire(slot, 'Unable to send the job to the renderer.');
    }
  }
  function spawn(): Slot {
    const worker = new Worker(workerUrl, {
      resourceLimits: { maxOldGenerationSizeMb: 96, stackSizeMb: 4 },
    });
    const slot: Slot = { worker, ready: false, retiring: false };
    slots.add(slot);
    slot.startup = setTimeout(() => retire(slot, 'Renderer startup timed out.'), startupTimeoutMs);
    worker.on('message', (result: Result) => {
      if (slot.retiring) return;
      if (!slot.ready) {
        if (result.ready !== true) {
          retire(slot, 'Invalid renderer startup response.');
          return;
        }
        slot.ready = true;
        clearTimeout(slot.startup);
        start(slot);
        return;
      }
      if (!slot.item) {
        retire(slot, 'Unexpected renderer response.');
        return;
      }
      finish(slot.item, result);
      slot.item = undefined;
      worker.unref();
      pump();
    });
    worker.on('error', () => retire(slot, 'Renderer exceeded its resources or failed.'));
    worker.on('exit', () => retire(slot, 'Renderer stopped before returning a result.'));
    return slot;
  }
  function pump() {
    while (!closed && queue.length) {
      let slot = [...slots].find((s) => !s.retiring && !s.item);
      if (!slot && slots.size >= size) return;
      const item = queue.shift()!;
      try {
        slot ??= spawn();
      } catch {
        finish(item, failure('Unable to start renderer.'));
        continue;
      }
      clearTimeout(item.timer);
      slot.item = item;
      slot.worker.ref();
      start(slot);
    }
  }
  const execute: Executor = (job, signal) => {
    if (closed) return Promise.resolve(failure('Renderer pool is closed.'));
    if (signal?.aborted) return Promise.resolve(failure('Cancelled.'));
    if (queue.length >= maxQueue)
      return Promise.resolve(failure('Renderer queue is full. Retry later.'));
    return new Promise((resolve) => {
      const item: Pending = {
        job,
        resolve,
        signal,
        cancel: () => {
          const index = queue.indexOf(item);
          if (index >= 0) {
            queue.splice(index, 1);
            finish(item, failure('Cancelled.'));
          } else {
            const slot = [...slots].find((s) => s.item === item);
            if (slot) retire(slot, 'Cancelled.');
          }
        },
      };
      item.timer = setTimeout(() => {
        const index = queue.indexOf(item);
        if (index >= 0) {
          queue.splice(index, 1);
          finish(item, failure('Renderer queue wait timed out. Retry later.'));
        }
      }, queueTimeoutMs);
      signal?.addEventListener('abort', item.cancel, { once: true });
      queue.push(item);
      pump();
    });
  };
  return {
    execute,
    async close() {
      closed = true;
      for (const item of queue.splice(0)) finish(item, failure('Renderer pool is closed.'));
      for (const slot of slots) retire(slot, 'Renderer pool is closed.');
      await Promise.all(terminations);
    },
  };
}
export const isolatedExecute = createExecutorPool().execute;
