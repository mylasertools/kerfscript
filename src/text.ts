// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import { parse as parseFont } from 'opentype.js';
import { bounds, union, type Poly } from './geometry.js';
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
