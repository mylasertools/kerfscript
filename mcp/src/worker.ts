// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { readRequestBody } from '@modelcontextprotocol/sdk/server/requestBody.js';
import { createKerfScriptServer } from './tools.js';
import { execute } from './execute.js';
import { secondsToMidnight, type Pool, type Spend } from './budget.js';
import { version } from '../package.json';

const MAX_BODY = 256000;

const jsonRpcError = (status: number, code: number, message: string, headers: Headers) => {
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }), {
    status,
    headers,
  });
};

/**
 * The address a public client is limited by. One IPv6 subscriber usually holds a
 * whole /64, so its addresses share one allowance. An IPv4 address written as
 * IPv6 counts as that IPv4 address.
 */
export function clientAddress(ip: string) {
  if (!ip.includes(':')) return ip;
  const ipv4 = ip.match(/:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4) return ipv4[1];
  const [head = '', tail] = ip.toLowerCase().split('::');
  const groups = (s = '') => (s ? s.split(':') : []);
  const front = groups(head);
  const full =
    tail === undefined
      ? front
      : [...front, ...Array(8 - front.length - groups(tail).length).fill('0'), ...groups(tail)];
  return `${full
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(':')}::/64`;
}

// Public clients and service callers have separate budgets, so public traffic
// cannot spend the allowance of signed-in MyLaserTools users. Errors refuse the
// request: an unreachable budget must not lift the cap.
async function charge(env: Env, pool: Pool, client: string): Promise<Spend> {
  try {
    return await env.DAILY_BUDGET.get(env.DAILY_BUDGET.idFromName(pool)).spend(pool, client);
  } catch {
    return 'total';
  }
}

export async function handleRequest(request: Request, env: Env, caller?: string) {
  const url = new URL(request.url);
  if (url.pathname === '/health') return Response.json({ name: 'kerfscript-mcp', version });
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
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
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
  const ip = request.headers.get('CF-Connecting-IP');
  if (caller !== undefined && (!caller.trim() || caller.length > 200))
    return new Response('A stable caller identity is required.', { status: 400 });
  if (caller === undefined && !ip)
    return new Response('Missing client IP. Service bindings must use fetchForCaller.', {
      status: 400,
    });
  const key = caller !== undefined ? `caller:${caller}` : `ip:${clientAddress(ip!)}`;
  if (!(await env.REQUEST_LIMIT.limit({ key })).success) {
    headers.set('Retry-After', '60');
    return new Response('Rate limit exceeded. Retry in one minute.', { status: 429, headers });
  }

  const body = await readRequestBody(request, MAX_BODY);
  if (body.tooLarge)
    return jsonRpcError(413, -32000, `Request body must not exceed ${MAX_BODY} bytes.`, headers);
  let message: unknown;
  try {
    message = JSON.parse(body.text);
  } catch {
    return jsonRpcError(400, -32700, 'Parse error: Invalid JSON', headers);
  }
  // A batch would run up to 100 tool calls for one rate-limited request.
  if (Array.isArray(message))
    return jsonRpcError(
      400,
      -32600,
      'Batches are not supported. Send one message per request.',
      headers,
    );

  const spent = await charge(env, caller !== undefined ? 'service' : 'public', key);
  if (spent !== 'ok') {
    headers.set('Retry-After', String(secondsToMidnight()));
    return spent === 'client'
      ? new Response('Daily limit for this client reached. Retry after midnight UTC.', {
          status: 429,
          headers,
        })
      : new Response('The service has reached its daily limit. Retry after midnight UTC.', {
          status: 503,
          headers,
        });
  }

  const server = createKerfScriptServer(async (job) => execute(job));
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_BODY,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody: message });
    for (const [key, value] of headers) response.headers.set(key, value);
    return response;
  } finally {
    await server.close();
  }
}
export default {
  fetch: (request, env) => handleRequest(request, env),
} satisfies ExportedHandler<Env>;
