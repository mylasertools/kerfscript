import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { format, parse, render, tokenize } from '../dist/index.js';

const fmt = (src) => format(src.replace(/^\n/, ''));
const same = (src) => assert.equal(fmt(src), src.replace(/^\n/, ''));

test('spaces between tokens', () => {
  assert.equal(
    fmt('x=1+2*-3;y=[1,2][0];f=function(a)a*2;z=a?b:c;r=[0:2:10];'),
    'x = 1 + 2 * -3; y = [1, 2][0]; f = function(a) a * 2; z = a ? b : c; r = [0:2:10];\n',
  );
  assert.equal(fmt('echo(!a&&b, - x, p.x, "s"[0]);'), 'echo(!a && b, -x, p.x, "s"[0]);\n');
  assert.equal(
    fmt('l=[ for(i=[0:3])let(s=i*i)if(s>1)[s,i] ];'),
    'l = [for (i = [0:3]) let (s = i * i) if (s > 1) [s, i]];\n',
  );
  assert.equal(fmt('r=[a?1:2:5];t=[x?[0:1]:y];'), 'r = [a ? 1 : 2:5]; t = [x ? [0:1] : y];\n');
});

test('modifiers and operators that look alike', () => {
  assert.equal(
    fmt('# rect(1);* circle(2);if(x)% rect(3);'),
    '#rect(1); *circle(2); if (x) %rect(3);\n',
  );
  assert.equal(fmt('a=(b)*c(d);b=e%f;'), 'a = (b) * c(d); b = e % f;\n');
  assert.equal(fmt('use<kerf/box>\nbox([1,2,3]);'), 'use <kerf/box>\nbox([1, 2, 3]);\n');
});

test('indentation of blocks, chains and continued lines', () => {
  same(`
module panel(w, h = 10) {
  difference() {
    rect([w, h]);
    for (x = [5:10:w - 5])
      translate([x, h / 2])
        circle(d = 3);
  }
}
`);
  same(`
width = 10 +
  20;
points = [
  [0, 0],
  [10, 0],
];
total = sum([for (p = points)
  let (x = p[0])
    x]);
`);
  assert.equal(fmt('module m(){\nrect(1);\n    }'), 'module m() {\n  rect(1);\n}\n');
  assert.equal(fmt('x = f(a,\n          b);'), 'x = f(a,\n  b);\n');
});

test('comments and customizer annotations stay where they are', () => {
  same(`
/* [Size] */
// Outer width
width = 120; // [40:5:400]
shape = "round"; // [round:Round, square:Square]

/* A block comment
     keeps its own layout */
module m() {
  // before the end
}
echo(1 + /* inline */ 2);
`);
  assert.equal(fmt('x = 1;   // trailing   \n'), 'x = 1; // trailing\n');
});

test('blank lines, trailing spaces and line endings', () => {
  assert.equal(fmt('\n\nx = 1;  \r\n\r\n\r\n\r\ny = 2;\n\n\n'), 'x = 1;\n\ny = 2;\n');
  assert.equal(fmt(''), '');
});

test('a program that does not parse is not formatted', () => {
  assert.throws(() => format('rect(10'), /Expected "," or "\)"/);
});

// Every .kerf file in the repository: formatting keeps the tokens and
// comments, renders the same, and a second pass changes nothing
const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory()
      ? d.name === 'node_modules'
        ? []
        : files(join(dir, d.name))
      : d.name.endsWith('.kerf')
        ? [join(dir, d.name)]
        : [],
  );

test('every .kerf file formats safely and only once', () => {
  const font = readFileSync('fonts/AtkinsonHyperlegible-Regular.ttf');
  let n = 0;
  for (const file of ['examples', 'lib', 'integrations', 'conformance'].flatMap(files)) {
    const src = readFileSync(file, 'utf8');
    try {
      parse(src);
    } catch {
      continue; // conformance cases that test syntax errors
    }
    const out = format(src);
    assert.equal(format(out), out, `${file}: a second pass changes it`);
    const values = (s) => tokenize(s).tokens.map((t) => `${t.type}:${t.value}`);
    assert.deepEqual(values(out), values(src), file);
    assert.deepEqual(
      tokenize(out).comments.map((c) => c.text),
      tokenize(src).comments.map((c) => c.text),
      file,
    );
    if (file.startsWith('examples')) {
      const opts = { fonts: { atkinson: font } };
      assert.equal(render(out, opts).svg, render(src, opts).svg, `${file}: renders differently`);
    }
    n++;
  }
  assert.ok(n > 150, `${n} files`);
});

test('the examples, libraries and integrations are formatted', () => {
  const unformatted = ['examples', 'lib', 'integrations'].flatMap(files).filter((f) => {
    const src = readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    return format(src) !== src;
  });
  assert.deepEqual(unformatted, [], 'run node dist/cli.js fmt examples lib integrations');
});

test('kerf fmt rewrites files, and --check lists the ones that need it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerfscript-fmt-'));
  writeFileSync(join(dir, 'a.kerf'), 'x=1;\n');
  writeFileSync(join(dir, 'b.kerf'), 'y = 2;\n');
  const kerf = (...args) =>
    spawnSync(process.execPath, ['dist/cli.js', 'fmt', ...args], { encoding: 'utf8' });
  const check = kerf('--check', dir);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /a\.kerf/);
  assert.doesNotMatch(check.stdout, /b\.kerf/);
  assert.equal(kerf(dir).status, 0);
  assert.equal(readFileSync(join(dir, 'a.kerf'), 'utf8'), 'x = 1;\n');
  assert.equal(kerf('--check', dir).status, 0);
  const stdin = spawnSync(process.execPath, ['dist/cli.js', 'fmt', '-'], {
    input: 'z=3;',
    encoding: 'utf8',
  });
  assert.equal(stdin.stdout, 'z = 3;\n');
});
