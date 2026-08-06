import type { AppError } from '@cosmos/core-types';
import { reportError } from './sink';

/**
 * Always-on alarm for a known per-frame cost cliff. A caller brackets a span it
 * knows can silently blow up (e.g. the nav surface feed) and pushes the measured
 * ms here once per frame; when the span sustains OVER budget for enough consecutive
 * frames, the monitor fires ONE loud, deduped diagnostics error (kind `'invariant'`,
 * counted in `getErrorCounts()` so CI can gate on it) — then keeps quiet so the app
 * stays observable while the failing state persists.
 *
 * It is a reusable primitive, NOT hard-wired to any consumer: the label,
 * budget, and sustain window are all injected. See
 * `docs/agent-tasks/TASK-090-nav-frame-budget-tripwire.md` and
 * `docs/research/hyg-void-nearest-robust-fix.md` (the HYG void-search cliff this
 * alarm exists to catch — a ~90 ms/frame stall that only *looked* like a GPU/
 * throttle problem for ~2 debugging sessions).
 */
export interface BudgetMonitor {
  /** Call once per frame with the measured span ms. Zero allocation on this path.
   *  `context` is a caller-owned scratch object (mutated in place each frame); the
   *  monitor reads it ONLY when it reports, and shallow-copies it then.
   *  Typed `AppError['context']` (a Readonly Record) on the READ side here; the caller
   *  keeps a MUTABLE alias of the same object to write per frame. */
  sample(ms: number, context?: AppError['context']): void;
  /** Re-arm (e.g., on context switch / teardown). */
  reset(): void;
}

export interface BudgetMonitorOptions {
  /** Stable label, e.g. 'nav.surfaceFeed'. Goes in the report message + context. */
  readonly label: string;
  /** Per-frame budget (ms). A single frame at/under this never contributes to a breach. */
  readonly budgetMs: number;
  /** A breach must be SUSTAINED this many consecutive over-budget frames before it
   *  reports — a single slow frame (GC, machine hitch) must NOT fire the alarm. */
  readonly sustainedFrames: number;
  /** Injected for tests; defaults to the real sink `reportError`. */
  readonly report?: typeof reportError;
}

/**
 * Build a budget monitor. Pure + deterministic: no DOM, no React, no timers, no
 * clock of its own (the caller measures ms and passes it in). The only side effect
 * is calling `report` on the rare sustained breach.
 */
export function createBudgetMonitor(opts: BudgetMonitorOptions): BudgetMonitor {
  const { label, budgetMs, sustainedFrames } = opts;
  const report = opts.report ?? reportError;
  // Stable message: only static config, no varying ms — so the sink's
  // kind|name|message dedup still caps console/overlay at 1/s even if a caller
  // samples every frame. Varying numbers live in the copied context.
  const message = `${label} exceeded ${budgetMs}ms for ${sustainedFrames} frames`;

  let consecutiveOver = 0;
  let reportedThisEpisode = false;

  return {
    sample(ms: number, context?: AppError['context']): void {
      if (ms > budgetMs) {
        consecutiveOver++;
        if (consecutiveOver >= sustainedFrames && !reportedThisEpisode) {
          report(new Error(message), 'invariant', context ? { ...context } : undefined);
          reportedThisEpisode = true;
        }
      } else {
        // A single frame within budget re-arms for the next episode.
        consecutiveOver = 0;
        reportedThisEpisode = false;
      }
    },
    reset(): void {
      consecutiveOver = 0;
      reportedThisEpisode = false;
    },
  };
}
