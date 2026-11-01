// A box generator as a web service.
//
//   GET /settings                    the design's settings, to build a form
//   GET /box.svg?width=200&lid=false the cut file, packed on sheets
//   GET /box.dxf?width=200           the first sheet as DXF
//   GET /box.json?width=200          parts, sizes, cut lengths and warnings
//
//   npm install @mylasertools/kerfscript
//   node server.mjs [port]
//
// Each render runs in a worker that is stopped after two seconds, so a
// design that never finishes cannot hold up the server.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { parameters } from '@mylasertools/kerfscript';

const design = readFileSync(new URL('box.kerf', import.meta.url), 'utf8');
const settings = parameters(design).parameters;

// Query values typed like the setting they replace, and kept to its range
function params(query) {
  const out = {};
  for (const s of settings) {
    const v = query.get(s.name);
    if (v === null) continue;
    if (s.type === 'number') {
      const n = Number(v);
      if (v === '' || !Number.isFinite(n)) throw new Error(`${s.name} must be a number`);
      if ((s.min !== undefined && n < s.min) || (s.max !== undefined && n > s.max))
        throw new Error(`${s.name} must be from ${s.min} to ${s.max}`);
      out[s.name] = n;
    } else if (s.type === 'boolean') out[s.name] = v === 'true';
    else out[s.name] = v;
  }
  return out;
}

function renderInWorker(request, ms = 2000) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('render-worker.mjs', import.meta.url), {
      workerData: request,
    });
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ error: 'The design took too long to render' });
    }, ms);
    worker.once('message', (m) => {
      clearTimeout(timer);
      resolve(m);
    });
    worker.once('error', (e) => {
      clearTimeout(timer);
      resolve({ error: e.message });
    });
  });
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (status, type, body) => {
    res.writeHead(status, { 'content-type': type });
    res.end(body);
  };
  if (url.pathname === '/settings')
    return send(200, 'application/json', JSON.stringify(settings, null, 2));
  const m = /^\/box\.(svg|dxf|json)$/.exec(url.pathname);
  if (!m) return send(404, 'text/plain', 'Try /settings or /box.svg?width=200');
  let values;
  try {
    values = params(url.searchParams);
  } catch (e) {
    return send(400, 'text/plain', e.message);
  }
  const result = await renderInWorker({ source: design, params: values });
  if (result.error) return send(400, 'text/plain', result.error);
  if (m[1] === 'svg') return send(200, 'image/svg+xml', result.svg);
  if (m[1] === 'dxf') return send(200, 'application/dxf', result.dxf);
  const { parts, warnings, sheets } = result;
  send(200, 'application/json', JSON.stringify({ parts, warnings, sheets }, null, 2));
});

if (resolvePath(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 8080);
  server.listen(port, () => console.log(`http://localhost:${port}/box.svg?width=200`));
}
