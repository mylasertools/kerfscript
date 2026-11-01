// Builds a form from the design's customizer comments, renders on every
// change and offers the cut files for download. Serve this folder over HTTP;
// browsers do not load modules from file:// pages.

import { parameters, render } from '@mylasertools/kerfscript';

const design = await (await fetch('coaster.kerf')).text();
const form = document.getElementById('settings');
const preview = document.getElementById('preview');
const message = document.getElementById('message');
const values = {};
let result = null;

// One input per setting: a slider, a checkbox, a menu or a text field
for (const p of parameters(design).parameters) {
  values[p.name] = p.initial;
  const label = document.createElement('label');
  label.textContent = p.caption || p.name;
  let input;
  if (p.options) {
    input = document.createElement('select');
    for (const o of p.options) input.add(new Option(o.name ?? String(o.value), String(o.value)));
    input.value = String(p.initial);
  } else {
    input = document.createElement('input');
    if (p.type === 'boolean') {
      input.type = 'checkbox';
      input.checked = p.initial;
    } else if (p.type === 'number') {
      input.type = p.max !== undefined ? 'range' : 'number';
      Object.assign(input, { min: p.min ?? '', max: p.max ?? '', step: p.step ?? 'any' });
      input.value = p.initial;
    } else input.value = p.initial;
  }
  input.name = p.name;
  input.addEventListener('input', () => {
    const raw = input.type === 'checkbox' ? input.checked : input.value;
    values[p.name] = p.type === 'number' ? Number(raw) : raw;
    update();
  });
  label.append(input);
  form.insertBefore(label, message);
}

function update() {
  try {
    result = render(design, { params: values });
    preview.innerHTML = result.svg;
    message.textContent = result.warnings.join(' ');
  } catch (e) {
    result = null;
    message.textContent = e.message;
  }
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

document.getElementById('svg').onclick = () =>
  result && download('coaster.svg', result.svg, 'image/svg+xml');
document.getElementById('dxf').onclick = () =>
  result && download('coaster.dxf', result.sheets[0].dxf, 'application/dxf');

update();
