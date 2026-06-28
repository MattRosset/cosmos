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
  liveLabels,
  publishLabelSet,
  type OverlayData,
} from '../glue/overlays';
import { NEBULA_FIELDS, createNebulaNoiseTexture } from '../glue/nebulae';
import type { LabelRecord } from '@cosmos/core-types';

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
const EMPTY_LABELS: readonly LabelRecord[] = [];

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

  // Per-frame: offsets + relays + the label projection (zero allocation, §9). Labels are
  // projected EVERY frame (BUG-5 fix) — the old 10 Hz interval froze label pixels between
  // updates so they swam relative to their targets while the camera moved. The host owns
  // the DOM imperatively (the `SpeedReadout` pattern), so per-frame projection never
  // re-renders the Canvas OR the HUD; we only mutate the shared live-label buffer in place.
  const projectScratch = useMemo(() => new THREE.Vector3(), []);
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

    if (showLabels.current) {
      const buf = liveLabels();
      const w = size.width;
      const h = size.height;
      for (let i = 0; i < buf.length; i++) {
        const ll = buf[i]!;
        fieldLocalScratch[0] = ll.positionPc[0];
        fieldLocalScratch[1] = ll.positionPc[1];
        fieldLocalScratch[2] = ll.positionPc[2];
        origin.toRenderSpace(fieldOriginScratch, offScratch);
        projectScratch.set(offScratch[0], offScratch[1], offScratch[2]);
        // Resolve view space FIRST so visibility can gate on the camera-space sign
        // (z < 0 ⇒ in front). A plain `.project()` + NDC-box test is not enough: a
        // point BEHIND the camera divides by a negative w, which can sign-flip its
        // x/y back into [-1, 1] and surface a phantom label for a star that is behind
        // you. Testing "in front" explicitly avoids that.
        projectScratch.applyMatrix4(camera.matrixWorldInverse);
        const inFront = projectScratch.z < 0;
        projectScratch.applyMatrix4(camera.projectionMatrix); // perspective divide → NDC x/y
        ll.visible =
          inFront &&
          projectScratch.x >= -1 &&
          projectScratch.x <= 1 &&
          projectScratch.y >= -1 &&
          projectScratch.y <= 1;
        ll.xPx = (projectScratch.x * 0.5 + 0.5) * w;
        ll.yPx = (-projectScratch.y * 0.5 + 0.5) * h;
      }
    }
  }, PRIORITY_RENDER);

  // Label SET membership (rare): rebuild the shared buffer when the candidate set changes
  // or the Labels toggle flips. The host re-mounts its DOM nodes off this; per-frame pixel
  // updates ride the projector above. Toggling off publishes an empty set (host clears).
  useEffect(() => {
    let on = useOverlayStore.getState().labels;
    publishLabelSet(on ? overlay.labels : EMPTY_LABELS);
    return useOverlayStore.subscribe((s) => {
      if (s.labels === on) return;
      on = s.labels;
      publishLabelSet(on ? overlay.labels : EMPTY_LABELS);
    });
  }, [overlay]);

  return (
    <>
      <primitive object={lineSet.object} />
      {nebulae.fields.map((n) => (
        <primitive key={n.neb.object.uuid} object={n.neb.object} />
      ))}
    </>
  );
}
