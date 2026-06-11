# cosmos — Universe Explorer

A browser-based, real-time 3D universe explorer: seamless zoom from intergalactic scale down to planetary surfaces, rendering real star catalogs (HYG, Gaia subsets, NASA Exoplanet Archive) blended with procedural content.

Built web-first with React, TypeScript, Three.js (React Three Fiber), and Web Workers — designed for a small team heavily assisted by AI coding agents.

## Status

**Phase 0 complete — Phase 1 (MVP Stars) in progress.** The full technical design lives in
[`docs/architecture.md`](docs/architecture.md). Execution is tracked task-by-task in
[`docs/agent-tasks/README.md`](docs/agent-tasks/README.md) — agents: start there.

## Key Documents

| Document | Purpose |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Complete technical design: stack, system decomposition, roadmap, budgets, standards |
| `docs/decisions/` | Architecture Decision Records (ADRs) |
| [`docs/agent-tasks/README.md`](docs/agent-tasks/README.md) | **Task index, status table, and execution rules for AI coding agents** |

## Stack (summary)

- **Language:** TypeScript (strict)
- **Framework:** React 19 + Vite
- **3D:** Three.js via React Three Fiber + drei (WebGL2 baseline)
- **State:** Zustand
- **Compute:** Web Workers + Comlink
- **Monorepo:** pnpm workspaces + Turborepo
- **Testing:** Vitest + Playwright (E2E, visual regression, perf)
- **Hosting:** Static CDN (Cloudflare Pages / Vercel) — no backend in MVP

## Roadmap (summary)

| Phase | Milestone | Weeks |
|---|---|---|
| 0 | Foundation: monorepo, coordinate/scale architecture, camera | 1–2 |
| 1 | **M1:** Fly among 120k real stars (HYG), search, select, info | 3–6 |
| 2 | **M2:** Solar system + exoplanets, orbits, time acceleration | 7–11 |
| 3 | **M3:** Seamless zoom galaxy → star → planet, streaming + LOD | 12–16 |
| 4 | **M4:** Gaia 2–5M stars, planet terrain, atmospheres, nebulae, tours | 17–24 |
| 5 | Stretch: black hole lensing, WebGPU, cinematic extras | — |

## Core Architectural Rules

1. **Scale contexts, not one giant world** — hierarchical coordinate frames with floating origin (see §5.2 of the architecture doc — the critical path).
2. **Render thread is sacred** — heavy work runs in workers, transferable buffers only.
3. **Every subsystem is a package** with a frozen, typed public API; agents work one package at a time.
4. **React owns structure, never per-frame data.**
5. **Determinism everywhere** — seeded PRNG, pure generators, reproducible data packs.
