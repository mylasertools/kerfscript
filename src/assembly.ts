// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import { intersection, pieces, type Bend, type Poly } from './geometry.js';

export type Vec3 = [number, number, number];

export interface Placement {
  at: Vec3;
  rotate: Vec3;
  // A full 4x4 matrix, row by row, when the placement is composed with
  // place(): it wins over at and rotate
  matrix?: number[];
}

export interface AssemblyPart {
  name: string;
  copy: number;
  thickness: number;
  // The sheet's material name, as $material gives it
  material?: string;
  matrix: number[];
  outline: Poly[];
  placed: boolean;
  // Living hinge bends along the part's x, applied after matrix's
  // placement: see bendPoint()
  bends?: Bend[];
  // The assembly step that adds it: 0 when the program has no steps
  step?: number;
  // Glued in a stack of this many layers
  stack?: number;
  // What is engraved and scored on it, in its own coordinates, for 3D views
  marks?: Mark[];
}

export interface Mark {
  layer: string;
  mode: 'fill' | 'line';
  color: string;
  side: 'front' | 'back';
  regions: Poly[];
  lines: Poly[];
}

const RAD = Math.PI / 180;

export function multiply(a: number[], b: number[]): number[] {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++) out[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return out;
}

function rotation(axis: 0 | 1 | 2, degrees: number): number[] {
  const c = Math.cos(degrees * RAD);
  const s = Math.sin(degrees * RAD);
  if (axis === 0) return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
  if (axis === 1) return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

const clean = (n: number) => (Math.abs(n) < 1e-12 ? 0 : n);

export function placementMatrix(p: Placement): number[] {
  if (p.matrix) return p.matrix.map(clean);
  const [ax, ay, az] = p.rotate;
  const r = multiply(rotation(2, az), multiply(rotation(1, ay), rotation(0, ax)));
  r[3] = p.at[0];
  r[7] = p.at[1];
  r[11] = p.at[2];
  return r.map(clean);
}

function apply(m: number[], x: number, y: number, z: number): Vec3 {
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}

function invertRigid(m: number[]): number[] {
  const [tx, ty, tz] = [m[3], m[7], m[11]];
  const r = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
  return [
    r[0],
    r[1],
    r[2],
    -(r[0] * tx + r[1] * ty + r[2] * tz),
    r[3],
    r[4],
    r[5],
    -(r[3] * tx + r[4] * ty + r[5] * tz),
    r[6],
    r[7],
    r[8],
    -(r[6] * tx + r[7] * ty + r[8] * tz),
    0,
    0,
    0,
    1,
  ];
}

type Vec2 = [number, number];

function bounds2(regions: Poly[]): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of regions)
    for (const [x, y] of ring) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return [x0, y0, x1, y1];
}

export function worldBox(p: AssemblyPart): [Vec3, Vec3] {
  const [x0, y0, x1, y1] = bounds2(p.outline);
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const x of [x0, x1])
    for (const y of [y0, y1])
      for (const z of [0, p.thickness]) {
        const w = apply(p.matrix, x, y, z);
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], w[k]);
          hi[k] = Math.max(hi[k], w[k]);
        }
      }
  return [lo, hi];
}

export function besideAssembly(
  placed: AssemblyPart[],
  loose: AssemblyPart[],
  gap = 10,
): AssemblyPart[] {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const [a, b] of placed.map(worldBox))
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], a[k]);
      hi[k] = Math.max(hi[k], b[k]);
    }
  const sizes = loose.map((p) => bounds2(p.outline));
  const limit = sizes.reduce((w, [x0, , x1]) => Math.max(w, x1 - x0), hi[0] - lo[0]);
  let x = 0;
  let y = 0;
  let row = 0;
  return loose.map((p, i) => {
    const [x0, y0, x1, y1] = sizes[i];
    if (x > 0 && x + x1 - x0 > limit) {
      x = 0;
      y += row + gap;
      row = 0;
    }
    const matrix = [
      1,
      0,
      0,
      hi[0] + gap + x - x0,
      0,
      1,
      0,
      lo[1] + y - y0,
      0,
      0,
      1,
      lo[2],
      0,
      0,
      0,
      1,
    ];
    x += x1 - x0 + gap;
    row = Math.max(row, y1 - y0);
    return { ...p, matrix: matrix.map(clean) };
  });
}

const overlaps = (a: [Vec3, Vec3], b: [Vec3, Vec3], eps: number) =>
  [0, 1, 2].every((k) => a[0][k] < b[1][k] - eps && b[0][k] < a[1][k] - eps);

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const normal = (m: number[]): Vec3 => [m[2], m[6], m[10]];
const origin = (m: number[]): Vec3 => [m[3], m[7], m[11]];
const turn = (m: number[], v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
  m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
];

function spans(regions: Poly[], from: Vec2, dir: Vec2): number[] {
  const len = dir[0] * dir[0] + dir[1] * dir[1];
  const hits: number[] = [];
  for (const ring of regions)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j];
      const b = ring[i];
      const da = dir[0] * (a[1] - from[1]) - dir[1] * (a[0] - from[0]);
      const db = dir[0] * (b[1] - from[1]) - dir[1] * (b[0] - from[0]);
      if (da > 0 === db > 0) continue;
      const f = da / (da - db);
      const x = a[0] + (b[0] - a[0]) * f - from[0];
      const y = a[1] + (b[1] - a[1]) * f - from[1];
      hits.push((x * dir[0] + y * dir[1]) / len);
    }
  return hits.sort((p, q) => p - q);
}

function shared(a: number[], b: number[], eps: number): number {
  let total = 0;
  let i = 0;
  let j = 0;
  while (i + 1 < a.length && j + 1 < b.length) {
    const length = Math.min(a[i + 1], b[j + 1]) - Math.max(a[i], b[j]);
    if (length > eps) total += length;
    if (a[i + 1] < b[j + 1]) i += 2;
    else j += 2;
  }
  return total;
}

function steps(lo: number, hi: number, eps: number, pitch: number): { at: number[]; size: number } {
  const from = lo + eps;
  const to = hi - eps;
  if (to <= from) return { at: [], size: 0 };
  const n = Math.max(4, Math.ceil((to - from) / pitch));
  return {
    at: Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 0.5)) / n),
    size: (to - from) / n,
  };
}

function localLine(inverse: number[], at: Vec3, dir: Vec3): [Vec2, Vec2] {
  const p = apply(inverse, at[0], at[1], at[2]);
  const d = turn(inverse, dir);
  return [
    [p[0], p[1]],
    [d[0], d[1]],
  ];
}

function crossing(
  A: AssemblyPart,
  B: AssemblyPart,
  invA: number[],
  invB: number[],
  eps: number,
  pitch: number,
  volume: number,
): boolean {
  const nA = normal(A.matrix);
  const nB = normal(B.matrix);
  const raw = cross(nA, nB);
  const size = Math.hypot(...raw);
  const line: Vec3 = [raw[0] / size, raw[1] / size, raw[2] / size];
  const side = cross(line, nA);
  const tilt = dot(nB, side);
  const oA = origin(A.matrix);
  const bLevel = dot(nB, origin(B.matrix));
  // Only through the depth of A that B reaches, so a shallow intrusion
  // is sampled as finely as a deep one
  let lo = Infinity,
    hi = -Infinity;
  for (const ring of B.outline)
    for (const [x, y] of ring)
      for (const w of [0, B.thickness]) {
        const p = apply(B.matrix, x, y, w);
        const d = dot(nA, [p[0] - oA[0], p[1] - oA[1], p[2] - oA[2]]);
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
  const depths = steps(Math.max(0, lo), Math.min(A.thickness, hi), eps, pitch);
  // And only across the part of B's slab that A's outline reaches
  let aLo = Infinity,
    aHi = -Infinity;
  for (const ring of A.outline)
    for (const [x, y] of ring) {
      const p = apply(A.matrix, x, y, 0);
      const d = dot(side, [p[0] - oA[0], p[1] - oA[1], p[2] - oA[2]]);
      if (d < aLo) aLo = d;
      if (d > aHi) aHi = d;
    }
  let total = 0;
  for (const depth of depths.at) {
    const base = add(oA, nA, depth);
    const b0 = (bLevel - dot(nB, base)) / tilt;
    const b1 = (bLevel + B.thickness - dot(nB, base)) / tilt;
    const alongs = steps(
      Math.max(aLo, Math.min(b0, b1)),
      Math.min(aHi, Math.max(b0, b1)),
      eps,
      pitch,
    );
    for (const along of alongs.at) {
      const at = add(base, side, along);
      const [fromA, dirA] = localLine(invA, at, line);
      const [fromB, dirB] = localLine(invB, at, line);
      total +=
        shared(spans(A.outline, fromA, dirA), spans(B.outline, fromB, dirB), eps) *
        depths.size *
        alongs.size;
      if (total > volume) return true;
    }
  }
  return false;
}

function stacked(
  A: AssemblyPart,
  B: AssemblyPart,
  invA: number[],
  eps: number,
  pitch: number,
  volume: number,
): boolean {
  const rel = [0, 1, 2, 3].flatMap((r) =>
    [0, 1, 2, 3].map((c) => {
      let v = 0;
      for (let k = 0; k < 4; k++) v += invA[r * 4 + k] * B.matrix[k * 4 + c];
      return v;
    }),
  );
  const z0 = rel[11];
  const z1 = rel[11] + rel[10] * B.thickness;
  const depth = Math.min(A.thickness, Math.max(z0, z1)) - Math.max(0, Math.min(z0, z1));
  if (depth <= eps) return false;
  const moved: Poly[] = B.outline.map((ring) =>
    ring.map(
      ([x, y]) => [rel[0] * x + rel[1] * y + rel[3], rel[4] * x + rel[5] * y + rel[7]] as Vec2,
    ),
  );
  const [ax0, ay0, ax1, ay1] = bounds2(A.outline);
  const [bx0, by0, bx1, by1] = bounds2(moved);
  const rows = steps(Math.max(ay0, by0), Math.min(ay1, by1), eps, pitch);
  let across = 0;
  for (const y of rows.at) {
    across +=
      shared(spans(A.outline, [0, y], [1, 0]), spans(moved, [0, y], [1, 0]), eps) *
      rows.size *
      depth;
    if (across > volume) return true;
  }
  const columns = steps(Math.max(ax0, bx0), Math.min(ax1, bx1), eps, pitch);
  let down = 0;
  for (const x of columns.at) {
    down +=
      shared(spans(A.outline, [x, 0], [0, 1]), spans(moved, [x, 0], [0, 1]), eps) *
      columns.size *
      depth;
    if (down > volume) return true;
  }
  return false;
}

export function collisions(
  parts: AssemblyPart[],
  maxPairs = Infinity,
  eps = 0.05,
  pitch = 0.25,
  volume = 0.1,
): { found: [AssemblyPart, AssemblyPart][]; complete: boolean } {
  const boxes = parts.map(worldBox);
  const inverses = parts.map((p) => invertRigid(p.matrix));
  const order = parts.map((_, i) => i).sort((i, j) => boxes[i][0][0] - boxes[j][0][0]);
  const found: [AssemblyPart, AssemblyPart][] = [];
  let checked = 0;
  for (let i = 0; i < order.length; i++)
    for (let j = i + 1; j < order.length; j++) {
      const a = order[i];
      const b = order[j];
      if (boxes[b][0][0] >= boxes[a][1][0] - eps) break;
      if (!overlaps(boxes[a], boxes[b], eps)) continue;
      if (++checked > maxPairs) return { found, complete: false };
      const [A, B] = a < b ? [parts[a], parts[b]] : [parts[b], parts[a]];
      const [invA, invB] = a < b ? [inverses[a], inverses[b]] : [inverses[b], inverses[a]];
      const parallel = Math.hypot(...cross(normal(A.matrix), normal(B.matrix))) < 1e-9;
      const hit = parallel
        ? stacked(A, B, invA, eps, pitch, volume)
        : crossing(A, B, invA, invB, eps, pitch, volume);
      if (hit) found.push([A, B]);
    }
  return { found, complete: true };
}

export function translation(x: number, y: number, z: number): number[] {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
}

export const IDENTITY4 = translation(0, 0, 0);

export function invert(m: number[]): number[] {
  return invertRigid(m);
}

// One bend: the part beyond x1 turns `angle` degrees about an axis along
// y, its middle layer bending round a radius that makes the hinge's
// length. A positive angle folds the far end up, towards the top face.
function bendAt(b: Bend, t: number, a = b.angle, x = b.x1): number[] {
  const L = x - b.x0;
  if (!a || !(L > 0)) return translation(0, 0, 0);
  const R = (b.x1 - b.x0) / ((b.angle * Math.PI) / 180);
  const cz = t / 2 + R;
  return multiply(
    translation(b.x0, 0, cz),
    multiply(rotation(1, -a), translation(-b.x0 - L, 0, -cz)),
  );
}

export function sortedBends(bends: Bend[]): Bend[] {
  return [...bends].sort((a, b) => a.x0 - b.x0);
}

// The matrices for the flat runs between bends, in the part's own
// coordinates: the first is the identity, the run after bend k is the
// product of the first k bends
export function bendRuns(bends: Bend[], t: number): number[][] {
  const out = [translation(0, 0, 0)];
  for (const b of sortedBends(bends)) out.push(multiply(out[out.length - 1], bendAt(b, t)));
  return out;
}

// Where a point of a bent part goes, in the part's own coordinates
export function bendPoint(bends: Bend[], t: number, p: Vec3): Vec3 {
  const list = sortedBends(bends);
  const runs = bendRuns(list, t);
  for (let k = list.length - 1; k >= 0; k--) {
    const b = list[k];
    if (p[0] >= b.x1) return apply(runs[k + 1], ...p);
    if (p[0] > b.x0) {
      const part = (p[0] - b.x0) / (b.x1 - b.x0);
      const m = multiply(runs[k], bendAt(b, t, b.angle * part, p[0]));
      return apply(m, ...p);
    }
  }
  return p;
}

// Which flat run a point along x is on
export function runOf(bends: Bend[], x: number): number {
  return sortedBends(bends).filter((b) => (b.x0 + b.x1) / 2 < x).length;
}

// A bent part as rigid pieces, the hinges left out, to check for
// collisions
export function bentPieces(p: AssemblyPart): AssemblyPart[] {
  if (!p.bends?.length) return [p];
  const list = sortedBends(p.bends);
  const runs = bendRuns(list, p.thickness);
  const BIG = 1e7;
  const out: AssemblyPart[] = [];
  for (let k = 0; k <= list.length; k++) {
    const from = k === 0 ? -BIG : list[k - 1].x1;
    const to = k === list.length ? BIG : list[k].x0;
    if (!(to > from)) continue;
    const band: Poly = [
      [from, -BIG],
      [to, -BIG],
      [to, BIG],
      [from, BIG],
    ];
    const outline = intersection(p.outline, [band]);
    if (outline.length)
      out.push({ ...p, outline, bends: undefined, matrix: multiply(p.matrix, runs[k]) });
  }
  return out;
}

// Areas of a part cut up for a 3D view: each piece its outline and then
// its holes. Where the part bends, the pieces are bands `step` wide across
// the hinge, so bendPoint() can curve them smoothly.
export function meshPieces(regions: Poly[], bends?: Bend[], step = 2): Poly[][] {
  if (!bends?.length) return pieces(regions);
  const BIG = 1e7;
  const cuts: number[] = [];
  for (const b of sortedBends(bends)) {
    const n = Math.max(1, Math.ceil((b.x1 - b.x0) / step));
    for (let i = 0; i <= n; i++) cuts.push(b.x0 + ((b.x1 - b.x0) * i) / n);
  }
  const xs = [-BIG, ...cuts.sort((a, b) => a - b), BIG];
  const out: Poly[][] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    if (!(xs[i + 1] > xs[i])) continue;
    const band: Poly = [
      [xs[i], -BIG],
      [xs[i + 1], -BIG],
      [xs[i + 1], BIG],
      [xs[i], BIG],
    ];
    for (const p of pieces(intersection(regions, [band]))) out.push(p);
  }
  return out;
}
