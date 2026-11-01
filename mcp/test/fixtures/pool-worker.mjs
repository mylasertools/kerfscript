// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import { parentPort, threadId } from 'node:worker_threads';
parentPort.on('message', (job) => {
  if (job.source === 'hang') {
    while (true) {}
  }
  if (job.source === 'crash') process.exit(1);
  setTimeout(() => parentPort.postMessage({ ok: true, threadId }), job.source === 'slow' ? 150 : 0);
});
parentPort.postMessage({ ready: true });
