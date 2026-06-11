/**
 * Scale-frame tree: f64 conversions between scale contexts (ADR-001).
 *
 * Fixed parent chain: planet → system → galaxy → universe. Each non-universe
 * context has an f64 anchor expressing where its origin sits in its PARENT's
 * units. All math here is f64 (plain JS numbers); f32 never appears in this
 * package — callers downcast `toRenderSpace` output (see origin.ts).
 */
import type { ContextId, UniversePosition } from '@cosmos/core-types';
import { CONTEXT_UNIT_METERS } from '@cosmos/core-types';

export type Vec3Tuple = [number, number, number];

export interface ScaleFrameTree {
  /** Set where `context`'s origin sits, expressed in its PARENT's units (f64). */
  setAnchor(context: Exclude<ContextId, 'universe'>, parentLocalUnits: Vec3Tuple): void;
  getAnchor(context: Exclude<ContextId, 'universe'>): Vec3Tuple;
  /** Pure f64 conversion. Round-trips must lose < 1e-6 relative error (§5.2). */
  convert(pos: UniversePosition, target: ContextId): UniversePosition;
  /** Distance in METERS, routed through the common ancestor frame — the only
   *  sanctioned way to compare positions across contexts (ADR-001 §Consequences). */
  distanceMeters(a: UniversePosition, b: UniversePosition): number;
}

type ChildContextId = Exclude<ContextId, 'universe'>;

/**
 * Package-internal extension: allocation-free conversion into a caller-provided
 * tuple, used by the OriginManager frame paths (§9: zero per-frame allocations).
 * Not part of the frozen public API.
 */
export interface FrameTreeInternal extends ScaleFrameTree {
  convertInto(
    source: ContextId,
    x: number,
    y: number,
    z: number,
    target: ContextId,
    out: Vec3Tuple,
  ): Vec3Tuple;
}

/** Chain ordered root-first; index = depth. */
const CHAIN = ['universe', 'galaxy', 'system', 'planet'] as const;

const DEPTH: Record<ContextId, number> = { universe: 0, galaxy: 1, system: 2, planet: 3 };

/** unit(child) / unit(parent): scales child-unit lengths into parent units. */
const RATIO_TO_PARENT: Record<ChildContextId, number> = {
  galaxy: CONTEXT_UNIT_METERS.galaxy / CONTEXT_UNIT_METERS.universe,
  system: CONTEXT_UNIT_METERS.system / CONTEXT_UNIT_METERS.galaxy,
  planet: CONTEXT_UNIT_METERS.planet / CONTEXT_UNIT_METERS.system,
};

/** unit(parent) / unit(child): scales parent-unit lengths into child units. */
const RATIO_FROM_PARENT: Record<ChildContextId, number> = {
  galaxy: CONTEXT_UNIT_METERS.universe / CONTEXT_UNIT_METERS.galaxy,
  system: CONTEXT_UNIT_METERS.galaxy / CONTEXT_UNIT_METERS.system,
  planet: CONTEXT_UNIT_METERS.system / CONTEXT_UNIT_METERS.planet,
};

// Module-scoped scratch (no allocations in distance/frame paths, §9).
const scratchA: Vec3Tuple = [0, 0, 0];
const scratchB: Vec3Tuple = [0, 0, 0];

export function createScaleFrameTree(): ScaleFrameTree {
  const anchors: Record<ChildContextId, Vec3Tuple> = {
    galaxy: [0, 0, 0],
    system: [0, 0, 0],
    planet: [0, 0, 0],
  };

  const convertInto = (
    source: ContextId,
    x: number,
    y: number,
    z: number,
    target: ContextId,
    out: Vec3Tuple,
  ): Vec3Tuple => {
    let depth = DEPTH[source];
    const targetDepth = DEPTH[target];
    let ctx: ContextId = source;
    // Walk up: child local → parent local (anchor + scaled offset).
    while (depth > targetDepth) {
      const child = ctx as ChildContextId;
      const a = anchors[child];
      const r = RATIO_TO_PARENT[child];
      x = a[0] + x * r;
      y = a[1] + y * r;
      z = a[2] + z * r;
      depth -= 1;
      ctx = CHAIN[depth] as ContextId;
    }
    // Walk down: parent local → child local (offset from anchor, rescaled).
    while (depth < targetDepth) {
      const child = CHAIN[depth + 1] as ChildContextId;
      const a = anchors[child];
      const r = RATIO_FROM_PARENT[child];
      x = (x - a[0]) * r;
      y = (y - a[1]) * r;
      z = (z - a[2]) * r;
      depth += 1;
    }
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
  };

  const tree: FrameTreeInternal = {
    setAnchor(context, parentLocalUnits) {
      const a = anchors[context];
      a[0] = parentLocalUnits[0];
      a[1] = parentLocalUnits[1];
      a[2] = parentLocalUnits[2];
    },

    getAnchor(context) {
      const a = anchors[context];
      return [a[0], a[1], a[2]];
    },

    convert(pos, target) {
      const local: Vec3Tuple = [0, 0, 0];
      convertInto(pos.context, pos.local[0], pos.local[1], pos.local[2], target, local);
      return { context: target, local };
    },

    distanceMeters(a, b) {
      // Linear chain ⇒ the common ancestor is the shallower of the two
      // contexts. Subtracting there minimizes precision loss.
      const common: ContextId = DEPTH[a.context] <= DEPTH[b.context] ? a.context : b.context;
      convertInto(a.context, a.local[0], a.local[1], a.local[2], common, scratchA);
      convertInto(b.context, b.local[0], b.local[1], b.local[2], common, scratchB);
      const dx = scratchA[0] - scratchB[0];
      const dy = scratchA[1] - scratchB[1];
      const dz = scratchA[2] - scratchB[2];
      return Math.hypot(dx, dy, dz) * CONTEXT_UNIT_METERS[common];
    },

    convertInto,
  };

  return tree;
}
