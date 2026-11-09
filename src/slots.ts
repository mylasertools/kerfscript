// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Slots from the assembly: where another part's tabs pass through a
// part, cut holes in it the shape of their cross-section, at any angle.

import { invert, multiply } from './assembly.js';
import { area, intersection, offset, pieces, union, type Poly } from './geometry.js';

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
  // EPS inside each face decides whether the part goes through at all, so
  // parts that only touch cut nothing; the slot itself is the whole
  // thickness, so a shoulder that flares at the face is cut too
  const at0 = (e: number) => (-R[11] - Math.max(R[10] * w0, R[10] * w1) + e) / n;
  const at1 = (e: number) => (target.thickness - R[11] - Math.min(R[10] * w0, R[10] * w1) - e) / n;
  if (!(at1(EPS) > at0(EPS))) return [];
  const [nx, ny] = [a / n, b / n];
  const [tx, ty] = [-ny, nx];
  const bandOf = (lo: number, hi: number): Poly => [
    [nx * lo - tx * BIG, ny * lo - ty * BIG],
    [nx * hi - tx * BIG, ny * hi - ty * BIG],
    [nx * hi + tx * BIG, ny * hi + ty * BIG],
    [nx * lo + tx * BIG, ny * lo + ty * BIG],
  ];
  // A tab reaches 1 mm in, or half way through a thinner part; one that only
  // dips into the slab is misplaced, and is left for the collision check
  // to report. A blind tab still cuts its slot through
  let zLo = Infinity,
    zHi = -Infinity;
  for (const ring of other.outline)
    for (const [u, v] of ring)
      for (const w of [w0, w1]) {
        const z = R[8] * u + R[9] * v + R[10] * w + R[11];
        if (z < zLo) zLo = z;
        if (z > zHi) zHi = z;
      }
  if (Math.min(target.thickness, zHi) - Math.max(0, zLo) < Math.min(1, target.thickness / 2))
    return [];
  const inBand = (lo: number, hi: number) =>
    intersection(other.outline, [ccw(bandOf(lo, hi))]).filter((p) => Math.abs(area(p)) > 1e-6);
  const deep = inBand(at0(EPS), at1(EPS));
  if (!deep.length) return [];
  // The slot spans the whole slab, but only across from what goes deeper than
  // EPS: an edge lying on a face (a gable wall's top under its roof, which
  // rounding can put a hair inside) is touching, not a slot along the
  // contact, while a shoulder flaring at the face beside a tab is cut
  const L = Math.abs(at1(0) - at0(0)) + 1;
  const across = (p: Poly): Poly[] => {
    const lo = p.map(([u, v]): [number, number] => [u - nx * L, v - ny * L]);
    const hi = p.map(([u, v]): [number, number] => [u + nx * L, v + ny * L]);
    const out: Poly[] = [ccw(lo), ccw(hi)];
    for (let i = 0; i < p.length; i++) {
      const j = (i + 1) % p.length;
      const quad: Poly = [lo[i], lo[j], hi[j], hi[i]];
      if (Math.abs(area(quad)) > 1e-12) out.push(ccw(quad));
    }
    return out;
  };
  const columns = union(deep.flatMap(across), 'nonzero');
  const pieces = intersection(inBand(at0(0), at1(0)), columns).filter(
    (p) => Math.abs(area(p)) > 1e-6,
  );
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
  // Only what passes through the part's material makes a slot: a part that
  // touches its edge from outside leaves no notch
  const inside = pieces(intersection(union(all), target.outline)).filter(
    (g) => g.reduce((a, r) => a + area(r), 0) > 1e-4,
  );
  if (!inside.length) return [];
  return offset(inside.flat(), clearance / 2, 'miter');
}
