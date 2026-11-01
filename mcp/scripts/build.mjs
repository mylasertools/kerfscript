// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import { readFile, writeFile, mkdir, copyFile, readdir, unlink } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('generated', { recursive: true });
const docs = { reference: await readFile('../LANGUAGE.md', 'utf8') };
for (const name of await readdir('../docs')) {
  if (name.endsWith('.md') && !name.includes('submission'))
    docs[name.slice(0, -3)] = await readFile(`../docs/${name}`, 'utf8');
}
const models = JSON.parse(await readFile('../site/models.json', 'utf8'));
const examples = await Promise.all(
  models.map(async ({ file, title, tags }) => ({
    id: file,
    title,
    tags,
    source: await readFile(`../examples/${file}.kerf`, 'utf8'),
  })),
);
const { VERSION, LANGUAGE_VERSION } = await import('../../dist/index.js');
await writeFile(
  'generated/content.json',
  JSON.stringify({ docs, examples, version: VERSION, languageVersion: LANGUAGE_VERSION }),
);
// One graph shares the interpreter, font and docs between entry points.
// Remove only generated chunks from previous builds so npm never packs stale code.
await mkdir('dist', { recursive: true });
for (const name of await readdir('dist')) {
  if (/^chunk-[A-Z0-9]+\.js$/.test(name)) await unlink(`dist/${name}`);
}
await build({
  entryPoints: [
    'tools',
    'stdio',
    'runner',
    'worker',
    'service',
    'isolated',
    'execute',
    'replies',
    'budget',
  ].map((name) => `src/${name}.ts`),
  outdir: 'dist',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'neutral',
  packages: 'external',
  target: 'es2022',
  loader: { '.ttf': 'binary' },
});
const stdio = await readFile('dist/stdio.js', 'utf8');
await writeFile('dist/stdio.js', '#!/usr/bin/env node\n' + stdio);
await copyFile('../LICENSE', 'LICENSE');
await copyFile('../THIRD-PARTY-NOTICES.md', 'THIRD-PARTY-NOTICES.md');
await copyFile('../fonts/OFL.txt', 'OFL.txt');
