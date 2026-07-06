# LaserKerf

Offline-first, installable **PWA** that clones LightBurn (laser design + CAM + machine control) as closely as practical, with a signed native companion **Agent** for hardware the browser can't reach (Ruida DSP, galvo/fiber). Commercial product, GRBL-first, phased to full parity. Targets **Chromium desktop** (Web Serial / WebUSB).

> Not affiliated with LightBurn. Never uses the "LightBurn" trademark, logo, icons, or copied UI art.

See **[PROJECT.md](./PROJECT.md)** for the project charter, and **[CLAUDE.md](./CLAUDE.md)** for how to work in the repo.

## Documentation
Planning and architecture live in [`docs/`](./docs):

| Doc | What |
|---|---|
| [docs/README.md](./docs/README.md) | Docs index / entry point |
| [01-feasibility-study.md](./docs/01-feasibility-study.md) | Go/no-go analysis, constraints, market/legal |
| [02-development-plan.md](./docs/02-development-plan.md) | Architecture, milestones M0–M9, parity checklist |
| [03-implementation-plan.md](./docs/03-implementation-plan.md) | Claude Code execution backlog (task cards) |
| [06-decision-log.md](./docs/06-decision-log.md) | Decisions + rationale (project genesis) |
| [CLAUDE.md](./docs/CLAUDE.md) | Project memory for Claude Code |

## Deployment
Deployment: see [`DEPLOY.md`](./DEPLOY.md).

## Status
In implementation. M0 (Foundations) complete; M1 (design/vector) and M2 (CAM/G-code) in progress; M3 (GRBL control → MVP) next. See [`docs/03-implementation-plan.md`](./docs/03-implementation-plan.md) for the live task-by-task state.
