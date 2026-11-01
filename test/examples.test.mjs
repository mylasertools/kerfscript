// Every example must render as it did when test/snapshots/examples.json was
// written: the same parts, sizes, cut lengths, layer areas, output and
// warnings. When a change is meant to alter output, run `npm run snapshots`
// and say so in the changelog.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SNAPSHOTS, examples, summarize } from '../scripts/snapshots.mjs';

const stored = JSON.parse(readFileSync(SNAPSHOTS, 'utf8'));

// Numbers may differ in the last rounded digit between platforms
function same(a, b, path) {
  if (typeof a === 'number' && typeof b === 'number') {
    assert.ok(Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 1e-7), `${path}: ${a}, stored ${b}`);
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    assert.deepEqual(Object.keys(a), Object.keys(b), `${path}: keys`);
    for (const k of Object.keys(b)) same(a[k], b[k], `${path}.${k}`);
  } else assert.equal(a, b, path);
}

test('every example has a snapshot', () => {
  assert.deepEqual(examples(), Object.keys(stored).sort(), 'run `npm run snapshots`');
});

for (const name of examples())
  test(`${name} renders as stored`, () => {
    if (stored[name]) same(summarize(name), stored[name], name);
  });
