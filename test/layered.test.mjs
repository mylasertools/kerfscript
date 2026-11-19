// kerf/layered: multilayer art from one drawing

import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../dist/index.js';

const SRC = `use <kerf/layered>
$thickness = 3;
layered("tree", colors = ["dark green", "green", "light green", "gold"], shadow = 2, hole = [0, 30, 4]) {
  regular_polygon(3, 40);
  translate([0, 8]) regular_polygon(3, 28);
  translate([0, 16]) regular_polygon(3, 16);
  translate([0, 40]) star(5, 7, 3);
}`;

test('each layer a part, glued on the one behind, grown to hold up the ones in front', () => {
  const r = render(SRC);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(
    r.parts.map((p) => [p.name, p.glued, p.paint]),
    [
      ['tree shadow', undefined, '#4a4a4a'],
      ['tree layer 1', 'tree shadow', '#24582f'],
      ['tree layer 2', 'tree layer 1', '#3f8f4a'],
      ['tree layer 3', 'tree layer 2', '#8cc06a'],
      ['tree layer 4', 'tree layer 3', '#c9a227'],
    ],
  );
  assert.deepEqual(
    r.assembly.map((a) => a.matrix[11]),
    [0, 3, 6, 9, 12],
  );
  // Each layer is bigger than the one in front of it
  const w = r.parts.map((p) => p.width);
  assert.ok(
    w.every((x, i) => i === 0 || x < w[i - 1]),
    `${w}`,
  );
  // The hole goes through the layers that reach it
  const holes = r.sheets
    .flatMap((s) => s.items)
    .filter((it) => /layer [12]$/.test(it.part))
    .map((it) => it.layers.get('cut').regions.length);
  assert.ok(
    holes.every((n) => n >= 2),
    `${holes}`,
  );
});

test('without colours the layers go from dark at the back to light at the front', () => {
  const r = render('use <kerf/layered>\nlayered("t") { circle(20); circle(10); circle(4); }');
  assert.deepEqual(
    r.parts.map((p) => p.paint),
    ['#4a2e1a', '#d2b48c', '#f7f7f4'],
  );
});
