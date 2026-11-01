// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only

// The language server, built from the interpreter's source into one file.
// It runs designs in a worker thread started from this same file.

import { isMainThread } from 'node:worker_threads';
import { startServer, workerMain } from '../../../src/lsp.ts';

if (isMainThread) startServer({ worker: __filename });
else workerMain();
