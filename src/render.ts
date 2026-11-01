// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import { besideAssembly, collisions, placementMatrix, type AssemblyPart } from './assembly.js';
import { Evaluator, type LayerDef, type Limits } from './evaluator.js';
import { toDxf } from './export/dxf.js';
import { layerPaths, toSvg, type LayerPath } from './export/svg.js';
import {
  area,
  clipLines,
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

  const infos: PartInfo[] = [];
  const assembly: AssemblyPart[] = [];
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
          const part = { ...flat, copy: i + 1, matrix: placementMatrix(placement), placed: true };
          assembly.push(part);
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

  const { found: clashes, complete } = collisions(
    assembly.filter((part) => !stackedCopies.has(part)),
    limits.maxCollisionPairs,
  );
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

  const sheetSize = (options.sheet ?? (g('$sheet') as number[])) as [number, number];
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
  const order = [
    'engrave',
    ...[...defs.keys()].filter((k) => !['engrave', 'score', 'cut', 'guide'].includes(k)),
    'score',
    'cut',
    'guide',
  ];
  const layerList = order.map((k) => defs.get(k)!).filter(Boolean);

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
    return {
      width: w,
      height: h,
      material: info?.material ?? 'material',
      thickness: info?.thickness ?? 0,
      items,
      paths: layerPaths(items, layerList),
      svg: toSvg(items, w, h, layerList),
      dxf: toDxf(items, w, h, layerList),
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
    layers: layerList,
    warnings,
    echoes: res.echoes,
  };
}
