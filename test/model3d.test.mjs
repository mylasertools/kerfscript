// 3D files of a model: triangulation, solid bodies, and the GLB, 3MF and
// STL writers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { meshBodies, render, to3mf, toGlb, toModel, toStl, triangulate } from '../dist/index.js';

const font = {
  fonts: { A: readFileSync('fonts/AtkinsonHyperlegible-Regular.ttf') },
  defaultFont: 'A',
};

const triArea = (pts, tris) =>
  tris.reduce(
    (a, [i, j, k]) =>
      a +
      ((pts[j][0] - pts[i][0]) * (pts[k][1] - pts[i][1]) -
        (pts[j][1] - pts[i][1]) * (pts[k][0] - pts[i][0])) /
        2,
    0,
  );
const square = (x, y, s) => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];

// Every edge of a closed surface is shared by two triangles that run along
// it in opposite directions
function openEdges(b) {
  const ids = new Map();
  const id = (i) => {
    const k = b.positions
      .slice(i * 3, i * 3 + 3)
      .map((v) => v.toFixed(5))
      .join();
    if (!ids.has(k)) ids.set(k, ids.size);
    return ids.get(k);
  };
  const edges = new Map();
  for (let i = 0; i < b.indices.length; i += 3) {
    const t = [b.indices[i], b.indices[i + 1], b.indices[i + 2]].map(id);
    for (let k = 0; k < 3; k++) {
      const e = `${t[k]}>${t[(k + 1) % 3]}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [e, n] of edges) {
    const [a, c] = e.split('>');
    if (n !== 1 || edges.get(`${c}>${a}`) !== 1) open++;
  }
  return open;
}

const box = (b) => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < b.positions.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], b.positions[i]);
    hi[i % 3] = Math.max(hi[i % 3], b.positions[i]);
  }
  return [lo, hi].map((v) => v.map((x) => Math.round(x * 1000) / 1000));
};

test('triangulate covers an outline less its holes, either way round', () => {
  const outer = square(0, 0, 10);
  const hole = square(3, 3, 4).reverse();
  assert.equal(triArea([...outer, ...hole], triangulate(outer, [hole])), 84);
  const u = [
    [0, 0],
    [30, 0],
    [30, 20],
    [20, 20],
    [20, 8],
    [10, 8],
    [10, 20],
    [0, 20],
  ];
  assert.equal(
    triArea(
      u,
      triangulate([...u].reverse()).map(([i, j, k]) => [7 - i, 7 - j, 7 - k]),
    ),
    480,
  );
  const holes = [square(2, 2, 4), square(24, 2, 4)];
  assert.equal(triArea([...u, ...holes.flat()], triangulate(u, holes)), 448);
});

test('each part is a closed solid of its thickness, its marks closed too', () => {
  const r = render(
    'part("sign") { rect([120, 50], r = 6); engrave() translate([60, 25]) text("Hello 8&g", fit = [100, 20], halign = "center", valign = "cap"); score() translate([20, 10]) circle(5); }\npart("ring", at = [0, 80, 0]) difference() { circle(30); circle(20); }',
    font,
  );
  const bodies = meshBodies(r, { layout: 'flat' });
  assert.deepEqual(bodies.map((b) => [b.name, b.kind]).sort(), [
    ['ring', 'part'],
    ['sign engrave', 'mark'],
    ['sign score', 'mark'],
    ['sign', 'part'],
  ]);
  for (const b of bodies) assert.equal(openEdges(b), 0, b.name);
  const named = (n) => bodies.find((b) => b.name === n);
  const [lo, hi] = box(named('sign'));
  assert.deepEqual([hi[0] - lo[0], hi[1] - lo[1], lo[2], hi[2]], [120, 50, 0, 3]);
  // The engraving stands 0.1 mm off the top face, overlapping it a hair
  const mark = box(named('sign engrave'));
  assert.deepEqual([mark[0][2], mark[1][2]], [2.99, 3.1]);
});

test('parts go where the assembly puts them, or lie flat side by side', () => {
  const src =
    '$thickness = 4;\npart("base", at = [0, 0, 0]) rect([100, 60]);\npart("back", at = [0, 60, 4], rotate = [90, 0, 0]) rect([100, 40]);';
  const [base, back] = meshBodies(render(src)).filter((b) => b.kind === 'part');
  assert.deepEqual(box(base), [
    [0, 0, 0],
    [100, 60, 4],
  ]);
  assert.deepEqual(box(back), [
    [0, 56, 4],
    [100, 60, 44],
  ]);
  const flat = meshBodies(render(src), { layout: 'flat' }).map(box);
  for (const [lo, hi] of flat) assert.deepEqual([lo[2], hi[2]], [0, 4]);
  const [a, b] = flat;
  assert.ok(a[1][1] <= b[0][1] || b[1][1] <= a[0][1] || a[1][0] <= b[0][0] || b[1][0] <= a[0][0]);
});

test('a cut inside a part goes through it; back-face marks stay off the bed when flat', () => {
  const r = render(
    'part("p", at = [0, 0, 0]) { rect([40, 20]); translate([10, 5]) line([0, 0], [0, 10]); engrave(side = "back") translate([20, 10]) circle(4); }',
  );
  const solid = meshBodies(r, { layout: 'flat' });
  assert.deepEqual(
    solid.map((b) => b.name),
    ['p'],
  );
  assert.equal(openEdges(solid[0]), 0);
  // The slit's walls add triangles to a plain box's 12
  assert.ok(solid[0].indices.length / 3 > 12);
  const assembled = meshBodies(r);
  assert.deepEqual(
    assembled.map((b) => b.name),
    ['p', 'p engrave-back'],
  );
  assert.ok(box(assembled[1])[0][2] < 0);
});

test('hardware becomes rods and balls in the assembled model', () => {
  const r = render(
    'part("p", at = [0, 0, 0]) rect(20);\nhardware("dowel", [10, 10, 0], [10, 10, 30], 4);\nhardware("steel", [0, 0, 40], [0, 0, 40], 6, sides = 0);',
  );
  const hw = meshBodies(r).filter((b) => b.kind === 'hardware');
  assert.deepEqual(
    hw.map((b) => b.name),
    ['dowel', 'steel'],
  );
  assert.deepEqual(box(hw[0])[1][2], 30);
  assert.ok(Math.abs(box(hw[1])[1][2] - 43) < 0.01);
  assert.equal(meshBodies(r, { layout: 'flat' }).filter((b) => b.kind === 'hardware').length, 0);
});

test('STL, 3MF and GLB files hold the bodies', () => {
  const r = render(
    'part("lid", qty = 2, at = [[0, 0, 0], [50, 0, 0]]) { rect([40, 30]); engrave() translate([5, 5]) rect([10, 4]); }',
  );
  const bodies = meshBodies(r);
  const tris = bodies.reduce((s, b) => s + b.indices.length / 3, 0);
  const stl = toStl(bodies);
  const v = new DataView(stl.buffer);
  assert.equal(v.getUint32(80, true), tris);
  assert.equal(stl.length, 84 + 50 * tris);

  const zip = Buffer.from(to3mf(bodies)).toString('latin1');
  for (const name of ['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model'])
    assert.ok(zip.includes(name));
  const model = zip.slice(zip.indexOf('<?xml', zip.indexOf('3D/3dmodel.model')));
  assert.match(model, /<model unit="millimeter"/);
  // The lid with its engraving is one object of two coloured parts
  assert.match(
    model,
    /<components><component objectid="\d+"\/><component objectid="\d+"\/><\/components>/,
  );
  assert.equal((model.match(/<item /g) ?? []).length, 2);
  assert.match(model, /<base name="engrave" displaycolor="#000000FF"\/>/);

  const glb = toGlb(bodies);
  const g = new DataView(glb.buffer, glb.byteOffset);
  assert.equal(g.getUint32(0, true), 0x46546c67);
  assert.equal(g.getUint32(8, true), glb.length);
  const jsonLength = g.getUint32(12, true);
  const json = JSON.parse(Buffer.from(glb.slice(20, 20 + jsonLength)).toString('utf8'));
  assert.deepEqual(
    json.nodes.map((n) => n.name),
    ['lid', 'lid engrave', 'lid (2)', 'lid engrave (2)'],
  );
  assert.deepEqual(json.nodes[2].extras, {
    kind: 'part',
    material: 'material',
    part: 'lid',
    copy: 2,
  });
  // Metres, y up: the lid is 40 x 30 mm on the ground, 3 mm tall
  const pos = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
  assert.deepEqual(
    pos.max.map((x, i) => Math.round((x - pos.min[i]) * 1e4) / 10),
    [40, 3, 30],
  );
  assert.equal(toModel(r, 'stl').length, stl.length);
});

test('kerf render writes a 3D file by its extension', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-3d-'));
  const src = join(dir, 'm.kerf');
  execFileSync('node', [
    '-e',
    `require('fs').writeFileSync(${JSON.stringify(src)}, 'part("a", at = [0, 0, 0]) rect(10);')`,
  ]);
  for (const ext of ['glb', '3mf', 'stl']) {
    const out = join(dir, `m.${ext}`);
    execFileSync(
      'node',
      ['dist/cli.js', 'render', src, '-o', out, '--flat', '--mark-height', '0.6'],
      {
        stdio: 'pipe',
      },
    );
    assert.ok(readFileSync(out).length > 80, ext);
  }
});

test('a rod in the 3D file fits the bore cut for it, square or many-sided', () => {
  for (const [size, sides, up] of [
    ['[2, 4]', 24, '[0, 1, 1]'],
    ['6', 6, '[0, 0, 1]'],
    ['5', 5, '[1, 1, 0]'],
  ]) {
    const r = render(
      `hardware("steel", [20, 20, -5], [20, 20, 10], ${size}, sides = ${sides}, up = ${up}, label = "pin");\npart("p", at = [0, 0, 0], bores = ["pin"], fit = 0) rect(40);`,
    );
    const rod = meshBodies(r).find((b) => b.kind === 'hardware');
    assert.ok(!rod.positions.some(Number.isNaN));
    // The hole in the part, and the rod's corners where it starts
    const hole = r.assembly[0].outline.find((ring) => ring.every(([x, y]) => x > 5 && y > 5));
    const corners = [];
    for (let i = 0; i < rod.positions.length; i += 3)
      if (Math.abs(rod.positions[i + 2] + 5) < 1e-6)
        corners.push([rod.positions[i], rod.positions[i + 1]]);
    for (const [x, y] of corners)
      assert.ok(
        hole.some(([hx, hy]) => Math.hypot(hx - x, hy - y) < 0.01),
        `${size}: rod corner [${x}, ${y}] is not on the bore`,
      );
  }
});

test('the print layout makes each part and what is glued on it one object', () => {
  const r = render(`
part("Base", rotate = [90, 0, 0], material = "white") { rect([60, 40]); engrave() translate([5, 5]) rect([50, 30]); }
part("Hill", glue = "Base", face = "top", at = [10, 0, 0], material = "green") { rect([40, 20]); engrave() translate([2, 2]) rect([36, 16]); }
part("House", glue = "Hill", face = "top", at = [5, 5, 0], material = "#cc3333 card") rect([10, 10]);
part("Back", glue = "Base", face = "bottom", material = "black") { rect([60, 10]); engrave(side = "back") rect([60, 10]); }
part("Post", stack = 3, at = [100, 0, 0]) { rect([10, 10]); engrave() translate([2, 2]) rect([6, 6]); }
`);
  assert.deepEqual(
    r.assembly.map((a) => [a.name, a.glued]),
    [
      ['Base', undefined],
      ['Hill', 0],
      ['House', 1],
      ['Back', 0],
      ['Post', undefined],
      ['Post', 4],
      ['Post', 4],
    ],
  );
  const bodies = meshBodies(r, { layout: 'print', markHeight: 0.6 });
  for (const b of bodies) assert.equal(openEdges(b), 0, b.name);
  const z = (name, kind = 'part') =>
    bodies.filter((b) => b.name === name && b.kind === kind).map((b) => box(b).map((v) => v[2]));
  // The upright standee lies on its lowest layer, each layer on the one under it
  assert.deepEqual(z('Back'), [[0, 3]]);
  assert.deepEqual(z('Base'), [[3, 6]]);
  assert.deepEqual(z('Hill'), [[6, 9]]);
  assert.deepEqual(z('House'), [[9, 12]]);
  assert.deepEqual(z('Post'), [
    [0, 3],
    [3, 6],
    [6, 9],
  ]);
  // One object per stack, each layer in its material's colour
  assert.deepEqual(
    [...new Set(bodies.map((b) => b.instance))].map((i) =>
      bodies.filter((b) => b.instance === i && b.kind === 'part').map((b) => b.name),
    ),
    [
      ['Base', 'Hill', 'House', 'Back'],
      ['Post', 'Post', 'Post'],
    ],
  );
  assert.deepEqual(
    ['Base', 'Hill', 'House', 'Back'].map((n) => bodies.find((b) => b.name === n).color),
    ['#f1f1ee', '#4f8a4b', '#cc3333', '#2b2b2b'],
  );
  // Marks show only where nothing covers them: none on the bed, none under
  // a layer, the post's only on top
  assert.equal(bodies.filter((b) => b.name === 'Back engrave').length, 0);
  assert.deepEqual(z('Post engrave', 'mark'), [[8.99, 9.6]]);
  const area = (b) => {
    let a = 0;
    const p = b.positions;
    for (let i = 0; i < b.indices.length; i += 3) {
      const [u, v, w] = [b.indices[i], b.indices[i + 1], b.indices[i + 2]];
      if (Math.abs(p[u * 3 + 2] - box(b)[1][2]) > 1e-6) continue;
      if (
        Math.abs(p[v * 3 + 2] - p[u * 3 + 2]) > 1e-6 ||
        Math.abs(p[w * 3 + 2] - p[u * 3 + 2]) > 1e-6
      )
        continue;
      a +=
        ((p[v * 3] - p[u * 3]) * (p[w * 3 + 1] - p[u * 3 + 1]) -
          (p[v * 3 + 1] - p[u * 3 + 1]) * (p[w * 3] - p[u * 3])) /
        2;
    }
    return Math.round(a);
  };
  // The base's 50 x 30 engraving less the hill's 40 x 20 footprint over it
  // (y 0..20 of the part, the engraving's y 5..20 under it)
  assert.equal(area(bodies.find((b) => b.name === 'Base engrave')), 50 * 30 - 40 * 15);
  // the hill's 36 x 16 less the house's 10 x 10
  assert.equal(area(bodies.find((b) => b.name === 'Hill engrave')), 36 * 16 - 100);

  const zip = Buffer.from(toModel(r, '3mf', { layout: 'print' })).toString('latin1');
  const model = zip.slice(zip.indexOf('<?xml', zip.indexOf('3D/3dmodel.model')));
  assert.equal((model.match(/<item /g) ?? []).length, 2);
});

test('the print layout lays a bent part apart from its stack, and a model with nothing placed flat', () => {
  const bent = render(`
part("strip", at = [0, 0, 0], bend = [20, 30, 90]) rect([60, 20]);
part("badge", glue = "strip", at = [2, 2, 0]) rect([10, 10]);
`);
  const bodies = meshBodies(bent, { layout: 'print' });
  assert.equal(new Set(bodies.map((b) => b.instance)).size, 2);
  for (const b of bodies) assert.equal(box(b)[0][2], 0, b.name);
  const loose = render('part("a") rect(10); part("b") rect(20);');
  assert.deepEqual(
    meshBodies(loose, { layout: 'print' }).map(box),
    meshBodies(loose, { layout: 'flat' }).map(box),
  );
});

test('kerf render --print lays glued stacks out as one object each', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-print-'));
  const src = join(dir, 'm.kerf');
  execFileSync('node', [
    '-e',
    `require('fs').writeFileSync(${JSON.stringify(src)}, 'part("a", rotate = [90, 0, 0]) rect(20); part("b", glue = "a", at = [5, 5, 0]) rect(5);')`,
  ]);
  const out = join(dir, 'm.3mf');
  execFileSync('node', ['dist/cli.js', 'render', src, '-o', out, '--print'], { stdio: 'pipe' });
  const zip = readFileSync(out).toString('latin1');
  const model = zip.slice(zip.indexOf('<?xml', zip.indexOf('3D/3dmodel.model')));
  assert.equal((model.match(/<item /g) ?? []).length, 1);
});
