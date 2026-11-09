// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import { joinLines } from './plot.js';
import {
  bendRuns,
  bentPieces,
  besideAssembly,
  collisions,
  invert,
  multiply,
  placementMatrix,
  runOf,
  translation,
  worldBox,
  type AssemblyPart,
  type Mark,
} from './assembly.js';
import { slotsFor, type Solid } from './slots.js';
import type { RenderAnalysis } from './analysis.js';
import {
  didYouMean,
  Evaluator,
  type HardwareItem,
  type LayerDef,
  type Limits,
} from './evaluator.js';
import { toDxf } from './export/dxf.js';
import { layerPaths, toSvg, type LayerPath } from './export/svg.js';
import {
  area,
  clipLines,
  difference,
  intersection,
  layerBounds,
  offset,
  pieces,
  transform,
  union,
  xor,
  type Layer,
  type Matrix,
  type PartShape,
} from './geometry.js';
import { KerfError } from './lexer.js';
import { parse } from './parser.js';
import { FontBook, textRegions, type FontSource } from './text.js';
import { checkSetting, fmt, toNumber, toText, type Value } from './values.js';

export interface RenderOptions {
  /** Capture nominal manufacturing geometry before toolpath compensation. */
  analysis?: boolean;
  params?: Record<string, Value>;
  fonts?: Record<string, FontSource>;
  defaultFont?: string;
  resolve?: (path: string) => string | undefined;
  kerf?: number;
  layout?: 'pack' | 'none';
  sheet?: [number, number];
  // The sheet when the program does not set $sheet: your laser's bed, as
  // a project's kerf.json gives it
  defaultSheet?: [number, number];
  // Fit small parts into the holes of bigger ones ($nest in the program)
  nest?: boolean;
  gap?: number;
  margin?: number;
  guides?: boolean;
  maxSteps?: number;
  limits?: Partial<Limits>;
}

export interface PartInfo {
  name: string;
  qty: number;
  width: number;
  height: number;
  pieces: number;
  cutLength: number;
  thickness: number;
  kerf: number;
  material: string;
  // Glued in stacks of this many layers
  stack?: number;
  // The part it is glued onto
  glued?: string;
  // Its number with $label_parts, engraved on its back face
  label?: number;
  // Cut mirrored, left to right
  mirrored?: boolean;
}

export interface Placed {
  part: string;
  copy: number;
  layers: Map<string, Layer>;
  rotated: boolean;
  /** With layout "none": the move from the part's coordinates, y flipped
   * down, to the sheet's */
  offset?: [number, number];
}

export interface Sheet {
  width: number;
  height: number;
  material: string;
  thickness: number;
  items: Placed[];
  paths: LayerPath[];
  svg: string;
  dxf: string;
  // Marks on the parts' back faces: turn the sheet over, left to right,
  // and run this job, lined up on the same corner
  back?: { paths: LayerPath[]; svg: string; dxf: string };
}

export interface RenderResult {
  /** Present only when requested; separate from packed, compensated cut paths. */
  analysis?: RenderAnalysis;
  sheets: Sheet[];
  width: number;
  height: number;
  paths: LayerPath[];
  svg: string;
  parts: PartInfo[];
  assembly: AssemblyPart[];
  layers: LayerDef[];
  warnings: string[];
  echoes: string[];
  // Hardware from hardware(), and the assembly steps from step()
  hardware: HardwareItem[];
  steps: string[];
}

const perimeter = (p: [number, number][], closed: boolean) => {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  if (closed && p.length > 2)
    s += Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]);
  return s;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function render(source: string, options: RenderOptions = {}): RenderResult {
  for (const [name, v] of Object.entries(options.params ?? {})) {
    try {
      checkSetting(name, v);
    } catch (e) {
      throw new KerfError((e as Error).message);
    }
  }
  const { program } = parse(source);
  // A setting the program never assigns would be ignored without a word
  const assigned = new Set(program.body.flatMap((s) => (s.kind === 'assign' ? [s.name] : [])));
  const unknownSettings = Object.keys(options.params ?? {}).filter(
    (n) => !n.startsWith('$') && !assigned.has(n),
  );
  const fonts = options.fonts ? new FontBook(options.fonts, options.defaultFont) : undefined;
  const ev = new Evaluator({
    overrides: options.params,
    resolve: options.resolve,
    fonts,
    maxSteps: options.maxSteps,
    limits: options.limits,
  });
  const limits = ev.limits;
  let res;
  try {
    res = ev.run(program);
  } catch (e) {
    const err =
      e instanceof RangeError
        ? new KerfError(
            /call stack/i.test(e.message)
              ? 'Recursion too deep: the program calls itself without stopping'
              : 'A value grew too large. Is a list or string doubling without end?',
          )
        : e;
    if (err instanceof KerfError) {
      err.echoes = ev.echoes;
      err.warnings = [...ev.warnings];
      if (fonts?.missing.size) err.missingFonts = [...fonts.missing];
    }
    throw err;
  }
  const g = (name: string) => res.globals.get(name).value;
  const warnings = res.warnings;
  for (const n of unknownSettings)
    warnings.push(
      `Setting "${n}" is not a variable of the program, so it is ignored.${didYouMean(n, assigned)}`,
    );
  const defs = res.layers;
  const mode = (k: string) => defs.get(k)?.mode ?? 'line';

  const parts: PartShape[] = [...res.shape.parts];
  const free = [...res.shape.layers.values()].some((l) => l.regions.length || l.lines.length);
  if (free)
    parts.unshift({
      name: 'part',
      qty: 1,
      layers: res.shape.layers,
      thickness: toNumber(g('$thickness')) || 3,
      kerf: toNumber(g('$kerf')) || 0,
      material: toText(g('$material') ?? 'material'),
    });
  if (!parts.length) warnings.push('Nothing to cut: the program made no shapes.');
  // Slots, glue and riders find parts by name, so one name for two
  // different parts is ambiguous; identical copies are fine
  const shapeOf = (p: PartShape) =>
    JSON.stringify([
      p.thickness,
      p.material,
      [...p.layers].map(([k, l]) => [
        k,
        l.regions.map((r) => r.map(([x, y]) => [Math.round(x * 100), Math.round(y * 100)])),
        l.lines.map((r) => r.map(([x, y]) => [Math.round(x * 100), Math.round(y * 100)])),
      ]),
    ]);
  const byName = new Map<string, string>();
  const doubled = new Set<string>();
  for (const p of parts) {
    // A mirrored pair, mirror = [false, true], is one part cut both ways
    const sig = shapeOf(p),
      key = p.mirrored ? `${p.name}\u0000mirrored` : p.name,
      had = byName.get(key);
    if (had === undefined) byName.set(key, sig);
    else if (had !== sig) doubled.add(p.name);
  }
  for (const n of doubled)
    warnings.push(
      `Two different parts are named "${n}"; slots, glue and on = find parts by name, so give each its own.`,
    );

  glueOn(parts, warnings);
  cutSlots(parts, mode, warnings);

  const infos: PartInfo[] = [];
  const analysis: RenderAnalysis | undefined = options.analysis
    ? { schemaVersion: 1, relations: true, parts: [] }
    : undefined;
  const assembly: AssemblyPart[] = [];
  const riders = new Map<AssemblyPart, string>();
  const loose: AssemblyPart[] = [];
  const stackedCopies = new Set<AssemblyPart>();
  const ready: { info: PartInfo; layers: Map<string, Layer> }[] = [];
  const minWidthSet = g('$min_width');
  const minWidth = minWidthSet === undefined ? 1.5 : toNumber(minWidthSet);
  // $label_parts: each part's number engraved on its back face, the same
  // number as in the parts list and the steps
  const labelParts = g('$label_parts') === true;
  // $join_lines: lines that meet end to end become one, taken nearest first
  const joinAll = g('$join_lines') === true;
  let label = 0;
  if (labelParts && !fonts)
    warnings.push('$label_parts needs a font for the numbers. Pass fonts to render().');
  // The program's own front layer by that name would take the numbers
  // into the front job
  const labelLayer = defs.get('engrave-back');
  if (labelParts && fonts && labelLayer && labelLayer.side !== 'back')
    warnings.push(
      '$label_parts engraves the numbers on the layer "engrave-back", which this program uses for the front; rename that layer to number the parts.',
    );
  const numbering = labelParts && !!fonts && (!labelLayer || labelLayer.side === 'back');
  if (numbering) {
    const engrave = defs.get('engrave');
    if (!defs.has('engrave-back'))
      defs.set('engrave-back', {
        name: 'engrave-back',
        mode: 'fill',
        color: engrave?.color ?? '#000000',
        side: 'back',
      });
  }
  const hidden: HiddenFill[] = [];
  for (const p of parts) {
    const material = union(
      [...p.layers].filter(([k]) => mode(k) === 'cut').flatMap(([, l]) => l.regions),
    );
    let number: number | undefined;
    if (p.bends && material.length) {
      let lo = Infinity,
        hi = -Infinity;
      for (const r of material)
        for (const [x] of r) {
          lo = Math.min(lo, x);
          hi = Math.max(hi, x);
        }
      // The material's points are rounded to 0.0001 mm
      for (const b of p.bends)
        if (b.x0 < lo - 1e-3 || b.x1 > hi + 1e-3)
          warnings.push(
            `Part "${p.name}" bends from x = ${fmt(b.x0)} to ${fmt(b.x1)}, beyond the part (x = ${fmt(lo)} to ${fmt(hi)}); only the part itself bends.`,
          );
    }
    if (numbering && material.length) {
      number = ++label;
      const mark = partLabel(material, String(number), fonts, toText(g('$font') ?? ''));
      if (mark.length) {
        const back = p.layers.get('engrave-back') ?? { regions: [], lines: [] };
        p.layers = new Map(p.layers).set('engrave-back', {
          regions: [...back.regions, ...mark],
          lines: back.lines,
        });
      } else warnings.push(`Part "${p.name}" is too small to take its number ${number}.`);
    }
    // Material narrower than $min_width breaks or burns away: what an
    // opening by that width removes, in pieces bigger than a corner's tip
    if (minWidth > 0 && material.length) {
      const opened = offset(offset(material, -minWidth / 2, 'round'), minWidth / 2, 'round');
      const thin = pieces(difference(material, opened)).filter(
        (g) => g.reduce((a, r) => a + area(r), 0) > 2 * minWidth * minWidth,
      );
      if (thin.length) {
        const at = thin.slice(0, 3).map((g) => {
          const [x0, y0, x1, y1] = layerBounds(new Map([['cut', { regions: g, lines: [] }]]))!;
          return `[${round2((x0 + x1) / 2)}, ${round2((y0 + y1) / 2)}]`;
        });
        warnings.push(
          `Part "${p.name}" is narrower than ${minWidth} mm ($min_width) in ${thin.length} place${thin.length > 1 ? 's' : ''}, at ${at.join(', ')}${thin.length > 3 ? ' and more' : ''} in the part's coordinates.`,
        );
      }
    }
    const layers = new Map<string, Layer>();
    for (const [k, l] of p.layers) {
      if (mode(k) === 'guide' && !options.guides) continue;
      let regions = union(l.regions);
      let lines = l.lines.filter((x) => x.length >= 2);
      if (mode(k) === 'line' || mode(k) === 'guide') {
        lines = [...lines, ...regions.map((r) => [...r, r[0]])];
        regions = [];
      }
      if (material.length && mode(k) !== 'guide') {
        // A layer with bleed may run past the edge, for printing
        const bleed = defs.get(k)?.bleed ?? 0;
        const area = bleed > 0 ? offset(material, bleed, 'round') : material;
        if (mode(k) !== 'cut') regions = intersection(regions, area);
        lines = clipLines(lines, area, 'inside');
      }
      if (joinAll && lines.length > 1 && mode(k) !== 'guide') lines = joinLines(lines);
      if (regions.length || lines.length) layers.set(k, { regions, lines });
    }
    hidden.push(...hiddenFills(p.name, layers, defs));
    if (material.length) {
      // Engraving and scoring, for 3D views
      const marks: Mark[] = [];
      for (const [k, l] of layers) {
        const def = defs.get(k);
        // Cuts inside the part, as a living hinge's, show on both faces
        if (def?.mode === 'cut' && l.lines.length)
          for (const side of ['front', 'back'] as const)
            marks.push({
              layer: k,
              mode: 'line',
              color: '#000000',
              side,
              regions: [],
              lines: l.lines,
            });
        if (!def || (def.mode !== 'fill' && def.mode !== 'line')) continue;
        marks.push({
          layer: k,
          mode: def.mode,
          color: def.color,
          side: def.side ?? 'front',
          regions: l.regions,
          lines: l.lines,
        });
      }
      const flat = {
        name: p.name,
        thickness: p.thickness,
        material: p.material,
        outline: material,
        ...(marks.length && { marks }),
      };
      if (p.placements) {
        const seen = new Set<string>();
        p.placements.forEach((placement, i) => {
          const part: AssemblyPart = {
            ...flat,
            copy: copyNumber(p, i),
            matrix: placementMatrix(placement),
            placed: true,
            ...(p.bends && { bends: p.bends }),
            ...(p.step && { step: p.step }),
            ...(p.stack && { stack: p.stack }),
          };
          assembly.push(part);
          if (p.on !== undefined) riders.set(part, p.on);
          const key = part.matrix.map((v) => v.toFixed(6)).join(',');
          if (seen.has(key)) stackedCopies.add(part);
          seen.add(key);
        });
        if (seen.size < p.placements.length)
          warnings.push(
            `Copies of part "${p.name}" are in the same place in the assembly. Give at a list with one placement per copy to spread them out.`,
          );
      } else
        for (let i = 0; i < p.qty; i++)
          loose.push({
            ...flat,
            copy: copyNumber(p, i),
            matrix: placementMatrix({ at: [0, 0, 0], rotate: [0, 0, 0] }),
            placed: false,
            ...(p.step && { step: p.step }),
          });
    }
    const split = pieces(material);
    const n = split.length;
    if (n > 1) {
      // Say where the smaller pieces are, the biggest being the part
      const size = (g: ReturnType<typeof pieces>[number]) => g.reduce((a, r) => a + area(r), 0);
      const stray = [...split].sort((a, b) => size(b) - size(a)).slice(1, 4);
      const where = stray
        .map((g) => {
          const [x0, y0, x1, y1] = layerBounds(new Map([['cut', { regions: g, lines: [] }]]))!;
          return `[${round2(x0)}, ${round2(y0)}] to [${round2(x1)}, ${round2(y1)}]`;
        })
        .join(', ');
      warnings.push(
        `Part "${p.name}" cuts into ${n} separate pieces. Join them, or make them separate parts. The smaller ${n === 2 ? 'one is' : 'ones are'} at ${where}${n > 4 ? ' and more' : ''}, in the part's coordinates.`,
      );
    }
    let cutLength = 0;
    for (const [k, l] of layers)
      if (mode(k) === 'cut') {
        for (const r of l.regions) cutLength += perimeter(r, true);
        for (const r of l.lines) cutLength += perimeter(r, false);
      }
    const b = layerBounds(layers) ?? [0, 0, 0, 0];
    const kerf = options.kerf ?? p.kerf;
    if (!(Number.isFinite(kerf) && kerf >= 0))
      throw new KerfError('$kerf must be a number, 0 or more');
    const info: PartInfo = {
      name: p.name,
      qty: p.qty,
      width: round2(b[2] - b[0]),
      height: round2(b[3] - b[1]),
      pieces: n,
      cutLength: Math.round(cutLength),
      thickness: p.thickness,
      kerf,
      material: p.material,
      ...(p.stack && { stack: p.stack }),
      ...(p.glue && { glued: p.glue.host }),
      ...(p.mirrored && { mirrored: true }),
      ...(number !== undefined && { label: number }),
    };
    if (analysis)
      analysis.parts.push({
        name: p.name,
        kerf,
        qty: p.qty,
        ...(p.stack && { stack: p.stack }),
        ...(p.glue && { glue: p.glue }),
        ...(p.on && { on: p.on }),
        cutRegions: material.map((r) => r.map(([x, y]): [number, number] => [x, y])),
        cutLines: [...layers]
          .filter(([k]) => mode(k) === 'cut')
          .flatMap(([, l]) => l.lines.map((r) => r.map(([x, y]): [number, number] => [x, y]))),
      });
    if (kerf > 0)
      for (const [k, l] of layers)
        if (mode(k) === 'cut') {
          const before = l.regions.filter((r) => area(r) < 0);
          l.regions = offset(l.regions, kerf / 2, 'round', Math.min(0.01, kerf / 20));
          const after = l.regions.filter((r) => area(r) < 0);
          const closed = before.length - after.length;
          if (closed > 0) {
            // The holes whose middle no hole is round any more
            const mid = (r: [number, number][]) => {
              const [x0, y0, x1, y1] = layerBounds(
                new Map([['cut', { regions: [r], lines: [] }]]),
              )!;
              return [(x0 + x1) / 2, (y0 + y1) / 2] as [number, number];
            };
            const lost = before
              .map(mid)
              .filter(([x, y]) => !after.some((h) => inPoly(h, x, y)))
              .slice(0, 3)
              .map(([x, y]) => `[${round2(x)}, ${round2(y)}]`);
            warnings.push(
              `Part "${p.name}": ${closed} hole${closed === 1 ? ' is' : 's are'} narrower than the ${kerf} mm kerf and will not be cut${lost.length ? `, at ${lost.join(', ')}${closed > lost.length ? ' and more' : ''} in the part's coordinates` : ''}.`,
            );
          }
        }
    infos.push(info);
    ready.push({ info, layers });
  }

  rideOn(assembly, riders, warnings);
  const pieceOf = new Map<AssemblyPart, AssemblyPart>();
  const solids = assembly
    .filter((part) => !stackedCopies.has(part))
    .flatMap((part) => {
      const list = bentPieces(part);
      for (const q of list) pieceOf.set(q, part);
      return list;
    });
  const { found: allClashes, complete } = collisions(solids, limits.maxCollisionPairs);
  // Pieces of one bent part meet only through its hinge
  const clashes = allClashes
    .filter(([a, b]) => pieceOf.get(a) !== pieceOf.get(b))
    .map(([a, b]) => [pieceOf.get(a) ?? a, pieceOf.get(b) ?? b] as const)
    .filter(([a, b], i, all) => all.findIndex(([c, d]) => c === a && d === b) === i);
  if (!complete)
    warnings.push(
      `The assembly has more than ${limits.maxCollisionPairs} pairs of touching parts, the limit, so only those were checked for collisions.`,
    );
  for (const [a, b] of clashes.slice(0, 5)) {
    // Where: the middle of the space both parts' boxes take up
    const [la, ha] = worldBox(a),
      [lb, hb] = worldBox(b);
    const at = [0, 1, 2].map((k) => round2((Math.max(la[k], lb[k]) + Math.min(ha[k], hb[k])) / 2));
    warnings.push(
      `Parts "${a.name}"${a.copy > 1 ? ` (copy ${a.copy})` : ''} and "${b.name}"${b.copy > 1 ? ` (copy ${b.copy})` : ''} collide in the assembly, around [${at.join(', ')}]. Check their edges and where they are placed.`,
    );
  }
  if (clashes.length > 5)
    warnings.push(`${clashes.length - 5} more pairs of parts collide in the assembly.`);
  hiddenFillWarnings(hidden, warnings);
  if (assembly.length && loose.length) {
    const names = [...new Set(loose.map((p) => `"${p.name}"`))];
    warnings.push(
      `${names.length === 1 ? 'Part' : 'Parts'} ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${names.length - 5} more` : ''} ${names.length === 1 ? 'has' : 'have'} no at or rotate, so ${names.length === 1 ? 'it lies' : 'they lie'} flat beside the assembly.`,
    );
    assembly.push(...besideAssembly(assembly, loose));
  }

  let outputPoints = 0;
  for (const r of ready) {
    let n = 0;
    for (const l of r.layers.values()) {
      for (const p of l.regions) n += p.length;
      for (const p of l.lines) n += p.length;
    }
    outputPoints += n * r.info.qty;
  }
  if (outputPoints > limits.maxOutputPoints)
    throw new KerfError(
      `The files would have ${outputPoints} points, more than the limit of ${limits.maxOutputPoints}. Use fewer copies or simpler shapes.`,
    );

  const sheetSize = (options.sheet ??
    (res.globals.vars.has('$sheet') ? g('$sheet') : (options.defaultSheet ?? g('$sheet')))) as [
    number,
    number,
  ];
  if (
    !Array.isArray(sheetSize) ||
    !(Number.isFinite(sheetSize[0]) && sheetSize[0] > 0) ||
    !(Number.isFinite(sheetSize[1]) && sheetSize[1] > 0)
  )
    throw new KerfError('$sheet must be [width, height], both more than 0');
  const gap = options.gap ?? toNumber(g('$gap') ?? 3);
  const margin = options.margin ?? gap;
  if (!(Number.isFinite(gap) && gap >= 0)) throw new KerfError('$gap must be a number, 0 or more');
  if (!(Number.isFinite(margin) && margin >= 0))
    throw new KerfError('margin must be a number, 0 or more');
  const nest = options.nest ?? g('$nest') === true;
  const layoutMode = options.layout ?? (g('$layout') === 'none' ? 'none' : 'pack');
  // Fills first and lines over them, whatever order the layers were first
  // used in, so a line layer is never covered by a later fill
  const custom = [...defs.keys()].filter((k) => !['engrave', 'score', 'cut', 'guide'].includes(k));
  // A layer's order puts it among the others; at the same order fills go
  // under lines
  const rank = (k: string) => (defs.get(k)?.order ?? 0) * 2 + (mode(k) === 'fill' ? 0 : 1);
  const order = [
    'engrave',
    ...custom
      .map((k, i) => [k, i] as const)
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
      .map(([k]) => k),
    'score',
    'cut',
    'guide',
  ];
  // Each layer's back-face twin follows it, in its own job
  const allLayers = order.map((k) => defs.get(k)!).filter(Boolean);
  const layerList = allLayers.filter((l) => l.side !== 'back');
  const backList = [...allLayers.filter((l) => l.side === 'back')];
  const registration = g('$registration') === true;
  if (registration && !defs.has('registration'))
    defs.set('registration', { name: 'registration', mode: 'fill', color: '#000000' });
  if (registration && !layerList.some((l) => l.name === 'registration'))
    layerList.push(defs.get('registration')!);

  const sheets: Sheet[] = [];
  const flipY: Matrix = [1, 0, 0, -1, 0, 0];
  const exportBounds = (layers: Map<string, Layer>) => layerBounds(layers) ?? [0, 0, 0, 0];
  const moved = (layers: Map<string, Layer>, m: Matrix) =>
    transform({ layers, parts: [] }, m).layers;

  if (layoutMode === 'none') {
    const items: Placed[] = [];
    for (const r of ready)
      for (let c = 0; c < r.info.qty; c++)
        items.push({
          part: r.info.name,
          copy: c + 1,
          layers: moved(r.layers, flipY),
          rotated: false,
        });
    const all = new Map<string, Layer>();
    for (const it of items)
      for (const [k, l] of it.layers) {
        const t = all.get(k) ?? { regions: [], lines: [] };
        for (const p of l.regions) t.regions.push(p);
        for (const p of l.lines) t.lines.push(p);
        all.set(k, t);
      }
    const b = exportBounds(all);
    const shift: Matrix = [1, 0, 0, 1, margin - b[0], margin - b[1]];
    for (const it of items) {
      it.layers = moved(it.layers, shift);
      it.offset = [shift[4], shift[5]];
    }
    sheets.push(
      finishSheet(items, b[2] - b[0] + 2 * margin, b[3] - b[1] + 2 * margin, ready[0]?.info),
    );
  } else {
    const groups = new Map<string, typeof ready>();
    for (const r of ready) {
      const key = `${r.info.material}|${r.info.thickness}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    for (const group of groups.values()) {
      const [W, H] = sheetSize;
      const queue: {
        info: PartInfo;
        layers: Map<string, Layer>;
        w: number;
        h: number;
        copy: number;
        rotated: boolean;
        inner?: Nested[];
      }[] = [];
      for (const r of group) {
        let layers = moved(r.layers, flipY);
        let b = exportBounds(layers);
        let w = b[2] - b[0],
          h = b[3] - b[1];
        let rotated = false;
        if (
          (w > W - 2 * margin || h > H - 2 * margin) &&
          h <= W - 2 * margin &&
          w <= H - 2 * margin
        ) {
          layers = moved(layers, [0, 1, -1, 0, 0, 0]);
          b = exportBounds(layers);
          w = b[2] - b[0];
          h = b[3] - b[1];
          rotated = true;
        }
        if (w > W - 2 * margin || h > H - 2 * margin)
          warnings.push(
            `Part "${r.info.name}" (${round2(w)} x ${round2(h)} mm) is bigger than the ${W} x ${H} mm sheet.`,
          );
        layers = moved(layers, [1, 0, 0, 1, -b[0], -b[1]]);
        for (let c = 0; c < r.info.qty; c++)
          queue.push({ info: r.info, layers, w, h, copy: c + 1, rotated });
      }
      queue.sort((a, b) => b.h - a.h || b.w - a.w);
      const packed = nest ? nestInHoles(queue, gap, (k) => mode(k) === 'cut') : queue;
      let items: Placed[] = [];
      let x = margin,
        y = margin,
        shelf = 0,
        usedW = 0,
        usedH = 0;
      const flush = () => {
        if (items.length && sheets.length >= limits.maxSheets)
          throw new KerfError(
            `The parts need more than ${limits.maxSheets} sheets, the limit. Use fewer copies or a bigger $sheet.`,
          );
        if (items.length)
          sheets.push(
            finishSheet(
              items,
              Math.max(usedW + margin, 1),
              Math.max(usedH + margin, 1),
              group[0].info,
            ),
          );
        items = [];
        x = margin;
        y = margin;
        shelf = 0;
        usedW = 0;
        usedH = 0;
      };
      for (const q of packed) {
        if (x > margin && x + q.w > W - margin) {
          x = margin;
          y += shelf + gap;
          shelf = 0;
        }
        if (items.length && y + q.h > H - margin) flush();
        items.push({
          part: q.info.name,
          copy: q.copy,
          layers: moved(q.layers, [1, 0, 0, 1, x, y]),
          rotated: q.rotated,
        });
        for (const n of q.inner ?? [])
          items.push({
            part: n.item.info.name,
            copy: n.item.copy,
            layers: moved(n.item.layers, [1, 0, 0, 1, x + n.dx, y + n.dy]),
            rotated: n.item.rotated,
          });
        usedW = Math.max(usedW, x + q.w);
        usedH = Math.max(usedH, y + q.h);
        x += q.w + gap;
        shelf = Math.max(shelf, q.h);
      }
      flush();
    }
  }

  function finishSheet(items: Placed[], width: number, height: number, info?: PartInfo): Sheet {
    const w = round2(width),
      h = round2(height);
    // Print and cut: three squares in the corners for the cutter to find
    if (registration) {
      const m = Math.min(5, margin - 1);
      if (!(m >= 2)) warnings.push('Registration marks need $gap of 3 or more round the sheet.');
      else {
        const sq = (x: number, y: number): [number, number][] => [
          [x, y],
          [x + m, y],
          [x + m, y + m],
          [x, y + m],
        ];
        items = [
          ...items,
          {
            part: 'registration',
            copy: 1,
            layers: new Map([
              [
                'registration',
                { regions: [sq(0.5, 0.5), sq(w - 0.5 - m, 0.5), sq(0.5, h - 0.5 - m)], lines: [] },
              ],
            ]),
            rotated: false,
          },
        ];
      }
    }
    const hasBack = items.some((it) => backList.some((l) => it.layers.has(l.name)));
    // The back job: the sheet turned over left to right
    const turned = hasBack
      ? items.map((it) => ({ ...it, layers: moved(it.layers, [-1, 0, 0, 1, w, 0]) }))
      : [];
    return {
      width: w,
      height: h,
      material: info?.material ?? 'material',
      thickness: info?.thickness ?? 0,
      items,
      paths: layerPaths(items, layerList),
      svg: toSvg(items, w, h, layerList),
      dxf: toDxf(items, w, h, layerList),
      ...(hasBack && {
        back: {
          paths: layerPaths(turned, backList),
          svg: toSvg(turned, w, h, backList),
          dxf: toDxf(turned, w, h, backList),
        },
      }),
    };
  }

  const single = sheets.length === 1 ? sheets[0] : undefined;
  const stacked = single
    ? []
    : sheets.flatMap((s, i) => {
        const dy = sheets.slice(0, i).reduce((acc, p) => acc + p.height + 10, 0);
        return s.items.map((it) => ({ ...it, layers: moved(it.layers, [1, 0, 0, 1, 0, dy]) }));
      });
  const width = round2(Math.max(1, ...sheets.map((s) => s.width)));
  const height = round2(
    Math.max(1, sheets.reduce((acc, s) => acc + s.height, 0) + 10 * Math.max(0, sheets.length - 1)),
  );
  const svg = single ? single.svg : toSvg(stacked, width, height, layerList);
  const paths = single ? single.paths : layerPaths(stacked, layerList);

  return {
    sheets,
    width: single?.width ?? width,
    height: single?.height ?? height,
    paths,
    svg,
    parts: infos,
    assembly,
    layers: [...layerList, ...backList],
    warnings,
    echoes: res.echoes,
    ...(analysis && { analysis }),
    hardware: res.hardware,
    steps: res.steps,
  };
}

// A slots name: exact, or with * standing for any run of characters
function namePattern(name: string): (s: string) => boolean {
  if (!name.includes('*')) return (s) => s === name;
  const re = new RegExp(
    `^${name
      .split('*')
      .map((k) => k.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  );
  return (s) => re.test(s);
}

// Cuts the slots part(..., slots = [...]) asks for, where the named
// parts' material passes through each placed copy of the part
function cutSlots(parts: PartShape[], mode: (k: string) => string, warnings: string[]) {
  if (!parts.some((p) => p.slots)) return;
  const material = new Map<PartShape, ReturnType<typeof union>>();
  const cutOf = (p: PartShape) => {
    let m = material.get(p);
    if (!m) {
      m = union([...p.layers].filter(([k]) => mode(k) === 'cut').flatMap(([, l]) => l.regions));
      material.set(p, m);
    }
    return m;
  };
  // A bent part's straight runs, each a solid of its own
  const solids = (p: PartShape): Solid[] =>
    (p.placements ?? []).flatMap((pl) =>
      bentPieces({
        name: p.name,
        copy: 0,
        placed: true,
        matrix: placementMatrix(pl),
        thickness: p.thickness,
        outline: cutOf(p),
        ...(p.bends && { bends: p.bends }),
      }).map((q) => ({ matrix: q.matrix, thickness: q.thickness, outline: q.outline })),
    );
  const cuts = new Map<PartShape, ReturnType<typeof union>>();
  const byLayer = new Map<PartShape, Poly2[][]>();
  for (const p of parts) {
    if (!p.slots) continue;
    if (!p.placements) {
      warnings.push(`Part "${p.name}" has slots but no at or rotate, so they can't be found.`);
      continue;
    }
    // Names, patterns with * (any run of characters), and !name to leave
    // parts out of the patterns before it
    const chosen = new Set<PartShape>();
    for (const name of p.slots) {
      const out = name.startsWith('!');
      const match = namePattern(out ? name.slice(1) : name);
      const found = parts.filter((q) => q !== p && match(q.name));
      if (!found.length && !out)
        warnings.push(`Part "${p.name}": no part "${name}" to cut slots for.`);
      for (const q of found) out ? chosen.delete(q) : chosen.add(q);
    }
    const others: Solid[] = [...chosen].flatMap(solids);
    // Per copy; a bent part's runs each cut the slots on their own stretch
    const each = (p.placements ?? []).map((pl) =>
      union(
        bentPieces({
          name: p.name,
          copy: 0,
          placed: true,
          matrix: placementMatrix(pl),
          thickness: p.thickness,
          outline: cutOf(p),
          ...(p.bends && { bends: p.bends }),
        }).flatMap((me) => {
          const cut = slotsFor(me, others, p.clearance ?? 0.1);
          return p.bends ? intersection(cut, offset(me.outline, 1, 'miter')) : cut;
        }),
      ),
    );
    // Compared by the area they differ in, so rounding slivers don't count
    const differ = (a: Poly2[], b: Poly2[]) =>
      xor(a, b).reduce((t, q) => t + Math.abs(area(q)), 0) > 1e-3;
    // A stack's layers each cut what passes through them: copy i is layer
    // i % n of its stack
    const n = p.stack ?? 1;
    if (n > 1) {
      const layer = (k: number) => each.filter((_, i) => i % n === k);
      const perLayer = Array.from({ length: n }, (_, k) => union(layer(k).flat()));
      if (perLayer.slice(1).some((r) => differ(perLayer[0], r))) {
        if (
          Array.from({ length: n }, (_, k) => layer(k)).some((l) =>
            l.slice(1).some((r) => differ(l[0], r)),
          )
        )
          warnings.push(
            `Copies of part "${p.name}" meet the parts in slots in different places; they all get every slot. Make them separate parts to cut each its own.`,
          );
        byLayer.set(p, perLayer);
        continue;
      }
    }
    if (each.slice(1).some((r) => differ(each[0], r)))
      warnings.push(
        `Copies of part "${p.name}" meet the parts in slots in different places; they all get every slot. Make them separate parts to cut each its own.`,
      );
    const slot = union(each.flat());
    if (!slot.length) {
      // A pattern asks for whatever passes through, which may be nothing
      if (!p.slots.some((n) => n.includes('*')))
        warnings.push(
          `Part "${p.name}": none of ${p.slots.map((n) => `"${n}"`).join(', ')} pass through it, so it has no slots.`,
        );
      continue;
    }
    cuts.set(p, slot);
  }
  // A slot is a hole through the part: no mark is left inside it
  const holed = (from: Map<string, Layer>, slot: Poly2[]) => {
    const layers = new Map(from);
    for (const [k, l] of from)
      layers.set(k, {
        regions: difference(l.regions, slot),
        lines: clipLines(l.lines, slot, 'outside'),
      });
    return layers;
  };
  for (const [p, slot] of cuts) p.layers = holed(p.layers, slot);
  // A stack whose layers meet different parts becomes a part per layer
  for (const [p, perLayer] of byLayer) {
    const n = perLayer.length;
    const split: PartShape[] = perLayer.map((slot, k) => ({
      ...p,
      name: `${p.name}, layer ${k + 1}`,
      qty: p.qty / n,
      layers: slot.length ? holed(p.layers, slot) : p.layers,
      placements: p.placements!.filter((_, i) => i % n === k),
      stack: undefined,
    }));
    parts.splice(parts.indexOf(p), 1, ...split);
  }
}

// Parts glued onto a bent part, given by on = "name", move with the run
// of it they sit on
function rideOn(assembly: AssemblyPart[], riders: Map<AssemblyPart, string>, warnings: string[]) {
  const counts = new Map<string, number>();
  for (const [r, host] of riders) {
    const hosts = assembly.filter((a) => a.name === host && a.placed);
    if (!hosts.length) {
      if (!counts.has(host))
        warnings.push(`Part "${r.name}" is on "${host}", which is not a placed part.`);
      counts.set(host, 0);
      continue;
    }
    const mine = [...riders].filter(([q, h]) => q.name === r.name && h === host).length;
    const h = hosts.length === mine ? hosts[r.copy - 1] : hosts[0];
    if (!h?.bends?.length) continue;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of r.outline)
      for (const [x, y] of ring) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    const m = r.matrix;
    const [cx, cy, cz] = [(x0 + x1) / 2, (y0 + y1) / 2, r.thickness / 2];
    const world = [
      m[0] * cx + m[1] * cy + m[2] * cz + m[3],
      m[4] * cx + m[5] * cy + m[6] * cz + m[7],
      m[8] * cx + m[9] * cy + m[10] * cz + m[11],
    ];
    const inv = invert(h.matrix);
    const lx = inv[0] * world[0] + inv[1] * world[1] + inv[2] * world[2] + inv[3];
    const run = bendRuns(h.bends, h.thickness)[runOf(h.bends, lx)];
    r.matrix = multiply(h.matrix, multiply(run, multiply(inv, r.matrix)));
  }
}

interface Nested {
  item: {
    info: PartInfo;
    layers: Map<string, Layer>;
    w: number;
    h: number;
    copy: number;
    rotated: boolean;
  };
  dx: number;
  dy: number;
}

// Packs smaller parts into the holes of bigger ones, biggest first, and a
// part nested in a hole offers its own holes in turn: rings in rings. The
// queue comes biggest first; the parts left outside are returned, each
// with the ones nested in it.
function nestInHoles<
  T extends { layers: Map<string, Layer>; w: number; h: number; inner?: Nested[] },
>(queue: T[], gap: number, isCut: (k: string) => boolean): T[] {
  type Free = { host: T; ox: number; oy: number; region: Poly2[] };
  const free: Free[] = [];
  const holesOf = (q: T): Poly2[] => {
    const holes: Poly2[] = [];
    for (const [k, l] of q.layers)
      if (isCut(k)) for (const r of l.regions) if (area(r) < 0) holes.push([...r].reverse());
    return holes.length ? offset(union(holes), -gap, 'miter') : [];
  };
  const inside = (region: Poly2[], x: number, y: number) => {
    let w = 0;
    for (const p of region)
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [ax, ay] = p[j],
          [bx, by] = p[i];
        if (ay <= y) {
          if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) w++;
        } else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) w--;
      }
    return w !== 0;
  };
  // A part's outside: its cut outlines with the holes filled
  const outsideOf = (q: T): Poly2[] => {
    const outer: Poly2[] = [];
    for (const [k, l] of q.layers)
      if (isCut(k)) for (const r of l.regions) if (area(r) > 0) outer.push(r);
    return union(outer);
  };
  const fit = (region: Poly2[], q: T): [number, number] | undefined => {
    const { w, h } = q;
    const shape = outsideOf(q);
    // A few of its points, to rule out places quickly
    const probes: Poly2 = [];
    for (const p of shape)
      for (let i = 0; i < p.length; i += Math.max(1, Math.floor(p.length / 12))) probes.push(p[i]);
    for (const piece of region) {
      if (area(piece) <= 0) continue;
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of piece) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      if (x1 - x0 < w || y1 - y0 < h) continue;
      const step = Math.max(0.5, Math.min(w, h, x1 - x0 - w + 1, y1 - y0 - h + 1) / 4);
      for (let y = y0; y <= y1 - h + 1e-9; y += step)
        for (let x = x0; x <= x1 - w + 1e-9; x += step) {
          if (!probes.every(([px, py]) => inside(region, px + x, py + y))) continue;
          const there = shape.map((p) => p.map(([px, py]): [number, number] => [px + x, py + y]));
          if (difference(there, region).reduce((a, p) => a + Math.abs(area(p)), 0) < 0.01)
            return [x, y];
        }
    }
    return undefined;
  };
  const out: T[] = [];
  for (const q of queue) {
    let placed = false;
    for (const f of free) {
      const at = fit(f.region, q);
      if (!at) continue;
      const [px, py] = at;
      (f.host.inner ??= []).push({
        item: q as unknown as Nested['item'],
        dx: f.ox + px,
        dy: f.oy + py,
      });
      f.region = difference(
        f.region,
        offset(
          outsideOf(q).map((p) => p.map(([a, b]): [number, number] => [a + px, b + py])),
          gap,
          'miter',
        ),
      );
      const own = holesOf(q);
      if (own.length) free.push({ host: f.host, ox: f.ox + px, oy: f.oy + py, region: own });
      placed = true;
      break;
    }
    if (placed) continue;
    out.push(q);
    const own = holesOf(q);
    if (own.length) free.push({ host: q, ox: 0, oy: 0, region: own });
  }
  return out;
}

type Poly2 = [number, number][];

// A copy's number among its part() call's copies, a stack's layers each
// counting as one
function copyNumber(p: PartShape, i: number): number {
  if (!p.copies) return i + 1;
  const stack = p.stack ?? 1;
  return (p.copies[Math.floor(i / stack)] - 1) * stack + (i % stack) + 1;
}

// A fill wholly under the fills of layers stacked above it on the same face
// can't be seen in print: two paint() or tones() calls whose later piece
// went on a layer that comes earlier in the files. The stack is the files'
// order: engrave, then the custom layers by order and first use.
interface HiddenFill {
  part: string;
  layer: string;
  under: string[];
  count: number;
  at: [number, number];
}
function hiddenFills(name: string, layers: Map<string, Layer>, defs: Map<string, LayerDef>) {
  const keys = [...defs.keys()];
  const fills = [...layers.keys()].filter(
    (k) =>
      defs.get(k)?.mode === 'fill' &&
      layers.get(k)!.regions.length &&
      !['score', 'cut', 'guide'].includes(k),
  );
  const out: HiddenFill[] = [];
  if (fills.length < 2) return out;
  const rank = (k: string) =>
    k === 'engrave' ? -Infinity : (defs.get(k)?.order ?? 0) * 2 + keys.indexOf(k) / keys.length;
  fills.sort((a, b) => rank(a) - rank(b));
  for (let i = 0; i < fills.length - 1; i++) {
    const side = defs.get(fills[i])!.side ?? 'front';
    const above = fills.slice(i + 1).filter((k) => (defs.get(k)!.side ?? 'front') === side);
    if (!above.length) continue;
    let found: HiddenFill | undefined;
    for (const piece of pieces(layers.get(fills[i])!.regions)) {
      const size = piece.reduce((a, r) => a + area(r), 0);
      if (!(size > 1e-3)) continue;
      // A hairline under strokes, narrower than 1 mm all along, is
      // what the stroke means to cover
      if (!offset(piece, -0.5, 'round').length) continue;
      // Layer by layer: one union of all their rings lets one layer's
      // holes and another's outlines add up wrong
      let rest = piece;
      for (const k of above) if (rest.length) rest = difference(rest, layers.get(k)!.regions);
      const left = rest.reduce((a, r) => a + area(r), 0);
      if (left > 1e-3 * Math.max(1, size)) continue;
      const meets = above.filter((k) => intersection(piece, layers.get(k)!.regions).length);
      const by = meets.length ? meets : above;
      if (found) {
        found.count++;
        for (const k of by) if (!found.under.includes(k)) found.under.push(k);
        continue;
      }
      const [x0, y0, x1, y1] = layerBounds(new Map([['f', { regions: piece, lines: [] }]]))!;
      found = {
        part: name,
        layer: fills[i],
        under: by,
        count: 1,
        at: [round2((x0 + x1) / 2), round2((y0 + y1) / 2)],
      };
    }
    if (found) out.push(found);
  }
  return out;
}

function hiddenFillWarnings(hidden: HiddenFill[], warnings: string[]) {
  for (const h of hidden.slice(0, 5)) {
    const under = h.under.map((k) => `"${k}"`);
    const list =
      under.length > 1 ? `${under.slice(0, -1).join(', ')} and ${under.at(-1)}` : under[0];
    warnings.push(
      `Part "${h.part}": ${h.count > 1 ? `${h.count} fills` : 'a fill'} on layer "${h.layer}" (${h.count > 1 ? 'the first ' : ''}at [${h.at.join(', ')}]) ${h.count > 1 ? 'lie' : 'lies'} wholly under ${list}, stacked above it in the files: printed, ${h.count > 1 ? 'they' : 'it'} won't show, and engraved, ${h.count > 1 ? 'they burn' : 'it burns'} twice. Draw them in one paint(), or give "${h.layer}" a higher order.`,
    );
  }
  if (hidden.length > 5) {
    const rest = hidden.slice(5);
    const parts = new Set(rest.map((h) => h.part)).size;
    const layers = [...new Set(rest.map((h) => `"${h.layer}"`))];
    warnings.push(
      `Fills are hidden the same way in ${rest.length} more place${rest.length > 1 ? 's' : ''}, on ${parts} part${parts > 1 ? 's' : ''} (layer${layers.length > 1 ? 's' : ''} ${layers.slice(0, 5).join(', ')}${layers.length > 5 ? ' and more' : ''}).`,
    );
  }
}

// Parts given glue = "host" are placed on the host's top or bottom face:
// their own placement is measured on that face. A glued part with as many
// copies as its host goes one on each; otherwise all go on the first.
function glueOn(parts: PartShape[], warnings: string[]) {
  const done = new Set<PartShape>();
  const visit = (p: PartShape, path: PartShape[]): void => {
    if (!p.glue || done.has(p)) return;
    if (path.includes(p)) {
      warnings.push(`Part "${p.name}" is glued in a loop of parts; it is left where it is.`);
      done.add(p);
      return;
    }
    const host = parts.find((q) => q.name === p.glue!.host && q !== p);
    if (!host?.placements) {
      warnings.push(`Part "${p.name}" is glued to "${p.glue.host}", which is not a placed part.`);
      done.add(p);
      return;
    }
    visit(host, [...path, p]);
    const hs = host.placements.map(placementMatrix);
    const z = p.glue.face === 'top' ? host.thickness : -p.thickness;
    const per = p.placements!.length / (p.stack ?? 1);
    p.placements = p.placements!.map((pl, i) => {
      const h = hs.length === per ? hs[Math.floor(i / (p.stack ?? 1))] : hs[0];
      return { ...pl, matrix: multiply(h, multiply(translation(0, 0, z), placementMatrix(pl))) };
    });
    done.add(p);
  };
  for (const p of parts) visit(p, []);
}

// A part's number where it has the most room, its glyphs turned so they
// read when the part is turned over
function partLabel(material: Poly2[], text: string, fonts: FontBook, font: string): Poly2[] {
  // The largest circle inside: shrink until one more step leaves nothing
  let lo = 0,
    hi = 50;
  for (let k = 0; k < 14; k++) {
    const r = (lo + hi) / 2;
    if (offset(material, -r, 'round').length) lo = r;
    else hi = r;
  }
  if (lo < 1) return [];
  const core = offset(material, -lo * 0.98, 'round');
  const b = layerBounds(new Map([['cut', { regions: core, lines: [] }]]));
  if (!b) return [];
  // The middle of what is left, or for a ring round a hole a point on it
  let [cx, cy] = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const inside = (x: number, y: number) =>
    core.reduce((n, r) => n + (inPoly(r, x, y) ? (area(r) > 0 ? 1 : -1) : 0), 0) > 0;
  if (!inside(cx, cy)) [cx, cy] = core.reduce((a, r) => (area(r) > area(a) ? r : a))[0];
  const size = Math.min(6, Math.max(2, lo * 0.9));
  const glyphs = textRegions(fonts, text, {
    size,
    font,
    halign: 'center',
    valign: 'center',
    spacing: 1,
  });
  // Too wide for the room: smaller
  const g = layerBounds(new Map([['t', { regions: glyphs, lines: [] }]]));
  const k = g ? Math.min(1, (1.6 * lo) / Math.max(g[2] - g[0], 1e-9)) : 1;
  return glyphs.map((r) => r.map(([x, y]): [number, number] => [cx - x * k, cy + y * k]).reverse());
}

function inPoly(p: [number, number][], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i],
      [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
