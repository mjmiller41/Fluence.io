# LaserKerf — Documentation

**LaserKerf** (laserkerf.io) is an offline-first, installable PWA that clones LightBurn (laser design + CAM + machine control) as closely as practical, with a signed native companion Agent for hardware the browser can't reach (Ruida DSP, galvo/fiber). Commercial product, GRBL-first, phased to full parity.

> Legal note: all IP/legal content is general information, not legal advice. Never use the "LightBurn" trademark, logo, icons, or copied UI art. Have IP counsel review before launch.

## Documents

1. **[01-feasibility-study.md](./01-feasibility-study.md)** — Go/no-go analysis. The central constraint (no raw UDP in browsers), hardware reachability, offline/WASM architecture, feature-parity map, legal & market read.
2. **[02-development-plan.md](./02-development-plan.md)** — Engineering roadmap. Architecture, monorepo, tech stack, team, milestones M0–M9 with exit criteria, parity checklist, testing, risk register, timeline.
3. **[03-implementation-plan.md](./03-implementation-plan.md)** — Claude Code / Fable 5 execution backlog. Every feature decomposed into ~55 task cards (Goal · Deps · Refs · Files · Accept · Verify) across M0–M9 + commercialization.
4. **[06-decision-log.md](./06-decision-log.md)** — How the project came to be: decisions + rationale (from the originating conversation).
5. **[CLAUDE.md](../CLAUDE.md)** — Project memory auto-loaded by Claude Code: architecture invariants, locked stack, repo layout, verify commands, Definition of Done.

Deployment is documented in [`DEPLOY.md`](../DEPLOY.md) at the repo root (single source of truth).

## Status & where to build next
In implementation: M0 (Foundations) complete; M1 (design/vector) and M2 (CAM/G-code) in progress; M3 (GRBL control → MVP) next. The `M0-T05` Clipper2→WASM-in-a-worker de-risk is done; `M3-T02` (Web Serial character-counting on real GRBL hardware) remains the biggest unproven risk to de-risk early. See [03-implementation-plan.md](./03-implementation-plan.md) for the live checkbox state.

## The one permanent constraint
LaserKerf targets **Chromium desktop** (Chrome/Edge). No Safari/iOS; Firefox is not relied upon. This is structural (Web Serial / WebUSB are Chromium-only) and is offset by the product's edge: genuinely cross-platform + fully offline, which neither LightBurn (desktop-only, dropped Linux) nor Glowforge (cloud-locked) offers.
