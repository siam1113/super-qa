'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { useSyncJobEvents } from '@/hooks/useSyncJobEvents';
import type { SyncJob, SyncDescriptions, SyncStageName, SyncJobStatus, SyncJobStage, Source } from '@/lib/types';
import { SyncModal, type SyncConfig } from '../sync';
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
  Play,
} from 'lucide-react';

const API_BASE = 'http://localhost:4000';

// Stage Icons
const stageIcons: Record<SyncStageName, React.ReactNode> = {
  pulling: <Download size={16} />,
  processing: <FileText size={16} />,
  indexing: <Database size={16} />,
  extracting: <Sparkles size={16} />,
  populating: <Activity size={16} />,
};

const stageLargeIcons: Record<SyncStageName, React.ReactNode> = {
  pulling: <Download size={24} />,
  processing: <FileText size={24} />,
  indexing: <Database size={24} />,
  extracting: <Sparkles size={24} />,
  populating: <Activity size={24} />,
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
    case 'skipped':
      return 'border-text-tertiary bg-text-tertiary/5 text-text-tertiary';
    case 'pending':
    default:
      return 'border-text-tertiary bg-text-tertiary/5 text-text-tertiary';
  }
}

function getSyncModeLabel(syncMode?: string, selectedDocumentsCount?: number, forceReprocess?: boolean, forceExtract?: boolean): string | null {
  if (!syncMode) return null;

  const extraction = forceExtract ? ' · force extract' : '';
  if (syncMode === 'selective') {
    const count = selectedDocumentsCount || 0;
    const reprocess = forceReprocess ? ' (forced)' : '';
    return `Selective (${count} doc${count !== 1 ? 's' : ''})${reprocess}${extraction}`;
  }

  return (syncMode === 'incremental' ? 'Incremental' : 'Full') + extraction;
}

function getSyncModeColor(syncMode?: string): string {
  switch (syncMode) {
    case 'selective':
      return 'bg-accent-purple/10 text-accent-purple border-accent-purple/20';
    case 'incremental':
      return 'bg-accent-blue/10 text-accent-blue border-accent-blue/20';
    case 'full':
      return 'bg-warning/10 text-warning border-warning/20';
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

// Fetch real logs from API
async function fetchStageLogs(
  jobId: string,
  sourceId: string,
  stage: SyncStageName,
): Promise<Array<{ timestamp: string; level: 'info' | 'warn' | 'error' | 'debug'; message: string }>> {
  try {
    const response = await fetch(
      `${API_BASE}/api/sources/${sourceId}/jobs/${jobId}/logs?stage=${stage}`
    );
    if (response.ok) {
      const data = await response.json();
      return data.logs || [];
    }
  } catch (error) {
    console.error('Failed to fetch logs:', error);
  }
  return [];
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

// Calculate stage duration
function getStageDuration(stage: SyncJobStage): string {
  if (!stage.startedAt) return '-';

  const start = new Date(stage.startedAt);
  const end = stage.completedAt ? new Date(stage.completedAt) : new Date();
  const diff = end.getTime() - start.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
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
  const [, forceUpdate] = useState({});

  // Update timer every second for running stages
  useEffect(() => {
    const hasRunningStage = job.stages.some(s => s.status === 'running');
    if (!hasRunningStage) return;

    const interval = setInterval(() => {
      forceUpdate({});
    }, 1000);

    return () => clearInterval(interval);
  }, [job.stages]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-medium">Pipeline Progress</h3>
        <div className="flex items-center gap-2">
          {job.syncMode && (
            <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border', getSyncModeColor(job.syncMode))}>
              {getSyncModeLabel(job.syncMode, job.selectedDocumentsCount, job.forceReprocess, job.forceExtract)}
            </div>
          )}
          <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border', getJobStatusColor(job.status))}>
            {getJobStatusIcon(job.status)}
            <span className="capitalize">{job.status}</span>
          </div>
        </div>
      </div>

      {/* Horizontal Pipeline */}
      <div className="relative">
        {/* Stage Nodes with Dotted Connectors */}
        <div className="relative flex items-start justify-between">
          {job.stages.map((stage, index) => (
            <div key={stage.name} className="flex items-center flex-1">
              <div className="relative group">
                <button
                  onClick={() => onStageClick(stage)}
                  className={cn(
                    'flex flex-col items-center gap-2 p-3 rounded-xl transition-all w-32 flex-shrink-0',
                    selectedStage === stage.name
                      ? 'bg-accent-blue/10 ring-2 ring-accent-blue'
                      : stage.status === 'running' && job.currentStage === stage.name
                      ? 'bg-info/10'
                      : 'hover:bg-elevated'
                  )}
                >
                  <div
                    className={cn(
                      'w-16 h-16 rounded-2xl flex items-center justify-center border-2 transition-all relative',
                      getStageStatusColor(stage.status),
                      selectedStage === stage.name && 'scale-110',
                      stage.status === 'running' && job.currentStage === stage.name && 'ring-4 ring-info/30 animate-pulse'
                    )}
                  >
                    {/* Stage icon */}
                    {stageLargeIcons[stage.name]}

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
                    {/* Timer */}
                    {(stage.status === 'running' || stage.status === 'completed') && stage.startedAt && (
                      <p className={cn(
                        "text-xs mt-1 font-mono",
                        stage.status === 'running' ? 'text-info' : 'text-text-secondary'
                      )}>
                        {getStageDuration(stage)}
                      </p>
                    )}
                  </div>
                </button>
              </div>

              {/* Dotted connector (except after last stage) */}
              {index < job.stages.length - 1 && (
                <DottedConnector completed={stage.status === 'completed'} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Knowledge Summary - What was populated */}
      {job.status === 'completed' && contextSummary.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
            <Sparkles size={14} className="text-accent-purple" />
            Knowledge Updated
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
  sourceId,
  logRevision,
}: {
  stage: SyncJobStage | null;
  jobId: string;
  sourceId: string;
  logRevision: number;
}) {
  const [autoScroll, setAutoScroll] = useState(true);
  const [logs, setLogs] = useState<Array<{ timestamp: string; level: 'info' | 'warn' | 'error' | 'debug'; message: string }>>([]);
  const [loading, setLoading] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const prevLogCountRef = useRef<number>(0);
  const prevStageStatusRef = useRef<string>('');

  // Fetch logs when stage changes
  useEffect(() => {
    if (!stage) {
      setLogs([]);
      return;
    }

    // Don't fetch logs for pending or skipped stages
    if (stage.status === 'pending' || stage.status === 'skipped') {
      setLogs([]);
      return;
    }

    const fetchLogs = async () => {
      setLoading(true);
      const fetchedLogs = await fetchStageLogs(jobId, sourceId, stage.name);
      setLogs(fetchedLogs);
      setLoading(false);
    };

    // Fetch logs once when stage changes
    // Real-time updates come from SSE
    fetchLogs();
  }, [stage?.name, stage?.status, jobId, sourceId, logRevision]);

  // Auto-scroll effect - only triggers when logs actually change
  useEffect(() => {
    if (!autoScroll || !logsContainerRef.current || !stage) return;

    const currentLogCount = logs.length;
    const isRunning = stage.status === 'running';
    const statusChanged = prevStageStatusRef.current !== stage.status;

    // Only scroll if:
    // 1. Log count increased (new logs added), OR
    // 2. Stage just started running (status changed to running)
    if (currentLogCount > prevLogCountRef.current || (isRunning && statusChanged)) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
      prevLogCountRef.current = currentLogCount;
    }

    prevStageStatusRef.current = stage.status;
  }, [stage, logs, autoScroll]);

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
    const isPending = stage.status === 'pending';
    return (
      <div className="h-full flex flex-col">
        <div className={cn(
          "flex items-center justify-between px-4 py-2 border-b border-border",
          isPending ? "bg-canvas" : "bg-elevated"
        )}>
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-text-secondary" />
            <span className="text-sm font-medium capitalize">{stage.name} Logs</span>
          </div>
        </div>
        <div className={cn(
          "flex-1 flex items-center justify-center text-text-secondary",
          isPending ? "bg-canvas/50" : "bg-canvas"
        )}>
          <div className="text-center">
            {stage.status === 'skipped' ? (
              <XCircle size={32} className="mx-auto mb-2 opacity-50 text-danger" />
            ) : (
              <Clock size={32} className="mx-auto mb-2 opacity-50 text-text-tertiary" />
            )}
            <p className="text-sm">
              {stage.status === 'skipped'
                ? 'This stage did not run'
                : 'Not started yet'}
            </p>
            <p className="text-xs mt-1 opacity-70">
              {stage.status === 'skipped'
                ? 'The sync was cancelled or failed before this stage could run'
                : 'Waiting for previous stages to complete'}
            </p>
          </div>
        </div>
      </div>
    );
  }

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
        return 'bg-danger/20 text-danger border border-danger/30';
      case 'warn':
        return 'bg-warning/20 text-warning border border-warning/30';
      case 'debug':
        return 'bg-text-secondary/20 text-text-secondary border border-text-secondary/30';
      default:
        return 'bg-accent-blue/20 text-accent-blue border border-accent-blue/30';
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

      {/* Metadata */}
      {stage.metadata && Object.keys(stage.metadata).length > 0 && (
        <div className="px-4 py-3 border-b border-border bg-surface">
          <p className="text-xs font-medium text-text-secondary mb-2">Stage Details</p>
          <div className="flex flex-wrap gap-2">
            {stage.metadata.provider && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-elevated rounded-md text-xs">
                <span className="text-text-secondary">Provider:</span>
                <span className="font-medium text-accent-blue">{stage.metadata.provider}</span>
              </div>
            )}
            {stage.metadata.model && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-elevated rounded-md text-xs">
                <span className="text-text-secondary">Model:</span>
                <span className="font-medium text-accent-purple">{stage.metadata.model}</span>
              </div>
            )}
            {stage.metadata.tool && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-elevated rounded-md text-xs">
                <span className="text-text-secondary">Tool:</span>
                <span className="font-medium text-accent-green">{stage.metadata.tool}</span>
              </div>
            )}
            {stage.metadata.strategy && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-elevated rounded-md text-xs">
                <span className="text-text-secondary">Strategy:</span>
                <span className="font-medium text-accent-orange">{stage.metadata.strategy}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Logs */}
      <div ref={logsContainerRef} className="flex-1 overflow-auto p-4 font-mono text-xs bg-canvas">
        {loading && logs.length === 0 ? (
          <div className="flex items-center gap-2 text-text-secondary">
            <Loader2 size={12} className="animate-spin" />
            <span>Loading logs...</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="text-text-secondary">No logs available for this stage yet</div>
        ) : (
          logs.map((log, index) => (
            <div key={`${log.timestamp}-${index}`} className="flex items-start gap-3 py-1 hover:bg-elevated px-2 -mx-2 rounded">
              <span className="text-text-secondary whitespace-nowrap">
                {new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false })}
              </span>
              <span className={cn('px-1.5 py-0.5 rounded text-[10px] uppercase font-medium', getLevelBadge(log.level))}>
                {log.level}
              </span>
              <span className={getLevelColor(log.level)}>{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface SyncJobsPageProps {
  onNavigateBack?: () => void;
  embedded?: boolean;
}

export function SyncJobsPage({ onNavigateBack, embedded = false }: SyncJobsPageProps) {
  const [logRevision, setLogRevision] = useState(0);
  const selectedSyncJobId = useAppStore((state) => state.selectedSyncJobId);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [descriptions, setDescriptions] = useState<SyncDescriptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<SyncJobStatus | 'all'>('all');
  const [selectedJob, setSelectedJob] = useState<SyncJob | null>(null);
  const [selectedStage, setSelectedStage] = useState<SyncStageName | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [showRunModal, setShowRunModal] = useState(false);

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
      }
    } catch (error) {
      console.error('Failed to fetch sync jobs:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Update selected job when jobs change
  useEffect(() => {
    if (selectedJob && jobs.length > 0) {
      const updated = jobs.find((j) => j.id === selectedJob.id);
      if (updated) {
        setSelectedJob(updated);
      }
    }
  }, [jobs, selectedJob]);

  const fetchSources = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/sources`);
      if (response.ok) {
        const data = await response.json();
        setSources(data);
      }
    } catch (error) {
      console.error('Failed to fetch sources:', error);
    }
  }, []);

  // Initial fetch of jobs and sources on mount
  useEffect(() => {
    fetchJobs();
    fetchSources();
  }, []); // Empty deps - fetch once on mount

  // Keep persisted job state fresh if an SSE update is missed or the connection
  // reconnects while this page is mounted.
  // SSE integration for real-time updates
  useSyncJobEvents({
    onJobUpdate: (event) => {
      // Update jobs array with new data
      setJobs((prevJobs) => {
        const index = prevJobs.findIndex((j) => j.id === event.jobId);
        if (index >= 0) {
          // Merge the update with existing job data
          const updatedJob = { ...prevJobs[index], ...event.data };
          const newJobs = [...prevJobs];
          newJobs[index] = updatedJob;
          return newJobs;
        }
        return prevJobs;
      });
    },
    onLogUpdate: (event) => {
      // Append logs if viewing this job/stage
      if (selectedJob?.id === event.jobId && selectedStage && event.log.stage === selectedStage) {
        setLogRevision(value => value + 1);
      }
    },
    onError: () => {
      showNotification('error', 'Connection lost. Click refresh to reconnect.');
    },
    onConnected: () => { void fetchJobs(); },
  });

  // Auto-select job when navigating from source card
  useEffect(() => {
    if (selectedSyncJobId && jobs.length > 0 && !selectedJob) {
      const job = jobs.find((j) => j.id === selectedSyncJobId);
      if (job) {
        setSelectedJob(job);
        setSelectedStage(job.currentStage || job.stages[0]?.name || null);
      }
    }
  }, [selectedSyncJobId, jobs, selectedJob]);

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

  const handleSync = async (config: SyncConfig) => {
    try {
      for (const sourceId of config.sourceIds) {
        const payload: any = { mode: config.mode };

        if (config.intents.length > 0) {
          payload.intents = config.intents.map((i) => i.label);
        }

        if (config.mode === 'selective' && config.selectedDocuments) {
          const sourceDocIds = config.selectedDocuments[sourceId] || [];
          if (sourceDocIds.length > 0) {
            payload.externalIds = sourceDocIds;
          }
        }

        if (config.forceReprocess !== undefined) {
          payload.forceReprocess = config.forceReprocess;
        }
        if (config.forceExtract) {
          payload.forceExtract = true;
        }

        const response = await fetch(`${API_BASE}/api/sources/${sourceId}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const error = await response.json();
          showNotification('error', error.message || 'Failed to start sync for source');
          return;
        }
      }

      showNotification(
        'success',
        `Sync started for ${config.sourceIds.length} source${config.sourceIds.length > 1 ? 's' : ''}`
      );
      fetchJobs();
    } catch (error) {
      showNotification('error', 'Failed to start sync');
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
      populating: 'Saving extracted items to context database',
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
        <div className="flex flex-wrap items-center gap-3">
          {onNavigateBack && (
            <button
              onClick={onNavigateBack}
              className="p-2 hover:bg-elevated rounded-lg transition-colors"
            >
              <ArrowLeft size={20} className="text-text-secondary" />
            </button>
          )}
          {!embedded && <div className="flex-1">
            <h1 className="text-xl font-semibold">Sync Jobs</h1>
            <p className="mt-1 text-sm leading-5 text-text-secondary">Monitor synchronization pipelines</p>
          </div>}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <div className="relative min-w-[180px] max-w-xs flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input
                type="text"
                placeholder="Search jobs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-border bg-elevated py-1.5 pl-9 pr-3 text-sm outline-none transition-colors focus:border-accent-blue"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as SyncJobStatus | 'all')}
              className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-sm outline-none focus:border-accent-blue"
            >
              <option value="all">All Status</option>
              <option value="running">Running</option>
              <option value="queued">Queued</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm">
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
            onClick={() => setShowRunModal(true)}
            disabled={sources.length === 0}
            className="px-3 py-1.5 text-sm bg-accent-blue text-white rounded-lg transition-colors flex items-center gap-1.5 hover:bg-accent-blue/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={14} />
            Run Job
          </button>
          <button
            onClick={() => fetchJobs()}
            className="p-2 hover:bg-elevated rounded-lg transition-colors"
          >
            <RefreshCw size={18} className="text-text-secondary" />
          </button>
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
                    'w-full px-4 py-3 text-left border-b border-border hover:bg-elevated transition-colors',
                    selectedJob?.id === job.id && 'bg-accent-blue/5 border-l-2 border-l-accent-blue'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{job.sourceName || 'Unknown'}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-xs text-text-secondary">
                          {job.trigger} • {job.id.slice(0, 8)}
                        </p>
                        {job.syncMode && (
                          <div className={cn('flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border', getSyncModeColor(job.syncMode))}>
                            {getSyncModeLabel(job.syncMode, job.selectedDocumentsCount, job.forceReprocess, job.forceExtract)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <div className={cn('flex items-center gap-1 px-2 py-0.5 rounded text-xs', getJobStatusColor(job.status))}>
                        {getJobStatusIcon(job.status, 12)}
                        <span className="capitalize">{job.status}</span>
                      </div>
                      <div className="text-xs text-text-secondary">
                        {formatRelativeTime(job.startedAt || job.createdAt)}
                      </div>
                    </div>
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
                  logRevision={logRevision}
                  stage={selectedStageData}
                  jobId={selectedJob.id}
                  sourceId={selectedJob.sourceId}
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

      <SyncModal
        isOpen={showRunModal}
        onClose={() => setShowRunModal(false)}
        sources={sources}
        onSync={handleSync}
      />
    </div>
  );
}
