// Stored summaries of every example's output, so a change that alters a
// saved design shows up in a test. Run `npm run snapshots` after a change
// that is meant to alter output, and commit test/snapshots/examples.json.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render } from '../dist/index.js';

export const SNAPSHOTS = 'test/snapshots/examples.json';

const round = (n) => Math.round(n * 100) / 100;

// Area of the closed paths and length of the open ones in an SVG path string
function measure(d) {
  let area = 0;
  let length = 0;
  for (const sub of d.split('M').filter(Boolean)) {
    const closed = sub.endsWith('Z');
    const pts = sub
      .replace('Z', '')
      .split('L')
      .map((p) => p.trim().split(/\s+/).map(Number));
    let ring = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const next = pts[(i + 1) % pts.length];
      if (closed) ring += x1 * next[1] - next[0] * y1;
      else if (i + 1 < pts.length) length += Math.hypot(next[0] - x1, next[1] - y1);
    }
    area += ring / 2;
  }
  return { area: round(Math.abs(area)), length: round(length) };
}

export function summarize(name) {
  const font = readFileSync('fonts/AtkinsonHyperlegible-Regular.ttf');
  const r = render(readFileSync(`examples/${name}`, 'utf8'), { fonts: { atkinson: font } });
  const layers = {};
  for (const sheet of r.sheets)
    for (const p of sheet.paths) {
      if (!p.d) continue;
      const m = measure(p.regions);
      const l = measure(p.lines);
      const sum = (layers[p.name] ??= { area: 0, length: 0 });
      sum.area = round(sum.area + m.area);
      sum.length = round(sum.length + l.length);
    }
  return {
    parts: r.parts.map((p) => ({
      name: p.name,
      qty: p.qty,
      size: [p.width, p.height],
      pieces: p.pieces,
      cut: p.cutLength,
      thickness: p.thickness,
      kerf: p.kerf,
      material: p.material,
    })),
    sheets: r.sheets.length,
    layers,
    echoes: r.echoes,
    warnings: r.warnings,
  };
}

export const examples = () =>
  readdirSync('examples')
    .filter((f) => f.endsWith('.kerf'))
    .sort();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = {};
  for (const name of examples()) out[name] = summarize(name);
  writeFileSync(SNAPSHOTS, JSON.stringify(out, null, 1) + '\n');
  console.log(`Wrote ${SNAPSHOTS} for ${examples().length} examples`);
}
