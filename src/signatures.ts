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
    named('fit', 'Measure at the size that fits this width'),
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
      named('close', 'Close every open subpath into an area', 'false'),
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
      named('fit', 'Shrink the size so the text is no wider than this'),
    ],
    section: 'Shapes',
    doc: 'Text as shapes; the font must be available to the renderer',
  },
  {
    name: 'line',
    kind: 'module',
    params: [
      p('from', 'Start point', '[0, 0]'),
      p('to', 'End point', '[10, 0]'),
      p('width', 'Make a strip this wide, an area, instead of a line'),
    ],
    section: 'Shapes',
    doc: 'A straight line, or with a width a strip between the points',
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
    name: 'pattern',
    kind: 'module',
    params: [
      p('spacing', 'Distance between copies, a number or [x, y]', '10'),
      p('stagger', 'Shift of every other row, as a share of the x spacing', '0'),
    ],
    children: true,
    section: 'Combining',
    doc: 'Repeat the first child over the area of the others, clipping copies at its edge',
  },
  {
    name: 'spline',
    kind: 'module',
    params: [
      p('points', 'The [x, y] points the curve goes through'),
      p('width', 'Make an area this wide along the curve, instead of a line'),
      named('steps', 'Points between each two given ones', '8'),
      named('closed', 'Join the curve back to its start', 'false'),
    ],
    section: 'Shapes',
    doc: 'A smooth curve through points: a line, or with a width an area',
  },
  {
    name: 'hatch',
    kind: 'module',
    params: [
      p('angle', 'Direction of the lines, in degrees from +x', '45'),
      p('pitch', 'Distance between the lines', '5'),
      p('width', 'Make stripes this wide, areas, instead of lines'),
    ],
    children: true,
    section: 'Combining',
    doc: 'Parallel lines or stripes across the area of the children',
  },
  {
    name: 'paint',
    kind: 'module',
    params: [p('layers', 'A layer for each child; "" leaves that child out')],
    children: true,
    section: 'Combining',
    doc: "Painter's order: each child loses the area of the children after it",
  },
  {
    name: 'measure',
    kind: 'module',
    params: [p('draw', 'Draw the first child too', 'false')],
    children: true,
    section: 'Combining',
    doc: 'Set $bounds = [x0, y0, x1, y1], $area and $centroid = [x, y] of the first child for the children after it',
  },
  {
    name: 'fill_holes',
    kind: 'module',
    params: [p('min_area', 'Fill only holes smaller than this many square millimetres')],
    children: true,
    section: 'Combining',
    doc: 'Fill the holes in the areas of the children',
  },
  {
    name: 'close',
    kind: 'module',
    params: [p('r', 'Close gaps and notches narrower than twice this', '0.5')],
    children: true,
    section: 'Combining',
    doc: 'Close narrow gaps between and in the areas of the children',
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
    params: [
      p(
        'side',
        '"front", or "back" for the face underneath, made after turning the part over',
        '"front"',
      ),
    ],
    children: true,
    section: 'Layers',
    doc: 'Put the children on the score layer: lines marked without cutting through',
  },
  {
    name: 'engrave',
    kind: 'module',
    params: [
      p(
        'side',
        '"front", or "back" for the face underneath, made after turning the part over',
        '"front"',
      ),
    ],
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
      named('order', 'Where it goes among the custom layers in the files, lowest first', '0'),
      named('bleed', "How far past the part's edge it may print", '0'),
      named(
        'side',
        '"front", or "back" for the face underneath, made after turning the part over',
        '"front"',
      ),
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
      named('stack', 'Layers glued in a stack at each placement, one thickness apart', '1'),
      named('mirror', 'Cut the part mirrored left to right, its text still reading', 'false'),
      named('bend', 'Living hinge bends in the assembled view: [x0, x1, angle] or a list'),
      named('on', 'The name of a bent part this one is glued to, to move with it'),
      named('slots', 'Names of parts whose tabs pass through this one: their slots are cut'),
      named('clearance', 'Added to the slots, in total across each', '0.1'),
      named(
        'glue',
        'The name of a part this one is glued flat onto; at and rotate are then on its face',
      ),
      named('face', 'The face of the glue part it goes on: "top" or "bottom"', '"top"'),
    ],
    children: true,
    section: 'Parts and sheets',
    doc: 'A named part, with its thickness, kerf and material',
  },
  {
    name: 'place',
    kind: 'module',
    params: [
      p('at', 'Where the parts inside go, [x, y, z]', '[0, 0, 0]'),
      p('rotate', 'How they are turned, [x, y, z] in degrees', '[0, 0, 0]'),
    ],
    children: true,
    section: 'Parts and sheets',
    doc: 'Place the parts inside in the assembled view, with their own placements inside this one',
  },
  {
    name: 'call',
    kind: 'module',
    params: [p('name', 'The name of a module, as "roses"')],
    rest: true,
    children: true,
    section: 'Other',
    doc: 'Calls the module of that name with the other arguments and the children, so a table can carry which module draws each entry',
  },
  {
    name: 'step',
    kind: 'module',
    params: [
      p('text', 'What to do in this step', '""'),
      p('substeps', 'Steps inside it become its sub-steps; false adds them to this one', 'true'),
    ],
    children: true,
    section: 'Parts and sheets',
    doc: 'An assembly step: the parts and hardware inside are added in it, in order. A step inside a step is a sub-step, named "outer: inner"',
  },
  {
    name: 'hardware',
    kind: 'module',
    params: [
      p('kind', 'What it is, as "dowel", "screw", "magnet", "elastic" or "paper"', '"dowel"'),
      p('from', 'One end, [x, y, z]; a ball sits midway between from and to'),
      p('to', 'The other end, [x, y, z]; a ball may leave it out'),
      p('size', 'Diameter, or [width, height] for a flat section', '6'),
      named('up', "The direction a [width, height] section's height points"),
      named('sides', 'Sides of a round section in the 3D view; 0 makes a ball', '24'),
      named('shape', '"rod", or "ball" for a bulb, a marble or a bead', '"rod"'),
      named('label', 'The name in the hardware list'),
    ],
    children: true,
    section: 'Parts and sheets',
    doc: 'Hardware the assembly needs, in the parts list and the 3D view',
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
    name: 'train_for',
    kind: 'function',
    params: [
      p('ratio', 'Turns in for one turn out; under 1 speeds up'),
      p('stages', 'Pairs of gears, 1 to 3', '2'),
      p('pinion', 'Fewest and most teeth of the small gears', '[10, 20]'),
      p('wheel', 'Fewest and most teeth of the big gears', '[20, 80]'),
    ],
    section: 'Numbers and vectors',
    doc: 'Tooth counts for a gear train nearest a ratio: {stages = [[driver, driven], ...], ratio, error}',
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

  // Paths and 3D rotations
  {
    name: 'path_length',
    kind: 'function',
    params: [p('points', 'A list of [x, y] points')],
    section: 'Paths and rotations',
    doc: 'The length of the lines through a list of points',
  },
  {
    name: 'offset_path',
    kind: 'function',
    params: [
      p('points', 'A list of [x, y] points'),
      p('d', 'How far to move it: to the left going along it, or the right when less than 0'),
      p('closed', 'The path goes round, its last point joined to its first', 'false'),
    ],
    section: 'Paths and rotations',
    doc: 'The path moved sideways, each corner mitred: the two edges of a strip along a curve',
  },
  {
    name: 'point_at',
    kind: 'function',
    params: [p('points', 'A list of [x, y] points'), p('s', 'Distance along the path')],
    section: 'Paths and rotations',
    doc: 'The point a distance along a path; past either end it carries on straight',
  },
  {
    name: 'heading_at',
    kind: 'function',
    params: [p('points', 'A list of [x, y] points'), p('s', 'Distance along the path')],
    section: 'Paths and rotations',
    doc: 'The direction of a path a distance along it, in degrees from +x',
  },
  {
    name: 'path_points',
    kind: 'function',
    params: [
      p('d', 'SVG path data, as "M0 0 L10 0 A5 5 0 0 1 20 0"'),
      p('tolerance', 'How far curves may stray from their points', '0.05'),
    ],
    section: 'Paths and rotations',
    doc: 'The points of SVG path data: one list of points for each subpath',
  },
  {
    name: 'spline_points',
    kind: 'function',
    params: [
      p('points', 'The [x, y] points the curve goes through'),
      p('steps', 'Points between each two given ones', '8'),
      p('closed', 'Join the curve back to its start', 'false'),
    ],
    section: 'Paths and rotations',
    doc: 'The points of a smooth curve through points, as spline() draws it',
  },
  {
    name: 'rotation',
    kind: 'function',
    params: [p('angles', '[x, y, z] in degrees, as part() turns')],
    section: 'Paths and rotations',
    doc: 'The 3x3 matrix of a rotation; matrices multiply with *',
  },
  {
    name: 'euler',
    kind: 'function',
    params: [p('matrix', 'A 3x3 rotation matrix')],
    section: 'Paths and rotations',
    doc: "The [x, y, z] angles of a rotation matrix, for part()'s rotate",
  },
  {
    name: 'orient',
    kind: 'function',
    params: [
      p('x', "Where the part's own x axis points"),
      p('z', 'Where its z axis, out of its top face, points', '[0, 0, 1]'),
    ],
    section: 'Paths and rotations',
    doc: "The rotate angles that turn a part's x and z axes onto two directions",
  },

  // Lists and strings
  {
    name: 'len',
    kind: 'function',
    params: value,
    section: 'Lists and strings',
    doc: 'Number of items in a list, characters in a string or fields in a record',
  },
  {
    name: 'keys',
    kind: 'function',
    params: [p('record', 'A record, as {name = value}')],
    section: 'Lists and strings',
    doc: "A record's field names, in the order they were written",
  },
  {
    name: 'merge',
    kind: 'function',
    params: [p('a', 'A record'), p('b', 'A record whose fields add to or replace those of a')],
    section: 'Lists and strings',
    doc: 'A record with the fields of a and b, b winning where both have one',
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
  is('is_record', 'a record, as {name = value}'),
  {
    name: 'type_of',
    kind: 'function',
    params: value,
    section: 'Types',
    doc: 'The type name: number, string, boolean, undef, list, range, function or record',
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
