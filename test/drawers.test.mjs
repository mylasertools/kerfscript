// kerf/drawers: a carcass of numbered drawers behind a façade

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render } from '../dist/index.js';

const font = { fonts: { A: readFileSync('fonts/AtkinsonHyperlegible-Regular.ttf') } };
const src = (body) => `use <kerf/drawers>\n$thickness = 3;\n${body}`;

test('a grid of drawers fits its carcass without a collision, open or shut', () => {
  for (const open of [0, 0.4]) {
    const r = render(src(`drawers(3, 2, [40, 30], 60, open = ${open});`), font);
    assert.deepEqual(r.warnings, [], `open ${open}`);
    // 5 carcass parts, a shelf and two walls, and 6 drawers of 4 parts
    assert.equal(r.parts.length, 4 + 1 + 1 + 6 * 4);
  }
  assert.deepEqual(render(src('echo(drawers_size(4, 6, [40, 30], 60));')).echoes, [
    '[175, 201, 60]',
  ]);
});

test('drawers numbered in order, from a list or shuffled, and behind a façade', () => {
  const names = (r) =>
    r.parts.filter((p) => / front$/.test(p.name) && p.name.startsWith('drawer')).map((p) => p.name);
  const plain = render(src('drawers(2, 2, [40, 30], 60);'), font);
  assert.deepEqual(names(plain), [
    'drawer 3 front',
    'drawer 4 front',
    'drawer 1 front',
    'drawer 2 front',
  ]);
  const shuffled = render(src('echo(drawers_numbers(24, shuffle = 7));')).echoes[0];
  const ns = JSON.parse(shuffled);
  assert.deepEqual(
    [...ns].sort((a, b) => a - b),
    Array.from({ length: 24 }, (_, i) => i + 1),
  );
  assert.notDeepEqual(
    ns,
    Array.from({ length: 24 }, (_, i) => i + 1),
  );
  const front = render(
    src(
      'drawers(4, 6, [40, 30], 60, shuffle = 7, open = 0.25) polygon([[-10, -5], [185, -5], [185, 200], [87.5, 260], [-10, 200]]);',
    ),
    font,
  );
  assert.deepEqual(front.warnings, []);
  const f = front.parts.find((p) => p.name === 'front');
  assert.deepEqual([f.width, f.height], [195, 265]);
  assert.ok(front.steps.includes('Glue on the front'));
  assert.throws(() => render(src('drawers(2, 2, [10, 10], 40);')), /a cell must be more than/);
});
