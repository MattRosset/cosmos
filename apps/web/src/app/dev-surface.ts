declare global {
  interface Window {
    /** Dev/E2E control surface (TASK-052): deterministic tier + tour control. */
    __cosmosDev?: {
      setTier(tier: 'high' | 'medium' | 'low' | null): void;
      startTour(): void;
      stopTour(): void;
      /**
       * Reorient the camera to face the brightest overlay label (galaxy context),
       * so a label is deterministically on-screen. The boot vantage points at an
       * arbitrary patch of sky where none of the labelled giants happen to fall in
       * the frustum; the e2e overlay gate uses this to assert the label DOM without
       * depending on the boot orientation. No-op until packs are ready.
       */
      focusFirstLabel(): void;
      /**
       * Override the far-LOD galaxy impostor's radius in PARSECS (`null` restores the
       * shipped `discRadiusPc`). TASK-082: lets the pixel gate ablate the impostor inside
       * one run, so the assertion is a self-relative frame delta instead of an absolute
       * lit-pixel count that would encode one machine's SwiftShader build.
       */
      setImpostorRadiusPc(radiusPc: number | null): void;
      /**
       * Force-hide (`false`) or restore (`true`) the whole local-group galaxy field
       * (TASK-086), regardless of context. Lets the e2e visibility gate ablate the
       * layer within one run — a self-relative frame delta, never an absolute
       * lit-pixel count that would encode one machine's SwiftShader build.
       */
      setLocalGroupVisible(visible: boolean): void;
      /**
       * Reorient the camera to face an arbitrary universe-context point (TASK-086),
       * without flying there: nudges the camera a negligible distance toward it while
       * slewing orientation via `goTo`'s `lookAtTarget`. No-op outside `universe`
       * context or before the flight controller mounts. Backs the G3/G4 e2e gates,
       * which need a known galaxy on-screen without depending on the boot vantage.
       */
      orientTo(local: readonly [number, number, number]): void;
    };
  }
}

export {};
