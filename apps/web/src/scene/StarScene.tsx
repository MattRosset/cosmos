import { useEffect, useMemo, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Object3D, PerspectiveCamera } from 'three';
import type { BodyId, StarBatch, UniversePosition } from '@cosmos/core-types';
import type { OriginManager } from '@cosmos/coords';
import type { StarDataSource, CombinedSource } from '@cosmos/data';
import type { FlightController } from '@cosmos/nav';
import type { StreamingPolicy } from '@cosmos/streaming';
import type { ContextId } from '@cosmos/core-types';
import { useSelectionStore, useSettingsStore } from '@cosmos/app-state';
import { createStarPoints, pickStar, type StarPoints, type StarPickHit } from '@cosmos/render-stars';
import { PRIORITY_RENDER, useFrameContext } from '@cosmos/scene-host';
import { profileSpan } from '../glue/frame-profiler';
import { systemPickGroup } from '../glue/system-feed';
import { pickProbeHolder } from '../glue/test-hook';

/** Angular pick threshold, radians (TASK-015 fixed wiring). */
const PICK_MAX_ANGLE_RAD = 0.02;
/** pointerup counts as a click only if total drag stayed under this (px). */
const CLICK_MAX_DRAG_PX = 4;

/**
 * Star-scale clip planes (scene units = pc): goTo arrival is ~3e-4 pc from
 * the target, the farthest HYG entries sit ~1e5 pc out; the logarithmic depth
 * buffer covers the span (and the AU-scale system scene inside it).
 */
const CAMERA_NEAR_PC = 1e-6;
const CAMERA_FAR_PC = 1e6;

// Module-scoped scratch — no allocations inside frame callbacks (§9).
const hygOriginLocal: [number, number, number] = [0, 0, 0];
const HYG_ORIGIN: UniversePosition = { context: 'galaxy', local: hygOriginLocal };
const exoOriginLocal: [number, number, number] = [0, 0, 0];
const EXO_ORIGIN: UniversePosition = { context: 'galaxy', local: exoOriginLocal };
const renderOffsetScratch: [number, number, number] = [0, 0, 0];

/** Rotate v by quaternion q (click-time only — may allocate). */
function rotateByQuat(
  q: readonly [number, number, number, number],
  v: readonly [number, number, number],
): [number, number, number] {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Walk up an intersected object's parents to its bodyId, if any. */
function bodyIdOf(obj: Object3D | null): BodyId | null {
  for (let o = obj; o !== null; o = o.parent) {
    const id = o.userData['bodyId'];
    if (typeof id === 'string') return id;
  }
  return null;
}

/**
 * Coverage threshold above which the monolithic HYG field is gated OFF (ADR-006
 * §5.2): once the octree (HYG + Gaia) tiles cover this fraction of the cut, drawing
 * the HYG `stars.bin` monolith too would draw the same catalog twice. Below it (far,
 * or tiles not yet loaded) the monolith stays as the no-blank-frame fallback.
 */
const MONOLITH_COVERAGE_GATE = 0.9;

interface StarSceneProps {
  readonly stars: StarDataSource;
  readonly combined: CombinedSource;
  readonly origin: OriginManager;
  readonly controllerRef: RefObject<FlightController | null>;
  /**
   * M4a streaming policy. When present, the HYG monolith is gated off in galaxy/
   * universe context once `catalogCoverage()` shows the octree tiles cover the cut
   * (ADR-006 §5.2). Absent (M2/ctxswitch/M3 debug paths) ⇒ monolith always drawn.
   */
  readonly streaming?: StreamingPolicy | undefined;
  /** Double-click on a body: select AND fly (host stars descend into the system). */
  readonly onActivate?: (id: BodyId) => void;
}

/**
 * Mounts the HYG batch and the unresolved-exo-host batch as render-stars draw
 * calls, feeds each its per-frame camera-relative offset, and implements
 * click-picking: planets first (raycast the mounted system group), then the
 * star batches (§5.12).
 */
export function StarScene({
  stars,
  combined,
  origin,
  controllerRef,
  streaming,
  onActivate,
}: StarSceneProps) {
  const hygBatch = stars.batch;
  const exoBatch = combined.extraHostBatch;

  const hygPoints = useMemo(() => {
    hygOriginLocal[0] = hygBatch.originPc[0];
    hygOriginLocal[1] = hygBatch.originPc[1];
    hygOriginLocal[2] = hygBatch.originPc[2];
    const points = createStarPoints({ batch: hygBatch });
    points.object.frustumCulled = false;
    return points;
  }, [hygBatch]);

  const exoPoints = useMemo<StarPoints | null>(() => {
    if (exoBatch === null) return null;
    exoOriginLocal[0] = exoBatch.originPc[0];
    exoOriginLocal[1] = exoBatch.originPc[1];
    exoOriginLocal[2] = exoBatch.originPc[2];
    const points = createStarPoints({ batch: exoBatch });
    points.object.frustumCulled = false;
    return points;
  }, [exoBatch]);

  useEffect(
    () => () => {
      hygPoints.dispose();
      exoPoints?.dispose();
    },
    [hygPoints, exoPoints],
  );

  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  useEffect(() => {
    camera.near = CAMERA_NEAR_PC;
    camera.far = CAMERA_FAR_PC;
    camera.updateProjectionMatrix();
  }, [camera]);

  useEffect(() => {
    const h = size.height * dpr;
    hygPoints.setViewportHeight(h);
    exoPoints?.setViewportHeight(h);
  }, [hygPoints, exoPoints, size.height, dpr]);

  // Exposure: transient store subscription — no React re-render per change.
  useEffect(() => {
    const apply = (exposure: number): void => {
      hygPoints.setExposure(exposure);
      exoPoints?.setExposure(exposure);
    };
    apply(useSettingsStore.getState().exposure);
    return useSettingsStore.subscribe((s) => apply(s.exposure));
  }, [hygPoints, exoPoints]);

  useFrameContext(() => {
    profileSpan('stars.render', () => {
      // ADR-006 §5.2 monolith gate: hide the HYG `stars.bin` field once octree tiles
      // (HYG + Gaia) cover the cut, so the catalog is never drawn twice near Sol.
      // Gated only in galaxy/universe (where the octree draws); in 'system' the
      // octree tier is off, so the field stays as the background. Exo hosts (not in
      // the octree) always draw. Zero-alloc: a coverage read + a visibility flag.
      if (streaming !== undefined) {
        const ctx: ContextId = controllerRef.current?.contextId ?? origin.context;
        const gated =
          (ctx === 'galaxy' || ctx === 'universe') &&
          streaming.catalogCoverage() >= MONOLITH_COVERAGE_GATE;
        hygPoints.object.visible = !gated;
      }
      hygPoints.setRenderOffset(origin.toRenderSpace(HYG_ORIGIN, renderOffsetScratch));
      exoPoints?.setRenderOffset(origin.toRenderSpace(EXO_ORIGIN, renderOffsetScratch));
    });
  }, PRIORITY_RENDER);

  // Picking. The star ray must NOT use the Three camera's position — the camera
  // object holds camera-relative coordinates (≈ 0); absolute position comes from
  // the flight controller. The planet raycast, by contrast, IS taken from the
  // Three camera precisely because the scene is camera-relative.
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    let tracking = false;
    let dragPx = 0;
    let lastX = 0;
    let lastY = 0;

    /** Body under (clientX, clientY): planets first, then the star batches. */
    const pickAt = (clientX: number, clientY: number): BodyId | null => {
      const controller = controllerRef.current;
      if (!controller) return null;

      const rect = el.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);

      // Planets first — raycast the mounted system group (camera-relative scene).
      const grp = systemPickGroup.current;
      if (grp !== null) {
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera as PerspectiveCamera);
        const hits = raycaster.intersectObject(grp, true);
        for (const hit of hits) {
          const id = bodyIdOf(hit.object);
          if (id !== null) return id;
        }
      }

      // Star pick — manual ray from the controller (absolute) state.
      const persp = camera as PerspectiveCamera;
      const tanY = Math.tan((persp.fov * Math.PI) / 360);
      const tanX = tanY * persp.aspect;
      const dir = rotateByQuat(controller.state.orientation, [ndcX * tanX, ndcY * tanY, -1]);
      const len = Math.hypot(dir[0], dir[1], dir[2]);
      dir[0] /= len;
      dir[1] /= len;
      dir[2] /= len;

      const p = controller.state.position.local;
      return pickNearestStar(hygBatch, exoBatch, combined, p, dir);
    };

    /**
     * Inverse of the star pick ray: a position in the camera's current context frame
     * (galaxy pc) → CSS px, via the same live camera + controller orientation/position.
     * Returns null if the point is behind the camera or projects off-screen. Backs the
     * e2e `__cosmos.projectToScreen` query (kills the m1 parallel camera model).
     */
    const projectToScreen = (
      localPos: readonly [number, number, number],
    ): { x: number; y: number } | null => {
      const controller = controllerRef.current;
      if (!controller) return null;
      const persp = camera as PerspectiveCamera;
      const tanY = Math.tan((persp.fov * Math.PI) / 360);
      const tanX = tanY * persp.aspect;
      const p = controller.state.position.local;
      const rel: [number, number, number] = [
        localPos[0] - p[0],
        localPos[1] - p[1],
        localPos[2] - p[2],
      ];
      // World → camera space: rotate by the orientation's conjugate (inverse rotation).
      const q = controller.state.orientation;
      const cam = rotateByQuat([-q[0], -q[1], -q[2], q[3]], rel);
      const cz = cam[2];
      if (cz >= 0) return null; // forward is -Z: cz >= 0 ⇒ behind the camera
      const ndcX = cam[0] / -cz / tanX;
      const ndcY = cam[1] / -cz / tanY;
      if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1) return null;
      const rect = el.getBoundingClientRect();
      return {
        x: rect.left + ((ndcX + 1) / 2) * rect.width,
        y: rect.top + ((1 - ndcY) / 2) * rect.height,
      };
    };

    // Expose the live pick + projection to the e2e hook (no selection side-effect).
    pickProbeHolder.current = { pickAt, projectToScreen };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      tracking = true;
      dragPx = 0;
      lastX = e.clientX;
      lastY = e.clientY;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!tracking) return;
      dragPx += Math.hypot(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!tracking || e.button !== 0) return;
      tracking = false;
      if (dragPx >= CLICK_MAX_DRAG_PX) return;
      useSelectionStore.getState().select(pickAt(e.clientX, e.clientY));
    };

    const onDoubleClick = (e: MouseEvent) => {
      if (onActivate === undefined) return;
      const id = pickAt(e.clientX, e.clientY);
      if (id !== null) onActivate(id);
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('dblclick', onDoubleClick);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('dblclick', onDoubleClick);
      pickProbeHolder.current = null;
    };
  }, [gl, camera, hygBatch, exoBatch, combined, controllerRef, onActivate]);

  return (
    <>
      <primitive object={hygPoints.object} />
      {exoPoints ? <primitive object={exoPoints.object} /> : null}
    </>
  );
}

/** Pick the angularly-nearest star across both batches; smaller angle wins. */
function pickNearestStar(
  hygBatch: StarBatch,
  exoBatch: StarBatch | null,
  combined: CombinedSource,
  cameraLocalPc: readonly [number, number, number],
  dir: readonly [number, number, number],
): BodyId | null {
  const hygOrigin: readonly [number, number, number] = [
    cameraLocalPc[0] - hygBatch.originPc[0],
    cameraLocalPc[1] - hygBatch.originPc[1],
    cameraLocalPc[2] - hygBatch.originPc[2],
  ];
  const hygHit = pickStar(hygBatch, hygOrigin, dir, PICK_MAX_ANGLE_RAD);

  let exoHit: StarPickHit | null = null;
  if (exoBatch !== null) {
    const exoOrigin: readonly [number, number, number] = [
      cameraLocalPc[0] - exoBatch.originPc[0],
      cameraLocalPc[1] - exoBatch.originPc[1],
      cameraLocalPc[2] - exoBatch.originPc[2],
    ];
    exoHit = pickStar(exoBatch, exoOrigin, dir, PICK_MAX_ANGLE_RAD);
  }

  const exoWins = exoHit !== null && (hygHit === null || exoHit.angleRad < hygHit.angleRad);
  if (exoWins && exoBatch !== null && exoHit !== null) {
    return combined.canonicalId(`${exoBatch.idPrefix}:${exoBatch.catalogIds[exoHit.index]!}`);
  }
  if (hygHit !== null) {
    return `${hygBatch.idPrefix}:${hygBatch.catalogIds[hygHit.index]!}`;
  }
  return null;
}
