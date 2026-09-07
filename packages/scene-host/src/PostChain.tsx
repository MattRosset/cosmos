import { EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { useThree } from '@react-three/fiber';
import { ToneMappingMode } from 'postprocessing';
import { UnsignedByteType } from 'three';
import { useRef } from 'react';
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CineonToneMapping,
  LinearToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  ReinhardToneMapping,
} from 'three';
import { useQuality } from './use-quality.js';

/**
 * Maps a three.js renderer tone-mapping operator to the `postprocessing`
 * `ToneMappingMode` that reproduces it 1:1. Every three operator has a match
 * EXCEPT `CustomToneMapping`, which uses an app-supplied shader the effect
 * cannot reproduce — that case returns `null` (see PostChain: STOP, no composer).
 */
export function toneMappingModeFor(operator: number): ToneMappingMode | null {
  switch (operator) {
    // Both "no tone mapping" and three's exposure-scaled linear operator map to
    // the postprocessing LINEAR (pass-through) mode — identity for a linear source.
    case NoToneMapping:
    case LinearToneMapping:
      return ToneMappingMode.LINEAR;
    case ReinhardToneMapping:
      return ToneMappingMode.REINHARD;
    // three's CineonToneMapping is the optimized-Cineon curve.
    case CineonToneMapping:
      return ToneMappingMode.OPTIMIZED_CINEON;
    case ACESFilmicToneMapping:
      return ToneMappingMode.ACES_FILMIC;
    case AgXToneMapping:
      return ToneMappingMode.AGX;
    case NeutralToneMapping:
      return ToneMappingMode.NEUTRAL;
    default:
      // CustomToneMapping (or any future/unknown operator): not reproducible 1:1.
      return null;
  }
}

/**
 * Tier-gated post-processing chain (TASK-104, step 1 of 3: foundation).
 *
 * A **leaf** component that isolates the `bloomEnabled` tier gate: a tier change
 * re-renders ONLY this component, never the scene content (architecture §5.1
 * Canvas-isolation rule). It mounts a `@react-three/postprocessing`
 * `<EffectComposer>` that renders the scene through a render target and composites
 * it back **with the image visually unchanged (identity)** — no visible effect.
 * Antialiasing (TASK-105) and selective bloom (TASK-106) mount into this composer later.
 *
 * Identity is preserved by a single `<ToneMapping>` output stage that reproduces the
 * renderer's original tone-mapping operator (the composer otherwise sets
 * `gl.toneMapping = NoToneMapping` and would shift the whole image). The original
 * operator is captured BEFORE the composer can change it (frozen in a ref).
 *
 * @param enabled - carries `SceneHostProps.postProcessing` (default `true`). A
 *   manual-render probe app passes `false` so the composer never mounts alongside
 *   its own `gl.render` (probe-conflict decision, 2026-09-07).
 */
export function PostChain({ enabled = true }: { enabled?: boolean }): React.JSX.Element | null {
  const { bloomEnabled } = useQuality(); // re-renders PostChain on tier change only
  const gl = useThree((s) => s.gl);

  // Capture the renderer's ORIGINAL tone mapping once, before EffectComposer sets it
  // to NoToneMapping. R3F's default is ACESFilmicToneMapping (confirmed at runtime — see NOTES).
  // PostChain never unmounts on a tier flip (only its EffectComposer child does), so this
  // capture + its log fire exactly once per session — the driving-input record that makes a
  // CI-only failure triagable from logs alone (CLAUDE.md testing rule 6).
  const originalToneMapping = useRef<number | null>(null);
  const composerPresent = enabled && bloomEnabled;
  if (originalToneMapping.current === null) {
    originalToneMapping.current = gl.toneMapping;
    // Log only when the composer will actually mount — a manual-render probe app
    // (`postProcessing={false}`) or the low tier would otherwise emit pure noise.
    if (composerPresent) {
      console.log(
        '[post-chain] mount: bloomEnabled=%s toneMapping=%s',
        bloomEnabled,
        gl.toneMapping,
      );
    }
  }

  if (!composerPresent) return null; // opted-out OR low tier → R3F default render

  const mode = toneMappingModeFor(originalToneMapping.current);
  if (mode === null) {
    // §3 STOP: the current tone mapping cannot be reproduced 1:1 (CustomToneMapping).
    // Do NOT ship a changed image — fall back to R3F's default render path (identity).
    console.error(
      '[post-chain] STOP: renderer toneMapping=%s is not reproducible by <ToneMapping>; ' +
        'skipping composer to preserve identity (see TASK-104 §3).',
      originalToneMapping.current,
    );
    return null;
  }

  return (
    // multisampling={0}: MSAA + postprocessing on WebGL2 is broken/expensive (architecture
    // §5.1). AA arrives as an SMAA/FXAA effect in TASK-105, not renderer MSAA.
    // frameBufferType=UnsignedByteType (8-bit), NOT the lib's HalfFloat default: this scene draws
    // ADDITIVE star sprites; an HDR target accumulates them unclamped and the composite renders
    // brighter/crisper than the direct 8-bit path (measured — §3 identity FAILS). An 8-bit target
    // clamps the additive sum exactly like the direct path ⇒ visual no-op. TASK-106 (bloom) switches
    // this to HalfFloat when it needs HDR headroom. See docs/research/post-chain-identity-hdr-target.md.
    <EffectComposer multisampling={0} frameBufferType={UnsignedByteType}>
      {/* Identity output stage only — NOT a "visible effect" (§3). Reproduces the
          renderer's original tone-mapping operator so the composite matches the
          pre-composer image. Visible effects (bloom, AA) arrive in TASK-105/106. */}
      <ToneMapping mode={mode} />
    </EffectComposer>
  );
}
