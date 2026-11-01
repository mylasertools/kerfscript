// Draws the pictures in docs/library/, one for each standard library, from
// the example that shows it off, as the site draws its models. Run after
// `npm run build`; `--check` fails when a picture is out of date.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { render } from '../dist/index.js';
import { displaySvg } from '../site/public/assets/display.js';

const PICTURES = {
  box: 'box',
  tabs: 'spice-shelf',
  hinge: 'flex-box',
  dividers: 'drawer-organizer',
  hanging: 'wall-sign',
  enclosure: 'project-enclosure',
  calibration: 'calibration-set',
};

const fonts = {
  fonts: { Atkinson: readFileSync('fonts/AtkinsonHyperlegible-Regular.ttf') },
  defaultFont: 'Atkinson',
};

// A sheet about as wide as it is tall, so many parts do not end up in one
// long row
function sheet(parts) {
  const sizes = parts.flatMap((p) => Array(p.qty).fill(p));
  const area = sizes.reduce((s, p) => s + (p.width + 6) * (p.height + 6), 0);
  const widest = Math.max(...sizes.map((p) => Math.max(p.width, p.height) + 6));
  return [Math.max(widest, Math.sqrt(area) * 1.35), 100000];
}

const check = process.argv.includes('--check');
const stale = [];
mkdirSync('docs/library', { recursive: true });
for (const [library, example] of Object.entries(PICTURES)) {
  const source = readFileSync(`examples/${example}.kerf`, 'utf8');
  const options = { ...fonts, margin: 0, gap: 6 };
  const result = render(source, { ...options, sheet: sheet(render(source, options).parts) });
  // Drawn at most 720 pixels wide, with the millimetres in the viewBox
  const svg = displaySvg(result).replace(/viewBox="0 0 ([\d.]+) ([\d.]+)"/, (m, w, h) => {
    const scale = Math.min(3, 720 / Number(w));
    return `width="${Math.round(w * scale)}" height="${Math.round(h * scale)}" ${m}`;
  });
  const file = `docs/library/${library}.svg`;
  if (check) {
    let old = '';
    try {
      old = readFileSync(file, 'utf8');
    } catch {}
    if (old !== `${svg}\n`) stale.push(file);
  } else writeFileSync(file, `${svg}\n`);
}
if (stale.length) {
  console.error(`Out of date, run node scripts/library-pictures.mjs: ${stale.join(', ')}`);
  process.exit(1);
}
console.log(check ? 'The library pictures are up to date' : 'Drew docs/library/*.svg');
