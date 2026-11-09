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

const collides = (src) => render(src).warnings.some((w) => /collide/.test(w));

test('a cam lifts its roller as its lift curve says, all the way round', () => {
  const lift = 'function(a) cam_rise(a, 0, 90, 8) - cam_rise(a, 180, 300, 8)';
  for (const a of [0, 45, 120, 200, 330])
    for (const dz of [0.3, -0.3]) {
      const src = `use <kerf/gears>\n$fn = 48;\nL = ${lift};
        part("cam", rotate = [0, 0, ${a}]) cam(L, 25, "roller", 12, steps = 360);
        part("roller", at = [0, cam_follower(L, 25, ${a}, 12) + ${dz}, 0]) circle(d = 12);`;
      assert.equal(collides(src), dz < 0, `at ${a} lifted ${dz}`);
    }
  const [p] = echo(
    `use <kerf/gears>\necho(cam_follower(${lift}, 25, 90), cam_pressure(${lift}, 25) < 30);`,
  );
  assert.equal(p, '33, true');
});

test('a Geneva wheel steps one slot a turn and clears its driver', () => {
  for (const n of [4, 6]) {
    for (let a = -180; a < 180; a += 15) {
      const src = `use <kerf/gears>\n$fn = 48; n = ${n}; C = 60; a = ${a};
        part("wheel", at = [C, 0, 0], rotate = [0, 0, geneva_turn(n, C, a)]) geneva_wheel(n, C, 6);
        part("lock", rotate = [0, 0, a]) geneva_lock(n, C, 6);`;
      assert.ok(!collides(src), `${n} slots at ${a}`);
    }
    const [turn] = echo(
      `use <kerf/gears>\necho(geneva_turn(${n}, 60, 0), geneva_turn(${n}, 60, 360));`,
    );
    assert.equal(turn, `0, ${-360 / n}`);
  }
  assert.throws(() => render('use <kerf/gears>\ngeneva_lock(8, 60, 6);'), /bore of at most 4.5 mm/);
});

test('a Geneva pin runs in the slots without touching the wheel', () => {
  for (const n of [4, 6])
    for (let a = -180; a < 180; a += 5) {
      const src = `use <kerf/gears>\n$fn = 48; n = ${n}; C = 60; a = ${a}; rc = geneva_pin_radius(n, C);
        part("wheel", at = [C, 0, 0], rotate = [0, 0, geneva_turn(n, C, a)]) geneva_wheel(n, C, 6);
        part("pin", at = [rc * cos(a), rc * sin(a), 0]) circle(d = 6);`;
      assert.ok(!collides(src), `${n} slots at ${a}`);
    }
});

test('Geneva parts say how to fix sizes that will not work', () => {
  // More slots move the slots' ends away from the axle
  assert.throws(
    () => render('use <kerf/gears>\ngeneva_wheel(4, 30, 6, bore = 8);'),
    /use more slots/,
  );
  render('use <kerf/gears>\ngeneva_wheel(6, 30, 6, bore = 8);');
  // The locking disc checks its own bore, not the wheel's
  assert.throws(
    () => render('use <kerf/gears>\ngeneva_lock(6, 30, 10, bore = 5);'),
    /locking disc is too small/,
  );
  render('use <kerf/gears>\ngeneva_wheel(6, 30, 10, bore = 5);');
  assert.throws(() => render('use <kerf/gears>\ngeneva_wheel(6, 30, 16);'), /pin is too thick/);
});

test('a pawl stops its ratchet turning back but lets it turn on', () => {
  const src = (rot, lift = 0) => `use <kerf/gears>\n$fn = 32;
    H = pawl_pivot(12, 30, 5);
    part("wheel", rotate = [0, 0, ${rot}]) ratchet(12, 30, 5);
    part("pawl", at = [H[0], H[1], 0] - [H[0] * cos(${lift}) - H[1] * sin(${lift}), H[0] * sin(${lift}) + H[1] * cos(${lift}), 0], rotate = [0, 0, ${lift}]) pawl(12, 30, 5);`;
  assert.ok(!collides(src(0)));
  assert.ok(collides(src(-1)), 'turning back runs into the pawl');
  // Turning on, the pawl swings up over the tooth
  assert.ok(collides(src(15)));
  assert.ok(!collides(src(15, -8)));
});

test('a pawl on a small ratchet grows long enough to clear the teeth', () => {
  const [len] = echo('use <kerf/gears>\necho(pawl_min_length(8, 10, 3) > 0.8 * 10);');
  assert.equal(len, 'true');
  // Its outline is a simple shape: the far end lies beyond the tip edge
  const [ok] = echo(`use <kerf/gears>\np = pawl_points(8, 10, 3);
    echo(norm(p[1] - p[0]) > norm(p[2] - p[3]));`);
  assert.equal(ok, 'true');
  const src = (rot) => `use <kerf/gears>\n$fn = 32;
    part("wheel", rotate = [0, 0, ${rot}]) ratchet(8, 10, 3);
    part("pawl", at = [0, 0, 0]) pawl(8, 10, 3);`;
  assert.ok(!collides(src(0)));
  // 3 degrees: on a wheel this small, 1 degree moves the face less than the clearance
  assert.ok(collides(src(-3)), 'turning back runs into the pawl');
  assert.throws(
    () => render('use <kerf/gears>\npawl(8, 10, 3, length = 6);'),
    /at least [\d.]+ mm long/,
  );
});

test('kerf/fit scales and places drawings by their box', () => {
  const box = (src) => {
    const r = render(`use <kerf/fit>\npart("a") ${src}`);
    assert.deepEqual(r.warnings, []);
    return [r.parts[0].width, r.parts[0].height];
  };
  assert.deepEqual(box('fit([40, 40]) translate([100, 50]) square([20, 10]);'), [40, 20]);
  assert.deepEqual(
    box('fit([40, 40], mode = "stretch") translate([100, 50]) square([20, 10]);'),
    [40, 40],
  );
  const at = (src) =>
    render(`use <kerf/fit>\npart("a") { square(1); measure() { ${src}; echo($bounds); } }`)
      .echoes[0];
  assert.equal(at('align("top-right") translate([50, 50]) square([10, 4])'), '[-10, -4, 0, 0]');
  assert.equal(at('align() translate([50, 50]) square([10, 4])'), '[-5, -2, 5, 2]');
  assert.equal(
    at('fit(20, anchor = "center") translate([7, 7]) square([10, 4])'),
    '[-10, -4, 10, 4]',
  );
  assert.throws(
    () => render('use <kerf/fit>\npart("a") align("middle") square(3);'),
    /Unknown anchor/,
  );
});
