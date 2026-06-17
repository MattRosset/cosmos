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
import type { ContextSwitchEvent, GalaxyAnchor } from '../src/index';
import {
  DEFAULT_GALAXY_SWITCH_POLICY,
  GALAXY_HYSTERESIS_MIN_RATIO,
} from '../src/index';

const IDENTITY_QUAT: [number, number, number, number] = [0, 0, 0, 1];
/** Faces world −x, so holding forward flies toward an anchor at the origin. */
const FACE_MINUS_X: [number, number, number, number] = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
const DT_MS = 16.67;
const MPC_PER_PC = CONTEXT_UNIT_METERS.universe / CONTEXT_UNIT_METERS.galaxy;

const MILKYWAY: GalaxyAnchor = { id: 'proc:milkyway', positionMpc: [0, 0, 0] };

interface Opts {
  initial?: [number, number, number];
  orientation?: [number, number, number, number];
  anchorMpc?: [number, number, number];
  anchor?: GalaxyAnchor | null;
  dampingHalfLifeMs?: number;
  galaxySwitchPolicy?: { enterGalaxyAtM?: number; exitGalaxyAtM?: number };
  setTreeAnchor?: boolean; // default true
}

function makeController(o: Opts = {}) {
  const tree = createScaleFrameTree();
  const anchor = o.anchor === undefined ? MILKYWAY : o.anchor;
  const treeAnchorMpc = o.anchorMpc ?? (anchor ? [...anchor.positionMpc] : [0, 0, 0]);
  if (o.setTreeAnchor !== false) {
    tree.setAnchor('galaxy', treeAnchorMpc as [number, number, number]);
  }
  const origin = createOriginManager(tree, {
    context: 'universe',
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
      position: { context: 'universe', local: o.initial ?? [0, 0, 0] },
      orientation: o.orientation ?? IDENTITY_QUAT,
    },
    ...(o.dampingHalfLifeMs !== undefined ? { dampingHalfLifeMs: o.dampingHalfLifeMs } : {}),
    ...(o.galaxySwitchPolicy !== undefined ? { galaxySwitchPolicy: o.galaxySwitchPolicy } : {}),
  });
  const dispose = controller.attach(el);
  if (anchor) controller.setGalaxyAnchor(anchor);
  const events: ContextSwitchEvent[] = [];
  controller.onContextSwitch((e) => events.push(e));
  return { controller, origin, tree, el, dispose, events };
}

function holdKey(el: HTMLElement, code: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
}

/** Place the camera at `dM` meters from the origin in the current context. */
function placeAtMeters(
  controller: ReturnType<typeof makeController>['controller'],
  dM: number,
): void {
  const localX = dM / CONTEXT_UNIT_METERS[controller.contextId];
  UPDATE_SCRATCH.pos[0] = localX;
  UPDATE_SCRATCH.pos[1] = 0;
  UPDATE_SCRATCH.pos[2] = 0;
  controller.update(0);
}

/** Camera↔galaxy-anchor distance in meters via toRenderSpace. */
function galaxyAnchorDistM(
  origin: ReturnType<typeof createOriginManager>,
  anchorMpc: readonly [number, number, number],
): number {
  const out: [number, number, number] = [0, 0, 0];
  origin.toRenderSpace(
    { context: 'universe', local: [...anchorMpc] as [number, number, number] },
    out,
  );
  return Math.hypot(out[0], out[1], out[2]) * CONTEXT_UNIT_METERS[origin.context];
}

// ─── Enter (real simulated frames) ───────────────────────────────────────────

describe('galaxy switch — enter', () => {
  it('approaching anchored galaxy switches universe→galaxy exactly once', () => {
    // Start at 0.04 Mpc (40 kpc < 50 kpc enter threshold) — inside from the start
    const { controller, origin, events } = makeController({
      initial: [0.04, 0, 0],
      orientation: FACE_MINUS_X,
      dampingHalfLifeMs: 1e-4,
    });

    controller.update(DT_MS);

    expect(controller.contextId).toBe('galaxy');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ from: 'universe', to: 'galaxy', anchorId: 'proc:milkyway' });
    // fired at a frame where dM was < enterGalaxyAtM
    const dM = galaxyAnchorDistM(origin, MILKYWAY.positionMpc);
    expect(dM).toBeLessThan(DEFAULT_GALAXY_SWITCH_POLICY.enterGalaxyAtM);
    void origin;
  });
});

// ─── Continuity ───────────────────────────────────────────────────────────────

describe('galaxy switch — continuity', () => {
  it('zero positional + orientation discontinuity across the switch', () => {
    const { controller, tree, origin } = makeController({ anchor: null });
    tree.setAnchor('galaxy', [0, 0, 0]);

    // Park inside enter threshold with no anchor (no switch fires).
    placeAtMeters(controller, 1e21); // 1e21 < 1.543e21
    const before = controller.state.position;
    const beforePos = {
      context: before.context,
      local: [...before.local] as [number, number, number],
    };
    const beforeQuat = [...controller.state.orientation];
    const beforeSpeedMs =
      controller.state.speedUnitsPerS * CONTEXT_UNIT_METERS[before.context];

    // Arm the anchor and step with NO motion → only the switch.
    controller.setGalaxyAnchor(MILKYWAY);
    controller.update(0);
    expect(controller.contextId).toBe('galaxy');

    const after = controller.state.position;
    const afterPos = {
      context: after.context,
      local: [...after.local] as [number, number, number],
    };
    const physJump = tree.distanceMeters(beforePos, afterPos);
    expect(physJump).toBeLessThan(1); // < 1 metre

    // Orientation untouched — bit-identical.
    expect([...controller.state.orientation]).toEqual(beforeQuat);

    // Physical speed (m/s) continuous (both zero here; exact).
    const afterSpeedMs =
      controller.state.speedUnitsPerS * CONTEXT_UNIT_METERS[after.context];
    expect(afterSpeedMs).toBe(beforeSpeedMs);
    void origin;
  });
});

// ─── Hysteresis ───────────────────────────────────────────────────────────────

describe('galaxy switch — hysteresis', () => {
  it('oscillating across enter threshold switches once; exit needs the gap', () => {
    const { controller, events } = makeController();

    placeAtMeters(controller, 2e21); // outside enter (1.543e21)
    expect(controller.contextId).toBe('universe');
    placeAtMeters(controller, 1e21); // inside enter ⇒ switch in
    expect(controller.contextId).toBe('galaxy');
    expect(events).toHaveLength(1);

    // Flap across the enter line repeatedly — must NOT switch back (exit = 3.086e21).
    for (let i = 0; i < 5; i++) {
      placeAtMeters(controller, 2e21);
      placeAtMeters(controller, 1e21);
    }
    expect(events).toHaveLength(1);
    expect(controller.contextId).toBe('galaxy');

    // Cross the exit threshold ⇒ exactly one exit.
    placeAtMeters(controller, 3.5e21);
    expect(controller.contextId).toBe('universe');
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ from: 'galaxy', to: 'universe', anchorId: 'proc:milkyway' });
  });
});

// ─── Velocity scaling ─────────────────────────────────────────────────────────

describe('galaxy switch — velocity scaling', () => {
  it('velocity rescales Mpc/s→pc/s by MPC_PER_PC within 1e-9 relative', () => {
    // Start inside enter threshold so switch fires on first update.
    // Use ultra-low damping so velocity snaps to target instantly each frame.
    const D = 0.04; // distanceToNearestSurface in Mpc (universe context units)
    const { controller, el } = makeController({
      initial: [0.04, 0, 0],
      orientation: FACE_MINUS_X,
      dampingHalfLifeMs: 1e-6,
    });
    controller.setDistanceToNearestSurface(D);
    holdKey(el, 'KeyW');

    // One non-zero-dt update: damping≈0 snaps velocity to D Mpc/s, then switch fires.
    controller.update(DT_MS);
    expect(controller.contextId).toBe('galaxy');

    const speedPcPerS = controller.state.speedUnitsPerS;
    const expected = D * MPC_PER_PC;
    // relative error < 1e-9
    expect(Math.abs(speedPcPerS / expected - 1)).toBeLessThan(1e-9);

    // Physical speed (m/s) continuous: Mpc/s × Mpc_unit = pc/s × pc_unit.
    const physBefore = D * CONTEXT_UNIT_METERS.universe;
    const physAfter = speedPcPerS * CONTEXT_UNIT_METERS.galaxy;
    expect(Math.abs(physAfter / physBefore - 1)).toBeLessThan(1e-6);
  });
});

// ─── At most one switch per update ───────────────────────────────────────────

describe('galaxy switch — at most one switch per update', () => {
  it('frame inside both galaxy-enter AND system-enter fires only one switch', () => {
    // Set up: tree anchors for both galaxy and system at origin.
    // Camera inside galaxy enter threshold (1e21 m) AND system enter (7.5e14 m).
    // Frame 1 from universe: only universe→galaxy fires.
    // Frame 2 from galaxy: only galaxy→system fires.
    const tree = createScaleFrameTree();
    tree.setAnchor('galaxy', [0, 0, 0]);
    tree.setAnchor('system', [0, 0, 0]);
    const origin = createOriginManager(tree, { context: 'universe', local: [0, 0, 0] });
    const el = document.createElement('div');
    if (!el.setPointerCapture) {
      el.setPointerCapture = () => undefined;
      el.releasePointerCapture = () => undefined;
    }
    const controller = createFlightController({
      origin,
      initial: { position: { context: 'universe', local: [0, 0, 0] }, orientation: IDENTITY_QUAT },
    });
    controller.attach(el);
    controller.setGalaxyAnchor(MILKYWAY);
    controller.setSystemAnchor({ id: 'sol', positionPc: [0, 0, 0] });

    const events: ContextSwitchEvent[] = [];
    controller.onContextSwitch((e) => events.push(e));

    // Frame 1: camera at origin in universe → inside galaxy enter (dM = 0).
    // Only one switch should fire: universe→galaxy.
    controller.update(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ from: 'universe', to: 'galaxy', anchorId: 'proc:milkyway' });
    expect(controller.contextId).toBe('galaxy');

    // Frame 2: now in galaxy, camera at 0 pc from system anchor → galaxy→system.
    controller.update(0);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ from: 'galaxy', to: 'system', anchorId: 'sol' });
    expect(controller.contextId).toBe('system');
  });
});

// ─── Anchor swap guard ────────────────────────────────────────────────────────

describe('galaxy switch — anchor swap guard', () => {
  it('different anchor ignored while in galaxy; applies after exit to universe', () => {
    const { controller, tree } = makeController();
    const other: GalaxyAnchor = { id: 'proc:andromeda', positionMpc: [0.77, 0, 0] };

    placeAtMeters(controller, 1e21); // enter galaxy
    expect(controller.contextId).toBe('galaxy');
    expect(controller.galaxyAnchor?.id).toBe('proc:milkyway');

    controller.setGalaxyAnchor(other); // ignored — different id, inside galaxy
    expect(controller.galaxyAnchor?.id).toBe('proc:milkyway');

    placeAtMeters(controller, 3.5e21); // exit to universe
    expect(controller.contextId).toBe('universe');
    expect(controller.galaxyAnchor?.id).toBe('proc:milkyway'); // exit does not clear

    // Set the new tree anchor, then swap the galaxy anchor — now it applies.
    tree.setAnchor('galaxy', [0.77, 0, 0]);
    controller.setGalaxyAnchor(other);
    expect(controller.galaxyAnchor?.id).toBe('proc:andromeda');
  });
});

// ─── Clear anchor exits ───────────────────────────────────────────────────────

describe('galaxy switch — clear anchor exits', () => {
  it('null anchor while inside galaxy exits next update with anchorId null', () => {
    const { controller, events } = makeController();
    placeAtMeters(controller, 1e21); // enter
    expect(controller.contextId).toBe('galaxy');

    controller.setGalaxyAnchor(null);
    expect(controller.galaxyAnchor).toBeNull();
    controller.update(0);

    expect(controller.contextId).toBe('universe');
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ from: 'galaxy', to: 'universe', anchorId: null });
  });
});

// ─── Policy / constructor ─────────────────────────────────────────────────────

describe('galaxy switch — policy', () => {
  it('defaults are exact', () => {
    expect(DEFAULT_GALAXY_SWITCH_POLICY.enterGalaxyAtM).toBe(1.543e21);
    expect(DEFAULT_GALAXY_SWITCH_POLICY.exitGalaxyAtM).toBe(3.086e21);
    expect(GALAXY_HYSTERESIS_MIN_RATIO).toBe(1.5);
  });

  it('constructor throws RangeError when exit < 1.5× enter', () => {
    expect(() =>
      makeController({ galaxySwitchPolicy: { enterGalaxyAtM: 1e21, exitGalaxyAtM: 1e21 } }),
    ).toThrow(RangeError);
  });

  it('accepts a valid custom policy', () => {
    const { controller } = makeController({
      galaxySwitchPolicy: { enterGalaxyAtM: 5e20, exitGalaxyAtM: 1e21 },
    });
    placeAtMeters(controller, 6e20); // outside custom enter
    expect(controller.contextId).toBe('universe');
    placeAtMeters(controller, 4e20); // inside custom enter
    expect(controller.contextId).toBe('galaxy');
  });
});

// ─── Dev precondition guard ───────────────────────────────────────────────────

describe('galaxy switch — dev precondition', () => {
  it('throws if the glue did not set the tree galaxy anchor (discontinuity)', () => {
    // Galaxy anchor at [5, 0, 0] Mpc but tree.galaxy anchor left at [0,0,0] ⇒
    // switchContext converts through the wrong frame ⇒ physical jump ⇒ guard fires.
    const offAnchor: GalaxyAnchor = { id: 'proc:andromeda', positionMpc: [5, 0, 0] };
    const { controller } = makeController({
      anchor: offAnchor,
      setTreeAnchor: false,
      initial: [5, 0, 0],
    });
    expect(() => {
      UPDATE_SCRATCH.pos[0] = 5;
      UPDATE_SCRATCH.pos[1] = 0;
      UPDATE_SCRATCH.pos[2] = 0;
      controller.update(0);
    }).toThrow(/positional continuity/);
  });
});

// ─── TASK-027 behavior unchanged ─────────────────────────────────────────────

describe('galaxy switch — TASK-027 behavior unchanged', () => {
  it('controller starting in galaxy context never exits to universe without galaxy anchor', () => {
    // This mirrors a TASK-027 scenario: context starts in galaxy, no galaxy anchor.
    const tree = createScaleFrameTree();
    tree.setAnchor('system', [0, 0, 0]);
    const origin = createOriginManager(tree, { context: 'galaxy', local: [0.1, 0, 0] });
    const el = document.createElement('div');
    if (!el.setPointerCapture) {
      el.setPointerCapture = () => undefined;
      el.releasePointerCapture = () => undefined;
    }
    const controller = createFlightController({
      origin,
      initial: { position: { context: 'galaxy', local: [0.1, 0, 0] }, orientation: IDENTITY_QUAT },
    });
    controller.attach(el);

    const events: ContextSwitchEvent[] = [];
    controller.onContextSwitch((e) => events.push(e));

    // Many updates with no galaxy anchor — context must stay galaxy or deeper.
    for (let i = 0; i < 20; i++) {
      controller.update(DT_MS);
    }
    expect(controller.contextId).not.toBe('universe');
    // Only system-related events possible, none in this scenario.
    expect(events.filter((e) => e.from === 'galaxy' && e.to === 'universe')).toHaveLength(0);
  });
});

// ─── Allocation-free ──────────────────────────────────────────────────────────

describe('galaxy switch — allocation-free update', () => {
  it('galaxy scratch identities stable across non-switch and switch frames', () => {
    const { controller } = makeController();
    const ids = {
      galAnchor: UPDATE_SCRATCH.galAnchor,
      galRender: UPDATE_SCRATCH.galRender,
    };

    placeAtMeters(controller, 2e21); // non-switch frame (universe, outside)
    expect(controller.contextId).toBe('universe');
    placeAtMeters(controller, 1e21); // switch frame
    expect(controller.contextId).toBe('galaxy');

    expect(UPDATE_SCRATCH.galAnchor).toBe(ids.galAnchor);
    expect(UPDATE_SCRATCH.galRender).toBe(ids.galRender);
  });
});
