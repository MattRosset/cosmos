# E2E single-spec smoke: validating the local carve-out

_2026-07-11. The repo doctrine treats "e2e" as one CI-only thing (gate local =
`pnpm verify`; e2e/screenshots/perf → CI). This validates — empirically, not by
assertion — whether a **smoke-run of a single new/modified spec** (deterministic
correctness only, no screenshots, no perf) belongs LOCAL before the push, or whether
the CI-only rule should hold even there. Measured on the reference dev box (Windows 11,
RX 9070 XT), branch `task-066-ui-perception-literacy`._

## TL;DR

**Hypothesis confirmed, with two matza (qualifications).** A single-spec deterministic
smoke is cheap (~26 s total: 4.7 s build + 21.7 s run), leaves **zero Playwright
orphans when it runs to completion**, and closes a **~35× feedback gap** vs. the
push→CI-e2e round-trip (the e2e job alone is **835 s**). It catches the structural bug
class (selectors, roles, DOM presence, copy text, `storageState` wiring) that no amount
of `pnpm verify` can see. The machinery to do it safely **already exists**
(`test:gate` = `--grep-invert @perf`; chromium-only). The carve-out is a documentation
+ ergonomics gap, not a new capability.

The two qualifications:
1. The doctrine's own text (`docs/testing-conventions.md` §2 + checklist) **already
   tells you to run `pnpm test:e2e` locally before pushing app/e2e changes** — but that
   runs the *whole* chromium gate, not one spec. The carve-out narrows an existing rule
   to one spec; it does not overturn a "never run e2e locally" rule (no such written
   rule exists — it lived only in the agent's memory).
2. Screenshots are **not** guarded off locally — they are guarded `if (!process.env.CI)`,
   which means they *run* on a local (non-CI) machine. A smoke of a **mixed** spec (e.g.
   `m2.spec.ts`) will fire those local-only `toHaveScreenshot` calls against committed
   baselines. That's fine for a purely-deterministic new spec, but the carve-out must say
   "deterministic-only specs" explicitly, because a mixed spec's smoke is not purely
   structural.

## The five claims, re-checked

### Claim 1 — chromium runs `--use-angle=swiftshader` locally too (so a local run reproduces part of CI's timing environment). Applies to all 3 browsers?

**Confirmed for chromium; REFUTED for webkit/firefox.** In
`e2e/playwright.config.ts:67–105` the `--use-angle=swiftshader` arg is set **only** in
the `chromium` project's `launchOptions` (lines 74–78). The `webkit` and `firefox`
projects (lines 86–104) carry no such flag — they use their platform's own software GL.
`docs/testing-conventions.md` §2 already states this: "chromium runs
`--use-angle=swiftshader` in both [local and CI]." So a **chromium** local run does share
the deterministic-software-GL renderer with CI — a local smoke is not *only* structural
verification, it exercises the same rasterizer. But this is chromium-specific, and the
smoke is chromium-only anyway (`--project=chromium`), so the point is moot for the
carve-out: the smoke never touches webkit/firefox.

Caveat (unchanged doctrine): sharing the *renderer* does **not** mean sharing the
*timing*. CI's SwiftShader runs on a 2-vCPU CPU-capped runner; the local box has a real
multi-core CPU. Frame-time numbers still diverge — which is exactly why perf stays
CI-excluded/reference-only. The smoke shares determinism (same pixels within the 5 %
band), not wall-clock.

### Claim 2 — the "CPU storm" is mitigated by `workers: CI ? 1 : 2`. Does one spec with `--workers=1` avoid the storm?

**Confirmed.** `e2e/playwright.config.ts:22` caps local at 2 workers (the in-code comment
at lines 17–21 explains: the default `~half the logical cores` fans out heavy SwiftShader
WebGL scenes across every core and can lock the machine). Running **one spec** with
`--workers=1` means exactly **one** browser context and one worker process — there is no
fan-out to storm. During the measured run (below) the box stayed responsive; the only new
`chrome.exe` PIDs that appeared were the user's own Chrome churning renderer/utility
children, **not** Playwright's. The storm is a whole-suite-parallelism problem; a
single-worker single-spec run is categorically not exposed to it.

### Claim 3 — screenshots are genuinely non-reproducible local (Linux CI vs Windows dev), hence reference-only. Does a smoke without screenshots (`--grep-invert @perf`, no `--update-snapshots`) avoid that class entirely?

**Matizado (qualified) — the mechanism is subtler than "screenshots are CI-only".**
How screenshots are gated today:
- **Not** by `@perf`. `--grep-invert @perf` excludes wall-clock *perf* specs, not
  screenshots. Screenshots live inside otherwise-deterministic tests.
- They are guarded **`if (!process.env['CI'])`** (e.g. `m2.spec.ts:89–91`). Read that
  literally: the screenshot runs when `CI` is **unset** — i.e. **locally**. CI *skips*
  them; the local machine *runs* them. `e2e/README.md` §"Gate taxonomy" confirms:
  Visual = "reference-machine only (`!process.env.CI`)".
- The 5 % `maxDiffPixelRatio` (`playwright.config.ts:43–52`) absorbs the win32↔linux
  SwiftShader AA cross-build delta against a single shared baseline.

Consequence for the carve-out: a smoke of a **purely-deterministic** spec (no
`toHaveScreenshot` anywhere in it) has no screenshot to run — the class is avoided by
construction, regardless of flags. `perception-literacy.spec.ts` is exactly this: `grep`
for `toHaveScreenshot|@perf|process.env.CI` returns **zero** matches. But a smoke of a
**mixed** spec DOES execute the `!CI` screenshot locally (see Claim 3b). So `--grep-invert
@perf` + no `--update-snapshots` is necessary but **not sufficient** to guarantee "no
screenshot ran" — the sufficient condition is "the spec contains no `toHaveScreenshot`."

`--update-snapshots` is correctly avoided: without it, a screenshot that *does* run
compares against the committed baseline (README: baselines are committed to
`tests/__screenshots__/`) rather than silently rewriting it.

### Claim 3b (from "Mediciones") — does any spec mix deterministic asserts with a screenshot in the same test?

**Confirmed — yes.** `m2.spec.ts:61` — test `enter Sol: search Saturn → descend → rings
baseline` — runs a deterministic search+descend flow and then, at lines 89–91:
```ts
if (!process.env['CI']) {
  await expect(page.locator('canvas')).toHaveScreenshot('m2-saturn.png');
}
```
`m1.spec.ts` and `m3.spec.ts` have the same shape (2 screenshot/`!CI` occurrences each).
So a local smoke of `m2` will fire `m2-saturn.png` against the committed baseline. The
5 % ratio makes a false failure unlikely, but this is why the carve-out is scoped to
**deterministic-only** specs and must not be sold as "always purely structural."

Specs with **no** screenshot/perf entanglement (safe pure-smoke targets):
`perception-literacy`, `smoke`, `error-gate`, `canvas-size`, `context-loss`, `jitter`,
`m4a`, `soak3`, `boot-perf`, `flythrough4`. (grep of
`toHaveScreenshot|@perf|process.env.CI` matched only 9 files:
`breadcrumb-perf/-profile/-transition`, `flythrough`, `flythrough3`, `m1`, `m2`, `m3`,
`ctxswitch`.)

### Claim 4 — "orphan chromium on interrupt" is the cited risk. Does a run that finishes (no interrupt) leave orphans?

**REFUTED for the completed-run case.** Procedure: snapshotted the set of `chrome.exe`
PIDs immediately before the run, ran the spec to completion, snapshotted again, and
diffed. Four new `chrome.exe` PIDs appeared during the run; 5 s after teardown three
persisted. Inspecting each via `Win32_Process.CommandLine`:
```
14320 | playwright=False | "C:\Program Files\Google\Chrome\Application\chrome.exe" --type=renderer …
17672 | playwright=False | "C:\Program Files\Google\Chrome\Application\chrome.exe" --type=renderer …
26284 | playwright=False | "C:\Program Files\Google\Chrome\Application\chrome.exe" --type=utility …
```
All three are the **user's installed Chrome** (`C:\Program Files\Google\Chrome`), not
Playwright's (which launches from the `ms-playwright` cache). A direct check —
`Get-CimInstance chrome.exe | where CommandLine -match 'ms-playwright'` — returned **"No
lingering ms-playwright chrome processes — clean"**, and `Get-Process headless_shell`
found none. **A run that completes leaves zero Playwright orphans.** The orphan risk is
real only on **interrupt** (Ctrl-C mid-suite), which the memory
[[local-e2e-cpu-storm]] correctly cited — but that is a "don't kill a long parallel
suite" hazard, not a "one spec to completion" hazard. Running one fast spect to the end
sidesteps it.

### Claim 5 — cost of the loop: single-spec local vs. push→CI round-trip.

**Confirmed — the delta is the whole argument.**

| | Measured | Source |
|---|---|---|
| Web build (prereq for `vite preview`) | **4.7 s** | `time pnpm --filter @cosmos/web build` |
| `perception-literacy` spec, chromium, `--workers=1`, `--grep-invert @perf` | **21.7 s** (3 tests, all passed, exit 0) | `time npx playwright test …` |
| **Local single-spec smoke total** | **~26 s** | sum |
| CI **e2e job** (green run 28904919689) | **835 s** (~14 min) | `gh run view --json jobs` |
| CI **verify job** (e2e `needs: verify`, so serial) | **128 s** | same |
| **Push → e2e result** (verify + e2e, +checkout/install/queue) | **~16 min floor** | `ci.yml:40–42` (`needs: verify`) |
| Whole CI workflow wall | ~900–1000 s across recent green runs | `gh run list` |

Local run output (clean):
```
Running 3 tests using 1 worker
  ok 1 …perception-literacy…badge (S2) + galactic hint (D8)… (17.5s)
  ok 2 …InfoPanel human-first distance (D1 + W4)… (1.1s)
  ok 3 …first-run overlay (V1)… (1.1s)
  3 passed (20.7s)
```
**~26 s local vs. ~16 min to the same signal via CI ≈ 35×.** And a structural bug
(renamed role, missing `data-*`, broken `storageState` seed, wrong copy literal) fails
identically local and in CI — so paying the 16-minute round-trip to discover a typo'd
selector is pure waste. That is precisely the bug class a new-spec author generates most.

## What this does and does NOT change

- **Does not touch** the screenshot/perf doctrine. Screenshots stay `!process.env.CI`
  (reference-only, never a CI gate); perf stays `@perf`/reference-only. The carve-out is
  **only** for the deterministic correctness assertions of a single spec.
- **Does not** advocate running the full local suite routinely (that reintroduces the
  storm and the interrupt-orphan risk, and is redundant with CI once pushed). One spec,
  one worker, run to completion.
- **Once CI has run the spec, the local smoke is redundant** — its value is entirely in
  the pre-push window, killing the fix→push→14-min-fail→fix loop for structural bugs.

## Caveats / reproducibility

- Timings are from the reference dev box (fast multi-core CPU + discrete GPU, though the
  smoke uses SwiftShader software GL, not the GPU). A slower box or a heavier spec
  (`m3`, `soak3`, `flythrough4` boot a full scene) will run longer — but even a 3–4×
  slower spec (~90 s) is an order of magnitude under the CI round-trip. Pick the fastest
  spec that exercises the new surface.
- Orphan measurement is confounded by the user's own Chrome churning PIDs; the
  discriminator that matters is the `ms-playwright` command-line filter, which was clean.
  On a box with no other Chrome, the PID diff would show zero new processes outright.
- The 835 s e2e job includes ~10 package unit-gate steps + Lighthouse + boot-perf + the
  full 3-browser matrix, not just the chromium spec run. The single-spec smoke replaces
  only the *structural* signal for *one* spec — it is not a substitute for the CI job,
  which still owns cross-browser, the milestone gates, and the deterministic matrix.

## Recommendation (see the doctrine-text deliverable in the task response)

**Do the carve-out.** Add a one-line rule + a convenience script; scope it to
deterministic-only specs; keep screenshots/perf/full-suite CI-owned. Evidence supports
the hypothesis on every claim, with the two qualifications folded into the wording.
