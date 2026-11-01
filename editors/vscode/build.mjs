// Bundles the extension and its language server, and writes the licences
// of the packages bundled into them to THIRD-PARTY-NOTICES.md.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const result = await build({
  entryPoints: { extension: 'src/extension.js', server: 'src/server.js' },
  outdir: 'dist',
  bundle: true,
  minify: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  external: ['vscode'],
  loader: { '.ttf': 'binary' },
  legalComments: 'none',
  metafile: true,
});

// The extension's own packages once each, with their licence texts. The
// interpreter's are in its THIRD-PARTY-NOTICES.md.
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = !input.startsWith('../') && /^(.*node_modules\/)((?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (m) packages.set(m[2], m[1] + m[2]);
}
const sections = [...packages]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, dir]) => {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying)/i.test(f));
    const text = file ? readFileSync(join(dir, file), 'utf8').trim() : `License: ${pkg.license}`;
    return `## ${name} ${pkg.version}\n\n${pkg.license}\n\n\`\`\`text\n${text}\n\`\`\``;
  });
const interpreter = readFileSync('../../THIRD-PARTY-NOTICES.md', 'utf8')
  .split(/^(?=## )/m)
  .slice(1)
  .filter((s) => !s.startsWith('## Desktop app'))
  .map((s) => s.trim());
writeFileSync(
  'THIRD-PARTY-NOTICES.md',
  `# Third-party notices\n\nThe extension bundles these packages. Its language server includes the KerfScript interpreter, with the libraries and the font listed after them.\n\n${[...sections, ...interpreter].join('\n\n')}\n`,
);
console.log(`Bundled ${packages.size} packages: ${[...packages.keys()].join(', ')}`);
