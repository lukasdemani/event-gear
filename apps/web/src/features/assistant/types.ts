export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export type StreamEvent =
  | { type: 'tool_start'; tool: string; label: string }
  | { type: 'tools_done' }
  | { type: 'token'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
