// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { handleRequest } from './worker.js';
import { spend, type Pool } from './budget.js';
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

// One instance per pool counts every request of the UTC day, so the daily caps
// hold across all Cloudflare locations.
export class DailyBudget extends DurableObject<Env> {
  spend(pool: Pool, client: string) {
    return spend(
      this.ctx.storage,
      client,
      Number(this.env.DAILY_CLIENT_LIMIT),
      Number(
        pool === 'service' ? this.env.SERVICE_DAILY_REQUEST_LIMIT : this.env.DAILY_REQUEST_LIMIT,
      ),
    );
  }
}
