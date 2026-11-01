// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import { render, parameters, KerfError, VERSION, LANGUAGE_VERSION } from '../../dist/index.js';
import font from '../../fonts/AtkinsonHyperlegible-Regular.ttf';
import { MAX_REPLY, sourceSchema, renderSchema, type Job, type Result } from './schema.js';

// Fixed service limits cannot be increased by callers.
const limits = {
  maxParts: 100,
  maxSegments: 512,
  maxListLength: 10000,
  maxListItems: 100000,
  maxTextLength: 300,
  maxPoints: 50000,
  maxOutputPoints: 30000,
  maxSheets: 10,
  maxCollisionPairs: 1000,
};

export function execute(job: Job): Result {
  try {
    let result: Result;
    if (job.operation === 'parameters') {
      result = { ok: true, ...parameters(sourceSchema.parse(job.source)) };
    } else {
      const { source, libraries, format, ...options } = renderSchema.parse(job.input);
      const rendered = render(source, {
        ...options,
        fonts: { Atkinson: font },
        defaultFont: 'Atkinson',
        maxSteps: 100000,
        limits,
        resolve: (path) =>
          libraries && Object.hasOwn(libraries, path) ? libraries[path] : undefined,
      });
      result = {
        ok: true,
        version: VERSION,
        languageVersion: LANGUAGE_VERSION,
        units: 'mm',
        font: 'Atkinson',
        width: rendered.width,
        height: rendered.height,
        parts: rendered.parts,
        layers: rendered.layers,
        warnings: rendered.warnings,
        echoes: rendered.echoes,
        files: rendered.sheets.map((sheet, i) => ({
          name: `sheet-${i + 1}.${format}`,
          mimeType: format === 'svg' ? 'image/svg+xml' : 'application/dxf',
          width: sheet.width,
          height: sheet.height,
          material: sheet.material,
          thickness: sheet.thickness,
          text: sheet[format],
        })),
      };
    }
    if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_REPLY)
      return {
        ok: false,
        error: {
          message:
            'Result exceeds the MCP output limit. Reduce the design or render locally with the KerfScript package.',
        },
      };
    return result;
  } catch (error) {
    if (error instanceof KerfError)
      return {
        ok: false,
        error: {
          message: error.message,
          line: error.line,
          col: error.col,
          file: error.file,
          missingFonts: error.missingFonts,
          echoes: error.echoes,
        },
      };
    if (error instanceof RangeError)
      return {
        ok: false,
        error: { message: 'Program exceeded a parser or rendering resource limit.' },
      };
    return {
      ok: false,
      error: {
        message:
          'Unable to process this program. Check its inputs or try the local KerfScript CLI.',
      },
    };
  }
}
