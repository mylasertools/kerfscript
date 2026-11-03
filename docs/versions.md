# Versions

KerfScript 0.7.0 implements language version 0.3. The package version tracks
the software release; the language version tracks the syntax and behavior
of `.kerf` programs.

Package updates can include bug fixes, export options and JavaScript API
changes without changing the language version. Use `kerf --version` to see
both numbers, or read the `VERSION` and `LANGUAGE_VERSION` exports in JavaScript.

## Before 1.0

The language may change before 1.0. Release notes identify changes that
affect existing programs or their output, including geometry and text layout
fixes. Removing or renaming a language feature requires a new language version.

Check the changelog when upgrading a tool that renders saved designs.

## From 1.0

The compatibility policy for language version 1.x is to keep existing
programs working throughout that series. New features will be added without
changing existing syntax. Bug fixes that affect output will be listed in
the changelog; other breaking changes will require language version 2.0.

## Pinning a version

For repeatable exports, record the interpreter version, settings and font
files used with a design. Applications that store designs should retain
that information and compare the output before upgrading the interpreter.

Pin the npm package to an exact version when your application needs a fixed
renderer, for example `@mylasertools/kerfscript@0.7.0`.
