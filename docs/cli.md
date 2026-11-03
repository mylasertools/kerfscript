# Command line

Use the `kerf` command to export designs, change parameters and inspect
parts from your terminal. Install the package with Node.js 20 or newer:

```sh
npm install --global @mylasertools/kerfscript
kerf render box.kerf -o box.svg
```

You can also run it through `npx`:

```sh
npx @mylasertools/kerfscript render box.kerf -o box.svg
```

## Without Node.js

The [releases](https://github.com/mylasertools/kerfscript/releases) page has a
standalone `kerf` for Windows, macOS and Linux (x64 and arm64) that needs no
Node.js: `kerf-<version>-<os>-<arch>.zip` or `.tar.gz`, and
`kerfscript-cli-<version>-linux-<arch>.deb` or `.rpm`. It has the
Atkinson Hyperlegible font built in, like the npm package.

| System           | Install                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| macOS, Linux     | `brew install mylasertools/tap/kerfscript`                                                                    |
| Windows          | `winget install MyLaserTools.KerfScript.CLI`, or `choco install kerfscript`                                   |
| Windows (Scoop)  | `scoop bucket add mylasertools https://github.com/mylasertools/scoop-bucket`, then `scoop install kerfscript` |
| Linux (Snap)     | `sudo snap install kerfscript`; the command is `kerfscript.kerf`                                              |
| Arch Linux (AUR) | `kerfscript-bin`                                                                                              |
| macOS (MacPorts) | `sudo port install kerfscript`                                                                                |
| Docker           | `docker run --rm -v "$PWD:/work" --user "$(id -u):$(id -g)" ghcr.io/mylasertools/kerfscript render box.kerf`  |

Package manager listings follow each release as they are approved. The
binaries are not signed yet. On macOS, Homebrew and MacPorts install them
without a warning; a downloaded `kerf` needs
`xattr -d com.apple.quarantine kerf` once. On Windows, SmartScreen may warn
the first time.

Save a `.kerf` file from the [models](https://kerfscript.mylasertools.com/models/)
to try these commands.

## Commands

```sh
kerf render <file.kerf> [-o out.svg] [options]
kerf params <file.kerf>
kerf check <file.kerf>
kerf verify <file.kerf> --spec <file.json> [-o report.json]
kerf fmt <files or folders>
kerf fmt --check <files or folders>
kerf fmt -
kerf lsp [--timeout <seconds>]
kerf import <file.svg> [-o out.kerf] [--dpi <n>] [--tolerance <mm>] [--kerf <mm>] [--pack]
kerf add <source>
kerf remove <name>
kerf install [--frozen | --check]
kerf pack [folder] [-o file]
```

`render` exports SVG, DXF or JSON, using the output file's extension to
choose the format. `params` lists the editable settings as JSON. `check`
reports parts, dimensions, cut lengths, sheets and warnings.

`verify` checks explicit rigid fit, retention, installation and motion contracts and writes a JSON report. It
exits with 0 for passed required claims, 1 for failures, and 2 for unverified or
invalid inputs. See [Assembly verification](verification.md) for supported claims,
material profiles and the limits of a pass.

`fmt` formats `.kerf` files in place, searching folders for them, except
`kerf_libraries/`, whose files `kerf.lock` pins as they are. It sets
indentation (two spaces), the spaces between tokens, blank lines (at most one
in a row) and line endings, and keeps your line breaks and every comment
where it is, customizer comments included. It never joins or splits lines.
`--check` changes nothing: it lists the files that are not formatted and
exits with 1 when there are any, for CI. `kerf fmt -` formats standard input
to standard output, for editors. A file that does not parse is reported and
left alone.

`import` turns an SVG drawing into a `.kerf` program next to it, or to the
`-o` file; `-o -` prints it. It does not replace a program already next to
the drawing unless that file is named with `-o`. It writes the circles, rectangles, tabs, slots,
finger joints, hanger holes and keyholes it finds as the modules that make
them, and checks each part against the drawing: see
[Importing SVG drawings](import.md) for what it finds and for its options.

`lsp` runs the language server on standard input and output, for editors:
see [Editors](editors.md). It stops checking a design after `--timeout`
seconds, 10 by default.

`add`, `remove`, `install` and `pack` manage [shared libraries](shared-libraries.md)
in the project around the current folder, the nearest one with a `kerf.json`.
`add` takes `github:owner/repo@tag`, an https link to a `.tar.gz` or a
folder, records it in `kerf.json` and installs it into `kerf_libraries/`.
`install` installs what `kerf.json` names, from the exact commits and
files `kerf.lock` pins; `--frozen` fails instead of changing `kerf.lock`,
for CI, and `--check` downloads nothing and exits with 1 when
`kerf_libraries/` differs from `kerf.lock`. `pack` checks a library and
writes `name-version.tar.gz` to publish. `render` and `check` find the
installed libraries by themselves.

## Options

| Option                | Use                                                                       |
| --------------------- | ------------------------------------------------------------------------- |
| `-o, --out <file>`    | Output path ending in `.svg`, `.dxf` or `.json`; defaults to `<file>.svg` |
| `-D name=value`       | Override a parameter; repeat for multiple values                          |
| `-p, --params <file>` | Load parameter values from a JSON file                                    |
| `--font <file.ttf>`   | Supply a font file; repeat for multiple fonts. `Atkinson` is built in     |
| `--kerf <mm>`         | Override kerf for every part                                              |
| `--sheet <W>x<H>`     | Set the sheet width and height in millimetres                             |
| `--gap <mm>`          | Set spacing between parts                                                 |
| `--margin <mm>`       | Set spacing at sheet edges; defaults to the gap                           |
| `--no-pack`           | Keep the positions defined in the program                                 |
| `--guides`            | Include the guide layer                                                   |
| `--split`             | Export one file per sheet, and each sheet's back-face job                 |
| `--nest`              | Pack small parts into the holes of bigger ones                            |
| `--stats`             | With `check`: points in the files, by part and layer                      |
| `--sweep name=a:s:b`  | With `check`: try every value from a to b in steps of s, or `name=a,b,c`  |
| `-h, --help`          | Show command help                                                         |
| `-v, --version`       | Show version numbers                                                      |

`-D` accepts KerfScript values, including numbers, quoted strings, booleans
and lists. For example: `-D width=200` or `-D 'name="Ada"'`.

`kerf check` lists the parts, how many make each glued stack and what a
part is glued to, the hardware to buy, alike pieces counted together, and
the assembly steps. A design with marks on the parts' back faces writes a
second file beside the first, `design-back.svg`: the sheet turned over
left to right, for the job after the parts are turned over.

`--sweep` checks a design over many settings at once. Repeat it to try
every combination; each line says `ok` or lists what went wrong, and the
command exits with 1 if any combination warns or fails:

```sh
kerf check tray.kerf --sweep '$thickness=3:0.5:6' --sweep size=small,large
```

The `"sheet": [600, 400]` in a project's `kerf.json` is the sheet for every
design in the project that does not set `$sheet`: set your laser's bed
once.

## Examples

```sh
kerf render name-sign.kerf -D 'name="Ada"' --font Inter-Bold.ttf -o ada.svg
kerf render box.kerf --sheet 400x300 --kerf 0.12 --split -o box.svg
kerf render box.kerf -o box.dxf
kerf check box.kerf
kerf import ornament.svg -o ornament.kerf
```

For multiple sheets, `--split` creates numbered files such as `box-1.svg`
and `box-2.svg`. Use it for DXF exports of a design with several sheets.

Warnings are written to standard error and allow rendering to continue.
An error stops the command with a non-zero exit code. It shows the line with
the problem underlined, the calls it happened inside and, for a built-in
given a bad argument, what that built-in takes:

```text
error: Unknown variable "widht". Did you mean "width"?
 --> panel.kerf:3:9
  |
3 |   rect([widht, 20]);
  |         ^^^^^
  = in module panel(), called at panel.kerf:5:1
```

## Fonts

The CLI has one font built in, Atkinson Hyperlegible, as `Atkinson`: the same
font and name as the playground. Text that names no font uses it.

Supply other font files with `--font`. The CLI does not look up fonts
installed on your system. `--font Inter-Bold.ttf` makes the font available
as `Inter-Bold`. A design can request it with `font = "Inter-Bold"`. The
first supplied font becomes the default for text that does not name one, and
`Atkinson` stays available.
