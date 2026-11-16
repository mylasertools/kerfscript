import test from 'node:test';
import assert from 'node:assert/strict';
import { render, parameters, KerfError } from '../dist/index.js';

const echo = (src, opts) => render(src, opts).echoes;

test('numbers, lists, ranges and comprehensions', () => {
  const out = echo(`
    echo(1 + 2 * 3, 2 ^ 3, -2 ^ 2, 7 % 3);
    echo([1, 2] + [3, 4], [1, 2] * 3, [1, 2] * [3, 4]);
    echo([for (i = [0:2:6]) i], [for (i = [1:5]) if (i % 2) i * i else 0]);
    echo([for (i = [0:1], j = [0:1]) [i, j]], [each [1, 2], 3]);
    echo(len("kerf"), str("a", 1, true), upper("ok"), "a" + "b");
    echo(max([3, 9, 2]), min(4, 1), round(-2.5), sin(30), cos(60), atan2(1, 1));
    echo(lookup(5, [[0, 0], [10, 100]]), sum([1, 2, 3]), slice([1, 2, 3, 4], 1, 3));
    echo(true && false, !undef, undef == undef, [1, [2]] == [1, [2]]);
  `);
  assert.deepEqual(out, [
    '7, 8, -4, 1',
    '[4, 6], [3, 6], 11',
    '[0, 2, 4, 6], [1, 0, 9, 0, 25]',
    '[[0, 0], [0, 1], [1, 0], [1, 1]], [1, 2, 3]',
    '4, a1true, OK, ab',
    '9, 1, -3, 0.5, 0.5, 45',
    '50, 6, [2, 3]',
    'false, true, true, true',
  ]);
});

test('functions, closures, recursion and let', () => {
  const out = echo(`
    function fib(n) = n < 2 ? n : fib(n - 1) + fib(n - 2);
    function apply(f, x) = f(x);
    double = function(x) x * 2;
    k = 10;
    add_k = function(x) x + k;
    echo(fib(15), apply(double, 21), add_k(1), let (a = 2, b = a * 3) a + b);
    echo(late(2));
    function late(x) = x * 100;
  `);
  assert.deepEqual(out, ['610, 42, 11, 8', '200']);
});

test('modules, children and dynamic $ variables', () => {
  const out = echo(`
    module show() { echo($thickness, $children); children(); }
    module wrap() { show() children(); }
    material(thickness = 6) show() { rect(1); rect(2); }
    wrap() echo("inside", $thickness);
    show($thickness = 4) echo("arg", $thickness);
  `);
  assert.deepEqual(out, ['6, 2', '3, 1', 'inside, 3', '4, 1', 'arg, 4']);
});

test('assignments run in order and top-level parameters can be overridden', () => {
  const src = 'w = 10; h = w * 2; echo(w, h);';
  assert.deepEqual(echo(src), ['10, 20']);
  assert.deepEqual(echo(src, { params: { w: 3 } }), ['3, 6']);
});

test('errors carry line and column', () => {
  assert.throws(
    () => render('x = 1;\ny = [1, 2] + 3;'),
    (e) => e instanceof KerfError && e.line === 2 && /Can't add list and number/.test(e.message),
  );
  assert.throws(() => render('rect(nope);'), /Unknown variable "nope" \(line 1, column 6\)/);
  assert.match(render('color("red") rect(1);').warnings[0], /color\(\) is ignored/);
  assert.throws(() => render('x = [1, 2;'), /Expected ","/);
  assert.throws(() => render('assert(1 > 2, "too small");'), /Assertion failed: too small/);
});

test('runaway programs stop', () => {
  assert.throws(() => render('function f(n) = f(n + 1); x = f(0);'), /Recursion too deep/);
  assert.throws(() => render('for (i = [0:1e9]) rect(1);'), /more than the limit/);
  assert.throws(
    () => render('for (i = [0:100000]) for (j = [0:1000]) echo(1);', { maxSteps: 10000 }),
    /Stopped after 10000 steps/,
  );
});

test('echo output survives an error', () => {
  try {
    render('echo("before"); x = undef + 1;');
    assert.fail('should throw');
  } catch (e) {
    assert.deepEqual(e.echoes, ['before']);
  }
});

test('customizer parameters', () => {
  const { parameters: ps } = parameters(`
/* [Size] */
// Outer width
width = 120; // [40:5:400]
depth = 80; // [100]
shape = "round"; // [round:Round, square:Square]
count = 3; // [2, 3, 4]
lid = true; // [ignored]
size = [10, 20];
label = str("x", 1);
/* [Hidden] */
secret = 1;
`);
  assert.deepEqual(
    ps.map((p) => [p.name, p.group, p.type]),
    [
      ['width', 'Size', 'number'],
      ['depth', 'Size', 'number'],
      ['shape', 'Size', 'string'],
      ['count', 'Size', 'number'],
      ['lid', 'Size', 'boolean'],
      ['size', 'Size', 'number'],
    ],
  );
  assert.deepEqual(ps[5].initial, [10, 20]);
  assert.equal(ps[0].caption, 'Outer width');
  assert.deepEqual(
    ps.slice(1).map((p) => p.caption),
    ['', '', '', '', ''],
  );
  assert.deepEqual([ps[0].min, ps[0].step, ps[0].max], [40, 5, 400]);
  assert.equal(ps[1].max, 100);
  assert.deepEqual(ps[2].options, [
    { name: 'Round', value: 'round' },
    { name: 'Square', value: 'square' },
  ]);
  assert.deepEqual(
    ps[3].options.map((o) => o.value),
    [2, 3, 4],
  );
});

test('parameter spans point at the top-level value only', () => {
  const src = `module tag() {
  size = 5;
  rect(size);
}
size = 30; // [10:100]
label = "a; b"; // Text
offset = [-2, 4];
tag();
`;
  const ps = parameters(src).parameters;
  const at = (name) => src.slice(...ps.find((p) => p.name === name).span);
  assert.equal(at('size'), '30');
  assert.equal(at('label'), '"a; b"');
  assert.equal(at('offset'), '[-2, 4]');
  const [start, end] = ps.find((p) => p.name === 'size').span;
  const next = src.slice(0, start) + '45' + src.slice(end);
  assert.ok(next.includes('  size = 5;') && next.includes('size = 45; // [10:100]'));
});

test('use <kerf/box> loads the standard library', () => {
  const r = render('use <kerf/box>\nbox([100, 60, 40], lid = true);');
  assert.deepEqual(r.parts.map((p) => p.name).sort(), [
    'back',
    'bottom',
    'front',
    'left',
    'lid',
    'right',
  ]);
  assert.throws(() => render('use <kerf/nothing>'), /Library <kerf\/nothing> not found/);
});

test('use resolves user libraries through the resolver', () => {
  const r = render('use <parts/ring>\nring(5);', {
    resolve: (p) =>
      p === 'parts/ring' ? 'module ring(r) difference() { circle(r); circle(r / 2); }' : undefined,
  });
  assert.equal(r.parts[0].width, 10);
});
