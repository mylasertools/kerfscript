import test from 'node:test';
import assert from 'node:assert/strict';
import { formatError, render } from '../dist/index.js';

const fail = (src, opts) => {
  try {
    render(src, opts);
  } catch (e) {
    return e;
  }
  assert.fail(`no error from ${src}`);
};

test('the source line with the token underlined', () => {
  const src = 'width = 20;\nrect([widht, 10]);';
  assert.equal(
    formatError(fail(src), src),
    [
      'error: Unknown variable "widht". Did you mean "width"?',
      ' --> design.kerf:2:7',
      '  |',
      '2 | rect([widht, 10]);',
      '  |       ^^^^^',
    ].join('\n'),
  );
});

test('tabs before the error keep the marks in line', () => {
  const src = 'module m() {\n\tx = nope;\n}\nm();';
  const lines = formatError(fail(src), src, { file: 'tabs.kerf' }).split('\n');
  assert.equal(lines[1], ' --> tabs.kerf:2:6');
  assert.equal(lines[3], '2 | \tx = nope;');
  assert.equal(lines[4], '  | \t    ^^^^');
});

test('calls the error happened inside, innermost first', () => {
  const src = 'module inner() rect(nope);\nmodule outer() inner();\nouter();';
  const out = formatError(fail(src), src);
  assert.match(
    out,
    /= in module inner\(\), called at design\.kerf:2:16\n {2}= in module outer\(\), called at design\.kerf:3:1$/,
  );
});

test('recursion is one line per call with a count', () => {
  const src = 'function f(n) = f(n + 1);\necho(f(0));';
  const e = fail(src);
  assert.equal(e.line, 1);
  assert.equal(e.col, 17);
  const notes = formatError(e, src)
    .split('\n')
    .filter((l) => l.startsWith('  ='));
  assert.equal(notes.length, 2);
  assert.match(notes[0], /= in f\(\), called at design\.kerf:1:17 \(\d+ times\)/);
  assert.equal(notes[1], '  = in f(), called at design.kerf:2:6');
});

test('a built-in given a bad argument shows what it takes', () => {
  const src = 'rect("big");';
  assert.match(
    formatError(fail(src), src),
    /\n {2}= rect\(size = 1, center = false, r = 0\): A rectangle with its corner at the origin$/,
  );
});

test('errors in libraries show the library line', () => {
  const src = 'use <kerf/box>\nbox([10, "a", 3]);';
  const out = formatError(fail(src), src);
  assert.match(out, / --> <kerf\/box>:\d+:\d+\n/);
  assert.match(out, /finger_rect\(\[w, d\]/);
  assert.match(out, /= in module box\(\), called at design\.kerf:2:1/);
  const lib = 'module tab() rect(nope);';
  const own = 'use <tabs>\ntab();';
  const err = fail(own, { resolve: () => lib });
  assert.match(formatError(err, own, { resolve: () => lib }), /1 \| module tab\(\) rect\(nope\);/);
  assert.match(formatError(err, own), / --> <tabs>:1:19$/m, 'without the source, the location');
});

test('errors without a position and other errors', () => {
  assert.equal(formatError(new Error('disk full'), ''), 'error: disk full');
  const e = fail('rect(1);', { params: { w: {} } });
  assert.equal(formatError(e, 'rect(1);'), `error: ${e.message}`);
});
