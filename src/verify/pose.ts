// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import type { RenderResult } from '../render.js';
import { multiply } from '../assembly.js';
import { apply, sub } from './geometry.js';
import { key, trajectoryMatrix } from './solids.js';
import { validateSpec } from './spec.js';
import type { BodyRef, MotionClaim } from './types.js';

/** Display the very same analytic path that is verified, while preserving all
 * manufacturing geometry and cut files. No parameter expression is evaluated. */
export function poseAssembly(
  result: RenderResult,
  moving: MotionClaim['moving'],
  phase: number,
): RenderResult {
  if (!Number.isFinite(phase) || phase < 0 || phase > 1)
    throw new Error('Pose phase must be between 0 and 1.');
  const invalid = validateSpec({
    schemaVersion: 1,
    model: 'pose',
    configurations: [{ id: 'a' }, { id: 'b' }],
    claims: [{ id: 'path', kind: 'motion-clearance', from: 'a', to: 'b', moving, minimumGap: 0 }],
  });
  if (invalid.length) throw new Error(invalid[0].message);
  const transforms = new Map<string, number[]>();
  for (const control of moving) {
    const ref = control.body,
      k = key(ref);
    const count =
      'part' in ref
        ? result.assembly.filter((p) => p.name === ref.part && p.copy === (ref.copy ?? 1)).length
        : result.hardware.filter((h) => h.label === ref.hardware).length;
    if (count !== 1 || transforms.has(k))
      throw new Error('Pose controls must identify one unique physical instance each.');
    transforms.set(k, trajectoryMatrix(control.trajectory, phase));
  }
  return {
    ...result,
    assembly: result.assembly.map((p) => {
      const m = transforms.get(key({ part: p.name, copy: p.copy }));
      return m ? { ...p, matrix: multiply(m, p.matrix) } : p;
    }),
    hardware: result.hardware.map((h) => {
      const ref: BodyRef = { hardware: h.label ?? '' },
        m = transforms.get(key(ref));
      return m
        ? {
            ...h,
            from: apply(m, h.from),
            to: apply(m, h.to),
            up: sub(apply(m, h.up), apply(m, [0, 0, 0])),
          }
        : h;
    }),
  };
}
