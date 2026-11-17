// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Assembly instructions as pages: the parts list, then a page per step
// with the model drawn as it stands after it, the step's parts picked out,
// and the parts and hardware it adds. Written as a PDF, or as a PNG a
// page, with the text drawn as the font's outlines, so nothing needs a
// browser or a font installed. Node only (zlib).

import { deflateSync } from 'node:zlib';
import { HARDWARE_COLORS, HARDWARE_KINDS } from '../hardware.js';
import {
  DONE,
  hardwareFaces,
  NEW,
  partFaces,
  projectFaces,
  shade,
  WOOD,
  type Face,
} from '../instructions.js';
import type { RenderResult } from '../render.js';
import { textMetrics, textRegions, type FontBook } from '../text.js';
import { pngOf } from '../png.js';

type Ring = [number, number][];

/** Something drawn on a page, in points from its top left, y down: filled
 * rings (even-odd), or with no fill a line `width` wide through them */
export interface PageItem {
  rings: Ring[];
  fill: string;
  stroke: string;
  width: number;
}

export interface Page {
  w: number;
  h: number;
  items: PageItem[];
}

// A4, in points
const W = 595.28;
const H = 841.89;
const M = 42;

/** The instructions as pages */
export function instructionPages(r: RenderResult, title: string, fonts: FontBook): Page[] {
  const pages: Page[] = [];
  let page: Page = { w: W, h: H, items: [] };
  let y = M;
  const newPage = () => {
    pages.push(page);
    page = { w: W, h: H, items: [] };
    y = M;
  };
  const opts = (size: number) => ({
    size,
    font: '',
    halign: 'left',
    valign: 'baseline',
    spacing: 1,
  });
  // Text broken into lines that fit, each set on its baseline
  const text = (s: string, size: number, x = M, color = '#222222', room = W - M - x) => {
    const words = s.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && textMetrics(fonts, next, opts(size)).advance > room) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    for (const l of lines) {
      if (y + size * 1.35 > H - M) newPage();
      y += size * 1.05;
      const polys = textRegions(fonts, l, opts(size));
      if (polys.length)
        page.items.push({
          rings: polys.map((p) => p.map(([px, py]) => [x + px, y - py] as [number, number])),
          fill: color,
          stroke: '',
          width: 0,
        });
      y += size * 0.3;
    }
  };
  const numberOf = new Map<string, number>();
  r.parts.forEach((p, i) => numberOf.set(p.name, p.label ?? i + 1));
  const parts = r.assembly.filter((a) => a.placed);
  const steps = r.steps.length ? r.steps : ['Put the parts together'];
  const stepOf = (n: number | undefined) => (r.steps.length ? (n ?? 0) : 1);
  const hwColor = (kind: string) =>
    HARDWARE_COLORS[kind] ?? HARDWARE_KINDS[kind]?.color ?? '#9a9a9a';

  // The first page: the title and the parts
  text(title, 24);
  y += 4;
  text(
    `${r.parts.reduce((n, p) => n + p.qty, 0)} parts on ${r.sheets.length} sheet${r.sheets.length === 1 ? '' : 's'}, ${steps.length} step${steps.length === 1 ? '' : 's'}. The parts of each step are drawn in orange.`,
    11,
    M,
    '#666666',
  );
  y += 8;
  text('PARTS', 10, M, '#666666');
  r.parts.forEach((p, i) =>
    text(
      `${p.label ?? i + 1}.  ${p.name}${p.mirrored ? ' (mirrored)' : ''}${p.qty > 1 ? ` x ${p.qty}` : ''}  -  ${p.width} x ${p.height} mm, ${p.thickness} mm ${p.material}`,
      10.5,
    ),
  );

  steps.forEach((label, i) => {
    const k = i + 1;
    newPage();
    text(`${k}.  ${label}`, 17);
    y += 6;
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
    const view = projectFaces(faces, W - 2 * M, 430);
    const dx = M + (W - 2 * M - view.w) / 2;
    for (const it of view.items)
      page.items.push({
        ...it,
        rings: it.rings.map((ring) =>
          ring.map(([px, py]) => [dx + px, y + py] as [number, number]),
        ),
      });
    y += Math.max(view.h, 40) + 14;
    const adds = new Map<string, number>();
    for (const p of parts) if (stepOf(p.step) === k) adds.set(p.name, (adds.get(p.name) ?? 0) + 1);
    if (adds.size) {
      text('PARTS', 10, M, '#666666');
      for (const [n, q] of [...adds].sort(
        (a, b) => (numberOf.get(a[0]) ?? 0) - (numberOf.get(b[0]) ?? 0),
      ))
        text(`${numberOf.get(n) ?? ''}.  ${n}${q > 1 ? ` x ${q}` : ''}`, 11);
    }
    const hw = new Map<string, number>();
    for (const h of r.hardware)
      if ((r.steps.length ? h.step : 1) === k) {
        const size = typeof h.size === 'number' ? `${h.size} mm` : `${h.size[0]} x ${h.size[1]} mm`;
        const len = Math.round(
          Math.hypot(h.to[0] - h.from[0], h.to[1] - h.from[1], h.to[2] - h.from[2]),
        );
        const key = `${h.label ? `${h.label}: ` : ''}${h.kind}, ${size}, ${len} mm long`;
        hw.set(key, (hw.get(key) ?? 0) + 1);
      }
    if (hw.size) {
      y += 4;
      text('HARDWARE', 10, M, '#666666');
      for (const [s, q] of hw) text(`${s}${q > 1 ? ` x ${q}` : ''}`, 11);
    }
  });
  pages.push(page);
  return pages;
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const num = (v: number) => (Math.round(v * 100) / 100).toString();

/** Pages as a PDF: filled vector paths, the text as the font's outlines */
export function pagesPdf(pages: Page[]): Uint8Array {
  const objects: (string | Uint8Array)[] = [];
  const add = (o: string | Uint8Array) => objects.push(o) - 1 + 1;
  const catalog = add('');
  const tree = add('');
  const kids: number[] = [];
  for (const p of pages) {
    const ops: string[] = ['1 J 1 j'];
    for (const it of p.items) {
      const path = it.rings
        .map(
          (ring) =>
            `${ring.map(([x, y], i) => `${num(x)} ${num(p.h - y)} ${i ? 'l' : 'm'}`).join(' ')}${it.fill ? ' h' : ''}`,
        )
        .join(' ');
      if (it.fill) {
        const [r, g, b] = rgb(it.fill);
        const outline = it.stroke && it.width > 0;
        const [sr, sg, sb] = outline ? rgb(it.stroke) : [0, 0, 0];
        ops.push(
          `${num(r)} ${num(g)} ${num(b)} rg${outline ? ` ${num(sr)} ${num(sg)} ${num(sb)} RG ${num(it.width)} w` : ''} ${path} ${outline ? 'b*' : 'f*'}`,
        );
      } else {
        const [r, g, b] = rgb(it.stroke);
        ops.push(`${num(r)} ${num(g)} ${num(b)} RG ${num(Math.max(0.3, it.width))} w ${path} S`);
      }
    }
    const data = deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
    const stream = add(
      Buffer.concat([
        Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
        data,
        Buffer.from('\nendstream', 'latin1'),
      ]),
    );
    kids.push(
      add(
        `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${num(p.w)} ${num(p.h)}] /Contents ${stream} 0 R /Resources << >> >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objects[tree - 1] =
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let at = parts[0].length;
  objects.forEach((o, i) => {
    offsets.push(at);
    const body = typeof o === 'string' ? Buffer.from(o, 'latin1') : Buffer.from(o);
    const chunk = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, 'latin1'),
      body,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    parts.push(chunk);
    at += chunk.length;
  });
  const xref = [
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${at}\n%%EOF\n`,
  ].join('');
  parts.push(Buffer.from(xref, 'latin1'));
  return new Uint8Array(Buffer.concat(parts));
}

/** A page as a PNG `width` pixels wide */
export function pagePng(page: Page, width = 1240): Uint8Array {
  const k = width / page.w;
  return pngOf(Math.round(page.w * k), Math.round(page.h * k), (cv) => {
    for (const it of page.items) {
      const rings = it.rings.map((ring) =>
        ring.map(([x, y]) => [x * k, y * k] as [number, number]),
      );
      if (it.fill) {
        cv.fill(rings, hexRgb(it.fill), 1);
        if (it.stroke && it.width > 0)
          for (const ring of rings)
            cv.line([...ring, ring[0]], hexRgb(it.stroke), Math.max(1, it.width * k));
      } else for (const ring of rings) cv.line(ring, hexRgb(it.stroke), Math.max(1, it.width * k));
    }
  });
}

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
