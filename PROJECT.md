# Fluence.io — Project Charter

**One line:** An offline-first, installable web app (PWA) that clones LightBurn — laser design + CAM + machine control — with a signed native companion Agent for the hardware a browser can't reach.

**Status:** Pre-implementation. Planning complete; next action is `M0-T01` in `docs/03-implementation-plan.md`.
**Repo:** `git@github.com:mjmiller41/Fluence.io.git` (`main`).
**Owner:** Michael J. Miller. Commercial product. Not affiliated with LightBurn; uses none of its trademark, logo, icons, or UI art.

---

## Why this exists (the opportunity)
There is a real, unoccupied seam in the laser-software market: **LightBurn** is paid, desktop-only, and dropped Linux; **Glowforge**'s app is web-based but cloud-locked and unusable offline. Nobody ships a polished, cross-platform tool that is both **web-delivered and fully offline**. `MeerK40t` proves the hardware reverse-engineering is legally and technically traveled, but it's desktop Python — the web niche is open. Fluence occupies that seam.

## The one constraint that shapes the whole product
Browsers can talk to serial and USB (Chromium's Web Serial / WebUSB) but **cannot open raw UDP sockets**. GRBL (USB serial) is fully reachable from the browser; **Ruida DSP over Ethernet/UDP and galvo/fiber over vendor USB are not**. Therefore Fluence is **two artifacts, by design**:

- **The App** — a Chromium PWA (React/TS + WASM geometry) that runs fully offline and does all design, CAM, and GRBL control.
- **The Agent** — a small signed, auto-updating native binary exposing a `wss://localhost` bridge, used only for Ruida and galvo. This mirrors LightBurn's own "Bridge."

The App must always work with the Agent absent. GRBL never needs it.

## Who it's for
Hobbyist and prosumer laser owners (diode/CO2/fiber), the fast-growing xTool/Ortur/OMTech/Glowforge installed base — users who want a cross-platform, offline, no-lock-in tool.

## Product shape & pricing anchor
Perpetual license + annual updates (or subscription), tiered like the market: a GCode/GRBL "Core"-equivalent and a DSP+galvo "Pro"-equivalent. Anchor to LightBurn (Core ~$99 / Pro ~$199 / ~$40-yr updates).

## Roadmap at a glance (see `docs/02` and `docs/03`)
Milestones **M0–M9**, two commercial gates:
- **~Month 7 — GRBL MVP ships** (design + CAM + Web Serial control, fully offline). First revenue + real-user feedback.
- **~Months 22–24 — near-full-parity GA** across GRBL, Ruida (Agent), and galvo (Agent), with camera alignment and full image-engraving parity.
- Full 1:1 parity with an 8-year native app is an asymptote; the last ~10% is treated as continuous.

## Two permanent, documented trade-offs
1. **Chromium desktop only** (no Safari/iOS; Firefox not relied on) — structural, since Web Serial/WebUSB are Chromium-only.
2. **A native Agent** is required for DSP/galvo — the same shape LightBurn uses.
Both are offset by the thing neither competitor offers: genuinely cross-platform + fully offline.

## Tech stack (locked; see `CLAUDE.md`)
React/TS + Zustand · WebGL2/WebGPU on OffscreenCanvas · Clipper2/VTracer/custom-dither → **WASM in Web Workers** · OPFS + IndexedDB · Workbox service worker (offline) · Web Serial (GRBL) · Rust Agent (tokio/tungstenite/rusb) for Ruida UDP + galvo USB · pnpm + Turborepo monorepo.

## Deployment
Initial: a **shared Hostinger KVM 2** (2 vCPU · 8 GB) cohabited with **LaserReady**; Fluence is the light "Editor" tenant (heavy compute is client-side). See `docs/04` + the shared-VPS contract `docs/05`.

## Project structure
```
CLAUDE.md            Project memory for Claude Code (instructions / how to work)
PROJECT.md           This charter (the front door)
README.md            Repo landing page
docs/
  README.md          Docs index
  01-feasibility-study.md      Go/no-go analysis, constraints, market/legal
  02-development-plan.md        Architecture, milestones M0–M9, parity checklist
  03-implementation-plan.md     Executable task backlog (Claude Code task cards)
  04-deployment-plan.md         Shared KVM 2 deployment + INF task cards
  05-server-cohabitation-plan.md  Shared-VPS infra contract
  06-decision-log.md            How we got here — decisions + rationale (this chat)
```

## How to work in this project
Read `CLAUDE.md` first (auto-loaded by Claude Code). Do one task card per session from `docs/03-implementation-plan.md`, `/clear` between cards, reference the task ID, keep `pnpm e2e:offline` green. Decisions and their rationale live in `docs/06-decision-log.md` — add to it when you make a call that future-you would want explained.

## Immediate next steps
`M0-T01` (monorepo scaffold) → de-risk early with `M0-T05` (Clipper2→WASM in a worker) and `M3-T02` (Web Serial character-counting on a real GRBL board). Before GA: `CM-T04` (USPTO patent clearance + clean-room attestation).
