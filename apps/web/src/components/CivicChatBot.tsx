import React, { useEffect, useRef, useState } from 'react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

const QUICK_STARTERS = [
  'Where do batteries go?',
  'How to dispose of medicine strips?',
  'Can I compost cooked food & citrus?',
  'What are the 2026 sanitary waste rules?',
];

const INITIAL_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    'Namaste! I am your ZeroWasteIN Civic Eco-Assistant, powered by Google Gemma models on Jarvis Labs. Ask me anything about India\'s 4-stream waste segregation, recycling guidelines, or household carbon footprint.',
  timestamp: Date.now(),
};

/**
 * Interactive Civic ChatBot Window powered by Google Gemma on Jarvis Labs.
 *
 * Provides instant conversational guidance on Solid Waste Management Rules 2026,
 * recycling streams, and household environmental footprints.
 */
export function CivicChatBot(): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-scroll to bottom of message list on new messages
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, isLoading]);

  // Focus input when opening chat
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend ?? inputValue).trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsLoading(true);
    setErrorMessage(null);

    try {
      // Build conversation history excluding welcome message
      const history = messages
        .filter((m) => m.id !== 'welcome')
        .map((m) => ({ role: m.role, content: m.content }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: text,
          history,
        }),
      });

      if (!response.ok) {
        const errJson = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(errJson?.error?.message || `Server responded with status ${response.status}`);
      }

      const data = (await response.json()) as { reply?: string };
      const assistantReply =
        data.reply?.trim() ||
        'Under SWM Rules 2026, ensure items are clean, dry, and deposited in the appropriate municipal bin.';

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + 1),
        role: 'assistant',
        content: assistantReply,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error('Chat error:', err);
      setErrorMessage(
        'Could not reach the Gemma assistant right now. Please try again or search by keyword.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearHistory = () => {
    setMessages([INITIAL_MESSAGE]);
    setErrorMessage(null);
    inputRef.current?.focus();
  };

  return (
    <aside
      aria-label="Civic AI Chatbot Assistant"
      className="fixed bottom-24 md:bottom-10 right-4 sm:right-6 z-50 select-none"
    >
      {/* Floating Launcher Button */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="group flex items-center gap-2.5 px-4 py-3 rounded-full bg-primary text-on-primary shadow-xl hover:bg-primary-container focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary/40 transition-all duration-200 hover:scale-105"
          aria-expanded={false}
          aria-controls="civic-chat-window"
          aria-label="Open ZeroWasteIN Civic Chatbot Assistant"
        >
          <div className="relative flex items-center justify-center">
            <span className="material-symbols-outlined text-[24px]">smart_toy</span>
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-secondary-container rounded-full border-2 border-primary animate-pulse" />
          </div>
          <div className="flex flex-col text-left pr-0.5">
            <span className="font-label-md text-label-md font-bold tracking-tight leading-none text-white">
              Ask Gemma AI
            </span>
            <span className="text-[10px] text-primary-fixed uppercase tracking-wider font-semibold opacity-90 leading-none mt-0.5">
              SWM 2026 Guide
            </span>
          </div>
        </button>
      )}

      {/* Expanded Chat Window */}
      {isOpen && (
        <div
          id="civic-chat-window"
          role="dialog"
          aria-modal="false"
          aria-labelledby="chat-window-title"
          className="w-[92vw] sm:w-[380px] h-[520px] max-h-[75vh] bg-surface-container-lowest rounded-3xl shadow-2xl border border-hairline/80 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200"
        >
          {/* Header */}
          <div className="bg-primary text-on-primary px-4 py-3.5 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-primary-container flex items-center justify-center text-primary-fixed">
                <span className="material-symbols-outlined text-[20px]">smart_toy</span>
              </div>
              <div className="flex flex-col">
                <h3 id="chat-window-title" className="font-headline-sm text-[15px] font-bold tracking-tight leading-none text-white">
                  ZeroWasteIN Assistant
                </h3>
                <span className="text-[11px] text-primary-fixed font-medium mt-0.5 leading-none">
                  Google Gemma • Jarvis Labs
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleClearHistory}
                title="Clear conversation"
                aria-label="Clear conversation history"
                className="w-8 h-8 rounded-lg text-primary-fixed hover:bg-primary-container flex items-center justify-center transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">delete_sweep</span>
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                title="Close chat"
                aria-label="Close chatbot window"
                className="w-8 h-8 rounded-lg text-primary-fixed hover:bg-primary-container flex items-center justify-center transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
          </div>

          {/* Conversation Messages */}
          <div
            className="flex-1 p-3.5 overflow-y-auto space-y-3 bg-surface/50"
            role="log"
            aria-live="polite"
            aria-atomic="false"
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`px-3.5 py-2.5 rounded-2xl text-[13.5px] leading-relaxed max-w-[88%] select-text ${
                    msg.role === 'user'
                      ? 'bg-primary text-on-primary rounded-tr-xs shadow-xs'
                      : 'bg-surface-container-low text-on-surface rounded-tl-xs border border-hairline/70 shadow-xs'
                  }`}
                >
                  {msg.content}
                </div>
                <span className="text-[10px] text-outline mt-1 px-1">
                  {new Date(msg.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            ))}

            {/* Quick Starters (shown if only welcome message exists) */}
            {messages.length === 1 && (
              <div className="pt-2 flex flex-col gap-1.5">
                <span className="font-label-statutory text-[10.5px] uppercase font-bold text-on-surface-variant px-1 tracking-wider">
                  Suggested queries:
                </span>
                <div className="flex flex-col gap-1">
                  {QUICK_STARTERS.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      onClick={() => handleSendMessage(starter)}
                      className="text-left px-3 py-2 rounded-xl bg-surface-container-lowest hover:bg-secondary-container/30 border border-hairline text-on-surface text-[12.5px] font-medium transition-colors flex items-center justify-between group"
                    >
                      <span>{starter}</span>
                      <span className="material-symbols-outlined text-[16px] text-outline group-hover:text-secondary group-hover:translate-x-0.5 transition-all">
                        arrow_forward
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Loading Indicator */}
            {isLoading && (
              <div className="flex items-center gap-1.5 p-3 rounded-2xl rounded-tl-xs bg-surface-container-low border border-hairline/60 w-24">
                <span className="w-2 h-2 rounded-full bg-secondary animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-secondary animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-secondary animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            )}

            {/* Error Message */}
            {errorMessage && (
              <div className="p-2.5 rounded-xl bg-error-container/40 border border-error text-error text-[12px] flex items-center justify-between gap-2">
                <span>{errorMessage}</span>
                <button
                  type="button"
                  className="font-bold underline uppercase text-[11px] shrink-0"
                  onClick={() => handleSendMessage()}
                >
                  Retry
                </button>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Footer Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="p-2.5 bg-surface-container-lowest border-t border-hairline/70 flex flex-col gap-1"
          >
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ask about bins, recycling, carbon..."
                aria-label="Ask Gemma AI question"
                disabled={isLoading}
                maxLength={500}
                className="flex-1 px-3 py-2 text-[13.5px] rounded-xl bg-surface-container-low border border-hairline focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary transition-all disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading}
                aria-label="Send message"
                className="w-9 h-9 rounded-xl bg-primary text-on-primary flex items-center justify-center hover:bg-primary-container disabled:opacity-40 disabled:hover:bg-primary transition-all shadow-xs"
              >
                <span className="material-symbols-outlined text-[18px]">send</span>
              </button>
            </div>
            <div className="flex items-center justify-center gap-1 text-[10px] text-outline font-medium">
              <span>SWM Rules 2026</span>
              <span>•</span>
              <span>Google Gemma via Jarvis Labs</span>
            </div>
          </form>
        </div>
      )}
    </aside>
  );
}
