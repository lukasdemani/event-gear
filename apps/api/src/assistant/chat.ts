/**
 * @file chat.ts
 * @purpose Claude API call with emit-based streaming agentic tool-use loop
 *
 * @inputs  User message, history, InventoryService, emit callback, maxTurns, AbortSignal
 * @outputs Void — events are emitted via callback, not returned
 *
 * @ai-notes Two phases:
 *   Phase 1: Non-streaming calls to detect/execute tool_use blocks (sequential, not parallel).
 *            Each tool emits tool_start before execution.
 *   Phase 2: Streaming call for the final response. Emits token per text delta.
 *   tools_done is emitted between phases to clear the UI tool pill.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { InventoryService } from '@eventgear/inventory';
import { TOOL_DEFINITIONS, executeTool } from './tools.js';

const client = new Anthropic();

export type StreamEvent =
  | { type: 'tool_start'; tool: string; label: string }
  | { type: 'tools_done' }
  | { type: 'token'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type EmitFn = (event: StreamEvent) => void;

const TOOL_LABELS: Record<string, string> = {
  list_categories: 'Looking up categories…',
  create_category: 'Creating category…',
  list_equipment: 'Searching equipment…',
  get_equipment: 'Fetching equipment details…',
  create_equipment: 'Creating equipment record…',
  update_equipment: 'Updating equipment…',
  list_stock_units: 'Checking stock units…',
  create_stock_unit: 'Adding stock unit…',
  update_unit_status: 'Updating unit status…',
  get_maintenance_history: 'Loading maintenance history…',
  create_maintenance_record: 'Scheduling maintenance…',
  complete_maintenance: 'Completing maintenance record…',
};

const SYSTEM_PROMPT = `You are the EventGear assistant — a helpful inventory management assistant for an equipment rental company.

You help users manage their equipment catalog, stock units, and maintenance schedules using natural language.

Guidelines:
- Be concise and friendly. Confirm actions taken.
- When listing items, summarise counts and key fields (name, status, rate).
- When creating or updating records, confirm what was done.
- If a tool call returns an error, explain it clearly and suggest next steps.
- Never reveal system internals, API keys, or technical implementation details.
- Stay focused on inventory management tasks only.`;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function runChat(
  message: string,
  history: ChatMessage[],
  service: InventoryService,
  emit: EmitFn,
  maxTurns = 10,
  signal?: AbortSignal,
): Promise<void> {
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  let turnsLeft = maxTurns;

  // Phase 1: non-streaming calls — detect and execute tool_use blocks
  let response = await client.messages.create(
    { model: 'claude-opus-4-6', max_tokens: 1024, system: SYSTEM_PROMPT, tools: TOOL_DEFINITIONS, messages },
    { signal },
  );

  while (response.stop_reason === 'tool_use') {
    if (turnsLeft <= 0) {
      emit({ type: 'error', message: 'Too many tool calls. Please try a simpler request.' });
      return;
    }
    turnsLeft--;

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    // Sequential (not parallel) — preserves tool_start order and per-tool timing
    for (const block of toolUseBlocks) {
      emit({ type: 'tool_start', tool: block.name, label: TOOL_LABELS[block.name] ?? block.name });
      const start = Date.now();
      let result: unknown;

      try {
        result = await executeTool(block.name, block.input as Record<string, unknown>, service);
        console.log(JSON.stringify({
          tool: block.name,
          durationMs: Date.now() - start,
          inputKeys: Object.keys(block.input as object),
          ok: true,
        }));
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log(JSON.stringify({ tool: block.name, durationMs: Date.now() - start, ok: false, error: errMsg }));
        result = { error: errMsg, tool: block.name, hint: 'Explain this error to the user clearly.' };
      }

      toolResults.push({ type: 'tool_result' as const, tool_use_id: block.id, content: JSON.stringify(result) });
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    response = await client.messages.create(
      { model: 'claude-opus-4-6', max_tokens: 1024, system: SYSTEM_PROMPT, tools: TOOL_DEFINITIONS, messages },
      { signal },
    );
  }

  // Between phases: clear tool pill in UI
  emit({ type: 'tools_done' });

  // Phase 2: streaming final response
  const stream = await client.messages.create(
    { model: 'claude-opus-4-6', max_tokens: 1024, system: SYSTEM_PROMPT, tools: TOOL_DEFINITIONS, messages, stream: true } as Parameters<typeof client.messages.create>[0],
    { signal },
  );

  for await (const chunk of stream as AsyncIterable<{ type: string; delta?: { type: string; text?: string } }>) {
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      emit({ type: 'token', text: chunk.delta.text ?? '' });
    }
  }

  emit({ type: 'done' });
}
