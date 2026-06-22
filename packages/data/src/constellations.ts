import type { BodyId, ConstellationLineSet, LabelRecord } from '@cosmos/core-types';
import { PackFormatError } from './load.js';
import type { LoadOptions } from './load.js';

const CONSTELLATION_PACK_FORMAT_VERSION = 1;

/** The committed pack shape (JSON) — mirrors tools/pack-constellations' output (TASK-045). */
export interface ConstellationPack {
  readonly packFormatVersion: typeof CONSTELLATION_PACK_FORMAT_VERSION;
  readonly source: string;
  readonly constellations: readonly ConstellationLineSet[];
}

/** The two thin accessors `createConstellationSource` needs from a star source. */
export interface ConstellationStarSource {
  hipIndex(hip: number): number | undefined;
  positionPcByIndex(index: number): readonly [number, number, number];
}

export interface ConstellationSource {
  readonly constellations: readonly ConstellationLineSet[];
  segmentsPc(): Float64Array;
  segmentCodes(): readonly string[];
}

/** Source for `labelCandidates`: anything exposing an indexed batch of named bodies. */
export interface LabelableSource {
  readonly batch: { readonly count: number };
  getByIndex(index: number): {
    readonly id: BodyId;
    readonly name?: string;
    readonly positionPc: readonly [number, number, number];
    readonly absMag: number;
  };
}

const DEFAULT_LABEL_MAX = 50;

/** Fetch + validate the constellation pack JSON (mirrors loadStarPack's error style). */
export async function loadConstellationPack(
  manifestUrl: string,
  opts?: LoadOptions,
): Promise<ConstellationPack> {
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch;
  const res = await fetchImpl(manifestUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch constellation pack: ${res.status} ${res.statusText}`);
  }
  const pack = (await res.json()) as ConstellationPack;

  if (pack.packFormatVersion !== CONSTELLATION_PACK_FORMAT_VERSION) {
    throw new PackFormatError(
      `Unsupported packFormatVersion ${String(pack.packFormatVersion)}; expected ${String(CONSTELLATION_PACK_FORMAT_VERSION)}`,
    );
  }

  return pack;
}

/** Build a ConstellationSource by resolving HIP pairs against a star source. */
export function createConstellationSource(
  pack: ConstellationPack,
  stars: ConstellationStarSource,
): ConstellationSource {
  const endpoints: number[] = [];
  const codes: string[] = [];

  for (const constellation of pack.constellations) {
    const { hipPairs } = constellation;
    for (let i = 0; i < hipPairs.length; i += 2) {
      const idxA = stars.hipIndex(hipPairs[i]!);
      const idxB = stars.hipIndex(hipPairs[i + 1]!);
      if (idxA === undefined || idxB === undefined) continue;

      const [ax, ay, az] = stars.positionPcByIndex(idxA);
      const [bx, by, bz] = stars.positionPcByIndex(idxB);
      endpoints.push(ax, ay, az, bx, by, bz);
      codes.push(constellation.code);
    }
  }

  const segments = new Float64Array(endpoints);

  return {
    constellations: pack.constellations,
    segmentsPc: () => segments,
    segmentCodes: () => codes,
  };
}

/** Label candidates for the overlay: named bodies, ranked by `priority` (LabelRecord). */
export function labelCandidates(
  source: LabelableSource,
  opts?: { max?: number },
): readonly LabelRecord[] {
  const max = opts?.max ?? DEFAULT_LABEL_MAX;
  const candidates: LabelRecord[] = [];

  for (let i = 0; i < source.batch.count; i++) {
    const record = source.getByIndex(i);
    if (record.name === undefined) continue;
    candidates.push({
      id: record.id,
      text: record.name,
      positionPc: record.positionPc,
      priority: record.absMag,
    });
  }

  candidates.sort((a, b) => a.priority - b.priority);
  return candidates.slice(0, max);
}
