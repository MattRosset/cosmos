# Task: Align the screenshot-in-CI policy with the testing conventions (3 specs + e2e README)

**ID:** TASK-063
**Target package:** `e2e` ONLY
**Size:** S
**Phase:** Maintenance track (post-4a)
**Depends on:** TASK-053

## Goal

The repo currently states two contradictory screenshot policies.
`docs/testing-conventions.md` §1 rule 4 (the doctrine adopted at the TASK-041 gate):
"Screenshots and wall-clock perf are reference-machine only (`!process.env.CI`)".
`e2e/README.md`'s gate-taxonomy table: Visual `toHaveScreenshot` "Blocks CI? **yes**".
Practice is split accordingly — `m1.spec.ts` and `m2.spec.ts` guard their screenshots
off CI, while three specs still run `toHaveScreenshot` as a blocking CI assertion:
`flythrough.spec.ts` (line ~20), `ctxswitch.spec.ts` (line ~83, inside
`screenshotAfterSwitch`), and `m3.spec.ts` (line ~102, inside `screenshotAtPhase`).

The conventions doc wins (decision recorded in
`docs/research/project-state-architecture-testing-review.md` §3.2 item 2 and §5 row 6):
pixel baselines on a SwiftShader CI runner absorb a 5% diff tolerance to survive
cross-build AA drift, which makes them weak as a gate while still able to flake; the
deterministic assertions those same specs already carry (switch sequences, frame-delta
invisibility, blank-frame counts) are the real gate. This task guards the three
remaining call sites and rewrites the README rows so there is exactly one policy.

## Frozen Interface

None (no app or package code). The deterministic assertions in the three specs are
frozen — this task must not weaken or reorder them.

## Deliverables

1. **EDIT `e2e/tests/flythrough.spec.ts`** — wrap ONLY the screenshot line:

```ts
  // Visual baseline — reference-machine only (testing-conventions §1.4; TASK-063).
  // Canvas only — HUD fps/backdrop-filter vary by runner; scene pixels are the signal.
  if (!process.env['CI']) {
    await expect(page.locator('canvas')).toHaveScreenshot('flythrough-at-rest.png');
  }
```

   Keep the preceding `waitForTimeout(1_500)` UNCONDITIONAL (it is the scene-settle
   step for everything that follows, not just the screenshot).

2. **EDIT `e2e/tests/ctxswitch.spec.ts`** — in `screenshotAfterSwitch`, guard ONLY the
   `toHaveScreenshot` call. The `waitForFunction` (switch-count sync) and
   `waitForTimeout(KEYFRAME_SETTLE_MS)` MUST stay unconditional — they sequence the
   keyframe walk that the deterministic assertions depend on:

```ts
async function screenshotAfterSwitch(page: Page, n: number, name: string): Promise<void> {
  await page.waitForFunction(
    (count) => (window.__ctxSwitchLive?.switchCount ?? 0) >= count,
    n,
    { timeout: RESULT_TIMEOUT_MS },
  );
  await page.waitForTimeout(KEYFRAME_SETTLE_MS);
  // Visual backstop — reference-machine only (testing-conventions §1.4; TASK-063).
  // The frame-delta rule below is the authoritative "invisible" gate in CI.
  if (!process.env['CI']) {
    await expect(page).toHaveScreenshot(name);
  }
}
```

3. **EDIT `e2e/tests/m3.spec.ts`** — same surgical change inside `screenshotAtPhase`:
   guard only `await expect(page).toHaveScreenshot(name);` with
   `if (!process.env['CI']) { … }` plus the same two-line comment; the
   `waitForFunction` + `waitForTimeout` stay unconditional.

4. **EDIT `e2e/README.md`:**
   - Gate-taxonomy table, Visual row: change "Blocks CI? **yes**" to
     "**no** — reference-machine only (`!process.env.CI`); see testing-conventions §1.4".
   - In the "When you add a test" checklist, change the screenshot bullet to:
     "Screenshot? Shoot `page.locator('canvas')`, never `page`, and guard it with
     `if (!process.env.CI)` — visual baselines never block CI."
   - In "Updating baselines": add one sentence — "Baselines are exercised by local /
     reference-machine runs only; CI does not compare them (TASK-063)."
   - Do NOT delete the "Why wall-clock perf does not gate CI" section; append the
     word "screenshots" naturally where it explains the SwiftShader rationale if a
     small edit fits, otherwise leave it.

5. **Baselines stay committed.** Do not delete any PNG under
   `e2e/tests/__screenshots__/` (nor the m3/ctxswitch/flythrough baselines) — they
   remain the reference-machine gate and the `update-baselines` flow is unchanged.

## Inputs / Outputs

- **Input:** 3 specs with CI-blocking screenshots; contradictory README.
- **Output:** zero `toHaveScreenshot` executed when `process.env.CI` is set; one
  documented policy; all deterministic assertions untouched.

## Constraints & Forbidden Actions

- Touch ONLY the four files listed (three specs + `e2e/README.md`).
- Do NOT modify `docs/testing-conventions.md` (it is already correct and wins).
- Do NOT touch `playwright.config.ts`, `update-snapshots.yml`, any baseline PNG, any
  other spec, or any app code.
- Do NOT remove, weaken, reorder, or "simplify" any non-screenshot assertion or wait.
- Use the exact env-access spelling already used in these specs: `process.env['CI']`
  (the repo compiles with `noUncheckedIndexedAccess`; dot access may lint differently).

## Common Mistakes

- Guarding the `waitForFunction`/`waitForTimeout` along with the screenshot — that
  changes flight timing/sequencing in CI and can flake the deterministic assertions
  that follow. Guard the `expect(...).toHaveScreenshot(...)` line ONLY.
- Deleting baselines "since CI no longer uses them" — they are the reference-machine
  visual gate (testing-conventions §1.4 keeps them, on the right machine).
- Editing `m1.spec.ts`/`m2.spec.ts` — they are already correct; leave them alone.

## Acceptance Tests

The task is DONE only when all pass:

1. `pnpm test:e2e` exits 0 locally (screenshots run here — CI is unset — proving the
   guarded paths still work and baselines still match).
2. Simulated-CI run passes with zero screenshot comparisons: from `e2e/`, run the gate
   with `CI=1` set (PowerShell: `$env:CI='1'; pnpm --filter @cosmos/e2e test:gate --project=chromium; Remove-Item Env:CI`)
   and confirm the output contains no `toHaveScreenshot` comparison for
   `flythrough-at-rest.png`, `ctxswitch-enter.png`, `ctxswitch-exit.png`,
   `m3-galaxy.png`, `m3-system.png`.
3. `Select-String -Path e2e/tests/*.spec.ts -Pattern 'toHaveScreenshot'` — every hit is
   inside an `if (!process.env['CI'])` block (manual inspection of the ≤ 7 hits).
4. `pnpm verify` exits 0 (lint/typecheck over the e2e workspace).

## Context Files

- `docs/testing-conventions.md` §1 rule 4, §2 (the winning policy and its rationale)
- `e2e/tests/m1.spec.ts` lines ~150–210 (the already-correct guard pattern to imitate)
- `e2e/tests/flythrough.spec.ts`, `e2e/tests/ctxswitch.spec.ts`, `e2e/tests/m3.spec.ts`
- `e2e/README.md`
- `docs/research/project-state-architecture-testing-review.md` §3.2
