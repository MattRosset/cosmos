import { describe, expect, it } from 'vitest';
import type { UniversePosition } from '../src/coords';
import type { CameraKeyframe, CameraSpline } from '../src/cinematic';

describe('CameraKeyframe / CameraSpline shape', () => {
  it('type-checks a spline with UniversePosition keyframes', () => {
    const at: UniversePosition = { context: 'system', local: [10, 0, 0] };
    const lookAt: UniversePosition = { context: 'system', local: [0, 0, 0] };
    const keyframe: CameraKeyframe = { at, lookAt, timeMs: 0 };
    const spline: CameraSpline = {
      id: 'flyby',
      keyframes: [keyframe, { at: lookAt, lookAt: at, timeMs: 3000 }],
      letterbox: true,
    };
    expect(spline.keyframes).toHaveLength(2);
    expect(spline.letterbox).toBe(true);
  });

  it('letterbox is optional (omitting it type-checks)', () => {
    const spline: CameraSpline = { id: 'x', keyframes: [] };
    expect(spline.letterbox).toBeUndefined();
  });

  it('rejects a keyframe whose `at` is a bare tuple, not a UniversePosition (compile-time only)', () => {
    const lookAt: UniversePosition = { context: 'system', local: [0, 0, 0] };
    const keyframe: CameraKeyframe = {
      // @ts-expect-error — `at` must be a UniversePosition, not a bare tuple
      at: [10, 0, 0],
      lookAt,
      timeMs: 0,
    };
    expect(keyframe).toBeDefined();
  });

  it('rejects mutation of readonly fields (compile-time only)', () => {
    const at: UniversePosition = { context: 'system', local: [0, 0, 0] };
    const keyframe: CameraKeyframe = { at, lookAt: at, timeMs: 0 };
    // @ts-expect-error — readonly field cannot be reassigned
    keyframe.timeMs = 5;
    expect(keyframe).toBeDefined();
  });
});
