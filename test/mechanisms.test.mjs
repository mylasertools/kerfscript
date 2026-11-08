// Mechanism and measuring helpers: ball hardware, measure()'s area and
// centroid, offset_path(), train_for() and the kerf/gears mechanism parts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../dist/index.js';

const near = (a, b, tolerance = 1e-6) => {
  if (Array.isArray(a)) return a.forEach((x, i) => near(x, b[i], tolerance));
  assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b}`);
};
const echo = (src) => {
  const r = render(src);
  return r.echoes;
};

test('a ball of hardware sits at its centre with sides = 0', () => {
  const r = render(
    'part("p") square(5); hardware("bulb", [0, 0, 100], size = 60, shape = "ball"); hardware("ball", [0, 0, 0], [0, 0, 10], 16, sides = 0);',
  );
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(
    r.hardware.map((h) => [h.kind, h.from, h.to, h.sides]),
    [
      ['bulb', [0, 0, 100], [0, 0, 100], 0],
      ['ball', [0, 0, 5], [0, 0, 5], 0],
    ],
  );
  assert.throws(
    () => render('hardware("ball", [0, 0, 0], size = [3, 4], shape = "ball");'),
    /diameter/,
  );
  assert.throws(() => render('hardware("ball", [0, 0, 0], shape = "cube");'), /"rod" or "ball"/);
  // A rod still needs its other end
  assert.throws(() => render('hardware("dowel", [0, 0, 0]);'));
});

test('measure() gives the area and centroid of the material', () => {
  const [l] = echo(
    'measure() { difference() { square(20); translate([10, 0]) square(10); } echo($area, $centroid); }',
  );
  assert.equal(l, '300, [8.333333333, 11.66666667]');
  // Holes count against it, and a ring balances at its centre
  const [ring] = echo(
    '$fn = 96; measure() { translate([5, -3]) difference() { circle(r = 10); circle(r = 5); } echo($area, $centroid); }',
  );
  const [a, x, y] = ring.match(/-?[\d.e-]+/g).map(Number);
  near(a, 0.75 * Math.PI * 100, 2);
  near([x, y], [5, -3], 1e-6);
});

test('offset_path moves a path to its left with mitred corners', () => {
  assert.deepEqual(echo('echo(offset_path([[0, 0], [10, 0], [10, 10]], 1));'), [
    '[[0, 1], [9, 1], [9, 10]]',
  ]);
  // A closed square grows outwards to its right, and keeps its last point
  assert.deepEqual(
    echo('echo(offset_path([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], -1, true));'),
    ['[[-1, -1], [11, -1], [11, 11], [-1, 11], [-1, -1]]'],
  );
  // A hairpin's mitre stops at four times d
  const [hairpin] = echo('echo(offset_path([[0, 0], [10, 0], [0, 0.01]], 1)[1]);');
  const [x, y] = hairpin.match(/-?[\d.e-]+/g).map(Number);
  assert.ok(Math.hypot(x - 10, y) <= 4 + 1e-9);
});

test('train_for finds tooth counts for a ratio', () => {
  assert.deepEqual(echo('t = train_for(12); echo(t.stages, t.ratio, t.error);'), [
    '[[10, 30], [10, 40]], 12, 0',
  ]);
  const [year] = echo('t = train_for(365.25, 3); echo(t.ratio, abs(t.error) < 0.0001);');
  assert.match(year, /, true$/);
  // Under 1 speeds up: the wheel drives
  assert.deepEqual(echo('echo(train_for(1 / 3, 1).stages);'), ['[[30, 10]]']);
  assert.throws(() => render('echo(train_for(1000, 1));'), /no train of 1 stages/);
  assert.throws(() => render('echo(train_for(10, 4));'), /1, 2 or 3/);
});

test('kerf/linkage finds where links meet', () => {
  const [meet, apart, slider, bar, turns] = echo(`use <kerf/linkage>
    echo(circle_meet([0, 0], 5, [8, 0], 5), circle_meet([0, 0], 5, [8, 0], 5, -1));
    echo(circle_meet([0, 0], 1, [8, 0], 1));
    echo(slider_crank(10, 40, 0), slider_stroke(10, 40));
    echo(four_bar(40, 10, 40, 30, 0));
    echo(four_bar_turns(40, 10, 40, 30), four_bar_turns(40, 30, 10, 30));`);
  assert.equal(meet, '[4, 3], [4, -3]');
  assert.equal(apart, 'undef');
  assert.equal(slider, '[[10, 0], [50, 0]], 20');
  // The coupler and rocker keep their lengths
  const [bx, by, cx, cy] = bar.match(/-?[\d.e-]+/g).map(Number);
  near(Math.hypot(cx - bx, cy - by), 40);
  near(Math.hypot(cx - 40, cy), 30);
  assert.equal(turns, 'true, false');
});

test('cone_flat rolls up to its radii', () => {
  const [p] = echo('use <kerf/cones>\necho(cone_pattern(60, 20, 80));');
  const [R1, R2, a, s] = p.match(/-?[\d.e-]+/g).map(Number);
  near((R1 * a * Math.PI) / 180, 2 * Math.PI * 60);
  near((R2 * a * Math.PI) / 180, 2 * Math.PI * 20);
  near(s, Math.hypot(80, 40));
  for (const src of [
    'cone_flat(60, 20, 80, tab = 8)',
    'cone_flat(40, 0, 60, tab = 8)',
    'cone_flat(30, 30, 50, tab = 8)',
  ]) {
    const r = render(`use <kerf/cones>\n$fn = 64;\npart("c") ${src};`);
    assert.deepEqual(r.warnings, [], src);
    assert.equal(r.parts[0].pieces, 1, src);
  }
});

test('part_size gives bought parts by name', () => {
  assert.deepEqual(
    echo('use <kerf/sizes>\nm = part_size("Quartz-Clock");\necho(m.body, m.hole);'),
    ['[56, 56, 16], 8'],
  );
  assert.throws(() => render('use <kerf/sizes>\necho(part_size("x"));'), /Unknown part "x"/);
});

test('part(material = ...) names its own material', () => {
  const r = render(
    '$material = "ply"; part("a", material = "red acrylic") square(5); part("b") square(5);',
  );
  assert.deepEqual(
    r.parts.map((p) => [p.name, p.material]),
    [
      ['a', 'red acrylic'],
      ['b', 'ply'],
    ],
  );
});
