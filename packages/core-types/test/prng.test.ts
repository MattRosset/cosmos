import { describe, expect, it } from 'vitest';
import { createPrng, hash32, hashCombine } from '../src/prng';

describe('createPrng', () => {
  it('is deterministic: same seed produces identical sequences', () => {
    const a = createPrng(42);
    const b = createPrng(42);
    for (let i = 0; i < 1000; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('different seeds produce different sequences', () => {
    const a = createPrng(1);
    const b = createPrng(2);
    const seqA = Array.from({ length: 16 }, () => a.next());
    const seqB = Array.from({ length: 16 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('next() stays in [0, 1)', () => {
    const rng = createPrng(123);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() respects inclusive bounds and hits both ends', () => {
    const rng = createPrng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = rng.int(3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([3, 4, 5, 6]));
  });

  it('fork() produces independent deterministic streams', () => {
    const fork1 = createPrng(99).fork(0);
    const fork2 = createPrng(99).fork(0);
    const fork3 = createPrng(99).fork(1);
    expect(fork1.next()).toBe(fork2.next());
    expect(fork1.next()).not.toBe(fork3.next());
  });

  it('mean of uniform output is ~0.5 (sanity, not rigor)', () => {
    const rng = createPrng(2026);
    let sum = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) sum += rng.next();
    expect(sum / n).toBeGreaterThan(0.49);
    expect(sum / n).toBeLessThan(0.51);
  });
});

describe('hashCombine', () => {
  it('is order-sensitive and collision-resistant for neighbor indices', () => {
    expect(hashCombine(1, 2)).not.toBe(hashCombine(2, 1));
    const hashes = new Set<number>();
    for (let i = 0; i < 10_000; i++) hashes.add(hashCombine(42, i));
    expect(hashes.size).toBe(10_000);
  });

  it('hash32 returns u32', () => {
    for (const x of [0, 1, -1, 2 ** 31, 0xffffffff]) {
      const h = hash32(x);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(h)).toBe(true);
    }
  });
});
