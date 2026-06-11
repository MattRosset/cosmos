import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Starfield } from './scene/Starfield';

/**
 * Phase 0 scaffold: R3F canvas with logarithmic depth buffer (mandatory from
 * day one, see ADR-001) and a procedural placeholder starfield.
 *
 * TEMP: OrbitControls is a placeholder until packages/nav lands (the real
 * controller is a custom scale-aware flight controller, NOT OrbitControls).
 */
export function App() {
  return (
    <>
      <Canvas
        gl={{ logarithmicDepthBuffer: true, antialias: false }}
        camera={{ position: [0, 0, 50], near: 0.1, far: 1e9, fov: 60 }}
      >
        <color attach="background" args={['#02030a']} />
        <Starfield />
        <OrbitControls enableDamping dampingFactor={0.08} zoomSpeed={0.8} />
      </Canvas>

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
