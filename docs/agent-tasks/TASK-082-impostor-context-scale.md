# Task: Make the galaxy impostor render at all, at a context-invariant size

**ID:** TASK-082
**Target package:** `packages/render-galaxy` + `apps/web/src/scene/GalaxyScene.tsx`
**Size:** M *(was S; see "What changed in this spec")*
**Phase:** Maintenance track — scale-transition lane
**Depends on:** TASK-081 (**merged**, PR #28 — `pcScales` exists at `apps/web/src/glue/context-scale.ts`).
**Blocks TASK-080** (an ascent must not land on a broken view).

## What changed in this spec (2026-07-26)

The first version of this task was premised on the impostor being drawn at a physical size of
`radiusUnits` and therefore **1e6× oversized in `universe`**. That premise is false and was
never measured. `radiusUnits` reaches no pixel in any context: the shader ignores the mesh
transform, so the quad is always **one render-space unit** and is sub-pixel — invisible — at
every distance the app actually uses.

Root-cause writeup, with the pixel measurements: **`docs/research/galaxy-impostor-scale-is-inert.md`**.

Consequences for this spec: the goal is no longer "shrink an oversized sprite" but "make the
sprite exist"; the proposed `setRadiusUnits`-only interface is insufficient; the proposed unit
test would have passed without moving a pixel and is replaced; and the fed radius turned out
to be a different number than the old spec claimed.

## Goal

The Milky Way's far-LOD impostor must (a) actually draw, and (b) subtend the same **physical**
size regardless of which scale context the camera is in.

## Step 0 — facts to re-verify (all measured 2026-07-26, not read)

**If any is false, STOP and report.** Facts here are stated as *observable outcomes*, not as
"line N exists" — the previous version of this spec was falsified precisely because its facts
were phrased so that reading the file could confirm them while the behaviour was the opposite.

- **F1 — `radiusUnits` changes nothing that is drawn.** Render `createGalaxyImpostor` offscreen
  (opaque sprite, `uOpacity = 1`, `setRenderOffset([0,0,-1])`) at `radiusUnits` 1 and 15000 and
  count pixels with red > 8. Both counts are **49284** — identical. At `setRenderOffset([0,0,-1000])`
  both 15000 and 1.5e10 give **0**.
  `RECHECK:` re-run the harness of Deliverable 4 against the pre-change module.
- **F2 — the cause is that the vertex shader ignores the mesh transform.**
  `packages/render-galaxy/src/shaders/impostor.vert.glsl.ts` uses `viewMatrix`, `projectionMatrix`
  and the raw `position` attribute, and references **neither** `modelMatrix` nor `modelViewMatrix`
  — the only two paths by which `mesh.scale` (`impostor.ts:42`) can reach the GPU.
  `RECHECK: grep -c 'modelMatrix\|modelViewMatrix' packages/render-galaxy/src/shaders/impostor.vert.glsl.ts` ⇒ `0`
- **F3 — `PlaneGeometry(1,1)` positions are exactly ±0.5**, uv `0..1` (measured). So multiplying
  `position` by `K` yields a quad of half-width `K/2`.
- **F4 — the sprite's visible edge is the quad's half-width.** `createImpostorTexture()` =
  `radialSprite(256, 0.02)`; sampled alpha vs. fraction of half-width: `0→255, 0.25→198,
  0.5→132, 0.75→65, 0.99→1`; corner alpha 0. Coverage: alpha > 8 over 73.6% of the quad.
- **F5 — the fed radius is 28,002.33 pc, NOT the "≈15,000" the old spec claimed.**
  `milkyWayRadiusPc = milkyWay.radiusKpc * 1000` (`StarApp.tsx:593` + 6 sibling apps), and
  `milkyWay.radiusKpc` is a **random draw** `rng.range(5, 50)` from `generateLocalGroup({seed:1})[0]`
  (`packages/nav/src/local-group.ts:39`). Measured: **28.00232553971 kpc**.
  Meanwhile streaming's half-extent for the same galaxy is `discRadiusPc` = **15,000 pc**
  (`PROCGEN_GALAXY_DEFAULTS`, via `ensureProcgenChunk`, `policy.ts:326`). Ratio **1.867**.
- **F6 — post-TASK-081 the impostor receives a PARSEC offset**, while `viewPos` goes straight
  into `projectionMatrix` and therefore must be in ACTIVE-CONTEXT units.
  `GalaxyScene.tsx:566-568` converts `offScratch` to parsecs; `:283` hands it to
  `impostor.setRenderOffset`. Knowingly deferred to this task at `GalaxyScene.tsx:274-278`.
- **F7 — the impostor is unreachable in galaxy context, so no galaxy baseline can move.**
  `exitGalaxyAtM = 3.086e21 m` (`packages/nav/src/galaxy-switch.ts:23`) caps galaxy context at
  **100,009.7 pc**. At that edge the disc projects **187.0 px** at a 720 px viewport ⇒ `lod` 2 ⇒
  `smoothstep(2,6,lod) = 0` ⇒ impostor opacity exactly 0. The impostor could only appear in
  galaxy context below a **492.7 px** canvas height; the e2e viewport is 1280×720
  (`e2e/playwright.config.ts:25`).
- **F8 — it does draw in universe context, and owes a lot there.** `procgenBlend` is initialised
  to `1` and only recomputed `if (ctx === 'galaxy')` (`GalaxyScene.tsx:507-519`) — confirmed live:
  `__cosmos.procgenOpacity === 1` at the `soak3` universe apex. Impostor share of the galaxy's
  brightness, `smoothstep(2, 6, lod)`, at a 720 px viewport: **0.3 Mpc → 50%, 0.6 Mpc → 84%,
  1.7 Mpc → 100%**. The `flythrough3` path starts at universe `[0,0,0.6]` Mpc.
- **F9 — the correct pattern already ships one file away.** `shaders/dust.vert.glsl.ts` does
  `vec3 viewPos = camCenter + vec3(position.xy * aRadius, 0.0);` — the multiplication the
  impostor lacks. The dust/HII sprites render for exactly this reason.

## Frozen Interface

`CONTEXT_UNIT_METERS`, every switch threshold, `PROCGEN_GALAXY_DEFAULTS`, and `pcScales`'
contract are unchanged. `GalaxyImpostor`'s other methods keep their signatures.

`GalaxyImpostorOptions.radiusUnits` is **renamed and re-typed** to make the unit explicit; the
old name is not kept as an alias, because a value that silently meant "context units" is what
this task exists to remove.

```ts
export interface GalaxyImpostorOptions {
  readonly spriteTexture: THREE.Texture;
  /** Galaxy radius in PARSECS. Seeds the same uniform `setRadiusPc` writes. */
  readonly radiusPc: number;
}

export interface GalaxyImpostor {
  // … existing members unchanged …
  /** Set the impostor's radius in PARSECS. Cheap: writes one float uniform. */
  setRadiusPc(radiusPc: number): void;
  /**
   * Parsecs → active-context units, from `pcScales(ctx).pcToUnits`. Applied in the shader to
   * BOTH the render offset and the radius. Exactly `1` in galaxy context.
   * Same contract as `GalaxyPoints.setContextScale` (TASK-081).
   */
  setContextScale(pcToUnits: number): void;
}
```

## Decisions taken here (do NOT re-litigate; they are the spec)

**D1 — the shader carries the context scale, the CPU does not pre-multiply.** This mirrors
what TASK-081 shipped for `render-stars` / `galaxy-points` (`setContextScale` + a shader
multiply), so `GalaxyScene` keeps handing every procgen-mount renderer the *same* parsec
offset. Do not instead route a second, context-unit copy of the offset to the impostor: that
reintroduces two offset conventions in one function, which is the confusion this lane is
closing.

**D2 — the impostor's radius comes from `discRadiusPc` (15,000 pc), not from `milkyWayRadiusPc`.**
Per F5 the currently-fed number is a random local-group draw, unrelated to the disc being
stood in for and disagreeing 1.87× with the half-extent the LOD uses to decide *when* the
impostor appears. The sprite must agree with the LOD about how big the galaxy is. Source it
from `milkyWayResolvedParams().discRadiusPc` — the same resolved params `milkyWayArmGeometry()`
already uses in this file — so the sprite and the star cloud are generated from one number.

**D3 — the quad's half-width equals the galaxy radius**, i.e. multiply `position` by
`2 × radiusPc × pcToUnits`. Justified by F3 + F4: positions are ±0.5 and the glow's alpha
reaches 0 at the quad's half-width, so this places the sprite's visible edge exactly at the
disc radius the LOD measures. Note the pre-change `mesh.scale.set(r, r, 1)` implied half-width
`r/2`; that intent is **not** preserved, and does not need to be — it never rendered, so there
is no baseline and no user-visible behaviour to keep.

**D4 — `milkyWayRadiusPc` stays on the `GalaxyScene` props and on all 7 call sites.** It still
feeds nothing else today, but removing a prop across 7 app entry points is a mechanical change
unrelated to this defect. File the follow-up (below); do not widen this diff.

## Deliverables

1. **`packages/render-galaxy/src/shaders/impostor.vert.glsl.ts`** — add
   `uniform float uRadiusPc;` and `uniform float uContextScale;`, and apply both, following F9's
   template:

   ```glsl
   vec3 camCenter = mat3(viewMatrix) * (uRenderOffset * uContextScale);
   vec3 viewPos   = camCenter + vec3(position.xy * (2.0 * uRadiusPc * uContextScale), 0.0);
   ```

   Update the file's header comment: it currently says `uRenderOffset` holds context units. It
   holds parsecs.

2. **`packages/render-galaxy/src/impostor.ts`** — seed `uRadiusPc` from `opts.radiusPc` and
   `uContextScale` from `1`; add `setRadiusPc` and `setContextScale` writing those uniforms in
   place (no allocation, same style as `setOpacity`). **Delete** the `mesh.scale.set(...)` line
   and the comment above it ("Scale bakes the radius into world space") — both are inert and
   the comment is what made the defect survive review.

3. **`apps/web/src/scene/GalaxyScene.tsx`** — in `makeProcgenMount`:
   - construct with `radiusPc: milkyWayResolvedParams().discRadiusPc` (D2);
   - in `applyFrame`, call `impostor.setContextScale(pcToUnits)` and
     `impostor.setRadiusPc(radiusPc)` **every frame**, alongside the existing
     `cloud.setContextScale(pcToUnits)`;
   - narrow the TASK-081 comment at `:274-278` so it no longer claims the impostor is
     unfixed — `lanes` / `hiiRegions` remain out of scope and keep the caveat.

4. **Replace `packages/render-galaxy/test/impostor.test.ts`'s `shape` block.** Delete the two
   assertions on `mesh.scale` (`:23-34`): they assert a value that never reaches the GPU and
   are the reason this shipped. Add a **pixel** test — this is the deliverable that proves the
   fix, so it must fail against the pre-change module:
   - a headless-GL render harness (`WebGLRenderTarget` + `readRenderTargetPixels`, count
     `r > 8`), opaque `DataTexture` sprite, `uOpacity = 1`;
   - **T1 (proves the bug is fixed):** at a fixed offset, doubling `radiusPc` strictly
     increases the lit-pixel count. Pre-change this is `49284 === 49284` ⇒ fails.
   - **T2 (proves context invariance):** the same physical galaxy renders to the **same**
     lit-pixel count from `galaxy` and from `universe` — i.e. `setContextScale(pcScales(ctx).pcToUnits)`
     with the offset expressed in parsecs both times. Equal to within ±1 px (rasterisation),
     not a relative-1e-12 float comparison: the assertion must live in pixel space.
   - **T3:** `setContextScale(1)` (galaxy) leaves the projected geometry bit-identical to a
     build with no context scale at all — guards the exact-`1` property `pcScales` provides.

   If WebGL is unavailable in the vitest environment, **stop and report** rather than falling
   back to asserting uniform values — a uniform-value assertion is the failure mode this
   deliverable exists to end.

5. **NOTES file** with the judgment calls, per `CLAUDE.md`.

## Out of scope

- `dust-lanes` and `hii`: they take centres/radii in pc and receive a parsec offset with no
  context scale, so they are misplaced outside galaxy context (they render correctly *within*
  it — F9). **Follow-up task, note it, do not fix it here.**
- Removing the now-vestigial `milkyWayRadiusPc` prop from the 7 app entry points (D4) —
  **follow-up task.**
- The random `radiusKpc` draw feeding a body named "the Milky Way" (F5) — it no longer affects
  the impostor after D2, but it is still a questionable source for anything else that reads it.
  **Note it; do not chase it.**
- The point renderers (TASK-081, merged) and the camera clip planes.
- Deciding what *else* should be drawn at universe scale — that is TASK-080's job.

## Failure modes

- **Setting radius or scale once instead of per frame.** Mounts are created dynamically per
  streaming tile; one created after the last context change would keep the constructor's value.
  Write both every frame — two float-uniform writes, allocation-free.
- **Computing the galaxy factor instead of taking `pcScales`' exact `1`.** A ratio-of-ratios can
  land on `0.9999999999999999` and silently move galaxy-context baselines. Use the helper.
- **Keeping `mesh.scale` "just in case".** It is inert; leaving it re-arms the exact trap that
  produced this defect, and leaves two apparent sources of truth for the size.
- **Asserting uniforms instead of pixels.** See Deliverable 4. A green test that cannot fail
  against the broken module has proved nothing.
- **Assuming this makes universe context look *right*.** It makes the impostor exist at the
  right *size*. What else is or is not drawn up there is TASK-080's reporting job.

## Acceptance gate

1. `pnpm verify` exits 0, including the new pixel tests.
2. **The new T1 must be demonstrated failing against the pre-change module** (stash the shader
   + impostor changes, run, capture output) and passing after. Attach both runs to the PR.
   Without this the test is unproven.
3. `pnpm test:e2e` exits 0. `flythrough3` / `flythrough4` / `m3` / `soak3` traverse universe
   context and are the specs at risk; their deterministic assertions must hold unchanged.
   **Universe-context** screenshot baselines are expected to move — re-record and attach
   before/after. **No galaxy-context baseline may move**; per F7 this is now a real regression
   check (impostor opacity is provably 0 there at the 720 px e2e viewport), so if one moves,
   **stop and report**.
4. NOTES file committed with the judgment calls.

## Verification beyond the gate (report, do not assert)

Fly `?debug=flythrough3` and report what the Milky Way looks like from universe context before
and after — apparent size on screen, and whether it reads as a bounded object. Per F8 the
impostor owes 84% of the galaxy's brightness at the 0.6 Mpc start, so the before/after should
be pronounced; if it is not, say so, because that would mean something else is suppressing it.
Attach both frames to the PR. This is the observation TASK-080's Decision 2 depends on.

Note for the observer: the probe completes the full descent in a few seconds and ends in
`system` context at Earth. A screenshot taken after it settles is **not** the universe view.
Use `?debug=soak3`, poll `__cosmos.contextId` until it reads `universe`, then capture.

## Context Files

- `packages/render-galaxy/src/impostor.ts` — the inert scale
- `packages/render-galaxy/src/shaders/impostor.vert.glsl.ts` — where the radius must be applied
- `packages/render-galaxy/src/shaders/dust.vert.glsl.ts` — the working template (F9)
- `packages/render-galaxy/test/impostor.test.ts:23-34` — the assertions to delete
- `apps/web/src/scene/GalaxyScene.tsx:250-254, 264-285, 507-519, 562-582` — construction, the
  per-frame apply, the blend, the offset conversion
- `apps/web/src/glue/context-scale.ts` — `pcScales`, merged with TASK-081
- `apps/web/src/glue/milky-way-gen.ts` — `milkyWayResolvedParams().discRadiusPc` (D2)
- `docs/research/galaxy-impostor-scale-is-inert.md` — the measurements behind every fact above
- `docs/research/star-sprite-goes-dark-on-system-entry.md` — how this bug class was found
