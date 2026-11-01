// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import { WorkerEntrypoint } from 'cloudflare:workers';
import { handleRequest } from './worker.js';
export { default } from './worker.js';

// Only service bindings can invoke this method. Public request headers cannot
// select a caller identity or bypass the IP-based allowance.
export class KerfScriptService extends WorkerEntrypoint<Env> {
  fetchForCaller(request: Request, caller: string) {
    if (typeof caller !== 'string' || !caller.trim())
      return new Response('A stable caller identity is required.', { status: 400 });
    return handleRequest(request, this.env, caller);
  }
}
