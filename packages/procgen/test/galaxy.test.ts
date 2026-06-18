import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateGalaxy, galaxyWorkerHandler } from '../src/galaxy.js';
import { sampleMass, massToColorBV } from '../src/stellar.js';
import { PROCGEN_GALAXY_DEFAULTS } from '@cosmos/core-types';

const here = dirname(fileURLToPath(import.meta.url));

function sha256(buffer: ArrayBuffer): string {
  return createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
}

describe('generateGalaxy — determinism', () => {
  it('identical params ⇒ byte-identical buffer', () => {
    const a = generateGalaxy({ seed: 1, starCount: 50000 });
    const b = generateGalaxy({ seed: 1, starCount: 50000 });
    expect(sha256(a.buffer)).toBe(sha256(b.buffer));
  });

  it('a different seed ⇒ a different buffer', () => {
    const a = generateGalaxy({ seed: 1, starCount: 50000 });
    const b = generateGalaxy({ seed: 2, starCount: 50000 });
    expect(sha256(a.buffer)).not.toBe(sha256(b.buffer));
  });

  it('matches the committed golden hash for {seed:1, starCount:1000}', () => {
    const golden = JSON.parse(
      readFileSync(join(here, 'fixtures', 'golden-hash.json'), 'utf8'),
    ) as { sha256: string };
    const { buffer } = generateGalaxy({ seed: 1, starCount: 1000 });
    expect(sha256(buffer)).toBe(golden.sha256);
  });
});

describe('generateGalaxy — shape & packing', () => {
  const count = 1000;
  const { batch, layout, buffer } = generateGalaxy({ seed: 1, starCount: count });

  it('batch shape and array lengths', () => {
    expect(batch.count).toBe(count);
    expect(batch.positionsPc.length).toBe(3 * count);
    expect(batch.absMag.length).toBe(count);
    expect(batch.colorIndexBV.length).toBe(count);
    expect(batch.catalogIds.length).toBe(count);
    expect(batch.hipIds.length).toBe(count);
  });

  it('originPc = [0,0,0] and idPrefix = gal<seed>', () => {
    expect([...batch.originPc]).toEqual([0, 0, 0]);
    expect(batch.idPrefix).toBe('gal1');
  });

  it('catalogIds[i] === i and all hipIds === 0', () => {
    for (let i = 0; i < count; i++) {
      expect(batch.catalogIds[i]).toBe(i);
      expect(batch.hipIds[i]).toBe(0);
    }
  });

  it('every typed array views the single backing buffer (no per-attribute alloc)', () => {
    expect(batch.positionsPc.buffer).toBe(buffer);
    expect(batch.absMag.buffer).toBe(buffer);
    expect(batch.colorIndexBV.buffer).toBe(buffer);
    expect(batch.catalogIds.buffer).toBe(buffer);
    expect(batch.hipIds.buffer).toBe(buffer);
    expect(buffer.byteLength).toBe(28 * count); // 7 attrs × 4 bytes × count
  });

  it('layout offsets are 4-byte aligned and tile the buffer contiguously', () => {
    const slices = [
      layout.positionsPc,
      layout.absMag,
      layout.colorIndexBV,
      layout.catalogIds,
      layout.hipIds,
    ];
    let expected = 0;
    for (const s of slices) {
      expect(s.byteOffset % 4).toBe(0);
      expect(s.byteOffset).toBe(expected);
      expected += s.byteLength;
    }
    expect(expected).toBe(layout.byteLength);
    expect(layout.byteLength).toBe(buffer.byteLength);
  });
});

describe('generateGalaxy — spatial sanity', () => {
  const d = PROCGEN_GALAXY_DEFAULTS;
  const count = 200000;
  const { batch } = generateGalaxy({ seed: 7, starCount: count });
  const pos = batch.positionsPc;

  it('all stars lie within discRadiusPc (+ small bulge/z margin)', () => {
    let max = 0;
    for (let i = 0; i < count; i++) {
      const x = pos[3 * i]!;
      const y = pos[3 * i + 1]!;
      const z = pos[3 * i + 2]!;
      max = Math.max(max, Math.hypot(x, y, z));
    }
    expect(max).toBeLessThanOrEqual(d.discRadiusPc * 1.05);
  });

  it('radial histogram falls off ~exp(−r/L) (fitted slope near −1/L)', () => {
    // Fit ln(count) vs bin-centre over a mid-range band (avoids the bulge core and
    // the truncation edge). Slope should be near −1/discScaleLengthPc.
    const lo = 4000;
    const hi = 12000;
    const nBins = 16;
    const w = (hi - lo) / nBins;
    const counts = new Array<number>(nBins).fill(0);
    for (let i = 0; i < count; i++) {
      const rr = Math.hypot(pos[3 * i]!, pos[3 * i + 1]!);
      if (rr >= lo && rr < hi) counts[Math.floor((rr - lo) / w)]!++;
    }
    const xs: number[] = [];
    const ys: number[] = [];
    for (let b = 0; b < nBins; b++) {
      if (counts[b]! > 0) {
        xs.push(lo + (b + 0.5) * w);
        ys.push(Math.log(counts[b]!));
      }
    }
    const slope = linregSlope(xs, ys);
    const expected = -1 / d.discScaleLengthPc;
    expect(slope).toBeGreaterThan(expected * 1.3); // within ±30%
    expect(slope).toBeLessThan(expected * 0.7);
  });

  it('azimuthal structure shows armCount arms at ~armContrast contrast', () => {
    // De-rotate each star by its radius-dependent arm phase so arms align into
    // fixed peaks, then compare density at arm centres vs inter-arm midpoints.
    const nBins = 72;
    const bins = new Array<number>(nBins).fill(0);
    for (let i = 0; i < count; i++) {
      const x = pos[3 * i]!;
      const y = pos[3 * i + 1]!;
      const r = Math.hypot(x, y);
      if (r < 2000) continue; // skip bulge-dominated core
      const phase = armPhaseRef(r, d);
      let rel = (Math.atan2(y, x) - phase) % (2 * Math.PI);
      if (rel < 0) rel += 2 * Math.PI;
      bins[Math.min(nBins - 1, Math.floor((rel / (2 * Math.PI)) * nBins))]!++;
    }
    // Arms sit at rel = 2π·a/armCount; midpoints halfway between.
    let armSum = 0;
    let midSum = 0;
    for (let a = 0; a < d.armCount; a++) {
      armSum += bins[Math.round((a / d.armCount) * nBins) % nBins]!;
      midSum += bins[Math.round(((a + 0.5) / d.armCount) * nBins) % nBins]!;
    }
    const contrast = armSum / midSum;
    expect(contrast).toBeGreaterThan(d.armContrast * 0.55);
    expect(contrast).toBeLessThan(d.armContrast * 1.6);
  });
});

describe('generateGalaxy — statistical colour distribution', () => {
  it('blue/solar/red fractions match the analytic IMF→colour chain (±15%)', () => {
    const count = 100000;
    const { batch } = generateGalaxy({ seed: 3, starCount: count });

    // Expectation: push a uniform grid of u through the exact ADR-004 §4 chain
    // (inverse-CDF IMF → colour). No opaque hardcoded numbers.
    const grid = 200000;
    const expBlue = fracInGrid(grid, (bv) => bv < 0.0);
    const expSolar = fracInGrid(grid, (bv) => bv >= 0.5 && bv < 0.8);
    const expRed = fracInGrid(grid, (bv) => bv >= 1.4);

    const obsBlue = fracInBatch(batch.colorIndexBV, (bv) => bv < 0.0);
    const obsSolar = fracInBatch(batch.colorIndexBV, (bv) => bv >= 0.5 && bv < 0.8);
    const obsRed = fracInBatch(batch.colorIndexBV, (bv) => bv >= 1.4);

    expectWithin(obsBlue, expBlue, 0.15);
    expectWithin(obsSolar, expSolar, 0.15);
    expectWithin(obsRed, expRed, 0.15);
  });
});

describe('galaxyWorkerHandler — cancellation', () => {
  it('returns promptly with an empty batch when cancelled up front', () => {
    const t0 = performance.now();
    const { batch, transfer } = galaxyWorkerHandler(
      { params: { seed: 1, starCount: 1_000_000 } },
      () => true,
    );
    const dt = performance.now() - t0;
    expect(batch.count).toBe(0);
    expect(batch.positionsPc.length).toBe(0);
    expect(transfer).toHaveLength(1);
    expect(dt).toBeLessThan(100); // did not run the full 1e6 loop
  });

  it('runs to completion when never cancelled', () => {
    const { batch } = galaxyWorkerHandler(
      { params: { seed: 1, starCount: 5000 } },
      () => false,
    );
    expect(batch.count).toBe(5000);
  });
});

describe('source hygiene', () => {
  it('contains no Math.random in src/', () => {
    const srcDir = join(here, '..', 'src');
    for (const f of readdirSync(srcDir)) {
      if (!f.endsWith('.ts')) continue;
      const text = readFileSync(join(srcDir, f), 'utf8');
      expect(text).not.toMatch(/Math\s*\.\s*random/);
    }
  });
});

describe('generateGalaxy — performance', () => {
  it('generates 1e6 stars under the CI-relaxed budget', () => {
    const t0 = performance.now();
    const { batch } = generateGalaxy({ seed: 1, starCount: 1_000_000 });
    const dt = performance.now() - t0;
    expect(batch.count).toBe(1_000_000);
    // Production worker target is 500 ms (uninstrumented). This assertion runs
    // under `vitest --coverage` (v8 instrumentation) on shared CI runners, where
    // 1e6-star generation is several× slower — observed ~7.8 s on a GitHub runner.
    // The budget is a catastrophic-regression guard, not the worker SLA, so it is
    // relaxed to a bound the slowest CI hardware reliably meets while still failing
    // on any pathological (≫ 30×) regression.
    expect(dt).toBeLessThan(15000);
  });
});

// --- helpers ----------------------------------------------------------------

function linregSlope(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return num / den;
}

function armPhaseRef(r: number, d: typeof PROCGEN_GALAXY_DEFAULTS): number {
  return (d.armWindings * Math.log(r / d.discScaleLengthPc + 1)) / Math.tan(d.armPitchRad);
}

function fracInGrid(n: number, pred: (bv: number) => boolean): number {
  let c = 0;
  for (let i = 0; i < n; i++) {
    if (pred(massToColorBV(sampleMass((i + 0.5) / n)))) c++;
  }
  return c / n;
}

function fracInBatch(bv: Float32Array, pred: (bv: number) => boolean): number {
  let c = 0;
  for (let i = 0; i < bv.length; i++) if (pred(bv[i]!)) c++;
  return c / bv.length;
}

function expectWithin(obs: number, exp: number, rel: number): void {
  expect(Math.abs(obs - exp)).toBeLessThanOrEqual(rel * exp + 0.01);
}
