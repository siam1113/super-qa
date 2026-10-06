"""Best-effort progress narration for chat streams.

Graph nodes and skill runtimes call this to surface a short "what's happening
now" label on the chat SSE stream. It is a no-op when not running inside a
streamed graph invocation (e.g. a non-streaming /chat call, a background job,
or a unit test), mirroring the existing live_run_started pattern in
qae/harness/orchestrator.py.
"""
from langgraph.config import get_stream_writer


def emit_status(label: str, **extra) -> None:
    try:
        get_stream_writer()({"type": "status", "label": label, **extra})
    except Exception:
        pass
