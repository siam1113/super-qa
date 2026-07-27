'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { X, Send, Sparkles, Lightbulb } from 'lucide-react';

const suggestions = [
  'What failed yesterday?',
  'Generate checkout tests',
  'Find flaky tests',
  'Explain this failure',
  'Improve coverage',
];

export function AICopilot() {
  const { copilotOpen, setCopilotOpen } = useAppStore();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);

  if (!copilotOpen) return null;

  const handleSend = () => {
    if (!message.trim()) return;

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: message },
      {
        role: 'assistant',
        content: `I understand you're asking about "${message}". As an AI assistant, I can help you analyze test results, generate test cases, identify flaky tests, and provide coverage recommendations. What specific aspect would you like me to focus on?`,
      },
    ]);
    setMessage('');
  };

  const handleSuggestion = (suggestion: string) => {
    setMessage(suggestion);
  };

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        onClick={() => setCopilotOpen(false)}
      />

      {/* Panel */}
      <div className="absolute top-14 right-4 w-[420px] h-[600px] max-h-[calc(100vh-80px)] bg-surface border border-border rounded-xl shadow-2xl overflow-hidden animate-slide-in flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-accent-purple/5">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-accent-purple" />
            <h3 className="font-medium">AI Copilot</h3>
          </div>
          <button
            onClick={() => setCopilotOpen(false)}
            className="p-1 hover:bg-elevated rounded transition-colors"
          >
            <X size={16} className="text-text-secondary" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-full bg-accent-purple/10 flex items-center justify-center mb-4">
                <Sparkles size={24} className="text-accent-purple" />
              </div>
              <h4 className="font-medium mb-2">How can I help?</h4>
              <p className="text-sm text-text-secondary mb-4">
                Ask me about test results, coverage, or let me generate tests for you.
              </p>
              <div className="flex flex-col gap-2 w-full max-w-xs">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => handleSuggestion(suggestion)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left',
                      'bg-elevated hover:bg-border transition-colors'
                    )}
                  >
                    <Lightbulb size={14} className="text-accent-purple" />
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  'max-w-[85%] p-3 rounded-lg text-sm',
                  msg.role === 'user'
                    ? 'ml-auto bg-accent-blue text-white'
                    : 'bg-elevated text-text-primary'
                )}
              >
                {msg.content}
              </div>
            ))
          )}
        </div>

        {/* Input */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-2 p-2 bg-elevated rounded-lg">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask anything..."
              className="flex-1 bg-transparent outline-none text-sm text-text-primary placeholder:text-text-secondary"
            />
            <button
              onClick={handleSend}
              disabled={!message.trim()}
              className={cn(
                'p-2 rounded-lg transition-colors',
                message.trim()
                  ? 'bg-accent-purple text-white hover:bg-accent-purple/90'
                  : 'bg-border text-text-secondary'
              )}
            >
              <Send size={16} />
            </button>
          </div>
          <p className="text-xs text-text-secondary mt-2 text-center">
            Press Enter to send
          </p>
        </div>
      </div>
    </div>
  );
}
