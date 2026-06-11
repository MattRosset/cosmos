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
