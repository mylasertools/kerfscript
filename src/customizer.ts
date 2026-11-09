// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import type { Expr } from './ast.js';
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
    const m = inline ? /^\[(.*)\](\s+drive)?$/.exec(inline.trim()) : null;
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
  return { parameters: out };
}
