/**
 * B–V → approximate main-sequence spectral class.
 * Fixed table: bv < 0.0 → 'B'; [0.0, 0.3) → 'A'; [0.3, 0.58) → 'F';
 * [0.58, 0.81) → 'G'; [0.81, 1.40) → 'K'; ≥ 1.40 → 'M'.
 */
export function spectralClassFromBV(bv: number): 'B' | 'A' | 'F' | 'G' | 'K' | 'M' {
  if (bv < 0.0) return 'B';
  if (bv < 0.3) return 'A';
  if (bv < 0.58) return 'F';
  if (bv < 0.81) return 'G';
  if (bv < 1.4) return 'K';
  return 'M';
}
