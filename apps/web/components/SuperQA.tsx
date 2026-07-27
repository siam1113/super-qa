'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  X,
  Send,
  Zap,
  Loader2,
  Minimize2,
  Maximize2,
  RotateCcw,
  Wrench,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle,
  Sparkles,
} from 'lucide-react';

const API_BASE = 'http://localhost:4000';

type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  toolCalls?: ToolCall[];
};

type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
};

const SUGGESTIONS = [
  { label: 'Show platform stats', prompt: 'Show me the platform statistics' },
  { label: 'List all tasks', prompt: 'List all tasks across agents' },
  { label: 'Create a task', prompt: 'Create a task for the QA Engineer to ' },
  { label: 'Start a sync', prompt: 'List all sources so I can start a sync' },
  { label: 'Search knowledge', prompt: 'Search for ' },
  { label: 'Get help', prompt: 'What can you help me with?' },
];

function ToolCallBubble({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    pending: <Loader2 size={10} className="animate-spin text-text-secondary" />,
    running: <Loader2 size={10} className="animate-spin text-info" />,
    completed: <CheckCircle size={10} className="text-success" />,
    error: <XCircle size={10} className="text-danger" />,
  };

  return (
    <div className="mt-2 border border-border/50 rounded-lg overflow-hidden text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 bg-elevated/50 hover:bg-elevated transition-colors"
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <Wrench size={10} className="text-warning" />
        <span className="font-medium truncate">{toolCall.name}</span>
        <span className="flex-1" />
        {statusIcon[toolCall.status]}
      </button>
      {expanded && (
        <div className="px-2 py-1.5 bg-base/50 border-t border-border/50 space-y-1">
          {Object.keys(toolCall.arguments).length > 0 && (
            <div>
              <span className="text-text-secondary">Args: </span>
              <code className="text-[10px]">{JSON.stringify(toolCall.arguments)}</code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SuperQA() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
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
    if (isOpen && !isMinimized) {
      inputRef.current?.focus();
    }
  }, [isOpen, isMinimized]);

  const startNewSession = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setMessages([{
      id: 'welcome',
      role: 'assistant',
      content: "Hi! I'm **Super QA** - your all-powerful platform assistant. I can help you:\n\n- Create and manage tasks\n- Trigger agents (QAE & AUE)\n- Start sync jobs\n- Manage environments\n- Search knowledge base\n\nWhat would you like to do?",
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

    const userMessage: Message = {
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

        const assistantMessage: Message = {
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
      const fallbackMessage: Message = {
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
        title="Open Super QA"
      >
        <Zap size={24} className="text-white group-hover:scale-110 transition-transform" />
        <span className="absolute -top-1 -right-1 w-3 h-3 bg-success rounded-full border-2 border-base animate-pulse" />
      </button>
    );
  }

  // Minimized state
  if (isMinimized) {
    return (
      <button
        onClick={() => setIsMinimized(false)}
        className={cn(
          'fixed bottom-6 right-6 z-50',
          'flex items-center gap-2 px-4 py-2',
          'bg-surface border border-border rounded-full',
          'shadow-lg hover:shadow-xl',
          'transition-all duration-200'
        )}
      >
        <Zap size={16} className="text-accent-purple" />
        <span className="text-sm font-medium">Super QA</span>
        <Maximize2 size={14} className="text-text-secondary" />
      </button>
    );
  }

  // Full chat window
  return (
    <div
      className={cn(
        'fixed bottom-6 right-6 z-50',
        'w-[400px] h-[550px]',
        'bg-surface border border-border rounded-2xl',
        'shadow-2xl shadow-black/20',
        'flex flex-col overflow-hidden',
        'animate-in fade-in slide-in-from-bottom-4 duration-200'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r from-accent-purple/10 to-accent-blue/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-purple to-accent-blue flex items-center justify-center">
            <Zap size={16} className="text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Super QA</h3>
            <p className="text-xs text-text-secondary">Platform Assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={startNewSession}
            className="p-1.5 hover:bg-elevated rounded-lg transition-colors"
            title="New conversation"
          >
            <RotateCcw size={14} className="text-text-secondary" />
          </button>
          <button
            onClick={() => setIsMinimized(true)}
            className="p-1.5 hover:bg-elevated rounded-lg transition-colors"
            title="Minimize"
          >
            <Minimize2 size={14} className="text-text-secondary" />
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
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              'max-w-[90%]',
              msg.role === 'user' ? 'ml-auto' : ''
            )}
          >
            <div
              className={cn(
                'px-3 py-2 rounded-2xl text-sm',
                msg.role === 'user'
                  ? 'bg-accent-blue text-white rounded-br-md'
                  : 'bg-elevated rounded-bl-md'
              )}
            >
              <div className="whitespace-pre-wrap prose prose-sm prose-invert max-w-none">
                {msg.content.split('\n').map((line, i) => {
                  // Simple markdown-like parsing
                  const boldParsed = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                  return (
                    <p
                      key={i}
                      className={cn('my-0.5', line.startsWith('-') && 'ml-2')}
                      dangerouslySetInnerHTML={{ __html: boldParsed }}
                    />
                  );
                })}
              </div>
              {msg.toolCalls?.map((tc) => (
                <ToolCallBubble key={tc.id} toolCall={tc} />
              ))}
            </div>
            <div className={cn(
              'text-[10px] text-text-secondary mt-1 px-1',
              msg.role === 'user' ? 'text-right' : ''
            )}>
              {new Date(msg.timestamp).toLocaleTimeString()}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 size={14} className="animate-spin" />
            <span>Thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && (
        <div className="px-4 pb-2">
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.slice(0, 4).map((s) => (
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

      {/* Input */}
      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2 p-2 bg-elevated rounded-xl">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Super QA anything..."
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
    </div>
  );
}
