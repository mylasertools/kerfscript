// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Every built-in module and function: its parameters, their defaults and a
// line of documentation. The interpreter checks arguments against it, and
// editors read it for hover, completion and parameter hints. Tests keep it
// in step with the interpreter, the highlighter, the VS Code grammar and
// LANGUAGE.md.

export interface ParamInfo {
  name: string;
  // The default as KerfScript source, when there is one
  default?: string;
  // Given only by name, not by position
  named?: boolean;
  doc?: string;
}

export interface Signature {
  name: string;
  // A module makes shapes, a function returns a value; echo and assert are both
  kind: 'module' | 'function' | 'both';
  params: ParamInfo[];
  // Takes any number of positional values after the parameters
  rest?: boolean;
  // Takes any named arguments, as echo() writes them all
  anyNamed?: boolean;
  // Works on its child statements
  children?: boolean;
  // Other ways to call it, as source
  forms?: string[];
  // The LANGUAGE.md section that documents it
  section: string;
  doc: string;
}

const p = (name: string, doc?: string, def?: string): ParamInfo => ({
  name,
  ...(def !== undefined && { default: def }),
  ...(doc && { doc }),
});
const named = (name: string, doc?: string, def?: string): ParamInfo => ({
  ...p(name, doc, def),
  named: true,
});

const FINGER = 'max(3 * $thickness, 6)';
const value = [p('value')];
const x = [p('x')];

const math = (name: string, doc: string): Signature => ({
  name,
  kind: 'function',
  params: x,
  section: 'Numbers and vectors',
  doc,
});
const is = (name: string, type: string): Signature => ({
  name,
  kind: 'function',
  params: value,
  section: 'Types',
  doc: `Whether the value is ${type}`,
});
const text = (name: string, doc: string): Signature => ({
  name,
  kind: 'function',
  params: [
    p('text', 'The text to measure', '""'),
    p('size', 'Font size in millimetres', '10'),
    p('font', 'Font name', '$font'),
    named('halign', 'left, center or right', '"left"'),
    named('valign', 'baseline, top, center or bottom', '"baseline"'),
    named('spacing', 'Letter spacing factor', '1'),
  ],
  section: 'Text measurements',
  doc,
});

export const SIGNATURES: Signature[] = [
  // Shapes
  {
    name: 'rect',
    kind: 'module',
    params: [
      p('size', 'A number, or [width, height]', '1'),
      p('center', 'Centre the rectangle on the origin instead of its corner', 'false'),
      named('r', 'Corner radius', '0'),
    ],
    section: 'Shapes',
    doc: 'A rectangle with its corner at the origin',
  },
  {
    name: 'square',
    kind: 'module',
    params: [
      p('size', 'A number, or [width, height]', '1'),
      p('center', 'Centre the square on the origin instead of its corner', 'false'),
      named('r', 'Corner radius', '0'),
    ],
    section: 'Shapes',
    doc: 'Another name for rect()',
  },
  {
    name: 'circle',
    kind: 'module',
    params: [p('r', 'Radius', '1'), named('d', 'Diameter, instead of r')],
    section: 'Shapes',
    doc: 'A circle centred on the origin',
  },
  {
    name: 'ellipse',
    kind: 'module',
    params: [p('r', '[rx, ry], or one radius for both', '1')],
    section: 'Shapes',
    doc: 'An ellipse centred on the origin',
  },
  {
    name: 'regular_polygon',
    kind: 'module',
    params: [p('n', 'Number of corners', '6'), p('r', 'Distance to the corners', '10')],
    section: 'Shapes',
    doc: 'A regular polygon centred on the origin',
  },
  {
    name: 'star',
    kind: 'module',
    params: [
      p('n', 'Number of points', '5'),
      p('r', 'Radius of the points', '10'),
      p('inner', 'Radius between the points', 'r * 0.45'),
    ],
    section: 'Shapes',
    doc: 'A star centred on the origin',
  },
  {
    name: 'polygon',
    kind: 'module',
    params: [
      p('points', 'A list of [x, y] points'),
      p('paths', 'Lists of point indexes, one per outline; holes come from even-odd fill'),
    ],
    section: 'Shapes',
    doc: 'A shape from a list of points',
  },
  {
    name: 'path',
    kind: 'module',
    params: [
      p('d', 'SVG path data, as "M0 0 L10 0 L5 8 Z"'),
      named('fill', '"evenodd" or "nonzero"', '"evenodd"'),
    ],
    section: 'Shapes',
    doc: 'Shapes from SVG path data: closed subpaths become areas, open ones lines',
  },
  {
    name: 'text',
    kind: 'module',
    params: [
      p('text', 'The text', '""'),
      p('size', 'Font size in millimetres', '10'),
      p('font', 'Font name', '$font'),
      named('halign', 'left, center or right', '"left"'),
      named('valign', 'baseline, top, center or bottom', '"baseline"'),
      named('spacing', 'Letter spacing factor', '1'),
    ],
    section: 'Shapes',
    doc: 'Text as shapes; the font must be available to the renderer',
  },
  {
    name: 'line',
    kind: 'module',
    params: [p('from', 'Start point', '[0, 0]'), p('to', 'End point', '[10, 0]')],
    section: 'Shapes',
    doc: 'A straight line, not an area',
  },
  {
    name: 'polyline',
    kind: 'module',
    params: [
      p('points', 'A list of [x, y] points'),
      p('closed', 'Join the last point to the first', 'false'),
    ],
    section: 'Shapes',
    doc: 'Lines through a list of points',
  },
  {
    name: 'arc',
    kind: 'module',
    params: [
      p('r', 'Radius', '10'),
      p('start', 'Start angle in degrees', '0'),
      p('end', 'End angle in degrees', '90'),
    ],
    section: 'Shapes',
    doc: 'An arc line around the origin',
  },

  // Transforms
  {
    name: 'translate',
    kind: 'module',
    params: [p('v', '[x, y]', '[0, 0]')],
    children: true,
    section: 'Transforms',
    doc: 'Move the children by x and y',
  },
  {
    name: 'rotate',
    kind: 'module',
    params: [
      p('a', 'Angle in degrees, anticlockwise', '0'),
      named('center', 'The point to turn around, [x, y]'),
    ],
    children: true,
    section: 'Transforms',
    doc: 'Rotate the children around the origin or a point',
  },
  {
    name: 'scale',
    kind: 'module',
    params: [p('v', 'One factor, or [sx, sy]', '1')],
    children: true,
    section: 'Transforms',
    doc: 'Scale the children',
  },
  {
    name: 'mirror',
    kind: 'module',
    params: [p('v', '[nx, ny], perpendicular to the mirror line', '[1, 0]')],
    children: true,
    section: 'Transforms',
    doc: 'Reflect the children across a line through the origin',
  },
  {
    name: 'multmatrix',
    kind: 'module',
    params: [p('m', 'A 2 × 3 or 3 × 3 matrix')],
    children: true,
    section: 'Transforms',
    doc: 'Apply a transformation matrix to the children',
  },

  // Combining
  {
    name: 'union',
    kind: 'module',
    params: [],
    children: true,
    section: 'Combining',
    doc: 'Join the children',
  },
  {
    name: 'group',
    kind: 'module',
    params: [],
    children: true,
    section: 'Combining',
    doc: 'Another name for union()',
  },
  {
    name: 'difference',
    kind: 'module',
    params: [],
    children: true,
    section: 'Combining',
    doc: "Remove every later child's area from every layer of the first child",
  },
  {
    name: 'intersection',
    kind: 'module',
    params: [],
    children: true,
    section: 'Combining',
    doc: 'Keep only the area common to all children',
  },
  {
    name: 'hull',
    kind: 'module',
    params: [],
    children: true,
    section: 'Combining',
    doc: 'The convex hull of the children; each part inside gets its own',
  },
  {
    name: 'offset',
    kind: 'module',
    params: [
      p('r', 'Grow (positive) or shrink areas with rounded corners'),
      named('delta', 'Grow or shrink areas with sharp corners', '0'),
      named('chamfer', 'Cut the corners off when growing by delta', 'false'),
    ],
    children: true,
    section: 'Combining',
    doc: 'Grow or shrink the areas of the children',
  },
  {
    name: 'stroke',
    kind: 'module',
    params: [p('width', 'Width of the area around each line', '1')],
    children: true,
    section: 'Combining',
    doc: 'Turn lines into areas, for cutting single-line art',
  },
  {
    name: 'outline',
    kind: 'module',
    params: [],
    children: true,
    section: 'Combining',
    doc: 'Turn areas into their outline lines',
  },

  // Layers and parts
  {
    name: 'cut',
    kind: 'module',
    params: [],
    children: true,
    section: 'Layers',
    doc: 'Put the children on the cut layer',
  },
  {
    name: 'score',
    kind: 'module',
    params: [],
    children: true,
    section: 'Layers',
    doc: 'Put the children on the score layer: lines marked without cutting through',
  },
  {
    name: 'engrave',
    kind: 'module',
    params: [],
    children: true,
    section: 'Layers',
    doc: 'Put the children on the engrave layer: areas filled in',
  },
  {
    name: 'guide',
    kind: 'module',
    params: [],
    children: true,
    section: 'Layers',
    doc: 'Put the children on the guide layer, which is not cut',
  },
  {
    name: 'layer',
    kind: 'module',
    params: [
      p('name', 'Layer name'),
      p('mode', '"cut", "line", "fill" or "guide"'),
      p('color', 'Colour in the output, as "#00aa00"'),
    ],
    children: true,
    section: 'Layers',
    doc: 'Put the children on a layer, defining it on first use',
  },
  {
    name: 'part',
    kind: 'module',
    params: [
      p('name', 'Part name', '"part"'),
      p('qty', 'Number of copies to cut', '1'),
      named('at', 'Where the part goes in the assembled view, [x, y, z]'),
      named('rotate', 'How the part is turned in the assembled view, [x, y, z] in degrees'),
    ],
    children: true,
    section: 'Parts and sheets',
    doc: 'A named part, with its thickness, kerf and material',
  },
  {
    name: 'material',
    kind: 'module',
    params: [
      p('thickness', 'Sets $thickness'),
      p('kerf', 'Sets $kerf'),
      p('name', 'Sets $material'),
    ],
    children: true,
    section: 'Parts and sheets',
    doc: 'Set the thickness, kerf and material name for the children',
  },

  // Joinery
  {
    name: 'finger_rect',
    kind: 'module',
    params: [
      p('size', '[width, height]'),
      p('edges', '"out", "in" or "flat", or [bottom, right, top, left]', '"out"'),
      p('finger', 'Finger width', FINGER),
    ],
    section: 'Joinery',
    doc: 'A rectangle with finger joints, notched $thickness deep',
  },
  {
    name: 'finger_holes',
    kind: 'module',
    params: [
      p('length', 'Length of the edge that plugs in'),
      p('edge', '"out" or "in", the kind of edge that plugs in', '"out"'),
      p('finger', 'Finger width', FINGER),
    ],
    section: 'Joinery',
    doc: 'A row of slots along x for a finger edge to plug into',
  },
  {
    name: 'tslot',
    kind: 'module',
    params: [
      p('d', 'Screw diameter', '3'),
      p('length', 'Screw length into the panel', '12'),
      p('nut', 'Nut size, [width, height]', '[d * 1.85, d * 0.8]'),
      p('nut_at', 'Distance of the nut from the edge', 'length / 2'),
    ],
    section: 'Joinery',
    doc: 'A T-slot for a screw and nut, opening at y = 0; subtract it from a panel edge',
  },
  {
    name: 'living_hinge',
    kind: 'module',
    params: [
      p('size', '[width, height]'),
      p('spacing', 'Distance between the rows of cuts', '1.5'),
      p('bridge', 'Uncut length between cuts', '3'),
      p('cut', 'Length of each cut', 'max(bridge * 2, (height - 3 * bridge) / 2)'),
    ],
    section: 'Joinery',
    doc: 'A straight-line flex pattern of cut lines filling [width, height]',
  },

  // Other
  {
    name: 'children',
    kind: 'module',
    params: [p('index', 'Which child, from 0, or a list of them')],
    section: 'Other',
    doc: 'Run the child statements passed to the current module',
  },
  {
    name: 'echo',
    kind: 'both',
    params: [],
    rest: true,
    anyNamed: true,
    section: 'Other',
    doc: 'Write values to the output without making shapes',
  },
  {
    name: 'assert',
    kind: 'both',
    params: [p('condition', 'Stops the program when false'), p('message', 'Says why')],
    section: 'Other',
    doc: 'Stop with an error when the condition is false',
  },

  // Numbers and vectors
  math('abs', 'Absolute value'),
  math('sign', 'Sign as -1, 0 or 1'),
  math('floor', 'Round down'),
  math('ceil', 'Round up'),
  math('round', 'Round to the nearest integer, halves away from zero'),
  math('sqrt', 'Square root'),
  math('exp', 'e raised to x'),
  math('ln', 'Natural logarithm'),
  {
    name: 'log',
    kind: 'function',
    params: [p('x'), p('base', undefined, '10')],
    forms: ['log(x)', 'log(base, x)'],
    section: 'Numbers and vectors',
    doc: 'Logarithm, base 10 or a chosen base; with two values the base comes first',
  },
  math('sin', 'Sine of an angle in degrees'),
  math('cos', 'Cosine of an angle in degrees'),
  math('tan', 'Tangent of an angle in degrees'),
  math('asin', 'Inverse sine, in degrees'),
  math('acos', 'Inverse cosine, in degrees'),
  math('atan', 'Inverse tangent, in degrees'),
  {
    name: 'atan2',
    kind: 'function',
    params: [p('y'), p('x')],
    section: 'Numbers and vectors',
    doc: 'The angle of the point [x, y] from the x axis, in degrees',
  },
  {
    name: 'pow',
    kind: 'function',
    params: [p('x'), p('y')],
    section: 'Numbers and vectors',
    doc: 'x raised to y',
  },
  {
    name: 'min',
    kind: 'function',
    params: [p('values', 'A list, or the first of several values')],
    rest: true,
    section: 'Numbers and vectors',
    doc: 'The smallest of a list, or of several values',
  },
  {
    name: 'max',
    kind: 'function',
    params: [p('values', 'A list, or the first of several values')],
    rest: true,
    section: 'Numbers and vectors',
    doc: 'The largest of a list, or of several values',
  },
  {
    name: 'clamp',
    kind: 'function',
    params: [p('x'), p('low'), p('high')],
    section: 'Numbers and vectors',
    doc: 'x limited to the interval from low to high',
  },
  {
    name: 'lerp',
    kind: 'function',
    params: [p('a'), p('b'), p('t', '0 gives a, 1 gives b')],
    section: 'Numbers and vectors',
    doc: 'Interpolate between numbers or vectors',
  },
  {
    name: 'norm',
    kind: 'function',
    params: [p('v')],
    section: 'Numbers and vectors',
    doc: 'The length of a vector',
  },
  {
    name: 'cross',
    kind: 'function',
    params: [p('a'), p('b')],
    section: 'Numbers and vectors',
    doc: 'Cross product: a number for 2D vectors, a vector for 3D ones',
  },

  // Lists and strings
  {
    name: 'len',
    kind: 'function',
    params: value,
    section: 'Lists and strings',
    doc: 'Number of items in a list or characters in a string',
  },
  {
    name: 'concat',
    kind: 'function',
    params: [],
    rest: true,
    section: 'Lists and strings',
    doc: 'Join lists and single values into one list',
  },
  {
    name: 'reverse',
    kind: 'function',
    params: value,
    section: 'Lists and strings',
    doc: 'A list or string in reverse order',
  },
  {
    name: 'sum',
    kind: 'function',
    params: [p('values', 'A list of numbers')],
    section: 'Lists and strings',
    doc: 'The sum of a list of numbers',
  },
  {
    name: 'slice',
    kind: 'function',
    params: [
      p('value', 'A list or string'),
      p('start', 'First index', '0'),
      p('end', 'Index after the last; the length when left out'),
    ],
    section: 'Lists and strings',
    doc: 'Part of a list or string',
  },
  {
    name: 'str',
    kind: 'function',
    params: [],
    rest: true,
    section: 'Lists and strings',
    doc: 'Values as text, joined',
  },
  {
    name: 'chr',
    kind: 'function',
    params: [],
    rest: true,
    section: 'Lists and strings',
    doc: 'Text from Unicode code points',
  },
  {
    name: 'ord',
    kind: 'function',
    params: [p('text')],
    section: 'Lists and strings',
    doc: "The first character's Unicode code point",
  },
  {
    name: 'upper',
    kind: 'function',
    params: [p('text')],
    section: 'Lists and strings',
    doc: 'Text in capitals',
  },
  {
    name: 'lower',
    kind: 'function',
    params: [p('text')],
    section: 'Lists and strings',
    doc: 'Text in small letters',
  },
  {
    name: 'split',
    kind: 'function',
    params: [p('text'), p('separator', undefined, '" "')],
    section: 'Lists and strings',
    doc: 'Text split into a list of strings',
  },
  {
    name: 'join',
    kind: 'function',
    params: [p('values'), p('separator', undefined, '""')],
    section: 'Lists and strings',
    doc: 'Values joined into one string',
  },
  {
    name: 'search',
    kind: 'function',
    params: [p('value'), p('list', 'A list or string')],
    section: 'Lists and strings',
    doc: 'Index of the first equal item, or undef',
  },
  {
    name: 'contains',
    kind: 'function',
    params: [p('value', 'A list or string'), p('item')],
    section: 'Lists and strings',
    doc: 'Whether a list contains an item or a string contains a substring',
  },
  {
    name: 'lookup',
    kind: 'function',
    params: [p('x'), p('table', 'A list of [x, y] pairs')],
    section: 'Lists and strings',
    doc: 'Interpolate in a table; outside it, the nearest end',
  },

  // Types and random values
  is('is_num', 'a number other than NaN'),
  is('is_string', 'a string'),
  is('is_bool', 'true or false'),
  is('is_list', 'a list'),
  is('is_undef', 'undef'),
  is('is_function', 'a function'),
  {
    name: 'type_of',
    kind: 'function',
    params: value,
    section: 'Types',
    doc: 'The type name: number, string, boolean, undef, list, range or function',
  },
  {
    name: 'rands',
    kind: 'function',
    params: [p('min'), p('max'), p('count'), p('seed', 'The same seed gives the same list', '1')],
    section: 'Random values',
    doc: 'A list of count numbers between min and max',
  },

  // Text and joints
  text('text_width', 'The advance width of the text, including spacing'),
  text('text_metrics', 'The text as [advance, [[x0, y0], [x1, y1]], ascent, descent]'),
  {
    name: 'finger_count',
    kind: 'function',
    params: [p('length', 'Edge length'), p('finger', 'Finger width', FINGER)],
    section: 'Joint dimensions',
    doc: 'The odd number of fingers finger_rect() puts on an edge of that length',
  },
];

const BY_NAME = new Map(SIGNATURES.map((s) => [s.name, s]));

export const signature = (name: string): Signature | undefined => BY_NAME.get(name);

// How the call reads, as rect(size = 1, center = false, r = 0)
export function formatSignature(s: Signature): string {
  const params = s.params.map((x) =>
    x.default === undefined ? x.name : `${x.name} = ${x.default}`,
  );
  if (s.rest) params.push('...');
  return `${s.name}(${params.join(', ')})`;
}
