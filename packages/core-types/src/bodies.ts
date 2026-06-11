import type { KeplerElements } from './orbits';

/** Namespaced id, e.g. "hyg:32349" (catalog) or "proc:gal0:sec12:42" (procedural). */
export type BodyId = string;

export interface StarRecord {
  readonly id: BodyId;
  readonly kind: 'star';
  readonly name?: string;
  /** Galactic Cartesian position, PARSECS — canonical universe frame (ADR-001, §2.2). */
  readonly positionPc: readonly [number, number, number];
  /** Absolute visual magnitude. */
  readonly absMag: number;
  /** B–V color index (temperature proxy for the blackbody LUT, §5.9). */
  readonly colorIndexBV: number;
  /** Hierarchical procgen seed — present ONLY on procedural stars. */
  readonly seed?: number;
}

export interface PlanetRecord {
  readonly id: BodyId;
  readonly kind: 'planet';
  readonly name?: string;
  /** Star or planet (for moons) this body orbits. */
  readonly parentId: BodyId;
  readonly radiusKm: number;
  readonly massKg?: number;
  /** Absent ⇒ procedural fallback per §5.7 missing-data rules (documented there). */
  readonly elements?: KeplerElements;
  readonly seed?: number;
}

export interface GalaxyRecord {
  readonly id: BodyId;
  readonly kind: 'galaxy';
  readonly name?: string;
  /** Position in the universe context, MEGAPARSECS. */
  readonly positionMpc: readonly [number, number, number];
  readonly radiusKpc: number;
  /** Procedural galaxies are fully seed-defined. */
  readonly seed: number;
}

export type BodyRecord = StarRecord | PlanetRecord | GalaxyRecord;
