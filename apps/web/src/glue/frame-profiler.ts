/**
 * Main-thread span profiler for breadcrumb freeze diagnosis.
 * Enable: `?debug=breadcrumb-profile` — results on `window.__breadcrumbProfile`.
 */

export const BREADCRUMB_PROFILE =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('debug') === 'breadcrumb-profile';

export interface ProfileFrameRecord {
  readonly totalMs: number;
  readonly goToActive: boolean;
  readonly distPc: number;
  readonly spans: Readonly<Record<string, number>>;
}

export interface BreadcrumbProfileResult {
  readonly longFrames: readonly ProfileFrameRecord[];
  readonly spanStats: Readonly<
    Record<string, { readonly sum: number; readonly max: number; readonly count: number }>
  >;
  readonly topSpansByMax: readonly { readonly name: string; readonly maxMs: number }[];
}

const LONG_FRAME_MS = 50;
const MAX_LONG_FRAMES = 64;

const spanStats = new Map<string, { sum: number; max: number; count: number }>();
const longFrames: ProfileFrameRecord[] = [];
const frameSpans = new Map<string, number>();

let frameStart = 0;
let frameMeta = { goToActive: false, distPc: 0 };

function recordSpan(name: string, ms: number): void {
  const prev = spanStats.get(name);
  if (prev === undefined) {
    spanStats.set(name, { sum: ms, max: ms, count: 1 });
  } else {
    prev.sum += ms;
    if (ms > prev.max) prev.max = ms;
    prev.count++;
  }
  frameSpans.set(name, (frameSpans.get(name) ?? 0) + ms);
}

export function profileBeginFrame(meta: { goToActive: boolean; distPc: number }): void {
  if (!BREADCRUMB_PROFILE) return;
  frameStart = performance.now();
  frameMeta = meta;
  frameSpans.clear();
}

export function profileEndFrame(): void {
  if (!BREADCRUMB_PROFILE) return;
  const totalMs = performance.now() - frameStart;
  if (totalMs < LONG_FRAME_MS) return;

  const spans: Record<string, number> = {};
  for (const [k, v] of frameSpans) spans[k] = v;

  const rec: ProfileFrameRecord = {
    totalMs,
    goToActive: frameMeta.goToActive,
    distPc: frameMeta.distPc,
    spans,
  };
  longFrames.push(rec);
  if (longFrames.length > MAX_LONG_FRAMES) longFrames.shift();
}

/** Run `fn` and accumulate wall time under `name`. */
export function profileSpan(name: string, fn: () => void): void {
  if (!BREADCRUMB_PROFILE) {
    fn();
    return;
  }
  const t0 = performance.now();
  fn();
  recordSpan(name, performance.now() - t0);
}

export function buildProfileResult(): BreadcrumbProfileResult {
  const spanStatsOut: Record<string, { sum: number; max: number; count: number }> = {};
  for (const [k, v] of spanStats) spanStatsOut[k] = { ...v };

  const topSpansByMax = [...spanStats.entries()]
    .map(([name, s]) => ({ name, maxMs: s.max }))
    .sort((a, b) => b.maxMs - a.maxMs);

  return { longFrames: [...longFrames], spanStats: spanStatsOut, topSpansByMax };
}

export function publishProfileResult(): BreadcrumbProfileResult {
  const result = buildProfileResult();
  if (typeof window !== 'undefined') {
    window.__breadcrumbProfile = result;
  }
  return result;
}

export function resetProfile(): void {
  spanStats.clear();
  longFrames.length = 0;
  frameSpans.clear();
}

declare global {
  interface Window {
    __cosmosProfileSpan?: (name: string, fn: () => void) => void;
    __breadcrumbProfile?: BreadcrumbProfileResult;
    __breadcrumbProfileBuild?: () => BreadcrumbProfileResult;
  }
}

if (BREADCRUMB_PROFILE && typeof window !== 'undefined') {
  window.__cosmosProfileSpan = profileSpan;
  window.__breadcrumbProfileBuild = buildProfileResult;
}
