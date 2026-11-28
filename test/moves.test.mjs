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

test('library drawers slide out and library lids lift off when opened', () => {
  const drawers = render('use <kerf/drawers>\ndrawers(2, 1, open = 0.2, numbers = false);');
  const floor = drawers.assembly.find((p) => p.name === 'drawer 1 floor');
  assert.equal(floor.moves.length, 1);
  assert.ok(floor.moves[0].slide[1] < 0 && floor.moves[0].slide[0] === 0);
  assert.equal(drawers.assembly.find((p) => p.name === 'carcass floor').moves, undefined);
  for (const src of [
    'use <kerf/enclosure>\nenclosure([120, 80, 50]);',
    'use <kerf/hinge>\nflex_box([100, 70, 50]);',
  ]) {
    const r = render(src);
    assert.ok(r.assembly.find((p) => p.name === 'lid').moves[0].slide[2] > 0);
    assert.equal(r.assembly.find((p) => p.name === 'bottom').moves, undefined);
    assert.deepEqual(
      r.warnings.filter((w) => w.includes('opened')),
      [],
    );
  }
});

test('nested moves happen one after another, the inner first', async () => {
  const { moveMatrix } = await import('../dist/index.js');
  const r = render(`
    slide([0, 0, 20]) slide([0, 15, 0]) part("hook", at = [0, 10, 6]) rect([40, 20]);
  `);
  const [forward, up] = r.assembly[0].moves;
  assert.deepEqual(forward.span, [0, 0.5]);
  assert.deepEqual(up.span, [0.5, 1]);
  const at = (t) => {
    const m = moveMatrix(r.assembly[0].moves, t);
    return [m[3], m[7], m[11]];
  };
  assert.ok(close(at(0.25), [0, 7.5, 0]));
  assert.ok(close(at(0.5), [0, 15, 0]));
  assert.ok(close(at(0.75), [0, 15, 10]));
  assert.ok(close(at(1), [0, 15, 20]));
});

test('a drawer and the flap hinged on it keep together, the flap turning first', () => {
  const r = render(`
    slide([0, -50, 0]) {
      part("drawer", at = [0, 0, 0]) rect([60, 40]);
      hinge([0, 0, 3], [60, 0, 3], 90) part("flap", at = [0, -20, 3]) rect([60, 20]);
    }
  `);
  const drawer = r.assembly.find((p) => p.name === 'drawer').moves;
  const flap = r.assembly.find((p) => p.name === 'flap').moves;
  assert.deepEqual(flap[0].span, [0, 0.5]);
  // The same slide, at the same time, for both
  assert.deepEqual(drawer, [flap[1]]);
  assert.deepEqual(drawer[0].span, [0.5, 1]);
});

test('moves that are not nested, or round nothing that moves, open all along', () => {
  const r = render(`
    slide([0, 0, 10]) part("a", at = [0, 0, 0]) rect([10, 10]);
    slide([0, 0, 10]) { if (false) slide([5, 0, 0]) part("x", at = [0, 0, 0]) rect([5, 5]); part("b", at = [50, 0, 0]) rect([10, 10]); }
  `);
  for (const p of r.assembly) assert.equal(p.moves[0].span, undefined);
});

test('a hook under a ledge opens when it slides out before lifting, and not when it only lifts', () => {
  const model = (moves) => `
    part("ledge", at = [0, 0, 10]) rect([40, 20]);
    ${moves} part("hook", at = [0, 10, 6]) rect([40, 20]);
  `;
  const runInto = (src) =>
    render(src).warnings.filter((w) => w.includes('when the model is opened'));
  assert.equal(runInto(model('slide([0, 0, 20])')).length, 1);
  assert.deepEqual(runInto(model('slide([0, 0, 20]) slide([0, 15, 0])')), []);
});

const cabinet = (door, drawer) => `
  hinge([0, -3, 0], [0, -3, 1], -95${door}) part("door", at = [0, 0, 0], rotate = [90, 0, 0]) rect([60, 30]);
  slide([0, -50, 0]${drawer}) part("drawer", at = [5, 2, 10]) rect([50, 40]);
`;
const opened = (r) => r.warnings.filter((w) => w.includes('when the model is opened'));

test('stages put moves that are not nested in order: the door opens, then the drawer comes out', () => {
  const together = render(cabinet('', ''));
  assert.equal(opened(together).length, 1, together.warnings.join('\n'));
  const staged = render(cabinet(', stage = 1', ', stage = 2'));
  assert.deepEqual(opened(staged), []);
  assert.deepEqual(staged.stages, ['1', '2']);
  const door = staged.assembly.find((p) => p.name === 'door').moves[0];
  const drawer = staged.assembly.find((p) => p.name === 'drawer').moves[0];
  assert.deepEqual(door.span, [0, 0.5]);
  assert.deepEqual(drawer.span, [0.5, 1]);
});

test('stages are numbers in order, then names in the order they first run', () => {
  const r = render(`
    slide([0, 0, 5], stage = "Lift") part("a", at = [0, 0, 0]) rect([5, 5]);
    slide([0, 0, 5], stage = 10) part("b", at = [10, 0, 0]) rect([5, 5]);
    slide([0, 0, 5], stage = "Unlock") part("c", at = [20, 0, 0]) rect([5, 5]);
    slide([0, 0, 5], stage = 2) part("d", at = [30, 0, 0]) rect([5, 5]);
    slide([0, 0, 5], stage = "Lift") part("e", at = [40, 0, 0]) rect([5, 5]);
  `);
  assert.deepEqual(r.stages, ['2', '10', 'Lift', 'Unlock']);
  const span = (n) => r.assembly.find((p) => p.name === n).moves[0].span;
  assert.deepEqual(span('d'), [0, 0.25]);
  assert.deepEqual(span('b'), [0.25, 0.5]);
  assert.deepEqual(span('a'), [0.5, 0.75]);
  assert.deepEqual(span('e'), [0.5, 0.75]);
  assert.deepEqual(span('c'), [0.75, 1]);
});

test('a move with no stage inside a staged one shares its stage, the inner first', () => {
  const r = render(`
    slide([0, 0, 5], stage = 1) part("first", at = [50, 0, 0]) rect([5, 5]);
    slide([0, 0, 20], stage = 2) slide([0, 10, 0]) part("lid", at = [0, 0, 0]) rect([5, 5]);
  `);
  const [forward, up] = r.assembly.find((p) => p.name === 'lid').moves;
  assert.deepEqual(forward.span, [0.5, 0.75]);
  assert.deepEqual(up.span, [0.75, 1]);
});

test('parts of one mechanism in separate blocks keep time when they share a stage', () => {
  const r = render(`
    slide([0, 0, 20], stage = "Lift") slide([0, 5, 0], stage = "Slide") part("lid", at = [0, 0, 0]) rect([40, 40]);
    slide([0, 0, 20], stage = "Lift") part("handle", at = [10, 10, 3]) rect([10, 5]);
    slide([0, 0, 20], stage = "Lift") slide([0, 5, 0], stage = "Slide") part("insert", at = [5, 5, -3]) rect([30, 30]);
  `);
  const lift = (n) => r.assembly.find((p) => p.name === n).moves.at(-1).span;
  assert.deepEqual(lift('lid'), lift('handle'));
  assert.deepEqual(lift('lid'), lift('insert'));
  // Slide is inside Lift, so it comes first
  assert.deepEqual(r.stages, ['Slide', 'Lift']);
});

test('a stage must be a number or a name', () => {
  assert.throws(
    () => render('slide([0, 0, 5], stage = [1]) part("a", at = [0, 0, 0]) rect([5, 5]);'),
    /stage must be a number or a name/,
  );
  assert.throws(
    () => render('hinge([0, 0, 0], [1, 0, 0], stage = "") part("a", at = [0, 0, 0]) rect([5, 5]);'),
    /stage must be a number or a name/,
  );
});

test('opening warnings say which stage they happen in', () => {
  const r = render(cabinet(', stage = "Open the door"', ', stage = "Open the door"'));
  assert.match(
    opened(r)[0],
    /when the model is opened, in "Open the door", stage 1 of 1, about \d+% through it/,
  );
  const n = render(cabinet(', stage = 1', ', stage = 1'));
  assert.match(opened(n)[0], /in stage 1 of 1, about \d+% through it/);
});

test('without stages, the model has none', () => {
  assert.deepEqual(render('slide([0, 0, 5]) part("a", at = [0, 0, 0]) rect([5, 5]);').stages, []);
  assert.deepEqual(render('part("a", at = [0, 0, 0]) rect([5, 5]);').stages, []);
});

test('a stage named inside another comes before it', () => {
  const r = render(`
    slide([0, 0, 20], stage = "Lift") slide([0, -3, 0], stage = "Slide")
      slide([0, 10, 0], stage = "Unlock") part("fence", at = [0, 0, 0]) rect([5, 5]);
    slide([0, 0, 20], stage = "Lift") slide([0, -3, 0], stage = "Slide") part("lid", at = [10, 0, 0]) rect([5, 5]);
  `);
  assert.deepEqual(r.stages, ['Unlock', 'Slide', 'Lift']);
  const [unlock, slide, lift] = r.assembly.find((p) => p.name === 'fence').moves;
  assert.deepEqual(
    [unlock.span, slide.span, lift.span],
    [
      [0, 1 / 3],
      [1 / 3, 2 / 3],
      [2 / 3, 1],
    ],
  );
});
