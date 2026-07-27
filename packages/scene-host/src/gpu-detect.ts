import type { QualityTier } from '@cosmos/core-types';

/** Substrings this repo has observed for integrated GPUs (case-insensitive, matched
 *  anywhere in the string — Chrome-on-Mac reports through an ANGLE wrapper, e.g.
 *  "ANGLE Metal Renderer: Apple M1"). Deliberately dumb: the PerformanceMonitor
 *  backstop is the contract, this must not grow into a device database. */
const INTEGRATED_PATTERNS: readonly RegExp[] = [
  /Apple M/i,
  /Intel.*(Iris|UHD|HD Graphics)/i,
  /Mali/i,
  /Adreno/i,
];

/** Classifies a WEBGL_debug_renderer_info UNMASKED_RENDERER string. `null`, an empty
 *  string, or anything unrecognized (including masked strings and SwiftShader/ANGLE
 *  software fallbacks) classifies as `'unknown'`, never `'integrated'`. */
export function classifyRenderer(renderer: string | null): 'integrated' | 'unknown' {
  if (renderer === null) return 'unknown';
  return INTEGRATED_PATTERNS.some((pattern) => pattern.test(renderer)) ? 'integrated' : 'unknown';
}

/** Boot-time GPU tier detection. Creates a throwaway offscreen WebGL context, reads
 *  UNMASKED_RENDERER_WEBGL, and maps `integrated` ⇒ `medium`, `unknown` ⇒ `high`.
 *  Any failure (no WebGL, no extension, thrown error) ⇒ `high`. Always logs one line
 *  (renderer string + chosen tier) so a wrong choice is diagnosable from logs alone. */
export function detectInitialTier(): QualityTier {
  let renderer: string | null = null;
  let tier: QualityTier;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
      }
    }
    tier = classifyRenderer(renderer) === 'integrated' ? 'medium' : 'high';
  } catch {
    tier = 'high';
  }
  console.info(`[cosmos] boot GPU tier: renderer=${renderer ?? 'unknown'} tier=${tier}`);
  return tier;
}
