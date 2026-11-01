// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import content from '../generated/content.json';
import { renderSchema, sourceSchema, type Executor } from './schema.js';
import { reply, page } from './replies.js';
import { version } from '../package.json';

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Register on an existing MyLaserTools McpServer. The host supplies isolated execution. */
export function registerKerfScriptTools(server: McpServer, execute: Executor) {
  server.registerTool(
    'kerfscript_docs',
    {
      description:
        'Read KerfScript language and JavaScript integration documentation for building laser-cutting generators. Omit topic to list guides. Long guides are paginated with nextOffset.',
      inputSchema: z
        .object({
          topic: z.string().max(100).optional(),
          offset: z.number().int().min(0).default(0),
        })
        .strict(),
      annotations,
    },
    async ({ topic, offset }) => {
      if (!topic)
        return reply({
          topics: Object.keys(content.docs),
          version: content.version,
          languageVersion: content.languageVersion,
        });
      if (!Object.hasOwn(content.docs, topic))
        return reply({
          ok: false,
          error: { message: 'Unknown topic. Omit topic to list guides.' },
        });
      const text = content.docs[topic as keyof typeof content.docs];
      return reply({
        topic,
        ...page(text, offset),
      });
    },
  );
  server.registerTool(
    'kerfscript_examples',
    {
      description:
        'Find working parametric laser-cutting examples by title, id or tags. Supply an id from the results to get its .kerf source.',
      inputSchema: z
        .object({
          query: z.string().max(200).default(''),
          id: z.string().max(100).optional(),
          offset: z.number().int().min(0).default(0),
        })
        .strict(),
      annotations,
    },
    async ({ query, id, offset }) => {
      if (id) {
        const found = content.examples.find((e) => e.id === id);
        return reply(
          found
            ? { ...found, version: content.version }
            : { ok: false, error: { message: 'Unknown example id.' } },
        );
      }
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const matches = content.examples.filter((e) =>
        words.every((w) => `${e.id} ${e.title} ${e.tags.join(' ')}`.toLowerCase().includes(w)),
      );
      return reply({
        examples: matches.slice(offset, offset + 20).map(({ source, ...entry }) => entry),
        total: matches.length,
        nextOffset: offset + 20 < matches.length ? offset + 20 : null,
      });
    },
  );
  server.registerTool(
    'kerfscript_parameters',
    {
      description:
        'Extract editable settings and customizer ranges from .kerf source to build a generator UI. Parses without rendering geometry.',
      inputSchema: z.object({ source: sourceSchema }).strict(),
      annotations,
    },
    async ({ source }, extra) =>
      reply(await execute({ operation: 'parameters', source }, extra.signal)),
  );
  server.registerTool(
    'kerfscript_render',
    {
      description:
        'Render .kerf source to SVG or DXF files, one per sheet, with part sizes, layers and warnings. Uses millimetres and bundled Atkinson font. No filesystem or network imports. Bounded to 100 parts and 10 sheets. For production generators install @mylasertools/kerfscript locally.',
      inputSchema: renderSchema,
      annotations,
    },
    async (input, extra) => reply(await execute({ operation: 'render', input }, extra.signal)),
  );
}

export function createKerfScriptServer(execute: Executor) {
  const server = new McpServer(
    { name: 'kerfscript', version, title: 'KerfScript by MyLaserTools' },
    {
      instructions:
        'Use KerfScript to build parametric laser-cutting designs and generators. Read the javascript and customizer guides for application integration. Rendering returns files in millimetres; machine settings and physical fit require verification. Tools do not store submitted designs.',
    },
  );
  registerKerfScriptTools(server, execute);
  return server;
}
