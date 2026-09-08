# Research — TASK-104's blocker measured: does the identity post-chain actually move the deterministic gates?

**Status:** resolved (measured). Reframes TASK-104 Step-0 item 3 from "STOP: composer perturbs
deterministic budget gates" to a narrower, executor-shaped mitigation.
**Author:** investigation pass, 2026-09-07.
**Trigger:** TASK-104 (post-processing chain foundation) Step-0 item 3 declares the composer-vs-probe
`gl.render` collision a **STOP / owner decision** because the high-tier probe apps "feed deterministic
CI budget gates." This doc converts that assumption into a runtime-checkable claim set. It does **not**
implement TASK-104.

> Honesty note (global rule 4): TASK-104 was written 2026-08-07. Its Step-0 item 3 is a *static-read*
> hypothesis ("would perturb … deterministic budget gates: `m4a.spec.ts` … 12 budget asserts, `m3`,
> `flythrough3`, `soak3`, `ctxswitch`, `error-gate`"). Below is what the code actually asserts today.

---

## Step 1 — Falsifiable questions

- **Q1 (decisive).** What do the high-tier deterministic gates assert `drawCalls`/`renderedPoints`
  *from* — the WebGL renderer (`gl.info.render`) or the streaming policy's own CPU-side count? If the
  latter, an identity composite pass cannot move them.
- **Q2.** Which probe apps mount the composer at all (tier `high`/`medium` ⇒ `bloomEnabled=true`) AND
  run a manual `gl.render`? Those are the only collision sites.
- **Q3.** At what `useFrame` priority does each probe render, vs the composer's? Ordering decides which
  pass wins the default framebuffer and whether the composer's work is even visible to `gl.info`.
- **Q4.** After Q1–Q3, what actually remains at risk, and is the fix an executor call or an owner call?

## Step 2 — Kill / redirect conditions (committed before reading)

- **Kills the spec's STOP framing:** if the high-tier gates read `streaming.*` (policy CPU stats) and
  the one gate reading `gl.info.render` runs at tier `low`, then the composite pass moves **no budget
  number** and the "budget gates shift" justification is false.
- **Confirms the spec's STOP framing:** if any high-tier gate reads `gl.info.render.calls/.points`, an
  identity composite adds a fullscreen pass to that aggregate and the gate really would move.

---

## Step 3–4 — Findings (claims)

```
CLAIM 1:  The high-tier deterministic gates assert drawCalls/renderedPoints from the STREAMING
          POLICY's own CPU-side accounting (window.__cosmos.streaming.*), NOT from gl.info.render.
          _renderedPoints = Σ visible chunk.pointCount; _drawCalls = visible.length. These are
          decoupled from the WebGL renderer: an EffectComposer composite pass cannot change them.
EVIDENCE: packages/streaming/src/policy.ts:837 (_renderedPoints += c.pointCount), :843
          (_drawCalls = visible.length), :250-251 (getters). Gates read them:
          m3.spec.ts:90/175/178 (renderedPoints ≤ high-tier cap; drawCalls ≤ 300),
          flythrough3.spec.ts:91/134/137, m4a.spec.ts:32/77-78, soak3.spec.ts:61 — all via
          window.__cosmos.streaming.{renderedPoints,drawCalls}.
VERIFIED: 2026-09-07 (static read of live code).
RECHECK:  grep -n "renderedPoints\|drawCalls" packages/streaming/src/policy.ts → the two are
          assignments over `visible`, not reads of gl.info.
```

```
CLAIM 2:  The ONLY gate that asserts on the real renderer aggregate gl.info.render.calls/.points is
          flythrough4 — and it runs on Flythrough4ProbeApp, which PINS tier `low` (bloomEnabled=false
          ⇒ PostChain returns null ⇒ no composer). So the one gl.info gate never mounts the composer.
EVIDENCE: Flythrough4Probe.tsx:397-398 (const sceneDrawCalls = gl.info.render.calls; scenePoints =
          gl.info.render.points), flythrough4.spec.ts:226 ("Compared on TOTAL scene work
          (gl.info.render)"). Tier: Flythrough4ProbeApp.tsx:146 (qc.setTier('low')) + :166
          (initialQualityTier="low"). No other probe reads gl.info.render (grep below).
VERIFIED: 2026-09-07.
RECHECK:  grep -rn "gl\.info\|info\.render" apps/web/src/scene/*.tsx → only Flythrough4Probe.tsx.
```

```
CLAIM 3:  Every manual-render probe renders at useFrame priority 100. @react-three/postprocessing's
          EffectComposer subscribes a positive-priority useFrame at a LOW default (renderPriority 1).
          So in a colliding app the composer runs FIRST (prio 1: scene→target→screen) and the probe's
          gl.render(scene,camera) runs LAST (prio 100), OVERWRITING the composite on the default
          framebuffer. three.js resets info.render.{calls,points} at the start of each render(), so a
          probe reading gl.info right after its own (last) render sees ONLY its own scene work — the
          composer's extra pass is invisible to the measurement even where one existed.
EVIDENCE: All six probes close useFrame with `}, 100)` (CtxSwitchProbe:281, ErrorGateProbe:205,
          M3DescentProbe:282, SoakProbe:214, Flythrough3Probe:242, Flythrough4Probe:517).
          Composer default renderPriority = 1 is a property of the (not-yet-installed) lib — a
          HYPOTHESIS to reconfirm against the installed version at implementation (rule 2).
VERIFIED: probe priorities 2026-09-07; composer priority = pending install.
RECHECK:  grep -nE "\}, *[0-9]+\s*\)" apps/web/src/scene/*Probe*.tsx ; at impl, log the composer's
          effective renderPriority and confirm < 100.
```

```
CLAIM 4:  The apps that would mount the composer AND do a manual gl.render (the collision set) are the
          tier-`high` probe apps: CtxSwitchApp (no explicit tier ⇒ SceneHost default 'high'),
          ErrorGateApp, M3App, M4aApp, Soak4ProbeApp, StreamingProbeApp. Flythrough4ProbeApp is the
          only manual-render app pinned `low` (safe). The real app (StarApp) uses detectInitialTier()
          and SHOULD mount the composer at medium/high — that is the intended reachability.
EVIDENCE: SceneHost.tsx:173 (initialQualityTier = 'high' default); CtxSwitchApp.tsx sets no tier;
          initialQualityTier="high" in ErrorGateApp:172, M3App:135, M4aApp:210, Soak4ProbeApp:161,
          StreamingProbeApp:134; low in Flythrough4ProbeApp; StarApp.tsx:60/645 detectInitialTier.
VERIFIED: 2026-09-07.
```

## Step 5 — What is actually at risk (the narrow residual)

The budget-number fear is unfounded (CLAIM 1+2). Three real, smaller concerns remain, all in the
collision set of CLAIM 4:

1. **`error-gate` is the sharp edge.** `error-gate.spec.ts:64` asserts `errorCounts.total === 0`. A
   double render (composer at prio 1 + manual `gl.render` at prio 100) that emits any WebGL
   warning/error routed through the diagnostics sink turns the gate red. This is the one high-tier gate
   that a composer *could* trip — via errors, never via a budget count.
2. **Wasted double GPU work + a render-target allocation** in ~6 probe apps. Not gated (perf is
   reference-machine), but it is pure waste that is immediately overwritten (CLAIM 3), and a leaked
   target across a mount/unmount cycle would matter to soak's plateau assertion.
3. **Correctness smell.** Two render owners (composer + manual `gl.render`) in one frame is undefined
   ownership even where it is functionally inert today.

## Step 6 — Verdict: the spec's INSTINCT was right, its REASON was wrong

TASK-104 Step-0 item 3 correctly flagged this as *not an executor improvisation* — but its stated cause
("deterministic budget gates shift") is **measured false**: those gates read policy CPU stats, and the
lone `gl.info` gate is on the low-tier app. So this is **not** a rules-1/3 "gate would move, don't relax
it" situation at all. It is a clean design choice with no threshold pressure.

**Recommended resolution (owner call — additive, no gate touched, no tier changed, no threshold
relaxed):** a manual-render probe and an `EffectComposer` are mutually-exclusive render owners; an app
driving its own render loop should not mount the composer. Thread an **additive** `postProcessing?:
boolean` (default `true`) on `SceneHostProps` → `PostChain` mounts only when `postProcessing &&
bloomEnabled`. The six manual-render probe apps pass `postProcessing={false}`; StarApp keeps the
default and gets the composer at medium/high. This:

- leaves every gate at its current tier and threshold — `m3` still asserts the **high-tier** cap
  (m3.spec.ts:175), so the spec's fallback "pin the probe to `low`" is rejected: it would silently
  change which cap the gate tests;
- removes the double-render (and its error-gate risk) entirely from the probes;
- keeps CI's deterministic coverage of the composer where TASK-104 already puts it — the scene-host
  unit test (`test/post-chain.test.tsx`, acceptance §1, `@react-three/test-renderer`) — not a
  pack/env-sensitive e2e probe (consistent with `[[dont-gate-peak-of-per-frame-sample]]` and
  `[[always-on-alarm-for-known-cliffs]]`: the always-on teeth live in the deterministic unit).

`SceneHostProps` is a frozen surface (architecture §5.1), so this additive optional prop is a **mild
sanctioned thaw** — exactly the "owner decision, not executor" the spec meant. It is one prop, defaults
to today's behavior for every existing consumer, and needs owner sign-off before TASK-104 executes.

**Open item to reconfirm at implementation (rule 2):** the composer's effective `useFrame`
renderPriority once `@react-three/postprocessing` is installed (CLAIM 3 assumes the lib default 1 < the
probes' 100). If a future version raised it above 100, the probe's overwrite ordering would flip and
flythrough4's `gl.info` immunity would need re-checking — though flythrough4 stays `low` regardless.
