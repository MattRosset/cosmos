import type { BodyId, StarBatch, StarRecord } from '@cosmos/core-types';
import {
  buildGrid,
  nearestStarIndex as gridNearest,
  queryRegion as gridQuery,
  type SpatialGrid,
} from './grid.js';

export type Vec3Pc = readonly [number, number, number];

export interface StarDataSource {
  readonly batch: StarBatch;
  getBody(id: BodyId): StarRecord | null;
  getByIndex(index: number): StarRecord;
  search(query: string, maxResults?: number): readonly StarRecord[];
  queryRegion(minPc: Vec3Pc, maxPc: Vec3Pc, maxCount: number): Uint32Array;
  nearestStarIndex(xPc: number, yPc: number, zPc: number): number;
  /** Batch index for a Hipparcos number, or undefined when not present (TASK-046). */
  hipIndex(hip: number): number | undefined;
  /** Absolute galaxy-frame position (parsecs) for a batch index (TASK-046). */
  positionPcByIndex(index: number): Vec3Pc;
}

interface NameSearchRow {
  readonly idx: number;
  readonly lower: string;
}

export class StarDataSourceImpl implements StarDataSource {
  readonly batch: StarBatch;
  private readonly _names: Map<number, string>; // catalogId → display name
  private readonly _idIndex: Map<number, number>; // catalogId → batch index
  private readonly _nameSearchRows: readonly NameSearchRow[];
  private readonly _grid: SpatialGrid;
  private readonly _hipIndex: Map<number, number>;

  constructor(batch: StarBatch, names: Record<string, string>) {
    this.batch = batch;

    this._idIndex = new Map();
    this._hipIndex = new Map();
    for (let i = 0; i < batch.count; i++) {
      this._idIndex.set(batch.catalogIds[i]!, i);
      const hip = batch.hipIds[i]!;
      if (hip !== 0) this._hipIndex.set(hip, i);
    }

    this._names = new Map();
    const nameSearchRows: NameSearchRow[] = [];
    for (const [k, v] of Object.entries(names)) {
      const catalogId = Number(k);
      this._names.set(catalogId, v);
      const idx = this._idIndex.get(catalogId);
      if (idx !== undefined) {
        nameSearchRows.push({ idx, lower: v.toLowerCase() });
      }
    }
    this._nameSearchRows = nameSearchRows;

    this._grid = buildGrid(batch.positionsPc, batch.count);
  }

  getBody(id: BodyId): StarRecord | null {
    const colon = id.indexOf(':');
    if (colon < 0) return null;
    if (id.slice(0, colon) !== this.batch.idPrefix) return null;
    const catalogId = Number(id.slice(colon + 1));
    const idx = this._idIndex.get(catalogId);
    if (idx === undefined) return null;
    return this.getByIndex(idx);
  }

  getByIndex(index: number): StarRecord {
    const catalogId = this.batch.catalogIds[index]!;
    const [ox, oy, oz] = this.batch.originPc;
    const name = this._names.get(catalogId);
    const base: StarRecord = {
      id: `${this.batch.idPrefix}:${catalogId}`,
      kind: 'star',
      positionPc: [
        ox + this.batch.positionsPc[index * 3]!,
        oy + this.batch.positionsPc[index * 3 + 1]!,
        oz + this.batch.positionsPc[index * 3 + 2]!,
      ],
      absMag: this.batch.absMag[index]!,
      colorIndexBV: this.batch.colorIndexBV[index]!,
    };
    return name !== undefined ? { ...base, name } : base;
  }

  search(query: string, maxResults = 10): readonly StarRecord[] {
    const q = query.trim().toLowerCase();
    if (q === '') return [];

    // HIP resolution: "hip 32349" or "hip32349" (case-insensitive)
    const hipMatch = /^hip\s*(\d+)$/.exec(q);
    if (hipMatch !== null) {
      const hipNum = parseInt(hipMatch[1]!, 10);
      if (hipNum !== 0) {
        for (let i = 0; i < this.batch.count; i++) {
          if (this.batch.hipIds[i] === hipNum) return [this.getByIndex(i)];
        }
      }
      return [];
    }

    const prefixIdx: number[] = [];
    const otherIdx: number[] = [];
    const { absMag } = this.batch;

    for (let i = 0; i < this._nameSearchRows.length; i++) {
      const row = this._nameSearchRows[i]!;
      if (!row.lower.includes(q)) continue;
      if (row.lower.startsWith(q)) {
        prefixIdx.push(row.idx);
      } else {
        otherIdx.push(row.idx);
      }
    }

    // Prefix matches first, then other substring matches; within each group sort by absMag ascending (brightest first)
    prefixIdx.sort((a, b) => absMag[a]! - absMag[b]!);
    otherIdx.sort((a, b) => absMag[a]! - absMag[b]!);

    const out: StarRecord[] = [];
    for (let i = 0; i < prefixIdx.length && out.length < maxResults; i++) {
      out.push(this.getByIndex(prefixIdx[i]!));
    }
    for (let i = 0; i < otherIdx.length && out.length < maxResults; i++) {
      out.push(this.getByIndex(otherIdx[i]!));
    }
    return out;
  }

  queryRegion(minPc: Vec3Pc, maxPc: Vec3Pc, maxCount: number): Uint32Array {
    return gridQuery(this._grid, this.batch.positionsPc, this.batch.originPc, minPc, maxPc, maxCount);
  }

  nearestStarIndex(xPc: number, yPc: number, zPc: number): number {
    const [ox, oy, oz] = this.batch.originPc;
    return gridNearest(
      this._grid,
      this.batch.positionsPc,
      this.batch.count,
      xPc - ox,
      yPc - oy,
      zPc - oz,
    );
  }

  hipIndex(hip: number): number | undefined {
    return this._hipIndex.get(hip);
  }

  positionPcByIndex(index: number): Vec3Pc {
    const [ox, oy, oz] = this.batch.originPc;
    return [
      ox + this.batch.positionsPc[index * 3]!,
      oy + this.batch.positionsPc[index * 3 + 1]!,
      oz + this.batch.positionsPc[index * 3 + 2]!,
    ];
  }
}
