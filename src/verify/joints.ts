// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import { invert, type Vec3 } from '../assembly.js';
import { intersection } from '../geometry.js';
import {
  EPS,
  apply,
  bounds,
  boundaryLength,
  clipRectangle,
  dot,
  edgeDistance,
  holesAt,
  length,
  materialGuard,
  netArea,
  normal,
  orthogonal,
  pointSegment,
  project,
  rectangular,
  relative,
  sub,
} from './geometry.js';
import { findHardware, findPart } from './spec.js';
import type {
  CapturedShaftClaim,
  ClaimResult,
  GlueContactClaim,
  Interval,
  MaterialProfile,
  SnapshotHardware,
  SnapshotPart,
  TabSlotClaim,
  VerificationSnapshot,
  VerificationSpec,
} from './types.js';

type Check = Pick<ClaimResult, 'status' | 'code' | 'message'> &
  Partial<Pick<ClaimResult, 'measurements' | 'assumptions' | 'coverage'>>;
const fail = (message: string, measurements: ClaimResult['measurements'] = {}): Check => ({
  status: 'fail',
  code: 'joint-condition-failed',
  message,
  measurements,
});
export const unknown = (message: string): Check => ({
  status: 'unverified',
  code: 'unsupported-evidence',
  message,
});
const pass = (
  message: string,
  measurements: ClaimResult['measurements'],
  assumptions: string[] = [],
  coverage: ClaimResult['coverage'] = 'nominal',
): Check => ({
  status: 'pass',
  code: 'conditions-satisfied',
  message,
  measurements,
  assumptions,
  coverage,
});
const profile = (spec: VerificationSpec, p: SnapshotPart): MaterialProfile | undefined =>
  spec.materials && Object.prototype.hasOwnProperty.call(spec.materials, p.material)
    ? spec.materials[p.material]
    : undefined;
const thickness = (spec: VerificationSpec, p: SnapshotPart): Interval =>
  profile(spec, p)?.thickness ?? [p.thickness, p.thickness];
// External material shrinks as actual kerf exceeds compensated kerf.
function externalError(spec: VerificationSpec, p: SnapshotPart): Interval {
  const m = profile(spec, p);
  if (!m) return [0, 0];
  if (p.kerf === null) return [-Infinity, Infinity];
  return [p.kerf - m.kerf[1] - 2 * (m.edgeError ?? 0), p.kerf - m.kerf[0] + 2 * (m.edgeError ?? 0)];
}
const inRange = (actual: Interval, wanted: Interval) =>
  actual[0] >= wanted[0] + EPS && actual[1] <= wanted[1] - EPS;
const outside = (actual: Interval, wanted: Interval) =>
  actual[0] < wanted[0] - EPS || actual[1] > wanted[1] + EPS;
const guards = (...ps: SnapshotPart[]) => ps.map(materialGuard).find(Boolean);

export function glueContact(c: GlueContactClaim, s: VerificationSnapshot): Check {
  const a = findPart(s, c.a),
    b = findPart(s, c.b);
  if (a === b) return fail('A glue contact needs two different physical instances.');
  const guard = guards(a, b);
  if (guard) return unknown(guard);
  const m = relative(a, b),
    za = c.faceA === 'top' ? a.thickness : 0,
    zb = c.faceB === 'top' ? b.thickness : 0;
  if (Math.hypot(m[8], m[9]) > 1e-9) return fail('The selected faces are not parallel.');
  const gap = Math.abs(m[11] + m[10] * zb - za);
  if (gap > EPS) return fail('The selected faces are separated.', { faceGap: gap });
  if (gap > 1e-7)
    return unknown(
      'Face separation is within numerical uncertainty; exact contact is not established.',
    );
  const signA = c.faceA === 'top' ? 1 : -1,
    signB = c.faceB === 'top' ? 1 : -1;
  if (signA * signB * m[10] > -1 + 1e-7)
    return fail('The selected surfaces face the same way, rather than meeting.');
  const projected = project(b.regions, m, zb),
    overlap = netArea(intersection(a.regions, projected));
  const areaUncertainty = EPS * (boundaryLength(a.regions) + boundaryLength(projected));
  const measurements = {
    contactArea: overlap,
    requiredArea: c.minimumArea,
    faceGap: gap,
    areaUncertainty,
  };
  if (overlap < c.minimumArea - areaUncertainty)
    return fail('There is insufficient geometric glue contact.', measurements);
  if (overlap < c.minimumArea + areaUncertainty)
    return { ...unknown('Contact area is on the numerical acceptance boundary.'), measurements };
  return pass('The selected nominal faces have the required geometric contact.', measurements, [
    'Rigid flat faces and a zero-thickness adhesive layer.',
    'This checks nominal contact geometry; adhesive strength, stock variation and durability are not established.',
  ]);
}

export function tabSlot(c: TabSlotClaim, s: VerificationSnapshot, spec: VerificationSpec): Check {
  const tab = findPart(s, c.tab),
    receiver = findPart(s, c.receiver);
  if (tab === receiver)
    return fail('A tongue and its receiving panel must be different instances.');
  const guard = guards(tab, receiver);
  if (guard) return unknown(guard);
  const m = relative(receiver, tab);
  if (!orthogonal(m) || Math.abs(m[10]) > EPS)
    return unknown('Only orthogonal tab/slot geometry is supported.');
  const feature = clipRectangle(tab.regions, c.region);
  if (!rectangular(feature)) return unknown('The selected tongue is not one solid rectangle.');
  const [x0, y0, x1, y1] = bounds(feature);
  // A selector cannot manufacture a fictitious small tab by cropping a
  // larger solid. At most one edge may continue into its parent body.
  const d = 4 * EPS,
    inset = EPS;
  const adjoining = [
    [x0 - d, y0 + inset, x0, y1 - inset],
    [x1, y0 + inset, x1 + d, y1 - inset],
    [x0 + inset, y0 - d, x1 - inset, y0],
    [x0 + inset, y1, x1 - inset, y1 + d],
  ].map((r) => netArea(clipRectangle(tab.regions, r)) > EPS * EPS);
  const roots = adjoining.flatMap((has, i) => (has ? [i] : []));
  if (roots.length > 1)
    return unknown(
      'The selector crops through multiple material edges; it does not identify a physical tongue.',
    );
  if (roots.length && Math.abs(roots[0] < 2 ? m[8] : m[9]) < 0.5)
    return unknown('The tongue must join its parent along the insertion direction.');
  let shoulder: { z: number; outward: number } | undefined;
  if (roots.length) {
    const edge = roots[0],
      rootPoint: Vec3 =
        edge < 2
          ? [edge === 0 ? x0 : x1, (y0 + y1) / 2, 0]
          : [(x0 + x1) / 2, edge === 2 ? y0 : y1, 0];
    const rootZ = apply(m, rootPoint)[2];
    const outward = (edge < 2 ? m[8] : m[9]) * (edge % 2 === 0 ? -1 : 1);
    shoulder = { z: rootZ, outward };
  }
  const points: Vec3[] = [];
  for (const x of [x0, x1])
    for (const y of [y0, y1]) for (const z of [0, tab.thickness]) points.push(apply(m, [x, y, z]));
  const lo = [0, 1, 2].map((k) => Math.min(...points.map((p) => p[k]))),
    hi = [0, 1, 2].map((k) => Math.max(...points.map((p) => p[k])));
  const holes = holesAt(receiver.regions, [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2]);
  if (!holes.length) return fail('The receiving panel has no closed slot at the tongue.');
  if (holes.length !== 1 || !rectangular([holes[0]]))
    return unknown('The receiving feature must be an unambiguous rectangular closed slot.');
  const slot = holes[0],
    box = bounds([slot]),
    tabErrors = externalError(spec, tab),
    recErrors = externalError(spec, receiver);
  if (![...tabErrors, ...recErrors].every(Number.isFinite))
    return unknown('Compensated kerf metadata is needed for manufacturing bounds.');
  const measured: ClaimResult['measurements'] = {};
  let boundary = false;
  for (let k = 0; k < 2; k++) {
    const usesThickness = Math.abs(m[k * 4 + 2]) > 0.5;
    const tabSize: Interval = usesThickness
      ? thickness(spec, tab)
      : [hi[k] - lo[k] + tabErrors[0], hi[k] - lo[k] + tabErrors[1]];
    const slotSize = box[k + 2] - box[k];
    const gap: Interval = [
      slotSize - recErrors[1] - tabSize[1],
      slotSize - recErrors[0] - tabSize[0],
    ];
    measured[k ? 'clearanceY' : 'clearanceX'] = gap;
    if (outside(gap, c.clearance))
      return fail('Tab/slot clearance is outside the required range.', measured);
    boundary ||= !inRange(gap, c.clearance);
    let actualLo = lo[k],
      actualHi = hi[k];
    if (usesThickness) {
      if (m[k * 4 + 2] > 0) actualHi += tabSize[1] - tab.thickness;
      else actualLo -= tabSize[1] - tab.thickness;
    } else {
      actualLo -= Math.max(0, tabErrors[1]) / 2;
      actualHi += Math.max(0, tabErrors[1]) / 2;
    }
    const sideGap =
      Math.min(actualLo - box[k], box[k + 2] - actualHi) - Math.max(0, recErrors[1]) / 2;
    measured[k ? 'minimumSideGapY' : 'minimumSideGapX'] = sideGap;
    if (sideGap < -EPS) return fail('The tongue is offset into the edge of its slot.', measured);
    if (sideGap < EPS) boundary = true;
  }
  // The feature must select the physical tongue tip, not an arbitrary slice
  // through a longer plate. Kerf erosion conservatively shortens that tongue.
  const zLoss = Math.max(0, -tabErrors[0]) / 2;
  const actualReceiver = thickness(spec, receiver);
  if (c.flushTolerance >= actualReceiver[0] - EPS)
    return unknown('flushTolerance must be smaller than the receiving thickness.');
  const engaged = Math.max(
    0,
    Math.min(hi[2] - zLoss, actualReceiver[1]) - Math.max(lo[2] + zLoss, 0),
  );
  const required = actualReceiver[1] - c.flushTolerance;
  measured.engagement = engaged;
  measured.requiredEngagement = required;
  if (engaged <= EPS) return fail('The tongue does not engage the receiving panel.', measured);
  if (engaged < required - EPS)
    return fail('The tongue does not engage through the receiving panel.', measured);
  if (engaged < required + EPS) boundary = true;
  if (
    shoulder &&
    ((shoulder.outward > 0 && shoulder.z < actualReceiver[1] - EPS) ||
      (shoulder.outward < 0 && shoulder.z > EPS))
  )
    return fail(
      'The tongue shoulder intrudes into the receiving panel under the declared thickness bounds.',
      measured,
    );
  const ligament =
    Math.min(...receiver.regions.filter((r) => r !== slot).map((r) => edgeDistance(slot, r))) -
    Math.max(0, -recErrors[0]);
  measured.minimumLigament = ligament;
  if (ligament < c.minimumLigament - EPS)
    return fail('Too little material remains around the slot.', measured);
  if (ligament < c.minimumLigament + EPS) boundary = true;
  if (boundary)
    return {
      ...unknown('A fit condition is on its numerical acceptance boundary.'),
      measurements: measured,
    };
  return pass(
    'The rectangular tongue fits and engages its receiving slot.',
    measured,
    [
      'Rigid orthogonal parts; nominal placements are held fixed while finished dimensions vary.',
      'The selected local rectangle must identify the physical tongue; this fit does not establish retention.',
    ],
    profile(spec, tab) || profile(spec, receiver) ? 'bounded-fit' : 'nominal',
  );
}

interface AxialPart {
  part: SnapshotPart;
  lo: number;
  hi: number;
  hole: Interval;
}
interface Axis {
  start: Vec3;
  dir: Vec3;
  length: number;
  diameter: number;
}
function axis(h: SnapshotHardware): Axis | null {
  const d = sub(h.to, h.from),
    l = length(d);
  return typeof h.size === 'number' && l > EPS
    ? { start: h.from, dir: d.map((v) => v / l) as Vec3, length: l, diameter: h.size }
    : null;
}
function coaxial(a: Axis, h: SnapshotHardware): boolean {
  const b = axis(h);
  if (!b) return false;
  if (
    length([
      a.dir[1] * b.dir[2] - a.dir[2] * b.dir[1],
      a.dir[2] * b.dir[0] - a.dir[0] * b.dir[2],
      a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0],
    ]) > 1e-9
  )
    return false;
  const v = sub(b.start, a.start),
    q = dot(v, a.dir);
  return length(v.map((x, k) => x - q * a.dir[k]) as Vec3) < EPS;
}
const axial = (a: Axis, p: Vec3) => dot(sub(p, a.start), a.dir);
const range = (a: Axis, h: SnapshotHardware): Interval =>
  [axial(a, h.from), axial(a, h.to)].sort((x, y) => x - y) as Interval;

function bore(a: Axis, p: SnapshotPart): AxialPart | string {
  const n = normal(p.matrix);
  if (
    dot(n, a.dir) < 0 ||
    length([
      n[1] * a.dir[2] - n[2] * a.dir[1],
      n[2] * a.dir[0] - n[0] * a.dir[2],
      n[0] * a.dir[1] - n[1] * a.dir[0],
    ]) > 1e-9
  )
    return 'Bearing and stack faces have an unsupported orientation; their normals must follow the shaft.';
  const local = apply(invert(p.matrix), a.start),
    at: [number, number] = [local[0], local[1]];
  const holes = holesAt(p.regions, at);
  if (!holes.length) return 'No bore surrounds the shaft axis.';
  if (holes.length !== 1) return 'The bore selector is ambiguous.';
  // The mean of a regular polygon's corners is its centre; its bounding
  // box's middle is not when the corners are odd in number
  const hole = holes[0],
    corners =
      hole.length > 1 &&
      hole[0][0] === hole[hole.length - 1][0] &&
      hole[0][1] === hole[hole.length - 1][1]
        ? hole.slice(0, -1)
        : hole,
    center: [number, number] = [
      corners.reduce((t, q) => t + q[0], 0) / corners.length,
      corners.reduce((t, q) => t + q[1], 0) / corners.length,
    ];
  if (Math.hypot(center[0] - at[0], center[1] - at[1]) > EPS)
    return 'The shaft is not centered in the bore.';
  const radii = hole.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1]));
  if (Math.max(...radii) - Math.min(...radii) > EPS)
    return 'The bore is not a supported circular polygon.';
  const min = Math.min(...hole.map((p, i) => pointSegment(at, p, hole[(i + 1) % hole.length])));
  const max = Math.max(...hole.map((p) => Math.hypot(p[0] - at[0], p[1] - at[1])));
  const z0 = axial(a, apply(p.matrix, [0, 0, 0])),
    z1 = axial(a, apply(p.matrix, [0, 0, p.thickness]));
  return { part: p, lo: Math.min(z0, z1), hi: Math.max(z0, z1), hole: [2 * min, 2 * max] };
}

export function capturedShaft(
  c: CapturedShaftClaim,
  s: VerificationSnapshot,
  spec: VerificationSpec,
): Check {
  const shaft = findHardware(s, c.shaft),
    a = axis(shaft);
  if (!a) return unknown('The shaft must have a nonzero cylindrical physical envelope.');
  const refs = [...c.bearings, ...c.stack];
  const keys = refs.map((r) => JSON.stringify([r.part, r.copy ?? 1]));
  if (new Set(keys).size !== keys.length)
    return fail('Bearing and stack references must name distinct physical parts.');
  const parts = refs.map((r) => findPart(s, r)),
    guard = guards(...parts);
  if (guard) return unknown(guard);
  const measured: ClaimResult['measurements'] = { shaftDiameter: a.diameter };
  const bodies: AxialPart[] = [];
  let boundary = false;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i],
      b = bore(a, p);
    if (typeof b === 'string')
      return /unsupported|supported/.test(b) ? unknown(`${p.name}: ${b}`) : fail(`${p.name}: ${b}`);
    const errors = externalError(spec, p);
    if (!errors.every(Number.isFinite))
      return unknown('Kerf metadata is required for bore tolerance bounds.');
    const gap: Interval = [b.hole[0] - errors[1] - a.diameter, b.hole[1] - errors[0] - a.diameter];
    measured[`clearance${i + 1}`] = gap;
    if (outside(gap, c.clearance))
      return fail(`${p.name}: shaft/bore clearance is outside the required range.`, measured);
    boundary ||= !inRange(gap, c.clearance);
    if (b.lo < -EPS || b.lo + thickness(spec, p)[1] > a.length + EPS)
      return fail(`${p.name}: the shaft does not extend through this part.`, measured);
    bodies.push(b);
  }
  const bearings = bodies.slice(0, 2).sort((a, b) => a.lo - b.lo),
    stack = bodies.slice(2).sort((a, b) => a.lo - b.lo);
  if (
    bearings.some((b) => thickness(spec, b.part).some((t) => Math.abs(t - b.part.thickness) > EPS))
  )
    return unknown(
      'Bearing thickness variation changes retainer seating. A bounded axial seating model is required for capture.',
    );
  if (bearings[0].hi > bearings[1].lo - EPS)
    return fail('Bearing panels overlap or leave no stack cavity.');
  for (let i = 0; i < stack.length; i++) {
    if (
      stack[i].lo < bearings[0].hi - EPS ||
      stack[i].hi > bearings[1].lo + EPS ||
      (i && stack[i - 1].hi > stack[i].lo + EPS)
    )
      return fail('The axial stack overlaps another component or its supports.');
  }
  // Correlated lots: cavity = separation of nominal bearing origins minus
  // the inward first panel thickness. Stack thicknesses are positive terms.
  const cavity = bearings[1].lo - bearings[0].lo;
  const consuming = [bearings[0].part, ...stack.map((b) => b.part)];
  const sums = consuming
    .map((p) => thickness(spec, p))
    .reduce((n, t) => [n[0] + t[0], n[1] + t[1]] as Interval, [0, 0] as Interval);
  const endplay: Interval = [cavity - sums[1], cavity - sums[0]];
  measured.endplay = endplay;
  if (outside(endplay, c.endplay))
    return fail('The axial stack has insufficient or excessive endplay.', measured);
  boundary ||= !inRange(endplay, c.endplay);
  const assumptions = [
    'Ideal cylindrical hardware at its declared dimensions. Hardware diameter/length variation, strength and loosening are not established.',
  ];
  // Stops pair with the bearings by where they are along the shaft, not by
  // the order the specification lists them in
  const stops = c.stops
    .map((stop) => ({ stop, h: findHardware(s, stop.body) }))
    .map((o) => ({ ...o, at: o.h && coaxial(a, o.h) ? range(a, o.h) : undefined }));
  if (stops.some((o) => !o.at)) return fail('A retainer is not coaxial with the shaft.');
  stops.sort((x, y) => x.at![0] + x.at![1] - (y.at![0] + y.at![1]));
  for (let i = 0; i < 2; i++) {
    const { stop, h } = stops[i];
    if (!coaxial(a, h)) return fail('A retainer is not coaxial with the shaft.');
    const d = axis(h)!,
      r = range(a, h),
      bearing = bearings[i];
    const inward = i === 0 ? r[1] : r[0],
      surface = i === 0 ? bearing.lo : bearing.hi;
    const gap = i === 0 ? surface - inward : inward - surface;
    measured[`stopGap${i + 1}`] = gap;
    const errors = externalError(spec, bearing.part);
    const overlap = (d.diameter - (bearing.hole[1] - errors[0])) / 2;
    measured[`stopOverlap${i + 1}`] = overlap;
    if (gap < -EPS || gap > c.maximumStopGap + EPS)
      return fail('A retainer is misplaced relative to the outside bearing face.', measured);
    if (gap < -1e-7 || gap > c.maximumStopGap + 1e-7) boundary = true;
    if (overlap < c.minimumOverlap - EPS)
      return fail('A retainer can pass through its bearing opening.', measured);
    if (overlap < c.minimumOverlap + EPS) boundary = true;
    const attachment = stop.attachment;
    if (attachment.kind === 'unknown')
      return {
        ...unknown('The stop is present but its fastening is unverified.'),
        measurements: measured,
      };
    if (attachment.kind === 'integral') {
      // Only support a head at the physical start/end of this shaft.
      if (Math.min(Math.abs(inward), Math.abs(inward - a.length)) > EPS)
        return fail('An integral head must meet an end of its shaft.', measured);
      assumptions.push('The specified head and shaft are one integral purchased component.');
    } else {
      const thread = findHardware(s, attachment.thread);
      if (!coaxial(a, thread)) return fail('The threaded attachment is off the shaft axis.');
      if (axis(thread)!.diameter > a.diameter + EPS)
        return fail('The declared threaded section exceeds the shaft envelope.');
      const tr = range(a, thread),
        engaged = Math.max(0, Math.min(r[1], tr[1]) - Math.max(r[0], tr[0]));
      if (tr[0] < -EPS || tr[1] > a.length + EPS)
        return fail('The usable threaded section lies outside the physical shaft.', measured);
      measured.threadEngagement = engaged;
      if (engaged < attachment.minimumEngagement - EPS)
        return fail('The threaded stop has insufficient declared thread engagement.', measured);
      if (engaged < attachment.minimumEngagement + EPS) boundary = true;
      if (!attachment.secured)
        return {
          ...unknown(
            'Thread overlap exists but installation/securement of the retainer is unverified.',
          ),
          measurements: measured,
        };
      assumptions.push(
        'The specified usable thread envelope and matching nut are installed and secured as declared; thread form/capacity and resistance to loosening are not verified.',
      );
    }
  }
  if (boundary)
    return {
      ...unknown('A shaft condition is on its numerical acceptance boundary.'),
      measurements: measured,
    };
  return pass(
    'The declared shaft has local bearing clearance, axial endplay and geometric end capture.',
    measured,
    assumptions,
    parts.some((p) => profile(spec, p)) ? 'bounded-fit' : 'nominal',
  );
}
