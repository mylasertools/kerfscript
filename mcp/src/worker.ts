// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createKerfScriptServer } from './tools.js';
import { execute } from './execute.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health')
      return Response.json({ name: 'kerfscript-mcp', version: '0.1.0' });
    if (url.pathname !== '/mcp') return new Response('Not found', { status: 404 });
    const origin = request.headers.get('Origin');
    const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
    if (origin && !allowed.includes(origin))
      return new Response('Origin not allowed', { status: 403 });
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Origin',
    });
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
      headers.set(
        'Access-Control-Allow-Headers',
        'Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id',
      );
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') {
      headers.set('Allow', 'POST, OPTIONS');
      return new Response('This stateless endpoint accepts POST requests.', {
        status: 405,
        headers,
      });
    }
    // This public endpoint has no user accounts. Shared proxies share an allowance.
    const key = request.headers.get('CF-Connecting-IP') || 'local';
    if (!(await env.REQUEST_LIMIT.limit({ key })).success)
      return new Response('Rate limit exceeded. Retry in one minute.', {
        status: 429,
        headers: { ...Object.fromEntries(headers), 'Retry-After': '60' },
      });
    const server = createKerfScriptServer(async (job) => execute(job));
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: 256000,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      for (const [key, value] of headers) response.headers.set(key, value);
      return response;
    } finally {
      await server.close();
    }
  },
} satisfies ExportedHandler<Env>;
