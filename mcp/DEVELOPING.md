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
