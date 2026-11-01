# Building generators with KerfScript

A laser-cutting generator takes a few settings, such as a size, a name or a
number of slots, and returns files ready to cut. With KerfScript the design
is a `.kerf` program and your application only passes settings in and takes
SVG or DXF out. The language handles kerf compensation, finger joints, layers
and packing parts onto sheets, so the application does not have to.

Each folder here is a small working generator. `npm test` runs all four
against the current build (`test/integrations.test.mjs`).

| Example                  | Runs in                     | Shows                                                                                                                                                    |
| ------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [node-batch](node-batch) | Node.js                     | A name tag for each name in a list, each as SVG and DXF, and all of them packed on one sheet with `use`                                                  |
| [http-api](http-api)     | Node.js server              | A box generator as a web service: settings as JSON, cut files by URL, values checked against their ranges, and each render in a worker with a time limit |
| [browser](browser)       | A web page, no build step   | A form built from the design's settings, a live preview and SVG and DXF downloads, with the package from a CDN                                           |
| [python](python)         | Python, through WebAssembly | Boxes in several sizes from Python with `kerfscript.wasm`, no Node.js needed                                                                             |

## Running them

From a clone of this repository, after `npm install` and `npm run build`:

```sh
node integrations/node-batch/generate.mjs out
node integrations/http-api/server.mjs 8080        # then open http://localhost:8080/box.svg?width=200
npx serve integrations/browser                    # any static file server
python integrations/python/generate.py dist/kerfscript.wasm out   # needs pip install wasmtime and npm run wasm
```

In your own project, install the package with
`npm install @mylasertools/kerfscript` and copy the example you need: the
Node.js examples import `@mylasertools/kerfscript` like any other package.
The browser example loads it from a CDN, so it works as a plain folder of
files on any web server.

## The pattern

1. Write the design as a `.kerf` file, with its settings as top-level
   assignments. [Customizer comments](../docs/customizer.md) give each one a
   caption, a range or a list of choices.
2. Read the settings with `parameters(source)` to build a form, an API or a
   command line, and to check values before rendering.
3. Render with `render(source, { params })`. The result has the SVG and DXF
   for each sheet, the parts with their sizes and cut lengths, and warnings
   such as a part bigger than the sheet.

The [JavaScript API](../docs/javascript.md) lists every option. Programs
from other people should run in a worker or process you can stop: see
[Running untrusted code](../docs/javascript.md#running-untrusted-code), which
the http-api example follows.

## In production

The [KerfScript playground](https://kerfscript.mylasertools.com/playground/)
and the [desktop app](../docs/desktop.md) are generators of this kind: their
sliders come from `parameters()`, and every change calls `render()` in a
worker. Their source is in [site/public/assets](../site/public/assets). The
[KerfScript Playground on MyLaserTools](https://www.mylasertools.com/kerfscript-playground)
uses the npm package in a Next.js app.
