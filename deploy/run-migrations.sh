#!/bin/sh
# Runs once, automatically, by the postgres image's docker-entrypoint-initdb.d
# mechanism — only on a completely fresh (empty) data volume. Schema changes
# after the first boot need a manual migration run (see DEPLOY.md).
set -e

for f in /migrations/*.sql; do
  echo "Applying migration: $f"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
done
