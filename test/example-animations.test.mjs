import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const models = JSON.parse(readFileSync(new URL('./fixtures/assemblies.json', import.meta.url)));
function glb(slug) {
  const b = readFileSync(new URL(`../site/public/3d/${slug}.glb`, import.meta.url));
  assert.equal(b.toString('ascii', 0, 4), 'glTF');
  assert.equal(b.readUInt32LE(4), 2);
  assert.equal(b.readUInt32LE(8), b.length);
  const n = b.readUInt32LE(12),
    doc = JSON.parse(b.toString('utf8', 20, 20 + n));
  const bin = b.subarray(28 + n);
  return {
    doc,
    values(index) {
      const a = doc.accessors[index],
        v = doc.bufferViews[a.bufferView];
      assert.equal(a.componentType, 5126);
      const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
      assert.ok(size);
      return Array.from({ length: a.count }, (_, i) =>
        Array.from({ length: size }, (_, k) =>
          bin.readFloatLE(
            (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (v.byteStride ?? size * 4) + k * 4,
          ),
        ),
      );
    },
  };
}

for (const model of models)
  test(`${model.file}: exported GLB has finite, changing, looping animation tracks`, () => {
    const { doc, values } = glb(model.file);
    assert.equal(doc.animations.length, 1);
    const animation = doc.animations[0];
    assert.ok(animation.channels.length > 0);
    let changing = false;
    for (const channel of animation.channels) {
      assert.ok(doc.nodes[channel.target.node]);
      const sampler = animation.samplers[channel.sampler];
      const times = values(sampler.input).flat(),
        poses = values(sampler.output);
      assert.equal(times.length, poses.length);
      assert.equal(times[0], 0);
      assert.ok(Math.abs(times.at(-1) - 4) < 0.001);
      assert.ok(times.every((v, i) => Number.isFinite(v) && (!i || v > times[i - 1])));
      assert.ok(poses.flat().every(Number.isFinite));
      if (poses.some((p) => p.some((v, i) => Math.abs(v - poses[0][i]) > 0.00001))) changing = true;
      const a = poses[0],
        b = poses.at(-1);
      if (channel.target.path === 'rotation')
        assert.ok(Math.abs(a.reduce((n, v, i) => n + v * b[i], 0)) > 0.9999);
      else a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 0.0001));
    }
    assert.ok(changing, 'Animation contains no movement');
  });
