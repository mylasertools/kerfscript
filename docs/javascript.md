# JavaScript API

Add KerfScript rendering to a JavaScript application with the
`@mylasertools/kerfscript` package. The library runs in browsers and Node.js
and includes TypeScript definitions.

```sh
npm install @mylasertools/kerfscript
```

## render()

Pass a program as a string. The result contains its geometry, files, parts
and warnings:

```js
import { render } from '@mylasertools/kerfscript';

const source = 'width = 80; rect([width, 50]);';
const result = render(source, {
  params: { width: 120 },
  sheet: [600, 400],
  margin: 0,
});

console.log(result.svg);
```

This exports a 120 × 50 mm rectangle. `params` overrides `width` without
changing the source string.

### Options

| Option        | Value                                                                  |
| ------------- | ---------------------------------------------------------------------- |
| `params`      | Parameter values keyed by name                                         |
| `fonts`       | Font files keyed by name, as `ArrayBuffer` or `Uint8Array`             |
| `defaultFont` | Name to use when `text()` does not specify a font                      |
| `resolve`     | `(path) => source` callback for libraries outside the standard library |
| `kerf`        | Kerf override for every part, in millimetres                           |
| `layout`      | `"pack"` or `"none"`                                                   |
| `sheet`       | `[width, height]` in millimetres                                       |
| `gap`         | Space between parts, in millimetres                                    |
| `margin`      | Space at sheet edges, in millimetres; defaults to `gap`                |
| `guides`      | Whether to include guide geometry                                      |
| `maxSteps`    | Evaluation step limit                                                  |
| `limits`      | Memory limits, see below; any you leave out keep their default         |

Supply a font for programs that use text:

```js
const response = await fetch('/fonts/Inter.ttf');
const font = await response.arrayBuffer();
const result = render(source, {
  fonts: { Inter: font },
  defaultFont: 'Inter',
});
```

The URL should point to a font file provided by your application.

### Result

| Field             | Contents                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svg`             | Combined SVG containing all sheets                                                                                                                                                                |
| `width`, `height` | Combined SVG dimensions in millimetres                                                                                                                                                            |
| `sheets`          | Each sheet's dimensions, material, thickness, SVG, DXF, paths and placed items                                                                                                                    |
| `parts`           | Part names, quantities, dimensions, piece counts, cut lengths and material properties                                                                                                             |
| `assembly`        | One entry per copy of a part with `name`, `copy`, `thickness`, `outline`, a 4 × 4 `matrix` and `placed`, for showing the design put together. Parts without `at` or `rotate` have `placed: false` |
| `paths`           | Layer paths with `name`, `mode`, `color`, `d`, `regions` and `lines`                                                                                                                              |
| `layers`          | Layer definitions in output order                                                                                                                                                                 |
| `warnings`        | Problems that did not stop the render                                                                                                                                                             |
| `echoes`          | Output from the program's `echo()` calls                                                                                                                                                          |

Use `result.svg` for a combined preview. Use `result.sheets[i].svg` or
`.dxf` to export individual sheets, particularly when they use different
materials.

For a custom preview, `d` contains all paths in a layer. `regions` contains
closed outlines and `lines` contains open paths. On a `fill` layer, draw
regions with the even-odd fill rule and draw open paths as strokes.

## parameters()

Read a program's editable settings without rendering its geometry:

```js
import { parameters } from '@mylasertools/kerfscript';

const source = 'width = 80; // [40:5:200]\nrect([width, 50]);';
const settings = parameters(source).parameters;
```

Each setting includes `name`, `caption`, `group`, `type`, `initial` and
`span`. Ranges add `min`, `max` and `step`; menus add `options`.

`type` is `"number"`, `"string"` or `"boolean"`. A numeric vector has
type `"number"` and an array as its `initial` value.

`span` gives the source offsets `[start, end]` of the value. An editor can
use them to update one setting:

```js
const width = settings.find((p) => p.name === 'width');
if (width) {
  const next = source.slice(0, width.span[0]) + '120' + source.slice(width.span[1]);
}
```

Read the settings again after editing the source; the offsets refer to the
string passed to `parameters()`.

## Syntax colouring

`@mylasertools/kerfscript/highlight` colours KerfScript code without loading
the interpreter. It never throws, so it works on unfinished code in an editor.
Its categories match the VS Code extension's grammar.

```js
import { highlight, highlightLine } from '@mylasertools/kerfscript/highlight';

// HTML with a t-keyword, t-builtin, t-comment ... span per token
pre.innerHTML = highlight(source);

// Line by line, for editors such as CodeMirror
const state = { inBlock: false };
for (const line of source.split('\n')) {
  for (const { kind, text } of highlightLine(line, state)) {
    // kind: comment, section, control, string, number, keyword, constant,
    // definition, builtin, layer, call, special, modifier or plain
  }
}
```

`highlight()` never puts a span across a line break, so its result can be
split into lines. `section` and `control` are customizer comments
(`/* [Size] */` and `// [40:5:400]`).

## Errors

Language errors use `KerfError`. Its `line` and `col` identify the source
location when available, and `echoes` contains output produced before the
error. `missingFonts` lists fonts the application needs to supply.

```js
import { KerfError, render } from '@mylasertools/kerfscript';

try {
  render('rect([80, 50]);');
} catch (error) {
  if (error instanceof KerfError) {
    console.error(error.message, error.line, error.col);
  } else {
    throw error;
  }
}
```

## Running untrusted code

Run browser renders in a web worker so they do not block the page. Set a
timeout and terminate the worker if it takes too long. Evaluation limits
bound program steps and recursion, but geometry work also takes time.

Size limits stop a program before it builds more than a browser tab can
usually hold: part copies, circle segments, list sizes, text length, shape
points, exported points and sheets. They bound what a program makes, not
every byte the renderer uses, so keep the worker's timeout as well, and run
programs you did not write where the page can end them. The defaults are in
[Limits](../LANGUAGE.md#limits) and in `DEFAULT_LIMITS`. Lower them with the
`limits` option if your worker has little memory:

```js
import { render, DEFAULT_LIMITS } from '@mylasertools/kerfscript';

render(source, { limits: { maxPoints: DEFAULT_LIMITS.maxPoints / 2 } });
```

KerfScript programs have no direct file or network access. `use` and
`include` can load the standard library and sources returned by your
`resolve` callback. Restrict that callback to libraries you intend to expose.
