import type { BudgetMonitor } from '@cosmos/diagnostics';

/** Per-frame scratch for the nav surface-feed budget tripwire (TASK-090). A MUTABLE
 *  local shape (NOT `AppError['context']`, which is readonly): the caller writes its
 *  fields every frame; the monitor copies it only on the rare breach. All fields are
 *  string|number so it structurally satisfies the readonly `AppError['context']`
 *  param on the monitor's read side with no cast. */
// NOTE: a `type` alias, NOT an `interface`. Interfaces have no implicit index
// signature (they can be augmented via declaration merging), so an interface is
// NOT assignable to the readonly `Record<string, …>` that is `AppError['context']`
// — `monitor.sample(ms, ctx)` would be a compile error. A `type` alias to the same
// object literal DOES get an implicit index signature, so it structurally satisfies
// the param with no cast (the no-`as any` goal the spec intended). See TASK-090-NOTES.
export type NavBudgetCtx = {
  span: string;
  context: string;
  distFromSolPc: number;
  distToField: number;
  spanMs: number;
};

/** The nav-feed wiring seam. Records the measured span on the reused scratch and
 *  feeds it to the always-on monitor. Extracted so it is unit-testable without the
 *  WebGL frame loop (`useFrameContext` can't run under vitest): a test drives it with
 *  a real monitor + a synthetic clock (`spanMs`) and asserts the sink counts/report.
 *  Zero allocation — mutates the caller-owned `ctx` in place. */
export function sampleNavBudget(monitor: BudgetMonitor, ctx: NavBudgetCtx, spanMs: number): void {
  ctx.spanMs = spanMs;
  monitor.sample(spanMs, ctx);
}
