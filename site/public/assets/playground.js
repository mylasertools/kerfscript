// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// The playground: a code editor, settings made from the customizer comments,
// and the cut file, all rendered in the browser.

import { parameters } from './kerfscript.js';
import { displaySvg } from './display.js';
import { highlight } from './highlight.js';
import { buildControls, setInSource } from './controls.js';
import { createEngine } from './engine.js';
import { zip } from './zip.js';
import { MAX_SOURCE, encode, hasOwn, startCode } from './source.js';

const DRAFT = 'kerfscript-playground';
const root = document.querySelector('[data-playground]');
const $ = (sel) => root.querySelector(sel);
const input = $('[data-input]');
const view = $('[data-view]');
const viewPre = view.parentElement;
const consoleBox = $('[data-console]');
const figure = $('[data-figure]');
const sizeNote = $('[data-size]');
const settings = $('[data-settings]');
const partsBox = $('[data-parts]');
const status = $('[data-status]');
const picker = $('[data-examples]');
const svgButton = $('[data-download="svg"]');
const dxfButton = $('[data-download="dxf"]');
const zipButton = $('[data-download="zip"]');
const sheetPick = $('[data-sheet]');
const sheetsBox = $('[data-sheets]');
const importButton = $('[data-import]');
const importFile = $('[data-import-file]');
const editorBox = $('[data-editor]');
const assemblyBox = $('[data-assembly]');
// The 3D view loads with three.js the first time it is shown
let assemblyView = null;
async function showAssembly() {
  if (!assemblyView) {
    const { createAssemblyView } = await import('./assembly.js');
    assemblyView ??= createAssemblyView(assemblyBox);
  }
  if (last && mode === '3d') assemblyView.show(last);
}
const run = createEngine();
// Set by the desktop app (desktop/src/desktop.js): files on disk instead of
// downloads, and libraries next to the open file.
const host = window.kerfHost;
// The examples for the picker. Without them the page still works, with
// the code from a link, a draft or the line below.
let examples = {};
let examplesProblem = null;
try {
  const res = await fetch('/assets/examples.json');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  examples = await res.json();
} catch (e) {
  examplesProblem = `The examples could not be loaded (${e.message})`;
}
const FALLBACK = 'rect([60, 40]);\n';
// A large drawing can take a while to import; past this it is stopped
const IMPORT_TIMEOUT_MS = 60000;
const MAX_SVG_BYTES = 20_000_000;
// Desktop app only: open the cut file in LightBurn, next to the SVG and DXF buttons
const lightburnButton = host?.lightburn
  ? Object.assign(document.createElement('button'), {
      className: 'button',
      textContent: 'Open in LightBurn',
      disabled: true,
    })
  : null;
if (lightburnButton) dxfButton.after(lightburnButton);

let last = null;
let ready = null;
let mode = 'material';
let shown = -1;
let paramKey = '';
let errorLine = 0;
let timer = 0;
// Counts updates, scheduled or started, so one that waited knows it is out of date
let updates = 0;
// Why a shared link did not open, shown until the code is edited
let notice = null;
// What an SVG import found, also shown until the code is edited
let imported = [];
// The imported drawing's name, for the files to download
let drawingName = null;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (v) => String(Math.round(v * 10) / 10);

const tooLong = () => input.value.length > MAX_SOURCE;

// Code past MAX_SOURCE is shown without colours: it will not run, and
// colouring it would hold up the page
function paint() {
  const lines = (tooLong() ? esc(input.value) : highlight(input.value)).split('\n');
  view.innerHTML = lines
    .map((l, i) => `<span class="ln${i + 1 === errorLine ? ' error' : ''}">${l || ' '}</span>`)
    .join('\n');
}

function setReady(result, source) {
  ready = result ? { result, source } : null;
  svgButton.disabled = !ready;
  dxfButton.disabled = !ready?.result.dxf;
  zipButton.disabled = !ready;
  if (lightburnButton) lightburnButton.disabled = !ready;
}

function current() {
  return ready && ready.source === input.value ? ready.result : null;
}

// The preview fades while it shows older code than the editor
function stale(on) {
  root.classList.toggle('is-stale', on && Boolean(last));
  if (on) status.textContent = 'Rendering…';
}

function edited() {
  notice = null;
  imported = [];
  // A link's code is now older than the editor's: reloading should keep the
  // edits (from the draft), not open the link again
  if (!host && location.hash) history.replaceState(null, '', location.pathname + location.search);
  setReady(null);
  stale(true);
  paint();
  saveDraft();
  host?.changed();
}

// The example in the picker, or "Your code" once the code is edited by hand
function showDesign(slug) {
  picker.value = slug && hasOwn(examples, slug) ? slug : '';
  history.replaceState(null, '', picker.value ? `?model=${picker.value}` : location.pathname);
}

const baseName = () => host?.name() ?? (picker.value || drawingName || 'design');

function syncScroll() {
  viewPre.scrollTop = input.scrollTop;
  viewPre.scrollLeft = input.scrollLeft;
}

function saveDraft() {
  try {
    localStorage.setItem(DRAFT, input.value);
  } catch {}
}

const mm = (v) => `${fmt(v)} mm`;
const partsText = (n) => `${n} ${n === 1 ? 'part' : 'parts'}`;
const sheetLabel = (s, i) =>
  `Sheet ${i + 1}, ${s.material}${s.thickness ? ` ${fmt(s.thickness)} mm` : ''}`;
const sheetFile = (s, i) =>
  `${baseName()}-sheet-${i + 1}-${s.material.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${s.thickness ? `-${fmt(s.thickness)}mm` : ''}`;

function showFigure() {
  const three = mode === '3d';
  figure.hidden = three;
  assemblyBox.hidden = !three;
  if (three) {
    showAssembly().catch((e) => {
      assemblyBox.textContent = `The 3D view could not load: ${e.message}`;
    });
    if (last) {
      const n = last.assembly?.filter((p) => p.placed !== false).length ?? 0;
      sizeNote.textContent = n
        ? `${partsText(n)} assembled${last.steps?.length ? `, in ${last.steps.length} steps` : ''}. Drag to turn it, scroll to zoom.`
        : 'No part has at or rotate, so there is nothing to assemble.';
    }
    return;
  }
  if (!last) {
    figure.replaceChildren();
    return;
  }
  const sheet = last.sheets[shown];
  const svg = sheet ? sheet.svg : last.svg;
  figure.innerHTML =
    mode === 'material'
      ? displaySvg(sheet ? { ...last, sheets: [sheet] } : last, { defs: false })
      : svg.replace(/^<\?xml[^>]*>\s*/, '').replace(/ width="[^"]+mm" height="[^"]+mm"/, '');
  figure.classList.toggle('laser', mode === 'laser');
  const pieces = last.parts.reduce((s, p) => s + p.qty, 0);
  sizeNote.textContent = sheet
    ? `${sheetLabel(sheet, shown)}: ${fmt(sheet.width)} × ${mm(sheet.height)}, ${partsText(sheet.items.length)}`
    : last.sheets.length > 1
      ? `${partsText(pieces)} on ${last.sheets.length} sheets, shown together. Each sheet has its own cut file below.`
      : `${fmt(last.width)} × ${mm(last.height)}, ${partsText(pieces)} on 1 sheet`;
}

// Several sheets: a picker for the preview, and a cut file for each sheet
function showSheets() {
  const many = last.sheets.length > 1;
  // One sheet has no cut file of its own: show the whole result
  if (!many || shown >= last.sheets.length) shown = -1;
  sheetPick.parentElement.hidden = !many;
  svgButton.hidden = many;
  dxfButton.hidden = many;
  // A back-face job comes as a file of its own, so one sheet with back
  // marks downloads as a ZIP too
  const backs = last.sheets.some((s) => s.back);
  zipButton.hidden = !many && !backs;
  zipButton.textContent = many ? 'All sheets (ZIP)' : 'Front and back (ZIP)';
  if (lightburnButton) lightburnButton.hidden = many;
  if (!many) {
    sheetsBox.replaceChildren();
    return;
  }
  sheetPick.innerHTML = [
    '<option value="-1">All sheets</option>',
    ...last.sheets.map((s, i) => `<option value="${i}">${esc(sheetLabel(s, i))}</option>`),
  ].join('');
  sheetPick.value = String(shown);
  const rows = last.sheets.map(
    (s, i) =>
      `<tr><td>${esc(sheetLabel(s, i))}, ${partsText(s.items.length)}</td><td>${fmt(s.width)} × ${fmt(s.height)} mm</td><td><button class="link" data-file="svg" data-index="${i}">SVG</button> · <button class="link" data-file="dxf" data-index="${i}">DXF</button>${s.back ? ` · back: <button class="link" data-file="back-svg" data-index="${i}">SVG</button> · <button class="link" data-file="back-dxf" data-index="${i}">DXF</button>` : ''}${lightburnButton ? ` · <button class="link" data-file="lightburn" data-index="${i}">LightBurn</button>` : ''}</td></tr>`,
  );
  sheetsBox.innerHTML = `<h3>Cut files</h3><table class="parts sheet-files"><thead><tr><th>Sheet</th><th>Size</th><th>Download</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function updateSettings() {
  let params;
  try {
    params = parameters(input.value).parameters;
  } catch {
    return;
  }
  const key = JSON.stringify(
    params.map((p) => [
      p.name,
      p.group,
      p.caption,
      p.min,
      p.max,
      p.step,
      p.options,
      p.type,
      Array.isArray(p.initial) && p.initial.length,
    ]),
  );
  if (key === paramKey) {
    for (const p of params) {
      const control = settings.querySelector(`#ctl-${CSS.escape(p.name)}`);
      if (!control || document.activeElement === control) continue;
      if (control.type === 'checkbox') control.checked = Boolean(p.initial);
      else if (Array.isArray(p.initial)) {
        const boxes = control.parentElement.querySelectorAll('input');
        p.initial.forEach((v, i) => {
          if (boxes[i] && document.activeElement !== boxes[i]) boxes[i].value = String(v);
        });
      } else {
        control.value = String(p.initial);
        const out = control.parentElement.querySelector('output');
        if (out) out.textContent = String(p.initial);
      }
    }
    return;
  }
  paramKey = key;
  const values = Object.fromEntries(params.map((p) => [p.name, p.initial]));
  buildControls(settings, params, values, (name, value) => {
    const next = setInSource(input.value, name, value);
    if (next === input.value) return;
    input.value = next;
    edited();
    if (picker.value) showDesign('');
    schedule(60);
  });
  if (!params.length)
    settings.innerHTML =
      '<p class="hint">Add a comment like <code>// [10:1:100]</code> after a top-level variable to get a slider here.</p>';
}

function showConsole(shown) {
  const lines = [...(notice ? [['error', notice]] : []), ...imported, ...shown];
  consoleBox.innerHTML = lines.length
    ? lines.map(([cls, text]) => `<p class="${cls}">${esc(text)}</p>`).join('')
    : '<p class="quiet">echo() output, warnings and errors show up here.</p>';
}

async function update() {
  const id = ++updates;
  const source = input.value;
  if (tooLong()) {
    setReady(null);
    showConsole([
      ['error', `The code is longer than ${MAX_SOURCE.toLocaleString('en')} characters.`],
    ]);
    status.textContent = 'Error';
    return;
  }
  updateSettings();
  status.textContent = 'Rendering…';
  const files = await host?.libraries(source);
  // A newer update is running: starting this one would cancel it
  if (id !== updates) return;
  const reply = await run(source, {}, files);
  // Code that matches the editor's can still be from an older update: the
  // same text in another file reads other libraries
  if (reply.stale || id !== updates || source !== input.value) return;
  const echoes = (reply.ok ? reply.result.echoes : (reply.echoes ?? [])).map((e) => [
    'echo',
    `ECHO: ${e}`,
  ]);
  if (!reply.ok) {
    setReady(null);
    errorLine = reply.line ?? 0;
    paint();
    showConsole([...echoes, ['error', reply.error]]);
    status.textContent = 'Error';
    root.classList.add('has-error');
    return;
  }
  root.classList.remove('has-error');
  if (errorLine) {
    errorLine = 0;
    paint();
  }
  last = reply.result;
  stale(false);
  showSheets();
  showFigure();
  showConsole([...echoes, ...last.warnings.map((w) => ['warning', `WARNING: ${w}`])]);
  partsBox.innerHTML = last.parts.length
    ? `<table class="parts"><thead><tr><th>Part</th><th>Qty</th><th>Size</th><th>Cut length</th></tr></thead><tbody>${last.parts
        .map(
          (p) =>
            `<tr><td>${esc(p.name)}${p.mirrored ? ' (mirrored)' : ''}</td><td>${p.qty}</td><td>${fmt(p.width)} × ${fmt(p.height)} mm</td><td>${fmt(p.cutLength / 1000)} m</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '';
  setReady(last, source);
  status.textContent = `Rendered in ${Math.max(1, Math.round(reply.ms))} ms`;
}

// A render still running is out of date from now on, even when the code it
// had is the same: a new file can have the same text and other libraries
function schedule(delay = 250) {
  updates++;
  clearTimeout(timer);
  timer = setTimeout(update, delay);
}

function load(text) {
  input.value = text;
  drawingName = null;
  host?.loaded(text, Object.values(examples).includes(text));
  shown = -1;
  setReady(null);
  stale(true);
  errorLine = 0;
  paramKey = '';
  input.scrollTop = 0;
  paint();
  syncScroll();
  schedule(0);
}

input.addEventListener('input', () => {
  edited();
  if (picker.value) showDesign('');
  schedule();
});
input.addEventListener('scroll', syncScroll);
input.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  input.setRangeText('  ', input.selectionStart, input.selectionEnd, 'end');
  input.dispatchEvent(new Event('input'));
});

picker.addEventListener('change', async () => {
  const slug = picker.value;
  if (host && !(await host.release())) {
    picker.value = '';
    return;
  }
  picker.value = slug;
  notice = null;
  imported = [];
  load(examples[picker.value]);
  showDesign(picker.value);
  saveDraft();
});

// Turns an SVG file's bytes into a program, in a worker of its own: an
// import never holds up rendering, and one that runs too long is stopped
function importDrawing(bytes, name) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const done = (reply) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(reply);
    };
    const timer = setTimeout(
      () => done({ ok: false, error: 'it took longer than a minute' }),
      IMPORT_TIMEOUT_MS,
    );
    worker.onmessage = (e) => done(e.data);
    worker.onerror = (e) => {
      e.preventDefault();
      done({ ok: false, error: e.message || 'the importer could not load' });
    };
    worker.postMessage({ svg: bytes, name }, [bytes]);
  });
}

async function openDrawing(file) {
  const failed = (why) => {
    notice = `${file.name} could not be imported: ${why}`;
    showConsole([]);
    status.textContent = 'Import failed';
  };
  if (file.size > MAX_SVG_BYTES) return failed(`it is larger than ${MAX_SVG_BYTES / 1_000_000} MB`);
  importButton.disabled = true;
  status.textContent = 'Importing…';
  const reply = await importDrawing(await file.arrayBuffer(), file.name).finally(
    () => (importButton.disabled = false),
  );
  if (!reply.ok) return failed(reply.error);
  if (host && !(await host.release())) {
    status.textContent = '';
    return;
  }
  load(reply.source);
  showDesign('');
  notice = null;
  drawingName = file.name.replace(/\.svg$/i, '') || null;
  imported = [
    ['note', `Imported ${file.name}: ${reply.summary}`],
    ...reply.notes.map((n) => ['quiet', n]),
  ];
  showConsole([]);
  saveDraft();
}

importButton.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', () => {
  const file = importFile.files[0];
  importFile.value = '';
  if (file) openDrawing(file);
});

// An SVG file dropped on the editor is imported
const dragged = (e) => [...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file');
editorBox.addEventListener('dragover', (e) => {
  if (!dragged(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  editorBox.classList.add('is-drop');
});
editorBox.addEventListener('dragleave', () => editorBox.classList.remove('is-drop'));
editorBox.addEventListener('drop', (e) => {
  editorBox.classList.remove('is-drop');
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  e.preventDefault();
  if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') openDrawing(file);
  else {
    notice = `${file.name} is not an SVG file: drop an .svg drawing to import it`;
    showConsole([]);
  }
});

sheetPick.addEventListener('change', () => {
  shown = Number(sheetPick.value);
  showFigure();
});

for (const tab of root.querySelectorAll('[data-view]'))
  tab.addEventListener('click', () => {
    mode = tab.dataset.view;
    for (const t of root.querySelectorAll('[data-view]'))
      t.setAttribute('aria-selected', String(t === tab));
    showFigure();
  });

function download(name, data, type) {
  if (host) return host.save(name, data);
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

root
  .querySelector('[data-download="kerf"]')
  .addEventListener('click', () => download(`${baseName()}.kerf`, input.value, 'text/plain'));
svgButton.addEventListener('click', () => {
  const result = current();
  if (result) download(`${baseName()}.svg`, result.svg, 'image/svg+xml');
});
dxfButton.addEventListener('click', () => {
  const result = current();
  if (result?.dxf) download(`${baseName()}.dxf`, result.dxf, 'application/dxf');
});
lightburnButton?.addEventListener('click', () => {
  const result = current();
  if (result) host.lightburn(`${baseName()}.svg`, result.svg, lightburnButton);
});
zipButton.addEventListener('click', () => {
  const result = current();
  if (!result) return;
  const one = result.sheets.length === 1;
  const files = result.sheets.flatMap((s, i) => {
    const name = one ? baseName() : sheetFile(s, i);
    return [
      { name: `${name}.svg`, text: one ? result.svg : s.svg },
      ...(one && !result.dxf ? [] : [{ name: `${name}.dxf`, text: one ? result.dxf : s.dxf }]),
      ...(s.back
        ? [
            { name: `${name}-back.svg`, text: s.back.svg },
            { name: `${name}-back.dxf`, text: s.back.dxf },
          ]
        : []),
    ];
  });
  download(`${baseName()}-sheets.zip`, zip(files));
});
sheetsBox.addEventListener('click', (e) => {
  const button = e.target.closest('[data-file]');
  const result = current();
  if (!button || !result) return;
  const i = Number(button.dataset.index);
  const s = result.sheets[i];
  if (button.dataset.file === 'lightburn') host.lightburn(`${sheetFile(s, i)}.svg`, s.svg, button);
  else if (button.dataset.file === 'back-svg')
    download(`${sheetFile(s, i)}-back.svg`, s.back.svg, 'image/svg+xml');
  else if (button.dataset.file === 'back-dxf')
    download(`${sheetFile(s, i)}-back.dxf`, s.back.dxf, 'application/dxf');
  else if (button.dataset.file === 'svg')
    download(`${sheetFile(s, i)}.svg`, s.svg, 'image/svg+xml');
  else download(`${sheetFile(s, i)}.dxf`, s.dxf, 'application/dxf');
});
root.querySelector('[data-share]').addEventListener('click', async (e) => {
  // A link to code past MAX_SOURCE would not open
  if (tooLong()) {
    e.target.textContent = 'Code too long to share';
    setTimeout(() => (e.target.textContent = 'Copy link'), 2000);
    return;
  }
  const url = `${host?.shareBase ?? location.origin + location.pathname}#${await encode(input.value)}`;
  if (!host) history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    e.target.textContent = 'Link copied';
  } catch {
    e.target.textContent = 'Link in address bar';
  }
  setTimeout(() => (e.target.textContent = 'Copy link'), 2000);
});

const model = new URLSearchParams(location.search).get('model');
host?.attach({
  load(text) {
    load(text);
    showDesign('');
  },
  source: () => input.value,
  // Render again, as when the libraries the code uses have changed
  refresh() {
    setReady(null);
    stale(true);
    schedule(0);
  },
});
let draft = null;
try {
  draft = localStorage.getItem(DRAFT);
} catch {}
const { code: start, problem } = await startCode({
  file: host ? await host.initial() : null,
  hash: location.hash.slice(1),
  model,
  examples,
  draft,
  fallback: FALLBACK,
});
picker.value = Object.keys(examples).find((slug) => examples[slug] === start) ?? '';
const instead = picker.value ? 'an example' : start === draft ? 'your last code' : 'a new design';
notice =
  [problem && `${problem}. Showing ${instead} instead.`, examplesProblem]
    .filter(Boolean)
    .join('. ') || null;
load(start);
