export interface ModeBadgeProps {
  /** Resolved label to display, or `null` to render nothing. */
  readonly label: string | null;
}

/**
 * Movement-mode badge (TASK-066 S2). Presentational only: the host decides the
 * label from live flight state (scale jump vs. free exploration) and this renders
 * it — or nothing. No nav/three imports; the badge just shows what it is given.
 */
export function ModeBadge({ label }: ModeBadgeProps): React.JSX.Element | null {
  if (label === null) return null;
  return (
    <div className="hud-mode-badge" role="status">
      {label}
    </div>
  );
}
