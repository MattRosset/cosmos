import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError, AppErrorKind } from '@cosmos/core-types';
import { createBudgetMonitor } from '../src/budget-monitor';
import { __resetDiagnostics, getErrorCounts } from '../src/sink';

const BUDGET = 4;
const SUSTAINED = 30;

/** A spy matching `reportError`'s signature — records every call. */
function makeReportSpy() {
  const calls: { kind: AppErrorKind; message: string; context?: AppError['context'] }[] = [];
  const report = vi.fn((err: unknown, kind: AppErrorKind, context?: AppError['context']) => {
    calls.push({ kind, message: (err as Error).message, context });
    // The real sink returns an AppError; tests here only read `calls`, so a minimal
    // stand-in is enough (createBudgetMonitor ignores the return value).
    return { kind, message: (err as Error).message, name: 'Error', atMs: 0 } as AppError;
  });
  return { report, calls };
}

beforeEach(() => {
  __resetDiagnostics();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createBudgetMonitor', () => {
  it('does not report until the sustain threshold is reached, then reports exactly once', () => {
    const { report, calls } = makeReportSpy();
    const mon = createBudgetMonitor({ label: 'x', budgetMs: BUDGET, sustainedFrames: SUSTAINED, report });

    for (let i = 0; i < SUSTAINED - 1; i++) mon.sample(BUDGET + 1);
    expect(calls.length).toBe(0);

    mon.sample(BUDGET + 1); // the SUSTAINED-th over-budget frame
    expect(calls.length).toBe(1);
  });

  it('does not spam while latched (further over-budget frames stay at one report)', () => {
    const { report, calls } = makeReportSpy();
    const mon = createBudgetMonitor({ label: 'x', budgetMs: BUDGET, sustainedFrames: SUSTAINED, report });

    for (let i = 0; i < SUSTAINED + 100; i++) mon.sample(BUDGET + 1);
    expect(calls.length).toBe(1);
  });

  it('re-arms after one under-budget frame: a second sustained episode reports again', () => {
    const { report, calls } = makeReportSpy();
    const mon = createBudgetMonitor({ label: 'x', budgetMs: BUDGET, sustainedFrames: SUSTAINED, report });

    for (let i = 0; i < SUSTAINED; i++) mon.sample(BUDGET + 1);
    expect(calls.length).toBe(1);

    mon.sample(BUDGET); // at budget → re-arm (not over)
    for (let i = 0; i < SUSTAINED; i++) mon.sample(BUDGET + 1);
    expect(calls.length).toBe(2);
  });

  it('does not fire on a single over-budget peak surrounded by under-budget frames', () => {
    const { report, calls } = makeReportSpy();
    const mon = createBudgetMonitor({ label: 'x', budgetMs: BUDGET, sustainedFrames: SUSTAINED, report });

    for (let i = 0; i < 100; i++) {
      mon.sample(BUDGET - 1);
      mon.sample(BUDGET + 50); // one huge peak, immediately recovered next frame
    }
    expect(calls.length).toBe(0);
  });

  it('a frame exactly at budget does not count as over', () => {
    const { report, calls } = makeReportSpy();
    const mon = createBudgetMonitor({ label: 'x', budgetMs: BUDGET, sustainedFrames: SUSTAINED, report });

    for (let i = 0; i < SUSTAINED * 2; i++) mon.sample(BUDGET);
    expect(calls.length).toBe(0);
  });

  it('reports kind invariant, a stable message containing the label, and a COPIED context', () => {
    const { report, calls } = makeReportSpy();
    const mon = createBudgetMonitor({
      label: 'nav.surfaceFeed',
      budgetMs: BUDGET,
      sustainedFrames: SUSTAINED,
      report,
    });

    // A mutable scratch context, as the caller keeps it.
    const scratch = { span: 'nav.surfaceFeed', distFromSolPc: 2835, spanMs: 90 };
    for (let i = 0; i < SUSTAINED; i++) mon.sample(BUDGET + 1, scratch);

    expect(calls.length).toBe(1);
    expect(calls[0]!.kind).toBe('invariant');
    expect(calls[0]!.message).toContain('nav.surfaceFeed');
    // Stable message: no varying ms in it.
    expect(calls[0]!.message).toBe(`nav.surfaceFeed exceeded ${BUDGET}ms for ${SUSTAINED} frames`);

    const reported = calls[0]!.context as Record<string, unknown>;
    expect(reported).toEqual({ span: 'nav.surfaceFeed', distFromSolPc: 2835, spanMs: 90 });

    // Mutating the scratch after the report must NOT change the reported context
    // (proves the shallow copy at report time).
    scratch.distFromSolPc = -1;
    scratch.spanMs = 0;
    expect(reported.distFromSolPc).toBe(2835);
    expect(reported.spanMs).toBe(90);
  });

  it('real-sink path (no spy): one sustained breach increments getErrorCounts().invariant to 1', () => {
    const mon = createBudgetMonitor({ label: 'nav.surfaceFeed', budgetMs: BUDGET, sustainedFrames: SUSTAINED });

    for (let i = 0; i < SUSTAINED; i++) mon.sample(BUDGET + 1, { span: 'nav.surfaceFeed', distFromSolPc: 2835 });

    expect(getErrorCounts().invariant).toBe(1);
    expect(getErrorCounts().total).toBe(1);
  });

  it('reset() re-arms mid-episode so a partial breach does not carry across', () => {
    const { report, calls } = makeReportSpy();
    const mon = createBudgetMonitor({ label: 'x', budgetMs: BUDGET, sustainedFrames: SUSTAINED, report });

    for (let i = 0; i < SUSTAINED - 1; i++) mon.sample(BUDGET + 1); // one short of firing
    mon.reset();
    // Only SUSTAINED-1 more over-budget frames — would fire if the partial breach carried.
    for (let i = 0; i < SUSTAINED - 1; i++) mon.sample(BUDGET + 1);
    expect(calls.length).toBe(0);
  });
});
