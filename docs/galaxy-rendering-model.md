# Scale Contexts & the Milky Way Rendering Model

**Status:** living reference — settled parts are marked **DECIDED**, open ones **TBD**
**Owner:** rendering / nav
**Created:** 2026-06-25
**Why this exists:** the scale-context model and the Milky Way render rules were never
written down in one place. That gap caused a real regression (the whole galaxy went
invisible at the far vantage — see `docs/research/galaxy-procgen-coverage-regression.md`)
because an engineer reasoned about "coverage" with a wrong mental model of the data. This
doc is the single source of truth so we **don't repeat those mistakes**. Read it before
touching `GalaxyScene`, the `streaming` coverage signal, or the `nav` context-switch law.

Related: `architecture.md` §2/§5.2/§5.6/§5.7, `decisions/ADR-003-octree-tiling.md`,
`decisions/ADR-004-galaxy-density-wave.md`, `decisions/ADR-006-gaia-subset-tier-unification.md`.

---

## 1. The scale contexts (the mental model)

The universe is **not one world** — it is a hierarchy of local coordinate frames
("contexts"), each with its own unit so f32 render math never blows up (architecture §5.2).
The camera is in exactly one context at a time; `nav` switches between them at distance
thresholds with hysteresis.

| Context | Unit | What it is | What renders today | State |
|---|---|---|---|---|
| `universe` | 1 Mpc | The **local group** — the Milky Way as one galaxy among others | **Only the Milky Way** (as procgen cloud / impostor). The other 11 generated galaxies are **not drawn**. | ⚠️ sparse + **unreachable from a galaxy boot** (see §5) — FUTURE WORK |
| `galaxy` | 1 pc | The **entered galaxy's disc** (today only the Milky Way). | Procgen MW (cloud + dust + impostor) **and** the real catalog (octree HYG+Gaia, monolith). | ✅ active — this is where the bugs live |
| `system` | 1 AU | A **star system** (e.g. Sol): host star + planets/orbits. | System bodies (PBR planets, orbits), local star field. | ✅ active |
| `planet` | 1 km | A **planet surface** (terrain, atmosphere). | Terrain + atmosphere shells. | ✅ active (Phase 4) |

### The key insight that was NOT obvious

There is **no separate "galaxy from far" context.** The vantage where you "see the whole
Milky Way as a spiral" (~49 kpc) and the vantage "inside the star field near Sol" are **the
same `galaxy` context, at different distances.** The only thing that distinguishes them is
**distance from the galaxy centre** (which, today, is also Sol — see below).

So the user-facing "views" map onto contexts like this:

| User-facing view | Context | Distance from centre |
|---|---|---|
| "Milky Way from outside" (the spiral) | `galaxy` (outer edge) | ~49 kpc |
| "Inside the galaxy" (star field) | `galaxy` (near) | ~0–few kpc |
| "Solar system" | `system` | at Sol |

**"Selected galaxy" = whichever galaxy you entered = `galaxy` context.** Today the only
anchorable galaxy is the Milky Way, pinned at the universe origin, so `galaxy` context is
always the Milky Way. When more galaxies become enterable, each becomes the `galaxy`
context while you're inside it.

### A simplification to remember

`SOL_POS = [0,0,0]` in the galaxy frame — i.e. **Sol is modelled at the galactic centre.**
(Real Sol is ~8 kpc out; the app does not model that offset yet.) This is why
"distance from centre" and "distance from Sol" are the same number today, and why distance
is a clean signal for the procgen fade.

### Context boundaries (nav, `galaxy-switch.ts`)

- `universe → galaxy`: when camera is within **~50 kpc** of the galaxy anchor (`enterGalaxyAtM = 1.543e21 m`).
- `galaxy → universe`: when camera leaves **~100 kpc** (`exitGalaxyAtM = 3.086e21 m`), **and only if it entered galaxy from universe** (`ownGalaxyContext` — see §5).
- `galaxy ⇄ system`: at the system enter/exit thresholds (≪ 1 pc).

---

## 2. The three star layers (recap)

Inside `galaxy`, up to three layers can draw the same sky. The whole point of the M4a
"tier unification" was that **one layer should dominate per scale** (architecture §2, §5.7;
ADR-006), not all three at once.

| Layer | What it is | Where it should own the view |
|---|---|---|
| **Monolith HYG** | `stars.bin`, ~110k nearest/brightest stars, always resident | a no-blank-frame fallback near Sol |
| **Octree** | streamed tiles (HYG + a 135-star Gaia sample) | the **real catalog**, near/mid |
| **Procgen** | density-wave cloud (~1M pts) + dust-lane billboards + far impostor | the **shape of the galaxy**, far out |

**Catalog vs procedural is by design, from day one** (architecture §2): real catalogs give
the ~10⁵ nearest/brightest stars (credibility); procedural fills everything beyond catalog
reach (the spiral, the arms, density, wonder). **The spiral was ALWAYS procedural** — Gaia/HYG
are a tiny Sol-local bubble and could never form a 15 kpc spiral. See ADR-004 (density-wave
model: 15 kpc disc, 2 arms, rejection sampling).

---

## 3. The Milky Way rendering model

### 3.1 Principles — **DECIDED**

- **P1.** Real catalog = local detail; procgen = the galaxy's shape. They overlap and
  cross-fade; they are not the same picture.
- **P2.** **Near Sol the procgen is OFF.** Drawing ~1M procgen points on top of the real
  catalog is redundant and heavy. The catalog owns the near view.
- **P3.** **Far out the procgen is ON.** It is the *only* thing that gives the galaxy a
  shape; the real catalog is an invisible dot at 49 kpc.
- **P4.** The transition between P2 and P3 is a **smooth cross-fade**, not a hard switch.
  This continuous "spiral arms → star field → Sol" zoom is the project's signature demo
  (architecture, M3).

### 3.2 The driving signal — **DECIDED: distance, NOT coverage**

The procgen fade is driven by **distance from the galaxy centre**
(`smoothstep(GAL_FADE_LO_PC=18000, GAL_FADE_HI_PC=45000, dist)`): 0 near Sol → 1 far out.

> **Do NOT drive it by `catalogCoverage()`.** This was tried (M4a / ADR-006) and it broke
> the galaxy entirely. The reason is a data/geometry trap, documented in full in
> `docs/research/galaxy-procgen-coverage-regression.md`:
> - The octree is **galaxy-scale-boxed** (`rootHalfExtentUnits ≈ 65 kpc`) but its stars are
>   **Sol-local**. Far out, the cut collapses to a few **coarse tiles** (live `drawCalls ≈ 9`)
>   whose geometric boxes **fill the screen though they are mostly empty**.
> - So `catalogCoverage()` (Σ projected tile area) **saturates to ~1 at every distance inside
>   the galaxy** — it cannot tell "near Sol" from "49 kpc". Driving procgen by `1 − coverage`
>   then permanently vetoes the spiral far out → black galaxy.
> - **No normalization of tile area fixes this** (screen-relative was tried and disproven by
>   live measurement: coverage still read 1.000 at 49 kpc).

`catalogCoverage()` is still **fine for the monolith gate** (`StarScene`), because near Sol
the camera is *inside* the octree and coverage ≈ 1 there is *correct*.

### 3.3 Current implementation (`GalaxyScene.tsx`)

```js
// galaxy context, with a flight controller:
procgenBlend = flying ? Math.min(coverageFade, distanceFade) : distanceFade;
```
- **Parked:** pure `distanceFade` → galaxy visible far, off near Sol. ✅ fixes the bug.
- **In a goTo flight:** keeps the old conservative blend so the near-Sol flight budget that
  `flythrough4` §5.4 measures cannot regress. ⚠️ side effect: the spiral does not fade in
  *during* the outbound flight — it resolves on arrival (a small pop). This is the §6
  "black during flight" item, still open.

### 3.4 The decision (the three user-facing "places")

The render model is framed around the **three places a user actually stands**, not abstract
distances (distances in between are just the transition flight, where the user does not stop):

| Place | Context / distance | Procgen MW |
|---|---|---|
| **1 — Milky Way** (the spiral from outside) | `galaxy`, ~49 kpc | **ON** — it *is* the galaxy |
| **2 — Inside the galaxy** (the star field) | `galaxy`, near Sol | **OFF** (for now — see below) |
| **3 — Solar system** | `system`, at Sol | not the subject (off) |

- **D1 / D5 — Procgen in Place 2: OFF, deliberately (2026-06-25). REVISIT trigger below.**
  Today Place 2 shows only the real catalog (~117k HYG stars + a 135-star Gaia sample), which
  looks **sparse/empty**. The decision is **not** to paper over that emptiness with the
  procedural cloud — because drawing procgen on top of the real stars near Sol is the exact
  redundant overdraw M4a set out to remove, and because we cannot judge whether a procedural
  background is even *needed* until we see Place 2 at its intended star density.
  **REVISIT when Place 2 has a realistic catalog** (the Phase 4 fuller Gaia octree — see §6).
  At that point re-evaluate Model A vs Model C (§3 of the regression research doc): keep
  Place 2 catalog-only, or add the "Milky Way band" background via a **spatial** handoff
  (catalog near + procgen far, non-overlapping) rather than a global opacity fade.
- **D2 — Fade band: keep `GAL_FADE_LO=18 kpc / HI=45 kpc` for now.** This keeps procgen off
  through Place 2 and fully on by ~45 kpc (before the ~49 kpc Place-1 vantage). It only
  manifests procgen in the Place-1 view, which matches the decision above. Re-tune only when
  D1 is revisited.
- **D3 — Flight behaviour: accept the on-arrival pop for now.** The spiral resolves when the
  camera parks at Place 1, not during the outbound flight (the `flying` branch keeps the
  conservative blend so the `flythrough4` §5.4 budget gate cannot regress). Smooth-fade-in
  during flight is deferred — it needs that gate re-targeted to a settled near-Sol frame.
- **D4 — Far-LOD "blob vs spiral": OUT OF SCOPE here.** That clumpy look was observed in the
  *universe* peek (§5), which is paused future work, not the Place-1 galaxy view.

---

## 4. Anti-patterns — do NOT do these again

1. **Do not gate procgen visibility on `catalogCoverage()` inside the galaxy.** The signal
   saturates to ~1 everywhere (§3.2). It measures the octree *boxes*, not the *stars*.
2. **Do not assume the octree is Sol-local.** Its root is ~65 kpc; the descent stops at
   coarse galaxy-scale tiles far out.
3. **Beware budget gates that reward "procgen OFF".** The `flythrough4` §5.4 near-Sol gate
   measures the descent *flight*, where procgen being vetoed lowers the point count — which
   silently entrenched the invisible-galaxy bug. Gate on the *intended* state (a settled
   near-Sol frame), not on a flight artifact.
4. **You cannot verify this in the headless dev preview.** The WebGL streaming path does not
   tick there (screenshot times out, `loadedChunks = 0`). Verify the visual with the user or
   CI Playwright; locally rely on `pnpm verify` + the unit math.

---

## 5. Universe view — EXISTS but PAUSED, future work

**The `universe` context is real and wired** (units = 1 Mpc; `nav` has the full universe⇄galaxy
switch law in `galaxy-switch.ts`; the procgen Milky Way renders in it). It is the intended
home of the **local group** — the Milky Way as one galaxy among others. But it is **not
finished and intentionally parked**, for two reasons:

- **Unreachable from a galaxy boot (by design today).** `nav` only exits `galaxy → universe`
  when `ownGalaxyContext` is true, i.e. when the camera *entered* galaxy from universe
  (`controller.ts` `maybeSwitchContext`). The production app boots in `galaxy`, so that flag
  is always false and free flight can never ascend. The descent demo (`?debug=m3`) is the
  only thing that starts in universe. *(During investigation we briefly added a temporary
  `__cosmosDev.enterUniverse()` dev hook to peek — it confirmed the context works and renders
  the MW from outside, but it was REMOVED; no nav path to universe ships today.)*
- **Nearly empty.** `generateLocalGroup` makes 12 galaxies, but `makeLocalGroup` renders
  **only the Milky Way** (index 0 at the origin); the other 11 are generated and never drawn.
  A live peek confirmed: the MW reads as a clumpy procgen cloud on black, nothing around it.

To make a real universe view later: (a) render the local-group galaxies (impostors at
least), (b) add a legitimate "go to universe" path (a deliberate switch + a breadcrumb
button, not a gate-override), and (c) decide the MW's far-LOD look from outside (impostor vs
billboard cloud — the "blob vs spiral" question). All need live/CI verification.

---

## 6. Star density in Place 2 — the Phase 4 dependency (the D1 revisit trigger)

Place 2 (inside the galaxy, the star field) currently renders only **~117k HYG stars + a
135-star Gaia sample** — it looks **sparse/empty**. This is a *data* gap, not a render bug:
the full Gaia subset octree planned for Phase 4 (architecture M4, ADR-006) is not packed
yet; today the app ships HYG + a token Gaia sample (`packs/octree-gaia-sample`, 135 stars).

This is the **explicit trigger to revisit D1/D5** (§3.4): only once Place 2 shows its
intended star density can we judge whether it still looks empty and therefore whether a
procedural background (the "Milky Way band", Model C) is actually wanted inside the galaxy —
versus a real catalog that fills the view on its own. **Do not add procgen to Place 2 to
mask the current emptiness.** Bring the stars first, look, then decide.

Sequence: (1) pack the fuller Gaia octree → (2) view Place 2 at real density → (3) revisit
D1 (catalog-only vs catalog + procgen band) → (4) if a band is wanted, implement the spatial
handoff (Model C), not a global opacity fade.
