// Tokenizes every example with the grammar and checks a few scopes, so a
// broken pattern fails here instead of in someone's editor.

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import oniguruma from 'vscode-oniguruma';
import textmate from 'vscode-textmate';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
await oniguruma.loadWASM(wasm.buffer);

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

function tokenize(src) {
  let stack = textmate.INITIAL;
  const out = [];
  for (const line of src.split('\n')) {
    const r = grammar.tokenizeLine(line, stack);
    for (const t of r.tokens)
      out.push({ text: line.slice(t.startIndex, t.endIndex), scopes: t.scopes });
    stack = r.ruleStack;
  }
  return { tokens: out, stack };
}

let failed = 0;
const check = (src, text, scope) => {
  const tok = tokenize(src).tokens.find((t) => t.text === text);
  if (!tok || !tok.scopes.some((s) => s.startsWith(scope))) {
    failed++;
    console.error(
      `FAIL ${JSON.stringify(src)}: "${text}" should be ${scope}, got ${tok ? tok.scopes.join(' ') : 'nothing'}`,
    );
  }
};

check('module lancet(w, h) rect([w, h]);', 'lancet', 'entity.name.function.module');
check('function half(x) = x / 2;', 'half', 'entity.name.function');
check('f = function(x) x * 2;', 'function', 'storage.type.function');
check('$fn = 96;', '$fn', 'variable.language.special');
check('use <kerf/box>', 'kerf/box', 'string.quoted.other.lt-gt');
check('rect([20, 10], r = 2);', 'rect', 'support.function.builtin');
check('rect([20, 10], r = 2);', 'r', 'variable.parameter');
check('score() circle(5);', 'score', 'support.function.layer');
check('lancet(13, 31);', 'lancet', 'entity.name.function.call');
check('x = 1e3;', '1e3', 'constant.numeric');
check('x = .5;', '.5', 'constant.numeric');
check('p = q.x;', 'x', 'variable.other.property');
check(String.raw`s = "a\u00e9b";`, String.raw`\u00e9`, 'constant.character.escape');
check('/* [Size] */', 'Size', 'entity.name.section.customizer');
check('width = 120; // [40:5:400]', '[40:5:400]', 'meta.customizer.control');
check('# circle(5);', '#', 'keyword.other.modifier');
check('if (a) b(); else c();', 'else', 'keyword.control');
check('x = undef;', 'undef', 'constant.language');

// Every example and library file must end outside any open region, which
// catches a begin pattern that never finds its end
const roots = [join(here, '../../../examples'), join(here, '../../../lib/kerf')];
let files = 0;
for (const root of roots) {
  for (const name of readdirSync(root).filter((n) => n.endsWith('.kerf'))) {
    const { stack } = tokenize(readFileSync(join(root, name), 'utf8'));
    files++;
    if (stack.depth > 1) {
      failed++;
      console.error(
        `FAIL ${name}: ends inside ${stack.getScopeNames?.() ?? `depth ${stack.depth}`}`,
      );
    }
  }
}

// VS Code reads some of these files leniently, so check them as strict JSON
for (const file of [
  'package.json',
  'language-configuration.json',
  'snippets/kerfscript.json',
  'syntaxes/kerfscript.tmLanguage.json',
  'syntaxes/kerfscript.markdown.tmLanguage.json',
]) {
  try {
    JSON.parse(readFileSync(join(here, '..', file), 'utf8'));
  } catch (error) {
    failed++;
    console.error(`FAIL ${file}: ${error.message}`);
  }
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log(`grammar ok, ${files} files tokenized`);
