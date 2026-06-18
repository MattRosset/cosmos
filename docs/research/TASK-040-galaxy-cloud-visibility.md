# Research / handoff: the "Milky Way" galaxy view shows no galaxy

**Status:** **resolved** (RC1–RC3 fixed; visual tuning landed in two commits on
`task-040-galaxy-view`). This doc remains as investigation handoff + tuning reference.
**Owner of this doc:** cold-start brief — assume the reader has **no** prior context.
**Supersedes:** the previous version of this doc, whose root-cause theory (§"brightness
underflow") was **disproven** by live testing. See §4 for what was actually happening.
**See also:** breadcrumb **freeze** (main-thread stall, not visual) —
[`TASK-040-breadcrumb-freeze.md`](TASK-040-breadcrumb-freeze.md).

---

## 1. One-paragraph problem statement

In the M3 build (`apps/web`, TASK-040), clicking the top-left **"◂ Milky Way"**
breadcrumb flies the camera out to a galaxy vantage (~49 kpc from the disc). The user
expects to see the Milky Way as a **bright spiral star cloud**. Instead they see only a
**faint blue "string of beads" spiral** (the dust-lane billboards) over black — *"no veo
que parezca una galaxia"* (it doesn't look like a galaxy). The 1,000,000-point procedural
**star cloud never renders**, and the **dust lanes that DO render cannot be turned off or
faded**. This is the last blocking visual issue for M3.

---

## 2. Verified root causes (read this section carefully)

There are **three independent defects**. The previous doc blamed per-star magnitude
"brightness/size underflow"; **that is wrong** — when the cloud is actually given a
nonzero opacity it renders *blindingly over-bright* (see §4, screenshot evidence). The
real causes are:

### RC1 — `cloudFactor` is always 0 at the vantage → the star cloud is never shown (PRIMARY)

`apps/web/src/scene/GalaxyScene.tsx`, the procgen mount's `applyFrame`:

```ts
const cloudFactor = smoothstep(LOD_IMPOSTOR_FULL, LOD_CLOUD_FULL, lod); // smoothstep(6, 2, lod)
cloud.setOpacity(opacity * cloudFactor);                 // cloud
lanes.setOpacity(opacity * cloudFactor * DUST_MAX_OPACITY); // dust
impostor.setOpacity(opacity * (1 - cloudFactor));        // impostor
```

The local `smoothstep` helper (top of the file) does **not** support a reversed range
(`lo > hi`):

```ts
function smoothstep(lo: number, hi: number, x: number): number {
  if (hi <= lo) return x >= hi ? 1 : 0;   // <-- BUG: reversed range collapses to a step
  ...
}
```

It's called with `lo = LOD_IMPOSTOR_FULL = 6`, `hi = LOD_CLOUD_FULL = 2`. Because
`hi (2) <= lo (6)`, the guard fires and returns the **step** `x >= 2 ? 1 : 0`, i.e.
`cloudFactor = (lod >= 2 ? 1 : 0)`.

The streaming policy makes the galaxy chunk's `lod` **small when the galaxy is large on
screen** (`packages/streaming/src/policy.ts:411`,
`lod = floor(log2(1024 / pixelExtent))`). At the "Milky Way" vantage the disc fills much
of the viewport, so **`lod` is 0–1** (measured live: 0 mid-flight, 1 at arrival).
`lod 0–1 → cloudFactor = 0`. Therefore:

- **cloud opacity = 0** → the 1M-star cloud is invisible.
- **dust opacity = 0** → (but dust renders anyway — see RC2).
- **impostor opacity = `opacity·(1-0)` = full** → only the faint impostor glow is "on".

The intent was the opposite: at fine/low LOD show the **cloud** (full detail), at
coarse/high LOD fade to the **impostor**. A correct reversed `smoothstep(6, 2, lod)`
would give `cloudFactor ≈ 1` at `lod ≤ 2` and `0` at `lod ≥ 6`. The broken guard inverts
the near-end behaviour, hiding the cloud exactly when it should be shown.

### RC2 — dust lanes ignore `uOpacity` (MultiplyBlending reads RGB, not alpha) (SECONDARY)

`packages/render-galaxy/src/dust-lanes.ts` uses `THREE.MultiplyBlending`
(`blendSrc = ZERO`, `blendDst = SRC_COLOR`). The fragment shader
(`shaders/dust.frag.glsl.ts`) puts opacity only in the **alpha** channel:

```glsl
gl_FragColor = vec4(tex.rgb, tex.a * uOpacity);
```

Under MultiplyBlending the result is `dst.rgb * src.rgb`; **alpha is never used**. So
`setOpacity()` has *no effect* on the dust lanes — they cannot be faded or hidden by
opacity. Confirmed live: with `uOpacity = 0` the dust beads still render; isolating the
scene to the dust mesh alone still shows the full beaded spiral. This is why the dust is
"the only visible thing": RC1 zeroes everyone's opacity, but RC2 makes the dust render
regardless. (The visible blue tint comes from canvas-texture premultiplied-alpha
artifacts at the sprite's faint edges — a side detail, not the core bug.)

Note line 116/183-189 of `GalaxyScene.tsx` already tries to work around this by toggling
`object.visible` instead of opacity for the **hide** path — that part works (off-cut and
near-Sol the dust is correctly hidden). But on the *visible* path RC2 means the dust
cannot be dimmed/cross-faded; it's all-or-nothing.

### RC3 — `CLOUD_EXPOSURE_BOOST` is wildly miscalibrated (over-bright, not under) (TUNING)

`GalaxyScene.tsx`: `const CLOUD_EXPOSURE_BOOST = 5e10;` → the cloud's `uExposure` is
`exposure · 5e10 ≈ 1.25e12`. When the cloud is forced visible at this exposure it renders
as a **solid blown-out white disc** (pure white core, only the rim stars show colour) —
see §4. This value was cranked up by the previous investigator chasing the (wrong)
"underflow" theory; because RC1 kept the cloud invisible, nobody ever saw that the
exposure is now ~5–7 orders of magnitude too high. Once RC1 is fixed, this MUST be
re-tuned down to a value that yields a spiral with visible arms + core, not a white blob.

---

## 3. How to reproduce

1. `pnpm --filter @cosmos/web dev` (or the Claude preview `web` config in
   `.claude/launch.json`), open `http://localhost:5173/`. Boots in **galaxy** context near
   Sol (a bright Sol glow + scattered HYG stars — this part is correct).
2. Click the top-left **"◂ Milky Way"** breadcrumb. Camera flies out (~5 s real; **much
   slower & may stop short in the headless preview — see §6**).
3. Observe: faint blue beaded spiral (dust), **no star cloud**, no bright galaxy.

`window.__cosmos.streaming` reports `{ renderedPoints: 1000000, loadedChunks: 1,
drawCalls: 1 }` throughout — the data + streaming are fine. The defect is purely in the
**visible-opacity / blending** layer described in §2.

---

## 4. Evidence (live instrumentation, this session)

A temporary debug probe was added to `applyFrame` and to the page (since removed) to read
the live Three.js objects. Findings at the arrival vantage (`lod = 1`, `layerFade = 1`):

| Quantity | Value | Meaning |
|---|---|---|
| `cloudFactor` | **0** | RC1 — cloud + dust opacity forced to 0 |
| cloud `uOpacity` | 0 | cloud invisible |
| dust `uOpacity` | 0 | …yet dust still renders (RC2) |
| impostor `uOpacity` | ≈ `layerFade` | only the impostor is "on" |
| cloud `uExposure` | 1.25e12 | RC3 — absurdly high |
| cloud computed `gl_PointSize` | ~3.5 px | **not** sub-pixel (disproves old "size underflow") |

Three decisive screenshots were captured:

- **Detach cloud+impostor, keep only dust** → the beaded spiral still appears →
  **proves RC2** (dust renders with `uOpacity = 0`).
- **Force cloud `uOpacity = 1` via `setInterval`** → still black → *inconclusive*: the
  offscreen preview throttles timers, so `applyFrame` kept winning the race and re-zeroing
  it.
- **Lock cloud `uOpacity` to 1 with an `Object.defineProperty` getter** (so `applyFrame`
  can't reset it) → the cloud renders as a **blinding solid-white disc** with coloured
  stars only at the rim → **proves RC1** (cloud renders fine once given opacity) **and
  RC3** (exposure far too high).

The old doc's §4 ("apparentMag ≈ 23 → brightness ~1e-9 → invisible; gl_PointSize sub-pixel
→ culled") is therefore **false for the current tuned values**: point size is ~3.5 px and
brightness saturates. Do not pursue the underflow theory.

---

## 5. Recommended fix (in priority order)

The fix is almost entirely **composition-side** (`apps/web`), with one optional
frozen-package change for RC2.

1. **RC1 — make the cloud↔impostor cross-fade correct.** Either fix `smoothstep` to handle
   a reversed range, or (cleaner) keep `smoothstep` monotonic and invert at the call site,
   e.g. `const cloudFactor = 1 - smoothstep(LOD_CLOUD_FULL, LOD_IMPOSTOR_FULL, lod);`
   so `cloudFactor ≈ 1` for `lod ≤ 2` and `0` for `lod ≥ 6`. Verify `cloudFactor ≈ 1` at
   the vantage afterwards. **This alone makes the star cloud appear.** (Re-check that the
   helper's other callers — the `layerFade` band, which uses a normal `lo < hi` range — are
   unaffected; they are, but confirm.)

2. **RC3 — re-tune `CLOUD_EXPOSURE_BOOST`.** With RC1 fixed, lower it until the disc reads
   as a spiral galaxy with a bright-but-not-clipped core and visibly distinct arms (start
   by dropping several orders of magnitude — e.g. try `1e5`–`1e7` — and tune by eye in a
   **real foreground browser**, not the throttled preview). Note the exposure that looks
   right is mildly distance-dependent; a fixed constant tuned at the vantage is acceptable
   for M3 since `layerFade` fades the layer out before the camera gets close.

3. **RC2 — make the dust respect opacity.** Two options:
   - *Composition-only workaround:* gate the dust purely by `object.visible` (it already is
     on the hide path) and accept it as binary on/off, OR drive the dust's perceived
     strength some other way. But you still cannot **cross-fade** it, which looks abrupt.
   - *Proper fix (frozen-package, preferred):* in `render-galaxy` dust shader/material, make
     `uOpacity` actually modulate the multiply strength — e.g. `mix(vec3(1.0), tex.rgb,
     tex.a * uOpacity)` so `uOpacity → 0` becomes multiply-by-white (a true no-op / fully
     faded), and premultiply correctly. Land this as its **own separate, reviewed,
     test-backed commit** per the repo's frozen-package convention (see
     `memory/frozen-package-defects.md`; precedents: `4ae0d18`, `ea78e29`). Keep default
     behaviour backward-compatible for M1/M2.

**Acceptance:** from the "Milky Way" vantage in a real browser, the Milky Way reads as a
bright **spiral star cloud** (arms + core), dust lanes a subtle darkening that fades with
the layer, no white-out, near-Sol galaxy view + m2 baselines unchanged, no console errors,
`pnpm verify` green.

---

## 6. Test-harness caveats (cost the previous investigator a lot of time)

- **The Claude headless preview throttles `requestAnimationFrame` AND `setInterval`.** The
  fly-out takes 30–60 s and may **end short** of 49 kpc (observed ~28 kpc) because the
  goTo is `durationMs`-bounded; `layerFade` is already 1 by then so the symptom still shows.
  Timer-based "force a uniform every frame" hacks lose the race with the frame loop — use
  `Object.defineProperty` to lock a uniform instead (as in §4). **Always confirm final
  tuning in a real foreground browser tab.**
- **HMR breaks the streaming subscription.** `GalaxyScene` subscribes to
  `streaming.onChunk` in an effect; on HMR the component re-subscribes *after* the procgen
  chunk's `ready` event already fired, so the new instance never creates the mount and the
  whole galaxy layer vanishes (black screen) even though `streaming.stats` still reports it
  rendered. **After any edit to `GalaxyScene.tsx`, do a full page reload** before judging
  the result, then re-click "Milky Way".
- R3F v9 does **not** expose the store on `canvas.__r3f`, and the store is not reachable by
  walking the canvas DOM fiber (separate reconciler). To inspect the live scene, publish
  the objects to `window` from inside `GalaxyScene` (temporary), as was done here.

---

## 7. What already works (do NOT re-investigate)

- Boot in galaxy near Sol; Sol + HYG field render correctly (this is M2, untouched).
- "Milky Way" / "Galaxy" breadcrumb fly-out / descend (`goto.ts` `viewGalaxy()` /
  `enterGalaxy()`), context stays `galaxy` (by design — see §8).
- Streaming generates the 1M-star cloud + octree tiles (1 draw call); spiral geometry /
  placement is correct (dust traces the arms; cloud shares the same render offset).
- Console is clean. The off-cut / near-Sol **hide** path (via `object.visible`) works.

---

## 8. Constraints & design context (keep the fix in bounds)

- **TASK-040 is "composition only":** prefer fixing in `apps/web`. RC1 and RC3 are both
  app-side. RC2's proper fix is a `render-galaxy` change → land as its own reviewed+tested
  commit (frozen-package convention).
- **M1/M2 must stay green.** `e2e/tests/m2.spec.ts` asserts boot in `galaxy` context and
  has screenshot baselines. The galaxy layer is gated to be **inert near Sol**
  (`GalaxyScene.tsx` `GAL_FADE_LO_PC = 18000` / `HI = 45000` + the `object.visible` hide).
  The fix must not make the layer appear near Sol. `render-galaxy` changes must be
  backward-compatible at their defaults.
- **Why the app views from *galaxy* context, not universe:**
  `packages/nav/src/controller.ts` only allows galaxy→universe exit when the camera
  *entered* galaxy from universe (`ownGalaxyContext`). The app boots in galaxy, so
  "Milky Way" flies to a far **galaxy-context** vantage where `layerFade` fades the layer
  in. Changing nav to allow the exit is a broader frozen-package change — avoid.

---

## 9. Key files & line refs

| File | Why it matters |
|---|---|
| `apps/web/src/scene/GalaxyScene.tsx` | **RC1** (`smoothstep` + `cloudFactor`, ~L69, L168-179), **RC3** (`CLOUD_EXPOSURE_BOOST`, L59). Mounts cloud/dust/impostor; `layerFade`; per-frame `applyFrame`. |
| `packages/render-galaxy/src/dust-lanes.ts` | **RC2** — MultiplyBlending material. |
| `packages/render-galaxy/src/shaders/dust.frag.glsl.ts` | **RC2** — `uOpacity` only in alpha, ignored by multiply. |
| `packages/render-galaxy/src/galaxy-points.ts` | Cloud renderer (`createGalaxyPoints`, `setExposure`, `setOpacity`); shaders confirm the cloud renders fine. |
| `packages/render-galaxy/src/impostor.ts` + `galaxy-assets.ts` | Impostor is a soft radial glow (not a spiral) — fine as the ultra-far LOD. |
| `packages/streaming/src/policy.ts:399-415` | `selectProcgen` → `lod = floor(log2(1024/pixelExtent))`; small at the vantage (0–1). |
| `apps/web/src/glue/goto.ts:255` | `viewGalaxy()` vantage (`GALAXY_VIEW_VANTAGE_PC = 55000`, `durationMs 5000`). |

---

## 10. Suggested first moves for the fixer

1. `pnpm --filter @cosmos/web dev`, open `/` in a **real foreground browser**, click
   "Milky Way", confirm the symptom at full frame rate.
2. Apply RC1 (fix the cross-fade). Reload, re-navigate, confirm the cloud now appears
   (it will be over-bright — that's expected, RC3 next).
3. Apply RC3 (re-tune exposure) until the spiral reads well.
4. Decide RC2 (binary visibility vs proper opacity fix); apply.
5. Verify near-Sol view unchanged, m2 baselines + `pnpm verify` green. Land any
   `render-galaxy` change as its own reviewed+tested commit.

---

## 10b. Secondary symptom: the fly-out looks choppy / "jumps" outward

The user also reports that when entering the "Milky Way" view the galaxy **recedes
slowly and choppily** — *"se aleja despacio… como un freeze, va saltando cada vez más
lejos, sin dar la impresión de smooth, bastante lagueado"* (it slowly moves away in
freezing jumps, not smooth, quite laggy). This is the intended ~5 s `viewGalaxy` pull-back
(`goto.ts`, `GALAXY_VIEW_DURATION_MS = 5000`, target z = 55 kpc, arrives ~49 kpc) being
rendered at a **low/uneven frame rate**, so the smooth recede reads as discrete steps.

**Ruled out by live instrumentation this session (do not re-chase these):**
- *Camera drift / infinite loop:* the goTo terminates cleanly — camera locks at exactly
  `z = 49000` and `goToActive` goes false; sampled 8× after arrival with zero drift. It is
  **not** a runaway/looping camera.
- *Streaming flapping:* `loadedChunks`, `drawCalls`, `inFlight`, `renderedPoints` are
  **constant** (`1 / 1 / 0 / 1000000`) for the entire flight — no mount/evict churn, no
  re-fetch, no React `setVersion` thrash.
- *Per-LOD regeneration:* crossing a procgen LOD does **not** regenerate the cloud — the
  procgen chunk is a single cached `gal{seed}:sec0` and `lod` does not feed the worker
  params (`policy.ts` `ensureProcgenChunk` / `dispatchChunk`). So LOD steps don't hitch.

**Leading hypothesis (for the fixer to confirm in a real browser):** frame-rate cost of
rasterising the **1,000,000-point cloud every frame**. Note that *right now* the cloud's
opacity is 0 (RC1), yet its vertex shader + point-sprite rasterisation still run for all 1M
points each frame; and once RC1/RC3 are fixed the cloud will actually shade (and, if RC3
isn't tuned down, blow out to full-screen white → massive overdraw → much worse). **Profile
FPS in a real foreground browser** (the Claude headless preview throttles rAF and cannot
measure real frame rate — see §6). Likely levers if perf is the cause: reduce the procgen
star count or point size at the far vantage, ensure the layer is cheap while faded, and
verify RC3's exposure doesn't cause whole-screen overdraw. Treat this as **lower priority
than RC1–RC3** (which are correctness); it may partly resolve once those are fixed and the
view is no longer a degenerate all-or-nothing impostor.

---

## 11. Resolution (landed)

### Correctness fixes (already in tree before visual tuning)

| RC | Fix | Where |
|---|---|---|
| RC1 | Inverted cloud↔impostor cross-fade: `cloudFactor = 1 - smoothstep(LOD_CLOUD_FULL, LOD_IMPOSTOR_FULL, lod)` | `GalaxyScene.tsx` |
| RC2 | Dust billboards → **AdditiveBlending**; opacity in fragment alpha (fades/hides cleanly) | `render-galaxy` dust shader + material |
| RC3 | `CLOUD_EXPOSURE_BOOST = 4e5` (was ~5e10; blew out to white disc) | `GalaxyScene.tsx` |

### Visual tuning (Tier 1 + Tier 2 lite)

**Composition (`apps/web`):**

- `milky-way-gen.ts` — shared procgen overrides: `armCount: 4`, `armContrast: 3.5`, `armWidthPc: 1400`.
- `galaxy-assets.ts` — jittered diffuse arm billboards; `buildHiiRegions()` (~88 magenta knots).
- `GalaxyScene.tsx` — `DUST_MAX_OPACITY = 0.1` (hint only); `HII_MAX_OPACITY = 0.38`; passes `milkyWayArmGeometry()` to cloud.

**Frozen package (`render-galaxy`):**

- Galaxy fragment shader: warm bulge → cool disc population tint by galactic radius.
- Galaxy fragment shader: ADR-004 dust-lane darkening on inner arm flank (`uDustStrength`).
- Dust billboards: `uGlowColor` uniform (blue arms, magenta HII).

**Acceptance (manual, real browser):** "◂ Milky Way" shows a four-arm spiral star cloud with warm
core, cool arms, subtle dark dust filaments, scattered pink HII knots; near-Sol view unchanged.

**Tuning knobs (quick reference):**

| Knob | Location | Current |
|---|---|---|
| Cloud exposure | `CLOUD_EXPOSURE_BOOST` | `4e5` |
| Arm hint glow | `DUST_MAX_OPACITY` | `0.1` |
| HII knots | `HII_MAX_OPACITY` | `0.38` |
| Shader dust | `milkyWayArmGeometry(dustStrength)` | `0.45` |
| Procgen arms | `MILKY_WAY_GEN_OVERRIDES` | 4 arms, contrast 3.5 |

**Not done (future tasks):** barred bulge, procgen arm irregularity, satellite-galaxy impostors.

---

## 12. Working-tree note

After the resolution commits, only `.claude/launch.json` may remain untracked (local preview config).
Full page reload required after `GalaxyScene.tsx` edits (HMR breaks streaming subscription — §6).
</content>
</invoke>
