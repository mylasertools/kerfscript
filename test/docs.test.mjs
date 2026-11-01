import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render } from '../dist/index.js';
import { resolver } from '../dist/libraries.js';

const font = readFileSync(new URL('../fonts/AtkinsonHyperlegible-Regular.ttf', import.meta.url));
const docs = new URL('../docs/', import.meta.url);
// The library docs/shared-libraries.md installs: a design inside it finds
// <feet/...> as the project's own files
const resolve = resolver(fileURLToPath(new URL('fixtures/feet/design.kerf', import.meta.url)));

for (const file of readdirSync(docs).filter((f) => f.endsWith('.md'))) {
  const text = readFileSync(new URL(file, docs), 'utf8').replace(/\r\n/g, '\n');
  const blocks = [...text.matchAll(/```kerf\n([\s\S]*?)```/g)].map((m) => m[1]);
  test(`examples in docs/${file} run`, () => {
    blocks.forEach((src, i) => {
      const shapes = !/^(\$?\w+ = [^;]+;\s*)+$/.test(src.trim());
      const r = render(src, { fonts: { Atkinson: font }, resolve });
      if (shapes) assert.ok(r.parts.length, `docs/${file} example ${i + 1} made no parts`);
    });
  });
}
