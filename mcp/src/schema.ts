// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import { z } from 'zod';

export const MAX_SOURCE = 64_000;
export const MAX_REPLY = 1_000_000;
export const sourceSchema = z.string().max(MAX_SOURCE);
const value = z.union([
  z.number().finite(),
  z.string().max(2000),
  z.boolean(),
  z.array(z.number().finite()).max(100),
]);
export const renderSchema = z
  .object({
    source: sourceSchema.describe(
      'KerfScript program. Lengths are millimetres; angles are degrees.',
    ),
    params: z
      .record(z.string().max(100), value)
      .refine((p) => Object.keys(p).length <= 100)
      .optional(),
    libraries: z
      .record(z.string().max(200), sourceSchema)
      .refine(
        (p) =>
          Object.keys(p).length <= 20 &&
          Object.values(p).reduce((n, s) => n + s.length, 0) <= MAX_SOURCE,
      )
      .optional()
      .describe(
        'Optional virtual libraries keyed by the exact use/include path. No files or URLs are fetched.',
      ),
    format: z.enum(['svg', 'dxf']).default('svg'),
    sheet: z.tuple([z.number().positive().max(10000), z.number().positive().max(10000)]).optional(),
    kerf: z.number().min(0).max(10).optional(),
    gap: z.number().min(0).max(100).optional(),
    margin: z.number().min(0).max(100).optional(),
    layout: z.enum(['pack', 'none']).default('pack'),
  })
  .strict();
export type RenderInput = z.infer<typeof renderSchema>;
export type Job =
  | { operation: 'render'; input: RenderInput }
  | { operation: 'parameters'; source: string };
export type Result = { [key: string]: unknown };
export type Executor = (job: Job, signal?: AbortSignal) => Promise<Result>;
