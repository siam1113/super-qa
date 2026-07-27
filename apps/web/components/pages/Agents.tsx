'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { AgentType, AgentMessage, AgentSession, AgentToolCall, AgentTask } from '@/lib/types';
import {
  Send,
  Square,
  RotateCcw,
  Settings,
  Loader2,
  Bot,
  User,
  Wrench,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Search,
  Code,
  FileText,
  TestTube,
  Bug,
  Sparkles,
  Copy,
  Check,
  MessageSquare,
  ListTodo,
  Info,
  X,
  Zap,
  PlayCircle,
  FileBarChart,
  BookOpen,
  Wand2,
} from 'lucide-react';
import { TaskBoard } from '@/components/TaskBoard';
import { TaskModal } from '@/components/TaskModal';

const API_BASE = 'http://localhost:4000';

// Agent configurations
const AGENT_CONFIGS: Record<AgentType, {
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  placeholder: string;
  capabilities: Array<{ label: string; icon: React.ReactNode; description: string }>;
}> = {
  qae: {
    name: 'QA Engineer',
    shortName: 'QAE',
    tagline: 'Your intelligent QA companion',
    description: 'Comprehensive test planning, execution, and analysis powered by AI',
    icon: <TestTube size={20} />,
    color: 'text-accent-blue',
    bgColor: 'bg-accent-blue',
    placeholder: 'Ask me to write test cases, analyze bugs, or review user stories...',
    capabilities: [
      { label: 'Write Test Cases', icon: <FileText size={16} />, description: 'Generate comprehensive test cases from requirements and user stories' },
      { label: 'Execute Test Cases', icon: <PlayCircle size={16} />, description: 'Run individual test cases and record results' },
      { label: 'Execute Test Suite', icon: <Zap size={16} />, description: 'Run complete test suites with progress tracking' },
      { label: 'Generate Reports', icon: <FileBarChart size={16} />, description: 'Create detailed test execution and coverage reports' },
      { label: 'Bug Analysis', icon: <Bug size={16} />, description: 'Analyze bugs, identify root causes, and suggest fixes' },
      { label: 'Test User Stories', icon: <BookOpen size={16} />, description: 'Review and test user stories and tickets' },
    ],
  },
  aue: {
    name: 'Automation Engineer',
    shortName: 'AUE',
    tagline: 'Your automation expert',
    description: 'Script generation, test execution, and self-healing capabilities powered by AI',
    icon: <Bot size={20} />,
    color: 'text-accent-purple',
    bgColor: 'bg-accent-purple',
    placeholder: 'Ask me to generate scripts, run automation tests, or heal failing locators...',
    capabilities: [
      { label: 'Generate Test Scripts', icon: <Code size={16} />, description: 'Create automation scripts in Playwright, Cypress, or Selenium' },
      { label: 'Run Automation Tests', icon: <PlayCircle size={16} />, description: 'Execute automated test suites with real-time monitoring' },
      { label: 'Report Analysis', icon: <FileBarChart size={16} />, description: 'Analyze test results and identify failure patterns' },
      { label: 'Healer', icon: <Wand2 size={16} />, description: 'Auto-heal broken locators and fix flaky tests' },
    ],
  },
  superqa: {
    name: 'Super QA',
    shortName: 'SQA',
    tagline: 'Your all-powerful platform assistant',
    description: 'Manage tasks, trigger agents, sync sources, and control environments',
    icon: <Sparkles size={20} />,
    color: 'text-warning',
    bgColor: 'bg-warning',
    placeholder: 'Ask me anything - I can control the entire platform...',
    capabilities: [
      { label: 'Manage Tasks', icon: <ListTodo size={16} />, description: 'Create and manage tasks for QAE and AUE agents' },
      { label: 'Trigger Agents', icon: <Zap size={16} />, description: 'Start QAE or AUE agents for specific tasks' },
      { label: 'Sync Sources', icon: <RotateCcw size={16} />, description: 'Start and monitor source sync jobs' },
      { label: 'Manage Environments', icon: <Settings size={16} />, description: 'Configure environments and variables' },
      { label: 'Search Knowledge', icon: <Search size={16} />, description: 'Search the business knowledge base' },
      { label: 'Platform Stats', icon: <FileBarChart size={16} />, description: 'View platform statistics and metrics' },
    ],
  },
};

function ToolCallDisplay({ toolCall }: { toolCall: AgentToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    pending: <Loader2 size={12} className="animate-spin text-text-secondary" />,
    running: <Loader2 size={12} className="animate-spin text-info" />,
    completed: <CheckCircle size={12} className="text-success" />,
    error: <XCircle size={12} className="text-danger" />,
  };

  return (
    <div className="my-2 border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-elevated hover:bg-border transition-colors text-sm"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Wrench size={14} className="text-warning" />
        <span className="font-medium">{toolCall.name}</span>
        <span className="flex-1" />
        {statusIcon[toolCall.status]}
      </button>
      {expanded && (
        <div className="px-3 py-2 bg-surface border-t border-border">
          <div className="mb-2">
            <p className="text-xs text-text-secondary mb-1">Arguments:</p>
            <pre className="text-xs bg-elevated p-2 rounded overflow-x-auto">
              {JSON.stringify(toolCall.arguments, null, 2)}
            </pre>
          </div>
          {toolCall.result && (
            <div>
              <p className="text-xs text-text-secondary mb-1">Result:</p>
              <pre className="text-xs bg-elevated p-2 rounded overflow-x-auto max-h-32">
                {toolCall.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: AgentMessage }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isSystem) {
    return (
      <div className="flex justify-center my-4">
        <div className="px-3 py-1.5 bg-elevated rounded-full text-xs text-text-secondary">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex gap-3 mb-4', isUser ? 'flex-row-reverse' : '')}>
      <div className={cn(
        'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
        isUser ? 'bg-accent-blue/10' : 'bg-accent-purple/10'
      )}>
        {isUser ? (
          <User size={16} className="text-accent-blue" />
        ) : (
          <Bot size={16} className="text-accent-purple" />
        )}
      </div>
      <div className={cn('flex-1 max-w-[80%]', isUser ? 'text-right' : '')}>
        <div className={cn(
          'inline-block px-4 py-3 rounded-2xl text-sm',
          isUser ? 'bg-accent-blue text-white rounded-br-md' : 'bg-elevated rounded-bl-md'
        )}>
          <div className="whitespace-pre-wrap">{message.content}</div>
          {message.toolCalls?.map((tc) => (
            <ToolCallDisplay key={tc.id} toolCall={tc} />
          ))}
        </div>
        <div className={cn('flex items-center gap-2 mt-1', isUser ? 'justify-end' : '')}>
          <span className="text-xs text-text-secondary">
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
          {!isUser && (
            <button
              onClick={handleCopy}
              className="p-1 hover:bg-elevated rounded transition-colors"
              title="Copy message"
            >
              {copied ? (
                <Check size={12} className="text-success" />
              ) : (
                <Copy size={12} className="text-text-secondary" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickAction({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 bg-elevated hover:bg-border rounded-lg transition-colors text-sm"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function CapabilitiesModal({
  isOpen,
  onClose,
  config
}: {
  isOpen: boolean;
  onClose: () => void;
  config: typeof AGENT_CONFIGS[AgentType];
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className={cn('px-6 py-4 border-b border-border', `${config.bgColor}/10`)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', config.bgColor)}>
                <span className="text-white">{config.icon}</span>
              </div>
              <div>
                <h2 className="font-semibold text-lg">{config.name}</h2>
                <p className={cn('text-xs font-medium', config.color)}>{config.tagline}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-elevated rounded-lg transition-colors"
            >
              <X size={18} className="text-text-secondary" />
            </button>
          </div>
        </div>

        {/* Description */}
        <div className="px-6 py-4 border-b border-border">
          <p className="text-sm text-text-secondary">{config.description}</p>
        </div>

        {/* Capabilities */}
        <div className="px-6 py-4">
          <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-3">Capabilities</h3>
          <div className="space-y-2">
            {config.capabilities.map((cap, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-elevated rounded-lg">
                <div className={cn('p-1.5 rounded-lg', `${config.bgColor}/10`, config.color)}>
                  {cap.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{cap.label}</p>
                  <p className="text-xs text-text-secondary mt-0.5">{cap.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-elevated/50">
          <button
            onClick={onClose}
            className={cn(
              'w-full py-2.5 rounded-lg font-medium text-sm transition-colors',
              config.bgColor, 'text-white hover:opacity-90'
            )}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsModal({
  isOpen,
  onClose,
  config,
}: {
  isOpen: boolean;
  onClose: () => void;
  config: typeof AGENT_CONFIGS[AgentType];
}) {
  const [model, setModel] = useState('gpt-4');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Settings size={20} className="text-text-secondary" />
              <h2 className="font-semibold text-lg">{config.shortName} Settings</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-elevated rounded-lg transition-colors"
            >
              <X size={18} className="text-text-secondary" />
            </button>
          </div>
        </div>

        {/* Settings */}
        <div className="px-6 py-4 space-y-4">
          {/* Model Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
            >
              <option value="gpt-4">GPT-4</option>
              <option value="gpt-4-turbo">GPT-4 Turbo</option>
              <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
              <option value="claude-3-opus">Claude 3 Opus</option>
              <option value="claude-3-sonnet">Claude 3 Sonnet</option>
            </select>
          </div>

          {/* Temperature */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Temperature: {temperature}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-text-secondary mt-1">
              <span>Precise</span>
              <span>Creative</span>
            </div>
          </div>

          {/* Max Tokens */}
          <div>
            <label className="block text-sm font-medium mb-2">Max Tokens</label>
            <input
              type="number"
              value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value))}
              min={256}
              max={8192}
              step={256}
              className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-elevated/50 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg font-medium text-sm border border-border hover:bg-elevated transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onClose}
            className={cn(
              'flex-1 py-2.5 rounded-lg font-medium text-sm transition-colors',
              config.bgColor, 'text-white hover:opacity-90'
            )}
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

type TabType = 'tasks' | 'chat';

export function AgentPage({ agentType }: { agentType: AgentType }) {
  const config = AGENT_CONFIGS[agentType];
  const [activeTab, setActiveTab] = useState<TabType>('tasks');
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<AgentTask | null>(null);
  const [isCapabilitiesOpen, setIsCapabilitiesOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/agents/${agentType}/tasks`);
      if (response.ok) {
        const data = await response.json();
        setTasks(data);
      }
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    }
  }, [agentType]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const startNewSession = useCallback(async () => {
    setMessages([]);
    setSessionId(null);
    // Add welcome message
    setMessages([{
      id: 'welcome',
      role: 'assistant',
      content: `Hello! I'm the **${config.name}** — ${config.tagline.toLowerCase()}.\n\nHow can I help you today?`,
      timestamp: new Date().toISOString(),
    }]);
  }, [config]);

  useEffect(() => {
    startNewSession();
  }, [startNewSession]);

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
      const response = await fetch(`${API_BASE}/api/agents/${agentType}/chat`, {
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
      // Fallback response for demo
      const fallbackResponses: Record<AgentType, string[]> = {
        qae: [
          "I'll analyze this from a QA perspective. Let me consider the test scenarios...",
          "Based on my analysis, here are the key test cases I'd recommend:\n\n1. **Happy Path**: Verify the main flow works as expected\n2. **Edge Cases**: Test boundary conditions\n3. **Error Handling**: Verify proper error messages\n4. **Performance**: Check response times under load",
          "I've identified several potential risks in this feature. Would you like me to elaborate on any specific area?",
        ],
        aue: [
          "I'll help you automate this. Let me generate the test script...",
          "Here's a robust locator strategy for this element:\n\n```javascript\n// Primary: data-testid (most stable)\nawait page.getByTestId('submit-button');\n\n// Fallback: role-based\nawait page.getByRole('button', { name: 'Submit' });\n```",
          "I've analyzed the failing test. The issue appears to be a timing problem. Here's my suggested fix...",
        ],
        superqa: [
          "I'm Super QA - I can help you with anything on this platform. What would you like me to do?",
          "I've completed the task. Is there anything else you'd like me to help with?",
          "Let me check the platform status and get back to you with the details...",
        ],
      };
      
      const responses = fallbackResponses[agentType];
      const randomResponse = responses[Math.floor(Math.random() * responses.length)];
      
      const assistantMessage: AgentMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: randomResponse,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
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

  const handleQuickAction = (prompt: string) => {
    setInput(prompt);
    inputRef.current?.focus();
  };

  const quickActions: Record<AgentType, Array<{ label: string; prompt: string; icon: React.ReactNode }>> = {
    qae: [
      { label: 'Design test cases', prompt: 'Design test cases for ', icon: <TestTube size={14} /> },
      { label: 'Find edge cases', prompt: 'What are the edge cases for ', icon: <Search size={14} /> },
      { label: 'Analyze bug', prompt: 'Analyze this bug: ', icon: <Bug size={14} /> },
      { label: 'Review quality', prompt: 'Review the quality of ', icon: <Sparkles size={14} /> },
    ],
    aue: [
      { label: 'Generate script', prompt: 'Generate a test script for ', icon: <Code size={14} /> },
      { label: 'Fix locator', prompt: 'Create a robust locator for ', icon: <Search size={14} /> },
      { label: 'Debug test', prompt: 'Help me debug this failing test: ', icon: <Bug size={14} /> },
      { label: 'Setup framework', prompt: 'How do I set up ', icon: <FileText size={14} /> },
    ],
    superqa: [
      { label: 'Create task', prompt: 'Create a task for ', icon: <FileText size={14} /> },
      { label: 'Start sync', prompt: 'Start a sync job for ', icon: <Sparkles size={14} /> },
      { label: 'Platform stats', prompt: 'Show me the platform statistics', icon: <Search size={14} /> },
      { label: 'Get help', prompt: 'What can you help me with?', icon: <Bug size={14} /> },
    ],
  };

  const handleTaskClick = (task: AgentTask) => {
    setSelectedTask(task);
    setIsTaskModalOpen(true);
  };

  const handleAddTask = () => {
    setSelectedTask(null);
    setIsTaskModalOpen(true);
  };

  const handleTaskModalClose = () => {
    setIsTaskModalOpen(false);
    setSelectedTask(null);
  };

  const handleTaskSave = () => {
    fetchTasks();
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-white', config.bgColor)}>
            {config.icon}
          </div>
          <div>
            <h1 className="font-semibold text-lg">{config.name}</h1>
            <p className={cn('text-xs', config.color)}>{config.tagline}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {activeTab === 'chat' && (
            <button
              onClick={startNewSession}
              className="p-2 hover:bg-elevated rounded-lg transition-colors"
              title="New conversation"
            >
              <RotateCcw size={18} className="text-text-secondary" />
            </button>
          )}
          <button
            onClick={() => setIsCapabilitiesOpen(true)}
            className="p-2 hover:bg-elevated rounded-lg transition-colors"
            title="Capabilities"
          >
            <Info size={18} className="text-text-secondary" />
          </button>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 hover:bg-elevated rounded-lg transition-colors"
            title="Settings"
          >
            <Settings size={18} className="text-text-secondary" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-surface">
        <button
          onClick={() => setActiveTab('tasks')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            activeTab === 'tasks'
              ? 'bg-accent-blue/10 text-accent-blue'
              : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
          )}
        >
          <ListTodo size={16} />
          Tasks
          {tasks.length > 0 && (
            <span className={cn(
              'px-1.5 py-0.5 rounded-full text-xs',
              activeTab === 'tasks' ? 'bg-accent-blue/20' : 'bg-elevated'
            )}>
              {tasks.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('chat')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            activeTab === 'chat'
              ? 'bg-accent-blue/10 text-accent-blue'
              : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
          )}
        >
          <MessageSquare size={16} />
          Chat
        </button>
      </div>

      {/* Content */}
      {activeTab === 'tasks' ? (
        <TaskBoard
          agentType={agentType}
          tasks={tasks}
          onTasksChange={fetchTasks}
          onAddTask={handleAddTask}
          onTaskClick={handleTaskClick}
        />
      ) : (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className={cn('w-16 h-16 rounded-2xl flex items-center justify-center text-white mb-4', config.bgColor)}>
                  {config.icon}
                </div>
                <h2 className="text-xl font-semibold mb-1">{config.name}</h2>
                <p className={cn('text-sm font-medium mb-2', config.color)}>{config.tagline}</p>
                <p className="text-text-secondary mb-6 max-w-md text-sm">{config.description}</p>
                <div className="grid grid-cols-2 gap-2 max-w-lg">
                  {config.capabilities.map((cap, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 bg-elevated rounded-lg text-sm text-left">
                      <div className={cn('p-1.5 rounded-lg', `${config.bgColor}/10`, config.color)}>
                        {cap.icon}
                      </div>
                      <span className="text-text-primary">{cap.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                {isLoading && (
                  <div className="flex gap-3 mb-4">
                    <div className="w-8 h-8 rounded-full bg-accent-purple/10 flex items-center justify-center">
                      <Bot size={16} className="text-accent-purple" />
                    </div>
                    <div className="flex items-center gap-2 px-4 py-3 bg-elevated rounded-2xl rounded-bl-md">
                      <Loader2 size={16} className="animate-spin text-text-secondary" />
                      <span className="text-sm text-text-secondary">Thinking...</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Quick Actions */}
          {messages.length <= 1 && (
            <div className="px-4 pb-2">
              <p className="text-xs text-text-secondary mb-2">Quick actions:</p>
              <div className="flex flex-wrap gap-2">
                {quickActions[agentType].map((action, i) => (
                  <QuickAction
                    key={i}
                    label={action.label}
                    icon={action.icon}
                    onClick={() => handleQuickAction(action.prompt)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-4 border-t border-border">
            <div className="flex items-end gap-2">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={config.placeholder}
                  rows={1}
                  className="w-full px-4 py-3 bg-elevated border border-border rounded-xl text-sm resize-none outline-none focus:border-accent-blue transition-colors"
                  style={{ minHeight: '48px', maxHeight: '120px' }}
                />
              </div>
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className={cn(
                  'p-3 rounded-xl transition-colors',
                  input.trim() && !isLoading
                    ? 'bg-accent-blue text-white hover:bg-accent-blue/90'
                    : 'bg-elevated text-text-secondary cursor-not-allowed'
                )}
              >
                {isLoading ? (
                  <Square size={18} />
                ) : (
                  <Send size={18} />
                )}
              </button>
            </div>
            <p className="text-xs text-text-secondary mt-2 text-center">
              {config.shortName} uses LangGraph for orchestration. Press Enter to send, Shift+Enter for new line.
            </p>
          </div>
        </>
      )}

      {/* Task Modal */}
      <TaskModal
        isOpen={isTaskModalOpen}
        onClose={handleTaskModalClose}
        onSave={handleTaskSave}
        agentType={agentType}
        task={selectedTask}
      />

      {/* Capabilities Modal */}
      <CapabilitiesModal
        isOpen={isCapabilitiesOpen}
        onClose={() => setIsCapabilitiesOpen(false)}
        config={config}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
      />
    </div>
  );
}

// Individual page exports
export function QAEngineerPage() {
  return <AgentPage agentType="qae" />;
}

export function AutomationEngineerPage() {
  return <AgentPage agentType="aue" />;
}
