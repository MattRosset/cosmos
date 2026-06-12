import type { KeplerElements } from '@cosmos/core-types';

/**
 * Closed orbit polyline in the parent frame, AU, element axes: (segments + 1) × 3
 * Float32 values, sampled uniformly in eccentric anomaly starting at periapsis;
 * last point equals first point. Build-time/setup use only — not a frame-path API.
 * Curtis §4.4.
 */
export function orbitPolylineAu(
  elements: KeplerElements,
  segments: number,
  out?: Float32Array,
): Float32Array {
  const len = (segments + 1) * 3;

  if (out !== undefined) {
    if (out.length !== len) {
      throw new RangeError(
        `out.length must equal (segments + 1) * 3 = ${len}; got ${out.length}`,
      );
    }
  }

  const result = out ?? new Float32Array(len);

  const a = elements.semiMajorAxisAu;
  const e = elements.eccentricity;
  const sqrtOneMinusE2 = Math.sqrt(1 - e * e);

  const cO = Math.cos(elements.ascendingNodeLongitudeRad);
  const sO = Math.sin(elements.ascendingNodeLongitudeRad);
  const co = Math.cos(elements.argumentOfPeriapsisRad);
  const so = Math.sin(elements.argumentOfPeriapsisRad);
  const ci = Math.cos(elements.inclinationRad);
  const si = Math.sin(elements.inclinationRad);

  for (let k = 0; k <= segments; k++) {
    const eccentricAnomalyRad = (2 * Math.PI * k) / segments;
    const cosE = Math.cos(eccentricAnomalyRad);
    const sinE = Math.sin(eccentricAnomalyRad);

    const xPf = a * (cosE - e);
    const yPf = a * sqrtOneMinusE2 * sinE;

    const idx = k * 3;
    result[idx + 0] =
      (cO * co - sO * so * ci) * xPf + (-cO * so - sO * co * ci) * yPf;
    result[idx + 1] =
      (sO * co + cO * so * ci) * xPf + (-sO * so + cO * co * ci) * yPf;
    result[idx + 2] = so * si * xPf + co * si * yPf;
  }

  return result;
}
