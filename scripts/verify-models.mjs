// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
// Run paired model.kerf / model.verify.json contracts without executing spec code.
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
const directory = resolve(process.argv[2] ?? 'test/fixtures/verification');
const output = process.argv[3] ? resolve(process.argv[3]) : null;
const specs = readdirSync(directory, { recursive: true })
  .filter((p) => p.endsWith('.verify.json'))
  .sort();
if (!specs.length) throw new Error(`No verification specifications in ${directory}`);
let exit = 0;
for (const file of specs) {
  const source = join(directory, file.replace(/\.verify\.json$/, '.kerf'));
  const run = spawnSync(
    process.execPath,
    ['dist/cli.js', 'verify', source, '--spec', join(directory, file)],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  const result = JSON.parse(
    run.stdout || JSON.stringify({ kind: 'host-error', message: run.stderr || run.error?.message }),
  );
  const status = result.kind === 'report' ? result.report.status : result.kind;
  console.log(`${file}: ${status}`);
  if (output) {
    const target = join(output, file.replace(/\.verify\.json$/, '.report.json'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(result, null, 2) + '\n');
  }
  if (run.status !== 0) exit = run.status === 1 ? 1 : exit || 2;
}
process.exitCode = exit;
