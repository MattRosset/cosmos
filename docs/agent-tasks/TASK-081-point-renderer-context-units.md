# Task: Honor the parsec contract in the point renderers (fix the star field outside galaxy context)

**ID:** TASK-081
**Target package:** `packages/render-stars`, `packages/render-galaxy` (+ 4 call sites in `apps/web`)
**Size:** M
**Phase:** Maintenance track — scale-transition lane
**Depends on:** nothing open.

## Goal

The star field renders in the **right place** with the **right brightness** in every scale
context, not only in `galaxy`. Today, entering the solar system extinguishes the star you
flew to — measured: luma 255 → 3 and blob 8 px → 0 px in a single frame, with point count
and coverage unchanged (`docs/research/star-sprite-goes-dark-on-system-entry.md`). The
cause is a unit mismatch, and it is a **contract violation, not a design gap**:
`setRenderOffset` documents its argument as *"galaxy units"* (parsecs) while all four call
sites pass **active-context** units.

**Scope limit, stated in the Goal because it is load-bearing:** this task fixes stars that
fall **inside the existing camera far plane**. The clip planes are set once for the app's
lifetime in projection space (F7), so after this fix a `system`-context star beyond roughly
5 pc is clipped away. That is a *separate*, pre-existing limitation which this task
**measures and reports** but does not fix — see Deliverable 6. Do not silently widen the
task to touch the clip planes: they are shared with the planet meshes, which write depth.

When this lands, the star behind the solar system is still lit and still where it belongs.
It does **not** yet look like the reference (a small core with a growing halo) — the
size-vs-brightness convention is a later, separate task (not yet written; the reference
behavior is described in `docs/research/star-sprite-goes-dark-on-system-entry.md`
§Consequences 2). This task is the bug fix underneath it.

**Hard requirement: bit-identical rendering in `galaxy` context.** Every scale factor this
task introduces is exactly `1.0` there, so no existing gate, baseline, or screenshot moves.

## Step 0 — facts to re-verify before editing (verified 2026-07-25 on `main` @ `e8bd2f7`)

**If any is false, STOP and report** — do not adapt around it.

- **F1 — the contract says parsecs.** `packages/render-stars/src/star-points.ts:19-23`:
  *"Per frame: the batch origin's camera-relative position in galaxy units."*
  `RECHECK: sed -n '16,32p' packages/render-stars/src/star-points.ts`
- **F2 — the position attribute is parsecs, bound zero-copy.** `star-points.ts:38` binds
  `batch.positionsPc` directly as `position` (no copy — a deliberate optimization; do not
  break it by rewriting the buffer).
  `RECHECK: grep -n "positionsPc" packages/render-stars/src/star-points.ts`
- **F3 — every call site passes CONTEXT units instead.** `toRenderSpace` returns
  current-context units by contract (`packages/coords/src/origin.ts` header). Call sites:
  `apps/web/src/scene/StarScene.tsx:172` (hyg) and `:173` (exo);
  `apps/web/src/scene/GalaxyScene.tsx:545` (`origin.toRenderSpace(posScratch, offScratch)`,
  fed to every mount's `applyFrame(offset, …)` → `:192` octree points, `:262` procgen cloud).
  `RECHECK: grep -n "setRenderOffset" apps/web/src/scene/StarScene.tsx apps/web/src/scene/GalaxyScene.tsx`
- **F4 — the magnitude law reads the same wrong quantity.** Both point shaders compute
  `dPc = length(viewPos)` and apply the PARSEC distance modulus
  `m = aAbsMag + 5*(log10(dPc) - 1)`:
  `packages/render-stars/src/shaders/stars.vert.glsl.ts:47-57`,
  `packages/render-galaxy/src/shaders/galaxy.vert.glsl.ts:22-26`.
  `RECHECK: sed -n '20,30p' packages/render-galaxy/src/shaders/galaxy.vert.glsl.ts`
- **F5 — FIVE `createStarPoints` sites; four are production, one is a probe.**
  Production: `StarScene.tsx:108` (hyg), `:118` (exo), `GalaxyScene.tsx:178` (octree tiles);
  plus `createGalaxyPoints` at `GalaxyScene.tsx:218` (procgen cloud). The fifth,
  `ShaderJitterProbe.tsx:105`, is the `?debug=shaderjitter` harness: it pins its own
  `OriginManager` to galaxy context, so `pcToUnits` is 1 there. **Leave it untouched** — it
  relies on the `uPcToUnits` default of `1.0`.
  `RECHECK: grep -rn "createStarPoints\|createGalaxyPoints" apps/web/src`  # expect 5 + 1
- **F7 — the camera clip planes are set ONCE, in projection space (= context units).**
  `apps/web/src/scene/StarScene.tsx:28-29` (`CAMERA_NEAR_PC = 1e-6`, `CAMERA_FAR_PC = 1e6`)
  and `:137-138`, in an effect whose dep array is `[camera]` — never re-derived per context.
  Their names say "PC" but they clip in the ACTIVE context's units. Consequence after this
  fix: in `system` context the field projects at `× 206265`, so a star beyond ~4.85 pc lands
  past `far` and is clipped. **Sol itself survives** (0.0242 pc → ~5e3 AU), which is exactly
  why the acceptance run must not stop at "the star is lit again" (see Deliverable 6).
  `RECHECK: grep -n "CAMERA_NEAR_PC\|CAMERA_FAR_PC\|camera.far" apps/web/src/scene/StarScene.tsx`
- **F6 — the fast-math guard is load-bearing and must survive untouched.**
  `stars.vert.glsl.ts:17-27` + `:47` (`* uGuardOne`, `invariant gl_Position`); a test
  string-asserts it (`packages/render-stars/test/star-points.test.ts`). Removing or
  reordering it reintroduces Metal/mobile jitter that CI cannot catch (TASK-077).
  `RECHECK: grep -n "uGuardOne" packages/render-stars/src/shaders/stars.vert.glsl.ts packages/render-stars/test/star-points.test.ts`

## Frozen Interface

```ts
// Unchanged: CONTEXT_UNIT_METERS, REBASE_THRESHOLD_UNITS (packages/core-types/src/coords.ts)
// Unchanged: OriginManager.toRenderSpace semantics — it keeps returning CONTEXT units.
//            This task adapts the CALLERS, it does not change coords.
// Unchanged: the uGuardOne / invariant gl_Position guard and its evaluation order.
```

New surface (freeze as written — identical shape on both renderers):

```ts
/**
 * Scale from PARSECS to active-context units, i.e.
 *   CONTEXT_UNIT_METERS.galaxy / CONTEXT_UNIT_METERS[ctx]
 * Exactly 1.0 in galaxy context. Positions and the render offset are both parsecs
 * (the documented contract); this converts the result into render space for the
 * projection. Call it whenever the context changes — cheap, a single uniform write.
 */
setContextScale(pcToUnits: number): void;
```

## Deliverables

### 1. `packages/render-stars` — shader + one uniform

**RENAME NOTHING.** Two existing tests string-assert these exact lines
(`packages/render-stars/test/star-points.test.ts:81`,
`packages/render-galaxy/test/galaxy-points.test.ts:84`); renaming `viewPos` turns
`pnpm verify` red and corners the executor between a red gate and editing an assertion.
Change **only** the `gl_Position` line:

```glsl
uniform float uPcToUnits;   // NEW; exactly 1.0 in galaxy context
...
  vec3 rel = (position + uRenderOffsetHi) * uGuardOne + uRenderOffsetLo;  // UNCHANGED
  vec3 viewPos = mat3(viewMatrix) * rel;                                  // UNCHANGED (now truly parsecs)
  float dPc = max(length(viewPos), 0.001);                                // UNCHANGED expression
  // ... magnitude + size law unchanged ...
  gl_Position = projectionMatrix * vec4(viewPos * uPcToUnits, 1.0);        // ONLY changed line
```

`star-points.ts`: add `uPcToUnits: { value: 1.0 }` and `setContextScale`. Nothing else.

**Why this shape** (record this, and only this, in the file's header comment): `dPc` is
unchanged *as an expression*; what changes is its **input** — callers now feed a parsec
offset, so `dPc` becomes a true parsec distance and the distance modulus is correct in
every context. In galaxy context the offset is bit-identical and `uPcToUnits` is exactly
`1.0`, so `gl_Position` is unchanged bit-for-bit (multiplying by 1.0 is exact in IEEE-754).

### 2. `packages/render-galaxy` — the same edit, simpler (no hi/lo split)

Same rule: **rename nothing, split nothing**, change only the `gl_Position` line.

```glsl
uniform float uPcToUnits;   // NEW; exactly 1.0 in galaxy context
...
  vec3 viewPos = mat3(viewMatrix) * (position + uRenderOffset);   // UNCHANGED (asserted verbatim)
  vRadiusPc = length(position.xy);                                 // UNCHANGED (reads position directly)
  vPhi = atan(position.y, position.x);                             // UNCHANGED
  float dPc = max(length(viewPos), 0.001);                         // UNCHANGED expression
  // ... size law unchanged ...
  gl_Position = projectionMatrix * vec4(viewPos * uPcToUnits, 1.0); // ONLY changed line
```

`galaxy-points.ts`: add the uniform + `setContextScale`.

Verified safe by review: `vRadiusPc`/`vPhi` read `position` directly (always parsecs), and
the fragment shader's `POP_TINT_LO_PC`/`HI_PC` + dust-lane thresholds consume `vRadiusPc`,
so none of them changes unit. `vApparentMag`/`vSizeDim` are dimensionless.

### 3. `apps/web` — make the four call sites honor the contract

**CREATE `apps/web/src/glue/context-scale.ts`** (exact path — the repo's precedent is
co-located glue + test, e.g. `glue/procgen-draw-budget.ts` + `.test.ts`):

```ts
/** Context units → parsecs, and its reciprocal. Exactly 1 in galaxy context. */
export function pcScales(ctx: ContextId): { unitsToPc: number; pcToUnits: number } {
  if (ctx === 'galaxy') return { unitsToPc: 1, pcToUnits: 1 };   // EXACT, not computed
  const r = CONTEXT_UNIT_METERS[ctx] / CONTEXT_UNIT_METERS.galaxy;
  return { unitsToPc: r, pcToUnits: 1 / r };
}
```

The `ctx === 'galaxy'` early return is **required**, not an optimization: it guarantees the
exact `1.0` the bit-identical requirement depends on.

**Write the uniform EVERY FRAME, never "on context change".** The renderers are created
dynamically — octree/procgen mounts per streaming tile, `exoPoints` lazily on `exoBatch` —
so any instance constructed after the last context change would keep the `1.0` default and
render wrong. It is one float per frame, allocation-free.

- `StarScene.tsx:172-173`: in the same `useFrameContext` block, scale the offset by
  `unitsToPc` **in place** on `renderOffsetScratch`, and call `setContextScale(pcToUnits)`
  on both `hygPoints` and `exoPoints`.
- `GalaxyScene`: the `Mount` interface (`:158-169`) does not expose its renderers — they are
  closure-private. **Add `pcToUnits` as a parameter of `applyFrame`** and have each mount
  forward it to its own renderer(s). Convert `offScratch` in place at the single
  `toRenderSpace` site (`:545`), not per mount.

### 4. Unit test — `apps/web/src/glue/context-scale.test.ts`

Co-located with the helper (a `packages/*` test cannot import from `apps/web`). Pure, no GPU:

- `pcScales('galaxy')` returns **exactly** `1` for both fields — `toBe(1)`, never `toBeCloseTo`.
  This assertion IS the bit-identical proof; treat it as the gate.
- `unitsToPc` for the other three contexts, to a relative tolerance:
  `system` ≈ **4.8481e-6** (= 1.495978707e11 / 3.0857e16 — cross-check `ShaderJitterProbe.tsx:32`
  `AU_PC = 4.84813681e-6`), `universe` = **1e6**, `planet` = 1e3 / 3.0857e16.
- `pcToUnits` is the reciprocal of `unitsToPc` for each.
- The `uPcToUnits` uniform defaults to `1.0`, so an un-wired renderer keeps today's behavior.

Additionally, extend the existing frozen-text asserts (do not modify them): add one asserting
the hi/lo line `vec3 rel = (position + uRenderOffsetHi) * uGuardOne + uRenderOffsetLo;` is
present character-for-character, and one asserting `* uPcToUnits` appears **only** on the
`gl_Position` line.

### 5. NOTES + docs

- `docs/agent-tasks/NOTES-<date>-task-081.md` — log judgment calls as you make them.
- Append to `docs/research/star-sprite-goes-dark-on-system-entry.md` a short "Fixed by
  TASK-081" note with the re-measured numbers (see Verification below). Do not rewrite the
  claims — they are the historical record of what was true.
- Add the TASK-081 row to `docs/agent-tasks/README.md`.

## Out of scope

- **The size-vs-brightness convention (TASK-082).** After this fix the Sun at ~1 AU is
  still a 64 px clamped blob over a ~1.6 px disc. That is the *next* task and the reference
  behavior is documented (small core, growing halo, hand-off where the two agree). Do not
  start it here.
- **The progressive fade-in of system content** (orbits appearing gradually instead of the
  whole SystemScene mounting at the boundary). Separate, later.
- **`dust-lanes`, `hii`, and the galaxy `impostor`.** They share the single converted
  offset from `GalaxyScene.tsx:545`, so this diff **unavoidably changes their input outside
  galaxy context** — from (pc positions + context-unit offset) to (pc positions + pc
  offset), still projected as if it were context units. That is a *different* wrongness,
  not a fix, and it is **accepted and intended**: in galaxy context it is a no-op, so the
  bit-identical requirement survives. **Do not add `uPcToUnits` to their shaders and do not
  re-scale the impostor here** — that is TASK-082.
- **The pick path**, which carries the identical bug and was found during review:
  `StarScene.tsx:219-220` passes `controller.state.position.local` (context units) into the
  pick, which at `:318-322` subtracts `batch.originPc` (parsecs) before calling `pickStar`
  (`packages/render-stars/src/pick.ts:12` documents "TILE-LOCAL parsecs"). Write it to
  `docs/research/` and open a task; do not fix it in this diff.
- **The camera clip planes** (F7). Report the measured clip radius (Deliverable 6); do not
  change `CAMERA_NEAR_PC`/`CAMERA_FAR_PC`. They are shared with the planet meshes, which
  write depth, so moving them is a depth-precision decision, not a mechanical edit.
- `packages/coords`, `packages/core-types`, the switch policies and thresholds.

> Findings during this task go to `docs/research/`; scope creep goes to a new task file,
> not into this diff.

## Failure modes (all of these already bit this repo)

- **Touching the hi/lo sum or the guard.** `(position + uRenderOffsetHi) * uGuardOne +
  uRenderOffsetLo` must stay character-for-character in that order (F6). The jitter it
  prevents is invisible on this CI (ANGLE→D3D11) and appears only on Metal/mobile —
  TASK-077, `docs/research/jitter-apple-mobile.md`.
- **Computing the galaxy factor instead of returning exact 1.** `3.0857e16 / 3.0857e16` is
  1.0 today, but any refactor through a ratio of ratios can land on `0.9999999999999999`,
  and then "bit-identical in galaxy" quietly becomes false and baselines drift.
- **Converting inside each mount.** `GalaxyScene` has ONE `toRenderSpace` call feeding all
  mounts (`:545`); convert there. Converting per mount multiplies the work per frame and
  invites two mounts disagreeing.
- **Allocating in the frame path.** Scale `offScratch` in place; the streaming/render path
  is asserted allocation-free (`UPDATE_SCRATCH` conventions, §5.8).
- **Assuming the fix makes the star look right.** It makes it *lit and correctly placed*.
  If the reviewer expects the reference look, that is TASK-082 — say so rather than
  widening this diff.

## Acceptance gate

1. `pnpm verify` exits 0 — including the new `context-scale.test.ts` and **all** existing
   frozen-text asserts, none of which may be edited.
2. `pnpm test:e2e` exits 0 on the deterministic gates. Two things are **expected to move**
   and must be reported rather than forced green:
   - `e2e/tests/ctxswitch.spec.ts:120-140` gates `enterFrameDelta` — a pixel delta on the
     galaxy→system switch frame, i.e. exactly the frame this task changes. Log the
     before/after values in NOTES. It should *shrink*; if it grows, F7's clipping is the
     first suspect.
   - The `ctxswitch-enter` and `m3-system` screenshot baselines are system-context and run
     locally (`if (!process.env['CI'])`). Re-record per `e2e/README.md` and attach
     before/after images to the PR. **No galaxy-context baseline may move** — if one does,
     the exact-`1.0` requirement was violated; stop and report.
3. **Bit-identical proof in galaxy context** — use the deterministic harness that exists,
   not a live-scene diff: run `?debug=shaderjitter` (`ShaderJitterProbe.tsx` — synthetic
   single star, galaxy-pinned origin, fixed frame count, no streaming) before and after,
   and require `window.__shaderJitterResult.maxDeviationPx` **identical to the last bit**
   with `lostFrames === 0`. Plus `pcScales('galaxy')` returning exactly `1` (Deliverable 4).
4. `git status` clean of build output; NOTES file committed.

## Verification beyond the gate (report, do not assert)

Re-run the root-cause measurement and put the numbers in the PR body:

- At the galaxy→system flip, one frame either side: **peak luma and blob width must no
  longer collapse** (was 255/8 px → 3/0 px). Geometry (`nepPx`) must stay continuous.
- Full-canvas scan just past the flip **at a fixed viewport** (the earlier run's confound):
  bright-pixel count should be comparable to the galaxy side, not ~160× lower.
- **The clip-radius measurement (F7) — mandatory, this is the anti-false-green check.**
  "Sol is lit again" is NOT sufficient evidence of success: Sol survives the far-plane clip
  while the field behind it does not. From inside the system, sweep outward and report the
  distance at which background stars stop being drawn, and compare it with
  `CAMERA_FAR_PC / pcToUnits` (predicted ≈ 4.85 pc). If they agree, the limitation is
  understood and bounded; write it to `docs/research/` for the follow-up task.
- Report what universe context looks like now (see Out of scope — a change there is
  expected, not a regression).

## Context Files

- `docs/research/star-sprite-goes-dark-on-system-entry.md` — the measurements, CLAIM 6 is
  this task's cause; the failed-test record explains why the magnitude fix alone is not it
- `packages/render-stars/src/{star-points.ts,shaders/stars.vert.glsl.ts}` — the contract + the guard
- `packages/render-galaxy/src/{galaxy-points.ts,shaders/galaxy.vert.glsl.ts}` — the twin
- `apps/web/src/scene/{StarScene.tsx,GalaxyScene.tsx}` — the four call sites
- `packages/coords/src/origin.ts` — `toRenderSpace`'s unit contract (unchanged by this task)
- `docs/research/jitter-apple-mobile.md` — why the guard is untouchable
