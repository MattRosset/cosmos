import { describe, expect, it } from 'vitest';
import { CONTEXT_UNIT_METERS, type ContextId } from '@cosmos/core-types';
import {
  GALACTIC_SURVEY_MIN_PC,
  SCALE_RULER_SEGMENTS,
  scaleRulerSegment,
  type ScaleRulerSegment,
} from '../src/scale-ruler';

const ALL_CONTEXTS: readonly ContextId[] = ['planet', 'system', 'galaxy', 'universe'];
const PC_M = CONTEXT_UNIT_METERS.galaxy;
const SPLIT_M = GALACTIC_SURVEY_MIN_PC * PC_M;

describe('scaleRulerSegment (D3 pinned mapping)', () => {
  it('pins the starfield → galactic-survey split at 2,000 pc', () => {
    expect(GALACTIC_SURVEY_MIN_PC).toBe(2_000);
  });

  // Table: every context × boundary distances → the pinned segment.
  const TABLE: ReadonlyArray<[ContextId, number, ScaleRulerSegment]> = [
    ['planet', 0, 'planet'],
    ['planet', 1e30, 'planet'],
    ['system', 0, 'system'],
    ['system', 1e30, 'system'],
    ['galaxy', 0, 'starfield'],
    ['galaxy', 0.06 * PC_M, 'starfield'], // Sol boot vantage (NavDriver INITIAL_CAMERA)
    // NOTE: SPLIT_M - 1 m is below f64 resolution at ~6e19; 1 pc under is the
    // nearest representable "just under the split" that stays meaningful.
    ['galaxy', (GALACTIC_SURVEY_MIN_PC - 1) * PC_M, 'starfield'],
    ['galaxy', SPLIT_M, 'galactic-survey'], // split is inclusive on the survey side
    ['galaxy', 49_000 * PC_M, 'galactic-survey'], // post-viewGalaxy vantage
    ['universe', 0, 'universe'],
    ['universe', 1e30, 'universe'],
  ];

  it.each(TABLE)('%s @ %d m → %s', (contextId, distanceM, expected) => {
    expect(scaleRulerSegment(contextId, distanceM)).toBe(expected);
  });

  it('is monotone in distance within every context (never steps back in scale)', () => {
    // Distances sweeping every regime, strictly increasing.
    const sweep = [0, 1, 1e3, 1e9, 1e12, (GALACTIC_SURVEY_MIN_PC - 1) * PC_M, SPLIT_M, 1e21, 1e30];
    for (const contextId of ALL_CONTEXTS) {
      let lastIdx = -1;
      for (const d of sweep) {
        const idx = SCALE_RULER_SEGMENTS.indexOf(scaleRulerSegment(contextId, d));
        expect(idx).toBeGreaterThanOrEqual(lastIdx);
        lastIdx = idx;
      }
    }
  });

  it('maps every context to at least one segment (mapping is total)', () => {
    for (const contextId of ALL_CONTEXTS) {
      const segments = new Set([
        scaleRulerSegment(contextId, 0),
        scaleRulerSegment(contextId, 1e30),
      ]);
      expect(segments.size).toBeGreaterThanOrEqual(1);
      for (const seg of segments) expect(SCALE_RULER_SEGMENTS).toContain(seg);
    }
  });
});
