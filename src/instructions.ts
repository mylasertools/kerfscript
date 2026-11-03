// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Printable assembly instructions: one page per step, the model drawn as
// it stands after that step with the step's parts picked out, and the
// parts and hardware the step adds. A standalone HTML page, to print or
// save as PDF from a browser.

import { bendPoint, meshPieces, type AssemblyPart } from './assembly.js';
import { HARDWARE_COLORS, HARDWARE_KINDS } from './hardware.js';
import type { RenderResult } from './render.js';

type V3 = [number, number, number];

// Looking from the front right, above: screen right, screen up, and
// towards the viewer
const R: V3 = [Math.SQRT1_2, Math.SQRT1_2, 0];
const U: V3 = [-1 / Math.sqrt(6), 1 / Math.sqrt(6), 2 / Math.sqrt(6)];
const V: V3 = [1 / Math.sqrt(3), -1 / Math.sqrt(3), 1 / Math.sqrt(3)];
const LIGHT: V3 = (() => {
  const l: V3 = [0.4, -0.5, 0.9];
  const n = Math.hypot(...l);
  return [l[0] / n, l[1] / n, l[2] / n];
})();

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const apply = (m: number[], p: V3): V3 => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
  m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
  m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
];

interface Face {
  pts: V3[];
  // Holes of a top or bottom face, drawn with it
  holes?: V3[][];
  color: string;
  depth: number;
  stroke: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * k)))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

// A part's faces in the world, bent where it bends
function partFaces(p: AssemblyPart, color: string, stroke: string): Face[] {
  const world = (x: number, y: number, z: number): V3 =>
    apply(p.matrix, p.bends?.length ? bendPoint(p.bends, p.thickness, [x, y, z]) : [x, y, z]);
  const faces: Face[] = [];
  const add = (pts: V3[], holes?: V3[][]) => {
    if (pts.length < 3) return;
    const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
    // Newell's normal, robust for any polygon
    const N: V3 = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i],
        b = pts[(i + 1) % pts.length];
      N[0] += (a[1] - b[1]) * (a[2] + b[2]);
      N[1] += (a[2] - b[2]) * (a[0] + b[0]);
      N[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const len = Math.hypot(...N) || Math.hypot(...n);
    if (!len) return;
    const normal: V3 = [N[0] / len, N[1] / len, N[2] / len];
    // Faces turned away are hidden behind the others
    if (dot(normal, V) <= 0) return;
    const c = pts.reduce<V3>((s, q) => [s[0] + q[0], s[1] + q[1], s[2] + q[2]], [0, 0, 0]);
    faces.push({
      pts,
      holes,
      color: shade(color, 0.55 + 0.45 * Math.max(0, dot(normal, LIGHT))),
      depth: dot([c[0] / pts.length, c[1] / pts.length, c[2] / pts.length], V),
      stroke,
    });
  };
  const t = p.thickness;
  for (const piece of meshPieces(p.outline, p.bends)) {
    const area = (r: [number, number][]) =>
      r.reduce(
        (s, q, i) => s + q[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * q[1],
        0,
      );
    const outer = piece.find((r) => area(r) > 0) ?? piece[0];
    const holes = piece.filter((r) => r !== outer);
    // Top, counter-clockwise seen from above; bottom the other way
    add(
      outer.map(([x, y]) => world(x, y, t)),
      holes.map((h) => h.map(([x, y]) => world(x, y, t))),
    );
    add(
      [...outer].reverse().map(([x, y]) => world(x, y, 0)),
      holes.map((h) => [...h].reverse().map(([x, y]) => world(x, y, 0))),
    );
    for (const ring of piece)
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i],
          [bx, by] = ring[(i + 1) % ring.length];
        add([world(ax, ay, 0), world(bx, by, 0), world(bx, by, t), world(ax, ay, t)]);
      }
  }
  return faces;
}

function hardwareFaces(h: RenderResult['hardware'][number], color: string): Face[] {
  // A rod as a thick line: one face of two points, drawn with its width
  const size = typeof h.size === 'number' ? h.size : Math.max(...h.size);
  const mid: V3 = [(h.from[0] + h.to[0]) / 2, (h.from[1] + h.to[1]) / 2, (h.from[2] + h.to[2]) / 2];
  return [
    {
      pts: [h.from as V3, h.to as V3],
      color,
      depth: dot(mid, V) + size / 2,
      stroke: String(size),
    },
  ];
}

function drawing(faces: Face[], width = 640, height = 420): string {
  const proj = (p: V3) => [dot(p, R), -dot(p, U)];
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const f of faces)
    for (const p of f.pts) {
      const [x, y] = proj(p);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  if (!Number.isFinite(x0)) return '';
  const pad = Math.max(x1 - x0, y1 - y0) * 0.04 + 1;
  const k = Math.min(width / (x1 - x0 + 2 * pad), height / (y1 - y0 + 2 * pad));
  const at = (p: V3) => {
    const [x, y] = proj(p);
    return `${((x - x0 + pad) * k).toFixed(1)} ${((y - y0 + pad) * k).toFixed(1)}`;
  };
  const ring = (r: V3[]) => `M${r.map(at).join('L')}Z`;
  const out = [...faces]
    .sort((a, b) => a.depth - b.depth)
    .map((f) =>
      f.pts.length === 2
        ? `<path d="M${at(f.pts[0])}L${at(f.pts[1])}" stroke="${f.color}" stroke-width="${(Number(f.stroke) * k).toFixed(1)}" stroke-linecap="round"/>`
        : `<path d="${ring(f.pts)}${(f.holes ?? []).map(ring).join('')}" fill="${f.color}" fill-rule="evenodd" stroke="${f.stroke}" stroke-width="0.6" stroke-linejoin="round"/>`,
    );
  const w = ((x1 - x0 + 2 * pad) * k).toFixed(0),
    h = ((y1 - y0 + 2 * pad) * k).toFixed(0);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${out.join('')}</svg>`;
}

const WOOD = '#d9bf91',
  DONE = '#cfc6b8',
  NEW = '#e08a3c';

/** Assembly instructions for a render, as a standalone HTML page. */
export function instructionsHtml(r: RenderResult, title: string): string {
  const numberOf = new Map<string, number>();
  r.parts.forEach((p, i) => numberOf.set(p.name, p.label ?? i + 1));
  const parts = r.assembly.filter((a) => a.placed);
  const steps = r.steps.length ? r.steps : ['Put the parts together'];
  const stepOf = (n: number | undefined) => (r.steps.length ? (n ?? 0) : 1);
  const hwColor = (kind: string) =>
    HARDWARE_COLORS[kind] ?? HARDWARE_KINDS[kind]?.color ?? '#9a9a9a';
  const list = (items: string[]) =>
    items.length ? `<ul>${items.map((s) => `<li>${s}</li>`).join('')}</ul>` : '';
  const sections: string[] = [];
  // What is there before the first step
  const start = parts.filter((p) => stepOf(p.step) === 0);
  steps.forEach((text, i) => {
    const k = i + 1;
    const faces: Face[] = [];
    for (const p of parts) {
      const s = stepOf(p.step);
      if (s > k) continue;
      faces.push(
        ...partFaces(
          p,
          s === k ? NEW : p.step === undefined && !r.steps.length ? WOOD : DONE,
          s === k ? '#7a3e0c' : '#8a8274',
        ),
      );
    }
    for (const h of r.hardware) {
      const s = r.steps.length ? h.step : 1;
      if (s <= k)
        faces.push(...hardwareFaces(h, s === k ? hwColor(h.kind) : shade(hwColor(h.kind), 0.8)));
    }
    const adds = new Map<string, number>();
    for (const p of parts) if (stepOf(p.step) === k) adds.set(p.name, (adds.get(p.name) ?? 0) + 1);
    const hw = new Map<string, number>();
    for (const h of r.hardware)
      if ((r.steps.length ? h.step : 1) === k) {
        const size = typeof h.size === 'number' ? `${h.size} mm` : `${h.size[0]} x ${h.size[1]} mm`;
        const len = Math.round(
          Math.hypot(h.to[0] - h.from[0], h.to[1] - h.from[1], h.to[2] - h.from[2]),
        );
        const key = `${h.label ? `${esc(h.label)}: ` : ''}${esc(h.kind)}, ${size}, ${len} mm long`;
        hw.set(key, (hw.get(key) ?? 0) + 1);
      }
    sections.push(`<section>
<h2><span>${k}</span> ${esc(text)}</h2>
<div class="view">${drawing(faces)}</div>
${adds.size ? `<h3>Parts</h3>${list([...adds].sort((a, b) => (numberOf.get(a[0]) ?? 0) - (numberOf.get(b[0]) ?? 0)).map(([n, q]) => `<b>${numberOf.get(n) ?? ''}</b> ${esc(n)}${q > 1 ? ` &times; ${q}` : ''}`))}` : ''}
${hw.size ? `<h3>Hardware</h3>${list([...hw].map(([s, q]) => `${s}${q > 1 ? ` &times; ${q}` : ''}`))}` : ''}
</section>`);
  });
  const partRows = r.parts
    .map(
      (p, i) =>
        `<tr><td>${p.label ?? i + 1}</td><td>${esc(p.name)}</td><td>${p.qty}</td><td>${p.width} &times; ${p.height} mm</td><td>${p.thickness} mm ${esc(p.material)}</td></tr>`,
    )
    .join('');
  const sheets = r.sheets
    .map(
      (s, i) =>
        `<figure><div class="sheet">${s.svg.replace(/^<\?xml[^>]*>\s*/, '')}</div><figcaption>Sheet ${i + 1}: ${s.width} &times; ${s.height} mm, ${s.thickness} mm ${esc(s.material)}</figcaption></figure>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}: assembly</title>
<style>
body { font: 15px/1.45 system-ui, sans-serif; color: #222; margin: 24px auto; max-width: 760px; padding: 0 16px; }
h1 { font-size: 26px; margin: 0 0 4px; }
h2 { font-size: 19px; margin: 0 0 8px; display: flex; gap: 10px; align-items: baseline; }
h2 span { background: #222; color: #fff; border-radius: 50%; min-width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; font-size: 16px; }
h3 { font-size: 14px; margin: 10px 0 2px; text-transform: uppercase; letter-spacing: .04em; color: #666; }
section { page-break-before: always; break-before: page; padding-top: 8px; }
.view svg { width: 100%; height: auto; max-height: 460px; }
.sheet svg { width: 100%; height: auto; border: 1px solid #ccc; }
table { border-collapse: collapse; width: 100%; } td, th { text-align: left; padding: 3px 8px; border-bottom: 1px solid #eee; }
ul { margin: 4px 0; padding-left: 20px; } b { display: inline-block; min-width: 22px; }
figure { margin: 12px 0; } figcaption { color: #666; font-size: 13px; }
.note { color: #666; }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<p class="note">${r.parts.reduce((n, p) => n + p.qty, 0)} parts on ${r.sheets.length} sheet${r.sheets.length === 1 ? '' : 's'}, ${steps.length} step${steps.length === 1 ? '' : 's'}.${start.length ? ' Some parts are in place before the first step.' : ''} The parts of each step are drawn in orange.</p>
<h3>Parts</h3>
<table><tr><th>#</th><th>Part</th><th>Qty</th><th>Size</th><th>Material</th></tr>${partRows}</table>
${sheets}
${sections.join('\n')}
</body>
</html>
`;
}
