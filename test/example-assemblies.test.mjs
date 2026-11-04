import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render as renderSource, parameters } from '../dist/index.js';

// Hardware as [from, to, size, kind, sides], from hardware() or from the
// older echo("hardware", ...) convention
const hardwareOf = (r) => [
  ...r.echoes
    .filter((s) => s.startsWith('hardware, '))
    .flatMap((s) => JSON.parse(s.slice('hardware, '.length))),
  ...r.hardware.map((h) => [h.from, h.to, h.size, h.kind, h.sides]),
];

const fonts = {
  atkinson: readFileSync(new URL('../fonts/AtkinsonHyperlegible-Regular.ttf', import.meta.url)),
};
const render = (source, options = {}) => renderSource(source, { fonts, ...options });

const models = JSON.parse(readFileSync(new URL('./fixtures/assemblies.json', import.meta.url)));
for (const model of models) {
  const source = readFileSync(new URL(`../examples/${model.file}.kerf`, import.meta.url), 'utf8');
  test(`${model.file}: complete connected parts, default and two changed assemblies`, () => {
    for (const params of [{}, ...model.variants]) {
      const r = render(source, { params });
      assert.deepEqual(r.warnings, [], JSON.stringify(params));
      assert.ok(r.parts.length > 0);
      assert.equal(
        r.assembly.length,
        r.parts.reduce((n, p) => n + p.qty, 0),
      );
      assert.ok(
        r.assembly.every((p) => p.placed && p.outline.length && p.matrix.every(Number.isFinite)),
      );
      assert.ok(r.parts.every((p) => p.width > 0 && p.height > 0 && p.thickness > 0));
      assert.ok(r.sheets.every((s) => s.svg.includes('<svg') && s.dxf.includes('ENTITIES')));
    }
    const names = parameters(source).parameters.map((p) => p.name);
    assert.ok(names.includes('$thickness'));
    assert.ok(names.includes('$kerf'));
    assert.ok(names.length >= 5);
  });
}

test('coupled dimensions reject missing webs and unusable clearances', () => {
  for (const [slug, params] of [
    ['paint-deck', { pitch: 25, diameter: 35 }],
    ['earring-screen', { width: 120, pairs: 8, pair_spacing: 12 }],
    ['stem-lab', { tube_diameter: 30, pitch: 24 }],
    ['jewel-tray-box', { width: 100, columns: 7 }],
    ['drawer-stack', { drawer_height: 25, $thickness: 6 }],
    ['loom-card', { pitch: 4, notch_width: 3 }],
    ['ribbed-lantern', { diameter: 140, collar_diameter: 110 }],
    ['game-insert', { box_width: 180, deck_count: 5 }],
    ['cable-chain', { link_height: 40, pitch: 32 }],
    ['cantilever-case', { tray_height: 25, $thickness: 6 }],
    ['beam-balance', { pivot_height: 125, drop: 130 }],
    ['sector-stand', { radius: 100, depth: 110 }],
    ['sector-stand', { angle: 0 }],
    ['screw-press', { opening: 90, rod_height: 90 }],
    ['wheel-calendar', { day_radius: 40 }],
    ['slat-roll', { gap: 1, slats: 12, $thickness: 6 }],
    ['slat-roll', { curl: 1.2 }],
    ['slide-grid', { tile_slide: 1.2 }],
    ['drawer-stack', { extension: 1 }],
  ]) {
    assert.throws(
      () =>
        render(readFileSync(new URL(`../examples/${slug}.kerf`, import.meta.url), 'utf8'), {
          params,
        }),
      /./,
    );
  }
});

const sourceOf = (slug) =>
  readFileSync(new URL(`../examples/${slug}.kerf`, import.meta.url), 'utf8');
const point = (p, x, y = 0, z = 0) =>
  [0, 1, 2].map(
    (i) =>
      p.matrix[4 * i] * x + p.matrix[4 * i + 1] * y + p.matrix[4 * i + 2] * z + p.matrix[4 * i + 3],
  );
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 0.001, `${a} != ${b}`));

test('every operating motion preserves cut geometry at three configurations and returns to its start', () => {
  for (const model of models.filter((m) => m.poses)) {
    const source = sourceOf(model.file);
    const geometry = (r) =>
      r.parts.map((p) => [p.name, p.qty, p.width, p.height, p.cutLength, p.thickness]);
    for (const settings of [{}, ...model.variants]) {
      const initial = render(source, {
        params: { ...settings, ...model.poses[0] },
      });
      for (const [index, params] of model.poses.slice(1).entries()) {
        const r = render(source, { params: { ...settings, ...params } });
        assert.deepEqual(r.warnings, [], `${model.file} pose ${index + 1}`);
        assert.deepEqual(
          geometry(r),
          geometry(initial),
          `${model.file}: motion altered a cut part`,
        );
        assert.equal(hardwareOf(r).length, hardwareOf(initial).length);
        if (index === model.poses.length - 2)
          r.assembly.forEach((p, i) => near(p.matrix, initial.assembly[i].matrix));
      }
    }
  }
});

test('balance pans stay level and all suspension cords have equal fixed lengths', () => {
  for (const tilt of [-12, -6, 0, 6, 12]) {
    const r = render(sourceOf('beam-balance'), { params: { tilt } });
    const cords = hardwareOf(r).filter((p) => p[3] === 'cord');
    const lengths = cords.map(([a, b]) => Math.hypot(...a.map((v, i) => v - b[i])));
    assert.equal(cords.length, 6);
    near(lengths, Array(6).fill(lengths[0]));
    for (const side of ['Left', 'Right']) {
      const p = r.assembly.find((p) => p.name === `${side} pan floor`);
      near(p.matrix.slice(0, 3), [1, 0, 0]);
      near(p.matrix.slice(4, 7), [0, 1, 0]);
      assert.ok(point(p, 0)[2] > 2 * p.thickness + 10);
    }
  }
});

function insideSolid(rings, x, y) {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
        inside = !inside;
    }
  return inside;
}

test('sector clamp bolts clear the entire curved slot, including both end caps', () => {
  for (const angle of [10, 25, 45, 65]) {
    const r = render(sourceOf('sector-stand'), { params: { angle } });
    const wall = r.assembly.find((p) => p.name === 'Left fixed sector');
    const flange = r.assembly.find((p) => p.name === 'Left moving flange');
    const p = point(flange, 78);
    near(
      [p[1], p[2]],
      [25 + 78 * Math.cos((angle * Math.PI) / 180), 65 + 78 * Math.sin((angle * Math.PI) / 180)],
    );
    for (let phi = 0; phi < 360; phi += 15) {
      const x = p[1] + 2 * Math.cos((phi * Math.PI) / 180);
      const y = p[2] - 3 + 2 * Math.sin((phi * Math.PI) / 180);
      assert.equal(insideSolid(wall.outline, x, y), false, `${angle}: bolt hits the sector`);
    }
  }
});

test('press knob rotation follows thread lead and nut pockets fit the measured flats and height', () => {
  const model = models.find((m) => m.file === 'screw-press');
  for (const settings of [{}, ...model.variants]) {
    const t = settings.$thickness ?? 3,
      pitch = settings.thread_pitch ?? 1;
    const a = render(sourceOf(model.file), { params: { ...settings, opening: 40 } });
    const b = render(sourceOf(model.file), { params: { ...settings, opening: 40.125 } });
    const pa = a.assembly.find((p) => p.name === 'Knob 1 cover' && p.copy === 1);
    const pb = b.assembly.find((p) => p.name === 'Knob 1 cover' && p.copy === 1);
    assert.ok(Math.abs(pb.matrix[11] - pa.matrix[11] - 0.125) < 0.0001);
    const turn = Math.atan2(
      pa.matrix[0] * pb.matrix[4] - pa.matrix[4] * pb.matrix[0],
      pa.matrix[0] * pb.matrix[0] + pa.matrix[4] * pb.matrix[4],
    );
    assert.ok(Math.abs(turn + (2 * Math.PI * 0.125) / pitch) < 0.0001);
    const pocket = a.parts.find((p) => p.name === 'Knob 1 nut pocket');
    assert.ok(pocket.qty * t >= (settings.nut_height ?? 5));
    const hole = a.assembly.find((p) => p.name === pocket.name).outline[1];
    const ys = hole.map((v) => v[1]);
    assert.ok(
      Math.abs(Math.max(...ys) - Math.min(...ys) - (settings.nut_flats ?? 10) - 0.25) < 0.001,
    );
  }
});

test('calendar selected values meet their fixed top pointers and each axle remains stationary', () => {
  for (const settings of [
    { day: 1, month: 1, weekday: 1 },
    { day: 17, month: 11, weekday: 4 },
    { day: 31, month: 12, weekday: 7 },
  ]) {
    const r = render(sourceOf('wheel-calendar'), { params: settings });
    const hardware = hardwareOf(r);
    for (const [i, name, radius, count, value] of [
      [0, 'DAY', 75, 31, settings.day],
      [1, 'MONTH', 48, 12, settings.month],
      [2, 'WEEK', 40, 7, settings.weekday],
    ]) {
      const p = r.assembly.find((p) => p.name === name + ' wheel');
      const a = ((90 - ((value - 1) * 360) / count) * Math.PI) / 180;
      const label = point(p, (radius - 8) * Math.cos(a), (radius - 8) * Math.sin(a));
      near([label[0], label[2]], [p.matrix[3], p.matrix[11] + radius - 8]);
      near([hardware[i][0][0], hardware[i][0][2]], [p.matrix[3], p.matrix[11]]);
    }
  }
});

test('puzzle animation slides just one tile into the adjacent blank without moving its retainer', () => {
  const a = render(sourceOf('slide-grid'), { params: { tile_slide: 0 } });
  const b = render(sourceOf('slide-grid'), { params: { tile_slide: 1 } });
  const moved = b.assembly.filter((p, i) =>
    p.matrix.some((v, k) => Math.abs(v - a.assembly[i].matrix[k]) > 0.001),
  );
  assert.equal(moved.length, 1);
  assert.ok(moved[0].name.startsWith('Tile '));
  const before = a.assembly.find((p) => p.name === moved[0].name);
  assert.ok(
    Math.abs(
      Math.hypot(moved[0].matrix[3] - before.matrix[3], moved[0].matrix[7] - before.matrix[7]) -
        30.4,
    ) < 0.001,
  );
  assert.deepEqual(b.warnings, []);
});

test('lantern collars have open entry notches for radial fin assembly', () => {
  const r = render(sourceOf('ribbed-lantern'));
  const collars = r.assembly.filter((p) => p.name === 'Collar ring');
  assert.equal(collars.length, 2);
  // One connected outer contour with entry notches and one central opening.
  // A closed slot for every fin would trap the integral tabs during assembly.
  for (const p of collars) assert.equal(p.outline.length, 2);
});

test('puzzle shuffles remain solvable, tiles stay inside the cavity, cover has separate stock', () => {
  for (const columns of [3, 4, 5, 6])
    for (const seed of [1, 7, 23, 99]) {
      const rows = 4,
        tile = 30,
        pitch = 30.4,
        border = 12,
        gap = 0.4;
      const r = render(sourceOf('slide-grid'), {
        params: { columns, rows, seed, shuffle_steps: 79 },
      });
      assert.deepEqual(r.warnings, []);
      const cells = Array(columns * rows).fill(0);
      for (const p of r.assembly.filter((p) => p.name.startsWith('Tile '))) {
        const [x, y, z] = point(p, 0);
        const col = Math.round((x - border - gap) / pitch),
          row = Math.round((y - border - gap) / pitch);
        assert.ok(col >= 0 && col < columns && row >= 0 && row < rows);
        assert.equal(cells[row * columns + col], 0);
        cells[row * columns + col] = Number(p.name.slice(5));
        assert.equal(z, 3);
        assert.ok(x + tile < border + columns * pitch + gap);
      }
      assert.deepEqual(
        [...cells].sort((a, b) => a - b),
        Array.from({ length: columns * rows }, (_, i) => i),
      );
      const inversions = cells.reduce(
        (n, a, i) => n + cells.slice(i + 1).filter((b) => a && b && a > b).length,
        0,
      );
      const blankFromBottom = rows - Math.floor(cells.indexOf(0) / columns);
      assert.equal(
        columns % 2 ? inversions % 2 : (inversions + blankFromBottom) % 2,
        columns % 2 ? 0 : 1,
      );
      const cover = r.parts.find((p) => p.name === 'Clear retainer');
      assert.equal(cover.thickness, 2);
      assert.equal(cover.material, 'clear acrylic');
      assert.ok(r.sheets.length >= 2);
      near(
        point(
          r.assembly.find((p) => p.name === 'Clear retainer'),
          0,
        ),
        [0, 0, 6.3],
      );
    }
});

test('cable chain pivot axes coincide throughout the allowed bend range', () => {
  for (const joint_angle of [0, 4, 8, 12]) {
    const r = render(sourceOf('cable-chain'), { params: { joint_angle } });
    assert.deepEqual(r.warnings, []);
    for (let i = 1; i < 8; i++)
      for (const side of ['left', 'right']) {
        const a = r.assembly.find((p) => p.name === `Link ${i} ${side} cheek`);
        const b = r.assembly.find((p) => p.name === `Link ${i + 1} ${side} cheek`);
        const end = point(a, 36),
          start = point(b, 0);
        near([end[0], end[2]], [start[0], start[2]]);
        assert.ok(Math.abs(end[1] - start[1]) >= 3.5 - 0.001);
      }
  }
});

test('cantilever links meet the tray pivots and trays remain level while opening', () => {
  const width = 110,
    height = 32,
    offset = width * 0.46,
    spread = width * 0.24,
    margin = width * 0.1;
  const length = Math.hypot(offset, height + 3);
  for (const opening of [0, 0.2, 0.5, 0.8, 1]) {
    const r = render(sourceOf('cantilever-case'), { params: { opening } });
    assert.deepEqual(r.warnings, []);
    assert.equal(r.assembly.find((p) => p.name === 'Base well front').outline.length, 5);
    assert.equal(r.assembly.find((p) => p.name === 'Left tray 1 front').outline.length, 5);
    assert.equal(r.assembly.find((p) => p.name === 'Left tray 2 front').outline.length, 3);
    for (const side of ['Left', 'Right'])
      for (const j of [1, 2])
        for (const k of [0, 1]) {
          const lower = r.assembly.find(
            (p) => p.name === (j === 1 ? 'Base well front' : `${side} tray ${j - 1} front`),
          );
          const upper = r.assembly.find((p) => p.name === `${side} tray ${j} front`);
          const link = r.assembly.find((p) => p.name === `${side} link ${j} front ${k + 1}`);
          const baseShift = j === 1 && side === 'Right' ? width + 6 : 0;
          const lo = point(
            lower,
            baseShift + margin + k * spread + (side === 'Right' ? offset : 0),
            j === 1 ? 44 - height / 2 : height / 2,
          );
          const hi = point(upper, margin + k * spread + (side === 'Left' ? offset : 0), height / 2);
          const a = point(link, 0),
            b = point(link, length);
          near([a[0], a[2]], [lo[0], lo[2]]);
          near([b[0], b[2]], [hi[0], hi[2]]);
          near([upper.matrix[0], upper.matrix[8]], [1, 0]);
        }
  }
});
