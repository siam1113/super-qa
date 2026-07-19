# Ultimate QA Agent

Enterprise AI-native QA automation platform built as a Next.js frontend, NestJS API, and MongoDB-backed domain model.

## Apps

- `apps/web`: Next.js app router UI with three-panel workspace, inspector, command palette, AI copilot, dashboard, agents, context, flows, facts, actions, DOM, data setup, test cases, coverage, PRs, and settings screens.
- `apps/api`: NestJS API with MongoDB/Mongoose schemas for test cases, executions, flows, facts, actions, DOM snapshots, and data setup assets.

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```

The web app runs on port `3000`; the API runs on port `4000` with `/api` as its global prefix.

## Validation

```bash
npm run validate
```

## Implemented workflow wiring

- The web app now attempts to load `/api/qa/workspace` and falls back to local seed data when the API is unavailable.
- The API exposes mutation placeholders for primary workflows: `POST /api/qa/runs`, `POST /api/qa/healing-decisions`, and `POST /api/qa/generated-tests`.
- The remaining production work is to replace the optimistic UI placeholders with persisted commands, authentication/RBAC, streaming execution events, artifact storage, and real agent orchestration.
