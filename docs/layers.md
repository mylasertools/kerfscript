# Layers

Layers separate cutting, scoring and engraving in the exported file. Use
them to give different parts of a design different operations in your laser
software. Unassigned shapes go on the `cut` layer.

## The built-in layers

| Layer     | Wrap shapes in | Colour in the file | Intended operation         |
| --------- | -------------- | ------------------ | -------------------------- |
| `engrave` | `engrave()`    | black `#000000`    | Fill an area               |
| `score`   | `score()`      | blue `#0000ff`     | Mark a line or outline     |
| `cut`     | `cut()`        | red `#ff0000`      | Cut through the material   |
| `guide`   | `guide()`      | light blue         | Show construction geometry |

This coaster has a cut outline and hole, an engraved ring and a scored border:

```kerf
difference() {
  circle(d = 90);
  circle(d = 6);
}
engrave() difference() { circle(d = 74); circle(d = 68); }
score() circle(d = 84);
```

The layer describes the operation. Set its power, speed and passes in your
laser software.

Place `#` or `%` before a module call to move it to the guide layer.
Guides are excluded from the output unless you request them with
`--guides` on the command line or `guides: true` in the API.

## Areas and lines

Shapes such as `rect()`, `circle()` and `text()` define areas. On an
engrave layer, those areas are filled. On cut and score layers, their
outlines become paths.

`line()`, `polyline()`, `arc()` and `living_hinge()` produce lines. They
remain lines on every layer. A living hinge, for example, is a pattern of
open cuts within a part.

Use `stroke(width)` to turn a line into an area of a specified width. Use
`outline()` to turn an area's boundary into lines.

### Overlapping shapes merge

The areas inside one `score()` are merged first, like a `union()`, and
only the outline of the result is scored. Two nested circles become one
disc, so this scores a single ring:

```kerf
circle(d = 60);
score() {
  circle(d = 50);
  circle(d = 40); // inside the first circle: merged away
}
```

To score every shape's own outline, turn each one into lines first with
`outline()`. Lines are never merged, so this scores both rings:

```kerf
circle(d = 60);
score() {
  outline() circle(d = 50);
  outline() circle(d = 40);
}
```

One `outline()` around both circles would not help: it merges them before
it traces them. The same rule holds on the cut layer and on custom
layers. Use `difference()` when you want the area between two outlines,
such as a ring to engrave.

## The material

Closed shapes on a part's cut layer define its material. KerfScript clips
engraving, scoring and open cut lines to that area, excluding holes. Start
with a cut shape when adding marks to a part.

If the cut shapes form separate pieces, KerfScript reports a warning. Check
for a missing connection or define the pieces as separate parts.

## Your own layers

Use `layer(name, mode, color)` when you need another operation, such as a
second engraving depth:

```kerf
rect([60, 40]);
layer("deep", mode = "fill", color = "#00aa00")
  translate([10, 10]) rect([20, 20]);
engrave() translate([40, 20]) circle(d = 12);
```

The rectangle and circle use separate engraving layers. You can assign each
a different power in your laser software. Supported modes are `"cut"`,
`"line"`, `"fill"` and `"guide"`.

## The back face

`engrave(side = "back")`, `score(side = "back")` and `layer(name, side =
"back")` mark the face underneath, made after the parts are turned over.
Draw the marks where they are on the part seen from the top; text reads
the right way round on the back. They go into each sheet's back job,
turned over left to right, and not into the front file.

## Painting in order

`paint()` lays shapes like paint, each over the ones before: every child
loses the area of the children after it. Give it a layer for each child,
and a picture in several tones comes out with no two layers overlapping:

```kerf
layer("light", mode = "fill", color = "#c8a070");
layer("dark", mode = "fill", color = "#000000");
part("tile") {
  rect([60, 60]);
  paint(["light", "dark"]) {
    circle(d = 50);
    translate([30, 30]) circle(d = 20);
  }
}
```

A child given the layer `""` is left out, but still covers the ones
before it: a bare patch.

## Printing on parts

To print on the parts and then cut them, `layer(name, mode = "fill",
bleed = 2)` lets the printed layer run 2 mm past each part's edge, so the
cut never leaves a bare rim. `$registration = true` puts marks in three
corners of every sheet, on the `registration` layer, for a print-and-cut
machine to line the cut up with the print.

## Order in the file

KerfScript writes layers in this order: engrave, custom fill layers,
custom line and cut layers, score, cut, then guide, so a line is never
hidden under a fill. `layer(name, order = n)` moves a custom layer among
the others, lowest first. Within a cut layer, inner paths precede outer
outlines.

Laser software may reorder these paths. Check its job preview so engraving
runs before cutting and holes are cut before the surrounding part.
