# Deployment Plan — Fluence on a Shared Hostinger KVM 2 VPS

**Reads with:** [`05-server-cohabitation-plan.md`](./05-server-cohabitation-plan.md) (the shared-infra contract), [`02-development-plan.md`](./02-development-plan.md), [`03-implementation-plan.md`](./03-implementation-plan.md).
**Fluence = the "Editor"** in the cohabitation plan. The co-tenant is **LaserReady**. Same business owns both; they stay architecturally independent (separate repos, separate compose stacks, separately liftable).

---

## 0. The one insight that shapes everything

Per the feasibility and dev plans, **Fluence's heavy compute runs in the user's browser** — WASM geometry (Clipper2, dithering), rendering, and even GRBL streaming (Web Serial) all happen client-side. The **server's job is small**: deliver static assets, issue/verify licenses, host accounts, and serve the Agent installer + update feed.

Consequence for cohabitation: although the contract pre-assigned the "Editor" the heavy/interactive role with a 3.5 GB budget and CPU priority, **Fluence in practice is a light, non-blocking neighbor.** It should keep CPU priority so license/auth/static responses stay snappy, but it will not be a CPU hog — the CPU-heavy tenant is LaserReady's batch geometry, not Fluence. We will likely **cede most of the 3.5 GB allocation back to headroom**. This is good news for the shared box.

**Non-negotiable it must preserve:** the **offline invariant**. Once the PWA is installed, Fluence works with zero server contact. The server is needed only for first load, license activation (with offline grace, `CM-T01`), downloads, and updates — never for the design/CAM/control loop.

---

## 1. What Fluence actually runs on the server

| Service | Purpose | Stateful? | Lives in |
|---|---|---|---|
| **`fluence-web`** | Static PWA (HTML/JS/CSS/**WASM**) + service worker; also serves `/downloads` (Agent installers) and `/update` (auto-update manifest) | No (assets baked into image / volume) | own container |
| **`fluence-api`** | Licensing/DRM (issue + verify signed licenses, 3-seat management), accounts, purchase/webhook handling | Yes → Postgres `fluence` DB | own container |
| **Postgres `fluence` DB** | Licenses, activations, accounts, orders | Yes | **shared Postgres engine** (per contract §Shared components) |
| **`fluence-redis`** *(optional)* | Rate-limit + session/cache for the API | Ephemeral | own container, internal only |

Deliberately **kept off the shared box** to stay a light neighbor:
- **Telemetry / crash reporting** (`M9-T05`) → external SaaS (e.g. Sentry) or a separate ingest, not on the VPS. Opt-in and offline-safe regardless.
- **Large-scale Agent binary hosting / CDN** → move to object storage + CDN once binary volume grows (see §7). On-box `/downloads` is fine for launch.
- **Cloud project sync** → *not in scope for the shared box.* Fluence is offline-first; if paid cloud-sync is added later it becomes the trigger to split (see §8), because it turns Fluence from light to storage/CPU-heavy.

Payments note: Stripe (or similar) webhooks hit `fluence-api`; license issuance is triggered on `checkout.session.completed`. Keep webhook handling idempotent and fast (non-blocking), consistent with the "interactive latency wins" house rule.

---

## 2. Fit within the cohabitation contract

### Reverse proxy (shared Caddy — coordinate before changing)
Fluence exposes **no host ports**; the shared Caddy is the only public entry (contract §Shared components #1, house rule #3). Proposed hostnames (adding these to the shared Caddy config **requires coordination** per the contract):

- `fluence.io`, `www.fluence.io` → `fluence-web` (marketing + installable PWA)
- `app.fluence.io` → `fluence-web` (PWA entry, if we separate app from marketing)
- `api.fluence.io` → `fluence-api`
- `downloads.fluence.io` (or `fluence.io/downloads`) → `fluence-web` `/downloads` + `/update`

TLS is automatic via the shared Caddy's Let's Encrypt. Fluence keeps its **own** static serving in `fluence-web` (rather than having shared Caddy `file_server` our assets directly) so the app stays cleanly extractable — Caddy only reverse-proxies by hostname.

### Ports (editor range 8000–8099, per contract house rule #3)
- `8000` → `fluence-web` (internal)
- `8001` → `fluence-api` (internal)
- `8002` → `fluence-redis` (internal, **never published**)
Nothing published to the host; proxy reaches these over the shared Docker network.

### Database (shared engine, separate DB — contract §Shared components #2)
One `fluence` DB, dedicated role `fluence`, **no cross-DB access** to `laserready`. Fluence runs its **own migrations** against its own DB only. Prefer the shared Postgres engine (saves RAM); request a separate DB *container* only if hard isolation is later required.

---

## 3. Resource budget (Fluence's slice of the contract's table)

The contract allocates the Editor stack ~3.5 GB. Fluence's realistic use is far lower; set explicit `mem_limit`/`cpus` on **every** service (house rule #2) but expect to run well under budget and hand RAM back to headroom.

| Fluence service | `mem_limit` | `cpus` | Notes |
|---|---|---|---|
| `fluence-web` | 256 MB | 0.25 | Static; mostly kernel page cache |
| `fluence-api` | 768 MB | 0.75 | Node/Rust API; keep request path non-blocking |
| `fluence-redis` (opt) | 128 MB | 0.10 | Only if sessions/rate-limit needed |
| **Fluence subtotal** | **~1.15 GB** | **~1.1** | vs 3.5 GB allocated → ~2.3 GB ceded to headroom |
| Postgres `fluence` share | (within shared ~1.0 GB engine) | — | shared with LaserReady's DB |

CPU governance (contract §CPU): Fluence is **interactive but light** — its request path (license check, account, static) must stay fast and non-blocking. It has no batch/geometry server work to nice down (that's all client-side or LaserReady's concern). This makes Fluence the easy tenant: it wins latency ties by being cheap, not by starving the neighbor.

---

## 4. Compose stack (shape, not final)

`apps/deploy/fluence/docker-compose.yml` — Fluence's **own** stack, joined to the shared proxy network and using the shared Postgres.

```yaml
# networks: shared_proxy (external, owned by proxy/ stack) + fluence_internal (private)
services:
  fluence-web:
    image: registry/fluence-web:${TAG}      # built in CI: PWA assets + tiny static server
    mem_limit: 256m
    cpus: 0.25
    networks: [shared_proxy, fluence_internal]
    volumes:
      - fluence_downloads:/srv/downloads:ro  # Agent installers + update manifest
    # NO ports: published — proxy reaches :8000 over shared_proxy

  fluence-api:
    image: registry/fluence-api:${TAG}
    mem_limit: 768m
    cpus: 0.75
    env_file: [./.env]                        # secrets: DB creds, license signing key, stripe
    networks: [shared_proxy, fluence_internal]
    depends_on: [fluence-redis]
    # connects to shared Postgres over shared_proxy net (host: postgres, db: fluence)

  fluence-redis:                              # optional
    image: redis:7-alpine
    command: ["redis-server","--maxmemory","96mb","--maxmemory-policy","allkeys-lru"]
    mem_limit: 128m
    cpus: 0.10
    networks: [fluence_internal]

volumes:
  fluence_downloads:
networks:
  shared_proxy: { external: true }
  fluence_internal: {}
```

Secrets live only in Fluence's git-ignored `.env` (contract house rule #4). The **license signing private key** and payment webhook secret are the sensitive ones — never committed, never shared with LaserReady.

---

## 5. CI/CD (stay-in-lane deploys)

Pipeline (GitHub Actions), touching **only** the Fluence stack (contract house rule #1):

1. **Build web:** compile TS + all WASM (`geometry-wasm`, dither, VTracer, OpenCV.js); run `pnpm turbo lint typecheck test`, golden CAM tests, and **`pnpm e2e:offline`** (deployment must not break offline). Produce `fluence-web:${TAG}` image with hashed assets + versioned service worker.
2. **Build API:** `fluence-api:${TAG}`.
3. **Build + sign Agent** installers (Win/macOS/Linux, `M4-T01`); upload to the `fluence_downloads` volume (or object storage) and publish a **signed** `/update` manifest.
4. **Deploy:** on the VPS, for the Fluence stack only: `docker compose pull && docker compose up -d`. Postgres migrations run as a one-shot against the `fluence` DB.
5. **SW cache-busting:** bump the service-worker version so installed PWAs fetch new assets on next launch; old clients keep working offline until they update.

Rollback = redeploy previous `${TAG}` (images are immutable). Static PWA makes this atomic; no blue/green infra needed at this scale.

---

## 6. Backups, TLS, monitoring, security

- **Backups** (contract §Shared components #4): enable hPanel weekly VPS snapshots (shared); Fluence owns a **nightly `pg_dump` of the `fluence` DB into `/backups/fluence/`** + rotates. Also back up the license signing key out-of-band (its loss is unrecoverable).
- **TLS:** shared Caddy + Let's Encrypt; nothing Fluence-specific.
- **Monitoring** (contract §Rules #7): contribute to the shared Netdata/`ctop`. Watch two Fluence signals: `fluence-api` CPU (license/auth spikes at launches/sales) and `/downloads` **bandwidth + disk** on the shared 100 GB NVMe.
- **Security:**
  - Agent installers are **OS-code-signed** *and* served over TLS; the `/update` manifest is **signed** and the Agent verifies it (supply-chain integrity for the localhost bridge, `M4-T01`).
  - Licensing: server holds the **private** signing key; clients verify with the embedded public key; **offline grace** so activation never breaks offline use (`CM-T01`).
  - `fluence-api` rate-limited (Redis) and idempotent webhooks; no service publishes a host port; API validates the Origin.

---

## 7. Bandwidth & disk watch-item (the realistic pressure)

Agent installers across 3 OSes × versions accumulate on the shared **100 GB NVMe**, and downloads eat into the **8 TB** shared bandwidth. This — not CPU or RAM — is Fluence's most likely way to strain the shared box. Mitigation ladder, cheapest first:
1. Prune old Agent versions; keep latest + N-1 on-box.
2. Move `/downloads` to **object storage + CDN**, leave only the signed `/update` manifest on-box.
3. Only if that's insufficient, split (below).

---

## 8. When Fluence should get its own box

Per the contract's split triggers, extract Fluence to a dedicated KVM when any of:
- Sustained CPU contention or p95 interactive-latency degradation visible in monitoring.
- Fluence's RAM budget regularly exceeded (unlikely given §3).
- **We add paid cloud project-sync or any server-side geometry/preview rendering** — this is the big one: it converts Fluence from a light static+API tenant into a storage/CPU-heavy service and is the natural moment to split.
- `/downloads` bandwidth/disk keeps pressuring the shared NVMe after the §7 ladder.

Extraction is cheap by design (contract §Design for extraction): new KVM, `docker compose up` the Fluence stack, point DNS + shared-proxy hostnames at the new box, restore the `fluence` DB dump. An afternoon.

---

## 9. Infra task cards (plug into `03-implementation-plan.md` workflow)

Same card format as the implementation plan. These belong to **M0** (foundations) and **M4/M9** (Agent hosting, hardening). Refs: CH = cohabitation plan, D = dev plan, F = feasibility.

- [ ] **INF-T01 — Fluence compose stack + shared-network wiring** — `apps/deploy/fluence/` compose with `fluence-web`/`fluence-api`(/`redis`), joined to `shared_proxy`, using shared Postgres `fluence` DB; explicit `mem_limit`/`cpus` per §3; no published host ports. Deps: M0-T01. Refs: CH §Shared/§Budget/§Rules, §4 here. Accept: `docker compose up` on a test box; proxy routes reach `fluence-web`; API connects to `fluence` DB only. Verify: compose config lint + integration smoke.
- [ ] **INF-T02 — Shared Caddy route request (coordinated)** — add `fluence.io`/`app.`/`api.`/`downloads.` hostnames to the shared proxy config via the coordination checklist; TLS auto. Deps: INF-T01. Refs: CH §Coordination checklist. Accept: all hostnames resolve with valid TLS to the right internal port; documented in the shared proxy stack. Verify: curl/https checks.
- [ ] **INF-T03 — Licensing/DRM service with offline grace** — `fluence-api` license issue/verify, 3-seat management, signed licenses, offline grace; `fluence` schema + migrations. Deps: INF-T01, CM-T01. Refs: F§8, D§9, §6 here. Accept: license validates offline within grace; seat limit enforced; keys never in git. Verify: license matrix incl. offline; secret-scan clean.
- [ ] **INF-T04 — Agent download + signed update feed** — `/downloads` volume + signed `/update` manifest; Agent verifies signature. Deps: M4-T01, INF-T01. Refs: F§4, §6/§7 here. Accept: Agent installs from `/downloads` over TLS and auto-updates against a signed manifest; tamper rejected. Verify: update-flow e2e + signature-tamper test.
- [ ] **INF-T05 — CI/CD deploy pipeline (stay-in-lane)** — build web+WASM+API+signed Agent; run offline+golden gates; deploy only the Fluence stack; SW cache-bust; nightly `fluence` `pg_dump` to `/backups/fluence/`. Deps: INF-T01..T04. Refs: CH §Backups/§Rules #1, §5 here. Accept: green pipeline deploys without touching LaserReady/proxy; rollback by tag; backup cron verified. Verify: dry-run deploy + restore-from-dump test.
- [ ] **INF-T06 — Monitoring hooks + download offload readiness** — surface `fluence-api` CPU and `/downloads` bandwidth/disk in the shared monitor; object-storage/CDN switch ready to flip per §7. Deps: INF-T01. Refs: CH §Rules #7/§When to split, §7/§8 here. Accept: Fluence metrics visible in shared Netdata/ctop; CDN offload documented + one config flag away. Verify: metrics present; offload runbook reviewed.

---

## 10. Summary

Fluence slots into the shared KVM 2 as the **easy, light tenant**: a static PWA + a small stateful licensing/accounts API + a share of the shared Postgres, all inside its own extractable compose stack behind the shared Caddy, using the editor port range and explicit resource caps. It keeps interactive CPU priority but won't hog it, because the heavy lifting is in the browser. It honors every house rule (stay in lane, capped containers, no host ports, secrets local, design for extraction) and **preserves the offline invariant**. The realistic pressure is **Agent-download bandwidth/disk**, addressed by a CDN offload before any split; the natural trigger to give Fluence its own box is adding **cloud project-sync**.
