// The web highlighter (src/highlight.ts, used by the site, the desktop app
// and MyLaserTools) and this grammar must colour code the same way. This
// tokenizes every example with both and compares them character by character.
// Run `npm run build` in the repository root first.

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import oniguruma from 'vscode-oniguruma';
import textmate from 'vscode-textmate';
import { highlightLines } from '../../../dist/highlight.js';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
await oniguruma.loadWASM(
  readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer,
);
const registry = new textmate.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (p) => new oniguruma.OnigScanner(p),
    createOnigString: (s) => new oniguruma.OnigString(s),
  }),
  loadGrammar: async () =>
    textmate.parseRawGrammar(
      readFileSync(join(here, '../syntaxes/kerfscript.tmLanguage.json'), 'utf8'),
      'kerfscript.tmLanguage.json',
    ),
});
const grammar = await registry.loadGrammar('source.kerfscript');

// The highlighter's kind for a token's grammar scopes, innermost first
function kind(scopes) {
  const s = scopes.join(' ');
  if (s.includes('comment.block.customizer-group')) return 'section';
  if (s.includes('meta.customizer.control')) return 'control';
  if (s.includes('comment.')) return 'comment';
  if (s.includes('string.')) return 'string';
  if (s.includes('constant.numeric')) return 'number';
  if (s.includes('constant.language')) return 'constant';
  if (s.includes('keyword.other.modifier')) return 'modifier';
  if (/keyword\.control|storage\.type/.test(s)) return 'keyword';
  if (s.includes('entity.name.function.call')) return 'call';
  if (s.includes('entity.name.function')) return 'definition';
  if (s.includes('support.function.layer')) return 'layer';
  if (s.includes('support.function.builtin')) return 'builtin';
  if (s.includes('variable.language.special')) return 'special';
  return 'plain';
}

const roots = [join(here, '../../../examples'), join(here, '../../../lib/kerf')];
let files = 0;
let failed = 0;
for (const root of roots) {
  for (const name of readdirSync(root).filter((n) => n.endsWith('.kerf'))) {
    const src = readFileSync(join(root, name), 'utf8');
    const web = highlightLines(src);
    let stack = textmate.INITIAL;
    src.split('\n').forEach((line, n) => {
      const r = grammar.tokenizeLine(line, stack);
      stack = r.ruleStack;
      const tm = [];
      for (const t of r.tokens)
        for (let i = t.startIndex; i < t.endIndex; i++) tm[i] = kind(t.scopes);
      const ours = web[n].flatMap((t) => [...t.text].map(() => t.kind));
      for (let i = 0; i < line.length; i++) {
        // Whitespace between tokens may fall either side
        if (/\s/.test(line[i]) || tm[i] === ours[i]) continue;
        if (failed++ < 20)
          console.error(
            `${name}:${n + 1}:${i + 1} grammar says ${tm[i]}, highlighter says ${ours[i]}\n  ${line}\n  ${' '.repeat(i)}^`,
          );
        break;
      }
    });
    files++;
  }
}
if (failed) {
  console.error(`${failed} lines differ`);
  process.exit(1);
}
console.log(`grammar and highlighter agree on ${files} files`);
