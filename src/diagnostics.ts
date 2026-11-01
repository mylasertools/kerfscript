// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Errors as people read them: the message, where it happened with the
// source line and the expression underlined, the calls it happened inside,
// and what a built-in takes when its arguments were wrong.
//
//   error: Unknown variable "widht". Did you mean "width"?
//    --> design.kerf:5:6
//     |
//   5 | rect([widht, 20]);
//     |       ^^^^^
//     = in module panel(), called at design.kerf:9:1

import { KerfError, type TraceFrame } from './lexer.js';
import { formatSignature, signature } from './signatures.js';
import { LIBRARIES } from './stdlib.js';

export interface FormatOptions {
  // The program's name in locations; "design.kerf" when left out
  file?: string;
  // Library sources by path, for lines inside libraries, as render()'s
  // resolve option. The standard library is found without it.
  resolve?: (path: string) => string | undefined;
}

// Calls shown before the rest are counted
const SHOWN = 8;

const TOKEN =
  /^(?:[A-Za-z_$][A-Za-z0-9_]*|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|"(?:[^"\\]|\\.)*"?|<=|>=|==|!=|&&|\|\|)/;

export function formatError(error: unknown, source: string, options: FormatOptions = {}): string {
  if (!(error instanceof KerfError))
    return `error: ${error instanceof Error ? error.message : String(error)}`;
  const name = options.file ?? 'design.kerf';
  const place = (file: string | undefined, line: number, col: number) =>
    `${file ? `<${file}>` : name}:${line}:${col}`;
  const text = (file: string | undefined) =>
    file === undefined
      ? source
      : ((Object.prototype.hasOwnProperty.call(LIBRARIES, file) ? LIBRARIES[file] : undefined) ??
        options.resolve?.(file));

  const out = [`error: ${error.reason}`];
  if (error.line !== undefined && error.col !== undefined) {
    out.push(` --> ${place(error.file, error.line, error.col)}`);
    const lines = text(error.file)?.split('\n');
    const line = lines?.[error.line - 1]?.replace(/\r$/, '');
    if (line !== undefined) {
      const num = String(error.line);
      const pad = ' '.repeat(num.length);
      const before = line.slice(0, error.col - 1);
      const length = Math.max(1, TOKEN.exec(line.slice(error.col - 1))?.[0].length ?? 1);
      // Tabs stay tabs so the marks line up under them
      const indent = before.replace(/[^\t]/g, ' ');
      out.push(`${pad} |`, `${num} | ${line}`, `${pad} | ${indent}${'^'.repeat(length)}`);
    }
  }
  for (const note of traceNotes(error, place)) out.push(`  = ${note}`);
  const sig = error.call ? signature(error.call) : undefined;
  if (sig) out.push(`  = ${formatSignature(sig)}: ${sig.doc}`);
  return out.join('\n');
}

// One line per call, innermost first; a call made again by recursion says
// how many times it is on the stack
function traceNotes(
  error: KerfError,
  place: (file: string | undefined, line: number, col: number) => string,
): string[] {
  const line = (f: TraceFrame) =>
    `in ${f.kind === 'module' ? 'module ' : ''}${f.name}(), called at ${place(f.file, f.line, f.col)}${f.count > 1 ? ` (${f.count} times)` : ''}`;
  const notes = error.trace.slice(0, SHOWN).map(line);
  const more = error.trace.length - notes.length + error.traceMore;
  if (more) notes.push(`and ${more} more call${more === 1 ? '' : 's'}`);
  return notes;
}
