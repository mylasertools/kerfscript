// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// A triage of a verification result: what did not pass, grouped by
// status and reason, with the bodies involved and what was measured, so a
// dense model's few repairable failures stand out from its unresolved
// contacts. The statuses themselves are unchanged.

import type { BodyRef, ClaimResult, VerificationResult } from './types.js';

export interface TriageGroup {
  status: string;
  code: string;
  message: string;
  claims: {
    id: string;
    configurations: string[];
    bodies: string[];
    measurements: ClaimResult['measurements'];
  }[];
}

const body = (r: BodyRef) =>
  'hardware' in r
    ? `hardware ${r.hardware}`
    : `${r.part}${r.copy && r.copy > 1 ? ` (copy ${r.copy})` : ''}`;

/** Every claim that did not pass, grouped by status and code: failures
 * first, then unverified. */
export function triage(result: VerificationResult): TriageGroup[] {
  if (result.kind !== 'report') return [];
  const groups = new Map<string, TriageGroup>();
  for (const c of result.report.claims) {
    if (c.status === 'pass') continue;
    const key = `${c.status}\u0000${c.code}`;
    const g = groups.get(key) ?? { status: c.status, code: c.code, message: c.message, claims: [] };
    g.claims.push({
      id: c.id,
      configurations: c.configurations,
      bodies: c.entities.map(body),
      measurements: c.measurements,
    });
    groups.set(key, g);
  }
  const order = (s: string) => (s === 'fail' ? 0 : 1);
  return [...groups.values()].sort(
    (a, b) => order(a.status) - order(b.status) || b.claims.length - a.claims.length,
  );
}

/** The triage as lines of text */
export function triageText(result: VerificationResult): string {
  if (result.kind !== 'report')
    return `${result.kind}: ${result.issues.map((i) => i.message).join('; ')}\n`;
  const groups = triage(result);
  if (!groups.length) return `All ${result.report.claims.length} claims pass.\n`;
  const fmt = (v: number | [number, number]) =>
    Array.isArray(v) ? `${+v[0].toFixed(3)}..${+v[1].toFixed(3)}` : `${+v.toFixed(3)}`;
  const out: string[] = [];
  for (const g of groups) {
    out.push(`${g.status} ${g.code} (${g.claims.length}): ${g.message}`);
    for (const c of g.claims) {
      const m = Object.entries(c.measurements)
        .slice(0, 4)
        .map(([k, v]) => `${k} ${fmt(v)}`)
        .join(', ');
      out.push(
        `  ${c.id}${c.configurations.length ? ` [${c.configurations.join(', ')}]` : ''}${c.bodies.length ? `: ${c.bodies.join(' / ')}` : ''}${m ? `; ${m}` : ''}`,
      );
    }
  }
  return out.join('\n') + '\n';
}
