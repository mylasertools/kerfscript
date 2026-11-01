import { readdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
const noNodeBuiltins = {
  name: 'no-node-builtins',
  setup(b) {
    b.onResolve({ filter: /^fs$/ }, () => ({ path: 'fs', namespace: 'empty' }));
    b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: 'module.exports = {}' }));
  },
};
const banner = {
  js: '/*! @mylasertools/kerfscript | (c) MyLaserTools | AGPL-3.0-only or commercial licence, see COMMERCIAL-LICENSE.md. Includes Clipper2 (BSL-1.0), opentype.js, tiny-inflate and string.prototype.codepointat (MIT), see THIRD-PARTY-NOTICES.md. */',
};
// The library, and the language service for editors on its own
for (const name of ['index', 'language'])
  for (const format of ['esm', 'cjs'])
    await build({
      entryPoints: [`src/${name}.ts`],
      outfile: `dist/${name}.${format === 'esm' ? 'js' : 'cjs'}`,
      bundle: true,
      minify: true,
      format,
      platform: 'neutral',
      mainFields: ['module', 'main'],
      target: 'es2020',
      banner,
      plugins: [noNodeBuiltins],
    });
// The highlighter and the signatures on their own, for editors and pages
// that do not run programs
for (const name of ['highlight', 'signatures'])
  for (const format of ['esm', 'cjs'])
    await build({
      entryPoints: [`src/${name}.ts`],
      outfile: `dist/${name}.${format === 'esm' ? 'js' : 'cjs'}`,
      bundle: true,
      format,
      platform: 'neutral',
      target: 'es2020',
      banner: {
        js: `/*! @mylasertools/kerfscript/${name} | (c) MyLaserTools | AGPL-3.0-only or commercial licence */`,
      },
    });
await build({
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  loader: { '.ttf': 'binary' },
  banner: { js: '#!/usr/bin/env node\n' + banner.js },
});
for (const name of await readdir('dist', { recursive: true })) {
  if (!name.endsWith('.d.ts')) continue;
  const text = await readFile('dist/' + name, 'utf8');
  await writeFile('dist/' + name.replace('.d.ts', '.d.cts'), text.replaceAll(".js'", ".cjs'"));
}
