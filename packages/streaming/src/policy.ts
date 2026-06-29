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
  AppError,
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
  toAppError,
} from '@cosmos/core-types';
import type { OriginManager, Vec3Tuple } from '@cosmos/coords';
import type { OctreeSource, OctreeNode } from '@cosmos/data';
import type { WorkerPool, CancelToken } from '@cosmos/workers';
import { createCancelToken } from '@cosmos/workers';
import { reportError } from '@cosmos/diagnostics';

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
  /**
   * The central error sink (TASK-055). Injectable so unit tests don't hit the real
   * sink and so `streaming` need not hard-bind to app state. Called ONLY on a real,
   * non-aborted load failure (rare) — never per frame, never on success/cancel.
   * Defaults to `@cosmos/diagnostics`' `reportError`.
   */
  readonly reportError?: typeof reportError;
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
  /** Monotonic count of REAL load failures (aborts/cancels excluded) since creation. */
  readonly errorCount: number;
  /** Chunks currently in the `failed` terminal state (backed off, not retrying). */
  readonly failedChunks: number;
  /**
   * BUG-10 diagnostics (additive, read-only — no behaviour change). The levers the
   * dense-pack streaming wall is bisected against (see
   * docs/research/bug-10-streaming-density-wall.md):
   *  - `cutSize`        — chosen cut node count this frame (`targetList.length`).
   *  - `pendingCount`   — cut chunks awaiting dispatch (queue depth).
   *  - `trackedChunks`  — total Chunk records resident in the policy (residency).
   *  - `evictionsTotal` — cumulative chunks evicted since creation (LRU + graceful
   *    fade-out). Monotonic so a ≤4 Hz sampler can tell "eviction never fired"
   *    (stays 0 while `loadedChunks` climbs ⇒ Lever 1) from "eviction is keeping up".
   */
  readonly cutSize: number;
  readonly pendingCount: number;
  readonly trackedChunks: number;
  readonly evictionsTotal: number;
}

export interface StreamingPolicy {
  update(viewportHeightPx: number, dtMs: number): void;
  readonly visible: readonly VisibleChunk[];
  readonly nearestBodyDistanceM: number;
  onChunk(cb: (e: ChunkLifecycleEvent) => void): () => void;
  setQualityTier(tier: QualityTier): void;
  readonly stats: StreamingStats;

  /**
   * Catalog coverage of the current visible cut, in [0,1]: the fraction of the
   * chosen cut whose octree tiles are READY (decoded + mounted), with no pending or
   * in-flight gaps. 1 ⇒ real catalog fully covers the view (procgen can fade to 0);
   * 0 ⇒ no catalog coverage (procgen fully visible). Computed on the main thread in
   * the same `update()` pass — zero extra allocation on a settled cut.
   *
   * Defined only for octree chunks; procgen chunks do not count toward coverage.
   * A cut node counts as covered when it is ready OR a coarser ancestor tile is
   * ready (the same coarse-before-fine coverage `buildCoverage()` already uses, so
   * the catalog visibly fills that screen region). Contributions are weighted by
   * projected screen area (pixel extent squared) so a large near tile counts far
   * more than a tiny far one. Returns the value as of the last `update()`.
   */
  catalogCoverage(): number;

  /** BUG-10 debug: per-phase ms of the last `update()`. Live object, do not retain. */
  phaseMs(): { select: number; cancelRequest: number; coverage: number; enforce: number; evictFadeVisible: number; total: number };

  dispose(): void;
}

type ChunkStatus = 'pending' | 'inflight' | 'ready' | 'failed' | 'dead';

/**
 * A chunk that fails to load this many times becomes terminal `failed` and is not
 * re-requested until its node/params re-enter the cut after eviction (the backoff
 * that kills BUG-6's ~6-requests/frame storm even if the fetch stays broken).
 */
export const MAX_LOAD_ATTEMPTS = 3;

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
  /** Real (non-aborted) load-failure count; at MAX_LOAD_ATTEMPTS the chunk is `failed`. */
  attempts: number;
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
  const reportErr = opts.reportError ?? reportError;

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
  let evictionsTotal = 0;
  let _errorCount = 0;
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
  const eventScratch: { phase: ChunkLifecycleEvent['phase']; kind: ChunkKind; chunkId: string; lod: number; batch: StarBatch | null; error: AppError | null } =
    { phase: 'request', kind: 'octree', chunkId: '', lod: 0, batch: null, error: null };

  const stats: StreamingStats = {
    get inFlight() { return _inFlight; },
    get loadedChunks() { return countReady(); },
    get renderedPoints() { return _renderedPoints; },
    get drawCalls() { return _drawCalls; },
    get gpuBytesEstimate() { return _gpuBytes; },
    get requestsThisFrame() { return requestsThisFrame; },
    get cancelledThisFrame() { return cancelledThisFrame; },
    get errorCount() { return _errorCount; },
    get failedChunks() { return countFailed(); },
    get cutSize() { return targetList.length; },
    get pendingCount() { return countPending(); },
    get trackedChunks() { return chunkList.length; },
    get evictionsTotal() { return evictionsTotal; },
  };
  let _renderedPoints = 0;
  let _drawCalls = 0;
  let _gpuBytes = 0;
  let _catalogCoverage = 0;
  // BUG-10 per-phase timing of the last update() (ms). Debug instrumentation.
  const _phaseMs = { select: 0, cancelRequest: 0, coverage: 0, enforce: 0, evictFadeVisible: 0, total: 0 };

  let ctxMeters = CONTEXT_UNIT_METERS[origin.context];

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------
  function emit(phase: ChunkLifecycleEvent['phase'], c: Chunk, error: AppError | null = null): void {
    if (listeners.length === 0) return;
    eventScratch.phase = phase;
    eventScratch.kind = c.kind;
    eventScratch.chunkId = c.id;
    eventScratch.lod = c.level;
    eventScratch.batch = phase === 'ready' ? c.batch : null;
    // Reference assigned in place (same in-place discipline as `batch`); the AppError
    // itself was allocated by `toAppError` only on a real failure, never on the hot path.
    eventScratch.error = error;
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
      attempts: 0,
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
      attempts: 0,
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
        .catch((err) => onError(c, err));
    } else {
      const token = createCancelToken();
      c.token = token;
      pool
        .dispatch('procgen.galaxy', { params: c.galaxyParams! }, { token })
        .then((batch) => onReady(c, batch))
        .catch((err) => onError(c, err));
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

  function onError(c: Chunk, err: unknown): void {
    if (c.status !== 'inflight') return;
    _inFlight--;
    // Abort/cancel detection: an in-flight tile cancelled by navigation (or a rejection
    // tagged AbortError/WorkerCancelledError) is NORMAL, not a failure — remove it
    // silently, no event, no count. This is the single most important behaviour:
    // a laggy network during a fly-through must NOT spam thousands of false errors.
    const name =
      err !== null && typeof err === 'object' ? (err as { name?: unknown }).name : undefined;
    const aborted =
      c.abort?.signal.aborted === true ||
      c.token?.cancelled === true ||
      name === 'AbortError' ||
      name === 'WorkerCancelledError';
    c.abort = null;
    c.token = null;
    if (aborted) {
      removeChunk(c);
      return;
    }

    // A REAL failure: count it, emit the `error` phase carrying an AppError, and report
    // to the central sink (deduped on its side). toAppError/reportErr run ONLY here —
    // never per frame, never on success or cancel.
    c.attempts += 1;
    _errorCount++;
    const ctx = { chunkId: c.id, kind: c.kind, lod: c.level };
    const ae = toAppError(err, 'streaming', ctx);
    emit('error', c, ae);
    reportErr(err, 'streaming', ctx);

    if (c.attempts >= MAX_LOAD_ATTEMPTS) {
      // Terminal: stays resident (so the descent/dispatch logic sees it and does NOT
      // re-request it — it is no longer `pending`) until it leaves the cut and is
      // removed, then re-created fresh (attempts 0) when its node re-enters — the
      // "until inputs change" retry release.
      c.status = 'failed';
    } else {
      // Back to `pending` so it is re-dispatched next frame while it stays on the cut,
      // PRESERVING `attempts` on the same chunk so the count climbs to MAX_LOAD_ATTEMPTS
      // (a plain removeChunk would re-create a fresh attempts-0 chunk next frame and the
      // backoff could never trip). If the camera moves it off the cut first, step 2
      // removes the stale pending chunk and the attempt counter resets — the intended
      // "inputs changed" release. `batch` stays null; it never became ready.
      c.status = 'pending';
    }
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
    evictionsTotal++;
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

  function buildCoverage(viewportHeightPx: number): void {
    // Area-weighted catalog coverage of the cut, accumulated in the same pass.
    // Only octree targets count (procgen is the filler being superseded); each is
    // weighted by its projected screen area so a large near tile dominates a tiny
    // far one. Both accumulators are primitives — no allocation on a settled cut.
    let cutWeight = 0;
    let readyWeight = 0;

    for (let i = 0; i < targetList.length; i++) {
      const target = targetList[i]!;
      const isOctree = target.kind === 'octree';
      let area = 0;
      if (isOctree) {
        const px = projectedPixelExtent(
          target.extentCurrent,
          Math.max(target.distUnits, 1e-9),
          viewportHeightPx,
          STREAM_TAN_HALF_FOV,
        );
        area = px * px;
        cutWeight += area;
      }

      if (target.status === 'ready') {
        addCoverage(target);
        if (isOctree) readyWeight += area;
        continue;
      }
      if (!isOctree) continue; // procgen has no coarser ancestor
      let key: MortonKey | null = parentKey(target.id);
      while (key) {
        const anc = chunks.get(key);
        if (anc && anc.status === 'ready') {
          addCoverage(anc);
          readyWeight += area; // ancestor catalog tile covers this screen region
          break;
        }
        key = parentKey(key);
      }
    }

    _catalogCoverage = cutWeight > 0 ? readyWeight / cutWeight : 0;
  }

  // ---------------------------------------------------------------------------
  // budget degradation — drop LOD (collapse to coarser parents) before frames (§9)
  // ---------------------------------------------------------------------------
  // Collapse-by-level scratch: covered octree nodes bucketed by level for the
  // deepest-first collapse. Reused across frames (allocation doctrine) — the inner
  // arrays are length-reset, never reallocated, on a settled cut.
  const collapseBuckets: Chunk[][] = [];

  function enforceBudgets(): void {
    const cap = effectiveMaxPoints(budgets, tier);

    // Running totals, maintained incrementally so the whole collapse is O(cut), not
    // O(cut²). BUG-10: the old per-iteration rescan (`sumCoveragePoints`) + per-element
    // `parentKey` Morton re-encode in the inner "find deepest" loop was ~99% of frame
    // time on a dense pack (754-node cut ⇒ ~384 ms/frame). `draws` mirrors the count of
    // distinct covered nodes (coverageList holds exactly that set; addCoverage dedups).
    let pts = 0;
    for (let i = 0; i < coverageList.length; i++) pts += coverageList[i]!.pointCount;
    let draws = coverageList.length;
    if (pts <= cap && draws <= budgets.maxDrawCalls) return;

    // Bucket collapsible covered nodes (octree, non-root) by level.
    let maxLevel = 0;
    for (let i = 0; i < coverageList.length; i++) {
      const c = coverageList[i]!;
      if (c.kind !== 'octree' || c.level === 0) continue;
      (collapseBuckets[c.level] ??= []).push(c);
      if (c.level > maxLevel) maxLevel = c.level;
    }

    // Collapse the deepest covered nodes into their ready parents until within budget.
    // Each parent is exactly one level shallower, so we enqueue it in its own bucket and
    // reach it on a later (shallower) pass — identical to the old greedy "deepest
    // collapsible first", but each node is visited O(1) times (one parentKey per node).
    for (let level = maxLevel; level >= 1 && (pts > cap || draws > budgets.maxDrawCalls); level--) {
      const bucket = collapseBuckets[level];
      if (bucket === undefined) continue;
      for (let bi = 0; bi < bucket.length && (pts > cap || draws > budgets.maxDrawCalls); bi++) {
        const child = bucket[bi]!;
        if (child.coverageEpoch !== frame) continue; // already uncovered
        const pk = parentKey(child.id);
        if (pk === null) continue;
        const parent = chunks.get(pk);
        if (!parent || parent.status !== 'ready') continue; // not collapsible — keep child

        // Uncover the child; collapse its draw + points into the parent.
        child.coverageEpoch = 0;
        pts -= child.pointCount;
        draws--;
        if (parent.coverageEpoch !== frame) {
          addCoverage(parent); // coverageEpoch=frame + accessTick; pushes to coverageList
          pts += parent.pointCount;
          draws++;
          (collapseBuckets[parent.level] ??= []).push(parent); // parent.level === level-1
        }
      }
    }

    // Reset bucket scratch and compact coverageList to the live covered set (drop the
    // collapsed children) — one O(n) pass, so any later reader sees the truth.
    for (let l = 1; l <= maxLevel; l++) {
      const b = collapseBuckets[l];
      if (b !== undefined) b.length = 0;
    }
    let w = 0;
    for (let i = 0; i < coverageList.length; i++) {
      const c = coverageList[i]!;
      if (c.coverageEpoch === frame) coverageList[w++] = c;
    }
    coverageList.length = w;
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

    // BUG-10 phase profiler (additive, debug-only): split update() per phase to find
    // the dense-pack frame-time sink. `now()` is a no-op cost vs the phases measured.
    const _t0 = performance.now();

    // 1) selection (main-thread visibility)
    selectOctree(viewportHeightPx);
    selectProcgen(viewportHeightPx);
    const _t1 = performance.now();

    // 2) cancel stale in-flight + drop stale pending (camera moved them out of the cut)
    for (let i = chunkList.length - 1; i >= 0; i--) {
      const c = chunkList[i]!;
      if (c.desiredEpoch === frame) continue;
      if (c.status === 'inflight') cancelChunk(c);
      else if (c.status === 'pending') removeChunk(c);
      else if (c.status === 'failed') removeChunk(c); // left the cut ⇒ release backoff
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

    const _t2 = performance.now();

    // 4) coverage + budget degradation
    buildCoverage(viewportHeightPx);
    const _t3 = performance.now();
    enforceBudgets();
    const _t4 = performance.now();

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

    const _t5 = performance.now();
    _phaseMs.select = _t1 - _t0;
    _phaseMs.cancelRequest = _t2 - _t1;
    _phaseMs.coverage = _t3 - _t2;
    _phaseMs.enforce = _t4 - _t3;
    _phaseMs.evictFadeVisible = _t5 - _t4;
    _phaseMs.total = _t5 - _t0;
  }

  function countReady(): number {
    let n = 0;
    for (let i = 0; i < chunkList.length; i++) if (chunkList[i]!.status === 'ready') n++;
    return n;
  }

  function countPending(): number {
    let n = 0;
    for (let i = 0; i < chunkList.length; i++) {
      const s = chunkList[i]!.status;
      if (s === 'pending' || s === 'inflight') n++;
    }
    return n;
  }

  function countFailed(): number {
    let n = 0;
    for (let i = 0; i < chunkList.length; i++) if (chunkList[i]!.status === 'failed') n++;
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
    catalogCoverage() { return _catalogCoverage; },
    phaseMs() { return _phaseMs; },
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
