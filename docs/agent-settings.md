# Agent settings

The Skills and Tools settings tabs read `/api/chat/agents/:id/settings`, authenticated and scoped to the current workspace. Nest fetches `/agents/{role}/settings` from the Python runtime. No placeholder capability list or MCP tab is used.

- **Skills** are the role's wired workflow subgraphs, discovered when the agent registers `run_skill`. Each card links to its `toolNames`.
- **Tools used by skills** are executable operation bindings registered beside their implementations. Each operation appears once, with `usedBy` links to all relevant skills. These operations run inside workflow boundaries; they are not exposed as arbitrary conversational calls.
- **Direct agent tools** come from the same tool factories that build the agent. QAE/AUE register `retrieve_source_evidence`, `list_skills`, `run_skill`, `get_skill_run`, `list_workflow_resources`, `get_execution_job`, and `cancel_execution_job`. Super QA retains platform tools and expert delegation.

Settings return explicit relationships and an `access` field (`workflow` or `agent`). The UI does not infer relationships from matching names. For example, `inspect_framework` and `generate_automation` share `read_repository_file`, `scan_repository_files`, and `read_framework_profile`; automation additionally uses `compile_test_source`. Optional browser actions, login, and model drafting are listed as workflow capabilities, not a claim that every invocation uses them.

Model options are discovered from configured providers and cached for 30 seconds. OpenAI candidates are filtered to chat model families; Anthropic uses its paginated model catalog; Ollama includes installed models that report tool support. Catalog access is not a guarantee of remaining quota or successful generation. Discovery failures are shown explicitly. The saved selection remains visible if its provider is temporarily unavailable.

A workspace owner can save a model or return to the workspace default. Selection is stored on that workspace's `chat_agents` record, audited, validated against the current runtime catalog, and passed in the signed agent context. A request-local Python context applies the choice without changing process environment or another agent's model. Explicit choices also apply to organization text conversations. Those conversations require the selected provider's credentials/base URL in the API process as well as the Python runtime. Voice models have their own configuration.

For production, apply `apps/api/migrations/20261015-agent-model-selection.sql` and restart the API and Python runtime. Development TypeORM synchronization creates the nullable JSON column automatically. Configure `AGENTS_API_URL` to point at this repository's runtime; the local environment now uses `http://127.0.0.1:8010` because port 8000 belongs to another project. Provider credentials remain on the server. Existing matching `AGENT_MEMORY_SIGNING_KEY` configuration is required for signed agent requests.

Provider references: [OpenAI model discovery](https://developers.openai.com/api/reference/resources/models/methods/list), [Anthropic model discovery](https://platform.claude.com/docs/en/api/models/list), [Ollama model discovery](https://docs.ollama.com/api/tags).

Local setup has matching context-signing keys and the model selection column. The Skills/Tools refactor changes the conversational and MCP interface: call `list_skills` for a workflow schema, then `run_skill` with its name and inputs. HTTP/CLI workflow IDs and persisted request IDs are unchanged.


The Skills section also shows the latest 30 published workflow results for the authenticated app/agent role. Readiness reports expose per-check status and snapshot expiry; job references show state at report creation. See [Phase 1 foundation](qa-phase-1-foundation.md) for publication and configuration details.
