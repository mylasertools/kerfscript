// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import type { BodyRef, PartRef, VerificationSnapshot } from './types.js';

export interface FixedPair {
  a: BodyRef;
  b: BodyRef;
  faceA?: 'top' | 'bottom';
  faceB?: 'top' | 'bottom';
}
export function nativeFixedPairs(s: VerificationSnapshot): FixedPair[] {
  if (!s.relationsKnown) throw new Error('Native glue/stack relation metadata is unavailable.');
  const out: FixedPair[] = [];
  for (const p of s.parts) {
    const self: PartRef = { part: p.name, copy: p.copy },
      n = p.stack ?? 1;
    if (p.on) throw new Error('Bend-rider joints require a resolved rigid-run attachment model.');
    if (n > 1 && (p.copy - 1) % n !== 0)
      out.push({ a: { part: p.name, copy: p.copy - 1 }, b: self, faceA: 'top', faceB: 'bottom' });
    else if (p.glue)
      out.push({
        a: p.glue,
        b: self,
        faceA: p.glueFace ?? 'top',
        faceB: p.glueFace === 'bottom' ? 'top' : 'bottom',
      });
  }
  return out;
}
