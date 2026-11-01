# KerfScript MCP

Tools for agents writing parametric laser-cutting designs and building generators.
The standalone server needs no MyLaserTools account. It provides documentation,
examples, editable parameters, and SVG/DXF rendering through the official MCP SDK.

## Use it

The hosted server needs no account or key. Add this address to any client that
supports remote MCP servers:

```text
https://mcp.mylasertools.com/mcp
```

In Claude Code:

```sh
claude mcp add --transport http kerfscript https://mcp.mylasertools.com/mcp
```

To run it locally over stdio with Node.js 20 or newer:

```json
{
  "mcpServers": {
    "kerfscript": { "command": "npx", "args": ["-y", "@mylasertools/kerfscript-mcp"] }
  }
}
```

[AI assistants](https://kerfscript.mylasertools.com/docs/mcp/) has the setup for
Claude, Cursor and VS Code.

## Building from source

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
Language failures return `isError: true` with source positions and formatted
diagnostics, including call traces and built-in signatures when available.
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

The Node executor reuses two worker threads with a 96 MiB old-generation heap
limit each. Up to 16 additional jobs wait in FIFO order for at most five seconds.
Startup has its own five second deadline; each execution gets five seconds after
the worker is ready. Cancellation or a timeout terminates that worker; the next
job gets a replacement. Idle workers do not keep Node running.
Use `createExecutorPool()` from the same Node export for a separate host or tenant
pool, and call `pool.close()` when that host shuts down. The default
`isolatedExecute` shares a process-wide pool.
These are execution limits, not an OS sandbox.
KerfScript itself has no general JavaScript, filesystem or network access.

For a Workers host, bind to the named `KerfScriptService` entry point:

```json
{
  "services": [
    { "binding": "KERFSCRIPT", "service": "kerfscript-mcp", "entrypoint": "KerfScriptService" }
  ]
}
```

Forward MCP requests using
`env.KERFSCRIPT.fetchForCaller(request, "mylasertools:" + authenticatedUser.id)`.
The calling Worker must authenticate the user and supply a stable, namespaced
identifier. Caller identity is an RPC argument, never a public HTTP header.
Service callers have separate allowances from public IP clients. Requests
without `CF-Connecting-IP` must use this method; ordinary fetch requests without
that header receive 400 rather than sharing a fallback allowance.

Alternatively, supply an executor with equivalent isolation and limits. The `./execute` export is
synchronous and must run inside a host that enforces a CPU budget. A JavaScript
timer cannot interrupt synchronous geometry work. Never run it directly on a
shared Node HTTP event loop.

Registration does not change MyLaserTools authentication or accounting. Its host
must decide how these tools fit its existing access policy. This repository does
not contain or modify the MyLaserTools server.

## Hosted deployment

The Worker serves `https://mcp.mylasertools.com/mcp` using stateless Streamable
HTTP with JSON responses. GET and DELETE return 405 because there are no
long-lived streams or sessions. `/health` identifies the service. Each HTTP
request creates and closes its own MCP server and transport; user data is never
kept in global state.

```sh
cd mcp
npm run check
npm run deploy:check
npx wrangler whoami
npx wrangler deploy
```

Before publishing, verify the Cloudflare account, reserve a unique rate-limit
namespace for this account, and review the origin allowlist in `wrangler.jsonc`.
Browser clients require their exact origin in `ALLOWED_ORIGINS`; native MCP
clients normally send no Origin header.

The custom domain is the only public address: `workers.dev` and preview URLs are
off, because requests to them bypass the zone's WAF. After the first deploy, add
a WAF rate limiting rule for `mcp.mylasertools.com` in the Cloudflare dashboard.
Requests it blocks never reach the Worker and are not billed. Also turn on
billing notifications for Workers usage; Cloudflare has no hard spending cap.

### Limits and cost

The Worker is separate from the website and has a 1,000 ms CPU budget per request
(requires a Workers plan supporting that limit). Platform resource termination
can produce a platform error rather than a structured MCP error. Request bodies
are limited to 256,000 bytes, including streamed bodies without Content-Length.
JSON-RPC batches are refused with 400, so each request runs at most one tool call.

Each client may send about 60 requests per minute per Cloudflare location. A
client is an IPv4 address, an IPv6 /64 or a service caller, so one IPv6
subscriber cannot multiply its allowance by changing addresses. Users behind one
proxy share an allowance. Rejected requests return 429 with Retry-After.

A `DailyBudget` Durable Object counts requests per UTC day across all locations.
`DAILY_CLIENT_LIMIT` (1,000) caps one client, which then gets 429.
`DAILY_REQUEST_LIMIT` (20,000) caps all public clients together, and
`SERVICE_DAILY_REQUEST_LIMIT` (20,000) caps all service callers together; a pool
that reaches its cap returns 503. The pools are counted separately, so public
traffic cannot use up the allowance of MyLaserTools users. Refusals carry
Retry-After until midnight UTC. Since no request uses more than 1,000 ms of CPU,
the caps bound the daily CPU bill. If the budget cannot be reached, requests are
refused rather than allowed. To stop a pool, deploy with its cap set to 0.

Programs have at most 64,000 characters. Up to 20 virtual imports may be provided
with a combined 64,000 characters; exact import names are resolved only in that
map or the bundled standard library. No local paths or remote URLs are fetched.
The service limits evaluation to 100,000 steps, 100 parts, 512 segments per arc,
50,000 created points, 30,000 output points and 10 sheets. Complete serialized MCP
tool results, including text and structured content, are limited to 1,000,000
UTF-8 bytes. This excludes the JSON-RPC wrapper and transport headers. Oversized
results, including errors, are replaced with a small error reply. Callers cannot
increase these limits. Documentation paging uses UTF-16 offsets and preserves
surrogate pairs; follow the returned `nextOffset`.

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
test before publishing. Inspect `npm pack --dry-run`, verify the npm account, and
publish the package with `npm publish` from `mcp/`.

The server is listed in the official MCP Registry as `com.mylasertools/kerfscript`,
described by `server.json`. Keep its two `version` fields equal to the package
version. The name is proven by a `v=MCPv1` TXT record on `mylasertools.com`; the
matching private key is kept outside the repository. After publishing the npm
package:

```sh
mcp-publisher login dns --domain mylasertools.com --private-key <hex key>
mcp-publisher publish
```

A listing does not make the server automatically available in every agent client.

MCP dependencies are confined to this package. Installing the core KerfScript
library does not install a server or the MCP SDK. The core library, its third-party
notices and the font's OFL licence are included in the distribution.
