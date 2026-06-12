import { useMemo } from 'react';
import * as THREE from 'three';
import { CONTEXT_UNIT_METERS } from '@cosmos/core-types';
import type { ContextId, UniversePosition } from '@cosmos/core-types';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';
import type { OriginManager, Vec3Tuple } from '@cosmos/coords';
import { PRIORITY_COORDS, PRIORITY_NAV, useFrameContext } from '@cosmos/scene-host';
import { useFlightController } from '@cosmos/nav';
import { debugHudState } from './DebugHud';

/**
 * TASK-006 debug flythrough scene (`?debug=markers`): labeled marker cubes at
 * log-spaced distances covering ≥ 12 orders of magnitude, anchored through the
 * scale-frame tree so they are physically consistent. Marker positions are
 * recomputed camera-relative (f64 → f32) from `coords` every frame — this is
 * exactly the pipeline the jitter gate certifies, observed by a human.
 *
 * Frame layout: everything to visit lies along −z (the initial look direction).
 * Galactic center at galaxy [0,0,0]; the star (system origin) 8 kpc out at
 * galaxy [0,0,8000]; the planet (planet origin) 1 AU from the star at system
 * [0,0,1]. The camera starts in the `planet` context 4 km from the planet
 * origin and keeps that context for the whole flight (nav v1 has no context
 * auto-switching) — f64 km units hold the full 17-OOM route losslessly.
 */

interface MarkerSpec {
  readonly label: string;
  readonly context: ContextId;
  /** Distance from the context origin, in context units, along −z. */
  readonly distanceUnits: number;
  readonly color: string;
}

const KM_PER_UNIT: Record<ContextId, number> = {
  universe: CONTEXT_UNIT_METERS.universe / CONTEXT_UNIT_METERS.planet,
  galaxy: CONTEXT_UNIT_METERS.galaxy / CONTEXT_UNIT_METERS.planet,
  system: CONTEXT_UNIT_METERS.system / CONTEXT_UNIT_METERS.planet,
  planet: 1,
};

const MARKER_SPECS: readonly MarkerSpec[] = [
  // planet context: 1e0–1e3 km from the planet origin
  ...[1, 10, 100, 1000].map((d) => ({
    label: `${d} km`,
    context: 'planet' as const,
    distanceUnits: d,
    color: '#4dd2ff',
  })),
  // system context: 1e-2–1e2 AU from the star
  ...[0.01, 0.1, 1, 10, 100].map((d) => ({
    label: `${d} AU`,
    context: 'system' as const,
    distanceUnits: d,
    color: '#ffc94d',
  })),
  // galaxy context: 1e-4–1e4 pc from the galactic center
  ...[1e-4, 1e-3, 1e-2, 1e-1, 1, 10, 100, 1e3].map((d) => ({
    label: `${d} pc`,
    context: 'galaxy' as const,
    distanceUnits: d,
    color: '#c44dff',
  })),
  { label: '10 kpc', context: 'galaxy', distanceUnits: 1e4, color: '#c44dff' },
];

/** Cube edge = 25% of the marker's distance from its context origin. */
const MARKER_SIZE_RATIO = 0.25;

/**
 * Markers fan out on a cone around the −z flight axis (golden-angle spacing).
 * Size/distance is constant, so collinear markers would subtend the same angle
 * and occlude each other perfectly; the cone keeps every cube visible while
 * each stays at EXACTLY its labeled distance from its context origin.
 */
const CONE_HALF_ANGLE = (12 * Math.PI) / 180;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function markerLocal(distanceUnits: number, index: number): [number, number, number] {
  const phi = index * GOLDEN_ANGLE;
  const r = Math.sin(CONE_HALF_ANGLE) * distanceUnits;
  return [
    r * Math.cos(phi),
    r * Math.sin(phi),
    -Math.cos(CONE_HALF_ANGLE) * distanceUnits,
  ];
}

const INITIAL_CAMERA: UniversePosition = { context: 'planet', local: [0, 0, 4] };

interface Marker {
  readonly group: THREE.Group;
  readonly position: UniversePosition;
  /** Half the cube edge, in render (planet/km) units. */
  readonly halfSizeUnits: number;
}

function createLabelSprite(text: string, color: string, cubeEdgeUnits: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx2d = canvas.getContext('2d');
  if (ctx2d) {
    // Monospace for cross-platform canvas-texture determinism (E2E SwiftShader baselines).
    ctx2d.font = 'bold 38px monospace, sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillStyle = color;
    ctx2d.fillText(text, 128, 34);
  }
  const material = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    transparent: true,
    depthTest: false, // labels readable at any depth — debug-only chrome
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(4 * cubeEdgeUnits, cubeEdgeUnits, 1);
  sprite.position.set(0, cubeEdgeUnits * 1.4, 0);
  return sprite;
}

function buildMarkers(): Marker[] {
  const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
  return MARKER_SPECS.map((spec, index) => {
    const edgeUnits = spec.distanceUnits * MARKER_SIZE_RATIO * KM_PER_UNIT[spec.context];
    const group = new THREE.Group();
    const cube = new THREE.Mesh(
      cubeGeometry,
      new THREE.MeshBasicMaterial({ color: spec.color }),
    );
    cube.scale.setScalar(edgeUnits);
    group.add(cube);
    group.add(createLabelSprite(spec.label, spec.color, edgeUnits));
    return {
      group,
      position: { context: spec.context, local: markerLocal(spec.distanceUnits, index) },
      halfSizeUnits: edgeUnits / 2,
    };
  });
}

// Module-scoped scratch — no allocations inside frame callbacks (§9).
const renderScratch: Vec3Tuple = [0, 0, 0];

interface DebugScene {
  readonly origin: OriginManager;
  readonly stats: { rebaseCount: number; cameraLocalUnits: number };
  readonly markers: Marker[];
  readonly root: THREE.Group;
}

function createDebugScene(): DebugScene {
  const tree = createScaleFrameTree();
  tree.setAnchor('system', [0, 0, 8000]); // star 8 kpc from galactic center (pc)
  tree.setAnchor('planet', [0, 0, 1]); // planet 1 AU from the star (AU)

  const inner = createOriginManager(tree, INITIAL_CAMERA);
  const stats = { rebaseCount: 0, cameraLocalUnits: 0 };

  // Render origin tracking: the origin starts at the initial camera and jumps
  // onto the camera whenever a rebase fires, so |cameraLocal| is derivable
  // here without widening the frozen coords API. The camera context never
  // changes in this scene (nav v1 always reports positions in origin.context).
  const originLocal: Vec3Tuple = [
    INITIAL_CAMERA.local[0],
    INITIAL_CAMERA.local[1],
    INITIAL_CAMERA.local[2],
  ];

  const origin: OriginManager = {
    get context() {
      return inner.context;
    },
    get cameraUniverse() {
      return inner.cameraUniverse;
    },
    switchContext: (target) => inner.switchContext(target),
    toRenderSpace: (pos, out) => inner.toRenderSpace(pos, out),
    setCameraPosition(pos) {
      const event = inner.setCameraPosition(pos);
      if (event) {
        stats.rebaseCount += 1;
        originLocal[0] = pos.local[0];
        originLocal[1] = pos.local[1];
        originLocal[2] = pos.local[2];
      }
      stats.cameraLocalUnits = Math.hypot(
        pos.local[0] - originLocal[0],
        pos.local[1] - originLocal[1],
        pos.local[2] - originLocal[2],
      );
      return event;
    },
  };

  const markers = buildMarkers();
  const root = new THREE.Group();
  for (const m of markers) root.add(m.group);

  return { origin, stats, markers, root };
}

export function DebugMarkers() {
  const scene = useMemo(createDebugScene, []);

  const flight = useFlightController({
    origin: scene.origin,
    initial: { position: INITIAL_CAMERA, orientation: [0, 0, 0, 1] },
    // The default 1e7 km/s cap would make a 17-OOM flight take ages; the
    // log-scaled speed law is the real limiter in this scene.
    maxSpeedUnitsPerS: 1e30,
  });

  // Contract from @cosmos/nav: feed distance-to-nearest-surface one priority
  // step before nav integrates. Uses last frame's camera — 1-frame-stale is
  // fine for a speed law.
  useFrameContext(() => {
    let nearestSurface = Number.POSITIVE_INFINITY;
    for (const m of scene.markers) {
      scene.origin.toRenderSpace(m.position, renderScratch);
      const d = Math.hypot(renderScratch[0], renderScratch[1], renderScratch[2]);
      // Floor at 20% of the half-size so flying through a cube stays escapable.
      nearestSurface = Math.min(
        nearestSurface,
        Math.max(d - m.halfSizeUnits, m.halfSizeUnits * 0.2),
      );
    }
    flight.setDistanceToNearestSurface(nearestSurface);
  }, PRIORITY_NAV - 1);

  // Post-nav: re-anchor every marker camera-relative (f64 subtraction inside
  // coords, f32 only at the GPU) and adapt near/far to the visible scale span.
  useFrameContext((ctx) => {
    let nearestCenter = Number.POSITIVE_INFINITY;
    let farthestCenter = 0;
    for (const m of scene.markers) {
      scene.origin.toRenderSpace(m.position, renderScratch);
      m.group.position.set(renderScratch[0], renderScratch[1], renderScratch[2]);
      const d = Math.hypot(renderScratch[0], renderScratch[1], renderScratch[2]);
      nearestCenter = Math.min(nearestCenter, d);
      farthestCenter = Math.max(farthestCenter, d);
    }

    // 17 OOM cannot live in one static near/far pair, even with the log depth
    // buffer; ADR-001 calls for per-context planes — this is the debug-scene
    // equivalent, derived from the marker span.
    const near = Math.min(Math.max(nearestCenter * 1e-3, 1e-4), 1e3);
    const far = Math.max(farthestCenter * 4, 1e6);
    if (ctx.camera.near !== near || ctx.camera.far !== far) {
      ctx.camera.near = near;
      ctx.camera.far = far;
      ctx.camera.updateProjectionMatrix();
    }

    debugHudState.context = scene.origin.context;
    debugHudState.cameraLocalUnits = scene.stats.cameraLocalUnits;
    debugHudState.rebaseCount = scene.stats.rebaseCount;
    debugHudState.speedUnitsPerS = flight.state.speedUnitsPerS;
    const fps = 1000 / Math.max(ctx.dtMs, 1e-3);
    debugHudState.fps = debugHudState.fps === 0 ? fps : debugHudState.fps * 0.9 + fps * 0.1;
  }, PRIORITY_COORDS);

  return <primitive object={scene.root} />;
}
