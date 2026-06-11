import { SceneHost } from '@cosmos/scene-host';
import { NavDriver } from './scene/NavDriver';
import { Starfield } from './scene/Starfield';
import { DebugHud } from './scene/DebugHud';
import { DebugMarkers } from './scene/DebugMarkers';

/** TASK-006 debug flythrough scene, behind the query flag only. */
const DEBUG_MARKERS =
  new URLSearchParams(window.location.search).get('debug') === 'markers';

/**
 * Phase 0 scaffold: thin composition — SceneHost owns the Canvas and frame loop;
 * NavDriver supplies scale-aware free flight; this file supplies the HUD shell.
 */
export function App() {
  return (
    <>
      <SceneHost>
        <color attach="background" args={['#02030a']} />
        {DEBUG_MARKERS ? (
          <DebugMarkers />
        ) : (
          <>
            <NavDriver />
            <Starfield />
          </>
        )}
      </SceneHost>

      <div className="hud">
        <div className="hud-panel hud-panel--info">
          <h1>cosmos</h1>
          <div className="dim">
            {DEBUG_MARKERS ? 'Phase 0 — debug markers (12+ OOM)' : 'Phase 0 — placeholder starfield'}
          </div>
          <div className="dim">WASD move · R/F up/down · drag to look · Shift/Ctrl speed</div>
        </div>
        {DEBUG_MARKERS ? <DebugHud /> : null}
      </div>
    </>
  );
}
