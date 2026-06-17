import {
  createPrng,
  hashCombine,
  PROCGEN_GALAXY_DEFAULTS,
  PROCGEN_STREAM_PLACEMENT,
  PROCGEN_STREAM_MASS,
  PROCGEN_STREAM_JITTER,
} from '@cosmos/core-types';
import type { GalaxyGenParams, StarBatch, ProcgenGalaxyRequest } from '@cosmos/core-types';
import { sampleBulgeRadius } from './sampling.js';
import { sampleMass, massToColorBV, massToAbsMag } from './stellar.js';

// Matches the clamp in sampleDiscHeight (sampling.ts) — keeps atanh in domain.
const ATANH_EPS = 1e-9;

const TWO_PI = 2 * Math.PI;

// Phase 3 generates the whole galaxy as a single sector; the per-sector seed
// structure (ADR-004 §5) exists so `streaming` can later request sub-regions.
const SECTOR_ID = 0;

// Attribute counts per star, in packing order (ADR-004 §"Packing"):
// positionsPc (3 f32), absMag (1 f32), colorIndexBV (1 f32), catalogIds (1 u32),
// hipIds (1 u32). Everything is 4 bytes wide, so every slice is 4-byte aligned.
const BYTES_PER_F32 = 4;

/** Layout of the single backing buffer a generated batch is packed into. */
export interface GalaxyBufferLayout {
  readonly count: number;
  readonly byteLength: number;
  readonly positionsPc: { readonly byteOffset: number; readonly byteLength: number };
  readonly absMag: { readonly byteOffset: number; readonly byteLength: number };
  readonly colorIndexBV: { readonly byteOffset: number; readonly byteLength: number };
  readonly catalogIds: { readonly byteOffset: number; readonly byteLength: number };
  readonly hipIds: { readonly byteOffset: number; readonly byteLength: number };
}

export interface GalaxyResult {
  readonly batch: StarBatch;
  readonly layout: GalaxyBufferLayout;
  /** The single ArrayBuffer all batch arrays view (the thing to transfer, §5.13). */
  readonly buffer: ArrayBuffer;
}

interface ResolvedParams {
  readonly seed: number;
  readonly starCount: number;
  readonly discRadiusPc: number;
  readonly discScaleLengthPc: number;
  readonly discScaleHeightPc: number;
  readonly armCount: number;
  readonly armPitchRad: number;
  readonly armWindings: number;
  readonly armWidthPc: number;
  readonly armContrast: number;
  readonly bulgeFraction: number;
  readonly bulgeRadiusPc: number;
}

function resolve(params: GalaxyGenParams): ResolvedParams {
  const d = PROCGEN_GALAXY_DEFAULTS;
  return {
    seed: params.seed,
    starCount: params.starCount,
    discRadiusPc: params.discRadiusPc ?? d.discRadiusPc,
    discScaleLengthPc: params.discScaleLengthPc ?? d.discScaleLengthPc,
    discScaleHeightPc: params.discScaleHeightPc ?? d.discScaleHeightPc,
    armCount: params.armCount ?? d.armCount,
    armPitchRad: params.armPitchRad ?? d.armPitchRad,
    armWindings: params.armWindings ?? d.armWindings,
    armWidthPc: params.armWidthPc ?? d.armWidthPc,
    armContrast: params.armContrast ?? d.armContrast,
    bulgeFraction: params.bulgeFraction ?? d.bulgeFraction,
    bulgeRadiusPc: params.bulgeRadiusPc ?? d.bulgeRadiusPc,
  };
}

const NEVER_CANCELLED = (): boolean => false;

// Poll cancellation in coarse strides so the steady-state loop pays nothing.
const CANCEL_STRIDE = 4096;

/**
 * Generate a galaxy as a packed StarBatch. Pure: identical `params` ⇒ byte-identical
 * `buffer`. The batch is galaxy-context centred (`originPc = [0,0,0]`, ADR-004 §1),
 * `idPrefix = gal<seed>`, `catalogIds[i] = i`, `hipIds = 0`. Allocates exactly one
 * backing ArrayBuffer; the inner star loop allocates nothing.
 */
export function generateGalaxy(params: GalaxyGenParams): GalaxyResult {
  return generate(params, NEVER_CANCELLED);
}

/**
 * The §5.13 worker handler. `isCancelled` is polled inside the star loop; on cancel
 * it returns early with `count` = stars drawn so far (the pool discards a cancelled
 * result, so the partially-filled tail is irrelevant).
 */
export function galaxyWorkerHandler(
  req: ProcgenGalaxyRequest,
  isCancelled: () => boolean,
): { readonly batch: StarBatch; readonly transfer: readonly ArrayBuffer[] } {
  const { batch, buffer } = generate(req.params, isCancelled);
  return { batch, transfer: [buffer] };
}

function generate(params: GalaxyGenParams, isCancelled: () => boolean): GalaxyResult {
  const p = resolve(params);
  const count = p.starCount;

  // Slice the single backing buffer (ADR-004 §"Packing").
  const positionsBytes = 3 * count * BYTES_PER_F32;
  const scalarBytes = count * BYTES_PER_F32;
  const byteLength = positionsBytes + 4 * scalarBytes;
  const buffer = new ArrayBuffer(byteLength);

  const positionsPc = new Float32Array(buffer, 0, 3 * count);
  const absMag = new Float32Array(buffer, positionsBytes, count);
  const colorIndexBV = new Float32Array(buffer, positionsBytes + scalarBytes, count);
  const catalogIds = new Uint32Array(buffer, positionsBytes + 2 * scalarBytes, count);
  const hipIds = new Uint32Array(buffer, positionsBytes + 3 * scalarBytes, count);

  const layout: GalaxyBufferLayout = {
    count,
    byteLength,
    positionsPc: { byteOffset: 0, byteLength: positionsBytes },
    absMag: { byteOffset: positionsBytes, byteLength: scalarBytes },
    colorIndexBV: { byteOffset: positionsBytes + scalarBytes, byteLength: scalarBytes },
    catalogIds: { byteOffset: positionsBytes + 2 * scalarBytes, byteLength: scalarBytes },
    hipIds: { byteOffset: positionsBytes + 3 * scalarBytes, byteLength: scalarBytes },
  };

  // Seed hierarchy (ADR-004 §5): sectorSeed → independent placement / mass / jitter
  // streams. fork() reads the base PRNG's initial state without advancing it, so the
  // three forks are independent of each other and order-stable.
  const sectorSeed = hashCombine(p.seed, SECTOR_ID);
  const base = createPrng(sectorSeed);
  const placement = base.fork(PROCGEN_STREAM_PLACEMENT);
  const mass = base.fork(PROCGEN_STREAM_MASS);
  // stream 2 (jitter) is reserved for future per-star scatter; ADR-004 §4 derives
  // colour purely from mass, so Phase 3 forks it (keeping the hierarchy intact for
  // `streaming`) but draws nothing from it.
  base.fork(PROCGEN_STREAM_JITTER);

  // Per-galaxy constants — computed once, reused for every star in the loop.
  // Hoisting these out of the hot path eliminates ~2M redundant transcendental
  // calls (exp for disc truncation, tan for arm pitch) at 1e6 stars.
  // NOTE: armTanPitch is used as a divisor (not inverted) so the division
  // `A / armTanPitch` stays bit-identical to the original `A / Math.tan(...)`,
  // preserving the golden hash.
  const discTruncation = 1 - Math.exp(-p.discRadiusPc / p.discScaleLengthPc);
  const armTanPitch = Math.tan(p.armPitchRad);
  const armDenominator = 2 * p.armWidthPc * p.armWidthPc; // constant denom in armDensity
  const armContrastM1 = p.armContrast - 1; // (contrast − 1) factor in armDensity

  let drawn = count;
  for (let i = 0; i < count; i++) {
    if ((i & (CANCEL_STRIDE - 1)) === 0 && isCancelled()) {
      drawn = i;
      break;
    }

    // --- placement (stream 0) -----------------------------------------------
    let x: number;
    let y: number;
    let z: number;
    if (placement.next() < p.bulgeFraction) {
      // Bulge: spherically distributed with Plummer-like radial profile.
      const r = sampleBulgeRadius(placement.next(), p.bulgeRadiusPc, p.discRadiusPc);
      const cosTheta = 2 * placement.next() - 1;
      const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
      const az = placement.next() * TWO_PI;
      x = r * sinTheta * Math.cos(az);
      y = r * sinTheta * Math.sin(az);
      z = r * cosTheta;
    } else {
      // Disc: inline sampleDiscRadius + sampleArmAzimuth + sampleDiscHeight so
      // V8 can see the full loop as one unit and avoid callback-call overhead.

      // sampleDiscRadius — inverse-CDF of exponential surface density.
      const r = -p.discScaleLengthPc * Math.log(1 - placement.next() * discTruncation);

      // armPhase depends only on r (not φ), so compute it once per star rather
      // than once per rejection attempt (saves ~0.7 log+tan calls per disc star).
      // Division by armTanPitch mirrors `/ Math.tan(p.armPitchRad)` exactly.
      const armBase = (p.armWindings * Math.log(r / p.discScaleLengthPc + 1)) / armTanPitch;

      // sampleArmAzimuth — rejection sampler; envelope ceiling = armContrast.
      let phi = 0;
      for (let attempt = 0; attempt < 64; attempt++) {
        phi = placement.next() * TWO_PI;
        const u = placement.next() * p.armContrast;
        // Inline armDensity: 1 + (contrast−1)·Σ_a exp(−(r·Δφ_a)²/denom)
        // centre formula `(TWO_PI * a) / armCount` matches armDensity exactly.
        let sum = 0;
        for (let a = 0; a < p.armCount; a++) {
          const center = armBase + (TWO_PI * a) / p.armCount;
          // wrapPi(phi − center) inlined
          let dphi = (phi - center) % TWO_PI;
          if (dphi > Math.PI) dphi -= TWO_PI;
          else if (dphi < -Math.PI) dphi += TWO_PI;
          const arc = r * dphi;
          sum += Math.exp(-(arc * arc) / armDenominator);
        }
        if (u < 1 + armContrastM1 * sum) break;
      }

      // sampleDiscHeight — inverse-CDF of sech² vertical profile.
      const arg = Math.max(-1 + ATANH_EPS, Math.min(1 - ATANH_EPS, 2 * placement.next() - 1));
      z = (p.discScaleHeightPc * Math.atanh(arg)) / 2;
      x = r * Math.cos(phi);
      y = r * Math.sin(phi);
    }

    // --- mass → colour / magnitude (stream 1) -------------------------------
    const m = sampleMass(mass.next());

    const base3 = 3 * i;
    positionsPc[base3] = x;
    positionsPc[base3 + 1] = y;
    positionsPc[base3 + 2] = z;
    absMag[i] = massToAbsMag(m);
    colorIndexBV[i] = massToColorBV(m);
    catalogIds[i] = i;
    hipIds[i] = 0;
  }

  const batch: StarBatch =
    drawn === count
      ? {
          count,
          originPc: [0, 0, 0],
          positionsPc,
          absMag,
          colorIndexBV,
          catalogIds,
          hipIds,
          idPrefix: `gal${p.seed}`,
        }
      : {
          count: drawn,
          originPc: [0, 0, 0],
          positionsPc: positionsPc.subarray(0, 3 * drawn),
          absMag: absMag.subarray(0, drawn),
          colorIndexBV: colorIndexBV.subarray(0, drawn),
          catalogIds: catalogIds.subarray(0, drawn),
          hipIds: hipIds.subarray(0, drawn),
          idPrefix: `gal${p.seed}`,
        };

  return { batch, layout, buffer };
}
