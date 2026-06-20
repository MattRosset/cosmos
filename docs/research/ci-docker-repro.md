# Research: reproducing the CI runner locally with Docker

**Status:** **resolved** (tooling landed: `Dockerfile.ci`, `.dockerignore`,
`docker:ci:build`/`docker:ci:run` scripts). This doc is the handoff/reference for
*why* it exists and *how* to use it — assume the reader has no prior context.
**See also:** [`docs/research/phase4-render-tier-handoff.md`](phase4-render-tier-handoff.md)
for unrelated M3 render-tier debt.

---

## 1. Why this exists

Closing a phase repeatedly hit the same pattern: a milestone-gate CI run fails
on something that never reproduces locally, so the only way to debug it was
push → wait for CI → guess → push again. The concrete case that motivated this
tooling: the Lighthouse performance gate failed with a 0.46 score and a 44s
Time-to-Interactive (budget was `minScore: 0.85` / `maxNumericValue: 4000`) —
on this dev machine the exact same build scored 0.85 / 2.7s.

The difference: `ubuntu-latest` GitHub Actions runners are **2 vCPU / 7GB RAM,
no GPU** — nothing like a dev workstation. `Dockerfile.ci` builds an image that
matches that shape (Ubuntu 24.04, Node 22, a real `google-chrome-stable`
install, no GPU passthrough) so `docker run --cpus=2` reproduces the runner's
resource ceiling on demand, without needing to push and wait.

## 2. What we found with it (so you don't re-derive this)

Using this image, we confirmed the Lighthouse failure was **not a real app
regression**: driving the same build directly with a `PerformanceObserver`
(no Lighthouse tracing overhead) showed zero >50ms frames, even under
`--cpus=2` with no GPU. Lighthouse's own trace/audit collection was the
expensive part — it sometimes crashed the renderer tab outright
(`TARGET_CRASHED`), and its default *simulated* CPU throttling doesn't compose
with a host that's already CPU-capped (the model assumes it captured a trace
on a fast reference machine, then layers a slowdown on top — confirmed by
[Lighthouse's own throttling docs](https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md),
which warn that an underpowered host needs `cpuSlowdownMultiplier`
recalibration).

Fix: Lighthouse now runs informationally in CI (`continue-on-error: true`,
no performance assertions in `lighthouserc.json`); the real performance gate
is [`e2e/tests/boot-perf.spec.ts`](../../e2e/tests/boot-perf.spec.ts), which
asserts directly on main-thread long tasks instead of trusting Lighthouse's
model. See the `fix(ci)` commit for the full writeup.

**Second finding, same image:** a CI run later failed 9 e2e specs at once
(frame budgets blown across chromium/webkit/firefox, a Firefox WebGL2 check,
a Firefox flythrough3 timeout, and a `soak3` in-flight-oscillation assertion).
Re-running each failing spec individually in this image separated two causes:
most were CPU contention on a noisy runner (the `soak3` one too — its
in-flight count was pinned exactly at `maxInFlight: 6`, i.e. the queue never
got a chance to drain, not a logic bug). But Firefox's failures were
deterministic, not noisy: `canvas.getContext('webgl2')` *and* `'webgl'` both
returned `null`, console showing `THREE.WebGLRenderer: ... WebGL creation
failed: ... FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS`. Headless Firefox on
Linux can't glxtest without an X server, even for software-only rendering —
wrapping the command in `xvfb-run -a` fixed it (3/3 stable in this image).
Real CI's `ubuntu-latest` ships `xvfb` preinstalled, so the workflow fix was
just prefixing the e2e step with `xvfb-run -a` — no new install needed.

## 3. How to use it

```sh
pnpm run docker:ci:build      # build the image (run again after any code change —
                              # it COPYs the repo in, it does not bind-mount)
pnpm run docker:ci:run        # default: pnpm test, capped at --cpus=2

# Override the command to run anything else under the same constraint:
docker run --rm --cpus=2 cosmos-ci pnpm --filter @cosmos/e2e exec playwright test boot-perf --project=chromium
docker run --rm --cpus=2 cosmos-ci pnpm lighthouse
docker run --rm --cpus=2 cosmos-ci pnpm --filter @cosmos/streaming test
```

To approximate the runner's memory ceiling too, add `--memory=7g`. Be aware
this can make an already-heavy WebGL page crash outright rather than just run
slow (see §4) — useful for confirming a memory-driven failure, not for routine
use.

## 4. Gotchas (read before reusing this for the next investigation)

- **Never bind-mount the repo for an install.** `Dockerfile.ci` uses `COPY .
  .` + `pnpm install` *inside the image* on purpose. An earlier version of
  this investigation bind-mounted the Windows host repo into the container
  and ran `pnpm install` there — pnpm wrote Linux binaries/symlinks over the
  host's `node_modules`, breaking `tsc` and other binaries on Windows until a
  full clean reinstall. If you ever do need to mount the repo (e.g. to copy
  results back out), mount a *different* path and `cp` in/out — never the
  live `node_modules`.
- **Docker's default `/dev/shm` is 64MB.** Chrome uses shared memory heavily
  for canvas/WebGL compositing; a heavy WebGL app can hit `TARGET_CRASHED`
  from this alone, independent of CPU/GPU. The actual GitHub Actions runner
  is **not** containerized this way (jobs run directly on the VM), so a crash
  reproduced here may be a Docker-specific artifact rather than something
  that happens in real CI. If you need to rule this out, add `--shm-size=1g`
  to the `docker run` and see if the crash goes away.
- **Running the full `pnpm test` (all packages via turbo, in parallel) under
  `--cpus=2` can flake from contention** — we saw `@cosmos/ui`, `@cosmos/streaming`,
  and `@cosmos/scene-host` fail under the full parallel run, while every one
  of them passed cleanly run individually (`pnpm --filter <pkg> test`) in the
  same container. If something fails under `docker:ci:run`, re-run it scoped
  to that one package before assuming it's a real regression.
- The image's Chrome (`/usr/bin/google-chrome-stable`) is separate from
  Playwright's own bundled Chromium. `Dockerfile.ci` installs both — Playwright's
  via `playwright install --with-deps chromium` (used by `boot-perf.spec.ts`
  and the rest of the e2e suite) and the system one (used by `pnpm lighthouse`,
  which needs `--no-sandbox` when run as root in this image — the real CI
  runner executes as a non-root user and doesn't need that flag).
