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
  // Each piece that enters the slab is judged on its own depth, so a deep
  // tab elsewhere on the part does not make a shallow one a slot
  const reach = (ps: Poly[]) => {
    let [lo, hi] = [Infinity, -Infinity];
    for (const ring of ps)
      for (const [u, v] of ring)
        for (const w of [w0, w1]) {
          const z = R[8] * u + R[9] * v + R[10] * w + R[11];
          lo = Math.min(lo, z);
          hi = Math.max(hi, z);
        }
    return Math.min(target.thickness, hi) - Math.max(0, lo);
  };
  const deep = pieces(inBand(at0(EPS), at1(EPS)))
    .filter((g) => reach(g) >= Math.min(1, target.thickness / 2) - 2 * EPS)
    .flat();
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
  // The part of `other` that goes through, across from what goes deep
  const outline = intersection(other.outline, columns).filter((p) => Math.abs(area(p)) > 1e-6);
  if (!outline.length) return [];
  // The slot is what the slab and the other part have in common, seen from
  // above: the union of the shadows of that solid's faces. Depth into the
  // slab is z = n * s + R[10] * w + R[11], s along (nx, ny) in the other
  // part's plane and w through its thickness.
  const at =
    (w: number) =>
    ([u, v]: [number, number]): [number, number] => [
      R[0] * u + R[1] * v + R[2] * w + R[3],
      R[4] * u + R[5] * v + R[6] * w + R[7],
    ];
  const T = target.thickness;
  const sAt = (z: number, w: number) => (z - R[11] - R[10] * w) / n;
  const shadows: Poly[] = [];
  const add = (q: [number, number][]) => {
    if (q.length >= 3 && Math.abs(area(q)) > 1e-9) shadows.push(ccw(q));
  };
  // The other part's two faces, each within the slab
  for (const w of [w0, w1])
    for (const p of intersection(outline, [ccw(bandOf(sAt(0, w), sAt(T, w)))])) add(p.map(at(w)));
  // The slab's two faces where they cut through the other part. Leaning
  // through it, each cuts a region; square to it, each cuts the outline along
  // a line, whose pieces sweep through the part's thickness
  for (const z of [0, T]) {
    if (Math.abs(R[10]) > 1e-9) {
      const [a0, a1] = [sAt(z, w0), sAt(z, w1)].sort((x, y) => x - y);
      for (const p of intersection(outline, [ccw(bandOf(a0, a1))]))
        add(p.map(([u, v]) => at((z - R[11] - R[8] * u - R[9] * v) / R[10])([u, v])));
    } else {
      const sc = sAt(z, 0);
      // Where the line s = sc runs inside the outline, from a hair-thin band
      for (const p of intersection(outline, [ccw(bandOf(sc - 1e-4, sc + 1e-4))])) {
        let [t0, t1] = [Infinity, -Infinity];
        for (const [u, v] of p) {
          const t = tx * u + ty * v;
          t0 = Math.min(t0, t);
          t1 = Math.max(t1, t);
        }
        if (!(t1 - t0 > 1e-6)) continue;
        const a: [number, number] = [nx * sc + tx * t0, ny * sc + ty * t0];
        const c: [number, number] = [nx * sc + tx * t1, ny * sc + ty * t1];
        add([at(w0)(a), at(w0)(c), at(w1)(c), at(w1)(a)]);
      }
    }
  }
  // The other part's sides, each a quad through its thickness, clipped to
  // the slab
  const depth = (u: number, v: number, w: number) => R[8] * u + R[9] * v + R[10] * w + R[11];
  for (const ring of outline)
    for (let i = 0; i < ring.length; i++) {
      const [pu, pv] = ring[i];
      const [qu, qv] = ring[(i + 1) % ring.length];
      // Corners as [t along the edge, w], clipped by z >= 0 and z <= T
      let poly: [number, number][] = [
        [0, w0],
        [1, w0],
        [1, w1],
        [0, w1],
      ];
      const z = ([t, w]: [number, number]) => depth(pu + (qu - pu) * t, pv + (qv - pv) * t, w);
      for (const [sign, limit] of [
        [1, 0],
        [-1, -T],
      ] as const) {
        const keep = (c: [number, number]) => sign * z(c) >= limit;
        const next: [number, number][] = [];
        for (let k = 0; k < poly.length; k++) {
          const c = poly[k];
          const d = poly[(k + 1) % poly.length];
          if (keep(c)) next.push(c);
          if (keep(c) !== keep(d)) {
            const zc = sign * z(c) - limit;
            const zd = sign * z(d) - limit;
            const f = zc / (zc - zd);
            next.push([c[0] + (d[0] - c[0]) * f, c[1] + (d[1] - c[1]) * f]);
          }
        }
        poly = next;
        if (!poly.length) break;
      }
      if (poly.length >= 3)
        add(poly.map(([t, w]) => at(w)([pu + (qu - pu) * t, pv + (qv - pv) * t])));
    }
  return shadows.length ? union(shadows, 'nonzero') : [];
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
