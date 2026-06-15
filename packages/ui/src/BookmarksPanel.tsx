import { type JSX, useState } from 'react';
import { useBookmarkStore, useHistoryStore } from '@cosmos/app-state';
import type { BookmarkRecord } from '@cosmos/core-types';
import { Icon } from './Icon';
import type { BookmarksPanelProps } from './types';

type Tab = 'bookmarks' | 'history';

export function BookmarksPanel({
  onCapture,
  onGoToBookmark,
  onGoToBody,
  adapter,
  open: openProp,
  onOpenChange,
}: BookmarksPanelProps): JSX.Element {
  // Controlled when the host passes onOpenChange (the dock owns the trigger);
  // otherwise self-managed with the built-in toggle button (back-compat).
  const [openState, setOpenState] = useState(false);
  const controlled = onOpenChange !== undefined;
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [tab, setTab] = useState<Tab>('bookmarks');
  const [name, setName] = useState('');
  const [captureError, setCaptureError] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const bookmarks = useBookmarkStore((s) => s.bookmarks);
  const add = useBookmarkStore((s) => s.add);
  const remove = useBookmarkStore((s) => s.remove);
  const rename = useBookmarkStore((s) => s.rename);

  const entries = useHistoryStore((s) => s.entries);
  const clear = useHistoryStore((s) => s.clear);

  function handleSave(): void {
    const record = onCapture(name);
    if (record === null) {
      setCaptureError(true);
    } else {
      add(record);
      setName('');
      setCaptureError(false);
    }
  }

  function handleRenameConfirm(b: BookmarkRecord): void {
    rename(b.id, renameValue);
    setRenamingId(null);
  }

  if (!open) {
    // In controlled mode the host (dock) renders the trigger — render nothing.
    if (controlled) return <></>;
    return (
      <button
        className="cosmos-ui-bookmarks-toggle"
        aria-label="Open bookmarks"
        onClick={() => setOpen(true)}
      >
        <Icon name="bookmark" size={18} />
      </button>
    );
  }

  return (
    <div
      className="cosmos-ui-bookmarks"
      role="region"
      aria-label="Bookmarks"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <div className="cosmos-ui-bookmarks-header">
        <button
          className="cosmos-ui-bookmarks-tab"
          aria-pressed={tab === 'bookmarks'}
          onClick={() => setTab('bookmarks')}
        >
          Bookmarks
        </button>
        <button
          className="cosmos-ui-bookmarks-tab"
          aria-pressed={tab === 'history'}
          onClick={() => setTab('history')}
        >
          History
        </button>
        <button
          className="cosmos-ui-bookmarks-close"
          aria-label="Close bookmarks"
          onClick={() => setOpen(false)}
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      {tab === 'bookmarks' && (
        <div className="cosmos-ui-bookmarks-body">
          <div className="cosmos-ui-bookmarks-capture">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setCaptureError(false);
              }}
              placeholder="Bookmark name"
              aria-label="Bookmark name"
            />
            <button aria-label="Save view" onClick={handleSave}>
              Save view
            </button>
          </div>
          {captureError && (
            <p className="cosmos-ui-bookmarks-error" role="alert">
              Can't bookmark here
            </p>
          )}
          <ul className="cosmos-ui-bookmarks-list">
            {bookmarks.map((b) => (
              <li key={b.id} className="cosmos-ui-bookmarks-row">
                {renamingId === b.id ? (
                  <>
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      aria-label="New name"
                    />
                    <button
                      aria-label={`Confirm rename ${b.name}`}
                      onClick={() => handleRenameConfirm(b)}
                    >
                      <Icon name="check" size={14} />
                    </button>
                    <button
                      aria-label={`Cancel rename ${b.name}`}
                      onClick={() => setRenamingId(null)}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="cosmos-ui-bookmarks-name">{b.name}</span>
                    <span className="cosmos-ui-bookmarks-date">
                      {b.createdAtIso.slice(0, 10)}
                    </span>
                    <button
                      aria-label={`Fly to ${b.name}`}
                      onClick={() => onGoToBookmark(b)}
                    >
                      <Icon name="arrow-right" size={14} />
                    </button>
                    <button
                      aria-label={`Rename ${b.name}`}
                      onClick={() => {
                        setRenamingId(b.id);
                        setRenameValue(b.name);
                      }}
                    >
                      <Icon name="edit" size={14} />
                    </button>
                    <button
                      aria-label={`Delete ${b.name}`}
                      onClick={() => remove(b.id)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'history' && (
        <div className="cosmos-ui-bookmarks-body">
          <button
            className="cosmos-ui-history-clear"
            aria-label="Clear history"
            onClick={clear}
          >
            Clear
          </button>
          <ul className="cosmos-ui-history-list">
            {entries.map((entry, i) => {
              const displayName =
                adapter.getBody(entry.id)?.name ?? entry.id;
              return (
                <li key={`${entry.id}-${i}`} className="cosmos-ui-history-row">
                  <button
                    aria-label={`Go to ${displayName}`}
                    onClick={() => onGoToBody(entry.id)}
                  >
                    {displayName}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
