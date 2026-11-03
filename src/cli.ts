// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import {
  format,
  formatError,
  importSvg,
  parameters,
  render,
  KerfError,
  LANGUAGE_VERSION,
  VERSION,
  type Value,
} from './index.js';
import { parse } from './parser.js';
import { Evaluator } from './evaluator.js';
import { BUILTIN_FONT, withBuiltinFont } from './font.js';
import { startServer, workerMain } from './lsp.js';
import {
  add,
  check as checkLibraries,
  findProject,
  FOLDER,
  install,
  LibraryError,
  pack,
  readManifest,
  remove,
  resolver,
} from './libraries.js';

const HELP = `kerf ${VERSION}: the KerfScript laser cutting language

Usage:
  kerf render <file.kerf> [-o out.svg] [options]
  kerf params <file.kerf>            print customizer parameters as JSON
  kerf check <file.kerf>             run the program and print parts and warnings
  kerf fmt <files or folders>        format .kerf files in place
  kerf fmt --check <files>           list files that are not formatted; exit 1 if any
  kerf fmt -                         format standard input to standard output
  kerf import <file.svg> [-o out.kerf] turn an SVG drawing into a .kerf program,
                                     finding circles, tabs, finger joints, slots,
                                     hanger holes and keyholes; -o - prints it
      --dpi <n>                      px per inch for drawings measured in px
                                     (96; 72 for Adobe Illustrator files)
      --tolerance <mm>               how close a found shape must be (0.05)
      --pack                         merge identical parts into a quantity and
                                     pack them, instead of keeping the layout
      --kerf <mm>                    the kerf the drawing's outlines were offset
                                     for; 0 takes them as drawn (found if left out)
  kerf lsp [--timeout <s>]           run the language server for editors (stdio);
                                     stop checking a design after s seconds (10)

Shared libraries (kerf.json, kerf.lock and kerf_libraries/ in the project):
  kerf add <source>                  add a library and install it; the source is
                                     github:owner/repo@tag, an https:// link to a
                                     .tar.gz, or a folder like ./my-library
  kerf remove <name>                 remove a library
  kerf install [--frozen]            install the libraries kerf.lock pins;
                                     --frozen fails if kerf.lock would change
  kerf install --check               check kerf_libraries/ against kerf.lock
                                     without downloading; exit 1 on a difference
  kerf pack [folder] [-o file]       check a library and write name-version.tar.gz

Options:
  -o, --out <file>        output file (.svg, .dxf or .json); default <file>.svg
  -D name=value           set a parameter (value is KerfScript: 40, "Oak", true, [1,2])
  -p, --params <file>     JSON file of parameter values
  --font <file.ttf>       font for text(); repeat for more fonts (name = file name).
                          Built in: ${BUILTIN_FONT}
  --kerf <mm>             override kerf compensation for all parts
  --sheet <W>x<H>         sheet size for packing, in mm
  --gap <mm>              space between packed parts
  --margin <mm>           space between the parts and the sheet edge (default: gap)
  --no-pack               keep parts where the program placed them
  --guides                include guide layer geometry
  --split                 write one file per sheet (out-1.svg, out-2.svg, ...)
  -h, --help              show this help
  -v, --version           show the version
`;

function fail(msg: string): never {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

function parseValue(text: string): Value {
  const { program } = parse(`__v = ${text};`);
  const ev = new Evaluator();
  const res = ev.run(program);
  return res.globals.get('__v').value;
}

function main(argv: string[]) {
  if (!argv.length || argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes('-v') || argv.includes('--version')) {
    process.stdout.write(`${VERSION} (language ${LANGUAGE_VERSION})\n`);
    return;
  }
  const cmd = argv[0];
  if (cmd === 'fmt') return fmt(argv.slice(1));
  if (cmd === 'import') return importCommand(argv.slice(1));
  if (['install', 'add', 'remove', 'pack'].includes(cmd)) return libraries(cmd, argv.slice(1));
  // This file runs the server's programs too, in a worker thread
  if (cmd === 'lsp') {
    const i = argv.indexOf('--timeout');
    const timeout = i < 0 ? 10 : Number(argv[i + 1]);
    if (!(timeout > 0)) fail('--timeout needs a number of seconds');
    return startServer({ worker: fileURLToPath(import.meta.url), timeout: timeout * 1000 });
  }
  if (!['render', 'params', 'check'].includes(cmd))
    fail(`Unknown command "${cmd}". Run kerf --help.`);
  let file = '';
  let out = '';
  const params: Record<string, Value> = {};
  const fonts: Record<string, Uint8Array> = {};
  const opts: {
    kerf?: number;
    sheet?: [number, number];
    gap?: number;
    margin?: number;
    layout?: 'pack' | 'none';
    guides?: boolean;
  } = {};
  let split = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? fail(`${a} needs a value`);
    if (a === '-o' || a === '--out') out = next();
    else if (a === '-D' || a.startsWith('-D')) {
      const kv = a === '-D' ? next() : a.slice(2);
      const eq = kv.indexOf('=');
      if (eq < 1) fail(`-D needs name=value, got "${kv}"`);
      const raw = kv.slice(eq + 1);
      let v: Value;
      try {
        v = parseValue(raw);
      } catch {
        v = raw;
      }
      params[kv.slice(0, eq)] = v;
    } else if (a === '-p' || a === '--params')
      Object.assign(params, JSON.parse(readFileSync(next(), 'utf8')));
    else if (a === '--font') {
      const f = next();
      fonts[basename(f, extname(f))] = readFileSync(f);
    } else if (a === '--kerf') opts.kerf = Number(next());
    else if (a === '--sheet') {
      const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(next());
      if (!m) fail('--sheet needs WxH, like 600x400');
      opts.sheet = [Number(m[1]), Number(m[2])];
    } else if (a === '--gap') opts.gap = Number(next());
    else if (a === '--margin') opts.margin = Number(next());
    else if (a === '--no-pack') opts.layout = 'none';
    else if (a === '--guides') opts.guides = true;
    else if (a === '--split') split = true;
    else if (a.startsWith('-')) fail(`Unknown option ${a}`);
    else if (!file) file = a;
    else fail(`Unexpected argument ${a}`);
  }
  if (!file) fail('Give a .kerf file.');
  const source = readFileSync(file, 'utf8');
  const resolveLib = resolver(file);
  design = { source, file, resolve: resolveLib };

  if (cmd === 'params') {
    process.stdout.write(JSON.stringify(parameters(source), null, 2) + '\n');
    return;
  }
  // A project's kerf.json can give the laser's sheet for all its designs
  const project = findProject(dirname(resolve(file)));
  let defaultSheet: [number, number] | undefined;
  if (project) {
    try {
      defaultSheet = readManifest(project).sheet;
    } catch (e) {
      fail((e as Error).message);
    }
  }
  const result = render(source, {
    ...opts,
    ...(defaultSheet && { defaultSheet }),
    params,
    fonts: withBuiltinFont(fonts),
    resolve: resolveLib,
  });
  for (const e of result.echoes) process.stderr.write(`ECHO: ${e}\n`);
  for (const w of result.warnings) process.stderr.write(`WARNING: ${w}\n`);
  if (cmd === 'check') {
    for (const p of result.parts)
      process.stdout.write(
        `${p.name}${p.qty > 1 ? ` x${p.qty}` : ''}: ${p.width} x ${p.height} mm, ${p.thickness} mm ${p.material}, cut ${p.cutLength} mm${p.stack ? `, glued in stacks of ${p.stack}` : ''}\n`,
      );
    for (const h of hardwareList(result.hardware)) process.stdout.write(`${h}\n`);
    result.steps.forEach((s, i) => process.stdout.write(`step ${i + 1}: ${s}\n`));
    process.stdout.write(`${result.sheets.length} sheet${result.sheets.length === 1 ? '' : 's'}\n`);
    result.sheets.forEach((s, i) =>
      process.stdout.write(
        `  sheet ${i + 1}: ${s.width} x ${s.height} mm, ${s.thickness} mm ${s.material}, ${s.items.length} piece${s.items.length === 1 ? '' : 's'}\n`,
      ),
    );
    return;
  }
  const target = out || file.replace(/\.kerf$/i, '') + '.svg';
  const ext = extname(target).toLowerCase();
  const body = (s: (typeof result.sheets)[number]) => (ext === '.dxf' ? s.dxf : s.svg);
  if (ext === '.json') {
    writeFileSync(
      target,
      JSON.stringify(
        {
          parts: result.parts,
          hardware: result.hardware,
          steps: result.steps,
          warnings: result.warnings,
          echoes: result.echoes,
          sheets: result.sheets.map((s) => ({
            width: s.width,
            height: s.height,
            material: s.material,
            thickness: s.thickness,
          })),
        },
        null,
        2,
      ),
    );
  } else if (split && result.sheets.length > 1) {
    result.sheets.forEach((s, i) => {
      writeFileSync(target.replace(/(\.[^.]+)$/, `-${i + 1}$1`), body(s));
      if (s.back)
        writeFileSync(
          target.replace(/(\.[^.]+)$/, `-${i + 1}-back$1`),
          ext === '.dxf' ? s.back.dxf : s.back.svg,
        );
    });
  } else if (ext === '.dxf') {
    if (result.sheets.length > 1)
      process.stderr.write(
        'WARNING: DXF holds the first sheet only; use --split for all sheets.\n',
      );
    writeFileSync(target, result.sheets[0]?.dxf ?? '');
  } else {
    if (result.sheets.length > 1)
      process.stderr.write(
        `WARNING: ${result.sheets.length} sheets are stacked in one file for preview; use --split to write one file per sheet to cut.\n`,
      );
    writeFileSync(target, result.svg);
  }
  const backs = result.sheets.filter((s) => s.back).length;
  if (backs && !(split && result.sheets.length > 1) && ext !== '.json') {
    const first = result.sheets.find((s) => s.back)!;
    const backFile = target.replace(/(\.[^.]+)$/, '-back$1');
    writeFileSync(backFile, ext === '.dxf' ? first.back!.dxf : first.back!.svg);
    process.stderr.write(
      `Wrote ${backFile}: marks for the back faces. Turn the sheet over left to right and run it lined up on the same corner.${backs > 1 || result.sheets.length > 1 ? " Use --split for every sheet's back." : ''}\n`,
    );
  }
  process.stderr.write(`Wrote ${target}\n`);
}

// Hardware as a list to buy: alike pieces counted together
function hardwareList(
  items: { kind: string; from: number[]; to: number[]; size: number | number[]; label?: string }[],
): string[] {
  const counts = new Map<string, number>();
  for (const h of items) {
    const length = Math.round(Math.hypot(...h.to.map((v, i) => v - h.from[i])));
    const size = Array.isArray(h.size)
      ? h.size.map((v) => Math.round(v * 10) / 10).join(' x ')
      : Math.round(h.size * 10) / 10;
    const key = `${h.label ?? h.kind}: ${size} mm, ${length} mm long`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => `hardware ${n > 1 ? `${n} x ` : ''}${k}`);
}

function importCommand(argv: string[]) {
  let file = '';
  let out = '';
  const opts: { dpi?: number; tolerance?: number; pack?: boolean; kerf?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? fail(`${a} needs a value`);
    const positive = (v: string) => {
      const n = Number(v);
      if (!(n > 0)) fail(`${a} needs a number more than 0`);
      return n;
    };
    if (a === '-o' || a === '--out') out = next();
    else if (a === '--dpi') opts.dpi = positive(next());
    else if (a === '--tolerance') opts.tolerance = positive(next());
    else if (a === '--pack') opts.pack = true;
    else if (a === '--kerf') {
      opts.kerf = Number(next());
      if (!(opts.kerf >= 0 && opts.kerf < 5))
        fail('--kerf needs a width in mm, from 0 to less than 5');
    } else if (a.startsWith('-')) fail(`Unknown option ${a} for kerf import`);
    else if (!file) file = a;
    else fail(`Unexpected argument ${a}`);
  }
  if (!file) fail('Give an .svg file to import.');
  if (!existsSync(file)) fail(`No such file: ${file}`);
  // A program next to the drawing may have been edited since: it is only
  // replaced when named with -o
  const target = out || file.replace(/\.svg$/i, '') + '.kerf';
  if (!out && existsSync(target))
    fail(`${target} already exists. Give -o ${target} to replace it.`);
  let result;
  try {
    result = importSvg(readFileSync(file), { ...opts, name: basename(file) });
  } catch (e) {
    fail(`error: ${file}: ${(e as Error).message}`);
  }
  if (out === '-') {
    process.stdout.write(result.source);
    return;
  }
  writeFileSync(target, result.source);
  process.stderr.write(`Wrote ${target}: ${result.summary}\n`);
}

// .kerf files in the paths given, folders searched through. Installed
// libraries are left out: kerf.lock pins their files as they are.
function kerfFiles(paths: string[]): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) {
      for (const e of readdirSync(p, { withFileTypes: true }))
        if (e.name !== 'node_modules' && e.name !== FOLDER && !e.name.startsWith('.'))
          walk(join(p, e.name));
    } else if (p.endsWith('.kerf') || paths.includes(p)) out.push(p);
  };
  for (const p of paths) {
    if (!existsSync(p)) fail(`No such file or folder: ${p}`);
    walk(p);
  }
  return out;
}

function fmt(argv: string[]) {
  const check = argv.includes('--check');
  const paths = argv.filter((a) => a !== '--check');
  if (!paths.length) fail('Give .kerf files or folders to format, or - for standard input.');
  if (paths.includes('-')) {
    const source = readFileSync(0, 'utf8');
    try {
      process.stdout.write(format(source));
    } catch (e) {
      fail(formatError(e, source, { file: '<stdin>' }));
    }
    return;
  }
  let unformatted = 0;
  let failed = 0;
  for (const file of kerfFiles(paths)) {
    const source = readFileSync(file, 'utf8');
    let out: string;
    try {
      out = format(source);
    } catch (e) {
      process.stderr.write(formatError(e, source, { file }) + '\n');
      failed++;
      continue;
    }
    // Line endings alone do not count: git and editors change those
    if (out === source.replace(/\r\n/g, '\n')) continue;
    unformatted++;
    if (check) process.stdout.write(`${file}\n`);
    else {
      writeFileSync(file, out);
      process.stderr.write(`Formatted ${file}\n`);
    }
  }
  if (failed || (check && unformatted)) process.exit(1);
}

async function libraries(cmd: string, argv: string[]) {
  const log = (line: string) => process.stderr.write(line + '\n');
  const flags = argv.filter((a) => a.startsWith('-'));
  const args = argv.filter((a, i) => !a.startsWith('-') && !['-o', '--out'].includes(argv[i - 1]));
  const allowed: Record<string, string[]> = {
    install: ['--frozen', '--check'],
    add: [],
    remove: [],
    pack: ['-o', '--out'],
  };
  for (const f of flags) if (!allowed[cmd].includes(f)) fail(`Unknown option ${f} for kerf ${cmd}`);
  const project = () =>
    findProject(process.cwd()) ??
    fail('No kerf.json here or in the folders above. Run kerf add <source> to start one.');
  try {
    if (cmd === 'pack') {
      const o = argv.findIndex((a) => a === '-o' || a === '--out');
      const out = o < 0 ? undefined : (argv[o + 1] ?? fail(`${argv[o]} needs a file`));
      if (args.length > 1) fail(`Unexpected argument ${args[1]}`);
      const r = pack(resolve(args[0] ?? '.'), out && resolve(out));
      log(`Wrote ${r.file}: ${r.name} ${r.version}, ${r.files} files, ${r.integrity}`);
    } else if (cmd === 'add') {
      if (args.length !== 1)
        fail('Give one library source, like kerf add github:owner/repo@v1.0.0');
      const { name, lock } = await add(findProject(process.cwd()) ?? process.cwd(), args[0], {
        log,
      });
      const v = lock.libraries[name].version;
      log(`Added ${name}${v ? ' ' + v : ''}. Use it with use <${name}/...>`);
    } else if (cmd === 'remove') {
      if (args.length !== 1) fail('Give the name of the library to remove');
      await remove(project(), args[0], { log });
      log(`Removed ${args[0]} from kerf.json`);
    } else if (flags.includes('--check')) {
      if (args.length) fail(`Unexpected argument ${args[0]}`);
      const problems = checkLibraries(project());
      if (problems.length) fail(problems.join('\n'));
      log('The libraries match kerf.lock');
    } else {
      if (args.length)
        fail(`Unexpected argument ${args[0]}. To add a library, run kerf add ${args[0]}`);
      const lock = await install(project(), { frozen: flags.includes('--frozen'), log });
      const n = Object.keys(lock.libraries).length;
      log(`${n} librar${n === 1 ? 'y' : 'ies'} installed`);
    }
  } catch (e) {
    if (e instanceof LibraryError) fail(e.message);
    throw e;
  }
}

// The design being run, to show the lines an error is on
let design:
  | { source: string; file: string; resolve: (p: string) => string | undefined }
  | undefined;

if (!isMainThread) workerMain();
else
  try {
    main(process.argv.slice(2));
  } catch (e) {
    if (e instanceof KerfError) {
      for (const m of e.echoes) process.stderr.write(`ECHO: ${m}\n`);
      fail(
        design
          ? formatError(e, design.source, { file: design.file, resolve: design.resolve })
          : `error: ${e.message}`,
      );
    }
    throw e;
  }
