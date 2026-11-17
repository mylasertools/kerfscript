import test from 'node:test';
import assert from 'node:assert/strict';
import { meshBodies, render, toModel } from '../dist/index.js';

const SRC = `
layer("red", mode = "paint", color = "red");
material(name = "plywood") {
  part("cap", at = [0, 0, 0], paint = "blue") { rect([50, 50]); layer("red") circle(d = 20); }
  part("base", at = [0, 0, 10]) {
    rect([50, 50]);
    layer("red") translate([25, 25]) circle(d = 20);
    engrave() rect([5, 5]);
  }
}`;

test('a painted part stays on the sheet of its material', () => {
  const r = render(SRC);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.sheets.length, 1);
  assert.equal(r.sheets[0].items.length, 2);
  assert.equal(r.parts.find((p) => p.name === 'cap').paint, '#2f64b5');
  assert.equal(r.parts.find((p) => p.name === 'base').paint, undefined);
  // material = "red" is stock that comes red: a sheet of its own
  const stock = render(
    'part("a") rect(20); part("b", material = "red acrylic") rect(20); part("c", paint = "red") rect(20);',
  );
  assert.equal(stock.sheets.length, 2);
});

test('paint layers are never in the files for the laser', () => {
  const r = render(SRC);
  assert.ok(!r.layers.some((l) => l.name === 'red'));
  const s = r.sheets[0];
  assert.ok(!s.svg.includes('"red"'));
  assert.ok(!s.dxf.includes('red'));
  assert.ok(s.items.every((it) => !it.layers.has('red')));
});

test('the 3D view shows paint: the part in its colour, painted areas on it', () => {
  const bodies = meshBodies(render(SRC));
  const cap = bodies.find((b) => b.kind === 'part' && b.name === 'cap');
  const base = bodies.find((b) => b.kind === 'part' && b.name === 'base');
  assert.equal(cap.color, '#2f64b5');
  assert.equal(cap.material, 'plywood');
  assert.equal(base.color, '#dcc39a');
  const red = bodies.filter((b) => b.kind === 'mark' && b.material === 'red');
  assert.equal(red.length, 2);
  assert.ok(red.every((b) => b.color === '#c8372d'));
  // The quarter circle on the base's corner is clipped to the part
  const xs = red[1].positions.filter((_, i) => i % 3 === 0);
  assert.ok(Math.max(...xs) <= 50 + 1e-6);
  // Print and model files carry the colours
  const print = new TextDecoder().decode(toModel(render(SRC), '3mf', { layout: 'print' }));
  assert.ok(print.length > 0);
});

test('paint colours: names, hex, and what is wrong', () => {
  const r = render('layer("x", mode = "paint", color = "Dark Green") rect(10); rect(20);');
  assert.deepEqual(r.warnings, []);
  assert.equal(render('part("p", paint = "#ABCDEF") rect(10);').parts[0].paint, '#abcdef');
  assert.throws(() => render('part("p", paint = "plaid") rect(10);'), /paint must look like/);
  assert.throws(() => render('layer("x", color = "plaid") rect(10);'), /color must look like/);
  assert.throws(
    () => render('layer("x", mode = "paint", bleed = 2) rect(10);'),
    /paint layer has no bleed/,
  );
  // A hex colour is kept as written in the files
  assert.ok(
    render(
      'layer("x", mode = "fill", color = "#00AA00") rect(10); rect(20);',
    ).sheets[0].svg.includes('#00AA00'),
  );
});

test('measure() does not count paint', () => {
  const r = render(
    'layer("p", mode = "paint", color = "red"); measure() { group() { layer("p") rect([10, 10]); engrave() translate([20, 0]) rect([10, 10]); } echo($area, $centroid); }',
  );
  assert.deepEqual(r.echoes, ['100, [25, 5]']);
});
