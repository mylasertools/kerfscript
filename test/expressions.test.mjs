import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../dist/index.js';

const echo = (src) => render(`${src} square(1);`).echoes;

test('assert and echo chain before an expression', () => {
  const lib = `function slot(t, c) =
    assert(t > 0, "Thickness must be positive")
    assert(c >= 0, "Clearance must not be negative")
    t + c;`;
  assert.deepEqual(echo(`${lib} echo(slot(3, 0.25));`), ['3.25']);
  // A failed check stops before the expression, here a division by zero
  assert.throws(() => echo(`${lib} echo(slot(0, 1) / 0);`), /Thickness must be positive/);
  assert.throws(() => echo(`${lib} echo(slot(1, -1));`), /Clearance must not be negative/);
  // After a let, and with a list after it rather than an index
  assert.deepEqual(echo('function f(p) = let (q = 2) assert(q > 1) [p, q]; echo(f(1));'), [
    '[1, 2]',
  ]);
  assert.deepEqual(echo('function f(x) = echo("x", x) x * 2; echo(f(4));'), ['x, 4', '8']);
  // The call forms stay as they were
  assert.deepEqual(echo('ok = assert(true); echo(ok, [assert(1 < 2), 3]);'), ['true, [true, 3]']);
});

test('let follows an operator', () => {
  assert.deepEqual(echo('echo(1 + let (z = 2) z * 3, true && let (d = 2) d > 1);'), ['7, true']);
});

test('sort, with or without a key', () => {
  assert.deepEqual(
    echo('echo(sort([3, 1, 2]), sort(["b", "a"]), sort([[2, 1], [1, 5], [1, 2]]));'),
    ['[1, 2, 3], ["a", "b"], [[1, 2], [1, 5], [2, 1]]'],
  );
  // Equal keys keep their order
  assert.deepEqual(echo('echo(sort([[1, "b"], [0, "a"], [1, "a"]], function(e) e[0]));'), [
    '[[0, "a"], [1, "b"], [1, "a"]]',
  ]);
  assert.throws(() => echo('echo(sort([1, "a"]));'), /can only order/);
});

test('fold and scan accumulate', () => {
  assert.deepEqual(
    echo(
      'add = function(a, b) a + b; echo(fold([1, 2, 3], 0, add), scan([1, 2, 3], 0, add), fold([], 7, add), scan([], 0, add), fold([[1, 0], [0, 2]], [0, 0], add));',
    ),
    ['6, [1, 3, 6], 7, [], [1, 2]'],
  );
  // Long lists don't run out of recursion as a recursive function would
  assert.deepEqual(echo('echo(fold([for (i = [1:5000]) 1], 0, function(a, b) a + b));'), ['5000']);
  assert.throws(() => echo('echo(fold([1], 0, 5));'), /needs a function/);
  assert.throws(
    () =>
      render('x = scan([for (i = [1:100]) i], 0, function(a, b) a + b); square(1);', {
        maxSteps: 50,
      }),
    /Stopped after 50 steps/,
  );
});

test('bounds and crossings of outlines', () => {
  const sq = 'sq = [[0, 0], [10, 0], [10, 20], [0, 20]]; hole = [[2, 2], [4, 2], [4, 4], [2, 4]];';
  assert.deepEqual(
    echo(
      `${sq} echo(bounds(sq), bounds([sq, hole]), bounds([]), crossings(sq, 5), crossings(sq, y = 3), crossings(sq, 20), crossings([sq, hole], 3));`,
    ),
    ['[0, 0, 10, 20], [0, 0, 10, 20], undef, [0, 20], [0, 10], [], [0, 2, 4, 20]'],
  );
  // Through a corner it counts once
  assert.deepEqual(echo('echo(crossings([[0, 0], [10, 10], [0, 20]], 10));'), ['[]']);
  assert.throws(() => echo('echo(crossings([[0, 0], [1, 0], [0, 1]]));'), /one of x or y/);
});

test('qty = 0 makes no part', () => {
  const r = render('L = []; part("a", qty = len(L), at = L) square(5); part("b") square(3);');
  assert.deepEqual(
    r.parts.map((p) => p.name),
    ['b'],
  );
  assert.deepEqual(r.warnings, []);
  assert.throws(() => render('part("a", qty = -1) square(3);'), /qty must be 0 or more/);
});

test('largest keeps the biggest pieces', () => {
  const r = render(`
part("a") largest() { square(20); translate([30, 0]) square(2); translate([40, 0]) square(5); }
part("b") largest(2) { square(20); translate([30, 0]) square(2); translate([40, 0]) square(5); }`);
  assert.deepEqual(
    r.parts.map((p) => [p.name, p.width, p.pieces]),
    [
      ['a', 20, 1],
      ['b', 45, 2],
    ],
  );
});

test('intersection_for keeps what every iteration covers', () => {
  const cut = (src) => render(`part("a") ${src}`).parts[0];
  // A for loop inside intersection() is one child, the union
  assert.equal(cut('intersection() for (x = [0, 5]) translate([x, 0]) square(10);').width, 15);
  assert.equal(cut('intersection_for (x = [0, 5]) translate([x, 0]) square(10);').width, 5);
  assert.equal(cut('intersection_for (x = [3]) translate([x, 0]) square(10);').width, 10);
  assert.equal(
    render('part("a") { square(1); intersection_for (x = []) square(10); }').parts[0].width,
    1,
  );
});
