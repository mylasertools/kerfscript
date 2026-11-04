// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import { invert, multiply } from '../assembly.js';
import { apply, EPS, geometryEqual, length, sub } from './geometry.js';
import { findHardware, findPart } from './spec.js';
import { unknown } from './joints.js';
import {
  allBodies,
  bodyMatrix,
  distanceBounds,
  identity,
  key,
  linearSeparated,
  makeSolid,
  sameTrajectory,
  speedBound,
  trajectoryMatrix,
  transformSolid,
  type Solid,
  WorkBudget,
} from './solids.js';
import { nativeFixedPairs, type FixedPair } from './relations.js';
import type {
  AssemblyClaim,
  BodyRef,
  ClaimResult,
  ClearanceClaim,
  MotionClaim,
  Trajectory,
  VerificationSnapshot,
} from './types.js';

type Check = Partial<ClaimResult>;
const failed = (
  message: string,
  measurements: ClaimResult['measurements'] = {},
  entities: BodyRef[] = [],
): Check => ({ status: 'fail', code: 'interference', message, measurements, entities });
const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < EPS);
function build(s: VerificationSnapshot, refs: BodyRef[], budget: WorkBudget): Solid[] {
  if (new Set(refs.map(key)).size !== refs.length)
    throw new Error('A physical body appears more than once in this scope.');
  return refs.map((r) => makeSolid(s, r, budget));
}
export function rigidClearance(
  c: ClearanceClaim,
  s: VerificationSnapshot,
  budget: WorkBudget,
): Check {
  const solids = build(s, c.bodies ?? allBodies(s), budget);
  if (solids.length < 2) return unknown('Rigid clearance requires at least two physical bodies.');
  let minimum = Infinity;
  for (let i = 0; i < solids.length; i++)
    for (let j = i + 1; j < solids.length; j++) {
      const d = distanceBounds(solids[i], solids[j], budget, c.minimumGap);
      minimum = Math.min(minimum, d.lower);
      if (d.penetration || d.upper < c.minimumGap - EPS)
        return failed(
          'Physical bodies interfere or violate the required clearance.',
          { gapUpper: d.upper },
          [solids[i].ref, solids[j].ref],
        );
      if (!(d.lower > c.minimumGap || (c.minimumGap === 0 && d.touchSafe)))
        return {
          ...unknown('The clearance is within geometric or hardware-envelope uncertainty.'),
          entities: [solids[i].ref, solids[j].ref],
        };
    }
  return {
    status: 'pass',
    code: 'rigid-clearance',
    message: 'Nominal physical envelopes satisfy the declared clearance.',
    coverage: 'nominal',
    measurements: { minimumGapLower: minimum },
    assumptions: [
      'Rigid nominal dimensions; contact forces, manufacturing variation and strength are separate checks.',
    ],
  };
}
interface Moving {
  solid: Solid;
  trajectory: Trajectory;
}
function sweep(
  moving: Moving[],
  fixed: Solid[],
  gap: number,
  budget: WorkBudget,
  maxIntervals = 1000,
): Check {
  const stationary = (solid: Solid): Moving => ({
    solid,
    trajectory: { kind: 'translate', by: [0, 0, 0] },
  });
  function* pairs() {
    for (let i = 0; i < moving.length; i++) {
      for (const f of fixed) yield { a: moving[i], b: stationary(f) };
      for (let j = i + 1; j < moving.length; j++) yield { a: moving[i], b: moving[j] };
    }
  }
  let intervals = 0;
  for (const { a, b } of pairs()) {
    budget.tick();
    const pose = (m: Moving, u: number) =>
      transformSolid(m.solid, trajectoryMatrix(m.trajectory, u));
    if (sameTrajectory(a.trajectory, b.trajectory)) {
      const d = distanceBounds(a.solid, b.solid, budget, gap);
      if (d.penetration || d.upper < gap - EPS)
        return failed(
          'Bodies moving together violate their required clearance.',
          { gapUpper: d.upper },
          [a.solid.ref, b.solid.ref],
        );
      if (d.lower > gap || (gap === 0 && d.touchSafe)) continue;
      return {
        ...unknown('The fixed relative clearance is within geometric uncertainty.'),
        entities: [a.solid.ref, b.solid.ref],
      };
    }
    if (
      a.trajectory.kind === 'translate' &&
      b.trajectory.kind === 'translate' &&
      linearSeparated(
        pose(a, 0),
        pose(a, 1),
        pose(b, 0),
        pose(b, 1),
        gap === 0 ? 0 : gap + EPS,
        budget,
      )
    )
      continue;
    const speed = speedBound(a.solid, a.trajectory) + speedBound(b.solid, b.trajectory);
    const queue: [number, number][] = [[0, 1]];
    while (queue.length) {
      if (++intervals > maxIntervals)
        return {
          ...unknown('Continuous clearance interval budget exhausted.'),
          measurements: { intervals },
          entities: [a.solid.ref, b.solid.ref],
        };
      budget.tick();
      const [lo, hi] = queue.shift()!,
        u = (lo + hi) / 2,
        movement = (speed * (hi - lo)) / 2;
      const d = distanceBounds(pose(a, u), pose(b, u), budget, gap + movement);
      if (d.penetration || d.upper < gap - EPS)
        return failed(
          'The specified path has physical interference.',
          { phase: u, gapUpper: d.upper },
          [a.solid.ref, b.solid.ref],
        );
      if (d.lower - movement > gap) continue;
      if (hi - lo < 1e-9)
        return {
          ...unknown('Continuous contact is within numerical uncertainty.'),
          measurements: { phase: [lo, hi] },
          entities: [a.solid.ref, b.solid.ref],
        };
      queue.push([lo, u], [u, hi]);
    }
  }
  return {
    status: 'pass',
    code: 'continuous-clearance',
    message: 'The specified rigid path is clear over its full interval.',
    coverage: 'continuous-nominal',
    measurements: { intervals },
    assumptions: [
      'Analytic rigid trajectories and nominal geometry; the mechanism must separately satisfy its joint constraints.',
    ],
  };
}
function inventoryInvariant(a: VerificationSnapshot, b: VerificationSnapshot): string | null {
  if (a.parts.length !== b.parts.length || a.hardware.length !== b.hardware.length)
    return 'The physical inventory changes between motion endpoints.';
  for (const p of a.parts) {
    const q = b.parts.find((q) => q.name === p.name && q.copy === p.copy);
    if (!q || p.cutLines === null || q.cutLines === null || !geometryEqual(p, q))
      return 'Full cut geometry must remain invariant throughout an operating motion.';
    if (
      JSON.stringify([p.stack, p.glue, p.glueFace, p.on]) !==
      JSON.stringify([q.stack, q.glue, q.glueFace, q.on])
    )
      return 'Installed native glue/stack relationships change during the operating motion.';
  }
  for (const h of a.hardware) {
    const q = b.hardware.find((q) => q.label === h.label);
    if (
      !h.label ||
      !q ||
      h.kind !== q.kind ||
      JSON.stringify(h.size) !== JSON.stringify(q.size) ||
      Math.abs(length(sub(h.to, h.from)) - length(sub(q.to, q.from))) > EPS
    )
      return 'Hardware identities and dimensions must remain invariant.';
  }
  return null;
}
export function motionClearance(
  c: MotionClaim,
  from: VerificationSnapshot,
  to: VerificationSnapshot,
  budget: WorkBudget,
  installed: FixedPair[] = [],
): Check {
  if (
    !from.relationsKnown ||
    !to.relationsKnown ||
    [...from.parts, ...to.parts].some((p) => p.cutLines === null || p.kerf === null)
  )
    return unknown(
      'Motion requires complete cutting and native attachment metadata at both endpoints.',
    );
  const invariant = inventoryInvariant(from, to);
  if (invariant) return { status: 'fail', code: 'motion-inventory', message: invariant };
  const refs = allBodies(from),
    set = new Set(c.moving.map((m) => key(m.body)));
  if (set.size !== c.moving.length)
    return failed('A body has conflicting simultaneous trajectories.');
  const control = (r: BodyRef): Trajectory =>
    c.moving.find((m) => key(m.body) === key(r))?.trajectory ?? {
      kind: 'translate',
      by: [0, 0, 0],
    };
  for (const pair of [...nativeFixedPairs(from), ...installed]) {
    const before = multiply(invert(bodyMatrix(from, pair.a)), bodyMatrix(from, pair.b)),
      after = multiply(invert(bodyMatrix(to, pair.a)), bodyMatrix(to, pair.b));
    if (!close(before, after) || !sameTrajectory(control(pair.a), control(pair.b)))
      return failed('The operating path moves an installed glue bond or laminated stack.', {}, [
        pair.a,
        pair.b,
      ]);
  }
  for (const r of refs) {
    const t = c.moving.find((m) => key(m.body) === key(r))?.trajectory;
    const change = t ? trajectoryMatrix(t, 1) : identity();
    if ('part' in r) {
      if (!close(multiply(change, bodyMatrix(from, r)), bodyMatrix(to, r)))
        return failed('A trajectory does not match the rendered destination pose.', {}, [r]);
    } else {
      const a = findHardware(from, r),
        b = findHardware(to, r);
      // Scalar cylinders are radially symmetric; their endpoints define their pose.
      if (typeof a.size === 'number') {
        if (!close(apply(change, a.from), b.from) || !close(apply(change, a.to), b.to))
          return failed('A hardware trajectory does not match its rendered endpoints.', {}, [r]);
      } else if (!close(multiply(change, bodyMatrix(from, r)), bodyMatrix(to, r)))
        return failed('A box trajectory does not match its rendered destination.', {}, [r]);
    }
  }
  return sweep(
    c.moving.map((m) => ({ solid: makeSolid(from, m.body, budget), trajectory: m.trajectory })),
    build(
      from,
      refs.filter((r) => !set.has(key(r))),
      budget,
    ),
    c.minimumGap,
    budget,
    c.maxIntervals,
  );
}

export function assemblyAccess(
  c: AssemblyClaim,
  s: VerificationSnapshot,
  budget: WorkBudget,
): Check {
  const refs = c.scope ?? allBodies(s),
    scope = new Set(refs.map(key));
  const installed = new Map(c.initial.map((r) => [key(r), makeSolid(s, r, budget)]));
  if (
    scope.size !== refs.length ||
    installed.size !== c.initial.length ||
    c.initial.some((r) => !scope.has(key(r)))
  )
    return failed('Assembly scope and initial inventory must be unique and consistent.');
  const steps = new Set<string>();
  let intervals = 0;
  for (const step of c.steps) {
    if (steps.has(step.id) || !scope.has(key(step.part)) || installed.has(key(step.part)))
      return failed('An assembly step duplicates or misidentifies a required installation.');
    steps.add(step.id);
    if (!step.held)
      return {
        ...unknown(`Step ${step.id} needs an explicit temporary holding/support assumption.`),
        assemblyStep: step.id,
      };
    const target = makeSolid(s, step.part, budget),
      moving = transformSolid(target, trajectoryMatrix({ kind: 'translate', by: step.from }, 1));
    const result = sweep(
      [
        {
          solid: moving,
          trajectory: {
            kind: 'translate',
            by: step.from.map((x) => -x) as [number, number, number],
          },
        },
      ],
      [...installed.values()],
      c.minimumGap,
      budget,
      c.maxIntervals,
    );
    if (result.status !== 'pass')
      return {
        ...result,
        assemblyStep: step.id,
        message: `Assembly step ${step.id}: ${result.message}`,
      };
    intervals += (result.measurements?.intervals as number) ?? 0;
    installed.set(key(step.part), target);
    if (step.tool) {
      let label = '$verification-tool';
      while (s.hardware.some((h) => h.label === label)) label += ':';
      const fake: VerificationSnapshot = {
        ...s,
        hardware: [
          ...s.hardware,
          {
            label,
            kind: 'tool',
            from: step.tool.from,
            to: step.tool.to,
            size: step.tool.diameter,
            up: [0, 1, 0],
          },
        ],
      };
      const tool = makeSolid(fake, { hardware: label }, budget);
      const start = transformSolid(
        tool,
        trajectoryMatrix({ kind: 'translate', by: step.tool.travel }, 1),
      );
      const access = sweep(
        [
          {
            solid: start,
            trajectory: {
              kind: 'translate',
              by: step.tool.travel.map((x) => -x) as [number, number, number],
            },
          },
        ],
        [...installed.values()],
        0,
        budget,
        c.maxIntervals,
      );
      if (access.status !== 'pass')
        return {
          ...access,
          assemblyStep: step.id,
          message: `Tool access at step ${step.id}: ${access.message}`,
        };
    }
  }
  if (installed.size !== scope.size)
    return failed('The procedure omits required physical inventory.');
  return {
    status: 'pass',
    code: 'assembly-access',
    message: 'Every scoped body has one clear authored insertion, with checked tool paths.',
    coverage: 'continuous-nominal',
    measurements: { installed: installed.size, intervals },
    assumptions: [
      'The initial body is already supported; an operator/fixture holds each incoming body during insertion. Retention and stability after installation are separate required claims.',
    ],
  };
}
