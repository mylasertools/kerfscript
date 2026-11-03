// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// A quick picture of a sheet as PNG, for checking a design by eye: filled
// layers in their colours, cut and score lines drawn a pixel or two wide
// however thin they are in the file. Node only (zlib).

import { deflateSync } from 'node:zlib';
import type { LayerDef } from './evaluator.js';
import type { Sheet } from './render.js';

type Poly = [number, number][];
type RGB = [number, number, number];

const rgb = (hex: string): RGB => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16);
  return Number.isFinite(n) ? [n >> 16, (n >> 8) & 255, n & 255] : [0, 0, 0];
};

class Canvas {
  readonly data: Float32Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Float32Array(w * h * 3).fill(255);
  }
  blend(i: number, c: RGB, a: number) {
    const d = this.data;
    d[i * 3] += (c[0] - d[i * 3]) * a;
    d[i * 3 + 1] += (c[1] - d[i * 3 + 1]) * a;
    d[i * 3 + 2] += (c[2] - d[i * 3 + 2]) * a;
  }
  // Even-odd scanline fill, sampled 4 times a row for smooth edges
  fill(polys: Poly[], c: RGB, alpha: number) {
    const S = 4;
    const cover = new Float32Array(this.w);
    let minY = Infinity,
      maxY = -Infinity;
    for (const p of polys)
      for (const [, y] of p) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    const y0 = Math.max(0, Math.floor(minY)),
      y1 = Math.min(this.h - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++) {
      cover.fill(0);
      let any = false;
      for (let s = 0; s < S; s++) {
        const sy = y + (s + 0.5) / S;
        const xs: number[] = [];
        for (const p of polys)
          for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
            const [ax, ay] = p[j],
              [bx, by] = p[i];
            if (ay <= sy !== by <= sy) xs.push(ax + ((sy - ay) * (bx - ax)) / (by - ay));
          }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const a = Math.max(0, xs[k]),
            b = Math.min(this.w, xs[k + 1]);
          if (b <= a) continue;
          any = true;
          for (let x = Math.floor(a); x < Math.ceil(b); x++) {
            const part = Math.min(b, x + 1) - Math.max(a, x);
            if (part > 0) cover[x] += part / S;
          }
        }
      }
      if (!any) continue;
      for (let x = 0; x < this.w; x++)
        if (cover[x] > 0) this.blend(y * this.w + x, c, Math.min(1, cover[x]) * alpha);
    }
  }
  // A line `width` pixels wide, its distance to each pixel giving coverage
  line(p: Poly, c: RGB, width: number) {
    const r = width / 2;
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, ay] = p[i],
        [bx, by] = p[i + 1];
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1)),
        x1 = Math.min(this.w - 1, Math.ceil(Math.max(ax, bx) + r + 1));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1)),
        y1 = Math.min(this.h - 1, Math.ceil(Math.max(ay, by) + r + 1));
      const dx = bx - ax,
        dy = by - ay,
        len2 = dx * dx + dy * dy;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5,
            py = y + 0.5;
          const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
          const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
          const a = Math.max(0, Math.min(1, r + 0.5 - d));
          if (a > 0) this.blend(y * this.w + x, c, a);
        }
    }
  }
}

let crcTable: Uint32Array | undefined;
function crc32(buf: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function encode(cv: Canvas): Uint8Array {
  const raw = Buffer.alloc((cv.w * 3 + 1) * cv.h);
  for (let y = 0; y < cv.h; y++) {
    raw[y * (cv.w * 3 + 1)] = 0;
    for (let x = 0; x < cv.w * 3; x++)
      raw[y * (cv.w * 3 + 1) + 1 + x] = Math.round(cv.data[y * cv.w * 3 + x]);
  }
  const chunk = (type: string, body: Uint8Array) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cv.w, 0);
  ihdr.writeUInt32BE(cv.h, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A sheet as a PNG `width` pixels wide: fills in their layer colours,
 * then line and cut layers on top. `side` "back" draws the back job. */
export function sheetPng(sheet: Sheet, layers: LayerDef[], width = 1200): Uint8Array {
  const k = width / Math.max(sheet.width, 1e-9);
  const cv = new Canvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(sheet.height * k)));
  const scale = (p: Poly): Poly => p.map(([x, y]) => [x * k, y * k]);
  const defs = new Map(layers.map((l) => [l.name, l]));
  // Fills first, in the files' order; then lines; then cuts
  const rank = (name: string) => {
    const m = defs.get(name)?.mode;
    return m === 'fill' ? 0 : m === 'line' || m === 'guide' ? 1 : 2;
  };
  const names = [...new Set(sheet.items.flatMap((it) => [...it.layers.keys()]))]
    .filter((n) => defs.get(n)?.side !== 'back')
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        layers.findIndex((l) => l.name === a) - layers.findIndex((l) => l.name === b),
    );
  // The parts' material, lightly, so the sheet reads
  for (const it of sheet.items) {
    const cut = it.layers.get('cut');
    if (cut) cv.fill(cut.regions.map(scale), [235, 218, 186], 1);
  }
  for (const name of names) {
    const def = defs.get(name);
    const c = rgb(def?.color ?? '#000000');
    for (const it of sheet.items) {
      const l = it.layers.get(name);
      if (!l) continue;
      if (def?.mode === 'fill') {
        cv.fill(l.regions.map(scale), c, 0.85);
        for (const p of l.lines) cv.line(scale(p), c, 1.2);
      } else {
        const w = def?.mode === 'cut' ? 1.6 : 1.1;
        for (const p of l.regions) cv.line(scale([...p, p[0]]), c, w);
        for (const p of l.lines) cv.line(scale(p), c, w);
      }
    }
  }
  return encode(cv);
}
