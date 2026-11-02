<p align="center">
  <a href="https://kerfscript.mylasertools.com"><img src=".github/readme/banner.png" alt="KerfScript, a programming language for laser cutting" width="840"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mylasertools/kerfscript"><img src="https://img.shields.io/npm/v/@mylasertools/kerfscript?color=d8361f&label=npm" alt="npm version"></a>
  <a href="COMMERCIAL-LICENSE.md"><img src="https://img.shields.io/badge/licence-AGPL--3.0%20or%20free%20commercial-1f1a17" alt="Licence: AGPL-3.0 or free commercial"></a>
  <a href="LANGUAGE.md"><img src="https://img.shields.io/badge/language-0.2-e3c69a" alt="Language version 0.2"></a>
  <a href="https://kerfscript.mylasertools.com/playground/"><img src="https://img.shields.io/badge/try%20it-playground-5a3519" alt="Try it in the playground"></a>
</p>

<p align="center">
  <a href="https://kerfscript.mylasertools.com">Website</a> ·
  <a href="https://kerfscript.mylasertools.com/playground/">Playground</a> ·
  <a href="https://kerfscript.mylasertools.com/models/">Models</a> ·
  <a href="https://kerfscript.mylasertools.com/docs/">Docs</a> ·
  <a href="https://www.npmjs.com/package/@mylasertools/kerfscript">npm</a>
</p>

Write a part once as code, change a number, and get a new cut file. KerfScript
is to laser cutters what OpenSCAD is to 3D printers, except it was designed for
flat parts from the start: cut, score and engrave layers, kerf compensation,
finger joints, living hinges, parts and sheets are part of the language.

It is also a library for building **laser-cutting generators**: a web page,
web service, app or script that takes a few settings (a size, a name, a number
of slots) and returns SVG or DXF files ready to cut. The design is a `.kerf`
file; your code passes settings in and takes cut files out, in Node.js, the
browser, or any language that runs WebAssembly. See
[Build a generator](#build-a-generator).

<p align="center">
  <a href="https://kerfscript.mylasertools.com/playground/?model=fractal-tree"><img src=".github/readme/playground.gif" alt="Moving a slider in the playground changes the number in the code and redraws the fractal tree" width="840"></a>
  <br><sub>The <a href="https://kerfscript.mylasertools.com/playground/">playground</a> runs the interpreter in your browser. A comment after a number turns it into a slider.</sub>
</p>

## Example

<table>
<tr>
<td width="50%" valign="top">

```kerf
use <kerf/box>

/* [Size] */
width = 120; // [40:5:400]
depth = 80; // [40:5:400]
height = 50; // [20:5:300]
lid = true;

/* [Material] */
$thickness = 3; // [1.5:0.5:10]
$kerf = 0.15; // [0:0.01:0.5]

box([width, depth, height], lid = lid);
```

</td>
<td width="50%" valign="top">
<img src=".github/readme/model-box.png" alt="Six finger-jointed panels of a box, packed on a sheet">
</td>
</tr>
</table>

```sh
npx @mylasertools/kerfscript render box.kerf -o box.svg -D width=200
```

That writes all six panels packed on a sheet, kerf compensated, as a
millimetre SVG with one layer per operation. Output is checked automatically
in Inkscape; see [docs/compatibility.md](docs/compatibility.md) for what has
and has not been tested in other laser software.

`kerf/box` is one of the libraries in the
[standard library](docs/library.md), built into every renderer:
[tabs and slots](docs/library.md#tabs-and-slots),
[living hinges](docs/library.md#living-hinges) and a box with round corners,
[egg-crate dividers](docs/library.md#dividers),
[keyholes and hanging loops](docs/library.md#hanging),
[enclosures](docs/library.md#enclosures) with a screwed-on lid, and
[test pieces](docs/library.md#calibration) that measure your laser's
kerf and how your sheet fits.

## Build a generator

`parameters()` reads a design's settings, with their captions, ranges and
choices, so you can build a form or an API from them. `render()` turns
settings into cut files:

```js
import { readFile } from 'node:fs/promises';
import { parameters, render } from '@mylasertools/kerfscript';

const design = await readFile('box.kerf', 'utf8'); // integrations/http-api/box.kerf
parameters(design).parameters; // width: number from 40 to 400, lid: boolean, ...

const { sheets, parts, warnings } = render(design, { params: { width: 200, lid: false } });
sheets[0].svg; // or sheets[0].dxf, one per sheet of material
parts; // [{ name: 'bottom', width: 200, height: 80, cutLength: 740, ... }]
```

Working generators, each tested on every change, are in
[integrations/](integrations):

| Example                                     | What it makes                                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Batch in Node.js](integrations/node-batch) | A name tag for every name in a list, as SVG and DXF, and all of them packed on one sheet                 |
| [Web service](integrations/http-api)        | A box generator over HTTP: settings as JSON, cut files by URL, each render in a worker with a time limit |
| [Web page](integrations/browser)            | A form built from the design's settings, a live preview and downloads, with no build step                |
| [Python](integrations/python)               | Boxes in several sizes from Python through `kerfscript.wasm`, without Node.js                            |

The [playground](https://kerfscript.mylasertools.com/playground/), the
[desktop app](docs/desktop.md) and the
[KerfScript Playground on MyLaserTools](https://www.mylasertools.com/kerfscript-playground)
are generators built the same way. Programs written by other people should
run in a worker you can stop; see
[Running untrusted code](docs/javascript.md#running-untrusted-code).

## AI assistants

The KerfScript MCP server lets Claude, Cursor, VS Code and other assistants
read the docs and examples and render designs to check them. Add
`https://mcp.mylasertools.com/mcp`, which needs no account, or run it locally
with `npx -y @mylasertools/kerfscript-mcp`. See
[AI assistants](docs/mcp.md).

## Made with KerfScript

Every model is a file in [examples/](examples). Open one on the website to
turn it around in 3D, change its settings and download the SVG or DXF, or copy
it as the start of your own design.

<table>
<tr>
<td width="33%" valign="top"><a href="https://kerfscript.mylasertools.com/models/hadal/"><img src="site/public/3d/hadal.webp" alt="Hadal sculpture, assembled"></a><br><b><a href="https://kerfscript.mylasertools.com/models/hadal/">Hadal sculpture</a></b><br><sub>13 slotted parts, ribs computed from lists</sub></td>
<td width="33%" valign="top"><a href="https://kerfscript.mylasertools.com/models/tilt-maze/"><img src="site/public/3d/tilt-maze.webp" alt="Tilt maze, assembled"></a><br><b><a href="https://kerfscript.mylasertools.com/models/tilt-maze/">Tilt maze</a></b><br><sub>a new maze for every seed, by recursion</sub></td>
<td width="33%" valign="top"><a href="https://kerfscript.mylasertools.com/models/topo-island/"><img src="site/public/3d/topo-island.webp" alt="Layered island, assembled"></a><br><b><a href="https://kerfscript.mylasertools.com/models/topo-island/">Layered island</a></b><br><sub>contours traced from a height formula</sub></td>
</tr>
<tr>
<td width="33%" valign="top"><a href="https://kerfscript.mylasertools.com/models/fractal-tree/"><img src="site/public/3d/fractal-tree.webp" alt="Fractal tree, assembled"></a><br><b><a href="https://kerfscript.mylasertools.com/models/fractal-tree/">Fractal tree</a></b><br><sub>a module that calls itself</sub></td>
<td width="33%" valign="top"><a href="https://kerfscript.mylasertools.com/models/round-badge/"><img src="site/public/3d/round-badge.webp" alt="Round badge, assembled"></a><br><b><a href="https://kerfscript.mylasertools.com/models/round-badge/">Round badge</a></b><br><sub>text set letter by letter around a circle</sub></td>
<td width="33%" valign="top"><a href="https://kerfscript.mylasertools.com/models/winterlight/"><img src="site/public/3d/winterlight.webp" alt="Winterlight ornaments, assembled"></a><br><b><a href="https://kerfscript.mylasertools.com/models/winterlight/">Winterlight ornaments</a></b><br><sub>one-piece ornaments with scored detail</sub></td>
</tr>
<tr>
<td width="33%" valign="top"><a href="https://kerfscript.mylasertools.com/models/xenospora/"><img src="site/public/3d/xenospora.webp" alt="Xenospora seed pod, assembled"></a><br><b><a href="https://kerfscript.mylasertools.com/models/xenospora/">Xenospora seed pod</a></b><br><sub>16 parts on 3 sheets, one file per sheet</sub></td>
<td width="33%" valign="top"><a href="https://kerfscript.mylasertools.com/models/solstice/"><img src="site/public/3d/solstice.webp" alt="Solstice lantern, assembled"></a><br><b><a href="https://kerfscript.mylasertools.com/models/solstice/">Solstice lantern</a></b><br><sub>tabs, slots and a fit test piece</sub></td>
<td width="33%" valign="top"><a href="https://kerfscript.mylasertools.com/models/box/"><img src="site/public/3d/box.webp" alt="Finger-jointed box, assembled"></a><br><b><a href="https://kerfscript.mylasertools.com/models/box/">Finger-jointed box</a></b><br><sub>six panels from one library call</sub></td>
</tr>
<tr>
<td width="33%" valign="top"><a href="https://kerfscript.mylasertools.com/models/wave-cathedral/"><img src="site/public/3d/wave-cathedral.webp" alt="Wave Cathedral, assembled"></a><br><b><a href="https://kerfscript.mylasertools.com/models/wave-cathedral/">Wave Cathedral</a></b><br><sub>17 different ribs from one formula</sub></td>
<td width="33%" valign="top"><a href="https://kerfscript.mylasertools.com/models/gift-tags/"><img src="site/public/3d/gift-tags.webp" alt="Gift tags from a list, assembled"></a><br><b><a href="https://kerfscript.mylasertools.com/models/gift-tags/">Gift tags from a list</a></b><br><sub>one tag per name, each name fitted</sub></td>
<td width="33%" valign="top"><a href="https://kerfscript.mylasertools.com/models/umbra/"><img src="site/public/3d/umbra.webp" alt="Umbra shadow machine, assembled"></a><br><b><a href="https://kerfscript.mylasertools.com/models/umbra/">Umbra shadow machine</a></b><br><sub>six fins whose shadows make one dragon</sub></td>
</tr>
</table>

## Why a new language

- **Laser concepts are built in.** `engrave()`, `score()` and `cut()` put
  geometry on machine layers. Engraving is clipped to the material, inner
  cuts come before outer ones, and the whole part is offset by half the kerf.
- **Parts, not just shapes.** `part("lid", qty = 2)` names a piece; the
  renderer packs parts by material and thickness onto sheets.
- **Joinery that follows the material.** `finger_rect`, `finger_holes`,
  `tslot` and `living_hinge` use `$thickness`, so the joints resize when the
  material changes. Measure your kerf and cut a test piece for a snug fit.
- **Readable code.** Variables, modules, functions, loops and transforms like
  `translate()` and `rotate()`. Settings come from comments such as
  `// [10:1:100]`, which the playground turns into sliders. If you have used
  OpenSCAD, [Coming from OpenSCAD](docs/openscad.md) lists what differs.
- **Runs anywhere.** Pure TypeScript with no native code: the same interpreter
  runs in browsers, Node, workers and the command line.
- **Contained.** Programs read libraries only through the resolver you
  provide and have no other access to files or the network. Step, recursion
  and size limits stop runaway programs, and errors name the line. Run
  programs you did not write in a worker or process you can stop; see
  [Running untrusted code](docs/javascript.md#running-untrusted-code).

## Install

```sh
npm install @mylasertools/kerfscript
```

The `kerf` command line also comes as a standalone binary that needs no
Node.js, and through Homebrew, winget, Chocolatey, Scoop, Snap, the AUR,
MacPorts and Docker: see [Command line](docs/cli.md#without-nodejs). The
desktop app is in [Desktop app](docs/desktop.md), and the WebAssembly module
in [WebAssembly](docs/webassembly.md).

## Command line

```sh
kerf render design.kerf -o design.svg      # or .dxf / .json
kerf render design.kerf -D width=200 -D 'label="Oak"' --font Inter.ttf
kerf render design.kerf --sheet 400x300 --kerf 0.1 --split
kerf params design.kerf                    # customizer parameters as JSON
kerf check design.kerf                     # parts, sizes, cut length, warnings
kerf fmt designs/                          # format .kerf files; --check for CI
kerf lsp                                   # language server for editors
```

The VS Code extension in [editors/vscode](editors/vscode) underlines
problems as you type and has hover, completion, parameter hints, go to
definition, references, rename and formatting on save. Other editors run
`kerf lsp`: see [Editors](docs/editors.md).

## Library

```js
import { render, parameters } from '@mylasertools/kerfscript';

const result = render(source, {
  params: { width: 200 },
  fonts: { inter: await (await fetch('/Inter.ttf')).arrayBuffer() },
  sheet: [600, 400],
});

result.svg; // all sheets in one SVG
result.sheets; // [{ width, height, material, thickness, svg, dxf, items }]
result.parts; // [{ name, qty, width, height, pieces, cutLength, thickness, kerf, material }]
result.warnings; // e.g. a part that falls apart, or one bigger than the sheet
result.echoes; // echo() output

parameters(source).parameters; // [{ name, caption, group, type, initial, min, max, step, options, span }]
```

Errors are thrown as `KerfError` with `line` and `col`.

## Learn the language

- [Getting started](docs/getting-started.md), then the guides on
  [layers](docs/layers.md), [kerf](docs/kerf.md),
  [parts and sheets](docs/parts-and-sheets.md), [settings](docs/customizer.md),
  the [desktop app](docs/desktop.md), the [command line](docs/cli.md), the
  [JavaScript API](docs/javascript.md),
  [WebAssembly](docs/webassembly.md) for other languages and
  [AI assistants](docs/mcp.md)
- [Standard library](docs/library.md): joints, hinges, dividers, hanging
  holes, enclosures and test pieces, with a picture and an example of each
- [Shared libraries](docs/shared-libraries.md): use and publish `.kerf`
  libraries, pinned in `kerf.lock` so a design cuts the same everywhere
- [Importing SVG drawings](docs/import.md): turn a drawing into a program,
  with its circles, tabs, slots, finger joints and hanger holes found
- [Coming from OpenSCAD](docs/openscad.md): what is the same and what is not
- [LANGUAGE.md](LANGUAGE.md): the full language reference
- [Versions](docs/versions.md): language and package versions, and what stays
  stable before 1.0
- [examples/](examples): every model on the website, including a
  calibration set, a calibration square and a kerf test

## Community

Bug reports, cut reports and ideas are welcome; see
[CONTRIBUTING.md](CONTRIBUTING.md),
[SECURITY.md](SECURITY.md) and the [code of conduct](CODE_OF_CONDUCT.md).

## Licence

Copyright (c) 2026 MyLaserTools.

KerfScript is free software under the
[GNU AGPL 3.0](LICENSE), with an [additional permission](COMMERCIAL-LICENSE.md#additional-permission-your-designs-are-yours)
that makes **your `.kerf` designs and the files KerfScript generates yours to
license and sell however you like**.

Building KerfScript into a closed-source app, machine or service? The
[commercial licence](COMMERCIAL-LICENSE.md#free-commercial-licence) is free:
just email hi@mylasertools.com.

"KerfScript" is a trademark of MyLaserTools; see [TRADEMARKS.md](TRADEMARKS.md).
Contributions need the [CLA](CLA.md); see [CONTRIBUTING.md](CONTRIBUTING.md).
Bundled third-party code is listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
