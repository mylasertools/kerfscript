// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Public clients, or callers signed in through a service binding.
export type Pool = 'public' | 'service';

// 'client' means this client's daily allowance is spent, 'total' the service's.
export type Spend = 'ok' | 'client' | 'total';

// The parts of Durable Object storage the daily count uses.
export interface BudgetStorage {
  get<T>(keys: string[]): Promise<Map<string, T>>;
  put<T>(entries: Record<string, T>): Promise<void>;
  deleteAll(): Promise<void>;
}

const DAY = 86_400_000;
export const secondsToMidnight = (now = Date.now()) => Math.ceil((DAY - (now % DAY)) / 1000);

/**
 * Counts one request against a client's and the service's allowance for the UTC
 * day. A Durable Object runs this one request at a time. Limits that are not
 * numbers refuse every request, so a configuration mistake cannot remove the cap.
 */
export async function spend(
  storage: BudgetStorage,
  client: string,
  clientLimit: number,
  totalLimit: number,
  now = Date.now(),
): Promise<Spend> {
  const day = new Date(now).toISOString().slice(0, 10);
  const key = `client:${client}`;
  const stored = await storage.get<string | number>(['day', 'total', key]);
  if (stored.get('day') !== day) {
    await storage.deleteAll();
    stored.clear();
  }
  const total = Number(stored.get('total') ?? 0);
  const used = Number(stored.get(key) ?? 0);
  if (!(total < totalLimit)) return 'total';
  if (!(used < clientLimit)) return 'client';
  await storage.put({ day, total: total + 1, [key]: used + 1 });
  return 'ok';
}
