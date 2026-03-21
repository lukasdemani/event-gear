/**
 * @file chat.test.ts
 * @purpose Unit tests for the emit-based agentic tool-use loop
 */
import type { EmitFn, StreamEvent } from '../chat';

// --- Mocks (must be defined before any imports that use them) ---

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

jest.mock('../tools', () => ({
  TOOL_DEFINITIONS: [],
  executeTool: jest.fn().mockResolvedValue({ items: [] }),
}));

// Lazy import AFTER mocks are set up
let runChat: typeof import('../chat').runChat;
beforeAll(async () => {
  ({ runChat } = await import('../chat'));
});

// Helper: async generator that yields SSE-like stream events
async function* makeStream(...chunks: object[]) {
  for (const chunk of chunks) yield chunk;
}

// Helper: create a minimal mock InventoryService
const mockService = {} as import('@eventgear/inventory').InventoryService;

// --- Tests ---

describe('runChat', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('emits tools_done → token → done when Claude needs no tools', async () => {
    // Phase 1: no tool use
    mockCreate.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [] });
    // Phase 2: streaming response
    mockCreate.mockResolvedValueOnce(
      makeStream(
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      ),
    );

    const emitted: StreamEvent[] = [];
    await runChat('hi', [], mockService, (e) => emitted.push(e));

    expect(emitted).toEqual([
      { type: 'tools_done' },
      { type: 'token', text: 'Hello ' },
      { type: 'token', text: 'world' },
      { type: 'done' },
    ]);
  });

  it('emits tool_start → tools_done → token → done when Claude uses a tool', async () => {
    const { executeTool } = await import('../tools');
    (executeTool as jest.Mock).mockResolvedValueOnce([{ id: 'e1', name: 'Tent' }]);

    // Phase 1, turn 1: tool use
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu1', name: 'list_equipment', input: {} }],
    });
    // Phase 1, turn 2: no more tools
    mockCreate.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [] });
    // Phase 2: streaming
    mockCreate.mockResolvedValueOnce(
      makeStream(
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Found 1 item.' } },
      ),
    );

    const emitted: StreamEvent[] = [];
    await runChat('list equipment', [], mockService, (e) => emitted.push(e));

    expect(emitted).toEqual([
      { type: 'tool_start', tool: 'list_equipment', label: 'Searching equipment…' },
      { type: 'tools_done' },
      { type: 'token', text: 'Found 1 item.' },
      { type: 'done' },
    ]);
  });

  it('emits error when maxTurns is exceeded', async () => {
    // Every call returns tool_use — runaway loop
    mockCreate.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu1', name: 'list_equipment', input: {} }],
    });

    const emitted: StreamEvent[] = [];
    await runChat('hi', [], mockService, (e) => emitted.push(e), 2);

    expect(emitted.at(-1)).toEqual({
      type: 'error',
      message: expect.stringContaining('Too many'),
    });
    // Must NOT emit tools_done or done after the error
    expect(emitted.filter((e) => e.type === 'done')).toHaveLength(0);
  });
});
