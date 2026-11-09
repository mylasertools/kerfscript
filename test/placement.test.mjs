// Placing parts in 3D: place(), stack, glue, bends and riders, slots from
// the assembly, steps and hardware, the back face, nesting and the
// project's sheet.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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

test('a stack glued under its host grows down, away from it', () => {
  const r = render(
    'part("feet", glue = "seat", face = "bottom", stack = 3) rect(10); part("seat", at = [0, 0, 40]) rect(30);',
  );
  assert.deepEqual(
    r.assembly.filter((a) => a.name === 'feet').map((a) => a.matrix[11]),
    [37, 34, 31],
  );
  const top = render(
    'part("pads", glue = "seat", stack = 2) rect(10); part("seat", at = [0, 0, 40]) rect(30);',
  );
  assert.deepEqual(
    top.assembly.filter((a) => a.name === 'pads').map((a) => a.matrix[11]),
    [43, 46],
  );
  assert.deepEqual(r.warnings, []);
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

test('a step inside a step is a sub-step, unless the outer one takes them in', () => {
  const chair = () =>
    `module chair(z) { step("Seat") part(str("seat ", z), at = [0, 0, z]) rect(10); step("Back") part(str("back ", z), at = [0, 20, z]) rect(10); }`;
  const r = render(`${chair()}
    step("Chair") chair(0);
    step("Stool", substeps = false) chair(50);
    chair(100);`);
  assert.deepEqual(r.steps, ['Chair', 'Chair: Seat', 'Chair: Back', 'Stool', 'Seat', 'Back']);
  assert.equal(part(r, 'seat 0').step, 2);
  assert.equal(part(r, 'back 50').step, 4);
  assert.equal(part(r, 'seat 100').step, 5);
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

test('a front layer named like a back layer is an error, not a lost back job', () => {
  assert.throws(
    () =>
      render(
        'layer("engrave-back", mode = "fill"); part("p") { rect(10); engrave(side = "back") rect(2); }',
      ),
    /already uses for the front/,
  );
});

test('kerf check sweeps settings that go together, and lists of settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-'));
  writeFileSync(
    join(dir, 'p.kerf'),
    'w = 10;\nd = 10;\nassert(w < d * 2, "too long");\npart("p") rect([w, d]);\n',
  );
  writeFileSync(join(dir, 'sets.json'), JSON.stringify([{ w: 20, d: 15 }, { w: 40 }]));
  let out = '';
  try {
    execFileSync(
      'node',
      [
        'dist/cli.js',
        'check',
        join(dir, 'p.kerf'),
        '--sweep',
        'w,d=10,10;30,10',
        '--params-list',
        join(dir, 'sets.json'),
      ],
      { encoding: 'utf8' },
    );
  } catch (e) {
    out = e.stdout;
  }
  // Each pair is crossed with each set, the later setting winning
  assert.match(out, /w=20 d=15: ok/);
  assert.match(out, /w=40 d=10: error: .*too long/);
  assert.match(out, /2 of 4 clean/);
  assert.throws(
    () =>
      execFileSync('node', ['dist/cli.js', 'check', join(dir, 'p.kerf'), '--sweep', 'w,d=1,2,3'], {
        stdio: 'pipe',
      }),
    (e) => e.status === 1 && /gives 3 values for 2 names/.test(String(e.stderr)),
  );
});

test('kerf check refuses a sweep that is not a range', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-'));
  writeFileSync(join(dir, 'p.kerf'), 'x = 1;\npart("p") rect(10);\n');
  for (const bad of ['x=1..2:1:3', 'x=a:1:3', 'x=1:0:3'])
    assert.throws(
      () =>
        execFileSync('node', ['dist/cli.js', 'check', join(dir, 'p.kerf'), '--sweep', bad], {
          stdio: 'pipe',
        }),
      (e) => e.status === 1 && /--sweep x/.test(String(e.stderr)),
      bad,
    );
});

test('slots take * patterns and leave out "!" names', () => {
  const src = `
    part("shelf", at = [0, 0, 0], slots = ["*", "!wall b"]) rect([100, 60]);
    for (n = [["wall a", 31.5], ["wall b", 11.5]])
      part(n[0], at = [0, n[1], 3], rotate = [90, 0, 0]) { rect([100, 40]); translate([40, -3]) rect([20, 3.01]); }`;
  const r = render(src);
  assert.equal(r.parts.find((p) => p.name === 'shelf').cutLength, 366);
  assert.equal(r.warnings.filter((w) => /collide/.test(w)).length, 1);
  assert.match(
    r.warnings.find((w) => /collide/.test(w)),
    /wall b/,
  );
});

test('a slot clears the marks over it too', () => {
  const r = render(`
    part("a", at = [0, 0, 0], slots = ["b"]) { rect([40, 40]); engrave() rect([40, 40]); }
    part("b", at = [0, 20, 3], rotate = [90, 0, 0]) { rect([40, 10]); translate([10, -3]) rect([10, 3.01]); }`);
  const engrave = r.sheets[0].items.find((i) => i.part === 'a').layers.get('engrave').regions;
  assert.ok(
    engrave.some(
      (p) =>
        p.length &&
        p.reduce(
          (s, q, i) => s + q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1],
          0,
        ) < 0,
    ),
    'the engraving has the slot as a hole',
  );
});

test('a part touching the edge from outside leaves no notch', () => {
  const r = render(`
    part("c", at = [0, 0, 0], slots = ["s"]) rect([40, 40]);
    part("s", at = [10, 0, -5], rotate = [90, 0, 0]) rect([10, 8]);`);
  assert.equal(r.parts.find((p) => p.name === 'c').cutLength, 160);
});

test('copies that meet their slots alike, down to rounding, do not warn', () => {
  const r = render(
    'material(thickness = 3, kerf = 0) {' +
      ' part("plate", qty = 2, at = [[0, 0, 0], [100.1, 33.36666666666667, 0]], rotate = [0, 0, 30], slots = "post") rect([40, 30]);' +
      ' part("post", qty = 2, at = [[9.820526376958965, 22.99044935803677, -5], [109.92052637695896, 56.35711602470344, -5]], rotate = [90, 0, 0]) translate([-1, 0]) rect([2, 15]); }',
  );
  assert.deepEqual(r.warnings, []);
});

test('a setting the program never assigns warns', () => {
  const r = render('size = 10; rect(size);', { params: { sise: 5, $kerf: 0.1 } });
  assert.deepEqual(r.warnings, [
    'Setting "sise" is not a variable of the program, so it is ignored. Did you mean "size"?',
  ]);
});

test('$min_width = 0 turns the narrow-material warning off', () => {
  const bar =
    'part("p") { rect([10, 10]); translate([30, 0]) rect([10, 10]); translate([10, 4.5]) rect([20, 1]); }';
  assert.equal(render(bar).warnings.length, 1);
  assert.deepEqual(render('$min_width = 0;\n' + bar).warnings, []);
  assert.deepEqual(render('$min_width = 0.8;\n' + bar).warnings, []);
});

test('a blind tab 1.5 mm into a 4 mm floor still cuts its slot', () => {
  const r = render(
    '$thickness = 4; part("floor", at = [0, 0, 0], slots = ["leg"]) rect([40, 40]);\n' +
      'material(thickness = 1.5) part("leg", at = [10, 20, 4], rotate = [90, 0, 0]) { rect([10, 10]); translate([3, -1.5]) rect([4, 1.51]); }',
  );
  assert.equal(r.warnings.filter((w) => /collide/.test(w)).length, 0, r.warnings.join('\n'));
  assert.ok(r.parts.find((p) => p.name === 'floor').cutLength > 160);
});

test('a part that only dips into another cuts no slot, and collides', () => {
  const r = render(
    'part("floor", at = [0, 0, 0], slots = "*") rect([60, 40]);\n' +
      'part("arm", at = [10, 20, 2.87], rotate = [90, 0, 0]) rect([30, 10]);\n' +
      'part("leg", at = [10, 30, -3], rotate = [90, 0, 0]) rect([30, 10]);',
  );
  assert.equal(r.parts.find((p) => p.name === 'floor').cutLength, 266);
  assert.equal(r.warnings.filter((w) => /"floor" and "arm" collide/.test(w)).length, 1);
});

test('kerf check --call runs one call of a library, with -D set first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-'));
  writeFileSync(
    join(dir, 'lib.kerf'),
    'part("stray") rect(99);\nmodule tile(w) part("tile") rect([w, $thickness * 10]);\n',
  );
  const out = execFileSync(
    'node',
    [
      'dist/cli.js',
      'check',
      join(dir, 'lib.kerf'),
      '--call',
      'tile(w)',
      '-D',
      'w=25',
      '-D',
      '$thickness=4',
    ],
    { encoding: 'utf8' },
  );
  assert.match(out, /^tile: 25 x 40 mm, 4 mm material/m);
  assert.doesNotMatch(out, /stray/);
});

test("kerf diff lists what changed by part and layer, in the part's coordinates", () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-'));
  writeFileSync(
    join(dir, 'a.kerf'),
    'part("a") rect(10);\npart("b") { rect(20); score() line([0, 5], [20, 5]); }\n',
  );
  writeFileSync(
    join(dir, 'b.kerf'),
    'part("a") rect(10);\npart("b") { difference() { rect(20); translate([2, 2]) rect(4); } score() line([0, 6], [20, 6]); }\npart("c") rect(5);\n',
  );
  const same = spawnSync(
    'node',
    ['dist/cli.js', 'diff', join(dir, 'a.kerf'), join(dir, 'a.kerf')],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(same.status, 0);
  assert.match(same.stdout, /No differences/);
  const r = spawnSync(
    'node',
    ['dist/cli.js', 'diff', join(dir, 'a.kerf'), join(dir, 'b.kerf'), '--json'],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(r.status, 1);
  const d = JSON.parse(r.stdout);
  assert.deepEqual(
    d.map((e) => [e.part, e.layer ?? null, e.change]),
    [
      ['b', 'score', 'changed'],
      ['b', 'cut', 'changed'],
      ['c', null, 'added'],
    ].sort(),
  );
  const hole = d.find((e) => e.layer === 'cut');
  assert.equal(hole.area, 16);
  assert.deepEqual(hole.at, [2, 2, 6, 6]);
});

test('$label_parts numbers each part on its back face, inside its material', () => {
  const r = render(
    '$label_parts = true;\npart("a") rect([40, 20]);\npart("b") difference() { rect(30); translate([5, 5]) rect(20); }\npart("tiny") rect(1.5);',
    font,
  );
  assert.deepEqual(
    r.parts.map((p) => [p.name, p.label]),
    [
      ['a', 1],
      ['b', 2],
      ['tiny', 3],
    ],
  );
  assert.ok(r.warnings.some((w) => /"tiny" is too small to take its number 3/.test(w)));
  const back = r.sheets[0].back;
  assert.ok(back && back.paths.some((p) => p.name === 'engrave-back'));
  // The frame's number sits on its 5 mm rim, not in the hole
  const items = r.sheets[0].items.find((i) => i.part === 'b');
  const marks = items.layers.get('engrave-back').regions.flat();
  const xs = marks.map((q) => q[0]),
    ys = marks.map((q) => q[1]);
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const [x1, y1] = [Math.max(...xs), Math.max(...ys)];
  const box = layerBox(items.layers.get('cut'));
  const inHole = x0 > box[0] + 5 && x1 < box[2] - 5 && y0 > box[1] + 5 && y1 < box[3] - 5;
  assert.ok(!inHole, 'not in the hole');
});

function layerBox(l) {
  const pts = [...l.regions, ...l.lines].flat();
  const xs = pts.map((q) => q[0]),
    ys = pts.map((q) => q[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

test('kerf instructions draws each step with its parts and hardware', async () => {
  const { instructionsHtml } = await import('../dist/index.js');
  const r = render(`
    step("Stand the walls in the base") {
      part("base", at = [-30, -40, 0]) rect([60, 80]);
      for (y = [-40, 37]) part(str("wall ", y), at = [-30, y + 3, 3], rotate = [90, 0, 0]) rect([60, 40]);
    }
    step("Slide the axle through") hardware("dowel", [0, -45, 25], [0, 45, 25], 6);`);
  const html = instructionsHtml(r, 'Cart <1>');
  assert.match(html, /<title>Cart &lt;1&gt;: assembly<\/title>/);
  assert.equal((html.match(/<section>/g) ?? []).length, 2);
  assert.match(html, /<span>1<\/span> Stand the walls in the base/);
  assert.match(html, /<b>1<\/b> base/);
  assert.match(html, /dowel, 6 mm, 90 mm long/);
  // Each step has a drawing
  assert.equal((html.match(/<div class="view"><svg/g) ?? []).length, 2);
});

test('kerf render -o x.png draws a picture of each sheet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-'));
  writeFileSync(
    join(dir, 'p.kerf'),
    'part("p") { rect([40, 20]); engrave() translate([5, 5]) rect([10, 10]); }',
  );
  execFileSync(
    'node',
    ['dist/cli.js', 'render', join(dir, 'p.kerf'), '-o', join(dir, 'p.png'), '--px', '200'],
    {
      stdio: 'pipe',
    },
  );
  const png = readFileSync(join(dir, 'p.png'));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 200);
  // The sheet is 46 x 26 mm with its gap: 200 x 113 pixels
  assert.equal(png.readUInt32BE(20), 113);
});

test('each layer of a stack cuts only the slots that pass through it', () => {
  const r = render(`
    part("top", at = [0, 0, 30], stack = 2, slots = ["leg *", "tool"]) rect([80, 40]);
    for (x = [10, 65]) part(str("leg ", x), at = [x, 20, 0], rotate = [90, 0, 0]) { rect([5, 30]); translate([1, 29.99]) rect([3, 3.01]); }
    part("tool", at = [40, 20, 36], rotate = [90, 0, 0]) { translate([0, -3]) rect([3, 3.01]); rect([10, 10]); }`);
  const by = Object.fromEntries(r.parts.map((p) => [p.name, p]));
  assert.equal(by['top, layer 1'].pieces, 1);
  assert.ok(by['top, layer 1'].cutLength > by['top, layer 2'].cutLength);
  assert.ok(by['top, layer 2'].cutLength > 240);
  assert.deepEqual(r.warnings, []);
  // Alike layers stay one stack
  const same = render(`
    part("top", at = [0, 0, 30], stack = 2, slots = ["leg"]) rect([80, 40]);
    part("leg", at = [10, 20, 0], rotate = [90, 0, 0]) { rect([5, 30]); translate([1, 29.99]) rect([3, 6.02]); }`);
  assert.equal(same.parts.find((p) => p.name === 'top').stack, 2);
});

test('a slot covers a shoulder that flares into the receiving face', () => {
  const r = render(`
    part("stage", at = [-20, -20, 0], slots = ["limb"], clearance = 0) rect([40, 40]);
    part("limb", at = [0, 1.5, 0.05], rotate = [90, 0, 0]) {
      translate([-2, -10]) rect([4, 13]);
      difference() {
        translate([-4, -2]) rect([8, 2]);
        for (s = [-1, 1]) translate([s * 4, -2]) circle(r = 2, $fn = 64);
      }
    }`);
  // 160 round the stage, and 2 x (8 + 3) round the slot: the flare's full width
  assert.equal(r.parts.find((p) => p.name === 'stage').cutLength, 182);
});

test('an edge lying on a face is not slotted along the contact', () => {
  // The wall's top rests a hair inside the roof, as rounding leaves it under
  // a sloped roof; only its tab goes through. 200 round the roof, 2 x (4 + 3)
  // round the tab's slot, nothing along the 40 mm contact
  for (const top of [10.0001, 10.009]) {
    const r = render(`
      part("roof", at = [-30, -20, 10], slots = ["wall"], clearance = 0) rect([60, 40]);
      part("wall", at = [0, 1.5, 0], rotate = [90, 0, 0]) {
        translate([-20, 0]) rect([40, ${top}]);
        translate([-2, 0]) rect([4, 13]);
      }`);
    assert.equal(r.parts.find((p) => p.name === 'roof').cutLength, 214, `top at ${top}`);
  }
  // A gable wall under a roof sloped at 35 degrees, its top a hair inside the
  // roof's underside, cuts the same roof as one lowered 0.2 mm
  const roof = (ease) =>
    render(`
      a = 35;
      part("roof", at = [-30, 0, 0], rotate = [a, 0, 0], slots = ["wall"], clearance = 0) rect([60, 40]);
      part("wall", at = [-1.5, 0, 0], rotate = orient([0, 1, 0], [1, 0, 0])) {
        polygon([[0, -20], [30, -20], [30, 30 * tan(a) + ${ease}], [0, ${ease}]]);
        translate([10, -20]) rect([4, 34 * tan(a) + 25]);
      }`).parts.find((p) => p.name === 'roof').cutLength;
  assert.equal(roof(0.005), roof(-0.2));
});

test('a picture of a long thin sheet stays within the pixel limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-'));
  writeFileSync(join(dir, 'p.kerf'), 'part("strip") rect([1, 600]);');
  execFileSync('node', ['dist/cli.js', 'render', join(dir, 'p.kerf'), '-o', join(dir, 'p.png')], {
    stdio: 'pipe',
  });
  const png = readFileSync(join(dir, 'p.png'));
  const w = png.readUInt32BE(16),
    h = png.readUInt32BE(20);
  assert.ok(w * h <= 16_000_000 && h <= 16_384, `${w} x ${h}`);
  assert.ok(h > w * 50);
});

test('bores cut holes where hardware rods pass through, with the fit', () => {
  const r = render(`
hardware("dowel", [30, -5, 20], [30, 40, 20], 6, label = "Crank axle");
part("Side", qty = 2, at = [[0, 3, 0], [0, 33, 0]], rotate = [90, 0, 0], bores = ["Crank axle"], fit = "press") square([60, 40]);
part("Wheel", at = [30, 18, 20], rotate = [90, 0, 0], bores = ["Crank*"]) circle(d = 30, $fn = 64);
part("Plain", at = [0, 50, 0], rotate = [90, 0, 0], bores = ["dowel"]) square([60, 40]);`);
  assert.deepEqual(r.warnings, [
    'Part "Plain": none of "dowel" pass through it, so it has no bores.',
  ]);
  const cut = (n) => r.parts.find((p) => p.name === n).cutLength;
  // 200 round the side and a 5.9 mm hole; the wheel's 30 mm rim and a 6.3 mm hole
  assert.ok(Math.abs(cut('Side') - (200 + Math.PI * 5.9)) <= 1, String(cut('Side')));
  assert.ok(Math.abs(cut('Wheel') - Math.PI * (30 + 6.3)) <= 1, String(cut('Wheel')));
  assert.equal(cut('Plain'), 200);
  // A square rod cuts a square hole; a slanted one a longer hole
  const key = render(
    'hardware("steel", [30, -5, 20], [30, 40, 20], [4, 4], label = "Key"); part("S", at = [0, 3, 0], rotate = [90, 0, 0], bores = "Key", fit = 0) square([60, 40]);',
  );
  assert.equal(key.parts[0].cutLength, 216);
  const slant = render(
    'hardware("dowel", [30, -5, 20], [30, 40, 50], 6, label = "A"); part("S", at = [0, 3, 0], rotate = [90, 0, 0], bores = "A", fit = 0) square([60, 60]);',
  );
  assert.ok(slant.parts[0].cutLength > 240 + Math.PI * 6 + 3);
  assert.throws(() => render('part("S", bores = "A", fit = "loose") square(5);'), /fit must be/);
});

test('halving joints slot both parts from opposite sides, meeting halfway', () => {
  const egg = render(`
part("A", at = [0, 1.5, 0], rotate = [90, 0, 0], halving = ["B"], clearance = 0) square([100, 40]);
part("B", at = [48.5, 50, 0], rotate = [90, 0, -90]) square([100, 40]);`);
  assert.deepEqual(egg.warnings, []);
  // Each plate's outline gains the slot's two 20 mm sides
  assert.deepEqual(
    egg.parts.map((p) => p.cutLength),
    [320, 320],
  );
  const lamp = render(`
$fn = 96;
part("Ring", at = [0, 0, 30], halving = ["Rib"]) difference() { circle(r = 55); circle(r = 45); }
part("Rib", qty = 4, at = [for (a = [0:90:270]) [-1.5 * sin(a), 1.5 * cos(a), 0]], rotate = [for (a = [0:90:270]) [90, 0, a]]) translate([10, 0]) square([50, 60]);`);
  assert.deepEqual(lamp.warnings, []);
  // The ribs are notched 10 mm from their outer edge, the ring 5 mm from its
  // inner rim at each rib, never on across its hole
  const rib = lamp.parts.find((p) => p.name === 'Rib');
  assert.equal(rib.cutLength, 240);
  const ring = lamp.parts.find((p) => p.name === 'Ring');
  assert.ok(Math.abs(ring.cutLength - (2 * Math.PI * 100 + 4 * 10)) <= 4, String(ring.cutLength));
  assert.match(
    render(
      'part("A", at = [0, 0, 0], halving = ["B"]) square(10); part("B", at = [50, 0, 0]) square(10);',
    ).warnings[0],
    /crosses none of "B"/,
  );
});

test('kerf check --drive tries every position of the driving setting', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-'));
  // The arm sweeps round and runs into the post at 90 degrees
  writeFileSync(
    join(dir, 'arm.kerf'),
    `crank = 0; // [0:90:270] drive
part("Base", at = [0, 0, 0]) rect([100, 100]);
part("Post", at = [45, 75, 3]) rect([10, 10]);
part("Arm", at = [50 + 30 * cos(crank) - 5, 50 + 30 * sin(crank) - 5, 3]) rect([10, 10]);
`,
  );
  let out = '';
  try {
    execFileSync('node', ['dist/cli.js', 'check', join(dir, 'arm.kerf'), '--drive'], {
      encoding: 'utf8',
    });
  } catch (e) {
    out = e.stdout;
  }
  assert.match(out, /crank=0: ok/);
  assert.match(out, /crank=90: 1 warning\n.*"Post" and "Arm" collide/);
  assert.match(out, /3 of 4 clean/);
  writeFileSync(join(dir, 'still.kerf'), 'rect(10);');
  assert.throws(
    () =>
      execFileSync('node', ['dist/cli.js', 'check', join(dir, 'still.kerf'), '--drive'], {
        stdio: 'pipe',
      }),
    (e) => /No setting drives this model/.test(String(e.stderr)),
  );
});

test('slot_extra sweeps the slots for a hook that drops in', () => {
  const src = (
    e,
  ) => `part("Board", at = [0, 3, 0], rotate = [90, 0, 0], slots = ["Hook"], clearance = 0${e}) square([60, 60]);
part("Hook", at = [28, 6, 30], rotate = [90, 0, 90]) { square([20, 4]); translate([-6, 0]) square([6.01, 4]); }`;
  // A 3 x 4 slot, then 3 x 10 grown 6 mm upward
  assert.equal(render(src('')).parts[0].cutLength, 254);
  assert.equal(render(src(', slot_extra = [0, 6]')).parts[0].cutLength, 266);
});

test('tabs of two parts in one slot are named', () => {
  const walls = (x) => `
part("Floor", at = [0, 0, 0], slots = ["Wall*"]) square([100, 100]);
part("Wall A", at = [0, 51.5, 3], rotate = [90, 0, 0]) { square([100, 40]); translate([${x}, -3]) square([10, 3.01]); }
part("Wall B", at = [48.5, 100, 3], rotate = [90, 0, -90]) { square([100, 40]); translate([${x}, -3]) square([10, 3.01]); }`;
  const shared = (src) => render(src).warnings.filter((w) => /same slot/.test(w));
  assert.equal(shared(walls(45)).length, 1);
  assert.match(
    shared(walls(45))[0],
    /Tabs of "Wall A" and "Wall B" meet in the same slot in "Floor"/,
  );
  assert.deepEqual(shared(walls(15)), []);
});

test('curved copies pack in rows, every other one turned', () => {
  const ribs = `$sheet = [600, 400];
part("Rib", qty = 24) {
  pts = [for (i = [0:40]) let (t = i / 40) [40 * sin(t * 360), t * 250]];
  polygon(concat(pts, [for (i = [40:-1:0]) pts[i] + [14, 0]]));
}`;
  const r = render(ribs);
  assert.equal(r.sheets.length, 1);
  assert.deepEqual(
    r.sheets[0].items.map((it) => it.copy).sort((a, b) => a - b),
    Array.from({ length: 24 }, (_, i) => i + 1),
  );
});
