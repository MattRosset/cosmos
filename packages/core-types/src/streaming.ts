import type { StarBatch } from './batches';

export type ChunkKind = 'octree' | 'procgen';
export type ChunkLifecyclePhase = 'request' | 'ready' | 'evict';

/** §5.8: the streamer's output event. `request` carries no buffers; `ready`
 *  carries the decoded StarBatch; `evict` carries neither. */
export interface ChunkLifecycleEvent {
  readonly phase: ChunkLifecyclePhase;
  readonly kind: ChunkKind;
  /** Stable id: octree ⇒ the MortonKey; procgen ⇒ `gal<seed>:sec<sectorId>`. */
  readonly chunkId: string;
  /** Discrete LOD level (octree: node level; procgen: requested LOD). */
  readonly lod: number;
  /** Present only on `phase: 'ready'`; null otherwise. */
  readonly batch: StarBatch | null;
}
