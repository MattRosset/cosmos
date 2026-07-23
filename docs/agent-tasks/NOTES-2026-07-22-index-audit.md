# Open items from the 2026-07-22 task-index audit

Context: this came out of a README rewrite session and was cut short deliberately — the
scope had drifted well past the original task. Nothing here is urgent; it is written down
so it is not rediscovered from scratch.

## 1. TASK-063 cannot pass its acceptance as written (blocked, needs a task)

Acceptance #1 is `pnpm test:e2e` exits 0 locally. Run on the Windows dev box 2026-07-22:
**40 passed, 2 failed (5.4m)**. Criteria #3 (every `toHaveScreenshot` guarded — 9 hits, all
guarded) and #4 (`pnpm verify` exit 0) DO pass. The blocker is the baseline itself, not the
task's change:

- **The `m1-betelgeuse` baseline embeds a run-dependent value.** The diff shows the HUD card
  reading `"Jumped ~498 ly in 5.3 s"` — wall-clock elapsed time, different every run. The
  shot is `page.locator('canvas')`, but a Playwright element screenshot includes whatever is
  painted *over* the element, so the HUD comes along. **No baseline refresh can fix this**;
  the HUD must be hidden (or the shot clipped to the canvas region without overlays) first.
  Also violates `CLAUDE.md` testing rule 2 (no HUD geometry in assertions).
- **The baselines are stale on top of that.** `m1-betelgeuse-chromium.png` was last written
  2026-06-20 (`2d2b680`); TASK-076's flux-conserving 3px point-size floor (`bc4de7e`,
  2026-07-14) deliberately changed star rasterization. The diff's large galactic-band delta
  is consistent with that, i.e. expected change, not regression. Refresh only AFTER the HUD
  problem above is fixed, and eyeball the diff.
- **`flythrough3.spec.ts:97` ("§5.8 frame budget with zero hitch") also failed — cause not
  diagnosed.** The captured tail did not include its detail. Do not assume it is machine
  noise without looking.

Suggested split: one task for "make the visual baselines shootable" (hide HUD / clip), then
a baseline refresh, then re-run TASK-063's acceptance.

## 2. `pnpm check:tasks` is not wired into `pnpm verify` yet

`tools/check-task-index/src/check.mjs` exists and runs, but is deliberately left out of the
`verify` script: it currently exits 1 on one real inconsistency — **TASK-064 is `done` while
its blocker TASK-063 is `pending`** (see item 1). Wire it into `verify` once that resolves;
adding it while red would either break the gate or invite weakening the check.

## 3. TASK-062 acceptance #3 is worded without its own escape hatch

Acceptance #3 says each of the five `pack-*` tools must print a coverage table and exit 0,
but Deliverable 4 prescribes leaving any package under 60% unwired — which is what happened
to `pack-solar` (57.7%, recorded in that task's Notes). The deliverable governs; the
acceptance text should be amended if that task is ever revisited. Filed here because an
agent re-reading TASK-062 will hit the same contradiction I did and may "fix" the wrong side.

`pack-solar`'s real follow-up is unchanged and already recorded in TASK-062's Notes: a test
pass over `cli.ts` (0% today; `convert.ts` is at 91%) to clear the 60% floor, then wire it.

## 4. Deploy-path change (done, recorded for context)

`.github/workflows/deploy.yml` was removed 2026-07-22: 100/100 of its runs were `skipped`
(it gated on `vars.CLOUDFLARE_ACCOUNT_ID`, never set), while the live site publishes through
Cloudflare Pages' own Git integration. Anything that assumed a GitHub Actions deploy — e.g.
TASK-069's source-map upload step — belongs in the CF Pages build command instead.
