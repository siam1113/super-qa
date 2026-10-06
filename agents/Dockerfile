# Build context is the repo root. Build with:
#   docker build -f agents/Dockerfile -t qa-agents .
#
# Core QAE/AUE/SuperQA FastAPI service only. The bounded autonomy harness's
# browser/repository workers (agents/shared/harness/*/Dockerfile) are separate,
# optional images — not required for this service to run.

FROM python:3.11-slim AS base
WORKDIR /app/agents
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir --upgrade pip

COPY agents/requirements.txt .
# playwright isn't in requirements.txt but the import chain (qae.harness ->
# shared.live.screencast) needs the package at module load time for type
# hints only — this service doesn't launch a browser itself, so the browser
# binaries (`playwright install`) aren't needed here.
RUN pip install --no-cache-dir -r requirements.txt playwright==1.60.0

COPY agents/ .

RUN addgroup --system agents && adduser --system --ingroup agents agents \
    && chown -R agents:agents /app
USER agents

EXPOSE 8000
CMD ["python", "main.py"]
