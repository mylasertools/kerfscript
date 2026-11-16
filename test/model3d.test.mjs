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
