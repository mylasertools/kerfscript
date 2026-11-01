// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// How the standalone `kerf` binary is compiled with Deno, shared by
// scripts/release.mjs and the test that runs a compiled binary, so the test
// checks the permissions that ship.

import { execFileSync } from 'node:child_process';

// What kerf may do: read designs and fonts, write exports and installed
// libraries, and download libraries (kerf add, kerf install)
export const PERMISSIONS = ['--allow-read', '--allow-write', '--allow-net'];

/** Compiles entry (a bundled dist/cli.js copy, in folder cwd) into output
 * for a Rust target triple, or for this computer when triple is omitted. */
export function compile(cwd, entry, output, triple) {
  execFileSync(
    'deno',
    [
      'compile',
      '--quiet',
      '--no-check',
      ...PERMISSIONS,
      ...(triple ? ['--target', triple] : []),
      '-o',
      output,
      entry,
    ],
    { cwd, stdio: 'inherit' },
  );
}
