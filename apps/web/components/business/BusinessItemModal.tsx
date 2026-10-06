'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { BusinessItem } from '@/lib/types';
import {
  X,
  CheckCircle2,
  XCircle,
  Trash2,
  ExternalLink,
  Link as LinkIcon,
  Database,
  FileText,
  Quote,
  Clock,
} from 'lucide-react';

const API_URL = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api`;

interface BusinessItemModalProps {
  item: BusinessItem | null;
  onClose: () => void;
  onUpdate?: () => void;
}

export function BusinessItemModal({ item, onClose, onUpdate }: BusinessItemModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  if (!item) return null;

  const handleVerify = async () => {
    if (isUpdating) return;

    try {
      setIsUpdating(true);
      const res = await fetch(`${API_URL}/business/items/${item.id}/verification`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'verified' }),
      });

      if (!res.ok) throw new Error('Failed to verify item');

      onUpdate?.();
      onClose();
    } catch (error) {
      console.error('Error verifying item:', error);
      alert('Failed to verify item');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleReject = async () => {
    if (isUpdating) return;

    try {
      setIsUpdating(true);
      const res = await fetch(`${API_URL}/business/items/${item.id}/verification`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' }),
      });

      if (!res.ok) throw new Error('Failed to reject item');

      onUpdate?.();
      onClose();
    } catch (error) {
      console.error('Error rejecting item:', error);
      alert('Failed to reject item');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (isDeleting) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete this ${item.type}? This action cannot be undone.`,
    );

    if (!confirmed) return;

    try {
      setIsDeleting(true);
      const res = await fetch(`${API_URL}/business/items/${item.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to delete item');

      onUpdate?.();
      onClose();
    } catch (error) {
      console.error('Error deleting item:', error);
      alert('Failed to delete item');
    } finally {
      setIsDeleting(false);
    }
  };

  const confidenceColors = {
    high: 'bg-success/10 text-success border-success/20',
    medium: 'bg-warning/10 text-warning border-warning/20',
    low: 'bg-danger/10 text-danger border-danger/20',
    inferred: 'bg-accent-purple/10 text-accent-purple border-accent-purple/20',
  };

  const verificationColors = {
    verified: 'bg-success/10 text-success border-success/20',
    unverified: 'bg-text-secondary/10 text-text-secondary border-text-secondary/20',
    rejected: 'bg-danger/10 text-danger border-danger/20',
  };

  const validation = item.metadata?.validation;
  const confidenceScore = typeof validation?.score === 'number' ? validation.score : undefined;
  const validationReason = typeof validation?.reason === 'string' ? validation.reason : undefined;
  const evidence: Array<{ quote?: string }> = Array.isArray(item.metadata?.evidence) ? item.metadata.evidence : [];

  return (
    <div className="fixed inset-0 ui-backdrop z-50 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label={item.name} className="ui-dialog-panel max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-border">
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-semibold mb-1">{item.name}</h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
              <span className="capitalize">{item.type.replace('_', ' ')}</span>
              {item.source && (
                <span className="inline-flex items-center gap-1">
                  <Database size={13} />
                  {item.source.name}
                </span>
              )}
              {item.document && (
                item.document.url ? (
                  <a
                    href={item.document.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-accent-blue hover:underline"
                  >
                    <FileText size={13} />
                    {item.document.title}
                    <ExternalLink size={11} />
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <FileText size={13} />
                    {item.document.title}
                  </span>
                )
              )}
              {item.createdAt && (
                <span className="inline-flex items-center gap-1">
                  <Clock size={13} />
                  {new Date(item.createdAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors ml-4"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Status Badges */}
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'px-3 py-1.5 text-sm rounded-full capitalize border',
                confidenceColors[item.confidence],
              )}
            >
              {item.confidence} Confidence
            </span>
            <span
              className={cn(
                'px-3 py-1.5 text-sm rounded-full capitalize border',
                verificationColors[item.verificationStatus || 'unverified'],
              )}
            >
              {item.verificationStatus || 'unverified'}
            </span>
            {confidenceScore !== undefined && (
              <span className="px-3 py-1.5 text-sm rounded-full bg-elevated text-text-secondary border border-border">
                Score: {confidenceScore}/100
              </span>
            )}
          </div>

          {/* Description */}
          {item.description && (
            <div>
              <h3 className="text-sm font-medium mb-2 text-text-secondary">Description</h3>
              <p className="text-base">{item.description}</p>
            </div>
          )}

          {/* Evidence: the exact source text this claim was grounded in */}
          {evidence.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2 text-text-secondary flex items-center gap-2">
                <Quote size={14} />
                Extracted From
              </h3>
              <div className="space-y-2">
                {evidence.map((occurrence, idx) => (
                  occurrence.quote ? (
                    <blockquote
                      key={idx}
                      className="border-l-2 border-accent-blue/40 bg-elevated rounded-r-lg p-3 text-sm whitespace-pre-wrap text-text-secondary"
                    >
                      {occurrence.quote}
                    </blockquote>
                  ) : null
                ))}
              </div>
            </div>
          )}

          {/* Validation Reasoning */}
          {validationReason && (
            <div>
              <h3 className="text-sm font-medium mb-2 text-text-secondary">AI Analysis</h3>
              <div className="bg-elevated border border-border rounded-lg p-3 flex items-start gap-2 text-sm">
                <span className="text-accent-blue mt-0.5">•</span>
                <span>{validationReason}</span>
              </div>
            </div>
          )}

          {/* Content Details */}
          {item.content && Object.keys(item.content).length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2 text-text-secondary">Details</h3>
              <div className="bg-elevated border border-border rounded-lg p-4">
                <pre className="text-sm whitespace-pre-wrap overflow-x-auto">
                  {JSON.stringify(item.content, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* Tags */}
          {item.tags && item.tags.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2 text-text-secondary">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {item.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-3 py-1 text-sm rounded-full bg-elevated border border-border"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Relationships */}
          {(item.outgoingRelationships?.length || item.incomingRelationships?.length) ? (
            <div>
              <h3 className="text-sm font-medium mb-2 text-text-secondary flex items-center gap-2">
                <LinkIcon size={16} />
                Relationships
              </h3>
              <div className="space-y-3">
                {item.outgoingRelationships && item.outgoingRelationships.length > 0 && (
                  <div>
                    <p className="text-xs text-text-secondary mb-2">Outgoing ({item.outgoingRelationships.length})</p>
                    <div className="space-y-2">
                      {item.outgoingRelationships.map((rel: any) => (
                        <div
                          key={rel.id}
                          className="bg-elevated border border-border rounded-lg p-3 text-sm flex items-center justify-between"
                        >
                          <div>
                            <span className="text-accent-blue capitalize">{rel.type.replace('_', ' ')}</span>
                            <span className="text-text-secondary mx-2">→</span>
                            <span>{rel.toItemId}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {item.incomingRelationships && item.incomingRelationships.length > 0 && (
                  <div>
                    <p className="text-xs text-text-secondary mb-2">Incoming ({item.incomingRelationships.length})</p>
                    <div className="space-y-2">
                      {item.incomingRelationships.map((rel: any) => (
                        <div
                          key={rel.id}
                          className="bg-elevated border border-border rounded-lg p-3 text-sm flex items-center justify-between"
                        >
                          <div>
                            <span>{rel.fromItemId}</span>
                            <span className="text-text-secondary mx-2">→</span>
                            <span className="text-accent-blue capitalize">{rel.type.replace('_', ' ')}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* Source & Document */}
          {(item.source || item.document || item.sourceId) && (
            <div>
              <h3 className="text-sm font-medium mb-2 text-text-secondary">Source</h3>
              <div className="bg-elevated border border-border rounded-lg p-3 space-y-2 text-sm">
                {item.source ? (
                  <div className="flex items-center gap-2">
                    <Database size={14} className="text-text-secondary flex-none" />
                    <span className="capitalize text-text-secondary">{item.source.type}</span>
                    <span className="text-text-secondary">·</span>
                    <span>{item.source.name}</span>
                  </div>
                ) : (
                  <p className="text-xs text-text-secondary">Source ID: {item.sourceId}</p>
                )}
                {item.document ? (
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-text-secondary flex-none" />
                    <span className="capitalize text-text-secondary">{item.document.type}</span>
                    <span className="text-text-secondary">·</span>
                    {item.document.url ? (
                      <a
                        href={item.document.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-blue hover:underline inline-flex items-center gap-1 truncate"
                      >
                        {item.document.title}
                        <ExternalLink size={11} className="flex-none" />
                      </a>
                    ) : (
                      <span className="truncate">{item.document.title}</span>
                    )}
                  </div>
                ) : (
                  item.documentId && <p className="text-xs text-text-secondary">Document ID: {item.documentId}</p>
                )}
                {item.externalId && <p className="text-xs text-text-secondary">External ID: {item.externalId}</p>}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between p-6 border-t border-border bg-elevated/50">
          <button
            onClick={handleDelete}
            disabled={isDeleting || isUpdating}
            className="flex items-center gap-2 px-4 py-2 text-danger hover:bg-danger/10 rounded-lg transition-colors disabled:opacity-50"
          >
            <Trash2 size={18} />
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>

          <div className="flex items-center gap-3">
            {item.verificationStatus !== 'rejected' && (
              <button
                onClick={handleReject}
                disabled={isDeleting || isUpdating}
                className="flex items-center gap-2 px-4 py-2 bg-danger/10 text-danger hover:bg-danger/20 rounded-lg transition-colors disabled:opacity-50"
              >
                <XCircle size={18} />
                {isUpdating ? 'Updating...' : 'Reject'}
              </button>
            )}

            {item.verificationStatus !== 'verified' && (
              <button
                onClick={handleVerify}
                disabled={isDeleting || isUpdating}
                className="flex items-center gap-2 px-4 py-2 bg-success/10 text-success hover:bg-success/20 rounded-lg transition-colors disabled:opacity-50"
              >
                <CheckCircle2 size={18} />
                {isUpdating ? 'Updating...' : 'Verify'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
