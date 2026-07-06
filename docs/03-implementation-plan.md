# IMPLEMENTATION_PLAN.md — Fluence (Claude Code / Fable 5 execution backlog)

This is the executable task backlog. It decomposes **every** feature from `development-plan.md` (phases M0–M9) and `browser-lightburn-clone-feasibility.md` (constraints & feature list) into discrete task cards sized for a single Claude Code session. Conventions and invariants live in `CLAUDE.md` — read it first.

---

## How to run this plan with Claude Code (Fable 5)

**Loop, one card per session:**
1. `/clear` to start clean.
2. Paste the card (or say: *"Execute task M1-T03 from IMPLEMENTATION_PLAN.md. Read CLAUDE.md and the Refs first."*).
3. Claude reads `CLAUDE.md`, the card's **Refs** (line/section pointers into the two docs), and the listed **Files**.
4. Claude implements + writes tests, then runs the card's **Verify** commands.
5. Claude checks the card's **Acceptance** boxes, updates the `[ ]`→`[x]` status here, commits with the task ID in the message.

**Parallelism:** cards marked `∥` within a milestone have no ordering dependency and can be run by parallel subagents/worktrees. Cards list explicit **Deps**.

**Prompt template (paste-ready for any card):**
```
Execute <TASK-ID> from IMPLEMENTATION_PLAN.md.
First read CLAUDE.md and the Refs cited in the card.
Honor all architecture invariants. Write tests. Run the Verify commands.
Do not touch machine-output golden fixtures without noting it in the commit body.
Stop when every Acceptance box passes; then mark the card [x] and commit as "<TASK-ID>: <summary>".
```

**Card fields:** *Goal · Deps · Refs · Files · Notes · Accept · Verify.* Refs cite the two source docs by section (F§ = feasibility doc, D§ = dev-plan doc).

**Global exit gate per milestone:** the milestone's exit criteria in `development-plan.md §5` must hold, and `pnpm turbo lint typecheck test` + relevant golden/offline/conformance suites are green.

---

## Milestone M0 — Foundations (blocks everything)

- [x] **M0-T01 — Monorepo & toolchain** ∥
  - Goal: pnpm + Turborepo monorepo with the exact layout in `CLAUDE.md`; TS strict, ESLint/Prettier, Vitest, Playwright, Rust workspace for `apps/agent`, Emscripten toolchain for `packages/geometry-wasm`.
  - Deps: none. Refs: D§1.3, D§2, CLAUDE.md.
  - Files: root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, per-package scaffolds, CI stub.
  - Accept: `pnpm install` clean; `pnpm turbo build lint typecheck test` runs (empty packages OK); Rust `cargo build` in `apps/agent` compiles a stub.
  - Verify: `pnpm install && pnpm turbo build lint typecheck test`.

- [x] **M0-T02 — PWA shell + offline service worker**
  - Goal: installable Vite React PWA; Workbox service worker precaches app shell + WASM; manifest triggers install on Chromium desktop.
  - Deps: M0-T01. Refs: F§5 (offline), D§5 (full offline), CLAUDE.md invariant 3.
  - Files: `apps/web/*`, manifest, SW registration, precache config.
  - Accept: app installs as PWA; loads with network fully offline after first load; Lighthouse PWA installable.
  - Verify: `pnpm --filter web build && pnpm e2e:offline`.

- [x] **M0-T03 — Storage layer (OPFS blobs + IndexedDB meta) + crash-safe autosave**
  - Goal: `packages/fileformats` storage module: project blobs in OPFS, metadata in IndexedDB; `navigator.storage.persist()`; debounced autosave.
  - Deps: M0-T01. Refs: F§5 (OPFS vs IDB, persist), D§4.7, D§5.
  - Files: `packages/fileformats/storage/*`.
  - Accept: 100MB blob write/read via OPFS; metadata query via IDB; persistence granted after PWA install; autosave restores after simulated crash.
  - Verify: `pnpm --filter fileformats test`.

- [x] **M0-T04 — Device interface + fake device/simulator** ∥
  - Goal: `packages/device-core` `Device` interface (`connect/disconnect/stream/jog/frame/home/status/stop`), transport registry, and a `FakeDevice` that simulates buffer + status for headless CAM/UI dev.
  - Deps: M0-T01. Refs: D§1.2 (abstraction rule), D§4.1, CLAUDE.md invariant 2.
  - Files: `packages/device-core/*`.
  - Accept: FakeDevice streams a G-code job, reports progress/status, honors stop/hold; zero DOM/UI deps.
  - Verify: `pnpm --filter device-core test`.

- [x] **M0-T05 — WASM build pipeline (Clipper2 smoke)**
  - Goal: `packages/geometry-wasm` builds Clipper2 C++→WASM; TS typed worker API via Comlink; round-trips a boolean op off-main-thread.
  - Deps: M0-T01. Refs: F§5 (Clipper2-WASM), D§2, D§5.
  - Files: `packages/geometry-wasm/*`, worker harness.
  - Accept: union/difference of two polygons returns correct geometry from a Worker; build reproducible in CI.
  - Verify: `pnpm --filter geometry-wasm build test`.

- [x] **M0-T06 — Test harnesses: golden-output + offline + CI**
  - Goal: golden-fixture harness (design+settings→machine code byte/tolerance match), offline Playwright suite, protocol-conformance scaffold, coordinate/units matrix scaffold; wire all into CI.
  - Deps: M0-T02..T05. Refs: D§4 (foundations), D§8 (testing).
  - Files: `e2e/*`, `tools/golden/*`, CI workflow.
  - Accept: sample golden passes; `pnpm e2e:offline` green; CI runs lint/typecheck/test/golden/offline on PR.
  - Verify: `pnpm turbo test && pnpm e2e:offline`.

**M0 exit:** empty app installs, runs offline, saves/loads `.fluence`, FakeDevice streams to simulator, CI green incl. offline. (D§5 M0)

---

## Milestone M1 — Design & vector engine

- [x] **M1-T01 — Canvas editor core + scene model** — WebGL2 renderer on OffscreenCanvas (worker), pan/zoom, selection, move/scale/rotate, align/distribute, grouping, snapping/guides, rulers, units (mm/inch). Deps: M0-T02,T05. Refs: F§6 (straightforward), D§5 M1, D§2 render. Accept: 5k-path scene stays 60fps; transforms + align/distribute correct; snapping works. Verify: `pnpm --filter web test && perf bench`.
- [x] **M1-T02 — Primitive tools** ∥ — rectangle, ellipse, polygon, line, bezier/curve creation with numeric entry. Deps: M1-T01. Refs: D§5 M1. Accept: each primitive creates exact geometry; editable params. Verify: unit tests.
- [ ] **M1-T03 — Node editing** — full node editor: add/delete/move nodes, convert segment types (line/curve), handle manipulation, path open/close. Deps: M1-T01. Refs: F§6 (node editing), D§7. Accept: all segment types editable; matches LightBurn node-edit behaviors. Verify: unit + visual tests.
- [x] **M1-T04 — Boolean ops + weld** ∥ — union/difference/intersection (two shapes) and weld (N closed shapes) via Clipper2-WASM. Deps: M0-T05, M1-T01. Refs: F§5, F§6, D§7. Accept: golden geometry match for each op; weld joins N outlines. Verify: `pnpm --filter geometry-wasm test`.
- [x] **M1-T05 — Offset / kerf** ∥ — polygon offset (inside/outside, open & closed), remembers last settings. Deps: M0-T05. Refs: F§5 (kerf solved), D§6 checklist. Accept: offset distances exact vs golden; open-path offset correct. Verify: golden tests.
- [ ] **M1-T06 — Text & fonts + SHX** — text tool with system fonts (opentype.js) and single-line/SHX engraving fonts (custom parser). Deps: M1-T01. Refs: F§6 (fonts, 🟡 SHX), D§7. Accept: system + SHX text render and convert to paths; kerning/spacing controls. Verify: unit + visual.
- [x] **M1-T07 — Layers panel + undo/redo** ∥ — layer model, color-coded layers, visibility/lock, full undo/redo (command stack). Deps: M1-T01. Refs: D§5 M2 (layers), D§7. Accept: layer ops + undo/redo across all edits. Verify: unit tests.
- [ ] **M1-T08 — Vector import: SVG/DXF/AI/PDF** ∥ — importers normalizing to the scene model; preserve layers/units where present. Deps: M1-T01. Refs: F§6 (import ✅), D§5 M1. Accept: reference files import with correct geometry/scale. Verify: import golden fixtures.
- [ ] **M1-T09 — Raster import (PNG/JPG)** ∥ — image placement, scaling, DPI awareness (feeds M6). Deps: M1-T01. Refs: D§5 M1. Accept: images import at correct physical size. Verify: unit.
- [ ] **M1-T10 — LightBurn `.lbrn`/`.lbrn2` import** — parse LightBurn XML → scene model (shapes, layers, cut settings mapping). Deps: M1-T07, M2-T01(cut settings map may land after; stub then complete). Refs: F§6 (🟡 lbrn import), D§7. Accept: representative `.lbrn` imports with shapes+layers; unmapped settings logged. Verify: import golden fixtures.
- [x] **M1-T11 — `.fluence` format v1 (open, versioned)** — zipped JSON + assets; save/load round-trip via storage layer; schema version + migration hook. Deps: M0-T03. Refs: D§1.2 (open format). Accept: full project round-trips losslessly; version field present. Verify: round-trip test.

**M1 exit:** user can draw, import, and edit a real project to LightBurn-comparable fidelity; boolean/offset match golden; node editor handles all segment types. (D§5 M1)

---

## Milestone M2 — CAM core & G-code

- [x] **M2-T01 — Layer cut modes: Line / Fill / Offset Fill / Fill+Line** — implement the four modes incl. concentric offset fill and Fill+Line via sub-layers. Deps: M1-T04,T05,T07. Refs: F§6 (layer modes), D§5 M2. Accept: each mode produces correct toolpaths vs golden. Verify: golden.
- [ ] **M2-T02 — Per-layer cut settings + sub-layers + fill grouping** ∥ — speed, min/max power, passes, interval, air assist, sub-layers, fill grouping (all-at-once/groups/individually). Deps: M2-T01. Refs: F§6, D§5 M2. Accept: settings drive output; fill grouping orders correctly. Verify: golden + unit.
- [x] **M2-T03 — Cut-order optimization** ∥ — TSP-style ordering, inner-before-outer, per-layer ordering, direction control. Deps: M2-T01. Refs: F§6 (TSP heuristics), D§5 M2. Accept: reduces travel vs naive; respects constraints; deterministic. Verify: golden + metric assertion.
- [x] **M2-T04 — Material library** ∥ — presets (speed/power/passes/interval) per material/machine; import/export; apply-to-layer. Deps: M2-T02. Refs: F§6, D§5 M2. Accept: library CRUD + apply; export/import round-trips. Verify: unit.
- [ ] **M2-T05 — Material test grid generator** ∥ — parametric grid (default 10×10) varying power/speed/passes/interval; built-in diode/CO2 presets. Deps: M2-T02. Refs: F§6 (material test), D§5 M2. Accept: grid generates as designed; labels correct. Verify: golden geometry.
- [ ] **M2-T06 — Art library** ∥ — reusable clip-art/shape storage, drag-in, categories. Deps: M1-T11, M0-T03. Refs: F§6 (art library), D§5 M2. Accept: store/retrieve/insert shapes; persists offline. Verify: unit.
- [ ] **M2-T07 — Coordinate/origin/optimization settings** — job origin, machine origin, workspace transforms, units; optimization settings panel. Deps: M2-T01. Refs: D§4.6 (coordinate harness), D§5 M2. Accept: coordinate matrix (mm/inch × origins) passes. Verify: `coordinate matrix` suite.
- [x] **M2-T08 — G-code generator + live simulation/preview** — emit GRBL G-code from CAM; animated path preview (travel vs cut), time estimate. Deps: M2-T01,T02,T03,T07. Refs: F§6 (gcode ✅), D§5 M2. Accept: golden G-code match; simulator matches emitted order; time estimate within tolerance. Verify: `pnpm --filter fileformats test:golden`.

**M2 exit:** golden G-code matches; simulator accurate; material library + test grid usable end-to-end. QA regression suite live. (D§5 M2)

---

## Milestone M3 — GRBL real-time control → MVP ship

- [ ] **M3-T01 — Web Serial transport** — `WebSerialTransport` implementing `Device`; port request (user gesture), persistent grant reconnection via `getPorts()`. Deps: M0-T04. Refs: F§3 (Web Serial, permission model), D§5 M3. Accept: connect/disconnect real GRBL board; reconnect without re-pick. Verify: HIL smoke.
- [ ] **M3-T02 — Character-counting streaming (Worker)** — implement GRBL char-counting protocol in a Worker; keep planner full without RX overflow. Deps: M3-T01. Refs: F§3 (char-counting), D§5 M3, F§ streaming risk. Accept: multi-hour engrave with no buffer stall; throughput matches native in bench. Verify: HIL soak.
- [ ] **M3-T03 — Real-time controls** — jog (`$J=`), feed-hold `!`, resume `~`, soft-reset `0x18`, status `?` polling; all via real-time bytes bypassing line buffer. Deps: M3-T02. Refs: F§3 (real-time bytes), D§5 M3. Accept: jog latency indistinguishable from native (blind test); hold/resume/reset reliable. Verify: HIL.
- [ ] **M3-T04 — Console + alarm/error handling + reconnection** ∥ — raw console, GRBL alarm/error decoding, auto-reconnect, safe state recovery. Deps: M3-T02. Refs: D§5 M3. Accept: alarms surfaced with human text; reconnect resumes cleanly. Verify: fault-injection tests.
- [ ] **M3-T05 — Framing/outline + homing** ∥ — frame job bounds, run outline, `$H` homing, work-origin set. Deps: M3-T03. Refs: F§6 (jog/frame/home ✅), D§5 M3. Accept: frame traces true bounds; homing + origin correct. Verify: HIL.
- [ ] **M3-T06 — GRBL device profiles** ∥ — GRBL, GRBL-M3, GRBL-LPC, Smoothieware, Marlin, Cohesion3D profiles (dialect quirks, $-settings). Deps: M3-T02. Refs: F§ (LightBurn controllers), D§5 M3. Accept: each profile connects + streams on emulator/HIL; dialect diffs handled. Verify: conformance per profile.

**M3 exit:** reliable multi-hour engrave on real GRBL; jog latency native-comparable; HIL soak passes. **Ship GRBL product (paid beta).** (D§5 M3)

---

## Milestone M4 — Agent + Ruida DSP

- [ ] **M4-T01 — Agent scaffold (Rust): localhost WSS + token pairing + auto-update + signing** — tokio/tungstenite WSS on 127.0.0.1, origin-locked, token-paired to the App; code-signed installers (Win/macOS/Linux); auto-updater; version negotiation with App. Deps: M0-T01. Refs: F§4 (agent unavoidable), D§1.1, D§4.1, CLAUDE.md invariant 6. Accept: App pairs to Agent; signed installers build in CI; old-Agent/new-App degrades gracefully; security review checklist passed. Verify: `pnpm --filter agent verify`.
- [ ] **M4-T02 — `AgentTransport` in web** — `Device` transport speaking to the Agent over WSS; "install companion" flow when absent; capability discovery. Deps: M4-T01, M0-T04. Refs: D§1.2, F§4. Accept: DSP device reached only via Agent; GRBL still works agent-less. Verify: integration test with Agent stub.
- [ ] **M4-T03 — Ruida codec (checksum + swizzle + ACK/resend)** — implement Ruida framing: 2-byte checksum, high-bit command bytes / 14-/35-bit ints, per-model swizzle table, 0xCC/0xCF ACK with resend; UDP 50200 send / 40200 recv (in Agent). Deps: M4-T01. Refs: F§4 (Ruida protocol, ports, swizzle), D§4 (protocols). Accept: conformance vs MeerK40t emulator + captured real traffic; checksum/swizzle exact. Verify: `pnpm --filter protocols test:conformance` + Agent Rust tests.
- [ ] **M4-T04 — `.rd` export + direct send** ∥ — generate Ruida `.rd` job files and stream to controller via Agent. Deps: M4-T03, M2-T08. Refs: F§6 (.rd export 🟡), D§6 checklist. Accept: `.rd` cuts a real job on physical Ruida; file also loadable via USB stick. Verify: HIL Ruida.
- [ ] **M4-T05 — DSP device profiles: Ruida, Trocen, TopWisdom** ∥ — profiles + settings for the three DSP families. Deps: M4-T03. Refs: F§ (DSP controllers), D§5 M4. Accept: Ruida full; Trocen/TopWisdom connect + basic job (flag partial where RE thin). Verify: conformance/HIL.
- [ ] **M4-T06 — DSP origin/job settings + DSP rotary** ∥ — DSP-specific origins, job framing, and chuck/roller rotary for DSP. Deps: M4-T04. Refs: F§6 (rotary), D§5 M4, D§ rotary. Accept: origin modes correct on HIL; rotary scales circumference correctly. Verify: HIL.

**M4 exit:** cut a real job on a physical Ruida via the Agent; conformance suite passes; one-click signed Agent install/pair/update. (D§5 M4)

---

## Milestone M5 — Camera alignment & lens correction

- [ ] **M5-T01 — Camera capture (`getUserMedia`)** ∥ — device selection, live preview, frame grab pipeline into workers. Deps: M0-T02. Refs: F§6 (camera hardest), D§5 M5. Accept: stable capture from a real USB camera. Verify: manual + integration.
- [ ] **M5-T02 — Lens calibration wizard (OpenCV.js/WASM)** — AprilTag/circle-grid detection across ~9 guided captures; solve intrinsic + distortion coeffs to <0.5px reprojection; store per-camera profile. Deps: M5-T01, `packages/cv`. Refs: F§6 §3 (calibration pipeline, sub-pixel), D§5 M5. Accept: reprojection error <0.5px on a real fisheye; reproducible across sessions. Verify: CV fixture tests + real-camera check.
- [ ] **M5-T03 — Camera alignment / homography overlay** — undistort + homography to overlay live bed onto workspace; alignment target workflow. Deps: M5-T02. Refs: F§6 §3, D§5 M5. Accept: place-image-on-bed alignment within LightBurn tolerance on real bed. Verify: HIL + measured error.
- [ ] **M5-T04 — Official-camera presets + capture-to-trace** ∥ — preset distortion profiles (skip manual cal); capture→VTracer trace path. Deps: M5-T03, M1-T08. Refs: F§6 §3, D§5 M5. Accept: preset cameras skip calibration; capture traces to vectors. Verify: integration.

**M5 exit:** end-to-end place-image-and-cut with alignment within tolerance on real camera+bed; calibration reproducible. (D§5 M5)

---

## Milestone M6 — Image engraving parity

- [ ] **M6-T01 — Dither engine (Rust→WASM): all modes** — Threshold, Ordered, Atkinson, Floyd–Steinberg ("Dither"), Stucki, Jarvis, Newsprint, Halftone (variable cell + angle), Sketch (edge detect), Grayscale. Sequential error-diffusion in WASM/worker for interactivity. Deps: M0-T05, M1-T09. Refs: F§6 (10 modes list), D§5 M6. Accept: each mode visually matches LightBurn output side-by-side; high-res re-dither stays responsive. Verify: visual-regression fixtures + perf bench.
- [ ] **M6-T02 — Image mode options** ∥ — pass-through, negative, bi-directional fill, overscan, DPI/line-interval, scan angle, ramp (rubber stamp), Z-offset. Deps: M6-T01, M2-T02. Refs: F§6 (image options), D§5 M6. Accept: each option affects output correctly vs golden. Verify: golden.
- [ ] **M6-T03 — Grayscale / 3D depth engraving** — power-modulated grayscale mapping; tie to device power model (CO2). Deps: M6-T01, M3-T02/M4-T04. Refs: F§6 (🔴 grayscale/3D), D§5 M6. Accept: depth map → power modulation matches reference on HIL; documented accuracy limits. Verify: HIL + golden power curve.

**M6 exit:** side-by-side engraves match LightBurn per mode; interactive re-dither responsive. (D§5 M6)

---

## Milestone M7 — Galvo / fiber

- [ ] **M7-T01 — Agent USB path for BJJCZ/EZCAD2 (libusb/WinUSB)** — VID 0x9588/PID 0x9899; BULK command + status-poll endpoints; anti-clone dongle handling (skippable); 12-byte commands in 256-bunches, NOP-padded. Deps: M4-T01. Refs: F§4 (galvo protocol, endpoints), D§5 M7. Accept: conformance vs captured EZCAD2 traffic; marks on real board via Agent. Verify: `protocols test:conformance` + HIL galvo.
- [ ] **M7-T02 — WebUSB fallback (where OS permits)** ∥ — Chromium WebUSB direct path when no kernel driver holds the interface; graceful fall-through to Agent; WinUSB/Zadig guidance in onboarding. Deps: M7-T01. Refs: F§4 (WebUSB limits, Zadig), D§5 M7. Accept: WebUSB path works on a clean WinUSB setup; auto-detects and routes. Verify: integration.
- [ ] **M7-T03 — Galvo job encoder** — vector/fill/image → galvo mark commands via the codec. Deps: M7-T01, M2-T08. Refs: F§6 (galvo job export 🟡), D§5 M7. Accept: encoded job marks correctly on HIL. Verify: golden + HIL.
- [ ] **M7-T04 — Galvo settings + rotary + presets** ∥ — lens/field size, wobble, marking passes; galvo rotary; galvo material presets. Deps: M7-T03. Refs: F§6 (galvo rotary), D§5 M7. Accept: field-size calibration correct; wobble/passes affect output; rotary verified. Verify: HIL.

**M7 exit:** mark a real fiber/CO2 galvo job via the Agent; conformance vs EZCAD2 captures; driver guidance integrated. (D§5 M7)

---

## Milestone M8 — Print-and-cut, rotary polish, advanced workflows

- [ ] **M8-T01 — Print-and-cut registration** — 2-point similarity transform (translate/rotate/scale) from two target marks; optional auto-scale; applies across GRBL/DSP/galvo. Deps: M2-T07, M3-T05, M4-T06. Refs: F§6 (print-and-cut ✅), D§5 M8. Accept: round-trips a pre-printed sheet within registration tolerance. Verify: HIL measured.
- [ ] **M8-T02 — Rotary refinements (chuck/roller × device class)** ∥ — unify chuck vs roller across GRBL/DSP/galvo; per-object diameter entry (chuck) and one-time roller measure. Deps: M4-T06, M7-T04. Refs: F§6 (rotary 🟡), D§5 M8. Accept: circumference scaling correct per device class on HIL. Verify: HIL.
- [ ] **M8-T03 — Job restart/continue + tiling** ∥ — resume halted jobs; second-pass alignment; tile jobs larger than bed. Deps: M8-T01. Refs: F§6 (restart/tiling ✅), D§5 M8. Accept: restart resumes from stop point; tiling aligns seams. Verify: HIL.

**M8 exit:** print-and-cut within tolerance; rotary verified on real hardware per device class. (D§5 M8)

---

## Milestone M9 — Parity hardening & GA

- [ ] **M9-T01 — Controller quirks & firmware variants** ∥ — long-tail GRBL/DSP/galvo firmware variants and edge cases from beta telemetry/bug reports. Deps: M3/M4/M7 complete. Refs: D§5 M9, D§7 (long-tail). Accept: top reported variants supported; conformance expanded. Verify: expanded conformance.
- [ ] **M9-T02 — Coordinate edge cases + units hardening** ∥ — exhaustive origin/units/mirroring/negative-workspace cases. Deps: M2-T07. Refs: D§4.6, D§5 M9. Accept: full coordinate matrix green incl. edge cases. Verify: coordinate suite.
- [ ] **M9-T03 — Performance pass (huge files + WebGPU renderer)** ∥ — large-document perf; enable WebGPU renderer behind flag; OffscreenCanvas tuning. Deps: M1-T01. Refs: F§5 (WebGL/WebGPU), D§2, D§5 M9. Accept: defined large-file scene meets fps target; WebGPU path parity. Verify: perf bench.
- [ ] **M9-T04 — Accessibility + localization scaffolding** ∥ — keyboard nav, a11y roles, i18n string extraction. Deps: M1-T01. Refs: D§5 M9. Accept: a11y audit passes baseline; strings externalized. Verify: axe + i18n lint.
- [ ] **M9-T05 — Telemetry (opt-in) + crash reporting** ∥ — privacy-respecting, offline-safe, opt-in diagnostics; crash reports. Deps: M0-T02. Refs: D§5 M9, CLAUDE.md invariant 3. Accept: telemetry fully optional and offline-safe; no PII. Verify: offline test still green with telemetry on.
- [ ] **M9-T06 — Docs completeness** ∥ — user docs are a parity feature; cover every shipped feature. Deps: features complete. Refs: D§9 (docs = moat). Accept: every checklist feature documented. Verify: docs lint/coverage.

**M9 exit:** parity checklist (§7 of dev-plan) ≥90% "at parity"; no P0/P1 open; **GA**. (D§5 M9)

---

## Commercialization workstream (parallel to engineering — product-owned)

- [ ] **CM-T01 — Licensing/DRM with offline grace** — server-issued signed licenses; offline grace period that never breaks the offline invariant; tiers mirroring market (GCode "Core" vs DSP+galvo "Pro"). Refs: D§9, F§8 (pricing anchor). Accept: license validates offline within grace; tier gating enforced client+server. Verify: license test matrix incl. offline.
- [ ] **CM-T02 — Onboarding & machine auto-detect** — machine auto-detect, one-click Agent install for DSP/galvo, camera setup wizard, `.lbrn` import path. Refs: D§9. Accept: new user reaches first cut with minimal steps; DSP users guided to Agent. Verify: onboarding e2e.
- [ ] **CM-T03 — Positioning & store copy** — market the offline + cross-platform seam; do NOT reference the unverified "blocklist" claim. Refs: F§8 (positioning, unverified premise), D§9. Accept: copy avoids trademark/unverified claims; IP-counsel reviewed. Verify: brand/legal review.
- [ ] **CM-T04 — IP clearance gate (pre-GA)** — USPTO patent clearance search; clean-room attestations; trademark avoidance review. Refs: F§7 (legal), D§10 risk #8. Accept: clearance completed; counsel sign-off before GA. Verify: legal checklist.

---

## Dependency spine (critical path)
`M0 → M1 → M2 → M3 (MVP ship) → M4 → {M5 ∥ M6} → M7 → M8 → M9 (GA)`
Camera (M5) and image engraving (M6) run in parallel after M4. Commercialization (CM) runs alongside from M2; CM-T04 is a hard gate before GA.

## Parity coverage guarantee
Every row of the dev-plan §7 checklist maps to a task here: design/vector→M1; CAM/output→M2 (+.rd M4, galvo M7); image engraving→M6; device control→M3/M4/M7; camera→M5; print-and-cut/rotary→M8; platform/offline→M0 (+Agent M4). The one permanent gap — **Chromium-only reach** — is structural and documented, not a task.

## Status legend
`[ ]` not started · `[~]` in progress (note owner) · `[x]` done (golden/offline/conformance green, acceptance met). Keep this file's checkboxes current — it is the single source of execution truth.
