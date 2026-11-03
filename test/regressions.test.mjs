import test from 'node:test';
import assert from 'node:assert/strict';
import { KerfError, render } from '../dist/index.js';

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
