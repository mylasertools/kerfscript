# Editors

KerfScript has a language server, `kerf lsp`, that gives editors what they
need to work on `.kerf` files:

- problems while you type: the design runs as you edit, and its errors and
  warnings are marked where they are, with the module calls an error
  happened inside
- hover: how to call a built-in, with its parameters and a link to the
  reference; how your own modules, functions and variables are defined, with
  the comment above them; the range of a setting
- completion of modules where a statement starts, functions and variables
  in expressions, named arguments inside a call, and library paths after
  `use <`
- parameter hints for the argument being typed
- go to definition, find references, highlighting of a name's uses and
  rename, following the [scope rules](../LANGUAGE.md#scope): a parameter's
  references include the named arguments that set it
- an outline of modules, functions and variables, and links on
  `use <...>` paths
- formatting with [`kerf fmt`](cli.md#commands)

Libraries next to a design, as in `use <tabs>`, are read from its folder,
including unsaved changes in open editors. A design is checked in a worker
thread and stopped after 10 seconds (`kerf lsp --timeout <seconds>` changes
that), so a slow design never holds up typing.

## VS Code

Install the KerfScript extension. It comes with the language server, so
nothing else is needed, and formats on save; turn that off with
`"[kerfscript]": { "editor.formatOnSave": false }` in your settings.

The extension is in
[`editors/vscode`](https://github.com/mylasertools/kerfscript/tree/main/editors/vscode).
To build it yourself:

```sh
cd editors/vscode
npm ci
npx vsce package
code --install-extension kerfscript-0.1.0.vsix
```

## Other editors

Any editor with a Language Server Protocol client can run the server.
Install the [command line](cli.md) so `kerf` is on the path, and start it
as `kerf lsp`, which talks over standard input and output.

The settings below are where to start. They follow each editor's
documentation but have not been tried in those editors; the server itself
is tested through the protocol, in VS Code and as the standalone `kerf`
binary.

### Neovim (0.11 or later)

```lua
vim.filetype.add({ extension = { kerf = 'kerfscript' } })
vim.lsp.config('kerf', {
  cmd = { 'kerf', 'lsp' },
  filetypes = { 'kerfscript' },
  root_markers = { '.git' },
})
vim.lsp.enable('kerf')
```

### Helix

In `languages.toml`:

```toml
[language-server.kerf]
command = "kerf"
args = ["lsp"]

[[language]]
name = "kerfscript"
scope = "source.kerfscript"
file-types = ["kerf"]
comment-token = "//"
block-comment-tokens = { start = "/*", end = "*/" }
indent = { tab-width = 2, unit = "  " }
language-servers = ["kerf"]
```

### Emacs (Eglot)

```elisp
(define-derived-mode kerfscript-mode prog-mode "KerfScript"
  (setq-local comment-start "// "))
(add-to-list 'auto-mode-alist '("\\.kerf\\'" . kerfscript-mode))
(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs '(kerfscript-mode "kerf" "lsp")))
```

### Sublime Text

With the [LSP](https://packagecontrol.io/packages/LSP) package, and the
[TextMate grammar](https://github.com/mylasertools/kerfscript/blob/main/editors/vscode/syntaxes/kerfscript.tmLanguage.json)
installed as a syntax, in `LSP.sublime-settings`:

```json
{
  "clients": {
    "kerf": {
      "enabled": true,
      "command": ["kerf", "lsp"],
      "selector": "source.kerfscript"
    }
  }
}
```

## In your own tools

The language server's answers come from
`@mylasertools/kerfscript/language`, which works in browsers too: see
[Language service](javascript.md#language-service).
