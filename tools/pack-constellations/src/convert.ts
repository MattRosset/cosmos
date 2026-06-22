import { readFileSync } from 'node:fs';
import type { ConstellationLineSet } from '@cosmos/core-types';

/** The committed pack shape (JSON). Mirrors the frozen interface (TASK-045). */
export interface ConstellationPack {
  readonly packFormatVersion: 1;
  readonly source: string;
  readonly constellations: readonly ConstellationLineSet[];
}

export const PACK_SOURCE =
  'Stellarium "modern_iau" sky culture (CC BY-SA 4.0, Stellarium contributors)';

const CODE_RE = /^[A-Za-z]{3}$/;

/**
 * Parse the committed `.dat` source: one constellation per non-comment line,
 * `CODE|Name|polyline1;polyline2;...` where each polylineN is a comma-separated
 * walk of HIP numbers (consecutive HIPs in the walk form one line segment).
 */
export function parseSource(text: string): ConstellationLineSet[] {
  const lines = text.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'));

  return lines.map((line) => {
    const parts = line.split('|');
    if (parts.length !== 3) {
      throw new Error(`Malformed source line (expected CODE|Name|polylines): ${line}`);
    }
    const [code, name, polylinesStr] = parts as [string, string, string];
    if (!CODE_RE.test(code)) {
      throw new Error(`Invalid constellation code "${code}" (expected 3 letters)`);
    }

    const hipPairs: number[] = [];
    for (const polyline of polylinesStr.split(';')) {
      const hips = polyline.split(',').map((s) => {
        const n = Number(s);
        if (!Number.isInteger(n) || n <= 0) {
          throw new Error(`Invalid HIP number "${s}" in constellation ${code}`);
        }
        return n;
      });
      if (hips.length < 2) {
        throw new Error(`Polyline with fewer than 2 stars in constellation ${code}`);
      }
      for (let i = 0; i < hips.length - 1; i++) {
        hipPairs.push(hips[i]!, hips[i + 1]!);
      }
    }

    return { code, name, hipPairs };
  });
}

/**
 * Build the ConstellationPack from the parsed source list.
 * Sorted by `code` for reproducible output (§11).
 */
export function buildPack(constellations: ConstellationLineSet[]): ConstellationPack {
  const sorted = [...constellations].sort((a, b) => a.code.localeCompare(b.code));

  const codes = new Set<string>();
  for (const c of sorted) {
    if (codes.has(c.code)) {
      throw new Error(`Duplicate constellation code: ${c.code}`);
    }
    codes.add(c.code);
    if (c.hipPairs.length % 2 !== 0) {
      throw new Error(`hipPairs has odd length for ${c.code}`);
    }
  }

  return {
    packFormatVersion: 1,
    source: PACK_SOURCE,
    constellations: sorted,
  };
}

/** Throws unless the constellation-line credit is present (§11 doctrine). */
export function assertAttribution(attributionsPath: string): void {
  const text = readFileSync(attributionsPath, 'utf8');
  if (!/Stellarium/.test(text) || !/CC BY-SA 4\.0/.test(text)) {
    throw new Error(
      `Constellation-line attribution missing: "Stellarium" + "CC BY-SA 4.0" not found in ${attributionsPath}`,
    );
  }
}
