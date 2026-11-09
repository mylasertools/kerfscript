// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// What an editor asks about a program: its problems, what a name is, what
// can be typed at a place, and where each name is defined and used. The
// language server answers editors with it. Positions are offsets into the
// source in UTF-16 code units, as JavaScript strings and the Language
// Server Protocol count them.

import type { Arg, Assign, Expr, ListItem, Param, Stmt } from './ast.js';
import { parameters, type Parameter } from './customizer.js';
import { markLength } from './diagnostics.js';
import { besideFile } from './evaluator.js';
import { KerfError, tokenize, type Comment, type Pos, type Token } from './lexer.js';
import { parse } from './parser.js';
import { render, type RenderOptions } from './render.js';
import { SIGNATURES, formatSignature, signature, type Signature } from './signatures.js';
import { LIBRARIES } from './stdlib.js';

export type NameKind = 'variable' | 'function' | 'module' | 'parameter';

export interface Definition {
  name: string;
  kind: NameKind;
  // Where the name is
  start: number;
  end: number;
  // The whole definition, for outlines
  range: [number, number];
  // The library it is in, as use <path> names it; none for the program
  file?: string;
  // A variable's value or a parameter's default, as source
  value?: string;
  // The comment above it
  doc?: string;
  // A module's or function's parameters
  params?: Definition[];
  // The module or function a parameter belongs to
  owner?: Definition;
}

export interface Reference {
  name: string;
  start: number;
  end: number;
  // What it names, when that is known
  def?: Definition;
  builtin?: Signature;
  // For a named argument of a built-in: the parameter
  arg?: string;
}

export interface Scope {
  start: number;
  end: number;
  parent?: Scope;
  vars: Map<string, Definition[]>;
  fns: Map<string, Definition[]>;
  mods: Map<string, Definition[]>;
}

// A use or include statement, at its path
export interface LibraryLink {
  path: string;
  include: boolean;
  start: number;
  end: number;
  found: boolean;
}

export interface Analysis {
  source: string;
  // Whether the program parsed as it is. When not, the lines with errors
  // were left out and the rest was read.
  parsed: boolean;
  // The program's own definitions; a library's are reached through
  // references
  definitions: Definition[];
  references: Reference[];
  scopes: Scope[];
  libraries: LibraryLink[];
  // Libraries that `use <...>` can name besides the standard library
  available: string[];
  settings: Parameter[];
}

export interface AnalyzeOptions {
  // Library sources by path, as render()'s resolve option. The standard
  // library is found without it.
  resolve?: (path: string) => string | undefined;
  // Library paths to offer after `use <`, besides the standard library
  libraries?: string[];
}

type Ns = 'vars' | 'fns' | 'mods';

interface Exports {
  mods: Definition[];
  fns: Definition[];
  vars: Definition[];
}

// Where a definition was made, to find the others of the same name
const HOME = new WeakMap<Definition, { scope: Scope; ns: Ns }>();
// Definitions an outline shows: modules, functions and assignments
const OUTLINED = new WeakSet<Definition>();

const RESERVED = new Set([
  'module',
  'function',
  'if',
  'else',
  'for',
  'let',
  'each',
  'use',
  'include',
  'true',
  'false',
  'undef',
]);

// The special variables and constants every program has
const SPECIAL: Record<string, { value?: string; doc: string }> = {
  $thickness: { value: '3', doc: 'Material thickness, used by joinery and stored on parts' },
  $kerf: { value: '0', doc: 'Beam width; cut outlines are offset by half of it' },
  $material: {
    value: '"material"',
    doc: 'Material name; parts are packed per material and thickness',
  },
  $sheet: { value: '[600, 400]', doc: 'Sheet size for packing' },
  $gap: { value: '3', doc: 'Space between packed parts and around the sheet edge' },
  $layout: {
    value: '"pack"',
    doc: '`"pack"` packs parts onto sheets, `"none"` keeps your placement',
  },
  $fn: { value: '0', doc: 'Segments in a full circle; 0 uses `$fa` and `$fs`' },
  $fa: { value: '2', doc: 'Largest angle of a curve segment, in degrees' },
  $fs: { value: '0.2', doc: 'Largest length of a curve segment, in mm' },
  $font: { doc: 'Default font name for `text()`' },
  $children: { doc: 'How many child statements the module was called with' },
  $scale: { value: '1', doc: "The model's scale: `140cm` is 1400 mm divided by `$scale`" },
  $nest: { value: 'false', doc: 'Pack small parts into the holes of bigger ones' },
  $registration: { value: 'false', doc: 'Print-and-cut marks in three corners of every sheet' },
  $label_parts: {
    value: 'false',
    doc: "Engrave each part's number on its back face, the same number as in the parts list and the steps",
  },
  $min_width: {
    value: '1.5',
    doc: "Warn where a part's material is narrower than this; `0` turns it off",
  },
  $mirrored: { doc: 'True inside a mirrored part and on the back face, so `text()` reads right' },
  $bounds: { doc: 'Set by `measure()` for the children after the one it measures' },
  $area: {
    doc: 'Set by `measure()`: the area of material the measured child cuts, holes taken out, in square millimetres',
  },
  $centroid: {
    doc: "Set by `measure()`: the measured child's balance point `[x, y]`, the centroid of its material",
  },
  PI: { value: '3.141592653589793', doc: 'π, half a turn in radians' },
};
const CONSTANTS = ['true', 'false', 'undef'];

const REFERENCE = 'https://kerfscript.mylasertools.com/docs/reference/';
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const own = <T>(o: Record<string, T>, k: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;

// Long values are cut for hovers and completion
function clip(text: string): string {
  const lines = text.split('\n');
  let out = lines.slice(0, 8).join('\n');
  if (out.length > 400) out = out.slice(0, 400);
  return out.length < text.length ? out + ' …' : out;
}

class Walker {
  definitions: Definition[] = [];
  references: Reference[] = [];
  scopes: Scope[] = [];
  libraries: LibraryLink[] = [];
  private seq = 0;
  private order = new Map<Definition, number>();
  private pending: {
    ref: Reference;
    scope: Scope;
    ns: Ns[];
    builtin?: 'module' | 'function';
    callee?: Reference;
    seq: number;
  }[] = [];
  private stmtDefs = new Map<Stmt, Definition>();
  private tokenAt = new Map<number, number>();

  constructor(
    private src: string,
    private tokens: Token[],
    private comments: Comment[],
    private file: string | undefined,
    private load: (path: string) => Exports | undefined,
  ) {
    tokens.forEach((t, i) => this.tokenAt.set(t.pos.offset, i));
  }

  run(body: Stmt[]): Scope {
    const top = this.scope(undefined, 0, this.src.length);
    this.block(body, top);
    for (const p of this.pending) this.resolve(p);
    return top;
  }

  private scope(parent: Scope | undefined, start: number, end: number): Scope {
    const s: Scope = { start, end, parent, vars: new Map(), fns: new Map(), mods: new Map() };
    this.scopes.push(s);
    return s;
  }

  private define(scope: Scope, ns: Ns, def: Definition) {
    const list = scope[ns].get(def.name);
    if (list) list.push(def);
    else scope[ns].set(def.name, [def]);
    this.order.set(def, this.seq++);
    if (def.file === this.file) {
      this.definitions.push(def);
      HOME.set(def, { scope, ns });
    }
  }

  private def(kind: NameKind, name: string, pos: Pos, range: [number, number]): Definition {
    return {
      name,
      kind,
      start: pos.offset,
      end: pos.offset + name.length,
      range,
      ...(this.file !== undefined && { file: this.file }),
    };
  }

  private ref(
    name: string,
    pos: Pos,
    scope: Scope,
    ns: Ns[],
    builtin?: 'module' | 'function',
    callee?: Reference,
  ): Reference {
    const ref: Reference = { name, start: pos.offset, end: pos.offset + name.length };
    this.references.push(ref);
    this.pending.push({ ref, scope, ns, builtin, callee, seq: this.seq++ });
    return ref;
  }

  // A variable is the one assigned last before the reference, in the
  // nearest scope that has one; a module or function is visible in its
  // whole block. A variable assigned only later is still found, as code in
  // a module or function body sees it when called after the assignment.
  private find(scope: Scope, ns: Ns, name: string, seq: number): Definition | undefined {
    for (let s: Scope | undefined = scope; s; s = s.parent) {
      const list = s[ns].get(name);
      if (!list) continue;
      if (ns !== 'vars') return list[list.length - 1];
      const before = list.filter((d) => this.order.get(d)! < seq);
      if (before.length) return before[before.length - 1];
    }
    if (ns !== 'vars') return undefined;
    for (let s: Scope | undefined = scope; s; s = s.parent) {
      const list = s.vars.get(name);
      if (list) return list[list.length - 1];
    }
  }

  private resolve(p: Walker['pending'][number]) {
    const { ref } = p;
    if (p.callee) {
      const params = p.callee.def?.params;
      const sig = p.callee.builtin;
      const param = params?.find((d) => d.name === ref.name);
      if (param) ref.def = param;
      else if (sig?.params.some((x) => x.name === ref.name)) {
        ref.builtin = sig;
        ref.arg = ref.name;
      }
      return;
    }
    for (const ns of p.ns) {
      const d = this.find(p.scope, ns, ref.name, p.seq);
      if (d) {
        ref.def = d;
        return;
      }
    }
    const sig = p.builtin && signature(ref.name);
    if (sig && (sig.kind === p.builtin || sig.kind === 'both')) ref.builtin = sig;
  }

  // The comments on the lines just above a line, as a definition's doc
  private docAbove(line: number): string | undefined {
    const out: string[] = [];
    let want = line - 1;
    for (let k = this.comments.length - 1; k >= 0; k--) {
      const c = this.comments[k];
      if (c.line > want) continue;
      const last = c.line + (this.src.slice(c.start, c.end).match(/\n/g)?.length ?? 0);
      if (!c.own || last !== want || /^\[[^\]]*\]$/.test(c.text)) break;
      out.unshift(c.block ? c.text.replace(/^[ \t]*\* ?/gm, '') : c.text);
      want = c.line - 1;
    }
    return out.length ? out.join('\n') : undefined;
  }

  // The source after `name =`, up to the end of the value
  private valueAfter(offset: number): string | undefined {
    const i = this.tokenAt.get(offset);
    if (i === undefined || this.tokens[i + 1]?.value !== '=') return undefined;
    let depth = 0;
    let j = i + 2;
    for (; j < this.tokens.length; j++) {
      const t = this.tokens[j];
      if (t.type === 'eof') break;
      if (t.type !== 'punct') continue;
      if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
      else if (t.value === ')' || t.value === ']' || t.value === '}') {
        if (!depth) break;
        depth--;
      } else if ((t.value === ',' || t.value === ';') && !depth) break;
    }
    if (j === i + 2) return undefined;
    return clip(this.src.slice(this.tokens[i + 2].pos.offset, this.tokens[j - 1].end));
  }

  private end(s: { pos: Pos; end?: number }) {
    return s.end ?? s.pos.offset;
  }

  private block(stmts: Stmt[], scope: Scope) {
    for (const s of stmts) {
      if (s.kind === 'module' || s.kind === 'function') {
        const d = this.def(s.kind, s.name, s.namePos ?? s.pos, [s.pos.offset, this.end(s)]);
        const doc = this.docAbove(s.pos.line);
        if (doc) d.doc = doc;
        OUTLINED.add(d);
        this.stmtDefs.set(s, d);
        this.define(scope, s.kind === 'module' ? 'mods' : 'fns', d);
      } else if (s.kind === 'use' && !s.include) this.library(s, scope);
    }
    for (const s of stmts) this.stmt(s, scope);
  }

  private inner(scope: Scope, s: { pos: Pos; end?: number }) {
    return this.scope(scope, s.pos.offset, this.end(s));
  }

  private stmt(s: Stmt, scope: Scope) {
    switch (s.kind) {
      case 'assign': {
        this.expr(s.value, scope);
        const d = this.def('variable', s.name, s.pos, [s.pos.offset, this.end(s)]);
        d.value = clip(this.src.slice(s.span[0], s.span[1]));
        const doc = this.docAbove(s.pos.line);
        if (doc) d.doc = doc;
        OUTLINED.add(d);
        this.define(scope, 'vars', d);
        return;
      }
      case 'module': {
        const inner = this.inner(scope, s);
        const d = this.stmtDefs.get(s)!;
        d.params = this.params(s.params, inner, d);
        this.block(s.body, inner);
        return;
      }
      case 'function': {
        const inner = this.inner(scope, s);
        const d = this.stmtDefs.get(s)!;
        d.params = this.params(s.params, inner, d);
        this.expr(s.body, inner);
        return;
      }
      case 'use':
        if (s.include) this.library(s, scope);
        return;
      case 'call': {
        const callee = this.ref(s.name, s.pos, scope, ['mods'], 'module');
        this.args(s.args, scope, callee);
        if (s.children.length) this.block(s.children, this.inner(scope, s));
        return;
      }
      case 'for':
      case 'let': {
        const inner = this.inner(scope, s);
        this.assigns(s.assigns, inner);
        this.block(s.body, inner);
        return;
      }
      case 'if':
        this.expr(s.cond, scope);
        this.block(s.then, this.inner(scope, s));
        this.block(s.else, this.inner(scope, s));
        return;
      case 'block':
        this.block(s.body, this.inner(scope, s));
        return;
    }
  }

  private library(s: Extract<Stmt, { kind: 'use' }>, scope: Scope) {
    const i = this.tokenAt.get(s.pos.offset);
    const path = i === undefined ? undefined : this.tokens[i + 1];
    const exports = this.load(s.path);
    if (path?.type === 'str')
      this.libraries.push({
        path: s.path,
        include: s.include,
        start: path.pos.offset,
        end: path.end,
        found: !!exports,
      });
    if (!exports) return;
    for (const d of exports.mods) this.define(scope, 'mods', d);
    for (const d of exports.fns) this.define(scope, 'fns', d);
    if (s.include) for (const d of exports.vars) this.define(scope, 'vars', d);
  }

  private params(list: Param[], scope: Scope, owner?: Definition): Definition[] {
    const defs = list.map((p) => {
      const at = p.pos ?? { line: 0, col: 0, offset: owner?.range[0] ?? 0 };
      const d = this.def('parameter', p.name, at, [at.offset, at.offset + p.name.length]);
      if (p.default && p.pos) {
        const value = this.valueAfter(p.pos.offset);
        if (value !== undefined) d.value = value;
      }
      if (owner) d.owner = owner;
      this.define(scope, 'vars', d);
      return d;
    });
    for (const p of list) if (p.default) this.expr(p.default, scope);
    return defs;
  }

  private assigns(list: Assign[], scope: Scope) {
    for (const a of list) {
      this.expr(a.value, scope);
      const d = this.def('variable', a.name, a.pos, [a.pos.offset, a.pos.offset + a.name.length]);
      const value = this.valueAfter(a.pos.offset);
      if (value !== undefined) d.value = value;
      this.define(scope, 'vars', d);
    }
  }

  private args(list: Arg[], scope: Scope, callee?: Reference) {
    for (const a of list) {
      if (a.name && a.pos) this.ref(a.name, a.pos, scope, [], undefined, callee);
      this.expr(a.value, scope);
    }
  }

  private expr(e: Expr, scope: Scope): void {
    switch (e.kind) {
      case 'var':
        this.ref(e.name, e.pos, scope, ['vars']);
        return;
      case 'list':
        for (const it of e.items) this.item(it, scope);
        return;
      case 'range':
        this.expr(e.start, scope);
        if (e.step) this.expr(e.step, scope);
        this.expr(e.end, scope);
        return;
      case 'unary':
        this.expr(e.arg, scope);
        return;
      case 'binary':
        this.expr(e.left, scope);
        this.expr(e.right, scope);
        return;
      case 'ternary':
        this.expr(e.cond, scope);
        this.expr(e.then, scope);
        this.expr(e.else, scope);
        return;
      case 'index':
        this.expr(e.target, scope);
        this.expr(e.index, scope);
        return;
      case 'member':
        this.expr(e.target, scope);
        return;
      case 'record':
        for (const f of e.fields) this.expr(f.value, scope);
        return;
      case 'call': {
        let callee: Reference | undefined;
        if (e.callee.kind === 'var')
          callee = this.ref(e.callee.name, e.callee.pos, scope, ['vars', 'fns'], 'function');
        else this.expr(e.callee, scope);
        this.args(e.args, scope, callee);
        return;
      }
      case 'lambda': {
        const inner = this.inner(scope, e);
        this.params(e.params, inner);
        this.expr(e.body, inner);
        return;
      }
      case 'let': {
        const inner = this.inner(scope, e);
        this.assigns(e.assigns, inner);
        this.expr(e.body, inner);
        return;
      }
      case 'chain':
        this.expr(e.check, scope);
        this.expr(e.body, scope);
        return;
    }
  }

  private item(it: ListItem, scope: Scope): void {
    switch (it.kind) {
      case 'item':
      case 'each':
        this.expr(it.expr, scope);
        return;
      case 'if':
        this.expr(it.cond, scope);
        this.item(it.then, scope);
        if (it.else) this.item(it.else, scope);
        return;
      case 'for':
      case 'let': {
        const inner = it.pos ? this.scope(scope, it.pos.offset, it.end ?? it.pos.offset) : scope;
        this.assigns(it.assigns, inner);
        this.item(it.body, inner);
        return;
      }
    }
  }
}

// A program as far as it parses: lines with errors are blanked, and
// brackets left open at the end are closed, until the rest parses
function readable(
  source: string,
):
  | { text: string; tokens: Token[]; comments: Comment[]; body: Stmt[]; parsed: boolean }
  | undefined {
  let text = source;
  let closed = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const { tokens, comments } = tokenize(text);
      const { program } = parse(text);
      return { text, tokens, comments, body: program.body, parsed: attempt === 0 };
    } catch (e) {
      if (!(e instanceof KerfError) || e.line === undefined) return undefined;
      if (e.reason === 'Unclosed block comment') {
        text += '*/';
        continue;
      }
      const atEnd = /found end of file$/.test(e.reason);
      if (closed && (atEnd || e.line > lineCount(source))) {
        // Closing did not help: leave out the last line with code instead
        text = text.slice(0, source.length);
        closed = false;
        const last = text.trimEnd().split('\n').length;
        text = blank(text, last);
        continue;
      }
      if (atEnd) {
        const closers = unclosed(text);
        if (closers) {
          text += '\n' + closers + ';';
          closed = true;
          continue;
        }
      }
      const next = blank(text, Math.min(e.line, lineCount(text)));
      if (next === text) return undefined;
      text = next;
    }
  }
}

const lineCount = (text: string) => text.split('\n').length;

function blank(text: string, line: number): string {
  let start = 0;
  for (let l = 1; l < line; l++) start = text.indexOf('\n', start) + 1;
  let end = text.indexOf('\n', start);
  if (end < 0) end = text.length;
  return text.slice(0, start) + text.slice(start, end).replace(/\S/g, ' ') + text.slice(end);
}

// The brackets to close, innermost first; a block gets a ; before its }
function unclosed(text: string): string {
  let tokens: Token[];
  try {
    tokens = tokenize(text).tokens;
  } catch {
    return '';
  }
  const open: string[] = [];
  for (const t of tokens) {
    if (t.type !== 'punct') continue;
    if (t.value === '(' || t.value === '[' || t.value === '{') open.push(t.value);
    else if (t.value === ')' || t.value === ']' || t.value === '}') open.pop();
  }
  return open
    .reverse()
    .map((b) => (b === '(' ? ')' : b === '[' ? ']' : ';}'))
    .join('');
}

// Standard library exports never change, so they are read once
const STDLIB_EXPORTS = new Map<string, Exports>();

function loader(resolve: AnalyzeOptions['resolve'], loading: string[]) {
  return (asked: string): Exports | undefined => {
    // As render() does: next to the library that asks first
    const near = besideFile(loading[loading.length - 1], asked);
    const nearSrc =
      near !== undefined && own(LIBRARIES, asked) === undefined ? resolve?.(near) : undefined;
    const path = typeof nearSrc === 'string' ? near! : asked;
    if (loading.includes(path)) return undefined;
    const std = own(LIBRARIES, path);
    const src = std ?? (typeof nearSrc === 'string' ? nearSrc : resolve?.(path));
    if (typeof src !== 'string') return undefined;
    const hit = std !== undefined ? STDLIB_EXPORTS.get(path) : undefined;
    if (hit) return hit;
    const read = readable(src);
    const exports: Exports = { mods: [], fns: [], vars: [] };
    if (read) {
      const w = new Walker(
        read.text,
        read.tokens,
        read.comments,
        path,
        loader(resolve, [...loading, path]),
      );
      const top = w.run(read.body);
      const last = (m: Map<string, Definition[]>) => [...m.values()].map((l) => l[l.length - 1]);
      exports.mods = last(top.mods);
      exports.fns = last(top.fns);
      exports.vars = last(top.vars);
    }
    if (std !== undefined) STDLIB_EXPORTS.set(path, exports);
    return exports;
  };
}

/** Reads a program for an editor: its names, scopes and libraries. Works on
 * programs that do not parse, leaving out the lines with errors. */
export function analyze(source: string, options: AnalyzeOptions = {}): Analysis {
  const read = readable(source);
  const available = [...Object.keys(LIBRARIES), ...(options.libraries ?? [])];
  if (!read) {
    const top: Scope = {
      start: 0,
      end: source.length,
      vars: new Map(),
      fns: new Map(),
      mods: new Map(),
    };
    return {
      source,
      parsed: false,
      definitions: [],
      references: [],
      scopes: [top],
      libraries: [],
      available,
      settings: [],
    };
  }
  const w = new Walker(
    read.text,
    read.tokens,
    read.comments,
    undefined,
    loader(options.resolve, []),
  );
  w.run(read.body);
  let settings: Parameter[] = [];
  if (read.parsed) {
    try {
      settings = parameters(source).parameters;
    } catch {
      // Settings are extra information for hovers
    }
  }
  return {
    source,
    parsed: read.parsed,
    definitions: w.definitions,
    references: w.references,
    scopes: w.scopes,
    libraries: w.libraries,
    available,
    settings,
  };
}

// The definition or reference at an offset, the one starting there first
function at(a: Analysis, offset: number): Definition | Reference | undefined {
  const hits = [...a.references, ...a.definitions].filter(
    (x) => x.start <= offset && offset <= x.end,
  );
  return hits.find((x) => offset < x.end) ?? hits[0];
}

const isDefinition = (x: Definition | Reference): x is Definition => 'kind' in x;

/** The definition of the name at an offset: in the program, or in a
 * library when it has `file`. */
export function definition(a: Analysis, offset: number): Definition | undefined {
  const x = at(a, offset);
  if (!x) return undefined;
  return isDefinition(x) ? x : x.def;
}

/** Every place in the program a name is defined and used, for the name at
 * an offset. Assignments to the same variable in the same scope count as
 * one name. */
export function references(
  a: Analysis,
  offset: number,
  includeDefinitions = true,
): { start: number; end: number; definition: boolean }[] {
  const target = definition(a, offset);
  if (!target) return [];
  const home = HOME.get(target);
  const group = new Set(home ? home.scope[home.ns].get(target.name) : [target]);
  const out: { start: number; end: number; definition: boolean }[] = [];
  if (includeDefinitions)
    for (const d of group)
      if (d.file === undefined && a.definitions.includes(d))
        out.push({ start: d.start, end: d.end, definition: true });
  for (const r of a.references)
    if (r.def && group.has(r.def)) out.push({ start: r.start, end: r.end, definition: false });
  return out.sort((x, y) => x.start - y.start);
}

/** Where the name at an offset can be renamed, or why it cannot. */
export function renameTarget(
  a: Analysis,
  offset: number,
): { start: number; end: number; name: string } | { error: string } {
  const x = at(a, offset);
  const target = x && (isDefinition(x) ? x : x.def);
  if (!x || !target) {
    if (x && !isDefinition(x) && x.builtin) return { error: `${x.name} is built in` };
    return { error: 'There is no name here that the program defines' };
  }
  if (target.file !== undefined) return { error: `${target.name} is defined in <${target.file}>` };
  return { start: x.start, end: x.end, name: x.name };
}

/** The edits that rename the name at an offset, or why it cannot be. */
export function rename(
  a: Analysis,
  offset: number,
  name: string,
): { start: number; end: number }[] | { error: string } {
  const target = renameTarget(a, offset);
  if ('error' in target) return target;
  if (!/^\$?[A-Za-z_][A-Za-z0-9_]*$/.test(name) || RESERVED.has(name))
    return { error: `"${name}" is not a name` };
  if (name.startsWith('$') !== target.name.startsWith('$'))
    return {
      error: 'Names with $ are special variables, seen by every module called, so $ stays or goes',
    };
  return references(a, offset).map(({ start, end }) => ({ start, end }));
}

// How a module or function reads where it is defined
function header(d: Definition): string {
  const params = (d.params ?? []).map((p) => (p.value ? `${p.name} = ${p.value}` : p.name));
  return `${d.kind} ${d.name}(${params.join(', ')})`;
}

const code = (text: string) => '```kerfscript\n' + text + '\n```';

function settingText(s: Parameter): string {
  const parts = ['Setting'];
  if (s.group) parts[0] += ` in **${s.group}**`;
  if (s.options) parts.push(s.options.map((o) => `\`${o.name}\``).join(', '));
  else if (s.min !== undefined && s.max !== undefined)
    parts.push(`${s.min} to ${s.max}${s.step !== undefined ? `, in steps of ${s.step}` : ''}`);
  return parts.join(': ');
}

function describe(a: Analysis, d: Definition): string {
  const parts: string[] = [];
  if (d.kind === 'module' || d.kind === 'function') parts.push(code(header(d)));
  else parts.push(code(d.value !== undefined ? `${d.name} = ${d.value}` : d.name));
  if (d.kind === 'parameter')
    parts.push(
      d.owner ? `Parameter of ${d.owner.kind} \`${d.owner.name}()\`` : 'Parameter of a function',
    );
  if (d.doc) parts.push(d.doc);
  const setting =
    d.file === undefined && a.settings.find((s) => s.name === d.name && s.span[0] >= d.start);
  if (setting && d.kind === 'variable') parts.push(settingText(setting));
  if (d.file !== undefined) parts.push(`From \`<${d.file}>\``);
  return parts.join('\n\n');
}

function describeBuiltin(sig: Signature, arg?: string): string {
  const link = `[Reference](${REFERENCE}#${slug(sig.section)})`;
  if (arg) {
    const p = sig.params.find((x) => x.name === arg)!;
    return [
      code(p.default !== undefined ? `${p.name} = ${p.default}` : p.name),
      `Parameter of \`${sig.name}()\`${p.doc ? `: ${p.doc}` : ''}`,
    ].join('\n\n');
  }
  const forms = [formatSignature(sig), ...(sig.forms ?? [])];
  const params = sig.params
    .filter((p) => p.doc)
    .map((p) => `- \`${p.name}\`: ${p.doc}${p.named ? ' (by name only)' : ''}`);
  return [code(forms.join('\n')), sig.doc, params.join('\n'), link].filter(Boolean).join('\n\n');
}

// A library's description: the comment lines it starts with
function libraryDoc(src: string): string {
  const lines: string[] = [];
  for (const line of src.split('\n')) {
    const m = /^\s*\/\/\s?(.*)$/.exec(line);
    if (!m) break;
    if (!/copyright|spdx/i.test(m[1])) lines.push(m[1]);
  }
  return lines.join('\n').trim();
}

export interface Hover {
  start: number;
  end: number;
  // Markdown
  text: string;
}

/** What the name or library path at an offset is, as Markdown. */
export function hover(
  a: Analysis,
  offset: number,
  options: Pick<AnalyzeOptions, 'resolve'> = {},
): Hover | undefined {
  const lib = a.libraries.find((l) => l.start <= offset && offset <= l.end);
  if (lib) {
    const src = own(LIBRARIES, lib.path) ?? options.resolve?.(lib.path);
    const what = own(LIBRARIES, lib.path) ? 'Standard library' : 'Library';
    const text = src === undefined ? `Library <${lib.path}> not found` : libraryDoc(src) || what;
    return { start: lib.start, end: lib.end, text };
  }
  const x = at(a, offset);
  if (!x) return undefined;
  const range = { start: x.start, end: x.end };
  if (isDefinition(x)) return { ...range, text: describe(a, x) };
  if (x.def) return { ...range, text: describe(a, x.def) };
  if (x.builtin) return { ...range, text: describeBuiltin(x.builtin, x.arg) };
  const special = own(SPECIAL, x.name);
  if (special)
    return {
      ...range,
      text: [
        code(special.value !== undefined ? `${x.name} = ${special.value}` : x.name),
        special.doc,
      ].join('\n\n'),
    };
  return undefined;
}

// What surrounds an offset, read from the tokens before it
interface Open {
  token: Token;
  index: number;
  // The name called, for a call's arguments
  callee?: Token;
  // A for, if or let header
  header?: boolean;
  // A module's or function's parameter list
  params?: boolean;
  commas: number[];
}

function surroundings(src: string, offset: number) {
  const word = /[A-Za-z0-9_$]*$/.exec(src.slice(0, offset))![0];
  const from = offset - word.length;
  let tokens: Token[];
  try {
    tokens = tokenize(src.slice(0, from)).tokens.slice(0, -1);
  } catch {
    return undefined; // in a string or a comment
  }
  const lastEnd = tokens.length ? tokens[tokens.length - 1].end : 0;
  if (/\/\/[^\n]*$/.test(src.slice(lastEnd, from))) return undefined;
  const stack: Open[] = [];
  let stmtStart = 0;
  tokens.forEach((t, i) => {
    if (t.type !== 'punct') return;
    const top = stack[stack.length - 1];
    if (t.value === '(' || t.value === '[' || t.value === '{') {
      const o: Open = { token: t, index: i, commas: [] };
      const p = tokens[i - 1];
      if (t.value === '(' && p?.type === 'id') {
        const before = tokens[i - 2];
        if (p.value === 'for' || p.value === 'if' || p.value === 'let') o.header = true;
        else if (p.value === 'function') o.params = true;
        else if (!RESERVED.has(p.value)) {
          o.callee = p;
          if (before?.type === 'id' && (before.value === 'module' || before.value === 'function'))
            o.params = true;
        }
      }
      stack.push(o);
      if (t.value === '{') stmtStart = i + 1;
    } else if (t.value === ')' || t.value === ']' || t.value === '}') {
      stack.pop();
      if (t.value === '}') stmtStart = i + 1;
    } else if (t.value === ',' && top) top.commas.push(i);
    else if (t.value === ';' && (!top || top.token.value === '{')) stmtStart = i + 1;
  });
  return { word, from, tokens, stack, stmtStart, prev: tokens[tokens.length - 1] };
}

// The module or function a call's name refers to
function callee(a: Analysis, token: Token) {
  const ref = a.references.find((r) => r.start === token.pos.offset);
  if (ref?.def?.params) return { def: ref.def };
  if (ref?.builtin) return { sig: ref.builtin };
  const sig = signature(token.value);
  return sig ? { sig } : undefined;
}

// The scopes around an offset, innermost first
function scopesAt(a: Analysis, offset: number): Scope[] {
  const inner = a.scopes
    .filter((s) => s.start <= offset && offset <= s.end)
    .sort((x, y) => x.end - x.start - (y.end - y.start))[0];
  const out: Scope[] = [];
  for (let s: Scope | undefined = inner ?? a.scopes[0]; s; s = s.parent) out.push(s);
  return out;
}

export type CompletionKind =
  | 'module'
  | 'function'
  | 'variable'
  | 'parameter'
  | 'argument'
  | 'keyword'
  | 'constant'
  | 'library'
  | 'property';

export interface Completion {
  label: string;
  kind: CompletionKind;
  // A short description, such as the signature
  detail?: string;
  // Markdown
  doc?: string;
  // What to insert, when it is not the label
  insert?: string;
  // Sorts before the others, as named arguments of the call being typed
  first?: boolean;
  // Built into the language, so sorted after the program's own names
  builtin?: boolean;
}

/** What can be typed at an offset. The items replace the source from
 * `from` to `to`. */
export function complete(
  a: Analysis,
  offset: number,
): { from: number; to: number; items: Completion[] } {
  const src = a.source;
  const line = src.slice(src.lastIndexOf('\n', offset - 1) + 1, offset);
  const lib = /\b(?:use|include)\s*<([A-Za-z0-9_./-]*)$/.exec(line);
  if (lib) {
    const items = [...new Set(a.available)].map(
      (path): Completion => ({
        label: path,
        kind: 'library',
        ...(own(LIBRARIES, path) !== undefined && {
          detail: 'Standard library',
          doc: libraryDoc(LIBRARIES[path]),
        }),
      }),
    );
    return { from: offset - lib[1].length, to: offset, items };
  }
  const none = { from: offset, to: offset, items: [] };
  const around = surroundings(src, offset);
  if (!around || /^\d/.test(around.word)) return none;
  const { tokens, stack, stmtStart, prev, from } = around;
  const result = (items: Completion[]) => ({ from, to: offset, items });
  if (prev?.type === 'punct' && prev.value === '.')
    return result(
      ['x', 'y', 'z'].map((label) => ({ label, kind: 'property', detail: `item ${label}` })),
    );
  if (prev?.type === 'id' && (prev.value === 'module' || prev.value === 'function')) return none;
  const top = stack[stack.length - 1];
  const argStart =
    top && prev && (prev === top.token || (prev.type === 'punct' && prev.value === ','));
  if (top?.params && argStart) return none;

  const items: Completion[] = [];
  const seen = new Set<string>();
  const add = (c: Completion) => {
    if (seen.has(c.kind + ' ' + c.label)) return;
    seen.add(c.kind + ' ' + c.label);
    items.push(c);
  };

  // Named arguments of the call being typed
  if (top?.callee && argStart) {
    const c = callee(a, top.callee);
    if (c?.def)
      for (const p of c.def.params!)
        add({
          label: p.name,
          kind: 'argument',
          insert: `${p.name} = `,
          ...(p.value !== undefined && { detail: `${p.name} = ${p.value}` }),
          ...(p.doc && { doc: p.doc }),
          first: true,
        });
    if (c?.sig)
      for (const p of c.sig.params)
        add({
          label: p.name,
          kind: 'argument',
          insert: `${p.name} = `,
          ...(p.default !== undefined && { detail: `${p.name} = ${p.default}` }),
          ...(p.doc && { doc: p.doc }),
          first: true,
        });
  }

  const blockLevel = !top || top.token.value === '{';
  const first = tokens[stmtStart];
  const assigning =
    first?.type === 'id' && tokens[stmtStart + 1]?.value === '=' && tokens.length > stmtStart + 1;
  const statement =
    blockLevel &&
    !assigning &&
    (!prev ||
      (prev.type === 'punct' && [';', '{', '}', ')', '*', '#', '%', '!'].includes(prev.value)) ||
      (prev.type === 'id' && prev.value === 'else'));

  const scopes = scopesAt(a, from);
  const user = (ns: Ns) => {
    const out: Definition[] = [];
    const names = new Set<string>();
    for (const s of scopes)
      for (const [name, list] of s[ns])
        if (!names.has(name)) {
          names.add(name);
          out.push(list[list.length - 1]);
        }
    return out;
  };
  const fromDef = (d: Definition): Completion => ({
    label: d.name,
    kind: d.kind,
    detail:
      d.kind === 'module' || d.kind === 'function'
        ? header(d)
        : d.value !== undefined
          ? `${d.name} = ${d.value.split('\n')[0]}`
          : d.name,
    ...((d.doc || d.file) && {
      doc: [d.doc, d.file !== undefined && `From \`<${d.file}>\``].filter(Boolean).join('\n\n'),
    }),
  });
  const fromSig = (s: Signature): Completion => ({
    label: s.name,
    kind: statement ? 'module' : 'function',
    detail: formatSignature(s),
    doc: s.doc,
    builtin: true,
  });

  for (const d of user('vars')) if (d.name !== around.word || d.start < from) add(fromDef(d));
  for (const [name, s] of Object.entries(SPECIAL))
    add({
      label: name,
      kind: name === 'PI' ? 'constant' : 'variable',
      detail: s.value !== undefined ? `${name} = ${s.value}` : name,
      doc: s.doc,
      builtin: true,
    });
  if (statement) {
    for (const d of user('mods')) add(fromDef(d));
    for (const s of SIGNATURES) if (s.kind !== 'function') add(fromSig(s));
    for (const k of ['module', 'function', 'for', 'if', 'let', 'use', 'include'])
      add({ label: k, kind: 'keyword' });
    if (prev?.type === 'punct' && prev.value === '}') add({ label: 'else', kind: 'keyword' });
  } else {
    for (const d of user('fns')) add(fromDef(d));
    for (const s of SIGNATURES) if (s.kind !== 'module') add(fromSig(s));
    for (const c of CONSTANTS) add({ label: c, kind: 'constant', builtin: true });
    add({ label: 'let', kind: 'keyword' });
    add({ label: 'function', kind: 'keyword' });
    if (top?.token.value === '[')
      for (const k of ['for', 'if', 'else', 'each']) add({ label: k, kind: 'keyword' });
  }
  return result(items);
}

export interface SignatureHelp {
  label: string;
  // Markdown
  doc?: string;
  // Where each parameter is in the label
  params: { start: number; end: number; doc?: string }[];
  // The parameter being typed, or -1 when there is none
  active: number;
}

/** The parameters of the call being typed at an offset. */
export function signatureHelp(a: Analysis, offset: number): SignatureHelp | undefined {
  const around = surroundings(a.source, offset);
  if (!around) return undefined;
  let open: Open | undefined;
  for (let i = around.stack.length - 1; i >= 0; i--) {
    const o = around.stack[i];
    if (o.token.value === '{' || o.params) return undefined;
    if (o.callee) {
      open = o;
      break;
    }
  }
  if (!open) return undefined;
  const c = callee(a, open.callee!);
  if (!c) return undefined;
  const name = open.callee!.value;
  const list = c.def
    ? c.def.params!.map((p) => ({
        text: p.value !== undefined ? `${p.name} = ${p.value.split('\n')[0]}` : p.name,
        name: p.name,
        doc: p.doc,
      }))
    : c.sig!.params.map((p) => ({
        text: p.default !== undefined ? `${p.name} = ${p.default}` : p.name,
        name: p.name,
        doc: p.doc,
      }));
  if (c.sig?.rest) list.push({ text: '...', name: '...', doc: 'Any number of values' });
  let label = `${name}(`;
  const params = list.map((p, i) => {
    if (i) label += ', ';
    const start = label.length;
    label += p.text;
    return { start, end: label.length, ...(p.doc && { doc: p.doc }) };
  });
  label += ')';
  // The argument being typed: by name when it starts with name =, else by
  // position
  const index = open.commas.length;
  const argFrom = index ? open.commas[index - 1] + 1 : open.index + 1;
  const arg = around.tokens.slice(argFrom);
  let active = index;
  if (arg[0]?.type === 'id' && arg[1]?.value === '=')
    active = list.findIndex((p) => p.name === arg[0].value);
  else if (
    around.tokens
      .slice(open.index + 1)
      .some(
        (t, i, all) =>
          t.type === 'id' && all[i + 1]?.value === '=' && (i === 0 || all[i - 1].value === ','),
      )
  )
    active = -1; // positional after named arguments
  if (c.sig?.rest && active >= list.length) active = list.length - 1;
  if (active >= list.length) active = -1;
  const doc = c.def
    ? [c.def.doc, c.def.file !== undefined && `From \`<${c.def.file}>\``]
        .filter(Boolean)
        .join('\n\n')
    : c.sig!.doc;
  return { label, ...(doc && { doc }), params, active };
}

export interface OutlineItem {
  name: string;
  kind: 'module' | 'function' | 'variable';
  detail?: string;
  // The whole definition
  range: [number, number];
  // The name
  start: number;
  end: number;
  children: OutlineItem[];
}

/** The program's modules, functions and assignments, nested as written. */
export function outline(a: Analysis): OutlineItem[] {
  const defs = a.definitions.filter((d) => OUTLINED.has(d)).sort((x, y) => x.range[0] - y.range[0]);
  const root: OutlineItem[] = [];
  const open: OutlineItem[] = [];
  for (const d of defs) {
    const item: OutlineItem = {
      name: d.name,
      kind: d.kind as OutlineItem['kind'],
      ...(d.kind === 'variable' && d.value !== undefined
        ? { detail: d.value.split('\n')[0] }
        : d.kind !== 'variable' && { detail: header(d) }),
      range: d.range,
      start: d.start,
      end: d.end,
      children: [],
    };
    while (open.length && open[open.length - 1].range[1] < d.range[0]) open.pop();
    (open.length ? open[open.length - 1].children : root).push(item);
    if (d.kind !== 'variable') open.push(item);
  }
  return root;
}

export interface Problem {
  severity: 'error' | 'warning';
  message: string;
  start: number;
  end: number;
  // Other places in the program that explain it, as the calls an error
  // happened inside
  related?: { message: string; start: number; end: number }[];
}

const POSITION = /\s*\(line (\d+)(?:, column (\d+))?(?: in <([^>]+)>)?\)/;

/** Runs the program and returns its errors and warnings with where they
 * are. Takes render()'s options, such as resolve and fonts. */
export function problems(source: string, options: RenderOptions = {}): Problem[] {
  const starts = [0];
  for (let i = source.indexOf('\n'); i >= 0; i = source.indexOf('\n', i + 1)) starts.push(i + 1);
  const lineText = (line: number) =>
    source.slice(starts[line - 1], (starts[line] ?? source.length + 1) - 1).replace(/\r$/, '');
  const span = (line: number, col?: number) => {
    if (line < 1 || line > starts.length) return { start: 0, end: 0 };
    const text = lineText(line);
    if (col === undefined) {
      const indent = text.length - text.trimStart().length;
      return { start: starts[line - 1] + indent, end: starts[line - 1] + text.trimEnd().length };
    }
    const start = starts[line - 1] + Math.min(col - 1, text.length);
    return { start, end: Math.min(start + markLength(text, col), starts[line - 1] + text.length) };
  };
  // A library's problem is shown where the program uses it
  const usedAt = (file: string) => {
    const m = new RegExp(
      `\\b(?:use|include)\\s*<${file.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}>`,
    ).exec(source);
    return m ? { start: m.index, end: m.index + m[0].length } : { start: 0, end: 0 };
  };
  const out: Problem[] = [];
  const warn = (w: string) => {
    if (w.startsWith('Nothing to cut')) return; // libraries make no shapes
    const m = POSITION.exec(w);
    if (!m) out.push({ severity: 'warning', message: w, start: 0, end: 0 });
    else if (m[3]) out.push({ severity: 'warning', message: w, ...usedAt(m[3]) });
    else
      out.push({
        severity: 'warning',
        message: w.replace(POSITION, ''),
        ...span(Number(m[1]), m[2] === undefined ? undefined : Number(m[2])),
      });
  };
  try {
    render(source, options).warnings.forEach(warn);
  } catch (e) {
    if (!(e instanceof KerfError)) {
      out.push({
        severity: 'error',
        message: e instanceof Error ? e.message : String(e),
        start: 0,
        end: 0,
      });
      return out;
    }
    e.warnings.forEach(warn);
    const frames = e.trace.filter((f) => f.file === undefined);
    let message = e.reason;
    let where = { start: 0, end: 0 };
    if (e.file === undefined && e.line !== undefined) where = span(e.line, e.col);
    else if (e.file !== undefined) {
      message += ` (in <${e.file}>${e.line !== undefined ? `, line ${e.line}` : ''})`;
      const call = frames.shift();
      where = call ? span(call.line, call.col) : usedAt(e.file);
    }
    const sig = e.call ? signature(e.call) : undefined;
    if (sig) message += `\n${formatSignature(sig)}: ${sig.doc}`;
    const related = frames.map((f) => ({
      message: `in ${f.kind === 'module' ? 'module ' : ''}${f.name}(), called here${f.count > 1 ? ` (${f.count} times)` : ''}`,
      ...span(f.line, f.col),
    }));
    out.push({ severity: 'error', message, ...where, ...(related.length && { related }) });
  }
  return out;
}
