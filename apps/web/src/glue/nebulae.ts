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
 *
 * Visual model (Tier A, docs/research/nebula-visual-quality.md): each field is a
 * dense stack of MANY small, FAINT, SOFT-edged billboards (no hard alpha cutoff)
 * tinted along a multi-line palette — a hot near-white CORE near the centre, the
 * primary emission line through the body, and a cooler secondary line toward the
 * edges. The integral of many faint soft layers reads as continuous glowing gas
 * instead of a handful of hard-edged "lily-pad" cut-outs.
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

type RGB = readonly [number, number, number];

/** smoothstep mapped to [0,1] for the given edges. */
function smoothstep01(lo: number, hi: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

function lerp3(a: RGB, b: RGB, t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

interface FieldSpec {
  readonly id: string;
  readonly originPc: readonly [number, number, number];
  readonly radiusPc: number;
  /** Primary emission line — the body colour. */
  readonly colorLinear: RGB;
  /** Cooler secondary line/tint, blended in toward the field edge. */
  readonly secondaryLinear: RGB;
  /** Hot ionised core near the exciting stars (bright, near-white). */
  readonly coreLinear: RGB;
  readonly seed: number;
  readonly layerCount: number;
}

/** A handful of emission/reflection nebulae around the local neighbourhood. */
const FIELD_SPECS: readonly FieldSpec[] = [
  // Orion-like emission complex — Hα magenta/red body, hot pink-white core, purple edges.
  {
    id: 'neb:orion',
    originPc: [-110, -380, -120],
    radiusPc: 70,
    colorLinear: [0.95, 0.28, 0.42],
    secondaryLinear: [0.5, 0.18, 0.55],
    coreLinear: [1.0, 0.72, 0.74],
    seed: 0x0117a1,
    layerCount: 30,
  },
  // A cool blue reflection nebula off along the arm — blue body, blue-white core, cyan edges.
  {
    id: 'neb:reflection',
    originPc: [420, 160, 90],
    radiusPc: 55,
    colorLinear: [0.32, 0.5, 0.95],
    secondaryLinear: [0.2, 0.66, 0.86],
    coreLinear: [0.74, 0.86, 1.0],
    seed: 0x5eed,
    layerCount: 28,
  },
  // A faint teal supernova-remnant shell, further out — teal body, pale core, green edges.
  {
    id: 'neb:remnant',
    originPc: [-260, 540, -300],
    radiusPc: 90,
    colorLinear: [0.25, 0.8, 0.7],
    secondaryLinear: [0.5, 0.85, 0.35],
    coreLinear: [0.82, 1.0, 0.92],
    seed: 0x12345,
    layerCount: 30,
  },
];

/** Build the layered billboards for one field from its seed (deterministic). */
function buildLayers(spec: FieldSpec): readonly NebulaLayer[] {
  const rand = mulberry32(spec.seed);
  const count = Math.min(spec.layerCount, 32); // MAX_NEBULA_LAYERS
  const layers: NebulaLayer[] = [];
  for (let i = 0; i < count; i++) {
    // Scatter layer centres with a bias toward the field centre (rand^1.6) so the
    // stack is dense in the core and thins outward — a brighter glowing nucleus.
    const dist = spec.radiusPc * (0.05 + 0.9 * Math.pow(rand(), 1.6));
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const cx = dist * Math.sin(phi) * Math.cos(theta);
    const cy = dist * Math.sin(phi) * Math.sin(theta);
    const cz = dist * Math.cos(phi);
    const radialT = Math.min(1, dist / spec.radiusPc);

    // Multi-line colour: core → primary → secondary as we move outward.
    let col = lerp3(spec.coreLinear, spec.colorLinear, smoothstep01(0.0, 0.3, radialT));
    col = lerp3(col, spec.secondaryLinear, smoothstep01(0.45, 1.0, radialT));
    // Hot-core boost: innermost layers glow brighter (HDR > 1 is fine under additive;
    // also lifts the core over the §5.11 bloom threshold for a glow halo).
    const coreBoost = 1 + 0.9 * (1 - smoothstep01(0.0, 0.28, radialT));
    // Per-layer tint jitter so the stack does not read as one flat colour.
    const j = (): number => 0.85 + 0.3 * rand();

    // Many faint layers: the additive integral is smooth (no posterised tone steps);
    // brighter toward the core, fading out toward the edge.
    const opacity = 0.04 + 0.085 * (1 - 0.65 * radialT);

    layers.push({
      centerUnits: [cx, cy, cz],
      // Smaller billboards than before (0.18–0.55× field) so individual quads are not
      // legible; overlap of many small soft sprites builds the cloud structure.
      radiusUnits: spec.radiusPc * (0.18 + 0.37 * rand()),
      colorLinear: [
        col[0] * j() * coreBoost,
        col[1] * j() * coreBoost,
        col[2] * j() * coreBoost,
      ],
      opacity,
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

/**
 * Cloudy alpha sprite for the nebula billboards (caller-owned, §5.11). A fractal
 * (fBm value-noise) field windowed by a SOFT gaussian falloff — NOT a hard cutoff.
 * The fractal detail makes the stacked layers read as volumetric cloud rather than
 * bokeh discs; the soft (feathered) edge is what kills the "torn-paper / lily-pad"
 * silhouettes the old hard `max(0, …)` threshold produced (nebula-visual-quality.md
 * §2). The shader's per-layer UV rotation + scale make each layer sample a different
 * part of this texture so the stack does not visibly repeat. Deterministic
 * (mulberry32 seed) so reloads are reproducible (§8.6).
 */
export function createNebulaNoiseTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  // --- value-noise lattice (deterministic) + fBm sampler ----------------------
  const rand = mulberry32(0x9e3779b1);
  const GRID = 16; // lattice cells across the sprite (wraps for tileability)
  const lattice = new Float32Array((GRID + 1) * (GRID + 1));
  for (let y = 0; y <= GRID; y++) {
    for (let x = 0; x <= GRID; x++) {
      // Wrap the far edge to the near edge so the noise tiles seamlessly.
      lattice[y * (GRID + 1) + x] =
        x === GRID || y === GRID
          ? lattice[(y % GRID) * (GRID + 1) + (x % GRID)]!
          : rand();
    }
  }
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const valueNoise = (u: number, v: number): number => {
    const gx = u * GRID;
    const gy = v * GRID;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = smooth(gx - x0);
    const fy = smooth(gy - y0);
    const i = (xx: number, yy: number): number => lattice[(yy % GRID) * (GRID + 1) + (xx % GRID)]!;
    const a = i(x0, y0);
    const b = i(x0 + 1, y0);
    const c = i(x0, y0 + 1);
    const d = i(x0 + 1, y0 + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
  const fbm = (u: number, v: number): number => {
    let amp = 0.6;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < 6; o++) {
      sum += amp * valueNoise((u * freq) % 1, (v * freq) % 1);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };

  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c;
      const dy = (y - c) / c;
      const r = Math.hypot(dx, dy);
      const n = fbm(x / size, y / size);
      // SOFT, ragged cloud: a gaussian radial window (smoothly → 0 at the edge, no hard
      // boundary) modulated by the fBm so filaments fade out at different radii in
      // different directions; a gentle contrast lift carves dark voids (the negative
      // part clamps to 0), and a final smoothstep FEATHERS the alpha so there are no
      // crisp cut-out edges (nebula-visual-quality.md §2 A1).
      // Subtract a radial bias from the noise so only the brightest noise peaks survive
      // outward → RAGGED filaments that reach different radii in different directions,
      // not a round disc. (A plain gaussian window made each layer a circle, so at a
      // distance the stack read as a cluster of bokeh "puffs".) The bias + contrast
      // bring back raggedness; the trailing smoothstep FEATHERS the 0→1 ramp so edges
      // stay soft (no hard cut-out), and `window` forces alpha to 0 by r≈0.92 inside
      // the quad so the square billboard edge never shows (shader scale is zoom-OUT
      // only). See nebula-visual-quality.md §2.
      const bias = r * r * 0.85;
      const window = smoothstep01(0.95, 0.5, r);
      let a = (n - 0.32 - bias) * 2.1;
      a = Math.max(0, Math.min(1, a));
      a = a * a * (3 - 2 * a) * window;
      const idx = (y * size + x) * 4;
      img.data[idx] = 255;
      img.data[idx + 1] = 255;
      img.data[idx + 2] = 255;
      img.data[idx + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
