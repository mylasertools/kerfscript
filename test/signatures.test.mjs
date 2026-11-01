// The signature table must describe the built-ins as the interpreter
// implements them, and everything else that lists built-ins must agree
// with it: the highlighter, the VS Code grammar and LANGUAGE.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SIGNATURES, formatSignature, parse, render, signature } from '../dist/index.js';
import { BUILTINS, LAYERS } from '../dist/highlight.js';

const evaluator = readFileSync('src/evaluator.ts', 'utf8');
const functions = readFileSync('src/functions.ts', 'utf8');
const names = SIGNATURES.map((s) => s.name).sort();

// Modules in the standard library, which editors colour like built-ins
const library = readdirSync('lib/kerf')
  .filter((f) => f.endsWith('.kerf'))
  .flatMap((f) =>
    parse(readFileSync(`lib/kerf/${f}`, 'utf8'))
      .program.body.filter((s) => s.kind === 'module')
      .map((s) => s.name),
  );
const colored = [...names, ...library].sort();

// The source of one built-in in makeBuiltins, as `name: (c) => ...`, up to
// the next one
function moduleSource(name) {
  const body = evaluator.slice(evaluator.indexOf('private makeBuiltins'));
  const start = body.search(new RegExp(`\\n      ${name}: `));
  if (start < 0) return undefined;
  const next = body.slice(start + 1).search(/\n {6}[a-z_]+: /);
  return body.slice(start, next < 0 ? undefined : start + 1 + next);
}

// Arguments a piece of source reads, as { name: [index, default] }
function reads(src) {
  const out = {};
  for (const m of src.matchAll(/this\.arg\((?:c\.args|a), '(\w+)', (-?\d+)(?:, ([^)]*?))?\)/g))
    out[m[1]] = [Number(m[2]), m[3]];
  if (src.includes('this.textOpts(')) Object.assign(out, reads(method('textOpts')));
  if (src.includes('this.assert(')) Object.assign(out, reads(method('assert')));
  const finger = /this\.fingerWidth\((?:c\.args|a), (?:c\.)?env, (\d)\)/.exec(src);
  if (finger) out.finger = [Number(finger[1]), undefined];
  return out;
}

const method = (name) => {
  const start = evaluator.indexOf(`private ${name}(`);
  return evaluator.slice(start, evaluator.indexOf('\n  }\n', start));
};

// A default in the source that is a plain value, as KerfScript would write it
const literal = (src) =>
  src === undefined || !/^(?:-?[\d.]+|'[^']*'|true|false|\[[-\d., ]*\])$/.test(src.trim())
    ? undefined
    : src.trim().replace(/'/g, '"');

test('every built-in module is in the table, with its parameters', () => {
  const modules = [...evaluator.matchAll(/\n {6}([a-z_]+): (?:\(c\)|layerTag)/g)].map((m) => m[1]);
  assert.ok(modules.length > 35, `found ${modules.length} modules`);
  for (const name of modules) {
    const sig = signature(name);
    assert.ok(sig && sig.kind !== 'function', `${name}() is not a module in the table`);
    const src = moduleSource(name);
    if (name === 'square') continue; // the same as rect()
    const got = reads(src);
    for (const [arg, [index, def]] of Object.entries(got)) {
      const i = sig.params.findIndex((p) => p.name === arg);
      assert.ok(i >= 0, `${name}(): reads ${arg}, which the table does not list`);
      const param = sig.params[i];
      if (index < 0) assert.ok(param.named, `${name}(): ${arg} is only named`);
      else assert.equal(i, index, `${name}(): ${arg} is argument ${index}`);
      if (literal(def) !== undefined)
        assert.equal(param.default, literal(def), `${name}(): default of ${arg}`);
    }
    if (!sig.anyNamed)
      for (const param of sig.params)
        assert.ok(param.name in got, `${name}(): the table lists ${param.name}, never read`);
  }
});

test('every built-in function is in the table, with its parameters', () => {
  const defs = [...functions.matchAll(/\n {2}([a-z_0-9]+): (?:def\(\s*'([^']*)'|math1\()/g)].map(
    (m) => [m[1], m[2] === undefined ? ['x'] : m[2].replace('...', '').split(',')],
  );
  assert.ok(defs.length > 40, `found ${defs.length} functions`);
  for (const [name, params] of defs) {
    const sig = signature(name);
    assert.ok(sig && sig.kind !== 'module', `${name}() is not a function in the table`);
    assert.deepEqual(
      sig.params.map((p) => p.name),
      params.map((p) => p.trim()).filter(Boolean),
      `${name}() parameters`,
    );
  }
  const special = /if \(name === '(\w+)'\)|name === '(\w+)' \|\| name === '(\w+)'/g;
  for (const m of method('specialFunction').matchAll(special))
    for (const name of m.slice(1).filter(Boolean)) {
      const sig = signature(name);
      assert.ok(sig && sig.kind !== 'module', `${name}() is not a function in the table`);
    }
  const measured = reads(method('measure'));
  for (const name of ['text_width', 'text_metrics'])
    assert.deepEqual(
      signature(name)
        .params.map((p) => p.name)
        .sort(),
      Object.keys(measured).sort(),
    );
});

test('every name in the table is a built-in', () => {
  for (const s of SIGNATURES) {
    const src = s.kind === 'function' ? `x = ${s.name}();` : `${s.name}();`;
    try {
      render(src);
    } catch (e) {
      assert.doesNotMatch(e.message, /Unknown (module|function)/, s.name);
    }
  }
});

test('built-ins warn about named arguments they do not take', () => {
  const r = render('rect(10, foo = 1); x = text_width("a", sizee = 2, $fn = 3);', {
    fonts: { atkinson: readFileSync('fonts/AtkinsonHyperlegible-Regular.ttf') },
  });
  assert.deepEqual(r.warnings, [
    'rect(): unknown argument "foo" (line 1)',
    'text_width(): unknown argument "sizee" (line 1)',
  ]);
  assert.deepEqual(render('rect(10, r = 1, center = true); echo(a = 1);').warnings, []);
});

test('the highlighter knows every built-in', () => {
  assert.deepEqual([...new Set([...BUILTINS, ...LAYERS])].sort(), colored);
});

test('the VS Code grammar knows every built-in', () => {
  const grammar = JSON.parse(
    readFileSync('editors/vscode/syntaxes/kerfscript.tmLanguage.json', 'utf8'),
  );
  const listed = grammar.repository['builtin-call'].patterns.flatMap((p) =>
    /\\b\(([^)]*)\)/.exec(p.match)[1].split('|'),
  );
  assert.deepEqual([...listed].sort(), colored);
});

test('LANGUAGE.md documents every built-in and only real parameters', () => {
  const doc = readFileSync('LANGUAGE.md', 'utf8');
  for (const s of SIGNATURES) {
    assert.ok(doc.includes(`\`${s.name}(`) || doc.includes(`\`${s.name}\``), `${s.name}()`);
    for (const m of doc.matchAll(new RegExp(`\`${s.name}\\(([^\`]*)\\)\``, 'g'))) {
      if (/^\[|^\.\.\.$|^$/.test(m[1])) continue;
      // Split at commas outside brackets
      const args = m[1].split(/,(?![^[]*\])/).map((a) => a.split('=')[0].trim());
      // A call with values, as circle(5, $fn = 6), is an example, not a signature
      if (!args.every((a) => /^[a-z_]+$|^\.\.\.$/.test(a))) continue;
      for (const a of args)
        assert.ok(
          a === '...' || s.params.some((p) => p.name === a),
          `LANGUAGE.md shows ${s.name}(${m[1]}), but ${a} is not a parameter`,
        );
    }
  }
});

test('signatures read as calls', () => {
  assert.equal(formatSignature(signature('rect')), 'rect(size = 1, center = false, r = 0)');
  assert.equal(formatSignature(signature('str')), 'str(...)');
});
