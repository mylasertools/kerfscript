// Runs the generator examples in integrations/ against this build, so the
// README's links point at code that works. The browser example needs a
// headless Chrome or Edge (set CHROME to its path if it is not found), and
// the Python one needs Python with the wasmtime package and
// dist/kerfscript.wasm; each is skipped, with the reason, when missing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

const tmp = (name) => mkdtempSync(join(tmpdir(), `kerfscript-${name}-`));

test('node-batch makes a tag for every name and a packed sheet', () => {
  const out = tmp('tags');
  const log = execFileSync(process.execPath, ['integrations/node-batch/generate.mjs', out], {
    encoding: 'utf8',
  });
  const names = JSON.parse(readFileSync('integrations/node-batch/names.json', 'utf8'));
  for (const n of names) {
    const file = n.toLowerCase();
    assert.match(readFileSync(join(out, `${file}.svg`), 'utf8'), /<svg/);
    assert.match(readFileSync(join(out, `${file}.dxf`), 'utf8'), /SECTION/);
  }
  assert.match(log, new RegExp(`all-tags: ${names.length} tags on 1 sheet`));
});

test('http-api serves settings, cut files and errors', async () => {
  const { server } = await import('../integrations/http-api/server.mjs');
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  try {
    const settings = await (await fetch(`${base}/settings`)).json();
    assert.ok(settings.some((s) => s.name === 'width' && s.max === 400));
    const svg = await fetch(`${base}/box.svg?width=200&lid=false`);
    assert.equal(svg.status, 200);
    assert.match(await svg.text(), /<svg/);
    const info = await (await fetch(`${base}/box.json?width=200&lid=false`)).json();
    assert.deepEqual(
      info.parts.map((p) => p.name),
      ['bottom', 'front', 'back', 'left', 'right'],
    );
    assert.equal(info.parts[0].width, 200);
    assert.match(await (await fetch(`${base}/box.dxf`)).text(), /SECTION/);
    const bad = await fetch(`${base}/box.svg?width=5000`);
    assert.equal(bad.status, 400);
    assert.equal(await bad.text(), 'width must be from 40 to 400');
  } finally {
    server.close();
  }
});

const browsers = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const browser = browsers.find((b) => existsSync(b));

test(
  'browser builds a form from the settings and draws the coaster',
  { skip: browser ? false : 'no headless Chrome or Edge; set CHROME' },
  async () => {
    // Serve the example with its import map pointed at this build
    const dir = 'integrations/browser';
    const server = createServer((req, res) => {
      const path = new URL(req.url, 'http://x').pathname;
      const file =
        path === '/dist/index.js' ? 'dist/index.js' : join(dir, path === '/' ? 'index.html' : path);
      if (!existsSync(file)) return res.writeHead(404).end();
      let body = readFileSync(file);
      if (path === '/')
        body = body
          .toString()
          .replace(
            /https:\/\/cdn\.jsdelivr\.net\/npm\/@mylasertools\/kerfscript@[^"]*/,
            '/dist/index.js',
          );
      const type =
        { '.js': 'text/javascript', '.kerf': 'text/plain' }[extname(file)] ?? 'text/html';
      res.writeHead(200, { 'content-type': type }).end(body);
    });
    await new Promise((r) => server.listen(0, r));
    try {
      const url = `http://localhost:${server.address().port}/`;
      // Not execFileSync: the server above answers on this thread
      const { stdout: dom } = await promisify(execFile)(
        browser,
        [
          '--headless',
          '--disable-gpu',
          '--no-sandbox',
          '--virtual-time-budget=10000',
          '--dump-dom',
          url,
        ],
        { encoding: 'utf8', timeout: 60000 },
      );
      for (const name of ['shape', 'size', 'holes', 'border', '$kerf'])
        assert.ok(dom.includes(`name="${name}"`), `an input for ${name}`);
      // An XML declaration before the svg becomes a comment in the page
      assert.match(dom, /<div id="preview">(?:<!--[^>]*-->)?\s*<svg/);
      assert.match(dom, /<label>Size in mm<input type="range" min="60" max="120"/);
      assert.match(dom, /id="message"><\/p>/, 'no error message');
    } finally {
      server.close();
    }
  },
);

const python = [process.env.PYTHON, 'python3', 'python']
  .filter(Boolean)
  .find((p) => spawnSync(p, ['-c', 'import wasmtime'], { encoding: 'utf8' }).status === 0);
const wasm = existsSync('dist/kerfscript.wasm');

test(
  'python makes a box for every size through kerfscript.wasm',
  {
    skip: !wasm
      ? 'dist/kerfscript.wasm not built; run npm run wasm'
      : !python && 'no Python with the wasmtime package',
  },
  () => {
    const out = tmp('boxes');
    const log = execFileSync(
      python,
      ['integrations/python/generate.py', 'dist/kerfscript.wasm', out],
      { encoding: 'utf8', timeout: 120000 },
    );
    assert.match(log, /box-80x60x40: 6 panels on 1 sheet/);
    assert.match(log, /box-200x150x60: 6 panels on \d sheet/);
    const files = readdirSync(out);
    assert.ok(files.includes('box-120x80x50-1.svg') && files.includes('box-120x80x50-1.dxf'));
  },
);
