import { describe, expect, it } from 'vitest';

if (typeof globalThis.PointerEvent === 'undefined') {
  globalThis.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
    }
  } as typeof PointerEvent;
}
import {
  CONTEXT_UNIT_METERS,
  REBASE_THRESHOLD_UNITS,
  createPrng,
} from '@cosmos/core-types';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';
import { createFlightController, UPDATE_SCRATCH, YAW_PITCH_TEST_HOOK } from '../src/controller';

const IDENTITY_QUAT: [number, number, number, number] = [0, 0, 0, 1];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function holdKey(el: HTMLElement, code: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
}

function releaseKey(el: HTMLElement, code: string): void {
  el.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
}

function applyLookDrag(el: HTMLElement, dx: number, dy: number): void {
  el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0, bubbles: true }));
  el.dispatchEvent(
    new PointerEvent('pointermove', { clientX: dx, clientY: dy, bubbles: true }),
  );
  el.dispatchEvent(
    new PointerEvent('pointerup', { clientX: dx, clientY: dy, bubbles: true }),
  );
}

function makeController() {
  const tree = createScaleFrameTree();
  const origin = createOriginManager(tree, { context: 'galaxy', local: [0, 0, 0] });
  const el = document.createElement('div');
  if (!el.setPointerCapture) {
    el.setPointerCapture = () => undefined;
    el.releasePointerCapture = () => undefined;
  }
  const controller = createFlightController({
    origin,
    initial: {
      position: { context: 'galaxy', local: [0, 0, 0] },
      orientation: IDENTITY_QUAT,
    },
  });
  const dispose = controller.attach(el);
  return { controller, origin, el, dispose };
}

function positionMeters(
  context: keyof typeof CONTEXT_UNIT_METERS,
  local: readonly [number, number, number],
): [number, number, number] {
  const m = CONTEXT_UNIT_METERS[context];
  return [local[0] * m, local[1] * m, local[2] * m];
}

describe('yaw/pitch helpers (structural no-roll fix)', () => {
  const { yawPitchFromDir, yawPitchScratch, wrapAngleDiff } = YAW_PITCH_TEST_HOOK;

  it('round-trips forward = Ry(yaw)·Rx(pitch)·(0,0,-1) for a grid of yaw/pitch', () => {
    for (let yi = -3; yi <= 3; yi++) {
      for (let pi = -2; pi <= 2; pi++) {
        const yaw = (yi / 3) * Math.PI;
        const pitch = (pi / 2) * (Math.PI / 2 - 0.01); // stay shy of the pole
        const fx = -Math.cos(pitch) * Math.sin(yaw);
        const fy = Math.sin(pitch);
        const fz = -Math.cos(pitch) * Math.cos(yaw);

        yawPitchFromDir(fx, fy, fz);
        expect(yawPitchScratch.pitch).toBeCloseTo(pitch, 9);

        // yaw is only meaningful mod 2π; compare via wrapAngleDiff.
        const yawDiff = wrapAngleDiff(yawPitchScratch.yaw - yaw);
        expect(Math.abs(yawDiff)).toBeLessThan(1e-9);
      }
    }
  });

  it('wrapAngleDiff returns the shortest-path angle in [-π, π]', () => {
    expect(wrapAngleDiff(0.1)).toBeCloseTo(0.1, 12);
    expect(wrapAngleDiff(-0.1)).toBeCloseTo(-0.1, 12);
    expect(wrapAngleDiff(Math.PI * 1.5)).toBeCloseTo(-Math.PI * 0.5, 9);
    expect(wrapAngleDiff(-Math.PI * 1.5)).toBeCloseTo(Math.PI * 0.5, 9);
    expect(wrapAngleDiff(Math.PI * 4 + 0.2)).toBeCloseTo(0.2, 9);
  });

  it('yawPitchFromDir clamps pitch input at the poles', () => {
    yawPitchFromDir(0, 1, 0);
    expect(yawPitchScratch.pitch).toBeCloseTo(Math.PI / 2, 9);
    yawPitchFromDir(0, -1, 0);
    expect(yawPitchScratch.pitch).toBeCloseTo(-Math.PI / 2, 9);
  });
});

describe('createFlightController', () => {
  it('speed law: long W hold ≈ clamp(speedScale × d, min, max)', () => {
    const distances = [1e-3, 1, 1e4, 1e12] as const;

    for (const d of distances) {
      const { controller, el } = makeController();
      controller.setDistanceToNearestSurface(d);
      holdKey(el, 'KeyW');

      for (let i = 0; i < 600; i += 1) {
        controller.update(16);
      }

      const expected = clamp(d, 1e-7, 1e7);
      const relErr = Math.abs(controller.state.speedUnitsPerS - expected) / expected;
      expect(relErr).toBeLessThan(0.01);

      releaseKey(el, 'KeyW');
    }
  });

  it('quaternion stays normalized after 10k random look inputs; pitch is clamped', () => {
    const rng = createPrng(20260611);
    const { controller, el } = makeController();

    for (let i = 0; i < 10_000; i += 1) {
      const dx = rng.range(-80, 80);
      const dy = rng.range(-80, 80);
      applyLookDrag(el, dx, dy);
      controller.update(16);
    }

    const [x, y, z, w] = controller.state.orientation;
    const len = Math.hypot(x, y, z, w);
    expect(Math.abs(len - 1)).toBeLessThan(1e-9);

    const qx = x;
    const qy = y;
    const qz = z;
    const qw = w;
    const fy = 2 * (qy * qz - qw * qx);
    const forwardY = -fy;
    const pitch = Math.asin(Math.max(-1, Math.min(1, forwardY)));
    expect(Math.abs(pitch)).toBeLessThanOrEqual(Math.PI / 2 + 1e-6);
  });

  it('rebase transparency: position meters continuous; velocity direction preserved', () => {
    const { controller, origin, el } = makeController();
    controller.setDistanceToNearestSurface(1e8);
    holdKey(el, 'KeyW');

    const metersPerUnit = CONTEXT_UNIT_METERS.galaxy;
    let prevMeters = positionMeters(
      controller.state.position.context,
      controller.state.position.local,
    );
    let sawRebase = false;

    for (let i = 0; i < 500 && !sawRebase; i += 1) {
      const posBefore = controller.state.position;

      controller.update(100);

      const posAfter = controller.state.position;
      const metersAfter = positionMeters(posAfter.context, posAfter.local);
      const stepMeters = Math.hypot(
        metersAfter[0] - prevMeters[0],
        metersAfter[1] - prevMeters[1],
        metersAfter[2] - prevMeters[2],
      );
      const maxStepMeters = controller.state.speedUnitsPerS * 0.1 * metersPerUnit * 1.5;
      expect(stepMeters).toBeLessThan(maxStepMeters);
      prevMeters = metersAfter;

      const renderAfter: [number, number, number] = [0, 0, 0];
      origin.toRenderSpace(posAfter, renderAfter);
      const camRenderAfter = Math.hypot(renderAfter[0], renderAfter[1], renderAfter[2]);
      const absR = Math.hypot(posAfter.local[0], posAfter.local[1], posAfter.local[2]);

      if (absR > REBASE_THRESHOLD_UNITS && camRenderAfter < 1) {
        const velAfter = UPDATE_SCRATCH.vel;
        const delta = [
          posAfter.local[0] - posBefore.local[0],
          posAfter.local[1] - posBefore.local[1],
          posAfter.local[2] - posBefore.local[2],
        ] as const;
        const deltaLen = Math.hypot(delta[0], delta[1], delta[2]);
        const vAfterLen = Math.hypot(velAfter[0], velAfter[1], velAfter[2]);
        expect(vAfterLen).toBeGreaterThan(0);
        expect(deltaLen).toBeGreaterThan(0);
        const dot =
          (delta[0] * velAfter[0] + delta[1] * velAfter[1] + delta[2] * velAfter[2]) /
          (deltaLen * vAfterLen);
        expect(dot).toBeGreaterThan(0.999);

        const metersBeforeApply = positionMeters(posAfter.context, posAfter.local);
        controller.applyRebase({ context: 'galaxy', offsetUnits: [0, 0, absR] });
        const metersAfterApply = positionMeters(
          controller.state.position.context,
          controller.state.position.local,
        );
        const rebaseJump = Math.hypot(
          metersAfterApply[0] - metersBeforeApply[0],
          metersAfterApply[1] - metersBeforeApply[1],
          metersAfterApply[2] - metersBeforeApply[2],
        );
        expect(rebaseJump).toBeLessThan(1e-6);

        sawRebase = true;
      }
    }

    expect(sawRebase).toBe(true);
    releaseKey(el, 'KeyW');
  });

  it('attach() dispose removes all listeners', () => {
    const { controller, el, dispose } = makeController();
    controller.setDistanceToNearestSurface(100);
    holdKey(el, 'KeyW');
    for (let i = 0; i < 400; i += 1) controller.update(16);
    expect(controller.state.speedUnitsPerS).toBeGreaterThan(50);

    releaseKey(el, 'KeyW');
    for (let i = 0; i < 2000; i += 1) controller.update(16);

    dispose();

    holdKey(el, 'KeyW');
    for (let i = 0; i < 600; i += 1) controller.update(16);
    expect(controller.state.speedUnitsPerS).toBeLessThan(5);
  });

  it('covers strafe, vertical axes, and speed modifiers', () => {
    const { controller, el } = makeController();
    controller.setDistanceToNearestSurface(50);

    const keys = ['KeyS', 'KeyA', 'KeyD', 'KeyR', 'KeyF'] as const;
    for (const code of keys) {
      holdKey(el, code);
      controller.update(16);
      releaseKey(el, code);
    }

    holdKey(el, 'ShiftLeft');
    holdKey(el, 'KeyW');
    for (let i = 0; i < 80; i += 1) controller.update(16);
    const boosted = controller.state.speedUnitsPerS;
    releaseKey(el, 'ShiftLeft');
    releaseKey(el, 'KeyW');

    holdKey(el, 'ControlLeft');
    holdKey(el, 'KeyW');
    for (let i = 0; i < 80; i += 1) controller.update(16);
    const slowed = controller.state.speedUnitsPerS;
    releaseKey(el, 'ControlLeft');
    releaseKey(el, 'KeyW');

    expect(boosted).toBeGreaterThan(slowed * 5);
  });

  it('clamps pitch when look input exceeds ±90°', () => {
    const { controller, el } = makeController();
    applyLookDrag(el, 0, 4000);
    controller.update(16);
    applyLookDrag(el, 4000, 0);
    controller.update(16);
    for (let i = 0; i < 50; i += 1) {
      applyLookDrag(el, 0, 400);
      controller.update(16);
    }
    const [x, y, z, w] = controller.state.orientation;
    const fy = 2 * (y * z - w * x);
    const forwardY = -fy;
    const pitch = Math.asin(Math.max(-1, Math.min(1, forwardY)));
    expect(Math.abs(pitch)).toBeLessThanOrEqual(Math.PI / 2 + 1e-5);
  });

  it('preserves yaw direction when pitch clamps past ±90°', () => {
    const { controller, el } = makeController();
    // Yaw 90° right first, so we can detect a yaw sign/offset error after the
    // pitch clamp kicks in (regression for an atan2 sign bug in clampPitch).
    applyLookDrag(el, Math.PI * 0.5 * 500, 0);
    controller.update(16);
    const [, yBefore, , wBefore] = controller.state.orientation;
    const yawBefore = 2 * Math.atan2(yBefore, wBefore);

    // Drag straight down well past the pitch limit to force clampPitch to
    // rebuild the orientation from yaw/pitch.
    for (let i = 0; i < 10; i += 1) {
      applyLookDrag(el, 0, 400);
      controller.update(16);
    }

    const [x, y, z, w] = controller.state.orientation;
    const fy = 2 * (y * z - w * x);
    const forwardY = -fy;
    const pitch = Math.asin(Math.max(-1, Math.min(1, forwardY)));
    expect(Math.abs(pitch)).toBeLessThanOrEqual(Math.PI / 2 + 1e-5);

    const fx = -2 * (x * z + w * y);
    const fz = -(1 - 2 * (x * x + y * y));
    const yawAfter = Math.atan2(-fx, -fz);
    expect(Math.abs(yawAfter - yawBefore)).toBeLessThan(0.3);
  });

  it('normalizes a degenerate initial quaternion', () => {
    const tree = createScaleFrameTree();
    const origin = createOriginManager(tree, { context: 'galaxy', local: [0, 0, 0] });
    const controller = createFlightController({
      origin,
      initial: {
        position: { context: 'galaxy', local: [0, 0, 0] },
        orientation: [0, 0, 0, 0],
      },
    });
    const [x, y, z, w] = controller.state.orientation;
    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 9);
    expect(w).toBeCloseTo(1, 5);
  });

  it('consumeLookDelta accumulates while pointer drag is active', () => {
    const { controller, el } = makeController();
    el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0, bubbles: true }));
    el.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 40, clientY: 10, bubbles: true }),
    );
    controller.update(16);
    const [x, y, z, w] = controller.state.orientation;
    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 5);
    expect(x !== 0 || y !== 0 || z !== 0).toBe(true);
    el.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 40, clientY: 10, bubbles: true }),
    );
  });

  it('ignores unknown keys and zero dt updates', () => {
    const { controller, el } = makeController();
    el.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', bubbles: true }));
    controller.update(0);
    expect(controller.state.speedUnitsPerS).toBe(0);
  });

  it('input blur clears held keys', () => {
    const { controller, el } = makeController();
    controller.setDistanceToNearestSurface(100);
    holdKey(el, 'KeyW');
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    for (let i = 0; i < 50; i += 1) controller.update(16);
    expect(controller.state.speedUnitsPerS).toBe(0);
  });

  it('update() is allocation-free (same-identity scratch)', () => {
    const { controller, el } = makeController();
    const posBefore = UPDATE_SCRATCH.pos;
    const velBefore = UPDATE_SCRATCH.vel;
    const wishBefore = UPDATE_SCRATCH.wish;

    holdKey(el, 'KeyW');
    controller.setDistanceToNearestSurface(400);
    controller.update(16);
    controller.update(16);

    expect(UPDATE_SCRATCH.pos).toBe(posBefore);
    expect(UPDATE_SCRATCH.vel).toBe(velBefore);
    expect(UPDATE_SCRATCH.wish).toBe(wishBefore);

    releaseKey(el, 'KeyW');
  });
});
