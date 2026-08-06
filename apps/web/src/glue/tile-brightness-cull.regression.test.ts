import { describe, it, expect } from 'vitest';
import { tileBelowVisibilityFloor } from './tile-brightness-cull';

/**
 * TASK-097 acceptance-gate regression fixture.
 *
 * The tile cull's per-star math was extracted into `@cosmos/photometry.sampleRenderedStar`
 * (this file's `tileBelowVisibilityFloor` now delegates to it). This fixture freezes the
 * TASK-094 truth-table booleans as they shipped BEFORE the extraction and asserts the
 * extracted implementation reproduces every one — zero changed booleans. On any mismatch it
 * logs distance, radius, minAbsMag, effective exposure, the old expected result and the new
 * result, so a CI-only failure is triagable from the log alone (CLAUDE.md testing rule 6).
 *
 * These booleans are the CONTRACT, hand-copied from the TASK-094 suite and its NOTES — they
 * are deliberately NOT recomputed here (a fixture that recomputes the formula cannot detect a
 * formula regression).
 */

/** Default effective exposure — slider 25 × Natural galaxy-octree ×6 (ADR-007). */
const E = 150;

interface Vector {
  readonly label: string;
  readonly dist: number;
  readonly radius: number;
  readonly minAbsMag: number;
  readonly exposureEff: number;
  /** Frozen pre-extraction result (true ⇒ tile culled). */
  readonly oldExpected: boolean;
}

const FROZEN_TASK094_CASES: readonly Vector[] = [
  { label: 'near-faint kept', dist: 10, radius: 5, minAbsMag: 5, exposureEff: E, oldExpected: false },
  { label: 'far-faint culled', dist: 6000, radius: 20, minAbsMag: 5, exposureEff: E, oldExpected: true },
  { label: 'boundary-500 A=-2.5 kept', dist: 500, radius: 10, minAbsMag: -2.5, exposureEff: E, oldExpected: false },
  { label: 'boundary-500 A=-1.5 culled', dist: 500, radius: 10, minAbsMag: -1.5, exposureEff: E, oldExpected: true },
  { label: 'inside-tile kept (d clamps 0.001)', dist: 3, radius: 10, minAbsMag: 10, exposureEff: E, oldExpected: false },
  { label: 'exposure-rev culled @150', dist: 500, radius: 10, minAbsMag: -1.5, exposureEff: 150, oldExpected: true },
  { label: 'exposure-rev kept @1200', dist: 500, radius: 10, minAbsMag: -1.5, exposureEff: 1200, oldExpected: false },
  { label: 'approach-rev kept @60', dist: 60, radius: 10, minAbsMag: -1.5, exposureEff: E, oldExpected: false },
  { label: 'NaN minAbsMag never culls', dist: 500, radius: 10, minAbsMag: NaN, exposureEff: E, oldExpected: false },
  { label: 'NaN dist never culls', dist: NaN, radius: 10, minAbsMag: -1.5, exposureEff: E, oldExpected: false },
  { label: '-Inf minAbsMag never culls', dist: 6000, radius: 20, minAbsMag: Number.NEGATIVE_INFINITY, exposureEff: E, oldExpected: false },
];

describe('TASK-097 regression: extracted tile cull reproduces the TASK-094 truth table', () => {
  it('reports zero changed booleans against the frozen pre-extraction results', () => {
    const changed: string[] = [];
    for (const v of FROZEN_TASK094_CASES) {
      const now = tileBelowVisibilityFloor(v.dist, v.radius, v.minAbsMag, v.exposureEff);
      const drifted = now !== v.oldExpected;
      if (drifted) {
        changed.push(v.label);
        console.log(
          `[TASK-097 regression] DRIFT "${v.label}": dist=${v.dist} radius=${v.radius} ` +
            `minAbsMag=${v.minAbsMag} exposureEff=${v.exposureEff} ` +
            `old=${v.oldExpected} new=${now}`,
        );
      }
    }
    expect(changed).toEqual([]);
  });
});
