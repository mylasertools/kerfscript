// openscad/kerfscript.scad draws KerfScript's 2D shapes in OpenSCAD as
// KerfScript draws them. Runs when OpenSCAD is installed (OPENSCAD names
// its program, or it is found in the usual places), and is skipped if not.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { render } from '../dist/index.js';

const OPENSCAD = [
  process.env.OPENSCAD,
  'C:/Program Files/OpenSCAD/openscad.com',
  '/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD',
  '/usr/bin/openscad',
  '/usr/local/bin/openscad',
].find((p) => p && existsSync(p));

const LIBRARY = resolve('openscad/kerfscript.scad').split('\\').join('/');

// Area and box of the shapes in OpenSCAD's SVG
function svgShape(svg) {
  let area = 0;
  let box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [, d] of svg.matchAll(/ d="([^"]+)"/g))
    for (const sub of d.split(/[Mm]/).filter((x) => x.trim())) {
      const pts = [...sub.matchAll(/(-?[\d.e+-]+),(-?[\d.e+-]+)/g)].map((m) => [
        Number(m[1]),
        -Number(m[2]),
      ]);
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % pts.length];
        area += (x0 * y1 - x1 * y0) / 2;
      }
      for (const [x, y] of pts)
        box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
    }
  return { area: Math.abs(area), box };
}

const CASES = [
  'rect([30, 20], r = 4)',
  'rect(15, center = true)',
  'ellipse(d = [30, 12])',
  'regular_polygon(6, 10)',
  'star(7, 20, 12)',
  'stroke(1) line([0, 0], [30, 10])',
  'line([0, 0], [30, 10], width = 3)',
  'stroke(1) polyline([[0, 0], [20, 0], [20, 15]], closed = true)',
  'stroke(1) arc(20, 0, 135)',
  'stroke(1) outline() rect([30, 20])',
  'path("M0 0 h40 v30 h-40 z M10 10 h20 v10 h-20 z")',
  'path("M0 0 C 10 20 30 20 40 0 Q 20 -15 0 0 Z")',
  'path("M0 0 A 15 10 30 1 0 20 5 Z")',
  'path("m10 10 l10 0 10 10 -10 10z")',
  'path("M0 0 C 0 10 10 10 10 0 S 20 -10 20 0 L20 -20 L0 -20 Z")',
  'path("M0,0L1e1,0L5-8.5e0z")',
  'path("M0 0 L20 0 L20 10", close = true)',
  'square([lerp(10, 20, 0.5), 5])',
  'part("a", at = [0, 0, 0]) { rect(20); engrave() translate([10, 10]) circle(5); score() line([2, 2], [6, 6]); }',
];

test(
  'KerfScript shapes come out the same in OpenSCAD',
  { skip: !OPENSCAD && 'OpenSCAD not found' },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'kerf-openscad-'));
    for (const src of CASES) {
      const k = render(`$fn = 64;\nmeasure() { ${src}; echo($bounds, $area); }`, { kerf: 0 });
      const [kb, ka] = JSON.parse(`[${k.echoes[0]}]`);
      writeFileSync(join(dir, 'c.scad'), `include <${LIBRARY}>\n$fn = 64;\n${src};\n`);
      execFileSync(OPENSCAD, ['-o', join(dir, 'c.svg'), join(dir, 'c.scad')], { stdio: 'pipe' });
      const o = svgShape(readFileSync(join(dir, 'c.svg'), 'utf8'));
      // Engraving and scoring are drawn on top in OpenSCAD: compare the part
      const area = src.startsWith('part') ? 400 : ka;
      assert.ok(Math.abs(o.area - area) / area < 0.01, `${src}: area ${o.area} and ${area}`);
      for (let i = 0; i < 4; i++)
        assert.ok(Math.abs(o.box[i] - kb[i]) < 0.05, `${src}: box ${o.box} and ${kb}`);
    }
  },
);
