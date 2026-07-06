# CLAUDE.md — Fluence project memory

> Auto-loaded by Claude Code. Keep this file short, factual, and current. It is the source of truth for how to work in this repo. The full task backlog lives in `IMPLEMENTATION_PLAN.md`; the "why" lives in `browser-lightburn-clone-feasibility.md` and `development-plan.md`.

## What we're building
An offline-first, installable **PWA** that clones LightBurn (laser design + CAM + machine control) as closely as practical, plus a signed **native companion Agent** for hardware the browser can't reach. Commercial product. Product name **Fluence** (fluence.io). Never use the "LightBurn" trademark, logo, icons, or copied UI art.

## Non-negotiable architecture invariants
1. **Two artifacts:** `apps/web` (the PWA) and `apps/agent` (native Rust bridge). The web app MUST work with the Agent absent — only Ruida/galvo require it. GRBL never does.
2. **Device abstraction is sacred.** UI/CAM code MUST NOT know the transport. Everything hardware goes through `packages/device-core` `Device` interface. Transports (`WebSerialTransport`, `AgentTransport`) are pluggable.
3. **Offline is an invariant, not a feature.** No code path may hard-depend on a network request to function. There is an offline CI test that MUST stay green.
4. **All heavy compute runs in Web Workers.** Geometry (WASM), rendering (OffscreenCanvas), and device streaming loops never run on the main thread.
5. **Machine output is golden-tested.** Any change to CAM/codec output must update or match golden fixtures. Never "fix" a golden without human sign-off noted in the PR.
6. **The Agent is an attack surface.** Localhost WSS only, origin-locked, token-paired, signed binary, no arbitrary command execution. Security-review any Agent change.
7. **Browser target is Chromium desktop (Chrome/Edge).** No Safari/iOS. Do not add features that assume Firefox/Safari. Web Serial + WebUSB are Chromium-only.

## Tech stack (do not swap without an ADR)
- UI: React + TypeScript + Zustand (immer). Vite build.
- Render: WebGL2 now; WebGPU behind `FEATURE_WEBGPU` flag. OffscreenCanvas + Comlink workers.
- Geometry: **Clipper2** (boolean/offset/kerf) → WASM. Raster→vector: **VTracer** (Rust→WASM), Potrace fallback. Dithering: custom Rust→WASM.
- Fonts: opentype.js + custom SHX parser. CV: OpenCV.js (WASM) + AprilTag.
- Storage: **OPFS** for project blobs, **IndexedDB** for metadata. Workbox service worker for offline shell + WASM precache.
- Device: **Web Serial** for GRBL. **Agent** (Rust: tokio, tungstenite, rusb) for Ruida (UDP 50200/40200) + galvo (libusb/WinUSB).
- Monorepo: pnpm + Turborepo (or Nx). Node 20+, Rust stable, Emscripten for C++→WASM.

## Rejected (do not reintroduce)
Electron for the main app · CGAL/WASM (no FP rounding-mode control) · WebUSB as the primary GRBL path (use Web Serial) · any mandatory cloud dependency.

## Repo layout
```
apps/web            PWA
apps/agent          Rust native companion + updater
packages/geometry-wasm   Clipper2/offset/dither/planner → WASM
packages/device-core     Device interface + transports
packages/protocols       grbl, ruida, galvo/ezcad codecs (TS + Rust)
packages/fileformats     .fluence, .lbrn import, svg/dxf/ai/pdf import, gcode/rd export
packages/ui-kit          shared components, canvas widgets
packages/cv              OpenCV.js camera calibration wrappers
tools/                   build, codegen, protocol test rigs
e2e/                     Playwright + hardware-in-the-loop (HIL)
```

## Commands (fill in real ones as they land)
- Install: `pnpm install`
- Dev web: `pnpm --filter web dev`
- Build all: `pnpm turbo build`
- Unit tests: `pnpm turbo test`
- Golden CAM tests: `pnpm --filter fileformats test:golden`
- Offline invariant (Playwright, network blocked): `pnpm e2e:offline`
- Protocol conformance: `pnpm --filter protocols test:conformance`
- Agent build+sign smoke: `pnpm --filter agent verify`
- Lint/format/typecheck (run before every commit): `pnpm turbo lint typecheck`

## Definition of Done (every task)
- Code + tests; `pnpm turbo lint typecheck test` green; relevant golden/conformance/offline suites green.
- No new main-thread heavy compute. No new network hard-dependency. Device code only via `device-core`.
- Task's own **Acceptance Criteria** (in `IMPLEMENTATION_PLAN.md`) all checked.
- If behavior changed machine output, golden fixtures updated with a note in the commit body.

## Working style for Claude Code
- Do ONE task card per session; `/clear` between cards. Reference the task ID (e.g. `M1-T03`).
- Read the task card's "Refs" lines in the two source docs before coding.
- Prefer small PRs mapped 1:1 to task cards. Update the task's checkbox in `IMPLEMENTATION_PLAN.md` when done.
- If a task is bigger than one session, split it and note the split in the plan.

## Deployment (shared VPS — read `docs/04-deployment-plan.md` + `docs/05-server-cohabitation-plan.md`)
Fluence initially deploys to a **shared Hostinger KVM 2** (2 vCPU · 8 GB) cohabited with **LaserReady**. Fluence is the "Editor" tenant. Hard rules on that box:
- **Stay in your lane.** Only touch the Fluence compose stack (`apps/deploy/fluence/`). Never modify LaserReady's containers/DB or the shared Caddy/Postgres without coordinating.
- **No published host ports.** The shared Caddy is the only public entry; Fluence internal ports live in **8000–8099**.
- **Explicit `cpus` + `mem_limit` on every service.** Fluence is a light tenant (mostly static PWA + small licensing/accounts API); heavy compute is client-side.
- **Shared Postgres, separate `fluence` DB only.** No cross-DB access.
- **Secrets in Fluence's git-ignored `.env`** (esp. the license signing key). Never commit/share.
- **Design for extraction.** Own repo + own compose + own subdomains → liftable to a dedicated box in an afternoon.
- Deploy must keep `pnpm e2e:offline` green — the offline invariant survives deployment.
Infra tasks live as `INF-T01..T06` in `docs/04-deployment-plan.md §9`.
