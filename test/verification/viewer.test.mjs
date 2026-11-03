import test from 'node:test';
import assert from 'node:assert/strict';
import { verificationFindings } from '../../site/src/viewer/verification.js';

test('viewer findings bind diagnostics to explicit current part/hardware identities', () => {
  const report = {
    schemaVersion: 1,
    claims: [
      {
        id: 'gap',
        status: 'fail',
        configurations: ['pose'],
        message: 'Collision',
        entities: [{ part: 'arm', copy: 2 }, { hardware: 'shaft' }, { part: 'stale' }],
        measurements: { phase: 0.5 },
      },
      {
        id: 'other',
        status: 'fail',
        configurations: ['other'],
        message: 'Other case',
        entities: [],
      },
      {
        id: 'pass',
        status: 'pass',
        configurations: ['pose'],
        message: 'Scoped pass',
        entities: [],
      },
    ],
  };
  const findings = verificationFindings({ kind: 'report', report }, 'pose', [
    { part: 'arm', copy: 2 },
    { hardware: 'shaft' },
  ]);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].references, [{ part: 'arm', copy: 2 }, { hardware: 'shaft' }]);
  assert.equal(findings[0].measurements.phase, 0.5);
  assert.deepEqual(verificationFindings(null, 'pose', []), []);
});
