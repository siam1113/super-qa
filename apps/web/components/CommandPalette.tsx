'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import type { Page, InspectorType, BusinessItemType } from '@/lib/types';
import {
  Search, LayoutDashboard, TestTube, Code, Box, Database, Settings, X, Link, FileText,
  Briefcase, Cpu, Cog, Lightbulb, Workflow, BookOpen, Bug,
  MessageSquare, Plug, Radar, Server, ClipboardList,
} from 'lucide-react';

type SearchResult = {
  id: string;
  label: string;
  detail: string;
  icon: React.ReactNode;
  category: 'navigation' | 'workspace';
  action: () => void;
  keywords: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const normalize = (value: unknown) => String(value ?? '').toLocaleLowerCase().trim();
const includesQuery = (query: string, ...values: unknown[]) => {
  const text = normalize(values.join(' '));
  return !query || text.includes(query);
};

export function CommandPalette() {
  const {
    searchOpen, setSearchOpen, setCurrentPage, setData,
    testCases, executions, healingSuggestions, flows, facts, openInspector,
    setPendingKnowledgeType, setPendingFrameworkTab,
  } = useAppStore();
  const openKnowledge = (type: BusinessItemType) => { setCurrentPage('app-settings'); setPendingKnowledgeType(type); };
  const openFramework = (tab: string) => { setCurrentPage('frameworks'); setPendingFrameworkTab(tab); };
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [sourceCatalog, setSourceCatalog] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [documentResults, setDocumentResults] = useState<SearchResult[]>([]);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentSearchError, setDocumentSearchError] = useState('');

  const navigation: SearchResult[] = useMemo(() => {
    const pages: Array<{ page: Page; label: string; icon: React.ReactNode; keywords?: string; action?: () => void }> = [
      { page: 'command-center', label: 'Command Center', icon: <Radar size={18} />, keywords: 'home overview tasks' },
      { page: 'executions', label: 'Executions', icon: <LayoutDashboard size={18} />, keywords: 'runs history outcomes metrics' },
      { page: 'chat', label: 'Chat', icon: <MessageSquare size={18} />, keywords: 'messages teammates' },
      { page: 'integrations', label: 'Integrations', icon: <Plug size={18} />, keywords: 'connectors providers' },
      { page: 'pipelines', label: 'Pipelines', icon: <Workflow size={18} />, keywords: 'sources sync jobs history' },
      { page: 'business', label: 'Business Knowledge', icon: <Briefcase size={18} />, keywords: 'product knowledge' },
      { page: 'business-flows', label: 'Flows', icon: <Workflow size={18} />, keywords: 'business journeys', action: () => openKnowledge('flow') },
      { page: 'business-facts', label: 'Facts', icon: <BookOpen size={18} />, keywords: 'knowledge', action: () => openKnowledge('fact') },
      { page: 'technical-apis', label: 'APIs', icon: <Cpu size={18} />, keywords: 'technical endpoints', action: () => openKnowledge('api') },
      { page: 'technical-code', label: 'Code', icon: <Code size={18} />, keywords: 'technical repository', action: () => openKnowledge('code') },
      { page: 'test-cases', label: 'Test Cases', icon: <TestTube size={18} />, keywords: 'tests qa quality' },
      { page: 'execution-plans', label: 'Execution Plans', icon: <ClipboardList size={18} />, keywords: 'plans test cycles' },
      { page: 'test-data', label: 'Data', icon: <Database size={18} />, keywords: 'test data datasets fixtures', action: () => openFramework('data') },
      { page: 'requirements', label: 'Requirements', icon: <ClipboardList size={18} />, keywords: 'quality specs', action: () => openKnowledge('requirement') },
      { page: 'defects', label: 'Defects', icon: <Bug size={18} />, keywords: 'bugs issues' },
      { page: 'frameworks', label: 'Framework', icon: <Code size={18} />, keywords: 'automation setup' },
      { page: 'automated-tests', label: 'Automated Tests', icon: <TestTube size={18} />, keywords: 'automation scripts checks' },
      { page: 'actions', label: 'Actions', icon: <Cog size={18} />, keywords: 'automation', action: () => openFramework('actions') },
      { page: 'dom', label: 'POM', icon: <Box size={18} />, keywords: 'automation page objects dom', action: () => openFramework('pom') },
      { page: 'features', label: 'Features', icon: <Lightbulb size={18} />, keywords: 'product', action: () => openKnowledge('flow') },
      { page: 'environments', label: 'Environments', icon: <Server size={18} />, keywords: 'staging production' },
      { page: 'test-credentials', label: 'Test Credentials', icon: <Settings size={18} />, keywords: 'secrets accounts auth' },
      { page: 'reports', label: 'Reports', icon: <LayoutDashboard size={18} />, keywords: 'quality trends' },
      { page: 'coverage', label: 'Coverage', icon: <Radar size={18} />, keywords: 'requirements tests traceability' },
      { page: 'user-settings', label: 'User Settings', icon: <Settings size={18} />, keywords: 'account appearance profile' },
      { page: 'settings', label: 'App Settings', icon: <Settings size={18} />, keywords: 'organization access configuration' },
    ];
    return pages.map(({ page, label, icon, keywords = '', action }) => ({
      id: `page:${page}`, label: `Go to ${label}`, detail: 'Navigate', icon,
      category: 'navigation', keywords: `${label} ${keywords}`,
      action: action || (() => setCurrentPage(page)),
    }));
  }, [setCurrentPage]);

  const workspaceResults: SearchResult[] = useMemo(() => {
    if (!normalize(query)) return [];
    const results: SearchResult[] = [];
    for (const item of testCases) {
      if (includesQuery(normalize(query), item.title, item.id, item.flow, item.owner, item.tags, item.steps?.map(step => `${step.action} ${step.expected}`))) {
        results.push({ id: `test:${item.id}`, label: item.title, detail: `Test case · ${item.id}${item.flow ? ` · ${item.flow}` : ''}`, icon: <TestTube size={18} />, category: 'workspace', keywords: `${item.title} ${item.id} ${item.flow} ${item.owner} ${item.tags.join(' ')}`, action: () => { setCurrentPage('test-cases'); openInspector('testCase', item); } });
      }
    }
    for (const item of executions) {
      if (includesQuery(normalize(query), item.testName, item.testId, item.flow, item.environment, item.browser, item.status, item.owner, item.errorMessage)) {
        results.push({ id: `execution:${item.testId}:${item.startedAt || item.status}`, label: item.testName, detail: `Execution · ${item.status} · ${item.environment || 'environment unknown'}`, icon: <LayoutDashboard size={18} />, category: 'workspace', keywords: `${item.testName} ${item.testId} ${item.flow} ${item.environment} ${item.browser} ${item.status} ${item.errorMessage}`, action: () => { setCurrentPage('dashboard'); openInspector('execution', item); } });
      }
    }
    for (const item of healingSuggestions) {
      if (includesQuery(normalize(query), item.issue, item.rootCause, item.owner, item.affectedTests, item.currentLocator, item.suggestedLocator, item.status)) {
        results.push({ id: `healing:${item.id || item.issue}`, label: item.issue, detail: `Healing suggestion · ${item.status}`, icon: <Cog size={18} />, category: 'workspace', keywords: `${item.issue} ${item.rootCause} ${item.owner} ${item.affectedTests.join(' ')} ${item.status}`, action: () => { setCurrentPage('dashboard'); openInspector('healing', item); } });
      }
    }
    for (const item of flows) {
      if (includesQuery(normalize(query), item.name, item.module, item.description, item.dependencies, item.relatedPages)) {
        results.push({ id: `flow:${item.name}`, label: item.name, detail: `Flow · ${item.module}`, icon: <Workflow size={18} />, category: 'workspace', keywords: `${item.name} ${item.module} ${item.description} ${item.dependencies.join(' ')} ${item.relatedPages.join(' ')}`, action: () => { openKnowledge('flow'); openInspector('flow', item); } });
      }
    }
    for (const item of facts) {
      if (includesQuery(normalize(query), item.text, item.category, item.source, item.createdBy, item.relatedObjects)) {
        results.push({ id: `fact:${item.source}:${item.text.slice(0, 32)}`, label: item.text, detail: `Fact · ${item.category} · ${item.source}`, icon: <BookOpen size={18} />, category: 'workspace', keywords: `${item.text} ${item.category} ${item.source} ${item.createdBy} ${item.relatedObjects.join(' ')}`, action: () => { openKnowledge('fact'); openInspector('fact', item); } });
      }
    }
    return results.slice(0, 30);
  }, [query, testCases, executions, healingSuggestions, flows, facts, setCurrentPage, openInspector]);

  const filteredNavigation = useMemo(() => navigation.filter(result => includesQuery(normalize(query), result.label, result.keywords)), [navigation, query]);
  const results = useMemo(() => [...filteredNavigation, ...workspaceResults, ...documentResults], [filteredNavigation, workspaceResults, documentResults]);

  useEffect(() => {
    if (!searchOpen) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setSearchError('');
    setDocumentSearchError('');
    setDocumentResults([]);
    void Promise.allSettled([
      fetch(`${API_BASE}/api/qa/workspace`, { cache: 'no-store', signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error('Workspace search data is unavailable.');
        return response.json();
      }),
      fetch(`${API_BASE}/api/sources`, { cache: 'no-store', signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error('Connected source list is unavailable.');
        return response.json();
      }),
    ]).then(([workspace, sources]) => {
      if (!active) return;
      if (workspace.status === 'fulfilled') {
        const data = workspace.value;
        setData({ stats: data.stats, testCases: data.testCases || [], executions: data.executions || [], healingSuggestions: data.healingSuggestions || [], flows: data.flows || [], facts: data.facts || [] });
      } else if (workspace.reason?.name !== 'AbortError') {
        setSearchError('Workspace search data is unavailable. Page search still works.');
      }
      if (sources.status === 'fulfilled') {
        setSourceCatalog((sources.value || []).filter((source: unknown): source is { id: string; name: string; type: string } => {
          if (!source || typeof source !== 'object') return false;
          const item = source as Record<string, unknown>;
          return typeof item.id === 'string' && typeof item.name === 'string' && typeof item.type === 'string';
        }).slice(0, 50));
      } else if (sources.reason?.name !== 'AbortError') {
        setDocumentSearchError('Could not load connected sources for document search.');
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [searchOpen, setData]);

  useEffect(() => {
    const normalizedQuery = normalize(query);
    setDocumentResults([]);
    setDocumentSearchError('');
    if (!searchOpen || !normalizedQuery || !sourceCatalog.length) {
      setDocumentLoading(false);
      return;
    }
    let active = true;
    setDocumentLoading(true);
    const timer = window.setTimeout(() => {
      setDocumentSearchError('');
      const params = new URLSearchParams({ q: query.trim(), limit: '6', sourceIds: sourceCatalog.map(source => source.id).join(',') });
      void fetch(`${API_BASE}/api/retrieval/search?${params.toString()}`, { cache: 'no-store' })
        .then(async response => {
          if (!response.ok) throw new Error('Indexed document search is unavailable.');
          return response.json();
        })
        .then(data => {
          if (!active) return;
          const sourceNames = new Map(sourceCatalog.map(source => [source.id, source.name]));
          const found: SearchResult[] = (data.results || []).map((item: { id: string; documentTitle: string; documentType: string; content: string; documentUrl: string | null; citation: { sourceId: string } }) => ({
            id: `document:${item.id}`,
            label: item.documentTitle,
            detail: `${sourceNames.get(item.citation.sourceId) || 'Connected source'} · ${item.documentType} · ${item.content.slice(0, 180)}`,
            icon: <FileText size={18} />,
            category: 'workspace',
            keywords: `${item.documentTitle} ${item.documentType} ${item.content}`,
            action: () => {
              const url = item.documentUrl ? (() => { try { const parsed = new URL(item.documentUrl); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null; } catch { return null; } })() : null;
              if (url) window.open(url, '_blank', 'noopener,noreferrer');
              else setCurrentPage('pipelines');
            },
          }));
          setDocumentResults(found);
        })
        .catch(failure => { if (active) { setDocumentResults([]); setDocumentSearchError(failure instanceof Error ? failure.message : 'Indexed document search failed.'); } })
        .finally(() => { if (active) setDocumentLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [query, searchOpen, sourceCatalog, setCurrentPage]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(!searchOpen);
      }
      if (event.key === 'Escape' && searchOpen) setSearchOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen, setSearchOpen]);

  useEffect(() => { if (!searchOpen) setQuery(''); }, [searchOpen]);

  if (!searchOpen) return null;

  const handleSelect = (result: SearchResult) => {
    result.action();
    setSearchOpen(false);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex(index => Math.min(index + 1, results.length - 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(index => Math.max(index - 1, 0)); }
    if (event.key === 'Enter' && results[activeIndex]) { event.preventDefault(); handleSelect(results[activeIndex]); }
  };

  const renderResult = (result: SearchResult, index: number) => <button
    id={`search-result-${index}`}
    key={result.id}
    role="option"
    aria-selected={activeIndex === index}
    onMouseEnter={() => setActiveIndex(index)}
    onClick={() => handleSelect(result)}
    className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-text-primary transition-colors', activeIndex === index ? 'bg-elevated' : 'hover:bg-elevated')}
  >
    <span className="shrink-0 text-text-secondary">{result.icon}</span>
    <span className="min-w-0 flex-1"><span className="block truncate">{result.label}</span><span className="mt-0.5 block truncate text-xs text-text-secondary">{result.detail}</span></span>
    <span className="shrink-0 text-[10px] uppercase tracking-wide text-text-secondary">{result.category === 'navigation' ? 'Page' : 'Result'}</span>
  </button>;

  return <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh] sm:pt-[20vh]">
    <button className="ui-backdrop absolute inset-0" aria-label="Close search" onClick={() => setSearchOpen(false)} />
    <section role="dialog" aria-modal="true" aria-label="Workspace search" className="ui-dialog-panel relative w-full max-w-2xl overflow-hidden animate-fade-in">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Search size={20} className="shrink-0 text-text-secondary" />
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Search pages, tests, flows, facts, and activity…"
          aria-label="Search workspace"
          aria-controls="workspace-search-results"
          aria-activedescendant={results.length ? `search-result-${activeIndex}` : undefined}
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          className="min-w-0 flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-secondary"
          autoFocus
        />
        {(loading || documentLoading) && <span className="text-xs text-text-secondary">Searching…</span>}
        <button onClick={() => setSearchOpen(false)} aria-label="Close search" className="rounded p-1 hover:bg-elevated"><X size={16} className="text-text-secondary" /></button>
      </div>

      <div id="workspace-search-results" role="listbox" className="max-h-[min(65vh,32rem)] overflow-y-auto p-2">
        {filteredNavigation.length > 0 && <>
          <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-text-secondary">Pages</p>
          {filteredNavigation.map((result, index) => renderResult(result, index))}
        </>}
        {workspaceResults.length > 0 && <>
          <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-text-secondary">Workspace results</p>
          {workspaceResults.map((result, index) => renderResult(result, filteredNavigation.length + index))}
        </>}
        {documentResults.length > 0 && <>
          <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-text-secondary">Connected documents</p>
          {documentResults.map((result, index) => renderResult(result, filteredNavigation.length + workspaceResults.length + index))}
        </>}
        {query && !results.length && <div className="px-4 py-8 text-center text-sm text-text-secondary">{loading || documentLoading ? 'Searching workspace…' : 'No matching pages or workspace items.'}</div>}
        {!query && !loading && !results.length && <div className="px-4 py-8 text-center text-sm text-text-secondary">No search results are available.</div>}
        {searchError && <p role="status" className="border-t border-border px-3 py-2 text-xs text-warning">{searchError}</p>}
        {documentSearchError && <p role="status" className="border-t border-border px-3 py-2 text-xs text-warning">{documentSearchError}</p>}
      </div>

      <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-xs text-text-secondary">
        <span><kbd className="rounded bg-elevated px-1.5 py-0.5">↑</kbd> <kbd className="rounded bg-elevated px-1.5 py-0.5">↓</kbd> navigate</span>
        <span><kbd className="rounded bg-elevated px-1.5 py-0.5">↵</kbd> select</span>
        <span><kbd className="rounded bg-elevated px-1.5 py-0.5">esc</kbd> close</span>
      </div>
    </section>
  </div>;
}
