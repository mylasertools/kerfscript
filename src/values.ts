// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import type { Expr, Param } from './ast.js';

export interface Range {
  type: 'range';
  start: number;
  step: number;
  end: number;
}

export interface Closure {
  type: 'function';
  params: Param[];
  body: Expr;
  scope: unknown;
  name?: string;
}

export interface Rec {
  type: 'record';
  fields: Map<string, Value>;
}

export type Value = number | string | boolean | undefined | Value[] | Range | Closure | Rec;

export const isRange = (v: Value): v is Range =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && v.type === 'range';
export const isFn = (v: Value): v is Closure =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && v.type === 'function';
export const isNum = (v: Value): v is number => typeof v === 'number';
export const isRec = (v: Value): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && v.type === 'record';

// o[key] when o has its own property key, so names such as "toString" do not
// find what every object inherits
export const own = <T>(o: Record<string, T> | undefined, key: string): T | undefined =>
  o && Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;

// Throws when a setting from outside the program (render()'s params, kerf -p,
// the WASM request) is not a value a KerfScript literal could give
export function checkSetting(name: string, v: unknown, depth = 0): void {
  if (v === null || v === undefined || ['number', 'string', 'boolean'].includes(typeof v)) return;
  if (Array.isArray(v) && depth < 32) {
    for (const x of v) checkSetting(name, x, depth + 1);
    return;
  }
  throw new Error(`Setting "${name}" must be a number, string, boolean or list`);
}

export function rangeValues(r: Range, limit: number): number[] {
  const out: number[] = [];
  if (r.step === 0) return out;
  if (r.step > 0 ? r.start > r.end : r.start < r.end) return out;
  const n = Math.floor((r.end - r.start) / r.step + 1e-9) + 1;
  if (n > limit) throw new Error(`a range of ${n} items is more than the limit of ${limit}`);
  for (let k = 0; k < n; k++) out.push(r.start + k * r.step);
  return out;
}

export function truthy(v: Value): boolean {
  if (v === undefined || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'number') return !Number.isNaN(v);
  return true;
}

const same = (a: Value, b: Value, step?: () => void): boolean =>
  isRange(a) && isRange(b)
    ? a.start === b.start && a.step === b.step && a.end === b.end
    : isRec(a) && isRec(b)
      ? a.fields.size === b.fields.size &&
        [...a.fields].every(([k, v]) => b.fields.has(k) && equals(v, b.fields.get(k), step))
      : a === b;

// a == b. step() runs once for each pair of values compared, so comparing
// long lists counts towards the program's steps. A list can hold the same
// list many times, so pairs of lists found equal are not compared again.
export function equals(a: Value, b: Value, step?: () => void): boolean {
  step?.();
  if (!Array.isArray(a) || !Array.isArray(b)) return same(a, b, step);
  const seen = new Map<Value[], Set<Value[]>>();
  const open: [Value[], Value[], number][] = [];
  const enter = (x: Value[], y: Value[]) => {
    let ys = seen.get(x);
    if (ys?.has(y)) return true;
    if (x.length !== y.length) return false;
    if (!ys) seen.set(x, (ys = new Set()));
    ys.add(y);
    open.push([x, y, 0]);
    return true;
  };
  if (!enter(a, b)) return false;
  while (open.length) {
    const top = open[open.length - 1];
    if (top[2] === top[0].length) {
      open.pop();
      continue;
    }
    const x = top[0][top[2]];
    const y = top[1][top[2]++];
    step?.();
    if (Array.isArray(x) && Array.isArray(y) ? !enter(x, y) : !same(x, y, step)) return false;
  }
  return true;
}

export function typeName(v: Value): string {
  if (v === undefined) return 'undef';
  if (Array.isArray(v)) return 'list';
  if (isRange(v)) return 'range';
  if (isFn(v)) return 'function';
  if (isRec(v)) return 'record';
  return typeof v;
}

function scalar(v: Value): string {
  if (v === undefined) return 'undef';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') return fmt(v);
  if (isRange(v)) return `[${fmt(v.start)}:${fmt(v.step)}:${fmt(v.end)}]`;
  if (isFn(v)) return `function(${v.params.map((p) => p.name).join(', ')})`;
  if (isRec(v)) return '{}';
  return String(v);
}

// v as text, a string as it is unless quote is set. A list can hold the same
// list many times, so its text can be far longer than the memory it takes:
// writing stops once the text passes max characters, and whole is false.
export function write(v: Value, max: number, quote = false): { text: string; whole: boolean } {
  if (typeof v === 'string' && !quote)
    return { text: v.length > max ? v.slice(0, Math.max(max, 0)) : v, whole: v.length <= max };
  const out: string[] = [];
  let n = 0;
  const put = (s: string) => {
    out.push(s);
    n += s.length;
  };
  // Lists and records being written, each with its items, the next one's
  // index and, for a record, the field names
  const open: { items: Value[]; i: number; keys?: string[]; close: string }[] = [];
  let next: Value = v;
  for (;;) {
    if (Array.isArray(next)) {
      put('[');
      open.push({ items: next, i: 0, close: ']' });
    } else if (isRec(next) && next.fields.size) {
      put('{');
      open.push({
        items: [...next.fields.values()],
        keys: [...next.fields.keys()],
        i: 0,
        close: '}',
      });
    } else put(scalar(next));
    let more = false;
    while (open.length && !more && n <= max) {
      const top = open[open.length - 1];
      if (top.i < top.items.length) {
        if (top.i) put(', ');
        if (top.keys) put(`${top.keys[top.i]} = `);
        next = top.items[top.i++];
        more = true;
      } else {
        open.pop();
        put(top.close);
      }
    }
    if (!more || n > max) break;
  }
  const text = out.join('');
  return n > max ? { text: text.slice(0, Math.max(max, 0)), whole: false } : { text, whole: true };
}

// Values as text joined by sep, or undefined once that passes max characters
export function joinText(vs: Value[], sep: string, max: number): string | undefined {
  const out: string[] = [];
  let n = 0;
  for (const v of vs) {
    if (out.length) n += sep.length;
    const r = write(v, max - n);
    if (!r.whole) return undefined;
    n += r.text.length;
    out.push(r.text);
  }
  return out.join(sep);
}

// v as text for messages, cut short after 200 characters
export function show(v: Value): string {
  const r = write(v, 200, true);
  return r.whole ? r.text : r.text + '...';
}

// String(v) and Number(v) without writing out every list inside v
export const toText = (v: Value): string => (typeof v === 'string' ? v : show(v));
export function toNumber(v: Value): number {
  let inList = false;
  while (Array.isArray(v) && v.length === 1) {
    v = v[0];
    inList = true;
  }
  if (Array.isArray(v)) return v.length ? NaN : 0;
  if (inList && (v === undefined || typeof v === 'boolean')) return v === undefined ? 0 : NaN;
  return typeof v === 'object' ? NaN : Number(v);
}

export function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(10)));
}
