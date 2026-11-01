# Contributing

Thanks for helping make KerfScript better.

## Before you start

- **Sign the CLA.** Every pull request needs the [Contributor License
  Agreement](CLA.md) line in its description. We can't merge contributions
  without it, because it lets us keep offering KerfScript under both the AGPL
  and commercial licences.
- **Language changes start as an issue.** New syntax, new built-in modules or
  changes to how existing programs behave need agreement first, so the
  language stays one consistent standard. Bug fixes, docs, examples and
  standard library modules can go straight to a pull request.

## The CLA in plain words

This is a summary, not a replacement for [CLA.md](CLA.md).

- You keep the copyright in what you contribute.
- You give MyLaserTools a permanent licence to use your contribution in any
  way, **including under licences other than the AGPL**: the commercial
  licence, and other open source licences. The commercial licence is free
  today; the CLA also allows MyLaserTools to charge for it later.
- You confirm the work is yours to give, and give a patent licence for it.
- We are not required to use your contribution.

If you are not comfortable with MyLaserTools relicensing your work, please
open an issue instead of a pull request; reports and ideas need no CLA.

## What to expect

- We read every issue and pull request and aim to answer within a week.
- Bugs where the output would cut something other than what the code says
  come first.
- Good first issues are labelled `good first issue`.
- Security problems: see [SECURITY.md](SECURITY.md), not the issue tracker.

## Setup

```sh
npm install
npm run check   # build and test
```

Tests use `node --test` and run against the built `dist/`, so build before
testing. Standard library files live in `lib/` as `.kerf` source and are
compiled into `src/stdlib.ts` by the build.

`npm run compat` opens the SVG and DXF of a reference set of models in
Inkscape and checks sizes, layers and fills.

The website is in `site/` and is built from `examples/` and `docs/`:

```sh
npm --prefix site install
npm run site          # build KerfScript, then the site
npm run site:serve    # preview on http://localhost:4321
```

## Guidelines

- Keep programs that worked before working. If a change must break programs,
  it waits for the next language version and goes in the changelog.
- Every new built-in gets a test and an entry in [LANGUAGE.md](LANGUAGE.md).
- New source files start with the copyright and SPDX header used in `src/`.
- No new runtime dependencies without discussion. Anything bundled must allow
  both the AGPL and the commercial licence: permissive licences such as MIT,
  BSD, Apache-2.0, ISC and Zlib, MPL-2.0 (its files stay under the MPL), and
  the OFL for fonts.
- Format with `npm run format`, and `.kerf` files with
  `node dist/cli.js fmt examples lib integrations`.
