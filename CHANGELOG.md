# Changelog

## Unreleased

- `@mylasertools/kerfscript/highlight`: syntax colouring as its own small
  module (4 KB), for editors and pages that show KerfScript code. The site,
  the playground and the desktop app use it. It also colours module and
  function names where they are defined, layer modules, `true`, `false`,
  `undef` and `PI`, the `* # %` modifiers, and customizer group headers
  and controls.
- The playground keeps a block comment coloured across all its lines.
- [Specification](docs/specification.md): the formal grammar and the exact
  rules for values, operators, scope, calls, libraries and errors.
- A conformance suite in `conformance/`: 83 small programs with their
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
  `nightly` prerelease. See RELEASING.md.
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
