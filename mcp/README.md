# KerfScript MCP

Tools for agents writing parametric laser-cutting designs and building generators.
The standalone server needs no MyLaserTools account. It provides documentation,
examples, editable parameters, and SVG/DXF rendering through the official MCP SDK.

This package is prepared for release; the npm package and hosted endpoint must be
published before public install instructions can use them.

## Local setup

From the repository root:

```sh
npm ci
npm run build
npm --prefix mcp ci
npm --prefix mcp run check
```

Configure an MCP client with the absolute path to the built executable:

```json
{
  "mcpServers": {
    "kerfscript": {
      "command": "node",
      "args": ["/absolute/path/to/kerfscript/mcp/dist/stdio.js"]
    }
  }
}
```

Use a Windows path such as `C:/projects/kerfscript/mcp/dist/stdio.js` on Windows.
Only protocol messages are written to stdout.

## Tools

| Tool                    | Inputs and result                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kerfscript_docs`       | Omit `topic` for an index; select a topic and follow `nextOffset` for long guides.                                                                                                    |
| `kerfscript_examples`   | Search `query` across titles, ids and tags; pass `id` for complete source. Lists are paginated.                                                                                       |
| `kerfscript_parameters` | Pass `source` to extract settings and ranges for UI controls.                                                                                                                         |
| `kerfscript_render`     | Pass `source`, optional `params`, `libraries`, sheet/layout settings and `format` (`svg` or `dxf`). Returns one file per sheet, part sizes, layers, warnings and interpreter version. |

Results are returned as structured JSON and text for client compatibility.
Language failures return `isError: true` with source positions when available.
File contents are returned inline; no public download links or stored designs are
created. Output dimensions are in millimetres. Sheet dimensions include layout
margins; `parts` reports individual part dimensions.

An agent building a generator should read the `javascript` and `customizer`
guides, inspect a relevant example, extract its parameters and try a render.
The finished application should install `@mylasertools/kerfscript` and render
locally, recording the interpreter version and fonts for reproducible exports.

## MyLaserTools integration

Reuse the registration function on the existing SDK server:

```js
import { registerKerfScriptTools } from '@mylasertools/kerfscript-mcp';
import { isolatedExecute } from '@mylasertools/kerfscript-mcp/node';

registerKerfScriptTools(existingServer, isolatedExecute);
```

The Node executor runs each job in a separate worker thread with a five second
deadline, a 96 MiB old-generation heap limit and at most two concurrent jobs.
Cancellation terminates its worker. These are execution limits, not an OS sandbox.
KerfScript itself has no general JavaScript, filesystem or network access.

For a Workers host, use a service binding to the standalone Worker or supply an
executor with equivalent isolation and limits. The `./execute` export is
synchronous and must run inside a host that enforces a CPU budget. A JavaScript
timer cannot interrupt synchronous geometry work. Never run it directly on a
shared Node HTTP event loop.

Registration does not change MyLaserTools authentication or accounting. Its host
must decide how these tools fit its existing access policy. This repository does
not contain or modify the MyLaserTools server.

## Hosted deployment

The Worker exposes `/mcp` using stateless Streamable HTTP with JSON responses.
GET and DELETE return 405 because there are no long-lived streams or sessions.
`/health` identifies the service. Each HTTP request creates and closes its own
MCP server and transport; user data is never kept in global state.

```sh
cd mcp
npm run check
npm run deploy:check
npx wrangler whoami
npx wrangler deploy
```

Before publishing, verify the Cloudflare account, reserve a unique rate-limit
namespace for this account, and review the origin allowlist in `wrangler.jsonc`.
Use the deployment's reported URL with `/mcp` appended. Add a custom domain only
after choosing its DNS name. Browser clients require their exact origin in
`ALLOWED_ORIGINS`; native MCP clients normally send no Origin header.

The Worker is separate from the website and has a 1,000 ms CPU budget per request
(requires a Workers plan supporting that limit). Platform resource termination
can produce a platform error rather than a structured MCP error. The public
endpoint allows approximately 60 requests per minute per connecting IP per
Cloudflare location. Users behind one proxy share that allowance; it is abuse
mitigation, not a strict global quota or spending cap. Rejected requests return
429 with Retry-After. Request bodies are limited to 256,000 bytes by the SDK,
including streamed bodies without Content-Length.

Programs have at most 64,000 characters. Up to 20 virtual imports may be provided
with a combined 64,000 characters; exact import names are resolved only in that
map or the bundled standard library. No local paths or remote URLs are fetched.
The service limits evaluation to 100,000 steps, 100 parts, 512 segments per arc,
50,000 created points, 30,000 output points and 10 sheets. Serialized results are
limited to 1,000,000 UTF-8 bytes. Callers cannot increase these limits.

The bundled font is Atkinson Hyperlegible (`Atkinson`). Arbitrary font uploads
are not supported by this endpoint. Use the library directly for other fonts.
Warnings and successful rendering do not establish physical fit or machine
compatibility; check the compatibility guide and calibrate the material.

The application does not log source code or tool arguments. Cloudflare operational
logs still include request metadata according to the account's retention settings.

## Release and discovery

Build from the intended interpreter release; docs and examples are embedded from
that same checkout, so rendering never depends on a mutable documentation URL.
Run the package checks, Worker dry run, and a live initialize/list/render smoke
test on staging before publishing. Inspect `npm pack --dry-run`, verify the npm
account, and publish the package. Register the deployed endpoint with the official
MCP Registry and Smithery using the verified public URL. A listing does not make
the server automatically available in every agent client.

MCP dependencies are confined to this package. Installing the core KerfScript
library does not install a server or the MCP SDK. The core library, its third-party
notices and the font's OFL licence are included in the distribution.
