// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Builds form controls from KerfScript customizer parameters.

import { parameters } from './kerfscript.js';

const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  node.append(...kids);
  return node;
};

const label = (name) => name.replace(/_+/g, ' ').replace(/^./, (c) => c.toUpperCase());

// The number in a number box, or NaN while it is empty or half typed (the
// browser gives "" for "-" or "1e"), so the code keeps its last number
const typed = (input) => (input.value.trim() === '' ? NaN : Number(input.value));

export function buildControls(container, params, values, onChange) {
  container.replaceChildren();
  let group = null;
  let box = container;
  const set = (name, value) => {
    values[name] = value;
    onChange(name, value);
  };
  for (const p of params) {
    if (p.group !== group) {
      group = p.group;
      box = el('fieldset', { class: 'control-group' }, el('legend', { text: group }));
      container.append(box);
    }
    const id = `ctl-${p.name}`;
    const row = el('div', { class: 'control' });
    const title = el(
      'label',
      { for: id },
      el('span', { class: 'control-name', text: label(p.name) }),
    );
    if (p.caption) title.append(el('span', { class: 'control-caption', text: p.caption }));
    const value = values[p.name] ?? p.initial;
    if (p.options) {
      const select = el('select', { id });
      for (const o of p.options) {
        const opt = el('option', { value: String(o.value), text: o.name });
        if (String(o.value) === String(value)) opt.selected = true;
        select.append(opt);
      }
      select.addEventListener('change', () => {
        const o = p.options.find((x) => String(x.value) === select.value);
        set(p.name, o ? o.value : select.value);
      });
      row.append(title, select);
    } else if (p.type === 'boolean') {
      const box2 = el('input', { id, type: 'checkbox' });
      box2.checked = Boolean(value);
      box2.addEventListener('change', () => set(p.name, box2.checked));
      row.classList.add('toggle');
      row.append(box2, title);
    } else if (p.type === 'string') {
      const input = el('input', { id, type: 'text', value: String(value) });
      input.addEventListener('input', () => set(p.name, input.value));
      row.append(title, input);
    } else if (Array.isArray(p.initial)) {
      const list = el('div', { class: 'vector' });
      // Each change sends what all the boxes show now: the code may have
      // changed the other numbers since the controls were made
      const current = () => [...list.querySelectorAll('input')].map(typed);
      [...value].forEach((v, i) => {
        const input = el('input', {
          type: 'number',
          value: v,
          step: p.step ?? 'any',
          min: p.min,
          max: p.max,
          'aria-label': `${label(p.name)} ${i + 1}`,
        });
        if (i === 0) input.id = id;
        input.addEventListener('input', () => {
          const next = current();
          if (next.every(Number.isFinite)) set(p.name, next);
        });
        list.append(input);
      });
      row.append(title, list);
    } else if (p.min !== undefined && p.max !== undefined) {
      const out = el('output', { for: id, text: String(value) });
      const range = el('input', {
        id,
        type: 'range',
        min: p.min,
        max: p.max,
        step: p.step ?? 'any',
        value,
      });
      range.addEventListener('input', () => {
        out.textContent = range.value;
        set(p.name, Number(range.value));
      });
      title.append(out);
      // The setting that drives the model (// [0:5:360] drive) plays: it
      // steps round its range, the model following, until stopped
      if (p.drive) {
        const play = el('button', { type: 'button', class: 'play', text: 'Play' });
        let timer;
        const stop = () => {
          clearInterval(timer);
          timer = undefined;
          play.textContent = 'Play';
        };
        play.addEventListener('click', () => {
          if (timer) return stop();
          play.textContent = 'Stop';
          const step = Number(p.step ?? (p.max - p.min) / 24) || 1;
          timer = setInterval(() => {
            if (!range.isConnected) return stop();
            let v = Number(range.value) + step;
            if (v > p.max + 1e-9) v = p.min;
            range.value = String(v);
            out.textContent = range.value;
            set(p.name, v);
          }, 150);
        });
        title.append(play);
      }
      row.append(title, range);
    } else {
      const input = el('input', { id, type: 'number', value, step: p.step ?? 'any' });
      input.addEventListener('input', () => {
        const n = typed(input);
        if (Number.isFinite(n)) set(p.name, n);
      });
      row.append(title, input);
    }
    box.append(row);
  }
}

// Writes a value back into its top-level assignment, so code and controls
// agree. Only the value the parser found is replaced.
export function setInSource(source, name, value) {
  let found;
  try {
    found = parameters(source)
      .parameters.filter((p) => p.name === name)
      .pop();
  } catch {
    return source;
  }
  if (!found) return source;
  const literal = Array.isArray(value)
    ? `[${value.join(', ')}]`
    : typeof value === 'string'
      ? JSON.stringify(value)
      : String(value);
  const [start, end] = found.span;
  return source.slice(0, start) + literal + source.slice(end);
}
