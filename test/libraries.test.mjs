import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import {
  add,
  check,
  install,
  installedPaths,
  integrity,
  libraryFile,
  pack,
  remove,
  resolver,
} from '../dist/libraries.js';
import { render } from '../dist/index.js';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

function folder(files) {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-libraries-'));
  write(dir, files);
  return dir;
}

function write(dir, files) {
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), typeof text === 'string' ? text : JSON.stringify(text));
  }
}

const read = (dir, p) => readFileSync(join(dir, p), 'utf8');
const json = (dir, p) => JSON.parse(read(dir, p));

// A .tar.gz as git archive writes one: a global header with the commit, then
// everything in one folder
function tgz(files, { commit, top = 'repo-main/' } = {}) {
  const blocks = [];
  const header = (name, size, type) => {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100);
    h.write('0000644\0', 100);
    h.write(size.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136);
    h.fill(0x20, 148, 156);
    h.write(type, 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
  };
  const entry = (name, body, type = '0') => {
    blocks.push(header(name, body.length, type), body);
    blocks.push(Buffer.alloc((512 - (body.length % 512)) % 512));
  };
  if (commit) {
    const record = `comment=${commit}\n`;
    entry('pax_global_header', Buffer.from(`${record.length + 3} ${record}`), 'g');
  }
  for (const [p, text] of Object.entries(files))
    entry(top + p, Buffer.from(typeof text === 'string' ? text : JSON.stringify(text)));
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

// Serves archives by path on this machine
async function serve(archives) {
  const server = createServer((req, res) => {
    const body = archives[req.url];
    res.writeHead(body ? 200 : 404).end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise((r) => server.close(r)) };
}

const FEET = {
  'kerf.json': { name: 'feet', version: '1.0.0', language: '0.2' },
  'feet.kerf':
    'use <feet/size>\n\n// Holes for rubber feet\nmodule feet(size, inset = 8) {\n  for (x = [inset, size[0] - inset], y = [inset, size[1] - inset])\n    translate([x, y]) circle(d = foot_d());\n}\n',
  'size.kerf': 'function foot_d() = 6;\n',
  'README.md': '# feet\n',
  'docs/photo.png': 'not kept',
  '.github/ci.kerf': 'not kept',
};

const BASE =
  'use <feet/feet>\n\npart("base") difference() {\n  rect([100, 60]);\n  feet([100, 60]);\n}\n';

// A fetch that serves archives by link and records the links asked for
function fetcher(archives, calls = []) {
  return async (url) => {
    calls.push(url);
    const body = archives[url];
    return {
      ok: !!body,
      status: body ? 200 : 404,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
    };
  };
}

test('use <name/...> finds the project itself, installed libraries, then files by the design', () => {
  const root = folder({
    'kerf.json': { name: 'shelf', libraries: { feet: './feet' } },
    'parts/side.kerf': '',
    'designs/local/thing.kerf': '',
    'kerf_libraries/feet/feet.kerf': '',
    'designs/feet/other.kerf': '',
  });
  const designs = join(root, 'designs');
  assert.equal(libraryFile(designs, 'shelf/parts/side'), join(root, 'parts', 'side.kerf'));
  assert.equal(
    libraryFile(designs, 'feet/feet'),
    join(root, 'kerf_libraries', 'feet', 'feet.kerf'),
  );
  assert.equal(
    libraryFile(designs, 'feet/feet.kerf'),
    join(root, 'kerf_libraries', 'feet', 'feet.kerf'),
  );
  assert.equal(libraryFile(designs, 'local/thing'), join(designs, 'local', 'thing.kerf'));
  // An installed library's name is not looked up next to the design too
  assert.equal(libraryFile(designs, 'feet/other'), undefined);
  // Without a kerf.json the design's folder is all there is
  const plain = folder({ 'lib/tab.kerf': '' });
  assert.equal(libraryFile(plain, 'lib/tab'), join(plain, 'lib', 'tab.kerf'));
  assert.deepEqual(installedPaths(designs).sort(), [
    'feet/feet',
    'shelf/designs/feet/other',
    'shelf/designs/local/thing',
    'shelf/parts/side',
  ]);
});

test('a folder library installs, renders, and is pinned by a hash of its files', async () => {
  const lib = folder(FEET);
  const root = folder({ 'base.kerf': BASE });
  const lines = [];
  const { name, lock } = await add(root, lib, { log: (l) => lines.push(l) });
  assert.equal(name, 'feet');
  assert.deepEqual(json(root, 'kerf.json'), { libraries: { feet: lib } });
  assert.match(lock.libraries.feet.integrity, /^sha256-/);
  assert.equal(lock.libraries.feet.version, '1.0.0');
  assert.deepEqual(json(root, 'kerf.lock'), lock);
  assert.deepEqual(lines, [`Installed feet 1.0.0 from ${lib}`]);
  // .kerf files, kerf.json and the readme; not pictures or dot folders
  assert.ok(existsSync(join(root, 'kerf_libraries/feet/README.md')));
  assert.ok(!existsSync(join(root, 'kerf_libraries/feet/docs')));
  assert.ok(!existsSync(join(root, 'kerf_libraries/feet/.github')));
  const r = render(BASE, { resolve: resolver(join(root, 'base.kerf')) });
  const inline = render(
    BASE.replace(
      'use <feet/feet>',
      FEET['feet.kerf'].replace('use <feet/size>', FEET['size.kerf']),
    ),
  );
  assert.equal(r.parts[0].cutLength, inline.parts[0].cutLength);
  assert.ok(r.parts[0].cutLength > 390);
  assert.deepEqual(check(root), []);
  // Changes to the folder come through on the next install
  write(lib, { 'size.kerf': 'function foot_d() = 8;\n' });
  const again = await install(root);
  assert.notEqual(again.libraries.feet.integrity, lock.libraries.feet.integrity);
  assert.equal(read(root, 'kerf_libraries/feet/size.kerf'), 'function foot_d() = 8;\n');
  write(lib, { 'size.kerf': '' });
  await assert.rejects(install(root, { frozen: true }), /changed since kerf.lock pinned it/);
});

test('a GitHub tag is pinned to its commit, and a later install fetches that commit', async () => {
  const commit = 'a'.repeat(40);
  const archive = tgz(FEET, { commit, top: 'kerf-feet-1.0.0/' });
  const tagged = 'https://github.com/maker/kerf-feet/archive/v1.0.0.tar.gz';
  const pinned = `https://github.com/maker/kerf-feet/archive/${commit}.tar.gz`;
  const calls = [];
  const fetch = fetcher({ [tagged]: archive, [pinned]: archive }, calls);
  const root = folder({ 'base.kerf': BASE });
  const { lock } = await add(root, 'github:maker/kerf-feet@v1.0.0', { fetch });
  assert.deepEqual(calls, [tagged]);
  assert.deepEqual(lock.libraries.feet, {
    source: 'github:maker/kerf-feet@v1.0.0',
    version: '1.0.0',
    resolved: pinned,
    integrity: lock.libraries.feet.integrity,
  });
  // Installed and unchanged: nothing is downloaded
  await install(root, { fetch, frozen: true });
  assert.equal(calls.length, 1);
  // A fresh checkout without kerf_libraries/ gets the pinned commit
  rmSync(join(root, 'kerf_libraries'), { recursive: true });
  const lines = [];
  await install(root, { fetch, frozen: true, log: (l) => lines.push(l) });
  assert.deepEqual(calls.slice(1), [pinned]);
  assert.deepEqual(lines, ['Restored feet 1.0.0 from github:maker/kerf-feet@v1.0.0']);
  assert.deepEqual(check(root), []);
  // Different files at the pinned link are refused
  rmSync(join(root, 'kerf_libraries'), { recursive: true });
  const changed = tgz({ ...FEET, 'size.kerf': 'function foot_d() = 7;\n' }, { commit });
  await assert.rejects(
    install(root, { fetch: fetcher({ [pinned]: changed }) }),
    /feet from https:\/\/github.com\/maker\/kerf-feet\/archive\/a+\.tar\.gz no longer matches kerf.lock/,
  );
});

test('kerf add and install download a .tar.gz link', async () => {
  const lib = folder(FEET);
  const packed = pack(lib);
  assert.equal(packed.file, join(lib, 'feet-1.0.0.tar.gz'));
  assert.equal(packed.files, 4);
  const server = await serve({ '/feet-1.0.0.tar.gz': readFileSync(packed.file) });
  try {
    const root = folder({ 'base.kerf': BASE });
    const url = `${server.url}/feet-1.0.0.tar.gz`;
    const added = await run(process.execPath, [CLI, 'add', url], { cwd: root });
    assert.match(
      added.stderr,
      /Installed feet 1.0.0 from http:\/\/127.0.0.1:\d+\/feet-1.0.0.tar.gz/,
    );
    assert.match(added.stderr, /Added feet 1.0.0. Use it with use <feet\/...>/);
    const lock = json(root, 'kerf.lock');
    assert.equal(lock.libraries.feet.resolved, url);
    assert.equal(lock.libraries.feet.integrity, packed.integrity);
    const checked = await run(process.execPath, [CLI, 'check', 'base.kerf'], { cwd: root });
    assert.match(checked.stdout, /base: 100 x 60 mm/);
    // A design in a folder below the project finds the libraries too
    write(root, { 'designs/base.kerf': BASE });
    await run(process.execPath, [CLI, 'check', join('designs', 'base.kerf')], { cwd: root });
    await run(process.execPath, [CLI, 'install', '--check'], { cwd: root });
    write(root, { 'kerf_libraries/feet/size.kerf': 'function foot_d() = 1;\n' });
    await assert.rejects(
      run(process.execPath, [CLI, 'install', '--check'], { cwd: root }),
      (e) => e.code === 1 && /differ from kerf.lock/.test(e.stderr),
    );
    await run(process.execPath, [CLI, 'install', '--frozen'], { cwd: root });
    assert.equal(read(root, 'kerf_libraries/feet/size.kerf'), FEET['size.kerf']);
    await run(process.execPath, [CLI, 'remove', 'feet'], { cwd: root });
    assert.deepEqual(json(root, 'kerf.lock').libraries, {});
    assert.ok(!existsSync(join(root, 'kerf_libraries/feet')));
  } finally {
    await server.close();
  }
});

test('libraries that libraries use are installed, and the design settles a disagreement', async () => {
  const archives = {
    'https://x.test/feet-1.tar.gz': tgz(FEET),
    'https://x.test/feet-2.tar.gz': tgz({
      ...FEET,
      'kerf.json': { name: 'feet', version: '2.0.0' },
    }),
    'https://x.test/stand.tar.gz': tgz({
      'kerf.json': { name: 'stand', libraries: { feet: 'https://x.test/feet-1.tar.gz' } },
      'stand.kerf': 'use <feet/feet>\nmodule stand() feet([50, 50]);\n',
    }),
    'https://x.test/lamp.tar.gz': tgz({
      'kerf.json': { name: 'lamp', libraries: { feet: 'https://x.test/feet-2.tar.gz' } },
      'lamp.kerf': 'use <feet/feet>\nmodule lamp() feet([80, 80]);\n',
    }),
  };
  const fetch = fetcher(archives);
  const root = folder({
    'kerf.json': { libraries: { stand: 'https://x.test/stand.tar.gz' } },
  });
  const lock = await install(root, { fetch });
  assert.deepEqual(Object.keys(lock.libraries), ['feet', 'stand']);
  assert.equal(lock.libraries.feet.version, '1.0.0');
  const r = render('use <stand/stand>\npart("s") stand();\n', {
    resolve: resolver(join(root, 'design.kerf')),
  });
  assert.equal(r.parts.length, 1);
  write(root, {
    'kerf.json': {
      libraries: { stand: 'https://x.test/stand.tar.gz', lamp: 'https://x.test/lamp.tar.gz' },
    },
  });
  await assert.rejects(
    install(root, { fetch }),
    /lamp uses feet from https:\/\/x.test\/feet-2.tar.gz, and stand uses it from https:\/\/x.test\/feet-1.tar.gz. Add feet to kerf.json/,
  );
  write(root, {
    'kerf.json': {
      libraries: {
        stand: 'https://x.test/stand.tar.gz',
        lamp: 'https://x.test/lamp.tar.gz',
        feet: 'https://x.test/feet-2.tar.gz',
      },
    },
  });
  const settled = await install(root, { fetch });
  assert.equal(settled.libraries.feet.version, '2.0.0');
  // Removing the library that used it takes it out of kerf.lock too
  write(root, { 'kerf.json': { libraries: { lamp: 'https://x.test/lamp.tar.gz' } } });
  const lines = [];
  await install(root, { fetch, log: (l) => lines.push(l) });
  assert.deepEqual(lines, ['Removed stand']);
  assert.deepEqual(check(root), []);
});

test('install refuses what it cannot trust or use', async () => {
  const root = folder({ 'kerf.json': { libraries: { feet: 'https://x.test/a.tar.gz' } } });
  const tryWith = (files, opts) =>
    install(root, { fetch: fetcher({ 'https://x.test/a.tar.gz': tgz(files, opts) }) });
  await assert.rejects(
    tryWith({ ...FEET, '../../evil.kerf': 'x' }, { top: '' }),
    /holds a file outside its folder: ..\/..\/evil.kerf/,
  );
  await assert.rejects(tryWith({ 'feet.kerf': '' }), /has no kerf.json at its top/);
  await assert.rejects(
    tryWith({ ...FEET, 'kerf.json': { name: 'feet', language: '9.0' } }),
    /feet needs KerfScript language 9.0 or later, and this kerf has 0.3. Update kerf./,
  );
  await assert.rejects(
    tryWith({ ...FEET, 'kerf.json': { name: 'paws' } }),
    /is the library "paws", so kerf.json must call it paws, not feet/,
  );
  await assert.rejects(
    install(root, { fetch: fetcher({}) }),
    /Could not download https:\/\/x.test\/a.tar.gz: HTTP 404. Check the name and the tag/,
  );
  await assert.rejects(
    install(root, { fetch: fetcher({}), frozen: true }),
    /kerf.lock does not pin feet/,
  );
  write(root, { 'kerf.json': { libraries: { feet: 'http://example.com/a.tar.gz' } } });
  await assert.rejects(install(root), /Use https:\/\/ to download/);
  write(root, { 'kerf.json': { libraries: { feet: 'feet' } } });
  await assert.rejects(install(root), /"feet" is not a library source/);
  write(root, { 'kerf.json': { libraries: { kerf: './x' } } });
  await assert.rejects(install(root), /"kerf" is the standard library's name/);
  write(root, { 'kerf.json': { libraries: { 'Big Name': './x' } } });
  await assert.rejects(install(root), /is not a library name/);
  write(root, { 'kerf.json': { libraries: {} } });
  await assert.rejects(remove(root, 'nothing'), /kerf.json has no library named nothing/);
});

test('kerf install --check finds every way the project and kerf.lock disagree', async () => {
  const lib = folder(FEET);
  const root = folder({ 'kerf.json': { libraries: { feet: lib } } });
  assert.deepEqual(check(root), ['kerf.lock is missing. Run kerf install.']);
  await install(root);
  assert.deepEqual(check(root), []);
  const lock = json(root, 'kerf.lock');
  write(root, {
    'kerf.lock': { ...lock, libraries: { ...lock.libraries, old: lock.libraries.feet } },
  });
  assert.deepEqual(check(root), ['kerf.lock pins old, which nothing uses any more.']);
  write(root, { 'kerf.json': { libraries: { feet: './elsewhere' } } });
  rmSync(join(root, 'kerf_libraries/feet/size.kerf'));
  assert.deepEqual(check(root), [
    `kerf.json takes feet from ./elsewhere, and kerf.lock from ${lib}. Run kerf install.`,
    'The files in kerf_libraries/feet differ from kerf.lock. Run kerf install.',
    'kerf.lock pins old, which nothing uses any more.',
  ]);
});

test('the hash of a library ignores line endings, so git on Windows does not change it', () => {
  const lf = new Map([['a.kerf', Buffer.from('a = 1;\nb = 2;\n')]]);
  const crlf = new Map([['a.kerf', Buffer.from('a = 1;\r\nb = 2;\r\n')]]);
  assert.equal(integrity(lf), integrity(crlf));
  assert.notEqual(integrity(lf), integrity(new Map([['b.kerf', lf.get('a.kerf')]])));
});

test('kerf pack checks a library before it is published', () => {
  const lib = folder(FEET);
  const first = pack(lib);
  const bytes = readFileSync(first.file);
  assert.deepEqual(readFileSync(pack(lib).file), bytes, 'the same files pack the same way');
  write(lib, { 'kerf_libraries/other/x.kerf': 'nonsense(' });
  assert.equal(pack(lib).integrity, first.integrity, 'installed libraries are not packed');
  write(lib, {
    'size.kerf': 'use <feet>\nuse <kerf/box>\nuse <hinges/x>\nfunction foot_d() = 6;\n',
  });
  assert.throws(
    () => pack(lib),
    /size.kerf, line 1: <feet> will not be found once the library is installed. Write <feet\/feet> for the library's own file.\nsize.kerf, line 3: <hinges\/x> will not be found/,
  );
  write(lib, {
    'kerf.json': { name: 'feet', version: '1.0.0', libraries: { hinges: './hinges' } },
    'size.kerf': 'use <hinges/x>\nfunction foot_d() = (;\n',
  });
  assert.throws(
    () => pack(lib),
    /hinges comes from a folder; a published library needs github: or https: sources\nsize.kerf: /,
  );
  write(lib, { 'kerf.json': { name: 'feet' } });
  assert.throws(() => pack(lib), /kerf.json needs a "version"/);
  write(lib, { 'kerf.json': { version: '1.0.0' } });
  assert.throws(() => pack(lib), /kerf.json needs a "name"/);
  write(lib, { 'kerf.json': { name: 'feet', version: 'one' } });
  assert.throws(() => pack(lib), /"version" must look like 1.2.0/);
});

test('the library in docs/shared-libraries.md packs as it is', () => {
  const out = join(folder({}), 'feet.tar.gz');
  const r = pack(fileURLToPath(new URL('fixtures/feet/', import.meta.url)), out);
  assert.deepEqual([r.name, r.version, r.files], ['feet', '1.0.0', 3]);
  assert.ok(existsSync(out));
});

test('the VS Code schema for kerf.json takes what kerf install takes', () => {
  const schema = JSON.parse(
    read(fileURLToPath(new URL('../editors/vscode/schemas/', import.meta.url)), 'kerf.schema.json'),
  );
  const props = schema.properties;
  const name = new RegExp(props.name.pattern);
  const source = new RegExp(props.libraries.additionalProperties.pattern);
  for (const n of ['feet', 'kerf-feet', 'a_1']) assert.ok(name.test(n), n);
  for (const n of ['Feet', 'big name', '-x', '']) assert.ok(!name.test(n), n);
  for (const s of [
    'github:maker/kerf-feet@v1.0.0',
    'github:a/b',
    'https://x.test/a.tar.gz',
    './feet',
    '../feet',
    'file:./x',
    'C:\libs\feet',
  ])
    assert.ok(source.test(s), s);
  for (const s of ['feet', 'github:a']) assert.ok(!source.test(s), s);
  assert.ok(new RegExp(props.version.pattern).test('1.2.0-beta.1'));
  assert.ok(!new RegExp(props.version.pattern).test('one'));
});

test('the same source text from two folders is two libraries, and must be settled', async () => {
  const lib = (name, uses, common) => ({
    [`${name}/kerf.json`]: { name, libraries: { common: uses } },
    [`${name}/${name}.kerf`]: `use <common/c>\nmodule ${name}() c();\n`,
    ...(common ? { [`${name}/common/kerf.json`]: { name: 'common' } } : {}),
    ...(common ? { [`${name}/common/c.kerf`]: `module c() circle(${common});\n` } : {}),
  });
  const root = folder({
    'kerf.json': { libraries: { a: './a', b: './b' } },
    ...lib('a', './common', 2),
    ...lib('b', './common', 9),
  });
  await assert.rejects(
    install(root),
    /b uses common from \.\/common \(.+b.common\), and a uses it from \.\/common \(.+a.common\)\. Add common to kerf.json/,
  );
  // Different text for the same folder is one library
  const shared = folder({
    'kerf.json': { libraries: { a: './a', b: './b' } },
    ...lib('a', '../common', 0),
    ...lib('b', './../common', 0),
    'common/kerf.json': { name: 'common' },
    'common/c.kerf': 'module c() circle(4);\n',
  });
  const lock = await install(shared);
  assert.deepEqual(Object.keys(lock.libraries), ['a', 'b', 'common']);
});

test('a library may be named constructor, or anything else objects have', async () => {
  const root = folder({
    'kerf.json': { libraries: { constructor: './c' } },
    'c/kerf.json': { name: 'constructor', version: '1.0.0' },
    'c/c.kerf': 'module c() rect(4);\n',
  });
  const lock = await install(root);
  assert.deepEqual(Object.keys(lock.libraries), ['constructor']);
  assert.ok(existsSync(join(root, 'kerf_libraries/constructor/c.kerf')));
  assert.deepEqual(check(root), []);
  await remove(root, 'constructor');
  assert.deepEqual(json(root, 'kerf.lock').libraries, {});
  await assert.rejects(remove(root, 'constructor'), /has no library named constructor/);
});

test('kerf fmt leaves installed libraries alone', async () => {
  const lib = folder({ 'kerf.json': { name: 'messy' }, 'm.kerf': 'module   m()   rect(4);\n' });
  const root = folder({ 'design.kerf': 'use <messy/m>\nm(  );\n' });
  await add(root, lib);
  await run(process.execPath, [CLI, 'fmt', '.'], { cwd: root });
  assert.equal(read(root, 'design.kerf'), 'use <messy/m>\nm();\n');
  assert.equal(read(root, 'kerf_libraries/messy/m.kerf'), 'module   m()   rect(4);\n');
  assert.deepEqual(check(root), []);
});

test('a download stops at 20 MB as it arrives', { timeout: 30000 }, async () => {
  let sent = 0;
  const chunk = Buffer.alloc(1 << 16);
  // A server that sends without end, with no length given
  const server = createServer((req, res) => {
    res.writeHead(200);
    const pump = () => {
      while (!res.destroyed && res.write(chunk)) sent += chunk.length;
      if (!res.destroyed) res.once('drain', pump);
    };
    res.on('close', () => res.removeAllListeners('drain'));
    pump();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/big.tar.gz`;
    const root = folder({ 'kerf.json': { libraries: { big: url } } });
    await assert.rejects(install(root), /big.tar.gz is larger than 20 MB/);
    assert.ok(sent < 40 << 20, `sent ${sent >> 20} MB`);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  // A length over the limit is refused before reading anything
  const root = folder({ 'kerf.json': { libraries: { big: 'https://x.test/big.tar.gz' } } });
  const fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: (h) => (h === 'content-length' ? String(30 << 20) : null) },
    body: null,
    arrayBuffer: () => assert.fail('the body was read'),
  });
  await assert.rejects(install(root, { fetch }), /larger than 20 MB/);
});

test('GitHub sources match in any case of owner and repository, but not of the ref', async () => {
  const lib = (name, feet) => ({
    'kerf.json': { name, libraries: { feet } },
    [`${name}.kerf`]: `use <feet/feet>\nmodule ${name}() feet([50, 50]);\n`,
  });
  const archives = {};
  for (const ref of ['Release', 'release', 'v1'])
    for (const repo of ['maker/kerf-feet', 'Maker/Kerf-Feet'])
      archives[`https://github.com/${repo}/archive/${ref}.tar.gz`] = tgz({
        ...FEET,
        'kerf.json': { name: 'feet', version: ref === 'Release' ? '2.0.0' : '1.0.0' },
      });
  archives['https://x.test/stand.tar.gz'] = tgz(lib('stand', 'github:maker/kerf-feet@Release'));
  archives['https://x.test/lamp.tar.gz'] = tgz(lib('lamp', 'github:maker/kerf-feet@release'));
  archives['https://x.test/desk.tar.gz'] = tgz(lib('desk', 'github:Maker/Kerf-Feet@v1'));
  archives['https://x.test/shelf.tar.gz'] = tgz(lib('shelf', 'github:maker/kerf-feet@v1'));
  const fetch = fetcher(archives);
  const project = (libraries) => folder({ 'kerf.json': { libraries } });
  await assert.rejects(
    install(project({ stand: 'https://x.test/stand.tar.gz', lamp: 'https://x.test/lamp.tar.gz' }), {
      fetch,
    }),
    /lamp uses feet from github:maker\/kerf-feet@release, and stand uses it from github:maker\/kerf-feet@Release/,
  );
  const lock = await install(
    project({ desk: 'https://x.test/desk.tar.gz', shelf: 'https://x.test/shelf.tar.gz' }),
    { fetch },
  );
  assert.deepEqual(Object.keys(lock.libraries), ['desk', 'feet', 'shelf']);
});
