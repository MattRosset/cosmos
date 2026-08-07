import { useEffect, useMemo, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Object3D, PerspectiveCamera } from 'three';
import type { BodyId, StarBatch, UniversePosition } from '@cosmos/core-types';
import type { OriginManager } from '@cosmos/coords';
import type { StarDataSource, CombinedSource, GaiaSourceIdResolver } from '@cosmos/data';
import type { FlightController } from '@cosmos/nav';
import type { StreamingPolicy } from '@cosmos/streaming';
import type { ContextId } from '@cosmos/core-types';
import { useSelectionStore, useSettingsStore } from '@cosmos/app-state';
import { createStarPoints, type StarPoints, type StarPickHit } from '@cosmos/render-stars';
import { PRIORITY_RENDER, useFrameContext } from '@cosmos/scene-host';
import { pickNearestGalaxy } from '@cosmos/nav';
import {
  effectiveStarExposure,
  NATURAL_VISIBILITY_PROFILE,
  type StarVisibilityProfile,
} from '@cosmos/photometry';
import { pickNearestVisibleStar } from '../glue/star-pick';
import { profileSpan } from '../glue/frame-profiler';
import { systemPickGroup } from '../glue/system-feed';
import { localGroupPickHolder } from '../glue/local-group-feed';
import { pickProbeHolder } from '../glue/test-hook';
import { pcScales } from '../glue/context-scale';
import { octreePickHolder } from '../glue/octree-pick-feed';
import { monolithVisibleHolder } from '../glue/test-hook';
import { pickNearestGaia, gaiaHitWins, type OctreePickTile, type GaiaPickHit } from '../glue/octree-pick';
import type { CombinedOctreeSource } from '../glue/octree-combined';
import { selectWithGaiaUpgrade, type SelectionPort } from '../glue/gaia-identity';
import { gaiaCardHolder, type GaiaCardDetails } from '../glue/gaia-card';

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
  /**
   * Combined HYG+Gaia octree source (TASK-088 D3). When present, `pickAt` also scans the
   * currently-visible Gaia octree tiles (`octreePickHolder`) and can return a `gaia:*` id;
   * its `prefixRangesFor(chunkId)` supplies per-source provenance at click time. Absent (M2/
   * M3/debug paths that don't stream the combined source) ⇒ octree gaia pick simply off.
   */
  readonly octreeCombined?: CombinedOctreeSource | undefined;
  /**
   * Gaia DR3 identity resolver (TASK-088 D4). When present, a provisional `gaia:<catalogId>`
   * pick is upgraded asynchronously to the real `gaia:<source_id>` at the select sites. Absent
   * ⇒ the provisional catalog-indexed id is kept.
   */
  readonly gaiaIds?: GaiaSourceIdResolver | undefined;
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
  octreeCombined,
  gaiaIds,
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
      // Publish the LIVE flag (not `!gated`): in the M3 baseline path `streaming` is
      // absent and the monolith always draws, and that is exactly what the gate must see.
      monolithVisibleHolder.current = hygPoints.object.visible;
      // TASK-081: the renderers' offset contract is PARSECS, but toRenderSpace returns
      // ACTIVE-CONTEXT units. Convert in place (zero alloc) and pair with the scale the
      // shader applies at the projection. Both are exactly 1 in galaxy context, so this
      // block is bit-identical there.
      const { unitsToPc, pcToUnits } = pcScales(
        controllerRef.current?.contextId ?? origin.context,
      );
      const hygOff = origin.toRenderSpace(HYG_ORIGIN, renderOffsetScratch);
      hygOff[0] *= unitsToPc;
      hygOff[1] *= unitsToPc;
      hygOff[2] *= unitsToPc;
      hygPoints.setContextScale(pcToUnits);
      hygPoints.setRenderOffset(hygOff);
      if (exoPoints) {
        const exoOff = origin.toRenderSpace(EXO_ORIGIN, renderOffsetScratch);
        exoOff[0] *= unitsToPc;
        exoOff[1] *= unitsToPc;
        exoOff[2] *= unitsToPc;
        exoPoints.setContextScale(pcToUnits);
        exoPoints.setRenderOffset(exoOff);
      }
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

    /** Body under (clientX, clientY) with the gaia pick's physical details (TASK-089 D3).
     *  Pure query — no side-effects, no holder writes. `pickAt` delegates to this. */
    const pickAtDetailed = (
      clientX: number,
      clientY: number,
    ): { id: BodyId | null; gaia: GaiaCardDetails | null } => {
      const controller = controllerRef.current;
      if (!controller) return { id: null, gaia: null };

      const rect = el.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);

      // Universe context: the galaxy field fully OWNS the click (TASK-086, D4). Stars/
      // planets are not present in universe context, so without this gate the fallback
      // pickNearestStar below would run over the galaxy-context HYG batch and could
      // return a bogus star id (Failure modes note). Computed and returned BEFORE the
      // planet raycast; galaxy positions/camera are both universe-frame Mpc so the
      // angle is unit-consistent with no conversion.
      if (controller.contextId === 'universe' && localGroupPickHolder.current !== null) {
        const persp = camera as PerspectiveCamera;
        const tanY = Math.tan((persp.fov * Math.PI) / 360);
        const tanX = tanY * persp.aspect;
        const dir = rotateByQuat(controller.state.orientation, [ndcX * tanX, ndcY * tanY, -1]);
        const len = Math.hypot(dir[0], dir[1], dir[2]);
        dir[0] /= len;
        dir[1] /= len;
        dir[2] /= len;
        const p = controller.state.position.local;
        return { id: pickNearestGalaxy(localGroupPickHolder.current, p, dir), gaia: null };
      }

      // Planets first — raycast the mounted system group (camera-relative scene).
      const grp = systemPickGroup.current;
      if (grp !== null) {
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera as PerspectiveCamera);
        const hits = raycaster.intersectObject(grp, true);
        for (const hit of hits) {
          const id = bodyIdOf(hit.object);
          if (id !== null) return { id, gaia: null };
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

      // The origin is in active-context units, but `pickNearestStar` subtracts
      // `batch.originPc` (parsecs) — so scale it to parsecs first (TASK-083). Galaxy
      // context returns literal `1`, keeping every existing galaxy pick bit-identical.
      // Click-time only, so the allocation is fine (`pick.ts:13`). Do NOT scale the
      // galaxy-pick or `projectToScreen` reads of `.local` — those are self-consistent
      // in their own frames (see TASK-083 §Frozen surface).
      const { unitsToPc } = pcScales(controller.contextId);
      const local = controller.state.position.local;
      const p: [number, number, number] = [
        local[0] * unitsToPc,
        local[1] * unitsToPc,
        local[2] * unitsToPc,
      ];
      // TASK-103: read the exposure slider ONCE at click time and reuse it for both pick paths
      // (HYG/exo below and the Gaia branch further down). Natural is hard-selected: `useSettingsStore`
      // has no `mode` field until VIS-05 (TASK-102), so the mode-aware `VISIBILITY_PROFILES[mode]`
      // branch would be dead code. HYG/exo multiplier is 1 in both profiles, so this is
      // behavior-identical to Survey; when 102 lands, switch this one line and both picks follow.
      const sliderExposure = useSettingsStore.getState().exposure;
      const profile: StarVisibilityProfile = NATURAL_VISIBILITY_PROFILE;
      const starHit = pickNearestStar(hygBatch, exoBatch, combined, p, dir, profile, sliderExposure);

      // Octree Gaia branch (TASK-088 D3) — strictly ADDITIVE. Scan the currently-visible Gaia
      // octree tiles (published by GalaxyScene) for the nearest gaia star, reusing the SAME
      // already-pc-scaled `p`/`dir` the HYG pick used (do NOT re-scale — TASK-083). Only runs
      // when the combined source is present (real experience); off for debug apps. Emits ONLY
      // `gaia:*`: a hit in a hyg-v41 sub-range is never a candidate (pickNearestGaia scope).
      let gaiaHit: GaiaPickHit | null = null;
      const mounts = octreePickHolder.current;
      if (octreeCombined !== undefined && mounts !== null && mounts.length > 0) {
        const tiles: OctreePickTile[] = [];
        for (const m of mounts) {
          tiles.push({ batch: m.batch, ranges: octreeCombined.prefixRangesFor(m.chunkId) });
        }
        // TASK-100: gate candidates on the SAME perceptibility predicate the renderer and tile
        // cull use, so the pick can only claim a star the frame draws. Reuses the `profile` and
        // `sliderExposure` hoisted above (Natural until VIS-05; `GalaxyScene` mounts draw with
        // this exact effective exposure). When mode state lands, that one hoisted line switches
        // the profile and both picks follow automatically.
        const octreeExposure = effectiveStarExposure(profile, 'galaxy-octree', sliderExposure);
        gaiaHit = pickNearestGaia(tiles, p, dir, PICK_MAX_ANGLE_RAD, octreeExposure);
      }

      // Cross-batch nearest, gaia-scoped: smaller angle wins (same rule as exo vs hyg). A gaia
      // win returns the PROVISIONAL `gaia:<catalogId>` synchronously (identity is upgraded to
      // `gaia:<source_id>` at the select sites, D4); otherwise the hyg/exo/null result unchanged.
      if (gaiaHitWins(gaiaHit, starHit?.angleRad ?? null) && gaiaHit !== null) {
        return {
          id: `gaia:${gaiaHit.catalogId}`,
          gaia: { catalogId: gaiaHit.catalogId, sourceId: null, positionPc: gaiaHit.positionPc, absMag: gaiaHit.absMag, colorIndexBV: gaiaHit.colorIndexBV },
        };
      }
      return { id: starHit?.id ?? null, gaia: null };
    };

    /** Pure id query (no side-effects). Backs `__cosmos.pickAt` (e2e sweep contract). */
    const pickAt = (clientX: number, clientY: number): BodyId | null =>
      pickAtDetailed(clientX, clientY).id;

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

    // Select + async gaia identity upgrade (TASK-088 D4), shared by onPointerUp and
    // onDoubleClick. The store is read fresh on each side so the staleness guard sees the
    // current selection. Logic + the guard live in the unit-tested `selectWithGaiaUpgrade`.
    const selectionPort: SelectionPort = {
      select: (id) => useSelectionStore.getState().select(id),
      getSelectedId: () => useSelectionStore.getState().selectedId,
    };
    const selectAndUpgrade = (id: BodyId | null, gaiaDetails: GaiaCardDetails | null = null): void => {
      if (gaiaDetails !== null) {
        gaiaCardHolder.current = gaiaDetails;
      } else if (!id?.startsWith('gaia:')) {
        gaiaCardHolder.current = null;
      }
      selectWithGaiaUpgrade(id, selectionPort, gaiaIds, (catalogId, sourceId) => {
        if (gaiaCardHolder.current?.catalogId === catalogId) {
          gaiaCardHolder.current.sourceId = sourceId;
        }
      });
    };

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
      const { id, gaia } = pickAtDetailed(e.clientX, e.clientY);
      selectAndUpgrade(id, gaia);
    };

    const onDoubleClick = (e: MouseEvent) => {
      const { id, gaia } = pickAtDetailed(e.clientX, e.clientY);
      if (id === null) return;
      // A gaia star is not a flyable host — a double-click on it is a plain selection, never a
      // go-to (goto.goTo('gaia:…') would fail to resolve). TASK-088 D4. Non-gaia ids keep the
      // existing onActivate (select + fly) behavior byte-for-byte.
      if (id.startsWith('gaia:')) {
        selectAndUpgrade(id, gaia);
        return;
      }
      if (onActivate !== undefined) onActivate(id);
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
  }, [gl, camera, hygBatch, exoBatch, combined, controllerRef, onActivate, octreeCombined, gaiaIds]);

  return (
    <>
      <primitive object={hygPoints.object} />
      {exoPoints ? <primitive object={exoPoints.object} /> : null}
    </>
  );
}

/** Pick the angularly-nearest star across both batches; smaller angle wins. Returns the id
 *  AND its angle so the caller can compare it against the octree gaia hit (TASK-088 D3). */
function pickNearestStar(
  hygBatch: StarBatch,
  exoBatch: StarBatch | null,
  combined: CombinedSource,
  cameraLocalPc: readonly [number, number, number],
  dir: readonly [number, number, number],
  profile: StarVisibilityProfile,
  sliderExposure: number,
): { id: BodyId; angleRad: number } | null {
  // TASK-103: gate each candidate on the SAME perceptibility predicate the renderer and tile cull
  // use, so the pick can only claim a star the frame draws. HYG and exoplanet both have exposure
  // multiplier 1 in every profile (ADR-007 §8), but route the raw slider through
  // `effectiveStarExposure` anyway — one source of truth, so the seam is ready if a future profile
  // ever gives HYG/exo a non-1 multiplier. Do NOT hardcode "exposure = slider".
  const hygOrigin: readonly [number, number, number] = [
    cameraLocalPc[0] - hygBatch.originPc[0],
    cameraLocalPc[1] - hygBatch.originPc[1],
    cameraLocalPc[2] - hygBatch.originPc[2],
  ];
  const hygHit = pickNearestVisibleStar(
    hygBatch,
    hygOrigin,
    dir,
    PICK_MAX_ANGLE_RAD,
    effectiveStarExposure(profile, 'hyg', sliderExposure),
  );

  let exoHit: StarPickHit | null = null;
  if (exoBatch !== null) {
    const exoOrigin: readonly [number, number, number] = [
      cameraLocalPc[0] - exoBatch.originPc[0],
      cameraLocalPc[1] - exoBatch.originPc[1],
      cameraLocalPc[2] - exoBatch.originPc[2],
    ];
    exoHit = pickNearestVisibleStar(
      exoBatch,
      exoOrigin,
      dir,
      PICK_MAX_ANGLE_RAD,
      effectiveStarExposure(profile, 'exoplanet', sliderExposure),
    );
  }

  const exoWins = exoHit !== null && (hygHit === null || exoHit.angleRad < hygHit.angleRad);
  if (exoWins && exoBatch !== null && exoHit !== null) {
    return {
      id: combined.canonicalId(`${exoBatch.idPrefix}:${exoBatch.catalogIds[exoHit.index]!}`),
      angleRad: exoHit.angleRad,
    };
  }
  if (hygHit !== null) {
    return {
      id: `${hygBatch.idPrefix}:${hygBatch.catalogIds[hygHit.index]!}`,
      angleRad: hygHit.angleRad,
    };
  }
  return null;
}
