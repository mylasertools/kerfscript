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

### Copies that differ

Inside `part(qty = n)`, `$copy` is the copy being drawn, 0 up to n - 1. A
part whose drawing reads it is drawn once for each copy, so a set of
ornaments takes a name each, or drawers a number each:

```kerf
names = ["Anna", "Ben", "Cleo", "Dan"];
part("tag", qty = len(names)) {
  difference() { rect([50, 20], r = 3); translate([6, 10]) circle(d = 4); }
  engrave() translate([30, 10]) text(names[$copy], fit = [32, 10], halign = "center", valign = "center");
}
```

Copies that come out alike stay one part; each that differs is a part of
its own with the same name, and the parts list says which copies it is:
`tag (copies 1, 4) x2`. With `at` given per copy, each goes to its own
place.

### Stacks, mirrored pairs and glued layers

- `stack = 3` glues three layers at each placement, one thickness apart:
  thick feet, posts and blocks from thin sheet. The parts list says how
  many make a stack.
- `material = "red acrylic"` names the material the part is cut from,
  as wrapping it in `material(name = "red acrylic")` would.
- `pieces = 2` says the part is meant to cut into two separate pieces,
  as a pair of eyes glued on side by side; `pieces = "any"` takes any
  number. Without it, a part in pieces warns, as a missing connection
  usually makes one. A part that cuts into a different number of pieces
  than `pieces` says still warns.
- `paint = "red"` paints the part after cutting: the 3D view and the
  print layout show it red, while it stays on the sheet of its material.
  `material = "red acrylic"` is for stock that comes red, and puts the
  part on a sheet of its own. A colour is a name (`red`, `orange`,
  `yellow`, `light yellow`, `green`, `dark green`, `light green`, `lime`,
  `olive`, `blue`, `dark blue`, `light blue`, `navy`, `teal`, `purple`,
  `pink`, `light pink`, `maroon`, `brown`, `light brown`, `dark brown`,
  `tan`, `beige`, `peach`, `cream`, `skin`, `white`, `black`, `grey`,
  `light grey`, `dark grey`, `silver`, `gold`, `copper`)
  or a hex colour such as `"#c8372d"`. To paint only some areas, use a
  paint layer, as [Layers](layers.md#painted-areas) shows.
- `mirror = true` cuts the part mirrored left to right. A lopsided end
  plate's other half is the same part mirrored, and its engraving still
  reads the right way round. A mirrored copy of a bent part bends as its
  mirror image: give `bend` as for the part itself.
- `glue = "top plate", face = "top"` lays a part on another part's face,
  its `at` and `rotate` measured on that face. Move the plate, and what is
  glued on it moves too. A stack glued under a part (`face = "bottom"`)
  grows down, away from it. A part glued to a stack goes on the stack's
  outer layer, on top of it or under it.

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
bent by a living hinge cuts slots for the tabs on its straight runs. A part
must reach 1 mm into it (or half way through a thinner one) to cut a slot,
and a blind tab's slot goes through: one that only dips into the surface is
misplaced, and the collision check reports it rather than a
slot hiding it. Each tab is judged on its own depth, however deep the
others of its part go.

The layers of a stack each cut the slots that pass through them. When they
differ, as a bench top of `stack = 2` taking the legs' tabs in its lower
layer and a vice's in its upper one, the stack becomes a part per layer,
`top, layer 1` and `top, layer 2`, so blind joints don't show through.
`halving = "top"` still finds both, and `--print` still prints them as
one stack.

```kerf
part("shelf", slots = ["back"]) rect([100, 60]);
part("back", at = [0, 55, 3], rotate = [75, 0, 0]) {
  rect([100, 60]);
  for (x = [20, 70]) translate([x, -6]) rect([10, 6.01]);
}
```

Parts that only touch cut nothing: a wall standing on a shelf without tabs
leaves it whole.

When tabs of two parts land in the same place in a third, as walls of two
storeys lining up over a floor, the check names both and where they meet,
so one can move its tabs along the edge.

A hook that goes in through its slot and then drops, as on a pegboard,
needs a slot taller than its tab: `slot_extra = [0, 6]` sweeps each slot
6 mm further along the receiving part's own y.

### Halving joints

Two plates that cross, as the dividers of an egg crate or the ribs and
rings of a lamp, each take a slot halfway through from opposite sides.
Give one of them `halving = ["Rib*"]` and both are cut: where they cross,
each gets a strip as wide as the other plate's section (wider when they
meet at an angle), `clearance` more, from the middle of the crossing out
through its own edge. The slots run the way that leaves both parts
soonest, so a ring is slotted from its inner rim and a rib notched from
its outer edge, and a slot stops at the first edge it meets, never across
a hole to the far side.

```kerf
part("Ring", at = [0, 0, 30], halving = ["Rib"])
  difference() { circle(r = 55); circle(r = 45); }
part("Rib", qty = 4, at = [for (a = [0:90:270]) [-1.5 * sin(a), 1.5 * cos(a), 0]],
     rotate = [for (a = [0:90:270]) [90, 0, a]]) translate([10, 0]) rect([50, 60]);
```

### Bores for axles and dowels

A mechanism's axles pass through several parts: the frame they turn in, and
the wheels, cams and cranks fixed on them. Declare the axle once as
hardware and let each part cut its own hole: `bores = ["Crank axle"]` cuts,
through this part, the section of the hardware labelled so (or of that
kind) wherever it passes through in the assembly. An axle at an angle cuts
the longer hole it needs, and a square or hexagonal rod its own shape.

The fit sets the room round the rod: `fit = "turn"` (the default, 0.3 mm on
the diameter) for a part that turns on it, `fit = "press"` (0.1 mm under)
for one held fast, or a number of millimetres. Measure your laser's kerf
and your dowels with `kerf/calibration`, and adjust.

```kerf
hardware("dowel", [30, -5, 20], [30, 40, 20], 6, label = "Crank axle");
part("Side", qty = 2, at = [[0, 3, 0], [0, 33, 0]], rotate = [90, 0, 0],
     bores = ["Crank axle"]) rect([60, 40]);
part("Cam", at = [30, 18, 20], rotate = [90, 0, 0], bores = ["Crank axle"],
     fit = "press") circle(d = 30);
```

### Bends

A living hinge bends a part, and the assembled view can show it bent.
`bend = [x0, x1, angle]` bends the part along its x between x0 and x1, the
far end folding up towards its top face by `angle` degrees (down for a
negative angle); give a list for more than one bend, or an empty list
for none. The hinge's middle
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

### Folds

Card and paper fold along any line, not only along x. `fold = [from, to,
angle]`, or a list of them, folds the part along the line from one point
to the other in the assembled view: the folds cut it into panels, the
panel at the part's origin (else the biggest) stays flat, and each other
panel turns about the folds between it and that one, towards the top face
for an angle more than 0 and down for less. A fold must run from edge to
edge, or to a cut: cut lines inside the part, as a pop-up's slits, part
the panels too, and a fold that divides nothing warns. `fold_open = 0.5`
folds every fold half way, for a card shown half open; 0 lies flat.

Score the folds as well, so the card bends where it should:

```kerf
$thickness = 0.4;
open = 1; // [0:0.05:1]
// A card with a pop-up step in the middle: two slits across the fold
part("card", at = [0, 0, 0], fold_open = open, fold = [
  [[80, 0], [80, 40], 90], [[80, 60], [80, 100], 90],
  [[70, 40], [70, 60], 90], [[80, 40], [80, 60], -90], [[90, 40], [90, 60], 90]
]) {
  rect([160, 100]);
  for (y = [40, 60]) line([70, y], [90, y]);
  score() {
    line([80, 0], [80, 40]); line([80, 60], [80, 100]);
    for (x = [70, 80, 90]) line([x, 40], [x, 60]);
  }
}
```

A part bends on living hinges or folds, not both. Folds show in the
assembled view and its 3D files; flat and print layouts lie flat.

### Hanging parts

A part that hangs, as a shelf sitter's legs on cords or a charm on a ring,
swings until its weight is straight below the point it hangs from.
`hang = [x, y]` is that point on the part, in its own coordinates, and
`at` is where it hangs in the assembly; `rotate` sets the plane it swings
in. `cord = 20` hangs it 20 mm lower on a cord, which goes in the hardware
list and the 3D view; without it the part hangs on a ring or pin at `at`.

```kerf
$thickness = 3;
part("body", at = [-20, 0, 0], rotate = [90, 0, 0]) rect([40, 50]);
// Legs drawn lying down: each swings down from its top end
part("leg", qty = 2, at = [[-10, -1.5, 2], [10, -1.5, 2]], rotate = [90, 0, 0],
     hang = [0, 0], cord = 20) translate([0, -4]) rect([40, 8]);
```

### Numbered parts

`$label_parts = true;` numbers the parts 1, 2, 3 in the order they are
made and engraves each number small on the part's back face, where it has
the most room, so a buyer can tell alike pieces apart once they are out of
the sheet. The numbers come in the back job (`design-back.svg`), and
`kerf check` puts them in the parts list and after each step: `step 2:
Glue the lock on the front (parts 6, 7, 8)`. JavaScript gets each part's
`label`. A part with no room for its number warns.

### Steps and hardware

`step("Glue the sides to the bottom") { ... }` makes an assembly step of
the parts inside it. The steps keep the order they first run in. The 3D
view in the playground and on the model pages builds the model a step at
a time, each step's parts coming down into place. Parts outside any step
are there from the start.

A step inside a step is a sub-step, named after both: a chair module with
its own `step("Glue the seat")`, placed inside `step("Add the chair")`,
adds the step "Add the chair: Glue the seat". So a piece of furniture
builds step by step on its own and inside a room. `step("Add the chair",
substeps = false)` takes everything inside into the one step instead.

`hardware(kind, from, to, size)` lists what else the model needs: a dowel
from one point to another, a screw, a magnet, a strip of paper. `size` is
a diameter, or `[w, h]` for a flat piece. `kerf check` lists the hardware
with the parts, and the 3D view shows it.

`shape = "ball"` (or `sides = 0`) makes a ball of diameter `size` midway
between `from` and `to`, for a light bulb, a marble or a bead. A ball may
leave `to` out and sit at `from`: `hardware("bulb", [0, 0, 120], size = 60,
shape = "ball")`.

The kinds are these; a colour (`pink`, `yellow`, `red`, `green`, `blue`,
`orange`, `purple`, `black`, `grey`) works too, and any other kind warns
and shows grey. JavaScript gets the list as `HARDWARE_KINDS`.

| Kind       | What it is                                   | Shown                |
| ---------- | -------------------------------------------- | -------------------- |
| `dowel`    | a wooden dowel or axle                       | matt, #e2c48f        |
| `steel`    | a steel rod, pin or axle                     | metal, #a7adb3       |
| `brass`    | a brass rod, tube or pin                     | metal, #c9a227       |
| `screw`    | a screw                                      | metal, #9aa0a6       |
| `bolt`     | a bolt                                       | metal, #9aa0a6       |
| `nut`      | a nut                                        | metal, #9aa0a6       |
| `magnet`   | a disc or block magnet                       | metal, #55585c       |
| `paper`    | a sheet or strip of paper                    | translucent, #fbfaf6 |
| `vellum`   | vellum or tracing paper, as a lantern window | translucent, #f3efe2 |
| `card`     | card stock                                   | matt, #f4f1e8        |
| `felt`     | felt pads or lining                          | matt, #6f6a64        |
| `elastic`  | an elastic band or cord                      | matt, #262626        |
| `cord`     | cord, string or thread                       | matt, #b23a3a        |
| `ribbon`   | ribbon or tape                               | matt, #c2485a        |
| `wire`     | wire                                         | metal, #b87333       |
| `led`      | an LED or a strip of them, lit               | glowing, #fff4c2     |
| `bulb`     | a light bulb, lit                            | glowing, #fff4c2     |
| `tealight` | a tealight, lit, its flame flickering        | metal, #d4d8dc       |
| `ball`     | a marble, ball or bead                       | matt, #8fb8d8        |
| `tube`     | a tube or hollow arbor                       | metal, #c9a227       |
| `lens`     | a lens                                       | matt, #d6ecf3        |
| `mirror`   | a mirror                                     | metal, #c8d3da       |
| `movement` | a bought clock, music box or motor movement  | matt, #3d3d3d        |
| `white`    | anything white                               | matt, #f7f7f4        |

### Lights

A tealight, an LED and a bulb give off light: the 3D view lights the model
with them, and GLB files carry them as point lights, for a render of a
lantern or a tealight house lit up. "Dim the room" in the 3D view turns the
room's lights down to show them.

- `hardware("tealight", [x, y, z])` stands a tealight, 39 mm across and
  16 mm high, on that point. Its flame burns 10 mm above the cup and
  flickers. Give `to` and `size` for another size, as `size = 59` and `to`
  24 mm above for a maxi tealight.
- `hardware("led", from, to)` longer than 20 mm is a strip of LEDs, lit
  all along; a shorter one, or a ball, is a single LED.
- `hardware("bulb", at, size = 60, shape = "ball")` is a bulb.
- `light(at, color = "warm white", lumens = 20)` is a light with nothing
  to show for it, as a battery light hidden in a base. `to = [x, y, z]`
  makes it a strip, and `flicker = true` a flame. The colour is `"warm
white"`, `"white"`, `"cool white"`, `"warm"`, `"flame"`, a paint
  colour's name or a hex colour.

```kerf
part("base", at = [-40, -40, 0]) rect([80, 80]);
hardware("tealight", [0, 0, 3]);
light([0, 0, 60], "cool white", lumens = 40);
```

`render()` returns the lights as `lights`: each has `from` and `to` (the
same point unless it is a strip), `color`, `lumens`, `flicker`, `source`
(`"tealight"`, `"led"`, `"bulb"` or `"light"`), `step` and `label`.

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

The 3D view and 3D files colour each part by the woods, sheets and colours
named in its material. A clear material (`clear`, `acrylic`, `perspex`,
`glass`) shows see-through. A translucent one (`vellum`, `tracing` paper,
`parchment`, `rice paper`, `frosted` acrylic, `paper`) lets light through:
a tealight behind a vellum window shows through it, and in GLB files it is
partly transparent with `KHR_materials_transmission`, so a renderer lights
it from behind. `hardware("vellum", ...)` and `hardware("paper", ...)` are
translucent too.

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

`part(split = true)` cuts a part too big for the bed, as large wall art, a
wreath or a sign, into pieces that fit the sheet less its margins;
`split = [w, h]` gives the size instead. The cuts run across the part in
columns and rows, each where it crosses the least material and keeps off
engraving, and where a cut crosses material it is joined by jigsaw knobs
`$knob` (12) mm across, with `$knob_clearance` (0.15 mm) between a knob and
its socket, placed clear of engraving. Each piece is a part of its own,
`"wreath piece 1"` up, in its place in the assembled view, and the parts
list says which pieces it joins.

```kerf
$sheet = [300, 200];
part("wreath", split = true) {
  difference() { circle(d = 480); circle(d = 320); }
  engrave() for (a = [0:30:330]) rotate(a) translate([200, 0]) circle(8);
}
```

Either way, parts of different materials or thicknesses go on separate
sheets: plywood parts on one, acrylic on another.

The CLI `--margin` option and API `margin` option let you set the edge
spacing separately from the gap between parts.

Your laser's bed can be set once for a project: `"sheet": [600, 400]` in the
project's `kerf.json` is the sheet for every design in it that does not
set `$sheet`.

With `$nest = true` (or `--nest`), small parts go into the holes of bigger
ones before the rows are packed: the rings of a stacked vase or globe each
inside the next, washers inside a wheel. A part goes into a hole only
where its outline, `$gap` all round, fits.

Copies of a curved part are packed in rows, every other one turned 180
degrees and slid up against the one before, `$gap` clear, when that takes
much less room than their boxes side by side: S-shaped ribs, crescents and
L brackets nest into each other, so 24 lamp ribs that took four sheets fit
on one. Rectangles and other parts that don't nest are packed as before.

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

The back job is the front file turned over within the file's own width,
the width in its SVG (`sheet.width` in JavaScript), not your stock's. On
stock just as wide as the file, the same corner lines up. On wider stock,
a 300 mm sheet for a 46 mm wide file, the turned-over parts lie the
difference further right, 254 mm here: start the back job that far from
the corner, or cut the stock to the file's width first.

```kerf
part("coaster") {
  circle(d = 90);
  engrave() text("TEA", size = 16, halign = "center", valign = "center");
  engrave(side = "back") text("made for you", size = 6, halign = "center");
}
```
