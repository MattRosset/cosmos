import type { BodyId } from '@cosmos/core-types';
import type {
  StarDataSource,
  SystemsSource,
  CombinedSource,
  OctreeSource,
} from '@cosmos/data';
import type { OverlayData } from '../glue/overlays';

export const M3_SOL_SYSTEM_ID: BodyId = 'sol';

export const HYG_MANIFEST_URL = '/packs/manifest.json';
export const SOL_PACK_URL = '/packs/systems-sol.json';
export const EXO_PACK_URL = '/packs/systems-exo.json';
export const OCTREE_MANIFEST_URL = '/packs/octree/octree.json';
/**
 * Gaia DR3 octree manifest (ADR-006). The committed 135-star sample is the default;
 * production/dense packs are selected at BUILD time via VITE_GAIA_OCTREE_MANIFEST_URL
 * (TASK-065) — e.g. a CDN/R2 URL for the ~4.7M-star pack, or a local dense pack
 * (gitignored) for BUG-10 measurement. Vite inlines the value at build; it is not a
 * runtime switch.
 * BUG-10 measurement: local dense packs built out-of-band (gitignored) —
 * octree-gaia (3M/884 tiles), octree-gaia-1m (~939k/395 tiles).
 */
export const GAIA_OCTREE_MANIFEST_URL: string =
  import.meta.env.VITE_GAIA_OCTREE_MANIFEST_URL ?? '/packs/octree-gaia-sample/octree.json';
export const CONSTELLATIONS_URL = '/packs/constellations.json';

export interface Sources {
  readonly stars: StarDataSource;
  readonly sol: SystemsSource;
  readonly exo: SystemsSource;
  readonly combined: CombinedSource;
  /** HYG octree (M3 streaming tier); absent in debug modes that don't stream. */
  readonly octree?: OctreeSource;
  /**
   * Combined HYG + Gaia octree (M4a, ADR-006 §5): the single source fed to the
   * streaming policy so both catalogs share one cut + `catalogCoverage()`. Absent in
   * M1/M2/M3 debug modes (which keep the HYG-only octree to preserve their baselines).
   */
  readonly octreeCombined?: OctreeSource;
  /** Constellation lines + label candidates (M4a overlays); absent in older modes. */
  readonly overlay?: OverlayData;
}

export type PackState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly sources: Sources };
