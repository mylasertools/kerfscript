// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import type { Poly } from './geometry.js';

/** Opt-in manufacturing evidence captured before toolpath kerf compensation.
 * A repeated name is ambiguous to legacy name/copy selectors, never merged. */
export interface RenderAnalysis {
  schemaVersion: 1;
  relations: true;
  parts: {
    name: string;
    kerf: number;
    cutRegions: Poly[];
    cutLines: Poly[];
    qty: number;
    stack?: number;
    glue?: { host: string; face: 'top' | 'bottom' };
    on?: string;
  }[];
}
