# DEPLOY.md — LaserKerf (instructions for claude-code)

> **Audience: claude-code performing the deploy.** This is the single source of truth for
> deploying LaserKerf. Deploy is done from the box via **Hostinger MCP or SSH** (both available).
> LaserKerf shares its VPS with a second tenant (LaserReady) — the **Shared box** section below is
> non-negotiable: follow it or you will break the neighbor.

**Current scope (Phase A):** LaserKerf's PWA (`apps/web`) deploys as a **static site** — heavy compute
(WASM geometry, rendering, GRBL streaming) is client-side, so the server just serves assets. The
licensing/accounts API (`laserkerf-api`) + Postgres are **Phase B, not built yet** (INF-T01/INF-T03);
the Phase B section marks where they slot in. **Preserve the offline invariant** — `pnpm e2e:offline`
must stay green through deploy.

---

## Shared box — proxy coordination contract (READ FIRST, do not skip)

This Hostinger KVM 2 hosts **two independent tenants**:

| Tenant | Containers | Box path | Internal port range | Public domains |
|---|---|---|---|---|
| **LaserKerf** (this repo) | `laserkerf-web` (later `laserkerf-api`, `laserkerf-redis`) | `/srv/laserkerf` | **8000–8099** | `laserkerf.io`, `www.`, `app.`, (later `api.`, `downloads.`) |
| **LaserReady** | `laserready-web` | `/srv/laserready` | **8100–8199** | `laserready.io`, `www.laserready.io` |

**Shared infrastructure — owned jointly, coordinate before touching:**

- One Docker network literally named **`proxy`** (external). Both tenants attach to it. **Never delete or recreate it.** (LaserKerf's compose calls it `shared_proxy` but binds `name: proxy` to this one network.)
- One reverse-proxy container **`shared-caddy`** at `/srv/shared`, owns `:80`/`:443` + TLS. Its `/srv/shared/Caddyfile` holds one hostname block per tenant.
- (Phase B) one Postgres engine **`shared-postgres`**, separate **`laserkerf`** DB/role — **no cross-DB access** to any LaserReady data.

**Rules claude-code MUST follow when deploying LaserKerf:**

1. **Stay in your lane.** Only touch `/srv/laserkerf` and the `laserkerf-*` containers. Never `stop`/`rm`/`restart` `laserready-web`, `shared-caddy`, or `shared-postgres`. Never run `docker compose down` from `/srv/shared` — that drops the proxy for **both** tenants.
2. **Edit the shared Caddyfile additively.** When touching LaserKerf's hostname block in `/srv/shared/Caddyfile`, leave LaserReady's block byte-for-byte intact. Then `caddy validate` and `caddy reload` — **never restart** the `shared-caddy` container (reload is zero-downtime; a restart drops the neighbor).
3. **No published host ports.** Reach the world only through `shared-caddy`. Stay in **8000–8099** if a host port is ever unavoidable.
4. **Never modify LaserReady's `.env`, files, or containers.** In Phase B, run migrations against the `laserkerf` DB only — never touch any LaserReady schema.
5. **Snapshot before risky shared changes.** Take a Hostinger VPS snapshot (via the Hostinger MCP) before editing anything under `/srv/shared`.

**After any deploy, confirm you did not harm the neighbor:**

```bash
curl -s -o /dev/null -w 'laserready.io %{http_code}\n' https://laserready.io   # must still be 200 (or the same as before)
```

---

## Access: Hostinger MCP or SSH

Deployment runs docker/shell commands on the box and occasionally manages DNS or snapshots. Use both:

- **Hostinger MCP (prefer for VPS lifecycle + DNS):** list the VPS to get its IP/status, take a **pre-deploy snapshot**, and manage DNS records. If the Hostinger MCP exposes a run-command / exec tool, you may run the shell steps below through it. Check the connected Hostinger tools first.
- **SSH (for docker/compose):** `ssh <ssh-user>@<box-ip>` then run the commands below. Get `<box-ip>` from the Hostinger MCP (VPS list) or the operator.

Do not fetch or run anything outside these two paths.

---

## One-time setup (skip steps another operator already did)

1. **Shared network:**

   ```bash
   docker network ls --format '{{.Name}}' | grep -qx proxy || docker network create proxy
   ```

2. **Shared Caddy stack** at `/srv/shared` (owned jointly — bring up once for the whole box if absent):

   ```yaml
   # /srv/shared/docker-compose.yml — the ONLY public-facing stack
   services:
     shared-caddy:
       image: caddy:2-alpine
       container_name: shared-caddy
       restart: unless-stopped
       ports: ["80:80", "443:443"]
       volumes:
         - ./Caddyfile:/etc/caddy/Caddyfile:ro
         - caddy_data:/data
         - caddy_config:/config
       networks: [proxy]
   volumes: { caddy_data: {}, caddy_config: {} }
   networks: { proxy: { external: true } }
   ```

   Seed `/srv/shared/Caddyfile` with `{ email ops@laserkerf.io }` and `:80 { respond /healthz 200 }`, then `cd /srv/shared && docker compose up -d`.

3. **Clone + build the PWA bundle** (the WASM toolchain isn't in the image — build locally/CI):

   ```bash
   cd /srv && git clone git@github.com:mjmiller41/LaserKerf.io.git laserkerf && cd laserkerf
   pnpm install --frozen-lockfile
   pnpm --filter web build            # emits apps/web/dist (rebuild fixes the stale pre-rename dist)
   ```

4. **Env:**

   ```bash
   cd apps/deploy/laserkerf && cp .env.example .env    # set TAG; Phase B secrets stay commented
   ```

5. **DNS:** ensure `laserkerf.io`, `www.laserkerf.io`, `app.laserkerf.io` resolve to the box IP (via the Hostinger MCP DNS tools) before the first Caddy reload.

---

## Deploy / update

```bash
cd /srv/laserkerf
git pull
pnpm install --frozen-lockfile && pnpm --filter web build     # rebuild dist
cd apps/deploy/laserkerf
# bump TAG in .env
docker compose --env-file .env up -d --build
docker compose --env-file .env ps                             # laserkerf-web healthy? (cpus 0.25 / mem 256m)
```

**Add/confirm LaserKerf's route in the shared Caddy** (only if the block isn't already present). Append to `/srv/shared/Caddyfile`, leaving LaserReady's block untouched:

```caddy
laserkerf.io, www.laserkerf.io, app.laserkerf.io {
	encode gzip
	reverse_proxy laserkerf-web:8000
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
	}
}
```

Then, from the box:

```bash
docker exec shared-caddy caddy validate --config /etc/caddy/Caddyfile
docker exec shared-caddy caddy reload   --config /etc/caddy/Caddyfile   # zero-downtime; never `restart`
```

The service worker is versioned, so installed PWAs update on next launch while old clients keep working offline.

---

## Verify

```bash
curl -s https://laserkerf.io | grep -o '<title>[^<]*'                          # serves the app
curl -s -o /dev/null -w 'app %{http_code}\n' https://app.laserkerf.io          # 200
curl -s -o /dev/null -w 'laserready.io %{http_code}\n' https://laserready.io    # neighbor still 200
```

Then in a browser: load `https://app.laserkerf.io`, install the PWA, **cut the network**, and confirm the app still loads — the offline invariant must survive deployment.

---

## Tag + rollback

```bash
git tag -a v0.x.y -m "What this deploy contains" && git push origin --tags

# rollback = redeploy previous tag (LaserKerf only; never touch the neighbor)
git checkout <last-good-tag>
pnpm install --frozen-lockfile && pnpm --filter web build
cd apps/deploy/laserkerf && docker compose --env-file .env up -d --build
```

---

## Phase B — licensing/accounts API (not built yet: INF-T01 / INF-T03)

When `laserkerf-api` exists, extend the deploy:

1. **Add Postgres to `/srv/shared/docker-compose.yml`** (`shared-postgres`, network alias `postgres`, its own `pg_data` volume, no host ports).
2. **Create the `laserkerf` DB + role** (no cross-DB access):

   ```bash
   docker exec -i shared-postgres psql -U postgres <<'SQL'
   CREATE ROLE laserkerf WITH LOGIN PASSWORD 'CHANGE_ME_STRONG';
   CREATE DATABASE laserkerf OWNER laserkerf;
   REVOKE ALL ON DATABASE laserkerf FROM PUBLIC;
   SQL
   ```

3. **Add `laserkerf-api` (+ optional `laserkerf-redis`)** to `apps/deploy/laserkerf/docker-compose.yml` on ports 8001/8002 (internal), explicit caps (api `0.75`/`768m`, redis `0.10`/`128m`); set `DATABASE_URL`, `LICENSE_SIGNING_KEY` (back up out of band — unrecoverable if lost), `STRIPE_WEBHOOK_SECRET` in `.env`.
4. **Run migrations against the `laserkerf` DB only**, then `up -d`.
5. **Uncomment the Phase B Caddy routes** (`api.laserkerf.io` → `laserkerf-api:8001`, `downloads.laserkerf.io` → `laserkerf-web:8000`) and reload Caddy once.
6. **Nightly `pg_dump`** of the `laserkerf` DB into `/backups/laserkerf/`.

The realistic pressure once Phase B is live is **Agent-download bandwidth/disk** on the shared NVMe, not CPU/RAM — prune old Agent versions, then move `/downloads` to object storage + CDN, then split to a dedicated box.

---

## Functional stack files (do not delete — these ARE the deploy)

`apps/deploy/laserkerf/docker-compose.yml` · `Dockerfile` · `nginx.conf` · `Caddyfile.snippet` · `.env.example`
