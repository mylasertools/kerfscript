# KerfScript for VS Code

Highlighting, problems while you type, hover, completion and formatting for
[KerfScript](https://kerfscript.mylasertools.com), the programming language
for laser cutting. Write parametric 2D parts with
cut, score and engrave layers, kerf compensation and finger joints, and
export SVG or DXF.

## Features

- **Problems while you type**: the design runs as you edit, and errors and
  warnings are underlined where they are, with the module calls an error
  happened inside. `Unknown variable "widht". Did you mean "width"?`
- **Hover** on a built-in shows how to call it, its parameters and a link to
  the reference; on your own modules, functions and variables it shows how
  they are defined and the comment above them, and for a setting its range
- **Completion** of modules where a statement starts, functions and
  variables in expressions, named arguments inside a call, and library
  paths after `use <`
- **Parameter hints** for the argument being typed
- **Go to definition**, **find references**, highlighting of a name's uses
  and **rename**, following KerfScript's scope rules: the parameters of a
  module include the named arguments that set them
- **Outline** of modules, functions and variables, and links on
  `use <...>` paths
- **Formatting** with the official formatter, `kerf fmt`, on save. Turn
  it off with `"[kerfscript]": { "editor.formatOnSave": false }`
- Highlighting for `.kerf` files: keywords, built-in modules and functions,
  layer modules (`cut`, `score`, `engrave`, `guide`), special variables such
  as `$kerf` and `$thickness`, modifiers and `use <...>` paths
- Customizer comments stand out: `/* [Size] */` group headers and
  `// [40:5:400]` slider and menu annotations
- Highlighting for `kerf` code blocks in Markdown
- Comment toggling, bracket matching and auto-closing pairs
- Snippets: `module`, `function`, `for`, `part`, `material`, `finger_rect`,
  `score`, `slider`, `group`, `use` and more

```kerf
/* [Size] */
width = 120; // [40:5:400]
$kerf = 0.15;

material(thickness = 3, name = "plywood") {
  part("side", qty = 2) finger_rect([width, 60], "out");
  part("base") {
    difference() {
      rect([width, width], r = 4);
      translate([width / 2, width / 2]) circle(d = 20);
    }
    engrave() translate([8, 8]) text("KERF", size = 12);
  }
}
```

## Render your designs

Install the command line tool and render a file to SVG or DXF:

```sh
npm install -g @mylasertools/kerfscript
kerf render box.kerf -o box.svg
```

Or try it in the browser at
[kerfscript.mylasertools.com](https://kerfscript.mylasertools.com).

Libraries next to a design, as in `use <tabs>`, are read from its folder,
including unsaved changes in open editors. The language server comes with
the extension; it needs nothing else installed. A design that runs longer
than 10 seconds is not checked.

## Other editors

The same language server runs in any editor that speaks the Language Server
Protocol, as `kerf lsp`; see
[Editors](https://github.com/mylasertools/kerfscript/blob/main/docs/editors.md).

The TextMate grammar, `syntaxes/kerfscript.tmLanguage.json` (scope
`source.kerfscript`), is available for other tools that read TextMate
grammars, such as Sublime Text, JetBrains IDEs and Shiki. Only VS Code has
been tested; each of those needs its own setup to load the grammar.

## Licence

AGPL-3.0-only. KerfScript is a trademark of MyLaserTools; see
[TRADEMARKS.md](https://github.com/mylasertools/kerfscript/blob/main/TRADEMARKS.md).
