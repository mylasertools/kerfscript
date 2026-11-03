import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LIMITS, render } from '../dist/index.js';

const box = (extra = '') =>
  render(`use <kerf/box>\nmaterial(thickness = 3) box([120, 80, 50], lid = true${extra});`);

test('a box from kerf/box assembles with every panel and no collisions', () => {
  const r = box();
  assert.deepEqual(
    r.assembly.map((p) => p.name),
    ['bottom', 'lid', 'front', 'back', 'left', 'right'],
  );
  assert.equal(r.warnings.filter((w) => /collide/.test(w)).length, 0);
  const right = r.assembly.find((p) => p.name === 'right');
  assert.deepEqual([right.matrix[3], right.matrix[7], right.matrix[11]], [117, 0, 0]);
});

test('placement follows rotate then translate, like OpenSCAD', () => {
  const r = render('part("panel", at = [10, 20, 30], rotate = [90, 0, 0]) rect([40, 20]);');
  const m = r.assembly[0].matrix;
  const apply = (x, y, z) =>
    [0, 1, 2].map((i) => m[i * 4] * x + m[i * 4 + 1] * y + m[i * 4 + 2] * z + m[i * 4 + 3]);
  assert.deepEqual(apply(0, 0, 0), [10, 20, 30]);
  assert.deepEqual(apply(0, 20, 0), [10, 20, 50]);
});

test('a wrong finger edge makes parts collide', () => {
  const r = render(`material(thickness = 3) {
  part("bottom", at = [0, 0, 0]) finger_rect([120, 80], "out");
  part("front", at = [0, 3, 0], rotate = [90, 0, 0]) finger_rect([120, 50], "out");
}`);
  assert.match(r.warnings.join('\n'), /Parts "bottom" and "front" collide/);
});

test('copies take one placement each, or share one', () => {
  const r = render(
    'part("leg", qty = 4, at = [[0, 0, 0], [100, 0, 0], [0, 60, 0], [100, 60, 0]], rotate = [90, 0, 0]) rect([20, 60]);',
  );
  assert.equal(r.assembly.length, 4);
  assert.deepEqual(
    r.assembly.map((p) => p.copy),
    [1, 2, 3, 4],
  );
  assert.throws(
    () => render('part("leg", qty = 3, at = [[0, 0, 0], [1, 0, 0]]) rect(5);'),
    /one placement per copy/,
  );
  assert.throws(() => render('part("leg", at = "here") rect(5);'), /at must be \[x, y, z\]/);
});

test('parts without a placement come after the placed ones', () => {
  const r = render('part("a") rect(10); part("b", at = [0, 0, 5]) rect(10);');
  assert.deepEqual(
    r.assembly.map((p) => `${p.name} ${p.placed}`),
    ['b true', 'a false'],
  );
  assert.equal(render('rect(10);').assembly.length, 0);
});

const lantern = (dx, bump = '') =>
  render(`material(thickness = 3) {
  part("wall", at = [0, 3, 0], rotate = [90, 0, 0]) difference() { rect([150, 60]); translate([63, 20]) rect([24, 3]); }
  part("base", at = [${dx}, 0, 20]) { translate([0, 3]) rect([150, 147]); translate([63, 0]) rect([24, 3]); ${bump} }
}`);
const clash = (r) => r.warnings.filter((w) => /collide/.test(w));

test('a small tab on a big part is checked along its whole edge', () => {
  assert.deepEqual(clash(lantern(0)), []);
  for (const dx of [-1, -0.5, 0.5, 1]) assert.equal(clash(lantern(dx)).length, 1, `moved ${dx} mm`);
});

test('an overlap deeper than 0.1 mm collides, however small; a touch does not', () => {
  assert.deepEqual(clash(lantern(0, 'translate([10, 2.92]) rect([0.3, 0.08]);')), []);
  assert.equal(clash(lantern(0, 'translate([10, 2.7]) rect([0.3, 0.3]);')).length, 1);
  assert.equal(clash(lantern(0, 'translate([10, 2.5]) rect([2, 0.5]);')).length, 1);
});

test('a part dipping 0.13 mm into another collides, whichever comes first', () => {
  const floor = 'part("floor", at = [0, 0, 0]) rect([60, 40]);';
  const arm = (d) => `part("arm", at = [10, 20, ${3 - d}], rotate = [90, 0, 0]) rect([30, 10]);`;
  for (const d of [0.13, 0.2]) {
    assert.equal(clash(render(floor + arm(d))).length, 1, `${d} mm`);
    assert.equal(clash(render(arm(d) + floor)).length, 1, `${d} mm, arm first`);
  }
  assert.deepEqual(clash(render(floor + arm(0.08))), []);
  assert.deepEqual(clash(render(floor + arm(0))), []);
});

test('stacked parallel parts collide only when they share depth', () => {
  const stack = (z) =>
    clash(
      render(
        `material(thickness = 3) { part("a", at = [0, 0, 0]) rect([40, 40]); part("b", at = [10, 10, ${z}]) rect([40, 40]); }`,
      ),
    );
  assert.deepEqual(stack(3), []);
  assert.equal(stack(2).length, 1);
  assert.deepEqual(
    clash(
      render(
        `material(thickness = 3) { part("a", at = [0, 0, 0]) rect([40, 40]); part("b", at = [40, 0, 0]) rect([40, 40]); }`,
      ),
    ),
    [],
  );
});

test('parts without a placement lie flat beside the assembly', () => {
  const r = render(`use <kerf/box>
material(thickness = 3) {
  box([120, 80, 50]);
  part("divider", qty = 2) divider([74, 47]);
  part("tag") rect([30, 10]);
}`);
  const loose = r.assembly.filter((p) => !p.placed);
  assert.deepEqual(
    loose.map((p) => `${p.name}${p.copy}`),
    ['divider1', 'divider2', 'tag1'],
  );
  assert.ok(r.assembly.filter((p) => p.placed).length === 5);
  for (const p of loose) {
    assert.deepEqual([p.matrix[0], p.matrix[5], p.matrix[10], p.matrix[11]], [1, 1, 1, 0]);
    assert.ok(p.matrix[3] >= 130);
  }
  assert.deepEqual(
    loose.map((p) => [p.matrix[3], p.matrix[7]]),
    [
      [130, 0],
      [130, 57],
      [214, 57],
    ],
  );
  assert.match(
    r.warnings.join('\n'),
    /Parts "divider", "tag" have no at or rotate, so they lie flat beside the assembly/,
  );
  assert.equal(r.warnings.filter((w) => /collide/.test(w)).length, 0);
});

test('a design with no placements at all stays unassembled', () => {
  const r = render(
    'material(thickness = 3) { part("a") rect([40, 20]); part("b") circle(d = 10); }',
  );
  assert.deepEqual(r.assembly, []);
  assert.equal(r.warnings.length, 0);
});

test('copies sharing one placement warn once instead of colliding with each other', () => {
  const r = render('part("leg", qty = 3, at = [0, 0, 0], rotate = [90, 0, 0]) rect([10, 40]);');
  assert.equal(r.assembly.length, 3);
  assert.equal(r.warnings.filter((w) => /collide/.test(w)).length, 0);
  assert.equal(r.warnings.filter((w) => /same place/.test(w)).length, 1);
});

test('the collision check stops at the pair limit with a warning', () => {
  const src = 'for (i = [0:59]) part(str("p", i), at = [0, 0, i * 0.5]) rect([40, 20]);';
  const r = render(src, { limits: { ...DEFAULT_LIMITS, maxCollisionPairs: 50 } });
  assert.equal(r.assembly.length, 60);
  assert.ok(r.warnings.some((w) => /more than 50 pairs/.test(w)));
});
