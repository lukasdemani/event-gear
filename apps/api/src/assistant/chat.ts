/**
 * @file chat.ts
 * @purpose Claude API call with agentic tool-use loop
 *
 * @inputs  User message, conversation history, InventoryService instance
 * @outputs Final assistant text response
 */
import Anthropic from '@anthropic-ai/sdk';
import type { InventoryService } from '@eventgear/inventory';
import { TOOL_DEFINITIONS, executeTool } from './tools.js';

const client = new Anthropic();

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
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  let response = await client.messages.create({
    model: 'claude-opus-4-6', // Claude 4.6 Opus — valid Anthropic model ID
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: TOOL_DEFINITIONS,
    messages,
  });

  // Agentic loop — keep going until Claude stops calling tools
  while (response.stop_reason === 'tool_use') {
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const result = await executeTool(
          block.name,
          block.input as Record<string, unknown>,
          service,
        );
        return {
          type: 'tool_result' as const,
          tool_use_id: block.id,
          content: JSON.stringify(result),
        };
      }),
    );

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    response = await client.messages.create({
      model: 'claude-opus-4-6', // Claude 4.6 Opus — valid Anthropic model ID
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFINITIONS,
      messages,
    });
  }

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  return textBlock?.text ?? 'No response generated.';
}
