import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { UniversePosition } from '@cosmos/core-types';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';
import type { Vec3Tuple } from '@cosmos/coords';
import { PRIORITY_RENDER, useFrameContext } from '@cosmos/scene-host';

/**
 * TASK-017 — Phase 1 acceptance gate: the RENDERED jitter test (`?debug=jitter`).
 *
 * The Phase 0 gate (packages/coords/test/jitter.test.ts) proved the floating-origin
 * math with a hand-rolled f64 projection. This proves the REAL pipeline: a live
 * Three.js PerspectiveCamera, the logarithmic depth buffer configured by scene-host,
 * and `Vector3.project` (Three's own matrix math) — driven directly, with no nav or
 * flight controller, so the measurement isolates the coordinate + render path.
 *
 * Scenario (mirrors the coords test numbers EXACTLY — do not change them):
 * - Marker: a planet 8 kpc from the galactic center, `{ context: 'galaxy', local: [8000, 0, 0] }`.
 * - Camera: orbits the marker at 1 AU radius (4.84813681e-6 pc), one full revolution
 *   over 300 measured frames, `setCameraPosition` once per frame at frame start.
 * - Each frame the camera looks at the marker's EXACT f64 render-space position, while
 *   the projected/rendered marker uses the f32 downcast of that position (the GPU
 *   vertex path). The sub-pixel gap between the two IS the jitter being measured.
 * - PASS: max screen-space deviation from the mean < 0.5 px at 1280×720 (ADR-001).
 *
 * Isolation: this mode mounts no star pack and no HUD — it must not race pack load
 * (App branches to it before StarApp), and it stays cheap. Zero cost when the flag
 * is absent (App never imports the probe's frame loop otherwise).
 */

/** 1 AU expressed in parsecs — fixed by the gate. */
const AU_PC = 4.84813681e-6;
/** Frames discarded before measuring, so exposure/layout/aspect settle (§ Common Mistakes). */
const WARMUP_FRAMES = 10;
/** Measured frames — one full orbit. */
const MEASURE_FRAMES = 300;
/** ADR-001 sub-pixel threshold. */
const MAX_DEVIATION_PX = 0.5;

const MARKER: UniversePosition = { context: 'galaxy', local: [8000, 0, 0] };
/** Camera starts exactly 1 AU from the marker along +x (θ = 0). */
const INITIAL_CAMERA: UniversePosition = {
  context: 'galaxy',
  local: [8000 + AU_PC, 0, 0],
};

/** Marker render radius (pc): a fraction of the 1 AU orbit so the sphere is visible. */
const MARKER_RADIUS_PC = AU_PC * 0.05;
/** Clip planes bracketing the constant 1 AU marker distance (x/y projection is plane-independent). */
const NEAR_PC = AU_PC * 1e-2;
const FAR_PC = AU_PC * 1e2;

export interface JitterResult {
  readonly maxDeviationPx: number;
  readonly frames: number;
}

declare global {
  interface Window {
    __jitterResult?: JitterResult;
  }
}

// Module-scoped scratch — no allocations inside the frame callback (§9).
const renderScratch: Vec3Tuple = [0, 0, 0];
const projectScratch = new THREE.Vector3();
const screenXs = new Float64Array(MEASURE_FRAMES);
const screenYs = new Float64Array(MEASURE_FRAMES);

function publishResult(): void {
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < MEASURE_FRAMES; i++) {
    sx += screenXs[i]!;
    sy += screenYs[i]!;
  }
  const meanX = sx / MEASURE_FRAMES;
  const meanY = sy / MEASURE_FRAMES;
  let max = 0;
  for (let i = 0; i < MEASURE_FRAMES; i++) {
    max = Math.max(max, Math.hypot(screenXs[i]! - meanX, screenYs[i]! - meanY));
  }
  window.__jitterResult = { maxDeviationPx: max, frames: MEASURE_FRAMES };
}

export function JitterProbe(): React.JSX.Element {
  const origin = useMemo(
    () => createOriginManager(createScaleFrameTree(), INITIAL_CAMERA),
    [],
  );
  const markerRef = useRef<THREE.Mesh>(null);
  const frameRef = useRef(0);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);

  useFrameContext(() => {
    const frame = frameRef.current;
    if (frame > WARMUP_FRAMES + MEASURE_FRAMES) return; // done; window.__jitterResult set
    frameRef.current = frame + 1;

    // Warm-up frames hold at θ = 0; measured frames sweep one full revolution.
    const measureIndex = frame - WARMUP_FRAMES;
    const theta =
      measureIndex < 0 ? 0 : (measureIndex / MEASURE_FRAMES) * 2 * Math.PI;
    const camX = 8000 + AU_PC * Math.cos(theta);
    const camY = AU_PC * Math.sin(theta);

    // Exactly one camera update per frame, at frame start (the coords contract).
    // No rebase fires on a 1 AU orbit, by construction.
    origin.setCameraPosition({ context: 'galaxy', local: [camX, camY, 0] });

    // f64 camera-relative truth: the camera (at the render origin) looks here.
    origin.toRenderSpace(MARKER, renderScratch);
    const tx = renderScratch[0];
    const ty = renderScratch[1];
    const tz = renderScratch[2];

    // GPU f32 vertex path: downcast AFTER the f64 subtraction. This is the
    // position the marker is rendered/projected at; the gap from the f64 target
    // is the jitter.
    const fx = Math.fround(tx);
    const fy = Math.fround(ty);
    const fz = Math.fround(tz);

    if (markerRef.current) markerRef.current.position.set(fx, fy, fz);

    // Drive the live camera directly. Up = +z so the in-plane orbit view
    // direction is never parallel to up (matches the coords test basis).
    camera.position.set(0, 0, 0);
    camera.up.set(0, 0, 1);
    camera.lookAt(tx, ty, tz);
    camera.near = NEAR_PC;
    camera.far = FAR_PC;
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    // Project the f32 marker through the real camera (Three's matrix math).
    projectScratch.set(fx, fy, fz).project(camera);
    const screenX = (projectScratch.x * 0.5 + 0.5) * size.width;
    const screenY = (-projectScratch.y * 0.5 + 0.5) * size.height;

    if (measureIndex >= 0 && measureIndex < MEASURE_FRAMES) {
      screenXs[measureIndex] = screenX;
      screenYs[measureIndex] = screenY;
      if (measureIndex === MEASURE_FRAMES - 1) publishResult();
    }
  }, PRIORITY_RENDER);

  return (
    <mesh ref={markerRef}>
      <sphereGeometry args={[MARKER_RADIUS_PC, 16, 16]} />
      <meshBasicMaterial color="#ffffff" />
    </mesh>
  );
}

export { MAX_DEVIATION_PX, MEASURE_FRAMES };
