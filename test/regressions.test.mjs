import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bendPoint, KerfError, meshBodies, meshPieces, render } from '../dist/index.js';

const layers = (r) => r.sheets[0].items.map((it) => it.layers);

test('a layer wrapper around a whole part is an error, not a silent cut', () => {
  for (const wrap of ['score()', 'engrave()', 'cut()', 'layer("etch", "line")'])
    assert.throws(() => render(`${wrap} part("plate") rect(20);`), /cannot go on the/);
  const r = render('#part("ghost") rect(20); part("plate") rect(10);', { kerf: 0 });
  assert.equal(r.parts.find((p) => p.name === 'ghost').cutLength, 0);
  assert.equal(r.parts.find((p) => p.name === 'plate').cutLength, 40);
});

test('geometry operations reach inside named parts', () => {
  const r = render('difference() { part("plate") rect(20); translate([5, 5]) rect(10); }', {
    kerf: 0,
  });
  assert.equal(r.parts[0].cutLength, 120);
  const grown = render('offset(delta = 2) part("plate") rect(20);', { kerf: 0 });
  assert.equal(grown.parts[0].width, 24);
});

test('infinite and huge counts end in errors, not endless loops', () => {
  for (const src of [
    'star(n = 1/0);',
    'arc(end = 1/0);',
    'arc(end = 1e9);',
    'part("p", qty = 1/0) rect(1);',
    'rect([1/0, 2]);',
    'polygon([[0, 0], [1/0, 0], [0, 1]]);',
  ])
    assert.throws(() => render(src, { maxSteps: 1000 }), Error, src);
});

test('svg paths: numbers after Z, exponents and drawing on after Z', () => {
  assert.throws(() => render('path("M0 0 L10 0 Z 1");'), /Z takes no numbers/);
  const exp = render('path("M1e2 0 L0 0 L0 10 Z");', { kerf: 0 });
  assert.equal(exp.parts[0].width, 100);
  const after = layers(render('path("M0 0 L10 0 L0 10 Z L5 5");', { kerf: 0 }))[0].get('cut');
  assert.equal(after.lines.length, 1);
  assert.deepEqual(after.lines[0].length, 2);
});

test('long lists work in each, min, max and norm', () => {
  const r = render(
    'echo(len([each [0:200000]])); echo(max([for (i = [0:200000]) i])); echo(min([3, 1, 2]), norm([3, 4])); rect(1);',
  );
  assert.deepEqual(r.echoes, ['200001', '200000', '1, 5']);
});

test('a used library keeps what it includes', () => {
  const files = {
    outer: 'include <inner> module outer() { inner(); }',
    inner: 'k = 2; module inner() { rect(k); }',
    a: 'include <b> module a() { b(); }',
    b: 'include <a> module b() { rect(3); }',
  };
  const resolve = (p) => files[p];
  assert.equal(render('use <outer> outer();', { resolve, kerf: 0 }).parts[0].width, 2);
  assert.equal(render('use <a> a();', { resolve, kerf: 0 }).parts[0].width, 3);
});

test('gap, margin, sheet and kerf must be usable numbers', () => {
  const src = 'part("p", qty = 2) rect(20);';
  for (const opts of [
    { gap: NaN },
    { gap: -10 },
    { margin: -1 },
    { sheet: [0, 100] },
    { kerf: -1 },
  ])
    assert.throws(() => render(src, opts), Error, JSON.stringify(opts));
  assert.throws(() => render('$sheet = [100, 1/0];' + src), /sheet/);
});

test('hull() works inside each named part, the same as inside the part', () => {
  const pair = '{ rect(10); translate([20, 0]) rect(10); }';
  for (const src of [`hull() part("p") ${pair}`, `part("p") hull() ${pair}`]) {
    const p = render(src, { kerf: 0 }).parts;
    assert.equal(p.length, 1, src);
    assert.deepEqual([p[0].name, p[0].width, p[0].height, p[0].pieces], ['p', 30, 10, 1], src);
  }
  const both = render(`hull() { part("p") ${pair} translate([0, 50]) ${pair} }`, { kerf: 0 });
  assert.deepEqual(
    both.parts.map((p) => [p.name, p.width, p.height, p.pieces]),
    [
      ['part', 30, 10, 1],
      ['p', 30, 10, 1],
    ],
  );
});

test('layers whose DXF names match stay separate layers', () => {
  const r = render(
    'rect(100); layer("a b", "line", "#00ff00") translate([10, 10]) rect(10);' +
      'layer("a_b", "line", "#0000ff") translate([40, 10]) rect(5);' +
      'layer("A_B_2", "line") translate([70, 10]) rect(5);',
    { kerf: 0 },
  );
  const dxf = r.sheets[0].dxf;
  const records = [...dxf.matchAll(/\nLAYER\n2\n(.*)\n70\n0\n62\n(\d+)\n/g)].map((m) => [
    m[1],
    +m[2],
  ]);
  assert.deepEqual(records.slice(1, 4), [
    ['A_B', 3],
    ['A_B_3', 5],
    ['A_B_2', 3],
  ]);
  assert.equal(new Set(records.map((x) => x[0])).size, records.length);
  for (const name of ['A_B', 'A_B_3', 'A_B_2', 'CUT'])
    assert.equal(dxf.split(`\nPOLYLINE\n8\n${name}\n`).length - 1, 1, name);
});

test('built-in functions take named arguments', () => {
  const r = render(
    'echo(sin(30), sin(x = 30), pow(x = 2, y = 10), pow(2, y = 3), pow(y = 3, x = 2), atan2(y = 1, x = 1));' +
      'echo(log(100), log(2, 8), log(x = 8, base = 2), log(8, base = 2), min(values = [3, 1]), max(4, 5));' +
      'echo(log(2, x = 8), log(x = 100), log(base = 2, x = 8));' +
      'echo(slice("hello", start = 1, end = 3), join(values = [1, 2], separator = "-"), lookup(x = 1, table = [[0, 0], [2, 4]]));' +
      'rect(1);',
  );
  assert.deepEqual(r.echoes, [
    '0.5, 0.5, 1024, 8, 8, 45',
    '2, 3, 3, 3, 1, 5',
    '3, 2, 3',
    'el, 1-2, 2',
  ]);
  assert.deepEqual(r.warnings, []);
});

test('an unknown named argument to a built-in function is a warning', () => {
  const r = render(
    'echo(sin(y = 30)); echo(sin(y = 30)); echo(str(1, sep = ","), abs(-2, $fn = 3)); rect(1);',
  );
  assert.deepEqual(r.echoes, ['undef', 'undef', '1, 2']);
  assert.deepEqual(r.warnings, [
    'sin(): unknown argument "y" (line 1)',
    'str(): unknown argument "sep" (line 1)',
  ]);
});

test('names every object has are not functions, modules or libraries', () => {
  for (const name of ['toString', 'constructor', 'valueOf', 'hasOwnProperty'])
    assert.throws(
      () => render(`echo(${name}(1)); rect(1);`),
      new RegExp(`Unknown function ${name}\(\)`),
    );
  assert.throws(() => render('toString(); rect(1);'), KerfError);
  assert.throws(() => render('include <toString>\nrect(1);'), /Library <toString> not found/);
  assert.throws(
    () => render('include <constructor>\nrect(1);', { resolve: (p) => ({})[p] }),
    /Library <constructor> not found/,
  );
});

test('an error in a library says which library', () => {
  const resolve = (p) => (p === 'lib/tab' ? 'module tab() {\n  rect(nope + 1);\n}\n' : undefined);
  const e = (() => {
    try {
      render('use <lib/tab>\ntab();', { resolve });
    } catch (e) {
      return e;
    }
  })();
  assert.ok(e instanceof KerfError);
  assert.equal(e.file, 'lib/tab');
  assert.match(e.message, /line 2, column \d+ in <lib\/tab>/);
  assert.throws(
    () => render('use <lib/tab>\nfunction f( = 1;', { resolve }),
    (err) => !err.file,
  );
});

test('log takes its form from the number of arguments', () => {
  assert.throws(() => render('echo(log(undef, 8)); rect(1);'), /log\(\) needs a number, got undef/);
  assert.deepEqual(render('echo(log(8), log(x = 100)); rect(1);').echoes, ['0.903089987, 2']);
});

test('an argument given by position and by name is a warning', () => {
  const r = render('echo(min(1, values = [5, 0]), pow(2, x = 3, y = 2)); rect(1);');
  assert.deepEqual(r.echoes, ['0, 9']);
  assert.deepEqual(r.warnings, [
    'min(): "values" is given by position and by name; the named value is used (line 1)',
    'pow(): "x" is given by position and by name; the named value is used (line 1)',
  ]);
});

test('built-in layers keep their DXF names', () => {
  const r = render(
    'part("a") { layer("Cut", mode = "line") translate([1, 1]) rect(3); rect(10); }',
    { dxf: true },
  );
  const layers = r.sheets[0].dxf.split(/\r?\n/).filter((l, i, a) => a[i - 1] === '8');
  assert.deepEqual([...new Set(layers)], ['CUT_2', 'CUT']);
});

test('a list times a matrix of the wrong size is an error', () => {
  for (const src of ['[1, 2] * [[1, 2]]', '[1, 2] * [[1, 2], 3]', '[1, 2] * [[1, 2], [3]]'])
    assert.throws(
      () => render(`echo(${src}); rect(1);`),
      /Can't multiply a list of length 2 by a matrix/,
    );
  assert.deepEqual(render('echo([1, 2] * [[1, 0], [0, 1]]); rect(1);').echoes, ['[1, 2]']);
});

test('settings from outside the program are values a program could have', () => {
  for (const bad of [{ type: 'function' }, { type: 'range' }, [1, { a: 1 }], () => 1])
    assert.throws(
      () => render('w = 1; echo(w); rect(1);', { params: { w: bad } }),
      /Setting "w" must be/,
    );
  assert.deepEqual(render('w = 1; echo(w); rect(1);', { params: { w: [1, 'a', true] } }).echoes, [
    '[1, "a", true]',
  ]);
});

test('the children cache tells apart special variables holding different functions', () => {
  const r = render(
    'module twice() { $f = function(x) x; children(); translate([40, 0]) { $f = function(x) x * 2; children(); } }\ntwice() square($f(10));',
  );
  // A 10 mm square, then a 20 mm one
  const sizes = layers(r)[0]
    .get('cut')
    .regions.map((p) =>
      Math.round(Math.max(...p.map((q) => q[0])) - Math.min(...p.map((q) => q[0]))),
    );
  assert.deepEqual(
    sizes.sort((a, b) => a - b),
    [10, 20],
  );
});

test('writing a record is bounded however deeply records nest', () => {
  // Each level holds the one below twice: 2^40 fields when written out
  let src = 'r0 = {v = 1};\n';
  for (let i = 1; i <= 40; i++) src += `r${i} = {a = r${i - 1}, b = r${i - 1}};\n`;
  src += 'echo(str(r40));';
  const started = Date.now();
  assert.throws(() => render(src), /long|limit/i);
  assert.ok(Date.now() - started < 2000);
  const short = render('r = {a = {b = [1, "x"]}, c = 2};\necho(r);');
  assert.deepEqual(short.echoes, ['{a = {b = [1, "x"]}, c = 2}']);
});

test('a layer that is already the back of another cannot be redefined as a front layer', () => {
  assert.throws(
    () =>
      render(
        'layer("score", side = "back") square(3);\nlayer("score-back", "line", "#0000ff") square(5);\nsquare(20);',
      ),
    /is the back of layer "score"/,
  );
});

test('hardware sides are bounded', () => {
  assert.throws(
    () =>
      render(
        '$thickness = 3;\npart("p") square(10);\nhardware("dowel", [0, 0, 0], [0, 0, 10], 6, sides = 1e9);',
      ),
    /sides must be from 3 to 128/,
  );
});

test('the children cache tells apart numbers that print alike', () => {
  const r = render(
    'module twice() { $a = 1.0000000001; children(); translate([40, 0]) { $a = 1.0000000002; children(); } }\ntwice() square($a == 1.0000000001 ? 10 : 20);',
  );
  const sizes = layers(r)[0]
    .get('cut')
    .regions.map((p) =>
      Math.round(Math.max(...p.map((q) => q[0])) - Math.min(...p.map((q) => q[0]))),
    );
  assert.deepEqual(
    sizes.sort((a, b) => a - b),
    [10, 20],
  );
});

test('$label_parts does not put numbers on a front layer named engrave-back', async () => {
  const font = readFileSync(new URL('../fonts/AtkinsonHyperlegible-Regular.ttf', import.meta.url));
  const r = render(
    '$label_parts = true;\nlayer("engrave-back", "fill", "#000000") translate([100, 0]) square(1);\npart("p") square(40);',
    {
      fonts: { A: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) },
      defaultFont: 'A',
    },
  );
  assert.ok(
    r.warnings.some((w) => /uses for the front/.test(w)),
    r.warnings.join('\n'),
  );
  assert.ok(!r.sheets.some((s) => s.back));
});

test('a bend far beyond its part warns and stays cheap to draw', () => {
  const r = render('$thickness = 3;\npart("p", bend = [0, 1000000000, 90]) rect([40, 10]);');
  assert.ok(
    r.warnings.some((w) => /beyond the part/.test(w)),
    r.warnings.join('\n'),
  );
  const pieces = meshPieces(r.assembly[0].outline, r.assembly[0].bends);
  assert.ok(pieces.length <= 2002, String(pieces.length));
  const wide = meshPieces(
    [
      [
        [0, 0],
        [1e6, 0],
        [1e6, 1],
        [0, 1],
      ],
    ],
    [{ x0: 0, x1: 1e6, angle: 90 }],
  );
  assert.ok(wide.length <= 2002, String(wide.length));
});

test('mirror per copy cuts those copies mirrored, as a part of their own', () => {
  const r = render(`
part("side", qty = 2, at = [[0, 0, 0], [40, 0, 0]], rotate = [90, 0, 90], mirror = [false, true]) {
  polygon([[0, 0], [30, 0], [5, 20]]);
  engrave() translate([2, 2]) square(3);
}`);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(
    r.parts.map((p) => [p.name, p.qty, !!p.mirrored]),
    [
      ['side', 1, false],
      ['side', 1, true],
    ],
  );
  // Copies keep their numbers, the second at x = 40
  assert.deepEqual(
    r.assembly.map((a) => [a.copy, a.matrix[3]]),
    [
      [1, 0],
      [2, 40],
    ],
  );
  // The mirrored one's apex is at x = -5
  const xs = r.assembly[1].outline.flat().map(([x]) => x);
  assert.equal(Math.min(...xs), -30);
  // On the sheet too each copy keeps its number, packed or laid out as drawn,
  // so a sheet item pairs with its own placement in the assembly
  for (const opts of [{}, { layout: 'none' }]) {
    const s = render(
      `part("side", qty = 3, at = [[0, 0, 0], [40, 0, 0], [80, 0, 0]], mirror = [true, false, true]) polygon([[0, 0], [30, 0], [5, 20]]);`,
      opts,
    );
    assert.deepEqual(
      s.sheets
        .flatMap((sh) => sh.items)
        .map((it) => it.copy)
        .sort(),
      [1, 2, 3],
    );
  }
  assert.throws(
    () => render('part("x", qty = 2, mirror = [true]) square(3);'),
    /mirror needs one true or false per copy/,
  );
});

test('a module asking for a child it was not given warns', () => {
  // Without braces only the first statement is the child; the second stands
  // on its own and is added to the part as material
  const r = render(`
module engraved() { children(0); engrave() children(1); }
part("a") { engraved() square(20); translate([5, 5]) square(3); }`);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /engraved\(\) uses children\(1\) but was given 1 child \(line 3\)/);
  // Guarded by $children, with no children at all, or braced: no warning
  for (const src of [
    'module m() { children(0); if ($children > 1) children(1); } part("a") m() square(20);',
    'module m() { square(5); children(0); } part("a") m();',
    'module m() { children(0); children(1); } part("a") m() { square(20); square(3); }',
  ])
    assert.deepEqual(render(src).warnings, [], src);
});

test('two libraries defining one name warn once, naming both', () => {
  const libs = {
    'a.kerf': 'module shape() square(5);\nfunction f() = 1;',
    'b.kerf': 'module shape() circle(5);',
    'c.kerf': 'use <a.kerf>\nmodule x() shape();',
  };
  const resolve = (p) => libs[p];
  const r = render('use <a.kerf>\nuse <b.kerf>\nuse <c.kerf>\npart("p") shape();', { resolve });
  assert.deepEqual(r.warnings, [
    'module shape is defined in <a.kerf> (line 1) and in <b.kerf> (line 1); the one in <b.kerf> is used. Rename one to use both.',
  ]);
  // The same library reached twice is one definition
  assert.deepEqual(
    render('use <a.kerf>\nuse <c.kerf>\npart("p") shape();', { resolve }).warnings,
    [],
  );
});

test('a fill wholly under a layer stacked above it warns', () => {
  const r = render(`
layer("glass", mode = "fill", color = "#88aacc");
layer("stone", mode = "fill", color = "#888888");
part("rose") { circle(d = 30); layer("stone") circle(d = 26); layer("glass") square(4, center = true); }`);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /layer "glass" .* wholly under "stone", stacked above it/);
  // Drawn in one paint(), the later piece is on top and nothing hides
  const ok = render(`
layer("glass", mode = "fill", color = "#88aacc");
layer("stone", mode = "fill", color = "#888888");
part("rose") { circle(d = 30); paint(["stone", "glass"]) { circle(d = 26); square(4, center = true); } }`);
  assert.deepEqual(ok.warnings, []);
  // A hairline under a stroked outline is meant to be covered
  const hair = render(`
layer("dot", mode = "fill", color = "#ffffff");
layer("ink", mode = "fill", color = "#000000");
part("p") { square(20); layer("ink") stroke(0.6) line([2, 5], [18, 5]); layer("dot") translate([5, 4.9]) square([4, 0.2]); }`);
  assert.deepEqual(hair.warnings, []);
});

test('a bend ending at the edge, past it only by rounding, does not warn', () => {
  const r = render(
    'part("p", bend = [10, 30.0000199, 90], at = [0, 0, 0]) square([30.00002, 10]);',
  );
  assert.deepEqual(
    r.warnings.filter((w) => /beyond the part/.test(w)),
    [],
  );
});

test('a child of intersection() or difference() that makes nothing is left out, as in OpenSCAD', () => {
  const size = (src) => {
    const r = render(src, { kerf: 0 });
    return [r.parts[0].width, r.parts[0].height];
  };
  const want = size('part("P") intersection() { rect(10); circle(r = 8); }');
  assert.deepEqual(want, [8, 8]);
  // What OpenSCAD 2021.01 leaves out: an if that is false with no else, an
  // echo or assert with no children, a child switched off with *
  for (const skipped of [
    'if (false) circle(r = 2);',
    'echo("x");',
    'assert(true);',
    '*circle(r = 2);',
  ])
    assert.deepEqual(
      size(`part("P") intersection() { rect(10); circle(r = 8); ${skipped} }`),
      want,
      skipped,
    );
  // and what it keeps as a child that draws nothing, emptying the intersection
  for (const empty of [
    'for (i = []) circle(r = 2);',
    'union() { for (i = [1:1:0]) circle(r = 2); }',
    'translate([1, 0]) if (false) circle(r = 2);',
    'if (true) {}',
    'none();',
    'intersection() { circle(1); translate([50, 0]) circle(1); }',
  ])
    assert.deepEqual(
      size(`module none() {}
part("P") intersection() { rect(10); circle(r = 8); ${empty} }`),
      [0, 0],
      empty,
    );
  // The first child that makes something is the one cut from
  assert.deepEqual(
    size('part("D") difference() { if (false) rect(30); rect(10); circle(r = 3); }'),
    [10, 10],
  );
  assert.deepEqual(size('part("D") difference() { union() {} rect(10); }'), [0, 0]);
});

test('a part with nothing in it warns once', () => {
  const r = render('part("E", qty = 2) rect(0); part("ok") rect(3);', { kerf: 0 });
  assert.deepEqual(r.warnings, ['Part "E" is empty: nothing drawn in it is left to cut.']);
  const g = render('part("G") intersection() { rect(10); for (i = []) circle(2); }', { kerf: 0 });
  assert.deepEqual(g.warnings, ['Part "G" is empty: nothing drawn in it is left to cut.']);
  // intersection() already says when it empties a part
  const cut = render('intersection() { part("P") rect(5); translate([20, 0]) rect(5); }', {
    kerf: 0,
  });
  assert.equal(cut.warnings.filter((w) => w.includes('"P"')).length, 1);
});

test('a strip whose curve changes radius bends as each stretch of it does', () => {
  const r = render(
    `use <kerf/hinge>
R = 60; yb = 45; rc = 12;
xc = sqrt(pow(R - rc, 2) - pow(yb - rc, 2));
a0 = atan2(-yb + rc, xc);
path = concat([[0, -yb]], [for (i = [0:8]) let (a = -90 + i * (a0 + 90) / 8) [xc, -yb + rc] + rc * [cos(a), sin(a)]], [for (i = [1:40]) let (a = a0 + i * (90 - a0) / 40) R * [cos(a), sin(a)]]);
echo(strip_bends(path));
place(rotate = [90, 0, 0]) flex_strip(path, 40, name = "Wall");`,
    { kerf: 0 },
  );
  const bends = JSON.parse(r.echoes[0]);
  // The fillet and the arc, each its own radius, end to end
  const radius = (b) => (b[1] - b[0]) / ((Math.abs(b[2]) * Math.PI) / 180);
  const fillet = bends.find((b) => Math.abs(radius(b) - 12) < 1);
  const arc = bends.find((b) => Math.abs(radius(b) - 60) < 2);
  assert.ok(fillet && arc, JSON.stringify(bends));
  for (let i = 1; i < bends.length; i++) assert.ok(bends[i][0] >= bends[i - 1][1] - 1e-6);
  // The bent strip stays on the path: x 0..60, z -45..60, give or take its thickness
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (const b of meshBodies(r))
    if (b.kind === 'part')
      for (let i = 0; i < b.positions.length; i += 3)
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], b.positions[i + k]);
          hi[k] = Math.max(hi[k], b.positions[i + k]);
        }
  assert.ok(lo[0] > -2 && hi[0] < 62, `x ${lo[0]}..${hi[0]}`);
  assert.ok(lo[2] > -47 && hi[2] < 62, `z ${lo[2]}..${hi[2]}`);
  assert.deepEqual(r.warnings, []);
});

test('a sharp corner beside a curve is a bend of its own', () => {
  const r = render(
    `use <kerf/hinge>
echo(strip_bends(concat([[-40, 0]], [for (a = [0:5:90]) [-25, 0] + 25 * [cos(a), sin(a)]])));`,
  );
  const bends = JSON.parse(r.echoes[0]);
  assert.equal(bends.length, 2);
  assert.deepEqual(
    bends.map((b) => Math.round(b[2] * 10) / 10),
    [92.5, 85],
  );
});

test('pattern() clips a tile that an edge of the area crosses, though no corner of the area is in it', () => {
  const area = (mask) => {
    const r = render(
      `measure() { difference() { rect([20, 20], center = true);
         pattern(100) { rect([10, 10], center = true); ${mask} } } echo($area); }`,
    );
    return Number(r.echoes[0]);
  };
  // A 2 mm rib kept between two openings, across, up and corner to corner
  const strip = (rot) =>
    `difference() { rect([12, 12], center = true); rotate(${rot}) rect([2, 40], center = true); }`;
  const clipped = (rot) =>
    render(
      `measure() { difference() { rect([20, 20], center = true);
         intersection() { rect([10, 10], center = true); ${strip(rot)} } } echo($area); }`,
    ).echoes[0];
  for (const rot of [0, 90, 45])
    assert.equal(String(area(strip(rot))), clipped(rot), `rotate(${rot})`);
  assert.equal(area(strip(0)), 320);
});

test('a tab that only dips into a part is not a slot, though another tab on its part goes deep', () => {
  const src = (t, turn) => `$thickness = ${t};
    place(rotate = [0, 0, ${turn}]) {
      part("base", at = [0, 0, 0], slots = "wall", clearance = 0) rect([60, 40]);
      part("wall", at = [0, 20, ${t}], rotate = [90, 0, 0]) {
        rect([60, 20]);
        translate([30, -0.2]) rect([5, 0.21]);
        translate([10, -${t}]) rect([5, ${t} + 0.01]);
      }
    }`;
  for (const [t, turn] of [
    [3, 0],
    [3, 30],
    [1, 0],
  ]) {
    const r = render(src(t, turn), { kerf: 0 });
    const base = r.parts.find((p) => p.name === 'base');
    // The outline and one slot 5 x t, not two
    assert.ok(
      Math.abs(base.cutLength - (200 + 10 + 2 * t)) < 0.01,
      `${t} ${turn}: ${base.cutLength}`,
    );
    assert.ok(
      r.warnings.some((w) => /collide/.test(w)),
      `${t} ${turn}`,
    );
  }
});

test('closed cuts go deepest first: a part nested in a hole is cut before the hole', () => {
  const box = (xs, ys) => [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const fromD = (d) =>
    d
      .split('M')
      .slice(1)
      .map((p) => {
        const v = p.match(/-?[\d.]+/g).map(Number);
        return box(
          v.filter((_, i) => i % 2 === 0),
          v.filter((_, i) => i % 2 === 1),
        );
      });
  // The boxes of the cut layer's rings, in the order each output has them
  const order = (r) => {
    const s = r.sheets[0];
    const svg = s.svg.split('<g id="cut"')[1].split('</g>')[0];
    const dxf = [];
    let cur = null;
    const lines = s.dxf.split('\n').map((l) => l.trim());
    for (let i = 0; i < lines.length - 1; i += 2) {
      const [code, v] = [lines[i], lines[i + 1]];
      if (code === '0' && v === 'POLYLINE') dxf.push((cur = { x: [], y: [] }));
      if (code === '10' && cur) cur.x.push(Number(v));
      if (code === '20' && cur) cur.y.push(Number(v));
    }
    return {
      paths: fromD(s.paths.find((p) => p.name === 'cut').regions),
      svg: [...svg.matchAll(/ d="([^"]+)"/g)].flatMap((m) => fromD(m[1])),
      dxf: dxf.map((c) => box(c.x.slice(1), c.y.slice(1))),
    };
  };
  const holds = (a, b) => a[0] < b[0] && a[1] < b[1] && a[2] > b[2] && a[3] > b[3];
  const cases = [
    // a solid insert in a frame
    'part("frame") difference() { rect([100, 100]); translate([10, 10]) rect([80, 80]); } part("insert") rect([20, 20]);',
    // a washer in a ring
    'part("ring") difference() { circle(50); circle(40); } part("washer") difference() { circle(15); circle(5); }',
    // rings inside rings
    'for (r = [50, 35, 20]) part(str("ring ", r)) difference() { circle(r); circle(r - 8); }',
  ];
  for (const src of cases) {
    const r = render('$nest = true; $fn = 32; ' + src, { kerf: 0 });
    const o = order(r);
    let nested = 0;
    for (const [k, boxes] of Object.entries(o)) {
      assert.equal(boxes.length, o.paths.length, k);
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          assert.ok(!holds(boxes[i], boxes[j]), `${k}: ring ${i} holds ring ${j} after it: ${src}`);
          if (holds(boxes[j], boxes[i])) nested++;
        }
    }
    // The parts did nest, or there would be nothing to order
    assert.ok(nested >= 3 * (r.parts.length + 1), src);
  }
});

test('$layout = "none" puts each material and thickness on a sheet of its own', () => {
  const r = render(
    `$layout = "none";
     material(name = "plywood", thickness = 3) part("base") rect([40, 20]);
     material(name = "acrylic", thickness = 2) part("window") translate([50, 0]) rect([30, 15]);
     material(name = "acrylic", thickness = 3) part("lid") translate([0, 30]) rect([10, 10]);
     material(name = "plywood", thickness = 3) part("foot") translate([0, 30]) rect([10, 5]);
     part("back", side = "back") { rect(10); score(side = "back") line([2, 2], [8, 8]); }`,
    { kerf: 0 },
  );
  const sheets = r.sheets.map((s) => `${s.material} ${s.thickness}: ${s.items.map((i) => i.part)}`);
  assert.deepEqual(sheets.slice(0, 3), [
    'plywood 3: base,foot',
    'acrylic 2: window',
    'acrylic 3: lid',
  ]);
  // Kept where they were drawn: the foot's top 15 mm past the base's, y down
  const ply = r.sheets[0].items;
  const y = (it) =>
    Math.min(
      ...it.layers
        .get('cut')
        .regions.flat()
        .map((p) => p[1]),
    );
  assert.equal(Math.round(y(ply[0]) - y(ply[1])), 15);
});

// Where a strip's middle is, assembled, at x along it
const stripAt = (p, x) => {
  const q = bendPoint(p.bends ?? [], p.thickness, [x, 0, p.thickness / 2]);
  const m = p.matrix;
  return [0, 1, 2].map(
    (i) => m[i * 4] * q[0] + m[i * 4 + 1] * q[1] + m[i * 4 + 2] * q[2] + m[i * 4 + 3],
  );
};
const stripEnds = (p) => {
  const xs = p.outline.flat().map((q) => q[0]);
  return [stripAt(p, Math.min(...xs)), stripAt(p, Math.max(...xs))];
};
const near = (a, b, tol, msg) =>
  assert.ok(Math.hypot(...a.map((v, i) => v - b[i])) < tol, `${msg}: ${a} is not ${b}`);

test('a strip round sharp corners ends where its path ends, rounded at the corners', () => {
  for (const [path, end] of [
    ['[[0, 0], [100, 0], [100, 100]]', [100, 100, 0]],
    ['[[0, 0], [100, 0], [100, -100]]', [100, -100, 0]],
    ['[[0, 0], [100, 0], [100, -60], [30, -80]]', [30, -80, 0]],
    ['[[0, 0], [60, 0], [60, 40], [0, 40], [0, 15]]', [0, 15, 0]],
  ]) {
    const r = render(`use <kerf/hinge>\n$thickness = 3;\nflex_strip(${path}, 30, tabs = false);`);
    assert.deepEqual(r.warnings, []);
    const [a, b] = stripEnds(r.assembly[0]);
    near(a, [0, 0, 0], 0.01, path);
    near(b, end, 0.05, path);
  }
  // The L: two straights of 92.5 and a quarter circle of radius 7.5 between
  const l = render(
    'use <kerf/hinge>\n$thickness = 3;\nflex_strip([[0, 0], [100, 0], [100, 100]], 30, tabs = false);',
  );
  assert.ok(Math.abs(l.parts[0].width - (185 + (7.5 * Math.PI) / 2)) < 0.05, l.parts[0].width);
});

test('a strip with no curve is straight, and a wall cut into straight pieces renders', () => {
  for (const path of ['[[0, 0], [100, 0]]', '[[0, 0], [50, 0], [100, 0]]']) {
    const r = render(`use <kerf/hinge>\nflex_strip(${path}, 30);`, { kerf: 0 });
    assert.equal(r.parts[0].width, 100);
    assert.equal(r.assembly[0].bends, undefined);
  }
  const sq = render(
    'use <kerf/hinge>\n$thickness = 3;\nwall([[0, 0], [100, 0], [100, 100], [0, 100]], 30, max_length = 100);',
  );
  assert.deepEqual(sq.warnings, []);
  assert.equal(sq.parts.filter((p) => /strip/.test(p.name)).length, 4);
});

test('wall() never cuts a piece longer than max_length, and its pieces meet end to end', () => {
  for (const [outline, opts, max] of [
    ['[[0, 0], [100, 0], [100, 100], [0, 100]]', 'join = [50, 0], max_length = 150', 150],
    ['[[0, 0], [300, 0], [300, 10], [0, 10]]', 'join = [0, 5], max_length = 150', 150],
    ['[[0, 0], [100, 0], [100, 100], [0, 100]]', 'join = [0, 0]', 400],
    ['[for (a = [0:5:355]) 40 * [cos(a), sin(a)]]', 'join = [0, -40], max_length = 70', 70],
  ]) {
    const r = render(`use <kerf/hinge>\n$thickness = 3;\nwall(${outline}, 30, ${opts});`, {
      kerf: 0,
    });
    assert.deepEqual(r.warnings, [], opts);
    const strips = r.assembly.filter((p) => /strip/.test(p.name));
    for (const p of r.parts.filter((p) => /strip/.test(p.name)))
      assert.ok(p.width <= max + 1e-6, `${opts}: ${p.name} ${p.width}`);
    // Each piece starts where the one before it ends, seam apart
    const ends = strips.map(stripEnds);
    for (let k = 0; k < ends.length; k++)
      near(ends[k][1], ends[(k + 1) % ends.length][0], 0.35, `${opts} piece ${k + 1}`);
  }
});

test('wall_splits keeps every cut where no piece is longer than max_length', () => {
  const r = render(`use <kerf/hinge>
echo(wall_splits(400, 3, 150, [100], []));
echo(wall_splits(300, 2, 160, [], []));`);
  for (const e of r.echoes) {
    const cuts = [0, ...JSON.parse(e)];
    cuts.push(cuts.length === 3 ? 400 : 300);
    const max = cuts.length === 4 ? 150 : 160;
    for (let k = 1; k < cuts.length; k++) assert.ok(cuts[k] - cuts[k - 1] <= max, e);
  }
});

test('a part glued to a stack goes on the stack, one for each copy of it', () => {
  const z = (r, name) =>
    r.assembly.filter((a) => a.name === name).map((a) => [a.matrix[3], a.matrix[7], a.matrix[11]]);
  const t = '$thickness = 3;\n';
  // On top of three layers, and under them
  let r = render(
    t +
      'part("post", at = [0, 0, 0], stack = 3) rect(20);' +
      'part("cap", glue = "post") rect(20);' +
      'part("foot", glue = "post", face = "bottom") rect(20);' +
      'part("pads", glue = "post", stack = 2) rect(10);',
  );
  assert.deepEqual(z(r, 'cap'), [[0, 0, 9]]);
  assert.deepEqual(z(r, 'foot'), [[0, 0, -3]]);
  assert.deepEqual(z(r, 'pads'), [
    [0, 0, 9],
    [0, 0, 12],
  ]);
  // Nothing inside the stack: the cap and the pads share its top, as asked
  assert.ok(!r.warnings.some((w) => /"post".*collide/.test(w)), r.warnings.join('\n'));
  // Two stacks, a cap on each
  r = render(
    t +
      'part("post", qty = 2, at = [[0, 0, 0], [50, 0, 0]], stack = 2) rect(20);' +
      'part("cap", qty = 2, glue = "post") rect(20);',
  );
  assert.deepEqual(z(r, 'cap'), [
    [0, 0, 6],
    [50, 0, 6],
  ]);
  // Under a stack that hangs under its host: below its lowest layer
  r = render(
    t +
      'part("top", at = [0, 0, 20]) rect(30);' +
      'part("legs", glue = "top", face = "bottom", stack = 2) rect(20);' +
      'part("pad", glue = "legs", face = "bottom") rect(10);',
  );
  assert.deepEqual(z(r, 'legs'), [
    [0, 0, 17],
    [0, 0, 14],
  ]);
  assert.deepEqual(z(r, 'pad'), [[0, 0, 11]]);
  // Mixed thicknesses: a stack of two 4 mm layers with 3 mm parts on it
  r = render(
    t +
      'material(thickness = 4) part("post", at = [0, 0, 0], stack = 2) rect(20);' +
      'part("cap", glue = "post") rect(20);' +
      'part("foot", glue = "post", face = "bottom") rect(20);',
  );
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(z(r, 'cap'), [[0, 0, 8]]);
  assert.deepEqual(z(r, 'foot'), [[0, 0, -3]]);
});

test('a stack split into its layers for blind slots keeps its name and stays one stack', () => {
  const shelf = `part("top", at = [0, 0, 30], stack = 2, slots = "leg") rect([80, 40]);
    part("leg", at = [10, 20, 0], rotate = [90, 0, 0]) {
      rect([5, 30]);
      translate([1, 29.99]) rect([3, 3.01]);
    }\n`;
  const r = render(
    shelf +
      'part("cross", at = [50, 20, 10], rotate = [90, 0, 90], halving = "top") rect([40, 40]);',
  );
  assert.deepEqual(
    r.parts.map((p) => p.name),
    ['top, layer 1', 'top, layer 2', 'leg', 'cross'],
  );
  assert.deepEqual(r.warnings, []);
  // Halved: the cross and both layers are cut where they meet
  const plain = render(
    shelf + 'part("cross", at = [50, 20, 10], rotate = [90, 0, 90]) rect([40, 40]);',
  );
  const cut = (res, n) => res.parts.find((p) => p.name === n).cutLength;
  assert.ok(cut(r, 'cross') > cut(plain, 'cross'));
  assert.ok(cut(r, 'top, layer 2') > cut(plain, 'top, layer 2'));
  // The second layer is glued on the first, so it prints as one object
  const layer2 = r.assembly.findIndex((a) => a.name === 'top, layer 2');
  assert.equal(
    r.assembly[layer2].glued,
    r.assembly.findIndex((a) => a.name === 'top, layer 1'),
  );
  const objects = new Set(
    meshBodies(render(shelf), { layout: 'print' })
      .filter((b) => /^top/.test(b.part))
      .map((b) => b.instance),
  );
  assert.equal(objects.size, 1);
});

test('a bent part moved, scaled or mirrored in 2D bends where its drawing went', () => {
  const box = (src) => {
    const r = render(src);
    assert.deepEqual(r.warnings, [], src);
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (const b of meshBodies(r, { layout: 'assembled' }).filter((b) => b.kind === 'part'))
      for (let i = 0; i < b.positions.length; i += 3)
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], b.positions[i + k]);
          hi[k] = Math.max(hi[k], b.positions[i + k]);
        }
    return [...lo, ...hi].map((v) => Math.round(v * 1000) / 1000 + 0);
  };
  const part = (bend, w = 40) => `part("c", at = [0, 0, 0], bend = ${bend}) rect([${w}, 20]);`;
  // Moved and scaled, as if drawn there
  assert.deepEqual(
    box(`translate([100, 0]) ${part('[10, 20, 90]')}`),
    box(`part("c", at = [0, 0, 0], bend = [110, 120, 90]) translate([100, 0]) rect([40, 20]);`),
  );
  assert.deepEqual(box(`scale([2, 1]) ${part('[10, 20, 90]')}`), box(part('[20, 40, 90]', 80)));
  // Mirrored: the mirror image
  const [x0, y0, z0, x1, y1, z1] = box(part('[10, 20, 90]'));
  assert.deepEqual(box(`mirror([1, 0]) ${part('[10, 20, 90]')}`), [-x1, y0, z0, -x0 + 0, y1, z1]);
  // Twice mirrored is as drawn; a turn can't keep the bends across x
  assert.deepEqual(box(`mirror([1, 0]) mirror([1, 0]) ${part('[10, 20, 90]')}`), [
    x0,
    y0,
    z0,
    x1,
    y1,
    z1,
  ]);
  assert.throws(
    () => render(`rotate(90) ${part('[10, 20, 90]')}`),
    /can be moved, scaled or mirrored but not turned/,
  );
});

test('measure() counts what any cutting layer cuts and leaves out any guide layer', () => {
  const m = (src) => render(src).echoes[0];
  const two = (a, b) =>
    `measure() { group() { ${a} rect([10, 10]); ${b} translate([20, 0]) rect([10, 10]); } echo($area, $centroid); }`;
  // The same squares on the built-in layers and on custom ones
  assert.equal(m(two('', '')), '200, [15, 5]');
  assert.equal(
    m('layer("slow-cut", mode = "cut");' + two('', 'layer("slow-cut")')),
    '200, [15, 5]',
  );
  assert.equal(m(two('', 'guide()')), '100, [5, 5]');
  assert.equal(
    m(
      'layer("construction", mode = "guide");' +
        two('layer("slow-cut", mode = "cut")', 'layer("construction")'),
    ),
    '100, [5, 5]',
  );
});

test('text(fit = w) is no wider than w, counting glyphs that reach past their advance', () => {
  const fonts = {
    A: readFileSync(new URL('../fonts/AtkinsonHyperlegible-Regular.ttf', import.meta.url)),
  };
  for (const [src, w] of [
    ['text("q", fit = 20);', 20],
    ['text("q", fit = [20, undef]);', 20],
    ['text("jq", fit = [15, 40]);', 15],
    ['text("Wavy jq", fit = 50);', 50],
  ]) {
    const r = render(`part("label") ${src}`, { fonts, kerf: 0 });
    assert.ok(r.parts[0].width <= w + 1e-6, `${src} ${r.parts[0].width}`);
    assert.ok(r.parts[0].width > w - 2, `${src} ${r.parts[0].width}`);
  }
});

test('a kerf or thickness that is not a finite number is an error, not a silent 0', () => {
  for (const src of [
    '$kerf = 0/0; part("p") rect(20);',
    '$kerf = 0/0; rect(20);',
    'material(kerf = 0/0) part("p") rect(20);',
    '$thickness = 1/0; part("p", at = [0, 0, 0]) rect(20);',
    '$thickness = -1/0; part("p") rect(20);',
    '$thickness = 0/0; part("p") rect(20);',
    '$thickness = 1/0; rect(20);',
    'material(thickness = 1/0) part("p") rect(20);',
  ])
    assert.throws(() => render(src), /(kerf|thickness) must be/, src);
  // 0 is a kerf
  assert.equal(render('$kerf = 0; part("p") rect(20);').parts[0].kerf, 0);
  assert.equal(render('rect(20);').parts[0].kerf, 0);
});

test('a layer set again after marks went on its back sets its back the same way', () => {
  const r = render(`part("p") {
    rect(20);
    layer("etch", mode = "line", side = "back") translate([2, 2]) rect(4);
    layer("etch", mode = "fill", color = "#ff0000", order = 5);
  }`);
  const def = (n) => r.layers.find((l) => l.name === n);
  assert.deepEqual(
    { ...def('etch-back'), name: 'etch', side: undefined },
    { ...def('etch'), side: undefined },
  );
  assert.match(r.sheets[0].back.svg, /<g id="etch-back"[^>]*data-mode="fill" fill="#ff0000"/);
  // A layer with marks on the back cannot become a cut layer
  assert.throws(
    () =>
      render(
        'part("p") { rect(20); layer("etch", side = "back") rect(4); layer("etch", mode = "cut"); }',
      ),
    /already has marks on the back face/,
  );
});

test('a library path may hold any character a folder name has', () => {
  for (const path of [
    'C:/Designs/My lib/tabs',
    'C:/Designs/My (plywood)/tabs',
    'C:/Designs/#1/tabs',
    'C:/Designs/José/tabs',
    String.raw`C:\Temp\run#!{1}\tabs`,
    '/home/me/Ö & co/tabs.kerf',
  ]) {
    let asked;
    const r = render(`use <${path}>\ntile();`, {
      resolve: (p) => ((asked = p), 'module tile() rect(10);'),
      kerf: 0,
    });
    assert.equal(asked, path);
    assert.equal(r.parts[0].width, 10);
  }
  // A path stops at the end of its line, and < still compares
  assert.throws(() => render('use <kerf/box\n>'), /library path/);
  assert.deepEqual(render('a = 1; use <kerf/box> echo(a < 2, 3 > a);').echoes, ['true, true']);
});

test('part(pieces = ...) is a part of loose pieces, and says when the count is off', () => {
  const eyes = (p) =>
    render(`part("eyes"${p}) { circle(5); translate([20, 0]) circle(5); }`).warnings;
  assert.match(eyes('')[0], /cuts into 2 separate pieces\. Join them/);
  assert.deepEqual(eyes(', pieces = 2'), []);
  assert.deepEqual(eyes(', pieces = "any"'), []);
  assert.deepEqual(eyes(', pieces = 3'), [
    'Part "eyes" cuts into 2 separate pieces, not the 3 its pieces = says.',
  ]);
  assert.deepEqual(render('part("one", pieces = 2) circle(5);').warnings, [
    'Part "one" cuts into 1 separate piece, not the 2 its pieces = says.',
  ]);
  assert.throws(() => render('part("e", pieces = 0) circle(3);'), /pieces must be a whole number/);
});

test('part(fold = ...) folds card along any line, panel by panel', () => {
  const box = (b) =>
    [0, 1, 2].map((k) => {
      const v = b.positions.filter((_, i) => i % 3 === k);
      return [Math.round(Math.min(...v) * 10) / 10, Math.round(Math.max(...v) * 10) / 10];
    });
  const card = render(
    '$thickness = 0.4; part("card", at = [0, 0, 0], fold = [[60, 0], [60, 80], 90]) rect([120, 80]);',
  );
  assert.deepEqual(card.warnings, []);
  const [flat, up] = meshBodies(card).filter((b) => b.kind === 'part');
  assert.deepEqual(box(flat), [
    [0, 60],
    [0, 80],
    [0, 0.4],
  ]);
  // Hinged on the top face, the far half stands up beside the fold
  assert.deepEqual(box(up), [
    [60, 60.4],
    [0, 80],
    [0.4, 60.4],
  ]);
  // Down, and half open
  const down = render(
    '$thickness = 0.4; part("card", at = [0, 0, 0], fold = [[60, 0], [60, 80], -90], fold_open = 0.5) rect([120, 80]);',
  );
  const [, d] = meshBodies(down).filter((b) => b.kind === 'part');
  assert.ok(box(d)[2][0] < -40 && box(d)[0][1] > 100);
  // A pop-up step: slits part the panels, and one fold line joins a pair
  // either side of them
  const pop = render(
    '$thickness = 0.4; part("card", at = [0, 0, 0], fold = [[[80, 0], [80, 40], 90], [[80, 60], [80, 100], 90], [[70, 40], [70, 60], 90], [[80, 40], [80, 60], -90], [[90, 40], [90, 60], 90]]) { rect([160, 100]); for (y = [40, 60]) line([70, y], [90, y]); }',
  );
  assert.deepEqual(pop.warnings, []);
  const panels = meshBodies(pop)
    .filter((b) => b.kind === 'part')
    .map(box);
  assert.equal(panels.length, 4);
  assert.ok(
    panels.some(([x, , z]) => x[0] === 70 && x[1] === 80 && z[0] === 10),
    'the tread',
  );
  assert.ok(
    panels.some(([x, , z]) => x[0] === 70 && x[1] === 70.4 && z[1] === 10.4),
    'the riser',
  );
  // A fold that divides nothing warns; bends and folds don't mix
  assert.match(
    render('part("c", at = [0, 0, 0], fold = [[60, 10], [60, 70], 90]) rect([120, 80]);')
      .warnings[0],
    /does not divide the part/,
  );
  assert.throws(
    () => render('part("c", bend = [10, 20, 90], fold = [[0, 0], [0, 10], 90]) rect(40);'),
    /living hinges or folds, not both/,
  );
});

test('part(hang = ...) swings a part until its weight is below, on a cord', () => {
  const r = render(
    '$thickness = 3; part("leg", qty = 2, at = [[-10, -1.5, 2], [10, -1.5, 2]], rotate = [90, 0, 0], hang = [0, 0], cord = 20) translate([0, -4]) rect([40, 8]);',
  );
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(
    r.hardware.map((h) => [h.kind, h.label, h.from, h.to]),
    [
      ['cord', 'leg 1 cord', [-10, -1.5, 2], [-10, -1.5, -18]],
      ['cord', 'leg 2 cord', [10, -1.5, 2], [10, -1.5, -18]],
    ],
  );
  const leg = meshBodies(r).find((b) => b.kind === 'part');
  const zs = leg.positions.filter((_, i) => i % 3 === 2);
  const xs = leg.positions.filter((_, i) => i % 3 === 0);
  // Hanging straight down from the cord's end, 40 mm long
  assert.ok(Math.abs(Math.max(...zs) + 18) < 1e-6 && Math.abs(Math.min(...zs) + 58) < 1e-6);
  assert.ok(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2 + 10) < 1e-6);
  assert.throws(() => render('part("x", hang = [0, 0]) rect(10);'), /needs at/);
  assert.throws(
    () => render('part("x", at = [0, 0, 0], cord = 5) rect(10);'),
    /cord goes with hang/,
  );
});

test('symbol(min_width = ...) grows lines too thin to cut', () => {
  const narrow = (extra) =>
    render(`use <kerf/symbols>\npart("s") symbol("flamingo", 25${extra});`).warnings.filter((w) =>
      /narrower than/.test(w),
    ).length;
  assert.ok(narrow('') > 0);
  assert.equal(narrow(', min_width = 1.6'), 0);
});

test('$copy draws each copy of a part apart, alike copies staying one part', () => {
  const r = render(
    'part("ring", qty = 5, at = [for (i = [0:4]) [i * 30, 0, 0]]) circle(d = 10 + 4 * ($copy % 3));',
  );
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(
    r.parts.map((p) => [p.qty, p.copies, p.width]),
    [
      [2, [1, 4], 10],
      [2, [2, 5], 14],
      [1, [3], 18],
    ],
  );
  assert.deepEqual(
    r.assembly.map((a) => a.copy),
    [1, 4, 2, 5, 3],
  );
  // A part that doesn't read $copy is drawn once, as before
  assert.deepEqual(
    render('part("same", qty = 3) circle(10);').parts.map((p) => [p.qty, p.copies]),
    [[3, undefined]],
  );
  // $copy is 0 outside part(), as undef
  assert.deepEqual(render('echo($copy); part("p", qty = 2) { echo($copy); circle(5); }').echoes, [
    'undef',
    '0',
    '1',
  ]);
});

test('part(split = ...) cuts a big part into pieces that fit, joined by knobs', () => {
  const r = render(
    '$sheet = [300, 200];\npart("wreath", split = true) { difference() { circle(d = 480); circle(d = 320); } engrave() for (a = [0:30:330]) rotate(a) translate([200, 0]) circle(8); }',
  );
  assert.deepEqual(r.warnings, []);
  assert.equal(r.parts.length, 6);
  for (const p of r.parts) {
    assert.ok(p.width <= 294 && p.height <= 194, `${p.name} ${p.width} x ${p.height}`);
    assert.ok(p.joins.length >= 2, p.name);
  }
  assert.deepEqual(r.parts[0].joins, ['wreath piece 2', 'wreath piece 3']);
  // The pieces hold all the material, less the knobs' clearance
  const whole = render('part("w") difference() { circle(d = 480); circle(d = 320); }').parts[0];
  assert.ok(whole.width > 294);
  assert.throws(() => render('part("w", split = [0, 10]) rect(10);'), /split must be/);
  // A part that fits is left whole
  assert.equal(render('part("w", split = true) rect(50);').parts[0].name, 'w');
});

test('$stands = true warns when a model tips over, counting hardware mass', () => {
  const tips = (s) =>
    render(`$stands = true; $thickness = 3;\n${s}`).warnings.some((w) => /tips over/.test(w));
  assert.equal(
    tips(
      'part("base", at = [-40, -40, 0]) rect([80, 80]); part("post", at = [-5, 1.5, 3], rotate = [90, 0, 0]) rect([10, 100]);',
    ),
    false,
  );
  assert.equal(
    tips(
      'part("base", at = [-10, -10, 0]) rect([20, 20]); part("arm", at = [-10, -1.5, 3], rotate = [90, 0, 0]) rect([200, 10]);',
    ),
    true,
  );
  const holder =
    'part("base", at = [-20, -20, 0]) rect([40, 40]); part("arm", at = [0, -1.5, 3], rotate = [90, 0, 0]) rect([60, 5]); hardware("ball", [55, 0, 30], size = 44, shape = "ball"';
  assert.equal(tips(`${holder});`), false);
  assert.equal(tips(`${holder}, mass = 60);`), true);
  // Without $stands nothing is checked
  assert.ok(
    !render(
      'part("base", at = [-10, -10, 0]) rect([20, 20]); part("arm", at = [-10, -1.5, 3], rotate = [90, 0, 0]) rect([200, 10]);',
    ).warnings.some((w) => /tips over/.test(w)),
  );
});
