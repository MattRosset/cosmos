# Camera-roll inversion bug, the deeper structural fix, and two unrelated CI/deploy findings

**Status:** Part 1 (narrow fix) SHIPPED in PR #1 (`fix/nav-antipodal-orientation-roll`,
commit `99a8b65`, not yet merged — CI was already broken on `main` before this PR, see
Part 3). Part 2 (structural fix) is **designed but not implemented** — this doc is the
handoff so a fresh session can pick it up without re-deriving the investigation.

---

## Part 1 — The original bug (FIXED, narrow case)

**Symptom:** mouse-look controls feel inverted after visiting a solar system (enter →
back away → exit).

**Root cause (confirmed empirically):** `packages/nav/src/controller.ts`'s `goTo`
orientation slerp and its cinematic twin (`slewLookToward`) rotate the camera toward a
target *facing* direction using a minimal-rotation-by-cross-product. When the current
forward is *exactly* antipodal to the target (`dot ≈ -1`), the cross product is
degenerate and the code fell back to a **fixed world-X axis** — a rotation with no
relation to the camera's actual orientation, which can flip its local "up" vector
(verified: up went from `[0,1,0]` to `≈[0,-1,0]`).

**Fix shipped:** use the camera's own local up axis (always ⟂ forward by construction,
never degenerate) as the 180° turn-around axis instead of world-X, in both `goTo`
(`controller.ts:585-590`) and `slewLookToward` (`controller.ts:954-958`). See commit
`99a8b65` for the full diff and the empirical verification (post-fix, the resulting
quaternion was a pure rotation about world Y, local up exactly `[0,1,0]`).

**This fix is correct but narrow** — it only patches the exact `dot ≈ -1` edge case.

---

## Part 2 — The real, broader bug (DESIGNED, not yet implemented)

### Re-reproduction that broke the narrow fix's assumption

Live-tested with the user driving the shared preview directly. Repro: enter system,
Shift+W (boost forward) while looking around with the mouse (including up/down), exit
to galaxy, re-enter. Result: orientation came out badly twisted — **not** the antipodal
case (forward dot with original facing was `0.96`, nowhere near `-1`).

### Root cause, isolated cleanly

The correct "no roll" invariant for an FPS-style camera is **not** "up stays
`[0,1,0]`" (that only holds with zero pitch) — it's **"the local right vector stays
horizontal" (`right.y ≈ 0`)**, which is what `applyLook` (the manual mouse-look
function) already guarantees by construction: it composes a world-Y yaw with a
local-right pitch, which provably keeps `right.y` at machine epsilon for any yaw/pitch
combination.

Two clean, isolated measurements (reload → enter system → controlled drag → exit →
read quaternion via a temporary `orientation` expose on `window.__cosmos`, removed
after):

| Drag before exit | `right.y` after exit | Roll? |
|---|---|---|
| Pure horizontal (yaw only, no pitch) | `≈ 0` (exact) | No — cross product of two horizontal vectors is naturally vertical |
| Horizontal + vertical (yaw **and** pitch) | **`-0.851`** | Yes — massive roll |

**Mechanism:** `goTo`/cinematic reorientation rotates by the minimal angle around
`forward × targetDir`. When both vectors are horizontal (no pitch), that cross product
is automatically the vertical axis → no roll, by coincidence. As soon as the camera has
**any pitch** (forward has a Y component) and the target direction doesn't share that
exact pitch, the cross-product axis tilts away from vertical, and the resulting
rotation introduces roll proportional to how much pitch was present. This is *not* the
narrow antipodal case — it fires on **any** non-trivial reorientation while pitched,
which is normal exploration behavior (looking up/down at planets).

The Part 1 fix does not touch this path at all (it only patches the degenerate
`dot < -1+1e-10` branch); this is a separate, broader manifestation of the same
underlying design flaw.

### Structural fix (agreed with user, not yet implemented)

**Decision:** don't just patch more call sites with "remember to decompose into
yaw+pitch" — change the **internal state representation** so roll is not
representable at all. Confirmed safe to do (see "Why this is safe" below).

**Design:**

1. Replace the controller's primary mutable orientation state with two scalars:
   `let yaw = 0; let pitch = 0;` (radians). The existing `orientation` quaternion array
   becomes a **derived cache**, recomputed by a new `syncOrientationFromYawPitch()`
   helper:
   ```ts
   function syncOrientationFromYawPitch(): void {
     quatFromAxisAngle([0, 1, 0], yaw, qYawScratch);
     quatFromAxisAngle([1, 0, 0], pitch, qPitchScratch);
     quatMultiply(qYawScratch, qPitchScratch, orientation); // orientation = Ry(yaw) ⊗ Rx(pitch)
   }
   ```
   This composition is the closed form of what `applyLook` already does incrementally
   (verified by hand: `forward = Ry(yaw)·Rx(pitch)·(0,0,-1)` matches the standard FPS
   yaw/pitch formula, and `right = Ry(yaw)·Rx(pitch)·(1,0,0) = (cos(yaw), 0, -sin(yaw))`
   — **`right.y` is structurally zero for any yaw/pitch**, not just by luck).

2. **`applyLook`** becomes trivial — no more incremental quaternion math, no more
   `clampedPitchAngle` "rotate then check" dance:
   ```ts
   function applyLook(deltaX: number, deltaY: number): void {
     if (deltaX !== 0) yaw -= deltaX * LOOK_SENSITIVITY;
     if (deltaY !== 0) pitch = clamp(pitch - deltaY * LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
     syncOrientationFromYawPitch();
   }
   ```
   Bonus: this also retires the documented gimbal edge case in the old
   `clampedPitchAngle` comment ("once the camera rotates past the pole... yaw flips
   ~180°") — with a plain scalar clamp, there is no pole-crossing to mishandle.

3. **`goTo`'s orientation slerp** and **`slewLookToward`** (cinematic) both replace
   their cross-product/axis-angle slerp with: decompose the target direction into
   `(targetYaw, targetPitch)` via a new helper (`atan2`/`asin` on the direction
   vector — exact inverse of step 1's forward formula), then blend the **scalars**
   toward the target using the same exponential-approach law already in place
   (`alpha = 1 - exp(-dtMs/T)`), with yaw blended via shortest-path wrapping
   (`wrapAngleDiff` into `[-π, π]` before scaling by alpha) since yaw is circular:
   ```ts
   const { yaw: targetYaw, pitch: targetPitch } = yawPitchFromDir(tDirX, tDirY, tDirZ);
   yaw += wrapAngleDiff(targetYaw - yaw) * alpha;
   pitch = clamp(pitch + (targetPitch - pitch) * alpha, -MAX_PITCH, MAX_PITCH);
   syncOrientationFromYawPitch();
   ```
   This **eliminates the entire degenerate-antipodal branch** from Part 1 — there is no
   more "cross product is near-zero, pick a fallback axis" case, because yaw is a
   single scalar and a 180° turn is just `wrapAngleDiff` returning `±π`, always
   well-defined. Part 1's fix becomes dead code and should be deleted as part of this
   change (do not keep both).

4. At construction (`createFlightController`), decompose the caller-supplied initial
   quaternion (`opts.initial.orientation`) into `(yaw, pitch)` once via the same
   `yawPitchFromDir` helper (applied to the quaternion's forward vector), then call
   `syncOrientationFromYawPitch()` to produce the canonical roll-free starting
   quaternion. See "Why this is safe" for why dropping any incoming roll is fine.

5. Dead code to remove as part of this change: `clampedPitchAngle`, `UP_LOCAL`
   (Part 1's fix becomes unnecessary), `gotoAxisScratch`/`gotoQDeltaScratch`/
   `gotoQTempScratch`/`cineAxisScratch`/`cineQDeltaScratch`/`cineQTempScratch` (replaced
   by plain scalar math — confirm via grep that nothing else uses them before
   deleting), `axisScratch`/`deltaQuatScratch`/`quatScratch` if `applyLook` was their
   only user (check `rotateVecByQuat`/`clampedPitchAngle` usage first).

### Why this is safe (checked before committing to the design)

Audited every place that could plausibly need roll, to make sure "roll is never
representable" doesn't quietly break a real feature:

- **`CameraSpline`** (`packages/core-types/src/cinematic.ts`): keyframes are
  `{ at: UniversePosition, lookAt: UniversePosition, timeMs }` — **no orientation/roll
  field in the data contract at all**. Playback is always look-at driven through
  `slewLookToward`.
- **`orbitBody`**: center + radius + rate — also always look-at driven, no roll input.
- **Bookmarks** (`packages/core-types/src/bookmarks.ts`) store a snapshot quaternion of
  `state.orientation`. Once this fix ships, that snapshot is always roll-free by
  construction, so round-tripping through save/restore is lossless. Restoring an
  *old* bookmark saved before this fix (which could have accidental roll baked in from
  the bug) will silently roll-correct it on load — a desirable side effect, not a
  regression.
- Confirmed via `grep` that **only** `packages/nav/src/controller.ts` ever mutates a
  camera orientation quaternion anywhere in the repo (`useFlightController.tsx` only
  *reads* `controller.state.orientation` to copy into the three.js camera — never
  mutates). So this refactor has exactly one file to change.

### Implementation status

**Not started.** This doc is the full design; a fresh session can implement directly
from "Design" above. Suggested order: write `yawPitchFromDir`/`wrapAngleDiff` as pure
helpers (easy to unit test in isolation), then thread them through `applyLook` → `goTo`
slerp → `slewLookToward`, then delete the now-dead Part 1 code, then re-run the same
live-preview verification protocol used for Part 1 (drag-only / drag+pitch / repeated
enter-exit cycles, reading `right.y` via a temporary `window.__cosmos.orientation`
expose in `apps/web/src/glue/test-hook.ts` — remember to revert that expose when done,
see Part 1's commit for the pattern). `packages/nav/test/controller.test.ts` has 67
existing tests; add new ones for the yaw/pitch helpers and a regression test
reproducing this doc's `right.y` measurement.

---

## Part 3 — Two unrelated findings surfaced while triaging PR #1's CI (not fixed, just diagnosed)

These came up because the user asked "CI is probably going to fail, it was already
broken, want to fix it?" while reviewing PR #1. Investigated, **intentionally not
fixed** (out of scope for the nav bug, user said to research-and-document only and
revisit later).

### 3a. `e2e` CI gate broken on `main` since 2026-06-27 (two compounding regressions)

> **CORRECTION (see `docs/research/procgen-lod-near-sol.md`):** the mechanism below
> misattributes the 1M near-Sol points to the Gaia push-down (BUG-8). Empirically
> decomposed, the 1,004,802 scene points are the **procgen Milky Way cloud at full 1M**
> (procgen has no LOD; `GAL_FADE_LO_PC` lowered 18000→1500 by the procgen-floor fix keeps
> it lit through the `toSol` band). The committed Gaia pack is the 135-star sample and
> contributes ~135 pts, not 1M. The push-down/no-decimation issue is real but **latent**
> (only bites once the dense Gaia pack is wired) — see the new doc §6. Keep the rest of
> 3a for the bisect history; trust the new doc for the cause + fix.

Confirmed via `gh run list`/`gh run view` history: CI was green through commit
`269803f9` (2026-06-27 00:06), then started failing at the very next commit and has
failed on every commit since.

The specific failing assertion: `e2e/tests/flythrough4.spec.ts:154` ("near-Sol budgets
drop vs M3 baseline") — `nearSolScenePoints` must be `≤ 109,971` (the old M3-tier
monolith baseline). Progression of the measured value across commits:

| Commit | `nearSolScenePoints` | vs budget |
|---|---|---|
| `269803f9` (last green) | ≤ 109,971 | ✅ |
| `1073dbfa` "keep Gaia octree visible during goTo flights" | 204,802 | ~2x over |
| `b205215` (BUG-8 push-down fix) onward | 1,004,802 | ~10x over |

- **`1073dbfa`** removed a render-loop guard that hid already-mounted Gaia octree tiles
  during `goToActive` flights. The commit message explicitly claimed this "does not
  affect the flythrough4 §5.4 budget gate: that probe... never sets goToActive" — that
  claim is contradicted by the measured ~2x jump.
- **`b205215`** (BUG-8 fix, `docs/research/bug-8-combine-drops-source.md`) was a
  correct, well-tested fix for a real bug (the shallower catalog source silently
  dropping to zero near Sol). But it conserves **every** point of the shallow source
  pushed into the cut cell, instead of a decimated representative — near Sol this
  results in near-full-resolution Gaia rendering (`scenePts ≈ streamPts ≈ 1,004,231`,
  basically the entire near-field catalog), a further ~5x jump on top of (1073dbfa)'s
  regression.
- The test's own code comment states the *expected* correct M4a value at this
  checkpoint is `572` scene points (a clean cull, `m3 toSol 109,971 → m4a toSol 572`)
  — so the real gap between "should be" and "is" is much larger than the raw numbers
  above suggest; there's no LOD/decimation currently applied to the near-Sol streamed
  cut at all.
- A second, apparently unrelated chromium-only flake: `e2e/tests/m4a.spec.ts:143`
  times out (60s) waiting for `atmosphereMounted === true` at high quality tier — not
  investigated further.

**Where to pick this up:** the bug is in the streaming/octree LOD-vs-distance policy
(`packages/streaming`), specifically whatever should decimate the combined-catalog cut
near Sol after BUG-8's push-down conserves full point counts. Not investigated beyond
identifying the two responsible commits and the magnitude.

### 3b. The repo's own `Deploy` GitHub Actions workflow has been a no-op since setup

Unprompted side-finding while checking PR CI status, in response to the user's "is
Cloudflare not showing the latest Gaia data?" question.

`.github/workflows/deploy.yml`'s `deploy` job gates on `if: vars.CLOUDFLARE_ACCOUNT_ID
!= ''` (GitHub Actions **repository variable** namespace), but only
`secrets.CLOUDFLARE_ACCOUNT_ID` / `secrets.CLOUDFLARE_API_TOKEN` (the **secrets**
namespace — a different store) were ever created (`gh secret list` shows both,
created 2026-06-12; `gh variable list` returns nothing). Variables and secrets are
separate namespaces in GitHub Actions; the workflow's own comment
("secrets context is not available in job-level if; gate on the var instead") shows the
intent was to mirror the secret into a variable, but that mirroring step was never
done. Result: the `deploy` job has **skipped on every single push to `main`**, every
time, completely independent of whether CI passes or fails (confirmed: not a
`needs:`-style dependency on the `CI` workflow at all).

This is **not** related to today's GitHub profile rename (Matikun → MattRosset,
discovered separately while pushing PR #1) — the secrets predate that by weeks.

What's actually serving the live `cosmos.pages.dev` site is very likely Cloudflare's
own native Git integration (a separate GitHub App connection, visible as the
independent "Cloudflare Pages" check in PR status checks — distinct from this repo's
`deploy` Actions job, which shows "skipped"). Whether that native integration is
actually up to date with `main` (including Gaia-related work) was **not verified** —
the dead Actions workflow only proves *this* path is inert, not that the live site is
stale. If the live site is in fact missing recent Gaia work, the cause is more likely
something in Cloudflare's own build config/branch tracking, not this dead workflow.

**To fix 3b** (cheap, mechanical, whenever picked up): create the repo variable
`CLOUDFLARE_ACCOUNT_ID` (`gh variable set CLOUDFLARE_ACCOUNT_ID --body "<value>"`,
same value as the existing secret) so the `if:` gate passes, then verify a push to
`main` actually deploys via Actions.
