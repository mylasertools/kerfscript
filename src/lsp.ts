// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// The KerfScript language server: answers editors over the Language Server
// Protocol on standard input and output. `kerf lsp` runs it and the VS Code
// extension bundles it. Programs run in a worker thread, so a slow design
// cannot hold up typing, and one that runs too long is stopped.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, parentPort } from 'node:worker_threads';
import { withBuiltinFont } from './font.js';
import { format } from './format.js';
import { VERSION } from './index.js';
import {
  analyze,
  complete,
  definition,
  hover,
  outline,
  problems,
  references,
  rename,
  renameTarget,
  signatureHelp,
  type Analysis,
  type Completion,
  type OutlineItem,
  type Problem,
} from './language.js';
import { LIBRARIES } from './stdlib.js';

export interface ServerOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  // A script that calls workerMain() when it runs in a worker thread.
  // Without it, programs run in the server's own thread.
  worker?: string;
  // How long a program may run before it is stopped, in milliseconds
  timeout?: number;
  exit?: (code: number) => void;
}

interface Message {
  id?: number | string;
  method?: string;
  // Checked by each handler
  params?: any;
}

interface Position {
  line: number;
  character: number;
}

interface Doc {
  uri: string;
  text: string;
  version: number;
  starts: number[];
  analysis?: Analysis;
}

class ResponseError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

const STDLIB_SOURCE = 'https://github.com/mylasertools/kerfscript/blob/main/lib/';
const isStdlib = (path: string) => Object.prototype.hasOwnProperty.call(LIBRARIES, path);

// Kinds as the protocol numbers them
const COMPLETION_KIND: Record<Completion['kind'], number> = {
  module: 9,
  function: 3,
  variable: 6,
  parameter: 6,
  argument: 5,
  keyword: 14,
  constant: 21,
  library: 17,
  property: 10,
};
const SYMBOL_KIND: Record<OutlineItem['kind'], number> = { module: 2, function: 12, variable: 13 };

const filePath = (uri: string): string | undefined => {
  if (!uri.startsWith('file:')) return undefined;
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
};

// Open documents are found by path whatever the case on Windows
const pathKey = (p: string) => {
  const full = resolvePath(p);
  return process.platform === 'win32' ? full.toLowerCase() : full;
};

// A library's file next to the design, as `use <path>` finds it
function libraryFile(base: string, path: string, exists: (p: string) => boolean) {
  for (const candidate of [join(base, path), join(base, path + '.kerf')])
    if (exists(candidate)) return candidate;
}

const isFile = (p: string) => {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
};

// Library sources for a design in folder base, preferring unsaved text in
// the editor
function resolver(base: string | undefined, open: (key: string) => string | undefined) {
  return (path: string): string | undefined => {
    if (!base) return undefined;
    const file = libraryFile(base, path, (p) => open(pathKey(p)) !== undefined || isFile(p));
    if (!file) return undefined;
    const text = open(pathKey(file));
    if (text !== undefined) return text;
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
  };
}

interface Job {
  source: string;
  base?: string;
  open: Record<string, string>;
}

type Outcome = Problem[] | 'timeout';

function runJob(job: Job): Problem[] {
  const resolve = resolver(job.base, (k) => job.open[k]);
  try {
    return problems(job.source, { resolve, fonts: withBuiltinFont({}) });
  } catch (e) {
    return [{ severity: 'error', message: String(e), start: 0, end: 0 }];
  }
}

/** Runs programs for the server; call it from the worker script. */
export function workerMain() {
  parentPort?.on('message', (job: Job) => parentPort!.postMessage(runJob(job)));
  parentPort?.postMessage('ready');
}

// Programs one at a time in a worker, each stopped after the timeout
class Runner {
  private worker?: { w: Worker; ready: Promise<boolean> };
  private inline: boolean;
  private queue: { job: Job; done: (r: Outcome) => void }[] = [];
  private busy = false;
  constructor(
    private script: string | undefined,
    private timeout: number,
  ) {
    this.inline = !script;
  }

  run(job: Job): Promise<Outcome> {
    return new Promise((done) => {
      this.queue.push({ job, done });
      void this.pump();
    });
  }

  private async pump() {
    if (this.busy) return;
    const item = this.queue.shift();
    if (!item) return;
    this.busy = true;
    try {
      item.done(await this.one(item.job));
    } finally {
      this.busy = false;
      void this.pump();
    }
  }

  private async one(job: Job): Promise<Outcome> {
    const w = await this.start();
    if (!w) return runJob(job);
    return new Promise((done) => {
      const finish = (r: Outcome) => {
        clearTimeout(timer);
        w.off('message', onMessage);
        w.off('exit', onExit);
        done(r);
      };
      const onMessage = (m: Problem[]) => finish(m);
      const onExit = () => {
        if (this.worker?.w === w) this.worker = undefined;
        finish('timeout');
      };
      const timer = setTimeout(() => {
        if (this.worker?.w === w) this.worker = undefined;
        void w.terminate();
        finish('timeout');
      }, this.timeout);
      w.on('message', onMessage);
      w.on('exit', onExit);
      w.postMessage(job);
    });
  }

  private start(): Promise<Worker | undefined> {
    if (this.inline) return Promise.resolve(undefined);
    if (!this.worker) {
      let w: Worker;
      try {
        // No environment: the kerf binary built by deno compile may not read it
        w = new Worker(this.script!, { env: {} });
      } catch {
        this.inline = true;
        return Promise.resolve(undefined);
      }
      w.unref();
      const ready = new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), 5000);
        w.once('message', (m) => {
          clearTimeout(t);
          resolve(m === 'ready');
        });
        w.once('error', () => {
          clearTimeout(t);
          resolve(false);
        });
      });
      this.worker = { w, ready };
    }
    const { w, ready } = this.worker;
    return ready.then((ok) => {
      if (ok) return w;
      // Where workers do not start, as in some compiled binaries, programs
      // run in this thread, still bounded by their step limit
      this.inline = true;
      this.worker = undefined;
      void w.terminate();
      return undefined;
    });
  }

  stop() {
    void this.worker?.w.terminate();
  }
}

function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1);
  return out;
}

function toPosition(starts: number[], offset: number): Position {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: offset - starts[lo] };
}

const toRange = (starts: number[], start: number, end: number) => ({
  start: toPosition(starts, start),
  end: toPosition(starts, end),
});

/** Starts the language server on standard input and output, or the given
 * streams. */
export function startServer(options: ServerOptions = {}) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const runner = new Runner(options.worker, options.timeout ?? 10000);
  const docs = new Map<string, Doc>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let shutdown = false;

  const send = (msg: object) => {
    const body = JSON.stringify({ jsonrpc: '2.0', ...msg });
    output.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
  };

  const openText = (key: string) => {
    for (const d of docs.values()) {
      const p = filePath(d.uri);
      if (p && pathKey(p) === key) return d.text;
    }
  };
  const baseOf = (doc: Doc) => {
    const p = filePath(doc.uri);
    return p ? dirname(p) : undefined;
  };
  const resolveFor = (doc: Doc) => resolver(baseOf(doc), openText);

  // .kerf files in a design's folder and below, for use <...>
  const listed = new Map<string, { at: number; files: string[] }>();
  const available = (doc: Doc): string[] => {
    const base = baseOf(doc);
    if (!base) return [];
    const hit = listed.get(base);
    if (hit && Date.now() - hit.at < 5000) return hit.files;
    const files: string[] = [];
    const walk = (dir: string, depth: number) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (files.length >= 200 || e.name.startsWith('.') || e.name === 'node_modules') continue;
        const p = join(dir, e.name);
        if (e.isDirectory() && depth < 3) walk(p, depth + 1);
        else if (e.isFile() && e.name.endsWith('.kerf'))
          files.push(
            relative(base, p)
              .split(sep)
              .join('/')
              .replace(/\.kerf$/, ''),
          );
      }
    };
    walk(base, 0);
    const self = filePath(doc.uri);
    const out = files.filter((f) => !self || join(base, f + '.kerf') !== self);
    listed.set(base, { at: Date.now(), files: out });
    return out;
  };

  const analysis = (doc: Doc) =>
    (doc.analysis ??= analyze(doc.text, { resolve: resolveFor(doc), libraries: available(doc) }));

  const docOf = (params: { textDocument: { uri: string } }) => {
    const doc = docs.get(params.textDocument.uri);
    if (!doc) throw new ResponseError(-32602, `Document not open: ${params.textDocument.uri}`);
    return doc;
  };
  const offsetOf = (doc: Doc, p: Position) => {
    const line = Math.min(Math.max(p.line, 0), doc.starts.length - 1);
    const end = line + 1 < doc.starts.length ? doc.starts[line + 1] - 1 : doc.text.length;
    return Math.min(doc.starts[line] + Math.max(p.character, 0), end);
  };
  const at = (params: { textDocument: { uri: string }; position: Position }) => {
    const doc = docOf(params);
    return { doc, a: analysis(doc), offset: offsetOf(doc, params.position) };
  };

  // Where a library's definition is, when it is a file next to the design
  const location = (doc: Doc, file: string | undefined, start: number, end: number) => {
    if (file === undefined) return { uri: doc.uri, range: toRange(doc.starts, start, end) };
    const base = baseOf(doc);
    if (!base || isStdlib(file)) return undefined;
    const path = libraryFile(base, file, (p) => openText(pathKey(p)) !== undefined || isFile(p));
    if (!path) return undefined;
    const text = openText(pathKey(path)) ?? readFileSync(path, 'utf8');
    return { uri: pathToFileURL(path).href, range: toRange(lineStarts(text), start, end) };
  };

  const publish = (doc: Doc, list: Problem[]) =>
    send({
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: doc.uri,
        version: doc.version,
        diagnostics: list.map((p) => ({
          range: toRange(doc.starts, p.start, p.end),
          severity: p.severity === 'error' ? 1 : 2,
          source: 'kerf',
          message: p.message,
          ...(p.related && {
            relatedInformation: p.related.map((r) => ({
              location: { uri: doc.uri, range: toRange(doc.starts, r.start, r.end) },
              message: r.message,
            })),
          }),
        })),
      },
    });

  const check = async (uri: string) => {
    const doc = docs.get(uri);
    if (!doc) return;
    const open: Record<string, string> = {};
    for (const d of docs.values()) {
      const p = filePath(d.uri);
      if (p && d !== doc) open[pathKey(p)] = d.text;
    }
    const version = doc.version;
    const result = await runner.run({ source: doc.text, base: baseOf(doc), open });
    if (docs.get(uri) !== doc || doc.version !== version) return;
    publish(
      doc,
      result === 'timeout'
        ? [
            {
              severity: 'warning',
              message: `Not checked: the design ran longer than ${Math.round((options.timeout ?? 10000) / 1000)} seconds`,
              start: 0,
              end: 0,
            },
          ]
        : result,
    );
  };
  const schedule = (uri: string, delay: number) => {
    clearTimeout(timers.get(uri));
    timers.set(
      uri,
      setTimeout(() => {
        timers.delete(uri);
        void check(uri);
      }, delay),
    );
  };
  // Designs that use libraries are checked again when a file changes
  const scheduleUsers = (except?: string) => {
    for (const d of docs.values())
      if (d.uri !== except && /\b(?:use|include)\s*</.test(d.text)) {
        d.analysis = undefined;
        schedule(d.uri, 600);
      }
  };

  const requests: Record<string, (params: Message['params']) => unknown> = {
    initialize: () => ({
      capabilities: {
        positionEncoding: 'utf-16',
        textDocumentSync: { openClose: true, change: 1 },
        hoverProvider: true,
        completionProvider: { triggerCharacters: ['<', '/', '.', '$'] },
        signatureHelpProvider: { triggerCharacters: ['(', ','], retriggerCharacters: [')'] },
        definitionProvider: true,
        referencesProvider: true,
        documentHighlightProvider: true,
        documentSymbolProvider: true,
        documentFormattingProvider: true,
        renameProvider: { prepareProvider: true },
        documentLinkProvider: { resolveProvider: false },
      },
      serverInfo: { name: 'kerf', version: VERSION },
    }),
    shutdown: () => {
      shutdown = true;
      runner.stop();
      return null;
    },
    'textDocument/hover': (params) => {
      const { doc, a, offset } = at(params);
      const h = hover(a, offset, { resolve: resolveFor(doc) });
      return h
        ? {
            contents: { kind: 'markdown', value: h.text },
            range: toRange(doc.starts, h.start, h.end),
          }
        : null;
    },
    'textDocument/completion': (params) => {
      const { doc, a, offset } = at(params);
      const list = complete(a, offset);
      const trigger: string | undefined = params.context?.triggerCharacter;
      const kinds = new Set(list.items.map((i) => i.kind));
      // < and / start a library path, . a member: nothing else
      if ((trigger === '<' || trigger === '/') && !kinds.has('library')) return [];
      if (trigger === '.' && !kinds.has('property')) return [];
      const range = toRange(doc.starts, list.from, list.to);
      return {
        isIncomplete: false,
        items: list.items.map((c) => ({
          label: c.label,
          kind: COMPLETION_KIND[c.kind],
          ...(c.detail && { detail: c.detail }),
          ...(c.doc && { documentation: { kind: 'markdown', value: c.doc } }),
          sortText: `${c.first ? 0 : c.kind === 'keyword' ? 3 : c.builtin ? 2 : 1}${c.label}`,
          filterText: c.label,
          textEdit: { range, newText: c.insert ?? c.label },
        })),
      };
    },
    'textDocument/signatureHelp': (params) => {
      const { a, offset } = at(params);
      const s = signatureHelp(a, offset);
      if (!s) return null;
      return {
        signatures: [
          {
            label: s.label,
            ...(s.doc && { documentation: { kind: 'markdown', value: s.doc } }),
            parameters: s.params.map((p) => ({
              label: [p.start, p.end],
              ...(p.doc && { documentation: p.doc }),
            })),
          },
        ],
        activeSignature: 0,
        activeParameter: s.active < 0 ? s.params.length : s.active,
      };
    },
    'textDocument/definition': (params) => {
      const { doc, a, offset } = at(params);
      const d = definition(a, offset);
      return (d && location(doc, d.file, d.start, d.end)) ?? null;
    },
    'textDocument/references': (params) => {
      const { doc, a, offset } = at(params);
      return references(a, offset, params.context?.includeDeclaration ?? true).map((r) => ({
        uri: doc.uri,
        range: toRange(doc.starts, r.start, r.end),
      }));
    },
    'textDocument/documentHighlight': (params) => {
      const { doc, a, offset } = at(params);
      return references(a, offset).map((r) => ({
        range: toRange(doc.starts, r.start, r.end),
        kind: r.definition ? 3 : 2,
      }));
    },
    'textDocument/documentSymbol': (params) => {
      const doc = docOf(params);
      const symbol = (o: OutlineItem): object => ({
        name: o.name,
        ...(o.detail && { detail: o.detail }),
        kind: SYMBOL_KIND[o.kind],
        range: toRange(doc.starts, o.range[0], o.range[1]),
        selectionRange: toRange(doc.starts, o.start, o.end),
        children: o.children.map(symbol),
      });
      return outline(analysis(doc)).map(symbol);
    },
    'textDocument/formatting': (params) => {
      const doc = docOf(params);
      let out: string;
      try {
        out = format(doc.text);
      } catch {
        return null; // a program that does not parse is left as it is
      }
      if (out === doc.text.replace(/\r\n/g, '\n')) return [];
      return [{ range: toRange(doc.starts, 0, doc.text.length), newText: out }];
    },
    'textDocument/prepareRename': (params) => {
      const { doc, a, offset } = at(params);
      const t = renameTarget(a, offset);
      if ('error' in t) throw new ResponseError(-32803, t.error);
      return { range: toRange(doc.starts, t.start, t.end), placeholder: t.name };
    },
    'textDocument/rename': (params) => {
      const { doc, a, offset } = at(params);
      const edits = rename(a, offset, params.newName);
      if ('error' in edits) throw new ResponseError(-32803, edits.error);
      return {
        changes: {
          [doc.uri]: edits.map((e) => ({
            range: toRange(doc.starts, e.start, e.end),
            newText: params.newName,
          })),
        },
      };
    },
    'textDocument/documentLink': (params) => {
      const doc = docOf(params);
      const base = baseOf(doc);
      return analysis(doc).libraries.flatMap((l) => {
        const range = toRange(doc.starts, l.start, l.end);
        if (isStdlib(l.path))
          return [{ range, target: `${STDLIB_SOURCE}${l.path}.kerf` }];
        const file = base && libraryFile(base, l.path, isFile);
        return file ? [{ range, target: pathToFileURL(file).href }] : [];
      });
    },
  };

  const notifications: Record<string, (params: Message['params']) => void> = {
    'textDocument/didOpen': ({ textDocument: t }) => {
      docs.set(t.uri, { uri: t.uri, text: t.text, version: t.version, starts: lineStarts(t.text) });
      schedule(t.uri, 0);
    },
    'textDocument/didChange': ({ textDocument: t, contentChanges }) => {
      const doc = docs.get(t.uri);
      const change = contentChanges[contentChanges.length - 1];
      if (!doc || !change) return;
      doc.text = change.text;
      doc.version = t.version;
      doc.starts = lineStarts(doc.text);
      doc.analysis = undefined;
      schedule(t.uri, 300);
      scheduleUsers(t.uri);
    },
    'textDocument/didClose': ({ textDocument: t }) => {
      const doc = docs.get(t.uri);
      docs.delete(t.uri);
      clearTimeout(timers.get(t.uri));
      if (doc)
        send({
          method: 'textDocument/publishDiagnostics',
          params: { uri: t.uri, diagnostics: [] },
        });
    },
    'workspace/didChangeWatchedFiles': () => {
      listed.clear();
      scheduleUsers();
    },
    exit: () => exit(shutdown ? 0 : 1),
  };

  const handle = (msg: Message) => {
    if (msg.method === undefined) return; // a response; the server asks nothing
    if (msg.id === undefined) {
      try {
        notifications[msg.method]?.(msg.params);
      } catch {
        // A notification has no reply to carry an error
      }
      return;
    }
    const handler = requests[msg.method];
    if (!handler) {
      send({ id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } });
      return;
    }
    try {
      send({ id: msg.id, result: handler(msg.params) ?? null });
    } catch (e) {
      send({
        id: msg.id,
        error: {
          code: e instanceof ResponseError ? e.code : -32603,
          message: e instanceof Error ? e.message : String(e),
        },
      });
    }
  };

  let buffer = Buffer.alloc(0);
  input.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const length = /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString());
      if (!length) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      const end = headerEnd + 4 + Number(length[1]);
      if (buffer.length < end) return;
      const body = buffer.subarray(headerEnd + 4, end).toString('utf8');
      buffer = buffer.subarray(end);
      let msg: Message;
      try {
        msg = JSON.parse(body);
      } catch {
        send({ id: null, error: { code: -32700, message: 'Parse error' } });
        continue;
      }
      handle(msg);
    }
  });
  input.on('end', () => exit(shutdown ? 0 : 1));
}
