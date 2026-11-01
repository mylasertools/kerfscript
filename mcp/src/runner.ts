// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import { parentPort, workerData } from 'node:worker_threads';
import { execute } from './execute.js';
parentPort!.postMessage(execute(workerData));
