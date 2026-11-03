// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Copies the built interpreter, the highlighter and the demo font into public/, so the
// playground runs the same KerfScript the pages were rendered with.
// Run `npm run build` in the repository root first.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(site, '..');
const bundle = join(repo, 'dist/index.js');
if (!existsSync(bundle))
  throw new Error('dist/index.js is missing: run `npm run build` in the repository root');
mkdirSync(join(site, 'public/assets/fonts'), { recursive: true });
copyFileSync(bundle, join(site, 'public/assets/kerfscript.js'));
copyFileSync(join(repo, 'dist/highlight.js'), join(site, 'public/assets/highlight.js'));
// The bundle's notices, where its banner points
copyFileSync(
  join(repo, 'THIRD-PARTY-NOTICES.md'),
  join(site, 'public/assets/THIRD-PARTY-NOTICES.md'),
);
// The 3D assembly view, with three.js, beside the interpreter it imports
const { build } = await import(join(repo, 'node_modules/esbuild/lib/main.js'));
await build({
  entryPoints: [join(site, 'src/viewer/assembly.js')],
  outfile: join(site, 'public/assets/assembly.js'),
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  external: ['./kerfscript.js'],
  legalComments: 'eof',
  banner: {
    js: '/*! KerfScript 3D assembly view | (c) MyLaserTools | AGPL-3.0-only or commercial licence. Includes three.js (MIT, Copyright 2010-2025 three.js authors). */',
  },
});
for (const f of ['AtkinsonHyperlegible-Regular.ttf', 'OFL.txt'])
  copyFileSync(join(repo, 'fonts', f), join(site, 'public/assets/fonts', f));
