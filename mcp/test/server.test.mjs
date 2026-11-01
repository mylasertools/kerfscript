// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createKerfScriptServer, registerKerfScriptTools } from '../dist/tools.js';
import { execute } from '../dist/execute.js';
import { isolatedExecute } from '../dist/isolated.js';
import worker from '../dist/worker.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const env = {
  ALLOWED_ORIGINS: 'https://kerfscript.mylasertools.com',
  REQUEST_LIMIT: { limit: async () => ({ success: true }) },
};
const clientInfo = { name: 'kerfscript-tests', version: '1.0.0' };
async function connected(t, server = createKerfScriptServer(async (job) => execute(job))) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client(clientInfo);
  await server.connect(b);
  await client.connect(a);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  return client;
}
const call = (client, name, args = {}) => client.callTool({ name, arguments: args });

test('shared registration works on an existing host; docs and examples are retrievable', async (t) => {
  const server = new McpServer({ name: 'mylasertools-test', version: '1.0.0' });
  registerKerfScriptTools(server, async (job) => execute(job));
  const client = await connected(t, server);
  assert.equal((await client.listTools()).tools.length, 4);
  const index = (await call(client, 'kerfscript_docs')).structuredContent;
  assert.ok(index.topics.includes('javascript'));
  const reference = (await call(client, 'kerfscript_docs', { topic: 'reference' }))
    .structuredContent;
  assert.equal(reference.nextOffset, 12000);
  assert.match(reference.text, /KerfScript/);
  assert.equal((await call(client, 'kerfscript_docs', { topic: '__proto__' })).isError, true);
  const found = (await call(client, 'kerfscript_examples', { query: 'box' })).structuredContent;
  assert.ok(found.examples.some((e) => e.id === 'box'));
  assert.match(
    (await call(client, 'kerfscript_examples', { id: 'box' })).structuredContent.source,
    /kerf\/box/,
  );
});

test('parameters, overrides, SVG, DXF, font and virtual imports work through MCP', async (t) => {
  const client = await connected(t);
  const source = 'width = 40; // [10:5:100]\nrect([width,20]);';
  const settings = (await call(client, 'kerfscript_parameters', { source })).structuredContent;
  assert.equal(settings.parameters[0].name, 'width');
  const result = (await call(client, 'kerfscript_render', { source, params: { width: 70 } }))
    .structuredContent;
  assert.equal(result.parts[0].width, 70);
  assert.match(result.files[0].text, /<svg/);
  const dxf = (await call(client, 'kerfscript_render', { source, format: 'dxf' }))
    .structuredContent;
  assert.match(dxf.files[0].text, /SECTION/);
  assert.equal(
    (await call(client, 'kerfscript_render', { source: 'text("Kerf");' })).structuredContent.ok,
    true,
  );
  assert.equal(
    (
      await call(client, 'kerfscript_render', {
        source: 'use <test>\nshape();',
        libraries: { test: 'module shape() rect(10);' },
      })
    ).structuredContent.ok,
    true,
  );
});

test('errors are actionable and callers cannot raise limits or fetch files', async (t) => {
  const client = await connected(t);
  const bad = await call(client, 'kerfscript_render', { source: 'rect([;' });
  assert.equal(bad.isError, true);
  assert.equal(bad.structuredContent.error.line, 1);
  for (const args of [
    { source: 'rect(1);', maxSteps: 1e9 },
    { source: ' '.repeat(64001) },
    { source: 'rect(1);', sheet: [-1, 20] },
  ])
    assert.equal((await call(client, 'kerfscript_render', args)).isError, true);
  for (const source of [
    'use <https://example.com/library>\nfoo();',
    'part("many", qty=101) rect(1);',
    'function f(x)=f(x+1); rect(f(0));',
  ])
    assert.equal((await call(client, 'kerfscript_render', { source })).isError, true);
});

test('HTTP SDK client initializes and renders across independent stateless requests', async (t) => {
  const client = new Client(clientInfo);
  const transport = new StreamableHTTPClientTransport(new URL('https://mcp.example/mcp'), {
    fetch: async (url, init) => {
      const request = new Request(url, init);
      request.headers.set('CF-Connecting-IP', '192.0.2.1');
      return worker.fetch(request, env);
    },
  });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 4);
  assert.equal(
    (await call(client, 'kerfscript_render', { source: 'rect(10);' })).structuredContent.ok,
    true,
  );
});

test('HTTP rejects origins, oversized bodies, malformed JSON and rate-limited requests', async () => {
  const request = (body, headers = {}) =>
    new Request('https://mcp.example/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '192.0.2.1',
        Accept: 'application/json, text/event-stream',
        ...headers,
      },
      body,
    });
  assert.equal(
    (await worker.fetch(request('{}', { Origin: 'https://evil.example' }), env)).status,
    403,
  );
  assert.equal((await worker.fetch(request(' '.repeat(256001)), env)).status, 413);
  assert.equal((await worker.fetch(request('{'), env)).status, 400);
  assert.equal(
    (
      await worker.fetch(request('{}'), {
        ...env,
        REQUEST_LIMIT: { limit: async () => ({ success: false }) },
      })
    ).status,
    429,
  );
  assert.equal((await worker.fetch(new Request('https://mcp.example/mcp'), env)).status, 405);
  const preflight = await worker.fetch(
    new Request('https://mcp.example/mcp', {
      method: 'OPTIONS',
      headers: { Origin: 'https://kerfscript.mylasertools.com' },
    }),
    env,
  );
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get('Access-Control-Allow-Origin'),
    'https://kerfscript.mylasertools.com',
  );
});

test('local executor supports cancellation and returns isolated render output', async () => {
  const input = { source: 'rect(10);', format: 'svg', layout: 'pack' };
  const result = await isolatedExecute({ operation: 'render', input });
  assert.equal(result.ok, true);
  const controller = new AbortController();
  const pending = isolatedExecute({ operation: 'render', input }, controller.signal);
  controller.abort();
  assert.equal((await pending).error.message, 'Cancelled.');
});

test('stdio executable interoperates with official SDK client', async (t) => {
  const client = new Client(clientInfo);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/stdio.js'],
    stderr: 'pipe',
  });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal(
    (await call(client, 'kerfscript_render', { source: 'rect(15);' })).structuredContent.parts[0]
      .width,
    15,
  );
});
