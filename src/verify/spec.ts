// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import type { VerificationIssue, VerificationSnapshot, VerificationSpec } from './types.js';

const record = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonnegative = (v: unknown): v is number => number(v) && v >= 0;
const positive = (v: unknown): v is number => number(v) && v > 0;
const interval = (v: unknown, minimum = 0): boolean =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every(number) &&
  v[0] >= minimum &&
  v[1] >= v[0] &&
  v[1] <= 1e6;
const vector = (v: unknown, n: number): boolean =>
  Array.isArray(v) && v.length === n && v.every(number);
const coordinate = (v: unknown): boolean =>
  vector(v, 3) && (v as number[]).every((x) => Math.abs(x) <= 1e7);
const part = (v: unknown): boolean =>
  record(v) &&
  text(v.part) &&
  (v.copy === undefined || (Number.isInteger(v.copy) && (v.copy as number) > 0)) &&
  Object.keys(v).every((k) => ['part', 'copy'].includes(k));
const hardware = (v: unknown): boolean =>
  record(v) && text(v.hardware) && Object.keys(v).every((k) => k === 'hardware');
const body = (v: unknown) => part(v) || hardware(v);
const bodies = (v: unknown) => Array.isArray(v) && v.every(body);
const direction = (v: unknown) => coordinate(v) && Math.hypot(...(v as number[])) > 1e-9;
const trajectory = (v: unknown) =>
  record(v) &&
  ((v.kind === 'translate' && coordinate(v.by)) ||
    (v.kind === 'rotate' &&
      coordinate(v.origin) &&
      direction(v.axis) &&
      number(v.angle) &&
      Math.abs(v.angle) <= 1e6));
const hash = (v: unknown): boolean => typeof v === 'string' && /^[a-f\d]{64}$/i.test(v);
const hashMap = (v: unknown): boolean => record(v) && Object.values(v).every(hash);
const value = (v: unknown, depth = 0): boolean =>
  depth < 32 &&
  (v === undefined ||
    typeof v === 'boolean' ||
    typeof v === 'string' ||
    number(v) ||
    (Array.isArray(v) && v.every((x) => value(x, depth + 1))));
const params = (v: unknown): boolean => record(v) && Object.values(v).every((x) => value(x));
const provenance = (v: unknown): boolean =>
  v === null ||
  (record(v) &&
    hash(v.sourceHash) &&
    hash(v.engineHash) &&
    hashMap(v.dependencies) &&
    hashMap(v.fonts));

export function validateSpec(input: unknown): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const bad = (path: string, message: string) =>
    issues.push({ code: 'invalid-spec', path, message });
  if (!record(input))
    return [{ code: 'invalid-spec', message: 'The specification must be an object.' }];
  const keys = (object: Record<string, unknown>, allowed: string[], path: string) => {
    for (const key of Object.keys(object))
      if (!allowed.includes(key))
        bad(path ? `${path}.${key}` : key, 'Unknown specification field.');
  };
  keys(input, ['schemaVersion', 'model', 'configurations', 'materials', 'claims'], '');
  if (input.schemaVersion !== 1) bad('schemaVersion', 'Expected verification schemaVersion 1.');
  if (!text(input.model)) bad('model', 'Give the model a nonempty name.');
  const ids = new Set<string>();
  const profiles = (input: unknown, path: string) => {
    if (!record(input)) {
      bad(path, 'Materials must map material names to measured profiles.');
      return;
    }
    for (const [name, p] of Object.entries(input)) {
      if (
        !name ||
        !record(p) ||
        !interval(p.thickness, Number.MIN_VALUE) ||
        !interval(p.kerf) ||
        (p.edgeError !== undefined && !nonnegative(p.edgeError)) ||
        (p.lot !== undefined && !text(p.lot))
      )
        bad(
          `${path}.${name}`,
          'A profile needs positive thickness bounds, kerf bounds and optional edgeError/lot.',
        );
      if (record(p)) keys(p, ['thickness', 'kerf', 'edgeError', 'lot'], `${path}.${name}`);
    }
  };
  if (!Array.isArray(input.configurations) || !input.configurations.length)
    bad('configurations', 'Declare at least one supported configuration.');
  else
    for (const [i, c] of input.configurations.entries()) {
      if (!record(c) || !text(c.id) || (c.params !== undefined && !params(c.params)))
        bad(`configurations[${i}]`, 'Expected a unique id and finite KerfScript parameter values.');
      else if (ids.has(c.id)) bad(`configurations[${i}].id`, 'Configuration ids must be unique.');
      else {
        ids.add(c.id);
        keys(c, ['id', 'params', 'materials'], `configurations[${i}]`);
        if (c.materials !== undefined) profiles(c.materials, `configurations[${i}].materials`);
      }
    }
  if (input.materials !== undefined) profiles(input.materials, 'materials');
  if (!Array.isArray(input.claims) || !input.claims.length)
    bad('claims', 'Declare at least one required claim.');
  else {
    const names = new Set<string>();
    let required = 0;
    for (const [i, c] of input.claims.entries()) {
      const at = `claims[${i}]`;
      if (!record(c) || !text(c.id) || !text(c.kind)) {
        bad(at, 'Each claim needs an id and kind.');
        continue;
      }
      const fields: Record<string, string[]> = {
        'rigid-clearance': ['minimumGap', 'bodies'],
        'motion-clearance': ['from', 'to', 'moving', 'minimumGap', 'maxIntervals', 'constraints'],
        'assembly-access': ['initial', 'scope', 'steps', 'minimumGap', 'maxIntervals'],
        retention: ['roots', 'links', 'removable'],
        'joint-constraints': ['bodies', 'roots', 'joints', 'expectedDof'],
        stability: ['supports', 'loads', 'ground', 'gravity', 'minimumMargin', 'retention'],
        'assembly-support': ['plan', 'retention', 'holds'],
        'glue-contact': ['a', 'b', 'faceA', 'faceB', 'minimumArea'],
        'tab-slot': ['tab', 'receiver', 'region', 'clearance', 'flushTolerance', 'minimumLigament'],
        'captured-shaft': [
          'shaft',
          'bearings',
          'stack',
          'stops',
          'clearance',
          'endplay',
          'minimumOverlap',
          'maximumStopGap',
        ],
      };
      keys(
        c,
        [
          'id',
          'kind',
          'required',
          'configurations',
          ...(Object.prototype.hasOwnProperty.call(fields, c.kind) ? fields[c.kind] : []),
        ],
        at,
      );
      if (names.has(c.id)) bad(at + '.id', 'Claim ids must be unique.');
      if (c.id.startsWith('$'))
        bad(at + '.id', 'Claim ids beginning with $ are reserved for verifier diagnostics.');
      names.add(c.id);
      if (c.required !== undefined && typeof c.required !== 'boolean')
        bad(at + '.required', 'Expected a boolean.');
      if (c.required !== false) required++;
      if (
        c.configurations !== undefined &&
        (!Array.isArray(c.configurations) ||
          !c.configurations.length ||
          new Set(c.configurations).size !== c.configurations.length ||
          !c.configurations.every((x) => typeof x === 'string' && ids.has(x)))
      )
        bad(at + '.configurations', 'Reference unique declared configuration ids.');
      switch (c.kind) {
        case 'glue-contact':
          if (
            !part(c.a) ||
            !part(c.b) ||
            !['top', 'bottom'].includes(c.faceA as string) ||
            !['top', 'bottom'].includes(c.faceB as string) ||
            !positive(c.minimumArea)
          )
            bad(at, 'Glue contact needs two part faces and a positive minimumArea.');
          break;
        case 'tab-slot':
          if (
            !part(c.tab) ||
            !part(c.receiver) ||
            !vector(c.region, 4) ||
            (c.region as number[]).some((x) => Math.abs(x) > 1e6) ||
            (c.region as number[])[0] >= (c.region as number[])[2] ||
            (c.region as number[])[1] >= (c.region as number[])[3] ||
            !interval(c.clearance) ||
            !nonnegative(c.flushTolerance) ||
            !nonnegative(c.minimumLigament)
          )
            bad(
              at,
              'Tab-slot needs part references, a nonempty local rectangle, clearance bounds, flushTolerance and minimumLigament.',
            );
          break;
        case 'captured-shaft': {
          const stops = c.stops;
          if (
            !hardware(c.shaft) ||
            !Array.isArray(c.bearings) ||
            c.bearings.length !== 2 ||
            !c.bearings.every(part) ||
            !Array.isArray(c.stack) ||
            !c.stack.length ||
            !c.stack.every(part) ||
            !interval(c.clearance) ||
            !interval(c.endplay) ||
            !positive(c.minimumOverlap) ||
            !nonnegative(c.maximumStopGap) ||
            !Array.isArray(stops) ||
            stops.length !== 2
          ) {
            bad(
              at,
              'Captured shaft needs two bearings, a stack, two stops, fit/endplay bounds and overlap/gap limits.',
            );
            break;
          }
          for (const s of stops) {
            if (!record(s) || !hardware(s.body) || !record(s.attachment)) {
              bad(at + '.stops', 'Each stop needs a hardware body and attachment.');
              continue;
            }
            keys(s, ['body', 'attachment'], at + '.stops');
            const a = s.attachment;
            keys(
              a,
              a.kind === 'threaded' ? ['kind', 'thread', 'minimumEngagement', 'secured'] : ['kind'],
              at + '.stops.attachment',
            );
            if (
              !['integral', 'threaded', 'unknown'].includes(a.kind as string) ||
              (a.kind === 'threaded' &&
                (!hardware(a.thread) ||
                  !positive(a.minimumEngagement) ||
                  typeof a.secured !== 'boolean'))
            )
              bad(
                at + '.stops',
                'Threaded stops need a thread envelope, positive minimum engagement and a secured flag.',
              );
          }
          break;
        }
        case 'cut-invariant':
        case 'material-assignment':
        case 'strength':
          break;
        case 'rigid-clearance':
          if (
            !nonnegative(c.minimumGap) ||
            (c.bodies !== undefined && (!bodies(c.bodies) || !(c.bodies as unknown[]).length))
          )
            bad(at, 'Clearance requires a nonnegative gap and an optional nonempty body scope.');
          break;
        case 'motion-clearance':
          if (
            !text(c.from) ||
            !ids.has(c.from) ||
            !text(c.to) ||
            !ids.has(c.to) ||
            c.from === c.to ||
            !nonnegative(c.minimumGap) ||
            !Array.isArray(c.moving) ||
            !c.moving.length ||
            !c.moving.every((m) => record(m) && body(m.body) && trajectory(m.trajectory))
          )
            bad(
              at,
              'Motion needs from/to configuration ids, moving body trajectories and a nonnegative minimumGap.',
            );
          if (
            c.maxIntervals !== undefined &&
            (!Number.isSafeInteger(c.maxIntervals) ||
              (c.maxIntervals as number) < 1 ||
              (c.maxIntervals as number) > 10000)
          )
            bad(at, 'maxIntervals must be 1 to 10000.');
          if (c.constraints !== undefined && !text(c.constraints))
            bad(at, 'constraints must reference an ideal joint claim.');
          break;
        case 'assembly-access':
          if (
            !bodies(c.initial) ||
            (c.initial as unknown[]).length > 1 ||
            (c.scope !== undefined && (!bodies(c.scope) || !(c.scope as unknown[]).length)) ||
            !nonnegative(c.minimumGap) ||
            !Array.isArray(c.steps) ||
            !c.steps.length ||
            !c.steps.every(
              (step) =>
                record(step) &&
                text(step.id) &&
                body(step.part) &&
                coordinate(step.from) &&
                typeof step.held === 'boolean' &&
                (step.fasten === undefined ||
                  (Array.isArray(step.fasten) && step.fasten.every(text))) &&
                (step.tool === undefined ||
                  (record(step.tool) &&
                    coordinate(step.tool.from) &&
                    coordinate(step.tool.to) &&
                    positive(step.tool.diameter) &&
                    step.tool.diameter <= 1e6 &&
                    coordinate(step.tool.travel))),
            )
          )
            bad(
              at,
              'Assembly needs zero or one initial body, insertion steps with part/from/held, and a nonnegative gap.',
            );
          if (
            c.maxIntervals !== undefined &&
            (!Number.isSafeInteger(c.maxIntervals) ||
              (c.maxIntervals as number) < 1 ||
              (c.maxIntervals as number) > 10000)
          )
            bad(at, 'maxIntervals must be 1 to 10000.');
          break;
        case 'retention':
          if (
            !bodies(c.roots) ||
            !(c.roots as unknown[]).length ||
            (c.removable !== undefined && !bodies(c.removable)) ||
            !Array.isArray(c.links) ||
            !c.links.every(
              (l) =>
                record(l) &&
                text(l.claim) &&
                ['glued', 'locked', 'captured'].includes(l.fastening as string) &&
                typeof l.installed === 'boolean',
            )
          )
            bad(
              at,
              'Retention needs roots and links to measured joint claims with fastening/installed.',
            );
          break;
        case 'joint-constraints':
          if (
            !bodies(c.bodies) ||
            !(c.bodies as unknown[]).length ||
            !bodies(c.roots) ||
            !(c.roots as unknown[]).length ||
            !Number.isSafeInteger(c.expectedDof) ||
            (c.expectedDof as number) < 0 ||
            !Array.isArray(c.joints) ||
            !c.joints.every(
              (j) =>
                record(j) &&
                body(j.a) &&
                body(j.b) &&
                (j.kind === 'fixed' ||
                  (j.kind === 'revolute' &&
                    coordinate(j.anchorA) &&
                    coordinate(j.anchorB) &&
                    direction(j.axisA) &&
                    direction(j.axisB) &&
                    (j.range === undefined || interval(j.range, -1e6))) ||
                  (j.kind === 'prismatic' && direction(j.axisA) && interval(j.travel, -1e6)) ||
                  (j.kind === 'gear' &&
                    direction(j.axisA) &&
                    direction(j.axisB) &&
                    positive(j.ratio) &&
                    j.ratio <= 1e6)),
            )
          )
            bad(
              at,
              'Joint constraints need a body scope, roots, expectedDof and fixed/revolute/prismatic/gear relations.',
            );
          break;
        case 'stability':
          if (
            !bodies(c.supports) ||
            !(c.supports as unknown[]).length ||
            !Array.isArray(c.loads) ||
            !c.loads.length ||
            !number(c.ground) ||
            Math.abs(c.ground) > 1e7 ||
            !direction(c.gravity) ||
            (c.gravity as number[])[2] >= 0 ||
            !nonnegative(c.minimumMargin) ||
            !c.loads.every(
              (l) =>
                record(l) &&
                body(l.body) &&
                positive(l.mass) &&
                (l.center === undefined || coordinate(l.center)),
            )
          )
            bad(
              at,
              'Stability needs ground supports, positive masses, downward gravity and a nonnegative margin.',
            );
          break;
        case 'assembly-support':
          if (
            !text(c.plan) ||
            !text(c.retention) ||
            (c.holds !== undefined &&
              (!Array.isArray(c.holds) ||
                !c.holds.every((h) => record(h) && text(h.step) && bodies(h.bodies))))
          )
            bad(
              at,
              'Assembly support references a plan and retention contract, with optional per-step held bodies.',
            );
          break;
        default:
          bad(at + '.kind', `Unknown claim kind ${String(c.kind)}.`);
      }
      const nested = (v: unknown, allowed: string[], path: string) => {
        if (record(v)) keys(v, allowed, path);
      };
      if (c.kind === 'motion-clearance' && Array.isArray(c.moving))
        for (const [n, m] of c.moving.entries())
          if (record(m)) {
            nested(m, ['body', 'trajectory'], `${at}.moving[${n}]`);
            nested(
              m.trajectory,
              record(m.trajectory) && m.trajectory.kind === 'translate'
                ? ['kind', 'by']
                : ['kind', 'origin', 'axis', 'angle'],
              `${at}.moving[${n}].trajectory`,
            );
          }
      if (c.kind === 'assembly-access' && Array.isArray(c.steps))
        for (const [n, s] of c.steps.entries())
          if (record(s)) {
            nested(s, ['id', 'part', 'from', 'held', 'fasten', 'tool'], `${at}.steps[${n}]`);
            nested(s.tool, ['from', 'to', 'diameter', 'travel'], `${at}.steps[${n}].tool`);
          }
      if (c.kind === 'joint-constraints' && Array.isArray(c.joints))
        for (const [n, j] of c.joints.entries())
          if (record(j))
            nested(
              j,
              [
                'kind',
                'a',
                'b',
                ...(j.kind === 'revolute'
                  ? ['anchorA', 'anchorB', 'axisA', 'axisB', 'range']
                  : j.kind === 'prismatic'
                    ? ['axisA', 'travel']
                    : j.kind === 'gear'
                      ? ['axisA', 'axisB', 'ratio']
                      : []),
              ],
              `${at}.joints[${n}]`,
            );
      if (c.kind === 'retention' && Array.isArray(c.links))
        c.links.forEach((l, n) =>
          nested(l, ['claim', 'fastening', 'installed'], `${at}.links[${n}]`),
        );
      if (c.kind === 'stability' && Array.isArray(c.loads))
        c.loads.forEach((l, n) => nested(l, ['body', 'mass', 'center'], `${at}.loads[${n}]`));
      if (c.kind === 'assembly-support' && Array.isArray(c.holds))
        c.holds.forEach((h, n) => nested(h, ['step', 'bodies'], `${at}.holds[${n}]`));
    }
    if (!required) bad('claims', 'At least one claim must be required.');
    const list = input.claims.filter(record);
    for (const c of list) {
      const named = (id: unknown, kind: string) => list.some((d) => d.id === id && d.kind === kind);
      if (
        c.kind === 'motion-clearance' &&
        c.constraints !== undefined &&
        !named(c.constraints, 'joint-constraints')
      )
        bad(`claims.${String(c.id)}.constraints`, 'Reference a declared joint-constraints claim.');
      if (
        c.kind === 'assembly-support' &&
        (!named(c.plan, 'assembly-access') || !named(c.retention, 'retention'))
      )
        bad(
          `claims.${String(c.id)}`,
          'Support requires declared assembly-access and retention claims.',
        );
      // References that can be checked before rendering are input errors,
      // not failures of the design
      if (c.kind === 'assembly-support') {
        const plan = list.find((d) => d.id === c.plan && d.kind === 'assembly-access');
        const retention = list.find((d) => d.id === c.retention && d.kind === 'retention');
        const steps = new Set(
          (Array.isArray(plan?.steps) ? plan.steps : []).filter(record).map((x) => x.id),
        );
        const links = new Set(
          (Array.isArray(retention?.links) ? retention.links : [])
            .filter(record)
            .map((l) => l.claim),
        );
        if (Array.isArray(c.holds))
          for (const h of c.holds)
            if (record(h) && !steps.has(h.step))
              bad(`claims.${String(c.id)}.holds`, `Step ${String(h.step)} is not in the plan.`);
        if (plan && retention && Array.isArray(plan.steps))
          for (const st of plan.steps)
            if (record(st) && Array.isArray(st.fasten))
              for (const f of st.fasten)
                if (!links.has(f))
                  bad(
                    `claims.${String(plan.id)}.steps`,
                    `Step ${String(st.id)} fastens ${String(f)}, which is not a link of ${String(retention.id)}.`,
                  );
      }
      if (c.kind === 'cut-invariant') {
        const n = Array.isArray(c.configurations)
          ? c.configurations.length
          : Array.isArray(input.configurations)
            ? input.configurations.length
            : 0;
        if (n < 2)
          bad(`claims.${String(c.id)}`, 'cut-invariant needs at least two configurations.');
      }
      if (c.kind === 'motion-clearance' && Array.isArray(c.moving)) {
        const seen = new Set<string>();
        for (const m of c.moving)
          if (record(m)) {
            const b = record(m.body) ? m.body : {};
            const k = JSON.stringify([b.part ?? null, b.hardware ?? null, b.copy ?? 1]);
            if (seen.has(k))
              bad(`claims.${String(c.id)}.moving`, 'A body is given two trajectories.');
            seen.add(k);
          }
      }
      if (c.kind === 'stability' && c.retention !== undefined && !named(c.retention, 'retention'))
        bad(`claims.${String(c.id)}.retention`, 'Reference a declared retention claim.');
      if (c.kind === 'retention' && Array.isArray(c.links))
        for (const l of c.links)
          if (
            record(l) &&
            !list.some(
              (d) =>
                d.id === l.claim &&
                ['glue-contact', 'tab-slot', 'captured-shaft'].includes(d.kind as string),
            )
          )
            bad(
              `claims.${String(c.id)}.links`,
              'Reference a declared geometric attachment contract.',
            );
    }
  }
  return issues;
}

export function validateSnapshots(inputs: unknown): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const bad = (path: string, message: string) =>
    issues.push({ code: 'invalid-snapshot', path, message });
  if (!Array.isArray(inputs))
    return [{ code: 'invalid-snapshot', message: 'Snapshots must be an array.' }];
  const ids = new Set<string>();
  for (const [i, s] of inputs.entries()) {
    const path = `snapshots[${i}]`;
    if (
      !record(s) ||
      s.schemaVersion !== 1 ||
      !text(s.configuration) ||
      !params(s.params) ||
      !params(s.renderSettings) ||
      !provenance(s.provenance) ||
      !Array.isArray(s.parts) ||
      !Array.isArray(s.hardware) ||
      !Array.isArray(s.warnings) ||
      !s.warnings.every((x) => typeof x === 'string') ||
      typeof s.legacyHardware !== 'boolean' ||
      typeof s.relationsKnown !== 'boolean' ||
      (s.error !== undefined && typeof s.error !== 'string')
    ) {
      bad(path, 'Malformed snapshot, configuration, provenance or inventory.');
      continue;
    }
    if (ids.has(s.configuration)) bad(path, 'Configuration snapshots must be unique.');
    ids.add(s.configuration);
    const names = new Set<string>();
    for (const [j, p] of s.parts.entries()) {
      if (
        !record(p) ||
        !text(p.name) ||
        !Number.isInteger(p.copy) ||
        (p.copy as number) < 1 ||
        !positive(p.thickness) ||
        (p.glue !== undefined &&
          (!part(p.glue) || !['top', 'bottom'].includes(p.glueFace as string))) ||
        (p.stack !== undefined && (!Number.isSafeInteger(p.stack) || (p.stack as number) < 1)) ||
        (p.on !== undefined && !text(p.on)) ||
        p.thickness > 1e6 ||
        typeof p.material !== 'string' ||
        (p.kerf !== null && (!nonnegative(p.kerf) || p.kerf > 1e6)) ||
        !rigid(p.matrix) ||
        typeof p.placed !== 'boolean' ||
        !polys(p.regions, 3) ||
        !Array.isArray(p.regions) ||
        !p.regions.length ||
        (p.cutLines !== null && !polys(p.cutLines, 2)) ||
        !Array.isArray(p.bends) ||
        !p.bends.every(
          (b) => record(b) && number(b.x0) && number(b.x1) && b.x1 > b.x0 && number(b.angle),
        )
      ) {
        bad(
          `${path}.parts[${j}]`,
          'Malformed part geometry, rigid transform, material or cutting metadata.',
        );
        continue;
      }
      const key = JSON.stringify([p.name, p.copy]);
      if (names.has(key))
        bad(
          `${path}.parts[${j}]`,
          'Part name/copy references must be unique; separate definitions cannot share that reference.',
        );
      names.add(key);
    }
    for (const [j, h] of s.hardware.entries()) {
      if (
        !record(h) ||
        (h.label !== null && !text(h.label)) ||
        typeof h.kind !== 'string' ||
        !vector(h.from, 3) ||
        !vector(h.to, 3) ||
        [...(h.from as number[]), ...(h.to as number[])].some((x) => Math.abs(x) > 1e7) ||
        !coordinate(h.up) ||
        !(
          (positive(h.size) && h.size <= 1e6) ||
          (vector(h.size, 2) && (h.size as number[]).every((x) => positive(x) && x <= 1e6))
        )
      )
        bad(`${path}.hardware[${j}]`, 'Malformed hardware geometry or label.');
    }
  }
  return issues;
}

function polys(v: unknown, min: number): boolean {
  return (
    Array.isArray(v) &&
    v.every(
      (r) =>
        Array.isArray(r) &&
        r.length >= min &&
        r.every((p) => vector(p, 2) && (p as number[]).every((x) => Math.abs(x) <= 1e6)),
    )
  );
}
function rigid(v: unknown): boolean {
  if (!vector(v, 16)) return false;
  const m = v as number[],
    e = 1e-6;
  if ([m[3], m[7], m[11]].some((x) => Math.abs(x) > 1e7)) return false;
  if (Math.abs(m[12]) + Math.abs(m[13]) + Math.abs(m[14]) + Math.abs(m[15] - 1) > e) return false;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const d = m[i] * m[j] + m[4 + i] * m[4 + j] + m[8 + i] * m[8 + j];
      if (Math.abs(d - (i === j ? 1 : 0)) > e) return false;
    }
  return (
    Math.abs(
      m[0] * (m[5] * m[10] - m[6] * m[9]) -
        m[1] * (m[4] * m[10] - m[6] * m[8]) +
        m[2] * (m[4] * m[9] - m[5] * m[8]) -
        1,
    ) < e
  );
}

export function refs(
  spec: VerificationSpec,
): { claim: string; ref: import('./types.js').BodyRef }[] {
  const out: { claim: string; ref: import('./types.js').BodyRef }[] = [];
  for (const c of spec.claims) {
    const add = (r: import('./types.js').BodyRef) => out.push({ claim: c.id, ref: r });
    if (c.kind === 'glue-contact') {
      add(c.a);
      add(c.b);
    }
    if (c.kind === 'tab-slot') {
      add(c.tab);
      add(c.receiver);
    }
    if (c.kind === 'captured-shaft') {
      add(c.shaft);
      c.bearings.forEach(add);
      c.stack.forEach(add);
      c.stops.forEach((s) => {
        add(s.body);
        if (s.attachment.kind === 'threaded') add(s.attachment.thread);
      });
    }
    if (c.kind === 'rigid-clearance') c.bodies?.forEach(add);
    if (c.kind === 'motion-clearance') c.moving.forEach((m) => add(m.body));
    if (c.kind === 'assembly-access') {
      c.initial.forEach(add);
      c.scope?.forEach(add);
      c.steps.forEach((s) => add(s.part));
    }
    if (c.kind === 'retention') {
      c.roots.forEach(add);
      c.removable?.forEach(add);
    }
    if (c.kind === 'joint-constraints') {
      c.bodies.forEach(add);
      c.roots.forEach(add);
      c.joints.forEach((j) => {
        add(j.a);
        add(j.b);
      });
    }
    if (c.kind === 'stability') {
      c.supports.forEach(add);
      c.loads.forEach((l) => add(l.body));
    }
    if (c.kind === 'assembly-support') c.holds?.forEach((h) => h.bodies.forEach(add));
  }
  return out;
}
export const findPart = (s: VerificationSnapshot, r: import('./types.js').PartRef) =>
  s.parts.find((p) => p.name === r.part && p.copy === (r.copy ?? 1))!;
export const findHardware = (s: VerificationSnapshot, r: import('./types.js').HardwareRef) =>
  s.hardware.find((h) => h.label === r.hardware)!;
