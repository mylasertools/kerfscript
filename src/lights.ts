// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Light sources in the assembly: what tealights, LEDs and bulbs give off,
// and light(). The 3D view lights the model with them, and GLB files
// carry them as point lights.

import type { Move } from './assembly.js';
import type { HardwareItem } from './evaluator.js';
import { paintColor } from './colors.js';

type Vec3 = [number, number, number];

export interface Light {
  /** A point light at from, or light all along a strip from `from` to `to` */
  from: Vec3;
  to: Vec3;
  /** #rrggbb */
  color: string;
  /** Light given off in all, in lumens (a tealight is about 12) */
  lumens: number;
  /** A flame: it flickers in the 3D view */
  flicker: boolean;
  /** What gives it off: "tealight", "led", "bulb", or "light" for light() */
  source: string;
  /** The assembly step that adds it, 0 for none */
  step: number;
  label?: string;
  /** How it moves when the model is opened, from hinge() and slide() */
  moves?: Move[];
}

/** Colours a light may be named by, besides the paint colours */
export const LIGHT_COLORS: Record<string, string> = {
  flame: '#ff9a3c',
  candle: '#ff9a3c',
  warm: '#ffc27a',
  'warm white': '#ffd9a0',
  white: '#fff4e5',
  'cool white': '#eef3ff',
};

/** A light's colour as #rrggbb, from a name or a hex colour */
export function lightColor(v: string): string | undefined {
  const s = v.trim().toLowerCase().replace(/\s+/g, ' ');
  return LIGHT_COLORS[s] ?? paintColor(s);
}

/** A tealight: a cup 39 mm across and 16 mm high, its flame 10 mm above */
export const TEALIGHT = { diameter: 39, height: 16, flame: 10 };

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** The light a piece of hardware gives off: a tealight's flame, an LED or
 * a strip of them, a bulb */
export function hardwareLights(h: HardwareItem): Light[] {
  const base = {
    step: h.step,
    ...(h.label !== undefined && { label: h.label }),
    ...(h.moves && { moves: h.moves }),
  };
  const d = sub(h.to, h.from);
  const l = len(d);
  if (h.kind === 'tealight') {
    // The flame stands above the cup, along it from `from` to `to`
    const u: Vec3 = l > 0 ? [d[0] / l, d[1] / l, d[2] / l] : [0, 0, 1];
    const at: Vec3 = [
      h.to[0] + u[0] * TEALIGHT.flame,
      h.to[1] + u[1] * TEALIGHT.flame,
      h.to[2] + u[2] * TEALIGHT.flame,
    ];
    return [
      {
        from: at,
        to: at,
        color: LIGHT_COLORS.flame,
        lumens: 12,
        flicker: true,
        source: 'tealight',
        ...base,
      },
    ];
  }
  if (h.kind === 'led') {
    // A strip longer than 20 mm lights all along; a single LED is a point
    const strip = l > 20;
    const m = mid(h.from, h.to);
    return [
      {
        from: strip ? h.from : m,
        to: strip ? h.to : m,
        color: LIGHT_COLORS['warm white'],
        lumens: strip ? Math.round(l * 2) / 10 : 20,
        flicker: false,
        source: 'led',
        ...base,
      },
    ];
  }
  if (h.kind === 'bulb') {
    const m = mid(h.from, h.to);
    return [
      {
        from: m,
        to: m,
        color: LIGHT_COLORS['warm white'],
        lumens: 100,
        flicker: false,
        source: 'bulb',
        ...base,
      },
    ];
  }
  return [];
}

/** Points that stand for a light: the point itself, or up to `max` evenly
 * along a strip, sharing its lumens */
export function lightPoints(light: Light, max = 8): { at: Vec3; lumens: number }[] {
  const d = sub(light.to, light.from);
  const l = len(d);
  if (!(l > 0)) return [{ at: light.from, lumens: light.lumens }];
  const n = Math.max(2, Math.min(max, Math.ceil(l / 50)));
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n;
    return {
      at: [light.from[0] + d[0] * t, light.from[1] + d[1] * t, light.from[2] + d[2] * t] as Vec3,
      lumens: light.lumens / n,
    };
  });
}
