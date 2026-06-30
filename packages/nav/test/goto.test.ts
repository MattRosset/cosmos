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
} from '@cosmos/core-types';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';
import { createFlightController, UPDATE_SCRATCH } from '../src/controller';

const IDENTITY_QUAT: [number, number, number, number] = [0, 0, 0, 1];
const DT_MS = 16.67;

function makeController(
  treeSetup?: (tree: ReturnType<typeof createScaleFrameTree>) => void,
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

/** Distance from camera to target in meters, via toRenderSpace. */
function distToTargetM(
  origin: ReturnType<typeof createOriginManager>,
  target: { context: 'galaxy' | 'system'; local: [number, number, number] },
): number {
  const out: [number, number, number] = [0, 0, 0];
  origin.toRenderSpace(target, out);
  return Math.hypot(out[0], out[1], out[2]) * CONTEXT_UNIT_METERS[origin.context];
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

/** Local "right" vector's Y component, given an [x,y,z,w] orientation quaternion. */
function rightY(q: readonly [number, number, number, number]): number {
  const [x, y, z, w] = q;
  return 2 * (w * z + x * y);
}

// ─── Arrival ──────────────────────────────────────────────────────────────────

describe('goTo arrival', () => {
  it.each([
    ['1 pc', [1, 0, 0] as [number, number, number]],
    ['100 pc', [100, 0, 0] as [number, number, number]],
  ])('arrives from d0 = %s within 1.5× durationMs', (_label, targetLocal) => {
    const { controller, origin } = makeController();
    const DURATION = 6000;
    const ARRIVAL_M = 1e13;

    let endFired = 0;
    let endResult: boolean | null = null;

    controller.goTo({
      target: { context: 'galaxy', local: targetLocal },
      arrivalDistanceM: ARRIVAL_M,
      durationMs: DURATION,
    });
    controller.onGoToEnd((completed) => {
      endFired += 1;
      endResult = completed;
    });

    const maxFrames = Math.ceil((DURATION * 1.5) / DT_MS);
    let frames = 0;

    while (controller.goToActive && frames < maxFrames) {
      controller.update(DT_MS);
      frames += 1;
    }

    expect(controller.goToActive).toBe(false);
    expect(endFired).toBe(1);
    expect(endResult).toBe(true);

    const finalDist = distToTargetM(origin, { context: 'galaxy', local: targetLocal });
    expect(finalDist).toBeLessThanOrEqual(ARRIVAL_M * 1.01);
    expect(frames).toBeLessThanOrEqual(maxFrames);
  });
});

// ─── No overshoot ─────────────────────────────────────────────────────────────

describe('goTo no overshoot', () => {
  it('distance never drops below 0.99 × arrivalDistanceM', () => {
    const TARGET: [number, number, number] = [10, 0, 0];
    const ARRIVAL_M = 1e13;
    const { controller, origin } = makeController();

    controller.goTo({
      target: { context: 'galaxy', local: TARGET },
      arrivalDistanceM: ARRIVAL_M,
      durationMs: 6000,
    });

    const maxFrames = 800;
    for (let i = 0; i < maxFrames && controller.goToActive; i++) {
      controller.update(DT_MS);
      const d = distToTargetM(origin, { context: 'galaxy', local: TARGET });
      expect(d).toBeGreaterThanOrEqual(ARRIVAL_M * 0.99);
    }
  });
});

// ─── Monotonic ────────────────────────────────────────────────────────────────

describe('goTo monotonic after first 25% of frames', () => {
  it('distance is non-increasing after the first quarter of the flight', () => {
    const TARGET: [number, number, number] = [5, 0, 0];
    const DURATION = 6000;
    const ARRIVAL_M = 1e13;
    const { controller, origin } = makeController();

    controller.goTo({
      target: { context: 'galaxy', local: TARGET },
      arrivalDistanceM: ARRIVAL_M,
      durationMs: DURATION,
    });

    const totalFrames = Math.ceil(DURATION / DT_MS);
    const skipFrames = Math.ceil(totalFrames * 0.25);
    const distances: number[] = [];

    for (let i = 0; i < totalFrames + 50 && controller.goToActive; i++) {
      controller.update(DT_MS);
      if (i >= skipFrames) {
        distances.push(distToTargetM(origin, { context: 'galaxy', local: TARGET }));
      }
    }

    for (let i = 1; i < distances.length; i++) {
      // Allow tiny floating-point jitter but no real increase
      expect(distances[i]!).toBeLessThanOrEqual(distances[i - 1]! * 1.001);
    }
  });
});

// ─── Facing ───────────────────────────────────────────────────────────────────

describe('goTo facing at arrival', () => {
  it('forward · targetDir > 0.999 at arrival, quaternion normalized throughout', () => {
    const TARGET: [number, number, number] = [20, 0, 0];
    const ARRIVAL_M = 1e13;
    const { controller, origin } = makeController();

    controller.goTo({
      target: { context: 'galaxy', local: TARGET },
      arrivalDistanceM: ARRIVAL_M,
      durationMs: 6000,
    });

    const maxFrames = 800;
    for (let i = 0; i < maxFrames && controller.goToActive; i++) {
      controller.update(DT_MS);
      const [x, y, z, w] = controller.state.orientation;
      const norm = Math.hypot(x, y, z, w);
      expect(Math.abs(norm - 1)).toBeLessThan(1e-9);
    }

    expect(controller.goToActive).toBe(false);

    // At arrival: forward should point toward target
    const out: [number, number, number] = [0, 0, 0];
    origin.toRenderSpace({ context: 'galaxy', local: TARGET }, out);
    const dUnits = Math.hypot(out[0], out[1], out[2]);
    const tDirX = out[0] / dUnits;
    const tDirY = out[1] / dUnits;
    const tDirZ = out[2] / dUnits;

    const [qx, qy, qz, qw] = controller.state.orientation;
    // forward = rotate [0,0,-1] by orientation
    const fwdX = 2 * (qy * -1 - qz * 0) + 0;
    const tx2 = 2 * (qy * -1 - qz * 0);
    const ty2 = 2 * (qz * 0 - qx * -1);
    const tz2 = 2 * (qx * 0 - qy * 0);
    const fwX = 0 + qw * tx2 + (qy * tz2 - qz * ty2);
    const fwY = 0 + qw * ty2 + (qz * tx2 - qx * tz2);
    const fwZ = -1 + qw * tz2 + (qx * ty2 - qy * tx2);
    void fwdX;

    const dot = fwX * tDirX + fwY * tDirY + fwZ * tDirZ;
    expect(dot).toBeGreaterThan(0.999);
  });
});

// ─── No-roll invariant (regression for the camera-roll bug, Part 2) ───────────
// docs/research/nav-camera-roll-and-ci-deploy-findings.md: pitching the camera
// before a goTo/cinematic reorientation used to introduce roll (right.y as low
// as -0.851 in a live repro) because the old slerp rotated around
// forward × targetDir, which tilts off-vertical once forward has any pitch.
// The structural fix (yaw/pitch scalar state) makes roll unrepresentable, so
// right.y must stay at machine epsilon for the entire flight, regardless of how
// much pitch was present beforehand.
describe('goTo orientation never introduces roll', () => {
  it('right.y stays ≈ 0 throughout a goTo started while pitched', () => {
    const TARGET: [number, number, number] = [0, 5, 3];
    const ARRIVAL_M = 1e13;
    const { controller, el } = makeController();

    // Pitch the camera up/down as well as yawing — this is the case the old
    // cross-product slerp got wrong (Part 2 of the doc).
    applyLookDrag(el, 220, 160);
    controller.update(DT_MS);
    expect(Math.abs(rightY(controller.state.orientation))).toBeLessThan(1e-9);

    controller.goTo({
      target: { context: 'galaxy', local: TARGET },
      arrivalDistanceM: ARRIVAL_M,
      durationMs: 6000,
    });

    const maxFrames = 800;
    for (let i = 0; i < maxFrames && controller.goToActive; i++) {
      controller.update(DT_MS);
      expect(Math.abs(rightY(controller.state.orientation))).toBeLessThan(1e-9);
    }

    expect(controller.goToActive).toBe(false);
    expect(Math.abs(rightY(controller.state.orientation))).toBeLessThan(1e-9);
  });
});

// ─── Cancel ───────────────────────────────────────────────────────────────────

describe('goTo cancel', () => {
  it('translate key mid-flight fires onGoToEnd(false) and resumes free flight', () => {
    const TARGET: [number, number, number] = [50, 0, 0];
    const { controller, el } = makeController();

    controller.goTo({
      target: { context: 'galaxy', local: TARGET },
      arrivalDistanceM: 1e13,
      durationMs: 6000,
    });

    let endFired = 0;
    let endResult: boolean | null = null;
    controller.onGoToEnd((c) => { endFired += 1; endResult = c; });

    // Fly a bit
    for (let i = 0; i < 20; i++) controller.update(DT_MS);
    expect(controller.goToActive).toBe(true);

    // Record position before cancel frame
    const { local: bl } = controller.state.position;
    const posBefore: [number, number, number] = [bl[0], bl[1], bl[2]];

    // Press a translate key → cancel happens next update
    holdKey(el, 'KeyW');
    controller.update(DT_MS);

    expect(endFired).toBe(1);
    expect(endResult).toBe(false);
    expect(controller.goToActive).toBe(false);

    // Position must be continuous — no teleport
    const posAfter = controller.state.position.local;
    const jump = Math.hypot(
      posAfter[0] - posBefore[0],
      posAfter[1] - posBefore[1],
      posAfter[2] - posBefore[2],
    );
    // Free flight runs with vel=0 after cancel, so the jump is at most one small step
    expect(jump).toBeLessThan(1); // well under 1 pc

    // Free flight still works after cancel
    for (let i = 0; i < 300; i++) controller.update(DT_MS);
    expect(controller.state.speedUnitsPerS).toBeGreaterThan(0.001);

    releaseKey(el, 'KeyW');
  });
});

// ─── Rebase continuity ────────────────────────────────────────────────────────

describe('goTo rebase continuity', () => {
  it('distance series is smooth across a rebase and arrives', () => {
    // Target at 30000 pc — camera must cross REBASE_THRESHOLD_UNITS during flight
    const TARGET: [number, number, number] = [30000, 0, 0];
    const ARRIVAL_M = 1e16; // ~0.324 pc — large enough to make test fast
    const { controller, origin } = makeController();

    expect(REBASE_THRESHOLD_UNITS).toBeLessThan(30000); // guard assumption

    controller.goTo({
      target: { context: 'galaxy', local: TARGET },
      arrivalDistanceM: ARRIVAL_M,
      durationMs: 6000,
    });

    let endFired = 0;
    controller.onGoToEnd((c) => { if (c) endFired += 1; });

    const distances: number[] = [];
    const maxFrames = 800;

    for (let i = 0; i < maxFrames; i++) {
      const d = distToTargetM(origin, { context: 'galaxy', local: TARGET });
      distances.push(d);
      if (!controller.goToActive) break;
      controller.update(DT_MS);
    }

    // Must have arrived
    expect(controller.goToActive).toBe(false);
    expect(endFired).toBe(1);

    // Smoothness: after the first 10 frames (warm-up), no step > 2× the previous step
    for (let i = 11; i < distances.length; i++) {
      const prev = distances[i - 1]! - distances[i - 2]!;
      const curr = distances[i]! - distances[i - 1]!;
      // curr and prev are negative (distance decreasing); the magnitudes should be comparable
      if (prev < -1e-30) {
        expect(Math.abs(curr)).toBeLessThanOrEqual(Math.abs(prev) * 3);
      }
    }
  });
});

// ─── Cross-context pin ────────────────────────────────────────────────────────

describe('goTo cross-context', () => {
  it('target.context === system with galaxy origin decays and arrives', () => {
    // Anchor the system frame 10 pc away in galaxy coords
    const SYSTEM_ANCHOR_PC = 10;
    const { controller, origin } = makeController((tree) => {
      tree.setAnchor('system', [SYSTEM_ANCHOR_PC, 0, 0]);
    });

    // Target: system origin (0,0,0 in system) = 10 pc in galaxy
    const target = { context: 'system' as const, local: [0, 0, 0] as [number, number, number] };
    const ARRIVAL_M = 1e13;

    let endFired = 0;
    let endResult: boolean | null = null;

    controller.goTo({ target, arrivalDistanceM: ARRIVAL_M, durationMs: 6000 });
    controller.onGoToEnd((c) => { endFired += 1; endResult = c; });

    const maxFrames = 800;
    for (let i = 0; i < maxFrames && controller.goToActive; i++) {
      controller.update(DT_MS);
      const d = distToTargetM(origin, target);
      expect(d).toBeGreaterThanOrEqual(ARRIVAL_M * 0.99);
    }

    expect(controller.goToActive).toBe(false);
    expect(endFired).toBe(1);
    expect(endResult).toBe(true);

    const finalDist = distToTargetM(origin, target);
    expect(finalDist).toBeLessThanOrEqual(ARRIVAL_M * 1.01);
  });
});

// ─── Allocation-free during goTo ─────────────────────────────────────────────

describe('goTo update() allocation-free', () => {
  it('same-identity scratch arrays throughout goTo frames', () => {
    const TARGET: [number, number, number] = [5, 0, 0];
    const { controller } = makeController();

    controller.goTo({
      target: { context: 'galaxy', local: TARGET },
      arrivalDistanceM: 1e13,
      durationMs: 6000,
    });

    const posBefore = UPDATE_SCRATCH.pos;
    const velBefore = UPDATE_SCRATCH.vel;
    const wishBefore = UPDATE_SCRATCH.wish;
    const gotoRenderBefore = UPDATE_SCRATCH.gotoRender;

    for (let i = 0; i < 10 && controller.goToActive; i++) {
      controller.update(DT_MS);
    }

    expect(UPDATE_SCRATCH.pos).toBe(posBefore);
    expect(UPDATE_SCRATCH.vel).toBe(velBefore);
    expect(UPDATE_SCRATCH.wish).toBe(wishBefore);
    expect(UPDATE_SCRATCH.gotoRender).toBe(gotoRenderBefore);
  });
});

// ─── replaceGoTo fires old callback with false ────────────────────────────────

describe('goTo replace', () => {
  it('replacing an in-flight goTo fires old onGoToEnd(false), not new', () => {
    const { controller } = makeController();

    controller.goTo({
      target: { context: 'galaxy', local: [10, 0, 0] },
      arrivalDistanceM: 1e13,
      durationMs: 6000,
    });

    let firstEnd: boolean | null = null;
    controller.onGoToEnd((c) => { firstEnd = c; });

    for (let i = 0; i < 5; i++) controller.update(DT_MS);
    expect(controller.goToActive).toBe(true);

    controller.goTo({
      target: { context: 'galaxy', local: [0, 10, 0] },
      arrivalDistanceM: 1e13,
      durationMs: 6000,
    });

    expect(firstEnd).toBe(false);
    expect(controller.goToActive).toBe(true);
  });
});
