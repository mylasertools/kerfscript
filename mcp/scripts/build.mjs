// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
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
for (const name of ['tools', 'stdio', 'runner', 'worker', 'isolated', 'execute']) {
  await build({
    entryPoints: [`src/${name}.ts`],
    outfile: `dist/${name}.js`,
    bundle: true,
    format: 'esm',
    platform: ['stdio', 'runner', 'isolated'].includes(name) ? 'node' : 'neutral',
    packages: 'external',
    target: 'es2022',
    loader: { '.ttf': 'binary' },
    ...(name === 'stdio' ? { banner: { js: '#!/usr/bin/env node' } } : {}),
  });
}
await copyFile('../LICENSE', 'LICENSE');
await copyFile('../THIRD-PARTY-NOTICES.md', 'THIRD-PARTY-NOTICES.md');
await copyFile('../fonts/OFL.txt', 'OFL.txt');
