// kerf/sphere: slot-together balls and domes

import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../dist/index.js';

const src = (body) => `use <kerf/sphere>\nuse <kerf/scene>\n$thickness = 3;\n${body}`;

test('balls and domes slot together without a collision', () => {
  for (const body of [
    'ball(80);',
    'ball(100, fins = 8, rings = 3);',
    'ball(100, fins = 6, rings = 2, dome = true);',
  ]) {
    const r = render(src(body));
    assert.deepEqual(r.warnings, [], body);
  }
  const r = render(src('ball(80, fins = 6);'));
  assert.deepEqual(
    r.parts.map((p) => [p.name, p.qty]),
    [
      ['ball fin', 6],
      ['ball ring 1', 1],
    ],
  );
  // The fins and the ring are slotted where they cross
  const ring = r.sheets.flatMap((s) => s.items).find((it) => it.part === 'ball ring 1');
  const points = ring.layers.get('cut').regions.reduce((n, p) => n + p.length, 0);
  const plain = render(
    src('part("r") difference() { circle(r = 40, $fn = 120); circle(r = 32, $fn = 120); }'),
  );
  const plainPoints = plain.sheets[0].items[0].layers
    .get('cut')
    .regions.reduce((n, p) => n + p.length, 0);
  assert.ok(points > plainPoints, `${points} vs ${plainPoints}`);
  assert.ok(r.hardware.some((h) => h.kind === 'ribbon'));
  assert.deepEqual(render(src('echo(ball_rings(100, 3));')).echoes[0].split(', ').length, 3);
});

test('a hollow ball with a floor takes a standee in its rail', () => {
  const r = render(
    src(
      'ball(140, fins = 6, hollow = 50, floor = true, at = [0, 0, 70]);\nscene_figure("snowman", 34, at = [0, 0, 71.5]);',
    ),
  );
  assert.deepEqual(r.warnings, []);
});
