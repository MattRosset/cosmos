import { FLYTHROUGH3_SOAK_LOOPS } from '../scene/flythrough-descent';

/** TASK-006 debug flythrough scene, behind the query flag only. */
export const DEBUG_MARKERS =
  new URLSearchParams(window.location.search).get('debug') === 'markers';

/** TASK-017 rendered jitter gate (`?debug=jitter`): no pack, no HUD. */
export const DEBUG_JITTER =
  new URLSearchParams(window.location.search).get('debug') === 'jitter';

/** TASK-030 context-switch gate (`?debug=ctxswitch`): full packs, scripted descent. */
export const DEBUG_CTXSWITCH =
  new URLSearchParams(window.location.search).get('debug') === 'ctxswitch';

/** TASK-040 M3 gate (`?debug=m3`): full packs + streaming, scripted universe→Earth zoom. */
export const DEBUG_M3 = new URLSearchParams(window.location.search).get('debug') === 'm3';

/** TASK-041 recorded-flythrough perf gate (`?debug=flythrough3`, §5.8). */
export const DEBUG_FLYTHROUGH3 =
  new URLSearchParams(window.location.search).get('debug') === 'flythrough3';

/**
 * TASK-053 tier-unification budget gate (`?debug=flythrough4`, ADR-006 §5.4).
 * Replays the SAME committed path as flythrough3 against the M4a composition
 * (combined HYG+Gaia octree, coverage-faded procgen, gated monolith, overlays,
 * atmosphere). `?baseline=m3` records the HYG-only baseline composition instead,
 * so the near-Sol segment is a like-for-like M3↔M4a comparison. The span profiler
 * is active so the universe segment attributes its frame time (BUG-4).
 */
export const DEBUG_FLYTHROUGH4 =
  new URLSearchParams(window.location.search).get('debug') === 'flythrough4';
export const FLYTHROUGH4_BASELINE =
  new URLSearchParams(window.location.search).get('baseline') === 'm3';

/** TASK-041 memory-soak gate (`?debug=soak3`, §5.8); `?loops=N` overrides the count. */
export const DEBUG_SOAK3 = new URLSearchParams(window.location.search).get('debug') === 'soak3';
/**
 * TASK-053 M4a memory-soak gate (`?debug=soak4`, §5.8). Same loop as soak3 but with
 * the M4a mounts (combined HYG+Gaia octree, constellation lines + nebula fields +
 * labels overlay, Earth atmosphere on the system leg) — the new mounts are the leak
 * suspects (must dispose on context exit). `?loops=N` overrides the count.
 */
export const DEBUG_SOAK4 = new URLSearchParams(window.location.search).get('debug') === 'soak4';
export const SOAK3_LOOPS = (() => {
  const raw = new URLSearchParams(window.location.search).get('loops');
  const n = raw !== null ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : FLYTHROUGH3_SOAK_LOOPS;
})();

/** Breadcrumb freeze profiler — span timings on `window.__breadcrumbProfile`. */
export const DEBUG_BREADCRUMB_PROFILE =
  new URLSearchParams(window.location.search).get('debug') === 'breadcrumb-profile';

/**
 * TASK-066 V1: build stats (`M4a — N stars … Gaia field · Sol + N exoplanet systems`)
 * are dev-only chrome, off the production HUD. `?debug=buildstats` restores the line.
 */
export const DEBUG_BUILD_STATS =
  new URLSearchParams(window.location.search).get('debug') === 'buildstats';

/** TASK-052 M4a debug gate (`?debug=m4a`): scripted descent with the M4a composition. */
export const DEBUG_M4A = new URLSearchParams(window.location.search).get('debug') === 'm4a';

/**
 * TASK-059 error gate (`?debug=errorgate`): scripted universe→galaxy→Sol→Earth
 * descent against the M4a composition, asserting the diagnostics counters TASK-058
 * exposed (`errorCounts`/`failedChunks`/`catalogCoverage`) read zero-error /
 * fully-loaded at the end. `?inject=1` deliberately fails the combined octree's
 * root tile — the gate's own red-on-regression self-test (the BUG-6 class it must
 * catch): every load attempt for that key rejects, so `errorCounts.total` and
 * `streaming.stats.failedChunks` both go non-zero and `catalogCoverage()` drops.
 */
export const DEBUG_ERRORGATE =
  new URLSearchParams(window.location.search).get('debug') === 'errorgate';
export const ERRORGATE_INJECT = new URLSearchParams(window.location.search).get('inject') === '1';
