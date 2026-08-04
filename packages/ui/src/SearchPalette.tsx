import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import type { BodyRecord } from '@cosmos/core-types';
import { formatEtaAtC } from './format';
import type { SearchPaletteProps } from './types';

const PC_TO_LY = 3.26156;

/**
 * A DR3 source_id query: optional `gaia:` prefix + 5–19 digits (a 64-bit id is ≤ 19
 * digits). Capture group 2 is the bare digit string handed to `adapter.resolveGaiaId`.
 */
const GAIA_ID_RE = /^(gaia:)?(\d{5,19})$/;

/** Async Gaia-lookup UI state (TASK-070); `idle` ⇒ the normal named-star search renders. */
type GaiaState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly id: string }
  | { readonly kind: 'hit'; readonly id: string; readonly positionPc: readonly [number, number, number] }
  | { readonly kind: 'miss'; readonly id: string };

const GAIA_IDLE: GaiaState = { kind: 'idle' };

/** "at c: …" travel estimate for a star result, or null for non-star records. */
function rowEtaAtC(record: BodyRecord): string | null {
  if (record.kind !== 'star') return null;
  const [x, y, z] = record.positionPc;
  return formatEtaAtC(Math.sqrt(x * x + y * y + z * z) * PC_TO_LY);
}

/**
 * Opens on Ctrl+K or "/" (when no input focused); Esc closes; ↑/↓ + Enter navigate.
 * Renders nothing while closed. Max 12 results, 80 ms input debounce.
 *
 * TASK-070: a query matching {@link GAIA_ID_RE} (a DR3 source_id) takes an async branch —
 * `adapter.resolveGaiaId` instead of `adapter.search` — and a hit flies the camera to the
 * star's raw galaxy position via `onGoToPosition` (a Gaia star is not a flyable body). The
 * named-star path (`adapter.search` → `onGoTo`) is unchanged.
 */
export function SearchPalette({
  adapter,
  onGoTo,
  onGoToPosition,
  open: openProp,
  onOpenChange,
}: SearchPaletteProps): JSX.Element {
  // Controlled when the host passes open/onOpenChange; else self-managed.
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly BodyRecord[]>([]);
  const [gaia, setGaia] = useState<GaiaState>(GAIA_IDLE);
  const [highlighted, setHighlighted] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Staleness guard (Deliverable 2): a monotonic token identifying the CURRENT query.
   * Every async `resolveGaiaId` captures the token live at dispatch; a resolve whose token
   * is no longer current (a faster newer query superseded it) is dropped — never rendered
   * or flown. Also bumped when leaving the Gaia branch so an in-flight resolve can't clobber
   * a later named-star search.
   */
  const queryTokenRef = useRef(0);

  const reset = useCallback(() => {
    setQuery('');
    setResults([]);
    setGaia(GAIA_IDLE);
    setHighlighted(0);
    queryTokenRef.current++; // invalidate any in-flight Gaia resolve
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    reset();
  }, [setOpen, reset]);

  const openPalette = useCallback(() => {
    setOpen(true);
    reset();
  }, [setOpen, reset]);

  // Debounced search — named-star (sync `adapter.search`) or Gaia id (async `resolveGaiaId`).
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const trimmed = query.trim();
      const m = GAIA_ID_RE.exec(trimmed);
      const gaiaId = m?.[2];
      if (gaiaId !== undefined && adapter.resolveGaiaId) {
        const token = ++queryTokenRef.current;
        setResults([]);
        setHighlighted(0);
        setGaia({ kind: 'loading', id: gaiaId });
        adapter
          .resolveGaiaId(gaiaId)
          .then((hit) => {
            if (token !== queryTokenRef.current) return; // superseded — drop
            setGaia(hit ? { kind: 'hit', id: gaiaId, positionPc: hit.positionPc } : { kind: 'miss', id: gaiaId });
            setHighlighted(0);
          })
          .catch(() => {
            if (token !== queryTokenRef.current) return;
            setGaia({ kind: 'miss', id: gaiaId });
          });
        return;
      }
      // Named-star path: invalidate any in-flight Gaia resolve and run the sync search.
      queryTokenRef.current++;
      setGaia(GAIA_IDLE);
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

  const selectGaiaHit = (): void => {
    if (gaia.kind !== 'hit') return;
    onGoToPosition?.(gaia.positionPc);
    closePalette();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      closePalette();
      return;
    }
    // Gaia branch: only a hit is selectable (single row); loading/miss have nothing to do.
    if (gaia.kind !== 'idle') {
      if (gaia.kind === 'hit' && e.key === 'Enter') {
        e.preventDefault();
        selectGaiaHit();
      }
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
        {renderRows()}
      </ul>
    </div>
  );

  function renderRows(): JSX.Element | JSX.Element[] {
    // Gaia id branch (TASK-070): loading / single hit / miss.
    if (gaia.kind === 'loading') {
      return (
        <li className="cosmos-ui-palette-loading" role="option" aria-selected={false} aria-disabled>
          Searching Gaia DR3 {gaia.id}…
        </li>
      );
    }
    if (gaia.kind === 'hit') {
      return (
        <li
          role="option"
          aria-selected={true}
          className="cosmos-ui-palette-item cosmos-ui-palette-item--highlighted"
          onClick={selectGaiaHit}
        >
          <span className="cosmos-ui-palette-item-name">Gaia DR3 {gaia.id}</span>
        </li>
      );
    }
    if (gaia.kind === 'miss') {
      return (
        <li className="cosmos-ui-palette-no-matches" role="option" aria-selected={false}>
          No matches
        </li>
      );
    }

    // Named-star path (unchanged).
    if (query.trim() !== '' && results.length === 0) {
      return (
        <li className="cosmos-ui-palette-no-matches" role="option" aria-selected={false}>
          No matches
        </li>
      );
    }
    return results.map((star, i) => {
      const eta = rowEtaAtC(star);
      return (
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
          <span className="cosmos-ui-palette-item-name">{star.name ?? star.id}</span>
          {eta !== null && <span className="cosmos-ui-palette-item-eta">{eta}</span>}
        </li>
      );
    });
  }
}
