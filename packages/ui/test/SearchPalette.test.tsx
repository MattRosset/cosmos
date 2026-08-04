import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchPalette } from '../src/SearchPalette';
import type { BodyLookupAdapter } from '../src/types';
import type { StarRecord } from '@cosmos/core-types';

const makeStars = (n: number): StarRecord[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `hyg:${i + 1}`,
    kind: 'star' as const,
    name: `Star ${i + 1}`,
    positionPc: [0, 0, i + 1] as [number, number, number],
    absMag: 1,
    colorIndexBV: 0.5,
  }));

const THREE_STARS = makeStars(3);
const FIFTEEN_STARS = makeStars(15);

function makeAdapter(stars: StarRecord[] = THREE_STARS): BodyLookupAdapter & {
  search: ReturnType<typeof vi.fn>;
} {
  return {
    search: vi.fn().mockReturnValue(stars),
    getBody: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Helper: open palette via fireEvent (synchronous, safe with fake timers)
function openPaletteWithCtrlK(): void {
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
}

// Helper: type into the open palette input via fireEvent
function typeInPalette(value: string): void {
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value } });
}

describe('SearchPalette — closed state', () => {
  it('renders nothing while closed', () => {
    render(<SearchPalette adapter={makeAdapter()} onGoTo={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('SearchPalette — opening', () => {
  it('opens with Ctrl+K', async () => {
    const user = userEvent.setup();
    render(<SearchPalette adapter={makeAdapter()} onGoTo={vi.fn()} />);
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('opens with "/" when no input is focused', async () => {
    const user = userEvent.setup();
    render(<SearchPalette adapter={makeAdapter()} onGoTo={vi.fn()} />);
    await user.keyboard('/');
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('does NOT open with "/" when an input is focused', async () => {
    const user = userEvent.setup();
    render(
      <>
        <input data-testid="ext" />
        <SearchPalette adapter={makeAdapter()} onGoTo={vi.fn()} />
      </>,
    );
    await user.click(screen.getByTestId('ext'));
    await user.keyboard('/');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does NOT open with "/" when a textarea is focused', async () => {
    const user = userEvent.setup();
    render(
      <>
        <textarea data-testid="ta" />
        <SearchPalette adapter={makeAdapter()} onGoTo={vi.fn()} />
      </>,
    );
    await user.click(screen.getByTestId('ta'));
    await user.keyboard('/');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('palette dialog has an accessible label', async () => {
    const user = userEvent.setup();
    render(<SearchPalette adapter={makeAdapter()} onGoTo={vi.fn()} />);
    await user.keyboard('{Control>}k{/Control}');
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBeTruthy();
  });
});

describe('SearchPalette — closing', () => {
  it('closes with Escape without calling onGoTo', async () => {
    const user = userEvent.setup();
    const onGoTo = vi.fn();
    render(<SearchPalette adapter={makeAdapter()} onGoTo={onGoTo} />);
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('dialog')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onGoTo).not.toHaveBeenCalled();
  });
});

describe('SearchPalette — search & debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('queries adapter after 80 ms debounce', () => {
    const adapter = makeAdapter();
    render(<SearchPalette adapter={adapter} onGoTo={vi.fn()} />);

    openPaletteWithCtrlK();
    expect(screen.queryByRole('dialog')).not.toBeNull();

    typeInPalette('a');
    expect(adapter.search).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(80); });
    expect(adapter.search).toHaveBeenCalledWith('a', 12);
  });

  it('renders at most 12 results', () => {
    const adapter = makeAdapter(FIFTEEN_STARS);
    render(<SearchPalette adapter={adapter} onGoTo={vi.fn()} />);

    openPaletteWithCtrlK();
    typeInPalette('star');
    act(() => { vi.advanceTimersByTime(80); });

    // Options include at most 12 items (no-matches option would be 1)
    const items = screen.getAllByRole('option');
    expect(items.length).toBeLessThanOrEqual(12);
  });

  it('shows "no matches" when adapter returns empty array', () => {
    const adapter: BodyLookupAdapter = {
      search: vi.fn().mockReturnValue([]),
      getBody: vi.fn(),
    };
    render(<SearchPalette adapter={adapter} onGoTo={vi.fn()} />);

    openPaletteWithCtrlK();
    typeInPalette('xyz');
    act(() => { vi.advanceTimersByTime(80); });

    expect(screen.getByText(/no matches/i)).not.toBeNull();
  });
});

describe('SearchPalette — keyboard navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setupNavTest(onGoTo: (id: string) => void): void {
    render(<SearchPalette adapter={makeAdapter(THREE_STARS)} onGoTo={onGoTo} />);
    openPaletteWithCtrlK();
    typeInPalette('s');
    act(() => { vi.advanceTimersByTime(80); });
  }

  const getInput = (): HTMLElement => screen.getByRole('textbox');
  const getSelected = (): HTMLElement[] =>
    screen.getAllByRole('option').filter((el) => el.getAttribute('aria-selected') === 'true');

  it('ArrowDown moves highlight with wraparound', () => {
    setupNavTest(() => {});

    expect(getSelected()[0]?.textContent).toContain('Star 1');

    fireEvent.keyDown(getInput(), { key: 'ArrowDown' });
    expect(getSelected()[0]?.textContent).toContain('Star 2');

    fireEvent.keyDown(getInput(), { key: 'ArrowDown' });
    expect(getSelected()[0]?.textContent).toContain('Star 3');

    // Wraparound
    fireEvent.keyDown(getInput(), { key: 'ArrowDown' });
    expect(getSelected()[0]?.textContent).toContain('Star 1');
  });

  it('ArrowUp wraps around from first to last', () => {
    setupNavTest(() => {});

    expect(getSelected()[0]?.textContent).toContain('Star 1');

    fireEvent.keyDown(getInput(), { key: 'ArrowUp' });
    expect(getSelected()[0]?.textContent).toContain('Star 3');
  });

  it('Enter calls onGoTo with highlighted id and closes palette', () => {
    const onGoTo = vi.fn<(id: string) => void>();
    setupNavTest(onGoTo);

    fireEvent.keyDown(getInput(), { key: 'ArrowDown' });
    fireEvent.keyDown(getInput(), { key: 'Enter' });

    expect(onGoTo).toHaveBeenCalledWith('hyg:2');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('full keyboard flow: open → type → navigate → Enter (a11y, keyboard-only)', () => {
    const onGoTo = vi.fn<(id: string) => void>();
    render(<SearchPalette adapter={makeAdapter(THREE_STARS)} onGoTo={onGoTo} />);

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog')).not.toBeNull();

    typeInPalette('star');
    act(() => { vi.advanceTimersByTime(80); });

    fireEvent.keyDown(getInput(), { key: 'Enter' });

    expect(onGoTo).toHaveBeenCalledWith('hyg:1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TASK-070: Gaia source_id branch (async resolveGaiaId → onGoToPosition)
// ---------------------------------------------------------------------------

interface GaiaHit {
  readonly sourceId: bigint;
  readonly positionPc: readonly [number, number, number];
}
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Adapter whose `resolveGaiaId` returns a controllable deferred per call. */
function makeGaiaAdapter(): {
  adapter: BodyLookupAdapter;
  resolveGaiaId: ReturnType<typeof vi.fn>;
  calls: { id: string; d: ReturnType<typeof deferred<GaiaHit | null>> }[];
} {
  const calls: { id: string; d: ReturnType<typeof deferred<GaiaHit | null>> }[] = [];
  const resolveGaiaId = vi.fn((id: string) => {
    const d = deferred<GaiaHit | null>();
    calls.push({ id, d });
    return d.promise;
  });
  return {
    adapter: { search: vi.fn().mockReturnValue([]), getBody: vi.fn(), resolveGaiaId },
    resolveGaiaId,
    calls,
  };
}

describe('SearchPalette — Gaia source_id branch (TASK-070)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const getInput = (): HTMLElement => screen.getByRole('textbox');

  it('routes bare digits and gaia:-prefixed ids to resolveGaiaId (not search); large ids kept as-is', () => {
    const { adapter, resolveGaiaId } = makeGaiaAdapter();
    render(<SearchPalette adapter={adapter} onGoTo={vi.fn()} onGoToPosition={vi.fn()} />);
    openPaletteWithCtrlK();

    typeInPalette('gaia:4000000000000000137'); // 19-digit id, > 2^53
    act(() => { vi.advanceTimersByTime(80); });
    expect(resolveGaiaId).toHaveBeenLastCalledWith('4000000000000000137'); // prefix stripped
    expect(adapter.search).not.toHaveBeenCalled();

    typeInPalette('10000001'); // bare digits
    act(() => { vi.advanceTimersByTime(80); });
    expect(resolveGaiaId).toHaveBeenLastCalledWith('10000001');
  });

  it('a hit shows one "Gaia DR3 <id>" row; selecting it flies via onGoToPosition and closes', async () => {
    const { adapter, calls } = makeGaiaAdapter();
    const onGoToPosition = vi.fn();
    const onGoTo = vi.fn();
    render(<SearchPalette adapter={adapter} onGoTo={onGoTo} onGoToPosition={onGoToPosition} />);
    openPaletteWithCtrlK();

    typeInPalette('10000001');
    act(() => { vi.advanceTimersByTime(80); });
    // Loading row while in flight.
    expect(screen.getByText(/searching gaia dr3 10000001/i)).not.toBeNull();

    await act(async () => {
      calls[0]!.d.resolve({ sourceId: 10000001n, positionPc: [1, 2, 3] });
    });

    const row = screen.getByText(/gaia dr3 10000001/i);
    expect(row).not.toBeNull();
    fireEvent.click(row);
    expect(onGoToPosition).toHaveBeenCalledWith([1, 2, 3]);
    expect(onGoTo).not.toHaveBeenCalled(); // never routes a gaia star through the body path
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a miss shows the empty state, no fly', async () => {
    const { adapter, calls } = makeGaiaAdapter();
    const onGoToPosition = vi.fn();
    render(<SearchPalette adapter={adapter} onGoTo={vi.fn()} onGoToPosition={onGoToPosition} />);
    openPaletteWithCtrlK();

    typeInPalette('99999999');
    act(() => { vi.advanceTimersByTime(80); });
    await act(async () => { calls[0]!.d.resolve(null); });

    expect(screen.getByText(/no matches/i)).not.toBeNull();
    expect(onGoToPosition).not.toHaveBeenCalled();
  });

  it('Enter selects a resolved hit', async () => {
    const { adapter, calls } = makeGaiaAdapter();
    const onGoToPosition = vi.fn();
    render(<SearchPalette adapter={adapter} onGoTo={vi.fn()} onGoToPosition={onGoToPosition} />);
    openPaletteWithCtrlK();

    typeInPalette('10000001');
    act(() => { vi.advanceTimersByTime(80); });
    await act(async () => { calls[0]!.d.resolve({ sourceId: 10000001n, positionPc: [4, 5, 6] }); });

    fireEvent.keyDown(getInput(), { key: 'Enter' });
    expect(onGoToPosition).toHaveBeenCalledWith([4, 5, 6]);
  });

  // Acceptance #5: a superseded resolve (older query, resolves LAST) must NOT update the UI.
  it('staleness guard: an older resolve landing after a newer query is ignored', async () => {
    const { adapter, calls } = makeGaiaAdapter();
    render(<SearchPalette adapter={adapter} onGoTo={vi.fn()} onGoToPosition={vi.fn()} />);
    openPaletteWithCtrlK();

    typeInPalette('10000001'); // query A
    act(() => { vi.advanceTimersByTime(80); }); // fires resolve A (calls[0])
    typeInPalette('10000002'); // query B
    act(() => { vi.advanceTimersByTime(80); }); // fires resolve B (calls[1])

    expect(calls).toHaveLength(2);
    expect(calls[0]!.id).toBe('10000001');
    expect(calls[1]!.id).toBe('10000002');

    // Newer query B resolves FIRST, then the stale older A resolves LAST.
    await act(async () => { calls[1]!.d.resolve({ sourceId: 10000002n, positionPc: [2, 2, 2] }); });
    await act(async () => { calls[0]!.d.resolve({ sourceId: 10000001n, positionPc: [1, 1, 1] }); });

    // The rendered row must reflect ONLY the newer query — the stale resolve was dropped.
    expect(screen.getByText(/gaia dr3 10000002/i)).not.toBeNull();
    expect(screen.queryByText(/gaia dr3 10000001/i)).toBeNull();
  });

  it('leaving the id branch (to a named-star query) drops an in-flight gaia resolve', async () => {
    const stars = makeStars(2);
    const { calls } = makeGaiaAdapter();
    const search = vi.fn().mockReturnValue(stars);
    const adapter: BodyLookupAdapter = {
      search,
      getBody: vi.fn(),
      resolveGaiaId: (id: string) => {
        const d = deferred<GaiaHit | null>();
        calls.push({ id, d });
        return d.promise;
      },
    };
    render(<SearchPalette adapter={adapter} onGoTo={vi.fn()} onGoToPosition={vi.fn()} />);
    openPaletteWithCtrlK();

    typeInPalette('10000001'); // gaia branch
    act(() => { vi.advanceTimersByTime(80); });
    typeInPalette('Star'); // named-star branch supersedes
    act(() => { vi.advanceTimersByTime(80); });
    expect(search).toHaveBeenCalledWith('Star', 12);

    // The stale gaia resolve now lands — it must not resurrect a gaia row.
    await act(async () => { calls[0]!.d.resolve({ sourceId: 10000001n, positionPc: [9, 9, 9] }); });
    expect(screen.queryByText(/gaia dr3/i)).toBeNull();
    expect(screen.getByText(/star 1/i)).not.toBeNull();
  });
});
