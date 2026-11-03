// The drawing additions of language 0.3: spline, hatch, text fit, close,
// path close, line layers over fills, use beside a library.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render } from '../dist/index.js';

const font = {
  fonts: { A: readFileSync('fonts/AtkinsonHyperlegible-Regular.ttf') },
  defaultFont: 'A',
};
const layer = (r, name) =>
  r.sheets[0].items.flatMap(
    (i) =>
      i.layers.get(name)?.[
        r.layers.find((l) => l.name === name)?.mode === 'line' ? 'lines' : 'regions'
      ] ?? [],
  );

test('spline goes through its points smoothly', () => {
  const r = render(
    'echo(spline_points([[0, 0], [10, 10], [20, 0]], 4)[4], len(spline_points([[0, 0], [10, 10], [20, 0]], 4)));',
  );
  assert.deepEqual(r.echoes, ['[10, 10], 9']);
  const a = render('part("s") spline([[0, 0], [30, 20], [60, 0]], width = 4);');
  assert.equal(a.parts[0].pieces, 1);
  assert.ok(a.parts[0].width > 60);
});

test('hatch draws lines across an area at an angle, or stripes', () => {
  const r = render('part("h") { rect([40, 40]); score() hatch(0, 10) rect([40, 40]); }');
  assert.equal(layer(r, 'score').length, 3, 'y = 10, 20, 30; the edges are left out');
  const s = render('part("h") { rect([40, 40]); engrave() hatch(90, 10, 4) rect([40, 40]); }');
  assert.ok(layer(s, 'engrave').length >= 4);
});

test('text(fit) shrinks text to a width, never above its size', () => {
  const w = (src) => render(`part("t") ${src}`, font).parts[0].width;
  assert.ok(Math.abs(w('text("HELLO WORLD", fit = 50);') - 50) < 3);
  assert.ok(w('text("HI", size = 5, fit = 200);') < 20);
});

test('close() joins shapes a hair apart, path(close) closes open subpaths', () => {
  assert.equal(
    render('close(0.5) { rect(10); translate([10.4, 0]) rect(10); }').parts[0].pieces,
    1,
  );
  assert.equal(render('path("M0 0 L10 0 L5 8", close = true);').parts[0].pieces, 1);
});

test('a line layer goes after every fill layer in the files', () => {
  const r = render(
    'layer("lines", mode = "line"); layer("fill", mode = "fill"); part("p") { rect(20); layer("lines") line([0, 0], [20, 20]); layer("fill") rect(5); }',
  );
  const names = r.layers.map((l) => l.name);
  assert.ok(names.indexOf('fill') < names.indexOf('lines'), names.join(' '));
  const o = render(
    'layer("top", mode = "fill", order = 5); layer("lines", mode = "line"); part("p") { rect(20); layer("top") rect(5); layer("lines") line([0, 0], [9, 9]); }',
  );
  const n2 = o.layers.map((l) => l.name);
  assert.ok(n2.indexOf('top') > n2.indexOf('lines'), n2.join(' '));
});

test('a library finds the files beside it first', () => {
  const files = {
    'lib/a.kerf': 'use <b>\nfunction a() = b() * 2;',
    'lib/b.kerf': 'function b() = 21;',
    'b.kerf': 'function b() = 1;',
  };
  const r = render('use <lib/a>\necho(a());', { resolve: (p) => files[p] ?? files[p + '.kerf'] });
  assert.deepEqual(r.echoes, ['42']);
});

test('warnings say where a stray piece and a too-narrow hole are', () => {
  const r = render(
    '$kerf = 0.3; part("p") { difference() { rect([40, 20]); translate([10, 10]) rect([0.2, 5]); } translate([50, 0]) rect(4); }',
  );
  assert.match(
    r.warnings.find((w) => /separate pieces/.test(w)),
    /at \[50, 0\] to \[54, 4\]/,
  );
  assert.match(
    r.warnings.find((w) => /narrower than/.test(w)),
    /at \[10.1, 12.5\]/,
  );
});
