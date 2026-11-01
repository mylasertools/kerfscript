// Makes a name tag for every name in names.json: an SVG and a DXF for each,
// and one sheet with all of them packed together.
//
//   npm install @mylasertools/kerfscript
//   node generate.mjs [out-folder]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@mylasertools/kerfscript';

const here = new URL('.', import.meta.url);
const out = process.argv[2] ?? 'out';
const design = readFileSync(new URL('name-tag.kerf', here), 'utf8');
const names = JSON.parse(readFileSync(new URL('names.json', here), 'utf8'));
// text() needs a font file; this one ships with KerfScript's source
const fonts = {
  atkinson: readFileSync(new URL('../../fonts/AtkinsonHyperlegible-Regular.ttf', here)),
};

mkdirSync(out, { recursive: true });
for (const name of names) {
  // params replaces the design's top-level settings by name
  const result = render(design, { params: { name }, fonts });
  for (const w of result.warnings) console.warn(`${name}: ${w}`);
  const file = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  writeFileSync(join(out, `${file}.svg`), result.sheets[0].svg);
  writeFileSync(join(out, `${file}.dxf`), result.sheets[0].dxf);
  const [part] = result.parts;
  console.log(`${file}: ${part.width} x ${part.height} mm, ${part.cutLength} mm of cutting`);
}

// Every tag in one program: `use` loads the design as a library, and the
// renderer packs the parts onto 300 x 200 mm sheets
const program = `use <name-tag>\nfor (n = ${JSON.stringify(names)}) name_tag(n);`;
const all = render(program, {
  fonts,
  sheet: [300, 200],
  resolve: (path) => (path === 'name-tag' ? design : undefined),
});
all.sheets.forEach((s, i) => writeFileSync(join(out, `all-tags-${i + 1}.svg`), s.svg));
console.log(`all-tags: ${all.parts.length} tags on ${all.sheets.length} sheet(s)`);
