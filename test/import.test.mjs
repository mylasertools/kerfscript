// kerf import: SVG drawings become programs that cut the same, with the
// shapes found in them written as the modules that make them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importSvg, render } from '../dist/index.js';

const font = { fonts: { Atkinson: readFileSync('fonts/AtkinsonHyperlegible-Regular.ttf') } };

// Parts by name: size and cut length, which an import must keep
function parts(result) {
  return Object.fromEntries(result.parts.map((p) => [p.name, [p.width, p.height, p.cutLength]]));
}

function sameParts(a, b) {
  const pa = parts(a),
    pb = parts(b);
  assert.deepEqual(Object.keys(pb).sort(), Object.keys(pa).sort());
  for (const [name, [w, h, cut]] of Object.entries(pa)) {
    const [w2, h2, cut2] = pb[name];
    assert.ok(
      Math.abs(w - w2) <= 0.02 && Math.abs(h - h2) <= 0.02,
      `${name}: ${w} x ${h}, got ${w2} x ${h2}`,
    );
    assert.ok(Math.abs(cut - cut2) <= 1, `${name}: cut ${cut} mm, got ${cut2} mm`);
  }
}

// Renders a design, imports its SVG and checks the import cuts the same
function roundTrip(source, options = {}) {
  const before = render(source, { ...font, layout: 'none' });
  const imported = importSvg(before.svg, options);
  const after = render(imported.source, { ...font, layout: 'none' });
  sameParts(before, after);
  return imported;
}

test('finds circles, hanger holes, keyholes, tabs, slots and finger joints', () => {
  const { source, found } = roundTrip(`
use <kerf/tabs>
use <kerf/hanging>
$layout = "none";
part("sign") difference() {
  rect([120, 80], r = 5);
  hanging_hole([60, 70]);
  translate([20, 20]) circle(d = 8);
  for (x = [30:10:90]) translate([x, 40]) circle(d = 3);
}
translate([150, 0]) part("shelf") tab_rect([100, 50], [true, false, true, false]);
translate([0, -120]) part("base") difference() {
  rect([140, 90]);
  translate([20, 20]) slots(100);
}
translate([160, -120]) part("side") finger_rect([80, 60], ["out", "in", "flat", "in"]);
translate([280, -120]) part("plaque") difference() {
  rect([60, 90]);
  keyhole([30, 75]);
  translate([30, 30]) regular_polygon(6, 10);
}
translate([360, -100]) part("coaster") difference() { circle(d = 90); hanging_hole([0, 38], d = 4); }
`);
  for (const code of [
    'rect([120, 80], r = 5)',
    'hanging_hole([60, 70])',
    'for (x = [30:10:90]) translate([x, 40]) circle(d = 3)',
    'tab_rect([100, 50], [true, false, true, false])',
    'translate([20, 20]) slots(100)',
    'finger_rect([80, 60], ["out", "in", "flat", "in"])',
    'translate([30, 75]) keyhole()',
    'regular_polygon(6, 10)',
    'circle(d = 90)',
    'hanging_hole([0, 38], d = 4)',
    'use <kerf/hanging>',
    'use <kerf/tabs>',
    '$thickness = 3;',
  ])
    assert.ok(source.includes(code), `missing ${code} in\n${source}`);
  assert.equal(found['hanger hole'], 2);
  assert.equal(found.keyhole, 1);
});

test('reads an Inkscape drawing: units, groups, transforms, use, text and score lines', () => {
  const svg = `<svg width="300mm" height="200mm" viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg"
  xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">
  <defs><circle id="peg" r="2"/></defs>
  <g inkscape:label="Layer 1" inkscape:groupmode="layer">
    <g id="ornament" transform="translate(40,60)">
      <circle cx="0" cy="0" r="30" style="fill:none;stroke:#ff0000"/>
      <circle cx="0" cy="-25" r="2.5" style="fill:none;stroke:#ff0000"/>
      <text x="0" y="5" style="font-size:8px;text-anchor:middle;fill:#000">Noel</text>
      <path d="M -15,10 L 15,10" style="fill:none;stroke:#0000ff"/>
    </g>
    <g transform="rotate(30 60 160)">
      <rect id="label" x="20" y="140" width="80" height="40" style="fill:none;stroke:#ff0000"/>
    </g>
    <rect id="tag" x="150" y="120" width="80" height="50" style="fill:none;stroke:#ff0000"/>
    <use href="#peg" x="200" y="145" style="fill:none;stroke:#ff0000"/>
    <use href="#peg" x="210" y="145" style="fill:none;stroke:#ff0000"/>
    <use href="#peg" x="220" y="145" style="fill:none;stroke:#ff0000"/>
    <rect x="0" y="0" width="5" height="5" style="display:none;stroke:#ff0000"/>
  </g>
</svg>`;
  const { source, parts: n, notes } = importSvg(svg);
  assert.equal(n, 3);
  for (const code of [
    'part("ornament")',
    'circle(d = 60)',
    'hanging_hole([0, 25])',
    'score() line([-15, -10], [15, -10])',
    'text("Noel", size = 8, halign = "center")',
    'rotate(-30) rect([80, 40])',
    'for (x = [50:10:70]) translate([x, 25]) circle(d = 4)',
  ])
    assert.ok(source.includes(code), `missing ${code} in\n${source}`);
  assert.ok(notes.some((n) => /hidden/.test(n)));
  assert.ok(render(source, font).parts.length === 3);
});

test('reads an Illustrator drawing: px at 72 per inch, classes, and loose lines', () => {
  const k = 72 / 25.4;
  const P = (x, y) => `${(x * k).toFixed(3)} ${((200 - y) * k).toFixed(3)}`;
  // A 100 x 50 panel with two tabs on the bottom and top, as separate lines
  const pts = [[20, 20]];
  for (const c of [45, 95])
    pts.push([c - 12.5, 20], [c - 12.5, 17], [c + 12.5, 17], [c + 12.5, 20]);
  pts.push([120, 20], [120, 70]);
  for (const c of [95, 45])
    pts.push([c + 12.5, 70], [c + 12.5, 73], [c - 12.5, 73], [c - 12.5, 70]);
  pts.push([20, 70]);
  const lines = pts
    .map((p, i) => {
      const [a, b] = [P(...p).split(' '), P(...pts[(i + 1) % pts.length]).split(' ')];
      return `<line class="st0" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
    })
    .join('\n');
  const svg = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [
  <!ENTITY ns_svg "http://www.w3.org/2000/svg">
]>
<svg version="1.1" id="Layer_1" xmlns="&ns_svg;" x="0px" y="0px" viewBox="0 0 ${(300 * k).toFixed(3)} ${(200 * k).toFixed(3)}">
<style type="text/css">.st0{fill:none;stroke:#000000;stroke-width:0.25;}</style>
<g id="Panel">${lines}</g>
</svg>`;
  const { source, notes } = importSvg(svg);
  assert.ok(source.includes('tab_rect([100, 50], [true, false, true, false])'), source);
  assert.ok(source.includes('part("Panel")'), source);
  assert.ok(notes.some((n) => /72 per inch/.test(n)));
  assert.ok(notes.some((n) => /#000000 lines/.test(n)));
});

test('writes finger joints from other programs as notches, in loops', () => {
  const { source } = roundTrip(`
$layout = "none";
part("front") difference() {
  rect([100, 60]);
  for (x = [0:20:80]) translate([x, -1]) rect([10, 4]);
  for (x = [0:20:80]) translate([x, 57]) rect([10, 4]);
  for (y = [10:20:50]) translate([-1, y]) rect([4, 10]);
  for (y = [10:20:50]) translate([97, y]) rect([4, 10]);
}
translate([120, 0]) rotate(30) part("tilted") difference() {
  rect([80, 50]);
  translate([40, 25]) circle(d = 10);
  for (x = [10:20:70]) translate([x, -1]) rect([10, 4]);
}
`);
  assert.ok(source.includes('for (x = [0:20:80]) translate([x, -1]) rect([10, 4])'), source);
  assert.ok(source.includes('for (y = [10:20:50]) translate([-1, y]) rect([4, 10])'), source);
  assert.ok(source.includes('rotate(30) difference()'), source);
});

test('takes the kerf out of compensated outlines and sets $kerf', () => {
  const design = `$kerf = 0.2;\n$layout = "none";\npart("side") finger_rect([80, 60], "out");\ntranslate([100, 0]) part("disc") difference() { rect([40, 40]); translate([20, 20]) circle(d = 10); }\n`;
  const { source } = roundTrip(design);
  assert.ok(source.includes('$kerf = 0.2;'), source);
  assert.ok(source.includes('finger_rect([80, 60], "out")'), source);
  assert.ok(source.includes('circle(d = 10)'), source);
  // Told there is no kerf, it keeps the outlines as drawn
  const plain = importSvg(render(design).svg, { kerf: 0 }).source;
  assert.ok(!plain.includes('$kerf'), plain);
});

test('cuts out filled shapes when a drawing has no strokes', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">
<circle cx="50" cy="50" r="40" fill="#000"/><circle cx="50" cy="20" r="3" fill="#fff"/></svg>`;
  const { source, notes } = importSvg(svg);
  assert.ok(notes.some((n) => /no strokes/.test(n)));
  assert.ok(source.includes('circle(d = 80)'), source);
});

test('keeps shapes it does not recognise as drawn, and cut lines once', () => {
  const { source } = roundTrip(`
$layout = "none";
part("leaf") {
  path("M0 0 C 20 40 60 40 80 0 C 60 -20 20 -20 0 0 Z");
  line([10, 0], [70, 0]);
}
`);
  // KerfScript's own files hold the curve as straight segments
  assert.ok(source.includes('polygon([['), source);
  assert.equal(source.match(/line\(/g)?.length, 1, source);
});

test('--pack makes identical parts a quantity', () => {
  const svg = render(
    `$layout = "none";\nfor (x = [0, 50, 100]) translate([x, 0]) part("leg") rect([40, 20]);\n`,
  ).svg;
  const { source } = importSvg(svg, { pack: true });
  assert.ok(source.includes('part("leg", qty = 3)'), source);
  assert.ok(!source.includes('$layout'), source);
  assert.equal(render(source).parts[0].qty, 3);
});

test('rejects files that are not SVG', () => {
  assert.throws(() => importSvg('<html><body/></html>'), /not an SVG/);
  assert.throws(() => importSvg('<svg><g></svg>'), /does not match/);
});

test('reads the bytes of a file, in UTF-8 or UTF-16', () => {
  const text =
    '<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40"><circle cx="20" cy="20" r="5" fill="none" stroke="red"/></svg>';
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const be = Buffer.from(le).swap16();
  const expected = importSvg(text).source;
  for (const bytes of [
    new TextEncoder().encode(text),
    le,
    be,
    le.buffer.slice(le.byteOffset, le.byteOffset + le.length),
  ])
    assert.equal(importSvg(bytes).source, expected);
});

test('kerf import writes a .kerf file next to the drawing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerfscript-import-'));
  const file = join(dir, 'tag.svg');
  writeFileSync(
    file,
    `<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40">
<rect x="0" y="0" width="60" height="40" fill="none" stroke="red"/>
<circle cx="30" cy="8" r="2.5" fill="none" stroke="red"/></svg>`,
  );
  const run = (...args) =>
    spawnSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8' });
  const r = run('import', file);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /Wrote .*tag\.kerf: 1 part; found 1 rectangle, 1 hanger hole/);
  assert.match(readFileSync(join(dir, 'tag.kerf'), 'utf8'), /hanging_hole\(\[30, 32\]\)/);
  const out = run('import', file, '-o', '-');
  assert.match(out.stdout, /^\/\/ tag\.svg: imported/);
  // A program already there may have been edited: it is replaced only by name
  writeFileSync(join(dir, 'tag.kerf'), '// edited\n');
  const again = run('import', file);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /already exists/);
  assert.equal(readFileSync(join(dir, 'tag.kerf'), 'utf8'), '// edited\n');
  assert.equal(run('import', file, '-o', join(dir, 'tag.kerf')).status, 0);
  assert.match(readFileSync(join(dir, 'tag.kerf'), 'utf8'), /hanging_hole/);
  assert.match(run('import', file, '--kerf', '5').stderr, /less than 5/);
  assert.notEqual(run('import', join(dir, 'missing.svg')).status, 0);
  assert.notEqual(run('import', file, '--dpi', 'x').status, 0);
  // Written as UTF-16, as some programs do
  const wide = join(dir, 'wide.svg');
  const text = readFileSync(file, 'utf8');
  writeFileSync(wide, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
  const r16 = run('import', wide, '-o', '-');
  assert.equal(r16.status, 0, r16.stderr);
  assert.match(r16.stdout, /hanging_hole\(\[30, 32\]\)/);
});

// The cut of a drawing in mm, imported and rendered in place
const cutLength = (svg, options) =>
  render(importSvg(svg, options).source, { ...font, layout: 'none' }).parts.reduce(
    (s, p) => s + p.cutLength * p.qty,
    0,
  );
const drawing = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="200mm" viewBox="0 0 200 200">${body}</svg>`;

test('keeps every cut: lines drawn out and back, closed paths with no area, holes that overlap', () => {
  // A 50 x 30 outline with a 20 mm line up into it and back, drawn as part
  // of the outline; a line drawn as a closed path; two holes that overlap
  const svg = drawing(`
<path d="M0 0 H50 V30 H25 V10 V30 H0 Z" fill="none" stroke="red"/>
<path d="M60 0 L80 0 Z" fill="none" stroke="red"/>
<rect x="100" y="100" width="100" height="60" fill="none" stroke="red"/>
<circle cx="140" cy="130" r="10" fill="none" stroke="red"/>
<circle cx="150" cy="130" r="10" fill="none" stroke="red"/>`);
  const want = 160 + 40 + 40 + 320 + 2 * 2 * Math.PI * 10;
  assert.ok(Math.abs(cutLength(svg) - want) <= 2, `cut ${cutLength(svg)}, drawn ${want}`);
});

test('a line that leaves its part is kept whole', () => {
  const svg = drawing(`<rect x="0" y="0" width="50" height="50" fill="none" stroke="red"/>
<line x1="25" y1="25" x2="80" y2="25" stroke="red"/>`);
  assert.ok(Math.abs(cutLength(svg) - 255) <= 1, `cut ${cutLength(svg)}`);
});

test('filled shapes on top of each other are each a piece', () => {
  const { parts: n } = importSvg(
    drawing(`<rect x="0" y="0" width="100" height="100" fill="#000"/>
<rect x="40" y="40" width="20" height="20" fill="#c00"/>`),
  );
  assert.equal(n, 2);
});

test('finds finger joints in a panel cut for a wide kerf', () => {
  const { source } = roundTrip(
    `$thickness = 6; $kerf = 0.3; $layout = "none";\npart("side") finger_rect([180, 120], ["in", "in", "flat", "in"]);`,
  );
  assert.ok(source.includes('finger_rect([180, 120], ["in", "in", "flat", "in"])'), source);
  assert.ok(source.includes('$kerf = 0.3;'), source);
});

test('holes in a grid are not hanger holes', () => {
  const { source } = roundTrip(
    `$layout = "none";\npart("floor") difference() { rect([100, 100]); for (x = [25, 75], y = [70, 90]) translate([x, y]) circle(d = 5); }`,
  );
  assert.ok(!source.includes('hanging_hole'), source);
  assert.ok(source.includes('for (x = [25:50:75], y = [70:20:90])'), source);
});

test('keeps positions far from the origin exact', () => {
  const { source } = importSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="10000mm" height="10000mm" viewBox="0 0 10000 10000">
<line x1="7545.236" y1="100" x2="7545.236" y2="140" stroke="red"/></svg>`,
  );
  assert.ok(source.includes('7545.236'), source);
});

test('reads broken drawings as far as browsers do', () => {
  const box = '<rect x="10" y="10" width="40" height="30" fill="none" stroke="red"/>';
  const imported = (body) => importSvg(drawing(box + body));
  const ok = (r) => {
    assert.ok(!/NaN|Infinity/.test(r.source), r.source);
    render(r.source, font);
  };
  const noted = (r, re) =>
    assert.ok(
      r.notes.some((n) => re.test(n)),
      r.notes.join('\n'),
    );
  // Bad path data: the path up to the error
  let r = imported(
    '<path d="M60 10 L90 10 L90 40 L60 40 Z M100 10 L x" fill="none" stroke="red"/>',
  );
  ok(r);
  assert.equal(r.parts, 2);
  noted(r, /1 path has bad data/);
  // Numbers too large to draw
  r = imported(
    '<g transform="scale(1e309)"><rect width="5" height="5" stroke="red"/></g>' +
      '<circle cx="1e400" cy="5" r="2" stroke="red"/><path d="M0 0L1e999 0" stroke="red"/>',
  );
  ok(r);
  assert.equal(r.parts, 1);
  noted(r, /3 elements were left out/);
  // A group that uses itself is drawn once
  r = importSvg(drawing(`<g id="a">${box}<use href="#a" x="50"/></g><use id="u" href="#u"/>`));
  ok(r);
  assert.equal(r.parts, 1);
  // Groups repeated inside each other stop at a limit
  let defs = '<g id="l0"/>';
  for (let i = 1; i <= 8; i++) defs += `<g id="l${i}">${`<use href="#l${i - 1}"/>`.repeat(10)}</g>`;
  r = importSvg(drawing(`<defs>${defs}</defs>${box}<use href="#l8"/>`));
  noted(r, /more than 20,000 times/);
});
