/**
 * @file api.ts
 * @purpose Stream assistant SSE events from POST /assistant/chat
 *
 * @ai-notes __API_BASE_URL__ is a Vite `define` constant declared in vite.config.ts.
 *   Uses fetch (not EventSource) because the endpoint is POST with a JSON body.
 *   EventSource only supports GET — fetch ReadableStream is the correct approach.
 *   eventsource-parser handles partial chunks, multi-line data, and UTF-8 edge cases.
 *   Dispatch is on data.type (JSON payload field), not the SSE event: line.
 */
import { createParser } from 'eventsource-parser';
import type { Message, StreamEvent } from './types';

export async function* streamMessage(
  message: string,
  history: Message[],
): AsyncGenerator<StreamEvent> {
  const base = __API_BASE_URL__ || 'http://localhost:3001';
  const res = await fetch(`${base}/assistant/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  });

  if (!res.ok) {
    const err = (await res.json()) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `HTTP ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  // Array accumulates events — handles multiple events arriving in one TCP chunk
  const pending: StreamEvent[] = [];

  const parser = createParser({
    onEvent(event) {
      pending.push(JSON.parse(event.data) as StreamEvent);
    },
  });

  while (true) {
    const { done, value } = await reader.read();
    // stream: !done flushes buffered multi-byte UTF-8 sequences on the final read
    parser.feed(decoder.decode(value, { stream: !done }));
    while (pending.length > 0) {
      yield pending.shift()!;
    }
    if (done) break;
  }
}
