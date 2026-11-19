// kerf/inlay: inlays cut through a part or engraved as pockets

import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../dist/index.js';

const src = (body) => `use <kerf/inlay>\nuse <kerf/shapes>\n$thickness = 3;\n${body}`;

test('a through inlay: a hole in the part, an insert a press fit bigger in it', () => {
  const r = render(
    src(
      'inlaid("plaque", materials = ["walnut"]) { rect([80, 60], r = 5); translate([40, 30]) circle(d = 30); }',
    ),
  );
  assert.deepEqual(r.warnings, []);
  const [plaque, insert] = r.parts;
  assert.equal(insert.name, 'plaque inlay 1');
  assert.deepEqual([insert.width, insert.material, insert.thickness], [30.1, 'walnut', 3]);
  // The plaque has the hole
  const it = r.sheets.flatMap((s) => s.items).find((i) => i.part === 'plaque');
  assert.equal(it.layers.get('cut').regions.length, 2);
  // In its hole in the assembly
  assert.deepEqual(
    r.assembly.map((a) => a.matrix[11]),
    [0, 0],
  );
  assert.equal(plaque.width, 80);
});

test('pocket inlays: engraved on the layer "pocket", inserts as thick as the pocket', () => {
  const r = render(
    src(
      'inlaid("coaster", depth = 1.5, paints = ["red", "green"]) { circle(d = 90); translate([-15, 0]) circle(10); translate([15, 0]) circle(10); }',
    ),
  );
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(
    r.parts.map((p) => [p.name, p.thickness, p.paint]),
    [
      ['coaster', 3, undefined],
      ['coaster inlay 1', 1.5, '#c8372d'],
      ['coaster inlay 2', 1.5, '#3f8f4a'],
    ],
  );
  const it = r.sheets.flatMap((s) => s.items).find((i) => i.part === 'coaster');
  assert.equal(it.layers.get('pocket').regions.length, 2);
  assert.throws(() => render('part("x", press_fit = true) rect(10);'), /press_fit goes with glue/);
});
