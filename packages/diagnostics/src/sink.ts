import type { AppError, AppErrorKind } from '@cosmos/core-types';
import { toAppError } from '@cosmos/core-types';

/** A sink destination. The app installs one (or more) at boot. Receives every
 *  normalized AppError. MUST NOT throw (a throwing transport is swallowed + warned). */
export type ErrorTransport = (e: AppError) => void;

/** Counts returned by `getErrorCounts` — total plus a bucket per kind. */
export type ErrorCounts = { readonly total: number } & Readonly<Record<AppErrorKind, number>>;

const ALL_KINDS: readonly AppErrorKind[] = [
  'loader',
  'streaming',
  'worker',
  'render',
  'persistence',
  'invariant',
  'unknown',
];

const DEDUPE_WINDOW_MS = 1000;
/** Hard cap so a long session with many distinct errors can't leak the dedupe map. */
const DEDUPE_MAX_KEYS = 1000;

function freshCounts(): Record<AppErrorKind, number> & { total: number } {
  const c = { total: 0 } as Record<AppErrorKind, number> & { total: number };
  for (const k of ALL_KINDS) c[k] = 0;
  return c;
}

let _counts = freshCounts();
let _transports: readonly ErrorTransport[] = [];
const _dedupe = new Map<string, number>();

/** The dev overlay registers itself here (set by `installDevOverlay`); kept
 *  separate from `_transports` so the app can swap transports without losing it. */
let _overlaySink: ErrorTransport | null = null;

/** Internal: wire the dev overlay's transport in/out. Not part of the public API. */
export function __setOverlaySink(sink: ErrorTransport | null): void {
  _overlaySink = sink;
}

/** Replace the active transports. Passing [] resets to console-only.
 *  Returns an unsubscribe that restores the previous set. */
export function setTransports(transports: readonly ErrorTransport[]): () => void {
  const previous = _transports;
  _transports = transports.slice();
  return () => {
    _transports = previous;
  };
}

function emit(sink: ErrorTransport, e: AppError): void {
  try {
    sink(e);
  } catch (transportErr) {
    // A throwing transport must never propagate out of the sink (audit §4.1).
    console.warn('[cosmos:diagnostics] transport threw; ignoring', transportErr);
  }
}

/** THE central sink. Normalizes `err` to an AppError (via toAppError) and fans it
 *  out to: (1) console.error always, (2) the dev overlay if installed, (3) every
 *  installed transport. Never throws. Deduplicates identical (kind+name+message)
 *  reports within `dedupeWindowMs` (default 1000) to avoid storms (audit §3.1 BUG-6:
 *  ~6 identical failures/frame). Returns the AppError it produced. */
export function reportError(
  err: unknown,
  kind: AppErrorKind,
  context?: AppError['context'],
): AppError {
  const appError = toAppError(err, kind, context);

  // Counts always increment — the dedupe silences the UI/log, never the metric
  // (the gate in TASK-059 must see the true failure rate).
  _counts.total += 1;
  _counts[kind] += 1;

  const key = `${kind}|${appError.name}|${appError.message}`;
  const last = _dedupe.get(key);
  const duplicate = last !== undefined && appError.atMs - last < DEDUPE_WINDOW_MS;
  // Re-insert to refresh recency (Map keeps insertion order ⇒ first key is oldest).
  _dedupe.delete(key);
  _dedupe.set(key, appError.atMs);
  if (_dedupe.size > DEDUPE_MAX_KEYS) {
    const oldest = _dedupe.keys().next().value;
    if (oldest !== undefined) _dedupe.delete(oldest);
  }

  if (!duplicate) {
    console.error(`[cosmos:${kind}]`, appError.message, appError.context ?? '');
    if (_overlaySink !== null) emit(_overlaySink, appError);
    for (const t of _transports) emit(t, appError);
  }

  return appError;
}

/** Monotonic count of reports since process/page start, by kind and total. */
export function getErrorCounts(): ErrorCounts {
  return { ..._counts };
}

/** Test/probe hook: reset counts + dedupe state. Not for production code. */
export function __resetDiagnostics(): void {
  _counts = freshCounts();
  _dedupe.clear();
  _transports = [];
}
