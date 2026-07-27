import { create } from 'zustand';
import type { Page, InspectorType, TestCase, Execution, HealingSuggestion, Flow, Fact, DashboardStats } from './types';

export type ContextCounts = {
  sources: number;
  // Product
  flows: number;
  facts: number;
  entities: number;
  rules: number;
  states: number;
  permissions: number;
  integrations: number;
  constraints: number;
  configurations: number;
  terminology: number;
  features: number;
  personas: number;
  // Technical
  apis: number;
  code: number;
  architecture: number;
  database: number;
  // Quality
  testCases: number;
  requirements: number;
  defects: number;
  // Automation
  dom: number;
  locators: number;
  actions: number;
  dataSetup: number;
  auth: number;
};

type AppState = {
  // Navigation
  currentPage: Page;
  setCurrentPage: (page: Page) => void;

  // Inspector
  inspectorOpen: boolean;
  inspectorType: InspectorType;
  inspectorData: unknown;
  openInspector: (type: InspectorType, data: unknown) => void;
  closeInspector: () => void;

  // Sidebar
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  expandedNodes: Set<string>;
  toggleNode: (id: string) => void;

  // Theme
  theme: 'dark' | 'light';
  toggleTheme: () => void;

  // Search
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;

  // Notifications
  notificationsOpen: boolean;
  setNotificationsOpen: (open: boolean) => void;

  // Copilot
  copilotOpen: boolean;
  setCopilotOpen: (open: boolean) => void;

  // Data
  stats: DashboardStats | null;
  testCases: TestCase[];
  executions: Execution[];
  healingSuggestions: HealingSuggestion[];
  flows: Flow[];
  facts: Fact[];
  setData: (data: Partial<{
    stats: DashboardStats;
    testCases: TestCase[];
    executions: Execution[];
    healingSuggestions: HealingSuggestion[];
    flows: Flow[];
    facts: Fact[];
  }>) => void;

  // Loading
  loading: boolean;
  setLoading: (loading: boolean) => void;

  // Context Counts
  contextCounts: ContextCounts;
  setContextCounts: (counts: Partial<ContextCounts>) => void;
};

export const useAppStore = create<AppState>((set) => ({
  // Navigation
  currentPage: 'command-center',
  setCurrentPage: (page) => set({ currentPage: page }),

  // Inspector
  inspectorOpen: false,
  inspectorType: null,
  inspectorData: null,
  openInspector: (type, data) => set({ inspectorOpen: true, inspectorType: type, inspectorData: data }),
  closeInspector: () => set({ inspectorOpen: false, inspectorType: null, inspectorData: null }),

  // Sidebar
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  expandedNodes: new Set(['agents', 'context']),
  toggleNode: (id) => set((state) => {
    const newExpanded = new Set(state.expandedNodes);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    return { expandedNodes: newExpanded };
  }),

  // Theme
  theme: 'dark',
  toggleTheme: () => set((state) => {
    const newTheme = state.theme === 'dark' ? 'light' : 'dark';
    if (typeof document !== 'undefined') {
      document.documentElement.classList.remove('dark', 'light');
      document.documentElement.classList.add(newTheme);
    }
    return { theme: newTheme };
  }),

  // Search
  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),

  // Notifications
  notificationsOpen: false,
  setNotificationsOpen: (open) => set({ notificationsOpen: open }),

  // Copilot
  copilotOpen: false,
  setCopilotOpen: (open) => set({ copilotOpen: open }),

  // Data
  stats: null,
  testCases: [],
  executions: [],
  healingSuggestions: [],
  flows: [],
  facts: [],
  setData: (data) => set((state) => ({ ...state, ...data })),

  // Loading
  loading: true,
  setLoading: (loading) => set({ loading }),

  // Context Counts
  contextCounts: {
    sources: 0,
    flows: 0,
    facts: 0,
    entities: 0,
    rules: 0,
    states: 0,
    permissions: 0,
    integrations: 0,
    constraints: 0,
    configurations: 0,
    terminology: 0,
    features: 0,
    personas: 0,
    apis: 0,
    code: 0,
    architecture: 0,
    database: 0,
    testCases: 0,
    requirements: 0,
    defects: 0,
    dom: 0,
    locators: 0,
    actions: 0,
    dataSetup: 0,
    auth: 0,
  },
  setContextCounts: (counts) => set((state) => ({
    contextCounts: { ...state.contextCounts, ...counts }
  })),
}));
