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
for (const f of ['AtkinsonHyperlegible-Regular.ttf', 'OFL.txt'])
  copyFileSync(join(repo, 'fonts', f), join(site, 'public/assets/fonts', f));
