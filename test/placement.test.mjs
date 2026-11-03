// Placing parts in 3D: place(), stack, glue, bends and riders, slots from
// the assembly, steps and hardware, the back face, nesting and the
// project's sheet.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bendPoint, meshPieces, render } from '../dist/index.js';

const font = {
  fonts: { A: readFileSync('fonts/AtkinsonHyperlegible-Regular.ttf') },
  defaultFont: 'A',
};
const near = (a, b, eps = 1e-6) =>
  assert.ok(
    a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < eps),
    `${JSON.stringify(a)} is not ${JSON.stringify(b)}`,
  );
const at = (m) => [m[3], m[7], m[11]];
const part = (r, name, copy = 1) => r.assembly.find((a) => a.name === name && a.copy === copy);

test('place() puts its parts inside its own placement', () => {
  const r = render(
    'place(at = [10, 0, 0], rotate = [0, 0, 90]) part("a", at = [5, 0, 0]) rect(1);',
  );
  near(at(part(r, 'a').matrix), [10, 5, 0]);
  near(part(r, 'a').matrix.slice(0, 3), [0, -1, 0]);
});

test('place() also moves hardware', () => {
  const r = render('place(at = [0, 0, 5]) hardware("dowel", [0, 0, 0], [0, 10, 0], 6);');
  near(r.hardware[0].from, [0, 0, 5]);
  near(r.hardware[0].to, [0, 10, 5]);
  assert.equal(r.hardware[0].kind, 'dowel');
});

test('stack = n places n layers one thickness apart', () => {
  const r = render('$thickness = 4; part("f", stack = 3, at = [0, 0, 10]) rect(5);');
  assert.equal(r.parts[0].qty, 3);
  assert.equal(r.parts[0].stack, 3);
  near(
    r.assembly.map((a) => a.matrix[11]),
    [10, 14, 18],
  );
  assert.deepEqual(r.warnings, []);
});

test("glue lays a part on another part's face, which may come later", () => {
  const r = render(
    'part("pad", glue = "seat", at = [5, 5, 0]) rect(10); part("seat", at = [0, 0, 40]) rect(30);',
  );
  near(at(part(r, 'pad').matrix), [5, 5, 43]);
  assert.equal(r.parts.find((p) => p.name === 'pad').glued, 'seat');
  const under = render(
    'part("felt", glue = "seat", face = "bottom") rect(10); part("seat", at = [0, 0, 40]) rect(30);',
  );
  near(at(part(under, 'felt').matrix), [0, 0, 37]);
});

test('mirror = true cuts the part mirrored with its text reading', () => {
  const r = render(
    'part("m", mirror = true) { polygon([[0, 0], [40, 0], [0, 30]]); engrave() translate([5, 5]) text("AB", size = 8); }',
    font,
  );
  const b = r.sheets[0].items[0].layers;
  assert.ok(b.get('engrave').regions.length > 0, 'the text is still on the part');
  assert.deepEqual(r.warnings, []);
});

test("a bend keeps the middle layer's length and folds towards the top face", () => {
  const t = 3;
  const L = (Math.PI / 2) * 10;
  const bends = [{ x0: 50, x1: 50 + L, angle: 90 }];
  // The end of the hinge's middle layer is a quarter turn round radius 10
  near(bendPoint(bends, t, [50 + L, 0, t / 2]), [60, 0, 1.5 + 10], 1e-9);
  // A point 20 mm past the hinge stands straight up
  near(bendPoint(bends, t, [50 + L + 20, 0, t / 2]), [60, 0, 31.5], 1e-9);
  // Before the hinge nothing moves
  near(bendPoint(bends, t, [10, 4, 2]), [10, 4, 2]);
  // A negative angle folds down
  near(bendPoint([{ ...bends[0], angle: -90 }], t, [50 + L, 0, t / 2]), [60, 0, 1.5 - 10], 1e-9);
});

test('meshPieces cuts a bent outline into bands across the hinge', () => {
  const sq = [
    [0, 0],
    [100, 0],
    [100, 20],
    [0, 20],
  ];
  assert.equal(meshPieces([sq]).length, 1);
  assert.equal(meshPieces([sq], [{ x0: 40, x1: 60, angle: 90 }], 2).length, 12);
});

test('a part on a bent part moves with the run under it', () => {
  const r = render(
    'part("cover", bend = [40, 50, 90]) rect([100, 30]); part("badge", at = [70, 10, 3], on = "cover") rect(10);',
  );
  // 25 mm past the hinge's end: up the leaf, on the inner face
  const m = part(r, 'badge').matrix;
  assert.ok(Math.abs(m[2] + 1) < 1e-9, 'the badge faces in');
  assert.ok(m[11] > 20, `the badge rose to ${m[11]}`);
  assert.deepEqual(r.warnings, []);
});

test('the runs of a bent part are checked for collisions on their own', () => {
  // Folded right over, the two leaves face each other 2R - t apart
  const clean = render(
    'part("folder", bend = [60, 60 + Math.PI * 5, 180]) rect([130, 40]);'.replace(
      'Math.PI',
      `${Math.PI}`,
    ),
  );
  assert.deepEqual(clean.warnings, []);
  const hit = render(
    `part("folder", bend = [60, ${60 + Math.PI * 5}, 180]) rect([130, 40]); part("block", at = [20, 10, 9]) rect([10, 10]);`,
  );
  assert.equal(hit.warnings.filter((w) => /collide/.test(w)).length, 1);
});

test('slots follow a part leaning at an angle', () => {
  const r = render(`
    part("shelf", at = [0, 0, 0], slots = ["back"]) rect([100, 60]);
    part("back", at = [0, 55, 3], rotate = [75, 0, 0]) {
      rect([100, 60]);
      for (x = [20, 70]) translate([x, -6]) rect([10, 6.01]);
    }`);
  assert.deepEqual(r.warnings, []);
  const holes =
    r.sheets[0].items.find((i) => i.part === 'shelf').layers.get('cut').regions.length - 1;
  assert.equal(holes, 2);
});

test('slots name a missing part or one that does not pass through', () => {
  assert.match(
    render('part("a", at = [0, 0, 0], slots = ["b"]) rect(10);').warnings[0],
    /no part "b"/,
  );
  assert.match(
    render(
      'part("a", at = [0, 0, 0], slots = ["b"]) rect(10); part("b", at = [0, 0, 50]) rect(10);',
    ).warnings[0],
    /pass through it/,
  );
});

test('steps number in the order they first run, and tag parts and hardware', () => {
  const r = render(`
    part("base", at = [0, 0, 0]) rect(10);
    step("Walls") part("wall", at = [0, 0, 50]) rect(10);
    step("Axle") hardware("dowel", [0, 0, 0], [10, 0, 0], 4);
    step("Walls") part("wall 2", at = [0, 0, 80]) rect(10);`);
  assert.deepEqual(r.steps, ['Walls', 'Axle']);
  assert.equal(part(r, 'base').step, undefined);
  assert.equal(part(r, 'wall').step, 1);
  assert.equal(part(r, 'wall 2').step, 1);
  assert.equal(r.hardware[0].step, 2);
});

test("back-face marks go into each sheet's back job, mirrored", () => {
  const r = render(
    'part("p") { rect([50, 20]); engrave(side = "back") translate([5, 5]) rect([10, 10]); }',
  );
  const s = r.sheets[0];
  assert.ok(!s.svg.includes('engrave-back'), 'not in the front file');
  assert.ok(s.back.svg.includes('engrave-back'));
  // 5 mm from the left on the part is 5 mm from the right once turned over
  const [x0] = s.back.paths[0].regions
    .match(/M([\d.]+)/)
    .slice(1)
    .map(Number);
  assert.ok(
    Math.abs(x0 - (s.width - 3 - 15)) < 0.01 || Math.abs(x0 - (s.width - 3 - 5)) < 0.01,
    `x0 ${x0}`,
  );
});

test('nesting packs small parts into holes', () => {
  const src =
    '$sheet = [300, 300]; part("ring") difference() { circle(d = 120, $fn = 64); circle(d = 100, $fn = 64); } part("disc") circle(d = 80, $fn = 64);';
  const loose = render(src);
  const nested = render(src, { nest: true });
  assert.ok(nested.sheets[0].width < loose.sheets[0].width, 'the disc went inside the ring');
  assert.equal(render(`$nest = true; ${src}`).sheets[0].width, nested.sheets[0].width);
});

test('defaultSheet applies only when the program sets no $sheet', () => {
  const big = 'part("p", qty = 3) rect([250, 100]);';
  assert.equal(render(big, { defaultSheet: [300, 120] }).sheets.length, 3);
  assert.equal(
    render(`$sheet = [600, 400]; ${big}`, { defaultSheet: [300, 120] }).sheets.length,
    1,
  );
});

test('registration marks go in three corners', () => {
  const r = render('$registration = true; part("p") rect(50);');
  const reg = r.sheets[0].items.find((i) => i.part === 'registration');
  assert.equal(reg.layers.get('registration').regions.length, 3);
});

test('a bleed layer runs past the part', () => {
  const r = render(
    'layer("print", mode = "fill", bleed = 2); part("p") { rect(20); layer("print") translate([-5, -5]) rect(30); }',
  );
  const print = r.parts[0];
  assert.ok(print.width >= 24 - 0.01, `width ${print.width}`);
});

test('kerf check sweeps settings and reads the project sheet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-'));
  writeFileSync(join(dir, 'kerf.json'), JSON.stringify({ libraries: {}, sheet: [300, 120] }));
  writeFileSync(
    join(dir, 'tray.kerf'),
    'w = 100;\npart("p", qty = 3) rect([w + 150, 100]);\nassert(w < 300, "too wide");\n',
  );
  const out = execFileSync('node', ['dist/cli.js', 'check', join(dir, 'tray.kerf')], {
    encoding: 'utf8',
  });
  assert.match(out, /3 sheets/);
  let swept = '';
  try {
    execFileSync(
      'node',
      ['dist/cli.js', 'check', join(dir, 'tray.kerf'), '--sweep', 'w=100:100:300'],
      { encoding: 'utf8' },
    );
  } catch (e) {
    swept = e.stdout;
  }
  assert.match(swept, /w=100: ok/);
  assert.match(swept, /w=300: error: .*too wide/);
  assert.match(swept, /1 of 3 clean/);
});

test('kerf render writes the back job beside the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-'));
  writeFileSync(
    join(dir, 'p.kerf'),
    'part("p") { rect(20); score(side = "back") line([2, 2], [18, 18]); }',
  );
  execFileSync('node', ['dist/cli.js', 'render', join(dir, 'p.kerf')], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  assert.ok(existsSync(join(dir, 'p-back.svg')));
});
