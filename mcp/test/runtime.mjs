// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
// Run against wrangler dev or a deployed staging URL; never publishes anything.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const url = process.argv[2];
if (!url) throw new Error('Usage: node test/runtime.mjs <http(s)://host/mcp>');
const client = new Client({ name: 'kerfscript-runtime-check', version: '1.0.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  assert.equal((await client.listTools()).tools.length, 4);
  const result = await client.callTool({
    name: 'kerfscript_render',
    arguments: { source: 'text("Kerf");' },
  });
  assert.equal(result.structuredContent.ok, true);
  assert.match(result.structuredContent.files[0].text, /<svg/);
  console.log('MCP initialize, tool discovery and font rendering passed.');
} finally {
  await client.close();
}
