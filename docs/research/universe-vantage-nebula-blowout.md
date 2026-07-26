# The universe vantage is washed out — the nebula sprites, not the impostor

> **CORRECTED 2026-07-26 — the attribution below is FALSE.** This doc blames the procgen dust
> lanes + HII sprites. Ablated since: skipping every dust/HII draw call at the same vantage
> moves mean frame luminance by 0.01 out of 250.58, and the dust layer's footprint sits exactly
> on the (correct) procgen star cloud's. The wash belongs to the `render-fx` **overlay** layers
> mounted by `Overlays.tsx` — the nebula fields and the constellation line-set. Read
> **`universe-vantage-blowout-is-the-overlays.md`** instead; the fix is TASK-085, not a
> dust-lane change. The observation sections below (what the screen showed, the TASK-080 round
> trip) still hold; only the "Why this is the dust/HII layer" attribution is wrong.

**Date:** 2026-07-26
**Status:** SUPERSEDED — observation valid, cause misattributed (see banner)
**Trigger:** TASK-080's "verification beyond the gate" — first time a human could stand in
`universe` context and look.

## What was observed

With TASK-080 implemented, clicking `◂ Universe` lands the camera at 0.18 Mpc in `universe`
context, facing the galaxy origin. The viewport is **washed to near-white across essentially
its whole area** — soft blobs with pink/cyan/green fringes, no readable object.

Mid-flight (still `universe`, ~0.06 Mpc remaining) the frame separates the layers cleanly and
is the key evidence:

- the procgen **star cloud** renders as a **small, bounded, correctly-sized blue clump** near
  the screen centre — TASK-081's `setContextScale` fix visibly working;
- the **nebula sprites** (dust lanes + HII) render as **enormous coloured blobs** filling and
  overflowing the viewport.

Round trip and instrumentation are otherwise clean: `errorCounts.total = 0` throughout,
`procgenOpacity = 1`, `catalogCoverage = 1`, 9 draw calls, 1,109,399 points. Nothing is
erroring — the geometry is just the wrong size.

## Why this is the dust/HII layer

`GalaxyScene.tsx:274-278` records, as a knowingly-accepted TASK-081 limitation, that `lanes`
and `hiiRegions` receive a **parsec** render offset and have **no context scale**, so outside
galaxy context they are drawn as if parsecs were context units. They are the only layer in the
procgen mount left in that state: the cloud got `setContextScale` in TASK-081, and the impostor
draws nothing at all (`galaxy-impostor-scale-is-inert.md`).

That matches the observation exactly — one layer correct, one layer wildly wrong, in the one
context where the two conventions diverge. **Not isolated by ablation** (no toggle exists to
disable the nebula layer alone), so this is stated as strongly indicated, not proven.

## Why the earlier measurement missed it

`galaxy-impostor-scale-is-inert.md` measured the **impostor's share of the galaxy's
brightness** at this vantage and found it owes 0% on any canvas ≥ 900 px — concluding the
universe view was fine at the landing spot. That conclusion was correct about the impostor and
**wrong about the view**, because it measured one layer of four and never asked what the rest
drew. The nebula defect was identified in the same session and explicitly filed as
"expected, not yours to fix" — its *visual magnitude* was never measured.

The lesson is narrow and worth keeping: a per-layer brightness ratio is not a claim about the
frame. Only looking at the frame is.

## Consequence for TASK-080

The mechanism TASK-080 ships works end to end — measured, repeatedly:

| step | result |
| --- | --- |
| boot | `galaxy`, 0.06 pc, ruler `starfield` |
| click `◂ Universe` | `universe`, **0.18 Mpc** exactly, ruler `universe`, 0 errors |
| click `◂ Milky Way` | lands 0.061 Mpc, **stays `universe`** — the dead-band arithmetic the spec's Goal predicted, confirmed live |
| click `◂ Galaxy` | `galaxy`, 0.06 pc, ruler `starfield`, star field renders normally, 0 errors |

But the affordance points at an unusable view. This revives the original TASK-080 Decision 2
concern — "do not ship a visible affordance onto a broken view" — which reached the **right
conclusion from the wrong evidence** (it blamed a 1e6× oversized impostor that in fact draws
nothing).

**Recommended ordering, corrected:** fix the nebula context scale before TASK-080's affordance
becomes user-visible. It is the same one-uniform change TASK-081 made to the point renderers
and TASK-082 specifies for the impostor, applied to `dust-lanes` — the follow-up already filed
in TASK-082's Out of scope. TASK-080's controller lift and unit tests are sound and can stand;
it is the breadcrumb button that should not ship alone.

## Related

- `docs/research/galaxy-impostor-scale-is-inert.md` — the impostor half, and the measurement
  whose scope was too narrow
- `docs/research/star-sprite-goes-dark-on-system-entry.md` — TASK-081, where this bug class
  was found
- `apps/web/src/scene/GalaxyScene.tsx:274-278` — the accepted limitation this cashes in
