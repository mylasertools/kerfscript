// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// A rendered model as solid bodies: each part extruded to its thickness and
// put where the assembly places it (or laid flat), each engraved or scored
// layer as a thin coloured body on its face, and the hardware as rods and
// balls. The file writers in this folder turn the bodies into GLB, 3MF and
// STL.

import {
  bendPoint,
  foldPanels,
  meshPieces,
  multiply,
  type AssemblyPart,
  type Vec3,
} from '../assembly.js';
import type { HardwareItem } from '../evaluator.js';
import type { Light } from '../lights.js';
import { area, difference, intersection, strokeLines, union, type Poly } from '../geometry.js';
import { HARDWARE_COLORS, HARDWARE_KINDS } from '../hardware.js';
import { rodFrame } from '../bores.js';
import { triangulate } from './triangulate.js';

export interface Body {
  /** "Lid", "Lid engrave", "dowel" */
  name: string;
  kind: 'part' | 'mark' | 'hardware';
  /** The part a part or mark body belongs to, which copy, and which
   * placed part (the same number for a part and its marks) */
  part?: string;
  copy?: number;
  instance?: number;
  /** The material, as $material or a hardware kind, or the mark's layer */
  material: string;
  /** #rrggbb */
  color: string;
  metal?: boolean;
  clear?: boolean;
  /** Gives off light, as an LED or a flame */
  glow?: boolean;
  /** x, y, z of each vertex, in millimetres, z up */
  positions: number[];
  /** Three vertex indices per triangle, counter-clockwise seen from outside */
  indices: number[];
}

export interface MeshOptions {
  /** "assembled" puts each part where the program places it; "flat" lays
   * them side by side on the bed, front face up; "print" lays them out
   * as "flat" does, but each part with everything glued on it as one
   * object, its layers where the assembly has them */
  layout?: 'assembled' | 'flat' | 'print';
  /** How far engraving and scoring stand off the face, in mm; 0 leaves
   * them out */
  markHeight?: number;
  /** How wide a score line is drawn, in mm */
  lineWidth?: number;
  /** Hardware from hardware(), in the assembled layout */
  hardware?: boolean;
  /** Space between parts laid flat, in mm */
  gap?: number;
  /** How wide a cut inside a part (a living hinge's slits) is opened, in mm */
  slitWidth?: number;
}

export interface MeshSource {
  assembly: AssemblyPart[];
  /** Every part flat, for the flat layout and for a model nothing places */
  flat?: AssemblyPart[];
  hardware?: HardwareItem[];
  /** Light sources, from tealights, LEDs, bulbs and light() */
  lights?: Light[];
  /** The layers, to tell cuts inside a part from marks on it */
  layers?: { name: string; mode: string }[];
}

// Sheet colours by material name, for the 3D views; anything else is a
// light wood
const MATERIALS: [RegExp, string][] = [
  [/walnut|dark/i, '#7b5538'],
  [/cherry|mahogany|red/i, '#a0613f'],
  [/oak/i, '#c9a571'],
  [/mdf|hardboard/i, '#b4966c'],
  [/cork/i, '#c49a6c'],
  [/felt|leather/i, '#8a6a52'],
  [/card|paper/i, '#ece6d8'],
  [/black/i, '#2b2b2b'],
  [/white/i, '#f1f1ee'],
  [/green/i, '#4f8a4b'],
  [/blue/i, '#3f6fa8'],
  [/yellow/i, '#e3c13b'],
  [/orange/i, '#e07b2e'],
  [/purple|violet/i, '#7b4f9e'],
  [/pink/i, '#e58fae'],
  [/gr[ae]y|silver/i, '#9a9a9a'],
  [/gold/i, '#c9a227'],
  [/brown/i, '#7a5534'],
  [/clear|acrylic|perspex|glass/i, '#cfe6ee'],
];

/** The colour a 3D view gives a sheet material: a #rrggbb in its name,
 * else one for a wood, sheet or colour named in it, else a light wood */
export function materialColor(material: string): string {
  const hex = /#[0-9a-f]{6}(?![0-9a-f])/i.exec(material);
  if (hex) return hex[0].toLowerCase();
  return MATERIALS.find(([re]) => re.test(material))?.[1] ?? '#dcc39a';
}

const isClear = (material: string) => /clear|acrylic|perspex|glass/i.test(material);

// Overlap between a mark and the face it stands on, so the two never share
// a face
const OVERLAP = 0.01;

type Map3 = (p: Vec3) => Vec3;

const apply = (m: number[], [x, y, z]: Vec3): Vec3 => [
  m[0] * x + m[1] * y + m[2] * z + m[3],
  m[4] * x + m[5] * y + m[6] * z + m[7],
  m[8] * x + m[9] * y + m[10] * z + m[11],
];

const det3 = (m: number[]) =>
  m[0] * (m[5] * m[10] - m[6] * m[9]) -
  m[1] * (m[4] * m[10] - m[6] * m[8]) +
  m[2] * (m[4] * m[9] - m[5] * m[8]);

// A ring turned so it runs counter-clockwise (an outline) or clockwise (a
// hole)
const turned = (ring: Poly, ccw: boolean) => (area(ring) > 0 === ccw ? ring : [...ring].reverse());

// Adds a prism over a piece (its outline, then its holes) from z0 to z1 to
// the body, its points moved by `to`; `flip` when `to` mirrors
function prism(b: Body, piece: Poly[], z0: number, z1: number, to: Map3, flip: boolean) {
  const [outline, ...holes] = piece;
  if (!outline || outline.length < 3) return;
  const rings = [turned(outline, true), ...holes.map((h) => turned(h, false))];
  const flat = rings.flat();
  const tris = triangulate(rings[0], rings.slice(1));
  if (!tris.length) return;
  const n = flat.length;
  const base = b.positions.length / 3;
  for (const [x, y] of flat) b.positions.push(...to([x, y, z0]));
  for (const [x, y] of flat) b.positions.push(...to([x, y, z1]));
  const tri = (a: number, c: number, d: number) =>
    flip ? b.indices.push(a, d, c) : b.indices.push(a, c, d);
  for (const [i, j, k] of tris) {
    tri(base + n + i, base + n + j, base + n + k);
    tri(base + k, base + j, base + i);
  }
  let start = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = base + start + i;
      const c = base + start + ((i + 1) % ring.length);
      tri(a, c, c + n);
      tri(a, c + n, a + n);
    }
    start += ring.length;
  }
}

const body = (
  name: string,
  kind: Body['kind'],
  material: string,
  color: string,
  extra: Partial<Body> = {},
): Body => ({ name, kind, material, color, positions: [], indices: [], ...extra });

// The marks on one face of a part, by layer: fills as they are, lines as
// strips `width` wide, all inside the part
function markAreas(
  p: AssemblyPart,
  outline: Poly[],
  width: number,
  cuts: Set<string>,
): { layer: string; color: string; side: 'front' | 'back'; regions: Poly[] }[] {
  const out = [];
  for (const m of p.marks ?? []) {
    if (cuts.has(m.layer)) continue;
    const lines = m.mode === 'line' ? [...m.lines, ...m.regions.map((r) => [...r, r[0]])] : m.lines;
    const all = union([...(m.mode === 'fill' ? m.regions : []), ...strokeLines(lines, width)]);
    const regions = intersection(all, outline);
    if (regions.length) out.push({ layer: m.layer, color: m.color, side: m.side, regions });
  }
  return out;
}

// What hides a face's marks: null hides them all, else the areas of the
// parts against it, in the part's own coordinates
type Cover = (side: 'front' | 'back') => Poly[][] | null;

function partBodies(
  p: AssemblyPart,
  matrix: number[],
  o: Required<MeshOptions>,
  bent: boolean,
  cuts: Set<string>,
  instance: number,
  cover?: Cover,
  // A panel of a folded part: its marks only within it
  panel?: Poly[],
): Body[] {
  const t = p.thickness;
  // Cuts inside the part, as a living hinge's slits, go through it
  const slits = (p.marks ?? []).filter((m) => cuts.has(m.layer) && m.side === 'front');
  const outline = slits.length
    ? difference(
        p.outline,
        strokeLines(
          slits.flatMap((m) => m.lines),
          o.slitWidth,
        ),
      )
    : p.outline;
  // A folded part, assembled: each panel folded as a part of its own
  if (bent && p.folds?.length) {
    const panels = foldPanels(outline, p.folds, t);
    return panels.flatMap((f) =>
      partBodies(
        { ...p, folds: undefined, outline: f.outline, marks: p.marks?.map((m) => ({ ...m })) },
        multiply(matrix, f.matrix),
        o,
        bent,
        cuts,
        instance,
        cover,
        f.outline,
      ),
    );
  }
  const bends = bent ? p.bends : undefined;
  const to: Map3 = (q) => apply(matrix, bends?.length ? bendPoint(bends, t, q) : q);
  const flip = det3(matrix) < 0;
  const material = p.material ?? 'material';
  const out: Body[] = [];
  const solid = body(p.name, 'part', material, p.paint ?? materialColor(material), {
    part: p.name,
    copy: p.copy,
    instance,
    clear: !p.paint && isClear(material),
  });
  for (const piece of meshPieces(outline, bends)) prism(solid, piece, 0, t, to, flip);
  out.push(solid);
  if (o.markHeight > 0)
    for (const m of markAreas(p, panel ?? outline, o.lineWidth, cuts)) {
      // Laid flat, the back face is on the bed: nothing can stand under it
      if (m.side === 'back' && o.layout === 'flat') continue;
      const hidden = cover?.(m.side);
      if (hidden === null) continue;
      for (const h of hidden ?? []) m.regions = difference(m.regions, h);
      if (!m.regions.length) continue;
      const [z0, z1] =
        m.side === 'front' ? [t - OVERLAP, t + o.markHeight] : [-o.markHeight, OVERLAP];
      const mark = body(`${p.name} ${m.layer}`, 'mark', m.layer, m.color, {
        part: p.name,
        copy: p.copy,
        instance,
      });
      for (const piece of meshPieces(m.regions, bends)) prism(mark, piece, z0, z1, to, flip);
      if (mark.indices.length) out.push(mark);
    }
  return out;
}

// A rod from `from` to `to` with a round or [w, h] section, or a ball
function hardwareBody(h: HardwareItem): Body | null {
  const look = HARDWARE_KINDS[h.kind];
  const color = HARDWARE_COLORS[h.kind] ?? look?.color ?? '#c8c8c8';
  const b = body(h.label ?? h.kind, 'hardware', h.kind, color, {
    metal: look?.metal,
    clear: h.kind === 'glass',
    ...(look?.glow && { glow: true }),
  });
  const d = h.to.map((v, k) => v - h.from[k]) as Vec3;
  const length = Math.hypot(...d);
  const size = Array.isArray(h.size) ? h.size : [h.size, h.size];
  if (h.sides === 0 && !Array.isArray(h.size) && h.size > 0) {
    // A ball of diameter size, centred at from
    const r = h.size / 2;
    const rows = 12;
    const cols = 24;
    for (let i = 0; i <= rows; i++)
      for (let j = 0; j < cols; j++) {
        const th = (Math.PI * i) / rows;
        const ph = (2 * Math.PI * j) / cols;
        b.positions.push(
          h.from[0] + r * Math.sin(th) * Math.cos(ph),
          h.from[1] + r * Math.sin(th) * Math.sin(ph),
          h.from[2] + r * Math.cos(th),
        );
      }
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const a = i * cols + j;
        const c = i * cols + ((j + 1) % cols);
        b.indices.push(a, a + cols, c + cols, a, c + cols, c);
      }
    return b;
  }
  if (!(length > 0) || !(size[0] > 0)) return null;
  // The rod's axes as its bores have them: w along u, h along v (`up`),
  // a polygon's first corner on v, so a rod fits the hole cut for it
  const { axis: z, u: x, v: y } = rodFrame(h);
  const n = Array.isArray(h.size) ? 4 : Math.min(128, Math.max(3, Math.floor(h.sides) || 24));
  const section: Poly = Array.isArray(h.size)
    ? [
        [-size[0] / 2, -size[1] / 2],
        [size[0] / 2, -size[1] / 2],
        [size[0] / 2, size[1] / 2],
        [-size[0] / 2, size[1] / 2],
      ]
    : Array.from({ length: n }, (_, i) => {
        const a = (2 * Math.PI * i) / n;
        return [(size[0] / 2) * Math.sin(a), (size[0] / 2) * Math.cos(a)] as [number, number];
      });
  const to: Map3 = ([u, v, w]) => [
    h.from[0] + u * x[0] + v * y[0] + w * z[0],
    h.from[1] + u * x[1] + v * y[1] + w * z[1],
    h.from[2] + u * x[2] + v * y[2] + w * z[2],
  ];
  prism(b, [section], 0, length, to, false);
  return b;
}

// The [x0, y0, x1, y1] round a part's outline
const outlineBox = (p: AssemblyPart) => {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of p.outline)
    for (const [x, y] of r) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return [x0, y0, x1, y1];
};

// Where each part goes when they are laid flat: rows across, the tallest
// first, each at its outline's corner
function flatMatrices(parts: AssemblyPart[], gap: number): number[][] {
  return packed(parts.map(outlineBox), gap);
}

// Moves that pack boxes [x0, y0, x1, y1] in rows across, the tallest first
function packed(boxes: number[][], gap: number): number[][] {
  const total = boxes.reduce((s, [x0, y0, x1, y1]) => s + (x1 - x0 + gap) * (y1 - y0 + gap), 0);
  const rowWidth = Math.max(Math.sqrt(total) * 1.3, ...boxes.map(([x0, , x1]) => x1 - x0));
  const order = boxes
    .map((_, i) => i)
    .sort((a, b) => boxes[b][3] - boxes[b][1] - (boxes[a][3] - boxes[a][1]));
  const out: number[][] = new Array(boxes.length);
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const i of order) {
    const [x0, y0, x1, y1] = boxes[i];
    if (x > 0 && x + (x1 - x0) > rowWidth) {
      x = 0;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    out[i] = [1, 0, 0, x - x0, 0, 1, 0, y - y0, 0, 0, 1, 0, 0, 0, 0, 1];
    x += x1 - x0 + gap;
    rowHeight = Math.max(rowHeight, y1 - y0);
  }
  return out;
}

// The inverse of a placement: a turn, maybe mirrored, and a move
function inverse(m: number[]): number[] {
  const [a, b, c, , d, e, f, , g, h, k] = m;
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  const r = [
    (e * k - f * h) / det,
    (c * h - b * k) / det,
    (b * f - c * e) / det,
    (f * g - d * k) / det,
    (a * k - c * g) / det,
    (c * d - a * f) / det,
    (d * h - e * g) / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
  const [tx, ty, tz] = [m[3], m[7], m[11]];
  return [
    r[0],
    r[1],
    r[2],
    -(r[0] * tx + r[1] * ty + r[2] * tz),
    r[3],
    r[4],
    r[5],
    -(r[3] * tx + r[4] * ty + r[5] * tz),
    r[6],
    r[7],
    r[8],
    -(r[6] * tx + r[7] * ty + r[8] * tz),
    0,
    0,
    0,
    1,
  ];
}

// The print layout: each part with everything glued on it, as the assembly
// has them, as one object resting on its lowest face, the objects packed
// side by side. A face glued to another or lying on the bed loses its
// marks where it is covered.
function printBodies(source: MeshSource, o: Required<MeshOptions>, cuts: Set<string>): Body[] {
  const all = source.assembly;
  const rootOf = (i: number) => {
    const seen = new Set<number>();
    let j = i;
    while (all[j].glued !== undefined && all[all[j].glued!] && !seen.has(j)) {
      seen.add(j);
      j = all[j].glued!;
    }
    return j;
  };
  const byRoot = new Map<number, number[]>();
  all.forEach((p, i) => {
    if (!p.outline.length) return;
    const r = rootOf(i);
    byRoot.set(r, [...(byRoot.get(r) ?? []), i]);
  });
  // A stack with a bent part is not one flat object: its parts lie apart
  const groups: { root: number; members: number[] }[] = [];
  for (const [root, members] of byRoot)
    if (members.length > 1 && members.some((i) => all[i].bends?.length))
      for (const i of members) groups.push({ root: i, members: [i] });
    else groups.push({ root, members });
  const EPS = 1e-3;
  const placed = groups.map(({ root, members }) => {
    const back = inverse(all[root].matrix);
    const local = new Map(members.map((i) => [i, multiply(back, all[i].matrix)] as const));
    let [x0, y0, z0, x1, y1] = [Infinity, Infinity, Infinity, -Infinity, -Infinity];
    for (const i of members)
      for (const r of all[i].outline)
        for (const [x, y] of r)
          for (const z of [0, all[i].thickness]) {
            const [px, py, pz] = apply(local.get(i)!, [x, y, z]);
            [x0, y0, z0] = [Math.min(x0, px), Math.min(y0, py), Math.min(z0, pz)];
            [x1, y1] = [Math.max(x1, px), Math.max(y1, py)];
          }
    return { members, local, box: [x0, y0, x1, y1], z0 };
  });
  const moves = packed(
    placed.map((g) => g.box),
    o.gap,
  );
  // A face of a part lying flat in the object: its height and which way it
  // faces, or nothing for a part at an angle
  const face = (m: number[], t: number, side: 'front' | 'back') => {
    if (Math.abs(Math.abs(m[10]) - 1) > EPS) return undefined;
    const z = side === 'front' ? t : 0;
    const up = m[10] > 0 === (side === 'front');
    return { height: m[11] + m[10] * z, up };
  };
  const out: Body[] = [];
  placed.forEach(({ members, local, z0 }, g) => {
    const shift = multiply(moves[g], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -z0, 0, 0, 0, 1]);
    for (const i of members) {
      const p = all[i];
      const m = local.get(i)!;
      const cover: Cover = (side) => {
        const f = face(m, p.thickness, side);
        if (!f) return [];
        if (!f.up && Math.abs(f.height - z0) < EPS) return null;
        // The other parts with a face against this one, in its coordinates
        const into = inverse(m);
        const hidden: Poly[][] = [];
        for (const j of members) {
          if (j === i) continue;
          const q = local.get(j)!;
          for (const s of ['front', 'back'] as const) {
            const h = face(q, all[j].thickness, s);
            if (!h || h.up === f.up || Math.abs(h.height - f.height) > EPS) continue;
            const z = s === 'front' ? all[j].thickness : 0;
            const to = multiply(into, q);
            // A mirroring move turns the rings the other way round
            const mirrored = det3(to) < 0;
            hidden.push(
              union(
                all[j].outline.map((r) => {
                  const ring = r.map(([x, y]) => {
                    const [u, v] = apply(to, [x, y, z]);
                    return [u, v] as [number, number];
                  });
                  return mirrored ? ring.reverse() : ring;
                }),
              ),
            );
          }
        }
        return hidden;
      };
      out.push(...partBodies(p, multiply(shift, m), o, false, cuts, g, cover));
    }
  });
  return out;
}

/** The model as solid bodies, for the 3D file writers */
export function meshBodies(source: MeshSource, options: MeshOptions = {}): Body[] {
  const o: Required<MeshOptions> = {
    layout: options.layout ?? 'assembled',
    markHeight: options.markHeight ?? 0.1,
    lineWidth: options.lineWidth ?? 0.3,
    hardware: options.hardware ?? true,
    gap: options.gap ?? 5,
    slitWidth: options.slitWidth ?? 0.2,
  };
  const cuts = new Set(
    (source.layers ?? [{ name: 'cut', mode: 'cut' }])
      .filter((l) => l.mode === 'cut')
      .map((l) => l.name),
  );
  if (o.layout === 'print' && source.assembly.length) return printBodies(source, o, cuts);
  // A model that places nothing has no assembly: it is laid flat
  const flat = o.layout !== 'assembled' || !source.assembly.length;
  const parts = (flat ? (source.flat ?? source.assembly) : source.assembly).filter(
    (p) => p.outline.length,
  );
  const matrices = flat ? flatMatrices(parts, o.gap) : parts.map((p) => p.matrix);
  const out = parts.flatMap((p, i) =>
    partBodies(p, matrices[i], { ...o, layout: flat ? 'flat' : 'assembled' }, !flat, cuts, i),
  );
  if (!flat && o.hardware) {
    for (const h of source.hardware ?? []) {
      const b = hardwareBody(h);
      if (b) out.push(b);
    }
    // A flame over each tealight and flickering light
    for (const l of source.lights ?? [])
      if (l.flicker) {
        const b = hardwareBody({
          kind: 'flame',
          from: l.from,
          to: l.from,
          size: 6,
          up: [0, 0, 1],
          sides: 0,
          step: l.step,
        });
        if (b)
          out.push({
            ...b,
            name: l.label ?? 'flame',
            material: 'flame',
            color: l.color,
            glow: true,
          });
      }
  }
  return out;
}
