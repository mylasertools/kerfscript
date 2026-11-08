// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import { union, type Poly } from '../geometry.js';
import { multiply, translation, type Vec3 } from '../assembly.js';
import { apply, dot, EPS, length, materialGuard, netArea, signedArea, sub } from './geometry.js';
import { findHardware, findPart } from './spec.js';
import type { BodyRef, SnapshotHardware, Trajectory, VerificationSnapshot } from './types.js';

export class WorkBudget {
  constructor(public remaining = 2000000) {}
  tick(n = 1) {
    this.remaining -= n;
    if (this.remaining < 0) throw new Error('Verification operation budget exhausted.');
  }
}
export const key = (r: BodyRef) =>
  'part' in r
    ? JSON.stringify(['part', r.part, r.copy ?? 1])
    : JSON.stringify(['hardware', r.hardware]);
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const scale = (v: Vec3, s: number): Vec3 => v.map((x) => x * s) as Vec3;
export const add = (a: Vec3, b: Vec3): Vec3 => a.map((x, i) => x + b[i]) as Vec3;
export const unit = (v: Vec3): Vec3 => scale(v, 1 / length(v));
export const identity = () => translation(0, 0, 0);
export function sameTrajectory(a: Trajectory, b: Trajectory): boolean {
  const still = (t: Trajectory) =>
    t.kind === 'translate' ? length(t.by) < 1e-9 : Math.abs(t.angle) < 1e-9;
  if (still(a) && still(b)) return true;
  if (a.kind === 'translate' && b.kind === 'translate') return length(sub(a.by, b.by)) < 1e-9;
  if (a.kind === 'rotate' && b.kind === 'rotate')
    return (
      length(sub(scale(unit(a.axis), a.angle), scale(unit(b.axis), b.angle))) < 1e-9 &&
      length(cross(sub(a.origin, b.origin), unit(a.axis))) < 1e-9
    );
  return false;
}

export interface Cell {
  vertices: Vec3[];
  faces: number[][];
  edges: [number, number][];
}
export interface Solid {
  ref: BodyRef;
  outer: Cell[];
  inner: Cell[];
}
function cell(vertices: Vec3[], faces: number[][]): Cell {
  const edges = new Map<string, [number, number]>();
  for (const f of faces)
    for (let i = 0; i < f.length; i++) {
      const a = f[i],
        b = f[(i + 1) % f.length],
        pair: [number, number] = a < b ? [a, b] : [b, a];
      edges.set(pair.join(','), pair);
    }
  return { vertices, faces, edges: [...edges.values()] };
}
function prism(r: Poly, t: number, m: number[]): Cell {
  const n = r.length,
    vertices: Vec3[] = [];
  for (const z of [0, t]) for (const [x, y] of r) vertices.push(apply(m, [x, y, z]));
  return cell(vertices, [
    r.map((_, i) => i).reverse(),
    r.map((_, i) => n + i),
    ...r.map((_, i) => [i, (i + 1) % n, ((i + 1) % n) + n, i + n]),
  ]);
}
/** Exact vertical decomposition: between consecutive vertex x coordinates the
 * boundary edges are affine and cannot change their vertical ordering. Pairing
 * crossings preserves concavity and holes without a triangulation heuristic. */
function decompose(input: Poly[], budget: WorkBudget): Poly[] {
  const regions = union(input),
    xs = [...new Set(regions.flat().map((p) => p[0]))].sort((a, b) => a - b);
  const edges = regions.flatMap((r) => r.map((a, i) => ({ a, b: r[(i + 1) % r.length] }))),
    cells: Poly[] = [];
  const at = (e: { a: [number, number]; b: [number, number] }, x: number) =>
    e.a[1] + ((x - e.a[0]) * (e.b[1] - e.a[1])) / (e.b[0] - e.a[0]);
  for (let i = 1; i < xs.length; i++) {
    const lo = xs[i - 1],
      hi = xs[i],
      mid = (lo + hi) / 2;
    budget.tick(edges.length);
    const crossing = edges
      .filter((e) => Math.min(e.a[0], e.b[0]) < mid && Math.max(e.a[0], e.b[0]) > mid)
      .sort((a, b) => at(a, mid) - at(b, mid));
    if (crossing.length % 2) throw new Error('Cut boundaries do not define closed slab intervals.');
    for (let j = 0; j < crossing.length; j += 2) {
      const low = crossing[j],
        high = crossing[j + 1];
      const r: Poly = [
        [lo, at(low, lo)],
        [hi, at(low, hi)],
        [hi, at(high, hi)],
        [lo, at(high, lo)],
      ];
      const clean = r.filter(
        (p, k) =>
          length([p[0] - r[(k + 1) % r.length][0], p[1] - r[(k + 1) % r.length][1], 0]) > 1e-10,
      );
      if (clean.length < 3 || Math.abs(signedArea(clean)) < 1e-12)
        throw new Error('A material sliver is below the supported solid precision.');
      cells.push(clean);
      if (cells.length > 5000) throw new Error('Rigid decomposition exceeds its cell budget.');
    }
  }
  if (
    !cells.length ||
    Math.abs(netArea(cells) - netArea(regions)) > EPS * EPS * Math.max(1, netArea(regions))
  )
    throw new Error('Rigid decomposition did not preserve material area.');
  return cells;
}
export function allBodies(s: VerificationSnapshot): BodyRef[] {
  if (s.hardware.some((h) => !h.label))
    throw new Error('Physical hardware needs unique labels for whole-inventory checks.');
  const refs: BodyRef[] = [
    ...s.parts.map((p) => ({ part: p.name, copy: p.copy })),
    ...s.hardware.map((h) => ({ hardware: h.label! })),
  ];
  if (new Set(refs.map(key)).size !== refs.length)
    throw new Error('Physical inventory has ambiguous identities.');
  return refs;
}
// The segment a piece of hardware's envelope runs along. A ball's is the
// upright diameter through its centre.
export function hardwareEnds(h: SnapshotHardware): [Vec3, Vec3] {
  if (h.shape !== 'ball' || typeof h.size !== 'number') return [h.from, h.to];
  const r = h.size / 2;
  return [
    [h.from[0], h.from[1], h.from[2] - r],
    [h.from[0], h.from[1], h.from[2] + r],
  ];
}
export function bodyMatrix(s: VerificationSnapshot, r: BodyRef): number[] {
  if ('part' in r) return findPart(s, r).matrix;
  const found = findHardware(s, r),
    [from, to] = hardwareEnds(found),
    h = { ...found, from, to },
    z = unit(sub(h.to, h.from));
  if (!length(sub(h.to, h.from)))
    throw new Error('Zero-length hardware needs an explicit physical shape.');
  let y = sub(h.up, scale(z, dot(h.up, z)));
  if (length(y) < 1e-9) {
    if (Array.isArray(h.size))
      throw new Error('A rectangular hardware envelope needs an unambiguous up direction.');
    const fallback: Vec3 = Math.abs(z[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
    y = sub(fallback, scale(z, dot(fallback, z)));
  }
  y = unit(y);
  const x = cross(y, z);
  return [
    x[0],
    y[0],
    z[0],
    h.from[0],
    x[1],
    y[1],
    z[1],
    h.from[1],
    x[2],
    y[2],
    z[2],
    h.from[2],
    0,
    0,
    0,
    1,
  ];
}
export function makeSolid(s: VerificationSnapshot, ref: BodyRef, budget: WorkBudget): Solid {
  budget.tick();
  if ('part' in ref) {
    const p = findPart(s, ref),
      guard = materialGuard(p);
    if (guard) throw new Error(guard);
    const rings = decompose(p.regions, budget);
    const cells = rings.map((r) => prism(r, p.thickness, p.matrix));
    return { ref, outer: cells, inner: cells };
  }
  const h = findHardware(s, ref),
    m = bodyMatrix(s, ref),
    [a, b] = hardwareEnds(h),
    depth = length(sub(b, a));
  if (depth < EPS) throw new Error('Hardware needs a nonzero cylindrical or box envelope.');
  if (Array.isArray(h.size)) {
    const [w, t] = h.size,
      ring: Poly = [
        [-w / 2, -t / 2],
        [w / 2, -t / 2],
        [w / 2, t / 2],
        [-w / 2, t / 2],
      ];
    const cells = [prism(ring, depth, m)];
    return { ref, outer: cells, inner: cells };
  }
  const n = 32,
    ring = (r: number): Poly =>
      Array.from({ length: n }, (_, i) => [
        r * Math.cos((i * 2 * Math.PI) / n),
        r * Math.sin((i * 2 * Math.PI) / n),
      ]);
  if (h.shape === 'ball') {
    // Outside: the cylinder round the ball. Inside: the cylinder in it, as
    // wide as it is tall, which the ball holds whole.
    const r = h.size / 2,
      k = r / Math.SQRT2,
      lift = translation(0, 0, r - k);
    return {
      ref,
      inner: [prism(ring(k), 2 * k, multiply(m, lift))],
      outer: [prism(ring(r / Math.cos(Math.PI / n)), depth, m)],
    };
  }
  return {
    ref,
    inner: [prism(ring(h.size / 2), depth, m)],
    outer: [prism(ring(h.size / 2 / Math.cos(Math.PI / n)), depth, m)],
  };
}
export function transformSolid(s: Solid, m: number[]): Solid {
  const transform = (cs: Cell[]) =>
    cs.map((c) => ({ ...c, vertices: c.vertices.map((p) => apply(m, p)) }));
  const outer = transform(s.outer);
  return { ref: s.ref, outer, inner: s.inner === s.outer ? outer : transform(s.inner) };
}
export function trajectoryMatrix(t: Trajectory, u: number): number[] {
  if (t.kind === 'translate') return translation(...scale(t.by, u));
  const [x, y, z] = unit(t.axis),
    a = ((t.angle * Math.PI) / 180) * u,
    c = Math.cos(a),
    si = Math.sin(a),
    d = 1 - c;
  const r = [
    c + x * x * d,
    x * y * d - z * si,
    x * z * d + y * si,
    0,
    y * x * d + z * si,
    c + y * y * d,
    y * z * d - x * si,
    0,
    z * x * d - y * si,
    z * y * d + x * si,
    c + z * z * d,
    0,
    0,
    0,
    0,
    1,
  ];
  return multiply(translation(...t.origin), multiply(r, translation(...scale(t.origin, -1))));
}
export function speedBound(s: Solid, t: Trajectory): number {
  if (t.kind === 'translate') return length(t.by);
  const axis = unit(t.axis);
  let radius = 0;
  for (const c of s.outer)
    for (const p of c.vertices) {
      const v = sub(p, t.origin);
      radius = Math.max(radius, length(sub(v, scale(axis, dot(v, axis)))));
    }
  return ((Math.abs(t.angle) * Math.PI) / 180) * radius;
}
function normals(c: Cell): Vec3[] {
  return c.faces
    .map((f) =>
      cross(sub(c.vertices[f[1]], c.vertices[f[0]]), sub(c.vertices[f[2]], c.vertices[f[0]])),
    )
    .filter((v) => length(v) > 1e-12)
    .map(unit);
}
function axes(a: Cell, b: Cell): Vec3[] {
  const out = [...normals(a), ...normals(b)];
  for (const [i, j] of a.edges)
    for (const [k, l] of b.edges) {
      const v = cross(sub(a.vertices[j], a.vertices[i]), sub(b.vertices[l], b.vertices[k]));
      if (length(v) > 1e-12) out.push(unit(v));
    }
  return out;
}
const projection = (c: Cell, n: Vec3) => {
  const d = c.vertices.map((p) => dot(p, n));
  return [Math.min(...d), Math.max(...d)];
};
function separation(a: Cell, b: Cell, budget: WorkBudget): number {
  let gap = -Infinity;
  for (const n of axes(a, b)) {
    budget.tick();
    const x = projection(a, n),
      y = projection(b, n);
    gap = Math.max(gap, y[0] - x[1], x[0] - y[1]);
  }
  return gap;
}
function boxDistance(a: Cell, b: Cell): number {
  let sum = 0;
  for (let k = 0; k < 3; k++) {
    const x = a.vertices.map((p) => p[k]),
      y = b.vertices.map((p) => p[k]);
    const d = Math.max(0, Math.min(...y) - Math.max(...x), Math.min(...x) - Math.max(...y));
    sum += d * d;
  }
  return Math.sqrt(sum);
}
function pointTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const ab = sub(b, a),
    ac = sub(c, a),
    ap = sub(p, a),
    d1 = dot(ab, ap),
    d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return length(ap);
  const bp = sub(p, b),
    d3 = dot(ab, bp),
    d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return length(bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return length(sub(ap, scale(ab, d1 / (d1 - d3))));
  const cp = sub(p, c),
    d5 = dot(ab, cp),
    d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return length(cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return length(sub(ap, scale(ac, d2 / (d2 - d6))));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
    return length(sub(bp, scale(sub(c, b), (d4 - d3) / (d4 - d3 + d5 - d6))));
  const denominator = va + vb + vc;
  if (Math.abs(denominator) < 1e-20) return Infinity;
  // Clamp the witness to the triangle. Even in an ill-conditioned case its
  // distance stays an upper bound; it is never used to certify separation.
  const v = Math.max(0, Math.min(1, vb / denominator)),
    w = Math.max(0, Math.min(1 - v, vc / denominator));
  return length(sub(ap, add(scale(ab, v), scale(ac, w))));
}
function segments(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const u = sub(b, a),
    v = sub(d, c),
    w = sub(a, c),
    aa = dot(u, u),
    bb = dot(u, v),
    cc = dot(v, v),
    dd = dot(u, w),
    ee = dot(v, w);
  if (aa < 1e-20 || cc < 1e-20) return Infinity;
  const denominator = aa * cc - bb * bb;
  let x = denominator > 1e-20 ? Math.max(0, Math.min(1, (bb * ee - cc * dd) / denominator)) : 0;
  let y = (bb * x + ee) / cc;
  if (y < 0) {
    y = 0;
    x = Math.max(0, Math.min(1, -dd / aa));
  }
  if (y > 1) {
    y = 1;
    x = Math.max(0, Math.min(1, (bb - dd) / aa));
  }
  return length(add(w, sub(scale(u, x), scale(v, y))));
}
function featuresDistance(a: Cell, b: Cell, budget: WorkBudget): number {
  let best = Infinity;
  for (const [p, q] of [
    [a, b],
    [b, a],
  ])
    for (const v of p.vertices)
      for (const f of q.faces)
        for (let i = 1; i < f.length - 1; i++) {
          budget.tick();
          best = Math.min(
            best,
            pointTriangle(v, q.vertices[f[0]], q.vertices[f[i]], q.vertices[f[i + 1]]),
          );
        }
  for (const [i, j] of a.edges)
    for (const [k, l] of b.edges) {
      budget.tick();
      best = Math.min(best, segments(a.vertices[i], a.vertices[j], b.vertices[k], b.vertices[l]));
    }
  return best;
}
function distance(
  cellsA: Cell[],
  cellsB: Cell[],
  budget: WorkBudget,
  threshold: number,
): { lower: number; upper: number; penetration: boolean; touchSafe: boolean } {
  let lower = Infinity,
    upper = Infinity,
    penetration = false,
    touchSafe = true;
  for (const a of cellsA)
    for (const b of cellsB) {
      budget.tick();
      const bound = boxDistance(a, b);
      if (bound > Math.min(upper, threshold)) {
        lower = Math.min(lower, bound);
        continue;
      }
      const gap = separation(a, b, budget);
      if (gap < -EPS) penetration = true;
      if (gap < 0) touchSafe = false;
      lower = Math.min(lower, Math.max(0, bound, gap));
      if (gap < -EPS) upper = 0;
      else if (gap <= Math.min(upper, threshold))
        upper = Math.min(upper, featuresDistance(a, b, budget));
    }
  return { lower, upper, penetration, touchSafe };
}
export function distanceBounds(
  a: Solid,
  b: Solid,
  budget: WorkBudget,
  threshold: number,
): { lower: number; upper: number; penetration: boolean; touchSafe: boolean } {
  const outer = distance(a.outer, b.outer, budget, threshold + EPS);
  const exact = a.outer === a.inner && b.outer === b.inner;
  // Pruned broad-phase distances are lower bounds, never upper witnesses.
  if (outer.lower > threshold + EPS)
    return { lower: outer.lower - EPS, upper: Infinity, penetration: false, touchSafe: true };
  const inner = exact ? outer : distance(a.inner, b.inner, budget, Infinity);
  return {
    lower: Math.max(0, outer.lower - EPS),
    upper: inner.upper + EPS,
    penetration: inner.penetration,
    touchSafe: outer.touchSafe,
  };
}
/** For pure translations, every projection interval is affine. A single
 * separating axis valid at both endpoints certifies the whole interval. */
export function linearSeparated(
  a0: Solid,
  a1: Solid,
  b0: Solid,
  b1: Solid,
  gap: number,
  budget: WorkBudget,
): boolean {
  for (let i = 0; i < a0.outer.length; i++)
    for (let j = 0; j < b0.outer.length; j++) {
      const a = a0.outer[i],
        b = b0.outer[j],
        aa = a1.outer[i],
        bb = b1.outer[j];
      let separated = false;
      for (const n of axes(a, b)) {
        budget.tick();
        const x = projection(a, n),
          y = projection(b, n),
          xx = projection(aa, n),
          yy = projection(bb, n);
        if (
          Math.min(y[0] - x[1], yy[0] - xx[1]) >= gap ||
          Math.min(x[0] - y[1], xx[0] - yy[1]) >= gap
        ) {
          separated = true;
          break;
        }
      }
      if (!separated) return false;
    }
  return true;
}
