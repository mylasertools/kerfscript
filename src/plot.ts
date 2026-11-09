// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Line drawing as pen plotters do it: evenly spaced streamlines of a
// direction field, contour lines of a height field, and lines joined end to
// end and put in an order that keeps the head's travel short.

import type { Poly, Pt } from './geometry.js';

export interface FlowOptions {
  // Distance between neighbouring lines
  spacing: number;
  // Length of one step along a line
  step: number;
  // Lines shorter than this are dropped
  minLength: number;
  seed: number;
  // Corners of the area, and whether a point is inside it
  box: [number, number, number, number];
  inside: (p: Pt) => boolean;
  // The unit direction of the field at a point, or null where it stops
  dir: (p: Pt) => Pt | null;
  // Called once per point made, to count the work
  tick: () => void;
  maxPoints: number;
}

function random(seed: number) {
  let s = Math.floor(seed) >>> 0 || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Evenly spaced streamlines (Jobard and Lefer, 1997): each line grows both
// ways from a seed until it leaves the area, the field stops, or it comes
// within half the spacing of another line or of itself. New seeds are
// tried a spacing to either side of every line made, then at random
// points of the area until none is left a spacing away from every line.
export function streamlines(o: FlowOptions): Poly[] {
  const { spacing, step, box } = o;
  const test = spacing / 2;
  const size = spacing;
  const cells = new Map<number, number[]>();
  const xs: number[] = [],
    ys: number[] = [],
    owner: number[] = [],
    order: number[] = [];
  const alive: boolean[] = [];
  const key = (x: number, y: number) =>
    Math.floor((x - box[0]) / size) * 1_000_003 + Math.floor((y - box[1]) / size);
  const add = (p: Pt, line: number, seq: number) => {
    const k = key(p[0], p[1]);
    const id = xs.length;
    xs.push(p[0]);
    ys.push(p[1]);
    owner.push(line);
    order.push(seq);
    const c = cells.get(k);
    if (c) c.push(id);
    else cells.set(k, [id]);
  };
  // No living point within d, except the line's own near this place on it
  const window = Math.ceil((2 * spacing) / step) + 2;
  const free = (p: Pt, d: number, line = -1, seq = 0) => {
    const cx = Math.floor((p[0] - box[0]) / size),
      cy = Math.floor((p[1] - box[1]) / size);
    for (let i = cx - 1; i <= cx + 1; i++)
      for (let j = cy - 1; j <= cy + 1; j++) {
        const c = cells.get(i * 1_000_003 + j);
        if (!c) continue;
        for (const id of c) {
          const l = owner[id];
          if (!alive[l] && l !== line) continue;
          if (l === line && Math.abs(order[id] - seq) < window) continue;
          if (Math.hypot(xs[id] - p[0], ys[id] - p[1]) < d) return false;
        }
      }
    return true;
  };
  const lines: Poly[] = [];
  let made = 0;
  const longest = Math.ceil(
    (4 * (box[2] - box[0] + box[3] - box[1] + spacing)) / step + 2 * window,
  );
  // Midpoint steps: the direction halfway along the step, where there is one
  const next = (p: Pt, sign: number): Pt | null => {
    const v = o.dir(p);
    if (!v) return null;
    const mid: Pt = [p[0] + (sign * v[0] * step) / 2, p[1] + (sign * v[1] * step) / 2];
    const w = o.dir(mid) ?? v;
    // A direction turned back on itself is a point the lines run into
    if (w[0] * v[0] + w[1] * v[1] < 0) return null;
    return [p[0] + sign * w[0] * step, p[1] + sign * w[1] * step];
  };
  const trace = (seed: Pt): Poly | null => {
    const line = lines.length;
    alive[line] = false;
    add(seed, line, 0);
    const halves: Pt[][] = [[], []];
    for (const [h, sign] of [
      [0, 1],
      [1, -1],
    ] as const) {
      let p = seed;
      for (let s = 1; s <= longest; s++) {
        const q = next(p, sign);
        if (!q) break;
        const seq = sign * s;
        if (!o.inside(q)) {
          halves[h].push(q);
          break;
        }
        if (!free(q, test, line, seq)) break;
        halves[h].push(q);
        add(q, line, seq);
        if (++made > o.maxPoints)
          throw new Error(
            `the lines have more than ${o.maxPoints} points: use a larger spacing or step`,
          );
        o.tick();
        p = q;
      }
    }
    const pts = [...halves[1].reverse(), seed, ...halves[0]];
    let len = 0;
    for (let i = 1; i < pts.length; i++)
      len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lines.push(pts);
    if (pts.length < 2 || len < o.minLength) return null;
    alive[line] = true;
    return pts;
  };
  // Random points over the area, a spacing apart, in an order from the seed
  const rnd = random(o.seed);
  const starts: Pt[] = [];
  for (let x = box[0] + spacing / 2; x < box[2]; x += spacing)
    for (let y = box[1] + spacing / 2; y < box[3]; y += spacing)
      starts.push([x + (rnd() - 0.5) * spacing, y + (rnd() - 0.5) * spacing]);
  for (let i = starts.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [starts[i], starts[j]] = [starts[j], starts[i]];
  }
  const out: Poly[] = [];
  const queue: Poly[] = [];
  const stride = Math.max(1, Math.round(spacing / (2 * step)));
  const tryAt = (p: Pt) => {
    if (!o.inside(p) || !free(p, spacing) || !o.dir(p)) return;
    const l = trace(p);
    if (l) {
      out.push(l);
      queue.push(l);
    }
  };
  let s = 0;
  for (;;) {
    while (queue.length) {
      const l = queue.shift()!;
      for (let i = 0; i < l.length; i += stride) {
        const a = l[Math.max(0, i - 1)],
          b = l[Math.min(l.length - 1, i + 1)];
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (d === 0) continue;
        const nx = -(b[1] - a[1]) / d,
          ny = (b[0] - a[0]) / d;
        for (const side of [1, -1])
          tryAt([l[i][0] + side * nx * spacing, l[i][1] + side * ny * spacing]);
      }
    }
    if (s >= starts.length) break;
    tryAt(starts[s++]);
  }
  return out;
}

// Contour lines at `level` of values sampled on a grid: nx by ny points
// `cell` apart from [x0, y0], row by row. NaN marks a point with no value;
// cells touching one are left out. Lines that close are closed polylines,
// their first point again at the end.
export function contourLines(
  v: Float64Array,
  nx: number,
  ny: number,
  x0: number,
  y0: number,
  cell: number,
  level: number,
): Poly[] {
  const at = (i: number, j: number) => v[j * nx + i];
  // A crossing on an edge: horizontal (i, j)-(i+1, j) is even, vertical
  // (i, j)-(i, j+1) is odd
  const hEdge = (i: number, j: number) => (j * nx + i) * 2;
  const vEdge = (i: number, j: number) => (j * nx + i) * 2 + 1;
  const point = (e: number): Pt => {
    const k = e >> 1,
      i = k % nx,
      j = (k - i) / nx;
    const a = at(i, j),
      b = e & 1 ? at(i, j + 1) : at(i + 1, j);
    const t = a === b ? 0.5 : (level - a) / (b - a);
    return e & 1 ? [x0 + i * cell, y0 + (j + t) * cell] : [x0 + (i + t) * cell, y0 + j * cell];
  };
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    for (const [p, q] of [
      [a, b],
      [b, a],
    ]) {
      const l = links.get(p);
      if (l) l.push(q);
      else links.set(p, [q]);
    }
  };
  for (let j = 0; j + 1 < ny; j++)
    for (let i = 0; i + 1 < nx; i++) {
      const a = at(i, j),
        b = at(i + 1, j),
        c = at(i + 1, j + 1),
        d = at(i, j + 1);
      if (Number.isNaN(a + b + c + d)) continue;
      const k =
        (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
      if (k === 0 || k === 15) continue;
      const bottom = hEdge(i, j),
        right = vEdge(i + 1, j),
        top = hEdge(i, j + 1),
        left = vEdge(i, j);
      if (k === 5 || k === 10) {
        const centre = (a + b + c + d) / 4 >= level;
        // Corners a and c above (5), or b and d (10): the centre decides
        // which pair the lines cut off
        if ((k === 5) === centre) {
          link(bottom, right);
          link(left, top);
        } else {
          link(left, bottom);
          link(right, top);
        }
        continue;
      }
      const crossed: number[] = [];
      if ((k & 1) !== (k & 2) >> 1) crossed.push(bottom);
      if ((k & 2) >> 1 !== (k & 4) >> 2) crossed.push(right);
      if ((k & 4) >> 2 !== (k & 8) >> 3) crossed.push(top);
      if ((k & 8) >> 3 !== (k & 1)) crossed.push(left);
      if (crossed.length === 2) link(crossed[0], crossed[1]);
    }
  const used = new Set<number>();
  const walk = (start: number): Poly => {
    const out: Poly = [point(start)];
    used.add(start);
    let cur = start;
    for (;;) {
      const nextE = (links.get(cur) ?? []).find((e) => !used.has(e));
      if (nextE === undefined) {
        if ((links.get(cur) ?? []).includes(start) && out.length > 2) out.push(out[0]);
        return out;
      }
      used.add(nextE);
      out.push(point(nextE));
      cur = nextE;
    }
  };
  const out: Poly[] = [];
  // Open lines from their ends first, then the loops
  for (const [e, l] of links) if (l.length === 1 && !used.has(e)) out.push(walk(e));
  for (const e of links.keys()) if (!used.has(e)) out.push(walk(e));
  // Without repeated points, where a sample is at the level exactly; a
  // line that shrinks to a point is left out
  return out
    .map((l) => l.filter((p, i) => i === 0 || p[0] !== l[i - 1][0] || p[1] !== l[i - 1][1]))
    .filter(
      (l) => l.length >= 2 && !(l.length === 2 && l[0][0] === l[1][0] && l[0][1] === l[1][1]),
    );
}

// Lines that meet end to end, within tol, joined into one, then put in the
// order a nearest-first tour from the origin takes them, each turned to
// start at its end nearer the head
export function joinLines(lines: Poly[], tol = 1e-3): Poly[] {
  const ls = lines.filter((l) => l.length >= 2).map((l) => [...l]);
  if (ls.length < 2) return ls;
  const k = (p: Pt) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  const ends = new Map<string, number[]>();
  const put = (p: Pt, i: number) => {
    const key = k(p);
    const l = ends.get(key);
    if (l) l.push(i);
    else ends.set(key, [i]);
  };
  ls.forEach((l, i) => {
    put(l[0], i);
    put(l[l.length - 1], i);
  });
  const used = new Array<boolean>(ls.length).fill(false);
  const closed = (l: Poly) => k(l[0]) === k(l[l.length - 1]);
  const joined: Poly[] = [];
  for (let i = 0; i < ls.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let line = ls[i];
    if (!closed(line))
      // Grow at the end, then turn it round and grow at the other end
      for (let pass = 0; pass < 2; pass++) {
        for (;;) {
          const tail = line[line.length - 1];
          const j = (ends.get(k(tail)) ?? []).find((n) => !used[n]);
          if (j === undefined) break;
          used[j] = true;
          const m = ls[j];
          const piece = k(m[0]) === k(tail) ? m : [...m].reverse();
          line = line.concat(piece.slice(1));
          if (closed(line)) break;
        }
        if (closed(line)) break;
        line = line.reverse();
      }
    joined.push(line);
  }
  return travelOrder(joined);
}

// Nearest-first order from the origin, each line started at its nearer end
function travelOrder(lines: Poly[]): Poly[] {
  const n = lines.length;
  if (n < 2) return lines;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const l of lines)
    for (const p of [l[0], l[l.length - 1]]) {
      x0 = Math.min(x0, p[0]);
      y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]);
      y1 = Math.max(y1, p[1]);
    }
  const size = Math.max((x1 - x0 + y1 - y0) / Math.sqrt(n), 1e-6);
  const gx = (x: number) => Math.floor((x - x0) / size),
    gy = (y: number) => Math.floor((y - y0) / size);
  const cols = gx(x1) + 1,
    rows = gy(y1) + 1;
  const grid = new Map<number, number[]>();
  lines.forEach((l, i) => {
    for (const p of [l[0], l[l.length - 1]]) {
      const c = gy(p[1]) * cols + gx(p[0]);
      const g = grid.get(c);
      if (g) {
        if (g[g.length - 1] !== i) g.push(i);
      } else grid.set(c, [i]);
    }
  });
  const used = new Array<boolean>(n).fill(false);
  const out: Poly[] = [];
  let head: Pt = [0, 0];
  for (let done = 0; done < n; done++) {
    let best = -1,
      bestD = Infinity,
      flip = false;
    const cx = Math.min(Math.max(gx(head[0]), 0), cols - 1),
      cy = Math.min(Math.max(gy(head[1]), 0), rows - 1);
    // Rings of cells outward, until no nearer end can be in the next ring
    for (let r = 0; r <= Math.max(cols, rows); r++) {
      for (let i = cx - r; i <= cx + r; i++)
        for (let j = cy - r; j <= cy + r; j++) {
          if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r) continue;
          if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
          for (const li of grid.get(j * cols + i) ?? []) {
            if (used[li]) continue;
            const l = lines[li];
            const a = Math.hypot(l[0][0] - head[0], l[0][1] - head[1]);
            const b = Math.hypot(l[l.length - 1][0] - head[0], l[l.length - 1][1] - head[1]);
            if (a < bestD) [best, bestD, flip] = [li, a, false];
            if (b < bestD) [best, bestD, flip] = [li, b, true];
          }
        }
      if (best >= 0 && bestD <= r * size) break;
    }
    if (best < 0)
      for (let li = 0; li < n; li++)
        if (!used[li]) {
          best = li;
          break;
        }
    used[best] = true;
    const l = flip ? [...lines[best]].reverse() : lines[best];
    out.push(l);
    head = l[l.length - 1];
  }
  return out;
}

// Whether a point is inside outlines, by winding number, with the edges
// bucketed by rows so a test looks only at the edges level with it
export function insideTest(regions: Poly[]): (p: Pt) => boolean {
  const edges: [number, number, number, number][] = [];
  let y0 = Infinity,
    y1 = -Infinity;
  for (const r of regions)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      edges.push([r[j][0], r[j][1], r[i][0], r[i][1]]);
      y0 = Math.min(y0, r[i][1]);
      y1 = Math.max(y1, r[i][1]);
    }
  if (!edges.length) return () => false;
  const rows = Math.max(1, Math.min(4096, Math.ceil(Math.sqrt(edges.length))));
  const h = (y1 - y0) / rows || 1;
  const bucket: number[][] = Array.from({ length: rows }, () => []);
  edges.forEach(([, ay, , by], i) => {
    const a = Math.max(0, Math.min(rows - 1, Math.floor((Math.min(ay, by) - y0) / h)));
    const b = Math.max(0, Math.min(rows - 1, Math.floor((Math.max(ay, by) - y0) / h)));
    for (let k = a; k <= b; k++) bucket[k].push(i);
  });
  return ([x, y]) => {
    if (y < y0 || y > y1) return false;
    let w = 0;
    for (const i of bucket[Math.max(0, Math.min(rows - 1, Math.floor((y - y0) / h)))]) {
      const [ax, ay, bx, by] = edges[i];
      if (ay <= y) {
        if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) w++;
      } else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) w--;
    }
    return w !== 0;
  };
}
