# LaserKerf deploy stack (`apps/deploy/laserkerf/`)

The functional deployment artifacts for the LaserKerf web app. This directory holds only the
stack files; the actual deploy procedure and coordination rules live elsewhere.

Deployment is driven from the repo-root [`DEPLOY.md`](../../../DEPLOY.md) (single source of truth).

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | nginx image serving `apps/web/dist` on port 8000 |
| `nginx.conf` | PWA-aware serving (no-cache shell/SW, immutable hashed assets, SPA fallback) |
| `docker-compose.yml` | `laserkerf-web` service; binds `shared_proxy` → external `proxy`; caps `0.25`/`256m` |
| `Caddyfile.snippet` | hostname routes for the shared Caddy |
| `.env.example` | `TAG` and other deploy vars |
