/**
 * Procedural galaxy textures + dust-lane placement (TASK-040). render-galaxy owns
 * no assets — `dustTexture` / `spriteTexture` are injected by the app, and dust-lane
 * billboard centres are the app's to supply. Everything here is generated from the
 * frozen `PROCGEN_GALAXY_DEFAULTS` so the dust lanes trace the same log-spiral arms
 * the procgen star cloud is generated from (ADR-004 §3). No external files.
 */
import * as THREE from 'three';
import { milkyWayResolvedParams } from './milky-way-gen';

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

/** Soft, broad blob — additive arm glow; wide falloff hides individual billboard edges. */
export function createDustTexture(): THREE.CanvasTexture {
  return radialSprite(256, 0.2);
}

/** Tight blob for HII / star-forming knots along the arms. */
export function createHiiTexture(): THREE.CanvasTexture {
  return radialSprite(64, 0.08);
}

/** Concentrated central glow standing in for the whole galaxy at ultra-far LOD. */
export function createImpostorTexture(): THREE.CanvasTexture {
  return radialSprite(256, 0.02);
}

export interface DustLaneGeometry {
  readonly centersUnits: Float32Array; // 3 × n galaxy-local pc (galaxy centre = origin)
  readonly radiiUnits: Float32Array; // n billboard radii, pc
}

/** Fixed seed — dust placement is deterministic across reloads. */
const DUST_PLACEMENT_SEED = 0x64757374; // "dust"

/** Deterministic [0, 1) float stream (mulberry32). */
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Billboards scattered along and around the spiral arms (log-spiral phase,
 * ADR-004 §3). Centres sit on the arm curve then jitter perpendicular and
 * tangentially so overlapping soft blobs form a diffuse band — not a sharp
 * mathematical line. Galaxy-local parsecs centred on the disc origin — the
 * same frame the procgen star batch uses, so one render offset positions cloud
 * + dust together. Still a single instanced draw call.
 */
export function buildDustLanes(perArm = 150): DustLaneGeometry {
  const d = milkyWayResolvedParams();
  const rand = mulberry32(DUST_PLACEMENT_SEED);
  const TWO_PI = 2 * Math.PI;
  const tanPitch = Math.tan(d.armPitchRad);
  const innerPc = d.discScaleLengthPc * 0.6;
  const radialStep = (d.discRadiusPc - innerPc) / Math.max(perArm - 1, 1);
  const n = d.armCount * perArm;
  const centers = new Float32Array(3 * n);
  const radii = new Float32Array(n);

  let i = 0;
  for (let arm = 0; arm < d.armCount; arm++) {
    const armOffset = (TWO_PI * arm) / d.armCount;
    for (let k = 0; k < perArm; k++) {
      const t = k / (perArm - 1);
      const rBase = innerPc + t * (d.discRadiusPc - innerPc);
      const phiBase =
        (d.armWindings * Math.log(rBase / d.discScaleLengthPc + 1)) / tanPitch + armOffset;

      const cosP = Math.cos(phiBase);
      const sinP = Math.sin(phiBase);
      const bx = rBase * cosP;
      const by = rBase * sinP;

      // Unit tangent / normal to the log spiral at this point.
      const dphiDr = d.armWindings / (tanPitch * (rBase + d.discScaleLengthPc));
      const tx = cosP - rBase * sinP * dphiDr;
      const ty = sinP + rBase * cosP * dphiDr;
      const tLen = Math.hypot(tx, ty) || 1;
      const ux = tx / tLen;
      const uy = ty / tLen;
      const nx = -uy;
      const ny = ux;

      // Spread centres into a band: ±65 % of arm width perpendicular, small tangential wobble.
      const perpOff = (rand() * 2 - 1) * d.armWidthPc * 0.65;
      const tanOff = (rand() * 2 - 1) * radialStep * 0.35;

      centers[3 * i] = bx + nx * perpOff + ux * tanOff;
      centers[3 * i + 1] = by + ny * perpOff + uy * tanOff;
      centers[3 * i + 2] = 0;

      // Large, varied radii so blobs overlap into a continuous soft lane.
      const baseRadius = d.armWidthPc * (0.75 + 0.35 * t);
      radii[i] = baseRadius * (0.65 + rand() * 0.55);
      i++;
    }
  }
  return { centersUnits: centers, radiiUnits: radii };
}

/** Magenta HII knots scattered along spiral arms (Tier-2 visual). */
export function buildHiiRegions(perArm = 22): DustLaneGeometry {
  const d = milkyWayResolvedParams();
  const rand = mulberry32(0x484949);
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
      const t = 0.25 + (k / (perArm - 1)) * 0.67;
      const rBase = innerPc + t * (d.discRadiusPc - innerPc);
      const phiBase =
        (d.armWindings * Math.log(rBase / d.discScaleLengthPc + 1)) / tanPitch + armOffset;

      const cosP = Math.cos(phiBase);
      const sinP = Math.sin(phiBase);
      const bx = rBase * cosP;
      const by = rBase * sinP;

      const dphiDr = d.armWindings / (tanPitch * (rBase + d.discScaleLengthPc));
      const tx = cosP - rBase * sinP * dphiDr;
      const ty = sinP + rBase * cosP * dphiDr;
      const tLen = Math.hypot(tx, ty) || 1;
      const nx = -ty / tLen;
      const ny = tx / tLen;

      const perpOff = (rand() * 2 - 1) * d.armWidthPc * 0.55;
      const tanOff = (rand() * 2 - 1) * d.armWidthPc * 0.12;

      centers[3 * i] = bx + nx * perpOff + (tx / tLen) * tanOff;
      centers[3 * i + 1] = by + ny * perpOff + (ty / tLen) * tanOff;
      centers[3 * i + 2] = 0;
      radii[i] = (220 + rand() * 280) * (0.85 + 0.3 * t);
      i++;
    }
  }
  return { centersUnits: centers, radiiUnits: radii };
}
