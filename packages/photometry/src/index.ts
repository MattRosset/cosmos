/**
 * The CPU owner of star photometry: apparent magnitude, rendered point size, and
 * whether a star is perceptible at all (ADR-007).
 *
 * WHY THIS PACKAGE EXISTS. The same formula lived twice — once in GLSL
 * (`@cosmos/render-stars` shaders) and once hand-copied into the app's tile
 * brightness cull — plus its constants (8/3/64, the 0.004 floor, the x6 galaxy
 * multiplier) were spread across three files. Every new consumer that needs to ask
 * "would this star be perceptible?" — picking, diagnostics, the offline pack replay —
 * would otherwise copy it a third and fourth time and drift. This is the single CPU
 * answer; GLSL remains the GPU one, and `@cosmos/render-stars` keeps source-level
 * conformance guards against it.
 *
 * DOM-, React- and THREE-free by contract, so vitest (node env) and offline tools can
 * both use it.
 *
 * The CPU side deliberately uses `Math.log10` where GLSL uses `log2(d)/log2(10.0)`.
 * That is the pre-existing behavior of the tile cull and is preserved bit-for-bit here;
 * introducing a tolerance to "reconcile" them would change shipped cull decisions.
 */

/** ADR-007 §1. Natural is the default on every boot; persistence is out of scope. */
export type StarVisibilityMode = 'natural' | 'survey';

/**
 * Which exposure multiplier applies. The galaxy octree is the only layer a visibility
 * mode changes; HYG/exoplanet/system stars stay on the raw slider (ADR-007 §2-3).
 * Procgen is deliberately absent — its `CLOUD_EXPOSURE_BOOST` solves a different
 * representation problem and is not photometry.
 */
export type StarExposureLayer = 'galaxy-octree' | 'hyg' | 'exoplanet' | 'system';

export interface StarVisibilityProfile {
  readonly mode: StarVisibilityMode;
  /** Multiplier applied to the raw slider exposure, per layer (ADR-007 §8, frozen). */
  readonly exposureMultipliers: Readonly<Record<StarExposureLayer, number>>;
}

/** ADR-007 §2 — today's enriched default. Effective octree exposure at slider 25 is 150. */
export const NATURAL_VISIBILITY_PROFILE: StarVisibilityProfile = Object.freeze({
  mode: 'natural',
  exposureMultipliers: Object.freeze({
    'galaxy-octree': 6,
    hyg: 1,
    exoplanet: 1,
    system: 1,
  }),
});

/** ADR-007 §3 — exposure-only depth. Effective octree exposure at slider 25 is 1000. */
export const SURVEY_VISIBILITY_PROFILE: StarVisibilityProfile = Object.freeze({
  mode: 'survey',
  exposureMultipliers: Object.freeze({
    'galaxy-octree': 40,
    hyg: 1,
    exoplanet: 1,
    system: 1,
  }),
});

export const VISIBILITY_PROFILES: Readonly<Record<StarVisibilityMode, StarVisibilityProfile>> =
  Object.freeze({
    natural: NATURAL_VISIBILITY_PROFILE,
    survey: SURVEY_VISIBILITY_PROFILE,
  });

/**
 * `createStarPoints` uniform defaults (`render-stars/src/star-points.ts`). They live here
 * because the CPU replay must use the SAME numbers the renderer uploads; render-stars
 * imports them back rather than declaring its own.
 */
export const STAR_RENDER_DEFAULTS = Object.freeze({
  basePointPx: 8,
  minPointPx: 3,
  maxPointPx: 64,
});

/**
 * ADR-007 §4. Shared by render, pick, tile cull and streaming so that a claimable star is
 * a drawn star. FROZEN — never raise it to make a gate pass: past arrival the HYG monolith
 * is coverage-gated off, so a higher floor blanks the sky with no fallback.
 */
export const STAR_PERCEPTIBILITY_FLOOR = 0.004;

/** Minimum distance used in the magnitude formula, matching the shader's `max(..., 0.001)`. */
export const MIN_DISTANCE_PC = 0.001;

/** Effective exposure for a layer under a profile: the raw slider times its multiplier. */
export function effectiveStarExposure(
  profile: StarVisibilityProfile,
  layer: StarExposureLayer,
  sliderExposure: number,
): number {
  return sliderExposure * profile.exposureMultipliers[layer];
}

/**
 * Apparent magnitude from absolute magnitude and distance (the standard distance modulus,
 * `m = M + 5*(log10(d_pc) - 1)`), with the shader's distance clamp applied first.
 */
export function apparentMagnitude(absMag: number, distancePc: number): number {
  const dPc = Math.max(distancePc, MIN_DISTANCE_PC);
  return absMag + 5 * (Math.log10(dPc) - 1);
}

export interface RenderedStarInput {
  readonly absMag: number;
  readonly distancePc: number;
  /** EFFECTIVE exposure (already multiplied for the layer), not the raw slider value. */
  readonly exposure: number;
  readonly basePointPx?: number;
  readonly minPointPx?: number;
  readonly maxPointPx?: number;
  readonly perceptibilityFloor?: number;
}

export interface RenderedStarSample {
  readonly apparentMagnitude: number;
  /** Unclamped point size in px — what the star "wants" to be. */
  readonly naturalPointPx: number;
  /** Point size after the floor/ceiling clamp — what is actually drawn. */
  readonly renderedPointPx: number;
  /**
   * Area-ratio dimming applied when the FLOOR clamps a sub-floor star up: its flux is
   * spread over more pixels, so it must dim by (sNat/sRen)^2 to conserve total flux.
   * Dropping this term is what produced the sub-pixel twinkle in
   * `docs/research/star-shimmer-on-motion.md`.
   */
  readonly sizeDim: number;
  readonly clampedFlux: number;
  readonly brightness: number;
  readonly perceptible: boolean;
}

/**
 * Replay of the shipped star shader, CPU side. Mirrors `stars.vert.glsl.ts` (distance
 * clamp, magnitude, natural/rendered size, `sizeDim`) and `stars.frag.glsl.ts` (flux clamp
 * then exposure and `sizeDim`).
 *
 * `perceptible` is true only when brightness and floor are both finite and
 * `brightness >= floor` — equality IS perceptible, matching the cull's `< floor` test.
 * Non-finite inputs therefore yield `perceptible: false`; callers that need the opposite
 * bias (the tile cull fails OPEN, because dropping a tile loses pixels) must guard before
 * calling, exactly as `tileBelowVisibilityFloor` does.
 */
export function sampleRenderedStar(input: RenderedStarInput): RenderedStarSample {
  const {
    absMag,
    distancePc,
    exposure,
    basePointPx = STAR_RENDER_DEFAULTS.basePointPx,
    minPointPx = STAR_RENDER_DEFAULTS.minPointPx,
    maxPointPx = STAR_RENDER_DEFAULTS.maxPointPx,
    perceptibilityFloor = STAR_PERCEPTIBILITY_FLOOR,
  } = input;

  const m = apparentMagnitude(absMag, distancePc);
  const naturalPointPx = basePointPx * Math.pow(10, -0.2 * m);
  const renderedPointPx = Math.min(Math.max(naturalPointPx, minPointPx), maxPointPx);
  const ratio = naturalPointPx / renderedPointPx;
  const sizeDim = Math.min(1, ratio * ratio);
  const clampedFlux = Math.min(1, Math.pow(10, -0.4 * m));
  const brightness = clampedFlux * exposure * sizeDim;

  return {
    apparentMagnitude: m,
    naturalPointPx,
    renderedPointPx,
    sizeDim,
    clampedFlux,
    brightness,
    perceptible:
      Number.isFinite(brightness) &&
      Number.isFinite(perceptibilityFloor) &&
      brightness >= perceptibilityFloor,
  };
}

/**
 * Would this star contribute a perceptible pixel? A thin call through
 * `sampleRenderedStar` — deliberately NOT a second formula, so it cannot drift from the
 * sample it is supposed to summarize.
 */
export function starIsPerceptible(input: RenderedStarInput): boolean {
  return sampleRenderedStar(input).perceptible;
}
