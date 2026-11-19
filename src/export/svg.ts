// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import type { LayerDef } from '../evaluator.js';
import { cutOrder, type Poly } from '../geometry.js';
import type { Placed } from '../render.js';

export const n = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// A path's points rounded as they are written, without the points that round
// onto the point before them: those would be zero-length segments. A closed
// path also drops a last point equal to its first.
export function tidy(p: Poly, closed: boolean): [string, string][] {
  const out: [string, string][] = [];
  for (const [x, y] of p) {
    const q: [string, string] = [n(x), n(y)];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== q[0] || prev[1] !== q[1]) out.push(q);
  }
  while (
    closed &&
    out.length > 1 &&
    out[0][0] === out[out.length - 1][0] &&
    out[0][1] === out[out.length - 1][1]
  )
    out.pop();
  return out;
}

const d = (p: Poly, closed: boolean) =>
  `M${tidy(p, closed)
    .map(([x, y]) => `${x} ${y}`)
    .join('L')}${closed ? 'Z' : ''}`;

export interface LayerPath {
  name: string;
  mode: LayerDef['mode'];
  color: string;
  d: string;
  regions: string;
  lines: string;
}

export function layerPaths(items: Placed[], layers: LayerDef[]): LayerPath[] {
  const out: LayerPath[] = [];
  for (const def of layers) {
    const lines: string[] = [];
    const rings: Poly[] = [];
    for (const it of items) {
      const l = it.layers.get(def.name);
      if (!l) continue;
      for (const p of l.lines) lines.push(d(p, false));
      for (const p of l.regions) rings.push(p);
    }
    const regions = cutOrder(rings).map((i) => d(rings[i], true));
    if (lines.length || regions.length)
      out.push({
        name: def.name,
        mode: def.mode,
        color: def.color,
        d: [...lines, ...regions].join(''),
        regions: regions.join(''),
        lines: lines.join(''),
      });
  }
  return out;
}

export function toSvg(items: Placed[], width: number, height: number, layers: LayerDef[]): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${n(width)}mm" height="${n(height)}mm" viewBox="0 0 ${n(width)} ${n(height)}">`,
  ];
  for (const def of layers) {
    const inner: string[] = [];
    const outer: string[] = [];
    const rings: [Poly, string][] = [];
    for (const it of items) {
      const l = it.layers.get(def.name);
      if (!l) continue;
      const tag = ` data-part="${esc(it.part)}"`;
      if (def.mode === 'fill') {
        if (l.regions.length)
          outer.push(`<path${tag} d="${l.regions.map((p) => d(p, true)).join('')}"/>`);
        for (const p of l.lines)
          outer.push(
            `<path${tag} fill="none" stroke="${def.color}" stroke-width="0.1" d="${d(p, false)}"/>`,
          );
        continue;
      }
      for (const p of l.lines) inner.push(`<path${tag} d="${d(p, false)}"/>`);
      for (const p of l.regions) rings.push([p, tag]);
    }
    for (const i of cutOrder(rings.map(([p]) => p)))
      inner.push(`<path${rings[i][1]} d="${d(rings[i][0], true)}"/>`);
    if (!inner.length && !outer.length) continue;
    const paint =
      def.mode === 'fill'
        ? `fill="${def.color}" fill-rule="evenodd" stroke="none"`
        : `fill="none" stroke="${def.color}" stroke-width="0.1"${def.mode === 'guide' ? ' stroke-dasharray="1 1"' : ''}`;
    out.push(
      `<g id="${esc(def.name)}" inkscape:groupmode="layer" inkscape:label="${esc(def.name)}" data-mode="${def.mode}" ${paint}>`,
      ...inner,
      ...outer,
      '</g>',
    );
  }
  out.push('</svg>', '');
  return out.join('\n');
}
