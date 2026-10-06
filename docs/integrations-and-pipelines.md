# Integrations and Pipelines

## Integration ownership and capability model

Integrations are presented as one generic catalog. Provider cards are tagged with the connection type (for example Messaging, Code, Pages, or Issues) and the actions currently supported; providers are not permanently categorized as either "knowledge" or "communication." Confluence, for example, may later support write workflows as well as reading pages. The catalog currently lists only implemented providers—Slack, Teams, GitHub, Jira, and Confluence—rather than advertising nonfunctional placeholders. Other legacy source types remain hidden until their adapters are implemented.

- **Integrations** owns connection setup and access management for all providers, including create, edit, connection-test, and remove actions for source-backed connections.
- **Pipelines** owns operational visibility for knowledge-source syncs. Its tabs are **Jobs**, **Sources**, and **Stats**.
- **Knowledge** remains focused on the organized product, technical, quality, and automation knowledge extracted from sources. It no longer contains a duplicate Sources entry.

### Access choices and feature tags

- **Slack and Teams** offer **Read only** and **Read and reply**. Read-only connections store incoming messages but suppress agent work/replies and prevent queued replies from being delivered. This setting controls Super QA behavior; a bot credential can still retain send capability at the provider.
- **Current content integrations** are read-and-sync only. Their connect flow states that the agent can read/sync data into Super QA but cannot create or edit content in the provider. The current UI does not offer a fake write permission where no write workflow exists.
- Connected-service tags describe **Super QA actions** (such as Read, Sync to Super QA, Reply). Provider token scopes are separate: the UI warns when a reported source scope is write-like, and API-token users are advised to choose a read-only token when available.
- Jira OAuth now requests read scopes only; Jira connection verification reports read-only agent use. Existing tokens may already include broader grants and are not silently changed.
- Chat integration access mode is persisted on `chat_installations`, with `read_reply` as the compatibility default. Production databases need `apps/api/migrations/20261011-integration-access.sql` before deploying the chat API change.

## Pipelines views

### Jobs

The Jobs tab reuses the existing sync-job monitor and live update stream. It lists jobs across sources and opens the existing job detail view for stage progress, logs, and cancellation where supported.

### Sources

The Sources tab lists configured source targets and their status, indexed item count, and last sync time. Selecting a source opens a detail dialog with:

- **Jobs**: the source's recent sync jobs.
- **Content synced**: indexed documents returned by `GET /api/documents?sourceId=...` (first 100 displayed; total count is shown).
- **Activity**: a chronological view derived from the source's 50 most recent sync jobs.

The dialog can trigger an incremental sync. Connection credentials, provider setup, and source creation are linked back to Integrations.

### Stats

Stats aggregates configured-source health and indexed item totals with the latest 100 global jobs when opened/refreshed. These are UI snapshots, not a separate analytics store; the job-derived counts therefore describe the recent sample rather than lifetime totals.

## Current implementation boundaries

- Source details use the existing source, job, and document API routes; no parallel source/job storage was introduced.
- The Activity tab is a sync-history timeline, not a complete audit log of source edits, credential changes, or user actions.
- Content previews show at most 100 documents. Pagination is not yet exposed in this view.
- Existing `/sources` and `/sync-jobs` page identifiers remain accepted by the app shell and resolve to Pipelines for compatibility. New sidebar navigation points to Pipelines.
- Slack/Teams remain configured through their existing chat integration flow. Knowledge provider OAuth and API-token setup use the existing source configuration API.

## Files

- `apps/web/components/pages/Integrations.tsx`: collaboration and knowledge integration entry points.
- `apps/web/components/pages/Pipelines.tsx`: Jobs/Sources/Stats shell, source details, content/activity views, and live summary aggregation.
- `apps/web/components/pages/SyncJobs.tsx`: existing global sync-job monitor.
- `apps/web/components/pages/Sources.tsx`: existing knowledge-source creation/authentication modal, reused from Integrations.
- `apps/web/components/Sidebar.tsx`: top-level Pipelines navigation and reduced Knowledge navigation.
