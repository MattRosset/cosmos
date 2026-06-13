import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBookmarkStore, useHistoryStore } from '@cosmos/app-state';
import { BookmarksPanel } from '../src/BookmarksPanel';
import type { BookmarkRecord } from '@cosmos/core-types';
import type { BodyLookupAdapter } from '../src/types';

const BOOKMARK_A: BookmarkRecord = {
  id: 'bm-001',
  name: 'Sol system',
  createdAtIso: '2026-01-15T10:00:00.000Z',
  position: { context: 'galaxy', local: [0, 0, 0] },
  orientation: [0, 0, 0, 1],
  epochJD: 2451545.0,
};


function makeAdapter(
  bodies: Record<string, { name?: string }> = {},
): BodyLookupAdapter {
  return {
    search: vi.fn().mockReturnValue([]),
    getBody: vi.fn().mockImplementation((id: string) => {
      const b = bodies[id];
      if (!b) return undefined;
      return { id, kind: 'star', name: b.name, positionPc: [0, 0, 0], absMag: 1, colorIndexBV: 0 };
    }),
  };
}

function defaultProps(overrides: Partial<Parameters<typeof BookmarksPanel>[0]> = {}) {
  return {
    onCapture: vi.fn().mockReturnValue(BOOKMARK_A),
    onGoToBookmark: vi.fn(),
    onGoToBody: vi.fn(),
    adapter: makeAdapter(),
    ...overrides,
  };
}

afterEach(() => {
  useBookmarkStore.setState({ bookmarks: [] });
  useHistoryStore.setState({ entries: [] });
  cleanup();
  vi.restoreAllMocks();
});

describe('BookmarksPanel — toggle', () => {
  it('renders only toggle button when closed', () => {
    render(<BookmarksPanel {...defaultProps()} />);
    expect(screen.getByRole('button', { name: /open bookmarks/i })).not.toBeNull();
    expect(screen.queryByRole('region', { name: /bookmarks/i })).toBeNull();
  });

  it('shows panel when toggle clicked', async () => {
    const user = userEvent.setup();
    render(<BookmarksPanel {...defaultProps()} />);
    await user.click(screen.getByRole('button', { name: /open bookmarks/i }));
    expect(screen.getByRole('region', { name: /bookmarks/i })).not.toBeNull();
  });

  it('close button hides the panel', async () => {
    const user = userEvent.setup();
    render(<BookmarksPanel {...defaultProps()} />);
    await user.click(screen.getByRole('button', { name: /open bookmarks/i }));
    await user.click(screen.getByRole('button', { name: /close bookmarks/i }));
    expect(screen.getByRole('button', { name: /open bookmarks/i })).not.toBeNull();
    expect(screen.queryByRole('region', { name: /bookmarks/i })).toBeNull();
  });

  it('Esc closes panel when focus is inside', async () => {
    const user = userEvent.setup();
    render(<BookmarksPanel {...defaultProps()} />);
    await user.click(screen.getByRole('button', { name: /open bookmarks/i }));
    const closeBtn = screen.getByRole('button', { name: /close bookmarks/i });
    closeBtn.focus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /open bookmarks/i })).not.toBeNull();
  });
});

describe('BookmarksPanel — Bookmarks tab: capture', () => {
  it('happy path: types name, clicks Save view, adds bookmark to store', async () => {
    const user = userEvent.setup();
    const onCapture = vi.fn().mockReturnValue(BOOKMARK_A);
    render(<BookmarksPanel {...defaultProps({ onCapture })} />);
    await user.click(screen.getByRole('button', { name: /open bookmarks/i }));

    const input = screen.getByRole('textbox', { name: /bookmark name/i });
    await user.type(input, 'Sol system');
    await user.click(screen.getByRole('button', { name: /save view/i }));

    expect(onCapture).toHaveBeenCalledWith('Sol system');
    expect(useBookmarkStore.getState().bookmarks).toHaveLength(1);
    expect(useBookmarkStore.getState().bookmarks[0]?.id).toBe('bm-001');
  });

  it('null capture shows error message and adds nothing', async () => {
    const user = userEvent.setup();
    const onCapture = vi.fn().mockReturnValue(null);
    render(<BookmarksPanel {...defaultProps({ onCapture })} />);
    await user.click(screen.getByRole('button', { name: /open bookmarks/i }));

    await user.click(screen.getByRole('button', { name: /save view/i }));

    expect(screen.getByText(/can't bookmark here/i)).not.toBeNull();
    expect(useBookmarkStore.getState().bookmarks).toHaveLength(0);
  });
});

describe('BookmarksPanel — Bookmarks tab: list interactions', () => {
  it('fly-to calls onGoToBookmark with the bookmark record', async () => {
    const user = userEvent.setup();
    const onGoToBookmark = vi.fn();
    useBookmarkStore.setState({ bookmarks: [BOOKMARK_A] });
    render(<BookmarksPanel {...defaultProps({ onGoToBookmark })} />);
    await user.click(screen.getByRole('button', { name: /open bookmarks/i }));
    await user.click(screen.getByRole('button', { name: /fly to sol system/i }));
    expect(onGoToBookmark).toHaveBeenCalledWith(BOOKMARK_A);
  });

  it('delete removes bookmark from store', async () => {
    const user = userEvent.setup();
    useBookmarkStore.setState({ bookmarks: [BOOKMARK_A] });
    render(<BookmarksPanel {...defaultProps()} />);
    await user.click(screen.getByRole('button', { name: /open bookmarks/i }));
    await user.click(screen.getByRole('button', { name: /delete sol system/i }));
    expect(useBookmarkStore.getState().bookmarks).toHaveLength(0);
  });

  it('rename inline edit updates store', async () => {
    const user = userEvent.setup();
    useBookmarkStore.setState({ bookmarks: [BOOKMARK_A] });
    render(<BookmarksPanel {...defaultProps()} />);
    await user.click(screen.getByRole('button', { name: /open bookmarks/i }));
    await user.click(screen.getByRole('button', { name: /rename sol system/i }));

    const renameInput = screen.getByRole('textbox', { name: /new name/i });
    await user.clear(renameInput);
    await user.type(renameInput, 'Inner System');
    await user.click(screen.getByRole('button', { name: /confirm rename/i }));

    expect(useBookmarkStore.getState().bookmarks[0]?.name).toBe('Inner System');
  });
});

describe('BookmarksPanel — History tab', () => {
  it('lists entries newest-first with resolved names', async () => {
    const user = userEvent.setup();
    useHistoryStore.setState({
      entries: [
        { id: 'sol:earth', visitedAtIso: '2026-06-12T10:00:00Z' },
        { id: 'sol:mars', visitedAtIso: '2026-06-12T09:00:00Z' },
      ],
    });
    const adapter = makeAdapter({
      'sol:earth': { name: 'Earth' },
      'sol:mars': { name: 'Mars' },
    });
    render(<BookmarksPanel {...defaultProps({ adapter })} />);
    await user.click(screen.getByRole('button', { name: /open bookmarks/i }));
    await user.click(screen.getByRole('button', { name: /history/i }));

    const buttons = screen.getAllByRole('button', { name: /go to/i });
    expect(buttons[0]?.textContent).toContain('Earth');
    expect(buttons[1]?.textContent).toContain('Mars');
  });

  it('falls back to id when adapter returns no record', async () => {
    const user = userEvent.setup();
    useHistoryStore.setState({
      entries: [{ id: 'hyg:99999', visitedAtIso: '2026-06-12T10:00:00Z' }],
    });
    render(<BookmarksPanel {...defaultProps()} />);
    await user.click(screen.getByRole('button', { name: /open bookmarks/i }));
    await user.click(screen.getByRole('button', { name: /history/i }));
    expect(screen.getByText('hyg:99999')).not.toBeNull();
  });

  it('click fires onGoToBody with the body id', async () => {
    const user = userEvent.setup();
    const onGoToBody = vi.fn();
    useHistoryStore.setState({
      entries: [{ id: 'sol:earth', visitedAtIso: '2026-06-12T10:00:00Z' }],
    });
    const adapter = makeAdapter({ 'sol:earth': { name: 'Earth' } });
    render(<BookmarksPanel {...defaultProps({ onGoToBody, adapter })} />);
    await user.click(screen.getByRole('button', { name: /open bookmarks/i }));
    await user.click(screen.getByRole('button', { name: /history/i }));
    await user.click(screen.getByRole('button', { name: /go to Earth/i }));
    expect(onGoToBody).toHaveBeenCalledWith('sol:earth');
  });

  it('Clear empties the history store', async () => {
    const user = userEvent.setup();
    useHistoryStore.setState({
      entries: [
        { id: 'sol:earth', visitedAtIso: '2026-06-12T10:00:00Z' },
        { id: 'sol:mars', visitedAtIso: '2026-06-12T09:00:00Z' },
      ],
    });
    render(<BookmarksPanel {...defaultProps()} />);
    await user.click(screen.getByRole('button', { name: /open bookmarks/i }));
    await user.click(screen.getByRole('button', { name: /history/i }));
    await user.click(screen.getByRole('button', { name: /clear history/i }));
    expect(useHistoryStore.getState().entries).toHaveLength(0);
  });
});
