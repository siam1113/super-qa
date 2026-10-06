import { useEffect, useRef, useState } from 'react';

export interface LiveActionRecord {
  actionId: string;
  actionType: string;
  selector?: string | null;
  status: string;
  durationMs: number;
  errorMessage?: string | null;
}

export interface LiveStepState {
  stepId: string;
  stepNumber: number;
  description: string;
  stepType: string;
  status: string;
  expectedResult?: string | null;
  actualResult?: string | null;
  actions: LiveActionRecord[];
  durationMs: number;
  errorMessage?: string | null;
}

export interface LiveConsoleLog {
  level: string;
  message: string;
  timestamp: string;
}

export interface LiveNetworkRequest {
  url: string;
  method: string;
  resourceType: string;
  status: number | null;
  timestamp: string;
}

export type LiveConnectionState = 'connecting' | 'open' | 'closed' | 'not-found';

export interface LiveExecutionState {
  connection: LiveConnectionState;
  status: string;
  testName: string | null;
  steps: LiveStepState[];
  consoleLogs: LiveConsoleLog[];
  networkRequests: LiveNetworkRequest[];
  latestFrame: string | null;
}

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL || 'http://localhost:8000';

function wsUrl(runId: string): string {
  return `${AGENTS_URL.replace(/^http/, 'ws')}/executions/${runId}/live`;
}

/** Cancels an in-flight agent-driven run. Talks to the agents runtime directly,
 * same as the live websocket above, rather than proxying through the Nest API. */
export async function cancelExecution(runId: string): Promise<void> {
  const response = await fetch(`${AGENTS_URL}/executions/${runId}/cancel`, { method: 'POST' });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail || `Could not cancel execution (${response.status})`);
  }
}

const initialState: LiveExecutionState = {
  connection: 'connecting',
  status: 'running',
  testName: null,
  steps: [],
  consoleLogs: [],
  networkRequests: [],
  latestFrame: null,
};

export function useLiveExecution(runId: string | null): LiveExecutionState {
  const [state, setState] = useState<LiveExecutionState>(initialState);
  const reconnectAttempt = useRef(0);

  useEffect(() => {
    if (!runId) {
      setState(initialState);
      return;
    }

    setState({ ...initialState, connection: 'connecting' });
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByClient = false;

    const connect = () => {
      socket = new WebSocket(wsUrl(runId));

      socket.onopen = () => {
        reconnectAttempt.current = 0;
        setState(previous => ({ ...previous, connection: 'open' }));
      };

      socket.onmessage = event => {
        let message: any;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        setState(previous => {
          switch (message.type) {
            case 'not_found':
              return { ...previous, connection: 'not-found' };
            case 'backlog':
              return {
                ...previous,
                status: message.status,
                testName: message.testName,
                steps: message.steps || [],
                consoleLogs: message.consoleLogs || [],
                networkRequests: message.networkRequests || [],
                latestFrame: message.latestFrame || previous.latestFrame,
              };
            case 'step':
              return { ...previous, steps: message.steps || [] };
            case 'frame':
              return { ...previous, latestFrame: message.dataUrl };
            case 'console':
              return { ...previous, consoleLogs: [...previous.consoleLogs, message.log].slice(-500) };
            case 'network':
              return { ...previous, networkRequests: [...previous.networkRequests, message.request].slice(-500) };
            case 'status':
              return { ...previous, status: message.status };
            default:
              return previous;
          }
        });
      };

      socket.onclose = () => {
        if (closedByClient) return;
        setState(previous => ({ ...previous, connection: 'closed' }));
        if (reconnectAttempt.current < 5) {
          const delay = Math.min(1000 * 2 ** reconnectAttempt.current, 15000);
          reconnectAttempt.current += 1;
          reconnectTimer = setTimeout(connect, delay);
        }
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      closedByClient = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [runId]);

  return state;
}
