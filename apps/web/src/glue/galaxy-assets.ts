/**
 * Procedural galaxy textures + dust-lane placement (TASK-040). render-galaxy owns
 * no assets — `dustTexture` / `spriteTexture` are injected by the app, and dust-lane
 * billboard centres are the app's to supply. Everything here is generated from the
 * frozen `PROCGEN_GALAXY_DEFAULTS` so the dust lanes trace the same log-spiral arms
 * the procgen star cloud is generated from (ADR-004 §3). No external files.
 */
import * as THREE from 'three';
import { PROCGEN_GALAXY_DEFAULTS } from '@cosmos/core-types';

/** A soft radial alpha falloff on a small canvas — used for both dust and impostor. */
function radialSprite(size: number, inner: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, size * inner, c, c, c);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Soft, broad blob — multiplied over the additive cloud to carve dust lanes. */
export function createDustTexture(): THREE.CanvasTexture {
  return radialSprite(128, 0.0);
}

/** Concentrated central glow standing in for the whole galaxy at ultra-far LOD. */
export function createImpostorTexture(): THREE.CanvasTexture {
  return radialSprite(256, 0.02);
}

export interface DustLaneGeometry {
  readonly centersUnits: Float32Array; // 3 × n galaxy-local pc (galaxy centre = origin)
  readonly radiiUnits: Float32Array; // n billboard radii, pc
}

/**
 * Billboards strung densely along the spiral arms (log-spiral phase, ADR-004 §3) so
 * they overlap into continuous dust lanes rather than discrete blobs. Each billboard
 * is much smaller than the arm width (≈ ⅓) and placed at a fine radial step, so the
 * chain reads as a soft lane tracing each arm. Galaxy-local parsecs centred on the
 * disc origin — the same frame the procgen star batch uses, so one render offset
 * positions cloud + dust together. Still a single instanced draw call.
 */
export function buildDustLanes(perArm = 110): DustLaneGeometry {
  const d = PROCGEN_GALAXY_DEFAULTS;
  const TWO_PI = 2 * Math.PI;
  const tanPitch = Math.tan(d.armPitchRad);
  const innerPc = d.discScaleLengthPc * 0.6;
  const n = d.armCount * perArm;
  const centers = new Float32Array(3 * n);
  const radii = new Float32Array(n);

  let i = 0;
  for (let arm = 0; arm < d.armCount; arm++) {
    const armOffset = (TWO_PI * arm) / d.armCount;
    for (let k = 0; k < perArm; k++) {
      const t = k / (perArm - 1);
      const r = innerPc + t * (d.discRadiusPc - innerPc);
      const phi = (d.armWindings * Math.log(r / d.discScaleLengthPc + 1)) / tanPitch + armOffset;
      centers[3 * i] = r * Math.cos(phi);
      centers[3 * i + 1] = r * Math.sin(phi);
      centers[3 * i + 2] = 0;
      // Small relative to the arm width (so the dense chain blends into a lane),
      // tapering slightly outward.
      radii[i] = d.armWidthPc * (0.35 + 0.25 * t);
      i++;
    }
  }
  return { centersUnits: centers, radiiUnits: radii };
}
