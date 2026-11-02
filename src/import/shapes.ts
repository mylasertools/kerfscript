// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Geometry for the SVG importer: flattening, distances between outlines,
// and the recognisers that find circles, rectangles, joints and keyholes
// in an outline. Every recogniser checks its result against the outline
// before it answers.

import { area, bounds, difference, ellipsePoly, union, type Poly, type Pt } from '../geometry.js';
import { fingerCount, fingerRect, type Edge } from '../joinery.js';
import type { Sub } from './svg.js';

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const rot = ([x, y]: Pt, deg: number): Pt => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a),
    s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
};
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];

export function flattenSub(s: Sub, tol = 0.005): Poly {
  const out: Poly = [s.segs[0].a];
  for (const g of s.segs) {
    if (g.c === 'L') out.push(g.b);
    else {
      const len = dist(g.a, g.p1) + dist(g.p1, g.p2) + dist(g.p2, g.b);
      const n = Math.max(2, Math.min(512, Math.ceil(Math.sqrt(len / tol))));
      for (let i = 1; i <= n; i++) {
        const t = i / n,
          u = 1 - t;
        out.push([
          u * u * u * g.a[0] +
            3 * u * u * t * g.p1[0] +
            3 * u * t * t * g.p2[0] +
            t * t * t * g.b[0],
          u * u * u * g.a[1] +
            3 * u * u * t * g.p1[1] +
            3 * u * t * t * g.p2[1] +
            t * t * t * g.b[1],
        ]);
      }
    }
  }
  if (s.closed && out.length > 1 && dist(out[0], out[out.length - 1]) < 1e-9) out.pop();
  return out;
}

export function perimeter(p: Poly, closed = true): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]);
  return closed && p.length > 2 ? s + dist(p[p.length - 1], p[0]) : s;
}

// The corners of an outline and points between them at most `step` apart
export function resample(p: Poly, closed: boolean, step: number): Pt[] {
  const out: Pt[] = [];
  const n = closed ? p.length : p.length - 1;
  for (let i = 0; i < n; i++) {
    const a = p[i],
      b = p[(i + 1) % p.length];
    out.push(a);
    const k = Math.floor(dist(a, b) / step);
    for (let j = 1; j < k; j++)
      out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed && p.length) out.push(p[p.length - 1]);
  return out;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

// Edges in a grid, to ask quickly whether a point is near any of them
class EdgeIndex {
  private cells = new Map<string, [Pt, Pt][]>();
  constructor(
    polys: Poly[],
    closed: boolean,
    private size: number,
  ) {
    for (const p of polys) {
      const n = closed ? p.length : p.length - 1;
      for (let i = 0; i < n; i++) {
        const a = p[i],
          b = p[(i + 1) % p.length];
        const k = Math.max(1, Math.ceil(dist(a, b) / (size * 2)));
        for (let j = 0; j < k; j++) {
          const s: Pt = [a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k];
          const e: Pt = [
            a[0] + ((b[0] - a[0]) * (j + 1)) / k,
            a[1] + ((b[1] - a[1]) * (j + 1)) / k,
          ];
          const x0 = Math.floor(Math.min(s[0], e[0]) / size),
            x1 = Math.floor(Math.max(s[0], e[0]) / size);
          const y0 = Math.floor(Math.min(s[1], e[1]) / size),
            y1 = Math.floor(Math.max(s[1], e[1]) / size);
          for (let x = x0; x <= x1; x++)
            for (let y = y0; y <= y1; y++) {
              const key = `${x},${y}`;
              const list = this.cells.get(key);
              if (list) list.push([s, e]);
              else this.cells.set(key, [[s, e]]);
            }
        }
      }
    }
  }
  near(p: Pt, tol: number): boolean {
    const x0 = Math.floor((p[0] - tol) / this.size),
      x1 = Math.floor((p[0] + tol) / this.size);
    const y0 = Math.floor((p[1] - tol) / this.size),
      y1 = Math.floor((p[1] + tol) / this.size);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (const [a, b] of this.cells.get(`${x},${y}`) ?? [])
          if (segDist(p, a, b) <= tol) return true;
    return false;
  }
  // Whether the segment from a to b touches or crosses an edge
  meets(a: Pt, b: Pt, tol: number): boolean {
    const k = Math.max(1, Math.ceil(dist(a, b) / (this.size * 2)));
    for (let j = 0; j < k; j++) {
      const s: Pt = [a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k];
      const e: Pt = [a[0] + ((b[0] - a[0]) * (j + 1)) / k, a[1] + ((b[1] - a[1]) * (j + 1)) / k];
      const x0 = Math.floor((Math.min(s[0], e[0]) - tol) / this.size),
        x1 = Math.floor((Math.max(s[0], e[0]) + tol) / this.size);
      const y0 = Math.floor((Math.min(s[1], e[1]) - tol) / this.size),
        y1 = Math.floor((Math.max(s[1], e[1]) + tol) / this.size);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++)
          for (const [c, d] of this.cells.get(`${x},${y}`) ?? [])
            if (segSeg(s, e, c, d) <= tol) return true;
    }
    return false;
  }
}

// The distance between two segments: 0 where they cross
function segSeg(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a),
    d2 = o(c, d, b),
    d3 = o(a, b, c),
    d4 = o(a, b, d);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b));
}

// Whether two parts of an outline that are apart along it come within
// `tol` of each other, as the sides of a slit drawn into it do
function touchesItself(p: Poly, tol: number, apart = 0.2): boolean {
  const n = p.length;
  if (n < 4) return false;
  const at: number[] = [0];
  for (let i = 1; i <= n; i++) at.push(at[i - 1] + dist(p[i - 1], p[i % n]));
  const per = at[n];
  const box = bounds([p])!;
  const size = Math.max(box[2] - box[0], box[3] - box[1], tol) / Math.max(1, Math.sqrt(n));
  const cells = new Map<string, number[]>();
  const cellsOf = (a: Pt, b: Pt) => {
    const keys: string[] = [];
    const x0 = Math.floor((Math.min(a[0], b[0]) - tol) / size),
      x1 = Math.floor((Math.max(a[0], b[0]) + tol) / size);
    const y0 = Math.floor((Math.min(a[1], b[1]) - tol) / size),
      y1 = Math.floor((Math.max(a[1], b[1]) + tol) / size);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return null;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(`${x},${y}`);
    return keys;
  };
  for (let i = 0; i < n; i++) {
    const a = p[i],
      b = p[(i + 1) % n];
    const keys = cellsOf(a, b);
    if (!keys) return false;
    for (const k of keys) {
      for (const j of cells.get(k) ?? []) {
        const along = Math.abs(at[i] - at[j]);
        if (Math.min(along, per - along) - dist(a, b) - dist(p[j], p[(j + 1) % n]) < apart)
          continue;
        if (segSeg(a, b, p[j], p[(j + 1) % n]) <= tol) return true;
      }
    }
    for (const k of keys) {
      const l = cells.get(k);
      if (l) l.push(i);
      else cells.set(k, [i]);
    }
  }
  return false;
}

// The outlines that cross themselves, and the pairs that touch or cross
// each other
export function tangled(
  polys: Poly[],
  tol: number,
): { self: boolean[]; pairs: [number, number][] } {
  const out = polys.map(() => false);
  const pairs: [number, number][] = [];
  const boxes = polys.map((p) => bounds([p])!);
  polys.forEach((p, i) => {
    // Its region must have the same area and the same edge: lines drawn out
    // and back along the outline have no area, and would be lost
    const u = union([p]);
    const a = u.reduce((s, q) => s + area(q), 0);
    const per = perimeter(p);
    const uper = u.reduce((s, q) => s + perimeter(q), 0);
    if (
      u.length !== 1 ||
      Math.abs(a - Math.abs(area(p))) > per * 1e-3 + 1e-6 ||
      Math.abs(uper - per) > per * 1e-3 + 0.05 ||
      touchesItself(p, tol)
    )
      out[i] = true;
  });
  const index = new Map<number, EdgeIndex>();
  const idx = (i: number) => {
    let e = index.get(i);
    if (!e) index.set(i, (e = new EdgeIndex([polys[i]], true, Math.max(tol * 4, 1))));
    return e;
  };
  const order = polys.map((_, i) => i).sort((i, j) => boxes[i][0] - boxes[j][0]);
  const active: number[] = [];
  for (const i of order) {
    const [x0, y0, x1, y1] = boxes[i];
    for (let k = active.length - 1; k >= 0; k--)
      if (boxes[active[k]][2] < x0 - tol) active.splice(k, 1);
    for (const j of active) {
      const b = boxes[j];
      if (b[1] > y1 + tol || b[3] < y0 - tol) continue;
      // The outline with fewer points is walked along the other
      const [s, big] = polys[i].length <= polys[j].length ? [i, j] : [j, i];
      const p = polys[s];
      const e = idx(big);
      for (let k = 0; k < p.length; k++)
        if (e.meets(p[k], p[(k + 1) % p.length], tol)) {
          pairs.push([i, j]);
          break;
        }
    }
    active.push(i);
  }
  return { self: out, pairs };
}

// Whether two sets of outlines (or lines) trace the same path: every point
// of each is within `tol` of the other.
export function sameOutlines(a: Poly[], b: Poly[], tol: number, closed = true): boolean {
  if (!a.length || !b.length) return a.length === b.length;
  const step = Math.max(tol * 2, 0.2);
  const ia = new EdgeIndex(a, closed, Math.max(tol * 4, 1));
  const ib = new EdgeIndex(b, closed, Math.max(tol * 4, 1));
  for (const p of a) for (const q of resample(p, closed, step)) if (!ib.near(q, tol)) return false;
  for (const p of b) for (const q of resample(p, closed, step)) if (!ia.near(q, tol)) return false;
  return true;
}

// A test for whether a line lies in a part's material: inside its outline
// and outside its holes, touching their edges at most at its ends. A part
// clips its lines and marks to its material, so only these can go in it.
export function materialTest(outline: Poly, holes: Poly[], tol: number) {
  const idx = new EdgeIndex([outline, ...holes], true, Math.max(tol * 4, 1));
  const solid = (q: Pt) => inside(q, outline) && !holes.some((h) => inside(q, h));
  return (line: Poly, closed: boolean): boolean => {
    const n = closed ? line.length : line.length - 1;
    if (n < 1) return false;
    // Only a line's two ends may touch an edge; everywhere else it must
    // keep clear, and is then all on one side of every edge
    let away: Pt | undefined;
    for (let i = 0; i < n; i++) {
      const a = line[i],
        b = line[(i + 1) % line.length];
      if (!idx.meets(a, b, tol)) {
        away ??= [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        continue;
      }
      if (closed || (i !== 0 && i !== n - 1)) return false;
      // An end segment may touch an edge only at the end of the line: cut
      // off there, it must keep clear of every edge
      const l = dist(a, b);
      const cut = Math.min(tol * 3, l / 3) / l;
      const s0: Pt = i === 0 ? [a[0] + (b[0] - a[0]) * cut, a[1] + (b[1] - a[1]) * cut] : a;
      const s1: Pt = i === n - 1 ? [b[0] - (b[0] - a[0]) * cut, b[1] - (b[1] - a[1]) * cut] : b;
      if (idx.meets(s0, s1, tol)) return false;
      away ??= [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    }
    return away ? solid(away) : true;
  };
}

// Whether any of the lines comes within `tol` of the outline
export function touches(lines: Poly[], outline: Poly, tol: number): boolean {
  if (!lines.length) return false;
  const idx = new EdgeIndex([outline], true, Math.max(tol * 4, 1));
  return lines.some((l) =>
    resample(l, false, Math.max(tol * 2, 0.2)).some((q) => idx.near(q, tol)),
  );
}

export function inside(pt: Pt, poly: Poly): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function fitCircle(pts: Pt[]): { c: Pt; r: number } | null {
  const n = pts.length;
  if (n < 3) return null;
  let mx = 0,
    my = 0;
  for (const [x, y] of pts) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;
  let suu = 0,
    suv = 0,
    svv = 0,
    suuu = 0,
    svvv = 0,
    suvv = 0,
    svuu = 0;
  for (const [x, y] of pts) {
    const u = x - mx,
      v = y - my;
    suu += u * u;
    suv += u * v;
    svv += v * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12) return null;
  const b1 = (suuu + suvv) / 2,
    b2 = (svvv + svuu) / 2;
  const uc = (b1 * svv - b2 * suv) / det,
    vc = (b2 * suu - b1 * suv) / det;
  return { c: [uc + mx, vc + my], r: Math.sqrt(uc * uc + vc * vc + (suu + svv) / n) };
}

// Douglas-Peucker on a closed outline: its corners, without the points on
// straight runs
export function simplify(p: Poly, tol = 0.01): Poly {
  if (p.length < 4) return p;
  let far = 0;
  for (let i = 1; i < p.length; i++) if (dist(p[0], p[i]) > dist(p[0], p[far])) far = i;
  const run = (pts: Pt[]): Pt[] => {
    if (pts.length < 3) return pts;
    let best = 0,
      at = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
      if (d > best) {
        best = d;
        at = i;
      }
    }
    if (best <= tol) return [pts[0], pts[pts.length - 1]];
    const l = run(pts.slice(0, at + 1));
    return [...l.slice(0, -1), ...run(pts.slice(at))];
  };
  const a = run(p.slice(0, far + 1));
  const b = run([...p.slice(far), p[0]]);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  // Drop corners on a straight line through the start point too
  const tidy: Pt[] = [];
  for (let i = 0; i < out.length; i++) {
    const prev = out[(i - 1 + out.length) % out.length],
      next = out[(i + 1) % out.length];
    if (segDist(out[i], prev, next) > tol) tidy.push(out[i]);
  }
  return tidy.length >= 3 ? tidy : out;
}

// Half the kerf a drawing was compensated for: KerfScript and most laser
// tools move cut outlines out by half the beam's width, which rounds every
// outer corner with that radius. Undefined when the corners say otherwise.
export function kerfRadius(polys: Poly[]): number | undefined {
  // Radii of the small arcs at outer corners, and at inner ones, which
  // compensation leaves sharp
  const outer: number[] = [];
  const inner: number[] = [];
  for (const poly of polys.slice(0, 300)) {
    const c = simplify(poly, 0.002);
    const n = c.length;
    const start = c.findIndex((p, k) => dist(p, c[(k + 1) % n]) >= 0.5);
    if (n < 4 || start < 0) continue;
    const ccw = area(poly) > 0;
    let run: Pt[] = [];
    for (let s = 1; s <= n; s++) {
      const k = (start + s) % n;
      const p = c[k],
        q = c[(k + 1) % n];
      if (dist(p, q) < 0.3) {
        if (!run.length) run.push(p);
        run.push(q);
        continue;
      }
      if (run.length >= 3) {
        const f = fitCircle(run);
        const [a, b, z] = [run[0], run[1], run[run.length - 1]];
        const turn = (b[0] - a[0]) * (z[1] - a[1]) - (b[1] - a[1]) * (z[0] - a[0]);
        if (f && f.r > 0.005 && f.r < 0.6) (turn > 0 === ccw ? outer : inner).push(f.r);
      }
      run = [];
    }
  }
  if (outer.length < 4) return undefined;
  outer.sort((a, b) => a - b);
  const mid = outer[Math.floor(outer.length / 2)];
  const near = (r: number) => Math.abs(r - mid) <= Math.max(0.005, mid * 0.1);
  // A kerf is at most 0.4 mm; rounded inner corners are the design's own
  if (mid > 0.2 || inner.filter(near).length > outer.length * 0.2) return undefined;
  return outer.filter(near).length >= outer.length * 0.8 ? mid : undefined;
}

// The outline with each corner that a kerf offset rounded, with radius
// `r`, made sharp again: the short edges of the rounding are replaced by
// the point where the long edges on either side of them meet
export function sharpen(p: Poly, r: number): Poly {
  const n = p.length;
  const short = (i: number) => dist(p[i], p[(i + 1) % n]) < r * 1.5;
  const first = p.findIndex((_, i) => !short(i));
  if (first < 0) return p;
  const out: Pt[] = [];
  let i = first;
  do {
    // Edge i is long; the edges after it up to the next long one are short
    let j = (i + 1) % n;
    while (short(j) && j !== i) j = (j + 1) % n;
    const run = (j - i - 1 + n) % n;
    const a = p[i],
      b = p[(i + 1) % n],
      c = p[j],
      d = p[(j + 1) % n];
    let corner: Pt | undefined;
    if (run > 0) {
      const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
      if (Math.abs(den) > 1e-12) {
        const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
        const x: Pt = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        const mid = p[(i + 1 + Math.floor(run / 2)) % n];
        // Only a rounding of radius r: a design's own fillets stay
        const arc: Pt[] = [];
        for (let k = 1; k <= run + 1; k++) arc.push(p[(i + k) % n]);
        const fit = arc.length >= 3 ? fitCircle(arc) : { c: x, r };
        const round = !!fit && Math.abs(fit.r - r) <= r * 0.3;
        if (round && dist(x, mid) <= r * 2 && t >= 1 - 1e-9) corner = x;
      }
    }
    out.push(a);
    if (corner) out.push(corner);
    else for (let k = 1; k <= run; k++) out.push(p[(i + k) % n]);
    i = j;
  } while (i !== first);
  return out;
}

// ---- Numbers in the code ----

// Rounds to 0.001 mm, and to a round number when it is that close
export function snap(v: number): number {
  // Absolute: positions far from the origin must not move further
  const near = 0.003;
  for (const d of [0, 1, 2]) {
    const f = 10 ** d;
    const r = Math.round(v * f) / f;
    if (Math.abs(v - r) <= near) return Object.is(r, -0) ? 0 : r;
  }
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}
export const num = (v: number) => String(snap(v));
export const vec = (p: Pt) => `[${num(p[0])}, ${num(p[1])}]`;
export function angle(a: number): number {
  a = (((a % 360) + 540) % 360) - 180;
  const r = Math.round(a * 100) / 100;
  return Math.abs(r - Math.round(r)) < 0.02 ? Math.round(r) : r;
}

// translate() and rotate() in front of `body`, when they do anything
export function place(at: Pt, deg: number, body: string): string {
  const out: string[] = [];
  if (snap(at[0]) !== 0 || snap(at[1]) !== 0) out.push(`translate(${vec(at)})`);
  const a = angle(deg);
  if (a !== 0) out.push(`rotate(${a})`);
  return [...out, body].join(' ');
}

// ---- Recognisers ----

export interface Found {
  kind:
    | 'circle'
    | 'ellipse'
    | 'rect'
    | 'polygon'
    | 'star'
    | 'tabs'
    | 'fingers'
    | 'keyhole'
    | 'outline';
  // The shape at the origin: centred, or with its corner there for tabs
  // and fingers. `at` and `angle` place it.
  body: string;
  at: Pt;
  angle: number;
  center: Pt;
  label?: string;
  thickness?: number;
  circle?: { c: Pt; r: number };
  rect?: { w: number; h: number; r: number };
  keyhole?: { head: number; shank: number; drop: number; top: Pt };
  library?: 'tabs' | 'hanging';
  // The largest radius of its curves, which KerfScript draws as polygons
  radius?: number;
  // Joints written as notches, not as a KerfScript joint
  generic?: boolean;
  edges?: Edge[];
  finger?: number;
}

export interface Outline {
  poly: Poly;
  area: number;
  box: [number, number, number, number];
  // Where the drawn segments start: on a curve that stands for a circle,
  // these are on the circle, where the points between can bulge out
  ends?: Pt[];
}

export function outlineOf(poly: Poly, s?: Sub): Outline {
  return { poly, area: Math.abs(area(poly)), box: bounds([poly])!, ends: s?.segs.map((g) => g.a) };
}

const rectPoly = (x0: number, y0: number, x1: number, y1: number): Poly => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

export function circleOf(o: Outline, tol: number): Found | undefined {
  const per = perimeter(o.poly);
  const pts = resample(o.poly, true, Math.min(0.5, per / 256));
  // Fitted to the corners: drawn as a polygon, a circle has its corners on
  // the circle and its edges inside it
  const fit = fitCircle(o.ends && o.ends.length >= 3 ? o.ends : o.poly.length >= 8 ? o.poly : pts);
  if (!fit || fit.r < 0.05) return undefined;
  // Drawn curves only approximate a circle; a large one may be off a little,
  // but it is written so it renders within the tolerance
  const t = Math.min(tol * 0.6, Math.max(tol / 2, fit.r * 3e-4));
  for (const p of o.poly) if (Math.abs(dist(p, fit.c) - fit.r) > t) return undefined;
  // Between its corners, a circle drawn as a fine polygon is inside the
  // circle by as much as KerfScript's own circles are; a coarse polygon is
  // further in, and is not a circle
  const sag = t + fit.r * 2e-4;
  for (const p of pts) if (Math.abs(dist(p, fit.c) - fit.r) > sag) return undefined;
  if (Math.abs(o.area - Math.PI * fit.r * fit.r) > per * t * 2) return undefined;
  return {
    kind: 'circle',
    body: `circle(d = ${num(fit.r * 2)})`,
    at: fit.c,
    angle: 0,
    center: fit.c,
    circle: fit,
    radius: fit.r,
  };
}

function principalAngle(pts: Pt[]): number {
  let mx = 0,
    my = 0;
  for (const [x, y] of pts) {
    mx += x;
    my += y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0,
    syy = 0,
    sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  return (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI;
}

export function ellipseOf(o: Outline, tol: number): Found | undefined {
  const per = perimeter(o.poly);
  const pts = resample(o.poly, true, Math.min(0.5, per / 256));
  const a = principalAngle(pts);
  const local = pts.map((p) => rot(p, -a));
  const [x0, y0, x1, y1] = bounds([local])!;
  const rx = (x1 - x0) / 2,
    ry = (y1 - y0) / 2;
  // Nearly round is a circle's to find, or none's
  if (rx < 0.05 || ry < 0.05 || Math.abs(rx - ry) <= tol) return undefined;
  const c: Pt = [(x0 + x1) / 2, (y0 + y1) / 2];
  const t =
    Math.min(tol * 0.6, Math.max(tol / 2, Math.max(rx, ry) * 3e-4)) + Math.max(rx, ry) * 2e-4;
  for (const [x, y] of local) {
    const k = Math.hypot((x - c[0]) / rx, (y - c[1]) / ry);
    if (Math.abs(k - 1) * Math.min(rx, ry) > t) return undefined;
  }
  if (Math.abs(o.area - Math.PI * rx * ry) > per * t * 2) return undefined;
  const center = rot(c, a);
  return {
    kind: 'ellipse',
    radius: Math.max(rx, ry),
    body: `ellipse(${vec([rx, ry])})`,
    at: center,
    angle: a,
    center,
  };
}

// The angle of the longest straight edge, between -45 and 45 degrees
function edgeAngle(corners: Poly): number {
  let best = 0,
    a = 0;
  for (let i = 0; i < corners.length; i++) {
    const p = corners[i],
      q = corners[(i + 1) % corners.length];
    const l = dist(p, q);
    if (l > best) {
      best = l;
      a = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
    }
  }
  a = ((a % 90) + 90) % 90;
  return a > 45 ? a - 90 : a;
}

export function rectOf(o: Outline, tol: number): Found | undefined {
  const corners = simplify(o.poly, tol / 4);
  const a = edgeAngle(corners);
  const per = perimeter(o.poly);
  const pts = resample(o.poly, true, Math.min(0.5, per / 256)).map((p) => rot(p, -a));
  const [x0, y0, x1, y1] = bounds([pts])!;
  const w = x1 - x0,
    h = y1 - y0;
  if (w < 0.05 || h < 0.05) return undefined;
  // How far each corner is cut off gives the radius
  const k = Math.SQRT2 + 1;
  const rs = (
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ] as Pt[]
  ).map((c) => Math.min(...pts.map((p) => dist(p, c))) * k);
  let r = rs.reduce((s, v) => s + v, 0) / 4;
  if (Math.max(...rs) - Math.min(...rs) > tol * k) return undefined;
  if (r < tol) r = 0;
  r = Math.min(r, w / 2, h / 2);
  const c: Pt = [(x0 + x1) / 2, (y0 + y1) / 2];
  for (const [x, y] of pts) {
    const qx = Math.abs(x - c[0]) - (w / 2 - r),
      qy = Math.abs(y - c[1]) - (h / 2 - r);
    const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    if (Math.abs(sd) > tol / 2) return undefined;
  }
  if (Math.abs(o.area - (w * h - (4 - Math.PI) * r * r)) > per * tol) return undefined;
  const center = rot(c, a);
  const rr = snap(r) > 0 ? `, r = ${num(r)}` : '';
  return {
    kind: 'rect',
    radius: r,
    body: `rect(${vec([w, h])}, center = true${rr})`,
    at: center,
    angle: a,
    center,
    rect: { w, h, r },
  };
}

export function regularOf(o: Outline, tol: number): Found | undefined {
  const corners = simplify(o.poly, tol / 4);
  const n = corners.length;
  if (n < 3 || n > 48) return undefined;
  let cx = 0,
    cy = 0;
  for (const [x, y] of corners) {
    cx += x / n;
    cy += y / n;
  }
  const c: Pt = [cx, cy];
  const radii = corners.map((p) => dist(p, c));
  const edges = corners.map((p, i) => dist(p, corners[(i + 1) % n]));
  const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
  const turns = corners.map((p) => (Math.atan2(p[1] - cy, p[0] - cx) * 180) / Math.PI);
  if (spread(edges) <= tol && spread(radii) <= tol && n <= 24) {
    const r = radii.reduce((s, v) => s + v, 0) / n;
    const step = 360 / n;
    let a = ((turns[0] % step) + step) % step;
    if (step - a < 0.01) a = 0;
    return {
      kind: 'polygon',
      body: `regular_polygon(${n}, ${num(r)})`,
      at: c,
      angle: a,
      center: c,
    };
  }
  // A star: corners alternately on two circles, evenly around
  if (n % 2 === 0 && n >= 4 && spread(edges) <= tol) {
    const outer = radii.filter((_, i) => i % 2 === 0),
      inner = radii.filter((_, i) => i % 2 === 1);
    if (spread(outer) > tol || spread(inner) > tol) return undefined;
    let ro = outer.reduce((s, v) => s + v, 0) / outer.length;
    let ri = inner.reduce((s, v) => s + v, 0) / inner.length;
    let first = turns[0];
    if (ri > ro) {
      [ro, ri] = [ri, ro];
      first = turns[1];
    }
    if (ro - ri < tol) return undefined;
    const pts = n / 2;
    const step = 360 / pts;
    let a = (((first - 90) % step) + step) % step;
    if (step - a < 0.01) a = 0;
    const def = snap(ri) === snap(ro * 0.45);
    return {
      kind: 'star',
      body: `star(${pts}, ${num(ro)}${def ? '' : `, ${num(ri)}`})`,
      at: c,
      angle: a,
      center: c,
    };
  }
  return undefined;
}

// ---- Tabs and finger joints ----

interface Profile {
  // Edges on each side of the bounding box, as [from, to] along the side
  // measured from its start: bottom left to right, right bottom to top,
  // top right to left, left top to bottom (anticlockwise)
  outer: [number, number][][];
  depth: (number | undefined)[];
  length: number[];
}

function profile(corners: Poly, box: [number, number, number, number], eps: number): Profile {
  const [X0, Y0, X1, Y1] = box;
  const outer: [number, number][][] = [[], [], [], []];
  const levels: number[][] = [[], [], [], []];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i],
      b = corners[(i + 1) % corners.length];
    if (Math.abs(a[1] - b[1]) <= eps) {
      const y = a[1];
      if (Math.abs(y - Y0) <= eps) outer[0].push(sorted(a[0] - X0, b[0] - X0));
      else if (Math.abs(y - Y1) <= eps) outer[2].push(sorted(X1 - a[0], X1 - b[0]));
      else {
        levels[0].push(y - Y0);
        levels[2].push(Y1 - y);
      }
    } else {
      const x = a[0];
      if (Math.abs(x - X1) <= eps) outer[1].push(sorted(a[1] - Y0, b[1] - Y0));
      else if (Math.abs(x - X0) <= eps) outer[3].push(sorted(Y1 - a[1], Y1 - b[1]));
      else {
        levels[1].push(X1 - x);
        levels[3].push(x - X0);
      }
    }
  }
  const length = [X1 - X0, Y1 - Y0, X1 - X0, Y1 - Y0];
  const depth = levels.map((l) => (l.length ? Math.min(...l.filter((v) => v > eps)) : undefined));
  return { outer: outer.map((iv) => merge(iv, eps)), depth, length };
}

const sorted = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);

function merge(iv: [number, number][], eps: number): [number, number][] {
  iv.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of iv) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + eps) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

const covered = (iv: [number, number][]) => iv.reduce((s, [a, b]) => s + b - a, 0);

function tabsPoly(
  w: number,
  h: number,
  edges: boolean[],
  n: number[],
  width: number[],
  t: number,
): Poly[] {
  const polys: Poly[] = [rectPoly(0, 0, w, h)];
  const place: ((p: Pt) => Pt)[] = [
    ([x, y]) => [x, y],
    ([x, y]) => [w - y, x],
    ([x, y]) => [w - x, h - y],
    ([x, y]) => [y, h - x],
  ];
  const lengths = [w, h, w, h];
  edges.forEach((on, i) => {
    if (!on) return;
    const L = lengths[i];
    for (let k = 0; k < n[i]; k++) {
      const x = (L * (k + 0.5)) / n[i];
      polys.push(rectPoly(x - width[i] / 2, -t, x + width[i] / 2, 0).map(place[i]));
    }
  });
  return union(polys);
}

// A rectangle with tabs on some of its sides, as tab_rect() makes, or with
// finger joints on its edges, as finger_rect() makes
export function jointOf(o: Outline, tol: number, preferThickness?: number): Found | undefined {
  const corners = simplify(o.poly, tol / 4);
  if (corners.length < 8) return undefined;
  const a = edgeAngle(corners);
  const local = corners.map((p) => rot(p, -a));
  const eps = tol / 2;
  for (let i = 0; i < local.length; i++) {
    const p = local[i],
      q = local[(i + 1) % local.length];
    if (Math.abs(p[0] - q[0]) > eps && Math.abs(p[1] - q[1]) > eps) return undefined;
  }
  const box = bounds([local])!;
  const prof = profile(local, box, eps);
  const shift = (polys: Poly[], by: Pt) => polys.map((p) => p.map((q) => add(q, by)));
  const matches = (cand: Poly[], origin: Pt) => sameOutlines([local], shift(cand, origin), tol);
  const placed = (corner: Pt, body: string, extra: Partial<Found>): Found => {
    const at = rot(corner, a);
    return {
      kind: 'tabs',
      body,
      at,
      angle: a,
      center: rot([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], a),
      ...extra,
    };
  };
  const per = perimeter(o.poly);
  const notFlat = [0, 1, 2, 3].filter((i) => covered(prof.outer[i]) < prof.length[i] - eps);
  if (!notFlat.length) return undefined;
  const depths = notFlat.map((i) => prof.depth[i]).filter((d): d is number => d !== undefined);
  if (!depths.length) return undefined;
  const ts = [...new Set([preferThickness, ...depths].filter((d): d is number => !!d).map(snap))];

  for (const t of ts) {
    // Finger joints: the outline fills its bounding box but for notches
    // Sizes as they will be written: the finger count rounds to an odd
    // number, and a size a hair over would round the other way
    const w = snap(box[2] - box[0]),
      h = snap(box[3] - box[1]);
    const edgeSets: Edge[][] = [[]];
    for (let i = 0; i < 4; i++) {
      const flat = covered(prof.outer[i]) >= prof.length[i] - 2 * t - eps;
      const opts: Edge[] = flat ? ['flat'] : ['out', 'in'];
      const next: Edge[][] = [];
      for (const s of edgeSets) for (const e of opts) next.push([...s, e]);
      edgeSets.splice(0, edgeSets.length, ...next);
    }
    const def = Math.max(3 * t, 6);
    const fingers = new Set<number>([def]);
    for (const i of notFlat) {
      const m = prof.outer[i].length;
      for (const n of [2 * m - 1, 2 * m + 1, 2 * m - 3, 2 * m + 3])
        if (n >= 3) fingers.add(snap(prof.length[i] / n));
    }
    for (const f of fingers)
      for (const edges of edgeSets) {
        if (edges.every((e) => e === 'flat')) continue;
        const cand = fingerRect(w, h, edges, t, f);
        if (Math.abs(Math.abs(cand.reduce((s, p) => s + area(p), 0)) - o.area) > per * tol)
          continue;
        if (!matches(cand, [box[0], box[1]])) continue;
        const same = edges.every((e) => e === edges[0]);
        const e = same ? `"${edges[0]}"` : `[${edges.map((x) => `"${x}"`).join(', ')}]`;
        // A finger width that gives the same counts as the default is the default
        const isDef =
          f === def ||
          [0, 1].every((i) => fingerCount(prof.length[i], f) === fingerCount(prof.length[i], def));
        return placed(
          [box[0], box[1]],
          `finger_rect(${vec([w, h])}, ${e}${isDef ? '' : `, finger = ${num(f)}`})`,
          {
            kind: 'fingers',
            thickness: t,
            edges,
            finger: isDef ? def : f,
          },
        );
      }

    // Tabs: a rectangle, with tabs `t` deep sticking out of some sides
    const on = [0, 1, 2, 3].map(
      (i) =>
        notFlat.includes(i) && prof.depth[i] !== undefined && Math.abs(prof.depth[i]! - t) <= eps,
    );
    if (!on.some(Boolean)) continue;
    const bx0 = box[0] + (on[3] ? t : 0),
      by0 = box[1] + (on[0] ? t : 0);
    const bw = snap(box[2] - (on[1] ? t : 0) - bx0),
      bh = snap(box[3] - (on[2] ? t : 0) - by0);
    const L = [bw, bh, bw, bh];
    // Tab tips along each side, measured from the body's corner
    const offset = [on[3] ? t : 0, on[0] ? t : 0, on[1] ? t : 0, on[2] ? t : 0];
    const n: number[] = [0, 0, 0, 0],
      wd: number[] = [0, 0, 0, 0];
    let ok = true;
    for (let i = 0; i < 4 && ok; i++) {
      if (!on[i]) continue;
      const tips = prof.outer[i].map(
        ([s, e]) => [s - offset[i], e - offset[i]] as [number, number],
      );
      n[i] = tips.length;
      wd[i] = tips.length ? snap(tips.reduce((s, [p, q]) => s + q - p, 0) / tips.length) : 0;
      tips.forEach(([p, q], k) => {
        if (
          Math.abs((p + q) / 2 - (L[i] * (k + 0.5)) / n[i]) > eps ||
          Math.abs(q - p - wd[i]) > eps
        )
          ok = false;
      });
    }
    if (!ok || !matches(tabsPoly(bw, bh, on, n, wd, t), [bx0, by0])) continue;
    const edges = on.every(Boolean) ? '' : `[${on.join(', ')}]`;
    const used = [0, 1, 2, 3].filter((i) => on[i]);
    const defCount = (i: number) => Math.max(1, Math.round(L[i] / 50));
    const countsDefault = used.every((i) => n[i] === defCount(i));
    const oneCount = used.every((i) => n[i] === n[used[0]]);
    const count = countsDefault ? undefined : oneCount ? n[used[0]] : null;
    const widthsDefault = used.every((i) => Math.abs(wd[i] - L[i] / (2 * n[i])) <= eps);
    const oneWidth = used.every((i) => Math.abs(wd[i] - wd[used[0]]) <= eps);
    const width = widthsDefault ? undefined : oneWidth ? wd[used[0]] : null;
    let body: string;
    if (count !== null && width !== null) {
      const args = [vec([bw, bh])];
      if (edges) args.push(edges);
      else if (count !== undefined || width !== undefined) args.push('true');
      if (count !== undefined) args.push(`count = ${count}`);
      if (width !== undefined) args.push(`width = ${num(width)}`);
      body = `tab_rect(${args.join(', ')})`;
    } else {
      // Sides that differ: a rectangle and tabs() on each side
      const at = [
        (s: string) => s,
        (s: string) => `translate(${vec([bw, 0])}) rotate(90) ${s}`,
        (s: string) => `translate(${vec([bw, bh])}) rotate(180) ${s}`,
        (s: string) => `translate(${vec([0, bh])}) rotate(270) ${s}`,
      ];
      const lines = [`rect(${vec([bw, bh])});`];
      for (const i of used) {
        const args = [num(L[i])];
        if (n[i] !== defCount(i)) args.push(`count = ${n[i]}`);
        if (Math.abs(wd[i] - L[i] / (2 * n[i])) > eps) args.push(`width = ${num(wd[i])}`);
        lines.push(at[i](`tabs(${args.join(', ')});`));
      }
      body = `{\n${lines.map((l) => '  ' + l).join('\n')}\n}`;
    }
    return placed([bx0, by0], body, {
      kind: 'tabs',
      thickness: t,
      library: 'tabs',
      label: `tabs ${num(t)} mm deep`,
    });
  }

  // Joints from other programs: a rectangle with tabs added to some sides
  // and notches cut into others, wherever they are
  const d = prof.depth;
  if (notFlat.some((i) => d[i] === undefined)) return undefined;
  // A side mostly at its outer edge has notches; one mostly inside has tabs
  const tabbed = [0, 1, 2, 3].map(
    (i) => notFlat.includes(i) && covered(prof.outer[i]) < prof.length[i] * 0.4,
  );
  const bx0 = box[0] + (tabbed[3] ? d[3]! : 0),
    by0 = box[1] + (tabbed[0] ? d[0]! : 0);
  const bw = box[2] - (tabbed[1] ? d[1]! : 0) - bx0,
    bh = box[3] - (tabbed[2] ? d[2]! : 0) - by0;
  // From side coordinates to the body's: [x0, x1] along the side, [y0, y1]
  // inward from the body's edge, as a rectangle [x, y, w, h]
  const toBody = (
    i: number,
    s: number,
    e: number,
    y0: number,
    y1: number,
  ): [number, number, number, number] => {
    if (i === 0) return [box[0] + s - bx0, y0, e - s, y1 - y0];
    if (i === 1) return [bw - y1, box[1] + s - by0, y1 - y0, e - s];
    if (i === 2) return [box[2] - e - bx0, bh - y1, e - s, y1 - y0];
    return [y0, box[3] - e - by0, y1 - y0, e - s];
  };
  const tabs: [number, number, number, number][][] = [[], [], [], []];
  const notches: [number, number, number, number][][] = [[], [], [], []];
  const corner: [number, number][] = [];
  const span = [
    [bx0 - box[0], bx0 - box[0] + bw],
    [by0 - box[1], by0 - box[1] + bh],
    [box[2] - (bx0 + bw), box[2] - bx0],
    [box[3] - (by0 + bh), box[3] - by0],
  ];
  for (const i of notFlat) {
    if (tabbed[i]) for (const [s, e] of prof.outer[i]) tabs[i].push(toBody(i, s, e, -d[i]!, 0));
    else {
      // The gaps between the outer edges, inside the body's extent
      let at = span[i][0];
      for (const [s, e] of [...prof.outer[i], [span[i][1], span[i][1]] as [number, number]]) {
        const [g0, g1] = [Math.max(at, span[i][0]), Math.min(s, span[i][1])];
        if (g1 - g0 > eps) {
          if (g0 - span[i][0] <= eps || span[i][1] - g1 <= eps) corner.push([i, notches[i].length]);
          notches[i].push(toBody(i, g0, g1, -1, d[i]!));
        }
        at = Math.max(at, e);
      }
    }
  }
  const rp = ([x, y, w, h]: [number, number, number, number]) => rectPoly(x, y, x + w, y + h);
  const solidPolys = union([rectPoly(0, 0, bw, bh), ...tabs.flat().map(rp)]);
  const fits = () => matches(difference(solidPolys, notches.flat().map(rp)), [bx0, by0]);
  if (!fits()) return undefined;
  // A notch in a corner may be cut already by the next side's: leave it out
  for (const [i, k] of corner.reverse()) {
    const [gone] = notches[i].splice(k, 1);
    if (!fits()) notches[i].splice(k, 0, gone);
  }
  // Rows of equal rectangles evenly spaced along a side become loops
  const rows = (list: [number, number, number, number][], i: number): string[] => {
    const alongX = i % 2 === 0;
    const pos = (r: [number, number, number, number]) => (alongX ? r[0] : r[1]);
    list.sort((p, q) => pos(p) - pos(q));
    const same = list.every(
      (r) => Math.abs(r[2] - list[0][2]) <= eps && Math.abs(r[3] - list[0][3]) <= eps,
    );
    const step = list.length > 1 ? pos(list[1]) - pos(list[0]) : 0;
    const even = list.every((r, k) => Math.abs(pos(r) - pos(list[0]) - k * step) <= eps);
    const s = snap(step);
    const a = snap(pos(list[0]));
    const b = snap(a + s * (list.length - 1));
    if (
      list.length >= 3 &&
      same &&
      even &&
      s > 0 &&
      Math.floor((b - a) / s + 1e-9) + 1 === list.length
    ) {
      const [, , w, h] = list[0];
      const v = alongX ? `[x, ${num(list[0][1])}]` : `[${num(list[0][0])}, y]`;
      return [
        `for (${alongX ? 'x' : 'y'} = [${num(a)}:${num(s)}:${num(b)}]) translate(${v}) rect(${vec([w, h])});`,
      ];
    }
    return list.map(([x, y, w, h]) => `translate(${vec([x, y])}) rect(${vec([w, h])});`);
  };
  const plus = [0, 1, 2, 3].flatMap((i) => (tabs[i].length ? rows(tabs[i], i) : []));
  const minus = [0, 1, 2, 3].flatMap((i) => (notches[i].length ? rows(notches[i], i) : []));
  const solid = plus.length
    ? `union() {\n${[`rect(${vec([bw, bh])});`, ...plus].join('\n')}\n}`
    : `rect(${vec([bw, bh])})`;
  const body = minus.length
    ? `difference() {\n${[solid.endsWith('}') ? solid : solid + ';', ...minus].join('\n')}\n}`
    : solid;
  const ds = notFlat.map((i) => snap(d[i]!));
  const common = ds.sort(
    (p, q) => ds.filter((v) => v === q).length - ds.filter((v) => v === p).length,
  )[0];
  return placed([bx0, by0], body, {
    kind: minus.length ? 'fingers' : 'tabs',
    thickness: common,
    generic: true,
    label: `${minus.length ? 'finger joints' : 'tabs'} ${num(common)} mm deep`,
  });
}

// ---- Keyholes ----

// The point inside an outline farthest from its edge, and that distance
function deepest(poly: Poly): { c: Pt; r: number } {
  const [x0, y0, x1, y1] = bounds([poly])!;
  const d = (p: Pt) => {
    let m = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
      m = Math.min(m, segDist(p, poly[j], poly[i]));
    return m;
  };
  let best: Pt = [(x0 + x1) / 2, (y0 + y1) / 2],
    bestD = inside(best, poly) ? d(best) : 0;
  const n = 24;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      const p: Pt = [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * j) / n];
      if (!inside(p, poly)) continue;
      const v = d(p);
      if (v > bestD) {
        best = p;
        bestD = v;
      }
    }
  let step = Math.max(x1 - x0, y1 - y0) / n;
  while (step > 1e-4) {
    let moved = false;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const p: Pt = [best[0] + dx * step, best[1] + dy * step];
      if (!inside(p, poly)) continue;
      const v = d(p);
      if (v > bestD) {
        best = p;
        bestD = v;
        moved = true;
      }
    }
    if (!moved) step /= 2;
  }
  return { c: best, r: bestD };
}

function capsule(a: Pt, b: Pt, r: number): Poly {
  const n = 64;
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const out: Poly = [];
  for (let i = 0; i <= n; i++) {
    const t = ang + Math.PI / 2 + (Math.PI * i) / n;
    out.push([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)]);
  }
  for (let i = 0; i <= n; i++) {
    const t = ang - Math.PI / 2 + (Math.PI * i) / n;
    out.push([b[0] + r * Math.cos(t), b[1] + r * Math.sin(t)]);
  }
  return out;
}

export function keyholeOf(o: Outline, tol: number): Found | undefined {
  const [x0, y0, x1, y1] = o.box;
  if (Math.max(x1 - x0, y1 - y0) > 80) return undefined;
  const per = perimeter(o.poly);
  const pts = resample(o.poly, true, Math.min(0.25, per / 400));
  const head = deepest(o.poly);
  const onHead = pts.filter((p) => Math.abs(dist(p, head.c) - head.r) <= tol);
  const fit = fitCircle(onHead);
  if (!fit || onHead.length < 8) return undefined;
  // The slot runs from the head to the point farthest from it
  // The slot runs from the head towards the point farthest from it; its
  // straight sides give the exact direction
  let end = pts[0];
  for (const p of pts) if (dist(p, fit.c) > dist(end, fit.c)) end = p;
  const far = dist(end, fit.c);
  let dir: Pt = [(end[0] - fit.c[0]) / far, (end[1] - fit.c[1]) / far];
  const along = (p: Pt) => (p[0] - fit.c[0]) * dir[0] + (p[1] - fit.c[1]) * dir[1];
  const across = (p: Pt) => -(p[0] - fit.c[0]) * dir[1] + (p[1] - fit.c[1]) * dir[0];
  let side = pts.filter((p) => along(p) > fit.r + tol && along(p) < far - fit.r);
  if (side.length < 4) return undefined;
  // Each side is a line; their directions, averaged
  const sides = [side.filter((p) => across(p) > 0), side.filter((p) => across(p) < 0)];
  if (sides.some((s) => s.length < 2)) return undefined;
  const turned = sides
    .map((s) => rot([1, 0], principalAngle(s)))
    .map((u): Pt => (u[0] * dir[0] + u[1] * dir[1] < 0 ? [-u[0], -u[1]] : u));
  const mean: Pt = [turned[0][0] + turned[1][0], turned[0][1] + turned[1][1]];
  const m = Math.hypot(mean[0], mean[1]);
  dir = [mean[0] / m, mean[1] / m];
  side = pts.filter((p) => along(p) > fit.r + tol && along(p) < far - fit.r);
  if (side.length < 4) return undefined;
  if (Math.abs(side.reduce((s, p) => s + across(p), 0) / side.length) > tol) return undefined;
  const halves = side.map((p) => Math.abs(across(p))).sort((a, b) => a - b);
  const shank = halves[Math.floor(halves.length / 2)] * 2;
  if (shank >= fit.r * 2 - tol || shank < 0.3) return undefined;
  const len = Math.max(...pts.map(along));
  const top: Pt = add(fit.c, [dir[0] * (len - shank / 2), dir[1] * (len - shank / 2)]);
  const cand = union([
    ellipsePoly(fit.r, fit.r, 256).map((p) => add(p, fit.c)),
    capsule(fit.c, top, shank / 2),
  ]);
  if (!sameOutlines([o.poly], cand, tol)) return undefined;
  const drop = len - shank / 2;
  const headD = fit.r * 2;
  const deg = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI - 90;
  const args: string[] = [];
  if (snap(headD) !== 9) args.push(`head = ${num(headD)}`);
  if (snap(shank) !== 4.5) args.push(`shank = ${num(shank)}`);
  if (snap(drop) !== 10) args.push(`drop = ${num(drop)}`);
  const fits = drop >= (headD + shank) / 2 - 1e-9;
  const body = fits
    ? `keyhole(${args.join(', ')})`
    : `{ translate(${vec([0, -drop])}) circle(d = ${num(headD)}); hull() { circle(d = ${num(shank)}); translate(${vec([0, -drop])}) circle(d = ${num(shank)}); } }`;
  return {
    kind: 'keyhole',
    radius: headD / 2,
    body,
    at: top,
    angle: deg,
    center: top,
    label: 'keyhole',
    keyhole: { head: headD, shank, drop, top },
    library: fits ? 'hanging' : undefined,
  };
}

// Points closer than this to the one before are left out of the code:
// drawings made of many short paths repeat their ends
const SAME = 0.0025;
const apart = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) > SAME || Math.abs(a[1] - b[1]) > SAME;

// The closed outline as code: a polygon when it is all straight, path data
// when it has curves
export function outlineCode(s: Sub, origin: Pt): string {
  if (s.segs.every((g) => g.c === 'L') && s.segs.length < 400) {
    const all = s.segs.map((g) => g.a);
    if (!s.closed) all.push(s.segs[s.segs.length - 1].b);
    const pts = [all[0]];
    for (const q of all.slice(1)) if (apart(q, pts[pts.length - 1])) pts.push(q);
    if (!s.closed && pts.length < 2) pts.push(all[all.length - 1]);
    const list = `[${pts.map((q) => vec(sub(q, origin))).join(', ')}]`;
    if (!s.closed)
      return pts.length === 2
        ? `line(${vec(sub(pts[0], origin))}, ${vec(sub(pts[1], origin))})`
        : `polyline(${list})`;
    return `polygon(${list})`;
  }
  return `path("${pathData([s], origin)}")`;
}

export function pathData(subs: Sub[], origin: Pt): string {
  const p = (q: Pt) => `${num(q[0] - origin[0])} ${num(q[1] - origin[1])}`;
  return subs
    .map((s) => {
      let d = `M${p(s.segs[0].a)}`;
      let at = s.segs[0].a;
      for (const g of s.segs) {
        if (!apart(g.b, at) && (g.c === 'L' || (!apart(g.p1, at) && !apart(g.p2, at)))) continue;
        d += g.c === 'L' ? `L${p(g.b)}` : `C${p(g.p1)} ${p(g.p2)} ${p(g.b)}`;
        at = g.b;
      }
      return s.closed ? d + 'Z' : d;
    })
    .join('');
}

export { rot, add, sub, rectPoly };
