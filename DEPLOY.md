# Deploying Ultimate QA Agent

Single-VPS deployment via Docker Compose: web (Next.js), api (NestJS), agents
(FastAPI), plus Postgres/pgvector, Redis, Neo4j, and MinIO (self-hosted S3),
fronted by Caddy for automatic HTTPS.

Everything that can be prepared ahead of time (Dockerfiles, compose file,
migrations, env templates, deploy script) is already in the repo. The steps
below are the ones only you can do.

## 1. Create the server

1. Create a Hetzner Cloud account (or DigitalOcean, etc).
2. Create a server: **Ubuntu 24.04**, **CPX31** (4 vCPU / 8GB RAM) or larger.
3. Note its public IP.

## 2. Point DNS at it

Add an **A record** for the domain/subdomain you want (e.g. `qa.yourdomain.com`)
pointing at the server's IP. Caddy (step 5) needs this to already resolve
before it can issue a TLS certificate.

## 3. SSH in and install Docker

```bash
ssh root@<server-ip>

curl -fsSL https://get.docker.com | sh
# Docker Compose v2 ships as the `docker compose` plugin with the above installer.
```

## 4. Clone the repo

```bash
git clone <your-repo-url> /opt/ultimate-qa-agent
cd /opt/ultimate-qa-agent
```

This is the only step you ever do by hand — every deploy after this, manual
or automatic, reuses this same clone (`git pull`, never a re-clone).

## 5. Configure secrets, then first boot

`./deploy/deploy.sh` calls `deploy/bootstrap-env.sh` automatically, which
creates `.env`, `apps/api/.env.production` and `agents/.env.production` from
their templates and auto-generates every secret that doesn't require human
knowledge (`DATABASE_PASSWORD`, `NEO4J_PASSWORD`, `S3_SECRET_KEY`,
`AGENT_MEMORY_SIGNING_KEY` — kept identical across both app env files). It
only stops you for the two things no script can invent: your domain and an
LLM API key.

```bash
./deploy/deploy.sh
```

First run will likely exit with something like:

```
Missing required configuration:
  - .env: DOMAIN (your domain name, e.g. qa.example.com) — set it there, or as a DOMAIN secret in GitHub
  - apps/api/.env.production: ANTHROPIC_API_KEY or OPENAI_API_KEY (at least one) — or the matching GitHub secret
  - agents/.env.production: ANTHROPIC_API_KEY or OPENAI_API_KEY (at least one) — or the matching GitHub secret
```

Fill those two in — edit `.env`'s `DOMAIN=` line, and `ANTHROPIC_API_KEY=` or
`OPENAI_API_KEY=` in both `apps/api/.env.production` and
`agents/.env.production` — then run `./deploy/deploy.sh` again.

(Everything else in those files — Slack/Teams, OIDC SSO, the autonomy
harness, meeting voice — can stay blank; those features are opt-in and won't
block startup.)

**Skip this manual edit entirely**: if you set up step 9 (CI/CD) first and
add `DOMAIN` and `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` as GitHub secrets
too, the first deploy run by GitHub Actions fills these in for you — you
never touch an env file on the server at all. See step 9.

## 6. First boot, continued

Once secrets are in place, `./deploy/deploy.sh` proceeds past bootstrap,
builds the three app images, and brings up the full stack. On a completely
empty Postgres volume, `apps/api/migrations/*.sql` applies automatically on
Postgres' first boot (see `deploy/run-migrations.sh`) — this only happens
once, on an empty data directory.

Caddy requests its TLS certificate automatically once DNS resolves and ports
80/443 are reachable — give it a minute on first boot. Open your firewall
for 80 and 443 if you have one (e.g. `ufw allow 80,443/tcp`).

Check everything is healthy:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
```

## 7. Create your first super-admin account

```bash
docker compose -f docker-compose.prod.yml exec api node scripts/create-super-admin.js
```

This prompts interactively for an email and password — run it from an
actual terminal (not piped).

## 8. Verify

Visit `https://<your-domain>` — you should see the login page. Sign in with
the super-admin account from step 7.

## 9. Set up autonomous deploys (CI/CD)

`.github/workflows/deploy.yml` SSHs into the server and runs `deploy/deploy.sh`
automatically — but only after `.github/workflows/autonomy.yml` ("Bounded
autonomy verification") has passed on `main`, so a broken push never ships.

**On the server**, create a dedicated non-root deploy user rather than using
root over SSH from CI:

```bash
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
chown -R deploy:deploy /opt/ultimate-qa-agent
```

Generate a deploy keypair **on your own machine** (not the server):

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f deploy_key -N ""
```

Add the public half to the server:

```bash
ssh-copy-id -i deploy_key.pub deploy@<server-ip>
# or manually: paste deploy_key.pub into /home/deploy/.ssh/authorized_keys on the server
```

**In GitHub**, go to the repo's Settings → Secrets and variables → Actions
and add:
- `DEPLOY_HOST` — the server's IP or domain
- `DEPLOY_USER` — `deploy`
- `DEPLOY_SSH_KEY` — the contents of `deploy_key` (the **private** key —
  never the `.pub` file)

Delete `deploy_key`/`deploy_key.pub` from your machine once they're pasted
in (the private half only needs to exist as that one GitHub secret).

**Optional but recommended** — add these too, and `deploy/bootstrap-env.sh`
writes them into the server's env files on every deploy, so you never SSH in
to hand-edit a `.env` file, ever (not even for the first boot in step 5):
- `DOMAIN`
- `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`
- `DATABASE_PASSWORD`, `NEO4J_PASSWORD`, `S3_SECRET_KEY`,
  `AGENT_MEMORY_SIGNING_KEY` — optional; leave unset and
  `bootstrap-env.sh` auto-generates these with `openssl rand` on first run
  instead. Only worth setting explicitly if you want the value recorded in
  GitHub rather than only living on the server.

Any of these left unset simply falls back to whatever's already on the
server, or to auto-generation for the random-secret ones.

If your repo is private, the server also needs its own git read access for
`deploy.sh`'s `git pull` to work non-interactively — add a separate
[deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys#deploy-keys)
(read-only) to the repo and load it in the `deploy` user's SSH agent/config
on the server.

Push to `main` and watch the **Actions** tab — once verification passes,
"Deploy" runs automatically. You can also trigger it manually from the
Actions tab (`workflow_dispatch`) without waiting for a push.

## Future deploys

Once step 9 is set up, deploys are automatic: push to `main`, verification
runs, then deploy runs. No CI set up yet, or want to ship without waiting?
Run it by hand:

```bash
./deploy/deploy.sh
```

Pulls `main`, rebuilds images, restarts the stack. **Schema changes**: unlike
the first boot, Postgres won't re-run `apps/api/migrations/*.sql` once its
data volume already exists. Until a migration runner is added, apply new
`.sql` files by hand after a deploy that adds them:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U qaagent -d qaagent -f - < apps/api/migrations/<new-file>.sql
```

## What's deliberately out of scope here

- **Backups**: nothing in this setup backs up the Postgres/Neo4j/MinIO
  volumes. For anything beyond a throwaway deploy, add a cron job (e.g.
  `pg_dump` to off-box storage) before you rely on this with real data.
- **The bounded autonomy harness** (`agents/shared/harness/*`, the
  `HARNESS_*`/`AUTONOMY_*` env vars): its browser/repository worker images
  are separate and not part of this compose file. Left disabled (all
  `HARNESS_*` keys blank) by default — see `docs/autonomy-operations.md` if
  you want to turn it on later.
- **Chat integrations** (Slack/Teams), **OIDC SSO**, **meeting voice**: all
  optional, all off until their env vars are filled in.
- **Zero-downtime deploys / staging environment**: `deploy.sh` does a plain
  rebuild-and-restart. Fine for a single low-traffic deployment; revisit if
  you need either of those.
