# Agent memory

Agent memory is durable, workspace-wide information for one QAE or AUE agent. It is distinct from conversation history and searchable Knowledge. Organization members can read memories; only workspace owners can add, edit, archive, restore, or permanently delete them.

## Lifecycle and safeguards

- Owners add memories as preferences, decisions, workflows, or constraints. Agents do not silently write to memory.
- Active entries are retrieved for internal requests by PostgreSQL full-text search. Retrieval is scoped by both project and agent, excludes archived and expired entries, returns at most 12 entries, and caps injected memory text at 6,000 characters. External Slack and Teams conversations do not receive workspace memories.
- Memory text is passed to the agent as untrusted reference data. It cannot override system instructions.
- Each entry has an importance, optional expiry, and version. The system keeps up to 50 revisions per entry and records create, edit, archive, restore, and permanent-delete actions in the project audit log.
- Owners can archive and restore entries. Permanent deletion removes the entry and its revision contents; the audit log retains only the entry ID and action metadata.
- Inputs are limited to 2,000 characters. Common credential and private-key patterns are rejected. Each agent has a limit of 200 saved entries.
- Memory retrieval failure in the direct agent view fails the request visibly rather than substituting a fabricated response.

## Production deployment

Apply the additive schema migration after the organization and chat migrations and before deploying the API version that uses memory:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/20261010-agent-memory.sql
```

Back up the application database using the deployment's normal process. Production uses this migration; do not enable TypeORM synchronization as a substitute.

Set `AGENT_MEMORY_SIGNING_KEY` to the same high-entropy secret of at least 32 characters in the API and Python agents service. The API signs retrieved memory context; the Python service ignores unsigned memory payloads.
