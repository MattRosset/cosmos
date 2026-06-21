import { describe, expect, it } from 'vitest';
import type { Tour, TourStep } from '../src/tour';

describe('Tour / TourStep shape', () => {
  it('type-checks a Tour literal with two steps', () => {
    const stepOne: TourStep = {
      targetId: 'sol',
      title: 'Our Star',
      narration: 'The Sun is the star at the center of the Solar System.',
      dwellMs: 6000,
    };
    const stepTwo: TourStep = {
      targetId: 'earth',
      title: 'Home',
      narration: 'Earth is the third planet from the Sun.',
      dwellMs: 5000,
      orbit: true,
    };
    const tour: Tour = {
      id: 'inner-system',
      name: 'The Inner System',
      steps: [stepOne, stepTwo],
    };
    expect(tour.steps).toHaveLength(2);
    expect(tour.steps[1]?.orbit).toBe(true);
  });

  it('orbit is optional (omitting it type-checks)', () => {
    const step: TourStep = {
      targetId: 'mars',
      title: 'Mars',
      narration: 'The red planet.',
      dwellMs: 4000,
    };
    expect(step.orbit).toBeUndefined();
  });

  it('rejects mutation of readonly fields (compile-time only)', () => {
    const step: TourStep = {
      targetId: 'sol',
      title: 'Our Star',
      narration: '…',
      dwellMs: 6000,
    };
    // @ts-expect-error — readonly field cannot be reassigned
    step.dwellMs = 1;
    expect(step).toBeDefined();
  });
});
