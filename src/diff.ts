// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// What changed between two renders, part by part and layer by layer, in
// each part's own coordinates: to prove a refactor changed nothing, or
// see what a change of settings did.

import { area, layerBounds, xor, type Layer } from './geometry.js';
import type { RenderResult } from './render.js';

export interface DiffEntry {
  part: string;
  copy: number;
  /** The layer, or none when the whole part is added or removed */
  layer?: string;
  change: 'added' | 'removed' | 'changed';
  /** Area of the closed shapes that differ, mm² */
  area?: number;
  /** Open lines only in the first render, and only in the second */
  linesRemoved?: number;
  linesAdded?: number;
  /** Where, as [x0, y0, x1, y1] in the part's coordinates */
  at?: [number, number, number, number];
}

type Parts = Map<string, Map<string, Layer>>;

// Every copy of every part, as drawn: render with layout "none" so
// nothing is packed or turned
function partsOf(r: RenderResult): Parts {
  const out: Parts = new Map();
  for (const s of r.sheets)
    for (const it of s.items) {
      // Back to the part's own coordinates, y up
      const [dx, dy] = it.offset ?? [0, 0];
      const back = (p: [number, number][]) =>
        p.map(([x, y]) => [x - dx, dy - y] as [number, number]);
      const layers = new Map<string, Layer>();
      for (const [k, l] of it.layers)
        layers.set(k, { regions: l.regions.map(back), lines: l.lines.map(back) });
      out.set(`${it.part}\u0000${it.copy}`, layers);
    }
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const lineKey = (p: [number, number][]) =>
  p.map(([x, y]) => `${Math.round(x * 100)},${Math.round(y * 100)}`).join(' ');

/** The differences between two renders made with `layout: "none"`, at
 * most `tolerance` mm² of area counted as the same. */
export function diffRenders(a: RenderResult, b: RenderResult, tolerance = 0.01): DiffEntry[] {
  const pa = partsOf(a),
    pb = partsOf(b);
  const out: DiffEntry[] = [];
  const split = (key: string) => {
    const [part, copy] = key.split('\u0000');
    return { part, copy: Number(copy) };
  };
  for (const key of new Set([...pa.keys(), ...pb.keys()])) {
    const la = pa.get(key),
      lb = pb.get(key);
    if (!la || !lb) {
      out.push({ ...split(key), change: la ? 'removed' : 'added' });
      continue;
    }
    for (const k of new Set([...la.keys(), ...lb.keys()])) {
      const x = la.get(k) ?? { regions: [], lines: [] },
        y = lb.get(k) ?? { regions: [], lines: [] };
      const differ = xor(x.regions, y.regions);
      const changed = differ.reduce((t, p) => t + Math.abs(area(p)), 0);
      const before = new Set(x.lines.map(lineKey)),
        after = new Set(y.lines.map(lineKey));
      const gone = x.lines.filter((p) => !after.has(lineKey(p)));
      const come = y.lines.filter((p) => !before.has(lineKey(p)));
      if (changed <= tolerance && !gone.length && !come.length) continue;
      const box = layerBounds(
        new Map([
          [
            k,
            {
              regions: changed > tolerance ? differ : [],
              lines: [...gone, ...come],
            },
          ],
        ]),
      );
      out.push({
        ...split(key),
        layer: k,
        change: !la.has(k) ? 'added' : !lb.has(k) ? 'removed' : 'changed',
        ...(changed > tolerance && { area: r2(changed) }),
        ...(gone.length && { linesRemoved: gone.length }),
        ...(come.length && { linesAdded: come.length }),
        ...(box && { at: box.map(r2) as [number, number, number, number] }),
      });
    }
  }
  return out;
}
