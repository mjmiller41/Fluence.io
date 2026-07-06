# Server Co-Habitation Plan — Shared KVM 2 VPS

**Owner:** Michael J. Miller — same business owns both apps.
**Purpose:** Two companion apps share one Hostinger KVM 2 VPS. This document is the shared-infrastructure
contract so both teams stay good neighbors. Read it before touching anything outside your own app's containers.

## The apps

| App | What it is | Server-side weight |
|---|---|---|
| **Editor** (browser-based LightBurn-style app) | Interactive, latency-sensitive editor | Heavier / interactive — gets CPU priority |
| **LaserReady** | Cut-file validation + (later) repair/export, companion prep tool | Light in Phase 0 (validation runs client-side in the browser); moderate later (queued, batch geometry jobs) |

They are **companion software under one business** but must stay **architecturally independent** — separate
repos, separate Docker Compose stacks, separately liftable to their own VPS at any time.

## The box

Hostinger **KVM 2**: **2 vCPU · 8 GB RAM · 100 GB NVMe · 8 TB bandwidth**, full root. Ubuntu LTS + Docker +
Docker Compose. The binding constraint is **2 vCPU shared by both apps** — plan around CPU, not RAM.

## Shared components (coordinate on these)

1. **One reverse proxy — Caddy** (recommended; automatic Let's Encrypt TLS). Owns :80/:443. Routes by hostname:
   - `editor.<domain>` / the editor's domain → editor containers
   - `laserready.<domain>` (+ `app.` / `www.`) → LaserReady containers
   - Config lives in a shared `proxy/` stack; **changes to proxy routing/TLS must be coordinated** (it's the one
     truly shared service). Each app exposes only internal ports; the proxy is the sole public entry.
2. **One Postgres engine, separate databases** (saves RAM vs two engines):
   - DBs: `editor` and `laserready`, separate users/roles, no cross-DB access.
   - Prefer separate DB *containers* only if you need hard isolation; otherwise one engine, two DBs.
   - Each app runs its own migrations against its own DB.
3. **Shared Docker network** for proxy↔app traffic; each app also has a private network for its own services.
4. **Backups:** enable hPanel weekly VPS snapshots. Each app is responsible for its own DB dump cron into
   `/backups/<app>/`.

## Resource budget (starting proposal — tune from real usage)

RAM (8 GB total), enforced with Docker `mem_limit` per service so no app can OOM the other:

| Consumer | RAM budget |
|---|---|
| OS + Docker + Caddy | ~0.75 GB |
| Postgres (shared) | ~1.0 GB |
| **Editor** stack | ~3.5 GB |
| **LaserReady** stack | ~1.5–2.0 GB |
| Headroom / buffer | ~1.0 GB |

CPU (2 vCPU): no hard pinning; govern by **behavior**:
- **Editor = interactive, gets priority.** Keep its request path non-blocking and responsive.
- **LaserReady = background/batch.** Any CPU-heavy work (Phase 1 geometry: offset, nesting, export) runs as a
  **queued job, concurrency-capped (start at 1 concurrent), and CPU-niced** below the editor. LaserReady must
  **never** run heavy geometry inside a blocking web request.
- LaserReady's **Phase 0 validation runs client-side in the user's browser** — it consumes zero box CPU, so the
  free checker adds no load regardless of editor activity.

## Rules of the house (non-negotiable)

1. **Stay in your lane.** Don't modify the other app's containers, DB, or the shared proxy without coordinating.
2. **Set explicit `cpus` and `mem_limit`** on every service you run. An unbounded container is a bad neighbor.
3. **No port collisions.** Publish nothing to the host except via the shared proxy. Agree on internal port ranges
   (suggest: editor 8000–8099, LaserReady 8100–8199).
4. **Secrets** live in each app's own `.env` (git-ignored), never committed, never shared across apps.
5. **Heavy/batch work is queued and capped** (see CPU rule). Interactive latency wins ties.
6. **Design for extraction.** Each app = own repo + own compose file + own subdomain, so either can move to a
   dedicated VPS in an afternoon with only a proxy/DNS change. Don't entangle at the code or DB level.
7. **Monitoring:** run one lightweight monitor (Netdata or `ctop`) so CPU contention is visible; that graph is
   the signal to split the apps onto separate boxes.

## When to split

Move LaserReady (or the editor) to its own KVM when any of: sustained CPU contention visible in monitoring,
p95 interactive latency degrades under the other app's load, or either app's RAM budget is regularly exceeded.
The extraction is intentionally cheap by design — new box, `docker compose up`, repoint DNS/proxy.

## Coordination checklist (what actually needs a conversation)

- Proxy hostnames, routing, and TLS (shared Caddy config).
- Postgres engine version + whether shared or separate containers.
- Internal port-range allocation.
- Per-app RAM/CPU limits (the budget table above).
- Snapshot/backup schedule.

Everything else (each app's internal services, frameworks, deploy cadence) is independent — decide it yourselves.
