import { create } from 'zustand';
import type { Page, InspectorType, TestCase, Execution, HealingSuggestion, Flow, Fact, DashboardStats, BusinessItemType } from './types';

export type ThemePreset =
  | 'dark' | 'light'
  | 'aurora' | 'aurora-light'
  | 'secure' | 'secure-light'
  | 'energetic' | 'energetic-light'
  | 'natural' | 'natural-light';

export type ThemePalette = 'default' | 'aurora' | 'secure' | 'energetic' | 'natural';
export type ThemeMode = 'dark' | 'light';

export const THEME_PRESETS: ThemePreset[] = [
  'dark', 'light',
  'aurora', 'aurora-light',
  'secure', 'secure-light',
  'energetic', 'energetic-light',
  'natural', 'natural-light',
];

export function themePalette(theme: ThemePreset): ThemePalette {
  if (theme === 'dark' || theme === 'light') return 'default';
  return theme.replace('-light', '') as ThemePalette;
}

export function themeMode(theme: ThemePreset): ThemeMode {
  return theme === 'light' || theme.endsWith('-light') ? 'light' : 'dark';
}

export function composeTheme(palette: ThemePalette, mode: ThemeMode): ThemePreset {
  if (palette === 'default') return mode;
  return mode === 'light' ? (`${palette}-light` as ThemePreset) : (palette as ThemePreset);
}

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
  selectedSyncJobId: string | null;
  setSelectedSyncJobId: (jobId: string | null) => void;
  // A category to pre-select when navigating into the Knowledge tab from outside it (e.g. command palette, search results).
  pendingKnowledgeType: BusinessItemType | null;
  setPendingKnowledgeType: (type: BusinessItemType | null) => void;
  // A Framework tab to pre-select when navigating into the Framework page from outside it.
  pendingFrameworkTab: string | null;
  setPendingFrameworkTab: (tab: string | null) => void;

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
  theme: ThemePreset;
  setTheme: (theme: ThemePreset) => void;
  setThemePalette: (palette: ThemePalette) => void;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;

  // Search
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;

  // Notifications
  notificationsOpen: boolean;
  setNotificationsOpen: (open: boolean) => void;
  notificationsUnreadCount: number;
  setNotificationsUnreadCount: (count: number) => void;

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
  updateTestCase: (testCase: TestCase) => void;
  updateTestCases: (testCases: TestCase[]) => void;

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
  selectedSyncJobId: null,
  setSelectedSyncJobId: (jobId) => set({ selectedSyncJobId: jobId }),
  pendingKnowledgeType: null,
  setPendingKnowledgeType: (type) => set({ pendingKnowledgeType: type }),
  pendingFrameworkTab: null,
  setPendingFrameworkTab: (tab) => set({ pendingFrameworkTab: tab }),

  // Inspector
  inspectorOpen: false,
  inspectorType: null,
  inspectorData: null,
  openInspector: (type, data) => set({ inspectorOpen: true, inspectorType: type, inspectorData: data }),
  closeInspector: () => set({ inspectorOpen: false, inspectorType: null, inspectorData: null }),

  // Sidebar
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  expandedNodes: new Set(['agents', 'plan', 'automate', 'execute', 'review']),
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
  setTheme: (theme) => {
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem('superqa-theme', theme); } catch { /* Keep the in-memory choice if storage is unavailable. */ }
      document.documentElement.classList.remove(...THEME_PRESETS);
      document.documentElement.classList.add(theme);
    }
    set({ theme });
  },
  setThemePalette: (palette) => set((state) => {
    const newTheme = composeTheme(palette, themeMode(state.theme));
    if (typeof document !== 'undefined') {
      document.documentElement.classList.remove(...THEME_PRESETS);
      document.documentElement.classList.add(newTheme);
    }
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem('superqa-theme', newTheme); } catch { /* Theme remains active for this session. */ }
    }
    return { theme: newTheme };
  }),
  setThemeMode: (mode) => set((state) => {
    const newTheme = composeTheme(themePalette(state.theme), mode);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.remove(...THEME_PRESETS);
      document.documentElement.classList.add(newTheme);
    }
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem('superqa-theme', newTheme); } catch { /* Theme remains active for this session. */ }
    }
    return { theme: newTheme };
  }),
  toggleTheme: () => set((state) => {
    const newTheme = composeTheme(themePalette(state.theme), themeMode(state.theme) === 'dark' ? 'light' : 'dark');
    if (typeof document !== 'undefined') {
      document.documentElement.classList.remove(...THEME_PRESETS);
      document.documentElement.classList.add(newTheme);
    }
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem('superqa-theme', newTheme); } catch { /* Theme remains active for this session. */ }
    }
    return { theme: newTheme };
  }),

  // Search
  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),

  // Notifications
  notificationsOpen: false,
  setNotificationsOpen: (open) => set({ notificationsOpen: open }),
  notificationsUnreadCount: 0,
  setNotificationsUnreadCount: (count) => set({ notificationsUnreadCount: count }),

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
  updateTestCase: (testCase) => set((state) => ({
    testCases: state.testCases.map((item) => (item.id === testCase.id ? testCase : item)),
    inspectorData: state.inspectorType === 'testCase' && (state.inspectorData as TestCase | null)?.id === testCase.id ? testCase : state.inspectorData,
  })),
  updateTestCases: (updated) => set((state) => {
    const byId = new Map(updated.map((testCase) => [testCase.id, testCase]));
    const inspectorData = state.inspectorType === 'testCase' ? byId.get((state.inspectorData as TestCase | null)?.id || '') : undefined;
    return {
      testCases: state.testCases.map((item) => byId.get(item.id) || item),
      ...(inspectorData ? { inspectorData } : {}),
    };
  }),

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
