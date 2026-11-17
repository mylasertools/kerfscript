// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// 3D files of a rendered model: GLB (glTF 2.0) for viewers, Blender and the
// web, 3MF for 3D printing in colour, STL for a single mesh.

import { meshBodies, type Body, type MeshOptions, type MeshSource } from './mesh.js';
import { lightPoints, type Light } from '../lights.js';
import { zip } from './zip.js';

export type ModelFormat = 'glb' | '3mf' | 'stl';

const hex = (c: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  const n = m ? parseInt(m[1], 16) : 0xc8c8c8;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const num = (v: number) => {
  const s = (Math.abs(v) < 5e-7 ? 0 : v).toFixed(4);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
};

const copyName = (b: Body) => (b.copy && b.copy > 1 ? `${b.name} (${b.copy})` : b.name);

function triangleNormal(p: number[], a: number, b: number, c: number): [number, number, number] {
  const ux = p[b * 3] - p[a * 3];
  const uy = p[b * 3 + 1] - p[a * 3 + 1];
  const uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3];
  const vy = p[c * 3 + 1] - p[a * 3 + 1];
  const vz = p[c * 3 + 2] - p[a * 3 + 2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/** Binary STL of all the bodies as one mesh, in millimetres */
export function toStl(bodies: Body[]): Uint8Array {
  const count = bodies.reduce((s, b) => s + b.indices.length / 3, 0);
  const view = new DataView(new ArrayBuffer(84 + 50 * count));
  const head = new TextEncoder().encode('KerfScript model, millimetres');
  new Uint8Array(view.buffer).set(head.slice(0, 80));
  view.setUint32(80, count, true);
  let at = 84;
  for (const b of bodies)
    for (let i = 0; i < b.indices.length; i += 3) {
      const [a, c, d] = [b.indices[i], b.indices[i + 1], b.indices[i + 2]];
      for (const v of triangleNormal(b.positions, a, c, d)) {
        view.setFloat32(at, v, true);
        at += 4;
      }
      for (const k of [a, c, d])
        for (let j = 0; j < 3; j++) {
          view.setFloat32(at, b.positions[k * 3 + j], true);
          at += 4;
        }
      at += 2;
    }
  return new Uint8Array(view.buffer);
}

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A 3MF package in millimetres: each part one object, its engraving and
 * scoring coloured parts of it, so a slicer prints them in their colours */
export function to3mf(bodies: Body[]): Uint8Array {
  const colours: string[] = [];
  const colourIndex = (b: Body) => {
    const key = `${b.material}\u0000${b.color}`;
    let i = colours.indexOf(key);
    if (i < 0) i = colours.push(key) - 1;
    return i;
  };
  const objects: string[] = [];
  const items: string[] = [];
  // Bodies of one part copy together, the part first; hardware alone
  const groups = new Map<string, Body[]>();
  bodies.forEach((b, i) => {
    const key = b.instance === undefined ? `h${i}` : `p${b.instance}`;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  });
  let id = 2;
  for (const group of groups.values()) {
    const ids: number[] = [];
    for (const b of group) {
      const vs: string[] = [];
      for (let i = 0; i < b.positions.length; i += 3)
        vs.push(
          `<vertex x="${num(b.positions[i])}" y="${num(b.positions[i + 1])}" z="${num(b.positions[i + 2])}"/>`,
        );
      const ts: string[] = [];
      for (let i = 0; i < b.indices.length; i += 3)
        ts.push(
          `<triangle v1="${b.indices[i]}" v2="${b.indices[i + 1]}" v3="${b.indices[i + 2]}"/>`,
        );
      objects.push(
        `<object id="${id}" type="model" name="${xml(copyName(b))}" pid="1" pindex="${colourIndex(b)}"><mesh><vertices>${vs.join('')}</vertices><triangles>${ts.join('')}</triangles></mesh></object>`,
      );
      ids.push(id++);
    }
    if (ids.length === 1) items.push(`<item objectid="${ids[0]}"/>`);
    else {
      objects.push(
        `<object id="${id}" type="model" name="${xml(copyName(group[0]))}"><components>${ids.map((i) => `<component objectid="${i}"/>`).join('')}</components></object>`,
      );
      items.push(`<item objectid="${id++}"/>`);
    }
  }
  const bases = colours
    .map((k) => {
      const [name, color] = k.split('\u0000');
      const [r, g, b] = hex(color);
      const c = [r, g, b]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
      return `<base name="${xml(name)}" displaycolor="#${c}FF"/>`;
    })
    .join('');
  const model =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    '<metadata name="Application">KerfScript</metadata>' +
    `<resources><basematerials id="1">${bases}</basematerials>${objects.join('')}</resources>` +
    `<build>${items.join('')}</build></model>\n`;
  const enc = new TextEncoder();
  return zip([
    {
      name: '[Content_Types].xml',
      data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n',
      ),
    },
    {
      name: '_rels/.rels',
      data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n',
      ),
    },
    { name: '3D/3dmodel.model', data: enc.encode(model) },
  ]);
}

// sRGB 0-255 to the linear values glTF colours are in
const linear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

/** GLB (binary glTF 2.0): a node and a mesh for each body, in metres with
 * y up as glTF has it; each node's extras give its kind, part and copy.
 * Lights become point lights (KHR_lights_punctual), a strip several. */
export function toGlb(bodies: Body[], lights: Light[] = []): Uint8Array {
  const buffers: Uint8Array[] = [];
  let length = 0;
  const views: object[] = [];
  const accessors: object[] = [];
  const meshes: object[] = [];
  const nodes: object[] = [];
  const materials: object[] = [];
  const materialKeys: string[] = [];
  const add = (data: Float32Array) => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, target: 34962 });
    buffers.push(bytes);
    length += bytes.length;
    return views.length - 1;
  };
  for (const b of bodies) {
    if (!b.indices.length) continue;
    const n = b.indices.length;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    // Each triangle its own corners, so faces stay flat; millimetres z up
    // to metres y up
    for (let i = 0; i < n; i += 3) {
      const [a, c, d] = [b.indices[i], b.indices[i + 1], b.indices[i + 2]];
      const [nx, ny, nz] = triangleNormal(b.positions, a, c, d);
      [a, c, d].forEach((k, j) => {
        const x = b.positions[k * 3] / 1000;
        const y = b.positions[k * 3 + 2] / 1000;
        const z = -b.positions[k * 3 + 1] / 1000;
        const o = (i + j) * 3;
        pos.set([x, y, z], o);
        nor.set([nx, nz, -ny], o);
        [x, y, z].forEach((v, q) => {
          lo[q] = Math.min(lo[q], v);
          hi[q] = Math.max(hi[q], v);
        });
      });
    }
    const pv = add(pos);
    accessors.push({
      bufferView: pv,
      componentType: 5126,
      count: n,
      type: 'VEC3',
      min: lo,
      max: hi,
    });
    const nv = add(nor);
    accessors.push({ bufferView: nv, componentType: 5126, count: n, type: 'VEC3' });
    const key = `${b.material}\u0000${b.color}\u0000${b.metal ? 1 : 0}\u0000${b.clear ? 1 : 0}\u0000${b.glow ? 1 : 0}\u0000${b.translucent ? 1 : 0}`;
    let m = materialKeys.indexOf(key);
    if (m < 0) {
      const [r, g, bl] = hex(b.color);
      materials.push({
        name: b.material,
        pbrMetallicRoughness: {
          baseColorFactor: [
            linear(r),
            linear(g),
            linear(bl),
            b.clear ? 0.45 : b.translucent ? 0.75 : 1,
          ],
          metallicFactor: b.metal ? 0.6 : 0,
          roughnessFactor: b.metal ? 0.35 : 0.85,
        },
        ...((b.clear || b.translucent) && { alphaMode: 'BLEND', doubleSided: true }),
        // Light comes through: a renderer lights it from behind
        ...(b.translucent && {
          extensions: { KHR_materials_transmission: { transmissionFactor: 0.5 } },
        }),
        ...(b.glow && { emissiveFactor: [linear(r), linear(g), linear(bl)] }),
      });
      m = materialKeys.push(key) - 1;
    }
    meshes.push({
      name: copyName(b),
      primitives: [
        {
          attributes: { POSITION: accessors.length - 2, NORMAL: accessors.length - 1 },
          material: m,
        },
      ],
    });
    nodes.push({
      name: copyName(b),
      mesh: meshes.length - 1,
      extras: {
        kind: b.kind,
        material: b.material,
        ...(b.part !== undefined && { part: b.part, copy: b.copy }),
      },
    });
  }
  // A point light's intensity is in candela: lumens spread over a sphere
  const punctual: object[] = [];
  for (const l of lights) {
    const [r, g, bl] = hex(l.color);
    for (const { at, lumens } of lightPoints(l)) {
      punctual.push({
        type: 'point',
        color: [linear(r), linear(g), linear(bl)],
        intensity: lumens / (4 * Math.PI),
      });
      nodes.push({
        name: l.label ?? l.source,
        translation: [at[0] / 1000 + 0, at[2] / 1000 + 0, -at[1] / 1000 + 0],
        extensions: { KHR_lights_punctual: { light: punctual.length - 1 } },
        extras: { kind: 'light', source: l.source, flicker: l.flicker, lumens },
      });
    }
  }
  const used = [
    ...(punctual.length ? ['KHR_lights_punctual'] : []),
    ...(bodies.some((b) => b.translucent && b.indices.length)
      ? ['KHR_materials_transmission']
      : []),
  ];
  const gltf = {
    asset: { version: '2.0', generator: 'KerfScript' },
    ...(used.length && { extensionsUsed: used }),
    ...(punctual.length && { extensions: { KHR_lights_punctual: { lights: punctual } } }),
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: length }],
  };
  const enc = new TextEncoder();
  const json = enc.encode(JSON.stringify(gltf));
  const jsonPad = (4 - (json.length % 4)) % 4;
  const binPad = (4 - (length % 4)) % 4;
  const total = 12 + 8 + json.length + jsonPad + 8 + length + binPad;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, json.length + jsonPad, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  out.fill(0x20, 20 + json.length, 20 + json.length + jsonPad);
  let at = 20 + json.length + jsonPad;
  v.setUint32(at, length + binPad, true);
  v.setUint32(at + 4, 0x004e4942, true);
  at += 8;
  for (const b of buffers) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

/** The model as a 3D file: "glb", "3mf" or "stl" */
export function toModel(
  source: MeshSource,
  format: ModelFormat,
  options: MeshOptions = {},
): Uint8Array {
  const bodies = meshBodies(source, options);
  if (format === 'stl') return toStl(bodies);
  if (format === '3mf') return to3mf(bodies);
  // Lights stand where the assembly has them, so only there
  const assembled = (options.layout ?? 'assembled') === 'assembled' && source.assembly.length > 0;
  return toGlb(bodies, assembled && options.hardware !== false ? (source.lights ?? []) : []);
}
