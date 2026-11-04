import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../dist/index.js';

test('analysis is opt-in, nominal, and does not change manufacturing output', () => {
  const source = '$kerf=0.2; part("plate",at=[0,0,0]) { rect([20,10]); line([2,2],[4,4]); }';
  const original = render(source);
  const analyzed = render(source, { analysis: true });
  assert.equal(original.analysis, undefined);
  assert.equal(analyzed.svg, original.svg);
  assert.equal(analyzed.sheets[0].dxf, original.sheets[0].dxf);
  assert.deepEqual(analyzed.assembly, original.assembly);
  assert.equal(analyzed.analysis.schemaVersion, 1);
  const geometry = analyzed.analysis.parts[0];
  assert.equal(geometry.kerf, 0.2);
  assert.deepEqual(geometry.cutLines, [
    [
      [2, 2],
      [4, 4],
    ],
  ]);
  const xs = geometry.cutRegions.flat().map(([x]) => x);
  assert.equal(Math.min(...xs), 0);
  assert.equal(Math.max(...xs), 20);
});

test('copies with equal-area slots in different locations are diagnosed geometrically', () => {
  const result = render(`
    part("wall",qty=2,at=[[0,0,0],[100,0,0]],slots=["tab"]) rect([50,50]);
    part("tab",qty=2,at=[[10,10,0],[130,10,0]],rotate=[90,0,0]) rect([5,10]);
  `);
  assert.ok(
    result.warnings.some((w) => /slots in different places/.test(w)),
    result.warnings.join('\n'),
  );
});

test('identical slot copies remain interchangeable without a new warning', () => {
  const result = render(`
    part("wall",qty=2,at=[[0,0,0],[100,0,0]],slots=["tab"]) rect([50,50]);
    part("tab",qty=2,at=[[10,10,0],[110,10,0]],rotate=[90,0,0]) rect([5,10]);
  `);
  assert.ok(
    !result.warnings.some((w) => /slots in different places/.test(w)),
    result.warnings.join('\n'),
  );
});
