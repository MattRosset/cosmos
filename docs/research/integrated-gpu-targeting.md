# Integrated-GPU targeting — strategy, gaps & M1 validation playbook

Planning + handoff doc (2026-06-28). Goal: make cosmos run acceptably on **modern
integrated GPUs**, not just high-end discrete. Self-contained so it can be picked up cold on
the validation machine (an Apple M1). Pairs with `docs/research/bug-4-universe-lag.md`
(the fill-rate measurement that motivated this).

> **Update (2026-07-01):** BUG-4 is **closed** via a global 90k procgen cap (`1626985`).
> Step 1 below is **partially done** (cap exists, but not tier/distance-aware). Full Step 1
> remains optional polish — see `procgen-lod-near-sol.md` §Future.

## 0. Decision (settled)

- **Target floor:** modern integrated — **Intel Iris Xe (2020+) / Apple M1** class.
  Older integrated (UHD 620 / pre-2019) and mobile/touch are **out of scope** for now.
- **Validation device:** Apple **M1**. This is the real integrated-class proof; the dev
  machine is an AMD RX 9070 XT (high-end) where fill-bound costs are invisible
  (the universe frame measures 0.37 ms there — see §6 reference numbers).
- **Use Chrome on the M1** for measurement (EXT_disjoint_timer_query_webgl2 may be
  unavailable under Safari's WebGL).

## 1. Target budget (measurable)

**≥60 fps ideal / ≥30 fps floor at the M1's native Retina resolution**, in the worst case
(universe view + the descent). Because frame-*interval* floors at vsync and is blind to
sub-refresh cost on a capable GPU, the gate is on **GPU frame time** (timer query):

- 60 fps ⇒ GPU ≤ ~16 ms · 30 fps ⇒ GPU ≤ ~33 ms, measured per descent segment.

## 2. Current adaptive-quality infrastructure (already exists — do NOT rebuild)

| Mechanism | Where | What it does |
|-----------|-------|--------------|
| `PerformanceMonitor` (drei) | `packages/scene-host/src/SceneHost.tsx:158` | FPS decline/incline → `qc.stepDown()` / `stepUp()` |
| `QualityControllerImpl` | `packages/scene-host/src/quality.ts` | tier state machine (`high`/`medium`/`low`), 50 ms debounce, manual override |
| Tier table | `packages/core-types/src/quality.ts` | `maxRenderedPoints` 2M/1M/500k · `resolutionScale` 1/0.75/0.5 · `bloomEnabled` · `atmosphereEnabled` |
| Resolution scale | `SceneHost.tsx:112` | `gl.setPixelRatio(min(dpr,2) * resolutionScale)` on tier change |
| Streaming point cap | `apps/web/src/glue/quality.ts` + `packages/streaming/src/budgets.ts:40` | clamps streamed points to the tier's `maxRenderedPoints` |

`bloomEnabled`/`atmosphereEnabled` are currently **flag-only** (no post chain wired);
atmosphere is the per-planet O'Neil shell (only near Earth), not a galaxy/universe fill cost.

## 3. Gaps for integrated GPUs

1. **The procgen Milky Way cloud — the #1 fill offender — does NOT yet respond to quality tier.**
   `GalaxyScene.tsx` caps at `PROCGEN_MAX_DRAW_POINTS = 90_000` globally (`1626985`, closes
   BUG-4), but does not read `useQuality` — `high` and `low` get the same count. **Remaining
   gap:** tier/distance LOD so integrated GPUs keep the cap while `high` gets full cloud at
   far vantage. See `procgen-lod-near-sol.md` §Future.
2. **Always starts at `high`** and only steps down after `PerformanceMonitor` detects jank →
   the first seconds on an integrated GPU are a stutter before it adapts.
3. **Retina pixel-ratio multiplier.** `min(dpr,2) * resolutionScale`: on M1 Retina `dpr=2`,
   so `high` renders at **2× → 4× the fragments** of a 1× display. This is the single largest
   fill multiplier on the M1; capping the effective pixel ratio (or tiering down) matters more
   than any micro-opt.
4. **No GPU-time gate.** CI gates on deterministic work-budget proxies + frame interval; the
   actual low-tier GPU cost is ungated, and FPS can't see it on a fast GPU.

## 4. Plan (ordered by impact)

### Step 1 — Tier/distance-scale the procgen cloud (optional polish; BUG-4 closed via global cap)

**Partial (2026-07-01):** global 90k cap (`1626985`) addresses weak-GPU overdraw. **Remaining:**
wire `useQuality().tier` and/or distance into `drawFraction` so `high` draws the full cloud
at ≥ `GAL_FADE_HI_PC` while `low` keeps the cap. **Not a frozen-package change** for the
simple case: `cloud.setDrawFraction` is already exposed.
**Trap:** keep `drawFraction` a *perf-only* knob driven by tier/distance — do NOT tie it to
`procgenBlend` (opacity), which re-creates the P2 "nebulas without stars" regression
(see `galaxy-transit-procgen-floor-design.md`). Biggest single overdraw win.

### Step 2 — Land weak GPUs on the right tier fast
- Boot **GPU detect** via `WEBGL_debug_renderer_info` UNMASKED_RENDERER: Apple / Intel-HD /
  integrated strings start at `medium` instead of `high` (string heuristic is fragile but
  cheap; PerformanceMonitor remains the safety net). Safari masks the string → fall back to
  `high` + adaptive.
- **Cap effective pixel ratio** on Retina (e.g. clamp below 2× on integrated, or fold into
  the tier's `resolutionScale`) so the heavy galaxy pass isn't paying 4× fragments at boot.

### Step 3 — Calibrate on the M1 (the real proof)
Run the dev server on the M1, drive `?debug=flythrough4` + a GPU timer query at each tier and
at native Retina, and record the universe-segment GPU ms. This gives a real integrated-class
number (instead of extrapolating from the 9070 XT) and fixes the tier budgets. **Playbook in §5.**

### Step 4 — GPU-ms budget gate (not FPS)
Add a deterministic gate on GPU ms (timer query) and/or SwiftShader fill cost so low-tier
regressions are caught in CI without the M1. Ties to [[ci-test-infra-philosophy]] and
[[verify-render-before-perf]] (FPS floors at vsync and is blind to this).

## 5. M1 validation playbook (run on the Mac, in Chrome)

### 5.1 Run the app + the perf probe
```bash
pnpm install            # Node ≥ 22, pnpm pinned in package.json
pnpm --filter @cosmos/web dev
# open Chrome at the printed localhost URL, then the perf probe:
#   http://localhost:5173/?debug=flythrough4
```
The probe replays the committed flythrough path and publishes to `window.__flythrough4Result`.
Read per-segment frame stats (DevTools console):
```js
const r = window.__flythrough4Result;
['toGalaxy','toSol','toEarth'].map(k => ({ seg:k, p50:r.segments[k].p50.toFixed(1),
  p95:r.segments[k].p95.toFixed(1), scenePts:r.segments[k].peakScenePoints,
  procgen:[r.segments[k].minProcgenOpacity, r.segments[k].maxProcgenOpacity] }));
```
`toGalaxy` = the universe view (BUG-4). NOTE: `p50` here is the rAF/vsync-paced frame
*interval* — on the M1 it may floor at the display refresh and hide sub-refresh cost. For the
true GPU cost use the timer query (§5.2).

### 5.2 True GPU cost — temporary timer-query instrument
The instrument was used on the dev machine then reverted (kept out of `main`). Re-apply this
patch to `apps/web/src/scene/Flythrough4Probe.tsx` on the M1, run `?debug=flythrough4`, read
`window.__flythrough4Gpu`, then revert. (Chrome only — Safari lacks the extension.)

Add a ref near the other `useRef`s in the component:
```ts
// [TEMP] BUG-4 / integrated-GPU instrument — revert after measuring.
const gpuTimer = useRef<{
  gl2: WebGL2RenderingContext;
  ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  pending: { q: WebGLQuery; seg: SegmentKey | null }[];
  samples: Record<SegmentKey, number[]>;
} | null>(null);
```
Wrap the probe's `gl.render(scene, camera)` (in the `useFrame`) with begin/end + drain:
```ts
const gt = gpuTimer.current ?? (() => {
  const c2 = gl.getContext() as WebGL2RenderingContext;
  const ext = c2.getExtension('EXT_disjoint_timer_query_webgl2') as
    { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  const t = { gl2: c2, ext, pending: [] as { q: WebGLQuery; seg: SegmentKey | null }[],
    samples: { toGalaxy: [] as number[], toSol: [] as number[], toEarth: [] as number[] } };
  gpuTimer.current = t; return t;
})();
const segNow = segmentForPhase(runner.phase);
let gq: WebGLQuery | null = null;
if (gt.ext) { gq = gt.gl2.createQuery(); gt.gl2.beginQuery(gt.ext.TIME_ELAPSED_EXT, gq); }

gl.render(scene, camera);

if (gt.ext && gq) {
  gt.gl2.endQuery(gt.ext.TIME_ELAPSED_EXT);
  gt.pending.push({ q: gq, seg: segNow });
  while (gt.pending.length > 0) {
    const f = gt.pending[0]!;
    if (!gt.gl2.getQueryParameter(f.q, gt.gl2.QUERY_RESULT_AVAILABLE)) break;
    const disjoint = gt.gl2.getParameter(gt.ext.GPU_DISJOINT_EXT);
    if (!disjoint && f.seg) gt.samples[f.seg].push(
      (gt.gl2.getQueryParameter(f.q, gt.gl2.QUERY_RESULT) as number) / 1e6);
    gt.gl2.deleteQuery(f.q); gt.pending.shift();
  }
}
```
At publish (the `if (runner.done)` block), expose the percentiles:
```ts
const gt = gpuTimer.current;
if (gt) {
  const out: Record<string, { n:number; p50:number; p95:number; max:number }> = {};
  for (const key of SEGMENT_KEYS) {
    const a = [...gt.samples[key]].sort((x, y) => x - y);
    const pct = (p: number) => a[Math.min(a.length - 1, Math.floor((p/100)*a.length))] ?? 0;
    out[key] = { n: a.length, p50:+pct(50).toFixed(3), p95:+pct(95).toFixed(3),
      max:+(a[a.length-1] ?? 0).toFixed(3) };
  }
  (window as unknown as { __flythrough4Gpu?: unknown }).__flythrough4Gpu =
    { supported: gt.ext !== null, segments: out };
}
```
Read it after the run: `window.__flythrough4Gpu`. The query serialises the pipeline (slows the
run, fewer `toGalaxy` samples) — treat absolute sub-ms numbers as order-of-magnitude; the
*relative* per-segment ordering is robust.

### 5.3 What to capture on the M1
For each tier (`high`/`medium`/`low` — set via `window.__cosmosDev.setTier('low')` or the
settings UI), at native Retina:
- `__flythrough4Gpu.segments.toGalaxy` (p50/p95/max GPU ms) — the universe worst case.
- The same with a smaller window / lower `resolutionScale` to confirm fill-boundness.
- Canvas buffer size + `devicePixelRatio` (`const c=document.querySelector('canvas');
  [c.width,c.height,devicePixelRatio]`) so the pixel budget is recorded.

This calibrates: does the M1 hit ≤16/≤33 ms at `high`? If not, at which tier does it, and is
`resolutionScale`/pixel-ratio the lever that gets it there? → sets the Step-1/Step-2 targets.

## 6. Reference numbers (AMD RX 9070 XT, 2026-06-28 — high-end baseline, NOT the target)

- Scene points, universe segment (`toGalaxy`): **1,109,970** at procgen opacity 1 (full cloud).
- Frame interval (rAF/vsync-paced): all segments **6.1 ms** at 0.9 MP AND 3.69 MP (vsync floor,
  164 Hz) — blind to the cost.
- GPU timer query (true cost): `toGalaxy` **0.369 ms p50 / 1.10 p95 / 4.16 max**;
  `toSol` 0.019 / 1.34 / 1.67; `toEarth` 0.053 / 0.14 / 0.18. Universe is the costliest
  segment (~7–19× the inner segments) — mechanism confirmed, but negligible on this GPU.
- Extrapolation: an integrated GPU has ~10–100× less fill throughput → the same draw is
  ~4–37 ms (peak 40 ms+). The M1 measurement (§5) replaces this guess with a real number.

## 7. Open notes
- Whether to add a settings UI affordance for a manual quality floor (so users on weak GPUs
  can pin `low`) — the override path already exists (`setTier`).
- Whether `low`'s `resolutionScale=0.5` is enough on Retina, or `high`/`medium` also need a
  pixel-ratio cap independent of the tier.
- Related: [[bug-4-universe-lag-latent]], [[hardware-target-floor]], [[verify-render-before-perf]],
  `docs/research/bug-4-universe-lag.md`, `docs/research/galaxy-transit-procgen-floor-design.md`.
