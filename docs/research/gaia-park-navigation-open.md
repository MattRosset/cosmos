# OPEN — Gaia park navigation after TASK-070

**Status:** open (logged 2026-08-03; not diagnosed in depth).  
**Related:** `gaia-far-fly-quality-collapse.md` (FPS/black fixed); NavDriver speed-law follow-up.

Two distinct gaps reported when parked at a far Gaia star (search →
`3946392046023296`):

---

## 1. Free-flight feels “off” / stuck (WASD)

**Symptom:** After arrival you can look around, but translational travel feels dead or
unusable — cannot cruise away from the star.

**Plausible mechanism (unconfirmed — needs measurement):**

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
