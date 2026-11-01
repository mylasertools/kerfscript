# AI assistants

The KerfScript MCP server lets an AI assistant write and check laser-cutting
designs. Through the [Model Context Protocol](https://modelcontextprotocol.io)
it reads this documentation and the examples, finds a design's settings and
renders it to SVG or DXF, so the assistant can try its code before giving it
to you.

It has four tools:

| Tool                    | What it does                                                                   |
| ----------------------- | ------------------------------------------------------------------------------ |
| `kerfscript_docs`       | Reads the guides and the language reference                                    |
| `kerfscript_examples`   | Finds examples by title or tag and returns their source                        |
| `kerfscript_parameters` | Lists a design's settings with their ranges and choices                        |
| `kerfscript_render`     | Renders a design to SVG or DXF, with its parts, sizes, layers and any warnings |

## Connecting

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

Other assistants that support remote MCP servers take the same address.

## Running it yourself

The same server runs on your computer with Node.js 20 or newer. Designs then
never leave your machine:

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

## Limits

A design may be up to 64,000 characters, with up to 20 libraries of its own
passed alongside it. It cannot read files or fetch anything from the network.
Each render stops at 100,000 steps, 100 parts and 10 sheets, and text uses the
bundled Atkinson Hyperlegible font. For bigger designs or other fonts, use the
[command line](cli.md) or the [JavaScript API](javascript.md).

The hosted server allows each client about 60 requests a minute and 1,000 a
day. It does not store or log the designs you send.

A render that succeeds does not mean the parts fit. Check a new design against
your material with a [test piece](library.md#calibration) before cutting it.
