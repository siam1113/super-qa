'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { SyncJob, SyncDescriptions, SyncStageName, SyncJobStatus, SyncJobStage } from '@/lib/types';
import {
  ArrowLeft,
  RefreshCw,
  Search,
  Check,
  X,
  Loader2,
  Clock,
  ChevronRight,
  Download,
  FileText,
  Database,
  Sparkles,
  XCircle,
  Ban,
  Filter,
  Activity,
  Terminal,
  AlertTriangle,
  Info,
  ChevronDown,
  Square,
} from 'lucide-react';

const API_BASE = 'http://localhost:4000';

// Stage Icons
const stageIcons: Record<SyncStageName, React.ReactNode> = {
  pulling: <Download size={16} />,
  processing: <FileText size={16} />,
  indexing: <Database size={16} />,
  extracting: <Sparkles size={16} />,
};

const stageLargeIcons: Record<SyncStageName, React.ReactNode> = {
  pulling: <Download size={24} />,
  processing: <FileText size={24} />,
  indexing: <Database size={24} />,
  extracting: <Sparkles size={24} />,
};

// Status Icons
function getJobStatusIcon(status: SyncJobStatus, size = 14) {
  switch (status) {
    case 'completed':
      return <Check size={size} className="text-success" />;
    case 'running':
      return <Loader2 size={size} className="text-info animate-spin" />;
    case 'failed':
      return <XCircle size={size} className="text-danger" />;
    case 'cancelled':
      return <Ban size={size} className="text-text-secondary" />;
    case 'queued':
    default:
      return <Clock size={size} className="text-warning" />;
  }
}

function getJobStatusColor(status: SyncJobStatus) {
  switch (status) {
    case 'completed':
      return 'bg-success/10 text-success border-success/20';
    case 'running':
      return 'bg-info/10 text-info border-info/20';
    case 'failed':
      return 'bg-danger/10 text-danger border-danger/20';
    case 'cancelled':
      return 'bg-text-secondary/10 text-text-secondary border-text-secondary/20';
    case 'queued':
    default:
      return 'bg-warning/10 text-warning border-warning/20';
  }
}

function getStageStatusColor(status: string) {
  switch (status) {
    case 'completed':
      return 'border-success bg-success/10 text-success';
    case 'running':
      return 'border-info bg-info/10 text-info';
    case 'failed':
      return 'border-danger bg-danger/10 text-danger';
    default:
      return 'border-border bg-elevated text-text-secondary';
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

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return '-';
  const start = new Date(startedAt);
  const end = completedAt ? new Date(completedAt) : new Date();
  const diff = end.getTime() - start.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatDateTime(date: string | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Mock log data for demonstration
function generateMockLogs(stage: SyncJobStage, jobId: string): Array<{ timestamp: string; level: 'info' | 'warn' | 'error' | 'debug'; message: string }> {
  // If the stage never ran (pending or skipped), show no logs
  if (stage.status === 'pending' || stage.status === 'skipped') {
    return [{
      timestamp: new Date().toISOString(),
      level: 'info',
      message: `Stage ${stage.name} has not started yet`,
    }];
  }

  const baseTime = stage.startedAt ? new Date(stage.startedAt) : new Date();
  const logs: Array<{ timestamp: string; level: 'info' | 'warn' | 'error' | 'debug'; message: string }> = [];

  const stageActions: Record<SyncStageName, string[]> = {
    pulling: [
      `Starting ${stage.name} stage for job ${jobId.slice(0, 8)}...`,
      'Authenticating with source API...',
      'Authentication successful',
      'Fetching document list...',
      `Found ${stage.itemsTotal || 0} documents to process`,
      'Downloading documents in batches of 50...',
      `Progress: ${stage.itemsProcessed || 0}/${stage.itemsTotal || 0} documents fetched`,
    ],
    processing: [
      `Starting ${stage.name} stage...`,
      'Initializing document parser...',
      'Processing markdown files...',
      'Processing JSON files...',
      'Extracting metadata from documents...',
      `Progress: ${stage.itemsProcessed || 0}/${stage.itemsTotal || 0} documents processed`,
      'Validating document structure...',
    ],
    indexing: [
      `Starting ${stage.name} stage...`,
      'Connecting to vector database...',
      'Generating embeddings for documents...',
      'Using model: text-embedding-3-small',
      `Creating index entries: ${stage.itemsProcessed || 0}/${stage.itemsTotal || 0}`,
      'Optimizing index performance...',
    ],
    extracting: [
      `Starting ${stage.name} stage...`,
      'Initializing LLM for extraction...',
      'Extracting business rules...',
      'Extracting entities and relationships...',
      'Extracting API specifications...',
      `Extracted ${stage.itemsProcessed || 0} business items`,
      'Linking extracted items to source documents...',
    ],
  };

  const actions = stageActions[stage.name] || [];

  // For failed stages, only show logs up to the failure point
  const logsToShow = stage.status === 'failed'
    ? actions.slice(0, Math.max(1, Math.floor(actions.length * 0.3))) // Show ~30% of logs before failure
    : actions;

  logsToShow.forEach((message, index) => {
    const time = new Date(baseTime.getTime() + index * 2000);
    logs.push({
      timestamp: time.toISOString(),
      level: index === 0 ? 'info' : (Math.random() > 0.9 ? 'warn' : 'info'),
      message,
    });
  });

  if (stage.status === 'failed' && stage.error) {
    logs.push({
      timestamp: new Date(baseTime.getTime() + logsToShow.length * 2000).toISOString(),
      level: 'error',
      message: `Error: ${stage.error}`,
    });
  }

  if (stage.status === 'completed') {
    logs.push({
      timestamp: stage.completedAt || new Date().toISOString(),
      level: 'info',
      message: `Stage ${stage.name} completed successfully`,
    });
  }

  return logs;
}

// Mock extracted context summary for demonstration
function generateContextSummary(stats: { businessItemsExtracted: number } | null): Array<{ type: string; count: number; icon: React.ReactNode }> {
  if (!stats || stats.businessItemsExtracted === 0) return [];

  const total = stats.businessItemsExtracted;
  // Distribute items across different types
  return [
    { type: 'Business Rules', count: Math.floor(total * 0.25), icon: <FileText size={14} /> },
    { type: 'Entities', count: Math.floor(total * 0.20), icon: <Database size={14} /> },
    { type: 'API Endpoints', count: Math.floor(total * 0.15), icon: <Sparkles size={14} /> },
    { type: 'Flows', count: Math.floor(total * 0.15), icon: <Activity size={14} /> },
    { type: 'Requirements', count: Math.floor(total * 0.15), icon: <FileText size={14} /> },
    { type: 'Constraints', count: total - Math.floor(total * 0.90), icon: <AlertTriangle size={14} /> },
  ].filter(item => item.count > 0);
}

// Dotted line connector component
function DottedConnector({ completed }: { completed: boolean }) {
  return (
    <div className="flex-1 flex items-center justify-center gap-1.5 mx-2">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className={cn(
            'w-2 h-2 rounded-full transition-colors',
            completed ? 'bg-success' : 'bg-border'
          )}
        />
      ))}
    </div>
  );
}

// Transition Graph Component
function TransitionGraph({
  job,
  selectedStage,
  onStageClick,
  descriptions,
}: {
  job: SyncJob;
  selectedStage: SyncStageName | null;
  onStageClick: (stage: SyncJobStage) => void;
  descriptions: SyncDescriptions;
}) {
  const contextSummary = generateContextSummary(job.stats);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-medium">Pipeline Progress</h3>
        <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border', getJobStatusColor(job.status))}>
          {getJobStatusIcon(job.status)}
          <span className="capitalize">{job.status}</span>
        </div>
      </div>

      {/* Horizontal Pipeline */}
      <div className="relative">
        {/* Stage Nodes with Dotted Connectors */}
        <div className="relative flex items-start justify-between">
          {job.stages.map((stage, index) => (
            <div key={stage.name} className="flex items-center flex-1">
              <button
                onClick={() => onStageClick(stage)}
                className={cn(
                  'flex flex-col items-center gap-2 p-3 rounded-xl transition-all w-32 flex-shrink-0',
                  selectedStage === stage.name
                    ? 'bg-accent-blue/10 ring-2 ring-accent-blue'
                    : 'hover:bg-elevated'
                )}
              >
                <div
                  className={cn(
                    'w-16 h-16 rounded-2xl flex items-center justify-center border-2 transition-all relative',
                    getStageStatusColor(stage.status),
                    selectedStage === stage.name && 'scale-110'
                  )}
                >
                  {/* Always show the stage icon, with loading overlay if running */}
                  {stageLargeIcons[stage.name]}

                  {/* Overlay for running state */}
                  {stage.status === 'running' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-info/20 rounded-2xl">
                      <Loader2 size={20} className="animate-spin text-info" />
                    </div>
                  )}

                  {/* Completed badge */}
                  {stage.status === 'completed' && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-success rounded-full flex items-center justify-center">
                      <Check size={12} className="text-white" />
                    </div>
                  )}

                  {/* Failed badge */}
                  {stage.status === 'failed' && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-danger rounded-full flex items-center justify-center">
                      <XCircle size={12} className="text-white" />
                    </div>
                  )}
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium capitalize">{stage.name}</p>
                  <p className="text-xs text-text-secondary">
                    {stage.itemsProcessed !== undefined
                      ? `${stage.itemsProcessed}${stage.itemsTotal ? `/${stage.itemsTotal}` : ''}`
                      : '-'}
                  </p>
                </div>
              </button>

              {/* Dotted connector (except after last stage) */}
              {index < job.stages.length - 1 && (
                <DottedConnector completed={stage.status === 'completed'} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Stage Description */}
      {selectedStage && (
        <div className="mt-6 p-4 bg-elevated rounded-lg">
          <div className="flex items-start gap-3">
            <Info size={16} className="text-accent-blue mt-0.5" />
            <div>
              <p className="text-sm font-medium capitalize">{selectedStage} Stage</p>
              <p className="text-sm text-text-secondary mt-1">
                {descriptions.stages[selectedStage]}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Context Summary - What was populated */}
      {job.status === 'completed' && contextSummary.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
            <Sparkles size={14} className="text-accent-purple" />
            Context Populated
          </h4>
          <div className="flex flex-wrap gap-2">
            {contextSummary.map((item) => (
              <div
                key={item.type}
                className="flex items-center gap-2 px-3 py-1.5 bg-elevated rounded-lg text-sm"
              >
                <span className="text-accent-purple">{item.icon}</span>
                <span className="text-text-secondary">{item.type}:</span>
                <span className="font-medium">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      {job.stats && job.status === 'completed' && (
        <div className="grid grid-cols-4 gap-3 mt-6">
          <div className="p-3 bg-elevated rounded-lg text-center">
            <p className="text-xl font-semibold">{job.stats.documentsTotal}</p>
            <p className="text-xs text-text-secondary">Total Docs</p>
          </div>
          <div className="p-3 bg-elevated rounded-lg text-center">
            <p className="text-xl font-semibold text-success">{job.stats.documentsNew}</p>
            <p className="text-xs text-text-secondary">New</p>
          </div>
          <div className="p-3 bg-elevated rounded-lg text-center">
            <p className="text-xl font-semibold text-info">{job.stats.documentsUpdated}</p>
            <p className="text-xs text-text-secondary">Updated</p>
          </div>
          <div className="p-3 bg-elevated rounded-lg text-center">
            <p className="text-xl font-semibold text-accent-purple">{job.stats.businessItemsExtracted}</p>
            <p className="text-xs text-text-secondary">Extracted</p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {job.errorMessage && (
        <div className="mt-6 p-4 bg-danger/10 border border-danger/20 rounded-lg flex items-start gap-3">
          <AlertTriangle size={16} className="text-danger mt-0.5" />
          <div>
            <p className="text-sm font-medium text-danger">Error</p>
            <p className="text-sm text-danger/80 mt-1">{job.errorMessage}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Terminal Logs Component
function TerminalLogs({
  stage,
  jobId,
}: {
  stage: SyncJobStage | null;
  jobId: string;
}) {
  const [autoScroll, setAutoScroll] = useState(true);

  if (!stage) {
    return (
      <div className="h-full flex items-center justify-center text-text-secondary">
        <div className="text-center">
          <Terminal size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">Select a stage to view logs</p>
        </div>
      </div>
    );
  }

  // Show placeholder for stages that haven't run
  if (stage.status === 'pending' || stage.status === 'skipped') {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-elevated">
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-text-secondary" />
            <span className="text-sm font-medium capitalize">{stage.name} Logs</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center text-text-secondary bg-[#0d1117]">
          <div className="text-center">
            <Clock size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              {stage.status === 'skipped'
                ? 'This stage was skipped'
                : 'This stage has not started yet'}
            </p>
            <p className="text-xs mt-1 opacity-70">
              {stage.status === 'skipped'
                ? 'A previous stage failed before this stage could run'
                : 'Waiting for previous stages to complete'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const logs = generateMockLogs(stage, jobId);

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'text-danger';
      case 'warn':
        return 'text-warning';
      case 'debug':
        return 'text-text-secondary';
      default:
        return 'text-text-primary';
    }
  };

  const getLevelBadge = (level: string) => {
    switch (level) {
      case 'error':
        return 'bg-danger/20 text-danger';
      case 'warn':
        return 'bg-warning/20 text-warning';
      case 'debug':
        return 'bg-text-secondary/20 text-text-secondary';
      default:
        return 'bg-info/20 text-info';
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-elevated">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-text-secondary" />
          <span className="text-sm font-medium capitalize">{stage.name} Logs</span>
          {stage.status === 'running' && (
            <span className="flex items-center gap-1 text-xs text-info">
              <span className="w-1.5 h-1.5 rounded-full bg-info animate-pulse" />
              Live
            </span>
          )}
        </div>
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={cn(
            'text-xs px-2 py-1 rounded transition-colors',
            autoScroll ? 'bg-accent-blue/10 text-accent-blue' : 'text-text-secondary hover:bg-elevated'
          )}
        >
          Auto-scroll {autoScroll ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Logs */}
      <div className="flex-1 overflow-auto p-4 font-mono text-xs bg-[#0d1117]">
        {logs.map((log, index) => (
          <div key={index} className="flex items-start gap-3 py-1 hover:bg-white/5 px-2 -mx-2 rounded">
            <span className="text-text-secondary whitespace-nowrap">
              {new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false })}
            </span>
            <span className={cn('px-1.5 py-0.5 rounded text-[10px] uppercase font-medium', getLevelBadge(log.level))}>
              {log.level}
            </span>
            <span className={getLevelColor(log.level)}>{log.message}</span>
          </div>
        ))}
        {stage.status === 'running' && (
          <div className="flex items-center gap-2 py-2 text-text-secondary">
            <Loader2 size={12} className="animate-spin" />
            <span>Processing...</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface SyncJobsPageProps {
  onNavigateBack?: () => void;
}

export function SyncJobsPage({ onNavigateBack }: SyncJobsPageProps) {
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [descriptions, setDescriptions] = useState<SyncDescriptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<SyncJobStatus | 'all'>('all');
  const [selectedJob, setSelectedJob] = useState<SyncJob | null>(null);
  const [selectedStage, setSelectedStage] = useState<SyncStageName | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/sources/jobs/all?limit=50`);
      if (response.ok) {
        const data = await response.json();
        setJobs(data.jobs);
        setTotal(data.total);
        if (data.descriptions) {
          setDescriptions(data.descriptions);
        }
        // Update selected job if it exists
        if (selectedJob) {
          const updated = data.jobs.find((j: SyncJob) => j.id === selectedJob.id);
          if (updated) {
            setSelectedJob(updated);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch sync jobs:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedJob]);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 3000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const handleCancel = async (jobId: string, sourceId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/sources/${sourceId}/jobs/${jobId}/cancel`, {
        method: 'POST',
      });
      if (response.ok) {
        showNotification('success', 'Job cancelled');
        fetchJobs();
      } else {
        showNotification('error', 'Failed to cancel job');
      }
    } catch (error) {
      showNotification('error', 'Failed to cancel job');
    }
  };

  const handleJobClick = (job: SyncJob) => {
    setSelectedJob(job);
    // Auto-select running or first stage
    const runningStage = job.stages.find(s => s.status === 'running');
    setSelectedStage(runningStage?.name || job.stages[0]?.name || null);
  };

  const handleStageClick = (stage: SyncJobStage) => {
    setSelectedStage(stage.name);
  };

  const defaultDescriptions: SyncDescriptions = {
    stages: {
      pulling: 'Fetching documents from the connected source',
      processing: 'Parsing and preparing documents for indexing',
      indexing: 'Creating searchable index and embeddings',
      extracting: 'Extracting business knowledge from content',
    },
    statuses: {
      queued: 'Job is waiting in queue to start',
      running: 'Sync is actively in progress',
      completed: 'Sync finished successfully',
      failed: 'Sync encountered an error and stopped',
      cancelled: 'Sync was manually cancelled',
    },
  };

  // Filter jobs
  const filteredJobs = jobs.filter((job) => {
    const matchesSearch = !searchQuery ||
      job.sourceName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || job.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Stats
  const stats = {
    total: jobs.length,
    running: jobs.filter(j => j.status === 'running').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    failed: jobs.filter(j => j.status === 'failed').length,
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent-blue" />
      </div>
    );
  }

  const selectedStageData = selectedJob?.stages.find(s => s.name === selectedStage) || null;

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
      <div className="p-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-4 mb-4">
          {onNavigateBack && (
            <button
              onClick={onNavigateBack}
              className="p-2 hover:bg-elevated rounded-lg transition-colors"
            >
              <ArrowLeft size={20} className="text-text-secondary" />
            </button>
          )}
          <div className="flex-1">
            <h1 className="text-xl font-semibold">Sync Jobs</h1>
            <p className="text-sm text-text-secondary">Monitor synchronization pipelines</p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-elevated rounded-lg">
              <Activity size={14} className="text-text-secondary" />
              <span>{stats.total}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-info/10 rounded-lg text-info">
              <Loader2 size={14} className="animate-spin" />
              <span>{stats.running}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-success/10 rounded-lg text-success">
              <Check size={14} />
              <span>{stats.completed}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-danger/10 rounded-lg text-danger">
              <XCircle size={14} />
              <span>{stats.failed}</span>
            </div>
          </div>
          <button
            onClick={() => fetchJobs()}
            className="p-2 hover:bg-elevated rounded-lg transition-colors"
          >
            <RefreshCw size={18} className="text-text-secondary" />
          </button>
        </div>

        {/* Search and Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              placeholder="Search jobs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue transition-colors"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as SyncJobStatus | 'all')}
            className="px-3 py-1.5 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue"
          >
            <option value="all">All Status</option>
            <option value="running">Running</option>
            <option value="queued">Queued</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Jobs Table */}
        <div className="w-96 border-r border-border flex flex-col flex-shrink-0">
          {/* Table Header */}
          <div className="px-4 py-2 bg-elevated border-b border-border text-xs text-text-secondary font-medium grid grid-cols-[1fr_80px_60px] gap-2">
            <span>Source</span>
            <span>Status</span>
            <span className="text-right">Time</span>
          </div>

          {/* Table Body */}
          <div className="flex-1 overflow-auto">
            {filteredJobs.length > 0 ? (
              filteredJobs.map((job) => (
                <button
                  key={job.id}
                  onClick={() => handleJobClick(job)}
                  className={cn(
                    'w-full px-4 py-3 grid grid-cols-[1fr_80px_60px] gap-2 items-center text-left border-b border-border hover:bg-elevated transition-colors',
                    selectedJob?.id === job.id && 'bg-accent-blue/5 border-l-2 border-l-accent-blue'
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{job.sourceName || 'Unknown'}</p>
                    <p className="text-xs text-text-secondary truncate">
                      {job.trigger} • {job.id.slice(0, 8)}
                    </p>
                  </div>
                  <div className={cn('flex items-center gap-1 px-2 py-0.5 rounded text-xs w-fit', getJobStatusColor(job.status))}>
                    {getJobStatusIcon(job.status, 12)}
                    <span className="capitalize">{job.status}</span>
                  </div>
                  <div className="text-right text-xs text-text-secondary">
                    {formatRelativeTime(job.startedAt || job.createdAt)}
                  </div>
                </button>
              ))
            ) : (
              <div className="p-8 text-center text-text-secondary">
                <Clock size={24} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">No jobs found</p>
              </div>
            )}
          </div>
        </div>

        {/* Job Detail Panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedJob ? (
            <>
              {/* Job Header */}
              <div className="px-6 py-4 border-b border-border flex items-center justify-between flex-shrink-0">
                <div>
                  <h2 className="font-medium">{selectedJob.sourceName || 'Unknown Source'}</h2>
                  <p className="text-sm text-text-secondary">
                    {selectedJob.trigger} • Started {formatRelativeTime(selectedJob.startedAt)} • Duration: {formatDuration(selectedJob.startedAt, selectedJob.completedAt)}
                  </p>
                </div>
                {(selectedJob.status === 'running' || selectedJob.status === 'queued') && (
                  <button
                    onClick={() => handleCancel(selectedJob.id, selectedJob.sourceId)}
                    className="px-3 py-1.5 text-sm text-danger hover:bg-danger/10 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <Square size={14} />
                    Cancel
                  </button>
                )}
              </div>

              {/* Transition Graph */}
              <div className="border-b border-border flex-shrink-0">
                <TransitionGraph
                  job={selectedJob}
                  selectedStage={selectedStage}
                  onStageClick={handleStageClick}
                  descriptions={descriptions || defaultDescriptions}
                />
              </div>

              {/* Terminal Logs */}
              <div className="flex-1 overflow-hidden">
                <TerminalLogs
                  stage={selectedStageData}
                  jobId={selectedJob.id}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-secondary">
              <div className="text-center">
                <Activity size={48} className="mx-auto mb-4 opacity-30" />
                <p className="font-medium mb-1">Select a job</p>
                <p className="text-sm">Click on a job from the list to view details</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
