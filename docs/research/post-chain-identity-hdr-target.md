# Research — the post-chain identity no-op requires an 8-bit composer target (not HDR)

**Status:** resolved (measured in the browser). Feeds TASK-104 §3 (identity) and TASK-106 (bloom).
**Author:** TASK-104 executor pass, 2026-09-07.
**Trigger:** TASK-104 step 1 requires the `<EffectComposer>` composite to be a **visual no-op**
(§3). During reference-machine verification the composite was NOT a no-op — the star field rendered
visibly brighter and crisper with the composer mounted. This doc records what was measured and why
the fix is `frameBufferType = UnsignedByteType`.

---

## What was measured (rule 2 — browser A/B, not theory)

Setup: `pnpm dev` (StarApp), default near-Sol vantage, scene settled, **full page reloads** between
states (HMR mid-reload gives transient frames — do not A/B on those). Composer toggled with the new
additive `SceneHostProps.postProcessing` prop on StarApp.

Confirmed inputs (via the `[post-chain] mount` log + `window.__cosmos`):
- `gl.toneMapping = 4` = `ACESFilmicToneMapping` — so the `<ToneMapping mode={ACES_FILMIC}>` operator
  is the correct 1:1 match (R3F default belief, now runtime-confirmed).
- `dpr = 1`, WebGL drawing-buffer == CSS size (1280×720) — resolution/DPR is NOT a factor.
- `exposure = 25` is an **app shader uniform** (`GalaxyScene.setExposure`, `cloud.setExposure(e*4e5)`),
  multiplied inside the star/cloud shaders **upstream of tone mapping** — identical in both render
  paths, so not a discriminator.

| State | Central star | Faint field | Verdict |
|-------|--------------|-------------|---------|
| composer OFF (`postProcessing={false}`, == pre-TASK-104) | soft, dim core | fewer/fainter stars | reference |
| composer ON, `frameBufferType`=HalfFloat (lib default) | **crisp, bright core** | **many more stars** | **≠ no-op** |
| composer ON, `frameBufferType`=UnsignedByteType (8-bit) | soft, dim core | matches OFF | **no-op ✓** |

## Root cause

The scene draws **additive star sprites** (overlapping point-sprite contributions summed with
additive blending). Framebuffer precision decides where that sum clamps:

- **Direct path (no composer):** additive accumulation happens in the renderer's **8-bit** output
  buffer with in-material tone mapping — bright cores saturate/clamp early ⇒ soft, and faint stacked
  contributions never cross the 8-bit floor ⇒ dimmer field.
- **Composer path, HalfFloat target:** the scene renders into a **linear HDR** buffer (the lib sets
  `gl.toneMapping = NoToneMapping` so the scene is linear), additive sums accumulate **unclamped**,
  then a single `ToneMappingEffect` (ACES) maps them ⇒ bright cores survive (crisp) and faint stacks
  become visible (brighter field). The ACES *operator* is identical; the *precision + clamp point*
  is not — so the image legitimately differs.

This is the classic "postprocessing is only identity for LDR scenes" gotcha: cosmos has genuine
HDR-additive content, so an HDR intermediate buffer is a visible change, not a no-op.

## Resolution

`EffectComposer frameBufferType={UnsignedByteType}` (8-bit). The composer's target then clamps the
additive accumulation exactly like the direct 8-bit path, and the browser A/B matches the
no-composer render at the near-Sol vantage. Identity (§3) is restored for step 1.

- The spec §2 preferred "frameBufferType: defaults", but §3 (identity) is load-bearing and overrides:
  "if they differ, §3 is unmet — fix before merge." Matching the direct path's precision is required.
- No gate, tier, threshold, or assertion changed. The deterministic e2e (smoke = StarApp at high with
  the composer; error-gate; m3 budgets) all pass with the 8-bit target — error-gate emits zero WebGL
  errors, so the double-nothing-composite is clean.

## Consequence for TASK-106 (selective bloom) — READ BEFORE step 3

Bloom (§5.11) blooms **bright** cores, which requires an **HDR (HalfFloat)** target for headroom.
TASK-106 must switch `frameBufferType` back to HalfFloat. At that point the brighter/crisper additive
cores measured above become the **intended visible change of the bloom step** — expected, not an
identity regression. The step-1 8-bit target is deliberately the LDR no-op foundation; the HDR
transition is owned by the bloom step, not this one.

## Open item (reference-machine, non-blocking)

Far Milky-Way **band** vantage A/B (composer 8-bit vs off): the same clamp mechanism applies, but an
8-bit *linear* intermediate can band in the faint nebula gradients (`CLOUD_EXPOSURE_BOOST=4e5`).
Confirm visually on the reference machine before merge. This dev box (Windows/RX-9070) renders ~3×
darker than the committed reference snapshots even at baseline, so absolute-brightness screenshot
matching is a reference-machine task regardless (CLAUDE.md rule 4).
