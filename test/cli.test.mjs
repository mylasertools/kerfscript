import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kerfscript-'));
const input = join(dir, 'plate.kerf');
writeFileSync(
  input,
  'width = 40; // [10:100]\nlabel = "x";\necho(width, label);\nrect([width, 20]);\n',
);
const run = (...args) =>
  spawnSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8' });

test('renders an SVG next to the input by default', () => {
  const r = run('render', input);
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(dir, 'plate.svg'), 'utf8'), /width="46mm"/);
  assert.match(r.stderr, /ECHO: 40, x/);
});

test('-D sets parameters as KerfScript values', () => {
  const out = join(dir, 'wide.svg');
  const r = run('render', input, '-o', out, '-D', 'width=80', '-Dlabel="oak"');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /ECHO: 80, oak/);
  assert.match(readFileSync(out, 'utf8'), /width="86mm"/);
});

test('--params reads a JSON file', () => {
  const p = join(dir, 'p.json');
  writeFileSync(p, JSON.stringify({ width: 25 }));
  const r = run('check', input, '--params', p);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /part: 25 x 20 mm/);
});

test('writes DXF', () => {
  const out = join(dir, 'plate.dxf');
  assert.equal(run('render', input, '-o', out).status, 0);
  assert.match(readFileSync(out, 'utf8'), /^0\nSECTION/);
});

test('params prints the customizer JSON', () => {
  const r = run('params', input);
  assert.equal(r.status, 0);
  const json = JSON.parse(r.stdout);
  assert.equal(json.parameters[0].name, 'width');
  assert.equal(json.parameters[0].max, 100);
});

test('reports errors with a position and a non-zero exit', () => {
  const bad = join(dir, 'bad.kerf');
  writeFileSync(bad, 'rect(10);\ncircle(4;\n');
  const r = run('render', bad);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^error: Expected "," or "\)", found ";"\n --> .*bad\.kerf:2:9\n/);
  assert.match(r.stderr, /\n2 \| circle\(4;\n {2}\| {9}\^\n/);
});

test('uses libraries next to the file', () => {
  writeFileSync(join(dir, 'tag.kerf'), 'module tag() rect([30, 10], r = 2);\n');
  const main = join(dir, 'main.kerf');
  writeFileSync(main, 'use <tag>\ntag();\n');
  const r = run('check', main);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /30 x 10 mm/);
});

test('check lists each sheet, and a stacked SVG suggests --split', () => {
  const two = join(dir, 'two.kerf');
  writeFileSync(
    two,
    'material(thickness = 3, name = "ply") part("a") rect(50);\nmaterial(thickness = 2, name = "acrylic") part("b", qty = 2) rect(30);\n',
  );
  const check = run('check', two);
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /sheet 1: [\d.]+ x [\d.]+ mm, 3 mm ply, 1 piece/);
  assert.match(check.stdout, /sheet 2: [\d.]+ x [\d.]+ mm, 2 mm acrylic, 2 pieces/);
  const svg = run('render', two);
  assert.match(svg.stderr, /2 sheets are stacked .* --split/);
  assert.doesNotMatch(run('render', input).stderr, /stacked/);
});

test('text() uses the built-in font without --font', () => {
  const sign = join(dir, 'sign.kerf');
  writeFileSync(sign, 'text("Oak", size = 10);\ntext("Ash", size = 10, font = "Atkinson");\n');
  const r = run('render', sign, '-o', join(dir, 'sign.svg'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(dir, 'sign.svg'), 'utf8'), /<path/);
});
