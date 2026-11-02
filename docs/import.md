# Importing SVG drawings

`kerf import` turns an SVG drawing into a KerfScript program that cuts the
same shapes. Use it to make an existing design parametric, or to continue
a design drawn in Inkscape, Illustrator or a box generator.

```sh
kerf import ornament.svg               # writes ornament.kerf
kerf import ornament.svg -o tree.kerf
kerf import ornament.svg -o -          # prints the program
```

The importer looks for the shapes KerfScript has modules for and writes
those modules instead of a list of points:

| In the drawing                                     | In the program                                  |
| -------------------------------------------------- | ----------------------------------------------- |
| Circles, ellipses, rectangles, rounded rectangles  | `circle()`, `ellipse()`, `rect()`               |
| Regular polygons and stars                         | `regular_polygon()`, `star()`                   |
| A small round hole high up in the middle of a part | `hanging_hole()`, or two of them with `spacing` |
| A round hole with a slot, for hanging on a screw   | `keyhole()`, or `keyholes()` for a level pair   |
| A ring around a hole on the edge of an ornament    | `hanging_loop()`                                |
| A rectangle with tabs                              | `tab_rect()`, or `tabs()` on each side          |
| A row of slots the tabs go through                 | `slots()`                                       |
| A rectangle with finger joints                     | `finger_rect()`                                 |
| Holes a divider's fingers go through               | `finger_holes()`                                |
| Fingers and notches from another program           | `rect()` with the notches cut out, in loops     |
| The same hole repeated in a row or a grid          | a `for` loop                                    |
| Anything else                                      | `polygon()` or `path()`, exactly as drawn       |

For example, a sign with a hanger hole, a keyhole and a row of holes comes
back as:

```kerf
// sign.svg: imported from an SVG drawing.
// 1 part; found 1 rectangle, 1 hanger hole, 7 circles, 1 hole pattern, 1 keyhole.

use <kerf/hanging>

$layout = "none"; // keep the parts where the drawing has them

translate([3, 3]) part("sign") {
  difference() {
    rect([120, 80], r = 5);
    hanging_hole([60, 70]);
    for (x = [30:10:90]) translate([x, 30]) circle(d = 3);
    translate([20, 60]) keyhole();
  }
}
```

Change a number and render it to get a new version of the design.

## Checked against the drawing

Every part is run once it is written and compared with the drawing. A
shape is only written as a module when its outline is within 0.05 mm of
the drawn one; set this with `--tolerance`. When a part's modules do not
match the drawing closely enough, the part is written as it is drawn, and
a comment at the top of the program says so. A part that no shape can
reproduce exactly is cut as the lines it is drawn with. Nothing in the
drawing is left out because it was not recognised.

## Parts, holes and layers

Each closed cut outline is a part, and the outlines inside it are its
holes. An outline inside a hole is a part again: a piece that falls out.
Parts are named after their group or element, as `id`, Inkscape label or
Illustrator layer name, and otherwise numbered.

Colours become [layers](layers.md), as most laser software reads them:

- Red lines are cut and blue lines are scored. Without red, the colour
  used most is cut.
- Filled shapes without a line are engraved. A drawing with no lines at
  all is a silhouette, and its filled shapes are cut out.
- Groups named cut, score, engrave or guide put their shapes on that
  layer, whatever their colour. Files that KerfScript wrote come back on
  the layers they were written from.
- Lines in other colours go on a layer of their own, named after the
  colour, set to mark and not cut.

Lines that meet end to end are joined. A loop of lines becomes a hole
when nothing is inside it, and stays as cut lines when it holds marks or
other lines, as a piece to press out does.

Some drawings cannot be held as shapes and stay cut lines exactly as
drawn: outlines that touch or cross a hole of the same part, holes that
overlap, outlines that cross themselves or have a slit drawn into them,
and closed paths with no area. Lines and marks that leave the part they
start in are kept on their own, so the part does not trim them. In a
silhouette, each filled shape is a piece of its own.

Text keeps its words, size and alignment and is written as `text()` in
the built-in font, with the drawing's font named in a comment; to use
that font, add `font = "..."` to the `text()` and pass the font file to
`kerf render` with `--font`. Text on the cut layer cuts the letters of
that font, not the drawing's: convert it to paths in your editor to cut
it as drawn. Embedded images and hidden elements are left out, and the
comment at the top says how many.

## Material thickness and kerf

The depth of tabs and finger joints gives the material thickness, written
as `$thickness`. Change it and the joints follow. A part whose joints are
deeper, such as a tenon through a thick leg, gets its own
`material(thickness = ...)`.

Many drawings are made for one laser: their cut outlines are moved out by
half the beam's width, which rounds every outer corner a little. The
importer finds that, moves the outlines back to the sizes they were
designed at, and sets [`$kerf`](kerf.md) so the program cuts the same. A
part that cannot be moved back exactly, such as a strip as narrow as the
kerf, keeps its outlines as drawn and is cut with `material(kerf = 0)`.
Use `--kerf 0` to take the outlines as drawn, or `--kerf 0.15` to give the
kerf yourself.

## Layout

The program keeps the parts where the drawing has them, with
`$layout = "none"`. With `--pack`, identical parts become one part with a
quantity, and KerfScript arranges them on sheets as usual.

## Units

Drawings in millimetres, centimetres, inches or points are read at their
size. A drawing measured in pixels is read at 96 pixels per inch, or 72
for an Adobe Illustrator file; give another with `--dpi`.

## In JavaScript

`importSvg(svg, options)` does the same in a browser or in Node.js, and
returns the program as `source`. `svg` is the text of the drawing or the
bytes of its file:

```js
import { importSvg } from '@mylasertools/kerfscript';

const { source, summary, notes } = importSvg(svgText, { tolerance: 0.05 });
```

`summary` says in words how many parts there are and what was found, and
`notes` holds the remarks written at the top of the program. The options
are `dpi`, `tolerance`, `kerf`, `pack` and `name`, the drawing's name for
the first comment. See [JavaScript](javascript.md#importsvg).
