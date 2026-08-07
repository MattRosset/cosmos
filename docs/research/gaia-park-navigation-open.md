# OPEN — Gaia park navigation after TASK-070

**Status:** open (logged 2026-08-03; not diagnosed in depth).  
**Related:** `gaia-far-fly-quality-collapse.md` (FPS/black fixed); NavDriver speed-law follow-up.

Two distinct gaps reported when parked at a far Gaia star (search →
`3946392046023296`):

---

## 1. Free-flight feels “off” / stuck (WASD) — ✅ RESOLVED (TASK-091, 2026-08-07)

**Resolution:** the plausible mechanism below was **confirmed by measurement** (speed = 0 at
513 pc from Sol on the dense pack; `distanceToNearestSurface` ≈ 0) and fixed by TASK-091:
the galaxy speed law no longer uses the magic-500 guard or `streaming.nearestBodyDistanceM`
(the tile-AABB distance that collapses to 0 inside a covered tile). It now uses the true HYG
field-boundary precondition (`galaxyFarFieldSurfacePc` + `computeHygFieldBounds`). Post-fix
live: parked 2844 pc out, W+SHIFT cruises ~82 pc/s, surface feed ~1850 pc. Full writeup:
`docs/research/gaia-500pc-speed-wall.md`. Original analysis kept below for provenance.

**Symptom:** After arrival you can look around, but translational travel feels dead or
unusable — cannot cruise away from the star.

**Plausible mechanism (CONFIRMED 2026-08-07 — was: unconfirmed):**

Speed law is `speed ∝ distanceToNearestSurface`. The FPS hot-fix feeds that scalar from
`streaming.nearestBodyDistanceM` (distance to **chunk AABB**, not to the star). Parked
inside a fine Gaia tile that distance collapses toward **~0** → target speed → min →
effectively immobilized. Before the void-search fix, HYG nearest often returned a large
distance to Sol’s bubble (wrong physically, but “fast”); after the fix, streaming nearest
is “correct” for the tile and may over-clamp motion.

**Research needed:** log `nearestBodyDistanceM` / controller speed at park; decide whether
speed law at Gaia should use star distance (pick/card position), a floor, or a different
law. Same design thread as “prefer streaming for galaxy speed law / drop magic 500”
(`gaia-far-fly-quality-collapse.md` Step 6 follow-up).

---

## 2. Double-click another visible Gaia star does not fly there

**Symptom:** Another Gaia point is visible and pickable (card/select), but double-click
does not start a goTo.

**Code (intentional today):** `StarScene` dblclick — `gaia:*` is **select-only**;
`goto.goTo('gaia:…')` would no-op (no `BodyRecord`). Search uses `goToPosition(pc)`.

```ts
// StarScene onDoubleClick — gaia branch returns after selectAndUpgrade
if (id.startsWith('gaia:')) {
  selectAndUpgrade(id, gaia);
  return;
}
```

**Research needed:** product decision — wire dblclick / InfoPanel “Go” to
`goToPosition(gaia.positionPc)` (same as search), vs keep Gaia fly-to search-only.
Not a regression from the NavDriver FPS fix; a TASK-070/088 completeness gap.

---

## Suggested next research questions

1. At park, what are `nearestBodyDistanceM`, `distanceToNearestSurface`, and
   `speedUnitsPerS`? (falsifies or confirms §1)
2. Should galaxy free-flight nearest mean “nearest real star” (needs Gaia-aware
   nearest) vs “nearest loaded chunk”?
3. Should click-to-fly for Gaia reuse `goToPosition` everywhere search already does?
