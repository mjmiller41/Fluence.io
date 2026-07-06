# Decision Log — Fluence.io

How this project came to be, and the decisions that define it. Distilled from the originating research + planning conversation. ADR-style: each entry is a decision, its context, and its consequence. Append new entries as the project evolves; don't rewrite history.

---

## Genesis
Fluence began as a feasibility question: *is it possible to build a browser-based / installable-PWA clone of LightBurn with full offline capabilities?* Scope was pinned via an upfront clarification: **GRBL-first, phased to Ruida DSP and galvo/fiber; commercial product; delivered as an in-depth report.** Five parallel research streams (browser hardware access, phased hardware roadmap, offline/WASM architecture, feature-parity gaps, legal/market) fed a cited feasibility study, which then became a development plan, an implementation backlog, a deployment plan, and this repo.

---

## D-001 — Build it, but as "web app + optional native Agent," not browser-only
- **Context:** Browsers cannot open raw UDP sockets (only HTTP/WS/WebRTC/WebTransport). Ruida DSP's common transport is Ethernet/UDP (ports 50200/40200); galvo boards are proprietary vendor USB. GRBL, by contrast, is USB serial and fully reachable via Web Serial.
- **Decision:** Two artifacts — a Chromium PWA (App) and a signed native localhost-WSS **Agent**. The App works fully without the Agent; only Ruida/galvo require it.
- **Consequence:** Same architecture LightBurn uses (its "Bridge"). Unblocks a pure-web GRBL product now and a parity DSP/galvo product later. Verdict: **conditionally GO.**

## D-002 — Chromium desktop is the target; no Safari/iOS, don't rely on Firefox
- **Context:** Web Serial / WebUSB are Chromium-only; WebKit is "opposed"; Firefox support is nascent/contested.
- **Decision:** Target Chrome/Edge desktop. Treat this as a permanent, documented constraint, messaged clearly.
- **Consequence:** Narrower TAM than a native app, offset by cross-platform + offline. Not a bug to fix — a boundary to state.

## D-003 — GRBL over Web Serial is the MVP; DSP/galvo are phased behind the Agent
- **Context:** GRBL char-counting streaming + real-time jog bytes are viable in-browser today; no mature pure-browser Web Serial laser suite exists (incumbents are Electron or local-server bridges).
- **Decision:** Ship GRBL first (~month 7) as the first revenue gate; add Ruida (M4) then galvo (M7) via the Agent.
- **Consequence:** Early differentiation in an open niche; revenue funds the harder phases.

## D-004 — Offline is an invariant, not a feature
- **Context:** Glowforge's cloud-lock is a documented, persistent user grievance; offline is Fluence's edge.
- **Decision:** No code path may hard-depend on a network request. Enforced by a CI test (`pnpm e2e:offline`) that must stay green — even through deployment.
- **Consequence:** Shapes storage (OPFS + IndexedDB, `navigator.storage.persist()` auto-granted on PWA install), licensing (offline grace), and CI.

## D-005 — Heavy compute is client-side WASM in Web Workers
- **Context:** WASM runs ~1.3–2.5× slower than native — fast enough for 2D laser CAM (Figma's C++→WASM engine is the precedent). Clipper2 (boolean/offset/kerf), VTracer/Potrace (raster→vector) port cleanly; CGAL/WASM does not (no FP rounding-mode control) and isn't needed.
- **Decision:** Geometry core in WASM, run in Workers; render via WebGL/WebGPU on OffscreenCanvas; never block the main thread.
- **Consequence:** Also makes the *server* light — the key deployment insight (D-009).

## D-006 — Device abstraction is sacred
- **Decision:** UI/CAM never know the transport. Everything hardware goes through one `Device` interface in `packages/device-core`; `WebSerialTransport` and `AgentTransport` are pluggable.
- **Consequence:** GRBL ships with zero Agent dependency; DSP/galvo drop in behind the same interface without touching UI/CAM.

## D-007 — Near-full parity is the goal, pursued asymptotically
- **Context:** LightBurn is ~8–9 years of work by a single-digit team.
- **Decision:** Target ≥90% of a concrete parity checklist across all three hardware classes by GA (~months 22–24); treat the last ~10% (camera edge cases, exotic controllers, firmware quirks) as continuous, not a gate. Camera lens-correction (OpenCV.js) is the single hardest subsystem.
- **Consequence:** Every parity-checklist row maps to a task in `docs/03`; the plan is honest about the asymptote.

## D-008 — Legal posture: clean-room + interoperability reverse-engineering
- **Context:** Functionality/protocols aren't copyrightable; *Sega v. Accolade* and *Sony v. Connectix* support intermediate copying for interoperability; MeerK40t/galvoplotter already RE'd these protocols openly.
- **Decision:** Clean-room reimplementation; reverse-engineer the *machine* protocols (not LightBurn's app); avoid the "LightBurn" trademark and any encrypted-handshake circumvention (DMCA). Run a USPTO patent clearance before GA (`CM-T04`). Not legal advice — counsel reviews before launch.
- **Consequence:** A defensible, documented risk posture.

## D-009 — Deploy on a shared Hostinger KVM 2 as the light "Editor" tenant
- **Context:** Because compute is client-side (D-005), Fluence's server footprint is small: static PWA + a licensing/accounts API + a share of a shared Postgres. It cohabits with **LaserReady** under one shared Caddy proxy on a 2 vCPU · 8 GB box.
- **Decision:** Own extractable compose stack (`apps/deploy/fluence/`), ports 8000–8099, no published host ports, separate `fluence` DB, secrets in git-ignored `.env`, explicit `cpus`/`mem_limit`. Governed by the shared-VPS contract (`docs/05`).
- **Consequence:** Fluence is the easy neighbor; the realistic pressure is Agent-download bandwidth/disk (mitigate with CDN offload before splitting). Cloud project-sync would be the trigger to split.

## D-010 — Name: Fluence (fluence.io)
- **Context:** Working codename during planning was "WebBurn."
- **Decision:** Renamed to **Fluence**; project file format `.fluence`; repo `git@github.com:mjmiller41/Fluence.io.git`.
- **Consequence:** All docs updated; "WebBurn" retired.

## D-011 — Author docs for Claude Code / Fable 5 execution
- **Decision:** The implementation plan (`docs/03`) is a backlog of self-contained task cards (*Goal · Deps · Refs · Files · Accept · Verify*), one per agent session; `CLAUDE.md` at the repo root carries the invariants, stack, and Definition of Done and is auto-loaded.
- **Consequence:** The plan is directly executable by an agentic coding tool, not just readable.

---

## Open items to close before/at GA
- USPTO patent clearance + clean-room attestations (`CM-T04`).
- Confirm live LightBurn pricing/renewal figures at commercialization time.
- Decide telemetry (external SaaS assumed) and whether cloud project-sync is in scope (would trigger a VPS split).
- SSH key configured; `main` pushed to the GitHub remote.
