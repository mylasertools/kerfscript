// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Writes packaging/cli/THIRD-PARTY-LICENSES.md: the Deno runtime that
// `deno compile` builds into the kerf command line binaries (Deno's denort
// crate, with V8 through the v8 crate) and the Rust crates compiled into it,
// with their licences (see scripts/rust-licenses.mjs). Release files carry it
// next to the binaries. Run it after changing DENO_VERSION; --check fails when
// the file is out of date. It clones Deno at that version into a temporary
// folder.
//
//   node scripts/cli-licenses.mjs [--check | --fetch]

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rustLicenses, writeOrCheck } from './rust-licenses.mjs';

// Keep in step with deno-version in .github/workflows/release.yml and ci.yml
export const DENO_VERSION = 'v2.8.3';

const work = mkdtempSync(join(tmpdir(), 'kerf-deno-'));
try {
  execFileSync(
    'git',
    [
      '-c',
      'advice.detachedHead=false',
      'clone',
      '--quiet',
      '--depth',
      '1',
      '--branch',
      DENO_VERSION,
      'https://github.com/denoland/deno.git',
      work,
    ],
    { stdio: 'inherit' },
  );
  const doc = rustLicenses({
    manifestDir: work,
    targets: [
      'x86_64-unknown-linux-gnu',
      'aarch64-unknown-linux-gnu',
      'x86_64-apple-darwin',
      'aarch64-apple-darwin',
      'x86_64-pc-windows-msvc',
    ],
    rootName: 'denort',
    includeRoot: true,
    title: 'Third-party licences: kerf command line',
    intro: `The kerf command line binaries are KerfScript's JavaScript compiled with
[Deno](https://github.com/denoland/deno) ${DENO_VERSION}'s \`deno compile\`, which builds
in the Deno runtime (Deno's denort crate), V8 (through the v8 crate) and the
Rust crates below. Each is listed with its licence and the licence files it
ships; the texts follow, each under the crates that share it. KerfScript's own
code and the JavaScript libraries it bundles are covered by LICENSE and
THIRD-PARTY-NOTICES.md.

This file is made by \`scripts/cli-licenses.mjs\` from Deno's Cargo.lock.`,
    pathSource: `https://github.com/denoland/deno/tree/${DENO_VERSION}`,
    fetch: process.argv.includes('--fetch'),
  });
  writeOrCheck(
    fileURLToPath(new URL('../packaging/cli/THIRD-PARTY-LICENSES.md', import.meta.url)),
    doc,
    'packaging/cli/THIRD-PARTY-LICENSES.md',
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
