import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import type { BodyRecord } from '@cosmos/core-types';
import type { SearchPaletteProps } from './types';

/**
 * Opens on Ctrl+K or "/" (when no input focused); Esc closes; ↑/↓ + Enter navigate.
 * Renders nothing while closed. Max 12 results, 80 ms input debounce.
 */
export function SearchPalette({
  adapter,
  onGoTo,
  open: openProp,
  onOpenChange,
}: SearchPaletteProps): JSX.Element {
  // Controlled when the host passes open/onOpenChange; else self-managed.
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly BodyRecord[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResults([]);
    setHighlighted(0);
  }, [setOpen]);

  const openPalette = useCallback(() => {
    setOpen(true);
    setQuery('');
    setResults([]);
    setHighlighted(0);
  }, [setOpen]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const trimmed = query.trim();
      const res = trimmed ? adapter.search(trimmed, 12).slice(0, 12) : [];
      setResults(res);
      setHighlighted(0);
    }, 80);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, adapter]);

  // Global hotkeys for opening
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        if (!open) openPalette();
        return;
      }
      if (e.key === '/' && !open) {
        const target = e.target as Element;
        const tag = target.tagName.toLowerCase();
        const isEditable = target instanceof HTMLElement && target.isContentEditable;
        if (tag === 'input' || tag === 'textarea' || isEditable) return;
        e.preventDefault();
        openPalette();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, openPalette]);

  if (!open) return <></>;

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      closePalette();
      return;
    }
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      const star = results[highlighted];
      if (star) {
        onGoTo(star.id);
        closePalette();
      }
    }
  };

  return (
    <div
      className="cosmos-ui-palette"
      role="dialog"
      aria-label="Search stars"
      aria-modal="true"
    >
      <input
        type="text"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleInputKeyDown}
        placeholder="Search stars…"
        aria-label="Search query"
        aria-autocomplete="list"
        aria-controls="cosmos-ui-palette-results"
      />
      <ul
        id="cosmos-ui-palette-results"
        role="listbox"
        aria-label="Search results"
      >
        {query.trim() !== '' && results.length === 0 ? (
          <li
            className="cosmos-ui-palette-no-matches"
            role="option"
            aria-selected={false}
          >
            No matches
          </li>
        ) : (
          results.map((star, i) => (
            <li
              key={star.id}
              role="option"
              aria-selected={i === highlighted}
              className={
                i === highlighted
                  ? 'cosmos-ui-palette-item cosmos-ui-palette-item--highlighted'
                  : 'cosmos-ui-palette-item'
              }
              onClick={() => {
                onGoTo(star.id);
                closePalette();
              }}
            >
              {star.name ?? star.id}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
