// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Paint colours by name, for part(paint = ...) and a layer's colour: the
// colour a painted part or area shows in the 3D view and the print layout
export const PAINT_COLORS: Record<string, string> = {
  red: '#c8372d',
  orange: '#e8742a',
  yellow: '#f2c230',
  green: '#3f8f4a',
  'dark green': '#24582f',
  'light green': '#8cc06a',
  blue: '#2f64b5',
  'dark blue': '#1d3570',
  'light blue': '#86b6e3',
  navy: '#1f2d55',
  teal: '#2a8c88',
  purple: '#7a4aa0',
  pink: '#ec8fb2',
  brown: '#7a4e2d',
  tan: '#d2b48c',
  cream: '#f3e9cf',
  white: '#f7f7f4',
  black: '#222222',
  grey: '#8f8f8f',
  gray: '#8f8f8f',
  silver: '#c0c4c8',
  gold: '#c9a227',
  copper: '#b87333',
  skin: '#f1c9a5',
  'light grey': '#cfcfca',
  'light gray': '#cfcfca',
  'dark grey': '#4a4a4a',
  'dark gray': '#4a4a4a',
  'light brown': '#b07f4f',
  'dark brown': '#4a2e1a',
  beige: '#e9d6b4',
  peach: '#f6b892',
  'light pink': '#f8cbd8',
  maroon: '#7a1f2b',
  'light yellow': '#f8e48a',
  lime: '#9ccc3c',
  olive: '#6b7a2f',
};

/** A colour as "#rrggbb": a hex colour as it is (lower case), or one of
 * PAINT_COLORS by name; undefined for anything else */
export function paintColor(v: string): string | undefined {
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  return PAINT_COLORS[s.replace(/\s+/g, ' ')];
}
