// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createKerfScriptServer } from './tools.js';
import { isolatedExecute } from './isolated.js';
await createKerfScriptServer(isolatedExecute).connect(new StdioServerTransport());
