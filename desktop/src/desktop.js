// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// The desktop app's side of the playground. It runs before playground.js
// and gives it window.kerfHost: .kerf files on disk with Open and Save, a save
// dialog instead of downloads, `use <...>` / `include <...>` libraries from the
// design's folder, Open in LightBurn, and an About window with the licences.
// The page never names a file path: the dialogs and the files they allow are
// handled in Rust (src-tauri/src/files.rs).

(() => {
  const { core, dialog, event, opener } = window.__TAURI__;
  const win = window.__TAURI__.window.getCurrentWindow();
  const SITE = 'https://kerfscript.mylasertools.com';
  const SOURCE = 'https://github.com/mylasertools/kerfscript';
  // Libraries a design may read in one go
  const MAX_LIBRARIES = 64;
  const MAX_LIBRARY_TEXT = 4_000_000;

  let name = null; // the open design's file name without .kerf, or null if untitled
  let saved = null; // its text when it was opened, saved or loaded from an example
  let pg = null; // the playground: load(text), source(), refresh()
  let busy = false; // a file dialog is open
  let waiting = false; // the system asked to open a file while one was

  const dirty = () => pg !== null && pg.source() !== (saved ?? '');
  const title = () =>
    win.setTitle(`${name ? `${name}.kerf` : 'Untitled'}${dirty() ? ' •' : ''} - KerfScript`);

  async function discardOk() {
    if (!dirty()) return true;
    return dialog.ask(
      `${name ? `${name}.kerf has` : 'This design has'} unsaved changes. Discard them?`,
      { title: 'KerfScript', kind: 'warning', okLabel: 'Discard', cancelLabel: 'Cancel' },
    );
  }

  // Shows why a command failed. The result is null: nothing was opened or saved.
  const failed = (what) => async (e) => {
    await dialog.message(String(e), { title: `Could not ${what}`, kind: 'error' }).catch(() => {});
    return null;
  };

  // Runs one file dialog at a time: another Open or Save while one is open
  // would act on the design the first one is changing. A file the system
  // asked to open meanwhile opens after it.
  async function single(task) {
    if (busy) return null;
    busy = true;
    try {
      return await task();
    } finally {
      busy = false;
      if (waiting) {
        waiting = false;
        openPending();
      }
    }
  }

  function show(design) {
    name = design.name;
    saved = design.text;
    pg.load(design.text);
    title();
  }

  const open = () =>
    single(async () => {
      if (!(await discardOk())) return;
      const design = await core.invoke('open_design').catch(failed('open the file'));
      if (design) show(design);
    });

  // A file the system asks the app to open: macOS's Open With, or a double
  // click while the app is running
  const openPending = () => {
    if (busy) {
      waiting = true;
      return Promise.resolve(null);
    }
    return single(async () => {
      if (!pg) return; // the page takes it with initial() once it is ready
      if (!(await discardOk())) return core.invoke('clear_pending');
      const design = await core.invoke('open_pending').catch(failed('open the file'));
      if (design) show(design);
    });
  };

  const save = (as) =>
    single(async () => {
      const text = pg.source();
      // A save dialog can put the file in another folder, even under the
      // same name
      const dialogShown = as || name == null;
      const result = await core
        .invoke('save_design', { text, saveAs: dialogShown, name: name ?? 'design' })
        .catch(failed('save the file'));
      if (!result) return false;
      name = result;
      saved = text;
      title();
      // In a new folder, the design's libraries may now be found
      if (dialogShown) pg.refresh();
      return true;
    });

  async function exportFile(fileName, data) {
    const args =
      typeof data === 'string'
        ? { name: fileName, text: data }
        : {
            name: fileName,
            bytes: Array.from(
              new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data),
            ),
          };
    await single(() => core.invoke('export_file', args).catch(failed('save the file')));
  }

  // The libraries a program uses (`use <path>` and `include <path>`, found by
  // KerfScript's tokenizer so comments and strings don't count), read from the
  // design's folder or its project's kerf_libraries (files.rs finds them as
  // kerf render does). Standard library paths are not files: the renderer looks
  // them up first, so a failed read here is fine.
  async function libraries(source) {
    if (name === null) return undefined;
    const { tokenize } = await import('/assets/kerfscript.js');
    const imports = (text) => {
      try {
        const { tokens } = tokenize(text);
        return tokens
          .filter(
            (t, i) =>
              t.type === 'str' &&
              tokens[i - 1]?.type === 'id' &&
              (tokens[i - 1].value === 'use' || tokens[i - 1].value === 'include'),
          )
          .map((t) => t.value);
      } catch {
        return [];
      }
    };
    const files = {};
    const queue = [source];
    let count = 0;
    let size = 0;
    while (queue.length) {
      for (const p of imports(queue.pop())) {
        if (p in files || p.startsWith('kerf/')) continue;
        files[p] = null;
        if (++count > MAX_LIBRARIES) break;
        try {
          const text = await core.invoke('read_library', { path: p });
          size += text.length;
          if (size > MAX_LIBRARY_TEXT) break;
          files[p] = text;
          queue.push(text);
        } catch {}
      }
    }
    for (const p of Object.keys(files)) if (files[p] === null) delete files[p];
    return files;
  }

  // LightBurn 2.2 and later: open the cut file there through its REST API
  // (src-tauri/src/lightburn.rs). The first time, LightBurn asks the user to
  // allow KerfScript; the job is always started by the user in LightBurn.
  const LIGHTBURN_ERRORS = {
    'not-running':
      'LightBurn is not running. Start LightBurn 2.2 or later, then try again. Older versions cannot receive files from other apps.',
    declined:
      "LightBurn did not allow KerfScript to send files. Try again and choose Allow in LightBurn's window; it closes after 30 seconds, and may be behind other windows.",
    'needs-pairing':
      'LightBurn did not accept KerfScript. In LightBurn, open Settings → Extensions → Manage API Authorizations, remove KerfScript, then try again.',
  };

  async function lightburn(fileName, svg, button) {
    const label = button.textContent;
    const send = () => core.invoke('lightburn_open', { name: fileName, contents: svg });
    button.disabled = true;
    try {
      button.textContent = 'Sending…';
      try {
        await send();
      } catch (e) {
        if (e !== 'needs-pairing') throw e;
        button.textContent = 'Allow in LightBurn…';
        await core.invoke('lightburn_pair');
        button.textContent = 'Sending…';
        await send();
      }
      button.textContent = 'Opened in LightBurn';
      setTimeout(() => (button.textContent = label), 2500);
    } catch (e) {
      button.textContent = label;
      await dialog.message(LIGHTBURN_ERRORS[e] ?? String(e), {
        title: 'Open in LightBurn',
        kind: 'warning',
      });
    } finally {
      button.disabled = false;
    }
  }

  // About: version, source code and the licences shipped with the app
  const LEGAL = [
    ['LICENSE', 'GNU AGPL 3.0'],
    ['COMMERCIAL-LICENSE.md', 'Your designs and commercial use'],
    ['THIRD-PARTY-NOTICES.md', 'Third-party notices'],
    ['THIRD-PARTY-LICENSES.md', 'Rust crates in the app'],
    ['OFL.txt', 'Atkinson Hyperlegible font'],
  ];

  async function about() {
    let box = document.querySelector('dialog.about');
    if (!box) {
      box = document.createElement('dialog');
      box.className = 'about';
      box.innerHTML = `<h2>KerfScript <span data-version></span></h2>
<p>KerfScript is free software under the GNU Affero General Public License 3.0,
with the additional permission in COMMERCIAL-LICENSE.md. Its source code is at
<a href="${SOURCE}">${SOURCE.replace('https://', '')}</a>.</p>
<p class="about-files"></p>
<pre class="about-text" hidden></pre>
<form method="dialog"><button class="button">Close</button></form>`;
      const files = box.querySelector('.about-files');
      for (const [file, label] of LEGAL) {
        const b = Object.assign(document.createElement('button'), {
          className: 'link',
          textContent: label,
          type: 'button',
        });
        b.addEventListener('click', async () => {
          const pre = box.querySelector('.about-text');
          pre.textContent = await core.invoke('legal_file', { name: file }).catch((e) => String(e));
          pre.hidden = false;
          pre.scrollTop = 0;
        });
        files.append(b, ' ');
      }
      document.body.append(box);
      box.querySelector('[data-version]').textContent = await window.__TAURI__.app
        .getVersion()
        .catch(() => '');
    }
    box.showModal();
  }

  window.kerfHost = {
    shareBase: `${SITE}/playground/`,
    name: () => name,
    libraries,
    lightburn,
    changed: title,
    // The playground loaded new code: what counts as unsaved from here on.
    // A file or an example is saved as it is; other code (a draft from last
    // time, a shared link) is not saved anywhere yet.
    loaded(text, example) {
      saved = name !== null || example ? text : null;
      title();
    },
    save(fileName, data) {
      return fileName.endsWith('.kerf') ? save(true) : exportFile(fileName, data);
    },
    // Before the playground loads an example: the open file stops being open.
    // Not while a dialog is open: a save finishing later would make the
    // example's save target the file it saved.
    release: () =>
      single(async () => {
        if (!(await discardOk())) return false;
        name = null;
        await core.invoke('forget_design');
        return true;
      }).then(Boolean),
    attach(playground) {
      pg = playground;
      const actions = document.querySelector('.pg-actions');
      const button = (label, onClick) => {
        const b = Object.assign(document.createElement('button'), {
          className: 'button',
          textContent: label,
        });
        b.addEventListener('click', onClick);
        return b;
      };
      actions.prepend(
        button('Open…', open),
        button('Save', () => save(false)),
      );
      actions.append(button('About', about));
      document.querySelector('[data-download="kerf"]').textContent = 'Save as…';
      document.querySelector('[data-share]').textContent = 'Copy web link';
    },
    // A file the app was started with, from the command line or a double
    // click: its text, or null when there is none (an empty file is "")
    async initial() {
      const design = await core.invoke('open_pending').catch(failed('open the file'));
      if (!design) return null;
      name = design.name;
      saved = design.text;
      return design.text;
    },
  };

  // Links in the page go to the website, in the system browser
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    opener.openUrl(new URL(a.getAttribute('href'), SITE).href);
  });

  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'o') open();
    else if (key === 's') save(e.shiftKey);
    else return;
    e.preventDefault();
  });

  // macOS opens files in the running app
  event.listen('open-files', openPending);

  win.onCloseRequested(async (e) => {
    if (!(await discardOk())) e.preventDefault();
  });
})();
