# Parts and sheets

Use parts to name the pieces in a design, set quantities and assign
materials. KerfScript lays them out on sheets, grouping parts that use the
same material and thickness.

## Parts

```kerf
part("side", qty = 2) rect([100, 60]);
part("base") rect([100, 100]);
```

This creates two side panels and one base. Each `part()` has its own layers
and appears in the parts list with dimensions and cut length. The default
quantity is one.

Shapes outside a `part()` are collected into a part named `part`.

Transforms and operations such as `translate()`, `difference()` and
`offset()` can wrap a part and change all of it. Layer wrappers such as
`score()` and `engrave()` go inside the part instead, since a whole part on
the score layer would have nothing to cut:

```kerf
part("tag") {
  rect([60, 30], r = 3);
  score() translate([5, 5]) rect([50, 20]);
}
```

## Assembly

Give a part a place in 3D and apps can show the design put together.
`rotate` turns the part and `at` moves it. The turn happens first, the same
as OpenSCAD's `translate(at) rotate(r)`. Each part is drawn flat with its
thickness standing up along +Z.

```kerf
material(thickness = 3) {
  part("base", at = [0, 0, 0]) rect([100, 60]);
  part("wall", at = [0, 3, 3], rotate = [90, 0, 0]) rect([100, 40]);
}
```

A part with copies takes one placement for all of them, or a list with one
for each copy:

```kerf
part("leg", qty = 4, at = [[0, 0, 0], [80, 0, 0], [0, 40, 0], [80, 40, 0]],
     rotate = [90, 0, 0]) rect([20, 60]);
```

`box()` from `kerf/box` places its panels itself, so every box assembles.
Parts without `at` or `rotate` lie flat beside the assembled view, each copy
in rows to its right, and the render names them in a warning. When placed
parts run into each other, the render warns which two collide. That is what
a finger edge set to `"out"` where it should be `"in"` looks like, or a part
placed one thickness off. Joints that interlock exactly do not count, and
neither does an overlap smaller than about a cubic millimetre, the kind of
nick a laser kerf or a press fit takes up. A tab half a millimetre out of its
slot is well over that and gets a warning. The warning says roughly where
in the assembly the two meet.

### Turning a part any way

`rotate` turns about x, then y, then z. To say where a part's own axes
point instead, use `orient(x, z)`: the part's x axis along the first
direction and its top face towards the second.

```kerf
// A panel leaning back 15 degrees, its top face to the front
part("back", at = [0, 60, 3], rotate = orient([1, 0, 0], [0, -cos(15), sin(15)])) rect([100, 80]);
```

`rotation([x, y, z])` gives the matrix of a turn, matrices multiply with
`*`, and `euler(m)` turns a matrix back into angles for `rotate`:
`euler(rotation([0, 0, 30]) * rotation([90, 0, 0]))` stands a part up, then
turns it 30 degrees about z.

### Placing a group

`place(at, rotate) { ... }` moves and turns everything inside it, with
each part's own placement inside the group's. Build a drawer, a crate or a
whole library box at the origin and place it where it goes:

```kerf
use <kerf/box>

place(at = [20, 10, 30], rotate = [0, 0, 90]) box([80, 60, 40], name = "crate");
```

### Stacks, mirrored pairs and glued layers

- `stack = 3` glues three layers at each placement, one thickness apart:
  thick feet, posts and blocks from thin sheet. The parts list says how
  many make a stack.
- `mirror = true` cuts the part mirrored left to right. A lopsided end
  plate's other half is the same part mirrored, and its engraving still
  reads the right way round.
- `glue = "top plate", face = "top"` lays a part on another part's face,
  its `at` and `rotate` measured on that face. Move the plate, and what is
  glued on it moves too.

```kerf
part("seat", at = [0, 0, 40]) rect([80, 80], r = 6);
part("cushion", glue = "seat", at = [6, 6, 0]) rect([68, 68], r = 10);
part("leg", qty = 4, stack = 4, at = [[0, 0, 0], [70, 0, 0], [0, 70, 0], [70, 70, 0]]) rect([10, 10]);
```

### Slots from the assembly

Draw the tabs on one part and let the part they go into cut its own slots:
`slots = ["back", "divider"]` cuts, through this part, the cross-section of
those parts wherever their material passes through it in the assembly,
`clearance = 0.1` wider. It works at any angle, so a back leaning 15
degrees gets slots as long as its tabs' slanted cross-section, and a strip
bent by a living hinge cuts slots for the tabs on its straight runs.

```kerf
part("shelf", slots = ["back"]) rect([100, 60]);
part("back", at = [0, 55, 3], rotate = [75, 0, 0]) {
  rect([100, 60]);
  for (x = [20, 70]) translate([x, -6]) rect([10, 6.01]);
}
```

Parts that only touch cut nothing: a wall standing on a shelf without tabs
leaves it whole.

### Bends

A living hinge bends a part, and the assembled view can show it bent.
`bend = [x0, x1, angle]` bends the part along its x between x0 and x1, the
far end folding up towards its top face by `angle` degrees (down for a
negative angle); give a list for more than one bend. The hinge's middle
layer keeps its length, so the radius follows from the hinge's width.
Parts glued on a bent part take `on = "name"` and move with the run they
sit on. `flex_strip()` in `kerf/hinge` works out the bends of a strip that
follows a profile.

```kerf
use <kerf/hinge>

// A cover that wraps round a 20 mm spine
part("cover", bend = [[100, 100 + bend_length(10, 90), 90], [130, 130 + bend_length(10, 90), 90]])
  flex_rect([260, 150], [100 + bend_length(10, 90) / 2, 130 + bend_length(10, 90) / 2], width = bend_length(10, 90));
```

The collision check takes each flat run of a bent part on its own.

### Steps and hardware

`step("Glue the sides to the bottom") { ... }` makes an assembly step of
the parts inside it. The steps keep the order they first run in. The 3D
view in the playground and on the model pages builds the model a step at
a time, each step's parts coming down into place. Parts outside any step
are there from the start.

`hardware(kind, from, to, size)` lists what else the model needs: a dowel
from one point to another, a screw, a magnet, a strip of paper. `size` is
a diameter, or `[w, h]` for a flat piece. `kerf check` lists the hardware
with the parts, and the 3D view shows it.

```kerf
step("Stand the walls in the base") {
  part("base", at = [-30, -40, 0]) rect([60, 80]);
  for (y = [-40, 37]) part(str("wall ", y), at = [-30, y + 3, 3], rotate = [90, 0, 0]) rect([60, 40]);
}
step("Slide the axle through the walls") hardware("dowel", [0, -45, 25], [0, 45, 25], 6);
```

## Materials

`material()` sets the thickness, kerf and material name for its parts:

```kerf
material(thickness = 3, kerf = 0.15, name = "plywood") {
  part("front") rect([100, 60]);
  part("back") rect([100, 60]);
}
material(thickness = 2, kerf = 0.1, name = "acrylic") {
  part("window") rect([80, 40]);
}
```

The two plywood panels share a sheet. The acrylic window goes on a separate
sheet. Each part records the `$thickness`, `$kerf` and `$material` values in
effect where it is defined.

## Sheets

Set the available sheet size and spacing in millimetres:

```kerf
$sheet = [300, 200];
$gap = 4;
```

With the default `$layout = "pack"`, KerfScript arranges copies of each part
in rows, leaving the specified gap. It rotates a part 90° if that lets it
fit the sheet. The default sheet is 600 × 400 mm, with a 3 mm gap between
parts and at the sheet edges.

A part larger than the sheet produces a warning. Set `$layout = "none"`
to keep the positions from your code instead of packing the parts.

The CLI `--margin` option and API `margin` option let you set the edge
spacing separately from the gap between parts.

Your laser's bed can be set once for a project: `"sheet": [600, 400]` in the
project's `kerf.json` is the sheet for every design in it that does not
set `$sheet`.

With `$nest = true` (or `--nest`), small parts go into the holes of bigger
ones before the rows are packed: the rings of a stacked vase or globe each
inside the next, washers inside a wheel. A part goes into a hole only
where its outline, `$gap` all round, fits.

## One file per sheet

A combined SVG stacks all sheets in one preview. For the material example
above, export the plywood and acrylic sheets separately and cut each with
the matching material settings.

- On the command line, add `--split` to write `design-1.svg`,
  `design-2.svg` and so on. `kerf check` lists each sheet's material and
  thickness.
- In JavaScript, `result.sheets` provides the SVG, DXF, material and
  thickness for each sheet.

DXF exports contain one sheet per file.

## The back face

Marks for a part's underside go on `engrave(side = "back")` or
`score(side = "back")`, drawn where they are on the part seen from the
top. They are left out of the sheet's file and go into a second job, the
sheet turned over left to right: `design-back.svg` from the command line,
`sheet.back` in JavaScript. Cut and engrave the front, turn the whole
sheet over without moving the parts in it, line it up on the same corner
and run the back job.

```kerf
part("coaster") {
  circle(d = 90);
  engrave() text("TEA", size = 16, halign = "center", valign = "center");
  engrave(side = "back") text("made for you", size = 6, halign = "center");
}
```
