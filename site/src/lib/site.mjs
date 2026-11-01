// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Everything the pages share. Every model picture is rendered here by the
// KerfScript in the repository's dist/, from examples/, when the site builds.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Marked } from 'marked';
import { LANGUAGE_VERSION, VERSION, parameters, render } from '../../../dist/index.js';
import { displaySvg } from '../../public/assets/display.js';
import { highlight } from '../../public/assets/highlight.js';

export { LANGUAGE_VERSION, VERSION, highlight };

const repo = join(process.cwd(), '..');
export const BASE = 'https://kerfscript.mylasertools.com';
export const REPO_URL = 'https://github.com/mylasertools/kerfscript';
// Flip when the repository is public and the package is on npm: pages then
// link to both instead of saying they are coming.
export const SOURCE_PUBLIC = true;
export const NPM_URL = 'https://www.npmjs.com/package/@mylasertools/kerfscript';
export const read = (path) => readFileSync(join(repo, path), 'utf8').replace(/\r\n/g, '\n');

export const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
export const fmt = (v) => (Math.round(v * 10) / 10).toString();

export const LOGO = `<img class="logo" src="/brand/inline.svg" alt="KerfScript" width="194" height="40">`;

export function code(src, { numbers = false } = {}) {
  const html = highlight(src.replace(/\n$/, ''));
  if (!numbers) return `<pre class="code"><code>${html}</code></pre>`;
  const lines = html.split('\n');
  return `<pre class="code numbered"><code>${lines.map((l) => `<span class="ln">${l || ' '}</span>`).join('\n')}</code></pre>`;
}

// Guides: docs/<slug>.md in the repository, in reading order.
export const GUIDES = [
  ['getting-started', 'Getting started'],
  ['layers', 'Layers'],
  ['kerf', 'Kerf'],
  ['parts-and-sheets', 'Parts and sheets'],
  ['customizer', 'Settings'],
  ['desktop', 'Desktop app'],
  ['cli', 'Command line'],
  ['javascript', 'JavaScript API'],
  ['editors', 'Editors'],
  ['webassembly', 'WebAssembly'],
  ['openscad', 'Coming from OpenSCAD'],
  ['compatibility', 'Laser software'],
  ['versions', 'Versions'],
  ['specification', 'Specification'],
];

const slug = (text) =>
  text
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const LINKS = {
  'TRADEMARKS.md': '/licence/#trademark-policy',
  LICENSE: 'https://www.gnu.org/licenses/agpl-3.0.html',
  'COMMERCIAL-LICENSE.md': '/licence/',
  'CLA.md': `${REPO_URL}/blob/main/CLA.md`,
  'CONTRIBUTING.md': `${REPO_URL}/blob/main/CONTRIBUTING.md`,
  'LANGUAGE.md': '/docs/reference/',
};

function linkTarget(href) {
  const [path, hash] = href.split('#');
  if (LINKS[path]) return hash ? `${LINKS[path].split('#')[0]}#${hash}` : LINKS[path];
  const guide = /^(?:\.\.\/)?(?:docs\/)?([a-z-]+)\.md$/.exec(path);
  if (guide && GUIDES.some(([s]) => s === guide[1]))
    return `/docs/${guide[1]}/${hash ? `#${hash}` : ''}`;
  if (/^(?:\.\.\/)?LANGUAGE\.md$/.test(path)) return `/docs/reference/${hash ? `#${hash}` : ''}`;
  // The conformance suite lives in the repository, not on the site
  if (/^(?:\.\.\/)?conformance\//.test(path))
    return `${REPO_URL}/blob/main/${path.replace(/^\.\.\//, '')}${hash ? `#${hash}` : ''}`;
  if (/^(?:\.\.\/)?examples\/([a-z-]+)\.kerf$/.test(path))
    return `/models/${path.replace(/^.*examples\//, '').replace(/\.kerf$/, '')}/`;
  return /^https?:|^#|^\/|^mailto:/.test(href) ? href : null;
}

export const marked = new Marked({
  renderer: {
    code({ text, lang }) {
      return lang === 'kerf'
        ? code(text)
        : `<pre class="code plain"><code>${esc(text)}</code></pre>`;
    },
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const id = slug(text);
      return `<h${depth} id="${id}"><a class="anchor" href="#${id}">${text}</a></h${depth}>\n`;
    },
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens);
      const target = linkTarget(href);
      return target ? `<a href="${esc(target)}">${text}</a>` : text;
    },
  },
});

export function markdown(path) {
  const html = marked.parse(read(path));
  const title = /<h1[^>]*>(?:<a[^>]*>)?(.*?)(?:<\/a>)?<\/h1>/
    .exec(html)?.[1]
    .replace(/<[^>]+>/g, '');
  const toc = [...html.matchAll(/<h([23]) id="([^"]+)">(.*?)<\/h[23]>/g)].map(
    ([, level, id, text]) => ({
      level: Number(level),
      id,
      text: text.replace(/<[^>]+>/g, ''),
    }),
  );
  const first = /<p>(.*?)<\/p>/s.exec(html)?.[1] ?? '';
  const plain = first
    .replace(/<[^>]+>/g, '')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  let lead = '';
  for (const sentence of plain.match(/.+?[.!?](?=\s|$)\s*/g) ?? [plain]) {
    if (lead && (lead + sentence).length > 200) break;
    lead += sentence;
  }
  return { html, title, toc, lead: lead.trim() };
}

// Models

const FONT_FILE = 'AtkinsonHyperlegible-Regular.ttf';
const FONTS = {
  fonts: { Atkinson: readFileSync(join(repo, 'fonts', FONT_FILE)) },
  defaultFont: 'Atkinson',
};

function summary(src) {
  const lines = [];
  for (const line of src.split('\n')) {
    const m = /^\/\/\s?(.*)$/.exec(line.trim());
    if (!m) break;
    lines.push(m[1]);
  }
  return lines.join(' ');
}

// A sheet about as wide as it is tall for the pictures, so many parts do not
// end up in one long row.
function tidySheet(parts) {
  const sizes = parts.flatMap((p) => Array(p.qty).fill(p));
  const area = sizes.reduce((s, p) => s + (p.width + 6) * (p.height + 6), 0);
  const widest = Math.max(...sizes.map((p) => Math.max(p.width, p.height) + 6));
  return [Math.max(widest, Math.sqrt(area) * 1.35), 100000];
}

export const models = JSON.parse(read('site/models.json')).map((m) => {
  const source = read(`examples/${m.file}.kerf`);
  const first = render(source, { ...FONTS, margin: 0, gap: 6 });
  const shown =
    first.parts.length > 1
      ? render(source, { ...FONTS, margin: 0, gap: 6, sheet: tidySheet(first.parts) })
      : first;
  const file = render(source, FONTS);
  if (file.warnings.length) throw new Error(`${m.file}: ${file.warnings.join('; ')}`);
  const count = file.parts.reduce((s, p) => s + p.qty, 0);
  const only = file.parts.length === 1 && count === 1 ? file.parts[0] : null;
  return {
    ...m,
    slug: m.file,
    source,
    summary: summary(source),
    lines: source.trim().split('\n').length,
    params: parameters(source).parameters,
    parts: file.parts,
    count,
    // One part: its own size. Several: how many, since the card picture is
    // a compact arrangement, not the layout of the cut file.
    cardMeta: only ? `${fmt(only.width)} × ${fmt(only.height)} mm` : `${count} parts`,
    thumb: displaySvg(shown, { defs: false }),
    display: displaySvg(file, { defs: false }),
    width: file.width,
    height: file.height,
    sheets: file.sheets.length,
    laser: file.svg,
    dxf: file.sheets.length === 1 ? file.sheets[0].dxf : null,
    // The assembled model from Blender (site/3d), when it has been built
    assembled: existsSync(join(process.cwd(), 'public/3d', `${m.file}.webp`)),
    glb: existsSync(join(process.cwd(), 'public/3d', `${m.file}.glb`)),
    // Several sheets: one SVG and DXF per sheet, the files to cut from.
    sheetFiles:
      file.sheets.length > 1
        ? file.sheets.map((s, i) => ({
            name: `${m.file}-sheet-${i + 1}`,
            width: s.width,
            height: s.height,
            pieces: s.items.length,
            svg: s.svg,
            dxf: s.dxf,
          }))
        : [],
  };
});
