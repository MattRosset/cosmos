/**
 * The §5.8 policy brain. Each frame, on the MAIN THREAD, it computes the visible
 * cut by screen-space error, issues a bounded number of fetch/generate requests,
 * cancels stale in-flight ones, advances cross-fades, enforces §9 budgets with
 * graceful degradation, and maintains the nearest-loaded-body distance `nav` reads.
 * It does NOT render and does NOT generate — it orchestrates and hands ready
 * `StarBatch`es to consumers through a typed lifecycle registry.
 *
 * ## Allocation doctrine (like coords' RebaseEvent)
 * The steady-state `update()` path (unchanging cut, everything loaded) allocates
 * nothing: all per-frame scratch is module/closure-scoped and reused. The sanctioned
 * rare allocations are: a `ChunkLifecycleEvent` object per request/ready/evict, the
 * `AbortController`/`CancelToken` per dispatch, the Morton parent-key strings walked
 * only while a cut is still loading, and the victim array when an over-budget frame
 * runs LRU eviction. None of these occur on a settled cut.
 */
import type {
  ChunkLifecycleEvent,
  ChunkKind,
  ContextId,
  GalaxyGenParams,
  MortonKey,
  QualityTier,
  StarBatch,
} from '@cosmos/core-types';
import {
  CONTEXT_UNIT_METERS,
  PROCGEN_GALAXY_DEFAULTS,
  decodeMortonKey,
  encodeMortonKey,
  parentCell,
} from '@cosmos/core-types';
import type { OriginManager, Vec3Tuple } from '@cosmos/coords';
import type { OctreeSource, OctreeNode } from '@cosmos/data';
import type { WorkerPool, CancelToken } from '@cosmos/workers';
import { createCancelToken } from '@cosmos/workers';

import {
  STREAM_TAN_HALF_FOV,
  DEFAULT_SSE_THRESHOLD_PX,
  projectedPixelExtent,
  screenSpaceError,
} from './sse.js';
import {
  resolveBudgets,
  effectiveMaxPoints,
  estimateGpuBytes,
  type StreamBudgets,
} from './budgets.js';
import { advanceFade, DEFAULT_CROSS_FADE_MS, DEFAULT_LOD_HYSTERESIS } from './crossfade.js';
import { LruClock, selectLruVictims } from './lru.js';

export interface StreamingPolicyOptions {
  readonly origin: OriginManager;
  readonly pool: WorkerPool;
  readonly octree: OctreeSource;
  readonly procgenGalaxies?: ReadonlyMap<string, GalaxyGenParams>;
  readonly budgets?: Partial<StreamBudgets>;
  readonly initialTier?: QualityTier;
  readonly lodHysteresis?: number;
  readonly crossFadeMs?: number;
}

export interface VisibleChunk {
  readonly chunkId: string;
  readonly kind: ChunkKind;
  readonly lod: number;
  readonly opacity: number;
}

export interface StreamingStats {
  readonly inFlight: number;
  readonly loadedChunks: number;
  readonly renderedPoints: number;
  readonly drawCalls: number;
  readonly gpuBytesEstimate: number;
  readonly requestsThisFrame: number;
  readonly cancelledThisFrame: number;
}

export interface StreamingPolicy {
  update(viewportHeightPx: number, dtMs: number): void;
  readonly visible: readonly VisibleChunk[];
  readonly nearestBodyDistanceM: number;
  onChunk(cb: (e: ChunkLifecycleEvent) => void): () => void;
  setQualityTier(tier: QualityTier): void;
  readonly stats: StreamingStats;
  dispose(): void;
}

type ChunkStatus = 'pending' | 'inflight' | 'ready' | 'dead';

interface Chunk {
  readonly id: string;
  readonly kind: ChunkKind;
  readonly context: ContextId;
  readonly center: readonly [number, number, number];
  readonly halfExtentUnits: number;
  /** Representative point count at this LOD (octree tile pointCount / procgen starCount). */
  readonly pointCount: number;
  /** Octree node level, or procgen requested LOD. */
  level: number;
  readonly node: OctreeNode | null;
  readonly galaxyParams: GalaxyGenParams | null;

  status: ChunkStatus;
  batch: StarBatch | null;
  gpuBytes: number;
  opacity: number;
  desiredEpoch: number;
  coverageEpoch: number;
  accessTick: number;
  /** Camera→center distance in the current render context's units, refreshed on visit. */
  distUnits: number;
  /** Node half-extent expressed in current-context units, refreshed on visit. */
  extentCurrent: number;
  abort: AbortController | null;
  token: CancelToken | null;
  /** Reused output object handed out through `visible`. */
  readonly view: { chunkId: string; kind: ChunkKind; lod: number; opacity: number };
}

export function createStreamingPolicy(opts: StreamingPolicyOptions): StreamingPolicy {
  const { origin, pool, octree } = opts;
  const budgets = resolveBudgets(opts.budgets);
  const hysteresis = opts.lodHysteresis ?? DEFAULT_LOD_HYSTERESIS;
  const crossFadeMs = opts.crossFadeMs ?? DEFAULT_CROSS_FADE_MS;
  const procgenGalaxies = opts.procgenGalaxies ?? new Map<string, GalaxyGenParams>();

  let tier: QualityTier = opts.initialTier ?? 'high';
  let disposed = false;

  const chunks = new Map<string, Chunk>();
  const chunkList: Chunk[] = [];
  const descendState = new Map<MortonKey, boolean>();
  const listeners: Array<(e: ChunkLifecycleEvent) => void> = [];
  const clock = new LruClock();

  let frame = 0;
  let _inFlight = 0;
  let requestsThisFrame = 0;
  let cancelledThisFrame = 0;
  let nearestBodyDistanceM = Infinity;

  // ---- per-frame scratch (reused; never reallocated on the steady-state path) ----
  const visible: VisibleChunk[] = [];
  const targetList: Chunk[] = [];
  const coverageList: Chunk[] = [];
  const pendingScratch: Chunk[] = [];
  const stack: OctreeNode[] = [];
  const camRel: Vec3Tuple = [0, 0, 0];
  const posScratch: { context: ContextId; local: [number, number, number] } = {
    context: 'galaxy',
    local: [0, 0, 0],
  };
  // The event object handed to listeners is mutated in place; listeners must not retain it.
  const eventScratch: { phase: ChunkLifecycleEvent['phase']; kind: ChunkKind; chunkId: string; lod: number; batch: StarBatch | null } =
    { phase: 'request', kind: 'octree', chunkId: '', lod: 0, batch: null };

  const stats: StreamingStats = {
    get inFlight() { return _inFlight; },
    get loadedChunks() { return countReady(); },
    get renderedPoints() { return _renderedPoints; },
    get drawCalls() { return _drawCalls; },
    get gpuBytesEstimate() { return _gpuBytes; },
    get requestsThisFrame() { return requestsThisFrame; },
    get cancelledThisFrame() { return cancelledThisFrame; },
  };
  let _renderedPoints = 0;
  let _drawCalls = 0;
  let _gpuBytes = 0;

  let ctxMeters = CONTEXT_UNIT_METERS[origin.context];

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------
  function emit(phase: ChunkLifecycleEvent['phase'], c: Chunk): void {
    if (listeners.length === 0) return;
    eventScratch.phase = phase;
    eventScratch.kind = c.kind;
    eventScratch.chunkId = c.id;
    eventScratch.lod = c.level;
    eventScratch.batch = phase === 'ready' ? c.batch : null;
    for (let i = 0; i < listeners.length; i++) listeners[i]!(eventScratch as ChunkLifecycleEvent);
  }

  function parentKey(key: MortonKey): MortonKey | null {
    const cell = decodeMortonKey(key);
    if (cell.level === 0) return null;
    return encodeMortonKey(parentCell(cell));
  }

  /** Measure a chunk against the camera; writes distUnits + extentCurrent onto it. */
  function measure(c: Chunk): void {
    posScratch.context = c.context;
    posScratch.local[0] = c.center[0];
    posScratch.local[1] = c.center[1];
    posScratch.local[2] = c.center[2];
    origin.toRenderSpace(posScratch, camRel);
    c.distUnits = Math.hypot(camRel[0], camRel[1], camRel[2]);
    c.extentCurrent = c.halfExtentUnits * (CONTEXT_UNIT_METERS[c.context] / ctxMeters);
  }

  /** True when the camera is inside this octree node's cube (recomputed fresh). */
  function cameraInside(c: Chunk): boolean {
    if (c.kind !== 'octree') return false;
    posScratch.context = c.context;
    posScratch.local[0] = c.center[0];
    posScratch.local[1] = c.center[1];
    posScratch.local[2] = c.center[2];
    origin.toRenderSpace(posScratch, camRel);
    const e = c.halfExtentUnits * (CONTEXT_UNIT_METERS[c.context] / ctxMeters);
    return Math.abs(camRel[0]) <= e && Math.abs(camRel[1]) <= e && Math.abs(camRel[2]) <= e;
  }

  function ensureOctreeChunk(node: OctreeNode): Chunk {
    let c = chunks.get(node.key);
    if (c) return c;
    const cell = decodeMortonKey(node.key);
    c = {
      id: node.key,
      kind: 'octree',
      context: octree.context,
      center: node.manifest.centerUnits,
      halfExtentUnits: node.manifest.halfExtentUnits,
      pointCount: node.manifest.pointCount,
      level: cell.level,
      node,
      galaxyParams: null,
      status: 'pending',
      batch: null,
      gpuBytes: 0,
      opacity: 0,
      desiredEpoch: 0,
      coverageEpoch: 0,
      accessTick: 0,
      distUnits: Infinity,
      extentCurrent: 0,
      abort: null,
      token: null,
      view: { chunkId: node.key, kind: 'octree', lod: cell.level, opacity: 0 },
    };
    chunks.set(c.id, c);
    chunkList.push(c);
    return c;
  }

  function ensureProcgenChunk(galaxyId: string, params: GalaxyGenParams): Chunk {
    const id = `gal${params.seed}:sec0`;
    let c = chunks.get(id);
    if (c) return c;
    const radius = params.discRadiusPc ?? PROCGEN_GALAXY_DEFAULTS.discRadiusPc;
    c = {
      id,
      kind: 'procgen',
      context: 'galaxy',
      center: [0, 0, 0],
      halfExtentUnits: radius,
      pointCount: params.starCount,
      level: 0,
      node: null,
      galaxyParams: params,
      status: 'pending',
      batch: null,
      gpuBytes: 0,
      opacity: 0,
      desiredEpoch: 0,
      coverageEpoch: 0,
      accessTick: 0,
      distUnits: Infinity,
      extentCurrent: 0,
      abort: null,
      token: null,
      view: { chunkId: id, kind: 'procgen', lod: 0, opacity: 0 },
    };
    void galaxyId;
    chunks.set(c.id, c);
    chunkList.push(c);
    return c;
  }

  function removeChunk(c: Chunk): void {
    c.status = 'dead';
    c.batch = null;
    chunks.delete(c.id);
    const i = chunkList.indexOf(c);
    if (i >= 0) {
      const last = chunkList.pop()!;
      if (last !== c) chunkList[i] = last;
    }
  }

  function dispatchChunk(c: Chunk): void {
    c.status = 'inflight';
    c.opacity = 0;
    _inFlight++;
    requestsThisFrame++;
    emit('request', c);

    if (c.kind === 'octree') {
      const ac = new AbortController();
      c.abort = ac;
      octree
        .loadTile(c.node!.key, { signal: ac.signal })
        .then((batch) => onReady(c, batch))
        .catch(() => onError(c));
    } else {
      const token = createCancelToken();
      c.token = token;
      pool
        .dispatch('procgen.galaxy', { params: c.galaxyParams! }, { token })
        .then((batch) => onReady(c, batch))
        .catch(() => onError(c));
    }
  }

  function onReady(c: Chunk, batch: StarBatch): void {
    if (c.status !== 'inflight') return;
    c.status = 'ready';
    c.batch = batch;
    c.gpuBytes = estimateGpuBytes(batch);
    c.abort = null;
    c.token = null;
    _inFlight--;
    emit('ready', c);
  }

  function onError(c: Chunk): void {
    if (c.status !== 'inflight') return;
    _inFlight--;
    c.abort = null;
    c.token = null;
    removeChunk(c);
  }

  function cancelChunk(c: Chunk): void {
    if (c.status === 'inflight') {
      _inFlight--;
      cancelledThisFrame++;
      c.abort?.abort();
      c.token?.cancel();
    }
    removeChunk(c);
  }

  /** Graceful eviction (faded out) or hard LRU eviction: emit evict + free. */
  function evictChunk(c: Chunk): void {
    emit('evict', c);
    removeChunk(c);
  }

  // ---------------------------------------------------------------------------
  // selection — screen-space-error descent (main thread, §5.8)
  // ---------------------------------------------------------------------------
  function selectOctree(viewportHeightPx: number): void {
    const threshold = DEFAULT_SSE_THRESHOLD_PX;
    stack.length = 0;
    stack.push(octree.root);
    while (stack.length > 0) {
      const node = stack.pop()!;
      const c = ensureOctreeChunk(node);
      c.desiredEpoch = frame;
      measure(c);

      const pixelExtent = projectedPixelExtent(
        c.extentCurrent,
        Math.max(c.distUnits, 1e-9),
        viewportHeightPx,
        STREAM_TAN_HALF_FOV,
      );
      const sse = screenSpaceError(pixelExtent, c.pointCount);

      const hasChildren = node.childKeys.length > 0;
      const prev = descendState.get(node.key) ?? false;
      let descend: boolean;
      if (!hasChildren) {
        descend = false; // terminal LOD
      } else if (prev) {
        // currently descended — only ascend when SSE drops 15% below threshold
        descend = sse >= threshold * (1 - hysteresis);
      } else {
        // currently stopped here — only descend when SSE rises 15% above threshold
        descend = sse > threshold * (1 + hysteresis);
      }
      descendState.set(node.key, descend);

      if (descend) {
        for (let i = 0; i < node.childKeys.length; i++) {
          const child = octree.getNode(node.childKeys[i]!);
          if (child) stack.push(child);
        }
      } else {
        targetList.push(c); // chosen cut node
      }
    }
  }

  function selectProcgen(viewportHeightPx: number): void {
    for (const [galaxyId, params] of procgenGalaxies) {
      const c = ensureProcgenChunk(galaxyId, params);
      c.desiredEpoch = frame;
      measure(c);
      // Discrete LOD: coarser (higher) as the galaxy projects smaller on screen.
      const pixelExtent = projectedPixelExtent(
        c.extentCurrent,
        Math.max(c.distUnits, 1e-9),
        viewportHeightPx,
        STREAM_TAN_HALF_FOV,
      );
      const lod = pixelExtent <= 0 ? 8 : Math.max(0, Math.min(8, Math.floor(Math.log2(Math.max(1, 1024 / pixelExtent)))));
      c.level = lod;
      c.view.lod = lod;
      targetList.push(c);
    }
  }

  // ---------------------------------------------------------------------------
  // coverage — deepest ready ancestor per target (§ADR-003: coarse before children)
  // ---------------------------------------------------------------------------
  function addCoverage(c: Chunk): void {
    if (c.coverageEpoch === frame) return;
    c.coverageEpoch = frame;
    c.accessTick = clock.next();
    coverageList.push(c);
  }

  function buildCoverage(): void {
    for (let i = 0; i < targetList.length; i++) {
      const target = targetList[i]!;
      if (target.status === 'ready') {
        addCoverage(target);
        continue;
      }
      if (target.kind !== 'octree') continue; // procgen has no coarser ancestor
      let key: MortonKey | null = parentKey(target.id);
      while (key) {
        const anc = chunks.get(key);
        if (anc && anc.status === 'ready') {
          addCoverage(anc);
          break;
        }
        key = parentKey(key);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // budget degradation — drop LOD (collapse to coarser parents) before frames (§9)
  // ---------------------------------------------------------------------------
  function sumCoveragePoints(): number {
    let s = 0;
    for (let i = 0; i < coverageList.length; i++) s += coverageList[i]!.pointCount;
    return s;
  }

  function enforceBudgets(): void {
    const cap = effectiveMaxPoints(budgets, tier);
    let guard = 0;
    while (guard++ < 100000) {
      const pts = sumCoveragePoints();
      const over = pts > cap || coverageList.length > budgets.maxDrawCalls;
      if (!over) break;

      // Collapse the deepest octree coverage node with a ready parent into that parent.
      let bestIdx = -1;
      let bestLevel = -1;
      for (let i = 0; i < coverageList.length; i++) {
        const c = coverageList[i]!;
        if (c.kind !== 'octree' || c.level === 0) continue;
        const pk = parentKey(c.id);
        if (!pk) continue;
        const parent = chunks.get(pk);
        if (!parent || parent.status !== 'ready') continue;
        if (c.level > bestLevel) {
          bestLevel = c.level;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) break; // nothing collapsible — accept the overage

      const child = coverageList[bestIdx]!;
      const parent = chunks.get(parentKey(child.id)!)!;
      child.coverageEpoch = 0;
      const last = coverageList.pop()!;
      if (last !== child) coverageList[bestIdx] = last;
      addCoverage(parent);
    }
  }

  // ---------------------------------------------------------------------------
  // per-frame update
  // ---------------------------------------------------------------------------
  function update(viewportHeightPx: number, dtMs: number): void {
    if (disposed) return;
    frame++;
    requestsThisFrame = 0;
    cancelledThisFrame = 0;
    ctxMeters = CONTEXT_UNIT_METERS[origin.context];

    targetList.length = 0;
    coverageList.length = 0;

    // 1) selection (main-thread visibility)
    selectOctree(viewportHeightPx);
    selectProcgen(viewportHeightPx);

    // 2) cancel stale in-flight + drop stale pending (camera moved them out of the cut)
    for (let i = chunkList.length - 1; i >= 0; i--) {
      const c = chunkList[i]!;
      if (c.desiredEpoch === frame) continue;
      if (c.status === 'inflight') cancelChunk(c);
      else if (c.status === 'pending') removeChunk(c);
      // ready-but-stale chunks fade out below, then evict at opacity 0
    }

    // 3) issue requests — bounded by the in-flight cap, coarse-then-near first (§5.8)
    pendingScratch.length = 0;
    for (let i = 0; i < chunkList.length; i++) {
      const c = chunkList[i]!;
      if (c.status === 'pending' && c.desiredEpoch === frame) pendingScratch.push(c);
    }
    if (pendingScratch.length > 0) {
      pendingScratch.sort((a, b) => (a.level - b.level) || (a.distUnits - b.distUnits));
      for (let i = 0; i < pendingScratch.length && _inFlight < budgets.maxInFlight; i++) {
        dispatchChunk(pendingScratch[i]!);
      }
    }

    // 4) coverage + budget degradation
    buildCoverage();
    enforceBudgets();

    // 5) LRU eviction once GPU memory exceeds budget (pin cut / coverage / camera node)
    let totalGpu = 0;
    for (let i = 0; i < chunkList.length; i++) {
      if (chunkList[i]!.status === 'ready') totalGpu += chunkList[i]!.gpuBytes;
    }
    if (totalGpu > budgets.maxGpuBytes) {
      const ready: Chunk[] = [];
      for (let i = 0; i < chunkList.length; i++) {
        if (chunkList[i]!.status === 'ready') ready.push(chunkList[i]!);
      }
      const victims = selectLruVictims(ready, {
        bytesOf: (c) => c.gpuBytes,
        tickOf: (c) => c.accessTick,
        pinned: (c) =>
          c.desiredEpoch === frame || c.coverageEpoch === frame || cameraInside(c),
        currentBytes: totalGpu,
        maxBytes: budgets.maxGpuBytes,
      });
      for (let i = 0; i < victims.length; i++) evictChunk(victims[i]!);
    }

    // 6) advance cross-fades; gracefully evict faded-out, no-longer-covered chunks
    for (let i = chunkList.length - 1; i >= 0; i--) {
      const c = chunkList[i]!;
      const target: 0 | 1 = c.coverageEpoch === frame ? 1 : 0;
      c.opacity = advanceFade(c.opacity, target, dtMs, crossFadeMs);
      // A chunk still on the cut (desired this frame) is kept resident even at
      // opacity 0 (a coarse ancestor held for coverage fallback while children
      // load). Only chunks that have left the cut entirely fade out and evict.
      if (c.status === 'ready' && c.desiredEpoch !== frame && c.opacity === 0) {
        evictChunk(c);
      }
    }

    // 7) build the visible cut (every ready chunk still on screen) + stats + nearest
    visible.length = 0;
    _renderedPoints = 0;
    _gpuBytes = 0;
    nearestBodyDistanceM = Infinity;
    for (let i = 0; i < chunkList.length; i++) {
      const c = chunkList[i]!;
      if (c.status === 'ready') _gpuBytes += c.gpuBytes;
      if (c.status !== 'ready' || c.opacity <= 0) continue;
      c.view.chunkId = c.id;
      c.view.kind = c.kind;
      c.view.lod = c.level;
      c.view.opacity = c.opacity;
      visible.push(c.view);
      _renderedPoints += c.pointCount;
      if (c.coverageEpoch === frame) {
        const distM = Math.max(0, c.distUnits - c.extentCurrent) * ctxMeters;
        if (distM < nearestBodyDistanceM) nearestBodyDistanceM = distM;
      }
    }
    _drawCalls = visible.length;
  }

  function countReady(): number {
    let n = 0;
    for (let i = 0; i < chunkList.length; i++) if (chunkList[i]!.status === 'ready') n++;
    return n;
  }

  return {
    update,
    get visible() { return visible; },
    get nearestBodyDistanceM() { return nearestBodyDistanceM; },
    onChunk(cb) {
      listeners.push(cb);
      // Replay ready chunks subscribed after warm-up (StrictMode / late mount).
      for (let i = 0; i < chunkList.length; i++) {
        const c = chunkList[i]!;
        if (c.status === 'ready' && c.batch !== null) emit('ready', c);
      }
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    setQualityTier(t) { tier = t; },
    stats,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (let i = chunkList.length - 1; i >= 0; i--) {
        const c = chunkList[i]!;
        if (c.status === 'inflight') {
          c.abort?.abort();
          c.token?.cancel();
        }
      }
      chunkList.length = 0;
      chunks.clear();
      descendState.clear();
      listeners.length = 0;
      _inFlight = 0;
    },
  };
}
