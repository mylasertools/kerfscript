# KerfScript language reference

Language version 0.3. Copyright (c) 2026 MyLaserTools. This document is
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
"KerfScript" is a trademark of MyLaserTools, see [TRADEMARKS.md](TRADEMARKS.md).

This reference covers KerfScript syntax, built-in modules and functions.
For a first project, follow [Getting started](docs/getting-started.md). The
[specification](docs/specification.md) gives the formal grammar and the
exact rules for scope, evaluation, libraries and errors.

Programs build 2D shapes, assign them to cut, score or engrave layers, and
group them into parts. Rendering applies kerf compensation, arranges the
parts on sheets and produces SVG or DXF files.

Lengths are in millimetres and angles are in degrees. Positive x points
right; positive y points up.

```kerf
// A coaster with a hole, an engraved ring and a scored border.

size = 90; // [60:5:120]

difference() {
  circle(d = size);
  circle(d = 6);
}
engrave() difference() { circle(d = size - 16); circle(d = size - 22); }
score() circle(d = size - 6);
```

## Lexical structure

- Comments: `// line` and `/* block */`.
- Numbers: `12`, `0.5`, `.5`, `1e3`.
- Strings: `"text"` with `\n`, `\t`, `\"`, `\\` and `\uXXXX` escapes.
- Names: letters, digits and `_`, not starting with a digit. Names starting
  with `$` are **special variables** (see Scope).
- Keywords: `module function if else for let each use include true false undef`.

## Values

| Type     | Examples                                                     |
| -------- | ------------------------------------------------------------ |
| number   | `3`, `-0.25`, `PI`                                           |
| string   | `"Oak"`                                                      |
| boolean  | `true`, `false`                                              |
| undef    | `undef`, a missing argument, an index past the end of a list |
| list     | `[1, 2]`, `[[0, 0], [10, 0], [5, 8]]`                        |
| range    | `[0:5]` (0 to 5 step 1), `[0:2:10]` (0 to 10 step 2)         |
| function | `function(x) x * 2`                                          |
| record   | `{kind = "armchair", x = 10, items = []}`                    |

Points are lists `[x, y]`. `p.x` and `p.y` read the first two items.

A record holds values by name. `s.kind` (or `s["kind"]`) reads a field, and
a field it doesn't have reads as `undef`, so a table of scene entries can't
put a value in the wrong place:

```kerf
chair = {kind = "armchair", x = 10, items = ["cushion"]};
echo(chair.kind, chair.y);              // armchair, undef
moved = merge(chair, {x = 40});         // the same with x = 40
echo(keys(moved), len(moved));          // ["kind", "x", "items"], 3
```

Records are equal when they have the same fields with equal values.

## Expressions

Operators are listed from lowest to highest precedence. Use parentheses
to change the order of evaluation.

| Operator            | Meaning                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `c ? a : b`         | conditional                                                                                                    |
| `\|\|`              | or                                                                                                             |
| `&&`                | and                                                                                                            |
| `==` `!=`           | equality, lists compare item by item                                                                           |
| `<` `<=` `>` `>=`   | compare numbers or strings                                                                                     |
| `+` `-`             | add or subtract numbers or equal length lists; `+` joins strings                                               |
| `*` `/` `%`         | multiply, divide, remainder; list times number scales; list times list is the dot product; matrix times vector |
| `-x` `+x` `!x`      | negate, same, not                                                                                              |
| `a ^ b`             | power, right associative and tighter than unary minus                                                          |
| `f(x)` `a[i]` `a.x` | call, index, member                                                                                            |

Unsupported combinations, such as a list plus a number or `undef + 1`,
produce an error at the source line.

In conditions, `false`, `0`, `""`, `[]` and `undef` count as false.

Use `let (a = 1, b = a + 1) expr` to define names for one expression.
Each binding can use the ones before it.

### List comprehensions

Build a list with `for`, filter items with `if`, or insert the contents of
another list with `each`:

```kerf
squares = [for (i = [1:5]) i * i];
odd = [for (i = [1:9]) if (i % 2) i];
grid = [for (x = [0:2], y = [0:2]) [x * 10, y * 10]];
flat = [each [1, 2], 3];
```

## Statements

Assignments and function definitions end with a semicolon. Modules create
geometry and can receive child statements. In the syntax below, `...`
stands for the body of a statement:

```kerf
name = expr;                          // assignment
function name(a, b = 2) = expr;       // function
module name(a, b = 2) { ... }         // module (makes shapes)
name(args) child;                     // module call with one child
name(args) { child; child; }          // module call with a block of children
for (i = range_or_list, j = ...) ...  // repeats, combined as a union
if (cond) ... else ...
let (a = 1) ...
use <path>                            // import modules and functions
include <path>                        // run another file in place
```

Arguments can be positional or named: `rect([20, 10], r = 2)`.

A library's own `use <path>` and `include <path>` look next to that
library first, then where the main program's would: `lib/props.kerf`
saying `use <finish.kerf>` finds `lib/finish.kerf`.

### Lengths in real units

A number written with a unit, as `140cm`, `2.5in`, `1.2m`, `30mm` or `3ft`,
is a length in the real world: it comes out in millimetres divided by
`$scale`. With `$scale = 12`, `140cm` is 116.67 mm, so a dollhouse and a
book-nook version come from one model. Plain numbers are millimetres on
the sheet and never scale: keep `$thickness`, `$kerf` and joint sizes
plain. A setting written with a unit is not shown in the customizer.

### Scope

- Assignments run **in order**. A later assignment to the same name replaces
  the earlier one from that point on.
- `module` and `function` definitions are visible in their whole block, so you
  can call them before they are defined.
- Blocks, loops and module bodies have their own scope.
- Variables, functions and modules have separate names. A variable that
  does not hold a function never hides a function or built-in: after
  `len = 3;`, `len([1, 2])` is still 2.
- **Special variables** (`$name`) are dynamically scoped: a value set by a
  caller is seen by everything it calls. Pass them as arguments too:
  `circle(5, $fn = 6)`.
- Top-level assignments are the program's **parameters**. Renderers override
  them by name (`kerf render -D width=200`).

### Modifiers

Place `*` before a module call to disable it. Use `#` or `%` to move its
geometry to the guide layer. Guides are included only when requested in
the render options. `!` is accepted for OpenSCAD files and has no effect.

### children()

Inside a module, `children()` renders all child statements passed by the
caller. `children(index)` selects one child by its position from 0, or several with a list of positions.
`$children` is the number of children.

```kerf
module hang_hole(d = 5) {
  difference() { children(); translate([0, -d * 1.5]) circle(d = d); }
}
```

## Special variables

| Name              | Default       | Meaning                                                                     |
| ----------------- | ------------- | --------------------------------------------------------------------------- |
| `$thickness`      | `3`           | material thickness, used by joinery and stored on parts                     |
| `$kerf`           | `0`           | beam width; cut outlines are offset by half of it                           |
| `$material`       | `"material"`  | material name; parts are packed per material and thickness                  |
| `$sheet`          | `[600, 400]`  | sheet size for packing                                                      |
| `$gap`            | `3`           | space between packed parts and around the sheet edge                        |
| `$layout`         | `"pack"`      | `"pack"` packs parts onto sheets, `"none"` keeps your placement             |
| `$fn` `$fa` `$fs` | `0` `2` `0.2` | curve resolution: fixed segment count, or max angle and max segment length  |
| `$font`           |               | default font name for `text()`                                              |
| `$mirrored`       | `false`       | set inside a mirrored part and on the back face: `text()` reads right       |
| `$scale`          | `1`           | the model's scale: `140cm` is 1400 mm divided by `$scale`                   |
| `$nest`           | `false`       | pack small parts into the holes of bigger ones                              |
| `$registration`   | `false`       | print-and-cut marks in three corners of every sheet                         |
| `$label_parts`    | `false`       | engrave each part's number on its back face, as in the parts list and steps |
| `$min_width`      | `1.5`         | warn where a part's material is narrower than this; `0` turns it off        |
| `$bounds`         |               | set by `measure()` for the children after the one it measures               |

## Layers

Every shape is on a layer. Shapes not wrapped in a layer module are on `cut`.

| Layer     | Mode  | Colour    | Intended operation                                   |
| --------- | ----- | --------- | ---------------------------------------------------- |
| `engrave` | fill  | `#000000` | the area is engraved                                 |
| `score`   | line  | `#0000ff` | lines and shape outlines are marked, not cut through |
| `cut`     | cut   | `#ff0000` | outlines are cut through, with kerf compensation     |
| `guide`   | guide | `#00a0ff` | shown only when guides are requested                 |

```kerf
cut() ...        engrave() ...        score() ...        guide() ...
layer("pocket", mode = "fill", color = "#00aa00") ...
```

Use `layer(name, mode, color)` to define a custom layer. Its mode is
`"cut"`, `"line"`, `"fill"` or `"guide"`.

Marks can go on a part's **back face** too: `engrave(side = "back")`,
`score(side = "back")` or `layer(name, side = "back")`. Draw them where
they are on the part seen from the top, as everything else; text on the
back reads the right way round on the back. Each sheet with back marks
gets a second job (`sheet.back`, or `name-back.svg` from the command line),
the sheet turned over left to right: cut the sheet, turn it over without
moving the parts, line it up on the same corner and run the back job.

Files list layers in this order: engrave, custom fill layers, custom line
and cut layers, score, cut, guide, so a line is never covered by a fill.
`layer(name, order = n)` moves a custom layer among the others, lowest
first; at the same order fills still go under lines.

For printing on the parts before cutting, `layer(name, bleed = 2)` lets
that layer run 2 mm past the part's edge instead of being clipped to it,
and `$registration = true` puts marks in three corners of every sheet on
a `registration` layer, for a print-and-cut machine to line up on.
Set the actual operation order, power and speed in your laser software.
See [Laser software](docs/compatibility.md) for import details.

When a part is rendered:

- The part's **material** is the union of its cut layer shapes.
- Engrave, score and custom layers are clipped to the material, so nothing is
  marked inside holes or off the part. Score outlines become lines first.
- Cut lines (from `line()`, `living_hinge()` and similar) are clipped to the
  material.
- If the material breaks into more than one piece, the renderer warns.
- In the output, holes and inner cuts come before outer outlines.

## Parts and sheets

Use `part()` to name a component and set its quantity. Wrap parts in
`material()` when they share a thickness, kerf and material name:

```kerf
material(thickness = 4, kerf = 0.12, name = "birch") {
  part("side", qty = 2) finger_rect([100, 60], "out");
  part("base") rect([100, 100]);
}
```

- `part(name, qty = 1, at, rotate) { ... }` makes a named part. It records
  `$thickness`, `$kerf` and `$material` where it is called. `at = [x, y, z]`
  and `rotate = [x, y, z]` (degrees) place the part in the assembled view:
  rotated first, then moved, with its thickness along +Z. A part with copies
  takes one placement or a list with one per copy. `render()` returns the
  placed parts as `assembly` and warns when two of them collide.
  `rotate = orient(x, z)` turns the part's own x and z axes onto two
  directions; `euler(rotation(a) * rotation(b))` turns by `b`, then by `a`.
- More about a part, all named:
  - `stack = n`: n layers glued at each placement, one thickness apart
    along the part's z. The parts list says how many make a stack.
  - `mirror = true`: the part is cut mirrored left to right (x becomes
    -x), and its text still reads the right way round. Make the left of a
    pair by mirroring the right.
  - `bend = [x0, x1, angle]`, or a list of them: a living hinge from x0 to
    x1 along the part's x bends it by `angle` degrees in the assembled
    view, folding the far end up towards its top face (down for a negative
    angle). The hinge's middle layer keeps its length.
  - `on = "name"`: the part is glued to that bent part, and moves with the
    run of it under its centre.
  - `glue = "name"`, `face = "top"`: the part is glued flat on that part's
    top (or bottom) face; its `at` and `rotate` are measured on the face,
    and the parts list says what it is glued to. With as many copies as
    the part it is glued on, one goes on each.
  - `slots = ["name", ...]`: where the named parts' material passes through
    this part in the assembly, slots are cut through it the shape of their
    cross-section, at any angle, `clearance = 0.1` wider. Draw tabs on one
    part and let the parts they go into cut their own slots. A name may
    have `*` for any run of characters, and `"!name"` leaves out parts the
    names before it took: `slots = ["*", "!back"]` cuts a slot for every
    part that passes through except the back. A slot clears every layer,
    marks included, and a part that only touches the edge leaves no notch.
- `place(at, rotate) { ... }` places the parts and hardware inside in the
  assembled view, as part()'s `at` and `rotate` do; their own placements
  are inside it. A library module wrapped in `place()` can be set anywhere.
- `step(text) { ... }`: an assembly step. Parts and hardware inside are
  added in it, in the order steps first run; `render()` returns the steps'
  text as `steps` and each placed part's `step`. The 3D view shows the
  model built up a step at a time. A step inside a step is a sub-step,
  `"outer: inner"`; `step(text, substeps = false)` takes inner steps in.
- `hardware(kind, from, to, size = 6, up, sides = 24, label)` lists
  hardware the assembly needs, from one point to another: a dowel, a screw,
  a magnet, paper. `size` is a diameter, or `[w, h]` for a flat section
  whose `h` points along `up` (by default up, or along y for something
  standing upright). `render()` returns it as `hardware`, and `kerf check`
  lists it.
- Shapes outside any part form one part named `part`.
- `material(thickness, kerf, name) { ... }` sets those special variables for
  its children.
- With `$layout = "pack"`, parts are grouped by material and thickness and
  repeated `qty` times. They are arranged in rows on sheets of `$sheet` and
  may be rotated 90° to fit. Parts larger than the sheet produce a warning.
  A project's `kerf.json` can give `"sheet": [w, h]`, the laser's bed, for
  every design in it that does not set `$sheet`.
- With `$nest = true`, small parts are packed inside the holes of bigger
  ones, as rings inside rings.

See [Parts and sheets](docs/parts-and-sheets.md) for spacing, layout and
export examples.

## Built-in modules

### Shapes

| Module                                                     | Notes                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `rect(size, center = false, r = 0)`                        | `size` is a number or `[w, h]`; `r` rounds the corners. `square` is an alias |
| `circle(r)` or `circle(d = ...)`                           |                                                                              |
| `ellipse([rx, ry])`                                        |                                                                              |
| `regular_polygon(n, r)`                                    | corner radius `r`                                                            |
| `star(n, r, inner)`                                        |                                                                              |
| `polygon(points, paths)`                                   | even-odd fill, `paths` lists point indexes per outline                       |
| `path(d, fill = "evenodd", close = false)`                 | SVG path data; closed subpaths become shapes, open ones lines unless `close` |
| `text(text, size = 10, font, halign, valign, spacing = 1)` | `halign`: left, center, right; `valign`: baseline, top, center, bottom       |
| `text(text, size, fit = width)`                            | no wider than `fit`: the size shrinks to fit, never above `size` if given    |
| `line(from, to)`                                           | a line, not an area                                                          |
| `line(from, to, width)`                                    | a strip `width` wide between the points, an area                             |
| `spline(points, width, steps = 8, closed = false)`         | a smooth curve through the points; with `width`, an area along it            |
| `polyline(points, closed = false)`                         |                                                                              |
| `arc(r, start = 0, end = 90)`                              | arc line, angles in degrees                                                  |

Supply geometry as children of a shape-processing module, for example
`translate([10, 0]) circle(d = 5);`. Fonts used by `text()` must be supplied
by the application or through the [command line](docs/cli.md). The
playground, the command line and `kerfscript.wasm` have `Atkinson`
(Atkinson Hyperlegible) built in.

### Transforms

| Module                       | Effect                                                                 |
| ---------------------------- | ---------------------------------------------------------------------- |
| `translate([x, y])`          | Move geometry by x and y                                               |
| `rotate(a, center = [x, y])` | Rotate by `a` degrees around a point; the default centre is the origin |
| `scale(v)`                   | Scale both axes by the number `v`                                      |
| `scale([sx, sy])`            | Scale each axis separately                                             |
| `mirror([nx, ny])`           | Reflect across a line through the origin, perpendicular to this vector |
| `multmatrix(m)`              | Apply a 2 × 3 transformation matrix                                    |

### Combining

| Module                                         | Notes                                                                                                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `union()` / `group()`                          | joins children                                                                                                                          |
| `difference()`                                 | removes every later child's area from every layer of the first child                                                                    |
| `intersection()`                               | keeps the area common to all children; lines of any child are clipped to the others' area, and a child of lines alone leaves only lines |
| `fill_holes(min_area)`                         | fills holes smaller than `min_area` mm², or all of them                                                                                 |
| `close(r = 0.5)`                               | closes gaps and notches narrower than `2 r`, keeping the outline                                                                        |
| `pattern(spacing, stagger = 0)`                | repeats its first child over the area of the others, clipped at the edge                                                                |
| `hatch(angle = 45, pitch = 5, width)`          | parallel lines across the children's area, or stripes `width` wide                                                                      |
| `paint(layers)`                                | each child loses the area of every later one; child i goes on `layers[i]`. A child wholly on an area of its own layer warns             |
| `measure(draw = false)`                        | `$bounds` = `[x0, y0, x1, y1]` of the first child, for the children after                                                               |
| `hull()`                                       | convex hull; each named part inside gets its own hull                                                                                   |
| `offset(r)` / `offset(delta, chamfer = false)` | grow (positive) or shrink areas; `r` rounds corners                                                                                     |
| `stroke(width)`                                | turns lines into areas of that width, for cutting single line art                                                                       |
| `outline()`                                    | turns areas into their outline lines                                                                                                    |

### Joinery

| Module                                               | Notes                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finger_rect(size, edges, finger)`                   | rectangle with finger joints. `edges` is one value or `[bottom, right, top, left]`, each `"out"`, `"in"` or `"flat"`. An `"out"` edge keeps its corners, an `"in"` edge notches them; join an `"out"` edge to an `"in"` edge of the same length. Notch depth is `$thickness`; `finger` defaults to `max(3 * $thickness, 6)` and the count is always odd |
| `finger_holes(length, edge = "out", finger)`         | row of slots along x, centred on y = 0, that an `edge` finger edge of the same length plugs into (for shelves and dividers)                                                                                                                                                                                                                             |
| `tslot(d = 3, length = 12, nut = [w, h], nut_at)`    | T-slot for a screw and nut, opening at y = 0 and running up; subtract it from a panel edge                                                                                                                                                                                                                                                              |
| `living_hinge(size, spacing = 1.5, bridge = 3, cut)` | straight-line flex pattern as cut lines filling `[w, h]`                                                                                                                                                                                                                                                                                                |

### Other

| Module                       | Effect                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `echo(...)`                  | Report values without creating geometry                                                                          |
| `assert(condition, message)` | Stop with `message` when `condition` is false                                                                    |
| `children(index)`            | Render a child passed to the current module; omit `index` to render all children                                 |
| `call(name, ...)`            | Call the module named by the string `name` with the other arguments and the children: `call(entry.draw, 40, 30)` |

## Built-in functions

Functions return values. Arguments can be positional or named with the
parameter names below, as in `pow(x = 2, y = 10)` or `log(8, base = 2)`. An
unknown name gives a warning. `concat`, `str` and `chr` take only positional
arguments.

### Numbers and vectors

| Function                                       | Result                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `abs(x)`, `sign(x)`                            | Absolute value, or sign as -1, 0 or 1                                |
| `floor(x)`, `ceil(x)`, `round(x)`              | Round down, up or to the nearest integer                             |
| `sqrt(x)`, `pow(x, y)`                         | Square root, or x raised to y                                        |
| `exp(x)`, `ln(x)`                              | Exponential with base e, or natural logarithm                        |
| `log(x)`, `log(base, x)`                       | Base-10 logarithm, or logarithm with a chosen base                   |
| `sin(x)`, `cos(x)`, `tan(x)`                   | Trigonometric functions with angles in degrees                       |
| `asin(x)`, `acos(x)`, `atan(x)`, `atan2(y, x)` | Inverse trigonometric functions, returning degrees                   |
| `min(values)`, `max(values)`                   | Minimum or maximum of a list; also accept separate values            |
| `clamp(x, low, high)`                          | Limit x to the given interval                                        |
| `lerp(a, b, t)`                                | Interpolate between numbers or vectors; t = 0 gives a, t = 1 gives b |
| `norm(v)`                                      | Length of a vector                                                   |
| `cross(a, b)`                                  | Cross product; a scalar for 2D vectors or a vector for 3D vectors    |

### Paths and rotations

A path is a list of `[x, y]` points.

| Function                                           | Result                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| `path_length(points)`                              | Length along the path                                                |
| `point_at(points, s)`                              | The point `s` along the path; past either end it carries on straight |
| `heading_at(points, s)`                            | The path's direction `s` along it, in degrees from +x                |
| `path_points(d, tolerance)`                        | The points of SVG path data, a list of points for each subpath       |
| `rotation(angles)`                                 | The 3 × 3 matrix of `[x, y, z]` degrees as `part()` turns; use `*`   |
| `euler(matrix)`                                    | The `[x, y, z]` angles of a rotation matrix, for `rotate`            |
| `orient(x, z = [0, 0, 1])`                         | The angles that turn a part's own x and z axes onto two directions   |
| `spline_points(points, steps = 8, closed = false)` | The points of the smooth curve `spline()` draws                      |

### Lists and strings

| Function                       | Result                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `len(value)`                   | Number of items in a list, characters in a string or fields in a record                      |
| `keys(record)`                 | A record's field names, in the order they were written                                       |
| `merge(a, b)`                  | A record with the fields of both, `b`'s winning                                              |
| `concat(...)`                  | Join lists and individual values into one list                                               |
| `reverse(value)`               | Reverse a list or string                                                                     |
| `sum(values)`                  | Sum a list of numbers                                                                        |
| `slice(value, start = 0, end)` | Extract part of a list or string; `end` is exclusive and defaults to its length              |
| `str(...)`                     | Convert values to text and join them                                                         |
| `chr(...)`, `ord(text)`        | Convert Unicode code points to text, or read the first character's code point                |
| `upper(text)`, `lower(text)`   | Change letter case                                                                           |
| `split(text, separator = " ")` | Split text into a list of strings                                                            |
| `join(values, separator = "")` | Join values into a string                                                                    |
| `search(value, list)`          | Index of the first equal item, or `undef` if absent; also searches characters in strings     |
| `contains(value, item)`        | Whether a list contains an item or a string contains a substring                             |
| `lookup(x, table)`             | Interpolate in a table of `[x, y]` pairs; use the nearest endpoint outside the table's range |

### Types

`is_num(value)`, `is_string(value)`, `is_bool(value)`, `is_list(value)`,
`is_undef(value)`, `is_function(value)` and `is_record(value)` return a boolean.
`type_of(value)` returns the type name as a string.

### Random values

`rands(min, max, count, seed = 1)` returns a list of numbers between the
bounds. The same seed gives the same sequence.

### Text measurements

`text_width(text, size, font)` returns the advance width, including glyph
spacing. `text_metrics(text, size, font)` returns
`[advance, [[x0, y0], [x1, y1]], ascent, descent]`.

With `fit = width` they measure the text at the size `text()` would fit it to.

Both require the font to be available to the renderer, just like `text()`.

### Joint dimensions

`finger_count(length, finger)` returns the odd finger count used by
`finger_rect()` for an edge of that length.

## Customizer comments

Top-level assignments with a literal number, string, boolean or numeric
list can appear as editable settings. Comments supply captions, ranges,
choices and groups:

```kerf
/* [Size] */
// Outer width
width = 120; // [40:5:400]
depth = 80; // [200]
shape = "round"; // [round:Round, square:Square]
count = 3; // [2, 3, 4]
/* [Hidden] */
seed = 7;
```

- `/* [Size] */` starts a group; the settings below it are listed under
  _Size_.
- `// Outer width`, the comment line just above an assignment, is its caption.
- `[40:5:400]` is a slider from 40 to 400 in steps of 5; `[200]` is a slider
  up to 200.
- `[round:Round, square:Square]` is a menu of values with labels; `[2, 3, 4]`
  is a menu of values.
- Settings after `/* [Hidden] */` are not listed.

Nothing else may follow the brackets on the same line: with
`// [40:5:400] min:step:max` the setting is a plain number field, not a
slider.

These comments follow OpenSCAD's customizer format. Read
[Settings](docs/customizer.md) for supported controls, or use `kerf params`
to inspect the settings in a file.

## Standard library

Every renderer has these libraries built in. Load one with `use`, as
`use <kerf/box>`; [Standard library](docs/library.md) describes each
module and its parameters. Libraries others publish are installed with
`kerf add` and loaded by their name, as `use <feet/feet>`; see
[Shared libraries](docs/shared-libraries.md).

| Library            | Modules and functions                                                       |
| ------------------ | --------------------------------------------------------------------------- |
| `kerf/box`         | `box([w, d, h], lid = false, finger)`, `divider([w, h], finger)`            |
| `kerf/tabs`        | `tabs()`, `slots()`, `tab_rect()`, `tab_positions()`: tab and slot joints   |
| `kerf/hinge`       | `flex_rect()`, `flex_box()`, `flex_panel()`, `bend_length()`: living hinges |
| `kerf/dividers`    | `grid_dividers()`, `slotted_divider()`: egg-crate dividers                  |
| `kerf/hanging`     | `keyhole()`, `keyholes()`, `hanging_hole()`, `hanging_loop()`               |
| `kerf/enclosure`   | `enclosure()`, `enclosure_cutouts()`, `vents()`: boxes with a screwed lid   |
| `kerf/calibration` | `kerf_gauge()`, `slot_gauge()`, `joint_test()`: test pieces                 |

`box()` makes the six (or five) panels of a finger-jointed box as parts
`bottom`, `lid`, `front`, `back`, `left`, `right`, from the outer size.
`divider()` makes a divider with finger tabs on both sides.

## Output

- **SVG**: millimetre units, one Inkscape layer group per KerfScript layer,
  colours as above, 0.1 mm hairline strokes, `data-part` on every path.
- **DXF**: R12 (AC1009) polylines on layers named after KerfScript layers,
  with matching AutoCAD colours. Names are upper case with characters other
  than letters, digits, `_` and `-` as `_`; when two layers come out the
  same, the later one gets `_2`, `_3` and so on. The built-in layers keep
  `CUT`, `SCORE`, `ENGRAVE` and `GUIDE`, so a layer of your own named `Cut`
  becomes `CUT_2`.

## Limits

The interpreter limits call depth to 1,000 for modules and 2,000 for
functions. A range a loop or built-in function goes through is limited to
`maxListLength` items (below). The default
evaluation limit is 5,000,000 steps; applications can change it with
`maxSteps`. Comparing lists with `==`, multiplying two lists, and built-in
functions that go through a list or string take a step for each item;
`len()` of a list, `ord()`, `type_of()` and the `is_` functions take one.
Exceeding a limit stops evaluation with an error.

Programs are also limited in how much memory they can ask for:

| Limit               | Default   | What it counts                                                                                                             |
| ------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `maxParts`          | 10,000    | copies of all parts, adding up every `qty`                                                                                 |
| `maxSegments`       | 10,000    | segments in one circle, ellipse or arc, and corners in one polygon                                                         |
| `maxListLength`     | 1,000,000 | items in one list or range, or characters in one string, including the text `echo()` writes in one call                    |
| `maxListItems`      | 3,000,000 | items in all lists the program builds, plus 4 for each list, one for every 8 characters of the strings it builds or echoes |
| `maxTextLength`     | 2,000     | characters in one `text()`                                                                                                 |
| `maxPoints`         | 2,000,000 | points in all shapes the modules make, plus 100 for each shape                                                             |
| `maxOutputPoints`   | 1,000,000 | points in the exported files, counting every copy                                                                          |
| `maxSheets`         | 200       | sheets in the layout                                                                                                       |
| `maxCollisionPairs` | 20,000    | pairs of touching placed parts checked for collisions; past it the check stops with a warning                              |

Applications can change them with the `limits` render option.

A list can hold the same list many times, as in `b = [a, a]`. `echo()`,
`str()` and `join()` write every copy out, so their text can be far longer
than the list; they stop with an error once it passes `maxListLength`.

Geometry operations also take time. Applications that render user programs
should run them in a worker with a timeout; see the
[JavaScript API](docs/javascript.md#running-untrusted-code).
