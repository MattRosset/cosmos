import { OrbitControls } from '@react-three/drei';
import { SceneHost } from '@cosmos/scene-host';
import { Starfield } from './scene/Starfield';

/**
 * Phase 0 scaffold: thin composition — SceneHost owns the Canvas and frame loop;
 * this file supplies scene content and the HUD shell.
 *
 * TEMP: OrbitControls is a placeholder until packages/nav lands (the real
 * controller is a custom scale-aware flight controller, NOT OrbitControls).
 */
export function App() {
  return (
    <>
      <SceneHost>
        <color attach="background" args={['#02030a']} />
        <Starfield />
        <OrbitControls enableDamping dampingFactor={0.08} zoomSpeed={0.8} />
      </SceneHost>

      <div className="hud">
        <div className="hud-panel hud-panel--info">
          <h1>cosmos</h1>
          <div className="dim">Phase 0 scaffold — placeholder starfield</div>
          <div className="dim">drag to look · scroll to zoom</div>
        </div>
      </div>
    </>
  );
}
