/** Coarse origin of an error — drives grouping + which UI surface reacts. */
export type AppErrorKind =
  | 'loader'       // pack / manifest / tile fetch + decode (data package)
  | 'streaming'    // chunk load/decode failure surfaced by the streamer
  | 'worker'       // a worker handler threw (WorkerErrorPayload origin)
  | 'render'       // a render-tree / Three.js / R3F failure (ErrorBoundary)
  | 'persistence'  // localStorage / migration failure (app-state)
  | 'invariant'    // a `should-never-happen` assertion tripped
  | 'unknown';     // anything uncategorized (global handlers)

/** Structured, JSON-serializable error description. NOT an Error subclass:
 *  it must survive `postMessage` (worker boundary) and `JSON.stringify` (beacon). */
export interface AppError {
  readonly kind: AppErrorKind;
  /** Human-readable, already-extracted message (never the raw Error object). */
  readonly message: string;
  /** Stable-ish error name, e.g. 'TypeError', 'PackFormatError'. */
  readonly name: string;
  /** Stack if available (best-effort; absent in some worker/transfer paths). */
  readonly stack?: string;
  /** Free-form breadcrumb context: where/what — e.g. { chunkId, url, tier }.
   *  Values must be JSON-serializable primitives. */
  readonly context?: Readonly<Record<string, string | number | boolean | null>>;
  /** Epoch ms when normalized (Date.now()), for ordering in the sink. */
  readonly atMs: number;
}

/** Normalize any thrown value into an AppError. The ONE place the
 *  `err instanceof Error ? err.message : String(err)` idiom lives (audit §3.5).
 *  Pure + deterministic given `atMs` (injectable for tests; defaults to Date.now).
 *
 *  Non-Error rule: any thrown value that is not an `Error` is reported with
 *  `name: 'Error'`, `message: String(err)`, and no `stack`. This mirrors the
 *  §5.13 `WorkerErrorPayload` precedent (`String(err)` for the non-Error branch).
 *  Note: a cancelled/aborted operation is NOT an error — callers must not pass
 *  abort signals through here (see TASK-057). */
export function toAppError(
  err: unknown,
  kind: AppErrorKind,
  context?: AppError['context'],
  atMs: number = Date.now(),
): AppError {
  if (err instanceof Error) {
    return {
      kind,
      message: err.message,
      name: err.name,
      ...(err.stack !== undefined ? { stack: err.stack } : {}),
      ...(context !== undefined ? { context } : {}),
      atMs,
    };
  }
  return {
    kind,
    message: String(err),
    name: 'Error',
    ...(context !== undefined ? { context } : {}),
    atMs,
  };
}
