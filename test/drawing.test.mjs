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

test('text(fit = [w, h]) limits the width and the capital height', () => {
  const part = (src) => render(`part("t") ${src}`, font).parts[0];
  const tall = part('text("ANNA", fit = [200, 20]);');
  assert.ok(Math.abs(tall.height - 20) < 0.5, `capitals 20 mm tall, got ${tall.height}`);
  assert.ok(tall.width < 200);
  const wide = part('text("ALEXANDRINA", fit = [60, 20]);');
  assert.ok(Math.abs(wide.width - 60) < 3, `60 mm wide, got ${wide.width}`);
  assert.ok(wide.height < 20);
  assert.ok(part('text("BO", size = 10, fit = [undef, 50]);').height < 11, 'never above size');
  assert.throws(() => render('text("A", fit = [undef, undef]);', font), /fit must be/);
});

test('valign = "cap" centres the capitals on y = 0', () => {
  const r = render('m = text_size("H", 10); echo(m.cap);', font);
  const cap = Number(r.echoes[0]);
  const p = render('part("t") text("H", 10, valign = "cap");', font).parts[0];
  assert.ok(Math.abs(p.height - cap) < 0.05);
  const b = render('measure() { text("H", 10, valign = "cap"); echo($bounds); }', font);
  const [, y0, , y1] = JSON.parse(b.echoes[0]);
  assert.ok(Math.abs(y0 + y1) < 0.05, `centred, got ${y0} to ${y1}`);
});

test('text_size() names its measurements', () => {
  const r = render(
    'm = text_size("Hello", 10); echo(m.width == text_width("Hello", 10), m.bounds == text_metrics("Hello", 10)[1], m.size, m.cap > 0, m.cap < m.ascent);',
    font,
  );
  assert.deepEqual(r.echoes, ['true, true, 10, true, true']);
  const f = render('echo(text_size("ANNA", fit = [200, 20]).cap);', font);
  assert.ok(Math.abs(Number(f.echoes[0]) - 20) < 1e-6);
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

test('point_at carries on straight past repeated end points', () => {
  const r = render(
    'echo(point_at([[0, 0], [10, 0], [10, 0]], 15), point_at([[0, 0], [0, 0], [10, 0]], -5), heading_at([[0, 0], [10, 0], [10, 0]], 12), point_at([[3, 3], [3, 3]], 4));',
  );
  assert.deepEqual(r.echoes, ['[15, 0], [-5, 0], 0, [3, 3]']);
});

test('text(path = ...) lays the text along a path, each letter turned to it', () => {
  // Along a straight path it is the same text, centred on the path
  const line = render('part("t") text("HELLO", 10, path = [[0, 0], [100, 0]]);', font).parts[0];
  const flat = render('part("t") text("HELLO", 10);', font).parts[0];
  assert.ok(Math.abs(line.width - flat.width) < 0.01, `${line.width} vs ${flat.width}`);
  assert.ok(Math.abs(line.height - flat.height) < 0.01);
  // Up a vertical path the text stands on its side
  const up = render('part("t") text("HELLO", 10, path = [[0, 0], [0, 100]]);', font).parts[0];
  assert.ok(Math.abs(up.height - flat.width) < 0.01 && Math.abs(up.width - flat.height) < 0.01);
  const long = render('text("HELLO WORLD", 10, path = [[0, 0], [20, 0]]);', font);
  assert.match(long.warnings[0], /mm longer than its path allows/);
  assert.throws(() => render('text("A", path = [[0, 0]]);', font), /at least two points/);
});

test('text(arc = r) goes over the top of a circle, or along the bottom', () => {
  const b = (src) => JSON.parse(render(`measure() { ${src}; echo($bounds); }`, font).echoes[0]);
  // Over the top, standing on the circle; along the bottom, hanging inside it
  const [x0, y0, x1, y1] = b('text("TOP", 10, arc = 40)');
  assert.ok(y0 > 38 && y1 < 52 && Math.abs(x0 + x1) < 1, `${[x0, y0, x1, y1]}`);
  const [u0, v0, u1, v1] = b('text("BOTTOM", 10, arc = -40)');
  assert.ok(v0 > -41 && v1 < -28 && Math.abs(u0 + u1) < 1, `${[u0, v0, u1, v1]}`);
  assert.throws(() => render('text("A", arc = 0);', font), /arc must be a radius/);
  assert.throws(
    () => render('text("A", arc = 10, path = [[0, 0], [1, 0]]);', font),
    /path or arc, not both/,
  );
});

test('text(lines = 2) with fit breaks a long name when two lines let it be bigger', () => {
  const part = (src) => render(`part("t") ${src}`, font).parts[0];
  const one = part('text("Anna-Maria Schmidt", fit = [60, 30]);');
  const two = part('text("Anna-Maria Schmidt", fit = [60, 30], lines = 2);');
  assert.ok(two.height > 3 * one.height, `${two.height} vs ${one.height}`);
  assert.ok(two.width <= 60 + 1e-6 && two.height <= 30 + 1);
  // A short name stays on one line, as big as without lines
  const bo = part('text("BO", fit = [60, 30], lines = 2);');
  assert.ok(Math.abs(bo.height - part('text("BO", fit = [60, 30]);').height) < 0.01);
  // A newline always breaks; three lines without fit are as even as they go
  const nl = part('text("Happy\\nEaster", 10);');
  assert.ok(nl.height > 15 && nl.width < part('text("Happy Easter", 10);').width);
  const three = render(
    'measure() { text("one two three four five six", 10, lines = 3); echo($bounds); }',
    font,
  ).echoes[0];
  assert.ok(JSON.parse(three)[1] < -20, three);
  assert.throws(() => render('text("A", lines = 0);', font), /lines must be from 1 to 20/);
  assert.throws(
    () => render('text("A B", lines = 2, arc = 20);', font),
    /in a block, or along a path/,
  );
});

test('text(weld = true) welds a name into one piece, with an underline joining words', () => {
  const part = (src) => render(`part("n") ${src}`, font);
  const plain = part('text("Emma", 20);');
  const welded = part('text("Emma", 20, weld = true);');
  assert.ok(plain.parts[0].pieces > 1);
  assert.equal(welded.parts[0].pieces, 1);
  // No loose piece; a font thinner than $min_width says so for itself
  assert.deepEqual(
    welded.warnings.filter((w) => !/narrower than/.test(w)),
    [],
  );
  assert.ok(welded.parts[0].width < plain.parts[0].width);
  // Two words join only with an underline
  assert.equal(part('text("Emma Rose", 20, weld = true, underline = 3);').parts[0].pieces, 1);
  // Accents above a letter stay loose and say so
  const zoe = part('text("Zoë", 30, weld = true);');
  assert.match(zoe.warnings[0], /still has 2 loose pieces \(in "ë", in "ë"\)/);
  assert.throws(() => render('text("A", 10, underline = 2);', font), /underline goes with weld/);
  assert.throws(() => render('text("A B", 10, weld = true, lines = 2);', font), /one line of text/);
});
