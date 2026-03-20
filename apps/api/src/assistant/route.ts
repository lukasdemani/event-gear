/**
 * @file route.ts
 * @purpose Express route handler for POST /assistant/chat
 *
 * @inputs  { message: string, history: ChatMessage[] }
 * @outputs { data: { reply: string } } | { error: { code, message } }
 */
import type { Request, Response } from 'express';
import type { InventoryService } from '@eventgear/inventory';
import { checkInput } from './guardrails.js';
import { runChat } from './chat.js';
import type { ChatMessage } from './chat.js';

export function createAssistantRoute(service: InventoryService) {
  return async (req: Request, res: Response): Promise<void> => {
    const { message, history = [] } = req.body as {
      message?: unknown;
      history?: unknown;
    };

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

    try {
      const reply = await runChat(message, safeHistory, service);
      res.json({ data: { reply } });
    } catch (err) {
      console.error('[assistant] error:', err);
      res.status(500).json({ error: { code: 'ASSISTANT_ERROR', message: 'Assistant unavailable' } });
    }
  };
}
