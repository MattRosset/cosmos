# TASK-104 — post-processing chain foundation — NOTES

Judgment calls + Step-0 recheck + resolved facts, logged as I go (CLAUDE.md judgment-call rule).

## Step 0 — re-verify before writing code (run 2026-09-07, executor pass)

Spec was written 2026-08-07; facts move. Each item measured against live code:

1. **No post infra exists yet — CONFIRMED.**
   - `grep EffectComposer|postprocessing|@react-three/postprocessing` over `**/src/**/*.{ts,tsx}` → **no matches** (no mounted composer).
   - `grep -c postprocessing pnpm-lock.yaml` → **0** (not installed).

2. **Tier flag present & threaded — CONFIRMED.**
   - `packages/core-types/src/quality.ts`: `bloomEnabled` = `true` for high+medium, `false` for low.
   - `packages/scene-host/src/use-quality.ts`: `useQuality(): QualitySettings` reads `QualityContext`, re-renders only on tier change.

3. **Composer vs probe manual-render — RESOLVED (owner, 2026-09-07), not re-litigated.**
   Evidence `docs/research/post-chain-probe-render-conflict.md`. Resolution = additive
   `SceneHostProps.postProcessing?: boolean` (default true); PostChain mounts only when
   `postProcessing && bloomEnabled`. Six manual-render probe apps opt out with `postProcessing={false}`.
   No gate/tier/threshold change. Verified the six apps still carry their current tiers (M3App `initialQualityTier="high"` etc.) — the opt-out flag does not touch tier.

4. **Canvas has no `frameloop` prop — CONFIRMED.** `SceneHost.tsx` Canvas passes only `gl` + `camera`
   (`SceneHost.tsx:199-203`) → default `'always'` loop.

5. **Compatible dependency version — RESOLVED CLEAN, no force/overrides/peer-war.**
   Resolved trio in this repo (lockfile-pinned): `@react-three/fiber@9.6.1`, `three@0.184.0`,
   `react@19.2.7`.
   - `@react-three/postprocessing@3.1.1` (latest) peers `@react-three/fiber: >=9.7.0` → **NOT**
     satisfied by our pinned 9.6.1. Same for 3.1.0 / 3.0.5 (fiber peer jumped to `>=9.7.0` at 3.0.5).
   - `@react-three/postprocessing@3.0.4` peers: `react ^19.0` ✓, `three >=0.156.0` ✓,
     **`@react-three/fiber ^9.0.0` ✓** (satisfied by 9.6.1). It carries `postprocessing ^6.36.6`
     as a **regular dependency**. → **CHOSEN: 3.0.4.**
   - `postprocessing ^6.36.6` resolves to **6.39.4**, whose three peer is `>=0.168.0 <0.186.0`
     → includes our 0.184.0 ✓.

   **JUDGMENT CALL (dep version):** Latest (3.1.1) would require bumping `@react-three/fiber`
   to `>=9.7.0`. Our range `^9.6.1` *allows* it, BUT the lockfile pins 9.6.1 and bumping fiber
   changes the resolved R3F across the ENTIRE monorepo (every package), a far larger blast
   radius than this task sanctions ("only apps/web lockfile changes"). Step-0 item 5 asks for
   the version that lists our exact trio as compatible peers with no force/overrides — that is
   **3.0.4**. Choosing 3.0.4 keeps the change minimal and spec-aligned; a fiber bump is a
   separate decision, out of scope here.

   Exact resolved versions after install: see "Install result" below.

## Install result (pnpm install, no --force, no overrides)

- Added 4 packages; **no unmet-peer / peer-war warnings**.
- Resolved (via `pnpm --filter @cosmos/scene-host why`):
  - `@react-three/postprocessing@3.0.4`
  - `postprocessing@6.39.4` (three peer `>=0.168.0 <0.186.0` ✓ 0.184.0)
  - transitive: `n8ao@1.10.3`, `maath` (0.10.8 / 0.6.0), all against `three@0.184.0`.
- `packages/scene-host/package.json` deps added: `@react-three/postprocessing: 3.0.4`,
  `postprocessing: ^6.39.1` (explicit so `ToneMappingMode` imports directly in the pnpm monorepo).

## Step-0 item-3 recheck — composer effective `useFrame` renderPriority (rule 2, from CLAIM 3)

Measured from the installed lib (`@react-three/postprocessing@3.0.4` dist): `EffectComposer`
default `renderPriority = 1`, default `multisampling = 8`, default `frameBufferType = HalfFloatType`.
- **renderPriority 1 < the probes' 100** → CLAIM 3 holds: in any (hypothetical) collision the
  probe's manual `gl.render` at prio 100 runs LAST and overwrites the composite; but the six
  manual-render probe apps now opt out via `postProcessing={false}`, so no collision exists.
- **multisampling=8 default → override to `0`** per spec §2 (MSAA+post on WebGL2 broken/expensive;
  AA arrives as an SMAA/FXAA *effect* in TASK-105).
- **frameBufferType default = HalfFloat** → kept (linear scene → float target → tone-map → sRGB;
  preserves dark-range precision so the composite does not band vs the direct path = identity-safe).

## Identity / tone-mapping plan (§3)

- `postprocessing@6.39.4` exports numeric enum `ToneMappingMode { LINEAR, REINHARD, REINHARD2,
  REINHARD2_ADAPTIVE, UNCHARTED2, OPTIMIZED_CINEON, CINEON, ACES_FILMIC, AGX, NEUTRAL }`.
- `@react-three/postprocessing`'s `<ToneMapping>` passes `mode` through to `ToneMappingEffect`
  (its own default mode is already `ACES_FILMIC`).
- PostChain reads the renderer's ORIGINAL `gl.toneMapping` once (frozen in a ref BEFORE the
  composer can set it to `NoToneMapping`), maps it 1:1 to a `ToneMappingMode`, and passes that
  as the `<ToneMapping mode=…>`. Map covers every three operator except `CustomToneMapping` (5),
  which is the only unreproducible case → STOP (console.error + render null = R3F default path,
  image unchanged). R3F default is `ACESFilmicToneMapping` (4) → `ACES_FILMIC`.
- **Runtime enum confirmation (rule 2) is reference-machine** (non-blocking gate): confirmed in
  the browser A/B — see "Identity investigation" below.

## Existing scene-host tests — SPEC-FACT CORRECTION (judgment call, rule 1)

**Contradiction found & resolved (not improvised around).** The spec's "all existing scene-host
tests pass unmodified — break one ⇒ blocked" assumed the composer mounts cleanly in the unit env.
It does NOT: a real WebGL2 `EffectComposer` throws under `@react-three/test-renderer`'s mock GL
(`EffectComposer.setRenderer` reads `renderer.getContextAttributes().alpha` → `undefined`). Every
existing test that mounts `SceneHost` at the default tier `high` (quality-integration, SceneHost,
context-loss) hit this and went red (10 tests) — measured, not theorized.

**Resolution (doctrine-consistent, no gate/threshold/assertion touched):** the repo's standing rule
is "vitest has no WebGL → WebGL is covered in e2e" (`docs/testing-conventions.md`,
`[[scale-transition-lane-state]]`). The composer is a WebGL construct, so the unit env stubs it:
added `packages/scene-host/test/setup-postprocessing.ts` (a `vitest` `setupFiles` entry) that mocks
`@react-three/postprocessing` package-wide with a lifecycle-tracking stub. Existing test FILES are
unmodified; they now load `SceneHost` crash-free. The REAL composer is exercised by
`pnpm --filter @cosmos/web build` + `pnpm test:e2e` (smoke = StarApp at high) and its visual identity
by the reference-machine A/B below. The spec's frozen-surface clause is honored (no assertion
changed); this is a test-infra addition the spec did not anticipate. **Spec updated** to record it.

## Identity investigation (§3 — load-bearing) — MEASURED IN THE BROWSER (rule 2)

Runtime confirmed via the `[post-chain] mount` log in `pnpm dev` (StarApp): `toneMapping=4`
(`ACESFilmicToneMapping`) → my `ACES_FILMIC` mapping is correct; `dpr=1`, drawing-buffer == CSS
size (resolution is not a factor); `exposure=25` is an APP shader uniform (`GalaxyScene.setExposure`),
applied upstream in the star/cloud shaders — identical in both render paths, so not a discriminator.

**A/B (settled, full page reloads, same initial camera, composer toggled via the new
`postProcessing` prop on StarApp):**
- Default composer with `frameBufferType` = HalfFloat (the lib default): star field renders
  **brighter + crisper** than the no-composer render — MANY more faint stars visible, bright cores
  sharp. **NOT a visual no-op → §3 violated.**
- Root cause: the scene draws **additive star sprites**. The direct path accumulates them in an
  8-bit framebuffer (bright cores clamp → soft); the composer accumulates in a **linear HalfFloat**
  target (unclamped HDR → bright/crisp) before tone-mapping. The tone-mapping *operator* matches;
  the *framebuffer precision + additive clamp point* did not.

**JUDGMENT CALL (frameBufferType = 8-bit for the step-1 no-op).** Set
`EffectComposer frameBufferType={UnsignedByteType}`. With an 8-bit target the composite clamps
additive accumulation exactly like the direct path → the A/B now **matches the no-composer render**
(soft/dim cores, same faint-star set). The spec §2 said "frameBufferType: defaults" but §3 (identity)
is load-bearing and explicitly overrides ("if they differ, §3 is unmet — fix before merge"); matching
the direct path's precision is REQUIRED for identity on this HDR-additive scene.
- **TASK-106 implication (logged for the next step):** selective bloom (§5.11) NEEDS an HDR
  (HalfFloat) target to bloom bright cores. TASK-106 will switch `frameBufferType` back to HalfFloat
  — at which point the brighter/crisper additive cores become the *intended* visible change (bloom
  step), not an identity regression. Step-1's 8-bit target is the correct no-op foundation; the HDR
  transition belongs to the bloom step. Findings doc: `docs/research/post-chain-identity-hdr-target.md`.
- Near-Sol vantage A/B confirmed identical (composer 8-bit == no-composer). **Far Milky-Way band
  vantage** (bright additive nebulae, `CLOUD_EXPOSURE_BOOST=4e5`) A/B is recommended on the
  reference machine before merge — the same 8-bit-clamp mechanism applies, but the dark-gradient
  banding risk of an 8-bit *linear* intermediate is worth a visual confirm there. (This machine is a
  Windows/RX-9070 dev box, ~3× darker than the committed reference snapshots even at baseline, so
  absolute-brightness screenshot matching is a reference-machine job either way — CLAUDE.md rule 4.)

## e2e result (chromium, `--grep-invert @perf`, deterministic gate)

- With `.env.local` NEUTRALIZED to the committed 135-star sample (`[[flythrough4-envlocal-pack-contamination]]`).
- Full run at the interim HalfFloat build: **50 passed, 3 failed**. The 3 failures are
  reference-machine screenshot/perf, NOT deterministic gates:
  - `m1.spec.ts:207` `toHaveScreenshot('m1-betelgeuse.png')` — guarded `if(!process.env.CI)` ⇒ SKIPPED on CI.
  - `boot-perf.spec.ts` (cold-boot long-task timing) + `flythrough3.spec.ts` (§5.8 frame budget) — wall-clock.
  - **Baseline proof (rule 2):** `git stash -u` (my change removed) + rebuild → the SAME 3 fail on this
    machine (m1 screenshot 72044 px vs 72043 with my change ⇒ ~1 px delta; the 72 k is machine-vs-reference,
    present with and without my change). So they are hardware artifacts, green on CI.
- Final 8-bit build, composer-exercising deterministic specs re-run: **smoke + error-gate + m3 (8 tests)
  all PASS.** error-gate = zero WebGL errors (the research doc's one residual risk — clean). m3 caps hold
  (renderedPoints=1113495 ≤ high cap, drawCalls=10). No threshold relaxed; no probe pinned to `low`.


## Post-merge CI e2e triage (PR #49, run 34140334148) — two composer regressions found + fixed

The interim triage above missed two deterministic specs that went red on **linux CI** (both
GREEN on this win32 box — a SwiftShader-build difference, the CLAUDE.md-documented class). Both
trace to the composer now being in the real-app pipeline. Root-caused from the CI Playwright
report DOM snapshots (the win32 box cannot reproduce either):

1. **`shader-jitter.spec.ts` — 207/300 frames "lost"** (star below the readback floor).
   ShaderJitterProbe is a manual drawing-buffer readback probe at tier `high`, so the 8-bit
   identity COMPOSITE sat on the default framebuffer it reads, and the faint single star dropped
   below `LUM_FLOOR` on linux SwiftShader. **This app was overlooked by
   `post-chain-probe-render-conflict.md`** — its manual-render probe list (CLAIM 3) never
   included ShaderJitterProbe. Fix: `ShaderJitterApp` now passes `postProcessing={false}`, the
   same documented opt-out the six sibling probe apps already carry. → **spec/task bug** (the
   probe-conflict analysis enumerated the wrong set; a manual-readback probe is the same conflict
   class as a manual-render one and should have been in it).

2. **`context-loss.spec.ts` — dedicated overlay replaced by the generic crash card.** On WebGL
   context loss, R3F re-runs the `EffectComposer` constructor `useMemo`; postprocessing@6.39.4
   calls `renderer.getContext().getContextAttributes().alpha`, but `getContextAttributes()`
   returns `null` once the context is lost → "Cannot read properties of null (reading 'alpha')"
   thrown in React's RENDER phase. PostChain is mounted OUTSIDE the app's
   `<ErrorBoundary context="scene">`, so the throw escaped to the app-root boundary and swapped
   the "Graphics context lost — reload" overlay for the generic ErrorCard (CI DOM snapshot:
   `alert > "Something went wrong" / "Cannot read properties of null (reading 'alpha')" / Reload`).
   Fix: `PostChainErrorBoundary` in scene-host wraps `<PostChain>` — a composer throw now degrades
   to "no post-processing" (renders null) and is reported loudly (`console.error`), never crashes
   the app. Deterministic proxy added to `post-chain.test.tsx` (boundary catches a throwing child,
   renders null, reports). → **doctrine/analysis gap** (the probe-conflict doc considered only the
   probe collision, never the composer's resilience to a lost context in the real app; the always-
   on tooth is the new unit test, not the linux-only e2e).

**Judgment calls (this fix):**
- *Error boundary vs. gating PostChain off on `contextLost`:* chose the boundary. The gate is
  narrower but timing-fragile (depends on our state flipping before R3F re-runs the composer
  useMemo, and the win32 box can't verify the ordering); the boundary is robust to the exact
  trigger and also protects future effects (bloom). It reports loudly, so it is degrade-and-report,
  NOT a silent swallow (rules 3/5).
- *`console.error` vs. the app's `reportError` sink:* scene-host is a package and must not depend
  on the app; `console.error` is the package-level loud channel.
- *Left `Flythrough4ProbeApp` untouched* though it also does manual readback with no opt-out flag:
  it pins tier `low` (`bloomEnabled=false` ⇒ no composer), so it is safe — confirmed by CLAIM 2 and
  its green flythrough4 run.
- **Verification honesty (rule 4):** both specs are GREEN on this win32 box with AND without the
  fix — win32 SwiftShader never reproduced either failure. Local green proves "no regression", not
  "fixed". The reproducible teeth are the scene-host unit test (context-loss) and the documented
  opt-out matching six passing siblings (shader-jitter). Real confirmation is the linux CI re-run.
