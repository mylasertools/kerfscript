// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// The kinds of hardware() a model can list, with how viewers and renders
// show them. A kind outside the list (or the named colours) warns.

export interface HardwareKind {
  /** Colour as #rrggbb */
  color: string;
  /** Metal: shiny in the 3D view */
  metal?: boolean;
  /** Gives off light, as an LED */
  glow?: boolean;
  /** What it is, for the docs */
  doc: string;
}

export const HARDWARE_KINDS: Record<string, HardwareKind> = {
  dowel: { color: '#e2c48f', doc: 'a wooden dowel or axle' },
  steel: { color: '#a7adb3', metal: true, doc: 'a steel rod, pin or axle' },
  brass: { color: '#c9a227', metal: true, doc: 'a brass rod, tube or pin' },
  screw: { color: '#9aa0a6', metal: true, doc: 'a screw' },
  bolt: { color: '#9aa0a6', metal: true, doc: 'a bolt' },
  nut: { color: '#9aa0a6', metal: true, doc: 'a nut' },
  magnet: { color: '#55585c', metal: true, doc: 'a disc or block magnet' },
  paper: { color: '#fbfaf6', doc: 'a sheet or strip of paper' },
  card: { color: '#f4f1e8', doc: 'card stock' },
  felt: { color: '#6f6a64', doc: 'felt pads or lining' },
  elastic: { color: '#262626', doc: 'an elastic band or cord' },
  cord: { color: '#b23a3a', doc: 'cord, string or thread' },
  ribbon: { color: '#c2485a', doc: 'ribbon or tape' },
  wire: { color: '#b87333', metal: true, doc: 'wire' },
  led: { color: '#fff4c2', glow: true, doc: 'an LED or a strip of them' },
  bulb: { color: '#fff4c2', glow: true, doc: 'a light bulb; give it shape = "ball"' },
  ball: { color: '#8fb8d8', doc: 'a marble, ball or bead; give it shape = "ball"' },
  tube: { color: '#c9a227', metal: true, doc: 'a tube, as a hollow arbor or a sleeve' },
  lens: { color: '#d6ecf3', doc: 'a lens, a thin disc of glass or acrylic' },
  mirror: { color: '#c8d3da', metal: true, doc: 'a mirror' },
  movement: {
    color: '#3d3d3d',
    doc: 'a bought movement, as a clock, music box or motor: a labelled block',
  },
  white: { color: '#f7f7f4', doc: 'anything white' },
};

/** Colours a hardware kind may also be named by */
export const HARDWARE_COLORS: Record<string, string> = {
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
