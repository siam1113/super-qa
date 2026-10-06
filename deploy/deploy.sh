#!/usr/bin/env bash
# Run this from the repo root on the server to ship the latest main branch.
#   ./deploy/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Checking env files"
./deploy/bootstrap-env.sh

echo "==> Pulling latest main"
# Force-sync rather than a plain pull — this server is a pure deploy target,
# so any local drift on tracked files is unintentional. git clean respects
# .gitignore, so generated secret files (.env, .env.production, s3-config.json)
# are left alone.
git fetch origin main
git clean -fd
git reset --hard origin/main

echo "==> Building images"
docker compose -f docker-compose.prod.yml build

echo "==> Starting stack"
docker compose -f docker-compose.prod.yml up -d

echo "==> Pruning dangling images"
docker image prune -f

echo "==> Status"
docker compose -f docker-compose.prod.yml ps
