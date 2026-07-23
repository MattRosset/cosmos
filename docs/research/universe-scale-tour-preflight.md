# Research: universe-scale layer + scale-descent guided tour — preflight

**Date:** 2026-07-23
**Decision this serves:** whether to spec (a) a procedural universe of galaxy-points
where only the Milky Way is selectable, and (b) a redesigned guided tour that is a
continuous zoom Universe → Milky Way → star field → Solar System → Earth. The question
is *what, if anything, must close before that spec is written*.

**Ordering:** Steps 1–2 below (questions + kill conditions) were written and committed
in `b68b1de` **before** any source file was opened, per the research skill. Findings
were appended afterwards.

---

## Step 1 — Falsifiable questions

- **Q1 (scaffold vs net-new).** At the Universe/Cosmos scale today, does the renderer draw
  any point/geometry field, or is it empty/placeholder above galaxy scale?
- **Q2 (performance floor).** Does a continuous descent through all scales stay within
  frame budget on the hardware floor (integrated Iris Xe / Apple M1 class), and where in
  the descent does cost spike?
- **Q3 (transition mechanics).** Is today's scale change a continuous camera zoom or a
  fade/cut? Can a no-cut descent be driven by what exists?
- **Q4 (coordinate precision).** Is position local-per-mode or global, and does crossing
  many orders of magnitude in one continuous motion risk f32/f64 blowup?
- **Q5 (real vs procgen).** Which scales are real catalog data vs procedural?
- **Q6 (open tasks).** Which tasks in the `check:tasks`-gated index are actually open, and
  which of those block the tour path or an HN launch?

## Step 2 — Kill / redirect conditions (written first)

- **Q1 kills the "one missing asset" framing** if the universe scale already renders a
  point field with selection plumbing — then the work is an extension task, not a new
  layer, and the spec shrinks. It **redirects** if the universe scale turns out to be
  unreachable by the camera at all (no mode above galaxy), which would make the tour's top
  end net-new *navigation*, not just net-new geometry.
- **Q2 kills the whole tour spec (for now)** if a throttled descent blows the frame budget
  at a point on the tour path itself and the cause is structural (no tier scaling, fill
  cliff) — the tour would be specced on top of a floor that cannot carry it. It is
  **not** a blocker if the spike is off-path or fixable inside the tour task.
- **Q3 forces new camera-path work into the spec** if transitions are fades/cuts with no
  continuous-parameter path. If a continuous zoom already drives mode changes, "reuse
  scale-jump" is verified and the spec is smaller.
- **Q4 blocks** if positions are float32 in a single global frame — a continuous descent
  would visibly break, and precision work must land before the tour. It is **not** a
  blocker if each mode reframes locally (rebasing), because the descent then never holds a
  large coordinate in a small type.
- **Q5 kills nothing** but changes copy/labelling requirements; if any scale currently
  *implies* real data where it is procedural, that is an honesty defect to fix in the tour
  spec.
- **Q6** produces the ordered list. A task blocks only if the tour path or first-load
  experience demonstrably depends on it; everything else defers.

**Verdict is allowed to be "nothing blocks — spec it now."**

---

## Findings

### Q1 — CURRENT UNIVERSE MODE → **REFRAMED** (the redirect condition fired)

The universe scale is a *real context with real machinery*, but it renders exactly one
object and **the production app cannot reach it**.

```
CLAIM:    'universe' is a first-class scale context (unit 1 Mpc) with its own switch
          law, anchor, streaming activation and HUD ruler segment.
EVIDENCE: packages/core-types/src/coords.ts:9,13 (ContextId includes 'universe';
          CONTEXT_UNIT_METERS.universe = 3.0857e22 m);
          packages/nav/src/galaxy-switch.ts:22-25 (enter 1.543e21 m ≈ 50 kpc,
          exit 3.086e21 m ≈ 100 kpc);
          apps/web/src/scene/GalaxyScene.tsx:511 (streaming active in universe);
          packages/ui/src/scale-ruler.ts:22-28 (SCALE_RULER_SEGMENTS ends 'universe').
VERIFIED: 2026-07-23
RECHECK:  cat packages/core-types/src/coords.ts packages/nav/src/galaxy-switch.ts
```

```
CLAIM:    The only thing drawn at universe scale is the Milky Way itself — a far-LOD
          billboard impostor plus the procgen star cloud. There is NO field of other
          galaxies. `generateLocalGroup` produces 12 GalaxyRecords, but production
          destructures away the `galaxies` array and uses only `milkyWay`.
EVIDENCE: packages/nav/src/local-group.ts:24-51 (12 records, 1.5 Mpc sphere);
          apps/web/src/glue/local-group.ts:28-39 (index 0 → 'proc:milkyway' at origin);
          apps/web/src/app/StarApp.tsx:208 — `const { milkyWay } = useMemo(...)`;
          the ONLY other-galaxy consumers of `.galaxies` anywhere in apps/ + packages/
          are local-group.ts's own internals (grep below returns 5 hits, all in that file);
          packages/render-galaxy/src/impostor.ts — a SINGLE impostor mesh per instance,
          instantiated once in GalaxyScene.tsx:231.
VERIFIED: 2026-07-23
RECHECK:  grep -rn "\.galaxies\|galaxies\b" --include=*.ts --include=*.tsx apps/web/src packages/render-galaxy/src
```

```
CLAIM (the redirect):
          A user of the production app can NEVER reach 'universe'. The galaxy→universe
          exit is gated on `ownGalaxyContext`, which is only set true by an
          earlier universe→galaxy entry. StarApp boots in 'galaxy', so the flag is
          false forever and the exit branch is dead code in production.
EVIDENCE: apps/web/src/scene/NavDriver.tsx:24-27 (INITIAL_CAMERA context 'galaxy');
          packages/nav/src/controller.ts:434 (`let ownGalaxyContext = false`),
          :732-733 (set true ONLY on 'universe'→'galaxy'), :800 (`if (ownGalaxyContext)`
          gates the exit).
          MEASURED — scratch vitest in packages/nav/test (deleted after the run):
          boot context 'galaxy' at [0,0,0.06] pc, `setGalaxyAnchor('proc:milkyway')`
          exactly as glue/local-group.ts does, then parked at 1,000,097 pc
          (10× the 100 kpc exit gate) for 10 updates →
            `MEASURED farPc= 1000097.2226723272 contextId= galaxy events= []`
          Zero context-switch events; still 'galaxy'.
          Corroborating comment in the codebase: apps/web/src/glue/goto.ts:30-36 says
          "the controller only exits to universe when it ENTERED from universe
          (controller.ts ownGalaxyContext), so a galaxy vantage is the reliable
          'see the whole Milky Way' from the booted galaxy app."
VERIFIED: 2026-07-23
RECHECK:  grep -n "ownGalaxyContext" packages/nav/src/controller.ts   # 5 hits, no init override
          grep -n "INITIAL_CAMERA" -A3 apps/web/src/scene/NavDriver.tsx
```

```
CLAIM:    The "View galaxy" button tops out at ~49 kpc in the GALAXY context — inside
          the 100 kpc exit gate — so even the deliberate pull-back never crosses the
          boundary. Its docstring at goto.ts:95 still claims "fly all the way out to a
          universe vantage"; the implementation is a galaxy-context target. Doc drift.
EVIDENCE: apps/web/src/glue/goto.ts:38-40 (GALAXY_VIEW_VANTAGE_PC = 55_000,
          GALAXY_VIEW_ARRIVAL_M ≈ ends 49 kpc), :278-287 (target context 'galaxy').
VERIFIED: 2026-07-23
RECHECK:  sed -n '28,42p;273,288p' apps/web/src/glue/goto.ts
```

**Settled:** neither "net-new" nor "scaffold to extend" as posed. The *scaffold is
substantial and already CI-gated* (context, units, switch law, anchor scan, streaming
activation, HUD segment, and a recorded universe→Earth descent — see Q3). What is
net-new is **two** things, not one: (a) the galaxy-point field geometry + selection, and
(b) **a way for a user to get up there at all**. (b) was not in the original framing and
is the smaller, sharper piece of work.

### Q2 — PERFORMANCE FLOOR → **REFRAMED: the measurement does not exist, and one structural cause is confirmed present**

```
CLAIM:    Nothing in this repo measures GPU cost. There is no timer-query instrument in
          shipped code or in any gate; the CI descent gates deterministic work budgets
          only and explicitly excludes wall-clock frame time.
EVIDENCE: `grep -rn "EXT_disjoint_timer_query" --include=*.ts --include=*.tsx apps packages e2e`
          → zero hits (the instrument in integrated-gpu-targeting.md §5.2 is a patch to
          re-apply, never committed).
          e2e/tests/flythrough3.spec.ts:14-34 — "CI gates on the DETERMINISTIC work-budget
          caps only; wall-clock frame time is NOT a CI gate"; :154 wraps the p95/max-frame
          assertions in `if (!process.env['CI'])`.
VERIFIED: 2026-07-23
RECHECK:  grep -rn "EXT_disjoint_timer_query" --include=*.ts --include=*.tsx apps packages e2e
          grep -n "process.env\['CI'\]" e2e/tests/flythrough3.spec.ts
```

```
CLAIM:    The BUG-4 fill exposure is STRUCTURALLY PRESENT in production today: StarApp
          boots at tier 'high', and 'high' has NO procgen draw cap (Infinity) and
          resolutionScale 1. On an M1 Retina (dpr 2) that is the full ~1,000,000-point
          cloud at 4× fragments until PerformanceMonitor notices jank and steps down.
          TASK-072 (GPU-string boot-tier detection + pixel-ratio cap) is UNIMPLEMENTED.
EVIDENCE: apps/web/src/app/StarApp.tsx:569 — `initialQualityTier="high"` (hardcoded);
          apps/web/src/glue/procgen-draw-budget.ts:23-27 — high: Infinity, medium: 250_000,
          low: 90_000;
          packages/core-types/src/quality.ts — high.resolutionScale = 1;
          packages/scene-host/src/SceneHost.tsx:112 —
          `gl.setPixelRatio(Math.min(window.devicePixelRatio, 2) * settings.resolutionScale)`;
          apps/web/src/glue/local-group.ts:13 — MILKY_WAY_STAR_COUNT = 1_000_000;
          no `WEBGL_debug_renderer_info` boot detection outside the ShaderJitterProbe
          (grep: only apps/web/src/scene/ShaderJitterProbe.tsx:196).
VERIFIED: 2026-07-23
RECHECK:  grep -rn "initialQualityTier" apps/web/src/app/StarApp.tsx
          cat apps/web/src/glue/procgen-draw-budget.ts
```

```
CLAIM:    Adaptive degradation IS wired and is the current (reactive) safety net —
          PerformanceMonitor → stepDown/stepUp with 50 ms debounce, and the tier's
          resolutionScale is applied on change. So the floor question is about the
          first seconds and the ungated steady-state cost, not about "no adaptation".
EVIDENCE: packages/scene-host/src/SceneHost.tsx:139,143,158;
          packages/scene-host/src/quality.ts:46-60.
VERIFIED: 2026-07-23
RECHECK:  grep -n "stepDown\|stepUp\|PerformanceMonitor\|setPixelRatio" packages/scene-host/src/SceneHost.tsx
```

**What I could NOT measure, and why (stated plainly).** I attempted a live measurement of
`?debug=flythrough4` on https://cosmos-coq.pages.dev. The probe never produced
`window.__flythrough4Result`: the browser pane is not compositing in this session, so
`requestAnimationFrame` never fires and the descent never advances (a 1-second rAF
counter eval timed out at 30 s). **No frame numbers were obtained.** Even had it run, this
dev box is an RX 9070 XT — per integrated-gpu-targeting.md §0 the universe frame measures
0.37 ms there, i.e. the class of cost in question is invisible on it. CI is SwiftShader,
which is *below* the target floor but has its wall-clock assertions disabled by design.

**Go / no-go on the performance floor: NO-GO ON EVIDENCE, NOT NO-GO ON THE TOUR.**
There is no measurement anywhere — in this session, in CI, or in the repo — of what the
descent costs on Iris Xe / M1 class hardware. That is a verified absence, not a bad
number. The honest position: the tour spec should **not** claim a performance budget it
cannot cite, and the M1 run (integrated-gpu-targeting.md §5, ~10 minutes on your Mac) is
the cheapest way to convert this from unknown to known. It does **not** block *writing*
the spec; it blocks *committing to a frame budget inside it*.

### Q3 — MODE-BOUNDARY TRANSITION → **VERIFIED: continuous, no cut, and the exact tour path already exists**

```
CLAIM:    A context switch is a pure coordinate reconversion, not a fade or a cut. The
          camera's absolute point is unchanged across the boundary; velocity is rescaled
          by the unit ratio so PHYSICAL speed is continuous; a dev-mode guard THROWS if
          a switch ever moved the camera.
EVIDENCE: packages/nav/src/controller.ts:666 (`origin.switchContext(to)`), :674-681
          (velocity × CONTEXT_UNIT_METERS[from]/[to]), :684-727 (dev precondition guard
          "context switch broke positional continuity");
          packages/coords/src/origin.ts:86-100 (switchContext converts origin + camera
          through the frame tree, f64).
VERIFIED: 2026-07-23
RECHECK:  sed -n '660,740p' packages/nav/src/controller.ts
```

```
CLAIM:    A recorded, CI-gated, continuous universe → Milky Way → Sol → Earth descent
          ALREADY EXISTS and runs through the real nav controller and the real streaming
          pipeline. It is the exact path the proposed tour describes.
EVIDENCE: apps/web/src/scene/flythrough-descent.ts:1-243 (createDescentRunner: legs
          toGalaxy/toSol/toEarth + reverse legs);
          apps/web/src/scene/flythrough3-path.json:2-9 — "The continuous descent outside
          the Milky Way -> spiral arms -> star field -> Sol -> Earth", start
          `{context:'universe', local:[0,0,0.6]}`;
          e2e/tests/flythrough3.spec.ts:124-128 asserts the switch sequence and
          `finalContext === 'system'`; e2e/tests/flythrough4.spec.ts replays the same
          path against the shipped M4a composition.
VERIFIED: 2026-07-23
RECHECK:  cat apps/web/src/scene/flythrough3-path.json; sed -n '119,150p' apps/web/src/scene/flythrough-descent.ts
```

```
CLAIM:    Cinematic splines are already context-agnostic: keyframes carry
          UniversePositions and all four Catmull-Rom control points are reconverted into
          the ACTIVE context's render space every frame, so a spline survives a context
          switch and a floating-origin rebase mid-flight.
EVIDENCE: packages/core-types/src/cinematic.ts:4-15;
          packages/nav/src/controller.ts:977-990 (per-frame toRenderSpace on p0..p3
          and lookAt l0..l3).
VERIFIED: 2026-07-23
RECHECK:  sed -n '960,995p' packages/nav/src/controller.ts
```

```
CLAIM:    Today's SHIPPED guided tour is deliberately galaxy-scale-only and is
          explicitly forbidden from descending: three star steps, framed at 1.85×
          enterSystemAtM so the nav controller cannot auto-enter a system.
EVIDENCE: apps/web/src/glue/tours.ts:14-21 (TOUR_FRAMING_STANDOFF_PC, "must NOT cross
          enterSystemAtM"), :26-62 (GRAND_TOUR = Sol, Betelgeuse, TRAPPIST-1),
          :28 "Planet targets and system descent are deferred to a future tour-design task."
VERIFIED: 2026-07-23
RECHECK:  sed -n '14,62p' apps/web/src/glue/tours.ts
```

**Settled: "reuse scale-jump" — verified, with one caveat.** No new camera-path
mathematics is needed. The descent runner, the context-surviving spline, and the
continuity guard all exist and are gated. The tour work is composition + narration +
pacing on top of `createDescentRunner`, plus lifting the deliberate galaxy-only standoff
in `tours.ts`. The caveat is Q1's finding: the *interactive* entry into universe context
does not exist, so a tour that starts at universe must either start there programmatically
(as the probes do) or the ascent must be unblocked.

### Q4 — COORDINATE PRECISION → **VERIFIED: not a blocker**

```
CLAIM:    Positions are f64 (JS numbers) in a per-context local frame with a
          floating-origin rebase; the f64 subtraction `body − camera` happens BEFORE any
          downcast, and only the caller downcasts to f32 at the GPU boundary. Crossing
          scales never holds a large magnitude in a small type — each context re-expresses
          the same absolute point in its own unit (Mpc / pc / AU / km).
EVIDENCE: packages/core-types/src/coords.ts:4-6,12-17,26 (units per context;
          REBASE_THRESHOLD_UNITS = 10_000);
          packages/coords/src/origin.ts:1-7 (header contract), :66-84 (rebase on
          |cameraLocal| > threshold), :102-110 (f64 subtract, caller downcasts).
VERIFIED: 2026-07-23
RECHECK:  cat packages/coords/src/origin.ts packages/core-types/src/coords.ts
```

The one known f32 hazard is downstream of this and already fixed and gated: the star
shader's hi/lo GPU sum (TASK-077, `c3f82a1`, `?debug=shaderjitter`). It is a *near-star*
concern, unaffected by adding scale above galaxy.

### Q5 — REAL vs PROCGEN → **VERIFIED, and there is an honesty defect at the top and the bottom of the ladder**

Measured against the **live deployment** (fetches executed at origin
https://cosmos-coq.pages.dev on 2026-07-23):

```
CLAIM:    The live site's real catalog is 109,399 HYG stars (+ a 113,495-point HYG
          octree, 9 tiles). The Gaia tier served in production is the committed SAMPLE:
          ONE tile, 135 points. The ~4.6M-star Gaia pack is NOT deployed.
EVIDENCE: fetch('/packs/manifest.json') → {"count":109399, source hyg…};
          fetch('/packs/octree/octree.json') → {tiles:9, points:113495,
          source:"hyg-v41-octree"};
          fetch('/packs/octree-gaia-sample/octree.json') →
          {source:"gaia-dr3-bright", tiles:[{key:"0/0", pointCount:135}]}.
          Cause: apps/web/src/app/packs.ts:26 —
          `import.meta.env.VITE_GAIA_OCTREE_MANIFEST_URL ?? '/packs/octree-gaia-sample/octree.json'`
          and the env var is not set for the Cloudflare Pages build.
VERIFIED: 2026-07-23
RECHECK:  curl -s https://cosmos-coq.pages.dev/packs/octree-gaia-sample/octree.json | head -c 300
          curl -s https://cosmos-coq.pages.dev/packs/manifest.json
```

```
CLAIM:    Everything that makes the galaxy LOOK dense is procedural, and it is
          distance-gated: near Sol the procgen layer is fully OFF (real catalog owns the
          view); in the mid band it ramps; at the far vantage it is the whole picture
          (cloud + dust lanes + HII + impostor share one opacity).
EVIDENCE: apps/web/src/scene/GalaxyScene.tsx:470-492 (the procgen-visibility contract
          and the distance-driven blend, GAL_FADE_LO_PC → GAL_FADE_HI_PC);
          packages/render-galaxy/src/{galaxy-points,dust-lanes,impostor}.ts;
          packages/procgen/src/galaxy.ts.
VERIFIED: 2026-07-23
RECHECK:  sed -n '451,510p' apps/web/src/scene/GalaxyScene.tsx
```

```
CLAIM:    The HUD advertises a scale the app cannot reach. The scale ruler renders a
          'universe' segment (and the live HUD prints UNIVERSE and COSMOS), while Q1
          shows universe context is unreachable in production.
EVIDENCE: packages/ui/src/scale-ruler.ts:22-28,46-47;
          live page text at https://cosmos-coq.pages.dev reads
          "PLANET / SYSTEM / STAR FIELD / GALACTIC SURVEY / UNIVERSE / COSMOS".
VERIFIED: 2026-07-23
RECHECK:  open https://cosmos-coq.pages.dev and read the ruler; cat packages/ui/src/scale-ruler.ts
```

**Settled.** A universe layer of galaxy-points would be 100% procedural, and that is
consistent with what the app already does one level down — but the tour copy must say so,
and the *existing* copy already has two honesty gaps to fix on the way: the unreachable
UNIVERSE/COSMOS ruler segments, and a "Gaia field" story backed by 135 stars in production.

### Q6 — OPEN-TASK TRIAGE

```
CLAIM:    `pnpm check:tasks` is RED on the current branch and is deliberately not wired
          into `pnpm verify`.
EVIDENCE: `node tools/check-task-index/src/check.mjs` →
          "Task index: 69 tasks (67 done, 2 pending) … FAIL: 1 inconsistency
           • TASK-064: marked done, but blocker TASK-063 is 'pending'" (exit 1);
          package.json:20 defines check:tasks; docs/agent-tasks/NOTES-2026-07-22-index-audit.md §2
          records the deliberate omission from verify.
VERIFIED: 2026-07-23
RECHECK:  node tools/check-task-index/src/check.mjs; echo $?
```

```
CLAIM:    The gate's "2 pending" UNDERCOUNTS open work: nine task files (TASK-069…077)
          exist on disk and NONE of them appear in the index table, so check:tasks cannot
          see them. The index is not a complete picture of open work.
EVIDENCE: `for t in 069 … 077; do grep -c "TASK-$t](" docs/agent-tasks/README.md; done`
          → 0 for every one of the nine; `ls docs/agent-tasks` shows all nine files
          plus BACKLOG-2026-07.md and BUG-10-P1-eviction-count-backstop.md.
VERIFIED: 2026-07-23
RECHECK:  for t in 069 070 071 072 073 074 075 076 077; do printf "$t "; grep -c "TASK-$t](" docs/agent-tasks/README.md; done
```

Status of each open item, established from CODE not from the row text:

| Item | Real state (evidence) | Triage |
|---|---|---|
| **N1 — universe unreachable** (unticketed) | Measured, Q1. `ownGalaxyContext` gates the exit; production boots in galaxy. | **BLOCKS THE TOUR PATH** |
| **N2 — no galaxy-point field** (unticketed) | Q1: 12 records generated, 0 rendered; one impostor. | **IS the tour work** (not a blocker — the deliverable) |
| **TASK-072** integrated-GPU boot tier | UNIMPLEMENTED — `initialQualityTier="high"` hardcoded at StarApp.tsx:569; no `WEBGL_debug_renderer_info` boot detect. | **BLOCKS HN LAUNCH** (first-seconds stutter on the target floor) |
| **N5 — M1/GPU-ms calibration** (unticketed; integrated-gpu-targeting.md §5, Steps 3–4) | Never run; no timer query in repo (Q2). | **BLOCKS a perf claim**, not the spec |
| **N3 — production Gaia = 135 stars** (unticketed) | Measured live, Q5. `VITE_GAIA_OCTREE_MANIFEST_URL` unset in the CF Pages build. | **BLOCKS HN LAUNCH** (the "4.6M real stars" story is not what ships) |
| **N4 — no touch movement** (unticketed) | `packages/nav/src/input.ts` binds keydown/keyup/pointer\* only; zero `touchstart`/`onTouch` anywhere in packages/ + apps/. Look-drag works via pointer events; WASD translation has no touch equivalent. | **BLOCKS HN LAUNCH** for mobile visitors; optional for the tour (a tour is passive and needs no input) |
| **N6 — unreachable UNIVERSE/COSMOS ruler segments** (unticketed) | Q5. | Fold into the tour task (it stops being wrong once N1 lands) |
| **TASK-074** tour design | Spec file exists, never executed (`git log --grep` → only the spec-authoring commit `1a08d64`). Deliverable is `docs/research/tour-design.md`. | **This is the task you are about to do** — supersede or execute it |
| **TASK-063** screenshot policy | Code appears shipped (all `toHaveScreenshot` guarded), but acceptance #1 cannot pass: the `m1-betelgeuse` baseline embeds a wall-clock HUD string, plus stale baselines since TASK-076. Recorded in NOTES-2026-07-22-index-audit.md §1. | Optional-defer (blocks only the green `check:tasks`) |
| **TASK-070** Gaia search by source_id | Unimplemented (no matching commits; depends on 069 which IS shipped — `catalogIds` plumbed through octree-combined.ts + StarScene.tsx:337-340). Also moot in production while N3 stands. | Optional-defer |
| **TASK-073 / TASK-075** nebula Tier B | Specs only. | Optional-defer |
| **TASK-078** Sentry transport | Pending; no `@sentry/react` dep. Note NOTES §4: source-map upload belongs in the CF Pages build, the Actions workflow was deleted. | Optional-defer (nice before an HN spike, not required) |
| **BUG-10 P1** evict-by-count backstop | Unimplemented (`grep maxLoadedChunks` → zero hits). Its own brief says residency is already bounded and this is not urgent. | Optional-defer |

---

## What I looked for and did NOT find (verified absences)

- **No renderer for more than one galaxy.** `grep -rn "\.galaxies\|galaxies\b"` over
  `apps/web/src` + `packages/render-galaxy/src` returns only `glue/local-group.ts`'s own
  internals. `createGalaxyImpostor` is instantiated exactly once (GalaxyScene.tsx:231).
- **No GPU-time instrumentation of any kind.** `grep -rn "EXT_disjoint_timer_query"` over
  `apps packages e2e` → zero hits.
- **No boot-time GPU detection.** `WEBGL_debug_renderer_info` appears only in
  `apps/web/src/scene/ShaderJitterProbe.tsx:196` (a diagnostic probe), never in StarApp.
- **No touch input handling.** `grep -rn "touchstart|onTouch"` over `packages` +
  `apps/web/src` → zero hits.
- **No `maxLoadedChunks` budget** (BUG-10 P1) anywhere in `packages/streaming/src`.
- **No second `doSwitch` call path.** All four call sites are inside `maybeSwitchContext`
  (controller.ts:783, 793, 804, 814) — there is no goTo/cinematic back door that could
  reach universe context around the `ownGalaxyContext` gate.
- **No frame-time number for the target hardware**, from any source: not in this session
  (rAF frozen), not in CI (assertions disabled under `process.env.CI`), not in the repo.

## Beliefs (second-class — a spec may NOT cite these as Step 0 facts)

- The universe-scale fill cost of ~12 additive impostor sprites should be negligible next
  to the 1M-point procgen cloud. Not measured; asserted from the shape of the code.
- Lifting `ownGalaxyContext` looks like a small change (an option on the controller, or
  seeding the flag when the app boots with a galaxy anchor). Not attempted, and the flag
  exists to protect TASK-027 tests — the real cost is in not breaking those.

---

## Step 6 — Verdict: **REFRAME. Then spec it.**

**Nothing found here kills the tour.** Q3 and Q4 came back stronger than the premise
assumed: the continuous universe→Earth descent is not new work, it is a *shipped,
CI-gated* code path (`flythrough-descent.ts` + `flythrough3-path.json`), and the
coordinate system is f64-per-context with a floating origin that makes the multi-order
descent a non-issue. "New continuous-camera work needed" is **killed**.

The reframe is Q1's redirect condition firing exactly as written. The premise was "the one
asset I'm missing is a procedural universe of galaxy-points." Measured, the missing piece
is **two** pieces, and the smaller one was invisible from outside: **a user cannot reach
universe context at all** — `ownGalaxyContext` (controller.ts:800) makes the galaxy→universe
exit dead code in the booted app, confirmed by parking a production-configured controller
at 10× the exit gate and observing `contextId = 'galaxy'`, zero switch events. The HUD
already advertises the UNIVERSE segment it cannot deliver. So the real shape of the work
is: **(1) unblock the ascent, (2) render + make selectable the galaxy-point field,
(3) compose the tour on the descent runner that already exists.** That ordering is
different from the one in the request, and (1) is a precondition for (2) being reachable
by anyone but a probe.

**Ordered list for the next few days:**

1. **N1 — unblock galaxy→universe ascent** (S). The only true blocker on the tour path.
2. **TASK-072 — boot-tier detection + pixel-ratio cap** (M). The hardware floor's
   first-seconds problem, structurally confirmed present (`initialQualityTier="high"` +
   `high: Infinity` procgen cap). Do this before the point field multiplies what's on
   screen up there.
3. **N5 — run the M1 playbook** (integrated-gpu-targeting.md §5, ~10 min on your Mac).
   Converts the only unanswered question into a number, and recalibrates 072's tier table.
4. **N3 — point the CF Pages build at the real Gaia pack** (S, config).
   Blocks an HN launch on honesty grounds; independent of everything above.
5. Then spec the tour. **N4 (touch), TASK-063, 070, 073/075, 078, BUG-10 P1 all defer.**

**Claims a spec writer should lift into Step 0:** Q3's four claims (the descent runner
exists and is gated; switches are pure reconversions with a continuity guard; splines
survive switches; today's tour is deliberately galaxy-only), Q4's precision claim, Q1's
"12 generated / 0 rendered" and "ascent is dead code", and Q5's live pack counts.

**Do not put a frame budget in the tour spec** until item 3 produces a number — Q2's
absence is the one place where writing a confident sentence would be inventing evidence.
