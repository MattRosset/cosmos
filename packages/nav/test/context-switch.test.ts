import { describe, expect, it } from 'vitest';

if (typeof globalThis.PointerEvent === 'undefined') {
  globalThis.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
    }
  } as typeof PointerEvent;
}

import { CONTEXT_UNIT_METERS } from '@cosmos/core-types';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';
import { createFlightController, UPDATE_SCRATCH } from '../src/controller';
import type { ContextSwitchEvent, SystemAnchor } from '../src/index';
import { DEFAULT_CONTEXT_SWITCH_POLICY, HYSTERESIS_MIN_RATIO } from '../src/index';

const IDENTITY_QUAT: [number, number, number, number] = [0, 0, 0, 1];
/** Faces world −x, so holding forward flies toward an anchor at the origin. */
const FACE_MINUS_X: [number, number, number, number] = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
const DT_MS = 16.67;
const PC_PER_AU = CONTEXT_UNIT_METERS.galaxy / CONTEXT_UNIT_METERS.system;
const SOL: SystemAnchor = { id: 'sol', positionPc: [0, 0, 0] };

interface Opts {
  initial?: [number, number, number];
  orientation?: [number, number, number, number];
  anchorPc?: [number, number, number]; // tree 'system' anchor (defaults to anchor's positionPc)
  anchor?: SystemAnchor | null;
  dampingHalfLifeMs?: number;
  contextSwitchPolicy?: { enterSystemAtM?: number; exitSystemAtM?: number };
  setTreeAnchor?: boolean; // default true
}

function makeController(o: Opts = {}) {
  const tree = createScaleFrameTree();
  const anchor = o.anchor === undefined ? SOL : o.anchor;
  const treeAnchorPc = o.anchorPc ?? (anchor ? [...anchor.positionPc] : [0, 0, 0]);
  if (o.setTreeAnchor !== false) {
    tree.setAnchor('system', treeAnchorPc as [number, number, number]);
  }
  const origin = createOriginManager(tree, {
    context: 'galaxy',
    local: o.initial ?? [0, 0, 0],
  });
  const el = document.createElement('div');
  if (!el.setPointerCapture) {
    el.setPointerCapture = () => undefined;
    el.releasePointerCapture = () => undefined;
  }
  const controller = createFlightController({
    origin,
    initial: {
      position: { context: 'galaxy', local: o.initial ?? [0, 0, 0] },
      orientation: o.orientation ?? IDENTITY_QUAT,
    },
    ...(o.dampingHalfLifeMs !== undefined ? { dampingHalfLifeMs: o.dampingHalfLifeMs } : {}),
    ...(o.contextSwitchPolicy !== undefined ? { contextSwitchPolicy: o.contextSwitchPolicy } : {}),
  });
  const dispose = controller.attach(el);
  if (anchor) controller.setSystemAnchor(anchor);
  const events: ContextSwitchEvent[] = [];
  controller.onContextSwitch((e) => events.push(e));
  return { controller, origin, tree, el, dispose, events };
}

function holdKey(el: HTMLElement, code: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
}

/** Camera↔anchor distance in meters, via toRenderSpace (current context). */
function anchorDistM(
  origin: ReturnType<typeof createOriginManager>,
  anchorPc: readonly [number, number, number],
): number {
  const out: [number, number, number] = [0, 0, 0];
  origin.toRenderSpace({ context: 'galaxy', local: [...anchorPc] as [number, number, number] }, out);
  return Math.hypot(out[0], out[1], out[2]) * CONTEXT_UNIT_METERS[origin.context];
}

/** Place the camera at `dM` meters along +x from the origin anchor, no motion. */
function placeAtMeters(controller: ReturnType<typeof makeController>['controller'], dM: number): void {
  const localX = dM / CONTEXT_UNIT_METERS[controller.contextId];
  UPDATE_SCRATCH.pos[0] = localX;
  UPDATE_SCRATCH.pos[1] = 0;
  UPDATE_SCRATCH.pos[2] = 0;
  controller.update(0);
}

// ─── Enter (real, simulated frames) ───────────────────────────────────────────

describe('context switch — enter', () => {
  it('approaching anchored Sol switches galaxy→system exactly once', () => {
    const start = 0.05; // pc ≈ 1.54e15 m, outside both thresholds
    const { controller, origin, el, events } = makeController({
      initial: [start, 0, 0],
      orientation: FACE_MINUS_X,
      dampingHalfLifeMs: 1e-4,
    });
    controller.setDistanceToNearestSurface(0.06); // ⇒ 0.06 pc/s toward Sol
    holdKey(el, 'KeyW');

    let switchedDM = Number.NaN;
    for (let i = 0; i < 200; i++) {
      controller.update(DT_MS);
      if (controller.contextId === 'system') {
        switchedDM = anchorDistM(origin, SOL.positionPc);
        break;
      }
    }

    expect(controller.contextId).toBe('system');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ from: 'galaxy', to: 'system', anchorId: 'sol' });
    expect(switchedDM).toBeLessThan(DEFAULT_CONTEXT_SWITCH_POLICY.enterSystemAtM);
  });
});

// ─── Continuity (pure switch, isolated from motion) ───────────────────────────

describe('context switch — continuity', () => {
  it('zero positional + orientation discontinuity across the switch', () => {
    // Anchor with no system tree anchor yet → set it, then isolate the switch.
    const { controller, tree, origin } = makeController({ anchor: null });
    tree.setAnchor('system', [0, 0, 0]);

    // Park the camera INSIDE the enter threshold with no anchor (no switch).
    placeAtMeters(controller, 3e14); // < 7.5e14
    const before = controller.state.position;
    const beforePos = { context: before.context, local: [...before.local] as [number, number, number] };
    const beforeQuat = [...controller.state.orientation];
    const beforeSpeedMs = controller.state.speedUnitsPerS * CONTEXT_UNIT_METERS[before.context];

    // Now arm the anchor and step with NO motion → only the switch happens.
    controller.setSystemAnchor(SOL);
    controller.update(0);
    expect(controller.contextId).toBe('system');

    const after = controller.state.position;
    const afterPos = { context: after.context, local: [...after.local] as [number, number, number] };
    const physJump = tree.distanceMeters(beforePos, afterPos);
    expect(physJump).toBeLessThan(1); // < 1 metre

    // Orientation untouched — bit-identical.
    expect([...controller.state.orientation]).toEqual(beforeQuat);

    // Physical speed (m/s) continuous (both zero here; exact).
    const afterSpeedMs = controller.state.speedUnitsPerS * CONTEXT_UNIT_METERS[after.context];
    expect(afterSpeedMs).toBe(beforeSpeedMs);
    void origin;
  });
});

// ─── Hysteresis ───────────────────────────────────────────────────────────────

describe('context switch — hysteresis', () => {
  it('oscillating across the enter threshold switches once; exit needs the gap', () => {
    const { controller, events } = makeController();

    placeAtMeters(controller, 9e14); // outside enter
    expect(controller.contextId).toBe('galaxy');
    placeAtMeters(controller, 7e14); // inside enter ⇒ switch in
    expect(controller.contextId).toBe('system');
    expect(events).toHaveLength(1);

    // Flap across the enter line repeatedly — must NOT switch back (exit=1.5e15).
    for (let i = 0; i < 5; i++) {
      placeAtMeters(controller, 9e14);
      placeAtMeters(controller, 7e14);
    }
    expect(events).toHaveLength(1);
    expect(controller.contextId).toBe('system');

    // Cross the exit threshold ⇒ exactly one exit.
    placeAtMeters(controller, 1.6e15);
    expect(controller.contextId).toBe('galaxy');
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ from: 'system', to: 'galaxy', anchorId: 'sol' });
  });
});

// ─── Velocity scaling + speed continuity ──────────────────────────────────────

describe('context switch — velocity scaling', () => {
  it('velocity rescales pc/s→AU/s by pc/AU; physical m/s continuous', () => {
    const D = 0.06; // pc/s with speedScale 1
    const { controller, el } = makeController({
      initial: [0.05, 0, 0],
      orientation: FACE_MINUS_X,
      dampingHalfLifeMs: 1e-6, // velocity = target exactly each frame
    });
    controller.setDistanceToNearestSurface(D);
    holdKey(el, 'KeyW');

    // One step to lock velocity to the target (galaxy units/s), still outside.
    controller.update(DT_MS);
    expect(controller.contextId).toBe('galaxy');
    const speedPcPerS = controller.state.speedUnitsPerS;
    expect(speedPcPerS).toBeCloseTo(D, 10);
    const physBeforeMs = speedPcPerS * CONTEXT_UNIT_METERS.galaxy;

    // Fly in until the switch fires.
    for (let i = 0; i < 200 && controller.contextId === 'galaxy'; i++) {
      controller.update(DT_MS);
    }
    expect(controller.contextId).toBe('system');

    const speedAuPerS = controller.state.speedUnitsPerS;
    expect(speedAuPerS).toBeCloseTo(D * PC_PER_AU, 3);
    // Relative error vs exact scaling within 1e-9.
    expect(Math.abs(speedAuPerS / (D * PC_PER_AU) - 1)).toBeLessThan(1e-9);

    // Physical speed (m/s) identical across the switch.
    const physAfterMs = speedAuPerS * CONTEXT_UNIT_METERS.system;
    expect(Math.abs(physAfterMs / physBeforeMs - 1)).toBeLessThan(1e-6);
  });
});

// ─── goTo survives the switch ─────────────────────────────────────────────────

describe('context switch — goTo across switch', () => {
  it('an in-flight goTo enters the system mid-flight and still arrives', () => {
    const { controller, origin, events } = makeController({ initial: [0.1, 0, 0] });
    const target = { context: 'system' as const, local: [0, 0, 0] as [number, number, number] };
    const ARRIVAL_M = 1e10;

    let arrived: boolean | null = null;
    controller.goTo({ target, arrivalDistanceM: ARRIVAL_M, durationMs: 6000 });
    controller.onGoToEnd((c) => (arrived = c));

    const dists: number[] = [];
    const ctxAt: string[] = [];
    const out: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 2000 && controller.goToActive; i++) {
      controller.update(DT_MS);
      origin.toRenderSpace(target, out);
      dists.push(Math.hypot(out[0], out[1], out[2]) * CONTEXT_UNIT_METERS[controller.contextId]);
      ctxAt.push(controller.contextId);
    }

    expect(controller.goToActive).toBe(false);
    expect(arrived).toBe(true);
    expect(controller.contextId).toBe('system');
    expect(events).toHaveLength(1);

    const switchIdx = ctxAt.findIndex((c) => c === 'system');
    expect(switchIdx).toBeGreaterThan(0);

    // Monotonic after the first 25% of recorded frames.
    const skip = Math.ceil(dists.length * 0.25);
    for (let i = skip + 1; i < dists.length; i++) {
      expect(dists[i]!).toBeLessThanOrEqual(dists[i - 1]! * 1.001);
    }

    // No discontinuous jump at the switch frame: its step ≤ 2× a neighbour.
    const stepAt = Math.abs(dists[switchIdx]! - dists[switchIdx - 1]!);
    const stepPrev = Math.abs(dists[switchIdx - 1]! - dists[switchIdx - 2]!);
    expect(stepAt).toBeLessThanOrEqual(stepPrev * 2);
  });
});

// ─── Anchor swap guard ────────────────────────────────────────────────────────

describe('context switch — anchor swap guard', () => {
  it('a different anchor is ignored while in system, applied after exit', () => {
    const { controller, tree } = makeController();
    const other: SystemAnchor = { id: 'exo:trappist-1', positionPc: [5, 0, 0] };

    placeAtMeters(controller, 7e14); // enter
    expect(controller.contextId).toBe('system');
    expect(controller.systemAnchor?.id).toBe('sol');

    controller.setSystemAnchor(other); // ignored — different id, inside system
    expect(controller.systemAnchor?.id).toBe('sol');

    placeAtMeters(controller, 1.6e15); // exit
    expect(controller.contextId).toBe('galaxy');
    expect(controller.systemAnchor?.id).toBe('sol'); // exit does not clear

    tree.setAnchor('system', [5, 0, 0]);
    controller.setSystemAnchor(other); // now applies
    expect(controller.systemAnchor?.id).toBe('exo:trappist-1');
  });
});

// ─── Clearing the anchor exits ────────────────────────────────────────────────

describe('context switch — clear anchor exits', () => {
  it('null anchor while inside exits next update with anchorId null', () => {
    const { controller, events } = makeController();
    placeAtMeters(controller, 7e14);
    expect(controller.contextId).toBe('system');

    controller.setSystemAnchor(null);
    expect(controller.systemAnchor).toBeNull();
    controller.update(0);

    expect(controller.contextId).toBe('galaxy');
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ from: 'system', to: 'galaxy', anchorId: null });
  });
});

// ─── Policy / constructor ─────────────────────────────────────────────────────

describe('context switch — policy', () => {
  it('defaults are exact', () => {
    expect(DEFAULT_CONTEXT_SWITCH_POLICY.enterSystemAtM).toBe(7.5e14);
    expect(DEFAULT_CONTEXT_SWITCH_POLICY.exitSystemAtM).toBe(1.5e15);
    expect(HYSTERESIS_MIN_RATIO).toBe(1.5);
  });

  it('constructor throws RangeError when exit < 1.5× enter', () => {
    expect(() =>
      makeController({ contextSwitchPolicy: { enterSystemAtM: 1e15, exitSystemAtM: 1e15 } }),
    ).toThrow(RangeError);
  });

  it('accepts a valid custom policy', () => {
    const { controller } = makeController({
      contextSwitchPolicy: { enterSystemAtM: 1e14, exitSystemAtM: 1e15 },
    });
    placeAtMeters(controller, 1.2e14); // outside custom enter
    expect(controller.contextId).toBe('galaxy');
    placeAtMeters(controller, 9e13); // inside custom enter
    expect(controller.contextId).toBe('system');
  });
});

// ─── Dev precondition guard ───────────────────────────────────────────────────

describe('context switch — dev precondition', () => {
  it('throws if the glue did not set the tree system anchor (discontinuity)', () => {
    // anchor 10 pc away, but tree 'system' anchor left at origin ⇒ switchContext
    // converts through the wrong frame ⇒ physical jump ⇒ dev guard fires.
    const offAnchor: SystemAnchor = { id: 'sol', positionPc: [10, 0, 0] };
    const { controller } = makeController({
      anchor: offAnchor,
      setTreeAnchor: false,
      initial: [10, 0, 0],
    });
    // Camera AT the anchor in galaxy coords ⇒ inside enter threshold.
    expect(() => {
      UPDATE_SCRATCH.pos[0] = 10;
      UPDATE_SCRATCH.pos[1] = 0;
      UPDATE_SCRATCH.pos[2] = 0;
      controller.update(0);
    }).toThrow(/positional continuity/);
  });
});

// ─── Allocation-free ──────────────────────────────────────────────────────────

describe('context switch — allocation-free update', () => {
  it('scratch identities stable across a non-switch and a switch frame', () => {
    const { controller } = makeController();
    const ids = {
      pos: UPDATE_SCRATCH.pos,
      ctxAnchor: UPDATE_SCRATCH.ctxAnchor,
      ctxRender: UPDATE_SCRATCH.ctxRender,
    };

    placeAtMeters(controller, 9e14); // non-switch frame (galaxy, outside)
    expect(controller.contextId).toBe('galaxy');
    placeAtMeters(controller, 7e14); // switch frame
    expect(controller.contextId).toBe('system');

    expect(UPDATE_SCRATCH.pos).toBe(ids.pos);
    expect(UPDATE_SCRATCH.ctxAnchor).toBe(ids.ctxAnchor);
    expect(UPDATE_SCRATCH.ctxRender).toBe(ids.ctxRender);
  });
});
