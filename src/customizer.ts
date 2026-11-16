// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import type { Expr } from './ast.js';
import { Evaluator } from './evaluator.js';
import { parse } from './parser.js';
import type { Value } from './values.js';

export interface Parameter {
  name: string;
  caption: string;
  group: string;
  type: 'number' | 'string' | 'boolean';
  initial: Value;
  min?: number;
  max?: number;
  step?: number;
  options?: { name: string; value: number | string }[];
  // The setting that drives the model's motion, marked `// [0:5:360] drive`:
  // the playground plays it, and `kerf check --drive` tries every value
  drive?: boolean;
  // Shown only while this condition on the other settings holds, marked
  // `// [0:1] when mount == "stand"`: see shown()
  when?: string;
  // Why `when` could not be used, so the setting is always shown
  whenProblem?: string;
  span: [number, number];
}

function literal(e: Expr): { ok: boolean; value?: Value } {
  switch (e.kind) {
    case 'num':
      // A length in real units depends on $scale: not a plain setting
      if (e.unit) return { ok: false };
      return { ok: true, value: e.value };
    case 'str':
    case 'bool':
      return { ok: true, value: e.value };
    case 'unary':
      if (e.op === '-' && e.arg.kind === 'num') return { ok: true, value: -e.arg.value };
      return { ok: false };
    case 'list': {
      const out: Value[] = [];
      for (const it of e.items) {
        if (it.kind !== 'item') return { ok: false };
        const v = literal(it.expr);
        if (!v.ok || typeof v.value !== 'number') return { ok: false };
        out.push(v.value);
      }
      return { ok: true, value: out };
    }
    default:
      return { ok: false };
  }
}

function parseNumber(s: string): number | undefined {
  const n = Number(s.trim());
  return s.trim() !== '' && Number.isFinite(n) ? n : undefined;
}

export function parameters(source: string): { parameters: Parameter[] } {
  const { program, comments } = parse(source);
  const groups = comments.filter((c) => c.block && /^\[[^\]]+\]$/.test(c.text));
  const inlineComments = new Map(
    comments.filter((c) => !c.block && !c.own).map((c) => [c.line, c.text]),
  );
  const captions = new Map(comments.filter((c) => !c.block && c.own).map((c) => [c.line, c.text]));
  const out: Parameter[] = [];
  // Settings whose `when` follows a [...], so it is surely a condition
  const afterControl = new Set<Parameter>();
  for (const s of program.body) {
    if (s.kind !== 'assign' || /^\$f[nas]$/.test(s.name)) continue;
    const lit = literal(s.value);
    if (!lit.ok) continue;
    const group =
      groups
        .filter((g) => g.line <= s.pos.line)
        .pop()
        ?.text.slice(1, -1)
        .trim() ?? 'Parameters';
    if (group.toLowerCase() === 'hidden') continue;
    const inline = inlineComments.get(s.pos.line);
    const caption = captions.get(s.pos.line - 1) ?? '';
    const v = lit.value;
    const p: Parameter = {
      name: s.name,
      caption,
      group,
      type:
        typeof v === 'number' || Array.isArray(v)
          ? 'number'
          : typeof v === 'boolean'
            ? 'boolean'
            : 'string',
      initial: v,
      span: s.span,
    };
    // A trailing `when <condition>`, after the [...] or on its own
    const w = inline ? /^((?:\[.*\](?:\s+drive)?)?)\s*when\s+(.+)$/.exec(inline.trim()) : null;
    if (w) p.when = w[2].trim();
    if (w?.[1]) afterControl.add(p);
    const rest = w ? w[1].trim() : inline?.trim();
    const m = rest ? /^\[(.*)\](\s+drive)?$/.exec(rest) : null;
    if (m?.[2] && p.type === 'number' && typeof v === 'number') p.drive = true;
    if (m) {
      const body = m[1];
      if (
        body.includes(',') ||
        (/[a-zA-Z"]/.test(body) && !/^-?[\d.]+(:-?[\d.]+){0,2}$/.test(body))
      ) {
        p.options = body.split(',').map((raw) => {
          const [val, label] = raw.split(':').map((x) => x.trim().replace(/^"|"$/g, ''));
          const num = parseNumber(val);
          const value = p.type === 'number' && num !== undefined ? num : val;
          return { name: label ?? val, value };
        });
      } else {
        const nums = body.split(':').map(parseNumber);
        if (nums.every((n) => n !== undefined)) {
          if (nums.length === 1) p.max = nums[0];
          else if (nums.length === 2) {
            p.min = nums[0];
            p.max = nums[1];
          } else {
            p.min = nums[0];
            p.step = nums[1];
            p.max = nums[2];
          }
        }
      }
    }
    out.push(p);
  }
  for (const p of out) {
    if (p.when === undefined) continue;
    // A comment that only begins with "when" and isn't an expression, as
    // "when the lid is closed", is a comment; after a [...] it is meant
    if (!afterControl.has(p) && typeof condition(p.when) === 'string') {
      delete p.when;
      continue;
    }
    const problem = conditionProblem(p.when, out);
    if (problem) {
      p.whenProblem = problem;
      delete p.when;
    }
  }
  return { parameters: out };
}

// The condition's expression, or a reason it can't be one
function condition(text: string): Expr | string {
  try {
    const s = parse(`when__ = (${text});`).program.body[0];
    return s?.kind === 'assign' ? s.value : 'it is not an expression';
  } catch (e) {
    // Its position is in the wrapper above, not in the comment
    return (e as Error).message.replace(/\s*\(line \d+, column \d+\)$/, '');
  }
}

const CONDITION_OPS = new Set([
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '!',
]);

function conditionProblem(text: string, params: Parameter[]): string | undefined {
  const e = condition(text);
  if (typeof e === 'string') return `its condition (${text}) is not an expression: ${e}`;
  const names = new Set(params.map((p) => p.name));
  const bad = (x: Expr): string | undefined => {
    switch (x.kind) {
      case 'num':
      case 'str':
      case 'bool':
      case 'undef':
        return undefined;
      case 'var':
        return names.has(x.name) ? undefined : `uses ${x.name}, which is not a setting`;
      case 'list':
        for (const it of x.items) {
          if (it.kind !== 'item') return 'uses a list comprehension';
          const b = bad(it.expr);
          if (b) return b;
        }
        return undefined;
      case 'unary':
        return CONDITION_OPS.has(x.op) ? bad(x.arg) : `uses ${x.op}`;
      case 'binary':
        return CONDITION_OPS.has(x.op) ? (bad(x.left) ?? bad(x.right)) : `uses ${x.op}`;
      case 'ternary':
        return bad(x.cond) ?? bad(x.then) ?? bad(x.else);
      case 'index':
        return bad(x.target) ?? bad(x.index);
      default:
        return 'uses more than settings, values and operators';
    }
  };
  const b = bad(e);
  return b ? `its condition (${text}) ${b}` : undefined;
}

// Whether a setting applies with the settings at `values` (missing ones at
// their initial values): its `when` condition holds, or it has none
export function shown(
  param: Parameter,
  values: Record<string, Value>,
  params: Parameter[],
): boolean {
  if (param.when === undefined) return true;
  // The condition runs as the language runs it, the settings at the values
  // chosen so far and the others at their initial values. One that can't
  // be worked out shows the setting.
  const initial = Object.fromEntries(params.map((p) => [p.name, p.initial]));
  const chosen = Object.fromEntries(
    Object.entries(values).filter(([k]) => Object.prototype.hasOwnProperty.call(initial, k)),
  );
  try {
    const source = [...params.map((p) => `${p.name} = undef;`), `echo((${param.when}) ? 1 : 0);`];
    const r = new Evaluator({ overrides: { ...initial, ...chosen }, maxSteps: 100_000 }).run(
      parse(source.join(String.fromCharCode(10))).program,
    );
    return r.echoes[0] !== '0';
  } catch {
    return true;
  }
}
