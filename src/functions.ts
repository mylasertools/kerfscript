// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import {
  equals,
  isFn,
  isNum,
  isRange,
  isRec,
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
  // Calls a function value with these arguments
  apply: (fn: Value, args: Value[]) => Value;
}

// Order for sort(): numbers, then strings, each among themselves, and lists
// item by item
function order(a: Value, b: Value, fn: string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const o = order(a[i], b[i], fn);
      if (o) return o;
    }
    return a.length - b.length;
  }
  throw new Error(
    `${fn}() can only order numbers, strings or lists of them, not ${typeName(a)} and ${typeName(b)}`,
  );
}

// A list of points, or of outlines (lists of points), as one list of points
function pointList(v: Value, fn: string, c: FnCtx): [number, number][] {
  const xs = list(v, fn, c);
  const flat =
    xs.length && Array.isArray(xs[0]) && Array.isArray((xs[0] as Value[])[0])
      ? xs.flatMap((r) => list(r, fn, c))
      : xs;
  return flat.map((p) => {
    if (!Array.isArray(p) || p.length < 2)
      throw new Error(`${fn}() needs points [x, y], got ${typeName(p)}`);
    return [num(p[0], fn), num(p[1], fn)];
  });
}

// The outlines in a value: one outline (a list of points) or a list of them
function outlines(v: Value, fn: string, c: FnCtx): [number, number][][] {
  const xs = list(v, fn, c);
  if (xs.length && Array.isArray(xs[0]) && Array.isArray((xs[0] as Value[])[0]))
    return xs.map((r) => pointList(r, fn, c));
  return [pointList(xs, fn, c)];
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

// Ken Perlin's improved gradient noise in three dimensions, with the
// lattice shuffled by a seed: smooth, about -1 to 1, 0 at whole numbers
const perms = new Map<number, Uint8Array>();
function permutation(seed: number): Uint8Array {
  let p = perms.get(seed);
  if (p) return p;
  const rnd = seeded(seed);
  const a = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = a[i & 255];
  if (perms.size > 64) perms.clear();
  perms.set(seed, p);
  return p;
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h: number, x: number, y: number, z: number) {
  const k = h & 15;
  const u = k < 8 ? x : y,
    v = k < 4 ? y : k === 12 || k === 14 ? x : z;
  return ((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v);
}
export function perlin(x: number, y: number, z: number, seed: number): number {
  const p = permutation(seed);
  const X = Math.floor(x),
    Y = Math.floor(y),
    Z = Math.floor(z);
  x -= X;
  y -= Y;
  z -= Z;
  const xi = X & 255,
    yi = Y & 255,
    zi = Z & 255;
  const u = fade(x),
    v = fade(y),
    w = fade(z);
  const A = p[xi] + yi,
    AA = p[A] + zi,
    AB = p[A + 1] + zi,
    B = p[xi + 1] + yi,
    BA = p[B] + zi,
    BB = p[B + 1] + zi;
  const l = (t: number, a: number, b: number) => a + t * (b - a);
  return l(
    w,
    l(
      v,
      l(u, grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z)),
      l(u, grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z)),
    ),
    l(
      v,
      l(u, grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1)),
      l(u, grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1)),
    ),
  );
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
    typeof a[0] === 'string'
      ? [...a[0]].length
      : Array.isArray(a[0])
        ? a[0].length
        : isRec(a[0])
          ? a[0].fields.size
          : undefined,
  ),
  // A record's field names, in the order they were written
  keys: def('record', (a) => (isRec(a[0]) ? [...a[0].fields.keys()] : undefined)),
  // A record with fields of the second added to or replacing the first's
  merge: def('a, b', (a) => {
    if (!isRec(a[0]) || !isRec(a[1])) throw new Error('merge() takes two records');
    return { type: 'record', fields: new Map([...a[0].fields, ...a[1].fields]) };
  }),
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
  // The list in order, smallest first; with key, ordered by key(item).
  // Items with equal keys keep their order
  sort: def('values, key', (a, c) => {
    const xs = list(a[0], 'sort', c);
    const key = a[1];
    const keyed = xs.map((x) => [key === undefined ? x : c.apply(key, [x]), x] as const);
    c.step(Math.ceil(xs.length * Math.log2(xs.length + 1)));
    return keyed.sort((p, q) => order(p[0], q[0], 'sort')).map(([, x]) => x);
  }),
  // The accumulator after fn(acc, item) for each item in turn, from initial
  fold: def('values, initial, fn', (a, c) => {
    let acc = a[1];
    for (const x of list(a[0], 'fold', c)) acc = c.apply(a[2], [acc, x]);
    return acc;
  }),
  // The accumulator after each item, as fold() goes: running totals
  scan: def('values, initial, fn', (a, c) => {
    let acc = a[1];
    return list(a[0], 'scan', c).map((x) => (acc = c.apply(a[2], [acc, x])));
  }),
  // [x0, y0, x1, y1] round a list of points, or of outlines
  bounds: def('points', (a, c) => {
    const ps = pointList(a[0], 'bounds', c);
    if (!ps.length) return undefined;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of ps) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return [x0, y0, x1, y1];
  }),
  // Where the line x = value (or y = value) crosses a closed outline, or a
  // list of them: the y (or x) values, smallest first, entering and leaving
  // in turn
  crossings: def('points, x, y', (a, c) => {
    if ((a[1] === undefined) === (a[2] === undefined))
      throw new Error('crossings() needs one of x or y');
    const across = a[1] === undefined;
    const at = num(across ? a[2] : a[1], 'crossings');
    const out: number[] = [];
    for (const ring of outlines(a[0], 'crossings', c))
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [pu, pv] = across ? [ring[j][1], ring[j][0]] : ring[j];
        const [qu, qv] = across ? [ring[i][1], ring[i][0]] : ring[i];
        // Half-open, so a line through a corner counts it once
        if (pu > at !== qu > at) out.push(pv + ((qv - pv) * (at - pu)) / (qu - pu));
      }
    return out.sort((p, q) => p - q);
  }),
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
  // Smooth noise at a point: x, y, z or a point [x, y] or [x, y, z].
  // octaves add finer layers, each half as strong at twice the detail.
  noise: def('x, y, z, seed, octaves', (a) => {
    let x: number,
      y = 0,
      z = 0;
    if (Array.isArray(a[0])) {
      const q = a[0];
      x = num(q[0], 'noise');
      y = q[1] === undefined ? 0 : num(q[1], 'noise');
      z = q[2] === undefined ? 0 : num(q[2], 'noise');
    } else {
      x = num(a[0], 'noise');
      if (a[1] !== undefined) y = num(a[1], 'noise');
      if (a[2] !== undefined) z = num(a[2], 'noise');
    }
    const seed = Math.floor(a[3] === undefined ? 1 : num(a[3], 'noise'));
    const n = a[4] === undefined ? 1 : Math.floor(num(a[4], 'noise'));
    if (!(n >= 1 && n <= 8)) throw new Error('noise(): octaves must be 1 to 8');
    let sum = 0,
      amp = 1,
      total = 0,
      f = 1;
    for (let i = 0; i < n; i++) {
      // Finer octaves shifted off the lattice, so they don't all meet 0 there
      sum +=
        amp * perlin(x * f + i * 0.3713, y * f + i * 0.6271, z * f + i * 0.1943, seed + i * 7919);
      total += amp;
      amp /= 2;
      f *= 2;
    }
    return clean(sum / total);
  }),
  is_num: def('value', (a) => isNum(a[0]) && !Number.isNaN(a[0])),
  is_string: def('value', (a) => typeof a[0] === 'string'),
  is_bool: def('value', (a) => typeof a[0] === 'boolean'),
  is_list: def('value', (a) => Array.isArray(a[0])),
  is_record: def('value', (a) => isRec(a[0])),
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
  // The path moved sideways by d, to its left going along it (right for
  // d < 0), each corner mitred: the two edges of a strip drawn along a curve
  offset_path: def('points, d, closed', (a, c) => {
    const p = pts(a[0], 'offset_path', c).filter(
      ([x, y], k, all) => k === 0 || x !== all[k - 1][0] || y !== all[k - 1][1],
    );
    const d = num(a[1], 'offset_path');
    const closed = a[2] === true;
    // A closed path given with its first point again at the end keeps it
    const again = closed && p.length > 1 && p[0][0] === p.at(-1)![0] && p[0][1] === p.at(-1)![1];
    if (again) p.pop();
    if (p.length < 2) throw new Error('offset_path(): a path needs at least two points');
    c.step(p.length);
    const n = p.length;
    // The left normal of the edge from point i to i + 1
    const normal = (i: number): [number, number] => {
      const [x0, y0] = p[i % n],
        [x1, y1] = p[(i + 1) % n];
      const l = Math.hypot(x1 - x0, y1 - y0);
      return [-(y1 - y0) / l, (x1 - x0) / l];
    };
    const out = p.map(([x, y], i) => {
      const first = !closed && i === 0,
        last = !closed && i === n - 1;
      const u = first ? normal(0) : normal((i - 1 + n) % n);
      const v = last ? normal(n - 2) : normal(i);
      // The mitre: the mean normal, made longer as the corner turns, up to
      // four times d at the sharpest corners
      let [mx, my] = [u[0] + v[0], u[1] + v[1]];
      const ml = Math.hypot(mx, my);
      if (ml < 1e-9) [mx, my] = u;
      else {
        const k = Math.min(2 / (ml * ml), 4 / ml);
        [mx, my] = [mx * k, my * k];
      }
      return [clean(x + d * mx), clean(y + d * my)];
    });
    return again ? [...out, out[0]] : out;
  }),
  // Tooth counts for a gear train of `stages` pairs whose ratio (turns in
  // for one turn out) comes nearest `ratio`
  train_for: def('ratio, stages, pinion, wheel', (a, c) => {
    const R = num(a[0], 'train_for');
    if (!(R > 0) || !Number.isFinite(R)) throw new Error('train_for(): ratio must be more than 0');
    const n = a[1] === undefined ? 2 : num(a[1], 'train_for');
    if (!(n === 1 || n === 2 || n === 3)) throw new Error('train_for(): stages must be 1, 2 or 3');
    const span = (v: Value, d: [number, number], what: string): [number, number] => {
      if (v === undefined) return d;
      if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => typeof x === 'number'))
        throw new Error(`train_for(): ${what} must be [fewest, most] teeth`);
      const [lo, hi] = [Math.ceil(v[0] as number), Math.floor(v[1] as number)];
      if (!(lo >= 6 && hi >= lo && hi <= 400))
        throw new Error(`train_for(): ${what} teeth must be from 6 to 400, fewest first`);
      return [lo, hi];
    };
    const [p0, p1] = span(a[2], [10, 20], 'pinion');
    const [w0, w1] = span(a[3], [20, 80], 'wheel');
    // A ratio under 1 speeds up: search its inverse, then drive from the wheels
    const up = R < 1;
    const target = up ? 1 / R : R;
    const pairs: [number, number][] = [];
    for (let p = p0; p <= p1; p++) for (let w = Math.max(w0, p); w <= w1; w++) pairs.push([p, w]);
    let best: { stages: [number, number][]; err: number; teeth: number } | undefined;
    const consider = (stages: [number, number][]) => {
      const r = stages.reduce((x, [p, w]) => (x * w) / p, 1);
      const err = Math.abs(r / target - 1);
      const teeth = stages.reduce((t, [p, w]) => t + p + w, 0);
      if (
        !best ||
        err < best.err - 1e-12 ||
        (Math.abs(err - best.err) <= 1e-12 && teeth < best.teeth)
      )
        best = { stages: stages.map((s) => [...s] as [number, number]), err, teeth };
    };
    // The last stage's wheel is worked out for each pinion; the stages before
    // it are tried in order of their pairs, so each train is tried once
    const last = (before: [number, number][], rest: number) => {
      c.step();
      for (let p = p0; p <= p1; p++)
        for (const w of [Math.floor(rest * p), Math.ceil(rest * p)])
          if (w >= Math.max(w0, p) && w <= w1) consider([...before, [p, w]]);
    };
    if (n === 1) last([], target);
    else
      for (let i = 0; i < pairs.length; i++) {
        const r1 = pairs[i][1] / pairs[i][0];
        if (n === 2) last([pairs[i]], target / r1);
        else
          for (let j = i; j < pairs.length; j++)
            last([pairs[i], pairs[j]], target / r1 / (pairs[j][1] / pairs[j][0]));
      }
    if (!best) throw new Error(`train_for(): no train of ${n} stages reaches a ratio of ${R}`);
    const stages = best.stages.map(([p, w]) => (up ? [w, p] : [p, w]));
    const ratio = stages.reduce((x, [d, e]) => (x * e) / d, 1);
    return {
      type: 'record',
      fields: new Map<string, Value>([
        ['stages', stages],
        ['ratio', ratio],
        ['error', ratio / R - 1],
      ]),
    };
  }),
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
function alongPath(points: [number, number][], s: number) {
  if (points.length < 2) throw new Error('a path needs at least two points');
  // Repeated points make segments of no length: leave them out, so the
  // first and last segments have a direction to carry on in
  const p = points.filter(
    ([x, y], k) => k === 0 || x !== points[k - 1][0] || y !== points[k - 1][1],
  );
  if (p.length < 2) return { point: [p[0][0], p[0][1]], heading: 0 };
  let i = 0;
  let at = 0;
  for (; i < p.length - 2; i++) {
    const l = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
    if (at + l >= s) break;
    at += l;
  }
  const [a, b] = [p[i], p[i + 1]];
  const u = (s - at) / Math.hypot(b[0] - a[0], b[1] - a[1]);
  return {
    point: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u],
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
