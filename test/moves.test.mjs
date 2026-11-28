import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../dist/index.js';

const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

test('a part inside hinge() records the turn in assembled coordinates', () => {
  const r = render(`
    part("base", at = [0, 0, 0]) rect([100, 60]);
    hinge(from = [0, 60, 3], to = [100, 60, 3], angle = 100)
      part("lid", at = [0, 0, 3]) rect([100, 60]);
  `);
  const base = r.assembly.find((p) => p.name === 'base');
  const lid = r.assembly.find((p) => p.name === 'lid');
  assert.equal(base.moves, undefined);
  assert.deepEqual(lid.moves, [{ turn: { from: [0, 60, 3], to: [100, 60, 3], angle: 100 } }]);
});

test('hinge() and slide() follow place(), and nested moves list the innermost first', () => {
  const r = render(`
    place(at = [10, 0, 0], rotate = [0, 0, 90])
      slide(by = [5, 0, 0])
        hinge(from = [0, 0, 0], to = [0, 0, 1], angle = 30)
          part("door") rect([20, 20]);
  `);
  const [door] = r.assembly;
  assert.equal(door.moves.length, 2);
  const [turn, slide] = door.moves;
  assert.ok(close(turn.turn.from, [10, 0, 0]));
  assert.ok(close(turn.turn.to, [10, 0, 1]));
  assert.equal(turn.turn.angle, 30);
  assert.ok(close(slide.slide, [0, 5, 0]));
});

test('hardware inside a hinge moves with it', () => {
  const r = render(`
    hinge(from = [0, 0, 10], to = [50, 0, 10], angle = 90) {
      part("lid", at = [0, 0, 10]) rect([50, 40]);
      hardware("knob", from = [25, 30, 13], to = [25, 30, 20], size = 8);
    }
  `);
  assert.equal(r.hardware[0].moves[0].turn.angle, 90);
});

test('a part glued on a moving part moves with it', () => {
  const r = render(`
    hinge(from = [0, 0, 3], to = [80, 0, 3], angle = 90)
      part("lid", at = [0, 0, 3]) rect([80, 50]);
    part("badge", glue = "lid", at = [10, 10]) circle(d = 20);
  `);
  const badge = r.assembly.find((p) => p.name === 'badge');
  assert.deepEqual(badge.moves, r.assembly.find((p) => p.name === 'lid').moves);
});

test('a hinge needs two different points', () => {
  assert.throws(
    () => render('hinge(from = [1, 2, 3], to = [1, 2, 3]) part("x") rect([5, 5]);'),
    /different points/,
  );
});

test('moves do not change the closed assembly or its collision check', () => {
  const plain = render('part("a") rect([40, 40]); part("b", at = [0, 0, 3]) rect([40, 40]);');
  const moving = render(
    'part("a") rect([40, 40]); slide(by = [0, 0, 50]) part("b", at = [0, 0, 3]) rect([40, 40]);',
  );
  assert.deepEqual(
    moving.assembly.map((p) => p.matrix),
    plain.assembly.map((p) => p.matrix),
  );
  assert.deepEqual(moving.warnings, plain.warnings);
});

test('a chain of glued parts moves with the part at its end, in any order', () => {
  const r = render(`
    part("top", glue = "badge", at = [5, 5]) circle(d = 6);
    part("badge", glue = "lid", at = [10, 10]) circle(d = 20);
    hinge(from = [0, 0, 3], to = [80, 0, 3], angle = 90)
      part("lid", at = [0, 0, 3]) rect([80, 50]);
  `);
  const lid = r.assembly.find((p) => p.name === 'lid').moves;
  assert.deepEqual(r.assembly.find((p) => p.name === 'badge').moves, lid);
  assert.deepEqual(r.assembly.find((p) => p.name === 'top').moves, lid);
});

test("a moving part glued on a moving part makes its own move, then its host's", () => {
  const r = render(`
    hinge(from = [0, 0, 3], to = [80, 0, 3], angle = 90) {
      part("lid", at = [0, 0, 3]) rect([80, 50]);
      part("inlay", glue = "lid", at = [5, 5]) rect([20, 20]);
    }
    slide(by = [10, 0, 0]) part("knob", glue = "lid", at = [10, 10]) circle(d = 10);
  `);
  const turn = { turn: { from: [0, 0, 3], to: [80, 0, 3], angle: 90 } };
  assert.deepEqual(r.assembly.find((p) => p.name === 'knob').moves, [{ slide: [10, 0, 0] }, turn]);
  // Inside the same hinge as its host: it turns once, not twice
  assert.deepEqual(r.assembly.find((p) => p.name === 'inlay').moves, [turn]);
});

test('lights inside a hinge move with it', () => {
  const r = render(`
    hinge(from = [0, 0, 10], to = [50, 0, 10]) {
      hardware("tealight", from = [25, 20, 10], to = [25, 20, 20]);
      light(at = [10, 10, 12]);
    }
  `);
  assert.equal(r.lights.length, 2);
  for (const l of r.lights) assert.equal(l.moves[0].turn.angle, 90);
});

test('moveMatrix turns and slides a fraction of the way', async () => {
  const { moveMatrix } = await import('../dist/index.js');
  const at = (m, p) =>
    [0, 1, 2].map(
      (r) => m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3],
    );
  const turn = { turn: { from: [0, 0, 0], to: [1, 0, 0], angle: 90 } };
  assert.ok(close(at(moveMatrix([turn], 1), [0, 10, 0]), [0, 0, 10]));
  assert.ok(close(at(moveMatrix([turn], 0), [0, 10, 0]), [0, 10, 0]));
  // Innermost first: turn, then slide
  assert.ok(close(at(moveMatrix([turn, { slide: [0, 0, 5] }], 1), [0, 10, 0]), [0, 0, 15]));
  assert.ok(close(at(moveMatrix([{ slide: [4, 0, 0] }], 0.5), [0, 0, 0]), [2, 0, 0]));
});

const runInto = (r) => r.warnings.filter((w) => w.includes('when the model is opened'));
const lidBox = (from, to) => `
  part("base", at = [0, 0, 0]) rect([100, 60]);
  part("back", at = [0, 63, 3], rotate = [90, 0, 0]) rect([100, 37]);
  hinge(from = ${from}, to = ${to}, angle = 110)
    part("lid", at = [0, 0, 40]) rect([100, 63]);
`;

test('a lid that turns down into the box is found when the model opens', () => {
  const r = render(lidBox('[0, 63, 40]', '[100, 63, 40]'));
  const w = runInto(r);
  assert.ok(
    w.some((s) => s.includes('"back" and "lid"') || s.includes('"lid" and "back"')),
    w.join('\n'),
  );
  assert.match(w[0], /% of the way, around \[/);
});

test('a lid that turns up out of the box opens clear', () => {
  const r = render(lidBox('[100, 63, 40]', '[0, 63, 40]'));
  assert.deepEqual(runInto(r), []);
  assert.deepEqual(r.warnings, []);
});

test('a drawer that slides through a wall is found, one that slides out is not', () => {
  const model = (by) => `
    part("wall", at = [0, 0, 0], rotate = [90, 0, 0]) rect([80, 40]);
    slide(by = ${by}) part("drawer", at = [0, 5, 10]) rect([80, 40]);
  `;
  const [w] = runInto(render(model('[0, -50, 0]')));
  assert.match(w, /Parts "wall" and "drawer" run into each other when the model is opened/);
  assert.deepEqual(runInto(render(model('[0, 50, 0]'))), []);
});

test('parts that move together never run into one another', () => {
  const r = render(`
    part("base", at = [0, 0, 0]) rect([100, 100]);
    slide(by = [0, 0, 80]) {
      part("a", at = [0, 0, 20]) rect([50, 50]);
      part("b", at = [0, 0, 20], rotate = [90, 0, 0]) rect([50, 30]);
    }
  `);
  assert.deepEqual(runInto(r), []);
});

test('hinge() and slide() round shapes alone, as inside a part, warn that nothing moves', () => {
  const r = render('part("a", at = [0, 0, 0]) hinge([0, 0, 0], [1, 0, 0]) rect([5, 5]);');
  assert.ok(
    r.warnings.some((w) => /^hinge\(\) moves only parts, hardware and lights/.test(w)),
    r.warnings.join('\n'),
  );
  const none = (src) => !render(src).warnings.some((w) => w.includes('so nothing moves'));
  // Nothing inside at all, as when an if turns a lid off: no warning
  assert.ok(none('slide([0, 0, 5]) if (false) part("lid", at = [0, 0, 0]) rect([5, 5]);'));
  // Hardware alone moves
  assert.ok(none('slide([0, 0, 5]) hardware("dowel", from = [0, 0, 0], to = [0, 0, 10]);'));
  assert.ok(none('hinge([0, 0, 0], [1, 0, 0]) part("lid", at = [0, 0, 0]) rect([5, 5]);'));
});

test('two parts with the same name are told apart when the model opens', () => {
  const r = render(`
    part("panel", at = [0, 0, 0], rotate = [90, 0, 0]) rect([80, 40]);
    part("panel", at = [200, 0, 0], rotate = [90, 0, 0]) rect([80, 40]);
    slide(by = [0, -50, 0]) {
      part("tray", at = [0, 5, 10]) rect([80, 40]);
      part("tray", at = [200, 5, 10]) rect([80, 40]);
    }
  `);
  const w = r.warnings.filter((s) => s.includes('when the model is opened'));
  assert.equal(w.length, 2, w.join('\n'));
});

test('a placed part with only cut lines, as a living_hinge() alone, says why it is not assembled', () => {
  const lines = render('part("flex", at = [0, 0, 0]) living_hinge([60, 30]);');
  assert.equal(lines.assembly.length, 0);
  assert.ok(
    lines.warnings.some((w) =>
      w.startsWith('Part "flex" has no outline to cut it out, only lines'),
    ),
  );
  // Its outline drawn with it: assembled, the hinge cuts shown on it
  const sheet = render(`
    use <kerf/hinge>
    part("flex", at = [0, 0, 0]) flex_rect([80, 30], [40]);
  `);
  assert.equal(sheet.assembly.length, 1);
  assert.ok(sheet.assembly[0].marks.some((m) => m.lines.length));
  assert.deepEqual(sheet.warnings, []);
  // Not placed, or empty: no such warning
  const quiet = (src) => !render(src).warnings.some((w) => w.includes('no outline to cut it out'));
  assert.ok(quiet('part("flex") living_hinge([60, 30]);'));
  assert.ok(quiet('part("e", at = [0, 0, 0]) union() {}'));
});
