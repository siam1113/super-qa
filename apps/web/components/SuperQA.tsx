'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { AgentMessage, AgentToolCall } from '@/lib/types';
import { MarkdownOutput, ToolCallDisplay } from '@/components/chat/MarkdownOutput';
import { SuperQaVoice } from '@/components/chat/SuperQaVoice';
import { AgentCall } from '@/components/chat/AgentCall';
import {
  X,
  Send,
  Loader2,
  Minimize2,
  Maximize2,
  Sparkles,
  Mic,
  PhoneCall,
} from 'lucide-react';

const API_BASE = 'http://localhost:4000';

const SUGGESTIONS = [
  { label: 'Show platform stats', prompt: 'Show me the platform statistics' },
  { label: 'List all tasks', prompt: 'List all tasks across agents' },
  { label: 'Create a task', prompt: 'Create a task for the QA Engineer to ' },
  { label: 'Start a sync', prompt: 'List all sources so I can start a sync' },
  { label: 'Search knowledge', prompt: 'Search for ' },
  { label: 'Get help', prompt: 'What can you help me with?' },
];

export function SuperQA() {
  const [isOpen, setIsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [joiningCall, setJoiningCall] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (isOpen && !voiceMode) {
      inputRef.current?.focus();
    }
  }, [isOpen, voiceMode]);

  const startNewSession = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setVoiceMode(false);
    setMessages([{
      id: 'welcome',
      role: 'assistant',
      content: "Hi! I'm **SuperQA Bot** - your all-powerful platform assistant. I can help you:\n\n- Create and manage tasks\n- Trigger agents (QAE & AUE)\n- Start sync jobs\n- Manage environments\n- Search knowledge base\n\nWhat would you like to do?",
      timestamp: new Date().toISOString(),
    }]);
  }, []);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      startNewSession();
    }
  }, [isOpen, messages.length, startNewSession]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: AgentMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/agents/superqa/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          sessionId,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setSessionId(data.sessionId);

        const assistantMessage: AgentMessage = {
          id: data.messageId || Date.now().toString(),
          role: 'assistant',
          content: data.response,
          timestamp: new Date().toISOString(),
          toolCalls: data.toolCalls,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        throw new Error('Failed to get response');
      }
    } catch (error) {
      // Fallback response
      const fallbackMessage: AgentMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: "I'm having trouble connecting to the backend. Please make sure the API server is running on port 4000.\n\nIn the meantime, you can try:\n- Checking if Docker services are running\n- Starting the API with `npm run dev -w apps/api`",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, fallbackMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleSuggestion = (prompt: string) => {
    setInput(prompt);
    inputRef.current?.focus();
  };

  // Floating button when closed
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          'fixed bottom-6 right-6 z-50',
          'w-14 h-14 rounded-full',
          'bg-gradient-to-br from-accent-purple to-accent-blue',
          'flex items-center justify-center',
          'shadow-lg shadow-accent-purple/25',
          'hover:scale-105 hover:shadow-xl hover:shadow-accent-purple/30',
          'transition-all duration-200',
          'group'
        )}
        title="Open SuperQA Bot"
      >
        <img src="/brand-icons/superqa-bot.png" alt="" className="h-7 w-7 rounded-md object-contain group-hover:scale-110 transition-transform" />
        <span className="absolute -top-1 -right-1 w-3 h-3 bg-success rounded-full border-2 border-base animate-pulse" />
      </button>
    );
  }

  const messageList = fullscreen
    ? <div className="mx-auto w-full max-w-3xl">
        {messages.map((msg) => (
          <article key={msg.id} className="border-b border-border py-4 last:border-b-0">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-mono">
              <span className={msg.role === 'user' ? 'text-success' : 'text-info'}>{msg.role === 'user' ? 'you' : 'super qa'}</span>
              <time className="text-text-secondary">{new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
            </div>
            {msg.role === 'user'
              ? <p className="whitespace-pre-wrap text-sm leading-6 text-text-primary">{msg.content}</p>
              : <div className="text-sm leading-6 text-text-primary">
                  {msg.toolCalls?.map((tc: AgentToolCall) => <ToolCallDisplay key={tc.id} toolCall={tc} />)}
                  <MarkdownOutput content={msg.content} />
                </div>}
          </article>
        ))}
      </div>
    : messages.map((msg) => (
        <div key={msg.id} className={cn('max-w-[90%]', msg.role === 'user' ? 'ml-auto' : '')}>
          <div className={cn('px-3 py-2 rounded-2xl text-sm', msg.role === 'user' ? 'bg-accent-blue text-white rounded-br-md' : 'bg-elevated rounded-bl-md')}>
            {msg.role === 'user'
              ? <p className="whitespace-pre-wrap">{msg.content}</p>
              : <div className="prose prose-sm prose-invert max-w-none">
                  {msg.toolCalls?.map((tc: AgentToolCall) => <ToolCallDisplay key={tc.id} toolCall={tc} />)}
                  <MarkdownOutput content={msg.content} />
                </div>}
          </div>
          <div className={cn('text-[10px] text-text-secondary mt-1 px-1', msg.role === 'user' ? 'text-right' : '')}>
            {new Date(msg.timestamp).toLocaleTimeString()}
          </div>
        </div>
      ));

  // Full chat window
  return (
    <div
      className={cn(
        fullscreen ? 'fixed inset-0 z-50' : 'fixed bottom-6 right-6 z-50 w-[400px] h-[550px]',
        'bg-surface border border-border rounded-2xl',
        'shadow-2xl shadow-black/20',
        'flex flex-col overflow-hidden',
        'animate-in fade-in slide-in-from-bottom-4 duration-200'
      )}
      role={fullscreen ? 'dialog' : undefined}
      aria-modal={fullscreen ? true : undefined}
      aria-label={fullscreen ? 'SuperQA Bot' : undefined}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r from-accent-purple/10 to-accent-blue/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-purple to-accent-blue flex items-center justify-center">
            <img src="/brand-icons/superqa-bot.png" alt="" className="h-4 w-4 rounded-sm object-contain" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">SuperQA Bot</h3>
            <p className="text-xs text-text-secondary">Platform Assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setJoiningCall(true)}
            className="p-1.5 hover:bg-elevated rounded-lg transition-colors"
            title="Join a Teams or Google Meet call"
          >
            <PhoneCall size={14} className="text-text-secondary" />
          </button>
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="p-1.5 hover:bg-elevated rounded-lg transition-colors"
            title={fullscreen ? 'Exit fullscreen' : 'Open fullscreen'}
          >
            {fullscreen ? <Minimize2 size={14} className="text-text-secondary" /> : <Maximize2 size={14} className="text-text-secondary" />}
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 hover:bg-elevated rounded-lg transition-colors"
            title="Close"
          >
            <X size={14} className="text-text-secondary" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className={cn('flex-1 overflow-y-auto', fullscreen ? 'px-4 py-6 md:px-8' : 'p-4 space-y-4')}>
        {messageList}
        {isLoading && (
          <div className={cn('flex items-center gap-2 text-sm text-text-secondary', fullscreen && 'mx-auto w-full max-w-3xl')}>
            <Loader2 size={14} className="animate-spin" />
            <span>Thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && !voiceMode && (
        <div className="px-4 pb-2">
          <div className={cn('flex flex-wrap gap-1.5', fullscreen && 'mx-auto w-full max-w-3xl')}>
            {SUGGESTIONS.slice(0, fullscreen ? SUGGESTIONS.length : 4).map((s) => (
              <button
                key={s.label}
                onClick={() => handleSuggestion(s.prompt)}
                className="flex items-center gap-1 px-2 py-1 bg-elevated hover:bg-border rounded-lg text-xs transition-colors"
              >
                <Sparkles size={10} className="text-accent-purple" />
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input / voice */}
      {voiceMode ? (
        <SuperQaVoice onExit={() => setVoiceMode(false)} />
      ) : (
        <div className="p-3 border-t border-border">
          <div className={cn('flex items-center gap-2 p-2 bg-elevated rounded-xl', fullscreen && 'mx-auto w-full max-w-3xl')}>
            <button
              onClick={() => setVoiceMode(true)}
              title="Switch to voice"
              className="p-2 rounded-lg text-text-secondary transition-colors hover:bg-border"
            >
              <Mic size={14} />
            </button>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask SuperQA Bot anything..."
              className="flex-1 bg-transparent outline-none text-sm"
              disabled={isLoading}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
              className={cn(
                'p-2 rounded-lg transition-colors',
                input.trim() && !isLoading
                  ? 'bg-accent-purple text-white hover:bg-accent-purple/90'
                  : 'bg-border text-text-secondary'
              )}
            >
              {isLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
            </button>
          </div>
        </div>
      )}
      {joiningCall && <AgentCall kind="superqa" onClose={() => setJoiningCall(false)} />}
    </div>
  );
}
