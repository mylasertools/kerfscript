// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Plain-text companions to the public HTML pages. Guides and model details
// come from the same source files used to build the HTML site.

import {
  BASE,
  GUIDES,
  LANGUAGE_VERSION,
  NPM_URL,
  REPO_URL,
  VERSION,
  fmt,
  models,
  read,
} from './site.mjs';

const html = (path) => `${BASE}${path}`;
const md = (path) => `${BASE}${path}index.md`;
const page = (path, body) => `> Canonical HTML: ${html(path)}\n\n${body.trim()}\n`;

// The repository's guides contain relative links intended for GitHub. Point
// readers of the website's Markdown copies at working public URLs instead.
function publicLinks(source) {
  return source.replace(/\]\(([^)]+)\)/g, (match, target) => {
    const [path, fragment = ''] = target.split('#');
    const hash = fragment ? `#${fragment}` : '';
    if (/^(?:\.\.\/)?(?:docs\/)?([a-z-]+)\.md$/.test(path)) {
      const slug = path
        .replace(/^.*docs\//, '')
        .replace(/^\.\.\//, '')
        .replace(/\.md$/, '');
      if (GUIDES.some(([name]) => name === slug)) return `](${md(`/docs/${slug}/`)}${hash})`;
    }
    if (/^(?:\.\.\/)?LANGUAGE\.md$/.test(path)) return `](${md('/docs/reference/')}${hash})`;
    const example = /^(?:\.\.\/)?examples\/([a-z-]+)\.kerf$/.exec(path);
    if (example) return `](${html(`/models/${example[1]}/${example[1]}.kerf`)}${hash})`;
    if (path === 'LICENSE') return `](${REPO_URL}/blob/main/LICENSE${hash})`;
    if (['CLA.md', 'COMMERCIAL-LICENSE.md', 'TRADEMARKS.md'].includes(path))
      return `](${REPO_URL}/blob/main/${path}${hash})`;
    return match;
  });
}

export function guideMarkdown(slug) {
  const file = slug === 'reference' ? 'LANGUAGE.md' : `docs/${slug}.md`;
  return page(`/docs/${slug}/`, publicLinks(read(file)));
}

export function docsMarkdown() {
  const entries = [...GUIDES, ['reference', 'Language reference']];
  return page(
    '/docs/',
    `# KerfScript documentation\n\nBuild a part, add engraving, measure kerf and export a cut file.\n\n${entries.map(([slug, title]) => `- [${title}](${md(`/docs/${slug}/`)})`).join('\n')}`,
  );
}

export function modelMarkdown(model) {
  const path = `/models/${model.slug}/`;
  const source = html(`${path}${model.slug}.kerf`);
  const files = model.sheetFiles.length
    ? model.sheetFiles.flatMap((sheet) => [
        `- [${sheet.name}.svg](${html(`${path}${sheet.name}.svg`)})`,
        `- [${sheet.name}.dxf](${html(`${path}${sheet.name}.dxf`)})`,
      ])
    : [
        `- [SVG](${html(`${path}${model.slug}.svg`)})`,
        `- [DXF](${html(`${path}${model.slug}.dxf`)})`,
      ];
  const parts = model.parts.map(
    (part) => `| ${part.name} | ${part.qty} | ${fmt(part.width)} × ${fmt(part.height)} mm |`,
  );
  const settings = model.params.map((param) => {
    const range = param.options
      ? param.options.map((option) => option.name).join(', ')
      : param.min !== undefined && param.max !== undefined
        ? `${param.min} to ${param.max}`
        : param.type === 'boolean'
          ? 'on or off'
          : '';
    return `| \`${param.name}\` | \`${JSON.stringify(param.initial)}\` | ${range} |`;
  });
  return page(
    path,
    `# ${model.title}\n\n${model.summary}\n\n` +
      `This design has ${model.count} ${model.count === 1 ? 'part' : 'parts'} on ${model.sheets} ${model.sheets === 1 ? 'sheet' : 'sheets'}. ` +
      `Customize it in the [playground](${html(`/playground/?model=${model.slug}`)}).\n\n` +
      `## Downloads\n\n- [KerfScript source](${source})\n${files.join('\n')}\n\n` +
      `## Parts\n\n| Part | Quantity | Size |\n| --- | ---: | --- |\n${parts.join('\n')}\n\n` +
      (settings.length
        ? `## Settings\n\n| Name | Default | Range or choices |\n| --- | --- | --- |\n${settings.join('\n')}\n\n`
        : '') +
      `## Source\n\n\`\`\`kerf\n${model.source.trimEnd()}\n\`\`\`\n\n` +
      `Set power, speed and cut order in your laser software. See the [laser software guide](${md('/docs/compatibility/')}).`,
  );
}

export function modelsMarkdown() {
  return page(
    '/models/',
    `# Models made with KerfScript\n\n` +
      `Choose a model to see its parts, settings and source code. Customize it in the playground or download a cut file.\n\n` +
      models
        .map((model) => `- [${model.title}](${md(`/models/${model.slug}/`)}): ${model.summary}`)
        .join('\n'),
  );
}

export function homeMarkdown() {
  return page(
    '/',
    `# KerfScript\n\n` +
      `KerfScript is a programming language for laser cutting. Design a part once, then change its size, text or material thickness. ` +
      `It handles cut, score and engrave layers and exports SVG or DXF.\n\n` +
      `- [Try the browser playground](${html('/playground/')})\n` +
      `- [Browse ${models.length} models](${md('/models/')})\n` +
      `- [Read the documentation](${md('/docs/')})\n` +
      `- [Source code](${REPO_URL})\n` +
      `- [npm package](${NPM_URL})\n\n` +
      `The syntax is familiar to OpenSCAD users, but existing files may need changes. ` +
      `See the [OpenSCAD guide](${md('/docs/openscad/')}).\n\n` +
      `KerfScript ${VERSION} implements language version ${LANGUAGE_VERSION}. It is available under GNU AGPL 3.0 or a free commercial licence (email hi@mylasertools.com). ` +
      `Designs and generated files remain yours. See [licence details](${md('/licence/')}).`,
  );
}

export function aboutMarkdown() {
  return page(
    '/about/',
    `# About KerfScript\n\n` +
      `KerfScript is a programming language for laser cutting, designed and maintained by [MyLaserTools](https://mylasertools.com). ` +
      `It lets you describe designs in code, adjust dimensions and export SVG or DXF. Layers, kerf compensation and joinery are built in.\n\n` +
      `Version ${VERSION} implements language version ${LANGUAGE_VERSION}. Read the [version policy](${md('/docs/versions/')}) and [laser software guide](${md('/docs/compatibility/')}).\n\n` +
      `The [source and issue tracker](${REPO_URL}) are public. Install the package with \`npm install @mylasertools/kerfscript\`. ` +
      `For a problem, open an issue or email hi@mylasertools.com. See the [licence](${md('/licence/')}).`,
  );
}

export function playgroundMarkdown() {
  return page(
    '/playground/',
    `# KerfScript playground\n\n` +
      `The [interactive playground](${html('/playground/')}) runs in your browser. Start from a model, write KerfScript or import an SVG drawing, ` +
      `change settings and download .kerf, SVG or DXF files. No installation is needed.\n\n` +
      `- [Choose a model](${md('/models/')})\n- [Getting started](${md('/docs/getting-started/')})\n` +
      `- [Laser software notes](${md('/docs/compatibility/')})`,
  );
}

export function licenceMarkdown() {
  return page(
    '/licence/',
    publicLinks(read('COMMERCIAL-LICENSE.md')) + '\n\n---\n\n' + publicLinks(read('TRADEMARKS.md')),
  );
}

export function llmsText() {
  const guides = [...GUIDES, ['reference', 'Language reference']];
  return (
    `# KerfScript\n\n> A programming language for laser cutting. Write parametric 2D designs with cut, score and engrave layers, kerf compensation, joinery and sheet layout. Export SVG or DXF.\n\n` +
    `The canonical site is ${BASE}/. Markdown versions of the public pages are linked below. The source is ${REPO_URL}; the npm package is ${NPM_URL}.\n\n` +
    `## Start here\n\n- [Overview](${md('/')})\n- [About](${md('/about/')})\n` +
    `- [Documentation index](${md('/docs/')})\n- [Model index](${md('/models/')})\n` +
    `- [Playground](${md('/playground/')})\n- [Licence](${md('/licence/')})\n\n` +
    `- [Full text of the public pages](${BASE}/llms-full.txt)\n\n` +
    `## Guides\n\n${guides.map(([slug, title]) => `- [${title}](${md(`/docs/${slug}/`)})`).join('\n')}\n\n` +
    `## Models\n\n${models.map((model) => `- [${model.title}](${md(`/models/${model.slug}/`)}): ${model.summary}`).join('\n')}\n`
  );
}

export function markdownResponse(body) {
  return new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}
