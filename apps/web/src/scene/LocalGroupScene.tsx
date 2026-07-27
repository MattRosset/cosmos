import { useEffect, useMemo, type RefObject } from 'react';
import type { ContextId } from '@cosmos/core-types';
import type { GalaxyRecord } from '@cosmos/core-types';
import type { OriginManager } from '@cosmos/coords';
import type { FlightController } from '@cosmos/nav';
import { createGalaxyImpostor, type GalaxyImpostor } from '@cosmos/render-galaxy';
import { PRIORITY_RENDER, useFrameContext } from '@cosmos/scene-host';
import { createImpostorTexture } from '../glue/galaxy-assets';
import { pcScales } from '../glue/context-scale';
import { localGroupPickHolder } from '../glue/local-group-feed';

/**
 * Renders the local-group galaxies (besides the Milky Way) as camera-facing impostor
 * sprites at their real `positionMpc` (TASK-086). A sibling of `GalaxyScene`, not a
 * part of it: that component is driven by the streaming chunk lifecycle
 * (`streaming.onChunk`), the wrong lifecycle for this static in-memory array (D2).
 *
 * Visible only in `universe` context (D3): outside it these sprites would receive a
 * parsec offset rendered as if it were context units (the TASK-081 wrongness) — so
 * they are hidden, not merely mis-scaled, exactly like GalaxyScene's own gate.
 */
export interface LocalGroupSceneProps {
  readonly galaxies: readonly GalaxyRecord[];
  readonly origin: OriginManager;
  readonly controllerRef: RefObject<FlightController | null>;
}

/**
 * Dev/E2E override for the whole local-group layer's visibility (`null`/`true` =
 * shipped behavior — gated on `contextId === 'universe'`; `false` = force-hidden).
 * Mirrors `GalaxyScene.tsx`'s `impostorRadiusOverride` pattern: the frame measurement
 * this backs (G3) must ablate the layer WITHIN one run so the assertion is a
 * self-relative delta, never an absolute lit-pixel count that would encode one
 * machine's SwiftShader build (docs/research/galaxy-impostor-scale-is-inert.md).
 * Reached from `window.__cosmosDev.setLocalGroupVisible`.
 */
export const localGroupVisibleOverride: { current: boolean } = { current: true };

// Module-scoped scratch — no allocations inside the frame callback (§9).
const posScratch: { context: ContextId; local: [number, number, number] } = {
  context: 'universe',
  local: [0, 0, 0],
};
const offScratch: [number, number, number] = [0, 0, 0];

export function LocalGroupScene({ galaxies, origin, controllerRef }: LocalGroupSceneProps) {
  // Shared texture + one impostor per galaxy, built once.
  const assets = useMemo(() => ({ impostorTexture: createImpostorTexture() }), []);

  const impostors = useMemo<readonly GalaxyImpostor[]>(
    () =>
      galaxies.map((g) =>
        createGalaxyImpostor({
          spriteTexture: assets.impostorTexture,
          radiusPc: g.radiusKpc * 1000,
        }),
      ),
    [galaxies, assets],
  );

  useEffect(() => {
    localGroupPickHolder.current = galaxies;
    return () => {
      if (localGroupPickHolder.current === galaxies) localGroupPickHolder.current = null;
    };
  }, [galaxies]);

  useEffect(
    () => () => {
      for (const imp of impostors) imp.dispose();
      assets.impostorTexture.dispose();
    },
    [impostors, assets],
  );

  useFrameContext(() => {
    const ctrl = controllerRef.current;
    const ctx: ContextId = ctrl ? ctrl.contextId : origin.context;
    const shown = ctx === 'universe' && localGroupVisibleOverride.current;

    if (!shown) {
      for (const imp of impostors) imp.setVisible(false);
      return;
    }

    // TASK-081 unit bridge — identical contract to GalaxyScene's universe branch:
    // toRenderSpace returns ACTIVE-CONTEXT units, the renderer's offset contract is
    // PARSECS, so convert with unitsToPc and hand the renderer pcToUnits to apply at
    // the projection (mirror GalaxyScene.tsx ~584-591; do not hand-roll this split).
    const { unitsToPc, pcToUnits } = pcScales(ctx);

    for (let i = 0; i < galaxies.length; i++) {
      const g = galaxies[i]!;
      const imp = impostors[i]!;
      posScratch.context = 'universe';
      posScratch.local[0] = g.positionMpc[0];
      posScratch.local[1] = g.positionMpc[1];
      posScratch.local[2] = g.positionMpc[2];
      origin.toRenderSpace(posScratch, offScratch);
      offScratch[0] *= unitsToPc;
      offScratch[1] *= unitsToPc;
      offScratch[2] *= unitsToPc;
      imp.setVisible(true);
      imp.setContextScale(pcToUnits);
      imp.setRenderOffset(offScratch);
    }
  }, PRIORITY_RENDER);

  return (
    <>
      {impostors.map((imp, i) => (
        <primitive key={galaxies[i]!.id} object={imp.object} />
      ))}
    </>
  );
}
