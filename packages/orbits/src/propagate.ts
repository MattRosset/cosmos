import type { KeplerElements } from '@cosmos/core-types';
import { SECONDS_PER_DAY, meanMotionRadPerS, solveKepler } from './kepler.js';

/** f64 slots per body in a packed batch. Declaration order mirrors KeplerElements:
 *  [semiMajorAxisAu, eccentricity, inclinationRad, ascendingNodeLongitudeRad,
 *   argumentOfPeriapsisRad, meanAnomalyAtEpochRad, epochJD, muKm3S2]. */
export const ELEMENTS_STRIDE = 8;

/**
 * Position at epoch in the PARENT frame, AU, element axes. Writes into `out`
 * and returns it — zero allocations (frame path, §9). Curtis ch. 4.
 */
export function elementsToPositionAu(
  elements: KeplerElements,
  epochJD: number,
  out: [number, number, number],
): [number, number, number] {
  const t = (epochJD - elements.epochJD) * SECONDS_PER_DAY;
  const n = meanMotionRadPerS(elements.semiMajorAxisAu, elements.muKm3S2);
  const meanAnomalyRad = elements.meanAnomalyAtEpochRad + n * t;
  const eccentricAnomalyRad = solveKepler(meanAnomalyRad, elements.eccentricity);

  const cosE = Math.cos(eccentricAnomalyRad);
  const sinE = Math.sin(eccentricAnomalyRad);
  const xPf = elements.semiMajorAxisAu * (cosE - elements.eccentricity);
  const yPf =
    elements.semiMajorAxisAu *
    Math.sqrt(1 - elements.eccentricity * elements.eccentricity) *
    sinE;

  const cO = Math.cos(elements.ascendingNodeLongitudeRad);
  const sO = Math.sin(elements.ascendingNodeLongitudeRad);
  const co = Math.cos(elements.argumentOfPeriapsisRad);
  const so = Math.sin(elements.argumentOfPeriapsisRad);
  const ci = Math.cos(elements.inclinationRad);
  const si = Math.sin(elements.inclinationRad);

  out[0] = (cO * co - sO * so * ci) * xPf + (-cO * so - sO * co * ci) * yPf;
  out[1] = (sO * co + cO * so * ci) * xPf + (-sO * so + cO * co * ci) * yPf;
  out[2] = so * si * xPf + co * si * yPf;

  return out;
}

/** Pack a list of KeplerElements into a Float64Array for batch propagation. */
export function packElements(list: readonly KeplerElements[]): Float64Array {
  const packed = new Float64Array(list.length * ELEMENTS_STRIDE);
  for (let i = 0; i < list.length; i++) {
    const el = list[i]!;
    const base = i * ELEMENTS_STRIDE;
    packed[base + 0] = el.semiMajorAxisAu;
    packed[base + 1] = el.eccentricity;
    packed[base + 2] = el.inclinationRad;
    packed[base + 3] = el.ascendingNodeLongitudeRad;
    packed[base + 4] = el.argumentOfPeriapsisRad;
    packed[base + 5] = el.meanAnomalyAtEpochRad;
    packed[base + 6] = el.epochJD;
    packed[base + 7] = el.muKm3S2;
  }
  return packed;
}

/**
 * Batch propagation: outPositionsAu receives 3 f64 per body, same order as packed.
 * outPositionsAu.length MUST equal 3 × (packed.length / ELEMENTS_STRIDE) — throws
 * RangeError otherwise. Zero allocations.
 */
export function propagateBatch(
  packed: Float64Array,
  epochJD: number,
  outPositionsAu: Float64Array,
): void {
  const count = (packed.length / ELEMENTS_STRIDE) | 0;
  if (outPositionsAu.length !== 3 * count) {
    throw new RangeError(
      `outPositionsAu.length must equal 3 × (packed.length / ELEMENTS_STRIDE); ` +
        `got ${outPositionsAu.length}, expected ${3 * count}`,
    );
  }

  for (let i = 0; i < count; i++) {
    const base = i * ELEMENTS_STRIDE;
    const semiMajorAxisAu = packed[base + 0]!;
    const eccentricity = packed[base + 1]!;
    const inclinationRad = packed[base + 2]!;
    const ascendingNodeLongitudeRad = packed[base + 3]!;
    const argumentOfPeriapsisRad = packed[base + 4]!;
    const meanAnomalyAtEpochRad = packed[base + 5]!;
    const elemEpochJD = packed[base + 6]!;
    const muKm3S2 = packed[base + 7]!;

    const t = (epochJD - elemEpochJD) * SECONDS_PER_DAY;
    const n = meanMotionRadPerS(semiMajorAxisAu, muKm3S2);
    const meanAnomalyRad = meanAnomalyAtEpochRad + n * t;
    const eccentricAnomalyRad = solveKepler(meanAnomalyRad, eccentricity);

    const cosE = Math.cos(eccentricAnomalyRad);
    const sinE = Math.sin(eccentricAnomalyRad);
    const xPf = semiMajorAxisAu * (cosE - eccentricity);
    const yPf = semiMajorAxisAu * Math.sqrt(1 - eccentricity * eccentricity) * sinE;

    const cO = Math.cos(ascendingNodeLongitudeRad);
    const sO = Math.sin(ascendingNodeLongitudeRad);
    const co = Math.cos(argumentOfPeriapsisRad);
    const so = Math.sin(argumentOfPeriapsisRad);
    const ci = Math.cos(inclinationRad);
    const si = Math.sin(inclinationRad);

    const outBase = i * 3;
    outPositionsAu[outBase + 0] = (cO * co - sO * so * ci) * xPf + (-cO * so - sO * co * ci) * yPf;
    outPositionsAu[outBase + 1] = (sO * co + cO * so * ci) * xPf + (-sO * so + cO * co * ci) * yPf;
    outPositionsAu[outBase + 2] = so * si * xPf + co * si * yPf;
  }
}
