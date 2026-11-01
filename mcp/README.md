# KerfScript MCP

An MCP server that lets AI assistants write and check
[KerfScript](https://kerfscript.mylasertools.com) laser-cutting designs. The
assistant can read the KerfScript docs and examples, find a design's settings
and render it to SVG or DXF, so it can test its code before giving it to you.

## Connect

The hosted server needs no account or key:

```text
https://mcp.mylasertools.com/mcp
```

**Claude Code**

```sh
claude mcp add --transport http kerfscript https://mcp.mylasertools.com/mcp
```

**Claude** (desktop and web): Settings → Connectors → Add custom connector, and
enter the address above.

**Cursor**: add it to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "kerfscript": { "url": "https://mcp.mylasertools.com/mcp" }
  }
}
```

**VS Code**: add it to `.vscode/mcp.json`:

```json
{
  "servers": {
    "kerfscript": { "type": "http", "url": "https://mcp.mylasertools.com/mcp" }
  }
}
```

## Run it locally

With Node.js 20 or newer, the same server runs on your computer and designs
never leave it:

```json
{
  "mcpServers": {
    "kerfscript": { "command": "npx", "args": ["-y", "@mylasertools/kerfscript-mcp"] }
  }
}
```

In Claude Code:

```sh
claude mcp add kerfscript -- npx -y @mylasertools/kerfscript-mcp
```

## Tools

| Tool                    | What it does                                                                   |
| ----------------------- | ------------------------------------------------------------------------------ |
| `kerfscript_docs`       | Reads the guides and the language reference                                    |
| `kerfscript_examples`   | Finds examples by title or tag and returns their source                        |
| `kerfscript_parameters` | Lists a design's settings with their ranges and choices                        |
| `kerfscript_render`     | Renders a design to SVG or DXF, with its parts, sizes, layers and any warnings |

Sizes are in millimetres. Text uses the bundled Atkinson Hyperlegible font.

## Limits

A design may be up to 64,000 characters, with up to 20 libraries of its own
passed alongside it. It cannot read files or fetch anything from the network.
Each render stops at 100,000 steps, 100 parts and 10 sheets. For bigger designs
or other fonts, use the [KerfScript package](https://www.npmjs.com/package/@mylasertools/kerfscript)
or its command line.

The hosted server allows each client about 60 requests a minute and 1,000 a
day. It does not store or log the designs you send.

A render that succeeds does not mean the parts fit. Cut a test piece in your
material before cutting a new design.

## More

- [AI assistants guide](https://kerfscript.mylasertools.com/docs/mcp/)
- [KerfScript documentation](https://kerfscript.mylasertools.com/docs/)
- [Issues](https://github.com/mylasertools/kerfscript/issues)

Licensed under the [GNU AGPL 3.0](https://github.com/mylasertools/kerfscript/blob/main/LICENSE),
or the free [commercial licence](https://github.com/mylasertools/kerfscript/blob/main/COMMERCIAL-LICENSE.md#free-commercial-licence)
for closed-source use.
