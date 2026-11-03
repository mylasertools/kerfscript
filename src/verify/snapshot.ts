// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import type { RenderResult } from '../render.js';
import type { Value } from '../values.js';
import type { VerificationSnapshot, VerificationProvenance } from './types.js';

export interface SnapshotContext {
  configuration: string;
  params?: Record<string, Value>;
  renderSettings?: Record<string, Value>;
  provenance?: VerificationProvenance;
}

/** Copy and freeze the inputs. Caller mutations cannot change archived evidence. */
export function snapshotFromRender(
  result: RenderResult,
  context: SnapshotContext,
): VerificationSnapshot {
  const analysis = result.analysis?.schemaVersion === 1 ? result.analysis : undefined;
  return freeze(
    JSON.parse(
      JSON.stringify({
        schemaVersion: 1,
        configuration: context.configuration,
        params: context.params ?? {},
        renderSettings: context.renderSettings ?? {},
        provenance: context.provenance ?? null,
        parts: result.assembly.map((p) => {
          const definitions = analysis?.parts.filter((d) => d.name === p.name);
          const definition = definitions?.length === 1 ? definitions[0] : undefined;
          const host = definition?.glue?.host;
          const hosts = host ? result.assembly.filter((q) => q.name === host) : [];
          const hostCopy =
            hosts.length === (definition?.qty ?? 0) / (definition?.stack ?? 1)
              ? Math.floor((p.copy - 1) / (definition?.stack ?? 1)) + 1
              : 1;
          return {
            name: p.name,
            copy: p.copy,
            thickness: p.thickness,
            material: p.material ?? '',
            matrix: p.matrix,
            placed: p.placed,
            regions: definition?.cutRegions ?? p.outline,
            bends: p.bends ?? [],
            kerf: definition?.kerf ?? null,
            cutLines: definition?.cutLines ?? null,
            ...(definition?.stack && { stack: definition.stack }),
            ...(host && { glue: { part: host, copy: hostCopy }, glueFace: definition!.glue!.face }),
            ...(definition?.on && { on: definition.on }),
          };
        }),
        hardware: result.hardware.map((h) => ({
          label: h.label ?? null,
          kind: h.kind,
          from: h.from,
          to: h.to,
          size: h.size,
          up: h.up,
        })),
        warnings: result.warnings,
        legacyHardware: result.echoes.some((s) => s.startsWith('hardware, ')),
        relationsKnown: analysis?.relations === true,
      }),
    ),
  ) as VerificationSnapshot;
}

function freeze(value: unknown): unknown {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
