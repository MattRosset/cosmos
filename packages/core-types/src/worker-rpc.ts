import type { GalaxyGenParams } from './procgen';
import type { OctreeTileManifest } from './octree';

/** §5.13 worker request envelope. `id` correlates request↔response; `token`
 *  is the cancellation token id (see cancel). */
export interface WorkerRequest<TMethod extends string, TParams> {
  readonly id: number;
  readonly method: TMethod;
  readonly params: TParams;
  readonly token: number;
}

export type WorkerResponse<TResult> =
  | { readonly id: number; readonly ok: true; readonly result: TResult }
  | { readonly id: number; readonly ok: false; readonly error: WorkerErrorPayload }
  | { readonly id: number; readonly cancelled: true };

/** §5.13 structured error propagation (no raw Error objects cross the boundary). */
export interface WorkerErrorPayload {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

/** The two Phase-3 worker methods (the contract `workers` + `procgen`/`data` share). */
export interface ProcgenGalaxyRequest {
  readonly params: GalaxyGenParams;
}

/** Decode one octree tile .bin (already fetched) into a StarBatch. */
export interface OctreeDecodeRequest {
  readonly tile: OctreeTileManifest;
  readonly idPrefix: string;
  /** The fetched tile .bin as a transferable ArrayBuffer. */
  readonly bin: ArrayBuffer;
}
