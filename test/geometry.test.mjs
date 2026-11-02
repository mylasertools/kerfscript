import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KerfError, render } from '../dist/index.js';

const font = readFileSync(new URL('../fonts/AtkinsonHyperlegible-Regular.ttf', import.meta.url));

const area = (p) => {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++)
    a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return -a / 2;
};
const layer = (r, name, item = 0, sheet = 0) => r.sheets[sheet].items[item].layers.get(name);
const netArea = (l) => l.regions.reduce((s, p) => s + area(p), 0);
const inside = (polys, [x, y]) => {
  let c = false;
  for (const p of polys)
    for (let i = 0, j = p.length - 1; i < p.length; j = i++)
      if (
        p[i][1] > y !== p[j][1] > y &&
        x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]
      )
        c = !c;
  return c;
};

test('rect and difference make a plate with a hole', () => {
  const r = render('difference() { rect([40, 20]); translate([20, 10]) circle(r = 5, $fn = 64); }');
  const cut = layer(r, 'cut');
  assert.equal(cut.regions.length, 2);
  assert.ok(Math.abs(netArea(cut) - (800 - Math.PI * 25)) < 1);
  assert.equal(r.parts[0].width, 40);
  assert.equal(r.parts[0].pieces, 1);
});

test('kerf compensation grows outlines and shrinks holes', () => {
  const src = '$kerf = 0.2; difference() { rect([40, 20]); translate([10, 5]) rect([10, 10]); }';
  const cut = layer(render(src), 'cut');
  const outer = cut.regions.find((p) => area(p) > 0);
  const hole = cut.regions.find((p) => area(p) < 0);
  const span = (p, i) => Math.max(...p.map((q) => q[i])) - Math.min(...p.map((q) => q[i]));
  assert.ok(Math.abs(span(outer, 0) - 40.2) < 1e-3);
  assert.ok(Math.abs(span(hole, 0) - 9.8) < 1e-3);
  const noKerf = layer(render(src, { kerf: 0 }), 'cut');
  assert.ok(
    Math.abs(
      span(
        noKerf.regions.find((p) => area(p) > 0),
        0,
      ) - 40,
    ) < 1e-6,
  );
});

test('svg lists holes before outer outlines in the cut layer', () => {
  const r = render('difference() { rect([40, 20]); translate([20, 10]) circle(5); }');
  const paths = [...r.svg.matchAll(/<path data-part="part" d="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(paths.length, 2);
  assert.ok(paths[0].length > paths[1].length, 'circle hole comes first');
  assert.match(r.svg, /width="46mm" height="26mm"/);
  assert.match(r.svg, /<g id="cut" inkscape:groupmode="layer"[^>]*stroke="#ff0000"/);
});

test('engraving and scoring are clipped to the material', () => {
  const r = render(`
    difference() { rect([40, 40]); translate([20, 20]) circle(5); }
    engrave() translate([10, 10]) rect([20, 20]);
    score() translate([-10, 20]) line([0, 0], [60, 0]);
  `);
  const eng = layer(r, 'engrave');
  assert.ok(Math.abs(netArea(eng) - (400 - Math.PI * 25)) < 1);
  const score = layer(r, 'score');
  assert.equal(score.lines.length, 2);
  const len = score.lines.reduce((s, l) => s + Math.hypot(l[1][0] - l[0][0], l[1][1] - l[0][1]), 0);
  assert.ok(Math.abs(len - 30) < 0.1);
});

test('svg and dxf leave out points that round onto the point before', () => {
  const r = render(
    'polygon([[0, 0], [20, 0], [20.0001, 0.0002], [20, 10], [0, 10], [0, 0.0001]]);',
    {
      kerf: 0,
    },
  );
  for (const [, body] of r.svg.matchAll(/ d="M([^"Z]+)Z?"/g)) {
    const pts = body.split('L');
    assert.ok(
      pts.every((q, i) => i === 0 || q !== pts[i - 1]),
      body,
    );
    assert.notEqual(pts[0], pts[pts.length - 1], body);
    assert.equal(pts.length, 4);
  }
  assert.equal(r.sheets[0].dxf.match(/\nVERTEX\n/g).length, 4);
});

test('score() on a shape scores its outline as lines', () => {
  const r = render('rect([30, 30]); score() translate([5, 5]) rect([10, 10]);');
  const s = layer(r, 'score');
  assert.equal(s.regions.length, 0);
  assert.equal(s.lines.length, 1);
  assert.equal(s.lines[0].length, 5);
});

test('layer() defines custom layers with their own colour', () => {
  const r = render(
    'rect(20); layer("deep", mode = "fill", color = "#00aa00") translate([5, 5]) rect(5);',
  );
  assert.ok(r.layers.some((l) => l.name === 'deep' && l.mode === 'fill'));
  assert.match(r.svg, /<g id="deep"[^>]*fill="#00aa00"/);
});

test('guide geometry is left out unless asked for', () => {
  const src = 'rect(10); guide() circle(30);';
  assert.ok(!render(src).svg.includes('id="guide"'));
  assert.ok(render(src, { guides: true }).svg.includes('id="guide"'));
  assert.equal(render('rect(10); *circle(30);').parts[0].width, 10);
});

test('transforms', () => {
  const b = (src) => {
    const r = render(src, { layout: 'none', gap: 0 });
    return [r.parts[0].width, r.parts[0].height];
  };
  assert.deepEqual(b('rotate(90) rect([30, 10]);'), [10, 30]);
  assert.deepEqual(b('scale([2, 0.5]) rect([30, 10]);'), [60, 5]);
  assert.deepEqual(b('mirror([1, 0]) rect([30, 10]);'), [30, 10]);
  assert.deepEqual(
    b('hull() { circle(1, $fn = 4); translate([20, 0]) circle(1, $fn = 4); }'),
    [22, 2],
  );
  assert.deepEqual(b('offset(r = 2) rect([10, 10]);'), [14, 14]);
  assert.deepEqual(
    b('intersection() { rect([30, 30]); translate([20, 20]) rect([30, 30]); }'),
    [10, 10],
  );
  const mirrored = render('mirror([1, 0]) difference() { rect(20); translate([5, 5]) rect(10); }');
  assert.equal(mirrored.parts[0].pieces, 1);
  assert.ok(Math.abs(netArea(layer(mirrored, 'cut')) - 300) < 1e-6);
});

test('path() reads SVG path data', () => {
  const r = render('path("M0 0 H20 V10 A10 10 0 0 1 0 10 Z");', { layout: 'none', gap: 0 });
  assert.equal(r.parts[0].width, 20);
  assert.ok(Math.abs(r.parts[0].height - 20) < 0.01);
});

test('finger joints of a box interlock along every shared edge', () => {
  const t = 3;
  const panel = (size, edges) =>
    layer(
      render(`$thickness = ${t}; finger_rect(${JSON.stringify(size)}, ${JSON.stringify(edges)});`, {
        layout: 'none',
        gap: 0,
      }),
      'cut',
    ).regions;
  const bottom = panel([120, 80], 'out');
  const front = panel([120, 50], ['in', 'out', 'in', 'out']);
  const side = panel([80, 50], ['in', 'in', 'in', 'in']);
  const strip = (polys, axis, at, length) => {
    const out = [];
    for (let s = 0.25; s < length; s += 0.5)
      out.push(inside(polys, axis === 'x' ? [s, at] : [at, s]));
    return out;
  };
  const complement = (a, b, label, corner = false) =>
    a.forEach((v, i) => {
      const s = 0.25 + i * 0.5;
      if (corner && (s < t || s > a.length / 2 - t))
        assert.ok(!v && !b[i], `${label} corner at ${s} belongs to the bottom or lid`);
      else assert.notEqual(v, b[i], `${label} at ${s}`);
    });
  complement(strip(bottom, 'x', t / 2, 120), strip(front, 'x', t / 2, 120), 'bottom/front');
  complement(strip(bottom, 'y', t / 2, 80), strip(side, 'x', t / 2, 80), 'bottom/side');
  complement(strip(front, 'y', t / 2, 50), strip(side, 'y', t / 2, 50), 'front/side', true);
});

test('kerf/box packs six panels with a lid, all in one piece', () => {
  const r = render('use <kerf/box>\n$thickness = 4; box([150, 100, 60], lid = true);');
  assert.equal(r.parts.length, 6);
  assert.ok(r.parts.every((p) => p.pieces === 1 && p.thickness === 4));
  assert.equal(r.sheets.length, 1);
  assert.equal(r.warnings.length, 0);
});

test('living hinge lines stay inside the hinge area', () => {
  const r = render('rect([60, 40]); translate([20, 0]) living_hinge([20, 40]);', {
    layout: 'none',
    gap: 0,
  });
  const cut = layer(r, 'cut');
  assert.ok(cut.lines.length > 20);
  for (const l of cut.lines) for (const [x] of l) assert.ok(x >= 20 && x <= 40);
  assert.equal(r.parts[0].pieces, 1);
});

test('parts are packed onto sheets with quantities', () => {
  const r = render('part("tile", qty = 12) rect([90, 90]);', { sheet: [300, 200], gap: 5 });
  assert.equal(
    r.sheets.reduce((s, sh) => s + sh.items.length, 0),
    12,
  );
  assert.equal(r.sheets.length, 2);
  assert.ok(r.sheets.every((s) => s.width <= 300 && s.height <= 200));
});

test('parts bigger than the sheet are rotated or reported', () => {
  const r = render('part("long") rect([350, 100]);', { sheet: [200, 400] });
  assert.equal(r.sheets[0].items[0].rotated, true);
  const big = render('part("huge") rect([500, 500]);', { sheet: [200, 200] });
  assert.match(big.warnings[0], /bigger than the 200 x 200 mm sheet/);
});

test('loose pieces are reported', () => {
  const r = render('rect(10); translate([20, 0]) rect(10);');
  assert.match(r.warnings[0], /cuts into 2 separate pieces/);
});

test('material() sets thickness and kerf for its parts', () => {
  const r = render(
    'material(thickness = 6, kerf = 0.1, name = "oak") part("a") rect(10); part("b") rect(10);',
  );
  const a = r.parts.find((p) => p.name === 'a');
  const b = r.parts.find((p) => p.name === 'b');
  assert.deepEqual([a.thickness, a.kerf, a.material], [6, 0.1, 'oak']);
  assert.deepEqual([b.thickness, b.kerf], [3, 0]);
  assert.equal(r.sheets.length, 2);
});

test('text renders with a font and text_width measures it', () => {
  const fonts = { atkinson: font };
  const r = render('w = text_width("Hello", 10); echo(w); text("Hello", 10, halign = "center");', {
    fonts,
    layout: 'none',
    gap: 0,
  });
  const w = Number(r.echoes[0]);
  assert.ok(w > 20 && w < 35);
  assert.ok(Math.abs(r.parts[0].width - w) < 2);
  assert.throws(() => render('text("x");'), /needs a font/);
  assert.throws(
    () => render('text("x", font = "nope");', { fonts }),
    /Font "nope" is not available\. Available fonts: atkinson/,
  );
});

test('errors list the fonts a host still has to load', () => {
  const missing = (src, opts) => {
    try {
      render(src, opts);
    } catch (e) {
      return e.missingFonts;
    }
  };
  assert.deepEqual(missing('text("x", font = "Serif");', { fonts: { atkinson: font } }), ['Serif']);
  assert.deepEqual(missing('echo(text_width("x", 5));', { fonts: {}, defaultFont: 'Sans' }), [
    'Sans',
  ]);
  assert.deepEqual(missing('text("x");', { fonts: {} }), ['']);
  assert.equal(missing('x = undef + 1;', { fonts: {} }), undefined);
  assert.throws(
    () => render('\necho(text_width("x", 5));', { fonts: {} }),
    (e) => e instanceof KerfError && e.line === 2,
  );
});

test('layer paths describe every layer for host apps', () => {
  const r = render(
    'difference() { rect(20); translate([10, 5]) circle(3); } engrave() rect(4); score() line([2, 10], [18, 10]);',
  );
  assert.deepEqual(
    r.paths.map((p) => [p.name, p.mode, p.color]),
    [
      ['engrave', 'fill', '#000000'],
      ['score', 'line', '#0000ff'],
      ['cut', 'cut', '#ff0000'],
    ],
  );
  const cut = r.paths.find((p) => p.name === 'cut').d;
  assert.equal(cut.match(/M/g).length, 2);
  assert.ok(cut.indexOf('M') === 0 && r.svg.includes(cut.split('Z')[0]));
  assert.deepEqual([r.width, r.height], [r.sheets[0].width, r.sheets[0].height]);
  const two = render('part("a") rect(300); part("b") rect(300);', { sheet: [320, 320] });
  assert.equal(two.sheets.length, 2);
  assert.ok(two.height > two.sheets[0].height * 2);
  assert.equal(two.paths[0].d.match(/M/g).length, 2);
});

test('layer paths keep filled regions apart from open lines', () => {
  const r = render(
    'engrave() { difference() { rect(20); translate([10, 10]) circle(4); } line([0, 25], [20, 25]); }',
    { margin: 0 },
  );
  const engrave = r.paths.find((p) => p.name === 'engrave');
  assert.equal(engrave.lines.match(/M/g).length, 1);
  assert.ok(!engrave.lines.includes('Z'));
  assert.equal(engrave.regions.match(/M/g).length, 2);
  assert.equal(engrave.regions.match(/Z/g).length, 2);
  assert.equal(engrave.d, engrave.lines + engrave.regions);
  assert.match(r.svg, /<g id="engrave"[^>]* fill="#000000" fill-rule="evenodd" stroke="none">/);
});

test('margin sets the sheet border apart from the gap between parts', () => {
  const one = render('rect([70, 30]);', { margin: 0 });
  assert.deepEqual([one.width, one.height], [70, 30]);
  assert.deepEqual(
    [render('rect([70, 30]);').width, render('rect([70, 30]);', { gap: 5 }).width],
    [76, 80],
  );
  const two = render('part("a") rect(20); part("b") rect(20);', { margin: 0, gap: 4 });
  assert.deepEqual([two.width, two.height], [44, 20]);
  const loose = render('rect(10);', { layout: 'none', margin: 1 });
  assert.equal(loose.width, 12);
});

test('dxf export has layers and closed polylines', () => {
  const r = render('rect(10); score() translate([2, 2]) rect(3);');
  const dxf = r.sheets[0].dxf;
  assert.match(dxf, /AC1009/);
  assert.match(dxf, /LAYER\n2\nCUT/);
  assert.equal((dxf.match(/\nPOLYLINE\n/g) ?? []).length, 2);
  assert.match(dxf, /\nEOF\n$/);
});

test('a hole narrower than the kerf is reported', () => {
  const src = (d) =>
    `$kerf = 0.3; difference() { rect(20); translate([10, 10]) circle(d = ${d}); }`;
  assert.match(render(src(0.2)).warnings.join('\n'), /1 hole is narrower than the 0.3 mm kerf/);
  assert.deepEqual(render(src(2)).warnings, []);
});

// The length of a layer's lines, from its path data
function lineLength(result, layer) {
  const d = result.paths.find((p) => p.name === layer)?.lines ?? '';
  let total = 0;
  for (const sub of d.split('M').filter(Boolean)) {
    const pts = sub.split('L').map((s) => s.trim().split(' ').map(Number));
    for (let i = 1; i < pts.length; i++)
      total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return total;
}

// A closed polyline whose last edge runs back over the one before it:
// Clipper's clipping of open paths added long lines to it
test('a closed polyline scored inside a part keeps its length', () => {
  const loop = [
    [2, 1],
    [1, 0],
    [0, 0],
    [5, 0],
    [2, 1],
  ];
  const r = render(
    `$layout = "none"; part("p") { circle(d = 48); score() polyline(${JSON.stringify(loop)}); }`,
  );
  const length = lineLength(r, 'score');
  const drawn = Math.SQRT2 + 1 + 5 + Math.sqrt(10);
  assert.ok(Math.abs(length - drawn) < 1e-3, `score length ${length}`);
});

test('lines along a part edge are left out, lines inside it kept', () => {
  const r = render(
    'part("p") { rect([20, 20]); score() { line([0, 0], [20, 0]); line([0, 10], [20, 10]); line([-5, 15], [25, 15]); } }',
  );
  const length = lineLength(r, 'score');
  assert.ok(Math.abs(length - 40) < 1e-6, `score length ${length}`);
});

// An outline that runs back and forth along its base: Clipper ran out of
// memory on it
const spike = [
  [0, 3],
  [1, 0],
  [0.5, 0],
  [0, 0],
  [2, 0],
];

test('an outline with a spike out and back renders', () => {
  const r = render(`engrave() polygon(${JSON.stringify(spike)});`);
  assert.ok(r.paths.find((p) => p.name === 'engrave'));
});
