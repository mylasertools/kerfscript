import test from 'node:test';
import assert from 'node:assert/strict';
import { meshBodies, render, toModel } from '../dist/index.js';

const SRC = `
part("base", at = [-40, -40, 0]) rect([80, 80]);
step("Add the light") {
  hardware("tealight", [0, 0, 3]);
  hardware("led", [-30, 30, 50], [30, 30, 50], 5);
  hardware("led", [0, -30, 50], [5, -30, 50], 5);
  place(at = [100, 0, 0]) light([0, 0, 40], "cool white", lumens = 50, label = "spot");
}`;

const glbJson = (glb) => {
  const n = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + n)));
};

test('tealights, LEDs, bulbs and light() give off light', () => {
  const r = render(SRC);
  assert.deepEqual(r.warnings, []);
  const [flame, strip, led, spot] = r.lights;
  // The tealight stands at [0, 0, 3], 16 high; its flame is 10 above that
  assert.deepEqual(flame.from, [0, 0, 29]);
  assert.equal(flame.flicker, true);
  assert.equal(flame.source, 'tealight');
  assert.equal(flame.step, 1);
  const cup = r.hardware[0];
  assert.deepEqual([cup.to, cup.size], [[0, 0, 19], 39]);
  // A 60 mm strip lights all along; a 5 mm LED is a point
  assert.deepEqual([strip.from, strip.to, strip.lumens], [[-30, 30, 50], [30, 30, 50], 12]);
  assert.deepEqual(led.from, led.to);
  // light() goes where place() puts it
  assert.deepEqual(spot.from, [100, 0, 40]);
  assert.equal(spot.color, '#eef3ff');
  assert.equal(spot.label, 'spot');
  assert.equal(
    render('hardware("bulb", [0, 0, 50], size = 60, shape = "ball");').lights[0].lumens,
    100,
  );
  assert.deepEqual(render('hardware("dowel", [0, 0, 0], [0, 0, 50]);').lights, []);
});

test('light() checks its colour and lumens', () => {
  assert.equal(render('light([0, 0, 0], "#123456");').lights[0].color, '#123456');
  assert.equal(render('light([0, 0, 0], "red");').lights[0].color, '#c8372d');
  assert.throws(() => render('light([0, 0, 0], "plaid");'), /color must look like/);
  assert.throws(() => render('light([0, 0, 0], lumens = -1);'), /lumens must be 0 or more/);
  // A light made in a module's children each time is not lost to caching
  const r = render('module lamp() light([0, 0, 10]); for (i = [0:2]) translate([i, 0]) lamp();');
  assert.equal(r.lights.length, 3);
});

test('GLB files carry lights as point lights, flames and LEDs emissive', () => {
  const r = render(SRC);
  const json = glbJson(toModel(r, 'glb'));
  assert.deepEqual(json.extensionsUsed, ['KHR_lights_punctual']);
  const lights = json.extensions.KHR_lights_punctual.lights;
  const nodes = json.nodes.filter((n) => n.extensions?.KHR_lights_punctual);
  assert.equal(nodes.length, lights.length);
  // The strip is two points, sharing its 12 lumens
  assert.equal(lights.length, 1 + 2 + 1 + 1);
  const flame = nodes.find((n) => n.extras.source === 'tealight');
  assert.deepEqual(flame.translation, [0, 0.029, 0]);
  assert.equal(flame.extras.flicker, true);
  assert.ok(Math.abs(lights[0].intensity - 12 / (4 * Math.PI)) < 1e-9);
  assert.deepEqual(
    json.materials.filter((m) => m.emissiveFactor).map((m) => m.name),
    ['led', 'flame'],
  );
  // Flat and print layouts have no lights
  assert.equal(glbJson(toModel(r, 'glb', { layout: 'flat' })).extensionsUsed, undefined);
  assert.equal(glbJson(toModel(render('rect(10);'), 'glb')).extensionsUsed, undefined);
});

test('a tealight has a flame body over it in the assembled model', () => {
  const bodies = meshBodies(render(SRC));
  const flame = bodies.find((b) => b.material === 'flame');
  assert.ok(flame && flame.glow);
  const zs = flame.positions.filter((_, i) => i % 3 === 2);
  assert.ok(Math.min(...zs) > 19 && Math.max(...zs) < 33);
  const cup = bodies.find((b) => b.material === 'tealight');
  assert.ok(cup && !cup.glow);
});
