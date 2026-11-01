import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The standard library's paths, as completion lists them
const STDLIB = readdirSync('lib/kerf')
  .filter((f) => f.endsWith('.kerf'))
  .map((f) => `kerf/${f.slice(0, -5)}`)
  .sort();

// An editor's side of the Language Server Protocol, talking to kerf lsp
function client(args = ['dist/cli.js', 'lsp']) {
  const server = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  let buffer = Buffer.alloc(0);
  let next = 0;
  const replies = new Map();
  const notes = [];
  const waiters = [];
  server.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const head = buffer.indexOf('\r\n\r\n');
      if (head < 0) return;
      const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, head).toString())[1]);
      if (buffer.length < head + 4 + length) return;
      const msg = JSON.parse(buffer.subarray(head + 4, head + 4 + length).toString('utf8'));
      buffer = buffer.subarray(head + 4 + length);
      if (msg.id !== undefined) replies.get(msg.id)?.(msg);
      else {
        notes.push(msg);
        for (const w of waiters.splice(0)) w();
      }
    }
  });
  const write = (msg) => {
    const body = JSON.stringify({ jsonrpc: '2.0', ...msg });
    server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  return {
    server,
    request(method, params) {
      const id = ++next;
      return new Promise((resolve) => {
        replies.set(id, resolve);
        write({ id, method, params });
      });
    },
    notify: (method, params) => write({ method, params }),
    // The next diagnostics published for a document that match
    async diagnostics(uri, version, match = () => true) {
      for (;;) {
        const hit = notes.find(
          (n) =>
            n.method === 'textDocument/publishDiagnostics' &&
            n.params.uri === uri &&
            (version === undefined || n.params.version === version) &&
            match(n.params.diagnostics),
        );
        if (hit) return hit.params.diagnostics;
        await new Promise((r) => waiters.push(r));
      }
    },
  };
}

const dir = mkdtempSync(join(tmpdir(), 'kerfscript-lsp-'));
writeFileSync(
  join(dir, 'tabs.kerf'),
  '// tabs: little tabs\n\n// A tab of width w\nmodule tab(w = 5) { rect([w, 3]); }\n',
);
const uri = pathToFileURL(join(dir, 'design.kerf')).href;
const source = `use <tabs>
use <kerf/box>
/* [Size] */
// Outer width
width = 120; // [40:5:400]

// A panel with holes
module panel(w, h = 10) {
  difference() {
    rect([w, h], r = 2);
    for (x = [5:10:w - 5])
      translate([x, h / 2]) circle(d = 3);
  }
}
panel(width, h = 20);
tab(4);
`;
// The position of the nth match of text, plus some characters
const position = (text, find, n = 0, plus = 0) => {
  let i = -1;
  for (let k = 0; k <= n; k++) i = text.indexOf(find, i + 1);
  assert.ok(i >= 0, find);
  i += plus;
  const before = text.slice(0, i);
  return { line: before.split('\n').length - 1, character: i - before.lastIndexOf('\n') - 1 };
};
const doc = { textDocument: { uri } };

test('kerf lsp answers an editor', async (t) => {
  const c = client();
  t.after(() => c.server.kill());
  const init = await c.request('initialize', { processId: null, rootUri: null, capabilities: {} });
  assert.equal(init.result.serverInfo.name, 'kerf');
  assert.ok(init.result.capabilities.hoverProvider);
  c.notify('initialized', {});
  c.notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'kerfscript', version: 1, text: source },
  });

  await t.test('no problems in a correct design', async () => {
    assert.deepEqual(await c.diagnostics(uri, 1), []);
  });

  await t.test('hover', async () => {
    const at = (find, n, plus = 1) =>
      c.request('textDocument/hover', { ...doc, position: position(source, find, n, plus) });
    const width = await at('width', 2);
    assert.match(width.result.contents.value, /width = 120/);
    assert.match(width.result.contents.value, /Outer width/);
    assert.match(width.result.contents.value, /40 to 400, in steps of 5/);
    assert.deepEqual(width.result.range.start, position(source, 'width', 2));
    const panel = (await at('panel(width')).result.contents.value;
    assert.match(panel, /module panel\(w, h = 10\)/);
    assert.match(panel, /A panel with holes/);
    assert.match((await at('rect')).result.contents.value, /rect\(size = 1, center = false/);
    assert.match((await at('r = 2')).result.contents.value, /Corner radius/);
    assert.match((await at('h = 20')).result.contents.value, /Parameter of module `panel\(\)`/);
    assert.match((await at('tab(4')).result.contents.value, /A tab of width w[\s\S]*<tabs>/);
    assert.match((await at('kerf/box')).result.contents.value, /finger-jointed boxes/);
    assert.equal((await at('Outer')).result, null);
  });

  await t.test('definition, in the design and in a library next to it', async () => {
    const def = await c.request('textDocument/definition', {
      ...doc,
      position: position(source, 'h / 2'),
    });
    assert.equal(def.result.uri, uri);
    assert.deepEqual(def.result.range.start, position(source, 'h = 10'));
    const lib = await c.request('textDocument/definition', {
      ...doc,
      position: position(source, 'tab(4'),
    });
    assert.match(lib.result.uri, /tabs\.kerf$/);
    assert.deepEqual(lib.result.range.start, { line: 3, character: 7 });
  });

  await t.test('references and highlights', async () => {
    const refs = await c.request('textDocument/references', {
      ...doc,
      position: position(source, 'h = 10'),
      context: { includeDeclaration: true },
    });
    // The parameter, its two uses and the named argument h = 20
    assert.equal(refs.result.length, 4);
    const lines = refs.result.map((r) => r.range.start.line);
    assert.deepEqual(lines, [7, 9, 11, 14]);
    const marks = await c.request('textDocument/documentHighlight', {
      ...doc,
      position: position(source, 'width', 1),
    });
    assert.deepEqual(
      marks.result.map((m) => m.kind),
      [3, 2],
    );
  });

  await t.test('completion', async () => {
    const typed = source + 'rect(';
    c.notify('textDocument/didChange', {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: typed }],
    });
    const end = position(typed, 'rect(', 1, 5);
    const args = await c.request('textDocument/completion', { ...doc, position: end });
    const labels = args.result.items.sort((x, y) => (x.sortText < y.sortText ? -1 : 1));
    assert.deepEqual(
      labels.slice(0, 3).map((i) => i.label),
      ['center', 'r', 'size'],
    );
    assert.equal(labels[0].textEdit.newText, 'center = ');
    assert.ok(labels.some((i) => i.label === 'width'));

    const statement = source + 'pa';
    c.notify('textDocument/didChange', {
      textDocument: { uri, version: 3 },
      contentChanges: [{ text: statement }],
    });
    const items = (
      await c.request('textDocument/completion', {
        ...doc,
        position: position(statement, 'pa', 2, 2),
      })
    ).result.items;
    const panel = items.find((i) => i.label === 'panel');
    assert.equal(panel.detail, 'module panel(w, h = 10)');
    assert.deepEqual(panel.textEdit.range.start, position(statement, 'pa', 2));
    assert.ok(
      items.some((i) => i.label === 'box'),
      'modules from <kerf/box>',
    );
    assert.ok(
      items.some((i) => i.label === 'tab'),
      'modules from <tabs>',
    );
    assert.ok(!items.some((i) => i.label === 'sin'), 'functions are not statements');

    const lib = 'use <';
    c.notify('textDocument/didChange', {
      textDocument: { uri, version: 4 },
      contentChanges: [{ text: lib }],
    });
    const libs = await c.request('textDocument/completion', {
      ...doc,
      position: { line: 0, character: 5 },
      context: { triggerKind: 2, triggerCharacter: '<' },
    });
    assert.deepEqual(
      libs.result.items.map((i) => i.label),
      [...STDLIB, 'tabs'],
    );
  });

  await t.test('parameter hints', async () => {
    const typed = source + 'panel(10, ';
    c.notify('textDocument/didChange', {
      textDocument: { uri, version: 5 },
      contentChanges: [{ text: typed }],
    });
    const help = await c.request('textDocument/signatureHelp', {
      ...doc,
      position: position(typed, 'panel(10, ', 0, 10),
    });
    const sig = help.result.signatures[0];
    assert.equal(sig.label, 'panel(w, h = 10)');
    assert.equal(help.result.activeParameter, 1);
    assert.equal(sig.label.slice(...sig.parameters[1].label), 'h = 10');
  });

  await t.test('errors while typing, where they are', async () => {
    const broken = source.replace('panel(width', 'panel(widht');
    c.notify('textDocument/didChange', {
      textDocument: { uri, version: 6 },
      contentChanges: [{ text: broken }],
    });
    const [d] = await c.diagnostics(uri, 6);
    assert.equal(d.severity, 1);
    assert.equal(d.message, 'Unknown variable "widht". Did you mean "width"?');
    assert.deepEqual(d.range, {
      start: position(broken, 'widht'),
      end: position(broken, 'widht', 0, 5),
    });

    const inside = source.replace('rect([w, h]', 'rect([w, hh]');
    c.notify('textDocument/didChange', {
      textDocument: { uri, version: 7 },
      contentChanges: [{ text: inside }],
    });
    const [e] = await c.diagnostics(uri, 7);
    assert.match(e.message, /Unknown variable "hh"/);
    assert.equal(e.relatedInformation[0].message, 'in module panel(), called here');
    assert.deepEqual(e.relatedInformation[0].location.range.start, position(inside, 'panel(width'));

    const warned = source.replace('r = 2', 'radius = 2');
    c.notify('textDocument/didChange', {
      textDocument: { uri, version: 8 },
      contentChanges: [{ text: warned }],
    });
    const [w] = await c.diagnostics(uri, 8);
    assert.equal(w.severity, 2);
    assert.match(w.message, /radius/);
    assert.equal(w.range.start.line, 9);

    const syntax = source.replace('rect([w, h], r = 2);', 'rect([w, h] r = 2);');
    c.notify('textDocument/didChange', {
      textDocument: { uri, version: 9 },
      contentChanges: [{ text: syntax }],
    });
    const [s] = await c.diagnostics(uri, 9);
    assert.match(s.message, /Expected "," or "\)", found "r"/);
  });

  await t.test('outline, rename and format', async () => {
    const messy = 'x=1;\nmodule m(a){\n  y=a;\n  rect(y);\n}\nm(x);\n';
    c.notify('textDocument/didChange', {
      textDocument: { uri, version: 10 },
      contentChanges: [{ text: messy }],
    });
    const symbols = (await c.request('textDocument/documentSymbol', doc)).result;
    assert.deepEqual(
      symbols.map((s) => [s.name, s.kind, s.children.map((k) => k.name)]),
      [
        ['x', 13, []],
        ['m', 2, ['y']],
      ],
    );
    const fmt = await c.request('textDocument/formatting', {
      ...doc,
      options: { tabSize: 2, insertSpaces: true },
    });
    assert.equal(fmt.result[0].newText, 'x = 1;\nmodule m(a) {\n  y = a;\n  rect(y);\n}\nm(x);\n');
    const pos = position(messy, 'a', 1);
    const prep = await c.request('textDocument/prepareRename', { ...doc, position: pos });
    assert.equal(prep.result.placeholder, 'a');
    const edit = await c.request('textDocument/rename', { ...doc, position: pos, newName: 'size' });
    assert.equal(edit.result.changes[uri].length, 2);
    const bad = await c.request('textDocument/prepareRename', {
      ...doc,
      position: position(messy, 'rect'),
    });
    assert.match(bad.error.message, /rect is built in/);
  });

  await t.test('library links', async () => {
    c.notify('textDocument/didChange', {
      textDocument: { uri, version: 11 },
      contentChanges: [{ text: source }],
    });
    const links = (await c.request('textDocument/documentLink', doc)).result;
    assert.match(links[0].target, /tabs\.kerf$/);
    assert.equal(
      links[1].target,
      'https://github.com/mylasertools/kerfscript/blob/main/lib/kerf/box.kerf',
    );
  });

  const down = await c.request('shutdown');
  assert.equal(down.result, null);
  const exited = new Promise((r) => c.server.on('exit', r));
  c.notify('exit');
  assert.equal(await exited, 0);
});

test('a design that runs too long is stopped, and the server keeps working', async (t) => {
  const c = client(['dist/cli.js', 'lsp', '--timeout', '0.1']);
  t.after(() => c.server.kill());
  await c.request('initialize', { processId: null, rootUri: null, capabilities: {} });
  const slow = 'function f(n) = n == 0 ? 0 : f(n - 1) + 1;\nx = [for (i = [0:3000]) f(500)];\n';
  c.notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'kerfscript', version: 1, text: slow },
  });
  const [d] = await c.diagnostics(uri, 1);
  assert.match(d.message, /Not checked: the design ran longer than/);
  c.notify('textDocument/didChange', {
    textDocument: { uri, version: 2 },
    contentChanges: [{ text: 'rect(widht);' }],
  });
  const [e] = await c.diagnostics(uri, 2);
  assert.match(e.message, /Unknown variable "widht"/);
});
