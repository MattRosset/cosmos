import { describe, expect, it, vi } from 'vitest';
import { hashCombine } from '@cosmos/core-types';
import type { GalaxyRecord } from '@cosmos/core-types';
import {
  generateLocalGroup,
  localGroupGalaxyName,
  pickNearestGalaxy,
  GALAXY_PICK_MAX_ANGLE_RAD,
} from '../src/local-group';

describe('generateLocalGroup', () => {
  it('is deterministic — same params produce identical records', () => {
    const a = generateLocalGroup({ seed: 7 });
    const b = generateLocalGroup({ seed: 7 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(12); // default count
  });

  it('different seed produces different records', () => {
    const a = generateLocalGroup({ seed: 7 });
    const b = generateLocalGroup({ seed: 42 });
    expect(a[0]!.positionMpc).not.toEqual(b[0]!.positionMpc);
  });

  it('respects count and radiusMpc params', () => {
    const records = generateLocalGroup({ seed: 1, count: 5, radiusMpc: 2.0 });
    expect(records).toHaveLength(5);
    for (const r of records) {
      const dist = Math.hypot(...r.positionMpc);
      expect(dist).toBeLessThanOrEqual(2.0);
    }
  });

  it('each GalaxyRecord has finite positionMpc and radiusKpc', () => {
    const records = generateLocalGroup({ seed: 7 });
    for (const r of records) {
      expect(r.kind).toBe('galaxy');
      for (const v of r.positionMpc) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(Number.isFinite(r.radiusKpc)).toBe(true);
      expect(r.radiusKpc).toBeGreaterThan(0);
    }
  });

  it('each galaxy seed equals hashCombine(params.seed, index)', () => {
    const SEED = 7;
    const records = generateLocalGroup({ seed: SEED });
    records.forEach((r, i) => {
      expect(r.seed).toBe(hashCombine(SEED, i));
    });
  });

  it('all galaxies fit inside default radiusMpc (1.5 Mpc)', () => {
    const records = generateLocalGroup({ seed: 7 });
    for (const r of records) {
      const dist = Math.hypot(...r.positionMpc);
      expect(dist).toBeLessThanOrEqual(1.5);
    }
  });

  it('does not call Math.random — uses seeded PRNG only', () => {
    const spy = vi.spyOn(Math, 'random');
    generateLocalGroup({ seed: 7 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('localGroupGalaxyName (TASK-086, D5/G1)', () => {
  it('resolves proc:localgroup:<n> to "Galaxy G-<n>"', () => {
    expect(localGroupGalaxyName('proc:localgroup:3')).toBe('Galaxy G-3');
    expect(localGroupGalaxyName('proc:localgroup:0')).toBe('Galaxy G-0');
    expect(localGroupGalaxyName('proc:localgroup:10')).toBe('Galaxy G-10');
  });

  it('resolves proc:milkyway to "Milky Way"', () => {
    expect(localGroupGalaxyName('proc:milkyway')).toBe('Milky Way');
  });

  it('returns null for ids outside the local-group namespace (e.g. a star id)', () => {
    expect(localGroupGalaxyName('hyg:32349')).toBeNull();
    expect(localGroupGalaxyName('sol:earth')).toBeNull();
    expect(localGroupGalaxyName('proc:localgroupX:3')).toBeNull();
  });
});

describe('pickNearestGalaxy (TASK-086, D4/G2)', () => {
  const galaxies = generateLocalGroup({ seed: 1 }); // matches LOCAL_GROUP_SEED (local-group.ts)
  const CAM: readonly [number, number, number] = [0, 0, 0];

  /** Unit direction from `from` to `to`. */
  function dirTo(
    from: readonly [number, number, number],
    to: readonly [number, number, number],
  ): [number, number, number] {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const len = Math.hypot(dx, dy, dz);
    return [dx / len, dy / len, dz / len];
  }

  it('a ray aimed straight at galaxy k returns its BodyId', () => {
    // Pick a non-Milky-Way index (indices 1..N-1 are what StarApp actually renders,
    // TASK-086 Step 0.2) whose distance from the camera is non-trivial.
    const k = 3;
    const target = galaxies[k]!;
    const dir = dirTo(CAM, target.positionMpc);
    const hit = pickNearestGalaxy(galaxies, CAM, dir);
    // Log the chosen input + measured angle (CLAUDE.md testing rule 6 — a CI-only
    // failure must be triagable from logs alone).
    console.log(
      `pickNearestGalaxy: k=${k} id=${target.id} positionMpc=${JSON.stringify(target.positionMpc)} ` +
        `dir=${JSON.stringify(dir)} angleToSelf=0 (exact aim) hit=${hit}`,
    );
    expect(hit).toBe(`proc:localgroup:${k}`);
  });

  it('a dir aimed at empty sky (beyond the threshold from every galaxy) returns null', () => {
    // Find a direction angularly far (> GALAXY_PICK_MAX_ANGLE_RAD, comfortably) from
    // every galaxy in the seeded set, so the miss is not accidental.
    const candidateDirs: Array<[number, number, number]> = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [-1, 0, 0],
      [0, -1, 0],
      [0, 0, -1],
      [1, 1, 1],
      [-1, -1, -1],
    ];
    const MARGIN = 0.3; // rad — comfortably above GALAXY_PICK_MAX_ANGLE_RAD (0.02)
    let chosen: [number, number, number] | null = null;
    let minAngle = Infinity;
    for (const cand of candidateDirs) {
      const len = Math.hypot(cand[0], cand[1], cand[2]);
      const dir: [number, number, number] = [cand[0] / len, cand[1] / len, cand[2] / len];
      let worstForThisDir = Infinity;
      for (const g of galaxies) {
        const dist = Math.hypot(...g.positionMpc);
        if (dist === 0) continue;
        const cosA =
          (dir[0] * g.positionMpc[0] + dir[1] * g.positionMpc[1] + dir[2] * g.positionMpc[2]) /
          dist;
        const angle = Math.acos(Math.max(-1, Math.min(1, cosA)));
        worstForThisDir = Math.min(worstForThisDir, angle);
      }
      if (worstForThisDir < minAngle) minAngle = worstForThisDir;
      if (worstForThisDir > GALAXY_PICK_MAX_ANGLE_RAD + MARGIN) {
        chosen = dir;
        break;
      }
    }
    expect(
      chosen,
      `no candidate direction cleared every galaxy by margin ${MARGIN}; closest miss ${minAngle} rad`,
    ).not.toBeNull();
    const hit = pickNearestGalaxy(galaxies, CAM, chosen!);
    console.log(
      `pickNearestGalaxy: empty-sky dir=${JSON.stringify(chosen)} measured min angle to any ` +
        `galaxy=${minAngle} rad (threshold ${GALAXY_PICK_MAX_ANGLE_RAD}) hit=${hit}`,
    );
    expect(hit).toBeNull();
  });

  it('returns null for an empty galaxy list', () => {
    const empty: readonly GalaxyRecord[] = [];
    expect(pickNearestGalaxy(empty, CAM, [0, 0, 1])).toBeNull();
  });
});
