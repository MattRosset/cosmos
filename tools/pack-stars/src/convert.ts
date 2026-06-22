import { z } from 'zod';

// J2000 ICRS equatorial → galactic rotation matrix (IAU 1958, transcribed verbatim)
const R = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
] as const;

export interface StarRecord {
  readonly id: number;
  readonly hipId: number;
  readonly positionPc: readonly [number, number, number];
  readonly absMag: number;
  readonly colorIndexBV: number;
  readonly name: string | undefined;
}

const ValidatedRowSchema = z.object({
  id: z.number().int().nonnegative(),
  hipId: z.number().int().nonnegative(),
  // dist >= 0: Sol (id=0) is stored as dist=0 in HYG; "Keep Sol" exempts it from dist > 0
  dist: z.number().gte(0).lt(99999),
  absMag: z.number().finite(),
  colorIndexBV: z.number().gte(-1).lte(4),
  rarad: z.number().finite(),
  decrad: z.number().finite(),
});

function pickName(proper: string, bf: string, gl: string): string | undefined {
  if (proper.trim() !== '') return proper.trim();
  if (bf.trim() !== '') return bf.trim();
  if (gl.trim() !== '') return gl.trim();
  return undefined;
}

/**
 * ICRS RA/Dec (radians) + distance → galactic Cartesian position (same units as
 * `dist`). This is the single source of truth for the catalog frame (ADR-001):
 * pack-octree's Gaia ingest reuses it so HYG and Gaia land in the identical frame
 * (ADR-006 §2 — do not re-derive the rotation elsewhere).
 */
export function galacticPositionPc(
  rarad: number,
  decrad: number,
  dist: number,
): [number, number, number] {
  const cosDec = Math.cos(decrad);
  const e0 = cosDec * Math.cos(rarad);
  const e1 = cosDec * Math.sin(rarad);
  const e2 = Math.sin(decrad);

  // Math done in f64; f32 downcast happens in write-pack
  const g0 = R[0][0] * e0 + R[0][1] * e1 + R[0][2] * e2;
  const g1 = R[1][0] * e0 + R[1][1] * e1 + R[1][2] * e2;
  const g2 = R[2][0] * e0 + R[2][1] * e1 + R[2][2] * e2;

  return [dist * g0, dist * g1, dist * g2];
}

/**
 * Convert one raw CSV row (keyed by column name) into a StarRecord, or return
 * null if the row should be silently dropped per the documented drop rules:
 *   - dist ≥ 99999 (missing-parallax placeholder)
 *   - unparseable rarad, decrad, or absmag
 */
export function processRow(raw: Record<string, string>): StarRecord | null {
  const dist = parseFloat(raw['dist'] ?? '');
  const rarad = parseFloat(raw['rarad'] ?? '');
  const decrad = parseFloat(raw['decrad'] ?? '');
  const absMag = parseFloat(raw['absmag'] ?? '');

  // Documented silent-drop rules
  if (!isFinite(dist) || dist >= 99999) return null;
  if (!isFinite(rarad) || !isFinite(decrad) || !isFinite(absMag)) return null;

  const rawCi = raw['ci'] ?? '';
  const colorIndexBV = rawCi.trim() === '' ? 0.0 : parseFloat(rawCi);

  // The HYG catalog contains a handful of carbon stars / Mira variables with
  // ci > 4 or ci < -1. These fall outside the renderable color range and are
  // silently dropped rather than failing the build.
  if (isFinite(colorIndexBV) && (colorIndexBV < -1 || colorIndexBV > 4)) return null;
  const rawHip = raw['hip'] ?? '';
  const hipId = rawHip.trim() === '' ? 0 : parseInt(rawHip, 10);
  const id = parseInt(raw['id'] ?? '', 10);

  // Fail loudly on anything that breaks invariants after the drop rules
  ValidatedRowSchema.parse({ id, hipId, dist, absMag, colorIndexBV, rarad, decrad });

  const positionPc = galacticPositionPc(rarad, decrad, dist);

  return {
    id,
    hipId,
    positionPc,
    absMag,
    colorIndexBV,
    name: pickName(raw['proper'] ?? '', raw['bf'] ?? '', raw['gl'] ?? ''),
  };
}
