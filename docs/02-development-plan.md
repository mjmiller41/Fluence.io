# Development Plan — Browser-Based LightBurn Clone (Near-Full Feature Parity)

**Project:** Fluence (fluence.io) — do not use the "LightBurn" trademark, logo, icons, or copied UI art
**Target:** Offline-first installable PWA + signed native companion agent, matching LightBurn as closely as practical.
**Model:** Commercial. Perpetual license + annual updates, or subscription.
**Companion doc:** `browser-lightburn-clone-feasibility.md` (the go/no-go analysis this plan builds on).

---

## 0. How to read this plan

The product is split into two shipping artifacts that evolve together:

- **The App** — a Chromium PWA (React/TS UI + WASM geometry core) that runs fully offline and does all design, CAM, and GRBL-over-Web-Serial control.
- **The Agent** — a small signed, auto-updating native binary (Rust or Go) exposing a `wss://localhost` bridge. It exists solely to reach hardware the browser can't: Ruida over UDP, galvo/fiber over USB, and any USB device that loses the driver-claim battle.

Everything below is organized as **epics** (durable feature areas) sequenced into **milestones** (M0–M9). Each milestone has explicit exit criteria so "done" is testable. The parity checklist in §7 is the contract for "how close to full parity."

A realistic honest framing up front: LightBurn is ~8–9 years of work by a small team. This plan reaches a **credible, shippable GRBL product in ~6–9 months** and **near-full parity across all three hardware classes in ~30–36 months** with the team in §3. Parity is approached asymptotically — the last 10% (camera edge cases, exotic controllers, decades of firmware quirks) is the expensive part and is scoped as ongoing.

---

## 1. Architecture

### 1.1 High-level topology

```
┌──────────────────────────────────────────────┐
│  THE APP  (installed PWA, Chromium desktop)   │
│                                                │
│  React/TS UI  ──►  State (Zustand/Redux)       │
│       │                                        │
│       ├─► Geometry Core (WASM, in Web Workers) │
│       │     Clipper2 · VTracer/Potrace · custom│
│       │     dithering · planner · optimizer    │
│       │                                        │
│       ├─► Renderer (WebGL/WebGPU, OffscreenCanvas)
│       │                                        │
│       ├─► Storage (OPFS blobs + IndexedDB meta)│
│       │                                        │
│       ├─► Device Layer (abstraction)           │
│       │     ├─ WebSerialTransport  → GRBL       │
│       │     └─ AgentTransport (wss) ┐          │
│       └─► Service Worker (offline shell + WASM) │
└──────────────────────────────────────────────┘
                                     │ wss://localhost:PORT
                        ┌────────────▼───────────────┐
                        │  THE AGENT (native, signed) │
                        │  Rust/Go                     │
                        │  ├─ Ruida UDP codec (50200)  │
                        │  ├─ Galvo USB (libusb/WinUSB)│
                        │  ├─ Serial fallback          │
                        │  └─ Auto-update + attest     │
                        └──────────────┬───────────────┘
                             UDP / USB │
                        ┌──────────────▼───────────────┐
                        │  Lasers: GRBL · Ruida · Galvo │
                        └───────────────────────────────┘
```

### 1.2 Key architectural rules

- **The Device Layer is a strict abstraction.** UI and CAM never know whether a machine is reached via Web Serial or the Agent. A `Device` exposes `connect/disconnect/stream/jog/frame/status/home/stop`. Transports are pluggable. This lets GRBL ship first with zero agent dependency and lets Ruida/galvo drop in behind the same interface.
- **All heavy compute runs in Web Workers**, never the main thread. The geometry core is a single WASM module with a typed message API. Rendering uses OffscreenCanvas in its own worker.
- **The App must function with the Agent absent.** Agent is detected via a localhost handshake; if missing, DSP/galvo features show an "install companion" flow. GRBL never needs it.
- **Offline is a first-class invariant**, tested in CI (see §8). No feature may hard-depend on a network call.
- **The file format is open and versioned** from day one (`.fluence`, a zipped JSON + assets). Also import LightBurn `.lbrn`/`.lbrn2` (XML) and export G-code / `.rd` (Ruida) / galvo job files.

### 1.3 Monorepo layout

```
/apps
  /web            React/TS PWA
  /agent          Rust native companion (tauri-less; just a service + updater)
/packages
  /geometry-wasm  C++/Rust → WASM (Clipper2, offset, dithering, planner)
  /device-core    TS device abstraction + transports (webserial, agent-ws)
  /protocols      Ruida codec, GRBL codec, galvo/EZCAD codec (shared TS + Rust)
  /fileformats    .fluence, .lbrn import, svg/dxf/ai/pdf import, gcode/rd export
  /ui-kit         shared components, canvas widgets
  /cv             OpenCV.js wrappers for camera calibration
/tools            build, codegen, protocol test rigs
/e2e             Playwright + hardware-in-the-loop harness
```

Single monorepo (pnpm + Turborepo or Nx). Protocol logic is authored once and shared between the App (TS/WASM) and the Agent (Rust) via a codegen'd spec where feasible, to avoid drift.

---

## 2. Tech stack (decisions, not options)

| Concern | Choice | Rationale |
|---|---|---|
| UI | React + TypeScript | Team availability, ecosystem, precedent (Figma) |
| State | Zustand (+ immer) | Lightweight, worker-friendly; Redux if team prefers |
| Canvas/render | WebGL2 now, WebGPU behind a flag | Scales to thousands of paths; WebGPU as it matures |
| Off-main-thread | Web Workers + OffscreenCanvas + Comlink | Keep 60fps under CAM load |
| Geometry | **Clipper2** (boolean/offset/kerf) compiled to WASM | Proven, exact-enough, MIT/BSL |
| Raster→vector | **VTracer** (Rust→WASM), Potrace fallback | O(n) vs O(n²); import trace |
| Dithering | Custom Rust→WASM (all 10 modes) | No off-the-shelf lib; sequential error diffusion needs WASM speed |
| Fonts | opentype.js + custom SHX parser | System + single-line/engraving fonts |
| CV / camera | OpenCV.js (WASM) + AprilTag detector | Lens calibration + alignment homography |
| Storage | OPFS (blobs) + IndexedDB (metadata) | 100MB write ~90ms OPFS vs ~850ms IDB |
| Offline | Workbox service worker | App shell + WASM precache |
| Device (GRBL) | Web Serial API | Only viable pure-browser door |
| Agent | **Rust** (tokio, tungstenite, rusb) | Perf, single static binary, strong USB/UDP libs, easy signing |
| Agent transport | WSS on 127.0.0.1, token-paired to the App | Localhost bridge, origin-locked |
| Licensing/DRM | Server-issued signed license + offline grace | Perpetual+updates model |
| CI | GitHub Actions + Playwright + hardware runners | Incl. offline + HIL tests |
| Packaging | PWA (web) + code-signed installers per-OS (agent) | Win/macOS/Linux agents |

**Explicitly rejected:** Electron for the main app (defeats the web/offline differentiation); CGAL/WASM (WASM lacks FP rounding-mode control, breaks its exact arithmetic — and 2D laser CAM doesn't need B-rep); WebUSB as the *primary* GRBL path (Web Serial is cleaner; WebUSB reserved for galvo).

---

## 3. Team & roles

Minimum viable team to hit the timeline (scale up for speed):

- **1 Tech lead / architect** — device abstraction, protocol correctness, release engineering.
- **2 Frontend/graphics engineers** — canvas editor, node editing, rendering, UI.
- **1 Systems/WASM engineer** — geometry core, dithering, planner, C++/Rust↔WASM.
- **1 Native/protocols engineer** — the Agent, Ruida/galvo reverse-engineering & codecs (from M4).
- **1 CV engineer (part-time / contract from M5)** — camera calibration pipeline.
- **1 QA/test engineer** — HIL harness, Playwright, offline/regression suites (from M2).
- **Fractional:** product/UX, technical writer (docs are a parity feature), IP counsel (clean-room oversight).

Phase 1 (MVP) can run with 3–4 people; Phases 2–3 need the native + CV specialists added.

---

## 4. Cross-cutting foundations (built in M0, maintained forever)

These aren't features but they gate quality and must exist before feature work scales:

1. **Device abstraction + fake device.** A simulator implementing the `Device` interface so CAM/UI can be built and tested with no hardware.
2. **Hardware-in-the-loop (HIL) test rig.** At least one real GRBL board, one Ruida (or the MeerK40t Ruida emulator), and one galvo board on a CI runner. Emulators first, real iron before each hardware milestone ships.
3. **Golden-output tests.** Given design X + settings Y, the emitted G-code/`.rd`/galvo job must byte-match (or tolerance-match) a stored golden. This is how you prevent silent CAM regressions.
4. **Offline invariant test.** Playwright run with network fully blocked after install; the full design→simulate flow must pass.
5. **Protocol conformance suites** per controller, validated against captured real traffic and the emulators.
6. **Coordinate/units correctness harness.** mm/inch, origin/job-origin, workspace transforms — a class of bugs that erodes trust fast.
7. **Crash-safe autosave** to OPFS from day one (protect user work; auto-persist granted by PWA install).

---

## 5. Milestone roadmap

Durations assume the §3 team; they overlap where dependencies allow.

### M0 — Foundations (weeks 1–6)
Monorepo, CI, service worker offline shell, OPFS/IndexedDB persistence, the `Device` abstraction + fake device, WASM build pipeline, golden-output and offline test harnesses.
**Exit:** empty app installs as a PWA, runs offline, saves/loads a `.fluence`, fake device streams to a simulator, CI green incl. offline test.

### M1 — Design & vector engine (weeks 5–16, overlaps M0)
Canvas editor: select/move/scale/rotate/align/distribute; primitives (rect, ellipse, polygon, line, bezier); **node editing**; **boolean ops + weld** (Clipper2); **offset/kerf**; grouping; text + system fonts + **single-line/SHX**; layers panel; undo/redo; snapping/guides; SVG/DXF/AI/PDF import; PNG/JPG import.
**Exit:** a user can draw, import, and edit a real project to LightBurn-comparable fidelity; boolean/offset match golden geometry; node editor handles all segment types.

### M2 — CAM core & G-code (weeks 14–24)
Layer cut modes (**Line, Fill, Offset Fill, Fill+Line via sub-layers**); per-layer cut settings (speed, min/max power, passes, interval, air assist, fill grouping); **cut-order optimization**; **material library** (presets, import/export); **material test grid generator**; **art library**; coordinate/origin/optimization settings; G-code generation + **live path simulation/preview**.
**Exit:** golden G-code matches for representative jobs; simulator shows accurate travel/cut ordering; material library + test grid usable end-to-end. QA engineer onboarded, regression suite live.

### M3 — GRBL real-time control (weeks 22–30) → **MVP / first commercial release candidate**
Web Serial transport; **character-counting streaming**; real-time jog/feed-hold/resume/soft-reset/status polling in a Worker; console; framing/outline; homing; alarm/error handling; reconnection; device profiles (GRBL, GRBL-M3, GRBL-LPC, Smoothieware, Marlin, Cohesion3D).
**Exit:** reliable multi-hour engrave on real GRBL hardware without buffer stalls; jog latency indistinguishable from native in blind test; passes HIL soak test. **Ship the GRBL product (public beta/paid).**

### M4 — The Agent + Ruida DSP (weeks 30–46)
Signed native Agent (Win/macOS/Linux) with localhost WSS, token pairing, auto-update; **Ruida codec** (checksum + swizzle, 0xCC/0xCF ACK/resend) over UDP 50200/40200; USB serial fallback; `.rd` export + direct send; DSP device profiles (Ruida; then Trocen, TopWisdom); DSP-specific origin/job settings; DSP **rotary** setup.
**Exit:** cut a real job on a physical Ruida via the Agent; protocol conformance suite passes against emulator + real traffic captures; Agent install/pair/update flow is one-click and code-signed.

### M5 — Camera alignment & lens correction (weeks 40–54, overlaps M4)
`getUserMedia` capture; **lens calibration** wizard (AprilTag/circle-grid, ~9 captures, distortion-coefficient solve to <0.5px reprojection) via OpenCV.js/WASM; **camera alignment/homography** overlay of live bed onto workspace; official-camera presets; capture-to-trace workflow.
**Exit:** end-to-end place-image-on-bed-and-cut with alignment error within LightBurn tolerance on a real camera+bed; calibration reproducible across sessions.

### M6 — Image engraving parity (weeks 46–56)
All dither modes in WASM: **Threshold, Ordered, Atkinson, Floyd–Steinberg ("Dither"), Stucki, Jarvis, Newsprint, Halftone (variable cell/angle), Sketch (edge detect), Grayscale/3D (power-modulated)**; pass-through, negative, bi-directional fill, overscan, DPI/line-interval, scan angle, ramp (rubber stamp), Z-offset.
**Exit:** side-by-side engraves visually match LightBurn output for each mode; interactive re-dither of a high-res image stays responsive (WASM/worker).

### M7 — Galvo / fiber (weeks 54–72)
Agent USB path for **BJJCZ/EZCAD2** boards (libusb/WinUSB, BULK endpoints, dongle handling); WebUSB fallback where the OS permits; galvo job encoder; galvo-specific settings (lens/field size, wobble, marking passes); **galvo rotary**; galvo material presets.
**Exit:** mark a real fiber/CO2 galvo job via the Agent; conformance vs captured EZCAD2 traffic; driver-install guidance (WinUSB/Zadig) integrated into onboarding.

### M8 — Print-and-cut, rotary polish, advanced workflows (weeks 66–78)
**Print-and-cut** registration (2-point similarity transform: translate/rotate/scale, optional auto-scale) across all device types; rotary refinements (chuck vs roller for GRBL/DSP/galvo); job restart/continue; large-job tiling; multi-pass and second-pass alignment.
**Exit:** print-and-cut round-trips a pre-printed sheet within registration tolerance; rotary verified on real hardware per device class.

### M9 — Parity hardening & GA (weeks 74–90+)
Fill the long-tail: additional controller quirks/firmware variants, coordinate edge cases, accessibility, localization scaffolding, performance passes (huge files, WebGPU renderer), docs completeness, telemetry/opt-in diagnostics, licensing/DRM hardening, crash reporting.
**Exit:** parity checklist (§7) ≥90% "at parity"; no P0/P1 open; **General Availability.**

---

## 6. Timeline summary

| Milestone | Focus | Approx. window | Cumulative |
|---|---|---|---|
| M0 | Foundations | wk 1–6 | 1.5 mo |
| M1 | Vector engine | wk 5–16 | ~4 mo |
| M2 | CAM + G-code | wk 14–24 | ~6 mo |
| **M3** | **GRBL control → MVP ship** | **wk 22–30** | **~7 mo** |
| M4 | Agent + Ruida | wk 30–46 | ~11 mo |
| M5 | Camera/CV | wk 40–54 | ~13 mo |
| M6 | Image engraving | wk 46–56 | ~14 mo |
| M7 | Galvo/fiber | wk 54–72 | ~18 mo |
| M8 | Print-and-cut/rotary | wk 66–78 | ~19 mo |
| M9 | Parity hardening → GA | wk 74–90+ | ~22–24 mo |
| — | Long-tail parity (asymptotic) | ongoing | 30–36 mo |

**Two commercial gates:** a **GRBL product at ~month 7** (revenue + real-user feedback funds the rest) and **near-full-parity GA at ~months 22–24**, with the final 10% of parity treated as continuous.

---

## 7. Feature-parity checklist (the "how close" contract)

Legend: ✅ straightforward · 🟡 heavy but solved-path · 🔴 hard/risky.

**Design / vector**
- ✅ Primitives, transforms, align/distribute, grouping — M1
- ✅ Node editing (all segment types) — M1
- ✅ Boolean ops (union/diff/intersect), weld — M1 (Clipper2)
- ✅ Offset / kerf — M1
- ✅ Text, system fonts — M1
- 🟡 Single-line / SHX engraving fonts — M1 (custom parser)
- ✅ Import: SVG, DXF, AI, PDF, PNG/JPG — M1
- 🟡 Import: LightBurn `.lbrn`/`.lbrn2` — M1 (XML mapping)

**CAM / output**
- ✅ Layer modes: Line, Fill, Offset Fill, Fill+Line — M2
- ✅ Per-layer cut settings, sub-layers, fill grouping — M2
- ✅ Cut-order optimization — M2
- ✅ Material library + material test grid — M2
- ✅ Art library — M2
- ✅ G-code export + live simulation — M2
- 🟡 `.rd` (Ruida) export — M4
- 🟡 Galvo job export — M7

**Image engraving**
- 🟡 All 10 dither modes (Floyd–Steinberg, Jarvis, Stucki, Atkinson, ordered, newsprint, halftone, sketch, grayscale, threshold) — M6 (WASM)
- 🟡 Pass-through, negative, overscan, ramp, Z-offset, scan angle — M6
- 🔴 Grayscale/3D depth (power modulation accuracy tied to device) — M6

**Device control**
- ✅ GRBL family (GRBL, M3, LPC, Smoothie, Marlin, Cohesion3D) — M3 (Web Serial)
- 🔴 Ruida DSP (+ Trocen, TopWisdom) — M4 (Agent, UDP)
- 🔴 Galvo/fiber (EZCAD2/BJJCZ) — M7 (Agent, USB)
- ✅ Jog, frame, home, feed-hold/resume, console — M3

**Advanced**
- 🔴 Camera alignment + fisheye lens correction — M5 (OpenCV.js)
- ✅ Print-and-cut registration — M8
- 🟡 Rotary (chuck/roller) across GRBL/DSP/galvo — M4/M7/M8
- ✅ Job restart/continue, tiling — M8

**Platform**
- ✅ Full offline PWA — M0
- ✅ Project storage (OPFS + IndexedDB) — M0
- 🟡 Cross-OS Agent (signed, auto-update) — M4
- 🔴 Chromium-only reach (no Safari/iOS; shaky Firefox) — **structural, not fixable**

**Parity target for GA:** every ✅ and 🟡 at parity; 🔴 items at "works on mainstream hardware, edge cases tracked." The Chromium-only limit is the one permanent gap versus a native app — mitigated by the offline PWA + optional native Agent, which together restore cross-platform desktop coverage.

---

## 8. Testing & release engineering

- **Golden-output CAM tests** — byte/tolerance match on emitted machine code; run on every PR. The single most important guardrail.
- **Protocol conformance** — per controller, against emulators (MeerK40t Ruida emulator, captured EZCAD2/Ruida traffic) and real HIL runners before each hardware milestone.
- **Offline invariant** — Playwright with network blocked post-install; must pass full design→simulate.
- **HIL soak tests** — multi-hour real engraves on GRBL/Ruida/galvo to catch buffer stalls and jitter.
- **Coordinate/units regression** — matrix over mm/inch, origins, transforms.
- **Visual regression** — dither outputs and renderer diffed against stored references.
- **Cross-OS Agent CI** — build, sign, and smoke-test installers on Win/macOS/Linux.
- **Release channels** — dev → beta → stable for both App (SW update flow) and Agent (auto-update), version-negotiated so an old Agent + new App degrade gracefully.

---

## 9. Commercialization workstream (parallel, product not engineering)

- **Licensing/DRM:** server-issued signed licenses with an **offline grace period** (must not break the offline promise); tiering that mirrors the market anchor (a "Core"-equivalent GCode tier, a "Pro"-equivalent DSP+galvo tier). Price at or just below LightBurn (Core $99 / Pro $199 / $40-yr updates).
- **Positioning:** occupy the seam — cross-platform + **truly offline**, the thing LightBurn (desktop-only, dropped Linux) and Glowforge (cloud-locked) don't offer. Do **not** market on the unverified "LightBurn blocklisted cheap lasers" claim.
- **Onboarding:** machine auto-detect, one-click Agent install for DSP/galvo, camera setup wizard, import-your-LightBurn-project path.
- **Docs** are a parity feature — LightBurn's documentation is part of its moat. Technical writer from M2.

---

## 10. Risk register (top items + mitigations)

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Raw UDP impossible in browser → Ruida needs Agent | Certain | High | Architected in from M0; Agent is a planned artifact, not a patch |
| 2 | Chromium-only reach shrinks TAM | Certain | Med | Clear messaging; PWA+Agent restores desktop cross-platform; revisit Firefox as it stabilizes |
| 3 | Camera lens-correction accuracy in WASM | Med | High | Dedicated CV engineer; OpenCV.js proven; buffer M5; validate vs real bed early |
| 4 | In-browser streaming jitter (GC/tab throttle) | Med | High | Worker + character-counting; HIL soak tests gate M3 ship |
| 5 | USB driver-claim battles (WebUSB vs kernel/FTDI; Zadig) | High | Med | Route USB DSP/galvo through Agent (libusb/WinUSB); WebUSB only as fallback |
| 6 | CAM regressions erode trust | Med | High | Golden-output tests on every PR |
| 7 | Protocol RE gaps / firmware variants | Med | Med | Lean on MeerK40t/galvoplotter references; conformance suites; ship common models first |
| 8 | Legal (trademark/DMCA/patents) | Low–Med | High | Clean-room; RE the *machine* protocol not LightBurn; avoid encrypted-handshake circumvention; USPTO patent clearance before GA; IP counsel |
| 9 | Scope/timeline blow-out chasing last 10% parity | High | Med | Ship GRBL MVP at M3 for revenue; treat long-tail parity as continuous, not a gate |
| 10 | Agent security (localhost bridge as attack surface) | Med | High | Origin-locked WSS, token pairing, signed binary, no arbitrary command exec, security review |

---

## 11. Immediate next steps (first 30 days)

1. Stand up the monorepo, CI, and the offline PWA shell (M0 start).
2. Build the `Device` abstraction + fake device + golden-output harness **before** any feature code.
3. Spike the WASM geometry pipeline: Clipper2 boolean/offset round-trip in a Worker.
4. Spike Web Serial character-counting against one real GRBL board to de-risk M3 early.
5. Acquire HIL hardware (GRBL board now; Ruida + galvo boards ordered for M4/M7) and stand up the MeerK40t Ruida emulator.
6. Kick off IP counsel engagement and a USPTO patent clearance search.
7. Lock the `.fluence` format v1 and the `.lbrn` import mapping.

---

### Parity honesty statement
Full 1:1 parity with a mature, 8-year native app is an asymptote, not a milestone. This plan delivers a **shippable GRBL product in ~7 months** and **near-full parity (≥90% of the checklist, all three hardware classes) in ~22–24 months**, with two permanent structural differences from LightBurn: **Chromium-only** browser reach, and a **native companion Agent** for DSP/galvo. Both are inherent to doing this on the web — and both are offset by the one thing this product has that LightBurn and Glowforge don't: a genuinely cross-platform, fully offline web app.
