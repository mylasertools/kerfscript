// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Reads an SVG file into outlines in millimetres, y up, each with the layer
// its colour or its group name stands for.

import { apply, multiply, IDENTITY, type Matrix, type Pt } from '../geometry.js';
import { parseSvgPath as parsePath, type Cmd } from '../paths.js';
import { parseXml, type XmlElement } from './xml.js';

export type Seg = { c: 'L'; a: Pt; b: Pt } | { c: 'C'; a: Pt; p1: Pt; p2: Pt; b: Pt };

export interface Sub {
  segs: Seg[];
  closed: boolean;
}

export interface LayerRef {
  name: string;
  mode: 'cut' | 'line' | 'fill' | 'guide';
  color: string;
}

export interface Item {
  subs: Sub[];
  layer: LayerRef;
  fillRule: 'nonzero' | 'evenodd';
  // Names from the element and the groups around it, nearest first
  names: string[];
  // Cut because it is filled, in a drawing without lines: a piece on its
  // own, with holes only from its own subpaths
  filled?: boolean;
}

export interface TextItem {
  text: string;
  at: Pt;
  size: number;
  angle: number;
  font: string;
  anchor: 'left' | 'center' | 'right';
  layer: LayerRef;
}

export interface SvgDrawing {
  items: Item[];
  texts: TextItem[];
  notes: string[];
}

export interface ReadOptions {
  // Pixels per inch for files measured in px; 96 unless the file says
  // otherwise. Adobe Illustrator files use 72.
  dpi?: number;
}

export const LAYERS: Record<string, LayerRef> = {
  cut: { name: 'cut', mode: 'cut', color: '#ff0000' },
  score: { name: 'score', mode: 'line', color: '#0000ff' },
  engrave: { name: 'engrave', mode: 'fill', color: '#000000' },
  guide: { name: 'guide', mode: 'guide', color: '#00a0ff' },
};

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  lime: '#00ff00',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  aqua: '#00ffff',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  navy: '#000080',
  olive: '#808000',
  purple: '#800080',
  teal: '#008080',
  orange: '#ffa500',
};

const COLOR_NAMES = Object.fromEntries(
  Object.entries(NAMED)
    .reverse()
    .map(([k, v]) => [v, k]),
);

// '#rrggbb', 'none', or 'paint' for gradients and patterns
function color(v: string | undefined, current: string): string | undefined {
  if (v === undefined) return undefined;
  v = v.trim().toLowerCase();
  if (v === 'none' || v === 'transparent') return 'none';
  if (v === 'currentcolor') return current;
  if (v.startsWith('url(')) return 'paint';
  if (NAMED[v]) return NAMED[v];
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4)
      return '#' + [...h.slice(0, 3)].map((c) => c + c).join('');
    if (h.length === 6 || h.length === 8) return '#' + h.slice(0, 6);
  }
  m = /^rgba?\(([^)]*)\)$/.exec(v);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const ch = parts.slice(0, 3).map((p) => {
        const n = p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p);
        return Math.max(0, Math.min(255, Math.round(n || 0)));
      });
      if (parts[3] !== undefined && parseFloat(parts[3]) === 0) return 'none';
      return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
    }
  }
  return '#000000';
}

// Arcs as curves of 15 degrees at most, so circles keep their size closely
const parseSvgPath = (d: string) => parsePath(d, Math.PI / 12);

const numbers = (s: string) =>
  (s.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);

export function parseTransform(s: string | undefined): Matrix {
  let m: Matrix = IDENTITY;
  if (!s) return m;
  for (const [, fn, args] of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = numbers(args);
    const rad = ((a[0] ?? 0) * Math.PI) / 180;
    let t: Matrix = IDENTITY;
    if (fn === 'matrix' && a.length === 6) t = a as Matrix;
    else if (fn === 'translate') t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === 'scale') t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const c = Math.cos(rad),
        sn = Math.sin(rad);
      const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
      t = [c, sn, -sn, c, cx - c * cx + sn * cy, cy - sn * cx - c * cy];
    } else if (fn === 'skewX') t = [1, 0, Math.tan(rad), 1, 0, 0];
    else if (fn === 'skewY') t = [1, Math.tan(rad), 0, 1, 0, 0];
    m = multiply(m, t);
  }
  return m;
}

function cmdsToSubs(cmds: Cmd[], m: Matrix): Sub[] {
  const out: Sub[] = [];
  let segs: Seg[] = [];
  let start: Pt = [0, 0];
  let last: Pt = [0, 0];
  const p = (x: number, y: number) => apply(m, [x, y]);
  const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  const flush = (closed: boolean) => {
    if (segs.length) out.push({ segs, closed });
    segs = [];
  };
  for (const c of cmds) {
    if (c.type === 'M') {
      flush(false);
      start = last = p(c.x, c.y);
    } else if (c.type === 'L') {
      const b = p(c.x, c.y);
      if (!same(last, b)) segs.push({ c: 'L', a: last, b });
      last = b;
    } else if (c.type === 'Q') {
      const q = p(c.x1, c.y1);
      const b = p(c.x, c.y);
      segs.push({
        c: 'C',
        a: last,
        p1: [last[0] + (2 / 3) * (q[0] - last[0]), last[1] + (2 / 3) * (q[1] - last[1])],
        p2: [b[0] + (2 / 3) * (q[0] - b[0]), b[1] + (2 / 3) * (q[1] - b[1])],
        b,
      });
      last = b;
    } else if (c.type === 'C') {
      const b = p(c.x, c.y);
      segs.push({ c: 'C', a: last, p1: p(c.x1, c.y1), p2: p(c.x2, c.y2), b });
      last = b;
    } else {
      if (segs.length && !same(last, start)) segs.push({ c: 'L', a: last, b: start });
      flush(true);
      last = start;
    }
  }
  flush(false);
  return out;
}

const STYLE_PROPS = [
  'fill',
  'stroke',
  'stroke-width',
  'fill-rule',
  'display',
  'visibility',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'color',
  'font-size',
  'font-family',
  'text-anchor',
];
const INHERITED = new Set([
  'fill',
  'stroke',
  'stroke-width',
  'fill-rule',
  'visibility',
  'fill-opacity',
  'stroke-opacity',
  'color',
  'font-size',
  'font-family',
  'text-anchor',
]);

type Style = Record<string, string>;

interface Rule {
  tag?: string;
  id?: string;
  classes: string[];
  decls: Style;
}

function declarations(s: string): Style {
  const out: Style = {};
  for (const d of s.split(';')) {
    const i = d.indexOf(':');
    if (i < 0) continue;
    const k = d.slice(0, i).trim().toLowerCase();
    const v = d
      .slice(i + 1)
      .replace(/!important/i, '')
      .trim();
    if (k && v) out[k] = v;
  }
  return out;
}

function parseCss(css: string): Rule[] {
  const rules: Rule[] = [];
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, sel, body] of css.matchAll(/([^{}@]+)\{([^}]*)\}/g)) {
    const decls = declarations(body);
    for (const one of sel.split(',')) {
      const s = one.trim();
      const m = /^([a-zA-Z][\w-]*|\*)?((?:[.#][\w-]+)*)$/.exec(s);
      if (!m) continue;
      const classes: string[] = [];
      let id: string | undefined;
      for (const [, kind, name] of m[2].matchAll(/([.#])([\w-]+)/g))
        if (kind === '.') classes.push(name);
        else id = name;
      rules.push({ tag: m[1] && m[1] !== '*' ? m[1] : undefined, id, classes, decls });
    }
  }
  return rules;
}

function unitScale(unit: string, dpi: number): number {
  switch (unit) {
    case 'mm':
      return 1;
    case 'cm':
      return 10;
    case 'in':
      return 25.4;
    case 'pt':
      return 25.4 / 72;
    case 'pc':
      return 25.4 / 6;
    case 'q':
      return 0.25;
    default:
      return 25.4 / dpi;
  }
}

function length(v: string | undefined, dpi: number): number | undefined {
  if (!v) return undefined;
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*([a-zA-Z%]*)\s*$/.exec(v);
  if (!m || m[2] === '%') return undefined;
  return Number(m[1]) * unitScale(m[2].toLowerCase(), dpi);
}

const AUTO_NAME =
  /^(path|g|rect|circle|ellipse|line|polyline|polygon|layer|svg|use|text|tspan|group|shape|cls|clip|mask|defs|_?x?\d|Layer_\d|Ebene|Calque|Capa|Livello|Laag|Warstwa)[-_ ]*[\d-]*$/i;

function nameOf(el: XmlElement): string | undefined {
  for (const k of ['data-part', 'inkscape:label', 'data-name', 'id']) {
    const v = el.attrs[k]?.trim();
    if (v && !AUTO_NAME.test(v) && !/^[\d_-]+$/.test(v)) return v.replace(/_x5F_|_/g, ' ').trim();
  }
  return undefined;
}

// The layer a group's name stands for, if it names one
function layerByName(name: string | undefined): LayerRef | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase();
  if (/\bscor|\bscoring/.test(n)) return LAYERS.score;
  if (/engrav|raster|etch/.test(n)) return LAYERS.engrave;
  if (/\bguide/.test(n)) return LAYERS.guide;
  if (/^cut|\bcut\b|cutting|\bcuts\b/.test(n)) return LAYERS.cut;
  return undefined;
}

interface Raw {
  subs: Sub[];
  stroke?: string;
  fill?: string;
  fillRule: 'nonzero' | 'evenodd';
  layer?: LayerRef;
  names: string[];
}

interface RawText extends Omit<TextItem, 'layer'> {
  stroke?: string;
  fill?: string;
  layer?: LayerRef;
}

export function readSvg(src: string, opts: ReadOptions = {}): SvgDrawing {
  src = src.replace(/^\uFEFF/, '');
  if (!/^\s*</.test(src) || src.includes('\0'))
    throw new Error('This is not an SVG file: it does not start with a tag');
  const doc = parseXml(src);
  const root = doc.root;
  if (root.name.replace(/^.*:/, '') !== 'svg') throw new Error('This is not an SVG file');
  const notes: string[] = [];
  const illustrator = doc.comments.some((c) => /Adobe Illustrator/i.test(c));
  const dpi = opts.dpi ?? (illustrator ? 72 : 96);
  if (opts.dpi === undefined && illustrator)
    notes.push('Adobe Illustrator file: px measured at 72 per inch.');

  // Page size and the matrix from user units to millimetres, y up
  const vb = numbers(root.attrs.viewBox ?? '');
  const w = length(root.attrs.width, dpi);
  const h = length(root.attrs.height, dpi);
  const px = 25.4 / dpi;
  let sx = px,
    sy = px,
    ox = 0,
    oy = 0;
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    sx = w !== undefined ? w / vb[2] : h !== undefined ? h / vb[3] : px;
    sy = h !== undefined ? h / vb[3] : sx;
    ox = vb[0];
    oy = vb[1];
  }
  if (w === undefined && h === undefined && opts.dpi === undefined && !illustrator)
    notes.push(`The file gives no page size in mm or inches: px measured at ${dpi} per inch.`);
  const pageH = h ?? (vb.length === 4 ? vb[3] * sy : 0);
  const base: Matrix = multiply([1, 0, 0, -1, 0, pageH], [sx, 0, 0, sy, -ox * sx, -oy * sy]);

  // Stylesheets and elements by id, for <use>
  const rules: Rule[] = [];
  const byId = new Map<string, XmlElement>();
  const index = (el: XmlElement) => {
    if (el.name === 'style') rules.push(...parseCss(el.text));
    if (el.attrs.id) byId.set(el.attrs.id, el);
    el.children.forEach(index);
  };
  index(root);

  const styleOf = (el: XmlElement, parent: Style): Style => {
    const s: Style = {};
    for (const k of Object.keys(parent)) if (INHERITED.has(k)) s[k] = parent[k];
    for (const k of STYLE_PROPS) if (el.attrs[k] !== undefined) s[k] = el.attrs[k];
    const classes = (el.attrs.class ?? '').split(/\s+/).filter(Boolean);
    for (const r of rules)
      if (
        (!r.tag || r.tag === el.name) &&
        (!r.id || r.id === el.attrs.id) &&
        r.classes.every((c) => classes.includes(c))
      )
        Object.assign(s, r.decls);
    if (el.attrs.style) Object.assign(s, declarations(el.attrs.style));
    return s;
  };

  const raws: Raw[] = [];
  const rawTexts: RawText[] = [];
  let skippedImages = 0;
  let skippedHidden = 0;
  const SKIP = new Set([
    'defs',
    'clipPath',
    'mask',
    'pattern',
    'marker',
    'symbol',
    'metadata',
    'title',
    'desc',
    'style',
    'script',
    'linearGradient',
    'radialGradient',
    'filter',
    'sodipodi:namedview',
    'foreignObject',
  ]);

  const shapeCmds = (el: XmlElement): Cmd[] | undefined => {
    const a = (k: string) => parseFloat(el.attrs[k] ?? '0') || 0;
    switch (el.name) {
      case 'path':
        return parseSvgPath(el.attrs.d ?? '');
      case 'rect': {
        const [x, y, rw, rh] = [a('x'), a('y'), a('width'), a('height')];
        if (rw <= 0 || rh <= 0) return [];
        let rx = el.attrs.rx !== undefined ? a('rx') : el.attrs.ry !== undefined ? a('ry') : 0;
        let ry = el.attrs.ry !== undefined ? a('ry') : rx;
        rx = Math.min(Math.abs(rx), rw / 2);
        ry = Math.min(Math.abs(ry), rh / 2);
        if (rx <= 0 || ry <= 0) return parseSvgPath(`M${x} ${y}H${x + rw}V${y + rh}H${x}Z`);
        return parseSvgPath(
          `M${x + rx} ${y}H${x + rw - rx}A${rx} ${ry} 0 0 1 ${x + rw} ${y + ry}V${y + rh - ry}` +
            `A${rx} ${ry} 0 0 1 ${x + rw - rx} ${y + rh}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + rh - ry}` +
            `V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`,
        );
      }
      case 'circle':
      case 'ellipse': {
        const [cx, cy] = [a('cx'), a('cy')];
        const rx = el.name === 'circle' ? a('r') : a('rx');
        const ry = el.name === 'circle' ? a('r') : el.attrs.ry !== undefined ? a('ry') : rx;
        if (rx <= 0 || ry <= 0) return [];
        return parseSvgPath(
          `M${cx + rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy + ry}A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}` +
            `A${rx} ${ry} 0 0 1 ${cx} ${cy - ry}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}Z`,
        );
      }
      case 'line':
        return parseSvgPath(`M${a('x1')} ${a('y1')}L${a('x2')} ${a('y2')}`);
      case 'polyline':
      case 'polygon': {
        const n = numbers(el.attrs.points ?? '');
        if (n.length < 4) return [];
        let d = `M${n[0]} ${n[1]}`;
        for (let i = 2; i + 1 < n.length; i += 2) d += `L${n[i]} ${n[i + 1]}`;
        return parseSvgPath(el.name === 'polygon' ? d + 'Z' : d);
      }
    }
    return undefined;
  };

  const textOf = (el: XmlElement): string =>
    (el.text + el.children.map((c) => (c.name === 'tspan' ? ' ' + textOf(c) : '')).join(''))
      .replace(/\s+/g, ' ')
      .trim();

  const walk = (
    el: XmlElement,
    m: Matrix,
    parent: Style,
    layer: LayerRef | undefined,
    names: string[],
    depth: number,
  ) => {
    if (depth > 64 || SKIP.has(el.name)) return;
    const style = styleOf(el, parent);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      if (el.children.length || shapeCmds(el)) skippedHidden++;
      return;
    }
    let mm = multiply(m, parseTransform(el.attrs.transform));
    const own = nameOf(el);
    const isLayer = el.attrs['inkscape:groupmode'] === 'layer';
    let here = layer;
    if (el.name === 'g' || el.name === 'svg' || el.name === 'a' || el.name === 'switch') {
      const label = el.attrs['inkscape:label'] ?? el.attrs['data-name'] ?? el.attrs.id;
      const known = layerByName(label);
      if (el.attrs['data-mode'] && label && /^(cut|line|fill|guide)$/.test(el.attrs['data-mode'])) {
        const stroke = color(style.stroke, '#000000');
        const fill = color(style.fill, '#000000');
        const col = el.attrs['data-mode'] === 'fill' ? fill : stroke;
        here = LAYERS[label] ?? {
          name: label,
          mode: el.attrs['data-mode'] as LayerRef['mode'],
          color: col && col.startsWith('#') ? col : '#00aa00',
        };
      } else if (known) here = known;
      if (el !== root && el.name === 'svg') {
        const a = (k: string) => parseFloat(el.attrs[k] ?? '0') || 0;
        mm = multiply(mm, [1, 0, 0, 1, a('x'), a('y')]);
      }
      const kids = isLayer || known || el === root || !own ? names : [own, ...names];
      for (const c of el.children) walk(c, mm, style, here, kids, depth + 1);
      return;
    }
    if (el.name === 'use') {
      const ref = byId.get((el.attrs.href ?? el.attrs['xlink:href'] ?? '').replace(/^#/, ''));
      if (!ref) return;
      const a = (k: string) => parseFloat(el.attrs[k] ?? '0') || 0;
      const t = multiply(mm, [1, 0, 0, 1, a('x'), a('y')]);
      const target = ref.name === 'symbol' ? { ...ref, name: 'g' } : ref;
      walk(target, t, style, here, own ? [own, ...names] : names, depth + 1);
      return;
    }
    if (el.name === 'image') {
      skippedImages++;
      return;
    }
    const cur = color(style.color, '#000000') ?? '#000000';
    const strokeWidth = parseFloat(style['stroke-width'] ?? '1');
    let stroke = color(style.stroke, cur);
    if (stroke && (strokeWidth === 0 || style['stroke-opacity'] === '0')) stroke = 'none';
    let fill = color(style.fill ?? 'black', cur);
    if (style['fill-opacity'] === '0') fill = 'none';
    if (el.name === 'text') {
      const text = textOf(el);
      if (!text) return;
      const first = el.children.find((c) => c.name === 'tspan');
      const num = (k: string) => numbers(el.attrs[k] ?? first?.attrs[k] ?? '0')[0] ?? 0;
      const at = apply(mm, [num('x'), num('y')]);
      const scale = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2]));
      const size = (length(style['font-size'], 96) ?? 16 * px) / px;
      const anchor = style['text-anchor'];
      rawTexts.push({
        text,
        at,
        size: size * scale,
        angle: (Math.atan2(-mm[1], mm[0]) * 180) / Math.PI,
        font: (style['font-family'] ?? '').split(',')[0].replace(/['"]/g, '').trim(),
        anchor: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
        stroke,
        fill,
        layer: here,
      });
      return;
    }
    const cmds = shapeCmds(el);
    if (!cmds) {
      for (const c of el.children) walk(c, mm, style, here, names, depth + 1);
      return;
    }
    const subs = cmdsToSubs(cmds, mm);
    if (!subs.length) return;
    raws.push({
      subs,
      stroke,
      fill: el.name === 'line' || el.name === 'polyline' ? 'none' : fill,
      fillRule: style['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero',
      layer: here,
      names: own ? [own, ...names] : names,
    });
  };
  walk(root, base, {}, undefined, [], 0);
  if (skippedImages)
    notes.push(
      `${skippedImages} embedded image${skippedImages === 1 ? ' was' : 's were'} left out: trace ${skippedImages === 1 ? 'it' : 'them'} to paths first.`,
    );
  if (skippedHidden)
    notes.push(
      `${skippedHidden} hidden element${skippedHidden === 1 ? ' was' : 's were'} left out.`,
    );

  // Colours to layers. Red cuts and blue scores, as in most laser software.
  // Without red, the stroke colour with the most outlines cuts. Without any
  // strokes, filled shapes are the parts to cut, as in a silhouette.
  const isRed = (c: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    return r >= 200 && g <= 80 && b <= 80;
  };
  const isBlue = (c: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    return b >= 200 && r <= 80 && g <= 80;
  };
  const stroked = (r: { stroke?: string }) => !!r.stroke && r.stroke !== 'none';
  const free = raws.filter((r) => !r.layer);
  const counts = new Map<string, number>();
  for (const r of free)
    if (stroked(r) && r.stroke!.startsWith('#'))
      counts.set(r.stroke!, (counts.get(r.stroke!) ?? 0) + r.subs.length);
  const colors = [...counts.keys()];
  const red = colors.filter(isRed);
  const cutColors = new Set(
    red.length
      ? red
      : colors.length
        ? [colors.reduce((a, b) => ((counts.get(b) ?? 0) > (counts.get(a) ?? 0) ? b : a))]
        : [],
  );
  const anyStroke = raws.some((r) => stroked(r) && !r.layer) || raws.some((r) => r.layer);
  const custom = new Map<string, LayerRef>();
  const byColor = (stroke: string | undefined, fill: string | undefined): LayerRef | undefined => {
    if (stroke && stroke !== 'none') {
      const c = stroke.startsWith('#') ? stroke : '#000000';
      if (cutColors.has(c)) return LAYERS.cut;
      if (c === '#00a0ff') return LAYERS.guide;
      if (isBlue(c)) return LAYERS.score;
      if (!custom.has(c)) {
        const name = COLOR_NAMES[c] ?? 'color_' + c.slice(1);
        custom.set(c, { name, mode: 'line', color: c });
      }
      return custom.get(c);
    }
    if (fill && fill !== 'none') return anyStroke ? LAYERS.engrave : LAYERS.cut;
    return undefined;
  };
  if (!anyStroke && raws.some((r) => r.fill && r.fill !== 'none'))
    notes.push('The file has filled shapes and no strokes: the shapes are cut out.');
  else if (!red.length && cutColors.size)
    notes.push(`No red lines: ${[...cutColors][0]} lines, the most common colour, are cut.`);
  if (custom.size)
    notes.push(
      `Lines in ${[...custom.values()].map((l) => l.color).join(', ')} went on their own layer${custom.size === 1 ? '' : 's'}, set to mark, not cut.`,
    );

  const items: Item[] = [];
  for (const r of raws) {
    const layer = r.layer ?? byColor(r.stroke, r.fill);
    if (!layer) continue;
    const filled = !r.layer && layer === LAYERS.cut && !stroked(r);
    items.push({ subs: r.subs, layer, fillRule: r.fillRule, names: r.names, filled });
  }
  const texts: TextItem[] = [];
  for (const t of rawTexts) {
    const layer = t.layer ?? byColor(t.fill !== 'none' ? undefined : t.stroke, t.fill);
    if (layer)
      texts.push({ ...t, layer: layer.mode === 'cut' && anyStroke ? LAYERS.engrave : layer });
  }
  return { items, texts, notes };
}
