import { describe, expect, it } from 'vitest';
import { CONTEXT_UNIT_METERS, REBASE_THRESHOLD_UNITS } from '@cosmos/core-types';
import type { UniversePosition } from '@cosmos/core-types';
import { createOriginManager, createScaleFrameTree } from '../src/index';
import type { Vec3Tuple } from '../src/index';

const U = CONTEXT_UNIT_METERS;
const AU_PER_PC = U.system / U.galaxy; // ≈ 4.84813681e-6

const at = (context: UniversePosition['context'], local: Vec3Tuple): UniversePosition => ({
  context,
  local,
});

describe('createOriginManager — basics', () => {
  it('exposes the initial context and absolute camera position', () => {
    const tree = createScaleFrameTree();
    const om = createOriginManager(tree, at('galaxy', [8000, 1, -2]));
    expect(om.context).toBe('galaxy');
    expect(om.cameraUniverse.context).toBe('galaxy');
    expect(om.cameraUniverse.local).toEqual([8000, 1, -2]);
  });

  it('reproduces the spec example: planet 8 kpc out, camera 1 AU away', () => {
    const tree = createScaleFrameTree();
    const camera = at('galaxy', [8000 + AU_PER_PC, 0, 0]);
    const om = createOriginManager(tree, camera);
    const planet = at('galaxy', [8000, 0, 0]);
    const out: Vec3Tuple = [0, 0, 0];
    om.toRenderSpace(planet, out);
    // ≈ [-4.84813681e-6, 0, 0]: small numbers near the camera, by design.
    expect(Math.abs(out[0] - -AU_PER_PC)).toBeLessThan(1e-10);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it('toRenderSpace writes into and returns the SAME out tuple (zero allocation)', () => {
    const tree = createScaleFrameTree();
    const om = createOriginManager(tree, at('galaxy', [0, 0, 0]));
    const out: Vec3Tuple = [0, 0, 0];
    const r1 = om.toRenderSpace(at('galaxy', [1, 2, 3]), out);
    expect(r1).toBe(out);
    const r2 = om.toRenderSpace(at('galaxy', [-4, 5, -6]), out);
    expect(r2).toBe(out);
    expect(out).toEqual([-4, 5, -6]);
  });

  it('converts cross-context bodies into the camera frame before subtracting', () => {
    const tree = createScaleFrameTree();
    tree.setAnchor('system', [8000, 0, 0]);
    const om = createOriginManager(tree, at('galaxy', [8000, 0, 0]));
    const out: Vec3Tuple = [0, 0, 0];
    // Body 1 AU from the system origin, camera sitting exactly on the system origin.
    om.toRenderSpace(at('system', [1, 0, 0]), out);
    expect(Math.abs(out[0] - AU_PER_PC)).toBeLessThan(1e-10);
  });

  it('accepts camera updates expressed in another frame', () => {
    const tree = createScaleFrameTree();
    tree.setAnchor('system', [5, 0, 0]);
    const om = createOriginManager(tree, at('galaxy', [0, 0, 0]));
    om.setCameraPosition(at('system', [0, 0, 0]));
    expect(om.context).toBe('galaxy');
    expect(om.cameraUniverse.local).toEqual([5, 0, 0]);
  });
});

describe('createOriginManager — rebase', () => {
  it('does NOT fire at |cameraLocal| exactly equal to the threshold', () => {
    const tree = createScaleFrameTree();
    const om = createOriginManager(tree, at('galaxy', [0, 0, 0]));
    expect(om.setCameraPosition(at('galaxy', [REBASE_THRESHOLD_UNITS, 0, 0]))).toBeNull();
  });

  it('fires exactly when |cameraLocal| > threshold, with the applied offset', () => {
    const tree = createScaleFrameTree();
    const om = createOriginManager(tree, at('galaxy', [0, 0, 0]));

    expect(om.setCameraPosition(at('galaxy', [9999, 0, 0]))).toBeNull();

    const event = om.setCameraPosition(at('galaxy', [10001, 0, 0]));
    expect(event).not.toBeNull();
    expect(event?.context).toBe('galaxy');
    expect(event?.offsetUnits).toEqual([10001, 0, 0]);

    // Camera absolute position is unchanged by the rebase…
    expect(om.cameraUniverse.local).toEqual([10001, 0, 0]);
    // …and cameraLocal is now zero: same position again does not re-fire.
    expect(om.setCameraPosition(at('galaxy', [10001, 0, 0]))).toBeNull();
  });

  it('uses the Euclidean norm of cameraLocal', () => {
    const tree = createScaleFrameTree();
    const omFar = createOriginManager(tree, at('galaxy', [0, 0, 0]));
    // |[7000,7000,7000]| ≈ 12124 > 10000 → fires
    expect(omFar.setCameraPosition(at('galaxy', [7000, 7000, 7000]))).not.toBeNull();
    const omNear = createOriginManager(tree, at('galaxy', [0, 0, 0]));
    // |[5000,5000,5000]| ≈ 8660 ≤ 10000 → silent
    expect(omNear.setCameraPosition(at('galaxy', [5000, 5000, 5000]))).toBeNull();
  });

  it('offsetUnits equals the applied shift: the old cameraLocal maps to render zero', () => {
    const tree = createScaleFrameTree();
    const om = createOriginManager(tree, at('galaxy', [3, -4, 5]));
    const event = om.setCameraPosition(at('galaxy', [10003, 9996, -11995]));
    expect(event?.offsetUnits).toEqual([10000, 10000, -12000]);
    // The camera itself must sit at the render origin after the rebase.
    const out: Vec3Tuple = [1, 1, 1];
    om.toRenderSpace(at('galaxy', [10003, 9996, -11995]), out);
    expect(out).toEqual([0, 0, 0]);
  });

  it('toRenderSpace results are identical (< 1e-9) right before vs right after a rebase', () => {
    const body = at('galaxy', [10500, 200, -300]);
    const camera: Vec3Tuple = [10400, 100, 0];

    // Manager A reached `camera` by travelling (rebase fired on the way).
    const treeA = createScaleFrameTree();
    const omA = createOriginManager(treeA, at('galaxy', [0, 0, 0]));
    const event = omA.setCameraPosition(at('galaxy', camera));
    expect(event).not.toBeNull();

    // Manager B was born at `camera` (origin = camera, no rebase ever).
    const treeB = createScaleFrameTree();
    const omB = createOriginManager(treeB, at('galaxy', camera));

    const outA: Vec3Tuple = [0, 0, 0];
    const outB: Vec3Tuple = [0, 0, 0];
    omA.toRenderSpace(body, outA);
    omB.toRenderSpace(body, outB);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs((outA[i] as number) - (outB[i] as number))).toBeLessThan(1e-9);
    }
  });
});

describe('createOriginManager — switchContext', () => {
  it('is a no-op when the target equals the current context', () => {
    const tree = createScaleFrameTree();
    const om = createOriginManager(tree, at('galaxy', [8000, 1, 2]));
    om.switchContext('galaxy');
    expect(om.context).toBe('galaxy');
    expect(om.cameraUniverse.local).toEqual([8000, 1, 2]);
  });

  it('preserves the camera physical location through an anchored switch (< 1e-6 m)', () => {
    const tree = createScaleFrameTree();
    tree.setAnchor('system', [8000, 0, 0]);
    // Camera exactly on the system origin: conversion is exact in f64.
    const om = createOriginManager(tree, at('galaxy', [8000, 0, 0]));
    om.switchContext('system');
    expect(om.context).toBe('system');
    const driftMeters =
      Math.hypot(
        om.cameraUniverse.local[0],
        om.cameraUniverse.local[1],
        om.cameraUniverse.local[2],
      ) * U.system;
    expect(driftMeters).toBeLessThan(1e-6);
  });

  it('matches the sanctioned tree conversion exactly', () => {
    const tree = createScaleFrameTree();
    tree.setAnchor('system', [8000, -3, 12]);
    const before = at('galaxy', [8000 + 2 * AU_PER_PC, -3, 12]);
    const om = createOriginManager(tree, before);
    const expected = tree.convert(before, 'system');
    om.switchContext('system');
    expect(om.cameraUniverse.local).toEqual(expected.local);
  });

  it('round-trip switch drifts < 1e-6 m for small intra-system positions', () => {
    const tree = createScaleFrameTree();
    const start: Vec3Tuple = [0.001, 0.002, 0.003]; // AU — f64 keeps this to sub-µm
    const om = createOriginManager(tree, at('system', start));
    om.switchContext('galaxy');
    om.switchContext('system');
    const driftMeters =
      Math.hypot(
        om.cameraUniverse.local[0] - start[0],
        om.cameraUniverse.local[1] - start[1],
        om.cameraUniverse.local[2] - start[2],
      ) * U.system;
    expect(driftMeters).toBeLessThan(1e-6);
  });

  it('converts the origin too: render output stays consistent across the switch', () => {
    const tree = createScaleFrameTree();
    const om = createOriginManager(tree, at('galaxy', [0, 0, 0]));
    om.setCameraPosition(at('galaxy', [10001, 0, 0])); // forces a rebase first
    const body = at('galaxy', [10002, 0, 0]); // 1 pc beyond the camera

    const beforeOut: Vec3Tuple = [0, 0, 0];
    om.toRenderSpace(body, beforeOut); // ≈ [1, 0, 0] galaxy units

    om.switchContext('system');
    const afterOut: Vec3Tuple = [0, 0, 0];
    om.toRenderSpace(body, afterOut); // same vector, now in AU

    const pcInAu = U.galaxy / U.system;
    expect(Math.abs(afterOut[0] - (beforeOut[0] as number) * pcInAu) / pcInAu).toBeLessThan(1e-6);
    expect(Math.abs(afterOut[1] as number)).toBeLessThan(1e-6);
    expect(Math.abs(afterOut[2] as number)).toBeLessThan(1e-6);
  });
});
