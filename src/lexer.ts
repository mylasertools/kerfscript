// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

export type TokenType = 'num' | 'str' | 'id' | 'punct' | 'eof';

export interface Pos {
  line: number;
  col: number;
  offset: number;
  // The library the position is in, as `use <path>` named it; none for the
  // program itself
  file?: string;
}

// "line 3, column 5", and "in <lib/tabs>" for a position in a library
export const where = (pos: Pos, col = true) =>
  `line ${pos.line}${col ? `, column ${pos.col}` : ''}${pos.file ? ` in <${pos.file}>` : ''}`;

export interface Token {
  type: TokenType;
  value: string;
  pos: Pos;
  // The offset just after the token
  end: number;
}

export interface Comment {
  text: string;
  line: number;
  block: boolean;
  own: boolean;
  // Offsets of the whole comment, markers included
  start: number;
  end: number;
}

// A module or function call the error happened inside, at its call site
export interface TraceFrame {
  kind: 'module' | 'function';
  name: string;
  line: number;
  col: number;
  file?: string;
  // How many times this call is on the stack, more than once in recursion
  count: number;
}

// Different calls kept in a trace; more are only counted
const MAX_TRACE = 50;

export class KerfError extends Error {
  line?: number;
  col?: number;
  echoes: string[] = [];
  // Warnings before the error
  warnings: string[] = [];
  missingFonts?: string[];
  // The library the error is in; line and col are in that file
  file?: string;
  // The message without its position
  reason: string;
  // The calls the error happened inside, innermost first
  trace: TraceFrame[] = [];
  // Calls past the end of trace
  traceMore = 0;
  // The built-in whose arguments were wrong, to show what it takes
  call?: string;
  constructor(message: string, pos?: Pos) {
    super(pos ? `${message} (${where(pos)})` : message);
    this.name = 'KerfError';
    this.reason = message;
    if (pos) {
      this.line = pos.line;
      this.col = pos.col;
      this.file = pos.file;
    }
  }

  // A call the error left, as it leaves it. The same call can only be on
  // the stack twice through recursion, so it is counted, not repeated.
  addFrame(kind: TraceFrame['kind'], name: string, pos: Pos) {
    const same = this.trace.find(
      (f) => f.name === name && f.line === pos.line && f.col === pos.col && f.file === pos.file,
    );
    if (same) same.count++;
    else if (this.trace.length >= MAX_TRACE) this.traceMore++;
    else
      this.trace.push({
        kind,
        name,
        line: pos.line,
        col: pos.col,
        ...(pos.file && { file: pos.file }),
        count: 1,
      });
  }
}

const PUNCT = [
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '<',
  '>',
  '!',
  '?',
  ':',
  '=',
  '.',
  ',',
  ';',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '#',
];

export function tokenize(src: string, file?: string): { tokens: Token[]; comments: Comment[] } {
  const tokens: Token[] = [];
  const comments: Comment[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const pos = (): Pos => ({ line, col: i - lineStart + 1, offset: i, ...(file && { file }) });
  const advance = (n: number) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === '\n') {
        line++;
        lineStart = i + 1;
      }
      i++;
    }
  };
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      advance(1);
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      const own = /^[ \t]*$/.test(src.slice(src.lastIndexOf('\n', i - 1) + 1, i));
      comments.push({
        text: src.slice(i + 2, stop).trim(),
        line,
        block: false,
        own,
        start: i,
        end: stop,
      });
      i = stop;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const start = pos();
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new KerfError('Unclosed block comment', start);
      comments.push({
        text: src.slice(i + 2, end).trim(),
        line: start.line,
        block: true,
        own: true,
        start: i,
        end: end + 2,
      });
      advance(end + 2 - i);
      continue;
    }
    const p = pos();
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      // A length in real units, as 140cm, carries its unit
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?:(?:mm|cm|m|in|ft)(?![A-Za-z0-9_]))?/.exec(
        src.slice(i),
      )!;
      tokens.push({ type: 'num', value: m[0], pos: p, end: i + m[0].length });
      advance(m[0].length);
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_]*/.exec(src.slice(i))!;
      tokens.push({ type: 'id', value: m[0], pos: p, end: i + m[0].length });
      advance(m[0].length);
      continue;
    }
    if (c === '"') {
      let out = '';
      advance(1);
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') {
          const n = src[i + 1];
          if (n === 'n') out += '\n';
          else if (n === 't') out += '\t';
          else if (n === 'u') {
            const hex = src.slice(i + 2, i + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new KerfError('Bad \\u escape', pos());
            out += String.fromCharCode(parseInt(hex, 16));
            advance(4);
          } else out += n;
          advance(2);
          continue;
        }
        if (src[i] === '\n') throw new KerfError('Unclosed string', p);
        out += src[i];
        advance(1);
      }
      if (i >= src.length) throw new KerfError('Unclosed string', p);
      advance(1);
      tokens.push({ type: 'str', value: out, pos: p, end: i });
      continue;
    }
    if (c === '<' && /^<[A-Za-z0-9_./-]+>/.test(src.slice(i))) {
      const prev = tokens[tokens.length - 1];
      if (prev && prev.type === 'id' && (prev.value === 'use' || prev.value === 'include')) {
        const m = /^<([A-Za-z0-9_./-]+)>/.exec(src.slice(i))!;
        tokens.push({ type: 'str', value: m[1], pos: p, end: i + m[0].length });
        advance(m[0].length);
        continue;
      }
    }
    const op = PUNCT.find((s) => src.startsWith(s, i));
    if (!op) throw new KerfError(`Unexpected character "${c}"`, p);
    tokens.push({ type: 'punct', value: op, pos: p, end: i + op.length });
    advance(op.length);
  }
  tokens.push({ type: 'eof', value: '', pos: pos(), end: i });
  return { tokens, comments };
}
