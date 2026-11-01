import test from 'node:test';
import assert from 'node:assert/strict';
import { highlight, highlightLines } from '../dist/highlight.js';

const kinds = (line) =>
  highlightLines(line)[0]
    .filter((t) => t.kind !== 'plain')
    .map((t) => `${t.kind}:${t.text}`);

test('definitions, layers, constants and calls', () => {
  assert.deepEqual(kinds('module lid(w = 2) score() rect([w, PI]);'), [
    'keyword:module',
    'definition:lid',
    'number:2',
    'layer:score',
    'builtin:rect',
    'constant:PI',
  ]);
  assert.deepEqual(kinds('f = function(x) hinge(x);'), ['keyword:function', 'call:hinge']);
});

test('modifiers start a statement, a star after a value multiplies', () => {
  assert.deepEqual(kinds('* circle(5); % rect(2);'), [
    'modifier:*',
    'builtin:circle',
    'number:5',
    'modifier:%',
    'builtin:rect',
    'number:2',
  ]);
  assert.deepEqual(kinds('x = (w - 2) * t;'), ['number:2']);
});

test('customizer comments', () => {
  assert.deepEqual(kinds('/* [Size] */'), ['section:/* [Size] */']);
  assert.deepEqual(kinds('w = 120; // [40:5:400]'), [
    'number:120',
    'comment:// ',
    'control:[40:5:400]',
  ]);
  assert.deepEqual(kinds('w = 120; // [40:5:400] mm'), ['number:120', 'comment:// [40:5:400] mm']);
});

test('library paths and unfinished code', () => {
  assert.deepEqual(kinds('use <kerf/box>'), ['keyword:use', 'string:<kerf/box>']);
  assert.deepEqual(kinds('s = "open'), ['string:"open']);
});

test('HTML spans never cross a line, so the playground can split it', () => {
  const html = highlight('/* one\ntwo */ x = 1;');
  assert.equal(
    html,
    '<span class="t-comment">/* one</span>\n<span class="t-comment">two */</span> x = <span class="t-number">1</span>;',
  );
  for (const line of html.split('\n'))
    assert.equal(line.split('<span').length, line.split('</span>').length);
});

test('escapes HTML', () => {
  assert.equal(highlight('a < b && c > d'), 'a &lt; b &amp;&amp; c &gt; d');
});
