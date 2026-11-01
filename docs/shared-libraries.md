# Shared libraries

A shared library is a folder of `.kerf` files with a `kerf.json` that names
it. You publish one by tagging a GitHub repository, or by putting a `.tar.gz`
anywhere that serves it over https. A project lists the libraries its designs
use in its own `kerf.json`. `kerf install` copies them into `kerf_libraries/`
and pins each one in `kerf.lock`, by its exact commit and a hash of its
files, so a design renders the same way on every machine, now and later.

The [standard library](library.md) is built into every renderer and needs
none of this: `use <kerf/box>` always works.

## Use a library

In the folder that holds your designs:

```sh
kerf add github:maker/kerf-feet@v1.0.0
```

This creates a `kerf.json` the first time:

```json
{
  "libraries": {
    "feet": "github:maker/kerf-feet@v1.0.0"
  }
}
```

The library's own `kerf.json` gives its name, here `feet`. Its files go into
`kerf_libraries/feet/`, and `kerf.lock` records exactly what was installed.
A design then loads them with the library's name first:

```kerf
use <feet/feet>

part("base") difference() {
  rect([100, 60]);
  feet([100, 60]);
}
```

`kerf render`, `kerf check`, the desktop app and the language server in your
editor all find it. The playground has the standard library only.

A source is one of:

| Source                        | Means                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `github:owner/repo@v1.0.0`    | A GitHub repository at a tag, a branch or a commit; without `@`, its default branch |
| `https://…/feet-1.0.0.tar.gz` | A `.tar.gz` such as `kerf pack` writes, from any https link                         |
| `./libraries/feet`            | A folder on this computer, for a library you are writing                            |

To change version, add it again with the new tag; `kerf add` replaces the
source. `kerf remove feet` takes a library out.

## What to commit

Commit `kerf.json` and `kerf.lock`. Then either:

- commit `kerf_libraries/` too, so the project works without a download,
  in the desktop app as well, or
- leave it out (add it to `.gitignore`) and run `kerf install` after each
  clone. It downloads the exact files `kerf.lock` pins.

## How a design finds a library

For a path that does not start with `kerf/`, a design looks in its project,
the nearest folder at or above the design's own with a `kerf.json`:

1. `use <name/...>`, where `name` is the project's own name in its
   `kerf.json`: a file of the project, from its top folder. A library uses
   this for its own files, and so do the designs and examples inside it.
2. `use <name/...>`, where `kerf_libraries/name/` exists: that installed
   library's file.
3. Anything else: a file in the design's folder or below it, as before.

Each path is tried as written and with `.kerf` added. A design in
`projects/shelf/designs/` therefore finds `use <feet/feet>` in
`projects/shelf/kerf_libraries/feet/feet.kerf` when `projects/shelf/` has
the `kerf.json`.

## Reproducing a design

`kerf.lock` holds one entry for each library, including the ones other
libraries use:

```json
{
  "lockVersion": 1,
  "libraries": {
    "feet": {
      "source": "github:maker/kerf-feet@v1.0.0",
      "version": "1.0.0",
      "resolved": "https://github.com/maker/kerf-feet/archive/3f2c…e91a.tar.gz",
      "integrity": "sha256-4hC4hj++68l+quohmEdLL/KYF9lwtTD7Hon6G+5V9kY="
    }
  }
}
```

- `resolved` is the exact commit. A tag can be moved to other code later; the
  commit cannot, so `kerf install` downloads from here, not from the tag.
- `integrity` is a sha256 hash of the library's files. `kerf install` refuses
  files that do not match it. The hash ignores line endings, so git's
  conversions on Windows do not change it.

In CI, install exactly what is pinned, and fail if `kerf.lock` would need to
change:

```sh
kerf install --frozen
kerf render designs/shelf.kerf -o shelf.svg
```

`kerf install --check` downloads nothing. It checks that `kerf.json`,
`kerf.lock` and `kerf_libraries/` agree, and that no one has edited an
installed file. It exits with 1 and lists the differences when they do not.

The libraries are one part of a design's output; the renderer is the other.
Pin the `kerf` or npm package version too, as in [Versions](versions.md).

## Libraries that use libraries

A library's `kerf.json` can name libraries of its own, and `kerf install`
installs them too. There is one copy of each name in `kerf_libraries/`. When
two libraries want the same library from different sources, the install
stops and asks you to choose. Add that library to your own `kerf.json`; the
project's choice wins:

```json
{
  "libraries": {
    "stand": "github:maker/kerf-stand@v2.0.0",
    "lamp": "github:other/kerf-lamp@v1.4.0",
    "feet": "github:maker/kerf-feet@v1.1.0"
  }
}
```

## Publish a library

A library's top folder holds its `kerf.json`:

```json
{
  "name": "feet",
  "version": "1.0.0",
  "description": "Holes for rubber feet",
  "license": "MIT",
  "language": "0.1",
  "libraries": {}
}
```

| Field         | Use                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | Required. Lowercase letters, digits, `-` and `_`. Designs write `use <name/...>`. `kerf` is the standard library's                  |
| `version`     | Required to pack. `1.2.0`: raise the first number when a module's parameters change, or when existing designs would cut differently |
| `description` | One line on what it makes                                                                                                           |
| `license`     | The licence others may use it under                                                                                                 |
| `language`    | The oldest KerfScript language version it works with; older `kerf` versions refuse to install it                                    |
| `libraries`   | Libraries it uses, from `github:` or `https:` sources                                                                               |

A library is its `.kerf` files in any folder, its `kerf.json`, and the
`README`, `LICENSE` and `CHANGELOG` in its top folder. Pictures, tests and
dot folders such as `.github` are left out when it is installed.

Inside the library, load its own files by its name, `use <feet/size>`, not
`use <size>`. That works while you write it, since the project is named
`feet`, and once it is installed next to someone else's designs. Put a
comment above each module: editors show it on hover, as for the
[standard library](library.md).

Before each release, run:

```sh
kerf pack
```

It parses every `.kerf` file and checks every `use <...>`. Each must name the
standard library, the library's own files as `<name/...>`, or a library in
its `kerf.json`. Then it writes `feet-1.0.0.tar.gz`. To publish:

1. On GitHub, commit, then tag the version and push the tag:
   `git tag v1.0.0 && git push origin v1.0.0`. Others run
   `kerf add github:you/kerf-feet@v1.0.0`.
2. Anywhere else, upload the `.tar.gz` (a GitHub release asset works too), and
   others run `kerf add https://…/feet-1.0.0.tar.gz`.

Do not move a tag or replace a file once it is published. The projects that
pinned it would no longer install; publish a new version instead.

## Safety

A KerfScript program cannot read files or reach the network, so a library can
only make shapes and run within the renderer's step limits. `kerf install`
writes only inside `kerf_libraries/`. It refuses an archive with a file that
would land outside its folder, a plain `http://` link (except on this
computer), and a download over 20 MB. The desktop app reads only `.kerf`
files, and only from the design's folder and the project's.

## From JavaScript

The `@mylasertools/kerfscript/libraries` module, for Node.js, finds and
installs libraries the same way the command line does:

```js
import { render } from '@mylasertools/kerfscript';
import { resolver, install, check } from '@mylasertools/kerfscript/libraries';
import { readFileSync } from 'node:fs';

await install('projects/shelf', { frozen: true });
const file = 'projects/shelf/designs/shelf.kerf';
const result = render(readFileSync(file, 'utf8'), { resolve: resolver(file) });
```

| Export                                    | Does                                                             |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `resolver(designFile)`                    | A `resolve` option for `render()` that finds libraries as above  |
| `libraryFile(folder, path)`               | The file `use <path>` names for a design in `folder`             |
| `findProject(folder)`                     | The nearest folder at or above `folder` with a `kerf.json`       |
| `install(root, { frozen, fetch, log })`   | `kerf install`; resolves to the new `kerf.lock`                  |
| `add(root, source)`, `remove(root, name)` | `kerf add`, `kerf remove`                                        |
| `check(root)`                             | `kerf install --check`: a list of problems, empty when all agree |
| `pack(root, out?)`                        | `kerf pack`                                                      |

Problems are thrown as `LibraryError`, with a message to show as it is.
