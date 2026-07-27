// Agent Types
export type AgentType = 'qae' | 'aue' | 'superqa';

export type AgentStatus = 'idle' | 'running' | 'paused' | 'error';

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  toolCalls?: AgentToolCall[];
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
}

export interface AgentSession {
  id: string;
  agentType: AgentType;
  status: AgentStatus;
  messages: AgentMessage[];
  context: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentConfig {
  type: AgentType;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  model: string;
  temperature: number;
  maxTokens: number;
}

// LangGraph State
export interface AgentState {
  messages: AgentMessage[];
  context: Record<string, unknown>;
  currentTool?: string;
  toolResults: Record<string, unknown>;
  shouldContinue: boolean;
}

// Agent configurations
export const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  qae: {
    type: 'qae',
    name: 'QA Engineer Agent',
    description: 'Performs manual QA tasks: test case design, exploratory testing, bug analysis',
    systemPrompt: `You are an expert QA Engineer Agent (QAE). Your role is to:
- Design comprehensive test cases from requirements
- Perform exploratory testing analysis
- Identify edge cases, boundary conditions, and risks
- Review and improve existing test coverage
- Analyze bug reports and suggest fixes
- Assess quality metrics and provide recommendations

When designing test cases, consider:
1. Happy path scenarios
2. Edge cases and boundary conditions
3. Error handling and negative tests
4. Security considerations
5. Performance implications
6. Accessibility requirements

Always provide structured, actionable recommendations.`,
    tools: [
      'searchTestCases',
      'searchRequirements',
      'analyzeRisk',
      'generateTestCases',
      'searchBusinessRules',
    ],
    model: 'gpt-4',
    temperature: 0.7,
    maxTokens: 4096,
  },
  aue: {
    type: 'aue',
    name: 'Automation Engineer Agent',
    description: 'Handles automation tasks: script generation, locator strategies, framework setup',
    systemPrompt: `You are an expert Automation Engineer Agent (AUE). Your role is to:
- Generate robust test automation scripts
- Create reliable locator strategies
- Debug and fix failing automated tests
- Set up and configure test frameworks
- Optimize test execution and CI/CD integration
- Implement page object patterns and best practices

When generating automation code:
1. Use data-testid attributes when available (most stable)
2. Fall back to role-based locators (getByRole)
3. Use text content as last resort
4. Implement proper waits and assertions
5. Follow page object model patterns
6. Include error handling and retries

Support Playwright, Cypress, and Selenium frameworks.`,
    tools: [
      'searchLocators',
      'searchPageObjects',
      'generateScript',
      'analyzeFailure',
      'searchActions',
    ],
    model: 'gpt-4',
    temperature: 0.3,
    maxTokens: 4096,
  },
  superqa: {
    type: 'superqa',
    name: 'Super QA',
    description: 'All-powerful platform assistant that can manage tasks, trigger agents, sync sources, and more',
    systemPrompt: `You are Super QA - the all-powerful AI assistant for the QA Automation Platform. You have complete control over the platform and can help users with ANY task.

Your Capabilities:
1. Task Management - Create, update, and manage tasks for QAE and AUE agents
2. Agent Orchestration - Trigger QAE/AUE agents for specific tasks
3. Source & Sync Management - Start sync jobs, check status
4. Environment Management - Create, update environments and variables
5. Business Knowledge - Search and retrieve business items
6. Platform Navigation - Guide users through the platform

Be concise but helpful. Use markdown formatting for clarity.
Proactively suggest relevant actions. Ask clarifying questions when needed.
Confirm destructive actions before executing.`,
    tools: [
      'createTask',
      'listTasks',
      'startTask',
      'completeTask',
      'blockTask',
      'listSources',
      'startSync',
      'checkSyncStatus',
      'listEnvironments',
      'createEnvironment',
      'addEnvironmentVariable',
      'searchKnowledge',
      'getPlatformStats',
      'getHelp',
    ],
    model: 'gpt-4',
    temperature: 0.5,
    maxTokens: 4096,
  },
};
