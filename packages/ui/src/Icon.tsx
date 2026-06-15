import { type JSX } from 'react';

/**
 * Monochrome line/solid icon set — inline SVG, no dependency. Every glyph inherits
 * `currentColor` and sizes from the `size` prop, so icons take on the HUD accent /
 * text colour of whatever button hosts them. Transport glyphs (play/pause/seek)
 * are SOLID; the rest are 2px strokes, matching the minimal instrument look.
 */
export type IconName =
  | 'rewind'
  | 'forward'
  | 'play'
  | 'pause'
  | 'sun'
  | 'search'
  | 'bookmark'
  | 'close'
  | 'check'
  | 'edit'
  | 'trash'
  | 'arrow-right'
  | 'now'
  | 'gauge';

const SOLID = { fill: 'currentColor', stroke: 'none' } as const;

const PATHS: Record<IconName, JSX.Element> = {
  rewind: (
    <>
      <polygon points="11 5 11 19 2 12" {...SOLID} />
      <polygon points="22 5 22 19 13 12" {...SOLID} />
    </>
  ),
  forward: (
    <>
      <polygon points="13 5 13 19 22 12" {...SOLID} />
      <polygon points="2 5 2 19 11 12" {...SOLID} />
    </>
  ),
  play: <polygon points="7 4 20 12 7 20" {...SOLID} />,
  pause: (
    <>
      <rect x="6" y="4" width="4" height="16" rx="1" {...SOLID} />
      <rect x="14" y="4" width="4" height="16" rx="1" {...SOLID} />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </>
  ),
  bookmark: <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />,
  close: (
    <>
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </>
  ),
  trash: (
    <>
      <polyline points="3 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  'arrow-right': (
    <>
      <line x1="4" y1="12" x2="20" y2="12" />
      <polyline points="14 6 20 12 14 18" />
    </>
  ),
  now: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </>
  ),
  gauge: (
    <>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <line x1="12" y1="16" x2="15.5" y2="9.5" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
}: {
  readonly name: IconName;
  readonly size?: number;
}): JSX.Element {
  return (
    <svg
      className="cosmos-ui-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
