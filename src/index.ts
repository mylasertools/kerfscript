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

export const VERSION = '0.5.0';
export const LANGUAGE_VERSION = '0.2';
export { importSvg, type ImportOptions, type ImportResult } from './import/index.js';
