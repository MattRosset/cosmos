# Procgen near Sol — give "inside the galaxy" some density

**Type:** design + implementation (exploratory; expect a judgment call, maybe a short ADR).
**Priority:** medium (it is the payoff of the whole dense-pack thread). **Lane:** `apps/web`
scene composition (GalaxyScene) + possibly `render-galaxy`/`procgen` LOD. **Size:** M.

> Read first: `docs/galaxy-rendering-model.md` (the durable model),
> `docs/research/galaxy-procgen-coverage-regression.md` (BUG-9, why procgen fade became
> distance-driven), and the memory note `procgen-still-belongs-real-density-sparse.md`. Master
> spec: `docs/architecture.md` §5.7–§5.8 + ADR-006. Architecture/ADR win over this brief.

## The finding that motivates this

Measured 2026-06-25 with the real 3M Gaia pack (`docs/research/bug-10-streaming-density-wall.md`):
**from inside the galaxy (at Sol) the real bright catalog is a sparse star field, not a dense
galaxy.** 1.8M points are drawn but spread over the full 4π sphere and out to kpc, so the view is
a realistic-but-sparse night sky; cranking exposure 120× revealed only a few more — it is
genuinely sparse, not merely faint. The dense "galaxy look" (spiral, glow, HII) is **100% the
procgen filler**, visible only from the far vantage.

Today the procgen cloud is faded **fully off near Sol** by the distance-driven blend
([GalaxyScene.tsx](../../apps/web/src/scene/GalaxyScene.tsx),
`procgenBlend = smoothstep(GAL_FADE_LO_PC=18_000, GAL_FADE_HI_PC=45_000, dist)` ⇒ 0 at Sol). That
choice (BUG-9 era, retiring the old `GAL_PROCGEN_FLOOR`) assumed *"near Sol the real catalog owns
the neighbourhood"*. The measurement shows it doesn't — so near Sol you get a near-black, sparse
view instead of the inside of a galaxy.

## The design question

How should the inside-the-galaxy view convey galactic density, given that the real catalog alone
is sparse and the procgen was designed/tuned for the *far* vantage? Decide and implement a
near-Sol treatment that:

- gives "inside" a believable sense of the surrounding star field / Milky Way band, **without**
- re-drawing the resolved bright stars the catalog already shows (double-render / colour clash),
- the additive-overdraw perf trap the BUG-9 note warns about (full procgen at full draw near Sol),
- regressing what BUG-9 fixed (the spiral must still appear correctly at the far vantage; the
  flythrough4 §5.4 work-budget gate must stay green), and
- coupling to the trivially-saturated `catalogCoverage()` (BUG-9's root cause — keep it
  distance/vantage-driven, not coverage-driven).

## Step 1 — empirical first (do this before designing)

Match the project's measure-before-theorise doctrine. With the 3M pack wired
([App.tsx:116](../../apps/web/src/App.tsx) → `/packs/octree-gaia/octree.json`; build it per the
research doc if absent), **temporarily force `procgenBlend` to a few non-zero values at Sol**
(e.g. 0.15 / 0.35 / 0.7) and screenshot. Answer empirically:

- Does procgen *from inside* read as a dense star field / Milky Way band, or as ugly blown-up
  nearby procedural blobs? (The cloud/impostor was tuned for far viewing — inside it you are
  *within* the point cloud; its per-point size/brightness and the impostor billboard may look
  wrong up close.)
- At what blend does it complement the real catalog without washing it out?
- Frame cost: does drawing procgen at full near Sol re-introduce a stall? (Watch
  `window.__cosmos.streaming` + the `?debug=breadcrumb-profile` phase timers.)

This screenshot study decides the approach. Record it (a short note or ADR) — the answer is not
obvious and the user will want to see the comparison.

## Likely approaches (pick based on Step 1, don't pre-commit)

1. **Partial near-Sol floor.** A small `procgenBlend` floor (e.g. 0.1–0.25) near Sol so the band
   is present but dim, ramping to full at the vantage. Cheapest; risks the overdraw trap and the
   up-close-cloud-looks-wrong problem unless the floor is low.
2. **Distinct near-field procgen LOD.** Render procgen near Sol through a different LOD path tuned
   for being *inside* it (smaller points, a Milky-Way-band impostor on the sky sphere rather than
   the full disc cloud). More work; likely the *correct* answer if Step 1 shows the far-tuned
   cloud looks wrong up close. May touch `render-galaxy` / `procgen`.
3. **Sky-band impostor only.** Near Sol, drop the disc point cloud entirely and show only a
   textured Milky-Way band on the far sky (cheap, no overdraw, reads as "you're inside a galaxy").
   The real catalog provides the foreground stars; procgen provides the background band.

Approach 3 or 2 is most likely right (a galaxy seen from inside *is* a band across the sky, not a
face-on spiral). Approach 1 is the quick experiment but probably not the ship answer.

## Deliverables

- The chosen near-Sol procgen treatment, implemented in `GalaxyScene.tsx` (blend/LOD selection)
  and whatever `render-galaxy`/`procgen` support it needs. Keep the far-vantage path byte-for-byte
  unchanged if possible (or prove it unchanged via the flythrough4 gate).
- Constants documented (replace/augment `GAL_FADE_LO_PC`/`GAL_FADE_HI_PC` with the new model;
  explain in the doc comment why, superseding the "near Sol the cloud truly reaches 0" comment).
- A short write-up (extend `docs/galaxy-rendering-model.md` or a new ADR) recording the Step-1
  screenshots and the decision.

## Acceptance

- **Visual:** parked at Sol with the 3M pack, the view conveys galactic density (a Milky-Way band
  / dense backdrop), not near-black — *and* the resolved bright catalog stars are still visible
  and not double-drawn. Screenshots before/after at Sol + at an intermediate distance + at the
  vantage.
- **No regression:** the spiral still resolves correctly at the ~49 kpc Milky Way vantage; the
  `?debug=flythrough4` work-budget gate (§5.4) stays green; `?debug=m4a` / m4a e2e unaffected.
- **Perf:** no new stall near Sol — `streaming.update` and `galaxy.render` phase timers stay
  within budget at Sol (post-P0 they are ~2 ms + ~0.1 ms; the procgen draw must not blow that).
- `pnpm verify` exits 0.

## Notes / gotchas

- Keep it **distance/vantage-driven**, never coverage-driven (BUG-9). `catalogCoverage()` reads
  ~1 everywhere inside the galaxy and is unusable as a fade signal here.
- During a `goTo` flight the draw cap (`GAL_FLIGHT_DRAW_MAX`) and the conservative blend are load-
  bearing for the flight budget — preserve that path or re-validate flythrough4.
- The procgen generator is deterministic (`createPrng`, no `Math.random()`); any new LOD must keep
  that.
- This is the question "does procgen still belong inside?" — the measured answer is **yes**
  (`procgen-still-belongs-real-density-sparse.md`); this task makes "inside" actually show it.
