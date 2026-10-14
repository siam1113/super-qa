# Agent capabilities and how the chat/voice pipeline actually works

This documents what QAE, AUE and Super QA can *actually* do at runtime — their real,
registered tool lists — and how a request gets from the web/voice UI down to a tool call
and back. Written after a debugging session (2026-10-14) that found several of these
pieces either broken or silently misrepresenting what the agents could do; see "Known
drift and gaps" at the end for what's still inconsistent.

## Two runtimes, not one

The platform is two separate services that must both be running:

- **`apps/api`** (NestJS, port 4000) — the main backend: Postgres-backed REST API for
  tasks, sources, environments, business knowledge, and QA test cases. It also proxies
  chat/voice requests to the agents runtime below; it has no LLM or tool-calling logic
  of its own.
- **`agents/`** (FastAPI + LangGraph, port **8010** by default — see `agents/.env`) —
  the actual agent runtime. Three LangGraph agents (QAE, AUE, Super QA) live here, each
  bound to its own tool list and system prompt, calling back into `apps/api`'s REST API
  to read/write real platform data.

`apps/api` reaches the agents runtime via `AGENTS_API_URL` (`apps/api/.env`); the agents
runtime reaches `apps/api` via `BACKEND_API_URL` (`agents/.env`). Both must point at a
runtime that's actually up — nothing auto-starts the other. Run the agents service
either via `docker compose up -d agents` (added to `docker-compose.yml`) or directly:

```bash
cd agents
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-mcp.txt playwright==1.60.0
python main.py
```

It reads `agents/.env` via `load_dotenv()` on startup — `PORT`, `REDIS_URL`,
`BACKEND_API_URL`, `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`, `AGENT_MEMORY_SIGNING_KEY` (must
match `apps/api`'s copy byte-for-byte, used to HMAC-sign agent memory context passed from
Node to Python). Changing `.env` requires restarting the process; it isn't hot-reloaded.

## What each agent can actually do

The ground truth is each role's `create_*_tools()` function, not any of the hand-written
descriptions elsewhere (see "Known drift" below). As of this doc:

**QAE** (`agents/qae/tools.py::create_qae_tools`) — test strategy, case design, execution:
`retrieve_source_evidence`, `search_knowledge`, `get_platform_stats`, `list_test_cases`,
`get_test_case`, `import_test_cases_to_plan`, plus its structured QA skill-graph tools
(`list_skills`, `run_skill`, `get_skill_run`, `list_workflow_resources`,
`get_execution_job`, `cancel_execution_job` — these back `write_test_cases`,
`execute_test_case(s)`, `generate_report`, `analyze_bug`, `test_user_story` as named
skills, not flat tools).

**AUE** (`agents/shared/tools.py::create_tools("aue")`) — automation/script authoring;
shares the same base platform tools as QAE (`retrieve_source_evidence`, `search_knowledge`,
`get_platform_stats`, `list_test_cases`, `get_test_case`) plus its own skill-graph tools.
AUE has no `aue/tools.py` of its own — it's entirely `shared/tools.py` plus
`shared/skills/tools.py::create_skill_tools("aue")`.

**Super QA** (`agents/superqa/tools.py::create_superqa_tools`) — the platform-wide
orchestrator: task CRUD-lite (`create_task`, `list_tasks`, `start_task`, `complete_task`,
`block_task` — no edit/delete), source sync (`list_sources`, `start_sync`,
`check_sync_status` — no create/delete), environments (`list_environments`,
`create_environment`, `add_environment_variable` — no update/delete, either for the
environment or a variable), test cases (`list_test_cases`, `get_test_case` — read-only;
creating/executing is QAE's job), knowledge search (`search_knowledge`,
`get_platform_stats` — read-only), plus cross-agent delegation: `list_qa_skills` +
`delegate_qa_skill` (one structured skill, blocking) and `start_agent_session` +
`ask_agent` + `read_agent_session` + `list_agent_sessions` (a real, free-form console
conversation with QAE/AUE's own chat endpoint — several can be held open concurrently),
plus role-prefixed `qae_*`/`aue_*` job-status tools (`get_skill_run`,
`list_workflow_resources`, `get_execution_job`, `cancel_execution_job`).

**Important distinction:** `search_knowledge(item_type="test_case")` searches the synced
*business-knowledge* store (flows/rules/requirements extracted from connected sources),
not the real `QaTestCase` table that Plan > Test Cases actually shows. A "test_case"-typed
business item and an actual test case are different rows in different tables. Use
`list_test_cases`/`get_test_case` (backed by `apps/api`'s `/qa/test-cases` endpoints) to
answer "how many test cases do we have" — not `search_knowledge`.

## A text chat turn, end to end

1. UI → `POST /api/agents/{qae|aue|superqa}/chat` on `apps/api`
   (`apps/api/src/modules/agents/agents.controller.ts`).
2. `AgentsService.chat` → `chatWithMemories` → `tryChatWithMemories`
   (`apps/api/src/modules/agents/agents.service.ts`) builds a signed payload (HMAC'd with
   `AGENT_MEMORY_SIGNING_KEY` whenever memories/scope/model-selection/etc. are attached)
   and proxies to `POST {AGENTS_API_URL}/agents/{type}/chat`.
3. In `agents/main.py`, `prepare_chat_turn` validates the signature, resolves/creates a
   Redis-backed session (`sessions.py`), and builds the LangGraph initial state.
4. The role's LangGraph agent (`create_qae_agent`/`create_aue_agent`/`create_superqa_agent`)
   runs: the LLM reasons, calls tools (each tool itself does an HTTP call back to
   `apps/api`'s REST endpoints), and produces a final message.
5. `message_text()` extracts the final reply text. **Watch this one**: in the installed
   `langchain-core` (pulled in by the unpinned `langchain>=0.1.0` in `requirements.txt`),
   `BaseMessage.text` is a *callable method*, not a string property. `message_text` must
   call it (`text()`) when callable, or it stringifies the bound method object itself —
   producing visible garbage like `<bound method BaseMessage.text of AIMessageChunk(...)>`
   instead of the reply.
6. Response flows back through `apps/api`, which persists it to Postgres
   (`AgentSession`/`AgentTask` entities) and returns it to the UI.

**Error handling on the Node side matters**: `tryChatWithMemories` distinguishes three
outcomes — `403`/`422`/`401` from the agents service map to specific exceptions; any other
non-OK status (e.g. a `500` from a bad LLM key or exhausted provider credits) is treated as
a real failure and thrown as `BadGatewayException` with the service's own error detail;
only a genuine network-level failure (connection refused, timeout — the service never
responded at all) returns `null`, which `chatWithMemories` turns into either a
`ServiceUnavailableException` (`NODE_ENV=production`) or a **canned placeholder reply**
(`generateFallbackResponse`, dev-only) — two randomly-picked generic strings per agent type
that ignore the actual question. That fallback exists so local dev doesn't hard-fail when
the Python service isn't running, but it means a genuinely broken agent (bad key, no
credits, code bug) can look identical to a cheerful canned greeting unless it's specifically
a 500+ non-network failure, which now surfaces as a real error instead.

`chatForAutomation` is the sibling method used by voice/meetings: it **always** throws on
failure, in every environment, since a live meeting speaking fabricated canned content
would be actively misleading rather than merely unhelpful.

## A voice/meeting turn, end to end

Live voice uses OpenAI's **Live API** (`gpt-live-1`, WebRTC), not the text-chat endpoint
directly. See `docs/live-meeting-voice.md` for the full feature history; this section is
specifically about how a spoken request reaches a real tool call.

1. `voice.provider.ts::create` opens a server-owned Live session over WebRTC with a
   restricted browser data channel (only `session.close`,
   `session.instructions.append`, `response.cancel`, mute/unmute, and
   `session.commentary.append` are allowed client→server events).
2. `voice.provider.ts::attach` opens a *separate*, server-side control WebSocket
   (`wss://.../live/sessions/{id}/attach`) that `voice.service.ts` uses to observe
   transcript/usage events and handle **delegations**.
3. When the live model decides it needs a backend tool, OpenAI's Live API emits
   `session.delegation.created` — deliberately *without* the actual request/arguments;
   only `{id, type, target}`. The caller must infer what was asked from the ongoing
   transcript itself.
4. `VoiceProvider.attach`'s `resolveDelegation` callback is `VoiceService.delegate`
   (`voice.service.ts`): it pulls the last ~30 flushed + any in-flight transcript
   fragments, formats them as context, and calls `AgentsService.chatForAutomation` for
   the meeting's bound agent (QAE/AUE/Super QA) — a **real, tool-enabled** turn, not a
   shortcut. `canExecute: false` in its workflow scope keeps it read-only/advisory; it does
   not block the read-only tools like `list_test_cases`.
5. That call is raced against `DELEGATION_TIMEOUT_MS` (20s — raised from an original 8s,
   which was cutting off real tool-call turns before they finished and producing a
   misleading "no tools" response even when the tool call would have succeeded).
6. Meanwhile, `attach()` starts a short filler timer (`FILLER_DELAY_MS`, 1.5s): if the
   real answer isn't back yet, it sends an immediate `session.commentary.append` with a
   quick filler ("Let me check on that.") for the same `delegation_id`, so the meeting
   isn't left in dead air. The real answer, once resolved, is sent as a **second** append
   to the same `delegation_id` — the event name itself (`append`, not `set`) implies
   multiple sends per delegation are expected.
7. If `delegate()` throws/times out, or the agent has no `kind`, or there's no transcript
   context to infer from, the result is `DELEGATION_SAFE_FALLBACK` — an honest "no backend
   tools were used" string — sent as the one and only commentary append.

This is genuinely different from text chat in one respect: a voice delegation turn only
gets a single shot within its timeout window; there's no dev-mode canned-reply fallback
path here at all (`chatForAutomation` always throws on failure, and `attach()`'s own catch
produces the explicit "no tools" string, never fabricated content).

## Known drift and gaps (true as of 2026-10-14 — verify before relying on these)

- **Three independent descriptions of "what tools exist," already out of sync:**
  1. `agents/main.py`'s hand-maintained `AGENT_CONFIGS` dict (exposed via
     `GET /agents/config` and `/agents/{type}/config`) — missing Super QA's
     delegation tools (`start_agent_session`/`ask_agent`/`read_agent_session`/
     `list_agent_sessions`, the `qae_*`/`aue_*` job tools) entirely.
  2. The actual tool list each `create_*_tools()` builds — this is ground truth for what
     the LLM can call, and is what this doc describes above.
  3. `apps/api/src/modules/agents/types.ts`'s own separate `tools`/`systemPrompt` fields —
     dead code; `AgentsController.getConfig` never returns `systemPrompt`, and nothing in
     `apps/web` renders it. Harmless, but confusing to read.
  Treat (2) — introspecting the real `create_*_tools()` functions — as authoritative;
  don't trust `/agents/config`'s tool list.
- **System-prompt overclaiming**: `agents/superqa/agent.py`'s `SYSTEM_PROMPT` was found
  claiming environment update/delete and business-item creation that have no backing
  tools; it's been corrected to state actual tool boundaries, but re-check it against the
  real tool list above if either changes.
- **`search_knowledge` vs real test cases**: still a likely confusion point — the tool
  docstrings now say to prefer `list_test_cases`, but nothing stops a model from calling
  `search_knowledge(item_type="test_case")` first and getting an empty/unrelated result.
- **No task edit, no source/environment delete** exposed to any agent, despite
  `apps/api`'s REST API supporting all of it (`DELETE /agents/tasks/:id`,
  `DELETE /sources/:id`, `DELETE /environments/:id`, `DELETE /environments/:id/variables/:key`).
  This is a deliberate current boundary, not a bug — but worth knowing if an agent is asked
  to do one of these and has to say it can't.
- **Voice filler/append behavior is unverified against a real Live call** — it's based on
  reading the event naming convention (`append`) and hasn't been confirmed against an
  actual `MEETING_LIVE_ENABLED=true` session with a real OpenAI key.

## Code map

| Concern | File |
|---|---|
| Node chat proxy, canned fallback, error mapping | `apps/api/src/modules/agents/agents.service.ts` |
| Chat HTTP routes | `apps/api/src/modules/agents/agents.controller.ts` |
| FastAPI entrypoint, session prep, `message_text` | `agents/main.py` |
| QAE tools | `agents/qae/tools.py` |
| AUE/shared platform tools incl. `list_test_cases`/`get_test_case` | `agents/shared/tools.py` |
| Super QA tools | `agents/superqa/tools.py` |
| Super QA system prompt | `agents/superqa/agent.py` |
| Live voice session/control-socket contract | `apps/api/src/modules/chat/voice.provider.ts` |
| Live voice admission, delegation resolution, watchdog | `apps/api/src/modules/chat/voice.service.ts` |
| Meeting creation, agent binding | `apps/api/src/modules/chat/meeting.service.ts` |
| Real `QaTestCase` CRUD (backs `list_test_cases`/`get_test_case`) | `apps/api/src/modules/qa/qa.controller.ts`, `qa.service.ts` |
