# Developing the KerfScript MCP

This file is for maintainers and is not part of the npm package. Usage is in
[README.md](README.md).

## Build and test

From the repository root:

```sh
npm ci
npm run build
npm --prefix mcp ci
npm --prefix mcp run check
```

The docs and examples are embedded from the same checkout, so build from the
interpreter release the server should ship with.

## Embedding the tools

`registerKerfScriptTools(server, execute)` adds the four tools to an existing
`McpServer`. In Node.js, pass `isolatedExecute` from
`@mylasertools/kerfscript-mcp/node`, which runs each job in a worker thread
with a time limit, or a pool from `createExecutorPool()`. The `./execute`
export is synchronous and must only run where the host can stop it.

## Deploying

The hosted server is a Cloudflare Worker configured in `wrangler.jsonc`:

```sh
cd mcp
npm run check
npm run deploy:check
npx wrangler deploy
```

## Releasing

1. Bump `version` in `package.json` and both `version` fields in
   `server.json`. The tests fail if they differ.
2. Run `npm publish` from `mcp/`.
3. Once npm serves the new version, update the MCP Registry listing with
   `mcp-publisher login dns --domain mylasertools.com --private-key <key>` and
   `mcp-publisher publish`.
