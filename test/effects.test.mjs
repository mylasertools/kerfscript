// kerf check --settings: what each setting changes across its range.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { settingEffects } from '../dist/index.js';

const SOURCE = `use <kerf/stand>
band = 30; // [10:5:60]
notes = "for the shop";
lift = 20; // [0:5:60]
mount = "stand"; // [stand, wall, hook]
clearance = 0.15; // [0:0.05:0.5] when mount == "wall"
angle = 0; // [0:5:360] drive
h = min(band, 36);
part("Sign", at = [0, 0, lift]) square([140, h + 20]);
if (mount == "wall") translate([0, -10]) square([10, 10]);
`;

test('settingEffects says what each setting changes', () => {
  const by = Object.fromEntries(settingEffects(SOURCE).map((e) => [e.name, e]));
  assert.equal(by.band.effect, 'files');
  assert.deepEqual(by.band.same, [[50, 60]]);
  assert.equal(by.notes.effect, 'nothing');
  assert.equal(by.lift.effect, 'view');
  assert.equal(by.mount.effect, 'files');
  assert.deepEqual(by.mount.same, [['stand', 'hook']]);
  assert.equal(by.clearance.effect, 'skipped');
  assert.match(by.clearance.reason, /mount == "wall"/);
  assert.equal(by.angle.effect, 'skipped');
});

test('a value the program stops at is reported, not taken as no change', () => {
  const [e] = settingEffects(
    'w = 20; // [0:10:40]\nassert(w > 0, "too narrow");\nsquare([w, 10]);',
  );
  assert.equal(e.effect, 'files');
  assert.deepEqual(
    e.errors.map((x) => [x.value, x.message]),
    [[0, 'Assertion failed: too narrow (line 2, column 1)']],
  );
});

test('kerf check --settings lists them and exits 1 when one changes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-settings-'));
  const file = join(dir, 'm.kerf');
  writeFileSync(file, SOURCE);
  let out = '';
  let code = 0;
  try {
    out = execFileSync('node', ['dist/cli.js', 'check', file, '--settings'], { encoding: 'utf8' });
  } catch (e) {
    out = e.stdout;
    code = e.status;
  }
  assert.equal(code, 1);
  assert.match(out, /notes: changes nothing/);
  assert.match(out, /band: changes the files\n {2}from 50 to 60 it changes nothing/);
  assert.match(out, /lift: changes only the assembled view/);
  assert.match(out, /"stand" and "hook" give the same result/);
});
