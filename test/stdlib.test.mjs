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
