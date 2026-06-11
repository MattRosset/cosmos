import { useEffect, useState } from 'react';

/**
 * TASK-006 debug HUD readout for the `?debug=markers` flythrough scene:
 * current context, |cameraLocal|, rebase count, speed, fps.
 */
export interface DebugHudData {
  context: string;
  /** |camera - render origin| in current context units. */
  cameraLocalUnits: number;
  rebaseCount: number;
  speedUnitsPerS: number;
  fps: number;
}

/**
 * Mutable store written by DebugMarkers every frame, OUTSIDE React state —
 * the HUD samples it at 10 Hz so per-frame data never triggers React
 * (architecture §5.12).
 */
export const debugHudState: DebugHudData = {
  context: '—',
  cameraLocalUnits: 0,
  rebaseCount: 0,
  speedUnitsPerS: 0,
  fps: 0,
};

const HUD_POLL_MS = 100;

function fmt(value: number): string {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e5 || abs < 1e-3) return value.toExponential(2);
  return value.toFixed(abs >= 100 ? 0 : 2);
}

/** DOM overlay panel (lives outside the Canvas, inside the .hud root). */
export function DebugHud() {
  const [snap, setSnap] = useState<DebugHudData>({ ...debugHudState });

  useEffect(() => {
    const id = setInterval(() => setSnap({ ...debugHudState }), HUD_POLL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="hud-panel" style={{ top: 16, right: 16, minWidth: 230 }}>
      <h1>debug markers</h1>
      <div>
        context: <span className="dim">{snap.context}</span>
      </div>
      <div>
        |cameraLocal|: <span className="dim">{fmt(snap.cameraLocalUnits)} units</span>
      </div>
      <div>
        rebases: <span className="dim">{snap.rebaseCount}</span>
      </div>
      <div>
        speed: <span className="dim">{fmt(snap.speedUnitsPerS)} units/s</span>
      </div>
      <div>
        fps: <span className="dim">{Math.round(snap.fps)}</span>
      </div>
    </div>
  );
}
