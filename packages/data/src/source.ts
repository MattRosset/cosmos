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
}

export class StarDataSourceImpl implements StarDataSource {
  readonly batch: StarBatch;
  private readonly _names: Map<number, string>; // catalogId → display name
  private readonly _idIndex: Map<number, number>; // catalogId → batch index
  private readonly _grid: SpatialGrid;

  constructor(batch: StarBatch, names: Record<string, string>) {
    this.batch = batch;

    this._idIndex = new Map();
    for (let i = 0; i < batch.count; i++) {
      this._idIndex.set(batch.catalogIds[i]!, i);
    }

    this._names = new Map();
    for (const [k, v] of Object.entries(names)) {
      this._names.set(Number(k), v);
    }

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

    const prefix: StarRecord[] = [];
    const others: StarRecord[] = [];

    for (const [catalogId, name] of this._names) {
      const lower = name.toLowerCase();
      if (!lower.includes(q)) continue;
      const idx = this._idIndex.get(catalogId);
      if (idx === undefined) continue;
      const rec = this.getByIndex(idx);
      if (lower.startsWith(q)) {
        prefix.push(rec);
      } else {
        others.push(rec);
      }
    }

    // Prefix matches first, then other substring matches; within each group sort by absMag ascending (brightest first)
    prefix.sort((a, b) => a.absMag - b.absMag);
    others.sort((a, b) => a.absMag - b.absMag);

    return [...prefix, ...others].slice(0, maxResults);
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
}
