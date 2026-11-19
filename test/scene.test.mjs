// kerf/scene: floors with rails, standees with feet, layered figures in
// the rails

import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../dist/index.js';

const src = (body) => `use <kerf/scene>\n$thickness = 3;\n${body}`;

test('rails run in six rows, 8 mm from the front and 7 from the back', () => {
  assert.deepEqual(render(src('echo(scene_rows(90), scene_rows(50, 1));')).echoes, [
    '[8, 23, 38, 53, 68, 83], [25]',
  ]);
  const r = render(src('part("floor") scene_floor(200, 90);'));
  assert.deepEqual(r.warnings, []);
  assert.deepEqual([r.parts[0].width, r.parts[0].height], [200, 90]);
});

test('standee feet: one under 28 mm, two over, three across a backdrop', () => {
  assert.deepEqual(
    render(src('echo(standee_feet(20), standee_feet(40), standee_feet(60, true));')).echoes,
    ['[0], [-10, 10], [-20, 0, 20]'],
  );
  // A narrow standee stands 4.5 mm up, its foot 3 mm into the rail
  const narrow = render(src('part("s") standee() circle(d = 20);')).parts[0];
  assert.deepEqual([narrow.height, narrow.pieces], [20 + 4.5 + 3, 1]);
  // Two legs apart stand on a ground line joining them
  const legs = render(
    src(
      'part("s") standee() { translate([-20, 0]) rect([6, 30]); translate([14, 0]) rect([6, 30]); translate([-20, 24]) rect([40, 6]); }',
    ),
  );
  assert.deepEqual(legs.warnings, []);
  // Clipped to a case, the feet left whole
  const clipped = render(
    src(
      'part("s") standee(clip = [[-50, 0], [50, 0], [50, 10], [-50, 10]]) rect([60, 40], center = true);',
    ),
  ).parts[0];
  assert.deepEqual([clipped.width, clipped.height], [60, 13]);
});

test('every figure stands in a rail, its layers glued on its front', () => {
  const names = render('use <kerf/figures>\necho(figure_names());')
    .echoes[0].slice(1, -1)
    .split(', ')
    .map((s) => s.slice(1, -1));
  for (const n of names) {
    const r = render(src(`scene_figure("${n}", 40, at = [0, 23, 3]);`));
    assert.deepEqual(r.warnings, [], n);
  }
  const r = render(src('scene_figure("bunny", 60, at = [10, 23, 3]);'));
  const outline = r.assembly.find((p) => p.name === 'bunny outline');
  // Standing up, its thickness centred on the rail, its feet into the floor
  const m = outline.matrix;
  assert.deepEqual([m[3], m[7], m[11]], [10, 24.5, 3]);
  assert.ok(r.parts.find((p) => p.name === 'bunny outline').height > 60);
});

test('a figure on a base, and drip and wave edges', () => {
  const r = render(src('figure_base("chick", 60);'));
  assert.deepEqual(r.warnings, []);
  assert.ok(r.parts.some((p) => p.name === 'chick base'));
  const d = render(src('part("snow") drip_edge(120, 6, 10);')).parts[0];
  assert.equal(d.width, 120);
  assert.ok(d.height > 9 && d.height <= 16 && d.pieces === 1);
  const w = render(src('part("wave") wave_edge(120, 6, 4);')).parts[0];
  assert.deepEqual([w.width, w.height, w.pieces], [120, 10, 1]);
});
