// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reply, page } from '../dist/replies.js';
import { execute } from '../dist/execute.js';
import { createExecutorPool } from '../dist/isolated.js';
import worker, { handleRequest } from '../dist/worker.js';
import { createKerfScriptServer } from '../dist/tools.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const job = (source) => ({ operation: 'parameters', source });
const workerUrl = new URL('./fixtures/pool-worker.mjs', import.meta.url);

test('final envelopes bound success, errors, Unicode and escaped JSON', () => {
  for (const result of [
    { ok: true, text: 'x'.repeat(990000) },
    { ok: false, error: { echoes: ['😀'.repeat(300000)] } },
    { topic: 'reference', text: '\\"'.repeat(200000) },
  ]) {
    const response = reply(result);
    assert.equal(response.isError, true);
    assert.ok(bytes(response) <= 1000000);
  }
  const small = { ok: true, text: 'hello' };
  assert.deepEqual(reply(small).structuredContent, small);
});

test('a real echo-heavy failing program cannot produce an oversized tool reply', () => {
  const source = `s="${'😀'.repeat(4000)}"; for(i=[1:200]) echo(s); assert(false,"failed");`;
  const result = execute({ operation: 'render', input: { source, format: 'svg', layout: 'pack' } });
  assert.equal(result.ok, false);
  assert.ok(bytes(result) > 1000000, 'fixture must exercise a large failure');
  assert.ok(bytes(reply(result)) <= 1000000);
});

test('diagnostics retain virtual-library source, trace and built-in signature', () => {
  const result = execute({
    operation: 'render',
    input: {
      source: 'use <panel>\nshape();',
      libraries: { panel: 'module shape() rect("bad");' },
      format: 'svg',
      layout: 'pack',
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error.diagnostic, /rect\("bad"\)/);
  assert.match(result.error.diagnostic, /in module shape/);
  assert.match(result.error.diagnostic, /rect\(size/);
});

test('docs paging preserves supplementary characters and explicit split offsets', () => {
  const text = 'a'.repeat(11999) + '😀' + 'b'.repeat(12000) + '𐐀';
  let reconstructed = '',
    offset = 0;
  do {
    const p = page(text, offset);
    reconstructed += p.text;
    offset = p.nextOffset;
  } while (offset !== null);
  assert.equal(reconstructed, text);
  assert.equal(page(text, 12000).text.startsWith('😀'), true);
});

test('service callers have separate allowances and public headers cannot select them', async () => {
  const keys = [];
  const env = {
    ALLOWED_ORIGINS: '',
    REQUEST_LIMIT: {
      limit: async ({ key }) => {
        keys.push(key);
        return { success: false };
      },
    },
  };
  const request = (headers) =>
    new Request('https://example.com/mcp', { method: 'POST', headers, body: '{}' });
  assert.equal((await worker.fetch(request({ 'X-Caller-Id': 'someone' }), env)).status, 400);
  assert.deepEqual(keys, []);
  for (const caller of ['user-a', 'user-b'])
    assert.equal((await handleRequest(request(), env, caller)).status, 429);
  assert.equal(
    (await worker.fetch(request({ 'CF-Connecting-IP': '192.0.2.1', 'X-Caller-Id': 'user-a' }), env))
      .status,
    429,
  );
  assert.deepEqual(keys, ['caller:user-a', 'caller:user-b', 'ip:192.0.2.1']);
  assert.equal((await handleRequest(request(), env, '')).status, 400);
});

test('MCP and health versions match package metadata', async (t) => {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(
    (await (await worker.fetch(new Request('https://example.com/health'), {})).json()).version,
    version,
  );
  const server = createKerfScriptServer(async () => ({ ok: true }));
  const client = new Client({ name: 'version-check', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(b);
  await client.connect(a);
  assert.equal(client.getServerVersion().version, version);
});

test('three parallel jobs queue and reuse warm workers', async (t) => {
  const pool = createExecutorPool({ size: 2, workerUrl });
  t.after(() => pool.close());
  const results = await Promise.all([
    pool.execute(job('slow')),
    pool.execute(job('slow')),
    pool.execute(job('fast')),
  ]);
  assert.ok(results.every((r) => r.ok));
  assert.equal(new Set(results.map((r) => r.threadId)).size, 2);
});

test('queue is bounded, queued cancellation frees capacity, and separate pools do not block each other', async (t) => {
  const pool = createExecutorPool({ size: 1, maxQueue: 1, workerUrl });
  const other = createExecutorPool({ size: 1, workerUrl });
  t.after(async () => {
    await pool.close();
    await other.close();
  });
  const first = pool.execute(job('slow'));
  const controller = new AbortController();
  const second = pool.execute(job('fast'), controller.signal);
  assert.match((await pool.execute(job('fast'))).error.message, /queue is full/);
  controller.abort();
  assert.match((await second).error.message, /Cancelled/);
  assert.equal((await other.execute(job('fast'))).ok, true);
  const next = pool.execute(job('fast'));
  assert.equal((await first).ok, true);
  assert.equal((await next).ok, true);
});

test('execution timeout and crashes replace workers; queue deadlines and shutdown settle callers', async (t) => {
  const pool = createExecutorPool({ size: 1, timeoutMs: 80, queueTimeoutMs: 30, workerUrl });
  t.after(() => pool.close());
  const hanging = pool.execute(job('hang'));
  const waiting = pool.execute(job('fast'));
  assert.match((await waiting).error.message, /queue wait timed out/);
  assert.match((await hanging).error.message, /execution deadline/);
  assert.equal((await pool.execute(job('fast'))).ok, true);
  assert.equal((await pool.execute(job('crash'))).ok, false);
  assert.equal((await pool.execute(job('fast'))).ok, true);
  const active = pool.execute(job('hang'));
  const queued = pool.execute(job('fast'));
  await pool.close();
  assert.equal((await active).ok, false);
  assert.equal((await queued).ok, false);
});
