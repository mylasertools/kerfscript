// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Slots from the assembly: where another part's tabs pass through a
// part, cut holes in it the shape of their cross-section, at any angle.

import { invert, multiply } from './assembly.js';
import { area, intersection, offset, union, type Poly } from './geometry.js';

export interface Solid {
  matrix: number[];
  thickness: number;
  outline: Poly[];
}

const BIG = 1e6;
// Parts that only touch, as a wall standing on a shelf, cut nothing
const EPS = 0.01;

const ccw = (p: Poly): Poly => (area(p) < 0 ? [...p].reverse() : p);

// The cross-section of `other` through the slab of `target`, in the
// target's own coordinates
export function crossSection(target: Solid, other: Solid): Poly[] {
  const R = multiply(invert(target.matrix), other.matrix);
  const [a, b] = [R[8], R[9]];
  const n = Math.hypot(a, b);
  // Parallel parts meet face to face: nothing goes through
  if (n < 1e-9) return [];
  const w0 = 0,
    w1 = other.thickness;
  const lo = (-R[11] - Math.max(R[10] * w0, R[10] * w1) + EPS) / n;
  const hi = (target.thickness - R[11] - Math.min(R[10] * w0, R[10] * w1) - EPS) / n;
  if (!(hi > lo)) return [];
  const [nx, ny] = [a / n, b / n];
  const [tx, ty] = [-ny, nx];
  const band: Poly = [
    [nx * lo - tx * BIG, ny * lo - ty * BIG],
    [nx * hi - tx * BIG, ny * hi - ty * BIG],
    [nx * hi + tx * BIG, ny * hi + ty * BIG],
    [nx * lo + tx * BIG, ny * lo + ty * BIG],
  ];
  const pieces = intersection(other.outline, [ccw(band)]).filter((p) => Math.abs(area(p)) > 1e-6);
  if (!pieces.length) return [];
  const at =
    (w: number) =>
    ([u, v]: [number, number]): [number, number] => [
      R[0] * u + R[1] * v + R[2] * w + R[3],
      R[4] * u + R[5] * v + R[6] * w + R[7],
    ];
  const flips = R[0] * R[5] - R[1] * R[4] < 0;
  const faces = (w: number) =>
    pieces.map((p) => {
      const q = p.map(at(w));
      return flips ? q.reverse() : q;
    });
  // The prism's sides as it sweeps through its thickness
  const sides: Poly[] = [];
  for (const p of pieces)
    for (let i = 0; i < p.length; i++) {
      const u = p[i],
        v = p[(i + 1) % p.length];
      const quad: Poly = [at(w0)(u), at(w0)(v), at(w1)(v), at(w1)(u)];
      if (Math.abs(area(quad)) > 1e-9) sides.push(ccw(quad));
    }
  return union([...faces(w0), ...faces(w1), ...sides], 'nonzero');
}

// Slots in `target` for every solid in `others`, `clearance` wider all
// round in total
export function slotsFor(target: Solid, others: Solid[], clearance: number): Poly[] {
  const all: Poly[] = [];
  for (const o of others) for (const p of crossSection(target, o)) all.push(p);
  if (!all.length) return [];
  return offset(union(all), clearance / 2, 'miter');
}
