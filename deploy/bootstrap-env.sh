#!/usr/bin/env bash
# Called automatically by deploy.sh, every run — safe to call repeatedly.
#
# Priority for each secret:
#   1. An environment variable of the same name, if set (this is how the
#      "Deploy" GitHub Actions workflow drives it — see .github/workflows/
#      deploy.yml's `envs:`/`env:` — so secrets live in GitHub, never typed
#      on the server).
#   2. For the infra-only secrets (DB/Neo4j/MinIO passwords, the shared
#      agent-memory signing key) — nothing no script can invent is needed,
#      so auto-generate one with openssl if the file doesn't have one yet.
#   3. DOMAIN and the LLM API keys have no safe default — if neither an env
#      var nor an existing file value supplies them, stop and say exactly
#      what's missing rather than booting a broken stack.
set -euo pipefail

cd "$(dirname "$0")/.."

ROOT_ENV=.env
API_ENV=apps/api/.env.production
AGENTS_ENV=agents/.env.production

[ -f "$ROOT_ENV" ] || cp .env.deploy.example "$ROOT_ENV"
[ -f "$API_ENV" ] || cp apps/api/.env.production.example "$API_ENV"
[ -f "$AGENTS_ENV" ] || cp agents/.env.production.example "$AGENTS_ENV"

current_value() { grep -E "^${2}=" "$1" | head -1 | cut -d= -f2-; }

# Writes the env var named $2's value into $2=... in file $1, if that env
# var is set and non-empty. No-op (not an error) otherwise — note the `||
# true`, needed because a bare `test && action` would abort the whole
# script under `set -e` the moment the test is false, which is the common
# case here (most of these env vars won't be set on a manual/local run).
set_from_env() {
  local file=$1 key=$2 value="${!2:-}"
  if [ -n "$value" ]; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$file"
  fi
}

# Same, but only seeds the value the FIRST time (while the file's current
# value is still blank) — every later call is a no-op even if the env var
# is set to something different. DATABASE_PASSWORD/NEO4J_PASSWORD/
# S3_SECRET_KEY get baked into their service's own persistent volume at
# first init and are never re-read afterward: Postgres and Neo4j both
# ignore a changed password env var on every later restart. Using
# set_from_env for these meant a changed GitHub secret silently desynced
# the app's credential from the one actually stored in the volume on every
# later deploy — "password authentication failed for user qaagent" and
# Neo4j crash-looping on auth, both observed in production from exactly
# this. Once a value exists, keep it; rotate the credential inside the
# running service itself if it needs to change, not by editing this file.
set_once_from_env() {
  local file=$1 key=$2 value="${!2:-}"
  if [ -n "$value" ] && [ -z "$(current_value "$file" "$key")" ]; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$file"
  fi
}

set_from_env "$ROOT_ENV" DOMAIN
set_once_from_env "$ROOT_ENV" DATABASE_PASSWORD
set_once_from_env "$ROOT_ENV" NEO4J_PASSWORD
set_once_from_env "$ROOT_ENV" S3_SECRET_KEY
set_from_env "$API_ENV" ANTHROPIC_API_KEY
set_from_env "$API_ENV" OPENAI_API_KEY
set_from_env "$AGENTS_ENV" ANTHROPIC_API_KEY
set_from_env "$AGENTS_ENV" OPENAI_API_KEY
set_from_env "$API_ENV" AGENT_MEMORY_SIGNING_KEY
set_from_env "$AGENTS_ENV" AGENT_MEMORY_SIGNING_KEY
set_from_env "$API_ENV" QA_WORKFLOW_KEY
set_from_env "$AGENTS_ENV" QA_WORKFLOW_KEY
set_from_env "$API_ENV" RECALL_API_KEY
set_from_env "$API_ENV" RECALL_WEBHOOK_SECRET
set_from_env "$API_ENV" RECALL_REGION
set_from_env "$API_ENV" CHAT_SECRET_KEY

# Auto-generate the infra-only secrets if still blank after the env-var pass.
if [ -z "$(current_value "$ROOT_ENV" DATABASE_PASSWORD)" ]; then
  sed -i "s/^DATABASE_PASSWORD=.*/DATABASE_PASSWORD=$(openssl rand -hex 24)/" "$ROOT_ENV"
fi
if [ -z "$(current_value "$ROOT_ENV" NEO4J_PASSWORD)" ]; then
  sed -i "s/^NEO4J_PASSWORD=.*/NEO4J_PASSWORD=$(openssl rand -hex 24)/" "$ROOT_ENV"
fi
if [ -z "$(current_value "$ROOT_ENV" S3_SECRET_KEY)" ]; then
  sed -i "s/^S3_SECRET_KEY=.*/S3_SECRET_KEY=$(openssl rand -hex 24)/" "$ROOT_ENV"
fi
# Must be exactly 64 hex chars (32 bytes) — chat.connectors.ts validates this
# format and throws if it isn't, the moment a Slack/Teams connector is used.
if [ -z "$(current_value "$API_ENV" CHAT_SECRET_KEY)" ]; then
  sed -i "s/^CHAT_SECRET_KEY=.*/CHAT_SECRET_KEY=$(openssl rand -hex 32)/" "$API_ENV"
fi

# Keeps a secret identical in both app env files, auto-generating one if
# neither file has it yet. Used for the two keys api and agents must agree
# on: AGENT_MEMORY_SIGNING_KEY and QA_WORKFLOW_KEY.
sync_shared_secret() {
  local key=$1 bytes=$2 value
  if [ -z "$(current_value "$API_ENV" "$key")" ] || [ -z "$(current_value "$AGENTS_ENV" "$key")" ]; then
    value="$(current_value "$API_ENV" "$key")"
    if [ -z "$value" ]; then
      value="$(current_value "$AGENTS_ENV" "$key")"
    fi
    if [ -z "$value" ]; then
      value="$(openssl rand -hex "$bytes")"
    fi
    sed -i "s/^${key}=.*/${key}=${value}/" "$API_ENV"
    sed -i "s/^${key}=.*/${key}=${value}/" "$AGENTS_ENV"
  fi
}

sync_shared_secret AGENT_MEMORY_SIGNING_KEY 32
sync_shared_secret QA_WORKFLOW_KEY 32

# Renders the SeaweedFS S3-gateway identity config from S3_ACCESS_KEY/
# S3_SECRET_KEY — docker-compose.prod.yml's `storage` service reads this,
# there's no env-var-only way to configure SeaweedFS's S3 auth.
cat > deploy/s3-config.json <<JSON
{
  "identities": [
    {
      "name": "qaagent",
      "credentials": [{"accessKey": "$(current_value "$ROOT_ENV" S3_ACCESS_KEY)", "secretKey": "$(current_value "$ROOT_ENV" S3_SECRET_KEY)"}],
      "actions": ["Admin", "Read", "Write"]
    }
  ]
}
JSON

# Can't invent these — stop and ask, rather than booting a broken stack.
missing=()
if [ -z "$(current_value "$ROOT_ENV" DOMAIN)" ]; then
  missing+=("$ROOT_ENV: DOMAIN (your domain name, e.g. qa.example.com) — set it there, or as a DOMAIN secret in GitHub")
fi
if [ -z "$(current_value "$API_ENV" ANTHROPIC_API_KEY)" ] && [ -z "$(current_value "$API_ENV" OPENAI_API_KEY)" ]; then
  missing+=("$API_ENV: ANTHROPIC_API_KEY or OPENAI_API_KEY (at least one) — or the matching GitHub secret")
fi
if [ -z "$(current_value "$AGENTS_ENV" ANTHROPIC_API_KEY)" ] && [ -z "$(current_value "$AGENTS_ENV" OPENAI_API_KEY)" ]; then
  missing+=("$AGENTS_ENV: ANTHROPIC_API_KEY or OPENAI_API_KEY (at least one) — or the matching GitHub secret")
fi

if [ "${#missing[@]}" -gt 0 ]; then
  echo "" >&2
  echo "Missing required configuration:" >&2
  for m in "${missing[@]}"; do echo "  - $m" >&2; done
  echo "" >&2
  exit 1
fi
