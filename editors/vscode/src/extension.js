// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only

// Starts the KerfScript language server that comes with the extension:
// problems while typing, hover, completion, parameter hints, go to
// definition, references, rename, outline and formatting.

const { workspace } = require('vscode');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');

let client;

exports.activate = function activate(context) {
  const module = context.asAbsolutePath('dist/server.js');
  const server = { module, transport: TransportKind.stdio };
  client = new LanguageClient(
    'kerfscript',
    'KerfScript',
    { run: server, debug: server },
    {
      documentSelector: [
        { scheme: 'file', language: 'kerfscript' },
        { scheme: 'untitled', language: 'kerfscript' },
      ],
      // Libraries changed outside the editor are read again
      synchronize: { fileEvents: workspace.createFileSystemWatcher('**/*.kerf') },
    },
  );
  return client.start();
};

exports.deactivate = function deactivate() {
  return client?.stop();
};
