// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import { invert, multiply, type Vec3 } from '../assembly.js';
import {
  EPS,
  apply,
  dot,
  length,
  materialGuard,
  pointSegment,
  signedArea,
  sub,
} from './geometry.js';
import { glueContact, unknown } from './joints.js';
import { nativeFixedPairs } from './relations.js';
import { allBodies, bodyMatrix, cross, key, makeSolid, scale, unit, WorkBudget } from './solids.js';
import { findPart } from './spec.js';
import type {
  AssemblySupportClaim,
  BodyRef,
  ClaimResult,
  JointClaim,
  MotionClaim,
  RetentionClaim,
  StabilityClaim,
  Trajectory,
  VerificationSnapshot,
  VerificationSpec,
} from './types.js';

type Check = Partial<ClaimResult>;
const fail = (message: string, measurements: ClaimResult['measurements'] = {}): Check => ({
  status: 'fail',
  code: 'mechanical-condition-failed',
  message,
  measurements,
});
const vector = (m: number[], v: Vec3): Vec3 =>
  [0, 1, 2].map((i) => m[i * 4] * v[0] + m[i * 4 + 1] * v[1] + m[i * 4 + 2] * v[2]) as Vec3;
const origin = (m: number[]): Vec3 => [m[3], m[7], m[11]];
const basis = (axis: Vec3): [Vec3, Vec3] => {
  const a = unit(axis),
    p = unit(cross(a, Math.abs(a[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
  return [p, cross(a, p)];
};
const angle = (m: number[], initial: number[], axis: Vec3) => {
  const v = basis(axis)[0],
    x = unit(vector(initial, v)),
    y = unit(vector(m, v)),
    n = unit(vector(initial, axis));
  return (Math.atan2(dot(n, cross(x, y)), dot(x, y)) * 180) / Math.PI;
};

export function retention(
  c: RetentionClaim,
  s: VerificationSnapshot,
  spec: VerificationSpec,
  results: ClaimResult[],
): Check {
  const inventory = allBodies(s),
    permanent = new Set(inventory.map(key));
  for (const r of c.removable ?? []) permanent.delete(key(r));
  if (c.roots.some((r) => !permanent.has(key(r))))
    return fail('A retention root cannot be excluded as removable.');
  const graph = new Map<string, Set<string>>();
  const link = (refs: BodyRef[]) => {
    for (const a of refs)
      for (const b of refs) {
        const k = key(a),
          g = graph.get(k) ?? new Set<string>();
        g.add(key(b));
        graph.set(k, g);
      }
  };
  const assumptions = [
    'Roots are supported as declared; specified adhesive/fastener installations are performed. Strength and durability are separate claims.',
  ];
  for (const l of c.links) {
    const claim = spec.claims.find((q) => q.id === l.claim),
      result = results.find((q) => q.id === l.claim && q.configurations.includes(s.configuration));
    if (!claim || !result)
      return unknown(`Retention depends on unavailable geometric claim ${l.claim}.`);
    if (result.status === 'fail')
      return fail(`Attachment ${l.claim} fails its geometric contract.`);
    if (result.status !== 'pass') return unknown(`Attachment ${l.claim} has not been verified.`);
    if (!l.installed) return fail(`The fastening for ${l.claim} is explicitly not installed.`);
    if (claim.kind === 'glue-contact' && l.fastening === 'glued') {
      link([claim.a, claim.b]);
      assumptions.push(
        `A cured fixed adhesive bond is assumed at ${l.claim}; only its contact geometry was measured.`,
      );
    } else if (claim.kind === 'captured-shaft' && l.fastening === 'captured') {
      const bodies: BodyRef[] = [
        claim.shaft,
        ...claim.bearings,
        ...claim.stack,
        ...claim.stops.map((x) => x.body),
      ];
      claim.stops.forEach((stop) => {
        if (stop.attachment.kind === 'threaded') bodies.push(stop.attachment.thread);
      });
      link(bodies);
    } else
      return unknown(
        `Fit or kinematic claim ${l.claim} does not prove the specified positive fastening.`,
      );
  }
  const reached = new Set(c.roots.map(key)),
    queue = [...reached];
  while (queue.length)
    for (const next of graph.get(queue.pop()!) ?? [])
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
  const missing = inventory.filter((r) => permanent.has(key(r)) && !reached.has(key(r)));
  if (missing.length)
    return {
      ...fail('Permanent components lack validated retention to a declared root.'),
      entities: missing,
    };
  return {
    status: 'pass',
    code: 'retention-covered',
    message:
      'Every permanent component is retained to a root under the checked fastening assumptions.',
    coverage: 'nominal',
    measurements: {
      permanentComponents: permanent.size,
      removableComponents: c.removable?.length ?? 0,
    },
    assumptions,
  };
}

function centroid(s: VerificationSnapshot, r: BodyRef): Vec3 {
  if ('hardware' in r) {
    const m = bodyMatrix(s, r),
      h = s.hardware.find((h) => h.label === r.hardware)!;
    return apply(m, [0, 0, length(sub(h.to, h.from)) / 2]);
  }
  const p = findPart(s, r),
    guard = materialGuard(p);
  if (guard) throw new Error(guard);
  let area = 0,
    x = 0,
    y = 0;
  for (const ring of p.regions) {
    const [ox, oy] = ring[0];
    let a = 0,
      cx = 0,
      cy = 0;
    for (let i = 0; i < ring.length; i++) {
      const u = ring[i],
        v = ring[(i + 1) % ring.length],
        ux = u[0] - ox,
        uy = u[1] - oy,
        vx = v[0] - ox,
        vy = v[1] - oy;
      const k = ux * vy - vx * uy;
      a += k;
      cx += (ux + vx) * k;
      cy += (uy + vy) * k;
    }
    if (Math.abs(a) < 1e-12) continue;
    const actual = signedArea(ring);
    area += actual;
    x += (ox + cx / (3 * a)) * actual;
    y += (oy + cy / (3 * a)) * actual;
  }
  if (area <= EPS * EPS) throw new Error('Material centroid is numerically unresolved.');
  return apply(p.matrix, [x / area, y / area, p.thickness / 2]);
}
function hull(points: [number, number][]): [number, number][] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (a: number[], b: number[], c: number[]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const chain = (pts: [number, number][]) => {
    const out: [number, number][] = [];
    for (const p of pts) {
      while (out.length > 1 && turn(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    return out;
  };
  const lower = chain(sorted),
    upper = chain([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
export function stability(
  c: StabilityClaim,
  s: VerificationSnapshot,
  budget: WorkBudget,
  results: ClaimResult[] = [],
  spec?: VerificationSpec,
): Check {
  const inventory = allBodies(s),
    loadKeys = c.loads.map((l) => key(l.body));
  if (
    new Set(loadKeys).size !== loadKeys.length ||
    inventory.some((r) => !loadKeys.includes(key(r)))
  )
    return unknown('Stability needs one declared positive mass for every physical component.');
  if (inventory.length > 1) {
    const attached = results.find(
        (r) => r.id === c.retention && r.configurations.includes(s.configuration),
      ),
      contract = spec?.claims.find((r) => r.id === c.retention);
    if (
      !attached ||
      attached.status !== 'pass' ||
      !contract ||
      contract.kind !== 'retention' ||
      contract.removable?.length
    )
      return unknown(
        'Combined-load stability needs verified retention of every load; removable-contact support is not established.',
      );
  }
  let mass = 0,
    center: Vec3 = [0, 0, 0];
  for (const l of c.loads) {
    const p = l.center ? apply(bodyMatrix(s, l.body), l.center) : centroid(s, l.body);
    mass += l.mass;
    center = center.map((x, i) => x + l.mass * p[i]) as Vec3;
  }
  if (!Number.isFinite(mass) || !center.every(Number.isFinite))
    return unknown('Mass/centroid calculation exceeds its numerical range.');
  center = scale(center, 1 / mass);
  const contacts: [number, number][] = [];
  for (const ref of inventory) {
    const solid = makeSolid(s, ref, budget);
    const lower = Math.min(...solid.inner.flatMap((c) => c.vertices.map((p) => p[2])));
    const outerLower = Math.min(...solid.outer.flatMap((c) => c.vertices.map((p) => p[2])));
    if (lower < c.ground - EPS) return fail('A physical component penetrates the ground plane.');
    if (outerLower < c.ground - EPS)
      return unknown('Ground penetration is within physical-envelope uncertainty.');
    if (!c.supports.some((r) => key(r) === key(ref))) continue;
    if (Math.abs(lower - c.ground) > 1e-8)
      return unknown('Ground contact is separated or within physical-envelope uncertainty.');
    for (const cell of solid.inner)
      for (const p of cell.vertices)
        if (Math.abs(p[2] - c.ground) < 1e-8) contacts.push([p[0], p[1]]);
  }
  const polygon = hull(contacts);
  if (polygon.length < 3)
    return unknown('Ground contacts do not establish a finite support polygon.');
  const travel = (c.ground - center[2]) / c.gravity[2],
    projected: [number, number] = [
      center[0] + travel * c.gravity[0],
      center[1] + travel * c.gravity[1],
    ];
  let margin = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      side = (b[0] - a[0]) * (projected[1] - a[1]) - (b[1] - a[1]) * (projected[0] - a[0]);
    const d = pointSegment(projected, a, b);
    margin = Math.min(margin, side < 0 ? -d : d);
  }
  const measurements = {
    supportMargin: margin,
    mass,
    centerX: center[0],
    centerY: center[1],
    centerZ: center[2],
  };
  if (margin < c.minimumMargin - EPS)
    return fail('The gravity line lies outside the required support margin.', measurements);
  if (margin < c.minimumMargin + EPS)
    return { ...unknown('Stability is on its numerical support boundary.'), measurements };
  return {
    status: 'pass',
    code: 'static-stability',
    message: 'The declared mass/gravity case lies within the measured support polygon.',
    coverage: 'nominal',
    measurements,
    assumptions: [
      'The loads form one retained rigid assembly; declared masses are correct. Unspecified centers assume uniform material. Sliding resistance, impact and structural strength are not established.',
    ],
  };
}

export function assemblySupport(
  c: AssemblySupportClaim,
  s: VerificationSnapshot,
  spec: VerificationSpec,
  results: ClaimResult[],
): Check {
  const plan = spec.claims.find((p) => p.id === c.plan),
    retained = spec.claims.find((p) => p.id === c.retention);
  const checked = (id: string) =>
    results.find((r) => r.id === id && r.configurations.includes(s.configuration));
  if (
    !plan ||
    plan.kind !== 'assembly-access' ||
    !retained ||
    retained.kind !== 'retention' ||
    checked(c.plan)?.status !== 'pass' ||
    checked(c.retention)?.status !== 'pass'
  )
    return unknown('Assembly support needs verified insertion and retention contracts.');
  if (retained.removable?.length)
    return unknown('Per-step support of removable objects needs an explicit contact model.');
  const roots = new Set(retained.roots.map(key)),
    installed = new Set(plan.initial.map(key));
  if (plan.initial.some((r) => !roots.has(key(r))))
    return unknown('The initial subassembly needs a declared grounded support.');
  const groups = new Map<string, BodyRef[]>();
  for (const l of retained.links) {
    const q = spec.claims.find((q) => q.id === l.claim);
    if (q?.kind === 'glue-contact') groups.set(l.claim, [q.a, q.b]);
    else if (q?.kind === 'captured-shaft') {
      const refs: BodyRef[] = [q.shaft, ...q.bearings, ...q.stack, ...q.stops.map((x) => x.body)];
      q.stops.forEach((x) => {
        if (x.attachment.kind === 'threaded') refs.push(x.attachment.thread);
      });
      groups.set(l.claim, refs);
    }
  }
  const fastened = new Set<string>(),
    steps = new Set(plan.steps.map((s) => s.id));
  if (
    c.holds?.some((h) => !steps.has(h.step)) ||
    new Set(c.holds?.map((h) => h.step)).size !== (c.holds?.length ?? 0)
  )
    return fail('Temporary holds must identify unique existing assembly steps.');
  const reachable = () => {
    const graph = new Map<string, Set<string>>();
    for (const id of fastened)
      for (const a of groups.get(id) ?? [])
        for (const b of groups.get(id) ?? []) {
          const g = graph.get(key(a)) ?? new Set<string>();
          g.add(key(b));
          graph.set(key(a), g);
        }
    const seen = new Set([...roots].filter((r) => installed.has(r))),
      queue = [...seen];
    while (queue.length)
      for (const next of graph.get(queue.pop()!) ?? [])
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    return seen;
  };
  for (const step of plan.steps) {
    installed.add(key(step.part));
    for (const id of step.fasten ?? []) {
      const bodies = groups.get(id);
      if (!bodies) return fail(`Step ${step.id} names an unknown fastening.`);
      if (bodies.some((r) => !installed.has(key(r))))
        return fail(`Step ${step.id} fastens a joint before all its components are installed.`);
      fastened.add(id);
    }
    const held = new Set((c.holds?.find((h) => h.step === step.id)?.bodies ?? []).map(key));
    if ([...held].some((r) => !installed.has(r)))
      return fail(`Step ${step.id} holds an uninstalled body.`);
    const connected = reachable();
    if ([...installed].some((r) => !connected.has(r) && !held.has(r)))
      return fail(`Step ${step.id} releases a component before it is retained or supported.`);
  }
  if ([...installed].some((r) => !reachable().has(r)))
    return fail('The final assembly still relies on temporary holding.');
  return {
    status: 'pass',
    code: 'assembly-support',
    message:
      'Installed components remain rooted or explicitly held at every step; final temporary supports are released.',
    coverage: 'discrete',
    assumptions: [
      'The measured attachment contracts and their declared installation/cure assumptions hold. Operator holds are provided exactly as specified.',
    ],
  };
}

function matrixRank(input: number[][]): { rank: number; uncertain: boolean } {
  const a = input.map((row) => {
    const n = Math.max(...row.map(Math.abs), 1e-20);
    return row.map((v) => v / n);
  });
  let rank = 0,
    uncertain = false;
  for (let col = 0; col < (a[0]?.length ?? 0) && rank < a.length; col++) {
    let pivot = rank;
    for (let r = rank + 1; r < a.length; r++)
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    const size = Math.abs(a[pivot][col]);
    if (size < 1e-10) continue;
    if (size < 1e-7) uncertain = true;
    [a[rank], a[pivot]] = [a[pivot], a[rank]];
    const p = a[rank][col];
    for (let c = col; c < a[rank].length; c++) a[rank][c] /= p;
    for (let r = rank + 1; r < a.length; r++) {
      const k = a[r][col];
      for (let c = col; c < a[r].length; c++) a[r][c] -= k * a[rank][c];
    }
    rank++;
  }
  return { rank, uncertain };
}
export function jointConstraints(
  c: JointClaim,
  s: VerificationSnapshot,
  reference: VerificationSnapshot,
  budget: WorkBudget,
  spec?: VerificationSpec,
  results: ClaimResult[] = [],
): Check {
  if (c.bodies.length > 64)
    return unknown('Joint rank checks support at most 64 scoped rigid bodies.');
  const ids = c.bodies.map(key),
    roots = c.roots.map(key);
  if (
    new Set(ids).size !== ids.length ||
    new Set(roots).size !== roots.length ||
    roots.some((r) => !ids.includes(r))
  )
    return fail('Joint bodies/roots must be unique and within scope.');
  if (
    c.roots.some((r) =>
      bodyMatrix(s, r).some((v, i) => Math.abs(v - bodyMatrix(reference, r)[i]) > EPS),
    )
  )
    return fail('A grounded kinematic root changes pose.');
  const rows: number[][] = [],
    xyz: Vec3[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  const row = () => new Array(ids.length * 6).fill(0) as number[];
  const put = (r: number[], body: BodyRef, offset: number, v: Vec3, factor = 1) => {
    const i = ids.indexOf(key(body));
    if (i < 0) throw new Error('A joint references a body outside its scope.');
    for (let k = 0; k < 3; k++) r[i * 6 + offset + k] += factor * v[k];
  };
  for (const root of c.roots)
    for (let i = 0; i < 6; i++) {
      const r = row();
      r[ids.indexOf(key(root)) * 6 + i] = 1;
      rows.push(r);
    }
  const extra = nativeFixedPairs({
    ...s,
    parts: s.parts.filter((p) => ids.includes(key({ part: p.name, copy: p.copy }))),
  });
  for (const r of spec?.claims ?? [])
    if (r.kind === 'retention')
      for (const l of r.links) {
        const q = spec!.claims.find((q) => q.id === l.claim);
        if (
          l.installed &&
          l.fastening === 'glued' &&
          q?.kind === 'glue-contact' &&
          results.some(
            (r) =>
              r.id === q.id && r.configurations.includes(s.configuration) && r.status === 'pass',
          )
        )
          extra.push({ a: q.a, b: q.b });
      }
  for (const pair of extra) {
    if (!ids.includes(key(pair.a)) && !ids.includes(key(pair.b))) continue;
    if (!ids.includes(key(pair.a)) || !ids.includes(key(pair.b)))
      return unknown('The joint scope omits a native fixed-bond host.');
    if (pair.faceA && pair.faceB && 'part' in pair.a && 'part' in pair.b) {
      const contact = glueContact(
        {
          id: '$native-bond',
          kind: 'glue-contact',
          a: pair.a,
          b: pair.b,
          faceA: pair.faceA,
          faceB: pair.faceB,
          minimumArea: EPS * EPS * 4,
        },
        s,
      );
      if (contact.status !== 'pass')
        return {
          ...contact,
          message: `A native glue/stack bond is not physically established: ${contact.message}`,
        };
    }
  }
  const relations = [
    ...c.joints,
    ...extra
      .filter((p) => ids.includes(key(p.a)) && ids.includes(key(p.b)))
      .map((p) => ({ kind: 'fixed' as const, a: p.a, b: p.b })),
  ];
  for (const j of relations) {
    budget.tick();
    if (key(j.a) === key(j.b)) return fail('A joint cannot connect a body to itself.');
    const a = bodyMatrix(s, j.a),
      b = bodyMatrix(s, j.b),
      a0 = bodyMatrix(reference, j.a),
      b0 = bodyMatrix(reference, j.b);
    const rel = multiply(invert(a), b),
      rel0 = multiply(invert(a0), b0);
    const angular = (axis: Vec3) => {
      const r = row();
      put(r, j.b, 3, axis);
      put(r, j.a, 3, axis, -1);
      rows.push(r);
    };
    const linear = (axis: Vec3, ra: Vec3, rb: Vec3) => {
      const r = row();
      put(r, j.b, 0, axis);
      put(r, j.a, 0, axis, -1);
      put(r, j.b, 3, cross(rb, axis));
      put(r, j.a, 3, cross(ra, axis), -1);
      rows.push(r);
    };
    if (j.kind === 'fixed') {
      if (rel.some((v, i) => Math.abs(v - rel0[i]) > EPS))
        return fail('A fixed joint changes its relative transform.');
      xyz.forEach((n) => angular(n));
      xyz.forEach((n) => linear(n, sub(origin(b), origin(a)), [0, 0, 0]));
    } else if (j.kind === 'revolute') {
      const pa = apply(a, j.anchorA),
        pb = apply(b, j.anchorB),
        aa = unit(vector(a, j.axisA)),
        bb = unit(vector(b, j.axisB)),
        alignment = dot(unit(vector(a0, j.axisA)), unit(vector(b0, j.axisB)));
      if (
        length(sub(pa, pb)) > EPS ||
        length(cross(aa, bb)) > 1e-7 ||
        Math.abs(dot(aa, bb) - alignment) > 1e-7
      )
        return fail('Revolute anchors or axes do not coincide.');
      if (j.range) {
        const turn = angle(rel, rel0, j.axisB);
        if (turn < j.range[0] - EPS || turn > j.range[1] + EPS)
          return fail('A revolute joint exceeds its declared angular travel.', { angle: turn });
      }
      xyz.forEach((n) => linear(n, sub(pa, origin(a)), sub(pb, origin(b))));
      basis(aa).forEach(angular);
    } else if (j.kind === 'prismatic') {
      const delta = sub(origin(rel), origin(rel0)),
        axis = unit(j.axisA),
        amount = dot(delta, axis);
      if (
        [0, 1, 2, 4, 5, 6, 8, 9, 10].some((i) => Math.abs(rel[i] - rel0[i]) > EPS) ||
        length(sub(delta, scale(axis, amount))) > EPS
      )
        return fail('A slider rotates or moves away from its guide axis.');
      if (amount < j.travel[0] - EPS || amount > j.travel[1] + EPS)
        return fail('The slider exceeds its allowed travel.', { travel: amount });
      xyz.forEach(angular);
      basis(unit(vector(a, j.axisA))).forEach((n) =>
        linear(n, sub(origin(b), origin(a)), [0, 0, 0]),
      );
    } else {
      const aa = unit(vector(a, j.axisA)),
        bb = unit(vector(b, j.axisB));
      if (
        length(cross(aa, bb)) > 1e-7 ||
        length(sub(origin(a), origin(a0))) > EPS ||
        length(sub(origin(b), origin(b0))) > EPS
      )
        return fail('The scoped gear axes/centers are not fixed and parallel.');
      const x = angle(a, a0, j.axisA),
        y = angle(b, b0, j.axisB);
      if (Math.abs(x) > 90 || Math.abs(y) > 90)
        return unknown(
          'Gear pose deltas exceed the unambiguous quarter-turn branch; add intermediate configurations.',
        );
      if (Math.abs(y + j.ratio * x) > 1e-6)
        return fail('The rendered gears do not obey their declared angular ratio.');
      const r = row();
      put(r, j.a, 3, aa, j.ratio);
      put(r, j.b, 3, bb);
      rows.push(r);
    }
  }
  budget.tick(rows.length * ids.length * 6);
  const rank = matrixRank(rows),
    dof = ids.length * 6 - rank.rank;
  if (rank.uncertain) return unknown('Constraint rank is numerically singular.');
  const measurements = {
    degreesOfFreedom: dof,
    constraintRank: rank.rank,
    redundantRows: rows.length - rank.rank,
  };
  if (dof !== c.expectedDof)
    return fail('The joint graph has unintended freedom or is overconstrained.', measurements);
  return {
    status: 'pass',
    code: 'joint-constraints',
    message: 'The scoped ideal joints satisfy their pose constraints and expected mobility.',
    coverage: 'discrete',
    measurements,
    assumptions: [
      'Ideal rigid kinematic joints at declared configurations. Gear ratio is checked on the principal quarter-turn branch; actual tooth contact, driving torque and friction are separate checks.',
    ],
  };
}

/** Algebraic trajectory checks for ideal joint trees. Closed linkage solving and
 * contact forces cannot be inferred from an authored animation. */
export function continuousJoints(
  m: MotionClaim,
  c: JointClaim,
  s: VerificationSnapshot,
  reference: VerificationSnapshot,
): Check {
  const get = (r: BodyRef): Trajectory =>
    m.moving.find((v) => key(v.body) === key(r))?.trajectory ?? {
      kind: 'translate',
      by: [0, 0, 0],
    };
  const still = (t: Trajectory) =>
    t.kind === 'translate' ? length(t.by) < 1e-9 : Math.abs(t.angle) < 1e-9;
  const same = (a: Trajectory, b: Trajectory) => {
    if (still(a) && still(b)) return true;
    if (a.kind === 'translate' && b.kind === 'translate') return length(sub(a.by, b.by)) < 1e-9;
    if (a.kind === 'rotate' && b.kind === 'rotate')
      return (
        length(sub(scale(unit(a.axis), a.angle), scale(unit(b.axis), b.angle))) < 1e-9 &&
        length(cross(sub(a.origin, b.origin), unit(a.axis))) < 1e-9
      );
    return false;
  };
  if (c.roots.some((r) => !still(get(r))))
    return fail('The analytic path moves a grounded joint root.');
  const parent = new Map<string, string>();
  for (const j of c.joints.filter((j) => j.kind !== 'gear')) {
    if (parent.has(key(j.b)))
      return unknown('Continuous joint proof requires an ideal joint tree, not a closed linkage.');
    parent.set(key(j.b), key(j.a));
  }
  for (const id of parent.keys()) {
    const seen = new Set<string>();
    let at: string | undefined = id;
    while (at && parent.has(at)) {
      if (seen.has(at)) return unknown('Continuous closed-linkage constraints need a solver.');
      seen.add(at);
      at = parent.get(at);
    }
  }
  for (const j of c.joints) {
    const a = get(j.a),
      b = get(j.b),
      ma = bodyMatrix(s, j.a),
      mb = bodyMatrix(s, j.b);
    if (j.kind === 'fixed') {
      if (!same(a, b)) return fail('The analytic path separates a fixed joint.');
      continue;
    }
    if (j.kind === 'revolute') {
      if (same(a, b)) continue;
      if (!still(a) || b.kind !== 'rotate')
        return unknown(
          'This revolute trajectory composition is not supported by the analytic joint proof.',
        );
      const anchor = apply(ma, j.anchorA),
        axis = unit(vector(ma, j.axisA)),
        rotAxis = unit(b.axis);
      if (length(cross(axis, rotAxis)) > 1e-9 || length(cross(sub(b.origin, anchor), axis)) > EPS)
        return fail('The trajectory does not rotate about the actual hinge.');
      if (j.range) {
        const rel = multiply(invert(ma), mb),
          rel0 = multiply(invert(bodyMatrix(reference, j.a)), bodyMatrix(reference, j.b)),
          start = angle(rel, rel0, j.axisB),
          end = start + b.angle * dot(unit(vector(mb, j.axisB)), rotAxis);
        if (Math.min(start, end) < j.range[0] - EPS || Math.max(start, end) > j.range[1] + EPS)
          return fail('The continuous hinge path exceeds its angular stops.');
      }
    } else if (j.kind === 'prismatic') {
      if (same(a, b)) continue;
      if (!still(a) || b.kind !== 'translate')
        return unknown('This slider trajectory composition needs a richer constraint solver.');
      const axis = unit(vector(ma, j.axisA));
      if (length(cross(b.by, axis)) > EPS)
        return fail('The analytic slider path leaves its guide.');
      const rel = multiply(invert(ma), mb),
        rel0 = multiply(invert(bodyMatrix(reference, j.a)), bodyMatrix(reference, j.b)),
        start = dot(sub(origin(rel), origin(rel0)), unit(j.axisA)),
        end = start + dot(b.by, axis);
      if (Math.min(start, end) < j.travel[0] - EPS || Math.max(start, end) > j.travel[1] + EPS)
        return fail('The continuous slider path exceeds its travel stops.');
    } else {
      const rate = (r: BodyRef, t: Trajectory, localAxis: Vec3): number | null => {
        if (still(t)) return 0;
        if (t.kind !== 'rotate') return null;
        const pose = bodyMatrix(s, r),
          axis = unit(vector(pose, localAxis));
        if (
          length(cross(unit(t.axis), axis)) > 1e-9 ||
          length(cross(sub(t.origin, origin(pose)), axis)) > EPS
        )
          return null;
        return t.angle * dot(unit(t.axis), axis);
      };
      const x = rate(j.a, a, j.axisA),
        y = rate(j.b, b, j.axisB);
      if (x === null || y === null)
        return unknown('Gear coupling needs rotations about the fixed gear axes.');
      if (Math.abs(y + j.ratio * x) > 1e-7)
        return fail('The continuous gear rotations violate their declared ratio.');
    }
  }
  return {
    status: 'pass',
    code: 'continuous-joints',
    message: 'The analytic paths obey the supported ideal joint tree and stops.',
    coverage: 'continuous-nominal',
  };
}
