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
    };
  }
}

export {};
