// Writes the lists of built-in names that the highlighter and the VS Code
// grammar colour, from the signature table and the standard library's
// modules. Run after adding a built-in or a library module:
//   npm run build && node scripts/builtins.mjs && npm run build

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { SIGNATURES, parse } from '../dist/index.js';

const LAYERS = ['cut', 'score', 'engrave', 'guide', 'layer'];
const modules = SIGNATURES.filter((s) => s.kind !== 'function' && !LAYERS.includes(s.name)).map(
  (s) => s.name,
);
const functions = SIGNATURES.filter((s) => s.kind === 'function').map((s) => s.name);
const library = readdirSync('lib/kerf')
  .filter((f) => f.endsWith('.kerf'))
  .sort()
  .flatMap((f) =>
    parse(readFileSync(`lib/kerf/${f}`, 'utf8'))
      .program.body.filter((s) => s.kind === 'module')
      .map((s) => s.name),
  );
const unique = (list) => [...new Set(list)];
const mods = unique([...modules, ...library]);
const fns = unique(functions);

// The highlighter: words wrapped at about 90 characters
const wrap = (words) => {
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && line.length + w.length + 1 > 88) {
      lines.push(line + ' ');
      line = '';
    }
    line += (line ? ' ' : '') + w;
  }
  lines.push(line);
  return lines;
};
const all = wrap([...mods, ...fns]);
const body = all.map((l, i) => `    '${l}'${i < all.length - 1 ? ' +' : ''}`).join('\n');
const hl = readFileSync('src/highlight.ts', 'utf8').replace(
  /export const BUILTINS = new Set\(\n {2}\(\n[\s\S]*?\n {2}\)\.split\(' '\),\n\);/,
  `export const BUILTINS = new Set(\n  (\n${body}\n  ).split(' '),\n);`,
);
writeFileSync('src/highlight.ts', hl);

// The grammar: only the two lists change, so the file keeps its layout
const file = 'editors/vscode/syntaxes/kerfscript.tmLanguage.json';
const list = (names) => `"match": "\\\\b(${names.join('|')})\\\\s*(?=\\\\()"`;
let text = readFileSync(file, 'utf8');
for (const [comment, names] of [
  ['Built-in modules', mods],
  ['Built-in functions', fns],
]) {
  const re = new RegExp(`("comment": "${comment}",\\n\\s*)"match": "[^\\n]*"`);
  if (!re.test(text)) throw new Error(`no ${comment} in ${file}`);
  text = text.replace(re, (_, head) => head + list(names));
}
writeFileSync(file, text);
console.log(`${mods.length} modules, ${fns.length} functions`);
