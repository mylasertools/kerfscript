// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Runs KerfScript off the main thread, so a slow program never freezes the page.
// It also turns SVG drawings into programs, in a worker of their own.

import { KerfError, formatError, importSvg, render } from './kerfscript.js';

const own = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

const font = fetch(new URL('./fonts/AtkinsonHyperlegible-Regular.ttf', import.meta.url)).then((r) =>
  r.arrayBuffer(),
);

// An SVG file's bytes to a program
function importDrawing({ svg, name }) {
  try {
    const { source, summary, notes } = importSvg(new Uint8Array(svg), { name });
    self.postMessage({ ok: true, source, summary, notes });
  } catch (error) {
    self.postMessage({ ok: false, error: error.message });
  }
}

self.onmessage = async (event) => {
  if (event.data.svg) return importDrawing(event.data);
  const { id, source, params, files } = event.data;
  const started = performance.now();
  const resolve = files ? (p) => own(files, p) ?? own(files, p + '.kerf') : undefined;
  try {
    const result = render(source, {
      params,
      fonts: { Atkinson: await font },
      defaultFont: 'Atkinson',
      resolve,
    });
    self.postMessage({
      id,
      ok: true,
      ms: performance.now() - started,
      result: {
        sheets: result.sheets.map(({ width, height, material, thickness, items, svg, dxf }) =>
          result.sheets.length > 1
            ? { width, height, material, thickness, items, svg, dxf }
            : { width, height, material, thickness, items },
        ),
        layers: result.layers,
        parts: result.parts,
        // For the 3D view
        assembly: result.assembly,
        steps: result.steps,
        hardware: result.hardware,
        warnings: result.warnings,
        echoes: result.echoes,
        width: result.width,
        height: result.height,
        svg: result.svg,
        dxf: result.sheets.length === 1 ? result.sheets[0].dxf : null,
      },
    });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      // The message with the line it is on underlined and the calls it is in
      error: formatError(error, source, { resolve }),
      // A line in the program, not in a library it uses
      line: error instanceof KerfError && !error.file ? error.line : undefined,
      echoes: error instanceof KerfError ? error.echoes : [],
    });
  }
};
