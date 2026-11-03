// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// The assembled model in 3D, built a step at a time. It takes what
// render() returns: the placed parts with their bends and marks, the
// assembly steps and the hardware. Bundled with three.js into
// /assets/assembly.js by scripts/prepare.mjs.

import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Path,
  PerspectiveCamera,
  Scene,
  Shape,
  ShapeGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { bendPoint, meshPieces } from './kerfscript.js';
import { referenceKey, verificationFindings } from './verification.js';

// Wood and other sheets by their material name; anything else a light wood
const MATERIALS = [
  [/walnut|dark/i, '#7b5538'],
  [/cherry|mahogany|red/i, '#a0613f'],
  [/oak/i, '#c9a571'],
  [/mdf|hardboard/i, '#b4966c'],
  [/cork/i, '#c49a6c'],
  [/felt|leather/i, '#8a6a52'],
  [/card|paper/i, '#ece6d8'],
  [/black/i, '#2b2b2b'],
  [/white/i, '#f1f1ee'],
  [/clear|acrylic|perspex|glass/i, '#cfe6ee'],
  [/birch|plywood|poplar|maple|wood|material/i, '#dcc39a'],
];
const HARDWARE = {
  dowel: '#e2c48f',
  brass: '#c9a227',
  screw: '#9aa0a6',
  bolt: '#9aa0a6',
  nut: '#9aa0a6',
  magnet: '#55585c',
  paper: '#fbfaf6',
  card: '#f4f1e8',
  elastic: '#262626',
  cord: '#b23a3a',
  ribbon: '#c2485a',
  white: '#f7f7f4',
};
const NAMED = {
  pink: '#f2a7c3',
  yellow: '#f5d76e',
  red: '#d9534f',
  green: '#6dbb6d',
  blue: '#5b8fd9',
  orange: '#f0a04b',
  purple: '#9b72cf',
  black: '#222222',
  grey: '#9a9a9a',
  gray: '#9a9a9a',
};

const colorOf = (material) => (MATERIALS.find(([re]) => re.test(material)) ?? [0, '#dcc39a'])[1];
const transparent = (material) => /clear|acrylic|perspex|glass/i.test(material);

// A part's flat shape, cut into pieces that bend smoothly, extruded and
// bent in its own coordinates
function partGeometry(part) {
  const t = part.thickness;
  const geos = [];
  for (const piece of meshPieces(part.outline, part.bends)) {
    const [outer, ...holes] = piece;
    const shape = new Shape(outer.map(([x, y]) => new Vector3(x, y, 0)));
    for (const h of holes) shape.holes.push(new Path(h.map(([x, y]) => new Vector3(x, y, 0))));
    geos.push(new ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 }));
  }
  return geos.map((g) => (part.bends?.length ? bent(g, part.bends, t) : g));
}

function bent(geo, bends, t) {
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = bendPoint(bends, t, [p.getX(i), p.getY(i), p.getZ(i)]);
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

// Engraving as a thin layer on the face, scoring as lines on it
function markObjects(part) {
  const out = [];
  const t = part.thickness;
  for (const m of part.marks ?? []) {
    const z = m.side === 'back' ? -0.05 : t + 0.05;
    const black = /^#0{6}$/i.test(m.color);
    if (m.mode === 'fill' && m.regions.length) {
      const color = black ? '#4a3220' : m.color;
      for (const piece of meshPieces(m.regions, part.bends)) {
        const [outer, ...holes] = piece;
        const shape = new Shape(outer.map(([x, y]) => new Vector3(x, y, 0)));
        for (const h of holes) shape.holes.push(new Path(h.map(([x, y]) => new Vector3(x, y, 0))));
        const g = new ShapeGeometry(shape, 1);
        const pos = g.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          const q = part.bends?.length
            ? bendPoint(part.bends, t, [pos.getX(i), pos.getY(i), z])
            : [pos.getX(i), pos.getY(i), z];
          pos.setXYZ(i, q[0], q[1], q[2]);
        }
        g.computeVertexNormals();
        out.push(
          new Mesh(g, new MeshStandardMaterial({ color, roughness: 0.95, side: DoubleSide })),
        );
      }
    }
    const lines = m.mode === 'line' ? [...m.lines, ...m.regions.map((r) => [...r, r[0]])] : m.lines;
    if (lines.length) {
      const pts = [];
      for (const l of lines)
        for (let i = 1; i < l.length; i++)
          for (const [x, y] of [l[i - 1], l[i]]) {
            const q = part.bends?.length ? bendPoint(part.bends, t, [x, y, z]) : [x, y, z];
            pts.push(q[0], q[1], q[2]);
          }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pts, 3));
      out.push(new LineSegments(g, new LineBasicMaterial({ color: black ? '#5b3d26' : m.color })));
    }
  }
  return out;
}

function hardwareObject(h) {
  const a = new Vector3(...h.from);
  const b = new Vector3(...h.to);
  const length = a.distanceTo(b);
  if (!(length > 0)) return null;
  const color = NAMED[h.kind] ?? HARDWARE[h.kind] ?? '#c8c8c8';
  const geo = Array.isArray(h.size)
    ? new BoxGeometry(h.size[0], length, h.size[1])
    : new CylinderGeometry(h.size / 2, h.size / 2, length, h.sides ?? 24);
  const mesh = new Mesh(
    geo,
    new MeshStandardMaterial({
      color,
      roughness: h.kind === 'brass' || h.kind === 'screw' ? 0.35 : 0.8,
      metalness: h.kind === 'brass' || h.kind === 'screw' ? 0.6 : 0,
    }),
  );
  // The box's y along the segment, its z along up
  const y = b.clone().sub(a).normalize();
  const up = new Vector3(...(h.up ?? [0, 0, 1]));
  let x = new Vector3().crossVectors(y, up);
  if (x.lengthSq() < 1e-9) x = new Vector3().crossVectors(y, new Vector3(1, 0, 0));
  x.normalize();
  const z = new Vector3().crossVectors(x, y).normalize();
  const m = new Matrix4().makeBasis(x, y, z);
  m.setPosition(a.clone().add(b).multiplyScalar(0.5));
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(m);
  return mesh;
}

const STYLE = `
.kv{position:relative;display:flex;flex-direction:column;gap:.5rem}
.kv-stage{position:relative;width:100%;aspect-ratio:4/3;border-radius:8px;overflow:hidden;background:var(--kv-bg,#f4f1ec)}
.kv-stage canvas{display:block;width:100%;height:100%;touch-action:none}
.kv-bar{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}
.kv-bar button{font:inherit;padding:.3rem .7rem;border-radius:6px;border:1px solid currentColor;background:none;color:inherit;cursor:pointer}
.kv-bar button[aria-pressed=true]{background:currentColor}
.kv-bar button[aria-pressed=true] span{color:var(--kv-bg,#f4f1ec)}
.kv-bar button:disabled{opacity:.35;cursor:default}
.kv-step{flex:1 1 14rem;margin:0;font-size:.95rem;min-height:1.4em}
.kv-empty{position:absolute;inset:0;display:grid;place-items:center;padding:1rem;text-align:center;color:#888}
.kv-checks{display:flex;flex-direction:column;gap:.35rem;font-size:.9rem}
.kv-checks button{font:inherit;text-align:left;border:1px solid #b88343;border-radius:5px;padding:.4rem .6rem;color:inherit;background:transparent;cursor:pointer}
.kv-checks button[data-status=fail]{border-color:#c84b3b}
.kv [hidden]{display:none!important}
@media (prefers-color-scheme: dark){.kv-stage{--kv-bg:#26231f}}
`;

export function createAssemblyView(el, options = {}) {
  if (!document.getElementById('kv-style'))
    document.head.append(
      Object.assign(document.createElement('style'), { id: 'kv-style', textContent: STYLE }),
    );
  el.classList.add('kv');
  el.innerHTML = `<div class="kv-stage"><div class="kv-empty" hidden></div></div>
<div class="kv-bar">
  <button type="button" data-kv="prev" aria-label="Previous step">◀</button>
  <button type="button" data-kv="next" aria-label="Next step">▶</button>
  <p class="kv-step" aria-live="polite"></p>
  <button type="button" data-kv="all"><span>Whole model</span></button>
  <button type="button" data-kv="front" aria-pressed="false"><span>Front view</span></button>
</div><div class="kv-checks" aria-live="polite" hidden></div>`;
  const stage = el.querySelector('.kv-stage');
  const empty = el.querySelector('.kv-empty');
  const label = el.querySelector('.kv-step');
  const checks = el.querySelector('.kv-checks');
  const btn = (k) => el.querySelector(`[data-kv="${k}"]`);

  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    empty.hidden = false;
    empty.textContent = 'This browser cannot show 3D views.';
    return { show() {}, verification() {}, dispose() {} };
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  stage.prepend(renderer.domElement);
  const scene = new Scene();
  scene.add(new HemisphereLight('#ffffff', '#b8a58c', 1.1));
  scene.add(new AmbientLight('#ffffff', 0.25));
  const sun = new DirectionalLight('#ffffff', 1.6);
  sun.position.set(-0.6, -1, 1.4);
  scene.add(sun);
  // KerfScript is z up
  const persp = new PerspectiveCamera(35, 4 / 3, 1, 1e5);
  persp.up.set(0, 0, 1);
  const ortho = new OrthographicCamera(-1, 1, 1, -1, -1e5, 1e5);
  ortho.up.set(0, 0, 1);
  let camera = persp;
  let controls = new OrbitControls(camera, renderer.domElement);
  controls.addEventListener('change', draw);
  const model = new Group();
  scene.add(model);

  let items = []; // { object, step, matrix }
  let steps = [];
  let current = 0; // 0: whole model
  let box = null;
  let anim = null;
  let front = false;

  function draw() {
    renderer.render(scene, camera);
  }

  function resize() {
    const w = stage.clientWidth || 600;
    const h = stage.clientHeight || 450;
    renderer.setSize(w, h, false);
    persp.aspect = w / h;
    persp.updateProjectionMatrix();
    frame();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(stage);

  // Fits the camera to the model
  function frame() {
    if (!box) return draw();
    const c = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const r = Math.max(size.length() / 2, 1);
    if (front) {
      const aspect = persp.aspect;
      const half = Math.max(size.z / 2, size.x / 2 / aspect) * 1.15;
      Object.assign(ortho, {
        left: -half * aspect,
        right: half * aspect,
        top: half,
        bottom: -half,
      });
      ortho.position.set(c.x, c.y - r * 4, c.z);
      ortho.updateProjectionMatrix();
    } else {
      const d = r / Math.sin((persp.fov * Math.PI) / 360);
      persp.position.copy(c).add(new Vector3(0.55, -1, 0.65).normalize().multiplyScalar(d * 1.05));
      persp.near = d / 100;
      persp.far = d * 20;
      persp.updateProjectionMatrix();
    }
    controls.target.copy(c);
    controls.update();
    draw();
  }

  function clear() {
    for (const it of items)
      it.object.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose?.();
      });
    model.clear();
    items = [];
  }

  function show(result) {
    checks.replaceChildren();
    checks.hidden = true;
    clear();
    const parts = (result.assembly ?? []).filter((p) => p.placed !== false);
    steps = result.steps ?? [];
    for (const part of parts) {
      const g = new Group();
      const color = colorOf(part.material ?? part.name);
      const clear_ = transparent(part.material ?? '');
      const face = new MeshStandardMaterial({
        color,
        roughness: 0.85,
        transparent: clear_,
        opacity: clear_ ? 0.55 : 1,
      });
      // Laser-cut edges come out darker
      const edge = new MeshStandardMaterial({
        color: new Color(color).multiplyScalar(0.55),
        roughness: 0.9,
        transparent: clear_,
        opacity: clear_ ? 0.55 : 1,
      });
      for (const geo of partGeometry(part)) g.add(new Mesh(geo, [face, edge]));
      for (const o of markObjects(part)) g.add(o);
      const m = new Matrix4().set(...part.matrix);
      g.matrixAutoUpdate = false;
      g.matrix.copy(m);
      g.userData = { face, base: m };
      model.add(g);
      items.push({
        object: g,
        step: part.step ?? 0,
        base: m,
        ref: { part: part.name, copy: part.copy },
      });
    }
    for (const h of result.hardware ?? []) {
      const o = hardwareObject(h);
      if (!o) continue;
      model.add(o);
      items.push({
        object: o,
        step: h.step ?? 0,
        base: o.matrix.clone(),
        ref: { hardware: h.label ?? '' },
      });
    }
    empty.hidden = items.length > 0;
    empty.textContent = 'Give parts at or rotate to see them assembled here.';
    model.updateMatrixWorld(true);
    box = items.length ? new Box().setFromObjects(items.map((i) => i.object)) : null;
    // Keep the step when the model changes but has as many
    if (current > steps.length) current = 0;
    setStep(current, false);
    frame();
  }

  function setStep(k, animate = true) {
    current = k;
    if (anim) cancelAnimationFrame(anim);
    const now = items.filter((i) => k !== 0 && i.step === k);
    for (const it of items) {
      it.object.traverse((o) => {
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const material of materials) material?.emissive?.set('#000000');
      });
      it.object.visible = k === 0 || it.step <= k;
      it.object.matrix.copy(it.base);
      const f = it.object.userData.face;
      if (f) f.emissive?.set(k !== 0 && it.step === k ? '#3a2a10' : '#000000');
    }
    btn('prev').disabled = !steps.length || k === 1;
    btn('next').disabled = !steps.length || k === steps.length;
    btn('prev').hidden = btn('next').hidden = !steps.length;
    btn('all').hidden = !steps.length;
    btn('all').setAttribute('aria-pressed', String(k === 0));
    label.textContent = !steps.length
      ? ''
      : k === 0
        ? `${steps.length} step${steps.length > 1 ? 's' : ''}: press ▶ to build it`
        : `Step ${k} of ${steps.length}: ${steps[k - 1]}`;
    // The new parts come down into place
    if (animate && now.length && box) {
      const lift = box.getSize(new Vector3()).length() * 0.25;
      const start = performance.now();
      const tick = (time) => {
        const u = Math.min(1, (time - start) / 700);
        const e = 1 - (1 - u) ** 3;
        for (const it of now)
          it.object.matrix.copy(
            new Matrix4().makeTranslation(0, 0, lift * (1 - e)).multiply(it.base),
          );
        draw();
        anim = u < 1 ? requestAnimationFrame(tick) : null;
      };
      anim = requestAnimationFrame(tick);
    } else draw();
  }

  function verification(report, configuration) {
    const findings = verificationFindings(
      report,
      configuration,
      items.map((i) => i.ref),
    );
    checks.replaceChildren();
    checks.hidden = !findings.length;
    for (const finding of findings) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.status = finding.status;
      button.textContent = `${finding.status === 'fail' ? 'Failed' : 'Unverified'}: ${finding.message}`;
      button.addEventListener('click', () => {
        setStep(0, false);
        const selected = new Set(finding.references.map(referenceKey));
        for (const item of items)
          item.object.traverse((o) => {
            const materials = Array.isArray(o.material) ? o.material : [o.material];
            for (const material of materials)
              material?.emissive?.set(
                selected.has(referenceKey(item.ref))
                  ? finding.status === 'fail'
                    ? '#713020'
                    : '#64501e'
                  : '#000000',
              );
          });
        options.onVerificationSelect?.(finding);
        draw();
      });
      checks.append(button);
    }
  }

  btn('prev').addEventListener('click', () => setStep(Math.max(1, current - 1)));
  btn('next').addEventListener('click', () => setStep(Math.min(steps.length, current + 1)));
  btn('all').addEventListener('click', () => setStep(0));
  btn('front').addEventListener('click', () => {
    front = !front;
    btn('front').setAttribute('aria-pressed', String(front));
    controls.dispose();
    camera = front ? ortho : persp;
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = !front;
    controls.addEventListener('change', draw);
    frame();
  });

  return {
    show,
    verification,
    step: setStep,
    dispose() {
      observer.disconnect();
      clear();
      controls.dispose();
      renderer.dispose();
    },
  };
}

// Box3 from objects with matrices set by hand
class Box {
  constructor() {
    this.min = new Vector3(Infinity, Infinity, Infinity);
    this.max = new Vector3(-Infinity, -Infinity, -Infinity);
  }
  setFromObjects(objects) {
    const v = new Vector3();
    for (const o of objects)
      o.traverse((c) => {
        const p = c.geometry?.getAttribute('position');
        if (!p) return;
        for (let i = 0; i < p.count; i += Math.max(1, Math.floor(p.count / 400))) {
          v.fromBufferAttribute(p, i).applyMatrix4(c.matrixWorld);
          this.min.min(v);
          this.max.max(v);
        }
      });
    return this;
  }
  getCenter(t) {
    return t.copy(this.min).add(this.max).multiplyScalar(0.5);
  }
  getSize(t) {
    return t.copy(this.max).sub(this.min);
  }
}
