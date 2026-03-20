# Conversational Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating chat button to the web app that opens an overlay where users type natural language and Claude executes inventory operations on their behalf.

**Architecture:** A `POST /assistant/chat` Express route acts as a secure proxy — it receives `{ message, history }` from the browser, calls the Claude API with tool definitions mapped to all 12 inventory service methods, executes any tool calls against `InventoryService` directly, and returns the final text response. Input is sanitised for prompt injection and offensive content before reaching Claude.

**Tech Stack:** `@anthropic-ai/sdk` (server), React `useState` (chat UI), Tailwind v4 (styling), `bad-words` (offensive content filter)

---

## File Map

**API (new files)**
- `apps/api/src/assistant/tools.ts` — 12 tool definitions (JSON Schema) + tool executor that calls `InventoryService`
- `apps/api/src/assistant/guardrails.ts` — prompt injection detector + offensive word filter
- `apps/api/src/assistant/chat.ts` — Claude API call, tool-use loop, response assembly
- `apps/api/src/assistant/route.ts` — Express route handler for `POST /assistant/chat`

**API (modified)**
- `apps/api/src/server.ts` — mount assistant route
- `apps/api/.env.local.example` — add `ANTHROPIC_API_KEY` entry
- `apps/api/package.json` — add `@anthropic-ai/sdk` and `bad-words`

**Web (new files)**
- `apps/web/src/features/assistant/AssistantButton.tsx` — floating button + overlay container
- `apps/web/src/features/assistant/ChatWindow.tsx` — message list + input form
- `apps/web/src/features/assistant/api.ts` — `sendMessage(message, history)` fetch call
- `apps/web/src/features/assistant/types.ts` — `Message` type

**Web (modified)**
- `apps/web/src/App.tsx` — render `<AssistantButton />` alongside `<Routes>`

---

## Task 1: Install dependencies and add API key config

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/.env.local.example`
- Modify: `apps/api/.env.local`

- [ ] **Step 1: Install SDK and filter packages**

```bash
pnpm --filter @eventgear/api add @anthropic-ai/sdk bad-words
pnpm --filter @eventgear/api add -D @types/bad-words
```

- [ ] **Step 2: Add API key to env example**

Add to `apps/api/.env.local.example`:
```
# ── AI Assistant ───────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=your-api-key-here
```

- [ ] **Step 3: Add your real key to apps/api/.env.local**

```
ANTHROPIC_API_KEY=sk-ant-...
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json apps/api/.env.local.example pnpm-lock.yaml
git commit -m "chore(api): add anthropic sdk and bad-words dependencies"
```

---

## Task 2: Guardrails — prompt injection + offensive content

**Files:**
- Create: `apps/api/src/assistant/guardrails.ts`

- [ ] **Step 1: Create the guardrails module**

```typescript
// apps/api/src/assistant/guardrails.ts
/**
 * @file guardrails.ts
 * @purpose Input sanitisation: prompt injection detection and offensive content filter
 *
 * @inputs  Raw user message string
 * @outputs { safe: true } | { safe: false; reason: string }
 */
import Filter from 'bad-words';

const offensiveFilter = new Filter();

/**
 * Patterns that attempt to override the system prompt or escape the assistant role.
 * Kept as a denylist of known injection vectors.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /forget\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /you\s+are\s+now\s+(?!an?\s+eventgear)/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /new\s+instructions?\s*:/i,
  /system\s*prompt\s*:/i,
  /\[INST\]/i,
  /<<SYS>>/i,
  /<\|im_start\|>/i,
];

export type GuardrailResult =
  | { safe: true }
  | { safe: false; reason: string };

export function checkInput(message: string): GuardrailResult {
  const trimmed = message.trim();

  if (trimmed.length === 0) {
    return { safe: false, reason: 'Message is empty.' };
  }

  if (trimmed.length > 2000) {
    return { safe: false, reason: 'Message is too long (max 2000 characters).' };
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { safe: false, reason: 'Message contains disallowed content.' };
    }
  }

  if (offensiveFilter.isProfane(trimmed)) {
    return { safe: false, reason: 'Message contains offensive language.' };
  }

  return { safe: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/assistant/guardrails.ts
git commit -m "feat(api): add assistant input guardrails"
```

---

## Task 3: Tool definitions and executor

**Files:**
- Create: `apps/api/src/assistant/tools.ts`

- [ ] **Step 1: Create tools module**

```typescript
// apps/api/src/assistant/tools.ts
/**
 * @file tools.ts
 * @purpose Claude tool definitions (JSON Schema) + executor that calls InventoryService
 *
 * @inputs  Tool name + input from Claude, InventoryService instance
 * @outputs Tool result as a plain object for Claude's tool_result block
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { InventoryService } from '@eventgear/inventory';

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'list_categories',
    description: 'List all equipment categories.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_category',
    description: 'Create a new equipment category.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Category name' },
        description: { type: 'string', description: 'Optional description' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_equipment',
    description: 'List equipment items, optionally paginated.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max items to return' },
        nextToken: { type: 'string', description: 'Pagination cursor' },
      },
      required: [],
    },
  },
  {
    name: 'get_equipment',
    description: 'Get a single equipment item by ID.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Equipment ID' } },
      required: ['id'],
    },
  },
  {
    name: 'create_equipment',
    description: 'Create a new equipment item in the catalog.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        categoryId: { type: 'string' },
        dailyRate: { type: 'number' },
        description: { type: 'string' },
        weeklyRate: { type: 'number' },
      },
      required: ['name', 'categoryId', 'dailyRate'],
    },
  },
  {
    name: 'update_equipment',
    description: 'Update an existing equipment item.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        dailyRate: { type: 'number' },
        weeklyRate: { type: 'number' },
        isActive: { type: 'boolean' },
        description: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_stock_units',
    description: 'List all physical stock units for a given equipment item.',
    input_schema: {
      type: 'object',
      properties: { equipmentId: { type: 'string' } },
      required: ['equipmentId'],
    },
  },
  {
    name: 'create_stock_unit',
    description: 'Add a new physical stock unit to an equipment item.',
    input_schema: {
      type: 'object',
      properties: {
        equipmentId: { type: 'string' },
        serialNumber: { type: 'string' },
        condition: { type: 'string', enum: ['EXCELLENT','GOOD','FAIR','POOR','NEEDS_REPAIR','RETIRED'] },
        purchaseDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        notes: { type: 'string' },
      },
      required: ['equipmentId', 'serialNumber', 'condition', 'purchaseDate'],
    },
  },
  {
    name: 'update_unit_status',
    description: 'Update the status of a stock unit.',
    input_schema: {
      type: 'object',
      properties: {
        equipmentId: { type: 'string' },
        unitId: { type: 'string' },
        status: { type: 'string', enum: ['AVAILABLE','RESERVED','MAINTENANCE','RETIRED','DISPATCHED'] },
        reason: { type: 'string', enum: ['RESERVATION','MAINTENANCE','DAMAGE','MANUAL'] },
        referenceId: { type: 'string' },
      },
      required: ['equipmentId', 'unitId', 'status', 'reason'],
    },
  },
  {
    name: 'get_maintenance_history',
    description: 'Get the maintenance history for an equipment item.',
    input_schema: {
      type: 'object',
      properties: { equipmentId: { type: 'string' } },
      required: ['equipmentId'],
    },
  },
  {
    name: 'create_maintenance_record',
    description: 'Schedule a maintenance record for a stock unit.',
    input_schema: {
      type: 'object',
      properties: {
        equipmentId: { type: 'string' },
        unitId: { type: 'string' },
        maintenanceType: { type: 'string', enum: ['PREVENTIVE','REPAIR','INSPECTION','CLEANING'] },
        scheduledDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        notes: { type: 'string' },
        technicianId: { type: 'string' },
      },
      required: ['equipmentId', 'unitId', 'maintenanceType', 'scheduledDate'],
    },
  },
  {
    name: 'complete_maintenance',
    description: 'Mark a maintenance record as completed.',
    input_schema: {
      type: 'object',
      properties: {
        recordId: { type: 'string' },
        newCondition: { type: 'string', enum: ['EXCELLENT','GOOD','FAIR','POOR','NEEDS_REPAIR','RETIRED'] },
        notes: { type: 'string' },
        completedDate: { type: 'string', description: 'ISO datetime string' },
        technicianId: { type: 'string' },
      },
      required: ['recordId', 'newCondition', 'notes', 'completedDate', 'technicianId'],
    },
  },
];

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  service: InventoryService,
): Promise<unknown> {
  switch (name) {
    case 'list_categories':
      return service.listCategories();
    case 'create_category':
      return service.createCategory(input as Parameters<typeof service.createCategory>[0]);
    case 'list_equipment':
      return service.listEquipment(input as Parameters<typeof service.listEquipment>[0]);
    case 'get_equipment':
      return service.getEquipment(input['id'] as string);
    case 'create_equipment':
      return service.createEquipment(input as Parameters<typeof service.createEquipment>[0]);
    case 'update_equipment': {
      const { id, ...rest } = input as { id: string } & Record<string, unknown>;
      return service.updateEquipment(id, rest as Parameters<typeof service.updateEquipment>[1]);
    }
    case 'list_stock_units':
      return service.listStockUnits(input['equipmentId'] as string);
    case 'create_stock_unit': {
      const { equipmentId, ...rest } = input as { equipmentId: string } & Record<string, unknown>;
      return service.createStockUnit({ equipmentId, ...rest } as Parameters<typeof service.createStockUnit>[0]);
    }
    case 'update_unit_status': {
      const { unitId, ...rest } = input as { unitId: string } & Record<string, unknown>;
      return service.updateStockUnitStatus(unitId, rest as Parameters<typeof service.updateStockUnitStatus>[1]);
    }
    case 'get_maintenance_history':
      return service.getMaintenanceHistory(input['equipmentId'] as string);
    case 'create_maintenance_record':
      return service.createMaintenanceRecord(input as Parameters<typeof service.createMaintenanceRecord>[0]);
    case 'complete_maintenance': {
      const { recordId, ...rest } = input as { recordId: string } & Record<string, unknown>;
      return service.completeMaintenanceRecord(recordId, rest as Parameters<typeof service.completeMaintenanceRecord>[1]);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/assistant/tools.ts
git commit -m "feat(api): add assistant tool definitions and executor"
```

---

## Task 4: Claude chat loop

**Files:**
- Create: `apps/api/src/assistant/chat.ts`

- [ ] **Step 1: Create the chat module**

```typescript
// apps/api/src/assistant/chat.ts
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
  const client = new Anthropic();

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
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/assistant/chat.ts
git commit -m "feat(api): add claude chat loop with tool use"
```

---

## Task 5: Express route

**Files:**
- Create: `apps/api/src/assistant/route.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Create the route handler**

```typescript
// apps/api/src/assistant/route.ts
/**
 * @file route.ts
 * @purpose Express route handler for POST /assistant/chat
 *
 * @inputs  { message: string, history: ChatMessage[] }
 * @outputs { reply: string } | { error: { code, message } }
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
      ? (history as unknown[]).filter(
          (m): m is ChatMessage =>
            typeof m === 'object' &&
            m !== null &&
            'role' in m &&
            'content' in m &&
            (m as ChatMessage).role !== undefined &&
            (m as ChatMessage).content !== undefined,
        ).slice(-20) // cap history at last 20 turns
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
```

- [ ] **Step 2: Mount the route in server.ts**

Add after the existing imports and before the route definitions:

```typescript
import { createAssistantRoute } from './assistant/route.js';
```

Add after `app.use(express.json());` — `wrap` is the existing error-catching helper already used for all other routes in this file:

```typescript
// ── Assistant ────────────────────────────────────────────────────────────────
app.post('/assistant/chat', wrap(createAssistantRoute(service)));
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/assistant/route.ts apps/api/src/server.ts
git commit -m "feat(api): add POST /assistant/chat route"
```

---

## Task 6: Web — types and API client

**Files:**
- Create: `apps/web/src/features/assistant/types.ts`
- Create: `apps/web/src/features/assistant/api.ts`

- [ ] **Step 1: Create types**

```typescript
// apps/web/src/features/assistant/types.ts
export interface Message {
  role: 'user' | 'assistant';
  content: string;
}
```

- [ ] **Step 2: Create API function**

Note: `__API_BASE_URL__` is already a Vite `define` constant declared in `vite.config.ts` and typed in `src/vite-env.d.ts` — no extra config needed.

```typescript
// apps/web/src/features/assistant/api.ts
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
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/assistant/
git commit -m "feat(web): add assistant types and api client"
```

---

## Task 7: Web — chat window component

**Files:**
- Create: `apps/web/src/features/assistant/ChatWindow.tsx`

- [ ] **Step 1: Create ChatWindow**

```tsx
// apps/web/src/features/assistant/ChatWindow.tsx
/**
 * @file ChatWindow.tsx
 * @purpose Scrollable message list + input form for the assistant overlay
 */
import { useState, useRef, useEffect } from 'react';
import Spinner from '@/components/ui/Spinner';
import { sendMessage } from './api';
import type { Message } from './types';

interface ChatWindowProps {
  onClose: () => void;
}

export default function ChatWindow({ onClose }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hi! I\'m the EventGear assistant. Ask me anything about your inventory — I can look things up, create records, schedule maintenance, and more.' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: Message = { role: 'user', content: text };
    const next = [...messages, userMessage];
    setMessages(next);
    setInput('');
    setLoading(true);
    setError(undefined);

    try {
      const { reply } = await sendMessage(text, messages);
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white rounded-t-2xl">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400" />
          <span className="text-sm font-semibold text-gray-800">EventGear Assistant</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-800 rounded-bl-sm'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-3 py-2">
              <Spinner size={16} />
            </div>
          </div>
        )}
        {error !== undefined && (
          <div className="flex justify-start">
            <div className="bg-red-50 border border-red-200 rounded-2xl rounded-bl-sm px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-3 py-3 border-t border-gray-200 bg-white rounded-b-2xl">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask me anything..."
            disabled={loading}
            className="flex-1 border border-gray-300 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || input.trim() === ''}
            className="w-8 h-8 flex items-center justify-center bg-indigo-600 rounded-full text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            aria-label="Send"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/features/assistant/ChatWindow.tsx
git commit -m "feat(web): add assistant chat window component"
```

---

## Task 8: Web — floating button and overlay

**Files:**
- Create: `apps/web/src/features/assistant/AssistantButton.tsx`
- Modify: `apps/web/src/components/layout/AppShell.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Create AssistantButton**

```tsx
// apps/web/src/features/assistant/AssistantButton.tsx
/**
 * @file AssistantButton.tsx
 * @purpose Floating chat button fixed bottom-right + chat overlay
 */
import { useState } from 'react';
import ChatWindow from './ChatWindow';

export default function AssistantButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 transition-colors flex items-center justify-center"
        aria-label="Open assistant"
      >
        {open ? (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </button>

      {/* Chat overlay */}
      {open && (
        <div className="fixed bottom-24 right-6 z-40 w-96 h-[32rem] rounded-2xl shadow-2xl border border-gray-200 bg-white flex flex-col overflow-hidden">
          <ChatWindow onClose={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Add AssistantButton to App.tsx**

In `apps/web/src/App.tsx`, import and render `<AssistantButton />` outside the `<Routes>` block but inside `<BrowserRouter>`:

```tsx
import AssistantButton from '@/features/assistant/AssistantButton';

// Inside the return, after </Routes>:
<AssistantButton />
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/assistant/AssistantButton.tsx apps/web/src/App.tsx
git commit -m "feat(web): add floating assistant button and chat overlay"
```

---

## Task 9: Update env example and .gitignore

**Files:**
- Modify: `apps/api/.env.local.example`
- Modify: `.gitignore`

- [ ] **Step 1: Ensure .superpowers is gitignored**

Add to `.gitignore` if not present:
```
.superpowers/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore apps/api/.env.local.example
git commit -m "chore: ignore superpowers brainstorm dir and document anthropic key"
```
