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
  type CameraKeyframe,
  type CameraSpline,
} from '@cosmos/core-types';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';
import {
  createFlightController,
  UPDATE_SCRATCH,
  type FlightControllerOptions,
} from '../src/controller';

const IDENTITY_QUAT: [number, number, number, number] = [0, 0, 0, 1];
const DT_MS = 16.67;

type Vec3 = [number, number, number];

function makeController(
  treeSetup?: (tree: ReturnType<typeof createScaleFrameTree>) => void,
  extra?: Partial<FlightControllerOptions>,
) {
  const tree = createScaleFrameTree();
  if (treeSetup) treeSetup(tree);
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
    ...extra,
  });
  const dispose = controller.attach(el);
  return { controller, origin, tree, el, dispose };
}

function holdKey(el: HTMLElement, code: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
}
function releaseKey(el: HTMLElement, code: string): void {
  el.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
}

/** Render-space vector from the camera to a galaxy-frame point (context units). */
function camToPoint(
  origin: ReturnType<typeof createOriginManager>,
  local: Vec3,
): Vec3 {
  const out: Vec3 = [0, 0, 0];
  origin.toRenderSpace({ context: 'galaxy', local }, out);
  return out;
}

/** Distance from the camera to a galaxy-frame point, in context units. */
function distUnits(origin: ReturnType<typeof createOriginManager>, local: Vec3): number {
  const v = camToPoint(origin, local);
  return Math.hypot(v[0], v[1], v[2]);
}

function kf(at: Vec3, lookAt: Vec3, timeMs: number): CameraKeyframe {
  return { at: { context: 'galaxy', local: at }, lookAt: { context: 'galaxy', local: lookAt }, timeMs };
}

// ─── Spline playback: passes through keyframes, curves, fires onEnd once ───────

describe('playSpline keyframe interpolation', () => {
  const FAR: Vec3 = [10, 20, 100]; // shared look-at; orientation only

  function lShapedSpline(letterbox = false): CameraSpline {
    return {
      id: 'test',
      letterbox,
      keyframes: [
        kf([0, 0, 0], FAR, 0),
        kf([10, 0, 0], FAR, 1000),
        kf([10, 20, 0], FAR, 2000),
      ],
    };
  }

  it('camera reaches each keyframe; midpoint follows the centripetal curve (not a lerp)', () => {
    const { controller, origin } = makeController();

    let ended = 0;
    let endResult: boolean | null = null;
    controller.playSpline(lShapedSpline(), {
      onEnd: (c) => {
        ended += 1;
        endResult = c;
      },
    });
    expect(controller.cinematicActive).toBe(true);

    let midDeviation = -1;
    let nearKf1 = Infinity;
    let elapsed = 0;
    let frames = 0;
    const maxFrames = Math.ceil((2000 * 1.5) / DT_MS);

    while (controller.cinematicActive && frames < maxFrames) {
      controller.update(DT_MS);
      elapsed += DT_MS;
      frames += 1;

      // Midway through the first segment, the camera must bow off the straight
      // chord from kf0→kf1 (centripetal curvature pulled toward kf2).
      if (midDeviation < 0 && elapsed >= 500) {
        const p = camToPoint(origin, [0, 0, 0]); // camera relative to kf0 origin
        const camX = -p[0];
        const camY = -p[1];
        const camZ = -p[2];
        // straight-lerp midpoint of kf0→kf1 is [5,0,0]
        midDeviation = Math.hypot(camX - 5, camY - 0, camZ - 0);
      }
      if (elapsed >= 1000) {
        nearKf1 = Math.min(nearKf1, distUnits(origin, [10, 0, 0]));
      }
    }

    expect(controller.cinematicActive).toBe(false);
    expect(ended).toBe(1);
    expect(endResult).toBe(true);

    // Curvature: a real curve deviates from the chord; a straight lerp would not.
    expect(midDeviation).toBeGreaterThan(0.05);
    // Passes through the middle keyframe.
    expect(nearKf1).toBeLessThan(0.5);
    // Ends on the final keyframe.
    expect(distUnits(origin, [10, 20, 0])).toBeLessThan(1e-6);
  });

  it('letterboxActive tracks a letterbox spline and clears at the end', () => {
    const { controller } = makeController();
    expect(controller.letterboxActive).toBe(false);

    controller.playSpline(lShapedSpline(true));
    controller.update(DT_MS);
    expect(controller.letterboxActive).toBe(true);

    while (controller.cinematicActive) controller.update(DT_MS);
    expect(controller.letterboxActive).toBe(false);
  });

  it('a non-letterbox spline never sets letterboxActive', () => {
    const { controller } = makeController();
    controller.playSpline(lShapedSpline(false));
    controller.update(DT_MS);
    expect(controller.cinematicActive).toBe(true);
    expect(controller.letterboxActive).toBe(false);
    controller.cancelCinematic();
  });
});

// ─── Cancel on input ──────────────────────────────────────────────────────────

describe('cinematic cancels on user input', () => {
  it('a WASD key mid-playback fires onEnd(false) and resumes free flight', () => {
    const { controller, el } = makeController();
    controller.setDistanceToNearestSurface(50);

    let ended = 0;
    let endResult: boolean | null = null;
    controller.playSpline(
      {
        id: 'c',
        keyframes: [
          kf([0, 0, 0], [0, 0, -1], 0),
          kf([100, 0, 0], [0, 0, -1], 4000),
        ],
      },
      { onEnd: (c) => { ended += 1; endResult = c; } },
    );

    for (let i = 0; i < 10; i++) controller.update(DT_MS);
    expect(controller.cinematicActive).toBe(true);

    holdKey(el, 'KeyW');
    controller.update(DT_MS);

    expect(ended).toBe(1);
    expect(endResult).toBe(false);
    expect(controller.cinematicActive).toBe(false);

    // Free flight resumes.
    for (let i = 0; i < 200; i++) controller.update(DT_MS);
    expect(controller.state.speedUnitsPerS).toBeGreaterThan(0.001);
    releaseKey(el, 'KeyW');
  });
});

// ─── Pause / resume ───────────────────────────────────────────────────────────

describe('pauseCinematic / resumeCinematic', () => {
  it('pause freezes position; resume continues from the same parameter', () => {
    const { controller, origin } = makeController();
    controller.playSpline({
      id: 'p',
      keyframes: [
        kf([0, 0, 0], [0, 0, -1], 0),
        kf([10, 0, 0], [0, 0, -1], 2000),
      ],
    });

    for (let i = 0; i < 30; i++) controller.update(DT_MS);
    const before = controller.state.position.local;
    const frozen: Vec3 = [before[0], before[1], before[2]];

    controller.pauseCinematic();
    for (let i = 0; i < 60; i++) controller.update(DT_MS);
    const paused = controller.state.position.local;
    const drift = Math.hypot(
      paused[0] - frozen[0],
      paused[1] - frozen[1],
      paused[2] - frozen[2],
    );
    expect(drift).toBeLessThan(1e-9);
    expect(controller.cinematicActive).toBe(true);

    // Resume → motion continues and the spline completes.
    controller.resumeCinematic();
    let frames = 0;
    while (controller.cinematicActive && frames < 400) {
      controller.update(DT_MS);
      frames += 1;
    }
    expect(controller.cinematicActive).toBe(false);
    expect(distUnits(origin, [10, 0, 0])).toBeLessThan(1e-6);
  });
});

// ─── Auto-orbit ───────────────────────────────────────────────────────────────

describe('orbitBody', () => {
  it('circles the center at ~radius, faces it, at the requested rate', () => {
    const CENTER: Vec3 = [3, 0, 0];
    const RADIUS_M = 0.5 * CONTEXT_UNIT_METERS.galaxy; // 0.5 pc → 0.5 units
    const RATE = 0.2;
    const { controller, origin } = makeController();

    controller.orbitBody({
      center: { context: 'galaxy', local: CENTER },
      radiusM: RADIUS_M,
      ratePerSec: RATE,
    });

    // Warm up so the look-at slew converges before we assert facing.
    for (let i = 0; i < 60; i++) controller.update(DT_MS);

    const radii: number[] = [];
    for (let i = 0; i < 120; i++) {
      controller.update(DT_MS);
      radii.push(distUnits(origin, CENTER));

      // Camera forward must point at the center.
      const toCenter = camToPoint(origin, CENTER);
      const len = Math.hypot(toCenter[0], toCenter[1], toCenter[2]);
      const [qx, qy, qz, qw] = controller.state.orientation;
      // forward = rotate [0,0,-1] by orientation
      const tx = 2 * (qy * -1);
      const ty = 2 * (-qx * -1);
      const fx = qw * tx + (qy * 0 - qz * ty);
      const fy = qw * ty + (qz * tx - qx * 0);
      const fz = -1 + (qx * ty - qy * tx);
      const dot = (fx * toCenter[0] + fy * toCenter[1] + fz * toCenter[2]) / len;
      expect(dot).toBeGreaterThan(0.99);
    }

    // Radius stays ~constant near the requested value.
    for (const r of radii) {
      expect(Math.abs(r - 0.5)).toBeLessThan(0.05);
    }
    expect(controller.cinematicActive).toBe(true);
    controller.cancelCinematic();
    expect(controller.cinematicActive).toBe(false);
  });
});

// ─── Context-switch + rebase survival, zero allocation ────────────────────────

describe('cinematic survives a context switch mid-playback', () => {
  it('switches galaxy→system while the spline keeps playing and completes', () => {
    const SYSTEM_PC = 10;
    const { controller, origin } = makeController(
      (tree) => tree.setAnchor('system', [SYSTEM_PC, 0, 0]),
      {
        // Generous enter gap so the switch fires well before arrival.
        contextSwitchPolicy: { enterSystemAtM: 6.17e16, exitSystemAtM: 1.6e17 },
      },
    );
    controller.setSystemAnchor({ id: 'sol', positionPc: [SYSTEM_PC, 0, 0] });

    controller.playSpline({
      id: 'descend',
      keyframes: [
        kf([0, 0, 0], [SYSTEM_PC, 0, 0], 0),
        kf([5, 0, 0], [SYSTEM_PC, 0, 0], 1000),
        kf([10, 0, 0], [SYSTEM_PC, 0, 0], 2000),
      ],
    });

    let sawSystemWhilePlaying = false;
    let frames = 0;
    while (controller.cinematicActive && frames < 400) {
      controller.update(DT_MS);
      frames += 1;
      if (controller.contextId === 'system' && controller.cinematicActive) {
        sawSystemWhilePlaying = true;
      }
    }

    expect(sawSystemWhilePlaying).toBe(true);
    expect(controller.contextId).toBe('system');
    expect(controller.cinematicActive).toBe(false);

    // Final keyframe (galaxy [10,0,0]) is the system origin → camera ends there.
    const out: Vec3 = [0, 0, 0];
    origin.toRenderSpace({ context: 'system', local: [0, 0, 0] }, out);
    expect(Math.hypot(out[0], out[1], out[2])).toBeLessThan(1e-3);
  });

  it('a long spline crosses a rebase smoothly and arrives', () => {
    const { controller, origin } = makeController();
    const END: Vec3 = [60000, 0, 0]; // crosses REBASE_THRESHOLD_UNITS

    controller.playSpline({
      id: 'long',
      keyframes: [
        kf([0, 0, 0], END, 0),
        kf([30000, 0, 0], END, 3000),
        kf(END, END, 6000),
      ],
    });

    const dists: number[] = [];
    let frames = 0;
    const maxFrames = Math.ceil((6000 * 1.5) / DT_MS);
    while (controller.cinematicActive && frames < maxFrames) {
      dists.push(distUnits(origin, END));
      controller.update(DT_MS);
      frames += 1;
    }

    expect(controller.cinematicActive).toBe(false);
    expect(distUnits(origin, END)).toBeLessThan(1e-3);

    // Smoothness: after warm-up, no step is wildly larger than its predecessor.
    for (let i = 11; i < dists.length; i++) {
      const prev = dists[i - 1]! - dists[i - 2]!;
      const curr = dists[i]! - dists[i - 1]!;
      if (prev < -1e-30) {
        expect(Math.abs(curr)).toBeLessThanOrEqual(Math.abs(prev) * 3);
      }
    }
  });

  it('update() is allocation-free during cinematic playback (same-identity scratch)', () => {
    const { controller } = makeController();
    controller.playSpline({
      id: 'alloc',
      keyframes: [
        kf([0, 0, 0], [0, 0, -1], 0),
        kf([10, 0, 0], [0, 0, -1], 2000),
      ],
    });

    const posBefore = UPDATE_SCRATCH.pos;
    const cinePosBefore = UPDATE_SCRATCH.cinePos;
    const cineLookBefore = UPDATE_SCRATCH.cineLook;
    const cineP1Before = UPDATE_SCRATCH.cineP1;

    for (let i = 0; i < 10 && controller.cinematicActive; i++) {
      controller.update(DT_MS);
    }

    expect(UPDATE_SCRATCH.pos).toBe(posBefore);
    expect(UPDATE_SCRATCH.cinePos).toBe(cinePosBefore);
    expect(UPDATE_SCRATCH.cineLook).toBe(cineLookBefore);
    expect(UPDATE_SCRATCH.cineP1).toBe(cineP1Before);
  });
});

// ─── Mutual exclusion with goTo ───────────────────────────────────────────────

describe('cinematic and goTo are mutually exclusive', () => {
  it('playSpline cancels an in-flight goTo', () => {
    const { controller } = makeController();
    controller.goTo({
      target: { context: 'galaxy', local: [100, 0, 0] },
      arrivalDistanceM: 1e13,
      durationMs: 6000,
    });
    let gotoEnd: boolean | null = null;
    controller.onGoToEnd((c) => { gotoEnd = c; });

    for (let i = 0; i < 5; i++) controller.update(DT_MS);
    expect(controller.goToActive).toBe(true);

    controller.playSpline({
      id: 's',
      keyframes: [kf([0, 0, 0], [0, 0, -1], 0), kf([5, 0, 0], [0, 0, -1], 1000)],
    });

    expect(gotoEnd).toBe(false);
    expect(controller.goToActive).toBe(false);
    expect(controller.cinematicActive).toBe(true);
  });

  it('an empty spline calls onEnd(true) immediately and starts nothing', () => {
    const { controller } = makeController();
    let ended: boolean | null = null;
    controller.playSpline({ id: 'empty', keyframes: [] }, { onEnd: (c) => { ended = c; } });
    expect(ended).toBe(true);
    expect(controller.cinematicActive).toBe(false);
  });
});
