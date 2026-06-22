/**
 * Seed-defined nebula fields (TASK-052, §5.11). A small committed set of
 * `NebulaField`s placed in the galaxy context — NOT a pack (architecture §5.11: the
 * nebulae are decorative procedural fill, not catalog data). Positions/colors are
 * deterministic so reloads are reproducible (§8.6); `render-fx`'s `createNebula`
 * stacks the layers into a billboard volumetric look. Overlays.tsx caps the layer
 * count by quality tier to bound overdraw on low (§5.11).
 *
 * Galaxy-context parsecs. The fields sit a few hundred pc from Sol along the local
 * arm so they are visible on the M-demo descent without crowding the Sol approach.
 */
import * as THREE from 'three';
import type { NebulaField, NebulaLayer } from '@cosmos/core-types';

/** Deterministic [0,1) stream (mulberry32) — no Math.random in generation (§8.6). */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface FieldSpec {
  readonly id: string;
  readonly originPc: readonly [number, number, number];
  readonly radiusPc: number;
  readonly colorLinear: readonly [number, number, number];
  readonly seed: number;
  readonly layerCount: number;
}

/** A handful of emission/reflection nebulae around the local neighbourhood. */
const FIELD_SPECS: readonly FieldSpec[] = [
  // Orion-like emission complex — warm magenta/red star-forming knot.
  { id: 'neb:orion', originPc: [-110, -380, -120], radiusPc: 70, colorLinear: [0.95, 0.28, 0.42], seed: 0x0117a1, layerCount: 16 },
  // A cool blue reflection nebula off along the arm.
  { id: 'neb:reflection', originPc: [420, 160, 90], radiusPc: 55, colorLinear: [0.32, 0.5, 0.95], seed: 0x5eed, layerCount: 14 },
  // A faint teal supernova-remnant shell, further out.
  { id: 'neb:remnant', originPc: [-260, 540, -300], radiusPc: 90, colorLinear: [0.25, 0.8, 0.7], seed: 0x12345, layerCount: 12 },
];

/** Build the layered billboards for one field from its seed (deterministic). */
function buildLayers(spec: FieldSpec): readonly NebulaLayer[] {
  const rand = mulberry32(spec.seed);
  const layers: NebulaLayer[] = [];
  for (let i = 0; i < spec.layerCount; i++) {
    // Scatter layer centres inside the field radius; broad faint haze towards the
    // edge fading to brighter cores near the centre, so the stack reads as volumetric.
    const r = spec.radiusPc * (0.15 + 0.85 * rand());
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const cx = r * Math.sin(phi) * Math.cos(theta);
    const cy = r * Math.sin(phi) * Math.sin(theta);
    const cz = r * Math.cos(phi);
    const t = i / Math.max(spec.layerCount - 1, 1);
    layers.push({
      centerUnits: [cx, cy, cz],
      radiusUnits: spec.radiusPc * (0.45 + 0.55 * rand()),
      // Tint drifts slightly per layer so the stack does not read as one flat colour.
      colorLinear: [
        spec.colorLinear[0] * (0.8 + 0.4 * rand()),
        spec.colorLinear[1] * (0.8 + 0.4 * rand()),
        spec.colorLinear[2] * (0.8 + 0.4 * rand()),
      ],
      opacity: 0.1 + 0.18 * (1 - t),
      seed: Math.floor(rand() * 0xffffff),
    });
  }
  return layers;
}

/** The committed nebula fields (built once at module load — deterministic). */
export const NEBULA_FIELDS: readonly NebulaField[] = FIELD_SPECS.map((spec) => ({
  id: spec.id,
  originPc: spec.originPc,
  layers: buildLayers(spec),
}));

/** Soft radial alpha sprite for the nebula billboards (caller-owned, §5.11). */
export function createNebulaNoiseTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, size * 0.05, c, c, c);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
