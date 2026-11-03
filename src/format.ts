// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// The KerfScript formatter. It keeps the author's line breaks and every
// comment where it is, and sets the rest: indentation, spaces between
// tokens, blank lines and the end of the file. It never re-wraps lines, so
// formatting on save does not move code around.
//
// It works on tokens rather than the syntax tree, and checks its result:
// the output must have the same tokens and comments as the input, or it
// throws instead of returning it.

import { KerfError, tokenize, type Token } from './lexer.js';
import { parse } from './parser.js';

export interface FormatOptions {
  // Spaces per indent level; 2 when left out
  indent?: number;
}

interface Item {
  // A token, or a comment ("line" for //, "block" for /* */)
  kind: 'token' | 'line' | 'block';
  text: string;
  token?: Token;
  // Line breaks in the source before this item
  breaks: number;
  // What the token does, worked out as the formatter reaches it
  // header: the ) after for (...), if (...), let (...) or function (...),
  // which a list can follow
  role?: 'unary' | 'modifier' | 'range' | 'header' | 'record';
}

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
]);
const VALUES = new Set(['true', 'false', 'undef']);
const HEADERS = new Set(['for', 'if', 'let', 'function']);
const CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const BINARY = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  '&&',
  '||',
  '=',
  '?',
  ':',
]);

// A token's text as written, which for strings and library paths is not
// its value
function raw(src: string, t: Token): string {
  const i = t.pos.offset;
  if (t.type === 'str' && src[i] === '<') return `<${t.value}>`;
  if (t.type !== 'str') return t.value;
  let j = i + 1;
  while (src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
  return src.slice(i, j + 1);
}

// The program as tokens and comments, each with the line breaks before it.
// Trailing spaces inside block comments are dropped.
function items(src: string): Item[] {
  const { tokens } = tokenize(src);
  const out: Item[] = [];
  let at = 0;
  let breaks = 0;
  const gap = (end: number) => {
    while (at < end) {
      if (src[at] === '\n') {
        breaks++;
        at++;
      } else if (src.startsWith('//', at)) {
        const stop = src.indexOf('\n', at);
        const e = stop < 0 ? src.length : stop;
        out.push({ kind: 'line', text: src.slice(at, e).trimEnd(), breaks });
        [breaks, at] = [0, e];
      } else if (src.startsWith('/*', at)) {
        const e = src.indexOf('*/', at + 2) + 2;
        const text = src.slice(at, e).replace(/[ \t\r]+\n/g, '\n');
        out.push({ kind: 'block', text, breaks });
        [breaks, at] = [0, e];
      } else at++;
    }
  };
  for (const t of tokens) {
    gap(t.pos.offset);
    if (t.type === 'eof') break;
    const text = raw(src, t);
    out.push({ kind: 'token', text, token: t, breaks });
    breaks = 0;
    at = t.pos.offset + text.length;
  }
  return out;
}

interface Bracket {
  open: string;
  // Indent level of the line it opened on, and of the lines inside it
  outer: number;
  inner: number;
  line: number;
  // Unfinished ?: inside it, so that a : is a ternary rather than a range
  ternaries: number;
  // Opened after for, if, let or function
  header: boolean;
  // A { that starts a record value, not a block
  record?: boolean;
}

// The program with its layout set. Throws a KerfError for a program that
// does not parse.
export function format(source: string, options: FormatOptions = {}): string {
  parse(source); // only whole programs are formatted
  const unit = ' '.repeat(options.indent ?? 2);
  const list = items(source);
  const lines: string[] = [];
  let line = null as string | null;
  let lineNo = -1;
  let level = 0; // indent level of the current line
  const stack: Bracket[] = [];
  let ternaries = 0; // unfinished ?: outside any bracket
  // The statement being written, at block level
  let stmtStart = true;
  let stmtLevel = 0;
  let stmtAssign = false;
  let chainLevel = 0; // indent of the last line that started at block level
  let headerLevel = 0; // indent of the line the last for/if/let/function header began on
  let prev: Item | undefined; // the previous token
  let last: Item | undefined; // the previous item on this line

  const top = (): Bracket | undefined => stack[stack.length - 1];
  const atBlock = () => !top() || (top()!.open === '{' && !top()!.record);
  const closes = (t: Item) => t.kind === 'token' && !!top() && t.text === CLOSE[top()!.open];

  const newLine = (indent: number, blank: boolean) => {
    if (line !== null) lines.push(line.trimEnd());
    if (blank && lines.length && lines[lines.length - 1] !== '') lines.push('');
    lineNo++;
    level = indent;
    line = unit.repeat(indent);
    last = undefined;
  };

  // The indent of a line starting with this token
  const indentFor = (t: Item): number => {
    if (closes(t)) return top()!.outer;
    if (!atBlock()) {
      // Inside brackets: a new item lines up, a comprehension steps in after
      // each for (...) or let (...), and an item over several lines is one
      // level further in
      if (!prev || prev.text === ',' || CLOSE[prev.text]) return top()!.inner;
      if (prev.role === 'header') return headerLevel + 1;
      return top()!.inner + 1;
    }
    const block = top() ? top()!.inner : 0;
    if (stmtStart) return block;
    // A statement over several lines: an assignment's lines are one level
    // in; a chain such as for (...) translate(...) rect() steps in a level
    // each line
    return stmtAssign ? stmtLevel + 1 : chainLevel + 1;
  };

  // The next token from item i on, for comments that take its indent
  const nextToken = (i: number) => list.slice(i).find((x) => x.kind === 'token');

  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const starts = lineNo < 0 || it.breaks > 0;

    if (it.kind !== 'token') {
      if (starts) {
        // An own-line comment takes the indent of the code after it, inside
        // a bracket that closes next
        const next = nextToken(i);
        const indent = !next ? 0 : closes(next) ? top()!.inner : indentFor(next);
        newLine(indent, it.breaks > 1 && lineNo >= 0);
      } else line += ' ';
      line += it.text;
      last = it;
      continue;
    }

    const text = it.text;
    const type = it.token!.type;

    // What the token does
    // * ! # % before a module call that starts a statement, as in
    // `if (debug) #rect(10)`; inside an expression they are operators
    if (
      '*!#%'.includes(text) &&
      atBlock() &&
      !stmtAssign &&
      (stmtStart || prev?.text === ')' || prev?.text === 'else')
    )
      it.role = 'modifier';
    else if (text === '!' || ((text === '-' || text === '+') && (!prev || operatorLike(prev))))
      it.role = 'unary';
    if (text === ':') {
      const open = top();
      const pending = open ? open.ternaries : ternaries;
      if (pending) {
        if (open) open.ternaries--;
        else ternaries--;
      } else if (open?.open === '[') it.role = 'range';
    }

    if (text === '}' && top()?.record) it.role = 'record';
    else if (text === '{' && !!prev && ['=', '(', ',', '[', '?', ':'].includes(prev.text))
      it.role = 'record';

    if (starts) {
      const indent = indentFor(it);
      newLine(indent, it.breaks > 1 && lineNo >= 0);
      if (atBlock() && !closes(it)) chainLevel = indent;
    } else if (last && space(last, it)) line += ' ';

    if (atBlock() && stmtStart && !closes(it)) {
      stmtLevel = level;
      stmtAssign =
        (type === 'id' && list[i + 1]?.kind === 'token' && list[i + 1].text === '=') ||
        text === 'function';
      stmtStart = false;
    }

    line += text;

    if (CLOSE[text]) {
      const here = top();
      // After = ( , [ ? or :, a { is a record value
      const record = it.role === 'record';
      const sameLine =
        here &&
        here.line === lineNo &&
        (here.open !== '{' || here.record) &&
        (text !== '{' || record);
      stack.push({
        record,
        open: text,
        outer: level,
        inner: sameLine ? here!.inner : level + 1,
        line: lineNo,
        ternaries: 0,
        header: text === '(' && !!prev && HEADERS.has(prev.text) && prev.token?.type === 'id',
      });
      if (text === '{' && !record) stmtStart = true;
    } else if (closes(it)) {
      const done = stack.pop()!;
      if (done.header) {
        it.role = 'header';
        headerLevel = done.outer;
      }
      if (text === '}' && !done.record) stmtStart = true;
    } else if (text === ';' && atBlock()) stmtStart = true;
    // use <path> and include <path> need no ;
    else if (type === 'str' && text.startsWith('<') && atBlock()) stmtStart = true;
    else if (text === '?') {
      if (top()) top()!.ternaries++;
      else ternaries++;
    }

    prev = it;
    last = it;
  }
  if (line !== null) lines.push((line as string).trimEnd());
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const out = lines.length ? lines.join('\n') + '\n' : '';
  check(source, out);
  return out;
}

const operatorLike = (p: Item) =>
  BINARY.has(p.text) ||
  ['(', '[', ',', '{', ';', '}'].includes(p.text) ||
  (p.token?.type === 'id' && KEYWORDS.has(p.text)) ||
  p.role === 'unary' ||
  p.role === 'modifier';

// Whether a space goes between two items on one line
function space(a: Item, b: Item): boolean {
  if (a.kind !== 'token' || b.kind !== 'token') return true;
  const x = a.text;
  const y = b.text;
  if (y === ',' || y === ';' || y === ')' || y === ']') return false;
  if (x === '(' || x === '[') return false;
  // An empty block is {}, as an empty list is []
  if (x === '{' && y === '}') return false;
  // A record is written as a list is: {a = 1}
  if ((x === '{' && a.role === 'record') || (y === '}' && b.role === 'record')) return false;
  if (x === '.' || y === '.') return false;
  if (a.role === 'unary' || a.role === 'modifier') return false;
  if (a.role === 'range' || b.role === 'range') return false;
  const t = a.token!;
  // A value followed by ( or [ is a call or an index
  const value =
    t.type === 'num' ||
    (t.type === 'str' && !x.startsWith('<')) ||
    (t.type === 'id' && (!KEYWORDS.has(x) || VALUES.has(x))) ||
    (x === ')' && a.role !== 'header') ||
    x === ']';
  if (y === '(') return x === 'for' || x === 'if' || x === 'let' || (!value && x !== 'function');
  if (y === '[') return !value;
  return true;
}

// The formatted program must read as the same tokens and comments
function check(before: string, after: string) {
  const a = items(before);
  const b = items(after);
  const same =
    a.length === b.length && a.every((x, i) => x.kind === b[i].kind && x.text === b[i].text);
  if (!same) throw new KerfError('The formatter would change the program, so it was left as it is');
}
