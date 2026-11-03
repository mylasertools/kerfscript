// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import {
  equals,
  isFn,
  isNum,
  isRange,
  joinText,
  rangeValues,
  typeName,
  type Value,
} from './values.js';

import { flatten, parseSvgPath } from './paths.js';

const RAD = Math.PI / 180;

// maxLength is the most items in a list or characters in a string,
// step(n) counts n steps of the program (one without n), and given is the
// number of arguments the call gave, positional and named
export interface FnCtx {
  maxLength: number;
  step: (n?: number) => void;
  given: number;
}

type Run = (args: Value[], c: FnCtx) => Value;

export interface Builtin {
  params: string[];
  // Takes any number of values after the parameters
  rest: boolean;
  // The parameters in positional order for this many positional arguments
  order?: (n: number) => string[];
  run: Run;
}

const def = (sig: string, run: Run, order?: (n: number) => string[]): Builtin => ({
  params: sig
    .replace('...', '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean),
  rest: sig.endsWith('...'),
  order,
  run,
});

// Parameters given both by position and by name, as in min(1, values = [2])
export function givenTwice(f: Builtin, pos: Value[], named: Map<string, Value>): string[] {
  if (f.order) return []; // positional values go to the parameters not named
  return f.params.filter((p, i) => i < pos.length && named.has(p));
}

// Arguments in parameter order: named ones by name, the rest by position
export function bindArgs(f: Builtin, pos: Value[], named: Map<string, Value>): Value[] {
  if (f.rest) {
    const out = [...pos];
    f.params.forEach((p, i) => {
      if (named.has(p)) out[i] = named.get(p);
    });
    return out;
  }
  if (!f.order) return f.params.map((p, i) => (named.has(p) ? named.get(p) : pos[i]));
  // Overloads such as log(x) and log(base, x) pick an order by the number of
  // arguments, positional and named. Positional ones go to the parameters
  // not named, so log(2, x = 8) and log(8, base = 2) are both 3.
  const given = pos.length + f.params.filter((p) => named.has(p)).length;
  const free = f.order(given).filter((p) => !named.has(p));
  return f.params.map((p) => (named.has(p) ? named.get(p) : pos[free.indexOf(p)]));
}

// Values written as text. Writing takes a step for every 8 characters: a
// list that holds the same list many times writes long text from few items.
function text(vs: Value[], sep: string, c: FnCtx, fn: string): string {
  const out = joinText(vs, sep, c.maxLength);
  if (out === undefined)
    throw new Error(
      `${fn}(): the text would be longer than the limit of ${c.maxLength} characters`,
    );
  c.step(Math.ceil(out.length / 8));
  return out;
}

function num(v: Value, fn: string): number {
  if (typeof v !== 'number') throw new Error(`${fn}() needs a number, got ${typeName(v)}`);
  return v;
}

function list(v: Value, fn: string, c: FnCtx): Value[] {
  if (Array.isArray(v)) return v;
  if (isRange(v)) return rangeValues(v, c.maxLength);
  if (typeof v === 'string') return [...v];
  throw new Error(`${fn}() needs a list, got ${typeName(v)}`);
}

// Built-ins whose time does not depend on how long their arguments are
const CONSTANT_TIME = new Set([
  'is_num',
  'is_string',
  'is_bool',
  'is_list',
  'is_undef',
  'is_function',
  'type_of',
  'ord',
]);

/**
 * Steps a built-in takes to go through its arguments: one for each item of a
 * list or range and each character of a string. len() of a list is a single
 * step. A range is counted up to just past max, the most items it may hold.
 */
export function argumentWork(name: string, args: Value[], max: number): number {
  if (CONSTANT_TIME.has(name)) return 0;
  let n = 0;
  for (const v of args) {
    if (typeof v === 'string') n += v.length;
    else if (Array.isArray(v)) n += name === 'len' ? 0 : v.length;
    else if (isRange(v) && v.step !== 0) {
      // NaN when a bound or the step is not a number: such a range is empty
      const items = Math.floor((v.end - v.start) / v.step) + 1;
      if (items > 0) n += Math.min(items, max + 1);
    }
  }
  return n;
}

const math1 = (f: (x: number) => number) =>
  def('x', (a) => (typeof a[0] === 'number' ? clean(f(a[0])) : undefined));

function clean(x: number): number {
  const r = Math.round(x);
  return Math.abs(x - r) < 1e-12 ? r : x;
}

function seeded(seed: number) {
  let s = Math.floor(seed) >>> 0 || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function minmax(a: Value[], pick: (xs: number[]) => number, name: string): Value {
  const xs = a.length === 1 && Array.isArray(a[0]) ? a[0] : a;
  if (!xs.length) return undefined;
  return pick(xs.map((x) => num(x, name)));
}

export const FUNCTIONS: Record<string, Builtin> = {
  abs: math1(Math.abs),
  sign: math1(Math.sign),
  floor: math1(Math.floor),
  ceil: math1(Math.ceil),
  round: math1((x) => (x < 0 ? -Math.round(-x) : Math.round(x))),
  sqrt: math1(Math.sqrt),
  exp: math1(Math.exp),
  ln: math1(Math.log),
  // log(x) is base 10; log(base, x) takes the base first
  log: def(
    'x, base',
    (a, c) =>
      c.given < 2
        ? clean(Math.log10(num(a[0], 'log')))
        : Math.log(num(a[0], 'log')) / Math.log(num(a[1], 'log')),
    (n) => (n >= 2 ? ['base', 'x'] : ['x', 'base']),
  ),
  sin: math1((x) => Math.sin(x * RAD)),
  cos: math1((x) => Math.cos(x * RAD)),
  tan: math1((x) => Math.tan(x * RAD)),
  asin: math1((x) => Math.asin(x) / RAD),
  acos: math1((x) => Math.acos(x) / RAD),
  atan: math1((x) => Math.atan(x) / RAD),
  atan2: def('y, x', (a) => clean(Math.atan2(num(a[0], 'atan2'), num(a[1], 'atan2')) / RAD)),
  pow: def('x, y', (a) => Math.pow(num(a[0], 'pow'), num(a[1], 'pow'))),
  min: def('values...', (a) =>
    minmax(a, (xs) => xs.reduce((m, x) => (x < m ? x : m), Infinity), 'min'),
  ),
  max: def('values...', (a) =>
    minmax(a, (xs) => xs.reduce((m, x) => (x > m ? x : m), -Infinity), 'max'),
  ),
  clamp: def('x, low, high', (a) =>
    Math.min(Math.max(num(a[0], 'clamp'), num(a[1], 'clamp')), num(a[2], 'clamp')),
  ),
  lerp: def('a, b, t', (a) => {
    const t = num(a[2], 'lerp');
    if (Array.isArray(a[0]) && Array.isArray(a[1])) {
      const b = a[1];
      return a[0].map((x, i) => num(x, 'lerp') + (num(b[i], 'lerp') - num(x, 'lerp')) * t);
    }
    return num(a[0], 'lerp') + (num(a[1], 'lerp') - num(a[0], 'lerp')) * t;
  }),
  norm: def('v', (a, c) =>
    Math.sqrt(list(a[0], 'norm', c).reduce((s: number, x) => s + num(x, 'norm') ** 2, 0)),
  ),
  cross: def('a, b', (a, c) => {
    const u = list(a[0], 'cross', c).map((x) => num(x, 'cross'));
    const v = list(a[1], 'cross', c).map((x) => num(x, 'cross'));
    if (u.length === 2) return u[0] * v[1] - u[1] * v[0];
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  }),
  len: def('value', (a) =>
    typeof a[0] === 'string' ? [...a[0]].length : Array.isArray(a[0]) ? a[0].length : undefined,
  ),
  concat: def('...', (a, c) => {
    const n = a.reduce((s: number, x) => s + (Array.isArray(x) ? x.length : 1), 0);
    if (n > c.maxLength)
      throw new Error(`concat(): a list of ${n} items is more than the limit of ${c.maxLength}`);
    return a.flatMap((x) => (Array.isArray(x) ? x : [x]));
  }),
  reverse: def('value', (a, c) =>
    typeof a[0] === 'string'
      ? [...a[0]].reverse().join('')
      : [...list(a[0], 'reverse', c)].reverse(),
  ),
  sum: def('values', (a, c) => list(a[0], 'sum', c).reduce((s: number, x) => s + num(x, 'sum'), 0)),
  slice: def('value, start, end', (a, c) => {
    const xs = typeof a[0] === 'string' ? [...a[0]] : list(a[0], 'slice', c);
    const out = xs.slice(
      num(a[1] ?? 0, 'slice'),
      a[2] === undefined ? undefined : num(a[2], 'slice'),
    );
    return typeof a[0] === 'string' ? out.join('') : out;
  }),
  str: def('...', (a, c) => text(a, '', c, 'str')),
  chr: def('...', (a) =>
    a
      .flatMap((x) => (Array.isArray(x) ? x : [x]))
      .map((x) => String.fromCodePoint(num(x, 'chr')))
      .join(''),
  ),
  ord: def('text', (a) =>
    typeof a[0] === 'string' && a[0].length ? a[0].codePointAt(0) : undefined,
  ),
  upper: def('text', (a) => (typeof a[0] === 'string' ? a[0].toUpperCase() : undefined)),
  lower: def('text', (a) => (typeof a[0] === 'string' ? a[0].toLowerCase() : undefined)),
  split: def('text, separator', (a) =>
    typeof a[0] === 'string' ? a[0].split(typeof a[1] === 'string' ? a[1] : ' ') : undefined,
  ),
  join: def('values, separator', (a, c) =>
    text(list(a[0], 'join', c), typeof a[1] === 'string' ? a[1] : '', c, 'join'),
  ),
  search: def('value, list', (a, c) => {
    const xs = typeof a[1] === 'string' ? [...a[1]] : list(a[1], 'search', c);
    const i = xs.findIndex((x) => equals(x, a[0], c.step));
    return i < 0 ? undefined : i;
  }),
  contains: def('value, item', (a, c) =>
    typeof a[0] === 'string'
      ? a[0].includes(text([a[1]], '', c, 'contains'))
      : list(a[0], 'contains', c).some((x) => equals(x, a[1], c.step)),
  ),
  lookup: def('x, table', (a, c) => {
    const key = num(a[0], 'lookup');
    const table = list(a[1], 'lookup', c) as Value[][];
    if (!table.length) return undefined;
    const rows = table
      .map((r) => [num(r[0], 'lookup'), num(r[1], 'lookup')])
      .sort((p, q) => p[0] - q[0]);
    if (key <= rows[0][0]) return rows[0][1];
    for (let i = 1; i < rows.length; i++)
      if (key <= rows[i][0]) {
        const [x0, y0] = rows[i - 1];
        const [x1, y1] = rows[i];
        return y0 + ((key - x0) / (x1 - x0)) * (y1 - y0);
      }
    return rows[rows.length - 1][1];
  }),
  rands: def('min, max, count, seed', (a) => {
    const lo = num(a[0], 'rands'),
      hi = num(a[1], 'rands'),
      n = num(a[2], 'rands');
    const rnd = seeded(a[3] === undefined ? 1 : num(a[3], 'rands'));
    return Array.from(
      { length: Math.min(Math.max(0, Math.floor(n)), 1_000_000) },
      () => lo + (hi - lo) * rnd(),
    );
  }),
  is_num: def('value', (a) => isNum(a[0]) && !Number.isNaN(a[0])),
  is_string: def('value', (a) => typeof a[0] === 'string'),
  is_bool: def('value', (a) => typeof a[0] === 'boolean'),
  is_list: def('value', (a) => Array.isArray(a[0])),
  is_undef: def('value', (a) => a[0] === undefined),
  is_function: def('value', (a) => isFn(a[0])),
  type_of: def('value', (a) => typeName(a[0])),
  // Paths: lists of [x, y] points, measured along their length
  path_length: def('points', (a, c) => {
    const p = pts(a[0], 'path_length', c);
    let s = 0;
    for (let i = 1; i < p.length; i++)
      s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    return s;
  }),
  point_at: def(
    'points, s',
    (a, c) => alongPath(pts(a[0], 'point_at', c), num(a[1], 'point_at')).point,
  ),
  heading_at: def('points, s', (a, c) =>
    clean(alongPath(pts(a[0], 'heading_at', c), num(a[1], 'heading_at')).heading),
  ),
  // The points of SVG path data, each subpath as one list
  path_points: def('d, tolerance', (a, c) => {
    if (typeof a[0] !== 'string') throw new Error('path_points() needs SVG path data');
    const tol = a[1] === undefined ? 0.05 : num(a[1], 'path_points');
    if (!(tol > 0)) throw new Error('path_points(): tolerance must be more than 0');
    const f = flatten(parseSvgPath(a[0]), tol);
    const all = [...f.closed.map((p) => [...p, p[0]]), ...f.open];
    c.step(all.reduce((n, p) => n + p.length, 0));
    return all.map((p) => p.map(([x, y]) => [x, y]));
  }),
  // A smooth curve through points (Catmull-Rom), `steps` points a span
  spline_points: def('points, steps, closed', (a, c) => {
    const p = pts(a[0], 'spline_points', c);
    const n = a[1] === undefined ? 8 : Math.floor(num(a[1], 'spline_points'));
    if (!(n >= 1)) throw new Error('spline_points(): steps must be 1 or more');
    if (p.length * n > c.maxLength)
      throw new Error('spline_points(): the result would be too long');
    c.step(p.length * n);
    return catmullRom(p, n, a[2] === true);
  }),
  // Rotations in 3D, as part()'s rotate: the matrix for [x, y, z] degrees,
  // the angles of a matrix, and the angles that turn x and z onto vectors
  rotation: def('angles', (a) => {
    const [x, y, z] = vec3(a[0], 'rotation');
    return mat(mmul(rz(z), mmul(ry(y), rx(x))));
  }),
  euler: def('matrix', (a) => eulerOf(matrix3(a[0], 'euler'))),
  orient: def('x, z', (a) => {
    const X = unit(vec3(a[0], 'orient'), 'orient');
    let Z = vec3(a[1] ?? [0, 0, 1], 'orient');
    // z made square to x
    const d = Z[0] * X[0] + Z[1] * X[1] + Z[2] * X[2];
    Z = unit([Z[0] - d * X[0], Z[1] - d * X[1], Z[2] - d * X[2]], 'orient');
    const Y = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
    return eulerOf([
      [X[0], Y[0], Z[0]],
      [X[1], Y[1], Z[1]],
      [X[2], Y[2], Z[2]],
    ]);
  }),
};

type V3 = [number, number, number];
type M3 = number[][];

function pts(v: Value, fn: string, c: FnCtx): [number, number][] {
  const l = list(v, fn, c);
  return l.map((p, i) => {
    if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number')
      throw new Error(`${fn}(): points[${i}] must be an [x, y] point`);
    return [p[0], p[1]];
  });
}

// The point s along a path, and the heading there in degrees; before the
// start and past the end it carries on straight
function alongPath(p: [number, number][], s: number) {
  if (p.length < 2) throw new Error('a path needs at least two points');
  let i = 0;
  let at = 0;
  for (; i < p.length - 2; i++) {
    const l = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
    if (at + l >= s) break;
    at += l;
  }
  // Skip segments of no length for the heading
  let j = i;
  while (j < p.length - 2 && p[j + 1][0] === p[j][0] && p[j + 1][1] === p[j][1]) j++;
  const [a, b] = [p[j], p[j + 1]];
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u = (s - at) / l;
  return {
    point: [p[i][0] + (b[0] - a[0]) * u, p[i][1] + (b[1] - a[1]) * u],
    heading: Math.atan2(b[1] - a[1], b[0] - a[0]) / RAD,
  };
}

function vec3(v: Value, fn: string): V3 {
  if (!Array.isArray(v) || v.length < 2 || v.length > 3 || !v.every((x) => typeof x === 'number'))
    throw new Error(`${fn}() needs [x, y, z]`);
  return [v[0] as number, v[1] as number, (v[2] as number | undefined) ?? 0];
}

function unit(v: number[], fn: string): V3 {
  const l = Math.hypot(...v);
  if (!(l > 1e-12))
    throw new Error(`${fn}(): a direction can't be [0, 0, 0], or x and z the same way`);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function matrix3(v: Value, fn: string): M3 {
  if (
    !Array.isArray(v) ||
    v.length < 3 ||
    !v
      .slice(0, 3)
      .every(
        (r) =>
          Array.isArray(r) && r.length >= 3 && r.slice(0, 3).every((x) => typeof x === 'number'),
      )
  )
    throw new Error(`${fn}() needs a 3x3 matrix`);
  return (v as number[][]).slice(0, 3).map((r) => r.slice(0, 3));
}

const rx = (d: number): M3 => {
  const [c, s] = [Math.cos(d * RAD), Math.sin(d * RAD)];
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ];
};
const ry = (d: number): M3 => {
  const [c, s] = [Math.cos(d * RAD), Math.sin(d * RAD)];
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ];
};
const rz = (d: number): M3 => {
  const [c, s] = [Math.cos(d * RAD), Math.sin(d * RAD)];
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
};
const mmul = (A: M3, B: M3): M3 =>
  A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const mat = (M: M3) => M.map((r) => r.map(clean));

// [x, y, z] degrees with R = Rz Ry Rx, as part() turns
function eulerOf(M: M3): number[] {
  const sy = -M[2][0];
  if (Math.abs(sy) > 1 - 1e-12) {
    // Straight up or down: put the whole turn in z
    const y = sy > 0 ? 90 : -90;
    const z = Math.atan2(-M[0][1], M[1][1]) / RAD;
    return [0, y, clean(z)];
  }
  return [
    clean(Math.atan2(M[2][1], M[2][2]) / RAD),
    clean(Math.asin(sy) / RAD),
    clean(Math.atan2(M[1][0], M[0][0]) / RAD),
  ];
}

// A Catmull-Rom curve through the points, `n` points for each span; the
// ends are held straight
export function catmullRom(p: [number, number][], n: number, closed = false): [number, number][] {
  if (p.length < 3) return p.map(([x, y]) => [x, y]);
  const at = (i: number): [number, number] => {
    if (closed) return p[((i % p.length) + p.length) % p.length];
    if (i < 0) return [2 * p[0][0] - p[1][0], 2 * p[0][1] - p[1][1]];
    if (i >= p.length) {
      const [a, b] = [p[p.length - 1], p[p.length - 2]];
      return [2 * a[0] - b[0], 2 * a[1] - b[1]];
    }
    return p[i];
  };
  const out: [number, number][] = [];
  const spans = closed ? p.length : p.length - 1;
  for (let i = 0; i < spans; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n,
        t2 = t * t,
        t3 = t2 * t;
      out.push(
        [0, 1].map(
          (j) =>
            0.5 *
            (2 * p1[j] +
              (-p0[j] + p2[j]) * t +
              (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 +
              (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3),
        ) as [number, number],
      );
    }
  }
  out.push(closed ? out[0] : [p[p.length - 1][0], p[p.length - 1][1]]);
  return out;
}
