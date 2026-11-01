import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  analyze,
  complete,
  definition,
  hover,
  outline,
  problems,
  references,
  rename,
  signatureHelp,
} from '../dist/language.js';

// The standard library's paths, as completion lists them
const STDLIB = readdirSync('lib/kerf')
  .filter((f) => f.endsWith('.kerf'))
  .map((f) => `kerf/${f.slice(0, -5)}`)
  .sort();

// The offset of the nth match of text that is not part of a longer name,
// plus some characters
const at = (src, text, n = 0, plus = 0) => {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = /[\w$]$/.test(text) ? '(?![\\w$])' : '';
  const all = [...src.matchAll(new RegExp(`(?<![\\w$])${escaped}${word}`, 'g'))];
  assert.ok(all[n], text);
  return all[n].index + plus;
};
// Where the name at the nth match is defined, as the line of source there
const defined = (src, text, n = 0) => {
  const d = definition(analyze(src), at(src, text, n));
  return d && src.slice(d.start, src.indexOf('\n', d.start) >>> 0 || undefined);
};

test('variables are the ones assigned last before, in the nearest scope', () => {
  const src = 'x = 1;\na = x;\nx = 2;\nb = x;\nmodule m() { c = x; x = 3; d = x; }\n';
  const a = analyze(src);
  const line = (n) => src.split('\n')[n];
  const def = (n) => {
    const d = definition(a, at(src, 'x', n));
    return [src.slice(0, d.start).split('\n').length - 1, d.start];
  };
  assert.deepEqual(def(1), [0, at(src, 'x', 0)]);
  assert.deepEqual(def(3), [2, at(src, 'x', 2)]);
  assert.equal(line(4).slice(0, 12), 'module m() {');
  // In the module: x before its own assignment is the program's
  assert.equal(def(4)[1], at(src, 'x', 2));
  assert.equal(def(6)[1], at(src, 'x', 5));
  // An assignment's value is the earlier one: x = x + 1
  const inc = 'x = 1;\nx = x + 1;\n';
  assert.equal(definition(analyze(inc), at(inc, 'x', 2)).start, 0);
});

test('modules and functions are visible in their whole block', () => {
  const src = 'm();\nmodule m() { n(); module n() {} }\necho(f(1));\nfunction f(a) = a;\n';
  assert.match(defined(src, 'm('), /^m\(\) \{/);
  assert.match(defined(src, 'n()'), /^n\(\) \{\}/);
  assert.match(defined(src, 'f(1'), /^f\(a\)/);
  // A variable and a function of the same name are different names
  const both = 'f = 2;\nfunction f(x) = x;\necho(f, f(1));\n';
  const a = analyze(both);
  assert.equal(definition(a, at(both, 'f', 2)).kind, 'variable');
  // A call through a variable finds the variable first, as the interpreter does
  assert.equal(definition(a, at(both, 'f', 3)).kind, 'variable');
});

test('loops, let, comprehensions and function literals have their own names', () => {
  const src = [
    'i = 9;',
    'for (i = [0:2], j = [0:i]) translate([i, j]) circle(1);',
    'l = [for (k = [0:3]) let (s = k * k) if (s > 1) [s, i]];',
    'g = function(i) i + 1;',
    'v = let (i = 2, w = i) w;',
  ].join('\n');
  const a = analyze(src);
  const kind = (text, n) => {
    const d = definition(a, at(src, text, n));
    return `${d.kind}@${src.slice(0, d.start).split('\n').length}`;
  };
  assert.equal(kind('i', 2), 'variable@2'); // j = [0:i] sees the loop's i
  assert.equal(kind('i', 3), 'variable@2');
  assert.equal(kind('s', 2), 'variable@3');
  assert.equal(kind('i', 4), 'variable@1'); // [s, i] in the comprehension
  assert.equal(kind('i', 6), 'parameter@4');
  assert.equal(kind('i', 8), 'variable@5'); // w = i is let's own i
});

test('named arguments are the parameters they set', () => {
  const src = 'module m(size, h = 2) { rect([size, h]); }\nm(10, h = 3);\nrect(1, r = 2);\n';
  const a = analyze(src);
  const h = definition(a, at(src, 'h = 3'));
  assert.equal(h.kind, 'parameter');
  assert.equal(h.owner.name, 'm');
  assert.equal(h.value, '2');
  assert.deepEqual(
    references(a, at(src, 'h')).map((r) => src.slice(r.start, r.end + 4)),
    ['h = 2', 'h]); ', 'h = 3'],
  );
  assert.match(hover(a, at(src, 'r = 2')).text, /Parameter of `rect\(\)`: Corner radius/);
});

test('use brings modules and functions, include also variables', () => {
  const libs = {
    parts: '// parts: shared shapes\nk = 1;\nmodule tab() {}\nfunction half(x) = x / 2;\n',
  };
  const resolve = (p) => libs[p];
  const used = analyze('use <parts>\ntab();\necho(half(k));\n', { resolve });
  const [tab, half, k] = ['tab', 'half', 'k'].map((n) => used.references.find((r) => r.name === n));
  assert.equal(tab.def.file, 'parts');
  assert.equal(half.def.kind, 'function');
  assert.equal(k.def, undefined);
  const included = analyze('include <parts>\necho(k);\n', { resolve });
  assert.equal(included.references.find((r) => r.name === 'k').def.file, 'parts');
  assert.equal(
    hover(included, 9, { resolve }).text,
    'parts: shared shapes',
    'hover on the path shows the library comment',
  );
  // A library that uses itself is read once
  const loop = analyze('use <a>\nx();\n', { resolve: () => 'use <a>\nmodule x() {}\n' });
  assert.equal(loop.references[0].def.name, 'x');
});

test('every name in the examples, libraries and integrations is found', () => {
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
  const unknown = [];
  let checked = 0;
  for (const file of ['examples', 'lib', 'integrations'].flatMap(files)) {
    const src = readFileSync(file, 'utf8');
    const resolve = (p) => {
      try {
        return readFileSync(join(dirname(file), p + '.kerf'), 'utf8');
      } catch {
        return undefined;
      }
    };
    const a = analyze(src, { resolve });
    assert.ok(a.parsed, file);
    for (const r of a.references) {
      checked++;
      if (!r.def && !r.builtin && !hover(a, r.start)) unknown.push(`${file}: ${r.name}`);
    }
    // Asking anywhere never throws
    for (let o = 0; o <= src.length; o += 41) {
      complete(a, o);
      hover(a, o);
      signatureHelp(a, o);
    }
  }
  assert.deepEqual(unknown, []);
  assert.ok(checked > 5000, `${checked} names`);
});

test('code being typed still has its names', () => {
  const src = 'width = 10;\nmodule panel(w) {\n  rect([w, 2]);\n  rect(\n}\npanel(width);\n';
  const a = analyze(src);
  assert.equal(a.parsed, false);
  assert.deepEqual(
    a.definitions.map((d) => d.name),
    ['panel', 'width', 'w'],
  );
  const items = complete(a, at(src, 'rect(\n', 0, 5)).items;
  assert.equal(items[0].label, 'size');
  assert.ok(items.some((i) => i.label === 'w'));
  // An unfinished line at the end, and brackets left open
  for (const tail of ['x = ', 'module m() {\n  translate([1, ', 'echo("unclosed', '/* open'])
    analyze(src + tail);
  assert.ok(analyze('module m() {\n  for (i = [0:').definitions.some((d) => d.name === 'm'));
});

test('completion knows statements, expressions and arguments', () => {
  const labels = (src, offset = src.length) =>
    complete(analyze(src), offset).items.map((i) => i.label);
  const statement = labels('module m() {}\n');
  assert.ok(statement.includes('m') && statement.includes('rect') && statement.includes('for'));
  assert.ok(!statement.includes('sin'));
  const expression = labels('x = ');
  assert.ok(
    expression.includes('sin') && expression.includes('PI') && !expression.includes('rect'),
  );
  assert.deepEqual(labels('p = [1, 2];\necho(p.').slice(0, 3), ['x', 'y', 'z']);
  assert.deepEqual(labels('echo("a b'), []);
  assert.deepEqual(labels('// rec'), []);
  assert.deepEqual(labels('module '), []);
  assert.deepEqual(labels('x = 1'), []);
  const lib = complete(analyze('use <ke', { libraries: ['tabs'] }), 7);
  assert.deepEqual([lib.from, lib.items.map((i) => i.label)], [5, [...STDLIB, 'tabs']]);
});

test('parameter hints follow the argument being typed', () => {
  const help = (src) => signatureHelp(analyze(src), src.length);
  const s = help('rect([1, 2], ');
  assert.equal(s.label, 'rect(size = 1, center = false, r = 0)');
  assert.equal(s.active, 1);
  assert.equal(help('rect([1, ').active, 0);
  assert.equal(help('rect(r = ').active, 2);
  assert.equal(help('echo(1, 2, 3, ').active, 0);
  assert.equal(help('x = max(1, 2, ').label, 'max(values, ...)');
  assert.equal(help('module m(a, b) {}\nm(1, ').label, 'm(a, b)');
  assert.equal(help('rect(1);'), undefined);
});

test('rename changes every use, and refuses what it cannot', () => {
  const src = 'w = 1;\nmodule m(w) { rect(w); }\nm(w = w);\n';
  const a = analyze(src);
  const edits = rename(a, at(src, 'w', 1), 'size');
  assert.deepEqual(
    edits.map((e) => e.start),
    [at(src, 'w', 1), at(src, 'w', 2), at(src, 'w', 3)],
  );
  assert.deepEqual(rename(a, at(src, 'rect'), 'box'), { error: 'rect is built in' });
  assert.match(rename(a, 0, 'for').error, /not a name/);
  assert.match(rename(a, 0, '$w').error, /\$ stays or goes/);
});

test('the outline nests what modules define', () => {
  const src = 'a = 1;\nmodule m() {\n  b = 2;\n  function f() = 1;\n}\nfunction g(x) = x;\n';
  const tree = outline(analyze(src));
  assert.deepEqual(
    tree.map((i) => [i.name, i.detail, i.children.map((c) => c.name)]),
    [
      ['a', '1', []],
      ['m', 'module m()', ['b', 'f']],
      ['g', 'function g(x)', []],
    ],
  );
});

test('problems: errors with their place and calls, warnings, libraries', () => {
  const src = 'module m(a) {\n  rect(a, radius = 2);\n  circle(widht);\n}\nm(3);\n';
  const [warning, error] = problems(src);
  assert.equal(warning.severity, 'warning');
  assert.equal(src.slice(warning.start, warning.end), 'rect(a, radius = 2);');
  assert.equal(error.message, 'Unknown variable "widht"');
  assert.equal(src.slice(error.start, error.end), 'widht');
  assert.equal(error.related[0].message, 'in module m(), called here');
  assert.equal(src.slice(error.related[0].start, error.related[0].end), 'm');

  const lib = 'use <kerf/box>\nbox(10);\n';
  const [inLib] = problems(lib);
  assert.match(inLib.message, /\(in <kerf\/box>, line \d+\)/);
  assert.equal(lib.slice(inLib.start, inLib.end), 'box');

  const missing = problems('use <nothing>\n');
  assert.equal(missing[0].message, 'Library <nothing> not found');
  assert.equal(problems('rect(10);\n').length, 0);
  assert.equal(problems('module only() {}\n').length, 0, 'a library makes no shapes');
  const sig = problems('rect("a");\n');
  assert.match(sig[0].message, /\nrect\(size = 1, center = false, r = 0\): A rectangle/);
});
