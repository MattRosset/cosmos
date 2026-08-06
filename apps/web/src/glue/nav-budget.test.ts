import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError } from '@cosmos/core-types';
import {
  __resetDiagnostics,
  createBudgetMonitor,
  getErrorCounts,
  setTransports,
} from '@cosmos/diagnostics';
import { sampleNavBudget, type NavBudgetCtx } from './nav-budget';

// Mirrors the NavDriver wiring config (TASK-090).
const BUDGET_MS = 4;
const SUSTAINED = 30;

beforeEach(() => {
  __resetDiagnostics();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sampleNavBudget (nav-feed tripwire wiring)', () => {
  it('a sustained >budget span drives the REAL sink to exactly one invariant, with the nav context', () => {
    // Capture the reported AppError via a transport (the sink fans breaches here).
    const reports: AppError[] = [];
    setTransports([(e) => reports.push(e)]);

    // The production monitor config, wired to the real sink (no injected report).
    const monitor = createBudgetMonitor({
      label: 'nav.surfaceFeed',
      budgetMs: BUDGET_MS,
      sustainedFrames: SUSTAINED,
    });

    // The reused scratch, exactly as NavDriver holds it (galaxy-park regime values).
    const ctx: NavBudgetCtx = {
      span: 'nav.surfaceFeed',
      context: 'galaxy',
      distFromSolPc: 2835,
      distToField: 2500,
      spanMs: 0,
    };

    // Synthetic clock: 30 consecutive frames measured at 5 ms (> 4 ms budget), as a
    // NavDriver test would produce via a `now()` stub (t0=0 → now()=5). No real work.
    const before = getErrorCounts().invariant;
    for (let i = 0; i < SUSTAINED; i++) sampleNavBudget(monitor, ctx, 5);

    expect(getErrorCounts().invariant).toBe(before + 1);
    expect(reports.length).toBe(1);
    const reported = reports[0]!;
    expect(reported.kind).toBe('invariant');
    expect(reported.message).toBe(
      `nav.surfaceFeed exceeded ${BUDGET_MS}ms for ${SUSTAINED} frames`,
    );
    expect(reported.context?.span).toBe('nav.surfaceFeed');
    expect(typeof reported.context?.distFromSolPc).toBe('number');
    expect(reported.context?.distFromSolPc).toBe(2835);
    // The helper records the measured span on the scratch, and it survives to the report.
    expect(reported.context?.spanMs).toBe(5);
  });

  it('records the measured span on the scratch each frame', () => {
    const monitor = createBudgetMonitor({
      label: 'nav.surfaceFeed',
      budgetMs: BUDGET_MS,
      sustainedFrames: SUSTAINED,
    });
    const ctx: NavBudgetCtx = {
      span: 'nav.surfaceFeed',
      context: 'galaxy',
      distFromSolPc: 1,
      distToField: 1,
      spanMs: 0,
    };
    sampleNavBudget(monitor, ctx, 1.5);
    expect(ctx.spanMs).toBe(1.5);
  });

  it('an under-budget feed never reports', () => {
    setTransports([]);
    const monitor = createBudgetMonitor({
      label: 'nav.surfaceFeed',
      budgetMs: BUDGET_MS,
      sustainedFrames: SUSTAINED,
    });
    const ctx: NavBudgetCtx = {
      span: 'nav.surfaceFeed',
      context: 'galaxy',
      distFromSolPc: 0.06,
      distToField: -2500,
      spanMs: 0,
    };
    for (let i = 0; i < SUSTAINED * 3; i++) sampleNavBudget(monitor, ctx, 0.002);
    expect(getErrorCounts().invariant).toBe(0);
  });
});
