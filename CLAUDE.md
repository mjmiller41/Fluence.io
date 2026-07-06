# CLAUDE.md — Fluence

> Auto-loaded by Claude Code. Keep this short, factual, and current — it is the source of truth for HOW to work in this repo. The executable task backlog is `docs/03-implementation-plan.md`; the "why" is `docs/01-feasibility-study.md` + `docs/02-development-plan.md`.

## Project
- **Name:** Fluence (fluence.io). **Repo:** `git@github.com:mjmiller41/Fluence.io.git` (branch `main`).
- **What:** offline-first, installable **PWA** cloning LightBurn (laser design + CAM + machine control), plus a signed native companion **Agent** for hardware the browser can't reach (Ruida DSP, galvo/fiber). Commercial, GRBL-first, phased to parity.
- **Legal:** not affiliated with LightBurn. Never use the "LightBurn" trademark, logo, icons, or copied UI art.
- **Status:** in implementation. M0 (Foundations) complete; M1 (design/vector) and M2 (CAM/G-code) in progress; M3 (GRBL control → MVP) next. See `docs/03-implementation-plan.md` for the live checkbox state.

## Docs (read the relevant one before non-trivial work)
- `docs/01-feasibility-study.md` — constraints, market, legal.
- `docs/02-development-plan.md` — architecture, milestones M0–M9, parity checklist, risk register.
- `docs/03-implementation-plan.md` — the task backlog. Cards: *Goal · Deps · Refs · Files · Accept · Verify*. One card per session; `/clear` between; mark `[x]` + commit with the task ID.
- `docs/04-deployment-plan.md` — shared Hostinger KVM 2 deployment + infra cards `INF-T01..T06`.
- `docs/05-server-cohabitation-plan.md` — the shared-VPS contract (Fluence = the "Editor" tenant).

## Non-negotiable architecture invariants
1. **Two artifacts:** `apps/web` (PWA) and `apps/agent` (native Rust bridge). The web app MUST work with the Agent absent — only Ruida/galvo require it. GRBL never does.
2. **Device abstraction is sacred.** UI/CAM code MUST NOT know the transport. All hardware goes through `packages/device-core` `Device`. Transports (`WebSerialTransport`, `AgentTransport`) are pluggable.
3. **Offline is an invariant, not a feature.** No code path may hard-depend on a network request to function. The offline CI test (`pnpm e2e:offline`) MUST stay green.
4. **All heavy compute runs in Web Workers** — geometry (WASM), rendering (OffscreenCanvas), device streaming loops. Never the main thread.
5. **Machine output is golden-tested.** Any change to CAM/codec output must match or update golden fixtures. Never change a golden without a note in the commit body.
6. **The Agent is an attack surface.** Localhost WSS only, origin-locked, token-paired, signed binary, no arbitrary command execution. Security-review any Agent change.
7. **Browser target is Chromium desktop (Chrome/Edge).** No Safari/iOS; do not rely on Firefox. Web Serial + WebUSB are Chromium-only.

## Tech stack (do not swap without an ADR)
- UI: React + TypeScript + Zustand (immer). Vite.
- Render: WebGL2 now; WebGPU behind `FEATURE_WEBGPU`. OffscreenCanvas + Comlink workers.
- Geometry: **Clipper2** (boolean/offset/kerf) → WASM. Raster→vector: **VTracer** (Rust→WASM), Potrace fallback. Dithering: custom Rust→WASM.
- Fonts: opentype.js + custom SHX parser. CV: OpenCV.js (WASM) + AprilTag.
- Storage: **OPFS** for project blobs, **IndexedDB** for metadata. Workbox service worker for offline shell + WASM precache.
- Device: **Web Serial** for GRBL. **Agent** (Rust: tokio, tungstenite, rusb) for Ruida (UDP 50200/40200) + galvo (libusb/WinUSB).
- Monorepo: pnpm + Turborepo. Node 20+, Rust stable, Emscripten for C++→WASM.

## Rejected (do not reintroduce)
Electron for the main app · CGAL/WASM (no FP rounding-mode control) · WebUSB as the primary GRBL path (use Web Serial) · any mandatory cloud dependency.

## Repo layout
```
apps/web            PWA
apps/agent          Rust native companion + updater
apps/deploy/fluence Docker Compose stack for the shared VPS (see docs/04)
packages/geometry-wasm   Clipper2/offset/dither/planner → WASM
packages/device-core     Device interface + transports
packages/protocols       grbl, ruida, galvo/ezcad codecs (TS + Rust)
packages/fileformats     .fluence, .lbrn import, svg/dxf/ai/pdf import, gcode/rd export
packages/ui-kit          shared components, canvas widgets
packages/cv              OpenCV.js camera calibration wrappers
tools/                   build, codegen, protocol test rigs
e2e/                     Playwright + hardware-in-the-loop (HIL)
docs/                    planning docs (source of truth for scope)
```

## Commands (aspirational — `M0-T01` lands the real scripts; keep this list current as they land)
- Install: `pnpm install`
- Dev web: `pnpm --filter web dev`
- Build all: `pnpm turbo build`
- Unit tests: `pnpm turbo test`
- Golden CAM tests: `pnpm --filter fileformats test:golden`
- Offline invariant (Playwright, network blocked): `pnpm e2e:offline`
- Protocol conformance: `pnpm --filter protocols test:conformance`
- Agent build+sign smoke: `pnpm --filter agent verify`
- Lint/format/typecheck (before every commit): `pnpm turbo lint typecheck`

## Definition of Done (every task)
- Code + tests; `pnpm turbo lint typecheck test` green; relevant golden/conformance/offline suites green.
- No new main-thread heavy compute. No new network hard-dependency. Device code only via `device-core`.
- The task's Acceptance Criteria (in `docs/03-implementation-plan.md`) all pass.
- If machine output changed, golden fixtures updated with a note in the commit body.

## Working style for Claude Code
- Do ONE task card per session; `/clear` between cards. Reference the task ID (e.g. `M1-T03`, `INF-T01`).
- Read the card's "Refs" in the source docs before coding.
- Small PRs mapped 1:1 to task cards. Update the card's checkbox in `docs/03-implementation-plan.md` when done.
- If a task is bigger than one session, split it and note the split in the plan.

## Deployment (shared VPS — read `docs/04-deployment-plan.md` + `docs/05-server-cohabitation-plan.md`)
Fluence initially deploys to a **shared Hostinger KVM 2** (2 vCPU · 8 GB) cohabited with **LaserReady**. Fluence is the "Editor" tenant. Hard rules on that box:
- **Stay in your lane.** Only touch `apps/deploy/fluence/`. Never modify LaserReady's containers/DB or the shared Caddy/Postgres without coordinating.
- **No published host ports.** Shared Caddy is the only public entry; Fluence internal ports live in **8000–8099**.
- **Explicit `cpus` + `mem_limit` on every service.** Fluence is a light tenant (static PWA + small licensing/accounts API); heavy compute is client-side.
- **Shared Postgres, separate `fluence` DB only.** No cross-DB access.
- **Secrets in Fluence's git-ignored `.env`** (esp. the license signing key). Never commit/share.
- **Design for extraction.** Own repo + own compose + own subdomains → liftable to a dedicated box in an afternoon.
- Deploy must keep `pnpm e2e:offline` green — the offline invariant survives deployment.
Infra tasks: `INF-T01..T06` in `docs/04-deployment-plan.md §9`.
