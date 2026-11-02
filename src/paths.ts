// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import type { Poly, Pt } from './geometry.js';

export type Cmd =
  | { type: 'M' | 'L'; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' };

export interface Flattened {
  closed: Poly[];
  open: Poly[];
}

export function flatten(cmds: Cmd[], tolerance = 0.02): Flattened {
  const closed: Poly[] = [];
  const open: Poly[] = [];
  let cur: Poly = [];
  let start: Pt = [0, 0];
  let last: Pt = [0, 0];
  const finish = (close: boolean) => {
    if (cur.length >= 2) (close ? closed : open).push(cur);
    cur = [];
  };
  const steps = (len: number) => Math.max(2, Math.min(256, Math.ceil(Math.sqrt(len / tolerance))));
  for (const c of cmds) {
    if (c.type === 'M') {
      finish(false);
      start = last = [c.x, c.y];
      cur = [last];
    } else if (c.type === 'L') {
      last = [c.x, c.y];
      cur.push(last);
    } else if (c.type === 'Q') {
      const [x0, y0] = last;
      const n = steps(Math.hypot(c.x1 - x0, c.y1 - y0) + Math.hypot(c.x - c.x1, c.y - c.y1));
      for (let i = 1; i <= n; i++) {
        const t = i / n,
          u = 1 - t;
        cur.push([
          u * u * x0 + 2 * u * t * c.x1 + t * t * c.x,
          u * u * y0 + 2 * u * t * c.y1 + t * t * c.y,
        ]);
      }
      last = [c.x, c.y];
    } else if (c.type === 'C') {
      const [x0, y0] = last;
      const n = steps(
        Math.hypot(c.x1 - x0, c.y1 - y0) +
          Math.hypot(c.x2 - c.x1, c.y2 - c.y1) +
          Math.hypot(c.x - c.x2, c.y - c.y2),
      );
      for (let i = 1; i <= n; i++) {
        const t = i / n,
          u = 1 - t;
        cur.push([
          u * u * u * x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * y0 + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        ]);
      }
      last = [c.x, c.y];
    } else {
      finish(true);
      // Drawing goes on from the start of the closed subpath
      last = start;
      cur = [start];
    }
  }
  finish(false);
  return { closed, open };
}

// `arcStep` is the largest angle, in radians, one curve stands for in an arc.
// With `onError`, bad data ends the path where it is, as browsers draw it,
// instead of throwing.
export function parseSvgPath(
  d: string,
  arcStep = Math.PI / 2,
  onError?: (message: string) => void,
): Cmd[] {
  const isCommand = (t: string) => /^[a-zA-Z]$/.test(t);
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: Cmd[] = [];
  let i = 0;
  let cmd = '';
  let x = 0,
    y = 0,
    sx = 0,
    sy = 0;
  let cx = 0,
    cy = 0,
    qx = 0,
    qy = 0;
  let prev = '';
  const num = () => {
    const t = tokens[i++];
    if (t === undefined || isCommand(t)) throw new Error(`Bad path data near "${t ?? 'end'}"`);
    return Number(t);
  };
  const flag = () => {
    const t = tokens[i];
    if (t === undefined) throw new Error('Bad path data: missing arc flag');
    if (t.length > 1 && (t[0] === '0' || t[0] === '1') && !t.includes('.')) {
      tokens[i] = t.slice(1);
      return Number(t[0]);
    }
    i++;
    return Number(t);
  };
  try {
    readCommands();
  } catch (e) {
    if (!onError) throw e;
    onError((e as Error).message);
  }
  return out;

  function readCommands() {
    while (i < tokens.length) {
      if (isCommand(tokens[i])) cmd = tokens[i++];
      else if (!cmd) throw new Error('Path data must start with a command');
      else if (cmd === 'Z' || cmd === 'z')
        throw new Error(`Bad path data near "${tokens[i]}": Z takes no numbers`);
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      const ox = rel ? x : 0,
        oy = rel ? y : 0;
      if (C === 'M') {
        x = ox + num();
        y = oy + num();
        sx = x;
        sy = y;
        out.push({ type: 'M', x, y });
        cmd = rel ? 'l' : 'L';
      } else if (C === 'L') {
        x = ox + num();
        y = oy + num();
        out.push({ type: 'L', x, y });
      } else if (C === 'H') {
        x = ox + num();
        out.push({ type: 'L', x, y });
      } else if (C === 'V') {
        y = oy + num();
        out.push({ type: 'L', x, y });
      } else if (C === 'C' || C === 'S') {
        let x1: number, y1: number;
        if (C === 'C') {
          x1 = ox + num();
          y1 = oy + num();
        } else {
          const smooth = prev === 'C' || prev === 'S';
          x1 = smooth ? 2 * x - cx : x;
          y1 = smooth ? 2 * y - cy : y;
        }
        const x2 = ox + num(),
          y2 = oy + num();
        x = ox + num();
        y = oy + num();
        cx = x2;
        cy = y2;
        out.push({ type: 'C', x1, y1, x2, y2, x, y });
      } else if (C === 'Q' || C === 'T') {
        let x1: number, y1: number;
        if (C === 'Q') {
          x1 = ox + num();
          y1 = oy + num();
        } else {
          const smooth = prev === 'Q' || prev === 'T';
          x1 = smooth ? 2 * x - qx : x;
          y1 = smooth ? 2 * y - qy : y;
        }
        x = ox + num();
        y = oy + num();
        qx = x1;
        qy = y1;
        out.push({ type: 'Q', x1, y1, x, y });
      } else if (C === 'A') {
        const rx = num(),
          ry = num(),
          rot = num(),
          large = flag(),
          sweep = flag();
        const x2 = ox + num(),
          y2 = oy + num();
        out.push(...arcToCubics(x, y, rx, ry, rot, large, sweep, x2, y2, arcStep));
        x = x2;
        y = y2;
      } else if (C === 'Z') {
        out.push({ type: 'Z' });
        x = sx;
        y = sy;
      } else throw new Error(`Unknown path command "${cmd}"`);
      prev = C;
    }
  }
}

function arcToCubics(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  rotDeg: number,
  large: number,
  sweep: number,
  x2: number,
  y2: number,
  step = Math.PI / 2,
): Cmd[] {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [{ type: 'L', x: x2, y: y2 }];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(phi),
    sin = Math.sin(phi);
  const dx = (x1 - x2) / 2,
    dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy,
    y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry,
    cyp = (-coef * ry * x1p) / rx;
  const cxa = cos * cxp - sin * cyp + (x1 + x2) / 2,
    cya = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dt) / step);
  const out: Cmd[] = [];
  const pt = (t: number): Pt => [
    cxa + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    cya + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  ];
  const der = (t: number): Pt => [
    -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  ];
  for (let k = 0; k < n; k++) {
    const a = t1 + (dt * k) / n,
      b = t1 + (dt * (k + 1)) / n;
    const alpha = (4 / 3) * Math.tan((b - a) / 4);
    const p0 = pt(a),
      p3 = pt(b),
      d0 = der(a),
      d3 = der(b);
    out.push({
      type: 'C',
      x1: p0[0] + alpha * d0[0],
      y1: p0[1] + alpha * d0[1],
      x2: p3[0] - alpha * d3[0],
      y2: p3[1] - alpha * d3[1],
      x: p3[0],
      y: p3[1],
    });
  }
  return out;
}
