// Line art as pen plotters draw it: noise(), flow(), contours(), occlude()
// with hide(), and $join_lines.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render as run } from '../dist/index.js';

// Parts at the sheet's corner, in their own coordinates
const render = (src, opts) => run(`$gap = 0; ${src}`, opts);

const lines = (r, name = 'score') =>
  r.sheets[0].items.flatMap((i) => i.layers.get(name)?.lines ?? []);
const echo = (src) => render(src).echoes;

test('LANGUAGE.md plotting examples run', () => {
  const doc = readFileSync('LANGUAGE.md', 'utf8');
  const section = doc.slice(doc.indexOf('### Plotting'), doc.indexOf('## Built-in functions'));
  const blocks = [...section.matchAll(/```kerf\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.equal(blocks.length, 3);
  for (const src of blocks) assert.ok(lines(render(src)).length > 3, src);
});

test('noise is smooth, about -1 to 1, 0 at whole numbers, and seeded', () => {
  assert.deepEqual(echo('echo(noise(0), noise(3, 4), noise([2, 5, 1]));'), ['0, 0, 0']);
  const [a, b, c, d] = echo(
    'echo(noise(0.3, 0.7), noise(0.301, 0.7), noise(0.3, 0.7, seed = 2), noise([0.3, 0.7]));',
  )[0]
    .split(', ')
    .map(Number);
  assert.ok(Math.abs(a - b) < 0.01, 'nearby points have nearby values');
  assert.notEqual(a, c, 'another seed gives another pattern');
  assert.equal(a, d, 'a point is the same as x and y');
  const vs = render('echo([for (i = [0:400]) noise(i * 0.37, i * 0.11, octaves = 4)]);')
    .echoes[0].slice(1, -1)
    .split(', ')
    .map(Number);
  assert.ok(Math.max(...vs.map(Math.abs)) <= 1);
  assert.ok(Math.max(...vs) > 0.2 && Math.min(...vs) < -0.2, 'it varies');
  assert.throws(() => render('echo(noise(1, octaves = 9));'), /octaves/);
});

test('flow fills an area with lines that keep their distance', () => {
  const r = render(
    'part("p") { rect([60, 40]); score() flow(function(p) 90 * noise(p / 20), spacing = 3) translate([5, 5]) rect([50, 30]); }',
  );
  const ls = lines(r);
  assert.ok(ls.length > 5);
  for (const l of ls)
    for (const [x, y] of l) assert.ok(x > 4.99 && x < 55.01 && y > 4.99 && y < 35.01, `${x}, ${y}`);
  // Points of different lines are never closer than half the spacing, less a step
  const pts = ls.flatMap((l, i) => l.map((p) => [...p, i]));
  let least = Infinity;
  for (let a = 0; a < pts.length; a += 3)
    for (let b = 0; b < pts.length; b++)
      if (pts[a][2] !== pts[b][2])
        least = Math.min(least, Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]));
  assert.ok(least > 1.5 - 0.75, `closest ${least}`);
});

test('flow with one angle draws straight lines, and stops where the field is undef', () => {
  const ls = lines(
    render('part("p") { rect([40, 40]); score() flow(0, spacing = 4) rect([40, 40]); }'),
  );
  assert.ok(ls.length >= 8);
  for (const l of ls)
    assert.ok(
      l.every((p) => Math.abs(p[1] - l[0][1]) < 1e-6),
      'horizontal',
    );
  const half = lines(
    render(
      'part("p") { rect([40, 40]); score() flow(function(p) p[0] < 20 ? 0 : undef, spacing = 4) rect([40, 40]); }',
    ),
  );
  for (const l of half) for (const p of l) assert.ok(p[0] < 21, `${p[0]}`);
  assert.throws(
    () => render('part("p") score() flow(function(p) "up") rect(10);'),
    /angle, a vector/,
  );
});

test('contours draw a circle round a peak', () => {
  const r = render(
    'part("p") { rect([40, 40], center = true); score() contours(function(p) 10 - norm(p), levels = [5], cell = 0.5) rect([40, 40], center = true); }',
  );
  const ls = lines(r);
  assert.equal(ls.length, 1);
  const l = ls[0];
  assert.deepEqual(l[0], l[l.length - 1], 'closed');
  for (const p of l) assert.ok(Math.abs(Math.hypot(p[0] - 20, p[1] - 20) - 5) < 0.05);
  const by = (src) =>
    lines(
      render(
        `part("p") { rect([40, 40], center = true); score() ${src} rect([40, 40], center = true); }`,
      ),
    ).length;
  assert.equal(
    by('contours(function(p) max(0, 10 - norm(p)), interval = 2)'),
    4,
    'levels 2, 4, 6 and 8; 10 is only the peak',
  );
  assert.ok(by('contours(function(p) p[0] > 0 ? 10 - norm(p) : undef, levels = [5])') >= 1);
});

test('occlude hides lines behind later areas, and hide() is not drawn', () => {
  const r = render(`part("p") {
    rect([60, 40]);
    occlude() {
      score() line([0, 20], [60, 20]);
      score() translate([30, 20]) circle(d = 20);
    }
  }`);
  const ls = lines(r);
  const straight = ls.filter((l) => l.length === 2);
  assert.equal(straight.length, 2, 'the line is cut where the circle covers it');
  for (const l of straight) for (const p of l) assert.ok(p[0] <= 20.01 || p[0] >= 39.99);
  const ridges = lines(
    render(`part("p") {
      rect([60, 40]);
      occlude() for (k = [1, 0]) {
        score() line([0, 10 + k * 5], [60, 10 + k * 5]);
        hide() translate([20, 0]) rect([20, 10 + k * 5 + 8]);
      }
    }`),
  );
  // The front line (k = 0) is whole; its hidden area cuts the back one
  assert.equal(ridges.length, 3);
  assert.ok(
    ridges.every((l) => l.length === 2),
    'no outline of hide() drawn',
  );
  assert.match(render('part("p") { rect(10); hide() rect(5); }').warnings.join(), /inside occlude/);
});

test('$join_lines joins lines end to end and takes them nearest first', () => {
  const src = (j) =>
    `$join_lines = ${j}; part("p") { rect(60); score() { for (i = [0:9]) line([i * 5, 10], [i * 5 + 5, 10]); line([0, 50], [50, 50]); line([0, 30], [50, 30]); } }`;
  assert.equal(lines(render(src(false))).length, 12);
  const ls = lines(render(src(true)));
  assert.equal(ls.length, 3);
  // Each starts at the end nearer where the last one ended
  for (let i = 1; i < ls.length; i++) {
    const e = ls[i - 1].at(-1),
      a = ls[i][0],
      b = ls[i].at(-1);
    assert.ok(Math.hypot(a[0] - e[0], a[1] - e[1]) <= Math.hypot(b[0] - e[0], b[1] - e[1]) + 1e-9);
  }
});

test('contours stop at the limits, whatever the heights', () => {
  // A height too large for its interval's steps to count
  assert.throws(
    () => render('contours(function(p) 1e16, interval = 1) rect(1);', { maxSteps: 1000 }),
    /too large/,
  );
  assert.doesNotThrow(() => render('contours(function(p) 1e15, interval = 1) rect(1);'));
  // Many levels: stopped as the points pass the limit, not after
  assert.throws(
    () =>
      render('contours(function(p) p[0] % 2, levels = 10000) rect(20);', {
        maxSteps: 100_000,
        limits: { maxPoints: 1000 },
      }),
    /more than 1000 points|steps/,
  );
});

test('what a field echoes stays counted towards the limit', () => {
  const s = 'x'.repeat(100);
  assert.throws(
    () =>
      render(
        `s = "${s}"; contours(function(p) let (e = echo(str(s, p))) p[0], levels = [5]) rect(20);`,
        { limits: { maxListItems: 1000 } },
      ),
    /items in all/,
  );
});

test('hide() stays hidden inside score() and other layer wrappers', () => {
  const r = render(`part("p") {
    rect([30, 20]);
    occlude() {
      score() line([0, 10], [30, 10]);
      score() hide() translate([10, 5]) rect(10);
    }
  }`);
  const ls = lines(r);
  assert.equal(ls.length, 2, 'the line, cut in two; no outline of the hidden square');
  assert.ok(ls.every((l) => l.length === 2));
});
