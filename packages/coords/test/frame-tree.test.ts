import { describe, expect, it } from 'vitest';
import { CONTEXT_UNIT_METERS, createPrng } from '@cosmos/core-types';
import type { ContextId, Prng, UniversePosition } from '@cosmos/core-types';
import { createScaleFrameTree } from '../src/index';
import type { Vec3Tuple } from '../src/index';

const U = CONTEXT_UNIT_METERS;
const AU_PER_PC = U.system / U.galaxy; // ≈ 4.84813681e-6
const PC_PER_MPC = U.galaxy / U.universe; // ≈ 1e-6
const KM_PER_AU = U.system / U.planet;

const CONTEXTS: readonly ContextId[] = ['universe', 'galaxy', 'system', 'planet'];
const CHILD_CONTEXTS = ['galaxy', 'system', 'planet'] as const;

/** Uniform magnitude in [minMag, maxMag) with random sign. */
const signed = (rng: Prng, minMag: number, maxMag: number): number =>
  (rng.next() < 0.5 ? -1 : 1) * rng.range(minMag, maxMag);

const norm = (v: readonly [number, number, number]): number => Math.hypot(v[0], v[1], v[2]);

describe('createScaleFrameTree — anchors', () => {
  it('anchors default to the parent origin', () => {
    const tree = createScaleFrameTree();
    for (const c of CHILD_CONTEXTS) {
      expect(tree.getAnchor(c)).toEqual([0, 0, 0]);
    }
  });

  it('setAnchor/getAnchor round-trips and returns defensive copies', () => {
    const tree = createScaleFrameTree();
    const anchor: Vec3Tuple = [8000, -2, 5];
    tree.setAnchor('system', anchor);
    const got = tree.getAnchor('system');
    expect(got).toEqual([8000, -2, 5]);
    got[0] = 999; // mutating the returned tuple must not affect the tree
    anchor[1] = 999; // nor must mutating the input after the fact
    expect(tree.getAnchor('system')).toEqual([8000, -2, 5]);
  });
});

describe('createScaleFrameTree — convert fixtures', () => {
  it('same-context conversion is the identity (fresh position object)', () => {
    const tree = createScaleFrameTree();
    const pos: UniversePosition = { context: 'system', local: [1, -2, 3] };
    const out = tree.convert(pos, 'system');
    expect(out.context).toBe('system');
    expect(out.local).toEqual([1, -2, 3]);
    expect(out).not.toBe(pos);
  });

  it('galaxy → universe applies anchor + unit renormalization', () => {
    const tree = createScaleFrameTree();
    tree.setAnchor('galaxy', [5, 6, 7]); // galaxy origin at [5,6,7] Mpc
    const out = tree.convert({ context: 'galaxy', local: [2e6, 0, -1e6] }, 'universe');
    expect(out.local[0]).toBeCloseTo(5 + 2e6 * PC_PER_MPC, 12);
    expect(out.local[1]).toBeCloseTo(6, 12);
    expect(out.local[2]).toBeCloseTo(7 - 1e6 * PC_PER_MPC, 12);
  });

  it('universe → galaxy is the exact inverse mapping', () => {
    const tree = createScaleFrameTree();
    tree.setAnchor('galaxy', [5, 6, 7]);
    const out = tree.convert({ context: 'universe', local: [7, 6, 5] }, 'galaxy');
    expect(out.local[0]).toBeCloseTo((7 - 5) / PC_PER_MPC, 6);
    expect(out.local[1]).toBeCloseTo(0, 6);
    expect(out.local[2]).toBeCloseTo((5 - 7) / PC_PER_MPC, 6);
  });

  it('walks the full chain planet → universe through every anchor', () => {
    const tree = createScaleFrameTree();
    tree.setAnchor('planet', [10, 0, 0]); // planet origin 10 AU from system origin
    tree.setAnchor('system', [8000, 0, 0]); // system origin 8 kpc from galactic center
    tree.setAnchor('galaxy', [1, 2, 3]); // galaxy origin at [1,2,3] Mpc

    const atPlanetOrigin: UniversePosition = { context: 'planet', local: [0, 0, 0] };

    const inSystem = tree.convert(atPlanetOrigin, 'system');
    expect(inSystem.local).toEqual([10, 0, 0]);

    const inGalaxy = tree.convert(atPlanetOrigin, 'galaxy');
    expect(inGalaxy.local[0]).toBeCloseTo(8000 + 10 * AU_PER_PC, 9);

    const inUniverse = tree.convert(atPlanetOrigin, 'universe');
    expect(inUniverse.local[0]).toBeCloseTo(1 + (8000 + 10 * AU_PER_PC) * PC_PER_MPC, 12);
    expect(inUniverse.local[1]).toBeCloseTo(2, 12);
    expect(inUniverse.local[2]).toBeCloseTo(3, 12);
  });

  it('descends universe → planet (sign-sensitive anchor handling)', () => {
    const tree = createScaleFrameTree();
    tree.setAnchor('planet', [10, 0, 0]);
    tree.setAnchor('system', [8000, 0, 0]);
    tree.setAnchor('galaxy', [1, 2, 3]);
    // A point exactly 1 AU (in +x) from the planet origin, expressed in universe units:
    const xUniverse = 1 + (8000 + 11 * AU_PER_PC) * PC_PER_MPC;
    const out = tree.convert({ context: 'universe', local: [xUniverse, 2, 3] }, 'planet');
    // 1 AU in km ≈ 1.496e8; the f64 absolute floor at Mpc scale is ~1e4 km.
    expect(Math.abs(out.local[0] - KM_PER_AU)).toBeLessThan(1e5);
    expect(Math.abs(out.local[1])).toBeLessThan(1e5);
    expect(Math.abs(out.local[2])).toBeLessThan(1e5);
  });
});

describe('createScaleFrameTree — round-trip properties (seeded, ≥1000 cases)', () => {
  it('round-trips across every ordered context pair lose < 1e-6 relative error', () => {
    // Relative error is measured against the largest physical magnitude the
    // conversion traverses (f64 carries ~1e-16 relative precision per op; a
    // planet-frame detail cannot survive a megaparsec-scale representation in
    // absolute terms — exactly why ADR-001 keeps positions context-local).
    const rng = createPrng(20260610);
    let cases = 0;
    while (cases < 1008) {
      const tree = createScaleFrameTree();
      for (const c of CHILD_CONTEXTS) {
        tree.setAnchor(c, [signed(rng, 0, 1e4), signed(rng, 0, 1e4), signed(rng, 0, 1e4)]);
      }
      for (const src of CONTEXTS) {
        for (const tgt of CONTEXTS) {
          if (src === tgt) continue;
          const pos: UniversePosition = {
            context: src,
            local: [signed(rng, 1, 1e4), signed(rng, 1, 1e4), signed(rng, 1, 1e4)],
          };
          const converted = tree.convert(pos, tgt);
          expect(converted.context).toBe(tgt);
          const back = tree.convert(converted, src);
          expect(back.context).toBe(src);

          const errMeters =
            Math.hypot(
              back.local[0] - pos.local[0],
              back.local[1] - pos.local[1],
              back.local[2] - pos.local[2],
            ) * U[src];
          const scaleMeters = Math.max(
            norm(pos.local) * U[src],
            norm(converted.local) * U[tgt],
            U[src],
          );
          expect(errMeters).toBeLessThan(1e-6 * scaleMeters);
          cases += 1;
        }
      }
    }
    expect(cases).toBeGreaterThanOrEqual(1000);
  });

  it('adjacent-pair round-trips lose < 1e-6 relative to the original position itself', () => {
    const rng = createPrng(424242);
    const adjacentPairs: ReadonlyArray<readonly [ContextId, ContextId]> = [
      ['planet', 'system'],
      ['system', 'galaxy'],
      ['galaxy', 'universe'],
      ['system', 'planet'],
      ['galaxy', 'system'],
      ['universe', 'galaxy'],
    ];
    let cases = 0;
    for (let i = 0; i < 168; i++) {
      const tree = createScaleFrameTree();
      for (const c of CHILD_CONTEXTS) {
        tree.setAnchor(c, [signed(rng, 0, 1e3), signed(rng, 0, 1e3), signed(rng, 0, 1e3)]);
      }
      for (const [src, tgt] of adjacentPairs) {
        const pos: UniversePosition = {
          context: src,
          local: [signed(rng, 1e2, 1e4), signed(rng, 1e2, 1e4), signed(rng, 1e2, 1e4)],
        };
        const back = tree.convert(tree.convert(pos, tgt), src);
        const err = Math.hypot(
          back.local[0] - pos.local[0],
          back.local[1] - pos.local[1],
          back.local[2] - pos.local[2],
        );
        expect(err / norm(pos.local)).toBeLessThan(1e-6);
        cases += 1;
      }
    }
    expect(cases).toBeGreaterThanOrEqual(1000);
  });
});

describe('createScaleFrameTree — distanceMeters', () => {
  it('is zero for identical positions', () => {
    const tree = createScaleFrameTree();
    const pos: UniversePosition = { context: 'galaxy', local: [8000, -3, 12] };
    expect(tree.distanceMeters(pos, pos)).toBe(0);
  });

  it('matches exact same-context geometry', () => {
    const tree = createScaleFrameTree();
    const a: UniversePosition = { context: 'galaxy', local: [3, 4, 0] };
    const b: UniversePosition = { context: 'galaxy', local: [0, 0, 0] };
    expect(tree.distanceMeters(a, b)).toBeCloseTo(5 * U.galaxy, 6);
  });

  it('is symmetric across contexts (seeded property)', () => {
    const rng = createPrng(777);
    for (let i = 0; i < 200; i++) {
      const tree = createScaleFrameTree();
      for (const c of CHILD_CONTEXTS) {
        tree.setAnchor(c, [signed(rng, 0, 1e3), signed(rng, 0, 1e3), signed(rng, 0, 1e3)]);
      }
      const ca = CONTEXTS[rng.int(0, 3)] as ContextId;
      const cb = CONTEXTS[rng.int(0, 3)] as ContextId;
      const a: UniversePosition = {
        context: ca,
        local: [signed(rng, 0, 1e4), signed(rng, 0, 1e4), signed(rng, 0, 1e4)],
      };
      const b: UniversePosition = {
        context: cb,
        local: [signed(rng, 0, 1e4), signed(rng, 0, 1e4), signed(rng, 0, 1e4)],
      };
      expect(tree.distanceMeters(a, b)).toBe(tree.distanceMeters(b, a));
    }
  });

  it('matches the hand-computed galaxy↔system fixture to < 1e-6 relative', () => {
    // System anchored 8 kpc from galactic center. Point a: system origin.
    // Point b: 10 AU further out along +x, expressed in the GALAXY frame.
    const tree = createScaleFrameTree();
    tree.setAnchor('system', [8000, 0, 0]);
    const a: UniversePosition = { context: 'system', local: [0, 0, 0] };
    const b: UniversePosition = { context: 'galaxy', local: [8000 + 10 * AU_PER_PC, 0, 0] };
    const expected = 10 * U.system; // 10 AU = 1.495978707e12 m, by hand
    const got = tree.distanceMeters(a, b);
    expect(Math.abs(got - expected) / expected).toBeLessThan(1e-6);
  });

  it('coincident points expressed in different contexts are at distance 0', () => {
    const tree = createScaleFrameTree();
    tree.setAnchor('system', [8000, 0, 0]);
    const a: UniversePosition = { context: 'system', local: [0, 0, 0] };
    const b: UniversePosition = { context: 'galaxy', local: [8000, 0, 0] };
    expect(tree.distanceMeters(a, b)).toBe(0);
  });
});
