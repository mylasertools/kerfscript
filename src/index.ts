// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

export {
  render,
  type RenderOptions,
  type RenderResult,
  type PartInfo,
  type Sheet,
} from './render.js';
export { parameters, type Parameter } from './customizer.js';
export { parse } from './parser.js';
export { tokenize, KerfError, type TraceFrame } from './lexer.js';
export { formatError, type FormatOptions } from './diagnostics.js';
export { format, type FormatOptions as FormatterOptions } from './format.js';
export { DEFAULT_LAYERS, DEFAULT_LIMITS, type LayerDef, type Limits } from './evaluator.js';
export type { LayerPath } from './export/svg.js';
export type { FontSource } from './text.js';
export type { Value } from './values.js';
export {
  SIGNATURES,
  signature,
  formatSignature,
  type Signature,
  type ParamInfo,
} from './signatures.js';

export {
  bendPoint,
  meshPieces,
  placementMatrix,
  type AssemblyPart,
  type Mark,
  type Placement,
} from './assembly.js';
export type { HardwareItem } from './evaluator.js';
export { HARDWARE_KINDS, HARDWARE_COLORS, type HardwareKind } from './hardware.js';

export const VERSION = '0.8.0';
export const LANGUAGE_VERSION = '0.3';
export { diffRenders, type DiffEntry } from './diff.js';
export { instructionsHtml } from './instructions.js';
export { importSvg, type ImportOptions, type ImportResult } from './import/index.js';

export {
  verify,
  snapshotFromRender,
  poseAssembly,
  verificationIsCurrent,
  type SnapshotContext,
} from './verify/index.js';
export type * from './verify/types.js';
export { triage, triageText, type TriageGroup } from './verify/summary.js';
export type { RenderAnalysis } from './analysis.js';
