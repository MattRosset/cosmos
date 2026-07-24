# Root-cause — the boot-perf "3.1 s" and the fly-in "~65 ms" stalls have **different
causes** and do **not** share a mechanism

Two symptoms, both reported (task framing) as M1/ANGLE-Metal-only and assumed to be
synchronous GPU shader compile on first use. **Both parts of that framing turned out to be
wrong**, and in different ways — and pinning it required reproducing each symptom in the
*exact* configuration it occurs in, not a plausible proxy.

- **(A)** A single ~3.14 s frame during **cold boot** that trips the blocking boot-perf
  gate (`e2e/tests/boot-perf.spec.ts`, `maxFrame < 1000 ms`).
- **(B)** An intermittent ~65 ms frame during the **galaxy↔star-field breadcrumb fly-in**
  (~2 of 3 transitions).

**Verdict up front — the two symptoms are unrelated:**

- **A is a SwiftShader artifact, not a Metal/app cost.** The boot-perf gate runs under
  `--use-angle=swiftshader` (software GL). The 3.14 s frame is **`canvas.getContext('webgl2')`**
  — the WebGL2 context creation inside three.js's `WebGLRenderer` constructor at `<Canvas>`
  mount — which takes **~2.8 s under SwiftShader's software device init** and **3 ms on
  real Metal (M1)**. Directly measured, both backends, same build. It is **not** Morton,
  **not** shader compile, **not** texture upload, and **does not occur on real hardware.**
- **B is a real Metal main-thread cost — BigInt Morton-key work.** The app's own per-span
  profiler (`?debug=breadcrumb-profile`) attributes the fly-in long frames almost entirely
  to **`streaming.update` (70–73 ms of a ~72 ms frame, 4/4 runs)** — the streaming-policy
  pass, which the call-tree shows is BigInt `spread3`/`compact3` Morton encode/decode
  (`packages/core-types/src/octree.ts`). `galaxy.render` ≈ 0.1 ms, `galaxy.mountOctree`
  ≈ 0.4 ms; geometry rebuild and shader first-use are **not** significant (CLAIM 2).
- **A and B do NOT share a cause.** A is SwiftShader context init (gone on Metal); B is
  Metal-resident Morton BigInt. The Morton fix below addresses **B only**.

**Fixes, by symptom:**

- **B (real):** replace the per-bit BigInt `spread3`/`compact3` with 32-bit-lane `Number`
  bit math (valid to level 17; repo cap is `MAX_OCTREE_LEVEL = 16`). Measured **65.9×
  speedup, bit-exact** over 200 k random round-trips. This also reduces the ~86 ms boot
  Morton frames on both backends. It does **not** touch A's 2.8 s `getContext` frame.
- **A (SwiftShader gate artifact):** there is **nothing app-side to speed up** — software
  device init is inherent to SwiftShader. The gate is measuring a one-time context-init
  cost that is 3 ms on the hardware every real user runs. Per the repo's own testing
  doctrine (CLAUDE.md rule 4: wall-clock perf is reference-machine-only), the honest fix is
  to stop the gate from counting the one-time init frame (e.g. measure steady-state *after*
  `__cosmos.ready`, or scope the boot budget to a real-GPU reference run) — **without**
  changing the 1000 ms threshold. See "Verdict and levers." This is an **open decision for
  the owner**, flagged rather than executed.

---

## How this was measured (reproduction + instrumentation)

- Build with the dense pack and serve, exactly as the task specifies:
  `VITE_GAIA_OCTREE_MANIFEST_URL=/packs/octree-gaia/octree.json pnpm --filter @cosmos/web build`
  then `pnpm --filter @cosmos/web preview --port 4173`. Confirmed the baked manifest and
  1267-tile dense pack are served.
- **Two configurations, deliberately** — this is the crux of the whole investigation:
  - **Headed Chromium with the real GPU** (no flag) → `renderer = ANGLE Metal Renderer:
    Apple M1`, `KHR_parallel_shader_compile = true`. This is what real users run and where
    **B** lives.
  - **Headless Chromium with `--use-angle=swiftshader`** → `renderer = SwiftShader Device
    (LLVM 10.0.0)`, `KHR_parallel_shader_compile = false`. This is exactly what the
    boot-perf gate runs, and it is the *only* config that reproduces **A**.
  - **Lesson (logged):** the first pass measured only headed-Metal and concluded A was
    Morton. Reproducing A required running the gate's *actual* config, not a plausible
    proxy. Measure the failing configuration, not one that resembles it.
- Instrumentation, installed via `addInitScript` **before any page script** so first-use
  boot compiles are captured:
  1. **GL wrapper** on the `WebGL2RenderingContext` prototype — timing +
     byte-accounting for `compileShader` / `linkProgram` / `getProgramParameter` /
     `getProgram|ShaderInfoLog` / `bufferData` / `tex*` / uniform+attrib location fetch /
     `useProgram` / draws / `finish` / `flush`, plus rAF frame deltas.
  2. **CDP `Profiler`** (80 µs sampling) → per-frame split of **JS self-time** vs
     **idle/native**, with the app's minified frames resolved back to source via the
     shipped `.map` sourcemaps.
  3. **Cold-shader forcing** without a rebuild: patch `shaderSource` to append a
     per-run unique nonce comment to every shader → every program is an ANGLE-Metal cache
     miss → deterministic cold pipeline compile.
- Instruments used: **GL wrapper** on `WebGL2RenderingContext` (+ `HTMLCanvasElement`'s
  `getContext`), **CDP `Profiler`** (80 µs) with sourcemap resolution + structural
  call-tree (parent/child, alignment-free — the reliable cross-check when per-frame time
  alignment is suspect), the app's **own `?debug=breadcrumb-profile`** per-span profiler
  (ground truth for A's Metal frames and all of B), and **`shaderSource`-nonce** cold-shader
  forcing. Scripts in the scratchpad (`gl-probe*.mjs`, `probe-getcontext.mjs`,
  `boot-profile.mjs`, `breadcrumb-profile.mjs`, `resolve.mjs`, `tree*.mjs`,
  `bench-morton.mjs`); raw captures alongside.

> Note on the "3.14 s vs my ~90 ms" gap: that gap is **not** thermal/warm-cache — it is the
> backend. A's 3.14 s is SwiftShader `getContext` (2.8 s here too, once the *right* config
> is run); on Metal that frame is 3 ms and the largest boot frame is ~90 ms of Morton. The
> earlier draft's "CPU-scaling, consistent with a 6× colder machine" reasoning was wrong —
> it was comparing two different backends, not two thermal states.

---

## CLAIM 1 — Symptom A (the boot-perf gate trip) is `canvas.getContext('webgl2')` under SwiftShader, not any app cost

> **Correction (supersedes an earlier draft of this claim).** The first pass concluded "A
> is main-thread BigInt Morton work," measured on **headed Metal** — the wrong
> configuration. The boot-perf gate runs under **SwiftShader**, and reproducing the gate in
> *that* config reveals a different cause. The Morton finding is real but is a ~86 ms boot
> cost, **not** the 3.14 s gate frame. Retained as CLAIM 1b below because it is still true
> and relevant to B; the gate trip is CLAIM 1a.

### 1a — What actually trips the gate (measured in the gate's own config)

**EVIDENCE**

- **Reproduced the gate.** `pnpm exec playwright test boot-perf --project=chromium` against
  the dense-pack preview server → `maxFrame = 2849.9 ms` (fails `< 1000 ms`), same class as
  the reported 3.14 s (machine/run variance). The chromium project forces
  `args: ['--use-angle=swiftshader']` (`e2e/playwright.config.ts:79`), so the gate is
  **software GL**, not Metal.
- **Located the frame.** Boot under SwiftShader with the CDP profiler + sourcemaps: the
  gate frame is `frame#11 = 3020.9 ms`, `JS 2999 ms`, dominated by a **single native leaf**
  `Me` (2963 ms, no JS children) whose call-tree ancestry is
  `Me ← WebGLRenderer constructor (three.module.js:16010) ← R3F configure ← react-dom
  mount`. (The sourcemap *line* for `Me` mis-maps — as it did for a vendor node in B — so
  identity was established structurally, not by line.)
- **Identified `Me` directly.** Wrapping `HTMLCanvasElement.prototype.getContext` and
  timing it, same build, both backends:

  | backend | `getContext('webgl2')` (the renderer's context) |
  |--------|--------------------------------------------------|
  | **SwiftShader** (the gate) | **2804.6 ms** |
  | **Metal (M1)** (real users) | **3.0 ms** |

  So `Me` is `canvas.getContext('webgl2')` — WebGL2 context / software-device creation in
  the three.js `WebGLRenderer` constructor at `<Canvas>` mount. It is a one-time cost at
  `t ≈ 312 ms`, **before** any octree tile loads (so it is pack-independent), and it is
  ~935× cheaper on the hardware every real user runs.

**Mechanism.** SwiftShader is a software Vulkan/LLVM implementation; creating the WebGL2
context spins up that software device synchronously on the main thread. three.js does this
inside `new WebGLRenderer()`, which R3F calls once during the initial `<Canvas>` mount, so
the whole ~2.8 s lands in one rAF frame. The boot-perf gate samples rAF deltas from
navigation and takes the max, so this init frame is what it reports. On real Metal the same
context creation is 3 ms and never appears.

**This is a CI/software-GL artifact, not an app or Metal regression.** Nothing in the app
scales it (it is pack-independent and pre-`ready`), and there is no app lever that makes
SwiftShader init faster.

**RECHECK**
- `pnpm exec playwright test boot-perf` (from `e2e/`) reproduces `maxFrame` ≫ 1000 ms.
- `SWIFTSHADER=1 node probe-getcontext.mjs` vs `node probe-getcontext.mjs` — the renderer's
  `getContext('webgl2')` must be ~seconds under SwiftShader and single-digit ms on Metal.
  If SwiftShader `getContext` ever drops to ms, re-open (something else moved).

### 1b — The real (but smaller) boot cost on Metal: Morton, same as B

The Metal-headed investigation was the wrong config for the *gate*, but it did correctly
find the largest **main-thread** boot cost, which matters for real users and is shared with
B: BigInt Morton. On Metal the slow boot frames are JS-bound (`gl-probe-cpu.mjs boot`,
sourcemap-resolved):

| frame | dt | JS self | idle/native | top resolved self-time |
|------|------|--------|-------------|------------------------|
| #15 | 95.2 ms | **84.3 ms** | 10.9 ms | `spread3`+`compact3` 50.9 ms (octree.ts:25/34) |
| #16 | 55.6 ms | **50.7 ms** | 5.0 ms | `spread3`+`compact3` 36.0 ms |

Whole-boot top self-time: `compact3` 1543 ms + `spread3` 1531 ms combined, spread across
frames as tiles stream in. The app's own per-span profiler (`boot-profile.mjs`, 3/3 runs)
confirms these frames are **`streaming.update` 70–79 ms** with `galaxy.render` /
`mountOctree` sub-ms — the same span and mechanism as B (CLAIM 2). `MortonKey` is a
**string** (`"<level>/<decimal>"`); the policy round-trips `decode → parentCell → encode`
per step, each running a 21-iteration BigInt bit-shuffle. Fixing it (CLAIM 3) drops these
boot frames too, but on Metal they are ~86 ms, not the gate's 2.8 s — so **the Morton fix
does not make the boot-perf gate pass.**

**RECHECK (1b)** — `node boot-profile.mjs 3`: slow boot frames dominated by
`streaming.update`; `SWIFTSHADER=1 node gl-probe.mjs boot` shows the ~2.8 s frame is *not*
`streaming.update`-shaped (it is the pre-stream `getContext` frame).

---

## CLAIM 2 — Symptom B is main-thread `streaming.update`/Morton (same cost as the *Metal boot* frames in 1b, not A's gate frame) (corrected)

> **Correction (supersedes an earlier draft of this claim).** The first pass called B "a
> mix — Morton + a `computeBoundingSphere` geometry rebuild + a rare ~210 ms shader
> first-use tail," resting on CDP-profiler per-frame attribution. Two of those three
> sub-claims did **not** survive ground-truth measurement and are **retracted**. The
> geometry and shader-tail attributions were CPU-profiler **analysis artifacts** — see
> the artifact note below. B's dominant cost is `streaming.update` (Morton) — the same
> pass as the Metal boot Morton frames (CLAIM 1b), **not** A's SwiftShader gate frame (1a).

**EVIDENCE — the app's own per-span profiler (ground truth, no clock alignment)**

Run with `?debug=breadcrumb-profile`; `window.__breadcrumbProfile` records every frame
> 50 ms with per-`profileSpan` breakdown. Breadcrumb ◂ Milky Way → ◂ Galaxy, **4/4 runs**:

| run | slow frame | total | dominant span | galaxy.render | galaxy.mountOctree |
|----|-----------|-------|---------------|---------------|--------------------|
| 1 | post-arrival | 74.4 ms | **streaming.update 73.0 ms** | 0.1 ms | – |
| 2 | post-arrival | 72.8 ms | **streaming.update 71.1 ms** | 0.1 ms | – |
| 3 | post-arrival | 72.2 ms | **streaming.update 70.8 ms** | 0.1 ms | 0.4 ms |
| 4 | post-arrival | 72.2 ms | **streaming.update 70.8 ms** | 0.1 ms | – |

Every fly-in long frame is ~98 % `streaming.update` — the `useFrame` streaming-policy
pass (`GalaxyScene.tsx:434` → `policy.ts`), which the call-tree (below) shows is Morton
BigInt. `galaxy.render` (the flush + draw span) and `galaxy.mountOctree` (geometry
build/upload) are **sub-millisecond**. These frames carry `goToActive = false, distPc =
0`: they land **just after arrival**, when the policy re-evaluates the whole newly-arrived
cut — the breadcrumb's massive view change is what makes this `streaming.update` spike.

**Call-tree confirmation (structural, alignment-free).** In the saved fly-in CDP profile,
the hot leaves `nt`/`tt` (`octree.ts:34`/`:25` = `compact3`/`spread3`) have this ancestry:
`compact3/spread3 ← octree.ts:52/43 ← policy.ts:261/544/596/663 ← GalaxyScene.tsx:434
(streaming.update) ← SceneHost useFrame`. So the per-frame policy pass **is** the Morton
BigInt cost — identical to A's hot path.

**Artifact note (why the earlier "210 ms shader" and "geometry rebuild" were wrong).** The
earlier per-frame numbers came from `resolve.mjs`, which (a) end-anchored the monotonic
CDP clock to `performance.now` — a fragile constant-offset guess — and (b) keyed self-time
by *resolved source label*, so many distinct minified functions that map to the same
`three.module.js` line were **summed under one label**. Re-checked structurally: the only
real `C @ three.module.js:7090` node has **108 samples ≈ 8.6 ms** (not 210 ms) and sits
under `getUniforms → renderBufferDirect` on the **normal render path**, not a blocking
first-use compile. The "253 ms frame" in that one run is real (rAF is ground truth) but
its decomposition into "210 ms shader / geometry" was an analysis artifact; nothing in the
app's own per-span instrument supports a geometry or shader cause for B.

**Honest residual.** Today's `breadcrumb-profile` runs maxed at ~73 ms and did **not**
re-catch the ~253 ms outlier from the earlier CPU run, so that single outlier is not
decomposed by the ground-truth instrument. What is established: (1) the *typical* fly-in
long frame is `streaming.update`/Morton (4/4), and (2) the specific 210 ms shader
attribution was an artifact. If a future run reproduces a ≥200 ms fly-in frame, capture it
under `?debug=breadcrumb-profile` (not the CPU-profiler alignment path) to decompose it.

**Mechanism.** Same as the Metal boot Morton frames (1b): the streaming policy round-trips octree keys through the
**string** `MortonKey` (`decode → parentCell → encode`), each call running a 21-iteration
BigInt bit-shuffle. Boot pays it for the initial cut; the breadcrumb pays it again when
the cut is re-evaluated after the view jumps galaxy↔star-field.

**RECHECK**
- `node breadcrumb-profile.mjs 4` — every fly-in long frame must be dominated by
  `streaming.update`, with `galaxy.render`/`galaxy.mountOctree` sub-millisecond. If
  geometry or render spans ever dominate a slow fly-in frame, re-open this claim.
- After the Morton `Number` swap (CLAIM 3), `streaming.update` on the same transition
  should drop from ~72 ms toward single digits.

---

## CLAIM 3 — The BigInt→Number Morton swap is a 65.9×, bit-exact lever (the fix for B)

**EVIDENCE** (`bench-morton.mjs`, this machine, Node 24)

- Current per-bit BigInt `encode+decode`, 2 M pairs: **10 467 ms** (0.19 M/s).
- 32-bit-lane `Number` implementation (`part1by2`/`compact1by2` magic masks, 48-bit code
  carried as an exact `Number` via a `2^24` split): **159 ms** (12.55 M/s).
- **Speedup 65.7×**, and **bit-exact**: 200 000 random `(ix,iy,iz)` in `[0, 2^16)`
  round-tripped through both encode and decode with **0 mismatches**.
- Exactness holds for `3 × level` bits ≤ 53 ⇒ level ≤ 17. Repo cap is
  `MAX_OCTREE_LEVEL = 16`, so the `Number` path is exact with one level of margin; a fix
  should assert/guard `level ≤ 17` (or fall back to BigInt above it).

**RECHECK** — re-run `bench-morton.mjs`; require the equivalence line to read
`OK (200k round-trips exact)` and speedup ≳ 20× before trusting the swap.
*(Re-verified after CLAIM 2's correction: equivalence `PASS`, BigInt 10 439 ms vs Number
158 ms → **65.9×**, consistent with the 65.7× first pass within run-to-run variance.)*

---

## Verdict and levers (by symptom — they are separate)

**B — fly-in ~65 ms (real Metal cost). Fixable, high confidence.**
1. **Replace BigInt `spread3`/`compact3` with the 32-bit-lane `Number` implementation**
   (`packages/core-types/src/octree.ts`). Attacks B's dominant cost — the ~72 ms
   `streaming.update` Morton pass — and the ~86 ms Metal boot Morton frames. Bit-exact,
   ~65.9×. Expected to bring the fly-in frame back under the 150 ms breadcrumb gate.
   *Verify by re-measuring* `breadcrumb-profile.mjs` after the swap, not by assuming 65×:
   the swap cheapens the Morton *math*, not the surrounding string/`Map` round-trip.
   *Secondary, same file:* the policy round-trips the **string** key
   (`decode → parentCell → encode`); carrying `OctreeCell`/numeric keys removes the
   round-trip entirely — a follow-up *only if* the `Number` swap leaves a residual.

**A — boot-perf gate 3.14 s (SwiftShader artifact). Not an app fix; an owner decision.**
2. **There is nothing app-side to speed up.** A is `getContext('webgl2')` = 2.8 s under
   SwiftShader / 3 ms on Metal, pack-independent, pre-`ready`. The Morton swap does **not**
   touch it. The gate is counting a one-time software-device-init frame that never occurs
   on the hardware real users run.
3. **The honest options (owner picks — flagged, not executed):**
   - **Exclude the one-time init from the boot budget** — measure `maxFrame` over samples
     **after `__cosmos.ready`** (steady-state), so the gate still catches a real boot hang
     but not SwiftShader's device init. This keeps the 1000 ms threshold; it changes *what
     window is measured*, which is a different thing from "raising the threshold."
   - **Or scope the boot budget to a reference/real-GPU run** (consistent with CLAUDE.md
     rule 4: wall-clock perf is reference-machine-only), leaving SwiftShader for
     correctness/work-budget gates only.
   - Either way this belongs in a **separate, reviewed change** — never weaken/retune a
     gate in the same PR whose purpose is to make it pass.

**Not the fix (explicitly):** raising `boot-perf.spec.ts`'s `maxFrame` threshold, and
shipping the Morton swap as if it fixes the gate (it does not).

## What would have caught this earlier

- The boot-perf gate measures `maxFrame` from navigation under **SwiftShader**, so it
  inevitably counts SwiftShader's ~2.8 s one-time `getContext` init as a "boot stall" — an
  environment cost, not an app regression. Measuring steady-state after `ready` (or gating
  wall-clock only on the reference machine) would have kept this out of the gate.
- The Metal-side Morton cost (B, and the ~86 ms boot frames) would have been caught by a
  `@perf` (reference-only) probe that loads the dense pack on the real GPU and asserts
  Morton encode/decode throughput — the `bench-morton.mjs` equivalence+speed test flags the
  BigInt per-bit loop as a hot-path liability directly.
- **Process lesson:** two conclusions in this investigation were overturned by measuring
  the *real* configuration instead of a proxy — B's "shader tail" (CPU-profiler artifact →
  app's own per-span profiler) and A's "Morton" (headed Metal → the gate's SwiftShader).
  When a symptom is defined by a specific harness/backend, reproduce it *there* first.
- A micro-benchmark asserting Morton encode/decode throughput (the `bench-morton.mjs`
  equivalence+speed test) would have flagged the BigInt per-bit loop as a hot-path
  liability the day it was written.
