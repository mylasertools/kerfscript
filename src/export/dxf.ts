// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import { DEFAULT_LAYERS, type LayerDef } from '../evaluator.js';
import { cutOrder, type Poly } from '../geometry.js';
import type { Placed } from '../render.js';
import { tidy } from './svg.js';

const ACI: Record<string, number> = {
  '#ff0000': 1,
  '#ffff00': 2,
  '#00ff00': 3,
  '#00ffff': 4,
  '#0000ff': 5,
  '#ff00ff': 6,
  '#000000': 7,
};

const aci = (color: string) => {
  const hit = ACI[color.toLowerCase()];
  if (hit) return hit;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  if (r > g && r > b) return 1;
  if (g > r && g > b) return 3;
  if (b > r && b > g) return 5;
  return 7;
};

// DXF layer names: upper case with other characters as _. Layers whose names
// come out the same get _2, _3 and so on, so each stays its own layer. The
// built-in layers (CUT, SCORE, ENGRAVE, GUIDE) keep their names, then the
// others in layer order: the first of them, and every name without a clash,
// is kept as it is.
function dxfNames(layers: LayerDef[]): Map<string, string> {
  const base = (s: string) => s.toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  const builtIn = new Set(DEFAULT_LAYERS.map((l) => l.name));
  const taken = new Set(layers.map((l) => base(l.name)));
  const used = new Set<string>();
  const out = new Map<string, string>();
  const ordered = [
    ...layers.filter((l) => builtIn.has(l.name)),
    ...layers.filter((l) => !builtIn.has(l.name)),
  ];
  for (const l of ordered) {
    let n = base(l.name);
    if (used.has(n)) {
      let i = 2;
      while (taken.has(`${n}_${i}`) || used.has(`${n}_${i}`)) i++;
      n = `${n}_${i}`;
    }
    used.add(n);
    out.set(l.name, n);
  }
  return out;
}

export function toDxf(items: Placed[], _width: number, height: number, layers: LayerDef[]): string {
  const out: string[] = [];
  const g = (code: number, value: string | number) => out.push(String(code), String(value));
  const names = dxfNames(layers);
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSUNITS');
  g(70, 4);
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, layers.length);
  for (const l of layers) {
    g(0, 'LAYER');
    g(2, names.get(l.name)!);
    g(70, 0);
    g(62, aci(l.color));
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  const poly = (layer: string, p: Poly, closed: boolean) => {
    g(0, 'POLYLINE');
    g(8, layer);
    g(66, 1);
    g(10, 0);
    g(20, 0);
    g(30, 0);
    g(70, closed ? 1 : 0);
    for (const [x, y] of tidy(
      p.map(([x, y]) => [x, height - y]),
      closed,
    )) {
      g(0, 'VERTEX');
      g(8, layer);
      g(10, x);
      g(20, y);
      g(30, 0);
    }
    g(0, 'SEQEND');
    g(8, layer);
  };
  for (const def of layers) {
    const ln = names.get(def.name)!;
    const rings: Poly[] = [];
    for (const it of items) {
      const l = it.layers.get(def.name);
      if (!l) continue;
      for (const p of l.lines) poly(ln, p, false);
      for (const p of l.regions) rings.push(p);
    }
    for (const i of cutOrder(rings)) poly(ln, rings[i], true);
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\n') + '\n';
}
