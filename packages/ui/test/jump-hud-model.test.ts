import { describe, expect, it } from 'vitest';
import {
  FULL_ARRIVAL_CARD_JUMPS,
  JUMP_HUD_IDLE,
  METERS_PER_LY,
  PC_TO_LY,
  beginJump,
  dampeningAtArrival,
  dampeningAtJumpStart,
  endJump,
  updateRemaining,
  type JumpDampening,
} from '../src/jump-hud-model';
import { SCALE_JUMP_THRESHOLD_PC } from '../src/strings';

const FRESH: JumpDampening = { largeJumpCount: 0, letterboxShown: false };

describe('beginJump — threshold gating (shared S2/D4/W2 gate)', () => {
  it('returns null below the scale-jump threshold', () => {
    expect(beginJump(SCALE_JUMP_THRESHOLD_PC - 1, FRESH)).toBeNull();
    expect(beginJump(0, FRESH)).toBeNull();
    expect(beginJump(NaN, FRESH)).toBeNull();
  });

  it('starts a jump at/above the threshold with pc→ly totals and an @ c line', () => {
    const distancePc = 49_000; // viewGalaxy-order jump
    const model = beginJump(distancePc, FRESH);
    expect(model).not.toBeNull();
    expect(model!.phase).toBe('jumping');
    expect(model!.distanceTotalLy).toBeCloseTo(distancePc * PC_TO_LY, 6);
    expect(model!.distanceRemainingLy).toBe(model!.distanceTotalLy);
    expect(model!.etaAtC).toContain('at c');
    expect(model!.etaAtC).toContain('years');
  });

  it('gates inclusively at exactly the threshold', () => {
    expect(beginJump(SCALE_JUMP_THRESHOLD_PC, FRESH)).not.toBeNull();
  });
});

describe('W2a dampening decisions at jump start', () => {
  it('shows the full arrival card only while the prior count is under the cap', () => {
    for (let count = 0; count < FULL_ARRIVAL_CARD_JUMPS; count++) {
      const model = beginJump(1000, { largeJumpCount: count, letterboxShown: true });
      expect(model!.showFullArrivalCard).toBe(true);
    }
    const damped = beginJump(1000, {
      largeJumpCount: FULL_ARRIVAL_CARD_JUMPS,
      letterboxShown: true,
    });
    expect(damped!.showFullArrivalCard).toBe(false);
  });

  it('letterboxes the first large jump only', () => {
    expect(beginJump(1000, FRESH)!.letterbox).toBe(true);
    expect(beginJump(1000, { ...FRESH, letterboxShown: true })!.letterbox).toBe(false);
  });

  it('counter transitions: letterbox flag latches at start, count grows at arrival', () => {
    const first = beginJump(1000, FRESH)!;
    const afterStart = dampeningAtJumpStart(FRESH, first);
    expect(afterStart.letterboxShown).toBe(true);
    expect(afterStart.largeJumpCount).toBe(0); // start does NOT count a jump

    const afterArrival = dampeningAtArrival(afterStart);
    expect(afterArrival.largeJumpCount).toBe(1);

    // A jump that showed no letterbox leaves the flag untouched.
    const second = beginJump(1000, afterArrival)!;
    expect(second.letterbox).toBe(false);
    expect(dampeningAtJumpStart(afterArrival, second)).toEqual(afterArrival);
  });

  it('a full-card→brief transition happens after exactly the capped jump count', () => {
    let damp = FRESH;
    for (let jump = 1; jump <= FULL_ARRIVAL_CARD_JUMPS + 1; jump++) {
      const model = beginJump(1000, damp)!;
      expect(model.showFullArrivalCard).toBe(jump <= FULL_ARRIVAL_CARD_JUMPS);
      damp = dampeningAtArrival(dampeningAtJumpStart(damp, model));
    }
  });
});

describe('updateRemaining — live distance ticks', () => {
  const model = beginJump(1000, FRESH)!;

  it('converts meters to ly', () => {
    const halfLy = model.distanceTotalLy / 2;
    const ticked = updateRemaining(model, halfLy * METERS_PER_LY);
    expect(ticked.distanceRemainingLy).toBeCloseTo(halfLy, 6);
    expect(ticked.phase).toBe('jumping');
  });

  it('clamps to [0, total] against float noise near arrival', () => {
    expect(updateRemaining(model, -5).distanceRemainingLy).toBe(0);
    expect(
      updateRemaining(model, model.distanceTotalLy * METERS_PER_LY * 10).distanceRemainingLy,
    ).toBe(model.distanceTotalLy);
  });

  it('is a no-op outside the jumping phase', () => {
    expect(updateRemaining(JUMP_HUD_IDLE, 1e20)).toBe(JUMP_HUD_IDLE);
  });
});

describe('endJump — arrival vs. cancel', () => {
  const model = beginJump(1000, FRESH)!;

  it('completed arrival morphs into the arrived phase with zero remaining', () => {
    const arrived = endJump(model, true);
    expect(arrived.phase).toBe('arrived');
    expect(arrived.distanceRemainingLy).toBe(0);
    expect(arrived.distanceTotalLy).toBe(model.distanceTotalLy);
    expect(arrived.showFullArrivalCard).toBe(model.showFullArrivalCard);
  });

  it('cancel path: no arrival card — straight back to idle', () => {
    expect(endJump(model, false)).toEqual(JUMP_HUD_IDLE);
  });

  it('is a no-op outside the jumping phase', () => {
    expect(endJump(JUMP_HUD_IDLE, true)).toBe(JUMP_HUD_IDLE);
    const arrived = endJump(model, true);
    expect(endJump(arrived, false)).toBe(arrived);
  });
});
