// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Builds the files for a GitHub release into release/: a standalone `kerf`
// binary per platform (no Node.js needed), kerfscript.wasm, and a .sha256 and
// .sha512 file for each (scripts/checksums.mjs). Needs Deno (https://deno.com) on the PATH, and
// `npm run build` and `npm run wasm` first. The release workflow signs the
// files with GPG afterwards.
//
//   node scripts/release.mjs                 all platforms, named by version
//   node scripts/release.mjs --host          this platform only, for testing
//   KERF_LABEL=2026.10.29 node scripts/...   name files for a nightly snapshot

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checksums } from './checksums.mjs';
import { compile } from './deno-compile.mjs';

const TARGETS = [
  ['linux-x64', 'x86_64-unknown-linux-gnu'],
  ['linux-arm64', 'aarch64-unknown-linux-gnu'],
  ['macos-x64', 'x86_64-apple-darwin'],
  ['macos-arm64', 'aarch64-apple-darwin'],
  ['windows-x64', 'x86_64-pc-windows-msvc'],
];
const HOST = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform];
const HOST_NAME = `${HOST}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`;
const DOCS = [
  ['LICENSE', 'LICENSE'],
  ['COMMERCIAL-LICENSE.md', 'COMMERCIAL-LICENSE.md'],
  ['THIRD-PARTY-NOTICES.md', 'THIRD-PARTY-NOTICES.md'],
  ['fonts/OFL.txt', 'OFL.txt'],
  ['README.md', 'README.md'],
];

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const label = process.env.KERF_LABEL ?? version;
const targets = process.argv.includes('--host')
  ? TARGETS.filter(([name]) => name === HOST_NAME)
  : TARGETS;
const out = 'release';
rmSync(out, { recursive: true, force: true });
mkdirSync(out);

// Deno embeds a node_modules folder it finds next to the entry point, so
// compile a copy of the bundled CLI from an empty folder.
const work = mkdtempSync(join(tmpdir(), 'kerf-release-'));
copyFileSync('dist/cli.js', join(work, 'kerf.js'));

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

function archive(name, files, zip) {
  const target = join(process.cwd(), out, name);
  if (!zip) run('tar', ['-czf', target, ...files], work);
  // Windows' own tar (bsdtar) writes zip files; Git's GNU tar may come first on the PATH.
  else if (process.platform === 'win32')
    run(
      join(process.env.SystemRoot ?? 'C:/Windows', 'System32/tar.exe'),
      ['-a', '-cf', target, ...files],
      work,
    );
  else run('zip', ['-q', '-r', target, ...files], work);
  return name;
}

const made = [];
for (const [name, triple] of targets) {
  const dir = `kerf-${label}-${name}`;
  const exe = name.startsWith('windows') ? 'kerf.exe' : 'kerf';
  mkdirSync(join(work, dir));
  compile(work, 'kerf.js', join(dir, exe), triple);
  for (const [from, to] of DOCS) copyFileSync(from, join(work, dir, to));
  // The Deno runtime that deno compile builds into kerf
  copyFileSync('packaging/cli/THIRD-PARTY-LICENSES.md', join(work, dir, 'THIRD-PARTY-LICENSES.md'));
  if (name.startsWith('linux')) {
    copyFileSync('packaging/linux/kerf.1', join(work, dir, 'kerf.1'));
    copyFileSync('packaging/linux/kerfscript.xml', join(work, dir, 'kerfscript.xml'));
  }
  made.push(
    archive(
      `${dir}.${name.startsWith('windows') ? 'zip' : 'tar.gz'}`,
      [dir],
      name.startsWith('windows'),
    ),
  );
  if (name.startsWith('linux') && process.argv.includes('--linux-packages'))
    made.push(...linuxPackages(dir, name.endsWith('arm64') ? 'arm64' : 'amd64'));
}

// .deb and .rpm packages with nfpm (https://nfpm.goreleaser.com). nfpm reads
// YAML, and JSON is YAML. The package is kerfscript-cli: the desktop app's
// packages are named kerfscript, and both can be installed.
function linuxPackages(dir, arch) {
  const config = join(work, `${dir}-nfpm.yaml`);
  const docs = '/usr/share/doc/kerfscript-cli/';
  writeFileSync(
    config,
    JSON.stringify({
      name: 'kerfscript-cli',
      arch,
      version: label,
      maintainer: 'MyLaserTools <hi@mylasertools.com>',
      description: 'KerfScript: a programming language for laser cutting',
      homepage: 'https://kerfscript.mylasertools.com',
      license: 'AGPL-3.0-only',
      contents: [
        { src: `${dir}/kerf`, dst: '/usr/bin/kerf', file_info: { mode: 0o755 } },
        { src: `${dir}/kerf.1`, dst: '/usr/share/man/man1/kerf.1' },
        { src: `${dir}/kerfscript.xml`, dst: '/usr/share/mime/packages/kerfscript.xml' },
        ...[...DOCS.map(([, to]) => to), 'THIRD-PARTY-LICENSES.md'].map((to) => ({
          src: `${dir}/${to}`,
          dst: docs + to,
        })),
      ],
    }),
  );
  return ['deb', 'rpm'].map((packager) => {
    const file = `kerfscript-cli-${label}-linux-${arch === 'arm64' ? 'arm64' : 'x64'}.${packager}`;
    run(
      'nfpm',
      ['package', '-f', config, '-p', packager, '-t', join(process.cwd(), out, file)],
      work,
    );
    return file;
  });
}

const wasmDir = `kerfscript-wasm-${label}`;
mkdirSync(join(work, wasmDir));
copyFileSync('dist/kerfscript.wasm', join(work, wasmDir, 'kerfscript.wasm'));
copyFileSync('docs/webassembly.md', join(work, wasmDir, 'webassembly.md'));
copyFileSync(
  'packaging/wasm/THIRD-PARTY-LICENSES.md',
  join(work, wasmDir, 'THIRD-PARTY-LICENSES.md'),
);
for (const [from, to] of DOCS) copyFileSync(from, join(work, wasmDir, to));
made.push(archive(`${wasmDir}.zip`, [wasmDir], true));
copyFileSync('dist/kerfscript.wasm', join(out, `kerfscript-${label}.wasm`));
made.push(`kerfscript-${label}.wasm`);

checksums(out);
rmSync(work, { recursive: true, force: true });
console.log(`Wrote ${made.length} files to ${out}/:\n  ${made.join('\n  ')}`);
