'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { Source } from '@/lib/types';
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
} from 'lucide-react';

const API_BASE = 'http://localhost:4000';

const availableIntegrations = [
  { type: 'github', name: 'GitHub', description: 'Connect repositories and PRs', color: 'bg-gray-800', supportsOAuth: true },
  { type: 'jira', name: 'Jira', description: 'Sync issues and requirements', color: 'bg-blue-600', supportsOAuth: true },
  { type: 'confluence', name: 'Confluence', description: 'Import documentation', color: 'bg-blue-500', supportsOAuth: true },
  { type: 'notion', name: 'Notion', description: 'Sync knowledge bases', color: 'bg-gray-700', supportsOAuth: false },
  { type: 'zephyr', name: 'Zephyr Scale', description: 'Import test cases', color: 'bg-teal-600', supportsOAuth: false },
  { type: 'azure', name: 'Azure DevOps', description: 'Connect work items', color: 'bg-blue-700', supportsOAuth: false },
  { type: 'gitlab', name: 'GitLab', description: 'Connect repositories', color: 'bg-orange-600', supportsOAuth: false },
  { type: 'postman', name: 'Postman', description: 'Import API collections', color: 'bg-orange-500', supportsOAuth: false },
  { type: 'swagger', name: 'OpenAPI/Swagger', description: 'Import API specs', color: 'bg-green-600', supportsOAuth: false },
  { type: 'database', name: 'Database', description: 'Direct database connection', color: 'bg-purple-600', supportsOAuth: false },
];

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

function SourceCard({ source, onSync, onDelete, onTest, onEdit }: {
  source: Source;
  onSync: (id: string) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  onEdit: (source: Source) => void;
}) {
  const [isSyncing, setIsSyncing] = useState(source.status === 'syncing');

  useEffect(() => {
    setIsSyncing(source.status === 'syncing');
  }, [source.status]);

  const handleSync = async () => {
    setIsSyncing(true);
    await onSync(source.id);
  };

  const integration = availableIntegrations.find((i) => i.type === source.type);

  return (
    <div className="bg-surface border border-border rounded-xl p-4 hover:border-text-secondary transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm', integration?.color || 'bg-gray-600')}>
            {source.type.charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 className="font-medium text-sm">{source.name}</h3>
            <p className="text-xs text-text-secondary capitalize">{source.type}</p>
          </div>
        </div>
        <div className={cn('flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border', getStatusColor(source.status))}>
          {getStatusIcon(source.status)}
          <span className="capitalize">{source.status}</span>
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
          onClick={handleSync}
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
          {isSyncing ? 'Syncing...' : 'Sync Now'}
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

function AddSourceModal({
  isOpen,
  onClose,
  onSubmit,
  oauthConfigStatus,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; type: string; config: Record<string, unknown> }) => void;
  oauthConfigStatus: Record<string, boolean>;
}) {
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<AuthMethod>('select');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [repository, setRepository] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [email, setEmail] = useState('');
  const [project, setProject] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const resetForm = () => {
    setSelectedType(null);
    setAuthMethod('select');
    setName('');
    setToken('');
    setRepository('');
    setBaseUrl('');
    setEmail('');
    setProject('');
  };

  if (!isOpen) return null;

  const selectedIntegration = availableIntegrations.find(i => i.type === selectedType);
  const supportsOAuth = selectedIntegration?.supportsOAuth && oauthConfigStatus[selectedType || ''];

  const handleOAuthConnect = async () => {
    if (!selectedType || !name) return;

    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/sources/oauth/${selectedType}/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceName: name,
          redirectUri: window.location.origin + '/sources',
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
    if (!selectedType || !name || !token) return;

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

    onSubmit({ name, type: selectedType, config });
    resetForm();
    onClose();
  };

  const renderAuthMethodSelection = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm text-text-secondary mb-1">Source Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`My ${selectedIntegration?.name} Source`}
          className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
        />
      </div>

      <div className="pt-2">
        <p className="text-sm text-text-secondary mb-3">Choose authentication method:</p>
        <div className="grid grid-cols-2 gap-3">
          {supportsOAuth && (
            <button
              onClick={() => setAuthMethod('oauth')}
              className={cn(
                'p-4 rounded-lg border-2 text-left transition-all',
                authMethod === 'oauth'
                  ? 'border-accent-blue bg-accent-blue/5'
                  : 'border-border hover:border-text-secondary'
              )}
            >
              <div className="flex items-center gap-2 mb-2">
                <ExternalLink size={18} className="text-accent-blue" />
                <span className="font-medium">OAuth</span>
                <span className="text-xs px-1.5 py-0.5 bg-success/10 text-success rounded">Recommended</span>
              </div>
              <p className="text-xs text-text-secondary">
                Sign in with your {selectedIntegration?.name} account. More secure and automatic token refresh.
              </p>
            </button>
          )}
          <button
            onClick={() => setAuthMethod('api')}
            className={cn(
              'p-4 rounded-lg border-2 text-left transition-all',
              authMethod === 'api'
                ? 'border-accent-blue bg-accent-blue/5'
                : 'border-border hover:border-text-secondary'
            )}
          >
            <div className="flex items-center gap-2 mb-2">
              <Key size={18} className="text-warning" />
              <span className="font-medium">API Token</span>
            </div>
            <p className="text-xs text-text-secondary">
              Use a personal access token or API key. You'll need to generate one manually.
            </p>
          </button>
        </div>
      </div>

      {authMethod === 'oauth' && (
        <div className="pt-4">
          <button
            onClick={handleOAuthConnect}
            disabled={!name || isLoading}
            className="w-full px-4 py-3 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <ExternalLink size={16} />
            )}
            Connect with {selectedIntegration?.name}
          </button>
        </div>
      )}

      {authMethod === 'api' && renderApiTokenFields()}
    </div>
  );

  const renderApiTokenFields = () => {
    if (!selectedType) return null;

    return (
      <div className="space-y-4 pt-4 border-t border-border">
        {selectedType === 'github' && (
          <>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Repository (owner/repo)</label>
              <input
                type="text"
                value={repository}
                onChange={(e) => setRepository(e.target.value)}
                placeholder="e.g., acme/web-app"
                className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Personal Access Token</label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_xxxx..."
                className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
              />
              <p className="text-xs text-text-secondary mt-1">
                Generate at GitHub → Settings → Developer settings → Personal access tokens
              </p>
            </div>
          </>
        )}

        {(selectedType === 'jira' || selectedType === 'confluence') && (
          <>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Base URL</label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://your-domain.atlassian.net"
                className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">API Token</label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Your API token"
                className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
              />
              <p className="text-xs text-text-secondary mt-1">
                Generate at id.atlassian.com → Security → API tokens
              </p>
            </div>
            {selectedType === 'jira' && (
              <div>
                <label className="block text-sm text-text-secondary mb-1">Project Key (optional)</label>
                <input
                  type="text"
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  placeholder="e.g., PROJ"
                  className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
                />
              </div>
            )}
          </>
        )}

        {!['github', 'jira', 'confluence'].includes(selectedType) && (
          <div>
            <label className="block text-sm text-text-secondary mb-1">API Token</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Your API token"
              className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
            />
          </div>
        )}

        <button
          onClick={handleApiSubmit}
          disabled={!name || !token}
          className="w-full px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Create Source
        </button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { resetForm(); onClose(); }} />
      <div className="relative w-full max-w-2xl bg-surface border border-border rounded-xl shadow-2xl overflow-hidden animate-fade-in max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-surface z-10">
          <h3 className="text-lg font-medium">
            {selectedType
              ? `Connect ${selectedIntegration?.name}`
              : 'Add Context Source'}
          </h3>
          <button onClick={() => { resetForm(); onClose(); }} className="p-1 hover:bg-elevated rounded transition-colors">
            <X size={18} className="text-text-secondary" />
          </button>
        </div>
        <div className="p-6">
          {!selectedType ? (
            <>
              <p className="text-text-secondary mb-4">Select an integration to connect:</p>
              <div className="grid grid-cols-3 gap-3">
                {availableIntegrations.map((integration) => (
                  <button
                    key={integration.type}
                    onClick={() => setSelectedType(integration.type)}
                    className="flex items-center gap-3 p-3 bg-elevated rounded-lg hover:bg-border transition-colors text-left"
                  >
                    <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm', integration.color)}>
                      {integration.type.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{integration.name}</p>
                      <p className="text-xs text-text-secondary">{integration.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div>
              <button
                onClick={() => { setSelectedType(null); setAuthMethod('select'); }}
                className="text-sm text-text-secondary hover:text-text-primary mb-4 flex items-center gap-1"
              >
                ← Back to integrations
              </button>
              {renderAuthMethodSelection()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
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

function EditSourceModal({
  isOpen,
  source,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  source: Source | null;
  onClose: () => void;
  onSubmit: (id: string, data: { name: string; syncMode: 'auto' | 'manual'; config?: Record<string, unknown> }) => void;
}) {
  const [name, setName] = useState('');
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
      setName(source.name);
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

  const integration = availableIntegrations.find(i => i.type === source.type);

  const handleSubmit = () => {
    if (!name.trim()) return;

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
      name: name.trim(),
      syncMode,
      ...(Object.keys(config).length > 0 ? { config } : {})
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface border border-border rounded-xl shadow-2xl overflow-hidden animate-fade-in max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-surface z-10">
          <div className="flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm', integration?.color || 'bg-gray-600')}>
              {source.type.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="text-lg font-medium">Edit Source</h3>
              <p className="text-xs text-text-secondary capitalize">{source.type}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-elevated rounded transition-colors">
            <X size={18} className="text-text-secondary" />
          </button>
        </div>

        {loading ? (
          <div className="p-12 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-accent-blue" />
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {/* Source Name */}
            <div>
              <label className="block text-sm text-text-secondary mb-1">Source Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
              />
            </div>

            {/* Type-specific fields */}
            {source.type === 'github' && (
              <>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">Repository (owner/repo)</label>
                  <input
                    type="text"
                    value={repository}
                    onChange={(e) => setRepository(e.target.value)}
                    placeholder="e.g., acme/web-app"
                    className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">
                    Personal Access Token
                    <span className="text-xs text-text-secondary ml-2">(leave empty to keep current)</span>
                  </label>
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="ghp_xxxx..."
                    className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
                  />
                </div>
              </>
            )}

            {(source.type === 'jira' || source.type === 'confluence') && (
              <>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">Base URL</label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://your-domain.atlassian.net"
                    className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">
                    API Token
                    <span className="text-xs text-text-secondary ml-2">(leave empty to keep current)</span>
                  </label>
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Your API token"
                    className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
                  />
                </div>
                {source.type === 'jira' && (
                  <div>
                    <label className="block text-sm text-text-secondary mb-1">Project Key</label>
                    <input
                      type="text"
                      value={project}
                      onChange={(e) => setProject(e.target.value)}
                      placeholder="e.g., PROJ"
                      className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
                    />
                  </div>
                )}
              </>
            )}

            {!['github', 'jira', 'confluence'].includes(source.type) && (
              <div>
                <label className="block text-sm text-text-secondary mb-1">
                  API Token
                  <span className="text-xs text-text-secondary ml-2">(leave empty to keep current)</span>
                </label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Your API token"
                  className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
                />
              </div>
            )}

            {/* Sync Mode */}
            <div>
              <label className="block text-sm text-text-secondary mb-2">Sync Mode</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setSyncMode('manual')}
                  className={cn(
                    'p-3 rounded-lg border-2 text-left transition-all',
                    syncMode === 'manual'
                      ? 'border-accent-blue bg-accent-blue/5'
                      : 'border-border hover:border-text-secondary'
                  )}
                >
                  <p className="font-medium text-sm">Manual</p>
                  <p className="text-xs text-text-secondary">Sync on demand</p>
                </button>
                <button
                  onClick={() => setSyncMode('auto')}
                  className={cn(
                    'p-3 rounded-lg border-2 text-left transition-all',
                    syncMode === 'auto'
                      ? 'border-accent-blue bg-accent-blue/5'
                      : 'border-border hover:border-text-secondary'
                  )}
                >
                  <p className="font-medium text-sm">Automatic</p>
                  <p className="text-xs text-text-secondary">Sync periodically</p>
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-2 flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-elevated text-text-primary rounded-lg text-sm font-medium hover:bg-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!name.trim()}
                className="flex-1 px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save Changes
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface SourcesPageProps {
  onViewAllJobs?: () => void;
}

export function SourcesPage({ onViewAllJobs }: SourcesPageProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
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

    // Poll for updates every 5 seconds
    const interval = setInterval(fetchSources, 5000);
    return () => clearInterval(interval);
  }, [fetchSources, fetchOAuthStatus]);

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

  const handleSync = async (id: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/sources/${id}/sync`, {
        method: 'POST',
      });

      if (response.ok) {
        showNotification('success', 'Sync started');
        fetchSources();
      } else {
        const error = await response.json();
        showNotification('error', error.message || 'Failed to start sync');
      }
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

  const handleSyncAll = async () => {
    for (const source of sources) {
      if (source.status !== 'syncing' && source.status !== 'error') {
        await handleSync(source.id);
      }
    }
  };

  const handleEdit = (source: Source) => {
    setEditingSource(source);
    setShowEditModal(true);
  };

  const handleUpdateSource = async (id: string, data: { name: string; syncMode: 'auto' | 'manual'; config?: Record<string, unknown> }) => {
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
            <h1 className="text-2xl font-semibold">Context Sources</h1>
            <p className="text-text-secondary">Connect and manage your knowledge sources</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/90 transition-colors flex items-center gap-2"
            >
              <Plus size={16} />
              Add Source
            </button>
            <button
              onClick={handleSyncAll}
              className="px-4 py-2 bg-elevated text-text-primary rounded-lg text-sm font-medium hover:bg-border transition-colors flex items-center gap-2"
            >
              <RefreshCw size={16} />
              Sync All
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
                  onSync={handleSync}
                  onDelete={handleDelete}
                  onTest={handleTest}
                  onEdit={handleEdit}
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
    </div>
  );
}
