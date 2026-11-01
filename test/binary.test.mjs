// Compiles the standalone kerf binary as a release does, with the same Deno
// permissions, and runs it. Skipped when Deno is not installed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { pack } from '../dist/libraries.js';
import { compile } from '../scripts/deno-compile.mjs';

const run = promisify(execFile);

let deno = true;
try {
  execFileSync('deno', ['--version'], { stdio: 'ignore' });
} catch {
  deno = false;
}

const write = (dir, files) => {
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
};

test(
  'the compiled kerf downloads a library and renders with it',
  { skip: !deno && 'Deno is not installed', timeout: 300000 },
  async () => {
    const work = mkdtempSync(join(tmpdir(), 'kerf-binary-'));
    // From an empty folder, as scripts/release.mjs does, so Deno embeds no
    // node_modules
    copyFileSync('dist/cli.js', join(work, 'kerf.js'));
    const kerf = join(work, process.platform === 'win32' ? 'kerf.exe' : 'kerf');
    compile(work, 'kerf.js', kerf);
    assert.match((await run(kerf, ['--version'])).stdout, /\(language \d+\.\d+\)/);

    const lib = mkdtempSync(join(tmpdir(), 'kerf-binary-lib-'));
    write(lib, {
      'kerf.json': JSON.stringify({ name: 'feet', version: '1.0.0' }),
      'feet.kerf':
        '// Holes for feet\nmodule feet(w) for (x = [8, w - 8]) translate([x, 8]) circle(d = 6);\n',
    });
    const archive = readFileSync(pack(lib).file);
    const server = createServer((req, res) => res.writeHead(200).end(archive));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const project = mkdtempSync(join(tmpdir(), 'kerf-binary-project-'));
      write(project, {
        'base.kerf': 'use <feet/feet>\npart("base") difference() { rect([60, 30]); feet(60); }\n',
      });
      const url = `http://127.0.0.1:${server.address().port}/feet-1.0.0.tar.gz`;
      const added = await run(kerf, ['add', url], { cwd: project });
      assert.match(added.stderr, /Added feet 1.0.0/);
      assert.ok(existsSync(join(project, 'kerf_libraries', 'feet', 'feet.kerf')));
      const checked = await run(kerf, ['check', 'base.kerf'], { cwd: project });
      assert.match(checked.stdout, /base: 60 x 30 mm/);
      await run(kerf, ['install', '--check'], { cwd: project });
    } finally {
      await new Promise((r) => server.close(r));
    }
  },
);
