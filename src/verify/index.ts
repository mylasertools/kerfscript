// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import { geometryEqual, EPS, length, sub } from './geometry.js';
import { capturedShaft, glueContact, tabSlot, unknown } from './joints.js';
import { assemblyAccess, motionClearance, rigidClearance } from './motion.js';
import {
  assemblySupport,
  continuousJoints,
  jointConstraints,
  retention,
  stability,
} from './mechanics.js';
import { WorkBudget } from './solids.js';
import { findPart, refs, validateSnapshots, validateSpec } from './spec.js';
import type {
  BodyRef,
  ClaimResult,
  VerificationClaim,
  VerificationIssue,
  VerificationReport,
  VerificationResult,
  VerificationSnapshot,
  VerificationSpec,
  VerifyLimits,
} from './types.js';

export { snapshotFromRender, type SnapshotContext } from './snapshot.js';
export { poseAssembly } from './pose.js';
export type * from './types.js';

/** Compare an archived report with freshly captured input fingerprints and the
 * complete current requirements. Callers must hash the actual loaded bytes. */
export function verificationIsCurrent(
  report: VerificationReport,
  specification: VerificationSpec,
  snapshots: VerificationSnapshot[],
): boolean {
  if (
    !report ||
    report.schemaVersion !== 1 ||
    report.algorithm !== 'kerf-rigid-v1' ||
    report.numericalTolerance !== EPS ||
    validateSpec(specification).length ||
    validateSnapshots(snapshots).length ||
    snapshots.some((s) => s.error !== undefined || !s.provenance) ||
    !Array.isArray(report.inputs)
  )
    return false;
  const canonical = (value: unknown): string =>
    JSON.stringify(value, (_, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, v[k]]),
          )
        : v,
    );
  try {
    const inputs = snapshots.map((s) => ({
      configuration: s.configuration,
      params: s.params,
      renderSettings: s.renderSettings,
      provenance: s.provenance,
    }));
    const sorted = (v: VerificationReport['inputs']) =>
      [...v].sort((a, b) => a.configuration.localeCompare(b.configuration));
    return (
      canonical(specification) === canonical(report.specification) &&
      canonical(sorted(inputs)) === canonical(sorted(report.inputs))
    );
  } catch {
    return false;
  }
}

/** Verify declarative requirements against captured geometry. This function does
 * no rendering, filesystem access or execution of expressions in a specification. */
export function verify(
  input: unknown,
  inputs: unknown,
  limits: VerifyLimits = {},
): VerificationResult {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits))
    return {
      kind: 'invalid-spec',
      issues: [{ code: 'invalid-limits', message: 'Verification limits must be an object.' }],
    };
  const invalid = validateSpec(input);
  if (invalid.length) return { kind: 'invalid-spec', issues: invalid };
  const invalidSnapshots = validateSnapshots(inputs);
  if (invalidSnapshots.length) return { kind: 'invalid-snapshot', issues: invalidSnapshots };
  const spec = input as VerificationSpec,
    snapshots = inputs as VerificationSnapshot[];
  const issues: VerificationIssue[] = [];
  for (const [name, n] of Object.entries(limits))
    if (
      !['maxPoints', 'maxClaims', 'maxConfigurations', 'maxOperations'].includes(name) ||
      !Number.isSafeInteger(n) ||
      !(n > 0)
    )
      issues.push({
        code: 'invalid-limits',
        path: `limits.${name}`,
        message: 'Verification limits must be positive safe integers.',
      });
  if (issues.length) return { kind: 'invalid-spec', issues };
  const report: VerificationReport = {
    schemaVersion: 1,
    model: spec.model,
    status: 'unverified',
    algorithm: 'kerf-rigid-v1',
    numericalTolerance: EPS,
    specification: JSON.parse(JSON.stringify(spec)),
    claims: [],
    inputs: JSON.parse(
      JSON.stringify(
        snapshots.map((s) => ({
          configuration: s.configuration,
          params: s.params,
          renderSettings: s.renderSettings,
          provenance: s.provenance,
        })),
      ),
    ),
    uncovered: [
      'Physical strength, friction, wear, actual gear/cam driving contact and fastening durability.',
      'Flexible bodies and unsupported closed-loop/contact dynamics.',
      'Bodies and parameter regions outside the explicitly declared claim scopes.',
    ],
  };
  const points = snapshots.reduce(
    (n, s) =>
      n +
      s.hardware.reduce((n, h) => n + (typeof h.size === 'number' ? 128 : 8), 0) +
      s.parts.reduce(
        (n, p) =>
          n +
          p.regions.reduce((n, r) => n + r.length, 0) +
          (p.cutLines ?? []).reduce((n, r) => n + r.length, 0),
        0,
      ),
    0,
  );
  if (
    points > (limits.maxPoints ?? 200000) ||
    spec.claims.length > (limits.maxClaims ?? 1000) ||
    spec.configurations.length > (limits.maxConfigurations ?? 100)
  ) {
    report.claims.push(
      base('$resource-limit', 'resource-limit', true, [], {
        status: 'unverified',
        code: 'resource-limit',
        message:
          'The verification input exceeds its point, claim or configuration budget. No mechanical conclusions were reached.',
      }),
    );
    return { kind: 'report', report };
  }
  const declared = new Set(spec.configurations.map((c) => c.id));
  for (const s of snapshots)
    if (!declared.has(s.configuration))
      issues.push({
        code: 'unknown-configuration',
        message: `Snapshot ${s.configuration} is not declared.`,
      });
  for (const s of snapshots) {
    const expected = spec.configurations.find((c) => c.id === s.configuration)?.params ?? {};
    for (const [key, v] of Object.entries(expected))
      if (JSON.stringify(s.params[key]) !== JSON.stringify(v))
        issues.push({
          code: 'configuration-mismatch',
          message: `${s.configuration}: captured parameter ${key} differs from its required value.`,
        });
  }
  const claimsById = new Map(spec.claims.map((c) => [c.id, c]));
  for (const { claim, ref } of refs(spec)) {
    const c = claimsById.get(claim)!;
    for (const s of snapshots.filter(
      (s) =>
        s.error === undefined && (!c.configurations || c.configurations.includes(s.configuration)),
    )) {
      const found =
        'part' in ref
          ? s.parts.filter((p) => p.name === ref.part && p.copy === (ref.copy ?? 1))
          : s.hardware.filter((h) => h.label === ref.hardware);
      if (found.length !== 1)
        issues.push({
          code: 'ambiguous-reference',
          path: `claims.${claim}`,
          message: `${s.configuration}: ${JSON.stringify(ref)} resolves to ${found.length} instances; exactly one is required.`,
        });
    }
  }
  if (issues.length) return { kind: 'invalid-spec', issues };
  for (const config of spec.configurations) {
    const s = snapshots.find((s) => s.configuration === config.id);
    const valid = s && s.error === undefined;
    report.claims.push(
      base(
        `$configuration:${config.id}`,
        'configuration',
        true,
        [config.id],
        valid
          ? {
              status: 'pass',
              code: 'configuration-rendered',
              message: 'The required configuration rendered.',
            }
          : {
              status: 'fail',
              code: 'configuration-unavailable',
              message:
                s?.error ||
                'A required configuration snapshot is missing or failed without a diagnostic.',
            },
      ),
    );
    if (!valid) continue;
    report.claims.push(
      base(
        `$provenance:${config.id}`,
        'provenance',
        true,
        [config.id],
        s.provenance
          ? {
              status: 'pass',
              code: 'provenance-recorded',
              message: 'Source, engine, dependency and font fingerprints are recorded.',
            }
          : {
              status: 'unverified',
              code: 'missing-provenance',
              message:
                'Supply exact source/engine fingerprints and dependency/font maps before archiving a verified result.',
            },
      ),
    );
    if (s.warnings.length)
      report.claims.push(
        base(`$compiler:${config.id}`, 'compiler-diagnostics', true, [config.id], {
          status: 'unverified',
          code: 'compiler-warnings',
          message: s.warnings.join('\n'),
        }),
      );
    if (s.legacyHardware)
      report.claims.push(
        base(`$legacy:${config.id}`, 'hardware-inventory', true, [config.id], {
          status: 'unverified',
          code: 'legacy-hardware',
          message:
            'echo hardware is not authoritative physical inventory. Migrate it to native hardware before verification.',
        }),
      );
  }
  const budget = new WorkBudget(limits.maxOperations);
  const priority = (c: VerificationClaim) =>
    c.kind === 'retention'
      ? 3
      : c.kind === 'stability' || c.kind === 'assembly-support'
        ? 4
        : c.kind === 'motion-clearance' || c.kind === 'assembly-access'
          ? 2
          : c.kind === 'joint-constraints'
            ? 1
            : 0;
  const ordered = [...spec.claims].sort((a, b) => priority(a) - priority(b));
  for (const claim of ordered) {
    const cases = claim.configurations ?? spec.configurations.map((c) => c.id);
    if (claim.kind === 'cut-invariant') {
      const set = cases.map((id) => snapshots.find((s) => s.configuration === id));
      report.claims.push(
        base(
          claim.id,
          claim.kind,
          claim.required !== false,
          cases,
          set.some((s) => !s || s.error !== undefined)
            ? unknown('A required configuration is unavailable.')
            : invariant(set as VerificationSnapshot[]),
        ),
      );
      continue;
    }
    if (claim.kind === 'motion-clearance') {
      const from = snapshots.find((s) => s.configuration === claim.from),
        to = snapshots.find((s) => s.configuration === claim.to);
      let result: Partial<ClaimResult>;
      if (!from || !to || from.error !== undefined || to.error !== undefined)
        result = unknown('Motion endpoints are unavailable.');
      else
        try {
          result = { status: 'pass' };
          if (claim.constraints) {
            const joint = spec.claims.find((c) => c.id === claim.constraints);
            const checked = report.claims.filter((c) => c.id === claim.constraints);
            if (
              !joint ||
              joint.kind !== 'joint-constraints' ||
              !checked.length ||
              checked.some((c) => c.status !== 'pass') ||
              ![claim.from, claim.to].every((id) =>
                checked.some((c) => c.configurations.includes(id)),
              )
            )
              result = unknown('The motion needs verified endpoint joint constraints.');
            else {
              const reference = snapshots.find(
                (s) =>
                  s.configuration ===
                  (joint.configurations ?? spec.configurations.map((c) => c.id))[0],
              )!;
              result = continuousJoints(claim, joint, from, reference);
            }
          }
          if (result.status === 'pass') {
            const installed: import('./relations.js').FixedPair[] = [];
            for (const r of spec.claims)
              if (r.kind === 'retention')
                for (const l of r.links) {
                  const q = spec.claims.find((q) => q.id === l.claim);
                  if (
                    l.installed &&
                    l.fastening === 'glued' &&
                    q?.kind === 'glue-contact' &&
                    [claim.from, claim.to].every((id) =>
                      report.claims.some(
                        (p) =>
                          p.id === q.id && p.configurations.includes(id) && p.status === 'pass',
                      ),
                    )
                  )
                    installed.push({ a: q.a, b: q.b });
                }
            result = motionClearance(claim, from, to, budget, installed);
          }
        } catch (e) {
          result = {
            status: 'unverified',
            code: 'geometry-unresolved',
            message: (e as Error).message,
          };
        }
      report.claims.push(
        base(
          claim.id,
          claim.kind,
          claim.required !== false,
          [claim.from, claim.to],
          result,
          entities(claim),
        ),
      );
      continue;
    }
    for (const id of cases) {
      const s = snapshots.find((s) => s.configuration === id);
      const overrides = spec.configurations.find((c) => c.id === id)?.materials;
      const caseSpec = overrides
        ? { ...spec, materials: { ...spec.materials, ...overrides } }
        : spec;
      let result: Partial<ClaimResult>;
      if (!s || s.error !== undefined) result = unknown('The configuration is unavailable.');
      else
        try {
          switch (claim.kind) {
            case 'glue-contact':
              result = glueContact(claim, s);
              break;
            case 'tab-slot':
              result = tabSlot(claim, s, caseSpec);
              break;
            case 'captured-shaft':
              result = capturedShaft(claim, s, caseSpec);
              break;
            case 'material-assignment':
              result = materials(s, caseSpec);
              break;
            case 'rigid-clearance':
              result = rigidClearance(claim, s, budget);
              break;
            case 'assembly-access':
              result = assemblyAccess(claim, s, budget);
              break;
            case 'joint-constraints': {
              const reference = snapshots.find((s) => s.configuration === cases[0]);
              result =
                reference && reference.error === undefined
                  ? jointConstraints(claim, s, reference, budget, spec, report.claims)
                  : unknown('The kinematic reference configuration is unavailable.');
              break;
            }
            case 'retention':
              result = retention(claim, s, spec, report.claims);
              break;
            case 'stability':
              result = stability(claim, s, budget, report.claims, spec);
              break;
            case 'assembly-support':
              result = assemblySupport(claim, s, spec, report.claims);
              break;
            default:
              result = unknown(
                `The ${claim.kind} capability is not implemented; it cannot inherit a geometric-fit pass.`,
              );
          }
        } catch (e) {
          result = {
            status: 'unverified',
            code: 'geometry-unresolved',
            message: `The geometric check could not complete: ${(e as Error).message}`,
          };
        }
      report.claims.push(
        base(claim.id, claim.kind, claim.required !== false, [id], result, entities(claim)),
      );
    }
  }
  const required = report.claims.filter((c) => c.required);
  report.status = required.some((c) => c.status === 'fail')
    ? 'fail'
    : required.some((c) => c.status === 'unverified')
      ? 'unverified'
      : 'pass';
  for (const [kind, description] of [
    ['retention', 'Retention of permanent inventory.'],
    ['stability', 'Static stability under declared masses and gravity.'],
    ['assembly-access', 'Authored insertion and tool access paths.'],
    ['assembly-support', 'Support throughout the installation sequence.'],
    ['motion-clearance', 'Continuous nominal operating motion clearance.'],
    ['joint-constraints', 'Mechanism constraints and intended mobility.'],
  ]) {
    const checked = report.claims.filter((c) => c.kind === kind && c.required);
    const covered = new Set(
      checked.filter((c) => c.status === 'pass').flatMap((c) => c.configurations),
    );
    if (
      !checked.length ||
      checked.some((c) => c.status !== 'pass') ||
      spec.configurations.some((c) => !covered.has(c.id))
    )
      report.uncovered.push(description);
  }
  return { kind: 'report', report };
}

function base(
  id: string,
  kind: string,
  required: boolean,
  configurations: string[],
  result: Partial<ClaimResult>,
  entities: BodyRef[] = [],
): ClaimResult {
  return {
    id,
    kind,
    required,
    configurations,
    status: 'unverified',
    code: 'unverified',
    message: '',
    entities,
    measurements: {},
    assumptions: [],
    coverage: 'none',
    ...result,
  };
}
function entities(c: VerificationClaim): BodyRef[] {
  if (c.kind === 'glue-contact') return [c.a, c.b];
  if (c.kind === 'tab-slot') return [c.tab, c.receiver];
  if (c.kind === 'captured-shaft')
    return [c.shaft, ...c.bearings, ...c.stack, ...c.stops.map((s) => s.body)];
  if (c.kind === 'rigid-clearance') return c.bodies ?? [];
  if (c.kind === 'motion-clearance') return c.moving.map((m) => m.body);
  if (c.kind === 'assembly-access') return [...c.initial, ...c.steps.map((s) => s.part)];
  if (c.kind === 'retention') return c.roots;
  if (c.kind === 'stability') return c.loads.map((l) => l.body);
  if (c.kind === 'joint-constraints') return c.bodies;
  return [];
}
function invariant(snapshots: VerificationSnapshot[]): Partial<ClaimResult> {
  if (snapshots.length < 2)
    return unknown('Cut invariance needs at least two declared configurations.');
  const initial = snapshots[0];
  if (!initial.parts.length && !initial.hardware.length)
    return unknown('There is no physical inventory to compare.');
  if (snapshots.some((s) => s.parts.some((p) => p.cutLines === null || p.kerf === null)))
    return unknown('Full nominal cutting-line and kerf metadata is required for invariance.');
  if (snapshots.some((s) => s.legacyHardware || s.hardware.some((h) => !h.label)))
    return unknown('Cross-pose hardware requires unique native labels.');
  for (const s of snapshots) {
    const labels = s.hardware.map((h) => h.label);
    if (new Set(labels).size !== labels.length)
      return unknown('Hardware labels are ambiguous across operating poses.');
    if (s.parts.length !== initial.parts.length || s.hardware.length !== initial.hardware.length)
      return {
        status: 'fail',
        code: 'inventory-changed',
        message: 'Operating motion changed the manufacturing inventory.',
      };
    for (const p of initial.parts) {
      const q = findPart(s, { part: p.name, copy: p.copy });
      if (!q || !geometryEqual(p, q))
        return {
          status: 'fail',
          code: 'cut-geometry-changed',
          message: `Operating motion changed cut geometry/material for ${p.name} copy ${p.copy}.`,
        };
    }
    for (const h of initial.hardware) {
      const q = s.hardware.find((q) => q.label === h.label);
      if (
        !q ||
        h.kind !== q.kind ||
        JSON.stringify(h.size) !== JSON.stringify(q.size) ||
        Math.abs(length(sub(h.to, h.from)) - length(sub(q.to, q.from))) > EPS
      )
        return {
          status: 'fail',
          code: 'hardware-changed',
          message: `Operating motion changed hardware ${h.label}.`,
        };
    }
  }
  return {
    status: 'pass',
    code: 'cuts-invariant',
    message: 'Nominal cut regions, cut lines, materials and inventory agree at the declared poses.',
    coverage: 'discrete',
    assumptions: [
      'This checks the declared configurations only; it does not bound behavior between samples.',
    ],
  };
}
function materials(s: VerificationSnapshot, spec: VerificationSpec): Partial<ClaimResult> {
  if (!s.parts.length) return unknown('There are no sheet parts to assign a stock profile.');
  for (const p of s.parts) {
    const m =
      spec.materials && Object.prototype.hasOwnProperty.call(spec.materials, p.material)
        ? spec.materials[p.material]
        : undefined;
    if (!m) return unknown(`No measured material profile is assigned to ${p.material || p.name}.`);
    if (p.thickness < m.thickness[0] - EPS || p.thickness > m.thickness[1] + EPS)
      return {
        status: 'fail',
        code: 'material-mismatch',
        message: `${p.name}: design thickness is outside the assigned stock profile.`,
      };
    if (p.kerf === null) return unknown('Compensation metadata is unavailable.');
  }
  return {
    status: 'pass',
    code: 'materials-assigned',
    message: 'Every sheet part has a measured profile containing its nominal design thickness.',
    coverage: 'bounded-fit',
  };
}
