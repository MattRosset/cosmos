import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { UniversePosition } from '@cosmos/core-types';
import type { OriginManager } from '@cosmos/coords';
import type { FlightController } from '@cosmos/nav';
import { useOverlayStore, useSettingsStore } from '@cosmos/app-state';
import { createLineSet, createNebula, type LineSet, type Nebula } from '@cosmos/render-fx';
import { PRIORITY_RENDER, useFrameContext, useQuality } from '@cosmos/scene-host';
import {
  CONSTELLATION_COLOR,
  CONSTELLATION_OPACITY,
  LABEL_PROJECT_INTERVAL_MS,
  publishLabels,
  toProjectedLabel,
  type OverlayData,
} from '../glue/overlays';
import { NEBULA_FIELDS, createNebulaNoiseTexture } from '../glue/nebulae';
import type { ProjectedLabel } from '@cosmos/ui';

interface OverlaysProps {
  readonly origin: OriginManager;
  readonly overlay: OverlayData;
  readonly controllerRef: RefObject<FlightController | null>;
}

// ── Module-scoped scratch — zero allocations in the frame callback (§9) ──
const galaxyOrigin: UniversePosition = { context: 'galaxy', local: [0, 0, 0] };
const fieldLocalScratch: [number, number, number] = [0, 0, 0];
const fieldOriginScratch: UniversePosition = { context: 'galaxy', local: fieldLocalScratch };
const offScratch: [number, number, number] = [0, 0, 0];

/**
 * Educational overlays in the Canvas (TASK-052, §5.12): constellation lines
 * (render-fx line-set), nebula billboard fields (render-fx, quality-gated), and the
 * ≤ 10 Hz screen-space label projection. Visibility flows from `useOverlayStore`
 * through transient subscriptions + refs so a toggle never re-renders the Canvas;
 * `ui` only ever receives already-projected pixels (it never sees the camera).
 */
export function Overlays({ origin, overlay, controllerRef }: OverlaysProps) {
  void controllerRef;
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  // Nebulae are capped on the low tier (overdraw budget, §5.11); the line-set and
  // labels are tier-independent. useQuality re-renders only on a tier change.
  const tier = useQuality().tier;
  const nebulaeAllowed = tier !== 'low';

  // Constellation line-set: one draw call over all segments (camera-relative f32).
  const lineSet = useMemo<LineSet>(
    () =>
      createLineSet({
        segments: overlay.segmentsF32,
        colorLinear: CONSTELLATION_COLOR,
        opacity: CONSTELLATION_OPACITY,
      }),
    [overlay],
  );

  // Nebula fields share one soft noise texture (caller-owned, §5.11).
  const nebulae = useMemo<{
    readonly noise: THREE.Texture;
    readonly fields: { readonly fieldOriginPc: readonly [number, number, number]; readonly neb: Nebula }[];
  }>(() => {
    const noise = createNebulaNoiseTexture();
    const fields = NEBULA_FIELDS.map((field) => ({
      fieldOriginPc: field.originPc,
      neb: createNebula({ field, noiseTexture: noise }),
    }));
    return { noise, fields };
  }, []);

  useEffect(
    () => () => {
      lineSet.dispose();
      for (const n of nebulae.fields) n.neb.dispose();
      nebulae.noise.dispose();
    },
    [lineSet, nebulae],
  );

  // Visibility refs driven by the overlay store — no Canvas re-render on toggle.
  const showConstellations = useRef(useOverlayStore.getState().constellations);
  const showLabels = useRef(useOverlayStore.getState().labels);
  useEffect(
    () =>
      useOverlayStore.subscribe((s) => {
        showConstellations.current = s.constellations;
        showLabels.current = s.labels;
      }),
    [],
  );

  // Exposure relay for the additive nebula billboards (transient — no re-render).
  const exposure = useRef(useSettingsStore.getState().exposure);
  useEffect(() => {
    const apply = (e: number): void => {
      exposure.current = e;
    };
    apply(useSettingsStore.getState().exposure);
    return useSettingsStore.subscribe((s) => apply(s.exposure));
  }, []);

  // Per-frame: offsets + visibility relays only (zero allocation, §9).
  useFrameContext(() => {
    const lineVisible = showConstellations.current;
    lineSet.setVisible(lineVisible);
    if (lineVisible) {
      origin.toRenderSpace(galaxyOrigin, offScratch);
      lineSet.setRenderOffset(offScratch);
    }
    for (let i = 0; i < nebulae.fields.length; i++) {
      const { fieldOriginPc, neb } = nebulae.fields[i]!;
      if (!nebulaeAllowed) {
        neb.setVisible(false);
        continue;
      }
      neb.setVisible(true);
      fieldLocalScratch[0] = fieldOriginPc[0];
      fieldLocalScratch[1] = fieldOriginPc[1];
      fieldLocalScratch[2] = fieldOriginPc[2];
      origin.toRenderSpace(fieldOriginScratch, offScratch);
      neb.setRenderOffset(offScratch);
      neb.setExposure(exposure.current);
      neb.setOpacity(1);
    }
  }, PRIORITY_RENDER);

  // ≤ 10 Hz label projection (§5.12): world → screen px on the app side; the result
  // is published to the HUD's label host so the Canvas never re-renders for labels.
  const projectScratch = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const project = (): void => {
      if (!showLabels.current) {
        publishLabels([]);
        return;
      }
      const w = size.width;
      const h = size.height;
      const out: ProjectedLabel[] = [];
      for (const label of overlay.labels) {
        fieldLocalScratch[0] = label.positionPc[0];
        fieldLocalScratch[1] = label.positionPc[1];
        fieldLocalScratch[2] = label.positionPc[2];
        origin.toRenderSpace(fieldOriginScratch, offScratch);
        projectScratch.set(offScratch[0], offScratch[1], offScratch[2]);
        projectScratch.project(camera);
        const visible =
          projectScratch.z > -1 &&
          projectScratch.z < 1 &&
          projectScratch.x >= -1 &&
          projectScratch.x <= 1 &&
          projectScratch.y >= -1 &&
          projectScratch.y <= 1;
        const xPx = (projectScratch.x * 0.5 + 0.5) * w;
        const yPx = (-projectScratch.y * 0.5 + 0.5) * h;
        out.push(toProjectedLabel(label, xPx, yPx, visible));
      }
      publishLabels(out);
    };
    const id = setInterval(project, LABEL_PROJECT_INTERVAL_MS);
    project();
    return () => {
      clearInterval(id);
      publishLabels([]);
    };
  }, [overlay, origin, camera, size.width, size.height, projectScratch]);

  return (
    <>
      <primitive object={lineSet.object} />
      {nebulae.fields.map((n) => (
        <primitive key={n.neb.object.uuid} object={n.neb.object} />
      ))}
    </>
  );
}
