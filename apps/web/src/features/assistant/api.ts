/**
 * @file api.ts
 * @purpose Send a message to the assistant API and return the reply
 *
 * @ai-notes __API_BASE_URL__ is a Vite `define` constant declared in vite.config.ts
 *   and typed in src/vite-env.d.ts — no extra configuration needed.
 */
import type { Message } from './types';

export async function sendMessage(
  message: string,
  history: Message[],
): Promise<{ reply: string }> {
  const base = __API_BASE_URL__ || 'http://localhost:3001';
  const res = await fetch(`${base}/assistant/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  });

  const json = (await res.json()) as unknown;

  if (!res.ok) {
    const err = json as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `HTTP ${res.status}`);
  }

  const body = json as { data: { reply: string } };
  return body.data;
}
