/**
 * @file route.ts
 * @purpose SSE route handler for POST /assistant/chat
 *
 * @inputs  { message: string, history: ChatMessage[] }
 * @outputs Server-Sent Events stream with StreamEvent objects
 *
 * @ai-notes This route must NOT be wrapped with wrap() in server.ts.
 *   Once res.flushHeaders() is called, HTTP headers are committed — the global
 *   JSON error middleware cannot write a 500 body after that point.
 *   This handler owns its own try/catch and always calls res.end().
 *
 *   AbortController cancels the in-flight Claude API call when the client
 *   disconnects — without this the agentic loop keeps running and burns API quota.
 *
 *   Error cases BEFORE flushHeaders (bad input, guardrail rejection) still return
 *   JSON with the appropriate HTTP status — no change to those paths.
 */
import type { Request, Response } from 'express';
import type { InventoryService } from '@eventgear/inventory';
import { checkInput } from './guardrails.js';
import { runChat } from './chat.js';
import type { ChatMessage, EmitFn, StreamEvent } from './chat.js';

export function createAssistantRoute(service: InventoryService) {
  return async (req: Request, res: Response): Promise<void> => {
    const { message, history = [] } = req.body as {
      message?: unknown;
      history?: unknown;
    };

    // --- Pre-stream validation (JSON responses, headers not yet committed) ---

    if (typeof message !== 'string') {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'message must be a string' } });
      return;
    }

    const guard = checkInput(message);
    if (!guard.safe) {
      res.status(422).json({ error: { code: 'INPUT_REJECTED', message: guard.reason } });
      return;
    }

    const safeHistory = Array.isArray(history)
      ? (history as unknown[])
          .filter(
            (m): m is ChatMessage =>
              typeof m === 'object' &&
              m !== null &&
              'role' in m &&
              'content' in m &&
              typeof (m as ChatMessage).role === 'string' &&
              typeof (m as ChatMessage).content === 'string' &&
              ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant'),
          )
          .slice(-20)
      : [];

    // --- Open SSE stream ---

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const controller = new AbortController();
    let closed = false;
    let ended = false;

    const endResponse = () => {
      if (!ended) {
        ended = true;
        res.end();
      }
    };

    // Use res.on('close') not req.on('close') — the request stream emits 'close'
    // as soon as the request body is consumed by express.json(), which would
    // abort the Claude API call before it has a chance to respond.
    // The response 'close' only fires on true client disconnect.
    // The `ended` guard prevents this from misfiring when we call res.end() normally.
    res.on('close', () => {
      if (!ended) {
        closed = true;
        ended = true;
        controller.abort();
      }
    });

    const emit: EmitFn = (event: StreamEvent) => {
      if (closed) return;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await runChat(message, safeHistory, service, emit, 10, controller.signal);
      endResponse();
    } catch (err) {
      if (!ended) {
        emit({ type: 'error', message: err instanceof Error ? err.message : 'Assistant unavailable' });
        endResponse();
      }
    }
  };
}
