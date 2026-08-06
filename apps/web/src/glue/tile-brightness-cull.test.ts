import { describe, it, expect } from 'vitest';
import { tileBelowVisibilityFloor, TILE_VISIBILITY_FLOOR } from './tile-brightness-cull';

/** Default effective exposure — slider 25 × GALAXY_FIELD_EXPOSURE_BOOST 6. */
const EXPOSURE_EFF = 150;

describe('tileBelowVisibilityFloor', () => {
  it('keeps a near faint star (dist 10, A=5)', () => {
    const dist = 10;
    const radius = 5;
    const A = 5;
    const below = tileBelowVisibilityFloor(dist, radius, A, EXPOSURE_EFF);
    console.log(
      `[tile-brightness-cull] near-faint: dist=${dist} r=${radius} A=${A} ` +
        `E=${EXPOSURE_EFF} floor=${TILE_VISIBILITY_FLOOR} → below=${below} (expect false/KEPT)`,
    );
    expect(below).toBe(false);
  });

  it('culls a far faint tile (6000 pc black patch)', () => {
    const dist = 6000;
    const radius = 20;
    const A = 5;
    const below = tileBelowVisibilityFloor(dist, radius, A, EXPOSURE_EFF);
    console.log(
      `[tile-brightness-cull] far-faint: dist=${dist} r=${radius} A=${A} ` +
        `E=${EXPOSURE_EFF} → below=${below} (expect true/CULLED)`,
    );
    expect(below).toBe(true);
  });

  it('boundary pair at 500 pc: A=-2.5 kept, A=-1.5 culled', () => {
    const dist = 500;
    const radius = 10;
    const kept = tileBelowVisibilityFloor(dist, radius, -2.5, EXPOSURE_EFF);
    const culled = tileBelowVisibilityFloor(dist, radius, -1.5, EXPOSURE_EFF);
    console.log(
      `[tile-brightness-cull] boundary-500pc: dist=${dist} r=${radius} ` +
        `A=-2.5 → below=${kept} (expect false/KEPT); ` +
        `A=-1.5 → below=${culled} (expect true/CULLED)`,
    );
    expect(kept).toBe(false);
    expect(culled).toBe(true);
  });

  it('keeps when camera is inside the tile (d clamps to 0.001)', () => {
    const dist = 3;
    const radius = 10;
    const A = 10;
    const below = tileBelowVisibilityFloor(dist, radius, A, EXPOSURE_EFF);
    console.log(
      `[tile-brightness-cull] inside-tile: dist=${dist} r=${radius} A=${A} ` +
        `E=${EXPOSURE_EFF} → below=${below} (expect false/KEPT)`,
    );
    expect(below).toBe(false);
  });

  it('exposure reversibility: culled at 150, kept at 1200', () => {
    const dist = 500;
    const radius = 10;
    const A = -1.5;
    const at150 = tileBelowVisibilityFloor(dist, radius, A, 150);
    const at1200 = tileBelowVisibilityFloor(dist, radius, A, 1200);
    console.log(
      `[tile-brightness-cull] exposure-rev: dist=${dist} r=${radius} A=${A} ` +
        `E=150 → below=${at150} (expect true); E=1200 → below=${at1200} (expect false)`,
    );
    expect(at150).toBe(true);
    expect(at1200).toBe(false);
  });

  it('approach reversibility: same tile kept at dist 60', () => {
    const dist = 60;
    const radius = 10;
    const A = -1.5;
    const below = tileBelowVisibilityFloor(dist, radius, A, EXPOSURE_EFF);
    console.log(
      `[tile-brightness-cull] approach-rev: dist=${dist} r=${radius} A=${A} ` +
        `E=${EXPOSURE_EFF} → below=${below} (expect false/KEPT)`,
    );
    expect(below).toBe(false);
  });

  it('NaN never culls', () => {
    const nanMag = tileBelowVisibilityFloor(500, 10, NaN, EXPOSURE_EFF);
    const nanDist = tileBelowVisibilityFloor(NaN, 10, -1.5, EXPOSURE_EFF);
    console.log(
      `[tile-brightness-cull] NaN: minAbsMag=NaN → below=${nanMag}; ` +
        `dist=NaN → below=${nanDist} (expect false/KEPT both)`,
    );
    expect(nanMag).toBe(false);
    expect(nanDist).toBe(false);
  });

  it('−∞ minAbsMag never culls (empty/procgen poison)', () => {
    const below = tileBelowVisibilityFloor(6000, 20, Number.NEGATIVE_INFINITY, EXPOSURE_EFF);
    console.log(
      `[tile-brightness-cull] -Inf: dist=6000 r=20 A=-Inf E=${EXPOSURE_EFF} ` +
        `→ below=${below} (expect false/KEPT)`,
    );
    expect(below).toBe(false);
  });
});
