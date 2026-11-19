// The standard library in lib/kerf: each library's modules make the parts
// they describe, the joints between them fit, and the examples built on
// them stay put together.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse, render } from '../dist/index.js';

const font = { fonts: { atkinson: readFileSync('fonts/AtkinsonHyperlegible-Regular.ttf') } };

// One copy of a part, as cut: its layers' regions and lines
function piece(result, name) {
  for (const sheet of result.sheets)
    for (const item of sheet.items) if (item.part === name) return Object.fromEntries(item.layers);
  assert.fail(`no part ${name}`);
}
const area = (p) =>
  Math.abs(
    p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0),
  ) / 2;
// The holes in one piece of material, largest outline first
const holes = (layer) =>
  layer.regions
    .map(area)
    .sort((a, b) => b - a)
    .slice(1);
const near = (a, b, tolerance = 0.01) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b}`);
const collisions = (r) => r.warnings.filter((w) => /collide/.test(w));
const size = (r, name) => {
  const p = r.parts.find((x) => x.name === name);
  return [Math.round(p.width * 100) / 100, Math.round(p.height * 100) / 100];
};

test('every module and function in the standard library has a comment above it', () => {
  for (const file of readdirSync('lib/kerf')) {
    const src = readFileSync(`lib/kerf/${file}`, 'utf8').replace(/\r\n/g, '\n');
    const lines = src.split('\n');
    for (const s of parse(src).program.body)
      if (s.kind === 'module' || s.kind === 'function')
        assert.match(lines[s.pos.line - 2] ?? '', /^\/\//, `${file}: ${s.name}`);
  }
});

test('docs/library.md documents every module and function', () => {
  const doc = readFileSync('docs/library.md', 'utf8');
  for (const file of readdirSync('lib/kerf')) {
    assert.ok(doc.includes(`kerf/${file.slice(0, -5)}`), file);
    for (const s of parse(readFileSync(`lib/kerf/${file}`, 'utf8')).program.body)
      if (s.kind === 'module' || s.kind === 'function')
        assert.ok(doc.includes(`\`${s.name}(`), `${file}: ${s.name}()`);
  }
});

// kerf/tabs

test('tab_positions spreads tabs evenly, one for every 50 mm by default', () => {
  const r = render(
    'use <kerf/tabs>\necho(tab_positions(100), tab_positions(20), tab_positions(90, 3));',
  );
  assert.deepEqual(r.echoes, ['[25, 75], [10], [15, 45, 75]']);
  assert.throws(
    () => render('use <kerf/tabs>\necho(tab_positions(90, 0));'),
    /count must be at least 1/,
  );
});

test('tab_rect adds a thickness on each side with tabs, in one piece', () => {
  const r = render(
    'use <kerf/tabs>\n$thickness = 4;\npart("a") tab_rect([100, 40], [false, true, false, true]);\npart("b") tab_rect([100, 40]);',
  );
  assert.deepEqual(size(r, 'a'), [108, 40]);
  assert.deepEqual(size(r, 'b'), [108, 48]);
  assert.deepEqual(
    r.parts.map((p) => p.pieces),
    [1, 1],
  );
  // Two tabs on each long edge, one on each short one, each half the spacing
  near(area(piece(r, 'b').cut.regions[0]), 100 * 40 + 4 * 25 * 4 + 2 * 20 * 4);
});

test('slots() are the tabs plus clearance, where tabs() are', () => {
  const r = render(
    'use <kerf/tabs>\n$thickness = 3;\ndifference() { rect([100, 20]); translate([0, 10]) slots(100, clearance = 0.2); }',
  );
  const cut = holes(piece(r, 'part').cut);
  assert.equal(cut.length, 2);
  for (const a of cut) near(a, 25.2 * 3.2);
});

// A shelf standing in a side panel's slots
const shelf = (clearance) => `use <kerf/tabs>
$thickness = 3;
part("side", rotate = [90, 0, 90]) difference() {
  rect([60, 80]);
  translate([0, 31.5]) slots(60, clearance = ${clearance});
}
part("shelf", at = [-50, 0, 30]) tab_rect([50, 60], [false, true, false, false]);`;

test('a tab_rect fits the slots() cut for it', () => {
  assert.deepEqual(collisions(render(shelf(0.1))), []);
  assert.equal(collisions(render(shelf(-0.5))).length, 1);
});

// kerf/hinge

test('bend_length is the arc along the middle of the sheet', () => {
  const r = render(
    'use <kerf/hinge>\n$thickness = 3;\necho(bend_length(10), bend_length(10, 180));',
  );
  const [a, b] = r.echoes[0].split(', ').map(Number);
  near(a, (Math.PI * 11.5) / 2, 1e-6);
  near(b, Math.PI * 11.5, 1e-6);
});

test('flex_rect cuts a living hinge across each bend, in one piece', () => {
  // Without a margin, so the piece is where it was drawn
  const r = render('use <kerf/hinge>\nflex_rect([160, 100], [50, 110], width = 20, r = 4);', {
    margin: 0,
  });
  const { cut } = piece(r, 'part');
  assert.equal(r.parts[0].pieces, 1);
  const xs = cut.lines.map((l) => l[0][0]);
  assert.ok(xs.length > 40);
  assert.ok(xs.every((x) => (x > 40 && x < 60) || (x > 100 && x < 120)));
  assert.deepEqual(r.warnings, []);
});

test('flex_box: a strip as long as the way round, slots for every tab', () => {
  const r = render('use <kerf/hinge>\n$thickness = 3;\nflex_box([120, 80, 60], r = 15);');
  assert.deepEqual(
    r.parts.map((p) => p.name),
    ['side', 'bottom', 'lid', 'lid insert'],
  );
  const b = (Math.PI * 13.5) / 2;
  assert.deepEqual(size(r, 'side'), [Math.round((2 * 90 + 2 * 50 + 4 * b) * 100) / 100, 57]);
  assert.deepEqual(size(r, 'bottom'), [120, 80]);
  assert.deepEqual(size(r, 'lid'), [120, 80]);
  assert.deepEqual(size(r, 'lid insert'), [113.8, 73.8]);
  // Two tabs on the front and back, one on each side
  assert.equal(holes(piece(r, 'side').cut).length, 6);
  near(
    area(piece(r, 'bottom').cut.regions[0]),
    114 * 74 - (4 - Math.PI) * 12 * 12 + 4 * 22.5 * 3 + 2 * 25 * 3,
    0.5,
  );
  assert.deepEqual(r.warnings, []);
  assert.throws(
    () => render('use <kerf/hinge>\nflex_box([100, 80, 50], r = 5);'),
    /r must be more/,
  );
});

// kerf/dividers

const grid = (extra = '') =>
  render(
    `use <kerf/dividers>\n$thickness = 3;\ngrid_dividers([200, 120, 40], cols = 4, rows = 3${extra});`,
  );

test('grid_dividers makes rows - 1 and cols - 1 dividers that fit together', () => {
  const r = grid();
  assert.deepEqual(
    r.parts.map((p) => [p.name, p.qty, p.pieces]),
    [
      ['long divider', 2, 1],
      ['cross divider', 3, 1],
    ],
  );
  assert.deepEqual(size(r, 'long divider'), [199, 40]);
  assert.deepEqual(size(r, 'cross divider'), [119, 40]);
  assert.equal(holes(piece(r, 'long divider').cut).length, 0);
  assert.deepEqual(r.warnings, []);
  // Scoops dip into the top of every compartment
  const scooped = grid(', scoops = true');
  assert.ok(
    area(piece(scooped, 'long divider').cut.regions[0]) <
      area(piece(r, 'long divider').cut.regions[0]) - 4 * 100,
  );
  assert.deepEqual(collisions(grid(', clearance = 0')), []);
});

test('dividers without their slots collide', () => {
  const r = render(`use <kerf/dividers>
$thickness = 3;
part("a", rotate = [90, 0, 0], at = [0, 30, 0]) slotted_divider(100, 40, [], "top");
part("b", rotate = [90, 0, 90], at = [48.5, 0, 0]) slotted_divider(60, 40, [], "bottom");`);
  assert.equal(collisions(r).length, 1);
  const fixed = render(`use <kerf/dividers>
$thickness = 3;
part("a", rotate = [90, 0, 0], at = [0, 30, 0]) slotted_divider(100, 40, [50], "top");
part("b", rotate = [90, 0, 90], at = [48.5, 0, 0]) slotted_divider(60, 40, [28.5], "bottom");`);
  assert.deepEqual(collisions(fixed), []);
});

test('one compartment needs no dividers', () => {
  assert.deepEqual(render('use <kerf/dividers>\ngrid_dividers([100, 100, 30], 1, 1);').parts, []);
});

// kerf/hanging

test('keyhole: a round hole for the head and a slot up to where the screw rests', () => {
  const r = render(
    'use <kerf/hanging>\n$fn = 360;\nkeyhole([20, 30], head = 9, shank = 4, drop = 10) rect([40, 40]);',
  );
  const [hole] = holes(piece(r, 'part').cut);
  // The head's circle, the slot up from its centre less the part inside
  // the circle, and the slot's round end
  const inside = 2 * Math.sqrt(4.5 ** 2 - 2 ** 2) + 4.5 ** 2 * Math.asin(2 / 4.5);
  near(hole, Math.PI * 4.5 ** 2 + 4 * 10 - inside + (Math.PI * 2 ** 2) / 2, 0.05);
  assert.throws(() => render('use <kerf/hanging>\nkeyhole(drop = 3);'), /drop must be at least/);
});

test('the hanging modules cut their holes, or make them when given nothing', () => {
  const r = render(`use <kerf/hanging>
part("keyholes") keyholes(80, at = [50, 40]) rect([100, 50]);
part("holes") hanging_hole([50, 40], spacing = 60) rect([100, 50]);
part("hole") hanging_hole([50, 40]) rect([100, 50]);
part("alone") difference() { rect([30, 30]); translate([15, 20]) keyhole(); }
part("bare") keyhole();`);
  assert.deepEqual(
    ['keyholes', 'holes', 'hole', 'alone'].map((n) => holes(piece(r, n).cut).length),
    [2, 2, 1, 1],
  );
  assert.deepEqual(size(r, 'bare'), [9, 16.75]);
});

test('hanging_loop keeps its hole open where the ring overlaps the shape', () => {
  const r = render(
    'use <kerf/hanging>\n$fn = 96;\nhanging_loop([0, 26], d = 4, wall = 3) circle(d = 50);',
  );
  assert.equal(r.parts[0].pieces, 1);
  assert.deepEqual(size(r, 'part'), [50, 56]);
  // The hole crosses the circle's edge, and is still cut
  assert.equal(holes(piece(r, 'part').cut).length, 1);
});

// kerf/enclosure

test('enclosure: six panels under a lid that overhangs them by the screw', () => {
  const r = render('use <kerf/enclosure>\n$thickness = 3;\nenclosure([150, 100, 60]);');
  assert.deepEqual(
    r.parts.map((p) => [p.name, ...size(r, p.name)]),
    [
      ['bottom', 144, 94],
      ['lid', 150, 100],
      ['front', 144, 57],
      ['back', 144, 57],
      ['left', 94, 57],
      ['right', 94, 57],
    ],
  );
  assert.deepEqual(r.warnings, []);
  // Two screws front and back; the walls each get a T-slot for them
  assert.equal(holes(piece(r, 'lid').cut).length, 4);
  assert.equal(r.parts.find((p) => p.name === 'front').pieces, 1);
  const front = piece(r, 'front').cut.regions[0];
  const plain = piece(
    render('use <kerf/enclosure>\n$thickness = 3;\nenclosure([150, 100, 60]);'),
    'left',
  ).cut.regions[0];
  assert.ok(front.length > plain.length);
  assert.throws(
    () => render('use <kerf/enclosure>\nenclosure([100, 80, 50], screw_length = 5);'),
    /too short/,
  );
});

test('enclosure cutouts go in the panels they name', () => {
  const r = render(`use <kerf/enclosure>
$thickness = 3;
enclosure([150, 100, 60], cutouts = [
  ["front", [30, 25], 8],
  ["front", [100, 25], [12, 6]],
  ["lid", [75, 50], [60, 30], "vents"],
  ["bottom", [10, 10], 3],
]);`);
  assert.deepEqual(
    ['front', 'back', 'left', 'lid', 'bottom'].map((n) => holes(piece(r, n).cut).length),
    [2, 0, 0, 4 + 10, 1],
  );
  const rect = holes(piece(r, 'front').cut).find((a) => Math.abs(a - 72) < 0.01);
  assert.ok(rect, 'a 12 × 6 hole');
});

test('vents fill their rectangle with slots', () => {
  const r = render(
    'use <kerf/enclosure>\ndifference() { rect([100, 50]); translate([50, 25]) vents([60, 30], slot = 3, pitch = 6); }',
  );
  assert.equal(holes(piece(r, 'part').cut).length, 10);
});

// kerf/calibration

test('kerf_gauge cuts strips with single lines, labelled with the divisor', () => {
  const r = render('use <kerf/calibration>\nkerf_gauge(strips = 8, size = [80, 20]);', font);
  const { cut, engrave } = piece(r, 'part');
  assert.equal(cut.regions.length, 1);
  const upright = cut.lines.filter((l) => l.every(([x]) => Math.abs(x - l[0][0]) < 1e-9));
  assert.ok(upright.length >= 7);
  assert.ok(engrave.regions.length > 0);
  assert.deepEqual(size(r, 'part'), [92, 38]);
  // Without labels it needs no font
  assert.deepEqual(
    size(render('use <kerf/calibration>\nkerf_gauge(labels = false);'), 'part'),
    [72, 37],
  );
});

test('slot_gauge steps the slot widths around the thickness', () => {
  const r = render(
    'use <kerf/calibration>\n$thickness = 3;\nslot_gauge(steps = 5, step = 0.1, depth = 15, labels = false);',
    {
      margin: 0,
    },
  );
  // The slots are open at one edge; the corners at their ends are the ten
  // points level with each other
  const levels = new Map();
  for (const [x, y] of piece(r, 'part').cut.regions[0])
    levels.set(y.toFixed(4), [...(levels.get(y.toFixed(4)) ?? []), x]);
  const corners = [...levels.values()].find((xs) => xs.length === 10).sort((a, b) => a - b);
  const widths = [];
  for (let i = 0; i < corners.length; i += 2)
    widths.push(Math.round((corners[i + 1] - corners[i]) * 100) / 100);
  assert.deepEqual(widths, [2.8, 2.9, 3, 3.1, 3.2]);
});

test('joint_test cuts a pair of pieces for each kerf, with that kerf', () => {
  const r = render('use <kerf/calibration>\njoint_test([0.1, 0.2], labels = false);');
  assert.deepEqual(
    r.parts.map((p) => [p.name, p.kerf]),
    [
      ['joint 0.1 out', 0.1],
      ['joint 0.1 in', 0.1],
      ['joint 0.2 out', 0.2],
      ['joint 0.2 in', 0.2],
    ],
  );
});

// The examples built on the libraries

test('the library examples assemble without collisions or warnings', () => {
  for (const name of [
    'spice-shelf',
    'drawer-organizer',
    'project-enclosure',
    'flex-box',
    'wall-sign',
    'calibration-set',
  ]) {
    const r = render(readFileSync(`examples/${name}.kerf`, 'utf8'), font);
    assert.deepEqual(r.warnings, [], name);
  }
});

// kerf/gears, kerf/lock, kerf/rings, kerf/sizes, kerf/symbols, kerf/geo

test('gears in mesh do not collide, and gear_turn runs the other way', () => {
  const r = render(`use <kerf/gears>
    $fn = 48;
    part("a", at = [0, 0, 0]) spur_gear(24, 2);
    part("b", at = [gear_distance(24, 12, 2), 0, 0], rotate = [0, 0, gear_phase(12)]) spur_gear(12, 2);
    echo(gear_radius(24, 2), gear_turn(24, 12, 30));`);
  assert.deepEqual(r.echoes, ['24, -60']);
  assert.deepEqual(r.warnings, []);
  assert.ok(Math.abs(size(r, 'a')[0] - 52) < 0.1, 'the tips reach the addendum circle');
});

test('a rack is as long as its teeth', () => {
  const r = render('use <kerf/gears>\npart("r") rack(10, 2);');
  assert.equal(size(r, 'r')[0], Math.round(10 * Math.PI * 2 * 100) / 100);
});

test('the lock fits together locked and open', () => {
  for (const locked of [true, false]) {
    const r = render(`use <kerf/lock>\n$fn = 48;\ncam_lock(7, locked = ${locked});`);
    assert.deepEqual(r.warnings, [], `locked = ${locked}`);
    assert.equal(r.parts.length, 7);
  }
});

test('ring_stack refuses a hole that leaves its core plates too thin', () => {
  assert.throws(
    () => render('use <kerf/rings>\n$thickness = 3;\nring_stack([30, 40, 30], 5.5);'),
    /make it at least 7.1 mm/,
  );
  assert.ok(
    render('use <kerf/rings>\n$thickness = 3;\nring_stack([30, 40, 30], 7.1, feet = false);').parts
      .length,
  );
  // The feet need room clear of the other plate's slot in the base
  assert.throws(
    () => render('use <kerf/rings>\n$thickness = 3;\nring_stack([30, 40, 30], 10);'),
    /no room for the core's feet .* make it at least 11.9 mm/,
  );
  const base = render(
    'use <kerf/rings>\n$thickness = 3;\nring_stack([60, 70, 60], 23);\npart("base", at = [-40, -40, -3], slots = ["ring core A", "ring core B"]) rect([80, 80]);',
  );
  assert.deepEqual(base.warnings, []);
  // The base stays one piece round the four foot slots
  assert.equal(base.parts.find((p) => p.name === 'base').pieces, 1);
});

test('ring_stack makes one part for each size of ring, and a base can slot its feet', () => {
  const r = render(`use <kerf/rings>
    $fn = 48;
    ring_stack([60, 60, 70, 60], 30, name = "v");
    part("base", at = [0, 0, -$thickness], slots = ["v core A", "v core B"]) circle(d = 90);`);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(
    r.parts.map((p) => [p.name, p.qty]),
    [
      ['v 60', 3],
      ['v 70', 1],
      ['v core A', 1],
      ['v core B', 1],
      ['base', 1],
    ],
  );
  assert.ok(r.parts.at(-1).cutLength > Math.PI * 90 + 30, 'the base has slots');
});

test('flex_strip bends round its path and the plates cut its slots', () => {
  const r = render(`use <kerf/hinge>
    $fn = 32;
    path = concat([[0, 60], [0, 40]], [for (a = [180:5:270]) [40, 40] + 40 * [cos(a), sin(a)]], [[100, 0]]);
    part("a", rotate = [90, 0, 0], slots = ["s"]) offset(delta = 10) polygon(concat(path, [[100, 70], [0, 70]]));
    part("b", at = [0, 53, 0], rotate = [90, 0, 0], slots = ["s"]) offset(delta = 10) polygon(concat(path, [[100, 70], [0, 70]]));
    place(rotate = [90, 0, 0]) flex_strip(path, 50, name = "s");`);
  assert.deepEqual(r.warnings, []);
  const s = r.assembly.find((p) => p.name === 's');
  assert.equal(s.bends.length, 1);
  assert.ok(Math.abs(s.bends[0].angle - 90) < 1e-6);
  assert.ok(
    r.parts.find((p) => p.name === 'a').cutLength > r.parts.find((p) => p.name === 'a').width * 2,
  );
});

test('wall() puts plates and a bent strip round an outline, in pieces that fit', () => {
  const stadium =
    'use <kerf/hinge>\noutline = concat([for (a = [-90:5:90]) [100, 40] + 40 * [cos(a), sin(a)]], [for (a = [90:5:270]) [40, 40] + 40 * [cos(a), sin(a)]]);\n';
  const one = render(stadium + 'wall(outline, 50, name = "Box", join = [70, 0]);', { kerf: 0 });
  assert.deepEqual(one.warnings, []);
  assert.deepEqual(
    one.parts.map((p) => p.name),
    ['Box front', 'Box back', 'Box strip'],
  );
  // The plates cut slots for the strip's tabs on the straights
  const plain = render(stadium + 'wall(outline, 50, name = "Box", join = [70, 0], tabs = false);', {
    kerf: 0,
  });
  assert.deepEqual(plain.warnings, []);
  const cut = (r, n) => r.parts.find((p) => p.name === n).cutLength;
  assert.ok(cut(one, 'Box front') > cut(plain, 'Box front') + 40);
  // The strip runs round the outline, x 0..140, y 0..80 on its middle,
  // the plates in front of it and behind
  const box = (r, re) => {
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (const a of r.assembly.filter((a) => re.test(a.name)))
      for (const q of a.bends ? [] : a.outline.flat()) {
        const p = [0, 1, 2].map(
          (k) => a.matrix[k * 4] * q[0] + a.matrix[k * 4 + 1] * q[1] + a.matrix[k * 4 + 3],
        );
        p.forEach((v, k) => ((lo[k] = Math.min(lo[k], v)), (hi[k] = Math.max(hi[k], v))));
      }
    return [lo, hi];
  };
  const mm = (v) => v.map((x) => Math.round(x * 10) / 10);
  assert.deepEqual(box(one, /front/).map(mm), [
    [-4.5, 0, -4.5],
    [144.5, 0, 84.5],
  ]);
  assert.deepEqual(box(one, /back/).map(mm), [
    [-4.5, 53, -4.5],
    [144.5, 53, 84.5],
  ]);
  // In pieces no longer than max_length, meeting without pressing on each other
  const split = render(
    stadium +
      'echo(wall_pieces(outline, 150, [70, 0]));\nwall(outline, 50, name = "Box", join = [70, 0], max_length = 150);',
    { kerf: 0 },
  );
  assert.deepEqual(split.echoes, ['3']);
  assert.deepEqual(split.warnings, []);
  const strips = split.parts.filter((p) => p.name.startsWith('Box strip'));
  assert.deepEqual(
    strips.map((p) => p.name),
    ['Box strip 1', 'Box strip 2', 'Box strip 3'],
  );
  for (const p of strips) assert.ok(p.width <= 150, `${p.name} ${p.width}`);
  // A round outline has no straight run for tabs, so no slots and no warning
  const ball = render(
    'use <kerf/hinge>\nwall([for (a = [0:5:355]) 40 * [cos(a), sin(a)]], 30, name = "Ball", join = [0, -40], max_length = 100);',
    { kerf: 0 },
  );
  assert.deepEqual(ball.warnings, []);
  assert.equal(ball.parts.filter((p) => p.name.startsWith('Ball strip')).length, 3);
});

test('wall_path starts a closed outline at the point nearest join, or mid its longest side; path_part cuts a path', () => {
  const r = render(`use <kerf/hinge>
sq = [[0, 0], [40, 0], [40, 20], [0, 20]];
echo(wall_path(sq, [10, -5]));
echo(wall_path(concat(sq, [[0, 0]])));
echo(path_part([[0, 0], [10, 0], [10, 10]], 5, 15));`);
  assert.deepEqual(r.echoes, [
    '[[10, 0], [40, 0], [40, 20], [0, 20], [0, 0], [10, 0]]',
    '[[20, 0], [40, 0], [40, 20], [0, 20], [0, 0], [20, 0]]',
    '[[5, 0], [10, 0], [10, 5]]',
  ]);
});

test('paper, card and photo sizes by name', () => {
  const r = render(
    'use <kerf/sizes>\necho(paper_size("a5"), card_size("business"), landscape(photo_size("instant mini")), photo_size("Instax Mini") == photo_size("instant mini"));',
  );
  assert.deepEqual(r.echoes, ['[148, 210], [85, 55], [86, 54], true']);
  // Older names still work but aren't offered
  assert.throws(
    () => render('use <kerf/sizes>\necho(photo_size("x"));'),
    (e) => /instant classic/.test(e.message) && !/instax|polaroid/i.test(e.message),
  );
  assert.throws(
    () => render('use <kerf/sizes>\necho(paper_size("A11"));'),
    /Unknown paper size "A11"/,
  );
});

test('symbols draw at their size and name their source', () => {
  const r = render(
    'use <kerf/symbols>\npart("s") symbol("heart", 20);\necho(symbol_source("heart")[1], len(symbol_names()) > 800);',
  );
  assert.equal(Math.max(...size(r, 's')), 20);
  assert.deepEqual(r.echoes, ['Apache-2.0, true']);
});

test('symbols of one icon set line up by their grid with box = "grid"', () => {
  // The heart fills 20 of Material Design's 24 units
  const r = render(
    'use <kerf/symbols>\npart("s") symbol("heart", 24, box = "grid");\necho(symbol_entry("heart")[5]);',
  );
  assert.deepEqual(r.echoes, ['[0, 0, 24, 24]']);
  assert.ok(Math.abs(size(r, 's')[0] - 20) < 0.05);
});

test('the map knows land from sea', () => {
  const r = render(
    'use <kerf/geo>\necho(is_land(48.8, 2.3), is_land(0, -140), is_land(-23.7, 133.9));\npart("m") world_map(360);',
  );
  assert.deepEqual(r.echoes, ['true, false, true']);
  assert.ok(size(r, 'm')[0] > 350);
});

test('halved_pair halves a profile with its capped side, feet in the floor', () => {
  const lib = `use <kerf/joints>
$thickness = 3;
module tree() polygon([[-14, 0], [14, 0], [14, 4], [4, 4], [4, 8], [20, 8], [0, 50], [-20, 8], [-4, 8], [-4, 4], [-14, 4]]);
part("floor", at = [-30, -30, -3], slots = ["tree front", "tree side"]) square(60);
`;
  const r = render(
    `${lib}halved_pair("tree", cap = 30, feet = [[-10, 4], [10, 4]]) { tree(); engrave() translate([0, 20]) circle(d = 4); }`,
  );
  assert.deepEqual(r.warnings, []);
  const by = Object.fromEntries(r.parts.map((p) => [p.name, p]));
  // The front is all of it with its feet, the side capped at 30 with them
  assert.equal(by['tree front'].height, 53);
  assert.equal(by['tree side'].height, 33);
  // Four feet in the floor, each a slot of its own
  assert.equal(piece(r, 'floor').cut.regions.filter((p) => p.length).length, 5);
  // Both faces carry the art
  assert.ok(piece(r, 'tree front').engrave && piece(r, 'tree side').engrave);
  // A stem too narrow beside the slot, or a foot in the front's slot, stops
  assert.throws(
    () => render(`${lib}halved_pair("t", cap = 30) translate([-1, 0]) tree();`),
    /narrower than 1.5 mm \(\$min_width\) beside its slot/,
  );
  assert.throws(
    () => render(`${lib}halved_pair("t", cap = 30, feet = [0]) tree();`),
    /foot at x = 0 runs into its slot/,
  );
  // Uncapped, the side's slot from above would cut off the point
  assert.throws(() => render(`${lib}halved_pair("t") tree();`), /the side is narrower/);
});

test('kerf/shapes draws each shape to its size, centred, in one piece', () => {
  const sized = [
    ['heart(40)', [40, 40]],
    ['teardrop([28, 40])', [28, 40]],
    ['egg([32, 40])', [32, 40]],
    ['lens([20, 40])', [20, 40]],
    ['lens([20, 10])', [20, 10]],
    ['lens([40, 6])', [40, 6]],
    ['capsule([40, 16])', [40, 16]],
    ['capsule([10, 30])', [10, 30]],
    ['diamond([28, 40])', [28, 40]],
    ['shield([32, 40])', [32, 40]],
    ['arrow([40, 20])', [40, 20]],
    ['chevron([24, 40])', [24, 40]],
    ['banner([44, 18])', [44, 18]],
    ['house([30, 40])', [30, 40]],
    ['tag([44, 24])', [44, 24]],
    ['ring(40, 6)', [40, 40]],
    ['cloud([44, 28])', [44, 28]],
    ['speech_bubble([44, 34])', [44, 34]],
  ];
  for (const [call, [w, h]] of sized) {
    const r = render(
      `use <kerf/shapes>\npart("s") { square(0.01); measure() { ${call}; echo($bounds); } } ${call};`,
    );
    assert.deepEqual(r.warnings, [], call);
    const [x0, y0, x1, y1] = JSON.parse(r.echoes[0]);
    near(x1 - x0, w, 0.01);
    near(y1 - y0, h, 0.01);
    near(x0 + x1, 0, 0.01);
    near(y0 + y1, 0, 0.01);
  }
  for (const call of ['crescent(40)', 'rounded_polygon(3, 22, 5)', 'scalloped(40)', 'flower(40)'])
    assert.equal(render(`use <kerf/shapes>\npart("s") ${call};`).parts[0].pieces, 1, call);
  assert.deepEqual(size(render('use <kerf/shapes>\npart("s") crescent(40, 8);'), 's'), [24, 40]);
});

test('kerf/shapes points come counter-clockwise and refuse sizes that cannot be drawn', () => {
  const signed = (p) =>
    p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0);
  for (const f of [
    'heart_points(30)',
    'teardrop_points([10, 20])',
    'egg_points(20)',
    'lens_points([8, 20])',
    'lens_points([20, 8])',
    'crescent_points(20)',
    'capsule_points([20, 8])',
    'diamond_points(10)',
    'rounded_polygon_points(5, 10, 2)',
    'shield_points(20)',
    'arrow_points([30, 10])',
    'chevron_points([10, 20])',
    'banner_points([40, 10])',
    'house_points([20, 30])',
    'tag_points([40, 20])',
  ]) {
    const r = render(`use <kerf/shapes>\necho(${f});`);
    assert.ok(signed(JSON.parse(r.echoes[0])) > 0, f);
  }
  for (const [call, message] of [
    ['teardrop([20, 10])', /taller than it is wide/],
    ['heart(0)', /size must be more than 0/],
    ['crescent(20, 30)', /thickness/],
    ['rounded_polygon(4, 10, 9)', /round must be less/],
  ])
    assert.throws(() => render(`use <kerf/shapes>\n${call};`), message, call);
});

// kerf/stand

test('stand() puts a panel in its base without a collision, upright or leaning', () => {
  for (const lean of [0, 15, 30, 44])
    for (const t of [3, 6]) {
      const r = render(
        `use <kerf/stand>\n$thickness = ${t};\nstand(160, lean = ${lean}) square([160, 90]);`,
      );
      assert.deepEqual(r.warnings, [], `lean ${lean}, ${t} mm`);
      assert.deepEqual(
        r.parts.map((p) => p.name),
        ['Sign', 'Sign stand'],
      );
    }
  const tight = render(
    'use <kerf/stand>\n$thickness = 4;\nstand(160, lean = 20, clearance = -1) square([160, 90]);',
  );
  assert.equal(collisions(tight).length, 1);
});

test('stand_slots() cuts the slots the assembly needs for stand_tabs()', () => {
  for (const lean of [0, 20, 35]) {
    const cut = (base) =>
      render(
        `use <kerf/stand>\n$thickness = 4;\npart("Sign", at = [0, 20, 4], rotate = [${90 - lean}, 0, 0]) { square([160, 90]); stand_tabs(160, lean = ${lean}); }\n${base}`,
      ).parts.find((p) => p.name === 'Base').cutLength;
    near(
      cut(
        `part("Base", at = [0, 0, 0], slots = ["Sign"]) translate([-10, 0]) rect([180, 40], r = 3);`,
      ),
      cut(
        `part("Base", at = [0, 0, 0]) difference() { translate([-10, 0]) rect([180, 40], r = 3); translate([0, 20]) stand_slots(160, lean = ${lean}); }`,
      ),
      0.05,
    );
  }
});
