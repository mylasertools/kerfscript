// The bundled language server starts, runs a design in its worker and
// answers: what the extension's client will ask first.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const server = spawn(process.execPath, ['dist/server.js', '--stdio'], {
  stdio: ['pipe', 'pipe', 'inherit'],
});
let buffer = Buffer.alloc(0);
const messages = [];
let wake = () => {};
server.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const head = buffer.indexOf('\r\n\r\n');
    if (head < 0) return;
    const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, head).toString())[1]);
    if (buffer.length < head + 4 + length) return;
    messages.push(JSON.parse(buffer.subarray(head + 4, head + 4 + length).toString('utf8')));
    buffer = buffer.subarray(head + 4 + length);
    wake();
  }
});
const send = (msg) => {
  const body = JSON.stringify({ jsonrpc: '2.0', ...msg });
  server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};
const wait = async (test) => {
  const timeout = setTimeout(() => {
    console.error('No answer from the server');
    process.exit(1);
  }, 10000);
  for (;;) {
    const hit = messages.find(test);
    if (hit) {
      clearTimeout(timeout);
      return hit;
    }
    await new Promise((r) => (wake = r));
  }
};

const uri = 'untitled:Untitled-1';
send({ id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } });
const init = await wait((m) => m.id === 1);
assert.ok(init.result.capabilities.completionProvider);
send({
  method: 'textDocument/didOpen',
  params: {
    textDocument: {
      uri,
      languageId: 'kerfscript',
      version: 1,
      text: 'width = 10;\nrect(widht);\n',
    },
  },
});
const diagnostics = await wait((m) => m.method === 'textDocument/publishDiagnostics');
assert.equal(
  diagnostics.params.diagnostics[0].message,
  'Unknown variable "widht". Did you mean "width"?',
);
send({
  id: 2,
  method: 'textDocument/hover',
  params: { textDocument: { uri }, position: { line: 1, character: 1 } },
});
const hover = await wait((m) => m.id === 2);
assert.match(hover.result.contents.value, /rect\(size = 1/);
server.kill();
console.log('The language server answers');
