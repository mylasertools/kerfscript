// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Bores from the assembly: where a rod of hardware (an axle, a dowel, a
// pin) passes through a part, a hole the shape of its section through the
// part's slab, at any angle, with room for the fit.

import { invert } from './assembly.js';
import type { HardwareItem } from './evaluator.js';
import { hull, type Poly } from './geometry.js';
import type { Solid } from './slots.js';

type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
};

// The fits a bore can ask for, as room added to the rod's diameter: a part
// that turns on its axle, and one held fast on it
export const FITS: Record<string, number> = { turn: 0.3, press: -0.1 };

// The rod's section round its axis, `room` wider in all: as many sides as
// it has when it has few (a hex key), otherwise round
function section(h: HardwareItem, room: number): Vec3[] {
  const axis = unit(sub(h.to, h.from));
  let up = sub(h.up, axis.map((x) => x * dot(h.up, axis)) as Vec3);
  if (Math.hypot(...up) < 1e-9) up = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const v = unit(sub(up, axis.map((x) => x * dot(up, axis)) as Vec3));
  const u = cross(v, axis);
  if (Array.isArray(h.size)) {
    const [w, ht] = [h.size[0] / 2 + room / 2, h.size[1] / 2 + room / 2];
    return [
      [-w, -ht],
      [w, -ht],
      [w, ht],
      [-w, ht],
    ].map(([a, b]) => [u[0] * a + v[0] * b, u[1] * a + v[1] * b, u[2] * a + v[2] * b]);
  }
  const r = h.size / 2 + room / 2;
  const n = h.sides < 12 ? h.sides : 64;
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    const [c, s] = [Math.cos(a) * r, Math.sin(a) * r];
    return [u[0] * s + v[0] * c, u[1] * s + v[1] * c, u[2] * s + v[2] * c];
  });
}

// The hole a rod cuts in a part's slab, in the part's own coordinates, or
// none when it misses the slab or lies along it
export function boreFor(target: Solid, h: HardwareItem, room: number): Poly | undefined {
  const d = sub(h.to, h.from);
  if (!(Math.hypot(...d) > 1e-9)) return undefined;
  const inv = invert(target.matrix);
  const local = (p: Vec3): Vec3 => [
    inv[0] * p[0] + inv[1] * p[1] + inv[2] * p[2] + inv[3],
    inv[4] * p[0] + inv[5] * p[1] + inv[6] * p[2] + inv[7],
    inv[8] * p[0] + inv[9] * p[1] + inv[10] * p[2] + inv[11],
  ];
  const D = sub(local(d), local([0, 0, 0]));
  // A rod lying along the part, or nearly, doesn't bore through it
  if (Math.abs(D[2]) < 0.05 * Math.hypot(...D)) return undefined;
  const pts: [number, number][] = [];
  for (const q of section(h, room)) {
    const A = local([h.from[0] + q[0], h.from[1] + q[1], h.from[2] + q[2]]);
    // Where this line along the rod is inside the slab, within its length
    let s0 = (0 - A[2]) / D[2],
      s1 = (target.thickness - A[2]) / D[2];
    if (s0 > s1) [s0, s1] = [s1, s0];
    s0 = Math.max(0, s0);
    s1 = Math.min(1, s1);
    if (!(s1 > s0)) continue;
    for (const s of [s0, s1]) pts.push([A[0] + D[0] * s, A[1] + D[1] * s]);
  }
  return pts.length >= 3 ? hull(pts) : undefined;
}
