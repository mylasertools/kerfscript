# Coming from OpenSCAD

KerfScript uses syntax familiar to OpenSCAD users, with features for laser
cutting. Existing OpenSCAD files may need changes to run in KerfScript.
This guide covers the shared syntax and the differences that affect a port.

## The same

You can use familiar building blocks:

- Modules, functions, `for`, `if`, `let`, `each`, list comprehensions,
  ranges and function literals.
- `children()`, `children(index)` and `$children`.
- Dynamically scoped `$` variables, plus `$fn`, `$fa` and `$fs` for curve
  resolution.
- 2D shapes: `square()` or `rect()`, `circle()`, `polygon()` and `text()`.
- Transforms: `translate`, `rotate`, `scale`, `mirror` and `multmatrix`.
- Shape operations: `union`, `difference`, `intersection`, `hull` and `offset`.
- `echo()`, `assert()`, `use <...>` and `include <...>`.
- Customizer comments for ranges, choices, groups and captions.

See the [language reference](../LANGUAGE.md) for supported arguments.

## Different

| Feature     | OpenSCAD                                                     | KerfScript                                                               |
| ----------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Geometry    | 3D and 2D                                                    | 2D parts for laser cutting                                               |
| Output      | 3D formats and 2D exports                                    | SVG and DXF with operation layers                                        |
| Assignments | The last assignment in a scope applies throughout that scope | Assignments take effect in order                                         |
| Type errors | Many produce `undef` and a warning                           | Stop evaluation with an error                                            |
| `color()`   | Sets a shape's colour                                        | Ignored with a warning; use `cut()`, `score()`, `engrave()` or `layer()` |
| Fonts       | Looks up system fonts                                        | Uses fonts supplied by the application or CLI                            |
| Libraries   | Can load local files                                         | Loads the standard library and sources allowed by the host               |

Assignment order is especially important when adapting a design. A value
assigned later in a KerfScript program does not change earlier geometry.

## Not in KerfScript

KerfScript does not support `cube`, `sphere`, `cylinder`, `polyhedron`,
`rotate_extrude` or `projection`. It also does not support `minkowski`,
`resize`, `import`, `surface` or `render`. Calls to these modules produce an
error.

`color()` and `linear_extrude()` run as their children, with a warning, so
the 2D part of an OpenSCAD file runs as it is: `linear_extrude(3) shape();`
cuts `shape()` as a flat part, whose thickness comes from `$thickness`.

## Only in KerfScript

- **Operations:** `cut()`, `score()`, `engrave()`, `guide()` and `layer()`.
- **Material settings:** `$kerf` for cut compensation and `$thickness` for
  material-dependent joints.
- **Parts and layout:** `part()`, `material()`, quantities, `$sheet` and `$gap`.
- **Joinery:** `finger_rect`, `finger_holes`, `tslot` and `living_hinge`.
- **Paths:** `line`, `polyline`, `arc`, `path`, `stroke` and `outline`.
- **Additional shapes:** `ellipse`, `regular_polygon`, `star` and rounded
  rectangles with `rect(r = ...)`.
- **Text measurement:** `text_width()` and `text_metrics()`.

## Porting a 2D design

1. Keep the 2D geometry and remove extrusion or other 3D operations.
2. Assign shapes to cut, score or engrave layers.
3. Check repeated assignments and put each value before the code that uses it.
4. Supply the fonts used by `text()`.
5. Set the measured material thickness and kerf. Use the joinery modules
   where they suit the design.

Render the result and check the dimensions and layers before exporting.
The [layers](layers.md), [kerf](kerf.md) and
[parts and sheets](parts-and-sheets.md) guides cover those steps.

## Running a KerfScript design in OpenSCAD

The other way round, `openscad/kerfscript.scad` (in the repository and in
the npm package) gives OpenSCAD KerfScript's 2D shapes, so the 2D part of a
KerfScript design runs in OpenSCAD as it is. Include it at the top:

```openscad
include <kerfscript.scad>

part("tag") {
  rect([60, 30], r = 4);
  engrave() translate([30, 15]) star(5, 8);
  score() polyline([[5, 5], [55, 5]]);
}
```

It has:

- The shapes `rect(size, center, r)`, `ellipse(r | d)`,
  `regular_polygon(n, r)`, `star(n, r, inner)`, `line(from, to, width)`,
  `polyline(points, closed)`, `arc(r, start, end)`, `stroke(width)`,
  `outline()`, `close(r)` and `path(d, fill, close)` with SVG path data
  (every command, arcs and curves included).
- The functions `lerp`, `clamp`, `contains`, `slice`, `sum`, `reverse`,
  `sort`, `fold`, `scan`, `upper`, `lower`, `join` and `split`.
- `cut()`, `score()` (blue), `engrave()` (black), `guide()` (in the
  background), `layer()`, `part()`, `place()`, `step()` and `material()`,
  which draw their shapes as they are, and `hardware()`, which draws nothing.

OpenSCAD has areas only, so a KerfScript line (a score line, an arc, a
polyline) is drawn as a strip `$line_width` wide (0.2 mm) with round ends;
`stroke(w)` sets the width for what is inside it. With `$kerf_3d = true`
each placed part is extruded to `$thickness` and put where `part(at,
rotate)` and `place()` put it, for a quick look at the assembly.

Shapes come out the same size and area in both languages. Records,
`text(fit)`, `symbol()`, the standard library and the joinery modules are
KerfScript's own, so a design that uses them runs in KerfScript only.
