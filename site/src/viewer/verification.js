// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

export const referenceKey = (ref) =>
  'part' in ref
    ? JSON.stringify(['part', ref.part, ref.copy ?? 1])
    : JSON.stringify(['hardware', ref.hardware]);

/** Only diagnostic findings are visualized. This does not infer a whole-model
 * certification from a partial report or carry results across model changes. */
export function verificationFindings(input, configuration, references) {
  const report = input?.kind === 'report' ? input.report : input;
  if (report?.schemaVersion !== 1 || !Array.isArray(report.claims)) return [];
  const known = new Set(references.map(referenceKey));
  return report.claims
    .filter(
      (c) =>
        c &&
        ['fail', 'unverified'].includes(c.status) &&
        Array.isArray(c.configurations) &&
        c.configurations.includes(configuration),
    )
    .map((c) => ({
      id: c.id,
      status: c.status,
      message: c.message,
      configuration,
      assemblyStep: c.assemblyStep,
      measurements: c.measurements,
      references: (Array.isArray(c.entities) ? c.entities : []).filter(
        (r) =>
          r &&
          typeof r === 'object' &&
          ('part' in r || 'hardware' in r) &&
          known.has(referenceKey(r)),
      ),
    }));
}
