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
