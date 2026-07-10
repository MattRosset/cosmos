import { describe, expect, it } from 'vitest';
import { STRINGS, SCALE_JUMP_THRESHOLD_PC } from '../src/strings';

describe('perception strings', () => {
  it('exposes the shared scale-jump threshold as a positive parsec count', () => {
    expect(SCALE_JUMP_THRESHOLD_PC).toBeGreaterThan(0);
  });

  it('provides distinct movement-mode labels', () => {
    expect(STRINGS.modeScaleJump).not.toBe(STRINGS.modeExploring);
  });

  it('has no empty copy values', () => {
    for (const value of Object.values(STRINGS)) {
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
