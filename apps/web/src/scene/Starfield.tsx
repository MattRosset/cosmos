import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { createPrng } from '@cosmos/core-types';

const STAR_COUNT = 50_000;
/** Scene units; shared with nav distance query (Phase 0 placeholder). */
export const STARFIELD_RADIUS = 400;
const FIELD_RADIUS = STARFIELD_RADIUS;
const SEED = 20260610;

/**
 * Placeholder procedural starfield, generated straight into typed arrays with
 * the seeded PRNG (determinism doctrine: same seed -> same sky).
 * Will be replaced by render-stars + the HYG catalog in Phase 1.
 */
export function Starfield() {
  const pointsRef = useRef<THREE.Points>(null);

  const geometry = useMemo(() => {
    const rng = createPrng(SEED);
    const positions = new Float32Array(STAR_COUNT * 3);
    const colors = new Float32Array(STAR_COUNT * 3);
    const color = new THREE.Color();

    for (let i = 0; i < STAR_COUNT; i++) {
      // Uniform direction on the sphere, biased outward in radius so the
      // camera neighborhood isn't crowded.
      const u = rng.next() * 2 - 1;
      const phi = rng.next() * Math.PI * 2;
      const r = FIELD_RADIUS * Math.cbrt(rng.range(0.05, 1));
      const s = Math.sqrt(1 - u * u);
      positions[i * 3] = r * s * Math.cos(phi);
      positions[i * 3 + 1] = r * s * Math.sin(phi);
      positions[i * 3 + 2] = r * u;

      // Crude blackbody-ish tint: most stars warm-white, a few blue/red.
      const t = rng.next();
      if (t < 0.08) color.setHSL(0.62, 0.8, rng.range(0.7, 0.9));
      else if (t < 0.2) color.setHSL(0.07, 0.7, rng.range(0.55, 0.75));
      else color.setHSL(0.12, rng.range(0, 0.15), rng.range(0.75, 1));
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }, []);

  useFrame((_, dt) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y += dt * 0.004;
    }
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        size={1.1}
        vertexColors
        sizeAttenuation
        transparent
        opacity={0.95}
        depthWrite={false}
      />
    </points>
  );
}
