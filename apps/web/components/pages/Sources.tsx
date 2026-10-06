'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { Source } from '@/lib/types';
import { ChatDialog, Field, FieldSection, SecretField, fieldClass, primaryClass, secondaryClass } from '../chat/ChatDialog';
import {
  Plus,
  RefreshCw,
  Search,
  Check,
  X,
  AlertCircle,
  Loader2,
  Trash2,
  Key,
  ExternalLink,
  Pencil,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  Eye,
} from 'lucide-react';
import { SyncModal, type SyncConfig } from '../sync';

const API_BASE = 'http://localhost:4000';

const availableIntegrations = [
  { type: 'github', name: 'GitHub', description: 'Connect repositories and PRs', color: 'bg-gray-800', supportsOAuth: true },
  { type: 'jira', name: 'Jira', description: 'Sync issues and requirements', color: 'bg-blue-600', supportsOAuth: true },
  { type: 'confluence', name: 'Confluence', description: 'Import documentation', color: 'bg-blue-500', supportsOAuth: true },
  { type: 'upload', name: 'Computer', description: 'Upload text, PDF, or Word files to analyze', color: 'bg-emerald-600', supportsOAuth: false },
];

const UPLOAD_ACCEPT = '.txt,.md,.pdf,.doc,.docx';
const UPLOAD_EXTENSIONS = ['.txt', '.md', '.pdf', '.doc', '.docx'];

function getStatusIcon(status: Source['status']) {
  switch (status) {
    case 'connected':
      return <Check size={14} className="text-success" />;
    case 'syncing':
      return <Loader2 size={14} className="text-info animate-spin" />;
    case 'error':
      return <AlertCircle size={14} className="text-danger" />;
    default:
      return <X size={14} className="text-text-secondary" />;
  }
}

function getStatusColor(status: Source['status']) {
  switch (status) {
    case 'connected':
      return 'bg-success/10 text-success border-success/20';
    case 'syncing':
      return 'bg-info/10 text-info border-info/20';
    case 'error':
      return 'bg-danger/10 text-danger border-danger/20';
    default:
      return 'bg-text-secondary/10 text-text-secondary border-text-secondary/20';
  }
}

function getSyncStatusIcon(status: string) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={14} className="text-success" />;
    case 'failed':
      return <XCircle size={14} className="text-danger" />;
    case 'running':
      return <Loader2 size={14} className="text-info animate-spin" />;
    case 'queued':
      return <Clock size={14} className="text-text-secondary" />;
    default:
      return <Activity size={14} className="text-text-secondary" />;
  }
}

function getSyncStatusColor(status: string) {
  switch (status) {
    case 'completed':
      return 'bg-success/10 text-success border-success/20';
    case 'failed':
      return 'bg-danger/10 text-danger border-danger/20';
    case 'running':
      return 'bg-info/10 text-info border-info/20';
    case 'queued':
      return 'bg-text-secondary/10 text-text-secondary border-text-secondary/20';
    default:
      return 'bg-text-secondary/10 text-text-secondary border-text-secondary/20';
  }
}

function formatRelativeTime(date: string | null): string {
  if (!date) return 'Never';
  const now = new Date();
  const then = new Date(date);
  const diff = now.getTime() - then.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function SourceCard({ source, onOpenSyncModal, onDelete, onTest, onEdit, onViewSyncJob }: {
  source: Source;
  onOpenSyncModal: (sourceId: string) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  onEdit: (source: Source) => void;
  onViewSyncJob?: (jobId: string) => void;
}) {
  const [isSyncing, setIsSyncing] = useState(source.status === 'syncing');
  const [showErrorTooltip, setShowErrorTooltip] = useState(false);

  useEffect(() => {
    setIsSyncing(source.status === 'syncing');
  }, [source.status]);

  const integration = availableIntegrations.find((i) => i.type === source.type);

  return (
    <div className="bg-surface border border-border rounded-xl p-4 hover:border-text-secondary transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm', integration?.color || 'bg-elevated')}>
            {source.type.charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 className="font-medium text-sm">{source.name}</h3>
            <p className="text-xs text-text-secondary capitalize">{source.type}</p>
          </div>
        </div>
        <div className="relative">
          <div
            className={cn('flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border', getStatusColor(source.status))}
            onMouseEnter={() => source.status === 'error' && setShowErrorTooltip(true)}
            onMouseLeave={() => setShowErrorTooltip(false)}
          >
            {getStatusIcon(source.status)}
            <span className="capitalize">{source.status}</span>
          </div>
          {showErrorTooltip && source.errorMessage && (
            <div className="absolute top-full right-0 mt-2 w-64 bg-elevated border border-border rounded-lg shadow-lg p-3 z-10 animate-fade-in">
              <div className="flex items-start gap-2">
                <AlertCircle size={14} className="text-danger flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-danger mb-1">Error Details</p>
                  <p className="text-xs text-text-secondary">{source.errorMessage}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="p-2 bg-elevated rounded-lg">
          <p className="text-xs text-text-secondary">Last Sync</p>
          <p className="text-sm font-medium">{formatRelativeTime(source.lastSync)}</p>
        </div>
        <div className="p-2 bg-elevated rounded-lg">
          <p className="text-xs text-text-secondary">Items</p>
          <p className="text-sm font-medium">{source.itemsCount.toLocaleString()}</p>
        </div>
      </div>

      {source.lastSyncJobId && source.lastSyncStatus && onViewSyncJob && (
        <div className="mb-4 p-2 bg-elevated rounded-lg">
          <p className="text-xs text-text-secondary mb-1.5">Last Sync Pipeline</p>
          <button
            onClick={() => onViewSyncJob(source.lastSyncJobId!)}
            className="flex items-center gap-2 text-sm hover:opacity-80 transition-opacity"
          >
            <span className={cn('flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border', getSyncStatusColor(source.lastSyncStatus))}>
              {getSyncStatusIcon(source.lastSyncStatus)}
              <span className="capitalize">{source.lastSyncStatus}</span>
            </span>
            <ExternalLink size={12} className="text-text-secondary" />
          </button>
        </div>
      )}

      <div className="mb-4">
        <p className="text-xs text-text-secondary mb-1.5">Permissions</p>
        <div className="flex flex-wrap gap-1">
          {source.permissions.length > 0 ? (
            source.permissions.map((perm) => (
              <span key={perm} className="px-2 py-0.5 text-xs bg-elevated rounded-full text-text-secondary">
                {perm}
              </span>
            ))
          ) : (
            <span className="text-xs text-text-secondary">Click "Test" to verify</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onOpenSyncModal(source.id)}
          disabled={isSyncing || source.status === 'error'}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
            isSyncing
              ? 'bg-info/10 text-info'
              : source.status === 'error'
              ? 'bg-elevated text-text-secondary cursor-not-allowed'
              : 'bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20'
          )}
        >
          <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
          {isSyncing ? 'Syncing...' : 'Sync'}
        </button>
        <button
          onClick={() => onEdit(source)}
          className="p-2 hover:bg-elevated rounded-lg transition-colors"
          title="Edit Source"
        >
          <Pencil size={16} className="text-text-secondary" />
        </button>
        <button
          onClick={() => onTest(source.id)}
          className="p-2 hover:bg-elevated rounded-lg transition-colors"
          title="Test Connection"
        >
          <Check size={16} className="text-text-secondary" />
        </button>
        <button
          onClick={() => onDelete(source.id)}
          className="p-2 hover:bg-danger/10 rounded-lg transition-colors group"
          title="Delete Source"
        >
          <Trash2 size={16} className="text-text-secondary group-hover:text-danger" />
        </button>
      </div>
    </div>
  );
}

type AuthMethod = 'select' | 'api' | 'oauth';

export function AddSourceModal({
  isOpen,
  initialType,
  onClose,
  onSubmit,
  oauthConfigStatus,
}: {
  isOpen: boolean;
  initialType?: string;
  onClose: () => void;
  onSubmit: (data: { name: string; type: string; config: Record<string, unknown> }) => void;
  oauthConfigStatus: Record<string, boolean>;
}) {
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<AuthMethod>('select');
  const [token, setToken] = useState('');
  const [repository, setRepository] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [email, setEmail] = useState('');
  const [project, setProject] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedType(initialType || null);
      setAuthMethod('select');
    }
  }, [isOpen, initialType]);

  const resetForm = () => {
    setSelectedType(null);
    setAuthMethod('select');
    setToken('');
    setRepository('');
    setBaseUrl('');
    setEmail('');
    setProject('');
  };

  const handleUploadConnect = () => {
    onSubmit({ name: 'Computer', type: 'upload', config: { authType: 'none' } });
    resetForm();
    onClose();
  };

  if (!isOpen) return null;

  const selectedIntegration = availableIntegrations.find(i => i.type === selectedType);
  const supportsOAuth = selectedIntegration?.supportsOAuth && oauthConfigStatus[selectedType || ''];

  const deriveName = () => {
    if (selectedType === 'github') return repository ? `GitHub - ${repository}` : 'GitHub';
    if (selectedType === 'jira') return project ? `Jira - ${project}` : baseUrl ? `Jira - ${baseUrl.replace(/^https?:\/\//, '')}` : 'Jira';
    if (selectedType === 'confluence') return baseUrl ? `Confluence - ${baseUrl.replace(/^https?:\/\//, '')}` : 'Confluence';
    return selectedIntegration?.name || selectedType || 'Integration';
  };

  const handleOAuthConnect = async () => {
    if (!selectedType) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/sources/oauth/${selectedType}/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirectUri: window.location.origin + '/integrations',
        }),
      });

      if (response.ok) {
        const { authorizationUrl } = await response.json();
        // Redirect to OAuth provider
        window.location.href = authorizationUrl;
      } else {
        const error = await response.json();
        alert(error.message || 'Failed to initiate OAuth');
      }
    } catch (error) {
      alert('Failed to initiate OAuth');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApiSubmit = () => {
    if (!selectedType || !token) return;

    const config: Record<string, unknown> = {
      authType: 'token',
      token,
    };

    if (selectedType === 'github' && repository) {
      config.repository = repository;
    }
    if (['jira', 'confluence'].includes(selectedType)) {
      if (baseUrl) config.baseUrl = baseUrl;
      if (email) config.additionalConfig = { email };
      if (project) config.project = project;
    }

    onSubmit({ name: deriveName(), type: selectedType, config });
    resetForm();
    onClose();
  };

  const renderAuthMethodSelection = () => (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">Choose how to authenticate.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {supportsOAuth && (
          <button
            type="button"
            onClick={() => setAuthMethod('oauth')}
            className={cn('rounded-xl border p-3 text-left transition-colors', authMethod === 'oauth' ? 'border-accent-blue bg-accent-blue/5' : 'border-border hover:bg-elevated')}
          >
            <span className="flex items-center gap-2"><ExternalLink size={15} className="text-accent-blue" /><span className="text-sm font-medium text-text-primary">OAuth</span><span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">Recommended</span></span>
            <span className="mt-1 block text-xs leading-5 text-text-secondary">Sign in with your {selectedIntegration?.name} account. More secure, with automatic token refresh.</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setAuthMethod('api')}
          className={cn('rounded-xl border p-3 text-left transition-colors', authMethod === 'api' ? 'border-accent-blue bg-accent-blue/5' : 'border-border hover:bg-elevated')}
        >
          <span className="flex items-center gap-2"><Key size={15} className="text-warning" /><span className="text-sm font-medium text-text-primary">API token</span></span>
          <span className="mt-1 block text-xs leading-5 text-text-secondary">Use a personal access token or API key you generate manually.</span>
        </button>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-success/20 bg-success/5 p-3 text-sm"><Eye size={16} className="mt-0.5 shrink-0 text-success" /><p className="text-text-secondary"><span className="font-medium text-text-primary">Read-only access.</span> Can read content, but cannot create or edit content in {selectedIntegration?.name}. Provider token scopes may be broader — use a read-only token wherever the provider supports it.</p></div>

      {authMethod === 'oauth' && (
        <button type="button" onClick={handleOAuthConnect} disabled={isLoading} className={primaryClass + ' w-full'}>
          {isLoading ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
          Connect with {selectedIntegration?.name}
        </button>
      )}

      {authMethod === 'api' && renderApiTokenFields()}
    </div>
  );

  const renderApiTokenFields = () => {
    if (!selectedType) return null;

    return (
      <div className="space-y-4 border-t border-border pt-4">
        {selectedType === 'github' && (
          <FieldSection icon={<Key size={15} className="text-warning" />} label="Repository credentials" hint="Create a token with repository read access only. Super QA does not modify repository content.">
            <Field label="Repository (owner/repo)"><input type="text" value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="e.g., acme/web-app" className={fieldClass} /></Field>
            <Field label="Personal access token"><SecretField value={token} onChange={setToken} placeholder="ghp_xxxx..." autoComplete="new-password" /></Field>
          </FieldSection>
        )}

        {(selectedType === 'jira' || selectedType === 'confluence') && (
          <FieldSection icon={<Key size={15} className="text-warning" />} label="Site credentials" hint="Generate at id.atlassian.com → Security → API tokens.">
            <Field label="Base URL"><input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-domain.atlassian.net" className={fieldClass} /></Field>
            <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" className={fieldClass} /></Field>
            <Field label="API token"><SecretField value={token} onChange={setToken} placeholder="Your API token" autoComplete="new-password" /></Field>
            {selectedType === 'jira' && <Field label="Project key (optional)"><input type="text" value={project} onChange={(e) => setProject(e.target.value)} placeholder="e.g., PROJ" className={fieldClass} /></Field>}
          </FieldSection>
        )}

        {!['github', 'jira', 'confluence'].includes(selectedType) && (
          <FieldSection icon={<Key size={15} className="text-warning" />} label="API credentials">
            <Field label="API token"><SecretField value={token} onChange={setToken} placeholder="Your API token" autoComplete="new-password" /></Field>
          </FieldSection>
        )}

        <button type="button" onClick={handleApiSubmit} disabled={!token} className={primaryClass + ' w-full'}>Connect</button>
      </div>
    );
  };

  const close = () => { resetForm(); onClose(); };

  return <ChatDialog title={selectedType ? `Connect ${selectedIntegration?.name}` : 'Add an integration'} onClose={close}>
    {!selectedType ? (
      <div className="space-y-2">
        {availableIntegrations.map((integration) => (
          <button
            key={integration.type}
            type="button"
            onClick={() => setSelectedType(integration.type)}
            className="group flex w-full items-start gap-3 rounded-xl border border-border bg-canvas p-3 text-left transition-colors hover:border-accent-blue/40 hover:bg-accent-blue/5"
          >
            <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white font-bold text-sm', integration.color)}>{integration.type.charAt(0).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-text-primary">{integration.name}</span><Plus size={15} className="text-text-secondary transition-colors group-hover:text-accent-blue" /></span>
              <span className="mt-1 block text-xs leading-5 text-text-secondary">{integration.description}</span>
            </span>
          </button>
        ))}
      </div>
    ) : (
      <div className="space-y-4">
        <button type="button" onClick={() => { setSelectedType(null); setAuthMethod('select'); }} className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary">
          <span aria-hidden="true">←</span>Back to services
        </button>
        {selectedType === 'upload' ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 rounded-xl border border-success/20 bg-success/5 p-3 text-sm"><Eye size={16} className="mt-0.5 shrink-0 text-success" /><p className="text-text-secondary"><span className="font-medium text-text-primary">Upload files after connecting.</span> Once connected, use &ldquo;Add files&rdquo; on this connection to upload text, PDF, or Word documents for the pipeline to analyze.</p></div>
            <button type="button" onClick={handleUploadConnect} className={primaryClass + ' w-full'}>Connect</button>
          </div>
        ) : renderAuthMethodSelection()}
      </div>
    )}
  </ChatDialog>;
}

/**
 * Post-connect entry point for a "Computer" source: mirrors "Add channel"/"Add repository" —
 * the connection itself is created with a single click (AddSourceModal above), and files are
 * attached afterward here, so connecting never blocks on picking files up front.
 */
export function AddFilesModal({
  isOpen,
  sourceId,
  sourceName,
  onClose,
  onDone,
}: {
  isOpen: boolean;
  sourceId: string;
  sourceName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const accepted = Array.from(list).filter(file => UPLOAD_EXTENSIONS.some(extension => file.name.toLowerCase().endsWith(extension)));
    setFiles(current => [...current, ...accepted]);
  };

  const submit = async () => {
    if (!files.length) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      files.forEach(file => form.append('files', file, file.name));
      const response = await fetch(`/api/sources/${sourceId}/files`, { method: 'POST', credentials: 'same-origin', body: form });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message || 'Unable to upload files.'); }
      await fetch(`/api/sources/${sourceId}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({}) });
      setFiles([]);
      onDone();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <ChatDialog title={`Add files to ${sourceName}`} onClose={onClose}>
    <div className="space-y-4">
      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/5 p-3 text-sm text-danger"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error}</div>}
      <FieldSection icon={<Key size={15} className="text-warning" />} label="Files" hint="Supports .txt, .md, .pdf, .doc, and .docx, up to 25MB each.">
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          className="col-span-2 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-canvas p-6 text-center transition-colors hover:border-accent-blue/40 hover:bg-accent-blue/5"
        >
          <input type="file" multiple accept={UPLOAD_ACCEPT} className="hidden" onChange={(e) => addFiles(e.target.files)} />
          <Plus size={20} className="text-text-secondary" />
          <span className="text-sm font-medium text-text-primary">Choose files</span>
          <span className="text-xs text-text-secondary">or drag and drop</span>
        </label>
        {files.length > 0 && (
          <div className="col-span-2 space-y-1">
            {files.map((file, index) => (
              <div key={file.name + index} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-canvas px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{file.name}</span>
                <button type="button" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} className="shrink-0 text-text-secondary hover:text-danger"><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </FieldSection>
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className={secondaryClass}>Cancel</button>
        <button type="button" disabled={!files.length || busy} onClick={() => void submit()} className={primaryClass}>{busy ? 'Uploading…' : 'Upload and analyze'}</button>
      </div>
    </div>
  </ChatDialog>;
}

interface SourceConfig {
  authType?: string;
  baseUrl?: string;
  repository?: string;
  project?: string;
}

interface SourceDetails extends Source {
  config?: SourceConfig;
}

export function EditSourceModal({
  isOpen,
  source,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  source: Source | null;
  onClose: () => void;
  onSubmit: (id: string, data: { syncMode: 'auto' | 'manual'; config?: Record<string, unknown> }) => void;
}) {
  const [syncMode, setSyncMode] = useState<'auto' | 'manual'>('manual');
  const [token, setToken] = useState('');
  const [repository, setRepository] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [email, setEmail] = useState('');
  const [project, setProject] = useState('');
  const [loading, setLoading] = useState(false);
  const [sourceDetails, setSourceDetails] = useState<SourceDetails | null>(null);

  useEffect(() => {
    if (source && isOpen) {
      setSyncMode(source.syncMode);
      // Reset config fields
      setToken('');
      setRepository('');
      setBaseUrl('');
      setEmail('');
      setProject('');

      // Fetch full source details
      const fetchDetails = async () => {
        setLoading(true);
        try {
          const response = await fetch(`${API_BASE}/api/sources/${source.id}`);
          if (response.ok) {
            const details = await response.json();
            setSourceDetails(details);
            if (details.config) {
              setRepository(details.config.repository || '');
              setBaseUrl(details.config.baseUrl || '');
              setProject(details.config.project || '');
            }
          }
        } catch (error) {
          console.error('Failed to fetch source details:', error);
        } finally {
          setLoading(false);
        }
      };
      fetchDetails();
    }
  }, [source, isOpen]);

  if (!isOpen || !source) return null;

  const handleSubmit = () => {
    const config: Record<string, unknown> = {};

    // Only include token if it was changed (not empty)
    if (token) {
      config.token = token;
      config.authType = 'token';
    }

    if (source.type === 'github' && repository) {
      config.repository = repository;
    }

    if (['jira', 'confluence'].includes(source.type)) {
      if (baseUrl) config.baseUrl = baseUrl;
      if (email) config.additionalConfig = { email };
      if (project) config.project = project;
    }

    onSubmit(source.id, {
      syncMode,
      ...(Object.keys(config).length > 0 ? { config } : {})
    });
    onClose();
  };

  const providerLabel = availableIntegrations.find(integration => integration.type === source.type)?.name || source.type;
  return <ChatDialog title={`Edit ${providerLabel} connection`} onClose={onClose} compact>
    {loading ? (
      <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-accent-blue" /></div>
    ) : (
      <div className="space-y-4">

        {source.type === 'github' && (
          <FieldSection icon={<Key size={15} className="text-warning" />} label="Repository credentials" hint="A token is already saved. Leave blank to keep it, or enter a new one to replace it.">
            <Field label="Repository (owner/repo)"><input type="text" value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="e.g., acme/web-app" className={fieldClass} /></Field>
            <Field label="Personal access token"><SecretField value={token} onChange={setToken} placeholder="••••••••••••••••" autoComplete="new-password" /></Field>
          </FieldSection>
        )}

        {(source.type === 'jira' || source.type === 'confluence') && (
          <FieldSection icon={<Key size={15} className="text-warning" />} label="Site credentials" hint="A token is already saved. Leave blank to keep it, or enter a new one to replace it.">
            <Field label="Base URL"><input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-domain.atlassian.net" className={fieldClass} /></Field>
            <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" className={fieldClass} /></Field>
            <Field label="API token"><SecretField value={token} onChange={setToken} placeholder="••••••••••••••••" autoComplete="new-password" /></Field>
            {source.type === 'jira' && <Field label="Project key"><input type="text" value={project} onChange={(e) => setProject(e.target.value)} placeholder="e.g., PROJ" className={fieldClass} /></Field>}
          </FieldSection>
        )}

        {!['github', 'jira', 'confluence'].includes(source.type) && (
          <FieldSection icon={<Key size={15} className="text-warning" />} label="API credentials" hint="A token is already saved. Leave blank to keep it, or enter a new one to replace it.">
            <Field label="API token"><SecretField value={token} onChange={setToken} placeholder="••••••••••••••••" autoComplete="new-password" /></Field>
          </FieldSection>
        )}

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-text-primary">Sync mode</legend>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setSyncMode('manual')} className={cn('rounded-xl border p-3 text-left transition-colors', syncMode === 'manual' ? 'border-accent-blue bg-accent-blue/5' : 'border-border hover:bg-elevated')}>
              <span className="block text-sm font-medium text-text-primary">Manual</span><span className="block text-xs text-text-secondary">Sync on demand</span>
            </button>
            <button type="button" onClick={() => setSyncMode('auto')} className={cn('rounded-xl border p-3 text-left transition-colors', syncMode === 'auto' ? 'border-accent-blue bg-accent-blue/5' : 'border-border hover:bg-elevated')}>
              <span className="block text-sm font-medium text-text-primary">Automatic</span><span className="block text-xs text-text-secondary">Sync periodically</span>
            </button>
          </div>
        </fieldset>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onClose} className={secondaryClass}>Cancel</button>
          <button type="button" onClick={handleSubmit} className={primaryClass}>Save changes</button>
        </div>
      </div>
    )}
  </ChatDialog>;
}

interface PickerRepository {
  fullName: string;
  private: boolean;
  description: string | null;
  updatedAt: string | null;
}

/**
 * Lets the user pick a GitHub repository from the account/token already connected
 * to a source, instead of typing "owner/repo" by hand. Used both to finish the
 * initial OAuth connection (mode "initial") and to attach further repositories to
 * an existing connection later (mode "add").
 */
export function RepositoryPickerModal({
  isOpen,
  sourceId,
  sourceName,
  mode,
  existingRepositories,
  onClose,
  onDone,
}: {
  isOpen: boolean;
  sourceId: string | null;
  sourceName?: string;
  mode: 'initial' | 'add';
  existingRepositories: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [repositories, setRepositories] = useState<PickerRepository[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (!isOpen || !sourceId) return;
    setLoading(true);
    setLoadError('');
    setSelected(null);
    setSaveError('');
    setQuery('');
    fetch(`${API_BASE}/api/sources/${sourceId}/repositories`)
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.message || 'Unable to list repositories.');
        }
        return response.json();
      })
      .then((body: { repositories: PickerRepository[] }) => setRepositories(body.repositories || []))
      .catch((failure) => setLoadError((failure as Error).message))
      .finally(() => setLoading(false));
  }, [isOpen, sourceId]);

  if (!isOpen || !sourceId) return null;

  const alreadyConnected = new Set(existingRepositories);
  const filtered = repositories.filter((repo) => repo.fullName.toLowerCase().includes(query.toLowerCase()));

  const handleConfirm = async () => {
    if (!selected) return;
    setSaving(true);
    setSaveError('');
    try {
      const response =
        mode === 'initial'
          ? await fetch(`${API_BASE}/api/sources/${sourceId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ config: { repository: selected } }),
            })
          : await fetch(`${API_BASE}/api/sources/${sourceId}/repositories`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ repository: selected }),
            });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || 'Unable to save this repository.');
      }
      onDone();
    } catch (failure) {
      setSaveError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return <ChatDialog title={mode === 'initial' ? 'Pick a repository' : 'Add a repository'} onClose={onClose}>
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        {mode === 'initial'
          ? `Choose the repository ${sourceName || 'this connection'} should sync.`
          : `Add another repository using the same ${sourceName || 'connection'} credentials.`}
      </p>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search repositories…" className={fieldClass + ' pl-8'} />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-canvas p-2">
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 size={18} className="animate-spin text-accent-blue" /></div>
        ) : loadError ? (
          <p className="px-2 py-6 text-center text-sm text-danger">{loadError}</p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-text-secondary">No repositories found.</p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((repo) => {
              const taken = alreadyConnected.has(repo.fullName);
              return (
                <li key={repo.fullName}>
                  <button
                    type="button"
                    disabled={taken}
                    onClick={() => setSelected(repo.fullName)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                      taken ? 'cursor-not-allowed opacity-40' : selected === repo.fullName ? 'bg-accent-blue/10 ring-1 ring-accent-blue/25' : 'hover:bg-elevated',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-text-primary">{repo.fullName}</span>
                      {repo.description && <span className="block truncate text-xs text-text-secondary">{repo.description}</span>}
                    </span>
                    {taken ? <span className="shrink-0 text-[11px] font-medium text-text-secondary">Connected</span> : selected === repo.fullName ? <Check size={16} className="shrink-0 text-accent-blue" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {saveError && <p className="text-sm text-danger">{saveError}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className={secondaryClass}>Cancel</button>
        <button type="button" onClick={handleConfirm} disabled={!selected || saving} className={primaryClass}>{saving ? 'Saving…' : mode === 'initial' ? 'Connect repository' : 'Add repository'}</button>
      </div>
    </div>
  </ChatDialog>;
}

interface PickerItem {
  key: string;
  name: string;
}

/**
 * Jira projects and Confluence spaces are both a flat {key, name} list fetched
 * from the same connection's credentials, so one picker covers both — same shape
 * RepositoryPickerModal uses for GitHub, just generic over the resource noun.
 */
function KeyedResourcePickerModal({
  isOpen,
  sourceId,
  sourceName,
  mode,
  resourceLabel,
  listPath,
  addBodyKey,
  existingKeys,
  onClose,
  onDone,
}: {
  isOpen: boolean;
  sourceId: string | null;
  sourceName?: string;
  mode: 'initial' | 'add';
  resourceLabel: 'project' | 'space';
  listPath: 'projects' | 'spaces';
  addBodyKey: 'project' | 'spaceKey';
  existingKeys: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [items, setItems] = useState<PickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (!isOpen || !sourceId) return;
    setLoading(true);
    setLoadError('');
    setSelected(null);
    setSaveError('');
    setQuery('');
    fetch(`${API_BASE}/api/sources/${sourceId}/${listPath}`)
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.message || `Unable to list ${listPath}.`);
        }
        return response.json();
      })
      .then((body: Record<string, PickerItem[]>) => setItems(body[listPath] || []))
      .catch((failure) => setLoadError((failure as Error).message))
      .finally(() => setLoading(false));
  }, [isOpen, sourceId, listPath]);

  if (!isOpen || !sourceId) return null;

  const alreadyConnected = new Set(existingKeys);
  const filtered = items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()) || item.key.toLowerCase().includes(query.toLowerCase()));
  const label = resourceLabel === 'project' ? 'project' : 'space';

  const handleConfirm = async () => {
    if (!selected) return;
    setSaving(true);
    setSaveError('');
    try {
      const response =
        mode === 'initial'
          ? await fetch(`${API_BASE}/api/sources/${sourceId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ config: { [addBodyKey]: selected } }),
            })
          : await fetch(`${API_BASE}/api/sources/${sourceId}/${listPath}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [addBodyKey]: selected }),
            });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || `Unable to save this ${label}.`);
      }
      onDone();
    } catch (failure) {
      setSaveError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return <ChatDialog title={mode === 'initial' ? `Pick a ${label}` : `Add a ${label}`} onClose={onClose}>
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        {mode === 'initial'
          ? `Choose the ${label} ${sourceName || 'this connection'} should sync.`
          : `Add another ${label} using the same ${sourceName || 'connection'} credentials.`}
      </p>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${listPath}…`} className={fieldClass + ' pl-8'} />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-canvas p-2">
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 size={18} className="animate-spin text-accent-blue" /></div>
        ) : loadError ? (
          <p className="px-2 py-6 text-center text-sm text-danger">{loadError}</p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-text-secondary">No {listPath} found.</p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((item) => {
              const taken = alreadyConnected.has(item.key);
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    disabled={taken}
                    onClick={() => setSelected(item.key)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                      taken ? 'cursor-not-allowed opacity-40' : selected === item.key ? 'bg-accent-blue/10 ring-1 ring-accent-blue/25' : 'hover:bg-elevated',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-text-primary">{item.name}</span>
                      <span className="block truncate text-xs text-text-secondary">{item.key}</span>
                    </span>
                    {taken ? <span className="shrink-0 text-[11px] font-medium text-text-secondary">Connected</span> : selected === item.key ? <Check size={16} className="shrink-0 text-accent-blue" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {saveError && <p className="text-sm text-danger">{saveError}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className={secondaryClass}>Cancel</button>
        <button type="button" onClick={handleConfirm} disabled={!selected || saving} className={primaryClass}>{saving ? 'Saving…' : mode === 'initial' ? `Connect ${label}` : `Add ${label}`}</button>
      </div>
    </div>
  </ChatDialog>;
}

export function ProjectPickerModal(props: {
  isOpen: boolean;
  sourceId: string | null;
  sourceName?: string;
  mode: 'initial' | 'add';
  existingProjects: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <KeyedResourcePickerModal
      isOpen={props.isOpen}
      sourceId={props.sourceId}
      sourceName={props.sourceName}
      mode={props.mode}
      resourceLabel="project"
      listPath="projects"
      addBodyKey="project"
      existingKeys={props.existingProjects}
      onClose={props.onClose}
      onDone={props.onDone}
    />
  );
}

export function SpacePickerModal(props: {
  isOpen: boolean;
  sourceId: string | null;
  sourceName?: string;
  mode: 'initial' | 'add';
  existingSpaces: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <KeyedResourcePickerModal
      isOpen={props.isOpen}
      sourceId={props.sourceId}
      sourceName={props.sourceName}
      mode={props.mode}
      resourceLabel="space"
      listPath="spaces"
      addBodyKey="spaceKey"
      existingKeys={props.existingSpaces}
      onClose={props.onClose}
      onDone={props.onDone}
    />
  );
}

interface SourcesPageProps {
  onViewAllJobs?: () => void;
  onViewSyncJob?: (jobId: string) => void;
}

export function SourcesPage({ onViewAllJobs, onViewSyncJob }: SourcesPageProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncModalSourceId, setSyncModalSourceId] = useState<string | undefined>(undefined);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [oauthConfigStatus, setOauthConfigStatus] = useState<Record<string, boolean>>({});

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const fetchSources = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/sources`);
      if (response.ok) {
        const data = await response.json();
        setSources(data);
      }
    } catch (error) {
      console.error('Failed to fetch sources:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOAuthStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/sources/oauth/config/status`);
      if (response.ok) {
        const status = await response.json();
        setOauthConfigStatus(status);
      }
    } catch (error) {
      console.error('Failed to fetch OAuth status:', error);
    }
  }, []);

  useEffect(() => {
    fetchSources();
    fetchOAuthStatus();

    // Check for OAuth callback params
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth_success') === 'true') {
      const sourceName = params.get('source_name');
      showNotification('success', `Successfully connected ${sourceName || 'source'}`);
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
      fetchSources();
    } else if (params.get('error')) {
      showNotification('error', decodeURIComponent(params.get('error') || 'OAuth failed'));
      window.history.replaceState({}, '', window.location.pathname);
    }

    const events = new EventSource(`${API_BASE}/api/sources/events`);
    const onJobUpdate = (event: Event) => {
      const data = JSON.parse((event as MessageEvent).data);
      setSources(current => current.map(source => source.id === data.sourceId
        ? { ...source, lastSyncJobId: data.jobId, lastSyncStatus: data.update?.status || source.lastSyncStatus }
        : source));
    };
    const onSourceUpdate = (event: Event) => {
      const data = JSON.parse((event as MessageEvent).data);
      setSources(current => current.map(source => source.id === data.sourceId ? { ...source, ...data.update } : source));
    };
    events.addEventListener('connected', fetchSources);
    events.addEventListener('job-update', onJobUpdate);
    events.addEventListener('source-update', onSourceUpdate);
    events.onerror = () => { /* EventSource reconnects automatically. */ };
    return () => { events.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - fetchSources and fetchOAuthStatus are stable with empty deps

  const handleCreateSource = async (data: { name: string; type: string; config: Record<string, unknown> }) => {
    try {
      const response = await fetch(`${API_BASE}/api/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        showNotification('success', 'Source created successfully');
        fetchSources();
      } else {
        const error = await response.json();
        showNotification('error', error.message || 'Failed to create source');
      }
    } catch (error) {
      showNotification('error', 'Failed to create source');
    }
  };

  const handleOpenSyncModal = (sourceId?: string) => {
    setSyncModalSourceId(sourceId);
    setShowSyncModal(true);
  };

  const handleCloseSyncModal = () => {
    setShowSyncModal(false);
    setSyncModalSourceId(undefined);
  };

  const handleSync = async (config: SyncConfig) => {
    try {
      // Handle sync for each selected source
      for (const sourceId of config.sourceIds) {
        const payload: any = {
          mode: config.mode,
        };

        // Add intents if provided
        if (config.intents.length > 0) {
          payload.intents = config.intents.map((i) => i.label);
        }

        // Add selected documents if in selective mode
        // These are externalIds from the source, not database IDs
        if (config.mode === 'selective' && config.selectedDocuments) {
          const sourceDocIds = config.selectedDocuments[sourceId] || [];
          if (sourceDocIds.length > 0) {
            payload.externalIds = sourceDocIds; // Use externalIds, not documentIds
          }
        }

        // Add force reprocess flag if provided
        if (config.forceReprocess !== undefined) {
          payload.forceReprocess = config.forceReprocess;
        }
        if (config.forceExtract) {
          payload.forceExtract = true;
        }

        const endpoint = `${API_BASE}/api/sources/${sourceId}/sync`;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const error = await response.json();
          showNotification('error', error.message || `Failed to start sync for source`);
          return;
        }
      }

      showNotification(
        'success',
        `Sync started for ${config.sourceIds.length} source${config.sourceIds.length > 1 ? 's' : ''}`
      );
      fetchSources();
    } catch (error) {
      showNotification('error', 'Failed to start sync');
    }
  };

  const handleTest = async (id: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/sources/${id}/test`, {
        method: 'POST',
      });

      const result = await response.json();
      if (result.success) {
        showNotification('success', result.message || 'Connection successful');
        fetchSources();
      } else {
        showNotification('error', result.message || 'Connection failed');
      }
    } catch (error) {
      showNotification('error', 'Failed to test connection');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this source? All associated documents will be removed.')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/sources/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        showNotification('success', 'Source deleted');
        fetchSources();
      } else {
        showNotification('error', 'Failed to delete source');
      }
    } catch (error) {
      showNotification('error', 'Failed to delete source');
    }
  };

  const handleSyncAll = () => {
    // Open sync modal with all sources pre-selected
    setSyncModalSourceId(undefined);
    setShowSyncModal(true);
  };

  const handleEdit = (source: Source) => {
    setEditingSource(source);
    setShowEditModal(true);
  };

  const handleUpdateSource = async (id: string, data: { syncMode: 'auto' | 'manual'; config?: Record<string, unknown> }) => {
    try {
      const response = await fetch(`${API_BASE}/api/sources/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        showNotification('success', 'Source updated successfully');
        fetchSources();
      } else {
        const error = await response.json();
        showNotification('error', error.message || 'Failed to update source');
      }
    } catch (error) {
      showNotification('error', 'Failed to update source');
    }
  };

  const filteredSources = sources.filter(
    (source) =>
      source.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      source.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent-blue" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Notification */}
      {notification && (
        <div className={cn(
          'fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm font-medium animate-fade-in',
          notification.type === 'success' ? 'bg-success text-white' : 'bg-danger text-white'
        )}>
          {notification.message}
        </div>
      )}

      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold">Knowledge Sources</h1>
            <p className="mt-1 text-sm leading-5 text-text-secondary">Connect and manage your knowledge sources</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSyncAll}
              className="px-4 py-2 bg-accent-blue/10 text-accent-blue rounded-lg text-sm font-medium hover:bg-accent-blue/20 transition-colors flex items-center gap-2 border border-accent-blue/20"
            >
              <Play size={16} />
              Run Sync
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/90 transition-colors flex items-center gap-2"
            >
              <Plus size={16} />
              Add Source
            </button>
            <button
              onClick={onViewAllJobs}
              className="px-4 py-2 bg-elevated text-text-primary rounded-lg text-sm font-medium hover:bg-border transition-colors flex items-center gap-2"
            >
              <Activity size={16} />
              Sync Pipelines
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            placeholder="Search sources..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue transition-colors"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {/* Connected Sources */}
        <div className="mb-8">
          <h2 className="text-lg font-medium mb-4">Connected Sources ({filteredSources.length})</h2>
          {filteredSources.length > 0 ? (
            <div className="grid grid-cols-3 gap-4">
              {filteredSources.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source}
                  onOpenSyncModal={handleOpenSyncModal}
                  onDelete={handleDelete}
                  onTest={handleTest}
                  onEdit={handleEdit}
                  onViewSyncJob={onViewSyncJob}
                />
              ))}
            </div>
          ) : (
            <div className="bg-surface border border-border rounded-xl p-8 text-center">
              <p className="text-text-secondary mb-4">No sources connected yet</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/90 transition-colors"
              >
                Add Your First Source
              </button>
            </div>
          )}
        </div>


      </div>

      {/* Add Source Modal */}
      <AddSourceModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleCreateSource}
        oauthConfigStatus={oauthConfigStatus}
      />

      {/* Edit Source Modal */}
      <EditSourceModal
        isOpen={showEditModal}
        source={editingSource}
        onClose={() => { setShowEditModal(false); setEditingSource(null); }}
        onSubmit={handleUpdateSource}
      />

      {/* Sync Modal */}
      <SyncModal
        isOpen={showSyncModal}
        onClose={handleCloseSyncModal}
        sources={sources.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          itemsCount: s.itemsCount,
        }))}
        preSelectedSourceId={syncModalSourceId}
        onSync={handleSync}
      />
    </div>
  );
}
