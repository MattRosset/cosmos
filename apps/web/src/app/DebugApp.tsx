import { SceneHost } from '@cosmos/scene-host';
import { DebugHud } from '../scene/DebugHud';
import { DebugMarkers } from '../scene/DebugMarkers';

/** TASK-006 debug scene, unchanged: the no-pack fallback and CI flythrough target. */
export function DebugApp() {
  return (
    <>
      <SceneHost>
        <color attach="background" args={['#02030a']} />
        <DebugMarkers />
      </SceneHost>

      <div className="hud">
        <div className="hud-panel hud-panel--info">
          <h1>cosmos</h1>
          <div className="dim">Phase 0 — debug markers (12+ OOM)</div>
          <div className="dim">WASD move · R/F up/down · drag to look · Shift/Ctrl speed</div>
        </div>
        <DebugHud />
      </div>
    </>
  );
}
