# System status page

The `/status` page gives a lightweight view of the web application and its core runtime dependencies.

## Services checked

- **Web application** — marked healthy when the page is rendering in the browser.
- **API** — checked through `GET /api/health/live`, which does not query the database or call a model provider.
- **PostgreSQL** — checked through the API's `GET /api/health/database` endpoint.
- **Redis queue** — checked through the API's `GET /api/health/redis` endpoint.

The page refreshes every 15 seconds and includes a manual refresh button. It never calls the embedding health check because that can make a billable provider request. When the API is unavailable, database and Redis are shown as not checked rather than inferring their state.

The Next.js server route `/api/status` proxies the probes using `AUTONOMY_API_URL` (default `http://localhost:4000/api`), enforces a short timeout, disables caching, and returns only status and latency—not raw dependency errors or credentials.
