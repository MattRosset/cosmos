import type { StarBatch } from './batches';
import type { AppError } from './errors';

export type ChunkKind = 'octree' | 'procgen';
export type ChunkLifecyclePhase = 'request' | 'ready' | 'evict' | 'error';

/** §5.8: the streamer's output event. `request` carries no buffers; `ready`
 *  carries the decoded StarBatch; `evict` carries neither; `error` carries an
 *  AppError describing the load/decode failure (a cancel/abort is NOT an error
 *  and never emits this phase — see TASK-057). */
export interface ChunkLifecycleEvent {
  readonly phase: ChunkLifecyclePhase;
  readonly kind: ChunkKind;
  /** Stable id: octree ⇒ the MortonKey; procgen ⇒ `gal<seed>:sec<sectorId>`. */
  readonly chunkId: string;
  /** Discrete LOD level (octree: node level; procgen: requested LOD). */
  readonly lod: number;
  /** Present only on `phase: 'ready'`; null otherwise. */
  readonly batch: StarBatch | null;
  /** Present only on `phase: 'error'`; null/absent otherwise. The reason the
   *  chunk failed to load/decode. Optional so this thaw stays self-contained;
   *  TASK-057 tightens the streamer's emit path. */
  readonly error?: AppError | null;
}
