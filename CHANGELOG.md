# Changelog

## Unreleased

Language:

- `assert(c, msg) expr` and `echo(...) expr` check or trace before an
  expression, so a library function can refuse bad sizes itself; `let` (and
  a function literal) can follow an operator.
- `sort(values, key)`, `fold(values, initial, fn)` and `scan(values,
initial, fn)`; `bounds(points)` and `crossings(points, x | y)` for
  outlines as point lists.
- `intersection_for` intersects its iterations, as in OpenSCAD.
- `part(qty = 0)` makes nothing; `largest(n)` keeps the biggest pieces of the
  material; `join_islands(width)` joins every piece to the rest.
- `text(weight = "bold")` and `text(bridge = w)` for cut-out lettering;
  `symbol(solid = true, bridge)` cuts a pictogram in one piece with its
  detail engraved.

Plotting (line art as pen plotters draw it, for score and engrave lines):

- `noise(x, y, z, seed, octaves)`: smooth gradient noise, or of a point
  `noise(p / 30)`.
- `flow(field, spacing, step, min_length, seed)` fills an area with evenly
  spaced lines that follow a direction field: an angle, or a function of
  the point giving degrees, a vector, or `undef` where lines stop.
- `contours(field, levels, interval, cell)` draws where a height field
  crosses each level across an area.
- `occlude()` draws its children back to front, each opaque: lines and
  outlines hide behind later areas, with each `for` iteration a child of
  its own; `hide()` is an area that covers without being drawn. Stacked
  ridgelines, landscapes and overlapping shapes score without double lines.
- `$join_lines = true` joins lines that meet end to end and orders them
  nearest first, so the laser travels less between them.

Joints, mechanisms and layout:

- `part(bores = ["Crank axle"], fit = "turn" | "press" | mm)` cuts holes
  where hardware rods pass through, at any angle.
- `part(halving = ["Rib*"])`: crossing plates each slotted halfway, from
  opposite sides.
- `part(slot_extra = [dx, dy])` sweeps slots for parts that drop in.
- `kerf check` names two parts whose tabs meet in one slot.
- A setting marked `// [0:5:360] drive` is the one that moves the model:
  `kerf check --drive` tries every value, and the playground plays it.
- Copies of curved parts pack in rows, every other one turned, when that
  takes fewer sheets (24 S-curved ribs: four sheets to one).
- `kerf/fit`: `fit(size, mode, anchor)` and `align(anchor)` for drawings of
  unknown size.

Fixes:

- Slots: an edge lying on a face (a gable wall's top under its roof) is
  touching, not a slot the length of the contact. The slot spans the part
  only across from what goes deeper than the touching tolerance, so a tab's
  flared shoulder is still cut. This removes stray slots from roofs whose
  walls also tab through them.
- Sheet items of mirrored copies (`mirror = [false, true]`) keep their copy
  numbers from the assembly; both used to say copy 1.
- A module that uses `children(i)` past the last child it was given warns,
  with the call's line: `m() a(); b();` gives m() one child.
- Two libraries defining a module or function of the same name warn once,
  naming both files; the later one is still used.
- A collision is reported at a point inside the overlap, not the middle of
  the two parts' boxes.

## 0.8.0 (2026-11-08)

Language version 0.3, as in 0.7.0: programs run as before.

- `hardware(shape = "ball")` (or `sides = 0`) is a ball of diameter `size`
  midway between `from` and `to`, which it may leave out: a bulb, a marble
  or a bead. The 3D view draws it, and verification gives it an envelope.
  New hardware kinds: `bulb`, `ball`, `tube`, `lens`, `mirror` and
  `movement`.
- `measure()` also sets `$area` and `$centroid`, the area of the material
  its first child cuts and its balance point.
- `offset_path(points, d, closed)` moves a path sideways with mitred
  corners: the two edges of a strip along a curve.
- `train_for(ratio, stages, pinion, wheel)` gives tooth counts for a gear
  train of 1 to 3 stages nearest a ratio.
- `kerf/linkage`: `circle_meet()`, `slider_crank()`, `slider_stroke()`,
  `four_bar()`, `four_bar_turns()` and `link_angle()` give where a
  linkage's joints are at a crank angle.
- `kerf/cones`: `cone_flat()` cuts a cone or cut-off cone flat, with a
  scored glue tab, and `cone_pattern()` gives its sector.
- `kerf/sizes`: `part_size()` gives the sizes of bought parts: a music box
  movement, a quartz clock movement and marbles.
- `kerf/gears`: `cam()` draws a cam from a lift curve for a knife or
  roller follower, with `cam_rise()` for dwells, rises and falls,
  `cam_follower()` to place the follower and `cam_pressure()` to check it
  won't jam. `geneva_wheel()`, `geneva_lock()`, `geneva_crank()` and
  `geneva_turn()` make a Geneva drive; `ratchet()` and `pawl()` a wheel
  that turns one way only.
- `kerf/sizes`: the instant film photo sizes are now `"instant mini"`,
  `"instant square"`, `"instant wide"` and `"instant classic"`. The old
  names still work.
- `part(material = "red acrylic")` names a part's material without a
  `material()` round it.

## 0.7.0 (2026-11-03)

Language version 0.3. Programs for 0.2 run as before, except that a
variable no longer hides a function or built-in of the same name: after
`len = 3;`, `len([1, 2])` is 2, where it was an error. Numbers followed by
a unit, which were errors, are now lengths. New warnings and the positions
added to old ones change the text of warnings.

Records: `{kind = "armchair", x = 10}` holds values by name, read as
`s.kind` or `s["kind"]` (a missing field is `undef`), with `keys()`,
`merge()`, `is_record()` and `len()`. `kerf fmt` lays them out as lists.
`call("roses", 40, 30)` calls a module by name, so a table entry can carry
the module that draws it.

Assembly:

- `kerf verify` and the JavaScript verification API check explicit rigid fit,
  shaft capture, conditional retention, material adaptation, cut invariance,
  insertion/tool access, assembly support, static stability, ideal joint mobility
  and continuous translation/rotation clearance. Reports distinguish pass, fail
  and unverified within their stated scope and record input fingerprints.
  `render(..., { analysis: true })` captures nominal cuts and native connections;
  `poseAssembly()` previews the checked paths. Viewer diagnostics highlight
  implicated bodies. Strength, friction and contact-driven mechanics remain
  uncovered. See `docs/verification.md`.

- `place(at, rotate) { ... }` places the parts and hardware inside it, with
  their own placements inside its. `box()` takes a `name` and shapes for
  its front, so a box can be set anywhere.
- `part()` takes `stack = n` (glued layers), `mirror = true` (the left of a
  pair, its text still reading; or one per copy, `mirror = [false, true]`,
  for a pair whose art faces out on both), `bend = [x0, x1, angle]` (a living hinge
  shown bent), `on = "part"` (glued to a bent part and moving with it),
  `glue = "part", face = "top"` (laid on another part's face) and `slots =
["part", ...]`: slots cut wherever those parts pass through it in the
  assembly, at any angle, so tabs are drawn once.
- `step(text) { ... }` makes assembly steps, and `hardware(kind, from, to,
size)` lists dowels, screws, magnets and paper. `render()` returns
  `steps` and `hardware`; `kerf check` lists them.
- `orient(x, z)`, `rotation(angles)` and `euler(matrix)` turn parts any way.
- Collisions are checked for each flat run of a bent part, and a collision
  warning says where in the assembly it is.

A 3D view in the playground (the Assembled tab) and on every model page
(Build it) shows the model put together from the program, bends and
hardware included, and builds it a step at a time.

Drawing:

- `spline(points, width)` and `spline_points()`, `hatch(angle, pitch,
width)`, `pattern(spacing, stagger)` that repeats a tile cheaply,
  `paint(layers)` for painter's order, `measure()` with `$bounds`,
  `fill_holes(min_area)`, `close(r)`, `line(a, b, width)` as an area,
  `text(fit = width)`, and `path(d, close = true)`.
- `intersection()` clips the lines of any child, not only the first, to the
  area of the other children. A child of lines alone leaves no area, so
  `intersection() { outline() circle(d = 20); square(40); }` gives only the
  clipped arc, whichever child comes first.
- `path_length()`, `point_at()`, `heading_at()` and `path_points()` work
  along paths.
- Lengths in real units, as `140cm`, `2in` or `1.2m`, divided by `$scale`.

Output:

- `engrave(side = "back")`, `score(side = "back")` and `layer(side =
"back")` mark the faces underneath, in a second job per sheet turned over
  left to right (`sheet.back`, `name-back.svg`).
- Line layers come after fill layers in the files, and `layer(order = n)`
  sets the order. `layer(bleed = mm)` lets a printed layer run past the
  part's edge, and `$registration = true` adds print-and-cut marks.
- `$nest = true` (`--nest`, the `nest` option) packs small parts into the
  holes of bigger ones.
- A project's `kerf.json` can give `"sheet": [w, h]` for every design in
  it that does not set `$sheet` (the `defaultSheet` option).
- Warnings about a part in pieces, a hole narrower than the kerf and a
  collision say where.
- `kerf check --stats` counts points by part and layer, and `--sweep
name=from:step:to` checks a design over every combination of settings.
- A library's own `use` looks next to it first.
- `use` takes an absolute path, as `use </home/me/lib/props>`.
- A module or function defined with a built-in's name warns that it hides
  the built-in.
- A stack glued under its host (`face = "bottom"`) grows down, away from it.
- A `step()` inside a step is a sub-step ("Add the chair: Glue the seat");
  `step(text, substeps = false)` takes inner steps into itself.
- `kerf verify --summary` (and `triage()`) groups what did not pass by status
  and reason, with the bodies involved and their measurements.
- A slot is cut through the whole thickness of the part, so a shoulder that
  flares just inside its face is covered; parts that only touch still cut
  nothing.
- A stack whose layers meet different parts in slots becomes a part per
  layer (`top, layer 1`), each cutting only its own slots.
- The collision check reports any overlap deeper than 0.1 mm, where it
  needed a cubic millimetre, and slots need a part to reach 1 mm in,
  so a part dipping 0.13 mm into a floor is reported, not slotted.
- `ring_stack()` refuses a hole that leaves its core plates or the base
  between their feet thinner than `$min_width`, naming the smallest hole.
- `children(i)` used several times in one call makes the child once (when it
  only makes a shape), and the point cap is on each shape kept, with ten
  times that for all the work along the way.
- `pattern()` over an area of many small shapes tests and clips each tile
  only against the shapes it may touch: 30 hearts on a facade take 0.2 s,
  not 6.
- `$label_parts = true` engraves each part's number on its back face and
  lists the numbers in `kerf check`'s parts and steps (`label` on each part).
- A `paint()` child lying wholly on an area of the same layer under it
  warns that it can't be seen.
- A fill lying wholly under fills of layers stacked above it in the files
  warns: printed it won't show, engraved it burns twice. Two `paint()`
  calls whose later piece went on an earlier layer do this. Fills narrower
  than 1 mm all along, a stroke's to cover, are left out.
- A part narrower than `$min_width` (1.5 mm unless set; 0 turns it off)
  somewhere warns, saying where.
- `symbol(..., box = "grid")` sizes and places a symbol by its icon set's
  grid, so a set lines up as drawn.
- `kerf render model.kerf -o model.png [--px 1200]` draws a picture of each
  sheet to check by eye: material, fills in their colours, lines on top.
- `kerf instructions model.kerf` (and `instructionsHtml()`) writes printable
  assembly instructions: parts, sheets, and a page per step with the model
  drawn so far, that step's parts picked out.
- `kerf diff a.kerf b.kerf` (and `diffRenders()`) lists what changed between
  two renders, by part and layer, with where.
- `kerf render lib.kerf --call 'roses(40, 30)'` renders one call of a
  library's module, with `-D` setting variables first.
- `--sweep 'w,d=100,80;200,150'` tries settings that go together as sets,
  and `--params-list sets.json` reads the sets from a file.
- Two different parts with one name warn, since slots, glue and `on` find
  parts by name. A length with a unit read before the program sets `$scale`
  warns. `hardware()` warns about a kind outside the documented list
  (`HARDWARE_KINDS`), which adds `steel`, `felt`, `wire` and `led`.
- A setting passed to `render()` (or `-D`, `--sweep`) that the program never
  assigns warns, with the nearest name.
- `hardware(sides = ...)` takes 3 to 128 sides, counted as work toward the
  point limit, and the 3D view never builds more. `kerf render -o x.png`
  keeps a picture to 16 million pixels, 16384 a side, drawing a long thin
  sheet smaller. Redefining a layer that is already another layer's back
  (`layer("score-back", ...)` after `layer("score", side = "back")`) is an
  error rather than quietly moving its marks to the front.
- A bend reaching beyond its part warns, and a 3D view cuts a part's bends
  into at most 2000 bands, only where there is material. `$label_parts`
  warns and leaves the parts unnumbered when the program has a front layer
  of its own named `engrave-back`.
- The playground's downloads include the back-face jobs: a sheet with back
  marks lists back SVG and DXF files, and one such sheet downloads as a ZIP
  of its front and back.
- `kerf verify`: a stability claim over several loads needs its retention
  links to join them into one assembly; loads held to separate roots are
  unverified rather than standing together.

New libraries:

- `kerf/gears`: spur gears, racks, lantern gears and peg wheels,
  eccentrics, snail cams and tappets.
- `kerf/lock`: a lock with a key, three layers deep.
- `kerf/rings`: round things of stacked rings on a crossed core.
- `kerf/joints`: `halved_pair()`, two profiles halved into each other (a
  cross on its foot, a font, a dome), checking the strips beside the slots.
- `kerf/sizes`: paper, card and photo sizes by name.
- `kerf/symbols`: 867 pictograms by name, from open icon sets (see
  THIRD-PARTY-NOTICES.md).
- `kerf/geo`: the world's land from Natural Earth, `world_map()` and
  `is_land()`.
- `kerf/hinge` adds `flex_strip()`, a strip that follows a profile with
  hinges on its curves and tabs on its straights, `strip_bends()` and
  `narrow_hinge()`; `flex_box()` now shows assembled.

## 0.6.0 (2026-11-02)

Language version 0.2, as in 0.5.0: programs run as before.

- Twenty-nine parametric examples, including a tea dispenser,
  jewellery box, drawer cabinet, workshop holders, miniature furniture,
  radial shade, sliding puzzle, game insert, cable chain, cantilever case,
  beam balance, tilting stand, screw press, wheel calendar and laced mat.
  Each has a 3D model in the gallery, and the mechanisms among them move.
- `kerf import` and `importSvg()` turn an SVG drawing into a program. They
  write circles, rectangles, polygons, tabs, slots, finger joints, hanger
  holes, keyholes and hanging loops as the modules that make them, and
  repeated holes as loops. Each part is checked against the drawing and
  written as drawn when it does not match. Colours and group names become
  layers, joint depth becomes `$thickness`, and outlines offset for a kerf
  are moved back with `$kerf` set. A path with bad data is read up to the
  error, as browsers draw it. `kerf import` does not replace a program
  already next to the drawing unless it is named with `-o`. See
  [Importing SVG drawings](docs/import.md).
- The playground imports SVG drawings: choose **Import SVG** or drop a file
  on the editor.
- Lines are clipped to a part reliably. Scoring or cutting a closed
  polyline inside a part could add lines that were not drawn, or stop with
  an out of memory error; lines along a part's edge are now always left
  out, where before some were kept (`topo-island` scores 34 mm less).
- Outlines with a spike drawn out and back, or points in a straight line
  with their neighbours, no longer make rendering run out of memory.

## 0.5.0 (2026-10-31)

Language version 0.2. Programs for 0.1 run as before, except where noted
below: `echo()` keeps the order of its arguments, built-in modules warn
about arguments they do not take, and `[(for ...)]` parses. The six new
standard libraries need 0.2, so a shared library that uses them can say so
with `"language": "0.2"` in its `kerf.json`.

- `@mylasertools/kerfscript/highlight`: syntax colouring as its own small
  module (4 KB), for editors and pages that show KerfScript code. The site,
  the playground and the desktop app use it. It also colours module and
  function names where they are defined, layer modules, `true`, `false`,
  `undef` and `PI`, the `* # %` modifiers, and customizer group headers
  and controls.
- The playground keeps a block comment coloured across all its lines.
- [Specification](docs/specification.md): the formal grammar and the exact
  rules for values, operators, scope, calls, libraries and errors.
- A conformance suite in `conformance/`: 92 small programs with their
  expected output, errors, parts and layers. Every example's output is also
  stored, so a change that alters a saved design fails a test.
- A library that uses or includes itself, directly or through others, is an
  error naming the loop, where it used to fail with "Recursion too deep".
- A comprehension in parentheses can be the first item of a list:
  `[(for (i = [0:2]) i)]`.
- `SIGNATURES` (also `@mylasertools/kerfscript/signatures`): every built-in
  module and function with its parameters, defaults and a line of
  documentation, for editors and help text. Tests keep it in step with the
  interpreter, the highlighter, the VS Code grammar and the reference.
- Built-in modules and `assert`, `text_width`, `text_metrics` and
  `finger_count` warn about named arguments they do not take, as user
  modules and functions already did: `rect(10, radius = 2)` warns that
  `radius` is unknown.
- [integrations/](integrations): four working laser-cutting generators, a
  batch script, a web service, a web page and a Python script, each run by
  the tests.
- Errors show where they are: `formatError()` and the command line print
  the source line with the problem underlined, the module and function calls
  it happened inside, and what a built-in takes when it was given an
  unusable argument. The playground and the desktop app show the same.
  `KerfError` has `reason`, `trace` and `call` for applications that show
  errors their own way.
- Unknown variables, functions, modules and named arguments suggest a close
  known name: `Unknown variable "widht". Did you mean "width"?`
- A function that calls itself without end reports the call and its line
  instead of a message with no position.
- Positional arguments past a module's or function's parameters, built-in or
  not, give a warning; they used to be dropped silently.
- `echo()` writes named and positional arguments in the order they are
  given; named ones used to come last.
- Errors in calls point at the name called, and a missing comma says what
  else could come next: `Expected "," or ")"`.
- `kerf fmt` and `format()`: the official formatter. It sets indentation,
  spacing, blank lines and line endings, keeps line breaks and every comment
  where it is, and checks that its output has the same tokens as the input.
  `kerf fmt --check` lists unformatted files for CI, and `kerf fmt -` reads
  standard input for editors. The examples and the standard library are
  formatted with it; their output is unchanged.
- A VS Code extension in `editors/vscode` with a TextMate grammar, snippets
  and file icons. A test checks that it colours every example the same way
  as the highlighter.
- `kerf lsp`, the KerfScript language server, for VS Code (the extension
  bundles it) and any editor with a Language Server Protocol client:
  problems while you type, hover, completion, parameter hints, go to
  definition, find references, rename, outline, links on library paths and
  formatting. Designs run in a worker thread and stop after 10 seconds. See
  [Editors](docs/editors.md).
- `@mylasertools/kerfscript/language`: the language server's answers as
  functions, for editors in a browser or your own tools.
- `KerfError` has `warnings`, the warnings before the error.
- Standard library: six new libraries, each with a picture, an example and
  tests, described in [Standard library](docs/library.md). `kerf/tabs`:
  tab and slot joints. `kerf/hinge`: living hinge panels, `bend_length()`
  and `flex_box()`, a box with round corners. `kerf/dividers`: egg-crate
  dividers. `kerf/hanging`: keyholes, holes and hanging loops.
  `kerf/enclosure`: boxes with a lid held by screws and nuts, with cutouts
  and vents. `kerf/calibration`: a kerf gauge, a slot gauge and finger
  joint test pairs.
- New examples built on them: a spice shelf, a flex box, a wall sign, a
  project enclosure and a calibration set. The drawer organizer, the kerf
  test and the hinge card now use the libraries; their output is unchanged,
  except that the drawer organizer's dividers are named `long divider` and
  `cross divider`.
- The editors colour the new library modules like `box()` and `divider()`.
- [Shared libraries](docs/shared-libraries.md): `kerf add`, `kerf remove`,
  `kerf install` and `kerf pack`. A project's `kerf.json` names the
  libraries it uses, from a GitHub tag, an https `.tar.gz` or a folder;
  `kerf install` copies them into `kerf_libraries/` and pins each in
  `kerf.lock` by its commit and a sha256 hash of its files. `--frozen`
  and `--check` keep CI to exactly what is pinned. Designs load them with
  `use <name/file>` in `kerf render`, the desktop app and the language
  server, which also completes their paths. `kerf pack` checks a library's
  files and `use` paths before it is published.
- `@mylasertools/kerfscript/libraries`: the same for Node.js, including
  `resolver(file)`, a `resolve` option that finds libraries as the command
  line does.

## 0.4.0 (2026-10-30)

- Assembly: `part()` takes `at` and `rotate` to place a part in 3D, rotated
  first and then moved, like OpenSCAD. `render()` returns the placed parts as
  `assembly` (outline, thickness and a 4 × 4 matrix per copy) so apps can show
  the design put together, and warns when two placed parts collide, which is
  how a wrong finger edge shows up. Overlaps under about 1 mm³ are ignored.
  Parts without a placement lie flat beside the assembly, marked
  `placed: false`, so a divider added to a `box()` still shows.
  `box()` from `kerf/box` places its own panels.
- Copies of a part that share one placement are drawn in the same place and
  get one warning that says so, instead of a collision warning for every pair.
- The collision check stops after `maxCollisionPairs` pairs of touching parts
  (20,000 by default) with a warning, so a program that places thousands of
  parts cannot hold up the render. It also skips parts far apart on x before
  comparing them, so large assemblies check faster.
- `kerfscript.wasm` returns `assembly` in its render response.

## 0.3.0 (2026-10-30)

- `kerfscript.wasm`: a WASI module that runs KerfScript from Python, Rust,
  Go, C# and other languages. It takes a JSON request on standard input and
  writes SVG, DXF, parts and warnings as JSON. `"command": "licenses"`
  returns the licence texts of the module and of the JavaScript engine built
  into it. Build it with `npm run wasm`; see
  [docs/webassembly.md](docs/webassembly.md).
- A desktop app for Windows, macOS and Linux: the playground with `.kerf`
  files on disk (Open, Save, Save as, double-click to open; Save as adds
  `.kerf` to a name without it and asks before replacing a file of that
  name), exports through a save dialog, `use`/`include` libraries read from
  the design's folder and the folders below it (`.kerf` files only), and an
  About window with the source link and the licences of everything in the
  app. Saving writes the whole file before it replaces the old one, and the
  app asks about unsaved changes before it closes, also on ⌘Q.
  Installers: Windows setup and MSI, a universal macOS dmg, and an AppImage,
  `.deb` and `.rpm` for Linux x64 and arm64; Flathub, winget, Chocolatey and
  AUR manifests. See [docs/desktop.md](docs/desktop.md).
- Open in LightBurn in the desktop app: sends the cut file (or one sheet) to
  LightBurn 2.2 or later through its REST API. KerfScript asks LightBurn only
  for permission to send files, and talks to it directly, past any proxy
  set on the computer.
- Chocolatey and MacPorts manifests for the command line.
- The playground does not load a shared link, draft or file longer than
  1,000,000 characters, and stops unpacking a compressed link at that size.
  Any code the editor runs fits in a link, whatever its script, and a link
  that cannot be opened says why in the console. Code over the limit is not
  coloured or read for settings, and Copy link refuses it. A link to an
  empty design opens it, instead of the draft.
- Settings for a list, such as `size = [10, 20]`, keep numbers changed in the
  code since the settings were drawn, instead of putting the old ones back.
  An empty or half-typed number box leaves the code as it is.
- The playground renders the newest code after fast edits to a slow design,
  instead of stopping with "Stopped after 15 seconds", and keeps working
  when the number of sheets drops to one in the laser file view. Edits after
  opening a shared link or moving a slider on an example are kept on reload.
- The website's licence page, and `assets/THIRD-PARTY-NOTICES.md` next to
  `kerfscript.js`, have the notices of the libraries bundled in its
  JavaScript.
- Standalone `kerf` binaries for Windows, macOS and Linux that need no
  Node.js, with the licences of the Deno runtime built into them,
  `kerfscript-cli` `.deb` and `.rpm` packages (which install next to the
  desktop app), a Docker image, a snap, and Homebrew,
  Scoop, winget and AUR manifests, all built by the release workflow with
  SHA-256, SHA-512 and GPG signatures. Nightly builds go to a rolling
  `nightly` prerelease.
- A `kerf(1)` man page and a `text/x-kerfscript` MIME type for `*.kerf` files
  in the Linux packages.
- The command line and `kerfscript.wasm` have a font built in, Atkinson
  Hyperlegible as `Atkinson` (the playground's font), so `text()` works
  without `--font`. The JavaScript library still takes fonts from the host.
- Memory limits, so a program cannot make a browser tab run out of memory:
  part copies, circle segments and polygon corners, list and string sizes,
  all list items together, `text()` length, shape points, exported points
  and sheets. Each stops the program with an error that says what to change.
  Defaults are in `DEFAULT_LIMITS` and the `limits` render option changes
  them. Every example stays well under them. Ranges in loops and built-in
  functions stop at `maxListLength` items, not at a fixed million.
- A list or string that grows past what JavaScript can hold now gives a
  KerfScript error instead of a `RangeError`.
- Lists are checked while they are built, so `each` in a long loop, list
  arithmetic and matrix products stop at the limit instead of first filling
  memory. Strings joined with `+`, strings from functions and `echo()` text
  count toward `maxListItems` too, and a repeated unknown argument warning
  is shown once.
- `echo()`, `str()`, `join()` and `==` on lists that hold the same list many
  times stop at the limits instead of running out of memory: text stops at
  `maxListLength` characters while it is written, and comparing lists does
  not compare the same pair of lists twice. Error messages, part names and
  other settings show only the start of a long list.
- Comparing lists, dot products and built-in functions that go through a list
  or string, such as `search()`, `contains()`, `max()` and `sum()`, take a
  step for each item, so a loop over a long list stops at `maxSteps` instead
  of running for minutes.
- `hull()` around named parts makes the hull of each part, the same as
  `hull()` inside the part. It left the parts unchanged before.
- DXF layers whose names come out the same in DXF, such as `a b` and `a_b`,
  stay separate layers: the later ones get `_2`, `_3` and so on. The
  built-in layers keep `CUT`, `SCORE`, `ENGRAVE` and `GUIDE`.
- Built-in functions take named arguments, such as `sin(x = 30)` and
  `pow(x = 2, y = 10)`; an unknown name gives a warning, and so does an
  argument given both by position and by name. They were ignored before.
- Errors and warnings in a library name it, as in
  `(line 3, column 5 in <lib/tabs>)`. The playground marks the line only for
  errors in the program itself.
- `toString()`, `constructor()` and other names every JavaScript object has
  are unknown functions and libraries, instead of a crash or a wrong value.
- `text_width()` and `text_metrics()` take a step per character, have the
  same length limit as `text()`, and are much faster for long text.
- A list times a matrix of the wrong size, and `params` values that are not
  numbers, strings, booleans or lists, are errors instead of a crash.
- A list times a list whose items multiply to lists is an error instead of
  text.
- The commercial licence for closed-source apps and services is free: email
  hi@mylasertools.com.

## 0.2.0 (2026-10-28)

First public release.

- `render()` returns `paths` (path data per layer), `width` and `height`, and
  every sheet has `paths`, so host apps can draw layers without parsing SVG.
  Each layer path has `d` (everything), `regions` (closed outlines, filled
  even-odd on fill layers) and `lines` (open lines, always stroked).
- `margin` render option and `--margin` flag: space between the parts and
  the sheet edge, separate from `gap` between parts (defaults to `gap`).
- Errors from a missing font carry `missingFonts`, so a host can load the
  fonts and render again.
- `parameters()` gives list settings `"type": "number"` with a list
  `initial`, the same as OpenSCAD's parameter JSON (was `"vector"`).
- Every setting has `span`, the source offsets of its value, so an editor
  can change the value without touching anything else.
- A setting's caption comes only from a comment on its own line above it,
  not from the end-of-line comment of the setting before.
- `text_width()` and `text_metrics()` errors report their line and column.
- A warning when kerf compensation closes a hole narrower than the kerf.
- `kerf check` lists every sheet with its material, thickness and pieces;
  `kerf render` warns when several sheets are stacked in one SVG, and
  `kerf --version` shows the language version too.
- Guides in `docs/`, calibration square and kerf test examples, and
  `npm run compat`, which checks SVG and DXF output in Inkscape.

## 0.1.0 (not published)

First version of the KerfScript language (language version 0.1).

- Language: numbers, strings, lists, ranges, functions and closures, list
  comprehensions, modules with children, dynamic `$` variables, `use` and
  `include`, customizer comments.
- Shapes: rect, circle, ellipse, regular_polygon, star, polygon, SVG path,
  text, line, polyline, arc.
- Booleans, hull, offset, stroke, outline and transforms.
- Laser layers (cut, score, engrave, guide, custom), parts, materials, kerf
  compensation, inner cuts first, sheet packing.
- Joinery: finger_rect, finger_holes, tslot, living_hinge; `kerf/box`.
- SVG and DXF output, `kerf` command line tool.
