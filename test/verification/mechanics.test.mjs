import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render, snapshotFromRender, verify, poseAssembly } from '../../dist/index.js';
const hash = 'a'.repeat(64),
  provenance = { sourceHash: hash, engineHash: hash, dependencies: {}, fonts: {} };
const snap = (source, params = {}, configuration = 'default') =>
  snapshotFromRender(render(source, { params, analysis: true }), {
    configuration,
    params,
    provenance,
  });
const spec = (claims, configurations = [{ id: 'default' }]) => ({
  schemaVersion: 1,
  model: 'mechanics',
  configurations,
  claims,
});
const result = (input, snapshots, id, limits) => {
  const r = verify(input, snapshots, limits);
  assert.equal(r.kind, 'report', JSON.stringify(r));
  const cs = r.report.claims.filter((c) => c.id === id);
  assert.ok(cs.length, JSON.stringify(r));
  return cs;
};
const rigid = { id: 'clear', kind: 'rigid-clearance', minimumGap: 0.5 };
const blocks =
  'x=3; $thickness=1; part("a",at=[0,0,0]) rect([2,2]); part("b",at=[x,0,0]) rect([2,2]);';
test('rigid clearance measures actual sheet solids and small interference', () => {
  assert.equal(result(spec([rigid]), [snap(blocks)], 'clear')[0].status, 'pass');
  assert.equal(result(spec([rigid]), [snap(blocks, { x: 1.9 })], 'clear')[0].status, 'fail');
});
test('physical box hardware participates in static clearance', () => {
  const source =
    'x=4; $thickness=1; part("a",at=[0,0,0]) rect([2,2]); hardware("steel",[x,1,0],[x,1,1],[2,2],up=[0,1,0],label="box");';
  assert.equal(result(spec([rigid]), [snap(source)], 'clear')[0].status, 'pass');
  assert.equal(result(spec([rigid]), [snap(source, { x: 1.5 })], 'clear')[0].status, 'fail');
});
test('solid triangulation preserves holes around cylindrical hardware', () => {
  const source =
    '$fn=32; part("plate",at=[0,0,0]) difference(){circle(r=10);circle(r=2.5);} hardware("steel",[0,0,0],[0,0,3],2,label="shaft");';
  const c = result(spec([{ ...rigid, minimumGap: 1 }]), [snap(source)], 'clear', {
    maxOperations: 20000000,
  })[0];
  assert.equal(c.status, 'pass', JSON.stringify(c));
});

const translating =
  'u=0; height=0; wall_x=0; $thickness=1; part("wall",at=[wall_x,-2,0]) rect([1,4]); part("mover",at=[-5+10*u,height,0]) rect([1,1]);';
const cases = [{ id: 'start' }, { id: 'end' }];
const move = {
  id: 'motion',
  kind: 'motion-clearance',
  from: 'start',
  to: 'end',
  moving: [{ body: { part: 'mover' }, trajectory: { kind: 'translate', by: [10, 0, 0] } }],
  minimumGap: 0.1,
};
const motionSnapshots = (source, base = {}) => [
  snap(source, { ...base, u: 0 }, 'start'),
  snap(source, { ...base, u: 1 }, 'end'),
];
test('a continuous translation catches an obstacle between clear endpoint poses', () => {
  const c = result(spec([move], cases), motionSnapshots(translating), 'motion')[0];
  assert.equal(c.status, 'fail', JSON.stringify(c));
  assert.ok(c.measurements.phase > 0 && c.measurements.phase < 1);
});
test('a clear translated path receives continuous, rather than sampled, coverage', () => {
  const c = result(spec([move], cases), motionSnapshots(translating, { height: 6 }), 'motion')[0];
  assert.equal(c.status, 'pass', JSON.stringify(c));
  assert.equal(c.coverage, 'continuous-nominal');
});
test('motion endpoints must match the authored analytic path', () => {
  const bad = {
    ...move,
    moving: [{ body: { part: 'mover' }, trajectory: { kind: 'translate', by: [9, 0, 0] } }],
  };
  assert.equal(
    result(spec([bad], cases), motionSnapshots(translating, { height: 6 }), 'motion')[0].status,
    'fail',
  );
});
test('continuous subdivision budget exhaustion stays unverified', () => {
  const c = result(
    spec([{ ...move, maxIntervals: 1 }], cases),
    motionSnapshots(translating, { wall_x: -2.5 }),
    'motion',
  )[0];
  assert.equal(c.status, 'unverified', JSON.stringify(c));
});
test('a rotating arm catches interference missed by its endpoints', () => {
  const source =
    'u=0; far=false; $thickness=1; part("arm",at=[0,0,0],rotate=[0,0,90*u]) rect([4,1]); part("obstacle",at=[far?10:2,far?10:2,0]) rect([1,1]);';
  const c = {
    ...move,
    moving: [
      {
        body: { part: 'arm' },
        trajectory: { kind: 'rotate', origin: [0, 0, 0], axis: [0, 0, 1], angle: 90 },
      },
    ],
  };
  assert.equal(result(spec([c], cases), motionSnapshots(source), 'motion')[0].status, 'fail');
  assert.equal(
    result(spec([c], cases), motionSnapshots(source, { far: true }), 'motion')[0].status,
    'pass',
  );
});
test('operation exhaustion cannot pass continuous motion', () => {
  assert.equal(
    result(spec([move], cases), motionSnapshots(translating, { height: 6 }), 'motion', {
      maxOperations: 1,
    })[0].status,
    'unverified',
  );
});

const assembly = {
  id: 'install',
  kind: 'assembly-access',
  initial: [{ part: 'wall' }],
  steps: [{ id: 'insert', part: { part: 'mover' }, from: [0, 10, 0], held: true }],
  minimumGap: 0,
};
const installation =
  ' $thickness=1; part("wall",at=[0,-2,0]) rect([1,4]); part("mover",at=[5,0,0]) rect([1,1]);';
test('authored insertion paths pass when clear and fail when they cross a wall', () => {
  assert.equal(result(spec([assembly]), [snap(installation)], 'install')[0].status, 'pass');
  const blocked = { ...assembly, steps: [{ ...assembly.steps[0], from: [-10, 0, 0] }] };
  const checked = result(spec([blocked]), [snap(installation)], 'install')[0];
  assert.equal(checked.status, 'fail');
  assert.equal(checked.assemblyStep, 'insert');
});
test('a closed opening traps a part larger than its aperture', () => {
  const source =
    '$fn=24;$thickness=1;part("wall",at=[0,0,0])difference(){rect([20,20],center=true);circle(r=2);}part("mover",at=[0,0,10])circle(r=3);';
  const c = { ...assembly, steps: [{ ...assembly.steps[0], from: [0, 0, -20] }] };
  assert.equal(result(spec([c]), [snap(source)], 'install')[0].status, 'fail');
});
test('tool insertion is checked against the installed closure', () => {
  const source =
    '$thickness=1;part("wall",at=[0,0,5])rect([10,10]);part("mover",at=[5,5,0])rect([1,1]);';
  const c = {
    ...assembly,
    steps: [
      {
        ...assembly.steps[0],
        from: [0, 20, 0],
        tool: { from: [5.5, 5.5, 1], to: [5.5, 5.5, 4], diameter: 0.5, travel: [0, 0, 10] },
      },
    ],
  };
  const checked = result(spec([c]), [snap(source)], 'install')[0];
  assert.equal(checked.status, 'fail', JSON.stringify(checked));
  assert.match(checked.message, /Tool access/);
});
test('installation coverage and temporary support cannot be omitted', () => {
  const duplicate = {
    ...assembly,
    steps: [assembly.steps[0], { ...assembly.steps[0], id: 'twice' }],
  };
  assert.equal(result(spec([duplicate]), [snap(installation)], 'install')[0].status, 'fail');
  const unsupported = { ...assembly, steps: [{ ...assembly.steps[0], held: false }] };
  assert.equal(
    result(spec([unsupported]), [snap(installation)], 'install')[0].status,
    'unverified',
  );
});

const glueSource =
  '$thickness=3;part("host",at=[0,0,0])rect([40,30]);part("patch",at=[10,8,3])rect([12,10]);';
const contact = {
  id: 'contact',
  kind: 'glue-contact',
  a: { part: 'host' },
  b: { part: 'patch' },
  faceA: 'top',
  faceB: 'bottom',
  minimumArea: 110,
};
const retained = {
  id: 'attached',
  kind: 'retention',
  roots: [{ part: 'host' }],
  links: [{ claim: 'contact', fastening: 'glued', installed: true }],
};
test('retention requires validated fastening, not geometric proximity alone', () => {
  assert.equal(result(spec([retained, contact]), [snap(glueSource)], 'attached')[0].status, 'pass');
  assert.equal(
    result(spec([{ ...retained, links: [] }, contact]), [snap(glueSource)], 'attached')[0].status,
    'fail',
  );
  assert.equal(
    result(
      spec([
        { ...retained, links: [{ claim: 'contact', fastening: 'glued', installed: false }] },
        contact,
      ]),
      [snap(glueSource)],
      'attached',
    )[0].status,
    'fail',
  );
});
test('a fit declaration cannot be promoted to positive retention by naming it locked', () => {
  const c = { ...retained, links: [{ claim: 'contact', fastening: 'locked', installed: true }] };
  assert.equal(result(spec([contact, c]), [snap(glueSource)], 'attached')[0].status, 'unverified');
});

const stable = {
  id: 'stable',
  kind: 'stability',
  supports: [{ part: 'base' }],
  loads: [{ body: { part: 'base' }, mass: 1 }],
  ground: 0,
  gravity: [0, 0, -1],
  minimumMargin: 1,
};
test('stability checks the gravity line against measured ground contacts', () => {
  const s = snap('$thickness=2;part("base",at=[0,0,0])rect([10,10]);');
  const good = result(spec([stable]), [s], 'stable')[0];
  assert.equal(good.status, 'pass');
  assert.equal(good.measurements.supportMargin, 5);
  assert.equal(
    result(spec([{ ...stable, gravity: [10, 0, -1] }]), [s], 'stable')[0].status,
    'fail',
  );
});
test('mass centers subtract holes and unavailable load data cannot pass', () => {
  const s = snap(
    '$thickness=2;part("base",at=[0,0,0])difference(){rect([10,10]);translate([6,4])rect([2,2]);}',
  );
  const c = result(spec([stable]), [s], 'stable')[0];
  assert.equal(c.status, 'pass');
  assert.ok(Math.abs(c.measurements.centerX - 472 / 96) < 1e-8);
  const withPayload = snap(
    '$thickness=2;part("base",at=[0,0,0])rect([10,10]);part("payload",at=[0,0,2])rect(2);',
  );
  assert.equal(result(spec([stable]), [withPayload], 'stable')[0].status, 'unverified');
});

test('stability rejects ground penetration by loads omitted from the support list', () => {
  const source = glueSource.replace('at=[10,8,3]', 'at=[10,8,-3]');
  const bond = { ...contact, faceA: 'bottom', faceB: 'top' };
  const c = {
    ...stable,
    supports: [{ part: 'host' }],
    loads: [
      { body: { part: 'host' }, mass: 10 },
      { body: { part: 'patch' }, mass: 1 },
    ],
    retention: 'attached',
  };
  const checked = result(spec([bond, retained, c]), [snap(source)], 'stable')[0];
  assert.equal(checked.status, 'fail', JSON.stringify(checked));
  assert.match(checked.message, /ground/);
});

const hingeSource =
  'u=0;$thickness=1;part("root",at=[0,0,0])translate([-4,-4])rect(1);part("arm",at=[0,0,0],rotate=[0,0,45*u])rect([3,1]);';
const joints = {
  id: 'joints',
  kind: 'joint-constraints',
  bodies: [{ part: 'root' }, { part: 'arm' }],
  roots: [{ part: 'root' }],
  expectedDof: 1,
  joints: [
    {
      kind: 'revolute',
      a: { part: 'root' },
      b: { part: 'arm' },
      anchorA: [0, 0, 0],
      anchorB: [0, 0, 0],
      axisA: [0, 0, 1],
      axisB: [0, 0, 1],
      range: [0, 60],
    },
  ],
};
test('ideal hinge constraints and rank establish one intended degree of freedom', () => {
  const cs = result(spec([joints], cases), motionSnapshots(hingeSource), 'joints');
  assert.ok(
    cs.every((c) => c.status === 'pass'),
    JSON.stringify(cs),
  );
  assert.equal(cs[0].measurements.degreesOfFreedom, 1);
  const wrong = { ...joints, expectedDof: 0 };
  assert.equal(
    result(spec([wrong], cases), motionSnapshots(hingeSource), 'joints')[0].status,
    'fail',
  );
});

test('a revolute joint cannot flip its oriented axis between endpoint poses', () => {
  const source = hingeSource.replace('rotate=[0,0,45*u]', 'rotate=[180*u,0,0]');
  const c = { ...joints, joints: [{ ...joints.joints[0], range: undefined }] };
  assert.equal(result(spec([c], cases), motionSnapshots(source), 'joints')[1].status, 'fail');
});

test('oppositely oriented hinge axes use the same angular sign at poses and throughout the path', () => {
  const c = { ...joints, joints: [{ ...joints.joints[0], axisB: [0, 0, -1], range: [-60, 0] }] };
  const m = {
    ...move,
    constraints: 'joints',
    moving: [
      {
        body: { part: 'arm' },
        trajectory: { kind: 'rotate', origin: [0, 0, 0], axis: [0, 0, 1], angle: 45 },
      },
    ],
  };
  assert.equal(
    result(spec([c, m], cases), motionSnapshots(hingeSource), 'motion')[0].status,
    'pass',
  );
  m.moving[0].trajectory.angle = 405;
  assert.equal(
    result(spec([c, m], cases), motionSnapshots(hingeSource), 'motion')[0].status,
    'fail',
  );
});

test('laminated parts can rotate together with exact terminal contact', () => {
  const source =
    'u=0;$thickness=1;part("base",at=[0,0,0],rotate=[0,0,45*u])rect([3,1]);part("patch",glue="base")rect([3,1]);';
  const trajectory = { kind: 'rotate', origin: [0, 0, 0], axis: [0, 0, 1], angle: 45 };
  const m = {
    ...move,
    minimumGap: 0,
    moving: ['base', 'patch'].map((part) => ({ body: { part }, trajectory })),
  };
  assert.equal(result(spec([m], cases), motionSnapshots(source), 'motion')[0].status, 'pass');
});

test('nested claim typos and numerically unbounded trajectories are invalid', () => {
  const variants = [
    {
      ...move,
      moving: [{ ...move.moving[0], trajectory: { ...move.moving[0].trajectory, speed: 1 } }],
    },
    {
      ...move,
      moving: [
        {
          ...move.moving[0],
          trajectory: { kind: 'rotate', origin: [0, 0, 0], axis: [1e300, 0, 1], angle: 45 },
        },
      ],
    },
    { ...assembly, steps: [{ ...assembly.steps[0], hold: true }] },
    { ...joints, joints: [{ ...joints.joints[0], ranges: [0, 45] }] },
  ];
  for (const c of variants) assert.equal(verify(spec([c], cases), []).kind, 'invalid-spec');
});
test('a wrong hinge anchor and a fixed joint that separates are rejected', () => {
  const wrong = { ...joints, joints: [{ ...joints.joints[0], anchorB: [1, 0, 0] }] };
  assert.equal(
    result(spec([wrong], cases), motionSnapshots(hingeSource), 'joints')[0].status,
    'fail',
  );
  const fixed = {
    ...joints,
    expectedDof: 0,
    joints: [{ kind: 'fixed', a: { part: 'root' }, b: { part: 'arm' } }],
  };
  assert.equal(
    result(spec([fixed], cases), motionSnapshots(hingeSource), 'joints')[1].status,
    'fail',
  );
});
test('an unconnected body adds unintended freedom', () => {
  const source = hingeSource + ' part("loose",at=[20,20,0])rect(1);';
  const c = { ...joints, bodies: [...joints.bodies, { part: 'loose' }] };
  assert.equal(result(spec([c], cases), motionSnapshots(source), 'joints')[0].status, 'fail');
});
test('slider constraints check the guide, stroke and mobility', () => {
  const source =
    'u=0;drift=0;$thickness=1;part("root",at=[0,0,0])translate([-4,-4])rect(1);part("arm",at=[10*u,drift*u,0])rect(1);';
  const c = {
    ...joints,
    joints: [
      {
        kind: 'prismatic',
        a: { part: 'root' },
        b: { part: 'arm' },
        axisA: [1, 0, 0],
        travel: [0, 20],
      },
    ],
  };
  assert.ok(
    result(spec([c], cases), motionSnapshots(source), 'joints').every((c) => c.status === 'pass'),
  );
  assert.equal(
    result(spec([c], cases), motionSnapshots(source, { drift: 1 }), 'joints')[1].status,
    'fail',
  );
});
test('continuous hinge motion honors angular stops even when endpoints coincide', () => {
  const source = hingeSource.replace('45*u', '360*u');
  const m = {
    ...move,
    constraints: 'joints',
    moving: [
      {
        body: { part: 'arm' },
        trajectory: { kind: 'rotate', origin: [0, 0, 0], axis: [0, 0, 1], angle: 360 },
      },
    ],
  };
  const checked = result(spec([joints, m], cases), motionSnapshots(source), 'motion')[0];
  assert.equal(checked.status, 'fail', JSON.stringify(checked));
});
test('a valid analytic hinge path satisfies joint constraints and continuous clearance', () => {
  const m = {
    ...move,
    constraints: 'joints',
    moving: [
      {
        body: { part: 'arm' },
        trajectory: { kind: 'rotate', origin: [0, 0, 0], axis: [0, 0, 1], angle: 45 },
      },
    ],
  };
  const checked = result(spec([joints, m], cases), motionSnapshots(hingeSource), 'motion')[0];
  assert.equal(checked.status, 'pass', JSON.stringify(checked));
});

const gearSource =
  'u=0;bad=false;$thickness=1;part("root",at=[0,0,0])translate([-5,-5])rect(1);part("driver",at=[0,0,0],rotate=[0,0,30*u])circle(r=1);part("driven",at=[10,0,0],rotate=[0,0,bad?0:-15*u])circle(r=1);';
const gears = {
  id: 'gears',
  kind: 'joint-constraints',
  bodies: [{ part: 'root' }, { part: 'driver' }, { part: 'driven' }],
  roots: [{ part: 'root' }],
  expectedDof: 1,
  joints: [
    {
      kind: 'revolute',
      a: { part: 'root' },
      b: { part: 'driver' },
      anchorA: [0, 0, 0],
      anchorB: [0, 0, 0],
      axisA: [0, 0, 1],
      axisB: [0, 0, 1],
    },
    {
      kind: 'revolute',
      a: { part: 'root' },
      b: { part: 'driven' },
      anchorA: [10, 0, 0],
      anchorB: [0, 0, 0],
      axisA: [0, 0, 1],
      axisB: [0, 0, 1],
    },
    {
      kind: 'gear',
      a: { part: 'driver' },
      b: { part: 'driven' },
      axisA: [0, 0, 1],
      axisB: [0, 0, 1],
      ratio: 0.5,
    },
  ],
};
test('gear coupling derives one input degree of freedom and checks the angular ratio', () => {
  assert.ok(
    result(spec([gears], cases), motionSnapshots(gearSource), 'gears').every(
      (c) => c.status === 'pass',
    ),
  );
  assert.equal(
    result(spec([gears], cases), motionSnapshots(gearSource, { bad: true }), 'gears')[1].status,
    'fail',
  );
});
test('continuous gear checks reject wrong extra revolutions even when endpoints look right', () => {
  const m = {
    ...move,
    constraints: 'gears',
    moving: [
      {
        body: { part: 'driver' },
        trajectory: { kind: 'rotate', origin: [0, 0, 0], axis: [0, 0, 1], angle: 30 },
      },
      {
        body: { part: 'driven' },
        trajectory: { kind: 'rotate', origin: [10, 0, 0], axis: [0, 0, 1], angle: -15 },
      },
    ],
  };
  assert.equal(
    result(spec([gears, m], cases), motionSnapshots(gearSource), 'motion')[0].status,
    'pass',
  );
  m.moving[1].trajectory.angle = 345;
  assert.equal(
    result(spec([gears, m], cases), motionSnapshots(gearSource), 'motion')[0].status,
    'fail',
  );
});

const gluePlan = {
  id: 'build',
  kind: 'assembly-access',
  initial: [{ part: 'host' }],
  steps: [
    { id: 'patch', part: { part: 'patch' }, from: [0, 0, 10], held: true, fasten: ['contact'] },
  ],
  minimumGap: 0,
};
const support = {
  id: 'during-build',
  kind: 'assembly-support',
  plan: 'build',
  retention: 'attached',
};
test('per-step support is derived from actual fastening operations', () => {
  const input = spec([support, retained, gluePlan, contact]);
  assert.equal(result(input, [snap(glueSource)], 'during-build')[0].status, 'pass');
  const unfastened = { ...gluePlan, steps: [{ ...gluePlan.steps[0], fasten: [] }] };
  assert.equal(
    result(spec([contact, unfastened, retained, support]), [snap(glueSource)], 'during-build')[0]
      .status,
    'fail',
  );
});
test('temporary holds cannot conceal a permanently unsupported final assembly', () => {
  const plan = { ...gluePlan, steps: [{ ...gluePlan.steps[0], fasten: [] }] };
  const c = { ...support, holds: [{ step: 'patch', bodies: [{ part: 'patch' }] }] };
  assert.equal(
    result(spec([contact, plan, retained, c]), [snap(glueSource)], 'during-build')[0].status,
    'fail',
  );
});
test('combined stability requires verified retention of its declared loads', () => {
  const c = {
    ...stable,
    supports: [{ part: 'host' }],
    loads: [
      { body: { part: 'host' }, mass: 10 },
      { body: { part: 'patch' }, mass: 1 },
    ],
    retention: 'attached',
  };
  assert.equal(
    result(spec([c, retained, contact]), [snap(glueSource)], 'stable')[0].status,
    'pass',
  );
  const loose = { ...retained, links: [] };
  assert.equal(
    result(spec([c, loose, contact]), [snap(glueSource)], 'stable')[0].status,
    'unverified',
  );
});
test('native glue cannot be animated as an independent rotating joint', () => {
  const source =
    'u=0;$thickness=1;part("root",at=[0,0,0])translate([-5,-5])rect([10,10]);part("arm",glue="root",rotate=[0,0,360*u])rect([3,1]);';
  const j = {
    ...joints,
    joints: [{ ...joints.joints[0], anchorA: [0, 0, 1], range: [-360, 360] }],
  };
  assert.equal(result(spec([j], cases), motionSnapshots(source), 'joints')[0].status, 'fail');
  const m = {
    ...move,
    moving: [
      {
        body: { part: 'arm' },
        trajectory: { kind: 'rotate', origin: [0, 0, 1], axis: [0, 0, 1], angle: 360 },
      },
    ],
  };
  assert.equal(result(spec([m], cases), motionSnapshots(source), 'motion')[0].status, 'fail');
});
test('laminated native stack layers cannot turn independently', () => {
  const source = '$thickness=1;part("layer",stack=2,at=[0,0,0])rect([3,1]);';
  const m = {
    ...move,
    moving: [
      {
        body: { part: 'layer', copy: 2 },
        trajectory: { kind: 'rotate', origin: [0, 0, 1], axis: [0, 0, 1], angle: 360 },
      },
    ],
  };
  assert.equal(
    result(spec([m], cases), [snap(source, {}, 'start'), snap(source, {}, 'end')], 'motion')[0]
      .status,
    'fail',
  );
});
test('snapshot resolves host copies for repeated glued stacks', () => {
  const source =
    '$thickness=1;part("host",qty=2,at=[[0,0,0],[20,0,0]])rect(10);part("patch",qty=2,stack=2,glue="host")rect(2);';
  const s = snap(source);
  assert.deepEqual(
    s.parts.filter((p) => p.name === 'patch').map((p) => p.glue.copy),
    [1, 1, 2, 2],
  );
});
test('checked analytic poses drive previews without changing the cut files', () => {
  const initial = render(hingeSource, { params: { u: 0 }, analysis: true });
  const original = initial.assembly.find((p) => p.name === 'arm').matrix.slice();
  const controls = [
    {
      body: { part: 'arm' },
      trajectory: { kind: 'rotate', origin: [0, 0, 0], axis: [0, 0, 1], angle: 45 },
    },
  ];
  const posed = poseAssembly(initial, controls, 1),
    expected = render(hingeSource, { params: { u: 1 } });
  posed.assembly
    .find((p) => p.name === 'arm')
    .matrix.forEach((v, i) =>
      assert.ok(Math.abs(v - expected.assembly.find((p) => p.name === 'arm').matrix[i]) < 1e-8),
    );
  assert.equal(posed.svg, initial.svg);
  assert.deepEqual(initial.assembly.find((p) => p.name === 'arm').matrix, original);
  assert.throws(() => poseAssembly(initial, controls, 2));
  assert.throws(() => poseAssembly(initial, [...controls, ...controls], 0.5));
});

const fixtureText = (name) =>
  readFileSync(new URL(`../fixtures/verification/${name}`, import.meta.url), 'utf8');
const shaft = () => JSON.parse(fixtureText('captured-shaft.verify.json')).claims[0];
test('shaft stops pair with bearings by position, whatever order they are listed in', () => {
  const s = snap(fixtureText('captured-shaft.kerf'));
  const reversed = shaft();
  reversed.stops.reverse();
  assert.equal(result(spec([reversed]), [s], reversed.id).at(-1).status, 'pass');
});
test('a bore drawn with an odd number of sides is centred on its corners', () => {
  const source = fixtureText('captured-shaft.kerf');
  assert.match(source, /\$fn = 96/);
  const s = snap(source.replace('$fn = 96', '$fn = 31'));
  assert.equal(result(spec([shaft()]), [s], shaft().id).at(-1).status, 'pass');
});
test('a hinge range past half a turn is measured in whole turns', () => {
  const src =
    'u=0;$thickness=1;part("root",at=[0,0,0])translate([-4,-4])rect(1);part("arm",at=[0,0,0],rotate=[0,0,u])rect([3,1]);';
  const claim = {
    id: 'joints',
    kind: 'joint-constraints',
    bodies: [{ part: 'root' }, { part: 'arm' }],
    roots: [{ part: 'root' }],
    expectedDof: 1,
    joints: [
      {
        kind: 'revolute',
        a: { part: 'root' },
        b: { part: 'arm' },
        anchorA: [0, 0, 0],
        anchorB: [0, 0, 0],
        axisA: [0, 0, 1],
        axisB: [0, 0, 1],
        range: [0, 270],
      },
    ],
  };
  const configs = [
    { id: 'closed', params: { u: 0 } },
    { id: 'open', params: { u: 200 } },
  ];
  const cs = result(
    spec([claim], configs),
    [snap(src, { u: 0 }, 'closed'), snap(src, { u: 200 }, 'open')],
    'joints',
  );
  assert.deepEqual(
    cs.map((c) => c.status),
    ['pass', 'pass'],
  );
  const past = result(
    spec([claim], [configs[0], { id: 'past', params: { u: 300 } }]),
    [snap(src, { u: 0 }, 'closed'), snap(src, { u: 300 }, 'past')],
    'joints',
  );
  assert.equal(past.at(-1).status, 'fail');
});
test('a stack glued under its host is bonded layer to layer', () => {
  const src =
    'material(thickness = 3, kerf = 0) { part("host", at = [0, 0, 0]) rect([40, 30]); part("pad", glue = "host", face = "bottom", stack = 2, at = [5, 5, 0]) rect([10, 10]); }';
  const claim = {
    id: 'j',
    kind: 'joint-constraints',
    bodies: [{ part: 'host' }, { part: 'pad', copy: 1 }, { part: 'pad', copy: 2 }],
    roots: [{ part: 'host' }],
    expectedDof: 0,
    joints: [],
  };
  assert.equal(result(spec([claim]), [snap(src)], 'j')[0].status, 'pass');
});
test('references a specification can check before rendering are input errors', () => {
  const typo = { ...gluePlan, steps: [{ ...gluePlan.steps[0], fasten: ['contcat'] }] };
  assert.equal(verify(spec([contact, typo, retained, support]), []).kind, 'invalid-spec');
  const hold = { ...support, holds: [{ step: 'nope', bodies: [{ part: 'patch' }] }] };
  assert.equal(verify(spec([contact, gluePlan, retained, hold]), []).kind, 'invalid-spec');
  const twice = {
    ...move,
    moving: [
      { body: { part: 'arm' }, trajectory: { kind: 'translate', by: [1, 0, 0] } },
      { body: { part: 'arm', copy: 1 }, trajectory: { kind: 'translate', by: [2, 0, 0] } },
    ],
  };
  assert.equal(verify(spec([twice], cases), []).kind, 'invalid-spec');
  const invariant = { id: 'same', kind: 'cut-invariant' };
  assert.equal(verify(spec([invariant]), []).kind, 'invalid-spec');
});
test('separately retained loads are not stable as one assembly', () => {
  // Two narrow plates far apart: neither stands with a 1.5 margin, but
  // their contacts together span a wide polygon
  const source = '$thickness=2;part("a",at=[0,0,0])rect([2,10]);part("b",at=[20,0,0])rect([2,10]);';
  const roots = { id: 'held', kind: 'retention', roots: [{ part: 'a' }, { part: 'b' }], links: [] };
  const c = {
    ...stable,
    minimumMargin: 1.5,
    supports: [{ part: 'a' }, { part: 'b' }],
    loads: [
      { body: { part: 'a' }, mass: 1 },
      { body: { part: 'b' }, mass: 1 },
    ],
    retention: 'held',
  };
  const checked = result(spec([roots, c]), [snap(source)], 'stable')[0];
  assert.equal(checked.status, 'unverified', JSON.stringify(checked));
  assert.match(checked.message, /separate roots/);
});
test('a ball of hardware has an envelope round its centre', () => {
  // A 10 mm ball over a plate: clear 1 mm above it, touching at 5
  const source =
    'z=6; $thickness=1; part("plate",at=[-10,-10,0]) rect([20,20]); hardware("ball",[0,0,z+1],size=10,shape="ball",label="marble");';
  assert.equal(result(spec([rigid]), [snap(source)], 'clear')[0].status, 'pass');
  assert.equal(result(spec([rigid]), [snap(source, { z: 4 })], 'clear')[0].status, 'fail');
});
