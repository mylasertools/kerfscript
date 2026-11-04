import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { render, snapshotFromRender, verify, verificationIsCurrent } from '../../dist/index.js';

const source = (name) =>
  readFileSync(new URL(`../fixtures/verification/${name}.kerf`, import.meta.url), 'utf8');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const provenance = (text) => ({
  sourceHash: sha(text),
  engineHash: sha('synthetic test engine'),
  dependencies: {},
  fonts: {},
});
const snapshot = (name, params = {}, configuration = 'default') => {
  const text = source(name);
  return snapshotFromRender(render(text, { params, analysis: true }), {
    configuration,
    params,
    provenance: provenance(text),
  });
};
const spec = (claims, configurations = [{ id: 'default' }]) => ({
  schemaVersion: 1,
  model: 'synthetic',
  configurations,
  claims,
});
const glue = {
  id: 'patch-contact',
  kind: 'glue-contact',
  a: { part: 'host' },
  b: { part: 'patch' },
  faceA: 'top',
  faceB: 'bottom',
  minimumArea: 110,
};
const tab = {
  id: 'tongue-fit',
  kind: 'tab-slot',
  tab: { part: 'tongue' },
  receiver: { part: 'receiver' },
  region: [10, 0, 20, 4],
  clearance: [0.2, 0.4],
  flushTolerance: 0.1,
  minimumLigament: 9,
};
const shaft = {
  id: 'shaft-capture',
  kind: 'captured-shaft',
  shaft: { hardware: 'shaft' },
  bearings: [
    { part: 'bearing', copy: 1 },
    { part: 'bearing', copy: 2 },
  ],
  stack: [{ part: 'lower spacer' }, { part: 'rotor' }, { part: 'upper spacer' }],
  stops: [
    { body: { hardware: 'head' }, attachment: { kind: 'integral' } },
    {
      body: { hardware: 'nut' },
      attachment: {
        kind: 'threaded',
        thread: { hardware: 'thread' },
        minimumEngagement: 3,
        secured: true,
      },
    },
  ],
  clearance: [0.1, 0.5],
  endplay: [0.2, 0.6],
  minimumOverlap: 1,
  maximumStopGap: 0.1,
};
function claimResult(result, id) {
  assert.equal(result.kind, 'report', JSON.stringify(result));
  return result.report.claims.find((c) => c.id === id);
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const run = (claim, name, params = {}) => verify(spec([claim]), [snapshot(name, params)]);

test('snapshot copies and freezes evaluated geometry, with nominal cuts before kerf compensation', () => {
  const text = source('mixed-material-tab'),
    r = render(text, { analysis: true });
  const s = snapshotFromRender(r, { configuration: 'default', provenance: provenance(text) });
  const old = s.parts[0].regions[0][0][0];
  r.assembly[0].outline[0][0][0] += 100;
  assert.equal(s.parts[0].regions[0][0][0], old);
  assert.ok(Object.isFrozen(s.parts[0].regions[0]));
  assert.equal(s.parts[0].kerf, 0.15);
  assert.deepEqual(s.parts[0].cutLines, []);
});

test('known absence of open cutting lines differs from missing analysis metadata', () => {
  const r = render(source('glue-patch'));
  const s = snapshotFromRender(r, { configuration: 'default', provenance: provenance('coupon') });
  assert.equal(s.parts[0].cutLines, null);
  const result = verify(spec([glue]), [s]);
  assert.equal(claimResult(result, glue.id).status, 'unverified');
});

test('planar contact measures 120 mm2 and reports its limited scope', () => {
  const result = run(glue, 'glue-patch'),
    c = claimResult(result, glue.id);
  assert.equal(result.report.status, 'pass');
  assert.equal(c.measurements.contactArea, 120);
  assert.equal(c.coverage, 'nominal');
  assert.match(c.assumptions.join(' '), /strength/);
  assert.ok(result.report.uncovered.some((x) => x.includes('motion')));
});
for (const [params, expected] of [
  [{ px: 34 }, 60],
  [{ hole: true }, 104],
])
  test(`glue contact subtracts missing material: ${JSON.stringify(params)}`, () => {
    const c = claimResult(run(glue, 'glue-patch', params), glue.id);
    assert.equal(c.status, 'fail');
    assert.equal(c.measurements.contactArea, expected);
  });
test('a patch floating 0.2 mm above its host fails contact', () => {
  const c = claimResult(run(glue, 'glue-patch', { pz: 3.2 }), glue.id);
  assert.equal(c.status, 'fail');
  assert.ok(Math.abs(c.measurements.faceGap - 0.2) < 1e-8);
});
test('same-facing surfaces and self glue are not contacts', () => {
  assert.equal(claimResult(run({ ...glue, faceB: 'top' }, 'glue-patch'), glue.id).status, 'fail');
  assert.equal(claimResult(run({ ...glue, b: glue.a }, 'glue-patch'), glue.id).status, 'fail');
});

test('mixed-material tab measures independent clearances and receiving thickness', () => {
  const c = claimResult(run(tab, 'mixed-material-tab'), tab.id);
  assert.equal(c.status, 'pass', JSON.stringify(c));
  for (const gap of [c.measurements.clearanceX, c.measurements.clearanceY])
    for (const v of gap) assert.ok(Math.abs(v - 0.3) < 1e-8);
  assert.equal(c.measurements.engagement, 4);
  assert.ok(Math.abs(c.measurements.minimumLigament - 9.85) < 1e-8);
});
test('a slot narrower than the tab fails', () => {
  const c = claimResult(run(tab, 'mixed-material-tab', { slot_width: 1.9 }), tab.id);
  assert.equal(c.status, 'fail');
});
test('a tab sized from its own 2 mm stock cannot engage a 4 mm panel', () => {
  const c = claimResult(
    run({ ...tab, region: [10, 0, 20, 2] }, 'mixed-material-tab', { tab_depth: 2 }),
    tab.id,
  );
  assert.equal(c.status, 'fail');
  assert.equal(c.measurements.engagement, 2);
});
test('a receiver thickness change needs a new tab design', () => {
  const bad = claimResult(run(tab, 'mixed-material-tab', { receiver_t: 5 }), tab.id);
  assert.equal(bad.status, 'fail');
  const good = claimResult(
    run({ ...tab, region: [10, 0, 20, 5] }, 'mixed-material-tab', { receiver_t: 5, tab_depth: 5 }),
    tab.id,
  );
  assert.equal(good.status, 'pass', JSON.stringify(good));
});
test('an offset slot can have correct total clearance while interfering at one side', () => {
  const c = claimResult(run(tab, 'mixed-material-tab', { slot_x: 10.05 }), tab.id);
  assert.equal(c.status, 'fail');
  assert.match(c.message, /offset/);
});
test('manufacturing variation freezes cuts instead of redesigning them', () => {
  const s = snapshot('mixed-material-tab'),
    contract = spec([{ ...tab, clearance: [0.05, 0.5] }]);
  contract.materials = {
    tongue: { thickness: [1.9, 2.1], kerf: [0.12, 0.18] },
    receiver: { thickness: [4, 4], kerf: [0.12, 0.18] },
  };
  const c = claimResult(verify(contract, [s]), tab.id);
  assert.equal(c.status, 'pass', JSON.stringify(c));
  assert.equal(c.coverage, 'bounded-fit');
  assert.ok(Math.abs(c.measurements.clearanceY[0] - 0.17) < 1e-8);
  contract.materials.tongue.thickness = [2.9, 3.1];
  assert.equal(claimResult(verify(contract, [s]), tab.id).status, 'fail');
  assert.equal(s.parts.find((p) => p.name === 'receiver').thickness, 4);
});

test('captured shaft has 0.4 mm endplay and both measured positive stops', () => {
  const c = claimResult(run(shaft, 'captured-shaft'), shaft.id);
  assert.equal(c.status, 'pass', JSON.stringify(c));
  assert.ok(c.measurements.endplay.every((v) => Math.abs(v - 0.4) < 1e-8));
  assert.ok(c.measurements.clearance1[0] > 0.19 && c.measurements.clearance1[1] < 0.21);
  assert.equal(c.measurements.threadEngagement, 4);
  assert.ok(c.assumptions.some((a) => a.includes('loosening')));
});
for (const [params, word] of [
  [{ upper: 9.1 }, /stack|endplay/],
  [{ stop_diameter: 5 }, /retainer/],
  [{ stop_x: 1 }, /coaxial/],
  [{ nut_z: 24 }, /retainer/],
])
  test(`shaft capture rejects ${JSON.stringify(params)}`, () => {
    const c = claimResult(run(shaft, 'captured-shaft', params), shaft.id);
    assert.equal(c.status, 'fail', JSON.stringify(c));
    assert.match(c.message, word);
  });
test('a missing stop is a binding error, never a capture pass', () => {
  assert.equal(run(shaft, 'captured-shaft', { missing_stop: true }).kind, 'invalid-spec');
});
test('an unsecured or unexplained collar is unverified', () => {
  const c = clone(shaft);
  c.stops[1].attachment.secured = false;
  assert.equal(claimResult(run(c, 'captured-shaft'), shaft.id).status, 'unverified');
  c.stops[1].attachment = { kind: 'unknown' };
  assert.equal(claimResult(run(c, 'captured-shaft'), shaft.id).status, 'unverified');
});

test('full cut invariance catches a moving hole despite equal dimensions/perimeters', () => {
  const configurations = [{ id: 'a' }, { id: 'b' }],
    claim = { id: 'cuts', kind: 'cut-invariant' };
  const a = snapshot('moving-hole', {}, 'a'),
    b = snapshot('moving-hole', { position: 10 }, 'b');
  assert.equal(claimResult(verify(spec([claim], configurations), [a, b]), 'cuts').status, 'fail');
  const rotated = snapshot('moving-hole', { angle: 70 }, 'b');
  assert.equal(
    claimResult(verify(spec([claim], configurations), [a, rotated]), 'cuts').status,
    'pass',
  );
});
test('cutting lines participate in the invariant, and missing lines cannot mean no lines', () => {
  const a = clone(snapshot('moving-hole', {}, 'a')),
    b = clone(a);
  b.configuration = 'b';
  a.parts[0].cutLines = [
    [
      [0, 0],
      [1, 1],
    ],
  ];
  b.parts[0].cutLines = [
    [
      [0, 0],
      [2, 2],
    ],
  ];
  const contract = spec([{ id: 'cuts', kind: 'cut-invariant' }], [{ id: 'a' }, { id: 'b' }]);
  assert.equal(claimResult(verify(contract, [a, b]), 'cuts').status, 'fail');
  b.parts[0].cutLines = null;
  assert.equal(claimResult(verify(contract, [a, b]), 'cuts').status, 'unverified');
});

test('empty/optional-only scopes, unknown kinds, bad dimensions and duplicate IDs are rejected', () => {
  for (const contract of [
    spec([]),
    spec([{ ...glue, required: false }]),
    spec([{ ...glue, kind: 'glue-typo' }]),
    spec([{ ...tab, clearance: [0.4, 0.2] }]),
    spec([glue, glue]),
  ])
    assert.equal(verify(contract, []).kind, 'invalid-spec');
});
test('missing references and ambiguous hardware labels do not bind by array order', () => {
  const s = clone(snapshot('captured-shaft'));
  s.hardware.push({ ...s.hardware[0] });
  assert.equal(verify(spec([shaft]), [s]).kind, 'invalid-spec');
  assert.equal(run({ ...glue, b: { part: 'typo' } }, 'glue-patch').kind, 'invalid-spec');
});
test('duplicate manufacturing names/copy indices and nonrigid transforms are invalid snapshots', () => {
  const s = clone(snapshot('glue-patch'));
  s.parts.push(clone(s.parts[0]));
  assert.equal(verify(spec([glue]), [s]).kind, 'invalid-snapshot');
  s.parts.pop();
  s.parts[0].matrix[0] = 2;
  assert.equal(verify(spec([glue]), [s]).kind, 'invalid-snapshot');
});
test('missing required configuration fails independently of physical checks', () => {
  const result = verify(spec([glue]), []);
  assert.equal(result.kind, 'report');
  assert.equal(result.report.status, 'fail');
  assert.equal(claimResult(result, glue.id).status, 'unverified');
});
test('missing provenance, legacy hardware, compiler warnings and resource limits cannot yield green reports', () => {
  const s = clone(snapshot('glue-patch'));
  for (const change of [
    { provenance: null },
    { legacyHardware: true },
    { warnings: ['not fully checked'] },
  ])
    assert.equal(verify(spec([glue]), [{ ...s, ...change }]).report.status, 'unverified');
  assert.equal(verify(spec([glue]), [s], { maxPoints: 1 }).report.status, 'unverified');
  assert.equal(verify(spec([glue]), [s], { maxPoints: -1 }).kind, 'invalid-spec');
});
test('required unsupported capabilities stay unverified; optional checks never hide a required failure', () => {
  const result = verify(spec([glue, { id: 'motion', kind: 'strength' }]), [snapshot('glue-patch')]);
  assert.equal(result.report.status, 'unverified');
  const bad = verify(spec([glue, { id: 'motion', kind: 'strength', required: false }]), [
    snapshot('glue-patch', { px: 34 }),
  ]);
  assert.equal(bad.report.status, 'fail');
});
test('reports are deterministic and exact input fingerprints are retained', () => {
  const s = snapshot('glue-patch'),
    contract = spec([glue]);
  const a = verify(contract, [s]),
    b = verify(contract, [s]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.report.inputs[0].provenance, provenance(source('glue-patch')));
});

test('near-contact and near-area boundaries remain unverified', () => {
  assert.equal(claimResult(run(glue, 'glue-patch', { pz: 3.0005 }), glue.id).status, 'unverified');
  assert.equal(
    claimResult(run({ ...glue, minimumArea: 119.99 }, 'glue-patch'), glue.id).status,
    'unverified',
  );
});
test('even a small tilted face cannot be counted as full planar contact', () => {
  const text =
    'part("host",at=[0,0,0]) rect([40,30]); part("patch",at=[10,8,3],rotate=[0.01,0,0]) rect([12,10]);';
  const s = snapshotFromRender(render(text, { analysis: true }), {
    configuration: 'default',
    provenance: provenance(text),
  });
  assert.equal(claimResult(verify(spec([glue]), [s]), glue.id).status, 'fail');
});
test('a tongue selector cannot invent a smaller part by cropping internal material', () => {
  const c = claimResult(run({ ...tab, region: [11, 1, 19, 3] }, 'mixed-material-tab'), tab.id);
  assert.equal(c.status, 'unverified');
  assert.match(c.message, /selector/);
});
test('open cutting lines are actual manufacturing metadata and prevent rigid contact claims', () => {
  const text =
    'part("host",at=[0,0,0]) { rect([40,30]); line([1,1],[10,10]); } part("patch",at=[10,8,3]) rect([12,10]);';
  const s = snapshotFromRender(render(text, { analysis: true }), {
    configuration: 'default',
    provenance: provenance(text),
  });
  assert.equal(s.parts.find((p) => p.name === 'host').cutLines.length, 1);
  assert.equal(claimResult(verify(spec([glue]), [s]), glue.id).status, 'unverified');
});
test('bearing thickness uncertainty does not silently assume movable retainer seating', () => {
  const contract = spec([shaft]);
  contract.materials = { bearing: { thickness: [2.9, 3.1], kerf: [0, 0] } };
  assert.equal(
    claimResult(verify(contract, [snapshot('captured-shaft')]), shaft.id).status,
    'unverified',
  );
});
test('stale parameters, reserved claim IDs, nonfinite geometry and extreme coordinates are rejected', () => {
  const s = clone(snapshot('glue-patch'));
  assert.equal(
    verify(spec([glue], [{ id: 'default', params: { px: 34 } }]), [s]).kind,
    'invalid-spec',
  );
  assert.equal(verify(spec([{ ...glue, id: '$configuration:default' }]), [s]).kind, 'invalid-spec');
  s.parts[0].regions[0][0][0] = Infinity;
  assert.equal(verify(spec([glue]), [s]).kind, 'invalid-snapshot');
  s.parts[0].regions[0][0][0] = 1e100;
  assert.equal(verify(spec([glue]), [s]).kind, 'invalid-snapshot');
});
test('exact small cut changes cannot hide behind an area tolerance', () => {
  const a = clone(snapshot('moving-hole', {}, 'a')),
    b = clone(a);
  b.configuration = 'b';
  b.parts[0].regions[0][0][0] += 1e-8;
  const result = verify(spec([{ id: 'cuts', kind: 'cut-invariant' }], [{ id: 'a' }, { id: 'b' }]), [
    a,
    b,
  ]);
  assert.equal(claimResult(result, 'cuts').status, 'fail');
});
test('changing ring order/start preserves manufacturing geometry but changing hole polarity does not', () => {
  const a = clone(snapshot('moving-hole', {}, 'a')),
    b = clone(a);
  b.configuration = 'b';
  b.parts[0].regions = b.parts[0].regions.reverse().map((r) => [...r.slice(1), r[0]]);
  const contract = spec([{ id: 'cuts', kind: 'cut-invariant' }], [{ id: 'a' }, { id: 'b' }]);
  assert.equal(claimResult(verify(contract, [a, b]), 'cuts').status, 'pass');
  b.parts[0].regions[0].reverse();
  assert.equal(claimResult(verify(contract, [a, b]), 'cuts').status, 'fail');
});
test('saved report inputs and requirements do not alias caller-owned objects', () => {
  const s = clone(snapshot('glue-patch')),
    contract = spec([clone(glue)]),
    result = verify(contract, [s]);
  s.params.px = 100;
  contract.claims[0].minimumArea = 1000;
  assert.equal(result.report.inputs[0].params.px, undefined);
  assert.equal(result.report.specification.claims[0].minimumArea, 110);
});
test('unknown specification keys and prototype-like claim kinds are validation errors', () => {
  for (const input of [
    { ...spec([glue]), configurations: [{ id: 'default', thickness: 6 }] },
    spec([{ ...glue, kind: '__proto__' }]),
    spec([{ ...glue, kind: 'constructor' }]),
    spec([{ ...glue, minimumAreas: 110 }]),
  ])
    assert.equal(verify(input, []).kind, 'invalid-spec');
});
test('an unrestricted flush allowance cannot turn zero engagement into a pass', () => {
  const c = claimResult(run({ ...tab, flushTolerance: 100 }, 'mixed-material-tab'), tab.id);
  assert.equal(c.status, 'unverified');
});

test('small interference is caught independently of the render collision volume threshold', () => {
  const text = source('mixed-material-tab');
  const params = { slot_width: 1.99 };
  const r = render(text, { params, analysis: true });
  assert.ok(!r.warnings.some((w) => w.includes('collide')));
  const s = snapshotFromRender(r, {
    configuration: 'default',
    params,
    provenance: provenance(text),
  });
  assert.equal(claimResult(verify(spec([tab]), [s]), tab.id).status, 'fail');
});

test('a failed configuration remains failed even with an empty compiler diagnostic', () => {
  const s = clone(snapshot('glue-patch'));
  s.error = '';
  assert.equal(verify(spec([glue]), [s]).report.status, 'fail');
});

test('archived reports become stale when source, engine, dependencies, fonts, settings, profiles or requirements change', () => {
  const s = snapshot('glue-patch'),
    contract = spec([glue]),
    { report } = verify(contract, [s]);
  assert.equal(verificationIsCurrent(report, contract, [s]), true);
  for (const field of ['sourceHash', 'engineHash', 'dependencies', 'fonts']) {
    const changed = clone(s);
    changed.provenance[field] = field.endsWith('Hash')
      ? 'b'.repeat(64)
      : { changed: 'b'.repeat(64) };
    assert.equal(verificationIsCurrent(report, contract, [changed]), false, field);
  }
  const changed = clone(s);
  changed.params.px = 20;
  assert.equal(verificationIsCurrent(report, contract, [changed]), false);
  changed.params = s.params;
  changed.renderSettings.defaultSheet = [100, 100];
  assert.equal(verificationIsCurrent(report, contract, [changed]), false);
  const altered = clone(contract);
  altered.materials = { plywood: { thickness: [3, 3], kerf: [0, 0] } };
  assert.equal(verificationIsCurrent(report, altered, [s]), false);
  altered.materials = undefined;
  altered.claims[0].minimumArea = 100;
  assert.equal(verificationIsCurrent(report, altered, [s]), false);
});

test('larger actual kerf reduces the ligament between internal and external cuts', () => {
  const contract = spec([{ ...tab, clearance: [0.1, 0.7], minimumLigament: 9.7 }]);
  contract.materials = { receiver: { thickness: [4, 4], kerf: [0.15, 0.35] } };
  const c = claimResult(verify(contract, [snapshot('mixed-material-tab')]), tab.id);
  assert.equal(c.status, 'fail', JSON.stringify(c));
  assert.match(c.message, /material remains/);
  assert.ok(c.measurements.minimumLigament < 9.7);
});

test('thread engagement cannot be supplied by an envelope outside the physical shaft', () => {
  const s = clone(snapshot('captured-shaft'));
  const thread = s.hardware.find((h) => h.label === shaft.stops[1].attachment.thread.hardware);
  thread.to[2] += 50;
  assert.equal(claimResult(verify(spec([shaft]), [s]), shaft.id).status, 'fail');
});

test('overflowing hardware orientation cannot yield a kinematic pass', () => {
  const s = clone(snapshot('captured-shaft'));
  s.hardware[0].up = [1e308, 1e308, 1e308];
  assert.equal(verify(spec([shaft]), [s]).kind, 'invalid-snapshot');
});

test('whole-inventory budgets include generated cylindrical hardware envelopes', () => {
  const s = clone(snapshot('captured-shaft'));
  s.hardware = Array.from({ length: 2000 }, (_, i) => ({ ...s.hardware[0], label: `shaft${i}` }));
  const r = verify(spec([{ id: 'stock', kind: 'material-assignment' }]), [s]);
  assert.equal(r.kind, 'report');
  assert.equal(r.report.status, 'unverified');
  assert.equal(r.report.claims[0].code, 'resource-limit');
});
