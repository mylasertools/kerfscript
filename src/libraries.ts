// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Shared libraries. A project's kerf.json names the libraries its designs use
// and where each comes from; `kerf install` copies them into kerf_libraries/
// and pins each in kerf.lock by its exact commit or link and a hash of its
// files, so a design renders the same way on every machine. A design loads
// one with `use <name/file>`. See docs/shared-libraries.md.

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { LANGUAGE_VERSION } from './index.js';
import { parse } from './parser.js';
import { LIBRARIES } from './stdlib.js';

export const MANIFEST = 'kerf.json';
export const LOCK = 'kerf.lock';
export const FOLDER = 'kerf_libraries';

const MAX_DOWNLOAD = 20 << 20;
const MAX_FILES = 2000;
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
// Files kept from a library's top folder besides its .kerf files
const KEEP = /^(readme|licen[cs]e|copying|notice|changelog)(\.[a-z]+)?$/i;

/** A problem with a project's libraries, shown to the user as it is. */
export class LibraryError extends Error {}

/** A kerf.json: a library's name and version, and the libraries it uses. */
export interface Manifest {
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  /** The oldest KerfScript language version the library works with */
  language?: string;
  /** Library name to source: github:owner/repo@tag, an https link to a
   * .tar.gz, or a folder */
  libraries: Record<string, string>;
  /** The project's laser bed, [width, height] in mm: the sheet for every
   * design in the project that does not set $sheet */
  sheet?: [number, number];
}

/** One library pinned in kerf.lock. */
export interface Locked {
  /** The source as kerf.json gives it */
  source: string;
  version?: string;
  /** Where the exact files came from: a link to one commit, or the folder */
  resolved: string;
  /** sha256 of the library's files */
  integrity: string;
}

export interface Lock {
  lockVersion: 1;
  libraries: Record<string, Locked>;
}

/** A download, as the global fetch makes one. When the response has a
 * body stream, it is read a piece at a time and stopped at the size limit. */
export type Fetch = (url: string) => Promise<{
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  body?: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(): Promise<void>;
    };
  } | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface InstallOptions {
  /** Downloads a link; the global fetch by default */
  fetch?: Fetch;
  /** Fail instead of changing kerf.lock, as in CI */
  frozen?: boolean;
  /** Called with a line for each library installed or removed */
  log?: (line: string) => void;
}

type Files = Map<string, Buffer>;

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

// A value of an object's own, so a library named constructor is not found
// on every object
const own = <T>(o: Record<string, T> | undefined, key: string): T | undefined =>
  o && Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;

const fail = (msg: string): never => {
  throw new LibraryError(msg);
};

function checkName(name: unknown, what: string): string {
  if (typeof name !== 'string' || !NAME.test(name))
    fail(`${what} "${name}" is not a library name: use lowercase letters, digits, - and _`);
  if (name === 'kerf') fail(`${what}: "kerf" is the standard library's name`);
  return name as string;
}

function checkManifest(raw: unknown, label: string): Manifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    fail(`${label} must hold a JSON object`);
  const m = raw as Record<string, unknown>;
  for (const k of ['name', 'version', 'description', 'license', 'language'])
    if (m[k] !== undefined && typeof m[k] !== 'string') fail(`${label}: "${k}" must be a string`);
  if (m.name !== undefined) checkName(m.name, `${label}: name`);
  if (m.version !== undefined && !SEMVER.test(m.version as string))
    fail(`${label}: "version" must look like 1.2.0, not "${m.version}"`);
  if (m.language !== undefined && !/^\d+\.\d+$/.test(m.language as string))
    fail(`${label}: "language" must look like ${LANGUAGE_VERSION}, not "${m.language}"`);
  if (
    m.sheet !== undefined &&
    !(
      Array.isArray(m.sheet) &&
      m.sheet.length === 2 &&
      m.sheet.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)
    )
  )
    fail(`${label}: "sheet" must be [width, height] in mm, like [600, 400]`);
  const libs = m.libraries ?? {};
  if (!libs || typeof libs !== 'object' || Array.isArray(libs))
    fail(`${label}: "libraries" must be an object of name: source`);
  for (const [name, source] of Object.entries(libs)) {
    checkName(name, `${label}: library`);
    if (typeof source !== 'string') fail(`${label}: the source of ${name} must be a string`);
  }
  return { ...(m as object), libraries: { ...(libs as Record<string, string>) } } as Manifest;
}

function readJson(file: string, label: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return fail(`${label} was not found`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    return fail(`${label} is not valid JSON: ${(e as Error).message}`);
  }
}

/** Reads and checks the kerf.json in a folder. */
export function readManifest(dir: string, label = MANIFEST): Manifest {
  return checkManifest(readJson(join(dir, MANIFEST), label), label);
}

/** Reads kerf.lock in a project folder, or undefined when there is none. */
export function readLock(root: string): Lock | undefined {
  if (!existsSync(join(root, LOCK))) return undefined;
  const raw = readJson(join(root, LOCK), LOCK) as Lock;
  if (raw?.lockVersion !== 1 || !raw.libraries || typeof raw.libraries !== 'object')
    fail(`${LOCK} is not a kerf.lock this kerf can read. Delete it and run kerf install.`);
  for (const [name, l] of Object.entries(raw.libraries))
    if (!l || ['source', 'resolved', 'integrity'].some((k) => typeof (l as any)[k] !== 'string'))
      fail(`${LOCK}: the entry for ${name} is damaged. Remove it and run kerf install.`);
  return raw;
}

/** The project a design belongs to: the nearest folder at or above `dir`
 * with a kerf.json. */
export function findProject(dir: string): string | undefined {
  for (let d = resolve(dir); ; ) {
    if (isFile(join(d, MANIFEST))) return d;
    const up = dirname(d);
    if (up === d) return undefined;
    d = up;
  }
}

function ownName(root: string): string | undefined {
  try {
    return readManifest(root).name;
  } catch {
    return undefined;
  }
}

/** The file that `use <path>` names, outside the standard library, for a
 * design in folder `base`. A path that starts with the project's own name
 * is a file of the project; one that starts with the name of a library in
 * kerf_libraries is that library's; any other is next to the design. Each
 * is tried as written and with .kerf added. */
export function libraryFile(
  base: string,
  path: string,
  exists: (file: string) => boolean = isFile,
): string | undefined {
  const tries = (dir: string, p: string) =>
    [join(dir, p), join(dir, p + '.kerf')].find((f) => exists(f));
  const slash = path.indexOf('/');
  const root = slash > 0 ? findProject(base) : undefined;
  if (root) {
    const first = path.slice(0, slash);
    if (first === ownName(root)) return tries(root, path.slice(slash + 1));
    if (isDir(join(root, FOLDER, first))) return tries(join(root, FOLDER), path);
  }
  return tries(base, path);
}

/** A render() resolve option for a design file: finds its libraries as
 * `kerf render` does. */
export function resolver(designFile: string): (path: string) => string | undefined {
  const base = dirname(resolve(designFile));
  return (path) => {
    const file = libraryFile(base, path);
    return file === undefined ? undefined : readFileSync(file, 'utf8');
  };
}

/** The `use <...>` paths of the installed libraries and of the project's own
 * files, for completion in editors. */
export function installedPaths(base: string, limit = 200): string[] {
  const root = findProject(base);
  if (!root) return [];
  const out: string[] = [];
  const list = (dir: string, prefix: string) => {
    for (const p of [...walk(dir, 3)].sort()) {
      if (out.length >= limit) return;
      if (p.endsWith('.kerf')) out.push(prefix + p.slice(0, -5));
    }
  };
  const name = ownName(root);
  if (name) list(root, name + '/');
  const folder = join(root, FOLDER);
  if (isDir(folder))
    for (const lib of readdirSync(folder).sort())
      if (NAME.test(lib) && isDir(join(folder, lib))) list(join(folder, lib), lib + '/');
  return out;
}

// Paths of the files in a folder, with / between folders, leaving out
// dot files, node_modules and kerf_libraries
function walk(dir: string, depth = Infinity): string[] {
  const out: string[] = [];
  const go = (d: string, rel: string, level: number) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === FOLDER) continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (level < depth) go(join(d, e.name), p, level + 1);
      } else if (e.isFile()) {
        out.push(p);
        if (out.length > MAX_FILES) fail(`${dir} has more than ${MAX_FILES} files`);
      }
    }
  };
  go(dir, '', 0);
  return out;
}

function readFolder(dir: string, keep: (p: string) => boolean = () => true): Files {
  const files: Files = new Map();
  for (const p of walk(dir)) if (keep(p)) files.set(p, readFileSync(join(dir, ...p.split('/'))));
  return files;
}

const libraryPart = (p: string) =>
  p === MANIFEST || p.endsWith('.kerf') || (!p.includes('/') && KEEP.test(p));

/** A hash of a library's files, the same whatever line endings git gives
 * them. */
export function integrity(files: Files): string {
  const h = createHash('sha256');
  for (const p of [...files.keys()].sort()) {
    const text = Buffer.from(files.get(p)!.toString('utf8').replace(/\r\n/g, '\n'));
    h.update(`${p}\0${text.length}\0`);
    h.update(text);
  }
  return 'sha256-' + h.digest('base64');
}

// Sources

type Source =
  | { kind: 'github'; owner: string; repo: string; ref: string }
  | { kind: 'url'; url: string }
  | { kind: 'folder'; path: string };

// Where a source points: the same text from two folders is two libraries
function where(source: Source): string {
  if (source.kind === 'folder')
    return 'folder:' + (process.platform === 'win32' ? source.path.toLowerCase() : source.path);
  // GitHub matches owners and repositories in any case, but not tags and
  // branches: @Release and @release are two refs
  if (source.kind === 'github')
    return `github:${source.owner}/${source.repo}`.toLowerCase() + `@${source.ref}`;
  return source.url;
}

function parseSource(spec: string, base: string): Source {
  const gh = /^github:([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:@(\S+))?$/.exec(spec);
  if (gh) return { kind: 'github', owner: gh[1], repo: gh[2], ref: gh[3] ?? 'HEAD' };
  if (/^https?:\/\//i.test(spec)) {
    let url: URL;
    try {
      url = new URL(spec);
    } catch {
      return fail(`${spec} is not a link`);
    }
    // Plain http only on this machine, as in tests
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      fail(`Use https:// to download ${spec}`);
    return { kind: 'url', url: spec };
  }
  const path = spec.startsWith('file:') ? spec.slice(5) : spec;
  if (path.startsWith('./') || path.startsWith('../') || isAbsolute(path))
    return { kind: 'folder', path: resolve(base, path) };
  return fail(
    `"${spec}" is not a library source. Use github:owner/repo@tag, an https:// link to a .tar.gz, or a folder like ./my-library`,
  );
}

async function download(url: string, fetchFn: Fetch): Promise<Buffer> {
  let res;
  try {
    res = await fetchFn(url);
  } catch (e) {
    const err = e as Error & { cause?: Error };
    return fail(`Could not download ${url}: ${err.cause?.message ?? err.message}`);
  }
  if (!res.ok)
    fail(
      `Could not download ${url}: HTTP ${res.status}` +
        (res.status === 404 ? '. Check the name and the tag, and that it is public.' : ''),
    );
  const tooLarge = () => fail(`${url} is larger than ${MAX_DOWNLOAD >> 20} MB`);
  if (Number(res.headers?.get('content-length')) > MAX_DOWNLOAD) tooLarge();
  if (!res.body) {
    const data = Buffer.from(await res.arrayBuffer());
    return data.length > MAX_DOWNLOAD ? tooLarge() : data;
  }
  // Read as it arrives, so a server that sends without end is stopped
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    size += value.length;
    if (size > MAX_DOWNLOAD) {
      await reader.cancel().catch(() => {});
      tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// The files in a .tar.gz, and the commit git archive records in it
function untar(gz: Buffer, from: string): { files: Files; commit?: string } {
  let data: Buffer;
  try {
    data = gunzipSync(gz, { maxOutputLength: 5 * MAX_DOWNLOAD });
  } catch {
    return fail(`${from} is not a .tar.gz file`);
  }
  const files: Files = new Map();
  let commit: string | undefined;
  let pax: Record<string, string> = {};
  let longName: string | undefined;
  for (let at = 0; at + 512 <= data.length; ) {
    const h = data.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const field = (o: number, n: number) => {
      const s = h.subarray(o, o + n);
      const end = s.indexOf(0);
      return s.subarray(0, end < 0 ? n : end).toString('utf8');
    };
    const size = parseInt(field(124, 12).trim() || '0', 8);
    if (!(size >= 0)) fail(`${from} is damaged`);
    const type = field(156, 1) || '0';
    const body = data.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'g') {
      const records = paxRecords(body);
      if (type === 'g') commit = records.comment ?? commit;
      else pax = records;
      continue;
    }
    if (type === 'L') {
      longName = body.toString('utf8').replace(/\0+$/, '');
      continue;
    }
    const prefix = field(345, 155);
    const name = pax.path ?? longName ?? (prefix ? prefix + '/' : '') + field(0, 100);
    pax = {};
    longName = undefined;
    // Files only: folders are implied, and links are left out
    if (type === '0' || type === '7') files.set(name, Buffer.from(body));
    if (files.size > MAX_FILES) fail(`${from} has more than ${MAX_FILES} files`);
  }
  return { files, commit };
}

function paxRecords(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < buf.length; ) {
    const space = buf.indexOf(0x20, i);
    const len = parseInt(buf.subarray(i, space).toString(), 10);
    if (!(len > 0) || space < 0) break;
    const record = buf.subarray(space + 1, i + len - 1).toString('utf8');
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += len;
  }
  return out;
}

// The library in an archive: the files under its kerf.json, which is at the
// top or in the one folder everything is in
function libraryTree(files: Files, from: string): Files {
  const named = new Map<string, Buffer>();
  for (const [raw, data] of files) {
    const p = raw.replace(/^\.\//, '');
    const parts = p.split('/');
    if (
      isAbsolute(p) ||
      p.includes('\\') ||
      p.includes(':') ||
      parts.some((s) => s === '..' || s === '')
    )
      fail(`${from} holds a file outside its folder: ${raw}`);
    named.set(p, data);
  }
  let top = '';
  if (!named.has(MANIFEST)) {
    const firsts = new Set([...named.keys()].map((p) => p.split('/')[0]));
    if (firsts.size === 1) top = [...firsts][0] + '/';
  }
  const out: Files = new Map();
  for (const [p, data] of named) {
    if (!p.startsWith(top)) continue;
    const rel = p.slice(top.length);
    if (rel.split('/').some((s) => s.startsWith('.') || s === FOLDER || s === 'node_modules'))
      continue;
    if (libraryPart(rel)) out.set(rel, data);
  }
  if (!out.has(MANIFEST)) fail(`${from} has no kerf.json at its top. Is it a KerfScript library?`);
  return out;
}

const newer = (a: string, b: string) => {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1 > b1 || (a1 === b1 && a2 > b2);
};

interface Fetched {
  manifest: Manifest & { name: string };
  files: Files;
  resolved: string;
  integrity: string;
}

async function fetchLibrary(
  spec: string,
  base: string,
  root: string,
  fetchFn: Fetch,
  cache: Map<string, Buffer>,
): Promise<Fetched> {
  const source = parseSource(spec, base);
  let files: Files;
  let resolved: string;
  if (source.kind === 'folder') {
    if (!isFile(join(source.path, MANIFEST)))
      fail(`${spec}: no kerf.json in ${source.path}. Is it a KerfScript library?`);
    files = libraryTree(readFolder(source.path, libraryPart), spec);
    resolved = relative(root, source.path).split(sep).join('/') || '.';
    if (!resolved.startsWith('.') && !isAbsolute(resolved)) resolved = './' + resolved;
  } else {
    const url =
      source.kind === 'github'
        ? `https://github.com/${source.owner}/${source.repo}/archive/${source.ref}.tar.gz`
        : source.url;
    const data = cache.get(url) ?? (await download(url, fetchFn));
    cache.set(url, data);
    const archive = untar(data, spec);
    files = libraryTree(archive.files, spec);
    // A tag or branch can move; the commit cannot
    resolved =
      source.kind === 'github' && /^[0-9a-f]{40}$/.test(archive.commit ?? '')
        ? `https://github.com/${source.owner}/${source.repo}/archive/${archive.commit}.tar.gz`
        : url;
  }
  const manifest = checkManifest(
    JSON.parse(files.get(MANIFEST)!.toString('utf8')),
    `the kerf.json of ${spec}`,
  );
  if (!manifest.name) fail(`${spec}: its kerf.json has no "name", so it is not a library`);
  if (manifest.language && newer(manifest.language, LANGUAGE_VERSION))
    fail(
      `${manifest.name} needs KerfScript language ${manifest.language} or later, and this kerf has ${LANGUAGE_VERSION}. Update kerf.`,
    );
  return {
    manifest: manifest as Fetched['manifest'],
    files,
    resolved,
    integrity: integrity(files),
  };
}

function writeLibrary(dir: string, files: Files) {
  rmSync(dir, { recursive: true, force: true });
  for (const [p, data] of files) {
    const file = join(dir, ...p.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  }
}

const lockText = (libraries: Map<string, Locked>) => {
  const sorted = [...libraries].sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify({ lockVersion: 1, libraries: Object.fromEntries(sorted) }, null, 2) + '\n';
};

/** Makes kerf_libraries/ match kerf.json, with the libraries those
 * libraries use, and writes kerf.lock. A library kerf.lock pins is
 * downloaded from the exact link it records and must have the same files. */
export async function install(
  root: string,
  options: InstallOptions & { cache?: Map<string, Buffer> } = {},
): Promise<Lock> {
  const fetchFn = options.fetch ?? (globalThis.fetch as Fetch);
  const log = options.log ?? (() => {});
  const cache = options.cache ?? new Map<string, Buffer>();
  const manifest = readManifest(root);
  const old = readLock(root);
  // The libraries chosen so far: what each is, where it points and who asked
  const chosen = new Map<string, { entry: Locked; at: string; shown: string; from: string }>();
  const queue = Object.entries(manifest.libraries).map(([name, source]) => ({
    name,
    source,
    base: root,
    from: MANIFEST,
  }));
  const folder = join(root, FOLDER);
  while (queue.length) {
    const { name, source, base, from } = queue.shift()!;
    const parsed = parseSource(source, base);
    const local = parsed.kind === 'folder';
    const shown = local ? `${source} (${parsed.path})` : source;
    const have = chosen.get(name);
    if (have) {
      // The same text can point at different folders, so compare where they
      // point. A library kerf.json names itself wins over the ones
      // libraries ask for.
      if (have.at !== where(parsed) && !own(manifest.libraries, name))
        fail(
          `${from} uses ${name} from ${shown}, and ${have.from} uses it from ${have.shown}. Add ${name} to kerf.json with the source to use.`,
        );
      continue;
    }
    const before = own(old?.libraries, name);
    const pinned =
      before?.source === source && (!local || resolve(root, before.resolved) === parsed.path)
        ? before
        : undefined;
    if (options.frozen && !pinned)
      fail(`kerf.lock does not pin ${name} from ${source}. Run kerf install without --frozen.`);
    const dir = join(folder, name);
    let entry: Locked;
    if (pinned && !local && isDir(dir) && integrity(readFolder(dir)) === pinned.integrity)
      entry = pinned;
    else {
      // A folder is read again each time, so changes to it come through
      const got = await fetchLibrary(
        pinned && !local ? pinned.resolved : source,
        local ? base : root,
        root,
        fetchFn,
        cache,
      );
      if (got.manifest.name !== name)
        fail(
          `${source} is the library "${got.manifest.name}", so ${from} must call it ${got.manifest.name}, not ${name}`,
        );
      if (pinned && got.integrity !== pinned.integrity && (!local || options.frozen))
        fail(
          local
            ? `${name} in ${source} changed since kerf.lock pinned it. Run kerf install without --frozen.`
            : `${name} from ${pinned.resolved} no longer matches kerf.lock. If you trust the change, remove ${name} from kerf.lock and run kerf install again.`,
        );
      writeLibrary(dir, got.files);
      entry = {
        source,
        ...(got.manifest.version ? { version: got.manifest.version } : {}),
        resolved: got.resolved,
        integrity: got.integrity,
      };
      if (!pinned || pinned.integrity !== got.integrity || !local)
        log(
          `${pinned ? 'Restored' : 'Installed'} ${name}${entry.version ? ' ' + entry.version : ''} from ${source}`,
        );
    }
    chosen.set(name, { entry, at: where(parsed), shown, from });
    const libBase = parsed.kind === 'folder' ? parsed.path : undefined;
    for (const [n, s] of Object.entries(
      readManifest(dir, `${FOLDER}/${name}/${MANIFEST}`).libraries,
    )) {
      if (parseSource(s, root).kind === 'folder' && !libBase)
        fail(
          `${name} uses ${n} from the folder ${s}: a published library needs github: or https: sources`,
        );
      queue.push({ name: n, source: s, base: libBase ?? root, from: name });
    }
  }
  const text = lockText(new Map([...chosen].map(([name, c]) => [name, c.entry])));
  const oldText = existsSync(join(root, LOCK)) ? readFileSync(join(root, LOCK), 'utf8') : '';
  if (options.frozen && text !== oldText.replace(/\r\n/g, '\n'))
    fail('kerf.lock is out of date. Run kerf install without --frozen.');
  if (isDir(folder))
    for (const e of readdirSync(folder, { withFileTypes: true }))
      if (e.isDirectory() && NAME.test(e.name) && !chosen.has(e.name)) {
        rmSync(join(folder, e.name), { recursive: true, force: true });
        log(`Removed ${e.name}`);
      }
  if (text !== oldText.replace(/\r\n/g, '\n')) writeFileSync(join(root, LOCK), text);
  return JSON.parse(text) as Lock;
}

/** Problems with a project's libraries, found without downloading: kerf.json
 * and kerf.lock disagree, or kerf_libraries/ differs from kerf.lock. */
export function check(root: string): string[] {
  const manifest = readManifest(root);
  const lock = readLock(root);
  const names = Object.keys(manifest.libraries);
  if (!lock) return names.length ? ['kerf.lock is missing. Run kerf install.'] : [];
  const problems: string[] = [];
  const seen = new Set<string>();
  const queue = [...names];
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const pinned = own(lock.libraries, name);
    if (!pinned) {
      problems.push(`${name} is not in kerf.lock. Run kerf install.`);
      continue;
    }
    if (names.includes(name) && pinned.source !== manifest.libraries[name])
      problems.push(
        `kerf.json takes ${name} from ${manifest.libraries[name]}, and kerf.lock from ${pinned.source}. Run kerf install.`,
      );
    const dir = join(root, FOLDER, name);
    if (!isDir(dir)) {
      problems.push(`${name} is not in ${FOLDER}. Run kerf install.`);
      continue;
    }
    if (integrity(readFolder(dir)) !== pinned.integrity)
      problems.push(`The files in ${FOLDER}/${name} differ from kerf.lock. Run kerf install.`);
    try {
      queue.push(...Object.keys(readManifest(dir).libraries));
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  for (const name of Object.keys(lock.libraries))
    if (!seen.has(name)) problems.push(`kerf.lock pins ${name}, which nothing uses any more.`);
  return problems;
}

// kerf.json as written, so add and remove keep its other fields
function editManifest(root: string, edit: (libraries: Record<string, string>) => void) {
  const file = join(root, MANIFEST);
  const raw = existsSync(file)
    ? (readJson(file, MANIFEST) as Record<string, unknown>)
    : ({} as Record<string, unknown>);
  checkManifest(raw, MANIFEST);
  const libraries = { ...((raw.libraries as Record<string, string>) ?? {}) };
  edit(libraries);
  raw.libraries = libraries;
  return { file, before: existsSync(file) ? readFileSync(file, 'utf8') : undefined, raw };
}

async function withManifest(
  root: string,
  edit: (libraries: Record<string, string>) => void,
  options: InstallOptions & { cache?: Map<string, Buffer> },
): Promise<Lock> {
  const { file, before, raw } = editManifest(root, edit);
  writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  try {
    return await install(root, options);
  } catch (e) {
    if (before === undefined) rmSync(file, { force: true });
    else writeFileSync(file, before);
    throw e;
  }
}

/** Adds a library to kerf.json, under the name its own kerf.json gives, and
 * installs it. Makes kerf.json if the folder has none. */
export async function add(
  root: string,
  source: string,
  options: InstallOptions = {},
): Promise<{ name: string; lock: Lock }> {
  const cache = new Map<string, Buffer>();
  const got = await fetchLibrary(
    source,
    root,
    root,
    options.fetch ?? (globalThis.fetch as Fetch),
    cache,
  );
  const name = got.manifest.name;
  if (name === ownName(root)) fail(`This project is the library ${name}; it cannot use itself`);
  const lock = await withManifest(root, (libs) => void (libs[name] = source), {
    ...options,
    cache,
  });
  return { name, lock };
}

/** Removes a library from kerf.json, and from kerf_libraries/ and kerf.lock
 * unless another library uses it. */
export async function remove(
  root: string,
  name: string,
  options: InstallOptions = {},
): Promise<Lock> {
  return withManifest(
    root,
    (libs) => {
      if (own(libs, name) === undefined) fail(`kerf.json has no library named ${name}`);
      delete libs[name];
    },
    options,
  );
}

// use and include statements anywhere in a program
function usePaths(node: unknown, out: { path: string; line: number }[] = []) {
  if (Array.isArray(node)) for (const n of node) usePaths(n, out);
  else if (node && typeof node === 'object') {
    const n = node as { kind?: string; path?: string; pos?: { line: number } };
    if (n.kind === 'use' && typeof n.path === 'string')
      out.push({ path: n.path, line: n.pos!.line });
    else for (const v of Object.values(n)) usePaths(v, out);
  }
  return out;
}

function tarGz(entries: [string, Buffer][]): Buffer {
  const blocks: Buffer[] = [];
  for (const [path, body] of entries) {
    const h = Buffer.alloc(512);
    let name = path;
    let prefix = '';
    if (Buffer.byteLength(name) > 100) {
      const cut = path.lastIndexOf('/', 155);
      if (cut < 0 || Buffer.byteLength(path.slice(cut + 1)) > 100)
        fail(`${path}: the path is too long to pack`);
      prefix = path.slice(0, cut);
      name = path.slice(cut + 1);
    }
    h.write(name, 0, 100);
    h.write('0000644\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136);
    h.fill(0x20, 148, 156);
    h.write('0', 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    h.write(prefix, 345, 155);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 9 });
}

/** Checks a library and writes it as name-version.tar.gz in its folder, or
 * to `out`, ready to attach to a release. Every .kerf file must parse, and
 * every `use <...>` must name the standard library, the library's own files
 * as <name/...>, or a library its kerf.json names. */
export function pack(
  root: string,
  out?: string,
): { file: string; name: string; version: string; files: number; integrity: string } {
  const manifest = readManifest(root);
  const name = manifest.name ?? fail('kerf.json needs a "name" to pack a library');
  const version = manifest.version ?? fail('kerf.json needs a "version", like 1.0.0');
  const files = readFolder(root, libraryPart);
  const problems: string[] = [];
  for (const [n, s] of Object.entries(manifest.libraries))
    if (parseSource(s, root).kind === 'folder')
      problems.push(
        `kerf.json: ${n} comes from a folder; a published library needs github: or https: sources`,
      );
  const has = (p: string) => files.has(p) || files.has(p + '.kerf');
  for (const [p, data] of files) {
    if (!p.endsWith('.kerf')) continue;
    let program;
    try {
      program = parse(data.toString('utf8'), `${name}/${p}`).program;
    } catch (e) {
      problems.push(`${p}: ${(e as Error).message}`);
      continue;
    }
    for (const u of usePaths(program)) {
      const first = u.path.split('/')[0];
      const ok =
        Object.prototype.hasOwnProperty.call(LIBRARIES, u.path) ||
        (first === name && has(u.path.slice(name.length + 1))) ||
        (u.path.includes('/') && own(manifest.libraries, first) !== undefined);
      if (!ok)
        problems.push(
          `${p}, line ${u.line}: <${u.path}> will not be found once the library is installed` +
            (has(u.path) ? `. Write <${name}/${u.path}> for the library's own file.` : '.'),
        );
    }
  }
  if (![...files.keys()].some((p) => p.endsWith('.kerf')))
    problems.push('There are no .kerf files to pack');
  if (problems.length) fail(problems.join('\n'));
  const entries = [...files.keys()]
    .sort()
    .map((p): [string, Buffer] => [`${name}/${p}`, files.get(p)!]);
  const file = out ?? join(root, `${name}-${version}.tar.gz`);
  writeFileSync(file, tarGz(entries));
  return { file, name, version, files: files.size, integrity: integrity(files) };
}
