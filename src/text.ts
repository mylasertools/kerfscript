// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import { parse as parseFont } from 'opentype.js';
import { area, bounds, intersection, offset, pieces, union, type Poly } from './geometry.js';
import { flatten, type Cmd } from './paths.js';
import { own } from './values.js';

export type FontSource = ArrayBuffer | Uint8Array;

interface OtFont {
  getPath(text: string, x: number, y: number, size: number, options?: object): { commands: Cmd[] };
  getAdvanceWidth(text: string, size: number, options?: object): number;
  ascender: number;
  descender: number;
  unitsPerEm: number;
  tables?: { os2?: { sCapHeight?: number } };
}

// The height of a capital letter: the font's own figure, or the height of H
function capHeight(font: OtFont, size: number): number {
  const c = font.tables?.os2?.sCapHeight;
  if (c && c > 0) return (c / font.unitsPerEm) * size;
  const b = bounds(
    outlines(font, 'H', { size, font: '', halign: 'left', valign: 'baseline', spacing: 1 }).polys,
  );
  return b ? b[3] : (font.ascender / font.unitsPerEm) * size;
}

export class FontBook {
  private parsed = new Map<string, OtFont>();
  readonly missing = new Set<string>();
  constructor(
    private sources: Record<string, FontSource>,
    private fallback?: string,
  ) {}

  names(): string[] {
    return Object.keys(this.sources);
  }

  get(name: string): OtFont {
    const key = name || this.fallback || Object.keys(this.sources)[0];
    if (!key) {
      this.missing.add('');
      throw new Error(
        'text() needs a font. Pass fonts to render(), or --font on the command line.',
      );
    }
    const hit = this.parsed.get(key);
    if (hit) return hit;
    const src = own(this.sources, key);
    if (!src) {
      this.missing.add(key);
      throw new Error(
        `Font "${key}" is not available.${this.names().length ? ` Available fonts: ${this.names().join(', ')}` : ''}`,
      );
    }
    const buf =
      src instanceof Uint8Array
        ? src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength)
        : src;
    const font = parseFont(buf as ArrayBuffer) as unknown as OtFont;
    this.parsed.set(key, font);
    return font;
  }
}

export interface TextOptions {
  size: number;
  font: string;
  halign: string;
  valign: string;
  spacing: number;
}

function layoutCommands(
  font: OtFont,
  text: string,
  o: TextOptions,
): { cmds: Cmd[]; advance: number } {
  const opts = { kerning: true };
  if (o.spacing === 1) {
    const path = font.getPath(text, 0, 0, o.size, opts);
    return { cmds: path.commands, advance: font.getAdvanceWidth(text, o.size, opts) };
  }
  const cmds: Cmd[] = [];
  let x = 0;
  const chars = [...text];
  chars.forEach((ch, i) => {
    cmds.push(...font.getPath(ch, x, 0, o.size, opts).commands);
    x += font.getAdvanceWidth(ch, o.size, opts) * (i < chars.length - 1 ? o.spacing : 1);
  });
  return { cmds, advance: x };
}

// The glyph outlines of the text as polygons, y up, before they are joined
function outlines(font: OtFont, text: string, o: TextOptions): { polys: Poly[]; advance: number } {
  const { cmds, advance } = layoutCommands(font, text, o);
  const flipped = cmds.map((c): Cmd => {
    if (c.type === 'Z') return c;
    if (c.type === 'C') return { ...c, y1: -c.y1, y2: -c.y2, y: -c.y };
    if (c.type === 'Q') return { ...c, y1: -c.y1, y: -c.y };
    return { ...c, y: -c.y };
  });
  const flat = flatten(flipped, Math.max(0.005, o.size / 2000));
  return { polys: [...flat.closed, ...flat.open.filter((p) => p.length >= 3)], advance };
}

export function textRegions(book: FontBook, text: string, o: TextOptions): Poly[] {
  if (!text) return [];
  const font = book.get(o.font);
  const { polys: raw, advance } = outlines(font, text, o);
  const polys = union(raw);
  const b = bounds(polys);
  if (!b) return [];
  const dx = o.halign === 'center' ? -advance / 2 : o.halign === 'right' ? -advance : 0;
  const dy =
    o.valign === 'top'
      ? -b[3]
      : o.valign === 'center'
        ? -(b[1] + b[3]) / 2
        : o.valign === 'bottom'
          ? -b[1]
          : o.valign === 'cap'
            ? -capHeight(font, o.size) / 2
            : 0;
  return polys.map((p) => p.map(([x, y]): [number, number] => [x + dx, y + dy]));
}

export function textMetrics(book: FontBook, text: string, o: TextOptions) {
  const font = book.get(o.font);
  const { polys, advance } = outlines(font, text, o);
  // The outlines have the same bounds as the shape they make, which is much
  // slower to work out for long text
  const b = bounds(polys) ?? [0, 0, 0, 0];
  return {
    advance,
    bounds: [
      [b[0], b[1]],
      [b[2], b[3]],
    ],
    ascent: (font.ascender / font.unitsPerEm) * o.size,
    descent: (font.descender / font.unitsPerEm) * o.size,
    cap: capHeight(font, o.size),
  };
}

// The point `s` along a path and its direction there, carrying on past
// either end along the first or last segment
function walk(path: [number, number][], cum: number[], s: number) {
  let i = 0;
  while (i < path.length - 2 && cum[i + 1] < s) i++;
  const [a, b] = [path[i], path[i + 1]];
  const l = cum[i + 1] - cum[i];
  const u = (s - cum[i]) / l;
  const t: [number, number] = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  return { at: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u] as [number, number], t };
}

/** The text laid along a path: each letter where its middle falls along
 * the path, turned to the path's direction there, its baseline on the
 * path. halign puts the text's start, middle or end at the path's.
 * `over` is how far the text runs past the path's ends, 0 when it fits. */
export function textAlong(
  book: FontBook,
  text: string,
  o: TextOptions,
  points: [number, number][],
): { polys: Poly[]; over: number } {
  const path = points.filter(
    ([x, y], k) => k === 0 || x !== points[k - 1][0] || y !== points[k - 1][1],
  );
  if (!text || path.length < 2) return { polys: [], over: 0 };
  const font = book.get(o.font);
  const opts = { kerning: true };
  const chars = [...text];
  // Where each letter starts along the text, kerning and spacing as text()
  // lays it out in a line
  const starts: number[] = [];
  let x = 0;
  chars.forEach((ch, i) => {
    // Kerning moves a letter against the one before it: its start is the
    // text up to it less its own advance
    starts.push(
      o.spacing === 1
        ? font.getAdvanceWidth(chars.slice(0, i + 1).join(''), o.size, opts) -
            font.getAdvanceWidth(ch, o.size, opts)
        : x,
    );
    x += font.getAdvanceWidth(ch, o.size, opts) * (i < chars.length - 1 ? o.spacing : 1);
  });
  const total = o.spacing === 1 ? font.getAdvanceWidth(text, o.size, opts) : x;
  // The text's own height decides valign, as for a line of it
  const all = bounds(outlines(font, text, o).polys);
  if (!all) return { polys: [], over: 0 };
  const dy =
    o.valign === 'top'
      ? -all[3]
      : o.valign === 'center'
        ? -(all[1] + all[3]) / 2
        : o.valign === 'bottom'
          ? -all[1]
          : o.valign === 'cap'
            ? -capHeight(font, o.size) / 2
            : 0;
  const cum = [0];
  for (let i = 1; i < path.length; i++)
    cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const length = cum[cum.length - 1];
  const start =
    o.halign === 'center' ? (length - total) / 2 : o.halign === 'right' ? length - total : 0;
  const out: Poly[] = [];
  chars.forEach((ch, i) => {
    const w = font.getAdvanceWidth(ch, o.size, opts);
    const { at, t } = walk(path, cum, start + starts[i] + w / 2);
    const n: [number, number] = [-t[1], t[0]];
    for (const p of outlines(font, ch, o).polys)
      out.push(
        p.map(([gx, gy]): [number, number] => {
          const u = gx - w / 2;
          const v = gy + dy;
          return [at[0] + u * t[0] + v * n[0], at[1] + u * t[1] + v * n[1]];
        }),
      );
  });
  return { polys: union(out), over: Math.max(0, -start, start + total - length) };
}

/** A circle of radius |r| round the origin as a path for text: r > 0
 * goes clockwise, its middle at the top, for text on the outside reading
 * round; r < 0 goes anticlockwise, its middle at the bottom, for text
 * along the bottom reading left to right */
export function arcPath(r: number): [number, number][] {
  const a = Math.abs(r);
  const n = Math.min(720, Math.max(72, Math.ceil((2 * Math.PI * a) / 0.5)));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = r > 0 ? 1.5 * Math.PI - (2 * Math.PI * i) / n : 0.5 * Math.PI + (2 * Math.PI * i) / n;
    return [a * Math.cos(t), a * Math.sin(t)] as [number, number];
  });
}

/** Text with its letters welded into one piece, as script names are cut:
 * within each word a letter that does not touch the one before slides
 * back until it overlaps it by `overlap` mm (a tenth of the size, and
 * at least 1.5, by default); `underline` (a height) adds a bar
 * under the baseline joining the words. `loose` lists the letters left
 * as pieces of their own, as an i's dot. */
export function textWeld(
  book: FontBook,
  text: string,
  o: TextOptions,
  underline = 0,
  overlap?: number,
): { polys: Poly[]; loose: string[] } {
  if (!text) return { polys: [], loose: [] };
  const font = book.get(o.font);
  const opts = { kerning: true };
  const chars = [...text];
  // Deep enough that the joint is strong enough to cut
  const depth = overlap ?? Math.max(o.size * 0.1, 1.5);
  const maxSlide = o.size * 0.6;
  const placed: { ch: string; polys: Poly[] }[] = [];
  let word: Poly[] = [];
  let shift = 0;
  let x = 0;
  const moved = (polys: Poly[], dx: number) =>
    polys.map((p) => p.map(([px, py]): [number, number] => [px + dx, py]));
  const touch = (a: Poly[], b: Poly[]) => intersection(a, b).length > 0;
  chars.forEach((ch, i) => {
    const start =
      o.spacing === 1
        ? font.getAdvanceWidth(chars.slice(0, i + 1).join(''), o.size, opts) -
          font.getAdvanceWidth(ch, o.size, opts)
        : x;
    x += font.getAdvanceWidth(ch, o.size, opts) * (i < chars.length - 1 ? o.spacing : 1);
    if (/\s/.test(ch)) {
      word = [];
      return;
    }
    const glyph = union(outlines(font, ch, o).polys);
    if (!glyph.length) return;
    let here = moved(glyph, start + shift);
    if (word.length && !touch(word, here)) {
      // The least slide back that makes it touch, then `depth` more
      let [lo, hi] = [0, maxSlide];
      if (touch(word, moved(here, -hi))) {
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) / 2;
          if (touch(word, moved(here, -mid))) hi = mid;
          else lo = mid;
        }
        const slide = Math.min(maxSlide, hi + depth);
        shift -= slide;
        here = moved(here, -slide);
      }
    }
    word = union([...word, ...here]);
    placed.push({ ch, polys: here });
  });
  // The notches where letters meet filled round, so the joints are not
  // thin wedges
  let polys = offset(offset(union(placed.flatMap((p) => p.polys)), 0.8, 'round'), -0.8, 'round');
  const b = bounds(polys);
  if (!b) return { polys: [], loose: [] };
  if (underline > 0)
    polys = union([
      ...polys,
      [
        [b[0], -underline * 0.6],
        [b[2], -underline * 0.6],
        [b[2], underline * 0.4],
        [b[0], underline * 0.4],
      ],
    ]);
  // The pieces besides the biggest, by the letter each is mostly in
  const groups = pieces(polys);
  const size = (g: Poly[]) => g.reduce((s, r) => s + Math.abs(area(r)), 0);
  const biggest = groups.reduce((best, g) => (size(g) > size(best) ? g : best), groups[0]);
  const loose = groups
    .filter((g) => g !== biggest)
    .map((g) => {
      const at = placed.find((p) => intersection(p.polys, g).length);
      return at ? at.ch : '?';
    });
  // halign and valign by the welded ink
  const c = bounds(polys)!;
  const dx = o.halign === 'center' ? -(c[0] + c[2]) / 2 : o.halign === 'right' ? -c[2] : -c[0];
  const dy =
    o.valign === 'top'
      ? -c[3]
      : o.valign === 'center'
        ? -(c[1] + c[3]) / 2
        : o.valign === 'bottom'
          ? -c[1]
          : o.valign === 'cap'
            ? -capHeight(font, o.size) / 2
            : 0;
  return {
    polys: polys.map((p) => p.map(([px, py]): [number, number] => [px + dx, py + dy])),
    loose,
  };
}
