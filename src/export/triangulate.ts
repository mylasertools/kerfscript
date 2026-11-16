// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Triangles of a polygon with holes, by ear clipping. Each hole is joined
// to the outline by a bridge from its leftmost point to a vertex it can
// see, which makes one ring; then ears are cut off that ring until a
// triangle is left. The outline runs counter-clockwise (y up), the holes
// clockwise.

type Pt = [number, number];

interface Node {
  i: number;
  x: number;
  y: number;
  prev: Node;
  next: Node;
}

// Twice the signed area: more than 0 for a counter-clockwise ring
const area2 = (ring: Pt[]) => {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return s;
};

// More than 0 when a, b, c turn left (counter-clockwise)
const cross = (a: Node, b: Node, c: Node) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const same = (a: Node, b: Node) => a.x === b.x && a.y === b.y;

function node(i: number, x: number, y: number): Node {
  const n = { i, x, y } as Node;
  n.prev = n;
  n.next = n;
  return n;
}

function insert(after: Node | null, n: Node): Node {
  if (after) {
    n.next = after.next;
    n.prev = after;
    after.next.prev = n;
    after.next = n;
  }
  return n;
}

// The ring as a linked list, turning counter-clockwise if ccw
function link(points: Pt[], start: number, ccw: boolean): Node | null {
  let last: Node | null = null;
  const forward = area2(points) > 0 === ccw;
  for (let k = 0; k < points.length; k++) {
    const j = forward ? k : points.length - 1 - k;
    last = insert(last, node(start + j, points[j][0], points[j][1]));
  }
  if (last && same(last, last.next)) {
    const n = last.next;
    remove(last);
    last = n;
  }
  return last ? last.next : null;
}

function remove(n: Node) {
  n.next.prev = n.prev;
  n.prev.next = n.next;
}

// Drops repeated points and spikes that go out and straight back, from
// start round to end. Points along a straight edge stay: the sides of a
// solid use them, so the faces must too.
function filter(start: Node, end?: Node): Node {
  let stop = end ?? start;
  let p = start;
  let again: boolean;
  do {
    again = false;
    if (same(p, p.next) || same(p.prev, p.next)) {
      remove(p);
      p = stop = p.prev;
      if (p === p.next) break;
      again = true;
    } else p = p.next;
  } while (again || p !== stop);
  return stop;
}

// Copies of a and b spliced in so the ring goes a, b, ... and the copies
// close the other side: the bridge from a to b and back
function split(a: Node, b: Node): Node {
  const a2 = node(a.i, a.x, a.y);
  const b2 = node(b.i, b.x, b.y);
  const an = a.next;
  const bp = b.prev;
  a.next = b;
  b.prev = a;
  a2.next = an;
  an.prev = a2;
  b2.next = a2;
  a2.prev = b2;
  bp.next = b2;
  b2.prev = bp;
  return b2;
}

function inTriangle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  px: number,
  py: number,
) {
  return (
    (bx - ax) * (py - ay) - (by - ay) * (px - ax) >= 0 &&
    (cx - bx) * (py - by) - (cy - by) * (px - bx) >= 0 &&
    (ax - cx) * (py - cy) - (ay - cy) * (px - cx) >= 0
  );
}

// Whether a diagonal from a towards b starts inside the ring at a
function locallyInside(a: Node, b: Node) {
  return cross(a.prev, a, a.next) > 0
    ? cross(a, b, a.next) <= 0 && cross(a, a.prev, b) <= 0
    : cross(a, b, a.prev) > 0 || cross(a, a.next, b) > 0;
}

// The vertex of the ring that the hole's leftmost point h can be joined to
function bridgeTo(h: Node, ring: Node): Node | null {
  const hx = h.x;
  const hy = h.y;
  let p = ring;
  let qx = -Infinity;
  let m: Node | null = null;
  // The nearest edge a ray from h to the left crosses; on the left side of
  // a counter-clockwise ring the edges run downwards
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + ((hy - p.y) * (p.next.x - p.x)) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        m = p.x < p.next.x ? p : p.next;
        if (x === hx) return m;
      }
    }
    p = p.next;
  } while (p !== ring);
  if (!m) return null;
  // A vertex inside the triangle h, the crossing and m may hide m: take
  // the visible one nearest the ray's direction
  const stop = m;
  const mx = m.x;
  const my = m.y;
  let best = Infinity;
  p = m;
  do {
    if (
      hx >= p.x &&
      p.x >= mx &&
      hx !== p.x &&
      (hy < my
        ? inTriangle(hx, hy, mx, my, qx, hy, p.x, p.y)
        : inTriangle(qx, hy, mx, my, hx, hy, p.x, p.y))
    ) {
      const tan = Math.abs(hy - p.y) / (hx - p.x);
      if (
        locallyInside(p, h) &&
        (tan < best ||
          (tan === best &&
            (p.x > m.x ||
              (p.x === m.x && cross(m.prev, m, p.prev) > 0 && cross(p.next, m, m.next) > 0))))
      ) {
        m = p;
        best = tan;
      }
    }
    p = p.next;
  } while (p !== stop);
  return m;
}

function isEar(e: Node) {
  const a = e.prev;
  const c = e.next;
  if (cross(a, e, c) <= 0) return false;
  for (let p = c.next; p !== a; p = p.next)
    if (
      !same(p, a) &&
      !same(p, c) &&
      !same(p, e) &&
      inTriangle(a.x, a.y, e.x, e.y, c.x, c.y, p.x, p.y) &&
      cross(p.prev, p, p.next) <= 0
    )
      return false;
  return true;
}

/** Triangles of an outline with holes, as index triples into the
 * outline's points followed by each hole's, turning counter-clockwise */
export function triangulate(outer: Pt[], holes: Pt[][] = []): [number, number, number][] {
  const out: [number, number, number][] = [];
  if (outer.length < 3) return out;
  let ring = link(outer, 0, true);
  if (!ring || ring === ring.next) return out;
  let offset = outer.length;
  const lefts: Node[] = [];
  for (const h of holes) {
    const n = h.length >= 3 ? link(h, offset, false) : null;
    offset += h.length;
    if (!n || n === n.next) continue;
    let left = n;
    let p = n;
    do {
      if (p.x < left.x || (p.x === left.x && p.y < left.y)) left = p;
      p = p.next;
    } while (p !== n);
    lefts.push(left);
  }
  lefts.sort((a, b) => a.x - b.x || a.y - b.y);
  for (const h of lefts) {
    const b = bridgeTo(h, ring);
    if (!b) continue;
    const back = split(b, h);
    filter(back, back.next);
    ring = filter(b, b.next);
  }
  let ear: Node = filter(ring);
  let left = 0;
  let p = ear;
  do {
    left++;
    p = p.next;
  } while (p !== ear);
  let misses = 0;
  while (left > 3) {
    if (isEar(ear)) {
      out.push([ear.prev.i, ear.i, ear.next.i]);
      const next = ear.next;
      remove(ear);
      left--;
      ear = next;
      misses = 0;
      continue;
    }
    ear = ear.next;
    if (++misses > left) {
      // Nothing clips cleanly (a ring touching itself): cut the corner
      // that turns left the most, or drop a point that doesn't turn
      let pick = ear;
      let q = ear;
      do {
        if (cross(q.prev, q, q.next) > cross(pick.prev, pick, pick.next)) pick = q;
        q = q.next;
      } while (q !== ear);
      if (cross(pick.prev, pick, pick.next) > 0) out.push([pick.prev.i, pick.i, pick.next.i]);
      const next = pick.next;
      remove(pick);
      left--;
      ear = next;
      misses = 0;
    }
  }
  if (left === 3 && cross(ear.prev, ear, ear.next) > 0) out.push([ear.prev.i, ear.i, ear.next.i]);
  return out;
}
