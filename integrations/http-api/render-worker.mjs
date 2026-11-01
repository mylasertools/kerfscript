// Renders one request for server.mjs and posts back what it needs
import { parentPort, workerData } from 'node:worker_threads';
import { render } from '@mylasertools/kerfscript';

try {
  const r = render(workerData.source, { params: workerData.params });
  parentPort.postMessage({
    svg: r.svg,
    dxf: r.sheets[0]?.dxf ?? '',
    parts: r.parts,
    warnings: r.warnings,
    sheets: r.sheets.length,
  });
} catch (e) {
  parentPort.postMessage({ error: e.message });
}
