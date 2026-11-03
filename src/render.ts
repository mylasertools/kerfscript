// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import {
  bendRuns,
  bentPieces,
  besideAssembly,
  collisions,
  invert,
  multiply,
  placementMatrix,
  runOf,
  type AssemblyPart,
} from './assembly.js';
import { slotsFor, type Solid } from './slots.js';
import { Evaluator, type HardwareItem, type LayerDef, type Limits } from './evaluator.js';
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
  type Layer,
  type Matrix,
  type PartShape,
} from './geometry.js';
import { KerfError } from './lexer.js';
import { parse } from './parser.js';
import { FontBook, type FontSource } from './text.js';
import { checkSetting, toNumber, toText, type Value } from './values.js';

export interface RenderOptions {
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
}

export interface Placed {
  part: string;
  copy: number;
  layers: Map<string, Layer>;
  rotated: boolean;
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

  cutSlots(parts, mode, warnings);

  const infos: PartInfo[] = [];
  const assembly: AssemblyPart[] = [];
  const riders = new Map<AssemblyPart, string>();
  const loose: AssemblyPart[] = [];
  const stackedCopies = new Set<AssemblyPart>();
  const ready: { info: PartInfo; layers: Map<string, Layer> }[] = [];
  for (const p of parts) {
    const material = union(
      [...p.layers].filter(([k]) => mode(k) === 'cut').flatMap(([, l]) => l.regions),
    );
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
        if (mode(k) !== 'cut') regions = intersection(regions, material);
        lines = clipLines(lines, material, 'inside');
      }
      if (regions.length || lines.length) layers.set(k, { regions, lines });
    }
    if (material.length) {
      const flat = { name: p.name, thickness: p.thickness, outline: material };
      if (p.placements) {
        const seen = new Set<string>();
        p.placements.forEach((placement, i) => {
          const part: AssemblyPart = {
            ...flat,
            copy: i + 1,
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
            copy: i + 1,
            matrix: placementMatrix({ at: [0, 0, 0], rotate: [0, 0, 0] }),
            placed: false,
            ...(p.step && { step: p.step }),
          });
    }
    const n = pieces(material).length;
    if (n > 1)
      warnings.push(
        `Part "${p.name}" cuts into ${n} separate pieces. Join them, or make them separate parts.`,
      );
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
    };
    if (kerf > 0)
      for (const [k, l] of layers)
        if (mode(k) === 'cut') {
          const holes = l.regions.filter((r) => area(r) < 0).length;
          l.regions = offset(l.regions, kerf / 2, 'round', Math.min(0.01, kerf / 20));
          const closed = holes - l.regions.filter((r) => area(r) < 0).length;
          if (closed > 0)
            warnings.push(
              `Part "${p.name}": ${closed} hole${closed === 1 ? ' is' : 's are'} narrower than the ${kerf} mm kerf and will not be cut.`,
            );
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
  for (const [a, b] of clashes.slice(0, 5))
    warnings.push(
      `Parts "${a.name}"${a.copy > 1 ? ` (copy ${a.copy})` : ''} and "${b.name}"${b.copy > 1 ? ` (copy ${b.copy})` : ''} collide in the assembly. Check their edges and where they are placed.`,
    );
  if (clashes.length > 5)
    warnings.push(`${clashes.length - 5} more pairs of parts collide in the assembly.`);
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
  const layoutMode = options.layout ?? (g('$layout') === 'none' ? 'none' : 'pack');
  // Fills first and lines over them, whatever order the layers were first
  // used in, so a line layer is never covered by a later fill
  const custom = [...defs.keys()].filter((k) => !['engrave', 'score', 'cut', 'guide'].includes(k));
  const order = [
    'engrave',
    ...custom.filter((k) => mode(k) === 'fill'),
    ...custom.filter((k) => mode(k) !== 'fill'),
    'score',
    'cut',
    'guide',
  ];
  // Each layer's back-face twin follows it, in its own job
  const allLayers = order.map((k) => defs.get(k)!).filter(Boolean);
  const layerList = allLayers.filter((l) => l.side !== 'back');
  const backList = [...allLayers.filter((l) => l.side === 'back')];

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
    for (const it of items) it.layers = moved(it.layers, shift);
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
      for (const q of queue) {
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
    hardware: res.hardware,
    steps: res.steps,
  };
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
  const solids = (p: PartShape): Solid[] =>
    (p.placements ?? []).map((pl) => ({
      matrix: placementMatrix(pl),
      thickness: p.thickness,
      outline: cutOf(p),
    }));
  const cuts = new Map<PartShape, ReturnType<typeof union>>();
  for (const p of parts) {
    if (!p.slots) continue;
    if (!p.placements) {
      warnings.push(`Part "${p.name}" has slots but no at or rotate, so they can't be found.`);
      continue;
    }
    const others: Solid[] = [];
    for (const name of p.slots) {
      const found = parts.filter((q) => q.name === name && q !== p);
      if (!found.length) warnings.push(`Part "${p.name}": no part "${name}" to cut slots for.`);
      for (const q of found) others.push(...solids(q));
    }
    const each = solids(p).map((me) => slotsFor(me, others, p.clearance ?? 0.1));
    const sized = each.map((r) => Math.round(r.reduce((a, q) => a + area(q), 0) * 10));
    if (new Set(sized).size > 1)
      warnings.push(
        `Copies of part "${p.name}" meet the parts in slots in different places; they all get every slot. Make them separate parts to cut each its own.`,
      );
    const slot = union(each.flat());
    if (!slot.length) {
      warnings.push(
        `Part "${p.name}": none of ${p.slots.map((n) => `"${n}"`).join(', ')} pass through it, so it has no slots.`,
      );
      continue;
    }
    cuts.set(p, slot);
  }
  for (const [p, slot] of cuts) {
    const layers = new Map(p.layers);
    for (const [k, l] of p.layers)
      if (mode(k) === 'cut') layers.set(k, { ...l, regions: difference(l.regions, slot) });
    p.layers = layers;
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
