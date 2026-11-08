// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import type { Placement } from './assembly.js';
import {
  Clipper64,
  ClipType,
  EndType,
  FillRule,
  JoinType,
  PolyTree64,
  inflatePaths,
  union as clipUnion,
  type Path64,
  type Paths64,
} from 'clipper2-ts';

export type Pt = [number, number];
export type Poly = Pt[];
export type Matrix = [number, number, number, number, number, number];

export interface Layer {
  regions: Poly[];
  lines: Poly[];
}

export interface PartShape {
  name: string;
  qty: number;
  layers: Map<string, Layer>;
  thickness: number;
  kerf: number;
  material: string;
  placements?: Placement[];
  // Glued layers per placement, stacked along the part's own z
  stack?: number;
  // Living hinge bends, along the part's x: [x0, x1, angle]
  bends?: Bend[];
  // The part this one is glued to, so it moves with that part's bends
  on?: string;
  // Parts whose tabs pass through this one: slots cut where they meet it
  slots?: string[];
  clearance?: number;
  // The assembly step that adds it, 0 for none
  step?: number;
  // Glued flat on another part's face, placed on it
  glue?: { host: string; face: 'top' | 'bottom' };
  // Cut mirrored, left to right
  mirrored?: boolean;
  // Which of the part() call's copies these are, 1 up, when mirror per
  // copy split them: the others are a part of their own
  copies?: number[];
}

export interface Bend {
  x0: number;
  x1: number;
  angle: number;
}

export interface Shape {
  layers: Map<string, Layer>;
  parts: PartShape[];
}

const SCALE = 10_000;

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function emptyShape(): Shape {
  return { layers: new Map(), parts: [] };
}

export function regionShape(regions: Poly[], layer = 'cut'): Shape {
  return { layers: new Map([[layer, { regions, lines: [] }]]), parts: [] };
}

export function lineShape(lines: Poly[], layer = 'cut'): Shape {
  return { layers: new Map([[layer, { regions: [], lines }]]), parts: [] };
}

export function isEmpty(s: Shape): boolean {
  if (s.parts.length) return false;
  for (const l of s.layers.values()) if (l.regions.length || l.lines.length) return false;
  return true;
}

const to64 = (polys: Poly[]): Paths64 =>
  polys.map((p) => p.map(([x, y]) => ({ x: Math.round(x * SCALE), y: Math.round(y * SCALE) })));

// A closed outline without repeated points and without points on a
// straight line through their neighbours, such as the tip of a spike drawn
// out and back. The region is the same, and Clipper can run out of memory
// on some outlines that have them.
function ring(p: Path64): Path64 {
  const straight = (a: Path64[number], b: Path64[number], c: Path64[number]) =>
    (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) === 0;
  const out: Path64 = [];
  for (const q of p) {
    while (out.length >= 2 && straight(out[out.length - 2], out[out.length - 1], q)) out.pop();
    const last = out[out.length - 1];
    if (!last || last.x !== q.x || last.y !== q.y) out.push(q);
  }
  // Where the outline closes, back at its start
  for (let changed = true; changed && out.length >= 3; ) {
    const n = out.length;
    changed = true;
    if (out[n - 1].x === out[0].x && out[n - 1].y === out[0].y) out.pop();
    else if (straight(out[n - 2], out[n - 1], out[0])) out.pop();
    else if (straight(out[n - 1], out[0], out[1])) out.shift();
    else changed = false;
  }
  return out;
}

const rings = (polys: Poly[]): Paths64 => to64(polys).map(ring);

const from64 = (paths: Paths64): Poly[] =>
  paths.filter((p) => p.length >= 2).map((p) => p.map((q): Pt => [q.x / SCALE, q.y / SCALE]));

export function union(regions: Poly[], fill: 'nonzero' | 'evenodd' = 'nonzero'): Poly[] {
  if (!regions.length) return [];
  const rule = fill === 'evenodd' ? FillRule.EvenOdd : FillRule.NonZero;
  return from64(clipUnion(rings(regions), rule)).filter((p) => p.length >= 3);
}

function boolean(type: ClipType, a: Poly[], b: Poly[]): Poly[] {
  if (!a.length) return [];
  const c = new Clipper64();
  c.addSubject(rings(a));
  if (b.length) c.addClip(rings(b));
  const out: Paths64 = [];
  c.execute(type, FillRule.NonZero, out);
  return from64(out).filter((p) => p.length >= 3);
}

export const difference = (a: Poly[], b: Poly[]) =>
  b.length ? boolean(ClipType.Difference, a, b) : union(a);
export const intersection = (a: Poly[], b: Poly[]) => boolean(ClipType.Intersection, a, b);
export const xor = (a: Poly[], b: Poly[]) => boolean(ClipType.Xor, a, b);

// Lines cut where they cross the edges of a region, keeping the pieces in
// it, or out of it. Clipper's clipping of open paths can add lines that
// were never there, or run out of memory, on some closed polylines, so the
// lines are cut here: each piece is kept or not by whether its middle is in
// the region. A piece along an edge is in neither: the edge is cut anyway.
export function clipLines(lines: Poly[], region: Poly[], keep: 'inside' | 'outside'): Poly[] {
  if (!lines.length) return [];
  if (!region.length) return keep === 'outside' ? lines : [];
  const edges: [Pt, Pt][] = [];
  for (const r of region)
    for (let i = 0; i < r.length; i++) {
      const a = r[i],
        b = r[(i + 1) % r.length];
      if (a[0] !== b[0] || a[1] !== b[1]) edges.push([a, b]);
    }
  if (!edges.length) return keep === 'outside' ? lines : [];
  const box = bounds(region)!;
  const size =
    Math.max(box[2] - box[0], box[3] - box[1], 1e-6) / Math.max(1, Math.sqrt(edges.length));
  const cell = (v: number) => Math.floor(v / size);
  // Edges by grid cell, for crossings, and by row, for the winding number
  const cells = new Map<string, number[]>();
  const rows = new Map<number, number[]>();
  const add = <K>(m: Map<K, number[]>, k: K, i: number) => {
    const l = m.get(k);
    if (!l) m.set(k, [i]);
    else if (l[l.length - 1] !== i) l.push(i);
  };
  edges.forEach(([a, b], i) => {
    const n = Math.max(1, Math.ceil((Math.hypot(b[0] - a[0], b[1] - a[1]) / size) * 2));
    for (let k = 0; k <= n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n,
        y = a[1] + ((b[1] - a[1]) * k) / n;
      for (const dx of [-1, 0, 1])
        for (const dy of [-1, 0, 1]) add(cells, `${cell(x) + dx},${cell(y) + dy}`, i);
    }
    for (let y = cell(Math.min(a[1], b[1])); y <= cell(Math.max(a[1], b[1])); y++) add(rows, y, i);
  });
  const near = (a: Pt, b: Pt): Set<number> => {
    const out = new Set<number>();
    const n = Math.max(1, Math.ceil((Math.hypot(b[0] - a[0], b[1] - a[1]) / size) * 2));
    for (let k = 0; k <= n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n,
        y = a[1] + ((b[1] - a[1]) * k) / n;
      for (const i of cells.get(`${cell(x)},${cell(y)}`) ?? []) out.add(i);
    }
    return out;
  };
  // On an edge: within half of Clipper's resolution, where outlines meet
  const edge = 0.5 / SCALE;
  const within = (p: Pt): boolean | undefined => {
    for (const i of cells.get(`${cell(p[0])},${cell(p[1])}`) ?? []) {
      const [a, b] = edges[i];
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)),
      );
      if (Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) <= edge) return undefined;
    }
    let wn = 0;
    for (const i of rows.get(cell(p[1])) ?? []) {
      const [a, b] = edges[i];
      const side = (b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1]);
      if (a[1] <= p[1]) {
        if (b[1] > p[1] && side > 0) wn++;
      } else if (b[1] <= p[1] && side < 0) wn--;
    }
    return wn !== 0;
  };
  const r4 = (v: number) => Math.round(v * SCALE) / SCALE;
  const out: Poly[] = [];
  for (const line of lines) {
    let cur: Poly | null = null;
    const flush = () => {
      if (cur && cur.length >= 2) out.push(cur);
      cur = null;
    };
    for (let k = 1; k < line.length; k++) {
      const s = line[k - 1],
        e = line[k];
      const dx = e[0] - s[0],
        dy = e[1] - s[1];
      if (!dx && !dy) continue;
      // Where the segment meets the region's edges, as fractions along it
      const ts = [0, 1];
      for (const i of near(s, e)) {
        const [a, b] = edges[i];
        const ex = b[0] - a[0],
          ey = b[1] - a[1];
        const den = dx * ey - dy * ex;
        if (Math.abs(den) > 1e-15) {
          const t = ((a[0] - s[0]) * ey - (a[1] - s[1]) * ex) / den;
          const u = ((a[0] - s[0]) * dy - (a[1] - s[1]) * dx) / den;
          if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
        } else {
          // Along the same line: where the edge's ends fall on the segment
          const l2 = dx * dx + dy * dy;
          for (const q of [a, b]) {
            const t = ((q[0] - s[0]) * dx + (q[1] - s[1]) * dy) / l2;
            const off = Math.abs((q[0] - s[0]) * dy - (q[1] - s[1]) * dx) / Math.sqrt(l2);
            if (t > 0 && t < 1 && off <= edge) ts.push(t);
          }
        }
      }
      ts.sort((x, y) => x - y);
      for (let j = 1; j < ts.length; j++) {
        if (ts[j] - ts[j - 1] < 1e-12) continue;
        const p0: Pt = [r4(s[0] + dx * ts[j - 1]), r4(s[1] + dy * ts[j - 1])];
        const p1: Pt = [r4(s[0] + dx * ts[j]), r4(s[1] + dy * ts[j])];
        const tm = (ts[j - 1] + ts[j]) / 2;
        const inside = within([s[0] + dx * tm, s[1] + dy * tm]);
        if (inside !== undefined && inside === (keep === 'inside')) {
          const last: Pt | undefined = cur ? cur[cur.length - 1] : undefined;
          if (cur && last && last[0] === p0[0] && last[1] === p0[1]) {
            if (p1[0] !== last[0] || p1[1] !== last[1]) cur.push(p1);
          } else {
            flush();
            cur = [p0, p1];
          }
        } else flush();
      }
    }
    flush();
  }
  return out;
}

export function offset(
  regions: Poly[],
  delta: number,
  join: 'round' | 'miter' | 'square' = 'round',
  arcTolerance = 0.01,
): Poly[] {
  if (!regions.length) return [];
  if (delta === 0) return union(regions);
  const jt =
    join === 'round' ? JoinType.Round : join === 'square' ? JoinType.Square : JoinType.Miter;
  const out = inflatePaths(
    rings(union(regions)),
    delta * SCALE,
    jt,
    EndType.Polygon,
    2,
    arcTolerance * SCALE,
  );
  return from64(out).filter((p) => p.length >= 3);
}

export function strokeLines(lines: Poly[], width: number): Poly[] {
  if (!lines.length || width <= 0) return [];
  const out = inflatePaths(
    to64(lines),
    (width / 2) * SCALE,
    JoinType.Round,
    EndType.Round,
    2,
    0.01 * SCALE,
  );
  return from64(out);
}

export function pieces(regions: Poly[]): Poly[][] {
  if (!regions.length) return [];
  const tree = new PolyTree64();
  const c = new Clipper64();
  c.addSubject(rings(regions));
  c.execute(ClipType.Union, FillRule.NonZero, tree);
  const out: Poly[][] = [];
  const walk = (node: PolyTree64 | any) => {
    for (let i = 0; i < node.count; i++) {
      const child = node.child(i);
      const group: Path64[] = [child.poly];
      for (let k = 0; k < child.count; k++) {
        const hole = child.child(k);
        group.push(hole.poly);
        walk(hole);
      }
      out.push(from64(group));
    }
  };
  walk(tree);
  return out;
}

export function area(p: Poly): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++)
    a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return -a / 2;
}

/** The area of regions (holes counting against it) and their centroid. */
export function regionMoments(regions: Poly[]): { area: number; centroid: [number, number] } {
  let a = 0,
    cx = 0,
    cy = 0;
  for (const p of regions) {
    if (p.length < 3) continue;
    // About the ring's first point, so far-off rings keep their precision
    const [ox, oy] = p[0];
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const xj = p[j][0] - ox,
        yj = p[j][1] - oy,
        xi = p[i][0] - ox,
        yi = p[i][1] - oy;
      const k = xj * yi - xi * yj;
      a += k / 2;
      cx += ((xj + xi) * k) / 6 + (ox * k) / 2;
      cy += ((yj + yi) * k) / 6 + (oy * k) / 2;
    }
  }
  return Math.abs(a) < 1e-12
    ? { area: 0, centroid: [0, 0] }
    : { area: Math.abs(a), centroid: [cx / a, cy / a] };
}

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m: Matrix, [x, y]: Pt): Pt {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function transformLayers(layers: Map<string, Layer>, m: Matrix): Map<string, Layer> {
  const flip = m[0] * m[3] - m[1] * m[2] < 0;
  const out = new Map<string, Layer>();
  for (const [k, l] of layers) {
    out.set(k, {
      regions: l.regions.map((p) => {
        const q = p.map((pt) => apply(m, pt));
        return flip ? q.reverse() : q;
      }),
      lines: l.lines.map((p) => p.map((pt) => apply(m, pt))),
    });
  }
  return out;
}

export function transform(s: Shape, m: Matrix): Shape {
  return {
    layers: transformLayers(s.layers, m),
    parts: s.parts.map((p) => ({ ...p, layers: transformLayers(p.layers, m) })),
  };
}

export function merge(shapes: Shape[]): Shape {
  const out = emptyShape();
  for (const s of shapes) {
    for (const [k, l] of s.layers) {
      const t = out.layers.get(k) ?? { regions: [], lines: [] };
      for (const p of l.regions) t.regions.push(p);
      for (const p of l.lines) t.lines.push(p);
      out.layers.set(k, t);
    }
    for (const p of s.parts) out.parts.push(p);
  }
  return out;
}

function allOn(layers: Map<string, Layer>, layer: string): Map<string, Layer> {
  const all: Layer = { regions: [], lines: [] };
  for (const l of layers.values()) {
    for (const p of l.regions) all.regions.push(p);
    for (const p of l.lines) all.lines.push(p);
  }
  return new Map([[layer, all]]);
}

// Moves everything onto one layer. A whole part can only become a guide:
// on any other layer it would lose its cut outline.
export function retag(s: Shape, layer: string): Shape {
  if (s.parts.length && layer !== 'guide')
    throw new Error(
      `a part cannot go on the ${layer} layer as a whole. Put ${layer}() inside part() instead.`,
    );
  return {
    layers: allOn(s.layers, layer),
    parts: s.parts.map((p) => ({ ...p, layers: allOn(p.layers, layer) })),
  };
}

export function bounds(polys: Poly[]): [number, number, number, number] | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of polys)
    for (const [x, y] of p) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}

export function layerBounds(
  layers: Map<string, Layer>,
  skip?: (name: string) => boolean,
): [number, number, number, number] | null {
  const all: Poly[] = [];
  for (const [k, l] of layers) {
    if (skip?.(k)) continue;
    for (const p of [...l.regions, ...l.lines]) all.push(p);
  }
  return bounds(all);
}

export function hull(points: Pt[]): Poly {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function fragments(r: number, fn: number, fa: number, fs: number): number {
  if (r < 1e-9) return 3;
  if (fn > 0) return Math.max(Math.floor(fn), 3);
  return Math.max(Math.ceil(Math.min(360 / fa, (r * 2 * Math.PI) / fs)), 5);
}

export function ellipsePoly(rx: number, ry: number, n: number): Poly {
  const out: Poly = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push([rx * Math.cos(a), ry * Math.sin(a)]);
  }
  return out;
}

export function roundedRect(w: number, h: number, r: number, segs: (r: number) => number): Poly {
  r = Math.min(r, w / 2, h / 2);
  if (r <= 0)
    return [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ];
  const n = Math.max(1, Math.ceil(segs(r) / 4));
  const out: Poly = [];
  const corners: [number, number, number][] = [
    [w - r, r, -90],
    [w - r, h - r, 0],
    [r, h - r, 90],
    [r, r, 180],
  ];
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= n; i++) {
      const a = ((a0 + (90 * i) / n) * Math.PI) / 180;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  return out;
}
