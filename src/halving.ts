// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Halving joints from the assembly: two plates that cross each other each
// take a slot from opposite sides, meeting halfway along the line they
// cross on, so they slide together (a ring and a rib, an egg-crate grid).

import { invert } from './assembly.js';
import { area, intersection, offset, pieces, type Poly } from './geometry.js';
import type { Solid } from './slots.js';

type Vec3 = [number, number, number];
type Pt = [number, number];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normal = (m: number[]): Vec3 => [m[2], m[6], m[10]];
const origin = (m: number[]): Vec3 => [m[3], m[7], m[11]];

// Where a line from `from` along unit `dir` enters and leaves the regions,
// as distances along it, in order
function spans(regions: Poly[], from: Pt, dir: Pt): number[] {
  const hits: number[] = [];
  for (const ring of regions)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j],
        b = ring[i];
      const da = dir[0] * (a[1] - from[1]) - dir[1] * (a[0] - from[0]);
      const db = dir[0] * (b[1] - from[1]) - dir[1] * (b[0] - from[0]);
      if (da > 0 === db > 0) continue;
      const f = da / (da - db);
      hits.push(
        (a[0] + (b[0] - a[0]) * f - from[0]) * dir[0] +
          (a[1] + (b[1] - a[1]) * f - from[1]) * dir[1],
      );
    }
  return hits.sort((p, q) => p - q);
}

// The span of a sorted list of crossings that holds s, if any
function spanAt(xs: number[], s: number): [number, number] | undefined {
  for (let i = 0; i + 1 < xs.length; i += 2)
    if (xs[i] <= s && s <= xs[i + 1]) return [xs[i], xs[i + 1]];
}

// Whether a point lies in a group of rings (an outline and its holes)
function inside(group: Poly[], [x, y]: Pt): boolean {
  let n = false;
  for (const ring of group)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j],
        [bx, by] = ring[i];
      if (ay > y !== by > y && x < ax + ((bx - ax) * (y - ay)) / (by - ay)) n = !n;
    }
  return n;
}

export interface Halving {
  // Slots in each part's own coordinates
  a: Poly[];
  b: Poly[];
  // Crossings found but too thin to halve
  thin: number;
}

// The halving slots where plates a and b cross, `clearance` wider in all
export function halvingFor(A: Solid, B: Solid, clearance: number): Halving {
  const out: Halving = { a: [], b: [], thin: 0 };
  const nA = normal(A.matrix),
    nB = normal(B.matrix);
  const raw = cross(nA, nB);
  const sin = Math.hypot(...raw);
  // Parallel plates don't cross
  if (sin < 1e-6) return out;
  const cos = Math.abs(dot(nA, nB));
  const dir: Vec3 = [raw[0] / sin, raw[1] / sin, raw[2] / sin];
  // The line the two middle planes meet on
  const dA = dot(nA, origin(A.matrix)) + A.thickness / 2;
  const dB = dot(nB, origin(B.matrix)) + B.thickness / 2;
  const k = dot(nA, nB);
  const det = 1 - k * k;
  const ca = (dA - dB * k) / det,
    cb = (dB - dA * k) / det;
  const p: Vec3 = [ca * nA[0] + cb * nB[0], ca * nA[1] + cb * nB[1], ca * nA[2] + cb * nB[2]];
  // The line in a part's own coordinates: a point and a direction
  const onPart = (S: Solid): [Pt, Pt] => {
    const m = invert(S.matrix);
    return [
      [
        m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
        m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
      ],
      [
        m[0] * dir[0] + m[1] * dir[1] + m[2] * dir[2],
        m[4] * dir[0] + m[5] * dir[1] + m[6] * dir[2],
      ],
    ];
  };
  const [pA, uA] = onPart(A),
    [pB, uB] = onPart(B);
  const sa = spans(A.outline, pA, uA),
    sb = spans(B.outline, pB, uB);
  // Each slot is as wide as the other plate's section through this one
  const wA = (B.thickness + A.thickness * cos) / sin + clearance,
    wB = (A.thickness + B.thickness * cos) / sin + clearance;
  for (let i = 0; i + 1 < sa.length; i += 2)
    for (let j = 0; j + 1 < sb.length; j += 2) {
      const o0 = Math.max(sa[i], sb[j]),
        o1 = Math.min(sa[i + 1], sb[j + 1]);
      if (!(o1 - o0 > 0.01)) continue;
      const m = (o0 + o1) / 2;
      const [a0, a1] = spanAt(sa, m)!,
        [b0, b1] = spanAt(sb, m)!;
      // The way round that leaves both parts soonest: a slides onto b
      const aUp = Math.max(a1 - m, m - b0) <= Math.max(m - a0, b1 - m);
      // A part's slot: its material in a strip from the middle out through
      // its edge, only what the strip meets before it leaves the part, so
      // across a hole the part's far side is left whole
      const slot = (S: Solid, at: Pt, u: Pt, w: number, sign: number, reach: number) => {
        const n: Pt = [-u[1], u[0]];
        const c = (s: number, t: number): Pt => [
          at[0] + u[0] * (m + sign * s) + n[0] * t,
          at[1] + u[1] * (m + sign * s) + n[1] * t,
        ];
        const far = reach + w + 1;
        const strip: Poly = [c(0, -w / 2), c(far, -w / 2), c(far, w / 2), c(0, w / 2)];
        if (area(strip) < 0) strip.reverse();
        const start = c(Math.min(0.01, reach / 2), 0);
        const g = pieces(intersection([strip], S.outline)).find((q) => inside(q, start));
        if (!g || !(g.reduce((t, r) => t + area(r), 0) > 1e-4)) return undefined;
        // Past the part's edge a little, within the strip, so no hairline of
        // the edge is left in the slot
        return intersection(offset(g, 0.05, 'miter'), [strip]);
      };
      const gA = slot(A, pA, uA, wA, aUp ? 1 : -1, aUp ? a1 - m : m - a0);
      const gB = slot(B, pB, uB, wB, aUp ? -1 : 1, aUp ? m - b0 : b1 - m);
      if (!gA || !gB) {
        out.thin++;
        continue;
      }
      out.a.push(...gA);
      out.b.push(...gB);
    }
  return out;
}
