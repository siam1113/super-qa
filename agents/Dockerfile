# Build context is the repo root. Build with:
#   docker build -f agents/Dockerfile -t qa-agents .
#
# Core QAE/AUE/SuperQA FastAPI service. The bounded autonomy harness's
# browser/repository workers (agents/shared/harness/*/Dockerfile) are separate,
# optional images — not required for this service to run.
#
# Live browser exploration (shared.mcp.agent_browser.client, used by the
# explore_app skill) needs three things beyond a plain `pip install`: the
# Python `mcp` package, a Node.js runtime, and the `agent-browser` CLI
# pointed at a working Chromium. Missing any of these makes explore_app fail
# with "Install agents/browser-mcp dependencies and Chromium" in production.

FROM python:3.11-slim AS base
WORKDIR /app/agents
# Shared by both npm ci below (run as root) and the agents user at runtime
# — must match, or agent-browser's own state/config dir (created as root)
# ends up unreadable once we switch users.
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOME=/home/agents

RUN pip install --no-cache-dir --upgrade pip

# agent-browser requires Node >=24; python:3.11-slim has no Node at all.
# Chromium comes from Debian's own package, not agent-browser's bundled
# "Chrome for Testing" download — that download has no Linux ARM64 build at
# all (fails outright on an arm64 host), and apt's chromium pulls in its own
# correct runtime libs for whatever architecture it's actually built on.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg chromium \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium

COPY agents/requirements.txt agents/requirements-mcp.txt .
# playwright isn't in either requirements file but the import chain
# (qae.harness -> shared.live.screencast) needs the package at module load
# time for type hints only — this service doesn't launch a Playwright
# browser itself (explore_app goes through agent-browser instead), so the
# Playwright browser binaries aren't needed here.
RUN pip install --no-cache-dir -r requirements-mcp.txt playwright==1.60.0

COPY agents/ .

RUN addgroup --system agents && adduser --system --ingroup agents --home /home/agents agents \
    && mkdir -p /home/agents && chown -R agents:agents /app /home/agents

# Just the agent-browser CLI binary itself — Chromium is the apt package
# above, not agent-browser's own `install` (which only knows how to fetch
# Chrome for Testing, the thing we're deliberately avoiding).
RUN cd browser-mcp && npm ci \
    && chown -R agents:agents /app /home/agents

USER agents

EXPOSE 8000
CMD ["python", "main.py"]
