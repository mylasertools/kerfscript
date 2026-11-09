// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import type { Arg, Assign, Expr, ListItem, Param, Program, Stmt } from './ast.js';
import { KerfError, tokenize, type Comment, type Pos, type Token } from './lexer.js';

const KEYWORDS = new Set([
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

// file names the library being parsed, for positions and errors
export function parse(src: string, file?: string): { program: Program; comments: Comment[] } {
  const { tokens, comments } = tokenize(src, file);
  const p = new Parser(tokens);
  const body: Stmt[] = [];
  while (!p.at('eof')) body.push(...p.statement());
  return { program: { body }, comments };
}

class Parser {
  private i = 0;
  constructor(private tokens: Token[]) {}

  peek(o = 0): Token {
    return this.tokens[Math.min(this.i + o, this.tokens.length - 1)];
  }
  at(type: Token['type'], value?: string, o = 0): boolean {
    const t = this.peek(o);
    return t.type === type && (value === undefined || t.value === value);
  }
  isP(value: string, o = 0): boolean {
    return this.at('punct', value, o);
  }
  isK(value: string, o = 0): boolean {
    return this.at('id', value, o);
  }
  next(): Token {
    return this.tokens[this.i++];
  }
  fail(msg: string, t = this.peek()): never {
    const near = t.type === 'eof' ? 'end of file' : `"${t.value}"`;
    throw new KerfError(`${msg}, found ${near}`, t.pos);
  }
  expectP(value: string): Token {
    if (!this.isP(value)) this.fail(`Expected "${value}"`);
    return this.next();
  }
  // Between items: a comma, or the closing bracket left for the caller
  separator(close: string) {
    if (this.isP(close)) return;
    if (!this.isP(',')) this.fail(`Expected "," or "${close}"`);
    this.next();
  }
  ident(): Token {
    const t = this.peek();
    if (t.type !== 'id' || KEYWORDS.has(t.value)) this.fail('Expected a name');
    return this.next();
  }

  // The offset just after the last token read
  last(): number {
    return this.tokens[this.i - 1].end;
  }

  statement(): Stmt[] {
    const out = this.stmt();
    for (const s of out) s.end = this.last();
    return out;
  }

  stmt(): Stmt[] {
    const t = this.peek();
    if (this.isP(';')) {
      this.next();
      return [];
    }
    if (this.isP('{')) {
      this.next();
      const body: Stmt[] = [];
      while (!this.isP('}')) {
        if (this.at('eof')) this.fail('Expected "}"');
        body.push(...this.statement());
      }
      this.next();
      return [{ kind: 'block', body, pos: t.pos }];
    }
    if (this.isK('module')) {
      this.next();
      const name = this.ident();
      const params = this.params();
      return [
        {
          kind: 'module',
          name: name.value,
          params,
          body: this.body(),
          pos: t.pos,
          namePos: name.pos,
        },
      ];
    }
    if (this.isK('function') && this.at('id', undefined, 1)) {
      this.next();
      const name = this.ident();
      const params = this.params();
      this.expectP('=');
      const body = this.expr();
      this.expectP(';');
      return [{ kind: 'function', name: name.value, params, body, pos: t.pos, namePos: name.pos }];
    }
    if (this.isK('use') || this.isK('include')) {
      this.next();
      const path = this.peek();
      if (path.type !== 'str') this.fail('Expected a library path like <kerf/box>');
      this.next();
      if (this.isP(';')) this.next();
      return [{ kind: 'use', path: path.value, include: t.value === 'include', pos: t.pos }];
    }
    if (this.isK('for')) {
      this.next();
      const assigns = this.assigns();
      return [{ kind: 'for', assigns, body: this.body(), pos: t.pos }];
    }
    // As OpenSCAD's: intersects the iterations, where for joins them
    if (this.isK('intersection_for') && this.isP('(', 1)) {
      this.next();
      const assigns = this.assigns();
      return [{ kind: 'for', assigns, body: this.body(), pos: t.pos, intersect: true }];
    }
    if (this.isK('if')) {
      this.next();
      this.expectP('(');
      const cond = this.expr();
      this.expectP(')');
      const then = this.body();
      let otherwise: Stmt[] = [];
      if (this.isK('else')) {
        this.next();
        otherwise = this.body();
      }
      return [{ kind: 'if', cond, then, else: otherwise, pos: t.pos }];
    }
    if (this.isK('let') && this.isP('(', 1)) {
      this.next();
      const assigns = this.assigns();
      return [{ kind: 'let', assigns, body: this.body(), pos: t.pos }];
    }
    if (t.type === 'id' && this.isP('=', 1)) {
      const name = this.ident().value;
      this.next();
      const start = this.peek().pos.offset;
      const value = this.expr();
      const end = this.expectP(';').pos.offset;
      return [{ kind: 'assign', name, value, span: [start, end], pos: t.pos }];
    }
    let modifier: string | null = null;
    if (this.isP('*') || this.isP('!') || this.isP('#') || this.isP('%'))
      modifier = this.next().value;
    const nameTok = this.peek();
    if (nameTok.type !== 'id' || KEYWORDS.has(nameTok.value)) this.fail('Expected a statement');
    this.next();
    const args = this.args();
    const children = this.body();
    return [{ kind: 'call', name: nameTok.value, args, children, modifier, pos: nameTok.pos }];
  }

  body(): Stmt[] {
    if (this.isP(';')) {
      this.next();
      return [];
    }
    if (this.isP('{')) {
      this.next();
      const body: Stmt[] = [];
      while (!this.isP('}')) {
        if (this.at('eof')) this.fail('Expected "}"');
        body.push(...this.statement());
      }
      this.next();
      return body;
    }
    return this.statement();
  }

  params(): Param[] {
    this.expectP('(');
    const out: Param[] = [];
    while (!this.isP(')')) {
      const name = this.ident();
      let def: Expr | null = null;
      if (this.isP('=')) {
        this.next();
        def = this.expr();
      }
      out.push({ name: name.value, default: def, pos: name.pos });
      this.separator(')');
    }
    this.next();
    return out;
  }

  args(): Arg[] {
    this.expectP('(');
    const out: Arg[] = [];
    while (!this.isP(')')) {
      if (this.at('id') && this.isP('=', 1)) {
        const name = this.next();
        this.next();
        out.push({ name: name.value, value: this.expr(), pos: name.pos });
      } else out.push({ name: null, value: this.expr() });
      this.separator(')');
    }
    this.next();
    return out;
  }

  assigns(): Assign[] {
    this.expectP('(');
    const out: Assign[] = [];
    while (!this.isP(')')) {
      const t = this.ident();
      this.expectP('=');
      out.push({ name: t.value, value: this.expr(), pos: t.pos });
      this.separator(')');
    }
    this.next();
    return out;
  }

  expr(): Expr {
    const t = this.peek();
    if (this.isK('function') && this.isP('(', 1)) {
      this.next();
      const params = this.params();
      const body = this.expr();
      return { kind: 'lambda', params, body, pos: t.pos, end: this.last() };
    }
    if (this.isK('let') && this.isP('(', 1)) {
      this.next();
      const assigns = this.assigns();
      const body = this.expr();
      return { kind: 'let', assigns, body, pos: t.pos, end: this.last() };
    }
    // assert(c, msg) expr and echo(...) expr: check or trace, then the
    // expression, which a failed assertion never reaches
    if (this.at('id') && (t.value === 'assert' || t.value === 'echo') && this.isP('(', 1)) {
      const save = this.i;
      this.next();
      const check: Expr = {
        kind: 'call',
        callee: { kind: 'var', name: t.value, pos: t.pos },
        args: this.args(),
        pos: t.pos,
      };
      if (this.startsValue()) return { kind: 'chain', check, body: this.expr(), pos: t.pos };
      this.i = save;
    }
    const cond = this.binary(0);
    if (this.isP('?')) {
      this.next();
      const then = this.expr();
      this.expectP(':');
      const otherwise = this.expr();
      return { kind: 'ternary', cond, then, else: otherwise, pos: t.pos };
    }
    return cond;
  }

  private static LEVELS = [
    ['||'],
    ['&&'],
    ['==', '!='],
    ['<', '<=', '>', '>='],
    ['+', '-'],
    ['*', '/', '%'],
  ];

  binary(level: number): Expr {
    if (level >= Parser.LEVELS.length) return this.unary();
    let left = this.binary(level + 1);
    while (this.at('punct') && Parser.LEVELS[level].includes(this.peek().value)) {
      const op = this.next();
      const right = this.binary(level + 1);
      left = { kind: 'binary', op: op.value, left, right, pos: op.pos };
    }
    return left;
  }

  // Whether the next token can begin a value: after assert(...) it makes a
  // chain, where an operator or a closing bracket ends the call
  private startsValue(): boolean {
    const t = this.peek();
    if (t.type === 'num' || t.type === 'str' || t.type === 'id') return true;
    return this.isP('[') || this.isP('(') || this.isP('{') || this.isP('!') || this.isP('-');
  }

  unary(): Expr {
    // let and function literals after an operator, as at the start: their
    // body reaches as far right as it can
    if ((this.isK('let') || this.isK('function')) && this.isP('(', 1)) return this.expr();
    if (this.isP('-') || this.isP('!') || this.isP('+')) {
      const op = this.next();
      return { kind: 'unary', op: op.value, arg: this.unary(), pos: op.pos };
    }
    return this.power();
  }

  power(): Expr {
    const base = this.postfix();
    if (this.isP('^')) {
      const op = this.next();
      return { kind: 'binary', op: '^', left: base, right: this.unary(), pos: op.pos };
    }
    return base;
  }

  postfix(): Expr {
    let e = this.primary();
    for (;;) {
      const t = this.peek();
      if (this.isP('(')) {
        // At the name called, which messages point to
        e = { kind: 'call', callee: e, args: this.args(), pos: e.pos };
      } else if (this.isP('[')) {
        this.next();
        const index = this.expr();
        this.expectP(']');
        e = { kind: 'index', target: e, index, pos: t.pos };
      } else if (this.isP('.')) {
        this.next();
        e = { kind: 'member', target: e, name: this.ident().value, pos: t.pos };
      } else return e;
    }
  }

  primary(): Expr {
    const t = this.peek();
    if (t.type === 'num') {
      this.next();
      const u = /(mm|cm|m|in|ft)$/.exec(t.value);
      if (u)
        return {
          kind: 'num',
          value: Number(t.value.slice(0, -u[1].length)),
          unit: u[1] as 'mm' | 'cm' | 'm' | 'in' | 'ft',
          pos: t.pos,
        };
      return { kind: 'num', value: Number(t.value), pos: t.pos };
    }
    if (t.type === 'str') {
      this.next();
      return { kind: 'str', value: t.value, pos: t.pos };
    }
    if (t.type === 'id') {
      if (t.value === 'true' || t.value === 'false') {
        this.next();
        return { kind: 'bool', value: t.value === 'true', pos: t.pos };
      }
      if (t.value === 'undef') {
        this.next();
        return { kind: 'undef', pos: t.pos };
      }
      if (KEYWORDS.has(t.value)) this.fail('Expected a value');
      this.next();
      return { kind: 'var', name: t.value, pos: t.pos };
    }
    if (this.isP('(')) {
      this.next();
      const e = this.expr();
      this.expectP(')');
      return e;
    }
    if (this.isP('[')) return this.list();
    if (this.isP('{')) return this.record();
    this.fail('Expected a value');
  }

  // {name = value, ...}: a record of named fields
  record(): Expr {
    const open = this.expectP('{');
    const fields: { name: string; value: Expr; pos: Pos }[] = [];
    while (!this.isP('}')) {
      const id = this.ident();
      if (fields.some((f) => f.name === id.value))
        throw new KerfError(`Field ${id.value} is given twice`, id.pos);
      this.expectP('=');
      fields.push({ name: id.value, value: this.expr(), pos: id.pos });
      if (!this.isP(',')) break;
      this.next();
    }
    this.expectP('}');
    return { kind: 'record', fields, pos: open.pos };
  }

  list(): Expr {
    const open = this.expectP('[');
    if (this.isP(']')) {
      this.next();
      return { kind: 'list', items: [], pos: open.pos };
    }
    if (
      !this.isK('for') &&
      !this.isK('if') &&
      !this.isK('each') &&
      !(this.isK('let') && this.isP('(', 1)) &&
      !(this.isP('(') && (this.isK('for', 1) || this.isK('if', 1)))
    ) {
      const first = this.expr();
      if (this.isP(':')) {
        this.next();
        let step: Expr | null = null;
        let end = this.expr();
        if (this.isP(':')) {
          this.next();
          step = end;
          end = this.expr();
        }
        this.expectP(']');
        return { kind: 'range', start: first, step, end, pos: open.pos };
      }
      const items: ListItem[] = [{ kind: 'item', expr: first }];
      return this.listRest(items, open.pos);
    }
    return this.listRest([], open.pos);
  }

  listRest(items: ListItem[], pos: Token['pos']): Expr {
    if (items.length) {
      if (this.isP(']')) {
        this.next();
        return { kind: 'list', items, pos };
      }
      this.separator(']');
    }
    while (!this.isP(']')) {
      items.push(this.listItem());
      this.separator(']');
    }
    this.next();
    return { kind: 'list', items, pos };
  }

  listItem(): ListItem {
    const t = this.peek();
    if (this.isK('for') && this.isP('(', 1)) {
      this.next();
      const assigns = this.assigns();
      const body = this.listItem();
      return { kind: 'for', assigns, body, pos: t.pos, end: this.last() };
    }
    if (this.isK('if') && this.isP('(', 1)) {
      this.next();
      this.expectP('(');
      const cond = this.expr();
      this.expectP(')');
      const then = this.listItem();
      let otherwise: ListItem | null = null;
      if (this.isK('else')) {
        this.next();
        otherwise = this.listItem();
      }
      return { kind: 'if', cond, then, else: otherwise };
    }
    if (this.isK('let') && this.isP('(', 1)) {
      this.next();
      const assigns = this.assigns();
      const body = this.listItem();
      return { kind: 'let', assigns, body, pos: t.pos, end: this.last() };
    }
    if (this.isK('each')) {
      this.next();
      return { kind: 'each', expr: this.expr() };
    }
    if (this.isP('(') && (this.isK('for', 1) || this.isK('if', 1))) {
      this.next();
      const inner = this.listItem();
      this.expectP(')');
      return inner;
    }
    return { kind: 'item', expr: this.expr() };
  }
}
