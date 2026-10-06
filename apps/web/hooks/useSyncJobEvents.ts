import { useEffect, useRef } from 'react';

interface SyncJobEvent {
  type: 'job-update' | 'log-update' | 'heartbeat' | 'connected';
  jobId?: string;
  sourceId?: string;
  update?: any;
  log?: any;
  clientId?: string;
  timestamp?: string;
}

interface UseSyncJobEventsProps {
  onJobUpdate: (event: { jobId: string; sourceId: string; data: any }) => void;
  onLogUpdate: (event: { jobId: string; sourceId: string; log: any }) => void;
  onError: () => void;
  onConnected?: () => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export function useSyncJobEvents({ onJobUpdate, onLogUpdate, onError, onConnected }: UseSyncJobEventsProps) {
  const callbacks = useRef({ onJobUpdate, onLogUpdate, onError, onConnected });

  useEffect(() => {
    callbacks.current = { onJobUpdate, onLogUpdate, onError, onConnected };
  }, [onJobUpdate, onLogUpdate, onError, onConnected]);

  useEffect(() => {
    // Generate unique client ID
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create EventSource connection
    const eventSource = new EventSource(`${API_BASE}/api/sources/events?clientId=${clientId}`);

    let isConnected = false;
    let heartbeatTimeout: NodeJS.Timeout | null = null;

    // Reset heartbeat timeout
    const resetHeartbeat = () => {
      if (heartbeatTimeout) {
        clearTimeout(heartbeatTimeout);
      }
      // If no heartbeat for 60 seconds, consider connection dead
      heartbeatTimeout = setTimeout(() => {
        console.warn('[SSE] Heartbeat timeout - connection may be dead');
      }, 60000);
    };

    // Handle connection success
    eventSource.addEventListener('connected', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[SSE] Connected:', data.clientId);
        isConnected = true;
        resetHeartbeat();
        callbacks.current.onConnected?.();
      } catch (error) {
        console.error('[SSE] Error parsing connected event:', error);
      }
    });

    // Handle job update events
    eventSource.addEventListener('job-update', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.jobId && data.sourceId && data.update) {
          callbacks.current.onJobUpdate({
            jobId: data.jobId,
            sourceId: data.sourceId,
            data: data.update,
          });
        }
        resetHeartbeat();
      } catch (error) {
        console.error('[SSE] Error parsing job-update event:', error);
      }
    });

    // Handle log update events
    eventSource.addEventListener('log-update', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.jobId && data.sourceId && data.log) {
          callbacks.current.onLogUpdate({
            jobId: data.jobId,
            sourceId: data.sourceId,
            log: data.log,
          });
        }
        resetHeartbeat();
      } catch (error) {
        console.error('[SSE] Error parsing log-update event:', error);
      }
    });

    // Handle heartbeat events
    eventSource.addEventListener('heartbeat', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.debug('[SSE] Heartbeat received:', data.timestamp);
        resetHeartbeat();
      } catch (error) {
        console.error('[SSE] Error parsing heartbeat event:', error);
      }
    });

    // Handle connection open
    eventSource.onopen = () => {
      console.log('[SSE] Connection opened');
    };

    // Handle errors
    eventSource.onerror = (error) => {
      console.error('[SSE] Connection error:', error);

      // Check if it's a connection failure vs just a retry
      if (eventSource.readyState === EventSource.CLOSED) {
        console.error('[SSE] Connection closed permanently');
        isConnected = false;
        callbacks.current.onError();
      } else if (eventSource.readyState === EventSource.CONNECTING) {
        console.warn('[SSE] Reconnecting...');
      }
    };

    // Cleanup on unmount
    return () => {
      console.log('[SSE] Closing connection');
      if (heartbeatTimeout) {
        clearTimeout(heartbeatTimeout);
      }
      eventSource.close();
    };
  }, []);
}
