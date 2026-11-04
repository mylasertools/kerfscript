import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = (name) =>
  fileURLToPath(new URL(`../fixtures/verification/${name}`, import.meta.url));
const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const run = (...args) =>
  spawnSync(process.execPath, [cli, 'verify', ...args], { encoding: 'utf8' });
test('verify CLI archives exact inputs and passes a measured glue coupon', () => {
  const r = run(fixture('glue-patch.kerf'), '--spec', fixture('glue-patch.verify.json'));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const result = JSON.parse(r.stdout);
  assert.equal(result.report.status, 'pass');
  assert.equal(
    result.report.claims.find((c) => c.id === 'patch-contact').measurements.contactArea,
    120,
  );
  assert.match(result.report.inputs[0].provenance.engineHash, /^[a-f0-9]{64}$/);
  assert.ok(result.report.inputs[0].provenance.fonts.Atkinson);
  assert.deepEqual(result.report.specification.claims[0].a, { part: 'host' });
});
test('verify CLI writes a shaft report and returns nonzero for failed/unverified/invalid claims', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-verify-'));
  const out = join(dir, 'report.json');
  const good = run(
    fixture('captured-shaft.kerf'),
    '--spec',
    fixture('captured-shaft.verify.json'),
    '-o',
    out,
  );
  assert.equal(good.status, 0, good.stderr + good.stdout);
  assert.equal(good.stdout, '');
  assert.equal(JSON.parse(readFileSync(out)).report.status, 'pass');
  const input = JSON.parse(readFileSync(fixture('glue-patch.verify.json')));
  input.configurations[0].params = { px: 34 };
  const spec = join(dir, 'spec.json');
  writeFileSync(spec, JSON.stringify(input));
  const bad = run(fixture('glue-patch.kerf'), '--spec', spec);
  assert.equal(bad.status, 1, bad.stderr + bad.stdout);
  input.claims = [{ id: 'motion', kind: 'strength' }];
  writeFileSync(spec, JSON.stringify(input));
  assert.equal(run(fixture('glue-patch.kerf'), '--spec', spec).status, 2);
  writeFileSync(spec, JSON.stringify({ ...input, claims: [] }));
  assert.equal(run(fixture('glue-patch.kerf'), '--spec', spec).status, 2);
});
test('a refused required design configuration is a failed configuration claim', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-verify-refused-'));
  const model = join(dir, 'model.kerf'),
    spec = join(dir, 'model.verify.json');
  writeFileSync(model, 'assert(false, "bad stock"); rect(10);');
  writeFileSync(
    spec,
    JSON.stringify({
      schemaVersion: 1,
      model: 'refused',
      configurations: [{ id: 'required' }],
      claims: [{ id: 'stock', kind: 'material-assignment' }],
    }),
  );
  const result = run(model, '--spec', spec);
  assert.equal(result.status, 1);
  assert.match(JSON.stringify(JSON.parse(result.stdout)), /bad stock/);
});
test('verify CLI never autoexecutes a sibling JavaScript specification', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-verify-data-'));
  const model = join(dir, 'model.kerf'),
    spec = join(dir, 'model.verify.json');
  writeFileSync(model, 'part("p", at=[0,0,0]) rect(10);');
  writeFileSync(join(dir, 'model.verify.mjs'), 'throw new Error("must not run");');
  writeFileSync(
    spec,
    JSON.stringify({
      schemaVersion: 1,
      model: 'data',
      configurations: [{ id: 'default' }],
      claims: [{ id: 'motion', kind: 'strength' }],
    }),
  );
  const result = run(model, '--spec', spec);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).kind, 'report');
});
test('an unwritable output reports an input/output error without retrying the write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-verify-output-'));
  const r = run(
    fixture('glue-patch.kerf'),
    '--spec',
    fixture('glue-patch.verify.json'),
    '-o',
    join(dir, 'missing', 'report.json'),
  );
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Could not write verification report/);
  assert.doesNotMatch(r.stderr, /at verificationCommand/);
});
test('stock adaptation verifies separate profiles while each cutting file stays frozen within its tolerances', () => {
  const r = run(
    fixture('mixed-material-tab.kerf'),
    '--spec',
    fixture('mixed-material-tab.verify.json'),
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout).report;
  assert.equal(report.claims.find((c) => c.id === '4mm fit').status, 'pass');
  assert.equal(report.claims.find((c) => c.id === '5mm fit').status, 'pass');
  assert.equal(report.specification.configurations[0].materials.receiver.thickness[0], 3.95);
});
test('verify CLI refuses a configuration that sets a setting the model lacks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-verify-'));
  const input = JSON.parse(readFileSync(fixture('slider.verify.json')));
  const first = input.configurations[0];
  first.params = { ...first.params, bogus: 5 };
  const spec = join(dir, 'typo.json');
  writeFileSync(spec, JSON.stringify(input));
  const r = run(fixture('slider.kerf'), '--spec', spec);
  assert.equal(r.status, 2, r.stdout);
  const result = JSON.parse(r.stdout);
  assert.equal(result.kind, 'invalid-spec');
  assert.equal(result.issues[0].code, 'unknown-parameter');
});
test('verify --summary groups what did not pass on stderr, the report unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-verify-'));
  const input = JSON.parse(readFileSync(fixture('glue-patch.verify.json')));
  const ok = run(
    fixture('glue-patch.kerf'),
    '--spec',
    fixture('glue-patch.verify.json'),
    '--summary',
  );
  assert.match(ok.stderr, /All \d+ claims pass/);
  assert.equal(JSON.parse(ok.stdout).report.status, 'pass');
  const contact = input.claims.find((c) => c.kind === 'glue-contact');
  contact.minimumArea = 1e6;
  const spec = join(dir, 'big.json');
  writeFileSync(spec, JSON.stringify(input));
  const bad = run(fixture('glue-patch.kerf'), '--spec', spec, '--summary');
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stderr, /^fail \S+ \(1\): /m);
  assert.match(bad.stderr, new RegExp(`^  ${contact.id}.*host`, 'm'));
});
