// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import type { Vec3 } from '../assembly.js';
import type { Bend, Poly } from '../geometry.js';
import type { Value } from '../values.js';

export type VerificationStatus = 'pass' | 'fail' | 'unverified';
export interface PartRef {
  part: string;
  copy?: number;
}
export interface HardwareRef {
  hardware: string;
}
export type BodyRef = PartRef | HardwareRef;
export type Interval = [number, number];

/** Actual finished dimensions of one stock lot. They do not regenerate the cuts. */
export interface MaterialProfile {
  thickness: Interval;
  kerf: Interval;
  edgeError?: number;
  lot?: string;
}

export interface VerificationProvenance {
  sourceHash: string;
  engineHash: string;
  dependencies: Record<string, string>;
  fonts: Record<string, string>;
}

export interface SnapshotPart {
  name: string;
  copy: number;
  thickness: number;
  material: string;
  kerf: number | null;
  matrix: number[];
  placed: boolean;
  regions: Poly[];
  /** null means unavailable; [] means known to have no open cutting lines. */
  cutLines: Poly[] | null;
  bends: Bend[];
  stack?: number;
  glue?: PartRef;
  glueFace?: 'top' | 'bottom';
  on?: string;
}

export interface SnapshotHardware {
  label: string | null;
  kind: string;
  from: Vec3;
  to: Vec3;
  size: number | [number, number];
  up: Vec3;
}

export interface VerificationSnapshot {
  schemaVersion: 1;
  configuration: string;
  params: Record<string, Value>;
  renderSettings: Record<string, Value>;
  provenance: VerificationProvenance | null;
  parts: SnapshotPart[];
  hardware: SnapshotHardware[];
  warnings: string[];
  legacyHardware: boolean;
  relationsKnown: boolean;
  error?: string;
}

interface ClaimBase {
  id: string;
  required?: boolean;
  configurations?: string[];
}

export interface GlueContactClaim extends ClaimBase {
  kind: 'glue-contact';
  a: PartRef;
  b: PartRef;
  faceA: 'top' | 'bottom';
  faceB: 'top' | 'bottom';
  minimumArea: number;
}

export interface TabSlotClaim extends ClaimBase {
  kind: 'tab-slot';
  tab: PartRef;
  receiver: PartRef;
  /** Rectangle in the tab's local coordinates selecting its tongue. */
  region: [number, number, number, number];
  clearance: Interval;
  /** Require through engagement, allowing this much shortfall. */
  flushTolerance: number;
  minimumLigament: number;
}

export interface ShaftStop {
  body: HardwareRef;
  attachment:
    | { kind: 'integral' }
    | { kind: 'threaded'; thread: HardwareRef; minimumEngagement: number; secured: boolean }
    | { kind: 'unknown' };
}

export interface CapturedShaftClaim extends ClaimBase {
  kind: 'captured-shaft';
  shaft: HardwareRef;
  bearings: [PartRef, PartRef];
  /** Parts between the two bearing faces, including spacers and rotors. */
  stack: PartRef[];
  stops: [ShaftStop, ShaftStop];
  clearance: Interval;
  endplay: Interval;
  minimumOverlap: number;
  maximumStopGap: number;
}

export interface InvariantClaim extends ClaimBase {
  kind: 'cut-invariant';
}
export interface MaterialClaim extends ClaimBase {
  kind: 'material-assignment';
}
export type Trajectory =
  | { kind: 'translate'; by: Vec3 }
  | { kind: 'rotate'; origin: Vec3; axis: Vec3; angle: number };
export interface MotionClaim extends ClaimBase {
  kind: 'motion-clearance';
  from: string;
  to: string;
  moving: { body: BodyRef; trajectory: Trajectory }[];
  minimumGap: number;
  maxIntervals?: number;
  constraints?: string;
}
export interface ClearanceClaim extends ClaimBase {
  kind: 'rigid-clearance';
  minimumGap: number;
  /** Defaults to all physical inventory. No whole-pair collision exemptions. */
  bodies?: BodyRef[];
}
export interface AssemblyClaim extends ClaimBase {
  kind: 'assembly-access';
  initial: BodyRef[];
  scope?: BodyRef[];
  steps: {
    id: string;
    part: BodyRef;
    /** Starting displacement from the final installed pose. */
    from: Vec3;
    held: boolean;
    fasten?: string[];
    tool?: { from: Vec3; to: Vec3; diameter: number; travel: Vec3 };
  }[];
  minimumGap: number;
  maxIntervals?: number;
}
export interface RetentionClaim extends ClaimBase {
  kind: 'retention';
  roots: BodyRef[];
  /** Each link references a measured geometric contract, with its fastening assumption. */
  links: { claim: string; fastening: 'glued' | 'locked' | 'captured'; installed: boolean }[];
  removable?: BodyRef[];
}
export type JointRelation =
  | { kind: 'fixed'; a: BodyRef; b: BodyRef }
  | {
      kind: 'revolute';
      a: BodyRef;
      b: BodyRef;
      anchorA: Vec3;
      anchorB: Vec3;
      axisA: Vec3;
      axisB: Vec3;
      range?: Interval;
    }
  | { kind: 'prismatic'; a: BodyRef; b: BodyRef; axisA: Vec3; travel: Interval }
  | { kind: 'gear'; a: BodyRef; b: BodyRef; axisA: Vec3; axisB: Vec3; ratio: number };
export interface JointClaim extends ClaimBase {
  kind: 'joint-constraints';
  bodies: BodyRef[];
  roots: BodyRef[];
  joints: JointRelation[];
  expectedDof: number;
}
export interface StabilityClaim extends ClaimBase {
  kind: 'stability';
  supports: BodyRef[];
  loads: { body: BodyRef; mass: number; center?: Vec3 }[];
  ground: number;
  gravity: Vec3;
  minimumMargin: number;
  retention?: string;
}
export interface AssemblySupportClaim extends ClaimBase {
  kind: 'assembly-support';
  plan: string;
  retention: string;
  holds?: { step: string; bodies: BodyRef[] }[];
}
export interface UnsupportedClaim extends ClaimBase {
  kind: 'strength';
}
export type VerificationClaim =
  | GlueContactClaim
  | TabSlotClaim
  | CapturedShaftClaim
  | InvariantClaim
  | MaterialClaim
  | MotionClaim
  | ClearanceClaim
  | AssemblyClaim
  | RetentionClaim
  | JointClaim
  | StabilityClaim
  | AssemblySupportClaim
  | UnsupportedClaim;

export interface VerificationSpec {
  schemaVersion: 1;
  model: string;
  configurations: {
    id: string;
    params?: Record<string, Value>;
    materials?: Record<string, MaterialProfile>;
  }[];
  materials?: Record<string, MaterialProfile>;
  claims: VerificationClaim[];
}

export interface VerificationIssue {
  code: string;
  message: string;
  path?: string;
}
export interface ClaimResult {
  id: string;
  kind: string;
  required: boolean;
  status: VerificationStatus;
  configurations: string[];
  assemblyStep?: string;
  code: string;
  message: string;
  entities: BodyRef[];
  measurements: Record<string, number | Interval>;
  assumptions: string[];
  coverage: 'nominal' | 'bounded-fit' | 'discrete' | 'continuous-nominal' | 'none';
}

export interface VerificationReport {
  schemaVersion: 1;
  model: string;
  status: VerificationStatus;
  algorithm: 'kerf-rigid-v1';
  /** Linear predicates within this band are unresolved rather than rounded to pass. */
  numericalTolerance: number;
  specification: VerificationSpec;
  claims: ClaimResult[];
  inputs: {
    configuration: string;
    params: Record<string, Value>;
    renderSettings: Record<string, Value>;
    provenance: VerificationProvenance | null;
  }[];
  uncovered: string[];
}

export type VerificationResult =
  | { kind: 'invalid-spec' | 'invalid-snapshot'; issues: VerificationIssue[] }
  | { kind: 'report'; report: VerificationReport };

export interface VerifyLimits {
  maxPoints?: number;
  maxClaims?: number;
  maxConfigurations?: number;
  maxOperations?: number;
}
