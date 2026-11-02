// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// SVG to KerfScript. The drawing's cut outlines become parts and their
// holes; circles, rectangles, tabs, finger joints, slots, hanger holes and
// keyholes become the modules that make them, and repeated holes become
// loops. Each part's code is run and compared with the drawing, and a
// part whose code does not match is written as it is drawn instead.

import { Evaluator } from '../evaluator.js';
import { format } from '../format.js';
import { area, difference, offset, pieces, union, type Poly, type Pt } from '../geometry.js';
import { parse } from '../parser.js';
import { readSvg, type Item, type LayerRef, type Sub, type TextItem } from './svg.js';
import {
  circleOf,
  dist,
  ellipseOf,
  flattenSub,
  inside,
  jointOf,
  kerfRadius,
  materialTest,
  simplify,
  keyholeOf,
  num,
  outlineCode,
  outlineOf,
  pathData,
  perimeter,
  place,
  rectOf,
  regularOf,
  resample,
  rot,
  sameOutlines,
  sharpen,
  snap,
  tangled,
  touches,
  sub,
  vec,
  type Found,
  type Outline,
} from './shapes.js';

export interface ImportOptions {
  // Pixels per inch for drawings measured in px (96, or 72 for Illustrator)
  dpi?: number;
  // How far, in mm, a recognised shape may be from the drawing (0.05)
  tolerance?: number;
  // The drawing's name, for the comment at the top
  name?: string;
  // Merge identical parts into one with a quantity, and let KerfScript
  // pack them on sheets, instead of keeping the drawing's layout
  pack?: boolean;
  // The kerf the drawing was compensated for, in mm: its cut outlines are
  // moved back by half of it, and the program sets $kerf to it. 0 takes
  // the outlines as they are; left out, it is found from the corners.
  kerf?: number;
}

export interface ImportResult {
  source: string;
  parts: number;
  // What was recognised, as counts by kind
  found: Record<string, number>;
  // The parts and what was found, in words: "2 parts; found 3 circles."
  summary: string;
  notes: string[];
}

interface Hole {
  sub: Sub;
  outline: Outline;
  found?: Found;
  line?: Sub;
}

interface Body {
  // Cut as drawn, without kerf compensation: its outlines could not be
  // moved back for the drawing's kerf
  noKerf?: boolean;
  // The outlines as drawn, before they were moved back for the kerf
  drawn?: Sub[];
  sub: Sub;
  outline: Outline;
  names: string[];
  holes: Hole[];
  lines: Sub[];
  marks: Map<Item, Sub[]>;
  texts: TextItem[];
}

const JOIN = 0.01;

function reverse(s: Sub): Sub {
  return {
    closed: s.closed,
    segs: s.segs
      .slice()
      .reverse()
      .map((g) =>
        g.c === 'L' ? { c: 'L', a: g.b, b: g.a } : { c: 'C', a: g.b, p1: g.p2, p2: g.p1, b: g.a },
      ),
  };
}

const first = (s: Sub) => s.segs[0].a;
const last = (s: Sub) => s.segs[s.segs.length - 1].b;

// Lines whose ends meet, joined; the ones that close up become outlines.
// `from` is the first line each one starts with.
function chain(open: Sub[]): { sub: Sub; from: Sub }[] {
  const used = new Set<number>();
  const out: { sub: Sub; from: Sub }[] = [];
  const cell = (p: Pt) => `${Math.round(p[0] / JOIN)},${Math.round(p[1] / JOIN)}`;
  const ends = new Map<string, number[]>();
  open.forEach((s, i) => {
    for (const p of [first(s), last(s)]) {
      const k = cell(p);
      ends.set(k, [...(ends.get(k) ?? []), i]);
    }
  });
  const near = (p: Pt): number | undefined => {
    const [cx, cy] = [Math.round(p[0] / JOIN), Math.round(p[1] / JOIN)];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const i of ends.get(`${cx + dx},${cy + dy}`) ?? [])
          if (!used.has(i) && (dist(first(open[i]), p) <= JOIN || dist(last(open[i]), p) <= JOIN))
            return i;
    return undefined;
  };
  for (let i = 0; i < open.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    let segs = open[i].segs.slice();
    for (let pass = 0; pass < 2; pass++) {
      for (;;) {
        const end = segs[segs.length - 1].b;
        if (dist(end, segs[0].a) <= JOIN && segs.length > 1) break;
        const j = near(end);
        if (j === undefined) break;
        used.add(j);
        const s = dist(first(open[j]), end) <= JOIN ? open[j] : reverse(open[j]);
        segs = segs.concat(s.segs);
      }
      segs = reverse({ segs, closed: false }).segs;
    }
    const closed = segs.length > 1 && dist(segs[segs.length - 1].b, segs[0].a) <= JOIN;
    out.push({ sub: { segs, closed }, from: open[i] });
  }
  return out;
}

const DEFAULT_TOL = 0.05;

// The text of an SVG file from its bytes: some programs write SVG as UTF-16
export function decodeSvg(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const encoding =
    (b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0x3c && b[1] === 0)
      ? 'utf-16le'
      : (b[0] === 0xfe && b[1] === 0xff) || (b[0] === 0 && b[1] === 0x3c)
        ? 'utf-16be'
        : 'utf-8';
  return new TextDecoder(encoding).decode(b);
}

// `svg` is the text of the drawing, or the bytes of its file
export function importSvg(
  svg: string | Uint8Array | ArrayBuffer,
  options: ImportOptions = {},
): ImportResult {
  const tol = options.tolerance ?? DEFAULT_TOL;
  const text = typeof svg === 'string' ? svg : decodeSvg(svg);
  const drawing = readSvg(text, { dpi: options.dpi });
  const notes = [...drawing.notes];
  const found: Record<string, number> = {};
  const count = (k: string, n = 1) => (found[k] = (found[k] ?? 0) + n);

  // Cut outlines, closed, and cut lines that stay open
  // `line` is set for loops of lines that were not closed in the drawing
  const closed: { sub: Sub; names: string[]; line?: Sub; group?: Item }[] = [];
  let open: Sub[] = [];
  const openNames = new Map<Sub, string[]>();
  for (const it of drawing.items) {
    if (it.layer.mode !== 'cut') continue;
    for (const s of it.subs) {
      if (s.closed) closed.push({ sub: s, names: it.names, group: it.filled ? it : undefined });
      else {
        open.push(s);
        openNames.set(s, it.names);
      }
    }
  }
  const chained = chain(open);
  open = [];
  for (const { sub: s, from } of chained)
    if (s.closed)
      closed.push({
        sub: s,
        names: openNames.get(from) ?? [],
        line: { segs: s.segs, closed: false },
      });
    else open.push(s);

  // Which outlines are inside which: parts, their holes, and pieces inside
  // holes, which are parts again. Outlines that touch or cross stay lines.
  const all = closed.map((c) => ({ ...c, outline: outlineOf(flattenSub(c.sub), c.sub) }));
  const flat = all.filter(
    (c) => c.outline.poly.length >= 3 && c.outline.area > perimeter(c.outline.poly) * JOIN,
  );
  // A closed path with next to no area, such as a line drawn there and
  // back, is cut as a line
  for (const c of all)
    if (!flat.includes(c)) open.push(c.line ?? { segs: c.sub.segs, closed: false });
  const within = (o: Outline, p: Outline, og?: Item, pg?: Item) => {
    if (og !== pg) return false;
    const [a0, b0, a1, b1] = o.box,
      [c0, d0, c1, d1] = p.box;
    if (a0 < c0 - JOIN || b0 < d0 - JOIN || a1 > c1 + JOIN || b1 > d1 + JOIN) return false;
    const n = o.poly.length;
    const votes = [0, Math.floor(n / 3), Math.floor((2 * n) / 3)].filter((i) =>
      inside(o.poly[i], p.poly),
    ).length;
    return votes >= 2;
  };
  // Each outline's parent is the smallest one around it, and its depth the
  // number of outlines around it: parts at even depths, holes at odd ones
  const nestOf = (skip: Set<number>) => {
    const order = flat
      .map((_, i) => i)
      .filter((i) => !skip.has(i))
      .sort((i, j) => flat[j].outline.area - flat[i].outline.area);
    const parent = new Map<number, number>(),
      depth = new Map<number, number>();
    order.forEach((i, k) => {
      let best = -1;
      for (let m = k - 1; m >= 0; m--) {
        const j = order[m];
        if (
          flat[j].outline.area > flat[i].outline.area &&
          within(flat[i].outline, flat[j].outline, flat[i].group, flat[j].group)
        ) {
          best = j;
          break;
        }
      }
      parent.set(i, best);
      depth.set(i, best < 0 ? 0 : depth.get(best)! + 1);
    });
    return { order, parent, depth };
  };
  // Parts may overlap, each cut on its own; but a hole that touches or
  // crosses its part or another hole of it would merge with them, and an
  // outline crossing itself would lose its loops. Those stay cut lines.
  const knots = tangled(
    flat.map((c) => c.outline.poly),
    JOIN * 2,
  );
  // Every outline keeps the place it has among all of them; turning one
  // into lines must not turn the pieces inside it into holes
  const nest = nestOf(new Set());
  const { parent, depth } = nest;
  const part = (k: number) => (depth.get(k)! % 2 === 0 ? k : parent.get(k)!);
  const lined = new Set(flat.map((_, i) => i).filter((i) => knots.self[i]));
  for (const [i, j] of knots.pairs) if (part(i) === part(j)) lined.add(i).add(j);
  // A part cut as lines takes its holes with it
  for (const i of nest.order)
    if (depth.get(i)! % 2 === 1 && lined.has(parent.get(i)!)) lined.add(i);
  for (const i of lined) open.push(flat[i].line ?? { segs: flat[i].sub.segs, closed: false });
  if (lined.size)
    notes.push(
      `${lined.size} outline${lined.size === 1 ? ' touches or crosses' : 's touch or cross'} a hole or ${lined.size === 1 ? 'itself' : 'themselves'}, so ${lined.size === 1 ? 'it is' : 'they are'} kept as cut lines.`,
    );
  const bodies: Body[] = [];
  const bodyOf = new Map<number, Body>();
  for (const i of nest.order) {
    if (lined.has(i)) continue;
    const o = flat[i];
    if (depth.get(i)! % 2 === 0) {
      const b: Body = {
        sub: o.sub,
        outline: o.outline,
        names: o.names,
        holes: [],
        lines: [],
        marks: new Map(),
        texts: [],
      };
      bodies.push(b);
      bodyOf.set(i, b);
    } else bodyOf.get(parent.get(i)!)!.holes.push({ sub: o.sub, outline: o.outline, line: o.line });
  }

  // Outlines moved out for the kerf: each part shrunk back, holes grown,
  // with the sharp corners they were drawn with
  const half =
    options.kerf !== undefined ? options.kerf / 2 : kerfRadius(bodies.map((b) => b.outline.poly));
  let kerf = 0;
  if (half && half > 0) {
    const asSub = (p: Poly): Sub => ({
      closed: true,
      segs: p.map((a, i) => ({ c: 'L' as const, a, b: p[(i + 1) % p.length] })),
    });
    for (const b of bodies) {
      const material = difference(
        [sharpen(b.outline.poly, half)],
        b.holes.map((h) => sharpen(h.outline.poly, half)),
      );
      const back = pieces(offset(material, -half, 'miter'));
      // Moved out again as KerfScript will, the part must be as drawn;
      // when it is not, it keeps its outlines and is cut without the kerf
      const again = offset(back.flat(), half, 'round', Math.min(0.01, half / 10));
      const drawn = difference(
        [b.outline.poly],
        b.holes.map((h) => h.outline.poly),
      );
      // A strip as narrow as the kerf has nothing left once moved back
      const thin = (p: Poly) => Math.abs(area(p)) <= perimeter(p) * JOIN;
      if (
        back.length !== 1 ||
        back[0].length !== b.holes.length + 1 ||
        back[0].some(thin) ||
        !sameOutlines(again, drawn, tol)
      ) {
        b.noKerf = true;
        continue;
      }
      b.drawn = [b.sub, ...b.holes.map((h) => h.sub)];
      const [outer, ...inner] = back[0].map((p) => simplify(p, 0.001));
      b.outline = outlineOf(outer);
      b.sub = asSub(outer);
      // Each hole is the grown one nearest it
      const mid = (o: Outline): Pt => [(o.box[0] + o.box[2]) / 2, (o.box[1] + o.box[3]) / 2];
      const left = inner.map((p) => outlineOf(p));
      for (const h of b.holes) {
        const c = mid(h.outline);
        const hit = left.reduce((x, y) => (dist(mid(y), c) < dist(mid(x), c) ? y : x));
        left.splice(left.indexOf(hit), 1);
        h.outline = hit;
        h.sub = asSub(hit.poly);
        h.line = undefined;
      }
    }
    kerf = half * 2;
    if (options.kerf === undefined)
      notes.push(
        `The cut outlines are offset for a ${num(kerf)} mm kerf: they are moved back, and $kerf is set.`,
      );
  }

  // Everything else goes with the smallest part around it
  const owner = (p: Pt): Body | undefined => {
    let best: Body | undefined;
    for (const b of bodies) {
      const [x0, y0, x1, y1] = b.outline.box;
      if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue;
      if (!inside(p, b.outline.poly)) continue;
      if (!best || b.outline.area < best.outline.area) best = b;
    }
    return best;
  };
  const loose = { lines: [] as Sub[], marks: new Map<Item, Sub[]>(), texts: [] as TextItem[] };
  // A line or mark goes in a part only when it lies in the part's material:
  // the part would cut away what is outside it
  const tests = new Map<Body, ReturnType<typeof materialTest>>();
  const home = (s: Sub): Body | undefined => {
    const b = owner(first(s));
    if (!b) return undefined;
    let test = tests.get(b);
    if (!test) {
      test = materialTest(
        b.outline.poly,
        b.holes.map((h) => h.outline.poly),
        tol,
      );
      tests.set(b, test);
    }
    return test(flattenSub(s, 0.02), s.closed) ? b : undefined;
  };
  for (const s of open) {
    const b = home(s);
    (b ? b.lines : loose.lines).push(s);
  }
  for (const it of drawing.items) {
    if (it.layer.mode === 'cut') continue;
    for (const s of it.subs) {
      const marks = (home(s) ?? loose).marks;
      marks.set(it, [...(marks.get(it) ?? []), s]);
    }
  }
  for (const t of drawing.texts) (owner(t.at) ?? loose).texts.push(t);
  if (drawing.texts.some((t) => t.layer.mode === 'cut'))
    notes.push(
      "Text to cut is written with the built-in font, so its letters are not the drawing's: convert the text to paths in your editor to cut it as drawn.",
    );

  // A loop of cut lines with lines, marks or a part inside it, or with other
  // lines touching it, stays lines: it is a piece to press out, or a frame,
  // not a hole
  for (const b of bodies) {
    const flat = b.lines.map((l) => flattenSub(l));
    b.holes = b.holes.filter((h) => {
      if (!h.line) return true;
      const into = (p: Pt) => inside(p, h.outline.poly);
      const full =
        touches(flat, h.outline.poly, JOIN * 2) ||
        b.lines.some((l) => into(first(l))) ||
        [...b.marks.values()].some((subs) => subs.some((m) => into(first(m)))) ||
        b.texts.some((t) => into(t.at)) ||
        bodies.some((o) => o !== b && o.outline.area < h.outline.area && into(o.outline.poly[0]));
      if (full) b.lines.push(h.line);
      return !full;
    });
  }

  // Recognise the shapes
  const recogniseHole = (o: Outline): Found | undefined =>
    circleOf(o, tol) ??
    rectOf(o, tol) ??
    ellipseOf(o, tol) ??
    regularOf(o, tol) ??
    keyholeOf(o, tol);
  const bodyFound = new Map<Body, Found | undefined>();
  for (const b of bodies) {
    const f =
      circleOf(b.outline, tol) ??
      rectOf(b.outline, tol) ??
      ellipseOf(b.outline, tol) ??
      regularOf(b.outline, tol) ??
      jointOf(b.outline, tol);
    bodyFound.set(b, f);
    for (const h of b.holes) h.found = recogniseHole(h.outline);
  }
  // The material thickness: what most joints say
  // Joints at a depth a sheet can have; notches from other programs count
  // only when there are no joints of KerfScript's own. A part whose joints
  // say otherwise gets its own material() thickness.
  const votes = new Map<number, number>();
  const own = [...bodyFound.values()].some((f) => f?.thickness && !f.generic);
  for (const f of bodyFound.values())
    if (f?.thickness && f.thickness <= 10 && (own ? !f.generic : true))
      votes.set(f.thickness, (votes.get(f.thickness) ?? 0) + 1);
  let thickness = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (thickness !== undefined)
    for (const b of bodies) {
      const f = bodyFound.get(b);
      if (f?.thickness !== undefined && f.thickness !== thickness) {
        const again = jointOf(b.outline, tol, thickness);
        if (again && again.thickness === thickness) bodyFound.set(b, again);
      }
    }
  const fingerWidths = new Set<number>();
  for (const f of bodyFound.values())
    if (f?.kind === 'fingers' && f.finger) fingerWidths.add(snap(f.finger));

  // Parts, in reading order: top to bottom, then left to right
  bodies.sort((a, b) => {
    const dy = b.outline.box[3] - a.outline.box[3];
    return Math.abs(dy) > 1 ? dy : a.outline.box[0] - b.outline.box[0];
  });
  const libraries = new Set<string>();
  const usedNames = new Map<string, number>();
  const parts: { name: string; code: string; local: string; thickness?: number }[] = [];
  for (const [i, b] of bodies.entries()) {
    const base = b.names[0] ?? `part ${i + 1}`;
    const k = (usedNames.get(base) ?? 0) + 1;
    usedNames.set(base, k);
    const name = k > 1 ? `${base} ${k}` : base;
    let done: ReturnType<typeof writePart> | undefined;
    for (const level of [2, 1, 0] as const) {
      const attempt = writePart(b, bodyFound.get(b), level, thickness, fingerWidths, tol);
      if (verify(attempt, b, tol)) {
        done = attempt;
        if (level < 2)
          notes.push(
            level === 1
              ? `Part "${name}": its holes are written one by one; grouping them did not match the drawing.`
              : `Part "${name}" is written as drawn: no recognised shape matched it closely enough.`,
          );
        break;
      }
    }
    // A part none of whose shapes match the drawing, not even as drawn, is
    // cut as the lines it is drawn with
    if (!done) {
      const drawn = b.drawn ?? [b.sub, ...b.holes.map((h) => h.sub)];
      loose.lines.push(...drawn.map((s) => ({ segs: s.segs, closed: false })), ...b.lines);
      for (const [it, subs] of b.marks)
        loose.marks.set(it, [...(loose.marks.get(it) ?? []), ...subs]);
      loose.texts.push(...b.texts);
      notes.push(`Part "${name}" is cut as lines: no shape reproduces its outline exactly.`);
      continue;
    }
    for (const k of done.found) count(k);
    for (const l of done.libraries) libraries.add(l);
    const marks = writeMarks(b.marks, [], b.texts, done.origin);
    const inner = [...done.cut, ...marks];
    const t = done.thickness;
    const own = [
      ...(t !== undefined && (thickness === undefined || snap(t) !== snap(thickness))
        ? [`thickness = ${num(t)}`]
        : []),
      ...(b.noKerf && kerf > 0 ? ['kerf = 0'] : []),
    ];
    const wrap = own.length ? `material(${own.join(', ')}) ` : '';
    const head = `part("${name.replace(/["\\]/g, '')}")`;
    const local =
      inner.length === 1 && !inner[0].includes('\n')
        ? `${wrap}${head} ${inner[0]}`
        : `${wrap}${head} {\n${inner.join('\n')}\n}`;
    parts.push({ name, code: place(done.origin, 0, local), local, thickness: t });
  }
  const looseCode = writeMarks(loose.marks, loose.lines, loose.texts, [0, 0]);
  if (looseCode.length && bodies.length)
    notes.push('Some lines or marks are outside every part; they are kept on their own.');

  // Identical parts, merged when packing
  let body: string[];
  if (options.pack) {
    const groups = new Map<string, { name: string; qty: number }>();
    for (const p of parts) {
      const key = p.local.replace(/part\("[^"]*"\)/, 'part()');
      const g = groups.get(key);
      if (g) g.qty++;
      else groups.set(key, { name: p.name, qty: 1 });
    }
    body = [...groups.entries()].map(([key, g]) =>
      key.replace(
        'part()',
        `part("${g.name.replace(/["\\]/g, '')}"${g.qty > 1 ? `, qty = ${g.qty}` : ''})`,
      ),
    );
    const merged = parts.length - groups.size;
    if (merged)
      notes.push(
        `${merged} part${merged === 1 ? ' is' : 's are'} the same as another and became a quantity.`,
      );
  } else body = parts.map((p) => p.code);

  const kinds = Object.entries(found)
    .filter(([k]) => k !== 'outline')
    .map(([k, n]) => `${n} ${k}${n === 1 ? '' : (PLURAL[k] ?? 's')}`)
    .join(', ');
  const summary = `${parts.length} part${parts.length === 1 ? '' : 's'}${kinds ? `; found ${kinds}` : ''}.`;
  const header = [
    `// ${options.name ? options.name + ': ' : ''}imported from an SVG drawing.`,
    `// ${summary}`,
    ...notes.map((n) => `// ${n}`),
    '',
    ...[...libraries].sort().map((l) => `use <kerf/${l}>`),
    ...(libraries.size ? [''] : []),
  ];
  const settings: string[] = [];
  if (thickness !== undefined) settings.push(`$thickness = ${num(thickness)}; // from the joints`);
  if (kerf > 0)
    settings.push(`$kerf = ${num(kerf)}; // the drawing's outlines were offset by half of this`);
  if (!options.pack && parts.length)
    settings.push('$layout = "none"; // keep the parts where the drawing has them');
  const sections = [
    header.join('\n'),
    settings.join('\n'),
    body.join('\n\n'),
    looseCode.join('\n'),
  ].filter(Boolean);
  let source = sections.join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n';
  try {
    source = format(source);
  } catch {
    // Kept as written: the formatter only changes the layout
  }
  return { source, parts: parts.length, found, summary, notes };
}

const PLURAL: Record<string, string> = {
  'finger jointed panel': 's',
  'hanger hole': 's',
  'slot row': 's',
  'hanging loop': 's',
  'hole pattern': 's',
};

interface Written {
  origin: Pt;
  // The largest radius of the curves written, for the check's tolerance
  round: number;
  cut: string[];
  // The cut code alone, placed in the drawing, to check against it
  check: string;
  found: string[];
  libraries: Set<string>;
  thickness?: number;
}

const stmt = (s: string) => (s.trimEnd().endsWith('}') ? s : s + ';');

// The part's cut shapes as code. Level 2 groups holes into hanger holes,
// slots and loops; level 1 writes each recognised hole on its own; level 0
// writes every outline as drawn.
function writePart(
  b: Body,
  bf: Found | undefined,
  level: 0 | 1 | 2,
  thickness: number | undefined,
  fingerWidths: Set<number>,
  tol: number,
): Written {
  const found: string[] = [];
  const libraries = new Set<string>();
  const bodyF = level > 0 ? bf : undefined;
  const box = b.outline.box;
  let origin: Pt;
  let bodyCode: string;
  if (bodyF?.kind === 'rect') {
    const { w, h, r } = bodyF.rect!;
    origin = sub(bodyF.center, rot([w / 2, h / 2], bodyF.angle));
    origin = [snap(origin[0]), snap(origin[1])];
    bodyCode = place(
      [0, 0],
      bodyF.angle,
      `rect(${vec([w, h])}${snap(r) > 0 ? `, r = ${num(r)}` : ''})`,
    );
    found.push('rectangle');
  } else if (bodyF) {
    origin = [snap(bodyF.at[0]), snap(bodyF.at[1])];
    bodyCode = place(sub(bodyF.at, origin), bodyF.angle, bodyF.body);
    found.push(KIND[bodyF.kind]);
    if (bodyF.library) libraries.add(bodyF.library);
  } else {
    origin = [snap(box[0]), snap(box[1])];
    bodyCode = outlineCode(b.sub, origin);
    found.push('outline');
  }
  const holes: Hole[] = b.holes.map((h) => ({ ...h, found: level > 0 ? h.found : undefined }));
  const out: string[] = [];
  const rel = (p: Pt) => sub(p, origin);

  // A ring around a hole on the edge, joined to the outline: a hanging loop
  let wrapBody = (s: string) => s;
  let loopRadius = 0;
  const rest = new Set(holes);
  if (level === 2 && !bodyF)
    for (const h of holes) {
      const c = h.found?.circle;
      if (!c || c.r * 2 > 15) continue;
      const pts = resample(b.outline.poly, true, 0.25);
      const R = Math.min(...pts.map((p) => dist(p, c.c)));
      const wall = R - c.r;
      if (wall < 0.5) continue;
      const arc = pts.filter((p) => Math.abs(dist(p, c.c) - R) <= tol).length * 0.25;
      if (arc < R * Math.PI * 0.8) continue;
      const args = [vec(rel(c.c))];
      if (snap(c.r * 2) !== 4) args.push(`d = ${num(c.r * 2)}`);
      if (snap(wall) !== 3) args.push(`wall = ${num(wall)}`);
      wrapBody = (s) => `hanging_loop(${args.join(', ')}) ${s}`;
      loopRadius = R;
      libraries.add('hanging');
      found.push('hanging loop');
      rest.delete(h);
      break;
    }

  if (level === 2) {
    // Hanger holes: small round holes high up and in the middle
    const [x0, y0, x1, y1] = box;
    const cx = (x0 + x1) / 2,
      w = x1 - x0,
      h = y1 - y0;
    const high = (p: Pt) => p[1] >= y0 + h * 0.66;
    // A hole repeated three times or more is a pattern, not for hanging
    const same = (r: Hole) =>
      [...rest].filter(
        (o) => o.found?.circle && snap(o.found.circle.r) === snap(r.found!.circle!.r),
      ).length;
    const round = [...rest].filter(
      (r) =>
        r.found?.circle &&
        r.found.circle.r * 2 >= 1.5 &&
        r.found.circle.r * 2 <= 15 &&
        high(r.found.circle.c) &&
        same(r) <= 2,
    );
    let hung = false;
    for (const a of round) {
      const ca = a.found!.circle!;
      if (Math.abs(ca.c[0] - cx) > Math.max(0.5, w * 0.02)) continue;
      const d = ca.r * 2;
      out.push(`hanging_hole(${vec(rel(ca.c))}${snap(d) !== 5 ? `, d = ${num(d)}` : ''})`);
      rest.delete(a);
      hung = true;
      break;
    }
    if (!hung)
      for (const a of round)
        for (const c of round) {
          if (hung || a === c) continue;
          const [p, q] = [a.found!.circle!, c.found!.circle!];
          if (Math.abs(p.r - q.r) > tol || Math.abs(p.c[1] - q.c[1]) > tol || p.c[0] >= q.c[0])
            continue;
          const mid: Pt = [(p.c[0] + q.c[0]) / 2, p.c[1]];
          if (Math.abs(mid[0] - cx) > Math.max(1, w * 0.02)) continue;
          const d = p.r * 2;
          out.push(
            `hanging_hole(${vec(rel(mid))}${snap(d) !== 5 ? `, d = ${num(d)}` : ''}, spacing = ${num(q.c[0] - p.c[0])})`,
          );
          rest.delete(a);
          rest.delete(c);
          hung = true;
        }
    if (hung) {
      libraries.add('hanging');
      found.push('hanger hole');
    }

    // Two keyholes side by side
    const keys = [...rest].filter(
      (r) => r.found?.kind === 'keyhole' && r.found.library && Math.abs(r.found.angle) < 0.01,
    );
    for (const a of keys)
      for (const c of keys) {
        if (!rest.has(a) || !rest.has(c) || a === c) continue;
        const [p, q] = [a.found!, c.found!];
        if (p.body !== q.body || Math.abs(p.at[1] - q.at[1]) > tol || p.at[0] >= q.at[0]) continue;
        const args = [num(q.at[0] - p.at[0])];
        const mid = rel([(p.at[0] + q.at[0]) / 2, p.at[1]]);
        const extra = p.body.slice('keyhole('.length, -1);
        args.push(snap(mid[0]) || snap(mid[1]) ? `at = ${vec(mid)}` : '');
        if (extra) args.push(extra);
        out.push(`keyholes(${args.filter(Boolean).join(', ')})`);
        rest.delete(a);
        rest.delete(c);
        libraries.add('hanging');
        found.push('keyhole', 'keyhole');
      }

    // Rows of rectangular slots: slots for tabs, or holes for finger joints
    if (thickness !== undefined) {
      const rects = [...rest].filter(
        (r) => r.found?.kind === 'rect' && snap(r.found.rect!.r) === 0,
      );
      for (const row of rows(rects, tol)) {
        const { items, dir, spacing, along, across } = row;
        const n = items.length;
        const t = thickness;
        const c = across - t;
        const start = sub(items[0].found!.center, [(dir[0] * spacing) / 2, (dir[1] * spacing) / 2]);
        const deg = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
        const L = n * spacing;
        if (Math.abs(c) <= tol && Math.abs(along - spacing / 2) <= tol && n >= 2) {
          // finger_holes(): an "out" edge of 2n - 1 fingers, a hole on every other one
          const fn = 2 * n - 1;
          const len = fn * along;
          const def = Math.max(3 * t, 6);
          const fingerCount = (l: number, f: number) => {
            let k = Math.round(l / f);
            if (k % 2 === 0) k += l / f > k ? 1 : -1;
            return Math.max(3, k);
          };
          if (fingerCount(len, def) !== fn && fingerCount(len, along) !== fn) continue;
          const s0 = sub(items[0].found!.center, [(dir[0] * along) / 2, (dir[1] * along) / 2]);
          const finger = fingerCount(len, def) === fn ? '' : `, finger = ${num(along)}`;
          out.push(place(rel(s0), deg, `finger_holes(${num(len)}${finger})`));
          found.push('finger joint slot row');
        } else if (c >= -tol && c <= 1) {
          const args = [num(L)];
          if (n !== Math.max(1, Math.round(L / 50))) args.push(`count = ${n}`);
          const width = along - c;
          if (Math.abs(width - L / (2 * n)) > tol) args.push(`width = ${num(width)}`);
          if (Math.abs(c - 0.1) > 0.001) args.push(`clearance = ${num(c)}`);
          out.push(place(rel(start), deg, `slots(${args.join(', ')})`));
          libraries.add('tabs');
          found.push('slot row');
        } else continue;
        for (const it of items) rest.delete(it);
      }
    }
  }

  // The other holes, repeated ones as loops
  const recognised = [...rest].filter((r) => r.found);
  const raw = [...rest].filter((r) => !r.found);
  if (level === 2) {
    const groups = new Map<string, Hole[]>();
    for (const r of recognised) {
      const key = place([0, 0], r.found!.angle, r.found!.body);
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    for (const [shape, list] of groups) {
      const pattern = grid(
        list.map((r) => rel(r.found!.at)),
        tol,
      );
      if (pattern) {
        out.push(`${pattern} ${shape}`);
        for (const r of list) {
          found.push(KIND[r.found!.kind]);
          if (r.found!.library) libraries.add(r.found!.library);
        }
        found.push('hole pattern');
        for (const r of list) rest.delete(r);
      }
    }
  }
  for (const r of rest) {
    if (!r.found) continue;
    out.push(place(rel(r.found.at), r.found.angle, r.found.body));
    found.push(KIND[r.found.kind]);
    if (r.found.library) libraries.add(r.found.library);
  }
  for (const r of raw) {
    out.push(outlineCode(r.sub, origin));
    found.push('outline');
  }

  const bodyStmt = wrapBody(bodyCode);
  const cut = out.length
    ? [`difference() {\n${[bodyStmt, ...out].map(stmt).join('\n')}\n}`]
    : [stmt(bodyStmt)];
  const lines = b.lines.map((s) => stmt(outlineCode(s, origin)));
  const thicknessHere = bf?.thickness ?? thickness;
  const check = [
    ...[...libraries].map((l) => `use <kerf/${l}>`),
    `$thickness = ${thicknessHere ?? 3};`,
    `translate(${vec(origin)}) {\n${[...cut, ...lines].join('\n')}\n}`,
  ].join('\n');
  const round = Math.max(
    0,
    loopRadius,
    bodyF?.radius ?? 0,
    ...holes.map((h) => (level > 0 ? (h.found?.radius ?? 0) : 0)),
  );
  return {
    origin,
    round,
    cut: [...cut, ...lines],
    check,
    found,
    libraries,
    thickness: bodyF?.thickness,
  };
}

const KIND: Record<Found['kind'], string> = {
  circle: 'circle',
  ellipse: 'ellipse',
  rect: 'rectangle',
  polygon: 'polygon',
  star: 'star',
  tabs: 'tabbed panel',
  fingers: 'finger jointed panel',
  keyhole: 'keyhole',
  outline: 'outline',
};

// Holes the same size in a row, evenly spaced along one of their sides
function rows(holes: Hole[], tol: number) {
  const out: { items: Hole[]; dir: Pt; spacing: number; along: number; across: number }[] = [];
  const used = new Set<Hole>();
  const key = (h: Hole) => {
    const r = h.found!.rect!;
    return `${Math.round(((h.found!.angle % 180) + 180) % 180)}|${snap(r.w)}|${snap(r.h)}`;
  };
  const groups = new Map<string, Hole[]>();
  for (const h of holes) groups.set(key(h), [...(groups.get(key(h)) ?? []), h]);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const { w, h } = group[0].found!.rect!;
    const a = group[0].found!.angle;
    for (const [deg, along, across] of [
      [a, w, h],
      [a + 90, h, w],
    ]) {
      const dir: Pt = rot([1, 0], deg);
      const normal: Pt = [-dir[1], dir[0]];
      const left = group.filter((g) => !used.has(g));
      const lines = new Map<number, Hole[]>();
      for (const g of left) {
        const c = g.found!.center;
        const off = Math.round((c[0] * normal[0] + c[1] * normal[1]) / tol);
        const k = [...lines.keys()].find((x) => Math.abs(x - off) <= 1) ?? off;
        lines.set(k, [...(lines.get(k) ?? []), g]);
      }
      for (const line of lines.values()) {
        const pos = (g: Hole) => g.found!.center[0] * dir[0] + g.found!.center[1] * dir[1];
        line.sort((p, q) => pos(p) - pos(q));
        let i = 0;
        while (i < line.length - 1) {
          const step = pos(line[i + 1]) - pos(line[i]);
          let j = i + 1;
          while (j + 1 < line.length && Math.abs(pos(line[j + 1]) - pos(line[j]) - step) <= tol)
            j++;
          if (j > i && step > along) {
            const items = line.slice(i, j + 1);
            for (const it of items) used.add(it);
            out.push({ items, dir, spacing: step, along, across });
          }
          i = j;
        }
      }
    }
  }
  return out;
}

// A for loop over the positions, when they are a row or a grid
function grid(ps: Pt[], tol: number): string | undefined {
  if (ps.length < 3) return undefined;
  // Evenly spaced values as a range, the same value repeated left out
  const series = (vals: number[]): string | undefined => {
    const v: number[] = [];
    for (const x of [...vals].sort((a, b) => a - b))
      if (!v.length || x - v[v.length - 1] > tol * 2) v.push(x);
    if (v.length === 1) return undefined;
    const [a, s] = [snap(v[0]), snap((v[v.length - 1] - v[0]) / (v.length - 1))];
    const b = snap(a + s * (v.length - 1));
    if (s <= 0 || Math.floor((b - a) / s + 1e-9) + 1 !== v.length) return undefined;
    if (v.some((x, i) => Math.abs(x - (a + i * s)) > tol)) return undefined;
    return `[${num(a)}:${num(s)}:${num(b)}]`;
  };
  const xs = ps.map((p) => p[0]),
    ys = ps.map((p) => p[1]);
  const distinct = (vals: number[]) => new Set(vals.map((x) => Math.round(x / (tol * 2)))).size;
  const nx = distinct(xs),
    ny = distinct(ys);
  if (ny === 1 || nx === 1) {
    const along = ny === 1 ? xs : ys;
    if (distinct(along) !== ps.length) return undefined;
    const r = series(along);
    if (!r) return undefined;
    return ny === 1
      ? `for (x = ${r}) translate([x, ${num(ys[0])}])`
      : `for (y = ${r}) translate([${num(xs[0])}, y])`;
  }
  if (nx * ny !== ps.length) return undefined;
  const rx = series(xs),
    ry = series(ys);
  if (!rx || !ry) return undefined;
  return `for (x = ${rx}, y = ${ry}) translate([x, y])`;
}

// Engraving, scoring, lines and text inside a part
function writeMarks(
  marks: Map<Item, Sub[]>,
  lines: Sub[],
  texts: TextItem[],
  origin: Pt,
): string[] {
  const out: string[] = [];
  for (const s of lines) out.push(stmt(outlineCode(s, origin)));
  const byLayer = new Map<string, { layer: LayerRef; code: string[] }>();
  const put = (layer: LayerRef, code: string, note?: string) => {
    const k = layer.name;
    const e = byLayer.get(k) ?? { layer, code: [] };
    e.code.push(stmt(code) + (note ? ` // ${note}` : ''));
    byLayer.set(k, e);
  };
  for (const [item, subs] of marks) {
    const tol = DEFAULT_TOL;
    if (subs.length === 1 && subs[0].closed) {
      const o = outlineOf(flattenSub(subs[0]), subs[0]);
      const f =
        o.area > 1e-6
          ? (circleOf(o, tol) ?? rectOf(o, tol) ?? ellipseOf(o, tol) ?? regularOf(o, tol))
          : undefined;
      if (f) {
        put(item.layer, place(sub(f.at, origin), f.angle, f.body));
        continue;
      }
    }
    if (item.layer.mode !== 'fill' || subs.every((s) => !s.closed)) {
      for (const s of subs) put(item.layer, outlineCode(s, origin));
      continue;
    }
    const d = pathData(subs, origin);
    const polys = subs.filter((s) => s.closed).map((s) => flattenSub(s));
    const same =
      item.fillRule === 'evenodd' ||
      sameOutlines(union(polys, 'nonzero'), union(polys, 'evenodd'), 0.01);
    put(item.layer, `path("${d}"${same ? '' : ', fill = "nonzero"'})`);
  }
  for (const t of texts) {
    const args = [JSON.stringify(t.text), `size = ${num(t.size)}`];
    if (t.anchor !== 'left') args.push(`halign = "${t.anchor}"`);
    put(
      t.layer,
      place(sub(t.at, origin), t.angle, `text(${args.join(', ')})`),
      t.font ? `${t.font} in the drawing` : undefined,
    );
  }
  for (const { layer, code } of byLayer.values()) {
    const tag = ['cut', 'score', 'engrave', 'guide'].includes(layer.name)
      ? `${layer.name}()`
      : `layer("${layer.name}", mode = "${layer.mode}", color = "${layer.color}")`;
    out.push(
      code.length === 1 && !code[0].includes('//')
        ? `${tag} ${code[0]}`
        : `${tag} {\n${code.join('\n')}\n}`,
    );
  }
  return out;
}

// Runs the part's cut code and compares it with the drawing
function verify(w: Written, b: Body, tol: number): boolean {
  let shape;
  try {
    const ev = new Evaluator({ maxSteps: 2_000_000 });
    shape = ev.run(parse(w.check).program).shape;
  } catch {
    return false;
  }
  const cut = shape.layers.get('cut');
  if (!cut) return false;
  const want = difference(
    [b.outline.poly],
    b.holes.map((h) => h.outline.poly),
  );
  const got = union(cut.regions);
  // KerfScript draws a circle as a polygon whose edges are inside it by up
  // to 1.6e-4 of its radius
  const t = tol + w.round * 1.6e-4;
  if (!sameOutlines(want, got, t)) return false;
  const lines = b.lines.map((s) => flattenSub(s));
  if (lines.length && !sameOutlines(lines, cut.lines, t, false)) return false;
  return true;
}
