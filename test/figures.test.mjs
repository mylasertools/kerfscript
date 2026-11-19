// kerf/figures: layered characters, each a backer with coloured pieces
// and details on it

import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../dist/index.js';

const names = (cast) =>
  render(`use <kerf/figures>\necho(figure_names(${cast ? `"${cast}"` : ''}));`)
    .echoes[0].slice(1, -1)
    .split(', ')
    .map((s) => s.slice(1, -1));

test('every figure builds in layers without a warning, its backer one piece', () => {
  const all = names();
  assert.equal(all.length, 31);
  for (const height of [60, 120])
    for (const n of all) {
      const r = render(`use <kerf/figures>\nfigure_parts("${n}", ${height});`);
      assert.deepEqual(r.warnings, [], `${n} at ${height} mm`);
      const outline = r.parts.find((p) => p.name === `${n} outline`);
      assert.equal(outline.pieces, 1, n);
      assert.ok(Math.abs(outline.height - height) < 0.05, `${n}: ${outline.height}`);
      // Every part is painted, and none is bigger than the backer
      for (const p of r.parts) {
        assert.ok(p.paint, p.name);
        assert.ok(p.width <= outline.width + 1e-6 && p.height <= outline.height + 1e-6, p.name);
      }
    }
});

test('the Easter cast and its layers', () => {
  assert.deepEqual(names('easter'), ['bunny', 'chick', 'lamb']);
  const r = render('use <kerf/figures>\necho(figure_layers("chick"));');
  assert.deepEqual(r.echoes, [
    '[["outline", "dark brown"], ["clothes", "yellow"], ["face", "orange"], ["face", "white"], ["details", "black"], ["details", "pink"]]',
  ]);
  assert.throws(
    () => render('use <kerf/figures>\nfigure_parts("unicorn");'),
    /Unknown figure "unicorn"/,
  );
  assert.throws(() => render('use <kerf/figures>\necho(figure_names("summer"));'), /Unknown cast/);
});

test('layers glue on the backer, details on the pieces, all in the print layout', () => {
  const r = render(
    'use <kerf/figures>\n$thickness = 3;\nfigure_parts("lamb", 80, at = [0, 0, 0]);',
  );
  const z = (name) => r.assembly.find((p) => p.name === name).matrix[11];
  assert.equal(z('lamb outline'), 0);
  assert.equal(z('lamb clothes cream'), 3);
  assert.equal(z('lamb face skin'), 3);
  assert.equal(z('lamb details black'), 6);
  const outline = r.assembly.findIndex((p) => p.name === 'lamb outline');
  assert.ok(
    r.assembly.every((p, i) => i === outline || p.glued !== undefined),
    'all glued',
  );
  // One wood: every part on the same sheets
  assert.ok(r.sheets.every((s) => s.material === r.sheets[0].material));
});

test('figure() cuts a figure from one sheet, its pieces scored and details engraved', () => {
  const r = render('use <kerf/figures>\npart("santa") figure("santa", 90);');
  assert.deepEqual(r.warnings, []);
  const [it] = r.sheets[0].items;
  assert.ok(it.layers.get('score').lines.length > 5);
  assert.ok(it.layers.get('engrave').regions.length >= 5);
  assert.ok(Math.abs(r.parts[0].height - 90) < 0.05);
});
