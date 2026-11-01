// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial
import { MAX_REPLY, type Result } from './schema.js';

const envelope = (result: Result) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(result) }],
  structuredContent: result,
  ...(result.ok === false ? { isError: true } : {}),
});

export function reply(result: Result) {
  const response = envelope(result);
  if (new TextEncoder().encode(JSON.stringify(response)).length <= MAX_REPLY) return response;
  return envelope({
    ok: false,
    error: {
      message:
        'Reply exceeds the MCP output limit. Reduce the design or render locally with the KerfScript package.',
    },
  });
}

// Offsets remain UTF-16 offsets, but a page boundary never divides a surrogate pair.
export function page(text: string, offset: number, length = 12000) {
  const insidePair = (i: number) =>
    i > 0 && /[\uD800-\uDBFF]/.test(text[i - 1] ?? '') && /[\uDC00-\uDFFF]/.test(text[i] ?? '');
  const start = insidePair(offset) ? offset - 1 : offset;
  let end = Math.min(start + length, text.length);
  if (insidePair(end)) end--;
  return { text: text.slice(start, end), nextOffset: end < text.length ? end : null };
}
