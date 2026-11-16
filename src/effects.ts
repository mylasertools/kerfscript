// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// What each setting of a program changes: it is rendered at a few values
// across its range, the others at their initial values, and the files and
// the assembled view are compared. A setting that changes nothing, or that
// stops changing anything over part of its range, is a slider that people
// move to no effect.

import { parameters, shown, type Parameter } from './customizer.js';
import { render, type RenderOptions, type RenderResult } from './render.js';
import type { Value } from './values.js';

export interface SettingEffect {
  name: string;
  /** The values tried, in order */
  tried: Value[];
  /** "files": what is cut changes (the files, the sheets' material and
   * thickness, or the parts list); "view": only the assembled view, the
   * steps or the hardware; "nothing": neither; "failed": the program stops
   * at all values but one, or all of them; "skipped": not tried */
  effect: 'files' | 'view' | 'nothing' | 'failed' | 'skipped';
  /** Values tried that give the same files and view: for a range, each
   * run of neighbouring values; for a menu, each group of choices */
  same?: Value[][];
  /** Values the program stops at, with the error */
  errors?: { value: Value; message: string }[];
  /** Why the setting was not tried */
  reason?: string;
}

// A short fingerprint of a string, to compare renders without keeping them
function hash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}${s.length}`;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

const roundPolys = (polys: [number, number][][]) =>
  polys.map((p) => p.map(([x, y]) => [round(x), round(y)]));

// What is cut, from what (the files, each sheet's size, material and
// thickness, and the parts list), and what the assembled view shows (each
// part's own outline, marks, thickness and placement, the hardware and the
// steps)
function fingerprints(r: RenderResult): { files: string; view: string } {
  const files = JSON.stringify([
    r.sheets.map((s) => [s.svg, s.back?.svg ?? '', s.width, s.height, s.material, s.thickness]),
    r.parts.map((p) => [
      p.name,
      p.qty,
      p.thickness,
      p.material,
      p.kerf,
      p.stack,
      p.glued,
      p.mirrored,
    ]),
  ]);
  const view = JSON.stringify([
    [...r.assembly, ...r.flat].map((a) => [
      a.name,
      a.copy,
      a.placed,
      a.thickness,
      a.material,
      a.matrix.map(round),
      a.bends,
      a.step,
      roundPolys(a.outline),
      (a.marks ?? []).map((m) => [m.layer, m.side, roundPolys(m.regions), roundPolys(m.lines)]),
    ]),
    r.hardware,
    r.steps,
  ]);
  return { files: hash(files), view: hash(view) };
}

// The values a setting is tried at: the ends and three points between of
// a range, every choice of a menu, both ways for a checkbox, and for text
// a shorter and a different text
function valuesOf(p: Parameter, samples: number): Value[] | string {
  const v = p.initial;
  if (p.options) return p.options.map((o) => o.value);
  if (p.type === 'boolean') return [true, false];
  if (p.type === 'string') {
    const s = String(v ?? '');
    if (!s) return ['', 'Sample'];
    const rev = [...s].reverse().join('');
    return [...new Set([s, s.slice(0, Math.ceil(s.length / 2)), rev === s ? s + s : rev])];
  }
  if (Array.isArray(v)) return 'a list of numbers';
  if (typeof v !== 'number') return 'not a number, text or choice';
  if (p.min === undefined || p.max === undefined || !(p.max > p.min)) {
    const d = Math.abs(v) > 0 ? Math.abs(v) / 2 : 1;
    return [v - d, v, v + d];
  }
  const snap = (x: number) =>
    p.step ? round(p.min! + Math.round((x - p.min!) / p.step) * p.step) : round(x);
  const out = Array.from({ length: samples }, (_, i) =>
    snap(p.min! + ((p.max! - p.min!) * i) / (samples - 1)),
  );
  return [...new Set([...out, v])].sort((a, b) => a - b);
}

/** What each setting of the program changes. `samples` is how many values
 * of a range are tried (5). */
export function settingEffects(
  source: string,
  options: RenderOptions = {},
  samples = 5,
): SettingEffect[] {
  const params = parameters(source).parameters;
  const base = { ...options.params };
  const out: SettingEffect[] = [];
  for (const p of params) {
    if (p.drive) {
      out.push({ name: p.name, tried: [], effect: 'skipped', reason: 'it drives the motion' });
      continue;
    }
    if (!shown(p, base, params)) {
      out.push({
        name: p.name,
        tried: [],
        effect: 'skipped',
        reason: `it applies only when ${p.when}`,
      });
      continue;
    }
    const values = valuesOf(p, Math.max(3, samples));
    if (typeof values === 'string') {
      out.push({ name: p.name, tried: [], effect: 'skipped', reason: `it is ${values}` });
      continue;
    }
    const prints: ({ files: string; view: string } | null)[] = [];
    const errors: { value: Value; message: string }[] = [];
    for (const value of values) {
      try {
        prints.push(
          fingerprints(render(source, { ...options, params: { ...base, [p.name]: value } })),
        );
      } catch (e) {
        prints.push(null);
        errors.push({ value, message: (e as Error).message });
      }
    }
    const ok = prints.filter((x): x is { files: string; view: string } => x !== null);
    const files = new Set(ok.map((x) => x.files)).size > 1;
    const view = new Set(ok.map((x) => `${x.files} ${x.view}`)).size > 1;
    const effect: SettingEffect = {
      name: p.name,
      tried: values,
      effect: ok.length < 2 ? 'failed' : files ? 'files' : view ? 'view' : 'nothing',
      ...(errors.length && { errors }),
    };
    // Runs of neighbouring values that give the same result, in a setting
    // that does change something
    if (effect.effect === 'files' || effect.effect === 'view') {
      const key = (i: number) => (prints[i] ? `${prints[i]!.files} ${prints[i]!.view}` : `x${i}`);
      const same: Value[][] = [];
      if (p.options) {
        const groups = new Map<string, Value[]>();
        values.forEach((v, i) => groups.set(key(i), [...(groups.get(key(i)) ?? []), v]));
        for (const [k, g] of groups) if (g.length > 1 && !k.startsWith('x')) same.push(g);
      } else {
        let start = 0;
        for (let i = 1; i <= values.length; i++)
          if (i === values.length || key(i) !== key(start)) {
            if (i - start > 1 && prints[start]) same.push(values.slice(start, i));
            start = i;
          }
      }
      if (same.length) effect.same = same;
    }
    out.push(effect);
  }
  return out;
}

/** The effects as lines to read, and whether any setting changes nothing
 * or fails */
export function effectsText(effects: SettingEffect[]): { lines: string[]; idle: boolean } {
  const show = (v: Value) => JSON.stringify(v);
  const lines: string[] = ['Each setting tried across its range, the others as they are:'];
  let idle = false;
  for (const e of effects) {
    if (e.effect === 'skipped') {
      lines.push(`${e.name}: not tried, as ${e.reason}`);
      continue;
    }
    if (e.effect === 'failed') {
      idle = true;
      lines.push(
        `${e.name}: the program stops at ${e.errors?.length ?? 0} of the ${e.tried.length} values tried`,
      );
    } else if (e.effect === 'nothing') {
      idle = true;
      lines.push(`${e.name}: changes nothing at ${e.tried.map(show).join(', ')}`);
    } else if (e.effect === 'view')
      lines.push(`${e.name}: changes only the assembled view, not the files`);
    else lines.push(`${e.name}: changes the files`);
    for (const g of e.same ?? [])
      lines.push(
        typeof g[0] === 'number'
          ? `  from ${show(g[0])} to ${show(g[g.length - 1])} it changes nothing`
          : `  ${g.slice(0, -1).map(show).join(', ')} and ${show(g[g.length - 1])} give the same result`,
      );
    for (const x of e.errors ?? []) lines.push(`  at ${show(x.value)}: ${x.message}`);
  }
  return { lines, idle };
}
