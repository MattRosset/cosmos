/**
 * Deterministic, seedable PRNG for all procedural generation in cosmos.
 *
 * Invariants:
 * - Same seed -> byte-identical sequence, on every platform (uses only u32 integer math).
 * - `Math.random()` is banned project-wide for generation; use this instead.
 * - Hierarchical seeds must be derived with `hashCombine`, never `seed + index`
 *   (naive addition causes overlapping sequences between neighbors).
 */

/** 32-bit integer hash with good avalanche (lowbias32 by Chris Wellons). */
export function hash32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Mix multiple integers into one well-distributed u32 seed. */
export function hashCombine(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const v of values) {
    h = hash32(h ^ hash32(v >>> 0));
  }
  return h >>> 0;
}

export interface Prng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Fork a child generator with an independent stream (deterministic). */
  fork(streamId: number): Prng;
}

/** mulberry32: fast, statistically solid for visual procgen, 32-bit state. */
export function createPrng(seed: number): Prng {
  let state = hash32(seed);

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    fork: (streamId) => createPrng(hashCombine(state, streamId)),
  };
}
