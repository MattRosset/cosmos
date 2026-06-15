# Research — Navigation UX, system enter/exit, and playtest tooling

**Date:** 2026-06-14 · **Status:** research / proposal (no production code changed)
**Trigger:** pre–Phase 3 review. User reports: (a) entering exoplanet systems shows
planets orbiting *nothing* (no star), (b) navigation is opaque — after selecting a
star you cannot tell whether it has a system you can enter, and there is no explicit
"enter/exit system" affordance.

This document records findings grounded in the current code, proposes fixes, and
flags **API-freeze timing** (TASK-030 freezes `data`, `app-state`, `ui`, `nav`,
`render-planets` and the v2/v3 surfaces when it lands). Anything touching those
packages is cheaper to do **before** the freeze or via an explicit Phase-3 thaw.

---

## 1. Finding — exoplanet systems render no host star (confirmed bug)

**Symptom:** fly into TRAPPIST-1 (or any exo host) → planets orbit empty space.

**Root cause.** `SystemScene` only renders `system.bodies`
([SystemScene.tsx](../../apps/web/src/scene/SystemScene.tsx)). For Sol, the pack
includes a body `sol:sun` (`kind:"planet"`, `unlit:true`, `radiusKm:695700`) so a
disc is drawn at the origin. For exoplanets, `pack-exoplanets` builds
`bodies: PlanetRecord[]` from **planets only** — the host is kept as
`system.star` (a `StarRecord`, data-only, used for lighting direction and host
position) and **never emitted as a renderable body**
([convert.ts `buildSystem`](../../tools/pack-exoplanets/src/convert.ts)). So exo
systems have nothing at the origin.

**Why the fix is cheap (render side already supports it).**
`createPlanetMesh` with `unlit:true` and no albedo texture renders a flat disc
using `surfaceColorLinear` via `PLANET_FRAG_UNLIT`
([planet-mesh.ts](../../packages/render-planets/src/planet-mesh.ts)). A bodies-list
entry with no `elements` is auto-placed at the system origin by `SystemScene`. So
the host disc needs **no render-package change** — it is purely a data gap.

**Proposed fix (data-only, symmetric with Sol).** In `pack-exoplanets`, emit one
extra body per system: `exo:<slug>:star`, `kind:"planet"`, `unlit:true`,
`parentId:<systemId>`, no `elements`, with:
- `radiusKm` = `st_rad`(solar radii) × 695 700 km, fallback ~solar (the archive's
  `st_rad` is already read in [synthesize.ts](../../tools/pack-exoplanets/src/synthesize.ts)
  for luminosity);
- `surfaceColorLinear` from the star's B−V / Teff (a warm/cool tint), reusing the
  existing color logic.
Then regenerate `systems-exo.json`. Tools are **not** frozen by TASK-030, so this
fix is viable at any time — lowest-risk item here.

**Caveats to verify during implementation:**
- The star disc joins the **pick group** and the **nearest-surface feed** — desirable
  (you can click the star; flight slows near it), but re-check the M2 perf budget.
- A star should read brighter than a planet; `unlit + color` is a flat disc with no
  glow. True stellar glow/bloom is a **Phase 4** render-FX item (architecture §
  render-fx). Acceptable interim: a bright unlit disc now.
- The exo-star body is sub-pixel from a close planet (same as Sol — see §2).

---

## 2. Finding — Sol's star renders but is sub-pixel / has no locator

From Saturn (~9.5 AU) the Sun subtends ≈0.7 px at 1280×720, so it is effectively
invisible even though it *is* drawn. This is correct physics, but the UX gives no
cue where the star is. Options (all **Phase 4-ish**, low priority):
- a minimum-screen-size floor / billboard glow for the host star,
- selective bloom on emissive (already on the architecture's render-fx roadmap).
Recommend deferring to Phase 4; note it so it isn't forgotten.

---

## 3. Finding — navigation enter/exit is implicit and opaque (UX gap)

**Current model (automatic, hysteresis-based).** `NavDriver` scans for the nearest
host at ≤10 Hz and sets the system anchor; the flight controller auto-switches
galaxy→system when the camera is within `enterSystemAtM = 7.5e14 m` and
system→galaxy past `exitSystemAtM = 1.5e15 m`
([context-switch.ts](../../packages/nav/src/context-switch.ts)). `goTo` to a
star/host uses `HOST_ARRIVAL_M = 5e14` (inside the enter gate), so arriving auto-
enters ([goto.ts](../../apps/web/src/glue/goto.ts)). The TASK-030 gate just proved
this transition is visually seamless.

**Problems for the user.**
1. **No "enterable" signal.** Selecting a random HYG star gives a "Go to" button
   ([InfoPanel.tsx](../../packages/ui/src/InfoPanel.tsx)) with no indication of
   whether the star has a system. Most HYG stars have **no** planet data → flying
   there does nothing interesting, and the user can't know in advance.
2. **No explicit enter/exit.** Entering/leaving is a side effect of how close you
   fly. There is no "Enter system" / "Exit to galaxy" action.

**Which stars are enterable (data already knows).** A star is a host iff its id is a
`systemId` (unresolved exo hosts: picked id canonicalizes to `exo:<slug>`) **or** it
is the HYG star a system deduped to (Sol: `systems-sol.json` `star.id = "hyg:0"`).
`combined` already holds `hostBySystemId` with the optional `hygId`
([combined.ts](../../packages/data/src/combined.ts)); a reverse lookup
`systemIdForStar(starId): BodyId | undefined` is a small addition.

**Proposed UX (minimal, reuses the seamless transition we have).**
- **`data`** (frozen): add `systemIdForStar(starId)` (or `isHost(starId)`) to
  `CombinedSource`.
- **`ui` InfoPanel** (frozen): when the selected star is enterable, show an
  **"Enter system"** button (calls the existing host-`goTo`, which auto-enters on
  arrival); when it is not, show a muted "No known planets" line instead of/under
  "Go to". When already in a system, show **"Exit to galaxy"**.
- **`app-state`** (frozen): a tiny `contextStore` mirroring `contextId` +
  `anchorSystemId` (today this lives only in the e2e `testHook`
  [test-hook.ts](../../apps/web/src/glue/test-hook.ts)) so the HUD can react without
  Canvas re-renders. A small on-screen **context indicator** ("Galaxy" / "In: Sol")
  closes the orientation gap.
- **`nav`** (frozen, optional): an explicit `exitSystem()` helper (goTo outward past
  the exit gate) so "Exit" is one call rather than ad-hoc.

This keeps the proven auto-switch but adds the *affordances and feedback* the user
wants. Net new API surface is small and all on frozen packages → **timing matters**.

---

## 4. Finding — playtesting requires a 20 s flight each time (tooling gap)

Today's debug entry points are `?debug=markers|jitter|ctxswitch` and the e2e
`window.__cosmos` testHook. To validate features you must search → goTo → wait for a
multi-second flight. Proposed dev-only helpers (gate behind a `?dev` flag, zero prod
cost, mostly in `apps/web` glue — **not** frozen):
- **Instant jump:** `?jump=sol:saturn` / `?jump=exo:trappist-1` sets the anchor +
  context + camera directly (skip the goTo animation).
- **Context/distance overlay:** extend `DebugHud` with current context, anchor,
  camera→host distance vs the enter/exit gates, and fps — makes the auto-switch
  legible while testing.
- **Enterable list:** a dev dropdown of all host systems to teleport to.
These also make manual QA of Phase 3 (galaxy/streaming) far cheaper.

---

## 5. Phase 3 does **not** cover any of this

Phase 3 = Galaxy & Streaming (procgen galaxy, streaming octree, `render-galaxy`,
`universe` context, adaptive quality; milestone M3 = continuous Milky-Way→Earth
zoom) — architecture §6. **Navigation UX, enter/exit affordances, and the exo-star
fix are in no planned phase.** They are gaps, not scheduled work.

---

## 6. Recommendation — a short pre-freeze "nav polish" window (M2.5)

Because §3 touches four frozen packages (`data`, `ui`, `app-state`, `nav`), the
clean path is to land it **before flipping TASK-030 to `done`** (which freezes those
APIs and opens Phase 3). Concretely:

1. Keep TASK-030 `in-progress` until CI sign-off **and** the nav-polish decisions
   below are made, so we don't freeze then immediately thaw.
2. Sequence:
   - **NAV-A (data-only, anytime):** exo host-star body in `pack-exoplanets` +
     regen `systems-exo.json`. Fixes §1. No frozen-API change.
   - **NAV-B (frozen APIs, pre-freeze):** `systemIdForStar` in `data`; "Enter/Exit
     system" + "No known planets" + context indicator in `ui`; `contextStore` in
     `app-state`; optional `nav.exitSystem()`. Fixes §3.
   - **NAV-C (dev tooling, anytime):** `?jump=` + context overlay + enterable list.
     Fixes §4.
3. Defer §2 (stellar glow/bloom) to Phase 4 render-FX.

Alternative if we want to ship the gate now: flip TASK-030, then do NAV-B as an
explicit, recorded Phase-3 thaw of `data`/`ui`/`app-state`/`nav` (the project already
has precedent for scoped thaws). NAV-A and NAV-C need no thaw regardless.

**Open decisions for the user/architect:**
- Pre-freeze nav window vs. post-freeze thaw for NAV-B?
- Keep auto-switch **and** add explicit buttons (recommended), or move to fully
  explicit enter/exit?
- Interim bright-disc star now vs. wait for Phase-4 glow?

---

## Appendix — evidence

- Exo system has only planets in `bodies` (no star):
  `node -e` over `systems-exo.json` → `exo:trappist-1` = 7 planets, 0 star bodies.
- Sol pack includes `sol:sun` (`unlit:true`) → 1 `"unlit"` entry in `systems-sol.json`.
- `createPlanetMesh` unlit + no-texture path renders `uBaseColor` (surfaceColorLinear).
- Enter/exit gates: `enterSystemAtM = 7.5e14`, `exitSystemAtM = 1.5e15`
  (`DEFAULT_CONTEXT_SWITCH_POLICY`).
- Host↔star linkage: `hostBySystemId` (with optional `hygId`) in `createCombinedSource`.
