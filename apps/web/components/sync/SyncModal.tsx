'use client';

import { useState, useEffect } from 'react';
import { X, ChevronRight, Tag, Info } from 'lucide-react';

export type SyncMode = 'incremental' | 'full' | 'selective';

export interface SyncIntent {
  id: string;
  label: string;
}

export interface SyncConfig {
  sourceIds: string[];
  mode: SyncMode;
  selectedDocuments?: Record<string, string[]>; // sourceId -> documentIds[]
  intents: SyncIntent[];
  forceReprocess?: boolean;
  forceExtract?: boolean;
}

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  sources: Array<{
    id: string;
    name: string;
    type: string;
    itemsCount: number;
  }>;
  preSelectedSourceId?: string;
  onSync: (config: SyncConfig) => void;
}

interface Document {
  id: string;
  title: string;
  type: string;
  externalId: string;
}

interface FetchError {
  message: string;
  status?: number;
}

export default function SyncModal({
  isOpen,
  onClose,
  sources,
  preSelectedSourceId,
  onSync,
}: SyncModalProps) {
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [syncMode, setSyncMode] = useState<SyncMode>('incremental');
  const [activeTab, setActiveTab] = useState<string>('');
  const [intentInput, setIntentInput] = useState('');
  const [intents, setIntents] = useState<SyncIntent[]>([]);
  const [documents, setDocuments] = useState<Record<string, Document[]>>({});
  const [selectedDocuments, setSelectedDocuments] = useState<Record<string, string[]>>({});
  const [loadingDocuments, setLoadingDocuments] = useState<Record<string, boolean>>({});
  const [fetchErrors, setFetchErrors] = useState<Record<string, FetchError>>({});
  const [fetchedSources, setFetchedSources] = useState<Set<string>>(new Set());
  const [forceReprocess, setForceReprocess] = useState(false);
  const [forceExtract, setForceExtract] = useState(false);

  // Initialize with pre-selected source if provided
  useEffect(() => {
    if (isOpen && preSelectedSourceId) {
      setSelectedSourceIds([preSelectedSourceId]);
      setActiveTab(preSelectedSourceId);
    }
  }, [isOpen, preSelectedSourceId]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedSourceIds([]);
      setSyncMode('incremental');
      setActiveTab('');
      setIntentInput('');
      setIntents([]);
      setDocuments({});
      setSelectedDocuments({});
      setLoadingDocuments({});
      setFetchErrors({});
      setFetchedSources(new Set());
      setForceReprocess(false);
      setForceExtract(false);
    }
  }, [isOpen]);

  // Load documents when selective mode is chosen
  useEffect(() => {
    if (syncMode === 'selective' && selectedSourceIds.length > 0) {
      console.log('Selective mode activated for sources:', selectedSourceIds);
      selectedSourceIds.forEach((sourceId) => {
        const alreadyFetched = fetchedSources.has(sourceId);
        const isLoading = loadingDocuments[sourceId];
        console.log(`Source ${sourceId}: alreadyFetched=${alreadyFetched}, isLoading=${isLoading}`);

        if (!alreadyFetched && !isLoading) {
          console.log(`Fetching documents for source ${sourceId}`);
          fetchDocuments(sourceId);
        }
      });
    }
  }, [syncMode, selectedSourceIds]);

  const fetchDocuments = async (sourceId: string) => {
    setLoadingDocuments((prev) => ({ ...prev, [sourceId]: true }));
    setFetchErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[sourceId];
      return newErrors;
    });

    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const url = `${API_BASE}/api/sources/${sourceId}/preview-documents?limit=500`;
      console.log('Fetching documents from source:', url);

      const response = await fetch(url);
      console.log('Response status:', response.status);

      if (response.ok) {
        const data = await response.json();
        console.log('Documents fetched from source:', data);
        const docs = data.documents || [];

        // Transform to match our Document interface
        const transformedDocs: Document[] = docs.map((doc: any) => ({
          id: doc.externalId, // Use externalId as temporary ID
          externalId: doc.externalId,
          title: doc.title,
          type: doc.type,
        }));

        setDocuments((prev) => ({ ...prev, [sourceId]: transformedDocs }));
        setFetchedSources((prev) => new Set(prev).add(sourceId));

        console.log(`Fetched ${transformedDocs.length} documents from source`);

        if (transformedDocs.length === 0) {
          console.warn(`No documents available in source ${sourceId}.`);
        }
      } else {
        const errorText = await response.text();
        console.error('Failed to fetch documents:', response.status, errorText);
        setFetchErrors((prev) => ({
          ...prev,
          [sourceId]: {
            message: `Failed to load documents from source (${response.status})`,
            status: response.status,
          },
        }));
        setDocuments((prev) => ({ ...prev, [sourceId]: [] }));
        setFetchedSources((prev) => new Set(prev).add(sourceId));
      }
    } catch (error) {
      console.error('Error fetching documents:', error);
      const errorMessage = error instanceof Error ? error.message : 'Network error';
      setFetchErrors((prev) => ({
        ...prev,
        [sourceId]: {
          message: `Failed to load documents: ${errorMessage}`,
        },
      }));
      setDocuments((prev) => ({ ...prev, [sourceId]: [] }));
      setFetchedSources((prev) => new Set(prev).add(sourceId));
    } finally {
      setLoadingDocuments((prev) => ({ ...prev, [sourceId]: false }));
    }
  };

  const handleSourceToggle = (sourceId: string) => {
    if (preSelectedSourceId) {
      // Single source mode (from card)
      return;
    }

    setSelectedSourceIds((prev) => {
      const newSelection = prev.includes(sourceId)
        ? prev.filter((id) => id !== sourceId)
        : [...prev, sourceId];

      // Set active tab to first selected source
      if (newSelection.length > 0 && !newSelection.includes(activeTab)) {
        setActiveTab(newSelection[0]);
      }

      return newSelection;
    });
  };

  const handleDocumentToggle = (sourceId: string, documentId: string) => {
    setSelectedDocuments((prev) => {
      const sourceDocIds = prev[sourceId] || [];
      const newDocIds = sourceDocIds.includes(documentId)
        ? sourceDocIds.filter((id) => id !== documentId)
        : [...sourceDocIds, documentId];

      return { ...prev, [sourceId]: newDocIds };
    });
  };

  const handleSelectAll = (sourceId: string) => {
    const allDocIds = documents[sourceId]?.map((doc) => doc.externalId) || [];
    setSelectedDocuments((prev) => ({ ...prev, [sourceId]: allDocIds }));
  };

  const handleDeselectAll = (sourceId: string) => {
    setSelectedDocuments((prev) => ({ ...prev, [sourceId]: [] }));
  };

  const handleIntentKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && intentInput.trim()) {
      e.preventDefault();
      const newIntent: SyncIntent = {
        id: `intent-${Date.now()}`,
        label: intentInput.trim(),
      };
      setIntents((prev) => [...prev, newIntent]);
      setIntentInput('');
    }
  };

  const removeIntent = (id: string) => {
    setIntents((prev) => prev.filter((intent) => intent.id !== id));
  };

  const handleSync = () => {
    const config: SyncConfig = {
      sourceIds: selectedSourceIds,
      mode: syncMode,
      selectedDocuments: syncMode === 'selective' ? selectedDocuments : undefined,
      intents,
      forceReprocess: syncMode === 'selective' ? forceReprocess : undefined,
      forceExtract: forceExtract || undefined,
    };
    onSync(config);
    onClose();
  };

  const canSync = selectedSourceIds.length > 0 &&
    (syncMode !== 'selective' || Object.values(selectedDocuments).some((docs) => docs.length > 0));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 ui-backdrop z-50 flex items-center justify-center p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="sync-modal-title" className="ui-dialog-panel w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 id="sync-modal-title" className="text-xl font-semibold text-text-primary">Run Sync</h2>
            <p className="text-sm text-text-secondary mt-1">
              {preSelectedSourceId
                ? 'Configure sync settings for this source'
                : 'Select sources and configure sync settings'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors p-2 hover:bg-elevated rounded"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Source Selection (only show if not pre-selected) */}
          {!preSelectedSourceId && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-3">
                Select Sources
              </label>
              <div className="grid grid-cols-2 gap-3">
                {sources.map((source) => (
                  <button
                    key={source.id}
                    onClick={() => handleSourceToggle(source.id)}
                    className={`p-4 rounded-lg border text-left transition-all ${
                      selectedSourceIds.includes(source.id)
                        ? 'border-accent-blue bg-accent-blue/10'
                        : 'border-border bg-elevated hover:border-strong'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="font-medium text-text-primary">{source.name}</div>
                        <div className="text-xs text-text-secondary mt-1">
                          {source.type} • {source.itemsCount.toLocaleString()} items
                        </div>
                      </div>
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                          selectedSourceIds.includes(source.id)
                            ? 'border-accent-blue bg-accent-blue'
                            : 'border-border'
                        }`}
                      >
                        {selectedSourceIds.includes(source.id) && (
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 12 12">
                            <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" fill="none" />
                          </svg>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Sync Mode */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-3">
              Sync Strategy
            </label>
            <div className="space-y-2">
              <label className="flex items-start p-4 rounded-lg border border-border bg-elevated hover:border-strong cursor-pointer transition-all">
                <input
                  type="radio"
                  name="syncMode"
                  value="incremental"
                  checked={syncMode === 'incremental'}
                  onChange={(e) => setSyncMode(e.target.value as SyncMode)}
                          className="mt-1 text-accent-blue focus:ring-accent-blue"
                />
                <div className="ml-3 flex-1">
                  <div className="font-medium text-text-primary">Incremental Sync</div>
                  <div className="text-sm text-text-secondary mt-1">
                    Only sync new or modified documents since last sync (recommended)
                  </div>
                </div>
              </label>

              <label className="flex items-start p-4 rounded-lg border border-border bg-elevated hover:border-strong cursor-pointer transition-all">
                <input
                  type="radio"
                  name="syncMode"
                  value="full"
                  checked={syncMode === 'full'}
                  onChange={(e) => setSyncMode(e.target.value as SyncMode)}
                  className="mt-1 text-accent-blue focus:ring-accent-blue"
                />
                <div className="ml-3 flex-1">
                  <div className="font-medium text-text-primary">Full Sync</div>
                  <div className="text-sm text-text-secondary mt-1">
                    Re-sync all documents from scratch, regardless of changes
                  </div>
                </div>
              </label>

              <label className="flex items-start p-4 rounded-lg border border-border bg-elevated hover:border-strong cursor-pointer transition-all">
                <input
                  type="radio"
                  name="syncMode"
                  value="selective"
                  checked={syncMode === 'selective'}
                  onChange={(e) => setSyncMode(e.target.value as SyncMode)}
                  className="mt-1 text-accent-blue focus:ring-accent-blue"
                />
                <div className="ml-3 flex-1">
                  <div className="font-medium text-text-primary">Selective Sync</div>
                  <div className="text-sm text-text-secondary mt-1">
                    Choose specific documents to sync
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Force Reprocess Option (for selective mode) */}
          {syncMode === 'selective' && (
            <div className="bg-elevated/60 border border-border rounded-lg p-4">
              <label className="flex items-start cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceReprocess}
                  onChange={(e) => setForceReprocess(e.target.checked)}
                  className="mt-1 text-accent-blue focus:ring-accent-blue rounded"
                />
                <div className="ml-3 flex-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-medium text-text-primary">Force Reprocess</span>
                    <Info size={14} className="text-text-secondary" />
                  </div>
                  <div className="text-sm text-text-secondary mt-1">
                    Re-run indexing, extraction, and population even if document content hasn't changed.
                    Useful for applying new extraction intents or fixing previous extraction issues.
                  </div>
                </div>
              </label>
            </div>
          )}

          <div className="bg-elevated/60 border border-border rounded-lg p-4">
            <label className="flex items-start cursor-pointer">
              <input
                type="checkbox"
                checked={forceExtract}
                onChange={(e) => setForceExtract(e.target.checked)}
                className="mt-1 text-accent-blue focus:ring-accent-blue rounded"
              />
              <div className="ml-3 flex-1">
                <div className="flex items-center space-x-2">
                  <span className="font-medium text-text-primary">Force extract context</span>
                  <Info size={14} className="text-text-secondary" />
                </div>
                <div className="text-sm text-text-secondary mt-1">
                  Re-run context extraction for unchanged documents and keep their existing chunks and embeddings.
                </div>
              </div>
            </label>
          </div>

          {/* Document Selection (for selective mode) */}
          {syncMode === 'selective' && selectedSourceIds.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-3">
                Select Documents
              </label>

              {/* Tabs for multiple sources */}
              {selectedSourceIds.length > 1 && (
                <div className="flex space-x-2 border-b border-border mb-4">
                  {selectedSourceIds.map((sourceId) => {
                    const source = sources.find((s) => s.id === sourceId);
                    if (!source) return null;
                    return (
                      <button
                        key={sourceId}
                        onClick={() => setActiveTab(sourceId)}
                        className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                          activeTab === sourceId
                            ? 'text-accent-blue'
                            : 'text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {source.name}
                        {activeTab === sourceId && (
                          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-blue" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Document List */}
              {selectedSourceIds.map((sourceId) => {
                if (selectedSourceIds.length > 1 && activeTab !== sourceId) {
                  return null;
                }

                const sourceDocs = documents[sourceId] || [];
                const selectedDocs = selectedDocuments[sourceId] || [];
                const isLoading = loadingDocuments[sourceId];
                const fetchError = fetchErrors[sourceId];

                return (
                  <div key={sourceId} className="border border-border rounded-lg bg-elevated/60">
                    {/* Controls */}
                    <div className="flex items-center justify-between p-3 border-b border-border">
                      <div className="text-sm text-text-secondary">
                        {selectedDocs.length} of {sourceDocs.length} selected
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleSelectAll(sourceId)}
                          disabled={sourceDocs.length === 0}
                          className="text-xs text-accent-blue hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Select All
                        </button>
                        <span className="text-text-secondary">•</span>
                        <button
                          onClick={() => handleDeselectAll(sourceId)}
                          disabled={selectedDocs.length === 0}
                          className="text-xs text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Deselect All
                        </button>
                      </div>
                    </div>

                    {/* Document List */}
                    <div className="max-h-64 overflow-y-auto">
                      {isLoading ? (
                        <div className="p-8 text-center text-text-secondary">
                          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-accent-blue"></div>
                          <div className="mt-2 text-sm">Loading documents...</div>
                        </div>
                      ) : fetchError ? (
                        <div className="p-8 text-center">
                          <div className="text-danger mb-2">
                            <Info size={24} className="mx-auto mb-2" />
                            {fetchError.message}
                          </div>
                          <button
                            onClick={() => fetchDocuments(sourceId)}
                            className="text-sm text-accent-blue hover:text-text-primary"
                          >
                            Retry
                          </button>
                        </div>
                      ) : sourceDocs.length === 0 ? (
                        <div className="p-8 text-center">
                          <div className="text-text-secondary mb-2">
                            <Info size={24} className="mx-auto mb-2 opacity-50" />
                            <div className="text-sm">No documents available</div>
                            <div className="text-xs mt-1">
                              This source doesn't have any documents available.
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="divide-y divide-border">
                          {sourceDocs.map((doc) => (
                            <label
                              key={doc.externalId}
                              className="flex items-center p-3 hover:bg-elevated/70 cursor-pointer transition-colors"
                            >
                              <input
                                type="checkbox"
                                checked={selectedDocs.includes(doc.externalId)}
                                onChange={() => handleDocumentToggle(sourceId, doc.externalId)}
                                className="text-accent-blue focus:ring-accent-blue rounded"
                              />
                              <div className="ml-3 flex-1 min-w-0">
                                <div className="text-sm text-text-primary truncate">{doc.title}</div>
                                <div className="text-xs text-text-secondary mt-1">
                                  {doc.type} • {doc.externalId}
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Sync Intent */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Extraction Intent <span className="text-text-secondary">(Optional)</span>
            </label>
            <div className="mb-2 flex items-start space-x-2 text-xs text-text-secondary bg-elevated p-3 rounded-lg border border-border">
              <Info size={14} className="mt-0.5 flex-shrink-0" />
              <p>
                Define what you want to extract from documents. Press Enter to add each intent.
                These will guide the AI to focus on specific aspects during extraction.
              </p>
            </div>

            {/* Intent Tags */}
            {intents.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3 p-3 bg-elevated rounded-lg border border-border">
                {intents.map((intent) => (
                  <div
                    key={intent.id}
                    className="flex items-center space-x-2 px-3 py-1.5 bg-accent-blue/10 border border-accent-blue/30 rounded-full text-sm text-accent-blue"
                  >
                    <Tag size={14} />
                    <span>{intent.label}</span>
                    <button
                      onClick={() => removeIntent(intent.id)}
                      className="hover:text-text-primary transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Intent Input */}
            <input
              type="text"
              value={intentInput}
              onChange={(e) => setIntentInput(e.target.value)}
              onKeyDown={handleIntentKeyDown}
              placeholder="e.g., 'user authentication flows', 'API endpoints', 'test cases'..."
              className="ui-field w-full text-text-primary placeholder:text-text-secondary"
            />
            <p className="text-xs text-text-secondary mt-2">
              Press Enter to add • Examples: requirements, test cases, business rules, API specifications
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-border bg-surface">
          <button
            onClick={onClose}
            className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSync}
            disabled={!canSync}
            className="ui-button-primary disabled:opacity-45"
          >
            <span>Start Sync</span>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
