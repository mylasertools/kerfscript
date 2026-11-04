// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Material / laser file / build it switch on model pages. Build it runs
// the model's program in the browser and shows it assembled in 3D, a
// step at a time.

for (const box of document.querySelectorAll('[data-views]')) {
  const tabs = box.querySelectorAll('[data-view]');
  for (const tab of tabs)
    tab.addEventListener('click', () => {
      for (const t of tabs) t.setAttribute('aria-selected', String(t === tab));
      for (const panel of box.querySelectorAll('[data-panel]')) {
        panel.hidden = panel.dataset.panel !== tab.dataset.view;
        if (!panel.hidden && panel.dataset.build !== undefined) build(panel);
      }
    });
}

async function build(panel) {
  if (panel.dataset.built) return;
  panel.dataset.built = 'yes';
  panel.textContent = 'Building the model…';
  try {
    const [{ createEngine }, { createAssemblyView }, source] = await Promise.all([
      import('./engine.js'),
      import('./assembly.js'),
      fetch(panel.dataset.build).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      }),
    ]);
    const reply = await createEngine()(source, {});
    if (!reply.ok) throw new Error(reply.error);
    panel.textContent = '';
    createAssemblyView(panel).show(reply.result);
  } catch (e) {
    panel.textContent = `The model could not be built here: ${e.message}`;
  }
}
