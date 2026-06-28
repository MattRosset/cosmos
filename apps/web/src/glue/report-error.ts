/**
 * Interim error sink — the cheap, self-contained leaf of the error-handling hardening track
 * (`docs/research/error-handling-audit.md` §4.1). Everything that catches an error funnels
 * here so failures stop being silent (BUG-6 / BUG-8 were observability failures, not logic
 * bugs). Deliberately minimal and local to `apps/web`:
 *   - dev:  loud `console.error` + a visible overlay (subscribers) so throws are impossible to miss.
 *   - prod: throttled `console.error` + a counter only — NO telemetry beacon yet (Sentry is the
 *           deferred, frozen-thaw part of the track: TASK-055/056).
 * The planned `diagnostics` package (TASK-055) will subsume this module; the surface
 * (`reportError` / `subscribeErrors` / `errorCount`) is kept small so that swap is mechanical.
 */

export interface ReportedError {
  readonly id: number;
  readonly message: string;
  /** Where it came from (e.g. 'app-root', 'scene', 'unhandledrejection'). */
  readonly context: string;
  readonly stack?: string;
  readonly at: number;
}

type Listener = (errors: readonly ReportedError[]) => void;

const MAX_KEPT = 50;
const THROTTLE_MS = 1000;

let _count = 0;
let _seq = 0;
const _recent: ReportedError[] = [];
const _listeners = new Set<Listener>();
const _lastLoggedAt = new Map<string, number>();

function normalize(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return err.stack !== undefined ? { message: err.message, stack: err.stack } : { message: err.message };
  }
  if (typeof err === 'string') return { message: err };
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: String(err) };
  }
}

/** Funnel point: record + surface an error. Never throws. */
export function reportError(err: unknown, context: string): void {
  const { message, stack } = normalize(err);
  _count += 1;
  const base = { id: ++_seq, message, context, at: Date.now() };
  const entry: ReportedError = stack !== undefined ? { ...base, stack } : base;
  _recent.push(entry);
  if (_recent.length > MAX_KEPT) _recent.shift();

  // Throttle console spam per (context+message) so a per-frame failure can't flood the log.
  const key = `${context}::${message}`;
  const now = Date.now();
  if (now - (_lastLoggedAt.get(key) ?? 0) >= THROTTLE_MS) {
    _lastLoggedAt.set(key, now);
    console.error(`[cosmos:${context}]`, err);
  }

  // Notify with a fresh snapshot — `_recent` is mutated in place, so passing it directly
  // would be reference-equal and React subscribers would bail out of re-rendering.
  const snapshot = _recent.slice();
  for (const cb of _listeners) {
    try {
      cb(snapshot);
    } catch {
      // isolate a throwing listener so reporting never cascades.
    }
  }

  // Forward-compatible visibility for tests / the planned error gate (TASK-059).
  (
    window as unknown as { __cosmosErrors?: { count: number; recent: readonly ReportedError[] } }
  ).__cosmosErrors = { count: _count, recent: _recent };
}

export function subscribeErrors(cb: Listener): () => void {
  _listeners.add(cb);
  cb(_recent.slice());
  return () => {
    _listeners.delete(cb);
  };
}

export function errorCount(): number {
  return _count;
}

/** Install the global net (uncaught errors + unhandled promise rejections). Idempotent. */
let _globalsInstalled = false;
export function installGlobalErrorHandlers(): void {
  if (_globalsInstalled) return;
  _globalsInstalled = true;
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'window.error'));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'unhandledrejection'));
}

/** WebGL2 capability probe on a throwaway canvas (the renderer needs WebGL2). */
export function isWebGL2Available(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}
