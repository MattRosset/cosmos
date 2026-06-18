/**
 * Streaming wiring (TASK-040, §5.8): one module-scoped worker pool + the streaming
 * policy, configured with the procedural Milky Way. The §5.13 Vite
 * `new Worker(new URL(...))` syntax lives ONLY here (and points at the single
 * unified worker entry). No rendering happens here — GalaxyScene mounts the ready
 * batches and runs `streaming.update()` each frame.
 */
import { createWorkerPool, defaultPoolSize, type WorkerPool } from '@cosmos/workers';
import { createStreamingPolicy, type StreamingPolicy } from '@cosmos/streaming';
import type { OctreeSource } from '@cosmos/data';
import type { OriginManager } from '@cosmos/coords';
import type { GalaxyRecord } from '@cosmos/core-types';
import { MILKY_WAY_ID } from './local-group';
import { milkyWayGenParams } from './milky-way-gen';

let _pool: WorkerPool | null = null;

/**
 * The single module-scoped worker pool (§5.13). Lazily created and shared by both
 * the octree decode path (`loadOctreePack({ pool })`) and the streaming policy's
 * procgen dispatches — every pooled worker serves both methods via cosmos.worker.ts.
 * A module singleton so it survives StrictMode remounts (no double-spawn).
 */
export function getCosmosPool(): WorkerPool {
  if (_pool === null) {
    _pool = createWorkerPool({
      size: defaultPoolSize(),
      spawn: () =>
        new Worker(new URL('../workers/cosmos.worker.ts', import.meta.url), {
          type: 'module',
        }),
    });
  }
  return _pool;
}

/** Build the streaming policy for a loaded octree + the procedural Milky Way. */
export function createMilkyWayStreaming(opts: {
  readonly origin: OriginManager;
  readonly octree: OctreeSource;
  readonly milkyWay: GalaxyRecord;
}): StreamingPolicy {
  return createStreamingPolicy({
    origin: opts.origin,
    pool: getCosmosPool(),
    octree: opts.octree,
    procgenGalaxies: new Map([[MILKY_WAY_ID, milkyWayGenParams(opts.milkyWay.seed)]]),
  });
}
