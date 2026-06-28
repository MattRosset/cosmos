import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { devOverlayTransport, installDevOverlay } from '../src/dev-overlay';
import { __resetDiagnostics, reportError } from '../src/sink';

const OVERLAY_SELECTOR = '[data-cosmos-dev-overlay]';

// The overlay holds module-level DOM state; capture each test's teardown so we
// always reset it (clearing document.body alone leaves the module's `_el` set,
// which would make the next idempotent install a no-op).
let activeTeardown: () => void = () => {};

beforeEach(() => {
  __resetDiagnostics();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  document.body.replaceChildren();
  activeTeardown = () => {};
});

afterEach(() => {
  activeTeardown();
  vi.restoreAllMocks();
});

describe('installDevOverlay', () => {
  it('mounts exactly one overlay element and appends a row on report', () => {
    const teardown = installDevOverlay();
    expect(document.querySelectorAll(OVERLAY_SELECTOR)).toHaveLength(1);

    reportError(new Error('visible failure'), 'render');
    const overlay = document.querySelector(OVERLAY_SELECTOR);
    expect(overlay?.textContent).toContain('visible failure');

    teardown();
    expect(document.querySelectorAll(OVERLAY_SELECTOR)).toHaveLength(0);
  });

  it('is idempotent — a second install does not add a second overlay', () => {
    const t1 = installDevOverlay();
    const t2 = installDevOverlay();
    expect(document.querySelectorAll(OVERLAY_SELECTOR)).toHaveLength(1);
    t2();
    expect(document.querySelectorAll(OVERLAY_SELECTOR)).toHaveLength(0);
    // t1 is now a no-op on an already-removed overlay.
    expect(() => t1()).not.toThrow();
  });

  it('clear button empties the row list', () => {
    activeTeardown = installDevOverlay();
    reportError(new Error('row one'), 'loader');
    reportError(new Error('row two'), 'loader');
    const clear = document.querySelector<HTMLButtonElement>(`${OVERLAY_SELECTOR} button`);
    expect(clear).not.toBeNull();
    clear?.click();
    const overlay = document.querySelector(OVERLAY_SELECTOR);
    expect(overlay?.textContent).not.toContain('row one');
  });

  it('caps the visible rows while the sink keeps counting', () => {
    activeTeardown = installDevOverlay();
    for (let i = 0; i < 25; i++) reportError(new Error(`err-${i}`), 'unknown');
    const overlay = document.querySelector(OVERLAY_SELECTOR);
    const list = overlay?.lastElementChild;
    expect(list?.childElementCount).toBeLessThanOrEqual(20);
    expect(list?.childElementCount).toBeGreaterThan(0);
  });

  it('devOverlayTransport is a no-op when nothing is mounted', () => {
    expect(() =>
      devOverlayTransport({ kind: 'unknown', name: 'Error', message: 'x', atMs: 0 }),
    ).not.toThrow();
  });

  it('is a no-op when document is undefined (SSR/Node)', () => {
    vi.stubGlobal('document', undefined);
    let teardown: () => void = () => {};
    expect(() => {
      teardown = installDevOverlay();
    }).not.toThrow();
    expect(() => teardown()).not.toThrow();
    vi.unstubAllGlobals();
  });
});
