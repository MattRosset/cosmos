import type { BodyId, BodyRecord, PlanetRecord, StarBatch, StarRecord } from '@cosmos/core-types';
import type { StarDataSource } from './source.js';
import type { SystemsSource } from './systems.js';

export interface NearestHostHit {
  readonly systemId: BodyId;
  readonly distancePc: number;
}

export interface CombinedSource {
  /** Star, host, or planet — one namespace. */
  getBody(id: BodyId): BodyRecord | undefined;
  /**
   * Unified search over HYG stars, hosts, and planets. Ranking: exact name match
   * first, then prefix, then substring; ties by ascending absMag (stars) /
   * alphabetical (planets). Hosts deduplicated per the rule in createCombinedSource.
   */
  search(query: string, max?: number): BodyRecord[];
  /**
   * Exo hosts NOT resolved to an HYG star, as a renderable batch.
   * idPrefix "exoidx"; catalogIds[i] = i. null when every host resolved.
   */
  readonly extraHostBatch: StarBatch | null;
  /** Maps extraHostBatch index → the host star's real BodyId. */
  readonly hostIdByIndex: readonly BodyId[];
  /** Resolve a batch-pick id ("exoidx:i") or any id to its canonical record id. */
  canonicalId(id: BodyId): BodyId;
  /**
   * Anchor of the system whose HOST STAR is nearest to the given absolute
   * galaxy-frame position (pc). Includes 'sol'. Low-frequency call (≤ 10 Hz) —
   * allocates the hit object.
   */
  nearestHostSystem(xPc: number, yPc: number, zPc: number): NearestHostHit | null;
  /** Host star's absolute galaxy-frame position for a system. */
  hostPositionPc(systemId: BodyId): readonly [number, number, number] | undefined;
}

interface HostEntry {
  readonly systemId: BodyId;
  readonly packRecord: StarRecord;
  /** HYG star id when the host was deduplicated to an HYG star; undefined otherwise. */
  readonly hygId: BodyId | undefined;
  /** Authoritative position: HYG position when deduped, pack position otherwise. */
  readonly positionPc: readonly [number, number, number];
}

interface SearchEntry {
  readonly record: BodyRecord;
  readonly nameLower: string;
}

/**
 * Merge a HYG StarDataSource with one or more systems packs into a single body namespace.
 *
 * Host deduplication rule: a system's host resolves to an HYG star when
 * stars.search(host.name) contains a star whose name equals the host's name
 * case-insensitively. Resolved hosts use the HYG record and position; unresolved
 * hosts appear in extraHostBatch with origin [0,0,0].
 */
export function createCombinedSource(
  stars: StarDataSource,
  systems: readonly SystemsSource[],
): CombinedSource {
  // ── Phase 1: host deduplication ──────────────────────────────────────────
  const hostBySystemId = new Map<BodyId, HostEntry>();
  // pack host id → canonical HYG id (only for deduped hosts)
  const dedupMap = new Map<BodyId, BodyId>();

  for (const source of systems) {
    for (const system of source.systems) {
      const host = system.star;
      let hygId: BodyId | undefined;
      let positionPc: readonly [number, number, number] = host.positionPc;

      if (host.name !== undefined) {
        const candidates = stars.search(host.name, 10);
        const match = candidates.find(
          s => s.name !== undefined && s.name.toLowerCase() === host.name!.toLowerCase(),
        );
        if (match !== undefined) {
          hygId = match.id;
          positionPc = match.positionPc;
          dedupMap.set(host.id, hygId);
        }
      }

      hostBySystemId.set(system.id, {
        systemId: system.id,
        packRecord: host,
        hygId,
        positionPc,
      });
    }
  }

  // ── Phase 2: extraHostBatch for unresolved hosts ─────────────────────────
  const unresolvedHosts: HostEntry[] = [];
  for (const entry of hostBySystemId.values()) {
    if (entry.hygId === undefined) unresolvedHosts.push(entry);
  }

  const hostIdByIndex: BodyId[] = unresolvedHosts.map(e => e.packRecord.id);
  const hostIndexByPackId = new Map<BodyId, number>();
  for (let i = 0; i < hostIdByIndex.length; i++) {
    hostIndexByPackId.set(hostIdByIndex[i]!, i);
  }

  let extraHostBatch: StarBatch | null = null;
  if (unresolvedHosts.length > 0) {
    const count = unresolvedHosts.length;
    const positionsPc = new Float32Array(count * 3);
    const absMag = new Float32Array(count);
    const colorIndexBV = new Float32Array(count);
    const catalogIds = new Uint32Array(count);
    const hipIds = new Uint32Array(count);

    for (let i = 0; i < count; i++) {
      const entry = unresolvedHosts[i]!;
      const [x, y, z] = entry.positionPc;
      positionsPc[i * 3] = x;
      positionsPc[i * 3 + 1] = y;
      positionsPc[i * 3 + 2] = z;
      absMag[i] = entry.packRecord.absMag;
      colorIndexBV[i] = entry.packRecord.colorIndexBV;
      catalogIds[i] = i;
      // hipIds[i] = 0 (default)
    }

    extraHostBatch = {
      count,
      originPc: [0, 0, 0],
      positionsPc,
      absMag,
      colorIndexBV,
      catalogIds,
      hipIds,
      idPrefix: 'exoidx',
    };
  }

  // ── Phase 3: combined search index ───────────────────────────────────────
  // Named HYG stars
  const searchEntries: SearchEntry[] = [];
  for (let i = 0; i < stars.batch.count; i++) {
    const record = stars.getByIndex(i);
    if (record.name !== undefined) {
      searchEntries.push({ record, nameLower: record.name.toLowerCase() });
    }
  }
  // Unresolved host stars (pack records)
  for (const entry of unresolvedHosts) {
    if (entry.packRecord.name !== undefined) {
      searchEntries.push({
        record: entry.packRecord,
        nameLower: entry.packRecord.name.toLowerCase(),
      });
    }
  }
  // Planets from all systems
  for (const source of systems) {
    for (const system of source.systems) {
      for (const body of system.bodies) {
        if (body.name !== undefined) {
          searchEntries.push({ record: body, nameLower: body.name.toLowerCase() });
        }
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function canonicalId(id: BodyId): BodyId {
    if (id.startsWith('exoidx:')) {
      const idx = Number(id.slice('exoidx:'.length));
      const packHostId = hostIdByIndex[idx];
      if (packHostId === undefined) return id;
      return dedupMap.get(packHostId) ?? packHostId;
    }
    return dedupMap.get(id) ?? id;
  }

  function getBody(id: BodyId): BodyRecord | undefined {
    const canonical = canonicalId(id);
    const hygRecord = stars.getBody(canonical);
    if (hygRecord !== null) return hygRecord;
    for (const source of systems) {
      const body = source.getBody(canonical);
      if (body !== undefined) return body;
    }
    return undefined;
  }

  function search(query: string, max = 10): BodyRecord[] {
    const q = query.trim().toLowerCase();
    if (q === '') return [];

    const exactStars: StarRecord[] = [];
    const exactPlanets: PlanetRecord[] = [];
    const prefixStars: StarRecord[] = [];
    const prefixPlanets: PlanetRecord[] = [];
    const subStars: StarRecord[] = [];
    const subPlanets: PlanetRecord[] = [];

    for (const { record, nameLower } of searchEntries) {
      if (!nameLower.includes(q)) continue;
      const isExact = nameLower === q;
      const isPrefix = !isExact && nameLower.startsWith(q);

      if (record.kind === 'star') {
        if (isExact) exactStars.push(record);
        else if (isPrefix) prefixStars.push(record);
        else subStars.push(record);
      } else if (record.kind === 'planet') {
        if (isExact) exactPlanets.push(record);
        else if (isPrefix) prefixPlanets.push(record);
        else subPlanets.push(record);
      }
    }

    const byAbsMag = (a: StarRecord, b: StarRecord) => a.absMag - b.absMag;
    const byName = (a: PlanetRecord, b: PlanetRecord) =>
      (a.name ?? '').localeCompare(b.name ?? '');

    exactStars.sort(byAbsMag);
    exactPlanets.sort(byName);
    prefixStars.sort(byAbsMag);
    prefixPlanets.sort(byName);
    subStars.sort(byAbsMag);
    subPlanets.sort(byName);

    const out: BodyRecord[] = [];
    const push = (arr: BodyRecord[]) => {
      for (const r of arr) {
        if (out.length >= max) return;
        out.push(r);
      }
    };

    // Within each priority group: stars first (by absMag), then planets (alpha)
    push(exactStars);
    push(exactPlanets);
    push(prefixStars);
    push(prefixPlanets);
    push(subStars);
    push(subPlanets);

    return out;
  }

  function nearestHostSystem(xPc: number, yPc: number, zPc: number): NearestHostHit | null {
    if (hostBySystemId.size === 0) return null;
    let bestSystemId: BodyId | undefined;
    let bestDist2 = Infinity;

    for (const entry of hostBySystemId.values()) {
      const [hx, hy, hz] = entry.positionPc;
      const d2 = (xPc - hx) ** 2 + (yPc - hy) ** 2 + (zPc - hz) ** 2;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestSystemId = entry.systemId;
      }
    }

    if (bestSystemId === undefined) return null;
    return { systemId: bestSystemId, distancePc: Math.sqrt(bestDist2) };
  }

  function hostPositionPc(systemId: BodyId): readonly [number, number, number] | undefined {
    return hostBySystemId.get(systemId)?.positionPc;
  }

  return {
    getBody,
    search,
    extraHostBatch,
    hostIdByIndex,
    canonicalId,
    nearestHostSystem,
    hostPositionPc,
  };
}
