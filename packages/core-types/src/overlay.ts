/**
 * Constellation line sets + screen-space label records. See architecture §5.12.
 *
 * Overlay data contract only. Endpoints/positions are resolved/projected by the
 * consumers (data TASK-046, app TASK-049); no positions are stored for constellations.
 */

import type { BodyId } from './bodies';

/** A constellation as line segments between catalog stars, keyed by HIP number.
 *  Endpoints are resolved to positions by `data` (TASK-046), not stored here. */
export interface ConstellationLineSet {
  /** IAU 3-letter code, e.g. "Ori". */
  readonly code: string;
  readonly name: string;
  /** Flat list of HIP-number pairs; segment k connects hipPairs[2k]→hipPairs[2k+1]. */
  readonly hipPairs: readonly number[];
}

/** A screen-space label anchored to a body (the app projects worldPc→screen). */
export interface LabelRecord {
  readonly id: BodyId;
  readonly text: string;
  /** Absolute position, galaxy-context parsecs, f64 (the app projects it). */
  readonly positionPc: readonly [number, number, number];
  /** Lower = more important; the UI shows the most important that fit (§5.12). */
  readonly priority: number;
}
