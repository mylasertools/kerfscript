// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import { invert, multiply, type Vec3 } from '../assembly.js';
import { intersection, xor, type Poly } from '../geometry.js';
import type { SnapshotPart } from './types.js';

// Larger than the geometry kernel's 0.0001 mm grid. Never use the render
// collision volume threshold to decide whether a mechanical fit is safe.
export const EPS = 0.001;
export const dot = (a: Vec3, b: Vec3) => a.reduce((s, v, i) => s + v * b[i], 0);
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const length = (a: Vec3) => Math.hypot(...a);
export const normal = (m: number[]): Vec3 => [m[2], m[6], m[10]];
export const apply = (m: number[], p: Vec3): Vec3 =>
  [0, 1, 2].map(
    (i) => m[i * 4] * p[0] + m[i * 4 + 1] * p[1] + m[i * 4 + 2] * p[2] + m[i * 4 + 3],
  ) as Vec3;
export const relative = (a: SnapshotPart, b: SnapshotPart) => multiply(invert(a.matrix), b.matrix);
export function signedArea(p: Poly): number {
  // Translate before summing to avoid subtracting large world-coordinate products.
  const [x, y] = p[0];
  let sum = 0;
  for (let i = 1; i < p.length - 1; i++)
    sum += (p[i][0] - x) * (p[i + 1][1] - y) - (p[i][1] - y) * (p[i + 1][0] - x);
  return sum / 2;
}
export const netArea = (p: Poly[]) => Math.abs(p.reduce((n, r) => n + signedArea(r), 0));
export const boundaryLength = (p: Poly[]) =>
  p.reduce(
    (n, r) =>
      n +
      r.reduce(
        (n, p, i) =>
          n + Math.hypot(p[0] - r[(i + 1) % r.length][0], p[1] - r[(i + 1) % r.length][1]),
        0,
      ),
    0,
  );
export function bounds(p: Poly[]): [number, number, number, number] {
  const pts = p.flat();
  return [
    Math.min(...pts.map((v) => v[0])),
    Math.min(...pts.map((v) => v[1])),
    Math.max(...pts.map((v) => v[0])),
    Math.max(...pts.map((v) => v[1])),
  ];
}
export const rectangle = ([x0, y0, x1, y1]: number[]): Poly => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
export function rectangular(p: Poly[]): boolean {
  if (p.length !== 1) return false;
  const b = bounds(p);
  return netArea(xor(p, [rectangle(b)])) < EPS * EPS;
}
export const clipRectangle = (p: Poly[], b: number[]) => intersection(p, [rectangle(b)]);
export function project(p: Poly[], m: number[], z = 0): Poly[] {
  const flipped = m[0] * m[5] - m[1] * m[4] < 0;
  return p.map((r) => {
    const q = r.map(([x, y]) => apply(m, [x, y, z]).slice(0, 2) as [number, number]);
    return flipped ? q.reverse() : q;
  });
}
export function inside(r: Poly, p: [number, number]): boolean {
  let hit = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [x, y] = r[i],
      [u, v] = r[j];
    if (y > p[1] !== v > p[1] && p[0] < ((u - x) * (p[1] - y)) / (v - y) + x) hit = !hit;
  }
  return hit;
}
export function pointSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const d = dx * dx + dy * dy;
  const t = d ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / d)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
export function edgeDistance(a: Poly, b: Poly): number {
  // Used only for disjoint, nested cut boundaries. The boolean kernel
  // established containment before this measurement.
  let d = Infinity;
  for (const p of a)
    for (let i = 0; i < b.length; i++)
      d = Math.min(d, pointSegment(p, b[i], b[(i + 1) % b.length]));
  for (const p of b)
    for (let i = 0; i < a.length; i++)
      d = Math.min(d, pointSegment(p, a[i], a[(i + 1) % a.length]));
  return d;
}
export const holesAt = (p: Poly[], at: [number, number]) =>
  p.filter((r) => signedArea(r) < 0 && inside(r, at));
export function materialGuard(p: SnapshotPart): string | null {
  if (!p.placed) return 'The part has no physical placement.';
  if (p.bends.length) return 'Flexible or bent geometry is not supported by this rigid check.';
  if (p.cutLines === null)
    return 'Nominal cutting-line geometry is unavailable; render with analysis: true.';
  if (p.cutLines.length)
    return 'Open cutting lines may remove or weaken material; this rigid check cannot model them.';
  return null;
}
export function orthogonal(m: number[]): boolean {
  return [0, 1, 2, 4, 5, 6, 8, 9, 10].every(
    (i) => Math.abs(m[i]) < 1e-9 || Math.abs(Math.abs(m[i]) - 1) < 1e-9,
  );
}
export function geometryEqual(a: SnapshotPart, b: SnapshotPart): boolean {
  return (
    a.thickness === b.thickness &&
    a.material === b.material &&
    a.kerf === b.kerf &&
    canonicalRegions(a.regions) === canonicalRegions(b.regions) &&
    canonicalLines(a.cutLines!) === canonicalLines(b.cutLines!)
  );
}
function canonicalRegions(regions: Poly[]): string {
  const ring = (r: Poly) => {
    const points =
      r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]
        ? r.slice(0, -1)
        : r;
    const candidates = [points, [...points].reverse()].map((p) => {
      let start = 0;
      for (let i = 1; i < p.length; i++)
        if (p[i][0] < p[start][0] || (p[i][0] === p[start][0] && p[i][1] < p[start][1])) start = i;
      return JSON.stringify([...p.slice(start), ...p.slice(0, start)]);
    });
    return JSON.stringify([Math.sign(signedArea(r)), candidates.sort()[0]]);
  };
  return JSON.stringify(regions.map(ring).sort());
}
function canonicalLines(lines: Poly[]): string {
  return JSON.stringify(
    lines
      .map((line) => {
        const forward = JSON.stringify(line),
          back = JSON.stringify([...line].reverse());
        return forward < back ? forward : back;
      })
      .sort(),
  );
}
