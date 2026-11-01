# Changelog

## Unreleased

- `kerf.json`, the file that names a project's shared libraries, is
  checked as you type, with hover help for each field
- Completion after `use <` includes the libraries in `kerf_libraries/`

## 0.1.0

- The KerfScript language server: problems while you type, hover,
  completion, parameter hints, go to definition, find references, rename,
  outline, links on library paths, and formatting with `kerf fmt`, on save
  by default
- Syntax highlighting for `.kerf` files: keywords, built-in modules and
  functions, layer modules, special variables, modifiers, `use <...>` paths
  and customizer comments
- Highlighting for `kerf` code blocks in Markdown
- Comment toggling, bracket matching and auto-closing pairs
- Snippets for modules, functions, loops, parts, materials, finger joints,
  layers and customizer settings
