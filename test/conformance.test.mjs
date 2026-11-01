// Runs the language conformance cases in conformance/cases. Each case is a
// .kerf program whose `// =>` comments give the expected result; see
// conformance/README.md for the format.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '../dist/index.js';

const root = 'conformance';

const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory()
      ? files(join(dir, d.name))
      : d.name.endsWith('.kerf')
        ? [join(dir, d.name)]
        : [],
  );

// `use <name>` finds conformance/lib/name.kerf
const resolve = (path) => {
  const file = join(root, 'lib', `${path}.kerf`);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
};

function expectations(src) {
  const out = { echo: [], error: null, warning: null, part: null, layer: null, with: {} };
  for (const line of src.split('\n')) {
    const m = /^\/\/ => (echo|error|warning|part|layer|with):(?: (.*))?$/.exec(line);
    if (!m) continue;
    const [, kind, value = ''] = m;
    if (kind === 'echo') out.echo.push(value);
    else if (kind === 'error') out.error = value;
    else if (kind === 'with') out.with = JSON.parse(value);
    else (out[kind] ??= []).push(value);
  }
  return out;
}

// `"name" key=value ...` as { name, fields }
function record(text) {
  const m = /^"([^"]*)"((?: [a-z]+=\S+)*)$/.exec(text);
  if (!m) throw new Error(`Bad expectation: ${text}`);
  return {
    name: m[1],
    fields: Object.fromEntries(
      m[2]
        .trim()
        .split(' ')
        .filter(Boolean)
        .map((f) => f.split('=')),
    ),
  };
}

// Area of the closed paths and length of the open ones in an SVG path string
function measure(d) {
  let area = 0;
  let length = 0;
  for (const sub of d.split('M').filter(Boolean)) {
    const closed = sub.endsWith('Z');
    const pts = sub
      .replace('Z', '')
      .split('L')
      .map((p) => p.trim().split(/\s+/).map(Number));
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const next = pts[(i + 1) % pts.length];
      if (closed) area += x1 * next[1] - next[0] * y1;
      else if (i + 1 < pts.length) length += Math.hypot(next[0] - x1, next[1] - y1);
    }
  }
  return { area: Math.abs(area / 2), length };
}

const same = (want, got) =>
  /^-?[\d.]+$/.test(want) && typeof got === 'number'
    ? Math.abs(Number(want) - got) <= 0.01
    : want === String(got);

function check(kind, wants, items, fieldsOf) {
  for (const want of wants) {
    const { name, fields } = record(want);
    const item = items.find((i) => i.name === name);
    assert.ok(item, `no ${kind} "${name}"; found ${items.map((i) => `"${i.name}"`).join(', ')}`);
    const got = fieldsOf(item);
    for (const [k, v] of Object.entries(fields))
      assert.ok(same(v, got[k]), `${kind} "${name}" ${k}: expected ${v}, got ${got[k]}`);
  }
  assert.equal(items.length, wants.length, `${kind}s: ${items.map((i) => i.name).join(', ')}`);
}

for (const file of files(join(root, 'cases')).sort()) {
  const name = file.slice(root.length + 7).replace(/\\/g, '/');
  test(name, () => {
    const src = readFileSync(file, 'utf8');
    const want = expectations(src);
    let result;
    let error;
    try {
      result = render(src, { resolve, ...want.with });
    } catch (e) {
      error = e;
    }
    if (want.error === null) {
      if (error) throw error;
    } else {
      assert.ok(error, `expected the error: ${want.error}`);
      assert.equal(error.message, want.error);
    }
    assert.deepEqual(error ? (error.echoes ?? []) : result.echoes, want.echo, 'echo output');
    if (error) return;
    if (want.warning) assert.deepEqual(result.warnings, want.warning, 'warnings');
    if (want.part)
      check('part', want.part, result.parts, (p) => ({
        ...p,
        size: `${p.width}x${p.height}`,
        cut: p.cutLength,
      }));
    if (want.layer) {
      const layers = result.paths.filter((p) => p.d);
      check('layer', want.layer, layers, (p) => ({
        area: measure(p.regions).area,
        length: measure(p.lines).length,
      }));
    }
  });
}
