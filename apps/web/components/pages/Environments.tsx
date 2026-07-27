'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { Environment, EnvironmentVariable } from '@/lib/types';
import {
  Plus,
  Search,
  Server,
  Trash2,
  Edit2,
  Eye,
  EyeOff,
  Copy,
  Check,
  X,
  MoreVertical,
  Star,
  AlertCircle,
  Loader2,
  Key,
} from 'lucide-react';

const API_BASE = 'http://localhost:4000';

const DEFAULT_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
];

function VariableRow({
  variable,
  onUpdate,
  onDelete,
}: {
  variable: EnvironmentVariable;
  onUpdate: (key: string, updates: Partial<EnvironmentVariable>) => void;
  onDelete: (key: string) => void;
}) {
  const [showValue, setShowValue] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editKey, setEditKey] = useState(variable.key);
  const [editValue, setEditValue] = useState(variable.value);

  const handleCopy = () => {
    navigator.clipboard.writeText(variable.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = () => {
    if (editKey.trim()) {
      onUpdate(variable.key, { key: editKey.trim(), value: editValue });
      setEditing(false);
    }
  };

  const handleCancel = () => {
    setEditKey(variable.key);
    setEditValue(variable.value);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 p-2 bg-elevated rounded-lg">
        <input
          type="text"
          value={editKey}
          onChange={(e) => setEditKey(e.target.value)}
          placeholder="KEY"
          className="flex-1 px-2 py-1.5 bg-surface border border-border rounded text-sm font-mono outline-none focus:border-accent-blue"
        />
        <span className="text-text-secondary">=</span>
        <input
          type={variable.isSecret && !showValue ? 'password' : 'text'}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          placeholder="value"
          className="flex-[2] px-2 py-1.5 bg-surface border border-border rounded text-sm font-mono outline-none focus:border-accent-blue"
        />
        <button onClick={handleSave} className="p-1.5 hover:bg-success/10 rounded text-success">
          <Check size={16} />
        </button>
        <button onClick={handleCancel} className="p-1.5 hover:bg-danger/10 rounded text-danger">
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 p-2 bg-elevated rounded-lg group">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {variable.isSecret && <Key size={14} className="text-warning flex-shrink-0" />}
        <span className="font-mono text-sm text-accent-blue truncate">{variable.key}</span>
      </div>
      <span className="text-text-secondary">=</span>
      <div className="flex-[2] font-mono text-sm truncate">
        {variable.isSecret && !showValue ? '••••••••' : variable.value}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {variable.isSecret && (
          <button
            onClick={() => setShowValue(!showValue)}
            className="p-1.5 hover:bg-elevated rounded text-text-secondary hover:text-text-primary"
            title={showValue ? 'Hide value' : 'Show value'}
          >
            {showValue ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
        <button
          onClick={handleCopy}
          className="p-1.5 hover:bg-elevated rounded text-text-secondary hover:text-text-primary"
          title="Copy value"
        >
          {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
        </button>
        <button
          onClick={() => setEditing(true)}
          className="p-1.5 hover:bg-elevated rounded text-text-secondary hover:text-text-primary"
          title="Edit"
        >
          <Edit2 size={14} />
        </button>
        <button
          onClick={() => onDelete(variable.key)}
          className="p-1.5 hover:bg-danger/10 rounded text-text-secondary hover:text-danger"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function AddVariableRow({ onAdd }: { onAdd: (variable: EnvironmentVariable) => void }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [isSecret, setIsSecret] = useState(false);

  const handleAdd = () => {
    if (key.trim()) {
      onAdd({ key: key.trim().toUpperCase(), value, isSecret });
      setKey('');
      setValue('');
      setIsSecret(false);
    }
  };

  return (
    <div className="flex items-center gap-2 p-2 border border-dashed border-border rounded-lg">
      <input
        type="text"
        value={key}
        onChange={(e) => setKey(e.target.value.toUpperCase())}
        placeholder="NEW_KEY"
        className="flex-1 px-2 py-1.5 bg-elevated border border-border rounded text-sm font-mono outline-none focus:border-accent-blue"
        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
      />
      <span className="text-text-secondary">=</span>
      <input
        type={isSecret ? 'password' : 'text'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="value"
        className="flex-[2] px-2 py-1.5 bg-elevated border border-border rounded text-sm font-mono outline-none focus:border-accent-blue"
        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
      />
      <button
        onClick={() => setIsSecret(!isSecret)}
        className={cn(
          'p-1.5 rounded transition-colors',
          isSecret ? 'bg-warning/10 text-warning' : 'hover:bg-elevated text-text-secondary'
        )}
        title={isSecret ? 'Secret (encrypted)' : 'Mark as secret'}
      >
        <Key size={16} />
      </button>
      <button
        onClick={handleAdd}
        disabled={!key.trim()}
        className="p-1.5 bg-accent-blue text-white rounded hover:bg-accent-blue/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

function EnvironmentCard({
  env,
  onUpdate,
  onDelete,
  onSetDefault,
}: {
  env: Environment;
  onUpdate: (id: string, updates: Partial<Environment>) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(env.name);
  const [showMenu, setShowMenu] = useState(false);

  const handleUpdateVariable = (key: string, updates: Partial<EnvironmentVariable>) => {
    const newVariables = env.variables.map((v) =>
      v.key === key ? { ...v, ...updates } : v
    );
    // If key changed, check for the old key
    if (updates.key && updates.key !== key) {
      const idx = newVariables.findIndex((v) => v.key === key);
      if (idx >= 0) {
        newVariables[idx] = { ...newVariables[idx], ...updates };
      }
    }
    onUpdate(env.id, { variables: newVariables });
  };

  const handleDeleteVariable = (key: string) => {
    onUpdate(env.id, { variables: env.variables.filter((v) => v.key !== key) });
  };

  const handleAddVariable = (variable: EnvironmentVariable) => {
    // Check if key already exists
    if (env.variables.some((v) => v.key === variable.key)) {
      alert(`Variable ${variable.key} already exists`);
      return;
    }
    onUpdate(env.id, { variables: [...env.variables, variable] });
  };

  const handleSaveName = () => {
    if (name.trim()) {
      onUpdate(env.id, { name: name.trim() });
      setEditingName(false);
    }
  };

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: env.color + '20' }}
          >
            <Server size={20} style={{ color: env.color }} />
          </div>
          <div>
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="px-2 py-1 bg-elevated border border-border rounded text-sm font-medium outline-none focus:border-accent-blue"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName();
                    if (e.key === 'Escape') {
                      setName(env.name);
                      setEditingName(false);
                    }
                  }}
                />
                <button onClick={handleSaveName} className="p-1 text-success">
                  <Check size={14} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h3 className="font-medium">{env.name}</h3>
                {env.isDefault && (
                  <span className="px-1.5 py-0.5 text-xs bg-warning/10 text-warning rounded-full flex items-center gap-1">
                    <Star size={10} /> Default
                  </span>
                )}
              </div>
            )}
            <p className="text-xs text-text-secondary">{env.variables.length} variables</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="px-3 py-1.5 text-sm bg-elevated hover:bg-border rounded-lg transition-colors"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 hover:bg-elevated rounded-lg transition-colors"
            >
              <MoreVertical size={16} className="text-text-secondary" />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-border rounded-lg shadow-lg z-50 py-1">
                  <button
                    onClick={() => {
                      setEditingName(true);
                      setShowMenu(false);
                    }}
                    className="w-full px-3 py-2 text-sm text-left hover:bg-elevated flex items-center gap-2"
                  >
                    <Edit2 size={14} /> Rename
                  </button>
                  {!env.isDefault && (
                    <button
                      onClick={() => {
                        onSetDefault(env.id);
                        setShowMenu(false);
                      }}
                      className="w-full px-3 py-2 text-sm text-left hover:bg-elevated flex items-center gap-2"
                    >
                      <Star size={14} /> Set as Default
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirm(`Delete environment "${env.name}"?`)) {
                        onDelete(env.id);
                      }
                      setShowMenu(false);
                    }}
                    className="w-full px-3 py-2 text-sm text-left hover:bg-danger/10 text-danger flex items-center gap-2"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Variables */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-border pt-4 space-y-2">
          {env.variables.length === 0 ? (
            <p className="text-sm text-text-secondary text-center py-4">
              No variables yet. Add your first variable below.
            </p>
          ) : (
            env.variables.map((variable) => (
              <VariableRow
                key={variable.key}
                variable={variable}
                onUpdate={handleUpdateVariable}
                onDelete={handleDeleteVariable}
              />
            ))
          )}
          <AddVariableRow onAdd={handleAddVariable} />
        </div>
      )}
    </div>
  );
}

function CreateEnvironmentModal({
  isOpen,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: { name: string; description?: string; color: string }) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(DEFAULT_COLORS[0]);

  if (!isOpen) return null;

  const handleCreate = () => {
    if (name.trim()) {
      onCreate({ name: name.trim(), description: description.trim() || undefined, color });
      setName('');
      setDescription('');
      setColor(DEFAULT_COLORS[0]);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface border border-border rounded-xl shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-medium">Create Environment</h3>
          <button onClick={onClose} className="p-1 hover:bg-elevated rounded">
            <X size={18} className="text-text-secondary" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm text-text-secondary mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Production, Staging, Development"
              className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this environment"
              className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-2">Color</label>
            <div className="flex gap-2">
              {DEFAULT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    'w-8 h-8 rounded-lg transition-all',
                    color === c ? 'ring-2 ring-offset-2 ring-offset-surface ring-accent-blue scale-110' : ''
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={!name.trim()}
            className="w-full px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create Environment
          </button>
        </div>
      </div>
    </div>
  );
}

export function EnvironmentsPage() {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const fetchEnvironments = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/environments`);
      if (response.ok) {
        const data = await response.json();
        setEnvironments(data);
      }
    } catch (error) {
      console.error('Failed to fetch environments:', error);
      // Use mock data for now
      setEnvironments([
        {
          id: '1',
          name: 'Development',
          description: 'Local development environment',
          color: '#10B981',
          isDefault: true,
          variables: [
            { key: 'API_URL', value: 'http://localhost:4000', isSecret: false },
            { key: 'DEBUG', value: 'true', isSecret: false },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: '2',
          name: 'Staging',
          description: 'Pre-production testing environment',
          color: '#F59E0B',
          isDefault: false,
          variables: [
            { key: 'API_URL', value: 'https://staging-api.example.com', isSecret: false },
            { key: 'API_KEY', value: 'stg_xxxxxxxxxxxx', isSecret: true },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: '3',
          name: 'Production',
          description: 'Live production environment',
          color: '#EF4444',
          isDefault: false,
          variables: [
            { key: 'API_URL', value: 'https://api.example.com', isSecret: false },
            { key: 'API_KEY', value: 'prod_xxxxxxxxxxxx', isSecret: true },
            { key: 'DATABASE_URL', value: 'postgresql://...', isSecret: true },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEnvironments();
  }, [fetchEnvironments]);

  const handleCreate = async (data: { name: string; description?: string; color: string }) => {
    try {
      const response = await fetch(`${API_BASE}/api/environments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        showNotification('success', 'Environment created');
        fetchEnvironments();
      } else {
        // Fallback: add locally
        const newEnv: Environment = {
          id: Date.now().toString(),
          name: data.name,
          description: data.description || null,
          color: data.color,
          isDefault: environments.length === 0,
          variables: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setEnvironments([...environments, newEnv]);
        showNotification('success', 'Environment created (local)');
      }
    } catch (error) {
      // Fallback: add locally
      const newEnv: Environment = {
        id: Date.now().toString(),
        name: data.name,
        description: data.description || null,
        color: data.color,
        isDefault: environments.length === 0,
        variables: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setEnvironments([...environments, newEnv]);
      showNotification('success', 'Environment created (local)');
    }
  };

  const handleUpdate = async (id: string, updates: Partial<Environment>) => {
    try {
      const response = await fetch(`${API_BASE}/api/environments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (response.ok) {
        fetchEnvironments();
      } else {
        // Fallback: update locally
        setEnvironments(environments.map((env) => (env.id === id ? { ...env, ...updates } : env)));
      }
    } catch (error) {
      // Fallback: update locally
      setEnvironments(environments.map((env) => (env.id === id ? { ...env, ...updates } : env)));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/environments/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        showNotification('success', 'Environment deleted');
        fetchEnvironments();
      } else {
        // Fallback: delete locally
        setEnvironments(environments.filter((env) => env.id !== id));
        showNotification('success', 'Environment deleted (local)');
      }
    } catch (error) {
      // Fallback: delete locally
      setEnvironments(environments.filter((env) => env.id !== id));
      showNotification('success', 'Environment deleted (local)');
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await fetch(`${API_BASE}/api/environments/${id}/default`, { method: 'POST' });
      // Update locally
      setEnvironments(
        environments.map((env) => ({
          ...env,
          isDefault: env.id === id,
        }))
      );
      showNotification('success', 'Default environment updated');
    } catch (error) {
      // Fallback: update locally
      setEnvironments(
        environments.map((env) => ({
          ...env,
          isDefault: env.id === id,
        }))
      );
      showNotification('success', 'Default environment updated (local)');
    }
  };

  const filteredEnvironments = environments.filter(
    (env) =>
      env.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      env.description?.toLowerCase().includes(searchQuery.toLowerCase())
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
        <div
          className={cn(
            'fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm font-medium animate-fade-in',
            notification.type === 'success' ? 'bg-success text-white' : 'bg-danger text-white'
          )}
        >
          {notification.message}
        </div>
      )}

      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold">Environments</h1>
            <p className="text-text-secondary">Manage environment configurations and variables</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/90 transition-colors flex items-center gap-2"
          >
            <Plus size={16} />
            New Environment
          </button>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            placeholder="Search environments..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue transition-colors"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {filteredEnvironments.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl p-12 text-center">
            <Server size={48} className="mx-auto mb-4 text-text-secondary" />
            <h3 className="font-medium mb-2">No environments yet</h3>
            <p className="text-sm text-text-secondary mb-4">
              Create your first environment to manage configuration variables
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/90"
            >
              Create Environment
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredEnvironments.map((env) => (
              <EnvironmentCard
                key={env.id}
                env={env}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onSetDefault={handleSetDefault}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      <CreateEnvironmentModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}
