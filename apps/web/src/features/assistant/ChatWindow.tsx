/**
 * @file ChatWindow.tsx
 * @purpose Scrollable message list + streaming bubble + tool pill + input form
 *
 * @ai-notes State model:
 *   isStreaming   — true while the SSE stream is open; gates input + submit
 *   streamingContent — in-progress assistant message; committed to messages on 'done'
 *   activeTool    — label of the currently executing tool (rolling, not cumulative);
 *                   set on 'tool_start', cleared on 'tools_done'
 *   error         — shown inline below messages on 'error' event
 */
import { useState, useRef, useEffect } from 'react';
import { streamMessage } from './api';
import type { Message } from './types';

interface ChatWindowProps {
  onClose: () => void;
}

export default function ChatWindow({ onClose }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        "Hi! I'm the EventGear assistant. Ask me anything about your inventory — I can look things up, create records, schedule maintenance, and more.",
    },
  ]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [activeTool, setActiveTool] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll tracks both committed messages and the live streaming bubble
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMessage: Message = { role: 'user', content: text };
    const next = [...messages, userMessage];
    setMessages(next);
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');
    setActiveTool(undefined);
    setError(undefined);

    let accumulated = '';

    try {
      for await (const event of streamMessage(text, messages)) {
        switch (event.type) {
          case 'tool_start':
            setActiveTool(event.label);
            break;
          case 'tools_done':
            setActiveTool(undefined);
            break;
          case 'token':
            accumulated += event.text;
            setStreamingContent(accumulated);
            break;
          case 'done':
            setMessages([...next, { role: 'assistant', content: accumulated }]);
            setStreamingContent('');
            break;
          case 'error':
            setError(event.message);
            setActiveTool(undefined);
            setStreamingContent('');
            break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setActiveTool(undefined);
      setStreamingContent('');
    } finally {
      setIsStreaming(false);
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

        {/* Active tool pill — shows current tool, replaced on each tool_start */}
        {activeTool !== undefined && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 bg-gray-100 rounded-full px-3 py-1.5 text-xs text-gray-500">
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              {activeTool}
            </div>
          </div>
        )}

        {/* Live streaming bubble — token-by-token */}
        {streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-3 py-2 text-sm whitespace-pre-wrap bg-gray-100 text-gray-800">
              {streamingContent}
              <span className="inline-block w-0.5 h-3.5 bg-gray-400 ml-0.5 animate-pulse" />
            </div>
          </div>
        )}

        {/* Error bubble */}
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
            disabled={isStreaming}
            className="flex-1 border border-gray-300 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isStreaming || input.trim() === ''}
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
