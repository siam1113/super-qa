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

export interface LiveAgentEvent {
  stepNumber: number;
  phase: string;
  detail: string;
  // Present on exploration's agentic-loop events (see agents/shared/skills/exploration.py's
  // publish_activity) — the mechanical tool call behind this narration line, shown
  // alongside it in the live viewer so the raw detail is visible, not just the prose.
  raw?: { tool: string; arguments: Record<string, unknown> } | null;
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

export interface LiveQuestion {
  questionId: string;
  prompt: string;
}

export interface LiveExecutionState {
  connection: LiveConnectionState;
  status: string;
  testName: string | null;
  steps: LiveStepState[];
  consoleLogs: LiveConsoleLog[];
  networkRequests: LiveNetworkRequest[];
  latestFrame: string | null;
  pendingQuestion: LiveQuestion | null;
  agentLog: LiveAgentEvent[];
  /** Most recent agent event, so the UI can show a live "what it's waiting on right
   * now" indicator. Cleared on every 'step' message (a real action just changed),
   * so a stale status can't linger past whatever it was describing — it reappears
   * within one heartbeat interval if the same wait is still ongoing. */
  agentStatus: (LiveAgentEvent & { receivedAt: number }) | null;
  /** Cooperative stop/pause state, set by request_stop/set_paused on the agents
   * side (see LiveExecutionRegistry) and echoed back here via 'control' messages
   * so every viewer of the same run — not just the one that clicked the button —
   * reflects the current state. */
  stopRequested: boolean;
  paused: boolean;
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

/** Asks a cooperative run (e.g. live exploration) to stop at its next safe
 * checkpoint and keep whatever it already gathered — see LiveExecutionRegistry.
 * request_stop. Unlike cancelExecution, this does not hard-interrupt anything. */
export async function stopExploration(runId: string): Promise<void> {
  const response = await fetch(`${AGENTS_URL}/executions/${runId}/stop`, { method: 'POST' });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail || `Could not stop exploration (${response.status})`);
  }
}

/** Pauses or resumes a cooperative run at its next safe checkpoint. */
export async function pauseExploration(runId: string, paused: boolean): Promise<void> {
  const response = await fetch(`${AGENTS_URL}/executions/${runId}/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paused }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail || `Could not ${paused ? 'pause' : 'resume'} exploration (${response.status})`);
  }
}

/** Answers a run's pending clarifying question (see LiveExecutionRegistry.ask on the
 * agents side). A late answer past the asker's 30s window is a harmless no-op there. */
export async function answerLiveQuestion(runId: string, questionId: string, text: string): Promise<void> {
  const response = await fetch(`${AGENTS_URL}/executions/${runId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionId, text }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail || `Could not send answer (${response.status})`);
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
  pendingQuestion: null,
  agentLog: [],
  agentStatus: null,
  stopRequested: false,
  paused: false,
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
                pendingQuestion: message.pendingQuestion || null,
                agentLog: message.agentLog || [],
                stopRequested: message.stopRequested || false,
                paused: message.paused || false,
              };
            case 'step':
              return { ...previous, steps: message.steps || [], agentStatus: null };
            case 'control':
              return { ...previous, stopRequested: !!message.stopRequested, paused: !!message.paused };
            case 'agent':
              return {
                ...previous,
                agentLog: [...previous.agentLog, message].slice(-300),
                agentStatus: { stepNumber: message.stepNumber, phase: message.phase, detail: message.detail, receivedAt: Date.now() },
              };
            case 'frame':
              return { ...previous, latestFrame: message.dataUrl };
            case 'question':
              return { ...previous, pendingQuestion: { questionId: message.questionId, prompt: message.prompt } };
            case 'question_resolved':
              return { ...previous, pendingQuestion: null };
            case 'console':
              return { ...previous, consoleLogs: [...previous.consoleLogs, message.log].slice(-500) };
            case 'network':
              return { ...previous, networkRequests: [...previous.networkRequests, message.request].slice(-500) };
            case 'status':
              return { ...previous, status: message.status, agentStatus: null };
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
