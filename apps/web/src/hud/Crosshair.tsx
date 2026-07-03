/**
 * Persistent aiming reticle — small and dim so it anchors "what am I pointing
 * at" without competing with the field. Part of the always-on HUD layer: stays
 * visible in clean view (it's the reference point for click/double-click-to-enter).
 */
export function Crosshair(): React.JSX.Element {
  return (
    <div className="hud-crosshair" aria-hidden="true">
      <span className="hud-crosshair-h" />
      <span className="hud-crosshair-v" />
      <span className="hud-crosshair-dot" />
    </div>
  );
}
