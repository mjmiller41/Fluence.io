# Feasibility Study: A Browser-Based / Installable-PWA "LightBurn" Clone with Full Offline Capability

**Prepared:** July 2026
**Scope:** Commercial product. GRBL-first, with a phased path to Ruida DSP and galvo/fiber. Full offline operation as a hard requirement.
**Note:** Legal sections are general information, US-centric, and not legal advice. Have a qualified IP attorney review before launch.

---

## 1. Verdict

**Conditionally GO — but not as a "pure browser" product.** The honest architecture is a **web app (installable PWA) with an optional downloadable local agent.** A browser alone can cleanly cover the GRBL-over-USB case you want to start with, and the entire design/CAM half of the product. It **cannot** cover the professional Ruida-over-Ethernet case that defines LightBurn's high-margin "Pro" tier, because browsers cannot open raw UDP sockets. That single platform limit is the fulcrum of the whole plan.

The good news: the market seam is real and defensible. LightBurn dropped Linux, raised prices, and remains desktop-only; Glowforge is web-based but cloud-locked and unusable offline. Nobody ships a polished, cross-platform, **offline-capable** web tool in this space. The reason nobody has isn't that it's impossible — it's that it requires (a) Chromium-only browser lock-in, (b) hand-rolling robust real-time serial streaming in-browser, and (c) a small native helper for the pro hardware. All three are surmountable.

**One-line recommendation:** Build the GRBL MVP as a Chromium PWA using Web Serial; treat Ruida/galvo as Phase 2–3 delivered through a downloadable local agent, exactly as LightBurn itself does with its "Bridge."

---

## 2. The central technical constraint (read this first)

Browsers give you **two** hardware doors and **no** third:

- **Web Serial API** — read/write to serial/COM ports (USB-serial chips like CH340/FTDI/CP210x). This is the correct door for GRBL.
- **WebUSB API** — raw bulk/control transfers to a user-selected USB device. Relevant for galvo boards.
- **Raw UDP/TCP sockets — do not exist in the browser.** JavaScript can only speak HTTP(S), WebSocket (TCP-like, reliable), WebRTC data channels, and WebTransport (QUIC to a cooperating server). None of these can address a raw UDP device on your LAN.

Consequences that cascade through the entire roadmap:

| Hardware / link | Reachable from a pure browser? | Native local agent required? |
|---|---|---|
| GRBL over USB serial | **Yes** — Web Serial, Chromium desktop | No |
| Ruida over **Ethernet/UDP** (ports 50200/40200) | **No — architecturally impossible** | **Yes, unavoidable** |
| Ruida over USB (FTDI FT245R) | Maybe (Chromium Web Serial) if the OS exposes a COM port; fragile, permission-gated | Recommended |
| Galvo/fiber (BJJCZ EZCAD2, VID 0x9588/PID 0x9899) over USB | Maybe (Chromium WebUSB), but needs WinUSB driver via Zadig | Recommended; and required for any network use |

This is why the product must be conceived from day one as **"web app + optional agent,"** not "browser-only." Framing it any other way sets up a Phase-2 wall you cannot climb.

Sources: [MDN — WebSockets API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API); ["No, really, why can't we have raw UDP"](https://www.computerenhance.com/p/no-really-why-cant-we-have-raw-udp); [MDN — WebTransport](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API); [EduTech Wiki — Ruida](https://edutechwiki.unige.ch/en/Ruida); [LightBurn Bridge docs](https://docs.lightburnsoftware.com/LightBurnBridge.html).

---

## 3. Phase 1 — GRBL over Web Serial (the MVP)

### Browser support (as of mid-2026)

- **Chrome / Edge / Opera desktop:** Web Serial shipped and stable since **Chrome 89 (March 2021)**. Solid. ([caniuse](https://caniuse.com/web-serial))
- **Chrome for Android:** Web Serial only began arriving around **Chrome 148 (beta April 2026)**, Bluetooth-SPP-first; native USB serial gated to a limited device set rolling out through 2026. Treat mobile as a bonus, not a target. ([caniuse](https://caniuse.com/web-serial); [Notebookcheck](https://www.notebookcheck.net/Chrome-148-Beta-for-Android-adds-Web-Serial-SharedWorker-support.1269721.0.html))
- **Safari (macOS/iOS/iPadOS):** **Not supported, WebKit is officially "opposed"** on fingerprinting grounds. Hard blocker — no iPhone/iPad control, ever, in-browser. ([WebKit tracking prevention](https://webkit.org/tracking-prevention/))
- **Firefox:** historically unsupported, Mozilla "neutral." caniuse shows Firefox 151+ as supported but this is **contested** (add-on-gated in Nightly). Do not count on it. ([Mozilla standards positions](https://mozilla.github.io/standards-positions/#webserial))

**Realistic near-term addressable browsers: Chrome and Edge on desktop.** That is the same practical footprint as many pro creative web tools, and it is enough for a commercial launch — but it must be stated plainly in marketing to avoid support blowback.

### Permission model

`navigator.serial.requestPort()` shows a user-controlled device chooser, must be triggered by a click (transient user activation), and cannot silently enumerate ports. Grants **persist per origin**; `getPorts()` lets a returning user reconnect without re-picking. This is a clean UX once the user has authorized their machine once. ([MDN — requestPort](https://developer.mozilla.org/en-US/docs/Web/API/Serial/requestPort))

### Can you actually stream and jog in real time? Yes.

GRBL's high-performance streaming is the **character-counting protocol**: the host tracks bytes in GRBL's ~127-byte RX buffer and only sends more when there's room, decrementing on each `ok`/`error`. Web Serial's read/write streams are fully sufficient to implement it. GRBL's **real-time command bytes** (jog `$J=`, feed hold `!`, cycle start `~`, soft-reset `0x18`, status `?`) bypass the line buffer, which is exactly what makes responsive browser jogging possible. ([GRBL v1.1 interface](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface))

The dominant latency/jitter risk is **not** the browser — it's USB-serial chip buffering and the non-real-time host OS, which affect native apps identically. Mitigations: run the streaming loop in a **Web Worker** (SharedWorker now available), implement character-counting rather than naive send-and-wait, and build robust reconnection. You must hand-roll this logic; the browser gives you the pipe, not the protocol.

### Competitive precedent — and the gap

The serious incumbents are **not** pure-browser apps:

- **gSender** (Sienci) and **OpenBuilds CONTROL** are **Electron desktop apps**.
- **CNCjs, LaserWeb4, ChiliPeppr, Grbl-Web** are web UIs backed by a **local Node/agent server** that owns the serial port over a WebSocket bridge.
- Pure-browser Web Serial senders exist only at **hobby scale** (browserGcodeSender / gcodesender.com, SerialTerminal.com).

**No mature, LightBurn-class, pure-browser Web Serial laser suite exists.** That is your differentiation — and also a caution: the absence reflects the Chromium lock-in and the engineering discipline required to make in-browser streaming rock-solid. ([gSender](https://github.com/Sienci-Labs/gsender); [CNCjs wiki](https://github.com/cncjs/cncjs/wiki/Introduction); [LaserWeb4](https://github.com/LaserWeb/LaserWeb4); [gcodesender.com](https://gcodesender.com/))

---

## 4. Phases 2–3 — Ruida DSP and galvo/fiber (where the agent is unavoidable)

### Ruida (professional CO2)

- **Transport:** Ethernet/UDP (laser listens on **50200**, replies from **40200**) and USB (FTDI **FT245R** serial). ([EduTech Wiki — Ruida](https://edutechwiki.unige.ch/en/Ruida))
- **Protocol:** proprietary but well reverse-engineered. Packets carry a 2-byte checksum; the laser ACKs **0xCC** (ok) / **0xCF** (fail); payload bytes are "swizzled" per a per-model table. Command bytes set the high bit, producing Ruida's unusual 14-/35-bit integers. Reference implementations: **MeerK40t** (full controller + emulator), **jnweiger/ruida-laser** (protocol docs + UDP proxy), **StevenIsaacs/ruida-protocol-analyzer**. ([MeerK40t controller](https://github.com/meerk40t/meerk40t/blob/main/meerk40t/ruida/controller.py); [jnweiger protocol.md](https://github.com/jnweiger/ruida-laser/blob/master/doc/protocol.md))
- **Browser reality:** the common Ethernet setup is **impossible from a browser** (no raw UDP). You must ship a **downloadable native local agent** — a small app exposing `ws://localhost` that translates browser messages into checksummed/swizzled UDP 50200 packets with ACK/resend. This mirrors LightBurn's own **Bridge**. The USB path *might* work via Chromium Web Serial if the OS surfaces a COM port, but it's fragile and you'd still re-implement the framing in JS.

### Galvo / fiber (EZCAD2 / BJJCZ / JCZ)

- **Hardware:** typically a **BJJCZ LMCV4-FIBER** board (VID **0x9588**, PID **0x9899**) driving the head via the open **XY2-100** protocol; the PC↔board USB link is proprietary, reverse-engineered by packet capture. Three USB endpoints (BULK command, status poll, anti-clone dongle). ([bryce.pw/engraver](https://www.bryce.pw/engraver.html); [EduTech Wiki — LMCV4](https://edutechwiki.unige.ch/en/LMCV4-FIBER-M))
- **RE maturity:** high — **Balor**, **balor-meerk40t**, and MeerK40t's **galvoplotter** all drive these boards via libusb/pyusb. ([galvoplotter](https://github.com/meerk40t/galvoplotter))
- **Browser reality:** a vendor USB device with BULK endpoints fits **WebUSB** better than Web Serial, but WebUSB can't claim the interface while the OS/EZCAD driver holds it — users would need **Zadig/WinUSB**, which breaks the vendor software. Millisecond polling and dongle handling add fragility. **A native agent is the robust path.** ([WICG WebUSB issue #56](https://github.com/WICG/webusb/issues/56); [LightBurn galvo driver guide](https://docs.lightburnsoftware.com/latest/Guides/GalvoDriverInstallation/))

### The strategic implication

Your "pure web" story holds for the hobbyist GRBL segment. The **paid-Pro segment (Ruida + galvo) requires a native helper regardless.** That's not a defeat — it's the same shape as LightBurn's Bridge and the CNCjs/LaserWeb model. Design the agent once (a signed, auto-updating localhost WebSocket↔device bridge for Win/Mac/Linux) and both Pro hardware classes flow through it. It also, as a bonus, restores the cross-platform/offline story that a pure browser gives you anyway.

---

## 5. Offline PWA + heavy-geometry architecture (the design/CAM half)

This half is **strongly feasible** and is where the product can match or beat LightBurn on portability.

### Full offline

A service worker pre-caching the app shell (HTML/JS/CSS/**WASM**) via the Cache API delivers genuine offline operation after one online load. PWAs install as standalone windowed apps on Windows/macOS/Linux in Chrome/Edge; a valid manifest triggers install (SW still needed for offline). ([MDN — offline SW](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Tutorials/js13kGames/Offline_Service_workers); [web.dev — service workers](https://web.dev/learn/pwa/service-workers))

### Project storage

Store project blobs in **OPFS** (Origin Private File System), structured metadata in **IndexedDB**. OPFS is dramatically faster for large binaries — a 100 MB write measured **~90 ms (OPFS) vs ~850 ms (IndexedDB)**. Chromium can use up to ~60% of disk per origin. Call `navigator.storage.persist()` to opt out of eviction; **installing as a PWA auto-grants persistence in Chrome/Edge with no prompt.** ([MDN — storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria); [MDN — OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system))

### WASM geometry core

Expect WASM to run roughly **1.3×–2.5× slower than native C++** (peer-reviewed: ~45% slower in Firefox, ~55% in Chrome on SPEC; tighter on compute-bound loops). Fast enough for interactive laser CAM. Usable libraries:

- **Clipper2-WASM** — polygon boolean ops + offsetting → **kerf compensation and toolpath offset, solved.** ([Clipper2-WASM](https://github.com/ErikSom/Clipper2-WASM))
- **Potrace-WASM** / **VTracer** (Rust→WASM, O(n) vs Potrace O(n²)) → **raster-to-vector import.** ([VTracer](https://github.com/visioncortex/vtracer))
- Image dithering and path planning: **no dominant WASM lib** — expect custom work (port C or write in Rust). Flag this as real effort.
- CGAL/WASM: **risky** — WASM lacks FP rounding-mode control, which undermines CGAL's exact arithmetic. Avoid; you don't need B-rep for 2D laser CAM anyway.

([USENIX ATC'19 "Not So Fast"](https://www.usenix.org/system/files/atc19-jangda.pdf))

### Rendering

Canvas2D bottlenecks on thousands of paths; use **WebGL (or WebGPU)** on an **OffscreenCanvas** inside a worker to keep the UI at 60fps. ([2D vs WebGL canvas perf](https://semisignal.com/a-look-at-2d-vs-webgl-canvas-performance/))

### Proof it's possible at pro grade

**Figma** is the anchor precedent: its rendering engine is **C++ compiled to WASM**, drawing straight to the GPU; moving to WASM **cut load time >3×**, and it now targets WebGPU. Pro-grade 2D vector editing at 60fps in a browser is a settled question. **CADmium/Truck** show a client-side WASM CAD kernel is achievable; **SVGcode** is a shipping PWA using Potrace-in-WASM (exactly your import feature). ([Figma WASM](https://www.figma.com/blog/webassembly-cut-figmas-load-time-by-3x/))

---

## 6. Feature-parity map vs LightBurn

LightBurn represents **~8–9 years** of development (public 0.9.x from ~2016–17, v1.0 Aug 2021, v2.x now) by a **very small core team (single-digit developers)**, led by Jason Dorie. Reaching *full* parity is a multi-year effort; reaching a *credible, better-in-some-ways* GRBL product is not. ([LightBurn 1.0](https://lightburnsoftware.com/blogs/news/lightburn-1-0-released-insert-party-noises))

**Straightforward in a browser (Phase 1):**
Vector editing, node editing, boolean ops, weld, **offset/kerf** (Clipper2), text/fonts (opentype.js; SHX single-line needs custom parsing), layers & cut settings, material library, art library, material-test grid, **print-and-cut** (a 2-point similarity transform — simple linear algebra), cut-order optimization (TSP heuristics). These are UI/state/geometry problems the web handles well.

**Hard / heavy:**

- **Camera alignment + fisheye lens correction** — the single hardest subsystem. It's a classic OpenCV pipeline: AprilTag/marker detection across ~9 captures, distortion-coefficient solving to sub-pixel error (<0.5px), undistort, then homography to overlay the live bed. In a browser that means **OpenCV.js (WASM)** + `getUserMedia` + per-frame WASM/GPU processing. Feasible, but budget for it. ([LightBurn camera calibration](https://docs.lightburnsoftware.com/latest/Reference/CalibrateCameraLens/))
- **Image engraving/dithering at scale** — LightBurn ships ~10 modes (Floyd–Steinberg, Jarvis, Stucki, Atkinson, ordered, newsprint, halftone with variable cell/angle, sketch/edge-detect, grayscale/3D). Error diffusion is inherently sequential and slow in JS → **needs WASM or WebGL** for interactive speed. ([LightBurn image settings](https://docs.lightburnsoftware.com/UI/CutSettings/CutSettings-Image.html))
- **Real-time device control across three proprietary protocols** — covered in §3–4; in aggregate the largest and riskiest bucket.

---

## 7. Legal / IP read (general information, not legal advice)

- **Building a competing laser-control app is legal in principle.** Functionality, protocols, and ideas aren't copyrightable — only specific expression (code, icons, UI art). Use **clean-room** discipline: copy no source, no verbatim UI art, no material-library data. ([Clean room design](https://en.wikipedia.org/wiki/Clean_room_design))
- **Reverse-engineering the *machine* protocols (Ruida, EZCAD) for interoperability is well-supported** by *Sega v. Accolade* and *Sony v. Connectix* (intermediate copying for interoperability = fair use). MeerK40t and galvoplotter already did this openly, in this exact domain. Reverse-engineering the *machine* protocol (not LightBurn's app) also sidesteps LightBurn's EULA entirely. ([Sega v. Accolade](https://en.wikipedia.org/wiki/Sega_v._Accolade))
- **Risks to manage:** DMCA §1201 has an interoperability exemption (§1201(f)) but it **does not cover circumventing encryption** — if any target controller uses encrypted handshakes/code-signing, risk rises. Don't touch the **"LIGHTBURN" registered trademark** (USPTO Reg. #6750777) or its dragon logo; "compatible with" nominative references are lower-risk. Do a formal **USPTO patent clearance** search before committing — none surfaced, but that gap should be closed. ([EFF reverse-engineering FAQ](https://www.eff.org/issues/coders/reverse-engineering-faq); [USPTO TM record](https://uspto.report/TM/90676728))

---

## 8. Market & commercial viability

- **Market is large and growing double-digits.** Desktop laser engraver market est. **~$1.15B (2024) → ~$3.02B by 2033 (~11% CAGR)**; ~62% of users are home/hobbyist. Figures are vendor-report estimates with wide variance. ([ResearchIntelo](https://researchintelo.com/report/desktop-laser-engraver-market/amp))
- **Monetizable installed base is real:** xTool alone reported **~$340M+ revenue in 2024** and **405,000+ machines connected since 2021**, filing for a HK IPO. ([xTool — Wikipedia](https://en.wikipedia.org/wiki/XTool))
- **The seam you'd occupy:** LightBurn is paid, desktop-only, and **dropped Linux** (v1.7 last Linux build) amid pricing backlash; Glowforge is web-based but **cloud-only and unusable offline**, a long-standing, documented user grievance worsened by cloud outages. **MeerK40t** proves the RE approach but is desktop Python — the polished, cross-platform, **offline web** niche is genuinely open. ([Hackaday — LightBurn drops Linux](https://hackaday.com/2024/07/31/lightburn-turns-back-the-clock-bails-on-linux-users/); [Glowforge offline requests](https://community.glowforge.com/t/offline-standalone-application-for-glowforge/39074))
- **Pricing anchor:** LightBurn Core **$99** / Pro **$199**, perpetual license + **$40/yr** updates. A subscription or perpetual-plus-updates model at or slightly below this is defensible. ([LightBurn pricing](https://lightburnsoftware.com/blogs/news/new-lightburn-license-types-and-pricing-coming-oct-1-2024))

**Contested premise flagged:** the "LightBurn blocklisted Ortur/Atomstack diode lasers" story is **unverified** — the real 2024 controversies were the **Linux drop** and **price increases**. Don't build positioning on the blocklist claim.

---

## 9. Recommended stack & phased roadmap

**Stack:** React/TypeScript UI · geometry core in **WASM** (Clipper2 for boolean/offset/kerf, potrace/VTracer for raster import, custom dithering) running in **Web Workers** · **WebGL/WebGPU on OffscreenCanvas** for rendering · **OPFS** for project blobs + **IndexedDB** for metadata · **service worker** app-shell caching for offline · **Web Serial** for GRBL · a signed, auto-updating **native local agent** (localhost WebSocket bridge, Win/Mac/Linux) for Ruida/galvo.

| Phase | Scope | Hardware path | Est. effort* |
|---|---|---|---|
| **1 — MVP** | Design/CAM core, layers/cut settings, image dithering, GRBL streaming + jog, offline PWA | Web Serial (Chromium desktop) | 2–3 devs, ~6–9 months |
| **2 — Pro CO2** | Native local agent; Ruida over UDP; camera alignment (OpenCV.js) | Agent bridge | +2–3 devs, ~6–9 months |
| **3 — Galvo/fiber** | EZCAD2/BJJCZ via agent (WebUSB fallback); rotary; advanced dithering | Agent bridge / WebUSB | +6+ months |
| **Ongoing** | Parity polish (material test, art library, print-and-cut refinements) | — | continuous |

*Rough, given LightBurn reached today's state with a single-digit team over ~8 years. A focused GRBL competitor is a fraction of that; **full** parity is a multi-year commitment.

**Top blockers, ranked:**
1. **No raw UDP in browsers** → native agent is mandatory for Ruida Ethernet. Architect for it from day one.
2. **Chromium-only** (no Safari/iOS, shaky Firefox) → narrows TAM; must be messaged clearly.
3. **Camera lens correction** → hardest single feature; OpenCV.js in WASM.
4. **Robust in-browser real-time streaming** → hand-rolled character-counting + reconnection; no library does it for you.
5. **Driver-claim battles** (WebUSB vs kernel serial/FTDI; Zadig/WinUSB) for USB Ruida/galvo → another reason the agent wins.

---

## 10. Bottom line

Build it — but build it as **"an offline-first web app with a small native companion,"** not "browser-only." The design/CAM engine and GRBL control run beautifully in a Chromium PWA and slot into a real, unoccupied market seam (cross-platform + offline). The professional DSP/galvo tiers require a native helper — which is exactly what LightBurn already does — so that requirement is a known, financeable cost, not a surprise. The two genuine watch-items are the Chromium-only reach and the camera-alignment subsystem; everything else is precedented and tractable.

---

### Key uncertainties carried forward
- Firefox Web Serial "support" is nascent/contested; Android USB-serial is limited and new.
- WASM performance range (1.3×–2.5× slower than native) is the reliable band; ignore single-blog "92% of native" claims.
- Market dollar figures are vendor estimates with wide variance; LightBurn's active-user count is not public.
- "LightBurn blocklisted cheap diode lasers" is **unverified** — real controversies were Linux + pricing.
- No LightBurn patents surfaced, but a formal USPTO clearance search was not performed.
