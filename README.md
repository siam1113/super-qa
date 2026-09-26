# Super QA

Super QA (internally named `ultimate-qa-agent`) is a monorepo for an enterprise AI QA Master Agent platform. It provides a web dashboard and an API for AI-driven test planning and execution.

## Layout

```text
apps/
  web/      Frontend dashboard
  api/      Backend API service
agents/
  main.py       Entry point for the Python-based agent runtime
  qae/          Agent responsible for quality assurance tasks (Quality Assurance Engineer)
  aue/          Agent responsible for automation engineering tasks (Automation Engineer)
  shared/       Shared agent utilities
  sessions.py   Session management for agent runs
docs/
  database-connections.md   Notes on configuring database connections
  source-sync-pipeline.md   Notes on the source synchronization pipeline
plan.md            Original product design brief
PRODUCT_DESIGN.md   Product design documentation
```

## Getting Started

Requires Node.js and Python.

```bash
npm install
npm run dev          # runs the web app and API together
```

For the Python agents:

```bash
cd agents
pip install -r requirements.txt
cp .env.example .env  # fill in required values
python main.py
```

## Available Scripts

- `npm run dev`: run the web dashboard and API in parallel
- `npm run build`: build the web dashboard and API
- `npm run lint`: lint all workspaces

See `plan.md` and `PRODUCT_DESIGN.md` for the full product design context.
