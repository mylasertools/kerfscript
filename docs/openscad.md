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

| Feature     | OpenSCAD                                                     | KerfScript                                                 |
| ----------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| Geometry    | 3D and 2D                                                    | 2D parts for laser cutting                                 |
| Output      | 3D formats and 2D exports                                    | SVG and DXF with operation layers                          |
| Assignments | The last assignment in a scope applies throughout that scope | Assignments take effect in order                           |
| Type errors | Many produce `undef` and a warning                           | Stop evaluation with an error                              |
| `color()`   | Sets a shape's colour                                        | Use `cut()`, `score()`, `engrave()` or `layer()`           |
| Fonts       | Looks up system fonts                                        | Uses fonts supplied by the application or CLI              |
| Libraries   | Can load local files                                         | Loads the standard library and sources allowed by the host |

Assignment order is especially important when adapting a design. A value
assigned later in a KerfScript program does not change earlier geometry.

## Not in KerfScript

KerfScript does not support `cube`, `sphere`, `cylinder`, `polyhedron`,
`linear_extrude`, `rotate_extrude` or `projection`. It also does not support
`minkowski`, `resize`, `color`, `import`, `surface` or `render`.

Calls to these modules produce an error. For a design based on an extruded
2D outline, start with that outline and remove the extrusion.

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
