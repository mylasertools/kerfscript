// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import type { Arg, Assign, Expr, ListItem, Param, Program, Stmt } from './ast.js';
import { argumentWork, bindArgs, FUNCTIONS, givenTwice } from './functions.js';
import {
  clipLines,
  difference,
  emptyShape,
  ellipsePoly,
  fragments,
  hull,
  intersection,
  isEmpty,
  lineShape,
  merge,
  offset,
  regionShape,
  retag,
  roundedRect,
  strokeLines,
  transform,
  union,
  type Layer,
  type Matrix,
  type Poly,
  type Pt,
  type Shape,
} from './geometry.js';
import { fingerCount, fingerHoles, fingerRect, livingHinge, tslot, type Edge } from './joinery.js';
import type { Placement, Vec3 } from './assembly.js';
import { KerfError, where, type Pos } from './lexer.js';
import { parse } from './parser.js';
import { signature } from './signatures.js';
import { LIBRARIES } from './stdlib.js';
import { flatten, parseSvgPath } from './paths.js';
import { textMetrics, textRegions, type FontBook } from './text.js';
import {
  equals,
  isFn,
  isRange,
  own,
  rangeValues,
  show,
  toNumber,
  toText,
  truthy,
  typeName,
  write,
  type Closure,
  type Value,
} from './values.js';

export interface LayerDef {
  name: string;
  mode: 'cut' | 'line' | 'fill' | 'guide';
  color: string;
}

export const DEFAULT_LAYERS: LayerDef[] = [
  { name: 'engrave', mode: 'fill', color: '#000000' },
  { name: 'score', mode: 'line', color: '#0000ff' },
  { name: 'cut', mode: 'cut', color: '#ff0000' },
  { name: 'guide', mode: 'guide', color: '#00a0ff' },
];

export interface EvalOptions {
  overrides?: Record<string, Value>;
  resolve?: (path: string) => string | undefined;
  fonts?: FontBook;
  maxSteps?: number;
  limits?: Partial<Limits>;
}

// Upper bounds that keep a program from using unbounded memory. Programs from
// other people can run in a browser tab, so every one of these is enforced.
export interface Limits {
  // Total copies of all parts, counting qty
  maxParts: number;
  // Segments in one circle, ellipse or arc
  maxSegments: number;
  // Items in one list, or characters in one string
  maxListLength: number;
  // Items in all lists the program builds, added up. Every list also counts
  // as LIST_COST items for the memory it takes on its own, and every string
  // built or echoed counts one item per CHARS_PER_ITEM characters.
  maxListItems: number;
  // Characters passed to one text() call
  maxTextLength: number;
  // Points in all shapes the built-in modules create, added up. Every shape
  // also counts as SHAPE_COST points for the memory it takes on its own.
  maxPoints: number;
  // Points in the exported files, counting every copy
  maxOutputPoints: number;
  // Sheets in the layout
  maxSheets: number;
  // Pairs of touching placed parts checked for collisions
  maxCollisionPairs: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxParts: 10_000,
  maxSegments: 10_000,
  maxListLength: 1_000_000,
  maxListItems: 3_000_000,
  maxTextLength: 2_000,
  maxPoints: 2_000_000,
  maxOutputPoints: 1_000_000,
  maxSheets: 200,
  maxCollisionPairs: 20_000,
};

const SHAPE_COST = 100;
const LIST_COST = 4;
// Characters in a string that cost as much memory as one list item
const CHARS_PER_ITEM = 8;

const shapePoints = (s: Shape): number => {
  let n = SHAPE_COST;
  const add = (layers: Map<string, Layer>) => {
    for (const l of layers.values()) {
      for (const p of l.regions) n += p.length;
      for (const p of l.lines) n += p.length;
    }
  };
  add(s.layers);
  for (const p of s.parts) add(p.layers);
  return n;
};

interface ModDef {
  params: Param[];
  body: Stmt[];
  env: Env;
}

interface FnDef {
  params: Param[];
  body: Expr;
  env: Env;
}

interface ChildCtx {
  stmts: Stmt[];
  env: Env;
}

class Env {
  vars = new Map<string, Value>();
  fns = new Map<string, FnDef>();
  mods = new Map<string, ModDef>();
  children?: ChildCtx;
  constructor(
    public parent?: Env,
    public caller?: Env,
  ) {}

  get(name: string): { found: boolean; value?: Value } {
    let e: Env | undefined = this;
    const dynamic = name.startsWith('$');
    while (e) {
      if (e.vars.has(name)) return { found: true, value: e.vars.get(name) };
      e = dynamic ? (e.caller ?? e.parent) : e.parent;
    }
    return { found: false };
  }
  fn(name: string): FnDef | undefined {
    for (let e: Env | undefined = this; e; e = e.parent) {
      const f = e.fns.get(name);
      if (f) return f;
    }
  }
  mod(name: string): ModDef | undefined {
    for (let e: Env | undefined = this; e; e = e.parent) {
      const m = e.mods.get(name);
      if (m) return m;
    }
  }
  childCtx(): ChildCtx | undefined {
    for (let e: Env | undefined = this; e; e = e.parent) if (e.children) return e.children;
  }

  // Every name of one kind in scope, for suggestions
  names(kind: 'vars' | 'fns' | 'mods'): string[] {
    const out: string[] = [];
    for (let e: Env | undefined = this; e; e = e.parent) out.push(...e[kind].keys());
    return out;
  }
}

interface Args {
  pos: Value[];
  named: Map<string, Value>;
  // Every argument in the order written
  all: { name: string | null; value: Value }[];
  at: Pos;
}

// A hint as a new sentence after a message that has no full stop
const sentence = (hint: string) => (hint ? `.${hint}` : '');

// Functions the evaluator runs itself rather than through FUNCTIONS
const SPECIAL = ['echo', 'assert', 'text_width', 'text_metrics', 'finger_count'];

// ` Did you mean "x"?` for the known name closest to a mistyped one
export function didYouMean(name: string, known: Iterable<string>): string {
  let best = '';
  let bestCost = Math.min(2, Math.floor(name.length / 3)) + 0.5;
  for (const k of new Set(known)) {
    if (k === name) continue;
    const cost = k.toLowerCase() === name.toLowerCase() ? 0 : distance(name, k);
    if (cost < bestCost) [best, bestCost] = [k, cost];
  }
  return best ? ` Did you mean "${best}"?` : '';
}

// Edits (insert, delete, change, swap two neighbours) between two names
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

interface BuiltinCtx {
  args: Args;
  env: Env;
  children: () => Shape;
  childList: () => Shape[];
}

export interface EvalResult {
  shape: Shape;
  globals: Env;
  layers: Map<string, LayerDef>;
  echoes: string[];
  warnings: string[];
}

export const STDLIB: Record<string, string> = LIBRARIES;

export class Evaluator {
  private steps = 0;
  private depth = 0;
  private maxSteps: number;
  readonly limits: Limits;
  private pointCount = 0;
  private itemCount = 0;
  private copies = 0;
  readonly echoes: string[] = [];
  readonly warnings: string[] = [];
  readonly layers = new Map<string, LayerDef>(DEFAULT_LAYERS.map((l) => [l.name, l]));
  private loaded = new Map<string, Program>();
  private builtins: Record<string, (c: BuiltinCtx) => Shape>;

  constructor(private opts: EvalOptions = {}) {
    this.maxSteps = opts.maxSteps ?? 5_000_000;
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits };
    this.builtins = this.makeBuiltins();
  }

  run(program: Program): EvalResult {
    const g = new Env();
    const defaults: Record<string, Value> = {
      $fn: 0,
      $fa: 2,
      $fs: 0.2,
      $thickness: 3,
      $kerf: 0,
      $material: 'material',
      $sheet: [600, 400],
      $gap: 3,
      $layout: 'pack',
      PI: Math.PI,
    };
    for (const [k, v] of Object.entries(defaults)) g.vars.set(k, v);
    const top = new Env(g);
    const shape = this.block(program.body, top, true);
    return {
      shape,
      globals: top,
      layers: this.layers,
      echoes: this.echoes,
      warnings: this.warnings,
    };
  }

  private tick(pos?: Pos, n = 1) {
    // Written so that a count that is not a number stops the program too
    if (!((this.steps += n) <= this.maxSteps))
      throw new KerfError(`Stopped after ${this.maxSteps} steps. Is there an endless loop?`, pos);
  }

  private load(path: string, at: Pos): Program {
    const hit = this.loaded.get(path);
    if (hit) return hit;
    const src = own(STDLIB, path) ?? this.opts.resolve?.(path);
    if (typeof src !== 'string') throw new KerfError(`Library <${path}> not found`, at);
    this.loaded.set(path, { body: [] });
    const { program } = parse(src, path);
    this.loaded.set(path, program);
    return program;
  }

  private hoist(stmts: Stmt[], env: Env) {
    for (const s of stmts) {
      if (s.kind === 'module') env.mods.set(s.name, { params: s.params, body: s.body, env });
      else if (s.kind === 'function') env.fns.set(s.name, { params: s.params, body: s.body, env });
      else if (s.kind === 'use' && !s.include) {
        this.enter(this.using, s.path, s.pos, 'use');
        try {
          const body = this.included(this.load(s.path, s.pos).body, new Set([s.path]));
          const libEnv = new Env(env);
          this.hoist(body, libEnv);
          for (const ls of body)
            if (ls.kind === 'assign') this.assign(ls.name, this.expr(ls.value, libEnv), libEnv);
          for (const [k, v] of libEnv.mods) env.mods.set(k, v);
          for (const [k, v] of libEnv.fns) env.fns.set(k, v);
        } finally {
          this.using.pop();
        }
      }
    }
  }

  // Libraries being used or included, innermost last, to catch a loop
  private using: string[] = [];
  private including: string[] = [];

  private enter(chain: string[], path: string, at: Pos, verb: 'use' | 'include') {
    if (chain.includes(path)) {
      const loop = [...chain.slice(chain.indexOf(path)), path].map((p) => `<${p}>`);
      throw new KerfError(
        loop.length === 2
          ? `Library ${loop[0]} ${verb}s itself`
          : `Libraries ${verb} each other in a loop: ${loop.join(' → ')}`,
        at,
      );
    }
    chain.push(path);
  }

  // A library's statements with the files it includes written out in place
  private included(stmts: Stmt[], seen: Set<string>): Stmt[] {
    const out: Stmt[] = [];
    for (const s of stmts) {
      if (s.kind !== 'use' || !s.include) out.push(s);
      else if (!seen.has(s.path)) {
        seen.add(s.path);
        for (const t of this.included(this.load(s.path, s.pos).body, seen)) out.push(t);
      }
    }
    return out;
  }

  private assign(name: string, value: Value, env: Env) {
    env.vars.set(name, value);
  }

  block(stmts: Stmt[], env: Env, top = false): Shape {
    this.hoist(stmts, env);
    const shapes: Shape[] = [];
    for (const s of stmts) {
      const out = this.stmt(s, env, top);
      if (out && !isEmpty(out)) shapes.push(out);
    }
    return shapes.length === 1 ? shapes[0] : merge(shapes);
  }

  private stmt(s: Stmt, env: Env, top = false): Shape | null {
    this.tick(s.pos);
    switch (s.kind) {
      case 'assign': {
        const o = this.opts.overrides;
        const v =
          top && o && Object.prototype.hasOwnProperty.call(o, s.name)
            ? o[s.name]
            : this.expr(s.value, env);
        this.assign(s.name, v, env);
        return null;
      }
      case 'module':
      case 'function':
        return null;
      case 'use': {
        if (!s.include) return null;
        this.enter(this.including, s.path, s.pos, 'include');
        try {
          return this.block(this.load(s.path, s.pos).body, env);
        } finally {
          this.including.pop();
        }
      }
      case 'block':
        return this.block(s.body, new Env(env));
      case 'if':
        return truthy(this.expr(s.cond, env))
          ? this.block(s.then, new Env(env))
          : this.block(s.else, new Env(env));
      case 'let': {
        const e = new Env(env);
        this.bindSeq(s.assigns, e);
        return this.block(s.body, e);
      }
      case 'for': {
        const shapes: Shape[] = [];
        this.loop(s.assigns, env, (e) => shapes.push(this.block(s.body, e)));
        return merge(shapes);
      }
      case 'call':
        if (s.modifier === '*') return null;
        {
          const out = this.callModule(s, env);
          return s.modifier === '#' || s.modifier === '%' ? retag(out, 'guide') : out;
        }
    }
  }

  private bindSeq(assigns: Assign[], env: Env) {
    for (const a of assigns) this.assign(a.name, this.expr(a.value, env), env);
  }

  private iterable(v: Value, at: Pos): Value[] {
    if (isRange(v)) {
      try {
        return rangeValues(v, this.limits.maxListLength);
      } catch (e) {
        throw new KerfError((e as Error).message, at);
      }
    }
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') return [...v];
    if (v === undefined) return [];
    return [v];
  }

  private loop(
    assigns: Assign[],
    env: Env,
    body: (e: Env) => void,
    i = 0,
    cur: Env = new Env(env),
  ) {
    if (i === assigns.length) return body(cur);
    const a = assigns[i];
    for (const v of this.iterable(this.expr(a.value, cur), a.pos)) {
      this.tick(a.pos);
      const e = new Env(cur);
      e.vars.set(a.name, v);
      this.loop(assigns, env, body, i + 1, e);
    }
  }

  private evalArgs(args: Arg[], env: Env, at: Pos): Args {
    const pos: Value[] = [];
    const named = new Map<string, Value>();
    const all: Args['all'] = [];
    for (const a of args) {
      const v = this.expr(a.value, env);
      if (a.name === null) pos.push(v);
      else named.set(a.name, v);
      all.push({ name: a.name, value: v });
    }
    return { pos, named, all, at };
  }

  private bindParams(params: Param[], args: Args, env: Env, defEnv: Env, what: string) {
    const names = params.map((p) => p.name);
    params.forEach((p, i) => {
      let v: Value;
      if (args.named.has(p.name)) v = args.named.get(p.name);
      else if (i < args.pos.length) v = args.pos[i];
      else v = p.default ? this.expr(p.default, env) : undefined;
      env.vars.set(p.name, v);
    });
    for (const k of args.named.keys()) {
      if (k.startsWith('$')) env.vars.set(k, args.named.get(k));
      else if (!names.includes(k)) this.unknownArg(what, k, args.at, names);
    }
    this.checkCount(what, params.length, args);
    void defEnv;
  }

  // Warns about arguments a built-in does not take
  private checkArgs(name: string, args: Args) {
    const sig = signature(name);
    if (!sig) return;
    const names = sig.params.map((p) => p.name);
    if (!sig.anyNamed)
      for (const k of args.named.keys())
        if (!k.startsWith('$') && !names.includes(k))
          this.unknownArg(`${name}()`, k, args.at, names);
    if (!sig.rest) this.checkCount(`${name}()`, sig.params.filter((p) => !p.named).length, args);
  }

  // Warns about positional arguments past the parameters, which are ignored
  private checkCount(what: string, most: number, args: Args) {
    if (args.pos.length > most)
      this.warn(
        `${what}: takes ${most === 0 ? 'no' : `at most ${most}`} positional argument${most === 1 ? '' : 's'}, got ${args.pos.length}; the rest are ignored (${where(args.at, false)})`,
      );
  }

  private unknownArg(what: string, name: string, at: Pos, known: string[]) {
    this.warn(
      `${what}: unknown argument "${name}"${sentence(didYouMean(name, known))} (${where(at, false)})`,
    );
  }

  // A warning, once however often it comes up
  private warn(warning: string) {
    if (!this.warnings.includes(warning)) this.warnings.push(warning);
  }

  private callModule(s: Extract<Stmt, { kind: 'call' }>, env: Env): Shape {
    const args = this.evalArgs(s.args, env, s.pos);
    const user = env.mod(s.name);
    if (user) {
      if (++this.depth > 1000)
        throw new KerfError(
          `Recursion too deep in module ${s.name}(): it calls itself without stopping`,
          s.pos,
        );
      try {
        const e = new Env(user.env, env);
        this.bindParams(user.params, args, e, user.env, `${s.name}()`);
        e.children = { stmts: s.children, env };
        e.vars.set('$children', this.childStmts(s.children).length);
        return this.block(user.body, e);
      } catch (e) {
        throw this.inCall(e, 'module', s.name, s.pos);
      } finally {
        this.depth--;
      }
    }
    const b = own(this.builtins, s.name);
    if (!b) {
      const hint =
        s.name === 'color'
          ? ' Use layer(), cut(), score() or engrave() instead.'
          : didYouMean(s.name, [...env.names('mods'), ...Object.keys(this.builtins)]);
      throw new KerfError(`Unknown module ${s.name}().${hint}`, s.pos);
    }
    this.checkArgs(s.name, args);
    const callEnv = new Env(env, env);
    for (const [k, v] of args.named) if (k.startsWith('$')) callEnv.vars.set(k, v);
    const kids = this.childStmts(s.children);
    const childEnv = () => new Env(env, callEnv);
    const ctx: BuiltinCtx = {
      args,
      env: callEnv,
      children: () => (s.children.length ? this.block(s.children, childEnv()) : emptyShape()),
      childList: () => {
        const e = childEnv();
        this.hoist(s.children, e);
        const out: Shape[] = [];
        for (const st of s.children) {
          const r = this.stmt(st, e);
          if (kids.includes(st)) out.push(r ?? emptyShape());
        }
        return out;
      },
    };
    let out: Shape;
    try {
      out = b(ctx);
    } catch (e) {
      if (e instanceof KerfError || e instanceof RangeError) throw e;
      const err = new KerfError(`${s.name}(): ${(e as Error).message}`, s.pos);
      err.call = s.name;
      throw err;
    }
    this.pointCount += shapePoints(out);
    if (this.pointCount > this.limits.maxPoints)
      throw new KerfError(
        `The shapes have more than ${this.limits.maxPoints} points, the limit. Use fewer or simpler shapes, or a lower $fn.`,
        s.pos,
      );
    return out;
  }

  private childStmts(stmts: Stmt[]): Stmt[] {
    return stmts.filter(
      (s) =>
        s.kind !== 'assign' && s.kind !== 'module' && s.kind !== 'function' && s.kind !== 'use',
    );
  }

  callFunction(f: FnDef | Closure, args: Args, caller: Env, name: string): Value {
    if (++this.depth > 2000)
      throw new KerfError(
        `Recursion too deep in ${name}(): it calls itself without stopping`,
        args.at,
      );
    try {
      this.tick(args.at);
      const defEnv = (isFn(f as Value) ? (f as Closure).scope : (f as FnDef).env) as Env;
      const e = new Env(defEnv, caller);
      this.bindParams(f.params, args, e, defEnv, `${name}()`);
      return this.expr(f.body, e);
    } catch (e) {
      throw this.inCall(e, 'function', name, args.at);
    } finally {
      this.depth--;
    }
  }

  // An error leaving a module or function call, with that call added to its
  // trace. Running out of JavaScript stack becomes an error at the call
  // that went one level too deep; if making that error runs out of stack
  // too, the next call out tries again.
  private inCall(e: unknown, kind: 'module' | 'function', name: string, at: Pos): unknown {
    // Not a regular expression: with the stack this full, compiling one fails too
    if (e instanceof Error && !(e instanceof KerfError) && e.message.includes('call stack'))
      return new KerfError(
        `Recursion too deep in ${kind === 'module' ? 'module ' : ''}${name}(): it calls itself without stopping`,
        at,
      );
    if (e instanceof KerfError) e.addFrame(kind, name, at);
    return e;
  }

  expr(x: Expr, env: Env): Value {
    switch (x.kind) {
      case 'num':
      case 'str':
      case 'bool':
        return x.value;
      case 'undef':
        return undefined;
      case 'var': {
        const r = env.get(x.name);
        if (r.found) return r.value;
        const f = env.fn(x.name);
        if (f)
          return { type: 'function', params: f.params, body: f.body, scope: f.env, name: x.name };
        if (x.name.startsWith('$')) return undefined;
        throw new KerfError(
          `Unknown variable "${x.name}"${sentence(didYouMean(x.name, [...env.names('vars'), ...env.names('fns')]))}`,
          x.pos,
        );
      }
      case 'list': {
        const out: Value[] = [];
        for (const it of x.items) this.listItem(it, env, out, x.pos);
        this.charge(LIST_COST, x.pos);
        return out;
      }
      case 'range': {
        const start = this.expr(x.start, env);
        const end = this.expr(x.end, env);
        const step = x.step ? this.expr(x.step, env) : 1;
        if (typeof start !== 'number' || typeof end !== 'number' || typeof step !== 'number')
          throw new KerfError('Range values must be numbers', x.pos);
        return { type: 'range', start, step, end };
      }
      case 'unary': {
        const v = this.expr(x.arg, env);
        if (x.op === '!') return !truthy(v);
        if (x.op === '+') return v;
        return this.arith('*', -1, v, x.pos);
      }
      case 'binary': {
        if (x.op === '&&') return truthy(this.expr(x.left, env)) && truthy(this.expr(x.right, env));
        if (x.op === '||') return truthy(this.expr(x.left, env)) || truthy(this.expr(x.right, env));
        const a = this.expr(x.left, env);
        const b = this.expr(x.right, env);
        if (x.op === '==' || x.op === '!=')
          return equals(a, b, () => this.tick(x.pos)) === (x.op === '==');
        if (x.op === '<' || x.op === '<=' || x.op === '>' || x.op === '>=') {
          if (
            !(
              (typeof a === 'number' && typeof b === 'number') ||
              (typeof a === 'string' && typeof b === 'string')
            )
          )
            throw new KerfError(`Can't compare ${typeName(a)} ${x.op} ${typeName(b)}`, x.pos);
          return x.op === '<' ? a < b : x.op === '<=' ? a <= b : x.op === '>' ? a > b : a >= b;
        }
        return this.arith(x.op, a, b, x.pos);
      }
      case 'ternary':
        return truthy(this.expr(x.cond, env)) ? this.expr(x.then, env) : this.expr(x.else, env);
      case 'index': {
        const t = this.expr(x.target, env);
        const i = this.expr(x.index, env);
        if (typeof i !== 'number')
          throw new KerfError(`List index must be a number, got ${typeName(i)}`, x.pos);
        if (Array.isArray(t)) return t[Math.floor(i)];
        if (typeof t === 'string') return [...t][Math.floor(i)];
        if (isRange(t)) return [t.start, t.step, t.end][Math.floor(i)];
        return undefined;
      }
      case 'member': {
        const t = this.expr(x.target, env);
        const i = { x: 0, y: 1, z: 2 }[x.name];
        if (Array.isArray(t) && i !== undefined) return t[i];
        if (isRange(t) && (x.name === 'begin' || x.name === 'step' || x.name === 'end'))
          return x.name === 'begin' ? t.start : x.name === 'step' ? t.step : t.end;
        return undefined;
      }
      case 'call':
        return this.call(x, env);
      case 'lambda':
        return { type: 'function', params: x.params, body: x.body, scope: env };
      case 'let': {
        const e = new Env(env);
        this.bindSeq(x.assigns, e);
        return this.expr(x.body, e);
      }
    }
  }

  private listItem(it: ListItem, env: Env, out: Value[], at: Pos) {
    switch (it.kind) {
      case 'item': {
        const v = this.expr(it.expr, env);
        this.grow(out, 1, at);
        out.push(v);
        return;
      }
      case 'each': {
        const xs = this.iterable(this.expr(it.expr, env), at);
        this.grow(out, xs.length, at);
        for (const x of xs) out.push(x);
        return;
      }
      case 'for':
        this.loop(it.assigns, env, (e) => this.listItem(it.body, e, out, at));
        return;
      case 'if':
        if (truthy(this.expr(it.cond, env))) this.listItem(it.then, env, out, at);
        else if (it.else) this.listItem(it.else, env, out, at);
        return;
      case 'let': {
        const e = new Env(env);
        this.bindSeq(it.assigns, e);
        this.listItem(it.body, e, out, at);
      }
    }
  }

  private grow(out: Value[], n: number, at: Pos) {
    if (out.length + n > this.limits.maxListLength)
      throw new KerfError(
        `a list of ${out.length + n} items is more than the limit of ${this.limits.maxListLength}`,
        at,
      );
    this.charge(n, at);
  }

  private charge(items: number, at: Pos | undefined) {
    this.itemCount += items;
    if (!(this.itemCount <= this.limits.maxListItems))
      throw new KerfError(
        `The lists and strings hold more than ${this.limits.maxListItems} items in all, the limit. Is a loop building more than it needs?`,
        at,
      );
  }

  private call(x: Extract<Expr, { kind: 'call' }>, env: Env): Value {
    if (x.callee.kind === 'var') {
      const name = x.callee.name;
      const v = env.get(name);
      if (!v.found) {
        const f = env.fn(name);
        if (f) return this.callFunction(f, this.evalArgs(x.args, env, x.pos), env, name);
        const special = this.specialFunction(name, x, env);
        if (special.handled) return special.value;
        const b = own(FUNCTIONS, name);
        if (b) {
          const args = this.evalArgs(x.args, env, x.pos);
          this.checkArgs(name, args);
          for (const k of givenTwice(b, args.pos, args.named))
            this.warn(
              `${name}(): "${k}" is given by position and by name; the named value is used (${where(x.pos, false)})`,
            );
          const ctx = {
            maxLength: this.limits.maxListLength,
            step: (n?: number) => this.tick(x.pos, n),
            given: args.pos.length + b.params.filter((p) => args.named.has(p)).length,
          };
          const bound = bindArgs(b, args.pos, args.named);
          // Built-ins that go through their arguments take a step per item
          this.tick(x.pos, argumentWork(name, bound, this.limits.maxListLength));
          let out: Value;
          try {
            out = b.run(bound, ctx);
          } catch (e) {
            if (e instanceof KerfError) throw e;
            const err = new KerfError(
              e instanceof RangeError ? `${name}(): the result is too large` : (e as Error).message,
              x.pos,
            );
            err.call = name;
            throw err;
          }
          this.checkValue(out, x.pos, name);
          return out;
        }
        throw new KerfError(
          `Unknown function ${name}()${sentence(didYouMean(name, [...env.names('fns'), ...env.names('vars'), ...Object.keys(FUNCTIONS), ...SPECIAL]))}`,
          x.pos,
        );
      }
      if (!isFn(v.value))
        throw new KerfError(`"${name}" is a ${typeName(v.value)}, not a function`, x.pos);
      return this.callFunction(v.value, this.evalArgs(x.args, env, x.pos), env, name);
    }
    const f = this.expr(x.callee, env);
    if (!isFn(f)) throw new KerfError(`Can't call a ${typeName(f)}`, x.pos);
    return this.callFunction(f, this.evalArgs(x.args, env, x.pos), env, 'function');
  }

  private specialFunction(
    name: string,
    x: Extract<Expr, { kind: 'call' }>,
    env: Env,
  ): { handled: boolean; value?: Value } {
    if (name === 'echo') {
      const a = this.evalArgs(x.args, env, x.pos);
      this.echo(this.echoText(a), x.pos);
      return { handled: true, value: undefined };
    }
    if (name === 'assert') {
      const a = this.evalArgs(x.args, env, x.pos);
      this.checkArgs(name, a);
      this.assert(a);
      return { handled: true, value: true };
    }
    if (name === 'text_width' || name === 'text_metrics') {
      const a = this.evalArgs(x.args, env, x.pos);
      this.checkArgs(name, a);
      const m = this.measure(a, env);
      if (name === 'text_width') return { handled: true, value: m.advance };
      return {
        handled: true,
        value: [m.advance, m.bounds as Value, m.ascent, m.descent],
      };
    }
    if (name === 'finger_count') {
      const a = this.evalArgs(x.args, env, x.pos);
      this.checkArgs(name, a);
      const L = this.num(this.arg(a, 'length', 0), 'finger_count', 'length');
      return { handled: true, value: fingerCount(L, this.fingerWidth(a, env, 1)) };
    }
    return { handled: false };
  }

  private assert(a: Args) {
    if (truthy(this.arg(a, 'condition', 0))) return;
    const m = this.arg(a, 'message', 1);
    throw new KerfError(`Assertion failed${m === undefined ? '' : ': ' + toText(m)}`, a.at);
  }

  private echo(text: string, at: Pos) {
    this.charge(Math.ceil(text.length / CHARS_PER_ITEM), at);
    this.echoes.push(text);
  }

  // Echo text stops at maxListLength characters, before it is all written out
  private echoText(a: Args): string {
    const max = this.limits.maxListLength;
    const parts: string[] = [];
    let n = 0;
    const add = (label: string, v: Value, quote: boolean) => {
      if (parts.length) n += 2;
      const r = write(v, max - n - label.length, quote);
      n += label.length + r.text.length;
      if (!r.whole)
        throw new KerfError(
          `echo(): the text would be longer than the limit of ${max} characters`,
          a.at,
        );
      parts.push(label + r.text);
    };
    for (const { name, value } of a.all)
      if (name === null) add('', value, false);
      else add(`${name} = `, value, true);
    return parts.join(', ');
  }

  private arith(op: string, a: Value, b: Value, at: Pos): Value {
    if (typeof a === 'number' && typeof b === 'number') {
      switch (op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return a / b;
        case '%':
          return a % b;
        case '^':
          return Math.pow(a, b);
      }
    }
    if (op === '+' && typeof a === 'string' && typeof b === 'string') {
      this.checkSize(a.length + b.length, true, at);
      return a + b;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (op === '+' || op === '-') {
        if (a.length !== b.length)
          throw new KerfError(
            `Can't ${op === '+' ? 'add' : 'subtract'} lists of length ${a.length} and ${b.length}`,
            at,
          );
        this.charge(a.length + LIST_COST, at);
        return a.map((x, i) => this.arith(op, x, b[i], at));
      }
      if (op === '*') {
        if (Array.isArray(a[0])) {
          this.charge(a.length + LIST_COST, at);
          return a.map((row) => this.arith('*', row, b, at));
        }
        // Each product in a sum must be a number
        const term = (x: Value, y: Value) => {
          const t = this.arith('*', x, y, at);
          if (typeof t !== 'number')
            throw new KerfError(
              "Can't multiply these lists: an item times an item is not a number",
              at,
            );
          return t;
        };
        if (Array.isArray(b[0])) {
          const cols = (b[0] as Value[]).length;
          if (a.length !== b.length || b.some((r) => !Array.isArray(r) || r.length !== cols))
            throw new KerfError(
              `Can't multiply a list of length ${a.length} by a matrix: it needs ${a.length} rows of the same length`,
              at,
            );
          this.checkSize(cols, false, at);
          this.tick(at, cols * a.length);
          return Array.from({ length: cols }, (_, j) =>
            a.reduce((s: number, x, i) => s + term(x, (b[i] as Value[])[j]), 0),
          );
        }
        if (a.length !== b.length)
          throw new KerfError(`Can't multiply lists of length ${a.length} and ${b.length}`, at);
        this.tick(at, a.length);
        return a.reduce((s: number, x, i) => s + term(x, b[i]), 0);
      }
    }
    if (Array.isArray(a) && typeof b === 'number' && (op === '*' || op === '/')) {
      this.charge(a.length + LIST_COST, at);
      return a.map((x) => this.arith(op, x, b, at));
    }
    if (typeof a === 'number' && Array.isArray(b) && op === '*') {
      this.charge(b.length + LIST_COST, at);
      return b.map((x) => this.arith(op, a, x, at));
    }
    const verb: Record<string, string> = {
      '+': 'add',
      '-': 'subtract',
      '*': 'multiply',
      '/': 'divide',
      '%': 'take remainder of',
      '^': 'raise',
    };
    throw new KerfError(`Can't ${verb[op] ?? op} ${typeName(a)} and ${typeName(b)}`, at);
  }

  private arg(a: Args, name: string, index: number, def?: Value): Value {
    if (a.named.has(name)) return a.named.get(name);
    if (index >= 0 && index < a.pos.length) return a.pos[index];
    return def;
  }

  private num(v: Value, fn: string, name: string): number {
    if (typeof v !== 'number' || !Number.isFinite(v))
      throw new Error(`${name} must be a finite number, got ${show(v)}`);
    return v;
  }

  private vec2(v: Value, name: string, scalarBoth = true): Pt {
    const ok = (x: Value) => typeof x === 'number' && Number.isFinite(x);
    if (ok(v) && scalarBoth) return [v as number, v as number];
    if (Array.isArray(v) && ok(v[0]) && (v[1] === undefined || ok(v[1])))
      return [v[0] as number, (v[1] as number | undefined) ?? 0];
    throw new Error(`${name} must be a number or [x, y], got ${show(v)}`);
  }

  private vec3(v: Value, name: string): Vec3 {
    const ok = (x: Value) => typeof x === 'number' && Number.isFinite(x);
    if (Array.isArray(v) && (v.length === 2 || v.length === 3) && v.every(ok))
      return [v[0] as number, v[1] as number, (v[2] as number | undefined) ?? 0];
    throw new Error(`${name} must be [x, y, z], got ${show(v)}`);
  }

  private placements(at: Value, turn: Value, qty: number): Placement[] {
    const list = (v: Value, name: string): Vec3[] => {
      if (v === undefined) return [[0, 0, 0]];
      if (Array.isArray(v) && v.length > 0 && Array.isArray(v[0]))
        return v.map((item, i) => this.vec3(item, `${name}[${i}]`));
      return [this.vec3(v, name)];
    };
    const ats = list(at, 'at');
    const turns = list(turn, 'rotate');
    for (const [items, name] of [
      [ats, 'at'],
      [turns, 'rotate'],
    ] as const)
      if (items.length !== 1 && items.length !== qty)
        throw new Error(
          `${name} needs one placement per copy: qty is ${qty} but ${name} has ${items.length}`,
        );
    return Array.from({ length: qty }, (_, i) => ({
      at: ats[ats.length === 1 ? 0 : i],
      rotate: turns[turns.length === 1 ? 0 : i],
    }));
  }

  private points(v: Value, name: string): Pt[] {
    if (!Array.isArray(v)) throw new Error(`${name} must be a list of [x, y] points`);
    return v.map((p, i) => {
      if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))
        throw new Error(`${name}[${i}] must be an [x, y] point, got ${show(p)}`);
      return [p[0] as number, p[1] as number];
    });
  }

  private dyn(env: Env, name: string): Value {
    return env.get(name).value;
  }

  private spend(points: number) {
    this.pointCount += points;
    if (!(this.pointCount <= this.limits.maxPoints))
      throw new Error(
        `the shapes need more than ${this.limits.maxPoints} points, the limit. Use fewer or simpler shapes.`,
      );
  }

  private checkValue(v: Value, pos: Pos | undefined, fn?: string) {
    if (Array.isArray(v) || typeof v === 'string')
      this.checkSize(v.length, typeof v === 'string', pos, fn);
  }

  private checkSize(n: number, isString: boolean, pos: Pos | undefined, fn?: string) {
    if (n > this.limits.maxListLength)
      throw new KerfError(
        `${fn ? `${fn}(): ` : ''}${isString ? `a string of ${n} characters` : `a list of ${n} items`} is more than the limit of ${this.limits.maxListLength}`,
        pos,
      );
    this.charge(isString ? Math.ceil(n / CHARS_PER_ITEM) : n + LIST_COST, pos);
  }

  private segs(env: Env) {
    const fn = toNumber(this.dyn(env, '$fn')) || 0;
    const fa = toNumber(this.dyn(env, '$fa')) || 2;
    const fs = toNumber(this.dyn(env, '$fs')) || 0.2;
    const max = this.limits.maxSegments;
    return (r: number) => {
      const n = fragments(r, fn, fa, fs);
      if (!(n <= max))
        throw new Error(
          `a circle with ${n} segments is more than the limit of ${max}. Lower $fn, or raise $fa or $fs.`,
        );
      return n;
    };
  }

  private thickness(env: Env): number {
    const t = this.dyn(env, '$thickness');
    if (typeof t !== 'number' || t <= 0) throw new Error('$thickness must be a positive number');
    return t;
  }

  private fingerWidth(a: Args, env: Env, index: number): number {
    const f = this.arg(a, 'finger', index);
    if (typeof f === 'number' && f > 0) return f;
    return Math.max(3 * this.thickness(env), 6);
  }

  private measure(a: Args, env: Env) {
    if (!this.opts.fonts)
      throw new KerfError(
        'text needs a font. Pass fonts to render(), or --font on the command line.',
        a.at,
      );
    const shown = write(this.arg(a, 'text', 0, ''), this.limits.maxTextLength);
    if (!shown.whole)
      throw new KerfError(
        `the text is more than ${this.limits.maxTextLength} characters, the limit for one text()`,
        a.at,
      );
    // Laying out text takes a step for each character
    this.tick(a.at, shown.text.length);
    try {
      return textMetrics(this.opts.fonts, shown.text, this.textOpts(a, env));
    } catch (e) {
      if (e instanceof KerfError) throw e;
      throw new KerfError((e as Error).message, a.at);
    }
  }

  private textOpts(a: Args, env: Env) {
    return {
      size: this.num(this.arg(a, 'size', 1, 10), 'text', 'size'),
      font: toText(this.arg(a, 'font', 2, this.dyn(env, '$font') ?? '')),
      halign: toText(this.arg(a, 'halign', -1, 'left')),
      valign: toText(this.arg(a, 'valign', -1, 'baseline')),
      spacing: toNumber(this.arg(a, 'spacing', -1, 1)),
    };
  }

  private edges(v: Value): Edge[] {
    const all = (e: Value): Edge => {
      if (e === 'out' || e === 'in' || e === 'flat') return e;
      throw new Error(`edges must be "out", "in" or "flat", got ${show(e)}`);
    };
    if (typeof v === 'string') return [all(v), all(v), all(v), all(v)];
    if (Array.isArray(v) && v.length === 4) return v.map(all);
    throw new Error('edges must be one value or a list of 4: [bottom, right, top, left]');
  }

  private makeBuiltins(): Record<string, (c: BuiltinCtx) => Shape> {
    const tr = (c: BuiltinCtx, m: Matrix) => transform(c.children(), m);
    const layerTag = (name: string) => (c: BuiltinCtx) => retag(c.children(), name);
    return {
      rect: (c) => {
        const [w, h] = this.vec2(this.arg(c.args, 'size', 0, 1), 'size');
        const r = toNumber(this.arg(c.args, 'r', -1, 0)) || 0;
        const center = truthy(this.arg(c.args, 'center', 1, false));
        const p = roundedRect(w, h, r, this.segs(c.env));
        return regionShape(union([center ? p.map(([x, y]): Pt => [x - w / 2, y - h / 2]) : p]));
      },
      square: (c) => this.builtins.rect(c),
      circle: (c) => {
        const d = this.arg(c.args, 'd', -1);
        const r =
          d !== undefined
            ? this.num(d, 'circle', 'd') / 2
            : this.num(this.arg(c.args, 'r', 0, 1), 'circle', 'r');
        return regionShape([ellipsePoly(r, r, this.segs(c.env)(r))]);
      },
      ellipse: (c) => {
        const [rx, ry] = this.vec2(this.arg(c.args, 'r', 0, 1), 'r');
        return regionShape([ellipsePoly(rx, ry, this.segs(c.env)(Math.max(rx, ry)))]);
      },
      regular_polygon: (c) => {
        const n = Math.max(
          3,
          Math.floor(this.num(this.arg(c.args, 'n', 0, 6), 'regular_polygon', 'n')),
        );
        const r = this.num(this.arg(c.args, 'r', 1, 10), 'regular_polygon', 'r');
        if (!(n <= this.limits.maxSegments))
          throw new Error(`${n} corners is more than the limit of ${this.limits.maxSegments}`);
        return regionShape([ellipsePoly(r, r, n)]);
      },
      star: (c) => {
        const n = Math.max(2, Math.floor(this.num(this.arg(c.args, 'n', 0, 5), 'star', 'n')));
        const r = this.num(this.arg(c.args, 'r', 1, 10), 'star', 'r');
        const ri = this.num(this.arg(c.args, 'inner', 2, r * 0.45), 'star', 'inner');
        if (!(n * 2 <= this.limits.maxSegments))
          throw new Error(`${n} points is more than the limit of ${this.limits.maxSegments / 2}`);
        const p: Poly = [];
        for (let i = 0; i < n * 2; i++) {
          const a = Math.PI / 2 + (Math.PI * i) / n;
          const rr = i % 2 ? ri : r;
          p.push([rr * Math.cos(a), rr * Math.sin(a)]);
        }
        return regionShape(union([p]));
      },
      polygon: (c) => {
        const pts = this.points(this.arg(c.args, 'points', 0), 'points');
        const paths = this.arg(c.args, 'paths', 1);
        const polys: Poly[] = Array.isArray(paths)
          ? paths.map((ix) =>
              (Array.isArray(ix) ? ix : []).map((i) => pts[toNumber(i)]).filter(Boolean),
            )
          : [pts];
        return regionShape(union(polys, 'evenodd'));
      },
      path: (c) => {
        const d = this.arg(c.args, 'd', 0);
        if (typeof d !== 'string')
          throw new Error('path() needs SVG path data, like path("M0 0 L10 0 L5 8 Z")');
        const flat = flatten(parseSvgPath(d), 0.01);
        const fill = this.arg(c.args, 'fill', -1, 'evenodd') === 'nonzero' ? 'nonzero' : 'evenodd';
        return merge([regionShape(union(flat.closed, fill)), lineShape(flat.open)]);
      },
      line: (c) => {
        const a = this.vec2(this.arg(c.args, 'from', 0, [0, 0]), 'from', false);
        const b = this.vec2(this.arg(c.args, 'to', 1, [10, 0]), 'to', false);
        return lineShape([[a, b]]);
      },
      polyline: (c) => {
        const pts = this.points(this.arg(c.args, 'points', 0), 'points');
        const closed = truthy(this.arg(c.args, 'closed', 1, false));
        return lineShape([closed && pts.length ? [...pts, pts[0]] : pts]);
      },
      arc: (c) => {
        const r = this.num(this.arg(c.args, 'r', 0, 10), 'arc', 'r');
        const a0 = this.num(this.arg(c.args, 'start', 1, 0), 'arc', 'start');
        const a1 = this.num(this.arg(c.args, 'end', 2, 90), 'arc', 'end');
        const n = Math.max(2, Math.ceil((this.segs(c.env)(r) * Math.abs(a1 - a0)) / 360));
        if (!(n <= this.limits.maxSegments))
          throw new Error(
            `an arc with ${n} segments is more than the limit of ${this.limits.maxSegments}`,
          );
        const p: Poly = [];
        for (let i = 0; i <= n; i++) {
          const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
          p.push([r * Math.cos(a), r * Math.sin(a)]);
        }
        return lineShape([p]);
      },
      text: (c) => {
        if (!this.opts.fonts)
          throw new Error(
            'text() needs a font. Pass fonts to render(), or --font on the command line.',
          );
        const text = this.arg(c.args, 'text', 0, '');
        const shown = write(text, this.limits.maxTextLength);
        if (!shown.whole)
          throw new Error(
            `the text is more than ${this.limits.maxTextLength} characters, the limit for one text()`,
          );
        this.tick(c.args.at, shown.text.length);
        return regionShape(textRegions(this.opts.fonts, shown.text, this.textOpts(c.args, c.env)));
      },
      translate: (c) => {
        const [x, y] = this.vec2(this.arg(c.args, 'v', 0, [0, 0]), 'v', false);
        return tr(c, [1, 0, 0, 1, x, y]);
      },
      rotate: (c) => {
        const a = this.arg(c.args, 'a', 0, 0);
        const deg = Array.isArray(a) ? toNumber(a[2] ?? 0) : this.num(a, 'rotate', 'a');
        const r = (deg * Math.PI) / 180;
        const cs = Math.cos(r),
          sn = Math.sin(r);
        const ctr = this.arg(c.args, 'center', -1);
        let m: Matrix = [cs, sn, -sn, cs, 0, 0];
        if (ctr !== undefined) {
          const [cx, cy] = this.vec2(ctr, 'center', false);
          m = [cs, sn, -sn, cs, cx - cs * cx + sn * cy, cy - sn * cx - cs * cy];
        }
        return tr(c, m);
      },
      scale: (c) => {
        const [sx, sy] = this.vec2(this.arg(c.args, 'v', 0, 1), 'v');
        return tr(c, [sx, 0, 0, sy, 0, 0]);
      },
      mirror: (c) => {
        const [x, y] = this.vec2(this.arg(c.args, 'v', 0, [1, 0]), 'v', false);
        const l = Math.hypot(x, y) || 1;
        const nx = x / l,
          ny = y / l;
        return tr(c, [1 - 2 * nx * nx, -2 * nx * ny, -2 * nx * ny, 1 - 2 * ny * ny, 0, 0]);
      },
      multmatrix: (c) => {
        const m = this.arg(c.args, 'm', 0);
        if (!Array.isArray(m) || m.length < 2) throw new Error('m must be a 2x3 or 3x3 matrix');
        const r0 = m[0] as number[],
          r1 = m[1] as number[];
        return tr(c, [r0[0], r1[0], r0[1], r1[1], r0[2] ?? 0, r1[2] ?? 0]);
      },
      union: (c) => c.children(),
      group: (c) => c.children(),
      difference: (c) => {
        const [first, ...rest] = c.childList();
        if (!first) return emptyShape();
        const cutter = flat(rest, 'difference');
        return mapLayers(first, (l) => ({
          regions: difference(l.regions, cutter.regions),
          lines: clipLines(l.lines, union(cutter.regions), 'outside'),
        }));
      },
      intersection: (c) => {
        const [first, ...rest] = c.childList();
        if (!first) return emptyShape();
        let out = first;
        for (const r of rest) {
          const keep = union(flat([r], 'intersection').regions);
          out = mapLayers(out, (l) => ({
            regions: intersection(l.regions, keep),
            lines: clipLines(l.lines, keep, 'inside'),
          }));
        }
        return out;
      },
      // One hull for the shapes outside parts, and one inside each part
      hull: (c) => {
        const s = c.children();
        const each = (layers: Map<string, Layer>) => {
          const pts: Pt[] = [];
          let key = 'cut';
          let first = true;
          for (const [k, l] of layers) {
            if (first && (l.regions.length || l.lines.length)) {
              key = k;
              first = false;
            }
            for (const p of [...l.regions, ...l.lines]) for (const q of p) pts.push(q);
          }
          const h = hull(pts);
          return new Map([[key, { regions: h.length >= 3 ? [h] : [], lines: [] }]]);
        };
        return {
          layers: each(s.layers),
          parts: s.parts.map((p) => ({ ...p, layers: each(p.layers) })),
        };
      },
      offset: (c) => {
        const r = this.arg(c.args, 'r', 0);
        const delta = this.arg(c.args, 'delta', -1);
        const chamfer = truthy(this.arg(c.args, 'chamfer', -1, false));
        const d =
          r !== undefined ? this.num(r, 'offset', 'r') : this.num(delta ?? 0, 'offset', 'delta');
        const join = r !== undefined ? 'round' : chamfer ? 'square' : 'miter';
        return mapLayers(c.children(), (l) => ({
          regions: offset(l.regions, d, join),
          lines: l.lines,
        }));
      },
      stroke: (c) => {
        const w = this.num(this.arg(c.args, 'width', 0, 1), 'stroke', 'width');
        return mapLayers(c.children(), (l) => ({
          regions: union([...l.regions, ...strokeLines(l.lines, w)]),
          lines: [],
        }));
      },
      outline: (c) =>
        mapLayers(c.children(), (l) => ({
          regions: [],
          lines: [...l.lines, ...union(l.regions).map((p) => [...p, p[0]])],
        })),
      cut: layerTag('cut'),
      score: layerTag('score'),
      engrave: layerTag('engrave'),
      guide: layerTag('guide'),
      layer: (c) => {
        const name = this.arg(c.args, 'name', 0);
        if (typeof name !== 'string' || !name) throw new Error('layer() needs a name');
        const mode = this.arg(c.args, 'mode', 1);
        const color = this.arg(c.args, 'color', 2);
        const known = this.layers.get(name);
        if (mode !== undefined || color !== undefined || !known) {
          const m = (mode ?? known?.mode ?? 'line') as LayerDef['mode'];
          if (!['cut', 'line', 'fill', 'guide'].includes(m))
            throw new Error('mode must be "cut", "line", "fill" or "guide"');
          const col = toText(color ?? known?.color ?? '#00aa00');
          if (!/^#[0-9a-fA-F]{6}$/.test(col)) throw new Error('color must look like "#00aa00"');
          this.layers.set(name, { name, mode: m, color: col });
        }
        return retag(c.children(), name);
      },
      part: (c) => {
        const name = toText(this.arg(c.args, 'name', 0, 'part'));
        const qty = Math.max(1, Math.floor(toNumber(this.arg(c.args, 'qty', 1, 1)) || 1));
        this.copies += qty;
        if (!(this.copies <= this.limits.maxParts))
          throw new Error(`more than ${this.limits.maxParts} part copies in total, the limit`);
        const at = this.arg(c.args, 'at', -1);
        const turn = this.arg(c.args, 'rotate', -1);
        const placements =
          at === undefined && turn === undefined ? undefined : this.placements(at, turn, qty);
        const s = c.children();
        return {
          layers: new Map(),
          parts: [
            ...s.parts,
            {
              name,
              qty,
              layers: s.layers,
              thickness: this.thickness(c.env),
              kerf: toNumber(this.dyn(c.env, '$kerf')) || 0,
              material: toText(this.dyn(c.env, '$material') ?? 'material'),
              ...(placements ? { placements } : {}),
            },
          ],
        };
      },
      material: (c) => {
        const t = this.arg(c.args, 'thickness', 0);
        const k = this.arg(c.args, 'kerf', 1);
        const n = this.arg(c.args, 'name', 2);
        if (t !== undefined) c.env.vars.set('$thickness', this.num(t, 'material', 'thickness'));
        if (k !== undefined) c.env.vars.set('$kerf', this.num(k, 'material', 'kerf'));
        if (n !== undefined) c.env.vars.set('$material', toText(n));
        return c.children();
      },
      children: (c) => {
        const ctx = c.env.childCtx();
        if (!ctx) return emptyShape();
        const kids = this.childStmts(ctx.stmts);
        const idx = this.arg(c.args, 'index', 0);
        const e = new Env(ctx.env, c.env);
        this.hoist(ctx.stmts, e);
        const want = new Set<Stmt>();
        if (idx === undefined) kids.forEach((k) => want.add(k));
        else
          for (const i of this.iterable(idx, c.args.at))
            if (kids[toNumber(i)]) want.add(kids[toNumber(i)]);
        const out: Shape[] = [];
        for (const st of ctx.stmts) {
          if (st.kind === 'assign') this.stmt(st, e);
          else if (want.has(st)) {
            const r = this.stmt(st, e);
            if (r) out.push(r);
          }
        }
        return merge(out);
      },
      echo: (c) => {
        this.echo(this.echoText(c.args), c.args.at);
        return c.children();
      },
      assert: (c) => {
        this.assert(c.args);
        return c.children();
      },
      finger_rect: (c) => {
        const [w, h] = this.vec2(this.arg(c.args, 'size', 0), 'size');
        const edges = this.edges(this.arg(c.args, 'edges', 1, 'out'));
        const t = this.thickness(c.env);
        const finger = this.fingerWidth(c.args, c.env, 2);
        this.spend(((2 * (Math.abs(w) + Math.abs(h))) / finger) * 4);
        return regionShape(fingerRect(w, h, edges, t, finger));
      },
      finger_holes: (c) => {
        const L = this.num(this.arg(c.args, 'length', 0), 'finger_holes', 'length');
        const e = this.edges(this.arg(c.args, 'edge', 1, 'out'))[0];
        if (e === 'flat') throw new Error('edge must be "out" or "in"');
        const finger = this.fingerWidth(c.args, c.env, 2);
        this.spend((Math.abs(L) / finger) * 4);
        return regionShape(fingerHoles(L, e, this.thickness(c.env), finger));
      },
      tslot: (c) => {
        const d = this.num(this.arg(c.args, 'd', 0, 3), 'tslot', 'd');
        const length = this.num(this.arg(c.args, 'length', 1, 12), 'tslot', 'length');
        const [nw, nh] = this.vec2(this.arg(c.args, 'nut', 2, [d * 1.85, d * 0.8]), 'nut', false);
        const at = this.num(this.arg(c.args, 'nut_at', 3, length / 2), 'tslot', 'nut_at');
        return regionShape(union(tslot(d, length, nw, nh, at)));
      },
      living_hinge: (c) => {
        const [w, h] = this.vec2(this.arg(c.args, 'size', 0), 'size');
        const spacing = this.num(this.arg(c.args, 'spacing', 1, 1.5), 'living_hinge', 'spacing');
        const bridge = this.num(this.arg(c.args, 'bridge', 2, 3), 'living_hinge', 'bridge');
        const cut = this.num(
          this.arg(c.args, 'cut', 3, Math.max(bridge * 2, (h - 3 * bridge) / 2)),
          'living_hinge',
          'cut',
        );
        if (spacing <= 0 || bridge <= 0 || cut <= 0)
          throw new Error('spacing, bridge and cut must be positive');
        this.spend((Math.abs(w) / spacing + 1) * (Math.abs(h) / (cut + bridge) + 2) * 2);
        return lineShape(livingHinge(w, h, spacing, bridge, cut));
      },
    };

    function flat(shapes: Shape[], fn: string): Layer {
      const out: Layer = { regions: [], lines: [] };
      for (const s of shapes) {
        if (s.parts.length) throw new Error(`part() can only be the first child of ${fn}()`);
        for (const l of s.layers.values()) for (const p of l.regions) out.regions.push(p);
      }
      return out;
    }
    // Applies an operation to every layer, inside parts too
    function mapLayers(s: Shape, f: (l: Layer) => Layer): Shape {
      const each = (from: Map<string, Layer>) => {
        const layers = new Map<string, Layer>();
        for (const [k, l] of from) layers.set(k, f(l));
        return layers;
      };
      return {
        layers: each(s.layers),
        parts: s.parts.map((p) => ({ ...p, layers: each(p.layers) })),
      };
    }
  }
}
