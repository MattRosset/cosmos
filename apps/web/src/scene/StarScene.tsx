import { useEffect, useMemo, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';
import type { UniversePosition } from '@cosmos/core-types';
import type { OriginManager } from '@cosmos/coords';
import type { StarDataSource } from '@cosmos/data';
import type { FlightController } from '@cosmos/nav';
import { useSelectionStore, useSettingsStore } from '@cosmos/app-state';
import { createStarPoints, pickStar } from '@cosmos/render-stars';
import { PRIORITY_RENDER, useFrameContext } from '@cosmos/scene-host';

/** Angular pick threshold, radians (TASK-015 fixed wiring). */
const PICK_MAX_ANGLE_RAD = 0.02;
/** pointerup counts as a click only if total drag stayed under this (px). */
const CLICK_MAX_DRAG_PX = 4;

/**
 * Star-scale clip planes (scene units = pc): goTo arrival is ~3e-4 pc from
 * the target, the farthest HYG entries sit ~1e5 pc out; the logarithmic depth
 * buffer covers the span.
 */
const CAMERA_NEAR_PC = 1e-6;
const CAMERA_FAR_PC = 1e6;

// Module-scoped scratch — no allocations inside frame callbacks (§9).
const batchOriginLocal: [number, number, number] = [0, 0, 0];
const BATCH_ORIGIN: UniversePosition = { context: 'galaxy', local: batchOriginLocal };
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

interface StarSceneProps {
  readonly source: StarDataSource;
  readonly origin: OriginManager;
  readonly controllerRef: RefObject<FlightController | null>;
}

/**
 * Mounts the HYG batch as one render-stars draw call, feeds it the per-frame
 * camera-relative offset, and implements click-picking (§5.12: picking lives
 * with the scene and dispatches to the selection store).
 */
export function StarScene({ source, origin, controllerRef }: StarSceneProps) {
  const batch = source.batch;

  const starPoints = useMemo(() => {
    batchOriginLocal[0] = batch.originPc[0];
    batchOriginLocal[1] = batch.originPc[1];
    batchOriginLocal[2] = batch.originPc[2];
    const points = createStarPoints({ batch });
    // Stars are positioned by the per-frame offset uniform, so the static
    // tile-local bounding sphere is meaningless for culling.
    points.object.frustumCulled = false;
    return points;
  }, [batch]);

  useEffect(() => () => starPoints.dispose(), [starPoints]);

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
    starPoints.setViewportHeight(size.height * dpr);
  }, [starPoints, size.height, dpr]);

  // Exposure: transient store subscription — no React re-render per change.
  useEffect(() => {
    starPoints.setExposure(useSettingsStore.getState().exposure);
    return useSettingsStore.subscribe((s) => starPoints.setExposure(s.exposure));
  }, [starPoints]);

  useFrameContext(() => {
    starPoints.setRenderOffset(origin.toRenderSpace(BATCH_ORIGIN, renderOffsetScratch));
  }, PRIORITY_RENDER);

  // Picking. The ray must NOT use the Three camera's position — the camera
  // object holds camera-relative coordinates (≈ 0). Absolute position and
  // orientation come from the flight controller; only fov/aspect are read
  // from the camera.
  useEffect(() => {
    const el = gl.domElement;
    let tracking = false;
    let dragPx = 0;
    let lastX = 0;
    let lastY = 0;

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
      const controller = controllerRef.current;
      if (!controller) return;

      const rect = el.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      const persp = camera as PerspectiveCamera;
      const tanY = Math.tan((persp.fov * Math.PI) / 360);
      const tanX = tanY * persp.aspect;
      const dir = rotateByQuat(controller.state.orientation, [
        ndcX * tanX,
        ndcY * tanY,
        -1,
      ]);
      const len = Math.hypot(dir[0], dir[1], dir[2]);
      dir[0] /= len;
      dir[1] /= len;
      dir[2] /= len;

      // Ray origin in tile-local pc: absolute camera position − batch origin.
      const p = controller.state.position.local;
      const o: readonly [number, number, number] = [
        p[0] - batch.originPc[0],
        p[1] - batch.originPc[1],
        p[2] - batch.originPc[2],
      ];

      const hit = pickStar(batch, o, dir, PICK_MAX_ANGLE_RAD);
      useSelectionStore
        .getState()
        .select(hit ? `${batch.idPrefix}:${batch.catalogIds[hit.index]!}` : null);
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
    };
  }, [gl, camera, batch, controllerRef]);

  return <primitive object={starPoints.object} />;
}
